// 视频 timeline editor (lab): tracks, clips, trim / move / split, a playhead
// clock. Pure browser code. The compositor preview and the export read the
// same model.
//
//   const editor = NovaFlowVideoTimeline.create({ host, onChange, onTime, onFrame })
//   editor.addClip({ source, name, start, trackId })
//   editor.play() / pause() / seek(t)
//
// Track = { id, name, kind, visible, mute, clips }  kind 'video' | 'audio'; tracks[0] is the TOP layer
// Clip  = { id, trackId, name, source, start, offset, end, length, transform, visible }
//   source     { kind, url, durationSec, width, height, hasAudio, peaks, blob, fileName }
//              kind 'video' | 'audio' | 'image'; an image sits on a video track, 3 s by default,
//              its right edge drags out without limit (only the next clip on the track stops it)
//   start      where it sits on the timeline (s)
//   offset/end the part of the source it shows (source seconds)
//   length     derived: end - offset
//   transform  { centerX, centerY, scale } in project canvas pixels
//   fadeIn/Out timeline seconds: picture alpha + sound for video clips, sound for audio clips
//   audioDetached  a video clip whose sound was split off onto an audio track (the clip stays silent)
//   mask       a NovaFlowAiSequenceVideoMergeMaskTool surface in source pixels (erase / restore), or null;
//              maskRevision bumps on every stroke; split / duplicate clone it via options.cloneMask
(function (root) {
  'use strict';
  if (root.NovaFlowVideoTimeline) return;

  const HEADER_W = 132;
  const RULER_H = 24;
  const LANE_H = 64;
  const LANE_GAP = 4;
  const MIN_ZOOM = 6;
  const MAX_ZOOM = 400;
  const MIN_LEN = 0.1;
  // a clip's speed range when its edges are dragged (as 音频编辑's stretch)
  const MIN_RATE = 0.25, MAX_RATE = 4;
  const IMAGE_DEFAULT_LEN = 3;
  const IMAGE_MAX_LEN = Infinity;   // an image clip stretches as long as the track has room
  const COLORS = {
    bg: '#1d1d1d', lane: '#202020', laneAlt: '#1f1f1f', grid: '#2a2a2a',
    ruler: '#161616', rulerText: '#8d8d8d', tick: '#3a3a3a', playhead: '#ef4444',
    clip: ['#1e7a58', '#2fcf92', '#133f2e'], clipMuted: ['#4a4a4a', '#777', '#2a2a2a'], audio: ['#6b5a1e', '#e0b84a', '#3f3612'], laneAudio: '#1f1f1f',
    selected: '#ffffff', text: '#f1f1f1', snapLine: 'rgba(255,255,255,0.55)', fade: '#d9d9d9'
  };

  let nextId = 1;
  const uid = (p) => p + '-' + (nextId++) + '-' + Math.random().toString(36).slice(2, 6);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---- filmstrip thumbnails --------------------------------------------------------
  // One strip per source url: 12 frames spread over the duration, each
  // (LANE_H-4) tall. Built lazily off a hidden <video>; the editor repaints
  // when a strip lands.
  const strips = new Map();
  function stripOf(source, onReady) {
    const key = source.url;
    let strip = strips.get(key);
    if (strip) return strip;
    if (source.kind === 'image') {
      strip = { frames: [], aspect: source.width / Math.max(1, source.height), ready: false, count: 1 };
      strips.set(key, strip);
      const img = new Image();
      img.onload = () => {
        const h = LANE_H - 4, w = Math.max(8, Math.round(h * strip.aspect));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        strip.frames.push({ t: 0, canvas: c }); strip.ready = true; onReady();
      };
      img.onerror = () => { strip.ready = true; onReady(); };
      img.src = source.url;
      return strip;
    }
    const count = 12;
    strip = { frames: [], aspect: source.width / Math.max(1, source.height), ready: false, count };
    strips.set(key, strip);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
    video.src = source.url;
    const h = LANE_H - 4, w = Math.max(8, Math.round(h * strip.aspect));
    let index = 0;
    const grab = () => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      try { c.getContext('2d').drawImage(video, 0, 0, w, h); } catch (_) { /* not decodable yet */ }
      strip.frames.push({ t: video.currentTime, canvas: c });
      index += 1;
      if (index >= count) { strip.ready = true; video.removeAttribute('src'); video.load(); onReady(); return; }
      onReady();
      video.currentTime = Math.min(source.durationSec - 0.05, (index + 0.5) / count * source.durationSec);
    };
    video.addEventListener('seeked', grab);
    video.addEventListener('loadeddata', () => { video.currentTime = Math.min(source.durationSec - 0.05, 0.5 / count * source.durationSec); }, { once: true });
    video.addEventListener('error', () => { strip.ready = true; onReady(); }, { once: true });
    return strip;
  }

  function create(options) {
    const host = options.host;
    const onChange = options.onChange || (() => {});
    const onSelect = options.onSelect || (() => {});
    const onTime = options.onTime || (() => {});
    const onTransport = options.onTransport || (() => {});
    const state = {
      canvas: { width: 1280, height: 720, fps: 30 },
      tracks: [], playhead: 0, zoom: 40, snap: true, loop: false,
      selected: null, playing: false,
      // every picked clip (Ctrl+A, box select, Ctrl/Shift-click); `selected` is the one the inspector shows
      picked: new Set(), activeTrack: null
    };

    // ---- DOM ------------------------------------------------------------------
    for (const old of host.querySelectorAll(':scope > .nf-tl')) old.remove();
    const wrap = document.createElement('div'); wrap.className = 'nf-tl nf-vtl';
    const headers = document.createElement('div'); headers.className = 'nf-tl-headers';
    const headersTop = document.createElement('div'); headersTop.className = 'nf-tl-headers-top'; headersTop.textContent = '轨道';
    const addVideo = document.createElement('button'); addVideo.type = 'button'; addVideo.className = 'nf-tl-add-track'; addVideo.textContent = '+视频'; addVideo.title = '新增视频轨';
    addVideo.addEventListener('click', () => addTrack(null, 'video'));
    const addAudio = document.createElement('button'); addAudio.type = 'button'; addAudio.className = 'nf-tl-add-track'; addAudio.textContent = '+音频'; addAudio.title = '新增音频轨';
    addAudio.addEventListener('click', () => addTrack(null, 'audio'));
    headersTop.append(addVideo, addAudio);
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
    function allClips() { return state.tracks.flatMap((t) => t.clips); }
    function projectEnd() {
      let end = 0;
      for (const t of state.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.length);
      return end;
    }
    function gridUnit() {
      const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
      for (const c of candidates) if (c * state.zoom >= 40) return c;
      return 60;
    }
    // Snap: clip edges on every track and the playhead win over the grid.
    let snapHint = null;
    function snapTime(t, excludeClip) {
      t = Math.max(0, t);
      snapHint = null;
      if (!state.snap) return t;
      const tol = 8 / state.zoom;
      const targets = [0, state.playhead];
      for (const c of allClips()) { if (c === excludeClip) continue; targets.push(c.start, c.start + c.length); }
      let best = null;
      for (const target of targets) { const d = Math.abs(target - t); if (d <= tol && (best === null || d < Math.abs(best - t))) best = target; }
      if (best !== null) { snapHint = best; return best; }
      const unit = gridUnit() / 4;
      return Math.max(0, Math.round(t / unit) * unit);
    }

    // ---- tracks ----------------------------------------------------------------
    function addTrack(name, kind) {
      kind = kind === 'audio' ? 'audio' : 'video';
      const count = state.tracks.filter((t) => t.kind === kind).length + 1;
      const track = { id: uid('track'), name: name || ((kind === 'audio' ? '音频轨 ' : '视频轨 ') + count), kind, visible: true, mute: false, clips: [] };
      // audio tracks sit under the video tracks
      if (kind === 'video') { const firstAudio = state.tracks.findIndex((t) => t.kind === 'audio'); if (firstAudio >= 0) state.tracks.splice(firstAudio, 0, track); else state.tracks.push(track); }
      else state.tracks.push(track);
      renderHeaders(); layout(); changed();
      return track;
    }
    function removeTrack(id) {
      const index = state.tracks.findIndex((t) => t.id === id);
      if (index < 0) return;
      if (state.selected && state.tracks[index].clips.some((c) => c.id === state.selected)) select(null);
      state.tracks.splice(index, 1);
      renderHeaders(); layout(); changed(); restartIfPlaying();
    }
    function moveTrack(id, dir) {
      const index = state.tracks.findIndex((t) => t.id === id);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= state.tracks.length) return;
      if (state.tracks[target].kind !== state.tracks[index].kind) return;
      const [t] = state.tracks.splice(index, 1); state.tracks.splice(target, 0, t);
      renderHeaders(); layout(); changed();
    }
    function renderHeaders() {
      headerList.replaceChildren();
      state.tracks.forEach((track, i) => {
        const row = document.createElement('div'); row.className = 'nf-tl-header'; row.style.height = LANE_H + 'px';
        row.dataset.trackId = track.id;
        if (state.activeTrack === track.id) row.setAttribute('data-active', '1');
        // any press on the track's header (its name, its buttons) picks it for a stage drop
        row.addEventListener('pointerdown', () => { state.activeTrack = null; setActiveTrack(track.id); }, true);
        const name = document.createElement('input'); name.className = 'nf-tl-track-name'; name.value = track.name; name.title = '轨道名称';
        name.addEventListener('change', () => { track.name = name.value.trim() || track.name; name.value = track.name; changed(); });
        const btns = document.createElement('div'); btns.className = 'nf-tl-track-btns';
        row.dataset.kind = track.kind;
        const eye = document.createElement('button'); eye.type = 'button'; eye.textContent = '👁'; eye.title = '显示 / 隐藏';
        eye.setAttribute('aria-pressed', String(track.visible));
        eye.addEventListener('click', () => { track.visible = !track.visible; eye.setAttribute('aria-pressed', String(track.visible)); draw(); changed(); });
        if (track.kind === 'audio') eye.hidden = true;
        const mute = document.createElement('button'); mute.type = 'button'; mute.textContent = 'M'; mute.title = '静音';
        mute.setAttribute('aria-pressed', String(track.mute));
        mute.addEventListener('click', () => { track.mute = !track.mute; mute.setAttribute('aria-pressed', String(track.mute)); draw(); changed(); });
        const detach = document.createElement('button'); detach.type = 'button'; detach.className = 'nf-tl-track-detach'; detach.textContent = '♪'; detach.title = '分离音轨：把这条轨上视频的声音拆到音频轨';
        detach.addEventListener('click', () => { if (options.onDetachTrack) options.onDetachTrack(track); });
        const del = document.createElement('button'); del.type = 'button'; del.textContent = '×'; del.title = '删除轨道'; del.className = 'nf-tl-track-del';
        del.addEventListener('click', () => removeTrack(track.id));
        btns.append(eye, mute, detach, del);
        row.appendChild(name); row.appendChild(btns);
        // drag the row onto another row of the same kind to reorder
        row.draggable = true;
        row.addEventListener('dragstart', (e) => { if (e.target === name) { e.preventDefault(); return; } e.dataTransfer.setData('application/x-novaflow-track', track.id); e.dataTransfer.effectAllowed = 'move'; row.classList.add('nf-tl-header-dragging'); });
        row.addEventListener('dragend', () => { row.classList.remove('nf-tl-header-dragging'); for (const r of headerList.children) r.classList.remove('nf-tl-header-over'); });
        row.addEventListener('dragover', (e) => { const id = draggingTrackId(e); if (!id || id === track.id) return; const from = trackOf(id); if (!from || from.kind !== track.kind) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('nf-tl-header-over'); });
        row.addEventListener('dragleave', () => row.classList.remove('nf-tl-header-over'));
        row.addEventListener('drop', (e) => { const id = draggingTrackId(e); if (!id || id === track.id) return; e.preventDefault(); row.classList.remove('nf-tl-header-over'); reorderTrack(id, state.tracks.indexOf(track)); });
        headerList.appendChild(row);
      });
      syncHeaderIcons();
    }
    let draggingTrack = null;
    function draggingTrackId(e) { return draggingTrack || (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('application/x-novaflow-track') ? (e.dataTransfer.getData('application/x-novaflow-track') || draggingTrack) : null); }
    headerList.addEventListener('dragstart', (e) => { draggingTrack = e.dataTransfer.getData('application/x-novaflow-track') || (e.target.closest && e.target.closest('.nf-tl-header') ? e.target.closest('.nf-tl-header').dataset.trackId : null); });
    headerList.addEventListener('dragend', () => { draggingTrack = null; });
    function reorderTrack(id, targetIndex) {
      const index = state.tracks.findIndex((t) => t.id === id);
      if (index < 0 || targetIndex < 0 || targetIndex >= state.tracks.length || index === targetIndex) return;
      if (state.tracks[targetIndex].kind !== state.tracks[index].kind) return;
      const [t] = state.tracks.splice(index, 1); state.tracks.splice(targetIndex, 0, t);
      renderHeaders(); layout(); changed();
    }
    // the detach icon only shows on a video track that still carries sound
    function syncHeaderIcons() {
      for (const row of headerList.children) {
        const track = trackOf(row.dataset.trackId); if (!track) continue;
        const detach = row.querySelector('.nf-tl-track-detach'); if (!detach) continue;
        detach.hidden = !(track.kind === 'video' && track.clips.some((c) => c.source.hasAudio && !c.audioDetached && !c.isImage));
      }
    }

    // ---- clips -------------------------------------------------------------------
    function collides(track, clip, start, length) {
      const end = start + length;
      for (const other of track.clips) {
        if (other === clip) continue;
        if (start < other.start + other.length - 1e-6 && end > other.start + 1e-6) return other;
      }
      return null;
    }
    // Closest free position to `start` on the track, or null when the clip fits nowhere near it.
    function freeStart(track, clip, start, length) {
      if (!collides(track, clip, start, length)) return start;
      const candidates = [];
      for (const other of track.clips) {
        if (other === clip) continue;
        candidates.push(other.start + other.length, other.start - length);
      }
      let best = null;
      for (const c of candidates) {
        if (c < 0) continue;
        if (collides(track, clip, c, length)) continue;
        if (best === null || Math.abs(c - start) < Math.abs(best - start)) best = c;
      }
      return best;
    }
    function addClip(spec) {
      const source = spec.source;
      const kind = source.kind === 'audio' ? 'audio' : 'video';
      const isImage = source.kind === 'image';
      const naturalLen = isImage ? Math.min(IMAGE_DEFAULT_LEN, Number(spec.length) || IMAGE_DEFAULT_LEN) : source.durationSec;
      let track = spec.trackId ? trackOf(spec.trackId) : null;
      if (track && track.kind !== kind) track = null;
      if (!track && spec.start !== undefined) {
        // no track named: the first track of this kind with room at the asked position
        const len = isImage ? naturalLen : source.durationSec;
        track = state.tracks.find((t) => t.kind === kind && !collides(t, null, Math.max(0, Number(spec.start) || 0), len)) || null;
      }
      if (!track) track = state.tracks.find((t) => t.kind === kind) || addTrack(null, kind);
      const clip = {
        id: uid('clip'), trackId: track.id, name: spec.name || source.fileName || '片段', source, kind,
        start: Math.max(0, Number(spec.start) || 0), offset: 0, end: naturalLen, length: naturalLen, isImage,
        transform: kind === 'video' ? (spec.transform || fitTransform(source)) : null, visible: true,
        fadeIn: Math.max(0, Number(spec.fadeIn) || 0), fadeOut: Math.max(0, Number(spec.fadeOut) || 0),
        mask: null, maskRevision: 0, audioDetached: false,
        // playback speed: source seconds per timeline second (dragging an edge sets it)
        rate: 1
      };
      clampFades(clip);
      if (spec.start === undefined) {
        let end = 0; for (const c of track.clips) end = Math.max(end, c.start + c.length);
        clip.start = end;
      } else {
        const free = freeStart(track, clip, clip.start, clip.length);
        if (free === null) { let end = 0; for (const c of track.clips) end = Math.max(end, c.start + c.length); clip.start = end; }
        else clip.start = free;
      }
      track.clips.push(clip);
      if (kind === 'video') stripOf(source, draw);
      select(clip.id);
      layout(); changed();
      return clip;
    }
    function fitTransform(source) {
      const scale = Math.min(state.canvas.width / source.width, state.canvas.height / source.height);
      return { centerX: state.canvas.width / 2, centerY: state.canvas.height / 2, scale };
    }
    function rateOf(clip) { return clip && !clip.isImage ? (Number(clip.rate) || 1) : 1; }
    function syncLength(clip) { clip.length = Math.max(MIN_LEN, (clip.end - clip.offset) / rateOf(clip)); clampFades(clip); return clip.length; }
    function clampFades(clip) {
      clip.fadeIn = clamp(Number(clip.fadeIn) || 0, 0, clip.length);
      clip.fadeOut = clamp(Number(clip.fadeOut) || 0, 0, Math.max(0, clip.length - clip.fadeIn));
    }
    function setFade(clipId, fadeIn, fadeOut) {
      const clip = clipOf(clipId); if (!clip) return;
      if (fadeIn !== undefined) clip.fadeIn = clamp(Number(fadeIn) || 0, 0, clip.length);
      if (fadeOut !== undefined) clip.fadeOut = clamp(Number(fadeOut) || 0, 0, clip.length);
      // both fades share the clip: the one being set wins the overlap
      if (fadeIn !== undefined) clip.fadeOut = Math.min(clip.fadeOut, Math.max(0, clip.length - clip.fadeIn));
      else clip.fadeIn = Math.min(clip.fadeIn, Math.max(0, clip.length - clip.fadeOut));
      draw(); changed();
    }
    // 0..1 envelope of a clip at timeline time t
    function fadeGain(clip, t) {
      const local = t - clip.start;
      let g = 1;
      if (clip.fadeIn > 0 && local < clip.fadeIn) g = Math.min(g, Math.max(0, local / clip.fadeIn));
      if (clip.fadeOut > 0 && local > clip.length - clip.fadeOut) g = Math.min(g, Math.max(0, (clip.length - local) / clip.fadeOut));
      return clamp(g, 0, 1);
    }
    function removeClip(id) {
      for (const t of state.tracks) {
        const i = t.clips.findIndex((c) => c.id === id);
        if (i >= 0) { t.clips.splice(i, 1); state.picked.delete(id); if (state.selected === id) select(null); layout(); changed(); restartIfPlaying(); return true; }
      }
      return false;
    }
    // mode: undefined = only this clip, 'toggle' = add / remove it, 'keep' = keep the group, make it the shown one
    function select(id, mode) {
      if (mode === 'toggle' && id) {
        if (state.picked.has(id)) state.picked.delete(id); else state.picked.add(id);
        state.selected = state.picked.has(id) ? id : (state.picked.size ? Array.from(state.picked).pop() : null);
      } else if (mode === 'keep' && id && state.picked.has(id)) {
        state.selected = id;
      } else {
        state.picked = new Set(id ? [id] : []);
        state.selected = id;
      }
      const shown = state.selected ? clipOf(state.selected) : null;
      if (shown) setActiveTrack(shown.trackId);
      onSelect(shown);
      draw();
    }
    function selectMany(ids) {
      state.picked = new Set(ids);
      state.selected = ids.length ? ids[ids.length - 1] : null;
      onSelect(state.selected ? clipOf(state.selected) : null);
      draw();
    }
    function selectAll() { selectMany(allClips().map((c) => c.id)); }
    function pickedClips() { return allClips().filter((c) => state.picked.has(c.id)); }
    function deletePicked() {
      const ids = new Set(state.picked.size ? state.picked : (state.selected ? [state.selected] : []));
      if (!ids.size) return false;
      for (const t of state.tracks) t.clips = t.clips.filter((c) => !ids.has(c.id));
      state.picked = new Set(); state.selected = null; onSelect(null);
      layout(); changed(); restartIfPlaying();
      return true;
    }
    function setActiveTrack(id) {
      if (state.activeTrack === id) return;
      state.activeTrack = id;
      for (const row of headerList.children) { if (row.dataset.trackId === id) row.setAttribute('data-active', '1'); else row.removeAttribute('data-active'); }
    }
    function selectedClip() { return state.selected ? clipOf(state.selected) : null; }
    function splitAtPlayhead() {
      const t = state.playhead;
      const inside = (c) => t > c.start && t < c.start + c.length;
      const sel = selectedClip();
      const clip = sel && inside(sel) ? sel : allClips().find(inside);
      if (!clip || t <= clip.start + 0.02 || t >= clip.start + clip.length - 0.02) return null;
      const cut = t - clip.start;
      const right = { ...clip, id: uid('clip'), start: t, offset: clip.offset + cut * rateOf(clip), transform: clip.transform ? { ...clip.transform } : null, fadeIn: 0, mask: clip.mask && options.cloneMask ? options.cloneMask(clip.mask) : null };
      clip.end = clip.offset + cut * rateOf(clip); clip.fadeOut = 0;
      syncLength(clip); syncLength(right);
      clipTrack(clip).clips.push(right);
      select(right.id); layout(); changed(); restartIfPlaying();
      return right;
    }
    function duplicateSelected() {
      const clip = selectedClip(); if (!clip) return null;
      const track = clipTrack(clip);
      const copy = { ...clip, id: uid('clip'), transform: clip.transform ? { ...clip.transform } : null, mask: clip.mask && options.cloneMask ? options.cloneMask(clip.mask) : null };
      const free = freeStart(track, copy, clip.start + clip.length, clip.length);
      copy.start = free === null ? projectEnd() : free;
      track.clips.push(copy);
      select(copy.id); layout(); changed();
      return copy;
    }
    function setTransform(clipId, patch) {
      const clip = clipOf(clipId); if (!clip || !clip.transform) return;
      Object.assign(clip.transform, patch);
      clip.transform.scale = clamp(Number(clip.transform.scale) || 1, 0.05, 10);
      onChange('transform');
    }
    function setLength(clipId, seconds) {
      const clip = clipOf(clipId); if (!clip) return;
      const track = clipTrack(clip);
      let nextStart = Infinity;
      for (const other of track.clips) if (other !== clip && other.start >= clip.start + clip.length - 1e-6) nextStart = Math.min(nextStart, other.start);
      const maxLen = Math.min((clip.isImage ? IMAGE_MAX_LEN : clip.source.durationSec) - clip.offset, nextStart - clip.start);
      clip.end = clip.offset + clamp(Number(seconds) || MIN_LEN, MIN_LEN, Math.max(MIN_LEN, maxLen));
      syncLength(clip); layout(); changed(); restartIfPlaying();
    }
    // 分离音轨: the video clip's sound becomes an audio clip with the same window on an audio
    // track (audioSource = the same file read as audio); the video clip goes silent.
    function detachAudio(clipId, audioSource) {
      const clip = clipOf(clipId);
      if (!clip || clip.kind !== 'video' || clip.audioDetached || !clip.source.hasAudio) return null;
      const audioTrack = state.tracks.find((t) => t.kind === 'audio' && !collides(t, null, clip.start, clip.length)) || addTrack(null, 'audio');
      const audio = addClip({ source: audioSource, name: clip.name + ' 音轨', trackId: audioTrack.id, start: clip.start, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut });
      audio.offset = clip.offset; audio.end = clip.end; audio.rate = rateOf(clip); syncLength(audio);
      if (audio.start !== clip.start) { audio.start = clip.start; }
      clip.audioDetached = true;
      select(clip.id); layout(); changed(); restartIfPlaying();
      return audio;
    }
    function setMask(clipId, surface, revision) {
      const clip = clipOf(clipId); if (!clip) return;
      clip.mask = surface || null; clip.maskRevision = surface ? Math.max(0, Number(revision) || 0) : 0;
      changed();
    }
    function setClipVisible(clipId, visible) { const clip = clipOf(clipId); if (clip) { clip.visible = Boolean(visible); draw(); changed(); } }

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
      const W = Math.round(w * dpr), H = Math.round(h * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        canvas.width = W; canvas.height = H;
        playheadEl.style.height = h + 'px';
        // a resized canvas is blank until painted: paint now, not a task later
        drawQueued = false; paint();
        return;
      }
      draw();
    }
    function draw() {
      if (drawQueued) return;
      drawQueued = true;
      // A timer, not rAF: the page keeps repainting while the pane is hidden.
      setTimeout(() => { drawQueued = false; paint(); }, 0);
    }
    function paint() {
      const g = canvas.getContext('2d');
      const dpr = root.devicePixelRatio || 1;
      const w = canvas.width / dpr, h = canvas.height / dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = COLORS.bg; g.fillRect(0, 0, w, h);
      state.tracks.forEach((track, i) => {
        g.fillStyle = track.kind === 'audio' ? COLORS.laneAudio : (i % 2 ? COLORS.laneAlt : COLORS.lane);
        g.fillRect(0, laneTop(i), w, LANE_H);
      });
      const unit = gridUnit();
      g.strokeStyle = COLORS.grid; g.lineWidth = 1;
      for (let t = 0; t * state.zoom < w; t += unit) {
        const x = timeToX(t) + 0.5;
        g.beginPath(); g.moveTo(x, RULER_H); g.lineTo(x, h); g.stroke();
      }
      state.tracks.forEach((track, i) => {
        for (const clip of track.clips) paintClip(g, clip, track, laneTop(i));
      });
      if (drag && snapHint !== null) {
        const x = timeToX(snapHint) + 0.5;
        g.strokeStyle = COLORS.snapLine; g.setLineDash([4, 3]);
        g.beginPath(); g.moveTo(x, RULER_H); g.lineTo(x, h); g.stroke(); g.setLineDash([]);
      }
      if (drag && drag.kind === 'marquee' && drag.moved) {
        const bx = Math.min(drag.x0, drag.x1), by = Math.max(RULER_H, Math.min(drag.y0, drag.y1));
        g.fillStyle = 'rgba(30,166,114,0.12)'; g.fillRect(bx, by, Math.abs(drag.x1 - drag.x0), Math.max(drag.y0, drag.y1) - by);
        g.strokeStyle = '#1EA672'; g.lineWidth = 1; g.strokeRect(bx + 0.5, by + 0.5, Math.abs(drag.x1 - drag.x0), Math.max(drag.y0, drag.y1) - by);
      }
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
    function paintClip(g, clip, track, top) {
      const x = timeToX(clip.start), wpx = Math.max(2, timeToX(clip.start + clip.length) - x);
      const isAudio = clip.kind === 'audio';
      const pal = isAudio ? (track.mute ? COLORS.clipMuted : COLORS.audio) : ((track.visible && clip.visible) ? COLORS.clip : COLORS.clipMuted);
      const selected = state.picked.has(clip.id) || clip.id === state.selected;
      g.fillStyle = pal[2]; g.fillRect(x, top + 2, wpx, LANE_H - 4);
      const peaks = isAudio ? clip.source.peaks : null;
      if (peaks && peaks.length) {
        // waveform over the source window
        const mid = top + 2 + (LANE_H - 4) / 2, amp = (LANE_H - 4) / 2 - 3;
        g.fillStyle = pal[1];
        for (let px = 0; px < wpx; px += 1) {
          const srcT = clip.offset + xToTime(px) * rateOf(clip);
          const bin = Math.min(peaks.length - 1, Math.max(0, Math.floor(srcT / clip.source.durationSec * peaks.length)));
          const v = peaks[bin] * amp;
          g.fillRect(x + px, mid - v, 1, Math.max(1, v * 2));
        }
      }
      // filmstrip: a frame per tile, picked by the source time under the tile
      const strip = isAudio ? null : stripOf(clip.source, draw);
      if (strip && strip.frames.length) {
        const fh = LANE_H - 4, fw = Math.max(8, Math.round(fh * strip.aspect));
        g.save(); g.beginPath(); g.rect(x, top + 2, wpx, fh); g.clip();
        for (let px = 0; px < wpx; px += fw) {
          const srcT = clip.isImage ? 0 : clip.offset + xToTime(px + fw / 2) * rateOf(clip);
          let best = strip.frames[0];
          for (const f of strip.frames) if (Math.abs(f.t - srcT) < Math.abs(best.t - srcT)) best = f;
          g.drawImage(best.canvas, x + px, top + 2, fw, fh);
        }
        if (!(track.visible && clip.visible)) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, top + 2, wpx, fh); }
        g.restore();
      }
      // fades: a ramp line on each side plus the corner handles
      if (clip.fadeIn > 0 || clip.fadeOut > 0) {
        g.strokeStyle = COLORS.fade; g.lineWidth = 1; g.beginPath();
        if (clip.fadeIn > 0) { g.moveTo(x, top + LANE_H - 2); g.lineTo(x + timeToX(clip.fadeIn), top + 2); }
        if (clip.fadeOut > 0) { g.moveTo(x + wpx - timeToX(clip.fadeOut), top + 2); g.lineTo(x + wpx, top + LANE_H - 2); }
        g.stroke();
        g.fillStyle = 'rgba(0,0,0,0.28)';
        if (clip.fadeIn > 0) { g.beginPath(); g.moveTo(x, top + 2); g.lineTo(x + timeToX(clip.fadeIn), top + 2); g.lineTo(x, top + LANE_H - 2); g.closePath(); g.fill(); }
        if (clip.fadeOut > 0) { g.beginPath(); g.moveTo(x + wpx, top + 2); g.lineTo(x + wpx - timeToX(clip.fadeOut), top + 2); g.lineTo(x + wpx, top + LANE_H - 2); g.closePath(); g.fill(); }
      }
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillRect(x + timeToX(clip.fadeIn) - 3, top + 3, 6, 6);
      g.fillRect(x + wpx - timeToX(clip.fadeOut) - 3, top + 3, 6, 6);
      // trim handles
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(x, top + 2, 4, LANE_H - 4); g.fillRect(x + wpx - 4, top + 2, 4, LANE_H - 4);
      g.strokeStyle = selected ? COLORS.selected : pal[0]; g.lineWidth = selected ? 1.5 : 1;
      g.strokeRect(x + 0.5, top + 2.5, wpx - 1, LANE_H - 5);
      g.save(); g.beginPath(); g.rect(x, top, wpx, LANE_H); g.clip();
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, top + LANE_H - 18, wpx, 16);
      g.fillStyle = COLORS.text; g.font = '11px system-ui, sans-serif'; g.textBaseline = 'bottom';
      g.fillText(clip.name + '  ' + formatTime(clip.length) + (Math.abs(rateOf(clip) - 1) > 0.005 ? '  ×' + rateOf(clip).toFixed(2) : '') + (clip.source.hasAudio && !track.mute && !isAudio && !clip.audioDetached ? '  ♪' : '') + (clip.mask && clip.maskRevision > 0 ? '  蒙版' : ''), x + 6, top + LANE_H - 4);
      g.restore();
    }
    function positionPlayhead() { playheadEl.style.left = (timeToX(state.playhead) - 1) + 'px'; }
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
            // the nearer of the two fade handles wins when they sit close together
            const dIn = Math.abs(px - (x + timeToX(clip.fadeIn))), dOut = Math.abs(px - (x + wpx - timeToX(clip.fadeOut)));
            if (dIn <= 6 && dIn <= dOut) return { kind: 'fadeIn', clip, track: i };
            if (dOut <= 6) return { kind: 'fadeOut', clip, track: i };
          }
          if (px <= x + 6) return { kind: 'trimStart', clip, track: i };
          if (px >= x + wpx - 6) return { kind: 'trimEnd', clip, track: i };
          return { kind: 'move', clip, track: i };
        }
        return { kind: 'lane', track: i };
      }
      return { kind: 'empty' };
    }
    function cursorFor(h) { return { ruler: 'col-resize', fadeIn: 'ew-resize', fadeOut: 'ew-resize', trimStart: 'ew-resize', trimEnd: 'ew-resize', move: 'grab' }[h.kind] || 'default'; }
    function pointer(event) { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
    canvas.addEventListener('pointermove', (event) => {
      if (drag) return;
      const p = pointer(event);
      canvas.style.cursor = cursorFor(hit(p.x, p.y));
    });
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const p = pointer(event);
      const h = hit(p.x, p.y);
      try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* synthetic pointer */ }
      if (h.kind === 'ruler') {
        seek(snapTime(xToTime(p.x)));
        drag = { kind: 'scrub' };
        return;
      }
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      if (h.kind === 'lane' || h.kind === 'empty') {
        if (h.kind === 'lane') setActiveTrack(state.tracks[h.track].id);
        // a click moves the playhead; a drag draws a box that picks the clips it touches
        drag = { kind: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y, moved: false, additive, base: new Set(state.picked) };
        return;
      }
      if (additive) { select(h.clip.id, 'toggle'); if (!state.picked.has(h.clip.id)) return; }
      else if (state.picked.has(h.clip.id) && state.picked.size > 1 && h.kind === 'move') select(h.clip.id, 'keep');
      else select(h.clip.id);
      const group = h.kind === 'move' && state.picked.size > 1 ? pickedClips().map((c) => ({ clip: c, start: c.start })) : null;
      drag = { kind: h.kind, clip: h.clip, track: h.track, startX: p.x, startY: p.y, group,
        origin: { start: h.clip.start, offset: h.clip.offset, end: h.clip.end, length: h.clip.length, rate: rateOf(h.clip), trackId: h.clip.trackId, fadeIn: h.clip.fadeIn, fadeOut: h.clip.fadeOut } };
      canvas.style.cursor = h.kind === 'move' ? 'grabbing' : cursorFor(h);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const p = pointer(event);
      if (drag.kind === 'scrub') { seek(snapTime(xToTime(Math.max(0, p.x)))); return; }
      if (drag.kind === 'marquee') {
        drag.x1 = p.x; drag.y1 = p.y;
        if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) < 4) return;
        drag.moved = true;
        const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1), y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
        const ids = new Set(drag.additive ? drag.base : []);
        state.tracks.forEach((t, i) => {
          const top = laneTop(i);
          if (top + LANE_H < y0 || top > y1) return;
          for (const c of t.clips) if (timeToX(c.start + c.length) >= x0 && timeToX(c.start) <= x1) ids.add(c.id);
        });
        state.picked = ids;
        state.selected = ids.size ? Array.from(ids).pop() : null;
        draw();
        return;
      }
      const clip = drag.clip, o = drag.origin, dt = xToTime(p.x - drag.startX);
      const srcDur = clip.source.durationSec;
      if (drag.kind === 'move' && drag.group) {
        // the picked clips move together on their own tracks; a step that would overlap another clip is skipped
        let d = snapTime(o.start + dt, clip) - o.start;
        const first = Math.min(...drag.group.map((m) => m.start));
        if (first + d < 0) d = -first;
        const ids = new Set(drag.group.map((m) => m.clip.id));
        const fits = drag.group.every((m) => {
          const s = m.start + d, e = s + m.clip.length;
          return !clipTrack(m.clip).clips.some((c) => !ids.has(c.id) && s < c.start + c.length - 1e-6 && e > c.start + 1e-6);
        });
        if (fits) for (const m of drag.group) m.clip.start = m.start + d;
      } else if (drag.kind === 'move') {
        const laneIndex = state.tracks.findIndex((t, i) => p.y >= laneTop(i) && p.y <= laneTop(i) + LANE_H);
        let target = laneIndex >= 0 ? state.tracks[laneIndex] : clipTrack(clip);
        if (target.kind !== clip.kind) target = clipTrack(clip);
        const wanted = snapTime(o.start + dt, clip);
        const free = freeStart(target, clip, wanted, clip.length);
        // A blocked spot nudges the clip to the nearest gap; a gap further away
        // than the clip itself is a jump the user did not ask for, so stay put.
        if (free !== null && Math.abs(free - wanted) <= clip.length) {
          if (target.id !== clip.trackId) {
            const from = clipTrack(clip); from.clips.splice(from.clips.indexOf(clip), 1);
            clip.trackId = target.id; target.clips.push(clip);
          }
          clip.start = free;
          if (free !== wanted) snapHint = null;
        }
      } else if ((drag.kind === 'trimStart' || drag.kind === 'trimEnd') && !clip.isImage) {
        // A video / sound clip's edges change its speed, as 音频编辑's do: longer plays slower,
        // shorter faster; the source window stays whole (cutting is 分割's job). The other
        // edge stays where it is.
        const track = clipTrack(clip);
        const window = Math.max(1e-6, o.end - o.offset);
        const fixedEnd = o.start + o.length;
        const fit = (len) => window / clamp(window / Math.max(MIN_LEN, len), MIN_RATE, MAX_RATE);
        if (drag.kind === 'trimEnd') {
          let nextStart = Infinity;
          for (const other of track.clips) if (other !== clip && other.start >= fixedEnd - 1e-6) nextStart = Math.min(nextStart, other.start);
          const len = fit(Math.min(snapTime(fixedEnd + dt, clip), nextStart) - o.start);
          clip.rate = window / len;
        } else {
          let prevEnd = 0;
          for (const other of track.clips) if (other !== clip && other.start + other.length <= o.start + 1e-6) prevEnd = Math.max(prevEnd, other.start + other.length);
          const len = fit(fixedEnd - Math.max(prevEnd, snapTime(o.start + dt, clip)));
          clip.rate = window / len;
          clip.start = fixedEnd - len;
        }
        syncLength(clip);
      } else if (drag.kind === 'trimStart') {
        const track = clipTrack(clip);
        const earliest = Math.max(0, o.start - o.offset);
        let prevEnd = 0;
        for (const other of track.clips) if (other !== clip && other.start + other.length <= o.start + 1e-6) prevEnd = Math.max(prevEnd, other.start + other.length);
        const newStart = clamp(snapTime(o.start + dt, clip), Math.max(earliest, prevEnd), o.start + o.length - MIN_LEN);
        clip.offset = o.offset + (newStart - o.start);
        clip.start = newStart;
        syncLength(clip);
      } else if (drag.kind === 'trimEnd') {
        const track = clipTrack(clip);
        let nextStart = Infinity;
        for (const other of track.clips) if (other !== clip && other.start >= o.start + o.length - 1e-6) nextStart = Math.min(nextStart, other.start);
        const maxEnd = Math.min(o.start + ((clip.isImage ? IMAGE_MAX_LEN : srcDur) - o.offset), nextStart);
        const newEnd = clamp(snapTime(o.start + o.length + dt, clip), o.start + MIN_LEN, maxEnd);
        clip.end = o.offset + (newEnd - o.start);
        syncLength(clip);
      } else if (drag.kind === 'fadeIn') {
        clip.fadeIn = clamp(o.fadeIn + dt, 0, clip.length); clampFades(clip);
      } else if (drag.kind === 'fadeOut') {
        clip.fadeOut = clamp(o.fadeOut - dt, 0, clip.length); clip.fadeIn = Math.min(clip.fadeIn, Math.max(0, clip.length - clip.fadeOut));
      }
      layout();
      onChange('drag');
    });
    const endDrag = (event) => {
      if (!drag) return;
      const was = drag; drag = null; snapHint = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch (_) { /* already released */ }
      canvas.style.cursor = 'default';
      if (was.kind === 'marquee') {
        if (!was.moved) { if (!was.additive) select(null); seek(snapTime(xToTime(Math.max(0, was.x0)))); }
        else { onSelect(state.selected ? clipOf(state.selected) : null); draw(); }
        return;
      }
      draw();
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
      }
    }, { passive: false });
    scroller.addEventListener('scroll', () => { headerList.style.transform = 'translateY(' + (-scroller.scrollTop) + 'px)'; });

    // drop a resource onto a lane
    scroller.addEventListener('dragover', (event) => { if (dropPayload(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
    // On the document's capture phase: the page's own board drop (a capture listener on its
    // root) takes any drop inside the board area and stops it before it reaches the lanes.
    const onLaneDrop = async (event) => {
      if (!(event.target instanceof Node) || !scroller.contains(event.target)) return;
      const payload = dropPayload(event);
      if (!payload || !options.resolveDrop) return;
      event.preventDefault();
      event.stopPropagation();
      const p = pointer(event);
      const laneIndex = state.tracks.findIndex((t, i) => p.y >= laneTop(i) && p.y <= laneTop(i) + LANE_H);
      const resolved = await options.resolveDrop(payload, event);
      if (!resolved) return;
      addClip({ ...resolved, trackId: laneIndex >= 0 ? state.tracks[laneIndex].id : undefined, start: snapTime(xToTime(Math.max(0, p.x))) });
    };
    document.addEventListener('drop', onLaneDrop, true);
    function dropPayload(event) {
      const types = Array.from(event.dataTransfer?.types || []);
      if (types.includes('application/x-novaflow-video')) return event.dataTransfer.getData('application/x-novaflow-video') || 'pending';
      if (types.includes('Files')) return 'files';
      if (typeof options.dropPayload === 'function') return options.dropPayload(event) || null;
      return null;
    }

    // ---- playback clock ----------------------------------------------------------
    // The editor owns the clock; the preview draws the frame at each tick and
    // drives the <video> elements. setInterval keeps running in a hidden pane.
    let clock = null;
    function play() {
      if (state.playing) return;
      const end = projectEnd();
      if (end <= 0) return;
      if (state.playhead >= end - 0.01) state.playhead = 0;
      clock = { startedAt: performance.now(), from: state.playhead, end };
      state.playing = true;
      onTransport(true);
      clock.timer = setInterval(() => {
        if (!clock) return;
        const t = clock.from + (performance.now() - clock.startedAt) / 1000;
        if (t >= clock.end) {
          if (state.loop) { clearInterval(clock.timer); clock = null; state.playhead = 0; state.playing = false; play(); return; }
          clearInterval(clock.timer); state.playhead = clock.end; clock = null; state.playing = false; onTransport(false); positionPlayhead(); onTime(state.playhead); return;
        }
        state.playhead = Math.max(0, t);
        positionPlayhead(); onTime(state.playhead); keepPlayheadVisible();
      }, 1000 / 60);
    }
    function pause() {
      if (!state.playing) return;
      const t = clock ? clock.from + (performance.now() - clock.startedAt) / 1000 : state.playhead;
      if (clock) clearInterval(clock.timer);
      clock = null; state.playing = false;
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
    function keepPlayheadVisible() {
      const x = timeToX(state.playhead);
      const left = scroller.scrollLeft, w = scroller.clientWidth;
      if (x > left + w - 40) scroller.scrollLeft = x - 40;
      else if (x < left) scroller.scrollLeft = Math.max(0, x - 40);
    }
    // Clips showing at time t, bottom layer first (tracks[0] is the top layer).
    function activeClips(t) {
      const out = [];
      for (let i = state.tracks.length - 1; i >= 0; i -= 1) {
        const track = state.tracks[i];
        if (track.kind !== 'audio' && !track.visible) continue;
        for (const clip of track.clips) {
          if (track.kind !== 'audio' && !clip.visible) continue;
          if (t >= clip.start - 1e-6 && t < clip.start + clip.length) out.push({ clip, track, kind: clip.kind, sourceTime: clip.offset + (t - clip.start) * rateOf(clip), gain: fadeGain(clip, t) });
        }
      }
      return out;
    }
    // Clip-edge jumps for the ⏮ / ⏭ buttons.
    function edges() {
      const set = new Set([0]);
      for (const c of allClips()) { set.add(c.start); set.add(c.start + c.length); }
      return [...set].sort((a, b) => a - b);
    }
    function prevEdge() { const e = edges().filter((x) => x < state.playhead - 0.01); seek(e.length ? e[e.length - 1] : 0); }
    function nextEdge() { const e = edges().filter((x) => x > state.playhead + 0.01); seek(e.length ? e[0] : projectEnd()); }

    // ---- view --------------------------------------------------------------------------
    function setZoom(z) { state.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM); layout(); onChange('zoom'); }
    function fitToWindow() {
      const end = Math.max(1, projectEnd());
      setZoom((scroller.clientWidth - 24) / end);
      scroller.scrollLeft = 0;
    }
    function changed() { syncHeaderIcons(); onChange('model'); }
    function setCanvas(width, height, fps, anchor) {
      const w = Math.max(2, Math.round(width / 2) * 2), h = Math.max(2, Math.round(height / 2) * 2);
      // Keep the chosen point of the old frame fixed inside the new frame. All visual
      // clips move together (including hidden / later clips); their source pixels stay intact.
      const ax = anchor && Number.isFinite(anchor.x) ? clamp(anchor.x, 0, 1) : 0;
      const ay = anchor && Number.isFinite(anchor.y) ? clamp(anchor.y, 0, 1) : 0;
      const dx = (w - state.canvas.width) * ax, dy = (h - state.canvas.height) * ay;
      if (dx || dy) for (const clip of allClips()) if (clip.transform) {
        clip.transform.centerX += dx;
        clip.transform.centerY += dy;
      }
      state.canvas.width = w;
      state.canvas.height = h;
      if (fps) state.canvas.fps = Math.max(1, Math.min(120, Math.round(fps)));
      changed();
    }

    // ---- public ----------------------------------------------------------------------
    const api = {
      state, host, canvas, scroller,
      addTrack, removeTrack, moveTrack, reorderTrack, addClip, removeClip, select, selectedClip, clipOf, splitAtPlayhead, duplicateSelected,
      setTransform, setClipVisible, fitTransform, syncLength, setCanvas, setFade, fadeGain, setLength, setMask, detachAudio,
      deleteSelected() { return deletePicked(); },
      selectAll, pickedClips, activeTrackId: () => state.activeTrack,
      play, pause, stop, toggle, seek, prevEdge, nextEdge, isPlaying: () => state.playing,
      setLoop(v) { state.loop = Boolean(v); onChange('loop'); },
      setSnap(v) { state.snap = Boolean(v); onChange('snap'); },
      setZoom, fitToWindow, zoom: () => state.zoom,
      projectEnd, playhead: () => state.playhead, formatTime, activeClips, allClips,
      layout, draw,
      commitEdit({tracksChanged=false}={}) { if(tracksChanged)renderHeaders();layout(); changed(); restartIfPlaying(); },
      clipCount: () => state.tracks.reduce((n, t) => n + t.clips.length, 0),
      destroy() { pause(); document.removeEventListener('drop', onLaneDrop, true); wrap.remove(); }
    };
    if (!state.tracks.length) { addTrack(null, 'video'); addTrack(null, 'video'); addTrack(null, 'audio'); select(null); }
    return api;
  }

  root.NovaFlowVideoTimeline = { create, LANE_H, RULER_H, HEADER_W };
})(typeof window !== 'undefined' ? window : globalThis);
