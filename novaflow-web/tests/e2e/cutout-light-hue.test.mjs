// 视频抠图 AI抠图 light colour (2026-10-14): yellow sparkles added on top of a green screen
// clip its green channel, so the light's own green cannot be measured. Since 10/12 the mean of
// red and blue stood in for it and Athena's yellow sparkles came out orange; the user wants the
// source colour, which 色键 and the pre-10/12 matte keep. Unmeasured hue now keeps the residual key.
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

test('yellow sparkles over a green screen stay yellow in AI抠图', () => {
  const W = 96, H = 96, SCREEN = [4, 200, 12], SPARK = [255, 255, 150], SUBJECT = [200, 150, 160];
  const spark = (x, y) => (x * 7 + y * 13) % 23 === 0 && x > 10 && x < 50 && y > 20 && y < 70;
  const data = new Uint8ClampedArray(W * H * 4), mask = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let rgb = SCREEN;
    if (x >= 60 && x < 84 && y >= 30 && y < 80) { rgb = SUBJECT; mask[y * W + x] = 255; }
    else if (spark(x, y)) rgb = SPARK;
    data.set([...rgb, 255], (y * W + x) * 4);
  }
  const result = loadMatting().matte({ width: W, height: H, data }, { preserveShadow: true, subjectMask: { data: mask, width: W, height: H }, requireSubjectMask: true });
  let count = 0, green = 0, red = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (!spark(x, y) || mask[y * W + x] || result.data[i + 3] <= 20) continue;
    count++; green += result.data[i + 1]; red += result.data[i];
  }
  assert.ok(count > 50, 'sparkles kept: ' + count);
  assert.ok(green / red > .95, 'sparkles keep their yellow (G/R ' + (green / red).toFixed(3) + '), not orange');
});
