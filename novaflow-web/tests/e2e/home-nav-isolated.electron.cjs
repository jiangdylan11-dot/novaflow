// Isolated home navigation acceptance. Serves an existing candidate with the
// current home/bridge source; all network is loopback-only and auth is fake.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const candidate = path.join(root, '.artifacts/isolated-builds/web-candidate-20261101-current/web-dist');
const output = path.resolve(root, '../work/home-nav-isolated-' + crypto.randomUUID());
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const requests = [];
const sourceOverrides = new Map([
  ['home-shell.js', path.join(root, 'renderer/home-shell.js')],
  ['home-frame-bridge.js', path.join(root, 'renderer/home-frame-bridge.js')],
  ['xiaotao-foart-tools.js', path.join(root, 'renderer/xiaotao-foart-tools.js')],
]);
let origin;
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  requests.push({path:url.pathname, method:request.method});
  if (url.pathname.startsWith('/api/')) {
    response.setHeader('Content-Type','application/json');
    if (url.pathname === '/api/web/me') return response.end(JSON.stringify({user:{id:'synthetic-home-user',display_name:'Fixture'},credits:42}));
    return response.end(JSON.stringify({ok:true,features:{},taskTypes:[],workers:[],nodes:[],items:[]}));
  }
  const name = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = sourceOverrides.get(name) || path.resolve(candidate, name);
  if (!sourceOverrides.has(name) && !file.startsWith(candidate + path.sep)) {response.writeHead(403);return response.end();}
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {response.writeHead(404);return response.end();}
  const ext = path.extname(file), types = {'.js':'text/javascript','.html':'text/html; charset=utf-8','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm'};
  response.setHeader('Content-Type', types[ext] || 'application/octet-stream');
  if (name === 'index.html' || name === 'editor.html') {
    const conf = JSON.stringify({controlUrl:origin,authUrl:origin,pollIntervalMs:1000});
    const fakeSession = JSON.stringify(JSON.stringify({token:'synthetic-home-token'}));
    const setup = '<script>window.NOVAFLOW_WEB_CONFIG='+conf+';if(new URLSearchParams(location.search).has("guest"))localStorage.removeItem("novaflow_web_session_v1");else localStorage.setItem("novaflow_web_session_v1",'+fakeSession+');</script>';
    return response.end(fs.readFileSync(file,'utf8').replace('<head>','<head>'+setup));
  }
  fs.createReadStream(file).pipe(response);
});
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn, message, timeout=45000) {
  const start=Date.now(); while(Date.now()-start<timeout) { const value=await fn(); if(value)return value; await delay(100); }
  throw new Error(message);
}
app.whenReady().then(async()=>{
  let win;
  try {
    await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
    origin='http://127.0.0.1:'+server.address().port;
    const restrict=partition=>partition.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(request,done)=>{
      const target=new URL(request.url);done({cancel:target.protocol!=='http:'||target.hostname!=='127.0.0.1'||Number(target.port)!==server.address().port});
    });
    restrict(session.defaultSession);
    const guestPartition='home-guest-'+crypto.randomUUID();restrict(session.fromPartition(guestPartition));
    const guest=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{partition:guestPartition,backgroundThrottling:false}});
    await guest.loadURL(origin+'/index.html?guest=1');
    await until(()=>guest.webContents.executeJavaScript(`!!document.getElementById('novaflow-web-login-gate')`),'unauthenticated login gate not shown');
    assert.equal(await guest.webContents.executeJavaScript(`document.getElementById('foart-home').hidden && !document.querySelector('#foart-editor-host iframe')`),true,'guest must not see home or load editor');
    const guestPaths=requests.map(x=>x.path);
    assert(!guestPaths.some(p=>p.endsWith('/editor.html')||/comfy|model/i.test(p)),'guest login must not prefetch editor or models');
    win=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{backgroundThrottling:false}});
    guest.destroy();
    requests.length=0;
    const run=code=>win.webContents.executeJavaScript(code);
    await win.loadURL(origin+'/index.html');
    await until(()=>run(`!document.getElementById('foart-home').hidden`),'home not ready');
    assert.equal(await run(`!!document.querySelector('#foart-editor-host iframe')`),false,'home must not preload editor');
    const initialPaths=requests.map(x=>x.path);
    assert(!initialPaths.some(p=>p.endsWith('/editor.html')||/comfy|model/i.test(p)),'home must not prefetch editor or models');
    await run(`document.querySelector('.card[data-name="骨骼动画"]').click()`);
    await until(()=>run(`(()=>{const f=document.querySelector('#foart-editor-host iframe');return !!(f&&!document.getElementById('foart-editor-host').hidden&&f.contentWindow.NovaFlowSkeletonEditor?.active?.()&&f.contentWindow.NovaFlowSkeletonEditor?.api?.())})()`),'animation editor not ready');
    await until(()=>run(`new URL(location.href).searchParams.get('surface')==='animation'`),'first animation route not committed');
    const initial=await run(`(async()=>{const w=document.querySelector('#foart-editor-host iframe').contentWindow,api=w.NovaFlowSkeletonEditor.api();const p={skeleton:{spine:'3.8.99'},bones:[{name:'root'},{name:'unsaved_test_bone',parent:'root',x:31,length:12}],slots:[],skins:[{name:'default',attachments:{}}],animations:{idle:{}}};await api.loadSource({skeleton:{fileName:'temporary-unsaved-home-test.json',text:JSON.stringify(p)},images:[]});api.setAnim('idle');api.selectBone('unsaved_test_bone');return {json:api.json(),context:api.agentContext()}})()`);
    assert(initial.json.bones.some(b=>b.name==='unsaved_test_bone'&&b.x===31));
    await run(`(()=>{const f=document.querySelector('#foart-editor-host iframe');const logo=f.contentDocument.querySelector('.nf-brand img[alt="logo"]');if(!logo)throw Error('editor logo missing');logo.click()})()`);
    await until(()=>run(`!document.getElementById('foart-home').hidden`),'logo did not return home');
    assert.equal(await run(`document.querySelectorAll('#foart-editor-host iframe').length`),1);
    await run(`document.querySelector('.card[data-name="骨骼动画"]').click()`);
    await until(()=>run(`!document.getElementById('foart-editor-host').hidden && new URL(location.href).searchParams.get('surface')==='animation'`),'did not reopen editor');
    const after=await run(`(()=>{const f=document.querySelector('#foart-editor-host iframe');return {json:f.contentWindow.NovaFlowSkeletonEditor.api().json(),context:f.contentWindow.NovaFlowSkeletonEditor.api().agentContext()}})()`);
    assert.deepEqual(after.json,initial.json,'home round trip changed the unsaved project');
    await run(`history.back()`);await until(()=>run(`!document.getElementById('foart-home').hidden`),'browser Back did not reach home');
    await run(`history.forward()`);await until(()=>run(`!document.getElementById('foart-editor-host').hidden`),'browser Forward did not return editor');
    const forward=await run(`document.querySelector('#foart-editor-host iframe').contentWindow.NovaFlowSkeletonEditor.api().json()`);
    assert.deepEqual(forward,initial.json,'browser history changed the unsaved project');
    const surfaces=[['音视频','video'],['特效制作','effects'],['UI 设计','ui'],['图片编辑','drawing'],['常用工具','tools']];
    const checked=[];
    for(const [label,surface] of surfaces) {
      await run(`document.querySelector('#foart-editor-host iframe').contentDocument.querySelector('.nf-brand img[alt="logo"]').click()`);
      await until(()=>run(`!document.getElementById('foart-home').hidden`),'home not shown before '+surface);
      await run(`document.querySelector(${JSON.stringify('.card[data-name="'+label+'"]')}).click()`);
      await until(()=>run(`!document.getElementById('foart-editor-host').hidden && new URL(location.href).searchParams.get('surface')===${JSON.stringify(surface)}`),'surface not opened: '+surface);
      await run(`document.querySelector('#foart-editor-host iframe').contentDocument.querySelector('.nf-brand img[alt="logo"]').click()`);
      await until(()=>run(`!document.getElementById('foart-home').hidden`),'logo failed on '+surface);
      await run(`document.querySelector('.card[data-name="骨骼动画"]').click()`);
      await until(()=>run(`!document.getElementById('foart-editor-host').hidden && new URL(location.href).searchParams.get('surface')==='animation'`),'animation return failed after '+surface);
      const preserved=await run(`document.querySelector('#foart-editor-host iframe').contentWindow.NovaFlowSkeletonEditor.api().json()`);
      assert.deepEqual(preserved,initial.json,'unsaved animation lost after '+surface);
      checked.push(surface);
    }
    const unload=await run(`(()=>{const e=new Event('beforeunload',{cancelable:true});return {allowed:dispatchEvent(e),defaultPrevented:e.defaultPrevented}})()`);
    assert.equal(unload.defaultPrevented,true,'refresh must be guarded after editor opens');
    // Chromium only permits a beforeunload prompt after a real input gesture.
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
    await delay(100);
    let refreshPrevented=false;
    win.webContents.once('will-prevent-unload',()=>{refreshPrevented=true;});
    win.reload();
    await until(()=>refreshPrevented,'refresh did not trigger native unload protection',10000);
    await delay(300);
    const afterCanceledRefresh=await run(`document.querySelector('#foart-editor-host iframe').contentWindow.NovaFlowSkeletonEditor.api().json()`);
    assert.deepEqual(afterCanceledRefresh,initial.json,'cancelled refresh changed the unsaved project');
    // Exercise the real editor serializer/importer with an in-memory file
    // picker. The resulting bytes are copied only to this test's output folder.
    const saved=await Promise.race([run(`(async()=>{
      const outer=document.querySelector('#foart-editor-host iframe').contentWindow;
      const inner=outer.document.getElementById('novaflow-skeleton-editor-frame').contentWindow;
      const api=outer.NovaFlowSkeletonEditor.api();
      const file={kind:'file',name:'home-isolated.nfproj',data:new inner.File([],'home-isolated.nfproj'),
        queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',getFile:async function(){return this.data},
        createWritable:async function(){const me=this;let bytes=new Uint8Array(0);return {write:async b=>{bytes=new Uint8Array(await b.arrayBuffer())},truncate:async n=>{bytes=bytes.slice(0,n)},close:async()=>{me.data=new inner.File([bytes],me.name)},abort:async()=>{}}}};
      const dir={kind:'directory',name:'isolated-home-fixture',queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',
        resolve:async item=>item===dir?[]:item===file?[file.name]:null,
        getFileHandle:async name=>{if(name===file.name)return file;throw Error('NotFound')},
        getDirectoryHandle:async()=>{throw Error('NotFound')},removeEntry:async()=>{},async *entries(){yield [file.name,file]}};
      inner.showSaveFilePicker=async()=>file;inner.showDirectoryPicker=async()=>dir;
      const receipt=await api.saveProjectFile({as:true,name:'home-isolated'});
      if(!receipt||!file.data.size)throw Error('save returned no file');
      const bytes=new Uint8Array(await file.data.arrayBuffer());
      const payload=JSON.parse(await new Response(file.data.stream().pipeThrough(new DecompressionStream('gzip'))).text());
      const reopened=await api.openProjectFile(file.data,file,{operation:'replace'});
      return {receipt,bytes:Array.from(bytes),payload,reopened,json:api.json()};
    })()`),delay(15000).then(()=>{throw Error('synthetic save/open did not complete')})]);
    assert(saved.bytes.length>0&&saved.payload.projects.some(p=>p.json.bones.some(b=>b.name==='unsaved_test_bone'&&b.x===31)),'saved file missing project');
    assert.deepEqual(saved.json,initial.json,'reopened saved project differs');
    fs.writeFileSync(path.join(output,'home-isolated.nfproj'),Buffer.from(saved.bytes));
    const evidence={ok:true,scope:'actual Electron candidate editor; current home/bridge; mocked local account; synthetic in-memory project and in-memory file picker',guestPaths,initialPaths,frameCount:1,projectBone:after.json.bones.find(b=>b.name==='unsaved_test_bone'),homeLogoReturn:true,backForward:true,moduleRoundTrips:checked,beforeUnload:unload,canceledRefreshPreserved:refreshPrevented,saveReceipt:saved.receipt,savedBytes:saved.bytes.length,reopened:saved.reopened,requests};
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(evidence,null,2));
    console.log(JSON.stringify({ok:true,output,requests:requests.length,unload}));
    win.destroy();server.close();app.exit(0);
  } catch(error) {
    let page=null;try {if(win&&!win.isDestroyed())page=await win.webContents.executeJavaScript(`({url:location.href,homeHidden:document.getElementById('foart-home')?.hidden,hostHidden:document.getElementById('foart-editor-host')?.hidden,status:document.getElementById('foart-home-status')?.textContent,historyLength:history.length})`);} catch {}
    fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(error.stack||error),page,requests},null,2));
    console.error('HOME_NAV_FAILURE',output,error.stack||error);
    if(win&&!win.isDestroyed())win.destroy();server.close();app.exit(1);
  }
});
setTimeout(()=>{console.error('HOME_NAV_TIMEOUT',output);server.close();app.exit(2);},120000).unref();
