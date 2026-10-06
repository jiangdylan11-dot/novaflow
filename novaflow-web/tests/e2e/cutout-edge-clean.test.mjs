// 视频抠图 边缘净化: the post-pass that removes screen-tinted fringe and stray
// pixels around the subject after the chroma matte.
//
// The contract: with the switch off the matte is byte-identical to before;
// with it on, interior pixels and pixels far from the subject keep their
// bytes, a screen-mixed contour pixel loses its screen tint, and faint
// bleed specks beside the subject disappear. The pipeline treats the flag
// like 保留投影, and the prebuilt bundle carries the switch end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

function loadMatting() {
  const module = { exports: {} };
  const context = createContext({ module, exports: module.exports, Uint8ClampedArray, Uint8Array, Int32Array, Float32Array, Float64Array, Uint32Array, Map, WeakMap, Math, console, performance });
  runInContext('(function(module,exports){' + read('renderer/ai-sequence-green-screen-matting.js') + '\n})(module,module.exports)', context);
  return module.exports;
}

const W = 96, H = 96, SCREEN = [2, 195, 17], TAN = [200, 160, 110];
const SQUARE = { x0: 30, y0: 30, x1: 66, y1: 66 };

function syntheticClip() {
  const data = new Uint8ClampedArray(W * H * 4), mask = new Uint8ClampedArray(W * H);
  const put = (x, y, rgb) => { const i = (y * W + x) * 4; data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, SCREEN);
  for (let y = SQUARE.y0; y < SQUARE.y1; y++) for (let x = SQUARE.x0; x < SQUARE.x1; x++) { put(x, y, TAN); mask[y * W + x] = 255; }
  // A one-pixel ring of half screen, half foreground: the codec-blurred contour.
  const ring = TAN.map((v, c) => Math.round((v + SCREEN[c]) / 2));
  for (let y = SQUARE.y0 - 1; y <= SQUARE.y1; y++) for (let x = SQUARE.x0 - 1; x <= SQUARE.x1; x++) {
    const onRing = x === SQUARE.x0 - 1 || x === SQUARE.x1 || y === SQUARE.y0 - 1 || y === SQUARE.y1;
    if (onRing) { put(x, y, ring); mask[y * W + x] = 128; }
  }
  // Foreground colour bled into the screen 18px beside the subject.
  for (const [x, y] of [[12, 48], [84, 48], [48, 12]]) put(x, y, [40, 185, 30]);
  return { frame: { width: W, height: H, data }, mask };
}

function matte(api, clip, options) {
  const frame = { width: W, height: H, data: new Uint8ClampedArray(clip.frame.data) };
  return api.matte(frame, { preserveShadow: true, subjectMask: { data: clip.mask, width: W, height: H }, requireSubjectMask: true, ...options });
}

test('边缘净化 off leaves the matte byte-identical', () => {
  const api = loadMatting(), clip = syntheticClip();
  const plain = matte(api, clip, {}), off = matte(api, clip, { cleanEdges: false });
  assert.deepEqual(Buffer.from(off.data), Buffer.from(plain.data));
  assert.deepEqual(Buffer.from(off.alpha), Buffer.from(plain.alpha));
});

test('边缘净化 on removes screen tint on the contour and bleed specks, keeps interior and far pixels', () => {
  const api = loadMatting(), clip = syntheticClip();
  const off = matte(api, clip, {}), on = matte(api, clip, { cleanEdges: true });
  const at = (r, x, y) => { const i = (y * W + x) * 4; return [r.data[i], r.data[i + 1], r.data[i + 2], r.data[i + 3]]; };
  // Interior (4px inside the square) and far screen (30px away) are untouched.
  for (let y = SQUARE.y0 + 4; y < SQUARE.y1 - 4; y++) for (let x = SQUARE.x0 + 4; x < SQUARE.x1 - 4; x++) assert.deepEqual(at(on, x, y), at(off, x, y));
  for (const [x, y] of [[2, 2], [93, 93], [2, 93], [48, 2]]) assert.deepEqual(at(on, x, y), at(off, x, y));
  // Bleed specks had alpha before and none after.
  for (const [x, y] of [[12, 48], [84, 48], [48, 12]]) { assert.ok(at(off, x, y)[3] > 0, 'speck existed'); assert.equal(at(on, x, y)[3], 0); }
  // Ring pixel: still present, less green relative to its other channels than before, no greener than the interior.
  const ratio = rgb => rgb[1] / Math.max(rgb[0], rgb[2], 1);
  const interior = ratio(TAN);
  let checked = 0;
  for (const [x, y] of [[48, SQUARE.y0 - 1], [SQUARE.x1, 48], [48, SQUARE.y1], [SQUARE.x0 - 1, 48]]) {
    const before = at(off, x, y), after = at(on, x, y);
    if (!before[3]) continue;
    assert.ok(after[3] > 0, 'ring pixel kept');
    assert.ok(ratio(after) <= ratio(before) + 1e-9, 'not greener than before');
    assert.ok(ratio(after) <= interior + .06, 'no greener than the interior');
    checked++;
  }
  assert.ok(checked >= 2);
});

test('cutout pipeline treats 边缘净化 like 保留投影 for cached frames', async () => {
  let reader;
  const root = { NovaFlowGreenScreenMatting: { referenceFrameIndices: () => [0], parallelism: () => 1, registerPreparedFrame: (f, r) => { reader = r; return () => {}; }, createFrameCache: () => ({ put: async () => {}, get: async () => null, delete() {}, clear() {}, stats: () => ({}) }), prepareSequenceReference: () => ({}), renderAsync: async () => null } };
  const canvas = () => ({ getContext: () => ({ putImageData() {} }) });
  class ImageData { constructor(data, width, height) { Object.assign(this, { data, width, height }); } }
  runInContext(read('renderer/ai-sequence-cutout-pipeline.js'), createContext({ window: root, document: { createElement: canvas }, performance, console, Uint8ClampedArray, ImageData, ArrayBuffer, Map, Promise, Array, Math, String }));
  const frames = new Map([[0, { frame: { id: 0 } }]]);
  const pipeline = root.NovaFlowCutoutPipeline.create({ frames, width: 1, height: 1, preserveShadow: true, cleanEdges: true, active: () => true });
  pipeline.add({ decodedFrameIndices: [0], width: 1, height: 1, alphaBytes: new Uint8Array([1]) });
  pipeline.commit(new Map([[0, new Uint8ClampedArray([1])]]));
  assert.equal(await reader({ preserveShadow: true, cleanEdges: false, rgbaCanvas: canvas(), maskCanvas: canvas() }), null, 'a frame prepared with 边缘净化 on is not served to a request with it off');
  pipeline.stop();
});

test('the prebuilt bundle and brand runtime carry the 边缘净化 switch', () => {
  const bundle = read('renderer/assets/index-BbIa-2NM.js');
  assert.equal(bundle.split('nf_cutout_clean_edges').length - 1, 1, 'persisted preference');
  assert.equal(bundle.split('cleanEdges:nfCleanEdges').length - 1, 2, 'pipeline and renderAsync options');
  assert.equal(bundle.split('nfGreenScreen,nfPreserveShadow,nfCleanEdges').length - 1, 4, 'cache key and effect dependencies');
  assert.ok(bundle.includes('"aria-label":`边缘净化`') && bundle.includes('"data-novaflow-edge-clean":`1`'), 'switch markup');
  const brand = read('renderer/novaflow-brand-runtime.js');
  assert.equal(brand.split('[data-novaflow-edge-clean="1"]').length - 1, 2, 'brand selectors');
});
