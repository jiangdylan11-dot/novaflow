const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {app, BrowserWindow, ipcMain} = require('electron');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const arg = (name, fallback) => { const i=process.argv.indexOf(name); return i<0?fallback:process.argv[i+1]; };
const output=path.resolve(arg('--output',path.join(root,'logs/cutout-preview-lifecycle-20260913')));
const runtime=path.resolve(arg('--runtime',path.join(root,'particle-editor')));
const input=arg('--input','C:/Users/jiang/OneDrive/Desktop/新建文件夹/kling_20260908_VIDEO_藍色背景中__Ima_4120_0.mp4');
app.setPath('userData',path.join(output,'profile'));
app.whenReady().then(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const encodeDir=path.join(output,'export');fs.mkdirSync(encodeDir,{recursive:true});
 // Execute the production encoding handler, with only IPC/trace transport supplied
 // by this isolated test. Internal cutout saves do not require online export.
 const main=fs.readFileSync(path.join(root,'particle-editor-desktop/main.js'),'utf8');
 const start=main.indexOf('handleNovaFlowTempIpc("export-encode-frames-to-video",'),stop=main.indexOf('\n});',start)+4;
 assert(start>0&&stop>start);let encode;
 new Function('handleNovaFlowTempIpc','fs','path','ffmpegPath','isInternalCutoutSaveFrameEncode','assertOnlineEntitled','traceEncodedCutoutOutput','runCmd','toIpcErrorResult',main.slice(start,stop))(
  (_,fn)=>encode=fn,fs,path,require('ffmpeg-static'),p=>p?.novaflowTrace?.kind==='cutout-final-webm',()=>{throw Error('unexpected non-internal export');},async()=>{},
  (exe,args,options)=>new Promise(resolve=>{const p=spawn(exe,args,{...options,windowsHide:true});let stderr='';p.stderr.on('data',x=>stderr+=x);p.on('exit',code=>resolve({ok:code===0,stderr}));}),e=>({ok:false,error:String(e)}));
 ipcMain.handle('lifecycle-write',(_,p)=>{const file=path.join(encodeDir,path.basename(p.fileName));fs.writeFileSync(file,Buffer.from(p.bytes));return {ok:true};});
 ipcMain.handle('lifecycle-encode',(_,p)=>encode(null,p));
 const preload=path.join(output,'preload.cjs');fs.writeFileSync(preload,"window.nfWrite=p=>require('electron').ipcRenderer.invoke('lifecycle-write',p);window.nfEncode=p=>require('electron').ipcRenderer.invoke('lifecycle-encode',p);");
 const win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{preload,sandbox:false,contextIsolation:false,backgroundThrottling:false}});
 win.webContents.on('console-message',e=>{if(e.message.startsWith('NF_TEST'))console.log(e.message);});
 const html=path.join(output,'fixture.html');
 fs.writeFileSync(html,'<!doctype html><body><div id="test-root"></div><div id="preview" data-ais-canvas="1" data-novaflow-source-layout="1" data-novaflow-ai-preview-viewport="1" style="position:relative;width:800px;height:700px;background:#111;margin-left:350px"></div></body>');
 await win.loadFile(html);
 for(const file of ['ai-sequence-state-machine-runtime.js','ai-sequence-green-screen-matting.js'])await win.webContents.executeJavaScript(fs.readFileSync(path.join(runtime,file),'utf8'));
 const brand=fs.readFileSync(arg('--brand',path.join(runtime,'novaflow-brand-runtime.js')),'utf8'),end=brand.lastIndexOf('  bootstrapEarlyRuntime();'); assert(end>0);
 await win.webContents.executeJavaScript(brand.slice(0,end)+'window.nfLifecycle={ensureStyle,getAiSequenceStateController,rememberAiSequenceSourcePreviewStyle,restoreAiSequencePlainBoardMediaDisplay,releaseAiSequenceRuntimePreviewOwnershipToSource,clearAiSequencePreviewOverlayMediaSyncNode,ensureAiSequencePreviewMediaPanZoom,getAiSequencePreviewMedia,syncAiSequencePreviewPrimaryMediaVisibility,cancelAiSequenceCutoutEditingSession,settleAiSequenceCutoutResourceModeNow,hasAiSequenceCutoutNativeDetailReady,completeAiSequenceCutoutMediaSaveAndClose};})();');
 const bundle=fs.readFileSync(path.join(runtime,'assets/index-BbIa-2NM.js'),'utf8'),boot='(0,g.createRoot)(document.getElementById(`root`)).render((0,X.jsx)(_.StrictMode,{children:(0,X.jsx)(Ed,{})}));';assert(bundle.includes(boot));
 const mod=path.join(output,'bundle.mjs');fs.writeFileSync(mod,bundle.replace(boot,'window.nfTest={React:_,jsx:X.jsx,createRoot:g.createRoot,Dock:zt};'));
 await win.webContents.executeJavaScript(`import(${JSON.stringify(pathToFileURL(mod).href)}).then(()=>true)`);
 const report=await win.webContents.executeJavaScript(`(async()=>{
 const {React,jsx,createRoot,Dock}=window.nfTest,L=window.nfLifecycle,vp=document.getElementById('preview');
 const errors=[],checks=[];console.error=(...a)=>errors.push(a.map(String).join(' '));window.alert=x=>errors.push(String(x));
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),wait=async(fn,label)=>{for(let i=0;i<1500;i++){if(fn())return;await sleep(40);}throw Error('timeout '+label+' '+errors.join(' | '));};
 const video=document.createElement('video');video.muted=true;video.preload='auto';video.src=${JSON.stringify(pathToFileURL(input).href)};vp.append(video);
 await wait(()=>video.readyState>=2,'video');const w=video.videoWidth,h=video.videoHeight,count=Math.round(video.duration*24);
 const controller=L.getAiSequenceStateController();controller.replaceSource({url:video.src},{force:true});
 let setView,exporter;const register=e=>exporter=e;
 const saved=[];window.electronAPI={exportCreateTempDir:async()=>({ok:true,dir:${JSON.stringify(encodeDir)}}),exportCleanupDir:async()=>({ok:true}),exportEncodeFramesToVideo:p=>window.nfEncode(p)};
 window.NovaFlowAiSequenceAssetBridge={commitCutoutFile:async file=>{const url=URL.createObjectURL(file);const probe=document.createElement('video');probe.muted=true;probe.src=url;document.body.append(probe);await wait(()=>probe.readyState>=2,'saved WEBM decode');saved.push({name:file.name,bytes:file.size,width:probe.videoWidth,height:probe.videoHeight,duration:probe.duration});probe.remove();return{id:'test-saved',filename:file.name,objectUrl:url};}};
 function Fixture(){const [enabled,setEnabled]=React.useState(false),[frame,setFrame]=React.useState(0),[freeze,setFreeze]=React.useState(false);setView={setEnabled,setFrame,setFreeze};
 const ref=React.useRef(video);React.useLayoutEffect(()=>{video.style.opacity=enabled||freeze?'0':'1';},[enabled,freeze]);
 return jsx(Dock,{videoRef:ref,portalEl:vp,fileName:'lifecycle.mp4',inputVideoSrc:video.src,inputSourceKind:'video',durationSec:video.duration,previewW:w,previewH:h,exportW:w,exportH:h,exportScalePct:100,previewZoom:1,canvasPanX:0,canvasPanY:0,timeSec:frame/24,playing:false,fps:24,sourceFps:24,sourceFrames:count,keepDuration:false,playbackBaseFps:24,previewBg:'gray',enabled,setEnabled,setAiSeqFrameMode:value=>setFreeze(!!value),setPreviewTimelinePlaying:()=>{},onExtractFrames:()=>{},frameModeActive:freeze,canEditFrame:true,registerBgExport:register,exportHelpers:{writeBinaryFile:p=>window.nfWrite(p)}});}
 createRoot(document.getElementById('test-root')).render(jsx(Fixture,{}));await sleep(200);
 document.getElementById('test-root').setAttribute('data-novaflow-ai-post-section','1');document.body.classList.add('novaflow-ai-animation-section-layers','novaflow-ai-bottom-workspace-active');L.ensureStyle();
 const mode=editing=>{document.body.setAttribute('data-novaflow-ai-sequence-mode',editing?'editing':'resource');document.body.setAttribute('data-novaflow-ai-sequence-active-tool',editing?'chroma-key':'');document.body.classList.toggle('novaflow-ai-animation-cutout-editing',editing);};
 const canvas=()=>vp.querySelector('[data-novaflow-ai-cutout-edit-canvas]');
 const inspect=label=>{const c=canvas(),s=getComputedStyle(c),r=c.getBoundingClientRect(),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let alpha=0;for(let i=3;i<d.length;i+=4)alpha+=d[i]>0;const check={label,alpha,display:s.display,opacity:s.opacity,visibility:s.visibility,width:r.width,height:r.height,bitmap:[c.width,c.height],ratio:r.width/r.height,expectedRatio:w/h,insideViewport:(()=>{const v=vp.getBoundingClientRect();return r.left>=v.left-1&&r.right<=v.right+1&&r.top>=v.top-1&&r.bottom<=v.bottom+1;})(),bodyMode:document.body.getAttribute('data-novaflow-ai-sequence-mode')};checks.push(check);console.log('NF_TEST '+JSON.stringify(check));return check;};
 const open=async(frame)=>{controller.expandTools(true);mode(false);document.body.setAttribute('data-novaflow-ai-sequence-mode','editor-preview');setView.setFrame(frame);setView.setFreeze(false);await sleep(60);const button=[...document.querySelectorAll('[role=button]')].find(n=>n.textContent==='色键抠图');if(!button)throw Error('button missing '+document.getElementById('test-root').innerText+' ERRORS '+errors.join('|'));button.click();await wait(()=>window.NovaFlowAiCutoutSessionBridge?.hasResult(),'cutout');const post=document.getElementById('test-root'),nativeReady=L.hasAiSequenceCutoutNativeDetailReady(post,button);console.log('NF_TEST nativeReady '+nativeReady);if(!nativeReady)throw Error('automatic controls not recognized after reopening');controller.beginTool('chroma-key');mode(true);await wait(()=>document.querySelector('[data-novaflow-green-screen-light-preserve]')?.getAttribute('data-novaflow-green-screen-active')==='1','matting applied');await wait(()=>{const c=canvas(),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let a=0;for(let i=3;i<d.length;i+=4)a+=d[i]>0;return a>100&&a<c.width*c.height*.98;},'visible transparent result');L.ensureAiSequencePreviewMediaPanZoom(vp);await sleep(100);return inspect('open-'+frame);};
 const close=async(save)=>{if(save){console.log('NF_TEST full save started');await L.completeAiSequenceCutoutMediaSaveAndClose(controller,'chroma-key');console.log('NF_TEST full save complete');}else L.cancelAiSequenceCutoutEditingSession(controller);mode(false);await sleep(100);L.ensureAiSequencePreviewMediaPanZoom(vp);L.restoreAiSequencePlainBoardMediaDisplay(vp);await sleep(150);if(getComputedStyle(video).opacity==='0')throw Error('source preview hidden after close');};
 for(let i=0;i<4;i++){await open(i%2?count-1:0);await close(i===1&&${process.argv.includes('--encode-save')});}
 // A queued layout cleanup can run after React has committed a new display or
 // aspect ratio. Use real React props and the production snapshot/cleanup here.
 const host=document.createElement('div');vp.append(host);let update;
 function Presentation(){const [active,setActive]=React.useState(false);update=setActive;return jsx('canvas',{id:'presentation',width:736,height:1280,style:{display:active?'block':'none',opacity:active?1:0,position:'absolute',width:active?368:800,height:active?640:300,transform:active?'translate(12px, 18px) scale(0.8)':'translate(120px, 50px) scale(1.5)',pointerEvents:active?'auto':'none'}});}
 createRoot(host).render(jsx(Presentation,{}));await sleep(60);const pc=document.getElementById('presentation');L.rememberAiSequenceSourcePreviewStyle(pc);pc.setAttribute('data-novaflow-ai-media-overlay-sync','1');update(true);await sleep(60);L.clearAiSequencePreviewOverlayMediaSyncNode(pc);L.releaseAiSequenceRuntimePreviewOwnershipToSource(vp);L.restoreAiSequencePlainBoardMediaDisplay(vp);
 const ps=getComputedStyle(pc);const presentation={display:ps.display,opacity:ps.opacity,width:ps.width,height:ps.height,transform:pc.style.transform};
 return {checks,presentation,errors,saved};
 })()`);
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
 fs.writeFileSync(path.join(output,'preview.png'),(await win.webContents.capturePage()).toPNG());
 for(const c of report.checks){assert(c.alpha>100&&c.alpha<c.bitmap[0]*c.bitmap[1]*.98,'missing transparent result '+c.label);assert(c.display!=='none'&&Number(c.opacity)>0&&c.visibility==='visible','hidden preview '+c.label);assert(Math.abs(c.ratio-c.expectedRatio)<0.01,'distorted preview '+c.label);assert(c.insideViewport,'preview outside viewport '+c.label);}
 assert.deepEqual(report.presentation,{display:'block',opacity:'1',width:'368px',height:'640px',transform:'translate(12px, 18px) scale(0.8)'},'queued cleanup must use current React presentation');
 assert.equal(report.errors.length,0,report.errors.join('\n'));console.log('NF_TEST PASS');win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
