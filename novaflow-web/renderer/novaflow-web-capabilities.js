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

  api.minimaxH3RuntimeStop = async () => {
    // Stopping H3 means cancelling whatever this user has running.
    try {
      const res = await runtime.control('GET', '/api/web/tasks?limit=20');
      const running = (res.tasks || []).filter(
        (t) => ['created', 'queued', 'assigned', 'uploading', 'processing'].includes(t.status)
      );
      for (const task of running) {
        await runtime.control('POST', '/api/web/tasks/' + task.id + '/cancel').catch(() => {});
      }
      return ok({ cancelled: running.length });
    } catch (error) {
      return fail(error.message || error);
    }
  };

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
      // Some callers ask for a path first and write later. A browser cannot
      // hand out a path, so it must be told now rather than later.
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
        for await (const [name, handle] of dir.entries()) {
          if (handle.kind !== 'file') continue;
          const file = await handle.getFile();
          files.push({ name, size: file.size, type: file.type, file });
        }
        return ok({ directory: dir.name, files, via: 'file-system-access' });
      } catch (error) {
        if (error && error.name === 'AbortError') return ok({ canceled: true });
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
    cache.set(key, { reservedAt: Date.now(), blob: null, bytes: 0 });
    return ok({ key, reserved: true });
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

  api.aiSeqCacheCopyFromPath = async () => fail('Web 版没有本地文件路径可复制');

  api.clearVideoToolOutput = async () => { releaseCache(); return ok({ cleared: true }); };
  api.videoResourceMediaRelease = async (payload) => {
    const key = String((payload && (payload.key || payload.id)) || '');
    if (key) releaseCache(key);
    return ok({ released: true });
  };
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

  api.videoCompositorRegisterSource = async (payload) => {
    const session = sessions.get(String(payload && payload.sessionId));
    if (!session) return fail('unknown compositor session');
    const sourceId = String(payload.sourceId || payload.id || 'src-' + (session.sources.size + 1));
    session.sources.set(sourceId, {
      id: sourceId,
      url: payload.url || '',
      file: payload.file || (payload.path ? runtime.fileForToken(payload.path) : null),
      z: Number(payload.z || session.sources.size),
      opacity: payload.opacity === undefined ? 1 : Number(payload.opacity)
    });
    return ok({ sourceId });
  };

  api.videoCompositorReleaseSource = async (payload) => {
    const session = sessions.get(String(payload && payload.sessionId));
    if (session) session.sources.delete(String(payload.sourceId || payload.id));
    return ok({ released: true });
  };

  api.videoCompositorPutMask = async (payload) => {
    const session = sessions.get(String(payload && payload.sessionId));
    if (!session) return fail('unknown compositor session');
    session.masks.set(String(payload.sourceId || payload.id || 'mask'), payload.mask || payload.data || null);
    return ok({ stored: true });
  };

  api.videoCompositorCancel = async (payload) => {
    const jobId = String((payload && payload.jobId) || '');
    if (jobId) cancelled.add(jobId);
    return ok({ cancelled: true });
  };

  api.videoCompositorCloseSession = async (payload) => {
    sessions.delete(String(payload && payload.sessionId));
    return ok({ closed: true });
  };

  api.videoCompositorExport = async (manifest) => {
    const session = sessions.get(String(manifest && manifest.sessionId));
    if (!session) return fail('unknown compositor session');
    if (typeof root.MediaRecorder !== 'function') {
      return fail('这个浏览器不支持 MediaRecorder，无法在本地合成视频');
    }

    jobSeq += 1;
    const jobId = String(manifest.jobId || 'web-vc-job-' + jobSeq);
    const width = Number(manifest.width || session.width);
    const height = Number(manifest.height || session.height);
    const fps = Number(manifest.fps || session.fps) || 24;

    const report = (stage, progress01, message) =>
      compositorProgress.emit({ jobId, stage, progress01, message });

    try {
      report('prepare', 0, '准备视频源');

      // Load every source as a <video> we can draw from.
      const layers = [];
      for (const source of [...session.sources.values()].sort((a, b) => a.z - b.z)) {
        const url = source.file ? URL.createObjectURL(source.file) : source.url;
        if (!url) continue;
        const video = root.document.createElement('video');
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        await new Promise((resolve, reject) => {
          video.addEventListener('loadedmetadata', resolve, { once: true });
          video.addEventListener('error', () => reject(new Error('无法读取视频源 ' + source.id)), { once: true });
        });
        layers.push({ video, opacity: source.opacity, revoke: source.file ? url : '' });
      }
      if (!layers.length) return fail('没有可合成的视频源');

      const duration = Math.max(...layers.map((l) => Number(l.video.duration) || 0));
      if (!Number.isFinite(duration) || duration <= 0) return fail('视频源没有有效时长');

      const canvas = root.document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      const stream = canvas.captureStream(fps);
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find((m) => root.MediaRecorder.isTypeSupported(m)) || 'video/webm';
      const recorder = new root.MediaRecorder(stream, { mimeType: mime });
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

      const finished = new Promise((resolve) => { recorder.onstop = resolve; });
      recorder.start();

      const totalFrames = Math.max(1, Math.round(duration * fps));
      for (let frame = 0; frame < totalFrames; frame += 1) {
        if (cancelled.has(jobId)) {
          recorder.stop();
          await finished;
          cancelled.delete(jobId);
          return { ok: false, canceled: true, code: 'export_canceled' };
        }
        const t = frame / fps;
        ctx.clearRect(0, 0, width, height);
        for (const layer of layers) {
          if (t > (layer.video.duration || 0)) continue;
          await seekTo(layer.video, t);
          ctx.globalAlpha = layer.opacity;
          ctx.drawImage(layer.video, 0, 0, width, height);
        }
        ctx.globalAlpha = 1;
        if (frame % Math.max(1, Math.round(fps / 2)) === 0) {
          report('render', frame / totalFrames, '合成中 ' + Math.round((frame / totalFrames) * 100) + '%');
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      recorder.stop();
      await finished;
      for (const layer of layers) if (layer.revoke) URL.revokeObjectURL(layer.revoke);

      const blob = new Blob(chunks, { type: mime });
      report('done', 1, '视频合成完成');

      return {
        ok: true,
        jobId,
        blob,
        url: URL.createObjectURL(blob),
        bytes: blob.size,
        // Said plainly: the desktop writes MP4, a browser recorder writes WebM.
        format: 'webm',
        mimeType: mime,
        note: 'Web 版用浏览器录制合成，输出为 WebM（桌面版为 MP4）'
      };
    } catch (error) {
      return fail(error && error.message ? error.message : error, { jobId });
    }
  };

  function seekTo(video, time) {
    return new Promise((resolve) => {
      if (Math.abs(video.currentTime - time) < 0.001) { resolve(); return; }
      const done = () => { video.removeEventListener('seeked', done); resolve(); };
      video.addEventListener('seeked', done);
      try { video.currentTime = time; } catch (_) { resolve(); }
    });
  }

  // ------------------------------------------------------------------ report
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

    let taskId = '';
    try {
      reportMatting(jobId, 'running', '正在准备素材…', 0.02);

      const packs = packCapturedFrames(frames);
      const references = packs.map((pack, index) => ({ name: 'frames-' + index + '.bin', kind: 'frames', bytes: pack.size }));
      reportMatting(jobId, 'running', '正在排队等待算力…', 0.05);

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
      for (let index = 0; index < packs.length; index++) {
        await runtime.putTaskInput(taskId, references[index].name, packs[index], (seconds) => {
          reportMatting(jobId, 'running', '正在等待算力接收视频帧…（' + seconds + 's）', 0.06);
        });
      }
      reportMatting(jobId, 'running', '已送达算力节点，开始 AI 分割…', 0.12);

      const done = await waitForMatting(runtime, taskId, jobId);
      const manifest = (done.output_manifest && done.output_manifest.files) || [];
      const maskFile = manifest.find((f) => /^mask[-.]/.test(String(f.name || '')));
      if (!maskFile) throw new Error('算力节点没有返回遮罩文件');

      reportMatting(jobId, 'running', '正在取回遮罩…', 0.9);
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
      if (taskId) {
        try { await runtime.control('POST', '/api/web/tasks/' + taskId + '/cancel', {}); } catch (_) { /* already terminal */ }
      }
      const rawMessage = String((error && error.message) || error);
      const message = error?.status === 401 || /missing session token|invalid session|session expired/i.test(rawMessage)
        ? '登录已失效，请点顶栏右上角的账号按钮重新登录后重试抠图'
        : rawMessage;
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
    '自有算力任务不计积分；付费 Provider（Grok / GPT / Google）按次结算',
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

  api.openSpineProject = async () => {
    return await new Promise((resolve) => {
      const input = root.document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.json,.skel,.atlas,.png,.webp';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const files = [...(input.files || [])].map((f) => ({
          name: f.name, size: f.size, type: f.type, file: f
        }));
        input.remove();
        resolve(files.length ? ok({ files, via: 'input' }) : ok({ canceled: true }));
      });
      root.document.body.appendChild(input);
      input.click();
    });
  };

  // ---- file writing ------------------------------------------------------
  api.writeBinaryFile = async (payload) => {
    const options = payload || {};
    // Into the folder pickDirectory handed out, when the caller went through
    // it; otherwise the save dialog, one file at a time.
    const folder = directoryHandles.get(String(options.dir || ''));
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

  api.exportCleanupDir = async () => ok({ cleaned: true, note: 'Web 版没有导出临时目录' });

  // ---- misc runtime ------------------------------------------------------
  api.minimaxH3RuntimeEnsureStarted = async () => api.runtimeEnsureStarted();

  api.videoResourceMediaRegister = async (payload) => {
    const key = String((payload && (payload.key || payload.id)) || 'media-' + Date.now());
    return ok({ key, registered: true });
  };

  /**
   * Match the colour of the first and last frames.
   *
   * The desktop does this with ffmpeg. Here it is a canvas operation: sample
   * both frames' mean colour and report the correction, leaving the pixel work
   * to the caller that already owns the frames.
   */
  api.aiSeqFixHeadTailColor = async (payload) => {
    const frames = (payload && payload.frames) || [];
    if (frames.length < 2) return ok({ adjusted: false, reason: 'not enough frames' });
    return ok({
      adjusted: false,
      supported: false,
      note: 'Web 版暂未实现首尾帧色彩校正，序列本身不受影响'
    });
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
  api.compressSpineAtlasSafe = async (payload) => {
    try {
      const source = bytesFromDataUrl(payload && payload.dataUrl);
      const { chunks, header, raw } = await decode(source);
      const level = Math.max(0, Math.min(9, Math.round(Number(payload && payload.compressionLevel) || 0)));

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

      return {
        ok: true,
        bytes: Array.from(out),
        width: header.width,
        height: header.height,
        losslessVerified: true
      };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
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
  // What the browser does differently: a PMA page is written LOSSLESS. The
  // desktop's PMA-compatible lossy encoder hands libwebp a YUV frame whose
  // fully transparent pixels sit below black, so VP8 ringing cannot lift them
  // above it; libwebp's RGBA entry has no such headroom, and every lossy
  // encode measured here left thousands of transparent pixels a few levels
  // above black - a fringe under premultiplied blending. Lossless keeps every
  // byte, is checked byte for byte, and still lands at about half the PNG.
  // The status and warnings say so, and docs/LIMITATIONS.md records it.
  // ---------------------------------------------------------------------------
  if (typeof api.convertSpineAtlasWebp !== 'function') installSpineAtlasWebp();

  function installSpineAtlasWebp() {
    const WEBP_VENDOR_VERSION = '1.5.0';
    const WEBP_PRESETS = { clarity: 95, compact: 90, small: 70 };
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
    // Exact: every RGBA byte kept, transparent pixels included. Method 4 came
    // out within a kilobyte of method 6 on real atlases at a fifth of the time.
    const LOSSLESS_OPTIONS = Object.assign({}, WEBP_DEFAULT_OPTIONS, { lossless: 1, exact: 1, quality: 100, method: 4 });
    // wasm-feature-detect's SIMD probe: a module with one v128 instruction.
    const SIMD_PROBE = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11);

    // vendor/webp/ sits next to this script; index.html loads it as ./novaflow-web-capabilities.js.
    const scriptBase = (() => {
      try {
        const src = root.document && root.document.currentScript && root.document.currentScript.src;
        if (src) return new URL('./', src).href;
        return (root.document && root.document.baseURI) || '';
      } catch (_) {
        return '';
      }
    })();
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
            // PMA, unmarked, or asked for lossless: every byte kept and read back.
            if (image.pma === true) {
              const over = countOverAlpha(rgba);
              if (over) warnings.push(image.sourceName + '：原图含超出 Alpha 的颜色（' + over + ' 像素），按无损保留');
            }
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
            if (image.pma === true) warnings.push(image.sourceName + '：网页版对 PMA 图集只做无损 WebP，已逐字节校验 RGBA；压缩档位不影响这张图，体积可能较大（PMA 兼容有损压缩请用桌面版）');
            if (image.pma === null) warnings.push(image.sourceName + '：atlas 未标记原图 Alpha，已无损保留 RGBA；不改变预乘状态，体积可能较大');
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
      try {
        return await convertSpineAtlasWebp(payload);
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) };
      }
    };
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
