// Isolated offscreen editor test. Instrumentation exists only in a temporary
// copy; no user project, global session or production entrypoint is changed.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),renderer=path.join(root,'renderer');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'foart-selection-test-'));
const diagnostics=path.join(temp,'diagnostics.log');
fs.writeFileSync(diagnostics,'script started\n');
app.setPath('userData',path.join(temp,'profile'));
app.commandLine.appendSwitch('use-gl','angle');
app.commandLine.appendSwitch('use-angle','swiftshader');
const editor=fs.readFileSync(path.join(renderer,'spine-skeleton-editor.js'),'utf8');
const anchor='  const tickedOf = () => tickedLayers()';
assert.equal(editor.split(anchor).length,2);
const instrumented=editor.replace(anchor,`  window.__isolatedSelectionTest={captureCommunityBoneSelectionImage,previewCommunityBoneSelection,confirmCommunityBoneSelection,cancelCommunityBoneSelection,undoCommunityBoneSelection,setup(){state.anim='idle';setMode('animate');refresh()},camera(dx){rt.cam.x+=dx},project(){return JSON.stringify(state.json)},selected(){return selectedBones()}};\n${anchor}`);
const script=path.join(temp,'instrumented-editor.js');fs.writeFileSync(script,instrumented);
let html=fs.readFileSync(path.join(renderer,'spine-skeleton-editor.html'),'utf8');
html=html.replace('<head>','<head><base href="'+pathToFileURL(renderer+path.sep).href+'">');
html=html.replace("'spine-skeleton-editor.js'",JSON.stringify(pathToFileURL(script).href));
html=html.replace("return './' + name","return name.startsWith('file:') ? name : './' + name");
const htmlFile=path.join(temp,'instrumented-editor.html');fs.writeFileSync(htmlFile,html);
const wrapper=path.join(temp,'parent.html');
fs.writeFileSync(wrapper,`<!doctype html><html><body style="margin:0"><button id="confirm" data-novaflow-community-selection-confirm="1">Confirm</button><button id="undo" data-novaflow-community-selection-undo="1">Undo</button><iframe id="editor" src="${pathToFileURL(htmlFile).href}" style="width:1050px;height:680px;border:0"></iframe></body></html>`);
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1100,height:760,webPreferences:{offscreen:true,backgroundThrottling:false,nodeIntegration:false,contextIsolation:true}});
  const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message)});
  try {
    await win.loadFile(wrapper);
    const run=code=>win.webContents.executeJavaScript(code);
    await run(`new Promise((resolve,reject)=>{const start=Date.now();function wait(){const w=document.querySelector('#editor').contentWindow;if(w.NovaFlowSkeletonEditorAPI&&w.__isolatedSelectionTest)return resolve();if(Date.now()-start>15000)return reject(Error('editor failed to initialize'));setTimeout(wait,40)}wait()})`);
    const pre=await run(`(async()=>{
      const frame=document.querySelector('#editor').contentWindow,api=frame.NovaFlowSkeletonEditorAPI,t=frame.__isolatedSelectionTest;
      const json={skeleton:{spine:'3.8.99'},bones:[{name:'root'},{name:'body',parent:'root'},{name:'hair',parent:'body'}],slots:[],skins:{default:{}},animations:{idle:{bones:{hair:{rotate:[{time:0,angle:0},{time:1,angle:10}]}}}}};
      await api.loadSource({skeleton:{fileName:'disposable.json',text:JSON.stringify(json)}},{operation:'append'});t.setup();
      const original=t.project(),before=t.selected(),image=t.captureCommunityBoneSelectionImage(),p=t.previewCommunityBoneSelection('hair',image.token);
      let scriptRejected=false;try{t.confirmCommunityBoneSelection(p.token)}catch{scriptRejected=true}
      window.__test={original,before,image,p};window.__result={};
      document.querySelector('#confirm').onclick=e=>{try{window.__result.confirm={trusted:e.isTrusted,parentActive:navigator.userActivation.isActive,childActive:frame.navigator.userActivation.isActive,value:t.confirmCommunityBoneSelection(p.token,e)}}catch(error){window.__result.confirm={trusted:e.isTrusted,error:String(error)}}};
      document.querySelector('#undo').onclick=e=>{try{window.__result.undo={trusted:e.isTrusted,value:t.undoCommunityBoneSelection(window.__result.confirm.value.undoToken,e)}}catch(error){window.__result.undo={trusted:e.isTrusted,error:String(error)}}};
      return {before,pre:t.selected(),scriptRejected,png:image.dataUrl.startsWith('data:image/png;base64,')};
    })()`);
    assert.equal(pre.png,true);assert.equal(pre.scriptRejected,true);assert.deepEqual(pre.pre,pre.before);
    await run(`document.querySelector('#confirm').click()`);
    const synthetic=await run(`window.__result.confirm`);assert.equal(synthetic.trusted,false);assert.ok(synthetic.error);
    const click=async selector=>{const rect=await run(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...rect});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...rect});};
    await click('#confirm');
    const after=await run(`new Promise((resolve,reject)=>{const start=Date.now();function wait(){if(window.__result.confirm?.trusted)return resolve(window.__result.confirm);if(Date.now()-start>5000)return reject(Error('trusted confirmation click not delivered'));setTimeout(wait,20)}wait()})`);
    assert.equal(after.trusted,true);assert.equal(after.parentActive,true);assert.equal(after.childActive,true);assert.equal(after.error,undefined);
    assert.deepEqual(await run(`document.querySelector('#editor').contentWindow.__isolatedSelectionTest.selected()`),['hair']);
    await click('#undo');
    const undo=await run(`new Promise((resolve,reject)=>{const start=Date.now();function wait(){if(window.__result.undo)return resolve(window.__result.undo);if(Date.now()-start>5000)return reject(Error('trusted undo click not delivered'));setTimeout(wait,20)}wait()})`);
    assert.equal(undo.trusted,true);assert.equal(undo.error,undefined);
    const result=await run(`(()=>{const t=document.querySelector('#editor').contentWindow.__isolatedSelectionTest,restored=t.selected(),projectSame=t.project()===window.__test.original;const stale=t.captureCommunityBoneSelectionImage();t.camera(2);let staleRejected=false;try{t.previewCommunityBoneSelection('hair',stale.token)}catch{staleRejected=true}return {restored,projectSame,staleRejected}})()`);
    assert.deepEqual(result.restored,pre.before);assert.equal(result.projectSame,true);assert.equal(result.staleRejected,true);
    console.log('PASS: real iframe editor screenshot, trusted confirmation and undo, rejected script and stale camera');
  } finally {win.destroy()}
}).then(()=>{fs.appendFileSync(diagnostics,'completed\n');app.exit(0)},error=>{fs.appendFileSync(diagnostics,String(error?.stack||error)+'\n');console.error(error);app.exit(1)});
