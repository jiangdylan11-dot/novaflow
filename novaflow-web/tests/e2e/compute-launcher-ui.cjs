// Offscreen renderer/preload exercise; no production registration or browser launch.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
app.commandLine.appendSwitch('disable-gpu');
let state = { version: require('../../worker/package.json').version, sharing: true, connected: true, pendingApproval: true,
  gpu: { name: 'NVIDIA GeForce RTX 4090 Laptop GPU', vramMb: 16384 }, comfy: { image: false },
  policy: { enabled: false, owner_enabled: false, sharing_enabled: false } };
const errors = [], actions = [];
for (const channel of ['state','website','logs','getLogs','freeMemory']) ipcMain.handle('compute:' + channel, async () => {
  actions.push(channel);
  if (channel === 'state') return state;
  if (channel === 'getLogs') return ['节点运行日志：等待后台审批'];
  if (channel === 'website') return;
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
  await run(`new Promise((resolve,reject)=>{const started=Date.now();const t=setInterval(()=>{if(document.querySelector('#status').textContent.includes('等待后台')){clearInterval(t);resolve();}else if(Date.now()-started>5000){clearInterval(t);reject(Error('UI did not initialize'));}},20)})`);
  assert.match(await run(`document.querySelector('#policy').textContent`), /等待管理员命名/);
  assert.equal(await run(`document.querySelectorAll('.tabs .tab').length`), 2);
  assert.equal(await run(`!!document.querySelector('#tab-settings, #registrationCode, #workerName, #connection, #websiteLink, #policyLink')`), false);
  assert.equal(await run(`document.querySelector('#launcher-actions').getBoundingClientRect().bottom <= document.querySelector('main').getBoundingClientRect().bottom`), true);
  if (process.env.NOVAFLOW_TEST_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR, 'compute-assistant-pending.png'), (await win.webContents.capturePage()).toPNG());
  }
  await run(`document.querySelector('[data-tab="logs"]').click()`);
  assert.equal(await run(`document.querySelector('#tab-logs').hidden`), false);
  assert.match(await run(`document.querySelector('#logs').textContent`), /节点运行日志/);
  await run(`document.querySelector('[data-tab="status"]').click();document.querySelector('#website').click()`);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert(actions.includes('website'));
  state = { ...state, pendingApproval: false, policy: { enabled: true, owner_enabled: true, sharing_enabled: false }, comfy: { image: true } };
  win.webContents.send('compute:state', state);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(await run(`document.querySelector('#status').textContent`), /节点已连接/);
  assert.match(await run(`document.querySelector('#policy').textContent`), /本人使用：已开通/);
  win.webContents.send('compute:state', { ...state, connected: false });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(await run(`document.querySelector('#status').textContent`), /连接中断/);
  assert.deepEqual(errors, []);
  if (process.env.NOVAFLOW_TEST_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR, 'compute-assistant.png'), (await win.webContents.capturePage()).toPNG());
  }
  console.log('compute launcher UI: no settings/codes/manual connection, pending approval and automatic state updates passed');
  win.destroy(); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
