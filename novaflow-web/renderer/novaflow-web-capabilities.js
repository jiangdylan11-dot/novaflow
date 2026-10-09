// Web equivalents for NovaFlow's Electron-only capabilities.
//
// The renderer reaches for 23 electronAPI methods. novaflow-web-runtime.js
// covers the ComfyUI proxy and the account; this file covers the rest - file
// dialogs, video compositing, cache management, runtime status.
//
// The rule followed here: find a real Web equivalent, and where the platform
// genuinely cannot do the same thing, say so in the returned error rather than
// failing silently or pretending it worked. Every such case is listed in
// docs/LIMITATIONS.md.
//
//   Electron                     Web
//   ---------------------------  --------------------------------------------
//   save dialog                  File System Access API, <a download> fallback
//   open folder (PS project)     showDirectoryPicker, <input webkitdirectory>
//   webUtils.getPathForFile      a handle token (a browser has no OS paths)
//   ffmpeg video compositor      canvas + MediaRecorder (WebM)
//   open output folder           mapped local-folder browser and save queue
//   temp file cache              in-memory blobs with the same keys
//   runtime status               the worker pool's health

(function (root) {
  'use strict';

  const api = root.electronAPI || (root.electronAPI = {});
  const runtime = root.NovaFlowWebRuntime;
  if (!runtime) {
    console.warn('[novaflow-web] capabilities loaded before the runtime; skipping');
    return;
  }

  const ok = (result) => ({ ok: true, result });
  const fail = (error, extra) => Object.assign({ ok: false, error: String(error) }, extra || {});
  // vendor/ sits next to this script; index.html loads it as ./novaflow-web-capabilities.js.
  const capabilitiesBase = (() => {
    try {
      const src = root.document && root.document.currentScript && root.document.currentScript.src;
      if (src) return new URL('./', src).href;
      return (root.document && root.document.baseURI) || '';
    } catch (_) {
      return '';
    }
  })();

  // ---------------------------------------------------------- a working cue
  //
  // Long jobs - a 32 MB download the first time a video tool runs, a minute
  // of encoding, a big atlas going through the WebP encoder - get a small card
  // in the corner naming what is running and how far along it is, so a quiet
  // page is never mistaken for a stuck one. It blocks nothing.
  const busy = (() => {
    const tasks = new Map();
    const doc = root.document;
    let host = null;
    function ensureHost() {
      if (host) return host;
      if (!doc || !doc.head || !doc.body || typeof doc.createElement !== 'function') return null;
      const style = doc.createElement('style');
      style.id = 'novaflow-web-busy-style';
      style.textContent = [
        // Centred on the screen, as asked: the eye is on the work, not the corner.
        '#novaflow-web-busy{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483000;display:grid;gap:8px;pointer-events:none;font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif}',
        '#novaflow-web-busy .nf-busy{min-width:300px;max-width:440px;padding:14px 16px;border-radius:12px;background:rgba(29,29,29,.96);border:1px solid #3c3c3c;box-shadow:0 12px 32px rgba(0,0,0,.45);color:#eaeaea;display:grid;gap:8px}',
        '#novaflow-web-busy .nf-busy-row{display:flex;align-items:center;gap:8px;min-width:0}',
        '#novaflow-web-busy .nf-busy-spin{width:14px;height:14px;flex:0 0 14px;border-radius:50%;border:2px solid rgba(255,255,255,.18);border-top-color:#25bc84;animation:nf-busy-spin .8s linear infinite}',
        '#novaflow-web-busy .nf-busy-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '#novaflow-web-busy .nf-busy-bar{height:3px;border-radius:2px;background:rgba(255,255,255,.1);overflow:hidden}',
        '#novaflow-web-busy .nf-busy-bar>i{display:block;height:100%;width:0;background:#25bc84;transition:width .2s linear}',
        // The cutout save shows its own progress dialog (正在合成透明视频…); this box sat behind it.
        'body[data-novaflow-ai-cutout-saving="1"] #novaflow-web-busy{display:none!important}',
        '@keyframes nf-busy-spin{to{transform:rotate(360deg)}}'
      ].join('');
      doc.head.appendChild(style);
      host = doc.createElement('div');
      host.id = 'novaflow-web-busy';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      // The brand runtime rewrites corner radii on new elements; this card
      // keeps its own, so the radius does not flicker while it updates.
      host.setAttribute('data-novaflow-keep-radius', '1');
      doc.body.appendChild(host);
      return host;
    }
    // Each task keeps its card and updates it in place: rebuilding the card on
    // every progress tick made it a new element each time, which the page's
    // styling passes then restyled a beat later - the radius visibly changed.
    function mountCard(task) {
      const node = ensureHost();
      if (!node) return;
      const card = doc.createElement('div');
      card.className = 'nf-busy';
      card.setAttribute('data-novaflow-keep-radius', '1');
      const row = doc.createElement('div');
      row.className = 'nf-busy-row';
      const spin = doc.createElement('span');
      spin.className = 'nf-busy-spin';
      const text = doc.createElement('span');
      text.className = 'nf-busy-text';
      row.appendChild(spin);
      row.appendChild(text);
      card.appendChild(row);
      const bar = doc.createElement('div');
      bar.className = 'nf-busy-bar';
      const fill = doc.createElement('i');
      bar.appendChild(fill);
      card.appendChild(bar);
      node.appendChild(card);
      task.card = card;
      task.textNode = text;
      task.bar = bar;
      task.fill = fill;
      paintCard(task);
      node.style.display = 'grid';
    }
    function paintCard(task) {
      if (!task.card) return;
      const label = task.text + (task.progress01 == null ? '' : ' ' + Math.round(task.progress01 * 100) + '%');
      if (task.textNode.textContent !== label) task.textNode.textContent = label;
      task.textNode.title = task.text;
      // Kept in the layout: the card is centred, and a bar appearing mid-task moved it up.
      task.bar.style.visibility = task.progress01 == null ? 'hidden' : 'visible';
      if (task.progress01 != null) task.fill.style.width = Math.round(task.progress01 * 100) + '%';
    }
    const clamp01 = (value) => (value == null ? null : Math.max(0, Math.min(1, Number(value) || 0)));
    return {
      begin(id, text, progress01) {
        const key = String(id);
        const existing = tasks.get(key);
        if (existing) { existing.text = String(text || existing.text); existing.progress01 = clamp01(progress01); paintCard(existing); return; }
        const task = { text: String(text || '正在处理…'), progress01: clamp01(progress01), card: null };
        tasks.set(key, task);
        mountCard(task);
      },
      update(id, text, progress01) {
        const task = tasks.get(String(id));
        if (!task) return;
        if (text) task.text = String(text);
        if (progress01 !== undefined) task.progress01 = clamp01(progress01);
        paintCard(task);
      },
      end(id) {
        const task = tasks.get(String(id));
        if (!task) return;
        tasks.delete(String(id));
        if (task.card && task.card.parentNode) task.card.parentNode.removeChild(task.card);
        if (host && !tasks.size) host.style.display = 'none';
      },
      active() { return tasks.size; }
    };
  })();
  runtime.busy = busy;
  root.NovaFlowWebBusy = busy;

  // ---------------------------------------------------------------- listeners
  function channel() {
    const subscribers = new Set();
    return {
      subscribe(fn) {
        if (typeof fn !== 'function') return () => {};
        subscribers.add(fn);
        return () => subscribers.delete(fn);
      },
      emit(payload) {
        for (const fn of subscribers) {
          try { fn(payload); } catch (_) { /* a listener must not break a job */ }
        }
      }
    };
  }

  const compositorProgress = channel();
  const videoToolProgress = channel();

  api.onVideoCompositorProgress = (cb) => compositorProgress.subscribe(cb);
  api.onVideoToolProgress = (cb) => videoToolProgress.subscribe(cb);

  // ------------------------------------------------------------ runtime state
  //
  // On the desktop this is "is ComfyUI running on this machine". On the Web it
  // is "is there an online compute node that can take work" - the same
  // question from the user's point of view, answered by the worker pool.
  let lastWorkerPoll = { at: 0, workers: [] };

  async function pollWorkers(maxAgeMs = 4000) {
    if (Date.now() - lastWorkerPoll.at < maxAgeMs) return lastWorkerPoll.workers;
    try {
      const res = await runtime.control('GET', '/api/web/workers');
      lastWorkerPoll = { at: Date.now(), workers: res.workers || [] };
    } catch (_) {
      lastWorkerPoll = { at: Date.now(), workers: [] };
    }
    return lastWorkerPoll.workers;
  }

  // "Is there compute right now" is read from the PUBLIC capabilities endpoint,
  // not from the worker listing. Two reasons: the listing needs a session, and
  // a user who has not logged in would be told 未连接 while machines are
  // sitting there idle; and which machines they are is nobody's business but
  // the pool owner's. A count is all the app needs to draw its indicator.
  let lastCaps = { at: 0, count: 0 };
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('novaflow:compute-node', () => { lastCaps = { at: 0, count: 0 }; });
  }
  async function pollCapacity(maxAgeMs = 8000) {
    if (Date.now() - lastCaps.at < maxAgeMs) return lastCaps.count;
    try {
      const caps = await runtime.control('GET', '/api/web/capabilities');
      lastCaps = { at: Date.now(), count: Number(caps.available_workers || 0) };
    } catch (_) {
      lastCaps = { at: Date.now(), count: 0 };
    }
    return lastCaps.count;
  }

  api.runtimeGetStatus = async () => {
    const online = await pollCapacity();
    if (!online) {
      return {
        ok: false, status: 'stopped', running: false, connected: false,
        installed: true, detail: '暂无可用算力'
      };
    }
    return {
      ok: true,
      status: 'running',
      running: true,
      connected: true,
      installed: true,
      health: { ok: true },
      workers: online,
      detail: online + ' 台算力可用'
    };
  };

  // A browser cannot start someone else's GPU. The honest answer is the
  // current state plus what the user would have to do.
  api.runtimeEnsureStarted = async () => {
    const status = await api.runtimeGetStatus();
    if (status.running) return status;
    return Object.assign({}, status, {
      detail: 'Web 版无法远程启动算力节点，请让算力提供者打开 NovaFlow Worker'
    });
  };

  api.runtimeStop = async () => ({ ok: false, error: 'Web 版不能停止别人的算力节点' });

  // The desktop calls this to unload its own video sidecar and free VRAM: on leaving 动画 and before
  // a run on the other runtime. The Web has no such sidecar, and a compute node's memory is the
  // node's to manage, so there is nothing to stop. It used to cancel every running task of the user,
  // which killed a generation the moment they switched section. 任务中止 goes through /interrupt.
  api.minimaxH3RuntimeStop = async () => ok({ stopped: false, cancelled: 0 });

  // ------------------------------------------------------------------ license
  //
  // There is no licence gate on the Web. The desktop one binds a licence file
  // to a MACHINE CODE, and a browser tab is not a machine - there is nothing
  // to bind to, no way to issue such a file, and the dialog that asks for one
  // would be a form that can never succeed.
  //
  // So the Web reports licensed, always. That is not a bypass of the desktop's
  // entitlement: what actually costs money here is generation, and every
  // generate call carries a session token that the control plane checks and
  // charges credits for. 导出 and 仓库 act on the user's own canvas in their
  // own browser, which is not something to hold behind a machine licence.
  const WEB_LICENSE = {
    status: 'licensed',
    machineId: 'web',
    mode: 'web-no-license-required',
    permissions: ['export', 'warehouse', 'web'],
    expireAt: null,
    detail: 'NovaFlow Web 不需要授权文件（授权文件绑定机器码，浏览器没有机器码）'
  };

  // The renderer does `result.state ? result.state : result`, so `state` has to
  // be the licence RECORD, not a word. Both shapes carry the same fact.
  api.licenseGetState = async () =>
    Object.assign({ ok: true, authorized: true, state: WEB_LICENSE, detail: WEB_LICENSE.detail }, WEB_LICENSE);

  api.licenseImport = async () =>
    ok(Object.assign({ imported: false, alreadyLicensed: true }, WEB_LICENSE));
  // Clearing a licence that does not exist must not log anyone out: the
  // account session is a separate thing and is dropped from the account panel.
  api.licenseClear = async () => ok(Object.assign({ cleared: false }, WEB_LICENSE));

  api.getAppInfo = async () => ok({
    name: 'NovaFlow Web',
    version: runtime.version,
    platform: 'web',
    userAgent: root.navigator ? root.navigator.userAgent : ''
  });

  api.getSystemMousePosition = async () => ok({ x: 0, y: 0, available: false });

  // ------------------------------------------------------------- file dialogs
  const canUseFileSystemAccess = typeof root.showSaveFilePicker === 'function';

  /**
   * Save bytes to wherever the user chooses.
   *
   * File System Access gives a real "save as" dialog in Chromium. Everywhere
   * else this falls back to a download, which lands in the browser's download
   * folder instead of a chosen path - the user still gets the file, they just
   * do not get to pick the directory.
   */
  api.exportPickSaveFile = async (payload) => {
    const options = payload || {};
    const suggestedName = String(options.defaultPath || options.fileName || 'novaflow-export')
      .split(/[\\/]/).pop();
    const data = options.data || options.buffer || options.bytes;
    const mime = String(options.mimeType || 'application/octet-stream');

    if (!data) {
      // Video callers reserve an output before encoding. This is a warehouse
      // destination, not an OS path; the encoder supplies the bytes later.
      const format = String(options.format || '').toLowerCase();
      if (['mp4', 'webm', 'gif'].includes(format)) {
        const name = videoStem(options.baseName || options.fileName || 'video', 'video') + '.' + format;
        return { ok: true, canceled: false, filePath: 'web-export://video/' + Date.now() + '/' + name, fileName: name, destination: 'warehouse' };
      }
      return fail('Web 版需要在保存时一并提供文件内容', { code: 'web_needs_data' });
    }

    // Tools hand bytes over the way the desktop IPC takes them, as a plain
    // Array; a Blob would write that as text.
    const blob = data instanceof Blob ? data : new Blob([Array.isArray(data) ? Uint8Array.from(data) : data], { type: mime });

    if (canUseFileSystemAccess) {
      try {
        const handle = await root.showSaveFilePicker({
          suggestedName,
          types: options.filters && options.filters.length
            ? options.filters.map((f) => ({
                description: f.name || '',
                accept: { [mime]: (f.extensions || []).map((e) => '.' + String(e).replace(/^\./, '')) }
              }))
            : undefined
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return ok({ saved: true, name: handle.name, via: 'file-system-access' });
      } catch (error) {
        if (error && error.name === 'AbortError') return ok({ canceled: true });
        // Fall through to the download path rather than failing outright.
      }
    }

    const url = URL.createObjectURL(blob);
    const a = root.document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    root.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return ok({ saved: true, name: suggestedName, via: 'download' });
  };

  /**
   * Pick a Photoshop project folder.
   *
   * showDirectoryPicker reads a whole folder with the user's permission. The
   * fallback is a multi-file input with webkitdirectory, which gets the same
   * files without the persistent handle.
   */
  api.openPhotoshopProject = async () => {
    if (typeof root.showDirectoryPicker === 'function') {
      try {
        const dir = await root.showDirectoryPicker({ mode: 'read' });
        const files = [];
        let totalSize = 0;
        const walk = async (folder, prefix, depth) => {
          if (depth > 8) throw new Error('文件夹层级过深');
          for await (const [name, handle] of folder.entries()) {
            const relativePath = prefix + name;
            if (handle.kind === 'directory') {
              await walk(handle, relativePath + '/', depth + 1);
              continue;
            }
            if (handle.kind !== 'file' || !/\.(json|png|jpe?g)$/i.test(name)) continue;
            const file = await handle.getFile();
            totalSize += file.size;
            if (totalSize > 512 * 1024 * 1024) throw new Error('文件太大（超过 512MB）');
            files.push({ name, relativePath, size: file.size, type: file.type, file });
          }
        };
        await walk(dir, '', 0);
        return ok({ directory: dir.name, files, via: 'file-system-access' });
      } catch (error) {
        if (error && error.name === 'AbortError') return ok({ canceled: true });
        if (error && /文件夹层级过深|文件太大/.test(String(error.message || ''))) return fail(String(error.message));
      }
    }

    return await new Promise((resolve) => {
      const input = root.document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.webkitdirectory = true;
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const files = [...(input.files || [])].map((f) => ({
          name: f.name, size: f.size, type: f.type, file: f,
          relativePath: f.webkitRelativePath || f.name
        }));
        input.remove();
        resolve(files.length
          ? ok({ directory: (files[0].relativePath || '').split('/')[0] || '', files, via: 'input-webkitdirectory' })
          : ok({ canceled: true }));
      });
      root.document.body.appendChild(input);
      input.click();
    });
  };

  /**
   * Electron hands back an OS path for a dropped File. A browser deliberately
   * does not, so this returns a stable token the rest of the renderer can use
   * as a key, and keeps the File itself reachable through the token.
   */
  const fileTokens = new Map();
  let fileTokenSeq = 0;
  api.getPathForFile = (file) => {
    if (!file) return '';
    for (const [token, held] of fileTokens) if (held === file) return token;
    fileTokenSeq += 1;
    const token = 'web-file://' + fileTokenSeq + '/' + (file.name || 'file');
    fileTokens.set(token, file);
    return token;
  };
  runtime.fileForToken = (token) => fileTokens.get(String(token)) || null;

  api.runtimeOpenOutputFolder = async () => root.NovaFlowWebWarehouse
    ? root.NovaFlowWebWarehouse.open() : fail('仓库组件未加载，请刷新网页后重试');

  // --------------------------------------------------------- ai sequence cache
  //
  // The desktop parks large intermediates in a temp directory. A tab keeps
  // them as blobs under the same keys, so callers do not change - they just do
  // not survive a reload, which matters less than it sounds because a reload
  // also loses the editor state that referenced them.
  const cache = new Map();
  function releaseCache(key) {
    for (const [id, held] of cache) {
      if (key && key !== id && key !== held.path) continue;
      if (held.path) URL.revokeObjectURL(held.path);
      cache.delete(id);
    }
  }

  api.aiSeqCacheReserveOutput = async (payload) => {
    const key = String((payload && (payload.key || payload.id)) || 'output-' + Date.now());
    releaseCache(key);
    // 视频合并 reserves a resource-list slot before it renders and reads the
    // path back; the export puts its clip under this token.
    const format = String((payload && payload.format) || 'mp4').toLowerCase() === 'webm' ? 'webm' : 'mp4';
    const fileName = String((payload && payload.baseName) || 'novaflow_output').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 80) + '.' + format;
    const path = 'web-video://reserved/' + encodeURIComponent(key) + '/' + fileName;
    cache.set(key, { reservedAt: Date.now(), blob: null, bytes: 0, path, fileName, format });
    return { ...ok({ key, reserved: true, path, fileName }), key, path, fileName, reserved: true };
  };

  api.aiSeqCacheReleaseOutput = async (payload) => {
    const key = String((payload && (payload.key || payload.id)) || '');
    releaseCache(key);
    return ok({ released: true, remaining: cache.size });
  };

  api.aiSeqCacheTempFile = async (payload) => {
    const key = String((payload && (payload.cacheKey || payload.key)) || 'tmp-' + Date.now());
    const data = payload && (payload.bytes || payload.data || payload.buffer);
    if (data == null) return fail('没有可缓存的文件数据');
    const blob = data instanceof Blob ? data : new Blob([data], { type: payload.mimeType || 'application/octet-stream' });
    releaseCache(key);
    const path = URL.createObjectURL(blob);
    cache.set(key, { reservedAt: Date.now(), blob, bytes: blob.size, path });
    // External image providers use this cache bridge as well as Worker outputs.
    if (root.NovaFlowWebWarehouse && /^\["art-output"/.test(key)) {
      await root.NovaFlowWebWarehouse.save({ blob, name: payload.fileName });
    }
    const value = { key, path, bytes: blob.size };
    return { ...ok(value), ...value };
  };

  api.aiSeqCacheCopyFromPath = async (payload) => {
    const options = payload || {};
    const inputPath = String(options.inputPath || options.path || '');
    try {
      const blob = await compositorSourceBlob({ path: inputPath });
      if (!blob) return fail('视频资源已失效，请重新加载或上传视频');
      return await api.aiSeqCacheTempFile({
        bytes: blob,
        mimeType: blob.type || 'video/mp4',
        fileName: options.fileName || 'video.mp4',
        cacheKey: 'video-copy-' + crypto.randomUUID()
      });
    } catch (error) {
      return fail('读取视频资源失败：' + String(error?.message || error));
    }
  };

  api.clearVideoToolOutput = async (payload) => {
    releaseCache();
    releaseVideoOutputs(payload && payload.tool);
    return ok({ cleared: true });
  };
  api.videoResourceMediaRelease = async (payload) => {
    const key = String((payload && (payload.key || payload.id || payload.token)) || '');
    if (key) { releaseCache(key); releaseVideoOutputs(null, key); }
    return ok({ released: true });
  };

  // ---- 工具 → MP4 压缩 / 视频格式转换 ---------------------------------------
  //
  // The desktop runs its bundled ffmpeg (main/mp4-compressor.js and
  // main/video-format-converter.js). Here it is ffmpeg.wasm: the same FFmpeg,
  // compiled to WebAssembly (vendor/ffmpeg, @ffmpeg/ffmpeg 0.12.15 over
  // @ffmpeg/core 0.12.10 - a 32 MB download the first time, then cached by the
  // browser), running in its own worker. The encoder settings are the
  // desktop's, argument for argument, less the log flags the desktop used to
  // read progress from a pipe: ffmpeg.wasm reports progress from its own log.
  //
  // It is single-threaded, so a long clip takes a while - the tools show the
  // percentage. Results are kept as blobs under web-video:// tokens, which is
  // what the tools pass back for previewing, saving and clearing.
  const videoOutputs = new Map();
  // A finished clip also belongs in the 仓库, like a generated one.
  async function saveToWarehouse(blob, name, strict = false) {
    const warehouse = root.NovaFlowWebWarehouse;
    if (!warehouse || typeof warehouse.save !== 'function' || !blob) {
      if (strict) throw new Error('仓库组件未加载，请刷新网页后重试');
      return;
    }
    try {
      const result = await warehouse.save({ blob, name: String(name || 'video.mp4') });
      if (strict && (!result || (result.ok === false && !result.pending))) throw new Error(result?.error || '结果入库失败');
      return result;
    } catch (error) {
      if (strict) throw error;
      console.warn('[NovaFlow web] 仓库保存失败', error);
    }
  }
  // The preview registration in the next block reads results from here.
  runtime.videoOutputs = videoOutputs;
  let videoOutputSeq = 0;
  function releaseVideoOutputs(tool, token) {
    for (const [key, held] of videoOutputs) {
      if (tool && held.tool !== tool) continue;
      if (token && held.token !== token && key !== token) continue;
      if (held.url) URL.revokeObjectURL(held.url);
      videoOutputs.delete(key);
    }
  }
  const FFMPEG_VENDOR_VERSION = '0.12.15';
  const ffmpegVendorUrl = (file) => new URL('vendor/ffmpeg/' + file + '?v=' + FFMPEG_VENDOR_VERSION, capabilitiesBase || root.location.href).href;
  let ffmpegPromise = null;
  let ffmpegJob = null;
  // Progress and log lines belong to the job that is running; the tools get
  // the progress by job id, the log feeds the audio probe and error text.
  function listenToFfmpeg(ffmpeg) {
    ffmpeg.on('progress', (event) => {
      if (!ffmpegJob || !event) return;
      const progress01 = Math.max(0, Math.min(1, Number(event.progress) || 0));
      if (Math.abs(progress01 - ffmpegJob.last) < 0.01 && progress01 < 1) return;
      ffmpegJob.last = progress01;
      videoToolProgress.emit({ jobId: ffmpegJob.jobId, progress01 });
      busy.update(ffmpegJob.jobId, ffmpegJob.label, progress01);
    });
    ffmpeg.on('log', (event) => { if (ffmpegJob && event && event.message) ffmpegJob.log = (ffmpegJob.log + '\n' + event.message).slice(-4000); });
    return ffmpeg;
  }
  // The site carries the 32 MB core in parts (static hosts stop at 25 MiB a
  // file; build-web-renderer.mjs splits it and writes the manifest). They are
  // stitched back together here and handed to the worker as a blob URL, the
  // way ffmpeg.wasm's own toBlobURL does. Without a manifest the whole file
  // is fetched as-is.
  const formatMb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' MB';
  /** A download that reports as it goes: the browser caches the bytes, so only the first run waits. */
  async function fetchCounting(url, onBytes) {
    const response = await root.fetch(url);
    if (!response.ok) throw new Error('下载失败（' + response.status + '）');
    if (!response.body || typeof response.body.getReader !== 'function') return new Uint8Array(await response.arrayBuffer());
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onBytes(value.length);
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    return out;
  }
  async function ffmpegWasmUrl() {
    const whole = ffmpegVendorUrl('core/ffmpeg-core.wasm');
    const manifestResponse = await root.fetch(ffmpegVendorUrl('core/ffmpeg-core.wasm.parts.json'));
    if (!manifestResponse.ok) return whole;
    const manifest = await manifestResponse.json();
    const parts = Array.isArray(manifest && manifest.parts) ? manifest.parts : [];
    if (!parts.length) return whole;
    const total = Number(manifest.bytes) || 0;
    let received = 0;
    const report = () => busy.update('ffmpeg-load', '正在下载视频处理组件（首次）' + formatMb(received) + (total ? ' / ' + formatMb(total) : ''), total ? received / total : null);
    report();
    const buffers = await Promise.all(parts.map(async (name) => {
      try {
        return await fetchCounting(ffmpegVendorUrl('core/' + name), (bytes) => { received += bytes; report(); });
      } catch (error) {
        throw new Error('下载 ffmpeg 组件分片失败（' + name + '：' + String((error && error.message) || error) + '）');
      }
    }));
    const joinedBytes = buffers.reduce((sum, part) => sum + part.length, 0);
    if (total && joinedBytes !== total) throw new Error('ffmpeg 组件分片不完整：' + joinedBytes + ' / ' + total + ' 字节');
    const joined = new Uint8Array(joinedBytes);
    let offset = 0;
    for (const part of buffers) { joined.set(part, offset); offset += part.length; }
    return URL.createObjectURL(new Blob([joined], { type: 'application/wasm' }));
  }
  function loadFfmpeg() {
    if (!ffmpegPromise) {
      ffmpegPromise = (async () => {
        // Tests hand in a stand-in instead of the 32 MB core.
        if (root.NovaFlowWebFfmpeg) return listenToFfmpeg(root.NovaFlowWebFfmpeg);
        if (typeof root.WebAssembly !== 'object' || typeof root.Worker !== 'function') throw new Error('这个浏览器不支持 WebAssembly 线程，无法在网页里处理视频');
        busy.begin('ffmpeg-load', '正在加载视频处理组件…');
        try {
          const probe = await root.fetch(ffmpegVendorUrl('core/ffmpeg-core.js'), { method: 'HEAD' });
          if (!probe.ok) throw new Error('站点没有打包 ffmpeg 组件（vendor/ffmpeg/core），请运行 tools/fetch-ffmpeg-core.mjs 后重新发布');
          const { FFmpeg } = await import(ffmpegVendorUrl('index.js'));
          const ffmpeg = listenToFfmpeg(new FFmpeg());
          const wasmURL = await ffmpegWasmUrl();
          busy.update('ffmpeg-load', '正在启动视频处理组件…', null);
          await ffmpeg.load({
            classWorkerURL: ffmpegVendorUrl('worker.js'),
            coreURL: ffmpegVendorUrl('core/ffmpeg-core.js'),
            wasmURL
          });
          return ffmpeg;
        } finally {
          busy.end('ffmpeg-load');
        }
      })().catch((error) => {
        ffmpegPromise = null;
        throw new Error('ffmpeg 组件加载失败：' + String((error && error.message) || error));
      });
    }
    return ffmpegPromise;
  }
  const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));
  const sanitizeVideoName = (name) => String(name || '').replace(/\\/g, '/').split('/').pop().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 120);
  const videoStem = (name, fallback) => (sanitizeVideoName(name).replace(/\.[^/.]+$/, '') || fallback);
  // main/mp4-compressor.js: the slider shared with PNG / JPG 压缩 rides CRF from 18 to 34.
  function mp4CompressionPlan(strength) {
    const level = clampNumber(Math.round(Number(strength) || 0), 0, 100);
    return { strength: level, quality: clampNumber(Math.round(95 - level * 0.6), 35, 95), crf: clampNumber(Math.round(18 + level * 0.16), 18, 34), zone: level >= 78 ? 'danger' : level >= 56 ? 'warning' : 'safe' };
  }
  function mp4CompressArgs(inPath, outPath, crf, audioMode) {
    return [
      '-i', inPath,
      '-map', '0:v:0',
      ...(audioMode === 'none' ? ['-an'] : ['-map', '0:a:0']),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      ...(audioMode === 'none' ? [] : audioMode === 'copy' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k']),
      outPath
    ];
  }
  // main/video-format-converter.js: a percentage off the decoded frame, rounded down to even.
  const VIDEO_CONVERT_FORMATS = ['mp4', 'webm', 'gif'];
  const normalizeVideoFormat = (value) => (VIDEO_CONVERT_FORMATS.includes(String(value || '').trim().toLowerCase()) ? String(value).trim().toLowerCase() : 'mp4');
  const normalizeScalePct = (value) => { const pct = Number(value); return clampNumber(Math.round(Number.isFinite(pct) ? pct : 100), 10, 200); };
  const videoConvertScaleFilter = (scalePct) => `scale=max(2\\,trunc(iw*${normalizeScalePct(scalePct)}/200)*2):max(2\\,trunc(ih*${normalizeScalePct(scalePct)}/200)*2):flags=lanczos`;
  /** What ffmpeg's probe pass said about the input: size, frame rate, audio. */
  function sourceFromLog(log) {
    const text = String(log || '');
    const video = text.match(/Stream #0:\d+.*?Video:.*?(\d{2,5})x(\d{2,5})/);
    const fps = text.match(/(\d+(?:\.\d+)?) fps/);
    return {
      width: video ? Number(video[1]) : 0,
      height: video ? Number(video[2]) : 0,
      fps: fps ? Number(fps[1]) : 0,
      hasAudio: /Stream #0:\d+.*?Audio:/.test(text)
    };
  }
  // WebM on the Web is VP8 + Opus. The desktop writes VP9, but this core's
  // libvpx-vp9 traps ("memory access out of bounds") on the first frame with
  // every setting tried; VP8 encodes cleanly. VP8 has no constant-quality
  // mode without a bitrate, so it gets the desktop's quality target as CRF
  // and a cap of 0.12 bits per pixel per frame at the output size.
  function webmBitrateKbps(scalePct, source) {
    const pct = normalizeScalePct(scalePct);
    const width = Math.max(2, Math.trunc((source.width || 1280) * pct / 200) * 2);
    const height = Math.max(2, Math.trunc((source.height || 720) * pct / 200) * 2);
    const fps = source.fps > 0 ? Math.min(60, source.fps) : 30;
    return Math.max(600, Math.round((width * height * fps * 0.12) / 1000));
  }
  function videoConvertArgs(inPath, outPath, format, scalePct, source) {
    const target = normalizeVideoFormat(format);
    const vf = videoConvertScaleFilter(scalePct);
    if (target === 'gif') return ['-i', inPath, '-filter_complex', `${vf},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=new=1`, '-loop', '0', outPath];
    if (target === 'webm') {
      const kbps = webmBitrateKbps(scalePct, source || {});
      return ['-i', inPath, '-vf', vf, '-c:v', 'libvpx', '-deadline', 'good', '-cpu-used', '2', '-crf', '10', '-b:v', kbps + 'k', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k', outPath];
    }
    return ['-i', inPath, '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-crf', '18', outPath];
  }
  function videoInputFile(payload) {
    const token = String((payload && payload.inputPath) || '');
    const file = token ? runtime.fileForToken(token) : null;
    if (!file) throw new Error('找不到原始视频文件，请重新选择');
    return file;
  }
  /** What the input carries, read off ffmpeg's own probe log: an AAC track is copied, anything else re-encoded. */
  function audioModeFromLog(log) {
    const text = String(log || '');
    const audio = text.match(/Stream #0:\d+.*?Audio: (\w+)/);
    if (!audio) return 'none';
    return audio[1].toLowerCase() === 'aac' ? 'copy' : 'encode';
  }
  async function runVideoJob({ tool, jobId, file, buildArgs, outName, mimeType }) {
    const ffmpeg = await loadFfmpeg();
    const inName = 'in_' + (++videoOutputSeq) + '.' + (String(file.name || '').split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
    const outFile = 'out_' + videoOutputSeq + '_' + outName;
    const label = (tool === 'mp4-compress' ? '正在压缩 ' : '正在转换 ') + String(file.name || outName);
    ffmpegJob = { jobId, last: -1, log: '', label };
    busy.begin(jobId, '正在读取 ' + String(file.name || outName) + '…');
    try {
      await ffmpeg.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
      // One probe pass for the stream list: ffmpeg prints it before refusing the missing output.
      await ffmpeg.exec(['-i', inName]).catch(() => {});
      const probeLog = ffmpegJob.log;
      ffmpegJob.log = '';
      busy.update(jobId, label, 0);
      const code = await ffmpeg.exec(buildArgs(inName, outFile, probeLog));
      if (code !== 0) {
        const tail = ffmpegJob.log.split('\n').filter((line) => /error|invalid|failed|unsupported|not found/i.test(line)).slice(-3).join('；');
        throw new Error('ffmpeg 退出码 ' + code + (tail ? '：' + tail.slice(0, 240) : ''));
      }
      const data = await ffmpeg.readFile(outFile);
      await ffmpeg.deleteFile(outFile).catch(() => {});
      const blob = new Blob([data], { type: mimeType });
      const token = 'web-video://' + videoOutputSeq + '/' + outName;
      videoOutputs.set(token, { tool, token, blob, fileName: outName, url: '' });
      videoToolProgress.emit({ jobId, progress01: 1 });
      return { token, blob };
    } catch (error) {
      // A trap inside the WebAssembly (out-of-bounds, unreachable) leaves the
      // instance unusable; drop it so the next job loads a fresh one.
      if (/RuntimeError|memory access|unreachable|abort/i.test(String((error && error.message) || error))) {
        ffmpegPromise = null;
        try { if (typeof ffmpeg.terminate === 'function') ffmpeg.terminate(); } catch (_) { /* already gone */ }
      }
      throw error;
    } finally {
      busy.end(jobId);
      if (ffmpegPromise) await ffmpeg.deleteFile(inName).catch(() => {});
      ffmpegJob = null;
    }
  }

  // The tools read this to describe what the Web build actually writes.
  api.videoToolsEngine = 'ffmpeg.wasm';

  api.compressMp4 = async (payload) => {
    try {
      const file = videoInputFile(payload);
      const plan = mp4CompressionPlan(payload && payload.strength !== undefined ? payload.strength : 32);
      const fileName = videoStem((payload && payload.fileName) || file.name, 'video') + '-compressed.mp4';
      const { token, blob } = await runVideoJob({
        tool: 'mp4-compress', jobId: String((payload && payload.jobId) || 'mp4_' + Date.now()), file,
        buildArgs: (inName, outFile, probeLog) => mp4CompressArgs(inName, outFile, plan.crf, audioModeFromLog(probeLog)),
        outName: fileName, mimeType: 'video/mp4'
      });
      const bytesIn = file.size;
      // The desktop's rule: a clip already tighter than this pass keeps its own bytes.
      if (blob.size >= bytesIn) {
        releaseVideoOutputs(null, token);
        return { ok: true, keptOriginal: true, outPath: String(payload.inputPath), fileName, bytesIn, bytesOut: bytesIn, plan, jobId: payload && payload.jobId };
      }
      return { ok: true, keptOriginal: false, outPath: token, fileName, bytesIn, bytesOut: blob.size, plan, jobId: payload && payload.jobId };
    } catch (error) {
      return { ok: false, error: '视频压缩失败：' + String((error && error.message) || error).slice(0, 240) };
    }
  };

  api.convertVideoFormat = async (payload) => {
    try {
      const file = videoInputFile(payload);
      const format = normalizeVideoFormat(payload && payload.format);
      const scalePct = normalizeScalePct(payload && payload.scalePct);
      const fileName = videoStem((payload && payload.fileName) || file.name, 'video') + '.' + format;
      const { token, blob } = await runVideoJob({
        tool: 'video-convert', jobId: String((payload && payload.jobId) || 'convert_' + Date.now()), file,
        buildArgs: (inName, outFile, probeLog) => videoConvertArgs(inName, outFile, format, scalePct, sourceFromLog(probeLog)),
        outName: fileName, mimeType: format === 'gif' ? 'image/gif' : format === 'webm' ? 'video/webm' : 'video/mp4'
      });
      return { ok: true, outPath: token, fileName, format, scalePct, bytesIn: file.size, bytesOut: blob.size, jobId: payload && payload.jobId };
    } catch (error) {
      return { ok: false, error: '视频转换失败：' + String((error && error.message) || error).slice(0, 240) };
    }
  };

  // 音频: a video dropped into the audio section keeps only its sound track,
  // as 44.1 kHz stereo 16-bit WAV. `payload.file` is the File itself; the
  // page then decodes the WAV like any other resource.
  api.extractAudioTrack = async (payload) => {
    try {
      const file = payload && payload.file instanceof Blob ? payload.file : null;
      if (!file) throw new Error('没有收到文件');
      const fileName = videoStem(file.name, 'audio') + '.wav';
      const { blob } = await runVideoJob({
        tool: 'audio-extract', jobId: String((payload && payload.jobId) || 'audio_extract_' + Date.now()), file,
        buildArgs: (inName, outFile, probeLog) => {
          if (!sourceFromLog(probeLog).hasAudio) throw new Error('这个视频没有音轨');
          return ['-i', inName, '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', outFile];
        },
        outName: fileName, mimeType: 'audio/wav'
      });
      return { ok: true, blob, fileName, bytesIn: file.size, bytesOut: blob.size };
    } catch (error) {
      return { ok: false, error: '提取音轨失败：' + String((error && error.message) || error).slice(0, 240) };
    }
  };

  api.saveVideoToolOutput = async (payload) => {
    const items = Array.isArray(payload && payload.items) ? payload.items : [];
    if (!items.length) return { ok: false, error: '没有可导出的视频' };
    const blobs = items.map((item) => {
      const held = videoOutputs.get(String((item && item.srcPath) || ''));
      const source = !held && item && item.srcPath ? runtime.fileForToken(String(item.srcPath)) : null;
      const blob = held ? held.blob : source;
      if (!blob) throw new Error('找不到结果文件：' + String((item && item.fileName) || ''));
      return { blob, fileName: sanitizeVideoName(item.fileName) || (held ? held.fileName : 'video-output.mp4') };
    });
    const picked = await api.pickDirectory();
    if (picked && picked.canceled) return { ok: true, canceled: true };
    const saved = [];
    for (const { blob, fileName } of blobs) {
      const written = picked && picked.ok && picked.dir
        ? await api.writeBinaryFile({ dir: picked.dir, fileName, data: blob })
        : await api.exportPickSaveFile({ fileName, data: blob, mimeType: blob.type });
      if (written && written.result && written.result.canceled) return { ok: true, canceled: true };
      if (!written || written.ok === false) return { ok: false, error: (written && written.error) || '导出失败' };
      saved.push(fileName);
    }
    return { ok: true, canceled: false, dir: picked && picked.dir, saved };
  };
  api.overwriteVideoToolOutput = async () => ({ ok: false, error: '浏览器里没有原文件路径，不能直接覆盖原片；请用「导出另存」' });
  // No GPU memory is held in this tab, so this must not report that it freed
  // any. It drops what the page itself cached and says plainly where the
  // memory actually lives.
  api.runtimeFreeMemory = async () => {
    releaseCache();
    lastWorkerPoll = { at: 0, workers: [] };
    lastCaps = { at: 0, count: 0 };
    return ok({
      freed: false,
      cacheCleared: true,
      detail: '显存在算力节点上，不在浏览器里；Web 版不能释放别人机器的显存'
    });
  };

  // ------------------------------------------------------- video compositor
  //
  // The desktop composites with ffmpeg. In a browser the equivalent is to draw
  // the sources onto a canvas frame by frame and record the canvas.
  //
  // MediaRecorder is used rather than WebCodecs + an MP4 muxer because it
  // needs no dependency and works in every current browser. The cost is that
  // the output is WebM, not MP4 - stated in the result and in LIMITATIONS.md
  // rather than quietly relabelled.
  const sessions = new Map();
  let sessionSeq = 0;
  let jobSeq = 0;
  const cancelled = new Set();

  // ---- 视频抠图 → 保存进资源列表 ---------------------------------------------
  //
  // The bundle saves a matted clip the way the desktop does: it asks for a temp
  // folder, writes one PNG per rendered frame into it through writeBinaryFile,
  // then has ffmpeg turn NF_%04d.png into a WebM that keeps the alpha. Here the
  // folder is a Map behind a web-temp:// token (the second block's
  // writeBinaryFile and exportCleanupDir know it), and ffmpeg.wasm encodes VP8
  // with yuva420p: VP9 traps in this core (see webmBitrateKbps), VP8 does not,
  // and Chrome plays VP8 alpha.
  const webTempDirs = new Map();
  let webTempSeq = 0;
  api.__webTempDirs = webTempDirs;

  // Some cutout frames arrive with a flat, barely visible alpha value across
  // large rectangular background regions. Once encoded, that residue is
  // preserved by both WebM playback and PNG export. Clear it only when one
  // near-black, low-alpha value dominates the background and reaches a corner;
  // normally matted frames pass through byte-for-byte.
  async function clearFlatCutoutBackground(pngBytes) {
    if (typeof root.createImageBitmap !== 'function' || !root.document?.createElement) return pngBytes;
    const bitmap = await root.createImageBitmap(new Blob([pngBytes], { type: 'image/png' }));
    try {
      const canvas = root.document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx || !canvas.width || !canvas.height) return pngBytes;
      ctx.drawImage(bitmap, 0, 0);
      const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = frame.data;
      const frequencies = new Uint32Array(25);
      const width = canvas.width;
      const height = canvas.height;
      for (let y = 0; y < height; y += 4) {
        for (let x = 0; x < width; x += 4) {
          const offset = (y * width + x) * 4;
          const alpha = pixels[offset + 3];
          if (alpha > 0 && alpha <= 24 &&
              Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) <= Math.max(24, alpha + 8)) {
            frequencies[alpha] += 1;
          }
        }
      }
      let dominantAlpha = 0;
      for (let alpha = 1; alpha <= 24; alpha += 1) {
        if (frequencies[alpha] > frequencies[dominantAlpha]) dominantAlpha = alpha;
      }
      if (!dominantAlpha || frequencies[dominantAlpha] * 16 < width * height * 0.08) return pngBytes;
      const corners = [0, width - 1, (height - 1) * width, height * width - 1];
      if (!corners.some((pixel) => pixels[pixel * 4 + 3] === dominantAlpha)) return pngBytes;
      let changed = false;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const alpha = pixels[offset + 3];
        if (alpha > 0 && alpha <= 24 &&
            Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) <= Math.max(24, alpha + 8)) {
          pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = pixels[offset + 3] = 0;
          changed = true;
        }
      }
      if (!changed) return pngBytes;
      ctx.putImageData(frame, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      return blob ? new Uint8Array(await blob.arrayBuffer()) : pngBytes;
    } catch (_) {
      // An unusual input frame must not abort saving the whole cutout video.
      return pngBytes;
    } finally {
      bitmap.close?.();
    }
  }

  api.exportCreateTempDir = async (payload) => {
    const prefix = String((payload && payload.prefix) || 'novaflow_tmp_').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 60);
    const dir = 'web-temp://' + (++webTempSeq) + '/' + prefix;
    webTempDirs.set(dir, new Map());
    return { ok: true, dir, result: { dir } };
  };

  api.exportEncodeFramesToVideo = async (payload) => {
    const options = payload || {};
    const files = webTempDirs.get(String(options.dir || ''));
    if (!files) return fail('导出临时目录不存在', { code: 'web_temp_dir_missing' });
    const names = [...files.keys()].filter((name) => /\.(?:png|jpe?g|webp)$/i.test(name)).sort();
    if (!names.length) return fail('没有可编码的帧', { code: 'web_no_frames' });
    const fps = clampNumber(Number(options.fps) || 24, 1, 120);
    const target = options.format ? normalizeVideoFormat(options.format) : 'webm';
    const keepAlpha = target === 'webm' && options.keepAlpha !== false;
    const ffmpeg = await loadFfmpeg();
    const jobId = 'frames-encode-' + (++videoOutputSeq);
    const tag = 'seq' + videoOutputSeq + '_';
    const pattern = /%0?\d*d/.test(String(options.pattern || '')) ? String(options.pattern) : 'NF_%04d.png';
    const label = '正在编码 ' + target.toUpperCase() + '（' + names.length + ' 帧）…';
    ffmpegJob = { jobId, last: -1, log: '', label };
    busy.begin(jobId, label);
    const written = [];
    try {
      // The frames go in under the requested pattern, numbered from 0 in name order.
      for (let index = 0; index < names.length; index += 1) {
        const name = tag + pattern.replace(/%0?(\d*)d/, (m, width) => String(index).padStart(Number(width) || 1, '0'));
        const frameBytes = files.get(names[index]).slice();
        await ffmpeg.writeFile(name, keepAlpha ? await clearFlatCutoutBackground(frameBytes) : frameBytes);
        written.push(name);
      }
      busy.update(jobId, label, 0);
      const outFile = tag + 'out.' + target;
      const width = Math.max(0, Math.round(Number(options.width) || 0));
      const height = Math.max(0, Math.round(Number(options.height) || 0));
      const kbps = clampNumber(Math.round((width && height ? width * height : 1920 * 1080) * fps * 0.12 / 1000), 1500, 24000);
      const pixelFormat = keepAlpha ? 'yuva420p' : 'yuv420p';
      const scale = width > 0 && height > 0
        ? 'scale=' + Math.max(2, Math.trunc(width / 2) * 2) + ':' + Math.max(2, Math.trunc(height / 2) * 2) + ':flags=lanczos'
        : 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos';
      const args = ['-framerate', String(fps), '-start_number', '0', '-i', tag + pattern];
      if (target === 'gif') {
        args.push('-filter_complex', scale + ',split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=new=1', '-loop', '0');
      } else if (target === 'mp4') {
        args.push('-vf', scale + ',format=yuv420p', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart');
      } else {
        args.push('-vf', scale + ',format=' + pixelFormat,
          '-c:v', 'libvpx', '-pix_fmt', pixelFormat, '-auto-alt-ref', '0', '-deadline', 'good', '-cpu-used', '4',
          // qmax 8: with crf 10 alone the VP8 alpha plane came back as a flat 1-2
          // across the transparent background on the frames after a keyframe.
          '-crf', '8', '-qmin', '0', '-qmax', '8', '-b:v', kbps + 'k');
      }
      // Chromium seeks the colour and auxiliary VP8 alpha streams separately.
      // Inter-frame alpha references can then be missing even though linear
      // playback is clean. Make every transparent frame independently decodable
      // so pause/step/canvas export sees the same pixels as playback.
      if (keepAlpha) args.push('-g', '1', '-metadata:s:v:0', 'alpha_mode=1');
      args.push('-y', outFile);
      const code = await ffmpeg.exec(args);
      if (code !== 0) {
        const tail = ffmpegJob.log.split('\n').filter((line) => /error|invalid|failed|unsupported|not found/i.test(line)).slice(-3).join('；');
        throw new Error('ffmpeg 退出码 ' + code + (tail ? '：' + tail.slice(0, 240) : ''));
      }
      const data = await ffmpeg.readFile(outFile);
      await ffmpeg.deleteFile(outFile).catch(() => {});
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const mimeType = target === 'gif' ? 'image/gif' : 'video/' + target;
      const out = { ok: true, format: target, mimeType, fps, width, height, frames: names.length, bytes: bytes.length };
      if (options.returnBase64 !== false) out.base64 = base64FromBytes(bytes);
      const outPathName = String(options.outPath || '').split(/[\\/]/).pop() || '';
      const fileName = sanitizeVideoName(outPathName) || 'cutout_' + Date.now() + '.' + target;
      out.warehouse = await saveToWarehouse(new Blob([bytes.slice()], { type: mimeType }), videoStem(fileName, 'video') + '.' + target, String(options.outPath || '').startsWith('web-export://'));
      videoToolProgress.emit({ jobId, progress01: 1 });
      return out;
    } catch (error) {
      if (/RuntimeError|memory access|unreachable|abort/i.test(String((error && error.message) || error))) {
        ffmpegPromise = null;
        try { if (typeof ffmpeg.terminate === 'function') ffmpeg.terminate(); } catch (_) { /* already gone */ }
      }
      return fail('视频编码失败：' + String((error && error.message) || error));
    } finally {
      busy.end(jobId);
      if (ffmpegPromise) for (const name of written) await ffmpeg.deleteFile(name).catch(() => {});
      ffmpegJob = null;
    }
  };

  // The export modal uses the same conversion engine as 工具 → 视频格式转换.
  // Sources written by the modal are held in web-temp:// directories; clips
  // already registered with the renderer retain their original bytes.
  api.exportEncodeVideoToVideo = async (payload) => {
    const options = payload || {};
    let token = '';
    try {
      const path = String(options.inPath || '');
      let blob;
      for (const [dir, entries] of webTempDirs) {
        if (path.startsWith(dir + '/') || path.startsWith(dir + '\\')) {
          const bytes = entries.get(path.slice(dir.length + 1));
          if (bytes) blob = new Blob([bytes.slice()]);
          break;
        }
      }
      if (!blob) blob = runtime.fileForToken?.(path) || videoOutputs.get(path)?.blob;
      if (!blob) blob = [...cache.values()].find(entry => entry.path === path)?.blob;
      if (!blob && /^(?:blob:|https?:)/i.test(path)) {
        const response = await root.fetch(path);
        if (!response.ok) throw new Error('读取源视频失败：' + response.status);
        blob = await response.blob();
      }
      if (!blob) throw new Error('找不到源视频，请重新加载视频后导出');
      const target = normalizeVideoFormat(options.format);
      const fileName = videoStem(String(options.outPath || '').split(/[\\/]/).pop(), 'video') + '.' + target;
      const inputName = path.split(/[\\/]/).pop() || 'input.webm';
      const result = await runVideoJob({
        tool: 'video-convert', jobId: 'video-export-' + (++videoOutputSeq),
        file: { name: inputName, arrayBuffer: () => blob.arrayBuffer() }, outName: fileName,
        mimeType: target === 'gif' ? 'image/gif' : 'video/' + target,
        buildArgs: (input, output, log) => {
          const source = sourceFromLog(log);
          const args = videoConvertArgs(input, output, target, options.scalePct, source);
          if (target === 'webm') {
            // Bound both the decoder buffers and VP8 lookahead in the
            // single-thread WebAssembly core, including clips with audio.
            args.unshift('-threads', '1');
            args[args.indexOf('-cpu-used') + 1] = '4';
            // This core's Opus path traps on the 32 kHz AAC track of an H3
            // output. Vorbis is also supported by WebM and keeps the audio.
            args[args.indexOf('-c:a') + 1] = 'libvorbis';
            args.splice(args.length - 1, 0, '-threads', '1', '-lag-in-frames', '0', '-auto-alt-ref', '0', '-ar', '48000');
          }
          if (!options.sourceConvert) {
            if (Number(options.width) > 0 && Number(options.height) > 0) {
              const scale = 'scale=' + Math.max(2, Math.trunc(Number(options.width) / 2) * 2) + ':' + Math.max(2, Math.trunc(Number(options.height) / 2) * 2) + ':flags=lanczos';
              const index = args.indexOf(target === 'gif' ? '-filter_complex' : '-vf') + 1;
              args[index] = target === 'gif' ? scale + ',split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=new=1' : scale;
            }
            if (Number(options.fps) > 0) args.splice(args.length - 1, 0, '-r', String(clampNumber(Number(options.fps), 1, 120)));
          }
          if (target === 'webm' && options.keepAlpha) {
            const codec = /Video:\s*vp9/i.test(log) ? 'libvpx-vp9' : /Video:\s*vp8/i.test(log) ? 'libvpx' : '';
            if (codec) args.unshift('-c:v', codec);
            args[args.indexOf('-pix_fmt') + 1] = 'yuva420p';
            args.splice(args.length - 1, 0, '-g', '1', '-metadata:s:v:0', 'alpha_mode=1');
          }
          return args;
        }
      });
      token = result.token;
      const warehouse = await saveToWarehouse(result.blob, fileName, true);
      return { ok: true, format: target, fileName, bytes: result.blob.size, warehouse };
    } catch (error) {
      return fail('视频导出失败：' + String(error?.message || error));
    } finally {
      if (token) releaseVideoOutputs(null, token);
    }
  };

  // Chromium's canvas video seek can lose VP8 alpha after the first frame.
  // Decode saved cutout WebM with libvpx, whose yuva420p output retains the
  // alpha plane, before exporting PNG frames or a Spine sequence.
  // A WebM alpha plane is lossy: frames after a keyframe can come back with a
  // flat 1-2 across the whole transparent background, which PNG export keeps
  // and Spine's whitespace stripping then counts as content. No real pixel
  // sits below 4/255, so clamp that floor whenever alpha is decoded.
  const ALPHA_FLOOR = "lutrgb=a='if(lt(val,4),0,val)'";
  api.exportDecodeAlphaVideoFrames = async (payload) => {
    const sourceUrl = String(payload?.sourceUrl || '');
    if (!sourceUrl) return fail('缺少透明视频源');
    let ffmpeg;
    const tag = 'alpha' + (++videoOutputSeq) + '_';
    const input = tag + 'input.webm';
    const outputPrefix = tag + 'frame_';
    const outputPattern = outputPrefix + '%06d.png';
    let names = [];
    try {
      ffmpeg = await loadFfmpeg();
      if (typeof ffmpeg.listDir !== 'function') throw new Error('当前解码器不支持读取透明序列帧');
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error('读取透明视频失败');
      await ffmpeg.writeFile(input, new Uint8Array(await response.arrayBuffer()));
      const args = ['-c:v', 'libvpx', '-i', input, '-an', '-vsync', '0', '-vf', 'format=rgba,' + ALPHA_FLOOR];
      const maxFrames = Number(payload?.maxFrames);
      if (Number.isInteger(maxFrames) && maxFrames > 0) args.push('-frames:v', String(maxFrames));
      args.push('-start_number', '0', '-y', outputPattern);
      const code = await ffmpeg.exec(args);
      if (code !== 0) throw new Error('透明视频解码失败：ffmpeg 退出码 ' + code);
      names = (await ffmpeg.listDir('/')).map((entry) => entry.name)
        .filter((name) => name.startsWith(outputPrefix) && name.endsWith('.png')).sort();
      if (!names.length) throw new Error('透明视频没有可导出的帧');
      const frames = [];
      for (const name of names) {
        const data = await ffmpeg.readFile(name);
        const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data);
        frames.push(await clearFlatCutoutBackground(bytes));
      }
      return { ok: true, frames };
    } catch (error) {
      return fail(String(error?.message || error));
    } finally {
      if (ffmpeg) {
        for (const name of names) await ffmpeg.deleteFile(name).catch(() => {});
        await ffmpeg.deleteFile(input).catch(() => {});
      }
    }
  };

  // ---- 帧编辑 → the stage video as frames ----------------------------------
  //
  // 帧编辑 (video-frame-edit.tool.js) edits whatever video the 动画 stage shows:
  // the clip is decoded here into one PNG per frame at the dock's frame rate
  // (the timeline's 第 N 帧 / 总 count), edited as an order of those frames and
  // encoded back through exportEncodeFramesToVideo. A .webm goes through the
  // VP8 alpha decoder first so a matted clip keeps its transparency; when that
  // decoder refuses (a VP9 clip) the plain decode runs instead.
  // The 画板 loops a clip by seeking back to 0. With an audio track that seek
  // waits for the audio pipeline to restart, so frame 1 comes a frame late on
  // every wrap; the seamless-loop overlay therefore plays a video-only copy of
  // the clip: the same packets remuxed without the audio track, nothing decoded
  // or encoded (a 2-5 s clip takes well under a second). Copies are kept per
  // source URL, a few at a time; the overlay revokes one it stops using.
  const videoOnlyCopies = new Map();
  const VIDEO_ONLY_COPY_LIMIT = 4;
  function videoContainerFromBytes(bytes) {
    if (bytes.length > 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'mp4';
    if (bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
    return '';
  }
  api.exportVideoOnlyCopy = async (payload) => {
    const sourceUrl = String((payload && payload.sourceUrl) || '');
    if (!sourceUrl) return fail('缺少视频地址');
    const cached = videoOnlyCopies.get(sourceUrl);
    if (cached) {
      videoOnlyCopies.delete(sourceUrl);
      videoOnlyCopies.set(sourceUrl, cached);
      return { ok: true, cached: true, ...cached };
    }
    let bytes;
    try {
      const response = await root.fetch(sourceUrl);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      return fail('读取视频失败：' + String((error && error.message) || error));
    }
    const container = videoContainerFromBytes(bytes);
    if (!container) return fail('无法识别的视频格式');
    let ffmpeg;
    try { ffmpeg = await loadFfmpeg(); } catch (error) { return fail(String((error && error.message) || error)); }
    const seq = ++videoOutputSeq;
    const inName = 'loop_in_' + seq + '.' + container;
    const outName = 'loop_out_' + seq + '.' + container;
    try {
      await ffmpeg.writeFile(inName, bytes);
      const args = ['-i', inName, '-an', '-c:v', 'copy'];
      if (container === 'mp4') args.push('-movflags', '+faststart');
      args.push('-y', outName);
      const code = await ffmpeg.exec(args);
      if (code !== 0) throw new Error('ffmpeg 退出码 ' + code);
      const data = await ffmpeg.readFile(outName);
      await ffmpeg.deleteFile(outName).catch(() => {});
      const out = data instanceof Uint8Array ? data : new Uint8Array(data);
      if (!out.length) throw new Error('副本为空');
      const mimeType = 'video/' + container;
      const entry = { url: URL.createObjectURL(new Blob([out], { type: mimeType })), mimeType, container, bytes: out.length };
      videoOnlyCopies.set(sourceUrl, entry);
      while (videoOnlyCopies.size > VIDEO_ONLY_COPY_LIMIT) {
        const oldest = videoOnlyCopies.keys().next().value;
        const gone = videoOnlyCopies.get(oldest);
        videoOnlyCopies.delete(oldest);
        try { URL.revokeObjectURL(gone.url); } catch (_) { /* already gone */ }
      }
      return { ok: true, cached: false, ...entry };
    } catch (error) {
      if (/RuntimeError|memory access|unreachable|abort/i.test(String((error && error.message) || error))) {
        ffmpegPromise = null;
        try { if (typeof ffmpeg.terminate === 'function') ffmpeg.terminate(); } catch (_) { /* already gone */ }
      }
      return fail('生成无声副本失败：' + String((error && error.message) || error));
    } finally {
      if (ffmpegPromise) await ffmpeg.deleteFile(inName).catch(() => {});
    }
  };
  api.exportRevokeVideoOnlyCopy = async (payload) => {
    const sourceUrl = String((payload && payload.sourceUrl) || '');
    const entry = videoOnlyCopies.get(sourceUrl);
    if (entry) {
      videoOnlyCopies.delete(sourceUrl);
      try { URL.revokeObjectURL(entry.url); } catch (_) { /* already gone */ }
    }
    return { ok: true, revoked: Boolean(entry) };
  };

  api.exportDecodeVideoFrames = async (payload) => {
    const options = payload || {};
    const sourceUrl = String(options.sourceUrl || '');
    const source = options.bytes || options.data || null;
    if (!sourceUrl && !source) return fail('缺少画板视频');
    const ext = (String(options.fileName || '').split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '') || (sourceUrl.split('?')[0].split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
    const fps = Number(options.fps) > 0 ? clampNumber(Number(options.fps), 1, 120) : 0;
    const maxFrames = Number.isInteger(Number(options.maxFrames)) && Number(options.maxFrames) > 0 ? Number(options.maxFrames) : 0;
    const tryAlpha = options.alpha === true || (ext === 'webm' && options.alpha !== false);
    let ffmpeg;
    const tag = 'frames' + (++videoOutputSeq) + '_';
    const input = tag + 'input.' + ext;
    const outputPrefix = tag + 'frame_';
    const outputPattern = outputPrefix + '%06d.png';
    const jobId = 'frames-decode-' + videoOutputSeq;
    const label = '正在读取画板视频的帧…';
    const previous = ffmpegJob;
    ffmpegJob = { jobId, last: -1, log: '', label };
    busy.begin(jobId, label);
    let names = [];
    const cleanup = async () => {
      if (!ffmpeg) return;
      for (const name of names) await ffmpeg.deleteFile(name).catch(() => {});
      names = [];
    };
    try {
      ffmpeg = await loadFfmpeg();
      if (typeof ffmpeg.listDir !== 'function') throw new Error('当前解码器不支持读取序列帧');
      let bytes;
      if (source) bytes = await bytesOf(source);
      else {
        const response = await root.fetch(sourceUrl);
        if (!response.ok) throw new Error('读取画板视频失败');
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      if (!bytes.length) throw new Error('画板视频是空的');
      await ffmpeg.writeFile(input, bytes);
      const run = async (alpha) => {
        const filters = [];
        if (fps) filters.push('fps=' + fps);
        if (alpha) filters.push('format=rgba', ALPHA_FLOOR);
        const args = alpha ? ['-c:v', 'libvpx', '-i', input] : ['-i', input];
        args.push('-an', '-vsync', '0');
        if (filters.length) args.push('-vf', filters.join(','));
        if (maxFrames) args.push('-frames:v', String(maxFrames));
        args.push('-compression_level', '1', '-start_number', '0', '-y', outputPattern);
        const code = await ffmpeg.exec(args);
        names = (await ffmpeg.listDir('/')).map((entry) => entry.name)
          .filter((name) => name.startsWith(outputPrefix) && name.endsWith('.png')).sort();
        if (code !== 0 || !names.length) { await cleanup(); return false; }
        return true;
      };
      let alpha = false;
      if (tryAlpha && await run(true)) alpha = true;
      else if (!(await run(false))) throw new Error('画板视频没有可读取的帧');
      const info = sourceFromLog(ffmpegJob.log);
      const frames = [];
      for (let index = 0; index < names.length; index += 1) {
        const data = await ffmpeg.readFile(names[index]);
        frames.push(data instanceof Uint8Array ? data.slice() : new Uint8Array(data));
        if (index % 8 === 0) busy.update(jobId, label, names.length ? index / names.length : null);
      }
      busy.update(jobId, label, 1);
      return { ok: true, frames, alpha, fps: fps || info.fps || 0, sourceFps: info.fps || 0, width: info.width || 0, height: info.height || 0 };
    } catch (error) {
      return fail(String(error?.message || error));
    } finally {
      await cleanup();
      if (ffmpeg) await ffmpeg.deleteFile(input).catch(() => {});
      busy.end(jobId);
      ffmpegJob = previous;
    }
  };

  // 颜色校正 is not offered on the Web line (removed 2026-09-25 at the user's request;
  // the brand runtime hides its 视频处理 entry). The helpers below are shared by
  // the video tools that remain.
  // Always a fresh copy: ffmpeg.wasm transfers the buffer it is handed to its
  // worker, which would leave the caller's frames, masks or clip detached.
  const bytesOf = async (value) => value instanceof Blob ? new Uint8Array(await value.arrayBuffer())
    : value instanceof ArrayBuffer ? new Uint8Array(value.slice(0))
      : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
        : Uint8Array.from(value || []);
  const durationFromLog = (log) => {
    const m = String(log || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  };

  // ---- 多参视频 → 参考视频/声音探测 --------------------------------------------
  //
  // The desktop probes a reference clip with ffprobe before the H3 policy check
  // (24 fps, 2-15 s). Without this the Web page had no fps or duration at all
  // and every 视频参考 was refused. One ffmpeg.wasm pass over the stream list
  // gives the same numbers.
  api.aiSeqProbeVideoMeta = async (payload) => {
    const options = payload || {};
    const source = options.bytes || options.data;
    if (!source) return fail('探测缺少视频内容');
    const ffmpeg = await loadFfmpeg();
    const seq = ++videoOutputSeq;
    const ext = (String(options.fileName || '').split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
    const inName = 'probe_' + seq + '.' + ext;
    const previous = ffmpegJob;
    ffmpegJob = { jobId: 'probe-' + seq, last: -1, log: '', label: '' };
    try {
      await ffmpeg.writeFile(inName, await bytesOf(source));
      await ffmpeg.exec(['-i', inName]).catch(() => {});
      const log = ffmpegJob.log;
      const durationSec = durationFromLog(log);
      const video = log.match(/Stream #\d+:\d+.*?Video: ([^,\n]+)[^\n]*?(\d{2,5})x(\d{2,5})[^\n]*?(\d+(?:\.\d+)?) fps/);
      const fps = video ? Number(video[4]) : 0;
      const width = video ? Number(video[2]) : 0;
      const height = video ? Number(video[3]) : 0;
      const hasAudio = /Stream #\d+:\d+.*?Audio:/.test(log);
      // The stream log supplies a decimal average, not ffprobe's exact rational
      // or packet timestamps. Do not manufacture a source frame count or claim
      // that this identifies a constant frame rate for variable-rate clips.
      return { ok: true, fps, frames: 0, durationSec, width, height, hasAudio,
        fpsOrigin: fps > 0 ? 'ffmpeg-stream-log' : 'unavailable', rateMode: 'unknown',
        codec: video ? String(video[1]).trim() : '' };
    } catch (error) {
      return fail('视频探测失败：' + String((error && error.message) || error));
    } finally {
      ffmpegJob = previous;
      if (ffmpegPromise) await ffmpeg.deleteFile(inName).catch(() => {});
    }
  };

  api.videoCompositorOpenSession = async (payload) => {
    sessionSeq += 1;
    const sessionId = 'web-vc-' + sessionSeq;
    sessions.set(sessionId, {
      id: sessionId,
      width: Number((payload && payload.width) || 1280),
      height: Number((payload && payload.height) || 720),
      fps: Number((payload && payload.fps) || 24),
      sources: new Map(),
      masks: new Map()
    });
    return { ok: true, sessionId, id: sessionId };
  };

  // ---- 视频合并 ---------------------------------------------------------------
  //
  // The desktop registers each source through ffprobe, keeps the painted
  // masks, and composites with ffmpeg. The same here on ffmpeg.wasm: a source
  // is the dropped File (web-file:// token), a resource-list clip (blob: URL)
  // or an earlier output (web-video:// token); a mask is a PNG whose alpha is
  // the coverage; the export builds one filter graph - scale, alphamerge and
  // overlay per layer at the layer's centre and scale - and encodes MP4 or
  // WebM at the canvas size and fps, straight into the reserved resource-list
  // slot. Audio comes from the layer the workspace chose.
  let sourceSeq = 0;
  let maskSeq = 0;
  const evenSize = (value) => Math.max(2, Math.round(Number(value) / 2) * 2);
  async function compositorSourceBlob(options) {
    if (options.file instanceof Blob) return options.file;
    const path = String(options.path || options.filePath || options.localPath || '');
    const fromToken = path ? runtime.fileForToken(path) : null;
    if (fromToken) return fromToken;
    const held = path ? videoOutputs.get(path) : null;
    if (held && held.blob) return held.blob;
    for (const entry of cache.values()) if (entry && entry.blob && entry.path && entry.path === path) return entry.blob;
    for (const candidate of [path, String(options.url || '')]) {
      if (!/^(blob:|https?:|data:)/.test(candidate)) continue;
      try { const res = await root.fetch(candidate); if (res.ok) return await res.blob(); } catch (_) { /* next */ }
    }
    return null;
  }
  function probeWithVideoElement(blob) {
    return new Promise((resolve) => {
      const video = root.document.createElement('video');
      const url = URL.createObjectURL(blob);
      let settled = false;
      const done = (value) => { if (settled) return; settled = true; try { URL.revokeObjectURL(url); } catch (_) { /* gone */ } resolve(value); };
      const timer = setTimeout(() => done(null), 15000);
      video.addEventListener('loadedmetadata', () => {
        clearTimeout(timer);
        done({ width: video.videoWidth, height: video.videoHeight, durationSec: Number.isFinite(video.duration) ? video.duration : 0 });
      }, { once: true });
      video.addEventListener('error', () => { clearTimeout(timer); done(null); }, { once: true });
      video.preload = 'metadata';
      video.muted = true;
      video.src = url;
    });
  }

  api.videoCompositorRegisterSource = async (payload) => {
    const options = payload || {};
    const session = sessions.get(String(options.sessionId));
    if (!session) return fail('unknown compositor session');
    const blob = await compositorSourceBlob(options);
    if (!blob) return fail('video_merge_source_unreadable');
    // ffmpeg's stream list gives fps and audio; the video element covers size
    // and duration when the log leaves them out (MediaRecorder WebM says
    // nothing about duration, but the element still knows).
    let meta = null;
    try {
      const probed = await api.aiSeqProbeVideoMeta({ bytes: blob, fileName: options.fileName || 'source.mp4' });
      if (probed && probed.ok) meta = probed;
    } catch (_) { meta = null; }
    const element = (!meta || !meta.width || !(meta.durationSec > 0)) ? await probeWithVideoElement(blob) : null;
    const width = Math.round((meta && meta.width) || (element && element.width) || 0);
    const height = Math.round((meta && meta.height) || (element && element.height) || 0);
    const durationSec = Number((meta && meta.durationSec) || (element && element.durationSec) || 0);
    if (!width || !height || !(durationSec > 0)) return fail('video_merge_source_metadata_invalid');
    const fps = Number(meta && meta.fps) || Number(session.fps) || 30;
    const sourceId = String(options.sourceId || options.id || ('src-' + (++sourceSeq)));
    const probe = {
      width, height, displayWidth: width, displayHeight: height, durationSec, fps, avgFrameRate: fps,
      rotationDeg: 0, rotation: 0, hasAudio: !!(meta && meta.hasAudio), hasAlpha: !!options.alphaSourceConfirmed,
      codec: (meta && meta.codec) || '', pixelFormat: ''
    };
    session.sources.set(sourceId, { id: sourceId, blob, fileName: String(options.fileName || 'source.mp4'), probe });
    // An earlier output arrives as its web-video:// token, which the preview
    // cannot play; hand back the URL the resource list already plays it from.
    const held = videoOutputs.get(String(options.path || options.filePath || options.localPath || ''));
    if (held && held.blob && !held.url) held.url = URL.createObjectURL(held.blob);
    const previewUrl = held && held.url ? held.url : '';
    return { ok: true, sourceId, id: sourceId, meta: probe, probe, previewUrl, source: { sourceId, probe } };
  };

  api.videoCompositorReleaseSource = async (payload) => {
    const session = sessions.get(String(payload && payload.sessionId));
    if (session) session.sources.delete(String(payload.sourceId || payload.id));
    return ok({ released: true });
  };

  api.videoCompositorPutMask = async (payload) => {
    const options = payload || {};
    const session = sessions.get(String(options.sessionId));
    if (!session) return fail('unknown compositor session');
    const data = options.bytes || options.mask || options.data;
    if (!data) return fail('video_merge_mask_bytes_required');
    const maskId = 'mask-' + (++maskSeq);
    session.masks.set(maskId, { id: maskId, layerId: options.layerId, sourceId: options.sourceId, bytes: await bytesOf(data), width: options.width, height: options.height });
    return { ok: true, maskId, id: maskId };
  };

  const compositorJobs = new Map();
  api.videoCompositorCancel = async (payload) => {
    const jobId = String((payload && payload.jobId) || '');
    if (jobId) cancelled.add(jobId);
    // ffmpeg.wasm cannot be interrupted mid-run; dropping the instance is the cancel.
    if (jobId && compositorJobs.has(jobId)) {
      const ffmpeg = compositorJobs.get(jobId);
      ffmpegPromise = null;
      try { if (typeof ffmpeg.terminate === 'function') ffmpeg.terminate(); } catch (_) { /* already gone */ }
    }
    return ok({ cancelled: true });
  };

  api.videoCompositorCloseSession = async (payload) => {
    sessions.delete(String(payload && payload.sessionId));
    return ok({ closed: true });
  };

  api.videoCompositorExport = async (manifest) => {
    const session = sessions.get(String(manifest && manifest.sessionId));
    if (!session) return fail('unknown compositor session');
    const output = (manifest && manifest.output) || {};
    const width = evenSize(Number(output.width) || Number(manifest.width) || session.width || 1280);
    const height = evenSize(Number(output.height) || Number(manifest.height) || session.height || 720);
    const fps = Number(output.fps) || Number(manifest.fps) || Number(session.fps) || 30;
    const format = String(output.format || manifest.format || 'mp4').toLowerCase() === 'webm' ? 'webm' : 'mp4';
    const filePath = String(output.filePath || manifest.filePath || '');
    const layers = (Array.isArray(manifest.layers) ? manifest.layers : [])
      .filter((layer) => layer && layer.visible !== false)
      .map((layer) => ({ ...layer, source: session.sources.get(String(layer.sourceId)), mask: layer.maskId ? session.masks.get(String(layer.maskId)) : null }))
      .filter((layer) => layer.source);
    if (!layers.length) return fail('没有可合成的视频源');
    jobSeq += 1;
    const jobId = String(manifest.jobId || 'web-vc-job-' + jobSeq);
    const report = (stage, progress01, message) => compositorProgress.emit({ jobId, stage, progress01, message });
    report('prepare', 0, '准备视频源');
    const ffmpeg = await loadFfmpeg();
    compositorJobs.set(jobId, ffmpeg);
    const seq = ++videoOutputSeq;
    const tag = 'merge' + seq + '_';
    const outFile = tag + 'out.' + format;
    const scratch = [outFile];
    const label = '正在合成视频…';
    ffmpegJob = { jobId, last: -1, log: '', label };
    const relay = videoToolProgress.subscribe((event) => { if (event && event.jobId === jobId) report('render', event.progress01, '合成中 ' + Math.round(event.progress01 * 100) + '%'); });
    busy.begin(jobId, label);
    try {
      // The manifest lists state.layers bottom first - the preview draws them in this order and
      // the workspace list only displays them reversed under 上层在前 - so overlays go on in order.
      const stack = layers.slice();
      const duration = Math.max(...stack.map((layer) => Number(layer.source.probe.durationSec) || 0));
      const args = [];
      let inputs = 0;
      for (let i = 0; i < stack.length; i += 1) {
        const layer = stack[i];
        const ext = (String(layer.source.fileName || '').split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
        const name = tag + 'src' + i + '.' + ext;
        await ffmpeg.writeFile(name, await bytesOf(layer.source.blob));
        scratch.push(name);
        // ffmpeg's own VP8/VP9 decoders ignore the WebM alpha side-data, so a
        // cutout layer would arrive on an opaque black background. Decode alpha
        // sources with libvpx, as the other alpha readers in this file do.
        if (ext === 'webm' || layer.source.probe.hasAlpha) args.push('-c:v', /vp9/i.test(String(layer.source.probe.codec || '')) ? 'libvpx-vp9' : 'libvpx');
        args.push('-i', name);
        layer.videoInput = inputs++;
        if (layer.mask) {
          const maskName = tag + 'mask' + i + '.png';
          await ffmpeg.writeFile(maskName, layer.mask.bytes.slice());
          scratch.push(maskName);
          args.push('-loop', '1', '-framerate', String(fps), '-i', maskName);
          layer.maskInput = inputs++;
        }
      }
      const keepAlpha = format === 'webm';
      const pixelFormat = keepAlpha ? 'yuva420p' : 'yuv420p';
      const filters = ['color=c=' + (keepAlpha ? 'black@0' : 'black') + ':s=' + width + 'x' + height + ':r=' + fps + ':d=' + duration.toFixed(3) + ',format=rgba[base]'];
      let last = 'base';
      stack.forEach((layer, i) => {
        const probe = layer.source.probe;
        const scale = Math.max(0.01, Number(layer.transform && layer.transform.scale) || 1);
        const lw = evenSize(probe.displayWidth * scale);
        const lh = evenSize(probe.displayHeight * scale);
        const cx = Number(layer.transform && layer.transform.centerX);
        const cy = Number(layer.transform && layer.transform.centerY);
        const x = Math.round((Number.isFinite(cx) ? cx : width / 2) - lw / 2);
        const y = Math.round((Number.isFinite(cy) ? cy : height / 2) - lh / 2);
        const dw = Math.max(2, Math.round(probe.displayWidth)), dh = Math.max(2, Math.round(probe.displayHeight));
        // Alpha layers also get the lossy-alpha floor (see ALPHA_FLOOR above).
        filters.push('[' + layer.videoInput + ':v]setpts=PTS-STARTPTS,scale=' + dw + ':' + dh + ':flags=lanczos,setsar=1,fps=' + fps + ',format=rgba' + (probe.hasAlpha ? ",lutrgb=a='if(lt(val,4),0,val)'" : '') + '[l' + i + ']');
        let src = 'l' + i;
        if (layer.mask) {
          // The desktop's graph: the mask is gray coverage in the layer's display space, multiplied
          // into the source's own alpha before the layer is scaled to its transform.
          filters.push('[l' + i + ']split=2[lr' + i + '][la' + i + ']');
          filters.push('[la' + i + ']alphaextract[sa' + i + ']');
          // The desktop canonicalises the mask to its alpha channel before ffmpeg reads it as gray;
          // here the PNG is white with alpha = coverage, so the coverage is its alpha.
          filters.push('[' + layer.maskInput + ':v]scale=' + dw + ':' + dh + ':flags=lanczos,format=rgba,alphaextract[cov' + i + ']');
          filters.push('[sa' + i + '][cov' + i + ']blend=all_mode=multiply:shortest=1[ma' + i + ']');
          filters.push('[lr' + i + '][ma' + i + ']alphamerge,format=rgba[lm' + i + ']');
          src = 'lm' + i;
        }
        filters.push('[' + src + ']scale=' + lw + ':' + lh + ':flags=lanczos,format=rgba[ls' + i + ']');
        src = 'ls' + i;
        filters.push('[' + last + '][' + src + ']overlay=x=' + x + ':y=' + y + ':format=auto:eof_action=pass[o' + i + ']');
        last = 'o' + i;
      });
      filters.push('[' + last + ']format=' + pixelFormat + '[vout]');
      const audioLayer = manifest.audio && manifest.audio.mode === 'single'
        ? stack.find((layer) => String(layer.layerId) === String(manifest.audio.sourceLayerId) && layer.source.probe.hasAudio)
        : null;
      const encode = format === 'webm'
        ? ['-c:v', 'libvpx', '-crf', '8', '-qmin', '0', '-qmax', '8', '-b:v', String(clampNumber(Math.round(width * height * fps * 0.12 / 1000), 1500, 24000)) + 'k', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', pixelFormat, '-auto-alt-ref', '0', '-g', '1', '-metadata:s:v:0', 'alpha_mode=1']
        : ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
      const run = async (withAudio) => {
        const full = args.slice();
        full.push('-filter_complex', filters.join(';'), '-map', '[vout]');
        if (withAudio) full.push('-map', audioLayer.videoInput + ':a?', '-c:a', format === 'webm' ? 'libopus' : 'aac', '-b:a', '160k');
        else full.push('-an');
        full.push(...encode, '-r', String(fps), '-t', duration.toFixed(3), '-y', outFile);
        ffmpegJob.log = '';
        return ffmpeg.exec(full);
      };
      busy.update(jobId, label, 0);
      let code = await run(!!audioLayer);
      if (code !== 0 && audioLayer && !cancelled.has(jobId)) code = await run(false);
      if (cancelled.has(jobId)) { cancelled.delete(jobId); return { ok: false, canceled: true, code: 'export_canceled', jobId }; }
      if (code !== 0) {
        const tail = ffmpegJob.log.split('\n').filter((line) => /error|invalid|failed|unsupported|not found/i.test(line)).slice(-3).join('；');
        throw new Error('ffmpeg 退出码 ' + code + (tail ? '：' + tail.slice(0, 240) : ''));
      }
      const data = await ffmpeg.readFile(outFile);
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const mimeType = format === 'webm' ? 'video/webm' : 'video/mp4';
      const blob = new Blob([bytes], { type: mimeType });
      const fileName = (filePath.split('/').pop() || ('novaflow_video_merge.' + format));
      const token = filePath || ('web-video://' + seq + '/' + fileName);
      // Keep the returned URL on the held entry so releaseVideoOutputs can revoke it.
      const url = URL.createObjectURL(blob);
      videoOutputs.set(token, { tool: 'video-merge', token, blob, fileName, url });
      for (const entry of cache.values()) if (entry && entry.path === token) { entry.blob = blob; entry.bytes = blob.size; }
      await saveToWarehouse(blob, fileName);
      report('done', 1, '视频合成完成');
      return { ok: true, jobId, filePath: token, path: token, blob, url, bytes: blob.size, format, mimeType, width, height, fps };
    } catch (error) {
      const message = String((error && error.message) || error);
      if (/RuntimeError|memory access|unreachable|abort/i.test(message)) {
        ffmpegPromise = null;
        try { if (typeof ffmpeg.terminate === 'function') ffmpeg.terminate(); } catch (_) { /* already gone */ }
      }
      report('error', 0, message);
      return fail(cancelled.has(jobId) ? 'export_canceled' : ('视频合成失败：' + message), { jobId });
    } finally {
      relay();
      busy.end(jobId);
      compositorJobs.delete(jobId);
      cancelled.delete(jobId);
      if (ffmpegPromise) for (const name of scratch) await ffmpeg.deleteFile(name).catch(() => {});
      ffmpegJob = null;
    }
  };

  // ------------------------------------------------------------------ report
  // ---- 视频编辑 ----------------------------------------------------------------
  //
  // One graph from the editor's manifest: each video / image layer trimmed to
  // its source window, scaled, masked (PNG alpha = coverage), shifted to its
  // timeline start, faded, and overlaid in track order; sound from the
  // audible layers trimmed, faded, delayed and mixed. Images loop as stills.
  // The output lands under the reserved resource-list token and in the
  // warehouse, like 视频合并's did.
  const fmt3 = (n) => Number(n).toFixed(3);
  api.videoEditorExport = async (manifest) => {
    const output = (manifest && manifest.output) || {};
    const width = evenSize(Number(output.width) || 1280);
    const height = evenSize(Number(output.height) || 720);
    const fps = clampNumber(Math.round(Number(output.fps) || 30), 1, 120);
    const format = String(output.format || 'mp4').toLowerCase() === 'webm' ? 'webm' : 'mp4';
    const filePath = String(output.filePath || '');
    const layers = (Array.isArray(manifest && manifest.layers) ? manifest.layers : []).filter((layer) => layer && layer.source);
    const duration = Math.max(0.1, Number(manifest && manifest.duration) || Math.max(...layers.map((l) => Number(l.start) + Number(l.length)), 0));
    if (!layers.some((layer) => layer.video)) return fail('时间轴上没有可见的视频片段');
    jobSeq += 1;
    const jobId = 'web-ve-job-' + jobSeq;
    const report = (stage, progress01, message) => compositorProgress.emit({ jobId, stage, progress01, message });
    report('prepare', 0, '准备片段');
    const ffmpeg = await loadFfmpeg();
    compositorJobs.set(jobId, ffmpeg);
    const seq = ++videoOutputSeq;
    const tag = 'edit' + seq + '_';
    const outFile = tag + 'out.' + format;
    const scratch = [outFile];
    const label = '正在合成视频…';
    ffmpegJob = { jobId, last: -1, log: '', label };
    const relay = videoToolProgress.subscribe((event) => { if (event && event.jobId === jobId) report('render', event.progress01, '合成中 ' + Math.round(event.progress01 * 100) + '%'); });
    busy.begin(jobId, label);
    try {
      const args = [];
      const written = new Map();
      let inputs = 0;
      for (const layer of layers) {
        const src = layer.source;
        const key = String(src.url || src.fileName || '') + ':' + (src.blob ? src.blob.size : 0);
        let name = written.get(key);
        if (!name) {
          const ext = (String(src.fileName || '').split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
          name = tag + 'src' + written.size + '.' + ext;
          let bytes = null;
          if (src.blob) bytes = await bytesOf(src.blob);
          else if (src.url) { const res = await root.fetch(src.url); if (!res.ok) throw new Error('读取片段失败：' + src.fileName); bytes = new Uint8Array(await res.arrayBuffer()); }
          if (!bytes) throw new Error('片段没有可读取的文件：' + src.fileName);
          await ffmpeg.writeFile(name, bytes);
          written.set(key, name);
          scratch.push(name);
        }
        if (layer.image) args.push('-loop', '1', '-framerate', String(fps), '-t', fmt3(Number(layer.offset) + Number(layer.length) + 0.5));
        else if (/\.webm$/.test(name) && layer.video) args.push('-c:v', 'libvpx');
        args.push('-i', name);
        layer.input = inputs++;
      }
      for (const layer of layers) {
        if (!layer.maskPng || !layer.video) continue;
        const maskName = tag + 'mask' + layer.input + '.png';
        await ffmpeg.writeFile(maskName, await bytesOf(layer.maskPng));
        scratch.push(maskName);
        args.push('-loop', '1', '-framerate', String(fps), '-t', fmt3(Number(layer.length) + 0.5), '-i', maskName);
        layer.maskInput = inputs++;
      }
      const keepAlpha = format === 'webm';
      const filters = ['color=c=' + (keepAlpha ? 'black@0' : 'black') + ':s=' + width + 'x' + height + ':r=' + fps + ':d=' + fmt3(duration) + ',format=rgba[base]'];
      let last = 'base';
      const audioLabels = [];
      const videoFade = (layer) => (layer.fadeIn > 0 ? ',fade=t=in:st=' + fmt3(layer.start) + ':d=' + fmt3(layer.fadeIn) + ':alpha=1' : '')
        + (layer.fadeOut > 0 ? ',fade=t=out:st=' + fmt3(layer.start + layer.length - layer.fadeOut) + ':d=' + fmt3(layer.fadeOut) + ':alpha=1' : '');
      const audioFade = (layer) => (layer.fadeIn > 0 ? ',afade=t=in:st=0:d=' + fmt3(layer.fadeIn) : '')
        + (layer.fadeOut > 0 ? ',afade=t=out:st=' + fmt3(layer.length - layer.fadeOut) + ':d=' + fmt3(layer.fadeOut) : '');
      const audioChain = (layer, i) => '[' + layer.input + ':a]atrim=start=' + fmt3(layer.offset) + ':end=' + fmt3(layer.offset + layer.length) + ',asetpts=PTS-STARTPTS' + audioFade(layer) + ',adelay=' + Math.round(layer.start * 1000) + ':all=1[a' + i + ']';
      layers.forEach((layer, i) => {
        const src = layer.source, tr = layer.transform || { centerX: width / 2, centerY: height / 2, scale: 1 };
        const inPoint = Number(layer.offset) || 0, outPoint = inPoint + Number(layer.length);
        if (!layer.video) { if (layer.audio) { filters.push(audioChain(layer, i)); audioLabels.push('[a' + i + ']'); } return; }
        const lw = evenSize(src.width * tr.scale), lh = evenSize(src.height * tr.scale);
        const x = Math.round(tr.centerX - lw / 2), y = Math.round(tr.centerY - lh / 2);
        filters.push('[' + layer.input + ':v]trim=start=' + fmt3(inPoint) + ':end=' + fmt3(outPoint) + ',setpts=PTS-STARTPTS,fps=' + fps + ',scale=' + lw + ':' + lh + ':flags=lanczos,setsar=1,format=rgba' + (layer.alpha ? ',' + ALPHA_FLOOR : '') + '[r' + i + ']');
        let srcLabel = 'r' + i;
        if (layer.maskInput != null) {
          filters.push('[r' + i + ']split=2[rr' + i + '][ra' + i + ']');
          filters.push('[ra' + i + ']alphaextract[sa' + i + ']');
          filters.push('[' + layer.maskInput + ':v]scale=' + lw + ':' + lh + ':flags=lanczos,format=rgba,alphaextract[cov' + i + ']');
          filters.push('[sa' + i + '][cov' + i + ']blend=all_mode=multiply:shortest=1[ma' + i + ']');
          filters.push('[rr' + i + '][ma' + i + ']alphamerge,format=rgba[rm' + i + ']');
          srcLabel = 'rm' + i;
        }
        filters.push('[' + srcLabel + ']setpts=PTS+' + fmt3(layer.start) + '/TB' + videoFade(layer) + '[l' + i + ']');
        filters.push('[' + last + '][l' + i + ']overlay=x=' + x + ':y=' + y + ':format=auto:eof_action=pass:enable=\'between(t,' + fmt3(layer.start) + ',' + fmt3(layer.start + layer.length) + ')\'[o' + i + ']');
        last = 'o' + i;
        if (layer.audio) { filters.push(audioChain(layer, i)); audioLabels.push('[a' + i + ']'); }
      });
      filters.push('[' + last + ']format=' + (keepAlpha ? 'yuva420p' : 'yuv420p') + '[vout]');
      const withAudio = audioLabels.length > 0;
      if (withAudio) filters.push(audioLabels.join('') + 'amix=inputs=' + audioLabels.length + ':duration=longest:normalize=0,apad[aout]');
      const encode = format === 'webm'
        ? ['-c:v', 'libvpx', '-crf', '8', '-qmin', '0', '-qmax', '8', '-b:v', String(clampNumber(Math.round(width * height * fps * 0.12 / 1000), 1500, 24000)) + 'k', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-g', '1', '-metadata:s:v:0', 'alpha_mode=1']
        : ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
      const run = async (audio) => {
        const full = args.slice();
        const graph = audio ? filters : filters.filter((f) => !/\[aout\]$|\[a\d+\]$/.test(f));
        full.push('-filter_complex', graph.join(';'), '-map', '[vout]');
        if (audio) full.push('-map', '[aout]', '-c:a', format === 'webm' ? 'libopus' : 'aac', '-b:a', '160k');
        else full.push('-an');
        full.push(...encode, '-r', String(fps), '-t', fmt3(duration), '-y', outFile);
        ffmpegJob.log = '';
        return ffmpeg.exec(full);
      };
      busy.update(jobId, label, 0);
      let code = await run(withAudio);
      if (code !== 0 && withAudio && !cancelled.has(jobId)) code = await run(false);
      if (cancelled.has(jobId)) { cancelled.delete(jobId); return { ok: false, canceled: true, code: 'export_canceled', jobId }; }
      if (code !== 0) {
        const tail = ffmpegJob.log.split('\n').filter((line) => /error|invalid|failed|unsupported|not found|no such/i.test(line)).slice(-3).join('；');
        throw new Error('ffmpeg 退出码 ' + code + (tail ? '：' + tail.slice(0, 240) : ''));
      }
      const data = await ffmpeg.readFile(outFile);
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const mimeType = format === 'webm' ? 'video/webm' : 'video/mp4';
      const blob = new Blob([bytes], { type: mimeType });
      const fileName = (filePath.split('/').pop() || ('novaflow_video_edit.' + format));
      const token = filePath || ('web-video://' + seq + '/' + fileName);
      const url = URL.createObjectURL(blob);
      videoOutputs.set(token, { tool: 'video-edit', token, blob, fileName, url });
      for (const entry of cache.values()) if (entry && entry.path === token) { entry.blob = blob; entry.bytes = blob.size; }
      await saveToWarehouse(blob, fileName);
      report('done', 1, '视频合成完成');
      return { ok: true, jobId, filePath: token, path: token, blob, url, bytes: blob.size, fileName, format, mimeType, width, height, fps, duration };
    } catch (error) {
      const message = String((error && error.message) || error);
      if (/RuntimeError|memory access|unreachable|abort/i.test(message)) {
        ffmpegPromise = null;
        try { if (typeof ffmpeg.terminate === 'function') ffmpeg.terminate(); } catch (_) { /* already gone */ }
      }
      report('error', 0, message);
      return fail(cancelled.has(jobId) ? 'export_canceled' : ('视频合成失败：' + message), { jobId });
    } finally {
      relay();
      busy.end(jobId);
      compositorJobs.delete(jobId);
      cancelled.delete(jobId);
      if (ffmpegPromise) for (const name of scratch) await ffmpeg.deleteFile(name).catch(() => {});
      ffmpegJob = null;
    }
  };

  // 音频编辑's 保存混合视频: the reference video's picture (stream copy when the
  // container matches) with the mixed-down audio in its place; the video's length.
  api.videoEditorMux = async (payload) => {
    const options = payload || {};
    const source = options.video || {};
    const audio = options.audio;
    if (!audio) return fail('没有混音数据');
    const format = String(options.format || 'mp4').toLowerCase() === 'webm' ? 'webm' : 'mp4';
    const filePath = String(options.filePath || '');
    const durationSec = Number(source.durationSec) || 0;
    jobSeq += 1;
    const jobId = 'web-vm-job-' + jobSeq;
    const report = (stage, progress01, message) => compositorProgress.emit({ jobId, stage, progress01, message });
    report('prepare', 0, '准备视频与混音');
    const ffmpeg = await loadFfmpeg();
    compositorJobs.set(jobId, ffmpeg);
    const seq = ++videoOutputSeq;
    const tag = 'mux' + seq + '_';
    const ext = (String(source.fileName || '').split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
    const vName = tag + 'v.' + ext, aName = tag + 'a.wav', outFile = tag + 'out.' + format;
    const label = '正在封装混合视频…';
    ffmpegJob = { jobId, last: -1, log: '', label };
    const relay = videoToolProgress.subscribe((event) => { if (event && event.jobId === jobId) report('render', event.progress01, '封装中 ' + Math.round(event.progress01 * 100) + '%'); });
    busy.begin(jobId, label);
    try {
      let bytes = null;
      if (source.blob) bytes = await bytesOf(source.blob);
      else if (source.url) { const res = await root.fetch(source.url); if (!res.ok) throw new Error('读取视频失败'); bytes = new Uint8Array(await res.arrayBuffer()); }
      if (!bytes) throw new Error('参照视频没有可读取的文件');
      await ffmpeg.writeFile(vName, bytes);
      await ffmpeg.writeFile(aName, await bytesOf(audio));
      const copyOk = (format === 'mp4' && ext === 'mp4') || (format === 'webm' && ext === 'webm');
      const videoCodec = copyOk ? ['-c:v', 'copy'] : (format === 'webm' ? ['-c:v', 'libvpx', '-crf', '8', '-b:v', '6000k'] : ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p']);
      const args = ['-i', vName, '-i', aName, '-map', '0:v:0', '-map', '1:a:0', ...videoCodec, '-c:a', format === 'webm' ? 'libopus' : 'aac', '-b:a', '160k', '-af', 'apad'];
      if (durationSec > 0) args.push('-t', fmt3(durationSec)); else args.push('-shortest');
      if (format === 'mp4') args.push('-movflags', '+faststart');
      args.push('-y', outFile);
      ffmpegJob.log = '';
      const code = await ffmpeg.exec(args);
      if (cancelled.has(jobId)) { cancelled.delete(jobId); return { ok: false, canceled: true, code: 'export_canceled', jobId }; }
      if (code !== 0) {
        const tail = ffmpegJob.log.split('\n').filter((line) => /error|invalid|failed|unsupported|not found|no such/i.test(line)).slice(-3).join('；');
        throw new Error('ffmpeg 退出码 ' + code + (tail ? '：' + tail.slice(0, 240) : ''));
      }
      const data = await ffmpeg.readFile(outFile);
      const out = data instanceof Uint8Array ? data : new Uint8Array(data);
      const mimeType = format === 'webm' ? 'video/webm' : 'video/mp4';
      const blob = new Blob([out], { type: mimeType });
      const fileName = (filePath.split('/').pop() || ('novaflow_video_mix.' + format));
      const token = filePath || ('web-video://' + seq + '/' + fileName);
      const url = URL.createObjectURL(blob);
      videoOutputs.set(token, { tool: 'video-mix', token, blob, fileName, url });
      for (const entry of cache.values()) if (entry && entry.path === token) { entry.blob = blob; entry.bytes = blob.size; }
      await saveToWarehouse(blob, fileName);
      report('done', 1, '混合视频完成');
      return { ok: true, jobId, filePath: token, path: token, blob, url, bytes: blob.size, fileName, format, mimeType };
    } catch (error) {
      const message = String((error && error.message) || error);
      report('error', 0, message);
      return fail('混合视频失败：' + message, { jobId });
    } finally {
      relay();
      busy.end(jobId);
      compositorJobs.delete(jobId);
      cancelled.delete(jobId);
      if (ffmpegPromise) for (const name of [vName, aName, outFile]) await ffmpeg.deleteFile(name).catch(() => {});
      ffmpegJob = null;
    }
  };

  runtime.capabilities = {
    fileSystemAccess: canUseFileSystemAccess,
    directoryPicker: typeof root.showDirectoryPicker === 'function',
    mediaRecorder: typeof root.MediaRecorder === 'function',
    webCodecs: typeof root.VideoEncoder === 'function',
    // What genuinely has no Web equivalent, for the limitations report.
    unavailable: ['osFilePaths', 'openOutputFolder', 'localRuntimeControl']
  };
  // ---------------------------------------------------------------- AI 抠图
  //
  // The 视频抠图 button used to answer "AI分割仅桌面版支持（需要本地
  // Python+rembg）" to every Web user, because this file never defined
  // aiSeqRembgBatch and the panel hard-guards on it. Two thirds of that
  // sentence were also untrue: the desktop stopped using rembg long ago and
  // forces BiRefNet (particle-editor-desktop/main.js:7854).
  //
  // What the panel actually needs is one member that takes a job and hands
  // back one 8-bit alpha plane per decoded frame. The desktop answers it from
  // a local Python process; here it is answered by the compute node, over the
  // same task queue and the same tunnel every other Web feature uses.
  //
  // Three pieces of the panel's contract shape everything below, and each was
  // read out of the shipped bundle rather than assumed:
  //
  //   1. The alpha planes are MANDATORY. The panel validates them and throws
  //      before it ever looks at a finished video, so "just return the WebM"
  //      is not an option however much simpler it sounds.
  //   2. The planes must be at the BROWSER's native videoWidth/videoHeight.
  //      NovaFlowCutoutPipeline is built from those before we are called and
  //      silently drops anything else - a green screen then falls back to
  //      chroma-key with no error at all. So no downscaling, ever.
  //   3. Streamed preview bytes and the final alphaBytes must be IDENTICAL:
  //      commit() compares them and throws the whole prewarm away on a single
  //      mismatch. Hence one buffer, inflated once, with the chunks emitted as
  //      views into it - never a second copy.
  const MATTING_TASK_TYPE = 'video_matting';

  const rembgProgress = channel();
  const rembgMaskChunk = channel();

  api.onAiSeqRembgBatchProgress = (cb) => rembgProgress.subscribe(cb);
  api.onAiSeqRembgMaskChunk = (cb) => rembgMaskChunk.subscribe(cb);

  // The panel reads {state, message, progress01} and DISCARDS any event whose
  // message is empty - `t&&oe({...})` in the bundle. An empty string here is
  // not a quiet update, it is a dropped one, so every caller passes text.
  function reportMatting(jobId, state, message, progress01) {
    const text = String(message || '');
    if (!text) return;
    rembgProgress.emit({
      jobId: jobId,
      state: state,
      message: text,
      progress01: typeof progress01 === 'number' ? Math.max(0, Math.min(1, progress01)) : undefined
    });
  }

  // Send the renderer's verified PNG snapshots, not a second video decode.
  // A pack has repeated little-endian { index:u32, length:u32, PNG bytes }.
  // Multiple frames share an upload, within the gateway's 64 MB/file limit.
  function packCapturedFrames(frames) {
    const packs = [], parts = [];
    let size = 0;
    const flush = () => {
      if (!parts.length) return;
      packs.push(new Blob(parts, { type: 'application/octet-stream' }));
      parts.length = 0; size = 0;
    };
    for (let index = 0; index < frames.length; index++) {
      const bytes = frames[index]?.bytes;
      const length = Number(bytes?.byteLength) || 0;
      if (!length) throw new Error('第 ' + index + ' 帧缺少捕获数据');
      if (length + 8 > 64 * 1024 * 1024) throw new Error('单帧数据超过上传限制');
      if (size + length + 8 > 64 * 1024 * 1024) flush();
      const header = new Uint8Array(8), view = new DataView(header.buffer);
      view.setUint32(0, index, true); view.setUint32(4, length, true);
      parts.push(header, bytes); size += length + 8;
    }
    flush();
    if (packs.length > 4) throw new Error('视频帧数据超过 256 MB，请先截短视频');
    return packs;
  }

  api.aiSeqRembgBatch = async (payload) => {
    const jobId = String((payload && payload.jobId) || '');
    const runtime = root.NovaFlowWebRuntime;
    if (!runtime) return { ok: false, jobId, error: 'Web 运行时未加载，无法提交抠图任务' };

    if (payload?.kind === 'image') return { ok: false, jobId, error: '此入口用于视频抠图，单张图片请使用美工抠图工具' };
    const frames = Array.isArray(payload && payload.rendererDecodedFrames) ? payload.rendererDecodedFrames : [];
    const width = Number(payload && payload.rendererFrameWidth) || 0;
    const height = Number(payload && payload.rendererFrameHeight) || 0;
    const totalFrames = Number(payload && payload.totalFrames) || frames.length;

    if (!frames.length) return { ok: false, jobId, error: '没有可抠图的帧' };
    if (!width || !height) return { ok: false, jobId, error: '读不到画面尺寸，无法抠图' };

    let taskId = '', stage = '准备视频帧';
    try {
      reportMatting(jobId, 'running', '正在准备素材…', 0.02);

      const packs = packCapturedFrames(frames);
      const references = packs.map((pack, index) => ({ name: 'frames-' + index + '.bin', kind: 'frames', bytes: pack.size }));
      reportMatting(jobId, 'running', '正在排队等待算力…', 0.05);
      stage = '提交抠图任务';
      const created = await runtime.control('POST', '/api/web/tasks', {
        task_type: MATTING_TASK_TYPE,
        parameters: {
          width: width,
          height: height,
          fps: Number(payload && payload.fps) || 0,
          frame_count: frames.length,
          // Keep timestamps as metadata without the generic 256-item array
          // truncation. Pixel identity comes from the captured PNG packs.
          frame_times_f32: packFloat32(frames.map((f) => Number(f.mediaTime ?? f.timeSec ?? f.clampedTimeSec ?? 0))),
          return_mask_only: payload.returnMaskOnly !== false,
          input_encoding: 'png-frames-v1',
          source_name: String((payload && payload.video && payload.video.fileName) || 'input.mp4')
        },
        references
      });

      taskId = created.task.id;
      stage = '上传视频帧';
      for (let index = 0; index < packs.length; index++) {
        await runtime.putTaskInput(taskId, references[index].name, packs[index], (seconds) => {
          reportMatting(jobId, 'running', '正在等待算力接收视频帧…（' + seconds + 's）', 0.06);
        }, { retryConnection: true, onRetry: attempt => {
          reportMatting(jobId, 'running', '上传连接中断，正在重连算力节点…（' + attempt + '/2）', 0.06);
        } });
      }
      reportMatting(jobId, 'running', '已送达算力节点，开始 AI 分割…', 0.12);

      stage = '等待 AI 抠图结果';
      const done = await waitForMatting(runtime, taskId, jobId);
      const manifest = (done.output_manifest && done.output_manifest.files) || [];
      const maskFile = manifest.find((f) => /^mask[-.]/.test(String(f.name || '')));
      if (!maskFile) throw new Error('算力节点没有返回遮罩文件');

      reportMatting(jobId, 'running', '正在取回遮罩…', 0.9);
      stage = '下载抠图遮罩';
      const packed = await runtime.fetchTaskOutput(done, maskFile.name);

      // One allocation for the whole job. Every streamed chunk below is a view
      // into this exact buffer, so the panel's commit() byte-compare is
      // comparing memory with itself and cannot spuriously fail.
      const stride = width * height;
      const alphaBytes = new Uint8Array(stride * frames.length);
      const decodedFrameIndices = [];

      await unpackMasks(packed, stride, frames.length, (index, plane) => {
        alphaBytes.set(plane, index * stride);
        decodedFrameIndices.push(Number(frames[index].decodedFrameIndex));
        rembgMaskChunk.emit({
          jobId: jobId,
          width: width,
          height: height,
          decodedFrameIndices: [Number(frames[index].decodedFrameIndex)],
          alphaBytes: alphaBytes.subarray(index * stride, (index + 1) * stride)
        });
      });

      // Both of these are silent-corruption guards, not paranoia. A short
      // result leaves U.current.get(i) undefined for the missing frames and
      // the panel degrades to chroma-key without saying anything; a
      // wrong-sized plane is dropped by subjectOpacity for the same reason.
      if (decodedFrameIndices.length !== frames.length) {
        throw new Error('算力节点只返回了 ' + decodedFrameIndices.length + '/' + frames.length + ' 帧遮罩');
      }
      if (totalFrames && frames.length !== totalFrames) {
        throw new Error('遮罩帧数与画面帧数不一致：' + frames.length + ' ≠ ' + totalFrames);
      }

      const result = {
        ok: true,
        jobId: jobId,
        width: width,
        height: height,
        frames: frames.length,
        decodedFrameIndices: decodedFrameIndices,
        alphaBytes: alphaBytes,
        alphaEncoding: 'u8-mask-v1',
        alphaByteLength: alphaBytes.byteLength
      };

      // The finished WebM is optional to the panel and read only after the
      // alpha contract passes. When the node made one, hand it over so 保存进
      // 资源列表 does not have to re-encode in the browser.
      const videoFile = manifest.find((f) => /\.webm$/i.test(String(f.name || '')));
      if (videoFile && payload.returnMaskOnly === false) {
        try {
          const bytes = await runtime.fetchTaskOutput(done, videoFile.name);
          result.outVideoBase64 = base64FromBytes(bytes);
          result.outVideoFileName = videoFile.name;
        } catch (_) { /* the mattes are what the panel requires; the video is a bonus */ }
      }
      reportMatting(jobId, 'done', '抠图完成', 1);
      return result;
    } catch (error) {
      let cancelConfirmed = !taskId;
      if (taskId) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await runtime.control('POST', '/api/web/tasks/' + taskId + '/cancel', {});
            cancelConfirmed = true;
            break;
          } catch (cancelError) {
            const transient = [502, 503, 504].includes(cancelError?.status)
              || (!cancelError?.status && /failed to fetch|fetch failed|network|load failed/i.test(String(cancelError?.message || cancelError)));
            if (!transient || attempt === 2) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      const rawMessage = String((error && error.message) || error);
      const message = error?.status === 401 || /missing session token|invalid session|session expired/i.test(rawMessage)
        ? '登录已失效，请点顶栏右上角的账号按钮重新登录后重试抠图'
        : stage + '失败：' + rawMessage + (!cancelConfirmed ? '；任务取消尚未确认，请检查算力连接' : '');
      reportMatting(jobId, 'error', message, undefined);
      return { ok: false, jobId, error: message };
    }
  };

  function packFloat32(values) {
    const view = new Float32Array(values);
    const bytes = new Uint8Array(view.buffer);
    return base64FromBytes(bytes);
  }

  function base64FromBytes(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    }
    return root.btoa(binary);
  }

  async function waitForMatting(runtime, taskId, jobId) {
    const deadline = Date.now() + 30 * 60 * 1000;
    for (;;) {
      const res = await runtime.control('GET', '/api/web/tasks/' + taskId);
      const task = res.task || {};
      if (task.status === 'completed') return task;
      if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired') {
        throw new Error(task.error_message || task.error_code || ('任务' + task.status));
      }
      if (Date.now() >= deadline) throw new Error('视频抠图等待超时，请检查算力节点后重试');
      const note = String(task.progress_note || '').trim();
      const pct = Number(task.progress) || 0;
      reportMatting(jobId, 'running', note || 'AI 分割中…', 0.12 + (pct / 100) * 0.75);
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  // The node ships one file: a frame index, a byte length and a deflate block
  // per frame, concatenated. Per-frame framing costs nothing against one big
  // stream (measured: 11.0MB either way) and it is what lets the panel start
  // prewarming before the last frame has arrived.
  async function unpackMasks(packed, stride, count, onFrame) {
    const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
    let offset = 0;
    let seen = 0;

    while (offset + 8 <= packed.byteLength && seen < count) {
      const index = view.getUint32(offset, true);
      const length = view.getUint32(offset + 4, true);
      offset += 8;
      if (index !== seen) throw new Error('遮罩帧序号不连续：' + index + ' ≠ ' + seen);
      if (length <= 0 || offset + length > packed.byteLength) throw new Error('遮罩文件不完整');

      const block = packed.subarray(offset, offset + length);
      offset += length;

      const plane = await inflateMaskBlock(block);
      if (plane.length !== stride) {
        throw new Error('第 ' + index + ' 帧遮罩尺寸不符：' + plane.length + ' ≠ ' + stride);
      }
      onFrame(index, plane);
      seen += 1;
    }
    if (seen !== count || offset !== packed.byteLength) throw new Error('遮罩文件帧数或长度不匹配');
    return seen;
  }

  async function inflateMaskBlock(block) {
    // DecompressionStream is already how this file and the green-screen
    // matting read compressed payloads, so the mask blob costs no new
    // dependency and no WASM.
    const stream = new root.Response(
      new Blob([block]).stream().pipeThrough(new root.DecompressionStream('deflate'))
    );
    return new Uint8Array(await stream.arrayBuffer());
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

// ---------------------------------------------------------------------------
// The rest of the surface the renderer reaches for.
//
// Every one of these exists in Electron's preload. A browser can do most of
// them differently; the few it genuinely cannot are answered with a reason.
// ---------------------------------------------------------------------------
(function (root) {
  'use strict';
  const api = root.electronAPI;
  const runtime = root.NovaFlowWebRuntime;
  if (!api || !runtime) return;

  const ok = (result) => ({ ok: true, result });
  const fail = (error) => ({ ok: false, error: String(error) });

  // ---- window controls --------------------------------------------------
  //
  // The renderer draws its own titlebar. A tab has no frame to minimise, but
  // maximise maps onto fullscreen and close onto window.close(), so the
  // buttons do something sensible instead of throwing.
  // Two bits of desktop chrome the Web build hides, for the same reason:
  // a control that cannot do what it says is worse than no control.
  //
  //   minimize / maximize / close - the browser tab already has these above
  //     the page, and two of the three cannot work from inside a page at all.
  //
  //   释放内存 - on the desktop this frees the LOCAL ComfyUI's VRAM. Here the
  //     GPU belongs to somebody else's machine; a user of the Web app has no
  //     business unloading it and no way to. Pressing it could only ever
  //     clear a cache in this tab while implying it did something to a GPU.
  //
  //   已授权 - there is no licence gate on the Web at all (a licence binds to a
  //     machine code and a tab has none), so this badge can only ever read
  //     已授权. A status that cannot change is not status, it is decoration -
  //     and clicking it opened a machine-code dialog that leads nowhere.
  //
  // The methods behind them stay and answer honestly, because the renderer
  // still calls them from a shortcut or a status refresh.
  (function hideDesktopOnlyChrome() {
    const STYLE_ID = 'novaflow-web-hide-desktop-chrome';
    if (root.document.getElementById(STYLE_ID)) return;
    const style = root.document.createElement('style');
    style.id = STYLE_ID;
    // .nf-topbar-right holds nothing but the three window buttons.
    style.textContent =
      '.nf-topbar-right, .nf-win-btn, .nf-license-status,' +
      ' [data-novaflow-topbar-ai-runtime-release="1"] { display: none !important; }';
    (root.document.head || root.document.documentElement).appendChild(style);
  })();

  api.windowMinimize = async () => fail('浏览器标签页不能最小化');

  api.windowToggleMaximize = async () => {
    try {
      if (root.document.fullscreenElement) {
        await root.document.exitFullscreen();
        return ok({ maximized: false });
      }
      await root.document.documentElement.requestFullscreen();
      return ok({ maximized: true });
    } catch (error) {
      return fail(error && error.message ? error.message : error);
    }
  };

  api.windowClose = async () => {
    // Only a script-opened window may close itself; otherwise say so rather
    // than silently doing nothing.
    try {
      root.close();
      return ok({ closed: true });
    } catch (_) {
      return fail('浏览器不允许脚本关闭这个标签页，请直接关闭');
    }
  };

  api.windowIsMaximized = async () => ok({ maximized: Boolean(root.document.fullscreenElement) });

  // ------------------------------------------- the rest of the desktop API
  //
  // An audit of proxy-electron-api.js - the implementation the renderer was
  // written against - found ten methods the Web line never answered. Left
  // alone they fall through to that implementation, which builds a localhost
  // URL; on the Web that is the VIEWER's machine, so they would hang or fail
  // with something unreadable. Five bugs had already reached users this way,
  // each found by somebody clicking the one button that reached it.
  //
  // Each one below either does the Web-appropriate thing or says plainly why
  // there isn't one. None of them pretends.

  // Restarting a runtime means restarting somebody else's machine.
  api.runtimeRestart = async () => {
    const status = await api.runtimeGetStatus();
    return Object.assign({}, status, {
      ok: false,
      detail: 'Web 版不能重启算力节点，请让算力提供者在 NovaFlow Worker 里操作'
    });
  };

  // A browser cannot open a folder on anyone's disk. Results are fetched from
  // the worker's gateway and saved through the browser's own download.
  const noFolder = (what) => fail(
    'Web 版打不开' + what + '：文件在算力节点上，请用页面里的下载/导出取回'
  );
  api.runtimeOpenAssetsFolder = async () => noFolder('素材目录');
  api.runtimeOpenLogsFolder = async () => noFolder('日志目录');
  api.runtimeOpenInstallFolder = async () => noFolder('安装目录');

  // There is no licence on the Web - licenseGetState above says why. These read
  // the answer back from it rather than restating it, so there is one place the
  // Web licence is described and these cannot drift from it.
  const licence = async () => {
    try {
      const state = await api.licenseGetState();
      return (state && state.state) || state || {};
    } catch (_) {
      return {};
    }
  };
  api.licenseGetMachineId = async () => ok({ machineId: 'web', reason: '浏览器没有机器码' });
  api.licenseImportFile = async () => ok(Object.assign({ imported: false, alreadyLicensed: true }, await licence()));
  api.licenseImportText = async () => ok(Object.assign({ imported: false, alreadyLicensed: true }, await licence()));
  api.licenseRemove = async () => ok(Object.assign({ removed: false }, await licence()));
  api.licenseOpenMain = async () => ok({ opened: false, reason: 'Web 版没有授权窗口' });

  // The pre-flight and the post-hoc record for a paid provider task
  // (可灵 / 即梦). On the desktop both ask the local admin server on 4761; here
  // the authority is the control plane, which settles a task when the worker
  // reports it finished. Self-hosted work needs neither - it costs nothing.
  //
  // Both answer from the same place so the caller's credit display stays true:
  // it reads `credits` off whatever comes back and re-renders from it.
  const session = async (detail, extra) => {
    try {
      const me = await runtime.control('GET', '/api/web/me');
      return Object.assign({ ok: true, httpStatus: 200, credits: me.credits, user: me.user, detail }, extra || {});
    } catch (error) {
      const status = error.status === 401 ? 401 : 502;
      return {
        ok: false,
        httpStatus: status,
        error: status === 401
          ? '请先登录 NovaFlow 账号（点顶栏右上角的「登录」）'
          : String(error.message || error)
      };
    }
  };

  api.clientAuthAiTaskAuthorize = async (payload) => session(
    '自有算力任务不计积分；付费模型按次结算',
    { requested: (payload && (payload.taskType || payload.task_type)) || null }
  );

  // Nothing to commit: the control plane settles from the worker's report, not
  // from the browser, which cannot be trusted to report its own usage. This
  // returns the settled balance rather than pretending to have written one.
  api.clientAuthAiTaskCommitUsage = async () => session(
    '用量由控制面在算力节点回报后结算，浏览器不记账'
  );

  // ---- clipboard ---------------------------------------------------------
  api.clipboardWriteText = async (text) => {
    try {
      await root.navigator.clipboard.writeText(String(text == null ? '' : text));
      return ok({ copied: true });
    } catch (error) {
      return fail('复制失败：' + (error && error.message ? error.message : error));
    }
  };

  api.clipboardReadText = async () => {
    try { return ok({ text: await root.navigator.clipboard.readText() }); }
    catch (error) { return fail(error && error.message ? error.message : error); }
  };

  // ---- pickers -----------------------------------------------------------
  /**
   * Pick a folder to write into.
   *
   * Answers the way the desktop's pick-directory does - { canceled, dir } at
   * the top level - because that is what every caller reads (工具's 导出另存,
   * the sequence exporters); the previous { ok, result } shape read as
   * "canceled" to all of them. `dir` is a token for the folder handle, and
   * writeBinaryFile below writes straight into that folder with it.
   */
  const directoryHandles = new Map();
  let directorySeq = 0;
  async function resolveWritableDirectory(dir) {
    const token = String(dir || '');
    const direct = directoryHandles.get(token);
    if (direct) return direct;
    for (const [base, handle] of directoryHandles) {
      if (!token.startsWith(base) || !/^[\\/]/.test(token.slice(base.length))) continue;
      const segments = token.slice(base.length).split(/[\\/]+/).filter(Boolean);
      if (segments.some((segment) => segment === '.' || segment === '..')) return null;
      let folder = handle;
      for (const segment of segments) folder = await folder.getDirectoryHandle(segment, { create: true });
      return folder;
    }
    return null;
  }
  api.pickDirectory = async () => {
    if (typeof root.showDirectoryPicker !== 'function') {
      return fail('这个浏览器不支持选择文件夹，请改用拖拽或逐个选择文件', { canceled: false });
    }
    try {
      const handle = await root.showDirectoryPicker({ mode: 'readwrite' });
      directorySeq += 1;
      const dir = 'web-directory://' + directorySeq + '/' + handle.name;
      directoryHandles.set(dir, handle);
      return { ok: true, canceled: false, dir, name: handle.name, handle, path: dir };
    } catch (error) {
      if (error && error.name === 'AbortError') return { ok: true, canceled: true };
      return fail(error && error.message ? error.message : error, { canceled: false });
    }
  };

  // ---- 骨骼动画 → 导入工程 ------------------------------------------------
  //
  // The import panel asks the host for its files: openSpineJson / openSpineAtlas
  // / openSpineImage for one file each, openSpineProject for the whole set, all
  // answering { canceled } or the desktop's { fileName, text } / { images }
  // shapes. Without them the panel falls back to a hidden input that only
  // exists while its modal is open, so on the Web the 导入 buttons did nothing.
  //
  // A .skel is taken wherever a .json is: spine-skel-import.js turns the
  // Spine 3.8 binary into the JSON text the panel reads.
  const pickFiles = (accept, multiple) => {
    // Tests drive this instead of a native dialog.
    if (typeof root.NovaFlowWebFilePicker === 'function') return Promise.resolve(root.NovaFlowWebFilePicker({ accept, multiple }));
    return new Promise((resolve) => {
      const input = root.document.createElement('input');
      input.type = 'file';
      input.multiple = !!multiple;
      input.accept = accept;
      input.style.display = 'none';
      let settled = false;
      const finish = (files) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(files && files.length ? files : null);
      };
      input.addEventListener('change', () => finish([...(input.files || [])]));
      input.addEventListener('cancel', () => finish(null));
      root.document.body.appendChild(input);
      input.click();
    });
  };
  const isSkelName = (name) => /\.skel$/i.test(String(name || ''));
  const readText = (file) => file.text();
  const readDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new root.FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取 ' + file.name + ' 失败'));
    reader.readAsDataURL(file);
  });
  /** A skeleton file as the panel wants it: JSON text, from a .json or a .skel. */
  async function readSpineSkeleton(file) {
    if (!isSkelName(file.name)) return { fileName: file.name, text: await readText(file) };
    const converter = root.NovaFlowSpineSkel;
    if (!converter || typeof converter.toJson !== 'function') throw new Error('.skel 转换器未加载，请刷新页面后重试');
    const { text, version } = converter.toJson(new Uint8Array(await file.arrayBuffer()));
    return { fileName: file.name.replace(/\.skel$/i, '.json'), text, sourceFileName: file.name, convertedFromSkel: true, spineVersion: version };
  }
  const tell = (message) => { try { root.alert(message); } catch (_) { console.error('[novaflow-web]', message); } };

  api.openSpineJson = async () => {
    const files = await pickFiles('.json,.skel,application/json', false);
    if (!files) return { canceled: true };
    try {
      return Object.assign({ canceled: false }, await readSpineSkeleton(files[0]));
    } catch (error) {
      const message = String((error && error.message) || error);
      tell('导入 Skeleton 失败：' + message);
      return { canceled: true, error: message };
    }
  };
  api.openSpineJson.readFile = readSpineSkeleton;
  api.openSpineAtlas = async () => {
    const files = await pickFiles('.atlas', false);
    if (!files) return { canceled: true };
    return { canceled: false, fileName: files[0].name, text: await readText(files[0]) };
  };
  api.openSpineImage = async () => {
    const files = await pickFiles('image/png,.png,image/jpeg,.jpg,.jpeg', true);
    if (!files) return { canceled: true };
    const images = await Promise.all(files.map(async (file) => ({ fileName: file.name, dataUrl: await readDataUrl(file) })));
    return { canceled: false, fileName: images[0].fileName, dataUrl: images[0].dataUrl, images };
  };
  api.openSpineProject = async () => {
    const files = await pickFiles('.json,.skel,.atlas,image/png,.png,image/jpeg,.jpg,.jpeg', true);
    if (!files) return { canceled: true };
    try {
      const skeletons = files.filter((file) => /\.(json|skel)$/i.test(file.name));
      const atlases = files.filter((file) => /\.atlas$/i.test(file.name));
      const images = files.filter((file) => /\.(png|jpe?g)$/i.test(file.name));
      if (skeletons.length !== 1) throw new Error('请选择 1 个 Skeleton（.json 或 .skel），当前 ' + skeletons.length + ' 个');
      const skeleton = await readSpineSkeleton(skeletons[0]);
      return {
        canceled: false,
        jsonFileName: skeleton.fileName,
        jsonText: skeleton.text,
        convertedFromSkel: !!skeleton.convertedFromSkel,
        atlases: await Promise.all(atlases.map(async (file) => ({ fileName: file.name, text: await readText(file) }))),
        images: await Promise.all(images.map(async (file) => ({ fileName: file.name, dataUrl: await readDataUrl(file) })))
      };
    } catch (error) {
      return { canceled: true, error: String((error && error.message) || error) };
    }
  };

  // ---- file writing ------------------------------------------------------
  api.writeBinaryFile = async (payload) => {
    const options = payload || {};
    // A web-temp:// folder (exportCreateTempDir) collects the frames of a clip
    // being encoded; nothing there touches disk or asks anything.
    const tempFiles = api.__webTempDirs && api.__webTempDirs.get(String(options.dir || ''));
    if (tempFiles) {
      const fileName = String(options.fileName || options.path || 'frame.png').split(/[\\/]/).pop();
      const data = options.data || options.buffer || options.bytes;
      if (!data) return fail('Web 版需要在保存时一并提供文件内容');
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer())
        : data instanceof ArrayBuffer ? new Uint8Array(data)
          : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : Uint8Array.from(data);
      tempFiles.set(fileName, bytes);
      return ok({ saved: true, name: fileName, dir: options.dir, via: 'web-temp' });
    }
    // Into the folder pickDirectory handed out, when the caller went through
    // it; otherwise the save dialog, one file at a time.
    let folder;
    try { folder = await resolveWritableDirectory(options.dir); }
    catch (error) { return fail(error && error.message ? error.message : error); }
    if (folder) {
      try {
        const fileName = String(options.fileName || options.path || 'novaflow-output.bin').split(/[\\/]/).pop();
        const data = options.data || options.buffer || options.bytes;
        if (!data) return fail('Web 版需要在保存时一并提供文件内容', { code: 'web_needs_data' });
        const fileHandle = await folder.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data instanceof Blob ? data : new Blob([Array.isArray(data) ? Uint8Array.from(data) : data]));
        await writable.close();
        return ok({ saved: true, name: fileName, dir: options.dir, via: 'file-system-access' });
      } catch (error) {
        if (error && error.name === 'AbortError') return ok({ canceled: true });
        return fail(error && error.message ? error.message : error);
      }
    }
    return await api.exportPickSaveFile({
      defaultPath: options.path || options.fileName || 'novaflow-output.bin',
      data: options.data || options.buffer || options.bytes,
      mimeType: options.mimeType || 'application/octet-stream'
    });
  };

  api.exportCleanupDir = async (payload) => {
    const dir = String((payload && payload.dir) || '');
    if (api.__webTempDirs && api.__webTempDirs.delete(dir)) return ok({ cleaned: true, dir });
    return ok({ cleaned: true, note: 'Web 版没有导出临时目录' });
  };

  // ---- misc runtime ------------------------------------------------------
  api.minimaxH3RuntimeEnsureStarted = async () => api.runtimeEnsureStarted();

  api.videoResourceMediaRegister = async (payload) => {
    // A result of MP4 压缩 / 视频格式转换: hand back a URL the preview can play.
    const outputs = root.NovaFlowWebRuntime && root.NovaFlowWebRuntime.videoOutputs;
    const held = outputs ? outputs.get(String((payload && payload.filePath) || '')) : null;
    if (held) {
      if (!held.url) held.url = URL.createObjectURL(held.blob);
      return { ok: true, url: held.url, token: held.token, key: held.token, registered: true };
    }
    const key = String((payload && (payload.key || payload.id)) || 'media-' + Date.now());
    return ok({ key, registered: true });
  };


})(typeof globalThis !== 'undefined' ? globalThis : this);

// ---------------------------------------------------------------------------
// Spine 图集稳妥压缩.
//
// 工具 → PNG 压缩 → Spine 图集 was the one tab whose 开始压缩 button stayed
// disabled in the browser: the panel enables it on
// `window.electronAPI.compressSpineAtlasSafe`, which only the desktop preload
// had. On the desktop that handler is sharp with `palette: false` - a PNG
// re-encode that keeps every stored RGBA byte and only rewrites the filtering
// and the deflate stream.
//
// That is reproducible in a browser, and it is NOT the canvas re-encode the
// 普通 PNG tab falls back to. Canvas premultiplies on the way in and
// unpremultiplies on the way out, so a semi-transparent pixel comes back a
// shade off and a fully transparent pixel loses its RGB entirely. A Spine
// atlas is exactly the file where that matters: PMA pages carry colour under
// low alpha, and the transparent margin around every region carries the colour
// the runtime bleeds into the edge texels. So this decodes the PNG itself -
// inflate, unfilter - and re-encodes the same samples, never letting the
// pixels through a canvas.
//
// What it does not do is the 增强 (PMA, 55-100) path: that one quantises to a
// palette, which is pngquant's job and has no browser equivalent. It keeps its
// own hint and its own disabled button.
// ---------------------------------------------------------------------------
(function (root) {
  'use strict';

  const api = root.electronAPI;
  if (!api) return;
  // A desktop preload answers this for real; never shadow it.
  if (typeof api.compressSpineAtlasSafe === 'function') return;
  // Compression Streams is the entire engine here. Where it is missing there
  // is nothing to install, and the panel keeps its existing hint rather than
  // offering a button that cannot work.
  if (typeof root.CompressionStream !== 'function' || typeof root.DecompressionStream !== 'function') return;

  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  // Channels per colour type: 0 grey, 2 truecolour, 3 palette, 4 grey+alpha,
  // 6 truecolour+alpha.
  const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  // Dropped on re-encode: none of it is pixels, and none of it is colour.
  // Everything else that precedes IDAT - PLTE, tRNS, and the colour chunks
  // sRGB / gAMA / cHRM / iCCP / sBIT - is carried across verbatim, so the
  // output renders identically and not merely "with the same pixels".
  const DROPPED_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME', 'pHYs', 'hIST', 'eXIf', 'bKGD', 'sPLT', 'oFFs']);
  // One IDAT per MiB, the way every other encoder writes them.
  const IDAT_SPLIT = 1024 * 1024;
  // Past this, the filter passes cost more than a second strategy can win
  // back, so a big page gets one attempt and a fast answer.
  const SINGLE_STRATEGY_BYTES = 32 * 1024 * 1024;

  const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = -1;
    for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function bytesFromDataUrl(dataUrl) {
    const text = String(dataUrl || '');
    const comma = text.indexOf(',');
    if (comma < 0) throw new Error('图片数据无效');
    const binary = root.atob(text.slice(comma + 1));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }

  const through = async (bytes, stream) =>
    new Uint8Array(await new root.Response(new root.Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

  const inflate = (bytes) => through(bytes, new root.DecompressionStream('deflate'));
  const deflate = (bytes) => through(bytes, new root.CompressionStream('deflate'));

  /** Split a PNG into its chunks, in file order. */
  function readChunks(bytes) {
    if (bytes.length < 8 || SIGNATURE.some((value, index) => bytes[index] !== value)) {
      throw new Error('不是 PNG 文件');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunks = [];
    let offset = 8;
    while (offset + 8 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      const start = offset + 8;
      if (start + length + 4 > bytes.length) throw new Error('PNG 数据不完整');
      chunks.push({ type, data: bytes.subarray(start, start + length) });
      offset = start + length + 4;
      if (type === 'IEND') break;
    }
    if (!chunks.length || chunks[0].type !== 'IHDR') throw new Error('PNG 缺少 IHDR');
    return chunks;
  }

  function readHeader(data) {
    if (data.length < 13) throw new Error('PNG 头部损坏');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const header = {
      width: view.getUint32(0),
      height: view.getUint32(4),
      bitDepth: data[8],
      colorType: data[9],
      interlace: data[12]
    };
    const channels = CHANNELS[header.colorType];
    if (!channels) throw new Error('PNG 颜色类型不支持：' + header.colorType);
    if (!header.width || !header.height) throw new Error('PNG 尺寸无效');
    const bitsPerPixel = channels * header.bitDepth;
    header.bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
    header.stride = Math.ceil((header.width * bitsPerPixel) / 8);
    return header;
  }

  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  };

  /** Filtered scanlines -> raw samples. */
  function unfilter(filtered, header) {
    const { height, stride, bytesPerPixel } = header;
    if (filtered.length < height * (stride + 1)) throw new Error('PNG 像素数据不完整');
    const raw = new Uint8Array(height * stride);
    for (let y = 0; y < height; y += 1) {
      const type = filtered[y * (stride + 1)];
      const from = y * (stride + 1) + 1;
      const to = y * stride;
      const up = to - stride;
      for (let x = 0; x < stride; x += 1) {
        const value = filtered[from + x];
        const left = x >= bytesPerPixel ? raw[to + x - bytesPerPixel] : 0;
        const above = y > 0 ? raw[up + x] : 0;
        const corner = y > 0 && x >= bytesPerPixel ? raw[up + x - bytesPerPixel] : 0;
        let restored;
        if (type === 0) restored = value;
        else if (type === 1) restored = value + left;
        else if (type === 2) restored = value + above;
        else if (type === 3) restored = value + ((left + above) >> 1);
        else if (type === 4) restored = value + paeth(left, above, corner);
        else throw new Error('PNG 行过滤类型不支持：' + type);
        raw[to + x] = restored & 0xff;
      }
    }
    return raw;
  }

  /** One scanline, one filter type, written into dst. */
  function filterRow(dst, raw, rowStart, prevStart, stride, bytesPerPixel, type, hasPrev) {
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rowStart + x];
      const left = x >= bytesPerPixel ? raw[rowStart + x - bytesPerPixel] : 0;
      const above = hasPrev ? raw[prevStart + x] : 0;
      const corner = hasPrev && x >= bytesPerPixel ? raw[prevStart + x - bytesPerPixel] : 0;
      let filtered;
      if (type === 0) filtered = value;
      else if (type === 1) filtered = value - left;
      else if (type === 2) filtered = value - above;
      else if (type === 3) filtered = value - ((left + above) >> 1);
      else filtered = value - paeth(left, above, corner);
      dst[x] = filtered & 0xff;
    }
  }

  /**
   * Raw samples -> filtered scanlines.
   *
   * `strategy` is either a fixed filter type or 'adaptive', the minimum sum of
   * absolute differences heuristic the PNG spec suggests and sharp's
   * adaptiveFiltering uses.
   */
  function refilter(raw, header, strategy) {
    const { height, stride, bytesPerPixel } = header;
    const out = new Uint8Array(height * (stride + 1));
    const scratch = strategy === 'adaptive' ? new Uint8Array(stride) : null;
    const best = strategy === 'adaptive' ? new Uint8Array(stride) : null;
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * stride;
      const prevStart = rowStart - stride;
      const target = y * (stride + 1);
      if (strategy !== 'adaptive') {
        out[target] = strategy;
        filterRow(out.subarray(target + 1, target + 1 + stride), raw, rowStart, prevStart, stride, bytesPerPixel, strategy, y > 0);
        continue;
      }
      let bestType = 0;
      let bestScore = Infinity;
      for (let type = 0; type <= 4; type += 1) {
        filterRow(scratch, raw, rowStart, prevStart, stride, bytesPerPixel, type, y > 0);
        let score = 0;
        for (let x = 0; x < stride; x += 1) {
          const signed = scratch[x];
          score += signed < 128 ? signed : 256 - signed;
        }
        if (score < bestScore) {
          bestScore = score;
          bestType = type;
          best.set(scratch);
        }
      }
      out[target] = bestType;
      out.set(best, target + 1);
    }
    return out;
  }

  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }

  const concat = (list) => {
    const total = list.reduce((sum, item) => sum + item.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const item of list) { out.set(item, at); at += item.length; }
    return out;
  };

  /** Header, the colour chunks the source carried, the new IDATs, IEND. */
  function buildPng(chunks, compressed) {
    const parts = [new Uint8Array(SIGNATURE)];
    for (const item of chunks) {
      if (item.type === 'IDAT') break;
      if (item.type === 'IEND' || DROPPED_CHUNKS.has(item.type)) continue;
      parts.push(chunk(item.type, item.data));
    }
    for (let offset = 0; offset < compressed.length; offset += IDAT_SPLIT) {
      parts.push(chunk('IDAT', compressed.subarray(offset, Math.min(offset + IDAT_SPLIT, compressed.length))));
    }
    parts.push(chunk('IEND', new Uint8Array(0)));
    return concat(parts);
  }

  /** Read a PNG down to its raw samples. */
  async function decode(bytes) {
    const chunks = readChunks(bytes);
    const header = readHeader(chunks[0].data);
    // Adam7 stores seven sub-images with their own widths; re-filtering those
    // correctly is a different algorithm, and an atlas page is never
    // interlaced.
    if (header.interlace !== 0) throw new Error('隔行 PNG 暂不支持稳妥压缩');
    // An APNG keeps its frames in fdAT chunks after IDAT. Re-encoding the
    // still image would leave the animation behind, so say so instead.
    if (chunks.some((item) => item.type === 'acTL')) throw new Error('动画 PNG（APNG）暂不支持稳妥压缩');
    const idat = chunks.filter((item) => item.type === 'IDAT').map((item) => item.data);
    if (!idat.length) throw new Error('PNG 缺少像素数据');
    return { chunks, header, raw: unfilter(await inflate(concat(idat)), header) };
  }

  /**
   * Which filter strategies to try, best guess first.
   *
   * Palette and sub-byte images are bytes of indices, where neighbouring
   * values mean nothing arithmetically, so filtering usually costs size - the
   * spec's own advice is to leave them unfiltered. Everything else gets the
   * adaptive heuristic first.
   *
   * The slider is the effort dial: Compression Streams exposes no zlib level,
   * so a higher 压缩强度 buys more strategies to take the smallest of instead.
   * The pixels are the same either way - only how hard it looks changes.
   */
  function strategiesFor(header, level, rawBytes) {
    const flat = header.colorType === 3 || header.bitDepth < 8;
    const ordered = flat ? [0, 1, 'adaptive'] : ['adaptive', 0, 4];
    const budget = rawBytes > SINGLE_STRATEGY_BYTES ? 1 : level <= 2 ? 1 : level <= 6 ? 2 : 3;
    return ordered.slice(0, budget);
  }

  /**
   * Lossless PNG re-encode.
   *
   * 稳妥 is a promise about the pixels, so it is checked rather than asserted:
   * the result is decoded again and compared byte for byte with what went in,
   * and a mismatch fails that file instead of handing back a quietly altered
   * atlas. The panel keeps the original whenever the result is not smaller.
   */
  async function reencodeLossless(source, level) {
    const { chunks, header, raw } = await decode(source);

    let best = null;
    for (const strategy of strategiesFor(header, level, raw.length)) {
      const compressed = await deflate(refilter(raw, header, strategy));
      if (!best || compressed.length < best.length) best = compressed;
    }

    const out = buildPng(chunks, best);
    const check = await decode(out);
    if (check.raw.length !== raw.length) throw new Error('重编码后像素长度不一致');
    for (let i = 0; i < raw.length; i += 1) {
      if (check.raw[i] !== raw[i]) throw new Error('重编码后像素不一致，已放弃该图');
    }
    return { out, header };
  }

  api.compressSpineAtlasSafe = async (payload) => {
    const cue = root.NovaFlowWebBusy;
    if (cue) cue.begin('png-safe', '正在稳妥压缩 PNG…');
    try {
      const source = bytesFromDataUrl(payload && payload.dataUrl);
      const level = Math.max(0, Math.min(9, Math.round(Number(payload && payload.compressionLevel) || 0)));
      const { out, header } = await reencodeLossless(source, level);
      return {
        ok: true,
        bytes: Array.from(out),
        width: header.width,
        height: header.height,
        losslessVerified: true
      };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    } finally {
      if (cue) cue.end('png-safe');
    }
  };


  // ---------------------------------------------------------------------------
  // SPINE 图集转换 (工具 → SPINE 图集转换): the PNG pages of a Spine atlas become
  // WebP or JPG, and the atlas is rewritten to name them.
  //
  // The desktop answers `convertSpineAtlasWebp` in main/spine-atlas-webp-
  // converter.js with sharp, ffmpeg and @jsquash/webp. The browser build had
  // no answer at all, so 开始转换 stopped at "能力未加载". Here:
  //
  //   - the PNG is read by the decoder above, never through a canvas (see the
  //     note at the top of this section: a canvas premultiplies, and an atlas
  //     is the one file where the transparent margin's colour matters);
  //   - WebP is encoded and checked by libwebp compiled to WebAssembly
  //     (vendor/webp, @jsquash/webp 1.5.0 - the same encoder the desktop's
  //     exact path runs), inside a worker so the page keeps painting;
  //   - JPG has no transparency to protect, so it goes through a canvas.
  //
  // A PMA page is lossy too, encoded with libwebp's `exact` flag so the
  // transparent margin stays black (pmaLossyOptions). The page is read back:
  // alpha must match byte for byte, and while a transparent pixel rises more
  // than PMA_TRANSPARENT_LIMIT above black the quality climbs
  // PMA_QUALITY_LADDER; the cleanest attempt ships if none passes. A PMA page
  // never goes lossless (only options.lossless asks for that).
  // docs/LIMITATIONS.md records the numbers.
  // ---------------------------------------------------------------------------
  // vendor/ sits next to this script; index.html loads it as ./novaflow-web-capabilities.js.
  const scriptBase = (() => {
    try {
      const src = root.document && root.document.currentScript && root.document.currentScript.src;
      if (src) return new URL('./', src).href;
      return (root.document && root.document.baseURI) || '';
    } catch (_) {
      return '';
    }
  })();

  /** The decoder's raw samples, whatever the colour type and depth, as 8-bit RGBA. */
  function pngToRgba(png) {
    const { header, raw, chunks } = png;
    const { width, height, bitDepth, colorType, stride } = header;
    const out = new Uint8Array(width * height * 4);
    const plte = (chunks.find((item) => item.type === 'PLTE') || {}).data || null;
    const trns = (chunks.find((item) => item.type === 'tRNS') || {}).data || null;
    if (colorType === 3 && !plte) throw new Error('PNG 缺少调色板');
    const maxValue = (1 << bitDepth) - 1;
    const bytesPerSample = bitDepth === 16 ? 2 : 1;
    // Sample `index` of a row, reduced to 8 bits (the high byte of a 16-bit sample).
    const sample = (rowStart, index) => {
      if (bitDepth === 8) return raw[rowStart + index];
      if (bitDepth === 16) return raw[rowStart + index * 2];
      const bit = index * bitDepth;
      return (raw[rowStart + (bit >> 3)] >> (8 - bitDepth - (bit & 7))) & maxValue;
    };
    // The full sample, for the tRNS comparison the spec makes at the file's depth.
    const sampleFull = (rowStart, index) => (bitDepth === 16 ? (raw[rowStart + index * 2] << 8) | raw[rowStart + index * 2 + 1] : sample(rowStart, index));
    const grey = (value) => (bitDepth < 8 ? Math.round((value * 255) / maxValue) : value);
    const trnsGrey = trns && colorType === 0 && trns.length >= 2 ? (trns[0] << 8) | trns[1] : -1;
    const trnsRgb = trns && colorType === 2 && trns.length >= 6 ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]] : null;
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * stride;
      for (let x = 0; x < width; x += 1) {
        const o = (y * width + x) * 4;
        if (colorType === 6) {
          const i = rowStart + x * 4 * bytesPerSample;
          out[o] = raw[i]; out[o + 1] = raw[i + bytesPerSample]; out[o + 2] = raw[i + 2 * bytesPerSample]; out[o + 3] = raw[i + 3 * bytesPerSample];
        } else if (colorType === 2) {
          const i = x * 3;
          out[o] = sample(rowStart, i); out[o + 1] = sample(rowStart, i + 1); out[o + 2] = sample(rowStart, i + 2);
          out[o + 3] = trnsRgb && sampleFull(rowStart, i) === trnsRgb[0] && sampleFull(rowStart, i + 1) === trnsRgb[1] && sampleFull(rowStart, i + 2) === trnsRgb[2] ? 0 : 255;
        } else if (colorType === 4) {
          const i = x * 2;
          out[o] = out[o + 1] = out[o + 2] = sample(rowStart, i);
          out[o + 3] = sample(rowStart, i + 1);
        } else if (colorType === 3) {
          const index = sample(rowStart, x);
          if (index * 3 + 2 >= plte.length) throw new Error('PNG 调色板索引越界');
          out[o] = plte[index * 3]; out[o + 1] = plte[index * 3 + 1]; out[o + 2] = plte[index * 3 + 2];
          out[o + 3] = trns && index < trns.length ? trns[index] : 255;
        } else {
          out[o] = out[o + 1] = out[o + 2] = grey(sample(rowStart, x));
          out[o + 3] = trnsGrey >= 0 && sampleFull(rowStart, x) === trnsGrey ? 0 : 255;
        }
      }
    }
    return out;
  }
  function countOverAlpha(rgba) {
    let count = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > rgba[i + 3]) count += 1;
    }
    return count;
  }
  function readPngSource(payload) {
    const bytes = payload && payload.bytes;
    if (bytes instanceof Uint8Array && bytes.length) return bytes;
    if (bytes && typeof bytes === 'object' && typeof bytes.length === 'number' && bytes.length) return Uint8Array.from(bytes);
    if (payload && typeof payload.dataUrl === 'string' && payload.dataUrl) return bytesFromDataUrl(payload.dataUrl);
    throw new Error('图片数据无效');
  }

  if (typeof api.convertSpineAtlasWebp !== 'function') installSpineAtlasWebp();
  if (typeof api.compressPngStrong !== 'function') installPngStrong();

  // ---------------------------------------------------------------------------
  // PNG 强压缩 and Spine 图集增强压缩 (工具 → PNG 压缩): quantise to a palette.
  //
  // The desktop answers `compressPngStrong` with sharp's palette PNG, which is
  // libimagequant. Here it is libimagequant itself, compiled to WebAssembly
  // (vendor/imagequant, libimagequant-wasm 0.3.0 - GPL, see its NOTICE), in
  // a worker: the quality / colours / dither / effort the panel derives from
  // 压缩强度 go to the same library with the same meaning (sharp's effort 1-10
  // is libimagequant speed 11-effort). The indexed image it hands back is
  // written by the PNG encoder above - re-filtered, deflated, read back and
  // compared - so the pixels in the file are exactly the quantiser's.
  //
  // The Spine profile (profile: "spine-atlas-pma") does what the desktop's
  // compression-helpers.js does: the page's stored alpha is classified, a page
  // that reads as straight alpha is not quantised but re-encoded losslessly
  // (safeFallback), and every fully transparent palette entry is written black
  // so a premultiplied runtime cannot pick colour up from it.
  // ---------------------------------------------------------------------------
  function installPngStrong() {
    const IMAGEQUANT_VERSION = '0.3.0';
    const SPINE_ATLAS_PMA_PROFILE = 'spine-atlas-pma';
    const MAX_ALPHA_ANALYSIS_PIXELS = 4096 * 4096;
    const vendorUrl = (file) => new URL('vendor/imagequant/' + file + '?v=' + IMAGEQUANT_VERSION, scriptBase || root.location.href).href;
    const clamp = (value, min, max, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
    };

    // ---- the quantiser ----------------------------------------------------
    const QUANT_WORKER_SOURCE = [
      'let wasm = null;',
      'self.onmessage = async (event) => {',
      '  const { id, op } = event.data;',
      '  try {',
      '    if (op === "init") {',
      '      wasm = await import(event.data.moduleUrl);',
      '      await wasm.default({ module_or_path: event.data.wasmBinary });',
      '      self.postMessage({ id, ok: true });',
      '    } else if (op === "quantize") {',
      '      const { rgba, width, height, options } = event.data;',
      '      const quantizer = new wasm.ImageQuantizer();',
      '      try {',
      '        quantizer.setSpeed(options.speed);',
      '        quantizer.setQuality(options.minQuality, options.quality);',
      '        quantizer.setMaxColors(options.colors);',
      '        const result = quantizer.quantizeImage(rgba, width, height);',
      '        try {',
      '          result.setDithering(options.dither);',
      '          const palette = result.getPalette();',
      '          const indices = new Uint8Array(result.getPaletteIndices(rgba, width, height));',
      '          const flat = new Uint8Array(palette.length * 4);',
      '          for (let i = 0; i < palette.length; i += 1) { const c = palette[i]; flat[i * 4] = c[0]; flat[i * 4 + 1] = c[1]; flat[i * 4 + 2] = c[2]; flat[i * 4 + 3] = c[3]; }',
      '          self.postMessage({ id, ok: true, palette: flat, indices, quality: result.getQuantizationQuality() }, [flat.buffer, indices.buffer]);',
      '        } finally { result.free(); }',
      '      } finally { quantizer.free(); }',
      '    } else {',
      '      throw new Error("unknown op " + op);',
      '    }',
      '  } catch (error) {',
      '    self.postMessage({ id, ok: false, error: String((error && error.message) || error) });',
      '  }',
      '};'
    ].join('\n');

    async function fetchWasm(url) {
      const response = await root.fetch(url);
      if (!response.ok) throw new Error('下载调色板压缩器失败（' + response.status + '）');
      return await response.arrayBuffer();
    }
    const quantizeWith = (wasm, rgba, width, height, options) => {
      const quantizer = new wasm.ImageQuantizer();
      try {
        quantizer.setSpeed(options.speed);
        quantizer.setQuality(options.minQuality, options.quality);
        quantizer.setMaxColors(options.colors);
        const result = quantizer.quantizeImage(rgba, width, height);
        try {
          result.setDithering(options.dither);
          const palette = result.getPalette();
          const indices = new Uint8Array(result.getPaletteIndices(rgba, width, height));
          const flat = new Uint8Array(palette.length * 4);
          for (let i = 0; i < palette.length; i += 1) { const c = palette[i]; flat[i * 4] = c[0]; flat[i * 4 + 1] = c[1]; flat[i * 4 + 2] = c[2]; flat[i * 4 + 3] = c[3]; }
          return { palette: flat, indices, quality: result.getQuantizationQuality() };
        } finally { result.free(); }
      } finally { quantizer.free(); }
    };
    async function createWorkerQuantizer(moduleUrl, wasmBinary) {
      const blob = new root.Blob([QUANT_WORKER_SOURCE], { type: 'text/javascript' });
      const worker = new root.Worker(root.URL.createObjectURL(blob), { type: 'module' });
      const pending = new Map();
      let seq = 0;
      worker.onmessage = (event) => {
        const data = event.data || {};
        const job = pending.get(data.id);
        if (!job) return;
        pending.delete(data.id);
        if (data.ok) job.resolve(data); else job.reject(new Error(data.error || '调色板压缩器出错'));
      };
      worker.onerror = (event) => {
        const error = new Error((event && event.message) || '调色板压缩器线程出错');
        for (const job of pending.values()) job.reject(error);
        pending.clear();
      };
      const call = (message, transfer) => new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        worker.postMessage(Object.assign({ id }, message), transfer || []);
      });
      await call({ op: 'init', moduleUrl, wasmBinary }, [wasmBinary]);
      return {
        quantize: async (rgba, width, height, options) => {
          const copy = new Uint8ClampedArray(rgba);
          const reply = await call({ op: 'quantize', rgba: copy, width, height, options }, [copy.buffer]);
          return { palette: reply.palette, indices: reply.indices, quality: reply.quality };
        }
      };
    }
    async function createInlineQuantizer(moduleUrl, wasmBinary) {
      const wasm = await import(moduleUrl);
      await wasm.default({ module_or_path: wasmBinary });
      return { quantize: async (rgba, width, height, options) => quantizeWith(wasm, new Uint8ClampedArray(rgba), width, height, options) };
    }
    let quantizerPromise = null;
    function loadQuantizer() {
      if (root.NovaFlowWebQuantizer) return Promise.resolve(root.NovaFlowWebQuantizer);
      if (!quantizerPromise) {
        quantizerPromise = (async () => {
          if (typeof root.WebAssembly !== 'object') throw new Error('这个浏览器不支持 WebAssembly，无法在网页里做调色板压缩');
          const moduleUrl = vendorUrl('libimagequant_wasm.js');
          if (typeof root.Worker === 'function' && typeof root.Blob === 'function' && root.URL && typeof root.URL.createObjectURL === 'function') {
            try {
              return await createWorkerQuantizer(moduleUrl, await fetchWasm(vendorUrl('libimagequant_wasm_bg.wasm')));
            } catch (error) {
              console.warn('[novaflow-web] imagequant worker unavailable, quantising on the page:', error);
            }
          }
          return await createInlineQuantizer(moduleUrl, await fetchWasm(vendorUrl('libimagequant_wasm_bg.wasm')));
        })().catch((error) => {
          quantizerPromise = null;
          throw new Error('调色板压缩器加载失败：' + String((error && error.message) || error));
        });
      }
      return quantizerPromise;
    }

    // ---- the desktop's alpha classification (compression-helpers.js) ------
    function classifyAlpha(rgba, width, height) {
      const pixelCount = width * height;
      if (pixelCount > MAX_ALPHA_ANALYSIS_PIXELS) return { mode: 'ambiguous', reason: 'analysis-pixel-limit', pixelCount };
      let transparent = 0, translucent = 0, pmaLike = 0, straightLike = 0, lowAlpha = 0, highAlpha = 0;
      let alphaSum = 0, maxRgbSum = 0, alphaSquareSum = 0, maxRgbSquareSum = 0, alphaRgbProductSum = 0;
      let lowAlphaRgbSum = 0, highAlphaRgbSum = 0, lowAlphaNormalizedRgbSum = 0, highAlphaNormalizedRgbSum = 0;
      let minTranslucentAlpha = 255, maxTranslucentAlpha = 0;
      const buckets = new Set();
      for (let i = 0; i < rgba.length; i += 4) {
        const alpha = rgba[i + 3];
        if (alpha <= 4) { transparent += 1; continue; }
        if (alpha >= 250) continue;
        const maxRgb = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
        translucent += 1;
        if (alpha <= 32) { lowAlpha += 1; lowAlphaRgbSum += maxRgb; lowAlphaNormalizedRgbSum += maxRgb / alpha; }
        if (alpha >= 128) { highAlpha += 1; highAlphaRgbSum += maxRgb; highAlphaNormalizedRgbSum += maxRgb / alpha; }
        alphaSum += alpha; maxRgbSum += maxRgb; alphaSquareSum += alpha * alpha; maxRgbSquareSum += maxRgb * maxRgb; alphaRgbProductSum += alpha * maxRgb;
        if (alpha < minTranslucentAlpha) minTranslucentAlpha = alpha;
        if (alpha > maxTranslucentAlpha) maxTranslucentAlpha = alpha;
        buckets.add(Math.min(15, Math.floor(alpha / 16)));
        if (maxRgb <= alpha + 3) pmaLike += 1;
        if (maxRgb > alpha + 18) straightLike += 1;
      }
      const reason = 'full-resolution-alpha-analysis';
      if (transparent === 0 && translucent === 0) return { mode: 'opaque', reason, pixelCount };
      const premultipliedRatio = translucent > 0 ? pmaLike / translucent : 0;
      const straightRatio = translucent > 0 ? straightLike / translucent : 0;
      const numerator = translucent * alphaRgbProductSum - alphaSum * maxRgbSum;
      const denominator = Math.sqrt((translucent * alphaSquareSum - alphaSum * alphaSum) * (translucent * maxRgbSquareSum - maxRgbSum * maxRgbSum));
      const correlation = denominator > 0 ? numerator / denominator : 0;
      const lowMean = lowAlpha > 0 ? lowAlphaRgbSum / lowAlpha : 0;
      const highMean = highAlpha > 0 ? highAlphaRgbSum / highAlpha : 0;
      const intensityGrowth = lowMean > 0 ? highMean / lowMean : highMean > 0 ? 255 : 0;
      const lowNormalized = lowAlpha > 0 ? lowAlphaNormalizedRgbSum / lowAlpha : 0;
      const highNormalized = highAlpha > 0 ? highAlphaNormalizedRgbSum / highAlpha : 0;
      const retention = lowNormalized > 0 ? highNormalized / lowNormalized : highNormalized > 0 ? 255 : 0;
      let mode = 'ambiguous';
      if (translucent >= 64 && lowAlpha >= 64 && minTranslucentAlpha <= 16 && maxTranslucentAlpha >= 128 && buckets.size >= 8
        && correlation >= 0.35 && intensityGrowth >= 4 && retention >= 0.5 && premultipliedRatio >= 0.995 && straightRatio <= 0.001) {
        mode = 'pma-like';
      } else if (translucent >= 64 && straightRatio >= 0.04) {
        mode = 'straight';
      }
      return { mode, reason, pixelCount };
    }
    /** Palette entries of an indexed source that are fully transparent yet carry colour. */
    function countDirtyTransparentEntries(png) {
      if (png.header.colorType !== 3) return 0;
      const plte = (png.chunks.find((item) => item.type === 'PLTE') || {}).data;
      const trns = (png.chunks.find((item) => item.type === 'tRNS') || {}).data;
      if (!plte || !trns) return 0;
      let dirty = 0;
      for (let i = 0; i < trns.length && i * 3 + 2 < plte.length; i += 1) {
        if (trns[i] === 0 && (plte[i * 3] || plte[i * 3 + 1] || plte[i * 3 + 2])) dirty += 1;
      }
      return dirty;
    }

    // ---- writing the indexed PNG ----------------------------------------
    const be32 = (value) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    function packIndices(indices, width, height, bitDepth) {
      const stride = Math.ceil((width * bitDepth) / 8);
      const raw = new Uint8Array(height * stride);
      if (bitDepth === 8) {
        for (let y = 0; y < height; y += 1) raw.set(indices.subarray(y * width, (y + 1) * width), y * stride);
      } else {
        const perByte = 8 / bitDepth;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            raw[y * stride + Math.floor(x / perByte)] |= indices[y * width + x] << (8 - bitDepth - (x % perByte) * bitDepth);
          }
        }
      }
      return { raw, stride };
    }
    async function writeIndexedPng(width, height, palette, indices, level) {
      const colors = palette.length / 4;
      const bitDepth = colors <= 2 ? 1 : colors <= 4 ? 2 : colors <= 16 ? 4 : 8;
      const { raw, stride } = packIndices(indices, width, height, bitDepth);
      const header = { width, height, bitDepth, colorType: 3, interlace: 0, bytesPerPixel: 1, stride };
      const plte = new Uint8Array(colors * 3);
      const trns = new Uint8Array(colors);
      for (let i = 0; i < colors; i += 1) {
        plte[i * 3] = palette[i * 4]; plte[i * 3 + 1] = palette[i * 4 + 1]; plte[i * 3 + 2] = palette[i * 4 + 2];
        trns[i] = palette[i * 4 + 3];
      }
      let trnsLength = colors;
      while (trnsLength > 0 && trns[trnsLength - 1] === 255) trnsLength -= 1;
      const chunks = [{ type: 'IHDR', data: Uint8Array.from([...be32(width), ...be32(height), bitDepth, 3, 0, 0, 0]) }, { type: 'PLTE', data: plte }];
      if (trnsLength > 0) chunks.push({ type: 'tRNS', data: trns.subarray(0, trnsLength) });
      chunks.push({ type: 'IDAT', data: new Uint8Array(0) });
      let best = null;
      for (const strategy of strategiesFor(header, level, raw.length)) {
        const compressed = await deflate(refilter(raw, header, strategy));
        if (!best || compressed.length < best.length) best = compressed;
      }
      const out = buildPng(chunks, best);
      const check = await decode(out);
      if (check.header.colorType !== 3 || check.header.bitDepth !== bitDepth || check.raw.length !== raw.length) throw new Error('调色板 PNG 写出后校验失败');
      for (let i = 0; i < raw.length; i += 1) {
        if (check.raw[i] !== raw[i]) throw new Error('调色板 PNG 写出后像素不一致');
      }
      return out;
    }

    async function compressPngStrong(payload) {
      const source = readPngSource(payload);
      const png = await decode(source);
      const { width, height } = png.header;
      const compressionLevel = Math.round(clamp(payload.compressionLevel, 0, 9, 9));
      const effort = Math.round(clamp(payload.effort, 1, 10, 8));
      const quality = Math.round(clamp(payload.quality, 1, 100, 80));
      const colors = Math.round(clamp(payload.colors !== undefined ? payload.colors : payload.colours, 2, 256, 256));
      const dither = clamp(payload.dither, 0, 1, 0.5);
      const spineProfile = String(payload.profile || '').trim() === SPINE_ATLAS_PMA_PROFILE;

      const rgba = pngToRgba(png);
      let alphaAnalysis = null;
      let effectivePalette = true;
      let inputDirty = 0;
      if (spineProfile) {
        inputDirty = countDirtyTransparentEntries(png);
        alphaAnalysis = classifyAlpha(rgba, width, height);
        if (alphaAnalysis.mode === 'straight') effectivePalette = false;
      }

      let out;
      let paletteLength = null;
      let achievedQuality = null;
      let repaired = 0;
      if (effectivePalette) {
        const quantizer = await loadQuantizer();
        const result = await quantizer.quantize(rgba, width, height, { speed: 11 - effort, minQuality: 0, quality, colors, dither });
        const palette = new Uint8Array(result.palette);
        if (!palette.length || palette.length % 4 !== 0 || result.indices.length !== width * height) throw new Error('调色板压缩器返回的数据无效');
        if (spineProfile) {
          for (let i = 0; i < palette.length; i += 4) {
            if (palette[i + 3] === 0 && (palette[i] || palette[i + 1] || palette[i + 2])) {
              palette[i] = palette[i + 1] = palette[i + 2] = 0;
              repaired += 1;
            }
          }
        }
        paletteLength = palette.length / 4;
        achievedQuality = Number(result.quality);
        out = await writeIndexedPng(width, height, palette, new Uint8Array(result.indices), compressionLevel);
      } else {
        out = (await reencodeLossless(source, compressionLevel)).out;
      }

      return {
        ok: true,
        bytes: Array.from(out),
        width,
        height,
        size: out.length,
        paletteLength,
        quality: achievedQuality,
        spineAtlasProtection: spineProfile
          ? {
              alphaMode: alphaAnalysis.mode,
              pmaConfirmed: true,
              analysisReason: alphaAnalysis.reason,
              analyzedPixels: alphaAnalysis.pixelCount,
              safeFallback: !effectivePalette,
              inputDirtyTransparentEntries: inputDirty,
              repairedTransparentEntries: repaired
            }
          : undefined
      };
    }

    api.compressPngStrong = async (payload) => {
      const cue = root.NovaFlowWebBusy;
      if (cue) cue.begin('png-strong', '正在压缩 PNG（调色板量化）…');
      try {
        return await compressPngStrong(payload || {});
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) };
      } finally {
        if (cue) cue.end('png-strong');
      }
    };
  }

  function installSpineAtlasWebp() {
    const WEBP_VENDOR_VERSION = '1.5.0';
    // The panel sends `compact`. Q80 puts a PMA page within a few percent of
    // the lossy WebP Spine writes itself (924 KB vs 0.91 MB on the 2048x1883
    // 木乃伊 atlas) - Spine's own file fringes under premultiplied blending,
    // this one does not (see pmaLossyOptions).
    const WEBP_PRESETS = { clarity: 95, compact: 80, small: 70 };
    const WEBP_MAX_DIMENSION = 16383;
    // struct WebPConfig, as @jsquash/webp/meta.js lists it. The encoder wants
    // every field present.
    const WEBP_DEFAULT_OPTIONS = {
      quality: 75, target_size: 0, target_PSNR: 0, method: 4, sns_strength: 50, filter_strength: 60,
      filter_sharpness: 0, filter_type: 1, partitions: 0, segments: 4, pass: 1, show_compressed: 0,
      preprocessing: 0, autofilter: 0, partition_limit: 0, alpha_compression: 1, alpha_filtering: 1,
      alpha_quality: 100, lossless: 0, exact: 0, image_hint: 0, emulate_jpeg_size: 0, thread_level: 0,
      low_memory: 0, near_lossless: 100, use_delta_palette: 0, use_sharp_yuv: 0
    };
    // Straight alpha, lossy: what the desktop asks of sharp (quality, alpha
    // kept lossless, sharp YUV, effort 6). libwebp's transparent-area cleanup
    // stays on: under straight alpha those pixels are invisible, and smoothing
    // them is the cheapest bleed there is.
    const lossyOptions = (quality) => Object.assign({}, WEBP_DEFAULT_OPTIONS, {
      quality, method: 6, exact: 0, use_sharp_yuv: 1, alpha_quality: 100, alpha_compression: 1
    });
    // Premultiplied alpha, lossy: the same encode with `exact` on. Under PMA
    // blending a transparent pixel's RGB is ADDED to the frame, so the cleanup
    // above (which paints neighbouring colours into the margin, up to ~190
    // levels on a real atlas) is exactly the white fringe; `exact` keeps the
    // margin black and only VP8 ringing remains - a few levels, on isolated
    // edge pixels, read back and bounded by PMA_TRANSPARENT_LIMIT.
    const pmaLossyOptions = (quality) => Object.assign({}, lossyOptions(quality), { exact: 1 });
    // The fringe this guards against measured 190+ levels over whole blocks.
    // What exact lossy leaves is single pixels and one-pixel seams next to a
    // bright edge: 木乃伊 peaks at 24 (Q80), 金鏟鏟 at 37 (and still 29 at
    // Q100 - the peak barely follows quality), both invisible even at 6x.
    // Above the limit the page climbs the ladder; it never goes lossless, the
    // user's rule: 永远不能触发无损，自动到最合理的档，必须没有白色杂边.
    const PMA_TRANSPARENT_LIMIT = 48;
    const PMA_QUALITY_LADDER = [80, 85, 90, 95];
    // Exact: every RGBA byte kept, transparent pixels included. Method 4 came
    // out within a kilobyte of method 6 on real atlases at a fifth of the time.
    const LOSSLESS_OPTIONS = Object.assign({}, WEBP_DEFAULT_OPTIONS, { lossless: 1, exact: 1, quality: 100, method: 4 });
    // wasm-feature-detect's SIMD probe: a module with one v128 instruction.
    const SIMD_PROBE = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11);

    const vendorUrl = (file) => new URL('vendor/webp/' + file + '?v=' + WEBP_VENDOR_VERSION, scriptBase || root.location.href).href;

    // ---- names ----------------------------------------------------------
    // main/path-helpers.js, so the output names match the desktop's.
    function sanitizeFileName(name) {
      if (typeof name !== 'string') return '';
      const base = name.replace(/\\/g, '/').split('/').pop();
      const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').trim();
      return cleaned.length ? cleaned.slice(0, 120) : '';
    }
    function sanitizeFileStem(name, fallback) {
      const cleaned = sanitizeFileName(name).replace(/\.[^/.]+$/g, '');
      return cleaned.length ? cleaned : fallback;
    }
    const normalizeName = (value) => String(value || '').replace(/\\/g, '/').split('/').pop().trim().toLowerCase();
    const normalizeOutputFormat = (value) => {
      const format = String(value || '').trim().toLowerCase();
      return format === 'jpg' || format === 'jpeg' ? 'jpg' : 'webp';
    };
    const outputFileNameForFormat = (fileName, format) => {
      const stem = sanitizeFileStem(sanitizeFileName(fileName) || 'atlas.png', 'atlas');
      return stem + (normalizeOutputFormat(format) === 'jpg' ? '.jpg' : '.webp');
    };
    const atlasOutputFileName = (atlasName) => sanitizeFileStem(sanitizeFileName(atlasName) || 'spine.atlas', 'spine') + '.atlas';
    function clampInt(value, fallback, min, max) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return fallback;
      return Math.max(min, Math.min(max, Math.round(numeric)));
    }

    // ---- the atlas text ---------------------------------------------------
    // main/spine-atlas-webp-converter.js, line for line: page headers are
    // found by the blank line before them, `pma:` is read and rewritten, and
    // a Spine 3.x page (parsed positionally by that runtime) never gets a
    // `pma:` line it would mistake for a region name.
    function splitAtlasLines(text) {
      const source = String(text || '');
      const matches = source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) || [];
      return matches.filter((line, index) => line.length > 0 || index < matches.length - 1).map((raw) => {
        const newlineMatch = raw.match(/(\r\n|\n|\r)$/);
        const newline = newlineMatch ? newlineMatch[0] : '';
        return { body: newline ? raw.slice(0, -newline.length) : raw, newline };
      });
    }
    function isAtlasPageHeader(lines, index) {
      const body = lines[index].body.replace(/^﻿/, '');
      return !!body.trim() && !body.includes(':') && (index === 0 || !lines[index - 1].body.trim());
    }
    function isLegacyAtlasPage(lines, regionStart, headerKeys) {
      for (let i = regionStart; i < lines.length && !isAtlasPageHeader(lines, i); i += 1) {
        const key = lines[i].body.split(':')[0].trim().toLowerCase();
        if (key === 'bounds' || key === 'offsets') return false;
        if (key === 'xy' || key === 'orig') return true;
      }
      return headerKeys.has('format') && headerKeys.has('repeat');
    }
    function atlasPages(lines) {
      const pages = [];
      for (let i = 0; i < lines.length; i += 1) {
        if (!isAtlasPageHeader(lines, i)) continue;
        let end = i + 1;
        let pma = null;
        let pmaIndex = -1;
        const headerKeys = new Set();
        while (end < lines.length && lines[end].body.includes(':')) {
          const match = lines[end].body.match(/^\s*pma\s*:\s*(true|false)\s*$/i);
          if (match) { pma = match[1].toLowerCase() === 'true'; pmaIndex = end; }
          headerKeys.add(lines[end].body.split(':')[0].trim().toLowerCase());
          end += 1;
        }
        pages.push({ index: i, end, pma, pmaIndex, name: lines[i].body.trim(), legacy: isLegacyAtlasPage(lines, end, headerKeys) });
      }
      return pages;
    }
    function rewriteAtlasPngPages(atlasText, pngNameToOutputName, outputPma) {
      const lines = splitAtlasLines(atlasText);
      const replacements = [];
      const referencedPngNames = new Set();
      const legacyPmaPages = [];
      for (const page of atlasPages(lines).reverse()) {
        const line = lines[page.index];
        const original = page.name;
        if (!/\.png$/i.test(original)) continue;
        referencedPngNames.add(normalizeName(original));
        const nextName = pngNameToOutputName.get(normalizeName(original));
        if (!nextName) continue;
        replacements.unshift({ oldName: original, nextName });
        line.body = line.body.replace(original, nextName);
        if (outputPma.has(normalizeName(original))) {
          const pma = outputPma.get(normalizeName(original));
          if (page.pmaIndex >= 0) {
            lines[page.pmaIndex].body = lines[page.pmaIndex].body.replace(/(true|false)/i, String(pma));
          } else if (pma && page.legacy) {
            legacyPmaPages.push(nextName);
          } else if (pma) {
            const newline = line.newline || '\n';
            if (!lines[page.end - 1].newline) lines[page.end - 1].newline = newline;
            lines.splice(page.end, 0, { body: 'pma: ' + pma, newline });
          }
        }
      }
      return { text: lines.map((line) => line.body + line.newline).join(''), replacements, referencedPngNames: Array.from(referencedPngNames), legacyPmaPages };
    }
    function normalizeAtlasInputs(payload) {
      const rawAtlases = Array.isArray(payload && payload.atlases) ? payload.atlases : [];
      const atlases = rawAtlases.map((atlas, index) => ({
        fileName: atlasOutputFileName((atlas && (atlas.fileName || atlas.atlasName)) || ('spine_' + (index + 1) + '.atlas')),
        text: atlas && typeof atlas.text === 'string' ? atlas.text : String((atlas && atlas.atlasText) || '')
      })).filter((atlas) => atlas.text.trim());
      if (!atlases.length && payload && typeof payload.atlasText === 'string' && payload.atlasText.trim()) {
        atlases.push({ fileName: atlasOutputFileName(payload.atlasName), text: payload.atlasText });
      }
      return atlases;
    }
    function resolveEncodeOptions(options) {
      const hasPreset = !!options && options.preset !== undefined;
      if (hasPreset && (typeof options.preset !== 'string' || !Object.prototype.hasOwnProperty.call(WEBP_PRESETS, options.preset))) throw new Error('压缩档位无效');
      const presetQuality = hasPreset ? WEBP_PRESETS[options.preset] : null;
      const mode = String((options && options.mode) || '').trim().toLowerCase();
      const jpgFallback = clampInt(options && options.jpgQuality, 85, 1, 100);
      if (!hasPreset && ((options && options.lossless === true) || mode === 'lossless')) return { mode: 'lossless', quality: null, jpgQuality: jpgFallback };
      return {
        mode: 'spine',
        quality: presetQuality !== null ? presetQuality : clampInt(options && options.quality, 75, 1, 100),
        jpgQuality: presetQuality !== null ? presetQuality : jpgFallback
      };
    }

    // ---- the pixels -------------------------------------------------------
    function readImageBytes(image, sourceName) {
      const bytes = image && image.bytes;
      if (bytes instanceof Uint8Array && bytes.length) return bytes;
      if (bytes && typeof bytes === 'object' && typeof bytes.length === 'number' && bytes.length) return Uint8Array.from(bytes);
      if (image && typeof image.dataUrl === 'string' && image.dataUrl) return bytesFromDataUrl(image.dataUrl);
      throw new Error('PNG 输入无效：' + sourceName);
    }
    // pngToRgba and countOverAlpha live at the section's top: 强压缩 below reads pages the same way.
    /** JPG keeps no alpha: a PMA page already is its own composite over black, a straight one is multiplied down. */
    function compositeOnBlack(rgba, pma) {
      const out = new Uint8ClampedArray(rgba.length);
      for (let i = 0; i < rgba.length; i += 4) {
        const a = rgba[i + 3];
        if (pma) {
          out[i] = rgba[i]; out[i + 1] = rgba[i + 1]; out[i + 2] = rgba[i + 2];
        } else {
          out[i] = Math.round((rgba[i] * a) / 255); out[i + 1] = Math.round((rgba[i + 1] * a) / 255); out[i + 2] = Math.round((rgba[i + 2] * a) / 255);
        }
        out[i + 3] = 255;
      }
      return out;
    }
    const hasJpegSignature = (bytes) => bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    const hasWebpSignature = (bytes) => bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;

    // ---- the codec --------------------------------------------------------
    // A test (or a host with its own encoder) can put an object with
    // encode / decode / encodeJpeg on root.NovaFlowWebWebpCodec; otherwise the
    // vendored libwebp runs in a module worker, and on the page if the worker
    // cannot be made.
    const WEBP_WORKER_SOURCE = [
      'let encoder = null, decoder = null;',
      'self.onmessage = async (event) => {',
      '  const { id, op } = event.data;',
      '  try {',
      '    if (op === "init") {',
      '      const [enc, dec] = await Promise.all([import(event.data.encoderUrl), import(event.data.decoderUrl)]);',
      '      encoder = await enc.default({ noInitialRun: true, wasmBinary: event.data.encoderWasm });',
      '      decoder = await dec.default({ noInitialRun: true, wasmBinary: event.data.decoderWasm });',
      '      self.postMessage({ id, ok: true });',
      '    } else if (op === "encode") {',
      '      const encoded = encoder.encode(event.data.rgba, event.data.width, event.data.height, event.data.options);',
      '      if (!encoded) throw new Error("WebP 编码失败");',
      '      const bytes = new Uint8Array(encoded);',
      '      self.postMessage({ id, ok: true, bytes }, [bytes.buffer]);',
      '    } else if (op === "decode") {',
      '      const image = decoder.decode(event.data.bytes);',
      '      if (!image) throw new Error("WebP 解码失败");',
      '      const rgba = new Uint8Array(image.data);',
      '      self.postMessage({ id, ok: true, width: image.width, height: image.height, rgba }, [rgba.buffer]);',
      '    } else {',
      '      throw new Error("unknown op " + op);',
      '    }',
      '  } catch (error) {',
      '    self.postMessage({ id, ok: false, error: String((error && error.message) || error) });',
      '  }',
      '};'
    ].join('\n');

    const wasmSimd = () => {
      try { return typeof root.WebAssembly === 'object' && root.WebAssembly.validate(SIMD_PROBE); } catch (_) { return false; }
    };
    async function fetchWasm(url) {
      const response = await root.fetch(url);
      if (!response.ok) throw new Error('下载 WebP 编码器失败（' + response.status + '）');
      return await response.arrayBuffer();
    }
    async function loadCodecParts() {
      if (typeof root.WebAssembly !== 'object') throw new Error('这个浏览器不支持 WebAssembly，无法在网页里转换 WebP');
      const encoderName = wasmSimd() ? 'webp_enc_simd' : 'webp_enc';
      const [encoderWasm, decoderWasm] = await Promise.all([fetchWasm(vendorUrl(encoderName + '.wasm')), fetchWasm(vendorUrl('webp_dec.wasm'))]);
      return { encoderUrl: vendorUrl(encoderName + '.js'), decoderUrl: vendorUrl('webp_dec.js'), encoderWasm, decoderWasm };
    }
    async function createWorkerCodec(parts) {
      const blob = new root.Blob([WEBP_WORKER_SOURCE], { type: 'text/javascript' });
      const worker = new root.Worker(root.URL.createObjectURL(blob), { type: 'module' });
      const pending = new Map();
      let seq = 0;
      const failAll = (error) => { for (const job of pending.values()) job.reject(error); pending.clear(); };
      worker.onmessage = (event) => {
        const data = event.data || {};
        const job = pending.get(data.id);
        if (!job) return;
        pending.delete(data.id);
        if (data.ok) job.resolve(data); else job.reject(new Error(data.error || 'WebP 编码器出错'));
      };
      worker.onerror = (event) => failAll(new Error((event && event.message) || 'WebP 编码器线程出错'));
      const call = (message, transfer) => new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        worker.postMessage(Object.assign({ id }, message), transfer || []);
      });
      await call({ op: 'init', encoderUrl: parts.encoderUrl, decoderUrl: parts.decoderUrl, encoderWasm: parts.encoderWasm, decoderWasm: parts.decoderWasm }, [parts.encoderWasm, parts.decoderWasm]);
      return {
        encode: async (rgba, width, height, options) => {
          const copy = new Uint8Array(rgba);
          return (await call({ op: 'encode', rgba: copy, width, height, options }, [copy.buffer])).bytes;
        },
        decode: async (bytes) => {
          const copy = new Uint8Array(bytes);
          const reply = await call({ op: 'decode', bytes: copy }, [copy.buffer]);
          return { width: reply.width, height: reply.height, data: reply.rgba };
        }
      };
    }
    async function createInlineCodec(parts) {
      const [enc, dec] = await Promise.all([import(parts.encoderUrl), import(parts.decoderUrl)]);
      const encoder = await enc.default({ noInitialRun: true, wasmBinary: parts.encoderWasm });
      const decoder = await dec.default({ noInitialRun: true, wasmBinary: parts.decoderWasm });
      return {
        encode: async (rgba, width, height, options) => {
          const encoded = encoder.encode(rgba, width, height, options);
          if (!encoded) throw new Error('WebP 编码失败');
          return new Uint8Array(encoded);
        },
        decode: async (bytes) => {
          const image = decoder.decode(bytes);
          if (!image) throw new Error('WebP 解码失败');
          return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
        }
      };
    }
    let codecPromise = null;
    function loadCodec() {
      if (root.NovaFlowWebWebpCodec) return Promise.resolve(root.NovaFlowWebWebpCodec);
      if (!codecPromise) {
        codecPromise = (async () => {
          const cue = root.NovaFlowWebBusy;
          if (cue) cue.begin('webp-codec', '正在加载 WebP 编码器…');
          try {
            const parts = await loadCodecParts();
            if (typeof root.Worker === 'function' && typeof root.Blob === 'function' && root.URL && typeof root.URL.createObjectURL === 'function') {
              try {
                return await createWorkerCodec(parts);
              } catch (error) {
                console.warn('[novaflow-web] WebP worker unavailable, encoding on the page:', error);
              }
            }
            // The worker owns the transferred buffers by now, so fetch again.
            return await createInlineCodec(await loadCodecParts());
          } finally {
            if (cue) cue.end('webp-codec');
          }
        })().catch((error) => {
          codecPromise = null;
          throw new Error('WebP 编码器加载失败：' + String((error && error.message) || error));
        });
      }
      return codecPromise;
    }
    async function encodeJpeg(rgb, width, height, quality) {
      const codec = root.NovaFlowWebWebpCodec;
      if (codec && typeof codec.encodeJpeg === 'function') return await codec.encodeJpeg(rgb, width, height, quality);
      if (!root.document || typeof root.ImageData !== 'function') throw new Error('这个环境不能输出 JPG');
      const canvas = root.document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器不支持 canvas，无法输出 JPG');
      context.putImageData(new root.ImageData(rgb, width, height), 0, 0);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('JPG 编码失败'))), 'image/jpeg', quality / 100);
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!hasJpegSignature(bytes)) throw new Error('JPG 输出无效');
      return bytes;
    }

    // ---- the conversion ---------------------------------------------------
    async function decodeAtlasPage(image) {
      try {
        return await decode(readImageBytes(image, image.sourceName));
      } catch (error) {
        throw new Error('PNG 解码失败：' + image.sourceName + '（' + String((error && error.message) || error) + '）');
      }
    }
    function assertSameShape(image, back, width, height) {
      if (!back || back.width !== width || back.height !== height || !back.data || back.data.length !== width * height * 4) {
        throw new Error(image.sourceName + '：WebP 输出尺寸不一致');
      }
    }

    async function convertSpineAtlasWebp(payload) {
      const atlasInputs = normalizeAtlasInputs(payload);
      if (!atlasInputs.length) throw new Error('缺少 atlas 文件内容');
      const encodeOptions = resolveEncodeOptions((payload && payload.options) || {});
      const rawImages = Array.isArray(payload && payload.images) ? payload.images : [];
      if (!rawImages.length) throw new Error('请至少上传 1 张 PNG 图集');

      const pages = atlasInputs.flatMap((atlas) => atlasPages(splitAtlasLines(atlas.text)));
      const imageInputs = [];
      const pngNameToOutputName = new Map();
      const outputPma = new Map();
      for (const image of rawImages) {
        const sourceName = sanitizeFileName(image && image.fileName) || 'atlas.png';
        if (!/\.png$/i.test(sourceName)) continue;
        const bytes = readImageBytes(image, sourceName);
        const outputFormat = normalizeOutputFormat(image.outputFormat || image.format || image.targetFormat);
        const outputName = outputFileNameForFormat(sourceName, outputFormat);
        const key = normalizeName(sourceName);
        if (pngNameToOutputName.has(key)) throw new Error('PNG 文件名重复：' + sourceName);
        const alphaMode = image.alphaMode || 'auto';
        if (!['auto', 'straight', 'pma'].includes(alphaMode)) throw new Error('Alpha 设置无效：' + sourceName);
        const pageModes = new Set(pages.filter((page) => normalizeName(page.name) === key).map((page) => page.pma));
        if (alphaMode === 'auto' && pageModes.has(true) && pageModes.has(false)) throw new Error('atlas 的 PMA 标记冲突，请指定原图 Alpha：' + sourceName);
        const pma = alphaMode === 'auto'
          ? (pageModes.has(null) || !pageModes.size ? null : pageModes.has(true))
          : alphaMode === 'pma';
        if (alphaMode !== 'auto' || outputFormat === 'jpg') outputPma.set(key, outputFormat === 'webp' && pma);
        imageInputs.push({ sourceName, bytes, outputName, outputFormat, pma });
        pngNameToOutputName.set(key, outputName);
      }
      if (!imageInputs.length) throw new Error('请上传 .png 格式的 Spine 图集');

      const warnings = [];
      const convertedAtlases = [];
      const matchedSourceNames = new Set();
      for (const inputAtlas of atlasInputs) {
        const atlas = rewriteAtlasPngPages(inputAtlas.text, pngNameToOutputName, outputPma);
        if (!atlas.replacements.length) {
          warnings.push(inputAtlas.fileName + ' 未匹配到已上传的 PNG 图集');
          continue;
        }
        for (const replacement of atlas.replacements) matchedSourceNames.add(normalizeName(replacement.oldName));
        for (const ref of atlas.referencedPngNames) {
          if (!pngNameToOutputName.has(ref)) warnings.push(inputAtlas.fileName + ' 引用的 PNG 未上传：' + ref);
        }
        for (const pageName of atlas.legacyPmaPages) {
          warnings.push(inputAtlas.fileName + '：' + pageName + ' 为 Spine 3.x 格式，未写入 pma 标记（3.x 运行时会将其误读为区域名）');
        }
        convertedAtlases.push({ fileName: inputAtlas.fileName, text: atlas.text, replacements: atlas.replacements });
      }
      if (!convertedAtlases.length) throw new Error('atlas 未匹配到已上传的 PNG 图集');

      const convertedImages = [];
      let codec = null;
      for (const image of imageInputs) {
        if (!matchedSourceNames.has(normalizeName(image.sourceName))) continue;
        if (root.NovaFlowWebBusy) root.NovaFlowWebBusy.update('spine-webp', '正在转换图集 ' + image.sourceName + '…');
        if (image.outputFormat === 'jpg' && image.pma === null) {
          throw new Error(image.sourceName + '：atlas 未标记原图 Alpha，转 JPG 前请选择已预乘（PMA）或未预乘（Straight）');
        }
        const png = await decodeAtlasPage(image);
        const { width, height } = png.header;
        const rgba = pngToRgba(png);
        let data;
        let encoding;
        let quality = null;
        let alphaQuality = null;
        let rgbaVerified = false;
        let alphaVerified = false;
        let transparentRgbVerified = false;

        if (image.outputFormat === 'jpg') {
          data = await encodeJpeg(compositeOnBlack(rgba, image.pma), width, height, encodeOptions.jpgQuality);
          encoding = 'jpg';
          quality = encodeOptions.jpgQuality;
          warnings.push(image.sourceName + '：JPG 不保留透明，输出黑底');
        } else {
          if (width > WEBP_MAX_DIMENSION || height > WEBP_MAX_DIMENSION) throw new Error(image.sourceName + '：超过 WebP 的尺寸上限 16383');
          if (!codec) codec = await loadCodec();
          if (image.pma === false && encodeOptions.mode !== 'lossless') {
            data = await codec.encode(rgba, width, height, lossyOptions(encodeOptions.quality));
            if (!hasWebpSignature(data)) throw new Error(image.sourceName + '：WebP 输出无效');
            const back = await codec.decode(data);
            assertSameShape(image, back, width, height);
            for (let i = 3; i < rgba.length; i += 4) {
              if (rgba[i] !== back.data[i]) throw new Error(image.sourceName + '：WebP Alpha 校验失败');
            }
            encoding = 'spine';
            quality = encodeOptions.quality;
            alphaQuality = 100;
            alphaVerified = true;
          } else {
            let pmaLossy = null;
            if (image.pma === true && encodeOptions.mode !== 'lossless') {
              const over = countOverAlpha(rgba);
              if (over) warnings.push(image.sourceName + '：原图含超出 Alpha 的颜色（' + over + ' 像素），不是预乘图，预乘项目里可能有杂边');
              // PMA, lossy: exact keeps the margin black; read back and bound the
              // ringing. Climb the ladder while the margin is over the limit, and
              // keep the cleanest attempt if none passes - never lossless. A page
              // with colour under its margin carries that colour whatever the
              // quality, so it does not climb.
              const ladder = [encodeOptions.quality].concat(over ? [] : PMA_QUALITY_LADDER.filter((q) => q > encodeOptions.quality));
              for (const q of ladder) {
                const candidate = await codec.encode(rgba, width, height, pmaLossyOptions(q));
                if (!hasWebpSignature(candidate)) throw new Error(image.sourceName + '：WebP 输出无效');
                const back = await codec.decode(candidate);
                assertSameShape(image, back, width, height);
                let spill = 0;
                for (let i = 0; i < rgba.length; i += 4) {
                  if (rgba[i + 3] !== back.data[i + 3]) throw new Error(image.sourceName + '：WebP Alpha 校验失败');
                  if (rgba[i + 3] === 0) spill = Math.max(spill, back.data[i], back.data[i + 1], back.data[i + 2]);
                }
                if (!pmaLossy || spill < pmaLossy.spill) pmaLossy = { data: candidate, quality: q, spill };
                if (spill <= PMA_TRANSPARENT_LIMIT) break;
              }
              if (pmaLossy.quality !== ladder[0]) {
                warnings.push(image.sourceName + (pmaLossy.spill <= PMA_TRANSPARENT_LIMIT
                  ? '：Q' + ladder[0] + ' 透明区残留超过 ' + PMA_TRANSPARENT_LIMIT + '，已改用 Q' + pmaLossy.quality + ' 并通过校验'
                  : '：各档位透明区残留均超过 ' + PMA_TRANSPARENT_LIMIT + '，已取残留最低的 Q' + pmaLossy.quality + '（' + pmaLossy.spill + ' 级）'));
              } else if (pmaLossy.spill > PMA_TRANSPARENT_LIMIT) {
                warnings.push(image.sourceName + '：各档位透明区残留均超过 ' + PMA_TRANSPARENT_LIMIT + '，已取残留最低的 Q' + pmaLossy.quality + '（' + pmaLossy.spill + ' 级）');
              }
            }
            if (pmaLossy) {
              data = pmaLossy.data;
              encoding = 'pma-compatible';
              quality = pmaLossy.quality;
              alphaQuality = 100;
              alphaVerified = true;
              transparentRgbVerified = pmaLossy.spill <= PMA_TRANSPARENT_LIMIT;
            } else {
              // Unmarked, asked for lossless, or PMA that failed its check: every byte kept and read back.
              data = await codec.encode(rgba, width, height, LOSSLESS_OPTIONS);
              if (!hasWebpSignature(data)) throw new Error(image.sourceName + '：WebP 输出无效');
              const back = await codec.decode(data);
              assertSameShape(image, back, width, height);
              for (let i = 0; i < rgba.length; i += 1) {
                if (rgba[i] !== back.data[i]) throw new Error(image.sourceName + '：WebP RGBA 像素校验失败，未生成可导出结果');
              }
              encoding = image.pma === true ? 'pma-lossless' : encodeOptions.mode === 'lossless' ? 'lossless' : 'rgba-lossless';
              rgbaVerified = true;
              alphaVerified = true;
              transparentRgbVerified = true;
              if (image.pma === null) warnings.push(image.sourceName + '：atlas 未标记原图 Alpha，已无损保留 RGBA；不改变预乘状态，体积可能较大');
            }
          }
        }

        convertedImages.push({
          sourceName: image.sourceName,
          fileName: image.outputName,
          format: image.outputFormat,
          bytes: data,
          width,
          height,
          size: data.length,
          sourceAlphaMode: image.pma === null ? 'unknown' : image.pma ? 'pma' : 'straight',
          pma: image.outputFormat === 'webp' && image.pma,
          rgbaVerified,
          alphaVerified,
          transparentRgbVerified,
          encoding,
          quality,
          alphaQuality
        });
      }
      if (!convertedImages.length) throw new Error('未生成图集');

      return { ok: true, atlas: convertedAtlases[0], atlases: convertedAtlases, images: convertedImages, warnings };
    }

    api.convertSpineAtlasWebp = async (payload) => {
      const cue = root.NovaFlowWebBusy;
      if (cue) cue.begin('spine-webp', '正在转换图集…');
      try {
        return await convertSpineAtlasWebp(payload);
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) };
      } finally {
        if (cue) cue.end('spine-webp');
      }
    };
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
