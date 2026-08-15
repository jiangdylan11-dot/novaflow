import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleGitPath = "particle-editor/assets/index-BbIa-2NM.js";
const bundlePath = path.join(repoRoot, ...bundleGitPath.split("/"));
const verifyHeadReplay = process.argv.includes("--verify-head-replay");
const diskSource = fs.readFileSync(bundlePath, "utf8");
let source = verifyHeadReplay
  ? execFileSync("git", ["show", `HEAD:${bundleGitPath}`], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    })
  : diskSource;
let changed = false;

function replaceExact(label, before, after) {
  if (source.includes(after)) {
    if (source.includes(before)) throw new Error(`${label}: both old and new forms are present`);
    return;
  }
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source anchor not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: source anchor is ambiguous`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
  changed = true;
}

function replaceLegacyExact(label, before, after) {
  if (!source.includes(before)) return;
  if (source.includes(after)) throw new Error(`${label}: both legacy and current forms are present`);
  const first = source.indexOf(before);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: legacy anchor is ambiguous`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
  changed = true;
}

replaceExact(
  "AI sequence cutout output canvas identity",
  "(0,X.jsx)(`canvas`,{ref:en,onPointerDown:e=>{zr(e)||Zr(e)}",
  "(0,X.jsx)(`canvas`,{ref:en,width:Z(p,16,4096),height:Z(m,16,4096),\"data-novaflow-ai-cutout-edit-canvas\":`1`,onPointerDown:e=>{zr(e)||Zr(e)}"
);

replaceExact(
  "AI sequence cutout brush cursor identity",
  "(0,X.jsx)(`div`,{ref:Bt,style:{position:`absolute`,left:Math.max(0,Number(tt.px)||0)-Math.max(1,Number(tt.r)||1)",
  "(0,X.jsx)(`div`,{ref:Bt,\"data-novaflow-ai-cutout-brush-cursor\":`1`,style:{position:`absolute`,left:Math.max(0,Number(tt.px)||0)-Math.max(1,Number(tt.r)||1)"
);

replaceExact(
  "AI sequence cutout targeted preview cache invalidation",
  "Xn=e=>{let t=un.current;if(t){try{t.frameMap?.clear?.()}catch{}t.status=e||`dirty`,t.version=Z(Number(t.version)||0,0,2147483647)+1,t.cacheKey=``,t.tool=null,t.sourceId=``,t.width=0,t.height=0,t.fps=0,t.duration=0,t.frameCount=0,t.readyFrameCount=0,t.error=null,t.bytes=0;try{ln.current.token+=1,ln.current.running=!1,ln.current.key=``}catch{}try{let e=window.__NOVAFLOW_CUTOUT_PREVIEW_WARMUP__;e?.running?.clear?.(),e?.done?.clear?.()}catch{}Yn()}}",
  "Xn=(e,n)=>{let r=un.current;if(r){if(n?.scope===`frame`){let i=G.current||{},o=Z(Number(i?.fps)||w||30,1,120),s=Math.max(.01,Number(i?.duration)||Number(a)||Number(t.current?.duration)||.01),c=Z(Number(i?.timelineFrameCount??i?.frames??U.current.size)||Math.max(1,Math.round(Math.max(.001,s)*o)),1,1e6),l=R===`ai`&&Array.isArray(i?.times)?i.times:null,u=Un({timeSec:Math.max(0,Number(n?.t)||0)/1e3,fps:o,duration:s,frameCount:c,frameTimes:l}).sourceFrameIndex;if(R===`ai`){let e=i?.timelineToDecodedFrameMap,t=Array.isArray(e)?e[u]:e?.[String(u)]??e?.[u];u=Number(t)}if(Number.isInteger(u)&&u>=0){let t=String(r.cacheKey||``),i=r.frameMap?.get?.(u);try{r.frameMap?.delete?.(u)}catch{}r.status=e||`dirty`,r.version=Z(Number(r.version)||0,0,2147483647)+1,r.readyFrameCount=r.frameMap?.size||0,r.error=null,i&&(r.bytes=Math.max(0,(r.bytes||0)-(Number(i?.width)||r.width||0)*(Number(i?.height)||r.height||0)*4));try{ln.current.token+=1,ln.current.running=!1,ln.current.key=``}catch{}try{let e=window.__NOVAFLOW_CUTOUT_PREVIEW_WARMUP__;t&&(e?.running?.delete?.(t),e?.done?.delete?.(t))}catch{}Yn();return}}try{r.frameMap?.clear?.()}catch{}r.status=e||`dirty`,r.version=Z(Number(r.version)||0,0,2147483647)+1,r.cacheKey=``,r.tool=null,r.sourceId=``,r.width=0,r.height=0,r.fps=0,r.duration=0,r.frameCount=0,r.readyFrameCount=0,r.error=null,r.bytes=0;try{ln.current.token+=1,ln.current.running=!1,ln.current.key=``}catch{}try{let e=window.__NOVAFLOW_CUTOUT_PREVIEW_WARMUP__;e?.running?.clear?.(),e?.done?.clear?.()}catch{}Yn()}}"
);

replaceLegacyExact(
  "AI sequence cutout cache key keeps manual edits frame scoped",
  ",ie,ut,Fn,ye,s,De,ke,je,Ne,Y,Be,Ie,Re,He].join(`|`)",
  ",ie,Fn,ye,s,De,ke,je,Ne,Y,Be,Ie,Re,He].join(`|`)"
);

replaceExact(
  "AI sequence cutout stroke invalidates once with scope",
  "let t=Er(e),n=Mn.current;if(Mn.current=!1,Dn.current=null,t||n){if(Sn.current+=1,Xn(`dirty`),An.current)",
  "let t=Er(e),n=Mn.current,r=e[e.length-1]||Dn.current;if(Mn.current=!1,Dn.current=null,t||n){if(Sn.current+=1,Xn(`dirty`,r?{scope:r.scope||(r.t===-1?`global`:`frame`),t:r.t}:void 0),An.current)"
);

replaceExact(
  "AI sequence cutout pointerdown avoids full preview cache clear",
  "e.preventDefault(),e.stopPropagation(),Sn.current+=1,Xn(`dirty`),$e",
  "e.preventDefault(),e.stopPropagation(),Sn.current+=1,$e"
);

replaceExact(
  "AI sequence cutout global history has one owner",
  "if(qe)try{let e=Cr(t,n),r=e.getContext(`2d`);if(r){let t=r.getImageData(0,0,e.width,e.height);qt.current.push(t),qt.current.length>40&&qt.current.shift(),Jt.current.push({scope:`global`,t:-1,img:t}),Jt.current.length>40&&Jt.current.shift()}}catch{}else",
  "if(qe)try{let e=Cr(t,n),r=e.getContext(`2d`);if(r){let t=r.getImageData(0,0,e.width,e.height);Jt.current.push({scope:`global`,t:-1,img:t}),Jt.current.length>40&&Jt.current.shift()}}catch{}else"
);

replaceExact(
  "AI sequence cutout frame history has one owner",
  "else{Gt.current.tKey!==r&&(Gt.current={tKey:r,stack:[]});try{let e=Sr(r,t,n),i=e.getContext(`2d`);if(i){let t=i.getImageData(0,0,e.width,e.height);Gt.current.stack.push(t),Gt.current.stack.length>40&&Gt.current.stack.shift(),Jt.current.push({scope:`frame`,t:r,img:t}),Jt.current.length>40&&Jt.current.shift()}}catch{}}(async()=>",
  "else{Gt.current.tKey!==r&&(Gt.current={tKey:r,stack:[]});try{let e=Sr(r,t,n),i=e.getContext(`2d`);if(i){let t=i.getImageData(0,0,e.width,e.height);Jt.current.push({scope:`frame`,t:r,img:t}),Jt.current.length>40&&Jt.current.shift()}}catch{}}(async()=>"
);

replaceExact(
  "AI sequence cutout undo uses scoped invalidation",
  "ti=()=>{let e=Jt.current.pop();if(!e)return;if(e.scope===`global`){let t=Cr(e.img.width,e.img.height);try{let n=t.getContext(`2d`);n&&(n.putImageData(e.img,0,0),Sn.current+=1,Xn(`dirty`),dt(e=>e+1))}catch{}return}let t=Sr(e.t,e.img.width,e.img.height);try{let n=t.getContext(`2d`);n&&(n.putImageData(e.img,0,0),Sn.current+=1,Xn(`dirty`),dt(e=>e+1))}catch{}}",
  "ti=()=>{let e=Jt.current.pop();if(!e)return;if(e.scope===`global`){let t=Cr(e.img.width,e.img.height);try{let n=t.getContext(`2d`);n&&(n.putImageData(e.img,0,0),Sn.current+=1,Xn(`dirty`,{scope:`global`,t:-1}),dt(e=>e+1))}catch{}return}let t=Sr(e.t,e.img.width,e.img.height);try{let n=t.getContext(`2d`);n&&(n.putImageData(e.img,0,0),Sn.current+=1,Xn(`dirty`,{scope:`frame`,t:e.t}),dt(e=>e+1))}catch{}}"
);

replaceLegacyExact(
  "AI sequence paused cutout same-frame seek fast path",
  "u=()=>new Promise(e=>{requestAnimationFrame(()=>requestAnimationFrame(()=>e()))}),d=Number(e.currentTime)||0;Math.abs(d-s),r&&(r.normalizedTargetTime=s,r.rawTargetTime=a);try{n?.strict&&e.pause?.()}catch{}if(await wt(e,s,n)",
  "u=()=>new Promise(e=>{requestAnimationFrame(()=>requestAnimationFrame(()=>e()))}),d=Number(e.currentTime)||0,g=!!n?.allowCurrentFrameReuse&&!n?.strict&&e.readyState>=2&&Math.abs(d-s)<=c;r&&(r.normalizedTargetTime=s,r.rawTargetTime=a);if(g)return r&&(r.sameFrameFastPath=!0,r.seekEndMs=i(),r.rvfcMs=r.seekEndMs),{requestedTimeSec:s,rawTargetTimeSec:a,currentTime:d,mediaTime:d,presentedFrames:null,timedOut:!1,frameCallbackVerified:!0,fallbackCurrentTimeVerified:!0,sameFrameFastPath:!0};try{n?.strict&&e.pause?.()}catch{}if(await wt(e,s,n)"
);

replaceLegacyExact(
  "AI sequence paused cutout opts into same-frame reuse",
  "R===`ai`?{traceProbe:a,strict:!0,frameSyncTimeoutMs:1500,toleranceSec:Math.max(.01,.5/Math.max(1,s))}:a?{traceProbe:a}:void 0",
  "R===`ai`?{traceProbe:a,strict:!0,frameSyncTimeoutMs:1500,toleranceSec:Math.max(.01,.5/Math.max(1,s))}:a?{traceProbe:a,allowCurrentFrameReuse:!!n?.allowCurrentFrameReuse}:n?.allowCurrentFrameReuse?{allowCurrentFrameReuse:!0}:void 0"
);

replaceExact(
  "AI sequence paused cutout preview requests same-frame reuse",
  "t=await rr({media:r,sourceFrameIndex:d,timeSec:u,traceSurface:`preview`,previewFrame:!0,previewW:e.w,previewH:e.h})",
  "t=await rr({media:r,sourceFrameIndex:d,timeSec:u,traceSurface:`preview`,previewFrame:!0,previewW:e.w,previewH:e.h,allowCurrentFrameReuse:!b})"
);

replaceExact(
  "AI sequence cached cutout preview avoids duplicate seek",
  "if(!b&&!s&&r&&(r?.currentSrc||r?.src))",
  "if(!V&&!b&&!s&&r&&(r?.currentSrc||r?.src))"
);

replaceLegacyExact(
  "AI sequence cutout preview cache captures write generation",
  "let j=A.frameMap.get(T);if(j&&j.key===k&&j.imageData)return Wn(y,j.alphaFrameIndex??T,j.cacheFrameIndex??T,v.frameTimeSec,j.sourceReadTimeSec??v.frameTimeSec,j.representativeTimelineFrameIndex??y),{...j,cacheHit:!0};let M=i.w*i.h*4",
  "let j=A.frameMap.get(T);if(j&&j.key===k&&j.imageData)return Wn(y,j.alphaFrameIndex??T,j.cacheFrameIndex??T,v.frameTimeSec,j.sourceReadTimeSec??v.frameTimeSec,j.representativeTimelineFrameIndex??y),{...j,cacheHit:!0};let F=A.version,M=i.w*i.h*4"
);

replaceLegacyExact(
  "AI sequence cutout preview rejects stale warmup writes",
  "tool:A.tool};return A.frameMap.set(T,m),A.bytes=(A.bytes||0)+M,A.readyFrameCount=A.frameMap.size,A.status=A.readyFrameCount>=A.frameCount?`ready`:`building`,m",
  "tool:A.tool};return A.version!==F||A.cacheKey!==O?m:(A.frameMap.set(T,m),A.bytes=(A.bytes||0)+M,A.readyFrameCount=A.frameMap.size,A.status=A.readyFrameCount>=A.frameCount?`ready`:`building`,m)"
);

replaceLegacyExact(
  "AI sequence chroma warmup opts into strict decoded-frame sync",
  "R===`ai`?{traceProbe:a,strict:!0,frameSyncTimeoutMs:1500,toleranceSec:Math.max(.01,.5/Math.max(1,s))}:a?{traceProbe:a,allowCurrentFrameReuse:!!n?.allowCurrentFrameReuse}:n?.allowCurrentFrameReuse?{allowCurrentFrameReuse:!0}:void 0",
  "R===`ai`?{traceProbe:a,strict:!0,frameSyncTimeoutMs:1500,toleranceSec:Math.max(.01,.5/Math.max(1,s))}:n?.strictFrameSync?{strict:!0,frameSyncTimeoutMs:1500,ensureReadyTimeoutMs:3e3,seekTimeoutMs:3e3,toleranceSec:Math.max(.01,.5/Math.max(1,s))}:a?{traceProbe:a,allowCurrentFrameReuse:!!n?.allowCurrentFrameReuse}:n?.allowCurrentFrameReuse?{allowCurrentFrameReuse:!0}:void 0"
);

replaceExact(
  "AI sequence chroma strict sync requires real video frame callback",
  "R===`ai`?{traceProbe:a,strict:!0,frameSyncTimeoutMs:1500,toleranceSec:Math.max(.01,.5/Math.max(1,s))}:n?.strictFrameSync?{strict:!0,frameSyncTimeoutMs:1500,ensureReadyTimeoutMs:3e3,seekTimeoutMs:3e3,toleranceSec:Math.max(.01,.5/Math.max(1,s))}:a?{traceProbe:a,allowCurrentFrameReuse:!!n?.allowCurrentFrameReuse}:n?.allowCurrentFrameReuse?{allowCurrentFrameReuse:!0}:void 0",
  "R===`ai`?{traceProbe:a,strict:!0,frameSyncTimeoutMs:1500,toleranceSec:Math.max(.01,.5/Math.max(1,s))}:n?.strictFrameSync?{strict:!0,requireRvfcVerified:!0,frameSyncTimeoutMs:1500,ensureReadyTimeoutMs:3e3,seekTimeoutMs:3e3,toleranceSec:Math.max(.01,.5/Math.max(1,s))}:a?{traceProbe:a,allowCurrentFrameReuse:!!n?.allowCurrentFrameReuse}:n?.allowCurrentFrameReuse?{allowCurrentFrameReuse:!0}:void 0"
);

replaceExact(
  "AI sequence chroma strict sync rejects currentTime-only timeout fallback",
  "if(n?.strict&&m?.timedOut&&m?.mediaTime==null&&e.readyState>=2&&Math.abs(h-s)<=c&&(m={...m,mediaTime:s,verified:!0,fallbackCurrentTimeVerified:!0}),n?.strict&&!m?.verified&&m?.timedOut&&e.readyState<2)",
  "if(n?.strict&&!n?.requireRvfcVerified&&m?.timedOut&&m?.mediaTime==null&&e.readyState>=2&&Math.abs(h-s)<=c&&(m={...m,mediaTime:s,verified:!0,fallbackCurrentTimeVerified:!0}),n?.strict&&!n?.requireRvfcVerified&&!m?.verified&&m?.timedOut&&e.readyState<2)"
);

replaceLegacyExact(
  "AI sequence chroma strict sync prearms target frame verification",
  "},`image/png`)}),Lt=async(e,t,n)=>",
  "},`image/png`)}),nfArmVerifiedVideoFrame=(e,t,n,r)=>{let i=!1,a=null,o=null,s=null,c=null,l={mediaTime:null,presentedFrames:null,timedOut:!0,verified:!1,fallbackCurrentTimeVerified:!1},u=()=>typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now(),d=t=>{if(i)return;i=!0,a!=null&&(window.clearTimeout(a),a=null);if(o!=null&&typeof e.cancelVideoFrameCallback==`function`)try{e.cancelVideoFrameCallback(o)}catch{}o=null,s?.(t)},f=()=>{if(i)return;if(c!=null){let e=Math.max(0,c-u());if(e<=0){d({...l,timedOut:!0,verified:!1});return}a!=null&&window.clearTimeout(a),a=window.setTimeout(()=>d({...l,timedOut:!0,verified:!1}),e)}try{o=e.requestVideoFrameCallback((e,r)=>{a!=null&&(window.clearTimeout(a),a=null),o=null;let i=Number(r?.mediaTime),s=Number(r?.presentedFrames);l={mediaTime:Number.isFinite(i)?i:null,presentedFrames:Number.isFinite(s)?s:null,timedOut:!1,verified:Number.isFinite(i)&&Math.abs(i-t)<=n,fallbackCurrentTimeVerified:!1},l.verified?d(l):f()})}catch(e){d({...l,timedOut:!0,verified:!1,error:String(e?.message||e)})}},p=new Promise(e=>{s=e}),m=()=>{if(i||c!=null)return;c=u()+Math.max(200,Number(r)||1e3),a!=null&&(window.clearTimeout(a),a=null),o==null?f():a=window.setTimeout(()=>d({...l,timedOut:!0,verified:!1}),Math.max(0,c-u()))},h=()=>d({...l,timedOut:!0,verified:!1,cancelled:!0});return f(),{promise:p,start:m,cancel:h}},Lt=async(e,t,n)=>"
);

replaceLegacyExact(
  "AI sequence chroma strict sync migrates prearmed verification deadline ownership",
  "},`image/png`)}),nfWaitForVerifiedVideoFrame=(e,t,n,r)=>{return new Promise(i=>{let a=!1,o=null,s=null,c={mediaTime:null,presentedFrames:null,timedOut:!0,verified:!1,fallbackCurrentTimeVerified:!1},l=()=>typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now(),u=l()+Math.max(200,Number(r)||1e3),d=t=>{if(a)return;a=!0,o&&window.clearTimeout(o);if(s!=null&&typeof e.cancelVideoFrameCallback==`function`)try{e.cancelVideoFrameCallback(s)}catch{}i(t)},f=()=>{let r=Math.max(0,u-l());if(r<=0){d({...c,timedOut:!0,verified:!1});return}o=window.setTimeout(()=>d({...c,timedOut:!0,verified:!1}),r);try{s=e.requestVideoFrameCallback((e,r)=>{o&&window.clearTimeout(o),o=null,s=null;let i=Number(r?.mediaTime),a=Number(r?.presentedFrames);c={mediaTime:Number.isFinite(i)?i:null,presentedFrames:Number.isFinite(a)?a:null,timedOut:!1,verified:Number.isFinite(i)&&Math.abs(i-t)<=n,fallbackCurrentTimeVerified:!1},c.verified?d(c):f()})}catch(e){d({...c,timedOut:!0,verified:!1,error:String(e?.message||e)})}};f()})},Lt=async(e,t,n)=>",
  "},`image/png`)}),nfArmVerifiedVideoFrame=(e,t,n,r)=>{let i=!1,a=null,o=null,s=null,c=null,l={mediaTime:null,presentedFrames:null,timedOut:!0,verified:!1,fallbackCurrentTimeVerified:!1},u=()=>typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now(),d=t=>{if(i)return;i=!0,a!=null&&(window.clearTimeout(a),a=null);if(o!=null&&typeof e.cancelVideoFrameCallback==`function`)try{e.cancelVideoFrameCallback(o)}catch{}o=null,s?.(t)},f=()=>{if(i)return;if(c!=null){let e=Math.max(0,c-u());if(e<=0){d({...l,timedOut:!0,verified:!1});return}a!=null&&window.clearTimeout(a),a=window.setTimeout(()=>d({...l,timedOut:!0,verified:!1}),e)}try{o=e.requestVideoFrameCallback((e,r)=>{a!=null&&(window.clearTimeout(a),a=null),o=null;let i=Number(r?.mediaTime),s=Number(r?.presentedFrames);l={mediaTime:Number.isFinite(i)?i:null,presentedFrames:Number.isFinite(s)?s:null,timedOut:!1,verified:Number.isFinite(i)&&Math.abs(i-t)<=n,fallbackCurrentTimeVerified:!1},l.verified?d(l):f()})}catch(e){d({...l,timedOut:!0,verified:!1,error:String(e?.message||e)})}},p=new Promise(e=>{s=e}),m=()=>{if(i||c!=null)return;c=u()+Math.max(200,Number(r)||1e3),a!=null&&(window.clearTimeout(a),a=null),o==null?f():a=window.setTimeout(()=>d({...l,timedOut:!0,verified:!1}),Math.max(0,c-u()))},h=()=>d({...l,timedOut:!0,verified:!1,cancelled:!0});return f(),{promise:p,start:m,cancel:h}},Lt=async(e,t,n)=>"
);

replaceLegacyExact(
  "AI sequence chroma same-target cold seek primes before target verification",
  "try{n?.strict&&e.pause?.()}catch{}if(await wt(e,s,n),r&&",
  "try{n?.strict&&e.pause?.()}catch{}let v=null,y=!1;if(n?.strict&&n?.requireRvfcVerified){e.readyState<2&&await wt(e,Number(e.currentTime)||0,n),y=Math.abs((Number(e.currentTime)||0)-s)<.001;if(y){let t=Math.max(.001,c*2),r=Number.isFinite(o)&&o>0?Math.max(0,o-.001):s+t,i=Math.min(r,s+t),a=Math.max(0,s-t),d=Math.abs(i-s)>=Math.abs(a-s)?i:a;Math.abs(d-s)>=.001&&(await wt(e,d,n),await u())}typeof e.requestVideoFrameCallback==`function`&&(v=nfArmVerifiedVideoFrame(e,s,c,l))}if(await wt(e,s,n).catch(e=>{v?.cancel?.();throw e}),r&&"
);

replaceLegacyExact(
  "AI sequence chroma same-target cold seek migrates safe neighbor and deadline control",
  "try{n?.strict&&e.pause?.()}catch{}let v=null,y=!1;if(n?.strict&&n?.requireRvfcVerified){e.readyState<2&&await wt(e,Number(e.currentTime)||0,n),y=Math.abs((Number(e.currentTime)||0)-s)<.001;if(y){let t=Math.max(.001,c*2),r=s<=t?Math.min(Number.isFinite(o)&&o>0?o:s+t,s+t):Math.max(0,s-t);Math.abs(r-s)>=.001&&(await wt(e,r,n),await u())}typeof e.requestVideoFrameCallback==`function`&&(v=nfWaitForVerifiedVideoFrame(e,s,c,l))}if(await wt(e,s,n),r&&",
  "try{n?.strict&&e.pause?.()}catch{}let v=null,y=!1;if(n?.strict&&n?.requireRvfcVerified){e.readyState<2&&await wt(e,Number(e.currentTime)||0,n),y=Math.abs((Number(e.currentTime)||0)-s)<.001;if(y){let t=Math.max(.001,c*2),r=Number.isFinite(o)&&o>0?Math.max(0,o-.001):s+t,i=Math.min(r,s+t),a=Math.max(0,s-t),d=Math.abs(i-s)>=Math.abs(a-s)?i:a;Math.abs(d-s)>=.001&&(await wt(e,d,n),await u())}typeof e.requestVideoFrameCallback==`function`&&(v=nfArmVerifiedVideoFrame(e,s,c,l))}if(await wt(e,s,n).catch(e=>{v?.cancel?.();throw e}),r&&"
);

replaceLegacyExact(
  "AI sequence chroma strict sync consumes the prearmed target callback",
  "let m={mediaTime:null,presentedFrames:null,timedOut:!1,verified:!1,fallbackCurrentTimeVerified:!1};if(typeof e.requestVideoFrameCallback==`function`)",
  "v?.start?.();let m=v?await v.promise:{mediaTime:null,presentedFrames:null,timedOut:!1,verified:!1,fallbackCurrentTimeVerified:!1};if(!v&&typeof e.requestVideoFrameCallback==`function`)"
);

replaceLegacyExact(
  "AI sequence chroma strict sync migrates prearmed controller consumption",
  "let m=v?await v:{mediaTime:null,presentedFrames:null,timedOut:!1,verified:!1,fallbackCurrentTimeVerified:!1};if(!v&&typeof e.requestVideoFrameCallback==`function`)",
  "v?.start?.();let m=v?await v.promise:{mediaTime:null,presentedFrames:null,timedOut:!1,verified:!1,fallbackCurrentTimeVerified:!1};if(!v&&typeof e.requestVideoFrameCallback==`function`)"
);

replaceExact(
  "AI sequence chroma strict sync cancels prearmed callbacks on currentTime drift",
  "if(n?.strict&&(!p||Math.abs(f-s)>c))throw Error(`video currentTime drift [compose-lock-3] requested=${s.toFixed(6)} raw=${a.toFixed(6)} current=${f.toFixed(6)} readyState=${e.readyState}`)",
  "if(n?.strict&&(!p||Math.abs(f-s)>c)){v?.cancel?.();throw Error(`video currentTime drift [compose-lock-3] requested=${s.toFixed(6)} raw=${a.toFixed(6)} current=${f.toFixed(6)} readyState=${e.readyState}`)}"
);

replaceExact(
  "AI sequence chroma strict sync preserves unavailable callback errors",
  "}else if(n?.strict)throw Error(`requestVideoFrameCallback unavailable [compose-lock-3]`);",
  "}else if(!v&&n?.strict)throw Error(`requestVideoFrameCallback unavailable [compose-lock-3]`);"
);

replaceExact(
  "AI sequence chroma strict sync preserves null callback metadata",
  "let i=Number(r?.mediaTime),s=Number(r?.presentedFrames);",
  "let i=r?.mediaTime==null?NaN:Number(r.mediaTime),s=r?.presentedFrames==null?NaN:Number(r.presentedFrames);"
);

replaceExact(
  "AI sequence chroma strict sync stops presentation before resolving",
  "o=null,s?.(t)},f=()=>{if(i)return;",
  "o=null;try{e.pause?.()}catch{}s?.(t)},f=()=>{if(i)return;"
);

replaceExact(
  "AI sequence chroma strict sync start reports presentation demand",
  "m=()=>{if(i||c!=null)return;c=u()+",
  "m=()=>{if(i||c!=null)return!1;c=u()+"
);

replaceExact(
  "AI sequence chroma strict sync start confirms presentation demand",
  "Math.max(0,c-u()))},h=()=>d(",
  "Math.max(0,c-u()));return!0},h=()=>d("
);

replaceLegacyExact(
  "AI sequence chroma strict sync migrates detached canvas presentation",
  "return f(),{promise:p,start:m,cancel:h}},nfPumpVideoFrameForCanvas=e=>{let t=null,n=null;try{t=document.createElement(`canvas`),t.width=1,t.height=1,n=t.getContext(`2d`)}catch{}if(!n)return{stop:()=>0};let r=!1,i=0,a=0,o=()=>{if(r)return;try{n.drawImage(e,0,0,1,1),a+=1}catch{}i=requestAnimationFrame(o)};return o(),{stop:()=>{if(r)return a;r=!0,i&&cancelAnimationFrame(i),i=0;return a}}},Lt=async(e,t,n)=>",
  "return f(),{promise:p,start:m,cancel:h}},nfDriveVideoFrameForPresentation=(e,t)=>{let n=!1,r=Number(e?.playbackRate),i=!!e?.muted,a=null;if(e?.isConnected!==!0||e?.getAttribute?.(`data-novaflow-cutout-preview-media`)!==`1`)return{stop:()=>0};try{e.muted=!0,e.playsInline=!0,Number.isFinite(r)&&(e.playbackRate=.25)}catch{}try{a=e.play?.(),a?.then?.(()=>{if(n)try{e.pause?.()}catch{}},e=>t?.(e))}catch(e){t?.(e)}return{stop:()=>{if(n)return;n=!0;try{e.pause?.()}catch{}try{Number.isFinite(r)&&(e.playbackRate=r),e.muted=i}catch{}}}},Lt=async(e,t,n)=>"
);

replaceLegacyExact(
  "AI sequence chroma strict sync scopes presentation drive to an attached warmup clone",
  "return f(),{promise:p,start:m,cancel:h}},nfDriveVideoFrameForPresentation=e=>{let t=!1,n=Number(e?.playbackRate),r=!!e?.muted,i=null;try{e.muted=!0,e.playsInline=!0,Number.isFinite(n)&&(e.playbackRate=.0625)}catch{}try{i=e.play?.(),i?.catch?.(()=>{})}catch{}return{stop:()=>{if(t)return;t=!0;try{e.pause?.()}catch{}try{Number.isFinite(n)&&(e.playbackRate=n),e.muted=r}catch{}}}},Lt=async(e,t,n)=>",
  "return f(),{promise:p,start:m,cancel:h}},nfDriveVideoFrameForPresentation=(e,t)=>{let n=!1,r=Number(e?.playbackRate),i=!!e?.muted,a=null;if(e?.isConnected!==!0||e?.getAttribute?.(`data-novaflow-cutout-preview-media`)!==`1`)return{stop:()=>0};try{e.muted=!0,e.playsInline=!0,Number.isFinite(r)&&(e.playbackRate=.25)}catch{}try{a=e.play?.(),a?.then?.(()=>{if(n)try{e.pause?.()}catch{}},e=>t?.(e))}catch(e){t?.(e)}return{stop:()=>{if(n)return;n=!0;try{e.pause?.()}catch{}try{Number.isFinite(r)&&(e.playbackRate=r),e.muted=i}catch{}}}},Lt=async(e,t,n)=>"
);

replaceLegacyExact(
  "AI sequence chroma strict sync upgrades attached clone presentation cleanup",
  "return f(),{promise:p,start:m,cancel:h}},nfDriveVideoFrameForPresentation=e=>{let t=!1,n=Number(e?.playbackRate),r=!!e?.muted,i=null;if(e?.isConnected!==!0||e?.getAttribute?.(`data-novaflow-cutout-preview-media`)!==`1`)return{stop:()=>0};try{e.muted=!0,e.playsInline=!0,Number.isFinite(n)&&(e.playbackRate=.0625)}catch{}try{i=e.play?.(),i?.catch?.(()=>{})}catch{}return{stop:()=>{if(t)return;t=!0;try{e.pause?.()}catch{}try{Number.isFinite(n)&&(e.playbackRate=n),e.muted=r}catch{}}}},Lt=async(e,t,n)=>",
  "return f(),{promise:p,start:m,cancel:h}},nfDriveVideoFrameForPresentation=(e,t)=>{let n=!1,r=Number(e?.playbackRate),i=!!e?.muted,a=null;if(e?.isConnected!==!0||e?.getAttribute?.(`data-novaflow-cutout-preview-media`)!==`1`)return{stop:()=>0};try{e.muted=!0,e.playsInline=!0,Number.isFinite(r)&&(e.playbackRate=.25)}catch{}try{a=e.play?.(),a?.then?.(()=>{if(n)try{e.pause?.()}catch{}},e=>t?.(e))}catch(e){t?.(e)}return{stop:()=>{if(n)return;n=!0;try{e.pause?.()}catch{}try{Number.isFinite(r)&&(e.playbackRate=r),e.muted=i}catch{}}}},Lt=async(e,t,n)=>"
);

replaceLegacyExact(
  "AI sequence chroma strict sync drives detached video presentation",
  "return f(),{promise:p,start:m,cancel:h}},Lt=async(e,t,n)=>",
  "return f(),{promise:p,start:m,cancel:h}},nfDriveVideoFrameForPresentation=(e,t)=>{let n=!1,r=Number(e?.playbackRate),i=!!e?.muted,a=null;if(e?.isConnected!==!0||e?.getAttribute?.(`data-novaflow-cutout-preview-media`)!==`1`)return{stop:()=>0};try{e.muted=!0,e.playsInline=!0,Number.isFinite(r)&&(e.playbackRate=.25)}catch{}try{a=e.play?.(),a?.then?.(()=>{if(n)try{e.pause?.()}catch{}},e=>t?.(e))}catch(e){t?.(e)}return{stop:()=>{if(n)return;n=!0;try{e.pause?.()}catch{}try{Number.isFinite(r)&&(e.playbackRate=r),e.muted=i}catch{}}}},Lt=async(e,t,n)=>"
);

replaceExact(
  "AI sequence chroma strict sync exposes settled and play failure state",
  "return f(),{promise:p,start:m,cancel:h}},nfDriveVideoFrameForPresentation=",
  "return f(),{promise:p,start:m,cancel:h,settled:()=>i,fail:e=>d({...l,timedOut:!0,verified:!1,error:String(e?.message||e)})}},nfDriveVideoFrameForPresentation="
);

replaceLegacyExact(
  "AI sequence chroma strict sync migrates detached canvas consumption",
  "v?.start?.();let w=null,m;try{v&&n?.strict&&n?.requireRvfcVerified&&(w=nfPumpVideoFrameForCanvas(e)),m=v?await v.promise:{mediaTime:null,presentedFrames:null,timedOut:!1,verified:!1,fallbackCurrentTimeVerified:!1}}finally{w?.stop?.()}if(!v&&typeof e.requestVideoFrameCallback==`function`)",
  "v?.start?.();let w=null,m;try{v&&n?.strict&&n?.requireRvfcVerified&&(w=nfDriveVideoFrameForPresentation(e)),m=v?await v.promise:{mediaTime:null,presentedFrames:null,timedOut:!1,verified:!1,fallbackCurrentTimeVerified:!1}}finally{w?.stop?.()}if(!v&&typeof e.requestVideoFrameCallback==`function`)"
);

replaceLegacyExact(
  "AI sequence chroma strict sync consumes detached video presentation",
  "v?.start?.();let m=v?await v.promise:{mediaTime:null,presentedFrames:null,timedOut:!1,verified:!1,fallbackCurrentTimeVerified:!1};if(!v&&typeof e.requestVideoFrameCallback==`function`)",
  "v?.start?.();let w=null,m;try{v&&n?.strict&&n?.requireRvfcVerified&&(w=nfDriveVideoFrameForPresentation(e)),m=v?await v.promise:{mediaTime:null,presentedFrames:null,timedOut:!1,verified:!1,fallbackCurrentTimeVerified:!1}}finally{w?.stop?.()}if(!v&&typeof e.requestVideoFrameCallback==`function`)"
);

replaceExact(
  "AI sequence chroma strict sync skips settled play and cleans all exits",
  "v?.start?.();let w=null,m;try{v&&n?.strict&&n?.requireRvfcVerified&&(w=nfDriveVideoFrameForPresentation(e)),m=v?await v.promise:{mediaTime:null,presentedFrames:null,timedOut:!1,verified:!1,fallbackCurrentTimeVerified:!1}}finally{w?.stop?.()}if(!v&&typeof e.requestVideoFrameCallback==`function`)",
  "let b=!!v?.start?.(),w=null,m;try{b&&n?.strict&&n?.requireRvfcVerified&&(w=nfDriveVideoFrameForPresentation(e,e=>v?.fail?.(e))),m=v?await v.promise:{mediaTime:null,presentedFrames:null,timedOut:!1,verified:!1,fallbackCurrentTimeVerified:!1}}finally{w?.stop?.(),v?.cancel?.()}if(!v&&typeof e.requestVideoFrameCallback==`function`)"
);

replaceExact(
  "AI sequence chroma strict sync reports null media time accurately",
  "Number.isFinite(Number(m?.mediaTime))?Number(m.mediaTime).toFixed(6):`null`",
  "m?.mediaTime!=null&&Number.isFinite(Number(m.mediaTime))?Number(m.mediaTime).toFixed(6):`null`"
);

replaceExact(
  "AI sequence chroma strict sync preserves null presented frame trace",
  "r.requestVideoFrameCallbackPresentedFrames=Number.isFinite(Number(m?.presentedFrames))?Number(m.presentedFrames):null",
  "r.requestVideoFrameCallbackPresentedFrames=m?.presentedFrames!=null&&Number.isFinite(Number(m.presentedFrames))?Number(m.presentedFrames):null"
);

replaceExact(
  "AI sequence chroma strict sync preserves null presented frame result",
  "mediaTime:Number.isFinite(m?.mediaTime)?m.mediaTime:h,presentedFrames:Number.isFinite(Number(m?.presentedFrames))?Number(m.presentedFrames):null",
  "mediaTime:Number.isFinite(m?.mediaTime)?m.mediaTime:h,presentedFrames:m?.presentedFrames!=null&&Number.isFinite(Number(m.presentedFrames))?Number(m.presentedFrames):null"
);

replaceLegacyExact(
  "AI sequence strict warmup bypasses unverified cached frames",
  "let j=A.frameMap.get(T);if(j&&j.key===k&&j.imageData)return Wn(y,j.alphaFrameIndex??T,j.cacheFrameIndex??T,v.frameTimeSec,j.sourceReadTimeSec??v.frameTimeSec,j.representativeTimelineFrameIndex??y),{...j,cacheHit:!0};let F=A.version,M=i.w*i.h*4",
  "let j=A.frameMap.get(T);if(j&&j.key===k&&j.imageData&&(!n?.strictFrameSync||j.frameSyncVerified===!0))return Wn(y,j.alphaFrameIndex??T,j.cacheFrameIndex??T,v.frameTimeSec,j.sourceReadTimeSec??v.frameTimeSec,j.representativeTimelineFrameIndex??y),{...j,cacheHit:!0};let F=A.version,M=i.w*i.h*4"
);

replaceExact(
  "AI sequence strict warmup removes unverified cache bytes before replacement",
  "let j=A.frameMap.get(T);if(j&&j.key===k&&j.imageData&&(!n?.strictFrameSync||j.frameSyncVerified===!0))return Wn(y,j.alphaFrameIndex??T,j.cacheFrameIndex??T,v.frameTimeSec,j.sourceReadTimeSec??v.frameTimeSec,j.representativeTimelineFrameIndex??y),{...j,cacheHit:!0};let F=A.version,M=i.w*i.h*4",
  "let j=A.frameMap.get(T);if(j&&j.key===k&&j.imageData&&(!n?.strictFrameSync||j.frameSyncVerified===!0))return Wn(y,j.alphaFrameIndex??T,j.cacheFrameIndex??T,v.frameTimeSec,j.sourceReadTimeSec??v.frameTimeSec,j.representativeTimelineFrameIndex??y),{...j,cacheHit:!0};if(j&&j.key===k&&j.imageData&&n?.strictFrameSync&&j.frameSyncVerified!==!0){A.frameMap.delete(T),A.bytes=Math.max(0,(A.bytes||0)-(Number(j?.width)||i.w)*(Number(j?.height)||i.h)*4),A.readyFrameCount=A.frameMap.size}let F=A.version,M=i.w*i.h*4"
);

replaceExact(
  "AI sequence chroma frame sync captures decoder verification result",
  "let t=R===`ai`?S.frameTimeSec:v.frameTimeSec,a=null,c=null,l=()=>typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now();",
  "let t=R===`ai`?S.frameTimeSec:v.frameTimeSec,a=null,c=null,q=null,l=()=>typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now();"
);

replaceLegacyExact(
  "AI sequence chroma frame sync stores decoder verification result",
  "else !Rn&&r&&(r?.currentSrc||r?.src)&&await Lt(r,t,R===`ai`?{traceProbe:a,strict:!0,frameSyncTimeoutMs:1500,toleranceSec:Math.max(.01,.5/Math.max(1,s))}:n?.strictFrameSync?{strict:!0,requireRvfcVerified:!0,frameSyncTimeoutMs:1500,ensureReadyTimeoutMs:3e3,seekTimeoutMs:3e3,toleranceSec:Math.max(.01,.5/Math.max(1,s))}:a?{traceProbe:a,allowCurrentFrameReuse:!!n?.allowCurrentFrameReuse}:n?.allowCurrentFrameReuse?{allowCurrentFrameReuse:!0}:void 0),a&&",
  "else !Rn&&r&&(r?.currentSrc||r?.src)&&(q=await Lt(r,t,R===`ai`?{traceProbe:a,strict:!0,frameSyncTimeoutMs:1500,toleranceSec:Math.max(.01,.5/Math.max(1,s))}:n?.strictFrameSync?{strict:!0,requireRvfcVerified:!0,frameSyncTimeoutMs:1500,ensureReadyTimeoutMs:3e3,seekTimeoutMs:3e3,toleranceSec:Math.max(.01,.5/Math.max(1,s))}:a?{traceProbe:a,allowCurrentFrameReuse:!!n?.allowCurrentFrameReuse}:n?.allowCurrentFrameReuse?{allowCurrentFrameReuse:!0}:void 0),a&&"
);

replaceExact(
  "AI sequence chroma frame sync closes decoder result assignment",
  "n?.allowCurrentFrameReuse?{allowCurrentFrameReuse:!0}:void 0),a&&",
  "n?.allowCurrentFrameReuse?{allowCurrentFrameReuse:!0}:void 0)),a&&"
);

replaceLegacyExact(
  "AI sequence preview cache records verified frame sync",
  "let m={key:k,imageData:f,drawCanvas:p,width:i.w,height:i.h,sourceFrameIndex:y,representativeTimelineFrameIndex:R===`ai`?x:void 0,decodedFrameIndex:R===`ai`?b:void 0,alphaFrameIndex:R===`ai`?b:void 0,cacheFrameIndex:T,frameTimeSec:v.frameTimeSec,sourceReadTimeSec:t,tool:A.tool};return A.version!==F||A.cacheKey!==O?m:",
  "let m={key:k,imageData:f,drawCanvas:p,width:i.w,height:i.h,sourceFrameIndex:y,representativeTimelineFrameIndex:R===`ai`?x:void 0,decodedFrameIndex:R===`ai`?b:void 0,alphaFrameIndex:R===`ai`?b:void 0,cacheFrameIndex:T,frameTimeSec:v.frameTimeSec,sourceReadTimeSec:t,tool:A.tool,frameSyncVerified:R===`ai`||!!n?.strictFrameSync};return A.version!==F||A.cacheKey!==O?m:"
);

replaceExact(
  "AI sequence chroma cache verification derives from decoder result",
  "frameSyncVerified:R===`ai`||!!n?.strictFrameSync};return A.version!==F||A.cacheKey!==O?m:",
  "frameSyncVerified:R===`ai`||!!n?.strictFrameSync&&q?.frameCallbackVerified===!0&&!q?.timedOut};return A.version!==F||A.cacheKey!==O?m:"
);

replaceExact(
  "AI sequence chroma warmup ready requires verified frames",
  "return{key:d,ready:!!(f?.frameMap&&f.cacheKey===d&&g.length>0&&g.every(e=>!!f.frameMap.get(e)?.imageData)),frames:h,cacheKeys:g,fps:i,duration:o,times:c,cacheFrameCount:g.length||l}",
  "return{key:d,ready:!!(f?.frameMap&&f.cacheKey===d&&g.length>0&&g.every(e=>{let t=f.frameMap.get(e);return!!t?.imageData&&(R!==`key`||t.frameSyncVerified===!0)})),frames:h,cacheKeys:g,fps:i,duration:o,times:c,cacheFrameCount:g.length||l}"
);

replaceExact(
  "AI sequence chroma warmup completion requires verified frames",
  "return!!(t?.frameMap&&t.cacheKey===e.key&&(n.length>0?n.every(e=>!!t.frameMap.get(e)?.imageData):t.readyFrameCount>=t.frameCount))",
  "return!!(t?.frameMap&&t.cacheKey===e.key&&(n.length>0?n.every(e=>{let n=t.frameMap.get(e);return!!n?.imageData&&(R!==`key`||n.frameSyncVerified===!0)}):t.readyFrameCount>=t.frameCount))"
);

replaceExact(
  "AI sequence chroma detached warmup requests strict frame sync",
  "await rr({media:s,cacheMedia:R===`key`?r:void 0,sourceFrameIndex:c,timeSec:l,traceSurface:`preview`,previewFrame:!0,previewW:o.w,previewH:o.h})",
  "await rr({media:s,cacheMedia:R===`key`?r:void 0,sourceFrameIndex:c,timeSec:l,traceSurface:`preview`,previewFrame:!0,previewW:o.w,previewH:o.h,strictFrameSync:R===`key`})"
);

replaceLegacyExact(
  "AI sequence chroma warmup rejects clone load failure without touching visible media",
  "s=document.createElement(`video`),s.muted=!0,s.playsInline=!0,s.preload=`auto`,s.setAttribute(`data-novaflow-cutout-preview-media`,`1`),Object.assign(s.style,{width:`1px`,height:`1px`}),s.src=r.currentSrc||r.src,nfPreviewMediaHost=document.createElement(`div`),nfPreviewMediaHost.setAttribute(`data-novaflow-cutout-preview-media-host`,`1`),nfPreviewMediaHost.setAttribute(`aria-hidden`,`true`),Object.assign(nfPreviewMediaHost.style,{position:`fixed`,left:`0`,top:`0`,width:`1px`,height:`1px`,opacity:`.001`,pointerEvents:`none`,overflow:`hidden`,zIndex:`0`}),(nfPreviewMediaHost.attachShadow?.({mode:`closed`})||nfPreviewMediaHost).appendChild(s),document.body?.appendChild(nfPreviewMediaHost),await Rt(s)}catch{try{nfPreviewMediaHost?.remove?.()}catch{}nfPreviewMediaHost=null,s=r}",
  "s=document.createElement(`video`),s.muted=!0,s.playsInline=!0,s.preload=`auto`,s.setAttribute(`data-novaflow-cutout-preview-media`,`1`),Object.assign(s.style,{width:`1px`,height:`1px`}),s.src=r.currentSrc||r.src,nfPreviewMediaHost=document.createElement(`div`),nfPreviewMediaHost.setAttribute(`data-novaflow-cutout-preview-media-host`,`1`),nfPreviewMediaHost.setAttribute(`aria-hidden`,`true`),Object.assign(nfPreviewMediaHost.style,{position:`fixed`,left:`0`,top:`0`,width:`1px`,height:`1px`,opacity:`.001`,pointerEvents:`none`,overflow:`hidden`,zIndex:`0`}),(nfPreviewMediaHost.attachShadow?.({mode:`closed`})||nfPreviewMediaHost).appendChild(s),document.body?.appendChild(nfPreviewMediaHost),await Rt(s)}catch(nfPreviewMediaError){try{nfPreviewMediaHost?.remove?.()}catch{}nfPreviewMediaHost=null;throw nfPreviewMediaError}"
);

replaceExact(
  "AI sequence chroma warmup attaches only its clone for presentation",
  "s=document.createElement(`video`),s.muted=!0,s.playsInline=!0,s.preload=`auto`,s.src=r.currentSrc||r.src,await Rt(s)}catch{s=r}",
  "s=document.createElement(`video`),s.muted=!0,s.playsInline=!0,s.preload=`auto`,s.setAttribute(`data-novaflow-cutout-preview-media`,`1`),Object.assign(s.style,{width:`1px`,height:`1px`}),s.src=r.currentSrc||r.src,nfPreviewMediaHost=document.createElement(`div`),nfPreviewMediaHost.setAttribute(`data-novaflow-cutout-preview-media-host`,`1`),nfPreviewMediaHost.setAttribute(`aria-hidden`,`true`),Object.assign(nfPreviewMediaHost.style,{position:`fixed`,left:`0`,top:`0`,width:`1px`,height:`1px`,opacity:`.001`,pointerEvents:`none`,overflow:`hidden`,zIndex:`0`}),(nfPreviewMediaHost.attachShadow?.({mode:`closed`})||nfPreviewMediaHost).appendChild(s),document.body?.appendChild(nfPreviewMediaHost),await Rt(s)}catch(nfPreviewMediaError){try{nfPreviewMediaHost?.remove?.()}catch{}nfPreviewMediaHost=null;throw nfPreviewMediaError}"
);

replaceExact(
  "AI sequence chroma warmup removes its isolated media host",
  "}finally{try{s&&s!==r&&(s.pause?.(),s.removeAttribute?.(`src`),s.load?.())}catch{}try{o?.running?.delete?.(e.key)",
  "}finally{try{s&&s!==r&&(s.pause?.(),s.removeAttribute?.(`src`),s.load?.())}catch{}try{nfPreviewMediaHost?.remove?.()}catch{}nfPreviewMediaHost=null;try{o?.running?.delete?.(e.key)"
);

replaceLegacyExact(
  "AI sequence cutout preview migrates completed progress to failed frame",
  "(async()=>{let t=!1,s=null,nfPreviewRenderedFrameCount=0;try{",
  "(async()=>{let t=!1,s=null,nfPreviewFailedFrame=1;try{"
);

replaceLegacyExact(
  "AI sequence cutout preview failure tracks the active frame",
  "(async()=>{let t=!1,s=null;try{",
  "(async()=>{let t=!1,s=null,nfPreviewFailedFrame=1;try{"
);

replaceExact(
  "AI sequence chroma warmup tracks an isolated media host",
  "(async()=>{let t=!1,s=null,nfPreviewFailedFrame=1;try{",
  "(async()=>{let t=!1,s=null,nfPreviewMediaHost=null,nfPreviewFailedFrame=1;try{"
);

replaceLegacyExact(
  "AI sequence cutout preview removes completed-frame-only bookkeeping",
  "}catch(e){throw console.error(e),e}nfPreviewRenderedFrameCount=i+1;try{r?.pause?.()}catch{}",
  "}catch(e){throw console.error(e),e}try{r?.pause?.()}catch{}"
);

replaceExact(
  "AI sequence cutout preview records the frame being rendered",
  "Jn(i,e.frames.length,`正在渲染预览`);try{await rr(",
  "Jn(i,e.frames.length,`正在渲染预览`),nfPreviewFailedFrame=i+1;try{await rr("
);

replaceLegacyExact(
  "AI sequence cutout preview migrates completed progress failure display",
  "Jn(nfPreviewRenderedFrameCount,e.frames.length,`预览渲染失败`)",
  "Jn(nfPreviewFailedFrame,e.frames.length,`预览渲染失败`)"
);

replaceExact(
  "AI sequence cutout preview failure reports the real frame and total",
  "Jn(0,1,`预览渲染失败`)",
  "Jn(nfPreviewFailedFrame,e.frames.length,`预览渲染失败`)"
);

replaceExact(
  "AI sequence cutout preview failure keeps the render plan in scope",
  "}catch(e){console.error(e),Jn(nfPreviewFailedFrame,e.frames.length,`预览渲染失败`)",
  "}catch(nfPreviewError){console.error(nfPreviewError),Jn(nfPreviewFailedFrame,e.frames.length,`预览渲染失败`)"
);

replaceExact(
  "AI cutout alpha decoder accepts binary payload",
  "o=Uint8Array.from(atob(String(e||``)),e=>e.charCodeAt(0)),s=i*a,c=s*4",
  "o=e instanceof Uint8Array?e:e instanceof ArrayBuffer?new Uint8Array(e):ArrayBuffer.isView(e)?new Uint8Array(e.buffer,e.byteOffset,e.byteLength):Uint8Array.from(atob(String(e||``)),e=>e.charCodeAt(0)),s=i*a,c=s*4"
);

replaceExact(
  "AI cutout captured RGB snapshots share exact duplicate frames",
  "de=(0,_.useRef)(null),fe=(0,_.useRef)(null);(0,_.useEffect)(()=>{try{e.aiSeqBgOutVideoRef",
  "de=(0,_.useRef)(null),fe=(0,_.useRef)(null),nfCompactCapturedFrameMap=e=>{let t=new Map,n=new Map;try{for(let[r,i]of e instanceof Map?e:[]){let a=String(i?.capturedHash||``),o=a?n.get(a):null;o?t.set(r,{...i,frame:o.frame}):(t.set(r,i),a&&n.set(a,i))}}finally{try{e?.clear?.()}catch{}}return t};(0,_.useEffect)(()=>{try{e.aiSeqBgOutVideoRef"
);

replaceExact(
  "AI cutout compacts captured RGB before backend invoke",
  "if(M>300)throw Error(`video exceeds rendererDecodedFrames MVP frame limit: timelineFrameCount=${w} decodedUniqueFrameCount=${M} limit=300`);oe({state:`running`,message:`正在执行 AI 抠图…`,progress01:.28})",
  "if(M>300)throw Error(`video exceeds rendererDecodedFrames MVP frame limit: timelineFrameCount=${w} decodedUniqueFrameCount=${M} limit=300`);A=nfCompactCapturedFrameMap(A);oe({state:`running`,message:`正在执行 AI 抠图…`,progress01:.28})"
);

replaceExact(
  "AI cutout releases renderer frame upload after backend invoke",
  "rendererFramesVersion:2,video:{fileName:f}});if(!P?.ok)",
  "rendererFramesVersion:2,video:{fileName:f}});D.length=0;if(!P?.ok)"
);

replaceExact(
  "AI cutout video result prefers binary alpha",
  "let re=String(P?.alphaBase64||``);if(!re)throw Error(`AI cutout returned empty alpha`);let V=I*L,H=a(re,I,L,ee)",
  "let V=I*L,re=Number(P?.alphaBytes?.byteLength)>0?P.alphaBytes:String(P?.alphaBase64||``);if(Number(P?.alphaBytes?.byteLength)>0&&(String(P?.alphaEncoding||``)!==`u8-mask-v1`||Number(P?.alphaByteLength)!==V*ee||Number(P.alphaBytes.byteLength)!==V*ee))throw Error(`AI cutout binary alpha contract mismatch`);if(!(Number(re?.byteLength)>0||Number(re?.length)>0))throw Error(`AI cutout returned empty alpha`);let H=a(re,I,L,ee)"
);

replaceExact(
  "AI cutout result retains pre-compacted captured RGB snapshots",
  "let W=H.alpha;U.current.clear(),fe.current={jobId:o,frames:nfCompactCapturedFrameMap(A)};for(let e=0;e<ee;e++)",
  "let W=H.alpha;U.current.clear(),fe.current={jobId:o,frames:A};for(let e=0;e<ee;e++)"
);

replaceExact(
  "AI cutout playback avoids per-frame canvas duplication",
  "let f=er(u,d,i.w,i.h),p=null;if(n?.previewFrame)try{p=document.createElement(`canvas`)",
  "let f=er(u,d,i.w,i.h),p=null;if(n?.previewFrame&&R!==`ai`)try{p=document.createElement(`canvas`)"
);

replaceExact(
  "AI cutout preview cache uses bounded 128MiB budget",
  "l=Math.max(1,Math.floor(536870912*.86/Math.max(1,c)/4)),u=r*i",
  "l=Math.max(1,Math.floor((R===`ai`?134217728:536870912*.86)/Math.max(1,c)/4)),u=r*i"
);

replaceExact(
  "AI sequence channel-preserving despill restoration",
  "let S=Z(.2126*i+.7152*s+.0722*c,0,255);i=i*(1-x)+S*x,s=s*(1-x)+S*x,c=c*(1-x)+S*x,f[n]=Z(i,0,255)",
  "let S=.2126*i+.7152*s+.0722*c;if(u===0){let e=(s+c)/2;i=i*(1-x)+e*x}else if(u===1){let e=(i+c)/2;s=s*(1-x)+e*x}else if(u===2){let e=(i+s)/2;c=c*(1-x)+e*x}else{let e=Z(S,0,255);i=i*(1-x)+e*x,s=s*(1-x)+e*x,c=c*(1-x)+e*x}let C=.2126*i+.7152*s+.0722*c;if(C>.001){let e=Math.max(.5,Math.min(2,S/C));i*=e,s*=e,c*=e}f[n]=Z(i,0,255)"
);

replaceExact(
  "AI sequence independent despill range setup",
  "ht=(e,t,n,r,i)=>{let a=Math.max(0,Math.min(2,Number(r)||0));if(!e?.data||!t||!n||a<=0)return e;let o=Z((Number(i)||96)*2,24,255),s=Z(n.r||0,0,255),c=Z(n.g||0,0,255),l=Z(n.b||0,0,255),u=Math.max(s,c,l)-Math.min(s,c,l)>=18?c>=s&&c>=l?1:s>=l?0:2:-1,d=ut({r:s,g:c,b:l});if(Math.sqrt(d.cb*d.cb+d.cr*d.cr)<.035)return e;let f=e.data;for(",
  "ht=(e,t,n,r,i,j=1)=>{let a=Math.max(0,Math.min(2,Number(r)||0));if(!e?.data||!t||!n||a<=0)return e;let o=Z((Number(i)||96)*2,24,255),s=Z(n.r||0,0,255),c=Z(n.g||0,0,255),l=Z(n.b||0,0,255),u=Math.max(s,c,l)-Math.min(s,c,l)>=18?c>=s&&c>=l?1:s>=l?0:2:-1,d=ut({r:s,g:c,b:l});if(Math.sqrt(d.cb*d.cb+d.cr*d.cr)<.035)return e;let f=e.data,nfRangeScale=Math.max(1,Math.min(1.5,Number(j)||1)),nfExtendedRadius=Math.min(384,o*nfRangeScale),nfRangeProgress=Q((nfRangeScale-1)/.5);for("
);

replaceLegacyExact(
  "AI sequence despill range removes base-radius seam",
  "h=Math.sqrt(p*p+m*m)*512,g=h>=o?0:Q(1-h/o),_=0;if(u>=0){let e=(u===0?i:u===1?s:c)-(u===0?Math.max(s,c):u===1?Math.max(i,c):Math.max(i,s));e>0&&(_=Q(e/32))}let nfRangeMatch=0;if(nfRangeProgress>0&&u>=0&&h>=o&&h<nfExtendedRadius){let e=u===0?i:u===1?s:c,t=u===0?(s+c)/2:u===1?(i+c)/2:(i+s)/2;e>t&&(nfRangeMatch=nfRangeProgress*Q(1-(h-o)/Math.max(1e-6,nfExtendedRadius-o)))}let v=Math.max(g,_,nfRangeMatch),",
  "h=Math.sqrt(p*p+m*m)*512,g=h>=o?0:Q(1-h/o),_=0;if(u>=0){let e=(u===0?i:u===1?s:c)-(u===0?Math.max(s,c):u===1?Math.max(i,c):Math.max(i,s));e>0&&(_=Q(e/32))}let nfRangeMatch=0;if(nfRangeProgress>0&&u>=0&&h<nfExtendedRadius){let e=u===0?i:u===1?s:c,t=u===0?(s+c)/2:u===1?(i+c)/2:(i+s)/2;e>t&&(nfRangeMatch=nfRangeProgress*Q(1-(h-o)/Math.max(1e-6,nfExtendedRadius-o)))}let v=Math.max(g,_,nfRangeMatch),"
);

replaceLegacyExact(
  "AI sequence despill range protects warm keyed materials",
  "h=Math.sqrt(p*p+m*m)*512,g=h>=o?0:Q(1-h/o),_=0;if(u>=0){let e=(u===0?i:u===1?s:c)-(u===0?Math.max(s,c):u===1?Math.max(i,c):Math.max(i,s));e>0&&(_=Q(e/32))}let nfRangeMatch=0;if(nfRangeProgress>0&&u>=0&&h<nfExtendedRadius){let e=u===0?i:u===1?s:c,t=u===0?(s+c)/2:u===1?(i+c)/2:(i+s)/2;e>t&&(nfRangeMatch=nfRangeProgress*Q(1-(h-o)/Math.max(1e-6,nfExtendedRadius-o)))}let v=Math.max(g,_,nfRangeMatch),",
  "h=Math.sqrt(p*p+m*m)*512,g=h>=o?0:Q(1-h/o),_=0;if(u>=0){let e=(u===0?i:u===1?s:c)-(u===0?Math.max(s,c):u===1?Math.max(i,c):Math.max(i,s));e>0&&(_=Q(e/32))}let nfRangeMatch=0;if(nfRangeProgress>0&&u>=0&&h<nfExtendedRadius){let e=u===0?i:u===1?s:c,t=u===0?(s+c)/2:u===1?(i+c)/2:(i+s)/2,nfRangeGuard=u===0?i>=c:u===1?s>=i:c>=s;e>t&&nfRangeGuard&&(nfRangeMatch=nfRangeProgress*Q(1-(h-o)/Math.max(1e-6,nfExtendedRadius-o)))}let v=Math.max(g,_,nfRangeMatch),"
);

replaceLegacyExact(
  "AI sequence independent despill range match",
  "h=Math.max(0,Math.min(255,Math.sqrt(p*p+m*m)*512)),g=h>=o?0:Q(1-h/o),_=0;if(u>=0){let e=(u===0?i:u===1?s:c)-(u===0?Math.max(s,c):u===1?Math.max(i,c):Math.max(i,s));e>0&&(_=Q(e/32))}let v=Math.max(g,_),",
  "h=Math.sqrt(p*p+m*m)*512,g=h>=o?0:Q(1-h/o),_=0;if(u>=0){let e=(u===0?i:u===1?s:c)-(u===0?Math.max(s,c):u===1?Math.max(i,c):Math.max(i,s));e>0&&(_=Q(e/32))}let nfRangeMatch=0;if(nfRangeProgress>0&&u>=0&&h<nfExtendedRadius){let e=u===0?i:u===1?s:c,t=u===0?(s+c)/2:u===1?(i+c)/2:(i+s)/2,nfRangeGuard=u===0?i>=c:u===1?s>=i:c>=s;e>t&&nfRangeGuard&&(nfRangeMatch=nfRangeProgress*Q(1-(h-o)/Math.max(1e-6,nfExtendedRadius-o)))}let v=Math.max(g,_,nfRangeMatch),"
);

replaceLegacyExact(
  "AI sequence despill range uses smooth cool-neutral material guard",
  "h=Math.sqrt(p*p+m*m)*512,g=h>=o?0:Q(1-h/o),_=0;if(u>=0){let e=(u===0?i:u===1?s:c)-(u===0?Math.max(s,c):u===1?Math.max(i,c):Math.max(i,s));e>0&&(_=Q(e/32))}let nfRangeMatch=0;if(nfRangeProgress>0&&u>=0&&h<nfExtendedRadius){let e=u===0?i:u===1?s:c,t=u===0?(s+c)/2:u===1?(i+c)/2:(i+s)/2,nfRangeGuard=u===0?i>=c:u===1?s>=i:c>=s;e>t&&nfRangeGuard&&(nfRangeMatch=nfRangeProgress*Q(1-(h-o)/Math.max(1e-6,nfExtendedRadius-o)))}let v=Math.max(g,_,nfRangeMatch),",
  "h=Math.sqrt(p*p+m*m)*512,g=h>=o?0:Q(1-h/o),_=0;if(u>=0){let e=(u===0?i:u===1?s:c)-(u===0?Math.max(s,c):u===1?Math.max(i,c):Math.max(i,s));e>0&&(_=Q(e/32))}let nfRangeMatch=0;if(nfRangeProgress>0&&u>=0&&h<nfExtendedRadius){let e=u===0?i:u===1?s:c,t=u===0?(s+c)/2:u===1?(i+c)/2:(i+s)/2,nfRangeGuard=u===1?Q((c-i+24)/24):u===0?i>=c?1:0:c>=s?1:0;e>t&&nfRangeGuard>0&&(nfRangeMatch=nfRangeGuard*Q(1-h/Math.max(1e-6,nfExtendedRadius)))}let v=Math.max(g,_,nfRangeMatch),"
);

replaceLegacyExact(
  "AI sequence despill range reaches low-saturation keyed residue",
  "nfRangeMatch=nfRangeGuard*Q(1-h/Math.max(1e-6,nfExtendedRadius))",
  "nfRangeMatch=nfRangeGuard*Math.max(Q(1-h/Math.max(1e-6,nfExtendedRadius)),nfRangeProgress*.55*Q((e-t)/12))"
);

replaceLegacyExact(
  "AI sequence despill range uses the relative expansion band for green residue",
  "h=Math.sqrt(p*p+m*m)*512,g=h>=o?0:Q(1-h/o),_=0;if(u>=0){let e=(u===0?i:u===1?s:c)-(u===0?Math.max(s,c):u===1?Math.max(i,c):Math.max(i,s));e>0&&(_=Q(e/32))}let nfRangeMatch=0;if(nfRangeProgress>0&&u>=0&&h<nfExtendedRadius){let e=u===0?i:u===1?s:c,t=u===0?(s+c)/2:u===1?(i+c)/2:(i+s)/2,nfRangeGuard=u===1?Q((c-i+24)/24):u===0?i>=c?1:0:c>=s?1:0;e>t&&nfRangeGuard>0&&(nfRangeMatch=nfRangeGuard*Math.max(Q(1-h/Math.max(1e-6,nfExtendedRadius)),nfRangeProgress*.55*Q((e-t)/12)))}let v=Math.max(g,_,nfRangeMatch),",
  "h=Math.sqrt(p*p+m*m)*512,g=h>=o?0:Q(1-h/o),_=0;if(u>=0){let e=(u===0?i:u===1?s:c)-(u===0?Math.max(s,c):u===1?Math.max(i,c):Math.max(i,s));e>0&&(_=Q(e/32))}let nfRangeMatch=0;if(nfRangeProgress>0&&u>=0&&h<nfExtendedRadius){let e=u===0?i:u===1?s:c,t=u===0?(s+c)/2:u===1?(i+c)/2:(i+s)/2;if(u===1){let nfRangeGuard=Q((c-i+4)/4),nfRangeTone=Q((e-t-4)/6);nfRangeTone*=nfRangeTone*(3-2*nfRangeTone),nfRangeGuard>0&&nfRangeTone>0&&(nfRangeMatch=nfRangeProgress*nfRangeGuard*nfRangeTone*Q(1-Math.max(0,h-o)/Math.max(1e-6,nfExtendedRadius-o)))}else{let nfRangeGuard=u===0?i>=c?1:0:c>=s?1:0;e>t&&nfRangeGuard>0&&(nfRangeMatch=nfRangeGuard*Math.max(Q(1-h/Math.max(1e-6,nfExtendedRadius)),nfRangeProgress*.55*Q((e-t)/12)))}}let v=Math.max(g,_,nfRangeMatch),"
);

replaceExact(
  "AI sequence despill range preset defaults",
  "ge={green:{pickHex:`#00ff00`,keyColors:[{r:0,g:255,b:0}],keyThreshold:86,keySoft:123,maskThreshold:.68,maskFeather:.24,maskBlurPx:1,edgeTrimPx:0,edgeRefine:.3,edgeRefinePx:5,globalDespill:2},white:{pickHex:`#ffffff`,keyColors:[{r:255,g:255,b:255}],keyThreshold:64,keySoft:51,maskThreshold:.6,maskFeather:.09,maskBlurPx:1,edgeTrimPx:0,edgeRefine:.3,edgeRefinePx:5,globalDespill:.85},black:{pickHex:`#000000`,keyColors:[{r:0,g:0,b:0}],keyThreshold:38,keySoft:23,maskThreshold:.44,maskFeather:.48,maskBlurPx:1,edgeTrimPx:0,edgeRefine:.5,edgeRefinePx:10,globalDespill:1.87}},",
  "ge={green:{pickHex:`#00ff00`,keyColors:[{r:0,g:255,b:0}],keyThreshold:86,keySoft:123,maskThreshold:.68,maskFeather:.24,maskBlurPx:1,edgeTrimPx:0,edgeRefine:.3,edgeRefinePx:5,globalDespill:2,despillRangeScale:1},white:{pickHex:`#ffffff`,keyColors:[{r:255,g:255,b:255}],keyThreshold:64,keySoft:51,maskThreshold:.6,maskFeather:.09,maskBlurPx:1,edgeTrimPx:0,edgeRefine:.3,edgeRefinePx:5,globalDespill:.85,despillRangeScale:1},black:{pickHex:`#000000`,keyColors:[{r:0,g:0,b:0}],keyThreshold:38,keySoft:23,maskThreshold:.44,maskFeather:.48,maskBlurPx:1,edgeTrimPx:0,edgeRefine:.5,edgeRefinePx:10,globalDespill:1.87,despillRangeScale:1}},"
);

replaceExact(
  "AI sequence despill range state",
  "[He,Ue]=(0,_.useState)(()=>ge.green.globalDespill),We=e=>",
  "[He,Ue]=(0,_.useState)(()=>ge.green.globalDespill),[nfDespillRangeScale,nfSetDespillRangeScale]=(0,_.useState)(()=>ge.green.despillRangeScale),We=e=>"
);

replaceExact(
  "AI sequence despill range preset application",
  "Ue(Math.max(0,Math.min(2,Number(e.globalDespill)||0)))},[Ge,Ke]",
  "Ue(Math.max(0,Math.min(2,Number(e.globalDespill)||0))),nfSetDespillRangeScale(Math.max(1,Math.min(1.5,Number(e.despillRangeScale)||1)))},[Ge,Ke]"
);

replaceExact(
  "AI sequence despill range cache identity",
  ",ie,Fn,ye,s,De,ke,je,Ne,Y,Be,Ie,Re,He].join(`|`)",
  ",ie,Fn,ye,s,De,ke,je,Ne,Y,Be,Ie,Re,He,nfDespillRangeScale].join(`|`)"
);

replaceExact(
  "AI sequence preview uses despill range",
  "R===`ai`?pt(e.frame,t.finalAlpha,i,He,120):ht(e.frame,t.finalAlpha,i,He,ke)",
  "R===`ai`?pt(e.frame,t.finalAlpha,i,He,120):ht(e.frame,t.finalAlpha,i,He,ke,nfDespillRangeScale)"
);

replaceExact(
  "AI sequence board stores despill range",
  "edgeRefine:Ie,edgeRefinePx:Re,globalDespill:He,tool:Ge",
  "edgeRefine:Ie,edgeRefinePx:Re,globalDespill:He,despillRangeScale:nfDespillRangeScale,tool:Ge"
);

replaceExact(
  "AI sequence board restores despill range",
  "Ue(Math.max(0,Math.min(2,Number(t.globalDespill)||0))),Ke(t.tool===`erase`",
  "Ue(Math.max(0,Math.min(2,Number(t.globalDespill)||0))),nfSetDespillRangeScale(Math.max(1,Math.min(1.5,Number(t.despillRangeScale)||1))),Ke(t.tool===`erase`"
);

replaceExact(
  "AI sequence live preview dependency tracks despill range",
  "[N,b,V,S,y,j,R,ie,_e,De,ke,je,Ne,Y,Be,Ie,Re,He,p,m,C,ut,yr,pn,Fn]",
  "[N,b,V,S,y,j,R,ie,_e,De,ke,je,Ne,Y,Be,Ie,Re,He,nfDespillRangeScale,p,m,C,ut,yr,pn,Fn]"
);

replaceExact(
  "AI sequence playback dependency tracks despill range",
  "[N,b,V,T,E,w,j,R,ie,_e,De,ke,je,Ne,Y,Be,Ie,Re,He,p,m,ut,r,e.inputSourceKind,a,pn]",
  "[N,b,V,T,E,w,j,R,ie,_e,De,ke,je,Ne,Y,Be,Ie,Re,He,nfDespillRangeScale,p,m,ut,r,e.inputSourceKind,a,pn]"
);

replaceLegacyExact(
  "AI sequence old boards export at the compatible despill range",
  "despillRangeScale:Math.max(1,Math.min(1.5,Number(F?.despillRangeScale??nfDespillRangeScale)||1))}",
  "despillRangeScale:Math.max(1,Math.min(1.5,Number(F?(F.despillRangeScale??1):nfDespillRangeScale)||1))}"
);

replaceLegacyExact(
  "AI sequence export resolves inactive board state identity",
  "N=`${String(s||``)}::${String(e?.currentSrc||e.src||``)}::${Z(Math.round(_*1e3),0,2147483647)}`,F=Zt.current.get(N),I={pickHex",
  "N=`${String(s||``)}::${String(e?.currentSrc||e.src||``)}::${Z(Math.round(_*1e3),0,2147483647)}`,nfBoardStateKey=p?`${String(s||``)}::::${String(e?.currentSrc||e.src||``).length}`:`${String(s||``)}::${String(e?.currentSrc||e.src||``)}::`,F=nfBoardStateKey===yr?null:Zt.current.get(N)||Zt.current.get(nfBoardStateKey),I={pickHex"
);

replaceLegacyExact(
  "AI sequence export state fallback stays on keyed boards",
  "F=nfBoardStateKey===yr?null:Zt.current.get(N)||Zt.current.get(nfBoardStateKey),I={pickHex",
  "nfBoardState=nfBoardStateKey===yr?null:Zt.current.get(N)||Zt.current.get(nfBoardStateKey),F=nfBoardState?.matteMode===`key`?nfBoardState:null,I={pickHex"
);

replaceExact(
  "AI sequence export settings include despill range",
  "edgeRefine:Q(Number(F?.edgeRefine??Ie)),edgeRefinePx:Z(Number(F?.edgeRefinePx??Re)||1,1,20),globalDespill:Math.max(0,Math.min(2,Number(F?.globalDespill??He)||0))}",
  "edgeRefine:Q(Number(F?.edgeRefine??Ie)),edgeRefinePx:Z(Number(F?.edgeRefinePx??Re)||1,1,20),globalDespill:Math.max(0,Math.min(2,Number(F?.globalDespill??He)||0)),despillRangeScale:Math.max(1,Math.min(1.5,Number(F?(F.despillRangeScale??1):nfDespillRangeScale)||1))}"
);

replaceExact(
  "AI sequence export uses keyed despill range only",
  "ht(r.frame,e.finalAlpha,t,I.globalDespill,I.keySoft)",
  "ht(r.frame,e.finalAlpha,t,I.globalDespill,I.keySoft,ee===`key`?I.despillRangeScale:1)"
);

replaceExact(
  "AI sequence export dependency tracks despill range",
  "[O,N,r,a,e.boards,o,s,c,l,u,d,f,k,A,w,T,E,_e,De,ke,je,Ne,Y,Be,Ie,Re,He,j,ut]",
  "[O,N,r,a,e.boards,o,s,c,l,u,d,f,k,A,w,T,E,_e,De,ke,je,Ne,Y,Be,Ie,Re,He,nfDespillRangeScale,j,ut]"
);

replaceLegacyExact(
  "AI sequence edge refine radius label",
  "children:`范围`}),(0,X.jsx)(`input`,{type:`range`,min:1,max:20,step:1,value:Re",
  "children:`精修半径`}),(0,X.jsx)(`input`,{type:`range`,min:1,max:20,step:1,value:Re"
);

replaceLegacyExact(
  "AI sequence edge refine radius uses the compact label",
  "children:`精修半径`}),(0,X.jsx)(`input`,{type:`range`,min:1,max:20,step:1,value:Re",
  "children:`半径`}),(0,X.jsx)(`input`,{type:`range`,min:1,max:20,step:1,value:Re"
);

replaceLegacyExact(
  "AI sequence despill range controls",
  "(0,X.jsxs)(`div`,{style:{display:`grid`,gridTemplateColumns:`52px minmax(0, 1fr) 56px`,gap:8,alignItems:`center`},children:[(0,X.jsx)(`div`,{style:{fontSize:11,color:`rgba(255,255,255,0.70)`,fontWeight:900},children:`抑色`}),(0,X.jsx)(`input`,{type:`range`,min:0,max:2,step:.01,value:He,onChange:e=>(wi(),Ue(Math.max(0,Math.min(2,Number(e.target.value)||0)))),style:{width:`100%`,accentColor:`#14b8a6`,cursor:`pointer`}}),(0,X.jsx)(`input`,{type:`number`,min:0,max:2,step:.01,value:He,onChange:e=>(wi(),Ue(Math.max(0,Math.min(2,Number(e.target.value)||0)))),style:{width:56,padding:`5px 8px`,background:`#151515`,border:`1px solid rgba(255,255,255,0.10)`,borderRadius:8,color:`#fff`,fontSize:12,outline:`none`,textAlign:`right`}})]})]})",
  "(0,X.jsxs)(`div`,{style:{display:`grid`,gridTemplateColumns:`52px minmax(0, 1fr) 56px`,gap:8,alignItems:`center`},children:[(0,X.jsx)(`div`,{style:{fontSize:11,color:`rgba(255,255,255,0.70)`,fontWeight:900},children:`抑色`}),(0,X.jsx)(`input`,{type:`range`,min:0,max:2,step:.01,value:He,onChange:e=>(wi(),Ue(Math.max(0,Math.min(2,Number(e.target.value)||0)))),style:{width:`100%`,accentColor:`#14b8a6`,cursor:`pointer`}}),(0,X.jsx)(`input`,{type:`number`,min:0,max:2,step:.01,value:He,onChange:e=>(wi(),Ue(Math.max(0,Math.min(2,Number(e.target.value)||0)))),style:{width:56,padding:`5px 8px`,background:`#151515`,border:`1px solid rgba(255,255,255,0.10)`,borderRadius:8,color:`#fff`,fontSize:12,outline:`none`,textAlign:`right`}})]}),(0,X.jsxs)(`div`,{\"data-novaflow-ai-despill-range\":`1`,style:{display:`grid`,gridTemplateColumns:`52px minmax(0, 1fr) 56px`,gap:8,alignItems:`center`},children:[(0,X.jsx)(`div`,{style:{fontSize:11,color:`rgba(255,255,255,0.70)`,fontWeight:900},children:`抑色范围`}),(0,X.jsx)(`input`,{type:`range`,min:100,max:150,step:5,value:Math.round(100*nfDespillRangeScale),onChange:e=>(wi(),nfSetDespillRangeScale(Math.max(1,Math.min(1.5,(Number(e.target.value)||100)/100)))),style:{width:`100%`,accentColor:`#14b8a6`,cursor:`pointer`}}),(0,X.jsx)(`input`,{type:`number`,min:100,max:150,step:5,value:Math.round(100*nfDespillRangeScale),onChange:e=>(wi(),nfSetDespillRangeScale(Math.max(1,Math.min(1.5,(Number(e.target.value)||100)/100)))),style:{width:56,padding:`5px 8px`,background:`#151515`,border:`1px solid rgba(255,255,255,0.10)`,borderRadius:8,color:`#fff`,fontSize:12,outline:`none`,textAlign:`right`}})]})]})"
);

replaceLegacyExact(
  "AI sequence despill range uses the compact label",
  "\"data-novaflow-ai-despill-range\":`1`,style:{display:`grid`,gridTemplateColumns:`52px minmax(0, 1fr) 56px`,gap:8,alignItems:`center`},children:[(0,X.jsx)(`div`,{style:{fontSize:11,color:`rgba(255,255,255,0.70)`,fontWeight:900},children:`抑色范围`})",
  "\"data-novaflow-ai-despill-range\":`1`,style:{display:`grid`,gridTemplateColumns:`52px minmax(0, 1fr) 56px`,gap:8,alignItems:`center`},children:[(0,X.jsx)(`div`,{style:{fontSize:11,color:`rgba(255,255,255,0.70)`,fontWeight:900},children:`范围`})"
);

replaceExact(
  "AI sequence despill range controls stay in key mode",
  "}),(0,X.jsxs)(`div`,{\"data-novaflow-ai-despill-range\":`1`",
  "}),R===`key`&&(0,X.jsxs)(`div`,{\"data-novaflow-ai-despill-range\":`1`"
);

replaceLegacyExact(
  "AI sequence export dialog strips a typed extension",
  "nfExportBaseName=Array.from(String(r||a||`export`)).filter(e=>{let t=e.charCodeAt(0);return t>=32&&t!==127}).join(``).replace(/[<>:\"/\\\\|?*]/g,`_`).replace(/[. ]+$/g,``).trim().slice(0,80)||`export`",
  "nfExportBaseName=Array.from(String(r||a||`export`)).filter(e=>{let t=e.charCodeAt(0);return t>=32&&t!==127}).join(``).replace(/[<>:\"/\\\\|?*]/g,`_`).replace(/\\.[a-z0-9]{1,8}$/i,``).replace(/[. ]+$/g,``).trim().slice(0,80)||`export`"
);

replaceExact(
  "AI sequence export dialog derives the manual base name",
  "if(!t)return null;let F=!!(s&&c),I=F?`ai`:`particle`,L=F?`ai`:`particle`,ee=l===`skeleton`;return",
  "if(!t)return null;let F=!!(s&&c),I=F?`ai`:`particle`,L=F?`ai`:`particle`,ee=l===`skeleton`,nfExportBaseName=Array.from(String(r||a||`export`)).filter(e=>{let t=e.charCodeAt(0);return t>=32&&t!==127}).join(``).replace(/[<>:\"/\\\\|?*]/g,`_`).replace(/\\.[a-z0-9]{1,8}$/i,``).replace(/[. ]+$/g,``).trim().slice(0,80)||`export`;return"
);

replaceExact(
  "AI sequence export dialog passes the manual base name",
  "D({title:`LOADING`,detail:`正在导出…`});try{await e(),n(null)}",
  "D({title:`LOADING`,detail:`正在导出…`});try{await e({baseName:nfExportBaseName}),n(null)}"
);

replaceLegacyExact(
  "AI sequence exporter strips a typed extension",
  "nfExportBaseName=Array.from(String(n?.baseName||`NF`)).filter(e=>{let t=e.charCodeAt(0);return t>=32&&t!==127}).join(``).replace(/[<>:\"/\\\\|?*]/g,`_`).replace(/[. ]+$/g,``).trim().slice(0,80)||`NF`",
  "nfExportBaseName=Array.from(String(n?.baseName||`NF`)).filter(e=>{let t=e.charCodeAt(0);return t>=32&&t!==127}).join(``).replace(/[<>:\"/\\\\|?*]/g,`_`).replace(/\\.[a-z0-9]{1,8}$/i,``).replace(/[. ]+$/g,``).trim().slice(0,80)||`NF`"
);

replaceExact(
  "AI sequence exporter normalizes the requested base name",
  "let b=e=>String(e).padStart(4,`0`),x=n?.rawDir",
  "let b=e=>String(e).padStart(4,`0`),nfExportBaseName=Array.from(String(n?.baseName||`NF`)).filter(e=>{let t=e.charCodeAt(0);return t>=32&&t!==127}).join(``).replace(/[<>:\"/\\\\|?*]/g,`_`).replace(/\\.[a-z0-9]{1,8}$/i,``).replace(/[. ]+$/g,``).trim().slice(0,80)||`NF`,x=n?.rawDir"
);

replaceExact(
  "AI sequence multi-board export uses the requested base name",
  "g=`NF_${e+1}`",
  "g=`${nfExportBaseName}_${e+1}`"
);

replaceExact(
  "AI sequence single-board export uses the requested base name",
  "!i&&p?await _(await m(p),0,o,s,`NF`,`compose_image`,r||`image.png`,.01):await _(i,0,o,s,`NF`,e.inputSourceKind,r,t)",
  "!i&&p?await _(await m(p),0,o,s,nfExportBaseName,`compose_image`,r||`image.png`,.01):await _(i,0,o,s,nfExportBaseName,e.inputSourceKind,r,t)"
);

replaceLegacyExact(
  "AI sequence Spine package removes the generated bg suffix",
  "u=[],d=`${nfExportBaseName}_bg`;",
  "u=[],d=nfExportBaseName;"
);

replaceExact(
  "AI sequence Spine package uses the requested base name",
  "u=[],d=`NF_bg`;",
  "u=[],d=nfExportBaseName;"
);

replaceExact(
  "AI sequence exporter reports the requested frame pattern",
  "pattern:`NF_%04d.png`};return n?.silent",
  "pattern:`${nfExportBaseName}_%04d.png`};return n?.silent"
);

replaceExact(
  "MiniMax H3 LoRA mode body width ownership compatibility",
  'r===`minimax_h3_local`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`,"data-novaflow-h3-lora-section":`1`,style:',
  'r===`minimax_h3_local`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-lora-section":`1`,"data-novaflow-h3-lora-section":`1`,"data-novaflow-ai-mode-body-item":`1`,style:'
);

if (verifyHeadReplay) {
  const replayComparable = source.replace(/\r\n?/g, "\n");
  const diskComparable = diskSource.replace(/\r\n?/g, "\n");
  if (replayComparable !== diskComparable) {
    let firstDifference = 0;
    while (
      firstDifference < replayComparable.length &&
      firstDifference < diskComparable.length &&
      replayComparable[firstDifference] === diskComparable[firstDifference]
    ) {
      firstDifference += 1;
    }
    throw new Error(
      `AI sequence cutout edit HEAD replay did not reproduce the current bundle: firstDifference=${firstDifference} replayLength=${replayComparable.length} diskLength=${diskComparable.length} replay=${JSON.stringify(replayComparable.slice(firstDifference, firstDifference + 160))} disk=${JSON.stringify(diskComparable.slice(firstDifference, firstDifference + 160))}`
    );
  }
  console.log("AI sequence cutout edit HEAD replay matches current bundle");
} else {
  if (changed) fs.writeFileSync(bundlePath, source, "utf8");
  console.log(changed ? `patched ${path.relative(repoRoot, bundlePath)}` : "AI sequence cutout edit patches already applied");
}
