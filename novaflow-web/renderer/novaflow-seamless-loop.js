// Seamless <video loop>: Chromium's native loop seeks to 0 only once playback
// reaches the end, after the decoder hit end-of-stream, and that seek costs
// 1.5-3 display refreshes (83-117 ms at 16 fps measured on a cutout WebM and
// an MP4) - the small pause the user sees on the 画板 and in 资源列表, which
// Spine's frame-sequence playback never has.
//
// Seeking while the decoder is still mid-stream costs ~17 ms. So on the
// second-to-last presented frame, seek to 0 after (frame duration - seek
// latency): frame 0 then lands on the normal cadence (50-67 ms measured; the
// gap can only sit on the refresh grid). The last frame is skipped at the
// wrap, which for a loop is the frame that matches frame 0 anyway. The latency
// estimate adapts from the measured wrap gap. Native loop stays set as the
// fallback, so nothing changes when the callback never runs (hidden tab).
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc || typeof root.HTMLVideoElement !== 'function' || typeof root.HTMLVideoElement.prototype.requestVideoFrameCallback !== 'function') return;

  const DEFAULT_SEEK_MS = 17;
  const STATE = new WeakMap();

  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  // Pure scheduler, exported for tests: decides from one presented frame
  // whether to arm the early seek and with what delay.
  function createSeamlessLoop(video, hooks) {
    const timers = hooks || {};
    const setTimer = timers.setTimeout || root.setTimeout.bind(root);
    const clearTimer = timers.clearTimeout || root.clearTimeout.bind(root);
    const state = { deltas: [], last: -1, lastPresented: 0, armed: 0, seekMs: DEFAULT_SEEK_MS, wrapIssuedAt: 0, wraps: 0 };

    function frameDuration() {
      const rate = Number(video.playbackRate) || 1;
      const fd = state.deltas.length >= 3 ? median(state.deltas.slice(-8)) : (1 / 30);
      return fd / rate;
    }

    // Called with every presented frame (requestVideoFrameCallback metadata).
    function onFrame(now, mediaTime) {
      const duration = Number(video.duration);
      if (state.last >= 0 && mediaTime > state.last) state.deltas.push(mediaTime - state.last);
      if (state.deltas.length > 32) state.deltas.splice(0, state.deltas.length - 32);
      const wrapped = state.last >= 0 && mediaTime < state.last;
      if (wrapped && state.wrapIssuedAt) {
        // Measured gap between the pre-wrap frame and frame 0: steer the seek
        // latency estimate so the next wrap lands closer to the cadence.
        const gap = now - state.lastPresented, target = frameDuration() * 1000;
        state.seekMs = Math.max(0, Math.min(200, state.seekMs + (gap - target) * 0.5));
        state.wrapIssuedAt = 0; state.wraps += 1;
      }
      state.last = mediaTime; state.lastPresented = now;
      if (!video.loop || video.paused || video.ended || !(duration > 0)) return null;
      // Only act once the frame duration has actually been measured.
      if (state.deltas.length < 3) return null;
      const fd = frameDuration();
      if (!(fd > 0) || duration < fd * 3) return null;
      if (state.armed || mediaTime < duration - 1.5 * fd - 0.001) return null;
      const delay = Math.max(0, Math.round(fd * 1000 - state.seekMs));
      state.armed = setTimer(() => {
        state.armed = 0;
        if (!video.loop || video.paused || video.ended) return;
        state.wrapIssuedAt = now + delay;
        try { video.currentTime = 0; } catch (_) {}
      }, delay);
      return delay;
    }

    function dispose() { if (state.armed) clearTimer(state.armed); state.armed = 0; }
    return { onFrame, dispose, state };
  }

  function attach(video) {
    if (STATE.has(video)) return;
    const loop = createSeamlessLoop(video);
    let running = false;
    const tick = (now, meta) => {
      if (!running) return;
      loop.onFrame(now, Number(meta && meta.mediaTime) || 0);
      video.requestVideoFrameCallback(tick);
    };
    const start = () => { if (running) return; running = true; video.requestVideoFrameCallback(tick); };
    const stop = () => { running = false; loop.dispose(); };
    video.addEventListener('playing', start);
    video.addEventListener('pause', stop);
    video.addEventListener('emptied', stop);
    if (!video.paused) start();
    STATE.set(video, { loop, start, stop });
  }

  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'VIDEO') attach(node);
    if (typeof node.querySelectorAll === 'function') node.querySelectorAll('video').forEach(attach);
  }

  const observer = new root.MutationObserver(records => {
    for (const record of records) record.addedNodes.forEach(scan);
  });
  const boot = () => { scan(doc.documentElement); observer.observe(doc.documentElement, { childList: true, subtree: true }); };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();

  root.NovaFlowSeamlessLoop = { createSeamlessLoop, attach };
})(typeof window !== 'undefined' ? window : globalThis);
