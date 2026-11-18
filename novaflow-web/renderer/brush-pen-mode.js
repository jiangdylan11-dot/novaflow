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
  let downPointer = null
  let lastPointer = { pointerId: 1, pointerType: 'mouse' }
  let overlay = null

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

  // ---- 路径层。切换按钮不在这里：每个版块画板上方的工具条自己放（见文件头的「工具条约定」）
  function ensureUi() {
    if (overlay) return
    const style = doc.createElement('style')
    style.textContent = '.foart-brush-pen-layer{position:fixed;z-index:2147483647;pointer-events:none}.foart-brush-pen-layer[hidden]{display:none!important}' +
      'body[data-foart-brush-mode="pen"] :is([data-novaflow-selection-brush-cursor],[data-novaflow-mask-brush-cursor],[data-novaflow-ai-cutout-brush-cursor],.nf-ve-brush,.nf-ve-brush-feather){display:none!important}'
    ;(doc.head || doc.documentElement).appendChild(style)
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

  function hintText() {
    const count = tool ? tool.points.length : 0
    return busy ? '正在处理…' : count >= 3 ? (tool.closed ? 'Enter 应用 · Esc 清除' : '点回起点闭合 · Enter 应用') : '点击加点，按住拖出曲线'
  }

  // 工具条约定：工具条里的元素用这些标记，这里按当前状态显示 / 隐藏、写文字
  //   data-foart-pen-when="brush" | "pen"   只在画笔 / 钢笔状态显示（笔刷滑条 / 应用、清除、提示）
  //   data-foart-brush-toggle               「画笔 N」那个按钮，点它切换；钢笔时显示「钢笔」
  //   data-foart-pen-hint                   提示文字
  //   data-foart-pen-need="path"            路径不到 3 个点时不可用（应用）
  function syncControls() {
    const pen = mode === 'pen'
    // 钢笔状态下各版块的笔刷圈不显示（样式在 ensureUi 里），指针在画板外面时笔刷也收不到「离开」
    if (doc.body && doc.body.getAttribute('data-foart-brush-mode') !== (pen ? 'pen' : 'brush')) doc.body.setAttribute('data-foart-brush-mode', pen ? 'pen' : 'brush')
    const count = pen && tool ? tool.points.length : 0
    doc.querySelectorAll('[data-foart-pen-when]').forEach((el) => {
      const show = (el.getAttribute('data-foart-pen-when') === 'pen') === pen
      const hiddenNow = el.getAttribute('data-foart-pen-hidden') === '1'
      if (show && hiddenNow) {
        const was = el.getAttribute('data-foart-pen-display') || ''
        if (was) el.style.setProperty('display', was); else el.style.removeProperty('display')
        el.removeAttribute('data-foart-pen-hidden')
      } else if (!show && !hiddenNow) {
        el.setAttribute('data-foart-pen-display', el.style.display || '')
        el.setAttribute('data-foart-pen-hidden', '1')
        el.style.setProperty('display', 'none', 'important')
      }
    })
    doc.querySelectorAll('[data-foart-brush-toggle]').forEach((el) => {
      const value = pen ? 'pen' : 'brush'
      if (el.getAttribute('data-foart-brush-toggle') !== value) el.setAttribute('data-foart-brush-toggle', value)
      const title = pen ? '当前是钢笔：点击切回画笔' : '当前是画笔：点击切换到钢笔'
      if (el.title !== title) el.title = title
    })
    const hint = pen ? hintText() : ''
    doc.querySelectorAll('[data-foart-pen-hint]').forEach((el) => { if (el.textContent !== hint) el.textContent = hint })
    doc.querySelectorAll('[data-foart-pen-need="path"]').forEach((el) => {
      const off = count < 3 || busy
      if (!!el.disabled !== off) el.disabled = off
      const opacity = off ? '0.45' : ''
      if (el.style.opacity !== opacity) el.style.opacity = opacity
    })
  }

  function render() {
    ensureUi()
    syncControls()
    const el = cur && cur.el
    if (!el || !el.isConnected) { overlay.hidden = true; return }
    const rect = rectOf(el)
    if (!(rect.width > 2) || !(rect.height > 2)) { overlay.hidden = true; return }
    const pen = mode === 'pen'
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

  // 找出当前生效的笔刷画布；没有笔刷在用时回到画笔状态
  function refresh() {
    if (!Line() || !Path()) return
    const list = Line().activeTargets().filter((found) => { const r = rectOf(found.el); return hasPen(found) && r.width > 2 && r.height > 2 })
    const keep = cur && list.find((found) => found.el === cur.el)
    const next = keep || list[0] || null
    if (!next) {
      if (cur) { cur = null; if (tool) clearPath() }
      if (mode !== 'brush' && !busy) mode = 'brush'
      if (overlay) overlay.hidden = true
      syncControls()
      return
    }
    if (!cur || cur.el !== next.el) {
      cur = next
      if (tool) clearPath()
      ensureUi()
      doc.body.appendChild(overlay) // 后加进页面的全屏浮层会盖住路径层：换画布时挪到最后
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
      downPointer = ev.pointerId
      hideBrushRing() // 指针进画布时笔刷已经把圈画出来了
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
      // 这一下按下是钢笔接的，松开也不给笔刷（不然笔刷圈会跟过来）
      const mine = downPointer != null && ev.pointerId === downPointer
      downPointer = null
      if (!cur || !tool || !tool.drag || ev.pointerId !== dragPointer) { if (mine) consume(ev); return mine }
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
  // 工具条重画（美工每次同步都会重建）后马上按当前状态补上显示 / 隐藏，不等下一次轮询
  try { new root.MutationObserver(() => { if (mode === 'pen') syncControls() }).observe(doc.documentElement, { childList: true, subtree: true }) } catch { /* 没有也只是慢 0.3 秒 */ }
  root.addEventListener('scroll', () => { if (cur) render() }, true)
  root.addEventListener('wheel', () => { if (cur) root.setTimeout(render, 0) }, { capture: true, passive: true })
  root.setInterval(refresh, 300)

  root.FoartBrushPen = {
    handle, apply, setMode, refresh, syncControls,
    toggle() { setMode(mode === 'pen' ? 'brush' : 'pen') },
    clear() { if (busy || !tool) return; if (tool.points.length) pushUndo(); clearPath() },
    get hint() { return hintText() },
    get mode() { return mode },
    get points() { return tool ? tool.points.length : 0 },
    get busy() { return busy },
    get _tool() { return tool },
    _fillRoute: fillRoute
  }
})(typeof window !== 'undefined' ? window : null)
