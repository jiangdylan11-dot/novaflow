// 视频抠图 save (2026-10-14): saving renders every frame at full size one after another. When a
// switch changes after the cutout (半透明材质, 保留投影, …) the prepared frames no longer match,
// so each frame is re-matted on save: DivinePower.mp4 (117 frames, 1080x1920) sat on
// 正在保存抠图结果 for about 2.7 minutes (1.4 s a frame). Frames rendered from the captured
// decoded frames (AI / 色键 with the chroma matte) use isolated canvases and the matting worker
// pool, so the save now keeps as many frames in flight as that pool has workers, still writing
// them in order. Other paths (seeking the media per frame) stay one at a time.
// The per-frame progress never reached the overlay: `ce` (the save source) is read from this inner
// function's own third parameter, not the save options, so it was never `save-and-close` and the
// overlay stayed on 正在保存抠图结果… for the whole save. Progress is now always sent; only the
// saving overlay listens.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const MARK = 'nfSaveAhead';
const RENDER = 'rr({media:e,cacheMedia:nfCacheMedia,sourceFrameIndex:nfUseBoardPlan?void 0:E+t,timeSec:A[t],traceSurface:ce,exportFrameIndex:t,strictFrameSync:!0,exportMedia:!0})';
const BEFORE = 'for(let t=0;t<A.length;t++){let n=A[t];if(ce===`save-and-close`)window.dispatchEvent(new CustomEvent(`novaflow:cutout-save-progress`,{detail:{stage:`frames`,current:t,total:A.length}}));if(g){let r=await rr({media:e,cacheMedia:nfCacheMedia,sourceFrameIndex:nfUseBoardPlan?void 0:E+t,timeSec:n,traceSurface:ce,exportFrameIndex:t,strictFrameSync:!0,exportMedia:!0});';
const AFTER = 'const nfSaveAhead=new Map(),nfSaveWidth=g&&R===`ai`&&nfGreenScreen&&fe.current?.frames?.size?Math.max(1,Math.min(6,window.NovaFlowGreenScreenMatting?.parallelism?.(U.width,U.height)||1)):1,'
  + 'nfSaveRender=t=>{if(t>=A.length||nfSaveAhead.has(t))return;const nfPending=' + RENDER + ';nfPending.catch(()=>{});nfSaveAhead.set(t,nfPending)};'
  + 'for(let t=0;t<A.length;t++){let n=A[t];window.dispatchEvent(new CustomEvent(`novaflow:cutout-save-progress`,{detail:{stage:`frames`,current:t,total:A.length}}));'
  + 'if(g){for(let nfNext=t;nfNext<t+nfSaveWidth;nfNext++)nfSaveRender(nfNext);let r=await nfSaveAhead.get(t);nfSaveAhead.delete(t);';

const REUSE = 'if(ce===`save-and-close`&&r.cacheHit)window.dispatchEvent(new CustomEvent(`novaflow:cutout-save-progress`,{detail:{stage:`reuse`';

export function patchCutoutParallelSave(source) {
  if (source.includes(MARK)) return source;
  for (const anchor of [BEFORE, REUSE]) {
    const at = source.indexOf(anchor);
    if (at < 0 || at !== source.lastIndexOf(anchor)) throw new Error('Parallel save anchor missing or ambiguous: ' + anchor.slice(0, 80));
  }
  return source.replace(BEFORE, () => AFTER).replace(REUSE, () => REUSE.replace('ce===`save-and-close`&&', ''));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = new URL('../novaflow-web/renderer/assets/index-BbIa-2NM.js', import.meta.url);
  const before = fs.readFileSync(file, 'utf8');
  const after = patchCutoutParallelSave(before);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
  console.log(after === before ? 'already patched' : 'patched');
}
