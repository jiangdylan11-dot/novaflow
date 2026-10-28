// Real admin page + preload, isolated fixture IPC. No account or cloud writes.
const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed',()=>{});
const ui=path.resolve(__dirname,'../license-admin-gui'),preload=path.join(ui,'preload.js');
const output=path.resolve(__dirname,'../../../work/art-fidelity-speed-20261026/ui');fs.mkdirSync(output,{recursive:true});
const report={baseVersion:'1.0.0',batchSHA256:'c'.repeat(64),selected:[{id:'fixture',method:'按参考的五官抽象程度重建鼻口与明暗块面。',scope:{generationModel:'qwen-2.1',variant:'standard'},positive_count:2,negative_count:1,reviewNotes:['conflicting-feedback','fixed-benchmark-and-owner-review-required']}],excluded:[],publishRequest:{skillId:'style-transfer',version:'1.0.1',candidateIds:['fixture'],validation:{passed:true,cases:3,benchmarkSHA256:'b'.repeat(64)}}};
let publications=0;
for(const channel of new Set([...fs.readFileSync(preload,'utf8').matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map(m=>m[1]))){
 ipcMain.handle(channel,async()=>channel==='admin-default-paths'?{}:channel==='admin-status'?{ok:true,status:{}}:channel==='admin-online-config'?{ok:true,config:{}}:{ok:true,result:{source:'mock',status:'mock',records:[]}});
}
for(const operation of ['candidates','releases','review','prepare','publish','rollback'])ipcMain.handle('admin:art-knowledge:'+operation,async(_e,payload)=>{
 if(operation==='publish'){assert.equal(payload.approval.approved,true);assert.equal(payload.approval.batchSHA256,report.batchSHA256);publications++;return {ok:true,result:{ok:true,version:'1.0.1'}};}
 return {ok:true,result:{ok:true,review:report,candidates:[],releases:[]}};
});
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{preload,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}}),run=code=>win.webContents.executeJavaScript(code);
 await win.loadFile(path.join(ui,'index.html'));
 await run(`window.alert=()=>{}; document.getElementById('artKnowledgeOpen').click(); new Promise((resolve,reject)=>{const start=Date.now(),timer=setInterval(()=>{if(document.querySelector('#nf-art-knowledge-review input[type=checkbox]')){clearInterval(timer);resolve();}else if(Date.now()-start>5000){clearInterval(timer);reject(Error('No admin review'));}},25);})`);
 assert.equal(publications,0,'opening review cannot publish');
 assert.equal(await run(`Array.from(document.querySelectorAll('#nf-art-knowledge-review button')).find(b=>b.textContent==='确认发布本批经验').disabled`),true);
 await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,200))))`);
 fs.writeFileSync(path.join(output,'admin-review.png'),(await win.webContents.capturePage()).toPNG());
 await run(`document.querySelector('#nf-art-knowledge-review input[type=checkbox]').click(); Array.from(document.querySelectorAll('#nf-art-knowledge-review button')).find(b=>b.textContent==='确认发布本批经验').click(); new Promise(resolve=>setTimeout(resolve,80))`);
 assert.equal(publications,1);
 assert((await run(`document.getElementById('nf-art-knowledge-review').innerText`)).includes('本批已发布'));
 win.destroy();
 const account=new BrowserWindow({show:false,width:800,height:700,webPreferences:{contextIsolation:false,nodeIntegration:false}}),exec=code=>account.webContents.executeJavaScript(code);
 await account.loadURL('data:text/html,<html><body style="background:%23101010"></body></html>');
 await exec(`window.electronAPI={clientAuthStatus:async()=>({ok:true,result:{authenticated:true,user:{display_name:'普通用户',plan:'trial'},credits:{balance:500}}}),clientAuthAccountDetails:async()=>({ok:true,result:{user:{plan:'trial'},credits:{balance:500},providerQuotas:{grok:{remaining_count:100,allocated_count:100}}}}),artKnowledgeState:async()=>({ok:true,enabled:true,allowed:false,publisher:true}),artKnowledgeConsent:async()=>({ok:true})}; void 0;`);
 await exec(fs.readFileSync(path.resolve(__dirname,'../../renderer/novaflow-web-account.js'),'utf8'));
 await exec(`const brand=document.createElement('div'); brand.className='nf-brand'; const version=document.createElement('span'); version.className='nf-brand-version'; brand.appendChild(version); document.body.appendChild(brand); NovaFlowWebAccount.seat(); NovaFlowWebAccount.refresh()`);
 const state=await exec(`({text:document.body.innerText,hasReview:[...document.querySelectorAll('button')].some(b=>b.textContent==='审核专业经验')})`);
 assert.equal(state.hasReview,false);assert(!state.text.includes('隐私设置'));assert(!state.text.includes('允许贡献通用美术方法'));
 fs.writeFileSync(path.join(output,'ordinary-account.png'),(await account.webContents.capturePage()).toPNG());
 account.destroy();console.log('Admin review requires exact explicit click; ordinary creative account has no review/publish entry (real page/preload, fixture IPC).');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
