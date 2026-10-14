// 视频抠图 has two ways in again (2026-10-14): AI抠图 (as before) and 色键抠图. The 2026-10-09
// version (06e54af, reverted in 2b55d54) ran 色键 off the live <video>, whose seeks land on a
// neighbouring frame: the preview drifted and saving failed with `video currentTime drift`.
// Now 色键 is the AI session minus the AI step: the same verified frame capture (pe), the same
// decoded-frame preview/save path, and per frame the automatic chroma/glow matte without a
// subject mask. A frame whose border a burst covers uses the clip's screen, a clip with no plain
// screen stays untouched, and 去底 / 实心 fine-tune the automatic alpha (0 = automatic).
// The bundle's own entries stay hidden; the runtime's 视频抠图 row offers the two buttons.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const KEY_ENTRY_ATTR = 'data-novaflow-video-cutout-key';
const MARK = 'nfKeyFloor';

const tuneRow = (label, title, value, set) => '(0,X.jsxs)(`div`,{"data-novaflow-ai-cutout-param-row":`1`,title:`' + title + '`,style:{display:`grid`,gridTemplateColumns:`26px minmax(0, 1fr) 50px`,gap:3,alignItems:`center`},children:['
  + '(0,X.jsx)(`div`,{style:{fontSize:11,color:`rgba(255,255,255,0.70)`,fontWeight:600},children:`' + label + '`}),'
  + '(0,X.jsx)(`input`,{"data-novaflow-ai-cutout-param-range":`1`,type:`range`,min:0,max:100,step:1,value:' + value + ',onChange:e=>(wi(e),' + set + '(Z(+e.target.value,0,100))),style:{width:`100%`,accentColor:`#1ea672`,cursor:`pointer`}}),'
  + '(0,X.jsx)(`input`,{"data-novaflow-ai-cutout-param-value":`1`,type:`number`,min:0,max:100,step:1,value:' + value + ',onChange:e=>(wi(),' + set + '(Z(+e.target.value,0,100))),style:{width:56,padding:`5px 8px`,background:`#151515`,border:`1px solid rgba(255,255,255,0.10)`,borderRadius:8,color:`#fff`,fontSize:12,outline:`none`,textAlign:`right`}})]})';

const KEY_BRANCH = 'if(nfMode===`key`){U.current.clear();'
  // Placeholder masks (empty) keep the session's "result ready" checks; the matte gets no mask.
  + 'for(const nfEntry of O){const nfNoMask=new Uint8ClampedArray(0);nfNoMask.decodedFrameIndex=nfNoMask.sourceFrameIndex=nfEntry.decodedFrameIndex;U.current.set(nfEntry.decodedFrameIndex,nfNoMask)}'
  + 'fe.current={jobId:o,frames:A};'
  + 'G.current={fps:c,frames:d,timelineFrameCount:d,alphaFrames:M,decodedFrameCount:M,w:g,h:_,duration:u,effectiveDuration:d/Math.max(1,c),times:C,sourceFrameIndices:y,decodedFrameIndices:O.map(nfEntry=>nfEntry.decodedFrameIndex),frameManifest:null,decodedFrameManifest:O,timelineToDecodedFrameMap:k,decodedManifestHash:N,'
  + 'keyScreen:window.NovaFlowGreenScreenMatting?.detectSequenceScreen?.([...A.values()].map(nfEntry=>nfEntry.frame))||null};'
  + 'Xn(`dirty`);ae(nfCount=>nfCount+1);oe({state:`done`,message:`抠图完成`,progress01:1});'
  + '[60,240].forEach(nfDelay=>window.setTimeout(()=>Xn(`dirty`),nfDelay));return}';

const edits = [
  // 去底 / 实心 state, next to the other per-session switches.
  ['[nfSheer,nfSetSheer]=(0,_.useState)(!1),', '[nfSheer,nfSetSheer]=(0,_.useState)(!1),[nfKeyFloor,nfSetKeyFloor]=(0,_.useState)(0),[nfKeySolid,nfSetKeySolid]=(0,_.useState)(0),'],
  // pe learns which cutout it runs (state set in the same click has not re-rendered yet).
  ['pe=async n=>{/* nfMaskStreamV1 */', 'pe=async(n,nfMode=nfCutoutMode)=>{/* nfMaskStreamV1 */'],
  ['oe({state:`running`,message:`AI分割中…`,progress01:0});', 'oe({state:`running`,message:nfMode===`key`?`正在准备抠图帧`:`AI分割中…`,progress01:0});'],
  ['message:`\\u6b63\\u5728\\u51c6\\u5907 AI \\u62a0\\u56fe\\u5e27 ${e+1}/${y.length}`', 'message:`${nfMode===`key`?`正在准备抠图帧`:`\\u6b63\\u5728\\u51c6\\u5907 AI \\u62a0\\u56fe\\u5e27`} ${e+1}/${y.length}`'],
  // After the verified capture, 色键 stops: no AI, the frames are the result's source.
  ['let N=await E(new TextEncoder().encode(JSON.stringify(O)));', 'let N=await E(new TextEncoder().encode(JSON.stringify(O)));' + KEY_BRANCH],
  ['nfStartCutoutSubject=cap=>{', 'nfStartCutoutSubject=(cap,nfMode)=>{'],
  ['void pe(Rn?cap.frame:void 0)}', 'void pe(Rn?cap.frame:void 0,nfMode)}'],
  ['const{cap}=ci();nfStartCutoutSubject(cap);}return}', 'const{cap}=ci();nfStartCutoutSubject(cap,mode);}return}'],
  ['if(R===`ai`&&!fe.current?.frames?.size){const{cap}=ci();nfStartCutoutSubject(cap);return}', 'if(R===`ai`&&!fe.current?.frames?.size){const{cap}=ci();nfStartCutoutSubject(cap,mode);return}'],
  // Both ways capture frames first; 色键 keeps 光效透明保留 on (off is the old live-video key).
  ['if(mode===`ai`||nfGreenScreen)nfStartCutoutSubject(cap);else{cap?.frame&&fr(dr(cap.frame));Xn(`dirty`)}',
    '{mode===`key`&&(nfGreenScreen||nfSetGreenScreen(!0),nfSetKeyFloor(0),nfSetKeySolid(0));nfStartCutoutSubject(cap,mode)}'],
  // Per-frame matte: 色键 has no subject mask, falls back to the clip's screen, keeps an
  // undetected clip as it is and applies the sliders.
  ['let nfSubjectAlpha=R===`ai`?U.current.get(', 'let nfSubjectAlpha=R===`ai`&&nfCutoutMode!==`key`?U.current.get('],
  ['?.(t,{enabled:nfGreenScreen,preserveShadow:nfPreserveShadow,cleanEdges:nfCleanEdges,sheerMaterial:nfSheer,subjectMask:nfSubjectMask,requireSubjectMask:R===`ai`,preparedFrame:',
    '?.(t,{enabled:nfGreenScreen||nfCutoutMode===`key`,preserveShadow:nfPreserveShadow,cleanEdges:nfCleanEdges,sheerMaterial:nfSheer,subjectMask:nfSubjectMask,requireSubjectMask:R===`ai`&&nfCutoutMode!==`key`,fallbackScreen:nfCutoutMode===`key`?G.current?.keyScreen||null:null,keepUndetected:nfCutoutMode===`key`,keyTune:nfCutoutMode===`key`?{floor:nfKeyFloor,solid:nfKeySolid}:null,preparedFrame:'],
  ['sequence:R===`ai`&&!e.inputImageDataUrl?{frames:', 'sequence:R===`ai`&&nfCutoutMode!==`key`&&!e.inputImageDataUrl?{frames:'],
  // 光效透明保留 and 半透明材质 mean nothing without the AI mask: hidden in 色键.
  ['(0,X.jsxs)(X.Fragment,{children:[(0,X.jsxs)(`button`,{type:`button`,role:`switch`,"aria-label":`光效透明保留`',
    '(0,X.jsxs)(X.Fragment,{children:[nfCutoutMode!==`key`&&(0,X.jsxs)(`button`,{type:`button`,role:`switch`,"aria-label":`光效透明保留`'],
  ['(0,X.jsxs)(`button`,{type:`button`,role:`switch`,"aria-label":`半透明材质`', 'nfCutoutMode!==`key`&&(0,X.jsxs)(`button`,{type:`button`,role:`switch`,"aria-label":`半透明材质`'],
  // The sliders, under the switches.
  ['(0,X.jsx)(`style`,{children:`[data-novaflow-soft-green-active="1"] > div:not([data-novaflow-manual-brush]){display:none!important}`})',
    'nfCutoutMode===`key`&&(0,X.jsxs)(`div`,{"data-novaflow-ai-cutout-detail":`1`,"data-novaflow-key-tune":`1`,style:{padding:`0 14px 10px`,display:`grid`,gap:10},children:['
      + tuneRow('去底', '去掉背景上残留的淡色，0 为自动结果', 'nfKeyFloor', 'nfSetKeyFloor') + ','
      + tuneRow('实心', '让半透明的主体变实，0 为自动结果', 'nfKeySolid', 'nfSetKeySolid')
      + ']}),(0,X.jsx)(`style`,{children:`[data-novaflow-soft-green-active="1"] > div:not([data-novaflow-manual-brush]){display:none!important}`})'],
  // The second hidden entry, beside the AI one.
  ['gridTemplateColumns:`1fr`,gap:10},children:(0,X.jsx)(`div`,{role:`button`,"data-novaflow-video-cutout":`1`,',
    'gridTemplateColumns:`1fr`,gap:10},children:[(0,X.jsx)(`div`,{role:`button`,"' + KEY_ENTRY_ATTR + '":`1`,onClick:()=>{Vn&&(nfSetCleanEdges(!1),nfSetSheer(!1),async()=>{try{await nfOpenCutoutTool(`key`)}catch(e){alert(String(e?.message||e||`抠图失败`))}})()},"aria-disabled":!Vn||or,tabIndex:-1,style:{display:`none`},children:`色键抠图`}),(0,X.jsx)(`div`,{role:`button`,"data-novaflow-video-cutout":`1`,'],
  ['children:N&&V?`关闭视频抠图`:or?`处理中...`:`视频抠图`})}),nfColorCorrectionOpen&&', 'children:N&&V?`关闭视频抠图`:or?`处理中...`:`视频抠图`})]}),nfColorCorrectionOpen&&'],
];
// Cache key and effect dependencies follow the mode and the sliders.
const DEPS = 'nfPreserveShadow,nfCleanEdges,nfSheer';
const DEPS_AFTER = 'nfPreserveShadow,nfCleanEdges,nfSheer,nfCutoutMode,nfKeyFloor,nfKeySolid';

export function patchCutoutKeyEntry(source) {
  if (source.includes(MARK)) return source;
  for (const [before, after] of edits) {
    const at = source.indexOf(before);
    if (at < 0 || at !== source.lastIndexOf(before)) throw new Error('Cutout key entry anchor missing or ambiguous: ' + before.slice(0, 100));
    source = source.replace(before, () => after);
  }
  const deps = source.split(DEPS).length - 1;
  if (deps !== 4) throw new Error('Cutout key cache/dependency anchor count ' + deps);
  return source.split(DEPS).join(DEPS_AFTER);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = new URL('../novaflow-web/renderer/assets/index-BbIa-2NM.js', import.meta.url);
  const before = fs.readFileSync(file, 'utf8');
  const after = patchCutoutKeyEntry(before);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
  console.log(after === before ? 'already patched' : 'patched');
}
