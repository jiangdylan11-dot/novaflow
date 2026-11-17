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
