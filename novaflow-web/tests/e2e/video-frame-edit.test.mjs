// 帧编辑 (video-frame-edit.core.js): the frame order model behind the 动画 panel's
// frame editor, and the Web decode step (exportDecodeVideoFrames) that hands it
// the stage video's frames at the dock's frame rate.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const capabilitiesSource = await readFile(new URL('../../renderer/novaflow-web-capabilities.js', import.meta.url), 'utf8');

// The core is UMD; loaded in this realm (not a vm) its arrays compare by value under deepEqual.
require('../../renderer/video-frame-edit.core.js');
const core = globalThis.NovaFlowVideoFrameEditCore;

test('a fresh model keeps the source order with the first frame current', () => {
  const model = core.createModel(5);
  assert.deepEqual(model.order, [0, 1, 2, 3, 4]);
  assert.deepEqual(model.selection, [0]);
  assert.equal(model.dirty, false);
  assert.equal(model.canUndo, false);
});

test('删除 drops the selected frames and lands on the frame after the gap', () => {
  const model = core.createModel(6);
  model.selectRange(1, 2);
  assert.equal(model.remove(), true);
  assert.deepEqual(model.order, [0, 3, 4, 5]);
  assert.deepEqual(model.selection, [1]);
  model.select(3);
  model.remove();
  assert.deepEqual(model.order, [0, 3, 4]);
  assert.deepEqual(model.selection, [2], 'removing the last frame selects the new last frame');
  model.selectAll();
  assert.equal(model.remove(), false, 'the clip never loses every frame');
  assert.deepEqual(model.order, [0, 3, 4]);
});

test('复制插帧 inserts a copy right after the selection and selects the copy', () => {
  const model = core.createModel(4);
  model.selectRange(1, 2);
  model.duplicate();
  assert.deepEqual(model.order, [0, 1, 2, 1, 2, 3]);
  assert.deepEqual(model.selection, [3, 4]);
  model.select(5);
  model.duplicate();
  assert.deepEqual(model.order, [0, 1, 2, 1, 2, 3, 3], 'a single frame copy is a hold');
});

test('左移 / 右移 shift the selected block and stop at the clip edges', () => {
  const model = core.createModel(5);
  model.selectRange(1, 2);
  assert.equal(model.move(1), true);
  assert.deepEqual(model.order, [0, 3, 1, 2, 4]);
  assert.deepEqual(model.selection, [2, 3]);
  assert.equal(model.move(1), true);
  assert.deepEqual(model.order, [0, 3, 4, 1, 2]);
  assert.equal(model.move(1), false, 'the block is already at the end');
  assert.deepEqual(model.order, [0, 3, 4, 1, 2]);
  model.select(0);
  assert.equal(model.move(-1), false);
  model.select([1, 3]);
  model.move(-1);
  assert.deepEqual(model.order, [3, 0, 1, 4, 2], 'a scattered selection moves frame by frame');
});

test('倒放 reverses the selected run in place', () => {
  const model = core.createModel(6);
  model.selectRange(1, 4);
  model.reverse();
  assert.deepEqual(model.order, [0, 4, 3, 2, 1, 5]);
  assert.deepEqual(model.selection, [1, 2, 3, 4]);
  model.select(2);
  assert.equal(model.reverse(), false, 'one frame has nothing to reverse');
});

test('镜像 appends the run played back without repeating the turning frame', () => {
  const model = core.createModel(4);
  model.selectAll();
  model.mirror();
  assert.deepEqual(model.order, [0, 1, 2, 3, 2, 1, 0]);
  assert.deepEqual(model.selection, [4, 5, 6]);
  const partial = core.createModel(5);
  partial.selectRange(1, 2);
  partial.mirror();
  assert.deepEqual(partial.order, [0, 1, 2, 1, 3, 4]);
});

test('undo / redo / 还原 walk the history', () => {
  const model = core.createModel(4);
  model.selectRange(0, 1);
  model.remove();
  model.select(1);
  model.duplicate();
  assert.deepEqual(model.order, [2, 3, 3]);
  assert.equal(model.undo(), true);
  assert.deepEqual(model.order, [2, 3]);
  assert.equal(model.undo(), true);
  assert.deepEqual(model.order, [0, 1, 2, 3]);
  assert.deepEqual(model.selection, [0, 1], 'undo restores the selection of that step');
  assert.equal(model.undo(), false);
  assert.equal(model.redo(), true);
  assert.deepEqual(model.order, [2, 3]);
  model.select(0);
  model.move(1);
  assert.equal(model.canRedo, false, 'a new step clears the redo branch');
  assert.equal(model.reset(), true);
  assert.deepEqual(model.order, [0, 1, 2, 3]);
  assert.equal(model.dirty, false);
  assert.equal(model.undo(), true, '还原 itself can be undone');
  assert.deepEqual(model.order, [3, 2]);
});

test('selection helpers clamp to the clip and ignore junk', () => {
  const model = core.createModel(3);
  assert.deepEqual(model.select([2, 2, 9, -1, 'x']), [2]);
  assert.deepEqual(model.toggle(0), [0, 2]);
  assert.deepEqual(model.toggle(2), [0]);
  assert.deepEqual(model.selectRange(5, 1), [1, 2]);
  assert.equal(model.selectionContiguous, true);
  model.select([0, 2]);
  assert.equal(model.selectionContiguous, false);
});

test('只保留选中 keeps the selected frames in order and drops the rest', () => {
  const model = core.createModel(8);
  model.selectRange(2, 5);
  assert.equal(model.keepSelection(), true);
  assert.deepEqual(model.order, [2, 3, 4, 5]);
  assert.deepEqual(model.selection, [0, 1, 2, 3]);
  model.selectAll();
  assert.equal(model.keepSelection(), false, 'keeping everything changes nothing');
  model.undo();
  assert.deepEqual(model.order, [0, 1, 2, 3, 4, 5, 6, 7]);
});

// A clip that walks through a 10-frame cycle twice and then drifts off: the
// loop finder must pick a segment that ends right before the cycle repeats.
function cycleSignatures() {
  const frames = [];
  for (let index = 0; index < 32; index += 1) {
    const phase = index < 24 ? index % 10 : 10 + (index - 24) * 3;
    const signature = new Uint8Array(64);
    for (let pixel = 0; pixel < 64; pixel += 1) signature[pixel] = (phase * 23 + pixel * 7 + (index % 3)) % 256;
    frames.push(signature);
  }
  return frames;
}

test('找循环 ranks the segment whose next frame matches its first frame highest', () => {
  const signatures = cycleSignatures();
  const order = signatures.map((_, index) => index);
  const loops = core.findLoops(signatures, order, { minLength: 8 });
  assert.ok(loops.length > 0);
  const best = loops[0];
  assert.equal(best.length % 10, 0, 'the best loop spans whole cycles, got ' + JSON.stringify(best));
  assert.ok(best.start < 24 && best.end < 24, 'inside the cycling part');
  assert.ok(best.score < 1.5, 'the seam is near-identical: ' + best.score);
  assert.ok(loops.every((loop, index) => index === 0 || loop.score >= loops[index - 1].score), 'sorted by seam difference');
  assert.ok(loops.every((loop) => loop.length >= 8));
});

test('找循环 follows the edited order and skips still segments', () => {
  const signatures = cycleSignatures();
  const order = signatures.map((_, index) => index).reverse();
  const loops = core.findLoops(signatures, order, { minLength: 8 });
  assert.ok(loops.length > 0 && loops[0].score < 1.5, 'a reversed cycle still loops');
  const still = Array.from({ length: 30 }, () => new Uint8Array(64).fill(90));
  assert.deepEqual(core.findLoops(still, still.map((_, index) => index)), [], 'a still clip has no loop worth offering');
  assert.deepEqual(core.findLoops(signatures.slice(0, 5), [0, 1, 2, 3, 4]), [], 'too short');
});

test('the output keeps the source stem with an ASCII _edit suffix', () => {
  assert.equal(core.outputFileName('kling_20261006_190745.mp4', false), 'kling_20261006_190745_edit.mp4');
  assert.equal(core.outputFileName('kling_a_edit.mp4', false), 'kling_a_edit.mp4', 'editing an edit does not stack suffixes');
  assert.equal(core.outputFileName('cut.webm', true), 'cut_edit.webm');
  assert.equal(core.outputFileName('', false), 'video_edit.mp4');
});

// ----------------------------------------------------------- the Web decode step
function bootCapabilities(fakeFfmpeg, { fetchBytes = new Uint8Array([9, 9, 9]) } = {}) {
  const noop = () => {};
  const fakeElement = () => ({ style: { setProperty: noop, removeProperty: noop }, setAttribute: noop, getAttribute: () => null, addEventListener: noop, removeEventListener: noop, appendChild: noop, remove: noop, click: noop, classList: { add: noop, remove: noop, contains: () => false }, querySelector: () => null, querySelectorAll: () => [] });
  const document = Object.assign(fakeElement(), { getElementById: () => null, createElement: fakeElement, body: fakeElement(), documentElement: fakeElement(), baseURI: 'http://test.local/', readyState: 'complete' });
  const sandbox = {
    console, atob, Blob, Response, URL, setTimeout, clearTimeout, setInterval, clearInterval,
    document, location: { href: 'http://test.local/', hash: '', pathname: '/', search: '' }, navigator: { userAgent: 'node' },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    fetch: async () => ({ ok: true, arrayBuffer: async () => fetchBytes.buffer }),
    electronAPI: {}, NovaFlowWebRuntime: {}, NovaFlowWebFfmpeg: fakeFfmpeg
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  sandbox.addEventListener = noop; sandbox.removeEventListener = noop;
  runInContext(capabilitiesSource, createContext(sandbox));
  return sandbox.electronAPI;
}

function fakeFfmpegWithFrames(frameCount, { failAlpha = false } = {}) {
  const files = new Map();
  const execs = [];
  const ffmpeg = {
    events: {}, execs,
    on(event, cb) { this.events[event] = cb; },
    async load() { return true; },
    async writeFile(name, data) { files.set(name, data); return true; },
    async readFile(name) { const data = files.get(name); if (!data) throw new Error('no ' + name); return data; },
    async deleteFile(name) { files.delete(name); return true; },
    async listDir() { return [...files.keys()].map((name) => ({ name, isDir: false })); },
    async exec(args) {
      execs.push(args);
      const log = this.events.log;
      log && log({ type: 'stderr', message: "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'in.mp4':" });
      log && log({ type: 'stderr', message: '  Stream #0:0(und): Video: h264 (High), yuv420p, 640x1376, 24 fps' });
      if (failAlpha && args.includes('libvpx')) return 1;
      const pattern = args[args.length - 1];
      for (let index = 0; index < frameCount; index += 1) {
        files.set(pattern.replace(/%0?(\d*)d/, (m, width) => String(index).padStart(Number(width) || 1, '0')), new Uint8Array([index]));
      }
      return 0;
    }
  };
  return ffmpeg;
}

test('exportDecodeVideoFrames resamples the stage video to the dock frame rate and returns one PNG per frame', async () => {
  const ffmpeg = fakeFfmpegWithFrames(3);
  const api = bootCapabilities(ffmpeg);
  assert.equal(typeof api.exportDecodeVideoFrames, 'function');
  const result = await api.exportDecodeVideoFrames({ sourceUrl: 'blob:test/stage', fileName: 'kling_1.mp4', fps: 16 });
  assert.equal(result.ok, true);
  assert.equal(result.frames.length, 3);
  assert.equal(Array.from(result.frames[2]).join(','), '2', 'frames come back in name order');
  assert.equal(result.alpha, false);
  assert.equal(result.fps, 16);
  assert.equal(result.sourceFps, 24);
  assert.equal(`${result.width}x${result.height}`, '640x1376');
  const decode = ffmpeg.execs.find((args) => args.includes('-vsync'));
  assert.ok(decode.includes('fps=16'), 'the fps filter resamples to the dock rate');
  assert.ok(decode.includes('-an'), 'audio is dropped');
  assert.ok(ffmpeg.execs.every((args) => !args.includes('libvpx')), 'an mp4 does not go through the alpha decoder');
  assert.equal(result.frames.length, 3);
});

test('a webm goes through the alpha decoder first and falls back to a plain decode when that fails', async () => {
  const ffmpeg = fakeFfmpegWithFrames(2, { failAlpha: true });
  const api = bootCapabilities(ffmpeg);
  const result = await api.exportDecodeVideoFrames({ sourceUrl: 'blob:test/cut', fileName: 'cut.webm', fps: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.alpha, false, 'the fallback is opaque');
  assert.equal(result.frames.length, 2);
  assert.ok(ffmpeg.execs.some((args) => args.includes('libvpx')), 'the alpha decoder was tried');
  const ok = fakeFfmpegWithFrames(2);
  const alphaApi = bootCapabilities(ok);
  const alphaResult = await alphaApi.exportDecodeVideoFrames({ sourceUrl: 'blob:test/cut', fileName: 'cut.webm' });
  assert.equal(alphaResult.alpha, true);
  assert.equal(alphaResult.fps, 24, 'without a dock rate the source rate is kept');
  const decode = ok.execs.find((args) => args.includes('-vsync'));
  assert.ok(!decode.some((arg) => /fps=/.test(arg)), 'no resampling without a requested rate');
});

test('exportDecodeVideoFrames refuses an empty clip and caps the frame count', async () => {
  const ffmpeg = fakeFfmpegWithFrames(0);
  const api = bootCapabilities(ffmpeg);
  const result = await api.exportDecodeVideoFrames({ sourceUrl: 'blob:test/empty', fileName: 'x.mp4' });
  assert.equal(result.ok, false);
  const capped = fakeFfmpegWithFrames(1);
  const cappedApi = bootCapabilities(capped);
  await cappedApi.exportDecodeVideoFrames({ sourceUrl: 'blob:test/x', fileName: 'x.mp4', maxFrames: 50 });
  const decode = capped.execs.find((args) => args.includes('-vsync'));
  assert.equal(decode[decode.indexOf('-frames:v') + 1], '50');
});

test('保存选中帧 names each PNG by its position with the source stem', () => {
  assert.equal(core.frameFileName('Video_20261007_003.mp4', 0), 'Video_20261007_003_frame_001.png')
  assert.equal(core.frameFileName('C:\\clips\\walk_edit.webm', 58), 'walk_frame_059.png')
  assert.equal(core.frameFileName('', -3), 'video_frame_001.png')
})

function fakeFfmpegRemux() {
  const files = new Map();
  const execs = [];
  return {
    events: {}, execs,
    on(event, cb) { this.events[event] = cb; },
    async load() { return true; },
    async writeFile(name, data) { files.set(name, data); return true; },
    async readFile(name) { const data = files.get(name); if (!data) throw new Error('no ' + name); return data; },
    async deleteFile(name) { files.delete(name); return true; },
    async exec(args) { execs.push(args); files.set(args[args.length - 1], new Uint8Array([1, 2, 3, 4])); return 0; }
  };
}

test('exportVideoOnlyCopy remuxes the clip without its audio track and caches the copy per source', async () => {
  const ffmpeg = fakeFfmpegRemux();
  const mp4 = new Uint8Array(32); mp4.set([0x66, 0x74, 0x79, 0x70], 4);
  const api = bootCapabilities(ffmpeg, { fetchBytes: mp4 });
  const first = await api.exportVideoOnlyCopy({ sourceUrl: 'blob:test/clip' });
  assert.equal(first.ok, true);
  assert.equal(first.container, 'mp4');
  assert.ok(first.url.startsWith('blob:'), 'a blob url for the copy');
  const args = ffmpeg.execs[0];
  assert.ok(args.includes('-an') && args.includes('copy') && args.includes('+faststart'), 'audio dropped, video copied: ' + args.join(' '));
  const again = await api.exportVideoOnlyCopy({ sourceUrl: 'blob:test/clip' });
  assert.equal(again.cached, true);
  assert.equal(again.url, first.url);
  assert.equal(ffmpeg.execs.length, 1, 'no second remux for the same source');
  const revoked = await api.exportRevokeVideoOnlyCopy({ sourceUrl: 'blob:test/clip' });
  assert.equal(revoked.revoked, true);
  const unknown = await api.exportVideoOnlyCopy({ sourceUrl: 'blob:test/other' });
  assert.equal(unknown.ok, true, 'the same bytes again: a fresh copy');
});

test('exportVideoOnlyCopy refuses bytes that are neither MP4 nor WebM', async () => {
  const api = bootCapabilities(fakeFfmpegRemux(), { fetchBytes: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9]) });
  const result = await api.exportVideoOnlyCopy({ sourceUrl: 'blob:test/junk' });
  assert.equal(result.ok, false);
});
