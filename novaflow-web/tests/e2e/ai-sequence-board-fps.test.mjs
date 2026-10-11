import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import '../../renderer/ai-sequence-board-fps.js';
import '../../renderer/ai-sequence-board-names.js';
import '../../renderer/spine-sequence-atlas.js';

const fps = globalThis.NovaFlowAiSequenceBoardFps;
const bundle = await readFile(new URL('../../renderer/assets/index-BbIa-2NM.js', import.meta.url), 'utf8');
const loaderStart = bundle.indexOf('k=async t=>{const nfFpsApi') + 2;
const loaderSource = bundle.slice(loaderStart, bundle.indexOf('},A=async()=>', loaderStart) + 1);
const board = (id, value, video) => ({ id, label: id.slice(1), animationName: `动画${id}`, w: 17, h: 25, timelineFps: value, loadedVideo: video });
const video = (sourceFps, sourceFrames = sourceFps * 2) => ({ objectUrl: `blob:${sourceFps}`, sourceFps, sourceFrames, sourceDurationSec: 2 });
function session(initial = [board('b1'), board('b2')]) {
  let boards = initial, activeId = boards[0].id;
  const controller = fps.createController();
  const render = () => controller.connect({ boards, activeId, setBoards: updater => { boards = updater(boards); render(); } });
  render();
  return { controller, get boards() { return boards; }, switch(id) { controller.cancelPending(); activeId = id; render(); },
    place(value) { return controller.commitImport(controller.beginImport(), value); } };
}
const close = (a, b) => assert(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test('24 source initializes once; manual 12 survives the 60 board, switching back and metadata refresh', () => {
  const state = session();
  state.place(video(24));
  assert.equal(state.boards[0].timelineFps, 24);
  state.controller.setFps(12);
  state.switch('b2'); state.place(video(60));
  assert.equal(state.boards[1].timelineFps, 60);
  state.switch('b1'); state.controller.enrich('blob:24', { fps: 24, frames: 48, durationSec: 2 });
  assert.equal(state.boards[0].timelineFps, 12);
  assert.equal(state.boards[0].loadedVideo.sourceFps, 24);
  assert.equal(state.boards[0].animationName, '动画b1');
  state.place(video(60));
  assert.equal(state.boards[0].timelineFps, 60, 'replacement video initializes a new source once');
  assert.equal(state.boards[1].timelineFps, 60);
});

test('a late source probe cannot override manual 12, including before React commits a render', () => {
  const controller = fps.createController();
  let boards = [board('b1', 30)];
  controller.connect({ boards, activeId: 'b1', setBoards: updater => { boards = updater(boards); } });
  const ticket = controller.beginImport();
  controller.setFps(12);
  controller.commitImport(ticket, video(24));
  assert.equal(boards[0].timelineFps, 12);
  assert.equal(boards[0].loadedVideo.sourceFps, 24);
});

test('imports are isolated by board, active epoch, and source serial; an empty new board has its own fallback', () => {
  const state = session();
  const old = state.controller.beginImport();
  state.switch('b2'); state.place(video(60));
  assert.equal(state.controller.commitImport(old, video(24)), null);
  state.switch('b1');
  assert.equal(state.controller.commitImport(old, video(24)), null, 'returning does not revive a stale import');
  const first = state.controller.beginImport(), second = state.controller.beginImport();
  assert.equal(state.controller.commitImport(first, video(24)), null);
  state.controller.commitImport(second, video(60));
  state.controller.setFps(18);
  assert.equal(state.boards[1].timelineFps, 60);
  assert.equal(fps.effective(board('b3')), 30);
  const copy = { ...state.boards[0], id: 'b3' };
  assert.equal(fps.effective(copy), 18, 'board copying keeps its settings without sharing a mutable fps');
});

test('fractional rates and source rationals are retained; unavailable and VFR metadata have explicit provenance', () => {
  for (const value of [29.97, 23.976, 30000 / 1001, 24000 / 1001]) {
    const state = session(); state.place(video(value));
    assert.equal(state.boards[0].timelineFps, value);
    state.controller.setFps(value / 2); state.switch('b2'); state.switch('b1');
    assert.equal(state.boards[0].timelineFps, value / 2);
  }
  assert.equal(fps.metadata({ fpsExpr: '30000/1001' }).sourceFps, 30000 / 1001);
  assert.equal(fps.metadata({ fps: 0 }).sourceFpsOrigin, 'unavailable');
  assert.equal(fps.metadata({ fps: 25.2, rateMode: 'variable', fpsOrigin: 'ffprobe-average' }).sourceRateMode, 'variable');
  const state = session([board('b1', 18)]); state.place({ objectUrl: 'blob:unknown' });
  assert.equal(state.boards[0].timelineFps, 18);
  assert.equal(state.boards[0].loadedVideo.sourceFps, null);
});

test('both modes sample the source at the board fps; unlocked plays at the source rate (more frames = slower), locked keeps the duration', () => {
  const original = { ...board('b1', 12, video(24)), keepDuration: false };
  // 12 frames per source second played at the source's 24: half the frames, twice the speed
  const free = fps.framePlan(original, 2);
  assert.equal(free.count, 24); assert.equal(free.times[23], 23 / 12);
  assert.equal(free.durationSec, 1); assert.equal(free.playbackRate, 2); assert.equal(free.fps, 24); assert.equal(free.boardFps, 12);
  // 48 per source second: twice the frames, half the speed
  const slow = fps.framePlan({ ...original, timelineFps: 48 }, 2);
  assert.equal(slow.count, 96); assert.equal(slow.durationSec, 4); assert.equal(slow.playbackRate, .5); assert.equal(slow.fps, 24);
  const locked = fps.framePlan({ ...original, keepDuration: true }, 2);
  assert.equal(locked.count, 24); assert.equal(locked.times[23], 23 / 12);
  assert.equal(locked.durationSec, 2); assert.equal(locked.playbackRate, 1); assert.equal(locked.fps, 12);
  const fractional = fps.framePlan(board('b1', 24000 / 1001, video(24000 / 1001, 48)), 2.002);
  close(fractional.durationSec, 2.002); close(fractional.times[47], 47 * 1001 / 24000);
  const reopened = JSON.parse(JSON.stringify(original));
  assert.equal(fps.framePlan(reopened, 2).boardFps, 12);
});

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function loaderHarness(state, probes) {
  let localVideo = null;
  const e = { aiSeqLoadTokenRef: { current: 0 }, aiSeqGenerated: [], setAiSeqLocalVideo(value) { localVideo = value; },
    setAiSeqFrameMode() {}, setAiSeqBgEnabled() {}, setAiSeqCanvasImage() {}, setPreviewTimelinePlaying() {}, setPreviewTimelineT() {},
    setAiSeqTimelineFps() { throw Error('global source fps setter must never be called'); } };
  const helper = { ...fps, beginImport: () => state.controller.beginImport(), isCurrent: ticket => state.controller.isCurrent(ticket),
    commitImport: (ticket, source) => state.controller.commitImport(ticket, source) };
  const context = vm.createContext({ e, window: { NovaFlowAiSequenceBoardFps: helper },
    fetch: async () => ({ blob: async () => new Blob(['metadata-only fixture']) }),
    v: async (_, name) => probes.get(name).promise, n: { current: new Set() }, URL });
  return { load: vm.runInContext(`(${loaderSource})`, context), get video() { return localVideo; } };
}

test('actual resource import action initializes 24 and 60 separately and preserves user edits while probe waits', async () => {
  const state = session(), first = deferred(), second = deferred(), late = deferred();
  const action = loaderHarness(state, new Map([['first.mp4', first], ['second.mp4', second], ['late.mp4', late]]));
  let pending = action.load({ type: 'local', objectUrl: 'blob:first', filename: 'first.mp4' });
  first.resolve({ fps: 24, frames: 48, durationSec: 2 }); await pending;
  assert.equal(state.boards[0].timelineFps, 24);
  state.controller.setFps(12); state.switch('b2');
  pending = action.load({ type: 'local', objectUrl: 'blob:second', filename: 'second.mp4' });
  second.resolve({ fps: 60, frames: 120, durationSec: 2 }); await pending;
  assert.equal(state.boards[1].timelineFps, 60); state.switch('b1');
  assert.equal(state.boards[0].timelineFps, 12);
  pending = action.load({ type: 'local', objectUrl: 'blob:late', filename: 'late.mp4' });
  state.controller.setFps(12); late.resolve({ fps: 29.97, durationSec: 2 }); await pending;
  assert.equal(state.boards[0].timelineFps, 12);
  assert.equal(state.boards[0].loadedVideo.sourceFps, 29.97);
});

test('actual resource import discards late media after a switch and cannot change the other board', async () => {
  const state = session(), probe = deferred(), action = loaderHarness(state, new Map([['late.mp4', probe]]));
  const pending = action.load({ type: 'local', objectUrl: 'blob:late', filename: 'late.mp4' });
  state.switch('b2'); state.place(video(60));
  probe.resolve({ fps: 24, frames: 48, durationSec: 2 }); await pending;
  assert.equal(action.video, null);
  assert.equal(state.boards[0].loadedVideo, undefined);
  assert.equal(state.boards[1].timelineFps, 60);
});

// Evaluate the shipped export action and real atlas writer, replacing only the
// canvas/video I/O. The captured seek times verify source sampling as well as JSON.
async function exportBoards(boards, version, packed) {
  const pack = globalThis.NovaFlowSequenceAtlas, saved = new Map(), reads = [];
  const makeVideo = src => ({ src, currentSrc: src, currentTime: 0, videoWidth: 17, videoHeight: 25, duration: 2, pause() {} });
  const media = makeVideo(boards[0].loadedVideo.objectUrl), rgba = new Uint8Array(17 * 25 * 4); rgba.fill(180);
  const document = { createElement: type => {
    if (type === 'video') return makeVideo('');
    const canvas = { width: 17, height: 25 };
    canvas.getContext = () => ({ clearRect() {}, drawImage() {}, putImageData() {}, getImageData: () => ({ data: rgba }) }); return canvas;
  } };
  const ref = current => ({ current });
  const context = vm.createContext({ window: { NovaFlowSequenceAtlas: pack, NovaFlowAiSequenceBoardNames: globalThis.NovaFlowAiSequenceBoardNames, NovaFlowAiSequenceBoardFps: fps },
    document, Blob, TextEncoder, CompressionStream, Response, HTMLImageElement: class {},
    e: { boards, sourceFps: 24 }, t: ref(media), l: 30, N: true, V: true,
    M: { pickDirectory: async () => ({ dir: 'AI' }), writeBinaryFile: async payload => { saved.set(`${payload.dir}/${payload.fileName}`.replaceAll('\\', '/'), payload.bytes); return { ok: true }; } },
    k: true, A: version, w: 30, E: 30, T: false, R: 'ai', ce: null, c: 100, o: 17, s: 25, r: 'source.mp4', a: 2, u: false, d: 0, f: 120,
    G: ref({ fps: 24, times: [0, 1 / 24] }), U: ref(new Map()), En: ref(false), Sn: ref(0), ln: ref({ token: 0 }), Yn() {}, nfPauseCutoutPlayback() {},
    nfCreateCutoutExportReader: async source => ({ media: source, release() {} }), Rt: async () => {}, wt: async () => {},
    rr: async request => {
      reads.push({ src: request.media.src, time: request.timeSec });
      const frame = reads.length;
      for (let index = 0; index < rgba.length; index += 4) {
        rgba[index] = frame * 71 % 251; rgba[index + 1] = frame * 43 % 251;
        rgba[index + 2] = frame * 97 % 251; rgba[index + 3] = 255;
      }
      return { width: 17, height: 25, imageData: { data: rgba } };
    },
    It: async canvas => new Blob([await pack.encodePng(rgba, canvas.width, canvas.height)]),
    Z: (value, min, max) => Math.max(min, Math.min(max, value)), Q: value => Math.max(0, Math.min(1, value)),
    yr: '', Zt: ref(new Map()), ye: '#00ff00', _e: [], De: 0, ke: 1, je: 0, Ne: 0, Y: 0, Be: 0, Ie: 0, Re: 1, Kt: ref(null), Ut: new Map(), alert(message) { throw Error(message); }
  });
  const start = bundle.indexOf('ni=async n=>') + 3;
  const source = bundle.slice(start, bundle.indexOf('},ri=', start) + 1);
  await vm.runInContext(`(${source})`, context)({ baseName: '动画集', atlasPack: packed, silent: true, throwOnError: true });
  return { json: JSON.parse(new TextDecoder().decode(saved.get('AI/NovaFlow/动画集.json'))), saved, reads };
}

test('actual Spine/atlas action uses each board fps and keeps names, frame count, timing and source sampling consistent', async () => {
  const boards = [{ ...board('b1', 12, video(24)), keepDuration: false }, { ...board('b2', 60, video(60)), keepDuration: true }];
  for (const version of ['3.8', '4.0', '4.1', '4.2']) for (const packed of [false, true]) {
    const { json, saved, reads } = await exportBoards(boards, version, packed);
    assert.deepEqual(Object.keys(json.animations), ['动画b1', '动画b2']);
    // b1: 12 frames per source second, unlocked, played at the source's 24 → 24 frames, 1 s
    for (const [index, expected] of [{ count: 24, fps: 24, sampleFps: 12, duration: 1 }, { count: 120, fps: 60, sampleFps: 60, duration: 2 }].entries()) {
      const name = `动画b${index + 1}`, slot = `slot_${index + 1}`;
      const sampled = reads.filter(read => read.src === boards[index].loadedVideo.objectUrl);
      assert.equal(sampled.length, expected.count); close(sampled[1].time, 1 / expected.sampleFps);
      if (version === '3.8' || version === '4.0') {
        const timeline = json.animations[name].slots[slot].attachment;
        close(timeline[1].time, 1 / expected.fps); close(timeline.at(-1).time, expected.duration);
      }
      else {
        const sequence = json.animations[name].attachments.default[slot][`${name}_seq`].sequence;
        close(sequence[0].delay, 1 / expected.fps); close(sequence[1].time, expected.duration);
        assert.equal(json.skins[0].attachments[slot][`${name}_seq`].sequence.count, expected.count);
      }
      if (packed) assert(new TextDecoder().decode(saved.get('AI/NovaFlow/动画集.atlas')).includes(`${name}_0000`));
      else assert.equal([...saved.keys()].filter(path => path.includes(`/images/${name}_`)).length, expected.count);
    }
  }
});

test('actual fractional export retains 23.976 timing through native Sequence and legacy slot JSON', async () => {
  for (const version of ['3.8', '4.2']) {
    const value = 24000 / 1001;
    const { json } = await exportBoards([board('b1', value, video(value, 48))], version, false);
    if (version === '3.8') close(json.animations['动画b1'].slots.slot_1.attachment[1].time, 1 / value);
    else close(json.animations['动画b1'].attachments.default.slot_1['动画b1_seq'].sequence[0].delay, 1 / value);
  }
});

test('frame editor reads decimal dock fps and the loaded timeline routes fps changes to the board setter', async () => {
  const source = await readFile(new URL('../../renderer/video-frame-edit.tool.js', import.meta.url), 'utf8');
  const start = source.indexOf('function readDockFps()');
  const functionSource = source.slice(start, source.indexOf('\n  function notify', start));
  class Input { constructor() { this.value = '23.976'; } }
  const reader = vm.runInNewContext(`(${functionSource})`, { document: { querySelector: () => new Input() }, HTMLInputElement: Input, clamp: (x, a, b) => Math.max(a, Math.min(b, x)) });
  assert.equal(reader(), 23.976);
  assert(bundle.includes('onFpsValueChange:e=>At(window.NovaFlowAiSequenceBoardFps.clamp(e))'));
  assert(!bundle.includes('setAiSeqTimelineFps(Math.max(1,Math.min(120,Math.round('));
  assert(bundle.includes('frameTimes:Br?pr?.times:nfAiSeqPlan.times'));
  assert(bundle.includes('mr({fps:n,times:i,frameIndex:o})'));
  const decodeStart = source.indexOf('const sourceName = findSourceName(src)');
  const decode = source.slice(decodeStart, source.indexOf('if (!result?.ok', decodeStart));
  for (const locked of [false, true]) {
    let request;
    const state = session([board('b1', 12, video(24))]);
    state.controller.setLocked(locked);
    const context = vm.createContext({ window: { NovaFlowAiSequenceBoardFps: { currentPlan: duration => state.controller.currentPlan(duration) } },
      video: { duration: 2 }, src: 'blob:24', MAX_FRAMES: 1000, findSourceName: () => 'source.mp4', readDockFps: () => 12,
      bridge: { exportDecodeVideoFrames: async value => { request = value; return { ok: true, fps: value.fps }; } } });
    await vm.runInContext(`(async()=>{${decode}})()`, context);
    // the frame editor decodes at the board fps in both modes (that is the sampling rate)
    assert.equal(request.fps, 12);
    assert(source.includes('state.fps = fps || Number(result.fps) || 16'));
  }
});

test('browser source probe preserves FFmpeg decimal fps without inventing frames or identifying VFR', async () => {
  const source = await readFile(new URL('../../renderer/novaflow-web-capabilities.js', import.meta.url), 'utf8');
  const start = source.indexOf('api.aiSeqProbeVideoMeta = async (payload) =>');
  const functionSource = source.slice(start + 'api.aiSeqProbeVideoMeta = '.length, source.indexOf('\n  api.videoCompositorOpenSession', start)).trim().replace(/;$/, '');
  let context;
  const ffmpeg = { writeFile: async () => {}, deleteFile: async () => {}, exec: async () => {
    context.ffmpegJob.log = 'Duration: 00:00:02.002, start: 0.000\n Stream #0:0: Video: h264, yuv420p, 1920x1080, 29.97 fps, 29.97 tbr';
  } };
  context = vm.createContext({ loadFfmpeg: async () => ffmpeg, videoOutputSeq: 0, ffmpegJob: null, ffmpegPromise: true,
    bytesOf: async source => source, durationFromLog: () => 2.002, fail: message => ({ ok: false, error: message }) });
  const result = await vm.runInContext(`(${functionSource})`, context)({ bytes: new Uint8Array([1]), fileName: 'fractional.mp4' });
  assert.equal(result.ok, true); assert.equal(result.fps, 29.97); assert.equal(result.frames, 0);
  assert.equal(result.fpsOrigin, 'ffmpeg-stream-log'); assert.equal(result.rateMode, 'unknown');
  assert.match(fps.rateInfo({ objectUrl: 'blob:fractional', ...fps.metadata(result) }), /无法确认恒定帧率/);
});
