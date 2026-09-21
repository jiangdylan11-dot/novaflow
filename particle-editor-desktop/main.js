require("./main/stdio-guard").installStdioGuards();
const { app, BrowserWindow, shell, ipcMain, dialog, Menu, screen, protocol, net: electronNet } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const ffmpegPath = require("ffmpeg-static");
const { monitorEventLoopDelay, performance } = require("perf_hooks");
let ffprobePath = null;
try {
  ffprobePath = require("ffprobe-static")?.path || null;
} catch {
  ffprobePath = null;
}
const sharp = require("sharp");
const os = require("os");
const licenseCore = require("./license-core");
const licenseOnline = require("./license/verifyLicenseOnline");
const { renderLicenseLockScreenHtml } = require("./license/licenseLockScreen");
const { dataUrlToBuffer, clampManifestNumber } = require("./main/buffer-helpers");
const { createPngCompressor } = require("./main/compression-helpers");
const { convertSpineAtlasWebp, overwriteSpineAtlasWebpOutput, writeSpineAtlasWebpOutput } = require("./main/spine-atlas-webp-converter");
const { compressMp4 } = require("./main/mp4-compressor");
const { convertVideoFormat } = require("./main/video-format-converter");
const {
  sanitizeFileName,
  sanitizeFileStem,
  ensurePngFileName,
  isPathInside,
  guessMimeFromPath
} = require("./main/path-helpers");
const { isHttpUrl, sanitizeRuntimeBaseUrl, isAllowedAppUrl } = require("./main/url-helpers");
const { resolveSingleInstanceProfile, preparePortableUserDataPath, decideSecondInstanceAction } = require("./main/single-instance-policy");
const { createRuntimeStartCoordinator } = require("./main/runtime-lifecycle");
const { createMiniMaxH3RuntimeLifecycle } = require("./main/minimax-h3-runtime-lifecycle");
const { createMiniMaxH3OutputPublisher } = require("./main/minimax-h3-output-publisher");
const { createMiniMaxH3LoraCatalog } = require("./main/minimax-h3-lora-catalog");
const { createTempSessionLifecycle } = require("./main/temp-session-lifecycle");
const {
  createVideoCompositorExportService,
  registerVideoCompositorExportIpc
} = require("./main/video-compositor-export");
const {
  registerVideoResourceMediaScheme,
  createVideoResourceMediaService,
  registerVideoResourceMediaIpc
} = require("./main/video-resource-media");
const clientAuthDirect = require("./client-auth-direct");
let comfyWorkflowCreditCostApi = null;

registerVideoResourceMediaScheme(protocol);

function loadComfyWorkflowCreditCostApi() {
  if (comfyWorkflowCreditCostApi && typeof comfyWorkflowCreditCostApi.estimateWorkflowCreditCost === "function") {
    return comfyWorkflowCreditCostApi;
  }
  try {
    comfyWorkflowCreditCostApi = require(path.join(__dirname, "renderer", "comfyui-workflow-credit-cost.js"));
  } catch {
    comfyWorkflowCreditCostApi = null;
  }
  return comfyWorkflowCreditCostApi;
}
const compressPngWithSharp = createPngCompressor({ fs, sharp });
const aiCutoutReadyCache = {
  rembg: null,
  birefnet: null
};

const NOVAFLOW_EXPORT_PICK_SAVE_CANCELED_CHANNEL = "novaflow-export-pick-save-file-canceled";

function hasProcessSwitch(name) {
  const flag = `--${name}`;
  return process.argv.some((arg) => arg === flag || String(arg || "").startsWith(`${flag}=`));
}

function getProcessSwitchValue(name) {
  const flag = `--${name}=`;
  const found = process.argv.find((arg) => String(arg || "").startsWith(flag));
  return found ? String(found).slice(flag.length) : "";
}

function isTruthyEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

const NF_ELECTRON_PROFILE_ENABLED = isTruthyEnv(process.env.NF_ELECTRON_PROFILE) || hasProcessSwitch("nf-electron-profile");
const NF_ELECTRON_AB_HTTP_RENDERER = getProcessSwitchValue("nf-electron-ab-http-renderer");
const NF_ELECTRON_AB_HTTP_RENDERER_URL = NF_ELECTRON_AB_HTTP_RENDERER === "4783" ? "http://127.0.0.1:4783/" : "";
const NF_ELECTRON_EXTERNAL_BROWSER = getProcessSwitchValue("nf-electron-external-browser");
const NF_ELECTRON_EXTERNAL_BROWSER_URL = NF_ELECTRON_EXTERNAL_BROWSER === "4783" ? "http://127.0.0.1:4783/" : "";
const NF_ELECTRON_AB_BACKGROUND_THROTTLING_OFF = hasProcessSwitch("nf-electron-ab-background-throttling-off");
const NF_ELECTRON_AB_NO_PRELOAD = hasProcessSwitch("nf-electron-ab-no-preload");
const NF_ELECTRON_AB_NO_RUNTIME_AUTOSTART = hasProcessSwitch("nf-electron-ab-no-runtime-autostart");
const NF_ELECTRON_AB_NO_SYSTEM_MOUSE_HELPER = hasProcessSwitch("nf-electron-ab-no-system-mouse-helper");

const electronProfileState = {
  enabled: NF_ELECTRON_PROFILE_ENABLED,
  startedAt: Date.now(),
  counters: Object.create(null),
  timings: Object.create(null),
  ipc: Object.create(null),
  windowEvents: Object.create(null),
  webContentsEvents: Object.create(null),
  recentEvents: [],
  config: {
    profile: NF_ELECTRON_PROFILE_ENABLED,
    abHttpRenderer: NF_ELECTRON_AB_HTTP_RENDERER || "",
    abHttpRendererUrl: NF_ELECTRON_AB_HTTP_RENDERER_URL,
    externalBrowser: NF_ELECTRON_EXTERNAL_BROWSER || "",
    externalBrowserUrl: NF_ELECTRON_EXTERNAL_BROWSER_URL,
    abBackgroundThrottlingOff: NF_ELECTRON_AB_BACKGROUND_THROTTLING_OFF,
    abNoPreload: NF_ELECTRON_AB_NO_PRELOAD,
    abNoRuntimeAutostart: NF_ELECTRON_AB_NO_RUNTIME_AUTOSTART,
    abNoSystemMouseHelper: NF_ELECTRON_AB_NO_SYSTEM_MOUSE_HELPER
  },
  cpuBaseline: process.cpuUsage()
};
let electronProfileEventLoopDelay = null;
let electronProfileSnapshotTimer = null;

function electronProfileConsole(label, payload) {
  if (!electronProfileState.enabled) return;
  try {
    console.log(`[nf-electron-profile] ${label} ${safeJson(payload || {})}`);
  } catch {
    void 0;
  }
}

function electronProfileIncrement(bucket, name, delta = 1) {
  if (!electronProfileState.enabled) return;
  const target = electronProfileState[bucket] || (electronProfileState[bucket] = Object.create(null));
  target[name] = (Number(target[name]) || 0) + delta;
}

function electronProfileRecordEvent(kind, name, meta) {
  if (!electronProfileState.enabled) return;
  electronProfileIncrement(kind, name, 1);
  electronProfileState.recentEvents.push({
    at: Date.now(),
    kind,
    name,
    meta: meta && typeof meta === "object" ? meta : undefined
  });
  if (electronProfileState.recentEvents.length > 160) electronProfileState.recentEvents.shift();
}

function electronProfileRecordIpc(channel, durationMs, ok) {
  if (!electronProfileState.enabled) return;
  const key = String(channel || "unknown");
  const item = electronProfileState.ipc[key] || {
    count: 0,
    errorCount: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0
  };
  const ms = Math.max(0, Number(durationMs) || 0);
  item.count += 1;
  item.totalMs += ms;
  item.maxMs = Math.max(item.maxMs, ms);
  item.lastMs = ms;
  if (!ok) item.errorCount += 1;
  electronProfileState.ipc[key] = item;
}

function summarizeElectronAppMetrics() {
  try {
    return app.getAppMetrics().map((metric) => ({
      pid: metric?.pid,
      type: metric?.type,
      sandboxed: metric?.sandboxed,
      cpu: metric?.cpu ? {
        percentCPUUsage: metric.cpu.percentCPUUsage,
        idleWakeupsPerSecond: metric.cpu.idleWakeupsPerSecond
      } : null,
      memory: metric?.memory ? {
        workingSetSize: metric.memory.workingSetSize,
        peakWorkingSetSize: metric.memory.peakWorkingSetSize,
        privateBytes: metric.memory.privateBytes
      } : null
    }));
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

function cloneElectronProfilePlainObject(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => cloneElectronProfilePlainObject(item));
  const output = {};
  Object.keys(value).forEach((key) => {
    output[key] = cloneElectronProfilePlainObject(value[key]);
  });
  return output;
}

function snapshotElectronProfile() {
  const cpu = (() => {
    try {
      const usage = process.cpuUsage(electronProfileState.cpuBaseline);
      return {
        userMs: Math.round(usage.user / 1000),
        systemMs: Math.round(usage.system / 1000)
      };
    } catch (err) {
      return { error: String(err?.message || err) };
    }
  })();
  const memory = (() => {
    try {
      const usage = process.memoryUsage();
      return {
        rss: usage.rss,
        heapTotal: usage.heapTotal,
        heapUsed: usage.heapUsed,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers
      };
    } catch (err) {
      return { error: String(err?.message || err) };
    }
  })();
  const eventLoopDelay = (() => {
    try {
      if (!electronProfileEventLoopDelay) return { enabled: false };
      return {
        enabled: true,
        minMs: Math.round(Number(electronProfileEventLoopDelay.min || 0) / 1e6),
        maxMs: Math.round(Number(electronProfileEventLoopDelay.max || 0) / 1e6),
        meanMs: Math.round(Number(electronProfileEventLoopDelay.mean || 0) / 1e6),
        exceeds: Number(electronProfileEventLoopDelay.exceeds || 0)
      };
    } catch (err) {
      return { error: String(err?.message || err) };
    }
  })();
  return {
    enabled: electronProfileState.enabled,
    startedAt: electronProfileState.startedAt,
    uptimeMs: Date.now() - electronProfileState.startedAt,
    config: electronProfileState.config,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8
    },
    gpuFeatureStatus: (() => {
      try { return app.getGPUFeatureStatus(); } catch (err) { return { error: String(err?.message || err) }; }
    })(),
    appMetrics: summarizeElectronAppMetrics(),
    cpu,
    memory,
    eventLoopDelay,
    counters: cloneElectronProfilePlainObject(electronProfileState.counters),
    timings: cloneElectronProfilePlainObject(electronProfileState.timings),
    ipc: cloneElectronProfilePlainObject(electronProfileState.ipc),
    windowEvents: cloneElectronProfilePlainObject(electronProfileState.windowEvents),
    webContentsEvents: cloneElectronProfilePlainObject(electronProfileState.webContentsEvents),
    recentEvents: cloneElectronProfilePlainObject(electronProfileState.recentEvents.slice(-80))
  };
}

function resetElectronProfile() {
  electronProfileState.startedAt = Date.now();
  electronProfileState.counters = Object.create(null);
  electronProfileState.timings = Object.create(null);
  electronProfileState.ipc = Object.create(null);
  electronProfileState.windowEvents = Object.create(null);
  electronProfileState.webContentsEvents = Object.create(null);
  electronProfileState.recentEvents = [];
  electronProfileState.cpuBaseline = process.cpuUsage();
  try { electronProfileEventLoopDelay?.reset?.(); } catch {}
  return snapshotElectronProfile();
}

function startElectronProfileConsoleReporter() {
  if (!electronProfileState.enabled || electronProfileSnapshotTimer) return;
  try {
    electronProfileSnapshotTimer = setInterval(() => {
      electronProfileConsole("periodic-snapshot", snapshotElectronProfile());
    }, 10_000);
    electronProfileSnapshotTimer.unref?.();
  } catch {
    electronProfileSnapshotTimer = null;
  }
}

function stopElectronProfileConsoleReporter() {
  try {
    if (electronProfileSnapshotTimer) clearInterval(electronProfileSnapshotTimer);
  } catch {}
  electronProfileSnapshotTimer = null;
}

function wrapElectronProfileIpcHandler(channel, listener) {
  if (!electronProfileState.enabled || typeof listener !== "function") return listener;
  return function electronProfileIpcHandler(...args) {
    const started = performance.now();
    let result;
    try {
      result = listener.apply(this, args);
    } catch (err) {
      electronProfileRecordIpc(channel, performance.now() - started, false);
      throw err;
    }
    if (result && typeof result.then === "function") {
      return result.then(
        (value) => {
          electronProfileRecordIpc(channel, performance.now() - started, true);
          return value;
        },
        (err) => {
          electronProfileRecordIpc(channel, performance.now() - started, false);
          throw err;
        }
      );
    }
    electronProfileRecordIpc(channel, performance.now() - started, true);
    return result;
  };
}

const originalIpcMainHandle = ipcMain.handle.bind(ipcMain);
const originalIpcMainOn = ipcMain.on.bind(ipcMain);
if (electronProfileState.enabled) {
  try {
    electronProfileEventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
    electronProfileEventLoopDelay.enable();
  } catch {
    electronProfileEventLoopDelay = null;
  }
  ipcMain.handle = function electronProfileHandle(channel, listener) {
    return originalIpcMainHandle(channel, wrapElectronProfileIpcHandler(channel, listener));
  };
  ipcMain.on = function electronProfileOn(channel, listener) {
    return originalIpcMainOn(channel, wrapElectronProfileIpcHandler(channel, listener));
  };
}

originalIpcMainHandle("electron-profile-snapshot", async () => {
  const snapshot = snapshotElectronProfile();
  electronProfileConsole("snapshot", snapshot);
  return snapshot;
});
originalIpcMainHandle("electron-profile-reset", async () => {
  const snapshot = resetElectronProfile();
  electronProfileConsole("reset", snapshot);
  return snapshot;
});

electronProfileConsole("enabled", electronProfileState.config);

function attachElectronProfileWindow(win, label) {
  if (!electronProfileState.enabled || !win) return;
  const windowLabel = String(label || "main");
  const recordWindow = (name, metaFactory) => {
    try {
      win.on(name, (...args) => {
        let meta = { windowLabel };
        try {
          if (typeof metaFactory === "function") meta = { ...meta, ...metaFactory(...args) };
        } catch {}
        electronProfileRecordEvent("windowEvents", name, meta);
      });
    } catch {}
  };
  const recordWebContents = (name, metaFactory) => {
    try {
      win.webContents.on(name, (...args) => {
        let meta = { windowLabel };
        try {
          if (typeof metaFactory === "function") meta = { ...meta, ...metaFactory(...args) };
        } catch {}
        electronProfileRecordEvent("webContentsEvents", name, meta);
      });
    } catch {}
  };

  [
    "focus",
    "blur",
    "show",
    "hide",
    "maximize",
    "unmaximize",
    "enter-full-screen",
    "leave-full-screen",
    "responsive",
    "unresponsive"
  ].forEach((name) => recordWindow(name));
  recordWindow("resize", () => {
    try {
      const [width, height] = win.getSize();
      return { width, height };
    } catch {
      return {};
    }
  });
  recordWindow("move", () => {
    try {
      const [x, y] = win.getPosition();
      return { x, y };
    } catch {
      return {};
    }
  });

  [
    "did-start-loading",
    "did-finish-load",
    "dom-ready",
    "did-frame-finish-load",
    "responsive",
    "unresponsive"
  ].forEach((name) => recordWebContents(name));
  recordWebContents("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => ({
    errorCode,
    errorDescription: String(errorDescription || "").slice(0, 160),
    url: String(validatedURL || "").slice(0, 240),
    isMainFrame
  }));
  recordWebContents("render-process-gone", (_event, details) => ({
    reason: String(details?.reason || ""),
    exitCode: details?.exitCode
  }));
}

function recordRuntimeStatusChangedSend(source, status) {
  if (!electronProfileState.enabled) return;
  electronProfileIncrement("counters", "runtimeStatusChangedSend", 1);
  electronProfileState.recentEvents.push({
    at: Date.now(),
    kind: "runtime",
    name: "runtime-status-changed",
    meta: {
      source: String(source || ""),
      status: String(status?.status || ""),
      running: status?.running === true,
      connected: status?.connected === true
    }
  });
  if (electronProfileState.recentEvents.length > 160) electronProfileState.recentEvents.shift();
}

function sendRuntimeStatusChangedToWindow(win, status, source) {
  recordRuntimeStatusChangedSend(source, status);
  if (win && !win.isDestroyed()) win.webContents.send("runtime-status-changed", status);
}

function renderElectronProfileHttpRendererFailureHtml(url, err) {
  const message = String(err?.message || err || "load failed");
  return `<!doctype html>
<meta charset="utf-8">
<title>NovaFlow Electron Profiling</title>
<body style="margin:0;background:#0b0d10;color:#f6f7fb;font:14px/1.5 system-ui,Segoe UI,sans-serif;">
  <main style="max-width:760px;margin:64px auto;padding:24px;">
    <h1 style="font-size:20px;margin:0 0 12px;">Electron HTTP renderer A/B failed</h1>
    <p>Could not load <code>${String(url || "").replace(/[<>&]/g, "")}</code>.</p>
    <pre style="white-space:pre-wrap;background:#151922;border:1px solid #2a3140;padding:16px;">${message.replace(/[<>&]/g, "")}</pre>
    <p>Start the 4783 preview server, then relaunch with <code>--nf-electron-ab-http-renderer=4783</code>.</p>
  </main>
</body>`;
}

function escapeNovaflowExportRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNovaflowExportFileExtension(fileName, fallback = ".png") {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  return ext || fallback || "";
}

function getNovaflowExportTrailingFrameToken(fileName) {
  const stem = sanitizeFileStem(fileName, "");
  const match = stem.match(/(?:^|[_-])(?:frame|f)?[_-]?(\d{1,6})$/i);
  if (!match) return "";
  return match[1].padStart(Math.min(Math.max(match[1].length, 3), 6), "0");
}

function isNovaflowGeneratedExportName(value) {
  const stem = sanitizeFileStem(value, "");
  return /^(?:video|frames|spine)[_-]/i.test(stem) && /[_-]\d{14}(?:[_-]|$)/.test(stem);
}

function inferNovaflowManualExportStem(value) {
  let stem = sanitizeFileStem(value, "");
  if (!stem) return "";
  stem = stem.replace(/^(?:video|frames|spine)[_-]+/i, "");
  stem = stem.replace(/[_-](?:frame|f)?[_-]?\d{1,6}$/i, "");
  const autoStampIndex = stem.search(/[_-]\d{14}(?:[_-]|$)/);
  if (autoStampIndex > 0) stem = stem.slice(0, autoStampIndex);
  else stem = stem.replace(/[_-]app\d+(?:_\d+)*(?:[_-].*)?$/i, "");
  return sanitizeFileStem(stem, "");
}

function normalizeNovaflowExportBaseName(value, fallback) {
  return inferNovaflowManualExportStem(value) || sanitizeFileStem(value, fallback);
}

function normalizeNovaflowExportWriteFileName(fileName, fallbackStem = "frame") {
  const original = sanitizeFileName(fileName);
  if (!original || !isNovaflowGeneratedExportName(original)) return original;
  const baseName = normalizeNovaflowExportBaseName(original, fallbackStem);
  const ext = getNovaflowExportFileExtension(original, ".png");
  const token = getNovaflowExportTrailingFrameToken(original);
  return sanitizeFileName(`${baseName}${token ? `_${token}` : ""}${ext}`);
}

function shouldNormalizeNovaflowExportPackageImages(baseName, images) {
  return isNovaflowGeneratedExportName(baseName) ||
    images.some((image) => isNovaflowGeneratedExportName(image?.fileName));
}

function normalizeNovaflowExportPackageImages(images, baseName) {
  const total = images.length;
  const replacements = [];
  const nextImages = images.map((image, index) => {
    const originalName = sanitizeFileName(image?.fileName);
    if (!originalName) return image;
    const ext = getNovaflowExportFileExtension(originalName, ".png");
    const stem = total > 1 ? `${baseName}_${String(index).padStart(4, "0")}` : baseName;
    const nextName = sanitizeFileName(`${stem}${ext}`);
    if (nextName && nextName !== originalName) {
      replacements.push({ oldNames: [originalName], nextName });
    }
    return { ...(image && typeof image === "object" ? image : {}), fileName: nextName || originalName };
  });
  return { images: nextImages, replacements };
}

function replaceNovaflowExportTextReferences(text, replacements) {
  let output = String(text || "");
  replacements.forEach((item) => {
    const nextName = String(item?.nextName || "");
    const oldNames = Array.from(new Set(item?.oldNames || []))
      .map((name) => String(name || "").trim())
      .filter((name) => name && name !== nextName);
    oldNames.forEach((oldName) => {
      output = output.replace(new RegExp(escapeNovaflowExportRegExp(oldName), "g"), nextName);
    });
  });
  return output;
}

function notifyNovaflowExportPickSaveCanceled(evt, payload) {
  try {
    evt?.sender?.send?.(NOVAFLOW_EXPORT_PICK_SAVE_CANCELED_CHANNEL, payload);
  } catch {}
}

function safeRemoveDir(dir, options = {}) {
  const target = String(dir || "").trim();
  if (!target) return { ok: true, existed: false, dir: "" };
  const resolved = path.resolve(target);
  const label = options && options.label ? String(options.label) : "temp-dir";
  const source = options && options.source ? String(options.source) : "";
  const retryCount = Math.max(0, Math.min(8, Math.round(Number(options && options.retries) || 0)));
  const retryDelayMs = Math.max(0, Math.min(2000, Math.round(Number(options && options.retryDelayMs) || 0)));
  const logSuccess = !!(options && options.logSuccess);
  const logMissing = !!(options && options.logMissing);
  let existed = false;
  let before = null;
  try {
    existed = fs.existsSync(resolved);
    if (existed) before = summarizeCleanupDir(resolved);
  } catch (err) {
    existed = true;
    before = { error: String(err?.message || err) };
  }
  if (!existed) {
    if (logMissing) appendLogLine("info", "temp-cleanup-missing", { label, source, dir: resolved });
    return { ok: true, existed: false, dir: resolved };
  }
  let lastError = "";
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      if (typeof fs.rmSync === "function") fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      else fs.rmdirSync(resolved, { recursive: true });
    } catch (err) {
      lastError = String(err?.message || err);
    }
    try {
      if (!fs.existsSync(resolved)) {
        if (logSuccess) appendLogLine("info", "temp-cleanup-ok", { label, source, dir: resolved, attempts: attempt + 1, before });
        return { ok: true, existed: true, dir: resolved, attempts: attempt + 1, before };
      }
    } catch {
      if (logSuccess) appendLogLine("info", "temp-cleanup-ok", { label, source, dir: resolved, attempts: attempt + 1, before });
      return { ok: true, existed: true, dir: resolved, attempts: attempt + 1, before };
    }
    if (attempt < retryCount && retryDelayMs > 0) sleepSync(retryDelayMs);
  }
  const after = summarizeCleanupDir(resolved);
  appendLogLine("warn", "temp-cleanup-failed", { label, source, dir: resolved, attempts: retryCount + 1, before, after, error: lastError });
  return { ok: false, existed: true, dir: resolved, attempts: retryCount + 1, before, after, error: lastError };
}

function sleepSync(ms) {
  const delay = Math.max(0, Math.round(Number(ms) || 0));
  if (!delay) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
  } catch {
    const until = Date.now() + delay;
    while (Date.now() < until) {}
  }
}

function summarizeCleanupDir(dir) {
  const summary = { files: 0, dirs: 0, bytes: 0, errors: 0, truncated: false };
  const stack = [String(dir || "")];
  const limit = 20000;
  while (stack.length && summary.files + summary.dirs < limit) {
    const current = stack.pop();
    if (!current) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      summary.errors += 1;
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        summary.dirs += 1;
        stack.push(fullPath);
      } else {
        summary.files += 1;
        try { summary.bytes += fs.statSync(fullPath).size || 0; } catch { summary.errors += 1; }
      }
      if (summary.files + summary.dirs >= limit) {
        summary.truncated = true;
        break;
      }
    }
  }
  if (stack.length) summary.truncated = true;
  return summary;
}

function cleanupSplitTempRoot(source) {
  return safeRemoveDir(getSplitTempRoot(), { label: "split-temp-root", source, retries: 2, retryDelayMs: 250, logSuccess: source === "startup" || source === "before-quit" });
}

const activeNovaFlowCommandChildren = new Set();
const novaFlowShutdownAllowedCommandChildren = new WeakSet();

function trackNovaFlowCommandChild(child, allowDuringShutdown = false) {
  if (!child) return child;
  activeNovaFlowCommandChildren.add(child);
  if (allowDuringShutdown) novaFlowShutdownAllowedCommandChildren.add(child);
  const release = () => {
    child.__novaflowCloseObserved = true;
    activeNovaFlowCommandChildren.delete(child);
  };
  const releaseOnError = () => {
    if (!child.pid) release();
  };
  try { child.once("close", release); } catch { void 0; }
  try { child.once("error", releaseOnError); } catch { void 0; }
  if (novaFlowAppShuttingDown && !allowDuringShutdown) {
    setImmediate(() => { void terminateNovaFlowCommandChild(child); });
  }
  return child;
}

async function terminateNovaFlowCommandChild(child, killTree = true) {
  if (!child || child.__novaflowCloseObserved === true) {
    activeNovaFlowCommandChildren.delete(child);
    return true;
  }
  const killed = await new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { child.removeListener("close", onChildClose); } catch { void 0; }
      resolve(ok);
    };
    const onChildClose = () => finish(true);
    try { child.once("close", onChildClose); } catch { void 0; }
    timer = setTimeout(() => finish(false), 2200);
    if (!killTree || process.platform !== "win32" || !child.pid) {
      try { child.kill(); } catch { void 0; }
      return;
    }
    try {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore"
      });
      killer.once("close", () => { void 0; });
      killer.once("error", () => {
        try { child.kill(); } catch { void 0; }
      });
    } catch {
      try { child.kill(); } catch { void 0; }
    }
  });
  if (killed || child.__novaflowCloseObserved === true) {
    activeNovaFlowCommandChildren.delete(child);
    return true;
  }
  return false;
}

async function terminateNovaFlowCommandChildrenForShutdown() {
  const results = [];
  for (let pass = 0; pass < 3; pass += 1) {
    const children = Array.from(activeNovaFlowCommandChildren)
      .filter((child) => !novaFlowShutdownAllowedCommandChildren.has(child));
    if (!children.length) break;
    results.push(...await Promise.all(children.map((child) => terminateNovaFlowCommandChild(child))));
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  const remaining = Array.from(activeNovaFlowCommandChildren)
    .filter((child) => !novaFlowShutdownAllowedCommandChildren.has(child));
  return { ok: remaining.length === 0, attempted: results.length, failedAttempts: results.filter((item) => !item).length, remaining: remaining.length };
}

const runCmd = (cmd, args, opts) => {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let child = null;
    let abortHandler = null;
    let terminationRequested = false;
    let out = "";
    let err = "";
    const spawnOpts = { ...(opts || {}) };
    const timeoutMs = Math.max(0, Number(spawnOpts.timeoutMs || 0));
    const killTreeOnTimeout = spawnOpts.killTreeOnTimeout === true;
    const killTreeOnAbort = spawnOpts.killTreeOnAbort === true;
    const abortSignal = spawnOpts.signal || null;
    const allowDuringShutdown = spawnOpts.allowDuringShutdown === true;
    delete spawnOpts.timeoutMs;
    delete spawnOpts.killTreeOnTimeout;
    delete spawnOpts.killTreeOnAbort;
    delete spawnOpts.signal;
    delete spawnOpts.allowDuringShutdown;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      try { if (timer) clearTimeout(timer); } catch {}
      try { if (abortHandler && abortSignal) abortSignal.removeEventListener("abort", abortHandler); } catch { void 0; }
      resolve(result);
    };
    const requestTermination = (kind, killTree) => {
      if (settled || terminationRequested) return;
      terminationRequested = true;
      if (timer) clearTimeout(timer);
      void terminateNovaFlowCommandChild(child, killTree).then((terminationVerified) => {
        settle({
          ok: false,
          code: kind === "abort" ? -3 : -2,
          stdout: out,
          stderr: err,
          error: kind === "abort" ? "command_aborted" : "command_timeout",
          aborted: kind === "abort",
          timedOut: kind === "timeout",
          terminationVerified
        });
      });
    };
    try {
      if (abortSignal?.aborted || (novaFlowAppShuttingDown && !allowDuringShutdown)) {
        settle({ ok: false, code: -3, stdout: "", stderr: "", error: abortSignal?.aborted ? "command_aborted" : "app_shutting_down", aborted: true, terminationVerified: true });
        return;
      }
      child = trackNovaFlowCommandChild(
        spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...spawnOpts }),
        allowDuringShutdown
      );
      child.stdout.on("data", (d) => { try { out += String(d); } catch {} });
      child.stderr.on("data", (d) => { try { err += String(d); } catch {} });
      child.on("close", (code) => {
        if (!terminationRequested) settle({ ok: code === 0, code: code || 0, stdout: out, stderr: err, terminationVerified: true });
      });
      child.on("error", (e) => {
        if (terminationRequested) return;
        if (!child?.pid) {
          settle({ ok: false, code: -1, stdout: out, stderr: String(e?.message || e), terminationVerified: true });
          return;
        }
        terminationRequested = true;
        if (timer) clearTimeout(timer);
        void terminateNovaFlowCommandChild(child, true).then((terminationVerified) => {
          settle({
            ok: false,
            code: -1,
            stdout: out,
            stderr: String(e?.message || e),
            terminationVerified
          });
        });
      });
      if (abortSignal) {
        abortHandler = () => requestTermination("abort", killTreeOnAbort);
        if (abortSignal.aborted) {
          abortHandler();
          return;
        }
        abortSignal.addEventListener("abort", abortHandler, { once: true });
      }
      if (timeoutMs > 0) {
        timer = setTimeout(() => requestTermination("timeout", killTreeOnTimeout), timeoutMs);
      }
    } catch (e) {
      settle({ ok: false, code: -1, stdout: "", stderr: String(e?.message || e), terminationVerified: true });
    }
  });
};

const SEE_THROUGH_REPAIR_STDIO_LIMIT = 60_000;
const SEE_THROUGH_REPAIR_RETURN_LIMIT = 12_000;

function appendBoundedText(current, chunk, limit) {
  const next = `${String(current || "")}${String(chunk || "")}`;
  return next.length > limit ? next.slice(next.length - limit) : next;
}

function trimReturnedText(value) {
  const text = String(value || "");
  return text.length > SEE_THROUGH_REPAIR_RETURN_LIMIT ? text.slice(text.length - SEE_THROUGH_REPAIR_RETURN_LIMIT) : text;
}

function findSeeThroughRepairScriptPath() {
  const candidates = [];
  const add = (p) => {
    if (p && typeof p === "string") candidates.push(path.resolve(p));
  };

  try { add(path.join(process.resourcesPath || "", "repair-seethrough-env.ps1")); } catch {}
  try { add(path.join(app.getAppPath(), "repair-seethrough-env.ps1")); } catch {}
  try { add(path.join(app.getAppPath(), "main", "repair-seethrough-env.ps1")); } catch {}

  try {
    const root = findProjectRootForTrace();
    if (root) add(path.join(root, "scripts", "repair-seethrough-env.ps1"));
  } catch {}

  try { add(path.join(__dirname, "..", "scripts", "repair-seethrough-env.ps1")); } catch {}
  try { add(path.join(__dirname, "..", "..", "scripts", "repair-seethrough-env.ps1")); } catch {}
  try { add(path.join(__dirname, "..", "..", "..", "..", "scripts", "repair-seethrough-env.ps1")); } catch {}

  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (path.basename(candidate).toLowerCase() !== "repair-seethrough-env.ps1") continue;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return "";
}

function normalizeSeeThroughRepairBaseUrl(value) {
  const runtimeConfig = readNovaFlowRuntimeConfig();
  const runtimeBaseUrl = runtimeConfig && runtimeConfig.ok ? sanitizeRuntimeBaseUrl(runtimeConfig.baseUrl) : "http://127.0.0.1:8188";
  const baseUrl = sanitizeRuntimeBaseUrl(value || runtimeBaseUrl || "http://127.0.0.1:8188") || "http://127.0.0.1:8188";
  try {
    const url = new URL(baseUrl);
    const host = String(url.hostname || "").toLowerCase();
    const port = Number(url.port || (url.protocol === "http:" ? 80 : 0));
    if (url.protocol !== "http:" || (host !== "127.0.0.1" && host !== "localhost")) {
      return { ok: false, error: "See-through repair only supports local NovaFlow AI Runtime.", baseUrl, port };
    }
    if (!isNovaFlowRuntimeBaseUrl(baseUrl, runtimeBaseUrl)) {
      return { ok: false, error: "See-through repair only supports NovaFlow AI Runtime.", baseUrl, port };
    }
    if (!(port > 0 && port < 65536)) {
      return { ok: false, error: "invalid Runtime port", baseUrl, port };
    }
    return { ok: true, baseUrl: `http://127.0.0.1:${port}`, port };
  } catch {
    return { ok: false, error: "invalid Runtime baseUrl", baseUrl, port: 0 };
  }
}

async function runSeeThroughRepair(payload) {
  if (process.platform !== "win32") {
    return { ok: false, error: "See-through 自愈当前只支持 Windows 环境。" };
  }

  const target = normalizeSeeThroughRepairBaseUrl(payload?.baseUrl);
  if (!target.ok) return target;

  const scriptPath = findSeeThroughRepairScriptPath();
  if (!scriptPath) {
    return { ok: false, error: "未找到 See-through 自愈脚本 repair-seethrough-env.ps1。" };
  }

  const runtimeConfig = readNovaFlowRuntimeConfig();
  const useNovaFlowRuntime = !!(runtimeConfig && runtimeConfig.ok && runtimeConfig.baseUrl === target.baseUrl);
  const runtimeComfyRoot = useNovaFlowRuntime
    ? (runtimeConfig.assetsPath || (runtimeConfig.customNodesPath ? path.dirname(runtimeConfig.customNodesPath) : ""))
    : "";
  const runtimePythonPath = useNovaFlowRuntime ? path.join(runtimeConfig.installPath, "engine", "python", "python.exe") : "";

  const args = [
    "-NoLogo",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-Repair",
    "-ComfyBaseUrl",
    target.baseUrl
  ];
  if (runtimeComfyRoot) args.push("-ComfyRoot", runtimeComfyRoot);
  if (runtimePythonPath) args.push("-PythonPath", runtimePythonPath);

  appendLogLine("info", "see-through-repair-start", {
    baseUrl: target.baseUrl,
    scriptPath,
    useNovaFlowRuntime,
    comfyRoot: runtimeComfyRoot || "",
    pythonPath: runtimePythonPath || ""
  });

  return await new Promise((resolve) => {
    let child = null;
    let stdout = "";
    let stderr = "";
    let done = false;
    const settle = (result) => {
      if (done) return;
      done = true;
      try { clearTimeout(timer); } catch {}
      const out = {
        ...result,
        baseUrl: target.baseUrl,
        stdout: trimReturnedText(stdout),
        stderr: trimReturnedText(stderr)
      };
      appendLogLine(out.ok ? "info" : "error", out.ok ? "see-through-repair-ok" : "see-through-repair-failed", {
        code: out.code,
        error: out.error || "",
        stdoutTail: out.stdout.slice(-1000),
        stderrTail: out.stderr.slice(-1000)
      });
      resolve(out);
    };

    const timer = setTimeout(() => {
      try { if (child && !child.killed) child.kill(); } catch {}
      settle({ ok: false, code: -2, error: "See-through 自愈超时。" });
    }, 8 * 60 * 1000);

    try {
      child = spawn("powershell.exe", args, {
        cwd: path.dirname(scriptPath),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      child.stdout.on("data", (chunk) => {
        stdout = appendBoundedText(stdout, chunk, SEE_THROUGH_REPAIR_STDIO_LIMIT);
      });
      child.stderr.on("data", (chunk) => {
        stderr = appendBoundedText(stderr, chunk, SEE_THROUGH_REPAIR_STDIO_LIMIT);
      });
      child.on("error", (err) => {
        settle({ ok: false, code: -1, error: String(err?.message || err) });
      });
      child.on("close", (code) => {
        const exitCode = typeof code === "number" ? code : -1;
        settle({ ok: exitCode === 0, code: exitCode, error: exitCode === 0 ? "" : "See-through 自愈脚本执行失败。" });
      });
    } catch (err) {
      settle({ ok: false, code: -1, error: String(err?.message || err) });
    }
  });
}

ipcMain.handle("repair-seethrough-env", async (_evt, payload) => {
  try {
    return await runSeeThroughRepair(payload || {});
  } catch (err) {
    const message = String(err?.message || err);
    appendLogLine("error", "see-through-repair-exception", { message });
    return { ok: false, error: message };
  }
});

ipcMain.on("renderer-files-dropped", (evt, payload) => {
  try { evt.sender.send("renderer-files-dropped", payload); } catch {}
});

const SINGLE_INSTANCE_HANDOVER_ARG = "--novaflow-handover";
let IS_PORTABLE = false;
let INSTANCE_PROFILE = { kind: "installed", portableRoot: "", userDataPath: "" };
let INSTANCE_PROFILE_READY = true;
let systemMouseHelper = null;
let systemMouseStdoutBuffer = "";
let latestSystemMousePoint = null;
let systemMouseHelperLastExitAt = 0;

try {
  const resolvedProfile = resolveSingleInstanceProfile({ execPath: process.execPath, argv: process.argv, env: process.env });
  INSTANCE_PROFILE = resolvedProfile.kind === "portable"
    ? preparePortableUserDataPath(resolvedProfile, {
      appDataPath: app.getPath("appData"),
      tempPath: path.join(os.tmpdir(), "NovaFlow", "persistent-fallback", "portable-profiles")
    })
    : resolvedProfile;
  IS_PORTABLE = INSTANCE_PROFILE.kind === "portable";
  if (IS_PORTABLE) {
    app.setPath("userData", INSTANCE_PROFILE.userDataPath);
    try { app.setAppUserModelId("com.novaflow.novaflow.portable"); } catch { void 0; }
  }
} catch (error) {
  INSTANCE_PROFILE_READY = false;
  try { console.error("[NovaFlow] portable profile initialization failed", error); } catch { void 0; }
  app.exit(1);
}

if (INSTANCE_PROFILE_READY) try {
  const gotLock = app.requestSingleInstanceLock({
    instanceKind: INSTANCE_PROFILE.kind,
    execPath: process.execPath,
    portableRoot: INSTANCE_PROFILE.portableRoot,
  });
  if (!gotLock) {
    INSTANCE_PROFILE_READY = false;
    app.quit();
  } else {
    app.on("second-instance", (_event, argv, _workingDirectory, additionalData) => {
      try {
        const additionalExec = additionalData && typeof additionalData.execPath === "string" ? additionalData.execPath : "";
        const candidateExec = additionalExec || (Array.isArray(argv) && typeof argv[0] === "string" ? argv[0] : "");
        const wantsHandover = Array.isArray(argv) && argv.includes(SINGLE_INSTANCE_HANDOVER_ARG);
        const action = decideSecondInstanceAction({
          primaryKind: INSTANCE_PROFILE.kind,
          currentExecPath: process.execPath,
          candidateExecPath: candidateExec,
          candidateExists: Boolean(candidateExec && fs.existsSync(candidateExec)),
          wantsHandover,
        });
        if (action === "handover") {
          appendLogLine("info", "second-instance-handover", { from: process.execPath, to: candidateExec });
          let handoverScheduled = false;
          try {
            app.relaunch({ execPath: candidateExec, args: [SINGLE_INSTANCE_HANDOVER_ARG] });
            handoverScheduled = true;
          } catch (error) {
            appendLogLine("error", "second-instance-handover-schedule-failed", {
              from: process.execPath,
              to: candidateExec,
              error: String(error?.message || error)
            });
          }
          if (handoverScheduled) {
            requestNovaFlowGracefulQuit("handover");
            return;
          }
        }
      } catch {
        void 0;
      }

      try {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
      } catch {
        void 0;
      }
    });
  }
} catch (error) {
  INSTANCE_PROFILE_READY = false;
  try { console.error("[NovaFlow] single-instance lock initialization failed", error); } catch { void 0; }
  app.exit(1);
}

const NOVAFLOW_TEMP_STORAGE_ROOT = path.join(os.tmpdir(), "NovaFlow");
let novaFlowTempSessionLifecycle = null;
let novaFlowTempSessionRegistered = false;
let novaFlowAppShuttingDown = false;
let novaFlowAllowFinalQuit = false;
let novaFlowGracefulQuitPromise = null;
let novaFlowQuitReason = "";
let novaFlowLegacyMigrationPromise = null;

function isSafeNovaFlowTempStorageRoot(storageRoot) {
  const target = path.resolve(String(storageRoot || ""));
  const tempRoot = path.resolve(os.tmpdir());
  const expected = path.join(tempRoot, "NovaFlow");
  if (target.toLowerCase() !== expected.toLowerCase()) return false;
  try {
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink()) return false;
      const realTempRoot = fs.realpathSync.native(tempRoot);
      const realTarget = fs.realpathSync.native(target);
      if (!isSameOrInsidePath(realTarget, realTempRoot)) return false;
      for (const childName of ["sessions", "RuntimeClients", "persistent-fallback"]) {
        const childPath = path.join(target, childName);
        if (!fs.existsSync(childPath)) continue;
        if (fs.lstatSync(childPath).isSymbolicLink()) return false;
        if (!isSameOrInsidePath(fs.realpathSync.native(childPath), realTarget)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function getNovaFlowTempSessionLifecycle() {
  if (novaFlowTempSessionLifecycle) return novaFlowTempSessionLifecycle;
  if (!isSafeNovaFlowTempStorageRoot(NOVAFLOW_TEMP_STORAGE_ROOT)) throw new Error("temp_storage_root_not_safe");
  const profileIdentity = `${INSTANCE_PROFILE.kind || "installed"}|${INSTANCE_PROFILE.portableRoot || process.execPath || ""}`;
  const profileHash = crypto.createHash("sha256").update(profileIdentity.toLowerCase()).digest("hex").slice(0, 16);
  novaFlowTempSessionLifecycle = createTempSessionLifecycle({
    storageRoot: NOVAFLOW_TEMP_STORAGE_ROOT,
    processId: process.pid,
    processStartedAt: Date.now() - process.uptime() * 1000,
    executablePath: process.execPath,
    profileKey: `${INSTANCE_PROFILE.kind || "installed"}-${profileHash}`,
    processAlive: isProcessAlive,
    inspectProcess: inspectNovaFlowProcessIdentityAsync,
    log(level, message, meta) {
      appendLogLine(level, message, meta);
    }
  });
  return novaFlowTempSessionLifecycle;
}

function getNovaFlowTempCategoryDir(category) {
  if (novaFlowAppShuttingDown) throw new Error("app_shutting_down");
  return getNovaFlowTempSessionLifecycle().getCategoryDir(category);
}

function createNovaFlowTempWorkDir(category, prefix) {
  if (novaFlowAppShuttingDown) throw new Error("app_shutting_down");
  return getNovaFlowTempSessionLifecycle().createWorkDir(category, prefix);
}

async function cleanupNovaFlowTempWorkDir(dir, source) {
  const result = await getNovaFlowTempSessionLifecycle().cleanupWorkDir(dir, { retries: 3, retryDelayMs: 150 });
  if (!result.ok) appendLogLine("warn", "temp-work-dir-cleanup-failed", { source, dir: String(dir || ""), error: result.error || "cleanup_failed" });
  return result;
}

const activeNovaFlowTempJobs = new Set();
const novaFlowTempJobsAbortController = new AbortController();

function handleNovaFlowTempIpc(channel, handler) {
  ipcMain.handle(channel, async (...args) => {
    if (novaFlowAppShuttingDown) return { ok: false, error: "app_shutting_down" };
    let finishJob = null;
    const job = {
      channel,
      settled: new Promise((resolve) => { finishJob = resolve; })
    };
    activeNovaFlowTempJobs.add(job);
    try {
      return await handler(...args);
    } finally {
      activeNovaFlowTempJobs.delete(job);
      finishJob();
    }
  });
}

const videoResourceMediaService = createVideoResourceMediaService({
  fs,
  path,
  crypto,
  protocol,
  electronNet
});
registerVideoResourceMediaIpc({ service: videoResourceMediaService, handleIpc: handleNovaFlowTempIpc });

async function waitForNovaFlowTempJobsToSettle(timeoutMs = 8000) {
  const deadline = Date.now() + Math.max(500, Number(timeoutMs) || 8000);
  while (activeNovaFlowTempJobs.size > 0 && Date.now() < deadline) {
    const jobs = Array.from(activeNovaFlowTempJobs);
    const remainingMs = Math.max(1, deadline - Date.now());
    await Promise.race([
      Promise.allSettled(jobs.map((job) => job.settled)),
      new Promise((resolve) => setTimeout(resolve, Math.min(250, remainingMs)))
    ]);
  }
  return {
    ok: activeNovaFlowTempJobs.size === 0,
    remaining: Array.from(activeNovaFlowTempJobs).map((job) => job.channel)
  };
}

function getSplitTempRoot() {
  return getNovaFlowTempCategoryDir("spine-split");
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

function getLogDir() {
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

let novaFlowConsoleSinkDisabled = false;

function isNovaFlowConsoleSinkEpipe(error) {
  return String(error?.code || "").toUpperCase() === "EPIPE"
    || /\bEPIPE\b/i.test(String(error?.message || ""));
}

function handleNovaFlowConsoleSinkError(error) {
  // Installed Electron instances may outlive the launcher that owned stdout.
  // A broken console pipe is not an application failure; keep the file log
  // available and disable only the dead console sink to prevent recursion via
  // uncaughtException -> appendLogLine -> console.error -> EPIPE.
  novaFlowConsoleSinkDisabled = true;
  if (isNovaFlowConsoleSinkEpipe(error)) return;
  try {
    const dir = getLogDir();
    if (dir) {
      const line = `[${new Date().toISOString()}] [error] console-sink-error ${safeJson({
        code: String(error?.code || "").slice(0, 40),
        message: String(error?.message || error || "").slice(0, 240)
      })}\n`;
      fs.appendFileSync(path.join(dir, "main.log"), line, "utf8");
    }
  } catch {
    void 0;
  }
}

for (const sink of [process.stdout, process.stderr]) {
  try { sink?.on?.("error", handleNovaFlowConsoleSinkError); } catch { void 0; }
}

function appendLogLine(level, message, meta) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${String(message || "")}${meta ? ` ${safeJson(meta)}` : ""}\n`;
  try {
    const dir = getLogDir();
    if (dir) fs.appendFileSync(path.join(dir, "main.log"), line, "utf8");
  } catch {
    void 0;
  }
  if (novaFlowConsoleSinkDisabled) return;
  try {
    if (level === "error") console.error(line);
    else console.log(line);
  } catch {
    void 0;
  }
}

const NOVAFLOW_CLIENT_API_DEFAULT_HOST = "127.0.0.1";
const NOVAFLOW_CLIENT_API_DEFAULT_PORT = "4761";
const NOVAFLOW_CLIENT_API_CLOUD_DEFAULT_URL = "https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-backend";
const NOVAFLOW_ADMIN_SERVER_AUTOSTART_ENV = "NOVAFLOW_ADMIN_SERVER_AUTOSTART";
const NF_ELECTRON_AB_NO_ADMIN_SERVER_AUTOSTART = hasProcessSwitch("nf-electron-ab-no-admin-server-autostart");
const NOVAFLOW_GROK_CLOUD_DEFAULT_PATHS = new Set([
  "/api/client/grok/prompt-optimize",
  "/api/client/grok/image-reverse"
]);
const NOVAFLOW_CLIENT_API_ALLOWED_PATHS = new Set([
  "/health",
  "/ready",
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/verify",
  "/api/auth/dev-login",
  "/api/auth/me",
  "/api/auth/logout",
  "/api/client/bootstrap",
  "/api/client/credits",
  "/api/client/credits/check",
  "/api/client/license/verify",
  "/api/client/ai-config",
  "/api/client/grok/prompt-optimize",
  "/api/client/grok/image-reverse",
  "/api/provider/grok/chat",
  "/api/ai/tasks",
  "/api/ai/tasks/usage"
]);

function redactNovaFlowClientApiText(value) {
  return String(value || "")
    .replace(/nfs_[A-Za-z0-9_.-]+/g, "[redacted-session-token]")
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "Bearer [redacted]");
}

function getNovaFlowClientApiBaseUrl() {
  const explicit = String(process.env.NOVAFLOW_CLIENT_API_BASE_URL || process.env.NOVAFLOW_BACKEND_URL || "").trim();
  const host = String(process.env.NOVAFLOW_ADMIN_SERVER_HOST || NOVAFLOW_CLIENT_API_DEFAULT_HOST).trim() || NOVAFLOW_CLIENT_API_DEFAULT_HOST;
  const port = String(process.env.NOVAFLOW_ADMIN_SERVER_PORT || NOVAFLOW_CLIENT_API_DEFAULT_PORT).trim() || NOVAFLOW_CLIENT_API_DEFAULT_PORT;
  const localFallback = `http://${host}:${port}`;
  const raw = explicit || NOVAFLOW_CLIENT_API_CLOUD_DEFAULT_URL || localFallback;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid protocol");
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return NOVAFLOW_CLIENT_API_CLOUD_DEFAULT_URL || `http://${NOVAFLOW_CLIENT_API_DEFAULT_HOST}:${NOVAFLOW_CLIENT_API_DEFAULT_PORT}`;
  }
}

function joinNovaFlowClientApiUrl(baseUrl, pathName) {
  const url = new URL(String(baseUrl || "").trim());
  const basePath = String(url.pathname || "/").replace(/\/+$/, "");
  const requestPath = String(pathName || "").trim().replace(/^\/+/, "");
  url.pathname = `${basePath}/${requestPath}` || "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function novaFlowClientApiTimeoutLimit(pathName, payload) {
  const purpose = String(payload?.purpose || "").trim().toLowerCase().replace(/_/g, "-");
  const isH3 = (
    pathName === "/api/client/grok/image-reverse"
    && ["minimax-h3-i2v-reverse", "minimax-h3-fl2v-reverse"].includes(purpose)
  ) || (
    pathName === "/api/client/grok/prompt-optimize"
    && purpose === "minimax-h3-prompt-enhance"
  );
  // H3 may run two sequential provider calls (cloud: 50s each, local proxy:
  // 60s each). Leave room for upload and quota settlement around those calls.
  return isH3 ? 135_000 : 60_000;
}

async function requestNovaFlowClientApi(pathName, options = {}) {
  const pathPart = String(pathName || "").trim();
  if (!NOVAFLOW_CLIENT_API_ALLOWED_PATHS.has(pathPart)) {
    return { ok: false, status: 400, error: "client api path is not allowed" };
  }
  const method = String(options.method || "GET").trim().toUpperCase();
  const hasBody = options.body !== undefined && options.body !== null;
  const headers = {
    Accept: "application/json",
    ...(hasBody ? { "Content-Type": "application/json" } : {})
  };
  const token = String(options.token || "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const maxTimeout = novaFlowClientApiTimeoutLimit(pathPart, options.body);
  const timeout = Math.max(3000, Math.min(maxTimeout, Number(options.timeoutMs || 12000)));
  const timer = setTimeout(() => controller.abort(), timeout);
  let baseUrl = getNovaFlowClientApiBaseUrl();
  if (options.baseUrl) {
    try {
      const overrideUrl = new URL(String(options.baseUrl || "").trim());
      if (overrideUrl.protocol === "http:" || overrideUrl.protocol === "https:") {
        overrideUrl.username = "";
        overrideUrl.password = "";
        overrideUrl.hash = "";
        overrideUrl.search = "";
        baseUrl = overrideUrl.toString().replace(/\/+$/, "");
      }
    } catch {
      void 0;
    }
  }
  const startedAt = Date.now();
  try {
    const url = joinNovaFlowClientApiUrl(baseUrl, pathPart);
    const res = await fetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { ok: false, error: text ? text.slice(0, 500) : "invalid json response" };
    }
    const result = data && typeof data === "object" ? { ...data } : { data };
    result.httpStatus = res.status;
    result.transportOk = res.ok;
    result.baseUrl = baseUrl;
    result.durationMs = Date.now() - startedAt;
    if (!res.ok && !result.error) result.error = `HTTP ${res.status}`;
    return result;
  } catch (err) {
    const message = err?.name === "AbortError" ? "client api request timeout" : redactNovaFlowClientApiText(err?.message || err || "client api request failed");
    appendLogLine("warn", "client-api-request-failed", {
      path: pathPart,
      method,
      baseUrl,
      durationMs: Date.now() - startedAt,
      error: message
    });
    return {
      ok: false,
      status: "error",
      httpStatus: 0,
      transportOk: false,
      baseUrl,
      durationMs: Date.now() - startedAt,
      error: message
    };
  } finally {
    clearTimeout(timer);
  }
}

let novaFlowAdminServerProcess = null;
let novaFlowAdminServerStartPromise = null;

function isLoopbackHost(host) {
  const value = String(host || "").trim().toLowerCase();
  return value === "127.0.0.1" || value === "localhost" || value === "::1";
}

function resolveNovaFlowClientApiEndpoint() {
  const baseUrl = getNovaFlowClientApiBaseUrl();
  try {
    const url = new URL(baseUrl);
    const port = Number(url.port || (url.protocol === "http:" ? 80 : url.protocol === "https:" ? 443 : 0));
    return {
      ok: url.protocol === "http:" && isLoopbackHost(url.hostname) && port > 0 && port < 65536,
      baseUrl,
      host: url.hostname === "localhost" ? "127.0.0.1" : url.hostname,
      port,
      protocol: url.protocol
    };
  } catch {
    return {
      ok: true,
      baseUrl: `http://${NOVAFLOW_CLIENT_API_DEFAULT_HOST}:${NOVAFLOW_CLIENT_API_DEFAULT_PORT}`,
      host: NOVAFLOW_CLIENT_API_DEFAULT_HOST,
      port: Number(NOVAFLOW_CLIENT_API_DEFAULT_PORT),
      protocol: "http:"
    };
  }
}

function resolveNovaFlowLocalClientApiEndpoint() {
  const host = String(process.env.NOVAFLOW_ADMIN_SERVER_HOST || NOVAFLOW_CLIENT_API_DEFAULT_HOST).trim() || NOVAFLOW_CLIENT_API_DEFAULT_HOST;
  const port = Number(process.env.NOVAFLOW_ADMIN_SERVER_PORT || NOVAFLOW_CLIENT_API_DEFAULT_PORT);
  const safePort = Number.isInteger(port) && port > 0 && port < 65536 ? port : Number(NOVAFLOW_CLIENT_API_DEFAULT_PORT);
  const safeHost = host === "localhost" ? "127.0.0.1" : host;
  return {
    ok: true,
    baseUrl: `http://${safeHost}:${safePort}`,
    host: safeHost,
    port: safePort,
    protocol: "http:"
  };
}

function hasExplicitNovaFlowClientApiBaseUrl() {
  return Boolean(String(process.env.NOVAFLOW_CLIENT_API_BASE_URL || process.env.NOVAFLOW_BACKEND_URL || "").trim());
}

function resolveNovaFlowSmartAiApiTarget(pathName) {
  if (hasExplicitNovaFlowClientApiBaseUrl()) {
    const endpoint = resolveNovaFlowClientApiEndpoint();
    return {
      baseUrl: endpoint.baseUrl,
      useLocal: Boolean(endpoint.ok),
      forceLocal: false,
      source: endpoint.ok ? "explicit-loopback" : "explicit-remote"
    };
  }

  // Grok production calls stay on the cloud default. The shared AI-task
  // authorization/usage routes retain their existing local default.
  const localDevEnabled = !NF_ELECTRON_AB_NO_ADMIN_SERVER_AUTOSTART &&
    isTruthyEnv(process.env[NOVAFLOW_ADMIN_SERVER_AUTOSTART_ENV]);
  const grokCloudDefault = NOVAFLOW_GROK_CLOUD_DEFAULT_PATHS.has(String(pathName || "").trim());
  if (localDevEnabled || !grokCloudDefault) {
    const endpoint = resolveNovaFlowLocalClientApiEndpoint();
    return {
      baseUrl: endpoint.baseUrl,
      useLocal: true,
      forceLocal: true,
      source: localDevEnabled ? "explicit-local-dev" : "legacy-ai-task-local"
    };
  }

  return {
    baseUrl: getNovaFlowClientApiBaseUrl(),
    useLocal: false,
    forceLocal: false,
    source: "cloud-default"
  };
}

function shouldAutostartNovaFlowAdminServer() {
  if (NF_ELECTRON_AB_NO_ADMIN_SERVER_AUTOSTART) return false;
  const raw = String(process.env[NOVAFLOW_ADMIN_SERVER_AUTOSTART_ENV] || "").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return resolveNovaFlowClientApiEndpoint().ok;
}

function findNovaFlowAdminServerScript() {
  const candidates = [
    path.join(__dirname, "admin-server", "server.js"),
    path.join(app.getAppPath ? app.getAppPath() : __dirname, "admin-server", "server.js")
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      void 0;
    }
  }
  return "";
}

function getNovaFlowAdminServerNodeExecEnv() {
  const nodeExec = String(process.env.NOVAFLOW_NODE_EXECUTABLE || process.env.npm_node_execpath || "").trim() || process.execPath;
  const env = { ...process.env };
  if (nodeExec === process.execPath && process.versions?.electron) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  return { nodeExec, env };
}

function appendAdminServerOutput(level, message, data) {
  const text = String(data || "").trim();
  if (!text) return;
  text.split(/\r?\n/).filter(Boolean).slice(-8).forEach((line) => {
    appendLogLine(level, message, { line: line.slice(0, 800) });
  });
}

async function waitForNovaFlowAdminServerHealth(endpoint, timeoutMs) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs || 7000));
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(new URL("/health", `${endpoint.baseUrl}/`).toString(), {
        method: "GET",
        signal: controller.signal
      });
      clearTimeout(timer);
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
      if (res.ok) return { ok: true, httpStatus: res.status, data };
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err?.name === "AbortError" ? "admin server health timeout" : String(err?.message || err);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: false, error: lastError || "admin server health check failed" };
}

async function ensureNovaFlowAdminServerStarted(options = {}) {
  const source = String(options.source || "request");
  const forceLocal = Boolean(options.forceLocal);
  const endpoint = forceLocal ? resolveNovaFlowLocalClientApiEndpoint() : resolveNovaFlowClientApiEndpoint();
  if (!forceLocal && !shouldAutostartNovaFlowAdminServer()) {
    return { ok: false, skipped: true, reason: "autostart_disabled_or_remote_backend", baseUrl: endpoint.baseUrl };
  }
  if (await isTcpPortListening(endpoint.port, endpoint.host || "127.0.0.1", 350)) {
    return { ok: true, alreadyRunning: true, baseUrl: endpoint.baseUrl };
  }
  if (novaFlowAdminServerStartPromise) return novaFlowAdminServerStartPromise;
  novaFlowAdminServerStartPromise = (async () => {
    const scriptPath = findNovaFlowAdminServerScript();
    if (!scriptPath) {
      const result = { ok: false, error: "admin_server_script_missing", baseUrl: endpoint.baseUrl };
      appendLogLine("error", "admin-server-autostart-missing", { source, baseUrl: endpoint.baseUrl });
      return result;
    }
    const { nodeExec, env } = getNovaFlowAdminServerNodeExecEnv();
    env.NOVAFLOW_ADMIN_SERVER_HOST = env.NOVAFLOW_ADMIN_SERVER_HOST || endpoint.host || NOVAFLOW_CLIENT_API_DEFAULT_HOST;
    env.NOVAFLOW_ADMIN_SERVER_PORT = env.NOVAFLOW_ADMIN_SERVER_PORT || String(endpoint.port || NOVAFLOW_CLIENT_API_DEFAULT_PORT);
    env.NOVAFLOW_ADMIN_SERVER_CORS_ORIGINS = env.NOVAFLOW_ADMIN_SERVER_CORS_ORIGINS || "http://127.0.0.1:4783,http://localhost:4783";
    env.NOVAFLOW_ADMIN_SERVER_REQUEST_LOGS = env.NOVAFLOW_ADMIN_SERVER_REQUEST_LOGS || "1";
    appendLogLine("info", "admin-server-autostart", {
      source,
      scriptPath,
      baseUrl: endpoint.baseUrl,
      port: endpoint.port
    });
    try {
      const child = spawn(nodeExec, [scriptPath], {
        cwd: path.dirname(scriptPath),
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      novaFlowAdminServerProcess = child;
      child.stdout?.on?.("data", (data) => appendAdminServerOutput("info", "admin-server-stdout", data));
      child.stderr?.on?.("data", (data) => appendAdminServerOutput("warn", "admin-server-stderr", data));
      child.on("exit", (code, signal) => {
        if (novaFlowAdminServerProcess === child) novaFlowAdminServerProcess = null;
        appendLogLine(code === 0 ? "info" : "warn", "admin-server-exit", { code, signal: signal || "" });
      });
      child.on("error", (err) => {
        appendLogLine("error", "admin-server-spawn-error", { message: String(err?.message || err) });
      });
    } catch (err) {
      return { ok: false, error: String(err?.message || err), baseUrl: endpoint.baseUrl };
    }
    const health = await waitForNovaFlowAdminServerHealth(endpoint, options.timeoutMs || 7000);
    appendLogLine(health.ok ? "info" : "warn", health.ok ? "admin-server-ready" : "admin-server-not-ready", {
      source,
      baseUrl: endpoint.baseUrl,
      error: health.error || ""
    });
    return { ...health, baseUrl: endpoint.baseUrl };
  })();
  try {
    return await novaFlowAdminServerStartPromise;
  } finally {
    novaFlowAdminServerStartPromise = null;
  }
}

async function requestNovaFlowSmartAiApi(pathName, payload) {
  const token = String(payload?.token || payload?.sessionToken || payload?.accessToken || "").trim();
  const body = { ...(payload && typeof payload === "object" ? payload : {}) };
  delete body.token;
  delete body.sessionToken;
  delete body.accessToken;

  const target = resolveNovaFlowSmartAiApiTarget(pathName);
  if (target.useLocal) {
    await ensureNovaFlowAdminServerStarted({
      source: "smart-ai-grok",
      timeoutMs: 7000,
      forceLocal: target.forceLocal
    });
  }

  return requestNovaFlowClientApi(pathName, {
    method: "POST",
    token,
    body,
    timeoutMs: novaFlowClientApiTimeoutLimit(pathName, body),
    baseUrl: target.baseUrl
  });
}

const NOVAFLOW_CLIENT_AUTH_REFRESH_EARLY_MS = 120_000;

function novaFlowClientSessionExpiryMs(value) {
  if (value == null || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function novaFlowClientSessionFromPayload(payload) {
  return {
    token: String(payload?.token || payload?.sessionToken || payload?.accessToken || "").trim(),
    refreshToken: String(payload?.refreshToken || payload?.refresh_token || "").trim(),
    expiresAt: payload?.expiresAt ?? payload?.expires_at ?? null,
    provider: String(payload?.provider || "supabase_auth"),
    transport: String(payload?.transport || clientAuthDirect.CLIENT_AUTH_TRANSPORT)
  };
}

function novaFlowClientSessionExpiresSoon(session, now = Date.now()) {
  const expireMs = novaFlowClientSessionExpiryMs(session?.expiresAt);
  return Boolean(session?.refreshToken && expireMs && expireMs - now <= NOVAFLOW_CLIENT_AUTH_REFRESH_EARLY_MS);
}

async function requestNovaFlowAuthenticatedClientApi(pathName, payload, method = "GET") {
  let session = novaFlowClientSessionFromPayload(payload);
  let refreshedSession = null;
  let refreshAttempted = false;
  const body = { ...(payload && typeof payload === "object" ? payload : {}) };
  delete body.token;
  delete body.sessionToken;
  delete body.accessToken;
  delete body.refreshToken;
  delete body.refresh_token;
  delete body.expiresAt;
  delete body.expires_at;
  delete body.provider;
  delete body.transport;

  const refreshOnce = async () => {
    if (refreshAttempted || !session.refreshToken) return false;
    refreshAttempted = true;
    const result = await clientAuthDirect.refreshSession({ refreshToken: session.refreshToken });
    if (!result?.ok || !result?.session?.token) return false;
    session = { ...session, ...result.session };
    refreshedSession = session;
    return true;
  };
  const requestWithCurrentToken = () => requestNovaFlowClientApi(pathName, {
    method,
    token: session.token,
    ...(method === "GET" ? {} : { body }),
    timeoutMs: 15_000
  });

  if (novaFlowClientSessionExpiresSoon(session)) await refreshOnce();
  let result = await requestWithCurrentToken();
  if (Number(result?.httpStatus || result?.status || 0) === 401 && await refreshOnce()) {
    result = await requestWithCurrentToken();
  }
  return refreshedSession ? { ...result, session: refreshedSession } : result;
}

function stopNovaFlowAdminServer(source = "stop") {
  const child = novaFlowAdminServerProcess;
  if (!child) return;
  novaFlowAdminServerProcess = null;
  try {
    appendLogLine("info", "admin-server-stop", { source, pid: child.pid || 0 });
    child.kill();
  } catch (err) {
    appendLogLine("warn", "admin-server-stop-failed", { source, message: String(err?.message || err) });
  }
}

function isEffectiveLicenseAllowed(state) {
  return Boolean(state && state.status === "licensed" && state.locked !== true);
}

const ONLINE_EXPORT_AUTH_SUCCESS_REUSE_MS = 30_000;
let onlineEntitlementSuccessReuseGeneration = 0;

function invalidateOnlineEntitlementSuccessReuse(reason = "state-change") {
  onlineEntitlementSuccessReuseGeneration = (onlineEntitlementSuccessReuseGeneration + 1) % Number.MAX_SAFE_INTEGER;
  try {
    licenseOnline.clearOnlineLicenseSuccessReuse(app.getPath("userData"));
  } catch (err) {
    appendLogLine("warn", "license-online-success-reuse-clear-failed", {
      reason,
      error: String(err?.message || err)
    });
  }
}

async function getEffectiveLicenseState(source = "state", options = {}) {
  try {
    const userDataDir = app.getPath("userData");
    const localState = await licenseCore.getLicenseState(userDataDir);
    return await licenseOnline.verifyLicenseOnline({
      userDataDir,
      localState,
      source,
      allowOfflineCache: options.allowOfflineCache !== false,
      timeoutMs: options.timeoutMs,
      successReuseMs: options.successReuseMs,
      successReuseScope: options.successReuseScope
    });
  } catch (err) {
    const machineId = await licenseCore.getMachineId().catch(() => "");
    const reason = String(err?.message || err || "license_state_error");
    appendLogLine("error", "license-effective-state-error", { source, reason });
    return {
      status: "locked",
      locked: true,
      machineId,
      reason,
      error: reason
    };
  }
}

function getLicenseStateReason(state, fallback = "license_locked") {
  return String(state?.reason || state?.error || state?.status || fallback);
}

function isFeatureDeniedByMap(value, feature) {
  if (!feature || !value || typeof value !== "object" || Array.isArray(value)) return false;
  return value[feature] === false;
}

function isFeatureAllowedByLicenseState(state, feature) {
  if (!feature) return true;
  const localFeatures = state?.payload?.features || state?.payload?.permissions || null;
  if (isFeatureDeniedByMap(localFeatures, feature)) return false;
  if (isFeatureDeniedByMap(state?.permissions, feature)) return false;
  return true;
}

async function assertOnlineEntitled(feature, source = "feature") {
  const successReuseMs = feature === "export" ? ONLINE_EXPORT_AUTH_SUCCESS_REUSE_MS : 0;
  const state = await getEffectiveLicenseState(source, {
    allowOfflineCache: false,
    successReuseMs,
    successReuseScope: successReuseMs > 0
      ? `${feature}:${onlineEntitlementSuccessReuseGeneration}`
      : ""
  });
  if (!isEffectiveLicenseAllowed(state)) {
    const err = new Error(getLicenseStateReason(state));
    err.code = "license_locked";
    err.licenseLocked = true;
    err.feature = feature || "";
    err.state = state;
    throw err;
  }
  if (!isFeatureAllowedByLicenseState(state, feature)) {
    const err = new Error("feature_not_allowed");
    err.code = "license_feature_denied";
    err.licenseLocked = true;
    err.feature = feature || "";
    err.state = state;
    throw err;
  }
  return state;
}

function toIpcErrorResult(err, fallback = "operation_failed") {
  const message = String(err?.message || err || fallback);
  if (err?.licenseLocked || err?.code === "license_locked" || err?.code === "license_feature_denied") {
    return {
      ok: false,
      error: message,
      code: String(err?.code || "license_locked"),
      licenseLocked: true,
      feature: String(err?.feature || ""),
      state: err?.state || null
    };
  }
  return { ok: false, error: message };
}

async function verifyImportedLicenseObjectOnline(licenseObj, source) {
  const userDataDir = app.getPath("userData");
  const machineId = await licenseCore.getMachineId();
  const localVerify = licenseCore.verifyLicenseObject(licenseObj, machineId);
  if (!localVerify.ok) return { ok: false, error: localVerify.code, state: { status: "invalid", locked: true, machineId, reason: localVerify.code } };
  const state = await licenseOnline.verifyLicenseOnline({
    userDataDir,
    localState: { status: "licensed", machineId, payload: localVerify.payload },
    source,
    allowOfflineCache: false
  });
  if (!isEffectiveLicenseAllowed(state)) {
    return { ok: false, error: state.reason || state.error || "online_verify_failed", state };
  }
  return { ok: true, state };
}

function findProjectRootForTrace() {
  const seeds = [
    process.env.NOVAFLOW_TRACE_ROOT,
    process.cwd(),
    __dirname
  ].filter(Boolean);
  for (const seed of seeds) {
    try {
      let dir = path.resolve(String(seed));
      for (let i = 0; i < 10 && dir; i++) {
        if (fs.existsSync(path.join(dir, "tools", "check_4783_runtime.py"))) return dir;
        const next = path.dirname(dir);
        if (!next || next === dir) break;
        dir = next;
      }
    } catch {}
  }
  return null;
}

function getCutoutTraceLogDir() {
  try {
    const root = findProjectRootForTrace();
    const dir = root ? path.join(root, "logs") : path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

function appendCutoutFileTrace(event, payload) {
  const ts = new Date().toISOString();
  const entry = { ts, event: String(event || "trace"), ...(payload || {}) };
  try {
    const dir = getCutoutTraceLogDir();
    if (!dir) return;
    const file = path.join(dir, "cutout-save-file-trace.md");
    const body = `\n## ${ts} ${entry.event}\n\n\`\`\`json\n${JSON.stringify(entry, null, 2)}\n\`\`\`\n`;
    fs.appendFileSync(file, body, "utf8");
  } catch {}
  try {
    appendLogLine("info", `cutout-file-trace:${entry.event}`, entry);
  } catch {}
}

function parseFfprobeRate(value) {
  try {
    const text = String(value || "").trim();
    if (!text || text === "0/0") return null;
    if (text.includes("/")) {
      const [a, b] = text.split("/");
      const n = Number(a);
      const d = Number(b);
      if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
      return n / d;
    }
    const v = Number(text);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

async function probeCutoutMediaFile(filePath) {
  const result = {
    filePath: String(filePath || ""),
    exists: false,
    size: null,
    width: null,
    height: null,
    duration: null,
    fps: null,
    codec: null,
    pixFmt: null,
    alphaMode: null,
    hasAlpha: null,
    ffprobeError: null
  };
  try {
    if (!result.filePath || !fs.existsSync(result.filePath)) {
      result.ffprobeError = "file does not exist";
      return result;
    }
    const stat = fs.statSync(result.filePath);
    result.exists = true;
    result.size = Number(stat.size) || 0;
    if (!ffprobePath || typeof ffprobePath !== "string" || !fs.existsSync(ffprobePath)) {
      result.ffprobeError = "ffprobe unavailable";
      return result;
    }
    const r = await runCmd(ffprobePath, ["-v", "error", "-show_streams", "-show_format", "-of", "json", result.filePath], {
      cwd: path.dirname(result.filePath)
    });
    if (!r.ok) {
      result.ffprobeError = String(r.stderr || r.stdout || "").slice(0, 520);
      return result;
    }
    const data = JSON.parse(String(r.stdout || "{}"));
    const stream = Array.isArray(data?.streams) ? data.streams.find((item) => item?.codec_type === "video") : null;
    const format = data?.format || null;
    result.width = Number(stream?.width) || null;
    result.height = Number(stream?.height) || null;
    result.duration = Number(format?.duration || stream?.duration) || null;
    result.fps = parseFfprobeRate(stream?.avg_frame_rate) || parseFfprobeRate(stream?.r_frame_rate);
    result.codec = stream?.codec_name ? String(stream.codec_name) : null;
    result.pixFmt = stream?.pix_fmt ? String(stream.pix_fmt) : null;
    result.alphaMode = stream?.tags?.alpha_mode != null ? String(stream.tags.alpha_mode) : null;
    result.hasAlpha = Boolean(
      result.alphaMode === "1" ||
      /(^|[^a-z])(yuva|rgba|argb|bgra|abgr)/i.test(String(result.pixFmt || ""))
    );
    return result;
  } catch (err) {
    result.ffprobeError = String(err?.message || err);
    return result;
  }
}

function isCutoutSaveTempDir(dir) {
  try {
    const resolved = path.resolve(String(dir || ""));
    return path.basename(resolved).startsWith("novaflow_cutout_save_") &&
      getNovaFlowTempSessionLifecycle().isRegisteredWorkDir(resolved) &&
      getNovaFlowTempSessionLifecycle().isOwnedPath(resolved, "cutout");
  } catch {
    return false;
  }
}

function isPathInsideDir(filePath, dir) {
  try {
    const resolvedDir = path.resolve(String(dir || ""));
    const resolvedFile = path.resolve(String(filePath || ""));
    const rel = path.relative(resolvedDir, resolvedFile);
    return !!rel && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

function isInternalCutoutSaveTempCreate(payload) {
  return String(payload?.prefix || "") === "novaflow_cutout_save_";
}

function isInternalCutoutSaveFrameWrite(dir, fileName) {
  const name = String(fileName || "");
  return isCutoutSaveTempDir(dir) && /^(?:NF|f)_\d{4,6}\.png$/i.test(name);
}

function isInternalCutoutSaveFrameEncode(payload) {
  const dir = String(payload?.dir || "");
  const outPath = String(payload?.outPath || "");
  const trace = payload?.novaflowTrace && typeof payload.novaflowTrace === "object" ? payload.novaflowTrace : {};
  const tool = String(trace.tool || "");
  const source = String(trace.source || "");
  const kind = String(trace.kind || "");
  const format = String(payload?.format || "").toLowerCase();
  const pattern = String(payload?.pattern || "");
  return isCutoutSaveTempDir(dir) &&
    isPathInsideDir(outPath, dir) &&
    path.extname(outPath).toLowerCase() === ".webm" &&
    format === "webm" &&
    payload?.keepAlpha === true &&
    payload?.returnBase64 === true &&
    source === "save-and-close" &&
    kind === "cutout-final-webm" &&
    (tool === "ai-cutout" || tool === "chroma-key" || tool === "key") &&
    (pattern === "NF_%04d.png" || pattern === "f_%06d.png");
}

function getCutoutTraceSource(payload, outPath) {
  const explicit = payload?.novaflowTrace?.source;
  if (explicit) return String(explicit);
  try {
    const dir = String(payload?.dir || path.dirname(String(outPath || "")) || "");
    if (isCutoutSaveTempDir(dir)) return "save-and-close";
  } catch {}
  return "export-local";
}

function getCutoutTraceTool(payload) {
  const tool = payload?.novaflowTrace?.tool;
  if (tool === "key") return "chroma-key";
  if (tool) return String(tool);
  return "unknown";
}

async function traceEncodedCutoutOutput(pipeline, payload, outPath, extra) {
  const metadata = await probeCutoutMediaFile(outPath);
  const requestedWidth = Number(payload?.width) || null;
  const requestedHeight = Number(payload?.height) || null;
  const outputMatchesRequestedSize = Boolean(
    metadata.width && metadata.height && requestedWidth && requestedHeight &&
    metadata.width === Math.max(16, Math.floor(requestedWidth / 2) * 2) &&
    metadata.height === Math.max(16, Math.floor(requestedHeight / 2) * 2)
  );
  appendCutoutFileTrace("encoded-output", {
    tool: getCutoutTraceTool(payload),
    source: getCutoutTraceSource(payload, outPath),
    pipeline,
    kind: payload?.novaflowTrace?.kind || null,
    filePath: String(outPath || ""),
    inputPath: extra?.inputPath || null,
    frameDir: payload?.dir ? String(payload.dir) : null,
    pattern: payload?.pattern ? String(payload.pattern) : null,
    format: payload?.format ? String(payload.format) : null,
    keepAlpha: Boolean(payload?.keepAlpha),
    requestedWidth,
    requestedHeight,
    requestedFps: Number(payload?.fps) || null,
    returnBase64: Boolean(payload?.returnBase64),
    metadata,
    size: metadata.size,
    width: metadata.width,
    height: metadata.height,
    duration: metadata.duration,
    fps: metadata.fps,
    hasAlpha: metadata.hasAlpha,
    suspectedScaled: requestedWidth && requestedHeight ? !outputMatchesRequestedSize : "unknown-no-requested-size",
    outputMatchesRequestedSize,
    suspectedOriginalVideo: pipeline === "exportEncodeVideoToVideo" || (String(payload?.format || "").toLowerCase() === "webm" && !payload?.keepAlpha),
    note: "diagnostic only; output bytes are not changed"
  });
}

process.on("uncaughtException", (err) => {
  if (isNovaFlowConsoleSinkEpipe(err)) novaFlowConsoleSinkDisabled = true;
  appendLogLine("error", "uncaughtException", { message: String(err?.message || err), stack: String(err?.stack || "") });
});

process.on("unhandledRejection", (reason) => {
  appendLogLine("error", "unhandledRejection", { reason: String(reason?.message || reason), stack: String(reason?.stack || "") });
});

app.on("render-process-gone", (_event, webContents, details) => {
  appendLogLine("error", "render-process-gone", {
    id: webContents?.id,
    url: webContents?.getURL?.(),
    reason: details?.reason,
    exitCode: details?.exitCode
  });
});

app.on("child-process-gone", (_event, details) => {
  appendLogLine("error", "child-process-gone", details);
});

ipcMain.handle("log-client-error", async (_evt, payload) => {
  const message = String(payload?.message || "");
  const stack = String(payload?.stack || "");
  const source = String(payload?.source || "renderer");
  appendLogLine("error", `client-error:${source}`, { message, stack });
  return { ok: true };
});

function safeCopyFile(src, dst) {
  try {
    if (!fs.existsSync(src)) return false;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return true;
  } catch {
    return false;
  }
}

function migrateUserDataDir(fromDir, toDir) {
  try {
    if (!fs.existsSync(fromDir) || !fs.statSync(fromDir).isDirectory()) return;
    if (fs.existsSync(toDir)) return;
  } catch {
    return;
  }

  const files = ["templates.json", "curve-presets.json", "app-state.json", "license.nfl"];
  for (const f of files) {
    safeCopyFile(path.join(fromDir, f), path.join(toDir, f));
  }
}

function isElevatedOnWindows() {
  if (process.platform !== "win32") return false;
  try {
    const { execFileSync } = require("child_process");
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }
    );
    return String(out || "").trim().toLowerCase() === "true";
  } catch {
    return false;
  }
}

ipcMain.handle("is-elevated", async () => {
  return { ok: true, elevated: isElevatedOnWindows() };
});

function systemMouseHelperScript() {
  return `
$ErrorActionPreference = "SilentlyContinue"
$source = 'using System; using System.Runtime.InteropServices; public static class NativeMouseState { [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; } [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint); [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey); }'
Add-Type -TypeDefinition $source
while ($true) {
  $point = New-Object NativeMouseState+POINT
  $ok = [NativeMouseState]::GetCursorPos([ref]$point)
  $left = ([NativeMouseState]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0
  $right = ([NativeMouseState]::GetAsyncKeyState(0x02) -band 0x8000) -ne 0
  $middle = ([NativeMouseState]::GetAsyncKeyState(0x04) -band 0x8000) -ne 0
  if ($ok) {
    $payload = [ordered]@{
      ok = $true
      x = [int]$point.X
      y = [int]$point.Y
      source = "electron-win32-helper"
      buttons = [ordered]@{ left = $left; right = $right; middle = $middle }
      leftDown = $left
      rightDown = $right
      middleDown = $middle
    }
  } else {
    $payload = [ordered]@{ ok = $false; error = "GetCursorPos failed"; source = "electron-win32-helper" }
  }
  $payload | ConvertTo-Json -Compress -Depth 4
  Start-Sleep -Milliseconds 16
}
`;
}

function stopSystemMouseHelper() {
  const child = systemMouseHelper;
  systemMouseHelper = null;
  systemMouseStdoutBuffer = "";
  if (!child) return;
  try { child.kill(); } catch {}
}

function parseSystemMouseHelperLine(line) {
  const text = String(line || "").trim();
  if (!text || !text.startsWith("{")) return;
  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object") return;
    latestSystemMousePoint = {
      ...payload,
      sampledAt: Date.now()
    };
    electronProfileIncrement("counters", "systemMouseHelperSamples", 1);
  } catch {
    void 0;
  }
}

function startSystemMouseHelper() {
  if (process.platform !== "win32") return false;
  if (systemMouseHelper && !systemMouseHelper.killed) return true;
  if (systemMouseHelperLastExitAt && Date.now() - systemMouseHelperLastExitAt < 500) return false;
  latestSystemMousePoint = null;
  systemMouseStdoutBuffer = "";
  try {
    const encoded = Buffer.from(systemMouseHelperScript(), "utf16le").toString("base64");
    electronProfileIncrement("counters", "systemMouseHelperStartAttempt", 1);
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    systemMouseHelper = child;
    child.stdout.on("data", (chunk) => {
      try {
        systemMouseStdoutBuffer += String(chunk || "");
        let index = systemMouseStdoutBuffer.indexOf("\n");
        while (index >= 0) {
          const line = systemMouseStdoutBuffer.slice(0, index);
          systemMouseStdoutBuffer = systemMouseStdoutBuffer.slice(index + 1);
          parseSystemMouseHelperLine(line);
          index = systemMouseStdoutBuffer.indexOf("\n");
        }
        if (systemMouseStdoutBuffer.length > 8192) systemMouseStdoutBuffer = systemMouseStdoutBuffer.slice(-2048);
      } catch {
        void 0;
      }
    });
    child.stderr.on("data", (chunk) => {
      try {
        const message = String(chunk || "").trim();
        if (message) appendLogLine("error", "system-mouse-helper-stderr", { message: message.slice(0, 500) });
      } catch {
        void 0;
      }
    });
    child.on("exit", (code, signal) => {
      electronProfileIncrement("counters", "systemMouseHelperExit", 1);
      systemMouseHelperLastExitAt = Date.now();
      if (systemMouseHelper === child) {
        systemMouseHelper = null;
        systemMouseStdoutBuffer = "";
      }
      appendLogLine("info", "system-mouse-helper-exit", { code, signal });
    });
    return true;
  } catch (err) {
    appendLogLine("error", "system-mouse-helper-start-failed", { message: String(err?.message || err) });
    systemMouseHelper = null;
    return false;
  }
}

function systemMouseScreenFallback() {
  try {
    const point = screen.getCursorScreenPoint();
    return {
      ok: true,
      x: Math.round(Number(point?.x) || 0),
      y: Math.round(Number(point?.y) || 0),
      source: "electron-screen-fallback"
    };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), source: "electron-screen-fallback" };
  }
}

function getSystemMousePositionPayload() {
  if (NF_ELECTRON_AB_NO_SYSTEM_MOUSE_HELPER) {
    electronProfileIncrement("counters", "systemMouseHelperBypassed", 1);
    const fallback = systemMouseScreenFallback();
    if (fallback && fallback.ok) return { ...fallback, sampledAt: Date.now(), helperDisabledByAb: true };
    return { ...fallback, helperDisabledByAb: true };
  }
  startSystemMouseHelper();
  const now = Date.now();
  if (latestSystemMousePoint && now - Number(latestSystemMousePoint.sampledAt || 0) < 750) {
    return latestSystemMousePoint;
  }
  const fallback = systemMouseScreenFallback();
  if (fallback && fallback.ok) return { ...fallback, sampledAt: now };
  return fallback;
}

ipcMain.handle("system-mouse-position", async () => {
  return getSystemMousePositionPayload();
});

if (!IS_PORTABLE) {
  try {
    const desiredName = "NovaFlow";
    app.setName(desiredName);
    const appData = app.getPath("appData");
    const targetUserData = path.join(appData, desiredName);
    const legacyUserData = path.join(appData, "particle-editor-desktop");
    migrateUserDataDir(legacyUserData, targetUserData);
    app.setPath("userData", targetUserData);
  } catch {
    void 0;
  }
}

const NOVAFLOW_AI_RUNTIME_DEFAULT_PORT = 8188;
const NOVAFLOW_AI_RUNTIME_DIR_NAME = path.join("NovaFlow", "AI-Runtime");
const NOVAFLOW_AI_RUNTIME_GENERATED_DIR = path.join(os.tmpdir(), NOVAFLOW_AI_RUNTIME_DIR_NAME, "runtime-generated");
const NOVAFLOW_RUNTIME_RELEASE_MEMORY_PROTECTED_RELATIVE_OUTPUT = path.join("runtime-generated", "output");
const NOVAFLOW_AI_RUNTIME_START_TIMEOUT_MS = 120_000;
const NOVAFLOW_AI_RUNTIME_STOP_TIMEOUT_MS = 20_000;
const NOVAFLOW_AI_RUNTIME_SCRIPT_TIMEOUT_MS = 30_000;
const NOVAFLOW_PROMPT_ASSISTANT_MODEL_TYPE = "qwen2_5_vl_7b_fp8";
const NOVAFLOW_PROMPT_ASSISTANT_DEFAULT_MODEL_PATH = "E:\\BaiduNetdiskDownload\\qwen_2.5_vl_7b_fp8_scaled.safetensors";
const NOVAFLOW_PROMPT_ASSISTANT_MODEL_NAME = "qwen_2.5_vl_7b_fp8_scaled.safetensors";
const NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_TYPE = "qwen3_vl_8b_abliterated_nf4";
const NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_DIR_NAME = "Huihui-Qwen3-VL-8B-Instruct-Abliterated";
const NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_DIR_NAME = `${NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_DIR_NAME}-novaflow-bnb-nf4-v1`;
const NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_SCHEMA = "nf.qwen3-vl.bnb-nf4-cache.v1";
const NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_MANIFEST = "novaflow_nf4_cache.json";
const NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_INVALID_MARKER = ".novaflow-cache-invalid.json";
const NOVAFLOW_PROMPT_ASSISTANT_REVERSE_DEFAULT_MODEL_PATH = path.join(
  "E:\\BaiduNetdiskDownload\\prompt_generator",
  NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_DIR_NAME
);
let novaFlowRuntimeStartPromise = null;
let novaFlowRuntimeStartAbortController = null;
let novaFlowRuntimeLastStatus = null;
const novaFlowRuntimeStartCoordinator = createRuntimeStartCoordinator({
  processAlive: isProcessAlive,
  inspectProcess: inspectNovaFlowProcessIdentityAsync,
  processStartedAt: Date.now() - process.uptime() * 1000,
  executablePath: process.execPath
});
const miniMaxH3RuntimeLifecycle = createMiniMaxH3RuntimeLifecycle({
  processAlive: isProcessAlive,
  inspectProcess: inspectNovaFlowProcessIdentityAsync,
  processStartedAt: Date.now() - process.uptime() * 1000,
  executablePath: process.execPath
});
const miniMaxH3LoraCatalog = createMiniMaxH3LoraCatalog({
  readConfig: () => miniMaxH3RuntimeLifecycle.readConfig(),
  expectedModelsPath: () => readNovaFlowRuntimeConfig()?.modelsPath,
  listRuntimeLoraNames: async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(
        "http://127.0.0.1:8189/object_info/LoraLoaderModelOnly",
        { method: "GET", signal: controller.signal },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  },
});
const { createQwenLoraCatalog } = require("./main/qwen-lora-catalog");
const qwenLoraCatalog = createQwenLoraCatalog({
  listRuntimeLoraNames: async () => {
    const config = readNovaFlowRuntimeConfig();
    const baseUrl = sanitizeRuntimeBaseUrl(config?.baseUrl || `http://127.0.0.1:${config?.port || 8188}`);
    if (!baseUrl) throw new Error("novaflow_runtime_base_url_missing");
    const response = await fetch(new URL("/object_info/LoraLoaderModelOnly", `${baseUrl}/`), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },
});
let promptAssistantProcess = null;
let promptAssistantStartPromise = null;
let promptAssistantStopPromise = null;
let promptAssistantNextRequestId = 1;
let promptAssistantStdoutBuffer = "";
let promptAssistantStderrLines = [];
let promptAssistantPending = new Map();
let promptAssistantBusy = false;
let promptAssistantRequestLease = null;
let promptAssistantNextLeaseId = 1;
let promptAssistantLastError = "";
let promptAssistantLastWarning = "";

function getNovaFlowRuntimeRootDir() {
  const override = String(process.env.NOVAFLOW_AI_RUNTIME_DIR || "").trim();
  if (override) return path.resolve(override);
  const programData = String(process.env.ProgramData || "C:\\ProgramData").trim() || "C:\\ProgramData";
  return path.join(programData, NOVAFLOW_AI_RUNTIME_DIR_NAME);
}

function getNovaFlowRuntimeJsonPath() {
  const override = String(process.env.NOVAFLOW_AI_RUNTIME_JSON || "").trim();
  if (override) return path.resolve(override);
  return path.join(getNovaFlowRuntimeRootDir(), "runtime.json");
}

function getNovaFlowRuntimeGeneratedDir() {
  const override = String(process.env.NOVAFLOW_AI_RUNTIME_GENERATED_DIR || "").trim();
  return path.resolve(override || NOVAFLOW_AI_RUNTIME_GENERATED_DIR);
}

function getNovaFlowRuntimeScriptEnv(config) {
  return {
    ...process.env,
    NOVAFLOW_AI_RUNTIME_GENERATED_DIR: String(config?.generatedPath || getNovaFlowRuntimeGeneratedDir())
  };
}

function normalizeRuntimePort(value) {
  const port = Math.round(Number(value || 0));
  return port > 0 && port < 65536 ? port : NOVAFLOW_AI_RUNTIME_DEFAULT_PORT;
}

function findNovaFlowRuntimeScript(installPath, fileName) {
  const candidates = [
    path.join(installPath, "scripts", fileName),
    path.join(installPath, fileName),
    path.join(installPath, "bin", fileName)
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return candidates[0];
}

const NOVAFLOW_SEETHROUGH_HEAD_NODE_FILE = "novaflow_seethrough_head_layer.py";

// The See-through split needs NovaFlow's whole-head helper node. It ships with the app (main/novaflow-seethrough-head-node.py)
// and is copied into the runtime's custom_nodes folder before the runtime starts; the See-through plugin is left untouched.
function ensureNovaFlowSeeThroughHeadNode(config) {
  try {
    const source = path.join(__dirname, "main", "novaflow-seethrough-head-node.py");
    const customNodesPath = String((config && config.customNodesPath) || "");
    if (!customNodesPath || !fs.existsSync(source)) return { ok: false, reason: "missing" };
    const target = path.join(customNodesPath, NOVAFLOW_SEETHROUGH_HEAD_NODE_FILE);
    const code = fs.readFileSync(source, "utf8");
    const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (code === previous) return { ok: true, updated: false, target };
    fs.mkdirSync(customNodesPath, { recursive: true });
    fs.writeFileSync(target, code, "utf8");
    appendLogLine("info", "novaflow-seethrough-head-node-installed", { target });
    return { ok: true, updated: true, target };
  } catch (err) {
    appendLogLine("warn", "novaflow-seethrough-head-node-install-failed", { message: String((err && err.message) || err) });
    return { ok: false, reason: String((err && err.message) || err) };
  }
}

function readNovaFlowRuntimeConfig() {
  const runtimeJsonPath = getNovaFlowRuntimeJsonPath();
  const runtimeDir = path.dirname(runtimeJsonPath);
  if (!fs.existsSync(runtimeJsonPath)) {
    return {
      ok: false,
      installed: false,
      status: "missing",
      error: "runtime_json_missing",
      runtimeJsonPath,
      installPath: runtimeDir,
      port: NOVAFLOW_AI_RUNTIME_DEFAULT_PORT,
      baseUrl: `http://127.0.0.1:${NOVAFLOW_AI_RUNTIME_DEFAULT_PORT}`
    };
  }

  try {
    const raw = fs.readFileSync(runtimeJsonPath, "utf8");
    const data = JSON.parse(raw);
    const installPath = path.resolve(String(data.installPath || runtimeDir));
    const port = normalizeRuntimePort(data.port);
    const generatedPath = getNovaFlowRuntimeGeneratedDir();
    return {
      ok: true,
      installed: true,
      status: "installed",
      name: String(data.name || "NovaFlow AI Runtime"),
      version: String(data.version || ""),
      engine: String(data.engine || ""),
      port,
      baseUrl: `http://127.0.0.1:${port}`,
      runtimeJsonPath,
      installPath,
      assetsPath: String(data.assetsPath || ""),
      modelsPath: String(data.modelsPath || ""),
      promptAssistantReverseModelPath: String(data.promptAssistantReverseModelPath || ""),
      customNodesPath: String(data.customNodesPath || ""),
      generatedPath,
      inputPath: path.join(generatedPath, "input"),
      outputPath: path.join(generatedPath, "output"),
      tempPath: path.join(generatedPath, "temp-root"),
      logsPath: path.join(installPath, "logs"),
      startScriptPath: findNovaFlowRuntimeScript(installPath, "start-runtime.bat"),
      stopScriptPath: findNovaFlowRuntimeScript(installPath, "stop-runtime.bat")
    };
  } catch (err) {
    return {
      ok: false,
      installed: true,
      status: "invalid",
      error: "runtime_json_invalid",
      detail: String(err?.message || err),
      runtimeJsonPath,
      installPath: runtimeDir,
      port: NOVAFLOW_AI_RUNTIME_DEFAULT_PORT,
      baseUrl: `http://127.0.0.1:${NOVAFLOW_AI_RUNTIME_DEFAULT_PORT}`
    };
  }
}

function broadcastNovaFlowRuntimeStatus(status) {
  try {
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        sendRuntimeStatusChangedToWindow(win, status, "broadcast");
      } catch {}
    });
  } catch {}
}

function readNovaFlowRuntimePid(config) {
  try {
    const generatedPath = String(config?.generatedPath || "");
    if (!generatedPath) return 0;
    const pidPath = path.join(generatedPath, "runtime.pid");
    if (!fs.existsSync(pidPath)) return 0;
    const pidText = String(fs.readFileSync(pidPath, "utf8") || "").trim();
    if (!/^\d+$/.test(pidText)) return 0;
    return Number(pidText) || 0;
  } catch {
    return 0;
  }
}

function isProcessAlive(pid) {
  try {
    if (!pid || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function inspectNovaFlowProcessIdentityAsync(pid) {
  const processId = Math.max(0, Math.round(Number(pid) || 0));
  if (!processId || !isProcessAlive(processId)) return { alive: false, verified: true };
  if (process.platform !== "win32") return { alive: true, verified: false };
  const command = [
    `$p=Get-Process -Id ${processId} -ErrorAction SilentlyContinue`,
    `if (-not $p) { '{"alive":false,"verified":true}'; exit 0 }`,
    `try { $start=[DateTimeOffset]$p.StartTime; [pscustomobject]@{alive=$true;verified=$true;executablePath=[string]$p.Path;processStartedAt=$start.ToUnixTimeMilliseconds()} | ConvertTo-Json -Compress } catch { '{"alive":true,"verified":false}' }`
  ].join("; ");
  const result = await runCmd("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    timeoutMs: 1500,
    killTreeOnTimeout: true,
    allowDuringShutdown: true
  });
  if (!result.ok) return { alive: true, verified: false };
  try {
    const value = JSON.parse(String(result.stdout || "").trim() || "{}");
    if (value.alive === false) return { alive: false, verified: true };
    const processStartedAt = Number(value.processStartedAt);
    const executablePath = String(value.executablePath || "").trim();
    return {
      alive: true,
      verified: value.verified === true && Number.isFinite(processStartedAt) && !!executablePath,
      processStartedAt: Number.isFinite(processStartedAt) ? processStartedAt : null,
      executablePath
    };
  } catch {
    return { alive: true, verified: false };
  }
}

async function scanOtherNovaFlowMainProcesses() {
  if (process.platform !== "win32") return { ok: true, processes: [] };
  const command = [
    `$ErrorActionPreference='Stop'`,
    `$selfPid=${process.pid}`,
    `$names=@('novaflow.exe','novaflowportable.exe')`,
    `try {`,
    `  $items=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ProcessId -ne $selfPid -and $names -contains ([string]$_.Name).ToLowerInvariant() -and ([string]$_.CommandLine) -notmatch '(?i)(^|\\s)--type=' })`,
    `  $result=@($items | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;name=[string]$_.Name;executablePath=[string]$_.ExecutablePath;commandLine=[string]$_.CommandLine} })`,
    `  ConvertTo-Json -InputObject $result -Compress`,
    `} catch { Write-Error $_; exit 2 }`
  ].join("; ");
  try {
    const result = await runCmd("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      timeoutMs: 2500,
      killTreeOnTimeout: true,
      allowDuringShutdown: true
    });
    if (!result.ok) return { ok: false, processes: [], error: String(result.error || result.stderr || "process_scan_failed") };
    const parsed = JSON.parse(String(result.stdout || "[]").trim() || "[]");
    const processes = (Array.isArray(parsed) ? parsed : [parsed]).filter((item) => Number(item?.pid) > 0);
    return { ok: true, processes };
  } catch (error) {
    return { ok: false, processes: [], error: String(error?.message || error) };
  }
}

function isNovaFlowRuntimeProcessAlive(config) {
  return isProcessAlive(readNovaFlowRuntimePid(config));
}

async function inspectNovaFlowRuntimeProcess(config) {
  const pid = readNovaFlowRuntimePid(config);
  if (!pid || !isProcessAlive(pid)) return { alive: false, verified: true, runtime: false, pid };
  if (process.platform !== "win32") return { alive: true, verified: false, runtime: false, pid };
  const command = [
    `$ErrorActionPreference='Stop'`,
    `try {`,
    `  $p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction Stop`,
    `  if (-not $p) { '{"alive":false}'; exit 0 }`,
    `  [pscustomobject]@{alive=$true;commandLine=[string]$p.CommandLine;executablePath=[string]$p.ExecutablePath} | ConvertTo-Json -Compress`,
    `} catch { Write-Error $_; exit 2 }`
  ].join("; ");
  const result = await runCmd("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    timeoutMs: 1800,
    killTreeOnTimeout: true,
    allowDuringShutdown: true
  });
  if (!result.ok) return { alive: true, verified: false, runtime: false, pid, error: result.error || result.stderr || "runtime_process_inspection_failed" };
  try {
    const value = JSON.parse(String(result.stdout || "{}").trim() || "{}");
    if (value.alive === false) return { alive: false, verified: true, runtime: false, pid };
    const commandLine = String(value.commandLine || "");
    if (!commandLine.trim() || !config?.installPath) return { alive: true, verified: false, runtime: false, pid };
    const commandLower = commandLine.toLowerCase();
    const mainPath = path.resolve(String(config?.installPath || ""), "engine", "ComfyUI", "main.py").toLowerCase();
    const mainPathAlt = mainPath.replace(/\\/g, "/");
    const port = normalizeRuntimePort(config?.port);
    const runtime = (commandLower.includes(mainPath) || commandLower.replace(/\\/g, "/").includes(mainPathAlt))
      && new RegExp(`--port\\s+${port}(?:\\s|$)`, "i").test(commandLine);
    return { alive: true, verified: true, runtime, pid, commandLine, executablePath: String(value.executablePath || "") };
  } catch (error) {
    return { alive: true, verified: false, runtime: false, pid, error: String(error?.message || error) };
  }
}

function removeStaleNovaFlowRuntimePid(config, expectedPid) {
  try {
    const generatedPath = String(config?.generatedPath || "");
    if (!generatedPath) return false;
    const pidPath = path.join(generatedPath, "runtime.pid");
    if (readNovaFlowRuntimePid(config) !== Number(expectedPid)) return false;
    fs.rmSync(pidPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

function numberOrNull(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function normalizeProcessMemoryJson(value, fallbackPid) {
  const source = value && typeof value === "object" ? value : {};
  const pid = numberOrNull(source.id ?? source.Id ?? fallbackPid) || 0;
  return {
    ok: !!pid,
    pid,
    processName: String(source.processName || source.ProcessName || ""),
    workingSetBytes: numberOrNull(source.workingSetBytes ?? source.WorkingSet64),
    privateBytes: numberOrNull(source.privateBytes ?? source.PrivateMemorySize64),
    virtualBytes: numberOrNull(source.virtualBytes ?? source.VirtualMemorySize64),
    path: String(source.path || source.Path || "")
  };
}

async function readProcessMemorySnapshot(pid) {
  const processId = Math.max(0, Math.round(Number(pid) || 0));
  if (!processId || !isProcessAlive(processId)) return { ok: false, pid: processId, alive: false };
  const ps = [
    `$p=Get-Process -Id ${processId} -ErrorAction SilentlyContinue`,
    "if ($p) {",
    "  [pscustomobject]@{",
    "    id=$p.Id;",
    "    processName=$p.ProcessName;",
    "    workingSetBytes=$p.WorkingSet64;",
    "    privateBytes=$p.PrivateMemorySize64;",
    "    virtualBytes=$p.VirtualMemorySize64;",
    "    path=$p.Path",
    "  } | ConvertTo-Json -Compress",
    "}"
  ].join("; ");
  const result = await runCmd("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    timeoutMs: 2500
  });
  if (!result.ok) {
    return {
      ok: false,
      pid: processId,
      alive: true,
      error: String(result.stderr || result.stdout || result.error || "process_memory_unavailable").slice(0, 300)
    };
  }
  try {
    const parsed = JSON.parse(String(result.stdout || "").trim() || "{}");
    return { ...normalizeProcessMemoryJson(parsed, processId), alive: true };
  } catch (err) {
    return { ok: false, pid: processId, alive: true, error: String(err?.message || err) };
  }
}

function splitNvidiaCsvLine(line) {
  return String(line || "").split(",").map((part) => part.trim());
}

function parseNvidiaNumber(value) {
  const text = String(value || "").replace(/[^\d.-]/g, "").trim();
  if (!text || /N\/A/i.test(String(value || ""))) return null;
  const next = Number(text);
  return Number.isFinite(next) ? next : null;
}

function findNvidiaSmiPath() {
  const candidates = [
    "nvidia-smi",
    path.join(process.env.SystemRoot || "C:\\Windows", "System32", "nvidia-smi.exe")
  ];
  for (const candidate of candidates) {
    try {
      if (candidate === "nvidia-smi" || fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return "";
}

async function readNvidiaSmiSnapshot() {
  const smiPath = findNvidiaSmiPath();
  if (!smiPath) return { ok: false, error: "nvidia-smi_not_found", gpus: [], processes: [] };
  const gpuResult = await runCmd(smiPath, [
    "--query-gpu=index,name,memory.total,memory.used,memory.free",
    "--format=csv,noheader,nounits"
  ], { timeoutMs: 3500 });
  const processResult = await runCmd(smiPath, [
    "--query-compute-apps=pid,process_name,used_memory",
    "--format=csv,noheader,nounits"
  ], { timeoutMs: 3500 });
  const gpus = String(gpuResult.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = splitNvidiaCsvLine(line);
      return {
        index: parseNvidiaNumber(parts[0]),
        name: String(parts[1] || ""),
        memoryTotalMb: parseNvidiaNumber(parts[2]),
        memoryUsedMb: parseNvidiaNumber(parts[3]),
        memoryFreeMb: parseNvidiaNumber(parts[4])
      };
    });
  const processes = String(processResult.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = splitNvidiaCsvLine(line);
      return {
        pid: Math.max(0, Math.round(parseNvidiaNumber(parts[0]) || 0)),
        processName: String(parts[1] || ""),
        usedMemoryMb: parseNvidiaNumber(parts.slice(2).join(","))
      };
    })
    .filter((item) => item.pid);
  return {
    ok: !!gpuResult.ok,
    error: gpuResult.ok ? "" : String(gpuResult.stderr || gpuResult.stdout || gpuResult.error || "").slice(0, 300),
    processQueryOk: !!processResult.ok,
    processQueryError: processResult.ok ? "" : String(processResult.stderr || processResult.stdout || processResult.error || "").slice(0, 300),
    gpus,
    processes
  };
}

function attachNvidiaProcessMemory(processInfo, nvidia) {
  const pid = Math.max(0, Math.round(Number(processInfo && processInfo.pid) || 0));
  if (!pid || !nvidia || !Array.isArray(nvidia.processes)) return processInfo;
  const hit = nvidia.processes.find((item) => Number(item && item.pid) === pid);
  return {
    ...(processInfo || {}),
    gpuMemoryMb: hit ? hit.usedMemoryMb : null,
    gpuProcessName: hit ? hit.processName : ""
  };
}

function runtimeLogFiles(config) {
  const logsPath = String(config && config.logsPath || "");
  if (!logsPath) return [];
  try {
    return fs.readdirSync(logsPath, { withFileTypes: true })
      .filter((entry) => entry && entry.isFile && entry.isFile())
      .map((entry) => {
        const filePath = path.join(logsPath, entry.name);
        let stats = null;
        try { stats = fs.statSync(filePath); } catch {}
        return stats ? {
          name: entry.name,
          path: filePath,
          size: Number(stats.size || 0) || 0,
          mtimeMs: Number(stats.mtimeMs || 0) || 0
        } : null;
      })
      .filter(Boolean)
      .filter((item) => /\.(log|txt)$/i.test(item.name) || /runtime|comfy|server|stdout|stderr/i.test(item.name))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function readRuntimeLogSegment(file, cursor) {
  try {
    const size = Number(file && file.size || 0) || 0;
    const previousSize = Number(cursor && cursor.size || 0) || 0;
    const maxBytes = 256 * 1024;
    const start = previousSize > 0 && previousSize <= size ? previousSize : Math.max(0, size - maxBytes);
    const length = Math.min(maxBytes, Math.max(0, size - start));
    if (!length) return "";
    const fd = fs.openSync(file.path, "r");
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return buffer.toString("utf8");
    } finally {
      try { fs.closeSync(fd); } catch {}
    }
  } catch {
    return "";
  }
}

function runtimeLogEvidenceFromText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const evidence = [];
  const pattern = /(lowvram|low_vram|normal_vram|offload|offloading|DynamicVRAM|VRAM|Requested to load|loaded completely|model loaded|Model Initializing|loading .*model|unload|free memory|soft_empty_cache)/i;
  for (const line of lines) {
    const clean = String(line || "").trim();
    if (!clean || !pattern.test(clean)) continue;
    evidence.push(clean.slice(0, 500));
  }
  return evidence.slice(-30);
}

function readRuntimeLogDiagnostics(config, previousCursors) {
  const files = runtimeLogFiles(config);
  const cursors = files.map((file) => ({
    name: file.name,
    path: file.path,
    size: file.size,
    mtimeMs: file.mtimeMs
  }));
  const previous = Array.isArray(previousCursors) ? previousCursors : [];
  const previousByPath = new Map(previous.map((item) => [String(item && item.path || ""), item]));
  const evidence = [];
  for (const file of files) {
    const segment = readRuntimeLogSegment(file, previousByPath.get(file.path));
    const lines = runtimeLogEvidenceFromText(segment);
    for (const line of lines) evidence.push({ file: file.name, line });
  }
  return {
    logsPath: String(config && config.logsPath || ""),
    cursors,
    evidence: evidence.slice(-40)
  };
}

function systemRamSnapshot() {
  const totalBytes = Number(os.totalmem() || 0) || 0;
  const freeBytes = Number(os.freemem() || 0) || 0;
  return {
    totalBytes,
    freeBytes,
    usedBytes: Math.max(0, totalBytes - freeBytes),
    usedRatio: totalBytes > 0 ? Math.max(0, Math.min(1, (totalBytes - freeBytes) / totalBytes)) : 0
  };
}

function isTcpPortListening(port, host = "127.0.0.1", timeoutMs = 700) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(value);
    };
    const socket = net.createConnection({ host, port: Number(port) || NOVAFLOW_AI_RUNTIME_DEFAULT_PORT });
    socket.setTimeout(Math.max(250, Number(timeoutMs) || 700));
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

function isNovaFlowRuntimeBaseUrl(baseUrl, runtimeBaseUrl = "") {
  try {
    const url = new URL(String(baseUrl || ""));
    const host = String(url.hostname || "").toLowerCase();
    const port = String(url.port || (url.protocol === "http:" ? "80" : ""));
    if (runtimeBaseUrl && url.origin === runtimeBaseUrl) return true;
    return url.protocol === "http:" && (host === "127.0.0.1" || host === "localhost") && port === String(NOVAFLOW_AI_RUNTIME_DEFAULT_PORT);
  } catch {
    return false;
  }
}

function resolveRuntimeBaseUrl(value) {
  const requested = sanitizeRuntimeBaseUrl(value || "");
  const runtime = readNovaFlowRuntimeConfig();
  const runtimeBaseUrl = runtime?.installed && runtime?.baseUrl ? runtime.baseUrl : "";
  if (runtimeBaseUrl) return runtimeBaseUrl;
  if (!requested) return `http://127.0.0.1:${NOVAFLOW_AI_RUNTIME_DEFAULT_PORT}`;
  return isNovaFlowRuntimeBaseUrl(requested, runtimeBaseUrl) ? requested : "";
}

function resolvePromptAssistantModelPath(runtimeConfig = readNovaFlowRuntimeConfig()) {
  const override = String(process.env.NOVAFLOW_PROMPT_ASSISTANT_MODEL_PATH || "").trim();
  const candidates = [];
  if (override) candidates.push(path.resolve(override));
  candidates.push(NOVAFLOW_PROMPT_ASSISTANT_DEFAULT_MODEL_PATH);
  const runtimeModels = String(runtimeConfig?.modelsPath || "").trim();
  if (runtimeModels) candidates.push(path.join(runtimeModels, "text_encoders", NOVAFLOW_PROMPT_ASSISTANT_MODEL_NAME));
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return candidates[0] || NOVAFLOW_PROMPT_ASSISTANT_DEFAULT_MODEL_PATH;
}

function isPromptAssistantReverseModelDir(candidate) {
  if (!candidate) return false;
  try {
    if (!fs.statSync(candidate).isDirectory()) return false;
    for (const name of ["config.json", "tokenizer_config.json", "preprocessor_config.json"]) {
      if (!fs.existsSync(path.join(candidate, name))) return false;
    }
    const modelConfig = JSON.parse(fs.readFileSync(path.join(candidate, "config.json"), "utf8"));
    if (!Array.isArray(modelConfig?.architectures)
      || !modelConfig.architectures.includes("Qwen3VLForConditionalGeneration")) return false;
    if (fs.existsSync(path.join(candidate, "model.safetensors"))) return true;
    const indexPath = path.join(candidate, "model.safetensors.index.json");
    if (!fs.existsSync(indexPath)) return false;
    const manifest = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    const shardNames = Array.from(new Set(Object.values(manifest?.weight_map || {})))
      .map((name) => String(name || "").trim())
      .filter(Boolean);
    return shardNames.length > 0 && shardNames.every((name) => {
      const fullPath = path.resolve(candidate, name);
      const relative = path.relative(path.resolve(candidate), fullPath);
      return relative && !relative.startsWith("..") && !path.isAbsolute(relative) && fs.statSync(fullPath).isFile();
    });
  } catch {
    return false;
  }
}

function resolvePromptAssistantReverseModelPath(runtimeConfig = readNovaFlowRuntimeConfig()) {
  const override = String(process.env.NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH || "").trim();
  const candidates = [];
  if (override) candidates.push(path.resolve(override));
  const configured = String(runtimeConfig?.promptAssistantReverseModelPath || "").trim();
  if (configured) candidates.push(path.resolve(configured));
  candidates.push(NOVAFLOW_PROMPT_ASSISTANT_REVERSE_DEFAULT_MODEL_PATH);
  const runtimeModels = String(runtimeConfig?.modelsPath || "").trim();
  if (runtimeModels) {
    candidates.push(path.join(runtimeModels, "prompt_assistant", NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_DIR_NAME));
    candidates.push(path.join(runtimeModels, "vlm", NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_DIR_NAME));
  }
  for (const candidate of candidates) {
    if (isPromptAssistantReverseModelDir(candidate)) return candidate;
  }
  return candidates[0] || NOVAFLOW_PROMPT_ASSISTANT_REVERSE_DEFAULT_MODEL_PATH;
}

function promptAssistantModelWeightFiles(modelPath) {
  const direct = path.join(modelPath, "model.safetensors");
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return ["model.safetensors"];
  const indexPath = path.join(modelPath, "model.safetensors.index.json");
  if (!fs.existsSync(indexPath)) return [];
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  return Array.from(new Set(Object.values(index?.weight_map || {})))
    .map((name) => String(name || "").trim())
    .filter((name) => name && path.basename(name) === name && !path.isAbsolute(name))
    .sort();
}

function promptAssistantFileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function promptAssistantReverseSourceFingerprint(modelPath) {
  const weightFiles = promptAssistantModelWeightFiles(modelPath);
  const indexPath = path.join(modelPath, "model.safetensors.index.json");
  return {
    sourcePath: path.resolve(modelPath),
    configSha256: promptAssistantFileSha256(path.join(modelPath, "config.json")),
    indexSha256: fs.existsSync(indexPath) ? promptAssistantFileSha256(indexPath) : "",
    weights: weightFiles.map((name) => {
      const stat = fs.statSync(path.join(modelPath, name), { bigint: true });
      return { name, size: Number(stat.size), mtimeNs: String(stat.mtimeNs) };
    })
  };
}

function promptAssistantReverseCacheArtifacts(cachePath) {
  const weights = promptAssistantModelWeightFiles(cachePath).map((name) => {
    const stat = fs.statSync(path.join(cachePath, name), { bigint: true });
    return { name, size: Number(stat.size) };
  });
  const metadata = [
    "config.json",
    "model.safetensors.index.json",
    "tokenizer_config.json",
    "preprocessor_config.json"
  ].filter((name) => fs.existsSync(path.join(cachePath, name))).map((name) => {
    const filePath = path.join(cachePath, name);
    const stat = fs.statSync(filePath, { bigint: true });
    return { name, size: Number(stat.size), sha256: promptAssistantFileSha256(filePath) };
  });
  return { weights, metadata };
}

function inspectPromptAssistantReverseCache(cachePath, modelPath) {
  try {
    const resolvedCache = path.resolve(String(cachePath || ""));
    const resolvedModel = path.resolve(String(modelPath || ""));
    const cacheFromModel = path.relative(resolvedModel, resolvedCache);
    const modelFromCache = path.relative(resolvedCache, resolvedModel);
    const pathsOverlap = resolvedCache.toLowerCase() === resolvedModel.toLowerCase()
      || (cacheFromModel && !cacheFromModel.startsWith("..") && !path.isAbsolute(cacheFromModel))
      || (modelFromCache && !modelFromCache.startsWith("..") && !path.isAbsolute(modelFromCache));
    if (pathsOverlap) return { ready: false, code: "cache-path-overlaps-source" };
    if (!fs.existsSync(resolvedCache)) return { ready: false, code: "cache-missing" };
    if (!fs.statSync(resolvedCache).isDirectory()) return { ready: false, code: "cache-path-not-directory" };
    const manifestPath = path.join(resolvedCache, NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_MANIFEST);
    if (!fs.existsSync(manifestPath)) return { ready: false, code: "cache-path-unowned" };
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest?.schema !== NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_SCHEMA) {
      return { ready: false, code: "cache-schema-mismatch" };
    }
    if (fs.existsSync(path.join(resolvedCache, NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_INVALID_MARKER))) {
      return { ready: false, code: "cache-marked-invalid" };
    }
    if (safeJson(manifest.sourceFingerprint) !== safeJson(promptAssistantReverseSourceFingerprint(resolvedModel))) {
      return { ready: false, code: "cache-source-mismatch" };
    }
    if (safeJson(manifest.artifacts) !== safeJson(promptAssistantReverseCacheArtifacts(resolvedCache))) {
      return { ready: false, code: "cache-artifacts-mismatch" };
    }
    const config = JSON.parse(fs.readFileSync(path.join(resolvedCache, "config.json"), "utf8"));
    if (String(config?.quantization_config?.quant_method || "") !== "bitsandbytes") {
      return { ready: false, code: "cache-not-prequantized" };
    }
    return { ready: true, code: "cache-ready" };
  } catch {
    return { ready: false, code: "cache-invalid" };
  }
}

function resolvePromptAssistantReverseCachePath(runtimeConfig = readNovaFlowRuntimeConfig(), reverseModelPath = "") {
  const override = String(process.env.NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_PATH || "").trim();
  if (override) return path.resolve(override);
  const runtimeModels = String(runtimeConfig?.modelsPath || "").trim();
  if (runtimeModels) {
    return path.join(
      runtimeModels,
      "prompt_assistant",
      "cache",
      NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_DIR_NAME
    );
  }
  const selectedModelPath = String(reverseModelPath || NOVAFLOW_PROMPT_ASSISTANT_REVERSE_DEFAULT_MODEL_PATH).trim();
  return path.join(
    path.dirname(selectedModelPath),
    ".novaflow-cache",
    NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_DIR_NAME
  );
}

function findPromptAssistantServiceScript() {
  const candidates = [
    path.join(__dirname, "prompt-assistant-service.py"),
    path.join(app.getAppPath(), "prompt-assistant-service.py"),
    path.join(process.resourcesPath || "", "app", "prompt-assistant-service.py")
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return candidates[0];
}

function findPromptAssistantPython(runtimeConfig = readNovaFlowRuntimeConfig()) {
  const override = String(process.env.NOVAFLOW_PROMPT_ASSISTANT_PYTHON || "").trim();
  if (override) return path.resolve(override);
  const installPath = String(runtimeConfig?.installPath || "").trim();
  const runtimePython = installPath ? path.join(installPath, "engine", "python", "python.exe") : "";
  if (runtimePython && fs.existsSync(runtimePython)) return runtimePython;
  return process.platform === "win32" ? "python.exe" : "python3";
}

function getPromptAssistantConfig() {
  const runtimeConfig = readNovaFlowRuntimeConfig();
  const modelPath = resolvePromptAssistantModelPath(runtimeConfig);
  const reverseModelPath = resolvePromptAssistantReverseModelPath(runtimeConfig);
  const reverseCachePath = resolvePromptAssistantReverseCachePath(runtimeConfig, reverseModelPath);
  const reverseCacheStatus = inspectPromptAssistantReverseCache(reverseCachePath, reverseModelPath);
  const serviceScript = findPromptAssistantServiceScript();
  const pythonPath = findPromptAssistantPython(runtimeConfig);
  const modelExists = (() => {
    try { return fs.existsSync(modelPath); } catch { return false; }
  })();
  const serviceExists = (() => {
    try { return fs.existsSync(serviceScript); } catch { return false; }
  })();
  const reverseModelExists = isPromptAssistantReverseModelDir(reverseModelPath);
  const runtimeStatus = promptAssistantBusy
    ? "推理中"
    : (modelExists ? "模型可用" : (reverseModelExists ? "图片反推模型可用" : "未配置模型"));
  return {
    ok: modelExists && serviceExists,
    modelType: NOVAFLOW_PROMPT_ASSISTANT_MODEL_TYPE,
    modelPath,
    reverseModelType: NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_TYPE,
    reverseModelPath,
    reverseCachePath,
    reverseCacheReady: reverseCacheStatus.ready === true,
    reverseCacheStatus: reverseCacheStatus.code,
    reverseModelEnabled: reverseModelExists,
    modelExists,
    serviceExists,
    enabled: modelExists && serviceExists,
    runtimeStatus,
    runtimeConfig,
    serviceScript,
    pythonPath,
    error: !serviceExists
      ? "Prompt Assistant 服务脚本不存在"
      : (modelExists || reverseModelExists ? promptAssistantLastError : "未配置模型")
  };
}

function rejectPromptAssistantPending(error) {
  const pending = promptAssistantPending;
  promptAssistantPending = new Map();
  pending.forEach((item) => {
    clearTimeout(item.timer);
    item.reject(new Error(error || "Prompt Assistant 服务已退出"));
  });
}

function stopPromptAssistantServiceSync() {
  const proc = promptAssistantProcess;
  promptAssistantProcess = null;
  promptAssistantStartPromise = null;
  promptAssistantStdoutBuffer = "";
  promptAssistantBusy = Boolean(promptAssistantRequestLease);
  if (!proc) return Promise.resolve("not-running");
  const waitForExit = new Promise((resolve) => {
    const timer = setTimeout(() => resolve("stop-timeout"), 5000);
    timer.unref?.();
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve("stopped");
    });
  });
  promptAssistantStopPromise = waitForExit;
  void waitForExit.finally(() => {
    if (promptAssistantStopPromise === waitForExit) promptAssistantStopPromise = null;
  });
  proc.__novaflowIntentionalStop = true;
  try {
    proc.stdin?.write(JSON.stringify({ command: "shutdown" }) + "\n");
  } catch {}
  try {
    if (!proc.killed) proc.kill();
  } catch {}
  rejectPromptAssistantPending("Prompt Assistant 服务已关闭");
}

function promptAssistantFailureMetadata(value) {
  const direct = value && typeof value === "object" ? value : {};
  const nested = direct.failure && typeof direct.failure === "object" ? direct.failure : {};
  const source = { ...direct, ...nested };
  const clean = (field, maxLength = 160) => String(source[field] || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  const metadata = {};
  for (const [field, maxLength] of [
    ["errorCode", 80],
    ["message", 240],
    ["reverseProvider", 120],
    ["providerFailureCode", 80],
    ["requestedVisualSchema", 40],
    ["failureCategory", 48],
    ["failureClass", 80],
    ["generationGate", 32]
  ]) {
    const text = clean(field, maxLength);
    if (text) metadata[field] = text;
  }
  // Forward only fixed diagnostic categories, never model text or image details.
  const validationLeaf = clean("validationLeaf", 80);
  if (["visual-semantics", "visual-person-count", "visual-body-exposure", "visual-age", "visual-interaction", "visual-signals", "visual-fact-classification"].includes(validationLeaf)) {
    metadata.validationLeaf = validationLeaf;
  }
  for (const field of ["retryable", "retryAttempted", "legacyFallbackSuppressed", "sensitivePromptBlocked"]) {
    if (typeof source[field] === "boolean") metadata[field] = source[field];
  }
  if (Number.isFinite(Number(source.retryCount))) {
    metadata.retryCount = Math.max(0, Math.min(2, Math.trunc(Number(source.retryCount))));
  }
  return metadata;
}

function handlePromptAssistantStdout(text) {
  promptAssistantStdoutBuffer += String(text || "");
  let index = promptAssistantStdoutBuffer.indexOf("\n");
  while (index >= 0) {
    const line = promptAssistantStdoutBuffer.slice(0, index).trim();
    promptAssistantStdoutBuffer = promptAssistantStdoutBuffer.slice(index + 1);
    if (line) {
      try {
        const message = JSON.parse(line);
        if (message && message.id !== undefined && promptAssistantPending.has(message.id)) {
          const pending = promptAssistantPending.get(message.id);
          promptAssistantPending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.ok) pending.resolve(message.data);
          else {
            const error = new Error(message.error || message.message || "Prompt Assistant 推理失败");
            Object.assign(error, promptAssistantFailureMetadata(message));
            pending.reject(error);
          }
        }
      } catch (err) {
        promptAssistantLastError = `Prompt Assistant 输出解析失败：${String(err?.message || err)}`;
      }
    }
    index = promptAssistantStdoutBuffer.indexOf("\n");
  }
}

function logPromptAssistantStderrLine(clean) {
  if (!clean) return;
  try {
    const payload = JSON.parse(clean);
    if (payload && typeof payload === "object" && payload.event) {
      const eventName = String(payload.event || "");
      const commandName = String(payload.command || "");
      const ordinaryArtPromptPatch = eventName.startsWith("ordinary_art_prompt_patch")
        || commandName === "ordinaryArtPromptPatch";
      if (eventName.startsWith("reverse_") || ordinaryArtPromptPatch || eventName.startsWith("minimax_h3_") || commandName.startsWith("minimaxH3")) {
        appendLogLine(
          eventName.includes("error") ? "error" : "info",
          `prompt-assistant-service:${eventName}`,
          payload
        );
      }
    }
  } catch {}
}

async function ensurePromptAssistantProcess(options = {}) {
  if (promptAssistantStopPromise) await promptAssistantStopPromise;
  if (promptAssistantProcess && !promptAssistantProcess.killed) return Promise.resolve(promptAssistantProcess);
  if (promptAssistantStartPromise) return promptAssistantStartPromise;

  const config = getPromptAssistantConfig();
  const allowReverseOnly = options.allowReverseOnly === true;
  const canStart = config.enabled || (allowReverseOnly && config.reverseModelEnabled && config.serviceExists);
  if (!canStart) {
    return Promise.reject(new Error(config.error || "Prompt Assistant 未配置"));
  }

  promptAssistantStartPromise = new Promise((resolve, reject) => {
    let settled = false;
    let startupFailure = null;
    const settleOk = (proc) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(proc);
    };
    const settleFail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      promptAssistantStartPromise = null;
      reject(error);
    };

    const env = {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      NOVAFLOW_RUNTIME_JSON: getNovaFlowRuntimeJsonPath(),
      NOVAFLOW_COMFY_ROOT: path.join(String(config.runtimeConfig?.installPath || ""), "engine", "ComfyUI"),
      NOVAFLOW_PROMPT_ASSISTANT_MODEL_PATH: config.modelPath,
      NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH: config.reverseModelPath,
      NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_TYPE: config.reverseModelType,
      NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_PATH: config.reverseCachePath
    };
    const proc = spawn(config.pythonPath, [config.serviceScript], {
      cwd: path.dirname(config.serviceScript),
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    promptAssistantProcess = proc;
    promptAssistantStdoutBuffer = "";
    promptAssistantStderrLines = [];
    proc.__novaflowStartupStdoutBuffer = "";
    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (!settled) {
        proc.__novaflowStartupStdoutBuffer += text;
        const startupLines = proc.__novaflowStartupStdoutBuffer.split(/\r?\n/);
        proc.__novaflowStartupStdoutBuffer = startupLines.pop() || "";
        for (const line of startupLines) {
          try {
            const startup = JSON.parse(line.trim());
            if (startup?.type === "ready") {
              settleOk(proc);
              break;
            }
            if (startup?.type !== "startup-error") continue;
            const startupError = new Error(startup.error || "Prompt Assistant 启动失败");
            Object.assign(startupError, {
              errorCode: String(startup.errorCode || "prompt-assistant-startup-error").slice(0, 80),
              failureCategory: "resource_busy",
              retryable: true
            });
            startupFailure = startupError;
            settleFail(startupError);
            break;
          } catch {}
        }
      }
      handlePromptAssistantStdout(text);
    });
    proc.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      text.split(/\r?\n/).forEach((line) => {
        const clean = line.trim();
        if (clean) {
          promptAssistantStderrLines.push(clean);
          logPromptAssistantStderrLine(clean);
        }
      });
      if (promptAssistantStderrLines.length > 40) {
        promptAssistantStderrLines = promptAssistantStderrLines.slice(-40);
      }
    });
    proc.stdin.on("error", (err) => {
      if (promptAssistantProcess !== proc) return;
      promptAssistantLastError = `Prompt Assistant 请求管道已断开：${String(err?.message || err)}`;
      rejectPromptAssistantPending(promptAssistantLastError);
      if (!settled) settleFail(err);
      stopPromptAssistantServiceSync();
    });
    proc.once("error", (err) => {
      if (promptAssistantProcess !== proc) return;
      promptAssistantLastError = String(err?.message || err);
      promptAssistantProcess = null;
      rejectPromptAssistantPending(promptAssistantLastError);
      settleFail(err);
    });
    proc.once("exit", (code, signal) => {
      if (promptAssistantProcess && promptAssistantProcess !== proc) return;
      const intentionalStop = proc.__novaflowIntentionalStop === true;
      const detail = promptAssistantStderrLines.slice(-6).join("\n");
      const msg = `Prompt Assistant 服务已退出（code=${code ?? ""}, signal=${signal || ""}${detail ? `）：${detail}` : "）"}`;
      promptAssistantLastError = intentionalStop ? "" : msg;
      promptAssistantProcess = null;
      promptAssistantStartPromise = null;
      promptAssistantBusy = Boolean(promptAssistantRequestLease);
      if (!intentionalStop) rejectPromptAssistantPending(msg);
      if (!settled) {
        if (startupFailure) settleFail(startupFailure);
        else if (Number(code) === 73) {
          const alreadyRunning = new Error("Prompt Assistant 本地模型正在另一个 NovaFlow 实例中使用，请等待当前任务完成后重试");
          Object.assign(alreadyRunning, {
            errorCode: "prompt-assistant-already-running",
            failureCategory: "resource_busy",
            retryable: true
          });
          settleFail(alreadyRunning);
        } else settleFail(new Error(intentionalStop ? "Prompt Assistant 服务已关闭" : msg));
      }
    });

    const timer = setTimeout(() => {
      settleFail(new Error("Prompt Assistant 服务启动超时"));
    }, 12_000);
  });

  return promptAssistantStartPromise;
}

function isPromptAssistantStaticImageReverseRequest(command, payload = {}) {
  return command === "reverseImagePrompt"
    && String(payload?.purpose || "").trim() === "static-image-reverse";
}

function isPromptAssistantReverseCachePrepareRequest(command) {
  return command === "prepareReverseCache";
}

function isPromptAssistantMiniMaxH3ReverseRequest(command, payload = {}) {
  if (command !== "reverseImagePrompt") return false;
  const purpose = String(payload?.purpose || "").trim().toLowerCase().replace(/_/g, "-");
  return purpose === "minimax-h3-i2v-reverse" || purpose === "minimax-h3-fl2v-reverse";
}

async function stopPromptAssistantServiceWithVerifiedResult() {
  if (!promptAssistantProcess && !promptAssistantStopPromise) return "not-running";
  if (promptAssistantProcess) stopPromptAssistantServiceSync();
  const stopPromise = promptAssistantStopPromise;
  if (!stopPromise) return "not-running";
  const result = await stopPromise;
  return result === "stopped" ? "stopped" : "stop-timeout";
}

function promptAssistantLastSafeH3Stage() {
  for (let index = promptAssistantStderrLines.length - 1; index >= 0; index -= 1) {
    try {
      const payload = JSON.parse(String(promptAssistantStderrLines[index] || ""));
      const event = String(payload?.event || "");
      if (!/^minimax_h3_visual_contract_(?:start|bounded_stage|blocked|complete)$/.test(event)) continue;
      const stage = String(payload?.stage || payload?.outcome || event)
        .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
      if (stage) return stage;
    } catch {}
  }
  return "none";
}

function createPromptAssistantH3TimeoutError() {
  const error = new Error("MiniMax H3 local reverse timed out");
  Object.assign(error, {
    errorCode: "h3-local-timeout",
    failureCategory: "timeout",
    retryable: true,
    retryAttempted: false,
    legacyFallbackSuppressed: true,
    requestedVisualSchema: "nf.h3.visual.v1"
  });
  return error;
}

function promptAssistantLastSafeStaticReverseStage() {
  for (let index = promptAssistantStderrLines.length - 1; index >= 0; index -= 1) {
    try {
      const payload = JSON.parse(String(promptAssistantStderrLines[index] || ""));
      if (String(payload?.event || "") !== "reverse_local_stage") continue;
      const stage = String(payload?.stage || "")
        .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
      if (stage) return stage;
    } catch { void 0; }
  }
  return "none";
}

function createPromptAssistantStaticReverseTimeoutError() {
  const error = new Error("Prompt Assistant 推理超时");
  Object.assign(error, {
    errorCode: "static-image-local-timeout",
    failureCategory: "timeout",
    retryable: true,
    retryAttempted: false,
    legacyFallbackSuppressed: true,
    requestedVisualSchema: "nf.visual.v2"
  });
  return error;
}

function tracePromptAssistantStaticReverseLifecycle(event, metadata = {}) {
  const normalizedEvent = String(event || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "unknown";
  const cleanField = (value, maxLength) => String(value || "")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  const requestId = Number.isFinite(Number(metadata.requestId))
    ? Math.max(0, Math.trunc(Number(metadata.requestId)))
    : 0;
  const childPid = Number.isFinite(Number(metadata.childPid))
    ? Math.max(0, Math.trunc(Number(metadata.childPid)))
    : 0;
  const elapsedMs = Number.isFinite(Number(metadata.elapsedMs))
    ? Math.max(0, Math.min(1_800_000, Math.trunc(Number(metadata.elapsedMs))))
    : 0;
  const lastSafeStage = cleanField(metadata.lastSafeStage || "none", 80) || "none";
  const stopResult = cleanField(metadata.stopResult || "not-requested", 40) || "unknown";
  const runtimeState = cleanField(metadata.runtimeState, 80);
  const errorCode = cleanField(metadata.errorCode, 80);
  appendLogLine(normalizedEvent.includes("timeout") || metadata.ok === false ? "error" : "info", `prompt-assistant-static-reverse-${normalizedEvent}`, {
    elapsedMs,
    requestId,
    childPid,
    lastSafeStage,
    stopResult,
    ...(runtimeState ? { runtimeState } : {}),
    ...(Number.isFinite(Number(metadata.running)) ? { running: Math.max(0, Math.trunc(Number(metadata.running))) } : {}),
    ...(Number.isFinite(Number(metadata.pending)) ? { pending: Math.max(0, Math.trunc(Number(metadata.pending))) } : {}),
    ...(typeof metadata.released === "boolean" ? { released: metadata.released } : {}),
    ...(typeof metadata.ok === "boolean" ? { ok: metadata.ok } : {}),
    ...(errorCode ? { errorCode } : {})
  });
}

function promptAssistantResultFailureCodes(result) {
  const codes = [];
  const pushCode = (value) => {
    const code = String(value || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .trim()
      .slice(0, 120);
    if (code) codes.push(code);
  };
  const collect = (source) => {
    if (!source || typeof source !== "object") return;
    pushCode(source.errorCode);
    pushCode(source.contractFailureCode);
    pushCode(source.providerFailureCode);
    pushCode(source.failureCode);
    if (source.failure && typeof source.failure === "object") collect(source.failure);
  };
  collect(result);
  collect(result?.data);
  return Array.from(new Set(codes));
}

function isPromptAssistantReverseCachePreparationFailure(result) {
  const cacheCodes = new Set([
    "cache-preparation-required",
    "cache-invalid-rebuild-required"
  ]);
  return promptAssistantResultFailureCodes(result).some((code) => cacheCodes.has(code));
}

function tracePromptAssistantH3Lifecycle(event, metadata = {}) {
  const purpose = String(metadata.purpose || "")
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .slice(0, 40);
  const lastSafeStage = String(metadata.lastSafeStage || "none")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "none";
  const stopResult = String(metadata.stopResult || "not-requested")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "unknown";
  const requestId = Number.isFinite(Number(metadata.requestId)) ? Math.max(0, Math.trunc(Number(metadata.requestId))) : 0;
  const childPid = Number.isFinite(Number(metadata.childPid)) ? Math.max(0, Math.trunc(Number(metadata.childPid))) : 0;
  const elapsedMs = Number.isFinite(Number(metadata.elapsedMs)) ? Math.max(0, Math.min(1_800_000, Math.trunc(Number(metadata.elapsedMs)))) : 0;
  const cleanFailureField = (value, maxLength) => String(value || "")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
  const errorCode = cleanFailureField(metadata.errorCode, 80);
  const failureClass = cleanFailureField(metadata.failureClass, 80);
  const failureCategory = cleanFailureField(metadata.failureCategory, 48);
  const generationGate = cleanFailureField(metadata.generationGate, 32);
  appendLogLine(event === "timeout" ? "error" : "info", `prompt-assistant-h3-reverse-${event}`, {
    purpose,
    elapsedMs,
    requestId,
    childPid,
    lastSafeStage,
    stopResult,
    ...(typeof metadata.ok === "boolean" ? { ok: metadata.ok } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(failureClass ? { failureClass } : {}),
    ...(failureCategory ? { failureCategory } : {}),
    ...(generationGate ? { generationGate } : {}),
    ...(typeof metadata.sensitivePromptBlocked === "boolean"
      ? { sensitivePromptBlocked: metadata.sensitivePromptBlocked }
      : {})
  });
}

async function requestPromptAssistant(command, payload = {}, timeoutMs = 300_000, options = {}) {
  const config = getPromptAssistantConfig();
  const reverseCommand = command === "reverseImagePrompt";
  const staticImageReverseRequest = isPromptAssistantStaticImageReverseRequest(command, payload);
  const reverseCachePrepareRequest = isPromptAssistantReverseCachePrepareRequest(command);
  const miniMaxH3ReverseRequest = isPromptAssistantMiniMaxH3ReverseRequest(command, payload);
  const reverseModelOnlyRequest = staticImageReverseRequest || reverseCachePrepareRequest;
  const commandEnabled = config.serviceExists && (config.modelExists || (reverseModelOnlyRequest && config.reverseModelEnabled));
  if (!commandEnabled) {
    const error = config.serviceExists && reverseCommand && !staticImageReverseRequest && !config.modelExists
      ? "当前反推模式需要 Qwen2.5-VL 旧模型，但该模型未配置"
      : config.error;
    return { ok: false, ...config, enabled: false, error };
  }
  if (reverseCommand) promptAssistantLastWarning = "";
  const leaseRequired = command !== "status";
  if (leaseRequired && promptAssistantRequestLease) {
    return {
      ...config,
      ok: false,
      runtimeStatus: "推理中",
      error: "Prompt Assistant 正在处理另一项任务，请等待完成后重试",
      errorCode: "prompt-assistant-busy",
      failureCategory: "resource_busy",
      retryable: true
    };
  }
  const requestLease = leaseRequired
    ? { id: promptAssistantNextLeaseId++, command, acquiredAt: Date.now() }
    : null;
  if (requestLease) {
    promptAssistantRequestLease = requestLease;
    promptAssistantBusy = true;
  }

  let traceMeta = null;
  let h3TraceMeta = null;
  let staticReverseTraceMeta = null;
  let childStartAttempted = false;
  let verifiedCleanupResult = "not-requested";
  let effectiveTimeoutMs = Math.max(10_000, Number(timeoutMs) || 300_000);
  const startedAt = Date.now();
  try {
    if (typeof options.beforeEnsure === "function") {
      const preflight = await options.beforeEnsure();
      if (preflight?.ok === false) {
        return preflight.response && typeof preflight.response === "object"
          ? preflight.response
          : {
              ...config,
              ok: false,
              runtimeStatus: "资源准备失败",
              error: String(preflight?.error || "Prompt Assistant 资源准备失败"),
              errorCode: String(preflight?.errorCode || "prompt-assistant-preflight-failed"),
              retryable: true
            };
      }
      if (Number.isFinite(Number(preflight?.timeoutMs))) {
        effectiveTimeoutMs = Math.max(10_000, Number(preflight.timeoutMs));
      }
    }
    childStartAttempted = true;
    const proc = await ensurePromptAssistantProcess({ allowReverseOnly: reverseModelOnlyRequest });
    const requestId = promptAssistantNextRequestId++;
    h3TraceMeta = miniMaxH3ReverseRequest ? {
      purpose: String(payload?.purpose || ""),
      requestId,
      childPid: proc?.pid,
      lastSafeStage: "none"
    } : null;
    staticReverseTraceMeta = staticImageReverseRequest ? {
      requestId,
      childPid: proc?.pid,
      lastSafeStage: "none"
    } : null;
    if (staticReverseTraceMeta) {
      tracePromptAssistantStaticReverseLifecycle("start", {
        ...staticReverseTraceMeta,
        elapsedMs: Date.now() - startedAt,
        stopResult: "not-requested",
        ok: true
      });
    }
    if (h3TraceMeta) {
      tracePromptAssistantH3Lifecycle("start", {
        ...h3TraceMeta,
        elapsedMs: Date.now() - startedAt,
        stopResult: "not-requested"
      });
    }
    const data = await new Promise((resolve, reject) => {
      const timer = setTimeout(async () => {
        promptAssistantPending.delete(requestId);
        if (h3TraceMeta) {
          const stopResult = await stopPromptAssistantServiceWithVerifiedResult();
          tracePromptAssistantH3Lifecycle("timeout", {
            ...h3TraceMeta,
            elapsedMs: Date.now() - startedAt,
            lastSafeStage: promptAssistantLastSafeH3Stage(),
            stopResult
          });
          reject(createPromptAssistantH3TimeoutError());
          return;
        }
        if (staticReverseTraceMeta) {
          const stopResult = await stopPromptAssistantServiceWithVerifiedResult();
          tracePromptAssistantStaticReverseLifecycle("timeout", {
            ...staticReverseTraceMeta,
            elapsedMs: Date.now() - startedAt,
            lastSafeStage: promptAssistantLastSafeStaticReverseStage(),
            stopResult,
            errorCode: "static-image-local-timeout",
            ok: false
          });
          reject(createPromptAssistantStaticReverseTimeoutError());
          return;
        }
        stopPromptAssistantServiceSync();
        reject(new Error("Prompt Assistant 推理超时"));
      }, effectiveTimeoutMs);
      promptAssistantPending.set(requestId, { resolve, reject, timer });
      const failWrite = (error) => {
        if (!error) return;
        const pending = promptAssistantPending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        promptAssistantPending.delete(requestId);
        pending.reject(new Error(`Prompt Assistant 请求发送失败：${String(error.message || error)}`));
      };
      try {
        proc.stdin.write(JSON.stringify({ id: requestId, command, ...payload }) + "\n", failWrite);
      } catch (error) {
        failWrite(error);
      }
    });
    promptAssistantLastError = "";
    promptAssistantLastWarning = data?.reverseFallbackReason
      ? `图片反推已回退到 ${String(data?.reverseProvider || "legacy")}：${String(data.reverseFallbackReason)}`
      : "";
    if (h3TraceMeta) {
      const stopResult = await stopPromptAssistantServiceWithVerifiedResult();
      tracePromptAssistantH3Lifecycle("done", {
        ...h3TraceMeta,
        elapsedMs: Date.now() - startedAt,
        lastSafeStage: promptAssistantLastSafeH3Stage(),
        stopResult,
        ok: true
      });
    }
    if (staticReverseTraceMeta) {
      tracePromptAssistantStaticReverseLifecycle("inference-done", {
        ...staticReverseTraceMeta,
        elapsedMs: Date.now() - startedAt,
        lastSafeStage: promptAssistantLastSafeStaticReverseStage(),
        stopResult: "not-requested",
        ok: true
      });
    }
    if (traceMeta) {
      appendLogLine("info", "prompt-assistant-request-done", {
        ...traceMeta,
        elapsedMs: Date.now() - startedAt
      });
    }
    return {
      ...config,
      ok: true,
      runtimeStatus: "模型可用",
      warning: promptAssistantLastWarning,
      data
    };
  } catch (err) {
    promptAssistantLastError = String(err?.message || err);
    if (miniMaxH3ReverseRequest && err?.errorCode !== "h3-local-timeout") {
      const stopResult = await stopPromptAssistantServiceWithVerifiedResult();
      tracePromptAssistantH3Lifecycle("done", {
        ...(h3TraceMeta || { purpose: String(payload?.purpose || "") }),
        elapsedMs: Date.now() - startedAt,
        lastSafeStage: promptAssistantLastSafeH3Stage(),
        stopResult,
        ok: false,
        ...promptAssistantFailureMetadata(err)
      });
    }
    if (staticImageReverseRequest && err?.errorCode !== "static-image-local-timeout") {
      tracePromptAssistantStaticReverseLifecycle("inference-error", {
        ...(staticReverseTraceMeta || {}),
        elapsedMs: Date.now() - startedAt,
        lastSafeStage: promptAssistantLastSafeStaticReverseStage(),
        stopResult: "not-requested",
        errorCode: String(err?.errorCode || "prompt-assistant-error"),
        ok: false
      });
    }
    return {
      ...config,
      ok: false,
      runtimeStatus: "推理失败",
      error: promptAssistantLastError,
      ...promptAssistantFailureMetadata(err)
    };
  } finally {
    if (requestLease && options.verifiedCleanup === true && childStartAttempted) {
      if (staticImageReverseRequest) {
        tracePromptAssistantStaticReverseLifecycle("cleanup-start", {
          ...(staticReverseTraceMeta || {}),
          elapsedMs: Date.now() - startedAt,
          lastSafeStage: promptAssistantLastSafeStaticReverseStage(),
          stopResult: "not-requested",
          ok: true
        });
      }
      try {
        verifiedCleanupResult = await stopPromptAssistantServiceWithVerifiedResult();
      } catch {
        verifiedCleanupResult = "stop-error";
      }
      if (staticImageReverseRequest) {
        tracePromptAssistantStaticReverseLifecycle("cleanup-done", {
          ...(staticReverseTraceMeta || {}),
          elapsedMs: Date.now() - startedAt,
          lastSafeStage: promptAssistantLastSafeStaticReverseStage(),
          stopResult: verifiedCleanupResult,
          errorCode: verifiedCleanupResult === "stop-error" ? "prompt-assistant-stop-failed" : "",
          ok: !["stop-timeout", "stop-error"].includes(verifiedCleanupResult)
        });
      }
    }
    if (requestLease && promptAssistantRequestLease === requestLease) {
      promptAssistantRequestLease = null;
      promptAssistantBusy = false;
    }
    if (verifiedCleanupResult === "stop-timeout" || verifiedCleanupResult === "stop-error") {
      return {
        ...config,
        ok: false,
        runtimeStatus: "模型释放失败",
        error: "Prompt Assistant 推理已结束，但模型进程未能确认退出，请重试",
        errorCode: verifiedCleanupResult === "stop-timeout"
          ? "prompt-assistant-stop-timeout"
          : "prompt-assistant-stop-failed",
        failureCategory: "resource_cleanup",
        retryable: true
      };
    }
  }
}

async function probeNovaFlowRuntime(baseUrl, timeoutMs = 2500, externalSignal = null) {
  const target = sanitizeRuntimeBaseUrl(baseUrl || "");
  if (!target) return { ok: false, error: "invalid_base_url" };
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
  const timeout = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const res = await fetch(`${String(target).replace(/\/$/, "")}/system_stats`, { method: "GET", signal: controller.signal });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}`, raw: text };
    try {
      return { ok: true, status: res.status, data: JSON.parse(text) };
    } catch {
      return { ok: false, status: res.status, error: "invalid_json", raw: text };
    }
  } catch (err) {
    return { ok: false, error: String(err?.name === "AbortError" ? "timeout" : (err?.message || err)) };
  } finally {
    clearTimeout(timeout);
    try { externalSignal?.removeEventListener?.("abort", abortFromExternal); } catch { void 0; }
  }
}

async function requestNovaFlowRuntimeFreeMemory(baseUrl, timeoutMs = 30000) {
  const target = sanitizeRuntimeBaseUrl(baseUrl || "");
  if (!target) return { ok: false, error: "invalid_base_url" };
  const postFree = async (pathPart) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 30000));
    try {
      const res = await fetch(`${String(target).replace(/\/$/, "")}${pathPart}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
        signal: controller.signal
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text || null; }
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}`, data };
      return { ok: true, status: res.status, data };
    } catch (err) {
      return { ok: false, error: String(err?.name === "AbortError" ? "timeout" : (err?.message || err)) };
    } finally {
      clearTimeout(timeout);
    }
  };
  const first = await postFree("/free");
  if (first && first.status === 404) return await postFree("/api/free");
  return first;
}

async function inspectNovaFlowRuntimeQueue(baseUrl, timeoutMs = 2500) {
  const target = sanitizeRuntimeBaseUrl(baseUrl || "");
  if (!target) {
    return { ok: false, available: false, state: "unavailable", error: "invalid_base_url" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || 2500));
  try {
    const response = await fetch(`${String(target).replace(/\/$/, "")}/queue`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        available: true,
        state: "indeterminate",
        status: response.status,
        error: `HTTP ${response.status}`
      };
    }
    let data;
    try {
      data = JSON.parse(text || "{}");
    } catch {
      return { ok: false, available: true, state: "indeterminate", error: "invalid_queue_json" };
    }
    if (!Array.isArray(data?.queue_running) || !Array.isArray(data?.queue_pending)) {
      return { ok: false, available: true, state: "indeterminate", error: "invalid_queue_shape" };
    }
    const running = data.queue_running.length;
    const pending = data.queue_pending.length;
    return {
      ok: true,
      available: true,
      state: running > 0 || pending > 0 ? "busy" : "idle",
      running,
      pending
    };
  } catch (err) {
    const errorChain = [];
    const visitError = (value) => {
      if (!value || errorChain.includes(value)) return;
      errorChain.push(value);
      visitError(value.cause);
      if (Array.isArray(value.errors)) value.errors.forEach(visitError);
    };
    visitError(err);
    const refused = errorChain.some((value) => {
      const code = String(value?.code || "").toUpperCase();
      const message = String(value?.message || value || "").toLowerCase();
      return code === "ECONNREFUSED" || /(?:connection|actively) refused|拒绝连接/.test(message);
    });
    const timedOut = err?.name === "AbortError" || errorChain.some((value) => {
      const code = String(value?.code || "").toUpperCase();
      return code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT";
    });
    return {
      ok: false,
      available: false,
      state: refused && !timedOut ? "no-listener" : "indeterminate",
      noListener: refused && !timedOut,
      error: String(timedOut ? "timeout" : (err?.message || err)).slice(0, 160)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function prepareOrdinaryArtPromptPatchResourceHandoff(options = {}) {
  const runtimeConfig = readNovaFlowRuntimeConfig();
  const baseUrl = sanitizeRuntimeBaseUrl(runtimeConfig?.baseUrl || "")
    || `http://127.0.0.1:${NOVAFLOW_AI_RUNTIME_DEFAULT_PORT}`;
  const queueState = await inspectNovaFlowRuntimeQueue(baseUrl, options.queueTimeoutMs || 2500);
  const runtimePid = readNovaFlowRuntimePid(runtimeConfig);
  const runtimeProcessAlive = isProcessAlive(runtimePid);
  if (queueState.state === "no-listener" && !runtimeProcessAlive) {
    return {
      ok: true,
      state: "runtime-unavailable-independent",
      runtimeAvailable: false,
      released: false,
      error: String(queueState.error || "runtime_unavailable").slice(0, 160)
    };
  }
  if (!queueState.ok) {
    return {
      ok: false,
      state: "runtime-queue-indeterminate",
      runtimeAvailable: runtimeProcessAlive || queueState.available !== false,
      released: false,
      errorCode: "runtime-queue-indeterminate",
      error: runtimeProcessAlive
        ? "绘图 Runtime 进程仍在运行，但无法确认队列状态，请稍后重试"
        : "无法确认绘图队列状态，请稍后重试"
    };
  }
  if (queueState.state === "busy") {
    return {
      ok: false,
      state: "runtime-generation-busy",
      runtimeAvailable: true,
      released: false,
      running: queueState.running,
      pending: queueState.pending,
      errorCode: "runtime-generation-busy",
      error: "绘图模型正在生成或排队，请等待绘图完成后再优化提示词"
    };
  }
  const released = await requestNovaFlowRuntimeFreeMemory(baseUrl, options.freeTimeoutMs || 15000);
  if (!released?.ok) {
    return {
      ok: false,
      state: "runtime-memory-release-failed",
      runtimeAvailable: true,
      released: false,
      running: 0,
      pending: 0,
      errorCode: "runtime-memory-release-failed",
      error: "绘图模型显存释放失败，请稍后重试"
    };
  }
  const verifiedQueueState = await inspectNovaFlowRuntimeQueue(baseUrl, options.queueTimeoutMs || 2500);
  if (!verifiedQueueState.ok || verifiedQueueState.state !== "idle") {
    return {
      ok: false,
      state: "runtime-post-release-queue-not-idle",
      runtimeAvailable: verifiedQueueState.available !== false,
      released: true,
      running: Number(verifiedQueueState.running || 0),
      pending: Number(verifiedQueueState.pending || 0),
      errorCode: "runtime-post-release-queue-not-idle",
      error: "释放绘图模型后队列状态发生变化，请等待绘图完成后重试"
    };
  }
  return {
    ok: true,
    state: "runtime-memory-released",
    runtimeAvailable: true,
    released: true,
    running: 0,
    pending: 0
  };
}

async function waitForNovaFlowRuntimeReady(baseUrl, timeoutMs, signal = null, config = null) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted || novaFlowAppShuttingDown) {
      return { ok: false, error: "runtime_start_aborted", aborted: true };
    }
    const probe = await probeNovaFlowRuntime(baseUrl, 1800, signal);
    if (probe?.ok) return probe;
    if (config) {
      const pid = readNovaFlowRuntimePid(config);
      if (!pid || !isProcessAlive(pid)) {
        return { ok: false, error: "runtime_process_exited_early", pid };
      }
    }
    if (signal?.aborted || novaFlowAppShuttingDown) {
      return { ok: false, error: "runtime_start_aborted", aborted: true };
    }
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { signal?.removeEventListener?.("abort", onAbort); } catch { void 0; }
        resolve();
      };
      const onAbort = () => finish();
      const timer = setTimeout(finish, 650);
      if (signal?.aborted) finish();
      else signal?.addEventListener?.("abort", onAbort, { once: true });
    });
  }
  return { ok: false, error: "runtime_health_timeout" };
}

async function waitForNovaFlowRuntimeLaunchProcess(config, timeoutMs = 2500, signal = null) {
  const startedAt = Date.now();
  let lastIdentity = { alive: false, verified: true, runtime: false, pid: 0 };
  while (Date.now() - startedAt < Math.max(500, Number(timeoutMs) || 2500)) {
    if (signal?.aborted || novaFlowAppShuttingDown) {
      return { ...lastIdentity, aborted: true, error: "runtime_start_aborted" };
    }
    const pid = readNovaFlowRuntimePid(config);
    if (pid && isProcessAlive(pid)) {
      lastIdentity = await inspectNovaFlowRuntimeProcess(config);
      if (lastIdentity?.alive) return lastIdentity;
    } else {
      lastIdentity = { alive: false, verified: true, runtime: false, pid };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ...lastIdentity, error: lastIdentity?.error || "runtime_process_exited_early" };
}

async function getNovaFlowRuntimeStatus(options = {}) {
  const config = readNovaFlowRuntimeConfig();
  if (!config.installed || !config.ok) {
    novaFlowRuntimeLastStatus = { ...config, running: false, connected: false };
    return novaFlowRuntimeLastStatus;
  }
  if (options.probe === false) {
    novaFlowRuntimeLastStatus = { ...config, running: false, connected: false };
    return novaFlowRuntimeLastStatus;
  }
  const probe = await probeNovaFlowRuntime(config.baseUrl, Number(options.timeoutMs || 2500));
  const processRunning = probe?.ok ? true : isNovaFlowRuntimeProcessAlive(config);
  const status = {
    ...config,
    status: probe?.ok ? "running" : processRunning ? "starting" : "stopped",
    running: !!probe?.ok,
    connected: !!probe?.ok,
    processRunning,
    health: probe?.ok ? { ok: true } : { ok: false, error: probe?.error || "not_running", status: probe?.status || 0 },
    systemStats: probe?.ok ? probe.data : null
  };
  novaFlowRuntimeLastStatus = status;
  return status;
}

async function ensureNovaFlowRuntimeStarted(options = {}) {
  if (novaFlowAppShuttingDown) {
    return { ok: false, status: "stopped", running: false, connected: false, error: "app_shutting_down" };
  }
  if (novaFlowRuntimeStartPromise) return novaFlowRuntimeStartPromise;
  const scriptTimeoutMs = Math.max(1000, Number(options.scriptTimeoutMs) || NOVAFLOW_AI_RUNTIME_SCRIPT_TIMEOUT_MS);
  const readinessTimeoutMs = Math.max(1000, Number(options.timeoutMs) || NOVAFLOW_AI_RUNTIME_START_TIMEOUT_MS);
  const lockTimeoutMs = Math.max(1000, Number(options.lockTimeoutMs) || (scriptTimeoutMs + readinessTimeoutMs) * 2 + 20_000);
  const startAbortController = new AbortController();
  novaFlowRuntimeStartAbortController = startAbortController;
  const startSignal = startAbortController.signal;
  const startPromise = (async () => {
    const config = readNovaFlowRuntimeConfig();
    if (!config.installed || !config.ok) {
      novaFlowRuntimeLastStatus = { ...config, running: false, connected: false };
      return novaFlowRuntimeLastStatus;
    }

    if (startSignal.aborted || novaFlowAppShuttingDown) {
      return { ...config, ok: false, status: "stopped", running: false, connected: false, error: "runtime_start_aborted" };
    }
    const current = await getNovaFlowRuntimeStatus({ timeoutMs: 1500 });
    if (current?.running) return { ...current, reused: true };
    try {
      return await novaFlowRuntimeStartCoordinator.withStartLock(config.generatedPath, async (startLock) => {
        if (startSignal.aborted || novaFlowAppShuttingDown) {
          return { ...config, ok: false, status: "stopped", running: false, connected: false, error: "runtime_start_aborted" };
        }
        const lockedCurrent = await getNovaFlowRuntimeStatus({ timeoutMs: 1500 });
        if (lockedCurrent?.running) return { ...lockedCurrent, reused: true };
        if (startSignal.aborted || novaFlowAppShuttingDown) {
          return { ...config, ok: false, status: "stopped", running: false, connected: false, error: "runtime_start_aborted" };
        }

        if (!fs.existsSync(config.startScriptPath)) {
          const failed = { ...config, ok: false, status: "error", running: false, connected: false, error: "start_script_missing" };
          novaFlowRuntimeLastStatus = failed;
          return failed;
        }

        ensureNovaFlowSeeThroughHeadNode(config);
        appendLogLine("info", "novaflow-runtime-start", { source: options.source || "", scriptPath: config.startScriptPath, baseUrl: config.baseUrl });
        const starting = { ...config, ok: true, status: "starting", running: false, connected: false, processRunning: isNovaFlowRuntimeProcessAlive(config), reused: false, health: { ok: false, error: "starting" }, error: "" };
        novaFlowRuntimeLastStatus = starting;
        broadcastNovaFlowRuntimeStatus(starting);
        let started = null;
        let ready = null;
        let launchIdentity = null;
        let attemptCount = 0;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          if (startSignal.aborted || novaFlowAppShuttingDown) {
            ready = { ok: false, aborted: true, error: "runtime_start_aborted" };
            break;
          }
          attemptCount = attempt;
          startLock.assertOwned();
          appendLogLine("info", "novaflow-runtime-start-attempt", { source: options.source || "", attempt, baseUrl: config.baseUrl });
          started = await runCmd("cmd.exe", ["/c", config.startScriptPath], {
            cwd: path.dirname(config.startScriptPath),
            env: getNovaFlowRuntimeScriptEnv(config),
            timeoutMs: scriptTimeoutMs,
            signal: startSignal,
            killTreeOnAbort: true
          });
          startLock.assertOwned();
          launchIdentity = await waitForNovaFlowRuntimeLaunchProcess(config, 2500, startSignal);
          const launchInvalid = !launchIdentity?.alive || (launchIdentity?.verified === true && launchIdentity?.runtime !== true);
          if (!launchInvalid) {
            ready = await waitForNovaFlowRuntimeReady(config.baseUrl, readinessTimeoutMs, startSignal, config);
          } else {
            const finalProbe = await probeNovaFlowRuntime(config.baseUrl, 1800, startSignal);
            ready = finalProbe?.ok ? finalProbe : { ok: false, error: launchIdentity?.error || finalProbe?.error || "runtime_process_exited_early" };
          }
          const abortedAttempt = startSignal.aborted || started?.aborted || ready?.aborted || novaFlowAppShuttingDown;
          if (ready?.ok || abortedAttempt) break;
          const completedIdentity = ready?.ok ? launchIdentity : await inspectNovaFlowRuntimeProcess(config);
          const retryableFailure = (
            !completedIdentity?.alive
            || (completedIdentity?.verified === true && completedIdentity?.runtime !== true)
          ) && started?.terminationVerified !== false && started?.timedOut !== true;
          if (!retryableFailure || attempt >= 2) break;
          startLock.assertOwned();
          const stalePid = Number(completedIdentity?.pid || launchIdentity?.pid || readNovaFlowRuntimePid(config)) || 0;
          if (stalePid) removeStaleNovaFlowRuntimePid(config, stalePid);
          appendLogLine("warn", "novaflow-runtime-start-retry", {
            source: options.source || "",
            attempt,
            baseUrl: config.baseUrl,
            scriptCode: started?.code || 0,
            error: trimReturnedText(started?.stderr || started?.stdout || started?.error || "") || ready?.error || "runtime_process_exited_early"
          });
          await new Promise((resolve) => setTimeout(resolve, 650));
        }
        const processRunning = ready?.ok ? true : isNovaFlowRuntimeProcessAlive(config);
        const aborted = startSignal.aborted || started?.aborted || ready?.aborted || novaFlowAppShuttingDown;
        const stillStarting = !aborted && !ready?.ok && processRunning && (started?.ok || started?.timedOut);
        const status = {
          ...config,
          ok: !!ready?.ok || stillStarting,
          status: ready?.ok ? "running" : stillStarting ? "starting" : aborted ? "stopped" : "error",
          running: !!ready?.ok,
          connected: !!ready?.ok,
          processRunning,
          reused: false,
          script: { ok: !!started?.ok, code: started?.code || 0, timedOut: !!started?.timedOut, aborted: !!started?.aborted, terminationVerified: started?.terminationVerified !== false, stdout: trimReturnedText(started?.stdout || ""), stderr: trimReturnedText(started?.stderr || "") },
          attempts: attemptCount,
          health: ready?.ok ? { ok: true } : { ok: false, error: aborted ? "runtime_start_aborted" : stillStarting ? "runtime_still_starting" : (ready?.error || "runtime_health_timeout") },
          error: ready?.ok || stillStarting ? "" : aborted ? "runtime_start_aborted" : (ready?.error || started?.stderr || started?.stdout || started?.error || "runtime_start_failed")
        };
        appendLogLine(status.status === "error" ? "error" : "info", status.status === "running" ? "novaflow-runtime-started" : status.status === "starting" ? "novaflow-runtime-starting" : aborted ? "novaflow-runtime-start-aborted" : "novaflow-runtime-start-failed", {
          baseUrl: status.baseUrl,
          attempts: status.attempts,
          scriptCode: status.script.code,
          scriptTimedOut: status.script.timedOut,
          scriptAborted: status.script.aborted,
          error: status.error || ""
        });
        novaFlowRuntimeLastStatus = status;
        broadcastNovaFlowRuntimeStatus(status);
        return status;
      }, {
        timeoutMs: lockTimeoutMs,
        signal: startSignal
      });
    } catch (error) {
      if (error?.code === "NOVAFLOW_RUNTIME_START_ABORTED" || startSignal.aborted || novaFlowAppShuttingDown) {
        const aborted = { ...config, ok: false, status: "stopped", running: false, connected: false, error: "runtime_start_aborted" };
        novaFlowRuntimeLastStatus = aborted;
        return aborted;
      }
      throw error;
    }
  })();
  novaFlowRuntimeStartPromise = startPromise;
  try {
    return await startPromise;
  } finally {
    if (novaFlowRuntimeStartPromise === startPromise) novaFlowRuntimeStartPromise = null;
    if (novaFlowRuntimeStartAbortController === startAbortController) novaFlowRuntimeStartAbortController = null;
  }
}

async function stopNovaFlowRuntime(options = {}) {
  const config = readNovaFlowRuntimeConfig();
  if (!config.installed || !config.ok) return { ...config, running: false, connected: false, stopped: false };
  if (!fs.existsSync(config.stopScriptPath)) {
    return { ...config, ok: false, status: "error", running: false, connected: false, stopped: false, error: "stop_script_missing" };
  }
  appendLogLine("info", "novaflow-runtime-stop", { source: options.source || "", scriptPath: config.stopScriptPath, baseUrl: config.baseUrl });
  const stopped = await runCmd("cmd.exe", ["/c", config.stopScriptPath], {
    cwd: path.dirname(config.stopScriptPath),
    env: getNovaFlowRuntimeScriptEnv(config),
    timeoutMs: Number(options.scriptTimeoutMs || NOVAFLOW_AI_RUNTIME_SCRIPT_TIMEOUT_MS),
    killTreeOnTimeout: options.killTreeOnTimeout === true,
    allowDuringShutdown: options.allowDuringShutdown === true
  });
  const start = Date.now();
  let released = false;
  while (Date.now() - start < Number(options.timeoutMs || NOVAFLOW_AI_RUNTIME_STOP_TIMEOUT_MS)) {
    const listening = await isTcpPortListening(config.port, "127.0.0.1", 700);
    if (!listening) {
      released = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const status = {
    ...config,
    ok: !!stopped?.ok && released,
    status: released ? "stopped" : "error",
    running: !released,
    connected: !released,
    stopped: released,
    processRunning: !released && isNovaFlowRuntimeProcessAlive(config),
    script: { ok: !!stopped?.ok, code: stopped?.code || 0, timedOut: !!stopped?.timedOut, terminationVerified: stopped?.terminationVerified !== false, stdout: trimReturnedText(stopped?.stdout || ""), stderr: trimReturnedText(stopped?.stderr || "") },
    error: released ? "" : (stopped?.error || "runtime_port_still_listening")
  };
  appendLogLine(status.ok ? "info" : "error", status.ok ? "novaflow-runtime-stopped" : "novaflow-runtime-stop-failed", {
    baseUrl: status.baseUrl,
    scriptCode: status.script.code,
    scriptTimedOut: status.script.timedOut,
    released,
    error: status.error || ""
  });
  novaFlowRuntimeLastStatus = status;
  broadcastNovaFlowRuntimeStatus(status);
  return status;
}

function getNovaFlowRuntimeInputDir() {
  const config = readNovaFlowRuntimeConfig();
  if (!config.installed || !config.ok || !config.inputPath) return "";
  return config.inputPath;
}

function getNovaFlowRuntimeOutputDir() {
  const config = readNovaFlowRuntimeConfig();
  if (config.installed && config.ok && config.outputPath) return config.outputPath;
  return path.join(getNovaFlowRuntimeGeneratedDir(), "output");
}

async function waitForNovaFlowRuntimeStartToSettle(timeoutMs = 4500) {
  const pending = novaFlowRuntimeStartPromise;
  if (!pending) return true;
  let timer = null;
  const settled = await Promise.race([
    Promise.resolve(pending).then(() => true, () => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), Math.max(100, Number(timeoutMs) || 4500)); })
  ]);
  if (timer) clearTimeout(timer);
  return settled && !novaFlowRuntimeStartPromise;
}

function isSafeNovaFlowRuntimeGeneratedRoot(generatedPath) {
  const generatedRoot = path.resolve(String(generatedPath || ""));
  if (!generatedRoot || generatedRoot === path.parse(generatedRoot).root) return false;
  const managedRoot = path.resolve(NOVAFLOW_AI_RUNTIME_GENERATED_DIR);
  if (generatedRoot.toLowerCase() !== managedRoot.toLowerCase()) return false;
  const tempRoot = path.resolve(os.tmpdir());
  const relative = path.relative(tempRoot, generatedRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  let current = tempRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return false;
    } catch (error) {
      if (error?.code !== "ENOENT") return false;
      break;
    }
  }
  try {
    if (fs.existsSync(generatedRoot)) {
      const realTempRoot = fs.realpathSync.native(tempRoot);
      const realGeneratedRoot = fs.realpathSync.native(generatedRoot);
      if (!isSameOrInsidePath(realGeneratedRoot, realTempRoot)) return false;
    }
  } catch {
    return false;
  }
  return true;
}

function isSafeNovaFlowRuntimeDirectChild(targetPath, generatedPath) {
  const generatedRoot = path.resolve(String(generatedPath || ""));
  const target = path.resolve(String(targetPath || ""));
  if (!isSafeNovaFlowRuntimeGeneratedRoot(generatedRoot) || path.dirname(target).toLowerCase() !== generatedRoot.toLowerCase()) return false;
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return false;
    const realRoot = fs.realpathSync.native(generatedRoot);
    const realTarget = fs.realpathSync.native(target);
    return path.dirname(realTarget).toLowerCase() === realRoot.toLowerCase();
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

function isNovaFlowRuntimeQuarantineName(name) {
  return /^\.novaflow-cleanup-\d+-\d+-[a-f0-9]+-(input|output|temp-root)$/i.test(String(name || ""));
}

function listNovaFlowRuntimeQuarantineDirs(generatedPath) {
  const generatedRoot = path.resolve(String(generatedPath || ""));
  if (!isSafeNovaFlowRuntimeGeneratedRoot(generatedRoot)) return [];
  try {
    return fs.readdirSync(generatedRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isNovaFlowRuntimeQuarantineName(entry.name))
      .map((entry) => path.join(generatedRoot, entry.name));
  } catch {
    return [];
  }
}

async function quarantineNovaFlowRuntimeTransientDir(generatedPath, childName, source) {
  const generatedRoot = path.resolve(String(generatedPath || ""));
  const allowed = new Set(["input", "output", "temp-root"]);
  if (!isSafeNovaFlowRuntimeGeneratedRoot(generatedRoot) || !allowed.has(childName)) {
    return { ok: false, error: "runtime_temp_target_not_allowed" };
  }
  const target = path.resolve(generatedRoot, childName);
  if (path.dirname(target).toLowerCase() !== generatedRoot.toLowerCase() || path.basename(target) !== childName) {
    return { ok: false, error: "runtime_temp_target_outside_generated_root" };
  }
  if (!fs.existsSync(target)) return { ok: true, target, missing: true, quarantinePath: "" };
  if (!isSafeNovaFlowRuntimeDirectChild(target, generatedRoot)) {
    return { ok: false, error: "runtime_temp_target_reparse_point", target };
  }
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const quarantineName = `.novaflow-cleanup-${process.pid}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}-${childName}`;
    const quarantinePath = path.join(generatedRoot, quarantineName);
    try {
      await fs.promises.rename(target, quarantinePath);
      appendLogLine("info", "novaflow-runtime-transient-quarantined", { source, childName, target, quarantinePath, attempts: attempt + 1 });
      return { ok: true, target, quarantinePath, attempts: attempt + 1 };
    } catch (error) {
      if (error?.code === "ENOENT") return { ok: true, target, missing: true, quarantinePath: "" };
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
    }
  }
  const error = String(lastError?.message || lastError || "runtime_temp_quarantine_failed");
  appendLogLine("warn", "novaflow-runtime-transient-quarantine-failed", { source, childName, target, error });
  return { ok: false, target, error };
}

async function cleanupNovaFlowRuntimeQuarantineDirs(generatedPath, requestedPaths, source) {
  const generatedRoot = path.resolve(String(generatedPath || ""));
  if (!isSafeNovaFlowRuntimeGeneratedRoot(generatedRoot)) {
    return { ok: false, error: "runtime_generated_root_not_managed", cleanupResults: [] };
  }
  const targets = Array.from(new Set([
    ...listNovaFlowRuntimeQuarantineDirs(generatedRoot),
    ...(Array.isArray(requestedPaths) ? requestedPaths : [])
  ].map((item) => path.resolve(String(item || ""))))).filter((target) => (
    path.dirname(target).toLowerCase() === generatedRoot.toLowerCase()
    && isNovaFlowRuntimeQuarantineName(path.basename(target))
  ));
  const cleanupResults = [];
  for (const target of targets) {
    if (!isSafeNovaFlowRuntimeDirectChild(target, generatedRoot)) {
      cleanupResults.push({ ok: false, target, error: "runtime_quarantine_target_reparse_point" });
      continue;
    }
    let lastError = null;
    let removed = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 0 });
        cleanupResults.push({ ok: true, target, attempts: attempt + 1 });
        appendLogLine("info", "novaflow-runtime-quarantine-cleaned", { source, target, attempts: attempt + 1 });
        removed = true;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    if (!removed) {
      const error = String(lastError?.message || lastError || "runtime_quarantine_cleanup_failed");
      cleanupResults.push({ ok: false, target, error });
      appendLogLine("warn", "novaflow-runtime-quarantine-cleanup-failed", { source, target, error });
    }
  }
  return { ok: cleanupResults.every((item) => item.ok), cleanupResults };
}

async function stopAndClearNovaFlowRuntimeTransientData(source) {
  try { novaFlowRuntimeStartAbortController?.abort(); } catch { void 0; }
  if (!(await waitForNovaFlowRuntimeStartToSettle(4500))) {
    return { ok: false, error: "runtime_start_still_in_progress" };
  }
  const config = readNovaFlowRuntimeConfig();
  const port = normalizeRuntimePort(config?.port);
  const generatedPath = path.resolve(String(config?.generatedPath || getNovaFlowRuntimeGeneratedDir()));
  const managedGeneratedPath = isSafeNovaFlowRuntimeGeneratedRoot(generatedPath);
  const coordinationAllowed = generatedPath !== path.parse(generatedPath).root
    && path.basename(generatedPath).toLowerCase() === "runtime-generated";
  if (!coordinationAllowed) {
    return { ok: true, cleanupSkipped: true, reason: "runtime_generated_root_not_managed", port, generatedPath };
  }
  try {
    return await novaFlowRuntimeStartCoordinator.withStartLock(generatedPath, async (startLock) => {
      if (novaFlowRuntimeStartPromise) {
        return { ok: false, error: "runtime_start_still_in_progress", port, generatedPath };
      }
      const inspectBlockingRuntimeProcess = async () => {
        const identity = await inspectNovaFlowRuntimeProcess(config);
        if (identity.alive && identity.verified && !identity.runtime) {
          removeStaleNovaFlowRuntimePid(config, identity.pid);
          return { ...identity, alive: false, stalePidRemoved: true };
        }
        return identity;
      };
      let listening = await isTcpPortListening(port, "127.0.0.1", 700);
      let processIdentity = await inspectBlockingRuntimeProcess();
      let processRunning = processIdentity.alive;
      if (processRunning && !listening) {
        const settleDeadline = Date.now() + 4000;
        while (Date.now() < settleDeadline && processRunning && !listening) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          listening = await isTcpPortListening(port, "127.0.0.1", 700);
          processIdentity = await inspectBlockingRuntimeProcess();
          processRunning = processIdentity.alive;
        }
        if (processRunning && !listening) {
          return { ok: false, error: "runtime_process_still_starting", port, generatedPath, processIdentity };
        }
      }
      let stopResult = null;
      if (listening) {
        if (!config.installed || !config.ok || !fs.existsSync(config.stopScriptPath || "")) {
          return { ok: false, error: "runtime_listener_ownership_unavailable", port, generatedPath };
        }
        startLock.assertOwned();
        stopResult = await stopNovaFlowRuntime({
          source,
          scriptTimeoutMs: 4000,
          timeoutMs: 2500,
          killTreeOnTimeout: true,
          allowDuringShutdown: true
        });
        startLock.assertOwned();
        if (stopResult?.script?.terminationVerified === false) {
          return { ok: false, error: "runtime_stop_command_not_terminated", port, generatedPath, stopResult };
        }
      }
      listening = await isTcpPortListening(port, "127.0.0.1", 700);
      processIdentity = await inspectBlockingRuntimeProcess();
      processRunning = processIdentity.alive;
      if (!listening && processRunning && stopResult) {
        const processExitDeadline = Date.now() + 2200;
        while (Date.now() < processExitDeadline && processRunning) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          processIdentity = await inspectBlockingRuntimeProcess();
          processRunning = processIdentity.alive;
        }
      }
      if (listening || processRunning) {
        return {
          ok: false,
          error: listening ? (stopResult?.error || "runtime_port_still_listening") : "runtime_process_still_alive",
          port,
          generatedPath,
          stopResult,
          processIdentity
        };
      }
      if (!managedGeneratedPath) {
        return {
          ok: true,
          cleanupSkipped: true,
          reason: "runtime_generated_root_not_managed",
          port,
          generatedPath,
          stopResult,
          quarantineResults: [],
          quarantinePaths: []
        };
      }
      const quarantineResults = [];
      for (const childName of ["input", "output", "temp-root"]) {
        startLock.assertOwned();
        quarantineResults.push(await quarantineNovaFlowRuntimeTransientDir(generatedPath, childName, source));
      }
      const quarantinePaths = Array.from(new Set([
        ...listNovaFlowRuntimeQuarantineDirs(generatedPath),
        ...quarantineResults.map((item) => item.quarantinePath).filter(Boolean)
      ]));
      return {
        ok: quarantineResults.every((item) => item.ok),
        port,
        generatedPath,
        stopResult,
        quarantineResults,
        quarantinePaths
      };
    }, { timeoutMs: 15_000 });
  } catch (error) {
    return {
      ok: false,
      error: error?.code === "NOVAFLOW_RUNTIME_START_LOCK_TIMEOUT" ? "runtime_lifecycle_lock_timeout" : String(error?.message || error),
      port,
      generatedPath
    };
  }
}

async function cleanupNovaFlowLastOwnerData(source) {
  const unmanagedClients = await scanOtherNovaFlowMainProcesses();
  if (!unmanagedClients.ok || unmanagedClients.processes.length > 0) {
    const result = {
      ok: false,
      error: unmanagedClients.ok ? "unregistered_novaflow_client_alive" : "novaflow_client_scan_failed",
      unmanagedClients
    };
    appendLogLine("warn", "novaflow-last-owner-temp-cleanup-skipped", { source, result });
    return result;
  }
  const runtime = await stopAndClearNovaFlowRuntimeTransientData(source);
  const result = { ok: runtime.ok, runtime, unmanagedClients };
  appendLogLine(result.ok ? "info" : "warn", "novaflow-last-owner-temp-cleanup", { source, result });
  return result;
}

function scheduleNovaFlowLegacyTempMigration() {
  if (novaFlowLegacyMigrationPromise || novaFlowAppShuttingDown) return novaFlowLegacyMigrationPromise;
  novaFlowLegacyMigrationPromise = (async () => {
    const lifecycle = getNovaFlowTempSessionLifecycle();
    for (let batchIndex = 0; batchIndex < 20 && !novaFlowAppShuttingDown; batchIndex += 1) {
      const preflight = await scanOtherNovaFlowMainProcesses();
      if (!preflight.ok || preflight.processes.length > 0) {
        appendLogLine("info", "legacy-temp-migration-skipped", {
          reason: preflight.ok ? "another_novaflow_client_alive" : "process_scan_failed",
          processes: preflight.processes,
          error: preflight.error || ""
        });
        break;
      }
      let batch = null;
      try {
        batch = await lifecycle.withLifecycleLock(async () => {
          const lockedPreflight = await scanOtherNovaFlowMainProcesses();
          if (!lockedPreflight.ok || lockedPreflight.processes.length > 0) {
            return { skipped: true, preflight: lockedPreflight };
          }
          const temp = await lifecycle.cleanupLegacyArtifacts({
            minAgeMs: 10 * 60 * 1000,
            maxEntries: 350,
            timeBudgetMs: 2500
          });
          const diagnostics = batchIndex === 0
            ? await lifecycle.cleanupLegacyArtifacts({
              legacyRoot: app.getPath("userData"),
              exactDirs: ["ai-seq-debug"],
              prefixes: [],
              minAgeMs: 0,
              maxEntries: 1,
              timeBudgetMs: 2500
            })
            : { ok: true, truncated: false, removed: 0, failed: 0 };
          return { skipped: false, temp, diagnostics };
        }, { timeoutMs: 10_000 });
      } catch (error) {
        appendLogLine("warn", "legacy-temp-migration-failed", { batchIndex, error: String(error?.message || error) });
        break;
      }
      if (!batch || batch.skipped || (!batch.temp?.truncated && !batch.diagnostics?.truncated)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })().finally(() => {
    novaFlowLegacyMigrationPromise = null;
  });
  return novaFlowLegacyMigrationPromise;
}

async function runNovaFlowGracefulQuit(reason) {
  const source = String(reason || "before-quit");
  videoResourceMediaService.closeAll();
  const miniMaxH3RuntimeStopPromise = Promise.resolve()
    .then(() => miniMaxH3RuntimeLifecycle.stop({ timeoutMs: 20_000, scriptTimeoutMs: 30_000 }))
    .catch((error) => ({ ok: false, stopped: false, error: String(error?.message || error) }));
  const firstCommandTermination = await terminateNovaFlowCommandChildrenForShutdown();
  const tempJobs = await waitForNovaFlowTempJobsToSettle(8000);
  const finalCommandTermination = await terminateNovaFlowCommandChildrenForShutdown();
  const miniMaxH3Runtime = await miniMaxH3RuntimeStopPromise;
  const commandTermination = {
    ok: finalCommandTermination.ok,
    attempted: firstCommandTermination.attempted + finalCommandTermination.attempted,
    failedAttempts: firstCommandTermination.failedAttempts + finalCommandTermination.failedAttempts,
    remaining: finalCommandTermination.remaining
  };
  if (!commandTermination.ok) {
    appendLogLine("warn", "temp-command-termination-incomplete", { source, commandTermination });
  }
  if (!tempJobs.ok) {
    appendLogLine("warn", "temp-jobs-settle-timeout", { source, tempJobs });
  }
  if (miniMaxH3Runtime?.installed && !miniMaxH3Runtime?.stopped) {
    appendLogLine("warn", "minimax-h3-runtime-stop-incomplete", { source, miniMaxH3Runtime });
  }
  const cleanupAllowed = commandTermination.ok && tempJobs.ok;
  let lifecycleResult = null;
  let quarantineCleanup = null;
  if (novaFlowTempSessionRegistered) {
    lifecycleResult = await getNovaFlowTempSessionLifecycle().close({
      skipSessionCleanup: !cleanupAllowed,
      onLastOwner: cleanupAllowed
        ? () => cleanupNovaFlowLastOwnerData(`last-owner-${source}`)
        : async () => ({ ok: false, error: "active_temp_work_not_stopped", commandTermination, tempJobs }),
      lockOptions: { timeoutMs: 15_000 }
    });
    novaFlowTempSessionRegistered = false;
    const runtimeResult = lifecycleResult?.lastOwnerResult?.runtime;
    if (runtimeResult?.generatedPath && Array.isArray(runtimeResult.quarantinePaths)) {
      quarantineCleanup = await cleanupNovaFlowRuntimeQuarantineDirs(
        runtimeResult.generatedPath,
        runtimeResult.quarantinePaths,
        `last-owner-${source}`
      );
      if (!quarantineCleanup.ok) {
        try {
          getNovaFlowTempSessionLifecycle().markCleanupPending("runtime_quarantine_cleanup_failed", { quarantineCleanup });
        } catch { void 0; }
      }
    }
  }
  return {
    ok: cleanupAllowed && (!lifecycleResult || lifecycleResult.ok) && (!quarantineCleanup || quarantineCleanup.ok),
    commandTermination,
    tempJobs,
    miniMaxH3Runtime,
    lifecycleResult,
    quarantineCleanup
  };
}

function requestNovaFlowGracefulQuit(reason) {
  if (novaFlowAllowFinalQuit) {
    app.quit();
    return novaFlowGracefulQuitPromise;
  }
  if (novaFlowGracefulQuitPromise) return novaFlowGracefulQuitPromise;
  novaFlowQuitReason = String(reason || "before-quit");
  novaFlowAppShuttingDown = true;
  novaFlowGracefulQuitPromise = Promise.resolve()
    .then(() => runNovaFlowGracefulQuit(novaFlowQuitReason))
    .catch((error) => {
      appendLogLine("error", "novaflow-graceful-quit-failed", { reason: novaFlowQuitReason, error: String(error?.message || error) });
      try { getNovaFlowTempSessionLifecycle().markCleanupPending("graceful_quit_failed", { error: String(error?.message || error) }); } catch { void 0; }
      return { ok: false, error: String(error?.message || error) };
    })
    .finally(() => {
      novaFlowAllowFinalQuit = true;
      setImmediate(() => app.quit());
    });
  try {
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        win.hide();
        if (!win.isDestroyed()) win.destroy();
      } catch { void 0; }
    });
  } catch { void 0; }
  try { novaFlowTempJobsAbortController.abort(); } catch { void 0; }
  try { novaFlowRuntimeStartAbortController?.abort(); } catch { void 0; }
  electronProfileConsole("final-snapshot", snapshotElectronProfile());
  stopElectronProfileConsoleReporter();
  stopNovaFlowAdminServer(novaFlowQuitReason);
  stopPromptAssistantServiceSync();
  stopSystemMouseHelper();
  return novaFlowGracefulQuitPromise;
}

function isSameOrInsidePath(targetPath, protectedPath) {
  const target = path.resolve(String(targetPath || ""));
  const protectedRoot = path.resolve(String(protectedPath || ""));
  if (!target || !protectedRoot) return false;
  const relative = path.relative(protectedRoot, target);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertNovaFlowRuntimeReleaseMemoryFileTargetsSafe(targets) {
  const protectedOutputPath = getNovaFlowRuntimeOutputDir();
  const list = Array.isArray(targets) ? targets : [];
  for (const target of list) {
    if (isSameOrInsidePath(target, protectedOutputPath)) {
      throw new Error(`${NOVAFLOW_RUNTIME_RELEASE_MEMORY_PROTECTED_RELATIVE_OUTPUT} is protected from memory release cleanup`);
    }
  }
}

async function ensureNovaFlowRuntimeForBaseUrl(baseUrl, source) {
  const config = readNovaFlowRuntimeConfig();
  if (!config.installed || !config.ok || config.baseUrl !== baseUrl) return null;
  const status = await ensureNovaFlowRuntimeStarted({ source: source || "request", timeoutMs: NOVAFLOW_AI_RUNTIME_START_TIMEOUT_MS });
  if (status?.running || status?.connected) return status;
  return { ok: false, error: status?.error || "runtime_not_ready", runtime: status };
}

function getNovaFlowRuntimeOpenTarget(kind) {
  const config = readNovaFlowRuntimeConfig();
  if (!config.installed || !config.ok) return { ok: false, error: "runtime_not_installed", config };
  const target = kind === "logs" ? config.logsPath : kind === "assets" ? config.assetsPath : config.installPath;
  if (!target) return { ok: false, error: "runtime_path_missing", config };
  return { ok: true, target, config };
}

function makeUniqueChildDir(parentDir, preferredName) {
  const baseName = sanitizeFileStem(preferredName, "spine_split_export");
  const first = path.join(parentDir, baseName);
  if (!fs.existsSync(first)) return first;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  for (let i = 0; i < 100; i += 1) {
    const suffix = i === 0 ? stamp : `${stamp}_${i + 1}`;
    const candidate = path.join(parentDir, `${baseName}_${suffix}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(parentDir, `${baseName}_${Date.now()}`);
}

function escapeHtmlText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveExternalBrowserExecutable() {
  const explicit = String(process.env.NF_ELECTRON_EXTERNAL_BROWSER_PATH || getProcessSwitchValue("nf-electron-external-browser-path") || "").trim();
  if (explicit && fs.existsSync(explicit)) return explicit;
  if (process.platform !== "win32") return "";
  const env = process.env || {};
  const candidates = [
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    env["PROGRAMFILES(X86)"] && path.join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    env.PROGRAMFILES && path.join(env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
    env["PROGRAMFILES(X86)"] && path.join(env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) || "";
}

function launchExternalBrowserRenderer(url) {
  const browserPath = resolveExternalBrowserExecutable();
  if (browserPath) {
    try {
      const child = spawn(browserPath, ["--new-window", `--app=${url}`], {
        detached: true,
        stdio: "ignore"
      });
      child.unref();
      electronProfileIncrement("counters", "externalBrowserLaunch", 1);
      electronProfileConsole("external-browser-launch", { url, browserPath });
      appendLogLine("info", "external-browser-launch", { url, browserPath });
      return { ok: true, url, browserPath, fallback: false };
    } catch (err) {
      const message = String(err?.message || err);
      electronProfileConsole("external-browser-launch-error", { url, browserPath, message });
      appendLogLine("error", "external-browser-launch-error", { url, browserPath, message });
    }
  }
  shell.openExternal(url);
  electronProfileIncrement("counters", "externalBrowserShellFallback", 1);
  electronProfileConsole("external-browser-shell-fallback", { url });
  appendLogLine("warn", "external-browser-shell-fallback", { url });
  return { ok: true, url, browserPath: "", fallback: true };
}

function renderExternalBrowserHostHtml(url, launchResult) {
  const browserLabel = launchResult?.browserPath ? path.basename(launchResult.browserPath) : "default browser";
  const modeLabel = launchResult?.fallback ? "system browser tab" : "browser app window";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>NovaFlow External Renderer</title>
  <style>
    html,body{margin:0;background:#0b0d10;color:#e5e7eb;font-family:Segoe UI,Arial,sans-serif;}
    main{box-sizing:border-box;min-height:100vh;padding:22px 24px;display:flex;flex-direction:column;gap:12px;justify-content:center;}
    h1{margin:0;font-size:18px;font-weight:650;}
    p{margin:0;color:#a8b0bd;font-size:13px;line-height:1.55;}
    code{color:#d7e7ff;background:#151a22;border:1px solid #253040;border-radius:4px;padding:2px 5px;}
  </style>
</head>
<body>
  <main>
    <h1>NovaFlow external renderer mode</h1>
    <p>The main interface was opened in ${escapeHtmlText(browserLabel)} as a ${escapeHtmlText(modeLabel)}.</p>
    <p>Renderer URL: <code>${escapeHtmlText(url)}</code></p>
    <p>Keep this small host window open while testing. Close it to stop the Electron desktop host.</p>
  </main>
</body>
</html>`;
}

function createExternalBrowserHostWindow(url) {
  const launchResult = launchExternalBrowserRenderer(url);
  const win = new BrowserWindow({
    width: 560,
    height: 260,
    title: `NovaFlow ${app.getVersion()} External Renderer`,
    frame: true,
    resizable: false,
    backgroundColor: "#0b0d10",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  attachElectronProfileWindow(win, "external-browser-host");
  electronProfileConsole("external-browser-host-created", { url, launchResult });
  win.setMenuBarVisibility(false);
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderExternalBrowserHostHtml(url, launchResult))}`).catch((err) => {
    appendLogLine("error", "external-browser-host-load-error", { message: String(err?.message || err) });
  });
  return win;
}

function createWindow(initialLicenseState = null) {
  const webPreferences = {
    contextIsolation: true,
    nodeIntegration: false
  };
  if (!NF_ELECTRON_AB_NO_PRELOAD) {
    webPreferences.preload = path.join(__dirname, "preload.js");
    // The provider price observer uses Node crypto and ws in preload. Keep the
    // page context isolated while opting this preload-backed renderer out of
    // the Electron default sandbox; no-preload profiling remains sandboxed.
    webPreferences.sandbox = false;
  }
  if (NF_ELECTRON_AB_BACKGROUND_THROTTLING_OFF) {
    webPreferences.backgroundThrottling = false;
  }
  const win = new BrowserWindow({
    width: 1408,
    height: 880,
    title: `NovaFlow ${app.getVersion()}`,
    frame: false,
    backgroundColor: "#0b0d10",
    autoHideMenuBar: true,
    webPreferences
  });
  attachElectronProfileWindow(win, "main");
  electronProfileConsole("browser-window-created", {
    width: 1408,
    height: 880,
    frame: false,
    backgroundColor: "#0b0d10",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: webPreferences.sandbox !== false,
      preload: !NF_ELECTRON_AB_NO_PRELOAD,
      backgroundThrottling: webPreferences.backgroundThrottling
    }
  });

  try {
    const [w, h] = win.getSize();
    win.setMinimumSize(w, h);
  } catch {}

  let baseMinW = 1408;
  let baseMinH = 880;
  try {
    const [w, h] = win.getSize();
    baseMinW = Math.max(0, Math.round(w || baseMinW));
    baseMinH = Math.max(0, Math.round(h || baseMinH));
  } catch {}

  win.setMenuBarVisibility(false);

  try {
    const disp = screen.getPrimaryDisplay();
    const maxW = Math.max(baseMinW, Math.round(disp?.workAreaSize?.width || 0));
    const maxH = Math.max(baseMinH, Math.round(disp?.workAreaSize?.height || 0));
    win.setMaximumSize(maxW, maxH);
  } catch {}

  const menu = Menu.buildFromTemplate([
    {
      label: "文件",
      submenu: [
        { role: "quit", label: "退出" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        // registerAccelerator false: the renderer owns Ctrl+Z / Ctrl+Y (bone rigging,
        // mesh and weight editors, layer tools). A registered menu accelerator swallows
        // the key before the page sees it; text fields keep their built-in undo.
        { role: "undo", label: "撤销", registerAccelerator: false },
        { role: "redo", label: "重做", registerAccelerator: false },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "重置缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "close", label: "关闭窗口" }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);

  let windowCaptureContentFrameQueue = Promise.resolve()

  ipcMain.handle("window-minimize", () => {
    if (win.isDestroyed()) return
    win.minimize()
  })

  ipcMain.handle("window-toggle-maximize", () => {
    if (win.isDestroyed()) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle("window-close", () => {
    if (win.isDestroyed()) return
    win.close()
  })

  ipcMain.handle("window-get-position", () => {
    if (win.isDestroyed()) return [0, 0]
    try { return win.getPosition() } catch { return [0, 0] }
  })

  ipcMain.handle("window-capture-content-frame", async (event) => {
    const captureWindow = BrowserWindow.fromWebContents(event.sender)
    if (!captureWindow || captureWindow !== win || captureWindow.isDestroyed()) {
      return { ok: false, error: "WINDOW_UNAVAILABLE" }
    }
    const runCapture = async () => {
      if (captureWindow !== win || captureWindow.isDestroyed()) {
        return { ok: false, error: "WINDOW_UNAVAILABLE" }
      }
      const startedAt = Date.now()
      try {
        const capturedImage = await captureWindow.webContents.capturePage()
        if (!capturedImage || capturedImage.isEmpty()) {
          return { ok: false, error: "CAPTURE_EMPTY" }
        }
        const size = capturedImage.getSize()
        const png = capturedImage.toPNG()
        return {
          ok: true,
          width: Math.max(0, Number(size?.width) || 0),
          height: Math.max(0, Number(size?.height) || 0),
          captureMs: Math.max(0, Date.now() - startedAt),
          png
        }
      } catch {
        return { ok: false, error: "CAPTURE_FAILED" }
      }
    }
    const queuedCapture = windowCaptureContentFrameQueue.then(runCapture, runCapture)
    windowCaptureContentFrameQueue = queuedCapture.then(() => undefined, () => undefined)
    return await queuedCapture
  })

  ipcMain.handle("window-set-position", (_evt, payload) => {
    if (win.isDestroyed()) return
    if (win.isMaximized() || win.isFullScreen()) return
    const x = Math.round(Number(payload?.x))
    const y = Math.round(Number(payload?.y))
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    try { win.setPosition(x, y) } catch {}
  })

  ipcMain.handle("window-set-min-size", (_evt, payload) => {
    if (win.isDestroyed()) return
    const w = Math.max(baseMinW, Math.round(Number(payload?.width || 0) || 0));
    const h = Math.max(baseMinH, Math.round(Number(payload?.height || 0) || 0));
    if (w <= 0 || h <= 0) return
    try { win.setMinimumSize(w, h) } catch {}
  })

  ipcMain.handle("window-ensure-min-size", (_evt, payload) => {
    if (win.isDestroyed()) return
    if (win.isMaximized() || win.isFullScreen()) return
    const w = Math.max(baseMinW, Math.round(Number(payload?.width || 0) || 0));
    const h = Math.max(baseMinH, Math.round(Number(payload?.height || 0) || 0));
    if (w <= 0 || h <= 0) return
    try { win.setMinimumSize(w, h) } catch {}
    try {
      const [cw, ch] = win.getSize();
      const nextW = Math.max(cw || 0, w);
      const nextH = Math.max(ch || 0, h);
      if (nextW !== cw || nextH !== ch) win.setSize(nextW, nextH);
    } catch {}
  })

  const devServerUrl = process.env.PARTICLE_EDITOR_DEV_SERVER_URL;
  const allowedOrigins = new Set();
  if (devServerUrl) {
    try {
      allowedOrigins.add(new URL(devServerUrl).origin);
    } catch {}
  }
  if (NF_ELECTRON_AB_HTTP_RENDERER_URL) {
    try {
      allowedOrigins.add(new URL(NF_ELECTRON_AB_HTTP_RENDERER_URL).origin);
    } catch {}
  }

  const loadMainRenderer = async () => {
    if (NF_ELECTRON_AB_HTTP_RENDERER_URL) {
      electronProfileConsole("load-http-renderer", { url: NF_ELECTRON_AB_HTTP_RENDERER_URL });
      await win.loadURL(NF_ELECTRON_AB_HTTP_RENDERER_URL);
    } else if (devServerUrl) {
      await win.loadURL(devServerUrl);
      win.webContents.openDevTools({ mode: "detach" });
    } else {
      await win.loadFile(path.join(__dirname, "renderer", "index.html"));
    }
  };

  const loadLicenseLocked = async (state) => {
    const html = renderLicenseLockScreenHtml(state || {
      status: "locked",
      locked: true,
      machineId: "",
      reason: "license_locked"
    });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  };

  try { ipcMain.removeHandler("license-open-main"); } catch {}
  ipcMain.handle("license-open-main", async () => {
    const state = await getEffectiveLicenseState("license-open-main", { allowOfflineCache: false });
    if (!isEffectiveLicenseAllowed(state)) {
      return { ok: false, state, error: state.reason || state.error || "license_locked" };
    }
    await loadMainRenderer();
    startNovaFlowRuntimeAfterLicense(win, "license-open-main");
    return { ok: true, state };
  });

  loadMainRenderer().catch((err) => {
    const message = String(err?.message || err);
    electronProfileConsole("load-main-renderer-error", { message, abHttpRendererUrl: NF_ELECTRON_AB_HTTP_RENDERER_URL });
    if (NF_ELECTRON_AB_HTTP_RENDERER_URL) {
      try {
        win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderElectronProfileHttpRendererFailureHtml(NF_ELECTRON_AB_HTTP_RENDERER_URL, err))}`);
      } catch {}
    }
    appendLogLine("error", "load-main-renderer-error", { message });
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isAllowedAppUrl(url, allowedOrigins)) return;
    event.preventDefault();
    if (isHttpUrl(url)) shell.openExternal(url);
  });

  win.webContents.on("will-redirect", (event, url) => {
    if (isAllowedAppUrl(url, allowedOrigins)) return;
    event.preventDefault();
    if (isHttpUrl(url)) shell.openExternal(url);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

function getUserDataJsonPath(key) {
  const safe = {
    templates: "templates.json",
    curvePresets: "curve-presets.json",
    appState: "app-state.json",
    spriteLibrary: "sprite-library.json",
    aiSeqCloudSettings: "ai-seq-cloud-settings.json"
  };
  const file = safe[key];
  if (!file) return null;
  return path.join(app.getPath("userData"), file);
}

function readAppState() {
  const p = getUserDataJsonPath("appState");
  if (!p) return null;
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeAppState(state) {
  const p = getUserDataJsonPath("appState");
  if (!p) return;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(state ?? {}, null, 2), "utf8");
  } catch {
    void 0;
  }
}

function resolveBundledResourcePath(fileName) {
  const candidates = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, fileName));
  }
  candidates.push(path.join(__dirname, "resources", fileName));
  candidates.push(path.join(__dirname, fileName));
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      void 0;
    }
  }
  return null;
}

function resolveBundledResourceDir(dirName) {
  if (app.isPackaged) {
    const p = path.join(process.resourcesPath, dirName);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    } catch {
      void 0;
    }
    return null;
  }

  const candidates = [path.join(__dirname, "resources", dirName), path.join(__dirname, dirName)];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    } catch {
      void 0;
    }
  }
  return null;
}

function sanitizeTemplateName(name) {
  return String(name || "").replace(/\s+/g, " ").trim().slice(0, 40) || "模板";
}

function toTemplateRecord(fileName, parsed) {
  const baseName = sanitizeTemplateName(path.basename(fileName, path.extname(fileName)));
  const now = Date.now();

  if (parsed && typeof parsed === "object") {
    if (parsed.config && typeof parsed.config === "object") {
      const name = baseName;
      const cfg = parsed.config;
      const id = String(parsed.id || `file_${baseName}`);
      return { id, name, config: cfg, createdAt: Number(parsed.createdAt) || now };
    }
    if (parsed.systemName && typeof parsed.systemName === "string") {
      const cfg = parsed;
      const name = baseName;
      const id = `file_${baseName}`;
      return { id, name, config: cfg, createdAt: now };
    }
  }

  return null;
}

function loadInitialTemplatesFromDir(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => n.toLowerCase().endsWith(".json"))
    .filter((n) => !String(n).toLowerCase().startsWith("builtin_tpl_"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  const out = [];
  for (const name of files) {
    try {
      const raw = fs.readFileSync(path.join(dirPath, name), "utf8");
      const parsed = JSON.parse(raw);
      const rec = toTemplateRecord(name, parsed);
      if (rec) out.push(rec);
    } catch {
      void 0;
    }
  }
  return out;
}

async function seedInitialTemplatesIfMissing() {
  const userDataPath = getUserDataJsonPath("templates");
  if (!userDataPath) return;
  try {
    if (fs.existsSync(userDataPath)) return;
  } catch {
    void 0;
  }

  const bundledDir = resolveBundledResourceDir("initial-templates");
  const templates = bundledDir ? loadInitialTemplatesFromDir(bundledDir) : [];
  if (!Array.isArray(templates) || templates.length === 0) return;

  try {
    fs.mkdirSync(path.dirname(userDataPath), { recursive: true });
    const machineId = await licenseCore.getMachineId();
    const enc = licenseCore.encryptUtf8ToStorage(machineId, JSON.stringify(templates));
    fs.writeFileSync(userDataPath, enc, "utf8");
  } catch {
    void 0;
  }
}

async function resetTemplatesToBundled() {
  const userDataPath = getUserDataJsonPath("templates");
  if (!userDataPath) throw new Error("templates path not found");

  const bundledDir = resolveBundledResourceDir("initial-templates");
  const templates = bundledDir ? loadInitialTemplatesFromDir(bundledDir) : [];
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new Error("no initial templates found");
  }

  fs.mkdirSync(path.dirname(userDataPath), { recursive: true });
  const machineId = await licenseCore.getMachineId();
  const enc = licenseCore.encryptUtf8ToStorage(machineId, JSON.stringify(templates));
  fs.writeFileSync(userDataPath, enc, "utf8");
  return templates;
}

async function loadTemplatesFromUserData() {
  const userDataPath = getUserDataJsonPath("templates");
  if (!userDataPath) return null;
  try {
    if (!fs.existsSync(userDataPath)) return null;
    const raw = fs.readFileSync(userDataPath, "utf8");
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      const machineId = await licenseCore.getMachineId();
      const dec = licenseCore.decryptStorageToUtf8(machineId, raw);
      const parsed = JSON.parse(dec);
      return Array.isArray(parsed) ? parsed : null;
    }
  } catch {
    return null;
  }
}

async function writeTemplatesToUserData(templates) {
  const userDataPath = getUserDataJsonPath("templates");
  if (!userDataPath) return;
  try {
    fs.mkdirSync(path.dirname(userDataPath), { recursive: true });
    const machineId = await licenseCore.getMachineId();
    const enc = licenseCore.encryptUtf8ToStorage(machineId, JSON.stringify(Array.isArray(templates) ? templates : []));
    fs.writeFileSync(userDataPath, enc, "utf8");
  } catch {
    void 0;
  }
}

async function mergeBundledTemplatesIntoUserData() {
  const bundledDir = resolveBundledResourceDir("initial-templates");
  const bundled = bundledDir ? loadInitialTemplatesFromDir(bundledDir) : [];
  if (!Array.isArray(bundled) || bundled.length === 0) return;

  const existing = (await loadTemplatesFromUserData()) || [];
  if (!Array.isArray(existing) || existing.length === 0) {
    await writeTemplatesToUserData(bundled);
    return;
  }

  const seen = new Set(existing.map((t) => String(t?.id || "")));
  const merged = [...existing];
  for (const t of bundled) {
    const id = String(t?.id || "");
    if (!id) continue;
    if (seen.has(id)) continue;
    merged.push(t);
    seen.add(id);
  }
  if (merged.length !== existing.length) {
    await writeTemplatesToUserData(merged);
  }
}

async function resetTemplatesOnVersionChange() {
  if (!app.isPackaged) return;
  const current = String(app.getVersion() || "").trim();
  if (!current) return;

  const state = readAppState();
  const last = String(state?.version || "").trim();
  if (last === current) return;

  try {
    await mergeBundledTemplatesIntoUserData();
    await seedInitialTemplatesIfMissing();
  } catch {
    await seedInitialTemplatesIfMissing();
  }

  writeAppState({ version: current, updatedAt: Date.now() });
}

ipcMain.handle("user-data-read", async (_evt, key) => {
  const p = getUserDataJsonPath(key);
  if (!p) throw new Error("invalid key");
  try {
    if (!fs.existsSync(p)) return { ok: true, data: null };
    const raw = fs.readFileSync(p, "utf8");
    try {
      return { ok: true, data: JSON.parse(raw) };
    } catch {
      const machineId = await licenseCore.getMachineId();
      const dec = licenseCore.decryptStorageToUtf8(machineId, raw);
      return { ok: true, data: JSON.parse(dec) };
    }
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("user-data-write", async (_evt, payload) => {
  const key = payload?.key;
  const data = payload?.data;
  const p = getUserDataJsonPath(key);
  if (!p) throw new Error("invalid key");
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const machineId = await licenseCore.getMachineId();
    const enc = licenseCore.encryptUtf8ToStorage(machineId, JSON.stringify(data));
    fs.writeFileSync(p, enc, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("templates-reset-to-bundled", async () => {
  try {
    const templates = await resetTemplatesToBundled();
    return { ok: true, data: templates };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("license-get-state", async () => {
  return getEffectiveLicenseState("license-get-state", { allowOfflineCache: false });
});

ipcMain.handle("get-user-data-path", async () => {
  return { ok: true, path: app.getPath("userData") };
});

ipcMain.handle("open-user-data-folder", async () => {
  try {
    const p = app.getPath("userData");
    await shell.openPath(p);
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("open-external", async (_evt, payload) => {
  const url = String(payload?.url || "").trim();
  if (!url) return { ok: false, error: "invalid url" };
  if (!isHttpUrl(url)) return { ok: false, error: "invalid url" };
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return { ok: false, error: "invalid url" };
  } catch {
    return { ok: false, error: "invalid url" };
  }
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("client-auth-status", async () => {
  return clientAuthDirect.status();
});

ipcMain.handle("client-auth-register", async (_evt, payload) => {
  return clientAuthDirect.registerDisabled(payload);
});

ipcMain.handle("client-auth-login", async (_evt, payload) => {
  const authResult = await clientAuthDirect.loginWithPassword(payload);
  if (!authResult?.ok || !authResult?.session?.token) return authResult;
  const bootstrapResult = await requestNovaFlowAuthenticatedClientApi(
    "/api/client/bootstrap",
    authResult.session,
    "GET"
  );
  if (!bootstrapResult?.ok) {
    await clientAuthDirect.logout({ token: bootstrapResult?.session?.token || authResult.session.token });
    return bootstrapResult;
  }
  return {
    ...authResult,
    ...bootstrapResult,
    ok: true,
    transport: clientAuthDirect.CLIENT_AUTH_TRANSPORT,
    auth: authResult.auth,
    session: bootstrapResult.session || authResult.session
  };
});

ipcMain.handle("client-auth-verify", async (_evt, payload) => {
  return clientAuthDirect.verifyDisabled(payload);
});

ipcMain.handle("client-auth-dev-login", async (_evt, payload) => {
  await ensureNovaFlowAdminServerStarted({ source: "client-auth-dev-login", timeoutMs: 7000 });
  const account = String(payload?.account || payload?.username || payload?.email || "").trim();
  const code = String(payload?.code || payload?.loginCode || "").trim();
  return requestNovaFlowClientApi("/api/auth/dev-login", {
    method: "POST",
    body: { account, code },
    timeoutMs: 15000
  });
});

ipcMain.handle("client-auth-me", async (_evt, payload) => {
  return requestNovaFlowAuthenticatedClientApi("/api/auth/me", payload, "GET");
});

ipcMain.handle("client-auth-bootstrap", async (_evt, payload) => {
  return requestNovaFlowAuthenticatedClientApi("/api/client/bootstrap", payload, "GET");
});

ipcMain.handle("client-auth-logout", async (_evt, payload) => {
  return clientAuthDirect.logout(payload);
});

ipcMain.handle("client-auth-credits-check", async (_evt, payload) => {
  return requestNovaFlowAuthenticatedClientApi("/api/client/credits/check", payload, "POST");
});

ipcMain.handle("client-auth-ai-task-authorize", async (_evt, payload) => {
  return requestNovaFlowSmartAiApi("/api/ai/tasks", payload);
});

ipcMain.handle("client-auth-ai-task-commit-usage", async (_evt, payload) => {
  return requestNovaFlowSmartAiApi("/api/ai/tasks/usage", payload);
});

ipcMain.handle("smart-ai-prompt-optimize", async (_evt, payload) => {
  return requestNovaFlowSmartAiApi("/api/client/grok/prompt-optimize", payload);
});

ipcMain.handle("smart-ai-image-reverse", async (_evt, payload) => {
  return requestNovaFlowSmartAiApi("/api/client/grok/image-reverse", payload);
});


ipcMain.handle("license-get-machine-id", async () => {
  const machineId = await licenseCore.getMachineId();
  return { ok: true, machineId };
});

ipcMain.handle("license-remove", async () => {
  try {
    const p = path.join(app.getPath("userData"), "license.nfl");
    try {
      await fs.promises.unlink(p);
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
    invalidateOnlineEntitlementSuccessReuse("license-remove");
    await licenseOnline.clearOnlineLicenseCache(app.getPath("userData"), "license_remove");
    return { ok: true, state: await getEffectiveLicenseState("license-remove", { allowOfflineCache: false }) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("app-get-version", async () => {
  return { ok: true, version: app.getVersion() };
});

ipcMain.handle("app-get-info", async () => {
  try {
    return {
      ok: true,
      version: app.getVersion(),
      exePath: process.execPath,
      appPath: app.getAppPath(),
    }
  } catch {
    return { ok: true, version: app.getVersion() }
  }
});

ipcMain.handle("runtime-get-status", async (_evt, payload) => {
  return await getNovaFlowRuntimeStatus({ probe: payload?.probe !== false, timeoutMs: payload?.timeoutMs });
});

ipcMain.handle("runtime-ensure-started", async (_evt, payload) => {
  return await ensureNovaFlowRuntimeStarted({ source: "ipc", timeoutMs: payload?.timeoutMs });
});

ipcMain.handle("runtime-restart", async (_evt, payload) => {
  await stopNovaFlowRuntime({ source: "restart", timeoutMs: payload?.stopTimeoutMs || NOVAFLOW_AI_RUNTIME_STOP_TIMEOUT_MS });
  return await ensureNovaFlowRuntimeStarted({ source: "restart", timeoutMs: payload?.startTimeoutMs || NOVAFLOW_AI_RUNTIME_START_TIMEOUT_MS });
});

ipcMain.handle("runtime-stop", async (_evt, payload) => {
  return await stopNovaFlowRuntime({ source: "ipc", timeoutMs: payload?.timeoutMs || NOVAFLOW_AI_RUNTIME_STOP_TIMEOUT_MS });
});

ipcMain.handle("minimax-h3-runtime-get-status", async (_evt, payload) => {
  return await miniMaxH3RuntimeLifecycle.getStatus({
    probe: payload?.probe !== false,
    timeoutMs: payload?.timeoutMs
  });
});

ipcMain.handle("minimax-h3-runtime-ensure-started", async (_evt, payload) => {
  return await miniMaxH3RuntimeLifecycle.start({ timeoutMs: payload?.timeoutMs });
});

ipcMain.handle("minimax-h3-runtime-stop", async (_evt, payload) => {
  return await miniMaxH3RuntimeLifecycle.stop({ timeoutMs: payload?.timeoutMs });
});

ipcMain.handle("qwen-lora-catalog", async (_event, payload) => {
  try { return { ok: true, items: await qwenLoraCatalog.catalog({ nsfw: payload?.nsfw === true }) }; }
  catch (error) { return { ok: false, items: [], error: String(error?.message || error) }; }
});

ipcMain.handle("minimax-h3-lora-catalog", async (_evt, payload) => {
  try {
    const started = await miniMaxH3RuntimeLifecycle.start({ timeoutMs: payload?.timeoutMs });
    if (!started?.running) {
      return { ok: false, items: [], error: String(started?.error || started?.status || "runtime_start_failed") };
    }
    const items = await miniMaxH3LoraCatalog.catalog({ mode: payload?.mode, steps: payload?.steps });
    return { ok: true, items };
  } catch (error) {
    return { ok: false, items: [], error: String(error?.message || error || "catalog_failed") };
  }
});

ipcMain.handle("minimax-h3-lora-validate", async (_evt, payload) => {
  try {
    const started = await miniMaxH3RuntimeLifecycle.start({ timeoutMs: payload?.timeoutMs });
    if (!started?.running) {
      return { ok: false, error: String(started?.error || started?.status || "runtime_start_failed") };
    }
    return await miniMaxH3LoraCatalog.validate({
      mode: payload?.mode,
      steps: payload?.steps,
      name: payload?.name,
      fingerprint: payload?.fingerprint,
      strength: payload?.strength,
    });
  } catch (error) {
    return { ok: false, error: String(error?.message || error || "validation_failed") };
  }
});

ipcMain.handle("runtime-get-system-stats", async (_evt, payload) => {
  const started = payload?.ensureStarted === false
    ? await getNovaFlowRuntimeStatus({ timeoutMs: payload?.timeoutMs || 2500 })
    : await ensureNovaFlowRuntimeStarted({ source: "system-stats", timeoutMs: payload?.startTimeoutMs || NOVAFLOW_AI_RUNTIME_START_TIMEOUT_MS });
  if (!started?.installed || !started?.ok || !started?.baseUrl) return started;
  return await probeNovaFlowRuntime(started.baseUrl, payload?.timeoutMs || 2500);
});

ipcMain.handle("runtime-diagnostics-snapshot", async (_evt, payload) => {
  const config = readNovaFlowRuntimeConfig();
  const requestedBaseUrl = sanitizeRuntimeBaseUrl(payload?.baseUrl || "");
  const baseUrl = requestedBaseUrl || (config.installed && config.ok ? config.baseUrl : "");
  const includeComfyStats = payload?.includeComfyStats !== false;
  const includeNvidia = payload?.includeNvidia !== false;
  const includeProcessMemory = payload?.includeProcessMemory !== false;
  const includeRuntimeLogs = payload?.includeRuntimeLogs !== false;
  const runtimePid = config.installed && config.ok ? readNovaFlowRuntimePid(config) : 0;
  const promptAssistantPid = promptAssistantProcess && !promptAssistantProcess.killed ? Number(promptAssistantProcess.pid || 0) || 0 : 0;
  const nvidia = includeNvidia ? await readNvidiaSmiSnapshot() : { ok: false, skipped: true, gpus: [], processes: [] };
  const runtimeProcessBase = { pid: runtimePid, alive: runtimePid ? isProcessAlive(runtimePid) : false };
  const promptAssistantProcessBase = { pid: promptAssistantPid, alive: promptAssistantPid ? isProcessAlive(promptAssistantPid) : false };
  const runtimeProcess = includeProcessMemory && runtimePid
    ? await readProcessMemorySnapshot(runtimePid)
    : runtimeProcessBase;
  const assistantProcess = includeProcessMemory && promptAssistantPid
    ? await readProcessMemorySnapshot(promptAssistantPid)
    : promptAssistantProcessBase;
  const comfyStats = includeComfyStats && baseUrl ? await probeNovaFlowRuntime(baseUrl, payload?.timeoutMs || 1800) : null;
  const runtimeLogs = includeRuntimeLogs && config.installed && config.ok
    ? readRuntimeLogDiagnostics(config, payload?.runtimeLogCursors)
    : { logsPath: "", cursors: [], evidence: [] };
  const promptAssistantConfig = getPromptAssistantConfig();
  return {
    ok: true,
    label: String(payload?.label || ""),
    collectedAt: new Date().toISOString(),
    systemRam: systemRamSnapshot(),
    runtime: {
      baseUrl,
      installed: !!(config.installed && config.ok),
      connected: !!(comfyStats && comfyStats.ok),
      pid: runtimePid,
      process: attachNvidiaProcessMemory(runtimeProcess, nvidia),
      comfyStatsOk: !!(comfyStats && comfyStats.ok),
      comfyStatsError: comfyStats && !comfyStats.ok ? String(comfyStats.error || comfyStats.status || "") : "",
      systemStats: comfyStats && comfyStats.ok ? comfyStats.data : null
    },
    promptAssistant: {
      enabled: !!promptAssistantConfig.enabled,
      runtimeStatus: String(promptAssistantConfig.runtimeStatus || ""),
      modelType: String(promptAssistantConfig.modelType || ""),
      pid: promptAssistantPid,
      process: attachNvidiaProcessMemory(assistantProcess, nvidia)
    },
    nvidia,
    runtimeLogs
  };
});

ipcMain.handle("runtime-free-memory", async (_evt, payload) => {
  const protectedOutputPath = getNovaFlowRuntimeOutputDir();
  const promptAssistantPid = promptAssistantProcess && !promptAssistantProcess.killed
    ? Number(promptAssistantProcess.pid || 0) || 0
    : 0;
  if (promptAssistantPid) stopPromptAssistantServiceSync();
  const promptAssistantReleased = {
    requested: true,
    pid: promptAssistantPid,
    stopped: promptAssistantPid ? !isProcessAlive(promptAssistantPid) : true
  };
  try {
    assertNovaFlowRuntimeReleaseMemoryFileTargetsSafe(payload?.fileTargets || []);
    const status = await getNovaFlowRuntimeStatus({ timeoutMs: payload?.statusTimeoutMs || 2500 });
    if (!status?.installed || !status?.ok || !status?.baseUrl || !status?.connected) {
      return {
        ok: false,
        error: "runtime_not_connected",
        runtime: status,
        promptAssistant: promptAssistantReleased,
        protectedOutputPath,
        deletedOutput: false
      };
    }
    const released = await requestNovaFlowRuntimeFreeMemory(status.baseUrl, payload?.timeoutMs || 30000);
    const nextStatus = await getNovaFlowRuntimeStatus({ timeoutMs: 1800 });
    broadcastNovaFlowRuntimeStatus(nextStatus);
    return {
      ...released,
      runtime: nextStatus,
      promptAssistant: promptAssistantReleased,
      protectedOutputPath,
      deletedOutput: false
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err?.message || err),
      promptAssistant: promptAssistantReleased,
      protectedOutputPath,
      deletedOutput: false
    };
  }
});

ipcMain.handle("runtime-open-assets-folder", async () => {
  const target = getNovaFlowRuntimeOpenTarget("assets");
  if (!target.ok) return target;
  try { fs.mkdirSync(target.target, { recursive: true }); } catch {}
  const error = await shell.openPath(target.target);
  return error ? { ok: false, error, target: target.target } : { ok: true, target: target.target };
});

handleNovaFlowTempIpc("runtime-open-output-folder", async () => {
  const target = ensureAiSeqCacheDir();
  try {
    await fs.promises.mkdir(target, { recursive: true });
    const error = await shell.openPath(target);
    return error
      ? { ok: false, error, target, kind: "ai-sequence-temp-warehouse" }
      : { ok: true, target, kind: "ai-sequence-temp-warehouse" };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), target, kind: "ai-sequence-temp-warehouse" };
  }
});

ipcMain.handle("runtime-open-logs-folder", async () => {
  const target = getNovaFlowRuntimeOpenTarget("logs");
  if (!target.ok) return target;
  try { fs.mkdirSync(target.target, { recursive: true }); } catch {}
  const error = await shell.openPath(target.target);
  return error ? { ok: false, error, target: target.target } : { ok: true, target: target.target };
});

ipcMain.handle("runtime-open-install-folder", async () => {
  const target = getNovaFlowRuntimeOpenTarget("install");
  if (!target.ok) return target;
  const error = await shell.openPath(target.target);
  return error ? { ok: false, error, target: target.target } : { ok: true, target: target.target };
});

ipcMain.handle("prompt-assistant-get-status", async () => {
  const config = getPromptAssistantConfig();
  return {
    ok: true,
    modelType: config.modelType,
    modelPath: config.modelPath,
    reverseModelType: config.reverseModelType,
    reverseModelPath: config.reverseModelPath,
    reverseModelEnabled: config.reverseModelEnabled,
    enabled: config.enabled,
    runtimeStatus: config.runtimeStatus,
    error: config.enabled || config.reverseModelEnabled ? promptAssistantLastError : config.error,
    warning: promptAssistantLastWarning
  };
});

function normalizePromptAssistantProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return provider === "gpt" || provider === "google" ? provider : "local";
}

function isOrdinaryLocalArtPromptPatchRequest(value = {}) {
  const provider = normalizePromptAssistantProvider(value.provider);
  const surface = String(value.surface || "").trim().toLowerCase().replace(/_/g, "-");
  const purpose = String(value.purpose || "").trim().toLowerCase().replace(/_/g, "-");
  return provider === "local"
    && purpose === "optimize"
    && Boolean(String(value.currentPrompt || "").trim())
    && ["", "art", "drawing", "image"].includes(surface);
}

function traceOrdinaryArtPromptPatchStage(stage, metadata = {}) {
  const normalizedStage = String(stage || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "unknown";
  const runtimeState = String(metadata.runtimeState || "")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const errorCode = String(metadata.errorCode || "")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  appendLogLine(metadata.ok === false ? "error" : "info", "prompt-assistant-ordinary-art-prompt-patch-stage", {
    command: "ordinaryArtPromptPatch",
    stage: normalizedStage,
    elapsedMs: Math.max(0, Math.min(600_000, Math.trunc(Number(metadata.elapsedMs) || 0))),
    ...(runtimeState ? { runtimeState } : {}),
    ...(Number.isFinite(Number(metadata.running)) ? { running: Math.max(0, Math.trunc(Number(metadata.running))) } : {}),
    ...(Number.isFinite(Number(metadata.pending)) ? { pending: Math.max(0, Math.trunc(Number(metadata.pending))) } : {}),
    ...(typeof metadata.released === "boolean" ? { released: metadata.released } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(typeof metadata.ok === "boolean" ? { ok: metadata.ok } : {})
  });
}

function normalizePromptAssistantExpectedRect(value) {
  if (!value || typeof value !== "object") return null;
  const xNorm = Number(value.xNorm);
  const yNorm = Number(value.yNorm);
  const wNorm = Number(value.wNorm);
  const hNorm = Number(value.hNorm);
  if (
    ![xNorm, yNorm, wNorm, hNorm].every(Number.isFinite) ||
    xNorm < 0 ||
    yNorm < 0 ||
    wNorm <= 0 ||
    hNorm <= 0 ||
    xNorm + wNorm > 1.0001 ||
    yNorm + hNorm > 1.0001
  ) return null;
  const rounded = (number) => Math.round(number * 10000) / 10000;
  return {
    xNorm: rounded(xNorm),
    yNorm: rounded(yNorm),
    wNorm: rounded(wNorm),
    hNorm: rounded(hNorm)
  };
}

function normalizePromptAssistantMandatoryChecklist(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 48).map((item) => {
    if (!item || typeof item !== "object") return null;
    const checklistToken = String(item.checklistToken || "").trim();
    const semanticToken = String(item.semanticToken || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(semanticToken)) return null;
    if (!/^region-[1-9]\d{0,2}:[a-z0-9][a-z0-9-]{0,63}$/.test(checklistToken)) return null;
    if (!checklistToken.endsWith(`:${semanticToken}`) || seen.has(checklistToken)) return null;
    seen.add(checklistToken);
    const expectedRect = normalizePromptAssistantExpectedRect(item.expectedRect);
    return {
      checklistToken,
      regionId: String(item.regionId || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120),
      kind: String(item.kind || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 48),
      semanticToken,
      ...(expectedRect ? { expectedRect } : {})
    };
  }).filter(Boolean);
}

function promptAssistantOptimizeRequirementsLimit(purpose) {
  const normalizedPurpose = String(purpose || "").trim().toLowerCase().replace(/_/g, "-");
  return normalizedPurpose === "minimax-h3-prompt-enhance" ? 12000 : 2000;
}

ipcMain.handle("prompt-assistant-optimize-prompt", async (_evt, payload) => {
  const prompt = String(payload?.prompt || "");
  const negativePrompt = String(payload?.negativePrompt || "");
  const supportsNegativePrompt = payload?.supportsNegativePrompt !== false;
  const nsfw = payload?.nsfw === true;
  const surface = String(payload?.surface || "").trim().slice(0, 80);
  const purpose = String(payload?.purpose || "").trim().slice(0, 80);
  const requirements = String(payload?.requirements || "")
    .trim()
    .slice(0, promptAssistantOptimizeRequirementsLimit(purpose));
  const provider = normalizePromptAssistantProvider(payload?.provider);
  const currentPrompt = String(payload?.currentPrompt ?? payload?.current_prompt ?? prompt).trim().slice(0, 20000);
  const usesMiniMaxH3Prompt = purpose.toLowerCase().replace(/_/g, "-") === "minimax-h3-prompt-enhance";
  const h3Mode = String(payload?.h3Mode ?? payload?.h3_mode ?? "").trim().slice(0, 80);
  const h3DurationSource = payload?.durationSeconds ?? payload?.duration_seconds ?? payload?.duration;
  const h3VisualSchema = String(payload?.visualSchema ?? payload?.visual_schema ?? "").trim().slice(0, 80);
  const requestedPromptSchema = String(payload?.promptSchema ?? payload?.prompt_schema ?? "").trim();
  const promptSchema = surface === "art"
    && purpose === "optimize"
    && Boolean(currentPrompt)
    && requestedPromptSchema === "nf.art.prompt.v1"
      ? requestedPromptSchema
      : "";
  const requestedPromptDetailMode = String(
    payload?.promptDetailMode ?? payload?.prompt_detail_mode ?? ""
  ).trim();
  const promptDetailMode = provider === "local"
    && promptSchema === "nf.art.prompt.v1"
    && requestedPromptDetailMode === "simple-structured-v1"
    && currentPrompt.length <= 120
    && !/[\r\n]/u.test(currentPrompt)
    && !/__NOVAFLOW_[A-Z0-9_:-]+__/iu.test(currentPrompt)
    && !/@(?:参考图[1-9][0-9]*|视频参考|声音参考)/u.test(currentPrompt)
    && !/\[[^\]\r\n]{1,32}\]|【[^】\r\n]{1,32}】/u.test(currentPrompt)
      ? requestedPromptDetailMode
      : "";
  const startedAt = Date.now();
  const ordinaryArtPromptPatch = isOrdinaryLocalArtPromptPatchRequest({
    provider,
    surface,
    purpose,
    currentPrompt
  });
  const optimizeTimeoutMs = usesMiniMaxH3Prompt || (ordinaryArtPromptPatch && !promptSchema) ? 900_000 : 300_000;
  let resourceHandoff = null;
  const beforeEnsure = ordinaryArtPromptPatch ? async () => {
    traceOrdinaryArtPromptPatchStage("resource-handoff-start", { elapsedMs: 0 });
    resourceHandoff = await prepareOrdinaryArtPromptPatchResourceHandoff();
    traceOrdinaryArtPromptPatchStage("resource-handoff-done", {
      elapsedMs: Date.now() - startedAt,
      runtimeState: resourceHandoff?.state,
      running: resourceHandoff?.running,
      pending: resourceHandoff?.pending,
      released: resourceHandoff?.released,
      errorCode: resourceHandoff?.errorCode,
      ok: resourceHandoff?.ok !== false
    });
    if (resourceHandoff?.ok === false) {
      const blocked = {
        ok: false,
        runtimeStatus: resourceHandoff.state === "runtime-generation-busy" ? "绘图生成中" : "显存交接失败",
        error: String(resourceHandoff.error || "绘图模型资源交接失败"),
        errorCode: String(resourceHandoff.errorCode || "runtime-resource-handoff-failed"),
        retryable: true,
        resourceHandoff
      };
      appendLogLine("error", "prompt-assistant-optimize-result", {
        elapsedMs: Date.now() - startedAt,
        surface,
        purpose,
        positiveChars: 0,
        negativeChars: 0,
        ordinaryArtPromptPatch: true,
        resourceHandoffState: resourceHandoff.state,
        ok: false,
        error: blocked.errorCode
      });
      return { ok: false, response: blocked };
    }
    // requestPromptAssistant starts its inference timer only after the child-ready
    // wait. Reserve the full 12 s startup window plus the verified 5 s cleanup.
    const remainingMs = optimizeTimeoutMs - (Date.now() - startedAt) - 18_500;
    if (remainingMs < 10_000) {
      const deadline = {
        ok: false,
        runtimeStatus: "推理超时",
        error: "Prompt Assistant 资源交接后剩余推理时间不足，请重试",
        errorCode: "ordinary-art-prompt-patch-deadline-exhausted",
        retryable: true,
        resourceHandoff
      };
      traceOrdinaryArtPromptPatchStage("deadline-exhausted", {
        elapsedMs: Date.now() - startedAt,
        runtimeState: resourceHandoff.state,
        errorCode: deadline.errorCode,
        ok: false
      });
      return { ok: false, response: deadline };
    }
    traceOrdinaryArtPromptPatchStage("inference-start", {
      elapsedMs: Date.now() - startedAt,
      runtimeState: resourceHandoff.state,
      released: resourceHandoff.released,
      ok: true
    });
    return { ok: true, timeoutMs: remainingMs };
  } : usesMiniMaxH3Prompt && provider === 'local' ? async () => {
    const shared = await prepareOrdinaryArtPromptPatchResourceHandoff();
    if (!shared.ok) return { ok: false, response: { ok: false, error: shared.error, errorCode: shared.errorCode } };
    const h3 = await miniMaxH3RuntimeLifecycle.getStatus({ timeoutMs: 1500 });
    if (!h3.running && !h3.processRunning) return { ok: true };
    const queue = await inspectNovaFlowRuntimeQueue(h3.baseUrl, 3000);
    if (!queue.ok || queue.state === 'busy') {
      return { ok: false, response: { ok: false, error: 'H3 正在生成或队列状态无法确认，请完成后再整理多参提示词', errorCode: 'h3-reference-compiler-runtime-busy' } };
    }
    const released = await requestNovaFlowRuntimeFreeMemory(h3.baseUrl, 15000);
    return released?.ok ? { ok: true } : { ok: false, response: { ok: false, error: 'H3 模型显存释放失败，未开始多参整理', errorCode: 'h3-reference-compiler-release-failed' } };
  } : null;
  let result = await requestPromptAssistant("optimizePrompt", {
    prompt,
    negativePrompt,
    supportsNegativePrompt,
    nsfw,
    requirements,
    surface,
    purpose,
    provider,
    currentPrompt,
    ...(usesMiniMaxH3Prompt ? {h3ReferenceFrames: require('./admin-server/h3-prompt-enhance.js').referenceFrames(payload?.h3ReferenceFrames, requirements)} : {}),
    ...(usesMiniMaxH3Prompt && payload?.h3Reverse === true ? { h3Reverse: true } : {}),
    ...(usesMiniMaxH3Prompt && h3Mode ? { h3Mode } : {}),
    ...(usesMiniMaxH3Prompt && h3DurationSource !== undefined && h3DurationSource !== null && h3DurationSource !== "" ? { durationSeconds: h3DurationSource } : {}),
    ...(usesMiniMaxH3Prompt && h3VisualSchema ? { visualSchema: h3VisualSchema } : {}),
    ...(promptSchema ? { promptSchema } : {}),
    ...(promptDetailMode ? { promptDetailMode } : {})
  }, optimizeTimeoutMs, {
    verifiedCleanup: true,
    ...(beforeEnsure ? { beforeEnsure } : {})
  });
  if (ordinaryArtPromptPatch && resourceHandoff?.ok !== false) {
    const cleanupFailed = ["prompt-assistant-stop-timeout", "prompt-assistant-stop-failed"].includes(String(result?.errorCode || ""));
    traceOrdinaryArtPromptPatchStage("cleanup-done", {
      elapsedMs: Date.now() - startedAt,
      runtimeState: resourceHandoff?.state,
      released: resourceHandoff?.released,
      errorCode: cleanupFailed ? result.errorCode : "",
      ok: !cleanupFailed
    });
  }
  if (ordinaryArtPromptPatch) {
    result = { ...result, resourceHandoff };
    traceOrdinaryArtPromptPatchStage("inference-done", {
      elapsedMs: Date.now() - startedAt,
      runtimeState: resourceHandoff?.state,
      released: resourceHandoff?.released,
      errorCode: result?.errorCode,
      ok: result?.ok !== false
    });
  }
  const output = result?.data && typeof result.data === "object" ? result.data : {};
  appendLogLine(result?.ok === false ? "error" : "info", "prompt-assistant-optimize-result", {
    elapsedMs: Date.now() - startedAt,
    surface,
    purpose,
    positiveChars: String(output.positivePrompt || output.positive_prompt || output.prompt || "").length,
    negativeChars: String(output.negativePrompt || output.negative_prompt || "").length,
    ordinaryArtPromptPatch,
    resourceHandoffState: String(resourceHandoff?.state || ""),
    ok: result?.ok !== false,
    error: result?.ok === false ? String(result?.error || "") : "",
    // The generic message hides which gate rejected the answer.
    failureReason: result?.ok === false
      ? String(result?.applicationReason || result?.retentionReason || result?.errorCode || "").slice(0, 160)
      : ""
  });
  return result;
});






// 万物迁移 needs the scene's style as WORDS before it can repaint an object into it: measured live,
// Qwen Image Edit never infers image 2's style and applies it to image 1, but renders any style that is
// named in the prompt. This is the one call that turns a picture into that sentence, and it is separate
// from reverse-image-prompt because that path carries the animation and UI-design contracts.
ipcMain.handle("prompt-assistant-describe-art-style", async (_evt, payload) => {
  const dataUrl = String(payload?.dataUrl || "");
  if (!dataUrl.startsWith("data:image/")) throw new Error("请先选择可分析的图片");
  const name = sanitizeFileName(payload?.name || "scene.png");
  const result = await requestPromptAssistant("describeArtStyle", { images: [{ name, dataUrl }] }, 240_000);
  return { style: String(result?.style || "").slice(0, 400), model: String(result?.model || "") };
});
ipcMain.handle("prompt-assistant-reverse-image-prompt", async (_evt, payload) => {
  const surface = String(payload?.surface || "").trim().slice(0, 80);
  const purpose = String(payload?.purpose || "").trim().slice(0, 80);
  const normalizedPurpose = purpose.toLowerCase().replace(/_/g, "-");
  const requirementsLimit = ["minimax-h3-i2v-reverse", "minimax-h3-fl2v-reverse"].includes(normalizedPurpose)
    ? 12000
    : 2000;
  const requirements = String(payload?.requirements || "").trim().slice(0, requirementsLimit);
  const provider = normalizePromptAssistantProvider(payload?.provider);
  const currentPrompt = String(payload?.currentPrompt ?? payload?.current_prompt ?? payload?.prompt ?? "").trim().slice(0, 20000);
  const preferredOutputLanguageValue = String(payload?.preferredOutputLanguage || "").trim().toLowerCase();
  const preferredOutputLanguage = ["minimax-h3-i2v-reverse", "minimax-h3-fl2v-reverse"].includes(normalizedPurpose)
    ? (preferredOutputLanguageValue === "en" ? "en" : preferredOutputLanguageValue === "zh-cn" ? "zh-CN" : "")
    : "";
  const mandatoryChecklist = normalizePromptAssistantMandatoryChecklist(payload?.mandatoryChecklist);
  const mandatoryChecklistTokens = mandatoryChecklist.map((item) => item.checklistToken);
  const images = Array.isArray(payload?.images) ? payload.images.slice(0, 3).map((item, index) => ({
    name: sanitizeFileName(item?.name || `reference_${index + 1}.png`),
    slotType: String(item?.slotType || item?.role || "").slice(0, 80),
    role: String(item?.role || item?.slotType || "").slice(0, 80),
    label: String(item?.label || "").slice(0, 80),
    dataUrl: String(item?.dataUrl || "")
  })).filter((item) => item.dataUrl) : [];
  const visualSchema = String(payload?.visualSchema || "").trim().slice(0, 80);
  const usesMiniMaxH3Reverse = ["minimax-h3-i2v-reverse", "minimax-h3-fl2v-reverse"].includes(normalizedPurpose);
  if (usesMiniMaxH3Reverse && visualSchema !== "nf.h3.visual.v1") {
    throw new Error("MiniMax H3 reverse requires visualSchema nf.h3.visual.v1");
  }
  const hasH3UserPrompt = Object.prototype.hasOwnProperty.call(payload || {}, "userPrompt")
    && typeof payload?.userPrompt === "string";
  const hasH3UserRequirements = Object.prototype.hasOwnProperty.call(payload || {}, "userRequirements")
    && typeof payload?.userRequirements === "string";
  if (usesMiniMaxH3Reverse && (!hasH3UserPrompt || !hasH3UserRequirements)) {
    throw new Error("MiniMax H3 reverse requires explicit userPrompt and userRequirements fields");
  }
  const userPrompt = usesMiniMaxH3Reverse ? payload.userPrompt.trim().slice(0, 20000) : "";
  const userRequirements = usesMiniMaxH3Reverse ? payload.userRequirements.trim().slice(0, 12000) : "";
  const usesMiniMaxH3VisualV1 = usesMiniMaxH3Reverse;
  const sourceContentPolicy = payload?.contentPolicy && typeof payload.contentPolicy === "object"
    ? payload.contentPolicy
    : {};
  const contentPolicy = usesMiniMaxH3VisualV1 ? {
    sensitiveVisualAnalysis: sourceContentPolicy.sensitiveVisualAnalysis === true,
    allSubjectsConfirmedAdult: sourceContentPolicy.allSubjectsConfirmedAdult === true
  } : null;
  const usesVisualV2 = purpose === "static-image-reverse" && images.length === 1 && visualSchema === "nf.visual.v2";
  let staticReverseResourceHandoff = null;
  let reverseCachePrepared = false;
  if (usesVisualV2) {
    const workflowStartedAt = Date.now();
    tracePromptAssistantStaticReverseLifecycle("resource-handoff-start", {
      elapsedMs: 0,
      stopResult: "not-requested",
      lastSafeStage: "resource-handoff-start",
      ok: true
    });
    staticReverseResourceHandoff = await prepareOrdinaryArtPromptPatchResourceHandoff();
    tracePromptAssistantStaticReverseLifecycle("resource-handoff-done", {
      elapsedMs: Date.now() - workflowStartedAt,
      stopResult: "not-requested",
      lastSafeStage: "resource-handoff-done",
      runtimeState: staticReverseResourceHandoff?.state,
      running: staticReverseResourceHandoff?.running,
      pending: staticReverseResourceHandoff?.pending,
      released: staticReverseResourceHandoff?.released,
      errorCode: staticReverseResourceHandoff?.errorCode,
      ok: staticReverseResourceHandoff?.ok !== false
    });
    if (staticReverseResourceHandoff?.ok === false) {
      return {
        ok: false,
        runtimeStatus: staticReverseResourceHandoff.state === "runtime-generation-busy" ? "绘图生成中" : "显存交接失败",
        error: String(staticReverseResourceHandoff.error || "本地图片反推资源交接失败"),
        errorCode: String(staticReverseResourceHandoff.errorCode || "runtime-resource-handoff-failed"),
        retryable: true,
        resourceHandoff: staticReverseResourceHandoff
      };
    }
    const cacheBefore = getPromptAssistantConfig();
    if (!cacheBefore.reverseCacheReady) {
      tracePromptAssistantStaticReverseLifecycle("cache-prepare-start", {
        elapsedMs: Date.now() - workflowStartedAt,
        stopResult: "not-requested",
        lastSafeStage: "cache-prepare-start",
        runtimeState: staticReverseResourceHandoff?.state,
        ok: true
      });
      const cachePrepare = await requestPromptAssistant(
        "prepareReverseCache",
        {},
        900_000,
        { verifiedCleanup: true }
      );
      const cacheAfter = getPromptAssistantConfig();
      reverseCachePrepared = cachePrepare?.ok === true && cacheAfter.reverseCacheReady === true;
      tracePromptAssistantStaticReverseLifecycle("cache-prepare-done", {
        elapsedMs: Date.now() - workflowStartedAt,
        stopResult: "stopped",
        lastSafeStage: "cache-prepare-done",
        runtimeState: staticReverseResourceHandoff?.state,
        errorCode: reverseCachePrepared ? "" : String(cachePrepare?.errorCode || cacheAfter.reverseCacheStatus || "cache-prepare-failed"),
        ok: reverseCachePrepared
      });
      if (!reverseCachePrepared) {
        return {
          ...cacheAfter,
          ok: false,
          runtimeStatus: "反推模型准备失败",
          error: "本地反推模型的 NF4 磁盘缓存准备失败，请重试",
          errorCode: String(cachePrepare?.errorCode || cacheAfter.reverseCacheStatus || "reverse-cache-prepare-failed"),
          failureCategory: "model_preparation",
          retryable: true,
          resourceHandoff: staticReverseResourceHandoff
        };
      }
    }
  }
  const reversePayload = {
    images,
    requirements,
    surface,
    purpose,
    provider,
    currentPrompt,
    ...(usesMiniMaxH3VisualV1 ? {
      userPrompt, userRequirements,
      h3Mode: payload?.h3Mode,
      durationSeconds: payload?.durationSeconds
    } : {}),
    ...(preferredOutputLanguage ? { preferredOutputLanguage } : {}),
    mandatoryChecklist,
    mandatoryChecklistTokens,
    ...(usesMiniMaxH3VisualV1 ? { visualSchema, contentPolicy } : {}),
    ...(usesVisualV2 ? { visualSchema, nsfw: payload?.nsfw === true } : {})
  };
  const runReversePromptAssistant = () => requestPromptAssistant(
    "reverseImagePrompt",
    reversePayload,
    // Each frame is analyzed in its own bounded stage; a slow or shared GPU can
    // take minutes per frame, so budget the timeout per image rather than per call.
    usesMiniMaxH3Reverse ? 180_000 * Math.max(1, Array.isArray(images) ? images.length : 1) : 300_000,
    { verifiedCleanup: true }
  );
  let result = await runReversePromptAssistant();
  if (usesVisualV2 && isPromptAssistantReverseCachePreparationFailure(result)) {
    const retryStartedAt = Date.now();
    tracePromptAssistantStaticReverseLifecycle("cache-reprepare-start", {
      elapsedMs: 0,
      stopResult: "not-requested",
      lastSafeStage: "cache-reprepare-start",
      errorCode: promptAssistantResultFailureCodes(result)[0] || "cache-preparation-required",
      ok: true
    });
    const cachePrepare = await requestPromptAssistant(
      "prepareReverseCache",
      {},
      900_000,
      { verifiedCleanup: true }
    );
    const cacheAfter = getPromptAssistantConfig();
    const cacheReprepared = cachePrepare?.ok === true && cacheAfter.reverseCacheReady === true;
    reverseCachePrepared = reverseCachePrepared || cacheReprepared;
    tracePromptAssistantStaticReverseLifecycle("cache-reprepare-done", {
      elapsedMs: Date.now() - retryStartedAt,
      stopResult: "stopped",
      lastSafeStage: "cache-reprepare-done",
      errorCode: cacheReprepared ? "" : String(cachePrepare?.errorCode || cacheAfter.reverseCacheStatus || "cache-reprepare-failed"),
      ok: cacheReprepared
    });
    if (!cacheReprepared) {
      return {
        ...cacheAfter,
        ok: false,
        runtimeStatus: "反推模型准备失败",
        error: "本地反推模型的 NF4 磁盘缓存准备失败，请重试",
        errorCode: String(cachePrepare?.errorCode || cacheAfter.reverseCacheStatus || "reverse-cache-reprepare-failed"),
        failureCategory: "model_preparation",
        retryable: true,
        resourceHandoff: staticReverseResourceHandoff,
        reverseCachePrepared
      };
    }
    result = await runReversePromptAssistant();
  }
  return usesVisualV2
    ? {
        ...result,
        resourceHandoff: staticReverseResourceHandoff,
        reverseCachePrepared
      }
    : result;
});

function isRuntimePromptPath(pathPart) {
  const cleanPath = String(pathPart || "").split("?")[0].replace(/\/+$/, "");
  return cleanPath === "prompt" || cleanPath === "/prompt" || cleanPath === "api/prompt" || cleanPath === "/api/prompt";
}

// The rebuilt AI 特效 chain is identified by its source-latent node; the
// retired pipeline had nothing like it. Without this the guard also blocks the
// rebuild, which shares the NovaFlow_AIFX output prefix.
const REBUILT_AIFX_PROMPT_MARKER = "NovaFlowH3VideoToVideoLatent";

function isLegacyAifxRuntimePrompt(pathPart, method, body) {
  if (String(method || "GET").toUpperCase() !== "POST") return false;
  if (!isRuntimePromptPath(pathPart)) return false;
  const text = String(body || "");
  if (!/novaflow[-_]aifx/i.test(text)) return false;
  return !text.includes(REBUILT_AIFX_PROMPT_MARKER);
}

const NOVAFLOW_COMFYUI_API_KEY_ENV = "NOVAFLOW_COMFYUI_API_KEY";
const COMFY_API_PROVIDER_NODE_TYPE_FALLBACK = Object.freeze([
  "KlingVideoNode",
  "KlingFirstLastFrameNode",
  "KlingOmniProImageToVideoNode",
  "ByteDance2ReferenceNode",
  "ByteDance2FirstLastFrameNode",
  "OpenAIGPTImage1",
  "OpenAIGPTImageNodeV2",
  "GeminiImageNode",
  "GeminiImage2Node"
]);
const COMFY_API_PROVIDER_NODE_TYPES = new Set(
  loadComfyWorkflowCreditCostApi()?.SUPPORTED_NODE_TYPES || COMFY_API_PROVIDER_NODE_TYPE_FALLBACK
);

function readWindowsUserEnvValueForRuntime(name) {
  if (process.platform !== "win32") return "";
  try {
    const result = spawnSync("reg.exe", ["query", "HKCU\\Environment", "/v", name], {
      encoding: "utf8",
      windowsHide: true
    });
    if (result.status !== 0) return "";
    const line = String(result.stdout || "")
      .split(/\r?\n/)
      .find((item) => item.trim().startsWith(name));
    if (!line) return "";
    const match = line.match(/REG_\w+\s+(.+)$/);
    return String(match?.[1] || "").trim();
  } catch {
    return "";
  }
}

function readComfyApiKeyForRuntimePrompt() {
  return String(process.env[NOVAFLOW_COMFYUI_API_KEY_ENV] || "").trim() ||
    readWindowsUserEnvValueForRuntime(NOVAFLOW_COMFYUI_API_KEY_ENV);
}

function runtimePromptContainsComfyApiProvider(value) {
  const prompt = value && typeof value === "object" && value.prompt && typeof value.prompt === "object"
    ? value.prompt
    : value;
  if (!prompt || typeof prompt !== "object") return false;
  return Object.values(prompt).some((node) => {
    if (!node || typeof node !== "object") return false;
    return COMFY_API_PROVIDER_NODE_TYPES.has(String(node.class_type || node.classType || node.type || ""));
  });
}

function injectComfyApiCredentialsIntoPromptBody(pathPart, method, body) {
  if (String(method || "GET").toUpperCase() !== "POST") return body;
  if (!isRuntimePromptPath(pathPart)) return body;
  if (!body) return body;
  let payload;
  try {
    payload = JSON.parse(String(body || ""));
  } catch {
    return body;
  }
  if (!runtimePromptContainsComfyApiProvider(payload)) return body;
  const apiKey = readComfyApiKeyForRuntimePrompt();
  if (!apiKey) return body;
  if (!payload.extra_data || typeof payload.extra_data !== "object" || Array.isArray(payload.extra_data)) {
    payload.extra_data = {};
  }
  if (!payload.extra_data.auth_token_comfy_org && !payload.extra_data.api_key_comfy_org) {
    payload.extra_data.api_key_comfy_org = apiKey;
  }
  return JSON.stringify(payload);
}

ipcMain.handle("comfyui-workflow-credit-cost", async (_evt, payload) => {
  const api = loadComfyWorkflowCreditCostApi();
  if (!api || typeof api.estimateWorkflowCreditCost !== "function") {
    return { ok: false, pricing: null, error: "ComfyUI workflow pricing helper is unavailable" };
  }
  const workflow = payload?.workflow && typeof payload.workflow === "object" ? payload.workflow : null;
  if (!workflow) return { ok: false, pricing: null, error: "ComfyUI workflow is required" };
  try {
    return {
      ok: true,
      pricing: api.estimateWorkflowCreditCost(workflow, {
        allowCloudPrompt: Boolean(payload?.allowCloudPrompt)
      })
    };
  } catch (err) {
    return { ok: false, pricing: null, error: String(err?.message || err || "ComfyUI workflow pricing failed") };
  }
});

ipcMain.handle("runtime-request-json", async (_evt, payload) => {
  const baseUrl = resolveRuntimeBaseUrl(payload?.baseUrl || "");
  if (!baseUrl) return { ok: false, error: "invalid baseUrl" };
  const runtimeReady = await ensureNovaFlowRuntimeForBaseUrl(baseUrl, "runtime-request-json");
  if (runtimeReady && runtimeReady.ok === false) return runtimeReady;
  const pathPart = String(payload?.path || "").trim();
  if (!pathPart) return { ok: false, error: "invalid path" };
  const init = payload?.init && typeof payload.init === "object" ? payload.init : {};
  const method = typeof init.method === "string" ? init.method : "GET";
  const headers = init.headers && typeof init.headers === "object" ? init.headers : {};
  const body = typeof init.body === "string" ? init.body : null;
  if (isLegacyAifxRuntimePrompt(pathPart, method, body)) {
    return { ok: false, blocked: true, status: 409, error: "legacy_aifx_runtime_prompt_disabled" };
  }
  const requestBody = injectComfyApiCredentialsIntoPromptBody(pathPart, method, body);

  const controller = new AbortController();
  const abortForShutdown = () => controller.abort();
  if (novaFlowTempJobsAbortController.signal.aborted) controller.abort();
  else novaFlowTempJobsAbortController.signal.addEventListener("abort", abortForShutdown, { once: true });
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const doFetch = async (p) => {
      const url = new URL(p.startsWith("/") ? p : `/${p}`, `${String(baseUrl).replace(/\/$/, "")}/`).toString();
      const res = await fetch(url, { method, headers, body: requestBody, signal: controller.signal });
      const text = await res.text();
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}`, raw: text };
      try {
        return { ok: true, status: res.status, data: JSON.parse(text) };
      } catch {
        return { ok: false, status: res.status, error: "invalid json", raw: text };
      }
    };

    const first = await doFetch(pathPart);
    if (first?.status === 404 && !String(pathPart || "").startsWith("/api/")) {
      const second = await doFetch(`/api${String(pathPart || "").startsWith("/") ? "" : "/"}${String(pathPart || "")}`);
      return second;
    }
    return first;
  } catch (err) {
    const msg = String(err?.name === "AbortError" ? "timeout" : (err?.message || err));
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
    try { novaFlowTempJobsAbortController.signal.removeEventListener("abort", abortForShutdown); } catch { void 0; }
  }
});

ipcMain.handle("runtime-request-binary", async (_evt, payload) => {
  const baseUrl = resolveRuntimeBaseUrl(payload?.baseUrl || "");
  const pathPart = String(payload?.path || "").trim();
  const method = String(payload?.init?.method || "GET").toUpperCase();
  if (!baseUrl || !pathPart) return { ok: false, error: "invalid args" };
  if (method !== "GET" && method !== "HEAD") return { ok: false, error: "method not allowed" };
  const runtimeReady = await ensureNovaFlowRuntimeForBaseUrl(baseUrl, "runtime-request-binary");
  if (runtimeReady && runtimeReady.ok === false) return runtimeReady;

  const timeoutMs = 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const doFetch = async (p) => {
      const url = new URL(p.startsWith("/") ? p : `/${p}`, `${String(baseUrl).replace(/\/$/, "")}/`).toString();
      const res = await fetch(url, { method, signal: controller.signal });
      const buf = Buffer.from(await res.arrayBuffer());
      const b64 = buf.toString("base64");
      const contentType = String(res.headers.get("content-type") || "");
      return { ok: res.ok, status: res.status, dataBase64: b64, contentType };
    };

    const first = await doFetch(pathPart);
    if (first?.status === 404 && !String(pathPart || "").startsWith("/api/")) {
      const second = await doFetch(`/api${String(pathPart || "").startsWith("/") ? "" : "/"}${String(pathPart || "")}`);
      return second;
    }
    return first;
  } catch (err) {
    const msg = String(err?.name === "AbortError" ? "timeout" : (err?.message || err));
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
});

handleNovaFlowTempIpc("runtime-upload-image", async (_evt, payload) => {
  const baseUrl = resolveRuntimeBaseUrl(payload?.baseUrl || "");
  if (!baseUrl) return { ok: false, error: "invalid baseUrl" };
  const runtimeReady = await ensureNovaFlowRuntimeForBaseUrl(baseUrl, "runtime-upload-image");
  if (runtimeReady && runtimeReady.ok === false) return runtimeReady;
  const fileName = sanitizeFileName(payload?.fileName || "");
  if (!fileName) return { ok: false, error: "invalid fileName" };
  const dataBase64 = typeof payload?.dataBase64 === "string" ? payload.dataBase64 : "";
  if (!dataBase64) return { ok: false, error: "invalid data" };
  const type = typeof payload?.type === "string" ? payload.type : "input";
  const subfolder = typeof payload?.subfolder === "string" ? payload.subfolder : "";
  const mimeType = typeof payload?.mimeType === "string" ? payload.mimeType : "";

  const ext = String(path.extname(fileName || "") || "").toLowerCase();
  const guessMime =
    mimeType ||
    (ext === ".png" ? "image/png"
      : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
        : ext === ".webp" ? "image/webp"
          : ext === ".gif" ? "image/gif"
            : "application/octet-stream");

  const controller = new AbortController();
  const abortForShutdown = () => controller.abort();
  if (novaFlowTempJobsAbortController.signal.aborted) controller.abort();
  else novaFlowTempJobsAbortController.signal.addEventListener("abort", abortForShutdown, { once: true });
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    if (typeof FormData === "undefined" || typeof Blob === "undefined") return { ok: false, error: "FormData/Blob not available" };
    const buf = Buffer.from(dataBase64, "base64");
    const form = new FormData();
    const blob = new Blob([buf], { type: guessMime });
    form.append("image", blob, fileName);
    form.append("type", type);
    if (subfolder) form.append("subfolder", subfolder);

    const doUpload = async (p) => {
      const url = new URL(p, `${String(baseUrl).replace(/\/$/, "")}/`).toString();
      const headers = { Accept: "application/json", Origin: String(baseUrl), Referer: `${String(baseUrl).replace(/\/$/, "")}/` };
      const res = await fetch(url, { method: "POST", body: form, headers, signal: controller.signal });
      const text = await res.text();
      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}`, raw: text };
      try {
        return { ok: true, status: res.status, data: JSON.parse(text) };
      } catch {
        return { ok: false, status: res.status, error: "invalid json", raw: text };
      }
    };

    const first = await doUpload("/upload/image");
    if (first?.ok) return first;
    if (first?.status === 404 || first?.status === 403) {
      const second = await doUpload("/api/upload/image");
      if (second?.ok) return second;
      if (second?.status !== 404 && second?.status !== 403) return second;

      const runtimeConfig = readNovaFlowRuntimeConfig();
      const inputDir = runtimeConfig?.installed && runtimeConfig?.ok && runtimeConfig.baseUrl === baseUrl
        ? getNovaFlowRuntimeInputDir()
        : "";
      if (!inputDir) return second;
      try {
        fs.mkdirSync(inputDir, { recursive: true });
        const outPath = path.join(inputDir, fileName);
        fs.writeFileSync(outPath, buf);
        return { ok: true, status: 200, data: { name: fileName, subfolder: "", type: "input" } };
      } catch (err) {
        return { ok: false, status: 500, error: `write input failed`, raw: String(err?.message || err) };
      }
    }
    return first;
  } catch (err) {
    const msg = String(err?.name === "AbortError" ? "timeout" : (err?.message || err));
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
    try { novaFlowTempJobsAbortController.signal.removeEventListener("abort", abortForShutdown); } catch { void 0; }
  }
});

handleNovaFlowTempIpc("ai-seq-fix-head-tail-color", async (evt, payload) => {
  const jobId = typeof payload?.jobId === "string" && payload.jobId.trim()
    ? payload.jobId.trim()
    : `job_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const sendProgress = (data) => {
    try {
      evt.sender.send("ai-seq-fix-head-tail-color-progress", { jobId, ...(data && typeof data === "object" ? data : {}) });
    } catch {}
  };

  const safeBufFromBytes = (bytes) => {
    if (!bytes || typeof bytes !== "object") return null;
    try { return Buffer.from(bytes); } catch { return null; }
  };

  const getExt = (name, fallback) => {
    const ext = String(path.extname(String(name || "")) || "").toLowerCase();
    if (ext && ext.length <= 12 && /^[.\w]+$/.test(ext)) return ext;
    return fallback;
  };

  const cleanupPaths = (arr) => {
    for (const p of arr) {
      try { fs.unlinkSync(p); } catch {}
    }
  };
  const cleanupDir = (dir) => {
    try {
      if (typeof fs.rmSync === "function") fs.rmSync(dir, { recursive: true, force: true });
      else fs.rmdirSync(dir, { recursive: true });
    } catch {}
  };

  let runDir = "";

  try {
    const aName = sanitizeFileName(payload?.videoA?.fileName || "video_a.mp4") || "video_a.mp4";
    const aBuf = safeBufFromBytes(payload?.videoA?.bytes);
    if (!aBuf || aBuf.length <= 0) return { ok: false, error: "video_a 无效" };
    const colorRefBuf = safeBufFromBytes(payload?.colorRefImage?.bytes);

    const durationSecRaw = Number(payload?.durationSec);
    const durationSec = Number.isFinite(durationSecRaw) && durationSecRaw > 0 ? durationSecRaw : NaN;
    const transitionSec = Math.max(0.01, Number.isFinite(durationSec) ? (durationSec / 3) : 1);

    const outNameRaw = sanitizeFileName(payload?.outputFileName || "") || "";
    const outName = outNameRaw && /\.(mp4|mov|webm)$/i.test(outNameRaw) ? outNameRaw : `fix_head_tail_${Date.now()}.mp4`;

    runDir = createNovaFlowTempWorkDir("ai-sequence-head-tail", "head-tail");

    const tmpA = path.join(runDir, `${sanitizeFileStem(aName, "video_a")}${getExt(aName, ".mp4")}`);
    const tmpOut = path.join(runDir, outName);
    fs.writeFileSync(tmpA, aBuf);

    const tempToClean = [tmpA, tmpOut];

    const quoteArg = (s) => {
      const v = String(s ?? "");
      if (!v) return '""';
      if (/[\s"]/g.test(v)) return `"${v.replaceAll('"', '\\"')}"`;
      return v;
    };
    const debugCmd = (args) => `${quoteArg(ffmpegPath)} ${args.map(quoteArg).join(" ")}`;
    try {
      console.log("[ai-seq-fix-head-tail-color] tmpA=", tmpA);
      console.log("[ai-seq-fix-head-tail-color] tmpA bytes=", aBuf.length, "exists=", fs.existsSync(tmpA));
    } catch {}

    const runFfmpegCapture = (args) => new Promise((resolve, reject) => {
      if (!ffmpegPath || typeof ffmpegPath !== "string" || !fs.existsSync(ffmpegPath)) {
        return reject(new Error("ffmpeg 不可用（未内置或打包缺失）"));
      }
      try { console.log("[ai-seq-fix-head-tail-color] ffmpeg cmd:", debugCmd(args)); } catch {}
      const proc = trackNovaFlowCommandChild(spawn(ffmpegPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }));
      const stdoutChunks = [];
      let stderrBuf = "";
      proc.stdout.on("data", (chunk) => { try { stdoutChunks.push(Buffer.from(chunk)); } catch {} });
      proc.stderr.on("data", (chunk) => {
        stderrBuf += String(chunk || "");
        if (stderrBuf.length > 20_000) stderrBuf = stderrBuf.slice(-20_000);
      });
      proc.on("error", (err) => reject(err));
      proc.on("close", (code) => {
        if (code === 0) return resolve({ ok: true, stdout: Buffer.concat(stdoutChunks), stderr: stderrBuf });
        const msg = stderrBuf.trim() ? stderrBuf.trim() : `ffmpeg failed (code ${code})`;
        reject(new Error(msg));
      });
    });

    const clampInt01 = (v) => {
      const n = Number(v) || 0;
      if (n < 0) return 0;
      if (n > 255) return 255;
      return Math.round(n);
    };

    const runFfmpegToFile = (args) => new Promise((resolve, reject) => {
      if (!ffmpegPath || typeof ffmpegPath !== "string" || !fs.existsSync(ffmpegPath)) {
        return reject(new Error("ffmpeg 不可用（未内置或打包缺失）"));
      }
      try { console.log("[ai-seq-fix-head-tail-color] ffmpeg cmd:", debugCmd(args)); } catch {}
      const proc = trackNovaFlowCommandChild(spawn(ffmpegPath, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }));
      let stderrBuf = "";
      proc.stderr.on("data", (chunk) => {
        stderrBuf += String(chunk || "");
        if (stderrBuf.length > 20_000) stderrBuf = stderrBuf.slice(-20_000);
      });
      proc.on("error", (err) => reject(err));
      proc.on("close", (code) => {
        if (code === 0) return resolve({ ok: true, stderr: stderrBuf });
        const msg = stderrBuf.trim() ? stderrBuf.trim() : `ffmpeg failed (code ${code})`;
        reject(new Error(msg));
      });
    });

    const extractFirstPng = async (outPng) => {
      sendProgress({ stage: "analyzing", message: "提取第1帧 PNG…" });
      const r = await runFfmpegToFile([
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", tmpA,
        "-an",
        "-frames:v", "1",
        outPng
      ]);
      const ok = (() => {
        try {
          if (!fs.existsSync(outPng)) return false;
          const st = fs.statSync(outPng);
          return st && st.isFile() && st.size > 0;
        } catch {
          return false;
        }
      })();
      try { console.log("[ai-seq-fix-head-tail-color] first png:", outPng, "ok=", ok, "stderr=", String(r?.stderr || "").slice(0, 240)); } catch {}
      if (!ok) throw new Error(`第1帧 PNG 未生成：${outPng}`);
    };

    const isOkFile = (p) => {
      try {
        if (!fs.existsSync(p)) return false;
        const st = fs.statSync(p);
        return st && st.isFile() && st.size > 0;
      } catch {
        return false;
      }
    };

    const avgRgbFromPng = async (pngPath) => {
      const r = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const w = Number(r?.info?.width || 0);
      const h = Number(r?.info?.height || 0);
      const channels = Number(r?.info?.channels || 0);
      const data = r?.data;
      if (!(w > 0 && h > 0) || channels !== 4 || !data || data.length < w * h * 4) throw new Error("PNG 无效");
      const n = w * h;
      let sr = 0, sg = 0, sb = 0;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        sr += data[o + 0] || 0;
        sg += data[o + 1] || 0;
        sb += data[o + 2] || 0;
      }
      return { r: sr / n, g: sg / n, b: sb / n, w, h };
    };

    const tryExtractTailPng = async (outPng) => {
      const attempts = [];
      attempts.push({
        label: "sseof-0.001",
        seekArgs: ["-sseof", "-0.001"]
      });
      attempts.push({
        label: "sseof-0.1",
        seekArgs: ["-sseof", "-0.1"]
      });
      if (Number.isFinite(durationSec) && durationSec > 0) {
        const ss = Math.max(0, durationSec - 0.05);
        attempts.push({
          label: `ss-${ss.toFixed(3)}`,
          seekArgs: ["-ss", String(ss)]
        });
      }
      let lastErr = null;
      for (const at of attempts) {
        try {
          sendProgress({ stage: "analyzing", message: `提取尾帧 PNG…（${at.label}）` });
          const r = await runFfmpegToFile([
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            ...at.seekArgs,
            "-i", tmpA,
            "-an",
            "-frames:v", "1",
            outPng
          ]);
          const ok = isOkFile(outPng);
          try { console.log("[ai-seq-fix-head-tail-color] tail png:", outPng, "ok=", ok, "label=", at.label, "stderr=", String(r?.stderr || "").slice(0, 240)); } catch {}
          if (!ok) throw new Error(`尾帧 PNG 未生成（${at.label}）：${outPng}`);
          return { label: at.label };
        } catch (e) {
          lastErr = e;
          try { console.log("[ai-seq-fix-head-tail-color] tail extract failed:", at.label, String(e?.message || e)); } catch {}
        }
      }
      throw lastErr || new Error("无法提取尾帧 PNG");
    };

    sendProgress({ stage: "start", progress01: 0 });
    const pngFirst = path.join(runDir, "frame_0001.png");
    const pngTail = path.join(runDir, "frame_last.png");
    await extractFirstPng(pngFirst);
    const tailRes = await tryExtractTailPng(pngTail);
    const pngColorRef = colorRefBuf && colorRefBuf.length > 0 ? path.join(runDir, "color_ref.png") : null;
    if (pngColorRef) {
      try { fs.writeFileSync(pngColorRef, colorRefBuf); } catch { }
    }

    const persistDebug = (srcPath, name) => {
      try {
        if (!isTruthyEnv(process.env.NOVAFLOW_AI_SEQ_DEBUG)) return null;
        if (!isOkFile(srcPath)) return null;
        const dir = path.join(getNovaFlowTempCategoryDir("diagnostics"), "ai-sequence");
        fs.mkdirSync(dir, { recursive: true });
        const out = path.join(dir, `${Date.now()}_${name}`);
        fs.copyFileSync(srcPath, out);
        return out;
      } catch {
        return null;
      }
    };
    const dbgFirst = persistDebug(pngFirst, "frame_0001.png");
    const dbgTail = persistDebug(pngTail, "frame_last.png");
    const dbgColorRef = pngColorRef ? persistDebug(pngColorRef, "color_ref.png") : null;
    try { console.log("[ai-seq-fix-head-tail-color] debug saved:", { dbgFirst, dbgTail, dbgColorRef, tailRes }); } catch {}

    sendProgress({ stage: "running", progress01: 0, message: "开始颜色渐变修复…" });

    const trans = transitionSec.toFixed(4);
    const startSec = (Number.isFinite(durationSec) && durationSec > 0)
      ? Math.max(0, durationSec - transitionSec).toFixed(4)
      : "0";

    sendProgress({ stage: "analyzing", message: "计算首尾帧平均色差…" });
    const startAvg = (pngColorRef && isOkFile(pngColorRef)) ? await avgRgbFromPng(pngColorRef) : await avgRgbFromPng(pngFirst);
    const endAvg = await avgRgbFromPng(pngTail);
    const diffR = (startAvg.r - endAvg.r);
    const diffG = (startAvg.g - endAvg.g);
    const diffB = (startAvg.b - endAvg.b);
    const avgDiff = (Math.abs(diffR) + Math.abs(diffG) + Math.abs(diffB)) / 3;
    const strengthK = avgDiff < 10 ? 1.1 : (avgDiff <= 25 ? 1.2 : 1.3);
    try { console.log("[ai-seq-fix-head-tail-color] avg start=", startAvg, "avg end=", endAvg, "diff=", { diffR, diffG, diffB }, "avgDiff=", avgDiff, "k=", strengthK); } catch {}

    const endHitSec = (Number.isFinite(durationSec) && durationSec > 0)
      ? Math.max(0, durationSec - (1 / 240)).toFixed(6)
      : "0";
    const k = (Number.isFinite(durationSec) && durationSec > 0)
      ? `if(gte(T,${endHitSec}),${strengthK.toFixed(4)},clip((T-${startSec})/${trans}*${strengthK.toFixed(4)},0,${strengthK.toFixed(4)}))`
      : "0";

    const filter = `[0:v]format=rgb24,geq=r='if(gte(T,${startSec}),clip(r(X,Y)+(${diffR.toFixed(4)})*${k},0,255),r(X,Y))':g='if(gte(T,${startSec}),clip(g(X,Y)+(${diffG.toFixed(4)})*${k},0,255),g(X,Y))':b='if(gte(T,${startSec}),clip(b(X,Y)+(${diffB.toFixed(4)})*${k},0,255),b(X,Y))'[v]`;
    try { console.log("[ai-seq-fix-head-tail-color] filter=", filter); } catch {}

    const runFfmpegTranscode = async (outMp4) => {
      sendProgress({ stage: "analyzing", message: "基线转码（无滤镜）…" });
      const baseArgs = [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", tmpA,
        "-map", "0:v:0",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-crf", "18",
        "-preset", "veryfast",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-c:a", "copy",
        ...(Number.isFinite(durationSec) && durationSec > 0 ? ["-t", String(durationSec)] : []),
        outMp4
      ];
      await runFfmpegToFile(baseArgs);
      try { console.log("[ai-seq-fix-head-tail-color] baseline mp4:", outMp4, "exists=", fs.existsSync(outMp4)); } catch {}
    };

    const runFfmpegFirstFrameTest = async (outPng) => {
      sendProgress({ stage: "analyzing", message: "滤镜单帧自检…" });
      const testArgs = [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", tmpA,
        "-filter_complex", filter,
        "-map", "[v]",
        "-frames:v", "1",
        outPng
      ];
      await runFfmpegToFile(testArgs);
      try { console.log("[ai-seq-fix-head-tail-color] test frame png:", outPng, "exists=", fs.existsSync(outPng)); } catch {}
    };

    try {
      const baseline = path.join(runDir, "baseline_no_filter.mp4");
      await runFfmpegTranscode(baseline);
      persistDebug(baseline, "baseline_no_filter.mp4");
    } catch (e) {
      try { console.log("[ai-seq-fix-head-tail-color] baseline transcode failed:", String(e?.message || e)); } catch {}
    }
    try {
      const testPng = path.join(runDir, "test_first_frame_filtered.png");
      await runFfmpegFirstFrameTest(testPng);
      persistDebug(testPng, "test_first_frame_filtered.png");
    } catch (e) {
      try { console.log("[ai-seq-fix-head-tail-color] first-frame test failed:", String(e?.message || e)); } catch {}
    }

    const verifyFirstLastFrameMatch = async (outMp4) => {
      if (!isOkFile(outMp4)) return;
      try {
        sendProgress({ stage: "analyzing", message: "验证首尾帧一致性…" });
        const firstRaw = await runFfmpegCapture([
          "-hide_banner",
          "-loglevel", "error",
          "-y",
          "-i", outMp4,
          "-an",
          "-vf", "scale=1:1:flags=area,format=rgb24",
          "-frames:v", "1",
          "-f", "rawvideo",
          "pipe:1"
        ]);
        let lastRaw = null;
        if (Number.isFinite(durationSec) && durationSec > 0) {
          const ss = Math.max(0, durationSec - (1 / 30));
          lastRaw = await runFfmpegCapture([
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            "-ss", String(ss),
            "-i", outMp4,
            "-an",
            "-vf", "scale=1:1:flags=area,format=rgb24",
            "-frames:v", "1",
            "-f", "rawvideo",
            "pipe:1"
          ]);
        } else {
          lastRaw = await runFfmpegCapture([
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            "-sseof", "-0.25",
            "-i", outMp4,
            "-an",
            "-vf", "scale=1:1:flags=area,format=rgb24",
            "-frames:v", "1",
            "-f", "rawvideo",
            "pipe:1"
          ]);
        }
        const a = firstRaw?.stdout;
        const b = lastRaw?.stdout;
        if (!a || !b || a.length < 3 || b.length < 3) return;
        const dr = Math.abs((a[0] || 0) - (b[0] || 0));
        const dg = Math.abs((a[1] || 0) - (b[1] || 0));
        const db = Math.abs((a[2] || 0) - (b[2] || 0));
        try { console.log("[ai-seq-fix-head-tail-color] verify avgRGB diff=", { dr, dg, db }, "first=", [a[0], a[1], a[2]], "last=", [b[0], b[1], b[2]]); } catch {}
      } catch (e) {
        try { console.log("[ai-seq-fix-head-tail-color] verify failed:", String(e?.message || e)); } catch {}
      }
    };
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", tmpA,
      "-filter_complex", filter,
      "-map", "[v]",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-crf", "18",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-c:a", "copy",
      "-progress", "pipe:1",
      "-nostats",
      tmpOut
    ];

    if (!ffmpegPath || typeof ffmpegPath !== "string" || !fs.existsSync(ffmpegPath)) {
      throw new Error("ffmpeg 不可用（未内置或打包缺失）");
    }
    const proc = trackNovaFlowCommandChild(spawn(ffmpegPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }));

    await new Promise((resolve, reject) => {
      let stdoutBuf = "";
      let stderrBuf = "";
      let lastProgress = -1;

      const emitRatio = (outTimeMs) => {
        if (!Number.isFinite(durationSec) || !(durationSec > 0)) return;
        const ratio = Math.max(0, Math.min(1, (Number(outTimeMs) || 0) / (durationSec * 1_000_000)));
        if (!(ratio >= 0 && ratio <= 1)) return;
        if (Math.abs(ratio - lastProgress) < 0.005) return;
        lastProgress = ratio;
        sendProgress({ stage: "running", progress01: ratio });
      };

      proc.stdout.on("data", (chunk) => {
        stdoutBuf += String(chunk || "");
        for (;;) {
          const idx = stdoutBuf.indexOf("\n");
          if (idx < 0) break;
          const line = stdoutBuf.slice(0, idx).trim();
          stdoutBuf = stdoutBuf.slice(idx + 1);
          if (!line) continue;
          if (line.startsWith("out_time_ms=")) {
            const v = Number(line.slice("out_time_ms=".length));
            if (Number.isFinite(v)) emitRatio(v);
            continue;
          }
          if (line === "progress=end") {
            sendProgress({ stage: "end", progress01: 1 });
            continue;
          }
        }
      });

      proc.stderr.on("data", (chunk) => {
        stderrBuf += String(chunk || "");
        if (stderrBuf.length > 20_000) stderrBuf = stderrBuf.slice(-20_000);
      });

      proc.on("error", (err) => {
        try { cleanupPaths(tempToClean); } catch {}
        cleanupDir(runDir);
        reject(err);
      });

      proc.on("close", (code) => {
        try { console.log("[ai-seq-fix-head-tail-color] ffmpeg close code=", code, "lastProgress=", lastProgress); } catch {}
        if (code === 0) {
          if (lastProgress >= 0.999) sendProgress({ stage: "end", progress01: 1 });
          return resolve();
        }
        const msg = stderrBuf.trim() ? stderrBuf.trim() : `ffmpeg failed (code ${code})`;
        try { cleanupPaths(tempToClean); } catch {}
        cleanupDir(runDir);
        reject(new Error(msg));
      });
    });

    sendProgress({ stage: "analyzing", message: "写入结果…" });
    try { console.log("[ai-seq-fix-head-tail-color] reading output:", tmpOut, "exists=", fs.existsSync(tmpOut)); } catch {}
    await verifyFirstLastFrameMatch(tmpOut);
    const outBuf = fs.readFileSync(tmpOut);
    try { console.log("[ai-seq-fix-head-tail-color] output bytes=", outBuf?.length || 0); } catch {}
    sendProgress({ stage: "end", progress01: 1 });
    cleanupPaths(tempToClean);
    cleanupDir(runDir);
    try { console.log("[ai-seq-fix-head-tail-color] done. return bytes"); } catch {}

    return { ok: true, fileName: outName, bytes: outBuf };
  } catch (err) {
    sendProgress({ stage: "error", error: String(err?.message || err || "unknown error") });
    return { ok: false, error: String(err?.message || err) };
  } finally {
    if (runDir) await cleanupNovaFlowTempWorkDir(runDir, "ai-seq-fix-head-tail-color");
  }
});

handleNovaFlowTempIpc("ai-seq-trim-video-tail-frame", async (_evt, payload) => {
  let workDir = "";
  try {
    const inputPath = String(payload?.inputPath || "").trim();
    const bytesIn = payload?.bytes;
    const inFileName = String(payload?.fileName || "input.mp4");
    const fallbackFpsRaw = Number(payload?.fallbackFps);
    const fallbackFps = Math.max(1, Math.min(120, Math.round(Number.isFinite(fallbackFpsRaw) ? fallbackFpsRaw : 16)));
    if (!ffmpegPath || typeof ffmpegPath !== "string" || !fs.existsSync(ffmpegPath)) return { ok: false, error: "ffmpeg 不可用" };

    workDir = createNovaFlowTempWorkDir("ai-sequence-trim", "trim");
    const safeBufFromBytes = (bytes) => {
      try {
        if (!bytes) return null;
        if (Buffer.isBuffer(bytes)) return bytes;
        if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
        if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (bytes && typeof bytes === "object" && bytes.type === "Buffer" && Array.isArray(bytes.data)) return Buffer.from(bytes.data);
        if (Array.isArray(bytes)) return Buffer.from(bytes);
        return null;
      } catch {
        return null;
      }
    };
    const inPath = (() => {
      if (inputPath && fs.existsSync(inputPath)) return inputPath;
      const buf = safeBufFromBytes(bytesIn);
      if (!buf || buf.length <= 0) return null;
      const ext = (String(inFileName).match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] || ".mp4").toLowerCase();
      const name = `in_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
      const p = path.join(workDir, name);
      fs.writeFileSync(p, buf);
      return p;
    })();
    if (!inPath) return { ok: false, error: "input 无效" };

    const outName = `trim_${Date.now()}_${Math.random().toString(16).slice(2)}.mp4`;
    const outPath = path.join(workDir, outName);

    const parseRational = (s) => {
      try {
        const txt = String(s || "").trim();
        if (!txt) return null;
        if (txt.includes("/")) {
          const [a, b] = txt.split("/");
          const n = Number(a);
          const d = Number(b);
          if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
          return n / d;
        }
        const v = Number(txt);
        return Number.isFinite(v) ? v : null;
      } catch {
        return null;
      }
    };
    const probeVideo = async () => {
      try {
        if (!ffprobePath || typeof ffprobePath !== "string" || !fs.existsSync(ffprobePath)) return null;
        const args = [
          "-v", "error",
          "-select_streams", "v:0",
          "-show_entries", "stream=avg_frame_rate,r_frame_rate,nb_frames",
          "-show_entries", "format=duration",
          "-of", "json",
          inPath
        ];
        const r = await runCmd(ffprobePath, args, { cwd: workDir });
        if (!r.ok) return null;
        const txt = String(r.stdout || "").trim();
        if (!txt) return null;
        const j = JSON.parse(txt);
        const st = Array.isArray(j?.streams) ? j.streams[0] : null;
        const fmt = j?.format || null;
        const fpsA = parseRational(st?.avg_frame_rate);
        const fpsR = parseRational(st?.r_frame_rate);
        const fpsV = (fpsA && fpsA > 0.1) ? fpsA : ((fpsR && fpsR > 0.1) ? fpsR : null);
        const dur = Number(fmt?.duration);
        const durSec = Number.isFinite(dur) && dur > 0 ? dur : null;
        const nb = Number(st?.nb_frames);
        const frames = Number.isFinite(nb) && nb > 0 ? Math.round(nb) : null;
        return { fps: fpsV, durationSec: durSec, frames };
      } catch {
        return null;
      }
    };

    const meta = await probeVideo();
    const fps = (meta && meta.fps && meta.fps > 0.1) ? meta.fps : fallbackFps;
    const durationSec = (meta && meta.durationSec && meta.durationSec > 0) ? meta.durationSec : null;
    const frames = (meta && meta.frames && meta.frames > 0) ? meta.frames : null;

    let r = null;
    if (frames && frames >= 2) {
      const outFps = Math.max(1, Math.min(240, Math.round(Number(fps) || fallbackFps)));
      const targetFrames = Math.max(1, Math.round(frames - 1));
      const encArgs = ["-hide_banner", "-loglevel", "error", "-y", "-i", inPath, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", String(outFps), "-frames:v", String(targetFrames), outPath];
      r = await runCmd(ffmpegPath, encArgs, { cwd: workDir });
    } else {
      if (!durationSec) return { ok: false, error: "读取视频时长失败" };
      const newDur = Math.max(0, durationSec - (1 / fps));
      if (!Number.isFinite(newDur) || newDur <= 0.001) return { ok: false, error: "视频过短，无法裁切" };
      const tStr = newDur.toFixed(6);
      const outFps = Math.max(1, Math.min(240, Math.round(Number(fps) || fallbackFps)));
      const encArgs = ["-hide_banner", "-loglevel", "error", "-y", "-i", inPath, "-t", tStr, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", String(outFps), outPath];
      r = await runCmd(ffmpegPath, encArgs, { cwd: workDir });
    }

    if (!r || !r.ok || !fs.existsSync(outPath)) return { ok: false, error: `ffmpeg 裁切失败：${String((r && (r.stderr || r.stdout)) || "").slice(0, 240)}` };
    const outBuf = fs.readFileSync(outPath);
    return { ok: true, fileName: outName, mimeType: "video/mp4", bytes: outBuf };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "unknown error") };
  } finally {
    if (workDir) await cleanupNovaFlowTempWorkDir(workDir, "ai-seq-trim-video-tail-frame");
  }
});

handleNovaFlowTempIpc("ai-seq-probe-video-meta", async (_evt, payload) => {
  let workDir = "";
  try {
    if (!ffprobePath || typeof ffprobePath !== "string" || !fs.existsSync(ffprobePath)) return { ok: false, error: "ffprobe 不可用" };
    const inputPath = String(payload?.inputPath || "").trim();
    const bytesIn = payload?.bytes;
    const inFileName = String(payload?.fileName || "input.mp4");
    if (!inputPath && !bytesIn) return { ok: false, error: "input 无效" };

    workDir = createNovaFlowTempWorkDir("ai-sequence-probe", "probe");
    const safeBufFromBytes = (bytes) => {
      try {
        if (!bytes) return null;
        if (Buffer.isBuffer(bytes)) return bytes;
        if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
        if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (bytes && typeof bytes === "object" && bytes.type === "Buffer" && Array.isArray(bytes.data)) return Buffer.from(bytes.data);
        if (Array.isArray(bytes)) return Buffer.from(bytes);
        return null;
      } catch {
        return null;
      }
    };
    const inPath = (() => {
      if (inputPath && fs.existsSync(inputPath)) return inputPath;
      const buf = safeBufFromBytes(bytesIn);
      if (!buf || buf.length <= 0) return null;
      const ext = (String(inFileName).match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] || ".mp4").toLowerCase();
      const name = `in_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
      const p = path.join(workDir, name);
      fs.writeFileSync(p, buf);
      return p;
    })();
    if (!inPath) return { ok: false, error: "input 无效" };

    const parseRational = (s) => {
      try {
        const txt = String(s || "").trim();
        if (!txt) return null;
        if (txt.includes("/")) {
          const [a, b] = txt.split("/");
          const n = Number(a);
          const d = Number(b);
          if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
          return n / d;
        }
        const v = Number(txt);
        return Number.isFinite(v) ? v : null;
      } catch {
        return null;
      }
    };

    const args = [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=avg_frame_rate,r_frame_rate,nb_frames",
      "-show_entries", "format=duration",
      "-of", "json",
      inPath
    ];
    const r = await runCmd(ffprobePath, args, { cwd: workDir });
    if (!r.ok) return { ok: false, error: String(r.stderr || r.stdout || "").slice(0, 240) };
    const txt = String(r.stdout || "").trim();
    if (!txt) return { ok: false, error: "ffprobe 输出为空" };
    const j = JSON.parse(txt);
    const st = Array.isArray(j?.streams) ? j.streams[0] : null;
    const fmt = j?.format || null;
    const fpsA = parseRational(st?.avg_frame_rate);
    const fpsR = parseRational(st?.r_frame_rate);
    const fpsV = (fpsA && fpsA > 0.1) ? fpsA : ((fpsR && fpsR > 0.1) ? fpsR : null);
    const dur = Number(fmt?.duration);
    const nb = Number(st?.nb_frames);
    const durationSec = Number.isFinite(dur) && dur > 0 ? dur : null;
    const frames = Number.isFinite(nb) && nb > 0 ? Math.round(nb) : null;
    const fps = (fpsV && fpsV > 0) ? fpsV : null;
    return { ok: true, fps, frames, durationSec };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "unknown error") };
  } finally {
    if (workDir) await cleanupNovaFlowTempWorkDir(workDir, "ai-seq-probe-video-meta");
  }
});

handleNovaFlowTempIpc("ai-seq-rembg-batch", async (evt, payload) => {
  const jobId = typeof payload?.jobId === "string" && payload.jobId.trim()
    ? payload.jobId.trim()
    : `job_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const sendProgress = (data) => {
    try {
      evt.sender.send("ai-seq-rembg-batch-progress", { jobId, ...(data && typeof data === "object" ? data : {}) });
    } catch {}
  };

  const safeBufFromBytes = (bytes) => {
    if (!bytes || typeof bytes !== "object") return null;
    try { return Buffer.from(bytes); } catch { return null; }
  };

  const readJson = (p) => {
    try {
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  };

  const writeJson = (p, obj) => {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(obj || {}, null, 2), "utf8");
    } catch {}
  };

  const cleanupDir = (dir) => {
    try {
      if (typeof fs.rmSync === "function") fs.rmSync(dir, { recursive: true, force: true });
      else fs.rmdirSync(dir, { recursive: true });
    } catch {}
  };

  const pickPython = async () => {
    const candidates = [
      { cmd: "python", argsPrefix: [], versionArgs: ["-V"] },
      { cmd: "py", argsPrefix: ["-3"], versionArgs: ["-3", "-V"] }
    ];
    for (const c of candidates) {
      const r = await runCmd(c.cmd, c.versionArgs);
      if (r.ok) return c;
    }
    return null;
  };

  const envRoot = (() => {
    try {
      return path.join(app.getPath("userData"), "rembg-env");
    } catch {
      return getNovaFlowTempSessionLifecycle().getPersistentFallbackDir("rembg-env");
    }
  })();

  const envMetaPath = path.join(envRoot, "meta.json");
  const venvDir = path.join(envRoot, "venv");
  const venvPython = path.join(venvDir, "Scripts", "python.exe");
  const venvRembgExe = path.join(venvDir, "Scripts", "rembg.exe");

  const birefRoot = (() => {
    try {
      return path.join(app.getPath("userData"), "birefnet-env");
    } catch {
      return getNovaFlowTempSessionLifecycle().getPersistentFallbackDir("birefnet-env");
    }
  })();
  const birefMetaPath = path.join(birefRoot, "meta.json");
  const birefVenvDir = path.join(birefRoot, "venv");
  const birefPython = path.join(birefVenvDir, "Scripts", "python.exe");
  const birefCacheDir = path.join(birefRoot, "hf-cache");
  const BIREFNET_DEPS_VERSION = "2026-06-11-birefnet-pinned-local-v1";
  const BIREFNET_REMOTE_MODEL_ID = "ZhengPeng7/BiRefNet";
  const BIREFNET_BASE_REQUIREMENTS = [
    "transformers==4.44.2",
    "huggingface_hub==0.24.7",
    "accelerate==0.34.2",
    "safetensors==0.4.5",
    "pillow==10.4.0"
  ];
  const BIREFNET_TORCH_REQUIREMENTS = ["torch==2.5.1", "torchvision==0.20.1"];
  const BIREFNET_EXTRA_REQUIREMENTS = ["einops==0.8.0", "timm==1.0.9", "kornia==0.7.3", "kornia-rs==0.1.14"];

  const buildBiRefNetEnv = () => {
    const env = {
      ...(process.env || {}),
      HF_HOME: birefCacheDir,
      HUGGINGFACE_HUB_CACHE: birefCacheDir,
      PYTHONWARNINGS: "ignore::FutureWarning",
      TORCH_HOME: path.join(birefRoot, "torch-cache")
    };
    delete env.TRANSFORMERS_CACHE;
    return env;
  };

  const hasBiRefNetModelFiles = (dir) => {
    try {
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
      if (!fs.existsSync(path.join(dir, "config.json"))) return false;
      return fs.readdirSync(dir).some((name) => /\.(safetensors|bin|pth)$/i.test(String(name || "")));
    } catch {
      return false;
    }
  };

  const pushBiRefNetModelCandidate = (items, seen, modelDir, label) => {
    try {
      const resolved = path.resolve(String(modelDir || ""));
      const key = resolved.toLowerCase();
      if (seen.has(key) || !hasBiRefNetModelFiles(resolved)) return;
      seen.add(key);
      items.push({ modelId: resolved, localFilesOnly: true, label });
    } catch {}
  };

  const resolveBiRefNetModelCandidate = () => {
    const explicit = String(process.env.NOVAFLOW_BIREFNET_MODEL || process.env.NOVAFLOW_BIREFNET_MODEL_DIR || "").trim();
    if (explicit) {
      const explicitPath = path.resolve(explicit);
      if (hasBiRefNetModelFiles(explicitPath)) return { modelId: explicitPath, localFilesOnly: true, label: "env" };
      return { modelId: explicit, localFilesOnly: false, label: "env-remote" };
    }

    const runtimeConfig = readNovaFlowRuntimeConfig();
    const modelRoots = [];
    if (runtimeConfig && runtimeConfig.modelsPath) modelRoots.push(runtimeConfig.modelsPath);
    if (runtimeConfig && runtimeConfig.assetsPath) modelRoots.push(path.join(runtimeConfig.assetsPath, "models"));
    modelRoots.push("E:\\NovaFlow\\models");

    const items = [];
    const seen = new Set();
    for (const root of modelRoots) {
      pushBiRefNetModelCandidate(items, seen, path.join(root, "RMBG", "RMBG-2.0"), "runtime-rmbg-2.0");
      pushBiRefNetModelCandidate(items, seen, path.join(root, "RMBG", "BiRefNet"), "runtime-birefnet");
      pushBiRefNetModelCandidate(items, seen, path.join(root, "BiRefNet"), "runtime-birefnet-flat");
    }
    if (items.length) return items[0];
    return { modelId: BIREFNET_REMOTE_MODEL_ID, localFilesOnly: false, label: "remote" };
  };

  const probeBiRefNetModel = async (pythonExe, modelCandidate) => {
    const candidate = modelCandidate || resolveBiRefNetModelCandidate();
    const probeCode = [
      "import json, sys",
      "import warnings",
      "warnings.filterwarnings('ignore', category=FutureWarning)",
      "model_id = sys.argv[1]",
      "local_files_only = sys.argv[2] == '1'",
      "from transformers import AutoModelForImageSegmentation",
      "model = AutoModelForImageSegmentation.from_pretrained(model_id, trust_remote_code=True, local_files_only=local_files_only)",
      "model.eval()",
      "print(json.dumps({'ok': True, 'model_id': model_id, 'local_files_only': local_files_only}))"
    ].join("\n");
    const result = await runCmd(pythonExe, ["-c", probeCode, candidate.modelId, candidate.localFilesOnly ? "1" : "0"], {
      cwd: birefRoot,
      env: buildBiRefNetEnv()
    });
    if (result.ok) return { ok: true, candidate };
    return { ok: false, candidate, error: String(result.stderr || result.stdout || "").slice(0, 900) };
  };

  const acceptBiRefNetReady = async (pythonExe) => {
    const candidate = resolveBiRefNetModelCandidate();
    const probe = await probeBiRefNetModel(pythonExe, candidate);
    if (!probe.ok) return probe;
    const ready = {
      ok: true,
      pythonExe,
      modelId: candidate.modelId,
      modelLocal: !!candidate.localFilesOnly,
      modelLabel: candidate.label,
      depsVersion: BIREFNET_DEPS_VERSION
    };
    writeJson(birefMetaPath, {
      ready: true,
      pythonExe,
      modelId: candidate.modelId,
      modelLocal: !!candidate.localFilesOnly,
      modelLabel: candidate.label,
      depsVersion: BIREFNET_DEPS_VERSION,
      updatedAt: Date.now()
    });
    aiCutoutReadyCache.birefnet = ready;
    return ready;
  };

  const ensureBiRefNetReady = async () => {
    const cached = aiCutoutReadyCache.birefnet;
    if (cached && typeof cached.pythonExe === "string" && fs.existsSync(cached.pythonExe)) {
      return {
        ok: true,
        pythonExe: cached.pythonExe,
        modelId: cached.modelId,
        modelLocal: cached.modelLocal,
        modelLabel: cached.modelLabel
      };
    }

    const meta0 = readJson(birefMetaPath) || {};
    if (meta0 && meta0.ready && typeof meta0.pythonExe === "string" && fs.existsSync(meta0.pythonExe)) {
      const ready = await acceptBiRefNetReady(meta0.pythonExe);
      if (ready.ok) return ready;
    }

    const py = await pickPython();
    if (!py) {
      return { ok: false, error: "未找到可用的 Python（请安装 Python 3）。BiRefNet 需要系统已安装 Python。" };
    }

    fs.mkdirSync(birefRoot, { recursive: true });
    if (!fs.existsSync(birefPython)) {
      sendProgress({ state: "running", stage: "install", message: "正在安装AI抠图组件（BiRefNet），首次使用会下载较大依赖，请稍候...", progress01: 0.03 });
      const cr = await runCmd(py.cmd, [...py.argsPrefix, "-m", "venv", birefVenvDir], { cwd: birefRoot });
      if (!cr.ok) return { ok: false, error: `创建 BiRefNet 虚拟环境失败：${String(cr.stderr || cr.stdout || "").slice(0, 520)}` };
    }

    const pipProbe = await runCmd(birefPython, ["-m", "pip", "-V"], { cwd: birefRoot });
    if (!pipProbe.ok) {
      const ep = await runCmd(birefPython, ["-m", "ensurepip", "--upgrade"], { cwd: birefRoot });
      if (!ep.ok) return { ok: false, error: `pip 初始化失败：${String(ep.stderr || ep.stdout || "").slice(0, 520)}` };
    }

    const probe0 = await probeBiRefNetModel(birefPython);
    if (probe0.ok) {
      return await acceptBiRefNetReady(birefPython);
    }

    sendProgress({ state: "running", stage: "install", message: "正在安装AI抠图组件（BiRefNet），首次使用会下载较大依赖，请稍候...", progress01: 0.06 });
    const pipBase = ["-m", "pip", "install", "--upgrade", "-i", "https://pypi.tuna.tsinghua.edu.cn/simple"];
    const hasNvidia = (() => {
      try { return fs.existsSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "nvidia-smi.exe")); } catch { return false; }
    })();
    const torchIndex = hasNvidia ? "https://download.pytorch.org/whl/cu121" : "https://download.pytorch.org/whl/cpu";
    const torchInstall = await runCmd(birefPython, ["-m", "pip", "install", "--upgrade", ...BIREFNET_TORCH_REQUIREMENTS, "--index-url", torchIndex], { cwd: birefRoot });
    if (!torchInstall.ok) {
      const torchCpu = await runCmd(birefPython, ["-m", "pip", "install", "--upgrade", ...BIREFNET_TORCH_REQUIREMENTS, "--index-url", "https://download.pytorch.org/whl/cpu"], { cwd: birefRoot });
      if (!torchCpu.ok) {
        const errTxt = String(torchCpu.stderr || torchCpu.stdout || torchInstall.stderr || torchInstall.stdout || "");
        return { ok: false, error: `BiRefNet 依赖安装失败（torch/torchvision）：${errTxt.slice(0, 520)}` };
      }
    }

    const baseInstall = await runCmd(birefPython, [...pipBase, ...BIREFNET_BASE_REQUIREMENTS], { cwd: birefRoot });
    if (!baseInstall.ok) {
      const errTxt = String(baseInstall.stderr || baseInstall.stdout || "");
      return { ok: false, error: `BiRefNet 依赖安装失败：${errTxt.slice(0, 520)}` };
    }

    sendProgress({ state: "running", stage: "install", message: "正在安装AI抠图组件（BiRefNet）依赖…", progress01: 0.12 });
    const extraInstall = await runCmd(birefPython, [...pipBase, "--force-reinstall", "--no-deps", ...BIREFNET_EXTRA_REQUIREMENTS], { cwd: birefRoot });
    if (!extraInstall.ok) {
      const errTxt = String(extraInstall.stderr || extraInstall.stdout || "");
      return { ok: false, error: `BiRefNet 依赖安装失败（einops/timm/kornia）：${errTxt.slice(0, 520)}` };
    }

    const probe1 = await acceptBiRefNetReady(birefPython);
    if (!probe1.ok) {
      const errTxt = String(probe1.error || "");
      return { ok: false, error: `BiRefNet 安装后仍不可用：${errTxt.slice(0, 520)}` };
    }

    return probe1;
  };

  const ensureRembgReady = async () => {
    const cached = aiCutoutReadyCache.rembg;
    if (cached && typeof cached.pythonExe === "string" && fs.existsSync(cached.pythonExe) && fs.existsSync(venvRembgExe)) {
      return { ok: true, pythonExe: cached.pythonExe, runtime: cached.runtime || null };
    }

    const ensureCudaPreloadHook = () => {
      const hookDir = path.join(envRoot, "cuda-preload");
      try {
        fs.mkdirSync(hookDir, { recursive: true });
        fs.writeFileSync(path.join(hookDir, "sitecustomize.py"), [
          "try:",
          "    import os, site",
          "    from pathlib import Path",
          "    for root in site.getsitepackages():",
          "        try:",
          "            for dll_dir in Path(root).glob('nvidia/*/bin'):",
          "                try:",
          "                    os.add_dll_directory(str(dll_dir))",
          "                except Exception:",
          "                    pass",
          "                os.environ['PATH'] = str(dll_dir) + os.pathsep + os.environ.get('PATH', '')",
          "        except Exception:",
          "            pass",
          "    import onnxruntime as ort",
          "    for kwargs in ({}, {'directory': ''}):",
          "        try:",
          "            ort.preload_dlls(**kwargs)",
          "        except Exception:",
          "            pass",
          "except Exception:",
          "    pass",
          ""
        ].join("\n"), "utf8");
        return hookDir;
      } catch {
        return "";
      }
    };

    const probeRuntime = async (pythonExe) => {
      try {
        const probeCode = [
          "import json",
          "import os, site",
          "from pathlib import Path",
          "dll_dirs = []",
          "for root in site.getsitepackages():",
          "    try:",
          "        for dll_dir in Path(root).glob('nvidia/*/bin'):",
          "            try:",
          "                os.add_dll_directory(str(dll_dir))",
          "            except Exception:",
          "                pass",
          "            os.environ['PATH'] = str(dll_dir) + os.pathsep + os.environ.get('PATH', '')",
          "            dll_dirs.append(str(dll_dir))",
          "    except Exception:",
          "        pass",
          "import onnxruntime as ort",
          "errors = []",
          "for kwargs in ({}, {'directory': ''}):",
          "    try:",
          "        ort.preload_dlls(**kwargs)",
          "    except Exception as e:",
          "        errors.append(str(e))",
          "smoke_ok = False",
          "smoke_error = ''",
          "if 'CUDAExecutionProvider' in ort.get_available_providers():",
          "    try:",
          "        import io",
          "        from PIL import Image",
          "        from rembg.session_factory import new_session",
          "        from rembg.bg import remove",
          "        buf = io.BytesIO()",
          "        Image.new('RGB', (8, 8), (128, 128, 128)).save(buf, format='PNG')",
          "        session = new_session('isnet-general-use', providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])",
          "        try:",
          "            session.inner_session.disable_fallback()",
          "        except Exception:",
          "            pass",
          "        remove(buf.getvalue(), session=session)",
          "        smoke_ok = 'CUDAExecutionProvider' in session.inner_session.get_providers()",
          "    except Exception as e:",
          "        smoke_error = str(e)",
          "print(json.dumps({'providers': ort.get_available_providers(), 'device': ort.get_device(), 'preloadErrors': errors, 'cudaSmokeOk': smoke_ok, 'cudaSmokeError': smoke_error, 'dllDirs': dll_dirs[:12]}))"
        ].join("\n");
        const runtimeModelCacheDir = path.join(envRoot, "models");
        try { fs.mkdirSync(runtimeModelCacheDir, { recursive: true }); } catch {}
        const r = await runCmd(pythonExe, ["-c", probeCode], {
          cwd: envRoot,
          env: { ...(process.env || {}), U2NET_HOME: runtimeModelCacheDir }
        });
        const out = String(r.stdout || "").trim();
        const jsonLine = out.split(/\r?\n/).reverse().find((line) => /^\s*\{/.test(line || ""));
        let parsed = null;
        try { parsed = jsonLine ? JSON.parse(jsonLine) : null; } catch {}
        const providers = Array.isArray(parsed?.providers)
          ? parsed.providers.map((v) => String(v || "").trim()).filter(Boolean)
          : (r.ok ? out.split("|").map((v) => v.trim()).filter(Boolean) : []);
        const device = String(parsed?.device || "").trim();
        const providerHasCuda = providers.includes("CUDAExecutionProvider");
        const cudaSmokeOk = providerHasCuda ? parsed?.cudaSmokeOk === true : false;
        const hasCuda = providerHasCuda && cudaSmokeOk;
        const runtime = {
          providers,
          device,
          hasCuda,
          hasCpu: providers.includes("CPUExecutionProvider"),
          cudaSmokeOk,
          cudaSmokeError: String(parsed?.cudaSmokeError || "").slice(0, 520),
          cudaDllDirs: Array.isArray(parsed?.dllDirs) ? parsed.dllDirs.slice(0, 12) : [],
          preloadErrors: Array.isArray(parsed?.preloadErrors) ? parsed.preloadErrors.slice(0, 3) : []
        };
        if (providerHasCuda) runtime.cudaPreloadDir = ensureCudaPreloadHook();
        return runtime;
      } catch {
        return { providers: [], device: "", hasCuda: false, hasCpu: false, preloadErrors: [] };
      }
    };

    const hasNvidiaGpu = async () => {
      const candidates = [
        "nvidia-smi",
        path.join(process.env.SystemRoot || "C:\\Windows", "System32", "nvidia-smi.exe")
      ];
      for (const cmd of candidates) {
        const r = await runCmd(cmd, ["-L"], { cwd: envRoot });
        const txt = `${r.stdout || ""}\n${r.stderr || ""}`;
        if (r.ok && /NVIDIA|GPU\s+\d+:/i.test(txt)) return true;
      }
      return false;
    };

    const repairRembgGpuRuntime = async (pythonExe, meta) => {
      const attemptedAt = Date.now();
      const lastAttempt = Number(meta?.gpuRepairAttemptedAt || 0);
      if (lastAttempt && (attemptedAt - lastAttempt) < 7 * 24 * 60 * 60 * 1000) {
        return { attempted: false, skipped: "recent" };
      }
      if (!(await hasNvidiaGpu())) return { attempted: false, skipped: "no-nvidia-gpu" };
      sendProgress({ state: "running", stage: "install", message: "正在配置 AI 抠图 GPU 加速...", progress01: 0.08 });
      const pipBase = ["-m", "pip", "install", "-U", "-i", "https://pypi.tuna.tsinghua.edu.cn/simple"];
      await runCmd(pythonExe, ["-m", "pip", "uninstall", "-y", "onnxruntime"], { cwd: envRoot });
      const gpuCore = await runCmd(pythonExe, ["-m", "pip", "install", "-U", "--force-reinstall", "--no-deps", "-i", "https://pypi.tuna.tsinghua.edu.cn/simple", "onnxruntime-gpu"], { cwd: envRoot });
      const gpuDeps = gpuCore.ok
        ? await runCmd(pythonExe, [...pipBase, "onnxruntime-gpu[cuda,cudnn]"], { cwd: envRoot })
        : { ok: false, stdout: "", stderr: "onnxruntime-gpu install failed" };
      if (!gpuCore.ok || !gpuDeps.ok) {
        await runCmd(pythonExe, [...pipBase, "rembg[cpu,cli]", "onnxruntime"], { cwd: envRoot });
        return {
          attempted: true,
          ok: false,
          attemptedAt,
          error: String(gpuDeps.stderr || gpuDeps.stdout || gpuCore.stderr || gpuCore.stdout || "").slice(0, 520)
        };
      }
      const runtime = await probeRuntime(pythonExe);
      return { attempted: true, ok: !!runtime.hasCuda, attemptedAt, runtime };
    };

    const finishRembgReady = async (pythonExe, meta) => {
      let runtime = await probeRuntime(pythonExe);
      const patch = {};
      if (!runtime.hasCuda) {
        const repair = await repairRembgGpuRuntime(pythonExe, meta || {});
        if (repair.attempted) {
          patch.gpuRepairAttemptedAt = repair.attemptedAt;
          patch.gpuRepairOk = !!repair.ok;
          if (repair.error) patch.gpuRepairError = repair.error;
          runtime = repair.runtime || await probeRuntime(pythonExe);
        }
      }
      const nextMeta = {
        ...(readJson(envMetaPath) || {}),
        ...(meta || {}),
        ...patch,
        ready: true,
        pythonExe,
        runtime,
        updatedAt: Date.now()
      };
      writeJson(envMetaPath, nextMeta);
      aiCutoutReadyCache.rembg = { pythonExe, runtime };
      return {
        ok: true,
        pythonExe,
        runtime
      };
    };

    const probeCliOk = async () => {
      if (!fs.existsSync(venvRembgExe)) return false;
      const r = await runCmd(venvRembgExe, ["--help"], { cwd: envRoot });
      const txt = String(r.stderr || r.stdout || "");
      if (/cli dependencies are not installed/i.test(txt)) return false;
      return r.ok;
    };

    const meta0 = readJson(envMetaPath) || {};
    if (meta0 && meta0.ready && typeof meta0.pythonExe === "string" && fs.existsSync(meta0.pythonExe)) {
      const probe = await runCmd(meta0.pythonExe, ["-c", "import rembg; print('ok')"], { cwd: envRoot });
      if (probe.ok && (await probeCliOk())) {
        return await finishRembgReady(meta0.pythonExe, meta0);
      }
    }

    const py = await pickPython();
    if (!py) {
      return { ok: false, error: "未找到可用的 Python（请安装 Python 3）。NovaFlow 会在首次使用时自动安装 AI 抠图组件，但需要系统已安装 Python。" };
    }

    fs.mkdirSync(envRoot, { recursive: true });

    if (!fs.existsSync(venvPython)) {
      sendProgress({ state: "running", stage: "install", message: "正在安装AI抠图组件，请稍候...", progress01: 0.03 });
      const cr = await runCmd(py.cmd, [...py.argsPrefix, "-m", "venv", venvDir], { cwd: envRoot });
      if (!cr.ok) return { ok: false, error: `创建 Python 虚拟环境失败：${String(cr.stderr || cr.stdout || "").slice(0, 400)}` };
    }

    const pipProbe = await runCmd(venvPython, ["-m", "pip", "-V"], { cwd: envRoot });
    if (!pipProbe.ok) {
      const ep = await runCmd(venvPython, ["-m", "ensurepip", "--upgrade"], { cwd: envRoot });
      if (!ep.ok) return { ok: false, error: `pip 初始化失败：${String(ep.stderr || ep.stdout || "").slice(0, 400)}` };
    }

    const rembgProbe = await runCmd(venvPython, ["-c", "import rembg; print('ok')"], { cwd: envRoot });
    if (rembgProbe.ok) {
      if (!fs.existsSync(venvRembgExe) || !(await probeCliOk())) {
        sendProgress({ state: "running", stage: "install", message: "正在安装AI抠图组件，请稍候...", progress01: 0.06 });
        const installArgs = ["-m", "pip", "install", "-U", "-i", "https://pypi.tuna.tsinghua.edu.cn/simple", "rembg[cli]"];
        const cliRes = await runCmd(venvPython, installArgs, { cwd: envRoot });
        if (!cliRes.ok) {
           return { ok: false, error: `补全 CLI 依赖失败：${String(cliRes.stderr || cliRes.stdout || "").slice(0, 520)}` };
        }
      }
      if (!fs.existsSync(venvRembgExe) || !(await probeCliOk())) {
        // 获取 probeCliOk 的真实错误以便排查
        const testRes = await runCmd(venvRembgExe, ["--help"], { cwd: envRoot });
        const testLog = String(testRes.stderr || testRes.stdout || "");
        return { ok: false, error: `AI抠图组件安装不完整（CLI 依赖缺失），详细错误: ${testLog.slice(0, 400)}` };
      }
      return await finishRembgReady(venvPython, { ready: true, pythonExe: venvPython });
    }

    sendProgress({ state: "running", stage: "install", message: "正在安装AI抠图组件，请稍候...", progress01: 0.06 });
    const pipArgsBase = ["-m", "pip", "install", "-U", "-i", "https://pypi.tuna.tsinghua.edu.cn/simple"];
    const gpuInstall = await runCmd(venvPython, [...pipArgsBase, "rembg[gpu,cli]", "onnxruntime-gpu", "onnxruntime-gpu[cuda,cudnn]"], { cwd: envRoot });
    if (!gpuInstall.ok) {
      const cpuInstall = await runCmd(venvPython, [...pipArgsBase, "rembg[cpu,cli]", "onnxruntime"], { cwd: envRoot });
      if (!cpuInstall.ok) {
        const errTxt = String(cpuInstall.stderr || cpuInstall.stdout || gpuInstall.stderr || gpuInstall.stdout || "");
        return { ok: false, error: `AI抠图组件安装失败：${errTxt.slice(0, 520)}` };
      }
    }

    const finalProbe = await runCmd(venvPython, ["-c", "import rembg; print('ok')"], { cwd: envRoot });
    if (!finalProbe.ok) {
      const errTxt = String(finalProbe.stderr || finalProbe.stdout || "");
      return { ok: false, error: `AI抠图组件安装后仍不可用：${errTxt.slice(0, 520)}` };
    }
    if (!fs.existsSync(venvRembgExe) || !(await probeCliOk())) {
      // 补救安装 CLI
      await runCmd(venvPython, [...pipArgsBase, "rembg[cli]"], { cwd: envRoot });
    }
    if (!fs.existsSync(venvRembgExe) || !(await probeCliOk())) {
      const testRes = await runCmd(venvRembgExe, ["--help"], { cwd: envRoot });
      const testLog = String(testRes.stderr || testRes.stdout || "");
      return { ok: false, error: `AI抠图组件安装不完整（CLI 依赖缺失），详细错误: ${testLog.slice(0, 400)}` };
    }

    return await finishRembgReady(venvPython, { ready: true, pythonExe: venvPython });
  };

  try {
    const requestedBackend = String(payload?.backend || "birefnet").toLowerCase();
    const allowLegacyRembg = String(process.env.NOVAFLOW_ENABLE_LEGACY_REMBG || "").trim() === "1";
    const backend0 = requestedBackend === "rembg" && allowLegacyRembg ? "rembg" : "birefnet";
    if (requestedBackend !== backend0) {
      appendLogLine("info", "ai-cutout-rembg-routed-to-birefnet", { jobId, requestedBackend, backend: backend0 });
    }
    const kind = String(payload?.kind || "video");
    const fpsRaw = Number(payload?.fps);
    let fps = Number.isFinite(fpsRaw) && fpsRaw > 0 ? Math.max(1, Math.min(120, Math.round(fpsRaw))) : 30;
    const framesRaw = Number(payload?.totalFrames);
    let totalFrames = Number.isFinite(framesRaw) && framesRaw > 0 ? Math.max(1, Math.min(100000, Math.round(framesRaw))) : 0;
    const normalizeFramePlan = (plan0) => {
      try {
        const plan = plan0 && typeof plan0 === "object" ? plan0 : {};
        const rawIndices = Array.isArray(plan.sourceFrameIndices)
          ? plan.sourceFrameIndices
          : (Array.isArray(payload?.sourceFrameIndices) ? payload.sourceFrameIndices : null);
        if (!rawIndices || !rawIndices.length) return null;
        const sourceFrameIndices = rawIndices.map((v) => Number(v));
        if (sourceFrameIndices.some((v) => !Number.isInteger(v) || v < 0)) return null;
        if (new Set(sourceFrameIndices).size !== sourceFrameIndices.length) return null;
        const rawTimes = Array.isArray(plan.frameTimes)
          ? plan.frameTimes
          : (Array.isArray(payload?.frameTimes) ? payload.frameTimes : null);
        const frameTimes = rawTimes
          ? rawTimes.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v >= 0)
          : null;
        if (frameTimes && frameTimes.length !== sourceFrameIndices.length) return null;
        return { sourceFrameIndices, frameTimes };
      } catch {
        return null;
      }
    };
    const canonicalFramePlan = normalizeFramePlan(payload?.framePlan);
    if (canonicalFramePlan) totalFrames = Math.max(1, Math.min(100000, canonicalFramePlan.sourceFrameIndices.length));

    if (!ffmpegPath || typeof ffmpegPath !== "string" || !fs.existsSync(ffmpegPath)) {
      return { ok: false, error: "ffmpeg 不可用（未内置或打包缺失）" };
    }

    const workDir = createNovaFlowTempWorkDir("rembg-job", "rembg");
    const cleanup = () => cleanupNovaFlowTempWorkDir(workDir, "ai-seq-rembg-batch");

    try {
      sendProgress({ state: "running", stage: "prepare", message: "准备中…", progress01: 0.01 });
      const isBirefnet = backend0 === "birefnet";
      const env = isBirefnet ? await ensureBiRefNetReady() : await ensureRembgReady();
      if (novaFlowAppShuttingDown) throw new Error("app_shutting_down");
      if (!env.ok) return { ok: false, error: String(env.error || "AI抠图组件不可用") };
      const pythonExe = env.pythonExe;
      const rembgExe = !isBirefnet ? (fs.existsSync(venvRembgExe) ? venvRembgExe : path.join(path.dirname(pythonExe || ""), "rembg.exe")) : null;
      if (!isBirefnet) {
        if (!rembgExe || !fs.existsSync(rembgExe)) return { ok: false, error: "AI抠图组件不可用（rembg.exe 缺失）" };
      }
      const rembgModels = ["isnet-general-use", "u2net_human_seg", "u2net"];
      const modelCacheDir = path.join(envRoot, "models");
      try { fs.mkdirSync(modelCacheDir, { recursive: true }); } catch {}
      const rembgEnv = { ...(process.env || {}), U2NET_HOME: modelCacheDir };
      const rembgCudaRuntime = !isBirefnet && !!env?.runtime?.hasCuda;
      const cudaPreloadDir = rembgCudaRuntime ? String(env?.runtime?.cudaPreloadDir || "") : "";
      if (cudaPreloadDir && fs.existsSync(cudaPreloadDir)) {
        rembgEnv.PYTHONPATH = rembgEnv.PYTHONPATH
          ? `${cudaPreloadDir}${path.delimiter}${rembgEnv.PYTHONPATH}`
          : cudaPreloadDir;
      }
      const rembgProviderArgs = rembgCudaRuntime
        ? ["-x", JSON.stringify({ providers: ["CUDAExecutionProvider", "CPUExecutionProvider"] })]
        : [];
      const buildRembgArgs = (mode, model, ...paths0) => [mode, "-m", model, ...rembgProviderArgs, ...paths0];
      if (!isBirefnet) {
        appendLogLine("info", "ai-cutout-rembg-runtime", {
          jobId,
          providers: env?.runtime?.providers || [],
          device: env?.runtime?.device || "",
          usingCuda: rembgCudaRuntime,
          cudaSmokeOk: env?.runtime?.cudaSmokeOk === true,
          cudaSmokeError: env?.runtime?.cudaSmokeError || ""
        });
      }
      const isAlphaTrivial = (alphaBuf) => {
        try {
          const len = alphaBuf?.length || 0;
          if (!len) return true;
          let c0 = 0;
          let c255 = 0;
          for (let i = 0; i < len; i++) {
            const v = alphaBuf[i] || 0;
            if (v === 0) c0++;
            else if (v === 255) c255++;
          }
          const p0 = c0 / len;
          const p255 = c255 / len;
          return p0 >= 0.999 || p255 >= 0.999;
        } catch {
          return true;
        }
      };
      const runRembgWithPolling = (args, { model, outDir, expectedCount, displayTotalCount, progressStart01, progressEnd01 }) => {
        return new Promise((resolve) => {
          if (novaFlowAppShuttingDown) {
            resolve({ ok: false, code: -3, killed: true, stdout: "", stderr: "app_shutting_down" });
            return;
          }
          let out = "";
          let err = "";
          let killed = false;
          const startedAt = Date.now();
          let lastIoAt = startedAt;
          let lastCountAt = startedAt;
          let lastCount = 0;
          let p = null;
          const safeCount = () => {
            try {
              if (!outDir) return 0;
              if (!fs.existsSync(outDir)) return 0;
              return fs.readdirSync(outDir).filter((n) => /\.png$/i.test(n)).length;
            } catch {
              return 0;
            }
          };
          const tick = () => {
            const now = Date.now();
            const count = safeCount();
            if (count !== lastCount) {
              lastCount = count;
              lastCountAt = now;
            }
            const span = Math.max(0.01, (progressEnd01 ?? 0.7) - (progressStart01 ?? 0.35));
            const ratio = expectedCount > 0 ? Math.max(0, Math.min(1, count / expectedCount)) : 0;
            const progress01 = (progressStart01 ?? 0.35) + span * ratio;
            const elapsedSec = Math.max(0, Math.round((now - startedAt) / 1000));
            const totalDisplay = Number.isFinite(Number(displayTotalCount)) && Number(displayTotalCount) > expectedCount
              ? Math.round(Number(displayTotalCount))
              : 0;
            const countText = totalDisplay
              ? `唯一帧 ${count}/${expectedCount}，总帧 ${totalDisplay}`
              : `${count}/${expectedCount}`;
            const waitingText = totalDisplay
              ? `唯一帧 ${expectedCount}，总帧 ${totalDisplay}`
              : `首次使用会下载模型`;
            const msg = expectedCount > 0
              ? (count > 0 ? `AI 分割中…（${model}）${countText}` : `AI 分割准备中…（${model}，${waitingText}）${elapsedSec}s`)
              : `AI 分割中…（${model}）`;
            sendProgress({ state: "running", stage: "rembg", message: msg, progress01 });

            const noIoMs = now - lastIoAt;
            const noCountMs = now - lastCountAt;
            if (!killed) {
              if (count === 0 && noIoMs > 4 * 60 * 1000 && (now - startedAt) > 4 * 60 * 1000) {
                killed = true;
                try { p?.kill(); } catch {}
              }
              if (count > 0 && noCountMs > 2 * 60 * 1000 && noIoMs > 2 * 60 * 1000) {
                killed = true;
                try { p?.kill(); } catch {}
              }
              if ((now - startedAt) > 20 * 60 * 1000) {
                killed = true;
                try { p?.kill(); } catch {}
              }
            }
          };

          let interval = null;
          try {
            p = trackNovaFlowCommandChild(spawn(rembgExe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], cwd: workDir, env: rembgEnv }));
            interval = setInterval(tick, 700);
            p.stdout.on("data", (d) => { try { out += String(d); } catch {} lastIoAt = Date.now(); });
            p.stderr.on("data", (d) => { try { err += String(d); } catch {} lastIoAt = Date.now(); });
            p.on("close", (code) => {
              try { if (interval) clearInterval(interval); } catch {}
              tick();
              resolve({ ok: code === 0 && !killed, code: code || 0, killed, stdout: out, stderr: err });
            });
          } catch (e) {
            try { if (interval) clearInterval(interval); } catch {}
            resolve({ ok: false, code: -1, killed: false, stdout: "", stderr: String(e?.message || e) });
          }
        });
      };

      const rembgModelLikelyCached = (model) => {
        try {
          const target = `${String(model || "").toLowerCase()}.onnx`;
          if (!target || !fs.existsSync(modelCacheDir)) return false;
          return fs.readdirSync(modelCacheDir).some((name) => String(name || "").toLowerCase() === target);
        } catch {
          return false;
        }
      };

      const getRembgParallelWorkerCount = (expectedCount) => {
        const cpus = Array.isArray(os.cpus()) ? os.cpus().length : 1;
        if (expectedCount < 24 || cpus < 6) return 1;
        return 2;
      };

      const runRembgParallelModelFolder = (model, inDir, outDir, expectedCount, workerCount) => {
        return new Promise((resolve) => {
          if (novaFlowAppShuttingDown) {
            resolve({ ok: false, code: -3, killed: true, stdout: "", stderr: "app_shutting_down" });
            return;
          }
          let files = [];
          try {
            files = fs.readdirSync(inDir).filter((n) => /\.png$/i.test(n)).sort();
          } catch {}
          if (!files.length || workerCount <= 1) {
            resolve({ ok: false, code: -1, stdout: "", stderr: "parallel rembg skipped" });
            return;
          }

          const chunks = Array.from({ length: Math.min(workerCount, files.length) }, () => []);
          for (let i = 0; i < files.length; i++) chunks[i % chunks.length].push(files[i]);

          const procs = [];
          const results = [];
          let out = "";
          let err = "";
          let closed = 0;
          let killed = false;
          const startedAt = Date.now();
          let lastIoAt = startedAt;
          let lastCountAt = startedAt;
          let lastCount = 0;

          let chunkDirs = [];
          try {
            chunkDirs = chunks.map((chunk, index) => {
              const chunkIn = path.join(workDir, `rembg_chunk_${index}_in`);
              const chunkOut = path.join(workDir, `rembg_chunk_${index}_out`);
              cleanupDir(chunkIn);
              cleanupDir(chunkOut);
              fs.mkdirSync(chunkIn, { recursive: true });
              fs.mkdirSync(chunkOut, { recursive: true });
              for (const name of chunk) fs.copyFileSync(path.join(inDir, name), path.join(chunkIn, name));
              return { chunk, chunkIn, chunkOut };
            });
          } catch (e) {
            resolve({ ok: false, code: -1, stdout: "", stderr: String(e?.message || e) });
            return;
          }

          const safeCount = () => {
            let count = 0;
            try {
              for (const dir of chunkDirs) {
                if (fs.existsSync(dir.chunkOut)) {
                  count += fs.readdirSync(dir.chunkOut).filter((n) => /\.png$/i.test(n)).length;
                }
              }
            } catch {}
            return count;
          };

          const tick = () => {
            const now = Date.now();
            const count = safeCount();
            if (count !== lastCount) {
              lastCount = count;
              lastCountAt = now;
            }
            const span = Math.max(0.01, 0.69 - 0.35);
            const ratio = expectedCount > 0 ? Math.max(0, Math.min(1, count / expectedCount)) : 0;
            sendProgress({ state: "running", stage: "rembg", progress01: 0.35 + span * ratio });

            const noIoMs = now - lastIoAt;
            const noCountMs = now - lastCountAt;
            if (!killed) {
              if (count === 0 && noIoMs > 4 * 60 * 1000 && (now - startedAt) > 4 * 60 * 1000) killed = true;
              if (count > 0 && noCountMs > 2 * 60 * 1000 && noIoMs > 2 * 60 * 1000) killed = true;
              if ((now - startedAt) > 20 * 60 * 1000) killed = true;
              if (killed) {
                for (const proc of procs) {
                  try { proc.kill(); } catch {}
                }
              }
            }
          };

          const finish = (interval) => {
            try { if (interval) clearInterval(interval); } catch {}
            tick();
            const failed = results.some((r) => !r || !r.ok) || killed;
            if (failed) {
              resolve({ ok: false, code: -1, killed, stdout: out, stderr: err || "parallel rembg failed" });
              return;
            }
            try {
              for (const dir of chunkDirs) {
                for (const name of dir.chunk) {
                  const fromPath = path.join(dir.chunkOut, name);
                  if (!fs.existsSync(fromPath)) {
                    resolve({ ok: false, code: -1, killed: false, stdout: out, stderr: `parallel rembg missing ${name}` });
                    return;
                  }
                  fs.copyFileSync(fromPath, path.join(outDir, name));
                }
              }
              resolve({ ok: true, code: 0, killed: false, stdout: out, stderr: err });
            } catch (e) {
              resolve({ ok: false, code: -1, killed: false, stdout: out, stderr: String(e?.message || e) });
            }
          };

          let interval = null;
          try {
            interval = setInterval(tick, 700);
            chunkDirs.forEach((dir, index) => {
              const p = trackNovaFlowCommandChild(spawn(rembgExe, buildRembgArgs("p", model, dir.chunkIn, dir.chunkOut), { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], cwd: workDir, env: rembgEnv }));
              procs.push(p);
              p.stdout.on("data", (d) => { try { out += String(d); } catch {} lastIoAt = Date.now(); });
              p.stderr.on("data", (d) => { try { err += String(d); } catch {} lastIoAt = Date.now(); });
              p.on("close", (code) => {
                results[index] = { ok: code === 0, code: code || 0 };
                closed++;
                if (closed >= chunkDirs.length) finish(interval);
              });
            });
          } catch (e) {
            try { if (interval) clearInterval(interval); } catch {}
            resolve({ ok: false, code: -1, killed: false, stdout: out, stderr: String(e?.message || e) });
          }
        });
      };

      const runProcWithPolling = (cmd, args, env, { label, outDir, expectedCount, progressStart01, progressEnd01 }) => {
        return new Promise((resolve) => {
          if (novaFlowAppShuttingDown) {
            resolve({ ok: false, code: -3, killed: true, stdout: "", stderr: "app_shutting_down" });
            return;
          }
          let out = "";
          let err = "";
          let killed = false;
          const startedAt = Date.now();
          let lastIoAt = startedAt;
          let lastCountAt = startedAt;
          let lastCount = 0;
          let p = null;
          const safeCount = () => {
            try {
              if (!outDir) return 0;
              if (!fs.existsSync(outDir)) return 0;
              return fs.readdirSync(outDir).filter((n) => /\.png$/i.test(n)).length;
            } catch {
              return 0;
            }
          };
          const tick = () => {
            const now = Date.now();
            const count = safeCount();
            if (count !== lastCount) {
              lastCount = count;
              lastCountAt = now;
            }
            const span = Math.max(0.01, (progressEnd01 ?? 0.7) - (progressStart01 ?? 0.35));
            const ratio = expectedCount > 0 ? Math.max(0, Math.min(1, count / expectedCount)) : 0;
            const progress01 = (progressStart01 ?? 0.35) + span * ratio;
            const elapsedSec = Math.max(0, Math.round((now - startedAt) / 1000));
            const msg = expectedCount > 0
              ? (count > 0 ? `AI 分割中…（${label}）${count}/${expectedCount}` : `AI 分割准备中…（${label}，首次使用会下载模型）${elapsedSec}s`)
              : `AI 分割中…（${label}）`;
            sendProgress({ state: "running", stage: "rembg", message: msg, progress01 });

            const noIoMs = now - lastIoAt;
            const noCountMs = now - lastCountAt;
            if (!killed) {
              if (count === 0 && noIoMs > 6 * 60 * 1000 && (now - startedAt) > 6 * 60 * 1000) {
                killed = true;
                try { p?.kill(); } catch {}
              }
              if (count > 0 && noCountMs > 3 * 60 * 1000 && noIoMs > 3 * 60 * 1000) {
                killed = true;
                try { p?.kill(); } catch {}
              }
              if ((now - startedAt) > 30 * 60 * 1000) {
                killed = true;
                try { p?.kill(); } catch {}
              }
            }
          };

          let interval = null;
          try {
            p = trackNovaFlowCommandChild(spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], cwd: workDir, env: env || process.env }));
            interval = setInterval(tick, 700);
            p.stdout.on("data", (d) => { try { out += String(d); } catch {} lastIoAt = Date.now(); });
            p.stderr.on("data", (d) => { try { err += String(d); } catch {} lastIoAt = Date.now(); });
            p.on("close", (code) => {
              try { if (interval) clearInterval(interval); } catch {}
              tick();
              resolve({ ok: code === 0 && !killed, code: code || 0, killed, stdout: out, stderr: err });
            });
          } catch (e) {
            try { if (interval) clearInterval(interval); } catch {}
            resolve({ ok: false, code: -1, killed: false, stdout: "", stderr: String(e?.message || e) });
          }
        });
      };
      const runRembgAutoModelImage = async (inPath, outPath) => {
        const errs = [];
        for (const model of rembgModels) {
          if (novaFlowAppShuttingDown) return { ok: false, error: "app_shutting_down" };
          try {
            sendProgress({ state: "running", stage: "rembg", message: `AI 分割中…（${model}）`, progress01: 0.3 });
            cleanupDir(outPath);
            const r = await runRembgWithPolling(buildRembgArgs("i", model, inPath, outPath), { model, outDir: null, expectedCount: 0, progressStart01: 0.3, progressEnd01: 0.6 });
            if (!r.ok) { errs.push(String(r.stderr || r.stdout || "")); continue; }
            const { data: alphaBuf, info } = await sharp(outPath).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
            const w = Number(info?.width) || 0;
            const h = Number(info?.height) || 0;
            if (!w || !h) { errs.push("输出遮罩尺寸无效"); continue; }
            if (isAlphaTrivial(alphaBuf)) { errs.push(`模型输出遮罩异常（${model}）`); continue; }
            return { ok: true, model, alphaBuf, w, h };
          } catch (e) {
            errs.push(String(e?.message || e));
          }
        }
        return { ok: false, error: `rembg 失败（模型自动选择）：${errs.filter(Boolean).slice(-2).join(" | ").slice(0, 420)}` };
      };
      const runRembgAutoModelFolder = async (inDir, outDir, displayTotalCount = 0) => {
        const errs = [];
        let expectedCount = 0;
        try { expectedCount = fs.readdirSync(inDir).filter((n) => /\.png$/i.test(n)).length; } catch {}
        for (const model of rembgModels) {
          if (novaFlowAppShuttingDown) return { ok: false, error: "app_shutting_down" };
          cleanupDir(outDir);
          try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
          const totalDisplay = Number.isFinite(Number(displayTotalCount)) && Number(displayTotalCount) > expectedCount
            ? Math.round(Number(displayTotalCount))
            : 0;
          const initialMessage = totalDisplay
            ? `AI 分割中…（${model}）唯一帧 ${expectedCount}，总帧 ${totalDisplay}`
            : `AI 分割中…（${model}）`;
          sendProgress({ state: "running", stage: "rembg", message: initialMessage, progress01: 0.35 });
          const runtime = env?.runtime || null;
          const workerCount = getRembgParallelWorkerCount(expectedCount);
          const canRunParallel = workerCount > 1 && runtime?.hasCpu && !runtime?.hasCuda && rembgModelLikelyCached(model);
          let rr = null;
          if (canRunParallel) {
            rr = await runRembgParallelModelFolder(model, inDir, outDir, expectedCount, workerCount);
            if (!rr.ok) {
              appendLogLine("warn", "ai-cutout-parallel-rembg-fallback", { jobId, model, workerCount, error: String(rr.stderr || rr.stdout || "").slice(0, 240) });
              cleanupDir(outDir);
              try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
              rr = await runRembgWithPolling(buildRembgArgs("p", model, inDir, outDir), { model, outDir, expectedCount, displayTotalCount, progressStart01: 0.35, progressEnd01: 0.69 });
            } else {
              appendLogLine("info", "ai-cutout-parallel-rembg", { jobId, model, workerCount, expectedCount });
            }
          } else {
            rr = await runRembgWithPolling(buildRembgArgs("p", model, inDir, outDir), { model, outDir, expectedCount, displayTotalCount, progressStart01: 0.35, progressEnd01: 0.69 });
          }
          if (!rr.ok) { errs.push(String(rr.stderr || rr.stdout || "")); continue; }
          const files = fs.readdirSync(outDir).filter((n) => /\.png$/i.test(n)).sort();
          if (!files.length) { errs.push("rembg 未输出 PNG"); continue; }
          try {
            const probePath = path.join(outDir, files[0]);
            const { data: a0 } = await sharp(probePath).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
            if (isAlphaTrivial(a0)) { errs.push(`模型输出遮罩异常（${model}）`); continue; }
          } catch (e) {
            errs.push(String(e?.message || e));
            continue;
          }
          return { ok: true, model };
        }
        return { ok: false, error: `rembg 批处理失败（模型自动选择）：${errs.filter(Boolean).slice(-2).join(" | ").slice(0, 420)}` };
      };

      try { fs.mkdirSync(birefCacheDir, { recursive: true }); } catch {}
      const birefEnv = buildBiRefNetEnv();

      const writeBiRefNetScript = (scriptPath) => {
        const code = fs.readFileSync(path.join(__dirname, "main", "birefnet-runner.py"), "utf8");
        try { fs.mkdirSync(path.dirname(scriptPath), { recursive: true }); } catch {}
        const finalCode = String(code || "").replace(/^\n/, "");
        fs.writeFileSync(scriptPath, finalCode, "utf8");
      };

      const buildBiRefNetRunArgs = () => {
        const args = ["--model_id", String(env?.modelId || BIREFNET_REMOTE_MODEL_ID)];
        if (env?.modelLocal) args.push("--local_files_only");
        return args;
      };

      const runBiRefNetFolder = async (inDir, outDir, expectedCount) => {
        cleanupDir(outDir);
        try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
        const scriptPath = path.join(workDir, "birefnet_run.py");
        writeBiRefNetScript(scriptPath);
        sendProgress({ state: "running", stage: "rembg", message: "AI 分割中…（BiRefNet）", progress01: 0.35 });
        const streamEnabled=payload?.streamMasks===true&&hasRendererDecodedFrames&&payload?.returnMaskOnly===true;
        const priorities=new Set(Array.isArray(payload?.referenceDecodedFrameIndices)?payload.referenceDecodedFrameIndices:[]);
        const aliases=new Map((inferenceInput.duplicatePairs||[]).map(pair=>[pair.duplicateName,pair.sourceName]));
        const priorityNames=(framePlanItems||[]).filter(f=>priorities.has(f.decodedFrameIndex)).map(f=>aliases.get(f.outputFilename)||f.outputFilename);
        const priorityFile=path.join(workDir,"reference-priority.json");fs.writeFileSync(priorityFile,JSON.stringify([...new Set(priorityNames)]));
        const stream=streamEnabled?require("./main/cutout-mask-stream").createCutoutMaskStream({jobId,sender:evt.sender,frames:framePlanItems,duplicates:inferenceInput.duplicatePairs,outDir,width:Number(payload.rendererFrameWidth),height:Number(payload.rendererFrameHeight)}):null;
        const interval=stream?setInterval(()=>{stream.pump().catch(error=>{stream.stop();appendLogLine("warn","cutout-mask-stream-fallback",{jobId,error:String(error)});});},200):null;
        let r;
        try {
          r = await runProcWithPolling(pythonExe, ["-W", "ignore::FutureWarning", scriptPath, "--mode", "folder", "--input", inDir, "--output", outDir, "--priority-file",priorityFile, ...buildBiRefNetRunArgs()], birefEnv, { label: "BiRefNet", outDir, expectedCount, progressStart01: 0.35, progressEnd01: 0.69 });
          if(r.ok&&stream)await stream.pump(true).catch(error=>appendLogLine("warn","cutout-mask-stream-final-fallback",{jobId,error:String(error)}));
          appendLogLine("info","cutout-inference-runtime",{jobId,stdout:r.stdout,streamedFrames:stream?.count||0});
        } finally {if(interval)clearInterval(interval);stream?.stop();}
        if (!r.ok) return { ok: false, error: String(r.stderr || r.stdout || "").slice(0, 520) };
        return { ok: true };
      };

      const runBiRefNetImage = async (inPath, outPath) => {
        const scriptPath = path.join(workDir, "birefnet_run.py");
        writeBiRefNetScript(scriptPath);
        const startedAt = Date.now();
        const report = () => sendProgress({ state: "running", stage: "rembg", message: `单图 AI 加载 / 分割中…（BiRefNet，已等待 ${Math.floor((Date.now() - startedAt) / 1000)} 秒）`, progress01: 0.3 });
        report();
        const heartbeat = setInterval(report, 1000);
        try {
          const r = await runCmd(pythonExe, ["-W", "ignore::FutureWarning", scriptPath, "--mode", "image", "--input", inPath, "--output", outPath, ...buildBiRefNetRunArgs()], { cwd: workDir, env: birefEnv });
          appendLogLine(r.ok ? "info" : "warn", "ai-cutout-image-result", { jobId, elapsedMs: Date.now() - startedAt, ok: r.ok, code: r.code, stdout: String(r.stdout || "").slice(-2000), stderr: String(r.stderr || "").slice(-2000) });
          if (!r.ok) {
            const error = String(r.stderr || r.stdout || r.error || "BiRefNet 未正常完成").slice(-520);
            sendProgress({ state: "error", stage: "error", message: error, progress01: 1 });
            return { ok: false, error };
          }
          return { ok: true };
        } finally {
          clearInterval(heartbeat);
        }
      };

      if (kind === "image") {
        const aName = sanitizeFileName(payload?.image?.fileName || "input.png") || "input.png";
        const aBuf = safeBufFromBytes(payload?.image?.bytes);
        if (!aBuf || aBuf.length <= 0) return { ok: false, error: "image 无效" };
        const inPath = path.join(workDir, aName);
        const outPath = path.join(workDir, `out_${sanitizeFileStem(aName, "img")}.png`);
        fs.writeFileSync(inPath, aBuf);

        if (isBirefnet) {
          const br = await runBiRefNetImage(inPath, outPath);
          if (!br.ok) return { ok: false, error: String(br.error || "BiRefNet 失败") };
          const { data: alphaBuf, info } = await sharp(outPath).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
          const w = Number(info?.width) || 0;
          const h = Number(info?.height) || 0;
          if (!w || !h) return { ok: false, error: "输出遮罩尺寸无效" };
          sendProgress({ state: "running", stage: "pack", message: "打包结果…", progress01: 0.9 });
          return { ok: true, jobId, kind: "image", width: w, height: h, frames: 1, fps, sourceFrameIndices: [0], alphaBase64: alphaBuf.toString("base64") };
        }

        const rr = await runRembgAutoModelImage(inPath, outPath);
        if (!rr.ok) return { ok: false, error: String(rr.error || "rembg 失败") };
        const alphaBuf = rr.alphaBuf;
        const w = rr.w;
        const h = rr.h;

        sendProgress({ state: "running", stage: "pack", message: "打包结果…", progress01: 0.9 });
        return { ok: true, jobId, kind: "image", width: w, height: h, frames: 1, fps, sourceFrameIndices: [0], alphaBase64: alphaBuf.toString("base64") };
      }

      const rendererDecodedFramesProvided = Object.prototype.hasOwnProperty.call(payload || {}, "rendererDecodedFrames");
      const rendererDecodedFramesRaw = Array.isArray(payload?.rendererDecodedFrames) ? payload.rendererDecodedFrames : null;
      if (rendererDecodedFramesProvided && (!rendererDecodedFramesRaw || !rendererDecodedFramesRaw.length)) {
        return { ok: false, error: "rendererDecodedFrames invalid or empty" };
      }
      const hasRendererDecodedFrames = !!(rendererDecodedFramesRaw && rendererDecodedFramesRaw.length);
      const rendererFramesProvided = !hasRendererDecodedFrames && Object.prototype.hasOwnProperty.call(payload || {}, "rendererFrames");
      const rendererFramesRaw = !hasRendererDecodedFrames && Array.isArray(payload?.rendererFrames) ? payload.rendererFrames : null;
      if (!hasRendererDecodedFrames && rendererFramesProvided && (!rendererFramesRaw || !rendererFramesRaw.length)) {
        return { ok: false, error: "rendererFrames invalid or empty" };
      }
      const hasRendererFrames = !hasRendererDecodedFrames && !!(rendererFramesRaw && rendererFramesRaw.length);
      const hasRendererInputFrames = hasRendererDecodedFrames || hasRendererFrames;
      const rendererFrameFileName = (index) => `f_${String(Math.max(0, Math.floor(Number(index) || 0))).padStart(6, "0")}.png`;
      const decodedFrameManifestInput = Array.isArray(payload?.decodedFrameManifest) ? payload.decodedFrameManifest : null;
      const timelineToDecodedFrameMapInput = payload?.timelineToDecodedFrameMap && typeof payload.timelineToDecodedFrameMap === "object" ? payload.timelineToDecodedFrameMap : null;
      const decodedFrameManifestHash = /^[a-f0-9]{64}$/i.test(String(payload?.decodedFrameManifestHash || "")) ? String(payload.decodedFrameManifestHash).toLowerCase() : null;
      let rendererFrameInputs = null;
      let rendererDecodedFrameManifest = null;
      let rendererTimelineToDecodedFrameMap = null;
      if (hasRendererDecodedFrames) {
        if (!decodedFrameManifestInput || !decodedFrameManifestInput.length) {
          return { ok: false, error: "decodedFrameManifest invalid or empty" };
        }
        if (!timelineToDecodedFrameMapInput) {
          return { ok: false, error: "timelineToDecodedFrameMap invalid or empty" };
        }
        const rendererTimelineFrameCount = Math.max(
          0,
          Array.isArray(payload?.framePlan?.sourceFrameIndices) ? payload.framePlan.sourceFrameIndices.length : 0,
          Array.isArray(payload?.sourceFrameIndices) ? payload.sourceFrameIndices.length : 0,
          Number.isFinite(Number(payload?.totalFrames)) ? Math.round(Number(payload.totalFrames)) : 0
        );
        const rendererDecodedUniqueFrameCount = rendererDecodedFramesRaw.length;
        const rendererDecodedFrameLimit = 300;
        if (rendererDecodedUniqueFrameCount > rendererDecodedFrameLimit) {
          return { ok: false, error: `rendererDecodedFrames exceeds MVP frame limit: timelineFrameCount=${rendererTimelineFrameCount} decodedUniqueFrameCount=${rendererDecodedUniqueFrameCount} limit=${rendererDecodedFrameLimit}` };
        }
        const seenDecodedFrameIndices = new Set();
        rendererFrameInputs = [];
        for (let sequenceIndex = 0; sequenceIndex < rendererDecodedFramesRaw.length; sequenceIndex++) {
          const frame = rendererDecodedFramesRaw[sequenceIndex] || {};
          const decodedFrameIndex = Number(frame.decodedFrameIndex);
          if (!Number.isInteger(decodedFrameIndex) || decodedFrameIndex < 0 || decodedFrameIndex > 999999) {
            return { ok: false, error: `rendererDecodedFrames invalid decodedFrameIndex at sequence ${sequenceIndex}` };
          }
          if (seenDecodedFrameIndices.has(decodedFrameIndex)) {
            return { ok: false, error: `rendererDecodedFrames duplicate decodedFrameIndex ${decodedFrameIndex}` };
          }
          seenDecodedFrameIndices.add(decodedFrameIndex);
          const outputFilename = rendererFrameFileName(decodedFrameIndex);
          if (String(frame.fileName || "") !== outputFilename) {
            return { ok: false, error: `rendererDecodedFrames filename mismatch decodedFrameIndex=${decodedFrameIndex}` };
          }
          const buffer = safeBufFromBytes(frame.bytes);
          if (!buffer || buffer.length <= 0) {
            return { ok: false, error: `rendererDecodedFrames missing bytes decodedFrameIndex=${decodedFrameIndex}` };
          }
          const representativeTimelineFrameIndex = Number(frame.representativeTimelineFrameIndex ?? frame.sourceFrameIndex ?? frame.timelineFrameIndex ?? decodedFrameIndex);
          if (!Number.isInteger(representativeTimelineFrameIndex) || representativeTimelineFrameIndex < 0) {
            return { ok: false, error: `rendererDecodedFrames invalid representativeTimelineFrameIndex decodedFrameIndex=${decodedFrameIndex}` };
          }
          const timelineFrameIndices = Array.isArray(frame.timelineFrameIndices)
            ? frame.timelineFrameIndices.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 0)
            : [representativeTimelineFrameIndex];
          if (!timelineFrameIndices.length) {
            return { ok: false, error: `rendererDecodedFrames missing timelineFrameIndices decodedFrameIndex=${decodedFrameIndex}` };
          }
          const requestedTimeSec = Number(frame.requestedTimeSec ?? frame.timeSec);
          const clampedTimeSec = Number(frame.clampedTimeSec ?? frame.timeSec);
          const rendererVideoCurrentTime = Number(frame.videoCurrentTime);
          const mediaTime = Number(frame.mediaTime);
          const capturedHash = /^[a-f0-9]{64}$/i.test(String(frame.capturedHash || "")) ? String(frame.capturedHash).toLowerCase() : null;
          const fallbackTimeSec = Number.isFinite(fps) && fps > 0 ? representativeTimelineFrameIndex / fps : sequenceIndex / 30;
          const requestedTimeSecResolved = Number.isFinite(requestedTimeSec) ? Math.max(0, requestedTimeSec) : Math.max(0, fallbackTimeSec);
          const clampedTimeSecResolved = Number.isFinite(clampedTimeSec) ? Math.max(0, clampedTimeSec) : requestedTimeSecResolved;
          const mediaTimeResolved = Number.isFinite(mediaTime) ? Math.max(0, mediaTime) : null;
          const rgbSourceTimeSec = mediaTimeResolved ?? clampedTimeSecResolved;
          rendererFrameInputs.push({
            sequenceIndex,
            sourceFrameIndex: decodedFrameIndex,
            alphaSourceFrameIndex: decodedFrameIndex,
            rgbSourceFrameIndex: representativeTimelineFrameIndex,
            rgbSourceTimeSec,
            decodedFrameIndex,
            representativeTimelineFrameIndex,
            timelineFrameIndices,
            requestedTimeSec: requestedTimeSecResolved,
            clampedTimeSec: clampedTimeSecResolved,
            mediaTime: mediaTimeResolved,
            outputFilename,
            rendererVideoCurrentTime: Number.isFinite(rendererVideoCurrentTime) ? rendererVideoCurrentTime : null,
            capturedHash,
            buffer
          });
        }
        rendererDecodedFrameManifest = decodedFrameManifestInput.map((item) => ({
          decodedFrameIndex: Number(item?.decodedFrameIndex),
          representativeTimelineFrameIndex: Number(item?.representativeTimelineFrameIndex),
          timelineFrameIndices: Array.isArray(item?.timelineFrameIndices)
            ? item.timelineFrameIndices.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 0)
            : [],
          requestedTimeSec: Number(item?.requestedTimeSec),
          clampedTimeSec: Number(item?.clampedTimeSec),
          videoCurrentTime: Number.isFinite(Number(item?.videoCurrentTime)) ? Number(item.videoCurrentTime) : null,
          mediaTime: Number.isFinite(Number(item?.mediaTime)) ? Number(item.mediaTime) : null,
          capturedHash: /^[a-f0-9]{64}$/i.test(String(item?.capturedHash || "")) ? String(item.capturedHash).toLowerCase() : null,
          width: Number(item?.width),
          height: Number(item?.height),
          fileName: String(item?.fileName || "")
        }));
        if (rendererDecodedFrameManifest.length !== rendererFrameInputs.length) {
          return { ok: false, error: "decodedFrameManifest count does not match rendererDecodedFrames" };
        }
        for (const item of rendererDecodedFrameManifest) {
          if (!Number.isInteger(item.decodedFrameIndex) || !seenDecodedFrameIndices.has(item.decodedFrameIndex)) {
            return { ok: false, error: `decodedFrameManifest references unknown decodedFrameIndex ${item.decodedFrameIndex}` };
          }
          if (item.fileName !== rendererFrameFileName(item.decodedFrameIndex)) {
            return { ok: false, error: `decodedFrameManifest filename mismatch decodedFrameIndex=${item.decodedFrameIndex}` };
          }
        }
        rendererTimelineToDecodedFrameMap = {};
        const mapEntries = Array.isArray(timelineToDecodedFrameMapInput)
          ? timelineToDecodedFrameMapInput.map((v, i) => [i, v])
          : Object.entries(timelineToDecodedFrameMapInput);
        if (!mapEntries.length) {
          return { ok: false, error: "timelineToDecodedFrameMap invalid or empty" };
        }
        for (const [timelineKey, decodedValue] of mapEntries) {
          const timelineFrameIndex = Number(timelineKey);
          const decodedFrameIndex = Number(decodedValue);
          if (!Number.isInteger(timelineFrameIndex) || timelineFrameIndex < 0 || !Number.isInteger(decodedFrameIndex) || !seenDecodedFrameIndices.has(decodedFrameIndex)) {
            return { ok: false, error: `timelineToDecodedFrameMap invalid entry ${timelineKey}:${decodedValue}` };
          }
          rendererTimelineToDecodedFrameMap[String(timelineFrameIndex)] = decodedFrameIndex;
        }
        totalFrames = rendererFrameInputs.length;
      }
      if (hasRendererFrames) {
        if (rendererFramesRaw.length > 300) {
          return { ok: false, error: "rendererFrames exceeds short-video MVP frame limit" };
        }
        const rendererFrameWidth = Number(payload?.rendererFrameWidth);
        const rendererFrameHeight = Number(payload?.rendererFrameHeight);
        if (Number.isFinite(rendererFrameWidth) && rendererFrameWidth > 0 && Number.isFinite(rendererFrameHeight) && rendererFrameHeight > 0) {
          const estimatedRgbaBytes = rendererFrameWidth * rendererFrameHeight * rendererFramesRaw.length * 4;
          if (estimatedRgbaBytes > 268435456) {
            return { ok: false, error: "rendererFrames exceeds short-video MVP memory limit" };
          }
        }
        const seenRendererFrameIndices = new Set();
        let rendererFrameBytes = 0;
        rendererFrameInputs = [];
        for (let sequenceIndex = 0; sequenceIndex < rendererFramesRaw.length; sequenceIndex++) {
          const frame = rendererFramesRaw[sequenceIndex] || {};
          const sourceFrameIndex = Number(frame.sourceFrameIndex);
          if (!Number.isInteger(sourceFrameIndex) || sourceFrameIndex < 0 || sourceFrameIndex > 999999) {
            return { ok: false, error: `rendererFrames invalid sourceFrameIndex at sequence ${sequenceIndex}` };
          }
          if (seenRendererFrameIndices.has(sourceFrameIndex)) {
            return { ok: false, error: `rendererFrames duplicate sourceFrameIndex ${sourceFrameIndex}` };
          }
          seenRendererFrameIndices.add(sourceFrameIndex);
          const outputFilename = rendererFrameFileName(sourceFrameIndex);
          if (String(frame.fileName || "") !== outputFilename) {
            return { ok: false, error: `rendererFrames filename mismatch sourceFrameIndex=${sourceFrameIndex}` };
          }
          const buffer = safeBufFromBytes(frame.bytes);
          if (!buffer || buffer.length <= 0) {
            return { ok: false, error: `rendererFrames missing bytes sourceFrameIndex=${sourceFrameIndex}` };
          }
          rendererFrameBytes += buffer.length;
          if (rendererFrameBytes > 268435456) {
            return { ok: false, error: "rendererFrames PNG payload exceeds short-video MVP memory limit" };
          }
          const requestedTimeSec = Number(frame.requestedTimeSec ?? frame.timeSec);
          const clampedTimeSec = Number(frame.clampedTimeSec ?? frame.timeSec);
          const rendererVideoCurrentTime = Number(frame.videoCurrentTime);
          const capturedHash = /^[a-f0-9]{64}$/i.test(String(frame.capturedHash || "")) ? String(frame.capturedHash).toLowerCase() : null;
          if (canonicalFramePlan) {
            const expectedIndex = Number(canonicalFramePlan.sourceFrameIndices?.[sequenceIndex]);
            if (expectedIndex !== sourceFrameIndex) {
              return { ok: false, error: `rendererFrames sourceFrameIndex does not match framePlan at sequence ${sequenceIndex}` };
            }
            const expectedTimeSec = Number(canonicalFramePlan.frameTimes?.[sequenceIndex]);
            const compareTimeSec = Number.isFinite(clampedTimeSec) ? clampedTimeSec : requestedTimeSec;
            if (Number.isFinite(expectedTimeSec) && Number.isFinite(compareTimeSec) && Math.abs(expectedTimeSec - compareTimeSec) > 0.0005) {
              return { ok: false, error: `rendererFrames timeSec does not match framePlan sourceFrameIndex=${sourceFrameIndex}` };
            }
          }
          rendererFrameInputs.push({
            sequenceIndex,
            sourceFrameIndex,
            requestedTimeSec: Number.isFinite(requestedTimeSec) ? requestedTimeSec : (Number.isFinite(fps) && fps > 0 ? sourceFrameIndex / fps : sequenceIndex / 30),
            clampedTimeSec: Number.isFinite(clampedTimeSec) ? Math.max(0, clampedTimeSec) : (Number.isFinite(requestedTimeSec) ? Math.max(0, requestedTimeSec) : (Number.isFinite(fps) && fps > 0 ? sourceFrameIndex / fps : sequenceIndex / 30)),
            outputFilename,
            rendererVideoCurrentTime: Number.isFinite(rendererVideoCurrentTime) ? rendererVideoCurrentTime : null,
            capturedHash,
            buffer
          });
        }
        totalFrames = rendererFrameInputs.length;
      }

      const aName = sanitizeFileName(payload?.video?.fileName || "input.mp4") || "input.mp4";
      const aBuf = hasRendererInputFrames ? null : safeBufFromBytes(payload?.video?.bytes);
      if (!hasRendererInputFrames && (!aBuf || aBuf.length <= 0)) return { ok: false, error: "video 无效" };

      const inPath = path.join(workDir, aName);
      if (!hasRendererInputFrames) fs.writeFileSync(inPath, aBuf);

      const sanitizeFpsExpr = (s) => {
        try {
          const txt = String(s || "").trim();
          if (!txt) return null;
          const ok = /^[0-9]+(?:\.[0-9]+)?(?:\/[0-9]+(?:\.[0-9]+)?)?$/.test(txt);
          return ok ? txt : null;
        } catch {
          return null;
        }
      };
      const parseRational = (s) => {
        try {
          const txt = String(s || "").trim();
          if (!txt) return null;
          if (txt.includes("/")) {
            const [a, b] = txt.split("/");
            const n = Number(a);
            const d = Number(b);
            if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
            return n / d;
          }
          const v = Number(txt);
          return Number.isFinite(v) ? v : null;
        } catch {
          return null;
        }
      };
      const normalizeRotation = (deg) => {
        const v = Number(deg);
        if (!Number.isFinite(v)) return 0;
        const r = ((Math.round(v) % 360) + 360) % 360;
        if (r === 90 || r === 180 || r === 270) return r;
        return 0;
      };
      const probeVideo = async () => {
        try {
          if (!ffprobePath || typeof ffprobePath !== "string" || !fs.existsSync(ffprobePath)) return null;
          sendProgress({ state: "running", stage: "prepare", message: "读取视频真实帧率…", progress01: 0.05 });
          const args = [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=avg_frame_rate,r_frame_rate,nb_frames,width,height,sample_aspect_ratio,side_data_list:stream_tags=rotate:format=duration",
            "-of", "json",
            inPath
          ];
          const r = await runCmd(ffprobePath, args, { cwd: workDir });
          if (!r.ok) return null;
          const txt = String(r.stdout || "").trim();
          if (!txt) return null;
          const j = JSON.parse(txt);
          const st = Array.isArray(j?.streams) ? j.streams[0] : null;
          const fmt = j?.format || null;
          const fpsAExpr = sanitizeFpsExpr(st?.avg_frame_rate);
          const fpsRExpr = sanitizeFpsExpr(st?.r_frame_rate);
          const fpsA = parseRational(fpsAExpr);
          const fpsR = parseRational(fpsRExpr);
          const fpsV = (fpsA && fpsA > 0.1) ? fpsA : ((fpsR && fpsR > 0.1) ? fpsR : null);
          const fpsExpr = (fpsA && fpsA > 0.1) ? fpsAExpr : ((fpsR && fpsR > 0.1) ? fpsRExpr : null);
          const dur = Number(fmt?.duration);
          const nb = Number(st?.nb_frames);
          const nbFrames = Number.isFinite(nb) && nb > 0 ? Math.round(nb) : null;
          const durSec = Number.isFinite(dur) && dur > 0 ? dur : null;
          const rotTag = normalizeRotation(Number(st?.tags?.rotate));
          let rotSide = 0;
          try {
            const sdl = Array.isArray(st?.side_data_list) ? st.side_data_list : null;
            if (sdl) {
              for (const sd of sdl) {
                const r0 = normalizeRotation(sd?.rotation);
                if (r0) { rotSide = r0; break; }
              }
            }
          } catch {}
          const rotationDeg = rotTag || rotSide || 0;
          const sarTxt = String(st?.sample_aspect_ratio || "").trim();
          const sar = (() => {
            const m = /^([0-9]+):([0-9]+)$/.exec(sarTxt);
            if (!m) return null;
            const n = Number(m[1]);
            const d = Number(m[2]);
            if (!Number.isFinite(n) || !Number.isFinite(d) || n <= 0 || d <= 0) return null;
            return { n, d };
          })();
          return { fps: fpsV, fpsExpr, frames: nbFrames, durationSec: durSec, rotationDeg, sar };
        } catch {
          return null;
        }
      };
      const meta = hasRendererInputFrames ? null : await probeVideo();
      let fpsExpr = null;
      if (meta && meta.fps && meta.fps > 0) {
        const fps1 = Math.max(1, Math.min(120, Number(meta.fps)));
        fps = fps1;
        fpsExpr = sanitizeFpsExpr(meta.fpsExpr) || null;
        if (meta.frames && meta.frames > 0) {
          totalFrames = Math.max(1, Math.min(100000, Math.round(meta.frames)));
        } else if (meta.durationSec && meta.durationSec > 0) {
          totalFrames = Math.max(1, Math.min(100000, Math.round(meta.durationSec * fps1)));
        }
      }
      if (!fpsExpr) fpsExpr = String(Number.isFinite(fps) && fps > 0 ? fps : 30);

      const vfBase = (() => {
        const parts = [];
        const rot = normalizeRotation(meta?.rotationDeg);
        if (rot === 90) parts.push("transpose=1");
        else if (rot === 270) parts.push("transpose=2");
        else if (rot === 180) parts.push("hflip,vflip");
        const scaleW = "trunc(iw*sar/2)*2";
        const scaleH = "trunc(ih/2)*2";
        parts.push(`scale=${scaleW}:${scaleH}`);
        parts.push("setsar=1");
        return parts.join(",");
      })();

      const inFramesDir = path.join(workDir, "frames_in");
      const outFramesDir = path.join(workDir, "frames_out");
      if (novaFlowAppShuttingDown) throw new Error("app_shutting_down");
      fs.mkdirSync(inFramesDir, { recursive: true });
      fs.mkdirSync(outFramesDir, { recursive: true });

      sendProgress({ state: "running", stage: "extract", message: "抽帧中…", progress01: 0.08 });
      const frameFileName = (index) => `f_${String(Math.max(0, Math.floor(Number(index) || 0))).padStart(6, "0")}.png`;
      const formatSeekTimeSec = (value) => {
        const v = Number(value);
        return Number.isFinite(v) && v > 0 ? v.toFixed(6) : "0.000000";
      };
      const framePlanItems = rendererFrameInputs
        ? rendererFrameInputs.map((item) => ({
            sequenceIndex: item.sequenceIndex,
            sourceFrameIndex: item.sourceFrameIndex,
            alphaSourceFrameIndex: item.alphaSourceFrameIndex,
            rgbSourceFrameIndex: item.rgbSourceFrameIndex,
            rgbSourceTimeSec: item.rgbSourceTimeSec,
            decodedFrameIndex: item.decodedFrameIndex,
            representativeTimelineFrameIndex: item.representativeTimelineFrameIndex,
            timelineFrameIndices: item.timelineFrameIndices,
            requestedTimeSec: item.requestedTimeSec,
            clampedTimeSec: item.clampedTimeSec,
            mediaTime: item.mediaTime,
            outputFilename: item.outputFilename,
            rendererVideoCurrentTime: item.rendererVideoCurrentTime,
            capturedHash: item.capturedHash
          }))
        : canonicalFramePlan
        ? canonicalFramePlan.sourceFrameIndices.map((sourceFrameIndex, sequenceIndex) => {
            const t = Number(canonicalFramePlan.frameTimes?.[sequenceIndex]);
            const fallback = Number.isFinite(fps) && fps > 0 ? sourceFrameIndex / fps : sequenceIndex / 30;
            return {
              sequenceIndex,
              sourceFrameIndex,
              requestedTimeSec: Number.isFinite(t) ? Math.max(0, t) : Math.max(0, fallback),
              outputFilename: frameFileName(sourceFrameIndex)
            };
          })
        : null;
      if (framePlanItems?.some((item) => item.sourceFrameIndex > 999999)) {
        return { ok: false, error: "AI framePlan sourceFrameIndex exceeds f_%06d filename range" };
      }
      let debugDir = null;
      try {
        const logDir = getCutoutTraceLogDir();
        if (logDir) {
          debugDir = path.join(logDir, "ai-frame-debug", sanitizeFileStem(String(jobId || Date.now()), "job"));
          fs.mkdirSync(debugDir, { recursive: true });
        }
      } catch {
        debugDir = null;
      }
      const writeDebugJson = (name, data) => {
        try {
          if (debugDir) writeJson(path.join(debugDir, name), data);
        } catch {}
      };

      const patternIn = path.join(inFramesDir, "f_%06d.png");
      let frameTimes = null;
      let extractManifest = [];
      if (rendererFrameInputs) {
        writeDebugJson("frame-plan.json", {
          jobId,
          mode: hasRendererDecodedFrames ? "rendererDecodedFrameManifest" : "rendererSourceFrameCapture",
          fps,
          fpsExpr,
          totalFrames: rendererFrameInputs.length,
          frames: framePlanItems.slice(0, 50),
          decodedFrameManifest: rendererDecodedFrameManifest,
          timelineToDecodedFrameMap: rendererTimelineToDecodedFrameMap,
          decodedFrameManifestHash
        });
        for (const item of rendererFrameInputs) {
          const outPath = path.join(inFramesDir, item.outputFilename);
          fs.writeFileSync(outPath, item.buffer);
          extractManifest.push({
            sequenceIndex: item.sequenceIndex,
            sourceFrameIndex: item.sourceFrameIndex,
            alphaSourceFrameIndex: item.alphaSourceFrameIndex,
            rgbSourceFrameIndex: item.rgbSourceFrameIndex,
            rgbSourceTimeSec: item.rgbSourceTimeSec,
            decodedFrameIndex: item.decodedFrameIndex,
            representativeTimelineFrameIndex: item.representativeTimelineFrameIndex,
            timelineFrameIndices: item.timelineFrameIndices,
            requestedTimeSec: item.requestedTimeSec,
            clampedTimeSec: item.clampedTimeSec,
            mediaTime: item.mediaTime,
            outputFilename: item.outputFilename,
            rendererVideoCurrentTime: item.rendererVideoCurrentTime,
            capturedHash: item.capturedHash
          });
          if (item.sequenceIndex > 0 && item.capturedHash && extractManifest[item.sequenceIndex - 1]?.capturedHash === item.capturedHash && extractManifest[item.sequenceIndex - 1]?.sourceFrameIndex !== item.sourceFrameIndex) {
            appendLogLine("warn", "ai-renderer-frame-duplicate-hash", {
              jobId,
              sourceFrameIndex: item.sourceFrameIndex,
              previousSourceFrameIndex: extractManifest[item.sequenceIndex - 1]?.sourceFrameIndex,
              requestedTimeSec: item.requestedTimeSec,
              clampedTimeSec: item.clampedTimeSec,
              rendererVideoCurrentTime: item.rendererVideoCurrentTime,
              capturedHash: item.capturedHash
            });
          }
          if (item.sequenceIndex < 16) {
            appendLogLine("info", "ai-renderer-frame-input", {
              jobId,
              rendererSourceFrameIndex: item.sourceFrameIndex,
              alphaSourceFrameIndex: item.alphaSourceFrameIndex,
              rgbSourceFrameIndex: item.rgbSourceFrameIndex,
              rgbSourceTimeSec: item.rgbSourceTimeSec,
              decodedFrameIndex: item.decodedFrameIndex,
              representativeTimelineFrameIndex: item.representativeTimelineFrameIndex,
              timelineFrameIndices: item.timelineFrameIndices,
              rendererTimeSec: item.requestedTimeSec,
              mainExtractSequenceIndex: item.sequenceIndex,
              mainExtractSourceFrameIndex: item.sourceFrameIndex,
              requestedTimeSec: item.requestedTimeSec,
              clampedTimeSec: item.clampedTimeSec,
              mediaTime: item.mediaTime,
              rendererVideoCurrentTime: item.rendererVideoCurrentTime,
              capturedHash: item.capturedHash,
              outputFilename: item.outputFilename
            });
          }
          if (item.sequenceIndex % 8 === 0) {
            sendProgress({
              state: "running",
              stage: "extract",
              message: `receive rendererFrame ${item.sequenceIndex + 1}/${rendererFrameInputs.length}`,
              progress01: 0.08 + 0.18 * (item.sequenceIndex / Math.max(1, rendererFrameInputs.length))
            });
          }
        }
        frameTimes = extractManifest.map((item) => Number.isFinite(Number(item.clampedTimeSec)) ? Number(item.clampedTimeSec) : item.requestedTimeSec);
      } else if (framePlanItems) {
        writeDebugJson("frame-plan.json", {
          jobId,
          mode: "framePlanExactSeek",
          fps,
          fpsExpr,
          totalFrames: framePlanItems.length,
          frames: framePlanItems.slice(0, 50)
        });
        for (const item of framePlanItems) {
          const outPath = path.join(inFramesDir, item.outputFilename);
          const extractArgs = [
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            "-noautorotate",
            "-i", inPath,
            "-ss", formatSeekTimeSec(item.requestedTimeSec),
            "-frames:v", "1",
            "-vf", vfBase,
            outPath
          ];
          const ex = await runCmd(ffmpegPath, extractArgs, { cwd: workDir });
          if (!ex.ok || !fs.existsSync(outPath)) {
            return { ok: false, error: `ffmpeg exact frame extract failed sourceFrameIndex=${item.sourceFrameIndex} timeSec=${formatSeekTimeSec(item.requestedTimeSec)}: ${String(ex.stderr || ex.stdout || "").slice(0, 240)}` };
          }
          extractManifest.push({
            sequenceIndex: item.sequenceIndex,
            sourceFrameIndex: item.sourceFrameIndex,
            requestedTimeSec: item.requestedTimeSec,
            outputFilename: item.outputFilename
          });
          if (item.sequenceIndex < 10) {
            appendLogLine("info", "ai-frame-extract", {
              jobId,
              rendererSourceFrameIndex: item.sourceFrameIndex,
              rendererTimeSec: item.requestedTimeSec,
              mainExtractSequenceIndex: item.sequenceIndex,
              mainExtractSourceFrameIndex: item.sourceFrameIndex,
              requestedTimeSec: item.requestedTimeSec,
              outputFilename: item.outputFilename
            });
          }
          if (item.sequenceIndex % 8 === 0) {
            sendProgress({
              state: "running",
              stage: "extract",
              message: `抽帧中…${item.sequenceIndex + 1}/${framePlanItems.length}`,
              progress01: 0.08 + 0.18 * (item.sequenceIndex / Math.max(1, framePlanItems.length))
            });
          }
        }
        frameTimes = extractManifest.map((item) => item.requestedTimeSec);
      } else {
        const extractArgs = [
          "-hide_banner",
          "-loglevel", "error",
          "-y",
          "-vsync", "0",
          "-noautorotate",
          "-i", inPath,
          "-vf", `${vfBase},fps=${fpsExpr}`,
          "-start_number", "0",
          ...(totalFrames ? ["-frames:v", String(totalFrames)] : []),
          patternIn
        ];
        const ex = await runCmd(ffmpegPath, extractArgs, { cwd: workDir });
        if (!ex.ok) return { ok: false, error: `ffmpeg 抽帧失败：${String(ex.stderr || ex.stdout || "").slice(0, 240)}` };

        try {
          const inFiles = fs.readdirSync(inFramesDir).filter((n) => /\.png$/i.test(n)).sort();
          const extractedCount = totalFrames ? Math.min(totalFrames, inFiles.length) : inFiles.length;
          if (extractedCount > 0 && extractedCount <= 5000) {
            sendProgress({ state: "running", stage: "extract", message: "生成时间戳索引…", progress01: 0.12 });
            const showArgs = [
              "-hide_banner",
              "-loglevel", "info",
              "-vsync", "0",
              "-noautorotate",
              "-i", inPath,
              "-vf", `${vfBase},fps=${fpsExpr},showinfo`,
              "-frames:v", String(extractedCount),
              "-f", "null",
              "-"
            ];
            const sh = await runCmd(ffmpegPath, showArgs, { cwd: workDir });
            const txt = String(sh.stderr || sh.stdout || "");
            const times = [];
            const re = /pts_time:([0-9]+(?:\.[0-9]+)?)/g;
            let m = null;
            while ((m = re.exec(txt))) {
              const v = Number(m[1]);
              if (Number.isFinite(v)) times.push(v);
            }
            if (times.length >= extractedCount) frameTimes = times.slice(0, extractedCount);
          }
        } catch {}
      }

      const buildExactInputDedupe = () => {
        try {
          const names = fs.readdirSync(inFramesDir).filter((n) => /\.png$/i.test(n)).sort();
          if (names.length < 2) return { dir: inFramesDir, duplicatePairs: [], totalFrames: names.length, uniqueFrames: names.length };
          const seen = new Map();
          const uniqueNames = [];
          const duplicatePairs = [];
          for (const name of names) {
            const filePath = path.join(inFramesDir, name);
            const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
            const firstName = seen.get(hash);
            if (firstName) {
              duplicatePairs.push({ sourceName: firstName, duplicateName: name });
            } else {
              seen.set(hash, name);
              uniqueNames.push(name);
            }
          }
          if (!duplicatePairs.length) return { dir: inFramesDir, duplicatePairs: [], totalFrames: names.length, uniqueFrames: uniqueNames.length };
          const uniqueDir = path.join(workDir, "frames_in_unique");
          cleanupDir(uniqueDir);
          fs.mkdirSync(uniqueDir, { recursive: true });
          for (const name of uniqueNames) fs.copyFileSync(path.join(inFramesDir, name), path.join(uniqueDir, name));
          appendLogLine("info", "ai-cutout-deduped-identical-frames", { jobId, totalFrames: names.length, uniqueFrames: uniqueNames.length, duplicates: duplicatePairs.length });
          return { dir: uniqueDir, duplicatePairs, totalFrames: names.length, uniqueFrames: uniqueNames.length };
        } catch (e) {
          appendLogLine("warn", "ai-cutout-dedupe-skip", { jobId, error: String(e?.message || e) });
          return { dir: inFramesDir, duplicatePairs: [], totalFrames: 0, uniqueFrames: 0 };
        }
      };

      const inferenceInput = buildExactInputDedupe();
      const inferenceFramesDir = inferenceInput.dir || inFramesDir;

      if (isBirefnet) {
        let expectedCount = 0;
        try { expectedCount = fs.readdirSync(inferenceFramesDir).filter((n) => /\.png$/i.test(n)).length; } catch {}
        const br = await runBiRefNetFolder(inferenceFramesDir, outFramesDir, expectedCount);
        if (!br.ok) return { ok: false, error: String(br.error || "BiRefNet 批处理失败") };
      } else {
        const rr = await runRembgAutoModelFolder(inferenceFramesDir, outFramesDir, inferenceInput.totalFrames || 0);
        if (!rr.ok) return { ok: false, error: String(rr.error || "rembg 批处理失败") };
      }

      if (Array.isArray(inferenceInput.duplicatePairs) && inferenceInput.duplicatePairs.length) {
        for (const pair of inferenceInput.duplicatePairs) {
          const fromPath = path.join(outFramesDir, pair.sourceName);
          const toPath = path.join(outFramesDir, pair.duplicateName);
          if (!fs.existsSync(fromPath)) {
            return { ok: false, error: `AI mask output missing dedupe source: ${pair.sourceName}` };
          }
          fs.copyFileSync(fromPath, toPath);
        }
      }

      sendProgress({ state: "running", stage: "pack", message: "读取遮罩…", progress01: 0.7 });
      const parseFrameName = (name) => {
        const m = /^f_(\d{6})\.png$/i.exec(String(name || ""));
        if (!m) return null;
        const index = Number(m[1]);
        return Number.isInteger(index) && index >= 0 ? index : null;
      };
      const sourceFiles = framePlanItems
        ? framePlanItems
            .map((item) => ({
              name: item.outputFilename,
              sequenceIndex: item.sequenceIndex,
              index: item.sourceFrameIndex,
              alphaSourceFrameIndex: item.alphaSourceFrameIndex,
              rgbSourceFrameIndex: item.rgbSourceFrameIndex,
              rgbSourceTimeSec: item.rgbSourceTimeSec,
              decodedFrameIndex: item.decodedFrameIndex,
              representativeTimelineFrameIndex: item.representativeTimelineFrameIndex,
              timelineFrameIndices: item.timelineFrameIndices,
              requestedTimeSec: item.requestedTimeSec,
              clampedTimeSec: item.clampedTimeSec,
              mediaTime: item.mediaTime,
              rendererVideoCurrentTime: item.rendererVideoCurrentTime,
              capturedHash: item.capturedHash
            }))
            .filter((f) => fs.existsSync(path.join(inFramesDir, f.name)))
        : fs.readdirSync(inFramesDir)
            .filter((n) => /\.png$/i.test(n))
            .map((name) => {
              const sequenceIndex = parseFrameName(name);
              return { name, sequenceIndex, index: sequenceIndex };
            })
            .filter((f) => f.sequenceIndex !== null && Number.isInteger(f.index) && f.index >= 0)
            .sort((a, b) => a.sequenceIndex - b.sequenceIndex);
      if (!sourceFiles.length) return { ok: false, error: "AI source frame sequence is empty" };
      if (framePlanItems && sourceFiles.length !== framePlanItems.length) {
        const found = new Set(sourceFiles.map((f) => f.index));
        const missing = framePlanItems.filter((item) => !found.has(item.sourceFrameIndex)).map((item) => item.sourceFrameIndex);
        return { ok: false, error: `AI exact source extraction missing sourceFrameIndex: ${missing.slice(0, 12).join(", ")}`, missingFrames: missing.slice(0, 256), expectedFrames: framePlanItems.length };
      }
      const sourceIndexSet = new Set();
      for (let i = 0; i < sourceFiles.length; i++) {
        const frame = sourceFiles[i];
        if (frame.sequenceIndex !== i) {
          return { ok: false, error: `AI source frame sequence has a hole at frame ${i}`, missingFrames: [i], expectedFrames: sourceFiles.length };
        }
        if (sourceIndexSet.has(frame.index)) {
          return { ok: false, error: `AI source frame sequence has duplicate sourceFrameIndex ${frame.index}`, duplicateFrames: [frame.index], expectedFrames: sourceFiles.length };
        }
        sourceIndexSet.add(frame.index);
      }
      const outRawFiles = fs.readdirSync(outFramesDir).filter((n) => /\.png$/i.test(n)).sort();
      if (!outRawFiles.length) return { ok: false, error: isBirefnet ? "BiRefNet 未输出 PNG" : "rembg 未输出 PNG" };
      const invalidOutFiles = outRawFiles.filter((name) => parseFrameName(name) === null);
      if (invalidOutFiles.length) {
        return { ok: false, error: `AI mask output has unexpected frame names: ${invalidOutFiles.slice(0, 6).join(", ")}`, invalidFrames: invalidOutFiles.slice(0, 24) };
      }
      const outByFrameIndex = new Map();
      const duplicateFrames = [];
      for (const name of outRawFiles) {
        const index = parseFrameName(name);
        if (outByFrameIndex.has(index)) duplicateFrames.push(index);
        outByFrameIndex.set(index, name);
      }
      if (duplicateFrames.length) {
        return { ok: false, error: `AI mask output has duplicate frames: ${duplicateFrames.slice(0, 12).join(", ")}`, duplicateFrames: duplicateFrames.slice(0, 48) };
      }
      const expectedFrameIndexSet = new Set(sourceFiles.map((f) => f.index));
      const extraFrames = Array.from(outByFrameIndex.keys()).filter((index) => !expectedFrameIndexSet.has(index)).sort((a, b) => a - b);
      if (extraFrames.length) {
        return { ok: false, error: `AI mask output has frames outside sourceFrameIndex plan: ${extraFrames.slice(0, 12).join(", ")}`, extraFrames: extraFrames.slice(0, 48), expectedFrames: sourceFiles.length, outputFrames: outByFrameIndex.size };
      }
      const missingFrames = sourceFiles.filter((f) => !outByFrameIndex.has(f.index)).map((f) => f.index);
      if (missingFrames.length) {
        return { ok: false, error: `AI mask output missing sourceFrameIndex: ${missingFrames.slice(0, 12).join(", ")}`, missingFrames: missingFrames.slice(0, 256), expectedFrames: sourceFiles.length, outputFrames: outByFrameIndex.size };
      }
      const files = sourceFiles.map((f) => outByFrameIndex.get(f.index));
      const maxFrames = sourceFiles.length;
      const frameManifest = sourceFiles.map((f, i) => ({
        sequenceIndex: f.sequenceIndex,
        sourceFrameIndex: f.index,
        alphaSourceFrameIndex: Number.isInteger(Number(f.alphaSourceFrameIndex)) ? Number(f.alphaSourceFrameIndex) : f.index,
        rgbSourceFrameIndex: Number.isInteger(Number(f.rgbSourceFrameIndex)) ? Number(f.rgbSourceFrameIndex) : (Number.isInteger(Number(f.representativeTimelineFrameIndex)) ? Number(f.representativeTimelineFrameIndex) : f.index),
        rgbSourceTimeSec: Number.isFinite(Number(f.rgbSourceTimeSec)) ? Number(f.rgbSourceTimeSec) : (Number.isFinite(Number(f.mediaTime)) ? Number(f.mediaTime) : (Number.isFinite(Number(f.clampedTimeSec)) ? Number(f.clampedTimeSec) : (Number.isFinite(Number(f.requestedTimeSec)) ? Number(f.requestedTimeSec) : null))),
        decodedFrameIndex: Number.isInteger(Number(f.decodedFrameIndex)) ? Number(f.decodedFrameIndex) : f.index,
        representativeTimelineFrameIndex: Number.isInteger(Number(f.representativeTimelineFrameIndex)) ? Number(f.representativeTimelineFrameIndex) : f.index,
        timelineFrameIndices: Array.isArray(f.timelineFrameIndices) ? f.timelineFrameIndices : [],
        requestedTimeSec: Number.isFinite(Number(f.requestedTimeSec)) ? Number(f.requestedTimeSec) : (Array.isArray(frameTimes) ? frameTimes[i] : null),
        clampedTimeSec: Number.isFinite(Number(f.clampedTimeSec)) ? Number(f.clampedTimeSec) : (Array.isArray(frameTimes) ? frameTimes[i] : null),
        mediaTime: Number.isFinite(Number(f.mediaTime)) ? Number(f.mediaTime) : null,
        rendererVideoCurrentTime: Number.isFinite(Number(f.rendererVideoCurrentTime)) ? Number(f.rendererVideoCurrentTime) : null,
        capturedHash: f.capturedHash || null,
        outputFilename: f.name,
        alphaFilename: files[i] || null
      }));
      writeDebugJson("extract-manifest.json", {
        jobId,
        mode: rendererFrameInputs ? (hasRendererDecodedFrames ? "rendererDecodedFrameManifest" : "rendererSourceFrameCapture") : (framePlanItems ? "framePlanExactSeek" : "legacyFpsSequence"),
        fps,
        fpsExpr,
        totalFrames: maxFrames,
        decodedFrameManifest: rendererDecodedFrameManifest,
        timelineToDecodedFrameMap: rendererTimelineToDecodedFrameMap,
        decodedFrameManifestHash,
        frames: frameManifest
      });
      writeDebugJson("frame-sync-first16.json", {
        jobId,
        frames: frameManifest.slice(0, 16).map((f) => ({
          rendererSourceFrameIndex: f.sourceFrameIndex,
          alphaSourceFrameIndex: f.alphaSourceFrameIndex,
          rgbSourceFrameIndex: f.rgbSourceFrameIndex,
          rgbSourceTimeSec: f.rgbSourceTimeSec,
          decodedFrameIndex: f.decodedFrameIndex,
          representativeTimelineFrameIndex: f.representativeTimelineFrameIndex,
          timelineFrameIndices: f.timelineFrameIndices,
          rendererTimeSec: f.requestedTimeSec,
          mainExtractSequenceIndex: f.sequenceIndex,
          mainExtractSourceFrameIndex: f.sourceFrameIndex,
          requestedTimeSec: f.requestedTimeSec,
          clampedTimeSec: f.clampedTimeSec,
          mediaTime: f.mediaTime,
          rendererVideoCurrentTime: f.rendererVideoCurrentTime,
          capturedHash: f.capturedHash,
          alphaSourceFrameIndex: f.decodedFrameIndex,
          cacheFrameIndex: f.decodedFrameIndex,
          outputFilename: f.outputFilename,
          alphaFilename: f.alphaFilename
        }))
      });
      try {
        if (debugDir) {
          for (let i = 0; i < Math.min(5, sourceFiles.length); i++) {
            const sf = sourceFiles[i];
            const alphaName = files[i];
            const sourcePath = path.join(inFramesDir, sf.name);
            const alphaPath = path.join(outFramesDir, alphaName);
            const prefix = String(i).padStart(3, "0");
            if (fs.existsSync(sourcePath)) {
              fs.copyFileSync(sourcePath, path.join(debugDir, `source_${prefix}_sf${sf.index}.png`));
            }
            if (fs.existsSync(alphaPath)) {
              await sharp(alphaPath).ensureAlpha().extractChannel(3).png().toFile(path.join(debugDir, `mask_${prefix}_sf${sf.index}.png`));
              const { data: alphaDebug, info: alphaInfo } = await sharp(alphaPath).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
              await sharp(sourcePath)
                .removeAlpha()
                .joinChannel(alphaDebug, { raw: { width: alphaInfo.width, height: alphaInfo.height, channels: 1 } })
                .png()
                .toFile(path.join(debugDir, `composite_${prefix}_sf${sf.index}.png`));
            }
          }
        }
      } catch (e) {
        appendLogLine("warn", "ai-frame-debug-write-failed", { jobId, error: String(e?.message || e) });
      }

      let width = 0;
      let height = 0;
      let alphaAll = null;
      let alphaFrameBytes = 0;
      for (let i = 0; i < maxFrames; i++) {
        const p = path.join(outFramesDir, files[i]);
        const { data: aBuf2, info } = await sharp(p).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
        const w = Number(info?.width) || 0;
        const h = Number(info?.height) || 0;
        if (!w || !h) return { ok: false, error: `遮罩尺寸无效：${files[i]}` };
        if (!width) {
          width = w;
          height = h;
          alphaFrameBytes = width * height;
          const alphaTotalBytes = alphaFrameBytes * maxFrames;
          if (!Number.isSafeInteger(alphaTotalBytes) || alphaTotalBytes <= 0) {
            return { ok: false, error: "AI cutout alpha payload size is invalid" };
          }
          alphaAll = Buffer.allocUnsafe(alphaTotalBytes);
        }
        if (w !== width || h !== height) return { ok: false, error: `遮罩尺寸不一致：${files[i]}` };
        if (aBuf2.length !== alphaFrameBytes || !alphaAll) {
          return { ok: false, error: `AI cutout alpha frame byte length mismatch: ${files[i]}` };
        }
        aBuf2.copy(alphaAll, i * alphaFrameBytes);
        if (i % 8 === 0) {
          sendProgress({ state: "running", stage: "pack", message: `读取遮罩… ${i + 1}/${maxFrames}`, progress01: 0.7 + 0.2 * (i / Math.max(1, maxFrames)) });
        }
      }
      if (!alphaAll || alphaAll.length !== width * height * maxFrames) {
        return { ok: false, error: "AI cutout alpha payload is incomplete" };
      }
      const alphaMemory = process.memoryUsage();
      appendLogLine("info", "ai-cutout-alpha-binary-packed", {
        jobId,
        width,
        height,
        frames: maxFrames,
        alphaByteLength: alphaAll.length,
        rss: alphaMemory.rss,
        external: alphaMemory.external,
        arrayBuffers: alphaMemory.arrayBuffers
      });
      const sourceFrameIndices = sourceFiles.map((f) => f.index);
      const decodedFrameIndices = hasRendererDecodedFrames ? sourceFrameIndices : null;
      const finalFrameTimes = canonicalFramePlan?.frameTimes?.length === sourceFiles.length
        ? sourceFiles.map((f) => canonicalFramePlan.frameTimes[f.sequenceIndex])
        : frameTimes;
      const buildMaskResult = () => ({
        ok: true,
        jobId,
        kind: "video",
        fps,
        frames: maxFrames,
        width,
        height,
        sourceFrameIndices,
        decodedFrameIndices,
        frameTimes: Array.isArray(finalFrameTimes) ? finalFrameTimes.slice(0, maxFrames) : null,
        frameManifest,
        decodedFrameManifest: rendererDecodedFrameManifest,
        timelineToDecodedFrameMap: rendererTimelineToDecodedFrameMap,
        decodedFrameManifestHash,
        debugDir,
        alphaEncoding: "u8-mask-v1",
        alphaByteLength: alphaAll.length,
        alphaBytes: new Uint8Array(alphaAll.buffer, alphaAll.byteOffset, alphaAll.byteLength)
      });
      // Only clients that retain the exact captured RGB frames opt into this.
      // Their preview and final matting consume the checked binary masks; the
      // two legacy intermediate video encodes would immediately be discarded.
      if (payload?.returnMaskOnly === true && Number(payload?.rendererFramesVersion) === 2 && hasRendererDecodedFrames) {
        sendProgress({ state: "done", stage: "done", message: "完成", progress01: 1 });
        return { ...buildMaskResult(), maskOnly: true };
      }
      const makeEncodePattern = (srcDir, names, label) => {
        try {
          const alreadySequential = names.every((name, i) => String(name || "").toLowerCase() === frameFileName(i).toLowerCase());
          if (alreadySequential) return path.join(srcDir, "f_%06d.png");
          const seqDir = path.join(workDir, label);
          fs.mkdirSync(seqDir, { recursive: true });
          for (let i = 0; i < names.length; i++) {
            fs.copyFileSync(path.join(srcDir, names[i]), path.join(seqDir, frameFileName(i)));
          }
          return path.join(seqDir, "f_%06d.png");
        } catch {
          return path.join(srcDir, "f_%06d.png");
        }
      };
      const patternInForEncode = makeEncodePattern(inFramesDir, sourceFiles.map((f) => f.name), "frames_in_encode");
      const patternOutForEncode = makeEncodePattern(outFramesDir, files, "frames_out_encode");

      let srcVideoBuf = null;
      let srcVideoFileName = null;
      try {
        sendProgress({ state: "running", stage: "encode", message: "生成预览视频…", progress01: 0.9 });
        const srcVideo = path.join(workDir, `src_${sanitizeFileStem(aName, "video")}.mp4`);
        const encSrcArgs = [
          "-hide_banner",
          "-loglevel", "error",
          "-y",
          "-framerate", String(fpsExpr),
          "-start_number", "0",
          "-i", patternInForEncode,
          "-frames:v", String(maxFrames),
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-crf", "18",
          srcVideo
        ];
        const enSrc = await runCmd(ffmpegPath, encSrcArgs, { cwd: workDir });
        if (enSrc.ok && fs.existsSync(srcVideo)) {
          srcVideoBuf = fs.readFileSync(srcVideo);
          srcVideoFileName = path.basename(srcVideo);
        }
      } catch {}

      sendProgress({ state: "running", stage: "encode", message: "合成透明视频…", progress01: 0.92 });
      const outVideo = path.join(workDir, `rembg_${sanitizeFileStem(aName, "video")}.webm`);
      const encArgs = [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-framerate", String(fpsExpr),
        "-start_number", "0",
        "-i", patternOutForEncode,
        "-c:v", "libvpx-vp9",
        "-pix_fmt", "yuva420p",
        "-metadata:s:v:0", "alpha_mode=1",
        "-b:v", "0",
        "-crf", "30",
        outVideo
      ];
      const en = await runCmd(ffmpegPath, encArgs, { cwd: workDir });
      if (!en.ok) return { ok: false, error: `ffmpeg 合成失败：${String(en.stderr || en.stdout || "").slice(0, 240)}` };
      const outVideoBuf = fs.readFileSync(outVideo);

      sendProgress({ state: "done", stage: "done", message: "完成", progress01: 1 });
      return {
        ...buildMaskResult(),
        srcVideoFileName: srcVideoFileName,
        srcVideoBase64: srcVideoBuf ? srcVideoBuf.toString("base64") : null,
        outVideoFileName: path.basename(outVideo),
        outVideoBase64: outVideoBuf.toString("base64")
      };
    } finally {
      await cleanup();
    }
  } catch (err) {
    sendProgress({ state: "error", stage: "error", message: String(err?.message || err), progress01: 1 });
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("license-import-file", async () => {
  const pick = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "NovaFlow License", extensions: ["nfl", "json"] }]
  });
  if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };
  const filePath = pick.filePaths[0];
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const obj = licenseCore.parseLicenseInput(raw);
    const verified = await verifyImportedLicenseObjectOnline(obj, "license-import-file");
    if (!verified.ok) return verified;
    await licenseCore.saveLicenseToDiskAsync(app.getPath("userData"), obj);
    invalidateOnlineEntitlementSuccessReuse("license-import-file");
    return { ok: true, state: verified.state };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("license-import-text", async (_evt, payload) => {
  const text = payload?.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("invalid payload");
  try {
    const obj = licenseCore.parseLicenseInput(text);
    const verified = await verifyImportedLicenseObjectOnline(obj, "license-import-text");
    if (!verified.ok) return verified;
    await licenseCore.saveLicenseToDiskAsync(app.getPath("userData"), obj);
    invalidateOnlineEntitlementSuccessReuse("license-import-text");
    return { ok: true, state: verified.state };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("pick-directory", async () => {
  const pick = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"]
  });
  if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };
  return { canceled: false, dir: pick.filePaths[0] };
});

handleNovaFlowTempIpc("write-binary-file", async (_evt, payload) => {
  try {
    const dir = payload?.dir;
    const fileName = normalizeNovaflowExportWriteFileName(payload?.fileName, "frame");
    if (!isInternalCutoutSaveFrameWrite(dir, fileName)) {
      await assertOnlineEntitled("export", "write-binary-file");
    }
    const bytes = payload?.bytes;
    if (typeof dir !== "string" || !dir.trim()) throw new Error("invalid payload");
    if (!fileName) throw new Error("invalid payload");
    if (!bytes || typeof bytes !== "object") throw new Error("invalid payload");
    const buf = Buffer.from(bytes);
    const fullPath = path.join(dir, fileName);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, buf);
    return { ok: true };
  } catch (err) {
    return toIpcErrorResult(err, "write_binary_file_failed");
  }
});

ipcMain.handle("compress-png-lossless", async (_evt, payload) => {
  try {
    return await compressPngWithSharp(payload, { palette: false });
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("compress-png-strong", async (_evt, payload) => {
  try {
    return await compressPngWithSharp(payload, { palette: true });
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("compress-spine-atlas-safe", async (_evt, payload) => {
  try {
    return await compressPngWithSharp(payload, { palette: false });
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("convert-spine-atlas-webp", async (_evt, payload) => {
  try {
    return await convertSpineAtlasWebp(payload, { fs, sharp });
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("save-spine-atlas-webp-output", async (_evt, payload) => {
  try {
    const pick = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    if (pick.canceled || !pick.filePaths?.[0]) return { ok: true, canceled: true };

    const saved = writeSpineAtlasWebpOutput({ ...payload, dir: pick.filePaths[0] }, { fs });
    return { ...saved, canceled: false };
  } catch (err) {
    return toIpcErrorResult(err, "save_spine_atlas_webp_output_failed");
  }
});

ipcMain.handle("overwrite-spine-atlas-webp-output", async (_evt, payload) => {
  try {
    return overwriteSpineAtlasWebpOutput(payload, { fs });
  } catch (err) {
    return toIpcErrorResult(err, "overwrite_spine_atlas_webp_output_failed");
  }
});

// One work dir per 工具 video entry: a result has to outlive the call that made it, because the
// user runs a batch first and only then picks where it goes -- and clearing one tool's list must
// not take the other tool's results with it.
const novaFlowVideoToolWorkDirs = new Map();

function getNovaFlowVideoToolWorkDir(tool) {
  const key = String(tool || "").trim() || "video-tool";
  const existing = novaFlowVideoToolWorkDirs.get(key);
  if (existing && fs.existsSync(existing)) return existing;
  // The category has to be one the session manager already allows -- "video", where every other
  // video temp file lives. The tool key is the work-dir prefix instead, which is what actually
  // keeps the two 工具 entries apart: each gets its own mkdtemp directory to fill and to clear.
  const dir = createNovaFlowTempWorkDir("video", `video-tool-${key}`);
  novaFlowVideoToolWorkDirs.set(key, dir);
  return dir;
}

function novaFlowVideoToolJobId(payload, prefix) {
  return typeof payload?.jobId === "string" && payload.jobId.trim()
    ? payload.jobId.trim()
    : `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function novaFlowVideoToolDeps(evt, jobId) {
  return {
    fs,
    path,
    spawn,
    runCmd,
    ffmpegPath,
    ffprobePath,
    trackChild: (child) => trackNovaFlowCommandChild(child),
    onProgress: (ratio) => {
      try { evt.sender.send("video-tool-progress", { jobId, progress01: ratio }); } catch {}
    }
  };
}

handleNovaFlowTempIpc("compress-mp4", async (evt, payload) => {
  const jobId = novaFlowVideoToolJobId(payload, "mp4");
  try {
    const result = await compressMp4(
      { ...payload, outDir: getNovaFlowVideoToolWorkDir("mp4-compress") },
      novaFlowVideoToolDeps(evt, jobId)
    );
    return { ...result, jobId };
  } catch (err) {
    return toIpcErrorResult(err, "compress_mp4_failed");
  }
});

handleNovaFlowTempIpc("convert-video-format", async (evt, payload) => {
  const jobId = novaFlowVideoToolJobId(payload, "convert");
  try {
    const result = await convertVideoFormat(
      { ...payload, outDir: getNovaFlowVideoToolWorkDir("video-convert") },
      novaFlowVideoToolDeps(evt, jobId)
    );
    return { ...result, jobId };
  } catch (err) {
    return toIpcErrorResult(err, "convert_video_format_failed");
  }
});

handleNovaFlowTempIpc("save-video-tool-output", async (_evt, payload) => {
  try {
    await assertOnlineEntitled("export", "save-video-tool-output");
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (!items.length) return { ok: false, error: "没有可导出的视频" };
    const dir = String(payload?.dir || "").trim() || await (async () => {
      const pick = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
      return pick.canceled ? "" : String(pick.filePaths?.[0] || "");
    })();
    if (!dir) return { ok: true, canceled: true };
    const saved = [];
    for (const item of items) {
      const srcPath = String(item?.srcPath || "").trim();
      const fileName = sanitizeFileName(item?.fileName) || "video-output.mp4";
      if (!srcPath || !fs.existsSync(srcPath)) throw new Error(`找不到结果文件：${fileName}`);
      const target = path.join(dir, fileName);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(srcPath, target);
      saved.push(target);
    }
    return { ok: true, canceled: false, dir, saved };
  } catch (err) {
    return toIpcErrorResult(err, "save_video_tool_output_failed");
  }
});

handleNovaFlowTempIpc("overwrite-video-tool-output", async (_evt, payload) => {
  try {
    await assertOnlineEntitled("export", "overwrite-video-tool-output");
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (!items.length) return { ok: false, error: "没有可覆盖的视频" };
    const written = [];
    for (const item of items) {
      const srcPath = String(item?.srcPath || "").trim();
      const targetPath = String(item?.targetPath || "").trim();
      if (!srcPath || !fs.existsSync(srcPath)) throw new Error("找不到结果文件");
      if (!targetPath || !fs.existsSync(targetPath)) throw new Error("找不到原始视频文件");
      // A kept-original result points at the source: copying it onto itself would truncate the
      // file on some filesystems, and there is nothing to write anyway.
      if (path.resolve(srcPath) === path.resolve(targetPath)) continue;
      fs.copyFileSync(srcPath, targetPath);
      written.push(targetPath);
    }
    return { ok: true, written };
  } catch (err) {
    return toIpcErrorResult(err, "overwrite_video_tool_output_failed");
  }
});

handleNovaFlowTempIpc("clear-video-tool-output", async (_evt, payload) => {
  try {
    const key = String(payload?.tool || "").trim();
    const dir = key ? novaFlowVideoToolWorkDirs.get(key) : "";
    if (key) novaFlowVideoToolWorkDirs.delete(key);
    if (dir) await cleanupNovaFlowTempWorkDir(dir, "clear-video-tool-output");
    return { ok: true };
  } catch (err) {
    return toIpcErrorResult(err, "clear_video_tool_output_failed");
  }
});

ipcMain.handle("save-spine-package", async (_evt, payload) => {
  try {
    await assertOnlineEntitled("export", "save-spine-package");
    const baseName = normalizeNovaflowExportBaseName(payload?.baseName, "particle_spine");
    const json = payload?.json;
    let atlas = payload?.atlas;
    const images = Array.isArray(payload?.images) ? payload.images : [];

    if (typeof json !== "string" || typeof atlas !== "string") {
      throw new Error("invalid payload");
    }

    const pick = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };
    const dir0 = pick.filePaths[0];
    const dir = path.join(dir0, "NovaFlow");
    fs.mkdirSync(dir, { recursive: true });

    const imagePackage = shouldNormalizeNovaflowExportPackageImages(payload?.baseName, images)
      ? normalizeNovaflowExportPackageImages(images, baseName)
      : { images, replacements: [] };
    if (imagePackage.replacements.length) {
      atlas = replaceNovaflowExportTextReferences(atlas, imagePackage.replacements);
    }

    fs.writeFileSync(path.join(dir, `${baseName}.json`), json, "utf8");
    fs.writeFileSync(path.join(dir, `${baseName}.atlas`), atlas, "utf8");

    for (const img of imagePackage.images) {
      const fileName = sanitizeFileName(img?.fileName);
      const dataUrl = img?.dataUrl;
      if (!fileName || typeof dataUrl !== "string") continue;
      const buf = dataUrlToBuffer(dataUrl);
      if (!buf) continue;
      fs.writeFileSync(path.join(dir, fileName), buf);
    }

    return { canceled: false, dir };
  } catch (err) {
    return toIpcErrorResult(err, "save_spine_package_failed");
  }
});

ipcMain.handle("save-split-package", async (_evt, payload) => {
  try {
    await assertOnlineEntitled("export", "save-split-package");
    const baseName = sanitizeFileStem(payload?.baseName, "spine_split_export");
    const manifestText = typeof payload?.manifest === "string" ? payload.manifest : "";
    const sourceDataUrl = typeof payload?.sourceDataUrl === "string" ? payload.sourceDataUrl : "";
    const previewDataUrl = typeof payload?.previewDataUrl === "string" ? payload.previewDataUrl : "";
    const psdDataUrl = typeof payload?.psdDataUrl === "string" ? payload.psdDataUrl : "";
    const parts = Array.isArray(payload?.parts) ? payload.parts : [];
    if (!manifestText || !parts.length) throw new Error("invalid payload");

    let incomingManifest = null;
    try {
      incomingManifest = JSON.parse(manifestText);
    } catch {
      throw new Error("invalid manifest");
    }
    const manifestParts = Array.isArray(incomingManifest?.parts) ? incomingManifest.parts : [];
    const allowedPurposes = new Set(["spine"]);
    const purpose = allowedPurposes.has(incomingManifest?.purpose) ? incomingManifest.purpose : "spine";

    const pick = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };

    const dir = makeUniqueChildDir(pick.filePaths[0], baseName);
    const imagesDir = path.join(dir, "images");
    const masksDir = path.join(dir, "masks");
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(masksDir, { recursive: true });

    const sourceBuf = sourceDataUrl ? dataUrlToBuffer(sourceDataUrl, { mime: "image/png", requirePng: true }) : null;
    if (!sourceBuf) throw new Error("source.png invalid");
    if (sourceBuf) fs.writeFileSync(path.join(dir, "source.png"), sourceBuf);

    const previewBuf = previewDataUrl ? dataUrlToBuffer(previewDataUrl, { mime: "image/png", requirePng: true }) : null;
    if (previewDataUrl && !previewBuf) throw new Error("preview.png invalid");
    if (previewBuf) fs.writeFileSync(path.join(dir, "preview.png"), previewBuf);

    const psdBuf = psdDataUrl ? dataUrlToBuffer(psdDataUrl, { mimeOneOf: ["image/vnd.adobe.photoshop", "application/octet-stream"], requirePsd: true }) : null;
    if (psdDataUrl && !psdBuf) throw new Error("layers.psd invalid");
    if (psdBuf) fs.writeFileSync(path.join(dir, "layers.psd"), psdBuf);

    const usedStems = new Set();
    const safeParts = [];
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] || {};
      const rawId = String(part?.id || `part_${i + 1}`).trim() || `part_${i + 1}`;
      const meta = manifestParts.find((item) => String(item?.id || "") === rawId || String(item?.name || "") === rawId) || {};
      const baseStem = sanitizeFileStem(part?.imageFileName || rawId, `part_${i + 1}`).replace(/_mask$/i, "") || `part_${i + 1}`;
      let stem = baseStem;
      let suffix = 2;
      while (usedStems.has(stem)) {
        stem = `${baseStem}_${suffix}`;
        suffix += 1;
      }
      usedStems.add(stem);

      const id = sanitizeFileStem(rawId, stem) || stem;
      const imageFileName = ensurePngFileName(stem, `part_${i + 1}`);
      const maskFileName = ensurePngFileName(`${stem}_mask`, `${stem}_mask`);
      const imageBuf = typeof part?.dataUrl === "string"
        ? dataUrlToBuffer(part.dataUrl, { mime: "image/png", requirePng: true })
        : null;
      if (!imageBuf) throw new Error(`PNG 导出失败：${id}`);
      const hasMaskData = typeof part?.maskDataUrl === "string" && part.maskDataUrl.trim();
      const maskBuf = hasMaskData
        ? dataUrlToBuffer(part.maskDataUrl, { mime: "image/png", requirePng: true })
        : null;
      if (hasMaskData && !maskBuf) throw new Error(`mask 导出失败：${id}`);
      if (purpose === "spine" && !maskBuf) throw new Error(`mask 生成失败：${id}`);

      fs.writeFileSync(path.join(imagesDir, imageFileName), imageBuf);
      if (maskBuf) fs.writeFileSync(path.join(masksDir, maskFileName), maskBuf);

      safeParts.push({
        id,
        name: String(meta?.name || id).slice(0, 80),
        prompt: String(meta?.prompt || "").slice(0, 400),
        file: `images/${imageFileName}`,
        maskFile: maskBuf ? `masks/${maskFileName}` : "",
        x: clampManifestNumber(meta?.x, -1000000, 1000000, 0),
        y: clampManifestNumber(meta?.y, -1000000, 1000000, 0),
        width: clampManifestNumber(meta?.width, 0, 1000000, 0),
        height: clampManifestNumber(meta?.height, 0, 1000000, 0),
        pivot: {
          x: clampManifestNumber(meta?.pivot?.x, 0, 1, 0.5),
          y: clampManifestNumber(meta?.pivot?.y, 0, 1, 0.5)
        },
        layer: clampManifestNumber(meta?.layer, -10000, 10000, i * 10),
        visible: meta?.visible !== false,
        needsInpaint: !!meta?.needsInpaint
      });
    }
    if (!safeParts.length) throw new Error("没有可导出的拆图结果");

    const safeManifest = {
      version: String(incomingManifest?.version || "1.0").slice(0, 20),
      source: "source.png",
      purpose,
      psd: psdBuf ? "layers.psd" : "",
      createdAt: String(incomingManifest?.createdAt || new Date().toISOString().replace("T", " ").slice(0, 19)).slice(0, 32),
      parts: safeParts
    };
    fs.writeFileSync(path.join(dir, "split_manifest.json"), JSON.stringify(safeManifest, null, 2), "utf8");

    return { ok: true, canceled: false, dir };
  } catch (err) {
    return toIpcErrorResult(err, "save_split_package_failed");
  }
});

handleNovaFlowTempIpc("save-split-temp-package", async (_evt, payload) => {
  try {
    const baseName = sanitizeFileStem(payload?.baseName, "spine_split_temp");
    const manifestText = typeof payload?.manifest === "string" ? payload.manifest : "";
    const sourceDataUrl = typeof payload?.sourceDataUrl === "string" ? payload.sourceDataUrl : "";
    const sourceFileName = sanitizeFileName(payload?.sourceFileName || "source.png") || "source.png";
    const previewDataUrl = typeof payload?.previewDataUrl === "string" ? payload.previewDataUrl : "";
    const psdDataUrl = typeof payload?.psdDataUrl === "string" ? payload.psdDataUrl : "";
    const parts = Array.isArray(payload?.parts) ? payload.parts : [];
    if (!manifestText || !parts.length) throw new Error("invalid payload");

    let incomingManifest = null;
    try {
      incomingManifest = JSON.parse(manifestText);
    } catch {
      throw new Error("invalid manifest");
    }

    cleanupSplitTempRoot("save-split-temp-package");
    const splitTempRoot = getSplitTempRoot();
    fs.mkdirSync(splitTempRoot, { recursive: true });
    const dir = makeUniqueChildDir(splitTempRoot, baseName);
    const imagesDir = path.join(dir, "images");
    const masksDir = path.join(dir, "masks");
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(masksDir, { recursive: true });

    const sourceBuf = sourceDataUrl ? dataUrlToBuffer(sourceDataUrl) : null;
    if (sourceBuf) fs.writeFileSync(path.join(dir, sourceFileName), sourceBuf);

    const previewBuf = previewDataUrl ? dataUrlToBuffer(previewDataUrl, { mime: "image/png", requirePng: true }) : null;
    if (previewDataUrl && !previewBuf) throw new Error("preview.png invalid");
    if (previewBuf) fs.writeFileSync(path.join(dir, "preview.png"), previewBuf);

    const psdBuf = psdDataUrl ? dataUrlToBuffer(psdDataUrl, { mimeOneOf: ["image/vnd.adobe.photoshop", "application/octet-stream"], requirePsd: true }) : null;
    if (psdDataUrl && !psdBuf) throw new Error("layers.psd invalid");
    if (psdBuf) fs.writeFileSync(path.join(dir, "layers.psd"), psdBuf);

    const manifestParts = Array.isArray(incomingManifest?.parts) ? incomingManifest.parts : [];
    const safeParts = [];
    const usedStems = new Set();
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] || {};
      const rawId = String(part?.id || `part_${i + 1}`).trim() || `part_${i + 1}`;
      const meta = manifestParts.find((item) => String(item?.id || "") === rawId || String(item?.name || "") === rawId) || {};
      const baseStem = sanitizeFileStem(part?.imageFileName || rawId, `part_${i + 1}`).replace(/_mask$/i, "") || `part_${i + 1}`;
      let stem = baseStem;
      let suffix = 2;
      while (usedStems.has(stem)) {
        stem = `${baseStem}_${suffix}`;
        suffix += 1;
      }
      usedStems.add(stem);
      const id = sanitizeFileStem(rawId, stem) || stem;
      const imageFileName = ensurePngFileName(stem, `part_${i + 1}`);
      const maskFileName = ensurePngFileName(`${stem}_mask`, `${stem}_mask`);
      const imageBuf = typeof part?.dataUrl === "string"
        ? dataUrlToBuffer(part.dataUrl, { mime: "image/png", requirePng: true })
        : null;
      if (!imageBuf) throw new Error(`PNG 缓存失败：${id}`);
      const maskBuf = typeof part?.maskDataUrl === "string" && part.maskDataUrl.trim()
        ? dataUrlToBuffer(part.maskDataUrl, { mime: "image/png", requirePng: true })
        : null;
      fs.writeFileSync(path.join(imagesDir, imageFileName), imageBuf);
      if (maskBuf) fs.writeFileSync(path.join(masksDir, maskFileName), maskBuf);
      safeParts.push({
        ...meta,
        id,
        name: String(meta?.name || id).slice(0, 80),
        file: `images/${imageFileName}`,
        maskFile: maskBuf ? `masks/${maskFileName}` : ""
      });
    }

    fs.writeFileSync(path.join(dir, "split_manifest.json"), JSON.stringify({
      version: String(incomingManifest?.version || "1.0").slice(0, 20),
      source: sourceBuf ? sourceFileName : "",
      purpose: "spine",
      psd: psdBuf ? "layers.psd" : "",
      createdAt: String(incomingManifest?.createdAt || new Date().toISOString().replace("T", " ").slice(0, 19)).slice(0, 32),
      parts: safeParts
    }, null, 2), "utf8");

    return { ok: true, dir };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

handleNovaFlowTempIpc("save-split-debug-images", async (_evt, payload) => {
  try {
    const runId = sanitizeFileStem(payload?.runId || `split_debug_${Date.now()}`, "split_debug");
    const images = Array.isArray(payload?.images) ? payload.images : [];
    if (!images.length) throw new Error("invalid debug images");
    const splitTempRoot = getSplitTempRoot();
    fs.mkdirSync(splitTempRoot, { recursive: true });
    const dir = makeUniqueChildDir(splitTempRoot, runId);
    const saved = [];
    const used = new Set();
    for (let i = 0; i < images.length; i += 1) {
      const item = images[i] || {};
      const stemBase = sanitizeFileStem(item.name || `debug_${i + 1}`, `debug_${i + 1}`);
      let stem = stemBase;
      let suffix = 2;
      while (used.has(stem)) {
        stem = `${stemBase}_${suffix}`;
        suffix += 1;
      }
      used.add(stem);
      const buf = typeof item.dataUrl === "string"
        ? dataUrlToBuffer(item.dataUrl, { mime: "image/png", requirePng: true })
        : null;
      if (!buf) continue;
      const filePath = path.join(dir, `${stem}.png`);
      fs.writeFileSync(filePath, buf);
      saved.push({ name: String(item.name || stem), path: filePath });
    }
    if (!saved.length) throw new Error("debug image save failed");
    return { ok: true, dir, images: saved };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("save-split-psd", async (_evt, payload) => {
  try {
    await assertOnlineEntitled("export", "save-split-psd");
    const baseName = sanitizeFileStem(payload?.baseName, "spine_layers");
    const psdDataUrl = typeof payload?.psdDataUrl === "string" ? payload.psdDataUrl : "";
    const psdBuf = psdDataUrl ? dataUrlToBuffer(psdDataUrl, { mimeOneOf: ["image/vnd.adobe.photoshop", "application/octet-stream"], requirePsd: true }) : null;
    if (!psdBuf) throw new Error("PSD 导出失败");

    const pick = await dialog.showSaveDialog({
      defaultPath: `${baseName}.psd`,
      filters: [{ name: "Photoshop PSD", extensions: ["psd"] }]
    });
    if (pick.canceled || !pick.filePath) return { canceled: true };
    fs.writeFileSync(pick.filePath, psdBuf);
    return { ok: true, canceled: false, filePath: pick.filePath };
  } catch (err) {
    return toIpcErrorResult(err, "save_split_psd_failed");
  }
});

ipcMain.handle("save-text-file", async (_evt, payload) => {
  try {
    await assertOnlineEntitled("export", "save-text-file");
    const baseName = normalizeNovaflowExportBaseName(payload?.baseName, "particle_systems");
    const ext = typeof payload?.ext === "string" && payload.ext.trim().startsWith(".") ? payload.ext.trim() : ".json";
    const text = payload?.text;
    if (typeof text !== "string") throw new Error("invalid payload");

    const pick = await dialog.showSaveDialog({
      defaultPath: `${baseName}${ext}`,
      filters: [{ name: ext === ".json" ? "JSON" : "Text", extensions: [ext.replace(".", "")] }]
    });
    if (pick.canceled || !pick.filePath) return { canceled: true };
    fs.writeFileSync(pick.filePath, text, "utf8");
    return { canceled: false, filePath: pick.filePath };
  } catch (err) {
    return toIpcErrorResult(err, "save_text_file_failed");
  }
});

const videoCompositorExportService = createVideoCompositorExportService({
  fs,
  path,
  crypto,
  sharp,
  ffmpegPath,
  ffprobePath,
  runCommand: runCmd,
  spawnCommand(command, args, options = {}) {
    return trackNovaFlowCommandChild(spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    }));
  },
  terminateChild: terminateNovaFlowCommandChild,
  createWorkDir: createNovaFlowTempWorkDir,
  cleanupWorkDir: cleanupNovaFlowTempWorkDir,
  assertEntitled: assertOnlineEntitled,
  appAbortSignal: novaFlowTempJobsAbortController.signal,
  log(level, message, meta) {
    appendLogLine(level, message, meta);
  }
});

registerVideoCompositorExportIpc({
  service: videoCompositorExportService,
  handleIpc: handleNovaFlowTempIpc,
  toErrorResult: toIpcErrorResult
});

ipcMain.handle("export-pick-save-file", async (evt, payload) => {
  try {
    await assertOnlineEntitled("export", "export-pick-save-file");
    const format = String(payload?.format || "mp4").toLowerCase();
    const baseName = normalizeNovaflowExportBaseName(payload?.baseName, "novaflow_export");
    const ext = (format === "webm") ? ".webm" : (format === "gif" ? ".gif" : ".mp4");
    const pick = await dialog.showSaveDialog({
      defaultPath: `${baseName}${ext}`,
      filters: [{ name: ext.replace(".", "").toUpperCase(), extensions: [ext.replace(".", "")] }]
    });
    if (pick.canceled || !pick.filePath) {
      const restore = { name: baseName, baseName, format, mode: "video" };
      notifyNovaflowExportPickSaveCanceled(evt, restore);
      return { canceled: true, restore };
    }
    return { canceled: false, filePath: pick.filePath };
  } catch (err) {
    return toIpcErrorResult(err, "export_pick_save_file_failed");
  }
});

function getExportTempCategory(prefix) {
  const value = String(prefix || "").toLowerCase();
  if (value.startsWith("novaflow_cutout_save_")) return "cutout";
  if (value.startsWith("novaflow_seq_")) return "sequence";
  if (value.startsWith("novaflow_skeleton_vid_")) return "skeleton-video";
  if (value.startsWith("novaflow_vid_")) return "video";
  return "export";
}

handleNovaFlowTempIpc("export-create-temp-dir", async (_evt, payload) => {
  try {
    if (!isInternalCutoutSaveTempCreate(payload)) {
      await assertOnlineEntitled("export", "export-create-temp-dir");
    }
    const prefix = String(payload?.prefix || "novaflow_export_").replace(/[^a-zA-Z0-9_\\-]/g, "_").slice(0, 30) || "novaflow_export_";
    const dir = createNovaFlowTempWorkDir(getExportTempCategory(prefix), prefix);
    return { ok: true, dir };
  } catch (err) {
    return toIpcErrorResult(err, "export_create_temp_dir_failed");
  }
});

handleNovaFlowTempIpc("export-cleanup-dir", async (_evt, payload) => {
  try {
    const dir = String(payload?.dir || "");
    const cutoutTempDir = isCutoutSaveTempDir(dir);
    if (!cutoutTempDir) {
      await assertOnlineEntitled("export", "export-cleanup-dir");
    }
    if (!dir) return { ok: true };
    const result = await cleanupNovaFlowTempWorkDir(dir, "export-cleanup-dir");
    if (!result.ok) throw new Error(result.error || "temp directory cleanup failed");
    if (cutoutTempDir) appendCutoutFileTrace("cleanup-complete", { source: "save-and-close", filePath: dir });
    return { ok: true, retained: false };
  } catch (err) {
    return toIpcErrorResult(err, "export_cleanup_dir_failed");
  }
});

const cutoutRawEncoder = require("./main/cutout-raw-encoder").createCutoutRawEncoder({ffmpegPath, validate:isInternalCutoutSaveFrameEncode});
for (const [channel, method] of [["cutout-raw-start","start"],["cutout-raw-write","write"],["cutout-raw-abort","abort"]]) {
  handleNovaFlowTempIpc(channel, async (evt,payload) => {
    try { return await cutoutRawEncoder[method](evt,payload); }
    catch (error) { return toIpcErrorResult(error,"cutout_raw_"+method+"_failed"); }
  });
}
app.on("before-quit", () => { void cutoutRawEncoder.dispose(); });

handleNovaFlowTempIpc("export-encode-frames-to-video", async (_evt, payload) => {
  try {
    if (!isInternalCutoutSaveFrameEncode(payload)) {
      await assertOnlineEntitled("export", "export-encode-frames-to-video");
    }
    if (!ffmpegPath || typeof ffmpegPath !== "string" || !fs.existsSync(ffmpegPath)) {
      return { ok: false, error: "ffmpeg 不可用（未内置或打包缺失）" };
    }
    const dir = String(payload?.dir || "");
    const pattern = String(payload?.pattern || "f_%06d.png");
    const outPath = String(payload?.outPath || "");
    const format = String(payload?.format || "mp4").toLowerCase();
    const keepAlpha = !!payload?.keepAlpha;
    const fps = Math.max(1, Math.min(120, Math.round(Number(payload?.fps) || 30)));
    let w = Math.max(16, Math.min(8192, Math.round(Number(payload?.width) || 0)));
    let h = Math.max(16, Math.min(8192, Math.round(Number(payload?.height) || 0)));
    w = Math.max(16, Math.floor(w / 2) * 2);
    h = Math.max(16, Math.floor(h / 2) * 2);
    if (!dir || !outPath) return { ok: false, error: "invalid payload" };
    const buildEncodeResult = () => {
      const result = { ok: true };
      if (payload?.returnBase64) {
        result.base64 = fs.readFileSync(outPath).toString("base64");
      }
      return result;
    };
    const finalizeEncodeResult = async () => {
      await traceEncodedCutoutOutput("exportEncodeFramesToVideo", payload, outPath, {});
      return buildEncodeResult();
    };
    if (payload?.rawSessionId) {
      await cutoutRawEncoder.finish(_evt,payload);
      return await finalizeEncodeResult();
    }
    const inPattern = path.join(dir, pattern);
    const vf = `scale=${w}:${h}:flags=lanczos`;
    // PNG frames contain straight RGB. VP9 alpha also expects straight RGB;
    // premultiplying here makes translucent light dark when composited again.
    const vfAlpha = keepAlpha ? `${vf},format=yuva420p` : vf;

    if (format === "gif") {
      const args = [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-framerate", String(fps),
        "-start_number", "0",
        "-i", inPattern,
        "-filter_complex", `fps=${fps},${vf},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=new=1`,
        "-loop", "0",
        outPath
      ];
      const r = await runCmd(ffmpegPath, args, { cwd: dir });
      if (!r.ok) return { ok: false, error: `ffmpeg 合成失败：${String(r.stderr || r.stdout || "").slice(0, 520)}` };
      return await finalizeEncodeResult();
    }

    if (format === "webm") {
      const args = [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-framerate", String(fps),
        "-start_number", "0",
        "-i", inPattern,
        "-vf", vfAlpha,
        "-c:v", "libvpx-vp9",
        ...(isInternalCutoutSaveFrameEncode(payload) ? ["-row-mt", "1", "-threads", "4"] : []),
        ...(keepAlpha ? ["-auto-alt-ref", "0"] : []),
        "-pix_fmt", keepAlpha ? "yuva420p" : "yuv420p",
        ...(keepAlpha ? ["-metadata:s:v:0", "alpha_mode=1"] : []),
        "-b:v", "0",
        "-crf", "30",
        outPath
      ];
      const r = await runCmd(ffmpegPath, args, { cwd: dir });
      if (!r.ok) return { ok: false, error: `ffmpeg 合成失败：${String(r.stderr || r.stdout || "").slice(0, 520)}` };
      return await finalizeEncodeResult();
    }

    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-framerate", String(fps),
      "-start_number", "0",
      "-i", inPattern,
      "-vf", vf,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-crf", "18",
      outPath
    ];
    const r = await runCmd(ffmpegPath, args, { cwd: dir });
    if (!r.ok) return { ok: false, error: `ffmpeg 合成失败：${String(r.stderr || r.stdout || "").slice(0, 520)}` };
    return await finalizeEncodeResult();
  } catch (err) {
    return toIpcErrorResult(err, "export_encode_frames_to_video_failed");
  }
});

handleNovaFlowTempIpc("export-encode-video-to-video", async (_evt, payload) => {
  try {
    await assertOnlineEntitled("export", "export-encode-video-to-video");
    if (!ffmpegPath || typeof ffmpegPath !== "string" || !fs.existsSync(ffmpegPath)) {
      return { ok: false, error: "ffmpeg 不可用（未内置或打包缺失）" };
    }
    const inPath = String(payload?.inPath || "");
    const outPath = String(payload?.outPath || "");
    const format = String(payload?.format || "mp4").toLowerCase();
    const keepAlpha = !!payload?.keepAlpha;
    // sourceConvert means "the user dropped a video in and picked a format": keep the source
    // resolution and frame rate instead of squeezing the picture into the board's canvas.
    const sourceConvert = !!payload?.sourceConvert;
    const scalePct = Math.max(10, Math.min(400, Math.round(Number(payload?.scalePct) || 100)));
    const fps = Math.max(1, Math.min(120, Math.round(Number(payload?.fps) || 30)));
    let w = Math.max(16, Math.min(8192, Math.round(Number(payload?.width) || 0)));
    let h = Math.max(16, Math.min(8192, Math.round(Number(payload?.height) || 0)));
    w = Math.max(16, Math.floor(w / 2) * 2);
    h = Math.max(16, Math.floor(h / 2) * 2);
    if (!inPath || !outPath) return { ok: false, error: "invalid payload" };
    const buildEncodeResult = () => {
      const result = { ok: true };
      if (payload?.returnBase64) {
        result.base64 = fs.readFileSync(outPath).toString("base64");
      }
      return result;
    };
    const finalizeEncodeResult = async () => {
      await traceEncodedCutoutOutput("exportEncodeVideoToVideo", payload, outPath, { inputPath: inPath });
      return buildEncodeResult();
    };
    const dir = path.dirname(inPath);
    // A percentage off the decoded frame, rounded down to an even size, so the aspect ratio is
    // whatever the file already had -- including phone clips ffmpeg auto-rotates on the way in.
    const scaleFilter = sourceConvert
      ? `scale=max(2\\,trunc(iw*${scalePct}/200)*2):max(2\\,trunc(ih*${scalePct}/200)*2):flags=lanczos`
      : `scale=${w}:${h}:flags=lanczos`;
    const vf = sourceConvert ? scaleFilter : `fps=${fps},${scaleFilter}`;
    // Keep straight RGB through the alpha encode path (no second alpha multiply).
    const vfAlpha = keepAlpha ? `${vf},format=yuva420p` : vf;

    if (format === "gif") {
      const args = [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", inPath,
        "-filter_complex", `${vf},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse=new=1`,
        "-loop", "0",
        outPath
      ];
      const r = await runCmd(ffmpegPath, args, { cwd: dir });
      if (!r.ok) return { ok: false, error: `ffmpeg 转码失败：${String(r.stderr || r.stdout || "").slice(0, 520)}` };
      return await finalizeEncodeResult();
    }

    if (format === "webm") {
      const args = [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", inPath,
        "-vf", vfAlpha,
        "-c:v", "libvpx-vp9",
        // VP9 at its default speed turns a plain format change into a multi-minute wait.
        ...(sourceConvert ? ["-row-mt", "1", "-deadline", "good", "-cpu-used", "2"] : []),
        ...(keepAlpha ? ["-auto-alt-ref", "0"] : []),
        "-pix_fmt", keepAlpha ? "yuva420p" : "yuv420p",
        ...(keepAlpha ? ["-metadata:s:v:0", "alpha_mode=1"] : []),
        "-b:v", "0",
        "-crf", "30",
        outPath
      ];
      const r = await runCmd(ffmpegPath, args, { cwd: dir });
      if (!r.ok) return { ok: false, error: `ffmpeg 转码失败：${String(r.stderr || r.stdout || "").slice(0, 520)}` };
      return await finalizeEncodeResult();
    }

    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", inPath,
      "-vf", vf,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-crf", "18",
      outPath
    ];
    const r = await runCmd(ffmpegPath, args, { cwd: dir });
    if (!r.ok) return { ok: false, error: `ffmpeg 转码失败：${String(r.stderr || r.stdout || "").slice(0, 520)}` };
    return await finalizeEncodeResult();
  } catch (err) {
    return toIpcErrorResult(err, "export_encode_video_to_video_failed");
  }
});

ipcMain.handle("cutout-trace-append", async (_evt, payload) => {
  try {
    appendCutoutFileTrace(String(payload?.event || "renderer"), {
      source: payload?.source ? String(payload.source) : null,
      tool: payload?.tool ? String(payload.tool) : null,
      assetKind: payload?.assetKind ? String(payload.assetKind) : null,
      fileName: payload?.fileName ? String(payload.fileName) : null,
      mimeType: payload?.mimeType ? String(payload.mimeType) : null,
      blobSize: Number(payload?.blobSize) || null,
      fileSize: Number(payload?.fileSize) || null,
      captureMeta: payload?.captureMeta || null,
      note: "renderer metadata before commitCutoutFile"
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("open-spine-project", async () => {
  const pick = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Spine Project", extensions: ["json", "atlas", "png", "jpg", "jpeg"] }
    ]
  });
  if (pick.canceled || !pick.filePaths?.length) return { canceled: true };

  const files = pick.filePaths;
  const jsonPath = files.find((p) => p.toLowerCase().endsWith(".json"));
  const atlasPath = files.find((p) => p.toLowerCase().endsWith(".atlas"));
  const imagePaths = files.filter((p) => {
    const low = p.toLowerCase();
    return low.endsWith(".png") || low.endsWith(".jpg") || low.endsWith(".jpeg");
  });

  if (!jsonPath || !atlasPath || imagePaths.length === 0) {
    throw new Error("请至少选择 json + atlas + png/jpg");
  }

  const jsonText = fs.readFileSync(jsonPath, "utf8");
  const atlasText = fs.readFileSync(atlasPath, "utf8");
  const images = imagePaths.map((p) => {
    const buf = fs.readFileSync(p);
    const fileName = sanitizeFileName(p) || path.basename(p);
    const low = fileName.toLowerCase();
    const mime = low.endsWith(".png") ? "image/png" : "image/jpeg";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    return { fileName, dataUrl };
  });

  return {
    canceled: false,
    jsonText,
    atlasText,
    images
  };
});

ipcMain.handle("open-spine-json", async () => {
  const pick = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Spine JSON", extensions: ["json"] }]
  });
  if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };
  const filePath = pick.filePaths[0];
  const text = fs.readFileSync(filePath, "utf8");
  const fileName = sanitizeFileName(filePath) || path.basename(filePath);
  return { canceled: false, fileName, text };
});

ipcMain.handle("open-spine-atlas", async () => {
  const pick = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Spine ATLAS", extensions: ["atlas"] }]
  });
  if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };
  const filePath = pick.filePaths[0];
  const text = fs.readFileSync(filePath, "utf8");
  const fileName = sanitizeFileName(filePath) || path.basename(filePath);
  return { canceled: false, fileName, text };
});

ipcMain.handle("open-spine-image", async () => {
  const pick = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Spine Image", extensions: ["png", "jpg", "jpeg"] }]
  });
  if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };
  const filePath = pick.filePaths[0];
  const buf = fs.readFileSync(filePath);
  const fileName = sanitizeFileName(filePath) || path.basename(filePath);
  const low = fileName.toLowerCase();
  const mime = low.endsWith(".png") ? "image/png" : "image/jpeg";
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  return { canceled: false, fileName, dataUrl };
});

ipcMain.handle("open-photoshop-project", async () => {
  // PhotoshopToSpine export: one JSON plus an images folder. The renderer cannot open
  // a folder itself (an <input webkitdirectory> never opens a dialog in this app), so
  // the whole folder is read here and handed over as bytes.
  const pick = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };
  const root = pick.filePaths[0];
  const MAX_TOTAL = 512 * 1024 * 1024;
  const files = [];
  let total = 0;
  const walk = (dir, rel, depth) => {
    if (depth > 4) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relPath = rel ? rel + "/" + entry.name : entry.name;
      if (entry.isDirectory()) { walk(full, relPath, depth + 1); continue; }
      const low = entry.name.toLowerCase();
      const isJson = low.endsWith(".json");
      const isImage = low.endsWith(".png") || low.endsWith(".jpg") || low.endsWith(".jpeg");
      if (!isJson && !isImage) continue;
      const buf = fs.readFileSync(full);
      total += buf.length;
      if (total > MAX_TOTAL) throw new Error("\u6587\u4ef6\u592a\u5927\uff08\u8d85\u8fc7 512MB\uff09");
      files.push({
        name: entry.name,
        relativePath: relPath,
        mime: isJson ? "application/json" : (low.endsWith(".png") ? "image/png" : "image/jpeg"),
        base64: buf.toString("base64")
      });
    }
  };
  try { walk(root, "", 0); } catch (err) { return { canceled: false, error: String(err?.message || err) }; }
  return { canceled: false, folderName: path.basename(root), files };
});

ipcMain.handle("open-sequence-folder", async () => {
  const pick = await dialog.showOpenDialog({
    properties: ["openDirectory"]
  });
  if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };
  const dir = pick.filePaths[0];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => {
      const low = name.toLowerCase();
      return low.endsWith(".png") || low.endsWith(".jpg") || low.endsWith(".jpeg") || low.endsWith(".webp");
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  const frames = files.map((name) => {
    const filePath = path.join(dir, name);
    const buf = fs.readFileSync(filePath);
    const low = name.toLowerCase();
    const mime = low.endsWith(".png") ? "image/png" : low.endsWith(".webp") ? "image/webp" : "image/jpeg";
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    return { name, dataUrl };
  });

  return { canceled: false, folderName: path.basename(dir), frames };
});

function startNovaFlowRuntimeAfterLicense(win, source) {
  if (novaFlowAppShuttingDown) return;
  if (NF_ELECTRON_AB_NO_RUNTIME_AUTOSTART) {
    electronProfileIncrement("counters", "runtimeAutostartSkippedByAb", 1);
    electronProfileConsole("runtime-autostart-skipped", { source: String(source || "") });
    return;
  }
  setTimeout(() => {
    if (novaFlowAppShuttingDown) return;
    ensureNovaFlowRuntimeStarted({ source, timeoutMs: NOVAFLOW_AI_RUNTIME_START_TIMEOUT_MS })
      .then((status) => {
        try {
          sendRuntimeStatusChangedToWindow(win, status, source || "runtime-autostart");
        } catch {}
      })
      .catch((err) => {
        appendLogLine("error", "novaflow-runtime-startup-error", { source, message: String(err?.message || err) });
      });
  }, 0);
}

app.whenReady().then(async () => {
  if (!INSTANCE_PROFILE_READY) return;
  try {
    videoResourceMediaService.registerProtocol();
  } catch (error) {
    appendLogLine("error", "video-resource-media-protocol-register-failed", { error: String(error?.message || error) });
  }
  let tempSessionRegistration = null;
  try {
    tempSessionRegistration = await getNovaFlowTempSessionLifecycle().register({
      recoverOrphaned: () => cleanupNovaFlowLastOwnerData("startup-orphan-recovery")
    });
    novaFlowTempSessionRegistered = tempSessionRegistration.ok === true;
  } catch (error) {
    appendLogLine("error", "temp-session-register-failed", { error: String(error?.message || error) });
    INSTANCE_PROFILE_READY = false;
    app.quit();
    return;
  }
  const startupRuntimeConfig = readNovaFlowRuntimeConfig();
  const recoveredRuntime = tempSessionRegistration?.recovery?.runtime;
  const startupGeneratedPath = path.resolve(String(startupRuntimeConfig?.generatedPath || getNovaFlowRuntimeGeneratedDir()));
  if (isSafeNovaFlowRuntimeGeneratedRoot(startupGeneratedPath)) {
    void cleanupNovaFlowRuntimeQuarantineDirs(
      startupGeneratedPath,
      recoveredRuntime?.quarantinePaths || [],
      "startup-quarantine-recovery"
    ).then((result) => {
      if (!result.ok) {
        try { getNovaFlowTempSessionLifecycle().markCleanupPending("runtime_quarantine_cleanup_failed", { result }); } catch { void 0; }
      }
    }).catch((error) => {
      appendLogLine("warn", "runtime-quarantine-recovery-failed", { error: String(error?.message || error) });
      try { getNovaFlowTempSessionLifecycle().markCleanupPending("runtime_quarantine_cleanup_failed", { error: String(error?.message || error) }); } catch { void 0; }
    });
  }
  startElectronProfileConsoleReporter();
  electronProfileConsole("app-ready", snapshotElectronProfile());
  cleanupSplitTempRoot("startup");
  cleanupAiSeqCacheDir("startup");
  await resetTemplatesOnVersionChange();
  await seedInitialTemplatesIfMissing();
  await ensureNovaFlowAdminServerStarted({ source: "startup", timeoutMs: 7000 });
  if (IS_PORTABLE) {
    try {
      const exeDir = path.dirname(process.execPath || "");
      const p = path.join(exeDir, `NOVAFLOW_PORTABLE_STARTED_${String(app.getVersion() || "unknown").replace(/[^0-9A-Za-z._-]/g, "_")}.txt`);
      fs.writeFileSync(p, `version=${app.getVersion()}\nexecPath=${process.execPath}\nstartedAt=${new Date().toISOString()}\n`, "utf8");
    } catch {
      void 0;
    }
  }
  const win = NF_ELECTRON_EXTERNAL_BROWSER_URL
    ? createExternalBrowserHostWindow(NF_ELECTRON_EXTERNAL_BROWSER_URL)
    : createWindow(null);
  void scheduleNovaFlowLegacyTempMigration();
  startNovaFlowRuntimeAfterLicense(win, NF_ELECTRON_EXTERNAL_BROWSER_URL ? "startup-external-browser" : "startup");
  getEffectiveLicenseState("startup-status", { allowOfflineCache: false })
    .then((startupLicenseState) => {
      appendLogLine(isEffectiveLicenseAllowed(startupLicenseState) ? "info" : "warn", "startup-license-status", {
        status: startupLicenseState?.status || "unknown",
        reason: startupLicenseState?.reason || startupLicenseState?.error || "",
        licenseKey: startupLicenseState?.licenseKey || "",
        locked: startupLicenseState?.locked === true
      });
    })
    .catch((err) => {
      appendLogLine("error", "startup-license-status-error", { message: String(err?.message || err) });
    });
  app.on("activate", () => {
    if (NF_ELECTRON_EXTERNAL_BROWSER_URL) {
      if (BrowserWindow.getAllWindows().length === 0) {
        const nextWin = createExternalBrowserHostWindow(NF_ELECTRON_EXTERNAL_BROWSER_URL);
        startNovaFlowRuntimeAfterLicense(nextWin, "activate-external-browser");
      } else {
        launchExternalBrowserRenderer(NF_ELECTRON_EXTERNAL_BROWSER_URL);
      }
      return;
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      const nextWin = createWindow(null);
      startNovaFlowRuntimeAfterLicense(nextWin, "activate");
      getEffectiveLicenseState("activate-status", { allowOfflineCache: false })
        .then((state) => {
          appendLogLine(isEffectiveLicenseAllowed(state) ? "info" : "warn", "activate-license-status", {
            status: state?.status || "unknown",
            reason: state?.reason || state?.error || "",
            licenseKey: state?.licenseKey || "",
            locked: state?.locked === true
          });
        })
        .catch((err) => {
          appendLogLine("error", "activate-license-status-error", { message: String(err?.message || err) });
        });
    }
  });
});

const ensureAiSeqCacheDir = () => {
  const dir = getNovaFlowTempCategoryDir("ai-sequence-cache");
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
};
const AI_SEQ_GENERATED_CACHE_INDEX = ".generated-cache-index.json";
const normalizeAiSeqGeneratedCacheKey = (value) => {
  const key = String(value || "").trim();
  if (!key) return "";
  return key.replace(/[\r\n\t]+/g, " ").slice(0, 512);
};
const normalizeAiSeqGeneratedCacheGroup = (value, fallbackKey = "") => {
  const explicit = String(value || "").trim();
  const source = explicit || String(fallbackKey || "").split(":")[0] || "";
  return normalizeAiSeqGeneratedCacheKey(source);
};
const formatAiSeqWarehouseTimestamp = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  const year = String(date.getFullYear()).padStart(4, "0");
  return `${year}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};
const createAiSeqWarehouseFileName = (dir, prefix, ext) => {
  const safePrefix = String(prefix || "ais").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "ais";
  const safeExt = String(ext || ".mp4").match(/^\.[a-zA-Z0-9]{1,8}$/) ? String(ext).toLowerCase() : ".mp4";
  const stamp = formatAiSeqWarehouseTimestamp();
  const firstName = `${safePrefix}_${stamp}${safeExt}`;
  if (!fs.existsSync(path.join(dir, firstName))) return firstName;
  for (let index = 2; index <= 99; index += 1) {
    const name = `${safePrefix}_${stamp}_${index}${safeExt}`;
    if (!fs.existsSync(path.join(dir, name))) return name;
  }
  return `${safePrefix}_${stamp}_${Date.now()}${safeExt}`;
};
const isAiSeqCachePathInsideDir = (targetPath, dir) => {
  try {
    const resolvedTarget = path.resolve(String(targetPath || ""));
    const resolvedDir = path.resolve(String(dir || ""));
    return resolvedTarget === resolvedDir || resolvedTarget.startsWith(resolvedDir + path.sep);
  } catch {
    return false;
  }
};
const readAiSeqGeneratedCacheIndex = (dir) => {
  const indexPath = path.join(dir, AI_SEQ_GENERATED_CACHE_INDEX);
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return {
      version: 1,
      items: items
        .map((item) => ({
          cacheKey: normalizeAiSeqGeneratedCacheKey(item?.cacheKey),
          cacheGroup: normalizeAiSeqGeneratedCacheGroup(item?.cacheGroup, item?.cacheKey),
          fileName: path.basename(String(item?.fileName || "")),
          path: String(item?.path || ""),
          mimeType: String(item?.mimeType || ""),
          rank: Number.isFinite(Number(item?.rank)) ? Number(item.rank) : 999,
          updatedAt: Number.isFinite(Number(item?.updatedAt)) ? Number(item.updatedAt) : 0,
        }))
        .filter((item) => item.cacheKey && item.fileName && item.path && isAiSeqCachePathInsideDir(item.path, dir)),
    };
  } catch {
    return { version: 1, items: [] };
  }
};
const writeAiSeqGeneratedCacheIndex = (dir, index) => {
  const indexPath = path.join(dir, AI_SEQ_GENERATED_CACHE_INDEX);
  const safeItems = (Array.isArray(index?.items) ? index.items : [])
    .filter((item) => item?.cacheKey && item?.fileName && item?.path && isAiSeqCachePathInsideDir(item.path, dir))
    .map((item) => ({
      cacheKey: normalizeAiSeqGeneratedCacheKey(item.cacheKey),
      cacheGroup: normalizeAiSeqGeneratedCacheGroup(item.cacheGroup, item.cacheKey),
      fileName: path.basename(String(item.fileName || "")),
      path: String(item.path || ""),
      mimeType: String(item.mimeType || ""),
      rank: Number.isFinite(Number(item.rank)) ? Number(item.rank) : 999,
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : Date.now(),
    }));
  fs.writeFileSync(indexPath, JSON.stringify({ version: 1, items: safeItems }, null, 2), "utf8");
};
const pruneAiSeqGeneratedCacheIndex = (dir, index, maxFiles, cacheGroup) => {
  const limit = Math.max(0, Math.min(24, Math.floor(Number(maxFiles) || 0)));
  const group = normalizeAiSeqGeneratedCacheGroup(cacheGroup);
  if (!limit || !group || !Array.isArray(index?.items)) return index;
  const scopedItems = index.items.filter((item) => normalizeAiSeqGeneratedCacheGroup(item?.cacheGroup, item?.cacheKey) === group);
  if (scopedItems.length <= limit) return index;
  const sorted = [...scopedItems].sort((a, b) => {
    const rankA = Number.isFinite(Number(a?.rank)) ? Number(a.rank) : 999;
    const rankB = Number.isFinite(Number(b?.rank)) ? Number(b.rank) : 999;
    if (rankA !== rankB) return rankA - rankB;
    return (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0);
  });
  const keepKeys = new Set(sorted.slice(0, limit).map((item) => normalizeAiSeqGeneratedCacheKey(item.cacheKey)));
  for (const item of sorted.slice(limit)) {
    const filePath = String(item?.path || "");
    if (filePath && isAiSeqCachePathInsideDir(filePath, dir)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
  index.items = index.items.filter((item) => {
    const itemGroup = normalizeAiSeqGeneratedCacheGroup(item?.cacheGroup, item?.cacheKey);
    if (itemGroup !== group) return true;
    return keepKeys.has(normalizeAiSeqGeneratedCacheKey(item.cacheKey));
  });
  return index;
};
const miniMaxH3OutputPublisher = createMiniMaxH3OutputPublisher({
  readRuntimeConfig: () => miniMaxH3RuntimeLifecycle.readConfig(),
  getWarehouseDir: () => ensureAiSeqCacheDir(),
});

handleNovaFlowTempIpc("minimax-h3-output-publish", async (_evt, payload) => {
  try {
    const item = await miniMaxH3OutputPublisher.publish(payload);
    return { ok: true, item };
  } catch (error) {
    return { ok: false, error: String(error?.message || error || "publish_failed") };
  }
});

handleNovaFlowTempIpc("minimax-h3-output-list", async () => {
  try {
    const items = await miniMaxH3OutputPublisher.list();
    return { ok: true, items };
  } catch (error) {
    return { ok: false, items: [], error: String(error?.message || error || "list_failed") };
  }
});

const cleanupAiSeqCacheDir = (source) => {
  return safeRemoveDir(getNovaFlowTempCategoryDir("ai-sequence-cache"), {
    label: "ai-seq-cache",
    source,
    retries: 2,
    retryDelayMs: 250,
      logSuccess: source === "startup" || source === "before-quit"
  });
};
handleNovaFlowTempIpc("ai-seq-cache-clear", async (_evt, payload) => {
  try {
    const source = String(payload?.source || "manual").trim() || "manual";
    await cleanupAiSeqCacheDir(source);
    ensureAiSeqCacheDir();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "unknown error") };
  }
});
handleNovaFlowTempIpc("ai-seq-cache-temp-file", async (_evt, payload) => {
  try {
    const bytesIn = payload?.bytes;
    const inFileName = String(payload?.fileName || "output.mp4");
    const cacheKey = normalizeAiSeqGeneratedCacheKey(payload?.cacheKey);
    const cacheGroup = normalizeAiSeqGeneratedCacheGroup(payload?.cacheGroup, cacheKey);
    const cacheRank = Number.isFinite(Number(payload?.cacheRank)) ? Number(payload.cacheRank) : 999;
    const maxFiles = Math.max(0, Math.min(24, Math.floor(Number(payload?.maxFiles) || 0)));
    const safeBufFromBytes = (bytes) => {
      try {
        if (!bytes) return null;
        if (Buffer.isBuffer(bytes)) return bytes;
        if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
        if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (bytes && typeof bytes === "object" && bytes.type === "Buffer" && Array.isArray(bytes.data)) return Buffer.from(bytes.data);
        if (Array.isArray(bytes)) return Buffer.from(bytes);
        return null;
      } catch {
        return null;
      }
    };
    const buf = safeBufFromBytes(bytesIn);
    if (!buf || buf.length <= 0) return { ok: false, error: "bytes 无效" };
    const dir = ensureAiSeqCacheDir();
    const cacheIndex = cacheKey ? readAiSeqGeneratedCacheIndex(dir) : null;
    if (cacheKey && cacheIndex) {
      const existing = cacheIndex.items.find((item) => item.cacheKey === cacheKey);
      if (existing?.path && isAiSeqCachePathInsideDir(existing.path, dir) && fs.existsSync(existing.path)) {
        return { ok: true, path: existing.path, fileName: existing.fileName, mimeType: existing.mimeType || guessMimeFromPath(existing.path), reused: true };
      }
    }
    const ext = (String(inFileName).match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] || ".mp4").toLowerCase();
    const outPrefix = cacheKey ? (/^\.(png|jpe?g|webp)$/i.test(ext) ? "image" : "wan") : "ais";
    const outName = cacheKey
      ? createAiSeqWarehouseFileName(dir, outPrefix, ext)
      : `${outPrefix}_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
    const outPath = path.join(dir, outName);
    fs.writeFileSync(outPath, buf);
    if (cacheKey && cacheIndex) {
      cacheIndex.items = cacheIndex.items.filter((item) => item.cacheKey !== cacheKey);
      cacheIndex.items.push({
        cacheKey,
        cacheGroup,
        fileName: outName,
        path: outPath,
        mimeType: guessMimeFromPath(outPath),
        rank: cacheRank,
        updatedAt: Date.now(),
      });
      pruneAiSeqGeneratedCacheIndex(dir, cacheIndex, maxFiles, cacheGroup);
      writeAiSeqGeneratedCacheIndex(dir, cacheIndex);
      const kept = cacheIndex.items.find((item) => item.cacheKey === cacheKey);
      if (!kept?.path || !fs.existsSync(kept.path)) {
        return { ok: false, error: "generated output cache capped" };
      }
    }
    return { ok: true, path: outPath, fileName: outName, mimeType: guessMimeFromPath(outPath) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "unknown error") };
  }
});

handleNovaFlowTempIpc("ai-seq-cache-copy-from-path", async (_evt, payload) => {
  try {
    const inputPath = String(payload?.inputPath || "").trim();
    if (!inputPath || !fs.existsSync(inputPath)) return { ok: false, error: "inputPath 无效" };
    const dir = ensureAiSeqCacheDir();
    const ext = (String(inputPath).match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] || ".bin").toLowerCase();
    const outName = `ais_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`;
    const outPath = path.join(dir, outName);
    fs.copyFileSync(inputPath, outPath);
    return { ok: true, path: outPath, fileName: outName, mimeType: guessMimeFromPath(outPath) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "unknown error") };
  }
});

handleNovaFlowTempIpc("ai-seq-cache-reserve-output", async (_evt, payload) => {
  try {
    const format = String(payload?.format || "mp4").trim().toLowerCase();
    if (format !== "mp4" && format !== "webm") return { ok: false, error: "format 无效" };
    const requestedBaseName = path.basename(String(payload?.baseName || "novaflow_video_merge"));
    const baseName = requestedBaseName
      .replace(/\.[a-zA-Z0-9]{1,8}$/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^[_\.]+|[_\.]+$/g, "")
      .slice(0, 64) || "novaflow_video_merge";
    const dir = ensureAiSeqCacheDir();
    const outName = `${baseName}_${Date.now()}_${Math.random().toString(16).slice(2)}.${format}`;
    const outPath = path.join(dir, outName);
    return { ok: true, path: outPath, fileName: outName, mimeType: guessMimeFromPath(outPath) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "unknown error") };
  }
});

handleNovaFlowTempIpc("ai-seq-cache-release-output", async (_evt, payload) => {
  try {
    const outputPath = String(payload?.path || "").trim();
    if (!outputPath) return { ok: false, error: "path 无效" };
    const dir = ensureAiSeqCacheDir();
    if (!isAiSeqCachePathInsideDir(outputPath, dir)) return { ok: false, error: "path 非法" };
    const extension = path.extname(outputPath).toLowerCase();
    if (extension !== ".mp4" && extension !== ".webm") return { ok: false, error: "format 无效" };
    if (!fs.existsSync(outputPath)) return { ok: true, released: false };
    fs.unlinkSync(outputPath);
    return { ok: true, released: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "unknown error") };
  }
});

handleNovaFlowTempIpc("ai-seq-read-temp-file", async (_evt, payload) => {
  try {
    const p = String(payload?.path || "").trim();
    if (!p) return { ok: false, error: "path 无效" };
    const dir = ensureAiSeqCacheDir();
    if (!isPathInside(p, dir)) return { ok: false, error: "path 非法" };
    if (!fs.existsSync(p)) return { ok: false, error: "文件不存在" };
    const buf = fs.readFileSync(p);
    return { ok: true, bytes: buf, mimeType: guessMimeFromPath(p) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err || "unknown error") };
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (novaFlowAllowFinalQuit) return;
  event.preventDefault();
  requestNovaFlowGracefulQuit("before-quit");
});
