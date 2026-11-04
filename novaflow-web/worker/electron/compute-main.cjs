// Public compute appliance. The Foart editor is served only by foart.net.
const { app, BrowserWindow, ipcMain, shell, Tray, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { cpuSnapshot, cpuPercent, gpuRows, thermalZoneCelsius } = require('../src/resource-telemetry.cjs');
const WEBSITE = 'https://foart.net/';
const CONTROL = 'https://cjakoblszlmbmotchzva.supabase.co/functions/v1/novaflow-web';
app.setName('Foart');
app.setAppUserModelId('com.novaflow.compute');
app.setPath('userData', path.join(app.getPath('appData'), 'Foart Compute'));
const dataDir = process.env.NOVAFLOW_COMPUTE_DATA_DIR || path.join(app.getPath('userData'), 'data');
const configFile = path.join(dataDir, 'compute.config.json');
fs.mkdirSync(dataDir, { recursive: true });
let win, tray, assistant, assistantFactory, operation = null, lastError = '', paused = false, quitting = false;
let queue = Promise.resolve();
let resources = { ram: null, vram: null, cpu: null, gpu: null };
let previousCpu = null;
let cpuTemperature = null;
let samplingResources = false;
function sampleResources() {
  if (samplingResources) return;
  samplingResources = true;
  const total = os.totalmem(), free = os.freemem();
  resources.ram = total > 0 ? { used: total - free, total } : null;
  let currentCpu = null;
  try { currentCpu = cpuSnapshot(os.cpus()); } catch { /* CPU telemetry unavailable */ }
  const percent = cpuPercent(previousCpu, currentCpu);
  previousCpu = currentCpu;
  // This performance counter needs no administrator rights, unlike MSAcpi_ThermalZoneTemperature.
  if (process.platform === 'win32') execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation).HighPrecisionTemperature'], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
    cpuTemperature = error ? null : thermalZoneCelsius(stdout);
    if (resources.cpu) resources.cpu.temperature = cpuTemperature;
    emit();
  });
  resources.cpu = { percent, temperature: cpuTemperature };
  execFile('nvidia-smi', ['--query-gpu=name,memory.used,memory.total,temperature.gpu,utilization.gpu', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
    const rows = error ? [] : gpuRows(stdout);
    const name = assistant?.getState().gpu?.name;
    resources.vram = rows.find(row => row.name === name) || (rows.length === 1 ? rows[0] : null);
    resources.gpu = resources.vram ? {percent: resources.vram.percent, temperature: resources.vram.temperature} : null;
    samplingResources = false; emit();
  });
}
const lines = [];
const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
const defaults = () => ({ workerName: ('foart-' + require('node:os').hostname()).slice(0, 80), modelsRoot: '' });
function readConfig() {
  try { return { ...defaults(), ...JSON.parse(fs.readFileSync(configFile, 'utf8')) }; }
  catch { return defaults(); }
}
function state() {
  const value = assistant?.getState() || {};
  return { ...value, version: app.getVersion(), resources, operation, lastError: lastError || value.lastError || '', paused };
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
  operation = { message: '正在连接', percent: 0 }; lastError = ''; paused = false; emit();
  try {
    if (!assistant) {
      if (!assistantFactory) ({ createComputeAssistant: assistantFactory } = await import(pathToFileURL(path.join(__dirname, '../src/compute-assistant.mjs')).href));
      const { QWEN_ROTATION_RELEASE_POLICY } = await import(pathToFileURL(path.join(__dirname, '../src/qwen-rotation-release-policy.mjs')).href);
      assistant = await assistantFactory({ modelsRoot: config.modelsRoot || '', workerName: defaults().workerName, controlUrl: CONTROL, dataDir,
        configPath: path.join(dataDir, 'identity.json'), workflowDir: path.join(__dirname, '../workflows'),
        rendererDir: resource('compute-renderer'), gatewayPort: 8791,
        // The 286 candidate enables only the bounded text bridge; media stays gated.
        enableQwenBusinessBridge: true, qwenBusinessTextOnly: true,
        qwenImageEditEnabled: true,
        qwenRotationVerificationEnabled: QWEN_ROTATION_RELEASE_POLICY.verificationEnabled === true,
        qwenRotationCandidateEnabled: QWEN_ROTATION_RELEASE_POLICY.verificationEnabled === true && QWEN_ROTATION_RELEASE_POLICY.candidateEnabled === true,
        qwenPlanVerificationEnabled: QWEN_ROTATION_RELEASE_POLICY.planVerificationEnabled === true,
        qwenPlanEnabled: QWEN_ROTATION_RELEASE_POLICY.planVerificationEnabled === true && QWEN_ROTATION_RELEASE_POLICY.planEnabled === true,
        logger: log, onProgress(percent, message) { operation = { percent, message }; emit(); } });
      assistant.onChange(emit);
    }
    await assistant.start();
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
    win = new BrowserWindow({ width: 560, height: 480, resizable: false, maximizable: false, fullscreenable: false,
      title: 'Foart', backgroundColor: '#141414', autoHideMenuBar: true,
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
handle('website', () => shell.openExternal(WEBSITE));
handle('logs', () => shell.openPath(dataDir));
handle('getLogs', () => lines.slice());
handle('freeMemory', async () => {
  if (!assistant?.getState().sharing) throw new Error('请先连接算力节点');
  if (typeof assistant.worker?.releaseIdleModels !== 'function') throw new Error('当前运行环境不支持安全释放，请更新后重试');
  const result = await assistant.worker.releaseIdleModels();
  if (!result.ok) {
    const reasons = {'runtime-unavailable':'生成服务未运行或不可用', 'runtime-busy':'正在执行任务，请完成后重试', 'queue-unknown':'无法确认任务队列，请稍后重试', 'release-unknown':'释放结果未知，请稍后查看资源占用'};
    throw new Error((result.requested ? '部分服务已收到释放请求；' : '') + (reasons[result.code] || '暂时无法安全释放模型资源'));
  }
  log('已请求生成服务释放模型资源');
  sampleResources();
  return { ok: true };
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.whenReady().then(() => {
    show();
    sampleResources();
    const resourceTimer = setInterval(sampleResources, 5000);
    resourceTimer.unref();
    tray = new Tray(path.join(__dirname, 'assets/foart-brush.ico'));
    tray.setToolTip('Foart'); tray.on('click', show);
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '显示 Foart', click: show },
      { label: '打开 Foart 官网', click: () => shell.openExternal(WEBSITE) }, { label: '退出 Foart', click: quit }]));
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
