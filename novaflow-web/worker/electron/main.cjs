// NovaFlow local launcher: machine binding, private services and optional
// compute sharing. The editor itself runs in the browser.

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createLicenseGate } = require('./license-window.cjs');

const customDataDir = process.env?.NOVAFLOW_ASSISTANT_DATA_DIR;
if (customDataDir) app.setPath('userData', path.resolve(customDataDir, '..'));
const DATA_DIR = customDataDir || path.join(app.getPath('userData'), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'worker.config.json');
const LOG_FILE = path.join(DATA_DIR, 'worker.log');
const MAX_LOG_LINES = 2000;

let win = null;
let worker = null;
let startPromise = null;
let createWorker = null;
let localLicense = null;
async function getLicense() {
  if (!localLicense) {
    const url = require('node:url').pathToFileURL(path.join(__dirname, '../src/local-license.mjs')).href;
    const { createLocalLicense } = await import(url);
    localLicense = createLocalLicense(path.join(app.getPath('appData'), 'NovaFlow'));
  }
  return localLicense;
}
const licenseGate = createLicenseGate({ BrowserWindow, ipcMain, dialog, getParent: () => win, getLicense });
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
      controlUrl: 'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web',
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
  const url = require('node:url').pathToFileURL(path.join(__dirname, '../src/local-assistant.mjs')).href;
  ({ createLocalAssistant: createWorker } = await import(url));
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
  if (!await licenseGate.ensureAllowed()) throw Object.assign(new Error('已取消启动'), { canceled: true });
  const config = readConfig();

  const factory = await loadCore();
  worker = await factory({
    license: await getLicense(),
    controlUrl: config.controlUrl,
    dataDir: DATA_DIR,
    workflowDir: path.join(__dirname, '../workflows'),
    webRoot: firstExisting([path.join(process.resourcesPath || '', 'web-dist'), path.join(__dirname, '../../web-dist')]),
    localPort: Number(config.localPort) || 4784,
    licenseDataDir: path.join(app.getPath('appData'), 'NovaFlow'),
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
  return state;
}

async function stopWorker() {
  licenseGate.cancel();
  if (startPromise) await startPromise.catch(() => {});
  if (!worker) return null;
  await worker.stop();
  const state = worker.getState();
  worker = null;
  return state;
}

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 760,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: '#0b0b0b',
    title: 'NovaFlow 本地助手',
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
ipcMain.handle('worker:openWorkbench', async () => {
  try { if (!worker) throw new Error('请先启动本地服务'); await shell.openExternal(worker.openUrl); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e.message) }; }
});
ipcMain.handle('worker:share', async () => {
  try {
    if (!worker) throw new Error('请先启动本地服务');
    const state = await worker.startSharing();
    const config = readConfig();
    if (config.registrationCode) writeConfig({ ...config, registrationCode: '' });
    return { ok: true, state: worker.getState() };
  } catch (e) { return { ok: false, error: String(e.message), state: worker?.getState() }; }
});
ipcMain.handle('worker:unshare', async () => {
  try { await worker?.stopSharing(); return { ok: true, state: worker?.getState() }; }
  catch (e) { return { ok: false, error: String(e.message) }; }
});
ipcMain.handle('worker:license', async () => {
  try { return await licenseGate.inspect(); }
  catch (e) { return { ok: false, error: String(e.message) }; }
});

ipcMain.handle('worker:start', async () => {
  try {
    return { ok: true, state: await startWorker() };
  } catch (error) {
    log('start failed: ' + String(error && error.message ? error.message : error));
    return { ok: false, canceled: Boolean(error.canceled), error: String(error && error.message ? error.message : error) };
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
  // Auto-start only restores private local services. Sharing always requires
  // an explicit click, including after upgrades from the former Worker.
  const config = readConfig();
  if (config.autoStart === true) {
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
