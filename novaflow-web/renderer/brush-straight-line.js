/*
 * Shift 直线（所有笔刷共用）
 *
 * Photoshop 的习惯：
 *   - 按住 Shift 点一下：从上一笔的终点到这一点画一条直线（一笔，Ctrl+Z 一次撤掉）。
 *   - 按住 Shift 拖动：笔画锁成直线，方向吸附到水平 / 垂直 / 45 度。
 *
 * 笔刷自己的代码不改：这里在 window 捕获阶段接住真实的指针事件，换成落在直线上的
 * 指针事件再发给笔刷画布，所以笔刷大小、羽化、擦除 / 修复模式和撤销都照旧由笔刷处理。
 * 发出的事件不带 Shift，免得笔刷把它当成连选、平移等别的操作。
 *
 * 用法：FoartBrushLine.watch(selectorOrElement, isActive)
 *   isActive(el, event) 为真时，这块画布当前是笔刷（不是吸管、框选等别的工具）。
 *
 * 手感（鼠标和笔都一样）：
 *   - 浏览器每帧只发一次 pointermove，两帧之间的采样都合在 getCoalescedEvents() 里。
 *     这里把它们全部取出，连成圆滑的曲线再发给笔刷画布，快画也没有折角。
 *   - FoartBrushLine.pressure(event) 给出笔压对应的笔刷比例（0.1–1），鼠标恒为 1；
 *     各笔刷用它缩放笔刷半径（权重笔刷缩放力度），所以有轻重粗细的笔触。
 */
(function (root) {
  'use strict'
  if (!root || typeof root.addEventListener !== 'function' || root.FoartBrushLine) return

  const STEP_PX = 3 // 合成移动点的间距：逐点盖章的笔刷也连成线
  const LOCK_PX = 8 // 拖出这么远才定方向
  const READY_MS = 30 // 落笔后等笔刷把（可能是异步的）起笔做完
  const targets = []
  const lastEnd = new Map() // key -> { fx, fy } 画布上的相对位置
  const mine = new WeakSet()
  let stroke = null
  let plain = null

  const MIN_PRESSURE_SCALE = 0.1
  // 笔压 -> 笔刷比例。只认笔：鼠标、触摸和松开时都是 1，笔刷保持原来的大小。
  function pressure(ev) {
    if (!ev || ev.pointerType !== 'pen' || !(Number(ev.buttons) & 1)) return 1
    const p = Number(ev.pressure)
    if (!Number.isFinite(p) || p <= 0) return 1
    return MIN_PRESSURE_SCALE + (1 - MIN_PRESSURE_SCALE) * Math.min(1, p)
  }

  // 笔在 touch-action: auto 的画布上拖几像素就被浏览器当成平移手势，发 pointercancel 结束笔画，
  // 画出来只剩一个点（视频抠图擦除/修复用笔“画不上”）。所有笔刷画布都关掉浏览器手势。
  let touchSheet = null
  function noTouchGestures(target) {
    if (typeof target !== 'string') { if (target.style) target.style.touchAction = 'none'; return }
    if (!root.document) return
    if (!touchSheet) { touchSheet = root.document.createElement('style'); touchSheet.setAttribute('data-foart-brush-touch', '1'); (root.document.head || root.document.documentElement).appendChild(touchSheet) }
    touchSheet.textContent += `${target}{touch-action:none !important}\n`
  }

  function watch(target, isActive) {
    if (!target) return () => {}
    noTouchGestures(target)
    const entry = { target, key: target, isActive: typeof isActive === 'function' ? isActive : () => true }
    targets.push(entry)
    return () => { const i = targets.indexOf(entry); if (i >= 0) targets.splice(i, 1); lastEnd.delete(entry.key) }
  }

  function findTarget(node) {
    const el = node && node.nodeType === 1 ? node : node && node.parentElement
    if (!el) return null
    for (const entry of targets) {
      let hit = null
      if (typeof entry.target === 'string') hit = el.closest(entry.target)
      else if (entry.target === el || (entry.target.contains && entry.target.contains(el))) hit = entry.target
      if (hit && hit.isConnected) return { entry, el: hit }
    }
    return null
  }

  function activeFor(found, ev) {
    try { return !!found.entry.isActive(found.el, ev) } catch { return false }
  }

  function toFraction(el, x, y) {
    const r = el.getBoundingClientRect()
    if (!(r.width > 0) || !(r.height > 0)) return null
    return { fx: (x - r.left) / r.width, fy: (y - r.top) / r.height }
  }

  function fromFraction(el, f) {
    const r = el.getBoundingClientRect()
    if (!f || !(r.width > 0) || !(r.height > 0)) return null
    return [r.left + f.fx * r.width, r.top + f.fy * r.height]
  }

  function fire(el, type, x, y, base, buttons) {
    const init = {
      bubbles: true, cancelable: true, composed: true, view: root,
      clientX: x, clientY: y,
      screenX: x + (Number(base.screenX) - Number(base.clientX) || 0),
      screenY: y + (Number(base.screenY) - Number(base.clientY) || 0),
      pointerId: base.pointerId, pointerType: base.pointerType || 'mouse', isPrimary: true,
      button: type === 'pointermove' ? -1 : 0, buttons,
      pressure: buttons ? (base.pressure > 0 ? base.pressure : 0.5) : 0, width: 1, height: 1,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false
    }
    const Ctor = typeof root.PointerEvent === 'function' ? root.PointerEvent : root.MouseEvent
    const ev = new Ctor(type, init)
    mine.add(ev)
    if (!el.isConnected) return
    el.dispatchEvent(ev)
  }

  function lineTo(s, x, y) {
    const [x0, y0] = s.last
    const n = Math.max(1, Math.ceil(Math.hypot(x - x0, y - y0) / STEP_PX))
    for (let i = 1; i <= n; i++) fire(s.el, 'pointermove', x0 + (x - x0) * i / n, y0 + (y - y0) * i / n, s.base, 1)
    s.last = [x, y]
  }

  // 拖动锁直线：拖出 LOCK_PX 后按 45 度吸附定下方向，之后只沿这条线走
  function constrained(s, x, y) {
    const [ax, ay] = s.anchor
    const dx = x - ax, dy = y - ay
    if (!s.dir) {
      if (Math.hypot(dx, dy) < LOCK_PX) return null
      const step = Math.PI / 4
      const a = Math.round(Math.atan2(dy, dx) / step) * step
      s.dir = [Math.cos(a), Math.sin(a)]
    }
    const len = dx * s.dir[0] + dy * s.dir[1]
    return [ax + s.dir[0] * len, ay + s.dir[1] * len]
  }

  function enqueue(s, fn) {
    s.queue = s.queue.then(() => { if (s.el.isConnected) fn() }).catch(() => {})
  }

  function onDown(ev) {
    if (mine.has(ev)) return
    plain = null
    if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.altKey) return
    const found = findTarget(ev.target)
    if (!found || !activeFor(found, ev)) return
    if (!ev.shiftKey) {
      const first = [ev.clientX, ev.clientY, Number(ev.pressure) > 0 ? Number(ev.pressure) : 0.5]
      plain = { key: found.entry.key, el: found.el, pointerId: ev.pointerId, time: Number(ev.timeStamp) || 0, pressure: first[2], last: first, from: first,
        base: { pointerId: ev.pointerId, pointerType: ev.pointerType, pressure: first[2], clientX: ev.clientX, clientY: ev.clientY, screenX: ev.screenX, screenY: ev.screenY } }
      return
    }
    ev.preventDefault()
    ev.stopImmediatePropagation()
    const press = [ev.clientX, ev.clientY]
    const base = { pointerId: ev.pointerId, pointerType: ev.pointerType, pressure: ev.pressure, clientX: ev.clientX, clientY: ev.clientY, screenX: ev.screenX, screenY: ev.screenY }
    // 先不落笔：松开时没拖动 = 点击，从上一笔终点连过来；拖出去了 = 从按下处画锁定直线
    stroke = { key: found.entry.key, el: found.el, base, press, from: fromFraction(found.el, lastEnd.get(found.entry.key)),
      started: false, last: null, anchor: press, dir: null, pending: null, queue: Promise.resolve() }
    try { found.el.setPointerCapture(ev.pointerId) } catch { /* 指针已松开 */ }
  }

  function start(s, at) {
    s.started = true
    s.last = at
    fire(s.el, 'pointerdown', at[0], at[1], s.base, 1)
    try { s.el.setPointerCapture(s.base.pointerId) } catch { /* 笔刷已经捕获或指针已松开 */ }
    s.queue = new Promise((resolve) => setTimeout(resolve, READY_MS))
  }

  // 普通笔画（鼠标、笔、触摸都走这里）：像 Photoshop 那样把采样点连成圆滑的曲线。
  //   - 一帧里合并掉的采样点全部取出来用（getCoalescedEvents）
  //   - 相邻采样点的中点之间走二次曲线，采样点本身当控制点：转弯处没有折角，
  //     只比指针慢半个采样间隔；抬笔时补到真实的终点
  //   - 笔压做一点时间上的平滑，粗细变化连续，不随每个采样点跳
  const PRESSURE_TAU_MS = 12
  const FLATNESS_PX = 0.1
  function strokeSample(p, c, fallback) {
    const x = Number(c.clientX), y = Number(c.clientY)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    const raw = Number(c.pressure) > 0 ? Number(c.pressure) : Number(fallback.pressure) > 0 ? Number(fallback.pressure) : 0.5
    const t = Number(c.timeStamp) || 0
    const dt = Math.max(1, Math.min(50, t - p.time || 4))
    p.time = t || p.time
    p.pressure += (raw - p.pressure) * (1 - Math.exp(-dt / PRESSURE_TAU_MS))
    return [x, y, p.pressure]
  }

  function emit(p, x, y, pressure, buttons) {
    p.base.pressure = pressure
    fire(p.el, 'pointermove', x, y, p.base, buttons)
  }

  // 从 p.from 经控制点 c 到 to 的二次曲线，按弯曲程度切成小直线段发给笔刷
  function curveTo(p, c, to, buttons) {
    const a = p.from
    const bend = Math.hypot(a[0] - 2 * c[0] + to[0], a[1] - 2 * c[1] + to[1])
    const n = Math.max(1, Math.min(24, Math.ceil(Math.sqrt(bend / (8 * FLATNESS_PX)))))
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t
      emit(p, u * u * a[0] + 2 * u * t * c[0] + t * t * to[0], u * u * a[1] + 2 * u * t * c[1] + t * t * to[1], a[2] + (to[2] - a[2]) * t, buttons)
    }
    p.from = to
  }

  function plainMove(ev) {
    const p = plain
    if (!p || ev.pointerId !== p.pointerId || !(Number(ev.buttons) & 1) || !p.el.isConnected) return false
    let list = null
    try { list = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : null } catch { list = null }
    if (!list || !list.length) list = [ev]
    ev.preventDefault()
    ev.stopImmediatePropagation()
    for (const c of list) {
      const q = strokeSample(p, c, ev)
      if (!q || Math.hypot(q[0] - p.last[0], q[1] - p.last[1]) < 0.3) continue
      curveTo(p, p.last, [(p.last[0] + q[0]) / 2, (p.last[1] + q[1]) / 2, (p.last[2] + q[2]) / 2], ev.buttons)
      p.last = q
    }
    return true
  }

  // 抬笔：把还没画到的半段补完，停在真实的终点
  function plainFinish(ev) {
    const p = plain
    if (!p || !p.el.isConnected || ev.type !== 'pointerup') return
    const end = [Number(ev.clientX), Number(ev.clientY), p.last[2]]
    if (!Number.isFinite(end[0]) || !Number.isFinite(end[1])) return
    if (Math.hypot(p.from[0] - p.last[0], p.from[1] - p.last[1]) >= 0.3 || Math.hypot(end[0] - p.last[0], end[1] - p.last[1]) >= 0.3) curveTo(p, p.last, end, 1)
  }

  function onMove(ev) {
    if (mine.has(ev)) return
    if (!stroke) { plainMove(ev); return }
    if (ev.pointerId !== stroke.base.pointerId) return
    ev.preventDefault()
    ev.stopImmediatePropagation()
    const s = stroke
    if (Number(ev.pressure) > 0) s.base.pressure = ev.pressure
    if (!s.started) {
      if (Math.hypot(ev.clientX - s.press[0], ev.clientY - s.press[1]) < LOCK_PX) return
      start(s, s.press)
    }
    const wasPending = !!s.pending
    s.pending = [ev.clientX, ev.clientY]
    if (wasPending) return
    enqueue(s, () => {
      const p = s.pending; s.pending = null
      if (!p) return
      const q = constrained(s, p[0], p[1])
      if (q) lineTo(s, q[0], q[1])
    })
  }

  function onEnd(ev) {
    if (mine.has(ev)) return
    if (plain && ev.pointerId === plain.pointerId) {
      plainFinish(ev)
      const f = plain.el.isConnected ? toFraction(plain.el, ev.clientX, ev.clientY) : null
      if (f) lastEnd.set(plain.key, f)
      plain = null
    }
    if (!stroke || ev.pointerId !== stroke.base.pointerId) return
    ev.preventDefault()
    ev.stopImmediatePropagation()
    const s = stroke
    stroke = null
    const type = ev.type
    if (!s.started) {
      if (type === 'pointercancel') return
      if (s.from) { start(s, s.from); enqueue(s, () => lineTo(s, s.press[0], s.press[1])) }
      else start(s, s.press)
    }
    enqueue(s, () => {
      const p = s.pending; s.pending = null
      if (p) { const q = constrained(s, p[0], p[1]); if (q) lineTo(s, q[0], q[1]) }
      fire(s.el, type, s.last[0], s.last[1], s.base, 0)
      try { s.el.releasePointerCapture(s.base.pointerId) } catch { /* 已释放 */ }
      const f = toFraction(s.el, s.last[0], s.last[1])
      if (f) lastEnd.set(s.key, f)
    })
  }

  // 缩放后画面位置变了，上一笔的终点不再可信
  function onWheel(ev) {
    const found = findTarget(ev.target)
    if (found) lastEnd.delete(found.entry.key)
  }

  root.addEventListener('pointerdown', onDown, true)
  root.addEventListener('pointermove', onMove, true)
  root.addEventListener('pointerup', onEnd, true)
  root.addEventListener('pointercancel', onEnd, true)
  root.addEventListener('wheel', onWheel, { capture: true, passive: true })

  root.FoartBrushLine = { watch, pressure, hint: 'Shift 直线' }

  // 视频抠图（擦除 / 修复）：吸管取色时光标是吸管图，不接管
  watch('[data-novaflow-ai-cutout-edit-canvas]', (el) => !/^url\(/.test(String(el.style.cursor || '')))
  // 美工拆图：选区 / 局部重绘 / 去除物体的涂抹画笔，和图层蒙版编辑的擦除 / 恢复画笔
  watch('[data-novaflow-selection-tool-canvas]', () => true)
  watch('[data-novaflow-mask-tool-canvas]', () => true)
})(typeof window !== 'undefined' ? window : null)
