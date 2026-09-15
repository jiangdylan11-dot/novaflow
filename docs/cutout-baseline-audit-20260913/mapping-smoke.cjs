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
const controlsOnly=process.argv.includes('--controls-only');
const aiMasks=arg('--ai-masks');
app.setPath('userData', path.join(output, 'electron-profile'));
app.whenReady().then(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const frames = path.join(output,'frames');fs.mkdirSync(frames,{recursive:true});
  const writes=[];
  if(aiMasks)ipcMain.handle('test-ai-mask',async(_,p)=>{
    fs.writeFileSync(path.join(output,'received-manifest.json'),JSON.stringify({...p,rendererDecodedFrames:undefined},null,2)); const sharp=require(path.join(root,'particle-editor-desktop/node_modules/sharp')),masks=[],matches=[];
    fs.mkdirSync(path.join(output,'captured'),{recursive:true});
    // Replay real model outputs through the production binary-mask contract.
    // Half-size masks also exercise the renderer's mask-to-source scaling.
    const width=Math.round(p.rendererFrameWidth/2),height=Math.round(p.rendererFrameHeight/2);
    for(const frame of p.decodedFrameManifest){
      
      const capture=p.rendererDecodedFrames.find(f=>f.decodedFrameIndex===frame.decodedFrameIndex),bytes=Buffer.from(capture.bytes);
      fs.writeFileSync(path.join(output,'captured',capture.fileName),bytes);
      const thumbnail=await sharp(bytes).resize(128,128).removeAlpha().raw().toBuffer();
      const candidates=[];
      for(let sourceIndex=Math.max(0,frame.representativeTimelineFrameIndex-2);sourceIndex<=Math.min(72,frame.representativeTimelineFrameIndex+2);sourceIndex++){
        const source=path.resolve(aiMasks,'../source', 'frame_'+String(sourceIndex).padStart(4,'0')+'.png');
        const sample=await sharp(source).resize(128,128).removeAlpha().raw().toBuffer();
        let error=0;for(let j=0;j<sample.length;j++)error+=Math.abs(sample[j]-thumbnail[j]);
        candidates.push({sourceIndex,meanError:error/sample.length});
      }
      candidates.sort((a,b)=>a.meanError-b.meanError);const match=candidates[0];
      matches.push({decodedFrameIndex:frame.decodedFrameIndex,timelineIndex:frame.representativeTimelineFrameIndex,...match,runnerUp:candidates[1]});
      const name='frame_'+String(match.sourceIndex).padStart(4,'0')+'.png';
      masks.push(await sharp(path.join(aiMasks,name)).ensureAlpha().extractChannel(3).resize(width,height).raw().toBuffer());
    }
    fs.writeFileSync(path.join(output,'frame-matches.json'),JSON.stringify(matches,null,2)); const alphaBytes=new Uint8Array(Buffer.concat(masks));
    return {ok:true,jobId:p.jobId,kind:'video',width,height,fps:p.fps,frames:masks.length,decodedFrameIndices:p.decodedFrameManifest.map(f=>f.decodedFrameIndex),decodedFrameManifest:p.decodedFrameManifest,timelineToDecodedFrameMap:p.timelineToDecodedFrameMap,alphaBytes,alphaEncoding:'u8-mask-v1',alphaByteLength:alphaBytes.byteLength};
  });
  ipcMain.handle('test-write',async(_,p)=>{
    const name=path.basename(p.fileName||p.path||'');assert(name);
    fs.writeFileSync(path.join(frames,name),Buffer.from(p.bytes));writes.push(name);if(writes.length%24===0)console.log('NF_TEST exported '+writes.length);return {ok:true};
  });
  const preload=path.join(output,'fixture-preload.cjs');
  fs.writeFileSync(preload,"window.testWrite=p=>require('electron').ipcRenderer.invoke('test-write',p);window.testAiMask=p=>require('electron').ipcRenderer.invoke('test-ai-mask',p);");
  const win=new BrowserWindow({show:false,width:1200,height:1500,webPreferences:{offscreen:true,sandbox:false,contextIsolation:false,preload,backgroundThrottling:false}});
  win.webContents.on('console-message',e=>{if(e.level==='error'||e.message.startsWith('NF_TEST'))console.log(e.message);});
  const html=path.join(output,'fixture.html');fs.writeFileSync(html,'<!doctype html><body><div id="test-root"></div><div id="preview" style="position:relative;width:736px;height:1280px"></div></body>');
  await win.loadFile(html);
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(root,'particle-editor/ai-sequence-green-screen-matting.js'),'utf8'));
  let source=fs.readFileSync(bundle,'utf8');
  const boot='(0,g.createRoot)(document.getElementById(`root`)).render((0,X.jsx)(_.StrictMode,{children:(0,X.jsx)(Ed,{})}));';
  assert(source.includes(boot));source=source.replace(boot,'window.nfCutoutTest={React:_,jsx:X.jsx,createRoot:g.createRoot,Dock:zt};');
  const mod=path.join(output,'fixture-bundle.mjs');fs.writeFileSync(mod,source);
  await win.webContents.executeJavaScript(`import(${JSON.stringify(pathToFileURL(mod).href)}).then(()=>true)`);
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const {React,jsx,createRoot,Dock}=window.nfCutoutTest;
    if(${!!aiMasks})window.electronAPI={aiSeqRembgBatch:p=>window.testAiMask({jobId:p.jobId,fps:p.fps,rendererFrameWidth:p.rendererFrameWidth,rendererFrameHeight:p.rendererFrameHeight,decodedFrameManifest:p.decodedFrameManifest,timelineToDecodedFrameMap:p.timelineToDecodedFrameMap,rendererDecodedFrames:p.rendererDecodedFrames})};
    const errors=[];console.error=(...a)=>errors.push(a.map(x=>String(x?.stack||x)).join(' '));window.alert=x=>errors.push(String(x));
    const video=document.createElement('video');video.muted=true;video.preload='auto';video.src=${JSON.stringify(pathToFileURL(input).href)};document.body.append(video);
    await new Promise((ok,no)=>{video.onloadeddata=ok;video.onerror=()=>no(Error('video decode failed'));});
    const w=video.videoWidth,h=video.videoHeight,fps=24,count=Math.round(video.duration*fps);
    let exporter=null;const register=x=>exporter=x;
    const helpers={pickDirectory:async()=>({dir:'test'}),writeBinaryFile:p=>window.testWrite({...p,bytes:Array.from(p.bytes||[])})};
    function Test(){const [enabled,setEnabled]=React.useState(false);const videoRef=React.useRef(video);
      return jsx(Dock,{videoRef,portalEl:document.getElementById('preview'),fileName:'green-screen.mp4',inputSourceKind:'video',durationSec:video.duration,
      previewW:w,previewH:h,exportW:w,exportH:h,exportScalePct:100,previewZoom:1,canvasPanX:0,canvasPanY:0,timeSec:0,playing:false,fps,sourceFps:fps,sourceFrames:count,keepDuration:false,playbackBaseFps:fps,previewBg:'gray',
      enabled,setEnabled,onExtractFrames:()=>{},setPreviewTimelinePlaying:()=>{},setAiSeqFrameMode:()=>{},frameModeActive:true,canEditFrame:true,registerBgExport:register,exportHelpers:helpers});}
    createRoot(document.getElementById('test-root')).render(jsx(Test,{}));
    const wait=async(f,label)=>{for(let i=0;i<4000;i++){if(f())return;if(i%250===0)console.log('NF_TEST waiting '+label+' '+document.body.innerText.slice(-140));await new Promise(r=>setTimeout(r,40));}throw Error('timeout '+label+' '+document.body.innerText.slice(-900)+' '+errors.join('\\n'));};
    const button=()=>Array.from(document.querySelectorAll('[role=button]')).find(n=>n.textContent===${aiMasks?"'AI抠图'":"'色键抠图'"});
    await wait(()=>button()&&button().getAttribute('aria-disabled')==='false','key button');button().click();
    await wait(()=>document.querySelector('[data-novaflow-green-screen-light-preserve]')?.getAttribute('data-novaflow-green-screen-active')==='1','green matting');
    await wait(()=>typeof exporter==='function','export registration');
    const startupErrors=${!!aiMasks}?errors.splice(0):[];
    await new Promise(r=>setTimeout(r,400));
    const canvas=document.querySelector('[data-novaflow-ai-cutout-edit-canvas]');
    const preview=canvas.toDataURL();const text=document.body.innerText;
    if(!${controlsOnly})await exporter({dir:'test',rawDir:true,finalAsset:true,silent:true,baseName:'clean'});
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
    return {w,h,fps,count,duration:video.duration,preview,text,startupErrors,errors,brush:{changed,soft,recovered,visible:!!panel?.getBoundingClientRect().height}};
  })()`);
  const {preview,...report}=result;
  fs.writeFileSync(path.join(output,'preview.png'),Buffer.from(preview.split(',')[1],'base64'));
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({...report,writes},null,2));
  assert.equal(writes.filter(x=>x.endsWith('.png')).length,controlsOnly?0:result.count,'must export all source frames');
  assert(result.text.includes('羽化'),'existing feather control must remain available');
  assert(result.brush.changed>0&&result.brush.soft>0&&result.brush.recovered>0&&result.brush.visible,'real visible erase, feather, and restore must work');
  assert(!result.errors.length,result.errors.join('\n'));
  assert(result.startupErrors.every(e=>e.includes('AI cutout missing timelineToDecodedFrameMap')),result.startupErrors.join('\n'));
  console.log(JSON.stringify({pass:true,...report,writes:writes.length}));win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
