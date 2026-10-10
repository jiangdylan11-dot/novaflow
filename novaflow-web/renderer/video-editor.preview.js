// 视频 editor compositor preview (lab): draws the editor's active clips at the
// playhead onto a canvas that fits the project frame into the host, keeps a
// <video> per clip in step with the clock, and lets the user drag a clip
// around the frame. The wheel zooms the canvas VIEW around the cursor (clip
// scale lives in the inspector); dragging empty space or the right button
// pans; 自动适配 resets the view.
//
//   const preview = NovaFlowVideoEditorPreview.mount({ host, editor })
//   editor.onTime -> preview.tick(t); editor.onTransport -> preview.setPlaying(v)
(function (root) {
  'use strict';
  if (root.NovaFlowVideoEditorPreview) return;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const SYNC_DRIFT = 0.08;

  function mount(options) {
    const host = options.host;
    const editor = options.editor;
    const canvas = document.createElement('canvas');
    canvas.className = 'nf-ve-canvas';
    canvas.tabIndex = 0;
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const videos = new Map(); // clipId -> { video, clipId, hasFrame }
    let playing = false;
    let time = 0;
    let stage = { originX: 0, originY: 0, scale: 1, width: 0, height: 0 };
    let view = { zoom: 1, panX: 0, panY: 0 }; // on top of the fitted stage
    // mask editing: { clipId, surface, mode: 'erase'|'restore', brushSize, feather } or null
    let maskEditing = null;
    let hover = null;
    const layerScratch = document.createElement('canvas');
    const brushRing = document.createElement('div'); brushRing.className = 'nf-ve-brush'; brushRing.hidden = true;
    const brushFeather = document.createElement('div'); brushFeather.className = 'nf-ve-brush-feather'; brushFeather.hidden = true;
    host.appendChild(brushFeather); host.appendChild(brushRing);
    let fit = { scale: 1, originX: 0, originY: 0 };
    let drawQueued = false;
    let onZoom = options.onZoomPercent || (() => {});

    function resize() {
      const dpr = root.devicePixelRatio || 1;
      const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      const project = editor.state.canvas;
      const pad = 16;
      const fitScale = Math.min((w - pad * 2) / project.width, (h - pad * 2) / project.height);
      fit = { scale: fitScale, originX: (w - project.width * fitScale) / 2, originY: (h - project.height * fitScale) / 2 };
      applyView();
    }
    function applyView() {
      const project = editor.state.canvas;
      const scale = fit.scale * view.zoom;
      const w = host.clientWidth, h = host.clientHeight;
      stage = { scale, width: project.width * scale, height: project.height * scale, originX: (w - project.width * scale) / 2 + view.panX, originY: (h - project.height * scale) / 2 + view.panY };
      onZoom(scale * 100);
      draw();
    }
    function setViewZoom(zoom, anchor) {
      const next = clamp(zoom, 0.05, 20);
      if (anchor) {
        // keep the project point under the cursor where it is
        const px = (anchor.x - stage.originX) / stage.scale, py = (anchor.y - stage.originY) / stage.scale;
        const scale = fit.scale * next;
        const w = host.clientWidth, h = host.clientHeight;
        view.panX = anchor.x - px * scale - (w - editor.state.canvas.width * scale) / 2;
        view.panY = anchor.y - py * scale - (h - editor.state.canvas.height * scale) / 2;
      }
      view.zoom = next;
      applyView();
    }
    function fitToViewport() { view = { zoom: 1, panX: 0, panY: 0 }; resize(); }
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(host);

    function recordFor(entry) {
      let record = videos.get(entry.clip.id);
      if (!record && entry.clip.isImage) {
        const img = new Image();
        record = { video: img, clipId: entry.clip.id, hasFrame: false, isImage: true };
        img.onload = () => { record.hasFrame = true; draw(); };
        img.src = entry.clip.source.url;
        videos.set(entry.clip.id, record);
        return record;
      }
      if (record && record.isImage) return record;
      if (!record) {
        const video = document.createElement(entry.kind === 'audio' ? 'audio' : 'video');
        video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
        video.src = entry.clip.source.url;
        record = { video, clipId: entry.clip.id, hasFrame: false, lastSeek: -1 };
        video.addEventListener('seeked', () => { record.hasFrame = true; if (!playing) draw(); });
        video.addEventListener('loadeddata', () => { record.hasFrame = true; if (!playing) draw(); });
        videos.set(entry.clip.id, record);
      }
      record.video.muted = entry.kind === 'audio' ? Boolean(entry.track.mute) : !(entry.clip.source.hasAudio && !entry.track.mute && !entry.clip.audioDetached);
      const gain = entry.gain == null ? 1 : entry.gain;
      if (Math.abs(record.video.volume - gain) > 0.01) record.video.volume = gain;
      return record;
    }
    function dropStale() {
      const live = new Set(editor.allClips().map((c) => c.id));
      for (const [id, record] of videos) {
        if (live.has(id)) continue;
        try { if (!record.isImage) { record.video.pause(); record.video.removeAttribute('src'); record.video.load(); } } catch (_) { /* gone */ }
        videos.delete(id);
      }
    }
    function setVideoTime(video, t) {
      const target = clamp(t, 0, Math.max(0, (Number.isFinite(video.duration) ? video.duration : t) - 0.001));
      if (Math.abs((video.currentTime || 0) - target) > 0.02) video.currentTime = target;
    }

    // ---- clock -----------------------------------------------------------------------
    function tick(t) {
      time = t;
      const active = editor.activeClips(t);
      const activeIds = new Set(active.map((e) => e.clip.id));
      for (const entry of active) {
        const record = recordFor(entry);
        if (record.isImage) continue;
        const video = record.video;
        if (playing) {
          if (video.paused) { setVideoTime(video, entry.sourceTime); video.play().catch(() => {}); }
          else if (Math.abs(video.currentTime - entry.sourceTime) > SYNC_DRIFT) video.currentTime = entry.sourceTime;
        } else setVideoTime(video, entry.sourceTime);
      }
      for (const [id, record] of videos) if (!record.isImage && !activeIds.has(id) && !record.video.paused) record.video.pause();
      draw();
    }
    function setPlaying(value) {
      playing = Boolean(value);
      if (!playing) for (const record of videos.values()) { try { if (!record.isImage) record.video.pause(); } catch (_) { /* fine */ } }
      tick(editor.playhead());
    }

    // ---- drawing -------------------------------------------------------------------
    function geometry(clip) {
      const src = clip.source, tr = clip.transform;
      const pw = src.width * tr.scale, ph = src.height * tr.scale;
      return {
        left: stage.originX + (tr.centerX - pw / 2) * stage.scale,
        top: stage.originY + (tr.centerY - ph / 2) * stage.scale,
        width: pw * stage.scale, height: ph * stage.scale
      };
    }
    function draw() {
      if (drawQueued) return;
      drawQueued = true;
      setTimeout(() => { drawQueued = false; paint(); }, 0);
    }
    function paint() {
      const dpr = root.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // the host's own colour, so the board's 深色 / 白色 / 灰色 backdrop toggle still shows through
      const win = host.ownerDocument.defaultView || root;
      const viewport = host.closest('[data-novaflow-ai-preview-bg]') || host.ownerDocument.querySelector('[data-novaflow-ai-preview-bg]');
      const boardColor = viewport ? win.getComputedStyle(viewport).getPropertyValue('--novaflow-ai-preview-color').trim() : '';
      ctx.fillStyle = boardColor || win.getComputedStyle(host).backgroundColor || '#242424'; ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      ctx.fillStyle = '#000'; ctx.fillRect(stage.originX, stage.originY, stage.width, stage.height);
      ctx.save(); ctx.beginPath(); ctx.rect(stage.originX, stage.originY, stage.width, stage.height); ctx.clip();
      const active = editor.activeClips(time);
      for (const entry of active) {
        if (entry.kind === 'audio') continue;
        const record = videos.get(entry.clip.id);
        if (!record || (record.isImage ? !record.hasFrame : record.video.readyState < 2)) continue;
        const g = geometry(entry.clip);
        const maskCanvas = entry.clip.mask && entry.clip.maskRevision > 0 ? entry.clip.mask.getCanvas() : (maskEditing && maskEditing.clipId === entry.clip.id ? maskEditing.surface.getCanvas() : null);
        ctx.globalAlpha = entry.gain == null ? 1 : entry.gain;
        if (maskCanvas) {
          // the mask (white, alpha = coverage) multiplies into the layer's own alpha before it lands on the frame
          if (layerScratch.width !== canvas.width || layerScratch.height !== canvas.height) { layerScratch.width = canvas.width; layerScratch.height = canvas.height; }
          const lc = layerScratch.getContext('2d');
          lc.setTransform(dpr, 0, 0, dpr, 0, 0);
          lc.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
          try { lc.drawImage(record.video, g.left, g.top, g.width, g.height); } catch (_) { /* decoder busy */ }
          lc.globalCompositeOperation = 'destination-in';
          lc.drawImage(maskCanvas, g.left, g.top, g.width, g.height);
          lc.globalCompositeOperation = 'source-over';
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(layerScratch, 0, 0);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        } else {
          try { ctx.drawImage(record.video, g.left, g.top, g.width, g.height); } catch (_) { /* decoder busy */ }
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 1; ctx.strokeRect(stage.originX - 0.5, stage.originY - 0.5, stage.width + 1, stage.height + 1);
      const selected = editor.selectedClip();
      if (selected && selected.transform && active.some((e) => e.clip === selected)) {
        const g = geometry(selected);
        ctx.strokeStyle = '#1EA672'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
        ctx.strokeRect(g.left + 0.5, g.top + 0.5, g.width - 1, g.height - 1); ctx.setLineDash([]);
      }
      if (!active.length && !editor.clipCount()) {
        ctx.fillStyle = '#6a6a6a'; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('把资源列表的视频拖到下方轨道，或点击片段的 +', stage.originX + stage.width / 2, stage.originY + stage.height / 2);
        ctx.textAlign = 'start';
      }
    }

    // ---- stage interaction: drag a clip, wheel its scale --------------------------
    function point(event) { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
    function clipAt(p) {
      const active = editor.activeClips(time).filter((e) => e.kind !== 'audio');
      for (let i = active.length - 1; i >= 0; i -= 1) {
        const g = geometry(active[i].clip);
        if (p.x >= g.left && p.x <= g.left + g.width && p.y >= g.top && p.y <= g.top + g.height) return active[i].clip;
      }
      return null;
    }
    let drag = null; // { clip, ... } moves a clip; { pan: true, ... } pans the view; { paint: true } strokes the mask
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    // stage point -> the editing clip's source pixels
    function maskLocal(p) {
      const clip = editor.clipOf(maskEditing.clipId);
      if (!clip || !clip.transform) return null;
      const g = geometry(clip);
      const k = stage.scale * clip.transform.scale; // css px per source px
      return { x: (p.x - g.left) / k, y: (p.y - g.top) / k, k };
    }
    function positionBrush(p) {
      if (!maskEditing || !p) { brushRing.hidden = true; brushFeather.hidden = true; return; }
      const size = maskEditing.brushSize, feather = maskEditing.feather;
      brushRing.hidden = false; brushRing.style.left = (p.x - size / 2) + 'px'; brushRing.style.top = (p.y - size / 2) + 'px'; brushRing.style.width = size + 'px'; brushRing.style.height = size + 'px';
      brushRing.style.borderColor = maskEditing.mode === 'restore' ? '#f7f7f7' : '#27c889';
      brushFeather.hidden = !(feather > 0);
      if (feather > 0) { const fs = size + feather * 2; brushFeather.style.left = (p.x - fs / 2) + 'px'; brushFeather.style.top = (p.y - fs / 2) + 'px'; brushFeather.style.width = fs + 'px'; brushFeather.style.height = fs + 'px'; }
    }
    canvas.addEventListener('pointerdown', (event) => {
      const p = point(event);
      if (maskEditing && event.button === 0) {
        const local = maskLocal(p); if (!local) return;
        try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* synthetic */ }
        const radius = Math.max(0.5, maskEditing.brushSize / 2 / local.k), feather = Math.max(0, maskEditing.feather / local.k);
        try { maskEditing.surface.beginStroke({ mode: maskEditing.mode, radiusPx: radius, featherPx: feather, x: local.x, y: local.y }); }
        catch (error) { console.warn('[lab] mask stroke', error); return; }
        drag = { paint: true };
        draw();
        return;
      }
      const clip = event.button === 0 ? clipAt(p) : null;
      if (event.button === 0) editor.select(clip ? clip.id : null);
      try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* synthetic */ }
      if (clip) {
        drag = { clip, startX: p.x, startY: p.y, originX: clip.transform.centerX, originY: clip.transform.centerY };
        canvas.style.cursor = 'grabbing';
      } else {
        drag = { pan: true, startX: p.x, startY: p.y, panX: view.panX, panY: view.panY };
        canvas.style.cursor = 'move';
      }
    });
    canvas.addEventListener('pointermove', (event) => {
      const p = point(event);
      hover = p;
      if (maskEditing) { positionBrush(p); canvas.style.cursor = 'none'; }
      if (drag && drag.paint) { maskEditing.surface.extendStroke({ x: maskLocal(p).x, y: maskLocal(p).y }); draw(); return; }
      if (!drag) { if (!maskEditing) canvas.style.cursor = clipAt(p) ? 'grab' : 'default'; return; }
      if (drag.pan) { view.panX = drag.panX + (p.x - drag.startX); view.panY = drag.panY + (p.y - drag.startY); applyView(); return; }
      editor.setTransform(drag.clip.id, { centerX: drag.originX + (p.x - drag.startX) / stage.scale, centerY: drag.originY + (p.y - drag.startY) / stage.scale });
      draw();
    });
    const endDrag = (event) => {
      if (!drag) return;
      const was = drag; drag = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch (_) { /* released */ }
      if (was.paint && maskEditing) {
        maskEditing.surface.endStroke();
        const rev = maskEditing.surface.debugState ? maskEditing.surface.debugState().revision : (maskEditing.revision = (maskEditing.revision || 0) + 1);
        if (options.onMaskStroke) options.onMaskStroke(maskEditing.clipId, rev);
        draw();
        return;
      }
      canvas.style.cursor = maskEditing ? 'none' : 'default';
    };
    canvas.addEventListener('pointerleave', () => { if (!drag) positionBrush(null); });
    function setMaskEditing(value) {
      if (!value || !value.enabled) { maskEditing = null; positionBrush(null); canvas.style.cursor = 'default'; draw(); return; }
      maskEditing = { clipId: value.clipId, surface: value.surface, mode: value.mode === 'restore' ? 'restore' : 'erase', brushSize: clamp(Number(value.brushSize) || 22, 1, 300), feather: clamp(Number(value.feather) || 0, 0, 300) };
      if (hover) positionBrush(hover);
      draw();
    }
    function updateMaskBrush(patch) { if (!maskEditing) return; Object.assign(maskEditing, patch || {}); maskEditing.brushSize = clamp(Number(maskEditing.brushSize) || 22, 1, 300); maskEditing.feather = clamp(Number(maskEditing.feather) || 0, 0, 300); if (hover) positionBrush(hover); }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      setViewZoom(view.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), point(event));
    }, { passive: false });

    // ---- drop onto the stage: the page resolves the payload, the clip lands centred on the drop point
    function projectPoint(p) { return { x: (p.x - stage.originX) / stage.scale, y: (p.y - stage.originY) / stage.scale }; }
    function dropPayload(event) {
      const types = Array.from(event.dataTransfer?.types || []);
      if (types.includes('application/x-novaflow-video')) return event.dataTransfer.getData('application/x-novaflow-video') || 'pending';
      if (types.includes('Files')) return 'files';
      if (typeof options.dropPayload === 'function') return options.dropPayload(event) || null;
      return null;
    }
    canvas.addEventListener('dragover', (event) => { if (dropPayload(event) && options.onDrop) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; host.dataset.dropActive = '1'; } });
    canvas.addEventListener('dragleave', () => { host.dataset.dropActive = ''; });
    // document capture: the page's board drop would take it first (see the timeline)
    const onStageDrop = async (event) => {
      if (event.target !== canvas) return;
      host.dataset.dropActive = '';
      const payload = dropPayload(event);
      if (!payload || !options.onDrop) return;
      event.preventDefault();
      event.stopPropagation();
      await options.onDrop(payload, projectPoint(point(event)), event);
    };
    document.addEventListener('drop', onStageDrop, true);

    resize();
    return {
      canvas, tick, setPlaying, draw, resize, fitToViewport, setViewZoom, viewZoom: () => view.zoom, stageMetrics: () => ({ ...stage }), setMaskEditing, updateMaskBrush, isMaskEditing: () => Boolean(maskEditing),
      refresh() { dropStale(); tick(editor.playhead()); },
      destroy() { document.removeEventListener('drop', onStageDrop, true); if (ro) ro.disconnect(); for (const r of videos.values()) { try { if (!r.isImage) r.video.pause(); } catch (_) { /* fine */ } } videos.clear(); canvas.remove(); }
    };
  }

  root.NovaFlowVideoEditorPreview = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
