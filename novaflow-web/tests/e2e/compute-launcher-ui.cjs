// Offscreen renderer/preload exercise; no production registration or browser launch.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
app.commandLine.appendSwitch('disable-gpu');
let state = { version: require('../../worker/package.json').version, sharing: true, gpu: { name: 'NVIDIA GeForce RTX 4090 Laptop GPU', vramMb: 16384 }, comfy: { image: true }, policy: { enabled: true, owner_enabled: true, sharing_enabled: false } };
const errors = [], actions = [];
for (const channel of ['state','config','save','connect','pause','website','models','logs','getLogs','freeMemory']) ipcMain.handle('compute:' + channel, async (_e, value) => {
  actions.push(channel);
  if (channel === 'state') return state;
  if (channel === 'config') return { workerName: '合作方机器', modelsRoot: 'C:/models' };
  if (channel === 'getLogs') return ['节点运行日志：已连接'];
  if (channel === 'website') return;
  if (channel === 'pause') state = { ...state, sharing: false, paused: true };
  if (channel === 'connect') state = { ...state, sharing: true, paused: false };
  if (channel === 'save') return { ok: false, error: '测试接入失败', state: { ...state, lastError: '测试接入失败' } };
  return { ok: true, state };
});
app.whenReady().then(async () => {
  const directory = path.resolve(__dirname, '../../worker/electron');
  const win = new BrowserWindow({ show: false, width: 680, height: 550, titleBarStyle: 'hidden', titleBarOverlay: { color: '#242424', symbolColor: '#e5e7eb', height: 38 }, webPreferences: {
    preload: path.join(directory, 'compute-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
    offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  await win.loadFile(path.join(directory, 'compute-ui.html'));
  const run = code => win.webContents.executeJavaScript(code);
  await run(`new Promise(resolve=>{const t=setInterval(()=>{if(document.querySelector('#workerName').value){clearInterval(t);resolve();}},20)})`);
  assert.match(await run(`document.querySelector('#policy').textContent`), /本人使用：已开通.*对外分享：未开通/);
  assert.equal(await run(`document.querySelector('#tab-settings').hidden`), true);
  assert.equal(await run(`document.querySelectorAll('.tabs .tab').length`), 3);
  assert.equal(await run(`document.querySelector('#launcher-actions').getBoundingClientRect().bottom <= document.querySelector('main').getBoundingClientRect().bottom`), true);
  if (process.env.NOVAFLOW_TEST_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR, 'compute-assistant-status.png'), (await win.webContents.capturePage()).toPNG());
  }
  await run(`document.querySelector('[data-tab="logs"]').click()`);
  assert.equal(await run(`document.querySelector('#tab-logs').hidden`), false);
  assert.match(await run(`document.querySelector('#logs').textContent`), /节点运行日志/);
  await run(`document.querySelector('[data-tab="status"]').click()`);
  win.webContents.send('compute:state', { ...state, connected: false });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(await run(`document.querySelector('#status').textContent`), /连接中断/);
  win.webContents.send('compute:state', { ...state, connected: true });
  await run(`document.querySelector('#website').click();document.querySelector('#connection').click()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(await run(`document.querySelector('#status').textContent`), /已暂停/);
  await run(`document.querySelector('[data-tab="settings"]').click();document.querySelector('#save').click()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await run(`document.querySelector('#error').textContent`), '测试接入失败');
  assert.equal(await run(`document.querySelector('#save').disabled`), false);
  assert(actions.includes('website')); assert(actions.includes('pause'));
  assert.deepEqual(errors, []);
  if (process.env.NOVAFLOW_TEST_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR, 'compute-assistant.png'), (await win.webContents.capturePage()).toPNG());
  }
  console.log('compute launcher UI: private policy display, website, pause and failed connection recovery passed');
  win.destroy(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
