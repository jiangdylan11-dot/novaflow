// 视频抠图 色键抠图 (2026-10-14): the automatic chroma/glow matte without the AI mask, run on the
// same verified frames as AI抠图. Undetected frames fall back to the clip's screen or stay
// untouched, and 去底 / 实心 remap the automatic alpha (0 = unchanged).
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
  const context = createContext({ module, exports: module.exports, Uint8ClampedArray, Uint8Array, Int32Array, Float32Array, Float64Array, Uint32Array, Map, WeakMap, Math, console, performance, Promise });
  runInContext('(function(module,exports){' + read('renderer/ai-sequence-green-screen-matting.js') + '\n})(module,module.exports)', context);
  return module.exports;
}

const W = 64, H = 64;
// Black screen, a gold patch (solid-looking, bright) and a faint glow ring around it.
function clip(border = [0, 0, 0]) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, d = Math.hypot(x - 32, y - 32);
    const rgb = d < 8 ? [230, 185, 60] : d < 16 ? [40, 22, 6] : d < 18 ? [3, 1, 0] : border;
    data.set([...rgb, 255], i);
  }
  return { width: W, height: H, data };
}
const alphaAt = (r, x, y) => r.alpha[y * W + x];

test('色键 without sliders is the plain automatic matte; 去底 / 实心 remap its alpha', () => {
  const api = loadMatting();
  const auto = api.matte(clip(), { preserveShadow: true });
  const neutral = api.matte(clip(), { preserveShadow: true, keyTune: { floor: 0, solid: 0 } });
  assert.deepEqual(Array.from(neutral.data), Array.from(auto.data), '0 / 0 changes nothing');
  assert.ok(alphaAt(auto, 32, 32) < 250, 'gold is light-like on black without the AI mask');
  const solid = api.matte(clip(), { preserveShadow: true, keyTune: { floor: 0, solid: 40 } });
  assert.equal(alphaAt(solid, 32, 32), 255, '实心 makes the bright patch opaque');
  assert.ok(alphaAt(solid, 32, 44) > alphaAt(auto, 32, 44), 'the faint ring gets a little stronger');
  const floor = api.matte(clip(), { preserveShadow: true, keyTune: { floor: 40, solid: 0 } });
  assert.equal(alphaAt(floor, 32, 44), 0, '去底 clears the faint ring');
  const [r, g, b] = floor.data.slice((44 * W + 32) * 4, (44 * W + 32) * 4 + 3);
  assert.deepEqual([r, g, b], [0, 0, 0], 'a cleared pixel carries no colour');
  assert.ok(alphaAt(floor, 32, 32) > 0, 'the bright patch stays');
});

test('a frame whose border a burst covers uses the clip screen; no screen at all stays untouched', () => {
  const api = loadMatting();
  const burst = clip([200, 120, 30]);
  assert.equal(api.matte(burst, { preserveShadow: true }), null, 'no screen on this frame alone');
  const screen = api.detectSequenceScreen([clip(), clip(), burst]);
  assert.equal(JSON.stringify(screen), JSON.stringify({ rgb: [0, 0, 0], kind: 'black' }));
  assert.ok(api.matte(burst, { preserveShadow: true, fallbackScreen: screen }), 'keyed with the clip screen');
  const kept = api.matte(burst, { preserveShadow: true, keepUndetected: true });
  assert.deepEqual(Array.from(kept.data), Array.from(burst.data), 'undetected and no fallback: the frame as it is');
  assert.equal(api.detectSequenceScreen([burst]), null);
});

test('renderAsync forwards the 色键 options to the matting worker', async () => {
  const posted = [];
  class Worker { constructor(url) { this.url = url; } postMessage(message) { posted.push(message); } terminate() {} }
  const module = { exports: {} };
  const context = createContext({ module, exports: module.exports, Uint8ClampedArray, Uint8Array, Int32Array, Float32Array, Float64Array, Uint32Array, Map, WeakMap, Math, console, performance, Promise,
    document: { currentScript: { src: 'http://localhost/renderer/ai-sequence-green-screen-matting.js?v=test' } }, URL, Worker, navigator: { hardwareConcurrency: 8 }, setTimeout: () => 0, clearTimeout() {} });
  runInContext('(function(module,exports){' + read('renderer/ai-sequence-green-screen-matting.js') + '\n})(module,module.exports)', context);
  module.exports.renderAsync(clip(), { enabled: true, preserveShadow: true, keepUndetected: true, fallbackScreen: { rgb: [0, 0, 0], kind: 'black' }, keyTune: { floor: 5, solid: 10 } });
  await new Promise(resolve => setImmediate(resolve));
  const task = posted.find(message => message.type === 'matte');
  assert.ok(task, 'a matte task was posted');
  assert.equal(task.options.keepUndetected, true);
  assert.equal(JSON.stringify(task.options.fallbackScreen), JSON.stringify({ rgb: [0, 0, 0], kind: 'black' }));
  assert.equal(JSON.stringify(task.options.keyTune), JSON.stringify({ floor: 5, solid: 10 }));
});

test('the bundle runs 色键 on the verified AI frames, without AI, mask or old live-video path', async () => {
  const bundle = read('renderer/assets/index-BbIa-2NM.js');
  const { patchCutoutKeyEntry } = await import('../../../scripts/patch-cutout-key-entry.mjs');
  assert.equal(patchCutoutKeyEntry(bundle), bundle, 'patch applied and idempotent');
  assert.ok(bundle.includes('"data-novaflow-video-cutout-key":`1`'), 'hidden 色键 entry');
  assert.ok(bundle.includes('pe=async(n,nfMode=nfCutoutMode)=>'), 'capture knows the mode');
  assert.ok(bundle.includes('if(nfMode===`key`){U.current.clear();'), '色键 stops after the frame capture');
  assert.ok(bundle.includes('nfStartCutoutSubject(cap,mode)}'), 'both ways capture frames first');
  assert.ok(!bundle.includes('if(mode===`ai`||nfGreenScreen)nfStartCutoutSubject(cap);else'), 'the live-video key start is gone');
  assert.ok(bundle.includes('requireSubjectMask:R===`ai`&&nfCutoutMode!==`key`,fallbackScreen:'), 'no subject mask in 色键');
  assert.ok(bundle.includes('keyTune:nfCutoutMode===`key`?{floor:nfKeyFloor,solid:nfKeySolid}:null'), 'sliders reach the matte');
  assert.ok(bundle.includes('"data-novaflow-key-tune":`1`') && bundle.includes('children:`去底`') && bundle.includes('children:`实心`'), 'slider rows');
  assert.equal(bundle.split('nfPreserveShadow,nfCleanEdges,nfSheer,nfCutoutMode,nfKeyFloor,nfKeySolid').length - 1, 4, 'cache key and effect dependencies');
});

test('the 视频抠图 row offers AI抠图 / 色键抠图', () => {
  const runtime = read('renderer/novaflow-brand-runtime.js');
  assert.ok(runtime.includes('{ mode: "key", label: "色键抠图", entry: \'[data-novaflow-video-cutout-key="1"]\', tool: "chroma-key"'));
  assert.ok(runtime.includes('function ensureAiCutoutChoice(postSection, expanded, activeTool)'));
  assert.ok(runtime.includes('"#373737"'), 'standard hover plate');
});
