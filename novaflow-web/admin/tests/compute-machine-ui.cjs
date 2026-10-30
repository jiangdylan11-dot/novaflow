// Real renderer and preload; IPC fixtures never contact production.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
app.commandLine.appendSwitch('disable-gpu');
const root = path.resolve(__dirname, '../license-admin-gui');
const owner = '11111111-1111-4111-8111-111111111111';
const guest = '22222222-2222-4222-8222-222222222222';
const third = '33333333-3333-4333-8333-333333333333';
const users = [{ id: owner, account: 'machine-owner', plan: 'trial', status: 'active' }, { id: guest, account: 'approved-guest', plan: 'pro', status: 'active' }, { id: third, account: 'xiaoming', display_name: '小明', plan: 'trial', status: 'active' }];
const worker = { id: 'node-one', owner_id: null, worker_name: 'DESKTOP-PENDING', name_managed: false, status: 'idle', tier: 'standard',
  enabled: false, owner_enabled: false, sharing_enabled: false, sharing_scope: 'pool', allowed_user_ids: [], transport: 'tunnel', last_heartbeat: new Date().toISOString() };
const writes = [], errors = [], legacyCalls = [], connectionWrites = [];
let connectionTests = 0;
let failSave = false;
const result = (records) => ({ ok: true, result: { source: 'supabase', status: 'connected', records } });
for (const channel of new Set([...fs.readFileSync(path.join(root, 'preload.js'), 'utf8').matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1]))) {
  ipcMain.handle(channel, async (_event, payload) => {
    if (['admin-default-paths', 'admin-status', 'admin-online-query', 'admin-read-public-key', 'admin-read-private-key', 'admin-issue-license', 'admin-verify-license'].includes(channel)) legacyCalls.push(channel);
    if (channel.includes('worker_codes')) legacyCalls.push(channel);
    if (channel === 'admin-default-paths') return {};
    if (channel === 'admin-status') return { ok: true, status: {} };
    if (channel === 'admin-online-config') return { ok: true, config: { supabaseUrl: 'https://fixture.supabase.co', hasSecretKey: true, secretPreview: 'fixture' } };
    if (channel === 'admin-online-save-config') { connectionWrites.push(payload); return { ok: true, config: { hasSecretKey: true, secretPreview: 'fixture' } }; }
    if (channel === 'admin-online-test') { connectionTests++; return { ok: true, result: { ok: true } }; }
    if (channel === 'admin:data:users:list') return result(users);
    if (channel === 'admin:data:gpu_workers:list') return result([{ ...worker }]);
    if (channel === 'admin:data:gpu_workers:set-access-policy') {
      if (failSave) return { ok: true, result: { status: 'error', error: 'fixture migration required' } };
      writes.push(payload); Object.assign(worker, payload, { name_managed: true }); return { ok: true, result: { ok: true, record: worker } };
    }
    if (channel === 'admin:data:gpu_workers:set-status') { worker.enabled = payload.status === 'idle'; return { ok: true, result: { ok: true } }; }
    return result([]);
  });
}
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  await win.loadFile(path.join(root, 'index.html'));
  const run = (code) => win.webContents.executeJavaScript(code);
  const wait = (condition) => run(`new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(${condition}){clearInterval(timer);resolve();}else if(Date.now()-started>10000){clearInterval(timer);reject(Error(${JSON.stringify(condition)}));}},25);})`);
  await wait(`$('onlineConfigStatus')?.textContent.includes('已保存')`);
  assert.equal(await run(`!!document.querySelector('[data-module="licenses"], #module-licenses, #dashboardLicensesCount')`), false);
  await run(`showModule('licenses')`);
  assert.equal(await run(`$('module-dashboard').classList.contains('active')`), true);
  await run(`document.querySelector('[data-drawer-open="backendConnectionDrawer"]').click()`);
  assert.equal(await run(`$('backendConnectionDrawer').hidden`), false);
  await run(`$('onlineSecretKey').value='fixture-only-not-a-real-key';$('saveOnlineConfig').click()`);
  await wait(`$('onlineSecretKey').value === ''`);
  assert.equal(connectionWrites.length, 1);
  assert.equal(connectionWrites[0].supabaseUrl, 'https://fixture.supabase.co');
  await run(`$('testOnlineConfig').click()`);
  await wait(`$('onlineConfigStatus').textContent === '连接正常'`);
  assert.equal(connectionTests, 1);
  await run(`$('backendConnectionDrawer').querySelector('[data-drawer-close]').click()`);
  await run(`showModule('compute')`);
  await wait(`document.querySelector('#computeWorkersTableBody')?.textContent.includes('待审批')`);
  assert.equal(await run(`document.querySelector('#computeWorkersTableBody').textContent.includes('待分配账号')`), true);
  assert.equal(await run(`!!document.querySelector('#computeMintDrawer, #computeCodesTableBody, #computeMintCode')`), false);
  assert.equal(await run(`document.querySelectorAll('.workerTable th').length`), 11);
  assert.equal(await run(`document.querySelectorAll('#computeWorkersTableBody tr:first-child td').length`), 11);
  assert.equal(await run(`[...document.querySelectorAll('#computeWorkersTableBody button')].find(el=>el.textContent==='删除').disabled`), false);
  await run(`[...document.querySelectorAll('#computeWorkersTableBody button')].find(el=>el.textContent==='分配并审批').click()`);
  await wait(`!!document.querySelector('#computeMachineSettings')`);
  assert.equal(await run(`$('computeMachineOwner').value`), '');
  assert.equal(await run(`$('computeMachineEnabled').checked`), false);
  assert.equal(await run(`$('computeMachineOwnerEnabled').checked`), false);
  assert.match(await run(`$('computeMachinePolicySummary').textContent`), /不会执行任务/);
  await run(`$('computeMachineName').value='  合作方测试机器  ';$('computeMachineOwner').value='${owner}';$('computeMachineEnabled').click();$('computeMachineOwnerEnabled').click();$('computeMachineSettings').requestSubmit()`);
  await wait(`!document.querySelector('#computeMachineSettings')`);
  await wait(`document.querySelector('#computeWorkersTableBody').textContent.includes('本人可用')`);
  assert.equal(writes.length, 1); assert.equal(writes[0].worker_name, '合作方测试机器'); assert.equal(writes[0].owner_id, owner);
  assert.equal(writes[0].enabled, true); assert.equal(writes[0].owner_enabled, true); assert.equal(writes[0].sharing_enabled, false);
  assert.equal(await run(`document.querySelector('#computeWorkersTableBody').textContent.includes('合作方测试机器')`), true);
  assert.equal(await run(`[...document.querySelectorAll('#computeWorkersTableBody button')].find(el=>el.textContent==='删除').disabled`), true);
  await run(`[...document.querySelectorAll('#computeWorkersTableBody button')].find(el=>el.textContent==='机器设置').click()`);
  assert.equal(await run(`$('computeMachineSharing').checked`), false);
  await run(`$('computeMachineSharing').click();$('computeMachineSharingScope').value='selected';$('computeMachineSharingScope').dispatchEvent(new Event('change'));$('computeMachineSettings').requestSubmit()`);
  assert.match(await run(`$('computeMachineSaveStatus').textContent`), /至少选择/);
  assert.equal(writes.length, 1);
  await run(`$('computeMachineUsersSelectAll').click()`);
  assert.equal(await run(`$('computeMachineUsersSelectAll').checked`), true);
  assert.match(await run(`$('computeMachineUsersCount').textContent`), /已选 3 \/ 3 人/);
  await run(`$('computeMachineUserSearch').value='OWNER';$('computeMachineUserSearch').dispatchEvent(new Event('input'))`);
  assert.equal(await run(`$('computeMachineAllowedUsers').querySelector('input[value="${guest}"]').parentElement.hidden`), true);
  await run(`$('computeMachineUsersSelectAll').click()`);
  assert.match(await run(`$('computeMachineUsersCount').textContent`), /已选 2 \/ 3 人.*匹配 1 人/);
  await run(`$('computeMachineUserSearch').value='nobody-matches';$('computeMachineUserSearch').dispatchEvent(new Event('input'))`);
  assert.equal(await run(`$('computeMachineUsersSelectAll').disabled`), true);
  assert.match(await run(`$('computeMachineUsersCount').textContent`), /已选 2 \/ 3 人.*匹配 0 人/);
  await run(`$('computeMachineUserSearch').value='';$('computeMachineUserSearch').dispatchEvent(new Event('input'))`);
  assert.equal(await run(`$('computeMachineUsersSelectAll').indeterminate`), true);
  await run(`$('computeMachineUsersSelectAll').click();$('computeMachineUsersSelectAll').click()`);
  assert.match(await run(`$('computeMachineUsersCount').textContent`), /已选 0 \/ 3 人/);
  await run(`$('computeMachineUserSearch').value='小明';$('computeMachineUserSearch').dispatchEvent(new Event('input'));$('computeMachineUsersSelectAll').click()`);
  assert.equal(await run(`$('computeMachineAllowedUsers').querySelector('input[value="${third}"]').checked`), true);
  await run(`$('computeMachineUsersSelectAll').click();$('computeMachineUserSearch').value='APPROVED';$('computeMachineUserSearch').dispatchEvent(new Event('input'));$('computeMachineUsersSelectAll').click();$('computeMachineUserSearch').value='owner';$('computeMachineUserSearch').dispatchEvent(new Event('input'));$('computeMachineSettings').requestSubmit()`);
  await wait(`!document.querySelector('#computeMachineSettings')`);
  assert.equal(writes.length, 2); assert.equal(writes[1].sharing_enabled, true); assert.equal(writes[1].owner_enabled, true); assert.deepEqual(writes[1].allowed_user_ids, [guest]);
  await wait(`document.querySelector('#computeWorkersTableBody').textContent.includes('指定用户 1 人')`);
  failSave = true;
  await run(`[...document.querySelectorAll('#computeWorkersTableBody button')].find(el=>el.textContent==='机器设置').click();$('computeMachineSettings').requestSubmit()`);
  assert.equal(await run(`$('computeMachineAllowedUsers').querySelector('input[value="${guest}"]').checked`), true);
  assert.equal(await run(`$('computeMachineUsersSelectAll').indeterminate`), true);
  await wait(`$('computeMachineSaveStatus')?.textContent.includes('fixture migration required')`);
  assert.equal(await run(`$('computeMachineSettings').querySelector('button[type=submit]').disabled`), false);
  if (process.env.NOVAFLOW_TEST_SCREENSHOT_DIR) {
    await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await new Promise(resolve => { win.webContents.once('paint', resolve); win.webContents.invalidate(); });
    fs.mkdirSync(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR, 'compute-machine-settings.png'), (await win.webContents.capturePage()).toPNG());
  }
  await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await run(`document.querySelector('#computeMachineSettings')`), null);
  assert.deepEqual(errors, []);
  assert.deepEqual(legacyCalls, []);
  fs.writeFileSync(path.join(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR || app.getPath('temp'), 'compute-machine-ui-receipt.json'), JSON.stringify({ passed: true, writes, errors, legacyCalls, connectionTests }, null, 2));
  console.log('compute machine UI passed: pending approval, admin naming, private owner, selected sharing, username search, filtered select-all, selection persistence, backend connection and no registration-code calls');
  win.destroy(); app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
