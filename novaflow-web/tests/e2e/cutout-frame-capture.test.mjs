// 视频抠图 frame capture and save (2026-10-14). Capture seeked to each frame's start and accepted
// a frame within 50 ms, so a seek that showed the previous frame passed: DivinePower.mp4 (24 fps)
// saved 39 of 117 frames as repeats. Capture now seeks to mid-frame and verifies the frame start
// within 0.45 frame (falling back to the old seek only if that cannot be verified). Saving renders
// several frames at once and reports per-frame progress (it sat on 正在保存抠图结果… for minutes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundle = () => readFileSync(join(ROOT, 'renderer/assets/index-BbIa-2NM.js'), 'utf8');

test('capture seeks mid-frame and verifies the frame start within half a frame', async () => {
  const source = bundle();
  const { patchCutoutMidFrameCapture } = await import('../../../scripts/patch-cutout-mid-frame-capture.mjs');
  assert.equal(patchCutoutMidFrameCapture(source), source, 'patch applied and idempotent');
  assert.equal(source.split('nfArmVerifiedVideoFrame(e,n?.verifyTimeSec??s,n?.verifyToleranceSec??c,l,').length - 1, 2, 'both frame waits verify against the frame start');
  assert.ok(source.includes('const nfHit=await Lt(h,Math.min(r+nfStep/2,Math.max(r,x-.001)),{...nfOptions,verifyTimeSec:r,verifyToleranceSec:.45*nfStep});'), 'mid-frame seek, 0.45-frame check');
  assert.ok(source.includes('return Lt(h,r,nfOptions)})('), 'old seek only as the fallback');
});

test('save renders frames ahead in parallel and always reports progress', async () => {
  const source = bundle();
  const { patchCutoutParallelSave } = await import('../../../scripts/patch-cutout-parallel-save.mjs');
  assert.equal(patchCutoutParallelSave(source), source, 'patch applied and idempotent');
  assert.ok(source.includes('nfSaveWidth=g&&R===`ai`&&nfGreenScreen&&fe.current?.frames?.size?'), 'parallel only on captured decoded frames');
  assert.ok(source.includes('for(let nfNext=t;nfNext<t+nfSaveWidth;nfNext++)nfSaveRender(nfNext);let r=await nfSaveAhead.get(t);'), 'frames are written in order');
  assert.ok(!source.includes('if(ce===`save-and-close`)window.dispatchEvent(new CustomEvent(`novaflow:cutout-save-progress`'), 'frame progress no longer gated on the mis-read source');
  assert.ok(source.includes('window.dispatchEvent(new CustomEvent(`novaflow:cutout-save-progress`,{detail:{stage:`frames`,current:t,total:A.length}}))'));
});
