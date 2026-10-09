// 视频抠图 has two ways in again (2026-10-09): AI 抠图 (subject masks from a compute node, then the
// chroma matte) and 色键抠图 (the chroma matte alone: no AI, no compute node). patch-cutout-unified-tool
// had merged them into one AI entry and pinned the pipeline to AI. 色键 keeps the same three switches
// as AI mode: 光效透明保留 on runs the chroma/glow matte (partial alpha for glows and particles), off
// the manual key with its sliders; 保留投影 and 边缘净化 apply as in AI mode. The bundle's own entries
// stay hidden; the runtime's 视频抠图 row offers the two buttons and clicks these.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const KEY_ENTRY_ATTR = 'data-novaflow-video-cutout-key';

export function patchCutoutKeyEntry(source) {
  const patches = [
    // The pipeline follows the chosen entry instead of always AI.
    ['let nfUnifiedVideoCutoutV1=!0,R=`ai`;', 'let nfUnifiedVideoCutoutV1=!0,R=nfCutoutMode===`key`?`key`:`ai`;'],
    // 色键 never asks for AI subject masks, so it needs no compute node.
    ['if(!Vn||or||N&&V&&nfCutoutMode!==mode)return;if((mode===`ai`||nfGreenScreen)&&!zn&&!Rn)return;if(N&&!V&&nfCutoutMode===mode){H(!0);if((mode===`ai`||nfGreenScreen)&&',
      'if(!Vn||or||N&&V&&nfCutoutMode!==mode)return;if(mode===`ai`&&!zn&&!Rn)return;if(N&&!V&&nfCutoutMode===mode){H(!0);if(mode===`ai`&&'],
    ['if(mode===`ai`||nfGreenScreen)nfStartCutoutSubject(cap)', 'if(mode===`ai`)nfStartCutoutSubject(cap)'],
    // Xn marks the preview dirty only once its render loop runs, which starts with the editing
    // state this same click sets; 色键 has no subject masks arriving later to redraw, so the
    // first matte would never be shown. Mark it again once the loop is up.
    ['if(mode===`ai`)nfStartCutoutSubject(cap);else{cap?.frame&&fr(dr(cap.frame));Xn(`dirty`)}',
      'if(mode===`ai`)nfStartCutoutSubject(cap);else{cap?.frame&&fr(dr(cap.frame));Xn(`dirty`);[60,240].forEach(nfDelay=>setTimeout(()=>Xn(`dirty`),nfDelay))}'],
    ['ui=()=>nfOpenCutoutTool(`ai`),', 'ui=()=>nfOpenCutoutTool(`ai`),nfOpenKeyCutout=()=>nfOpenCutoutTool(`key`),'],
    // The second hidden entry, beside the AI one.
    ['gridTemplateColumns:`1fr`,gap:10},children:(0,X.jsx)(`div`,{role:`button`,"data-novaflow-video-cutout":`1`,onClick:()=>{Vn&&(async()=>{try{await ui()}catch(e){alert(String(e?.message||e||`抠图失败`))}})()},',
      'gridTemplateColumns:`1fr`,gap:10},children:[(0,X.jsx)(`div`,{role:`button`,"' + KEY_ENTRY_ATTR + '":`1`,onClick:()=>{Vn&&(async()=>{try{await nfOpenKeyCutout()}catch(e){alert(String(e?.message||e||`抠图失败`))}})()},"aria-disabled":!Vn||or,tabIndex:-1,style:{display:`none`},children:`色键抠图`}),(0,X.jsx)(`div`,{role:`button`,"data-novaflow-video-cutout":`1`,onClick:()=>{Vn&&(async()=>{try{await ui()}catch(e){alert(String(e?.message||e||`抠图失败`))}})()},'],
    ['children:N&&V?`关闭视频抠图`:or?`处理中...`:`视频抠图`})}),nfColorCorrectionOpen&&',
      'children:N&&V?`关闭视频抠图`:or?`处理中...`:`视频抠图`})]}),nfColorCorrectionOpen&&']
  ];
  for (const [before, after] of patches) {
    if (source.includes(after)) continue;
    const at = source.indexOf(before);
    if (at < 0 || at !== source.lastIndexOf(before)) throw new Error('Cutout key entry anchor missing or ambiguous: ' + before.slice(0, 100));
    source = source.replace(before, () => after);
  }
  return source;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = new URL('../novaflow-web/renderer/assets/index-BbIa-2NM.js', import.meta.url);
  const before = fs.readFileSync(file, 'utf8');
  const after = patchCutoutKeyEntry(before);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
  console.log(after === before ? 'already patched' : 'patched');
}
