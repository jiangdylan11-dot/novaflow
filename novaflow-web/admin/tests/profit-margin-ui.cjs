// Real Electron renderer/preload and fixture IPC; no live accounts or writes.
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
app.commandLine.appendSwitch("disable-gpu");
const root = process.env.NOVAFLOW_ADMIN_UI_ROOT || path.resolve(__dirname, "../license-admin-gui");
let saved = {credit_price_usd:null, credit_price_cny:null, usd_cny:null}, saveCount = 0, failRead = false;
const rows = [
  {feature:"online_chat_turn",status:"settled",settled_credits:7,rh_cost_usd:0.0148427,rh_cost_currency:"USD"},
  {feature:"xiaotao_vision",status:"settled",settled_credits:7,rh_cost_usd:null,rh_cost_currency:"USD"},
  {feature:"admin_adjust",status:"settled",settled_credits:7,rh_cost_usd:0,rh_cost_currency:"USD"},
  {feature:"online_chat_turn",status:"released",settled_credits:7,rh_cost_usd:0.01,rh_cost_currency:"USD"}
];
for (const channel of new Set([...fs.readFileSync(path.join(root,"preload.js"),"utf8").matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m)=>m[1]))) {
  ipcMain.handle(channel, async (_event,payload) => {
    if (channel === "admin-default-paths") return {};
    if (channel === "admin-status") return {ok:true,status:{}};
    if (channel === "admin-online-config") return {ok:true,config:{}};
    if (channel === "admin:data:profit_estimate:get") return failRead ? {ok:false,error:'fixture read failed'} : {ok:true,result:saved};
    if (channel === "admin:data:profit_estimate:save") {
      saveCount++;
      const amount = (x) => x == null || x === "" ? null : Number(x);
      saved={credit_price_usd:amount(payload.credit_price_usd),credit_price_cny:amount(payload.credit_price_cny),usd_cny:amount(payload.usd_cny)};
      return {ok:true,result:saved};
    }
    if (channel === "admin:data:credit_ledger:query") return {ok:true,result:{records:rows}};
    return {ok:true,result:{source:"supabase",status:"ok",records:[]}};
  });
}
app.whenReady().then(async()=>{
  const win = new BrowserWindow({show:false,width:1440,height:900,webPreferences:{preload:path.join(root,"preload.js"),contextIsolation:true,nodeIntegration:false}});
  await win.loadFile(path.join(root,"index.html"));
  const run=(script)=>win.webContents.executeJavaScript(script);
  await run(`new Promise((resolve,reject)=>{const stop=Date.now()+10000;const t=setInterval(()=>{if(document.querySelector('#dashboardRecentActivity tbody tr')){clearInterval(t);resolve()}else if(Date.now()>stop){clearInterval(t);reject(Error('ledger timeout'))}},25)})`);
  assert.deepEqual(await run(`Array.from(document.querySelector('#dashboardRecentActivity tbody tr').cells).slice(-2).map(c=>c.textContent)`),["—","—"]);
  assert.match(await run(`$('dashboardRecentActivity').textContent`),/最近流水预估毛利：—（可计算 0 \/ 显示 3 条）/);
  assert.match(await run(`$('dashboardRecentActivity').textContent`),/未设置积分参考售价/);
  assert.equal(await run(`Array.from($('dashboardRecentActivity').querySelectorAll('button')).some(x=>x.textContent==='设置积分售价')`),true);
  await run(`$('profitCreditPriceUsd').value='0.004';saveProfitEstimateSettings()`);
  assert.equal(saveCount,1);
  assert.equal(await run(`Array.from(document.querySelector('#dashboardRecentActivity tbody tr').cells).slice(-3)[0].textContent`),"0.0148");
  assert.match(await run(`Array.from(document.querySelector('#dashboardRecentActivity tbody tr').cells).slice(-3)[0].title`),/0\.0148427 USD/);
  assert.deepEqual(await run(`Array.from(document.querySelector('#dashboardRecentActivity tbody tr').cells).slice(-2).map(c=>c.textContent)`),["$0.0280","$0.0132"]);
  assert.match(await run(`$('dashboardRecentActivity').textContent`),/最近流水预估毛利：\$0.0132（可计算 1 \/ 显示 3 条）/);
  assert.equal(await run(`$('profitCreditPriceUsd').value`),"0.004");
  await run(`$('profitCreditPriceUsd').value='';$('profitCreditPriceCny').value='0.028571428571';$('profitUsdCny').value='6.7';saveProfitEstimateSettings()`);
  assert.equal(saveCount,2);
  assert.deepEqual(await run(`Array.from(document.querySelector('#dashboardRecentActivity tbody tr').cells).slice(-2).map(c=>c.textContent)`),["$0.0299","$0.0150"]);
  assert.match(await run(`$('dashboardRecentActivity').textContent`),/最近流水预估毛利：\$0.0150（可计算 1 \/ 显示 3 条）/);
  await run(`queryLedger(false)`);
  assert.equal(await run(`Array.from($('creditLedgerBody').rows[0].cells).slice(-3)[0].textContent`),"0.0148");
  assert.deepEqual(await run(`Array.from($('creditLedgerBody').rows).map(row=>Array.from(row.cells).slice(-2).map(c=>c.textContent))`),[["$0.0299","$0.0150"],["—","—"],["—","—"],["—","—"]]);
  assert.equal(await run(`$('profitCreditPriceCny').value`),"0.028571428571");
  assert.equal(await run(`$('profitUsdCny').value`),"6.7");
  assert.match(await run(`$('creditLedgerDialog').textContent`),/不是净利润/);
  assert.equal(await run(`estimatedLedgerMargin({feature:'x',status:'settled',settled_credits:1,rh_cost_usd:0.1},{credit_price_usd:0.01}).margin < 0`),true);
  assert.equal(await run(`profitReferenceUsd({credit_price_usd:0.01,credit_price_cny:0.7,usd_cny:7})`),0.01);
  failRead = true;
  assert.equal(await run(`loadProfitEstimateSettings()`),false);
  assert.deepEqual(await run(`Array.from(document.querySelector('#dashboardRecentActivity tbody tr').cells).slice(-2).map(c=>c.textContent)`),["—","—"]);
  assert.match(await run(`$('profitEstimateStatus').textContent`),/fixture read failed/);
  failRead = false;
  saved = {credit_price_usd:null, credit_price_cny:null, usd_cny:null};
  await run(`loadProfitEstimateSettings()`);
  assert.equal(await run(`Array.from($('dashboardRecentActivity').querySelectorAll('button')).find(x=>x.textContent==='设置积分售价').click(); $('module-ai-services').classList.contains('active')`),true);
  win.destroy(); console.log('profit estimate UI fixtures passed'); app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
