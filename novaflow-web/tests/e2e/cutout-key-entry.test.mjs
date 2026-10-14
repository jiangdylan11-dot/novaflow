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

test('色键 without sliders is the plain automatic matte; 去底 / 修边 / 羽化 adjust it', () => {
  const api = loadMatting();
  const run = keyTune => api.matte(clip(), { preserveShadow: true, keyTune });
  const auto = run(null);
  assert.deepEqual(Array.from(run({ floor: 0, feather: 0, trim: 0 }).data), Array.from(auto.data), '0 / 0 / 0 changes nothing');
  const floor = run({ floor: 40 });
  assert.equal(alphaAt(floor, 32, 44), 0, '去底 clears the faint ring');
  const [r, g, b] = floor.data.slice((44 * W + 32) * 4, (44 * W + 32) * 4 + 3);
  assert.deepEqual([r, g, b], [0, 0, 0], 'a cleared pixel carries no colour');
  assert.ok(alphaAt(floor, 32, 32) > 0, 'the bright patch stays');
  // 修边: minus shrinks, plus grows; grown pixels take the neighbour's colour, never black.
  const solidOnly = { floor: 40 };
  assert.equal(alphaAt(run({ ...solidOnly, trim: -2 }), 32, 39), 0, '修边 -2 takes the patch edge away');
  const grown = run({ ...solidOnly, trim: 2 });
  assert.ok(alphaAt(grown, 32, 41) > 200, '修边 +2 extends the patch');
  const at = (41 * W + 32) * 4;
  assert.ok(grown.data[at] > 150 && grown.data[at + 1] > 100, 'grown edge is gold, not black: ' + Array.from(grown.data.slice(at, at + 3)));
  // 羽化: the outline fades over the last pixels inside; inner detail and colour stay.
  const hard = run(solidOnly), soft = run({ ...solidOnly, feather: 3 });
  const edge = alphaAt(soft, 32, 39);
  assert.ok(edge > 20 && edge < alphaAt(hard, 32, 39), '羽化 softens the edge: ' + edge);
  assert.equal(alphaAt(soft, 32, 32), alphaAt(hard, 32, 32), 'the inside is not blurred');
  assert.equal(alphaAt(soft, 32, 41), 0, 'nothing grows outside the outline');
  const e = (39 * W + 32) * 4;
  assert.deepEqual(Array.from(soft.data.slice(e, e + 3)), Array.from(hard.data.slice(e, e + 3)), 'feathered edge keeps its colour');
});

test('AI抠图 mask mode shares 去底 and 羽化 on the bare mask', () => {
  const api = loadMatting();
  const mask = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mask[y * W + x] = x < 20 ? 0 : x < 24 ? 40 : 255;
  assert.deepEqual(Array.from(api.tuneMask(mask, W, H, {})), Array.from(mask), 'defaults keep the mask');
  const floored = api.tuneMask(mask, W, H, { floor: 40 });
  assert.equal(floored[10 * W + 21], 0, '去底 clears the faint band');
  assert.equal(floored[10 * W + 40], 255, 'solid mask stays solid');
  const soft = api.tuneMask(mask, W, H, { feather: 3 });
  assert.ok(soft[10 * W + 20] < 40 && soft[10 * W + 19] === 0 && soft[10 * W + 40] === 255, '羽化 fades the outline inward only');
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
  module.exports.renderAsync(clip(), { enabled: true, preserveShadow: true, keepUndetected: true, fallbackScreen: { rgb: [0, 0, 0], kind: 'black' }, keyTune: { floor: 5, feather: 2, trim: -1 } });
  await new Promise(resolve => setImmediate(resolve));
  const task = posted.find(message => message.type === 'matte');
  assert.ok(task, 'a matte task was posted');
  assert.equal(task.options.keepUndetected, true);
  assert.equal(JSON.stringify(task.options.fallbackScreen), JSON.stringify({ rgb: [0, 0, 0], kind: 'black' }));
  assert.equal(JSON.stringify(task.options.keyTune), JSON.stringify({ floor: 5, feather: 2, trim: -1 }));
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
  assert.ok(bundle.includes('keyTune:nfCutoutMode===`key`?{floor:nfKeyFloor,feather:nfKeyFeather,trim:Be}:null'), 'sliders reach the matte');
  assert.ok(bundle.includes('"data-novaflow-key-tune":`1`') && !bundle.includes('nfKeySolid') && !bundle.includes('children:`实心`'), '实心 is gone');
  assert.equal(bundle.split('children:`去底`').length - 1, 2, '去底 in both panels');
  assert.ok(bundle.includes('nfCutoutMode!==`key`&&(0,X.jsxs)(`button`,{type:`button`,role:`switch`,"aria-label":`边缘净化`'), '边缘净化 hidden in 色键');
  assert.equal(bundle.split('nfPreserveShadow,nfCleanEdges,nfSheer,nfCutoutMode,nfKeyFloor,nfKeyFeather').length - 1, 4, 'cache key and effect dependencies');
  // AI抠图, 光效透明保留 off: the bare mask with 去底 / 羽化, then the bundle's own 修边.
  assert.ok(bundle.includes('let b=nfGreenScreen?bt(yt(d.getImageData(0,0,r,i)),je,Ne):window.NovaFlowGreenScreenMatting.tuneMask('), 'mask mode uses the shared sliders');
  const legacyAt = bundle.indexOf('!nfGreenScreen&&(0,X.jsxs)(`div`,{"data-novaflow-soft-green-active"');
  const legacy = bundle.slice(legacyAt, bundle.indexOf('data-novaflow-manual-brush', legacyAt));
  const ROW = '(0,X.jsxs)(`div`,{"data-novaflow-ai-cutout-param-row":`1`';
  const shown = legacy.split(ROW).slice(1).map((part, n, parts) => ({ hidden: (n === 0 ? legacy.split(ROW)[0] : parts[n - 1]).endsWith('!1&&'), label: part.match(/children:`([^`]{1,4})`/)[1] })).filter(r => !r.hidden).map(r => r.label);
  assert.deepEqual(shown, ['去底', '羽化', '修边'], 'mask mode shows three sliders: ' + shown);
});

test('the 视频抠图 row offers AI抠图 / 色键抠图', () => {
  const runtime = read('renderer/novaflow-brand-runtime.js');
  assert.ok(runtime.includes('{ mode: "key", label: "色键抠图", entry: \'[data-novaflow-video-cutout-key="1"]\', tool: "chroma-key"'));
  assert.ok(runtime.includes('function ensureAiCutoutChoice(postSection, expanded, activeTool)'));
  assert.ok(runtime.includes('"#373737"'), 'standard hover plate');
});
