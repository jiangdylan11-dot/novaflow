// 视频抠图 半透明材质: the AI mask is the authority on what is subject, so a pale pixel that leans
// to the screen colour inside the mask core (lilac parchment, the shaded side of white fur) stays
// opaque. A sheer veil over the screen is the same pixel; the user turns 半透明材质 on for such a
// clip and pale material keeps the chroma solution (translucent) while coloured material is still
// protected. The flag reaches the worker, the pipeline cache and the prebuilt bundle like 边缘净化.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

function loadMatting(extra = {}) {
  const module = { exports: {} };
  const context = createContext({ module, exports: module.exports, Uint8ClampedArray, Uint8Array, Int32Array, Float32Array, Float64Array, Uint32Array, Map, WeakMap, Math, console, performance, Promise, ...extra });
  runInContext('(function(module,exports){' + read('renderer/ai-sequence-green-screen-matting.js') + '\n})(module,module.exports)', context);
  return module.exports;
}

const W = 96, H = 96, SCREEN = [2, 195, 17];
// Inside the mask: pale material with a green lean (a veil showing the screen, or shaded white
// cloth) on the left half, purple material with the same lean on the right half.
const PALE = [170, 196, 160], PURPLE = [170, 190, 40];
function clip() {
  const data = new Uint8ClampedArray(W * H * 4), mask = new Uint8ClampedArray(W * H);
  const put = (x, y, rgb) => { const i = (y * W + x) * 4; data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, SCREEN);
  for (let y = 24; y < 72; y++) for (let x = 24; x < 72; x++) { put(x, y, x < 48 ? PALE : PURPLE); mask[y * W + x] = 255; }
  return { frame: { width: W, height: H, data }, mask };
}
const matte = (api, options) => {
  const c = clip();
  return api.matte(c.frame, { preserveShadow: true, subjectMask: { data: c.mask, width: W, height: H }, requireSubjectMask: true, ...options });
};
const at = (result, x, y) => { const i = (y * W + x) * 4; return [result.data[i], result.data[i + 1], result.data[i + 2], result.alpha[y * W + x]]; };

test('mask core keeps key-leaning material opaque; 半透明材质 keys the whole subject as before', () => {
  const api = loadMatting();
  const off = matte(api, {}), on = matte(api, { sheerMaterial: true });
  assert.equal(at(off, 36, 48)[3], 255, 'pale material opaque by default');
  assert.equal(at(off, 60, 48)[3], 255, 'coloured material opaque by default');
  assert.ok(at(off, 36, 48)[1] < PALE[1], 'the kept pale pixel loses its screen cast');
  // On: a sheer veil and glass showing the screen through it stay translucent and lose the
  // screen's colour; protecting coloured material there left a staff orb green.
  assert.ok(at(on, 36, 48)[3] < 250, 'pale material translucent with 半透明材质 on');
  assert.ok(at(on, 60, 48)[3] < 250, 'coloured key-leaning material translucent with 半透明材质 on');
  for (const x of [36, 60]) { const [r, g, b] = at(on, x, 48); assert.ok(g <= Math.max(r, b) + 2, 'no screen green left at x=' + x); }
});

// Black screen (spin.mp4, coins + a fading ring): the mask covers the ring too, so its dim brown
// pixels came out opaque black. 半透明材质 on keeps only bright mask pixels solid.
test('半透明材质 on a black screen: bright solids stay opaque, dim light no longer turns black', () => {
  const api = loadMatting();
  const GOLD = [235, 190, 70], DIM = [60, 30, 10];
  const make = background => {
    const data = new Uint8ClampedArray(W * H * 4), mask = new Uint8ClampedArray(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, inside = x >= 24 && x < 72 && y >= 24 && y < 72;
      const rgb = inside ? (x < 48 ? GOLD : DIM) : background;
      data.set([...rgb, 255], i);
      if (inside) mask[y * W + x] = 255;
    }
    return { frame: { width: W, height: H, data }, mask };
  };
  const run = (c, options) => api.matte(c.frame, { preserveShadow: true, subjectMask: { data: c.mask, width: W, height: H }, requireSubjectMask: true, ...options });
  const black = make([0, 0, 0]);
  const off = run(black, {}), on = run(black, { sheerMaterial: true });
  assert.equal(at(off, 36, 48)[3], 255, 'gold opaque by default');
  assert.equal(at(off, 60, 48)[3], 255, 'dim brown kept opaque by default (unchanged behaviour)');
  assert.equal(at(on, 36, 48)[3], 255, 'gold still opaque with 半透明材质 on');
  const [r, g, b, a] = at(on, 60, 48);
  assert.ok(a <= DIM[0] + 2, 'dim brown keeps the light opacity, alpha ' + a);
  assert.ok(Math.round((r * a + 255 * (255 - a)) / 255) > 200, 'dim brown over white is pale, not black');
  assert.ok(g < r && b < g, 'dim brown keeps its warm hue');
  const white = make([255, 255, 255]);
  assert.deepEqual(Array.from(run(white, { sheerMaterial: true }).data), Array.from(run(white, {}).data), 'white screens are unaffected');
});

test('renderAsync forwards 半透明材质 to the matting worker', async () => {
  const posted = [];
  class Worker { constructor(url) { this.url = url; } postMessage(message) { posted.push(message); } terminate() {} }
  const api = loadMatting({ document: { currentScript: { src: 'http://localhost/renderer/ai-sequence-green-screen-matting.js?v=test' } }, URL, Worker, navigator: { hardwareConcurrency: 8 }, setTimeout: () => 0, clearTimeout() {} });
  const c = clip();
  api.renderAsync(c.frame, { enabled: true, sheerMaterial: true, preserveShadow: true, subjectMask: { data: c.mask, width: W, height: H }, requireSubjectMask: true });
  await new Promise(resolve => setImmediate(resolve));
  const task = posted.find(message => message.type === 'matte');
  assert.ok(task, 'a matte task was posted to the worker');
  assert.equal(task.options.sheerMaterial, true);
});

test('cutout pipeline treats 半透明材质 like 边缘净化 for cached frames', async () => {
  let reader;
  const root = { NovaFlowGreenScreenMatting: { referenceFrameIndices: () => [0], parallelism: () => 1, registerPreparedFrame: (f, r) => { reader = r; return () => {}; }, createFrameCache: () => ({ put: async () => {}, get: async () => null, delete() {}, clear() {}, stats: () => ({}) }), prepareSequenceReference: () => ({}), renderAsync: async () => null } };
  const canvas = () => ({ getContext: () => ({ putImageData() {} }) });
  class ImageData { constructor(data, width, height) { Object.assign(this, { data, width, height }); } }
  runInContext(read('renderer/ai-sequence-cutout-pipeline.js'), createContext({ window: root, document: { createElement: canvas }, performance, console, Uint8ClampedArray, ImageData, ArrayBuffer, Map, Promise, Array, Math, String }));
  const frames = new Map([[0, { frame: { id: 0 } }]]);
  const pipeline = root.NovaFlowCutoutPipeline.create({ frames, width: 1, height: 1, preserveShadow: true, sheerMaterial: true, active: () => true });
  pipeline.add({ decodedFrameIndices: [0], width: 1, height: 1, alphaBytes: new Uint8Array([1]) });
  pipeline.commit(new Map([[0, new Uint8ClampedArray([1])]]));
  assert.equal(await reader({ preserveShadow: true, sheerMaterial: false, rgbaCanvas: canvas(), maskCanvas: canvas() }), null, 'a frame prepared with 半透明材质 on is not served to a request with it off');
  pipeline.stop();
});

test('the prebuilt bundle and brand runtime carry the 半透明材质 switch', () => {
  const bundle = read('renderer/assets/index-BbIa-2NM.js');
  assert.equal(bundle.split('[nfSheer,nfSetSheer]=(0,_.useState)(!1)').length - 1, 1, 'starts off every time');
  assert.ok(bundle.includes('nfSetCleanEdges(!1),nfSetSheer(!1)'), 'reset when 视频抠图 opens');
  assert.equal(bundle.split('sheerMaterial:nfSheer').length - 1, 2, 'pipeline and renderAsync options');
  assert.equal(bundle.split('nfPreserveShadow,nfCleanEdges,nfSheer').length - 1, 4, 'cache key and effect dependencies');
  assert.ok(bundle.includes('"aria-label":`半透明材质`') && bundle.includes('"data-novaflow-sheer-material":`1`'), 'switch markup');
  const brand = read('renderer/novaflow-brand-runtime.js');
  assert.equal(brand.split('[data-novaflow-sheer-material="1"]').length - 1, 2, 'brand selectors');
});
