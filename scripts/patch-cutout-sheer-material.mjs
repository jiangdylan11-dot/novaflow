// 视频抠图 半透明材质 switch (2026-10-12): a sheer veil and the shaded side of white fur are the
// same pixel over a green/blue screen, so the user chooses per clip. Off (default, reset every
// time 视频抠图 opens like 边缘净化): the AI mask keeps the subject opaque. On: the whole subject
// keeps the chroma solution, so a veil or glass showing the screen stays translucent. The prebuilt React bundle gets the state, the
// switch next to 边缘净化, and the flag on every matte call and cache key.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const edits = [
  // state
  ['[nfCleanEdges,nfSetCleanEdges]=(0,_.useState)(!1),', '[nfCleanEdges,nfSetCleanEdges]=(0,_.useState)(!1),[nfSheer,nfSetSheer]=(0,_.useState)(!1),'],
  // reset when 视频抠图 is pressed
  ['onClick:()=>{Vn&&(nfSetCleanEdges(!1),async()=>{', 'onClick:()=>{Vn&&(nfSetCleanEdges(!1),nfSetSheer(!1),async()=>{'],
  // prewarm pipeline
  ['preserveShadow:nfPreserveShadow,cleanEdges:nfCleanEdges,preferredIndex:nfPreferred', 'preserveShadow:nfPreserveShadow,cleanEdges:nfCleanEdges,sheerMaterial:nfSheer,preferredIndex:nfPreferred'],
  // cache key
  ['nfGreenScreen,nfPreserveShadow,nfCleanEdges,ye,s,De', 'nfGreenScreen,nfPreserveShadow,nfCleanEdges,nfSheer,ye,s,De'],
  // per-frame matte
  ['preserveShadow:nfPreserveShadow,cleanEdges:nfCleanEdges,subjectMask:nfSubjectMask', 'preserveShadow:nfPreserveShadow,cleanEdges:nfCleanEdges,sheerMaterial:nfSheer,subjectMask:nfSubjectMask'],
  // effect dependencies
  ['nfGreenScreen,nfPreserveShadow,nfCleanEdges,R,nfCutoutMode', 'nfGreenScreen,nfPreserveShadow,nfCleanEdges,nfSheer,R,nfCutoutMode'],
];
const DEPS = 'nfPreserveShadow,nfCleanEdges]),';
const DEPS_AFTER = 'nfPreserveShadow,nfCleanEdges,nfSheer]),';
const SWITCH_START = '(0,X.jsxs)(`button`,{type:`button`,role:`switch`,"aria-label":`边缘净化`';
const SWITCH_END = 'transition:`left 140ms ease-out, background-color 140ms ease-out`}})})]})';
const SWITCH_NEXT = ',(0,X.jsx)(`style`';

export function patchCutoutSheerMaterial(source) {
  if (source.includes('nfSheer')) return source;
  for (const [before, after] of edits) {
    if (source.indexOf(before) < 0 || source.indexOf(before) !== source.lastIndexOf(before)) throw new Error('Cutout sheer anchor missing or ambiguous: ' + before.slice(0, 60));
    source = source.replace(before, () => after);
  }
  const deps = source.split(DEPS).length - 1;
  if (deps !== 2) throw new Error('Cutout sheer effect-dependency anchor count ' + deps);
  source = source.split(DEPS).join(DEPS_AFTER);
  const start = source.indexOf(SWITCH_START);
  if (start < 0 || start !== source.lastIndexOf(SWITCH_START)) throw new Error('边缘净化 switch anchor missing or ambiguous');
  const end = source.indexOf(SWITCH_END + SWITCH_NEXT, start);
  if (end < 0) throw new Error('边缘净化 switch end anchor missing');
  const edgeSwitch = source.slice(start, end + SWITCH_END.length);
  const sheerSwitch = edgeSwitch
    .replace('"aria-label":`边缘净化`', '"aria-label":`半透明材质`')
    .replace('"data-novaflow-edge-clean":`1`', '"data-novaflow-sheer-material":`1`')
    .replace(/title:nfCleanEdges\?`[^`]*`:`[^`]*`/, 'title:nfSheer?`半透明材质已开启：主体里透出幕布的地方（纱、薄布、玻璃）按半透明处理`:`半透明材质已关闭：蒙版认定的主体保持不透明`')
    .replace('nfSetCleanEdges(!nfCleanEdges)', 'nfSetSheer(!nfSheer)')
    .replace('children:`边缘净化`', 'children:`半透明材质`')
    .split('nfCleanEdges').join('nfSheer');
  if (sheerSwitch.includes('nfCleanEdges') || !sheerSwitch.includes('半透明材质已开启')) throw new Error('边缘净化 switch copy incomplete');
  return source.slice(0, end + SWITCH_END.length) + ',' + sheerSwitch + source.slice(end + SWITCH_END.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = new URL('../novaflow-web/renderer/assets/index-BbIa-2NM.js', import.meta.url);
  const before = fs.readFileSync(file, 'utf8');
  const after = patchCutoutSheerMaterial(before);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
  console.log(after === before ? 'already patched' : 'patched');
}
