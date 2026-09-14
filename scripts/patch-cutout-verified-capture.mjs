import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('../particle-editor-desktop/node_modules/typescript');
export function patchVerifiedCapture(source){
 const replace=(before,after)=>{if(source.includes(after))return;if(source.indexOf(before)<0||source.indexOf(before)!==source.lastIndexOf(before))throw Error('Verified capture anchor missing/ambiguous: '+before.slice(0,100));source=source.replace(before,after);};
 replace('nfArmVerifiedVideoFrame=(e,t,n,r)=>{','nfArmVerifiedVideoFrame=(e,t,n,r,capture)=>{');
 replace('l.verified?d(l):f()','l.verified?(()=>{try{if(capture){l.capturedFrame=capture();if(!l.capturedFrame?.canvas)throw Error(`verified frame snapshot unavailable`);}d(l)}catch(error){d({...l,verified:!1,error:String(error?.message||error)})}})():f()');
 replace('v=nfArmVerifiedVideoFrame(e,s,c,l)','v=nfArmVerifiedVideoFrame(e,s,c,l,typeof n?.captureFrame===`function`?n.captureFrame:null)');
 replace('let f=Number(e.currentTime)||0,p=e.readyState>=2;', 'let nfCaptureTail=!1;if(typeof n?.captureFrame===`function`&&n?.requireRvfcVerified&&(e.ended||n?.captureTailFrame)&&s>0){v?.cancel?.();await wt(e,Math.max(0,s-Math.max(.001,c*2)),n);await u();v=nfArmVerifiedVideoFrame(e,s,c,l,n.captureFrame);nfCaptureTail=!0;}let f=Number(e.currentTime)||0,p=e.readyState>=2;');
 replace('if(n?.strict&&(!p||Math.abs(f-s)>c)){v?.cancel?.();', 'if(n?.strict&&(!p||Math.abs(f-s)>c&&!nfCaptureTail)){v?.cancel?.();');
 replace('if(r&&(r.rvfcMs=i()),n?.strict&&Math.abs(h-s)>c)', 'if(r&&(r.rvfcMs=i()),n?.strict&&Math.abs(h-s)>c&&!(n?.captureFrame&&m?.verified&&m?.capturedFrame?.canvas))');
 replace('frameCallbackVerified:!!m?.verified,fallbackCurrentTimeVerified:!!m?.fallbackCurrentTimeVerified}}', 'frameCallbackVerified:!!m?.verified,fallbackCurrentTimeVerified:!!m?.fallbackCurrentTimeVerified,capturedFrame:m?.capturedFrame||null}}');
 replace('i=await Lt(h,r,{strict:!0,requireRvfcVerified:!0,toleranceSec:T', 'i=await Lt(h,r,{strict:!0,requireRvfcVerified:!0,captureFrame:()=>Wr(h,g,_,!0),captureTailFrame:e===y.length-1,toleranceSec:T');
 replace('if(!Number.isFinite(a)||Math.abs(a-r)>T)throw Error(`AI renderer frame seek mismatch', 'if(!i?.capturedFrame?.canvas||!i?.frameCallbackVerified||!Number.isFinite(s)||Math.abs(s-r)>T)throw Error(`AI renderer frame seek mismatch');
 replace('let c=Wr(h,g,_);if(!c?.canvas)throw Error(`AI renderer frame capture failed', 'let c=i.capturedFrame;if(!c?.canvas)throw Error(`AI renderer frame capture failed');
 replace('let nfPauseCutoutPlayback=()=>', 'let nfReleaseCutoutSource=()=>{e.setAiSeqFrameMode?.(!1)},nfPauseCutoutPlayback=()=>');
 replace('K.current===o&&(H(!1),P(!1),nfSetGreenScreenActive(!1),x?.(!1)', 'K.current===o&&(H(!1),P(!1),nfReleaseCutoutSource(),nfSetGreenScreenActive(!1),x?.(!1)');
 replace('nfSetGreenScreenActive(!1),x?.(!1),oe({state:`error`,message:String(e?.message||e||`AI分割失败`)}))', 'nfSetGreenScreenActive(!1),x?.(!1),oe({state:`error`,message:String(e?.message||e||`AI分割失败`)}),window.dispatchEvent(new CustomEvent(`novaflow:cutout-failed`,{detail:{message:String(e?.message||e||`AI分割失败`)}})))');
 const ast=ts.createSourceFile('bundle.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);if(ast.parseDiagnostics.length)throw Error('Invalid verified capture patch');return source;
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replaceAll('\\','/'))){const file=new URL('../particle-editor/assets/index-BbIa-2NM.js',import.meta.url);fs.writeFileSync(file,patchVerifiedCapture(fs.readFileSync(file,'utf8')));}
