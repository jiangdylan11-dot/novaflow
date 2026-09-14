import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), ts=require('../particle-editor-desktop/node_modules/typescript');
export function patchCutoutPerformance(source) {
  const replace=(before,after)=>{
    if(source.includes(after))return;
    if(!source.includes(before)||source.indexOf(before)!==source.lastIndexOf(before))throw Error('Cutout performance anchor missing or ambiguous: '+before.slice(0,110));
    source=source.replace(before,after);
  };
  // A visible independent decoder prevents timeline/preview seeks from racing
  // preparation, and arms RVFC before seeking instead of waiting after it fired.
  replace('let pe=async n=>{let i=window?.electronAPI;', 'let pe=async n=>{let nfCaptureReader=null;let i=window?.electronAPI;');
  replace('let h=t.current;if(!h)throw Error(`video element missing`);if(await Rt(h)', 'let h=t.current;if(!h)throw Error(`video element missing`);nfCaptureReader=await nfCreateCutoutExportReader(h);h=nfCaptureReader.media;if(await Rt(h)');
  replace('strict:!0,toleranceSec:T,frameSyncTimeoutMs:120,ensureReadyTimeoutMs:5e3,seekTimeoutMs:5e3', 'strict:!0,requireRvfcVerified:!0,toleranceSec:T,frameSyncTimeoutMs:1500,ensureReadyTimeoutMs:5e3,seekTimeoutMs:5e3');
  replace('W.current.delete(-1)}},me=', 'nfCaptureReader?.release?.();W.current.delete(-1)}},me=');
  replace('rendererFramesVersion:2,video:{fileName:f}', 'rendererFramesVersion:2,returnMaskOnly:!0,video:{fileName:f}');
  // Full diagnostic image encoding is opt-in. Identity/index checks below the
  // trace call remain mandatory in normal exports.
  replace('qn=async e=>{if(R!==`ai`)return;', 'qn=async e=>{if(R!==`ai`||window.__NOVAFLOW_AI_CUTOUT_DIAGNOSTICS__!==true)return;');
  replace('if(R===`ai`&&!n?.previewFrame)try{let e=window;', 'if(R===`ai`&&!n?.previewFrame&&window.__NOVAFLOW_AI_CUTOUT_DIAGNOSTICS__===true)try{let e=window;');
  replace('new ImageData(new Uint8ClampedArray(C.frame.data),i.w,i.h)', 'new ImageData(C.frame.data,i.w,i.h)');
  replace('new ImageData(new Uint8ClampedArray(C.frame.data),e.width,e.height)', 'new ImageData(C.frame.data,e.width,e.height)');
  // Export owns the cache while it runs. Stop any warmup and pause playback
  // before filling full-resolution frames, so preview cannot clear that cache.
  replace('let ni=async n=>{let i=t.current', 'let nfPauseCutoutPlayback=()=>{try{x?.(!1)}catch{}},ni=async n=>{let i=t.current');
  replace('En.current=!0,Sn.current+=1;let c=k&&', 'En.current=!0,Sn.current+=1;ln.current.token+=1;ln.current.running=!1;ln.current.key=``;Yn();nfPauseCutoutPlayback();try{i?.pause?.()}catch{}let c=k&&');
  replace('if(!N||!V||!b){try{let e=ln.current;', 'if(!N||!V||!b||En.current){if(!b)ln.current.failedKey=``;try{let e=ln.current;');
  replace('let e=ar();if(!e||e.ready)return;if(ln.current?.running)', 'let e=ar();if(!e||e.ready||ln.current.failedKey===e.key)return;if(ln.current?.running)');
  replace('catch(nfPreviewError){console.error(nfPreviewError),Jn(', 'catch(nfPreviewError){ln.current.failedKey=e.key;try{x?.(!1)}catch{}console.error(nfPreviewError),Jn(');
  const ast=ts.createSourceFile('bundle.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(ast.parseDiagnostics.length)throw Error('Invalid cutout performance patch');
  return source;
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replaceAll('\\','/'))) {
  const file=new URL('../particle-editor/assets/index-BbIa-2NM.js',import.meta.url);
  fs.writeFileSync(file,patchCutoutPerformance(fs.readFileSync(file,'utf8')));
}
