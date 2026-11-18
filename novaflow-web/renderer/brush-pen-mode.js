/*
 * 笔刷的「画笔 / 钢笔」两种状态（所有笔刷共用）
 *
 * 画笔：原来的涂抹。钢笔：用和美工「钢笔抠图」同一套路径（pen-path.core.js）圈出一块区域，
 * 闭合后按笔刷当前的模式（擦除 / 修复 / 选区 / 增加权重……）把整块区域处理掉，一次撤销。
 *
 * 笔刷自己的代码几乎不动：
 *   - 靠笔迹的笔刷（美工选区 / 蒙版、视频抠图、视频编辑蒙版）：把区域用这支笔刷的细笔迹
 *     （约 1.5 像素）描一圈再逐行铺满，事件发给笔刷画布，所以羽化、模式、撤销都照旧。
 *   - 没有笔迹宽度的笔刷可以在登记时给一个 fill(el, polygon)，自己处理区域里的东西。
 *   - 登记时既没给 radius 也没给 fill 的笔刷没有钢笔状态：骨骼权重和自动权重编辑只有画笔。
 * 哪些画布是笔刷、当前是否生效，沿用 FoartBrushLine.watch 的登记（brush-straight-line.js）。
 */
(function (root) {
  'use strict'
  if (!root || !root.document || root.FoartBrushPen) return
  const doc = root.document
  const Path = () => root.FoartPenPath
  const Line = () => root.FoartBrushLine

  const POINT_PX = 9, SEGMENT_PX = 7, TINY_PX = 3
  const FILL_PX = 1.5 // 铺满区域用的笔迹半径（屏幕像素）
  const CHUNK = 90 // 每帧发给笔刷的事件数（视频抠图的待处理队列只留 512 段）
  const READY_MS = 30

  let mode = 'brush'
  let cur = null // { entry, el }
  let tool = null
  let ref = null // 路径坐标对应的画布尺寸 { w, h }
  let undo = []
  let busy = false
  let spaceDown = false
  let dragPointer = null
  let lastPointer = { pointerId: 1, pointerType: 'mouse' }
  let bar = null, overlay = null, hintEl = null

  // 只有登记了 radius 或 fill 的笔刷有钢笔状态（权重笔刷没有）
  function hasPen(found) {
    const options = found && found.entry && found.entry.options
    return !!options && (typeof options.radius === 'function' || typeof options.fill === 'function')
  }

  function freshTool() { tool = Path().createTool(); undo = []; ref = null }

  function rectOf(el) { return el.getBoundingClientRect() }

  // 画布缩放 / 改尺寸后路径跟着画布走
  function syncRef(rect) {
    if (!tool) return
    if (cur) syncView(cur.el)
    if (!ref || !tool.points.length) { ref = { w: rect.width, h: rect.height }; return }
    if (Math.abs(ref.w - rect.width) < 0.5 && Math.abs(ref.h - rect.height) < 0.5) return
    const kx = rect.width / Math.max(1e-6, ref.w), ky = rect.height / Math.max(1e-6, ref.h)
    const scale = (p) => { if (p) { p.x *= kx; p.y *= ky } }
    tool.points.forEach((p) => { scale(p); scale(p.in); scale(p.out) })
    undo.forEach((snap) => snap.points.forEach((p) => { scale(p); scale(p.in); scale(p.out) }))
    ref = { w: rect.width, h: rect.height }
  }

  // 画布不动、里面的画面自己缩放 / 平移的编辑器（骨骼动画、自动权重）：登记时给 anchor(el)
  // = { x, y, k }（画面原点在画布里的位置和缩放），路径跟着画面走
  let viewRef = null
  function syncView(el) {
    if (!tool || !cur) return
    const anchor = cur.entry.options && cur.entry.options.anchor
    if (typeof anchor !== 'function') { viewRef = null; return }
    let now = null
    try { now = anchor(el) } catch { now = null }
    if (!now || !Number.isFinite(now.x) || !Number.isFinite(now.y) || !(now.k > 0)) return
    if (!viewRef || !tool.points.length) { viewRef = { x: now.x, y: now.y, k: now.k }; return }
    if (Math.abs(viewRef.x - now.x) < 0.01 && Math.abs(viewRef.y - now.y) < 0.01 && Math.abs(viewRef.k - now.k) < 1e-9) return
    const r = now.k / viewRef.k, old = viewRef
    const move = (p) => { if (p) { p.x = (p.x - old.x) * r + now.x; p.y = (p.y - old.y) * r + now.y } }
    tool.points.forEach((p) => { move(p); move(p.in); move(p.out) })
    undo.forEach((snap) => snap.points.forEach((p) => { move(p); move(p.in); move(p.out) }))
    if (tool.drag && tool.drag.point) { move(tool.drag.point); move(tool.drag.point.in); move(tool.drag.point.out); move(tool.drag.start) }
    viewRef = { x: now.x, y: now.y, k: now.k }
  }

  function pushUndo() {
    undo.push({ points: Path().clonePoints(tool.points), closed: tool.closed })
    if (undo.length > 80) undo.shift()
  }

  function undoStep() {
    const snap = undo.pop()
    if (!snap) return false
    tool.points = snap.points; tool.closed = snap.closed; tool.drag = null; tool.hover = null
    return true
  }

  // ---- 切换条和路径层
  function ensureUi() {
    if (bar) return
    const style = doc.createElement('style')
    style.textContent = `
      .foart-brush-pen-bar{position:fixed;z-index:2147483647;display:flex;align-items:center;gap:6px;padding:3px;border-radius:8px;background:#1f1f1f;box-shadow:0 0 0 1px #2e2e2e;font:400 12px/1 system-ui,"Microsoft YaHei",sans-serif;color:#cfcfcf;user-select:none}
      .foart-brush-pen-bar[hidden]{display:none!important}
      .foart-brush-pen-bar button{all:unset;box-sizing:border-box;height:24px;padding:0 10px;border-radius:5px;font:400 12px/24px system-ui,"Microsoft YaHei",sans-serif;color:#cfcfcf;cursor:pointer;white-space:nowrap}
      .foart-brush-pen-bar button:hover{background:#2a2a2a}
      .foart-brush-pen-bar button[aria-pressed="true"]{background:#1c4136;color:#9be4cd}
      .foart-brush-pen-bar button[aria-pressed="true"]:hover{background:#215043}
      .foart-brush-pen-bar button[data-act="apply"]{background:#1ea672;color:#fff}
      .foart-brush-pen-bar button[data-act="apply"]:hover{background:#23b97f}
      .foart-brush-pen-bar button[hidden]{display:none}
      .foart-brush-pen-bar span{padding:0 6px 0 2px;color:#8c8c8c;white-space:nowrap}
      .foart-brush-pen-bar span[hidden]{display:none}
      .foart-brush-pen-layer{position:fixed;z-index:2147483647;pointer-events:none}
      .foart-brush-pen-layer[hidden]{display:none!important}`
    ;(doc.head || doc.documentElement).appendChild(style)
    bar = doc.createElement('div')
    bar.className = 'foart-brush-pen-bar'
    bar.hidden = true
    bar.setAttribute('data-novaflow-source-layout', '1')
    bar.setAttribute('data-foart-brush-pen-bar', '1')
    const button = (label, act) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.act = act; b.setAttribute('data-novaflow-source-layout', '1'); bar.appendChild(b); return b }
    button('画笔', 'brush'); button('钢笔', 'pen'); button('应用', 'apply'); button('清除', 'clear')
    hintEl = doc.createElement('span'); bar.appendChild(hintEl)
    ;['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'].forEach((type) => bar.addEventListener(type, (ev) => {
      ev.stopPropagation()
      if (type !== 'click') return
      const act = ev.target && ev.target.dataset ? ev.target.dataset.act : ''
      if (act === 'brush' || act === 'pen') setMode(act)
      else if (act === 'apply') apply()
      else if (act === 'clear') { if (tool && tool.points.length) pushUndo(); clearPath() }
    }))
    doc.body.appendChild(bar)
    overlay = doc.createElement('canvas')
    overlay.className = 'foart-brush-pen-layer'
    overlay.hidden = true
    doc.body.appendChild(overlay)
  }

  function clearPath() {
    if (!tool) return
    tool.points = []; tool.closed = false; tool.drag = null; tool.hover = null
    render()
  }

  // 钢笔状态下笔刷收不到移动，它的笔刷圈会停在原地：告诉笔刷画布指针离开了
  function hideBrushRing() {
    const el = cur && cur.el
    if (!el || !el.isConnected || !Line()) return
    const rect = rectOf(el), base = { pointerId: lastPointer.pointerId, pointerType: lastPointer.pointerType || 'mouse', clientX: 0, clientY: 0, screenX: 0, screenY: 0 }
    try { Line().fire(el, 'pointerout', rect.left - 40, rect.top - 40, base, 0); Line().fire(el, 'pointerleave', rect.left - 40, rect.top - 40, base, 0) } catch { /* 笔刷不认也无妨 */ }
  }

  function setMode(next) {
    if (busy) return
    mode = next === 'pen' ? 'pen' : 'brush'
    if (mode === 'pen') { if (!tool) freshTool(); hideBrushRing() } else { if (tool) clearPath(); if (cur && cur.el.style) cur.el.style.cursor = '' }
    render()
  }

  function render() {
    ensureUi()
    const el = cur && cur.el
    if (!el || !el.isConnected) { bar.hidden = true; overlay.hidden = true; return }
    const rect = rectOf(el)
    if (!(rect.width > 2) || !(rect.height > 2)) { bar.hidden = true; overlay.hidden = true; return }
    const pen = mode === 'pen'
    bar.hidden = false
    bar.querySelector('[data-act="brush"]').setAttribute('aria-pressed', String(!pen))
    bar.querySelector('[data-act="pen"]').setAttribute('aria-pressed', String(pen))
    const count = pen && tool ? tool.points.length : 0
    bar.querySelector('[data-act="apply"]').hidden = !(pen && count >= 3)
    bar.querySelector('[data-act="clear"]').hidden = !(pen && count > 0)
    hintEl.hidden = !pen
    hintEl.textContent = busy ? '正在处理…' : count >= 3 ? (tool.closed ? 'Enter 应用 · Esc 清除' : '点回起点闭合 · Enter 应用') : '点击加点，按住拖出曲线'
    const vw = root.innerWidth || doc.documentElement.clientWidth, vh = root.innerHeight || doc.documentElement.clientHeight
    // 登记时 barAlign: 'center' = 切换条放在画布顶部正中（左上角有别的东西的编辑器）
    const centered = cur.entry.options && cur.entry.options.barAlign === 'center'
    const left = Math.max(4, Math.min(vw - bar.offsetWidth - 4, centered ? rect.left + (rect.width - bar.offsetWidth) / 2 : rect.left + 8))
    // 画布小的时候切换条放在画布上方，不挡画面
    const small = (rect.width < 420 || rect.height < 300) && rect.top - 38 >= 4
    const top = Math.max(4, Math.min(vh - 34, small ? rect.top - 38 : rect.top + 8))
    bar.style.left = left + 'px'; bar.style.top = top + 'px'
    syncRef(rect)
    if (!pen || !tool || !tool.points.length) { overlay.hidden = true; return }
    const dpr = root.devicePixelRatio || 1
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr))
    if (overlay.width !== w) overlay.width = w
    if (overlay.height !== h) overlay.height = h
    overlay.style.left = rect.left + 'px'; overlay.style.top = rect.top + 'px'
    overlay.style.width = rect.width + 'px'; overlay.style.height = rect.height + 'px'
    overlay.hidden = false
    const ctx = overlay.getContext('2d')
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    Path().draw(ctx, tool, (px) => px, { fill: 'rgba(30,166,114,0.22)', stroke: 'rgba(155,228,205,0.98)' })
  }

  // 找出当前生效的笔刷画布；没有就收起切换条
  function refresh() {
    if (!Line() || !Path()) return
    const list = Line().activeTargets().filter((found) => { const r = rectOf(found.el); return hasPen(found) && r.width > 2 && r.height > 2 })
    const keep = cur && list.find((found) => found.el === cur.el)
    const next = keep || list[0] || null
    if (!next) {
      if (cur) { cur = null; if (tool) clearPath() }
      if (bar) { bar.hidden = true; overlay.hidden = true }
      return
    }
    if (!cur || cur.el !== next.el) {
      cur = next
      if (tool) clearPath()
      // 全屏的编辑器（自动权重）是后加进页面的同层级浮层：换画布时把切换条挪到最后，保持在最上面
      ensureUi()
      doc.body.appendChild(overlay); doc.body.appendChild(bar)
    } else cur = next
    render()
  }

  // ---- 指针：FoartBrushLine 在捕获阶段先问这里要不要接管
  function consume(ev) { ev.preventDefault(); ev.stopImmediatePropagation() }

  function localPoint(ev, rect) { return { x: ev.clientX - rect.left, y: ev.clientY - rect.top } }

  function handle(ev) {
    if (mode !== 'pen' || !Path() || !Line()) return false
    const type = ev.type
    if (type === 'pointerdown') {
      if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || spaceDown) return false
      const found = Line().findTarget(ev.target)
      if (!found || !hasPen(found) || !Line().activeFor(found, ev)) return false
      consume(ev)
      if (busy) return true
      if (!cur || cur.el !== found.el) { cur = found; freshTool() }
      if (!tool) freshTool()
      const rect = rectOf(found.el)
      syncRef(rect)
      lastPointer = { pointerId: ev.pointerId, pointerType: ev.pointerType || 'mouse', screenX: ev.screenX, screenY: ev.screenY, clientX: ev.clientX, clientY: ev.clientY }
      Path().pointerDown(tool, ev, localPoint(ev, rect), POINT_PX, SEGMENT_PX, pushUndo)
      if (tool.drag) { dragPointer = ev.pointerId; try { found.el.setPointerCapture(ev.pointerId) } catch { /* 指针已松开 */ } }
      found.el.style.cursor = Path().cursorFor(ev, tool.hover)
      render()
      return true
    }
    if (type === 'pointermove') {
      if (!cur || !tool) return false
      const dragging = tool.drag && ev.pointerId === dragPointer
      if (!dragging) {
        if (Number(ev.buttons) & 1) return false
        const found = Line().findTarget(ev.target)
        if (!found || found.el !== cur.el || !Line().activeFor(found, ev)) return false
      }
      consume(ev)
      if (busy) return true
      const rect = rectOf(cur.el)
      syncRef(rect)
      Path().pointerMove(tool, ev, localPoint(ev, rect), POINT_PX, SEGMENT_PX, rect.width, rect.height)
      cur.el.style.cursor = Path().cursorFor(ev, tool.hover)
      render()
      return true
    }
    if (type === 'pointerup' || type === 'pointercancel') {
      if (!cur || !tool || !tool.drag || ev.pointerId !== dragPointer) return false
      consume(ev)
      Path().pointerUp(tool, TINY_PX)
      dragPointer = null
      try { cur.el.releasePointerCapture(ev.pointerId) } catch { /* 已释放 */ }
      render()
      return true
    }
    return false
  }

  // ---- 应用：把闭合区域交给笔刷
  function apply() {
    if (busy || mode !== 'pen' || !cur || !tool || tool.points.length < 3) return
    const el = cur.el
    if (!el.isConnected) return
    const rect = rectOf(el)
    syncRef(rect)
    tool.closed = true
    const polygon = Path().flatten(tool, 2).map((p) => ({ x: rect.left + p.x, y: rect.top + p.y }))
    if (polygon.length < 3) return
    const options = cur.entry.options || {}
    const done = () => { busy = false; undo = []; clearPath(); hideBrushRing() }
    busy = true
    render()
    if (typeof options.fill === 'function') {
      try { options.fill(el, polygon) } catch (error) { try { console.warn('[brush-pen] fill', error) } catch {} }
      done()
      return
    }
    let radius = 11
    try { if (typeof options.radius === 'function') radius = Number(options.radius(el)) || radius } catch { /* 用默认值 */ }
    strokeFill(el, rect, polygon, Math.max(0.5, radius)).then(done, done)
  }

  // 区域 -> 一笔细笔迹：先沿边描一圈，再逐行铺满；行与行之间沿着边走，不越出区域
  function fillRoute(polygon, rect, step) {
    const clampX = (x) => Math.max(rect.left + 1, Math.min(rect.right - 1, x))
    const clampY = (y) => Math.max(rect.top + 1, Math.min(rect.bottom - 1, y))
    const P = polygon.map((p) => ({ x: clampX(p.x), y: clampY(p.y) }))
    const n = P.length
    const route = P.map((p) => [p.x, p.y])
    route.push([P[0].x, P[0].y])
    let at = { edge: 0, t: 0 }
    const pointAt = (pos) => { const a = P[pos.edge], b = P[(pos.edge + 1) % n]; return [a.x + (b.x - a.x) * pos.t, a.y + (b.y - a.y) * pos.t] }
    const lengthOf = (list) => { let sum = 0; for (let i = 1; i < list.length; i++) sum += Math.hypot(list[i][0] - list[i - 1][0], list[i][1] - list[i - 1][1]); return sum }
    const walk = (from, to) => {
      const start = pointAt(from), end = pointAt(to)
      const forward = [start], backward = [start]
      if (!(from.edge === to.edge && to.t >= from.t)) { let e = from.edge; do { e = (e + 1) % n; forward.push([P[e].x, P[e].y]) } while (e !== to.edge) }
      forward.push(end)
      if (!(from.edge === to.edge && to.t <= from.t)) { let e = from.edge; for (;;) { backward.push([P[e].x, P[e].y]); if (e === (to.edge + 1) % n) break; e = (e - 1 + n) % n } }
      backward.push(end)
      return lengthOf(forward) <= lengthOf(backward) ? forward : backward
    }
    let minY = Infinity, maxY = -Infinity
    for (const p of P) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y) }
    let flip = false
    for (let y = minY + step / 2; y < maxY; y += step) {
      const hits = []
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n]
        if ((a.y > y) === (b.y > y)) continue
        const t = (y - a.y) / (b.y - a.y)
        hits.push({ x: a.x + (b.x - a.x) * t, edge: i, t })
      }
      hits.sort((p, q) => p.x - q.x)
      const spans = []
      for (let i = 0; i + 1 < hits.length; i += 2) spans.push(flip ? [hits[i + 1], hits[i]] : [hits[i], hits[i + 1]])
      if (flip) spans.reverse()
      for (const [a, b] of spans) {
        const path = walk(at, a)
        for (let i = 1; i < path.length; i++) route.push(path[i])
        route.push([b.x, y])
        at = { edge: b.edge, t: b.t }
      }
      flip = !flip
    }
    return route
  }

  function nextFrame() {
    return new Promise((resolve) => {
      let settled = false
      const finish = () => { if (!settled) { settled = true; resolve() } }
      try { root.requestAnimationFrame(finish) } catch { /* 没有 rAF */ }
      root.setTimeout(finish, 60) // 页面在后台时 rAF 不走
    })
  }

  async function strokeFill(el, rect, polygon, radius) {
    const fill = Math.min(radius, FILL_PX)
    const route = fillRoute(polygon, rect, Math.max(1, fill))
    if (route.length < 2) return
    const base = { pointerId: lastPointer.pointerId, pointerType: lastPointer.pointerType || 'mouse', scale: fill / radius,
      clientX: lastPointer.clientX || 0, clientY: lastPointer.clientY || 0, screenX: lastPointer.screenX || 0, screenY: lastPointer.screenY || 0 }
    const fire = Line().fire
    fire(el, 'pointerdown', route[0][0], route[0][1], base, 1)
    await new Promise((resolve) => root.setTimeout(resolve, READY_MS))
    for (let i = 1; i < route.length; i += CHUNK) {
      if (!el.isConnected) return
      for (let k = i; k < Math.min(route.length, i + CHUNK); k++) fire(el, 'pointermove', route[k][0], route[k][1], base, 1)
      await nextFrame()
    }
    const last = route[route.length - 1]
    fire(el, 'pointerup', last[0], last[1], base, 0)
    await nextFrame()
  }

  // ---- 键盘：路径上有点时 Enter 应用、Esc 清除、Ctrl+Z / 退格 撤一步
  function typing(target) {
    const tag = String(target && target.tagName || '').toLowerCase()
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!(target && target.isContentEditable)
  }

  function onKeyDown(ev) {
    if (ev.code === 'Space') spaceDown = true
    if (mode !== 'pen' || !cur || !tool || !tool.points.length || typing(ev.target)) return
    const key = String(ev.key || '')
    let used = true
    if (key === 'Enter') apply()
    else if (key === 'Escape') { pushUndo(); clearPath() }
    else if ((ev.ctrlKey || ev.metaKey) && key.toLowerCase() === 'z') { if (!busy) { undoStep(); render() } }
    else if (key === 'Backspace' || key === 'Delete') { if (!busy) { pushUndo(); if (tool.closed) tool.closed = false; else tool.points.pop(); tool.drag = null; tool.hover = null; render() } }
    else if (key === 'Shift' || key === 'Alt') { used = false; if (tool.hover) { const m = Path().modifierAction(ev, tool.hover); tool.hover = Object.assign({}, tool.hover, { modifier: m }); render() } }
    else used = false
    if (used) { ev.preventDefault(); ev.stopImmediatePropagation() }
  }

  function onKeyUp(ev) {
    if (ev.code === 'Space') spaceDown = false
    if (mode === 'pen' && tool && tool.hover && (ev.key === 'Shift' || ev.key === 'Alt')) { tool.hover = Object.assign({}, tool.hover, { modifier: Path().modifierAction(ev, tool.hover) }); render() }
  }

  root.addEventListener('keydown', onKeyDown, true)
  root.addEventListener('keyup', onKeyUp, true)
  root.addEventListener('blur', () => { spaceDown = false })
  root.addEventListener('resize', () => { if (cur) render() })
  root.addEventListener('scroll', () => { if (cur) render() }, true)
  root.addEventListener('wheel', () => { if (cur) root.setTimeout(render, 0) }, { capture: true, passive: true })
  root.setInterval(refresh, 300)

  root.FoartBrushPen = {
    handle, apply, setMode, refresh,
    get mode() { return mode },
    get points() { return tool ? tool.points.length : 0 },
    get busy() { return busy },
    get _tool() { return tool },
    _fillRoute: fillRoute
  }
})(typeof window !== 'undefined' ? window : null)
