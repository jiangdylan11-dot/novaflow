// 视频抠图 with 光效透明保留 on (2026-11-18): the subject is cut like the switch off — its opacity
// is the AI mask and its colours are its own. The glow solution used to normalise every mixed
// contour pixel to full brightness (a pale halo on dark backgrounds) and keyed a green part of
// the subject (a jade medallion) grey. Light away from the mask keeps the chroma solution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const module = { exports: {} };
runInContext('(function(module,exports){' + readFileSync(join(ROOT, 'renderer/ai-sequence-green-screen-matting.js'), 'utf8') + '\n})(module,module.exports)',
  createContext({ module, exports: module.exports, Uint8ClampedArray, Uint8Array, Int32Array, Float32Array, Float64Array, Uint32Array, Map, WeakMap, Math, console, performance, Promise }));
const api = module.exports;

const W = 96, H = 96, SCREEN = [3, 237, 49], BLUE = [20, 60, 200], JADE = [41, 227, 101], LIGHT = [200, 255, 120];
function clip() {
  const data = new Uint8ClampedArray(W * H * 4), mask = new Uint8ClampedArray(W * H);
  const put = (x, y, rgb) => { const i = (y * W + x) * 4; data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, SCREEN);
  for (let y = 24; y < 72; y++) for (let x = 24; x < 72; x++) { put(x, y, x >= 40 && x < 56 && y >= 40 && y < 56 ? JADE : BLUE); mask[y * W + x] = 255; }
  // contour column x=23: half blue subject, half screen; the mask says .6
  for (let y = 24; y < 72; y++) { put(23, y, BLUE.map((c, k) => Math.round(c * .5 + SCREEN[k] * .5))); mask[y * W + 23] = 153; }
  // a glow outside the subject
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) put(x, y, LIGHT);
  return { frame: { width: W, height: H, data }, mask };
}
const at = (r, x, y) => { const i = (y * W + x) * 4; return [r.data[i], r.data[i + 1], r.data[i + 2], r.alpha[y * W + x]]; };

test('green part of the subject keeps its colour and opacity', () => {
  const c = clip(), r = api.matte(c.frame, { preserveShadow: true, subjectMask: { data: c.mask, width: W, height: H }, requireSubjectMask: true });
  const [rr, g, b, a] = at(r, 48, 48);
  assert.equal(a, 255);
  assert.ok(Math.abs(rr - JADE[0]) <= 2 && Math.abs(g - JADE[1]) <= 2 && Math.abs(b - JADE[2]) <= 2, `jade ${[rr, g, b]}`);
});

test('contour pixel loses the screen without turning pale', () => {
  const c = clip(), r = api.matte(c.frame, { preserveShadow: true, subjectMask: { data: c.mask, width: W, height: H }, requireSubjectMask: true });
  const [rr, g, b, a] = at(r, 23, 48);
  assert.ok(a > 60 && a <= 160, `alpha ${a}`);
  assert.ok(g <= Math.max(rr, b) + 2, `no green rim ${[rr, g, b]}`);
  assert.ok(b > rr && b > g, `still the subject's blue ${[rr, g, b]}`);
  assert.ok(Math.max(rr, g, b) < 250 || Math.min(rr, g, b) < 120, `not normalised to white ${[rr, g, b]}`);
});

test('light outside the mask keeps the chroma solution', () => {
  const c = clip(), r = api.matte(c.frame, { preserveShadow: true, subjectMask: { data: c.mask, width: W, height: H }, requireSubjectMask: true });
  const [, , , a] = at(r, 8, 8);
  assert.ok(a > 0 && a < 255, `light stays translucent ${a}`);
});

// 2026-11-18 round 2 (Dylan: 光效衔接处被挖掉, 边缘净化变色). A cyan glow surrounds a brown hand and
// the mask's soft edge reaches into the glow.
function glowClip() {
  const W2 = 96, H2 = 96, data = new Uint8ClampedArray(W2 * H2 * 4), mask = new Uint8ClampedArray(W2 * H2);
  const put = (x, y, rgb) => { const i = (y * W2 + x) * 4; data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; };
  const mix = (a, b, t) => a.map((c, k) => Math.round(c * t + b[k] * (1 - t)));
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const d = Math.hypot(x - 48, y - 48), glow = Math.max(0, 1 - Math.max(0, d - 20) / 18);
    put(x, y, mix([120, 255, 245], SCREEN, glow * .8));
  }
  for (let y = 36; y < 60; y++) for (let x = 36; x < 60; x++) { put(x, y, [110, 70, 50]); mask[y * W2 + x] = 255; }
  for (let y = 44; y < 52; y++) for (let x = 44; x < 52; x++) put(x, y, [140, 255, 250]);             // gem light
  for (let y = 30; y < 66; y++) for (let x = 30; x < 66; x++) if (!mask[y * W2 + x]) mask[y * W2 + x] = 90; // soft edge into the glow
  return { frame: { width: W2, height: H2, data }, mask, W2 };
}
const runGlow = (opts = {}) => { const c = glowClip(); return { c, r: api.matte(c.frame, { preserveShadow: true, subjectMask: { data: c.mask, width: c.W2, height: c.W2 }, requireSubjectMask: true, ...opts }) }; };

test('glow touching the subject is not cut by the mask edge', () => {
  const plain = runGlow({ sheerMaterial: true }), cut = runGlow();
  // sheerMaterial skips the mask treatment: the glow solution there is the reference.
  for (const [x, y] of [[33, 48], [48, 32], [62, 48]]) {
    const p = y * 96 + x;
    assert.ok(cut.r.alpha[p] >= plain.r.alpha[p] - 3, `glow at ${x},${y}: ${cut.r.alpha[p]} vs ${plain.r.alpha[p]}`);
  }
});

test('边缘净化 does not recolour the subject', () => {
  const a = runGlow().r, b = runGlow({ cleanEdges: true }).r;
  for (const [x, y] of [[37, 37], [58, 40], [40, 58]]) {
    const i = (y * 96 + x) * 4;
    for (let k = 0; k < 4; k++) assert.ok(Math.abs(a.data[i + k] - b.data[i + k]) <= 1, `subject ${x},${y} channel ${k}: ${a.data[i + k]} vs ${b.data[i + k]}`);
  }
});

// 2026-11-18 round 3, Dylan's green_win (gem held up, glow around the hands). Two rounds of his
// feedback: the glow must stay whole right up to the hands (the mask-aware refinement greyed it
// into a dark ring, 边缘净化 chewed its rim), and the subject must not be hollowed (treating the
// lit gem and the screen between the arms as light did that: 主体被挖了).
function heldGemClip(withGlow) {
  const N = 120, data = new Uint8ClampedArray(N * N * 4), mask = new Uint8ClampedArray(N * N), BLUE_SCREEN = [0, 63, 241];
  const put = (x, y, rgb) => { const i = (y * N + x) * 4; data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x - 60, y - 40), glow = withGlow ? Math.max(0, 1 - d / 34) : 0;
    put(x, y, BLUE_SCREEN.map((c, k) => Math.round(c + ([90, 230, 250][k] - c) * glow * .7)));
  }
  for (let y = 30; y < 110; y++) for (let x = 40; x < 80; x++) mask[y * N + x] = 255;           // mask covers hands and the gap
  for (let y = 30; y < 110; y++) for (let x = 40; x < 80; x++) if (x < 54 || x >= 66 || y >= 60) put(x, y, [110, 80, 60]); // hands/arms, gap left lit
  for (let y = 80; y < 90; y++) for (let x = 50; x < 70; x++) put(x, y, [30, 150, 235]);       // cyan-blue part of the subject, far from the glow
  return { frame: { width: N, height: N, data }, mask, N };
}
const runGem = (withGlow, opts = {}) => { const c = heldGemClip(withGlow); return api.matte(c.frame, { preserveShadow: true, subjectMask: { data: c.mask, width: c.N, height: c.N }, requireSubjectMask: true, ...opts }); };

test('the subject next to a glow is not hollowed', () => {
  const r = runGem(true);
  assert.ok(r.alpha[45 * 120 + 60] >= 250, `lit part of the subject between the hands ${r.alpha[45 * 120 + 60]}`);
  assert.equal(r.alpha[70 * 120 + 45], 255, 'hand stays opaque');
  assert.equal(r.alpha[85 * 120 + 60], 255, 'key-leaning subject away from the glow stays opaque');
});

test('the glow is whole right up to the subject', () => {
  const c = heldGemClip(true), plain = api.matte(c.frame, { preserveShadow: true }), r = runGem(true);
  for (const [x, y] of [[38, 40], [81, 40], [60, 28]]) { const p = y * 120 + x; assert.ok(r.alpha[p] >= plain.alpha[p] - 3, `glow at ${x},${y}: ${r.alpha[p]} vs plain ${plain.alpha[p]}`); }
});

test('without a glow outside the mask, key-leaning subject is untouched', () => {
  const r = runGem(false);
  assert.equal(r.alpha[85 * 120 + 60], 255);
});

test('边缘净化 keeps the glow around the subject', () => {
  const a = runGem(true), b = runGem(true, { cleanEdges: true });
  for (const [x, y] of [[36, 40], [84, 40], [60, 22]]) { const p = y * 120 + x; assert.ok(b.alpha[p] >= a.alpha[p] - 3, `glow ${x},${y}: ${b.alpha[p]} vs ${a.alpha[p]}`); }
});
