// MP4 压缩 / 视频格式转换 in the browser.
//
// The two tools call electronAPI.compressMp4 / convertVideoFormat with a file
// token, then videoResourceMediaRegister for a preview and saveVideoToolOutput
// to write the result. The Web answers in novaflow-web-capabilities.js run
// ffmpeg.wasm; this drives them with a recording stand-in for it (the real
// core is a 32 MB WebAssembly binary that only runs in a browser worker) and
// holds the ffmpeg arguments to the desktop's own modules, which are required
// here and compared argument for argument.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';

const require = createRequire(import.meta.url);
const desktopCompress = require('../../../particle-editor-desktop/main/mp4-compressor.js');
const desktopConvert = require('../../../particle-editor-desktop/main/video-format-converter.js');
const source = await readFile(new URL('../../renderer/novaflow-web-capabilities.js', import.meta.url), 'utf8');

let checks = 0;
const equal = (a, b, what) => { assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), what); checks += 1; };
const ok = (value, what) => { assert.ok(value, what); checks += 1; };

// The desktop wraps its arguments in log and progress flags that ffmpeg.wasm
// neither needs nor wants (it reads progress from the default log).
const DESKTOP_HEAD = ['-hide_banner', '-loglevel', 'error', '-y'];
const DESKTOP_TAIL = ['-progress', 'pipe:1', '-nostats'];
const core = (args) => {
  const list = [...args];
  for (const flag of DESKTOP_HEAD) { if (list[0] === flag) list.shift(); }
  const out = list.pop();
  for (let i = DESKTOP_TAIL.length - 1; i >= 0; i -= 1) { if (list[list.length - 1] === DESKTOP_TAIL[i]) list.pop(); }
  return [...list, out];
};

// ----------------------------------------------------------- the stand-in
const files = new Map();
const execs = [];
let probeAudio = 'aac';
let outputBytes = 1000;
const fakeFfmpeg = {
  events: {},
  on(event, cb) { this.events[event] = cb; },
  async load() { return true; },
  async writeFile(name, data) { files.set(name, data); return true; },
  async readFile(name) { const data = files.get(name); if (!data) throw new Error('no ' + name); return data; },
  async deleteFile(name) { files.delete(name); return true; },
  async exec(args) {
    execs.push(args);
    const log = this.events.log;
    if (args.length === 2 && args[0] === '-i') {
      // The probe: ffmpeg lists the streams, then refuses for want of an output.
      log && log({ type: 'stderr', message: 'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from \'in.mp4\':' });
      log && log({ type: 'stderr', message: '  Stream #0:0(und): Video: h264 (High), yuv420p, 1280x720, 30 fps' });
      if (probeAudio) log && log({ type: 'stderr', message: `  Stream #0:1(und): Audio: ${probeAudio}, 48000 Hz, stereo` });
      return 1;
    }
    const progress = this.events.progress;
    progress && progress({ progress: 0.5, time: 500000 });
    files.set(args[args.length - 1], new Uint8Array(outputBytes));
    return 0;
  }
};

const urls = [];
const sandboxUrl = Object.assign(function (u, b) { return new URL(u, b); }, { createObjectURL: (blob) => { const u = 'blob:test/' + urls.length; urls.push({ u, blob }); return u; }, revokeObjectURL: () => {} });
// The page hands out its own tokens for dropped files (getPathForFile); the
// tools pass those back as inputPath.
const inputFile = (name, bytes) => ({ name, size: bytes, arrayBuffer: async () => new Uint8Array(bytes).buffer });
function boot() {
  const noop = () => {};
  const fakeElement = () => ({ style: { setProperty: noop, removeProperty: noop }, setAttribute: noop, getAttribute: () => null, addEventListener: noop, removeEventListener: noop, appendChild: noop, remove: noop, click: noop, classList: { add: noop, remove: noop, contains: () => false }, querySelector: () => null, querySelectorAll: () => [] });
  const document = Object.assign(fakeElement(), { getElementById: () => null, createElement: fakeElement, body: fakeElement(), documentElement: fakeElement(), baseURI: 'http://test.local/', readyState: 'complete' });
  const sandbox = {
    console, atob, Blob, Response, CompressionStream, DecompressionStream, URL: sandboxUrl, setTimeout, clearTimeout, setInterval, clearInterval,
    document, location: { href: 'http://test.local/', hash: '', pathname: '/', search: '' }, navigator: { userAgent: 'node' }, localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '', json: async () => ({}) }),
    electronAPI: {},
    NovaFlowWebRuntime: {},
    NovaFlowWebFfmpeg: fakeFfmpeg
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const events = {};
  sandbox.addEventListener = (name, cb) => { events[name] = cb; };
  sandbox.removeEventListener = noop;
  runInContext(source, createContext(sandbox));
  return sandbox;
}

const sandbox = boot();
const api = sandbox.electronAPI;
ok(typeof api.compressMp4 === 'function' && typeof api.convertVideoFormat === 'function', 'the Web build answers compressMp4 and convertVideoFormat');
ok(typeof api.saveVideoToolOutput === 'function' && typeof api.overwriteVideoToolOutput === 'function', 'and the save / overwrite pair');

// AI sequence export appends a NovaFlow folder to the picked Web directory.
// Every frame must reuse that permission rather than opening a save dialog.
{
  const written = [];
  const makeFolder = (path) => ({
    name: path.split('/').pop(),
    async getDirectoryHandle(name) { return makeFolder(path + '/' + name); },
    async getFileHandle(name) {
      return { async createWritable() { return {
        async write(data) { written.push({ path: path + '/' + name, size: data.size }); },
        async close() {}
      }; } };
    }
  });
  let pickerCalls = 0;
  sandbox.showDirectoryPicker = async () => { pickerCalls += 1; return makeFolder('selected'); };
  const originalSave = api.exportPickSaveFile;
  api.exportPickSaveFile = async () => { throw new Error('unexpected per-frame save dialog'); };
  const picked = await api.pickDirectory();
  for (const index of [1, 2]) {
    const saved = await api.writeBinaryFile({ dir: picked.dir + '\\NovaFlow\\images', fileName: `jc_000${index}.png`, bytes: new Uint8Array([index]) });
    equal(saved.ok, true, `sequence frame ${index} is written through the picked folder`);
  }
  equal(pickerCalls, 1, 'the browser asks for a folder once');
  equal(written.map((item) => item.path), ['selected/NovaFlow/images/jc_0001.png', 'selected/NovaFlow/images/jc_0002.png'], 'both frames are written to the nested export folder');
  api.exportPickSaveFile = originalSave;
}

// Transparent save output must support random access, not only linear playback.
// Exercise the real temp-frame -> encoder API rather than matching source text.
{
  for (const keepAlpha of [true, false]) {
    const { dir } = await api.exportCreateTempDir({ prefix: 'seek-regression' });
    await api.writeBinaryFile({ dir, fileName: 'NF_0000.png', bytes: new Uint8Array([1, 2, 3]) });
    execs.length = 0;
    const result = await api.exportEncodeFramesToVideo({ dir, pattern: 'NF_%04d.png', fps: 16, width: 448, height: 448, keepAlpha, returnBase64: false });
    equal(result.ok, true, 'save API encodes collected cutout frames');
    const args = execs[0];
    if (keepAlpha) {
      equal(args[args.indexOf('-g') + 1], '1', 'every alpha frame can be decoded independently after a seek');
      equal(args[args.indexOf('-pix_fmt') + 1], 'yuva420p', 'random access retains the alpha plane');
      equal(args[args.indexOf('-auto-alt-ref') + 1], '0', 'alpha encoding disables alternate reference frames');
    } else {
      equal(args.includes('-g'), false, 'opaque sequence encoding keeps its existing compression');
    }
    await api.exportCleanupDir({ dir });
  }
}

// Saved cutout WebM must be decoded with libvpx so every frame keeps alpha.
{
  const originalExec = fakeFfmpeg.exec;
  const originalFetch = sandbox.fetch;
  let decodeArgs;
  fakeFfmpeg.exec = async (args) => {
    decodeArgs = args;
    const pattern = args[args.length - 1];
    files.set(pattern.replace('%06d', '000000'), new Uint8Array([0, 1]));
    files.set(pattern.replace('%06d', '000001'), new Uint8Array([2, 3]));
    return 0;
  };
  fakeFfmpeg.listDir = async () => [...files.keys()].map((name) => ({ name }));
  sandbox.fetch = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([9, 8]).buffer });
  const decoded = await api.exportDecodeAlphaVideoFrames({ sourceUrl: 'blob:saved-cutout' });
  equal(decoded.ok, true, 'saved cutout video decodes');
  equal(decodeArgs.slice(0, 4), ['-c:v', 'libvpx', '-i', decodeArgs[3]], 'alpha-aware decoder is selected before the input');
  equal(decoded.frames.map((frame) => [...frame]), [[0, 1], [2, 3]], 'all decoded frames are returned in order');
  fakeFfmpeg.exec = originalExec;
  sandbox.fetch = originalFetch;
}

const progressSeen = [];
api.onVideoToolProgress((data) => progressSeen.push(data));

// ------------------------------------------------------------ MP4 压缩
const clipToken = api.getPathForFile(inputFile('clip.mp4', 5000));
const movToken = api.getPathForFile(inputFile('clip.mov', 7000));
ok(/^web-file:\/\//.test(clipToken), 'a dropped file gets a web-file token: ' + clipToken);
{
  execs.length = 0; outputBytes = 1000; probeAudio = 'aac';
  const result = await api.compressMp4({ jobId: 'mp4_1', inputPath: clipToken, fileName: 'clip.mp4', strength: 60 });
  equal(result.ok, true, 'a clip compresses: ' + result.error);
  equal([result.keptOriginal, result.fileName, result.bytesIn, result.bytesOut], [false, 'clip-compressed.mp4', 5000, 1000], 'the desktop result shape, named like the desktop names it');
  ok(/^web-video:\/\//.test(result.outPath), 'the result is a web-video token: ' + result.outPath);
  equal(execs.length, 2, 'one probe pass, one encode');
  const plan = desktopCompress.mp4CompressionPlan(60);
  equal(result.plan.crf, plan.crf, 'the CRF follows the desktop plan (' + plan.crf + ')');
  const expected = core(desktopCompress.mp4CompressArgs({ inPath: execs[1][1], outPath: execs[1][execs[1].length - 1], crf: plan.crf, audioMode: 'copy' }));
  equal(execs[1], expected, 'the encode arguments are the desktop\'s, less its log and progress flags');
  ok(progressSeen.some((p) => p.jobId === 'mp4_1' && p.progress01 === 0.5) && progressSeen.some((p) => p.jobId === 'mp4_1' && p.progress01 === 1), 'progress reached the tool with the job id');
  const preview = await api.videoResourceMediaRegister({ filePath: result.outPath });
  equal([preview.ok, typeof preview.url, preview.token], [true, 'string', result.outPath], 'the preview gets a playable URL for the token');
  equal(urls[urls.length - 1].blob.type, 'video/mp4', 'as an MP4 blob');
  equal(urls[urls.length - 1].blob.size, 1000, 'holding the encoder output');
  ok(files.size === 0, 'the ffmpeg file system is left empty');

  // An input without audio, and one with non-AAC audio.
  probeAudio = ''; execs.length = 0;
  await api.compressMp4({ jobId: 'mp4_2', inputPath: clipToken, fileName: 'clip.mp4', strength: 0 });
  equal(execs[1], core(desktopCompress.mp4CompressArgs({ inPath: execs[1][1], outPath: execs[1][execs[1].length - 1], crf: 18, audioMode: 'none' })), 'no audio track: -an, and strength 0 is CRF 18');
  probeAudio = 'mp3'; execs.length = 0;
  await api.compressMp4({ jobId: 'mp4_3', inputPath: clipToken, fileName: 'clip.mp4', strength: 100 });
  equal(execs[1], core(desktopCompress.mp4CompressArgs({ inPath: execs[1][1], outPath: execs[1][execs[1].length - 1], crf: 34, audioMode: 'encode' })), 'other audio is re-encoded to AAC, and strength 100 is CRF 34');

  // The keep-original rule.
  probeAudio = 'aac'; outputBytes = 6000; execs.length = 0;
  const kept = await api.compressMp4({ jobId: 'mp4_4', inputPath: clipToken, fileName: 'clip.mp4', strength: 10 });
  equal([kept.ok, kept.keptOriginal, kept.outPath, kept.bytesOut], [true, true, clipToken, 5000], 'a result no smaller than the source keeps the source');

  const missing = await api.compressMp4({ jobId: 'mp4_5', inputPath: 'web-file://9/gone.mp4', fileName: 'gone.mp4', strength: 10 });
  equal(missing.ok, false, 'an unknown token is refused');
  ok(/找不到原始视频/.test(missing.error), 'with a readable reason: ' + missing.error);
}

// ------------------------------------------------------------ 视频格式转换
{
  for (const [format, scalePct, mime] of [['mp4', 100, 'video/mp4'], ['webm', 50, 'video/webm'], ['gif', 200, 'image/gif']]) {
    execs.length = 0; outputBytes = 1200;
    const result = await api.convertVideoFormat({ jobId: 'vfc_' + format, inputPath: movToken, fileName: 'clip.mov', format, scalePct });
    equal(result.ok, true, 'converts to ' + format + ': ' + result.error);
    equal([result.fileName, result.format, result.scalePct, result.bytesIn, result.bytesOut], ['clip.' + format, format, scalePct, 7000, 1200], format + ': the desktop result shape');
    if (format === 'webm') {
      // The Web writes VP8 + Opus (this core's VP9 traps); the scale filter is the desktop's,
      // the bitrate cap is 0.12 bits per pixel per frame at the output size: the probe said
      // 1280x720 at 30 fps, so 50% is 640x360 -> 829 kbps.
      const desktopScale = desktopConvert.videoConvertScaleFilter(scalePct);
      equal(execs[1], ['-i', execs[1][1], '-vf', desktopScale, '-c:v', 'libvpx', '-deadline', 'good', '-cpu-used', '2', '-crf', '10', '-b:v', '829k', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k', execs[1][execs[1].length - 1]], 'webm at 50%: VP8 + Opus with the desktop\'s scale filter and a size-based bitrate cap');
    } else {
      const expected = core(desktopConvert.videoConvertArgs({ inPath: execs[1][1], outPath: execs[1][execs[1].length - 1], format, scalePct }));
      equal(execs[1], expected, format + ' at ' + scalePct + '%: the desktop\'s arguments, less its log and progress flags');
    }
    const preview = await api.videoResourceMediaRegister({ filePath: result.outPath });
    equal(urls[urls.length - 1].blob.type, mime, format + ' previews as ' + mime);
    ok(preview.ok && preview.url, format + ' has a preview URL');
  }
  const odd = await api.convertVideoFormat({ jobId: 'vfc_x', inputPath: movToken, fileName: 'clip.mov', format: 'avi', scalePct: 5 });
  equal([odd.format, odd.scalePct], ['mp4', 10], 'an unknown format falls back to mp4 and the scale clamps to 10%, as on the desktop');
}

// ------------------------------------------------------------ saving and clearing
{
  const result = await api.convertVideoFormat({ jobId: 'vfc_save', inputPath: movToken, fileName: 'clip.mov', format: 'mp4', scalePct: 100 });
  const written = [];
  api.pickDirectory = async () => ({ ok: true, canceled: false, dir: 'web-directory://1/out' });
  api.writeBinaryFile = async (payload) => { written.push({ dir: payload.dir, fileName: payload.fileName, size: payload.data.size }); return { ok: true, result: { saved: true } }; };
  const saved = await api.saveVideoToolOutput({ items: [{ srcPath: result.outPath, fileName: result.fileName }] });
  equal([saved.ok, saved.canceled, saved.saved], [true, false, ['clip.mp4']], 'saving writes into the picked folder');
  equal(written, [{ dir: 'web-directory://1/out', fileName: 'clip.mp4', size: 1200 }], 'with the result bytes');
  api.pickDirectory = async () => ({ ok: true, canceled: true });
  const canceled = await api.saveVideoToolOutput({ items: [{ srcPath: result.outPath, fileName: result.fileName }] });
  equal(canceled.canceled, true, 'a cancelled folder pick is reported as such');
  const empty = await api.saveVideoToolOutput({ items: [] });
  equal(empty.ok, false, 'nothing to save is refused');
  const overwrite = await api.overwriteVideoToolOutput({ items: [{ srcPath: result.outPath, targetPath: movToken }] });
  equal(overwrite.ok, false, 'overwriting is refused in a browser');
  ok(/导出另存/.test(overwrite.error), 'and points at 导出另存');

  await api.clearVideoToolOutput({ tool: 'video-convert' });
  const gone = await api.videoResourceMediaRegister({ filePath: result.outPath });
  ok(!gone.url, 'clearing the tool drops its results');
}

// A PhotoshopToSpine export keeps its JSON at the root and PNGs in images/e/.
// The Web folder picker must return both levels, with browser File objects intact.
{
  const png = { name: 'arm_l.png', size: 4, type: 'image/png', arrayBuffer: async () => new Uint8Array(4).buffer };
  const json = { name: 'character.json', size: 2, type: 'application/json', arrayBuffer: async () => new Uint8Array(2).buffer };
  const folder = (name, entries) => ({ name, kind: 'directory', async *entries() { yield* entries; } });
  const rootFolder = folder('project', [
    ['character.json', { kind: 'file', getFile: async () => json }],
    ['images', folder('images', [['e', folder('e', [['arm_l.png', { kind: 'file', getFile: async () => png }]])]])]
  ]);
  sandbox.showDirectoryPicker = async () => rootFolder;
  const picked = await api.openPhotoshopProject();
  equal(picked.ok, true, 'the Web PS folder picker succeeds');
  equal(picked.result.files.map((f) => f.relativePath), ['character.json', 'images/e/arm_l.png'], 'it recurses to nested layer PNGs');
  ok(picked.result.files[1].file === png, 'it passes the browser File without base64 conversion');
  const panel = await readFile(new URL('../../renderer/spine-auto-mesh.panel.js', import.meta.url), 'utf8');
  ok(panel.includes('const selected = res?.result || res') && panel.includes('f.file && typeof f.file.arrayBuffer'), 'the import panel accepts the Web response and keeps Electron base64 support');
}

console.log(checks + ' passed, 0 failed: Web video tools, nested sequence export, alpha-aware decode and PS folder import');
