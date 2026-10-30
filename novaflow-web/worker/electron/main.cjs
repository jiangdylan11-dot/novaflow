// NovaFlow local launcher: machine binding, private services and optional
// compute sharing. The editor itself runs in the browser.

const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const IS_UI_TRIAL = require('../package.json').localUiTrial === true;
const PRODUCT_NAME = IS_UI_TRIAL ? 'Foart UI 本地试用版' : 'Foart';
app.setName(PRODUCT_NAME);
app.setAppUserModelId('com.novaflow.worker');
const customDataDir = process.env?.NOVAFLOW_ASSISTANT_DATA_DIR;
// Keep the existing assistant identity when the visible product is renamed.
app.setPath('userData', customDataDir ? path.resolve(customDataDir, '..') : path.join(app.getPath('appData'), IS_UI_TRIAL ? 'NovaFlow UI Trial' : 'NovaFlow Worker'));
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
function registrationSummary(state = {}) {
  let identity = null;
  try { identity = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'identity.json'), 'utf8')); } catch { /* No saved identity. */ }
  const saved = Boolean(identity?.workerId && identity?.workerSecret);
  const config = readConfig();
  const sameControl = saved && String(identity.controlUrl || '').replace(/\/+$/, '') === String(config.controlUrl || '').replace(/\/+$/, '');
  // Only expose public metadata; never send the saved secret to the renderer.
  return {
    status: state.sharing && sameControl ? 'verified' : saved ? (sameControl ? 'saved' : 'different-control') : 'new',
    workerId: saved ? String(identity.workerId) : '',
    workerName: saved ? String(identity.workerName || config.workerName || '') : '',
    savedAt: saved ? String(identity.savedAt || '') : ''
  };
}
const launcherState = () => {
  const state = worker?.getState() || {};
  // The titlebar shows the installed build's own version.
  return { ...state, version: app.getVersion(), registration: registrationSummary(state), operations: { ...operations } };
};
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
      gatewayPort: IS_UI_TRIAL ? 8897 : 8790,
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
    artKnowledge: config.artKnowledge || {
      enabled: true,
      baseUrl: String(config.controlUrl || '').replace(/\/novaflow-web\/?$/, '/novaflow-art-knowledge')
    },
    dataDir: DATA_DIR,
    workflowDir: path.join(__dirname, '../workflows'),
    webRoot: firstExisting([path.join(process.resourcesPath || '', 'web-dist'), path.join(__dirname, '../../web-dist')]),
    localPort: Number(config.localPort) || (IS_UI_TRIAL ? 4785 : 4784),
    runtimePolicy: IS_UI_TRIAL ? 'existing-only' : undefined,
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
    // Empty (and the retired 8189 older configs still hold) means the image runtime; see videoRuntimeUrl.
    comfyVideoUrl: config.comfyVideoUrl || '',
    modelsRoot: config.modelsRoot || '',
    gatewayPort: Number(config.gatewayPort) || (IS_UI_TRIAL ? 8897 : 8790),
    gatewayHost: '0.0.0.0',
    publicEndpoint: config.publicEndpoint || '',
    workerName: config.workerName,
    registrationCode: config.registrationCode || '',
    logger: log,
    clearRunFiles,
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
  progress(95, '正在打开 Foart 登录界面');
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

// Everything a run leaves on this machine - local and shared tasks' files and
// records, and ComfyUI's inputs, outputs and previews - is cleared on quit, and
// on launch in case the last run never quit. The page saves each result it
// fetches into the user's warehouse, and a folder that holds or sits inside a
// known warehouse folder is never touched.
function clearRunFiles() {
  // Trial tasks are isolated; shared runtime outputs belong to the stable assistant.
  if (IS_UI_TRIAL) return;
  const comfy = process.env?.NOVAFLOW_AI_RUNTIME_GENERATED_DIR || path.join(app.getPath('temp'), 'NovaFlow', 'AI-Runtime', 'runtime-generated');
  const warehouses = (readConfig().warehouseFolders || []).map(folder => path.resolve(folder));
  const within = (inner, outer) => { const rel = path.relative(outer, inner); return !rel.startsWith('..') && !path.isAbsolute(rel); };
  for (const dir of [path.join(DATA_DIR, 'tasks'), path.join(comfy, 'input'), path.join(comfy, 'output'), path.join(comfy, 'temp-root')]) {
    if (warehouses.some(folder => within(folder, dir) || within(dir, folder))) continue;
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      try { fs.rmSync(path.join(dir, name), { recursive: true, force: true, maxRetries: 2 }); }
      catch (error) { log('could not clear run file', { file: path.join(dir, name), error: String(error.message || error) }); }
    }
  }
  try { fs.rmSync(path.join(DATA_DIR, 'local-tasks.json'), { force: true }); } catch { /* recreated on start */ }
}

async function quitAssistant() {
  await command(async () => { await worker?.stop(); worker = null; }).catch(() => {});
  clearRunFiles();
  app.quit();
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets/foart-brush.ico'));
  tray.setToolTip(PRODUCT_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开本地助手', click: showWindow },
    { type: 'separator' },
    { label: '退出本地助手', click: quitAssistant }
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
    title: PRODUCT_NAME,
    icon: path.join(__dirname, 'assets/foart-brush.ico'),
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
ipcMain.handle('worker:openWebsite', () => shell.openExternal('https://foart.net/'));
ipcMain.handle('worker:openLocal', async () => {
  try {
    if (!worker?.getState().localRunning) throw new Error('请先启动 Foart');
    await shell.openExternal(worker.openUrl);
    return { ok: true };
  } catch (error) { return { ok: false, error: String(error.message || error) }; }
});
// 释放显存: the hand-over the prompt assistant makes before loading its own
// model - refused while anything draws or waits, then ComfyUI unloads it all.
ipcMain.handle('worker:freeMemory', async () => {
  try {
    if (!worker) throw new Error('请先启动 Foart');
    const result = await worker.promptAssistant.releaseRuntimes();
    if (!result.ok) throw new Error(result.errorCode === 'runtime-generation-busy' ? '正在生成，完成后再释放显存' : result.error);
    if (!result.released) throw new Error('生成服务未运行，无需释放');
    log('memory released on request');
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
    const pick = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Foart License', extensions: ['nfl', 'json'] }] });
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

async function handleWarehouseLink(argv = []) {
  const link = argv.find(value => typeof value === 'string' && value.startsWith('novaflow:'));
  if (!link) return;
  try {
    const { openWarehouseFolder } = require('./warehouse-folder.cjs');
    const config = readConfig();
    const candidates = [...(config.warehouseFolders || [])];
    for (const environment of ['AI-Runtime', 'AI-Runtime-H3']) {
      try {
        const runtime = JSON.parse((await fs.promises.readFile(path.join(process.env.ProgramData || 'C:/ProgramData', 'NovaFlow', environment, 'runtime.json'), 'utf8')).replace(/^\uFEFF/, ''));
        if (runtime.modelsPath) candidates.push(path.join(path.dirname(runtime.modelsPath), 'output'));
        if (runtime.outputPath) candidates.push(runtime.outputPath);
      } catch { /* A fresh machine may not have the AI environment yet. */ }
    }
    await openWarehouseFolder(link, {
      candidates,
      pickFolder: async () => {
        const result = await dialog.showOpenDialog(win, { title: '选择网页中已连接的仓库根目录（仅首次定位）', properties: ['openDirectory'] });
        return result.canceled ? '' : result.filePaths[0];
      },
      openPath: folder => shell.openPath(folder),
      remember: folder => {
        const latest = readConfig();
        writeConfig({ ...latest, warehouseFolders: [folder, ...(latest.warehouseFolders || []).filter(value => value !== folder)].slice(0, 20) });
      }
    });
  } catch (error) { dialog.showErrorBox('打开仓库文件夹失败', String(error.message || error)); }
}
app.whenReady().then(() => {
  if (app.isPackaged && !IS_UI_TRIAL) app.setAsDefaultProtocolClient('novaflow');
  createWindow(); createTray();
  void handleWarehouseLink(process.argv);
});
app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', quitAssistant);

app.on('activate', showWindow);

// A single instance: two workers sharing one identity and one gateway port
// would fight over both.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Only the instance that owns the worker may clear its files; a second
  // launch (e.g. a warehouse link) must not touch a running task's folder.
  clearRunFiles();
  app.on('second-instance', (_event, argv = []) => {
    if (argv.some(value => typeof value === 'string' && value.startsWith('novaflow:'))) void handleWarehouseLink(argv);
    else showWindow();
  });
}
