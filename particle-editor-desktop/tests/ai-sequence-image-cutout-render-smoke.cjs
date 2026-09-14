const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const sharp = require('sharp');

// Run the shipped React cutout component and its real canvas/export pipeline.
// Only segmentation IPC is substituted; --mask can replay a real backend PNG.
// --live routes Electron IPC through the production handler and installed model;
// the helper isolates app lifecycle/cleanup and its command wrapper.
const root = path.resolve(__dirname, '../..');
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const bundle = arg('--bundle') || path.join(root, 'particle-editor/assets/index-BbIa-2NM.js');
const output = path.resolve(arg('--output') || path.join(root, 'logs/image-cutout-smoke'));
const baseline = process.argv.includes('--baseline');
const green = process.argv.includes('--green');
const live = process.argv.includes('--live');
app.setPath('userData', path.join(output, 'electron-profile'));
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  const liveProgress = [];
  if (live) {
    const run = require('./helpers/cutout-live-backend.cjs').createLiveBackend(output);
    ipcMain.handle('cutout-image-live-test', async (event, payload) => run({ sender: { send: (_channel, progress) => { liveProgress.push(progress); event.sender.send('cutout-image-live-progress', progress); } } }, payload));
  }
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false, contextIsolation: false, nodeIntegration: live } });
  win.webContents.on('console-message', (event) => { if (event.level === 'error') console.error(event.message); });
  const html = path.join(output, 'fixture.html');
  fs.writeFileSync(html, '<!doctype html><html><body></body></html>');
  await win.loadFile(html);
  const mattingPath=path.resolve(path.dirname(bundle), '../ai-sequence-green-screen-matting.js');
  if(fs.existsSync(mattingPath))await win.webContents.executeJavaScript(fs.readFileSync(mattingPath,'utf8'));
  else assert(!green,'green-screen regression requires the bundled matting runtime');
  await win.webContents.executeJavaScript('document.body.innerHTML = `<div id="test-root"></div><div id="preview"></div>`');
  let source = fs.readFileSync(bundle, 'utf8');
  const boot = '(0,g.createRoot)(document.getElementById(`root`)).render((0,X.jsx)(_.StrictMode,{children:(0,X.jsx)(Ed,{})}));';
  assert(source.includes(boot));
  source = source.replace(boot, 'window.nfCutoutTest={React:_,jsx:X.jsx,createRoot:g.createRoot,Dock:zt};');
  if (baseline) source = source.replace(',timelineFrameCount:1,decodedFrameCount:1,alphaFrames:1,timelineToDecodedFrameMap:[0],decodedFrameManifest:[{decodedFrameIndex:0,representativeTimelineFrameIndex:0,mediaTime:0}]', '');
  const modulePath = path.join(output, 'fixture-bundle.mjs');
  fs.writeFileSync(modulePath, source);
  await win.webContents.executeJavaScript(`import(${JSON.stringify('file:///' + modulePath.replaceAll('\\', '/'))}).then(()=>true)`);
  let fixture = null;
  if (arg('--mask')) {
    const image = await sharp(arg('--input')).png().toBuffer();
    const { data, info } = await sharp(arg('--mask')).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    fixture = { image: image.toString('base64'), mask: data.toString('base64'), w: info.width, h: info.height };
  } else if (live && arg('--input')) {
    const image = await sharp(arg('--input')).png().toBuffer();
    const info = await sharp(image).metadata();
    fixture = { image: image.toString('base64'), w: info.width, h: info.height };
  }
  const result = await win.webContents.executeJavaScript(`(async()=>{
    const fixture=${JSON.stringify(fixture)};
    const {React,jsx,createRoot,Dock}=window.nfCutoutTest;
    const errors=[]; console.error=(...a)=>errors.push(a.map(x=>String(x?.stack||x)).join(' '));
    window.alert=x=>errors.push(String(x));
    const image=document.createElement('canvas'); image.width=96; image.height=80;
    const ctx=image.getContext('2d'); ctx.fillStyle=${green}?'rgb(4,179,21)':'#fff';ctx.fillRect(0,0,96,80);ctx.fillStyle='#e43828';ctx.fillRect(24,16,48,48);
    if(${green}){ctx.fillStyle='rgb(12,174,83)';ctx.fillRect(74,20,12,24);}
    const input=fixture?'data:image/png;base64,'+fixture.image:image.toDataURL();
    const w=fixture?.w||96,h=fixture?.h||80;
    const calls=[],files=[];let liveReturned=false;
    window.electronAPI={aiSeqRembgBatch:async p=>{
      calls.push({kind:p.kind,totalFrames:p.totalFrames,bytes:p.image?.bytes?.length});
      if(${live}){try{return await require('electron').ipcRenderer.invoke('cutout-image-live-test',p);}finally{liveReturned=true;}}
      const mask=fixture?Uint8Array.from(atob(fixture.mask),x=>x.charCodeAt(0)):new Uint8Array(w*h);
      if(!fixture)for(let y=16;y<64;y++)for(let x=24;x<72;x++)mask[y*w+x]=255;
      let binary='';for(const b of mask)binary+=String.fromCharCode(b);
      return {ok:true,jobId:p.jobId,kind:'image',width:w,height:h,frames:1,fps:30,sourceFrameIndices:[0],alphaBase64:btoa(binary)};
    },onAiSeqRembgBatchProgress:cb=>{
      if(!${live})return ()=>{};
      const ipc=require('electron').ipcRenderer,fn=(_e,p)=>cb(p);
      ipc.on('cutout-image-live-progress',fn);return ()=>ipc.removeListener('cutout-image-live-progress',fn);
    }};
    let exporter=null;
    const register=x=>exporter=x;
    function Test(){const [enabled,setEnabled]=React.useState(false);const videoRef=React.useRef(null);
      return jsx(Dock,{videoRef,portalEl:document.getElementById('preview'),fileName:'cutout-test.png',inputImageDataUrl:input,inputImageSize:{w,h},inputSourceKind:'image',durationSec:0,
        previewW:w,previewH:h,exportW:w,exportH:h,exportScalePct:100,previewZoom:1,canvasPanX:0,canvasPanY:0,timeSec:0,playing:false,fps:30,sourceFps:30,sourceFrames:1,keepDuration:false,playbackBaseFps:30,previewBg:'black',
        enabled,setEnabled,onExtractFrames:()=>{},setPreviewTimelinePlaying:()=>{},setAiSeqFrameMode:()=>{},frameModeActive:false,canEditFrame:true,registerBgExport:register,exportHelpers:{pickDirectory:async()=>({dir:'test'}),writeBinaryFile:async p=>{files.push({...p,bytes:Array.from(p.bytes||[])});return {ok:true}}}});}
    createRoot(document.getElementById('test-root')).render(jsx(Test,{}));
    const wait=async f=>{for(let i=0;i<150;i++){if(f())return;await new Promise(r=>setTimeout(r,40));}throw Error('timeout '+document.body.innerText.slice(-500));};
    const button=()=>Array.from(document.querySelectorAll('[role=button]')).find(n=>['AI抠图','视频抠图'].includes(n.textContent));
    await wait(()=>button()&&button().getAttribute('aria-disabled')==='false');button().click();
    await wait(()=>calls.length===1);
    if(${live}){
      for(let n=0;n<1800;n++){
        if(liveReturned||errors.length)break;
        await new Promise(r=>setTimeout(r,100));
      }
      if(!liveReturned)throw Error('live segmentation did not return');
    }
    await new Promise(r=>setTimeout(r,800));
    const canvas=document.querySelector('[data-novaflow-ai-cutout-edit-canvas]');
    const pixels=canvas.getContext('2d').getImageData(0,0,w,h).data;
    let opaque=0,transparent=0,colored=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]>10){opaque++;if(pixels[i]+pixels[i+1]+pixels[i+2]>30)colored++;}else transparent++;}
    const preview=canvas.toDataURL();
    const overlay=document.getElementById('novaflow-ai-rembg-overlay-root');
    const overlayVisible=!!overlay&&getComputedStyle(overlay).display!=='none';
    const previewErrors=errors.splice(0);
    if(!${baseline}){await exporter({dir:'test',rawDir:true,finalAsset:true,silent:true,baseName:'image-cutout'});}
    const glowPixel=Array.from(pixels.slice((30*w+80)*4,(30*w+80)*4+4));
    return {calls,previewErrors,errors,opaque,transparent,colored,width:w,height:h,preview,files,glowPixel,overlayVisible};
  })()`);
  const { preview, files, ...summary } = result;
  if (live) {
    summary.liveProgress = liveProgress;
    assert(liveProgress.some(p => /已等待 [1-9]/.test(p.message)), 'live inference must report elapsed time');
  }
  fs.writeFileSync(path.join(output, baseline ? 'before.png' : 'after.png'), Buffer.from(preview.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(output, baseline ? 'before.json' : 'after.json'), JSON.stringify({ ...summary, files: files.map(f => ({ ...f, bytes: f.bytes.length })) }, null, 2));
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].kind, 'image');
  if (baseline) {
    assert(result.previewErrors.some(e => e.includes('missing timelineToDecodedFrameMap')));
    assert.equal(result.transparent, 0, 'failed composition leaves the pre-cutout canvas unchanged');
  } else {
    assert.equal(result.previewErrors.length, 0, 'preview must complete without errors');
    assert(!result.overlayVisible, 'AI progress overlay must close after the image returns');
    assert(result.colored > 0, 'cutout must contain visible source RGB');
    assert(result.transparent > 0, 'cutout must contain transparent background');
    if(green)assert(result.glowPixel[3]>0&&result.glowPixel[3]<255&&result.glowPixel[2]>220,'AI path must preserve glow even outside the segmentation mask');
    assert(!result.errors.some(e => e.includes('missing timelineToDecodedFrameMap')));
    assert(files.length > 0, 'PNG export must write a result');
    const png = files.find(f => /\.png$/i.test(f.fileName || f.path || '')) || files[0];
    const bytes = Buffer.from(png.bytes);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, result.width); assert.equal(metadata.height, result.height); assert(metadata.hasAlpha);
    const stats = await sharp(bytes).stats(); assert(stats.channels[3].min < 255); assert(stats.channels[3].max > 0);
    fs.writeFileSync(path.join(output, 'export.png'), bytes);
  }
  console.log(JSON.stringify({ pass: true, baseline, ...summary, exportFiles: files.length }));
  win.destroy(); app.quit();
}).catch(e => { console.error(e); app.exit(1); });
