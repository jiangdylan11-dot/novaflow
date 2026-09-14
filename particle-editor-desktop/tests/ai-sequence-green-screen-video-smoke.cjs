require('../main/stdio-guard').installStdioGuards();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {app, BrowserWindow, ipcMain} = require('electron');
const root = path.resolve(__dirname, '../..');
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i+1]; };
const input = arg('--input');
const output = path.resolve(arg('--output') || path.join(root, 'logs/green-screen-video-smoke'));
const bundle = arg('--bundle') || path.join(root, 'particle-editor/assets/index-BbIa-2NM.js');
const mattingSource=fs.readFileSync(arg('--matting')||path.join(root,'particle-editor/ai-sequence-green-screen-matting.js'),'utf8');
const mattingSha256=require('node:crypto').createHash('sha256').update(mattingSource).digest('hex');
const controlsOnly=process.argv.includes('--controls-only');
const performanceOnly=process.argv.includes('--performance-only');
const expectCaptureFailure=process.argv.includes('--expect-capture-failure');
const aiMasks=arg('--ai-masks');
const liveBackend=process.argv.includes('--live-backend');
const usesMasks=!!aiMasks||liveBackend;
const toolMode='video';
assert(usesMasks,'video cutout smoke needs live AI or native model fixtures');
app.setPath('userData', path.join(output, 'electron-profile'));
app.whenReady().then(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const frames = path.join(output,'frames');fs.mkdirSync(frames,{recursive:true});
  const writes=[];
  const maskMatches=[];
  if(liveBackend){
    const backend=require('./helpers/cutout-live-backend.cjs').createLiveBackend(output);
    ipcMain.handle('test-ai-mask',async(event,p)=>{
      if(process.argv.includes('--save-captured-frames')){
        fs.mkdirSync(path.join(output,'captured'),{recursive:true});
        for(const f of p.rendererDecodedFrames)fs.writeFileSync(path.join(output,'captured',`frame_${String(f.decodedFrameIndex).padStart(4,'0')}.png`),Buffer.from(f.bytes));
      }
      return backend(event,p);
    });
  }
  const matchMask=aiMasks?await require('./helpers/cutout-mask-fixture.cjs').createMaskFixtureMatcher(arg('--ai-mask-source-frames')||path.resolve(aiMasks,'../source')):null;
  if(aiMasks)ipcMain.handle('test-ai-mask',async(_,p)=>{
    const sharp=require('sharp'),masks=[];
    // Replay real model outputs through the production binary-mask contract.
    // Half-size masks also exercise the renderer's mask-to-source scaling.
    const divisor=process.argv.includes('--native-masks')?1:2;
    const width=Math.round(p.rendererFrameWidth/divisor),height=Math.round(p.rendererFrameHeight/divisor);
    for(const frame of p.decodedFrameManifest){
      const captured=p.rendererDecodedFrames?.find(f=>f.decodedFrameIndex===frame.decodedFrameIndex);
      assert(captured?.bytes?.length,'cached-mask replay requires the actual captured RGB');
      if(process.argv.includes('--save-captured-frames')){
        fs.mkdirSync(path.join(output,'captured'),{recursive:true});
        fs.writeFileSync(path.join(output,'captured',`frame_${String(frame.decodedFrameIndex).padStart(4,'0')}.png`),Buffer.from(captured.bytes));
      }
      const match=await matchMask(captured.bytes),name=match.fileName;
      maskMatches.push({decodedFrameIndex:frame.decodedFrameIndex,timelineIndex:frame.representativeTimelineFrameIndex,...match});
      masks.push(await sharp(path.join(aiMasks,name)).ensureAlpha().extractChannel(3).resize(width,height).raw().toBuffer());
    }
    const alphaBytes=new Uint8Array(Buffer.concat(masks));
    return {ok:true,jobId:p.jobId,kind:'video',width,height,fps:p.fps,frames:masks.length,decodedFrameIndices:p.decodedFrameManifest.map(f=>f.decodedFrameIndex),decodedFrameManifest:p.decodedFrameManifest,timelineToDecodedFrameMap:p.timelineToDecodedFrameMap,alphaBytes,alphaEncoding:'u8-mask-v1',alphaByteLength:alphaBytes.byteLength};
  });
  ipcMain.handle('test-write',async(_,p)=>{
    const name=path.basename(p.fileName||p.path||'');assert(name);
    fs.writeFileSync(path.join(frames,name),Buffer.from(p.bytes));writes.push(name);if(writes.length%24===0)console.log('NF_TEST exported '+writes.length);return {ok:true};
  });
  const preload=path.join(output,'fixture-preload.cjs');
  fs.writeFileSync(preload,"window.testWrite=p=>require('electron').ipcRenderer.invoke('test-write',p);window.testAiMask=p=>require('electron').ipcRenderer.invoke('test-ai-mask',p).catch(error=>{window.__nfTestMaskError=String(error);throw error;});");
  const win=new BrowserWindow({show:false,width:1200,height:1500,webPreferences:{offscreen:true,sandbox:false,contextIsolation:false,preload,backgroundThrottling:false}});
  win.webContents.on('console-message',(...args)=>{const e=args[0]?.message?args[0]:{level:args[1],message:args[2]};if(e.level==='error'||e.message?.startsWith('NF_TEST'))console.log(e.message);});
  const html=path.join(output,'fixture.html');fs.writeFileSync(html,'<!doctype html><body><div id="test-root"></div><div id="preview" style="position:relative;width:736px;height:1280px"></div></body>');
  await win.loadFile(html);
  await win.webContents.executeJavaScript(mattingSource);
  await win.webContents.executeJavaScript(`(()=>{const original=window.NovaFlowGreenScreenMatting.render;window.__nfMaterialReferences=new Set;window.NovaFlowGreenScreenMatting.render=(...args)=>{const start=performance.now(),r=original(...args);window.__nfMattingMs=(window.__nfMattingMs||0)+performance.now()-start;if(Number.isInteger(r?.materialStats?.referenceFrame))window.__nfMaterialReferences.add(r.materialStats.referenceFrame);return r;};})()`);
  await win.webContents.executeJavaScript(`(()=>{const api=window.NovaFlowGreenScreenMatting,render=api.render;window.__nfRenderCount=0;window.__nfFrameStores=[];api.render=(...args)=>{window.__nfRenderCount++;return render(...args)};if(api.createFrameCache){const create=api.createFrameCache;api.createFrameCache=(...args)=>{const cache=create(...args);if(cache)window.__nfFrameStores.push(cache);return cache;};}})()`);
  let source=fs.readFileSync(bundle,'utf8');
  if(process.argv.includes('--trace-seek')){
    source=source.replace('Lt=async(e,t,n)=>{','Lt=async(e,t,n)=>{if(t>4.7)console.log("NF_TEST seek-start "+JSON.stringify({target:t,current:e.currentTime,duration:e.duration,paused:e.paused,ended:e.ended,src:e.currentSrc}));');
    source=source.replace('let f=Number(e.currentTime)||0,p=e.readyState>=2;', 'if(t>4.7)console.log("NF_TEST before-callback "+JSON.stringify({target:t,current:e.currentTime,duration:e.duration,paused:e.paused,ended:e.ended}));let f=Number(e.currentTime)||0,p=e.readyState>=2;');
    source=source.replace('let h=Number(e.currentTime)||0;if(n?.strict', 'if(t>4.7)console.log("NF_TEST after-callback "+JSON.stringify({target:t,current:e.currentTime,mediaTime:m?.mediaTime,verified:m?.verified,captured:!!m?.capturedFrame,error:m?.error}));let h=Number(e.currentTime)||0;if(n?.strict');
  }
  const boot='(0,g.createRoot)(document.getElementById(`root`)).render((0,X.jsx)(_.StrictMode,{children:(0,X.jsx)(Ed,{})}));';
  assert(source.includes(boot));source=source.replace(boot,'window.nfCutoutTest={React:_,jsx:X.jsx,createRoot:g.createRoot,Dock:zt};');
  const mod=path.join(output,'fixture-bundle.mjs');fs.writeFileSync(mod,source);
  await win.webContents.executeJavaScript(`import(${JSON.stringify(pathToFileURL(mod).href)}).then(()=>true)`);
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const {React,jsx,createRoot,Dock}=window.nfCutoutTest;
    let modelCalls=0;const processingTitles=new Set(),timings={};
    window.electronAPI={aiSeqRembgBatch:async p=>{modelCalls++;timings.prepareMs=performance.now()-timings.started;const start=performance.now();try{return await window.testAiMask(p)}finally{timings.backendMs=performance.now()-start}}};
    const titleObserver=new MutationObserver(()=>{const title=document.querySelector('[data-novaflow-ai-rembg-title]')?.textContent;if(title)processingTitles.add(title)});
    titleObserver.observe(document.body,{childList:true,subtree:true,characterData:true});
    const errors=[];console.error=(...a)=>{const message=a.map(x=>String(x?.stack||x)).join(' ');errors.push(message);console.log('NF_TEST error '+message);};window.alert=x=>errors.push(String(x));
    const video=document.createElement('video');video.muted=true;video.preload='auto';video.src=${JSON.stringify(pathToFileURL(input).href)};document.body.append(video);
    await new Promise((ok,no)=>{video.onloadeddata=ok;video.onerror=()=>no(Error('video decode failed'));});
    const w=video.videoWidth,h=video.videoHeight,fps=24,count=Math.round(video.duration*fps);
    let exporter=null;const register=x=>exporter=x;
    const helpers={pickDirectory:async()=>({dir:'test'}),writeBinaryFile:p=>window.testWrite(p)};
    function Test(){const [enabled,setEnabled]=React.useState(false);const [playing,setPlaying]=React.useState(false);window.__nfFixturePlay=setPlaying;const videoRef=React.useRef(video);
      return jsx(Dock,{videoRef,portalEl:document.getElementById('preview'),fileName:'green-screen.mp4',inputSourceKind:'video',durationSec:video.duration,
      previewW:w,previewH:h,exportW:w,exportH:h,exportScalePct:100,previewZoom:1,canvasPanX:0,canvasPanY:0,timeSec:0,playing,fps,sourceFps:fps,sourceFrames:count,keepDuration:false,playbackBaseFps:fps,previewBg:'gray',
      enabled,setEnabled,onExtractFrames:()=>{},setPreviewTimelinePlaying:setPlaying,setAiSeqFrameMode:()=>{},frameModeActive:true,canEditFrame:true,registerBgExport:register,exportHelpers:helpers});}
    localStorage.setItem('nf_bg_remove_matte_mode','key'); // Migrate a previous color-key preference.
    createRoot(document.getElementById('test-root')).render(jsx(Test,{}));
    const wait=async(f,label)=>{for(let i=0;i<${liveBackend?30000:4000};i++){if(window.__nfTestMaskError)throw Error(window.__nfTestMaskError);if(f())return;if(i%250===0)console.log('NF_TEST waiting '+label+' '+document.body.innerText.slice(-140));await new Promise(r=>setTimeout(r,40));}throw Error('timeout '+label+' '+document.body.innerText.slice(-900)+' '+errors.join('\\n'));};
    const button=()=>document.querySelector('[data-novaflow-video-cutout="1"]');
    await wait(()=>button()&&button().getAttribute('aria-disabled')==='false','video cutout button');
    const entry={count:document.querySelectorAll('[data-novaflow-video-cutout="1"]').length,label:button().textContent,icons:button().querySelectorAll('i,svg,img').length,legacy:[...document.querySelectorAll('[role=button]')].filter(n=>['AI抠图','色键抠图'].includes(n.textContent)).length};
    if(${expectCaptureFailure})window.electronAPI.aiSeqRembgBatch=async()=>{throw Error('test recognition unavailable')};
    timings.started=performance.now();button().click();
    if(${expectCaptureFailure}){
      await wait(()=>document.querySelector('[data-novaflow-cutout-error="1"]'),'visible failure recovery');
      await new Promise(r=>setTimeout(r,100));
      const canvas=document.querySelector('[data-novaflow-ai-cutout-edit-canvas]');
      return {failureRecovered:true,message:document.querySelector('[data-novaflow-cutout-error="1"]').textContent,canvasVisible:!!canvas&&getComputedStyle(canvas).display!=='none'&&getComputedStyle(canvas).visibility!=='hidden'&&canvas.getBoundingClientRect().height>0,videoReady:video.readyState>=2,errors};
    }
    await wait(()=>document.querySelector('[data-novaflow-green-screen-light-preserve]')?.getAttribute('data-novaflow-green-screen-active')==='1','green matting');
    await wait(()=>typeof exporter==='function','export registration');
    const startupErrors=${usesMasks}?errors.splice(0):[];
    await new Promise(r=>setTimeout(r,400));
    const canvas=document.querySelector('[data-novaflow-ai-cutout-edit-canvas]');
    const preview=canvas.toDataURL();const text=document.body.innerText;
    if(${process.argv.includes('--play-before-export')}){
      await new Promise(r=>setTimeout(r,1000));
      const start=performance.now(),calls=window.__nfRenderCount;window.__nfFixturePlay(true);
      const heartbeat=setInterval(()=>console.log('NF_TEST playback '+JSON.stringify({calls:window.__nfRenderCount,stores:window.__nfFrameStores.map(cache=>cache.stats()),warmup:{running:window.__NOVAFLOW_CUTOUT_PREVIEW_WARMUP__?.running?.size,done:window.__NOVAFLOW_CUTOUT_PREVIEW_WARMUP__?.done?.size}})),10000);
      await wait(()=>{const warmup=window.__NOVAFLOW_CUTOUT_PREVIEW_WARMUP__;return warmup?.done?.size>0&&warmup.running.size===0;},'full playback cache');
      clearInterval(heartbeat);
      timings.playbackPrepareMs=performance.now()-start;timings.playbackRenderCalls=window.__nfRenderCount-calls;
    }
    const exportStart=performance.now(),mattingStart=window.__nfMattingMs||0,renderStart=window.__nfRenderCount;
    if(!${controlsOnly})await exporter({dir:'test',rawDir:true,finalAsset:true,silent:true,throwOnError:true,baseName:'clean'});
    timings.mattingMs=(window.__nfMattingMs||0)-mattingStart;timings.exportMs=performance.now()-exportStart;timings.totalMs=performance.now()-timings.started;
    timings.exportRenderCalls=window.__nfRenderCount-renderStart;
    timings.frameStores=window.__nfFrameStores.map(cache=>cache.stats());
    if(${performanceOnly})return {w,h,fps,count,duration:video.duration,preview,text,entry,startupErrors,errors,modelCalls,processingTitles:[...processingTitles],timings};
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    await sleep(300);
    const before=canvas.getContext('2d').getImageData(0,0,w,h).data;
    const brush=Array.from(document.querySelectorAll('input[type=number]')).find(n=>n.max==='120');
    const feather=Array.from(document.querySelectorAll('input[type=number]')).filter(n=>n.max==='24').at(-1);
    const setInput=(n,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,String(value));n.dispatchEvent(new Event('input',{bubbles:true}));};
    setInput(brush,35);setInput(feather,8);await sleep(100);
    Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='擦除').click();await sleep(100);
    const rect=canvas.getBoundingClientRect(),px=${Number(arg('--brush-x'))||330},py=${Number(arg('--brush-y'))||530};
    for(const type of ['pointerdown','pointerup']){canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,buttons:type==='pointerdown'?1:0,pointerId:1,clientX:rect.left+px/w*rect.width,clientY:rect.top+py/h*rect.height}));await sleep(150);}
    await sleep(1000);
    const erased=canvas.getContext('2d').getImageData(0,0,w,h).data;
    let changed=0,soft=0;for(let i=3;i<erased.length;i+=4){if(erased[i]<before[i])changed++;if(before[i]===255&&erased[i]>0&&erased[i]<255)soft++;}
    Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='修复').click();await sleep(100);
    for(const type of ['pointerdown','pointerup']){canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,buttons:type==='pointerdown'?1:0,pointerId:2,clientX:rect.left+px/w*rect.width,clientY:rect.top+py/h*rect.height}));await sleep(150);}
    await sleep(1000);const restored=canvas.getContext('2d').getImageData(0,0,w,h).data;
    let recovered=0;for(let i=3;i<restored.length;i+=4)if(restored[i]>erased[i])recovered++;
    const panel=document.querySelector('[data-novaflow-manual-brush]');
    titleObserver.disconnect();
    return {w,h,fps,count,duration:video.duration,preview,text,entry,startupErrors,errors,modelCalls,processingTitles:[...processingTitles],materialReferences:[...window.__nfMaterialReferences],brush:{changed,soft,recovered,visible:!!panel?.getBoundingClientRect().height}};
  })()`);
  if(expectCaptureFailure){
    assert(result.failureRecovered&&result.videoReady&&!result.canvasVisible,JSON.stringify(result));
    assert(result.message.includes('已恢复原视频'));
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({pass:true,...result},null,2));
    console.log(JSON.stringify({pass:true,...result}));win.destroy();app.quit();return;
  }
  const {preview,...report}=result;
  fs.writeFileSync(path.join(output,'preview.png'),Buffer.from(preview.split(',')[1],'base64'));
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({...report,toolMode,liveBackend,writes,maskMatches,mattingSha256},null,2));
  assert.equal(writes.filter(x=>x.endsWith('.png')).length,controlsOnly?0:result.count,'must export all source frames');
  assert(result.text.includes('羽化'),'existing feather control must remain available');
  if(!performanceOnly)assert(result.brush.changed>0&&result.brush.soft>0&&result.brush.recovered>0&&result.brush.visible,'real visible erase, feather, and restore must work');
  assert(!result.errors.length,result.errors.join('\n'));
  assert.deepEqual(result.entry,{count:1,label:'视频抠图',icons:0,legacy:0});
  assert.equal(result.modelCalls,1,'unified cutout performs one subject recognition pass');
  assert(result.processingTitles.includes('视频抠图 · AI 主体识别'),'AI processing must be explicit');
  assert(result.startupErrors.every(e=>e.includes('AI cutout missing timelineToDecodedFrameMap')),result.startupErrors.join('\n'));
  console.log(JSON.stringify({pass:true,...report,writes:writes.length}));win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
