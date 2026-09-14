import fs from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url), ts = require('../particle-editor-desktop/node_modules/typescript');

export function patchCutoutPrerender(source) {
  if (source.includes('nfParallelPrerenderV1')) return source;
  const replace = (before,after) => {
    if (source.indexOf(before)<0 || source.indexOf(before)!==source.lastIndexOf(before)) throw Error('Prerender anchor missing or ambiguous: '+before.slice(0,100));
    source=source.replace(before,after);
  };
  // A frame edit retains unrelated full-size entries. Global changes still clear all.
  replace('Xn=(e,n)=>{nfFinalFrames.current?.clear();let r=un.current;', 'Xn=(e,n)=>{let r=un.current;');
  replace('if(Number.isInteger(u)&&u>=0){let t=String(r.cacheKey||``)', 'if(Number.isInteger(u)&&u>=0){nfFinalFrames.current?.invalidateFrame(u);let t=String(r.cacheKey||``)');
  replace('Yn();return}}try{r.frameMap?.clear?.()}', 'Yn();return}}nfFinalFrames.current?.clear();try{r.frameMap?.clear?.()}');
  // Captured RGB is immutable and already frame-verified. It needs no video seek lock.
  // Independent output canvases keep concurrent frames from writing over one another.
  replace('qr=async(t,n,r,i,a,o,s,c)=>{let l=tn.current,u=nn.current;', 'qr=async(t,n,r,i,a,o,s,c,nfIsolated=!1)=>{let l=nfIsolated?document.createElement(`canvas`):tn.current,u=nfIsolated?document.createElement(`canvas`):nn.current;');
  replace('let nfSoftGreen=window.NovaFlowGreenScreenMatting?.render(t,', 'let nfSoftGreen=await (window.NovaFlowGreenScreenMatting?.renderAsync||window.NovaFlowGreenScreenMatting?.render)?.(t,');
  replace('await qr(u.frame,v.frameTimeSec,i.w,i.h,e.inputSourceKind,r,y,b)', 'await qr(u.frame,v.frameTimeSec,i.w,i.h,e.inputSourceKind,r,y,b,!!(R===`ai`&&C?.frame))');
  replace('await nr(!Rn&&r&&(r?.currentSrc||r?.src)?n?.cacheMedia||r:null,async()=>{', 'await nr(R===`ai`&&nfGreenScreen&&C?.frame?C.frame:!Rn&&r&&(r?.currentSrc||r?.src)?n?.cacheMedia||r:null,async()=>{if(nfFrameStore&&!n?.previewFrame&&nfCacheEpoch===nfFrameStore.epoch){const hit=await nfFrameStore.get(k);if(hit)return hit;}');
  const begin='for(let i=0;i<e.frames.length&&ln.current.token===n;i++){';
  const end='if(t||=a(),ln.current.token!==n)return;';
  const start=source.indexOf(begin), stop=source.indexOf(end,start);
  if(start<0||stop<start||source.indexOf(begin,start+1)>=0)throw Error('Prerender loop anchor changed');
  const old=source.slice(start,stop);
  replace(old, '/* nfParallelPrerenderV1 */const nfParallel=R===`ai`&&nfGreenScreen&&fe.current?.frames?.size?window.NovaFlowGreenScreenMatting.parallelism(Zn(r).w,Zn(r).h):1,nfStart=Math.max(0,e.frames.findIndex(f=>f>=Math.floor((Number(y)||0)*e.fps))),nfOrder=e.frames.slice(nfStart).concat(e.frames.slice(0,nfStart));for(let i=0;i<nfOrder.length&&ln.current.token===n;i+=nfParallel){Jn(i,nfOrder.length,`正在渲染预览`);const settled=await Promise.allSettled(nfOrder.slice(i,i+nfParallel).map(async(c)=>{if(ln.current.token!==n)return;let l=Array.isArray(e.times)&&Number.isFinite(Number(e.times[c]))?Math.max(0,Number(e.times[c])):Math.max(0,c/Math.max(1,e.fps));await rr({media:s,cacheMedia:R===`key`?r:void 0,sourceFrameIndex:c,timeSec:l,traceSurface:`preview`,previewFrame:!0,previewW:o.w,previewH:o.h,strictFrameSync:R===`key`});}));const nfFailed=settled.findIndex(v=>v.status===`rejected`);if(nfFailed>=0){nfPreviewFailedFrame=i+nfFailed+1;throw settled[nfFailed].reason}try{r?.pause?.()}catch{}if(ln.current.token!==n)break;Jn(Math.min(i+nfParallel,nfOrder.length),nfOrder.length,`正在渲染预览`);if(a()){t=!0;break}await new Promise(resolve=>window.setTimeout(resolve,0))}');
  const ast=ts.createSourceFile('bundle.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(ast.parseDiagnostics.length)throw Error('Invalid prerender patch');
  return source;
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replaceAll('\\','/'))){
  const file=new URL('../particle-editor/assets/index-BbIa-2NM.js',import.meta.url);
  fs.writeFileSync(file,patchCutoutPrerender(fs.readFileSync(file,'utf8')));
}
