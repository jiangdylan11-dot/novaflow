// NovaFlow local launcher: machine binding, private services and optional
// compute sharing. The editor itself runs in the browser.

const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const customDataDir = process.env?.NOVAFLOW_ASSISTANT_DATA_DIR;
// Keep the existing assistant identity when the visible product is renamed.
app.setPath('userData', customDataDir ? path.resolve(customDataDir, '..') : path.join(app.getPath('appData'), 'NovaFlow Worker'));
const DATA_DIR = customDataDir || path.join(app.getPath('userData'), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'worker.config.json');
const LOG_FILE = path.join(DATA_DIR, 'worker.log');
const MAX_LOG_LINES = 2000;

let win = null;
let quitting = false;
let tray = null;
let worker = null;
let configDirty = false;
let commands = Promise.resolve();
const operations = {};
let activeOperation = '';
const launcherState = () => ({ ...(worker?.getState() || {}), operations: { ...operations } });
function progress(percent, message) {
  if (!activeOperation) return;
  operations[activeOperation] = { ...operations[activeOperation], percent, message, status: 'running' };
  log('startup progress', { operation: activeOperation, percent, message,
    elapsedMs: Date.now() - operations[activeOperation].startedAt });
  if (win && !win.isDestroyed()) win.webContents.send('worker:state', launcherState());
}
const command = action => {
  const next = commands.then(action);
  commands = next.catch(() => {});
  return next;
};
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

async function ensureWorker() {
  if (worker && configDirty) {
    const s = worker.getState();
    if (!s.localRunning && !s.sharing && !s.draining && !s.currentTaskId) {
      await worker.stop(); worker = null;
    }
  }
  if (worker) return worker;
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
    logger: log,
    onProgress: progress
  });
  configDirty = false;

  worker.onChange((state) => {
    if (win && !win.isDestroyed()) win.webContents.send('worker:state', launcherState());
  });

  return worker;
}

async function startWorker() {
  if (worker?.getState().localRunning) return { ok: true, state: worker.getState() };
  progress(5, '正在验证本机授权');
  const licenseState = await (await getLicense()).state();
  if (licenseState.status !== 'licensed' || licenseState.locked) {
    return { ok: false, needsLicense: true, licenseState, state: worker?.getState() };
  }
  const instance = await ensureWorker();
  await instance.start();
  progress(95, '正在打开 NovaFlow 登录界面');
  await shell.openExternal(instance.openUrl);
  return { ok: true, state: instance.getState() };
}

async function stopWorker() {
  if (!worker) return null;
  const state = await worker.stopLocal();
  delete operations.local;
  return state;
}

async function discardFailedIdleWorker() {
  if (!worker) return;
  const s = worker.getState();
  if (!s.localRunning && !s.sharing && !s.draining && !s.currentTaskId) {
    const failed = worker; worker = null;
    await failed.stop().catch(() => {});
  }
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets/favicon.ico'));
  tray.setToolTip('NovaFlow');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开本地助手', click: showWindow },
    { type: 'separator' },
    { label: '退出本地助手', click: async () => {
      await command(async () => { await worker?.stop(); worker = null; }).catch(() => {});
      app.quit();
    } }
  ]));
  tray.on('click', showWindow);
}

function createWindow() {
  win = new BrowserWindow({
    width: 680,
    height: 550,
    minWidth: 620,
    minHeight: 500,
    backgroundColor: '#0b0b0b',
    title: 'NovaFlow',
    icon: path.join(__dirname, 'assets/favicon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#242424', symbolColor: '#e5e7eb', height: 38 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'ui.html'));
  win.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });
  win.on('closed', () => { win = null; });
}

ipcMain.handle('worker:getConfig', () => readConfig());
ipcMain.handle('worker:setConfig', (_e, patch) => { configDirty = true; return writeConfig({ ...readConfig(), ...(patch || {}) }); });
ipcMain.handle('worker:getState', launcherState);
ipcMain.handle('worker:getLogs', () => logLines.slice(-400));
ipcMain.handle('worker:openLogFolder', () => shell.openPath(DATA_DIR));
ipcMain.handle('worker:openWebsite', () => shell.openExternal('https://novaflow.jiangdylan11.workers.dev/'));
ipcMain.handle('worker:openLocal', async () => {
  try {
    if (!worker?.getState().localRunning) throw new Error('请先启动 NovaFlow');
    await shell.openExternal(worker.openUrl);
    return { ok: true };
  } catch (error) { return { ok: false, error: String(error.message || error) }; }
});

const respond = (action, kind) => {
  if (kind) {
    operations[kind] = { percent: 0, message: '等待前一项操作完成', status: 'queued', startedAt: Date.now() };
    if (win && !win.isDestroyed()) win.webContents.send('worker:state', launcherState());
  }
  return command(async () => {
  activeOperation = kind || '';
  try {
    if (kind) progress(2, '准备启动');
    const result = await action();
    if (kind) operations[kind] = { ...operations[kind], percent: result.ok ? 100 : operations[kind].percent,
      status: result.ok ? 'complete' : 'error', message: result.needsLicense ? '请先完成本机授权' : result.ok ? '启动完成' : result.error,
      finishedAt: Date.now() };
    return { ...result, state: launcherState() };
  }
  catch (error) {
    log('operation failed: ' + String(error.message || error));
    if (kind) operations[kind] = { ...operations[kind], status: 'error', message: String(error.message || error), finishedAt: Date.now() };
    await discardFailedIdleWorker();
    return { ok: false, error: String(error.message || error), state: launcherState() };
  } finally {
    activeOperation = '';
    if (win && !win.isDestroyed()) win.webContents.send('worker:state', launcherState());
  }
  });
};
ipcMain.handle('worker:start', () => respond(startWorker, 'local'));
ipcMain.handle('worker:stop', () => respond(async () => ({ ok: true, state: await stopWorker() })));
ipcMain.handle('worker:share', () => respond(async () => {
  const instance = await ensureWorker();
  await instance.startSharing({ registrationCode: readConfig().registrationCode || '' });
  const config = readConfig();
  if (config.registrationCode) writeConfig({ ...config, registrationCode: '' });
  return { ok: true, state: instance.getState() };
}, 'share'));
ipcMain.handle('worker:unshare', () => respond(async () => {
  const state = await worker?.stopSharing();
  delete operations.share;
  return { ok: true, state };
}));

// License actions update only authorization. They never resume startup.
const licenseAction = action => async (event, payload) => {
  if (!win || event.sender !== win.webContents) return { ok: false, error: 'Invalid assistant window' };
  try { return { ok: true, state: await action(await getLicense(), payload) }; }
  catch (error) { return { ok: false, error: String(error.message || error), state: error.state }; }
};
ipcMain.handle('worker:license', licenseAction(license => license.state()));
ipcMain.handle('worker:licenseImportText', licenseAction((license, text) => license.importLicense(text)));
ipcMain.handle('worker:licenseImportFile', async event => {
  if (!win || event.sender !== win.webContents) return { ok: false, error: 'Invalid assistant window' };
  try {
    const pick = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'NovaFlow License', extensions: ['nfl', 'json'] }] });
    if (pick.canceled || !pick.filePaths?.[0]) return { canceled: true };
    return { ok: true, state: await (await getLicense()).importLicense(await fs.promises.readFile(pick.filePaths[0], 'utf8')) };
  } catch (error) { return { ok: false, error: String(error.message || error), state: error.state }; }
});

ipcMain.handle('worker:pickModelsFolder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: '选择 ComfyUI models 目录',
    properties: ['openDirectory']
  });
  return result.canceled ? '' : result.filePaths[0];
});

app.whenReady().then(() => { createWindow(); createTray(); });
app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', async () => {
  await command(async () => { await worker?.stop(); worker = null; }).catch(() => {});
  app.quit();
});

app.on('activate', showWindow);

// A single instance: two workers sharing one identity and one gateway port
// would fight over both.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
}
