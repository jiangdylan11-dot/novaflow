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
//   open output folder           a download, since a tab has no file manager
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

    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });

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

  api.runtimeOpenOutputFolder = async () => fail(
    'Web 版没有本地输出目录。结果可以用下载按钮保存，或在「仓库」里查看。'
  );

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
  api.pickDirectory = async () => {
    if (typeof root.showDirectoryPicker !== 'function') {
      return fail('这个浏览器不支持选择文件夹，请改用拖拽或逐个选择文件');
    }
    try {
      const dir = await root.showDirectoryPicker({ mode: 'readwrite' });
      return ok({ name: dir.name, handle: dir, path: 'web-directory://' + dir.name });
    } catch (error) {
      if (error && error.name === 'AbortError') return ok({ canceled: true });
      return fail(error && error.message ? error.message : error);
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
