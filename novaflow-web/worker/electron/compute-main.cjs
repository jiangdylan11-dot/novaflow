// Public compute appliance. The Foart editor is served only by foart.net.
const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const WEBSITE = 'https://foart.net/';
const CONTROL = 'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web';
app.setName('Foart 算力助手');
app.setAppUserModelId('com.novaflow.compute');
app.setPath('userData', path.join(app.getPath('appData'), 'Foart Compute'));
const dataDir = process.env.NOVAFLOW_COMPUTE_DATA_DIR || path.join(app.getPath('userData'), 'data');
const configFile = path.join(dataDir, 'compute.config.json');
fs.mkdirSync(dataDir, { recursive: true });
let win, tray, assistant, assistantFactory, operation = null, lastError = '', paused = false, quitting = false;
let queue = Promise.resolve();
const lines = [];
const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
const defaults = () => ({ workerName: 'foart-' + require('node:os').hostname(), modelsRoot: '', registrationCode: '' });
function readConfig() {
  try { return { ...defaults(), ...JSON.parse(fs.readFileSync(configFile, 'utf8')) }; }
  catch { return defaults(); }
}
function saveConfig(patch) {
  const config = readConfig();
  for (const name of ['workerName', 'modelsRoot', 'registrationCode']) {
    if (typeof patch?.[name] === 'string') config[name] = patch[name].trim();
  }
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  return config;
}
function state() {
  const value = assistant?.getState() || {};
  return { ...value, version: app.getVersion(), operation, lastError: lastError || value.lastError || '', paused };
}
function emit() { if (win && !win.isDestroyed()) win.webContents.send('compute:state', state()); }
function log(message, meta) {
  const line = new Date().toISOString() + ' ' + message + (meta ? ' ' + JSON.stringify(meta) : '');
  lines.push(line); if (lines.length > 400) lines.shift();
  if (win && !win.isDestroyed()) win.webContents.send('compute:log', line);
  try { fs.appendFileSync(path.join(dataDir, 'compute.log'), line + '\n'); } catch { /* status remains available */ }
}
const resource = name => app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, '../..', name);
async function connect() {
  if (assistant?.getState().sharing) return { ok: true, state: state() };
  const config = readConfig();
  if (!config.registrationCode && !fs.existsSync(path.join(dataDir, 'identity.json'))) {
    lastError = '首次接入请填写管理员提供的接入码'; emit();
    return { ok: false, error: lastError, state: state() };
  }
  operation = { message: '正在连接', percent: 0 }; lastError = ''; paused = false; emit();
  try {
    if (!assistant) {
      if (!assistantFactory) ({ createComputeAssistant: assistantFactory } = await import(pathToFileURL(path.join(__dirname, '../src/compute-assistant.mjs')).href));
      assistant = await assistantFactory({ ...config, controlUrl: CONTROL, dataDir,
        configPath: path.join(dataDir, 'identity.json'), workflowDir: path.join(__dirname, '../workflows'),
        rendererDir: resource('compute-renderer'), gatewayPort: 8791,
        logger: log, onProgress(percent, message) { operation = { percent, message }; emit(); } });
      assistant.onChange(emit);
    }
    await assistant.start();
    saveConfig({ registrationCode: '' });
    return { ok: true, state: state() };
  } catch (error) {
    lastError = String(error.message || error); log('连接失败', { error: lastError });
    await assistant?.stop().catch(() => {}); assistant = null;
    return { ok: false, error: lastError, state: state() };
  } finally { operation = null; emit(); }
}
async function stop() {
  paused = true; await assistant?.stop(); assistant = null; operation = null; emit();
  return { ok: true, state: state() };
}
async function quit() { quitting = true; await serial(stop).catch(() => {}); app.quit(); }
function show() {
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({ width: 680, height: 550, minWidth: 620, minHeight: 500,
      title: 'Foart 算力助手', backgroundColor: '#141414', autoHideMenuBar: true,
      titleBarStyle: 'hidden', titleBarOverlay: { color: '#242424', symbolColor: '#e5e7eb', height: 38 },
      icon: path.join(__dirname, 'assets/foart-brush.ico'),
      webPreferences: { preload: path.join(__dirname, 'compute-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    win.loadFile(path.join(__dirname, 'compute-ui.html'));
    win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
  }
  win.show(); win.focus();
}
// Only the packaged local control window can issue these operations.
function handle(name, fn) {
  ipcMain.handle('compute:' + name, async (event, payload) => {
    if (!win || event.sender !== win.webContents) return { ok: false, error: '无效的助手窗口' };
    try { const result = await fn(payload); return result?.state ? { ...result, state: state() } : result; }
    catch (error) { return { ok: false, error: String(error.message || error) }; }
  });
}
handle('state', state);
handle('config', () => { const { workerName, modelsRoot } = readConfig(); return { workerName, modelsRoot }; });
handle('save', patch => serial(async () => {
  await stop(); saveConfig(patch); return connect();
}));
handle('connect', () => serial(connect));
handle('pause', () => serial(stop));
handle('website', () => shell.openExternal(WEBSITE));
handle('logs', () => shell.openPath(dataDir));
handle('getLogs', () => lines.slice());
handle('freeMemory', async () => {
  if (!assistant?.getState().sharing) throw new Error('请先连接算力节点');
  const result = await assistant.promptAssistant.releaseRuntimes();
  if (!result.ok) throw new Error(result.errorCode === 'runtime-generation-busy' ? '正在执行任务，完成后再释放显存' : result.error || '释放显存失败');
  if (!result.released) throw new Error('生成服务未运行，无需释放');
  log('已释放显存');
  return { ok: true };
});
handle('models', async () => {
  const result = await dialog.showOpenDialog(win, { title: '选择 models 目录', properties: ['openDirectory'] });
  return result.canceled ? '' : result.filePaths[0];
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.whenReady().then(() => {
    show();
    tray = new Tray(path.join(__dirname, 'assets/foart-brush.ico'));
    tray.setToolTip('Foart 算力助手'); tray.on('click', show);
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '显示算力助手', click: show },
      { label: '打开 Foart 官网', click: () => shell.openExternal(WEBSITE) }, { label: '退出算力助手', click: quit }]));
    void serial(connect);
    // Retry temporary network/environment failures; an explicit pause wins.
    const retry = setInterval(() => {
      if (!paused && !operation && !assistant?.getState().sharing) void serial(connect);
    }, 30000);
    retry.unref();
  });
  app.on('before-quit', event => { if (!quitting) { event.preventDefault(); void quit(); } });
  app.on('window-all-closed', () => {});
}
