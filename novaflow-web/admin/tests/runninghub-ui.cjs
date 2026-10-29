// Run with Electron. Uses the real page/preload and isolated fixture IPC; no real keys or account writes.
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const rh = require("../license-admin-gui/runninghub-provider.cjs");
app.commandLine.appendSwitch("disable-gpu");
let config = rh.readConfig(() => "");
let status = rh.publicStatus(config);
let checks = 0;
let saves = 0;
let failCheck = false;
const errors = [];
const uiRoot = process.env.NOVAFLOW_ADMIN_UI_ROOT || path.resolve(__dirname, "../license-admin-gui");
const preload = path.join(uiRoot, "preload.js");
for (const channel of new Set([...fs.readFileSync(preload, "utf8").matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1]))) {
  ipcMain.handle(channel, async (_event, payload) => {
    if (channel === "admin-default-paths") return {};
    if (channel === "admin-status") return { ok: true, status: {} };
    if (channel === "admin-online-config") return { ok: true, config: {} };
    if (channel === "admin:provider:runninghub:status") return { ok: true, result: status };
    if (channel === "admin:data:feature_credits:get") return { ok: true, result: {
      config: {}, domesticBalance: { remainMoney: status.connected ? 0 : 9.5773, currency: "USD", checkedAt: "2026-10-28T10:34:10.400Z" },
      balanceError: status.status === "error" ? status.error : null, lowBalance: { stale: !status.connected }
    } };
    if (channel === "admin:provider:runninghub:check") {
      checks++;
      status = failCheck
        ? { ...rh.publicStatus(config), checked: true, status: "error", error: "RunningHub：当前 Key 未找到对应账户（APIKEY_USER_NOT_FOUND）" }
        : { ...rh.publicStatus(config), connected: true, checked: true, status: "connected", balance: { supported: true, money: 0, currency: "USD", text: "0 USD · 100 RH币" }, currentTaskCounts: 0 };
      return { ok: true, result: status };
    }
    if (channel === "admin:provider:runtime-config:set") {
      assert.equal(payload.providerKey, "runninghub");
      saves++;
      const parsed = rh.parseConfig(payload);
      config = { ...parsed, apiKey: parsed.clearApiKey ? "" : parsed.apiKey || config.apiKey };
      status = rh.publicStatus(config);
      return { ok: true, result: { ok: true } };
    }
    return { ok: true, result: { source: "mock", status: "mock", records: [] } };
  });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1080, webPreferences: { preload, contextIsolation: true, nodeIntegration: false } });
  win.webContents.on("console-message", (_e, level, message) => { if (level >= 3) errors.push(message); });
  await win.loadFile(path.join(uiRoot, "index.html"));
  const run = (code) => win.webContents.executeJavaScript(code);
  await run(`window.confirm = () => true; window.alert = (msg) => { throw new Error(msg); };
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const timer = setInterval(() => {
        if (document.querySelector('#aiProvidersTableBody').textContent.includes('RunningHub')) { clearInterval(timer); resolve(); }
        else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('admin page did not initialize')); }
      }, 50);
    })`);
  assert.equal(checks, 0, "page load must not call RunningHub");
  await run(`document.querySelector('[data-module="ai-services"]').click();
    document.getElementById('runninghubRuntimeApiKey').value = 'fixture-only-key';
    document.getElementById('runninghubRuntimeLlmModel').value = 'fixture-model';
    saveProviderRuntimeConfig('runninghub')`);
  assert.equal(saves, 1);
  assert.equal(checks, 1, "save must perform exactly one read-only check");
  assert.equal(config.llmModel, "fixture-model");
  assert.equal(await run(`document.getElementById('runninghubRuntimeApiKey').value`), "");
  assert.equal(await run(`document.getElementById('runninghubRuntimeGoogleImageEndpoint')`), null);
  assert.equal(await run(`document.getElementById('comfyRuntimeApiKey')`), null);
  assert.equal(await run(`document.getElementById('grokRuntimeApiKey')`), null);
  assert.equal(await run(`document.getElementById('saveComfyProviderBudget')`), null);
  assert.equal(await run(`document.getElementById('saveGrokRuntimeConfig')`), null);
  assert.equal(await run(`document.querySelector('#aiProvidersTableBody .badge').textContent`), "已连接");
  assert(!(await run(`document.getElementById('aiProvidersTableBody').textContent`)).includes("Grok"));
  assert(!(await run(`document.getElementById('module-ai-services').innerText`)).includes("保存 ComfyUI"));
  assert((await run(`document.getElementById('runninghubProviderHealthRows').textContent`)).includes("账户连接正常"));
  assert(!(await run(`document.body.innerText`)).includes("fixture-only-key"));
  failCheck = true;
  await run(`showModule('dashboard'); refreshDomesticBalance()`);
  assert.equal(await run(`$('dashboardRhDomesticBalance').textContent`), "—");
  assert.match(await run(`$('dashboardRhDomesticMeta').textContent`), /APIKEY_USER_NOT_FOUND/);
  assert.match(await run(`$('toast').textContent`), /APIKEY_USER_NOT_FOUND/);
  await run(`loadAdminData()`);
  assert.equal(await run(`$('dashboardRhDomesticBalance').textContent`), "—", "ordinary refresh must not restore the stale balance after a failed check");
  failCheck = false;
  await run(`rhRefreshLockedUntil = 0; refreshDomesticBalance()`);
  assert.equal(await run(`$('dashboardRhDomesticBalance').textContent`), "0.00USD");
  assert.equal(await run(`$('toast').textContent`), "已更新国内站余额");
  await run(`renderDashboardRhCard({state:'ready', domesticBalance:{remainMoney:null}})`);
  assert.equal(await run(`$('dashboardRhDomesticBalance').textContent`), "—", "missing balance must never become zero dollars");
  await run(`showModule('ai-services')`);
  for (const width of [1440, 1080]) {
    win.setSize(width, 1080);
    const layout = await run(`new Promise(resolve => requestAnimationFrame(() => resolve({
      overflow: document.documentElement.scrollWidth > innerWidth,
      fields: [...document.querySelectorAll('.runninghubConfigCard input')].filter(el => el.type !== 'checkbox').map(el => ({ width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right }))
    })))`);
    assert.equal(layout.overflow, false);
    assert(layout.fields.every((field) => field.width > 150 && field.right <= width));
  }
  win.setSize(1440, 1080);
  await run(`document.querySelector('.runninghubConfigCard').scrollIntoView({ block: 'center' }); new Promise(resolve => requestAnimationFrame(resolve))`);
  if (process.env.NOVAFLOW_TEST_SCREENSHOT) {
    fs.writeFileSync(process.env.NOVAFLOW_TEST_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
  }
  assert.deepEqual(errors, []);
  console.log("RunningHub real renderer/preload UI checks passed (fixture IPC, no external calls)");
  app.exit(0);
}).catch((err) => { console.error(err); app.exit(1); });
