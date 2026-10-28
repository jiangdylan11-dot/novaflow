// Real renderer/preload with isolated IPC fixtures; never connects to live accounts.
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
app.commandLine.appendSwitch("disable-gpu");
const root = path.resolve(__dirname, "../license-admin-gui");
const users = [
  { id: "user-one", account: "kingyo", display_name: "Kingyo display", plan: "pro", status: "active", created_at: "2026-10-01T10:00:00Z" },
  { id: "user-two", account: "weyne", display_name: "Weyne display", plan: "trial", status: "disabled", created_at: "2026-10-02T10:00:00Z" }
];
const credits = [{ user_id: "user-one", balance: 20000 }, { user_id: "user-two", balance: 0 }];
const adjustments = [], updates = [], errors = [], queries = [];
const result = (records) => ({ ok: true, result: { source: "supabase", status: "ok", records } });
let failLedger = false;
for (const channel of new Set([...fs.readFileSync(path.join(root, "preload.js"), "utf8").matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1]))) {
  ipcMain.handle(channel, async (_event, payload) => {
    if (channel === "admin-default-paths") return {};
    if (channel === "admin-status") return { ok: true, status: {} };
    if (channel === "admin-online-config") return { ok: true, config: {} };
    if (channel === "admin:data:users:list") return result(users);
    if (channel === "admin:data:credits:list") return result(credits);
    if (channel === "admin:data:users:update") { updates.push(payload); return { ok: true, result: { status: "ok" } }; }
    if (channel === "admin:data:credits:adjust") {
      adjustments.push(payload);
      const credit = credits.find((row) => row.user_id === payload.userId);
      credit.balance = payload.mode === "set" ? payload.amount : credit.balance + (payload.mode === "deduct" ? -payload.amount : payload.amount);
      return { ok: true, result: { adjustment: { afterBalance: credit.balance } } };
    }
    if (channel === "admin:data:credit_ledger:query") {
      queries.push(payload);
      if (failLedger) return { ok: false, error: "fixture ledger failure" };
      const record = { created_at: "2026-10-28T10:00:00Z", user_email_or_account: payload.user || "all-users", feature: "prompt_optimize", model: "fixture-model", status: "settled", settled_credits: 10, rh_cost_usd: 0.01 };
      if (payload.user === "kingyo") await new Promise((resolve) => setTimeout(resolve, 120));
      return result([record]);
    }
    return result([]);
  });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { preload: path.join(root, "preload.js"), contextIsolation: true, nodeIntegration: false } });
  win.webContents.on("console-message", (_e, level, msg) => { if (level >= 3) errors.push(msg); });
  await win.loadFile(path.join(root, "index.html"));
  const run = (code) => win.webContents.executeJavaScript(code);
  const wait = (condition) => run(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const timer = setInterval(() => {
      if (${condition}) { clearInterval(timer); resolve(); }
      else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('UI condition timed out: ' + ${JSON.stringify(condition)})); }
    }, 30);
  })`);
  await wait(`document.querySelector('#usersTableBody tr td')?.textContent === 'kingyo'`);
  await run(`window.confirm = () => true; window.alert = (msg) => { throw new Error(msg); }; showModule('users')`);
  assert.equal(await run(`document.querySelector('[data-module="credits"]')`), null);
  assert.equal(await run(`document.querySelector('#module-ai-services #creditLedgerBody')`), null);
  assert.deepEqual(await run(`[...document.querySelectorAll('.userTable th')].map(el => el.textContent)`), ["用户", "注册时间", "当前积分", "账户类型", "状态", "同时在线", "有效期", "操作"]);
  assert.deepEqual(await run(`[...document.querySelectorAll('#usersTableBody tr:first-child .tableActions button')].map(el => el.textContent)`), ["流水", "修改密码", "保存", "删除"]);
  await run(`$('userSearchInput').value = 'Weyne display'; $('userSearchInput').dispatchEvent(new Event('input'))`);
  assert.equal(await run(`$('usersTableBody').rows.length`), 1);
  assert.equal(await run(`$('usersTableBody').rows[0].cells[0].textContent`), "weyne");
  await run(`$('userSearchInput').value = ''; $('userSearchInput').dispatchEvent(new Event('input')); document.querySelector('.userCreditActions button').click()`);
  assert.equal(await run(`$('memberAdjustDialog').hidden`), false);
  assert.equal(await run(`$('memberAdjustValue').value`), "20000");
  for (const [mode, amount, balance] of [["add", 200, 20200], ["deduct", 100, 20100], ["set", 20500, 20500]]) {
    await run(`$('memberAdjustMode').value = '${mode}'; $('memberAdjustMode').dispatchEvent(new Event('change')); $('memberAdjustValue').value = '${amount}'; $('memberAdjustReason').value = 'fixture adjustment'; submitMemberAdjust()`);
    assert.equal(adjustments.at(-1).userId, "user-one");
    assert.equal(adjustments.at(-1).mode, mode);
    assert.equal(await run(`document.querySelector('.userCreditActions').firstChild.textContent`), balance.toLocaleString("en-US"));
  }
  await run(`document.querySelector('[data-dialog-close="memberAdjustDialog"]').click(); document.querySelector('#usersTableBody [data-field="maxSessions"]').value = '2'; document.querySelector('#usersTableBody .tableActions button:nth-child(3)').click()`);
  await wait(`$('toast').textContent === '用户已更新'`);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].userId, "user-one");
  await run(`document.querySelector('#usersTableBody .tableActions button').click()`);
  await wait(`$('ledgerStatusText').textContent === '1 笔'`);
  assert.equal(queries.at(-1).user, "kingyo");
  assert.equal(await run(`$('module-users').classList.contains('active')`), true);
  assert.equal(await run(`$('creditLedgerDialog').hidden`), false);
  assert.equal(await run(`$('memberAdjustDialog').hidden`), true);
  for (const width of [1440, 1080]) {
    win.setSize(width, 1000);
    const layout = await run(`new Promise(resolve => requestAnimationFrame(() => resolve({
      overflow: document.documentElement.scrollWidth > innerWidth,
      dialog: (() => { const r = document.querySelector('#creditLedgerDialog .modalPanel').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()
    })))`);
    assert.equal(layout.overflow, false);
    assert.equal(layout.dialog, true);
  }
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); $('openCreditLedger').click()`);
  await wait(`$('creditLedgerBody').textContent.includes('all-users')`);
  assert.equal(queries.at(-1).user, "");
  // A slow response for the prior user must never replace the current user's records.
  await run(`openUserLedger({account:'kingyo'}); openUserLedger({account:'weyne'})`);
  await run(`new Promise(resolve => setTimeout(resolve, 200))`);
  assert.equal(await run(`$('creditLedgerBody').rows[0].cells[1].textContent`), "weyne");
  failLedger = true;
  await run(`queryLedger(false)`);
  assert.equal(await run(`$('creditLedgerBody').textContent`), "流水读取失败，请重试");
  failLedger = false;
  await run(`document.querySelector('[data-dialog-close="creditLedgerDialog"]').click(); openUserLedger({account:'kingyo'})`);
  await wait(`$('ledgerStatusText').textContent === '1 笔'`);
  if (process.env.NOVAFLOW_TEST_SCREENSHOT_DIR) {
    win.setSize(1440, 1000);
    await run(`new Promise(resolve => requestAnimationFrame(resolve))`);
    fs.writeFileSync(path.join(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR, "users-ledger.png"), (await win.webContents.capturePage()).toPNG());
    await run(`closeDataDialog('creditLedgerDialog'); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.join(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR, "users-merged.png"), (await win.webContents.capturePage()).toPNG());
    await run(`document.querySelector('.userCreditActions button').click(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    fs.writeFileSync(path.join(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR, "users-adjust.png"), (await win.webContents.capturePage()).toPNG());
  }
  assert.deepEqual(errors, []);
  console.log("Merged user management and ledger dialog passed in Electron (fixture IPC; no live writes)");
  app.exit(0);
}).catch((error) => { console.error(error, errors); app.exit(1); });
