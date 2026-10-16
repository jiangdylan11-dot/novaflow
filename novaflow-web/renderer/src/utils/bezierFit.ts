/**
 * 自定义路径的曲线：
 * - fitClosedBezier：一圈密集的轮廓点 → 尽量少的贝塞尔点（每个点带 in / out 控制柄，相对坐标）。
 *   Schneider 的拟合（An Algorithm for Automatically Fitting Digitized Curves）：先找尖角断开，
 *   每段用最小二乘求控制柄长度，误差超了就在最差的点上劈开再拟合。
 * - autoHandles：新加的点自动给平滑控制柄（Catmull-Rom 方向，长度 = 到前后点距离的 1/3）。
 */
export type V = { x: number; y: number }
export type PathPointWithHandles = { x: number; y: number; in: V; out: V }

const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y })
const mul = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s })
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y
const len = (a: V) => Math.hypot(a.x, a.y)
const norm = (a: V): V => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l } }

function bez(p: V[], t: number): V {
  const mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t
  return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y }
}
function bezD1(p: V[], t: number): V {
  const mt = 1 - t
  return add(add(mul(sub(p[1], p[0]), 3 * mt * mt), mul(sub(p[2], p[1]), 6 * mt * t)), mul(sub(p[3], p[2]), 3 * t * t))
}
function bezD2(p: V[], t: number): V {
  return add(mul(add(sub(p[2], mul(p[1], 2)), p[0]), 6 * (1 - t)), mul(add(sub(p[3], mul(p[2], 2)), p[1]), 6 * t))
}

function chordParams(d: V[], first: number, last: number) {
  const u = [0]
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + len(sub(d[i], d[i - 1])))
  const total = u[u.length - 1] || 1
  return u.map((x) => x / total)
}

function generate(d: V[], first: number, last: number, u: number[], t1: V, t2: V): V[] {
  const p0 = d[first], p3 = d[last]
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0
  for (let i = 0; i < u.length; i++) {
    const t = u[i], mt = 1 - t
    const b0 = mt * mt * mt, b1 = 3 * t * mt * mt, b2 = 3 * t * t * mt, b3 = t * t * t
    const a1 = mul(t1, b1), a2 = mul(t2, b2)
    c00 += dot(a1, a1); c01 += dot(a1, a2); c11 += dot(a2, a2)
    const tmp = sub(d[first + i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)))
    x0 += dot(a1, tmp); x1 += dot(a2, tmp)
  }
  const det = c00 * c11 - c01 * c01
  let al = Math.abs(det) > 1e-12 ? (x0 * c11 - x1 * c01) / det : 0
  let ar = Math.abs(det) > 1e-12 ? (c00 * x1 - c01 * x0) / det : 0
  const seg = len(sub(p3, p0))
  if (al < seg * 1e-6 || ar < seg * 1e-6) { al = seg / 3; ar = seg / 3 }
  return [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3]
}

function maxError(d: V[], first: number, last: number, p: V[], u: number[]) {
  let worst = 0, at = Math.floor((first + last) / 2)
  for (let i = first + 1; i < last; i++) {
    const e = len(sub(bez(p, u[i - first]), d[i]))
    if (e > worst) { worst = e; at = i }
  }
  return { worst, at }
}

function reparam(d: V[], first: number, p: V[], u: number[]) {
  return u.map((t, i) => {
    const q = sub(bez(p, t), d[first + i]), q1 = bezD1(p, t), q2 = bezD2(p, t)
    const den = dot(q1, q1) + dot(q, q2)
    const next = Math.abs(den) > 1e-12 ? t - dot(q, q1) / den : t
    return Math.max(0, Math.min(1, next))
  })
}

function fitCubic(d: V[], first: number, last: number, t1: V, t2: V, tol: number, out: V[][], depth = 0) {
  if (last - first < 2) {
    const dist = len(sub(d[last], d[first])) / 3
    out.push([d[first], add(d[first], mul(t1, dist)), add(d[last], mul(t2, dist)), d[last]])
    return
  }
  let u = chordParams(d, first, last)
  let p = generate(d, first, last, u, t1, t2)
  let e = maxError(d, first, last, p, u)
  if (e.worst <= tol || depth > 40) { out.push(p); return }
  if (e.worst <= tol * 3) {
    for (let k = 0; k < 6; k++) {
      u = reparam(d, first, p, u)
      p = generate(d, first, last, u, t1, t2)
      e = maxError(d, first, last, p, u)
      if (e.worst <= tol) { out.push(p); return }
    }
  }
  const at = Math.max(first + 1, Math.min(last - 1, e.at))
  const tc = norm(sub(d[Math.max(first, at - 2)], d[Math.min(last, at + 2)]))
  fitCubic(d, first, at, t1, tc, tol, out, depth + 1)
  fitCubic(d, at, last, mul(tc, -1), t2, tol, out, depth + 1)
}

/** 一圈闭合的密集点 → 少量贝塞尔点（相对控制柄）；tol = 允许偏离原轮廓的像素 */
export function fitClosedBezier(src: V[], tol: number): PathPointWithHandles[] {
  // 去掉重复点
  const raw: V[] = []
  for (const p of src) if (!raw.length || len(sub(p, raw[raw.length - 1])) > 1e-3) raw.push({ x: p.x, y: p.y })
  if (raw.length > 2 && len(sub(raw[0], raw[raw.length - 1])) < 1e-3) raw.pop()
  if (raw.length < 4) return raw.map((p) => ({ ...p, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }))
  // 等距重采样（像素轮廓点又密又带锯齿）：间距约 2 像素，最多 900 个点
  let perim = 0
  for (let i = 0; i < raw.length; i++) perim += len(sub(raw[(i + 1) % raw.length], raw[i]))
  const step = Math.max(perim / 900, Math.min(2, perim / 24))
  const pts: V[] = [raw[0]]
  let carry = 0
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i], b = raw[(i + 1) % raw.length], l = len(sub(b, a))
    let t = step - carry
    while (t <= l) { pts.push(add(a, mul(sub(b, a), t / l))); t += step }
    carry = l - (t - step)
  }
  if (pts.length > 3 && len(sub(pts[0], pts[pts.length - 1])) < step * 0.5) pts.pop()
  const n = pts.length
  if (n < 4) return pts.map((p) => ({ ...p, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }))
  const at = (i: number) => pts[((i % n) + n) % n]
  // 方向看前后约 10 像素（锯齿不算拐角）；拐角 > 60° 的地方断开（局部最尖的那个点）
  const k = Math.max(2, Math.min(Math.floor(n / 8), Math.round(10 / step)))
  const turn = (i: number) => { const a = norm(sub(at(i), at(i - k))), b = norm(sub(at(i + k), at(i))); return Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) }
  const corners: number[] = []
  for (let i = 0; i < n; i++) {
    const t = turn(i)
    if (t < (60 * Math.PI) / 180) continue
    let peak = true
    for (let j = -k; j <= k && peak; j++) if (j && turn(i + j) > t) peak = false
    if (peak && (!corners.length || i - corners[corners.length - 1] > k)) corners.push(i)
  }
  if (corners.length > 1 && corners[0] + n - corners[corners.length - 1] <= k) corners.pop()
  const segs: V[][] = []
  if (!corners.length) {
    // 没有尖角：从曲率最大处开始绕一圈，接缝处保持平滑
    let s = 0, best = -1
    for (let i = 0; i < n; i++) { const t = turn(i); if (t > best) { best = t; s = i } }
    const d = Array.from({ length: n + 1 }, (_, i) => at(s + i))
    const t1 = norm(sub(at(s + k), at(s - k)))
    fitCubic(d, 0, n, t1, mul(t1, -1), tol, segs)
  } else {
    for (let c = 0; c < corners.length; c++) {
      const a = corners[c], b = c + 1 < corners.length ? corners[c + 1] : corners[0] + n
      const d = Array.from({ length: b - a + 1 }, (_, i) => at(a + i))
      const kk = Math.max(1, Math.min(k, Math.floor((d.length - 1) / 2)))
      const t1 = norm(sub(d[kk], d[0])), t2 = norm(sub(d[d.length - 1 - kk], d[d.length - 1]))
      fitCubic(d, 0, d.length - 1, t1, t2, tol, segs)
    }
  }
  const r = (v: number) => Math.round(v * 10) / 10
  return segs.map((sg, i) => {
    const prev = segs[(i - 1 + segs.length) % segs.length]
    return { x: r(sg[0].x), y: r(sg[0].y), in: { x: r(prev[2].x - prev[3].x), y: r(prev[2].y - prev[3].y) }, out: { x: r(sg[1].x - sg[0].x), y: r(sg[1].y - sg[0].y) } }
  })
}

/** 第 i 个点的平滑控制柄（新加的点用）：方向 = 前一点 → 后一点，长度 = 到前 / 后点距离的 1/3 */
export function autoHandles(pts: V[], i: number, closed: boolean): { in: V; out: V } {
  const n = pts.length, p = pts[i]
  const prev = i > 0 ? pts[i - 1] : closed && n > 2 ? pts[n - 1] : null
  const next = i < n - 1 ? pts[i + 1] : closed && n > 2 ? pts[0] : null
  if (!prev && !next) return { in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }
  const dir = norm(prev && next ? sub(next, prev) : next ? sub(next, p) : sub(p, prev as V))
  const dIn = prev ? len(sub(p, prev)) / 3 : 0, dOut = next ? len(sub(next, p)) / 3 : 0
  const r = (v: number) => Math.round(v * 10) / 10
  return { in: { x: r(-dir.x * dIn), y: r(-dir.y * dIn) }, out: { x: r(dir.x * dOut), y: r(dir.y * dOut) } }
}
