const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const worker = process.env.FOART_WORKER_ROOT || path.resolve(__dirname, '../../worker');
  const preload = path.join(worker, 'electron/preload.cjs');
  const state = { version: JSON.parse(fs.readFileSync(path.join(worker, 'package.json'), 'utf8')).version, status: 'offline', registration: { status: 'new' }, hardware: {}, gpu: { detected: false } };
  for (const name of new Set([...fs.readFileSync(preload, 'utf8').matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(m => m[1]))) {
    ipcMain.handle(name, () => name === 'worker:getState' ? state : name === 'worker:getConfig' ? { controlUrl: 'https://fixture.invalid' } : name === 'worker:getLogs' ? [] : { ok: true });
  }
  const win = new BrowserWindow({ show: false, width: 760, height: 800, webPreferences: { preload, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(worker, 'electron/ui.html'));
  for (const name of ['status', 'settings', 'logs']) {
    const result = await win.webContents.executeJavaScript(`(()=>{document.querySelector('.tabs [data-tab="${name}"]').click();return [...document.querySelectorAll('.tabs > .tab')].map(n=>{const s=getComputedStyle(n);return {name:n.dataset.tab,bg:s.backgroundColor,border:s.borderBottomWidth,color:s.color,active:n.classList.contains('active')}})})()`);
    assert.equal(result.length, 3);
    assert.equal(result.find(n => n.active).name, name);
    for (const tab of result) {
      assert.equal(tab.bg, 'rgba(0, 0, 0, 0)', tab.name + ' must remain a transparent navigation tab');
      assert.equal(tab.border, '0px', tab.name + ' must have no stroke');
      assert.equal(tab.color, tab.active ? 'rgb(241, 241, 241)' : 'rgb(167, 167, 167)');
    }
  }
  if (process.env.FOART_TAB_PREVIEW) fs.writeFileSync(process.env.FOART_TAB_PREVIEW, (await win.webContents.capturePage()).toPNG());
  console.log('PASS: actual launcher status/settings/log tabs stay transparent and borderless; selected label changes without filled blocks');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
