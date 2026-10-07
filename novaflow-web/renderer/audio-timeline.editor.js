// 音频 timeline editor: tracks, clips, basic editing, Web Audio playback and
// an offline mixdown. Pure browser code, no server contact.
//
//   const editor = NovaFlowAudioTimeline.create({ host, onChange })
//   editor.addClip({ buffer, name, kind, start })
//   editor.play() / pause() / seek(t) / exportMix()
//
// Clip = { id, trackId, name, kind, buffer, start, offset, end, loops, rate, fadeIn, fadeOut, gain }
//   start      where it sits on the timeline (s)
//   offset/end the part of the buffer it plays (buffer seconds)
//   loops      how many times that part repeats
//   rate       playback speed; dragging the end past the natural length slows
//              the clip down (stretch), the inspector's speed slider does both
//   length     derived: (end - offset) * loops / rate, timeline seconds
//   fadeIn/Out timeline seconds, anywhere from 0 to the whole clip
(function (root) {
  'use strict';
  if (root.NovaFlowAudioTimeline) return;

  const HEADER_W = 132;      // track header column
  const RULER_H = 24;
  const LANE_H = 72;
  const LANE_GAP = 4;
  const MIN_ZOOM = 6;        // px per second
  const MAX_ZOOM = 400;
  const COLORS = {
    bg: '#1d1d1d', lane: '#202020', laneAlt: '#1f1f1f', grid: '#2a2a2a', beat: '#262626',
    ruler: '#161616', rulerText: '#8d8d8d', tick: '#3a3a3a', playhead: '#ef4444',
    music: ['#1e7a58', '#2fcf92', '#133f2e'], sfx: ['#2d5aa6', '#6aa6ff', '#1d3660'], import: ['#6b5a1e', '#e0b84a', '#3f3612'],
    selected: '#ffffff', fade: '#d9d9d9', text: '#f1f1f1'
  };

  let nextId = 1;
  const uid = (p) => p + '-' + (nextId++) + '-' + Math.random().toString(36).slice(2, 6);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---- waveform peaks -----------------------------------------------------------
  const peakCache = new WeakMap();
  function peaksOf(buffer, bins = 4000) {
    let cached = peakCache.get(buffer);
    if (cached) return cached;
    const n = buffer.length, ch = buffer.numberOfChannels;
    const out = new Float32Array(bins);
    const step = Math.max(1, Math.floor(n / bins));
    const data = [];
    for (let c = 0; c < ch; c += 1) data.push(buffer.getChannelData(c));
    for (let b = 0; b < bins; b += 1) {
      const s = b * step, e = Math.min(n, s + step);
      let peak = 0;
      for (let i = s; i < e; i += 2) {
        for (let c = 0; c < ch; c += 1) { const v = Math.abs(data[c][i]); if (v > peak) peak = v; }
      }
      out[b] = peak;
    }
    cached = { bins: out, duration: buffer.duration };
    peakCache.set(buffer, cached);
    return cached;
  }

  // ---- WAV encode -------------------------------------------------------------
  function encodeWav(buffer) {
    const ch = buffer.numberOfChannels, n = buffer.length, sr = buffer.sampleRate;
    const bytes = 44 + n * ch * 2;
    const ab = new ArrayBuffer(bytes);
    const v = new DataView(ab);
    const str = (o, s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * ch * 2, true);
    const chans = []; for (let c = 0; c < ch; c += 1) chans.push(buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < n; i += 1) {
      for (let c = 0; c < ch; c += 1) { const s = clamp(chans[c][i], -1, 1); v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true); o += 2; }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  function create(options) {
    const host = options.host;
    const onChange = options.onChange || (() => {});
    const onSelect = options.onSelect || (() => {});
    const onTime = options.onTime || (() => {});
    const onTransport = options.onTransport || (() => {});
    const state = {
      tracks: [], playhead: 0, zoom: 40, scrollX: 0, scrollY: 0, snap: true, bpm: 0, loop: false,
      selected: null, playing: false
    };
    let ctx = null;
    const audioContext = () => {
      if (!ctx) ctx = options.context ? options.context() : new (root.AudioContext || root.webkitAudioContext)();
      return ctx;
    };

    // ---- DOM ------------------------------------------------------------------
    // The editor lives in a wrapper of its own, so the host keeps whatever
    // placement its page gave it.
    for (const old of host.querySelectorAll(':scope > .nf-tl')) old.remove();
    const wrap = document.createElement('div'); wrap.className = 'nf-tl';
    const headers = document.createElement('div'); headers.className = 'nf-tl-headers';
    const headersTop = document.createElement('div'); headersTop.className = 'nf-tl-headers-top'; headersTop.textContent = '音轨';
    const addTrackButton = document.createElement('button'); addTrackButton.type = 'button'; addTrackButton.className = 'nf-tl-add-track'; addTrackButton.textContent = '+音轨'; addTrackButton.title = '新增音轨';
    addTrackButton.addEventListener('click', () => addTrack());
    headersTop.appendChild(addTrackButton);
    headers.appendChild(headersTop);
    const headerList = document.createElement('div'); headerList.className = 'nf-tl-header-list'; headers.appendChild(headerList);
    const scroller = document.createElement('div'); scroller.className = 'nf-tl-scroller';
    const canvas = document.createElement('canvas'); canvas.className = 'nf-tl-canvas';
    scroller.appendChild(canvas);
    const playheadEl = document.createElement('div'); playheadEl.className = 'nf-tl-playhead'; scroller.appendChild(playheadEl);
    wrap.appendChild(headers); wrap.appendChild(scroller);
    host.appendChild(wrap);

    function trackOf(id) { return state.tracks.find((t) => t.id === id) || null; }
    function clipOf(id) { for (const t of state.tracks) { const c = t.clips.find((x) => x.id === id); if (c) return c; } return null; }
    function clipTrack(clip) { return trackOf(clip.trackId); }
    function projectEnd() {
      let end = 0;
      for (const t of state.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.length);
      return end;
    }
    function beat() { return state.bpm > 0 ? 60 / state.bpm : 0; }
    function snapTime(t) {
      if (!state.snap) return Math.max(0, t);
      const unit = beat() || 0.25;
      return Math.max(0, Math.round(t / unit) * unit);
    }

    // ---- tracks ----------------------------------------------------------------
    function addTrack(name, kind) {
      const track = { id: uid('track'), name: name || ('音轨 ' + (state.tracks.length + 1)), kind: kind || 'music', mute: false, solo: false, gain: 1, clips: [] };
      state.tracks.push(track);
      renderHeaders(); layout(); changed();
      return track;
    }
    function removeTrack(id) {
      const index = state.tracks.findIndex((t) => t.id === id);
      if (index < 0) return;
      if (state.selected && state.tracks[index].clips.some((c) => c.id === state.selected)) select(null);
      state.tracks.splice(index, 1);
      renderHeaders(); layout(); changed();
    }
    function renderHeaders() {
      headerList.replaceChildren();
      for (const track of state.tracks) {
        const row = document.createElement('div'); row.className = 'nf-tl-header'; row.style.height = LANE_H + 'px';
        row.dataset.trackId = track.id;
        const name = document.createElement('input'); name.className = 'nf-tl-track-name'; name.value = track.name; name.title = '音轨名称';
        name.addEventListener('change', () => { track.name = name.value.trim() || track.name; name.value = track.name; changed(); });
        const btns = document.createElement('div'); btns.className = 'nf-tl-track-btns';
        const mute = document.createElement('button'); mute.type = 'button'; mute.textContent = 'M'; mute.title = '静音';
        mute.setAttribute('aria-pressed', String(track.mute));
        mute.addEventListener('click', () => { track.mute = !track.mute; mute.setAttribute('aria-pressed', String(track.mute)); restartIfPlaying(); changed(); });
        const solo = document.createElement('button'); solo.type = 'button'; solo.textContent = 'S'; solo.title = '独奏';
        solo.setAttribute('aria-pressed', String(track.solo));
        solo.addEventListener('click', () => { track.solo = !track.solo; solo.setAttribute('aria-pressed', String(track.solo)); restartIfPlaying(); changed(); });
        const del = document.createElement('button'); del.type = 'button'; del.textContent = '×'; del.title = '删除音轨'; del.className = 'nf-tl-track-del';
        del.addEventListener('click', () => removeTrack(track.id));
        btns.appendChild(mute); btns.appendChild(solo); btns.appendChild(del);
        const gain = document.createElement('input'); gain.type = 'range'; gain.min = '0'; gain.max = '1.5'; gain.step = '0.01'; gain.value = String(track.gain); gain.title = '音量';
        gain.className = 'nf-tl-track-gain';
        gain.addEventListener('input', () => { track.gain = Number(gain.value); liveGain(track); draw(); changed(); });
        row.appendChild(name); row.appendChild(btns); row.appendChild(gain);
        headerList.appendChild(row);
      }
    }

    // ---- clips -------------------------------------------------------------------
    function addClip(spec) {
      let track = spec.trackId ? trackOf(spec.trackId) : null;
      if (!track) track = state.tracks.find((t) => t.kind === (spec.kind || 'music')) || state.tracks[0] || addTrack(spec.kind === 'sfx' ? '音效' : '音乐', spec.kind || 'music');
      const buffer = spec.buffer;
      const clip = {
        id: uid('clip'), trackId: track.id, name: spec.name || '片段', kind: spec.kind || 'import', buffer,
        start: Math.max(0, Number(spec.start) || 0), offset: 0, end: buffer.duration, loops: 1, rate: 1, length: buffer.duration,
        fadeIn: Number(spec.fadeIn) || 0, fadeOut: Number(spec.fadeOut) || 0, gain: 1, loopable: spec.loopable !== false
      };
      syncLength(clip);
      // Put it after the last clip on that track when the asked position is taken.
      if (spec.start === undefined) {
        let end = 0; for (const c of track.clips) end = Math.max(end, c.start + c.length);
        clip.start = track.clips.length ? snapTime(end) : 0;
      }
      track.clips.push(clip);
      select(clip.id);
      layout(); changed();
      return clip;
    }
    const MIN_RATE = 0.5, MAX_RATE = 2;
    function segmentOf(clip) { return Math.max(0.05, clip.end - clip.offset); }
    function syncLength(clip) {
      clip.loops = Math.max(1, Math.round(clip.loops || 1));
      clip.rate = clamp(Number(clip.rate) || 1, MIN_RATE, MAX_RATE);
      clip.length = segmentOf(clip) * clip.loops / clip.rate;
      clampFades(clip);
      return clip.length;
    }
    function clampFades(clip) {
      clip.fadeIn = clamp(Number(clip.fadeIn) || 0, 0, clip.length);
      clip.fadeOut = clamp(Number(clip.fadeOut) || 0, 0, Math.max(0, clip.length - clip.fadeIn));
    }
    function removeClip(id) {
      for (const t of state.tracks) {
        const i = t.clips.findIndex((c) => c.id === id);
        if (i >= 0) { t.clips.splice(i, 1); if (state.selected === id) select(null); layout(); changed(); restartIfPlaying(); return true; }
      }
      return false;
    }
    function select(id) {
      state.selected = id;
      onSelect(id ? clipOf(id) : null);
      draw();
    }
    function selectedClip() { return state.selected ? clipOf(state.selected) : null; }
    function splitAtPlayhead() {
      const t = state.playhead;
      const clip = selectedClip() || state.tracks.flatMap((tr) => tr.clips).find((c) => t > c.start && t < c.start + c.length);
      if (!clip || t <= clip.start + 0.02 || t >= clip.start + clip.length - 0.02) return null;
      if (clip.loops > 1) return null;
      const cut = t - clip.start;
      const bufferCut = clip.offset + cut * clip.rate;
      const right = { ...clip, id: uid('clip'), start: t, offset: bufferCut, fadeIn: 0 };
      clip.end = bufferCut; clip.fadeOut = 0;
      syncLength(clip); syncLength(right);
      clipTrack(clip).clips.push(right);
      select(right.id); layout(); changed(); restartIfPlaying();
      return right;
    }
    function duplicateSelected() {
      const clip = selectedClip(); if (!clip) return null;
      const copy = { ...clip, id: uid('clip'), start: snapTime(clip.start + clip.length) };
      clipTrack(clip).clips.push(copy);
      select(copy.id); layout(); changed();
      return copy;
    }
    function setFade(clipId, fadeIn, fadeOut) {
      const clip = clipOf(clipId); if (!clip) return;
      if (fadeIn !== undefined) clip.fadeIn = clamp(Number(fadeIn) || 0, 0, clip.length);
      if (fadeOut !== undefined) clip.fadeOut = clamp(Number(fadeOut) || 0, 0, clip.length);
      // Both fades share the clip: the one being set wins the overlap.
      if (fadeIn !== undefined) clip.fadeOut = Math.min(clip.fadeOut, Math.max(0, clip.length - clip.fadeIn));
      else clip.fadeIn = Math.min(clip.fadeIn, Math.max(0, clip.length - clip.fadeOut));
      draw(); changed(); restartIfPlaying();
    }
    function setGain(clipId, gain) {
      const clip = clipOf(clipId); if (!clip) return;
      clip.gain = clamp(Number(gain) || 0, 0, 2);
      draw(); changed(); restartIfPlaying();
    }
    function setLoops(clipId, times) {
      const clip = clipOf(clipId); if (!clip) return;
      clip.loops = Math.max(1, Math.min(50, Math.round(Number(times) || 1)));
      syncLength(clip);
      layout(); changed(); restartIfPlaying();
    }
    function setRate(clipId, rate) {
      const clip = clipOf(clipId); if (!clip) return;
      clip.rate = clamp(Number(rate) || 1, MIN_RATE, MAX_RATE);
      syncLength(clip);
      layout(); changed(); restartIfPlaying();
    }
    const extendLoop = setLoops;

    // ---- geometry ----------------------------------------------------------------
    function timeToX(t) { return Math.round(t * state.zoom); }
    function xToTime(x) { return x / state.zoom; }
    function laneTop(index) { return RULER_H + index * (LANE_H + LANE_GAP); }
    function contentWidth() { return Math.max(scroller.clientWidth, timeToX(projectEnd() + 30)); }
    function contentHeight() { return Math.max(scroller.clientHeight, RULER_H + state.tracks.length * (LANE_H + LANE_GAP) + 20); }

    let drawQueued = false;
    function layout() {
      const dpr = root.devicePixelRatio || 1;
      const w = contentWidth(), h = contentHeight();
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      playheadEl.style.height = h + 'px';
      draw();
    }
    function draw() {
      if (drawQueued) return;
      drawQueued = true;
      requestAnimationFrame(() => { drawQueued = false; paint(); });
    }
    function paint() {
      const g = canvas.getContext('2d');
      const dpr = root.devicePixelRatio || 1;
      const w = canvas.width / dpr, h = canvas.height / dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = COLORS.bg; g.fillRect(0, 0, w, h);
      // lanes
      state.tracks.forEach((track, i) => {
        g.fillStyle = i % 2 ? COLORS.laneAlt : COLORS.lane;
        g.fillRect(0, laneTop(i), w, LANE_H);
      });
      // grid
      const unit = gridUnit();
      g.strokeStyle = COLORS.grid; g.lineWidth = 1;
      for (let t = 0; t * state.zoom < w; t += unit) {
        const x = timeToX(t) + 0.5;
        g.beginPath(); g.moveTo(x, RULER_H); g.lineTo(x, h); g.stroke();
      }
      if (beat() && beat() * state.zoom > 7) {
        g.strokeStyle = COLORS.beat;
        for (let t = 0; t * state.zoom < w; t += beat()) {
          if (Math.abs(t / unit - Math.round(t / unit)) < 1e-6) continue;
          const x = timeToX(t) + 0.5;
          g.beginPath(); g.moveTo(x, RULER_H); g.lineTo(x, h); g.stroke();
        }
      }
      // clips
      state.tracks.forEach((track, i) => {
        for (const clip of track.clips) paintClip(g, clip, laneTop(i));
      });
      // ruler
      g.fillStyle = COLORS.ruler; g.fillRect(0, 0, w, RULER_H);
      g.fillStyle = COLORS.rulerText; g.font = '10px system-ui, sans-serif'; g.textBaseline = 'top';
      g.strokeStyle = COLORS.tick;
      const labelEvery = unit * (unit * state.zoom < 46 ? Math.ceil(46 / (unit * state.zoom)) : 1);
      for (let t = 0; t * state.zoom < w; t += unit) {
        const x = timeToX(t) + 0.5;
        const major = Math.abs(t / labelEvery - Math.round(t / labelEvery)) < 1e-6;
        g.beginPath(); g.moveTo(x, major ? RULER_H - 10 : RULER_H - 5); g.lineTo(x, RULER_H); g.stroke();
        if (major) g.fillText(formatTime(t), x + 3, 4);
      }
      g.strokeStyle = COLORS.grid; g.beginPath(); g.moveTo(0, RULER_H - 0.5); g.lineTo(w, RULER_H - 0.5); g.stroke();
      positionPlayhead();
    }
    function gridUnit() {
      const b = beat();
      if (b && b * 4 * state.zoom >= 24) return b * 4;   // a bar
      const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
      for (const c of candidates) if (c * state.zoom >= 40) return c;
      return 60;
    }
    function paintClip(g, clip, top) {
      const track = state.tracks.find((t) => t.id === clip.trackId) || { gain: 1 };
      const x = timeToX(clip.start), wpx = Math.max(2, timeToX(clip.start + clip.length) - x);
      const pal = COLORS[clip.kind] || COLORS.import;
      const selected = clip.id === state.selected;
      g.fillStyle = pal[2]; g.fillRect(x, top + 2, wpx, LANE_H - 4);
      // waveform, repeated when the clip is longer than its buffer
      const peaks = peaksOf(clip.buffer);
      // the waveform follows the track's volume (and the clip's own gain), so a quieter track looks quieter
      const mid = top + 2 + (LANE_H - 4) / 2, amp = ((LANE_H - 4) / 2 - 3) * Math.min(1.5, Math.max(0, track.gain)) * Math.min(1.5, clip.gain);
      g.fillStyle = pal[1];
      const bufDur = clip.buffer.duration, segment = segmentOf(clip), loopSpan = segment / clip.rate;
      for (let px = 0; px < wpx; px += 1) {
        const bufT = clip.offset + ((xToTime(px) * clip.rate) % segment);
        const bin = Math.min(peaks.bins.length - 1, Math.max(0, Math.floor(bufT / bufDur * peaks.bins.length)));
        const v = peaks.bins[bin] * amp;
        g.fillRect(x + px, mid - v, 1, Math.max(1, v * 2));
      }
      // loop seams
      if (clip.loops > 1) {
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.setLineDash([3, 3]);
        for (let i = 1; i < clip.loops; i += 1) {
          const sx = x + timeToX(i * loopSpan) + 0.5;
          g.beginPath(); g.moveTo(sx, top + 2); g.lineTo(sx, top + LANE_H - 2); g.stroke();
        }
        g.setLineDash([]);
      }
      // fades
      if (clip.fadeIn > 0 || clip.fadeOut > 0) {
        g.strokeStyle = COLORS.fade; g.lineWidth = 1;
        g.beginPath();
        if (clip.fadeIn > 0) { g.moveTo(x, top + LANE_H - 2); g.lineTo(x + timeToX(clip.fadeIn), top + 2); }
        if (clip.fadeOut > 0) { g.moveTo(x + wpx - timeToX(clip.fadeOut), top + 2); g.lineTo(x + wpx, top + LANE_H - 2); }
        g.stroke();
      }
      // handles
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillRect(x + timeToX(clip.fadeIn) - 3, top + 3, 6, 6);
      g.fillRect(x + wpx - timeToX(clip.fadeOut) - 3, top + 3, 6, 6);
      // outline + name
      g.strokeStyle = selected ? COLORS.selected : pal[0]; g.lineWidth = selected ? 1.5 : 1;
      g.strokeRect(x + 0.5, top + 2.5, wpx - 1, LANE_H - 5);
      g.fillStyle = COLORS.text; g.font = '11px system-ui, sans-serif'; g.textBaseline = 'bottom';
      g.save(); g.beginPath(); g.rect(x, top, wpx, LANE_H); g.clip();
      g.fillText(clip.name + '  ' + formatTime(clip.length) + (Math.abs(clip.rate - 1) > 0.005 ? '  ×' + clip.rate.toFixed(2) : ''), x + 6, top + LANE_H - 5);
      g.restore();
    }
    function positionPlayhead() {
      playheadEl.style.left = (timeToX(state.playhead) - 1) + 'px';
    }
    function formatTime(t) {
      const s = Math.max(0, t);
      const m = Math.floor(s / 60), sec = s - m * 60;
      return (m ? m + ':' : '') + (m ? String(Math.floor(sec)).padStart(2, '0') : Math.floor(sec)) + '.' + Math.floor((sec % 1) * 10);
    }

    // ---- mouse ----------------------------------------------------------------------
    let drag = null;
    function hit(px, py) {
      if (py < RULER_H) return { kind: 'ruler' };
      for (let i = 0; i < state.tracks.length; i += 1) {
        const top = laneTop(i);
        if (py < top || py > top + LANE_H) continue;
        const track = state.tracks[i];
        for (const clip of [...track.clips].reverse()) {
          const x = timeToX(clip.start), wpx = Math.max(2, timeToX(clip.start + clip.length) - x);
          if (px < x - 4 || px > x + wpx + 4) continue;
          if (py < top + 12) {
            if (Math.abs(px - (x + timeToX(clip.fadeIn))) <= 6) return { kind: 'fadeIn', clip, track: i };
            if (Math.abs(px - (x + wpx - timeToX(clip.fadeOut))) <= 6) return { kind: 'fadeOut', clip, track: i };
          }
          if (px <= x + 6) return { kind: 'trimStart', clip, track: i };
          if (px >= x + wpx - 6) return { kind: 'trimEnd', clip, track: i };
          return { kind: 'move', clip, track: i };
        }
        return { kind: 'lane', track: i };
      }
      return { kind: 'empty' };
    }
    function cursorFor(h) {
      return { ruler: 'col-resize', fadeIn: 'ew-resize', fadeOut: 'ew-resize', trimStart: 'ew-resize', trimEnd: 'ew-resize', move: 'grab' }[h.kind] || 'default';
    }
    function pointer(event) {
      const r = canvas.getBoundingClientRect();
      return { x: event.clientX - r.left, y: event.clientY - r.top };
    }
    canvas.addEventListener('pointermove', (event) => {
      if (drag) return;
      canvas.style.cursor = cursorFor(hit(pointer(event).x, pointer(event).y));
    });
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const p = pointer(event);
      const h = hit(p.x, p.y);
      try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* synthetic pointer */ }
      if (h.kind === 'ruler' || h.kind === 'lane' || h.kind === 'empty') {
        if (h.kind !== 'ruler') select(null);
        seek(snapTime(xToTime(p.x)));
        drag = { kind: 'scrub' };
        return;
      }
      select(h.clip.id);
      drag = { kind: h.kind, clip: h.clip, track: h.track, startX: p.x, startY: p.y,
        origin: { start: h.clip.start, offset: h.clip.offset, end: h.clip.end, loops: h.clip.loops, rate: h.clip.rate, length: h.clip.length, fadeIn: h.clip.fadeIn, fadeOut: h.clip.fadeOut, trackId: h.clip.trackId } };
      canvas.style.cursor = h.kind === 'move' ? 'grabbing' : cursorFor(h);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const p = pointer(event);
      if (drag.kind === 'scrub') { seek(snapTime(xToTime(Math.max(0, p.x)))); return; }
      const clip = drag.clip, o = drag.origin, dt = xToTime(p.x - drag.startX);
      const bufDur = clip.buffer.duration;
      if (drag.kind === 'move') {
        clip.start = snapTime(o.start + dt);
        // Drop onto another lane.
        const laneIndex = state.tracks.findIndex((t, i) => p.y >= laneTop(i) && p.y <= laneTop(i) + LANE_H);
        if (laneIndex >= 0 && state.tracks[laneIndex].id !== clip.trackId) {
          const from = clipTrack(clip); from.clips.splice(from.clips.indexOf(clip), 1);
          clip.trackId = state.tracks[laneIndex].id; state.tracks[laneIndex].clips.push(clip);
        }
      } else if (drag.kind === 'trimStart') {
        // The left edge trims the buffer window; the earliest start is the buffer's own beginning.
        const earliest = o.start - o.offset / o.rate;
        const newStart = clamp(snapTime(o.start + dt), Math.max(0, earliest), o.start + o.length - 0.1);
        const delta = (newStart - o.start) * o.rate;
        clip.start = newStart; clip.offset = clamp(o.offset + delta, 0, o.end - 0.05);
        syncLength(clip);
      } else if (drag.kind === 'trimEnd') {
        // Inside the natural length the right edge trims; past it the clip is
        // stretched (slowed down) instead of repeated.
        const target = Math.max(0.1, snapTime(o.start + o.length + dt) - o.start);
        const natural = (o.end - o.offset) * o.loops; // at normal speed
        if (target >= natural) {
          clip.end = o.end; clip.rate = clamp(natural / target, MIN_RATE, MAX_RATE);
        } else {
          clip.rate = 1; clip.end = clamp(o.offset + target / o.loops, o.offset + 0.05, bufDur);
        }
        syncLength(clip);
      } else if (drag.kind === 'fadeIn') {
        clip.fadeIn = clamp(o.fadeIn + dt, 0, clip.length); clampFades(clip);
      } else if (drag.kind === 'fadeOut') {
        clip.fadeOut = clamp(o.fadeOut - dt, 0, clip.length); clip.fadeIn = Math.min(clip.fadeIn, Math.max(0, clip.length - clip.fadeOut));
      }
      layout();
    });
    const endDrag = (event) => {
      if (!drag) return;
      const was = drag; drag = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch (_) { /* already released */ }
      canvas.style.cursor = 'default';
      if (was.kind !== 'scrub') { changed(); restartIfPlaying(); }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', (event) => {
      if (event.ctrlKey) {
        event.preventDefault();
        const p = pointer(event);
        const tAt = xToTime(p.x);
        setZoom(state.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
        scroller.scrollLeft = Math.max(0, timeToX(tAt) - (event.clientX - scroller.getBoundingClientRect().left));
      } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        // horizontal scroll by the browser
      }
    }, { passive: false });
    scroller.addEventListener('scroll', () => { headerList.style.transform = 'translateY(' + (-scroller.scrollTop) + 'px)'; });

    // drop a resource onto a lane
    scroller.addEventListener('dragover', (event) => { if (dropPayload(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
    scroller.addEventListener('drop', async (event) => {
      const payload = dropPayload(event);
      if (!payload || !options.resolveDrop) return;
      event.preventDefault();
      const p = pointer(event);
      const laneIndex = state.tracks.findIndex((t, i) => p.y >= laneTop(i) && p.y <= laneTop(i) + LANE_H);
      // the page may need to read / decode the resource first
      const resolved = await options.resolveDrop(payload, event);
      if (!resolved) return;
      addClip({ ...resolved, trackId: laneIndex >= 0 ? state.tracks[laneIndex].id : undefined, start: snapTime(xToTime(Math.max(0, p.x))) });
    });
    function dropPayload(event) {
      const types = Array.from(event.dataTransfer?.types || []);
      if (types.includes('application/x-novaflow-audio')) return event.dataTransfer.getData('application/x-novaflow-audio') || 'pending';
      // the shared resource list's own drag (video / audio cards)
      if (typeof options.dropPayload === 'function') return options.dropPayload(event) || null;
      return null;
    }

    // ---- playback --------------------------------------------------------------------
    let playback = null; // { startedAt (ctx time), from (timeline time), nodes: [], gains: Map(trackId -> GainNode), timer }
    function audibleTracks() {
      const anySolo = state.tracks.some((t) => t.solo);
      return state.tracks.filter((t) => !t.mute && (!anySolo || t.solo));
    }
    function scheduleInto(target, from, when, trackGains) {
      const nodes = [];
      for (const track of audibleTracks()) {
        const tg = trackGains.get(track.id);
        for (const clip of track.clips) {
          const clipEnd = clip.start + clip.length;
          if (clipEnd <= from) continue;
          // Each repetition is one source; the gain envelope spans the whole clip.
          const env = target.createGain();
          env.connect(tg);
          const g = clip.gain;
          const t0 = when + Math.max(0, clip.start - from);
          const t1 = when + (clipEnd - from);
          env.gain.setValueAtTime(clip.fadeIn > 0 && clip.start >= from ? 0.0001 : g, t0);
          if (clip.fadeIn > 0 && clip.start >= from) env.gain.linearRampToValueAtTime(g, t0 + clip.fadeIn);
          if (clip.fadeOut > 0) { env.gain.setValueAtTime(g, Math.max(t0, t1 - clip.fadeOut)); env.gain.linearRampToValueAtTime(0.0001, t1); }
          const segment = segmentOf(clip), span = segment / clip.rate; // buffer seconds, timeline seconds
          for (let i = 0; i < clip.loops; i += 1) {
            const segStart = clip.start + i * span, segEnd = segStart + span;
            if (segEnd <= from) continue;
            const src = target.createBufferSource();
            src.buffer = clip.buffer;
            src.playbackRate.value = clip.rate;
            src.connect(env);
            const skip = Math.max(0, from - segStart) * clip.rate; // buffer seconds already passed
            src.start(when + Math.max(0, segStart - from), clip.offset + skip, Math.max(0.01, segment - skip));
            nodes.push(src);
          }
          nodes.push(env);
        }
      }
      return nodes;
    }
    function play() {
      if (state.playing) return;
      const c = audioContext();
      if (c.state === 'suspended') c.resume();
      const end = projectEnd();
      if (end <= 0) return;
      if (state.playhead >= end - 0.01) state.playhead = 0;
      const trackGains = new Map();
      for (const track of state.tracks) { const gn = c.createGain(); gn.gain.value = track.gain; gn.connect(c.destination); trackGains.set(track.id, gn); }
      const when = c.currentTime + 0.05;
      const nodes = scheduleInto(c, state.playhead, when, trackGains);
      playback = { startedAt: when, from: state.playhead, nodes, gains: trackGains, end };
      state.playing = true;
      onTransport(true);
      const tick = () => {
        if (!playback) return;
        const t = playback.from + (c.currentTime - playback.startedAt);
        if (t >= playback.end) {
          if (state.loop) { stopNodes(); state.playhead = 0; state.playing = false; play(); return; }
          stopNodes(); state.playhead = playback.end; playback = null; state.playing = false; onTransport(false); positionPlayhead(); onTime(state.playhead); return;
        }
        state.playhead = Math.max(0, t);
        positionPlayhead(); onTime(state.playhead); keepPlayheadVisible();
        playback.timer = requestAnimationFrame(tick);
      };
      playback.timer = requestAnimationFrame(tick);
    }
    function stopNodes() {
      if (!playback) return;
      cancelAnimationFrame(playback.timer);
      for (const n of playback.nodes) { try { if (n.stop) n.stop(); n.disconnect(); } catch (_) { /* ended */ } }
      for (const gn of playback.gains.values()) { try { gn.disconnect(); } catch (_) { /* fine */ } }
    }
    function pause() {
      if (!state.playing) return;
      const c = audioContext();
      const t = playback ? playback.from + (c.currentTime - playback.startedAt) : state.playhead;
      stopNodes(); playback = null; state.playing = false;
      state.playhead = clamp(t, 0, projectEnd());
      positionPlayhead(); onTime(state.playhead); onTransport(false);
    }
    function stop() { pause(); seek(0); }
    function toggle() { if (state.playing) pause(); else play(); }
    function seek(t) {
      const wasPlaying = state.playing;
      if (wasPlaying) pause();
      state.playhead = clamp(t, 0, Math.max(0, projectEnd()));
      positionPlayhead(); onTime(state.playhead);
      if (wasPlaying) play();
    }
    function restartIfPlaying() { if (state.playing) { const t = state.playhead; pause(); state.playhead = t; play(); } }
    function liveGain(track) { if (playback) { const gn = playback.gains.get(track.id); if (gn) gn.gain.value = track.gain; } }
    function keepPlayheadVisible() {
      const x = timeToX(state.playhead);
      const left = scroller.scrollLeft, w = scroller.clientWidth;
      if (x > left + w - 40) scroller.scrollLeft = x - 40;
      else if (x < left) scroller.scrollLeft = Math.max(0, x - 40);
    }

    // ---- export ----------------------------------------------------------------------
    async function exportMix() {
      const end = projectEnd();
      if (end <= 0) throw new Error('时间轴上还没有片段');
      const sr = 44100;
      const off = new OfflineAudioContext(2, Math.ceil(end * sr), sr);
      const trackGains = new Map();
      for (const track of state.tracks) { const gn = off.createGain(); gn.gain.value = track.gain; gn.connect(off.destination); trackGains.set(track.id, gn); }
      scheduleInto(off, 0, 0, trackGains);
      const rendered = await off.startRendering();
      return encodeWav(rendered);
    }

    // ---- view --------------------------------------------------------------------------
    function setZoom(z) { state.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM); layout(); onChange('zoom'); }
    function fitToWindow() {
      const end = Math.max(1, projectEnd());
      setZoom((scroller.clientWidth - 24) / end);
      scroller.scrollLeft = 0;
    }
    function changed() { onChange('model'); }

    // ---- public ----------------------------------------------------------------------
    const api = {
      state, host, canvas, scroller,
      addTrack, removeTrack, addClip, removeClip, select, selectedClip, splitAtPlayhead, duplicateSelected, setFade, setGain, setLoops, setRate, extendLoop, syncLength,
      deleteSelected() { return state.selected ? removeClip(state.selected) : false; },
      play, pause, stop, toggle, seek, isPlaying: () => state.playing,
      setLoop(v) { state.loop = Boolean(v); onChange('loop'); },
      setSnap(v) { state.snap = Boolean(v); onChange('snap'); },
      setBpm(v) { state.bpm = clamp(Math.floor(Number(v) || 0), 0, 300); draw(); onChange('bpm'); },
      setZoom, fitToWindow, zoom: () => state.zoom,
      projectEnd, playhead: () => state.playhead, formatTime,
      layout, draw, exportMix, encodeWav,
      clipCount: () => state.tracks.reduce((n, t) => n + t.clips.length, 0),
      destroy() { pause(); wrap.remove(); }
    };
    if (!state.tracks.length) { addTrack('音乐', 'music'); addTrack('音效', 'sfx'); select(null); }
    return api;
  }

  root.NovaFlowAudioTimeline = { create, encodeWav, LANE_H, RULER_H, HEADER_W };
})(typeof window !== 'undefined' ? window : globalThis);
