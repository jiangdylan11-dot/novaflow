// 视频抠图 AI抠图 cast shadow colour (2026-11-21): rendered shadows on a green screen are
// cool-tinted (screen 17/198/46 -> shadow 10/150/62). The halo pass held only the key channel
// down, so the blue residue stayed and, unmultiplied at low opacity, the shadow came out blue
// (user's 蓝施法 monkey clip), and partly lighter than a dark canvas. A translucent shadow outside
// the subject is now black.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadMatting() {
  const module = { exports: {} };
  const context = createContext({ module, exports: module.exports, Uint8ClampedArray, Uint8Array, Int32Array, Float32Array, Float64Array, Uint32Array, Map, WeakMap, Set, Math, console, performance, Promise });
  runInContext('(function(module,exports){' + readFileSync(join(ROOT, 'renderer/ai-sequence-green-screen-matting.js'), 'utf8') + '\n})(module,module.exports)', context);
  return module.exports;
}

test('a cool-tinted cast shadow on a green screen comes out neutral, the subject keeps its colour', () => {
  const W = 96, H = 120, SCREEN = [17, 198, 46], SHADOW = [12, 150, 62], SUBJECT = [150, 90, 60];
  const data = new Uint8ClampedArray(W * H * 4), mask = new Uint8ClampedArray(W * H);
  const inShadow = (x, y) => (x >= 20 && x < 80 && y >= 80 && y < 110) || (x >= 64 && x < 92 && y >= 22 && y < 44);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let rgb = SCREEN;
    if (x >= 36 && x < 60 && y >= 20 && y < 80) { rgb = SUBJECT; mask[y * W + x] = 255; }
    else if (inShadow(x, y)) rgb = SHADOW;
    data.set([...rgb, 255], (y * W + x) * 4);
  }
  const result = loadMatting().matte({ width: W, height: H, data }, { preserveShadow: true, subjectMask: { data: mask, width: W, height: H }, requireSubjectMask: true });
  let count = 0, worst = 0, lighter = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, a = result.data[i + 3];
    if (!inShadow(x, y) || a <= 8) continue;
    count++;
    // Over a mid-grey backdrop the shadow may darken it but not tint it.
    const over = [0, 1, 2].map((c) => (result.data[i + c] * a + 128 * (255 - a)) / 255);
    worst = Math.max(worst, Math.max(...over) - Math.min(...over));
    // A shadow never lightens a dark backdrop (that read as a hollowed-out patch).
    if ([0, 1, 2].some((c) => (result.data[i + c] * a + 34 * (255 - a)) / 255 > 34.5)) lighter++;
  }
  assert.ok(count > 1000, 'shadow kept: ' + count);
  assert.equal(lighter, 0, 'shadow pixels lighter than a dark backdrop');
  assert.ok(worst <= 3, 'shadow is neutral over grey (largest channel spread ' + worst.toFixed(1) + ')');
  const s = (50 * W + 48) * 4;
  assert.deepEqual([...result.data.slice(s, s + 4)], [...SUBJECT, 255], 'subject unchanged');
});

// The shadow's arm reaching the right border darkened those rows' screen estimate, so the shadow
// came out lighter along them: a horizontal streak in a few frames of the same clip.
test('a shadow reaching the frame border has no horizontal streak', () => {
  const W = 96, H = 120, SCREEN = [17, 198, 46], SHADOW = [12, 150, 62], SUBJECT = [150, 90, 60];
  const data = new Uint8ClampedArray(W * H * 4), mask = new Uint8ClampedArray(W * H);
  const inShadow = (x, y) => x >= 30 && y >= 84 && y < 112 && (x < 70 || (y >= 94 && y < 100));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let rgb = SCREEN;
    if (x >= 36 && x < 60 && y >= 20 && y < 80) { rgb = SUBJECT; mask[y * W + x] = 255; }
    else if (inShadow(x, y)) rgb = SHADOW;
    data.set([...rgb, 255], (y * W + x) * 4);
  }
  const result = loadMatting().matte({ width: W, height: H, data }, { preserveShadow: true, subjectMask: { data: mask, width: W, height: H }, requireSubjectMask: true });
  const alphaAt = (x, y) => result.data[(y * W + x) * 4 + 3];
  // Rows 94-99 (arm at the border) against the rows just above and below, same column inside the body.
  for (const x of [40, 50, 60]) {
    const arm = alphaAt(x, 96), body = (alphaAt(x, 90) + alphaAt(x, 104)) / 2;
    assert.ok(Math.abs(arm - body) <= 3, `column ${x}: alpha ${arm} on the border rows vs ${body} around`);
  }
});
