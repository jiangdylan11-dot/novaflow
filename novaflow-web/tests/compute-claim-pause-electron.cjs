// Isolated Electron window; synthetic IPC only, no production account or network.
const {app,BrowserWindow,ipcMain,session}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
app.disableHardwareAcceleration();
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'foart-claim-pause-ui-'));app.setPath('userData',temp);
let state={sharing:true,connected:true,runtimeReady:true,comfy:{image:true},gpu:{name:'Test GPU'},stats:{completed:0,failed:0},policy:{enabled:true,owner_enabled:true,sharing_enabled:true}};
let win,finishPause;const actions=[];
for(const channel of ['state','website','logs','getLogs','freeMemory','pauseClaims','resumeClaims'])ipcMain.handle('compute:'+channel,async()=>{
 actions.push(channel);if(channel==='state')return state;if(channel==='getLogs')return [];
 if(channel==='pauseClaims'){state={...state,claimsPaused:true,claimBusy:true,currentTaskId:'fixture'};win.webContents.send('compute:state',state);return await new Promise(resolve=>{finishPause=resolve});}
 if(channel==='resumeClaims'){state={...state,claimsPaused:false};win.webContents.send('compute:state',state);return {ok:true,state};}
 return {ok:true};
});
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!d.url.startsWith('file:')}));
 const root=path.resolve(__dirname,'../worker/electron');win=new BrowserWindow({show:false,width:560,height:480,resizable:false,titleBarStyle:'hidden',titleBarOverlay:{color:'#242424',symbolColor:'#e5e7eb',height:38},webPreferences:{preload:path.join(root,'compute-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 await win.loadFile(path.join(root,'compute-ui.html'));const run=code=>win.webContents.executeJavaScript(code);
 const until=async(fn)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw Error('UI timeout')};
 await until(()=>run(`document.querySelector('#pauseClaims')?.disabled===false`));
 const fit=()=>run(`(()=>{const m=document.querySelector('main');return m.scrollHeight<=m.clientHeight})()`);
 assert.equal(await fit(),true,'initial layout fits');
 await run(`document.querySelector('#pauseClaims').click()`);
 await until(()=>run(`document.querySelector('#pauseClaims').textContent==='\u6062\u590d\u63a5\u5355'`));
 assert.equal(await run(`document.querySelector('#activityBadge').textContent`),'\u7b49\u5f85\u4efb\u52a1\u5b8c\u6210');
 assert.equal(await run(`document.querySelector('#freeMemory').disabled`),true);
 assert.equal(await fit(),true,'draining layout fits');
 const capture=path.join(temp,'compute-claim-pause.png');fs.writeFileSync(capture,(await win.webContents.capturePage()).toPNG(),{flag:'wx'});
 await run(`document.querySelector('#pauseClaims').click()`);await until(()=>run(`document.querySelector('#pauseClaims').textContent==='\u6682\u505c\u63a5\u5355'`));
 finishPause({ok:false,error:'stale pause',state});await new Promise(r=>setTimeout(r,100));
 assert.equal(await run(`document.querySelector('#error').textContent`),'');assert.deepEqual(actions.filter(x=>x==='pauseClaims'||x==='resumeClaims'),['pauseClaims','resumeClaims']);
 console.log(JSON.stringify({ok:true,actions:actions.filter(x=>x==='pauseClaims'||x==='resumeClaims'),capture,fit:true}));win.destroy();app.exit(0);
}).catch(e=>{console.error(e.stack||e);try{win?.destroy()}catch{}app.exit(1)});
