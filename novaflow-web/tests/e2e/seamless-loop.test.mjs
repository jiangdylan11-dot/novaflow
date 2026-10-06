// Seamless <video loop>: the overlay arms an early seek on the second-to-last
// frame so the wrap lands on the frame cadence instead of Chromium's native
// end-of-stream seek. The scheduler is pure; drive it with presented frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(ROOT, 'renderer/novaflow-seamless-loop.js'), 'utf8');

function load() {
  class HTMLVideoElement { requestVideoFrameCallback() {} }
  const root = { document: null, HTMLVideoElement, setTimeout: () => 1, clearTimeout() {}, MutationObserver: class { observe() {} } };
  // No document: the module must still export its scheduler for tests.
  root.document = { readyState: 'complete', documentElement: { nodeType: 1, tagName: 'HTML', querySelectorAll: () => [] }, addEventListener() {} };
  const context = createContext({ window: root, globalThis: root, Number, Math, WeakMap, Map, Array, String, Boolean, Promise });
  runInContext(source, context);
  return root.NovaFlowSeamlessLoop;
}

test('a wrap hook that takes the wrap replaces the seek; otherwise the seek goes ahead', () => {
  const api = load();
  const video = { loop: true, paused: false, ended: false, duration: DURATION, playbackRate: 1, currentTime: 2 };
  const timers = [];
  let taken = true, calls = 0;
  const loop = api.createSeamlessLoop(video, { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, wrap: () => { calls += 1; return taken; } });
  playFrames(loop, 39);
  timers[0].fn();
  assert.equal(calls, 1, 'the hook ran at the wrap');
  assert.equal(video.currentTime, 2, 'no seek while the hook took the wrap');
  assert.equal(loop.state.wrapIssuedAt, 0, 'a taken wrap is not measured as a seek');
  taken = false;
  playFrames(loop, 39, 39 * FD * 1000);
  timers[1].fn();
  assert.equal(video.currentTime, 0, 'the seek runs when the hook declines');
});

test('originalSrc maps nothing until a copy exists and passes other urls through', () => {
  const api = load();
  assert.equal(api.originalSrc('blob:x/1'), 'blob:x/1');
  assert.equal(api.originalSrc(''), '');
});

function drive(api, video, hooks) {
  const timers = [];
  const loop = api.createSeamlessLoop(video, { setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {} });
  return { loop, timers };
}

const FD = 1 / 16, DURATION = 39 * FD;
function playFrames(loop, count, startNow = 0) {
  let delay = null;
  for (let n = 0; n < count; n++) {
    const got = loop.onFrame(startNow + n * FD * 1000, n * FD);
    if (got != null) delay = got;
  }
  return delay;
}

test('a looping video gets an early seek armed on its last frame, one frame minus the seek latency later', () => {
  const api = load();
  const video = { loop: true, paused: false, ended: false, duration: DURATION, playbackRate: 1, currentTime: 2 };
  const { loop, timers } = drive(api, video);
  const delay = playFrames(loop, 39); // frames 0..38; the last frame triggers the early seek
  assert.equal(timers.length, 1, 'one seek timer armed');
  assert.ok(Math.abs(delay - (FD * 1000 - 17)) <= 1, 'delay = frame duration - 17 ms, got ' + delay);
  timers[0].fn();
  assert.equal(video.currentTime, 0, 'the timer seeks to 0');
});

test('a clip played faster still triggers on its last frame, with the delay on the wall clock', () => {
  const api = load();
  const video = { loop: true, paused: false, ended: false, duration: DURATION, playbackRate: 1.875, currentTime: 2 };
  const { loop, timers } = drive(api, video);
  // Presented every 33 ms on the wall clock while mediaTime steps by a full source frame.
  let delay = null;
  for (let n = 0; n < 39; n++) { const got = loop.onFrame(n * FD * 1000 / 1.875, n * FD); if (got != null) delay = got; }
  assert.equal(timers.length, 1, 'one seek timer armed');
  assert.ok(Math.abs(delay - (FD * 1000 / 1.875 - 17)) <= 1, 'delay = wall-clock frame duration - 17 ms, got ' + delay);
});

test('no seek without loop, while paused, or on a clip shorter than three frames', () => {
  const api = load();
  for (const video of [
    { loop: false, paused: false, ended: false, duration: DURATION, playbackRate: 1 },
    { loop: true, paused: true, ended: false, duration: DURATION, playbackRate: 1 },
    { loop: true, paused: false, ended: false, duration: FD * 2, playbackRate: 1 },
  ]) {
    const { loop, timers } = drive(api, video);
    playFrames(loop, 38);
    assert.equal(timers.length, 0);
  }
});

test('the seek latency estimate follows the measured wrap gap', () => {
  const api = load();
  const video = { loop: true, paused: false, ended: false, duration: DURATION, playbackRate: 1, currentTime: 0 };
  const { loop, timers } = drive(api, video);
  playFrames(loop, 39);
  timers[0].fn(); // seek issued
  const before = loop.state.seekMs;
  // Frame 0 presents 100 ms after the last frame instead of 62.5: the estimate must grow so the next delay shrinks.
  loop.onFrame(38 * FD * 1000 + 100, 0);
  assert.ok(loop.state.seekMs > before, 'latency estimate increased after a late wrap');
  assert.equal(loop.state.wraps, 1);
});

test('index.html loads the overlay', () => {
  const html = readFileSync(join(ROOT, 'renderer/index.html'), 'utf8');
  assert.match(html, /novaflow-seamless-loop\.js\?v=/);
});
