const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const {app,BrowserWindow}=require('electron');
const runtime=process.env.NOVAFLOW_CONTROLS_TEST_RUNTIME||path.resolve(__dirname,'../../particle-editor');
const out=path.resolve(__dirname,'../../logs/merge-immediate-mask-20260914');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile'));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{contextIsolation:false,sandbox:false,backgroundThrottling:false}});
 const file=path.join(out,'fixture.html');fs.writeFileSync(file,'<!doctype html><meta charset="utf-8"><body style="margin:0;background:#222;overflow:hidden"><div id="post" style="width:240px"></div><div id="stage" style="position:absolute;left:260px;top:0;width:1000px;height:800px"></div></body>');await win.loadFile(file);
 for(const suffix of ['resource.js','resource-bridge.js','mask.tool.js','preview.js','export.workflow.js','workspace.js']){
  const name=suffix==='export.workflow.js'?'ai-sequence-video-merge-export.workflow.js':'ai-sequence-video-merge.'+suffix;
  await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=${JSON.stringify(pathToFileURL(path.join(runtime,name)).href)};s.onload=resolve;s.onerror=reject;document.head.append(s)})`);
 }
 const input='C:/Users/jiang/OneDrive/Desktop/新建文件夹/kling_20260908_VIDEO_藍色背景中__Ima_4120_0.mp4';
 const report=await win.webContents.executeJavaScript(`(async()=>{
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const h=NovaFlowAiSequenceVideoMergeWorkspace.open({previewHost:document.getElementById('stage'),postSection:document.getElementById('post')});
 const store=h.getStore(),ids=store.getState().layers.map(l=>l.id);
 for(const id of ids)await store.importDescriptor(id,{name:'clip.mp4',type:'video/mp4',objectUrl:${JSON.stringify(pathToFileURL(input).href)}});
 store.selectLayer(ids[0]);await sleep(250);
 if(h.debugSnapshot().maskEditing!==ids[0])throw Error('mask not enabled by default');
 const canvas=h.getPreview().getCanvas(),r=canvas.getBoundingClientRect();
 const surface=h.getMaskSurface(ids[0]);const before=surface.copyCoverage();
 for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:0,pointerId:1}));
 await sleep(150);const edited=surface.copyCoverage();
 const sum=a=>a.reduce((a,b)=>a+b,0);if(sum(edited)>=sum(before))throw Error('brush did not apply immediately');
 canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));await sleep(60);if(sum(surface.copyCoverage())!==sum(before))throw Error('undo shortcut');
 canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true}));await sleep(60);if(sum(surface.copyCoverage())!==sum(edited))throw Error('redo shortcut');
 store.selectLayer(ids[1]);await sleep(60);if(h.debugSnapshot().maskEditing!==ids[1])throw Error('layer switch locked');
 store.selectLayer(ids[0]);await sleep(60);if(h.getMaskSurface(ids[0])!==surface||sum(surface.copyCoverage())!==sum(edited))throw Error('layer switch lost mask/history');
 const ranges=Array.from(document.querySelectorAll('.nf-vm-range')).map(e=>getComputedStyle(e).backgroundSize);if(ranges.length!==3||ranges.some(v=>v!=='100% 2px'))throw Error('thin rails '+ranges);
 const labels=Array.from(document.querySelectorAll('button')).map(e=>e.textContent);if(labels.some(v=>['编辑图层蒙版','应用蒙版','取消编辑','撤销','重做'].includes(v)))throw Error('legacy controls');
 return {defaultEditing:true,immediateMask:true,undoRedo:true,layerSwitchPreservesMask:true,ranges,coverageBefore:sum(before),coverageAfter:sum(edited)};
 })()`);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'preview.png'),(await win.webContents.capturePage()).toPNG());console.log(JSON.stringify(report));app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
