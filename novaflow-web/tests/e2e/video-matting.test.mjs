// AI 抠图: the parameter contract between the browser shim and the worker.
//
// This is the seam where a mistake is silent rather than loud. The panel
// cannot be edited, so the shim has to satisfy it exactly; the worker then
// trusts whatever the control plane let through. Every assertion below stands
// for a way the feature would come back subtly wrong instead of failing:
// truncated frame times, a clamped frame size, a dropped proof.
import assert from 'node:assert/strict';
import { validateTaskParameters } from '../../packages/shared/src/control-plane.mjs';
import { MATTING_TASK_TYPE, isKnownTaskType, isMetered, requirementsFor } from '../../packages/shared/src/protocol.mjs';
import { findModel } from '../../packages/shared/src/model-manifest.mjs';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { createContext, runInContext } from 'node:vm';
import { createDomSandbox } from '../../worker/src/comfy/dom-shim.mjs';

let checks = 0;
const check = (actual, expected, what) => { assert.deepEqual(actual, expected, what); checks += 1; };
const throws = (fn, what) => { assert.throws(fn, what); checks += 1; };

const times = new Float32Array([0, 0.0417, 0.0833, 0.125]);
const timesB64 = Buffer.from(times.buffer).toString('base64');

const base = {
  width: 1920,
  height: 1080,
  fps: 24,
  frame_count: 4,
  frame_times_f32: timesB64,
  source_name: 'clip.mp4',
  input_encoding: 'png-frames-v1',
  proofs: [{ decodedFrameIndex: 0, mediaTime: 0, thumb: 'AAAA' }],
  references: [{ name: 'source.mp4', kind: 'frames', bytes: 1024 }]
};

// --- the type is admitted to the queue, and costs nothing -------------------
check(isKnownTaskType(MATTING_TASK_TYPE), true, 'matting is a known task type');
check(isMetered(MATTING_TASK_TYPE), false, 'matting runs on the pool owner hardware, so it is free');
check(requirementsFor(MATTING_TASK_TYPE).modelId, 'birefnet-matting', 'matting requires the BiRefNet model');
check(findModel('birefnet-matting').runtime, 'local', 'BiRefNet is not served by ComfyUI');

// --- the frame size survives untouched --------------------------------------
//
// The generation branch clamps width/height into 256..2048 and would quietly
// rewrite a 3840-wide clip. A matte at a size the browser did not ask for is
// dropped by the panel's consumers, which then fall back to chroma-key with
// no error at all - so this has to be the user's real frame size.
const hd = validateTaskParameters(MATTING_TASK_TYPE, { ...base, width: 3840, height: 2160 });
check(hd.width, 3840, '4K width is not clamped to the generation range');
check(hd.height, 2160, '4K height is not clamped to the generation range');

const parsed = validateTaskParameters(MATTING_TASK_TYPE, base);
check(parsed.width, 1920, 'width passes through');
check(parsed.frame_count, 4, 'frame count passes through');
check(parsed.source_name, 'clip.mp4', 'source name passes through');

// --- frame times survive as one string, not an array ------------------------
//
// sanitizeWorkflowOptions truncates any array to 256 entries and the panel's
// own ceiling is 300 frames, so an array of per-frame times would be silently
// cut for any clip over ~8.5 seconds. Packed base64 is why that cannot happen.
check(parsed.frame_times_f32, timesB64, 'frame times survive intact');

// Node pools small Buffers, so `.buffer` is a shared arena - the view has to
// be taken at the Buffer's own offset and length or it reads the pool.
function unpackTimes(base64) {
  const buffer = Buffer.from(base64, 'base64');
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

check(
  Array.from(unpackTimes(parsed.frame_times_f32)).map((v) => Math.round(v * 1e4) / 1e4),
  [0, 0.0417, 0.0833, 0.125],
  'frame times decode back'
);

const long = new Float32Array(300).map((_, i) => i / 30);
const longParsed = validateTaskParameters(MATTING_TASK_TYPE, {
  ...base,
  frame_count: 300,
  frame_times_f32: Buffer.from(long.buffer).toString('base64')
});
check(unpackTimes(longParsed.frame_times_f32).length, 300, 'a full 300-frame job is not truncated');

// --- a job that cannot be run is refused at the door -------------------------
// Zero and over-limit both have to be refusals rather than clamps: a count
// silently rounded to 1 or down to 300 no longer matches the frame times, and
// the worker would return a different number of mattes than the panel waits
// for - which the panel reports as a chroma-key fallback, not as an error.
throws(() => validateTaskParameters(MATTING_TASK_TYPE, { ...base, frame_count: 0 }), /frame_count/);
throws(() => validateTaskParameters(MATTING_TASK_TYPE, { ...base, frame_count: 301 }), /300 frames/);
throws(() => validateTaskParameters(MATTING_TASK_TYPE, { ...base, frame_count: 'x' }), /frame_count/);
throws(() => validateTaskParameters(MATTING_TASK_TYPE, { ...base, references: [] }), /source video/);
throws(() => validateTaskParameters(MATTING_TASK_TYPE, { ...base, frame_times_f32: '' }), /frame_times_f32/);

// --- generation types are untouched by the new branch ------------------------
const video = validateTaskParameters('h3_i2v', {
  prompt: 'x', width: 1280, height: 720, duration_seconds: 5, fps: 24,
  references: [{ name: 'a.png', kind: 'image', bytes: 10 }]
});
check(video.width, 1280, 'h3_i2v still goes through the generation branch');
check(video.duration_seconds, 5, 'h3_i2v keeps its duration');

throws(() => validateTaskParameters(MATTING_TASK_TYPE, { ...base, width: 0 }), /dimensions/);
throws(() => validateTaskParameters(MATTING_TASK_TYPE, { ...base, width: 8193 }), /dimensions/);
throws(() => validateTaskParameters(MATTING_TASK_TYPE, { ...base, frame_times_f32: 'AAAA' }), /frame_times_f32/);
throws(() => validateTaskParameters(MATTING_TASK_TYPE, { ...base, frame_times_f32: Buffer.from(new Float32Array([0, NaN, 1, 2]).buffer).toString('base64') }), /timestamp/);
check(parsed.return_mask_only, true, 'preview job does not encode unused WebM');

// Execute the browser adapter, including its actual decompression and events.
const source = await readFile(new URL('../../renderer/novaflow-web-capabilities.js', import.meta.url), 'utf8');
const plane = Uint8Array.from({ length: 256 }, (_, i) => i);
function block(index) {
  const bytes = deflateSync(plane), header = Buffer.alloc(8);
  header.writeUInt32LE(index); header.writeUInt32LE(bytes.length, 4);
  return Buffer.concat([header, bytes]);
}
let packed = Buffer.concat([block(0), block(1)]), submitted, fetchedSource, cancelled = 0, rejectMissingToken = false;
const sandbox = createDomSandbox({
  console, atob, btoa, Blob, Response, DecompressionStream,
  fetch: async url => { fetchedSource = url; return new Response(new Uint8Array([1, 2, 3])); },
  electronAPI: {},
  NovaFlowWebRuntime: {
    control: async (method, path, body) => {
      if (path.endsWith('/cancel')) { cancelled++; return {}; }
      if (rejectMissingToken) throw Object.assign(new Error('missing session token'), { status: 401 });
      if (method === 'POST') { submitted = body; return { task: { id: 'test-matting' } }; }
      return { task: { id: 'test-matting', status: 'completed', output_manifest: { files: [{ name: 'mask-test.bin' }] } } };
    },
    putTaskInput: async (id, name, blob) => { const bytes = new Uint8Array(await blob.arrayBuffer()); check(Array.from(bytes), [0,0,0,0,3,0,0,0,1,2,3,1,0,0,0,3,0,0,0,4,5,6], 'exact captured frames uploaded in order'); },
    fetchTaskOutput: async () => packed
  }
});
sandbox.document.querySelectorAll = () => { throw Error('must not select arbitrary video'); };
runInContext(source, createContext(sandbox));
const payload = { kind: 'video', jobId: 'job', rendererFrameWidth: 16, rendererFrameHeight: 16, fps: 24, totalFrames: 2,
  video: { fileName: 'same-name.mp4', sourceUrl: 'blob:exact-source' },
  rendererDecodedFrames: [{ decodedFrameIndex: 0, timeSec: .02, mediaTime: 0, bytes: new Uint8Array([1,2,3]) }, { decodedFrameIndex: 1, timeSec: .06, mediaTime: 1 / 24, bytes: new Uint8Array([4,5,6]) }] };
const chunks = [], events = [];
sandbox.electronAPI.onAiSeqRembgMaskChunk(chunk => chunks.push(chunk));
sandbox.electronAPI.onAiSeqRembgBatchProgress(event => events.push(event));
const result = await sandbox.electronAPI.aiSeqRembgBatch(payload);
check(result.ok, true, 'browser accepts complete mask payload');
check(fetchedSource, undefined, 'never refetches a potentially different source video');
check(submitted.parameters.input_encoding, 'png-frames-v1', 'frame pack encoding declared');
check(Array.from(unpackTimes(submitted.parameters.frame_times_f32)), [0, Math.fround(1 / 24)], 'uses verified mediaTime including zero');
check(result.alphaBytes.byteLength, 512, 'full native-sized alpha returned');
check(Array.from(result.alphaBytes), [...plane, ...plane], 'returned alpha bytes match worker output');
check(chunks.length, 2, 'preview receives both frames');
check(chunks.every(chunk => chunk.alphaBytes.buffer === result.alphaBytes.buffer), true, 'preview and final mask share identical bytes');
check(events.at(-1).state, 'done', 'completion reported after decode');
for (const invalid of [Buffer.concat([block(0), block(0)]), Buffer.concat([block(0), block(2)]), packed.subarray(0, packed.length - 1), Buffer.concat([packed, Buffer.from([1])])]) {
  packed = invalid;
  check((await sandbox.electronAPI.aiSeqRembgBatch(payload)).ok, false, 'reject corrupt or misindexed masks');
}
check(cancelled, 4, 'failed transfers release their task');
check((await sandbox.electronAPI.aiSeqRembgBatch({ ...payload, rendererDecodedFrames: [{ decodedFrameIndex: 0 }] })).ok, false, 'missing captured bytes fail before submission');
rejectMissingToken = true;
const signedOut = await sandbox.electronAPI.aiSeqRembgBatch(payload);
check(signedOut.ok, false, 'unauthorized matting is rejected');
check(signedOut.error.includes('重新登录'), true, 'session error offers a login action');

const html = await readFile(new URL('../../renderer/index.html', import.meta.url), 'utf8');
const asset = html.match(/src="\.\/(assets\/index-[^"?]+\.js)/)[1];
const bundle = await readFile(new URL('../../renderer/' + asset, import.meta.url), 'utf8');
check(bundle.includes('rendererDecodedFrames:D'), true, 'active editor provides verified captured frames');
console.log('video-matting: ' + checks + ' passed, 0 failed');
