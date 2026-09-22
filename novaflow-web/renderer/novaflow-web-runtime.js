// NovaFlow Web Runtime.
//
// This is the whole Electron-to-Web adapter. It loads BEFORE
// proxy-electron-api.js, publishes a complete `window.electronAPI`, and so
// wins the capability check that file performs - the renderer above it never
// learns it is not running in Electron.
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

  // ---------------------------------------------------------------- session
  let session = null;
  try {
    session = JSON.parse(root.localStorage.getItem(SESSION_KEY) || 'null');
  } catch (_) { session = null; }

  function saveSession(next) {
    session = next;
    try {
      if (next) root.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      else root.localStorage.removeItem(SESSION_KEY);
    } catch (_) { /* private mode */ }
  }

  function authHeaders(extra) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    if (session && session.token) headers.Authorization = 'Bearer ' + session.token;
    return headers;
  }

  async function api(base, method, path, body) {
    const res = await fetch(base.replace(/\/+$/, '') + path, {
      method: method,
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

  const control = (method, path, body) => api(CONFIG.controlUrl, method, path, body);
  const auth = (method, path, body) => api(CONFIG.authUrl, method, path, body);

  // ------------------------------------------------------- workflow intents
  //
  // A redacted builder calls serverOnly(); we remember the most recent intent
  // per module so the matching /prompt submission can pick it up. Keyed by
  // module because a panel may prepare one workflow while another is running.
  const intents = new Map();
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

    const task = await control('POST', '/api/web/tasks', {
      task_type: 'renderer_workflow',
      workflow: { module: intent.module, method: intent.method },
      parameters: intent.options || {},
      references: pendingUploads.splice(0, pendingUploads.length)
    });

    const promptId = task.task.id;
    tasks.set(promptId, task.task);
    root.NovaFlowWebRuntime.lastTask = task.task;
    return { prompt_id: promptId, number: tasks.size, node_errors: {} };
  }

  // ------------------------------------------------------------ the adapter
  //
  // Mirrors the shape proxy-electron-api.js probes for, so the renderer's
  // capability check passes and it never installs its loopback fallback.
  const electronAPI = {
    // ---- ComfyUI runtime proxy -------------------------------------------
    async runtimeGetSystemStats() {
      try {
        const caps = await control('GET', '/api/web/capabilities');
        const workers = session ? await control('GET', '/api/web/workers') : { workers: [] };
        const online = (workers.workers || []).filter((w) => w.status === 'idle' || w.status === 'busy');
        return {
          ok: true,
          result: {
            system: {
              os: 'web',
              comfyui_version: 'novaflow-web/' + caps.protocol,
              ram_total: 0, ram_free: 0
            },
            devices: online.map((w) => ({
              name: w.gpu_name,
              type: 'cuda',
              vram_total: (w.vram_mb || 0) * 1024 * 1024,
              vram_free: (w.vram_mb || 0) * 1024 * 1024
            }))
          }
        };
      } catch (error) {
        return { ok: false, error: String(error.message || error) };
      }
    },

    async runtimeRequestJson(baseUrl, path, init) {
      const method = String((init && init.method) || 'GET').toUpperCase();
      const clean = String(path || '').split('?')[0].replace(/\/+$/, '');
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

        if (clean === '/object_info' || clean.startsWith('/object_info')) {
          // Node metadata is topology. The renderer only uses it to populate
          // model dropdowns, which the control plane answers instead.
          const caps = await control('GET', '/api/web/capabilities');
          return { ok: true, status: 200, result: caps.objectInfo || {} };
        }

        if (clean === '/system_stats') {
          const stats = await electronAPI.runtimeGetSystemStats();
          return { ok: stats.ok, status: stats.ok ? 200 : 503, result: stats.result };
        }

        void query;
        return { ok: false, status: 404, error: 'NovaFlow Web does not proxy ' + clean };
      } catch (error) {
        return { ok: false, status: error.status || 500, error: String(error.message || error) };
      }
    },

    async runtimeRequestBinary(baseUrl, path) {
      const query = new URLSearchParams(String(path).split('?')[1] || '');
      const filename = query.get('filename');
      if (!filename) return { ok: false, error: 'missing filename' };

      const entry = [...tasks.values()].find(
        (t) => ((t.output_manifest && t.output_manifest.files) || []).some((f) => f.name === filename)
      );
      if (!entry) return { ok: false, error: 'unknown output file: ' + filename };

      try {
        const grant = await grantFor(entry, 'download');
        const url = grant.endpoint.replace(/\/+$/, '') +
          '/gw/tasks/' + entry.id + '/output/' + encodeURIComponent(filename) +
          '?grant=' + encodeURIComponent(grant.token);
        const res = await fetch(url);
        if (!res.ok) return { ok: false, error: 'gateway returned ' + res.status };
        const buffer = await res.arrayBuffer();
        return {
          ok: true,
          result: {
            data: buffer,
            contentType: res.headers.get('content-type') || 'application/octet-stream',
            url: url
          }
        };
      } catch (error) {
        return { ok: false, error: String(error.message || error) };
      }
    },

    /** A URL an <img>/<video> can use directly, with the grant in the query. */
    async runtimeFileUrl(filename) {
      const entry = [...tasks.values()].find(
        (t) => ((t.output_manifest && t.output_manifest.files) || []).some((f) => f.name === filename)
      );
      if (!entry) return '';
      const grant = await grantFor(entry, 'download');
      return grant.endpoint.replace(/\/+$/, '') +
        '/gw/tasks/' + entry.id + '/output/' + encodeURIComponent(filename) +
        '?grant=' + encodeURIComponent(grant.token);
    },

    async runtimeUploadImage(name, bytes) {
      // Uploads happen before the task exists, so they are queued here and
      // attached when the task is created. The gateway PUT then targets the
      // worker the scheduler picked.
      const safe = String(name || 'reference.png').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
      pendingUploads.push({ name: safe, bytes: (bytes && bytes.byteLength) || 0, kind: 'image' });
      uploads.set(safe, { bytes: bytes });
      return { ok: true, result: { name: safe, subfolder: '', type: 'input' } };
    },

    // ---- account ----------------------------------------------------------
    async clientAuthStatus() {
      if (!session) return { ok: true, result: { authenticated: false } };
      try {
        const me = await control('GET', '/api/web/me');
        return {
          ok: true,
          result: { authenticated: true, user: me.user, credits: me.credits }
        };
      } catch (_) {
        saveSession(null);
        return { ok: true, result: { authenticated: false } };
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
    licenseGetState: async () => ({
      ok: true,
      result: { state: 'web', authorized: true, permissions: ['web'] }
    }),
    runtimeOpenOutputFolder: async () => ({ ok: false, error: 'Web 版没有本地输出目录，请用下载按钮' }),
    runtimeFreeMemory: async () => ({ ok: true, result: {} }),
    promptAssistantGetStatus: async () => ({ ok: true, result: { available: false, reason: 'web' } }),
    promptAssistantOptimizePrompt: async () => ({ ok: false, error: '提示词助手在 Web 版通过智能 AI 提供' }),
    promptAssistantReverseImagePrompt: async () => ({ ok: false, error: '提示词助手在 Web 版通过智能 AI 提供' }),

    async smartAiPromptOptimize(payload) {
      try { return { ok: true, result: await auth('POST', '/api/client/grok/prompt-optimize', payload) }; }
      catch (error) { return { ok: false, error: String(error.message || error) }; }
    },
    async smartAiImageReverse(payload) {
      try { return { ok: true, result: await auth('POST', '/api/client/grok/image-reverse', payload) }; }
      catch (error) { return { ok: false, error: String(error.message || error) }; }
    },

    qwenLoraCatalog: async () => ({ ok: true, result: { loras: [] } }),
    minimaxH3LoraCatalog: async () => ({ ok: true, result: { loras: [] } }),
    minimaxH3LoraValidate: async () => ({ ok: true, result: { valid: true } }),
    minimaxH3OutputPublish: async () => ({ ok: false, error: 'Web 版暂不提供仓库' }),
    minimaxH3OutputList: async () => ({ ok: true, result: { items: [] } }),

    runtimeProviderUsageSettlement: 'web-control-plane-v1'
  };

  // ------------------------------------------------------------------ expose
  root.electronAPI = Object.assign({}, root.electronAPI || {}, electronAPI);

  root.NovaFlowWebRuntime = {
    config: CONFIG,
    version: '0.2.0',

    /** Called by every redacted graph builder. */
    serverOnly(module, fn, args) {
      const intent = recordIntent({ module: module, method: fn, options: args && args[0] });
      return { __novaflowServerOnly: true, module: intent.module, fn: intent.method, options: intent.options };
    },

    /** Called by the generated stubs. */
    recordWorkflowIntent(intent) {
      return recordIntent(intent);
    },

    get lastWorkflowIntent() { return lastIntent; },
    get session() { return session; },
    setSession: saveSession,
    tasks: tasks,
    control: control,
    auth: auth,
    fileUrl: (name) => electronAPI.runtimeFileUrl(name),
    isWeb: true
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
