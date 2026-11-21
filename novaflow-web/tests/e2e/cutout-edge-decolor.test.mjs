// 视频抠图 边缘去色 (2026-11-21): the soft rim outside the AI mask kept the green screen mixed in
// (light fur turned yellow-green over any backdrop, much more with 光效透明保留 off, where the rim
// is the raw frame). Default on, a switch in AI抠图, plus a 去色 brush beside 擦除 / 修复 whose
// strokes never undo an erase or restore under them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function loadMatting() {
  const module = { exports: {} };
  const context = createContext({ module, exports: module.exports, Uint8ClampedArray, Uint8Array, Int32Array, Float32Array, Float64Array, Uint32Array, Map, WeakMap, Set, Math, console, performance, Promise });
  runInContext('(function(module,exports){' + read('renderer/ai-sequence-green-screen-matting.js') + '\n})(module,module.exports)', context);
  return module.exports;
}

// A white subject and a jade-green one on a green screen, each with a 2 px rim of subject
// colour mixed half with the screen, which the AI mask still counts half (its outline).
function scene() {
  const W = 120, H = 80, SCREEN = [17, 198, 46], WHITE = [230, 228, 232], JADE = [40, 200, 110];
  const data = new Uint8ClampedArray(W * H * 4), mask = new Uint8ClampedArray(W * H);
  const box = (x, y, x0, x1) => x >= x0 && x < x1 && y >= 20 && y < 60;
  const rim = (x, y, x0, x1) => !box(x, y, x0, x1) && x >= x0 - 2 && x < x1 + 2 && y >= 18 && y < 62;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; let rgb = SCREEN;
    for (const [x0, x1, colour] of [[15, 45, WHITE], [70, 100, JADE]]) {
      if (box(x, y, x0, x1)) { rgb = colour; mask[p] = 255; }
      else if (rim(x, y, x0, x1)) { rgb = colour.map((v, c) => Math.round((v + SCREEN[c]) / 2)); mask[p] = 128; }
    }
    data.set([...rgb, 255], p * 4);
  }
  return { W, H, data, mask, rimOf: (x0, x1) => (x, y) => rim(x, y, x0, x1) };
}
const cast = (d, i) => d[i + 1] - Math.max(d[i], d[i + 2]);

test('光效 off: the white rim loses the screen green, the jade rim keeps its own, opacity untouched', () => {
  const { W, H, data, mask, rimOf } = scene(), M = loadMatting();
  const alpha = new Uint8ClampedArray(mask);
  const on = M.decolorFrame({ width: W, height: H, data }, alpha, { subjectMask: { data: mask, width: W, height: H } }).data;
  const off = M.decolorFrame({ width: W, height: H, data }, alpha, { subjectMask: { data: mask, width: W, height: H }, edgeDecolor: false }).data;
  const white = rimOf(15, 45), jade = rimOf(70, 100);
  let whiteOn = 0, whiteOff = 0, jadeMin = 255, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, i = p * 4;
    assert.equal(on[i + 3], alpha[p], 'opacity unchanged');
    if (white(x, y)) { whiteOn = Math.max(whiteOn, cast(on, i)); whiteOff = Math.max(whiteOff, cast(off, i)); n++; }
    if (jade(x, y)) jadeMin = Math.min(jadeMin, cast(on, i));
  }
  assert.ok(n > 100 && whiteOff > 40, 'the white rim is green without the switch: ' + whiteOff);
  assert.ok(whiteOn <= 2, 'the white rim is neutral with it: ' + whiteOn);
  // Jade leans 90 to the key; the rim takes jade's hue at its own brightness, so it stays green.
  assert.ok(jadeMin >= 80, 'the jade rim keeps its own green: ' + jadeMin);
  const s = (40 * W + 30) * 4;
  assert.deepEqual([...on.slice(s, s + 4)], [230, 228, 232, 255], 'subject untouched');
});

test('the opaque outermost ring of the mask loses screen colour too (browser-decoded frames)', () => {
  // A dark hand whose outermost 2 px the AI mask marks fully opaque, though they are half screen.
  const W = 80, H = 60, SCREEN = [17, 198, 46], HAND = [70, 50, 45];
  const data = new Uint8ClampedArray(W * H * 4), mask = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, inside = x >= 20 && x < 60 && y >= 15 && y < 45, ring = inside && (x < 22 || x >= 58 || y < 17 || y >= 43);
    data.set([...(ring ? HAND.map((v, c) => Math.round((v + SCREEN[c]) / 2)) : inside ? HAND : SCREEN), 255], p * 4);
    if (inside) mask[p] = 255;
  }
  const M = loadMatting(), alpha = new Uint8ClampedArray(mask);
  const out = M.decolorFrame({ width: W, height: H, data }, alpha, { subjectMask: { data: mask, width: W, height: H } }).data;
  const i = (30 * W + 20) * 4;
  assert.ok(cast(data, i) > 50, 'the ring is green in the frame');
  assert.ok(cast(out, i) <= 0, 'and takes the hand colour after: ' + [...out.slice(i, i + 3)]);
  assert.equal(out[i + 3], 255, 'opacity unchanged');
});

test('光效 on: off is byte-identical to no option, on never changes opacity', () => {
  const { W, H, data, mask } = scene(), M = loadMatting();
  const opts = { preserveShadow: true, subjectMask: { data: mask, width: W, height: H }, requireSubjectMask: true };
  const plain = M.matte({ width: W, height: H, data }, opts), off = M.matte({ width: W, height: H, data }, { ...opts, edgeDecolor: false });
  assert.deepEqual([...off.data], [...plain.data], 'off = unchanged');
  const on = M.matte({ width: W, height: H, data }, { ...opts, edgeDecolor: true });
  for (let p = 0; p < W * H; p++) assert.equal(on.alpha[p], plain.alpha[p], 'opacity unchanged');
});

test('去色 brush: green in the overlay despills, grey keeps erase/restore, erased stays erased', () => {
  const M = loadMatting();
  const result = { screen: { kind: 'green', rgb: [17, 198, 46] }, alpha: new Uint8ClampedArray([200, 0, 200]), data: new Uint8ClampedArray([150, 220, 150, 200, 0, 0, 0, 0, 150, 220, 150, 200]) };
  // pixel 0: pure 去色; pixel 1: erased (black) then 去色 painted behind; pixel 2: no stroke
  const overlay = new Uint8ClampedArray([0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0]);
  M.applyBrush(result, overlay, null);
  assert.equal(result.alpha[0], 200, '去色 keeps opacity');
  assert.ok(cast(result.data, 0) <= 1, 'the green is gone: ' + [...result.data.slice(0, 3)]);
  assert.ok(result.data[0] > 150, 'brightness kept, not darkened');
  assert.equal(result.alpha[1], 0, 'erased stays erased');
  assert.deepEqual([...result.data.slice(8, 12)], [150, 220, 150, 200], 'untouched without a stroke');
});

test('the 去色 brush paints behind existing marks', () => {
  const B = (() => { const module = { exports: {} }; runInContext(read('renderer/soft-round-brush.js'), createContext({ module, globalThis: {}, Math, Map, WeakMap, Float32Array, Float64Array, Uint8Array, Number, Array, Infinity })); return module.exports; })();
  const pixels = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels[i + 3] = 255; // fully erased (black)
  const stroke = B.createCoverageStroke({ width: 16, height: 16, radius: 6, feather: 0, white: [0, 255, 0], channels: 4, composite: 'destination-over', read: (b) => { const d = new Uint8ClampedArray(b.width * b.height * 4); for (let y = 0; y < b.height; y++) d.set(pixels.subarray(((b.y + y) * 16 + b.x) * 4, ((b.y + y) * 16 + b.x + b.width) * 4), y * b.width * 4); return { data: d }; }, write: () => {} });
  B.paintCoverageSegment(stroke, 8, 8, 8, 8);
  const tile = [...stroke.tiles.values()][0];
  assert.deepEqual([...tile.data.slice((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4)], [0, 0, 0, 255], 'an opaque erase mark is not overwritten');
});

test('the bundle wires 边缘去色 and the 去色 brush', () => {
  const bundle = read('renderer/assets/index-BbIa-2NM.js');
  assert.ok(bundle.includes('[nfEdgeDecolor,nfSetEdgeDecolor]=(0,_.useState)(!0)'), 'default on, not remembered');
  assert.equal(bundle.split('nfSetSheer(!1),nfSetEdgeDecolor(!0),').length - 1, 2, 'reset on every open');
  assert.ok(bundle.includes('"data-novaflow-edge-decolor":`1`'), 'switch');
  assert.ok(bundle.includes('edgeDecolor:nfEdgeDecolor&&nfCutoutMode!==`key`'), 'render option');
  assert.ok(bundle.includes('decolorFrame(t,b,{subjectMask:nfSubjectMask,edgeDecolor:nfEdgeDecolor,brushDecolor:nfDec})'), '光效 off result');
  assert.ok(bundle.includes('children:`去色`') && bundle.includes('Ke(`decolor`)'), '去色 brush button');
  assert.ok(bundle.includes('e.mode===`decolor`?`destination-over`:`source-over`'), 'painted behind');
  assert.ok(read('renderer/ai-sequence-green-screen-matting.js').includes('edgeDecolor:!!options.edgeDecolor'), 'reaches the workers');
  assert.ok(read('renderer/ai-sequence-cutout-pipeline.js').includes('!!options.edgeDecolor!==!!edgeDecolor'), 'prewarm cache honours the switch');
  assert.ok(read('renderer/brush-tool-bar.js').includes('擦除|修复|去色'), 'top brush bar shows 去色');
});
