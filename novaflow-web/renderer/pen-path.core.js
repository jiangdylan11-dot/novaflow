/*
 * 钢笔路径（共用）
 *
 * 美工「钢笔抠图 / 钢笔补图」和所有笔刷的「钢笔」状态用的是同一套路径逻辑：
 *   - 点击加端点，按住拖动拉出曲线滑杆；点回第一个点闭合
 *   - 点在线段上加端点；Shift 点端点删除；Alt 点端点转直角，再拖出单侧滑杆
 *   - 拖端点移动，拖滑杆改曲线（Alt 拖 = 只动一侧）
 *
 * 这里只管路径本身：tool = { points: [{ x, y, in, out }], closed, drag, hover }。
 * 坐标是调用方自己的坐标（画布像素或屏幕像素都行），unit(px) 把屏幕像素换成那套坐标的长度。
 * 画在哪、闭合后拿路径做什么，由调用方决定。
 */
(function (root) {
  'use strict'
  if (!root || root.FoartPenPath) return

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const distance = (a, b) => Math.hypot((a && a.x || 0) - (b && b.x || 0), (a && a.y || 0) - (b && b.y || 0))
  const lerp = (a, b, t) => ({ x: (a && a.x || 0) + ((b && b.x || 0) - (a && a.x || 0)) * t, y: (a && a.y || 0) + ((b && b.y || 0) - (a && a.y || 0)) * t })
  const cloneHandle = (h) => (h ? { x: h.x, y: h.y } : null)
  const clonePoint = (p) => ({ x: p.x, y: p.y, in: cloneHandle(p.in), out: cloneHandle(p.out) })
  const clonePoints = (points) => (points || []).map(clonePoint)

  function createTool() {
    return { points: [], closed: false, drag: null, hover: null }
  }

  function cubicPoint(p0, p1, p2, p3, t) {
    const p01 = lerp(p0, p1, t), p12 = lerp(p1, p2, t), p23 = lerp(p2, p3, t)
    return lerp(lerp(p01, p12, t), lerp(p12, p23, t), t)
  }

  function pointToLineDistance(point, a, b) {
    const dx = (b && b.x || 0) - (a && a.x || 0)
    const dy = (b && b.y || 0) - (a && a.y || 0)
    const lenSq = dx * dx + dy * dy
    if (lenSq <= 0.0001) return { distance: distance(point, a), t: 0, point: { x: a.x, y: a.y } }
    const t = clamp((((point.x - a.x) * dx) + ((point.y - a.y) * dy)) / lenSq, 0, 1)
    const projected = { x: a.x + dx * t, y: a.y + dy * t }
    return { distance: distance(point, projected), t, point: projected }
  }

  // radius：点到线段算命中的距离（调用方坐标）
  function segmentHitTest(tool, point, radius) {
    const points = tool && tool.points || []
    if (points.length < 2) return null
    const segmentCount = tool.closed ? points.length : points.length - 1
    let best = null
    for (let index = 0; index < segmentCount; index += 1) {
      const current = points[index]
      const nextIndex = (index + 1) % points.length
      const next = points[nextIndex]
      if (!current || !next) continue
      if (!(current.out || next.in)) {
        const hit = pointToLineDistance(point, current, next)
        if (!best || hit.distance < best.distance) best = { type: 'segment', index, nextIndex, t: hit.t, point: hit.point, distance: hit.distance }
        continue
      }
      const p1 = current.out || current, p2 = next.in || next
      const samples = 44
      for (let step = 1; step < samples; step += 1) {
        const t = step / samples
        const sample = cubicPoint(current, p1, p2, next, t)
        const d = distance(point, sample)
        if (!best || d < best.distance) best = { type: 'segment', index, nextIndex, t, point: sample, distance: d }
      }
    }
    return best && best.distance <= radius ? best : null
  }

  // pointRadius：端点 / 滑杆的命中半径；segmentRadius：线段的命中距离
  function hitTest(tool, point, pointRadius, segmentRadius) {
    const points = tool && tool.points || []
    for (let i = points.length - 1; i >= 0; i -= 1) {
      const item = points[i]
      if (item.out && distance(point, item.out) <= pointRadius) return { type: 'handleOut', index: i }
      if (item.in && distance(point, item.in) <= pointRadius) return { type: 'handleIn', index: i }
    }
    if (!tool.closed && points.length >= 3 && distance(point, points[0]) <= pointRadius) return { type: 'close', index: 0 }
    for (let i = points.length - 1; i >= 0; i -= 1) {
      if (distance(point, points[i]) <= pointRadius) return { type: 'point', index: i }
    }
    return segmentHitTest(tool, point, segmentRadius)
  }

  function modifierAction(event, hit) {
    if (!hit || (hit.type !== 'point' && hit.type !== 'close')) return ''
    if (event && event.shiftKey) return 'delete'
    if (event && event.altKey) return 'corner'
    return ''
  }

  function cursorFor(event, hit) {
    const action = modifierAction(event, hit)
    if (action === 'delete') return 'not-allowed'
    if (action === 'corner') return 'cell'
    if (hit && hit.type === 'point') return 'move'
    if (hit && (hit.type === 'handleIn' || hit.type === 'handleOut')) return 'grab'
    if (hit && hit.type === 'segment') return 'copy'
    if (hit && hit.type === 'close') return 'pointer'
    return 'crosshair'
  }

  function pathToCanvasPath(ctx, points, closed) {
    if (!points || !points.length) return false
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    const total = closed ? points.length : points.length - 1
    for (let i = 0; i < total; i += 1) {
      const current = points[i]
      const next = points[(i + 1) % points.length]
      if (!next) continue
      const c1 = current.out || current
      const c2 = next.in || next
      if (current.out || next.in) ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, next.x, next.y)
      else ctx.lineTo(next.x, next.y)
    }
    if (closed) ctx.closePath()
    return true
  }

  function deletePointAt(tool, index) {
    if (!tool || !tool.points || index < 0 || index >= tool.points.length) return false
    tool.points.splice(index, 1)
    if (tool.points.length < 3) tool.closed = false
    tool.drag = null
    tool.hover = null
    return true
  }

  function makeCornerAt(tool, index) {
    const item = tool && tool.points && tool.points[index]
    if (!item) return false
    item.in = null
    item.out = null
    return true
  }

  function insertPointOnSegment(tool, hit) {
    const points = tool && tool.points || []
    if (!hit || hit.type !== 'segment' || hit.index < 0 || hit.index >= points.length) return -1
    const current = points[hit.index]
    const next = points[(hit.index + 1) % points.length]
    if (!current || !next) return -1
    const t = clamp(Number(hit.t) || 0.5, 0.02, 0.98)
    let newPoint
    if (current.out || next.in) {
      const p1 = current.out || current, p2 = next.in || next
      const p01 = lerp(current, p1, t), p12 = lerp(p1, p2, t), p23 = lerp(p2, next, t)
      const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t), p0123 = lerp(p012, p123, t)
      current.out = p01
      next.in = p23
      newPoint = { x: p0123.x, y: p0123.y, in: p012, out: p123 }
    } else {
      const point = hit.point || lerp(current, next, t)
      newPoint = { x: point.x, y: point.y, in: null, out: null }
    }
    const insertIndex = hit.index + 1
    points.splice(insertIndex, 0, newPoint)
    tool.drag = null
    tool.hover = { type: 'point', index: insertIndex }
    return insertIndex
  }

  // 拖动中：width / height 是可用范围（端点和滑杆不出界）
  function updateDrag(tool, event, point, width, height) {
    const drag = tool && tool.drag
    if (!drag || !tool.points || !tool.points[drag.index]) return
    const item = tool.points[drag.index]
    const original = drag.point || clonePoint(item)
    const cx = (v) => clamp(v, 0, width), cy = (v) => clamp(v, 0, height)
    if (drag.type === 'point') {
      const dx = point.x - drag.start.x
      const dy = point.y - drag.start.y
      item.x = cx(original.x + dx)
      item.y = cy(original.y + dy)
      if (original.in) item.in = { x: cx(original.in.x + dx), y: cy(original.in.y + dy) }
      if (original.out) item.out = { x: cx(original.out.x + dx), y: cy(original.out.y + dy) }
      return
    }
    if (drag.type === 'cornerHandle') {
      item.in = null
      item.out = { x: cx(point.x), y: cy(point.y) }
      return
    }
    if (drag.type === 'handleIn' || drag.type === 'handleOut' || drag.type === 'newHandle') {
      const key = drag.type === 'handleIn' ? 'in' : 'out'
      const otherKey = key === 'in' ? 'out' : 'in'
      item[key] = { x: cx(point.x), y: cy(point.y) }
      if (!(event && event.altKey)) item[otherKey] = { x: cx(item.x * 2 - point.x), y: cy(item.y * 2 - point.y) }
    }
  }

  // 按下：返回这一下做了什么（'delete' | 'corner' | 'insert' | 'close' | 'drag' | 'add' | ''），
  // 调用方据此提示、重画；改动路径之前会先调 onBeforeChange()（给调用方记撤销）
  function pointerDown(tool, event, point, pointRadius, segmentRadius, onBeforeChange) {
    const before = typeof onBeforeChange === 'function' ? onBeforeChange : () => {}
    const hit = hitTest(tool, point, pointRadius, segmentRadius)
    const action = modifierAction(event, hit)
    if (action === 'delete') { before(); return deletePointAt(tool, hit.index) ? 'delete' : '' }
    if (action === 'corner') {
      before()
      if (!makeCornerAt(tool, hit.index)) return ''
      tool.drag = { type: 'cornerHandle', index: hit.index, start: point, point: clonePoint(tool.points[hit.index]) }
      tool.hover = { type: 'point', index: hit.index, modifier: 'corner' }
      return 'corner'
    }
    if (hit && hit.type === 'segment') { before(); return insertPointOnSegment(tool, hit) >= 0 ? 'insert' : '' }
    if (hit && hit.type === 'close') { before(); tool.closed = true; tool.drag = null; tool.hover = hit; return 'close' }
    if (hit) {
      before()
      tool.drag = { type: hit.type, index: hit.index, start: point, point: clonePoint(tool.points[hit.index]) }
      tool.hover = hit
      return 'drag'
    }
    if (!tool.closed) {
      before()
      const item = { x: point.x, y: point.y, in: null, out: null }
      tool.points.push(item)
      tool.drag = { type: 'newHandle', index: tool.points.length - 1, start: point, point: clonePoint(item) }
      tool.hover = { type: 'point', index: tool.points.length - 1 }
      return 'add'
    }
    return ''
  }

  function pointerMove(tool, event, point, pointRadius, segmentRadius, width, height) {
    if (tool.drag) { updateDrag(tool, event, point, width, height); return }
    const hit = hitTest(tool, point, pointRadius, segmentRadius)
    const modifier = modifierAction(event, hit)
    tool.hover = hit ? Object.assign({}, hit, modifier ? { modifier } : {}) : null
  }

  // 松开：新端点没拖出滑杆（不到 tinyRadius）就是直角点
  function pointerUp(tool, tinyRadius) {
    const drag = tool && tool.drag
    if (!drag) return false
    const item = tool.points && tool.points[drag.index]
    if ((drag.type === 'newHandle' || drag.type === 'cornerHandle') && item) {
      if (!item.out || distance(item, item.out) <= tinyRadius) { item.in = null; item.out = null }
    }
    tool.drag = null
    return true
  }

  // 闭合路径压成多边形（曲线段按 step 采样）
  function flatten(tool, step) {
    const points = tool && tool.points || []
    const out = []
    if (points.length < 3) return out
    for (let i = 0; i < points.length; i += 1) {
      const current = points[i], next = points[(i + 1) % points.length]
      out.push({ x: current.x, y: current.y })
      if (!(current.out || next.in)) continue
      const p1 = current.out || current, p2 = next.in || next
      const length = distance(current, p1) + distance(p1, p2) + distance(p2, next)
      const n = Math.max(2, Math.min(200, Math.ceil(length / Math.max(0.5, step || 2))))
      for (let k = 1; k < n; k += 1) out.push(cubicPoint(current, p1, p2, next, k / n))
    }
    return out
  }

  function pointInPolygon(polygon, x, y) {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j]
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside
    }
    return inside
  }

  // 路径、端点和滑杆的画法（美工钢笔的样子）；fill / stroke 是这次的颜色
  function draw(ctx, tool, unit, colors) {
    const points = tool && tool.points || []
    if (!points.length) return
    const u = typeof unit === 'function' ? unit : (px) => px
    const fill = colors && colors.fill || 'rgba(56,189,248,0.30)'
    const stroke = colors && colors.stroke || 'rgba(125,211,252,0.98)'
    ctx.save()
    if (points.length >= 3) { ctx.fillStyle = fill; pathToCanvasPath(ctx, points, true); ctx.fill() }
    ctx.lineWidth = Math.max(1.25 * u(1), u(1.5))
    ctx.strokeStyle = stroke
    ctx.setLineDash(tool.closed ? [] : [u(8), u(5)])
    pathToCanvasPath(ctx, points, tool.closed)
    ctx.stroke()
    ctx.setLineDash([])
    points.forEach((item, index) => {
      const selected = tool.hover && (tool.hover.type === 'point' || tool.hover.type === 'close') && tool.hover.index === index
      const modifier = selected && tool.hover && tool.hover.modifier || ''
      ;['in', 'out'].forEach((key) => {
        const handle = item[key]
        if (!handle) return
        ctx.strokeStyle = 'rgba(255,255,255,0.72)'
        ctx.lineWidth = Math.max(1, u(1))
        ctx.beginPath(); ctx.moveTo(item.x, item.y); ctx.lineTo(handle.x, handle.y); ctx.stroke()
        ctx.fillStyle = key === 'in' ? 'rgba(251,191,36,0.98)' : 'rgba(34,197,94,0.98)'
        ctx.strokeStyle = 'rgba(20,20,20,0.94)'
        const r = u(4.5)
        ctx.beginPath(); ctx.rect(handle.x - r, handle.y - r, r * 2, r * 2); ctx.fill(); ctx.stroke()
      })
      const r = u(selected ? 6 : 5)
      ctx.fillStyle = modifier === 'delete' ? 'rgba(248,113,113,0.98)' : modifier === 'corner' ? 'rgba(251,191,36,0.98)' : index === 0 ? 'rgba(34,197,94,0.98)' : 'rgba(255,255,255,0.98)'
      ctx.strokeStyle = modifier === 'delete' ? 'rgba(127,29,29,0.98)' : modifier === 'corner' ? 'rgba(120,53,15,0.98)' : 'rgba(20,20,20,0.96)'
      ctx.lineWidth = Math.max(1, u(1))
      ctx.beginPath()
      if (modifier === 'corner') ctx.rect(item.x - r, item.y - r, r * 2, r * 2)
      else ctx.arc(item.x, item.y, r, 0, Math.PI * 2)
      ctx.fill(); ctx.stroke()
      if (modifier === 'delete') {
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = Math.max(1.2, u(1) * 1.4)
        ctx.beginPath()
        ctx.moveTo(item.x - r * 0.62, item.y - r * 0.62); ctx.lineTo(item.x + r * 0.62, item.y + r * 0.62)
        ctx.moveTo(item.x + r * 0.62, item.y - r * 0.62); ctx.lineTo(item.x - r * 0.62, item.y + r * 0.62)
        ctx.stroke()
      }
    })
    if (tool.hover && tool.hover.type === 'segment' && tool.hover.point) {
      const marker = tool.hover.point, r = u(5.5)
      ctx.fillStyle = 'rgba(96,165,250,0.96)'
      ctx.strokeStyle = 'rgba(20,20,20,0.96)'
      ctx.lineWidth = Math.max(1, u(1))
      ctx.beginPath(); ctx.arc(marker.x, marker.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = Math.max(1.2, u(1) * 1.4)
      ctx.beginPath()
      ctx.moveTo(marker.x - r * 0.58, marker.y); ctx.lineTo(marker.x + r * 0.58, marker.y)
      ctx.moveTo(marker.x, marker.y - r * 0.58); ctx.lineTo(marker.x, marker.y + r * 0.58)
      ctx.stroke()
    }
    ctx.restore()
  }

  const api = {
    createTool, clonePoint, clonePoints, distance, lerp, cubicPoint, pointToLineDistance,
    segmentHitTest, hitTest, modifierAction, cursorFor, pathToCanvasPath,
    deletePointAt, makeCornerAt, insertPointOnSegment, updateDrag,
    pointerDown, pointerMove, pointerUp, flatten, pointInPolygon, draw
  }
  root.FoartPenPath = api
  if (typeof module === 'object' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
