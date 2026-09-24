// NovaFlow Web Runtime.
//
// This loads AFTER proxy-electron-api.js, which has already installed the
// renderer's own browser implementation of electronAPI - the one 4783 runs on
// every day. We do not replace it. We OVERRIDE the handful of methods that
// point at a local ComfyUI and at the desktop's local client API, and leave
// everything else exactly as the renderer expects.
//
// Loading first was wrong: publishing electronAPI early makes
// proxy-electron-api.js stand down, and the renderer then takes its DESKTOP
// path on the strength of whatever capabilities we happen to advertise.
//
// What it translates:
//
//   renderer                          web runtime              elsewhere
//   ------------------------------    ---------------------    ------------------
//   getWorkflowJson(options)          records an intent        (graph never built)
//   POST /prompt {prompt: intent}     creates a task           control plane
//   GET  /history/<id>                task status -> history   control plane
//   GET  /queue                       synthesised              control plane
//   GET  /view?filename=              signed gateway URL       worker gateway
//   runtimeUploadImage(name, bytes)   grant + PUT              worker gateway
//   clientAuth*                       unchanged                novaflow-backend
//
// The browser never holds a ComfyUI graph: the redacted workflow modules hand
// back {__novaflowServerOnly, module, fn, options}, and that is what travels.

(function (root) {
  'use strict';

  const CONFIG = Object.assign({
    controlUrl: 'http://127.0.0.1:4890',
    authUrl: 'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend',
    pollIntervalMs: 900
  }, root.NOVAFLOW_WEB_CONFIG || {});

  const SESSION_KEY = 'novaflow_web_session_v1';
  const CLIENT_AUTH_KEY = 'novaflow.client.auth.session.v1';
  // The launcher chooses the DEFAULT endpoint: the local assistant's own machine, or the shared pool on
  // the hosted site. Prompt-assistant and licence calls follow this and nothing else.
  const computeMode = CONFIG.localAssistant ? 'local' : 'shared';
  const taskModes = new Map();
  // 算力源: the pool node the user pinned in the topbar (novaflow-web-compute-node.js). Pinned work
  // always goes through the control plane, carries the node id, and asks capabilities about that
  // node alone - also from a page the local assistant opened, whose own machine is the default.
  const NODE_KEY = 'novaflow.web.compute.node.v1';
  const NODE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let computeNode = null;
  try {
    const saved = JSON.parse(root.localStorage.getItem(NODE_KEY) || 'null');
    if (saved && NODE_ID.test(String(saved.id))) computeNode = { id: String(saved.id), name: String(saved.name || '') };
  } catch (_) { /* private mode: nothing pinned */ }
  const taskMode = () => (CONFIG.localAssistant && !computeNode ? 'local' : 'shared');
  let localKey = '';
  if (CONFIG.localAssistant && root.location) {
    try {
      const pair = new URLSearchParams(root.location.hash.slice(1)).get('local-pair');
      if (pair && /^[a-f0-9]{64}$/.test(pair)) {
        root.sessionStorage.setItem('novaflow.local.pair', pair);
        root.history.replaceState(null, '', root.location.pathname + root.location.search);
      }
      localKey = root.sessionStorage.getItem('novaflow.local.pair') || '';
    } catch (_) {}
  }

  // ---------------------------------------------------------------- session
  let session = null;
  function currentSession() {
    try {
      const savedRaw = root.localStorage.getItem(CLIENT_AUTH_KEY);
      const primaryRaw = root.localStorage.getItem(SESSION_KEY);
      let saved = null, primary = null;
      try { saved = JSON.parse(savedRaw || 'null'); } catch (_) {}
      try { primary = JSON.parse(primaryRaw || 'null'); } catch (_) {}
      // The shared account panel can retain a valid login after an older Web
      // status probe removed only SESSION_KEY. Re-read on each request so an
      // editor opened before login also sees a login made in another tab.
      session = saved?.session?.token
        ? { token: saved.session.token, user: saved.user || primary?.user || null }
        : primary?.token ? primary : null;
    } catch (_) { /* private mode may only retain the in-memory session */ }
    return session;
  }
  currentSession();

  function saveSession(next) {
    session = next;
    try {
      if (next) root.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      else root.localStorage.removeItem(SESSION_KEY);
    } catch (_) { /* private mode */ }
  }

  function authHeaders(extra) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    const active = currentSession();
    if (active?.token) headers.Authorization = 'Bearer ' + active.token;
    return headers;
  }

  async function api(base, method, path, body) {
    const res = await fetch(base.replace(/\/+$/, '') + path, {
      method: method,
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
      headers: authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let parsed = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch (_) { parsed = { error: text.slice(0, 300) }; }
    if (!res.ok) {
      const error = new Error(String(parsed.error || ('request failed ' + res.status)));
      error.status = res.status;
      error.code = parsed.code;
      throw error;
    }
    return parsed;
  }

  async function localControl(method, path, body, timeoutMs = 30000) {
    if (!CONFIG.localAssistant) throw new Error('请在本地助手点击“启动NovaFlow”，连接本机工作台');
    const res = await fetch(CONFIG.localOrigin + path, { method,
      headers: { 'content-type': 'application/json', 'x-novaflow-local': localKey },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const value = await res.json();
    if (!res.ok) throw Object.assign(new Error(value.error || '本机服务请求失败'), { status: res.status });
    return value;
  }
  // 提示词助手 runs on the machine 启动NovaFlow opened this page from: the
  // assistant starts the desktop's own Python service and answers in the
  // desktop bridge's shape. The hosted site has no such machine, so there the
  // buttons say so and 智能 AI's Grok path stays. A run can load a 7B model
  // and, for H3, look at a dozen frames, hence the long wait.
  const PROMPT_ASSISTANT_REFUSAL = '提示词助手在 Web 版通过智能 AI 提供';
  const PROMPT_ASSISTANT_TIMEOUT_MS = 16 * 60 * 1000;
  async function localPromptAssistant(action, payload) {
    if (computeMode !== 'local') return { ok: false, error: PROMPT_ASSISTANT_REFUSAL };
    try { return await localControl('POST', '/local/prompt-assistant/' + action, payload || {}, PROMPT_ASSISTANT_TIMEOUT_MS); }
    catch (error) { return { ok: false, error: String(error.message || error) }; }
  }
  if (CONFIG.localAssistant) root.addEventListener?.('load', async () => {
    try {
      const response = await fetch(CONFIG.localOrigin + '/local/events', { headers: { 'x-novaflow-local': localKey } });
      if (!response.ok) return;
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split('\n\n'); buffer = messages.pop();
        if (messages.includes('data: closed')) {
          // Browsers may disallow closing an externally opened tab. In that
          // case cover the stopped editor rather than leave active controls.
          const panel = root.document.createElement('div');
          panel.setAttribute('role', 'status');
          panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#151515;color:#eee;font:16px system-ui;padding:32px;text-align:center';
          panel.textContent = 'NovaFlow 已关闭。可关闭此标签页，需要使用时请在本地助手点击“启动NovaFlow”。';
          root.document.body.appendChild(panel);
          root.close?.();
          return;
        }
      }
    } catch (_) { /* A temporary transport loss never closes the editor. */ }
  }, { once: true });
  async function control(method, path, body) {
    const taskId = /^\/api\/web\/tasks\/([^/]+)/.exec(path)?.[1];
    const mode = taskModes.get(taskId) || taskMode();
    const isCompute = /^\/api\/web\/(tasks|capabilities|workers|loras)(?:[/?]|$)/.test(path);
    if (mode === 'shared' && computeNode) {
      if (path === '/api/web/tasks' && method === 'POST') body = Object.assign({}, body || {}, { target_worker_id: computeNode.id });
      if (/^\/api\/web\/capabilities(?:\?|$)/.test(path)) path += (path.includes('?') ? '&' : '?') + 'worker=' + encodeURIComponent(computeNode.id);
    }
    const value = mode === 'local' && isCompute ? await localControl(method, path, body) : await api(CONFIG.controlUrl, method, path, body);
    if (path === '/api/web/tasks' && method === 'POST' && value.task) taskModes.set(value.task.id, mode);
    return value;
  }
  const auth = (method, path, body) => api(CONFIG.authUrl, method, path, body);

  // ------------------------------------------------------- workflow intents
  //
  // A redacted builder calls serverOnly(); we remember the most recent intent
  // per module so the matching /prompt submission can pick it up. Keyed by
  // module because a panel may prepare one workflow while another is running.
  const intents = new Map();
  // 一键拆图 tasks: their layer files are working material for the 拆图 panel, not 仓库 entries.
  const splitTasks = new Set();
  let lastIntent = null;

  function recordIntent(intent) {
    const value = {
      module: intent.module,
      method: intent.method || intent.fn,
      options: intent.options,
      at: Date.now()
    };
    intents.set(value.module, value);
    lastIntent = value;
    return value;
  }

  function isIntent(value) {
    if (!value || typeof value !== 'object') return false;
    return value.__novaflowServerOnly === true || value.__novaflowWorkflowIntent === true;
  }

  /** Pull the intent out of whatever the renderer handed to /prompt. */
  function intentFrom(prompt) {
    if (isIntent(prompt)) {
      return {
        module: prompt.module,
        method: prompt.fn || prompt.method,
        options: prompt.options
      };
    }
    if (typeof prompt === 'string') {
      try {
        const parsed = JSON.parse(prompt);
        if (isIntent(parsed)) return intentFrom(parsed);
      } catch (_) { /* not our marker */ }
    }
    // A graph the renderer assembled from redacted pieces still carries the
    // marker somewhere inside it; find the first one.
    if (prompt && typeof prompt === 'object') {
      for (const key of Object.keys(prompt)) {
        const found = intentFrom(prompt[key]);
        if (found) return found;
      }
    }
    return null;
  }

  // ------------------------------------------------------------- task cache
  // ComfyUI's HTTP surface is polled, so the renderer will ask repeatedly for
  // the same task. Cache what the control plane says and let the poll refresh
  // it, rather than turning one ComfyUI poll into two network round trips.
  const tasks = new Map();      // promptId -> task
  const grants = new Map();     // taskId -> download grant
  const uploads = new Map();    // filename -> { taskId, name }
  const pendingUploads = [];
  // Session-only metadata for the existing H3 output-resource adapter. Its
  // legacy "local" schema is backed by signed Worker downloads on the Web.
  const videoOutputs = new Map();

  async function refreshTask(promptId) {
    const known = tasks.get(promptId);
    if (!known) return null;
    try {
      const res = await control('GET', '/api/web/tasks/' + known.id);
      tasks.set(promptId, res.task);
      return res.task;
    } catch (error) {
      if (error.status === 404) tasks.delete(promptId);
      return known;
    }
  }

  async function grantFor(task, op) {
    const cached = grants.get(task.id);
    if (cached && op === 'download' && Date.parse(cached.expiresAt) - Date.now() > 60000) return cached;
    const res = await control('POST', '/api/web/tasks/' + task.id + '/grant', { op: op });
    if (op === 'download') grants.set(task.id, res.grant);
    return res.grant;
  }

  // --------------------------------------------------- ComfyUI shape mapping
  const RUNNING = ['created', 'queued', 'assigned', 'uploading', 'processing'];

  /** Present a control-plane task the way ComfyUI's /history presents a prompt. */
  function asHistoryEntry(task) {
    const files = (task.output_manifest && task.output_manifest.files) || [];
    const outputs = {};
    if (files.length) {
      outputs['nf-output'] = {
        images: files.filter((f) => f.kind !== 'video').map((f) => ({
          filename: f.name, subfolder: '', type: 'output'
        })),
        gifs: files.filter((f) => f.kind === 'video').map((f) => ({
          filename: f.name, subfolder: '', type: 'output', format: 'video/mp4'
        }))
      };
    }

    const failed = task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired';
    return {
      prompt: [0, task.id, {}, {}, []],
      outputs: outputs,
      status: {
        completed: task.status === 'completed',
        status_str: task.status === 'completed' ? 'success' : (failed ? 'error' : 'running'),
        messages: failed
          ? [['execution_error', { exception_message: task.error_message || task.error_code || task.status }]]
          : []
      },
      // Extra, ignored by the renderer but useful when debugging in the console.
      novaflow: {
        taskId: task.id,
        progress: task.progress,
        note: task.progress_note,
        worker: task.assigned_worker_id,
        attempt: task.attempt_count,
        charged: task.charged_credit_cost
      }
    };
  }

  function asQueueState() {
    const running = [];
    const pending = [];
    for (const [promptId, task] of tasks) {
      if (!RUNNING.includes(task.status)) continue;
      const row = [0, promptId, {}, {}, []];
      if (task.status === 'queued' || task.status === 'created') pending.push(row);
      else running.push(row);
    }
    return { queue_running: running, queue_pending: pending };
  }

  // ------------------------------------------------- reference images in
  //
  // Straight to the machine that will run the task, through the same tunnel
  // the results come back on. Nothing about a task's files touches any
  // storage: they were made on that disk and the references join them there.
  //
  // This is why the upload has to wait. A reference belongs to ONE worker -
  // whichever the scheduler picked - so there is nobody to send it to until
  // the task is assigned, and the grant that authorises the write is minted
  // against that worker.
  async function waitForAssignment(taskId, { timeoutMs = 60000, onWait } = {}) {
    const started = Date.now();
    for (;;) {
      const res = await control('GET', '/api/web/tasks/' + taskId);
      const task = res.task || {};
      tasks.set(taskId, task);
      if (task.assigned_worker_id) return task;
      // A panel that shows progress needs to say something during this wait;
      // 60s of a frozen bar reads as a hang. The callback is optional so the
      // existing callers are unchanged.
      if (typeof onWait === 'function') {
        try { onWait(Math.round((Date.now() - started) / 1000)); } catch (_) { /* a listener must not break the wait */ }
      }
      if (task.status === 'failed' || task.status === 'cancelled') {
        throw new Error('任务在上传参考图前就结束了：' + (task.error_message || task.status));
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error('等不到空闲算力节点，参考图没能送出');
      }
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  async function putReferences(taskId, refs) {
    const task = await waitForAssignment(taskId);
    const grant = await grantFor(task, 'upload');
    const base = String(grant.endpoint || '').replace(/\/+$/, '');
    if (!base) throw new Error('算力节点没有可用地址');

    for (const ref of refs) {
      const held = uploads.get(ref.name);
      if (!held) throw new Error('找不到 ' + ref.name + ' 的图像数据');
      const res = await fetch(
        base + '/gw/tasks/' + taskId + '/input/' + encodeURIComponent(ref.name),
        {
          method: 'PUT',
          headers: { 'content-type': mimeFor(ref.name), 'x-novaflow-grant': grant.token },
          body: held.bytes
        }
      );
      if (!res.ok) throw new Error(ref.name + ' 上传返回 ' + res.status);
      uploads.delete(ref.name);
    }
  }

  // The same three steps for bytes a panel never staged under a name.
  //
  // putReferences can only send what went through `uploads`, which is how the
  // art panels work: they prepare a named image and submit later. The cutout
  // shim holds one blob it made itself and has nowhere to stage it, so it
  // needs wait-for-worker / mint-grant / PUT without the staging. Same wire
  // format, same tunnel, same grant - only the source of the bytes differs.
  async function putTaskInput(taskId, name, bytes, onWait) {
    const task = await waitForAssignment(taskId, { onWait: onWait });
    const grant = await grantFor(task, 'upload');
    const base = String(grant.endpoint || '').replace(/\/+$/, '');
    if (!base) throw new Error('算力节点没有可用地址');

    const res = await fetch(
      base + '/gw/tasks/' + taskId + '/input/' + encodeURIComponent(name),
      {
        method: 'PUT',
        headers: { 'content-type': mimeFor(name), 'x-novaflow-grant': grant.token },
        body: bytes
      }
    );
    if (!res.ok) throw new Error(name + ' 上传返回 ' + res.status);
    return task;
  }

  /** One finished output file, as raw bytes. The warehouse is the caller's business. */
  async function fetchTaskOutput(task, filename) {
    const grant = await grantFor(task, 'download');
    const url = grant.endpoint.replace(/\/+$/, '') +
      '/gw/tasks/' + task.id + '/output/' + encodeURIComponent(filename) +
      '?grant=' + encodeURIComponent(grant.token);
    const res = await fetch(url);
    if (!res.ok) throw new Error('取回 ' + filename + ' 失败：' + res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  // A file stored as octet-stream is fine for an <img>, which sniffs, and not
  // fine for a <video>, which does not - and a video that silently refuses to
  // play looks like a generation that failed.
  function mimeFor(name) {
    const ext = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    const map = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
      gif: 'image/gif', bmp: 'image/bmp', mp4: 'video/mp4', webm: 'video/webm'
    };
    return (ext && map[ext[1]]) || 'application/octet-stream';
  }

  // ------------------------------------------------------------- submission
  async function submitPrompt(body) {
    const intent = intentFrom(body && body.prompt);
    if (!intent) {
      // Nothing recorded means a panel tried to submit a graph it built
      // itself. On the desktop that works; here it is exactly what spec 10
      // forbids, so it fails loudly rather than silently doing nothing.
      throw new Error(
        'NovaFlow Web 不接受浏览器直接提交工作流。' +
        '该功能的图构建尚未迁移到算力节点，请在 docs/LIMITATIONS.md 查看已迁移的功能。'
      );
    }

    // Other panels may prepare uploads without submitting a task. Attach only
    // filenames actually used by this intent, otherwise an earlier inpaint
    // preview becomes a reference image on a later text-to-video request.
    const usedNames = new Set();
    const collectNames = (value) => {
      if (typeof value === 'string') usedNames.add(value);
      else if (Array.isArray(value)) value.forEach(collectNames);
      else if (value && typeof value === 'object') Object.values(value).forEach(collectNames);
    };
    collectNames(intent.options);
    const selected = new Map();
    for (let i = 0; i < pendingUploads.length;) {
      const ref = pendingUploads[i];
      if (usedNames.has(ref.name)) {
        selected.set(ref.name, ref);
        pendingUploads.splice(i, 1);
      } else i += 1;
    }
    const refs = [...selected.values()];

    const task = await control('POST', '/api/web/tasks', {
      task_type: 'renderer_workflow',
      workflow: { module: intent.module, method: intent.method },
      parameters: intent.options || {},
      references: refs
    });

    const promptId = task.task.id;
    tasks.set(promptId, task.task);
    if (intent.method === 'buildSeeThroughSplitWorkflow') splitTasks.add(promptId);
    root.NovaFlowWebRuntime.lastTask = task.task;

    // Send the reference images.
    //
    // This used to queue the bytes in `uploads` and never read the map again:
    // the task carried the NAMES of the references and the pixels stayed in
    // the browser, so a worker running 图生图 waited two minutes for an upload
    // that was never coming and then failed the task. Text-to-image has no
    // references, which is why every run that was ever verified worked.
    if (refs.length) {
      try {
        await putReferences(promptId, refs);
      } catch (error) {
        // Say which step failed. "timed out waiting for the browser to upload"
        // arrives from the worker two minutes later and points at the wrong
        // side of the wire.
        throw new Error('参考图上传失败：' + String(error.message || error));
      }
    }

    return { prompt_id: promptId, number: tasks.size, node_errors: {} };
  }

  // The renderer calls these with a SINGLE payload object:
  //
  //   runtimeRequestJson({ baseUrl, path, init })
  //   runtimeUploadImage({ baseUrl, fileName, dataBase64, type, subfolder })
  //
  // I wrote them as positional parameters, so `path` arrived undefined and the
  // shim answered "NovaFlow Web does not proxy " - with nothing after the
  // space, which is what gave it away. 美工 and 绘图 were dead for every user
  // because of it. The shapes below are taken from proxy-electron-api.js,
  // which is the contract, and a test now asserts they still match it.
  //
  // Positional calls are accepted too: this file's own fetch interceptor uses
  // them, and tolerating both costs nothing.
  function asPayload(args, names) {
    const first = args[0];
    if (first && typeof first === 'object' && !ArrayBuffer.isView(first) && !(first instanceof ArrayBuffer)) {
      return first;
    }
    const out = {};
    names.forEach((n, i) => { out[n] = args[i]; });
    return out;
  }

  // What the compute node's image runtime offers beyond the fixed task types,
  // e.g. { qwenImage21: true }: the local assistant, or on the website the
  // shared pool (true while a node that can build 2.1 is online). The website
  // draws on 2.1, so its panel starts from that layout (steps, CFG, ten
  // references, the 2.1 LoRA list) and keeps it while nobody is online: an
  // empty pool says nothing about the node that will take the run. Only a
  // drawing node that lacks 2.1 switches it to the 2511 layout.
  let runtimeFeatureCache = taskMode() === 'shared' ? { qwenImage21: true } : {};
  function drawingNodeOnline(caps) {
    const types = caps && Array.isArray(caps.taskTypes) ? caps.taskTypes : [];
    return types.some((t) => t && t.kind === 'image' && Number(t.available_workers) > 0);
  }
  // The answer can be missing on the first try (a page opened while the assistant restarts, a model
  // probe that timed out at start): until the node reports 2.1, ask again every 15 s for a while and
  // when the window regains focus, so the drawing panel does not stay on its fallback layout.
  let runtimeFeatureRetry = null;
  let runtimeFeatureRetries = 0;
  let runtimeFeatureCheckedAt = 0;
  function scheduleRuntimeFeatureRetry() {
    if (runtimeFeatureRetry || runtimeFeatureRetries >= 40 || typeof root.setTimeout !== 'function') return;
    runtimeFeatureRetry = root.setTimeout(() => {
      runtimeFeatureRetry = null;
      runtimeFeatureRetries += 1;
      electronAPI.runtimeFeatures();
    }, 15000);
    // Never keeps a Node test process alive.
    if (runtimeFeatureRetry && typeof runtimeFeatureRetry.unref === 'function') runtimeFeatureRetry.unref();
  }

  // ------------------------------------------------------------ the adapter
  //
  // Mirrors the shape proxy-electron-api.js probes for, so the renderer's
  // capability check passes and it never installs its loopback fallback.
  const electronAPI = {
    // ---- ComfyUI runtime proxy -------------------------------------------
    async runtimeGetSystemStats(payload) {
      try {
        const video = /:8189(?:\/|$)/.test(String(payload && payload.baseUrl || ''));
        const count = await poolHas(video ? 'h3_i2v' : 'qwen_t2i');
        if (!count) return { ok: false, status: 503, error: '暂无可用算力节点，请稍后重试' };
        return {
          ok: true,
          status: 200,
          result: {
            system: {
              os: 'web',
              comfyui_version: 'novaflow-web-pool',
              ram_total: 0, ram_free: 0
            },
            devices: [{ name: count + ' 台算力节点', type: 'cuda', index: 0, vram_total: 0, vram_free: 0 }]
          }
        };
      } catch (error) {
        return { ok: false, error: String(error.message || error) };
      }
    },

    async runtimeRequestJson(...args) {
      const { baseUrl, path, init } = asPayload(args, ['baseUrl', 'path', 'init']);
      const method = String((init && init.method) || 'GET').toUpperCase();
      const clean = String(path || '').split('?')[0].replace(/^\/api\//, '/').replace(/\/+$/, '');
      const query = String(path || '').includes('?')
        ? new URLSearchParams(String(path).split('?')[1])
        : new URLSearchParams();

      try {
        let body = null;
        if (init && init.body) {
          try { body = JSON.parse(init.body); } catch (_) { body = null; }
        }

        if (method === 'POST' && (clean === '/prompt' || clean === '/api/prompt')) {
          return { ok: true, status: 200, result: await submitPrompt(body) };
        }

        if (clean.startsWith('/history')) {
          const promptId = clean.split('/')[2];
          if (!promptId) return { ok: true, status: 200, result: {} };
          const task = await refreshTask(promptId);
          if (!task) return { ok: true, status: 200, result: {} };
          const out = {};
          out[promptId] = asHistoryEntry(task);
          return { ok: true, status: 200, result: out };
        }

        if (clean === '/queue') {
          await Promise.all([...tasks.keys()].map(refreshTask));
          return { ok: true, status: 200, result: asQueueState() };
        }

        if (method === 'POST' && clean === '/interrupt') {
          const running = [...tasks.entries()].find(([, t]) => RUNNING.includes(t.status));
          if (running) await control('POST', '/api/web/tasks/' + running[1].id + '/cancel');
          return { ok: true, status: 200, result: {} };
        }

        if (clean.startsWith('/object_info')) {
          // The node catalogue lives on a compute node, not here. Answering
          // with an empty object would be worse than saying so: a caller that
          // believes it holds a catalogue then builds from nothing, and the
          // renderer has paths that generate a Web Worker's source from it -
          // which is how an empty success became a SyntaxError in a worker.
          //
          // Reporting "no runtime" makes callers take the same branch they
          // take on the desktop when ComfyUI is not running.
          return {
            ok: false,
            status: 503,
            error: 'NovaFlow Web 不在浏览器里暴露节点目录；节点信息由算力节点持有'
          };
        }

        if (clean === '/system_stats') {
          return await electronAPI.runtimeGetSystemStats({ baseUrl });
        }

        void query;
        return { ok: false, status: 404, error: 'NovaFlow Web does not proxy ' + clean };
      } catch (error) {
        // "missing session token" is the control plane's own wording and it
        // surfaced raw in three different panels, none of which told anyone to
        // log in. Say the thing that can be acted on.
        const status = error.status || 500;
        if (status === 401 || /session token|unauthor/i.test(String(error.message || ''))) {
          return {
            ok: false,
            status: 401,
            error: '请先登录 NovaFlow 账号（点顶栏右上角的「登录」）'
          };
        }
        return { ok: false, status, error: String(error.message || error) };
      }
    },

    async runtimeRequestBinary(...args) {
      const { baseUrl, path } = asPayload(args, ['baseUrl', 'path', 'init']);
      const query = new URLSearchParams(String(path).split('?')[1] || '');
      const filename = query.get('filename');
      if (!filename) return { ok: false, error: 'missing filename' };

      // Newest task first: 一键拆图's seethrough_psd_info.log keeps one name across runs, and the
      // page wants the run it just made.
      const entry = [...tasks.values()].reverse().find(
        (t) => ((t.output_manifest && t.output_manifest.files) || []).some((f) => f.name === filename)
      );
      if (!entry) return { ok: false, error: 'unknown output file: ' + filename };

      try {
        // Straight from the worker's disk. grant.endpoint is its tunnel
        // address when it has one, so this reaches the machine that made the
        // file from anywhere - without the bytes passing through any storage.
        const grant = await grantFor(entry, 'download');
        const url = grant.endpoint.replace(/\/+$/, '') +
          '/gw/tasks/' + entry.id + '/output/' + encodeURIComponent(filename) +
          '?grant=' + encodeURIComponent(grant.token);
        const res = await fetch(url);
        if (!res.ok) return { ok: false, error: '取回结果失败：' + res.status };
        const buffer = await res.arrayBuffer();
        if (root.NovaFlowWebWarehouse && !splitTasks.has(entry.id)) {
          await root.NovaFlowWebWarehouse.save({ blob: new Blob([buffer], { type: mimeFor(filename) }), name: filename });
        }
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        const contentType = res.headers.get('content-type') || mimeFor(filename);
        return {
          ok: true,
          status: 200,
          dataBase64: btoa(binary),
          contentType,
          result: {
            data: buffer,
            contentType,
            url: url
          }
        };
      } catch (error) {
        return { ok: false, error: String(error.message || error) };
      }
    },

    /** A URL an <img>/<video> can use directly, with the grant in the query. */
    async runtimeFileUrl(filename) {
      const entry = [...tasks.values()].reverse().find(
        (t) => ((t.output_manifest && t.output_manifest.files) || []).some((f) => f.name === filename)
      );
      if (!entry) return '';
      const grant = await grantFor(entry, 'download');
      return grant.endpoint.replace(/\/+$/, '') +
        '/gw/tasks/' + entry.id + '/output/' + encodeURIComponent(filename) +
        '?grant=' + encodeURIComponent(grant.token);
    },

    async runtimeUploadImage(...args) {
      // Canonical: { baseUrl, fileName, dataBase64, type, subfolder }.
      // Positional (name, bytes) is what this file's interceptor passes.
      const payload = asPayload(args, ['fileName', 'dataBase64']);
      const name = payload.fileName ?? payload.name;
      let bytes = payload.bytes;
      if (bytes == null && typeof payload.dataBase64 === 'string') {
        const bin = atob(payload.dataBase64.replace(/^data:[^,]*,/, ''));
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
        bytes = buf.buffer;
      } else if (bytes == null) {
        bytes = payload.dataBase64;
      }
      // Uploads happen before the task exists, so they are queued here and
      // attached when the task is created. The gateway PUT then targets the
      // worker the scheduler picked.
      // Sanitising a name can destroy it: 参考图.png and 背景图.png both become
      // ___.png, and the second would silently overwrite the first. When the
      // name actually changed, give it a short suffix derived from the original
      // so two different files stay two different files.
      const raw = String(name || 'reference.png');
      const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
      let safe = cleaned;
      if (cleaned !== raw) {
        let h = 0;
        for (let i = 0; i < raw.length; i += 1) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
        const tag = h.toString(36).slice(0, 6);
        const dot = cleaned.lastIndexOf('.');
        safe = dot > 0
          ? cleaned.slice(0, dot) + '_' + tag + cleaned.slice(dot)
          : cleaned + '_' + tag;
      }
      // The gateway stores and serves only names that start with a letter or digit (isSafeFilename).
      // A name with no ASCII at all, 白衣女.png say, cleaned to ____<tag>.png: the control plane took
      // the task, every upload of the file came back 400, the node waited two minutes for it, and the
      // panel said only 下发失败. Give such a name an ASCII head instead.
      if (!/^[A-Za-z0-9]/.test(safe)) safe = 'ref-' + safe.replace(/^[._-]+/, '');
      pendingUploads.push({ name: safe, bytes: (bytes && bytes.byteLength) || 0, kind: 'image' });
      uploads.set(safe, { bytes: bytes });
      return { ok: true, status: 200, result: { name: safe, subfolder: '', type: 'input' } };
    },

    // ---- account ----------------------------------------------------------
    async clientAuthStatus() {
      const checkedSession = currentSession();
      if (!checkedSession) return { ok: true, result: { authenticated: false } };
      try {
        const me = await control('GET', '/api/web/me');
        return {
          ok: true,
          result: { authenticated: true, user: me.user, credits: me.credits }
        };
      } catch (error) {
        if (error.status === 401 || error.status === 403) {
          const latest = currentSession();
          if (latest?.token && latest.token !== checkedSession.token) {
            return { ok: true, result: { authenticated: true, user: latest.user || null } };
          }
          saveSession(null);
          try { root.localStorage.removeItem(CLIENT_AUTH_KEY); } catch (_) {}
          return { ok: true, result: { authenticated: false } };
        }
        // A temporary control-plane/network failure is not a logout. The
        // next status probe can retry with the same signed session.
        const active = currentSession();
        return { ok: true, result: { authenticated: !!active, user: active?.user || null, temporarilyUnavailable: true } };
      }
    },

    async clientAuthLogin(payload) {
      try {
        const res = await auth('POST', '/api/auth/login', {
          account: (payload && (payload.account || payload.email)) || '',
          password: (payload && payload.password) || ''
        });
        saveSession({ token: res.session.token, user: res.user });
        try { root.localStorage.setItem(CLIENT_AUTH_KEY, JSON.stringify(res)); } catch (_) {}
        return { ok: true, result: res };
      } catch (error) {
        return { ok: false, error: String(error.message || error) };
      }
    },

    async clientAuthLogout() {
      saveSession(null);
      try { root.localStorage.removeItem(CLIENT_AUTH_KEY); } catch (_) {}
      return { ok: true, result: { authenticated: false } };
    },

    // Web account dialog: read the real credit/quota snapshot from the account
    // service, rather than the compute control plane's capability snapshot.
    async clientAuthAccountDetails() {
      if (!currentSession()) return { ok: false, httpStatus: 401, error: '请先登录账号' };
      try {
        const profile = await auth('GET', '/api/client/bootstrap');
        if (profile.ok === false) return { ok: false, error: profile.error || '账户信息读取失败' };
        return { ok: true, result: { user: profile.user, credits: profile.credits, providerQuotas: profile.providerQuotas } };
      } catch (error) {
        return { ok: false, httpStatus: error.status, error: String(error.message || error) };
      }
    },

    async runtimeFeatures() {
      runtimeFeatureCheckedAt = Date.now();
      let answered = false;
      try {
        const caps = await control('GET', '/api/web/capabilities');
        const next = caps && caps.features && typeof caps.features === 'object' ? { ...caps.features } : {};
        if (taskMode() === 'shared' && next.qwenImage21 !== true && !drawingNodeOnline(caps)) next.qwenImage21 = true;
        else answered = true;
        const changed = JSON.stringify(next) !== JSON.stringify(runtimeFeatureCache);
        runtimeFeatureCache = next;
        // Panels drawn before the answer arrived (drawing controls, UI-design limits) redraw on this.
        if (changed && typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
          root.dispatchEvent(new root.CustomEvent('novaflow:runtime-features', { detail: { ...next } }));
        }
      } catch (_) { /* keep the last answer */ }
      if (answered && runtimeFeatureCache.qwenImage21 === true) runtimeFeatureRetries = 0;
      else scheduleRuntimeFeatureRetry();
      return { ...runtimeFeatureCache };
    },
    runtimeFeaturesSync() {
      return { ...runtimeFeatureCache };
    },

    async clientAuthBootstrap() {
      try {
        const me = await control('GET', '/api/web/me');
        const caps = await control('GET', '/api/web/capabilities');
        return {
          ok: true,
          result: {
            user: me.user,
            credits: me.credits,
            ai: { ok: true, result: { providers: [], models: caps.models || [], settings: {} } }
          }
        };
      } catch (error) {
        return { ok: false, error: String(error.message || error) };
      }
    },

    // ---- capabilities the Web line does not have --------------------------
    // Declared so the renderer's feature checks pass, and answered honestly so
    // a panel that depends on one says why instead of hanging.
    licenseGetState: async () => computeMode === 'local' ? localControl('GET', '/local/license') : ({
      ok: true,
      result: { state: 'web', authorized: true, permissions: ['web'] }
    }),
    runtimeOpenOutputFolder: async () => root.NovaFlowWebWarehouse
      ? root.NovaFlowWebWarehouse.open() : ({ ok: false, error: '仓库组件未加载，请刷新网页后重试' }),
    runtimeFreeMemory: async () => ({ ok: true, result: {} }),
    promptAssistantGetStatus: async () => computeMode === 'local'
      ? localControl('GET', '/local/prompt-assistant/status').catch(error => ({ ok: false, enabled: false, error: String(error.message || error) }))
      : ({ ok: true, result: { available: false, reason: 'web' } }),
    promptAssistantOptimizePrompt: async (payload) => localPromptAssistant('optimize-prompt', payload),
    promptAssistantReverseImagePrompt: async (payload) => localPromptAssistant('reverse-image-prompt', payload),
    // 万物迁移 names the scene's style from this when it exists and paints
    // without it otherwise; only a machine with the model should offer it.
    ...(computeMode === 'local' ? { promptAssistantDescribeArtStyle: async (payload) => localPromptAssistant('describe-art-style', payload) } : {}),

    async smartAiPromptOptimize(payload) {
      try { return { ok: true, result: await auth('POST', '/api/client/grok/prompt-optimize', payload) }; }
      catch (error) { return { ok: false, error: String(error.message || error) }; }
    },
    async smartAiImageReverse(payload) {
      try { return { ok: true, result: await auth('POST', '/api/client/grok/image-reverse', payload) }; }
      catch (error) { return { ok: false, error: String(error.message || error) }; }
    },

    async qwenLoraCatalog(payload = {}) {
      try { return await control('GET', '/api/web/loras/qwen?nsfw=' + (payload.nsfw === true) + (payload.engine === 'qwen-2.1' ? '&engine=qwen-2.1' : '')); }
      catch (error) { return { ok: false, error: String(error.message || error), items: [] }; }
    },
    async minimaxH3LoraCatalog(payload = {}) {
      try { return await control('GET', '/api/web/loras/h3?mode=' + encodeURIComponent(payload.mode || 'i2v') + '&steps=' + encodeURIComponent(payload.steps || 4)); }
      catch (error) { return { ok: false, error: String(error.message || error), items: [] }; }
    },
    async minimaxH3LoraValidate(payload) {
      try { return await control('POST', '/api/web/loras/h3/validate', payload); }
      catch (error) { return { ok: false, error: String(error.message || error) }; }
    },
    async minimaxH3OutputPublish(payload) {
      const task = tasks.get(String(payload && payload.promptId || ''));
      const filename = String(payload && payload.filename || '');
      const file = task && ((task.output_manifest && task.output_manifest.files) || []).find(f => f.name === filename);
      if (!file || !/\.(mp4|webm)$/i.test(filename)) return { ok: false, error: '找不到当前任务的视频结果' };
      // Match the history preview identity so publishing updates its resource
      // card instead of displaying a second copy of the same output.
      const id = task.id + ':output::' + filename;
      const item = {
        id, runtimeKind: 'minimax_h3_local', type: 'local', promptId: task.id,
        fileName: filename, localPath: 'web-output://' + task.id + '/' + encodeURIComponent(filename),
        mimeType: mimeFor(filename), sourceKind: 'minimax_h3_output', createdAt: Date.now(),
        mediaDurationSec: payload.mediaDurationSec, generationElapsedSec: payload.generationElapsedSec
      };
      videoOutputs.delete(id);
      videoOutputs.set(id, item);
      while (videoOutputs.size > 30) videoOutputs.delete(videoOutputs.keys().next().value);
      return { ok: true, item };
    },
    async minimaxH3OutputList() {
      return { ok: true, items: [...videoOutputs.values()].reverse() };
    },
    async aiSeqReadTempFile(payload) {
      const item = [...videoOutputs.values()].find(value => value.localPath === String(payload && payload.path || ''));
      if (!item) return { ok: false, error: '当前页面没有此临时视频' };
      const reply = await electronAPI.runtimeRequestBinary({ path: '/view?filename=' + encodeURIComponent(item.fileName) });
      return reply.ok ? { ok: true, bytes: new Uint8Array(reply.result.data), mimeType: item.mimeType } : reply;
    },

    runtimeProviderUsageSettlement: 'web-control-plane-v1'
  };

  // ------------------------------------------------- local runtime probes
  //
  // The AI-sequence panel checks whether a ComfyUI is up before it lets you
  // generate. For images it asks through electronAPI, which we override. For
  // VIDEO it does not: it fetches http://127.0.0.1:8189/system_stats straight
  // from the page. On the desktop that is the right question. On the Web it
  // asks the VIEWER's machine - which has no runtime, and never will - so a
  // friend opening the site was told "未找到 MiniMax H3 Runtime（8189），
  // 请确认已安装并启动" about software they are not supposed to install.
  //
  // The honest answer to "is there a runtime" on the Web is "is there a
  // capable machine in the pool", so that is what these probes are answered
  // with. Only the two runtime ports are intercepted; the worker gateway on
  // 8790 and everything else goes through untouched.
  const LOCAL_RUNTIME = /^https?:\/\/(?:127\.0\.0\.1|localhost):(8188|8189)(\/|$)/i;
  const PORT_TASK_TYPE = { 8188: 'qwen_t2i', 8189: 'h3_i2v' };

  let capsCache = { at: 0, byTaskType: {} };
  async function poolHas(taskType) {
    if (Date.now() - capsCache.at > 8000) {
      try {
        const caps = await control('GET', '/api/web/capabilities');
        const byTaskType = {};
        for (const t of caps.taskTypes || []) byTaskType[t.task_type] = Number(t.available_workers || 0);
        capsCache = { at: Date.now(), byTaskType };
      } catch (_) {
        capsCache = { at: Date.now(), byTaskType: {} };
      }
    }
    return Number(capsCache.byTaskType[taskType] || 0);
  }

  const nativeFetch = root.fetch.bind(root);
  root.fetch = async function (input, init) {
    const url = String(input && input.url ? input.url : input || '');
    const m = LOCAL_RUNTIME.exec(url);
    if (!m) return nativeFetch(input, init);

    const port = m[1];
    const taskType = PORT_TASK_TYPE[port];
    const path = url.slice(url.indexOf(port) + port.length).split('?')[0] || '/';

    // Reference images. Same shape of bug as the probe: the panel POSTs the
    // file straight to http://127.0.0.1:8189/upload/image instead of going
    // through electronAPI.runtimeUploadImage, so the override never applied
    // and the file was offered to a ComfyUI on the viewer's machine - which
    // is not where the task will run even when one is there.
    //
    // Route it to the same queue runtimeUploadImage feeds, so the bytes end up
    // on whichever worker the scheduler picks, and answer in the shape the
    // caller reads back ({ data: { name } }).
    if (path === '/upload/image' || path === '/api/upload/image' || path === '/upload/mask') {
      try {
        const form = init && init.body ? init.body : (input && input.body);
        let file = null;
        let filename = 'reference.png';
        if (form && typeof form.get === 'function') {
          file = form.get('image') || form.get('file') || form.get('mask');
          if (file && file.name) filename = file.name;
        }
        if (!file || typeof file.arrayBuffer !== 'function') {
          return new Response(JSON.stringify({ error: '上传内容读不出来（没有找到图片字段）' }),
            { status: 400, headers: { 'content-type': 'application/json' } });
        }
        const bytes = await file.arrayBuffer();
        const res = await electronAPI.runtimeUploadImage(filename, bytes);
        if (!res || !res.ok) {
          return new Response(JSON.stringify({ error: String((res && res.error) || '上传失败') }),
            { status: 502, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          name: res.result.name,
          subfolder: res.result.subfolder || '',
          type: res.result.type || 'input'
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      } catch (error) {
        return new Response(JSON.stringify({ error: String(error && error.message ? error.message : error) }),
          { status: 500, headers: { 'content-type': 'application/json' } });
      }
    }

    if (path === '/system_stats' || path === '/') {
      const workers = await poolHas(taskType);
      if (!workers) {
        // Fail the probe, so the panel does not offer to generate on compute
        // that is not there. The wording the panel shows is rewritten for the
        // Web build; see tools/build-web-renderer.mjs.
        return new Response(JSON.stringify({ ok: false, error: 'no capable compute node online' }),
          { status: 503, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        system: {
          os: 'novaflow-web',
          comfyui_version: 'novaflow-web-pool',
          python_version: '',
          ram_total: 0,
          ram_free: 0
        },
        devices: [{ name: workers + ' 台算力节点', type: 'cuda', index: 0, vram_total: 0, vram_free: 0 }]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    // Video panels use fetch directly. Route submission, polling and output
    // downloads through the same adapter as the image tools, keeping queries.
    const target = new URL(url);
    const cleanPath = target.pathname.replace(/^\/api\//, '/');
    if (cleanPath === '/view') {
      const reply = await electronAPI.runtimeRequestBinary({ baseUrl: target.origin, path: target.pathname + target.search });
      return new Response(reply.ok ? reply.result.data : JSON.stringify({ error: reply.error }), {
        status: reply.ok ? 200 : (reply.status || 502),
        headers: { 'content-type': reply.ok ? reply.contentType : 'application/json' }
      });
    }
    if (/^\/(?:prompt|history(?:\/[^/]+)?|queue|interrupt)$/.test(cleanPath)) {
      let requestInit = init || {};
      if (input && typeof input.clone === 'function' && !init) {
        requestInit = { method: input.method };
        if (!/^(GET|HEAD)$/i.test(input.method)) requestInit.body = await input.clone().text();
      }
      const reply = await electronAPI.runtimeRequestJson({ baseUrl: target.origin, path: target.pathname + target.search, init: requestInit });
      return new Response(JSON.stringify(reply.ok ? reply.data : { error: reply.error }), {
        status: reply.status || (reply.ok ? 200 : 502), headers: { 'content-type': 'application/json' }
      });
    }

    // Anything else aimed at a local runtime is a request this browser has no
    // business making. Say so rather than letting it hang on a dead port.
    return new Response(JSON.stringify({
      ok: false,
      error: 'NovaFlow Web 不在浏览器里访问本机 ComfyUI；该请求应由算力节点执行'
    }), { status: 503, headers: { 'content-type': 'application/json' } });
  };

  // ------------------------------------------------------------------ expose
  // These are the proxy-electron-api contracts the existing UI consumes.
  // Keep result for compatibility, but data is what the editor actually reads.
  for (const name of ['runtimeRequestJson', 'runtimeGetSystemStats', 'runtimeUploadImage']) {
    const implementation = electronAPI[name];
    electronAPI[name] = async function (...args) {
      const reply = await implementation(...args);
      if (reply && reply.ok && reply.result !== undefined) reply.data = reply.result;
      return reply;
    };
  }
  // Override, never replace. Anything the renderer's own implementation
  // provides and we do not is left alone.
  const existing = root.electronAPI || (root.electronAPI = {});
  const overridden = [];
  for (const [key, value] of Object.entries(electronAPI)) {
    if (typeof existing[key] !== 'undefined') overridden.push(key);
    existing[key] = value;
  }
  root.__novaflowWebOverrides = overridden;

  root.NovaFlowWebRuntime = {
    config: CONFIG,
    version: '0.2.0',

    /** Called by every redacted graph builder. */
    serverOnly(module, fn, args) {
      const options = module === 'spine-split-runtime' || module === 'novaflow-brand-runtime'
        ? { __args: Array.from(args || []) }
        : args && args[0];
      const intent = recordIntent({ module: module, method: fn, options });
      const marker = {
        __novaflowServerOnly: true,
        module: intent.module,
        fn: intent.method,
        options: intent.options
      };

      // Callers disagree about what a builder returns, because on the desktop
      // getWorkflowJson() hands back a JSON STRING while other paths use the
      // graph object. A plain object broke the video panel with
      //   workflow JSON 解析失败："[object Object]" is not valid JSON
      // because it does JSON.parse on the result.
      //
      // So this is both: a String carrying the JSON text, with the marker's
      // own properties on it. JSON.parse(result) works, result.module works,
      // and isIntent() still recognises it.
      let out;
      try {
        out = new String(JSON.stringify(marker));
        Object.assign(out, marker);
      } catch (_) {
        return marker;
      }
      return out;
    },

    /** Called by the generated stubs. */
    recordWorkflowIntent(intent) {
      return recordIntent(intent);
    },

    recordArtReferenceControl(workflow, uploadedNames, rolePlan) {
      if (!isIntent(workflow)) throw new Error('missing Web art workflow intent');
      workflow.options.__controlNet = rolePlan;
      return { applied: 0 };
    },

    get lastWorkflowIntent() { return lastIntent; },
    get session() { return session; },
    setSession: saveSession,
    tasks: tasks,
    control: control,
    localControl,
    // Exposed for capability shims that submit their own tasks rather than a
    // recorded graph intent - novaflow-web-capabilities.js's AI 抠图 is the
    // first. They are the module's own helpers, not a new protocol.
    waitForAssignment,
    grantFor,
    putTaskInput,
    fetchTaskOutput,
    get computeMode() { return taskMode(); },
    get localAssistant() { return !!CONFIG.localAssistant; },
    get computeNode() { return computeNode ? { id: computeNode.id, name: computeNode.name } : null; },
    // Pin work to one pool node (null: back to the launcher's default). Remembered per browser.
    setComputeNode(node) {
      const next = node && NODE_ID.test(String(node.id)) ? { id: String(node.id), name: String(node.name || '') } : null;
      computeNode = next;
      try {
        if (next) root.localStorage.setItem(NODE_KEY, JSON.stringify(next));
        else root.localStorage.removeItem(NODE_KEY);
      } catch (_) { /* private mode */ }
      // Every cached answer spoke for the previous source.
      capsCache = { at: 0, byTaskType: {} };
      runtimeFeatureCache = taskMode() === 'shared' ? { qwenImage21: true } : {};
      runtimeFeatureRetries = 0;
      electronAPI.runtimeFeatures();
      if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
        root.dispatchEvent(new root.CustomEvent('novaflow:compute-node', { detail: next }));
      }
      return next;
    },
    listComputeNodes: () => control('GET', '/api/web/nodes'),
    auth: auth,
    fileUrl: (name) => electronAPI.runtimeFileUrl(name),
    isWeb: true
  };
  // Warm the feature snapshot so panels that size themselves synchronously
  // (the UI-design reference limit) see the node's answer; runs re-check it.
  electronAPI.runtimeFeatures();
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('focus', () => {
      if (Date.now() - runtimeFeatureCheckedAt > 10000) electronAPI.runtimeFeatures();
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
