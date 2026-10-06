// 帧编辑: frame-level editing of whatever video the 动画 stage shows.
//
// The 动画 panel's 帧编辑 row (novaflow-brand-runtime.js, AI_ANIMATION_TOOL_HEADINGS)
// toggles this tool. It decodes the stage video into frames at the dock's frame
// rate (electronAPI.exportDecodeVideoFrames), covers the stage with a frame
// viewer and a film strip, keeps the operations in a left-panel block under the
// row (删除 / 复制插帧 / 左移 / 右移 / 倒放 / 镜像 / 撤销 / 重做 / 还原), and 生成新资源
// encodes the edited order back to a clip that joins the 资源列表 as a new
// resource (the source stays). The order model is video-frame-edit.core.js.
(function () {
  'use strict'

  const PANEL_ATTR = 'data-novaflow-video-frame-edit-panel'
  const OVERLAY_ID = 'novaflow-video-frame-edit-overlay'
  const STYLE_ID = 'novaflow-video-frame-edit-style'
  const STATE_EVENT = 'novaflow:video-frame-edit-state'
  const MAX_FRAMES = 600
  const THUMB_HEIGHT = 64
  // Frames are shown from bitmaps no larger than the viewer needs (long edge capped),
  // kept up to this many bytes so a whole clip plays from memory after one pass.
  const VIEW_LONG_EDGE = 1024
  const VIEW_CACHE_BYTES = 320 * 1024 * 1024
  const ACCENT = '#1ea672'
  const BODY_ATTR = 'data-novaflow-video-frame-edit-open'

  const state = {
    open: false,
    busy: false,
    model: null,
    frames: null,
    thumbs: null,
    full: new Map(),
    fullBytes: 0,
    viewEdge: 0,
    prefetching: new Set(),
    fps: 0,
    width: 0,
    height: 0,
    alpha: false,
    sourceName: '',
    viewport: null,
    panel: null,
    overlay: null,
    els: null,
    timer: 0,
    current: 0,
    anchor: 0,
    playing: false,
    playTimer: 0,
    lastRect: '',
    drawToken: 0,
    dragging: false
  }

  const core = () => window.NovaFlowVideoFrameEditCore
  const api = () => window.electronAPI
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      #${OVERLAY_ID}{position:fixed;z-index:58;display:flex;flex-direction:column;background:#111111;color:#e6e6e6;box-sizing:border-box;overflow:hidden;font-size:12px;font-weight:400;user-select:none}
      #${OVERLAY_ID} *{box-sizing:border-box}
      #${OVERLAY_ID} button{font:inherit;font-size:12px;font-weight:400;line-height:1;cursor:pointer;border:0;outline:none;transition:none}
      #${OVERLAY_ID} button:focus,#${OVERLAY_ID} button:focus-visible{outline:none;box-shadow:none}
      .nf-vfe-stage{flex:1 1 auto;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden}
      .nf-vfe-stage canvas{display:block;max-width:100%;max-height:100%;background:transparent}
      .nf-vfe-bar{flex:0 0 36px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#161616;border-top:1px solid #242424;color:#bdbdbd;font-size:11px;white-space:nowrap}
      .nf-vfe-bar button{width:28px;height:26px;border-radius:6px;background:rgba(255,255,255,.05);color:#e6e6e6;display:inline-flex;align-items:center;justify-content:center;padding:0}
      .nf-vfe-bar button:hover{background:rgba(255,255,255,.1)}
      .nf-vfe-bar button svg{width:12px;height:12px;display:block}
      .nf-vfe-bar .nf-vfe-readout{color:#f0f0f0;font-size:12px;font-weight:500;margin-left:4px}
      .nf-vfe-bar .nf-vfe-meta{color:#8d8d8d}
      .nf-vfe-strip{flex:0 0 ${THUMB_HEIGHT + 50}px;display:flex;align-items:flex-start;gap:4px;padding:6px 10px 2px;overflow-x:auto;overflow-y:hidden;background:#161616;border-top:1px solid #242424;scrollbar-width:thin;scroll-behavior:auto}
      .nf-vfe-cell{flex:0 0 auto;position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:4px;border-radius:6px;border:0;background:transparent;color:#9a9a9a;font-size:10px;line-height:1;cursor:pointer}
      .nf-vfe-cell canvas{display:block;height:${THUMB_HEIGHT}px;border-radius:3px;background:#000;pointer-events:none}
      .nf-vfe-cell:hover{background:rgba(255,255,255,.06)}
      .nf-vfe-cell::after{content:"";position:absolute;inset:0;border-radius:6px;border:2px solid transparent;pointer-events:none}
      .nf-vfe-cell[data-selected="1"]{background:rgba(30,166,114,.16);color:#effcf5}
      .nf-vfe-cell[data-selected="1"]::after{border-color:${ACCENT}}
      .nf-vfe-cell[data-current="1"]{background:rgba(30,166,114,.34)}
      .nf-vfe-cell[data-current="1"]::after{border-color:#5fe0ad}
      .nf-vfe-cell[data-dup="1"] span::after{content:" ·";color:${ACCENT}}
      [${PANEL_ATTR}="1"]{display:grid;gap:6px;padding:4px 10px 10px 10px;color:#d4d4d4;font-size:12px;font-weight:400}
      [${PANEL_ATTR}="1"] .nf-vfe-info{font-size:11px;color:#8d8d8d;line-height:1.5;padding:0 2px}
      [${PANEL_ATTR}="1"] .nf-vfe-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      [${PANEL_ATTR}="1"] .nf-vfe-grid button[data-act="reset"]{grid-column:1 / -1}
      [${PANEL_ATTR}="1"] button{height:30px;padding:0 8px;border:0;border-radius:6px;background:#2a2a2a;color:#e6e6e6;font:inherit;font-size:12px;font-weight:400;line-height:1;cursor:pointer;outline:none;white-space:nowrap;transition:none}
      [${PANEL_ATTR}="1"] button:hover{background:#333333}
      [${PANEL_ATTR}="1"] button:disabled{opacity:.4;cursor:default;background:#2a2a2a}
      [${PANEL_ATTR}="1"] button:focus,[${PANEL_ATTR}="1"] button:focus-visible{outline:none;box-shadow:none}
      [${PANEL_ATTR}="1"] .nf-vfe-apply{height:34px;background:${ACCENT};color:#effcf5;font-weight:500}
      [${PANEL_ATTR}="1"] .nf-vfe-apply:hover{background:#23b57d}
      [${PANEL_ATTR}="1"] .nf-vfe-status{min-height:14px;font-size:11px;color:#8d8d8d;line-height:1.4;padding:0 2px}
      [${PANEL_ATTR}="1"] .nf-vfe-status[data-tone="error"]{color:#e07a7a}
    `
    document.head.appendChild(style)
  }

  // ---- the stage ---------------------------------------------------------
  function findViewport() {
    return document.querySelector('[data-novaflow-ai-preview-viewport="1"]') || document.querySelector('[data-novaflow-ai-main-stage="1"]')
  }
  function findStageVideo(viewport) {
    if (!(viewport instanceof HTMLElement)) return null
    return Array.from(viewport.querySelectorAll('video')).find((video) => {
      if (!(video instanceof HTMLVideoElement)) return false
      if (video.closest('[data-novaflow-ai-resource-card="1"], [data-novaflow-ai-resource-sidebar-host="1"], [data-novaflow-ai-bottom-workspace="1"], #' + OVERLAY_ID)) return false
      if (!(video.currentSrc || video.src)) return false
      const rect = video.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }) || null
  }
  // The resource behind the stage video: the card whose own media carries the
  // same source (local clips share the object URL), else the card the bundle
  // outlines as selected; its label is the file name.
  function findSourceName(src) {
    const cards = Array.from(document.querySelectorAll('[data-novaflow-ai-resource-id]'))
    const cardName = (card) => String(card?.querySelector('div[style*="ellipsis"]')?.textContent || '').trim()
    const bySource = src ? cards.find((card) => Array.from(card.querySelectorAll('video, img')).some((media) => (media.currentSrc || media.src) === src)) : null
    const selected = bySource || cards.find((card) => /30,\s*166,\s*114|#1ea672/i.test(String(card.style?.borderColor || card.style?.border || '')))
    const name = cardName(selected)
    if (name) return name
    const fromUrl = /^https?:/.test(src) ? decodeURIComponent(src.split('?')[0].split('/').pop() || '') : ''
    return fromUrl || 'video'
  }
  function readDockFps() {
    const input = document.querySelector('[data-novaflow-ai-bottom-workspace="1"] [data-novaflow-ai-timeline-edit-group-locked] input:not([type="range"]):not([type="checkbox"])')
    const value = Number(input instanceof HTMLInputElement ? input.value : 0)
    return Number.isFinite(value) && value > 0 ? clamp(Math.round(value), 1, 120) : 0
  }
  function notify(message) {
    try { window.alert(String(message)) } catch (_) {}
  }
  function emitState() {
    try { window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: { open: state.open, busy: state.busy } })) } catch (_) {}
  }

  // ---- frames ------------------------------------------------------------
  function pngBlob(index) {
    return new Blob([state.frames[index]], { type: 'image/png' })
  }
  // The viewer bitmaps' long edge: the cap, lowered until every frame of the clip fits
  // the cache budget together (a looping preview must never re-decode).
  function viewLongEdge() {
    const long = Math.max(state.width, state.height)
    const frames = state.frames ? state.frames.length : 1
    if (!long) return VIEW_LONG_EDGE
    let edge = Math.min(long, VIEW_LONG_EDGE)
    const bytesAt = (value) => { const scale = value / long; return Math.round(state.width * scale) * Math.round(state.height * scale) * 4 }
    while (edge > 480 && bytesAt(edge) * frames > VIEW_CACHE_BYTES) edge = Math.round(edge * 0.85)
    return edge
  }
  function viewOptions() {
    const long = Math.max(state.width, state.height)
    const edge = state.viewEdge || VIEW_LONG_EDGE
    if (!long || long <= edge) return {}
    const scale = edge / long
    return { resizeWidth: Math.max(1, Math.round(state.width * scale)), resizeHeight: Math.max(1, Math.round(state.height * scale)), resizeQuality: 'medium' }
  }
  function rememberBitmap(index, bitmap) {
    if (!state.frames || state.full.has(index)) { try { if (!state.frames) bitmap.close?.() } catch (_) {} return state.full.get(index) || bitmap }
    state.full.set(index, bitmap)
    state.fullBytes += bitmap.width * bitmap.height * 4
    while (state.fullBytes > VIEW_CACHE_BYTES && state.full.size > 2) {
      const oldest = state.full.keys().next().value
      const gone = state.full.get(oldest)
      state.full.delete(oldest)
      state.fullBytes -= gone.width * gone.height * 4
      try { gone.close?.() } catch (_) {}
    }
    return bitmap
  }
  async function fullBitmap(index) {
    const cached = state.full.get(index)
    if (cached) { state.full.delete(index); state.full.set(index, cached); return cached }
    const bitmap = await createImageBitmap(pngBlob(index), viewOptions())
    return rememberBitmap(index, bitmap)
  }
  // The frames after the current one decode ahead of the playhead.
  function prefetch(position, count) {
    const model = state.model
    if (!model || !state.frames) return
    for (let step = 1; step <= count; step += 1) {
      const source = model.sourceAt((position + step) % model.length)
      if (state.full.has(source) || state.prefetching.has(source)) continue
      state.prefetching.add(source)
      createImageBitmap(pngBlob(source), viewOptions())
        .then((bitmap) => { if (state.frames) rememberBitmap(source, bitmap); else bitmap.close?.() })
        .catch(() => {})
        .finally(() => state.prefetching.delete(source))
    }
  }
  async function buildThumbs(frames) {
    const thumbs = new Array(frames.length)
    for (let start = 0; start < frames.length; start += 8) {
      const batch = []
      for (let index = start; index < Math.min(frames.length, start + 8); index += 1) {
        batch.push(createImageBitmap(new Blob([frames[index]], { type: 'image/png' }), { resizeHeight: THUMB_HEIGHT, resizeQuality: 'low' }).then((bitmap) => { thumbs[index] = bitmap }))
      }
      await Promise.all(batch)
    }
    return thumbs
  }
  function releaseBitmaps() {
    for (const bitmap of state.thumbs || []) { try { bitmap?.close?.() } catch (_) {} }
    for (const bitmap of state.full.values()) { try { bitmap?.close?.() } catch (_) {} }
    state.thumbs = null
    state.full = new Map()
    state.fullBytes = 0
    state.prefetching = new Set()
    state.frames = null
  }

  // ---- rendering ---------------------------------------------------------
  async function drawCurrent() {
    const els = state.els
    const model = state.model
    if (!els || !model || !state.frames) return
    const position = clamp(state.current, 0, model.length - 1)
    const source = model.sourceAt(position)
    const token = ++state.drawToken
    const bitmap = await fullBitmap(source)
    if (token !== state.drawToken || !state.els) return
    const canvas = els.canvas
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) { canvas.width = bitmap.width; canvas.height = bitmap.height }
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0)
    els.readout.textContent = `第 ${position + 1} 帧 / ${model.length}`
    prefetch(position, state.playing ? 6 : 2)
  }
  // The strip turns a page when the current cell leaves the view: the cell becomes the
  // first visible one, so the frames that follow need no scrolling until the page is
  // used up (scrolling on every frame was what stalled playback past the first screen).
  function revealCurrentCell() {
    const strip = state.els?.strip
    const cell = strip?.children?.[state.current]
    if (!(cell instanceof HTMLElement)) return
    const stripRect = strip.getBoundingClientRect()
    const rect = cell.getBoundingClientRect()
    if (rect.left >= stripRect.left && rect.right <= stripRect.right) return
    strip.scrollLeft += rect.left - stripRect.left - 10
  }
  // Playback moves only the current mark between two cells; the strip is not rebuilt.
  function markCurrentCell(previous) {
    const strip = state.els?.strip
    if (!strip) return
    const before = strip.children[previous]
    if (before instanceof HTMLElement) before.setAttribute('data-current', '0')
    const now = strip.children[state.current]
    if (now instanceof HTMLElement) now.setAttribute('data-current', '1')
    revealCurrentCell()
  }
  function renderStrip() {
    const els = state.els
    const model = state.model
    if (!els || !model) return
    const strip = els.strip
    const order = model.order
    const seen = new Map()
    for (const source of order) seen.set(source, (seen.get(source) || 0) + 1)
    while (strip.children.length > order.length) strip.lastElementChild.remove()
    for (let position = 0; position < order.length; position += 1) {
      let cell = strip.children[position]
      if (!(cell instanceof HTMLElement)) {
        cell = document.createElement('button')
        cell.type = 'button'
        cell.className = 'nf-vfe-cell'
        cell.appendChild(document.createElement('canvas'))
        cell.appendChild(document.createElement('span'))
        strip.appendChild(cell)
      }
      const source = order[position]
      cell.setAttribute('data-pos', String(position))
      if (cell.getAttribute('data-source') !== String(source)) {
        cell.setAttribute('data-source', String(source))
        const thumb = state.thumbs?.[source]
        const canvas = cell.firstElementChild
        if (thumb && canvas instanceof HTMLCanvasElement) {
          canvas.width = thumb.width
          canvas.height = thumb.height
          canvas.getContext('2d').drawImage(thumb, 0, 0)
        }
      }
      cell.lastElementChild.textContent = String(position + 1)
      cell.setAttribute('data-selected', model.isSelected(position) ? '1' : '0')
      cell.setAttribute('data-current', position === state.current ? '1' : '0')
      cell.setAttribute('data-dup', seen.get(source) > 1 ? '1' : '0')
      cell.title = `第 ${position + 1} 帧（源帧 ${source + 1}）`
    }
  }
  function renderPanel() {
    const els = state.els
    const model = state.model
    if (!els || !model) return
    const count = model.selection.length
    els.info.textContent = `${model.length} 帧 · ${state.fps || '?'} fps · ${state.width}×${state.height}${state.alpha ? ' · 透明' : ''}${count ? ` · 选中 ${count} 帧` : ''}`
    els.buttons.undo.disabled = !model.canUndo
    els.buttons.redo.disabled = !model.canRedo
    els.buttons.reset.disabled = !model.dirty
    els.buttons.remove.disabled = !count || count >= model.length
    els.buttons.duplicate.disabled = !count
    els.buttons.left.disabled = !count || model.selection[0] === 0
    els.buttons.right.disabled = !count || model.selection[count - 1] === model.length - 1
    els.buttons.mirror.disabled = count < 2
    els.apply.disabled = state.busy || !model.dirty
    els.meta.textContent = `${state.fps || '?'} fps`
  }
  function renderAll() {
    renderStrip()
    renderPanel()
    void drawCurrent()
  }
  function scrollCurrentIntoView() {
    revealCurrentCell()
  }

  // ---- operations --------------------------------------------------------
  function afterEdit(changed) {
    if (!changed) return
    const model = state.model
    const selection = model.selection
    state.current = clamp(selection.length ? selection[0] : state.current, 0, model.length - 1)
    state.anchor = state.current
    renderAll()
    scrollCurrentIntoView()
  }
  function setCurrent(position, mode) {
    const model = state.model
    if (!model) return
    const target = clamp(Math.trunc(position), 0, model.length - 1)
    if (mode === 'range') model.selectRange(state.anchor, target)
    else if (mode === 'toggle') { model.toggle(target); state.anchor = target }
    else { model.select(target); state.anchor = target }
    state.current = target
    renderAll()
  }
  function stopPlayback() {
    state.playing = false
    if (state.playTimer) { window.clearTimeout(state.playTimer); state.playTimer = 0 }
    if (state.els) state.els.play.innerHTML = ICON_PLAY
  }
  function togglePlayback() {
    if (state.playing) { stopPlayback(); return }
    const model = state.model
    if (!model || model.length < 2) return
    state.playing = true
    state.els.play.innerHTML = ICON_PAUSE
    const interval = 1000 / (state.fps || 16)
    let last = performance.now()
    const tick = () => {
      if (!state.playing || !state.model) return
      const now = performance.now()
      const steps = Math.max(1, Math.floor((now - last) / interval))
      last += steps * interval
      const previous = state.current
      state.current = (state.current + steps) % state.model.length
      void drawCurrent()
      markCurrentCell(previous)
      state.playTimer = window.setTimeout(tick, Math.max(0, last + interval - performance.now()))
    }
    state.playTimer = window.setTimeout(tick, interval)
  }

  const ICON_PLAY = '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M2.5 1.5v9l8-4.5z"/></svg>'
  const ICON_PAUSE = '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1.5" width="3" height="9"/><rect x="7" y="1.5" width="3" height="9"/></svg>'
  const ICON_PREV = '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M8.5 1.5v9l-6-4.5z"/></svg>'
  const ICON_NEXT = '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M3.5 1.5v9l6-4.5z"/></svg>'

  // ---- DOM ---------------------------------------------------------------
  function mountOverlay() {
    let overlay = document.getElementById(OVERLAY_ID)
    if (overlay) overlay.remove()
    overlay = document.createElement('div')
    overlay.id = OVERLAY_ID
    overlay.setAttribute('data-novaflow-runtime-ignore', '1')
    overlay.setAttribute('data-preview-ui', '1')
    overlay.innerHTML = `
      <div class="nf-vfe-stage"><canvas></canvas></div>
      <div class="nf-vfe-bar">
        <button type="button" data-act="first" title="第一帧">${ICON_PREV}</button>
        <button type="button" data-act="play" title="播放 / 暂停">${ICON_PLAY}</button>
        <button type="button" data-act="last" title="最后一帧">${ICON_NEXT}</button>
        <span class="nf-vfe-readout"></span>
        <span class="nf-vfe-meta"></span>
        <span class="nf-vfe-meta">点选一帧，Shift 连选一段，Ctrl 加选</span>
      </div>
      <div class="nf-vfe-strip"></div>`
    document.body.appendChild(overlay)
    const strip = overlay.querySelector('.nf-vfe-strip')
    overlay.querySelector('[data-act="first"]').addEventListener('click', () => { stopPlayback(); setCurrent(0); scrollCurrentIntoView() })
    overlay.querySelector('[data-act="last"]').addEventListener('click', () => { stopPlayback(); setCurrent(state.model.length - 1); scrollCurrentIntoView() })
    overlay.querySelector('[data-act="play"]').addEventListener('click', togglePlayback)
    strip.addEventListener('pointerdown', (event) => {
      const cell = event.target instanceof Element ? event.target.closest('.nf-vfe-cell') : null
      if (!cell) return
      event.preventDefault()
      stopPlayback()
      const position = Number(cell.getAttribute('data-pos'))
      setCurrent(position, event.shiftKey ? 'range' : (event.ctrlKey || event.metaKey) ? 'toggle' : 'single')
      state.dragging = true
    })
    strip.addEventListener('pointermove', (event) => {
      if (!state.dragging || !(event.buttons & 1)) return
      const cell = event.target instanceof Element ? event.target.closest('.nf-vfe-cell') : null
      if (!cell) return
      const position = Number(cell.getAttribute('data-pos'))
      if (position !== state.current) setCurrent(position, 'range')
    })
    strip.addEventListener('wheel', (event) => {
      // The strip scrolls sideways with a plain wheel.
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) { strip.scrollLeft += event.deltaY; event.preventDefault() }
    }, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    return {
      overlay,
      canvas: overlay.querySelector('canvas'),
      readout: overlay.querySelector('.nf-vfe-readout'),
      meta: overlay.querySelector('.nf-vfe-meta'),
      play: overlay.querySelector('[data-act="play"]'),
      strip
    }
  }
  function onPointerUp() { state.dragging = false }

  function mountPanel(postSection) {
    const section = postSection instanceof HTMLElement ? postSection : document.querySelector('[data-novaflow-ai-post-section="1"]')
    if (!(section instanceof HTMLElement)) return null
    let panel = section.querySelector(`[${PANEL_ATTR}="1"]`)
    if (panel) panel.remove()
    panel = document.createElement('div')
    panel.setAttribute(PANEL_ATTR, '1')
    panel.setAttribute('data-novaflow-runtime-ignore', '1')
    const button = (act, label) => `<button type="button" data-act="${act}">${label}</button>`
    panel.innerHTML = `
      <div class="nf-vfe-info"></div>
      <div class="nf-vfe-grid">
        ${button('remove', '删除')}${button('duplicate', '复制插帧')}
        ${button('left', '左移')}${button('right', '右移')}
        ${button('mirror', '镜像')}${button('all', '全选')}
        ${button('undo', '撤销')}${button('redo', '重做')}
        ${button('reset', '还原')}
      </div>
      <button type="button" class="nf-vfe-apply" data-act="apply">生成新资源</button>
      <button type="button" data-act="close">关闭</button>
      <div class="nf-vfe-status"></div>`
    section.appendChild(panel)
    panel.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('button[data-act]') : null
      if (!button || button.disabled) return
      event.preventDefault()
      event.stopPropagation()
      runAction(button.getAttribute('data-act'))
    })
    const pick = (act) => panel.querySelector(`button[data-act="${act}"]`)
    return {
      panel,
      info: panel.querySelector('.nf-vfe-info'),
      status: panel.querySelector('.nf-vfe-status'),
      apply: pick('apply'),
      buttons: { remove: pick('remove'), duplicate: pick('duplicate'), left: pick('left'), right: pick('right'), mirror: pick('mirror'), undo: pick('undo'), redo: pick('redo'), reset: pick('reset'), all: pick('all') }
    }
  }
  function setStatus(message, tone) {
    const status = state.els?.status
    if (!status) return
    status.textContent = String(message || '')
    if (tone) status.setAttribute('data-tone', tone)
    else status.removeAttribute('data-tone')
  }

  function runAction(act) {
    const model = state.model
    if (!model || state.busy) return
    stopPlayback()
    switch (act) {
      case 'remove': afterEdit(model.remove()); break
      case 'duplicate': afterEdit(model.duplicate()); break
      case 'left': afterEdit(model.move(-1)); break
      case 'right': afterEdit(model.move(1)); break
      case 'mirror': afterEdit(model.mirror()); break
      case 'undo': afterEdit(model.undo()); break
      case 'redo': afterEdit(model.redo()); break
      case 'reset': afterEdit(model.reset()); break
      case 'all': model.selectAll(); renderAll(); break
      case 'apply': void apply(); break
      case 'close': close(); break
      default: break
    }
  }

  // Registered on window at load, before the bundle's own capture listeners (its
  // editor swallows Ctrl+Z / Ctrl+Y there), so the shortcuts reach the tool while
  // it is open; a handled key goes no further.
  function onKeyDown(event) {
    if (!state.open || state.busy) return
    const target = event.target
    if (target instanceof HTMLElement && (target.matches('input, textarea, select, [contenteditable="true"]') || target.isContentEditable)) return
    const model = state.model
    if (!model) return
    const ctrl = event.ctrlKey || event.metaKey
    const key = String(event.key || '')
    const handled = () => { event.preventDefault(); event.stopImmediatePropagation() }
    if (ctrl && key.toLowerCase() === 'z') { handled(); runAction(event.shiftKey ? 'redo' : 'undo'); return }
    if (ctrl && key.toLowerCase() === 'y') { handled(); runAction('redo'); return }
    if (ctrl && key.toLowerCase() === 'a') { handled(); runAction('all'); return }
    if (key === 'Delete' || key === 'Backspace') { handled(); runAction('remove'); return }
    if (key === ' ') { handled(); togglePlayback(); return }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      handled()
      stopPlayback()
      setCurrent(state.current + (key === 'ArrowLeft' ? -1 : 1), event.shiftKey ? 'range' : 'single')
      scrollCurrentIntoView()
    }
  }
  window.addEventListener('keydown', onKeyDown, true)

  // The overlay sits on the stage: its box follows the viewport on a short timer
  // (a hidden tab stops animation frames, not timers) and the tool closes when the
  // stage goes (another section, the page rebuilt).
  function track() {
    if (!state.open) return
    const viewport = state.viewport
    if (!(viewport instanceof HTMLElement) || !viewport.isConnected || !document.body.classList.contains('novaflow-primary-target-animation')) { close(); return }
    // The runtime publishes the media area of the stage (under the canvas bar, above
    // the dock, left of the resource list) as the effective-rect variables; the
    // overlay takes exactly that box, the whole viewport when they are missing.
    const rect = viewport.getBoundingClientRect()
    const vars = getComputedStyle(viewport)
    const read = (name) => { const value = parseFloat(vars.getPropertyValue(name)); return Number.isFinite(value) ? value : NaN }
    const effLeft = read('--novaflow-ai-sequence-effective-left')
    const effTop = read('--novaflow-ai-sequence-effective-top')
    const effWidth = read('--novaflow-ai-sequence-effective-width')
    const effHeight = read('--novaflow-ai-sequence-effective-height')
    // The dock is hidden while the tool is open (BODY_ATTR), so the box runs from the
    // effective top to the viewport's bottom, above the dock only if one is still shown.
    const dock = document.querySelector('[data-novaflow-ai-bottom-workspace="1"]')
    const dockRect = dock instanceof HTMLElement ? dock.getBoundingClientRect() : null
    const bottom = dockRect && dockRect.height > 0 && dockRect.top > rect.top ? Math.min(rect.bottom, dockRect.top) : rect.bottom
    const box = effWidth > 120 && effHeight > 120
      ? { left: rect.left + (effLeft || 0), top: rect.top + (effTop || 0), width: effWidth, height: Math.max(120, bottom - (rect.top + (effTop || 0))) }
      : { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    const key = [box.left, box.top, box.width, box.height].map((value) => Math.round(value)).join(',')
    if (key !== state.lastRect) {
      state.lastRect = key
      const style = state.overlay.style
      style.left = `${Math.round(box.left)}px`
      style.top = `${Math.round(box.top)}px`
      style.width = `${Math.round(box.width)}px`
      style.height = `${Math.round(box.height)}px`
    }
  }

  // ---- lifecycle ---------------------------------------------------------
  async function open(options = {}) {
    if (state.open) return true
    if (state.busy) return false
    const coreApi = core()
    const bridge = api()
    if (!coreApi?.createModel) { notify('帧编辑组件未加载，请刷新网页后重试。'); return false }
    if (!bridge?.exportDecodeVideoFrames || !bridge.exportCreateTempDir || !bridge.exportEncodeFramesToVideo || !bridge.writeBinaryFile) { notify('当前环境不支持帧编辑。'); return false }
    const viewport = findViewport()
    const video = findStageVideo(viewport)
    if (!video) { notify('请先把视频加载到画板，再进入帧编辑。'); return false }
    const src = video.currentSrc || video.src
    state.busy = true
    emitState()
    try {
      const sourceName = findSourceName(src)
      const fps = readDockFps()
      const result = await bridge.exportDecodeVideoFrames({ sourceUrl: src, fileName: sourceName, fps, maxFrames: MAX_FRAMES })
      if (!result?.ok || !Array.isArray(result.frames) || !result.frames.length) throw new Error(result?.error || '读取画板视频的帧失败')
      const frames = result.frames
      const thumbs = await buildThumbs(frames)
      const first = await createImageBitmap(new Blob([frames[0]], { type: 'image/png' }))
      state.frames = frames
      state.thumbs = thumbs
      state.full = new Map([[0, first]])
      state.fps = Number(result.fps) || fps || 16
      state.width = first.width
      state.height = first.height
      state.alpha = Boolean(result.alpha)
      state.viewEdge = viewLongEdge()
      state.sourceName = sourceName
      state.model = coreApi.createModel(frames.length)
      state.current = 0
      state.anchor = 0
      state.viewport = viewport
      try { video.pause() } catch (_) {}
      installStyle()
      const overlayEls = mountOverlay()
      const panelEls = mountPanel(options.postSection)
      state.overlay = overlayEls.overlay
      state.panel = panelEls?.panel || null
      state.els = Object.assign({}, overlayEls, panelEls || { info: document.createElement('div'), status: document.createElement('div'), apply: document.createElement('button'), buttons: {} })
      if (!panelEls) state.els.buttons = { remove: {}, duplicate: {}, left: {}, right: {}, mirror: {}, undo: {}, redo: {}, reset: {}, all: {} }
      state.open = true
      state.lastRect = ''
      document.body.setAttribute(BODY_ATTR, '1')
      track()
      state.timer = window.setInterval(track, 120)
      window.addEventListener('resize', track)
      renderAll()
      setStatus(frames.length >= MAX_FRAMES ? `只读取了前 ${MAX_FRAMES} 帧` : '')
      return true
    } catch (error) {
      releaseBitmaps()
      state.model = null
      notify(String(error?.message || error || '帧编辑打开失败'))
      return false
    } finally {
      state.busy = false
      emitState()
    }
  }

  function close() {
    if (!state.open) return false
    stopPlayback()
    state.open = false
    document.body.removeAttribute(BODY_ATTR)
    if (state.timer) { window.clearInterval(state.timer); state.timer = 0 }
    window.removeEventListener('resize', track)
    window.removeEventListener('pointerup', onPointerUp)
    try { state.overlay?.remove() } catch (_) {}
    try { state.panel?.remove() } catch (_) {}
    state.overlay = null
    state.panel = null
    state.els = null
    state.viewport = null
    state.model = null
    releaseBitmaps()
    emitState()
    return true
  }

  function toggle(options = {}) {
    return state.open ? Promise.resolve(close()) : open(options)
  }

  // 生成新资源: the frames in their edited order become a clip that joins the
  // 资源列表 through the page's own upload input (the bundle adds it and loads it
  // to the stage); the source resource stays.
  async function apply() {
    const model = state.model
    const bridge = api()
    if (!model || state.busy || !state.frames) return false
    state.busy = true
    renderPanel()
    emitState()
    setStatus('正在生成…')
    let dir = ''
    try {
      const created = await bridge.exportCreateTempDir({ prefix: 'novaflow_frame_edit_' })
      if (!created?.ok || !created.dir) throw new Error(created?.error || '创建临时目录失败')
      dir = String(created.dir)
      const order = model.order
      for (let position = 0; position < order.length; position += 1) {
        const written = await bridge.writeBinaryFile({ dir, fileName: `NF_${String(position).padStart(5, '0')}.png`, bytes: state.frames[order[position]] })
        if (written?.ok === false) throw new Error(written?.error || '写入帧失败')
        if (position % 16 === 0) setStatus(`正在整理帧 ${position + 1} / ${order.length}…`)
      }
      const name = core().outputFileName(state.sourceName, state.alpha)
      setStatus('正在编码…')
      const encoded = await bridge.exportEncodeFramesToVideo({
        dir, pattern: 'NF_%05d.png', fps: state.fps, width: state.width, height: state.height,
        format: state.alpha ? 'webm' : 'mp4', keepAlpha: state.alpha, outPath: name, returnBase64: true,
        novaflowTrace: { tool: 'frame-edit', source: 'apply', kind: 'frame-edit-clip' }
      })
      if (!encoded?.ok) throw new Error(encoded?.error || '编码失败')
      const base64 = String(encoded.base64 || '')
      if (!base64) throw new Error('编码结果为空')
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      const file = new File([bytes], name, { type: encoded.mimeType || (state.alpha ? 'video/webm' : 'video/mp4') })
      if (!addToResourceList(file)) throw new Error('资源列表不可用，结果已存入仓库')
      close()
      return true
    } catch (error) {
      setStatus(String(error?.message || error || '生成失败'), 'error')
      return false
    } finally {
      if (dir) { try { await bridge.exportCleanupDir?.({ dir }) } catch (_) {} }
      state.busy = false
      if (state.open) renderPanel()
      emitState()
    }
  }
  function addToResourceList(file) {
    const input = document.getElementById('novaflow-ai-sequence-upload-input')
    if (!(input instanceof HTMLInputElement) || typeof DataTransfer !== 'function') return false
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  window.NovaFlowVideoFrameEditTool = Object.freeze({
    isOpen: () => state.open,
    isBusy: () => state.busy,
    open,
    close,
    toggle,
    apply,
    get model() { return state.model }
  })
})()
