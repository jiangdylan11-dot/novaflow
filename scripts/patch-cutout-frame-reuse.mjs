import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('../particle-editor-desktop/node_modules/typescript');
export function patchCutoutFrameReuse(source) {
  const replace=(before,after)=>{
    if(source.includes(after))return;
    if(source.indexOf(before)<0||source.indexOf(before)!==source.lastIndexOf(before))throw Error('Frame reuse anchor missing or ambiguous: '+before.slice(0,100));
    source=source.replace(before,after);
  };
  replace('un=(0,_.useRef)({status:', 'nfFinalFrames=(0,_.useRef)(null),un=(0,_.useRef)({status:');
  replace('Xn=(e,n)=>{let r=un.current;', 'Xn=(e,n)=>{nfFinalFrames.current?.clear();let r=un.current;');
  replace('e&&e!==yr&&_r(e),U.current.clear(),W.current.clear(),G.current=null,', 'e&&e!==yr&&_r(e),K.current=`source_${yr}`,fe.current=null,Xn(`dirty`),nfSetGreenScreenActive(!1),U.current.clear(),W.current.clear(),G.current=null,');
  replace('if(N&&!V&&nfCutoutMode===mode){H(!0);return}', 'if(N&&!V&&nfCutoutMode===mode){H(!0);if((mode===`ai`||nfGreenScreen)&&(!G.current||!U.current.size)){const{cap}=ci();nfStartCutoutSubject(cap);}return}');
  replace('K.current===o&&oe({state:`error`,message:String(e?.message||e||`AI分割失败`)})', 'K.current===o&&(H(!1),P(!1),nfSetGreenScreenActive(!1),x?.(!1),oe({state:`error`,message:String(e?.message||e||`AI分割失败`)}))');
  replace('children:[si,null,(0,X.jsxs)(`div`,{onChangeCapture:wi', 'children:[si,q?.state===`error`&&(0,X.jsx)(`div`,{role:`alert`,"data-novaflow-cutout-error":"1",style:{margin:`10px 14px`,padding:10,color:`#fecaca`,background:`rgba(127,29,29,.25)`,borderRadius:8,fontSize:12},children:`AI 抠图失败，已恢复原视频：${q.message||`请重试`}` }),(0,X.jsxs)(`div`,{onChangeCapture:wi');
  replace('rr=async n=>{if(!N||!V)', 'rr=async n=>{nfFinalFrames.current ||= window.NovaFlowGreenScreenMatting?.createFrameCache?.();const nfFrameStore=R===`ai`?nfFinalFrames.current:null,nfCacheEpoch=nfFrameStore?.epoch;if(!N||!V)');
  replace('A=un.current;if(A.frameMap||=', 'A=nfFrameStore&&!n?.previewFrame?{...un.current,frameMap:new Map,cacheKey:``,bytes:0}:un.current;if(nfFrameStore&&!n?.previewFrame){const hit=await nfFrameStore.get(k);if(hit){Wn(y,hit.alphaFrameIndex??T,hit.cacheFrameIndex??T,v.frameTimeSec,hit.sourceReadTimeSec??v.frameTimeSec,hit.representativeTimelineFrameIndex??y);return hit;}}if(A.frameMap||=');
  replace('return A.status=`building`,await nr(', 'if(nfFrameStore&&n?.previewFrame){const full=await rr({...n,previewFrame:!1}),canvas=document.createElement(`canvas`),scaled=document.createElement(`canvas`);canvas.width=full.width;canvas.height=full.height;scaled.width=i.w;scaled.height=i.h;canvas.getContext(`2d`).putImageData(full.imageData,0,0);scaled.getContext(`2d`).drawImage(canvas,0,0,i.w,i.h);const item={...full,key:k,width:i.w,height:i.h,imageData:scaled.getContext(`2d`).getImageData(0,0,i.w,i.h)};if(A.version===F&&A.cacheKey===O){A.frameMap.set(T,item);A.bytes=(A.bytes||0)+M;A.readyFrameCount=A.frameMap.size;A.status=A.readyFrameCount>=A.frameCount?`ready`:`building`;}return item;}return A.status=`building`,await nr(');
  replace('return A.version!==F||A.cacheKey!==O?m:', 'if(nfFrameStore&&!n?.previewFrame)await nfFrameStore.put(k,m,nfCacheEpoch);return A.version!==F||A.cacheKey!==O?m:');
  replace('exportMedia:!0});if(K.clearRect(', 'exportMedia:!0});if(ce===`save-and-close`&&r.cacheHit)window.dispatchEvent(new CustomEvent(`novaflow:cutout-save-progress`,{detail:{stage:`reuse`,current:t+1,total:A.length}}));if(K.clearRect(');
  const ast=ts.createSourceFile('bundle.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(ast.parseDiagnostics.length)throw Error('Invalid frame reuse patch');
  return source;
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replaceAll('\\','/'))) {
  const file=new URL('../particle-editor/assets/index-BbIa-2NM.js',import.meta.url);
  fs.writeFileSync(file,patchCutoutFrameReuse(fs.readFileSync(file,'utf8')));
}
