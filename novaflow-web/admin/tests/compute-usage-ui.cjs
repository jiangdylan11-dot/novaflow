// Real renderer/preload with fixture-only IPC. No production users or writes.
const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
app.commandLine.appendSwitch('disable-gpu');
const root=process.env.NOVAFLOW_ADMIN_UI_ROOT||path.resolve(__dirname,'../license-admin-gui');
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const requests=[],errors=[];let fail=false;
const result=records=>({ok:true,result:{source:'supabase',status:'connected',records}});
const tasks=Array.from({length:61},(_,i)=>({id:'task-'+i,user_id:user,user_account:'dylan',assigned_worker_id:'old-node',worker_name:'已经删除的历史机器',task_type:'image',model_id:'qwen-image-2511',status:i===0?'failed':'completed',created_at:'2026-10-30T10:00:00Z',started_at:'2026-10-30T10:00:01Z',completed_at:i===0?null:'2026-10-30T10:00:04Z',failed_at:i===0?'2026-10-30T10:00:03Z':null,error_code:i===0?'MODEL_ERROR':'',error_message:i===0?'<img src=x onerror=alert(1)> 模型未就绪':'',charged_credit_cost:i===0?0:2}));
for(const channel of new Set([...fs.readFileSync(path.join(root,'preload.js'),'utf8').matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map(m=>m[1])))ipcMain.handle(channel,async(_event,payload)=>{
  assert.notEqual(channel,'admin:data:web_tasks:purge');
  if(channel==='admin-online-config')return {ok:true,config:{}};
  if(channel==='admin:data:users:list')return result([{id:user,account:'dylan'}]);
  if(channel==='admin:data:compute_usage:summary')return result([{user_id:user,user_account:'dylan',total_tasks:61,failed_tasks:1,latest_at:tasks[0].created_at,workers:[{id:'old-node',name:'已经删除的历史机器',tasks:61}]},{user_id:other,user_account:'已删除用户',total_tasks:1,failed_tasks:0,latest_at:tasks[0].created_at,workers:[]}]);
  if(channel==='admin:data:web_task_usage:list'){
    requests.push(payload);
    if(fail)return {ok:true,result:{source:'supabase',status:'error',error:'fixture read failure'}};
    const records=payload.userId===other?[{...tasks[0],user_id:other,user_account:'已删除用户',assigned_worker_id:null,worker_name:''}]:payload.userId?tasks:[];
    const filtered=records.filter(row=>!payload.status||row.status===payload.status),offset=payload.offset||0,limit=payload.limit||50;
    return {ok:true,result:{source:'supabase',status:'connected',records:filtered.slice(offset,offset+limit),total:filtered.length,hasMore:offset+limit<filtered.length}};
  }
  return result([]);
});
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{preload:path.join(root,'preload.js'),contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  await win.loadFile(path.join(root,'index.html'));
  const run=code=>win.webContents.executeJavaScript(code);
  const wait=condition=>run(`new Promise((resolve,reject)=>{const started=Date.now(),t=setInterval(()=>{if(${condition}){clearInterval(t);resolve();}else if(Date.now()-started>8000){clearInterval(t);reject(Error(${JSON.stringify(condition)}));}},20);})`);
  await run(`showModule('compute')`);await wait(`$('computeUsageTableBody').textContent.includes('dylan')`);
  assert.equal(await run(`!!document.querySelector('#computePurgeUsage,#computeUsagePurgeDays')`),false);
  assert.equal(await run(`typeof window.adminAPI.purgeAdminWebTasks`),'undefined');
  assert.match(await run(`$('computeUsageStatus').textContent`),/62 条任务/);
  await run(`$('computeUsageSearch').value='删除用户';$('computeUsageSearch').dispatchEvent(new Event('input'))`);
  assert.equal(await run(`$('computeUsageTableBody').rows.length`),1);
  await run(`$('computeUsageSearch').value='';$('computeUsageSearch').dispatchEvent(new Event('input'));$('computeUsageTableBody').querySelector('button').click()`);
  await wait(`$('computeUsageDetailCount').textContent.includes('共 61 条')`);
  assert.equal(requests.at(-1).userId,user);assert.equal(await run(`$('computeUsageDetailBody').rows.length`),50);
  assert.match(await run(`$('computeUsageDetailBody').textContent`),/已经删除的历史机器/);
  assert.match(await run(`$('computeUsageDetailBody').textContent`),/MODEL_ERROR/);
  assert.equal(await run(`$('computeUsageDetailBody').querySelector('img')`),null);
  await run(`$('computeUsageDetailNext').click()`);await wait(`$('computeUsageDetailCount').textContent.includes('第 2 页')`);
  assert.equal(requests.at(-1).offset,50);assert.equal(await run(`$('computeUsageDetailBody').rows.length`),11);
  assert.equal(await run(`$('computeUsageDetailNext').disabled`),true);
  await run(`$('computeUsageDetailStatus').value='failed';$('computeUsageDetailStatus').dispatchEvent(new Event('change'))`);
  await wait(`$('computeUsageDetailCount').textContent.includes('共 1 条')`);assert.equal(requests.at(-1).offset,0);assert.equal(await run(`$('computeUsageDetailBody').rows.length`),1);
  for(const width of [1280,900]){
    win.setSize(width,720);
    const fits=await run(`new Promise(resolve=>requestAnimationFrame(()=>{const r=$('computeUsageDialog').querySelector('.modalPanel').getBoundingClientRect();resolve(r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight)}))`);
    assert.equal(fits,true);
  }
  if(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR){win.setSize(1280,800);await run(`new Promise(resolve=>requestAnimationFrame(resolve))`);fs.mkdirSync(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.NOVAFLOW_TEST_SCREENSHOT_DIR,'compute-usage-detail.png'),(await win.webContents.capturePage()).toPNG());}
  fail=true;await run(`$('computeUsageDetailRefresh').click()`);await wait(`$('computeUsageDetailCount').textContent.includes('读取失败')`);
  assert.equal(await run(`$('computeUsageDetailRefresh').disabled`),false);
  fail=false;await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));$('computeUsageTableBody').rows[1].querySelector('button').click()`);
  await wait(`$('computeUsageTitle').textContent.includes('已删除用户')&&$('computeUsageDetailCount').textContent.includes('共 1 条')`);
  assert.equal(requests.at(-1).userId,other);assert.match(await run(`$('computeUsageDetailBody').textContent`),/未分配节点/);
  assert.deepEqual(errors,[]);console.log('compute usage UI passed: retained history, per-user filtering, paging, errors and deleted identities');
  win.destroy();app.exit(0);
}).catch(error=>{console.error(error,errors);app.exit(1);});
