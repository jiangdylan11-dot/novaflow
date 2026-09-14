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
const aiMasks=arg('--ai-masks',null);
const liveAi=process.argv.includes('--live-ai');
const automatic=!!aiMasks||liveAi||process.argv.includes('--automatic');
const autoExport=process.argv.includes('--auto-export');
const switchAfterSave=process.argv.includes('--switch-after-save');
const playBeforeSave=process.argv.includes('--play-before-save');
const expectFailure=process.argv.includes('--expect-failure');
const repeatSave=process.argv.includes('--repeat-save');
const buttonControls=repeatSave||autoExport||process.argv.includes('--button-controls');
app.setPath('userData',path.join(output,'profile'));
app.whenReady().then(async()=>{
 fs.mkdirSync(output,{recursive:true});
 if(switchAfterSave)fs.copyFileSync(input,path.join(output,'second-source.mp4'));
 const encodeDir=path.join(output,'export');fs.mkdirSync(encodeDir,{recursive:true});
 // Execute the production encoding handler, with only IPC/trace transport supplied
 // by this isolated test. Internal cutout saves do not require online export.
 const main=fs.readFileSync(arg('--main',path.join(root,'particle-editor-desktop/main.js')),'utf8');
 const start=main.indexOf('handleNovaFlowTempIpc("export-encode-frames-to-video",'),stop=main.indexOf('\n});',start)+4;
 assert(start>0&&stop>start);let encode;
 const cutoutRawEncoder=require('../main/cutout-raw-encoder.js').createCutoutRawEncoder({ffmpegPath:require('ffmpeg-static'),validate:p=>p?.novaflowTrace?.kind==='cutout-final-webm'});
 const rawFrameHashes=[];for(const method of ['start','write','abort'])ipcMain.handle('lifecycle-raw-'+method,(event,p)=>{if(method==='write'&&process.argv.includes('--trace-raw-frames'))rawFrameHashes.push(require('node:crypto').createHash('sha256').update(p.bytes).digest('hex'));return cutoutRawEncoder[method](event,p);});
 new Function('handleNovaFlowTempIpc','fs','path','ffmpegPath','isInternalCutoutSaveFrameEncode','assertOnlineEntitled','traceEncodedCutoutOutput','runCmd','toIpcErrorResult','cutoutRawEncoder',main.slice(start,stop))(
  (_,fn)=>encode=fn,fs,path,require('ffmpeg-static'),p=>p?.novaflowTrace?.kind==='cutout-final-webm',()=>{throw Error('unexpected non-internal export');},async()=>{},
  (exe,args,options)=>new Promise(resolve=>{const p=spawn(exe,args,{...options,windowsHide:true});let stderr='';p.stderr.on('data',x=>stderr+=x);p.on('exit',code=>resolve({ok:code===0,stderr}));}),e=>({ok:false,error:String(e)}),cutoutRawEncoder);
 ipcMain.handle('lifecycle-write',(_,p)=>{const file=path.join(encodeDir,path.basename(p.fileName));fs.writeFileSync(file,Buffer.from(p.bytes));return {ok:true};});
 const encodeTimings=[];ipcMain.handle('lifecycle-encode',async(event,p)=>{const start=Date.now(),result=await encode(event,p);encodeTimings.push({ms:Date.now()-start,ok:result.ok});return result;});
 if(liveAi){
  const backend=require('./helpers/cutout-live-backend.cjs').createLiveBackend(output,{mainPath:arg('--main',null)});
  ipcMain.handle('lifecycle-mask',(event,p)=>backend({sender:{send:(channel,data)=>event.sender.send(channel,data)}},p));
 }
 if(aiMasks){
  const sharp=require('sharp'),match=await require('./helpers/cutout-mask-fixture.cjs').createMaskFixtureMatcher(arg('--ai-mask-source-frames',path.resolve(aiMasks,'../source')));
  ipcMain.handle('lifecycle-mask',async(_,p)=>{
   const masks=[],width=p.rendererFrameWidth,height=p.rendererFrameHeight;
   for(const frame of p.rendererDecodedFrames){const m=await match(frame.bytes);masks.push(await sharp(path.join(aiMasks,m.fileName)).ensureAlpha().extractChannel(3).resize(width,height).raw().toBuffer());}
   const alphaBytes=new Uint8Array(Buffer.concat(masks));
   return {ok:true,jobId:p.jobId,kind:'video',width,height,fps:p.fps,frames:masks.length,decodedFrameIndices:p.decodedFrameManifest.map(f=>f.decodedFrameIndex),decodedFrameManifest:p.decodedFrameManifest,timelineToDecodedFrameMap:p.timelineToDecodedFrameMap,alphaBytes,alphaEncoding:'u8-mask-v1',alphaByteLength:alphaBytes.byteLength};
  });
 }
 const preload=path.join(output,'preload.cjs');fs.writeFileSync(preload,"window.nfRaw=(method,p)=>require('electron').ipcRenderer.invoke('lifecycle-raw-'+method,p);window.nfOnMaskProgress=cb=>{const ipc=require('electron').ipcRenderer,fn=(_,p)=>cb(p);ipc.on('ai-seq-rembg-batch-progress',fn);return()=>ipc.removeListener('ai-seq-rembg-batch-progress',fn)};window.nfOnMaskChunk=cb=>{const ipc=require('electron').ipcRenderer,fn=(_,p)=>cb(p);ipc.on('ai-seq-rembg-mask-chunk',fn);return()=>ipc.removeListener('ai-seq-rembg-mask-chunk',fn)};window.nfShot=p=>require('electron').ipcRenderer.invoke('lifecycle-shot',p);window.nfWrite=p=>require('electron').ipcRenderer.invoke('lifecycle-write',p);window.nfEncode=p=>require('electron').ipcRenderer.invoke('lifecycle-encode',p);window.nfMask=p=>require('electron').ipcRenderer.invoke('lifecycle-mask',p);");
 const win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{offscreen:true,preload,sandbox:false,contextIsolation:false,backgroundThrottling:false}});
 ipcMain.handle('lifecycle-shot',async(_,name)=>{fs.writeFileSync(path.join(output,path.basename(name)+'.png'),(await win.webContents.capturePage(name.startsWith('second-source')?undefined:{x:0,y:0,width:320,height:940})).toPNG());return true;});
 win.webContents.on('console-message',(...args)=>{const message=args[0]?.message||args[2];if(message?.startsWith('NF_TEST'))console.log(message);});
 const html=path.join(output,'fixture.html');
 fs.writeFileSync(html,'<!doctype html><body><div data-novaflow-ai-resource-sidebar-host="1" data-novaflow-ai-resource-sidebar-panel="1" style="position:absolute;left:1190px;top:0;width:180px;height:700px">资源列表</div><div id="test-root" style="position:absolute;left:0;top:0;width:320px"></div><div id="preview" data-ais-canvas="1" data-novaflow-source-layout="1" data-novaflow-ai-preview-viewport="1" style="position:relative;width:800px;height:700px;background:#111;margin-left:350px"></div></body>');
 await win.loadFile(html);
 for(const file of ['ai-sequence-state-machine-runtime.js','ai-sequence-green-screen-matting.js','ai-sequence-cutout-pipeline.js'].filter(file=>fs.existsSync(path.join(runtime,file))))await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=${JSON.stringify(pathToFileURL(path.join(runtime,file)).href)};script.onload=()=>resolve(true);script.onerror=()=>reject(Error('Failed to load ${file}'));document.head.append(script);})`);
 await win.webContents.executeJavaScript(`(()=>{const api=window.NovaFlowGreenScreenMatting,key=api.renderAsync?'renderAsync':'render',render=api[key];window.__nfRenderCount=0;api[key]=(...args)=>{window.__nfRenderCount++;return render(...args);};})()`);
 const brand=fs.readFileSync(arg('--brand',path.join(runtime,'novaflow-brand-runtime.js')),'utf8'),end=brand.lastIndexOf('  bootstrapEarlyRuntime();'); assert(end>0);
 await win.webContents.executeJavaScript(brand.slice(0,end)+'bindAiSequenceCutoutFailureRecovery();window.nfLifecycle={saveAiSequenceCutoutCopy,ensureAiSequenceStateDomGuards,getAiSequenceCurrentSession,hasAiAnimationWorkspaceSignals,applyAiSequenceToolDetailState,styleAiAnimationPostToolStates,ensureStyle,getAiSequenceStateController,rememberAiSequenceSourcePreviewStyle,restoreAiSequencePlainBoardMediaDisplay,releaseAiSequenceRuntimePreviewOwnershipToSource,clearAiSequencePreviewOverlayMediaSyncNode,ensureAiSequencePreviewMediaPanZoom,getAiSequencePreviewMedia,syncAiSequencePreviewPrimaryMediaVisibility,cancelAiSequenceCutoutEditingSession,settleAiSequenceCutoutResourceModeNow,hasAiSequenceCutoutNativeDetailReady,completeAiSequenceCutoutMediaSaveAndClose,deferAiSequenceCutoutExportUntilSaved};})();');
 const bundle=fs.readFileSync(path.join(runtime,'assets/index-BbIa-2NM.js'),'utf8'),boot='(0,g.createRoot)(document.getElementById(`root`)).render((0,X.jsx)(_.StrictMode,{children:(0,X.jsx)(Ed,{})}));';assert(bundle.includes(boot));
 const diagnosticBundle=bundle.replace('let nfUnifiedVideoCutoutV1=', 'window.__nfDockDiagnostic=()=>({job:K.current,source:yr,enabled:N,resultActive:V,status:q,maskCount:U.current.size,fullCache:nfFinalFrames.current?.stats(),previewVersion:un.current?.version,previewReady:ar()?.ready,manualGlobal:!!Kt.current,manualFrame:!!Ut.get(Hn(Number(y)||0)),pipeline:window.__NOVAFLOW_CUTOUT_PIPELINE_METRICS__});let nfUnifiedVideoCutoutV1=');
 const mod=path.join(output,'bundle.mjs');fs.writeFileSync(mod,diagnosticBundle.replace(boot,'window.nfTest={React:_,jsx:X.jsx,createRoot:g.createRoot,Dock:zt};'));
 await win.webContents.executeJavaScript(`import(${JSON.stringify(pathToFileURL(mod).href)}).then(()=>true)`);
 const report=await win.webContents.executeJavaScript(`(async()=>{
 const {React,jsx,createRoot,Dock}=window.nfTest,L=window.nfLifecycle,vp=document.getElementById('preview');
 const errors=[],checks=[],buttons=[];console.error=(...a)=>errors.push(a.map(String).join(' '));window.alert=x=>errors.push(String(x));
 setInterval(()=>console.log('NF_TEST diagnostic '+JSON.stringify(window.__nfDockDiagnostic?.())),10000);
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),wait=async(fn,label)=>{for(let i=0;i<12000;i++){if(fn())return;if(i===250)console.log('NF_TEST waiting '+label+' masks='+maskCalls+' active='+window.NovaFlowAiCutoutSessionBridge?.isActive?.()+' '+document.body.innerText.slice(-500));await sleep(40);}throw Error('timeout '+label+' '+errors.join(' | ')+' '+document.body.innerText.slice(-1200));};
 let video=document.createElement('video');video.muted=true;video.preload='auto';video.src=${JSON.stringify(pathToFileURL(input).href)};vp.append(video);
 await wait(()=>video.readyState>=2,'video');const w=video.videoWidth,h=video.videoHeight,count=Math.round(video.duration*24);
 const controller=L.getAiSequenceStateController();controller.replaceSource({url:video.src},{force:true});
 let setView,exporter;const register=e=>exporter=e;
 let resumedExports=0,saveMs=0,warmupMs=0;const editChecks=[];const saved=[];window.electronAPI={exportCreateTempDir:async()=>({ok:true,dir:${JSON.stringify(encodeDir)}}),exportCleanupDir:async()=>({ok:true}),exportEncodeFramesToVideo:p=>window.nfEncode(p)};
 if(${process.argv.includes('--raw-save')})Object.assign(window.electronAPI,{cutoutRawStart:p=>window.nfRaw('start',p),cutoutRawWrite:p=>window.nfRaw('write',p),cutoutRawAbort:p=>window.nfRaw('abort',p)});window.electronAPI.onAiSeqRembgBatchProgress=window.nfOnMaskProgress;window.electronAPI.onAiSeqRembgMaskChunk=window.nfOnMaskChunk;let maskCalls=0;window.electronAPI.aiSeqRembgBatch=p=>{maskCalls++;return window.nfMask(p)};
 localStorage.setItem('nf_green_screen_light_preserve',String(${automatic}));
 window.NovaFlowAiSequenceAssetBridge={commitCutoutFile:async (file,options)=>{const url=URL.createObjectURL(file);const probe=document.createElement('video');probe.muted=true;probe.src=url;document.body.append(probe);await wait(()=>probe.readyState>=2,'saved WEBM decode');saved.push({options,name:file.name,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join(''),bytes:file.size,width:probe.videoWidth,height:probe.videoHeight,duration:probe.duration});probe.remove();return{id:'test-saved-'+saved.length,filename:file.name,objectUrl:url};}};
 function Fixture(){const [enabled,setEnabled]=React.useState(false),[frame,setFrame]=React.useState(0),[freeze,setFreeze]=React.useState(false),[playing,setPlaying]=React.useState(false),[sourceEpoch,setSourceEpoch]=React.useState(0);setView={setEnabled,setFrame,setFreeze,setPlaying,setSourceEpoch};
 const ref=React.useRef(video);ref.current=video;React.useLayoutEffect(()=>{video.style.opacity=enabled||freeze?'0':'1';},[enabled,freeze,sourceEpoch]);
 return jsx(Dock,{videoRef:ref,portalEl:vp,fileName:'lifecycle-'+sourceEpoch+'.mp4',inputVideoSrc:video.src,inputSourceKind:'video',durationSec:video.duration,previewW:w,previewH:h,exportW:w,exportH:h,exportScalePct:100,previewZoom:1,canvasPanX:0,canvasPanY:0,timeSec:frame/24,playing,fps:24,sourceFps:24,sourceFrames:count,keepDuration:false,playbackBaseFps:24,previewBg:'gray',enabled,setEnabled,setAiSeqFrameMode:value=>setFreeze(!!value),setPreviewTimelinePlaying:setPlaying,onExtractFrames:()=>{},frameModeActive:freeze,canEditFrame:true,registerBgExport:register,exportHelpers:{writeBinaryFile:p=>window.nfWrite(p)}});}
 createRoot(document.getElementById('test-root')).render(jsx(Fixture,{}));await sleep(200);
 document.getElementById('test-root').setAttribute('data-novaflow-ai-post-section','1');document.body.classList.add('novaflow-ai-animation-section-layers','novaflow-ai-bottom-workspace-active');if(${buttonControls})document.body.classList.add('novaflow-primary-target-animation');L.ensureStyle();
 const mode=editing=>{document.body.setAttribute('data-novaflow-ai-sequence-mode',editing?'editing':'resource');document.body.setAttribute('data-novaflow-ai-sequence-active-tool',editing?'ai-cutout':'');document.body.classList.toggle('novaflow-ai-animation-cutout-editing',editing);};
 const canvas=()=>vp.querySelector('[data-novaflow-ai-cutout-edit-canvas]');
 const inspect=label=>{const c=canvas(),s=getComputedStyle(c),r=c.getBoundingClientRect(),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let alpha=0;for(let i=3;i<d.length;i+=4)alpha+=d[i]>0;const check={label,alpha,display:s.display,opacity:s.opacity,visibility:s.visibility,width:r.width,height:r.height,bitmap:[c.width,c.height],ratio:r.width/r.height,expectedRatio:w/h,insideViewport:(()=>{const v=vp.getBoundingClientRect();return r.left>=v.left-1&&r.right<=v.right+1&&r.top>=v.top-1&&r.bottom<=v.bottom+1;})(),bodyMode:document.body.getAttribute('data-novaflow-ai-sequence-mode')};checks.push(check);console.log('NF_TEST '+JSON.stringify(check));return check;};
 // The fixture supplies beginTool below; bypass only the full-app deferred begin coordinator. Save clicks run its real capture listener.
 const open=async(frame)=>{controller.expandTools(true);mode(false);document.body.setAttribute('data-novaflow-ai-sequence-mode','editor-preview');setView.setFrame(frame);setView.setFreeze(false);await sleep(60);const button=document.querySelector('[data-novaflow-video-cutout="1"]');if(!button)throw Error('button missing '+document.getElementById('test-root').innerText+' ERRORS '+errors.join('|'));if(${buttonControls})L.styleAiAnimationPostToolStates(document.getElementById('test-root'));if(button.textContent!=='视频抠图'||button.querySelector('i,svg,img'))throw Error('idle cutout label/icon mismatch');if(!checks.length)await window.nfShot('idle-button');const beginEvent=new MouseEvent('click',{bubbles:true,cancelable:true});beginEvent.__novaflowAiSequenceToolBeginPassthrough=true;button.dispatchEvent(beginEvent);await wait(()=>window.NovaFlowAiCutoutSessionBridge?.hasResult(),'cutout');controller.beginTool('ai-cutout');mode(true);const post=document.getElementById('test-root');if(${buttonControls})L.styleAiAnimationPostToolStates(post);const nativeReady=L.hasAiSequenceCutoutNativeDetailReady(post,button);console.log('NF_TEST nativeReady '+nativeReady);if(!nativeReady)throw Error('automatic controls not recognized after reopening');if(${buttonControls}){buttons.push({label:button.textContent,icons:button.querySelectorAll('i,svg,img').length,width:button.getBoundingClientRect().width,rowWidth:button.parentElement.getBoundingClientRect().width});if(Math.abs(button.getBoundingClientRect().width-button.parentElement.getBoundingClientRect().width)>2)throw Error('single cutout button left an empty second column');if(button.textContent!=='视频抠图'||button.getAttribute('aria-disabled')!=='true')throw Error('active entry must stay disabled');if(!checks.length)await window.nfShot('editing-button');}await wait(()=>document.querySelector('[data-novaflow-green-screen-light-preserve]')?.getAttribute(${automatic?"'data-novaflow-green-screen-active'":"'aria-checked'"})===${automatic?"'1'":"'false'"},'matting applied');await wait(()=>{const c=canvas(),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let a=0;for(let i=3;i<d.length;i+=4)a+=d[i]>0;return a>100&&a<c.width*c.height*.98;},'visible transparent result');L.ensureAiSequencePreviewMediaPanZoom(vp);await sleep(100);return inspect('open-'+frame);};
 const close=async(save)=>{if(save){console.log('NF_TEST full save started');if(${autoExport}){const started=performance.now();const exportButton=document.createElement('button');exportButton.textContent='导出';document.body.append(exportButton);exportButton.addEventListener('click',event=>{if(L.deferAiSequenceCutoutExportUntilSaved(event,exportButton))return;if(controller.getActiveSession().mode!=='resource'||!saved.length)throw Error('export resumed before saved resource');resumedExports++;});exportButton.click();exportButton.click();await wait(()=>resumedExports===1,'automatic save then export');await sleep(100);if(resumedExports!==1||saved.length!==1)throw Error('duplicate save/export');saveMs=performance.now()-started;exportButton.remove();}else if(${buttonControls}){const nativeSession=L.getAiSequenceCurrentSession();if(!nativeSession)throw Error('fixture is missing active workspace session');const previous=saved.length;document.querySelector('[data-novaflow-video-cutout="1"]').click();await wait(()=>saved.length===previous+1&&controller.getActiveSession().mode==='resource','save button commits and closes');}else await L.completeAiSequenceCutoutMediaSaveAndClose(controller,'ai-cutout');console.log('NF_TEST full save complete');}else L.cancelAiSequenceCutoutEditingSession(controller);mode(false);await sleep(100);L.ensureAiSequencePreviewMediaPanZoom(vp);L.restoreAiSequencePlainBoardMediaDisplay(vp);await sleep(150);if(getComputedStyle(video).opacity==='0')throw Error('source preview hidden after close');};
 if(${expectFailure}){
   Object.assign(video.style,{width:'100%',height:'100%',objectFit:'contain'});
   window.electronAPI.aiSeqRembgBatch=async()=>{throw Error('test recognition unavailable')};
   controller.expandTools(true);mode(false);await sleep(100);
   const event=new MouseEvent('click',{bubbles:true,cancelable:true});event.__novaflowAiSequenceToolBeginPassthrough=true;
   document.querySelector('[data-novaflow-video-cutout="1"]').dispatchEvent(event);setView.setFreeze(true);controller.beginTool('ai-cutout');mode(true);
   await wait(()=>document.querySelector('[data-novaflow-cutout-failure-notice="1"]'),'failure notice');await sleep(500);
   return {failureRecovered:true,sourceOpacity:getComputedStyle(video).opacity,sourceDisplay:getComputedStyle(video).display,sourceReady:video.readyState,mode:controller.getActiveSession().mode,message:document.querySelector('[data-novaflow-cutout-failure-notice="1"]').textContent,errors};
 }
 if(${repeatSave}){
   await open(0);L.ensureAiSequenceStateDomGuards();
   const original=controller.getActiveSession().sourceMedia;
   const saveButton=document.querySelector('[data-nf-cutout-panel-action="save"]');
   const row=saveButton.parentElement, toggle=document.querySelector('[data-novaflow-green-screen-light-preserve]');
   if(row.getBoundingClientRect().bottom>toggle.getBoundingClientRect().top)throw Error('save row must precede switches');
   saveButton.click();saveButton.click();await wait(()=>saved.length===1&&!document.body.hasAttribute('data-novaflow-ai-cutout-saving'),'first copy');await sleep(1000);
   if(controller.getActiveSession().mode!=='editing'||!window.NovaFlowAiCutoutSessionBridge.isActive())throw Error('save exited editing');
   if(toggle.getAttribute('aria-checked')==='true'){toggle.click();await sleep(200);}
   const range=document.querySelector('[data-novaflow-ai-cutout-param-range]');
   if(!range)throw Error('manual parameters missing');
   const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
   setter.call(range,String(Number(range.max)));range.dispatchEvent(new Event('input',{bubbles:true}));await sleep(300);
   saveButton.click();await wait(()=>saved.length===2&&!document.body.hasAttribute('data-novaflow-ai-cutout-saving'),'second copy');
   if(saved[0].name===saved[1].name||saved[0].hash===saved[1].hash||saved.some(s=>s.options.activate!==false))throw Error('copies must be distinct and preserve editing');
   if(controller.getActiveSession().sourceMedia!==original||controller.getActiveSession().mode!=='editing')throw Error('save changed original source');
   await sleep(1000);document.querySelector('[data-nf-cutout-panel-action="cancel"]').click();await sleep(500);
   if(controller.getActiveSession().mode==='editing'||document.querySelector('[data-nf-cutout-panel-action]'))throw Error('cancel did not leave editing');
   return {repeatSave:true,saved,checks,errors};
 }
 let openMs=0,endToEndMs=0;const processStarted=performance.now();for(let i=0;i<${buttonControls?1:4};i++){const openStarted=performance.now();await open(i%2?count-1:0);openMs=performance.now()-openStarted;if(window.NovaFlowAiCutoutSessionBridge.tool()!=='ai')throw Error('video cutout lost session ownership');
 if(i===0&&${automatic}&&!${buttonControls}){
  const toggle=document.querySelector('[data-novaflow-green-screen-light-preserve]'),calls=maskCalls;
  toggle.click();await wait(()=>toggle.getAttribute('aria-checked')==='false','manual key');await sleep(200);
  if(!document.querySelector('[data-novaflow-soft-green-active="0"]'))throw Error('manual controls missing');
  toggle.click();await wait(()=>toggle.getAttribute('data-novaflow-green-screen-active')==='1','automatic key restored');
  if(maskCalls!==calls)throw Error('unchanged source inferred again on toggle');inspect('toggle-restored');
 }
 if(${playBeforeSave}){await sleep(1000);const warmupStarted=performance.now();setView.setPlaying(true);await wait(()=>{const warm=window.__NOVAFLOW_CUTOUT_PREVIEW_WARMUP__;return window.__nfDockDiagnostic().previewReady||(warm?.done?.size>0&&warm.running.size===0);},'playback prepared');warmupMs=performance.now()-warmupStarted;console.log('NF_TEST warmupMs '+warmupMs);}

 if(${process.argv.includes('--edit-after-warmup')}){
  setView.setPlaying(false);setView.setFreeze(true);await sleep(500);
  const before=window.__nfDockDiagnostic(),renders=window.__nfRenderCount,c=canvas(),rect=c.getBoundingClientRect();
  if(before.fullCache?.frames<count)throw Error('Full cache not prepared before edit');
  const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='擦除');button.click();await sleep(100);
  const event={bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse',button:0,clientX:rect.left+rect.width*.55,clientY:rect.top+rect.height*.8};
  c.dispatchEvent(new PointerEvent('pointerdown',{...event,buttons:1}));c.dispatchEvent(new PointerEvent('pointerup',{...event,buttons:0}));
  await wait(()=>window.__nfDockDiagnostic().previewVersion>before.previewVersion&&window.__nfRenderCount>renders,'single frame dirty');await sleep(1000);
  const retained=window.__nfDockDiagnostic().fullCache.frames;if(retained<count-1)throw Error('Single frame edit discarded unrelated frames: '+retained);
  setView.setPlaying(true);await wait(()=>{const warm=window.__NOVAFLOW_CUTOUT_PREVIEW_WARMUP__;return window.__nfDockDiagnostic().previewReady||(warm?.done?.size>0&&warm.running.size===0);},'edited frame prepared');
  const recomputed=window.__nfRenderCount-renders;if(recomputed<1||recomputed>3)throw Error('Single edit rerendered '+recomputed+' frames');
  editChecks.push({retained,recomputed,totalFrames:count});console.log('NF_TEST single-frame edit '+JSON.stringify(editChecks));
 }
 const renderBeforeSave=window.__nfRenderCount,saveStarted=performance.now();await close((${buttonControls}||i===1)&&${process.argv.includes('--encode-save')});if(!saveMs)saveMs=performance.now()-saveStarted;endToEndMs=performance.now()-processStarted;
 if(${playBeforeSave}){if(window.__nfRenderCount!==renderBeforeSave)throw Error('save recomputed already prepared frames');console.log('NF_TEST save reused all prepared frames');}
 }
 if(${switchAfterSave}){
   const old=video;old.pause();old.remove();video=document.createElement('video');video.muted=true;video.preload='auto';video.src=${JSON.stringify(pathToFileURL(path.join(output,'second-source.mp4')).href)};vp.append(video);await wait(()=>video.readyState>=2,'second source decoded');
   controller.replaceSource({url:video.src},{force:true});setView.setEnabled(true);setView.setFreeze(false);setView.setPlaying(false);setView.setSourceEpoch(1);await sleep(300);
   await open(Math.min(29,count-1));const second=inspect('second-source-after-save');if(second.alpha<=100||second.display==='none'||Number(second.opacity)===0)throw Error('second source black');await window.nfShot('second-source-after-save');await close(false);
 }
 // A queued layout cleanup can run after React has committed a new display or
 // aspect ratio. Use real React props and the production snapshot/cleanup here.
 const host=document.createElement('div');vp.append(host);let update;
 function Presentation(){const [active,setActive]=React.useState(false);update=setActive;return jsx('canvas',{id:'presentation',width:736,height:1280,style:{display:active?'block':'none',opacity:active?1:0,position:'absolute',width:active?368:800,height:active?640:300,transform:active?'translate(12px, 18px) scale(0.8)':'translate(120px, 50px) scale(1.5)',pointerEvents:active?'auto':'none'}});}
 createRoot(host).render(jsx(Presentation,{}));await sleep(60);const pc=document.getElementById('presentation');L.rememberAiSequenceSourcePreviewStyle(pc);pc.setAttribute('data-novaflow-ai-media-overlay-sync','1');update(true);await sleep(60);L.clearAiSequencePreviewOverlayMediaSyncNode(pc);L.releaseAiSequenceRuntimePreviewOwnershipToSource(vp);L.restoreAiSequencePlainBoardMediaDisplay(vp);
 const ps=getComputedStyle(pc);const presentation={display:ps.display,opacity:ps.opacity,width:ps.width,height:ps.height,transform:pc.style.transform};
 return {checks,buttons,presentation,errors,saved,maskCalls,resumedExports,saveMs,warmupMs,openMs,endToEndMs,editChecks,renderCount:window.__nfRenderCount,pipeline:window.__NOVAFLOW_CUTOUT_PIPELINE_METRICS__,workerStats:window.NovaFlowGreenScreenMatting?.workerStats?.()};
 })()`);
 report.electronVersion=process.versions.electron;report.encodeTimings=encodeTimings;if(rawFrameHashes.length)report.rawFrameHashes=rawFrameHashes;fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
 fs.writeFileSync(path.join(output,'preview.png'),(await win.webContents.capturePage()).toPNG());
 if(repeatSave){assert.equal(report.saved.length,2);assert.equal(report.errors.length,0,report.errors.join(' | '));console.log('NF_TEST repeat save PASS');win.destroy();app.quit();return;}
 if(expectFailure){assert.equal(report.mode,'resource');assert.equal(report.sourceOpacity,'1');assert.notEqual(report.sourceDisplay,'none');assert(report.sourceReady>=2);assert.match(report.message,/test recognition unavailable/);console.log('NF_TEST failure recovery PASS');win.destroy();app.quit();return;}
 for(const c of report.checks){assert(c.alpha>100&&c.alpha<c.bitmap[0]*c.bitmap[1]*.98,'missing transparent result '+c.label);assert(c.display!=='none'&&Number(c.opacity)>0&&c.visibility==='visible','hidden preview '+c.label);assert(Math.abs(c.ratio-c.expectedRatio)<0.01,'distorted preview '+c.label);assert(c.insideViewport,'preview outside viewport '+c.label);}
 assert.deepEqual(report.presentation,{display:'block',opacity:'1',width:'368px',height:'640px',transform:'translate(12px, 18px) scale(0.8)'},'queued cleanup must use current React presentation');
 if(autoExport){assert.equal(report.resumedExports,1);assert.equal(report.saved.length,1);}
 assert.equal(report.maskCalls,(buttonControls?1:4)+(switchAfterSave?1:0),'each new editing session must acquire subject masks once');assert.equal(report.errors.length,0,report.errors.join('\n'));console.log('NF_TEST PASS');win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
