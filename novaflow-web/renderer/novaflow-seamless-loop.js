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
//
// Clips with an audio track (the generated ones carry background music) still
// paused after that: frame 0 lands on time, but the media clock then waits
// for the audio pipeline to restart, and frame 1 comes a whole frame late on
// every wrap (~100 ms at a 50 ms cadence, native or early seek alike). So the
// 画板 video switches, at a wrap, to a video-only copy of the same clip
// (remuxed in the background by exportVideoOnlyCopy: the same packets, nothing
// decoded or encoded), and the music plays from a hidden <audio> on the
// original file, put back to 0 at each wrap. The copy exists only while the
// clip loops: a pause longer than a moment restores the original source at
// the same time, so every tool that reads the stage video (视频抠图, 帧编辑,
// the timeline) sees the resource the page put there.
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc || typeof root.HTMLVideoElement !== 'function' || typeof root.HTMLVideoElement.prototype.requestVideoFrameCallback !== 'function') return;

  const DEFAULT_SEEK_MS = 17;
  const STATE = new WeakMap();
  const MEDIA = new WeakMap();
  // Copy URL -> the source it was made from, for tools that name the stage clip.
  const COPY_SOURCES = new Map();
  const PROBE_DELAY_MS = 500;
  const RESTORE_AFTER_PAUSE_MS = 300;
  const SWAP_TIMEOUT_MS = 4000;

  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  // Pure scheduler, exported for tests: decides from one presented frame
  // whether to arm the early seek and with what delay. `hooks.wrap` may take
  // the wrap over (return true) instead of the seek.
  function createSeamlessLoop(video, hooks) {
    const timers = hooks || {};
    const setTimer = timers.setTimeout || root.setTimeout.bind(root);
    const clearTimer = timers.clearTimeout || root.clearTimeout.bind(root);
    const state = { deltas: [], last: -1, lastPresented: 0, armed: 0, seekMs: DEFAULT_SEEK_MS, wrapIssuedAt: 0, wraps: 0 };

    // Frame duration in media time (what mediaTime advances per frame) and
    // on the wall clock (shorter when the 画板 plays the clip faster).
    function mediaFrameDuration() {
      return state.deltas.length >= 3 ? median(state.deltas.slice(-8)) : (1 / 30);
    }
    function frameDuration() {
      return mediaFrameDuration() / (Number(video.playbackRate) || 1);
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
      const mediaFd = mediaFrameDuration(), fd = frameDuration();
      if (!(mediaFd > 0) || duration < mediaFd * 3) return null;
      // The last frame is the one whose mediaTime sits within 1.5 media frames of the end.
      if (state.armed || mediaTime < duration - 1.5 * mediaFd - 0.001) return null;
      const delay = Math.max(0, Math.round(fd * 1000 - state.seekMs));
      state.armed = setTimer(() => {
        state.armed = 0;
        if (!video.loop || video.paused || video.ended) return;
        if (typeof timers.wrap === 'function' && timers.wrap() === true) { state.wrapIssuedAt = 0; return; }
        state.wrapIssuedAt = now + delay;
        try { video.currentTime = 0; } catch (_) {}
      }, delay);
      return delay;
    }

    function dispose() { if (state.armed) clearTimer(state.armed); state.armed = 0; }
    return { onFrame, dispose, state };
  }

  // ---- 画板 clips with an audio track ----------------------------------------
  function currentSource(video) { return String(video.currentSrc || video.src || ''); }
  function isStageVideo(video) {
    if (!video.isConnected || !video.closest('[data-novaflow-ai-preview-viewport="1"]')) return false;
    return !video.closest('[data-novaflow-ai-resource-card="1"], [data-novaflow-ai-resource-sidebar-host="1"], [data-novaflow-ai-bottom-workspace="1"]');
  }
  // Chromium counts the audio bytes it decoded; a clip without a track stays at 0.
  function hasAudioTrack(video) { return Number(video.webkitAudioDecodedByteCount) > 0; }
  function bridge() { return root.electronAPI || null; }

  function mediaFor(video) {
    let media = MEDIA.get(video);
    if (!media) {
      media = { original: '', copy: '', audio: null, requesting: false, swapping: false, swapped: false, probeTimer: 0, restoreTimer: 0, swapTimer: 0 };
      MEDIA.set(video, media);
    }
    return media;
  }

  function coverWithSnapshot(video, container) {
    try {
      if (!(video.videoWidth > 0 && video.videoHeight > 0)) return;
      const canvas = doc.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      video.setAttribute('poster', container === 'webm' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92));
    } catch (_) { /* a tainted canvas: no cover, the frame just blinks once */ }
  }

  function syncAudio(video, media) {
    const audio = media.audio;
    if (!audio) return;
    try {
      audio.playbackRate = Number(video.playbackRate) || 1;
      audio.muted = Boolean(video.muted);
      audio.volume = Number.isFinite(video.volume) ? video.volume : 1;
    } catch (_) {}
  }
  function audioFollow(video, media) {
    const audio = media.audio;
    if (!audio || !media.swapped) return;
    try { audio.currentTime = Number(video.currentTime) || 0; } catch (_) {}
    if (!video.paused) { const p = audio.play(); if (p && p.catch) p.catch(() => {}); }
  }
  function audioStop(media) {
    if (media.audio) { try { media.audio.pause(); } catch (_) {} }
  }

  function requestCopy(video) {
    const media = mediaFor(video);
    const api = bridge();
    if (!api || typeof api.exportVideoOnlyCopy !== 'function' || media.requesting || media.copy) return;
    const original = currentSource(video);
    if (!original) return;
    media.requesting = true;
    media.original = original;
    api.exportVideoOnlyCopy({ sourceUrl: original }).then((result) => {
      media.requesting = false;
      if (!result || !result.ok || !result.url) return;
      if (currentSource(video) !== original || !video.isConnected) {
        // The page moved on while the copy was made.
        api.exportRevokeVideoOnlyCopy && api.exportRevokeVideoOnlyCopy({ sourceUrl: original });
        return;
      }
      media.copy = result.url;
      media.container = result.container || 'mp4';
      COPY_SOURCES.set(result.url, original);
      const audio = doc.createElement('audio');
      audio.setAttribute('data-novaflow-runtime-ignore', '1');
      audio.setAttribute('data-novaflow-loop-audio', '1');
      audio.style.display = 'none';
      audio.preload = 'auto';
      audio.loop = true;
      audio.src = original;
      media.audio = audio;
      syncAudio(video, media);
      (doc.body || doc.documentElement).appendChild(audio);
    }).catch(() => { media.requesting = false; });
  }

  // Switch the element's source in place: a snapshot of the current frame stands
  // as the poster while the new source loads, then playback resumes where asked.
  function swapTo(video, media, src, time, play) {
    if (media.swapping) return false;
    media.swapping = true;
    coverWithSnapshot(video, media.container);
    const finish = () => {
      video.removeEventListener('loadeddata', onLoaded);
      if (media.swapTimer) { root.clearTimeout(media.swapTimer); media.swapTimer = 0; }
      media.swapping = false;
      media.swapped = src === media.copy && Boolean(media.copy);
      if (media.swapped) audioFollow(video, media); else audioStop(media);
    };
    const onLoaded = () => {
      try { if (time > 0) video.currentTime = time; } catch (_) {}
      if (play) {
        const p = video.play();
        Promise.resolve(p).catch(() => {}).then(finish);
      } else {
        finish();
      }
    };
    video.addEventListener('loadeddata', onLoaded);
    media.swapTimer = root.setTimeout(finish, SWAP_TIMEOUT_MS);
    try { video.src = src; } catch (_) { finish(); return false; }
    return true;
  }

  function cleanupMedia(video, media) {
    if (media.probeTimer) { root.clearTimeout(media.probeTimer); media.probeTimer = 0; }
    if (media.restoreTimer) { root.clearTimeout(media.restoreTimer); media.restoreTimer = 0; }
    audioStop(media);
    if (media.audio) { try { media.audio.remove(); } catch (_) {} media.audio = null; }
    if (media.copy) {
      COPY_SOURCES.delete(media.copy);
      const api = bridge();
      if (api && typeof api.exportRevokeVideoOnlyCopy === 'function' && currentSource(video) !== media.copy) api.exportRevokeVideoOnlyCopy({ sourceUrl: media.original });
    }
    media.copy = ''; media.original = ''; media.swapped = false; media.requesting = false;
  }

  // The wrap, taken from the scheduler: the first time the copy is ready it
  // replaces the source (frame 0 of the copy instead of a seek); afterwards the
  // seek is clean and only the music goes back to 0 with it.
  function takeWrap(video) {
    const media = MEDIA.get(video);
    if (!media) return false;
    if (media.copy && !media.swapped && !media.swapping && currentSource(video) === media.original) {
      return swapTo(video, media, media.copy, 0, true);
    }
    if (media.swapped && media.audio) {
      try { media.audio.currentTime = 0; } catch (_) {}
      if (media.audio.paused && !video.paused) { const p = media.audio.play(); if (p && p.catch) p.catch(() => {}); }
    }
    return false;
  }

  function attach(video) {
    if (STATE.has(video)) return;
    const loop = createSeamlessLoop(video, { wrap: () => takeWrap(video) });
    let running = false;
    const tick = (now, meta) => {
      if (!running) return;
      if (!video.isConnected) { stop(); const media = MEDIA.get(video); if (media) cleanupMedia(video, media); return; }
      loop.onFrame(now, Number(meta && meta.mediaTime) || 0);
      video.requestVideoFrameCallback(tick);
    };
    const start = () => { if (running) return; running = true; video.requestVideoFrameCallback(tick); };
    const stop = () => { running = false; loop.dispose(); };
    const onPlaying = () => {
      start();
      const media = mediaFor(video);
      if (media.restoreTimer) { root.clearTimeout(media.restoreTimer); media.restoreTimer = 0; }
      if (media.swapped) audioFollow(video, media);
      // The snapshot poster has done its job once the new source paints.
      if (video.hasAttribute('poster')) root.setTimeout(() => { if (!media.swapping) video.removeAttribute('poster'); }, 1000);
      if (media.probeTimer) root.clearTimeout(media.probeTimer);
      media.probeTimer = root.setTimeout(() => {
        media.probeTimer = 0;
        if (!video.loop || video.paused || video.ended || media.copy || media.requesting) return;
        if (!isStageVideo(video) || !hasAudioTrack(video)) return;
        requestCopy(video);
      }, PROBE_DELAY_MS);
    };
    const onPause = () => {
      stop();
      const media = MEDIA.get(video);
      if (!media) return;
      audioStop(media);
      if (!media.swapped || media.swapping) return;
      if (media.restoreTimer) root.clearTimeout(media.restoreTimer);
      media.restoreTimer = root.setTimeout(() => {
        media.restoreTimer = 0;
        if (!video.paused || video.ended || media.swapping || currentSource(video) !== media.copy) return;
        swapTo(video, media, media.original, Number(video.currentTime) || 0, false);
      }, RESTORE_AFTER_PAUSE_MS);
    };
    const onEmptied = () => {
      stop();
      const media = MEDIA.get(video);
      if (!media || media.swapping) return;
      const src = currentSource(video);
      if (src !== media.original && src !== media.copy) cleanupMedia(video, media);
    };
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('emptied', onEmptied);
    video.addEventListener('ratechange', () => { const media = MEDIA.get(video); if (media) syncAudio(video, media); });
    video.addEventListener('volumechange', () => { const media = MEDIA.get(video); if (media) syncAudio(video, media); });
    video.addEventListener('seeked', () => { const media = MEDIA.get(video); if (media && media.swapped && !media.swapping) audioFollow(video, media); });
    if (!video.paused) onPlaying();
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

  // Tools that name or decode the stage clip get the source the page put there.
  function originalSrc(url) { return COPY_SOURCES.get(String(url || '')) || String(url || ''); }

  root.NovaFlowSeamlessLoop = { createSeamlessLoop, attach, originalSrc };
})(typeof window !== 'undefined' ? window : globalThis);
