const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {app,BrowserWindow}=require('electron');
const sharp=require('sharp');
const root=path.resolve(__dirname,'../..'),output=path.join(root,'logs/shadow-toggle-20260913/ui');
app.setPath('userData',path.join(output,'profile'));
app.whenReady().then(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const input=path.join(root,'logs/cutout-four-video-20260913/gloweyes/source/frame_0000.png');
 const maskfile=path.join(root,'logs/cutout-four-video-20260913/gloweyes/mask/frame_0000.png');
 const image=await sharp(input).resize(540,960).png().toBuffer();
 const mask=await sharp(maskfile).extractChannel(3).resize(540,960).raw().toBuffer();
 const win=new BrowserWindow({show:false,width:1180,height:1100,webPreferences:{sandbox:false,contextIsolation:false,backgroundThrottling:false}});
 const html=path.join(output,'fixture.html');fs.writeFileSync(html,'<!doctype html><body style="background:#222;color:white"><div id="test-root"></div><div id="preview" style="position:relative;width:540px;height:960px"></div></body>');await win.loadFile(html);
 const live='http://127.0.0.1:4783/';
 const offline=process.argv.includes('--offline-runtime'),runtime=path.join(root,'particle-editor-desktop/dist/win-unpacked/resources/app/renderer');
 const [bundle,matting]=offline?[fs.readFileSync(path.join(runtime,'assets/index-BbIa-2NM.js'),'utf8'),fs.readFileSync(path.join(runtime,'ai-sequence-green-screen-matting.js'),'utf8')]:await Promise.all([fetch(live+'assets/index-BbIa-2NM.js').then(r=>{assert(r.ok);return r.text();}),fetch(live+'ai-sequence-green-screen-matting.js').then(r=>{assert(r.ok);return r.text();})]);
 assert(bundle.includes('nf_cutout_preserve_shadow'));assert(matting.includes('removeShadowAlpha'));
 await win.webContents.executeJavaScript(matting);
 // Exercise the installed desktop's actual CSS and row layout decorator. Its
 // inline display:grid!important used to override the component-only hiding.
 const brand=fs.readFileSync(path.join(runtime,'novaflow-brand-runtime.js'),'utf8');
 const brandBoot=brand.lastIndexOf('  bootstrapEarlyRuntime();');assert(brandBoot>0);
 await win.webContents.executeJavaScript(brand.slice(0,brandBoot)+'window.nfCutoutDesktopLayout={ensureStyle,styleAiAnimationCutoutParameterLayout};})();');
 await win.webContents.executeJavaScript('document.body.classList.add("novaflow-ai-animation-section-layers","novaflow-ai-bottom-workspace-active");window.nfCutoutDesktopLayout.ensureStyle();');
 const boot='(0,g.createRoot)(document.getElementById(`root`)).render((0,X.jsx)(_.StrictMode,{children:(0,X.jsx)(Ed,{})}));';assert(bundle.includes(boot));
 const mod=path.join(output,'runtime-bundle.mjs');fs.writeFileSync(mod,bundle.replace(boot,'window.nfCutoutTest={React:_,jsx:X.jsx,createRoot:g.createRoot,Dock:zt};'));
 await win.webContents.executeJavaScript(`import(${JSON.stringify(pathToFileURL(mod).href)}).then(()=>true)`);
 const result=await win.webContents.executeJavaScript(`(async()=>{
  localStorage.removeItem('nf_cutout_preserve_shadow');localStorage.removeItem('nf_green_screen_light_preserve');
  const {React,jsx,createRoot,Dock}=window.nfCutoutTest,errors=[],startupErrors=[],files=[];
  console.error=(...a)=>errors.push(a.map(String).join(' '));window.alert=x=>errors.push(String(x));
  const image='data:image/png;base64,${image.toString('base64')}',maskBase64='${mask.toString('base64')}';
  let exporter=null,phase='on',calls=0,epoch=0;
  const register=x=>exporter=x;
  window.electronAPI={aiSeqRembgBatch:async p=>{calls++;return{ok:true,jobId:p.jobId,kind:'image',width:540,height:960,frames:1,fps:24,sourceFrameIndices:[0],alphaBase64:maskBase64};}};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(fn,label)=>{for(let i=0;i<250;i++){if(fn())return;await sleep(40);}throw Error('timeout '+label+' '+errors.join(' | '));};
  function Test(){const [enabled,setEnabled]=React.useState(false),videoRef=React.useRef(null);return jsx(Dock,{videoRef,portalEl:document.getElementById('preview'),fileName:'Gloweyes.png',inputImageDataUrl:image,inputImageSize:{w:540,h:960},inputSourceKind:'image',durationSec:0,previewW:540,previewH:960,exportW:540,exportH:960,exportScalePct:100,previewZoom:1,canvasPanX:0,canvasPanY:0,timeSec:0,playing:false,fps:24,sourceFps:24,sourceFrames:1,keepDuration:false,playbackBaseFps:24,previewBg:'gray',enabled,setEnabled,onExtractFrames:()=>{},setPreviewTimelinePlaying:()=>{},setAiSeqFrameMode:()=>{},frameModeActive:false,canEditFrame:true,registerBgExport:register,exportHelpers:{pickDirectory:async()=>({dir:'test'}),writeBinaryFile:async p=>{files.push({phase,name:p.fileName||p.path,bytes:Array.from(p.bytes||[])});return{ok:true};}}});}
  const reactRoot=createRoot(document.getElementById('test-root'));
  const mount=async()=>{const start=errors.length;reactRoot.render(jsx(Test,{},String(epoch++)));await wait(()=>Array.from(document.querySelectorAll('[role=button]')).some(n=>n.textContent==='AI抠图'&&n.getAttribute('aria-disabled')==='false'),'AI button');Array.from(document.querySelectorAll('[role=button]')).find(n=>n.textContent==='AI抠图').click();await wait(()=>document.querySelector('[data-novaflow-green-screen-light-preserve]')?.getAttribute('data-novaflow-green-screen-active')==='1','processed');await sleep(300);startupErrors.push(...errors.splice(start));};
  await mount();
  const controls=()=>{for(const n of document.querySelectorAll('[data-novaflow-soft-green-active],[data-novaflow-manual-brush]'))n.setAttribute('data-novaflow-ai-cutout-detail','1');window.nfCutoutDesktopLayout.styleAiAnimationCutoutParameterLayout(document.body);return{light:document.querySelector('[data-novaflow-green-screen-light-preserve]').getAttribute('aria-checked'),manualMounted:!!document.querySelector('[data-novaflow-soft-green-active]'),legacySliders:document.querySelectorAll('[data-novaflow-soft-green-active] input[type=range]').length,brushVisible:[...document.querySelectorAll('[data-novaflow-manual-brush] input[type=range]')].filter(n=>n.getClientRects().length).length,helpCount:document.querySelectorAll('[data-novaflow-screen-light-help]').length};};
  const automaticControls=controls();
  const button=()=>document.querySelector('[data-novaflow-shadow-preserve]');const canvas=()=>document.querySelector('[data-novaflow-ai-cutout-edit-canvas]');
  const pixels=()=>canvas().getContext('2d').getImageData(0,0,540,960).data;
  const eq=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
  const initial=button().getAttribute('aria-checked'),role=button().getAttribute('role'),before=pixels(),onPng=canvas().toDataURL();
  phase='on';await exporter({dir:'test',rawDir:true,finalAsset:true,silent:true,baseName:'shadow-on'});
  button().click();await wait(()=>button().getAttribute('aria-checked')==='false'&&!eq(before,pixels()),'off refreshed preview');await sleep(200);
  const after=pixels(),offPng=canvas().toDataURL();let removed=0,protectedChanged=0;
  const originalMask=Uint8Array.from(atob(maskBase64),x=>x.charCodeAt(0));
  for(let p=0;p<originalMask.length;p++){if(after[p*4+3]<before[p*4+3])removed++;if(originalMask[p]>100&&after[p*4+3]!==before[p*4+3])protectedChanged++;}
  phase='off';await exporter({dir:'test',rawDir:true,finalAsset:true,silent:true,baseName:'shadow-off'});
  button().click();await wait(()=>button().getAttribute('aria-checked')==='true'&&eq(before,pixels()),'on restores cached result');
  button().click();await wait(()=>localStorage.getItem('nf_cutout_preserve_shadow')==='false','persist');
  await mount();const persisted=button().getAttribute('aria-checked');
  document.querySelector('[data-novaflow-green-screen-light-preserve]').click();await wait(()=>document.querySelector('[data-novaflow-green-screen-light-preserve]').getAttribute('aria-checked')==='false','light mode off');await sleep(500);const legacyState=button().getAttribute('aria-checked'),manualControls=controls();
  phase='legacy-off';await exporter({dir:'test',rawDir:true,finalAsset:true,silent:true,baseName:'legacy-off'});
  const lightAfterExport=document.querySelector('[data-novaflow-green-screen-light-preserve]').getAttribute('aria-checked');
  document.querySelector('[data-novaflow-green-screen-light-preserve]').click();await wait(()=>document.querySelector('[data-novaflow-green-screen-light-preserve]').getAttribute('aria-checked')==='true','automatic mode restored');await sleep(300);const restoredControls=controls();
  return{automaticControls,manualControls,restoredControls,initial,role,persisted,legacyState,lightAfterExport,removed,protectedChanged,onPng,offPng,files,errors,startupErrors,calls,body:document.body.innerText};
 })()`);
 const {onPng,offPng,files,...report}=result;
 fs.writeFileSync(path.join(output,'on.png'),Buffer.from(onPng.split(',')[1],'base64'));fs.writeFileSync(path.join(output,'off.png'),Buffer.from(offPng.split(',')[1],'base64'));
 for(const f of files.filter(f=>String(f.name).endsWith('.png')))fs.writeFileSync(path.join(output,f.phase+'-export.png'),Buffer.from(f.bytes));
 const comparisons=[];
 for(const p of ['on','off']){const a=await sharp(path.join(output,p+'.png')).ensureAlpha().raw().toBuffer();const b=await sharp(path.join(output,p+'-export.png')).ensureAlpha().raw().toBuffer();let sum=0,maxAlpha=0;for(let i=0;i<a.length;i++){sum+=Math.abs(a[i]-b[i]);if(i%4===3)maxAlpha=Math.max(maxAlpha,Math.abs(a[i]-b[i]));}comparisons.push({phase:p,mae:sum/a.length,maxAlpha});assert(maxAlpha<=1&&sum/a.length<1,'preview/export mismatch');}
 assert.equal(result.initial,'true');assert.equal(result.role,'switch');assert.equal(result.persisted,'false');assert.equal(result.legacyState,'false');assert(result.removed>100);assert.equal(result.protectedChanged,0);assert.equal(result.errors.length,0,result.errors.join('\n'));
 assert(result.startupErrors.every(e=>e.includes('AI cutout missing timelineToDecodedFrameMap')),result.startupErrors.join('\n'));
 assert.equal(result.lightAfterExport,'false','export must not reset independent light control');
 for(const state of [result.automaticControls,result.restoredControls]){assert.equal(state.light,'true');assert.equal(state.manualMounted,false);assert.equal(state.legacySliders,0);assert.equal(state.brushVisible,2);assert.equal(state.helpCount,0);}
 assert(result.manualControls.legacySliders>0);assert.equal(result.manualControls.brushVisible,2);assert.equal(result.manualControls.helpCount,0);
 await win.webContents.capturePage().then(im=>fs.writeFileSync(path.join(output,'controls.png'),im.toPNG()));
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({pass:true,loadedFrom:offline?runtime:live,lockedEntryTested:!offline,...report,comparisons,exportFiles:files.map(f=>({phase:f.phase,name:f.name,bytes:f.bytes.length}))},null,2));
 console.log(JSON.stringify({pass:true,removed:result.removed,protectedChanged:result.protectedChanged,persisted:result.persisted,comparisons}));win.destroy();app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
