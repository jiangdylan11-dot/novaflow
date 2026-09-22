// NovaFlow Worker - Electron shell.
//
// A deliberately small window (spec 7: "Worker UI 保持极简"). It shows GPU,
// status, ComfyUI health, model readiness and the current task, and offers
// start / stop / logs / settings. It does NOT contain any of the NovaFlow
// editor UI - a compute node has no reason to ship a design tool.
//
// All real work happens in ../src/worker-core.mjs, the same module the
// headless entry point and the test suite drive.

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(app.getPath('userData'), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'worker.config.json');
const LOG_FILE = path.join(DATA_DIR, 'worker.log');
const MAX_LOG_LINES = 2000;

let win = null;
let worker = null;
let startPromise = null;
let createWorker = null;
const logLines = [];

fs.mkdirSync(DATA_DIR, { recursive: true });

/** The first path that exists, or the last so an error names something real. */
function firstExisting(paths) {
  for (const p of paths) { try { if (p && fs.existsSync(p)) return p; } catch (_) {} }
  return paths[paths.length - 1];
}

function log(message, meta) {
  const line = new Date().toISOString() + '  ' + message + (meta ? '  ' + JSON.stringify(meta) : '');
  logLines.push(line);
  if (logLines.length > MAX_LOG_LINES) logLines.splice(0, logLines.length - MAX_LOG_LINES);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* disk full or locked */ }
  if (win && !win.isDestroyed()) win.webContents.send('worker:log', line);
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {
      controlUrl: '',
      workerName: 'novaflow-' + require('node:os').hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40),
      registrationCode: '',
      comfyImageUrl: 'http://127.0.0.1:8188',
      comfyVideoUrl: 'http://127.0.0.1:8189',
      gatewayPort: 8790,
      publicEndpoint: '',
      modelsRoot: ''
    };
  }
}

function writeConfig(config) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

// worker-core is ESM; load it once, lazily, from CommonJS.
async function loadCore() {
  if (createWorker) return createWorker;
  const url = require('node:url').pathToFileURL(path.join(__dirname, '../src/worker-core.mjs')).href;
  ({ createWorker } = await import(url));
  return createWorker;
}

async function startWorker() {
  if (startPromise) return startPromise;
  if (worker) return worker.getState();
  startPromise = startWorkerAttempt();
  try { return await startPromise; }
  finally { startPromise = null; }
}

async function startWorkerAttempt() {
  const config = readConfig();
  if (!config.controlUrl) throw new Error('请先在设置里填写 NovaFlow 控制面地址');

  const factory = await loadCore();
  worker = factory({
    controlUrl: config.controlUrl,
    dataDir: DATA_DIR,
    workflowDir: path.join(__dirname, '../workflows'),
    // NovaFlow's own graph builders, shipped beside the app. A compute node
    // builds graphs with the product's real code, not an approximation.
    rendererDir: firstExisting([
      path.join(process.resourcesPath || '', 'worker-renderer'),
      path.join(__dirname, '../../worker-renderer'),
      path.join(__dirname, '../../../worker-renderer')
    ]),
    configPath: path.join(DATA_DIR, 'identity.json'),
    comfyImageUrl: config.comfyImageUrl || 'http://127.0.0.1:8188',
    comfyVideoUrl: config.comfyVideoUrl || 'http://127.0.0.1:8189',
    modelsRoot: config.modelsRoot || '',
    gatewayPort: Number(config.gatewayPort) || 8790,
    gatewayHost: '0.0.0.0',
    publicEndpoint: config.publicEndpoint || '',
    workerName: config.workerName,
    registrationCode: config.registrationCode || '',
    logger: log
  });

  worker.onChange((state) => {
    if (win && !win.isDestroyed()) win.webContents.send('worker:state', state);
  });

  let state;
  try {
    state = await worker.start();
  } catch (error) {
    // A failed instance must not short-circuit the next Start click. Recreate
    // it from the saved settings so a newly entered code is actually used.
    const failed = worker;
    worker = null;
    await failed.stop().catch(() => {});
    throw error;
  }
  // The registration code is single use; drop it once it has been spent so a
  // later restart does not fail trying to reuse it.
  if (config.registrationCode) writeConfig({ ...config, registrationCode: '' });
  return state;
}

async function stopWorker() {
  if (!worker) return null;
  await worker.stop();
  const state = worker.getState();
  worker = null;
  return state;
}

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 640,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: '#0b0b0b',
    title: 'NovaFlow Compute Node',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'ui.html'));
  win.on('closed', () => { win = null; });
}

ipcMain.handle('worker:getConfig', () => readConfig());
ipcMain.handle('worker:setConfig', (_e, patch) => writeConfig({ ...readConfig(), ...(patch || {}) }));
ipcMain.handle('worker:getState', () => (worker ? worker.getState() : null));
ipcMain.handle('worker:getLogs', () => logLines.slice(-400));
ipcMain.handle('worker:openLogFolder', () => shell.openPath(DATA_DIR));

ipcMain.handle('worker:start', async () => {
  try {
    return { ok: true, state: await startWorker() };
  } catch (error) {
    log('start failed: ' + String(error && error.message ? error.message : error));
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
});

ipcMain.handle('worker:stop', async () => {
  try {
    return { ok: true, state: await stopWorker() };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
});

ipcMain.handle('worker:pickModelsFolder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: '选择 ComfyUI models 目录',
    properties: ['openDirectory']
  });
  return result.canceled ? '' : result.filePaths[0];
});

app.whenReady().then(async () => {
  createWindow();
  // A node that was configured earlier should come back online by itself after
  // a reboot, without someone having to click Start.
  const config = readConfig();
  if (config.controlUrl && config.autoStart !== false) {
    try { await startWorker(); } catch (error) { log('auto start skipped: ' + String(error.message || error)); }
  }
});

app.on('window-all-closed', async () => {
  await stopWorker().catch(() => {});
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// A single instance: two workers sharing one identity and one gateway port
// would fight over both.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}
