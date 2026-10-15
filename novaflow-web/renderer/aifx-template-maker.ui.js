// AI 特效 · 模板制作 —— 编辑窗口。2026-10-15 接入正式链（AI 特效「特效模板」区的「模板制作」，骨骼动画「特效扫光」也用这里的 renderProject）。
// AI 特效 · 模板编辑器 窗口（测试链）。依赖 NovaFlowFxMaker（核心）、NovaFlowFxMp4（编码），渲染在 Worker 里。
// NovaFlowFxMakerUI.open({ project, title, name, onUse, onSaveWarehouse, onSaveTemplate, onClose })；NovaFlowFxMakerUI.renderProject({ project, base })
//   回调拿到 (blob, info)：info = { name, project, ai, width, height, frames, fps }

;(function (root) {
  'use strict'
  const FX = () => root.NovaFlowFxMaker
  const STYLE_ID = 'fxm-style'
  const GREEN = '#1EA672'

  const CSS = `
.fxm-overlay{position:fixed;inset:0;z-index:2147483630;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:"Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif;font-size:12px;color:#d6d6d6}
.fxm-window{width:min(1320px,97vw);height:min(860px,95vh);background:#1F1F1F;border:1px solid #2E2E2E;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.45);display:flex;flex-direction:column;overflow:hidden;position:relative}
.fxm-head{height:44px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 16px;border-bottom:1px solid #2A2A2A}
.fxm-title{font-size:14px;font-weight:600;color:#f0f0f0}
.fxm-x{width:24px;height:24px;border:0;border-radius:7px;background:transparent;color:rgba(238,244,252,.6);font-size:16px;line-height:24px;cursor:pointer;padding:0}
.fxm-x:hover{background:rgba(255,255,255,.08);color:#fff}
.fxm-body{flex:1;min-height:0;display:grid;grid-template-columns:184px minmax(0,1fr) 284px}
.fxm-effects{border-right:1px solid #2A2A2A;overflow-y:auto;padding:6px 0 12px}
.fxm-group{display:flex;align-items:center;gap:6px;width:100%;border:0;background:transparent;font:inherit;font-size:11px;color:#7d8186;padding:10px 14px 4px;cursor:pointer;text-align:left}
.fxm-group:hover{color:#d6d6d6}
.fxm-group i{width:0;height:0;border-left:4px solid currentColor;border-top:3.5px solid transparent;border-bottom:3.5px solid transparent;transition:transform .12s}
.fxm-group[data-open="1"] i{transform:rotate(90deg)}
.fxm-group b{margin-left:auto;font-weight:400;color:#5c6064}
.fxm-fx{display:block;width:100%;text-align:left;border:0;background:transparent;color:#c9c9c9;font:inherit;font-size:12px;padding:6px 14px 6px 32px;cursor:pointer}
.fxm-fx:hover{background:#2A2A2A;color:#fff}
.fxm-fx[data-needs-base="1"]{color:#6f7479}
.fxm-fx[data-on="1"]{box-shadow:inset 2px 0 0 ${GREEN};color:#fff}
.fxm-center{display:flex;flex-direction:column;min-width:0;min-height:0}
.fxm-tools{flex:none;display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:10px 12px 0}
.fxm-tools .fxm-sep{width:1px;height:18px;background:#333;margin:0 4px}
.fxm-btn{height:26px;padding:0 10px;border:0;border-radius:6px;background:#2B2B2B;color:#d6d6d6;font:inherit;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap}
.fxm-btn:hover{background:#373737;color:#fff}
.fxm-btn[data-on="1"]{background:${GREEN};color:#fff}
.fxm-btn:disabled{opacity:.4;cursor:default;background:#2B2B2B;color:#d6d6d6}
.fxm-btn.fxm-primary{background:${GREEN};color:#fff;font-weight:600}
.fxm-btn.fxm-primary:hover{background:#22b97f}
.fxm-hint{flex:none;font-size:11px;color:#7d8186;padding:6px 12px 0;min-height:16px}
.fxm-stage{flex:1;min-height:0;position:relative;margin:8px 12px 0;background:#141414;border-radius:6px;overflow:hidden}
.fxm-board{position:absolute;background:#000;box-shadow:0 0 0 1px #2E2E2E}
.fxm-board canvas,.fxm-board svg{position:absolute;inset:0;width:100%;height:100%}
.fxm-board .fxm-fxcanvas{mix-blend-mode:screen}
.fxm-board svg{overflow:visible;touch-action:none}
.fxm-board svg *{pointer-events:none}
.fxm-board svg [data-h]{pointer-events:all;cursor:pointer}
.fxm-transport{flex:none;display:flex;align-items:center;gap:10px;padding:8px 12px 10px}
.fxm-play{width:28px;height:26px;border:0;border-radius:6px;background:#2B2B2B;color:#fff;cursor:pointer;font-size:11px}
.fxm-play:hover{background:#373737}
.fxm-scrub{flex:1}
.fxm-time{font-size:11px;color:#9a9ea3;min-width:150px;text-align:right}
.fxm-params{border-left:1px solid #2A2A2A;overflow-y:auto;padding:4px 14px 16px}
.fxm-sec{padding:10px 0 4px;border-bottom:1px solid #262626}
.fxm-sec:last-child{border-bottom:0}
.fxm-sec-title{font-size:13px;font-weight:500;color:#eee;margin:2px 0 8px}
.fxm-row{display:grid;grid-template-columns:56px minmax(0,1fr) 38px;align-items:center;gap:8px;min-height:26px}
.fxm-row label{color:#b9bcbf}
.fxm-row input[type=range],.fxm-scrub{-webkit-appearance:none;appearance:none;width:100%;height:3px;margin:0;padding:0;border:0;border-radius:3px;outline:0;box-shadow:none;background:linear-gradient(90deg,${GREEN} 0,${GREEN} var(--pct,0%),#3b3b3b var(--pct,0%),#3b3b3b 100%)}
.fxm-row input[type=range]::-webkit-slider-runnable-track,.fxm-scrub::-webkit-slider-runnable-track{-webkit-appearance:none;height:3px;background:transparent;border:0;box-shadow:none}
.fxm-row input[type=range]::-webkit-slider-thumb,.fxm-scrub::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:13px;height:13px;margin-top:-5px;border-radius:50%;background:${GREEN};border:0;box-shadow:none;cursor:pointer}
.fxm-row input[type=range]:disabled::-webkit-slider-thumb{background:#5a5a5a}
.fxm-num{width:72px;height:24px;background:#2B2B2B;border:0;border-radius:6px;color:#eee;font:inherit;font-size:12px;padding:0 4px 0 8px;box-sizing:border-box}
.fxm-num::-webkit-inner-spin-button{opacity:.4}
.fxm-row .fxm-val{font-size:11px;color:#9a9ea3;text-align:right}
.fxm-row[data-inert="1"]{opacity:.38}
.fxm-seg{display:flex;gap:4px;flex-wrap:wrap}
.fxm-seg .fxm-btn{height:24px;padding:0 8px}
.fxm-line{display:grid;grid-template-columns:56px minmax(0,1fr);align-items:center;gap:8px;min-height:28px}
.fxm-line>label{color:#b9bcbf}
.fxm-line[data-inert="1"]{opacity:.38}
.fxm-select{height:26px;background:#2B2B2B;color:#ddd;border:0;border-radius:6px;font:inherit;font-size:12px;padding:0 6px;width:100%}
.fxm-colour{width:30px;height:24px;border:0;padding:0;background:transparent;cursor:pointer}
.fxm-foot{flex:none;height:52px;display:flex;align-items:center;gap:8px;padding:0 14px;border-top:1px solid #2A2A2A}
.fxm-info{flex:1;font-size:11px;color:#7d8186;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.fxm-busy{position:absolute;inset:0;background:rgba(20,20,20,.72);display:flex;align-items:center;justify-content:center;z-index:5}
.fxm-busy>div{background:#1F1F1F;border:1px solid #2E2E2E;border-radius:8px;padding:18px 26px;min-width:260px;text-align:center;color:#eee}
.fxm-bar{height:4px;background:#333;border-radius:2px;margin-top:12px;overflow:hidden}
.fxm-bar>i{display:block;height:100%;width:0;background:${GREEN}}
.fxm-overlay :focus,.fxm-overlay :focus-visible{outline:none}
`

  const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (html) e.innerHTML = html; return e }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const clone = (v) => JSON.parse(JSON.stringify(v))
  const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : (Math.round(v * 100) / 100).toFixed(2))

  // ---------------------------------------------------------------- 渲染 Worker
  // 页面里脚本的地址（应用里带内容哈希 ?v=…）：按文件名在本页 / 外层页面的 <script src>（含 type="text/plain" 的占位）里找，找不到按 baseURI 拼
  const MAKER_SCRIPTS = ['sweep-light.core.js', 'aifx-template-maker.core.js', 'aifx-template-maker.fx.js']
  function scriptUrl(name) {
    const bare = (u) => String(u || '').split('#')[0].split('?')[0].replace(/^\.\//, '').split('/').pop()
    const docs = [document]
    try { if (window.parent && window.parent !== window && window.parent.document) docs.push(window.parent.document) } catch (_) {}
    for (const doc of docs) {
      for (const tag of doc.querySelectorAll('script[src]')) if (bare(tag.getAttribute('src')) === name) return new URL(tag.getAttribute('src'), doc.baseURI).href
    }
    return new URL('./' + name, document.baseURI).href
  }
  const defaultScriptUrls = () => MAKER_SCRIPTS.map(scriptUrl)
  const WORKER_SRC = `
let ctx = null, version = -1
const bases = new Map()
self.onmessage = (event) => {
  const msg = event.data || {}
  try {
    if (msg.type === 'base') { bases.clear(); if (msg.id) bases.set(msg.id, { w: msg.w, h: msg.h, data: msg.data }); return }
    if (msg.type === 'prepare') {
      version = msg.version
      const b = msg.project.base && bases.get(msg.project.base.id)
      ctx = self.NovaFlowFxMaker.prepare(msg.project, msg.scale, b || null)
      self.postMessage({ type: 'prepared', version, w: ctx.geo.W, h: ctx.geo.H })
      return
    }
    if (msg.type === 'frame') {
      if (!ctx || msg.version !== version) { self.postMessage({ type: 'skip', version: msg.version, index: msg.index }); return }
      const rgba = self.NovaFlowFxMaker.renderFrame(ctx, msg.index)
      self.postMessage({ type: 'frame', version, index: msg.index, w: ctx.geo.W, h: ctx.geo.H, rgba }, [rgba.buffer])
    }
  } catch (error) {
    self.postMessage({ type: 'error', version: msg.version, index: msg.index, message: String((error && error.stack) || error) })
  }
}
self.postMessage({ type: 'ready' })`
  function createWorker(urls) {
    const src = 'importScripts(' + (urls || defaultScriptUrls()).map((u) => JSON.stringify(u)).join(', ') + ');\n' + WORKER_SRC
    return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
  }

  /**
   * 一份工程整段渲染成 MP4（黑底）：几个 Worker 分帧画，WebCodecs 编码。编辑窗口的「用作素材 / 存入模板库」和
   * 骨骼动画「特效扫光」的「存入 AI 特效模板库」都走这里。base = 底图像素 { w, h, data }（工程里 project.base 是摆放参数）。
   */
  async function renderFrames({ project, base = null, scale = 1, scriptUrls, onProgress, workers: want } = {}) {
    const FXM = root.NovaFlowFxMaker, payload = clone({ ...project, base: project.base ? { ...project.base, data: undefined, id: base ? 1 : 0 } : null })
    const total = FXM.frameCount(payload), frames = new Array(total)
    let fw = 0, fh = 0
    const count = want || Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
    const workers = Array.from({ length: count }, () => createWorker(scriptUrls))
    let done = 0
    try {
      await new Promise((resolve, reject) => {
        let next = 0
        const give = (w) => { if (next >= total) return; const i = next++; w.postMessage({ type: 'frame', version: 1, index: i }) }
        for (const w of workers) {
          w.onmessage = (ev) => {
            const m = ev.data
            if (m.type === 'ready') { w.postMessage(base ? { type: 'base', id: 1, w: base.w, h: base.h, data: base.data } : { type: 'base', id: 0 }); w.postMessage({ type: 'prepare', version: 1, project: payload, scale }) }
            else if (m.type === 'prepared') give(w)
            else if (m.type === 'error') reject(new Error(m.message.split('\n')[0]))
            else if (m.type === 'frame') {
              frames[m.index] = m.rgba; fw = m.w; fh = m.h; done++
              if (onProgress) onProgress('render', done, total)
              if (done === total) resolve(); else give(w)
            }
          }
          w.onerror = (ev) => reject(new Error(ev.message || '渲染出错'))
        }
      })
    } finally { for (const w of workers) w.terminate() }
    return { frames, w: fw, h: fh }
  }
  async function renderProject({ project, base = null, scriptUrls, onProgress } = {}) {
    const FXM = root.NovaFlowFxMaker, s = FXM.canvasSize(project)
    const { frames } = await renderFrames({ project, base, scriptUrls, onProgress })
    const bytes = await root.NovaFlowFxMp4.encode({ width: s.w, height: s.h, fps: FXM.FPS, count: frames.length, frameAt: async (i) => frames[i], onProgress: (k, all) => { if (onProgress) onProgress('encode', k, all) } })
    return new Blob([bytes], { type: 'video/mp4' })
  }

  function open(options = {}) {
    if (!document.getElementById(STYLE_ID)) document.head.appendChild(el('style', { id: STYLE_ID }, CSS))
    const S = {
      opts: options,
      project: options.project ? clone(options.project) : FX().defaultProject(),
      version: 0, history: [], selected: null, drag: null, drawing: null,
      playing: true, playhead: 0, lastTick: 0, raf: 0,
      base: null, overlayGeo: null, exportCache: null, closed: false,
    }
    if (!S.project.motion) S.project.motion = { kind: 'none', amount: 1 }

    // ---------------------------------------------------------------- 骨架
    const overlay = el('div', { class: 'fxm-overlay' })
    overlay.innerHTML = `
      <div class="fxm-window" role="dialog" aria-label="模板编辑器">
        <div class="fxm-head"><div class="fxm-title">${esc(options.title || '模板制作')}</div><button class="fxm-x" data-act="close" type="button" title="关闭">×</button></div>
        <div class="fxm-body">
          <div class="fxm-effects" data-effects></div>
          <div class="fxm-center">
            <div class="fxm-tools" data-shapes></div>
            <div class="fxm-tools" data-basetools></div>
            <div class="fxm-hint" data-hint></div>
            <div class="fxm-stage" data-stage>
              <div class="fxm-board" data-board>
                <canvas data-basecanvas></canvas>
                <canvas class="fxm-fxcanvas" data-fxcanvas></canvas>
                <svg data-svg xmlns="http://www.w3.org/2000/svg"></svg>
              </div>
            </div>
            <div class="fxm-transport">
              <button class="fxm-play" data-act="play" type="button">❚❚</button>
              <input class="fxm-scrub" data-scrub type="range" min="0" max="38" step="1" value="0">
              <div class="fxm-time" data-time></div>
            </div>
          </div>
          <div class="fxm-params" data-params></div>
        </div>
        <div class="fxm-foot">
          <div class="fxm-info" data-info></div>
          ${options.onSaveTemplate ? '<button class="fxm-btn" data-act="save-template" type="button" title="存成模板，以后在模板库里点「编辑」还能接着改">存入模板库</button>' : ''}
          <button class="fxm-btn fxm-primary" data-act="use" type="button">用作素材</button>
        </div>
      </div>
      <input type="file" accept="image/*" data-basefile hidden>`
    document.body.appendChild(overlay)
    const $ = (sel) => overlay.querySelector(sel)
    const E = {
      effects: $('[data-effects]'), shapes: $('[data-shapes]'), basetools: $('[data-basetools]'), hint: $('[data-hint]'),
      stage: $('[data-stage]'), board: $('[data-board]'), baseCanvas: $('[data-basecanvas]'), fxCanvas: $('[data-fxcanvas]'), svg: $('[data-svg]'),
      play: $('[data-act="play"]'), scrub: $('[data-scrub]'), time: $('[data-time]'), params: $('[data-params]'),
      info: $('[data-info]'), file: $('[data-basefile]'), window: $('.fxm-window'),
    }

    // ---------------------------------------------------------------- 工程辅助
    const size = () => FX().canvasSize(S.project)
    const fx = () => FX().effectOf(S.project.effect)
    const n = () => FX().frameCount(S.project)
    const snapshot = () => { S.history.push(clone({ outlines: S.project.outlines, shape: S.project.shape, corner: S.project.corner, offset: S.project.offset, start: S.project.start })); if (S.history.length > 40) S.history.shift() }
    const undo = () => { const h = S.history.pop(); if (!h) return; Object.assign(S.project, h); changed() }
    const allPoints = () => S.project.outlines.flatMap((o) => o.points)
    function bbox(points = allPoints()) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
      if (!isFinite(x0)) { const s = size(); return { x: s.w * 0.25, y: s.h * 0.25, w: s.w * 0.5, h: s.h * 0.5 } }
      return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
    }
    function curves() { return FX().outlinePolylines(S.project) }
    // 默认起点：第一条控制边的中点（不压在控制点上，免得起点标记挡住点）
    function defaultStart() { const o = S.project.outlines[0]; if (!o || o.points.length < 2) { const b = bbox(); return { x: b.x + b.w / 2, y: b.y } } const a = o.points[0], c = o.points[1]; return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 } }

    // ---------------------------------------------------------------- 预览渲染（2 个 Worker，半分辨率）
    const pool = []
    const preview = { scale: 0.5, version: -1, frames: new Map(), next: new Map(), pending: new Set(), w: 0, h: 0, timer: 0 }
    function makeWorker() {
      const w = createWorker(options.scriptUrls)
      w.ready = false; w.prepared = -1; w.busy = false
      w.onmessage = (ev) => onWorker(w, ev.data)
      w.onerror = (ev) => { console.error('[模板编辑器] worker', ev.message); setInfo('预览出错：' + ev.message) }
      return w
    }
    for (let i = 0; i < 2; i++) pool.push(makeWorker())
    // 底图：摆放参数随工程走；像素只在底图变了时单独发给 Worker（baseMsg），dataURL 不进 Worker
    function renderPayload() { const b = S.project.base ? { ...S.project.base, data: undefined, id: S.baseId || 0 } : null; return clone({ ...S.project, base: b }) }
    function baseMsg() { return S.base ? { type: 'base', id: S.baseId, w: S.base.rgba.w, h: S.base.rgba.h, data: S.base.rgba.data } : { type: 'base', id: 0 } }
    function previewScale() { const s = size(); return Math.min(0.5, 360 / Math.max(s.w, s.h)) }
    function changed(fast, overlay = true) {
      S.version++
      S.exportCache = null
      clearTimeout(preview.timer)
      preview.timer = setTimeout(doPrepare, fast ? 40 : 120)
      if (overlay) overlayDirty()
      layerMode()
      syncTime()
    }
    // 用底图画面的效果（碎裂 / 消失）：预览不再垫半透明底图、效果层正常显示（不按滤色叠）——画面就是成片
    function layerMode() {
      const img = !!(S.base && fx().usesImage && S.project.useImage !== false)
      E.baseCanvas.style.visibility = img ? 'hidden' : ''
      E.fxCanvas.style.mixBlendMode = img ? 'normal' : 'screen'
    }
    function doPrepare() {
      if (S.drawing) return
      const v = S.version
      preview.version = v
      preview.scale = previewScale()
      preview.pending.clear()
      preview.next = new Map()   // 新版本的帧先攒着，旧帧继续显示，不闪
      const project = renderPayload()
      for (const w of pool) if (w.ready) { w.prepared = -1; w.postMessage({ type: 'prepare', version: v, project, scale: preview.scale }) }
    }
    function onWorker(w, msg) {
      if (msg.type === 'ready') { w.ready = true; w.postMessage(baseMsg()); if (preview.version >= 0) w.postMessage({ type: 'prepare', version: preview.version, project: renderPayload(), scale: preview.scale }); else doPrepare(); return }
      if (msg.type === 'prepared') { if (msg.version === preview.version) { w.prepared = msg.version; preview.w = msg.w; preview.h = msg.h; pump() } return }
      if (msg.type === 'error') { console.error('[模板编辑器]', msg.message); setInfo('预览出错：' + msg.message.split('\n')[0]); w.busy = false; return }
      if (msg.type === 'skip') { w.busy = false; preview.pending.delete(msg.index); pump(); return }
      if (msg.type === 'frame') {
        w.busy = false
        preview.pending.delete(msg.index)
        if (msg.version === preview.version) {
          const img = new ImageData(new Uint8ClampedArray(msg.rgba.buffer), msg.w, msg.h)
          preview.next.set(msg.index, img)
          // 新版本的当前帧到了：换上整套新帧
          if (msg.index === Math.floor(S.playhead) % n() || preview.next.size >= n()) { preview.frames = preview.next; drawFrame() }
          else if (preview.frames !== preview.next) preview.frames.set(msg.index, img)
        }
        pump()
      }
    }
    function pump() {
      const total = n(), start = Math.floor(S.playhead) % total
      for (const w of pool) {
        if (!w.ready || w.busy || w.prepared !== preview.version) continue
        let pick = -1
        for (let k = 0; k < total; k++) { const i = (start + k) % total; if (!preview.next.has(i) && !preview.pending.has(i)) { pick = i; break } }
        if (pick < 0) return
        w.busy = true; preview.pending.add(pick)
        w.postMessage({ type: 'frame', version: preview.version, index: pick })
      }
    }
    const fxCtx = E.fxCanvas.getContext('2d')
    function drawFrame() {
      const i = Math.floor(S.playhead) % n()
      const img = preview.frames.get(i) || preview.next && preview.next.get(i)
      if (!img) return
      if (E.fxCanvas.width !== img.width || E.fxCanvas.height !== img.height) { E.fxCanvas.width = img.width; E.fxCanvas.height = img.height }
      fxCtx.putImageData(img, 0, 0)
    }

    // ---------------------------------------------------------------- 播放
    function tick(now) {
      if (S.closed) return
      S.raf = requestAnimationFrame(tick)
      if (S.playing) {
        if (!S.lastTick) S.lastTick = now
        const dt = Math.min(0.1, (now - S.lastTick) / 1000)
        S.playhead = (S.playhead + dt * FX().FPS) % n()
        drawFrame(); syncTime(true); pump()
      }
      S.lastTick = now
    }
    S.raf = requestAnimationFrame(tick)
    function syncTime(fromTick) {
      const total = n(), i = Math.floor(S.playhead) % total
      E.scrub.max = String(total - 1)
      if (!fromTick || document.activeElement !== E.scrub) E.scrub.value = String(i)
      E.scrub.style.setProperty('--pct', (total > 1 ? (Number(E.scrub.value) / (total - 1)) * 100 : 0) + '%')
      const ready = preview.next ? preview.next.size : 0
      E.time.textContent = `${(total / FX().FPS).toFixed(1)} 秒 · 第 ${i + 1}/${total} 帧${ready < total ? ' · 预览 ' + ready + '/' + total : ''}`
      E.play.textContent = S.playing ? '❚❚' : '▶'
    }
    E.play.onclick = () => { S.playing = !S.playing; S.lastTick = 0; syncTime() }
    E.scrub.oninput = () => { S.playing = false; S.playhead = Number(E.scrub.value); drawFrame(); syncTime(); pump() }

    // ---------------------------------------------------------------- 画板摆放
    function layout() {
      const r = E.stage.getBoundingClientRect(), s = size(), pad = 28
      const k = Math.min((r.width - pad * 2) / s.w, (r.height - pad * 2) / s.h)
      const w = Math.max(40, s.w * k), h = Math.max(40, s.h * k)
      Object.assign(E.board.style, { width: w + 'px', height: h + 'px', left: (r.width - w) / 2 + 'px', top: (r.height - h) / 2 + 'px' })
      E.svg.setAttribute('viewBox', `0 0 ${s.w} ${s.h}`)
      S.view = { k, w, h }
      drawBase(); drawOverlay()
    }
    const ro = new ResizeObserver(layout)
    ro.observe(E.stage)

    function drawBase() {
      const c = E.baseCanvas, s = size()
      c.width = Math.round(S.view ? S.view.w : s.w); c.height = Math.round(S.view ? S.view.h : s.h)
      const g = c.getContext('2d')
      g.clearRect(0, 0, c.width, c.height)
      if (!S.base || !S.project.base) return
      const pl = FX().basePlacement(S.project), k = c.width / s.w
      g.globalAlpha = Math.max(0, Math.min(1, Number(S.project.base.opacity ?? 0.5)))
      g.imageSmoothingQuality = 'high'
      g.drawImage(S.base.img, pl.x * k, pl.y * k, pl.w * k, pl.h * k)
    }

    // ---------------------------------------------------------------- 轮廓叠层（SVG，画板坐标）
    let overlayRaf = 0
    function overlayDirty() { S.geoStale = true; if (!overlayRaf) overlayRaf = requestAnimationFrame(() => { overlayRaf = 0; drawOverlay() }) }
    const px = (v) => v / (S.view ? S.view.k : 1)   // 屏幕像素 → 画板单位
    function overlayGeometry() {
      const now = performance.now()
      if (!S.overlayGeo || (S.geoStale && now - (S.geoAt || 0) > 110)) {
        S.overlayGeo = FX().geometry(renderPayload(), Math.min(0.5, 300 / Math.max(size().w, size().h)))
        S.geoStale = false; S.geoAt = now
      } else if (S.geoStale) { clearTimeout(S.geoTimer); S.geoTimer = setTimeout(overlayDirty, 120) }
      return S.overlayGeo
    }
    const pathOf = (pts) => { let d = ''; for (let k = 0; k < pts.length; k += 2) d += (k ? 'L' : 'M') + pts[k].toFixed(1) + ' ' + pts[k + 1].toFixed(1); return d + 'Z' }
    const centered = () => !!fx().centered
    const baseOnly = () => !!fx().baseOnly   // 按底图本身扫（线性扫光 / 形态驱动 / 局部高光 / 径向）：不用轮廓
    function insideBox(p) { const b = bbox(); return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h }
    // 起点角度（2026-10-15 用户：轮廓流光「缺少角度控制，起点都被固定了」——原来只能拖画板上的小黄点，很难发现）：
    // 0° = 形状中心的正上方，顺时针一圈。滑条 → 沿那个方向找轮廓上的点放黄点；拖黄点 → 滑条跟着变
    function startAngle() {
      const geo = overlayGeometry(), k = geo.W / size().w, st = S.project.start
      if (!st) return 0
      return Math.round(((Math.atan2(st.x - geo.cx / k, -(st.y - geo.cy / k)) * 180) / Math.PI + 360) % 360)
    }
    function setStartAngle(deg) {
      const geo = overlayGeometry(), k = geo.W / size().w, cx = geo.cx / k, cy = geo.cy / k, want = (deg * Math.PI) / 180
      let best = null, bd = Infinity
      for (const c of geo.outer) for (let j = 0; j < c.x.length; j++) {
        const x = c.x[j] / k, y = c.y[j] / k
        let d = Math.atan2(x - cx, -(y - cy)) - want
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI))
        const score = Math.abs(d) - Math.hypot(x - cx, y - cy) * 1e-5   // 同一方向上有几个点时取最外面的
        if (score < bd) { bd = score; best = { x, y } }
      }
      if (best) S.project.start = best
    }
    function syncStartSlider() {
      const row = E.params.querySelector('[data-key="startAngle"]'), input = row && row.querySelector('input')
      if (!input) return
      const v = startAngle(); input.value = v; input.style.setProperty('--pct', (v / 359) * 100 + '%'); row.querySelector('.fxm-val').textContent = v + '°'
    }
    function usesStart() { const f = fx(); return !(f.inert && f.inert.start) && (f.kind === 'edge' || f.id === 'orbit') }
    function startOnContour() {
      const geo = overlayGeometry(), st = S.project.start
      if (!geo.outer.length || !st) return null
      const k = geo.W / size().w
      let best = null, bd = Infinity
      for (const c of geo.outer) for (let j = 0; j < c.x.length; j++) { const d = (c.x[j] / k - st.x) ** 2 + (c.y[j] / k - st.y) ** 2; if (d < bd) { bd = d; best = { c, j } } }
      if (!best) return null
      const { c, j } = best, m = c.x.length, a = (j - 2 + m) % m, b = (j + 2) % m
      let tx = c.x[b] - c.x[a], ty = c.y[b] - c.y[a]
      const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l
      if (S.project.direction === 'cw') { tx = -tx; ty = -ty }
      return { x: c.x[j] / k, y: c.y[j] / k, tx, ty }
    }
    function drawOverlay() {
      if (!S.view) return
      const s = size(), parts = []
      const sw = px(1.5)
      if (S.drawing) {
        const pts = S.drawing.points
        if (pts.length) parts.push(`<polyline points="${pts.map((p) => p.x + ',' + p.y).join(' ')}" fill="none" stroke="${GREEN}" stroke-width="${sw}"/>`)
        pts.forEach((p, i) => parts.push(`<rect x="${p.x - px(4)}" y="${p.y - px(4)}" width="${px(8)}" height="${px(8)}" fill="${i === 0 ? GREEN : '#1F1F1F'}" stroke="${GREEN}" stroke-width="${px(1.2)}"/>`))
        E.svg.innerHTML = parts.join('')
        return
      }
      if (baseOnly()) { E.svg.innerHTML = ''; return }   // 光跟着底图走：画板上只看底图
      if (centered()) {
        // 不跟轮廓走的效果：没有轮廓线和控制点，只有一个框——拖框移动、拖四角改大小
        const b = bbox()
        parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="${px(1)}" stroke-dasharray="${px(4)} ${px(3)}"/>`)
        for (const [hx, hy, id] of [[b.x, b.y, 'nw'], [b.x + b.w, b.y, 'ne'], [b.x + b.w, b.y + b.h, 'se'], [b.x, b.y + b.h, 'sw']]) parts.push(`<rect data-h="${id}" x="${hx - px(4)}" y="${hy - px(4)}" width="${px(8)}" height="${px(8)}" fill="#fff" stroke="#000" stroke-width="${px(0.8)}"/>`)
        E.svg.innerHTML = parts.join('')
        return
      }
      for (const c of curves()) parts.push(`<path d="${pathOf(c.pts)}" fill="none" stroke="${GREEN}" stroke-opacity=".75" stroke-width="${sw}" ${c.hole ? `stroke-dasharray="${px(3)} ${px(3)}"` : ''}/>`)
      if (Math.abs(Number(S.project.offset) || 0) > 0.5) {
        const geo = overlayGeometry(), k = geo.W / s.w
        for (const c of geo.contours) {
          let d = ''
          for (let j = 0; j < c.x.length; j += 2) d += (j ? 'L' : 'M') + (c.x[j] / k).toFixed(1) + ' ' + (c.y[j] / k).toFixed(1)
          parts.push(`<path d="${d}Z" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="${px(1)}" stroke-dasharray="${px(4)} ${px(3)}"/>`)
        }
      }
      const b = bbox()
      if (allPoints().length) {
        parts.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="${px(1)}" stroke-dasharray="${px(2)} ${px(3)}"/>`)
        for (const [hx, hy, id] of [[b.x, b.y, 'nw'], [b.x + b.w, b.y, 'ne'], [b.x + b.w, b.y + b.h, 'se'], [b.x, b.y + b.h, 'sw']]) parts.push(`<rect data-h="${id}" x="${hx - px(4)}" y="${hy - px(4)}" width="${px(8)}" height="${px(8)}" fill="#fff" stroke="#000" stroke-width="${px(0.8)}"/>`)
        const rx = b.x + b.w / 2, ry = b.y - px(22)
        parts.push(`<line x1="${rx}" y1="${b.y}" x2="${rx}" y2="${ry}" stroke="#fff" stroke-opacity=".4" stroke-width="${px(1)}"/><circle data-h="rot" cx="${rx}" cy="${ry}" r="${px(5)}" fill="#fff" stroke="#000" stroke-width="${px(0.8)}"/>`)
      }
      S.project.outlines.forEach((o, oi) => o.points.forEach((p, pi) => {
        const on = S.selected && S.selected.o === oi && S.selected.p === pi
        const fill = on ? GREEN : '#1F1F1F', r = px(4)
        parts.push(p.s && !S.project.smoothAll ? `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}" stroke="${GREEN}" stroke-width="${px(1.3)}"/>`
          : `<rect x="${p.x - r}" y="${p.y - r}" width="${2 * r}" height="${2 * r}" fill="${fill}" stroke="${GREEN}" stroke-width="${px(1.3)}"/>`)
      }))
      if (usesStart()) {
        const st = startOnContour()
        if (st) {
          const L = px(16), ax = st.x + st.tx * L, ay = st.y + st.ty * L, nx = -st.ty * px(5), ny = st.tx * px(5)
          parts.push(`<line x1="${st.x}" y1="${st.y}" x2="${ax}" y2="${ay}" stroke="#ffd34d" stroke-width="${px(2)}"/>`
            + `<polygon points="${ax + st.tx * px(7)},${ay + st.ty * px(7)} ${ax + nx},${ay + ny} ${ax - nx},${ay - ny}" fill="#ffd34d"/>`
            + `<circle data-h="start" cx="${st.x}" cy="${st.y}" r="${px(6)}" fill="#ffd34d" stroke="#000" stroke-width="${px(1)}"/>`)
        }
      }
      E.svg.innerHTML = parts.join('')
    }

    // ---------------------------------------------------------------- 画板上的拖拽
    function toCanvas(ev) { const r = E.svg.getBoundingClientRect(), s = size(); return { x: ((ev.clientX - r.left) / r.width) * s.w, y: ((ev.clientY - r.top) / r.height) * s.h } }
    function hitPoint(p) {
      const lim = px(8) ** 2
      let best = null, bd = lim
      S.project.outlines.forEach((o, oi) => o.points.forEach((q, pi) => { const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d <= bd) { bd = d; best = { o: oi, p: pi } } }))
      return best
    }
    function nearCurve(p) {
      let best = null, bd = px(8) ** 2
      for (const c of curves()) for (let k = 0; k < c.pts.length; k += 2) { const d = (c.pts[k] - p.x) ** 2 + (c.pts[k + 1] - p.y) ** 2; if (d < bd) { bd = d; best = true } }
      return best
    }
    function insideShape(p) {
      for (const c of curves()) {
        if (c.hole) continue
        let inside = false
        const a = c.pts, m = a.length / 2
        for (let k = 0, j = m - 1; k < m; j = k++) { const yk = a[2 * k + 1], yj = a[2 * j + 1]; if ((yk > p.y) !== (yj > p.y) && p.x < ((a[2 * j] - a[2 * k]) * (p.y - yk)) / (yj - yk) + a[2 * k]) inside = !inside }
        if (inside) return true
      }
      return false
    }
    function moveAll(dx, dy) { for (const p of allPoints()) { p.x += dx; p.y += dy } if (S.project.start) { S.project.start.x += dx; S.project.start.y += dy } }

    E.svg.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return
      const p = toCanvas(ev)
      if (S.drawing) {
        const pts = S.drawing.points
        if (pts.length >= 3 && Math.hypot(pts[0].x - p.x, pts[0].y - p.y) < px(10)) { finishDrawing(); return }
        pts.push({ x: p.x, y: p.y, s: 0 }); drawOverlay(); return
      }
      if (baseOnly()) return
      const handle = ev.target.getAttribute && ev.target.getAttribute('data-h')
      const hp = centered() ? null : hitPoint(p)
      E.svg.setPointerCapture(ev.pointerId)
      // 撤销记录在真的拖动时才记（单击 / 双击不留空记录）
      if (handle === 'start' && !hp) { S.drag = { kind: 'start', snap: true } }
      else if (hp) { S.selected = hp; S.drag = { kind: 'point', ...hp, last: p, snap: true } }
      else if (handle && handle !== 'start') { S.drag = { kind: handle === 'rot' ? 'rotate' : 'scale', handle, box: bbox(), orig: clone(S.project.outlines), start0: clone(S.project.start), from: p, snap: true } }
      else if (centered() ? insideBox(p) : insideShape(p) || nearCurve(p)) { S.selected = null; S.drag = { kind: 'move', last: p, snap: true } }
      else { S.selected = null; S.drag = null }
      drawOverlay()
    })
    E.svg.addEventListener('pointermove', (ev) => {
      const d = S.drag
      if (!d) return
      const p = toCanvas(ev)
      if (d.snap) { snapshot(); d.snap = false; d.moved = true }
      if (d.kind === 'point') { const q = S.project.outlines[d.o].points[d.p]; q.x = p.x; q.y = p.y }
      else if (d.kind === 'move') { moveAll(p.x - d.last.x, p.y - d.last.y); d.last = p }
      else if (d.kind === 'start') { S.project.start = { x: p.x, y: p.y }; syncStartSlider() }
      else if (d.kind === 'scale') {
        const b = d.box, ax = d.handle.includes('w') ? b.x + b.w : b.x, ay = d.handle.includes('n') ? b.y + b.h : b.y
        const ox = d.handle.includes('w') ? b.x : b.x + b.w, oy = d.handle.includes('n') ? b.y : b.y + b.h
        let sx = (p.x - ax) / ((ox - ax) || 1), sy = (p.y - ay) / ((oy - ay) || 1)
        if (ev.shiftKey || ['star', 'heart'].includes(S.project.shape.kind)) { const s = Math.max(Math.abs(sx), Math.abs(sy)) ; sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s }
        if (Math.abs(sx) < 0.02) sx = 0.02 * Math.sign(sx || 1)
        if (Math.abs(sy) < 0.02) sy = 0.02 * Math.sign(sy || 1)
        S.project.outlines = d.orig.map((o) => ({ ...o, points: o.points.map((q) => ({ ...q, x: ax + (q.x - ax) * sx, y: ay + (q.y - ay) * sy })) }))
        if (d.start0) S.project.start = { x: ax + (d.start0.x - ax) * sx, y: ay + (d.start0.y - ay) * sy }
      } else if (d.kind === 'rotate') {
        const b = d.box, cx = b.x + b.w / 2, cy = b.y + b.h / 2
        let a = Math.atan2(p.y - cy, p.x - cx) - Math.atan2(d.from.y - cy, d.from.x - cx)
        if (ev.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12)
        const c = Math.cos(a), s = Math.sin(a)
        const rot = (q) => ({ ...q, x: cx + (q.x - cx) * c - (q.y - cy) * s, y: cy + (q.x - cx) * s + (q.y - cy) * c })
        S.project.outlines = d.orig.map((o) => ({ ...o, points: o.points.map(rot) }))
        if (d.start0) S.project.start = rot(d.start0)
      }
      changed(true)
    })
    const endDrag = () => { if (S.drag) { const moved = S.drag.moved; S.drag = null; if (moved) changed(); else drawOverlay() } }
    E.svg.addEventListener('pointerup', endDrag)
    E.svg.addEventListener('pointercancel', endDrag)
    E.svg.addEventListener('dblclick', (ev) => {
      if (S.drawing) { finishDrawing(); return }
      if (centered() || baseOnly()) return
      const p = toCanvas(ev), hp = hitPoint(p)
      if (hp) { snapshot(); const q = S.project.outlines[hp.o].points[hp.p]; q.s = q.s ? 0 : 1; changed(); return }
      if (!nearCurve(p)) return
      // 线上双击：插在最近的那段控制边上
      let best = null, bd = Infinity
      S.project.outlines.forEach((o, oi) => o.points.forEach((a, i) => {
        const b = o.points[(i + 1) % o.points.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)), d = (a.x + t * dx - p.x) ** 2 + (a.y + t * dy - p.y) ** 2
        if (d < bd) { bd = d; best = { oi, i } }
      }))
      if (!best) return
      snapshot()
      const pts = S.project.outlines[best.oi].points, a = pts[best.i], b = pts[(best.i + 1) % pts.length]
      pts.splice(best.i + 1, 0, { x: p.x, y: p.y, s: a.s && b.s ? 1 : 0 })
      S.selected = { o: best.oi, p: best.i + 1 }
      changed()
    })

    // ---------------------------------------------------------------- 形状
    // 画自由形状画到一半：点别的形状 = 放弃这次画的直接换过去；再点一次「自由形状」= 取消（2026-10-15 用户：点了自由形状就必须画一个，不能切换）
    function cancelDrawing() {
      if (!S.drawing) return false
      S.drawing = null
      S.history.pop()   // startDrawing 记的那一步撤销（画的过程中工程没变）
      setHint()
      return true
    }
    function setShape(kind) {
      if (cancelDrawing() && kind === 'free') { renderShapes(); drawOverlay(); return }
      if (kind === 'free') { startDrawing(); return }
      if (kind === 'trace') { if (!S.base) { E.file.click(); S.afterBase = 'trace'; return } snapshot(); traceBase(); return }
      snapshot()
      let b = bbox()
      if (kind === 'circle' || kind === 'star' || kind === 'heart') { const m = Math.min(b.w, b.h), cx = b.x + b.w / 2, cy = b.y + b.h / 2; b = { x: cx - m / 2, y: cy - m / 2, w: m, h: m } }
      const prev = S.project.shape.kind
      S.project.shape.kind = kind
      S.project.outlines = [{ points: FX().shapeOutline(kind, b, S.project.shape.star), hole: false }]
      if (kind === 'rect') S.project.corner = 0
      else if (kind === 'roundrect' && (prev !== 'roundrect' || !(S.project.corner > 0))) S.project.corner = Math.round(Math.min(b.w, b.h) * 0.16)
      else if (kind === 'star') S.project.corner = Math.min(S.project.corner || 0, 6)
      S.project.smoothAll = false
      S.project.start = defaultStart()
      S.selected = null
      changed(); renderShapes(); renderParams()
    }
    function startDrawing() {
      snapshot()
      S.drawing = { points: [] }
      S.selected = null
      setHint('在画板上点出轮廓：点第一个点（或双击）闭合，Esc 取消')
      renderShapes(); drawOverlay()
    }
    function finishDrawing() {
      const pts = S.drawing.points
      S.drawing = null
      if (pts.length < 3) { undo(); setHint(); renderShapes(); return }
      S.project.shape.kind = 'free'
      S.project.outlines = [{ points: pts, hole: false }]
      S.project.start = defaultStart()
      setHint(); changed(); renderShapes(); renderParams()
    }
    function baseBox() {   // 底图不透明部分在画板上的包围盒
      const { data, w, h } = S.base.rgba
      let opaque = true
      for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { opaque = false; break }
      const bg = [data[0], data[1], data[2]]
      let x0 = w, x1 = -1, y0 = h, y1 = -1
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const on = opaque ? Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 40 : data[i + 3] > 16
        if (on) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1 }
      const pl = FX().basePlacement(S.project), kx = pl.w / w, ky = pl.h / h
      return { x: pl.x + x0 * kx, y: pl.y + y0 * ky, w: (x1 - x0 + 1) * kx, h: (y1 - y0 + 1) * ky }
    }
    function fitToBase() {
      if (!S.base) return
      snapshot()
      const kind = S.project.shape.kind
      if (kind === 'trace') { traceBase(); return }
      const b = baseBox()
      if (kind === 'free') {
        const cur = bbox(), sx = b.w / cur.w, sy = b.h / cur.h
        for (const p of allPoints()) { p.x = b.x + (p.x - cur.x) * sx; p.y = b.y + (p.y - cur.y) * sy }
      } else {
        let bb = b
        if (kind === 'circle' || kind === 'star' || kind === 'heart') { const m = Math.max(b.w, b.h), cx = b.x + b.w / 2, cy = b.y + b.h / 2; bb = { x: cx - m / 2, y: cy - m / 2, w: m, h: m } }
        S.project.outlines = [{ points: FX().shapeOutline(kind, bb, S.project.shape.star), hole: false }]
        if (kind === 'roundrect') S.project.corner = Math.round(Math.min(bb.w, bb.h) * 0.16)
      }
      S.project.start = defaultStart()
      changed(); renderParams()
    }
    function traceBase() {
      if (!S.base) return
      const s = size(), pl = FX().basePlacement(S.project)
      const outs = FX().traceImage(S.base.rgba.data, S.base.rgba.w, S.base.rgba.h, pl, s.w, s.h, S.project.traceDetail ?? 0.5, S.project.outerOnly !== false)
      if (!outs.length) { setInfo('底图里没找到轮廓'); return }
      // 「外圈」只对中间镂空的图（比如中间透明的框）有用；樱桃、宝石这类没有被包住的内圈，两个选项一样——没有就不显示（2026-10-15 用户：感觉没效果）
      S.traceHoles = (S.project.outerOnly !== false ? FX().traceImage(S.base.rgba.data, S.base.rgba.w, S.base.rgba.h, pl, s.w, s.h, S.project.traceDetail ?? 0.5, false) : outs).filter((o) => o.hole).length
      S.project.shape.kind = 'trace'
      S.project.outlines = outs
      S.project.corner = 0
      S.project.start = defaultStart()
      S.selected = null
      changed(); renderShapes(); renderParams()
    }

    function renderShapes() {
      const kind = S.drawing ? 'free' : S.project.shape.kind
      const off = baseOnly() ? 'disabled title="这类效果按底图本身扫，不用轮廓"' : centered() ? 'disabled title="这个效果不跟轮廓走，只看位置和大小"' : ''
      E.shapes.innerHTML = FX().SHAPES.map((s) => `<button class="fxm-btn" type="button" data-shape="${s.id}" data-on="${s.id === kind && !off ? 1 : 0}" ${off}>${s.label}</button>`).join('')
      E.shapes.querySelectorAll('[data-shape]').forEach((b) => { b.onclick = () => setShape(b.dataset.shape) })
      const has = !!S.base
      E.basetools.innerHTML = `<button class="fxm-btn" type="button" data-base="pick">${has ? '换底图' : '上传底图'}</button>`
        + `<button class="fxm-btn" type="button" data-base="fit" ${has ? '' : 'disabled title="先上传底图"'}>套住底图</button>`
        + (has ? '<button class="fxm-btn" type="button" data-base="clear">移除底图</button>' : '')

      E.basetools.querySelector('[data-base="pick"]').onclick = () => { S.afterBase = ''; E.file.click() }
      E.basetools.querySelector('[data-base="fit"]').onclick = fitToBase
      const clr = E.basetools.querySelector('[data-base="clear"]')
      if (clr) clr.onclick = () => { S.base = null; S.project.base = null; S.baseId = (S.baseId || 0) + 1; for (const w of pool) if (w.ready) w.postMessage(baseMsg()); if (S.project.canvas.preset === 'base') S.project.canvas.preset = '1:1'; if (fx().needsBase) pickEffect(FX().effects()[0].id); drawBase(); renderShapes(); renderParams(); renderEffects(); layout(); changed() }
      if (!S.drawing) setHint()
    }
    function setHint(text) {
      E.hint.textContent = text || (baseOnly() ? '这类效果按底图本身扫：换底图、调「底图大小」就行，成片只有光、不带底图'
        : centered() ? '这个效果不跟轮廓走：拖框移动位置 · 拖四角改大小（Shift 等比）'
        : '拖点改形状 · 线上双击加点 · 点上双击切换尖角/圆滑 · 选中点按 Delete 删除 · 拖四角缩放（Shift 等比）· 拖上方圆点旋转 · 黄点是光的起点')
    }

    // ---------------------------------------------------------------- 底图
    E.file.onchange = async () => {
      const f = E.file.files && E.file.files[0]
      E.file.value = ''
      if (!f) return
      try {
        const bmp = await createImageBitmap(f)
        const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height))
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k))
        const c = document.createElement('canvas'); c.width = w; c.height = h
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, w, h)
        const data = c.toDataURL('image/png')
        await loadBase({ name: f.name, w, h, data, scale: S.project.base ? S.project.base.scale : 0.7, opacity: S.project.base ? S.project.base.opacity : 0.5 })
        if (S.afterBase === 'trace') { snapshot(); traceBase() }
        if (S.afterBase && S.afterBase.startsWith('effect:')) pickEffect(S.afterBase.slice(7))
        S.afterBase = ''
      } catch (error) { setInfo('底图读取失败：' + error.message) }
    }
    async function loadBase(base) {
      const img = new Image()
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('图片解码失败')); img.src = base.data })
      const c = document.createElement('canvas'); c.width = base.w; c.height = base.h
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, base.w, base.h)
      S.base = { img, rgba: { data: g.getImageData(0, 0, base.w, base.h).data, w: base.w, h: base.h } }
      S.baseId = (S.baseId || 0) + 1
      for (const w of pool) if (w.ready) w.postMessage(baseMsg())
      changed()
      S.project.base = base
      drawBase(); renderShapes(); renderParams(); renderEffects()
    }

    // ---------------------------------------------------------------- 右侧参数
    const pct = (v, d) => ((Math.max(d.min, Math.min(d.max, v)) - d.min) / ((d.max - d.min) || 1)) * 100 + '%'
    const show = (v, d) => (d.format ? d.format(v) : fmt(v, d.step))
    function slider(key, def, value, onInput, inertReason) {
      const v = value == null ? def.def : value
      return { html: `<div class="fxm-row" data-key="${key}" ${inertReason ? `data-inert="1" title="${esc(inertReason)}"` : ''}><label>${esc(def.label)}</label>`
        + `<input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${v}" style="--pct:${pct(v, def)}" ${inertReason ? 'disabled' : ''}><span class="fxm-val">${esc(show(v, def))}</span></div>`, key, def, onInput }
    }
    function seg(key, label, items, value, onPick, inertReason) {
      return { html: `<div class="fxm-line" data-seg="${key}" ${inertReason ? `data-inert="1" title="${esc(inertReason)}"` : ''}><label>${esc(label)}</label><div class="fxm-seg">`
        + items.map((it) => `<button class="fxm-btn" type="button" data-v="${esc(it.id)}" data-on="${it.id === value ? 1 : 0}" ${it.disabled ? `disabled title="${esc(it.disabled)}"` : ''} ${inertReason ? 'disabled' : ''}>${esc(it.label)}</button>`).join('')
        + '</div></div>', key, onPick, seg: true }
    }
    function renderParams() {
      const p = S.project, f = fx(), inert = f.inert || {}, controls = []
      const sec = (title, items) => `<div class="fxm-sec"><div class="fxm-sec-title">${esc(title)}</div>${items.map((c) => c.html).join('')}</div>`
      const html = []
      // 画板
      const canvasItems = [
        seg('canvas', '尺寸', FX().CANVAS_CHOICES.map((id) => { const c = FX().CANVASES.find((x) => x.id === id); return { id, label: c.label, disabled: id === 'base' && !S.base ? '先上传底图' : '' } }), FX().CANVAS_CHOICES.includes(p.canvas.preset) ? p.canvas.preset : '', (v) => setCanvas(v)),
        ...(p.canvas.preset === 'custom' ? [{ html: `<div class="fxm-line" data-custom-size><label>宽 × 高</label><div class="fxm-seg"><input class="fxm-num" type="number" min="128" max="1024" step="32" value="${size().w}" data-cw> <input class="fxm-num" type="number" min="128" max="1024" step="32" value="${size().h}" data-ch></div></div>` }] : []),
        slider('frames', { label: '时长', min: 0, max: FX().DURATIONS.length - 1, step: 1, def: 1, format: (i) => FX().DURATIONS[Math.round(i)].label }, Math.max(0, FX().DURATIONS.findIndex((d) => d.frames === n())), (v) => { p.frames = FX().DURATIONS[Math.round(v)].frames; S.playhead = 0 }),
        seg('lifecycle', '播放', [{ id: 'loop', label: '循环' }, { id: 'once', label: '一次性' }], p.lifecycle, (v) => { p.lifecycle = v; changed() }),
      ]
      controls.push(...canvasItems); html.push(sec('画板', canvasItems))
      // 轮廓
      const kind = f.centered || f.baseOnly ? '' : p.shape.kind, shapeItems = []
      if (['roundrect', 'rect', 'star', 'free'].includes(kind)) shapeItems.push(slider('corner', { label: '圆角', min: 0, max: 300, step: 1, def: 0 }, p.corner, (v) => { p.corner = v }))
      if (!f.centered && !f.baseOnly) shapeItems.push(slider('offset', { label: '外扩', min: -80, max: 240, step: 1, def: 0 }, p.offset, (v) => { p.offset = v }))
      if (kind === 'star') {
        shapeItems.push(slider('star.points', { label: '角数', min: 3, max: 12, step: 1, def: 5 }, p.shape.star.points, (v) => { p.shape.star.points = v; regenStar() }))
        shapeItems.push(slider('star.inner', { label: '内径', min: 0.15, max: 0.9, step: 0.01, def: 0.45 }, p.shape.star.inner, (v) => { p.shape.star.inner = v; regenStar() }))
      }
      if (kind === 'trace') {
        shapeItems.push(slider('traceDetail', { label: '精细度', min: 0, max: 1, step: 0.01, def: 0.5 }, p.traceDetail, (v) => { p.traceDetail = v; clearTimeout(S.traceTimer); S.traceTimer = setTimeout(traceBase, 140) }))
        if (S.traceHoles) shapeItems.push(seg('outerOnly', '内圈', [{ id: '1', label: '不要' }, { id: '0', label: `要（${S.traceHoles} 个）` }], p.outerOnly !== false ? '1' : '0', (v) => { p.outerOnly = v === '1'; traceBase() }))
      }
      if (kind === 'free') shapeItems.push(seg('smoothAll', '圆滑', [{ id: '0', label: '按点' }, { id: '1', label: '全部圆滑' }], p.smoothAll ? '1' : '0', (v) => { p.smoothAll = v === '1'; changed() }))
      if (usesStart()) shapeItems.push(slider('startAngle', { label: '起点', min: 0, max: 359, step: 1, def: 0, format: (v) => Math.round(v) + '°' }, startAngle(), (v) => { setStartAngle(v); drawOverlay() }))
      shapeItems.push(seg('direction', '方向', [{ id: 'ccw', label: '逆时针' }, { id: 'cw', label: '顺时针' }], p.direction, (v) => { p.direction = v; changed() }, inert.direction))
      if (S.base) {
        shapeItems.push(slider('base.opacity', { label: '底图透明', min: 0, max: 1, step: 0.01, def: 0.5 }, p.base.opacity, (v) => { p.base.opacity = v; drawBase() }, ''))
        shapeItems.push(slider('base.scale', { label: '底图大小', min: 0.2, max: 1.2, step: 0.01, def: 0.7 }, p.base.scale, (v) => { p.base.scale = v; drawBase(); changed(true) }, ''))
        // 碎裂 / 消失类用底图本身来碎、来消失（2026-10-15 用户：不是根据上传的图做就没什么用）
        shapeItems.push(seg('useImage', '成片', [{ id: '1', label: '用底图画面' }, { id: '0', label: '只用发光形状' }], p.useImage !== false ? '1' : '0', (v) => { p.useImage = v === '1'; changed() }, f.usesImage ? '' : '这个效果不用底图画面（碎裂 / 消失类才用）'))
      }
      controls.push(...shapeItems); html.push(sec(f.baseOnly ? '底图' : f.centered ? '位置' : '轮廓', shapeItems))
      // 效果
      const fxItems = f.params.map((d) => d.options
        ? seg('p.' + d.key, d.label, d.options, p.params[d.key] ?? d.def, (v) => { p.params[d.key] = v; changed(); renderParams() }, inert[d.key])
        : slider('p.' + d.key, d, p.params[d.key], (v) => { p.params[d.key] = v }, inert[d.key] || (d.inertWhen && d.inertWhen({ ...FX().effectDefaults(f.id), ...p.params })) || ''))
      if (f.emit) fxItems.push(seg('p.emit', '发射', [{ id: 'edge', label: '沿轮廓' }, { id: 'inside', label: '轮廓内' }, { id: 'around', label: '周围' }], p.params.emit || 'edge', (v) => { p.params.emit = v; changed() }))
      const colourInert = inert.colour
      fxItems.push({ html: `<div class="fxm-line" data-seg="colour" ${colourInert ? `data-inert="1" title="${esc(colourInert)}"` : ''}><label>颜色</label><div class="fxm-seg">`
        + (f.kind === 'lib' ? `<button class="fxm-btn" type="button" data-v="default" data-on="${p.colour.mode !== 'custom' && p.colour.mode !== 'white' ? 1 : 0}" ${colourInert ? 'disabled' : ''}>默认</button>` : '')
        + (f.kind === 'basesweep' ? `<button class="fxm-btn" type="button" data-v="base" data-on="${p.colour.mode !== 'custom' && p.colour.mode !== 'white' ? 1 : 0}" ${colourInert ? 'disabled' : ''}>底图色</button>` : '')
        + `<button class="fxm-btn" type="button" data-v="white" data-on="${p.colour.mode === 'white' || (f.kind !== 'lib' && f.kind !== 'basesweep' && p.colour.mode !== 'custom') ? 1 : 0}" ${colourInert ? 'disabled' : ''}>白光</button>`
        + `<button class="fxm-btn" type="button" data-v="custom" data-on="${p.colour.mode === 'custom' ? 1 : 0}" ${colourInert ? 'disabled' : ''}>自选</button>`
        + `<input class="fxm-colour" type="color" value="${esc(p.colour.value || '#ffd173')}" ${colourInert ? 'disabled' : ''}></div></div>`, colour: true })
      controls.push(...fxItems); html.push(sec(f.label + '　' + (f.hint || ''), fxItems))
      // 整体动画
      const mo = p.motion, moItems = [
        seg('motion', '动画', FX().MOTIONS, mo.kind, (v) => { mo.kind = v; changed(); renderParams() }),
        slider('motion.amount', { label: '幅度', min: 0.2, max: 3, step: 0.05, def: 1 }, mo.amount, (v) => { mo.amount = v }, mo.kind === 'none' ? '先选一种动画' : ''),
      ]
      controls.push(...moItems); html.push(sec('整体动画', moItems))
      E.params.innerHTML = html.join('')
      // 绑定
      for (const c of controls) {
        if (c.seg) {
          const row = E.params.querySelector(`[data-seg="${c.key}"]`)
          row && row.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => { row.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('data-on', x === b ? 1 : 0)); c.onPick(b.dataset.v) } })
        } else if (c.onInput) {
          const row = E.params.querySelector(`[data-key="${c.key}"]`), input = row && row.querySelector('input'), val = row && row.querySelector('.fxm-val')
          if (!input) continue
          const shapeKey = ['corner', 'offset', 'star.points', 'star.inner', 'traceDetail', 'base.scale'].includes(c.key)
          input.oninput = () => { const v = Number(input.value); val.textContent = show(v, c.def); input.style.setProperty('--pct', pct(v, c.def)); c.onInput(v); if (c.key !== 'base.opacity' && c.key !== 'base.scale') changed(true, shapeKey) }
        }
      }
      const cw = E.params.querySelector('[data-cw]'), ch = E.params.querySelector('[data-ch]')
      if (cw && ch) { const apply = () => { const before = size(); p.canvas.w = Number(cw.value); p.canvas.h = Number(ch.value); keepOutlineIn(before); cw.value = size().w; ch.value = size().h }; cw.onchange = apply; ch.onchange = apply }
      const colourRow = E.params.querySelector('[data-seg="colour"]')
      colourRow.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => { p.colour.mode = b.dataset.v; colourRow.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('data-on', x === b ? 1 : 0)); changed() } })
      const picker = colourRow.querySelector('input[type=color]')
      picker.oninput = () => { p.colour.value = picker.value; p.colour.mode = 'custom'; colourRow.querySelectorAll('[data-v]').forEach((x) => x.setAttribute('data-on', x.dataset.v === 'custom' ? 1 : 0)); changed(true) }
      updateInfo()
    }
    // 星形：从现有的外尖（偶数点）量出中心 / 半径 / 朝向，按新的角数内径重排——大小不变
    // （以前按外框重新塞一个星形，星形比外框小一圈，每调一次就缩一点）
    function regenStar() {
      const pts = S.project.outlines[0] ? S.project.outlines[0].points : []
      const tips = pts.filter((_, i) => i % 2 === 0)
      if (tips.length < 3) return
      const cx = tips.reduce((a, q) => a + q.x, 0) / tips.length, cy = tips.reduce((a, q) => a + q.y, 0) / tips.length
      const r = tips.reduce((a, q) => a + Math.hypot(q.x - cx, q.y - cy), 0) / tips.length, rot = Math.atan2(tips[0].y - cy, tips[0].x - cx)
      const n = Math.max(3, Math.min(12, Math.round(S.project.shape.star.points || 5))), inner = Math.max(0.15, Math.min(0.9, Number(S.project.shape.star.inner) || 0.45)), out = []
      for (let k = 0; k < n * 2; k++) { const a = rot + (k * Math.PI) / n, rr = k % 2 ? r * inner : r; out.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, s: 0 }) }
      S.project.outlines = [{ points: out, hole: false }]
    }
    function setCanvas(id) {
      const before = size()
      if (id === 'custom' && !S.project.canvas.w) { S.project.canvas.w = before.w; S.project.canvas.h = before.h }
      S.project.canvas.preset = id
      keepOutlineIn(before)
      renderParams()
    }
    function keepOutlineIn(before) {
      const after = size()
      const dx = (after.w - before.w) / 2, dy = (after.h - before.h) / 2
      moveAll(dx, dy)
      const b = bbox()
      if (b.w > after.w * 0.95 || b.h > after.h * 0.95) {
        const k = Math.min((after.w * 0.85) / b.w, (after.h * 0.85) / b.h), cx = after.w / 2, cy = after.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2
        for (const p of allPoints()) { p.x = cx + (p.x - bx) * k; p.y = cy + (p.y - by) * k }
        if (S.project.start) { S.project.start.x = cx + (S.project.start.x - bx) * k; S.project.start.y = cy + (S.project.start.y - by) * k }
      }
      S.playhead = 0
      layout(); changed()
    }

    // ---------------------------------------------------------------- 左侧效果
    function renderEffects() {
      const groups = new Map()
      for (const e of FX().effects()) { if (!groups.has(e.group)) groups.set(e.group, []); groups.get(e.group).push(e) }
      // 分组能展开 / 收拢（2026-10-15 用户）：一打开只展开当前效果所在的那组
      if (!S.openGroups) S.openGroups = new Set([FX().effectOf(S.project.effect).group])
      E.effects.innerHTML = [...groups].map(([g, list]) => {
        const open = S.openGroups.has(g)
        return `<button class="fxm-group" type="button" data-group="${esc(g)}" data-open="${open ? 1 : 0}"><i></i>${esc(g)}<b>${list.length}</b></button>`
          + (open ? list.map((e) => `<button class="fxm-fx" type="button" data-fx="${e.id}" data-on="${e.id === S.project.effect ? 1 : 0}" ${e.needsBase && !S.base ? 'data-needs-base="1"' : ''} title="${esc(e.needsBase && !S.base ? '按底图本身扫：点一下先上传底图' : e.hint || '')}">${esc(e.label)}</button>`).join('') : '')
      }).join('')
      E.effects.querySelectorAll('[data-group]').forEach((b) => { b.onclick = () => { const g = b.dataset.group; if (S.openGroups.has(g)) S.openGroups.delete(g); else S.openGroups.add(g); renderEffects() } })
      E.effects.querySelectorAll('[data-fx]').forEach((b) => { b.onclick = () => { if (FX().effectOf(b.dataset.fx).needsBase && !S.base) { S.afterBase = 'effect:' + b.dataset.fx; E.file.click(); return } pickEffect(b.dataset.fx) } })
    }
    function pickEffect(id) {
      const e = FX().effectOf(id)
      S.project.effect = id
      S.project.params = FX().effectDefaults(id)   // 换效果 = 用这个效果的默认参数
      if (e.kind === 'basesweep') S.project.colour = { mode: e.schemeColour.mode === 'custom' ? 'custom' : 'base', value: e.schemeColour.value }   // 流金扫光默认金色，其余默认底图色
      S.project.lifecycle = e.lifecycle
      S.playhead = 0
      E.effects.querySelectorAll('[data-fx]').forEach((b) => b.setAttribute('data-on', b.dataset.fx === id ? 1 : 0))
      if (e.centered) S.selected = null
      renderShapes(); renderParams(); changed()
    }

    // ---------------------------------------------------------------- 信息 / 导出
    function setInfo(text) { E.info.textContent = text }
    function updateInfo() {
      const s = size(), ai = FX().aiDescriptor(S.project)
      setInfo(`${s.w}×${s.h} · ${(n() / FX().FPS).toFixed(1)} 秒 · ${S.project.lifecycle === 'loop' ? '循环' : '一次性'} · 交给 AI：${ai.archetype}`)
      E.info.title = ai.shape
    }
    function defaultName() {
      const f = fx(), shape = FX().SHAPES.find((x) => x.id === S.project.shape.kind)
      return f.label + (shape && f.kind !== 'particle' && !f.centered && !f.baseOnly ? ' · ' + shape.label : '')
    }

    function busy(text, ratio) {
      let b = E.window.querySelector('.fxm-busy')
      if (text == null) { if (b) b.remove(); return }
      if (!b) { b = el('div', { class: 'fxm-busy' }, '<div><div data-busytext></div><div class="fxm-bar"><i></i></div></div>'); E.window.appendChild(b) }
      b.querySelector('[data-busytext]').textContent = text
      b.querySelector('.fxm-bar>i').style.width = Math.round((ratio || 0) * 100) + '%'
    }
    async function renderMp4() {
      if (S.exportCache && S.exportCache.version === S.version) return S.exportCache
      busy('正在渲染…', 0)
      const blob = await renderProject({ project: S.project, base: S.base ? S.base.rgba : null, scriptUrls: options.scriptUrls,
        onProgress: (stage, k, all) => busy(stage === 'render' ? '正在渲染 ' + k + '/' + all : '正在编码 MP4', stage === 'render' ? (k / all) * 0.85 : 0.86 + 0.14 * (k / all)) })
      S.exportCache = { version: S.version, blob }
      return S.exportCache
    }
    async function deliver() {
      if (S.busy) return
      S.busy = true
      const playing = S.playing; S.playing = false
      try {
        const { blob } = await renderMp4()
        const s = size()
        const info = { name: options.name || defaultName(), project: clone(S.project), ai: FX().aiDescriptor(S.project), width: s.w, height: s.h, frames: n(), fps: FX().FPS }
        busy(null)
        // 2026-10-15 用户：保存到仓库、存入模板库都没什么用，去掉——只留「用作素材」，点了同时进仓库
        if (options.onSaveWarehouse) await options.onSaveWarehouse(blob, info)
        if (options.onUse) await options.onUse(blob, info)
        close()
      } catch (error) {
        busy(null); setInfo('失败：' + error.message); console.error(error)
      } finally { S.busy = false; S.playing = playing; S.lastTick = 0 }
    }

    // 存入模板库（2026-10-15 用户：存下来的模板要能再打开编辑，不能只是 MP4）：MP4 + 整份工程（含底图），窗口不关
    async function saveTemplate() {
      if (S.busy) return
      S.busy = true
      const playing = S.playing; S.playing = false
      try {
        const { blob } = await renderMp4()
        const s = size()
        busy('正在存入模板库', 0.99)
        const info = { name: options.name || defaultName(), project: clone(S.project), ai: FX().aiDescriptor(S.project), width: s.w, height: s.h, frames: n(), fps: FX().FPS }
        await options.onSaveTemplate(blob, info)
        busy(null); setInfo('已存入模板库：' + info.name)
      } catch (error) {
        busy(null); setInfo('失败：' + error.message); console.error(error)
      } finally { S.busy = false; S.playing = playing; S.lastTick = 0 }
    }

    // ---------------------------------------------------------------- 键盘 / 关闭
    function onKey(ev) {
      if (S.closed) return
      const typing = ev.target && (ev.target.tagName === 'INPUT' && ev.target.type === 'text' || ev.target.tagName === 'TEXTAREA' || ev.target.isContentEditable)
      if (ev.key === 'Escape' && S.drawing) { S.drawing = null; undo(); setHint(); renderShapes(); ev.preventDefault(); return }
      if (typing) return
      if (ev.code === 'Space') { ev.preventDefault(); if (!ev.repeat) { S.playing = !S.playing; S.lastTick = 0; syncTime() } return }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && S.selected) {
        const o = S.project.outlines[S.selected.o]
        if (o && o.points.length > 3) { snapshot(); o.points.splice(S.selected.p, 1); S.selected = null; changed() }
        ev.preventDefault(); return
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo() }
    }
    document.addEventListener('keydown', onKey, true)
    function close() {
      if (S.closed) return
      S.closed = true
      cancelAnimationFrame(S.raf)
      ro.disconnect()
      document.removeEventListener('keydown', onKey, true)
      for (const w of pool) w.terminate()
      overlay.remove()
      if (options.onClose) options.onClose()
    }
    overlay.querySelector('[data-act="close"]').onclick = close
    overlay.querySelector('[data-act="use"]').onclick = () => deliver()
    const saveBtn = overlay.querySelector('[data-act="save-template"]')
    if (saveBtn) saveBtn.onclick = () => saveTemplate()

    // ---------------------------------------------------------------- 起步
    renderEffects(); renderShapes(); renderParams(); setHint()
    if (S.project.base && S.project.base.data) loadBase(S.project.base).then(() => { layout() }).catch(() => {})
    layout(); changed()
    const api = { close, state: S, get project() { return S.project }, renderMp4: () => renderMp4().then((r) => r.blob), setShape, pickEffect, fitToBase, loadBase, setCanvas, deliver }
    root.__NovaFlowFxMakerOpen = api
    return api
  }

  root.NovaFlowFxMakerUI = { open, renderProject, renderFrames, createWorker, scriptUrl }
})(typeof self !== 'undefined' ? self : globalThis)
