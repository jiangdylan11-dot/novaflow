// 视频抠图's brush works like 视频编辑's (2026-10-10, user's call): 笔刷 is the circle's diameter
// in screen pixels (1-300), 羽化 a ring outside it in screen pixels (0-300), and the cursor shows
// both circles. The keys are 美工's: [ ] size by 4, ; - / ' = feather by 1, E 擦除, R 修复.
// Before: 笔刷 was a radius (2-120), 羽化 counted video pixels (0-24) and one cyan circle showed.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const EDITS = [
  // sliders and number boxes
  ['type:`range`,min:2,max:80,step:1,value:Ye,onChange:e=>(wi(),Xe(Z(+e.target.value,2,120)))',
    'type:`range`,min:1,max:300,step:1,value:Ye,onChange:e=>(wi(),Xe(Z(+e.target.value,1,300)))'],
  ['type:`number`,min:2,max:120,step:1,value:Ye,onChange:e=>(wi(),Xe(Z(+e.target.value,2,120)))',
    'type:`number`,min:1,max:300,step:1,value:Ye,onChange:e=>(wi(),Xe(Z(+e.target.value,1,300)))'],
  ['type:`range`,min:0,max:16,step:1,value:Ze,onChange:e=>(wi(),Qe(Z(+e.target.value,0,24)))',
    'type:`range`,min:0,max:300,step:1,value:Ze,onChange:e=>(wi(),Qe(Z(+e.target.value,0,300)))'],
  ['type:`number`,min:0,max:24,step:1,value:Ze,onChange:e=>(wi(),Qe(Z(+e.target.value,0,24)))',
    'type:`number`,min:0,max:300,step:1,value:Ze,onChange:e=>(wi(),Qe(Z(+e.target.value,0,300)))'],
  // restored settings
  ['Xe(Z(Number(t.brushSize)||22,2,120)),Qe(Z(Number(t.brushFeatherPx)||0,0,24))',
    'Xe(Z(Number(t.brushSize)||22,1,300)),Qe(Z(Number(t.brushFeatherPx)||0,0,300))'],
  // painting: the stroke's radius is half the diameter, its feather goes from screen to video pixels
  ['Ye/Math.max(1e-6,Number(', 'Ye/2/Math.max(1e-6,Number(', 3],
  ['{...e,feather:Ze}', '{...e,feather:Ze*Math.max(1,Number(e.r)||1)/Math.max(.5,Ye/2)}'],
  ['Z(Number(t.feather)||0,0,24)', 'Z(Number(t.feather)||0,0,300)'],
  ['Z(Number(e.feather)||0,0,24)', 'Z(Number(e.feather)||0,0,300)'],
  // cursor: radius = half the diameter, 视频编辑's green circle, the feather ring drawn by the theme (3.1d)
  ['Math.max(1,Ye)', 'Math.max(.5,Ye/2)', 7],
  ['border:`2px solid rgba(34, 211, 238, 0.95)`,boxShadow:`0 0 0 1px rgba(0,0,0,0.35)`',
    'border:`1.5px solid #27c889`,boxShadow:`none`,"--nf-cutout-feather":`${Math.max(0,Number(Ze)||0)}px`'],
  ['"data-novaflow-ai-cutout-brush-cursor":`1`,', '"data-novaflow-ai-cutout-brush-cursor":`1`,"data-nf-feather":Ze>0?`1`:`0`,'],
  // keys
  ['Xe(t=>Z(t+e*2,2,120)),nt(t=>t.visible?{...t,r:Z(t.r+e*2,2,120)}:t)',
    'Xe(t=>Z(t+e*4,1,300)),nt(t=>t.visible?{...t,r:Math.max(.5,Z(t.r*2+e*4,1,300)/2)}:t)'],
  ['if(r.code===`CapsLock`||s===`capslock`){r.preventDefault(),et(e=>!e);return}',
    'if(r.code===`CapsLock`||s===`capslock`){r.preventDefault(),et(e=>!e);return}if(!r.ctrlKey&&!r.metaKey&&!r.altKey&&(s===`e`||s===`r`)){r.preventDefault(),Ke(s===`e`?`erase`:`restore`);return}'],
  ['a=i===`Semicolon`||r===`:`||r===`：`||r===`;`||r===`；`;if(!a&&!(i===`Quote`||r===`"`||r===`“`||r===`”`||r===`\'`||r===`‘`||r===`’`))return;',
    'a=i===`Semicolon`||r===`:`||r===`：`||r===`;`||r===`；`||r===`-`||r===`_`;if(!a&&!(i===`Quote`||r===`"`||r===`“`||r===`”`||r===`\'`||r===`‘`||r===`’`||r===`=`||r===`+`))return;'],
  ['Qe(e=>Z(e+o,0,24))', 'Qe(e=>Z(e+o,0,300))'],
  // the hint names every key (E / R were missing), written as 美工 and 视频编辑 write theirs
  ['Ctrl+Z 撤销 CapsLock 显示笔刷圈 [ 缩小 ] 放大 ： 羽化减小 ’ 羽化增大',
    "快捷键：[ ] 笔刷大小 · ; ' 羽化 · E 擦除 · R 修复 · Ctrl+Z 撤销 · CapsLock 显示笔刷圈", 2],
  // one tap is one step (as 美工's key repeat): the hold loop starts repeating after 250 ms, not at once
  ['!c&&!l||(r.preventDefault(),c&&(t.left||e(-1),t.left=!0)', '!c&&!l||(r.preventDefault(),t.last||=performance.now()+250,c&&(t.left||e(-1),t.left=!0)'],
];

export function patchCutoutBrushLikeEditor(source) {
  for (const [before, after, count = 1] of EDITS) {
    // already done: the replacement is there (some replacements contain their original)
    if (source.split(after).length - 1 >= count) continue;
    const found = source.split(before).length - 1;
    if (found !== count) throw new Error(`Cutout brush anchor found ${found} times (want ${count}): ${before.slice(0, 70)}`);
    source = source.split(before).join(after);
  }
  return source;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = new URL('../novaflow-web/renderer/assets/index-BbIa-2NM.js', import.meta.url);
  const before = fs.readFileSync(file, 'utf8');
  const after = patchCutoutBrushLikeEditor(before);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
  console.log(after === before ? 'already patched' : 'patched');
}
