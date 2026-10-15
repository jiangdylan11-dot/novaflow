// AI 特效 · 模板制作 —— 核心（工程 → 几何 → 每帧画面）。2026-10-15 从 work/aifx-template-maker-lab 接入正式链。
// AI 特效 · 模板编辑器 计算核心（测试链）。
// 纯计算，不碰 DOM：页面、Worker（importScripts）、Node 测试（vm）共用这一份，挂到 globalThis.NovaFlowFxMaker。
// 轮廓流光直接用 特效扫光 的核心（globalThis.NovaFlowSweepLight，要先加载 sweep-light.core.js）。
//
// 一份工程（project）= 画板 + 时长 + 轮廓（一组可拖的控制点）+ 效果 + 参数 + 整体动画。
// prepare(project, scale) 算一次几何（覆盖率、有向距离、轮廓线），renderFrame(ctx, i) 出第 i 帧（黑底 RGBA）。

;(function (root) {
  'use strict'

  const FPS = 24
  // AI 特效 只按 17k+5 帧生成（aifx-restyle.workflow.js gridFrameCount）：给别的时长也会被重采样
  const DURATIONS = [
    { frames: 22, label: '0.9 秒' },
    { frames: 39, label: '1.6 秒' },
    { frames: 56, label: '2.3 秒' },
    { frames: 73, label: '3.0 秒' },
  ]
  const CANVASES = [
    { id: '1:1', label: '1:1', w: 640, h: 640 },
    { id: '4:3', label: '4:3', w: 768, h: 576 },
    { id: '16:9', label: '16:9', w: 1024, h: 576 },
    { id: '9:16', label: '9:16', w: 576, h: 1024 },
    { id: 'base', label: '跟底图' },
    { id: 'custom', label: '自定义' },
  ]
  // 编辑器里给的三个（2026-10-15 用户：尺寸默认 1:1，或者跟随底图，还有自定义）
  const CANVAS_CHOICES = ['1:1', 'base', 'custom']
  const SHAPES = [
    // 2026-10-15 用户：矩形和圆角矩形、圆和椭圆重复——只留一个；心形也不要（旧工程里的 rect / ellipse / heart 照样能读）
    { id: 'roundrect', label: '矩形' },
    { id: 'circle', label: '圆' },
    { id: 'star', label: '星形' },
    { id: 'free', label: '自由形状' },
    { id: 'trace', label: '图片轮廓' },
  ]
  const MOTIONS = [
    { id: 'none', label: '无' },
    { id: 'pop', label: '弹出' },
    { id: 'breathe', label: '呼吸' },
    { id: 'grow', label: '放大消失' },
  ]

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
  const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t) }
  const frac = (v) => v - Math.floor(v)
  const round32 = (v) => Math.max(64, Math.round(v / 32) * 32)

  function mulberry32(seed) {
    return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  }
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
    if (!m) return [1, 1, 1]
    const n = parseInt(m[1], 16)
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  }

  // ------------------------------------------------------------------ 效果表

  // 参数：{ key, label, min, max, step, def }；inert = 这个效果里不起作用的参数（界面置灰，悬停说明原因）
  const P = (key, label, min, max, step, def) => ({ key, label, min, max, step, def })
  // 2026-10-15 用户：「这些值太小了…假如我要很大的火呢」——上限都放大（扫光工具的范围是给贴图描边定的，做模板不够）
  const EDGE_COMMON = [P('width', '粗细', 0.3, 5, 0.05, 1), P('glow', '光晕', 0.3, 5, 0.05, 1), P('intensity', '亮度', 0.3, 3, 0.05, 1), P('laps', '圈数', 1, 8, 1, 1)]
  // 尺寸型的专属参数（火苗 / 烟雾 / 范围 / 光带 / 光团 / 闪光扩散）：扫光核心只算轮廓 64×S px 以内，
  // 超过 GROW_CAP 再加大就截平了。所以超出的部分改成整体放大（S 跟着乘），火舌也一起变大，滑块拉到底一直有效。
  const GROW = { 'edge-fire': 2, 'edge-firecomet': 2, 'edge-wisps': 2, 'edge-aurora': 2, 'edge-wideband': 2, 'edge-innerflow': 2, 'edge-charge': 2 }

  function sweepEffects() {
    const SL = root.NovaFlowSweepLight
    if (!SL) return []
    return SL.SWEEP_SCHEMES.filter((s) => s.edge).map((s) => {
      const params = EDGE_COMMON.slice()
      // 「外扩」在编辑器里是轮廓的参数：充能满圈自带的那个改叫「闪光扩散」，免得两个同名
      const xmax = GROW[s.id] ? 6 : s.extra && s.extra.label === '拖尾' ? 5 : s.extra && s.extra.max
      if (s.extra) params.push(P('extra', s.extra.label === '外扩' ? '闪光扩散' : s.extra.label, s.extra.min, xmax, s.extra.step, s.extra.def))
      if (s.fixedColor) params.push(P('hue', '色相', -180, 180, 1, 0))
      const inert = {}
      if (s.fixedColor) inert.colour = '这个效果自带配色，用「色相」调'
      if (s.noStart) { inert.start = '整圈同时在动，没有起点'; inert.direction = '整圈同时在动，没有方向' }
      // 分流汇合：结尾炸开后渐暗，开头两颗流星满亮出现，循环时开头淡入一小段才接得上
      return { id: s.id, label: s.label, group: '轮廓流光', kind: 'edge', hint: s.hint, scheme: s.id, params, inert, lifecycle: 'loop', loopFadeIn: s.id === 'edge-meet' ? 0.12 : 0 }
    })
  }

  // 形状光效 / 粒子在 fx-maker.fx.js（效果库），加载时 registerLibrary 注册进来
  let LIB = { effects: [], renderInto: null, palettes: null }
  let EFFECTS_CACHE = null
  function registerLibrary(lib) { LIB = lib; EFFECTS_CACHE = null }
  // 特效扫光里按底图本身扫的那几类（线性扫光 / 形态驱动 / 局部高光 / 径向）：要底图；成片只出光，底图不进视频。
  // 2026-10-15 用户：骨骼动画「特效扫光」存进模板库的也要能在这里再编辑，所以这里也要有这几类
  const BASE_AI = {
    线性扫光: (w) => ['band', `a bright band of light sweeping across a ${w.noun.replace(/ border$/, '')} shape, lighting up its surface as it passes, with a soft glow around it`],
    形态驱动: (w) => ['tile', `light gliding over the surface of a ${w.noun.replace(/ border$/, '')} shape, following its bumps and edges`],
    局部高光: (w) => ['tile', `small glints and sparkles flashing on the bright parts of a ${w.noun.replace(/ border$/, '')} shape as a light passes over it`],
  }
  function baseSweepEffects() {
    const SL = root.NovaFlowSweepLight
    if (!SL) return []
    return SL.SWEEP_SCHEMES.filter((s) => !s.edge).map((s) => {
      const params = [P('angle', s.radial ? '起始角' : '角度', -180, 180, 1, SL.DEFAULT_PARAMS.angle), P('width', '宽度', 0.4, 2.5, 0.05, 1), P('intensity', '强度', 0.2, 2, 0.05, 1), P('glow', '光晕', 0.3, 2.5, 0.05, 1)]
      if (s.id === 'rays') params.push(P('rayLength', '放射长度', 0.3, 2.5, 0.05, 1))
      const inert = { ...(s.inert || {}), start: '这类效果按底图本身扫，没有起点', direction: '这类效果按底图本身扫，没有方向' }
      const ai = s.id === 'ring' ? () => ['ring', 'a ring of light expanding outward from the centre of the picture, fading as it grows']
        : s.id === 'rays' ? (w) => ['rays', `rays of light shooting outward from a ${w.noun.replace(/ border$/, '')} shape where a band of light passes over it`]
          : s.id === 'outline' ? (w) => ['frame', `a short streak of coloured light running around the outline of a ${w.noun}. It is drawn light, NOT a solid object`]
            : BASE_AI[s.group] || BASE_AI.线性扫光
      return { id: 'base-' + s.id, label: s.label, group: s.group, kind: 'basesweep', scheme: s.id, hint: s.hint, params, inert, needsBase: true, baseOnly: true, lifecycle: 'loop', ai, schemeColour: { mode: s.colorMode || 'base', value: s.color || '#ffd173' } }
    })
  }
  function effects() {
    if (!EFFECTS_CACHE || !EFFECTS_CACHE.length) EFFECTS_CACHE = [...sweepEffects(), ...LIB.effects, ...baseSweepEffects()]
    return EFFECTS_CACHE
  }
  const effectOf = (id) => effects().find((e) => e.id === id) || effects()[0]

  function effectDefaults(id) {
    const e = effectOf(id), out = {}
    for (const p of e.params) out[p.key] = p.def
    if (e.emit) out.emit = 'edge'
    return out
  }

  // ------------------------------------------------------------------ 形状 → 控制点

  // 控制点 { x, y, s }：s = 1 圆滑点（曲线穿过），0 尖角点（受「圆角」影响）
  function ringPoints(cx, cy, rx, ry, n, start = -Math.PI / 2) {
    const pts = []
    for (let k = 0; k < n; k++) { const a = start + (k * 2 * Math.PI) / n; pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a), s: 1 }) }
    return pts
  }
  function fitPoints(pts, box) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y) }
    const sx = box.w / Math.max(1e-6, x1 - x0), sy = box.h / Math.max(1e-6, y1 - y0)
    return pts.map((p) => ({ x: box.x + (p.x - x0) * sx, y: box.y + (p.y - y0) * sy, s: p.s }))
  }
  function shapeOutline(kind, box, opts = {}) {
    const { x, y, w, h } = box, cx = x + w / 2, cy = y + h / 2
    if (kind === 'rect' || kind === 'roundrect') return [{ x, y, s: 0 }, { x: x + w, y, s: 0 }, { x: x + w, y: y + h, s: 0 }, { x, y: y + h, s: 0 }]
    if (kind === 'circle') { const r = Math.min(w, h) / 2; return ringPoints(cx, cy, r, r, 12) }
    if (kind === 'ellipse') return ringPoints(cx, cy, w / 2, h / 2, 12)
    if (kind === 'star') {
      const n = clamp(Math.round(opts.points || 5), 3, 12), inner = clamp(Number(opts.inner) || 0.45, 0.15, 0.9)
      const pts = []
      for (let k = 0; k < n * 2; k++) { const a = -Math.PI / 2 + (k * Math.PI) / n, r = k % 2 ? inner : 1; pts.push({ x: r * Math.cos(a), y: r * Math.sin(a), s: 0 }) }
      // 星形按外接圆放：方框里不变形
      const r = Math.min(w, h) / 2
      return pts.map((p) => ({ x: cx + p.x * r, y: cy + p.y * r + r * (1 - Math.cos(Math.PI / n)) / 2, s: 0 }))
    }
    if (kind === 'heart') {
      const pts = []
      const n = 14
      for (let k = 0; k < n; k++) {
        const t = (k / n) * 2 * Math.PI
        const hx = 16 * Math.pow(Math.sin(t), 3), hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))
        pts.push({ x: hx, y: hy, s: k === 0 || k === n / 2 ? 0 : 1 })
      }
      return fitPoints(pts, box)
    }
    return []
  }

  // ------------------------------------------------------------------ 控制点 → 曲线（稠密折线）

  const HANDLE = 0.34
  function bezierInto(out, p0, c1, c2, p1, steps) {
    for (let k = 0; k < steps; k++) {
      const t = k / steps, u = 1 - t
      out.push(u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
        u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y)
    }
  }
  function polyLength(a) { let l = 0; for (let k = 2; k < a.length; k += 2) l += Math.hypot(a[k] - a[k - 2], a[k + 1] - a[k - 1]); return l }
  // 折线 a 上从头走 d 的点
  function pointAlong(a, d) {
    let acc = 0
    for (let k = 2; k < a.length; k += 2) {
      const l = Math.hypot(a[k] - a[k - 2], a[k + 1] - a[k - 1])
      if (acc + l >= d) { const f = l > 0 ? (d - acc) / l : 0; return [a[k - 2] + (a[k] - a[k - 2]) * f, a[k - 1] + (a[k + 1] - a[k - 1]) * f, k] }
      acc += l
    }
    return [a[a.length - 2], a[a.length - 1], a.length]
  }
  /**
   * 一圈控制点 → 闭合稠密折线 [x0, y0, x1, y1, …]（首点不重复）。
   * 圆滑点按相邻点定切线（三次贝塞尔），尖角点没有切线；corner > 0 时尖角切成圆角（二次贝塞尔，切点离角 corner px，
   * 最多到相邻边长的 45%，正方形圆角开满接近圆）。
   */
  function outlineCurve(points, corner = 0, step = 2) {
    const n = points.length
    if (n < 3) return new Float32Array(0)
    const dir = points.map((p, i) => {
      if (!p.s) return null
      const a = points[(i - 1 + n) % n], b = points[(i + 1) % n]
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1
      return { x: dx / l, y: dy / l }
    })
    const segs = []
    for (let i = 0; i < n; i++) {
      const p0 = points[i], p1 = points[(i + 1) % n], chord = Math.hypot(p1.x - p0.x, p1.y - p0.y)
      const d0 = dir[i], d1 = dir[(i + 1) % n]
      const c1 = d0 ? { x: p0.x + d0.x * chord * HANDLE, y: p0.y + d0.y * chord * HANDLE } : p0
      const c2 = d1 ? { x: p1.x - d1.x * chord * HANDLE, y: p1.y - d1.y * chord * HANDLE } : p1
      const seg = []
      bezierInto(seg, p0, c1, c2, p1, Math.max(2, Math.ceil(chord / step)))
      seg.push(p1.x, p1.y)
      segs.push(seg)
    }
    const lens = segs.map(polyLength)
    const cut = points.map((p, i) => (p.s || !(corner > 0) ? 0 : Math.min(corner, 0.5 * lens[(i - 1 + n) % n], 0.5 * lens[i])))
    const out = []
    for (let i = 0; i < n; i++) {
      const seg = segs[i], t0 = cut[i], t1 = cut[(i + 1) % n], L = lens[i]
      if (t0 > 0) {   // 圆角：切点之间一段圆弧（三次贝塞尔逼近），正方形圆角开满就是圆
        const prev = segs[(i - 1 + n) % n], pl = lens[(i - 1 + n) % n]
        const [ax, ay] = pointAlong(prev, pl - t0), [bx, by] = pointAlong(seg, t0)
        const px = points[i].x, py = points[i].y
        let ux = px - ax, uy = py - ay, vx = bx - px, vy = by - py
        const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1
        ux /= lu; uy /= lu; vx /= lv; vy /= lv
        const turn = Math.acos(clamp(ux * vx + uy * vy, -1, 1)), r = t0 * Math.tan((Math.PI - turn) / 2)
        const h = (4 / 3) * Math.tan(turn / 4) * r
        const c1 = { x: ax + ux * h, y: ay + uy * h }, c2 = { x: bx - vx * h, y: by - vy * h }
        const steps = Math.max(3, Math.ceil((t0 * 1.6) / step))
        bezierInto(out, { x: ax, y: ay }, c1, c2, { x: bx, y: by }, steps)
      }
      // 这一段从 t0 走到 L - t1（不含终点，终点由下一段 / 圆角给出）
      const [sx, sy, sk] = pointAlong(seg, t0)
      if (!(t0 > 0)) out.push(sx, sy)
      const [ex, ey, ek] = pointAlong(seg, Math.max(t0, L - t1))
      for (let k = sk; k < ek && k < seg.length; k += 2) out.push(seg[k], seg[k + 1])
      if (t1 > 0) out.push(ex, ey)
    }
    return Float32Array.from(out)
  }

  // ------------------------------------------------------------------ 光栅化 / 距离场 / 轮廓线

  // 闭合折线的覆盖率（每像素 4 条子扫描线，横向按区间精确算），奇偶规则
  function fillPoly(pts, W, H, sx, sy, out) {
    const n = pts.length / 2
    if (n < 3) return
    const SUB = 4
    let ymin = Infinity, ymax = -Infinity
    const X = new Float32Array(n), Y = new Float32Array(n)
    for (let k = 0; k < n; k++) { X[k] = pts[2 * k] * sx; Y[k] = pts[2 * k + 1] * sy; if (Y[k] < ymin) ymin = Y[k]; if (Y[k] > ymax) ymax = Y[k] }
    // 按起始行分桶的边表
    const r0 = Math.max(0, Math.floor(ymin * SUB)), r1 = Math.min(H * SUB - 1, Math.ceil(ymax * SUB))
    if (r1 < r0) return
    const buckets = new Array(r1 - r0 + 1)
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n
      let ya = Y[k], yb = Y[j], xa = X[k], xb = X[j]
      if (ya === yb) continue
      if (ya > yb) { [ya, yb] = [yb, ya]; [xa, xb] = [xb, xa] }
      const first = Math.max(r0, Math.ceil(ya * SUB - 0.5)), last = Math.min(r1, Math.ceil(yb * SUB - 0.5) - 1)
      if (last < first) continue
      const e = { last, x: xa, dx: (xb - xa) / (yb - ya), ya }
      const b = first - r0
      ;(buckets[b] || (buckets[b] = [])).push(e)
    }
    let active = []
    const xs = []
    const w = 1 / SUB
    for (let r = r0; r <= r1; r++) {
      const bucket = buckets[r - r0]
      if (bucket) active = active.concat(bucket)
      if (!active.length) continue
      const yc = (r + 0.5) / SUB
      xs.length = 0
      const keep = []
      for (const e of active) { if (e.last >= r) { xs.push(e.x + (yc - e.ya) * e.dx); if (e.last > r) keep.push(e) } }
      active = keep
      xs.sort((a, b) => a - b)
      const row = Math.floor(yc) * W
      for (let k = 0; k + 1 < xs.length; k += 2) {
        let xa = Math.max(0, xs[k]), xb = Math.min(W, xs[k + 1])
        if (xb <= xa) continue
        const pa = Math.floor(xa), pb = Math.floor(xb)
        if (pa === pb) { out[row + pa] += (xb - xa) * w; continue }
        out[row + pa] += (pa + 1 - xa) * w
        for (let p = pa + 1; p < pb; p++) out[row + p] += w
        if (pb < W) out[row + pb] += (xb - pb) * w
      }
    }
  }

  // Felzenszwalb 平方距离变换（可分离）
  const INF = 1e20
  function edt1d(f, n, d, v, z) {
    let k = 0
    v[0] = 0; z[0] = -INF; z[1] = INF
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]] }
  }
  function edt(feature, W, H) {   // feature[i] = 1 的像素到最近 feature 的距离（像素）
    const n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1)
    const g = new Float64Array(W * H)
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) f[y] = feature[y * W + x] ? 0 : INF
      edt1d(f, H, d, v, z)
      for (let y = 0; y < H; y++) g[y * W + x] = d[y]
    }
    const out = new Float32Array(W * H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) f[x] = g[y * W + x]
      edt1d(f, W, d, v, z)
      for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x])
    }
    return out
  }
  // 有向距离：里面为负。半透明边上按覆盖率线性过渡（0.5 正好在边上）
  function signedDistance(cov, W, H) {
    const N = W * H, inside = new Uint8Array(N), outside = new Uint8Array(N)
    let any = false
    for (let i = 0; i < N; i++) { const m = cov[i] >= 0.5 ? 1 : 0; inside[i] = m; outside[i] = 1 - m; if (m) any = true }
    const sd = new Float32Array(N)
    if (!any) { sd.fill(1e6); return sd }
    const dIn = edt(outside, W, H), dOut = edt(inside, W, H)
    for (let i = 0; i < N; i++) {
      let v = inside[i] ? -(dIn[i] - 0.5) : dOut[i] - 0.5
      const c = cov[i]
      if (c > 0.02 && c < 0.98 && Math.abs(v) <= 1.5) v = 0.5 - c
      sd[i] = v
    }
    return sd
  }
  // 把 0/1 遮罩里不连通边框的空洞补上（只取最外圈）
  function fillHoles(cov, W, H) {
    const N = W * H, seen = new Uint8Array(N), stack = []
    const push = (i) => { if (!seen[i] && cov[i] < 0.5) { seen[i] = 1; stack.push(i) } }
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x) }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1) }
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i - x) / W
      if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W)
    }
    for (let i = 0; i < N; i++) if (!seen[i] && cov[i] < 0.5) cov[i] = 1
  }

  /**
   * 等值线 0.5 的轮廓（marching squares，边上线性插值）。外圈按「屏幕上逆时针」排（和扫光核心一致：光沿 T 增大走），
   * 起点 = 最上面一点（同高取最左），t = 弧长占比。返回 [{ x, y, t, len, hole }]。
   */
  function contoursOf(cov, W, H, minLen = 12) {
    const GW = W + 2, GH = H + 2
    const val = (x, y) => (x < 1 || y < 1 || x > W || y > H ? 0 : cov[(y - 1) * W + (x - 1)])
    const ex = new Float32Array(GW * GH * 2), ey = new Float32Array(GW * GH * 2)
    const nbA = new Int32Array(GW * GH * 2).fill(-1), nbB = new Int32Array(GW * GH * 2).fill(-1)
    const link = (a, b) => { if (nbA[a] < 0) nbA[a] = b; else nbB[a] = b; if (nbA[b] < 0) nbA[b] = a; else nbB[b] = a }
    const iso = 0.5
    const hEdge = (x, y) => { const id = (y * GW + x) * 2; const a = val(x, y), b = val(x + 1, y); ex[id] = x + (iso - a) / (b - a || 1e-9); ey[id] = y; return id }
    const vEdge = (x, y) => { const id = (y * GW + x) * 2 + 1; const a = val(x, y), b = val(x, y + 1); ex[id] = x; ey[id] = y + (iso - a) / (b - a || 1e-9); return id }
    for (let y = 0; y < GH - 1; y++) for (let x = 0; x < GW - 1; x++) {
      const a = val(x, y) >= iso, b = val(x + 1, y) >= iso, c = val(x + 1, y + 1) >= iso, d = val(x, y + 1) >= iso
      const code = (a << 3) | (b << 2) | (c << 1) | d
      if (code === 0 || code === 15) continue
      const T = () => hEdge(x, y), B = () => hEdge(x, y + 1), L = () => vEdge(x, y), R = () => vEdge(x + 1, y)
      switch (code) {
        case 1: case 14: link(L(), B()); break
        case 2: case 13: link(B(), R()); break
        case 3: case 12: link(L(), R()); break
        case 4: case 11: link(T(), R()); break
        case 6: case 9: link(T(), B()); break
        case 7: case 8: link(L(), T()); break
        case 5: link(L(), T()); link(B(), R()); break
        case 10: link(T(), R()); link(L(), B()); break
      }
    }
    const seen = new Uint8Array(GW * GH * 2), loops = []
    for (let e0 = 0; e0 < nbA.length; e0++) {
      if (nbA[e0] < 0 || seen[e0]) continue
      const xs = [], ys = []
      let prev = -1, cur = e0
      for (;;) {
        seen[cur] = 1; xs.push(ex[cur] - 1); ys.push(ey[cur] - 1)
        const nx = nbA[cur] !== prev ? nbA[cur] : nbB[cur]
        prev = cur; cur = nx
        if (cur < 0 || cur === e0 || seen[cur]) break
      }
      if (xs.length < 6) continue
      let len = 0, area = 0
      const n = xs.length
      for (let k = 0; k < n; k++) { const j = (k + 1) % n; len += Math.hypot(xs[j] - xs[k], ys[j] - ys[k]); area += xs[k] * ys[j] - xs[j] * ys[k] }
      if (len < minLen) continue
      loops.push({ xs, ys, len, area })
    }
    // 外圈 / 镂空：被奇数个别的圈包住的是镂空
    const inPoly = (px, py, l) => { let r = false; for (let k = 0, j = l.xs.length - 1; k < l.xs.length; j = k++) { const yk = l.ys[k], yj = l.ys[j]; if ((yk > py) !== (yj > py) && px < ((l.xs[j] - l.xs[k]) * (py - yk)) / (yj - yk) + l.xs[k]) r = !r } return r }
    return loops.map((l, idx) => {
      let depth = 0
      for (let o = 0; o < loops.length; o++) if (o !== idx && Math.abs(loops[o].area) > Math.abs(l.area) && inPoly(l.xs[0], l.ys[0], loops[o])) depth++
      const hole = depth % 2 === 1
      let xs = l.xs, ys = l.ys
      // 外圈：面积（y 向下的鞋带公式）< 0 = 屏幕上逆时针
      if ((!hole && l.area > 0) || (hole && l.area < 0)) { xs = xs.slice().reverse(); ys = ys.slice().reverse() }
      const n = xs.length
      let s0 = 0
      for (let k = 1; k < n; k++) if (ys[k] < ys[s0] - 1e-6 || (Math.abs(ys[k] - ys[s0]) <= 1e-6 && xs[k] < xs[s0])) s0 = k
      const X = new Float32Array(n), Y = new Float32Array(n), t = new Float32Array(n)
      for (let k = 0; k < n; k++) { X[k] = xs[(k + s0) % n]; Y[k] = ys[(k + s0) % n] }
      let acc = 0
      for (let k = 0; k < n; k++) { t[k] = acc / l.len; const j = (k + 1) % n; acc += Math.hypot(X[j] - X[k], Y[j] - Y[k]) }
      return { x: X, y: Y, t, len: l.len, hole }
    })
  }

  // ------------------------------------------------------------------ 图片轮廓 → 控制点

  // 道格拉斯-普克简化（闭合折线）
  function simplifyClosed(xs, ys, tol) {
    const n = xs.length
    if (n < 4) return [...Array(n).keys()]
    // 起点用离第 0 点最远的点切开，两半各自简化
    let far = 0, fd = -1
    for (let k = 1; k < n; k++) { const d = (xs[k] - xs[0]) ** 2 + (ys[k] - ys[0]) ** 2; if (d > fd) { fd = d; far = k } }
    const keep = new Uint8Array(n)
    keep[0] = keep[far] = 1
    const rec = (a, b) => {   // a → b（环上前进）
      let best = -1, bd = tol * tol
      const ax = xs[a], ay = ys[a], bx = xs[b % n], by = ys[b % n], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9
      for (let k = a + 1; k < b; k++) {
        const i = k % n, t = clamp01(((xs[i] - ax) * dx + (ys[i] - ay) * dy) / l2)
        const d = (xs[i] - ax - t * dx) ** 2 + (ys[i] - ay - t * dy) ** 2
        if (d > bd) { bd = d; best = k }
      }
      if (best < 0) return
      keep[best % n] = 1
      rec(a, best); rec(best, b)
    }
    rec(0, far); rec(far, n)
    const out = []
    for (let k = 0; k < n; k++) if (keep[k]) out.push(k)
    return out
  }
  /**
   * 底图（RGBA，按 place 摆在画板上）→ 控制点。detail 0..1：越大点越多、越贴边。
   * 没有透明通道的图按「和四角颜色差得多」当前景。outerOnly：只要外圈（镂空不要）。
   */
  function traceImage(rgba, iw, ih, place, canvasW, canvasH, detail = 0.5, outerOnly = true) {
    // 先在画板分辨率（最长边 ≤ 640）上画出前景覆盖率
    const s = Math.min(1, 640 / Math.max(canvasW, canvasH)), W = Math.max(8, Math.round(canvasW * s)), H = Math.max(8, Math.round(canvasH * s))
    let opaque = true
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) { opaque = false; break }
    const corner = [0, (iw - 1) * 4, (ih - 1) * iw * 4, ((ih - 1) * iw + iw - 1) * 4].map((o) => [rgba[o], rgba[o + 1], rgba[o + 2]])
    const bg = [0, 1, 2].map((c) => corner.reduce((a, v) => a + v[c], 0) / 4)
    const fg = (i) => {
      if (!opaque) return rgba[i + 3] / 255
      const d = Math.abs(rgba[i] - bg[0]) + Math.abs(rgba[i + 1] - bg[1]) + Math.abs(rgba[i + 2] - bg[2])
      return clamp01((d - 24) / 40)
    }
    const cov = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = ((x + 0.5) / s - place.x) / place.w, v = ((y + 0.5) / s - place.y) / place.h
      if (u < 0 || v < 0 || u >= 1 || v >= 1) continue
      const ix = Math.min(iw - 1, Math.floor(u * iw)), iy = Math.min(ih - 1, Math.floor(v * ih))
      cov[y * W + x] = fg((iy * iw + ix) * 4)
    }
    if (outerOnly) fillHoles(cov, W, H)
    const loops = contoursOf(cov, W, H, 24).filter((c) => outerOnly ? !c.hole : true)
    if (!loops.length) return []
    const big = Math.max(...loops.map((c) => c.len))
    const tol = (0.6 + (1 - clamp01(detail)) * 7) / s
    return loops.filter((c) => c.len >= big * 0.12).map((c) => {
      const xs = Array.from(c.x, (v) => (v + 0.5) / s), ys = Array.from(c.y, (v) => (v + 0.5) / s)
      const idx = simplifyClosed(xs, ys, tol)
      const pts = idx.map((k) => ({ x: xs[k], y: ys[k], s: 1 }))
      // 拐得急的点当尖角
      const n = pts.length
      for (let k = 0; k < n; k++) {
        const a = pts[(k - 1 + n) % n], b = pts[k], d = pts[(k + 1) % n]
        const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - b.x, vy = d.y - b.y
        const cos = (ux * vx + uy * vy) / ((Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1)
        if (cos < 0.55) b.s = 0
      }
      return { points: pts, hole: !!c.hole }
    })
  }

  // ------------------------------------------------------------------ 工程

  function canvasSize(project) {
    const c = project.canvas || {}
    if (c.preset === 'base' && project.base && project.base.w > 0 && project.base.h > 0) {
      const a = clamp(project.base.w / project.base.h, 9 / 16, 16 / 9)
      if (a >= 1) { const W = a > 4 / 3 + 1e-6 ? 1024 : 640; return { w: W, h: round32(W / a) } }
      const H = a < 3 / 4 - 1e-6 ? 1024 : 640
      return { w: round32(H * a), h: H }
    }
    if (c.preset === 'custom') return { w: round32(clamp(Number(c.w) || 640, 128, 1024)), h: round32(clamp(Number(c.h) || 640, 128, 1024)) }
    // 骨骼动画「特效扫光」出切片：画板 = 底图 + 四周边距，按像素精确（不按 32 取整，切片要和底图对齐）
    if (c.preset === 'exact') return { w: Math.round(clamp(Number(c.w) || 640, 8, 4096)), h: Math.round(clamp(Number(c.h) || 640, 8, 4096)) }
    const p = CANVASES.find((x) => x.id === c.preset && x.w) || CANVASES[0]
    return { w: p.w, h: p.h }
  }
  // 底图在画板上的位置（等比缩放居中，scale = 占画板的比例）
  function basePlacement(project, size = canvasSize(project)) {
    const b = project.base
    if (!b || !(b.w > 0 && b.h > 0)) return null
    const k = clamp(Number(b.scale) || 0.7, 0.1, 1.5)
    const fit = Math.min(size.w / b.w, size.h / b.h) * k
    const w = b.w * fit, h = b.h * fit
    return { x: (size.w - w) / 2 + (Number(b.dx) || 0), y: (size.h - h) / 2 + (Number(b.dy) || 0), w, h }
  }

  function defaultProject() {
    const size = { w: 640, h: 640 }
    const box = { x: 140, y: 140, w: 360, h: 360 }
    return {
      version: 1,
      canvas: { preset: '1:1' },
      frames: 39,
      lifecycle: 'loop',
      shape: { kind: 'roundrect', star: { points: 5, inner: 0.45 } },
      outlines: [{ points: shapeOutline('roundrect', box), hole: false }],
      corner: 60,
      offset: 0,
      outerOnly: true,
      smoothAll: false,
      traceDetail: 0.5,
      start: { x: box.x + box.w / 2, y: box.y },
      direction: 'ccw',
      effect: 'edge-meteor',
      params: effectDefaults('edge-meteor'),
      colour: { mode: 'default', value: '#ffd173' },
      motion: { kind: 'none', amount: 1 },
      base: null,
      size,
    }
  }

  // 整个工程里所有轮廓（外圈 + 镂空）的稠密折线，画板坐标
  function outlinePolylines(project) {
    const corner = Math.max(0, Number(project.corner) || 0)
    return (project.outlines || []).filter((o) => o.points && o.points.length >= 3)
      .map((o) => ({ pts: outlineCurve(o.points.map((p) => (project.smoothAll ? { ...p, s: 1 } : p)), corner, 2), hole: !!o.hole }))
  }

  // 帧数 / 时间：循环 t = i / n（首尾相接），一次性 t = i / (n - 1)
  function frameCount(project) {
    const n = Math.round(Number(project.frames) || 39)
    if (project.framesFree) return clamp(n, 2, 240)   // 特效扫光的切片张数随「帧数」
    return DURATIONS.some((d) => d.frames === n) ? n : 39
  }
  function timeOf(project, i) { const n = frameCount(project); return project.lifecycle === 'loop' ? i / n : i / Math.max(1, n - 1) }

  /**
   * 几何：画板尺寸 × scale 的覆盖率 cov、有向距离 sd（里负外正，已含外扩）、轮廓线、质心、内部像素表。
   */
  function geometry(project, scale = 1) {
    const size = canvasSize(project)
    const W = Math.max(8, Math.round(size.w * scale)), H = Math.max(8, Math.round(size.h * scale))
    const sx = W / size.w, sy = H / size.h
    const N = W * H
    const solid = new Float32Array(N), holes = new Float32Array(N)
    for (const pl of outlinePolylines(project)) {
      if (pl.hole && project.outerOnly) continue
      const one = new Float32Array(N)
      fillPoly(pl.pts, W, H, sx, sy, one)
      const dst = pl.hole ? holes : solid
      for (let i = 0; i < N; i++) { const v = one[i] > 1 ? 1 : one[i]; if (v > dst[i]) dst[i] = v }
    }
    let cov = new Float32Array(N)
    for (let i = 0; i < N; i++) cov[i] = solid[i] * (1 - holes[i])
    if (project.outerOnly) fillHoles(cov, W, H)
    let sd = signedDistance(cov, W, H)
    // 只看中心和大小的效果不显示轮廓、也没有外扩滑条——外扩不算进去，框多大效果就按多大
    const centered = !!(effectOf(project.effect) || {}).centered
    const off = (centered ? 0 : Number(project.offset) || 0) * scale
    if (Math.abs(off) > 0.01) {
      for (let i = 0; i < N; i++) { sd[i] -= off; cov[i] = clamp01(0.5 - sd[i]) }
      if (off < 0) sd = signedDistance(cov, W, H)   // 内缩会把细处切断：重算
    }
    const contours = contoursOf(cov, W, H)
    const outer = contours.filter((c) => !c.hole)
    let ax = 0, ay = 0, aw = 0, x0 = W, x1 = -1, y0 = H, y1 = -1
    const inside = []
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, c = cov[i]
      if (c <= 0) continue
      ax += x * c; ay += y * c; aw += c
      if (c >= 0.5) { inside.push(i); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
    if (x1 < 0) { x0 = W * 0.3; x1 = W * 0.7; y0 = H * 0.3; y1 = H * 0.7 }
    const cx = aw ? ax / aw : W / 2, cy = aw ? ay / aw : H / 2
    const R = Math.max(4, Math.sqrt(Math.max(aw, 1) / Math.PI)), Rb = Math.max(4, 0.5 * Math.max(x1 - x0, y1 - y0))
    // 2026-10-15 用户：「东西需要显示完整，而不是被最终尺寸切割掉」——效果的最大半径不超过 形状中心到画板最近边 − 边距
    const margin = 0.04 * Math.min(W, H), Rfit = Math.max(8, Math.min(cx, cy, W - cx, H - cy) - margin)
    let Rout = 0
    for (const c of outer) for (let k = 0; k < c.x.length; k += 2) Rout = Math.max(Rout, Math.hypot(c.x[k] - cx, c.y[k] - cy))
    // 每像素离画板边还有多远（减边距）：外扩类效果逐点决定能伸多长
    const edge = new Float32Array(N)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) edge[y * W + x] = Math.max(0, Math.min(x, y, W - 1 - x, H - 1 - y) - margin)
    return { W, H, N, scale, size, cov, sd, contours, outer, inside: Int32Array.from(inside), cx, cy, R, Rb, Rfit, Rout: Rout || Rb, margin, edge, bbox: { x0, x1, y0, y1 }, area: aw, u: Math.min(W, H) / 640 }
  }

  // 起点（画板坐标）→ 扫光核心里的 起点（度）：最近的外圈轮廓点的 t
  function startFraction(geo, point, mirrored) {
    if (!point || !geo.outer.length) return 0
    let px = point.x * (geo.W / geo.size.w), py = point.y * (geo.H / geo.size.h)
    if (mirrored) px = geo.W - 1 - px
    let best = 0, bd = Infinity
    for (const c of geo.outer) for (let k = 0; k < c.x.length; k++) { const d = (c.x[k] - px) ** 2 + (c.y[k] - py) ** 2; if (d < bd) { bd = d; best = c.t[k] } }
    return best
  }
  function mirrorPlane(src, W, H) {
    const out = new Float32Array(src.length)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = src[y * W + (W - 1 - x)]
    return out
  }

  // 外圈轮廓上按弧长取点：u ∈ [0,1) 走遍所有外圈；带外法线（轮廓在屏幕上逆时针，y 向下：切线 (tx, ty) 的外法线 = (−ty, tx)）
  function pointOnOutline(geo, u) {
    const outer = geo.outer
    if (!outer.length) return { x: geo.cx, y: geo.cy, nx: 0, ny: -1 }
    const total = outer.reduce((a, c) => a + c.len, 0)
    let d = (u - Math.floor(u)) * total
    for (const c of outer) {
      if (d > c.len) { d -= c.len; continue }
      const f = d / c.len, n = c.t.length
      let lo = 0, hi = n - 1
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c.t[mid] <= f) lo = mid; else hi = mid - 1 }
      const j = (lo + 1) % n, span = (j === 0 ? 1 : c.t[j]) - c.t[lo], w = span > 0 ? (f - c.t[lo]) / span : 0
      const x = c.x[lo] + (c.x[j] - c.x[lo]) * w, y = c.y[lo] + (c.y[j] - c.y[lo]) * w
      const tx = c.x[j] - c.x[lo], ty = c.y[j] - c.y[lo], l = Math.hypot(tx, ty) || 1
      return { x, y, nx: -ty / l, ny: tx / l }
    }
    const c = outer[0]
    return { x: c.x[0], y: c.y[0], nx: 0, ny: -1 }
  }

  // ------------------------------------------------------------------ 准备

  /** 一次准备（Worker 里每次工程变了做一次），renderFrame 反复用。 */
  /**
   * 底图画面（碎裂 / 消失类用，2026-10-15 用户：「这些碎裂消失是根据用户上传的图去做的吗？不是就没什么用」）：
   * 按摆放位置把底图采样到渲染分辨率，预乘 alpha 的 R / G / B（0..1）。
   */
  function sampleBase(project, geo, baseImg) {
    const pl = basePlacement(project, geo.size)
    if (!pl || !baseImg || !baseImg.data) return null
    const { W, H, N } = geo, sx = geo.size.w / W, sy = geo.size.h / H, bw = baseImg.w, bh = baseImg.h, d = baseImg.data
    const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), A = new Float32Array(N)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (((x + 0.5) * sx - pl.x) / pl.w) * bw - 0.5, v = (((y + 0.5) * sy - pl.y) / pl.h) * bh - 0.5
      if (u < -0.5 || v < -0.5 || u > bw - 0.5 || v > bh - 0.5) continue
      const x0 = clamp(Math.floor(u), 0, bw - 1), y0 = clamp(Math.floor(v), 0, bh - 1), x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1)
      const fx = clamp01(u - x0), fy = clamp01(v - y0), i = y * W + x
      const ws = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], os = [(y0 * bw + x0) * 4, (y0 * bw + x1) * 4, (y1 * bw + x0) * 4, (y1 * bw + x1) * 4]
      let r = 0, g = 0, b = 0, al = 0
      for (let k = 0; k < 4; k++) { const o = os[k], a = d[o + 3] / 255 * ws[k]; r += d[o] / 255 * a; g += d[o + 1] / 255 * a; b += d[o + 2] / 255 * a; al += a }
      R[i] = r; G[i] = g; B[i] = b; A[i] = al
    }
    return { R, G, B, A }
  }

  function prepare(project, scale = 1, baseImg = null) {
    const geo = geometry(project, scale)
    geo.img = project.useImage === false ? null : sampleBase(project, geo, baseImg)
    const fx = effectOf(project.effect)
    const params = { ...effectDefaults(fx.id), ...(project.params || {}) }
    const ctx = { project, geo, fx, params, n: frameCount(project), loop: project.lifecycle === 'loop' }
    if (fx.kind === 'edge') ctx.sweep = prepareSweep(project, geo, fx, params)
    else if (fx.kind === 'basesweep') ctx.sweep = prepareBaseSweep(project, geo, fx, params, baseImg)
    else Object.assign(ctx, libLayer(ctx, fx, params))
    // 附加粒子 2026-10-15 去掉（用户：只是把粒子效果原样叠上去、不跟主效果运动，没意义）；旧工程里的 project.extra 不再读
    return ctx
  }
  // 效果库的一层：配色 + 一次性准备（碎裂的分块、光束表…）
  function libLayer(base, fx, params) {
    const { pal, palOf } = LIB.palettes(base.project, fx)
    const layer = { ...base, fx, params, pal, palOf }
    layer.state = fx.prepare ? fx.prepare(layer) : {}
    return { pal, palOf, state: layer.state }
  }

  // 轮廓流光：覆盖率当 alpha 交给扫光核心（底色黑：光在轮廓两侧都看得见）。顺时针 = 左右镜像算、再镜像回来
  function prepareSweep(project, geo, fx, params) {
    const SL = root.NovaFlowSweepLight
    const cw = project.direction === 'cw' && !(fx.inert && fx.inert.direction)
    const cov = cw ? mirrorPlane(geo.cov, geo.W, geo.H) : geo.cov
    const rgba = new Uint8ClampedArray(geo.N * 4)
    for (let i = 0; i < geo.N; i++) rgba[i * 4 + 3] = Math.round(clamp01(cov[i]) * 255)
    // 扫光核心对小内容会裁到「内容 + 边距」再算，边距外六成还会淡到 0：大火 / 大光晕在画板里就被截、被淡掉。
    // 两个对角各放一个 alpha 1/255 的像素（不进轮廓：轮廓按 alpha 0.5 切），内容框 = 整个画板，不裁；
    // 边距只留 8 px（淡出那一圈落在画板外）。
    if (!rgba[3]) rgba[3] = 1
    if (!rgba[geo.N * 4 - 1]) rgba[geo.N * 4 - 1] = 1
    const colour = project.colour && project.colour.mode === 'custom' && !(fx.inert && fx.inert.colour)
    let start = 0
    if (!(fx.inert && fx.inert.start)) {
      const g = cw ? { ...geo, outer: contoursOf(cov, geo.W, geo.H).filter((c) => !c.hole) } : geo
      start = startFraction(g, project.start, cw) * 360
    }
    const P = {
      ...SL.DEFAULT_PARAMS, scheme: fx.scheme, frames: frameCount(project), blend: 'add',
      colorMode: colour ? 'custom' : 'white', color: colour ? project.colour.value : '#ffffff',
      width: params.width, glow: params.glow, intensity: params.intensity, laps: params.laps,
      extra: params.extra, hue: params.hue || 0, start, scale: geo.scale, pad: 8,
    }
    const cap = GROW[fx.scheme]
    if (cap && Number(params.extra) > cap) { P.width = (Number(params.width) || 1) * (Number(params.extra) / cap); P.extra = cap }
    return { ctx: SL.analyzeBase(rgba, geo.W, geo.H, P), P, mirrored: cw }
  }

  // 按底图本身扫：把摆好的底图（直通 alpha）交给扫光核心；没有底图就是空画面（编辑窗口里这几类没底图时不让选）
  function prepareBaseSweep(project, geo, fx, params, baseImg) {
    const SL = root.NovaFlowSweepLight, img = sampleBase(project, geo, baseImg)
    if (!img) return null
    const rgba = new Uint8ClampedArray(geo.N * 4)
    for (let i = 0; i < geo.N; i++) {
      const a = img.A[i]
      if (!(a > 0.002)) continue
      rgba[i * 4] = Math.round((img.R[i] / a) * 255); rgba[i * 4 + 1] = Math.round((img.G[i] / a) * 255); rgba[i * 4 + 2] = Math.round((img.B[i] / a) * 255); rgba[i * 4 + 3] = Math.round(clamp01(a) * 255)
    }
    // 同轮廓流光：两个对角放 alpha 1/255 的像素，扫光核心不裁内容框，光晕不在画板里被截
    if (!rgba[3]) rgba[3] = 1
    if (!rgba[geo.N * 4 - 1]) rgba[geo.N * 4 - 1] = 1
    const mode = project.colour && project.colour.mode, own = fx.schemeColour
    const colorMode = mode === 'custom' ? 'custom' : mode === 'white' ? 'white' : mode === 'base' ? 'base' : own.mode, color = mode === 'custom' ? project.colour.value : own.value
    const P = {
      ...SL.DEFAULT_PARAMS, scheme: fx.scheme, frames: frameCount(project), blend: 'add', colorMode, color,
      angle: params.angle, width: params.width, intensity: params.intensity, glow: params.glow, rayLength: params.rayLength || 1, scale: geo.scale, pad: 8,
    }
    return { ctx: SL.analyzeBase(rgba, geo.W, geo.H, P), P, mirrored: false }
  }

  // ------------------------------------------------------------------ 合成一帧

  function blur(src, W, H, sigma) {
    const SL = root.NovaFlowSweepLight
    if (!(sigma > 0.3)) return src.slice()
    return SL.blurPlane(src, W, H, sigma)
  }

  /** 第 i 帧：黑底 RGBA（Uint8ClampedArray，alpha 全 255）。 */
  function renderFrame(ctx, index) {
    const geo = ctx.geo, { W, H, N } = geo, t = timeOf(ctx.project, index), fx = ctx.fx
    const rgb = [new Float32Array(N), new Float32Array(N), new Float32Array(N)]
    const env = envelope(ctx, t)
    if ((fx.kind === 'edge' || fx.kind === 'basesweep') && ctx.sweep) {
      const s = ctx.sweep, p = ctx.loop ? t : t * 0.999
      const f = root.NovaFlowSweepLight.renderSweepFrame(s.ctx, p, s.P)
      const pad = f.pad, fw = f.w
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const sx = (s.mirrored ? W - 1 - x : x) + pad, o = ((y + pad) * fw + sx) * 4, a = f.data[o + 3] / 255
        if (!(a > 0)) continue
        const i = y * W + x
        rgb[0][i] = (f.data[o] / 255) * a; rgb[1][i] = (f.data[o + 1] / 255) * a; rgb[2][i] = (f.data[o + 2] / 255) * a
      }
    } else if (fx.kind === 'lib') addLib(rgb, ctx, t)
    return finish(rgb, ctx, t, env)
  }

  // 效果库一层：HDR 能量 → 三层泛光 → 显示色 1 − exp(−能量)（低能量带色、高能量烧白），按「滤色」叠进 rgb
  function addLib(rgb, layer, t) {
    const { W, H, N, u } = layer.geo
    const D = { W, H, R: new Float32Array(N), G: new Float32Array(N), B: new Float32Array(N) }
    if (layer.geo.img && layer.fx.usesImage) { D.IR = new Float32Array(N); D.IG = new Float32Array(N); D.IB = new Float32Array(N); D.IA = new Float32Array(N) }
    LIB.renderInto(layer, t, D)
    // 兜底：画板最外一圈（边距宽）里的光渐淡到 0——效果按 Rfit 算好了不会出界，这里只防万一，保证边上不被硬切
    const mg = Math.max(2, layer.geo.margin)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = Math.min(x, y, W - 1 - x, H - 1 - y)
      if (d >= mg) continue
      const f = smooth(0, mg, d), i = y * W + x
      D.R[i] *= f; D.G[i] *= f; D.B[i] *= f
      if (D.IR) { D.IR[i] *= f; D.IG[i] *= f; D.IB[i] *= f }
    }
    const gk = clamp(Number(layer.params.glow) || 1, 0.2, 6)
    const planes = [D.R, D.G, D.B]
    // 染色泛光（2026-10-15 用户嫌「像草稿」）：近处一层按本色模糊，中、远两层按亮度模糊再染成配色的主色 / 深色——
    // 白热的核外面一圈主色、再外一圈深色光晕，和成品特效一样。多色效果（烟花）三层都按本色。
    const L = new Float32Array(N)
    for (let i = 0; i < N; i++) L[i] = (D.R[i] + D.G[i] + D.B[i]) / 3
    const multi = layer.fx.palette === 'multi' && !(layer.project.colour && ['white', 'custom'].includes(layer.project.colour.mode))
    const pal = layer.pal, midC = pal ? pal.mid : [1, 1, 1], deepC = pal ? pal.deep.map((v, c) => v * 0.6 + pal.mid[c] * 0.4) : [1, 1, 1]
    const l2 = multi ? null : blur(L, W, H, 9 * u * gk), l3 = multi ? null : blur(L, W, H, 26 * u * gk)
    for (let c = 0; c < 3; c++) {
      const E = planes[c], b1 = blur(E, W, H, 2.5 * u * gk), out = rgb[c]
      const b2 = multi ? blur(E, W, H, 9 * u * gk) : null, b3 = multi ? blur(E, W, H, 26 * u * gk) : null
      for (let i = 0; i < N; i++) {
        const far = multi ? b2[i] * 0.34 * gk + b3[i] * 0.24 * gk : (l2[i] * midC[c] * 0.42 + l3[i] * deepC[c] * 0.34) * gk
        const e = E[i] + b1[i] * 0.4 * gk + far
        if (!(e > 1e-4)) continue
        const v = 1 - Math.exp(-e * 1.1)
        out[i] = 1 - (1 - out[i]) * (1 - v)
      }
    }
    if (D.IR) {   // 底图画面：不发光、不泛光，按原色垫在光下面
      const planesI = [D.IR, D.IG, D.IB]
      for (let c = 0; c < 3; c++) { const src = planesI[c], out = rgb[c]; for (let i = 0; i < N; i++) { const v = src[i]; if (v > 0) out[i] = 1 - (1 - out[i]) * (1 - Math.min(1, v)) } }
    }
  }

  // 一次性：淡入 / 淡出；粒子类自己有生灭，只在最后保证清空
  function envelope(ctx, t) {
    if (ctx.loop) return ctx.fx.loopFadeIn ? smooth(0, ctx.fx.loopFadeIn, t) : 1
    if (ctx.fx.particle || ctx.fx.ownEnvelope || (ctx.fx.usesImage && ctx.geo.img)) return 1 - smooth(0.9, 1, t)   // 自己管出场 / 收场的（爆炸、消失…）只保证最后清空
    return smooth(0, 0.1, t) * (1 - smooth(0.7, 1, t))
  }

  // 整体动画（绕形状质心缩放）+ 包络 → RGBA
  function finish(rgb, ctx, t, env) {
    const { W, H, N, cx, cy } = ctx.geo, m = ctx.project.motion || {}, amt = clamp(Number(m.amount) || 1, 0, 3)
    let s = 1, a = env
    if (m.kind === 'pop') { const k = smooth(0, 0.28, t); const back = 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2; s = 1 - 0.35 * amt * (1 - back); a *= smooth(0, 0.12, t) }
    else if (m.kind === 'breathe') s = 1 + 0.05 * amt * Math.sin(2 * Math.PI * t * (ctx.loop ? 1 : 1))
    else if (m.kind === 'grow') { const k = smooth(0.55, 1, t); s = 1 + 0.25 * amt * k; a *= 1 - k }
    const out = new Uint8ClampedArray(N * 4)
    if (Math.abs(s - 1) < 1e-4) {
      for (let i = 0; i < N; i++) { const o = i * 4; out[o] = rgb[0][i] * a * 255; out[o + 1] = rgb[1][i] * a * 255; out[o + 2] = rgb[2][i] * a * 255; out[o + 3] = 255 }
      return out
    }
    const inv = 1 / Math.max(0.05, s)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const fx = cx + (x - cx) * inv, fy = cy + (y - cy) * inv, o = (y * W + x) * 4
      out[o + 3] = 255
      const x0 = Math.floor(fx), y0 = Math.floor(fy)
      if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) continue
      const ax = fx - x0, ay = fy - y0, i0 = y0 * W + x0
      for (let c = 0; c < 3; c++) {
        const p = rgb[c], v = (p[i0] * (1 - ax) + p[i0 + 1] * ax) * (1 - ay) + (p[i0 + W] * (1 - ax) + p[i0 + W + 1] * ax) * ay
        out[o + c] = v * a * 255
      }
    }
    return out
  }

  // ------------------------------------------------------------------ 交给 AI 特效 的形状描述

  const OUTLINE_WORDS = {
    rect: ['rectangular border', 'a thin outline around an empty middle'],
    roundrect: ['rounded-rectangle border', 'a thin outline with rounded corners around an empty middle'],
    circle: ['circular border', 'a thin round outline around an empty middle'],
    ellipse: ['oval border', 'a thin oval outline around an empty middle'],
    star: ['star-shaped border', 'a thin outline of a pointed star around an empty middle'],
    heart: ['heart-shaped border', 'a thin heart outline around an empty middle'],
    free: ['custom-shaped border', 'a thin outline following an irregular shape around an empty middle'],
    trace: ['custom-shaped border', 'a thin outline following the contour of a shape around an empty middle'],
  }
  /**
   * AI 特效 的 archetype + 形状描述（currentShape / currentPlainShape 那两句）+ 生命周期。
   * 编辑器知道画的是什么，直接给，不让检测去猜（检测把圆框当环形扩散，frame 的描述写死长方形）。
   */
  function aiDescriptor(project) {
    const fx = effectOf(project.effect)
    let kind = project.shape && project.shape.kind || 'free'
    if (kind === 'roundrect' && !(Number(project.corner) > 0)) kind = 'rect'
    if (kind === 'circle') {
      const pts = (project.outlines || []).flatMap((o) => o.points), xs = pts.map((q) => q.x), ys = pts.map((q) => q.y)
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys)
      if (pts.length && Math.abs(w - h) > 0.08 * Math.max(w, h)) kind = 'ellipse'
    }
    // 不跟轮廓走的效果：编辑器里没有形状，不给 AI 形状词
    const [noun, detail] = fx.centered ? ['central icon', 'the middle of the picture'] : fx.baseOnly ? OUTLINE_WORDS.trace : OUTLINE_WORDS[kind] || OUTLINE_WORDS.free
    const lifecycle = project.lifecycle === 'loop' ? 'loop' : 'once'
    const NOT = 'It is drawn light, NOT a solid object, NOT a carved or moulded frame, and it has NO thickness or depth'
    if (fx.kind === 'edge') {
      return { archetype: 'frame', lifecycle,
        shape: `${noun} of light, ${detail} with a bright pulse running along its edge. ${NOT}`,
        plainShape: `${noun}, ${detail} with a pulse running along its edge. It is a drawn band, NOT a solid object, NOT a carved or moulded frame, and it has NO thickness or depth` }
    }
    const shapeNoun = noun.replace(/ border$/, '')
    const [archetype, shape, plain] = fx.ai ? fx.ai({ noun, detail, shapeNoun, NOT, emit: project.params && project.params.emit, params: { ...effectDefaults(fx.id), ...(project.params || {}) } }) : ['blob', 'glowing light']
    return { archetype, lifecycle, shape, plainShape: plain || shape }
  }

  root.NovaFlowFxMaker = {
    FPS, DURATIONS, CANVASES, CANVAS_CHOICES, SHAPES, MOTIONS, registerLibrary,
    effects, effectOf, effectDefaults,
    shapeOutline, outlineCurve, outlinePolylines, traceImage, canvasSize, basePlacement, defaultProject,
    geometry, contoursOf, fillPoly, signedDistance, frameCount, timeOf,
    prepare, renderFrame, aiDescriptor, pointOnOutline,
  }
})(typeof self !== 'undefined' ? self : globalThis)
