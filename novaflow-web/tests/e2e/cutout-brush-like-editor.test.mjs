// 视频抠图's brush works like 视频编辑's: 笔刷 is the diameter in screen pixels (1-300), 羽化 a
// ring outside it in screen pixels (0-300), the cursor shows both circles, and the keys are
// 美工's. The shipped bundle carries scripts/patch-cutout-brush-like-editor.mjs, and running
// the patch again changes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = readFileSync(join(ROOT, 'renderer/assets/index-BbIa-2NM.js'), 'utf8');
const { patchCutoutBrushLikeEditor } = await import(pathToFileURL(join(ROOT, '..', 'scripts/patch-cutout-brush-like-editor.mjs')).href);

test('the bundle carries the 视频编辑-style cutout brush', () => {
  assert.equal(patchCutoutBrushLikeEditor(bundle), bundle, 'the patch is already applied and applies once');
  for (const text of [
    'type:`range`,min:1,max:300,step:1,value:Ye',
    'type:`range`,min:0,max:300,step:1,value:Ze',
    'Ye/2/Math.max(1e-6,Number(',
    '"--nf-cutout-feather"',
    '"data-nf-feather":Ze>0?`1`:`0`',
    'Xe(t=>Z(t+e*4,1,300))',
    'Ke(s===`e`?`erase`:`restore`)',
    'Qe(e=>Z(e+o,0,300))'
  ]) assert.ok(bundle.includes(text), text);
  for (const text of ['max:120,step:1,value:Ye', 'max:16,step:1,value:Ze', 'border:`2px solid rgba(34, 211, 238, 0.95)`']) assert.ok(!bundle.includes(text), 'gone: ' + text);
});
