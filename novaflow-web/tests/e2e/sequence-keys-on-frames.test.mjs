// 序列帧写进动画后，每个关键帧都落在时间轴的整数帧上（编辑器和 Spine 摄影表都按 30 帧/秒）：
// 不累计漂移，两张图不挤在同一帧。覆盖 Spine 序列导出、特效扫光/一个插槽逐帧、小桃加特效。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import '../../renderer/spine-sequence-atlas.js';

const FPS = 30;
const onFrame = (t) => Math.abs((t || 0) * FPS - Math.round((t || 0) * FPS)) < 0.01;
const frameOf = (t) => Math.round((t || 0) * FPS);
function assertOnFrames(keys, label) {
  let prev = -1;
  for (const k of keys) {
    assert.ok(onFrame(k.time), `${label}: ${k.time} s is between frames`);
    assert.ok(frameOf(k.time) > prev, `${label}: two keys on frame ${frameOf(k.time)}`);
    prev = frameOf(k.time);
  }
}
const blank = (seed) => { const p = new Uint8Array(8 * 8 * 4); p.set([seed * 9 % 255, 40, 90, 255], (seed % 64) * 4); return p; };
async function exportSequence(options, count) {
  const files = new Map(), writer = globalThis.NovaFlowSequenceAtlas.createWriter({ baseName: 'fx', ...options, write: async (name, data) => files.set(name, data) });
  for (let i = 0; i < count; i++) await writer.addRgba(blank(i), 8, 8);
  const result = await writer.finish();
  return JSON.parse(files.get(`${result.baseName}.json`));
}

for (const fps of [24, 25, 30, 60]) test(`Spine 3.8 sequence export at ${fps} fps keys whole 30 fps frames`, async () => {
  const json = await exportSequence({ version: '3.8', fps, loop: true }, 48);
  const keys = json.animations.animation.slots.slot.attachment;
  assertOnFrames(keys, `${fps} fps`);
  assert.equal(json.skeleton.fps, 30);
  // the clip keeps its length on the grid: 48 pictures at fps last 48 / fps seconds
  assert.equal(frameOf(keys[keys.length - 1].time), Math.round(48 / fps * FPS));
  // every source picture still shows when the source is not faster than the timeline
  if (fps <= 30) assert.equal(new Set(keys.map((k) => k.name)).size, 48);
});

test('native 4.1 Sequence ends on a whole frame', async () => {
  const json = await exportSequence({ version: '4.1', fps: 24, loop: false }, 25);
  const seq = Object.values(json.animations.animation.attachments.default.slot)[0].sequence;
  assertOnFrames(seq, '4.1 sequence');
});

const editorSource = (await readFile(new URL('../../renderer/spine-skeleton-editor.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
function editorGridKeys() {
  const m = editorSource.match(/\n  function gridKeys\(keys\) \{[\s\S]*?\n  \}\n/);
  assert.ok(m, 'gridKeys is in the editor');
  return vm.runInNewContext(`const FPS = ${FPS};${m[0]};gridKeys`);
}

test('特效扫光 / 一个插槽逐帧: 时长 ÷ 张数 steps land on whole frames without drift or sharing', () => {
  const gridKeys = editorGridKeys();
  // 24 pictures over frames 0 → 60 (step 2.5 frames): the screenshot's case
  const step = 60 / 24 / FPS;
  const keys = gridKeys([{ name: null }, ...Array.from({ length: 24 }, (_, i) => ({ time: 5 / FPS + i * step, name: `p${i}` })), { time: 65 / FPS, name: null }]);
  assertOnFrames(keys, 'step 2.5');
  assert.equal(keys[0].time, undefined, 'the frame-0 key keeps no time');
  for (let i = 0; i < 24; i++) assert.ok(Math.abs(frameOf(keys[i + 1].time) - (5 + i * 2.5)) <= 0.5, `picture ${i} drifted`);
  // more pictures than frames: each still gets its own frame
  const dense = gridKeys(Array.from({ length: 12 }, (_, i) => ({ time: i * 0.6 / FPS, name: `d${i}` })));
  assertOnFrames(dense, 'step 0.6');
  // both writers go through it
  assert.match(editorSource, /row\.color = gridKeys\(keys\)/);
  assert.match(editorSource, /row\.attachment = gridKeys\(keys\)/);
});

test('小桃加特效: a squeezed loop keeps the effect pictures on whole frames', async () => {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(await readFile(new URL('../../renderer/motion-recipes.js', import.meta.url), 'utf8'), sandbox);
  const R = sandbox.NovaFlowMotionRecipes;
  const src = { skeleton: { spine: '3.8.99' }, bones: [{ name: 'root' }], slots: [], skins: [{ name: 'default', attachments: {} }],
    animations: { a: { bones: { root: { rotate: [{ time: 0, angle: 0 }, { time: 1, angle: 0 }] } } } } };
  // 7 pictures a frame apart, looping: four loops squeezed into the 1 s animation (×1.07)
  const att = {}; for (let i = 0; i < 7; i++) att[`f${i}`] = { width: 8, height: 8 };
  const fx = { id: 'test', loop: true, duration: 7 / FPS, bones: [{ name: 'root' }], slots: [{ name: 'fx', bone: 'root', attachment: 'f0' }], attachments: { fx: att },
    animation: { slots: { fx: { attachment: Array.from({ length: 7 }, (_, i) => ({ time: i / FPS, name: `f${i}` })) } } } };
  for (const time of [0, 0.51]) {
    const out = R.mergeEffect(src, fx, { anim: 'a', time, x: 0, y: 0, scale: 1, under: null });
    const row = Object.values(out.json.animations.a.slots)[0];
    assertOnFrames(row.attachment, `merge at ${time}`);
  }
});
