// AI 特效 · 模板制作 —— 效果库（技能 / 法阵 / 闪电 / 烟雾 / 水 / 冰 / 扩散 / 爆炸 / 消失 / 破碎）。2026-10-15 接入正式链。
// AI 特效 · 模板编辑器 效果库（测试链，第二版）。
// 2026-10-15 用户：轮廓流光（复刻特效扫光）没问题，新加的「怎么那么丑…多出点好看的方案让我选」。
// 这一版按游戏特效的做法画：光在 HDR 里叠加（每个效果自带 深色 → 主色 → 烧白 的配色），三层泛光，
// 粒子按速度拉出锥形拖尾、随寿命冷却、带闪烁和湍流，形状光效沿轮廓有明暗起伏。
// 加载顺序：sweep-light.core.js → fx-maker.core.js → 本文件（注册到 NovaFlowFxMaker）。

;(function (root) {
  'use strict'
  const FXM = () => root.NovaFlowFxMaker

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
  const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t) }
  const frac = (v) => v - Math.floor(v)
  const lerp = (a, b, t) => a + (b - a) * t
  const TAU = Math.PI * 2
  function rng(seed) {
    seed |= 0
    return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  }

  // ------------------------------------------------------------------ 配色

  const PAL = {
    gold: { deep: [0.5, 0.17, 0.0], mid: [1.0, 0.62, 0.14], hot: [1.0, 0.95, 0.78] },
    fire: { deep: [0.55, 0.04, 0.0], mid: [1.0, 0.36, 0.04], hot: [1.0, 0.88, 0.5] },
    cyan: { deep: [0.0, 0.16, 0.5], mid: [0.12, 0.66, 1.0], hot: [0.86, 0.98, 1.0] },
    violet: { deep: [0.25, 0.02, 0.5], mid: [0.66, 0.3, 1.0], hot: [0.97, 0.86, 1.0] },
    pink: { deep: [0.5, 0.03, 0.22], mid: [1.0, 0.42, 0.68], hot: [1.0, 0.92, 0.96] },
    green: { deep: [0.04, 0.3, 0.06], mid: [0.5, 1.0, 0.3], hot: [0.94, 1.0, 0.82] },
    ice: { deep: [0.08, 0.24, 0.52], mid: [0.5, 0.82, 1.0], hot: [0.95, 0.99, 1.0] },
    electric: { deep: [0.16, 0.05, 0.62], mid: [0.42, 0.55, 1.0], hot: [0.9, 0.95, 1.0] },
    white: { deep: [0.36, 0.38, 0.44], mid: [0.82, 0.86, 0.95], hot: [1, 1, 1] },
    smoke: { deep: [0.1, 0.1, 0.11], mid: [0.46, 0.47, 0.5], hot: [0.9, 0.9, 0.92] },
    water: { deep: [0.0, 0.16, 0.4], mid: [0.12, 0.56, 0.95], hot: [0.86, 0.97, 1.0] },
  }
  const MULTI = [PAL.gold, PAL.cyan, PAL.pink, PAL.green, PAL.violet]
  function ramp(pal, h, out) {
    h = clamp01(h)
    const a = h < 0.5 ? pal.deep : pal.mid, b = h < 0.5 ? pal.mid : pal.hot, f = h < 0.5 ? h * 2 : (h - 0.5) * 2
    out[0] = a[0] + (b[0] - a[0]) * f; out[1] = a[1] + (b[1] - a[1]) * f; out[2] = a[2] + (b[2] - a[2]) * f
    return out
  }
  function palFromHex(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
    if (!m) return PAL.white
    const n = parseInt(m[1], 16), c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
    const k = Math.max(c[0], c[1], c[2], 1e-3), mid = c.map((v) => v / k)
    return { deep: mid.map((v) => v * 0.42), mid, hot: mid.map((v) => 0.72 + 0.28 * v) }
  }
  const C = [0, 0, 0], C2 = [0, 0, 0]

  // ------------------------------------------------------------------ 画笔（D = { W, H, R, G, B } 能量层）

  function dot(D, x, y, s, k, c) {
    if (!(k > 1e-4)) return
    s = Math.max(0.5, s)
    const r = Math.ceil(s * 3), W = D.W, H = D.H
    const xa = Math.max(0, Math.floor(x - r)), xb = Math.min(W - 1, Math.ceil(x + r)), ya = Math.max(0, Math.floor(y - r)), yb = Math.min(H - 1, Math.ceil(y + r))
    if (xa > xb || ya > yb) return
    const inv = 1 / (2 * s * s), cr = c[0] * k, cg = c[1] * k, cb = c[2] * k
    for (let yy = ya; yy <= yb; yy++) {
      const dy2 = (yy - y) * (yy - y), row = yy * W
      for (let xx = xa; xx <= xb; xx++) {
        const e = Math.exp(-((xx - x) * (xx - x) + dy2) * inv)
        if (e < 0.004) continue
        const i = row + xx
        D.R[i] += cr * e; D.G[i] += cg * e; D.B[i] += cb * e
      }
    }
  }
  // 锥形光条：从 (x0,y0) 宽 w0 亮 k0 色 c0 到 (x1,y1) 宽 w1 亮 k1 色 c1
  function streak(D, x0, y0, x1, y1, w0, w1, k0, k1, c0, c1) {
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy
    if (l2 < 0.25) { dot(D, x1, y1, Math.max(w0, w1), Math.max(k0, k1), c1); return }
    const W = D.W, H = D.H, wm = Math.max(w0, w1, 0.5), pad = wm * 3
    const xa = Math.max(0, Math.floor(Math.min(x0, x1) - pad)), xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + pad))
    const ya = Math.max(0, Math.floor(Math.min(y0, y1) - pad)), yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + pad))
    const inv = 1 / l2
    for (let yy = ya; yy <= yb; yy++) for (let xx = xa; xx <= xb; xx++) {
      const px = xx - x0, py = yy - y0
      const t = clamp01((px * dx + py * dy) * inv)
      const ex = px - t * dx, ey = py - t * dy, w = Math.max(0.5, w0 + (w1 - w0) * t)
      const e = Math.exp(-(ex * ex + ey * ey) / (2 * w * w))
      if (e < 0.004) continue
      const k = (k0 + (k1 - k0) * t) * e, i = yy * W + xx
      D.R[i] += (c0[0] + (c1[0] - c0[0]) * t) * k; D.G[i] += (c0[1] + (c1[1] - c0[1]) * t) * k; D.B[i] += (c0[2] + (c1[2] - c0[2]) * t) * k
    }
  }
  // 星芒：中心亮点 + 细长光芒（arms = 4 或 6，外加一圈短斜芒）
  function star(D, x, y, size, rot, k, c, arms = 4) {
    if (!(k > 1e-3)) return
    const W = D.W, H = D.H, al = size * 7, aw = Math.max(0.45, size * 0.22), r = Math.ceil(al * 2.4)
    const xa = Math.max(0, Math.floor(x - r)), xb = Math.min(W - 1, Math.ceil(x + r)), ya = Math.max(0, Math.floor(y - r)), yb = Math.min(H - 1, Math.ceil(y + r))
    const n = arms / 2, dirs = []
    for (let j = 0; j < n; j++) { const a = rot + (j * Math.PI) / n; dirs.push([Math.cos(a), Math.sin(a)]) }
    const d2 = [Math.cos(rot + Math.PI / (2 * n)), Math.sin(rot + Math.PI / (2 * n))]
    const cs = 1 / (2 * (size * 0.9) ** 2)
    for (let yy = ya; yy <= yb; yy++) for (let xx = xa; xx <= xb; xx++) {
      const dx = xx - x, dy = yy - y
      let v = Math.exp(-(dx * dx + dy * dy) * cs) * 1.6
      for (const [ca, sa] of dirs) { const u = dx * ca + dy * sa, w = -dx * sa + dy * ca; v += Math.exp(-Math.abs(w) / aw - Math.abs(u) / al) }
      { const u = dx * d2[0] + dy * d2[1], w = -dx * d2[1] + dy * d2[0]; v += 0.35 * Math.exp(-Math.abs(w) / aw - Math.abs(u) / (al * 0.35)) }
      if (v < 0.004) continue
      const i = yy * W + xx
      D.R[i] += c[0] * v * k; D.G[i] += c[1] * v * k; D.B[i] += c[2] * v * k
    }
  }
  // 实心多边形（凹的也行：奇偶规则判里外，到最近边的距离做 1 px 软边），边上加亮
  function poly(D, pts, k, c, edgeK = 0, edgeC = c) {
    const W = D.W, H = D.H, m = pts.length
    let xa = Infinity, xb = -Infinity, ya = Infinity, yb = -Infinity
    for (const [px, py] of pts) { xa = Math.min(xa, px); xb = Math.max(xb, px); ya = Math.min(ya, py); yb = Math.max(yb, py) }
    xa = Math.max(0, Math.floor(xa - 1)); xb = Math.min(W - 1, Math.ceil(xb + 1)); ya = Math.max(0, Math.floor(ya - 1)); yb = Math.min(H - 1, Math.ceil(yb + 1))
    for (let yy = ya; yy <= yb; yy++) for (let xx = xa; xx <= xb; xx++) {
      let inside = false, d2 = Infinity
      for (let a = 0, b = m - 1; a < m; b = a++) {
        const [ax, ay] = pts[a], [bx, by] = pts[b]
        if ((ay > yy) !== (by > yy) && xx < ((bx - ax) * (yy - ay)) / (by - ay) + ax) inside = !inside
        const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1e-9, t = clamp01(((xx - ax) * ex + (yy - ay) * ey) / l2)
        const dx = xx - ax - t * ex, dy = yy - ay - t * ey, q = dx * dx + dy * dy
        if (q < d2) d2 = q
      }
      const d = Math.sqrt(d2), cov = inside ? clamp01(0.5 + d) : clamp01(0.5 - d)
      if (!(cov > 0)) continue
      const edge = edgeK && inside ? Math.exp(-((d / 1.1) ** 2)) * edgeK : 0, i = yy * W + xx
      D.R[i] += c[0] * k * cov + edgeC[0] * edge; D.G[i] += c[1] * k * cov + edgeC[1] * edge; D.B[i] += c[2] * k * cov + edgeC[2] * edge
    }
  }
  // 椭圆片（金币 / 光球）：内部 k、边缘 rimK
  function disc(D, x, y, rx, ry, rot, k, c, rimK, rimC = c) {
    const W = D.W, H = D.H, r = Math.max(rx, ry) + 2
    const xa = Math.max(0, Math.floor(x - r)), xb = Math.min(W - 1, Math.ceil(x + r)), ya = Math.max(0, Math.floor(y - r)), yb = Math.min(H - 1, Math.ceil(y + r))
    const ca = Math.cos(rot), sa = Math.sin(rot), ix = 1 / Math.max(0.4, rx), iy = 1 / Math.max(0.4, ry), pxl = Math.min(ix, iy)
    for (let yy = ya; yy <= yb; yy++) for (let xx = xa; xx <= xb; xx++) {
      const dx = xx - x, dy = yy - y, u = (dx * ca + dy * sa) * ix, v = (-dx * sa + dy * ca) * iy
      const q = Math.sqrt(u * u + v * v), d = (q - 1) / pxl   // 到边的大约像素距离（负 = 里面）
      const cov = clamp01(0.5 - d)
      if (!(cov > 0) && d > 2) continue
      const rim = Math.exp(-(((d + 0.6) / 1.1) ** 2)) * rimK, i = yy * W + xx
      D.R[i] += c[0] * k * cov + rimC[0] * rim; D.G[i] += c[1] * k * cov + rimC[1] * rim; D.B[i] += c[2] * k * cov + rimC[2] * rim
    }
  }
  function addPixel(D, i, k, c) { D.R[i] += c[0] * k; D.G[i] += c[1] * k; D.B[i] += c[2] * k }
  // 底图画面：把源像素 src 的颜色 × k 画到 dst（碎块 / 收缩 / 化开都用；没有底图或这一层不用底图时什么都不做）
  function putImg(D, geo, dst, src, k) {
    const im = geo.img
    if (!im || !D.IR || !(k > 0.003)) return
    const a = Math.min(1, im.A[src] * k), keep = 1 - a, f = Math.min(1, k)
    D.IR[dst] = im.R[src] * f + D.IR[dst] * keep; D.IG[dst] = im.G[src] * f + D.IG[dst] * keep; D.IB[dst] = im.B[src] * f + D.IB[dst] * keep; D.IA[dst] = a + D.IA[dst] * keep
  }
  // 3D：绕 X / Y / Z 轴转，再按轻微透视投到屏幕（z 朝观众为正，近大远小）→ [x, y, z, 缩放]
  function rotX(q, a) { const c = Math.cos(a), n = Math.sin(a); return [q[0], q[1] * c - q[2] * n, q[1] * n + q[2] * c] }
  function rotY(q, a) { const c = Math.cos(a), n = Math.sin(a); return [q[0] * c + q[2] * n, q[1], -q[0] * n + q[2] * c] }
  function rotZ(q, a) { const c = Math.cos(a), n = Math.sin(a); return [q[0] * c - q[1] * n, q[0] * n + q[1] * c, q[2]] }
  function proj(cx, cy, R, q) { const k = 1 / (1 - q[2] * 0.18); return [cx + q[0] * R * k, cy + q[1] * R * k, q[2], k] }
  // 一串点连成光线：每段一条 streak，宽 / 亮 / 色按点给
  function polyline(D, pts, wf, kf, cf) { for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; streak(D, a[0], a[1], b[0], b[1], wf(i), wf(i + 1), kf(i), kf(i + 1), cf(i), cf(i + 1)) } }
  // 环上（0..1 绕一圈）两点的距离
  function cdist(a, b) { const d = frac(a - b); return Math.min(d, 1 - d) }

  // ------------------------------------------------------------------ 噪声

  function hash(x, y, s) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }
  // x 方向周期为 px（整数，0 = 不循环）
  function vnoise(x, y, s, px = 0) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
    const x0 = px ? ((xi % px) + px) % px : xi, x1 = px ? (x0 + 1) % px : xi + 1
    const a = hash(x0, yi, s), b = hash(x1, yi, s), c = hash(x0, yi + 1, s), d = hash(x1, yi + 1, s)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  function fbm(x, y, s, oct = 3, px = 0) {
    let v = 0, a = 0.5, n = 0, f = 1
    for (let o = 0; o < oct; o++) { v += a * vnoise(x * f, y * f, s + o * 31, px ? px * f : 0); n += a; a *= 0.5; f *= 2 }
    return v / n
  }

  // ------------------------------------------------------------------ 形状辅助

  // 每个像素最近的外圈轮廓点的弧长占比 T（0..1，绕一圈），带特征变换
  function outlineParam(geo) {
    if (geo._T) return geo._T
    if (geo.derived && geo.derived.outlineT) return (geo._T = geo.derived.outlineT)
    const { W, H, N } = geo, seed = new Int32Array(N).fill(-1), tv = []
    const total = geo.outer.reduce((a, c) => a + c.len, 0) || 1
    let acc = 0
    for (const c of geo.outer) {
      for (let k = 0; k < c.x.length; k++) {
        const px = clamp(Math.round(c.x[k]), 0, W - 1), py = clamp(Math.round(c.y[k]), 0, H - 1), i = py * W + px
        if (seed[i] < 0) { seed[i] = tv.length; tv.push((acc + c.t[k] * c.len) / total) }
      }
      acc += c.len
    }
    const T = new Float32Array(N)
    if (!tv.length) { geo._T = T; if (geo.derived) geo.derived.outlineT = T; return T }
    const INF = 1e20, n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), a = new Int32Array(n)
    const run = (len) => {
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF
      for (let q = 1; q < len; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF
      }
      k = 0
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; a[q] = v[k] }
    }
    const g = new Float64Array(N), rowOf = new Int32Array(N)
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) f[y] = seed[y * W + x] >= 0 ? 0 : INF
      run(H)
      for (let y = 0; y < H; y++) { g[y * W + x] = d[y]; rowOf[y * W + x] = a[y] }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) f[x] = g[y * W + x]
      run(W)
      for (let x = 0; x < W; x++) { const xx = a[x], yy = rowOf[y * W + xx], s = seed[yy * W + xx]; T[y * W + x] = s >= 0 ? tv[s] : 0 }
    }
    geo._T = T
    if (geo.derived) geo.derived.outlineT = T
    return T
  }
  const pointOn = (geo, u) => FXM().pointOnOutline(geo, u)
  // 形状里随便一点：按外框比例取、落在外面就重取（各自一个小随机源）——和渲染尺寸无关，预览和成片的碎块 / 粒子位置一样
  // （原来按「第几个里面的像素」取，预览缩小渲染时换一批位置）
  function insidePoint(geo, rnd) {
    if (!geo.inside.length) return { x: geo.cx, y: geo.cy }
    const r = rng(Math.floor(rnd() * 2147483647) + 1), b = geo.bbox, W = geo.W
    for (let k = 0; k < 200; k++) {
      const x = b.x0 + r() * (b.x1 + 1 - b.x0), y = b.y0 + r() * (b.y1 + 1 - b.y0), xi = Math.floor(x), yi = Math.floor(y)
      if (xi >= 0 && yi >= 0 && xi < W && yi < geo.H && geo.cov[yi * W + xi] >= 0.5) return { x, y }
    }
    const i = geo.inside[Math.floor(r() * geo.inside.length)], x = i % W
    return { x: x + 0.5, y: (i - x) / W + 0.5 }
  }
  function emitAt(ctx, rnd) {
    const where = ctx.params.emit || 'edge'
    if (where === 'inside') return { ...insidePoint(ctx.geo, rnd), nx: 0, ny: -1 }
    if (where === 'around') { const q = pointOn(ctx.geo, rnd()), d = (6 + rnd() * 40) * ctx.geo.u * (ctx.params.spread || 1); return { x: q.x + q.nx * d, y: q.y + q.ny * d, nx: q.nx, ny: q.ny } }
    return pointOn(ctx.geo, rnd())
  }

  /**
   * 粒子循环：每颗粒子按槽位重生。循环模式下每段 k 次（整数 → 首尾相接），每次重生换一组随机数；
   * 一次性模式下出生时刻落在 born 区间，寿命 life（占整段的比例）。fn(rnd, age, i)。
   */
  function eachParticle(ctx, count, o, fn) {
    const dur = ctx.n / 24, k = Math.max(1, Math.round(dur / (o.slot || 1.6))), minLife = o.minLife == null ? 0.65 : o.minLife
    for (let i = 0; i < count; i++) {
      const base = rng((o.salt || 1) * 7919 + i * 104723)
      const phase = base(), lifeK = minLife + base() * (1 - minLife)
      let a, cyc = 0
      if (ctx.loop) { const g = ctx.t * k + phase; cyc = ((Math.floor(g) % k) + k) % k; a = frac(g) / lifeK }
      else { const b = o.born || [0, 0.55], born = b[0] + phase * (b[1] - b[0]); a = (ctx.t - born) / ((o.life || 0.45) * lifeK) }
      if (!(a >= 0 && a < 1)) continue
      fn(rng((o.salt || 1) * 31 + i * 7919 + cyc * 1299709 + 3), a, i)
    }
  }
  const cnt = (ctx, base) => Math.max(1, Math.round(base * clamp(Number(ctx.params.count) || 1, 0.05, 8)))

  // ------------------------------------------------------------------ 第四轮辅助（2026-10-15：「像草稿」→ 逐像素圆环、纺锤光条、扭曲噪声、卢恩字形、画板内适配）

  // 画板内可用：以形状中心为圆心不超出画板（extent = 效果最外沿 / 给的半径）
  // 软限制：小的时候基本不变，越接近边越慢、永远到不了边——滑块拉到底也一直有反应（硬截断会让滑块后半段失灵）
  const softFit = (want, room) => (room > 0 ? room * (1 - Math.exp(-Math.max(0, want) / room)) : 0)
  const fitR = (geo, want, extent = 1) => Math.max(6 * geo.u, softFit(want, geo.Rfit / extent))
  // 从轮廓往外的距离（形状外沿 Rout 之外还剩多少）
  const fitOut = (geo, want, extent = 1) => Math.max(4 * geo.u, softFit(want, Math.max(6 * geo.u, (geo.Rfit - geo.Rout) / extent)))
  // 逐点：这个像素往外还剩多少空间 = 离轮廓 s + 离画板边（减边距）。沿垂直画板边的方向走这个和不变，所以光环 / 光雾在一处是整齐的。
  // 2026-10-15 用户：外扩拉大后 灵气外溢 / 圣光放射 只剩一圈描边——fitOut 按整个形状离画板最近的那一处给一个统一长度，
  // 形状一大（或斜放）哪里都缩没了；改成每处按自己的空间，贴边的地方短、空的地方长
  const roomAt = (geo, i, s) => Math.max(0, s) + geo.edge[i]
  const fitHere = (geo, i, s, want, extent = 1) => Math.max(2 * geo.u, softFit(want, Math.max(2 * geo.u, roomAt(geo, i, s) / extent)))
  const edgeAt = (geo, x, y) => geo.edge[clamp(Math.round(y), 0, geo.H - 1) * geo.W + clamp(Math.round(x), 0, geo.W - 1)]
  function boxOf(geo, cx, cy, r) { return [Math.max(0, Math.floor(cx - r)), Math.min(geo.W - 1, Math.ceil(cx + r)), Math.max(0, Math.floor(cy - r)), Math.min(geo.H - 1, Math.ceil(cy + r))] }
  // 扭曲的 fbm（domain warp）：云 / 火 / 烟的翻卷感
  // ---- 连贯发光线：折线一段段画进「取最亮」的线场（不叠加），接头不会冒出一颗颗亮珠；画完一次性加进能量
  function lineMax(F, W, H, x0, y0, x1, y1, w0, w1, k0, k1) {
    const pad = 2.7 * Math.max(w0, w1, 0.3), bx0 = Math.max(0, Math.floor(Math.min(x0, x1) - pad)), bx1 = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + pad))
    const by0 = Math.max(0, Math.floor(Math.min(y0, y1) - pad)), by1 = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + pad))
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1e-6
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      const t = clamp01(((x - x0) * dx + (y - y0) * dy) / l2), px = x0 + dx * t - x, py = y0 + dy * t - y, w = Math.max(0.3, w0 + (w1 - w0) * t), d2 = (px * px + py * py) / (w * w)
      if (d2 > 7) continue
      const v = (k0 + (k1 - k0) * t) * Math.exp(-d2), i = y * W + x
      if (v > F[i]) F[i] = v
    }
  }
  const glowLines = (geo) => ({ core: new Float32Array(geo.N), halo: new Float32Array(geo.N) })
  function lineGlow(G, geo, x0, y0, x1, y1, w0, w1, k0, k1, haloW = 3.2, haloK = 0.2) {
    lineMax(G.core, geo.W, geo.H, x0, y0, x1, y1, w0, w1, k0, k1)
    lineMax(G.halo, geo.W, geo.H, x0, y0, x1, y1, w0 * haloW, w1 * haloW, k0 * haloK, k1 * haloK)
  }
  function flushGlow(D, G, hot, mid, bright = 1) {
    for (let i = 0; i < G.core.length; i++) { const c = G.core[i], h = G.halo[i]; if (c > 0.002) addPixel(D, i, c * bright, hot); if (h > 0.002) addPixel(D, i, h * bright, mid) }
  }
  // ---- 闪电：朝终点一步步走，每步偏一个随机角（真闪电是直段 + 急转，不是平滑的弯），再加两层细碎抖动
  function boltPath(rnd, x0, y0, x1, y1, rough = 0.3) {
    const L = Math.hypot(x1 - x0, y1 - y0) || 1, gauss = () => (rnd() + rnd() + rnd() - 1.5) * 2, kink = 0.35 + rough * 1.3
    let pts = [[x0, y0]], x = x0, y = y0
    for (let guard = 0; guard < 60; guard++) {
      const dx = x1 - x, dy = y1 - y, rem = Math.hypot(dx, dy), step = L * (0.045 + rnd() * 0.065)
      if (rem < step * 1.3) break
      const a = Math.atan2(dy, dx) + gauss() * kink * Math.min(1, rem / (L * 0.3))
      x += Math.cos(a) * step; y += Math.sin(a) * step; pts.push([x, y])
    }
    pts.push([x1, y1])
    let r = 0.16
    for (let d = 0; d < 2; d++) {
      const out = [pts[0]]
      for (let k = 1; k < pts.length; k++) {
        const [ax, ay] = pts[k - 1], [bx, by] = pts[k], ddx = bx - ax, ddy = by - ay, l = Math.hypot(ddx, ddy) || 1, o = (rnd() - 0.5) * 2 * r * l
        out.push([(ax + bx) / 2 - (ddy / l) * o, (ay + by) / 2 + (ddx / l) * o], pts[k])
      }
      pts = out; r *= 0.55
    }
    return pts
  }
  // 一道闪电和它的分叉（两级）：[{ pts, w, k, from }]，from = 分叉在主干上的位置（0..1），主干长到那里分叉才开始长
  function boltTree(rnd, x0, y0, x1, y1, branches = 3, rough = 0.3, branchLen = 0.4) {
    const main = boltPath(rnd, x0, y0, x1, y1, rough), out = [{ pts: main, w: 1, k: 1, from: 0 }]
    const L = Math.hypot(x1 - x0, y1 - y0)
    const sprout = (src, f, len, w, k, from) => {
      const j = Math.max(1, Math.floor(f * (src.length - 1))), [bx, by] = src[j], [px, py] = src[j - 1]
      const a = Math.atan2(by - py, bx - px) + (rnd() < 0.5 ? -1 : 1) * (0.4 + rnd() * 0.55)
      const pts = boltPath(rnd, bx, by, bx + Math.cos(a) * len, by + Math.sin(a) * len, rough * 1.1)
      out.push({ pts, w, k, from })
      return pts
    }
    for (let b = 0; b < branches; b++) {
      const f = 0.1 + rnd() * 0.65, br = sprout(main, f, L * branchLen * (0.35 + rnd() * 0.65), 0.55, 0.58, f)
      if (rnd() < 0.55) sprout(br, 0.3 + rnd() * 0.4, L * branchLen * 0.35 * (0.4 + rnd() * 0.6), 0.35, 0.32, Math.min(0.98, f + 0.1))
    }
    return out
  }
  // 画一棵闪电：grow = 主干长到哪（0..1）；根粗尖细；fade0 = 起点那一截淡入（从画板外劈下来的不在边上留硬头）
  function drawBolt(G, geo, tree, grow, k, w, fade0 = 0) {
    for (const br of tree) {
      const pts = br.pts, n = pts.length - 1, g = br.from ? clamp01((grow - br.from) / Math.max(0.05, 1 - br.from)) : grow, last = g * n
      for (let j = 1; j <= n && j - 1 < last; j++) {
        const f = Math.min(1, last - (j - 1)), [ax, ay] = pts[j - 1], bx = ax + (pts[j][0] - ax) * f, by = ay + (pts[j][1] - ay) * f
        const wa = w * br.w * (1 - 0.5 * (j - 1) / n), wb = w * br.w * (1 - 0.5 * j / n)
        const fa = fade0 && !br.from ? smooth(0, fade0, (j - 1) / n) : 1, fb = fade0 && !br.from ? smooth(0, fade0, j / n) : 1
        lineGlow(G, geo, ax, ay, bx, by, wa, wb, k * br.k * fa, k * br.k * fb, 4.2, 0.3)
      }
    }
  }
  // 烟：密度软（宽门槛、少八度、轻扭曲），明暗用大块低频变化——按梯度打光会像揉皱的纸（2026-10-15 第一版就是）
  // 里面再叠一层中等大小的翻卷（不然烟团里面是平的一块灰）；都按 t / t − 1 交叉，循环首尾接上
  function smokeShade(D, i, dens, x, y, sc, t, F, seed, pal, bright) {
    // 坐标转一个角度再取噪声：值噪声的格子是横平竖直的，门槛一卡就露出方块
    const rx = x * 0.8 - y * 0.6, ry = x * 0.6 + y * 0.8
    const sh = (k) => fbm(rx * sc * 0.45 + 11, ry * sc * 0.45 + k * F * 0.45, seed + 1, 2), de = (k) => wfbm(rx * sc * 1.4 + 5, ry * sc * 1.4 + k * F * 1.4, seed + 2, 3, 0.8)
    const shade = 0.7 + 0.3 * smooth(0.3, 0.8, vblend(sh(t), sh(t - 1), t)), billow = 0.5 + 0.5 * smooth(0.25, 0.8, vblend(de(t), de(t - 1), t)), d = dens * billow
    addPixel(D, i, d * shade * 1.05 * bright, ramp(pal, 0.18 + 0.66 * Math.min(1, d * 1.25) * shade, C))
  }
  // 冰晶尖刺：底 (x, y) 朝 ang 长 len、宽 wid；受光的一半亮、背光的一半暗、棱上一道亮线
  function crystal(D, G, geo, x, y, ang, len, wid, k, lit, dark, edge, glint = 0) {
    if (!(len > 0.5) || !(k > 0.002)) return
    const dx = Math.cos(ang), dy = Math.sin(ang), px = -dy, py = dx, sh = len * 0.28
    const B = [x - dx * len * 0.06, y - dy * len * 0.06], T = [x + dx * len, y + dy * len]
    const L = [x + px * wid * 0.5 + dx * sh, y + py * wid * 0.5 + dy * sh], R = [x - px * wid * 0.5 + dx * sh, y - py * wid * 0.5 + dy * sh]
    poly(D, [B, L, T], k * 0.55, lit, k * 0.5, edge)
    poly(D, [B, T, R], k * 0.22, dark, k * 0.3, lit)
    if (G) lineGlow(G, geo, B[0], B[1], T[0], T[1], 0.7 * geo.u, 0.35 * geo.u, k * (0.5 + glint), k * (0.3 + glint * 1.5), 3, 0.15)
  }
  // 循环用的交叉过渡：a（t 那份）和 b（t − 1 那份）按 t 混，保持起伏的幅度（直接平均在 t = 0.5 时对比度掉三成、发糊）
  const vblend = (a, b, t) => 0.5 + ((a - 0.5) * (1 - t) + (b - 0.5) * t) / Math.sqrt((1 - t) * (1 - t) + t * t)
  function wfbm(x, y, s, oct = 4, amt = 1.5) { const a = fbm(x + 3.1, y + 1.7, s + 101, 3), b = fbm(x - 2.3, y + 4.4, s + 202, 3); return fbm(x + amt * a, y + amt * b, s, oct) }
  // 纺锤光条：两头细、peak 处最粗最亮，颜色 内 → 峰 → 外
  function spindle(D, x0, y0, x1, y1, w, k, c0, c1, c2, peak = 0.6) {
    const mx = x0 + (x1 - x0) * peak, my = y0 + (y1 - y0) * peak
    streak(D, x0, y0, mx, my, w * 0.2, w, k * 0.2, k, c0, c1)
    streak(D, mx, my, x1, y1, w, w * 0.15, k, k * 0.3, c1, c2)
  }
  /**
   * 圆环 / 圆弧（逐像素，没有分段接缝的亮点）：半径 r、高斯宽 w。
   * o.mod(角度) 0..1 调亮度（0 = 不画，做圆弧 / 虚线）；o.wf(角度) 改宽度（月牙）；o.inner / o.outer 只画内侧 / 外侧的软边；
   * o.sy 竖向压扁（地面透视）。
   */
  function ringPx(D, cx, cy, r, w, k, col, o = {}) {
    const W = D.W, H = D.H, wMax = o.wMax || w, pad = wMax * 3.2 + 1, R1 = r + pad, R0 = Math.max(0, r - pad), sy = o.sy || 1
    const x0 = Math.max(0, Math.floor(cx - R1)), x1 = Math.min(W - 1, Math.ceil(cx + R1)), y0 = Math.max(0, Math.floor(cy - R1 * sy)), y1 = Math.min(H - 1, Math.ceil(cy + R1 * sy))
    const cr = col[0] * k, cg = col[1] * k, cb = col[2] * k
    for (let y = y0; y <= y1; y++) {
      const dy = (y - cy) / sy   // sy < 1：压扁成地面上的椭圆（透视）
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, d2 = dx * dx + dy * dy
        if (d2 > R1 * R1 || d2 < R0 * R0) continue
        let m = 1, ww = w
        if (o.mod || o.wf) { const a = Math.atan2(dy, dx); if (o.mod) { m = o.mod(a); if (!(m > 0.002)) continue } if (o.wf) ww = Math.max(0.35, o.wf(a)) }
        const d = Math.sqrt(d2) - r
        if (o.outer && d < 0) continue
        if (o.inner && d > 0) continue
        const g = Math.exp(-(d * d) / (2 * ww * ww)) * m
        if (g < 0.003) continue
        const i = y * W + x
        D.R[i] += cr * g; D.G[i] += cg * g; D.B[i] += cb * g
      }
    }
  }
  // 圆弧遮罩：a 在 [a0, a0 + span] 里时 0..1（两头 taper 渐细），s = 弧上的位置 0..1
  function arcPos(a, a0, span) { let d = a - a0; d -= TAU * Math.floor(d / TAU); return d <= span ? d / span : -1 }
  // 卢恩字形（单位格：x 横向 ±0.5，y 沿半径 −0.5 内 → +0.5 外），每个字是几笔直线
  const RUNES = [
    [[[0, -0.5], [0, 0.5]], [[0, 0.3], [0.32, 0.5]], [[0, 0.05], [0.32, 0.25]]],
    [[[-0.25, -0.5], [-0.25, 0.5]], [[-0.25, 0.5], [0.25, 0.2]], [[0.25, 0.2], [0.25, -0.5]]],
    [[[0, -0.5], [0, 0.5]], [[0, 0.25], [0.3, 0]], [[0.3, 0], [0, -0.25]]],
    [[[0, -0.5], [0, 0.5]], [[0, 0.4], [0.3, 0.15]], [[0, 0.1], [0.3, -0.15]]],
    [[[0, -0.5], [0, 0.5]], [[0, 0.5], [0.3, 0.25]], [[0.3, 0.25], [0, 0]], [[0, 0], [0.3, -0.5]]],
    [[[0.3, 0.4], [-0.2, 0]], [[-0.2, 0], [0.3, -0.4]]],
    [[[-0.3, 0.4], [0.3, -0.4]], [[0.3, 0.4], [-0.3, -0.4]]],
    [[[0, -0.5], [0, 0.5]], [[0, 0.1], [-0.3, 0.45]], [[0, 0.1], [0.3, 0.45]]],
    [[[0, 0.45], [0.28, 0.1]], [[0.28, 0.1], [-0.25, -0.45]], [[0, 0.45], [-0.28, 0.1]], [[-0.28, 0.1], [0.25, -0.45]]],
    [[[-0.3, 0.4], [-0.3, -0.4]], [[-0.3, -0.4], [0.3, 0.4]], [[0.3, 0.4], [0.3, -0.4]], [[0.3, -0.4], [-0.3, 0.4]]],
    [[[0, -0.5], [0, 0.5]], [[-0.3, 0.2], [0.3, -0.2]]],
    [[[-0.2, -0.5], [-0.2, 0.5]], [[0.2, -0.5], [0.2, 0.5]], [[-0.2, 0.15], [0.2, -0.15]]],
  ]
  // 一圈符文：cells 格、半径 rMid、格高 band；第 c 格画 RUNES[pick(c)]，旋转 rot；prog 0..1 只画前一部分（一次性画出来）
  function runeRing(D, cx, cy, rMid, band, cells, rot, w, k, col, pick, prog = 1, sy = 1) {
    const cell = TAU / cells
    for (let c = 0; c < cells; c++) {
      if (c / cells >= prog) break
      const g = RUNES[pick(c) % RUNES.length], a = rot + (c + 0.5) * cell
      const pop = clamp01((prog - c / cells) * cells * 0.8)
      const at = ([gx, gy]) => { const aa = a + gx * cell * 0.55, rr = rMid + gy * band * 0.62; return [cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr * sy] }
      for (const [p0, p1] of g) { const [x0, y0] = at(p0), [x1, y1] = at(p1); streak(D, x0, y0, x1, y1, w, w, k * pop, k * pop, col, col) }
    }
  }
  function sdAt(geo, x, y) { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= geo.W || yi >= geo.H ? 1e4 : geo.sd[yi * geo.W + xi] }
  // 维诺分块（碎裂类用）：形状里撒 m 个点，每个内部像素归最近的点；edge = 和邻居不同块的像素
  function voronoiCells(geo, m, seed) {
    const rnd = rng(seed), seeds = [], W = geo.W
    for (let k = 0; k < m; k++) seeds.push(insidePoint(geo, rnd))
    const cell = new Int16Array(geo.inside.length), idOf = new Int16Array(geo.N).fill(-1)
    geo.inside.forEach((i, j) => {
      const x = i % W, y = (i - x) / W
      let best = 0, bd = Infinity
      for (let k = 0; k < m; k++) { const d = (seeds[k].x - x) ** 2 + (seeds[k].y - y) ** 2; if (d < bd) { bd = d; best = k } }
      cell[j] = best; idOf[i] = best
    })
    const edge = new Uint8Array(geo.inside.length)
    geo.inside.forEach((i, j) => { const c = idOf[i]; if (idOf[i - 1] !== c || idOf[i + 1] !== c || idOf[i - W] !== c || idOf[i + W] !== c) edge[j] = 1 })
    return { seeds, cell, edge, idOf, ...pieceIndex(geo, idOf) }
  }
  // 每像素归属 idOf → 每像素是不是块边 edgePix、每块的包围盒 boxes（逆映射画碎块用）
  function pieceIndex(geo, idOf) {
    const W = geo.W, edgePix = new Uint8Array(geo.N), boxes = {}
    for (const i of geo.inside) {
      const c = idOf[i]
      if (c < 0) continue
      if (idOf[i - 1] !== c || idOf[i + 1] !== c || idOf[i - W] !== c || idOf[i + W] !== c) edgePix[i] = 1
      const x = i % W, y = (i - x) / W, b = boxes[c] || (boxes[c] = [x, y, x, y])
      if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y
    }
    return { edgePix, boxes }
  }
  /**
   * 碎块：每块按各自的位移 / 旋转（和翻转压扁）画过去。逆映射——每个目标像素回原图找它属于哪块、取哪个像素，
   * 旋转时不会漏出一道道斜线空洞（2026-10-15 正向搬像素时碎块上满是斜纹）。
   * cells = { idOf, edgePix, boxes }；tf[c] = { cx, cy, tx, ty, rot, sq?, ax?, ay?, k, edgeK, imgK? }
   */
  function drawPieces(D, geo, cells, tf, fill, edgeCol) {
    const W = geo.W, H = geo.H, idOf = cells.idOf, edgePix = cells.edgePix
    for (const key of Object.keys(tf)) {
      const f = tf[key], c = Number(key), b = cells.boxes[c]
      if (!f || !b || !(Math.max(f.k, f.edgeK || 0, f.imgK || 0) > 0.003)) continue
      const co = Math.cos(f.rot), si = Math.sin(f.rot), sq = f.sq == null ? 1 : (Math.abs(f.sq) < 0.08 ? 0.08 * Math.sign(f.sq || 1) : f.sq), ax = f.ax == null ? 1 : f.ax, ay = f.ay || 0
      const fwd = (x, y) => { let lx = x - f.cx, ly = y - f.cy; const al = lx * ax + ly * ay, pe = (-lx * ay + ly * ax) * sq; lx = al * ax - pe * ay; ly = al * ay + pe * ax; return [f.cx + lx * co - ly * si + f.tx, f.cy + lx * si + ly * co + f.ty] }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const [px, py] of [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]) { const [qx, qy] = fwd(px, py); x0 = Math.min(x0, qx); y0 = Math.min(y0, qy); x1 = Math.max(x1, qx); y1 = Math.max(y1, qy) }
      x0 = Math.max(0, Math.floor(x0 - 1)); y0 = Math.max(0, Math.floor(y0 - 1)); x1 = Math.min(W - 1, Math.ceil(x1 + 1)); y1 = Math.min(H - 1, Math.ceil(y1 + 1))
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const lx = x - f.cx - f.tx, ly = y - f.cy - f.ty, rx = lx * co + ly * si, ry = -lx * si + ly * co
        const al = rx * ax + ry * ay, pe = (-rx * ay + ry * ax) / sq
        const sx = Math.round(f.cx + al * ax - pe * ay), sy = Math.round(f.cy + al * ay + pe * ax)
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue
        const src = sy * W + sx
        if (idOf[src] !== c) continue
        const dst = y * W + x, edge = cells.edgeW ? cells.edgeW[src] : edgePix[src]
        if (edge > 0 && edge < 1) { addPixel(D, dst, f.k * (1 - edge), fill); addPixel(D, dst, f.edgeK * edge, edgeCol) }
        else addPixel(D, dst, edge ? f.edgeK : f.k, edge ? edgeCol : fill)
        if (f.imgK) putImg(D, geo, dst, src, f.imgK)
      }
    }
  }

  // ------------------------------------------------------------------ 参数

  const P = (key, label, min, max, step, def) => ({ key, label, min, max, step, def })
  const PP = {
    count: P('count', '数量', 0.2, 6, 0.05, 1), size: P('size', '大小', 0.3, 6, 0.05, 1), speed: P('speed', '速度', 0.3, 4, 0.05, 1),
    spread: P('spread', '扩散', 0.2, 5, 0.05, 1), trail: P('trail', '拖尾', 0, 5, 0.05, 1), glow: P('glow', '光晕', 0.3, 5, 0.05, 1),
    width: P('width', '粗细', 0.3, 6, 0.05, 1), reach: P('reach', '范围', 0.3, 5, 0.05, 1), laps: P('laps', '次数', 1, 6, 1, 1),
    bright: P('bright', '亮度', 0.3, 3, 0.05, 1),
  }
  const particleParams = (extra = {}) => ['count', 'size', 'speed', 'spread', 'trail', 'glow'].map((k) => ({ ...PP[k], ...(extra[k] || {}) }))

  // ------------------------------------------------------------------ 效果（第五轮：技能 / 法阵 / 扩散 / 爆炸 / 消失 / 破碎）

  const LIST = [
    {
      id: 'orb', label: '能量球', group: '技能', hint: '白亮的核心外面裹着翻涌的能量云，几道月牙光弧绕着转', palette: 'cyan', lifecycle: 'loop',
      params: [P('reach', '大小', 0.3, 1.5, 0.05, 1), P('count', '光弧', 0, 5, 1, 3), P('laps', '转速', 1, 4, 1, 1), P('width', '云雾', 0.3, 3, 0.05, 1), PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { W, cx, cy } = geo
        const R = fitR(geo, Math.max(geo.Rb, geo.R) * 1.25 * p.reach, 1.06), laps = Math.round(p.laps), dir = ctx.project.direction === 'cw' ? -1 : 1
        const rot = dir * TAU * t, ca = Math.cos(rot), sa = Math.sin(rot), sc = 1 / (0.2 * R)
        const [x0, x1, y0, y1] = boxOf(geo, cx, cy, R)
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy)
          if (r > R) continue
          const qx = (dx * ca + dy * sa) * sc, qy = (-dx * sa + dy * ca) * sc
          const n = wfbm(qx + t * 1.5, qy, 71, 4, 1.6) * (1 - t) + wfbm(qx + (t - 1) * 1.5, qy, 71, 4, 1.6) * t
          const fall = Math.exp(-Math.pow(r / (0.48 * R), 2.4))
          const cloud = Math.pow(smooth(0.3, 0.8, n), 1.3) * fall * 1.9 * p.width
          const core = Math.exp(-((r / (0.075 * R)) ** 2)) * 3.4 + Math.exp(-((r / (0.2 * R)) ** 2)) * 1.1
          const e = (cloud + Math.exp(-((r / (0.72 * R)) ** 2)) * 0.22) * (1 - smooth(0.78 * R, R, r)) + core
          addPixel(D, y * W + x, e * p.bright, ramp(pal, clamp01(0.3 + 0.5 * cloud + 0.35 * core), C))
        }
        for (let k = 0; k < Math.round(p.count); k++) {
          const rk = R * (0.6 + 0.135 * k), span = 2.5 - 0.35 * k, spin = (k % 2 ? -1 : 1) * (1 + Math.floor(k / 2)), a0 = k * 2.1 + dir * spin * TAU * t * laps
          const mod = (a) => { const s = arcPos(a, a0, span); return s < 0 ? 0 : Math.pow(Math.sin(Math.PI * s), 0.55) }
          const wf = (a) => { const s = arcPos(a, a0, span); return s < 0 ? 0.5 : R * (0.004 + 0.03 * Math.pow(Math.sin(Math.PI * s), 1.1)) }
          ringPx(D, cx, cy, rk, 1, 1.3 * p.bright, ramp(pal, 0.85, [0, 0, 0]), { mod, wf, wMax: R * 0.034 })
          ringPx(D, cx, cy, rk, R * 0.05, 0.15 * p.bright, ramp(pal, 0.5, [0, 0, 0]), { mod })
        }
      },
      ai: (w) => ['blob', `energy orb on a ${w.noun}, a blinding white core wrapped in a churning cloud of energy, with glowing crescent arcs sweeping around it`],
    },
    {
      id: 'swirl', label: '漩涡', group: '技能', hint: '无数细丝螺旋卷向中心，整体旋转，中间一个暗眼', palette: 'white', lifecycle: 'loop',
      params: [P('reach', '大小', 0.3, 1.5, 0.05, 1), P('count', '丝密度', 0.3, 3, 0.05, 1), P('laps', '转速', 1, 4, 1, 1), P('width', '卷曲', 0.3, 3, 0.05, 1), PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { W, cx, cy } = geo
        const R = fitR(geo, Math.max(geo.Rb, geo.R) * 1.3 * p.reach, 1.0), dir = ctx.project.direction === 'cw' ? -1 : 1
        const kk = 0.42 * p.width, PER = Math.max(8, Math.round(40 * p.count)), rot = dir * TAU * t * Math.round(p.laps)
        const [x0, x1, y0, y1] = boxOf(geo, cx, cy, R)
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy)
          if (r > R || r < 0.05 * R) continue
          const th = Math.atan2(dy, dx), phi = dir * th - Math.log(r / R) / kk
          // 沿螺旋拉长的噪声：x 绕一圈正好 PER 格（周期噪声，转整圈首尾相接）
          const n = fbm(((phi - dir * rot) / TAU) * PER, Math.log(r / R) * 1.3, 91, 4, PER)
          const strands = Math.pow(smooth(0.42, 0.9, n), 1.6)
          const env = smooth(0.06 * R, 0.2 * R, r) * Math.exp(-(((r - 0.42 * R) / (0.42 * R)) ** 2)) * (1 - smooth(0.72 * R, R, r))
          const side = 0.68 + 0.32 * Math.cos(th - rot)
          const e = env * (0.1 + 1.7 * strands) * side
          if (e > 0.003) addPixel(D, y * W + x, e * p.bright, ramp(pal, 0.35 + 0.6 * strands * env, C))
        }
        ringPx(D, cx, cy, R * 0.075, R * 0.008, 0.5 * p.bright, ramp(pal, 0.8, C))
      },
      ai: (w) => ['swirl', `swirling vortex on a ${w.noun}, countless fine strands of light spiralling into a dark eye at the centre and turning steadily`],
    },
    {
      id: 'slash', label: '斩击', group: '技能', hint: '一道月牙刀光扫过，外沿雪亮、内侧渐隐，余光散成火花', palette: 'cyan', lifecycle: 'once', ownEnvelope: true,
      params: [P('reach', '大小', 0.3, 1.5, 0.05, 1), P('width', '刀宽', 0.3, 3, 0.05, 1), PP.speed, P('count', '火花', 0, 4, 0.05, 1), PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { W, u, cx, cy } = geo
        const q = ctx.loop ? frac(t) : t, R = fitR(geo, Math.max(geo.Rb, geo.R) * 1.2 * p.reach, 1.06), Ra = R * 0.9
        const dir = ctx.project.direction === 'cw' ? -1 : 1, sweep = 2.9, a0 = dir > 0 ? -2.55 : -0.59
        const sp = Math.min(2.5, p.speed), hq = clamp01((q - 0.03) * sp / 0.2), he = 1 - Math.pow(1 - hq, 2.4)
        const head = a0 + dir * sweep * he, trail = Math.min(sweep * he, 2.6)
        const fade = 1 - smooth(0.3, 0.8, q * sp), thin = 1 - 0.5 * smooth(0.25, 0.7, q * sp), T0 = R * 0.24 * p.width
        const hot = ramp(pal, 1, [0, 0, 0])
        if (fade > 0.003 && trail > 0.01) {
          const [x0, x1, y0, y1] = boxOf(geo, cx, cy, Ra + 6 * u)
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy), dr = r - Ra
            if (dr > 6 * u || dr < -T0 * 4) continue
            let d = dir * (head - Math.atan2(dy, dx)); d -= TAU * Math.floor(d / TAU)
            if (d > trail) continue
            const s = d / trail, thick = T0 * thin * Math.pow(1 - s, 0.75) * smooth(0, 0.05, s + 0.02) + 0.5
            const edge = Math.exp(-((dr / (0.7 * u + 0.004 * R)) ** 2)) * Math.pow(1 - s, 0.5)
            // 实心月牙：内侧有一条弧形边界，刀身从里往外越来越亮
            const body = dr < 0 ? smooth(-thick - 3 * u, -thick * 0.55, dr) * (0.3 + 0.7 * Math.pow(1 + dr / thick, 1.5)) * Math.pow(1 - s, 0.8) : 0
            const e = (edge * 2.4 + body * 2.0) * fade
            if (e > 0.003) addPixel(D, y * W + x, e * p.bright, ramp(pal, 0.5 + 0.5 * clamp01(edge + body * 0.3), C))
          }
          const hx = cx + Math.cos(head) * Ra, hy = cy + Math.sin(head) * Ra
          dot(D, hx, hy, 0.045 * R, 1.5 * fade * (hq < 1 ? 1 : 0.5) * p.bright, hot)
        }
        const rnd = rng(707), m = Math.round(40 * p.count)
        for (let k = 0; k < m; k++) {
          const f = rnd(), qa = 0.03 + (1 - Math.pow(1 - f, 1 / 2.4)) * 0.2 / sp, v = (0.08 + rnd() * 0.17) * R, ang = a0 + dir * sweep * f, life = 0.35 + rnd() * 0.25
          const age = (q - qa) / life
          if (!(age > 0 && age < 1)) continue
          const px = cx + Math.cos(ang) * Ra, py = cy + Math.sin(ang) * Ra, tx = -Math.sin(ang) * dir, ty = Math.cos(ang) * dir
          const pos = (a) => { const e = 1 - Math.pow(1 - a, 2); return [px + (tx * 0.9 + Math.cos(ang) * 0.5) * v * e, py + (ty * 0.9 + Math.sin(ang) * 0.5) * v * e] }
          const [x1, y1] = pos(age), [xb, yb] = pos(Math.max(0, age - 0.12))
          streak(D, xb, yb, x1, y1, 0.3 * u, 1.1 * u, 0, (1 - age) * 1.4 * p.bright, ramp(pal, 0.5, C), ramp(pal, 0.95, C2))
        }
      },
      ai: (w) => ['arc', `crescent slash across a ${w.noun}, one sweeping blade of light with a razor-bright outer edge fading on the inside, shedding sparks`],
    },
    {
      id: 'charge', label: '蓄力', group: '技能', particle: true, hint: '光流从四周旋着吸进中心，亮核一鼓一鼓越来越亮', palette: 'violet', lifecycle: 'loop',
      params: particleParams({ spread: { label: '范围' } }),
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { W, u, cx, cy } = geo
        const R = fitR(geo, Math.max(geo.Rb, geo.R) * 1.35 * p.spread, 1.0), dir = ctx.project.direction === 'cw' ? -1 : 1
        eachParticle(ctx, cnt(ctx, 140), { slot: 0.9 / p.speed, salt: 333, minLife: 0.55 }, (rnd, a) => {
          const a0 = rnd() * TAU, r0 = R * (0.55 + rnd() * 0.45), tw = dir * (0.6 + rnd() * 0.9)
          const pos = (x) => { const r = r0 * Math.pow(1 - x, 1.6) + 0.04 * R, an = a0 + tw * x * x; return [cx + Math.cos(an) * r, cy + Math.sin(an) * r] }
          const [x1, y1] = pos(a), [xb, yb] = pos(Math.max(0, a - 0.1 * (0.3 + p.trail)))
          const k = smooth(0, 0.25, a) * (0.35 + 1.3 * a) * 1.2
          streak(D, xb, yb, x1, y1, 0.3 * u, (0.6 + 1.2 * a) * u * p.size, 0, k, ramp(pal, 0.3, C), ramp(pal, 0.5 + 0.5 * a, C2))
        })
        const pulse = 0.7 + 0.3 * Math.pow(0.5 + 0.5 * Math.sin(TAU * t * 3), 2), rot = dir * TAU * t, ca = Math.cos(rot), sa = Math.sin(rot)
        const [x0, x1, y0, y1] = boxOf(geo, cx, cy, R * 0.4)
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy)
          if (r > R * 0.4) continue
          const n = wfbm((dx * ca + dy * sa) / (0.1 * R), (-dx * sa + dy * ca) / (0.1 * R), 77, 3, 1.2)
          const e = smooth(0.42, 0.85, n) * Math.exp(-((r / (0.2 * R)) ** 2)) * 1.1 * pulse
          if (e > 0.003) addPixel(D, y * W + x, e, ramp(pal, 0.6, C))
        }
        dot(D, cx, cy, 0.06 * R * (0.85 + 0.3 * pulse), 3 * pulse, ramp(pal, 1, C))
        dot(D, cx, cy, 0.18 * R, 0.8 * pulse, ramp(pal, 0.65, C))
        for (let j = 0; j < 2; j++) { const f = frac(t * 2 + j * 0.5); ringPx(D, cx, cy, R * (1 - f) * 0.95, 1.2 * u, smooth(0, 0.3, f) * Math.pow(1 - f, 0.5) * 0.6, ramp(pal, 0.7, C)) }
      },
      ai: (w) => ['converge', `charging energy at a ${w.noun}, streams of light spiralling inward into a bright pulsing core while rings of light contract toward it`],
    },
    {
      id: 'fireball', label: '火球', group: '技能', hint: '燃烧的火球：外扩 = 火舌从球面往四周窜；向上 = 火从底下往上烧，火舌高低不齐', palette: 'fire', lifecycle: 'loop',
      params: [P('reach', '大小', 0.3, 1.5, 0.05, 1),
        // 2026-10-15 用户：「火球是往外扩散，应该能调整燃烧方式」；后来：风向不需要、拖尾没用，中间的火星要能控制
        { key: 'burn', label: '燃烧', def: 'out', options: [{ id: 'out', label: '外扩' }, { id: 'up', label: '向上' }] },
        P('width', '火舌', 0.3, 3, 0.05, 1), P('count', '火星', 0, 3, 0.05, 1), P('laps', '翻滚', 1, 4, 1, 2), P('size', '纹理', 0.4, 3, 0.05, 1), PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { W, H, u } = geo, up = p.burn === 'up', F = 1.4 * Math.round(p.laps)
        // 球心：翻滚的明暗（不是一块平的亮饼）；直角坐标噪声往上翻（极坐标在球心会收成一个「米」字）
        const ball = (R0, cx, cy, x, y) => {
          const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy), body = smooth(R0, R0 * 0.55, r)
          if (body < 0.01) return { body: 0, core: 0, mott: 0 }
          const bsc = 1 / (0.17 * R0 * p.size), bo = (k) => fbm(dx * bsc + 7, dy * bsc + k * F * 0.45, 23, 3)
          return { body, core: 1 - smooth(0, R0 * 0.75, r), mott: smooth(0.25, 0.8, vblend(bo(t), bo(t - 1), t)) }
        }
        // 温度上色：只有火舌芯和球心最亮处发白，火舌大部分是橙、边上暗红
        const shade = (i, B, flame, T) => {
          const heat = clamp01(Math.max(B.body * (0.7 + 0.18 * B.mott + 0.12 * B.core), flame * (0.12 + 0.68 * Math.pow(T, 1.5))))
          const e = B.body * (0.95 + 0.45 * B.mott + 0.5 * B.core) + flame * (1 - B.body) * (0.22 + 1.25 * T * T)
          if (e > 0.003) addPixel(D, i, e * p.bright, ramp(pal, heat, C))
        }
        let R0, cx, cy, emit
        if (!up) {
          // 外扩：火舌 = 噪声 − 离球面的高度 → 一条条尖火苗；极坐标噪声绕一圈 PER 格（周期），沿半径往外流，上面的火舌长一点
          R0 = fitR(geo, Math.max(geo.Rb, geo.R) * 0.68 * p.reach, 2.25 * (0.85 + 1.815 * p.width) / 2.665); cx = geo.cx; cy = geo.cy
          const L = R0 * 1.1 * p.width, PER = 18, reachMax = R0 * 0.85 + L * 1.65, [x0, x1, y0, y1] = boxOf(geo, cx, cy, reachMax)
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy)
            if (r > reachMax) continue
            const th = Math.atan2(dy, dx), upk = Math.max(0, -dy / (r + 1e-3)), len = L * (1 + 0.7 * upk), rad = (r - R0 * 0.7) / len
            const xa = (th / TAU) * PER + (r / R0) * 0.22, ry = rad * 1.9 / p.size
            const fl = (k) => { const w2 = fbm(xa * 0.5, ry * 0.55 - k * F * 0.5 + 3.3, 17, 2, PER / 2); return fbm(xa + 1.6 * (w2 - 0.5), ry - k * F, 19, 4, PER) }
            const f = vblend(fl(t), fl(t - 1), t) + 0.62 - Math.max(0, rad) * 0.62
            shade(y * W + x, ball(R0, cx, cy, x, y), smooth(0.42, 0.62, f) * (1 - smooth(reachMax * 0.72, reachMax, r)), clamp01((f - 0.42) * 1.6))
          }
          emit = (rnd) => { const an = -Math.PI / 2 + (rnd() - 0.5) * 2.2, r0 = R0 * (0.7 + rnd() * 0.3); return [cx + Math.cos(an) * r0, cy + Math.sin(an) * r0, (0.6 + rnd() * 0.9) * L] }
        } else {
          // 向上：火从底下往上烧（2026-10-15 用户：向上时下面不该还往外冒；上面太均匀，像是拉长的）。
          // 外形下圆上尖、越高越左右摆；火舌 = 往上流的噪声 − 高度，高的火舌窜得高、矮的半路断开，顶上是一簇簇高低不齐的尖
          R0 = fitR(geo, Math.max(geo.Rb, geo.R) * 0.6 * p.reach, Math.max(1.75, (1.15 + 2.6 * p.width) / 2 * 1.08))
          const Hf = R0 * 2.6 * p.width, base = R0 * 0.95, total = base + R0 * 0.2 + Hf
          cx = geo.cx; cy = geo.cy + (total / 2 - base)   // 整团火（球 + 上面的火）放在框中间
          const sx = 1 / (0.36 * R0 * p.size), sy = 1 / (0.95 * R0 * p.size), bottom = cy + base
          const x0 = Math.max(0, Math.floor(cx - R0 * 1.7)), x1 = Math.min(W - 1, Math.ceil(cx + R0 * 1.7)), y0 = Math.max(0, Math.floor(bottom - total)), y1 = Math.min(H - 1, Math.ceil(bottom))
          for (let y = y0; y <= y1; y++) {
            const hgt = (bottom - y) / total
            const sw = (k) => fbm(hgt * 1.7 + 5, k * F * 0.35 + 2, 81, 2), sway = R0 * 0.55 * hgt * hgt * (vblend(sw(t), sw(t - 1), t) - 0.5)
            // 半宽：球心以下贴着球的圆，以上往尖收
            const below = y > cy, halfW = below ? Math.sqrt(Math.max(0, base * base - (y - cy) ** 2)) * 1.08 + 1 : R0 * 1.1 * Math.pow(Math.max(0, 1 - (cy - y) / (total - base)), 0.6) + 1
            for (let x = x0; x <= x1; x++) {
              const dx = x - cx, ax = (dx - sway) / halfW
              if (Math.abs(ax) > 1.6) continue
              const env = smooth(1.05, 0.3, Math.abs(ax))
              const nA = (k) => { const w2 = fbm(dx * sx * 0.5 + 3, y * sy * 0.5 + k * F * 0.5, 82, 2); return fbm(dx * sx + 1.5 * (w2 - 0.5), y * sy + k * F, 83, 4) }
              const n = vblend(nA(t), nA(t - 1), t), f = n * 0.9 + env * 0.88 - hgt * 0.98 - 0.04
              shade(y * W + x, ball(R0 * 0.85, cx, cy, x, y), smooth(0.3, 0.5, f) * smooth(-0.02, 0.06, hgt), clamp01((f - 0.28) * 1.5))
            }
          }
          emit = (rnd) => [cx + (rnd() - 0.5) * 1.4 * R0, cy - R0 * (0.2 + rnd() * 0.5), (0.5 + rnd() * 0.8) * Hf]
        }
        // 火星：从火里往上飘，数量可调（0 = 没有）
        eachParticle(ctx, Math.round(36 * p.count), { slot: 0.9, salt: 141, minLife: 0.6 }, (rnd, a) => {
          const [ex, ey, rise] = emit(rnd), wob = Math.sin(a * 7 + rnd() * 6) * 6 * u
          dot(D, ex + wob, ey - rise * a, (0.8 + rnd() * 1.2) * u, Math.sin(Math.PI * a) * (1 - a) * 2.2 * p.bright, ramp(pal, 0.9 - 0.5 * a, C))
        })
      },
      ai: (w) => ['blob', w.params && w.params.burn === 'up' ? `burning ball of fire on a ${w.noun}, a white-hot ball at the bottom with flames rising from it like a bonfire, tongues of uneven height flickering and darkening into smoke at their tips, with embers rising`
        : `blazing fireball on a ${w.noun}, a white-hot ball with curling tongues of flame licking outward from its surface, longer on top, darkening into smoke at their tips, with embers rising`],
    },
    {
      id: 'runeA', label: '符文法阵', group: '法阵', hint: '经典圆形法阵：双圈、卢恩符文环、星芒连线，内外反向转，一道光沿外圈流转（一次性时一笔笔画出来）', palette: 'gold', lifecycle: 'loop',
      params: [P('reach', '大小', 0.4, 1.5, 0.05, 1), P('count', '星角', 5, 8, 1, 6), P('laps', '转速', 1, 4, 1, 1), PP.width, PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { u, cx, cy } = geo
        const R = fitR(geo, Math.max(geo.Rb, geo.R) * 1.35 * p.reach, 1.02), n = Math.round(p.count), laps = Math.round(p.laps), w = 0.75 * u * p.width
        const once = !ctx.loop, prog = once ? smooth(0, 0.45, t) : 1
        const flash = once ? Math.exp(-Math.max(0, t - 0.47) / 0.1) * smooth(0.42, 0.47, t) : 0
        const br = (0.9 + 0.12 * Math.sin(TAU * t * laps * 2) + 1.4 * flash) * p.bright
        const line = ramp(pal, 0.78, [0, 0, 0]), hot = ramp(pal, 1, [0, 0, 0]), dir = ctx.project.direction === 'cw' ? -1 : 1
        const rot1 = dir * (TAU / 4) * t * laps, rot2 = -dir * (TAU / n) * t * laps
        const drawn = (a) => { if (prog >= 1) return 1; let d = a + Math.PI / 2; d -= TAU * Math.floor(d / TAU); return d <= prog * TAU ? 1 : 0 }
        ringPx(D, cx, cy, R, w * 1.6, br, line, { mod: drawn })
        ringPx(D, cx, cy, R * 0.955, w, br * 0.8, line, { mod: drawn })
        runeRing(D, cx, cy, R * 0.905, R * 0.07, 24, rot1, w, br * 0.95, line, (c) => [0, 3, 7, 4, 9, 2][c % 6], prog)
        ringPx(D, cx, cy, R * 0.85, w, br * 0.75, line, { mod: drawn })
        const ah = -Math.PI / 2 + dir * TAU * t * laps
        ringPx(D, cx, cy, R, w * 2.4, 1.4 * br * (once ? smooth(0.45, 0.6, t) : 1), hot, { mod: (a) => { let d = dir * (ah - a); d -= TAU * Math.floor(d / TAU); return d < 1.2 ? Math.pow(1 - d / 1.2, 2) : 0 } })
        const sr = R * 0.84, pts = [], step = n <= 6 ? 2 : 3
        for (let k = 0; k < n; k++) { const a = rot2 + (k / n) * TAU - Math.PI / 2; pts.push([cx + Math.cos(a) * sr, cy + Math.sin(a) * sr]) }
        for (let k = 0; k < n; k++) {
          const a = pts[k], b = pts[(k + step) % n], f = clamp01(prog * 1.6 - 0.5 - (k / n) * 0.3)
          if (f > 0) streak(D, a[0], a[1], a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, w, w, br * 0.9, br * 0.9, line, line)
          if (prog > 0.5) ringPx(D, a[0], a[1], R * 0.045, w, br * 0.8 * clamp01((prog - 0.5) * 4), line)
        }
        ringPx(D, cx, cy, R * 0.46, w, br * 0.7, line, { mod: drawn })
        ringPx(D, cx, cy, R * 0.4, w * 0.8, br * 0.55, line, { mod: (a) => drawn(a) * (Math.abs(frac(((a - rot1 * 2) / TAU) * 36) - 0.5) < 0.18 ? 1 : 0.15) })
        ringPx(D, cx, cy, R * 0.13, w, br * 0.8, line, { mod: drawn })
        dot(D, cx, cy, R * 0.05, (0.6 + 2.5 * flash) * p.bright, hot)
        dot(D, cx, cy, R * 0.6, (0.1 + 0.5 * flash) * p.bright, ramp(pal, 0.5, C))
      },
      ai: (w) => ['ring', `circular magic array around a ${w.noun}, double rings of golden light with a band of rune glyphs and a glowing star polygon inside, rotating in opposite directions`],
    },
    {
      id: 'runeB', label: '星环法阵', group: '法阵', hint: '几层分段圆弧、点环、刻度带和五芒星各自转，中间涟漪荡开（科幻感）', palette: 'cyan', lifecycle: 'loop',
      params: [P('reach', '大小', 0.4, 1.5, 0.05, 1), P('count', '层数', 2, 5, 1, 5), P('laps', '转速', 1, 4, 1, 1), PP.width, PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { u, cx, cy } = geo
        const R = fitR(geo, Math.max(geo.Rb, geo.R) * 1.35 * p.reach, 1.06), L = Math.round(p.count), laps = Math.round(p.laps), w = 0.8 * u * p.width
        const dir = ctx.project.direction === 'cw' ? -1 : 1, br = p.bright * (0.95 + 0.08 * Math.sin(TAU * t * laps * 2))
        const line = ramp(pal, 0.78, [0, 0, 0]), hot = ramp(pal, 1, [0, 0, 0])
        const rA = (dir * TAU * t * laps) / 3
        const seg = (off) => (a) => { const s = frac((a - rA - off) / (TAU / 3)); return s < 0.72 ? smooth(0, 0.03, s) * (1 - smooth(0.69, 0.72, s)) : 0 }
        ringPx(D, cx, cy, R, w * 1.5, br, line, { mod: seg(0) })
        ringPx(D, cx, cy, R * 1.035, w * 0.7, br * 0.5, line, { mod: seg(0.6) })
        if (L >= 2) { const rB = (-dir * TAU * t * laps * 4) / 72; for (let k = 0; k < 72; k++) { const a = rB + (k / 72) * TAU; dot(D, cx + Math.cos(a) * R * 0.91, cy + Math.sin(a) * R * 0.91, 0.9 * u * p.width, br * (k % 6 === 0 ? 1.3 : 0.55), line) } }
        if (L >= 3) {
          const rC = (dir * TAU * t * laps) / 12
          ringPx(D, cx, cy, R * 0.84, w, br * 0.6, line); ringPx(D, cx, cy, R * 0.78, w, br * 0.45, line)
          for (let k = 0; k < 72; k++) { const a = rC + (k / 72) * TAU, long = k % 6 === 0, r1 = long ? 0.865 : 0.82; streak(D, cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78, cx + Math.cos(a) * R * r1, cy + Math.sin(a) * R * r1, w * 0.8, w * 0.8, br * (long ? 1 : 0.5), br * (long ? 1 : 0.5), line, line) }
        }
        if (L >= 4) {
          const rD = (-dir * TAU * t * laps) / 5, sr = R * 0.66, pts = []
          ringPx(D, cx, cy, sr, w, br * 0.7, line)
          for (let k = 0; k < 5; k++) { const a = rD + (k / 5) * TAU - Math.PI / 2; pts.push([cx + Math.cos(a) * sr, cy + Math.sin(a) * sr]) }
          for (let k = 0; k < 5; k++) { const a = pts[k], b = pts[(k + 2) % 5]; streak(D, a[0], a[1], b[0], b[1], w, w, br * 0.85, br * 0.85, line, line); dot(D, a[0], a[1], 2 * u * p.width, br * 1.2, hot) }
        }
        if (L >= 5) for (let j = 0; j < 3; j++) { const f = frac(t * laps + j / 3); ringPx(D, cx, cy, R * (0.08 + f * 0.45), w, br * 0.7 * Math.sin(Math.PI * f), line) }
        for (let k = 0; k < 4; k++) { const a = (k * TAU) / 4 - Math.PI / 2, tx = cx + Math.cos(a) * R * 1.0, ty = cy + Math.sin(a) * R * 1.0, nx = -Math.cos(a), ny = -Math.sin(a), s = 0.035 * R; poly(D, [[tx + nx * s * 1.4, ty + ny * s * 1.4], [tx - ny * s * 0.7, ty + nx * s * 0.7], [tx + ny * s * 0.7, ty - nx * s * 0.7]], br * 0.9, hot) }
        dot(D, cx, cy, R * 0.04, br * 1.6, hot)
        dot(D, cx, cy, R * 0.5, 0.1 * br, ramp(pal, 0.5, C))
      },
      ai: (w) => ['ring', `sci-fi magic circle around a ${w.noun}, layered rings of segmented arcs, dotted rings, tick marks and a pentagram rotating at different speeds, with ripples spreading from the centre`],
    },
    {
      id: 'runeC', label: '法阵展开', group: '法阵', hint: '地面上的法阵一笔笔画出来，注满能量后一闪、升起光柱，再散成光点', palette: 'violet', lifecycle: 'once', ownEnvelope: true,
      params: [P('reach', '大小', 0.4, 1.5, 0.05, 1), P('count', '星角', 5, 8, 1, 5), P('beam', '光柱粗细', 0.2, 4, 0.05, 1), PP.speed, PP.width, PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { W, H, u, cx, bbox } = geo
        const q = ctx.loop ? frac(t) : t, qq = q * Math.min(2, p.speed), sy = 0.42, n = Math.round(p.count)
        const R = Math.min(fitR(geo, Math.max(geo.Rb, geo.R) * 1.45 * p.reach, 1.0), (H - geo.margin - bbox.y1 + 0.5 * (bbox.y1 - bbox.y0)) / sy)
        const gy = Math.min(bbox.y1 - 0.1 * (bbox.y1 - bbox.y0), H - geo.margin - R * sy)
        const w = 0.8 * u * p.width, line = ramp(pal, 0.78, [0, 0, 0]), hot = ramp(pal, 1, [0, 0, 0])
        const prog = smooth(0, 0.35, qq), fill = smooth(0.3, 0.45, qq), fl = Math.exp(-(((qq - 0.48) / 0.035) ** 2))
        const pil = smooth(0.45, 0.52, qq) * (1 - smooth(0.6, 0.85, qq)), fadeAll = 1 - smooth(0.65, 0.95, qq)
        const br = (0.9 + 1.6 * fl + 0.3 * fill) * fadeAll * p.bright
        const drawn = (a) => { if (prog >= 1) return 1; let d = a + Math.PI / 2; d -= TAU * Math.floor(d / TAU); return Math.min(d, TAU - d) <= prog * Math.PI ? 1 : 0 }
        if (br > 0.003) {
          ringPx(D, cx, gy, R, w * 1.5, br, line, { mod: drawn, sy })
          ringPx(D, cx, gy, R * 0.94, w, br * 0.7, line, { mod: drawn, sy })
          runeRing(D, cx, gy, R * 0.86, R * 0.09, 20, 0.6 * qq, w, br * 0.9, line, (c) => [1, 5, 8, 2, 10][c % 5], prog, sy)
          ringPx(D, cx, gy, R * 0.78, w, br * 0.7, line, { mod: drawn, sy })
          const pts = []
          for (let k = 0; k < n; k++) { const a = -0.6 * qq + (k / n) * TAU - Math.PI / 2; pts.push([cx + Math.cos(a) * R * 0.76, gy + Math.sin(a) * R * 0.76 * sy]) }
          const step = n <= 6 ? 2 : 3
          for (let k = 0; k < n; k++) { const a = pts[k], b = pts[(k + step) % n], f = clamp01(prog * 1.8 - 0.6 - (k / n) * 0.3); if (f > 0) streak(D, a[0], a[1], a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, w, w, br * 0.85, br * 0.85, line, line) }
          ringPx(D, cx, gy, R * 0.3, w, br * 0.7, line, { mod: drawn, sy })
          disc(D, cx, gy, R * 0.75, R * 0.75 * sy, 0, (0.18 * fill + 0.6 * fl) * fadeAll * p.bright, ramp(pal, 0.55, C), 0)
        }
        if (pil > 0.003) {
          // 光柱粗细（用户要能调）：软限制在画板左右的余地里，拉到最粗也不贴边
          const top = Math.max(geo.margin, gy - (gy - geo.margin)), bw = Math.max(1.5 * u, softFit(R * 0.36 * p.beam, Math.max(8 * u, Math.min(cx, W - cx) - geo.margin) / 1.2))
          const [x0, x1] = [Math.max(0, Math.floor(cx - bw * 2.5)), Math.min(W - 1, Math.ceil(cx + bw * 2.5))]
          for (let y = Math.max(0, Math.floor(top)); y <= Math.min(H - 1, Math.ceil(gy)); y++) {
            const v = clamp01((gy - y) / Math.max(1, gy - top)), fv = (1 - smooth(0.55, 1, v)) * smooth(0, 0.05, v)
            for (let x = x0; x <= x1; x++) { const dx = (x - cx) / bw, e = (Math.exp(-((dx / 0.25) ** 2)) * 1.6 + Math.exp(-((dx / 0.9) ** 2)) * 0.5) * fv * pil * p.bright; if (e > 0.003) addPixel(D, y * W + x, e, ramp(pal, 0.5 + 0.45 * Math.exp(-((dx / 0.3) ** 2)), C)) }
          }
        }
        const rnd = rng(919)
        for (let k = 0; k < 50; k++) {
          const a = rnd() * TAU, rr = R * (0.2 + rnd() * 0.75), born = 0.5 + rnd() * 0.25, age = (qq - born) / (0.35 + rnd() * 0.2)
          if (!(age > 0 && age < 1)) continue
          const x = cx + Math.cos(a) * rr, y = gy + Math.sin(a) * rr * sy - age * (gy - geo.margin) * 0.55
          dot(D, x, y, (1 + rnd() * 1.6) * u, Math.sin(Math.PI * age) * 1.4 * p.bright, ramp(pal, 0.9, C))
        }
      },
      ai: (w) => ['ring', `summoning circle unfolding under a ${w.noun}, a magic circle drawn on the ground stroke by stroke, filling with energy, flashing and raising a pillar of light before dissolving into motes`],
    },
    {
      id: 'aura', group: '技能', label: '灵气外溢', hint: '轮廓外一层流动的光雾向外飘，呼吸起伏', palette: 'violet', lifecycle: 'loop',
      params: [PP.reach, P('width', '浓度', 0.3, 4, 0.05, 1), P('laps', '流速', 1, 6, 1, 1), PP.size, PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { N, sd, u } = geo, T = outlineParam(geo)
        const Dw = (geo.R * 0.28 + 26 * u) * p.reach, per = Math.max(4, Math.round(geo.outer.reduce((a, c) => a + c.len, 0) / (16 * u * p.size)))
        const flow = Math.round(p.laps), sc = 1 / (58 * u * p.size), br = 0.8 + 0.2 * Math.sin(TAU * t)
        for (let i = 0; i < N; i++) {
          const s = sd[i]
          if (s < -10 * u) continue
          const Dm = fitHere(geo, i, s, Dw, 1.5)
          if (s > Dm * 1.5) continue
          const x = T[i] * per, y = Math.max(0, s) * sc
          const n0 = fbm(x, y - t * flow * 1.6, 5, 3, per), n1 = fbm(x, y - (t - 1) * flow * 1.6, 5, 3, per)
          const n = n0 * (1 - t) + n1 * t
          const wisp = smooth(0.45, 0.85, n) * p.width
          const fall = s > 0 ? Math.exp(-s / (Dm * 0.42)) : Math.exp(s / (4 * u))
          const rim = Math.exp(-((s / (1.6 * u)) ** 2)) * 0.9
          const e = (wisp * fall * 2.2 + fall * 0.1) * br + rim
          if (e > 0.003) addPixel(D, i, e * p.bright, ramp(pal, 0.3 + 0.55 * clamp01(wisp * fall * 1.4) + rim * 0.4, C))
        }
      },
      ai: (w) => ['frame', `glowing aura around a ${w.noun}, wisps of misty light flowing outward from its edge and fading, swelling gently. ${w.NOT}`],
    },
    {
      id: 'vortex', group: '技能', label: '能量漩涡', hint: '光流螺旋吸进中心，亮核一明一暗', palette: 'violet', lifecycle: 'loop',
      params: particleParams({ spread: { label: '范围' } }),
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { u, cx, cy } = geo
        const Rv = fitR(geo, Math.max(geo.R, geo.Rb) * 1.15 * p.spread, 1.2), dir = ctx.project.direction === 'cw' ? 1 : -1
        eachParticle(ctx, cnt(ctx, 150), { slot: 1.6 / p.speed, salt: 5, minLife: 0.75 }, (rnd, a) => {
          const th0 = rnd() * TAU, r0 = Rv * (0.55 + rnd() * 0.6)
          const pos = (x) => { const r = r0 * Math.pow(1 - x, 0.85) + 3 * u, th = th0 + dir * (1.2 + 3.2 * x * x) * Math.PI; return [cx + Math.cos(th) * r, cy + Math.sin(th) * r * 0.92] }
          const [x1, y1] = pos(a), [x0, y0] = pos(Math.max(0, a - 0.07 * (0.4 + p.trail)))
          const k = smooth(0, 0.15, a) * (1 - smooth(0.85, 1, a)) * (0.6 + 0.8 * a) * 1.3
          streak(D, x0, y0, x1, y1, 0.3 * u * p.size, (0.7 + 0.9 * a) * u * p.size, 0, k, ramp(pal, 0.3, [0, 0, 0]), ramp(pal, 0.45 + 0.5 * a, C2))
        })
        const pulse = 0.75 + 0.25 * Math.sin(TAU * t * 2)
        dot(D, cx, cy, 9 * u * p.size, 1.6 * pulse, ramp(pal, 1, C))
        dot(D, cx, cy, 26 * u * p.size, 0.45 * pulse, ramp(pal, 0.6, C))
      },
      ai: () => ['converge', 'energy vortex, streams of light spiralling inward into a bright pulsing core at the centre, turning steadily in one direction'],
    },
    {
      id: 'godrays', group: '技能', label: '圣光放射', hint: '从形状放出长短不一的细光束，闪烁、轻摆', palette: 'gold', lifecycle: 'loop',
      params: [P('count', '条数', 6, 48, 1, 18), PP.width, P('reach', '长度', 0.3, 5, 0.05, 1), P('laps', '闪烁', 1, 6, 1, 2), PP.glow, PP.bright],
      prepare(ctx) {
        const rnd = rng(901), n = Math.round(ctx.params.count), rays = []
        for (let i = 0; i < n; i++) rays.push({ a: TAU * (i + (rnd() - 0.5) * 0.7) / n, w: 0.012 + rnd() * 0.02, len: 0.4 + rnd() * 0.9, b: 0.55 + rnd() * 0.7, k: 1 + Math.floor(rnd() * 3), ph: rnd() })
        return { rays }
      },
      render(ctx, t, D) {
        const { geo, params: p, pal, state } = ctx, { W, H, sd, cov, u, cx, cy } = geo
        const L = (geo.R * 0.6 + 50 * u) * p.reach, wk = p.width, laps = Math.round(p.laps), sway = 0.05 * Math.sin(TAU * t)
        const rays = state.rays.map((r) => ({ ...r, a: r.a + sway, f: 0.55 + 0.45 * Math.sin(TAU * (t * r.k * laps + r.ph)), l: r.len * L, w: r.w * wk }))
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x, s = sd[i]
          let e = cov[i] * 0.04
          if (s > -3 * u) {
            const th = Math.atan2(y - cy, x - cx), base = smooth(-3 * u, 8 * u, s), sp = Math.max(0, s), k = fitHere(geo, i, s, L, 1.9) / L
            for (const r of rays) {
              let d = th - r.a; d -= TAU * Math.round(d / TAU)
              const l = r.l * k, wd = r.w * (1 + sp / (l * 0.6))
              if (Math.abs(d) > wd * 3) continue
              e += Math.exp(-((d / wd) ** 2)) * Math.exp(-Math.pow(sp / l, 1.3)) * r.b * r.f * base * 1.5
            }
            e += Math.exp(-sp / (16 * u)) * 0.45 * base
          }
          if (e > 0.003) addPixel(D, i, e * p.bright, ramp(pal, 0.35 + 0.5 * clamp01(e), C))
        }
      },
      ai: (w) => ['rays', `holy light rays, many thin bright beams of different lengths radiating outward from a ${w.noun}, shimmering and swaying slightly. The rays are straight and thin, NOT a shockwave`],
    },
    {
      id: 'magic', group: '法阵', label: '法阵旋转', hint: '沿轮廓几圈虚线 / 刻度反向旋转，像法阵', palette: 'cyan', lifecycle: 'loop',
      params: [P('count', '层数', 1, 4, 1, 3), PP.width, P('reach', '间距', 0.3, 4, 0.05, 1), P('laps', '转速', 1, 6, 1, 1), PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { N, sd, cov, u } = geo, T = outlineParam(geo)
        const total = geo.outer.reduce((a, c) => a + c.len, 0) || 1, wk = p.width, layers = Math.round(p.count), laps = Math.round(p.laps)
        // 最外一层 + 菱形不出画板
        const need = ((6 + 17 * (layers - 1)) * p.reach + 18) * u, fitK = (room) => p.reach * Math.min(1, Math.max(0.15, room / need))
        const L = []
        for (let j = 0; j < layers; j++) {
          const off = (6 + j * 17) * u
          const segs = Math.max(6, Math.round((total + TAU * off) / ((j === 1 ? 12 : 34) * u)))
          L.push({ off, segs, duty: j === 1 ? 0.18 : j === 2 ? 0.08 : 0.62, dir: j % 2 ? -1 : 1, tall: j === 1 ? 4.5 : 0 })
        }
        const pulse = 0.85 + 0.15 * Math.sin(TAU * t * laps)
        for (let i = 0; i < N; i++) {
          const s = sd[i]
          let e = cov[i] * 0.025 + Math.exp(-((s / (1.4 * u * wk)) ** 2)) * 0.9, h = 0.5
          const kf = fitK(roomAt(geo, i, s))
          for (const l of L) {
            const d = Math.abs(s - l.off * kf)
            const band = l.tall ? (d < l.tall * u ? 1 : Math.exp(-(((d - l.tall * u) / (1.1 * u * wk)) ** 2))) : Math.exp(-((d / (1.3 * u * wk)) ** 2))
            if (band < 0.01) continue
            const f = frac(T[i] * l.segs + l.dir * t * laps * (l.tall ? 1 : 2))
            const on = smooth(0, 0.03, f) * (1 - smooth(l.duty, l.duty + 0.03, f))
            e += band * (0.12 + on * 1.25) * pulse
            if (on > 0.5) h = 0.8
          }
          if (e > 0.003) addPixel(D, i, e * p.bright, ramp(pal, h, C))
        }
        // 四个菱形符点沿外圈转
        for (let k = 0; k < 4; k++) {
          const q = pointOn(geo, k / 4 + t * laps * 0.25), kf = fitK(edgeAt(geo, q.x, q.y))
          const outer = L.length ? (L[L.length - 1].off + 10 * u) * kf : 12 * u
          const x = q.x + q.nx * outer, y = q.y + q.ny * outer, s = 4 * u * wk
          poly(D, [[x, y - s], [x + s * 0.6, y], [x, y + s], [x - s * 0.6, y]], 1.3 * p.bright, ramp(pal, 0.9, C))
        }
      },
      ai: (w) => ['frame', `magic circle around a ${w.noun}, several thin rings of glowing dashes and tick marks rotating in opposite directions around it. ${w.NOT}`],
    },
    {
      id: 'pulse', group: '扩散', label: '能量脉冲', hint: '轮廓向外推出明暗起伏的光环，沿途掉火花', palette: 'cyan', lifecycle: 'loop',
      params: [P('count', '光环', 1, 6, 1, 2), PP.width, PP.reach, P('laps', '次数', 1, 6, 1, 1), PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { N, sd, u } = geo, T = outlineParam(geo)
        const Dw = (geo.R * 0.32 + 30 * u) * p.reach, wk = p.width, rings = Math.round(p.count), laps = Math.round(p.laps)
        const ph = [], cyc = []
        for (let j = 0; j < rings; j++) {
          if (ctx.loop) { const g = t * laps + j / rings; ph.push(frac(g)); cyc.push(Math.floor(g) % laps) }
          else { ph.push(t * 1.25 - j * 0.18); cyc.push(0) }
        }
        for (let i = 0; i < N; i++) {
          const s = sd[i]
          if (s < -8 * u) continue
          const Dm = fitHere(geo, i, s, Dw, 1.12)
          if (s > Dm + 30 * u) continue
          let e = Math.exp(-((s / (1.4 * u * wk)) ** 2)) * 0.32, hh = 0.55
          const tx = Math.cos(TAU * T[i]) * 2.2, ty = Math.sin(TAU * T[i]) * 2.2
          for (let j = 0; j < rings; j++) {
            const q = ph[j]
            if (!(q >= 0 && q < 1)) continue
            const r = (1 - Math.pow(1 - q, 1.6)) * Dm, d = s - r
            const front = d > 0 ? Math.exp(-((d / (1.1 * u * wk)) ** 2)) : Math.exp(-((d / (3.5 * u * wk * (1 + 1.2 * q))) ** 2))
            if (front < 0.003) continue
            const fade = Math.pow(1 - q, 1.6) * smooth(0, 0.05, q)
            const mod = 0.25 + 0.75 * smooth(0.3, 0.75, fbm(tx + 9 * j + 3 * cyc[j], ty + q * 1.6, 11, 3))
            const v = front * fade * mod * 1.7
            e += v; if (v > 0.2) hh = Math.max(hh, 0.45 + 0.55 * Math.min(1, v))
          }
          if (e > 0.002) addPixel(D, i, e * p.bright, ramp(pal, hh, C))
        }
        // 光环上掉下来的火花
        for (let j = 0; j < rings; j++) {
          const q = ph[j]
          if (!(q > 0.05 && q < 1)) continue
          const ease = 1 - Math.pow(1 - q, 1.6), rnd = rng(77 + j * 131 + cyc[j] * 17)
          for (let k = 0; k < 26; k++) {
            const o = pointOn(geo, rnd()), extra = rnd() * 22 * u * q, d = ease * Math.max(2 * u, softFit(Dw, Math.max(2 * u, edgeAt(geo, o.x, o.y) / 1.12))) + extra
            const tw = 0.5 + 0.5 * Math.sin(q * 30 + k)
            dot(D, o.x + o.nx * d, o.y + o.ny * d, (0.8 + rnd() * 1.2) * u * wk, 1.6 * (1 - q) * tw * p.bright, ramp(pal, 0.85, C2))
          }
        }
      },
      ai: (w) => ['ring', `${w.shapeNoun} energy pulse, bright rings of light pushed outward from a ${w.noun} one after another, flickering along their length and shedding sparks as they fade`],
    },
    {
      id: 'fireworks', group: '爆炸', label: '烟花绽放', hint: '几颗彩色烟花接连绽放，拖尾下垂、噼啪闪', palette: 'multi', lifecycle: 'once', params: particleParams(),
      render(ctx, t, D) {
        const { geo, params: p } = ctx, { u, bbox } = geo
        const shells = Math.max(1, Math.round(3 * p.count))
        const bw = Math.max(bbox.x1 - bbox.x0, geo.R * 2), bh = Math.max(bbox.y1 - bbox.y0, geo.R * 2)
        for (let s = 0; s < shells; s++) {
          const rnd = rng(1000 + s * 97)
          const born = ctx.loop ? s / shells : (s / shells) * 0.42 + rnd() * 0.04, life = ctx.loop ? Math.min(0.85, 2.4 / shells) : 0.55
          let a = ctx.loop ? frac(t - born) / life : (t - born) / life
          if (!(a > 0 && a < 1)) continue
          const pal = ctx.palOf(s), ox = geo.cx + (rnd() - 0.5) * bw * 0.9 * p.spread, oy = geo.cy - bh * 0.1 + (rnd() - 0.5) * bh * 0.7 * p.spread
          const R = softFit(Math.max(geo.R, geo.Rb * 0.7) * (0.55 + rnd() * 0.35) * p.speed, geo.Rfit * 0.45)
          // 整朵烟花（含下垂）留在画板里
          const lim = Math.max(0, geo.Rfit - R * 1.1)
          const fx0 = geo.cx + clamp(ox - geo.cx, -lim, lim), fy0 = geo.cy + clamp(oy - geo.cy, -lim, Math.max(-lim, lim - 40 * u))
          if (a < 0.1) dot(D, fx0, fy0, 7 * u * p.size, 2.4 * (1 - a / 0.1), ramp(pal, 1, C))
          const sparks = 64
          for (let k = 0; k < sparks; k++) {
            const r2 = rng(5000 + s * 977 + k * 13), th = (k / sparks) * TAU + r2() * 0.12, v = R * (0.82 + r2() * 0.3)
            const pos = (x) => { const e = 1 - Math.pow(1 - x, 2.4); return [fx0 + Math.cos(th) * v * e, fy0 + Math.sin(th) * v * e + 40 * u * x * x] }
            const [x1, y1] = pos(a), [x0, y0] = pos(Math.max(0, a - 0.1 * (0.4 + p.trail)))
            const crackle = a > 0.6 ? (0.4 + 0.6 * (Math.sin(a * 60 + k * 2.7) > 0.3 ? 1 : 0.2)) : 1
            const k1 = (1 - smooth(0.55, 1, a)) * 1.5 * crackle
            streak(D, x0, y0, x1, y1, 0.35 * u, 1.4 * u * p.size, 0, k1 * 1.3, ramp(pal, 0.3, [0, 0, 0]), ramp(pal, 0.85 - 0.3 * a, C2))
          }
        }
      },
      ai: () => ['burst', 'fireworks, several colourful shells bursting one after another into round sprays of sparks with drooping trails that crackle and fade'],
    },
    {
      id: 'shatter', usesImage: true, group: '破碎', label: '碎裂迸散', hint: '形状亮起、裂开，碎片翻滚着飞散（循环时飞出去再拼回来）', palette: 'ice', lifecycle: 'once', params: particleParams({ count: { label: '碎块' }, trail: { def: 0 } }),
      prepare(ctx) {
        const geo = ctx.geo, rnd = rng(1301), m = Math.max(4, Math.round(22 * clamp(Number(ctx.params.count) || 1, 0.2, 6)))
        const cells = voronoiCells(geo, m, 1302)
        const motion = cells.seeds.map((s0) => { let dx = s0.x - geo.cx, dy = s0.y - geo.cy; const l = Math.hypot(dx, dy) || 1; return { x: s0.x, y: s0.y, dx: dx / l, dy: dy / l, v: 0.6 + rnd() * 0.8, w: (rnd() - 0.5) * 5, delay: rnd() * 0.05 } })
        return { cells, motion }
      },
      render(ctx, t, D) {
        const { geo, params: p, pal, state } = ctx, { u } = geo, q = ctx.loop ? frac(t) : t
        const flash = ctx.loop ? Math.max(1 - smooth(0.03, 0.16, t), smooth(0.86, 1, t)) * 0.8 : smooth(0, 0.05, q) * (1 - smooth(0.12, 0.28, q)), crack = ctx.loop ? 1 : smooth(0.06, 0.12, q)
        const Dm = fitOut(geo, Math.max(geo.R, geo.Rb) * 0.85 * p.spread * p.speed, 1.15)
        const fill = ramp(pal, 0.55, [0, 0, 0]), hot = ramp(pal, 1, [0, 0, 0]), img = !!D.IR
        const tf = state.motion.map((m) => {
          const a = ctx.loop ? (t < 0.55 ? clamp01((t - 0.12 - m.delay) / 0.4) : clamp01(1 - (t - 0.55) / 0.38)) : clamp01((q - 0.14 - m.delay) / 0.7), e = 1 - Math.pow(1 - a, 2.2)
          const fade = ctx.loop ? 1 - 0.6 * smooth(0.4, 1, a) : 1 - smooth(0.45, 1, a)
          return { tx: m.dx * Dm * m.v * e, ty: m.dy * Dm * m.v * e + 60 * u * a * a, rot: m.w * e, cx: m.x, cy: m.y, k: ((img ? 0.02 : 0.35) + flash * (img ? 0.4 : 1)) * fade * p.bright0, edgeK: ((img ? 0.02 : 0.35) + flash * (img ? 0.4 : 1) + crack * (img ? 0.45 : 1.8)) * fade * p.bright0, imgK: img ? fade : 0 }
        })
        drawPieces(D, geo, state.cells, tf, fill, hot)
      },
      ai: (w) => ['shatter', `${w.shapeNoun} shatter, one solid ${w.shapeNoun} shape that glows, cracks into angular shards and blasts apart, the shards tumbling outward and fading`],
    },
    {
      id: 'wave', label: '冲击波', group: '扩散', hint: '中心一闪，一道带纹理的冲击波荡开，尘粒被推着散出去', palette: 'ice', lifecycle: 'once', ownEnvelope: true,
      params: [P('reach', '范围', 0.3, 1, 0.05, 0.95), PP.width, P('count', '尘粒', 0, 4, 0.05, 1), PP.speed, PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { W, u, cx, cy } = geo
        const q = ctx.loop ? frac(t) : t, R = geo.Rfit * p.reach, s = Math.min(2.5, p.speed)
        const a = clamp01(q * s * 1.1), e1 = 1 - Math.pow(1 - a, 2.6), rr = e1 * R * 0.97, fade = Math.pow(1 - clamp01(q * 1.05), 1.4)
        dot(D, cx, cy, 0.18 * R, 2.6 * Math.exp(-q / 0.035) * p.bright, ramp(pal, 1, C))
        dot(D, cx, cy, 0.45 * R, 0.6 * Math.exp(-q / 0.06) * p.bright, ramp(pal, 0.6, C))
        if (fade > 0.003 && rr > 1) {
          const [x0, x1, y0, y1] = boxOf(geo, cx, cy, rr + 0.06 * R)
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy), d = r - rr
            if (d > 0.06 * R) continue
            const th = Math.atan2(dy, dx)
            const front = d > 0 ? Math.exp(-((d / (0.008 * R + 0.6 * u)) ** 2)) : Math.exp(d / (0.1 * R * p.width * (0.4 + e1)))
            const tex = 0.35 + 1.1 * fbm(Math.cos(th) * 5 + 2, Math.sin(th) * 5 + e1 * 3, 81, 3)
            const inner = d < 0 ? Math.exp(d / (0.35 * R)) * 0.12 : 0
            const e = (front * tex * (d > 0 ? 1.7 : 0.9) + inner) * fade
            if (e > 0.003) addPixel(D, y * W + x, e * p.bright, ramp(pal, 0.35 + 0.6 * (d > -0.02 * R ? front : 0), C))
          }
          ringPx(D, cx, cy, e1 * R * 0.78, 0.6 * u, 0.5 * fade * (1 - a) * p.bright, ramp(pal, 0.7, C))
        }
        const rnd = rng(77), m = Math.round(80 * p.count)
        for (let k = 0; k < m; k++) {
          const ang = rnd() * TAU, v = 0.55 + rnd() * 0.45, d = rr * v * (0.85 + 0.15 * rnd()), x = cx + Math.cos(ang) * d, y = cy + Math.sin(ang) * d
          const tl = 0.04 * R * (1 - a), xb = cx + Math.cos(ang) * Math.max(0, d - tl), yb = cy + Math.sin(ang) * Math.max(0, d - tl)
          streak(D, xb, yb, x, y, 0.3 * u, 1.1 * u, 0, 0.9 * fade * p.bright, ramp(pal, 0.4, C), ramp(pal, 0.85, C2))
        }
      },
      ai: () => ['ring', 'shockwave, a flash at the centre and one textured ring of force rolling outward with dust thrown along with it, then fading'],
    },
    {
      id: 'sparkspread', label: '光点扩散', group: '扩散', particle: true, hint: '一团柔和的光点向四周散开、减速、闪一闪熄灭', palette: 'gold', lifecycle: 'once', ownEnvelope: true,
      params: particleParams({ trail: { def: 0.3 } }),
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { u, cx, cy } = geo
        const R = fitR(geo, geo.Rfit * 0.9 * p.spread, 1.0), ease = (a) => (1 - Math.exp(-3.2 * a)) / (1 - Math.exp(-3.2))
        const draw = (rnd, a, i) => {
          const ang = rnd() * TAU, v = R * (0.35 + 0.65 * rnd()), sz = (2 + rnd() * 5) * u * p.size * (1 - 0.45 * a)
          const pos = (x) => [cx + Math.cos(ang) * v * ease(x), cy + Math.sin(ang) * v * ease(x)]
          const [x, y] = pos(a), tw = 0.55 + 0.45 * Math.sin(a * 24 + i), k = (1 - smooth(0.45, 1, a)) * 1.3 * tw * smooth(0, 0.04, a)
          if (p.trail > 0) { const [xb, yb] = pos(Math.max(0, a - 0.05 * p.trail)); streak(D, xb, yb, x, y, sz * 0.2, sz * 0.5, 0, 0.5 * k, ramp(pal, 0.4, C), ramp(pal, 0.8, C2)) }
          disc(D, x, y, sz, sz, 0, 0.3 * k, ramp(pal, 0.55, C), 0.9 * k, ramp(pal, 0.9, C2))
          dot(D, x, y, sz * 0.35, 0.7 * k, ramp(pal, 1, C))
        }
        if (ctx.loop) eachParticle(ctx, cnt(ctx, 90), { slot: 1.5 / p.speed, salt: 515, minLife: 0.7 }, draw)
        else {
          const n = cnt(ctx, 110)
          for (let i = 0; i < n; i++) { const rnd = rng(i * 977 + 3), born = rnd() * 0.12, life = (0.6 + rnd() * 0.35) / Math.min(2.5, p.speed), a = (t - born) / life; if (a > 0 && a < 1) draw(rnd, a, i) }
          dot(D, cx, cy, 0.2 * R, 1.6 * Math.exp(-t / 0.08), ramp(pal, 1, C))
        }
      },
      ai: () => ['burst', 'soft glowing motes spreading outward in every direction from a bright point, slowing down, twinkling and fading'],
    },
    {
      id: 'rburst', label: '放射爆发', group: '爆炸', hint: '光束从中心猛射向四周，中间留空，暖色由深到亮', palette: 'fire', lifecycle: 'loop',
      params: [P('count', '光束', 0.3, 3, 0.05, 1), P('reach', '大小', 0.3, 1.2, 0.05, 1), PP.speed, P('width', '粗细', 0.3, 3, 0.05, 1), PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { u, cx, cy } = geo
        const R = fitR(geo, Math.max(geo.Rb, geo.R) * 1.7 * p.reach, 1.0), N = Math.round(80 * p.count), k = Math.max(1, Math.round(p.speed))
        ringPx(D, cx, cy, R * 0.45, R * 0.22, 0.1 * p.bright, ramp(pal, 0.35, C))
        for (let layer = 0; layer < 2; layer++) {
          for (let i = 0; i < N; i++) {
            const rnd = rng(i * 331 + 9 + layer * 7777), ang = rnd() * TAU, L = R * (0.25 + rnd() * 0.45), b = (0.45 + rnd() * 0.8) * (layer ? 1 : 0.4), ph0 = rnd()
            const wmax = (2 + rnd() * 5.5) * u * p.width * (layer ? 1 : 2.4)
            const ph = ctx.loop ? frac(t * k + ph0) : clamp01((t - ph0 * 0.1) / 0.8)
            if (ph <= 0 || ph >= 1) continue
            const head = R * (0.16 + 0.84 * (1 - Math.pow(1 - ph, 2.2))), tail = Math.max(R * 0.13, head - L * (0.35 + 0.65 * Math.min(1, ph * 2.2)))
            const f = Math.pow(Math.sin(Math.PI * ph), 0.6) * b * p.bright, cs = Math.cos(ang), sn = Math.sin(ang)
            spindle(D, cx + cs * tail, cy + sn * tail, cx + cs * head, cy + sn * head, wmax, 1.25 * f, ramp(pal, 0.2, [0, 0, 0]), ramp(pal, layer ? 0.95 : 0.6, [0, 0, 0]), ramp(pal, 0.55, [0, 0, 0]), 0.62)
          }
        }
      },
      ai: () => ['burst', 'radial burst, many streaks of fiery light shooting outward from a hollow centre in every direction, deep red at their roots and bright yellow along their length'],
    },
    {
      id: 'firebomb', label: '火焰爆炸', group: '爆炸', hint: '一闪后火球猛地膨胀翻滚，外沿变暗成烟，火星飞溅', palette: 'fire', lifecycle: 'once', ownEnvelope: true,
      params: [P('reach', '范围', 0.3, 1, 0.05, 0.9), PP.width, P('count', '火星', 0, 4, 0.05, 1), PP.speed, PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { W, u, cx, cy } = geo
        const q = ctx.loop ? frac(t) : t, s = Math.min(2.5, p.speed), R = geo.Rfit * p.reach
        const a = clamp01(q * s * 1.15), e1 = 1 - Math.pow(1 - a, 3), rf = R * (0.08 + 0.72 * e1), endFade = 1 - smooth(0.45, 0.88, q)
        dot(D, cx, cy, 0.22 * R, 3.5 * Math.exp(-q * s / 0.035) * p.bright, ramp(pal, 1, C))
        const sc = 1 / (0.13 * R * (0.45 + 0.55 * e1))
        const [x0, x1, y0, y1] = boxOf(geo, cx, cy, rf * 1.4)
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) + 1e-3
          if (r > rf * 1.4) continue
          const n = wfbm(dx * sc - (dx / r) * a * 1.8, dy * sc - (dy / r) * a * 1.8, 41, 4, 1.5 * p.width), rn = r / rf
          const dens = smooth(1.25, 0.55, rn + (0.5 - n) * 0.5) * smooth(0.18 + 0.6 * a * a, 0.62 + 0.25 * a, n + 0.38 * (1 - rn))
          const heat = clamp01((1 - rn) * 1.1 + (n - 0.5) * 0.8 - a * 1.0 + 0.35)
          const e = dens * (0.35 + 1.8 * heat * heat) * endFade
          if (e > 0.003) addPixel(D, y * W + x, e * p.bright, ramp(pal, heat, C))
        }
        // 原来这里有一圈细的冲击波圆环——2026-10-15 用户：「外面一个硬光圈」，和翻滚的火球不搭，去掉
        const rnd = rng(313), m = Math.round(50 * p.count), Re = R * 0.85
        for (let k = 0; k < m; k++) {
          const ang = rnd() * TAU, v = Re * (0.45 + rnd() * 0.5), life = 0.45 + rnd() * 0.35, age = (q * s - 0.02) / life
          if (!(age > 0 && age < 1)) continue
          const pos = (x) => { const e = (1 - Math.exp(-3 * x)) / (1 - Math.exp(-3)); return [cx + Math.cos(ang) * v * e, cy + Math.sin(ang) * v * e + 0.12 * R * x * x] }
          const [xe, ye] = pos(age), [xb, yb] = pos(Math.max(0, age - 0.07)), heat = 1 - age * 0.8
          streak(D, xb, yb, xe, ye, 0.3 * u, 1.2 * u, 0, (1 - smooth(0.5, 1, age)) * 1.6 * p.bright, ramp(pal, heat * 0.5, C), ramp(pal, heat, C2))
        }
      },
      ai: () => ['burst', 'fiery explosion, a white flash then a churning ball of fire swelling outward, its edges darkening into smoke while embers fly out'],
    },
    {
      id: 'smokeout', usesImage: true, label: '烟散消失', group: '消失', hint: '形状亮一下，从上往下慢慢化成烟，烟往上飘、散开、变淡', palette: 'violet', lifecycle: 'once', ownEnvelope: true,
      params: [P('reach', '飘散', 0.3, 2, 0.05, 1), P('count', '烟量', 0.3, 3, 0.05, 1), PP.speed, P('size', '烟团', 0.4, 3, 0.05, 1), PP.glow, PP.bright],
      prepare(ctx) {
        // 化开的先后：从上往下，带一点噪声（不是一条直线往下推）
        const geo = ctx.geo, { W, u, bbox } = geo, bh = Math.max(1, bbox.y1 - bbox.y0), grid = new Float32Array(geo.N).fill(-1)
        for (const i of geo.inside) { const x = i % W, y = (i - x) / W; grid[i] = clamp01(((y - bbox.y0) / bh) * 0.7 + fbm(x / (26 * u), y / (26 * u), 63, 3) * 0.3) }
        return { grid }
      },
      render(ctx, t, D) {
        // 2026-10-15 用户：「消散过于生硬，还有白描边」——原来化开处一刀切 + 一道最亮的白边，烟是一个个圆团
        const { geo, params: p, pal, state } = ctx, { W, H, u, cov, sd, bbox, margin } = geo, grid = state.grid
        const q = ctx.loop ? frac(t) : t, a = q * Math.min(2.5, p.speed), T0 = 0.08, TS = 0.55, front = (a - T0) / TS
        const flare = smooth(0, 0.06, a) * (1 - smooth(0.06, 0.22, a)), mid = ramp(pal, 0.6, [0, 0, 0])
        // 还没化掉的部分：化开处是一段很宽的软过渡（带细碎噪声），只在那里轻轻透一点同色的光，不描白边
        for (const i of geo.inside) {
          const v = grid[i], x = i % W, y = (i - x) / W, jit = (fbm(x / (16 * u), y / (16 * u), 64, 2) - 0.5) * 0.14
          const keep = smooth(front - 0.06, front + 0.1, v + jit)
          if (keep < 0.002) continue
          const glow = Math.exp(-(((v + jit - front - 0.03) / 0.07) ** 2)) * (front > 0 ? 1 : 0) * 0.35
          if (D.IR) { putImg(D, geo, i, i, keep * (1 + 0.3 * flare)); if (glow > 0.003) addPixel(D, i, cov[i] * glow * keep * p.bright, mid) }
          else addPixel(D, i, cov[i] * keep * ((0.3 + 0.9 * Math.exp(sd[i] / (8 * u))) * (1 + 1.2 * flare) + glow) * p.bright, ramp(pal, 0.62, C))
        }
        // 烟：化掉的那一点从化开的时刻起往上飘（越久飘得越高、越散、越淡）。每个像素往下看一串点，
        // 看哪一点在「它化开以后飘到这里」的时刻，加起来就是这里的烟——连续的一片，不是一个个圆团
        if (front <= 0) return
        // 烟往上飘得比化开的边往下推快（不然烟一直堵在形状里，像一块迷彩）
        const V = 560 * u * p.reach, step = 8 * u, LIFE = 0.38, K = Math.ceil((V * LIFE) / step), sc = 1 / (34 * u * p.size)
        const x0 = Math.max(0, Math.floor(bbox.x0 - 40 * u)), x1 = Math.min(W - 1, Math.ceil(bbox.x1 + 40 * u)), y0 = Math.max(0, Math.floor(margin)), y1 = Math.min(H - 1, Math.ceil(bbox.y1))
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          let dens = 0
          for (let k = 0; k <= K; k++) {
            const dz = k * step, sx = Math.round(x + (hash(x, y + k * 7, 66) - 0.5) * dz * 0.8), sy = Math.round(y + dz)   // 越往上越散
            if (sx < 0 || sx >= W || sy >= H) continue
            const v = grid[sy * W + sx]
            if (v < 0) continue
            const age = a - (T0 + v * TS)
            if (!(age > 0 && age < LIFE)) continue
            const risen = V * age * (1 - 0.35 * age / LIFE)
            dens += Math.exp(-(((risen - dz) / (2.4 * step)) ** 2)) * Math.pow(1 - age / LIFE, 1.6) * Math.min(1, age * 12)
          }
          if (dens < 0.01) continue
          const n = wfbm(x * sc, y * sc + a * 3, 67, 3, 1), tex = smooth(0.25, 0.75, n)
          const g = Math.min(1.1, dens * 0.6) * (0.5 + 0.5 * tex) * 0.55 * p.count * smooth(margin, margin + 24 * u, y)
          if (g > 0.003) addPixel(D, y * W + x, g * p.bright, ramp(pal, 0.25 + 0.35 * tex, C))
        }
      },
      ai: (w) => ['shatter', `${w.shapeNoun} vanishing into smoke, the ${w.shapeNoun} shape softly dissolving from the top down into wisps of smoke that drift upward, spread out and fade`],
    },
    {
      id: 'glassbreak', usesImage: true, label: '玻璃碎裂', group: '破碎', hint: '一面玻璃：被一击裂开，碎片往外一弹再翻着落下，转到某个角度整片反光一闪，碎屑闪烁', palette: 'ice', lifecycle: 'once', ownEnvelope: true,
      params: [P('count', '裂纹', 4, 14, 1, 9), PP.width, PP.speed, P('reach', '下坠', 0.3, 2, 0.05, 1), PP.glow, PP.bright],
      prepare(ctx) {
        const geo = ctx.geo, { W, u } = geo, rnd = rng(4011), nc = Math.round(ctx.params.count)
        const ix = geo.cx + (rnd() - 0.5) * geo.Rb * 0.3, iy = geo.cy - geo.Rb * 0.12
        const angs = []
        for (let k = 0; k < nc; k++) angs.push(((k + 0.2 + rnd() * 0.6) / nc) * TAU - Math.PI)
        const wig = (r, k) => 0.07 * Math.sin(r / (14 * u) + k * 1.7) + 0.04 * Math.sin(r / (5 * u) + k * 3.1)
        const bands = [geo.Rout * (0.24 + rnd() * 0.06), geo.Rout * (0.52 + rnd() * 0.08)]
        const idOf = new Int16Array(geo.N).fill(-1), cell = new Int16Array(geo.inside.length)
        geo.inside.forEach((i, j) => {
          const x = i % W, y = (i - x) / W, r = Math.hypot(x - ix, y - iy), a = Math.atan2(y - iy, x - ix)
          let sec = nc - 1
          for (let k = 0; k < nc; k++) { if (a < angs[k] + wig(r, k)) { sec = (k + nc - 1) % nc; break } }
          const band = r < bands[0] + 3 * u * Math.sin(a * 5) ? 0 : r < bands[1] + 4 * u * Math.sin(a * 4 + 1) ? 1 : 2
          cell[j] = sec * 3 + band; idOf[i] = cell[j]
        })
        const edge = new Uint8Array(geo.inside.length)
        geo.inside.forEach((i, j) => { const c = idOf[i]; if (idOf[i - 1] !== c || idOf[i + 1] !== c || idOf[i - W] !== c || idOf[i + W] !== c) edge[j] = 1 })
        const sum = new Map()
        geo.inside.forEach((i, j) => { const c = cell[j], x = i % W, y = (i - x) / W, s0 = sum.get(c) || [0, 0, 0]; s0[0] += x; s0[1] += y; s0[2]++; sum.set(c, s0) })
        const shards = {}
        for (const [c, [sx, sy, n]] of sum) {
          const mx = sx / n, my = sy / n, dx = mx - ix, dy = my - iy, l = Math.hypot(dx, dy) || 1, fa = rnd() * Math.PI
          shards[c] = { cx: mx, cy: my, ox: dx / l, oy: dy / l, spin: (rnd() - 0.5) * 2.4, flip: (2 + rnd() * 4) * (rnd() < 0.5 ? -1 : 1), ax: Math.cos(fa), ay: Math.sin(fa), delay: (c % 3) * 0.035 + rnd() * 0.05, g: 0.8 + rnd() * 0.5, ph: rnd() * TAU }
        }
        // 裂纹：主裂纹 + 分叉（只画）
        const cracks = angs.map((a0, k) => { const pts = []; for (let r = 0; r <= geo.Rout * 1.05; r += 3 * u) { const a = a0 + wig(r, k); pts.push([ix + Math.cos(a) * r, iy + Math.sin(a) * r, r]) } return pts })
        const twigs = []
        cracks.forEach((pts) => { for (let b = 0; b < 2; b++) { const at = Math.floor(pts.length * (0.25 + rnd() * 0.5)), base = pts[at]; if (!base) continue; const nx = pts[Math.min(pts.length - 1, at + 1)], a0 = Math.atan2(nx[1] - base[1], nx[0] - base[0]) + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5), len = (8 + rnd() * 16) * u; twigs.push({ x0: base[0], y0: base[1], x1: base[0] + Math.cos(a0) * len, y1: base[1] + Math.sin(a0) * len, r: base[2] }) } })
        const glitter = []
        for (let k = 0; k < 50; k++) glitter.push({ x: ix + (rnd() - 0.5) * geo.Rout * 1.2, y: iy + (rnd() - 0.5) * geo.Rout * 1.0, vx: (rnd() - 0.5) * 30 * u, vy: (10 + rnd() * 40) * u, d: 0.18 + rnd() * 0.25, ph: rnd() * TAU })
        return { ix, iy, cell, edge, cells: { idOf, ...pieceIndex(geo, idOf) }, shards, cracks, twigs, bands, glitter }
      },
      render(ctx, t, D) {
        const { geo, params: p, pal, state } = ctx, { W, H, u, sd, cov } = geo
        const q = ctx.loop ? frac(t) : t, qs = q * Math.min(2.5, p.speed), hot = ramp(pal, 1, [0, 0, 0]), glass = ramp(pal, 0.55, [0, 0, 0]), sheenC = ramp(pal, 0.85, [0, 0, 0])
        const sep = qs > 0.18, g = smooth(0.04, 0.15, qs) * geo.Rout * 1.05
        const fallMax = softFit(Math.max(20 * u, (H - geo.margin - geo.bbox.y1) * 0.9 + geo.Rout * 0.4) * p.reach, Math.max(12 * u, H - geo.margin - geo.bbox.y1 + geo.Rout * 0.15))
        if (!sep) {   // 完整的玻璃：极淡的面、亮边、一道斜向反光
          const sw = 0.25 + 0.5 * smooth(0, 0.18, qs)
          for (const i of geo.inside) {
            const x = i % W, y = (i - x) / W, d = ((x - geo.bbox.x0) + (y - geo.bbox.y0)) / Math.max(1, (geo.bbox.x1 - geo.bbox.x0) + (geo.bbox.y1 - geo.bbox.y0))
            const sheen = Math.exp(-(((d - sw) / 0.06) ** 2)) * 0.7 + Math.exp(-(((d - sw - 0.1) / 0.02) ** 2)) * 0.5
            addPixel(D, i, cov[i] * ((D.IR ? 0.02 : 0.1) + sheen) * p.bright, sheenC)
            putImg(D, geo, i, i, cov[i])
          }
          for (let i = 0; i < geo.N; i++) { const s = sd[i]; if (Math.abs(s) < 3 * u) addPixel(D, i, Math.exp(-((s / (1.1 * u)) ** 2)) * 0.9 * p.bright, sheenC) }
        } else {   // 碎片：先往外弹，再翻着往下掉；翻到侧面时整片反光
          const tf = {}
          for (const c in state.shards) {
            const m = state.shards[c], a = clamp01((qs - 0.18 - m.delay) / 0.6), pop = 1 - Math.pow(1 - Math.min(1, a * 4), 2)
            const phi = m.flip * a + m.ph, spec = Math.pow(Math.abs(Math.sin(phi)), 6), fade = 1 - smooth(0.55, 1, a)
            tf[c] = { a, m, sq: Math.cos(phi), tx: m.ox * 16 * u * pop, ty: m.oy * 10 * u * pop + fallMax * m.g * a * a, rot: m.spin * a, k: (0.08 + 0.95 * spec) * fade * p.bright, edgeK: (0.55 + 1.3 * spec) * fade * p.bright, fade }
          }
          const pieces = {}
          for (const c in tf) { const f = tf[c], m = f.m; pieces[c] = { cx: m.cx, cy: m.cy, tx: f.tx, ty: f.ty, rot: f.rot, sq: f.sq * 0.85 + 0.15 * Math.sign(f.sq || 1), ax: m.ax, ay: m.ay, k: f.k * (D.IR ? 0.6 : 1), edgeK: f.edgeK, imgK: D.IR ? (0.5 + 0.5 * Math.abs(f.sq)) * f.fade : 0 } }
          drawPieces(D, geo, state.cells, pieces, glass, hot)
        }
        // 撞击一闪
        const fl = Math.exp(-qs / 0.025)
        dot(D, state.ix, state.iy, 0.1 * geo.Rout, 2.6 * fl * p.bright, hot)
        if (fl > 0.05) { star(D, state.ix, state.iy, 0.05 * geo.Rout, 0.4, 1.8 * fl * p.bright, hot, 6); ringPx(D, state.ix, state.iy, geo.Rout * 0.3 * (1 - fl), 1 * u, fl * p.bright, hot) }
        // 裂纹（碎开前）
        if (qs < 0.26) {
          const k1 = (sep ? 1 - smooth(0.18, 0.26, qs) : 1) * 1.5 * p.bright
          for (const pts of state.cracks) for (let i = 0; i < pts.length - 1; i++) { const [x0, y0, r0] = pts[i], [x1, y1] = pts[i + 1]; if (r0 > g || sdAt(geo, x0, y0) > 0) break; streak(D, x0, y0, x1, y1, 0.55 * u * p.width, 0.55 * u * p.width, k1, k1, hot, hot) }
          for (const tw of state.twigs) if (tw.r < g * 0.9 && sdAt(geo, tw.x1, tw.y1) < 0) streak(D, tw.x0, tw.y0, tw.x1, tw.y1, 0.45 * u * p.width, 0.3 * u * p.width, k1 * 0.8, k1 * 0.4, hot, hot)
          for (const bnd of state.bands) if (g > bnd) ringPx(D, state.ix, state.iy, bnd, 0.5 * u * p.width, k1 * 0.75, hot, { mod: (a) => (sdAt(geo, state.ix + Math.cos(a) * bnd, state.iy + Math.sin(a) * bnd) < 0 ? 1 : 0) })
        }
        // 碎屑闪光
        for (const gl of state.glitter) {
          const age = (qs - gl.d) / 0.55
          if (!(age > 0 && age < 1)) continue
          const x = gl.x + gl.vx * age, y = gl.y + gl.vy * age + 30 * u * age * age, tw = Math.pow(Math.abs(Math.sin(age * 9 + gl.ph)), 4)
          star(D, x, y, 0.8 * u, gl.ph, tw * (1 - age) * 1.4 * p.bright, hot, 4)
        }
      },
      ai: (w) => ['shatter', `${w.shapeNoun} pane of glass shattering, struck at one point so cracks burst across it, then the pieces pop outward and tumble down, each flashing as it catches the light, with glittering specks`],
    },
    {
      id: 'crackglow', usesImage: true, label: '裂纹迸光', group: '破碎', hint: '从一点裂开，几条发光的裂纹一路长到边上，越来越亮、开始抖，最后沿着裂纹炸成碎块', palette: 'fire', lifecycle: 'once', ownEnvelope: true,
      params: [P('count', '裂纹', 0.3, 3, 0.05, 1), PP.width, PP.speed, P('reach', '爆开', 0.3, 2, 0.05, 1), PP.glow, PP.bright],
      prepare(ctx) {
        const geo = ctx.geo, { u, W, H } = geo, rnd = rng(5101)
        // 撞击点：形状中心附近（不在形状里就找一个里面的点）
        let c0 = { x: geo.cx + (rnd() - 0.5) * 0.25 * geo.R, y: geo.cy + (rnd() - 0.5) * 0.25 * geo.R }
        if (sdAt(geo, c0.x, c0.y) > -3 * u) c0 = insidePoint(geo, rnd)
        // 一条裂纹：折线往前走，角度小幅抖动，碰到形状边缘就停在边上；每个点记从撞击点沿裂纹走过的距离 d（长出来的先后）
        const walk = (x, y, a, d0, maxLen, lvl) => {
          const pts = [{ x, y, d: d0 }]
          let len = 0
          while (len < maxLen && pts.length < 80) {
            const L = (9 + rnd() * 9) * u * (lvl ? 0.7 : 1)
            a += (rnd() - 0.5) * 0.55
            let nx = x + Math.cos(a) * L, ny = y + Math.sin(a) * L
            if (sdAt(geo, nx, ny) > -u) {
              let lo = 0, hi = 1
              for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (sdAt(geo, x + (nx - x) * m, y + (ny - y) * m) > -u) hi = m; else lo = m }
              nx = x + (nx - x) * lo; ny = y + (ny - y) * lo
              len += L * lo; pts.push({ x: nx, y: ny, d: d0 + len })
              break
            }
            x = nx; y = ny; len += L; pts.push({ x, y, d: d0 + len })
          }
          return pts
        }
        const cracks = []
        // 从一个裂点放出 nMain 条主裂纹 + 分叉 + 横向裂纹；d0 = 这个裂点开始裂的先后
        const burstFrom = (c, nMain, d0) => {
        const base = cracks.length
        for (let k = 0; k < nMain; k++) cracks.push({ pts: walk(c.x, c.y, (TAU * (k + (rnd() - 0.5) * 0.6)) / nMain, d0, Infinity, 0), lvl: 0 })
        // 分叉：每条主裂纹 1–2 条短的
        for (const m of cracks.slice(base, base + nMain)) {
          for (let b = 0; b < (rnd() < 0.65 ? 1 : 0); b++) {
            if (m.pts.length < 4) break
            const j = 1 + Math.floor(rnd() * (m.pts.length - 3)), A = m.pts[j], B = m.pts[j + 1]
            const dir = Math.atan2(B.y - A.y, B.x - A.x) + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5)
            cracks.push({ pts: walk(A.x, A.y, dir, A.d, (22 + rnd() * 40) * u, 1), lvl: 1 })
          }
        }
        // 横向裂纹：相邻两条主裂纹之间连一段（在形状里才连），把扇形再切开
        for (let k = 0; k < nMain; k++) {
          if (rnd() < 0.35) continue
          const A = cracks[base + k].pts, B = cracks[base + (k + 1) % nMain].pts
          if (A.length < 3 || B.length < 3) continue
          const pa = A[Math.floor(A.length * (0.4 + rnd() * 0.25))], pb = B[Math.floor(B.length * (0.4 + rnd() * 0.25))]
          const pts = [{ x: pa.x, y: pa.y, d: Math.max(pa.d, pb.d) }], segs = 4
          let ok = true
          for (let j = 1; j <= segs; j++) {
            const f = j / segs, jit = j < segs ? (rnd() - 0.5) * 10 * u : 0, nx = pa.x + (pb.x - pa.x) * f - (pb.y - pa.y) / (Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1) * jit, ny = pa.y + (pb.y - pa.y) * f + (pb.x - pa.x) / (Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1) * jit
            if (sdAt(geo, nx, ny) > -u) { ok = false; break }
            pts.push({ x: nx, y: ny, d: pts[j - 1].d + Math.hypot(nx - pts[j - 1].x, ny - pts[j - 1].y) })
          }
          if (ok) cracks.push({ pts, lvl: 1 })
        }
        }
        const nMain = Math.round(4 + 2.4 * ctx.params.count), impacts = [{ x: c0.x, y: c0.y, d0: 0 }]
        burstFrom(c0, nMain, 0)
        // 形状里离裂纹太远的地方（两颗樱桃那种中间只连一根细梗的）再加裂点，最多 3 个——不然只裂一半
        for (let extra = 0; extra < 2; extra++) {
          const pts = []
          for (const c of cracks) for (const q of c.pts) pts.push(q)
          let far = null, fd = 0, md = 0
          const samp = []
          for (let j = 0; j < geo.inside.length; j += 5) {
            const i = geo.inside[j], x = i % W, y = (i - x) / W
            let d = Infinity
            for (const q of pts) { const e = (q.x - x) ** 2 + (q.y - y) ** 2; if (e < d) d = e }
            samp.push(x, y, d)
            if (d > fd && sdAt(geo, x, y) < -6 * u) { fd = d; far = { x, y } }
          }
          for (const q of pts) md = Math.max(md, q.d)
          if (!far || Math.sqrt(fd) < Math.max(45 * u, 0.8 * geo.R)) break   // 只补真没裂到的一大块（不在大方块的角上再补）
          // 裂点放在那块没裂的区域中间（最远点常在边上）
          let ax = 0, ay = 0, an = 0
          for (let j = 0; j < samp.length; j += 3) if (samp[j + 2] > fd * 0.3 && (samp[j] - far.x) ** 2 + (samp[j + 1] - far.y) ** 2 < fd) { ax += samp[j]; ay += samp[j + 1]; an++ }
          if (an && sdAt(geo, ax / an, ay / an) < -4 * u) far = { x: ax / an, y: ay / an }
          impacts.push({ x: far.x, y: far.y, d0: md * 0.3 })
          burstFrom(far, Math.max(3, Math.round(nMain * 0.6)), md * 0.3)
        }
        let maxD = 1
        for (const c of cracks) for (const q of c.pts) maxD = Math.max(maxD, q.d)
        // 碎块 = 被裂纹分开的区域：裂纹画成一道缝，形状里剩下的像素按连通块编号，缝和太小的块归给最近的块
        const N = W * H, wall = new Uint8Array(N), idOf = new Int32Array(N).fill(-1), inside = geo.inside
        const isIn = new Uint8Array(N)
        for (const i of inside) isIn[i] = 1
        for (const c of cracks) for (let j = 1; j < c.pts.length; j++) {
          const A = c.pts[j - 1], B = c.pts[j], L = Math.ceil(Math.hypot(B.x - A.x, B.y - A.y) * 2) + 1
          for (let k = 0; k <= L; k++) { const x = Math.round(A.x + (B.x - A.x) * k / L), y = Math.round(A.y + (B.y - A.y) * k / L); if (x >= 0 && y >= 0 && x < W && y < H) wall[y * W + x] = 1 }
        }
        let nid = 0
        const sizes = [], queue = new Int32Array(N)
        for (const i0 of inside) {
          if (wall[i0] || idOf[i0] >= 0) continue
          let qh = 0, qt = 0
          queue[qt++] = i0; idOf[i0] = nid
          while (qh < qt) {
            const i = queue[qh++], x = i % W
            for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && isIn[j] && !wall[j] && idOf[j] < 0) { idOf[j] = nid; queue[qt++] = j }
          }
          sizes.push(qt); nid++
        }
        const minSize = 40 * u * u
        for (const i of inside) if (idOf[i] >= 0 && sizes[idOf[i]] < minSize) idOf[i] = -1
        // 没编号的（缝 / 小块）一圈圈并进旁边的块
        for (let pass = 0; pass < 64; pass++) {
          let left = 0
          const set = []
          for (const i of inside) {
            if (idOf[i] >= 0) continue
            const x = i % W
            const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W].find((j) => j >= 0 && j < N && idOf[j] >= 0)
            if (nb !== undefined) set.push(i, idOf[nb]); else left++
          }
          for (let k = 0; k < set.length; k += 2) idOf[set[k]] = set[k + 1]
          if (!left) break
        }
        const cells = { idOf, ...pieceIndex(geo, idOf) }
        // 软的炽热边：块边 1，往里一圈圈减（1 像素的边转起来是虚线）
        const edgeW = new Float32Array(N), FALL = [1, 0.6, 0.3, 0.12]
        let ring = []
        for (const i of inside) if (cells.edgePix[i]) { edgeW[i] = 1; ring.push(i) }
        for (let d = 1; d < FALL.length; d++) {
          const next = []
          for (const i of ring) { const x = i % W; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && isIn[j] && idOf[j] === idOf[i] && edgeW[j] === 0) { edgeW[j] = FALL[d]; next.push(j) } }
          ring = next
        }
        cells.edgeW = edgeW
        const acc = new Map()
        for (const i of inside) { const c = idOf[i]; if (c < 0) continue; const v = acc.get(c) || [0, 0, 0]; v[0] += i % W; v[1] += (i - (i % W)) / W; v[2]++; acc.set(c, v) }
        const motion = {}
        for (const [c, v] of acc) { const mx = v[0] / v[2], my = v[1] / v[2], dx = mx - c0.x, dy = my - c0.y, l = Math.hypot(dx, dy) || 1; motion[c] = { cx: mx, cy: my, ox: dx / l, oy: dy / l, v: 0.6 + rnd() * 0.6, w: (rnd() - 0.5) * 3 } }
        const sparks = []
        for (let k = 0; k < 60; k++) sparks.push({ a: rnd() * TAU, v: 0.4 + rnd() * 0.6, life: 0.2 + rnd() * 0.18 })
        return { c0, impacts, cracks, maxD, cells, motion, sparks }
      },
      render(ctx, t, D) {
        const { geo, params: p, pal, state } = ctx, { u, cov, sd } = geo, nn = ctx.n, W = geo.W, H = geo.H
        const q = ctx.loop ? frac(t) : t, a = q * Math.min(2.5, p.speed), hot = ramp(pal, 1, [0, 0, 0]), mid = ramp(pal, 0.62, [0, 0, 0]), deep = ramp(pal, 0.12, [0, 0, 0])
        const grow = smooth(0.02, 0.42, a), BURST = 0.6, pre = a < BURST, charge = smooth(0.35, BURST, a), { c0 } = state
        // 抖：快炸开时轻轻抖
        const amp = charge * 2 * u, fr = Math.round(q * nn)
        const jx = pre ? (hash(fr, 1, 5) - 0.5) * 2 * amp : 0, jy = pre ? (hash(fr, 2, 5) - 0.5) * 2 * amp : 0
        if (pre) {
          // 形状压暗像石头（不再整片发橙），边上只留一点暗红
          for (const i of geo.inside) {
            const x = i % W, y = (i - x) / W, nx = Math.round(x + jx), ny = Math.round(y + jy)
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
            addPixel(D, ny * W + nx, cov[i] * (D.IR ? 0.02 : 0.1 + 0.06 * charge) * p.bright, deep)
            putImg(D, geo, ny * W + nx, i, 1 - 0.45 * grow)
          }
          if (!D.IR) for (let i = 0; i < geo.N; i++) { const s0 = sd[i]; if (Math.abs(s0) < 3 * u) addPixel(D, i, Math.exp(-((s0 / (1.2 * u)) ** 2)) * 0.22 * p.bright, deep) }
          // 裂纹：从撞击点沿 d 往外长；根粗尖细；长出来的尖最亮；越接近炸开整体越亮
          const F = grow * state.maxD * 1.02, glowK = (0.8 + 1.6 * charge) * p.bright, G = glowLines(geo)
          for (const c of state.cracks) {
            const pts = c.pts, thin = c.lvl ? 0.55 : 1
            for (let j = 1; j < pts.length; j++) {
              const A = pts[j - 1], B = pts[j]
              if (A.d > F) break
              const f = B.d > F ? (F - A.d) / Math.max(1e-3, B.d - A.d) : 1, bx = A.x + (B.x - A.x) * f, by = A.y + (B.y - A.y) * f, bd = A.d + (B.d - A.d) * f
              const wA = (0.45 + 1.5 * (1 - A.d / state.maxD)) * thin * u * p.width, wB = (0.45 + 1.5 * (1 - bd / state.maxD)) * thin * u * p.width
              const tA = 1 + 1.8 * Math.exp(-(F - A.d) / (14 * u)), tB = 1 + 1.8 * Math.exp(-(F - bd) / (14 * u))
              lineGlow(G, geo, A.x + jx, A.y + jy, bx + jx, by + jy, wA, wB, glowK * tA, glowK * tB, 3.4, 0.22)
            }
          }
          flushGlow(D, G, hot, mid)
          for (const im of state.impacts) if (F > im.d0) dot(D, im.x + jx, im.y + jy, (4 + 6 * charge) * u * p.width, (0.6 + 1.6 * charge) * grow * p.bright, hot)
        } else {   // 沿裂纹炸开：碎块带炽热的边飞出去，一闪 + 火星
          const b = clamp01((a - BURST) / 0.4), e = 1 - Math.pow(1 - b, 2.4), Dm = fitOut(geo, geo.Rout * 0.9 * p.reach, 1.8)
          const gone = 1 - smooth(0.45, 0.88, b), tf = {}
          for (const c in state.motion) {
            const m = state.motion[c]
            tf[c] = { tx: m.ox * Dm * m.v * e, ty: m.oy * Dm * m.v * e + 20 * u * b * b, rot: m.w * e, cx: m.cx, cy: m.cy, k: (D.IR ? 0.02 : 0.1) * gone * p.bright, edgeK: 2.4 * Math.pow(1 - b, 1.3) * gone * p.bright, imgK: 0.55 * gone }
          }
          drawPieces(D, geo, state.cells, tf, deep, hot)
          const fl = Math.exp(-(a - BURST) / 0.05), R = fitR(geo, geo.Rout * 1.4 * p.reach, 1.12)
          dot(D, c0.x, c0.y, 0.22 * R, 2.2 * fl * p.bright, hot)
          dot(D, c0.x, c0.y, 0.5 * R, 0.5 * fl * p.bright, mid)
          for (const sp of state.sparks) {
            const age = (a - BURST) / sp.life
            if (!(age > 0 && age < 1)) continue
            const ease = (x) => (1 - Math.exp(-3.5 * x)) / (1 - Math.exp(-3.5)), d1 = R * sp.v * ease(age), d0 = R * sp.v * ease(Math.max(0, age - 0.08))
            streak(D, c0.x + Math.cos(sp.a) * d0, c0.y + Math.sin(sp.a) * d0, c0.x + Math.cos(sp.a) * d1, c0.y + Math.sin(sp.a) * d1, 0.3 * u, 1.2 * u, 0, (1 - age) * 1.8 * p.bright, mid, ramp(pal, 1 - age * 0.6, C2))
          }
        }
      },
      ai: (w) => ['shatter', `${w.shapeNoun} cracking open with light, a few glowing molten cracks spreading from one point across the darkened shape and brightening as it starts to shake, then it bursts apart along those cracks into chunks with white-hot edges, a flash and sparks`],
    },
    {
      id: 'crumble', usesImage: true, label: '碎裂坠落', group: '破碎', hint: '形状裂成块，一块块往下掉、边翻边淡，扬起一点粉尘', palette: 'white', lifecycle: 'once', ownEnvelope: true,
      params: [P('count', '碎块', 0.3, 4, 0.05, 1), PP.speed, P('reach', '下坠', 0.3, 2, 0.05, 1), PP.width, PP.glow, PP.bright],
      prepare(ctx) {
        const geo = ctx.geo, rnd = rng(6203), m = Math.max(5, Math.round(26 * ctx.params.count))
        const cells = voronoiCells(geo, m, 6301), motion = cells.seeds.map((s) => ({ cx: s.x, cy: s.y, vx: (rnd() - 0.5) * 14 * geo.u, w: (rnd() - 0.5) * 2.6, delay: (1 - (s.y - geo.bbox.y0) / Math.max(1, geo.bbox.y1 - geo.bbox.y0)) * 0.18 + rnd() * 0.12, g: 0.8 + rnd() * 0.5 }))
        return { cells, motion }
      },
      render(ctx, t, D) {
        const { geo, params: p, pal, state } = ctx, { H, u, sd } = geo
        const q = ctx.loop ? frac(t) : t, qs = q * Math.min(2.5, p.speed), crack = smooth(0.02, 0.14, qs)
        const fallMax = softFit(Math.max(20 * u, (H - geo.margin - geo.bbox.y1) * 0.85 + geo.Rout * 0.5) * p.reach, Math.max(12 * u, H - geo.margin - geo.bbox.y1 + geo.Rout * 0.15))
        const fill = ramp(pal, 0.45, [0, 0, 0]), hot = ramp(pal, 0.95, [0, 0, 0])
        const tf = state.motion.map((m) => {
          const a = clamp01((qs - 0.14 - m.delay) / 0.55), fade = 1 - smooth(0.55, 1, a)
          return { tx: m.vx * a, ty: fallMax * m.g * a * a, rot: m.w * a * a, cx: m.cx, cy: m.cy, k: (D.IR ? 0.02 : 0.32) * fade * p.bright, edgeK: (D.IR ? 0.1 + 0.35 * crack : 0.25 + 1.2 * crack) * fade * p.bright * p.width, imgK: fade }
        })
        drawPieces(D, geo, state.cells, tf, fill, hot)
        if (qs < 0.2) for (let i = 0; i < geo.N; i++) { const s = sd[i]; if (Math.abs(s) < 3 * u) addPixel(D, i, Math.exp(-((s / (1.3 * u)) ** 2)) * 0.5 * p.bright, fill) }
        const rnd = rng(6401)
        for (let k = 0; k < 40; k++) {
          const x0 = geo.bbox.x0 + rnd() * (geo.bbox.x1 - geo.bbox.x0), y0 = geo.bbox.y1 - rnd() * (geo.bbox.y1 - geo.bbox.y0) * 0.5, age = (qs - 0.2 - rnd() * 0.35) / 0.55
          if (!(age > 0 && age < 1)) continue
          const x = x0 + (rnd() - 0.5) * 50 * u * age, y = y0 + 30 * u * age * (rnd() - 0.3)
          dot(D, x, y, (4 + rnd() * 7) * u * (0.4 + age), Math.sin(Math.PI * age) * 0.22 * p.bright, fill)
        }
      },
      ai: (w) => ['shatter', `${w.shapeNoun} crumbling, cracks splitting it into chunks that break off and drop downward one after another, tumbling and fading, with a little dust`],
    },
    // ---------------------------------------------------------------- 烟雾 / 水 / 冰（2026-10-15 用户：「烟雾类的、水类的都缺少，包括冰」）
    {
      id: 'smokewrap', group: '烟雾', label: '烟雾缭绕', hint: '烟从轮廓上冒出来，一缕缕往上飘、翻卷着慢慢散开', palette: 'smoke', lifecycle: 'loop',
      params: [P('reach', '高度', 0.3, 3, 0.05, 1), P('width', '浓度', 0.3, 3, 0.05, 1), P('size', '烟团', 0.4, 3, 0.05, 1), P('laps', '流速', 1, 4, 1, 1), { ...PP.glow, def: 0.5 }, PP.bright],
      prepare(ctx) {
        const geo = ctx.geo, { W, H, u, sd } = geo, E = new Float32Array(geo.N), dec = Math.exp(-1 / (110 * u * ctx.params.reach))
        // 烟源 = 轮廓外沿一圈；从下往上涂开（每往上一行衰减一点、左右散一点）= 一缕缕烟能飘到的范围
        // 朝下的那段边不冒（烟会穿过图标），烟也不进形状里面
        for (let y = H - 1; y >= 0; y--) for (let x = 0; x < W; x++) {
          const i = y * W + x, s0 = sd[i]
          if (s0 < -u) { E[i] = 0; continue }
          const ny = y > 0 && y < H - 1 ? (sd[i + W] - sd[i - W]) / 2 : 0, face = 0.2 + 0.8 * smooth(0.55, -0.35, ny)
          const src = s0 > -3 * u ? Math.exp(-((s0 / (8 * u)) ** 2)) * face : 0
          let up = 0
          if (y < H - 1) { const j = i + W; up = dec * (0.5 * E[j] + 0.25 * E[x > 0 ? j - 1 : j] + 0.25 * E[x < W - 1 ? j + 1 : j]) }
          E[i] = Math.max(src, up)
        }
        return { E }
      },
      render(ctx, t, D) {
        const { geo, params: p, pal, state } = ctx, { W, u, N } = geo, sc = 1 / (34 * u * p.size), F = 1.1 * Math.round(p.laps), E = state.E
        for (let i = 0; i < N; i++) {
          const env = E[i]
          if (env < 0.012) continue
          const x = i % W, y = (i - x) / W
          // 噪声往上流（y + k·F）：烟一团团往上翻；t / t − 1 两份保对比度地交叉，首尾接上
          const at = (k) => wfbm(x * sc, y * sc + k * F, 61, 3, 0.9)
          const n = vblend(at(t), at(t - 1), t), dens = env * smooth(0.3, 0.85, n) * p.width
          if (dens > 0.004) smokeShade(D, i, dens * 1.35, x, y, sc, t, F, 61, pal, p.bright)
        }
      },
      ai: (w) => ['frame', `smoke rising from the edge of a ${w.noun}, soft grey wisps of smoke curling upward and slowly drifting apart. ${w.NOT}`],
    },
    {
      id: 'smokerise', group: '烟雾', label: '烟柱升腾', hint: '一股浓烟从框底翻滚着往上升，越往上越宽越淡', palette: 'smoke', lifecycle: 'loop',
      params: [P('reach', '高度', 0.4, 1.6, 0.05, 1), P('width', '宽度', 0.4, 2.5, 0.05, 1), P('size', '烟团', 0.4, 3, 0.05, 1), P('laps', '流速', 1, 4, 1, 1), { ...PP.glow, def: 0.5 }, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { W, H, u, cx, bbox, margin } = geo, bw = bbox.x1 - bbox.x0, bh = bbox.y1 - bbox.y0
        const y0 = Math.min(H - margin - 12 * u, bbox.y1), Hc = Math.max(40 * u, Math.min((y0 - margin) * 0.97, bh * 1.5 * p.reach))
        const room = Math.max(10 * u, Math.min(cx, W - cx) - margin), w0 = Math.min(room * 0.5, Math.max(6 * u, bw * 0.12 * p.width)), w1 = softFit(bw * 0.5 * p.width, room / 1.45)
        const F = 1.0 * Math.round(p.laps), sc = 1 / (36 * u * p.size)
        for (let y = Math.max(0, Math.floor(y0 - Hc)); y <= Math.min(H - 1, Math.ceil(y0 + w0)); y++) {
          const h = clamp01((y0 - y) / Hc), w = w0 + (w1 - w0) * Math.pow(h, 0.8), off = 0.22 * w1 * Math.sin(h * 3.6 + 0.8) * h
          const vert = (y > y0 ? smooth(w0, 0, y - y0) : 1) * (1 - smooth(0.5, 1, h))
          for (let x = Math.max(0, Math.floor(cx + off - w * 1.35)); x <= Math.min(W - 1, Math.ceil(cx + off + w * 1.35)); x++) {
            const ax = (x - cx - off) / w, env = smooth(1.3, 0.25, Math.abs(ax)) * vert
            if (env < 0.01) continue
            // 横向按柱宽缩放（烟团跟着变大），竖向往上流
            const at = (k) => wfbm(ax * 1.8 + 5, y * sc + k * F, 62, 3, 0.9)
            const n = vblend(at(t), at(t - 1), t), dens = env * smooth(0.18 + 0.12 * h, 0.8, n) * (1 - 0.35 * h) * p.width
            if (dens > 0.004) smokeShade(D, y * W + x, dens * 1.3, x, y, sc, t, F, 62, pal, p.bright)
          }
        }
      },
      ai: () => ['pillar', 'column of thick smoke billowing upward from the bottom, rolling and widening as it rises and thinning out at the top'],
    },
    {
      id: 'ripple', group: '水', label: '水波涟漪', hint: '水面一圈圈涟漪荡开，波峰上一道道反光，越远越淡', palette: 'water', lifecycle: 'loop',
      params: [P('reach', '范围', 0.3, 1, 0.05, 0.9), P('count', '圈数', 1, 5, 1, 3), PP.width, P('laps', '速度', 1, 4, 1, 1), PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { W, H, u, cx, cy, margin } = geo, m = Math.round(p.count), laps = Math.round(p.laps)
        // 水面有透视：横向半径 Rx，竖向压成 Rx·sy；不再是一圈圈正圆（像雷达）
        const sy = 0.5, Rx = Math.min(geo.Rfit * 1.35, Math.min(cx, W - cx) - margin) * p.reach, Ry = Rx * sy
        const rings = []
        for (let j = 0; j < m; j++) { const q = frac(t * laps + j / m); rings.push({ r: Rx * (1 - Math.pow(1 - q, 1.35)), amp: Math.pow(1 - q, 1.3) * smooth(0, 0.06, q), q, j }) }
        const wl = 3 * u * p.width, pack = 14 * u * p.width
        const x0 = Math.max(0, Math.floor(cx - Rx - pack * 2)), x1 = Math.min(W - 1, Math.ceil(cx + Rx + pack * 2)), y0 = Math.max(0, Math.floor(cy - Ry - pack)), y1 = Math.min(H - 1, Math.ceil(cy + Ry + pack))
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const dx = x - cx, dy = (y - cy) / sy, r = Math.hypot(dx, dy)
          if (r > Rx + pack * 2) continue
          const cs = dx / (r + 1e-3), sn = dy / (r + 1e-3), near = 0.65 + 0.35 * clamp01(sn + 0.3)   // 近处（下半圈）亮一点
          let e = 0, hi = 0
          for (const g of rings) {
            const d = r - g.r, env = Math.exp(-((d / pack) ** 2))
            if (env < 0.01) continue
            // 一个波包里几道波峰；每道反光沿圈断断续续（水面的碎光）
            const crest = Math.pow(Math.max(0, Math.cos(d / wl)), 6), brk = smooth(0.3, 0.7, fbm(cs * 3 + g.j * 7 + 1, sn * 3 + Math.floor(d / (wl * TAU) + 0.5) * 3.1 + 2, 72, 3))
            const v = g.amp * env * near
            e += v * (0.1 + 2.4 * crest * (0.3 + 0.7 * brk)); hi = Math.max(hi, crest * brk * env * g.amp)
          }
          if (e > 0.003) addPixel(D, y * W + x, e * p.bright, ramp(pal, 0.4 + 0.6 * clamp01(hi * 1.7), C))
        }
        for (const g of rings) if (g.q < 0.12) dot(D, cx, cy, 4 * u, (1 - g.q / 0.12) * 1.3 * p.bright, ramp(pal, 0.95, C))
      },
      ai: () => ['ring', 'water ripples, rings of gentle waves spreading outward across a water surface with bright glints of light on each crest, fading as they travel'],
    },
    {
      id: 'waterflow', group: '水', label: '水流环绕', hint: '一股带波浪的水流贴着轮廓往前涌，浪头起伏、浪尖白沫，溅出水珠', palette: 'water', lifecycle: 'loop',
      params: [P('width', '水宽', 0.3, 4, 0.05, 1), P('reach', '浪高', 0, 3, 0.05, 1), P('size', '浪距', 0.4, 3, 0.05, 1), P('laps', '流速', 1, 4, 1, 1), P('count', '水珠', 0, 3, 0.05, 1), PP.glow, PP.bright],
      render(ctx, t, D) {
        // 2026-10-15 用户：「应该是带波浪的水流才对」——原来是一根粗细均匀的水管
        const { geo, params: p, pal } = ctx, { u, sd, N } = geo, T = outlineParam(geo), total = geo.outer.reduce((a, c) => a + c.len, 0) || 1
        const bw = 8 * u * p.width, laps = Math.round(p.laps), dir = ctx.project.direction === 'cw' ? -1 : 1
        const nw = Math.max(3, Math.round(total / (95 * u * p.size))), per = Math.max(3, Math.round(total / (46 * u))), F = 2.2 * laps
        // 浪：绕一圈 nw 个，往流向推（一个循环推整数个浪，首尾接上）；sin(φ + 0.7·sin φ) 让浪头前陡后缓
        const wave = (Tv) => {
          const ph = TAU * (Tv * nw - dir * t * laps * 2), ph2 = TAU * (Tv * nw * 2 + 0.37) - dir * TAU * t * laps * 3
          const w1 = Math.sin(ph + dir * 0.7 * Math.sin(ph)), w2 = Math.sin(ph2)
          return clamp01(0.5 + 0.42 * w1 + 0.12 * w2)
        }
        const col = [0, 0, 0], maxH = bw * (1.4 + 1.6 * p.reach)
        for (let i = 0; i < N; i++) {
          const s0 = sd[i]
          if (s0 < -3 * u || s0 > maxH + 4 * u) continue
          const wv = wave(T[i]), h = bw * (1.4 + 1.6 * p.reach * wv), ac = s0 / h   // 0 = 贴着轮廓，1 = 水面
          if (ac > 1.25) continue
          const body = smooth(-0.2, 0.08, ac) * (1 - smooth(0.9, 1.04, ac)), X = T[i] * per
          // 水里顺着流向的反光纹（往前流，t / t − 1 交叉）
          const at = (k) => fbm(X - dir * k * F, ac * 1.7 + 3, 64, 4, per), n = vblend(at(t), at(t - 1), t)
          const at2 = (k) => fbm(X * 2.2 - dir * k * F * 1.6, ac * 3.2 + 9, 65, 3, per * 2), n2 = vblend(at2(t), at2(t - 1), t)
          const glint = smooth(0.62, 0.7, n) * (1 - smooth(0.7, 0.8, n)) + 0.6 * smooth(0.68, 0.78, n2) * (1 - smooth(0.78, 0.86, n2))
          // 水面一道亮线，浪尖上更亮；浪尖白沫；贴轮廓那边一道细亮边
          const surf = Math.exp(-(((ac - 0.96) / 0.07) ** 2)) * (0.45 + 0.9 * wv)
          const foam = smooth(0.62, 0.95, wv) * Math.exp(-(((ac - 0.88) / 0.14) ** 2)) * (0.4 + 0.6 * smooth(0.4, 0.75, n2))
          const inner = Math.exp(-((ac / 0.08) ** 2)) * 0.25
          const e = body * (0.09 + 0.2 * n) + glint * body * 1.2 + surf * 0.85 + foam * 1.3 + inner
          if (e > 0.003) addPixel(D, i, e * p.bright, ramp(pal, clamp01(0.35 + 0.3 * n + 0.5 * glint + 0.6 * foam + 0.3 * surf), col))
        }
        // 水珠：从浪尖上往外、往前溅出去，落一点
        eachParticle(ctx, Math.round(30 * p.count), { slot: 0.8, salt: 171, minLife: 0.5 }, (rnd, a) => {
          // 轮廓上随便一点，只在浪尖经过时看得见（跟着浪尖走的话循环首尾对不上）
          const crest = rnd(), o = pointOn(geo, crest), wc = wave(crest), show = smooth(0.55, 0.85, wc)
          if (show < 0.01) return
          const h = bw * (1.4 + 1.6 * p.reach * wc), v = (16 + rnd() * 26) * u, side = dir * (0.5 + rnd() * 0.6)
          const tx = o.ny * side, ty = -o.nx * side, pos = (x) => [o.x + o.nx * (h + v * x) + tx * v * 0.7 * x, o.y + o.ny * (h + v * x) + ty * v * 0.7 * x + 16 * u * x * x]
          const [x1, y1] = pos(a), [x0, y0] = pos(Math.max(0, a - 0.12)), kk = Math.sin(Math.PI * a) * 1.6 * show
          streak(D, x0, y0, x1, y1, 0.3 * u, (0.8 + rnd()) * u, 0, kk * p.bright, ramp(pal, 0.5, C), ramp(pal, 0.95, C2))
        })
      },
      ai: (w) => ['frame', `wavy stream of water flowing around a ${w.noun}, a band of water surging along its edge in rolling waves with white foam on the crests, splashing small droplets. ${w.NOT}`],
    },
    {
      id: 'splash', group: '水', label: '水花飞溅', hint: '水花溅起：一圈半透明的水冠往上张开、抽出水柱甩出水珠，中间弹起一根水柱', palette: 'water', lifecycle: 'once', ownEnvelope: true,
      params: [P('count', '水珠', 0, 3, 0.05, 1), P('reach', '大小', 0.3, 1.2, 0.05, 0.9), PP.width, PP.speed, PP.glow, PP.bright],
      render(ctx, t, D) {
        // 2026-10-15 用户：第一版「太假」——水冠是一圈竖线（像笼子）、水珠是小圆点
        const { geo, params: p, pal } = ctx, { W, H, u, cx, cy } = geo, q = ctx.loop ? frac(t) : t, a = q * Math.min(2.5, p.speed)
        const R = geo.Rfit * p.reach * 0.85, bx = cx, by = cy + 0.32 * R, ell = 0.3, G2 = glowLines(geo)
        const hot = ramp(pal, 1, [0, 0, 0]), mid = ramp(pal, 0.55, [0, 0, 0]), col = [0, 0, 0]
        // 水冠：半径往外张，高度先升后落；指状水柱在固定的几个角度上更高
        const rc = R * 0.42 * (1 - Math.pow(1 - clamp01(a / 0.5), 2.2)) + 2 * u, Hc = R * 0.42 * Math.sin(Math.PI * clamp01(a / 0.62)), fade = 1 - smooth(0.42, 0.75, a)
        const NF = 13, fingers = []
        for (let k = 0; k < NF; k++) fingers.push({ th: TAU * (k + 0.6 * hash(k, 1, 201)) / NF, h: 0.35 + 0.6 * hash(k, 2, 202) })
        const height = (th) => {
          let f = 0
          for (const g of fingers) { let d = th - g.th; d -= TAU * Math.round(d / TAU); f = Math.max(f, g.h * Math.exp(-((d / 0.09) ** 2))) }
          return Hc * (0.55 + 0.2 * fbm(Math.cos(th) * 2 + 3, Math.sin(th) * 2 + 3, 203, 2) + 0.8 * f)
        }
        if (Hc > 0.5 && fade > 0.003) {
          // 水冠往上张开（上口比底大）：每个像素反解它在水膜上的角度 th 和高度 v（迭代几次）
          const FL = 0.45, x0 = Math.max(0, Math.floor(bx - rc * (1 + FL) - 3 * u)), x1 = Math.min(W - 1, Math.ceil(bx + rc * (1 + FL) + 3 * u))
          const yTop = Math.max(0, Math.floor(by - rc * ell - Hc * 1.5 - 4 * u)), yBot = Math.min(H - 1, Math.ceil(by + rc * ell + 3 * u))
          for (let x = x0; x <= x1; x++) for (const side of [-1, 1]) {   // -1 = 远侧（后面那半圈），1 = 近侧
            for (let y = yTop; y <= yBot; y++) {
              let v = 0, th = 0, h = 1, baseY = by, c = 0
              for (let it = 0; it < 4; it++) {
                c = clamp((x - bx) / (rc * (1 + FL * clamp01(v))), -1, 1); th = side * Math.acos(c)
                baseY = by + rc * ell * Math.sin(th); h = height(th); v = (baseY - y) / Math.max(1, h)
              }
              if (v < -0.05 || v > 1.05 || Math.abs((x - bx) / (rc * (1 + FL * clamp01(v)))) > 1.01) continue
              const fres = Math.pow(Math.abs(c), 5)
              {
                const inS = smooth(-0.05, 0.02, v) * (1 - smooth(0.98, 1.05, v))
                // 水膜：本身很淡（透明），侧边（看过去是侧面的地方）和顶边亮，竖向流动的细纹
                const flow = fbm(th * 9 + 4, v * 3 - a * 6, 204, 3), rim = Math.exp(-(((v - 0.95) / 0.07) ** 2))
                const e = inS * (0.07 + 0.35 * fres + 0.22 * smooth(0.55, 0.8, flow)) + rim * 0.9
                const k = e * fade * (side < 0 ? 0.55 : 1)
                if (k > 0.003) addPixel(D, y * W + x, k * p.bright, ramp(pal, 0.45 + 0.5 * Math.min(1, rim + fres), col))
              }
            }
          }
          // 落点那一圈水面（压扁的椭圆亮线）
          ringPx(D, bx, by, rc * 1.05, 1.6 * u * p.width, 0.7 * fade * p.bright, mid, { sy: ell })
        }
        // 中心回弹的水柱：水冠落下时从中间弹起，顶上一颗水珠
        const jb = (a - 0.32) / 0.4
        if (jb > 0 && jb < 1) {
          // 2026-10-15 用户：「中间这个白线光很生硬」——原来是一根匀粗的亮线 + 圆点。现在是一根水：
          // 半透明、两边亮（侧面看过去的水）、根粗顶细、轻轻晃，顶上鼓一颗水滴
          const jh = R * 0.5 * Math.sin(Math.PI * jb), w0 = (7 + 4 * (1 - jb)) * u * p.width, jf = (1 - smooth(0.55, 1, jb)) * 0.8
          const yTop = Math.max(0, Math.floor(by - jh - w0 * 1.2)), yBot = Math.min(H - 1, Math.ceil(by))
          for (let y = yTop; y <= yBot; y++) {
            const v = (by - y) / Math.max(1, jh), wob = Math.sin(v * 5 + a * 18) * 1.5 * u * v
            const hw = v <= 1 ? w0 * (1 - 0.6 * v) : w0 * 0.75 * Math.sqrt(Math.max(0, 1 - ((v - 1) * jh / (w0 * 0.75)) ** 2)) * 1.0
            if (!(hw > 0.3)) continue
            for (let x = Math.max(0, Math.floor(bx - hw - 2)); x <= Math.min(W - 1, Math.ceil(bx + hw + 2)); x++) {
              const ax = Math.abs(x - bx - wob) / hw
              if (ax > 1.15) continue
              const inS = 1 - smooth(0.85, 1.12, ax), edge = Math.pow(Math.min(1, ax), 4), fl = fbm((x - bx) / (3 * u) + 3, v * 4 - a * 8, 209, 2)
              const e = inS * (0.08 + 0.5 * edge + 0.15 * smooth(0.5, 0.8, fl)) * smooth(0, 0.08, v) * jf
              if (e > 0.003) addPixel(D, y * W + x, e * p.bright, ramp(pal, 0.5 + 0.45 * edge, col))
            }
          }
        }
        // 水珠：从水柱尖上甩出去（少而大，拖影），抛物线落下
        const n = Math.round(26 * p.count), g = 2.2 * R
        for (let k = 0; k < n; k++) {
          const f = fingers[k % NF], d0 = 0.12 + 0.18 * hash(k, 3, 205), tau = a - d0
          if (!(tau > 0)) continue
          const sx = bx + Math.cos(f.th) * rc * 1.4, sy0 = by + Math.sin(f.th) * rc * ell - height(f.th) * 0.9
          const vx = Math.cos(f.th) * R * (0.5 + 0.6 * hash(k, 4, 206)), vy = -R * (0.5 + 0.7 * hash(k, 5, 207))
          const pos = (x) => [sx + vx * x, sy0 + vy * x + 0.5 * g * x * x]
          const [x1, y1] = pos(tau), [x0, y0] = pos(Math.max(0, tau - 0.05)), life = 1 - smooth(0.35, 0.6, tau), sz = (1.4 + 2 * hash(k, 6, 208)) * u * p.width
          if (life < 0.01) continue
          lineGlow(G2, geo, x0, y0, x1, y1, sz * 0.35, sz, 0.3 * life, 1.1 * life, 2.4, 0.3)
        }
        flushGlow(D, G2, hot, mid, p.bright)
        // 一层淡淡的水雾
        const mist = smooth(0.05, 0.2, a) * (1 - smooth(0.35, 0.85, a))
        if (mist > 0.003) dot(D, bx, by - Hc * 0.3, rc * 1.3 + 10 * u, 0.12 * mist * p.bright, mid)
      },
      ai: () => ['fountain', 'water splash, a translucent crown of water flaring up from the centre with fingers of water flinging droplets, then a small column of water springing back up in the middle'],
    },
    {
      id: 'frostcreep', group: '冰', label: '冰霜蔓延', hint: '冰霜从轮廓边上往里长成一片羽毛似的结晶，闪着冷光，外面冒冷气，再慢慢化掉', palette: 'ice', lifecycle: 'loop',
      params: [P('reach', '范围', 0.3, 5, 0.05, 1.2), P('count', '冰花', 0.3, 3, 0.05, 1), PP.width, P('size', '霜雾', 0, 2, 0.05, 1), P('mist', '冷气', 0, 2, 0.05, 1), PP.glow, PP.bright],
      prepare(ctx) {
        // 2026-10-15 用户：第一版「像鱼骨头」——一根直主干、两边按 60° 规律交替长侧枝。
        // 现在：主干会弯，分叉随机（角度 / 长短 / 哪一边都随机），最多四级，越分越细越碎，很多枝交叠成一片霜
        const geo = ctx.geo, { u } = geo, rnd = rng(13001), segs = [], glints = []
        const total = geo.outer.reduce((a, c) => a + c.len, 0) || 1, depth = 70 * u * ctx.params.reach
        const m = Math.max(4, Math.round((total / (38 * u)) * ctx.params.count)), budget = Math.max(60, Math.floor(7000 / m))
        let used = 0   // 每一枝冰花分到的线段数一样多（不然先长的几枝把总数用光，范围大时只有一个角有霜）
        const grow = (x, y, a, len, d0, lvl) => {
          let px = x, py = y, d = d0, turn = (rnd() - 0.5) * 0.06
          const step = (lvl ? 2.6 : 3.4) * u
          for (let l = 0; l < len && used < budget; l += step) {
            a += turn + (rnd() - 0.5) * 0.22; turn *= 0.97
            const nx = px + Math.cos(a) * step, ny = py + Math.sin(a) * step, sdn = sdAt(geo, nx, ny)
            if (sdn > -0.5 * u || -sdn > depth) break
            segs.push({ x0: px, y0: py, x1: nx, y1: ny, d0: d, d1: d + step, lvl }); used++
            const left = len - l
            if (lvl < 3 && left > 5 * u && rnd() < (lvl ? 0.26 : 0.3)) {
              const side = rnd() < 0.5 ? -1 : 1
              grow(nx, ny, a + side * (0.35 + rnd() * 0.75), left * (0.25 + rnd() * 0.45), d + step, lvl + 1)
            }
            if (lvl < 2 && rnd() < 0.05) glints.push({ x: nx, y: ny, d: d + step, ph: rnd() })
            px = nx; py = ny; d += step
          }
        }
        for (let k = 0; k < m; k++) {
          used = 0
          const o = pointOn(geo, (k + rnd()) / m), a = Math.atan2(-o.ny, -o.nx) + (rnd() - 0.5) * 1.1
          grow(o.x - o.nx * 1.5 * u, o.y - o.ny * 1.5 * u, a, depth * (0.45 + 0.75 * rnd()) / Math.max(0.3, Math.abs(Math.cos(a - Math.atan2(-o.ny, -o.nx)))), rnd() * 6 * u, 0)
        }
        let maxD = 1
        for (const g of segs) maxD = Math.max(maxD, g.d1)
        return { segs, glints, maxD, depth }
      },
      render(ctx, t, D) {
        const { geo, params: p, pal, state } = ctx, { u, sd, N, W } = geo, q = frac(t), G = glowLines(geo)
        const hot = ramp(pal, 1, [0, 0, 0]), mid = ramp(pal, 0.55, [0, 0, 0]), deep = ramp(pal, 0.3, [0, 0, 0])
        // 长（0–0.45）→ 闪着待一会 → 化掉（0.75–1）；循环首尾都是空的
        const grow = smooth(0, 0.45, q), melt = 1 - smooth(0.75, 0.98, q), F = grow * state.maxD * 1.02, here = grow * melt
        if (F > 0 && melt > 0.003) {
          for (const g of state.segs) {
            if (g.d0 > F) continue
            const f = g.d1 > F ? (F - g.d0) / (g.d1 - g.d0) : 1, x1 = g.x0 + (g.x1 - g.x0) * f, y1 = g.y0 + (g.y1 - g.y0) * f
            const w = [0.75, 0.5, 0.38, 0.3][g.lvl] * u * p.width, k = [1, 0.75, 0.55, 0.42][g.lvl] * melt * (1 + 1.1 * Math.exp(-(F - g.d1) / (6 * u)))
            lineGlow(G, geo, g.x0, g.y0, x1, y1, w, w, k, k, 3, 0.22)
          }
          flushGlow(D, G, hot, mid, p.bright)
          // 霜雾：从边往里一层白蒙蒙的霜（跟着「范围」走），里面有细碎的结晶纹
          if (p.size > 0) {
            const reach = grow * state.depth, sc = 1 / (16 * u)
            for (let i = 0; i < N; i++) {
              const s0 = sd[i]
              if (s0 > 2 * u || -s0 > reach) continue
              const x = i % W, y = (i - x) / W, n = wfbm(x * sc * 0.8 - y * sc * 0.6, x * sc * 0.6 + y * sc * 0.8, 131, 3, 0.7)
              const v = (0.35 + 0.65 * smooth(0.3, 0.75, n)) * Math.exp(s0 / (state.depth * 0.45)) * smooth(reach, reach * 0.6, -s0) * 0.2 * p.size * melt
              if (v > 0.003) addPixel(D, i, v * p.bright, mid)
            }
          }
          for (const g of state.glints) {
            if (g.d > F) continue
            const tw = Math.pow(Math.max(0, Math.sin(TAU * (q * 3 + g.ph))), 6)
            if (tw > 0.05) star(D, g.x, g.y, (0.5 + 0.4 * tw) * u * 1.6, 0.4, tw * 1.6 * melt * p.bright, hot, 4)
          }
        }
        // 冷气：轮廓外一圈淡淡的冷雾往外、往上飘（2026-10-15 用户：外轮廓也应该有冷气）；结霜时浓、化掉时淡
        if (p.mist > 0) {
          const sc = 1 / (18 * u), band = 34 * u * (0.6 + 0.4 * p.mist)
          for (let i = 0; i < N; i++) {
            const s0 = sd[i]
            if (s0 < -2 * u || s0 > band * 1.6) continue
            const x = i % W, y = (i - x) / W, at = (k) => wfbm(x * sc, y * sc + k * 1.3 - s0 * sc * 0.6, 142, 3, 0.9), n = vblend(at(t), at(t - 1), t)
            const v = smooth(0.38, 0.8, n) * Math.exp(-Math.max(0, s0) / (band * 0.45)) * smooth(-2 * u, 2 * u, s0) * 0.26 * p.mist * (0.35 + 0.65 * here)
            if (v > 0.003) addPixel(D, i, v * p.bright, ramp(pal, 0.35 + 0.3 * n, C))
          }
        }
      },
      ai: (w) => ['frame', `frost spreading over a ${w.noun}, feathery ice crystals branching inward from its edges like frost on a window, glinting, with cold mist drifting off the outline, then melting away. ${w.NOT}`],
    },
    {
      id: 'iceshards', group: '冰', label: '冰晶环绕', hint: '轮廓上长出一圈冰晶尖刺，一道反光沿着冰晶扫过去，冒着冷雾', palette: 'ice', lifecycle: 'loop',
      params: [P('count', '冰晶', 0.3, 3, 0.05, 1), P('reach', '长度', 0.3, 3, 0.05, 1), PP.width, P('laps', '反光', 1, 4, 1, 1), P('size', '冷雾', 0, 2, 0.05, 1), PP.glow, PP.bright],
      prepare(ctx) {
        const geo = ctx.geo, { u } = geo, rnd = rng(14001), total = geo.outer.reduce((a, c) => a + c.len, 0) || 1, out = []
        const m = Math.min(220, Math.max(6, Math.round((total / (13 * u)) * ctx.params.count)))
        for (let k = 0; k < m; k++) {
          const uu = (k + (rnd() - 0.5) * 0.7) / m, o = pointOn(geo, uu), big = rnd()
          const room = Math.max(4 * u, edgeAt(geo, o.x + o.nx * 4 * u, o.y + o.ny * 4 * u) * 0.85)
          const len = Math.min(room, (10 + 34 * big * big) * u * ctx.params.reach)
          out.push({ u: uu, x: o.x, y: o.y, a: Math.atan2(o.ny, o.nx) + (rnd() - 0.5) * 0.7, len, wid: len * (0.2 + 0.14 * rnd()) * ctx.params.width + 2 * u })
          if (rnd() < 0.35) { const l2 = len * (0.4 + 0.3 * rnd()); out.push({ u: uu, x: o.x, y: o.y, a: Math.atan2(o.ny, o.nx) + (rnd() < 0.5 ? -1 : 1) * (0.45 + 0.3 * rnd()), len: l2, wid: l2 * 0.28 * ctx.params.width + 1.5 * u }) }
        }
        out.sort((a, b) => b.len - a.len)   // 长的先画，短的叠在前面
        return { shards: out }
      },
      render(ctx, t, D) {
        const { geo, params: p, pal, state } = ctx, { u, sd, N, W } = geo, G = glowLines(geo), laps = Math.round(p.laps)
        const lit = ramp(pal, 0.82, [0, 0, 0]), dark = ramp(pal, 0.3, [0, 0, 0]), edge = ramp(pal, 1, [0, 0, 0]), mid = ramp(pal, 0.55, [0, 0, 0])
        const g1 = frac(t * laps), g2 = frac(t * laps + 0.5)
        for (const c of state.shards) {
          const du = (g) => { let d = Math.abs(c.u - g); return Math.min(d, 1 - d) }, gl = Math.exp(-((du(g1) / 0.05) ** 2)) + 0.6 * Math.exp(-((du(g2) / 0.05) ** 2))
          crystal(D, G, geo, c.x, c.y, c.a, c.len, c.wid, (0.75 + 0.5 * gl) * p.bright, lit, dark, edge, gl)
          if (gl > 0.4) star(D, c.x + Math.cos(c.a) * c.len * 0.9, c.y + Math.sin(c.a) * c.len * 0.9, 1.1 * u, 0.3, (gl - 0.4) * 2.2 * p.bright, edge, 4)
        }
        flushGlow(D, G, edge, mid, p.bright)
        // 冷雾：轮廓外一圈淡淡的雾往外飘
        if (p.size > 0) {
          const sc = 1 / (16 * u)
          for (let i = 0; i < N; i++) {
            const s0 = sd[i]
            if (s0 < 0 || s0 > 40 * u) continue
            const x = i % W, y = (i - x) / W, at = (k) => fbm(x * sc, y * sc + k * 1.4, 141, 3), n = vblend(at(t), at(t - 1), t)
            const v = smooth(0.45, 0.8, n) * Math.exp(-s0 / (14 * u)) * 0.2 * p.size
            if (v > 0.003) addPixel(D, i, v * p.bright, mid)
          }
        }
      },
      ai: (w) => ['frame', `ring of ice crystals around a ${w.noun}, sharp faceted icicles and crystal shards jutting out from its edge with a glint of light sweeping across them and cold mist drifting. ${w.NOT}`],
    },
    {
      id: 'iceburst', group: '冰', label: '冰爆', hint: '中心一冻，冰刺猛地向四周刺出，停一下后碎成冰碴飞散，带一阵寒雾', palette: 'ice', lifecycle: 'once', ownEnvelope: true,
      params: [P('count', '冰刺', 4, 24, 1, 12), P('reach', '范围', 0.3, 1, 0.05, 0.8), PP.width, PP.speed, PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { u, cx, cy } = geo, q = ctx.loop ? frac(t) : t, a = q * Math.min(2.5, p.speed), G = glowLines(geo)
        const lit = ramp(pal, 0.82, [0, 0, 0]), dark = ramp(pal, 0.3, [0, 0, 0]), edge = ramp(pal, 1, [0, 0, 0]), mid = ramp(pal, 0.55, [0, 0, 0])
        const R = geo.Rfit * p.reach, m = Math.round(p.count), BREAK = 0.48
        const grow = 1 - Math.pow(1 - clamp01(a / 0.1), 3)
        for (let k = 0; k < m; k++) {
          const an = TAU * (k + (hash(k, 1, 151) - 0.5) * 0.6) / m, len = R * (0.45 + 0.55 * hash(k, 2, 152)), wid = len * (0.16 + 0.1 * hash(k, 3, 153)) * p.width
          if (a < BREAK) {
            const gl = Math.exp(-(((a - 0.12 - 0.1 * hash(k, 4, 154)) / 0.04) ** 2))
            crystal(D, G, geo, cx, cy, an, len * grow, wid * grow, (0.8 + 0.6 * gl) * p.bright, lit, dark, edge, gl)
          } else {
            // 碎：每根冰刺断成 3 截，往外飞、翻、往下掉，渐淡
            const b = (a - BREAK) / 0.45, fade = 1 - smooth(0.3, 0.85, b)
            if (fade < 0.003) continue
            for (let j = 0; j < 3; j++) {
              // 飞出去 + 往下掉都收在画板里（2026-10-15 测试：碎冰掉出了画板边）
              const f0 = j / 3, f1 = (j + 1) / 3, mid0 = (f0 + f1) / 2, v = R * (0.15 + 0.25 * hash(k, j + 5, 155)) * (0.6 + mid0)
              const ox = Math.cos(an) * v * b, oy = Math.sin(an) * v * b + 0.35 * R * b * b, rot = (hash(k, j + 9, 156) - 0.5) * 4 * b
              const bx0 = cx + Math.cos(an) * len * f0, by0 = cy + Math.sin(an) * len * f0
              crystal(D, null, geo, bx0 + ox, by0 + oy, an + rot, len * (f1 - f0) * 1.05, wid * (1 - f0 * 0.8), 0.8 * fade * p.bright, lit, dark, edge)
            }
          }
        }
        flushGlow(D, G, edge, mid, p.bright)
        // 冻住的一闪 + 碎的那一下再闪 + 一圈寒雾
        dot(D, cx, cy, 0.14 * R, (1.8 * Math.exp(-a / 0.05) + 1.4 * Math.exp(-Math.abs(a - BREAK) / 0.03)) * p.bright, edge)
        const mist = smooth(0.0, 0.1, a) * (1 - smooth(0.5, 0.95, a))
        if (mist > 0.003) for (let k = 0; k < 18; k++) { const an = hash(k, 20, 157) * TAU, rr = R * (0.3 + 0.6 * hash(k, 21, 158)) * (0.5 + 0.6 * a); dot(D, cx + Math.cos(an) * rr, cy + Math.sin(an) * rr, (14 + 16 * hash(k, 22, 159)) * u, 0.1 * mist * p.bright, mid) }
      },
      ai: () => ['burst', 'ice burst, sharp crystal spikes of ice shooting out from the centre in every direction with a freezing flash, then shattering into flying ice shards and a puff of cold mist'],
    },
    // ---------------------------------------------------------------- 闪电（2026-10-15 用户：「还缺少闪电类，要做 5 个」）
    {
      id: 'strike', group: '闪电', label: '落雷', hint: '一道闪电从上方劈到形状中心，带分叉，连闪几下，落点炸出短余电', palette: 'electric', lifecycle: 'once', ownEnvelope: true,
      params: [P('count', '分叉', 0, 6, 1, 4), PP.width, P('laps', '次数', 1, 4, 1, 2), P('reach', '余电', 0, 2, 0.05, 1), { ...PP.glow, def: 1.6 }, PP.bright],
      prepare(ctx) {
        const geo = ctx.geo, { W } = geo, rnd = rng(7001), strikes = []
        for (let k = 0; k < 4; k++) strikes.push({ sx: geo.cx + (rnd() - 0.5) * 0.4 * Math.min(W, geo.R * 3), seed: 7100 + k * 97 })
        return { strikes, top: geo.margin * 1.4 + 2 * geo.u }
      },
      render(ctx, t, D) {
        const { geo, params: p, pal, state } = ctx, { u, cx, cy } = geo, q = ctx.loop ? frac(t) : t, n = Math.round(p.laps), G = glowLines(geo)
        const hot = ramp(pal, 1, [0, 0, 0]), mid = ramp(pal, 0.45, [0, 0, 0]), fr = Math.round(q * ctx.n)
        let impact = 0, impactK = -1
        for (let k = 0; k < n; k++) {
          const t0 = 0.03 + k * 0.5 / Math.max(1, n), a = (q - t0) / 0.3
          if (!(a > 0 && a < 1)) continue
          // 先导两帧长下来，然后 亮 / 灭 / 再亮，越来越弱；同一次落雷走同一条通道
          const st = state.strikes[k], grow = clamp01(a / 0.08), on = a < 0.08 ? 0.75 : hash(fr, k, 71) < 0.68 ? 1 : 0.08
          const flick = on * (0.6 + 0.4 * hash(fr, k, 73)) * Math.pow(1 - a, 1.1)
          const tree = boltTree(rng(st.seed), st.sx, state.top, cx, cy, Math.round(p.count), 0.32, 0.6)
          drawBolt(G, geo, tree, grow, (1.4 + (a < 0.25 ? 1.2 : 0)) * flick, 2.2 * u * p.width, 0.12)
          if (grow >= 1 && flick > impact) { impact = flick; impactK = k }
        }
        // 落点余电：几道短小的电弧从落点往四周炸开，每帧都换
        if (impact > 0 && p.reach > 0) {
          const rnd = rng(7400 + fr * 13), m = Math.round(3 + 4 * p.reach)
          for (let j = 0; j < m; j++) {
            const an = rnd() * TAU, L = (22 + rnd() * 50) * u * p.reach
            drawBolt(G, geo, boltTree(rnd, cx, cy, cx + Math.cos(an) * L, cy + Math.sin(an) * L, 1, 0.4, 0.35), 1, 1.3 * impact * (0.5 + 0.5 * rnd()), 1.3 * u * p.width)
          }
        }
        flushGlow(D, G, hot, mid, p.bright)
        if (impact > 0) { dot(D, cx, cy, 6 * u * p.width, 2.4 * impact * p.bright, hot); dot(D, cx, cy, 26 * u, 0.4 * impact * p.bright, mid) }
      },
      ai: () => ['pillar', 'lightning strike, a jagged branching bolt cracking down from above onto the centre, flashing a few times, with short sparks of electricity bursting where it hits']
    },
    {
      id: 'plasma', group: '闪电', label: '电球', hint: '中心一团电光，几条电丝扭着伸向四周，一闪一闪', palette: 'violet', lifecycle: 'loop',
      params: [P('reach', '大小', 0.3, 1.5, 0.05, 1), P('count', '电丝', 2, 14, 1, 7), PP.width, P('laps', '摆动', 1, 4, 1, 1), { ...PP.glow, def: 1.5 }, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { u, cx, cy } = geo, G = glowLines(geo), q = frac(t), fr = Math.round(q * ctx.n) % ctx.n
        const Rf = fitR(geo, Math.max(geo.R, geo.Rb) * 0.95 * p.reach, 1.08), m = Math.round(p.count), laps = Math.round(p.laps)
        const hot = ramp(pal, 1, [0, 0, 0]), mid = ramp(pal, 0.55, [0, 0, 0])
        for (let k = 0; k < m; k++) {
          // 电丝的端点绕着慢慢转（整圈 × 转速，首尾接上），半径和亮度一闪一闪
          const ph = hash(k, 3, 81), ang = TAU * (k / m + ph * 0.3) + 0.55 * Math.sin(TAU * (t * laps + ph)) + 0.25 * Math.sin(TAU * (2 * t * laps + ph * 3))
          const r1 = Rf * (0.8 + 0.18 * hash(fr, k, 82)), ex = cx + Math.cos(ang) * r1, ey = cy + Math.sin(ang) * r1
          const rnd = rng(8100 + k * 131 + fr * 17), tree = boltTree(rnd, cx, cy, ex, ey, rnd() < 0.6 ? 1 : 0, 0.22, 0.3)
          const fl = hash(fr, k, 84) < 0.12 ? 0.1 : 0.55 + 0.45 * hash(fr, k, 83)
          drawBolt(G, geo, tree, 1, 1.3 * fl, 1.5 * u * p.width)
          dot(D, ex, ey, 2.4 * u * p.width, 1.4 * fl * p.bright, hot)
        }
        flushGlow(D, G, hot, mid, p.bright)
        const pulse = 0.85 + 0.15 * Math.sin(TAU * t * 3)
        dot(D, cx, cy, 0.09 * Rf, 2.4 * pulse * p.bright, hot)
        dot(D, cx, cy, 0.3 * Rf, 0.55 * pulse * p.bright, mid)
      },
      ai: () => ['blob', 'plasma ball, a bright crackling core with several writhing filaments of electricity reaching out in all directions, flickering'],
    },
    {
      id: 'arcs', group: '闪电', label: '电弧跳跃', hint: '电弧在轮廓上两点之间来回跳，跳一下换个位置，端点冒火花', palette: 'cyan', lifecycle: 'loop',
      params: [P('count', '电弧', 1, 8, 1, 3), PP.width, P('reach', '跨度', 0.08, 0.5, 0.01, 0.25), P('laps', '频率', 1, 6, 1, 2), { ...PP.glow, def: 1.5 }, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { u, sd, N } = geo, G = glowLines(geo), q = frac(t), fr = Math.round(q * ctx.n) % ctx.n
        const hot = ramp(pal, 1, [0, 0, 0]), mid = ramp(pal, 0.55, [0, 0, 0]), m = Math.round(p.count), hold = Math.max(2, Math.round(8 / Math.round(p.laps)))
        // 轮廓上一层很淡的电光
        for (let i = 0; i < N; i++) { const s0 = sd[i]; if (Math.abs(s0) < 4 * u) addPixel(D, i, Math.exp(-((s0 / (1.4 * u)) ** 2)) * 0.18 * p.bright, mid) }
        for (let k = 0; k < m; k++) {
          // 每条电弧每 hold 帧换一个位置（错开），这段时间里每两帧抖一下形状，亮一下就渐暗
          const off = Math.floor(hash(k, 5, 91) * hold), b = Math.floor((fr + off) / hold), inB = ((fr + off) % hold) / hold
          const u1 = hash(b, k, 92), u2 = u1 + p.reach * (0.7 + 0.6 * hash(b, k, 93)) * (hash(b, k, 94) < 0.5 ? 1 : -1)
          const A = pointOn(geo, u1), B = pointOn(geo, u2)
          const tree = boltTree(rng(9100 + k * 131 + b * 17 + fr * 3), A.x, A.y, B.x, B.y, 1, 0.3, 0.3)
          const fl = (1 - 0.7 * inB) * (0.6 + 0.4 * hash(fr, k, 95))
          drawBolt(G, geo, tree, 1, 1.5 * fl, 1.6 * u * p.width)
          dot(D, A.x, A.y, 3 * u * p.width, 1.6 * fl * p.bright, hot); dot(D, B.x, B.y, 3 * u * p.width, 1.6 * fl * p.bright, hot)
        }
        flushGlow(D, G, hot, mid, p.bright)
      },
      ai: (w) => ['frame', `electric arcs on a ${w.noun}, jagged arcs of lightning jumping between points along its edge, flickering and hopping to new places, sparking at their ends. ${w.NOT}`],
    },
    {
      id: 'thunderburst', group: '闪电', label: '雷暴爆发', hint: '中心一闪，一圈带分叉的闪电向四周炸开，闪几下后散掉', palette: 'electric', lifecycle: 'once', ownEnvelope: true,
      params: [P('count', '闪电', 4, 20, 1, 9), PP.width, P('reach', '范围', 0.3, 1, 0.05, 0.9), PP.speed, { ...PP.glow, def: 1.5 }, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { u, cx, cy } = geo, G = glowLines(geo), q = ctx.loop ? frac(t) : t, a = q * Math.min(2.5, p.speed), fr = Math.round(q * ctx.n)
        const hot = ramp(pal, 1, [0, 0, 0]), mid = ramp(pal, 0.55, [0, 0, 0]), m = Math.round(p.count), R = geo.Rfit * p.reach
        for (let k = 0; k < m; k++) {
          const d0 = 0.02 + hash(k, 1, 101) * 0.08, age = (a - d0) / 0.5
          if (!(age > 0 && age < 1)) continue
          const ang = TAU * (k + (hash(k, 2, 102) - 0.5) * 0.7) / m, L = R * (0.6 + 0.4 * hash(k, 3, 103))
          const tree = boltTree(rng(10100 + k * 131 + fr * 7), cx + Math.cos(ang) * 6 * u, cy + Math.sin(ang) * 6 * u, cx + Math.cos(ang) * L, cy + Math.sin(ang) * L, 2, 0.26, 0.4)
          const grow = clamp01(age / 0.2), fl = (0.5 + 0.5 * hash(fr, k, 104)) * Math.pow(1 - age, 1.3)
          drawBolt(G, geo, tree, grow, 1.7 * fl, 1.8 * u * p.width)
        }
        flushGlow(D, G, hot, mid, p.bright)
        const fl0 = Math.exp(-Math.max(0, a - 0.02) / 0.06)
        dot(D, cx, cy, 0.12 * R, 2.6 * fl0 * p.bright, hot)
        dot(D, cx, cy, 0.4 * R, 0.6 * fl0 * p.bright, mid)
      },
      ai: () => ['burst', 'lightning burst, a bright flash at the centre and a ring of jagged branching lightning bolts blasting outward in every direction, flickering and fading'],
    },
    {
      id: 'thundercharge', group: '闪电', label: '雷电充能', hint: '四周的电弧一条条劈向中心，核心越聚越亮，最后猛地一闪放出去', palette: 'ice', lifecycle: 'once', ownEnvelope: true,
      params: [P('count', '电弧', 2, 12, 1, 6), PP.width, P('reach', '范围', 0.3, 1, 0.05, 0.85), PP.speed, { ...PP.glow, def: 1.5 }, PP.bright],
      render(ctx, t, D) {
        const { geo, params: p, pal } = ctx, { u, cx, cy } = geo, G = glowLines(geo), q = ctx.loop ? frac(t) : t, a = q * Math.min(2.5, p.speed), fr = Math.round(q * ctx.n)
        const hot = ramp(pal, 1, [0, 0, 0]), mid = ramp(pal, 0.55, [0, 0, 0]), m = Math.round(p.count), R = geo.Rfit * p.reach, REL = 0.7
        // 充能：电弧一条接一条从外圈劈向中心（越到后面越密），每条亮一下就灭
        if (a < REL) for (let k = 0; k < m * 4; k++) {
          const t0 = (k / (m * 4)) * (REL - 0.1) * (0.55 + 0.45 * k / (m * 4)), age = (a - t0) / 0.16
          if (!(age > 0 && age < 1)) continue
          const ang = TAU * hash(k, 1, 111), r0 = R * (0.75 + 0.25 * hash(k, 2, 112))
          const tree = boltTree(rng(11100 + k * 131 + fr * 7), cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0, cx, cy, 1, 0.26, 0.3)
          drawBolt(G, geo, tree, clamp01(age / 0.3), 1.5 * (1 - age) * (0.6 + 0.4 * hash(fr, k, 113)), 1.5 * u * p.width)
        }
        // 放出去：一闪 + 一圈短闪电向外
        const rel = (a - REL) / 0.3
        if (rel > 0 && rel < 1) for (let k = 0; k < m; k++) {
          const ang = TAU * (k + 0.5 * hash(k, 3, 114)) / m, L = R * (0.5 + 0.4 * hash(k, 4, 115))
          const tree = boltTree(rng(11500 + k * 131 + fr * 7), cx, cy, cx + Math.cos(ang) * L, cy + Math.sin(ang) * L, 1, 0.26, 0.35)
          drawBolt(G, geo, tree, clamp01(rel / 0.25), 1.8 * Math.pow(1 - rel, 1.5), 1.8 * u * p.width)
        }
        flushGlow(D, G, hot, mid, p.bright)
        const core = smooth(0, REL, a) * (a < REL ? 1 : Math.exp(-(a - REL) / 0.08)), flash = a > REL ? Math.exp(-(a - REL) / 0.05) : 0
        dot(D, cx, cy, (0.025 + 0.03 * core) * R, (0.6 + 2.2 * core + 2.5 * flash) * p.bright, hot)
        dot(D, cx, cy, (0.12 + 0.06 * core + 0.25 * flash) * R, (0.35 * core + 0.6 * flash) * p.bright, mid)
      },
      ai: () => ['converge', 'charging lightning, jagged arcs of electricity striking inward from all around into a glowing core that grows brighter, then releases in a sharp flash'],
    },
  ]

  // 2026-10-17: the ten user-selected ORIGINAL previews, shared by 模板制作 and 动画/特效扫光.
  // A small polar field retains the preview's soft analytic rays without a GPU dependency in
  // export Workers. Geometry and interpolation indices are cached once, not per frame.
  function prepareHoly(ctx) {
    const g = ctx.geo, half = Math.min(g.W, g.H) / 2
    if (g.derived && g.derived.holy) {
      const s = g.derived.holy
      return { ...s, field: new Float32Array(s.A * (s.B + 1)) }
    }
    const A = Math.max(256, Math.min(1024, 2 ** Math.ceil(Math.log2(Math.min(g.W, g.H) * 2))))
    const B = Math.max(40, Math.min(112, Math.ceil(Math.min(g.W, g.H) / 5)))
    const boundary = new Float32Array(A)
    for (let k = 0; k < A; k++) {
      const angle = k / A * TAU, dx = Math.cos(angle), dy = -Math.sin(angle)
      let radius = 0
      for (const c of g.outer) for (let j = 0; j < c.x.length; j++) {
        const n = (j + 1) % c.x.length, ex = c.x[n] - c.x[j], ey = c.y[n] - c.y[j], den = dx * ey - dy * ex
        if (Math.abs(den) < 1e-8) continue
        const px = c.x[j] - g.cx, py = c.y[j] - g.cy, r = (px * ey - py * ex) / den, u = (px * dy - py * dx) / den
        if (r > radius && u >= 0 && u <= 1) radius = r
      }
      boundary[k] = radius / half
    }
    const ai = new Int32Array(g.N), aw = new Float32Array(g.N), bi = new Int32Array(g.N), bw = new Float32Array(g.N), mask = new Float32Array(g.N)
    for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
      const i = y * g.W + x, px = (x + .5 - g.cx) / half, py = (g.cy - y - .5) / half, radius = Math.hypot(px, py)
      const angle = frac(Math.atan2(py, px) / TAU) * A, a0 = Math.floor(angle), af = angle - a0
      const edge = lerp(boundary[a0], boundary[(a0 + 1) % A], af), depth = clamp((radius - edge) / 1.5 * B, 0, B - 1e-5)
      ai[i] = a0; aw[i] = af; bi[i] = Math.floor(depth); bw[i] = depth - bi[i]
      mask[i] = smooth(-.006, .014, g.sd[i] / half) * (1 - smooth(.86, .99, radius))
    }
    const prepared = { A, B, ai, aw, bi, bw, mask }
    if (g.derived) g.derived.holy = prepared
    return { ...prepared, field: new Float32Array(A * (B + 1)) }
  }
  const holyHash = (x) => frac(Math.sin(x * 127.1 + 311.7) * 43758.5453)
  const holyGaussian = (x, width) => Math.exp(-((x / Math.max(.0001, width)) ** 2))
  const holyWrap = (x) => x - TAU * Math.floor((x + Math.PI) / TAU)
  function renderHoly(kind, ctx, t, D) {
    const { params: p, state: s, project } = ctx, { A, B, field } = s
    const phase = frac(t) * TAU, dir = project.direction === 'cw' ? -1 : 1, clock = phase * Math.round(p.laps), turn = clock * dir
    const flicker = phase * Math.round(p.flicker), width = p.width, reach = p.reach, glow = p.glow
    const definitions = {
      rotate: [[p.count, turn, .018, .36, .82, .009, 1.7], [Math.max(3, Math.round(p.count * 11 / 29)), turn, .07, .34, .8, .012, .34 * glow], [p.count, turn, .005, .40, .82, .009, .48]],
      fan: [[p.count, turn, .019, .44, .75, .008, 2.1], [Math.max(3, Math.round(p.count * 27 / 39)), -turn, .03, .34, .65, .01, 1.65]],
      breathe: [[p.count, .18 * Math.sin(turn), .075, 1, .85, .022, 1.25], [Math.max(3, Math.round(p.count * 7 / 9)), .18 * Math.sin(turn), .155, .74, .5, .018, .63 * glow], [Math.max(3, Math.round(p.count * 21 / 9)), .18 * Math.sin(turn), .011, 1.15, .9, .008, .39]],
      meteor: [[p.count, turn, .015, .50, .7, .01, 1]],
      crown: [[p.count, .05 * Math.sin(turn), .013, 1, .85, .012, 1], [Math.max(3, Math.round(p.count * 17 / 52)), .05 * Math.sin(turn), .052, .8, .7, .012, .25]],
      layers: [[p.count, turn, .06, .20, .95, .016, .9], [Math.max(3, Math.round(p.count * 34 / 14)), -turn, .012, .49, .8, .006, 1.2], [Math.max(3, Math.round(p.count * 9 / 14)), turn, .13, .23, .7, .02, .4 * glow]],
      iris: [[p.count, turn, 1, 1, .62, .006, 1], [p.count, turn, 1.9, .30, .62, .006, .33 * glow], [Math.max(3, Math.round(p.count * 33 / 17)), -turn, .009, .28, .8, .006, 1]],
    }[kind]
    const bands = definitions.map(([count, rotation, w, length, jitter, drift, strength]) => {
      count = Math.round(count)
      const rays = Array.from({ length: count }, (_, seed) => {
        const h = holyHash(seed + 4.7), h2 = holyHash(seed + 72.3)
        return { a: (seed + .5 + jitter * (h - .5)) * TAU / count, length: (.4 + .75 * h2) * (.79 + .21 * Math.sin(flicker * (1 + Math.floor(h * 3)) + seed)), energy: (.4 + .6 * h) * (.62 + .38 * Math.sin(flicker * (1 + Math.floor(h2 * 3)) + seed * 4.1)), seed }
      })
      return { count, rotation, w, length, drift, strength, rays }
    })
    for (let k = 0; k < A; k++) {
      const a = k / A * TAU
      const open = .5 + .5 * Math.sin(flicker), breathLength = .14 + .35 * (.5 + .5 * Math.sin(flicker))
      const crown = (.5 + .5 * Math.sin(a * 5 - clock + Math.sin(a * 3 + phase) * .5)) ** 2
      const fanA = holyGaussian(holyWrap(a - turn), .55) + holyGaussian(holyWrap(a - turn - Math.PI), .55)
      const fanB = holyGaussian(holyWrap(a + turn - 1.6), .4) + holyGaussian(holyWrap(a + turn - 1.6 - Math.PI), .4)
      const sweep = ((1 + Math.cos(a - turn)) / 2) ** 16, tail = ((1 + Math.cos(a - turn + .55)) / 2) ** 5, sweep2 = ((1 + Math.cos(a - turn - Math.PI)) / 2) ** 24
      // Only the nearest three rays can contribute to a sample. Resolve them per angle.
      const samples = bands.map((band) => {
        const cell = Math.floor((a - band.rotation) / TAU * band.count)
        return [-1, 0, 1].map((j) => {
          const id = cell + j, seed = ((id % band.count) + band.count) % band.count, ray = band.rays[seed]
          return { ray, delta: a - band.rotation - (ray.a + (id - seed) * TAU / band.count) }
        })
      })
      for (let b = 0; b <= B; b++) {
        const d = b / B * 1.5
        let energy = 0
        for (let j = 0; j < bands.length; j++) {
          const band = bands[j]
          let w = band.w * width, length = band.length * reach, strength = band.strength
          if (kind === 'breathe') length *= breathLength
          if (kind === 'fan') strength *= j === 0 ? fanA : fanB
          if (kind === 'meteor') strength *= tail * .9 + sweep * 3.6 + sweep2 * 2.8
          if (kind === 'crown') { length *= .16 + .26 * crown; strength *= j === 0 ? .38 + 1.7 * crown : crown }
          if (kind === 'iris') {
            if (j < 2) w *= .008 + .07 * open
            if (j === 0) { length *= .49 - .18 * open; strength *= 1.25 - .3 * open }
            if (j === 2) strength *= open * .45
          }
          for (const { ray, delta } of samples[j]) {
            const shift = band.drift * Math.sin(phase + ray.seed * 2.3 + d * 2.6)
            const angular = holyGaussian(delta + shift, w * (1 + d * .9))
            if (angular < .0001) continue
            energy += angular * Math.exp(-((d / Math.max(.03, length * ray.length)) ** 1.65)) * ray.energy * strength
          }
        }
        if (kind === 'fan') energy += (fanA * .26 + fanB * .18) * Math.exp(-d * 5) * glow
        if (kind === 'meteor') energy += (sweep + sweep2) * (.85 * Math.exp(-d * 9) * glow + 1.8 * Math.exp(-d * 54))
        if (kind === 'crown') energy += Math.exp(-d / (.06 + .12 * crown)) * (.13 + .24 * crown) * glow
        energy += Math.exp(-d * 54) * (.06 + .10 * (.5 + .25 * Math.sin(a * 3 - phase) + .15 * Math.sin(a * 7 + phase * 2) + .1 * Math.sin(a * 11 - phase))) * glow
        field[k * (B + 1) + b] = energy
      }
    }
    const tint = project.colour && project.colour.mode === 'white' ? [.82, .88, 1] : project.colour && project.colour.mode === 'custom' ? ctx.pal.mid : [1, .52, .105]
    const hot = project.colour && ['white', 'custom'].includes(project.colour.mode) ? tint.map((v) => .8 + .2 * v) : [1, .94, .79]
    for (let i = 0; i < s.mask.length; i++) {
      if (s.mask[i] < .0001) continue
      const a0 = s.ai[i], a1 = (a0 + 1) % A, b = s.bi[i], q0 = a0 * (B + 1) + b, q1 = a1 * (B + 1) + b
      const energy = lerp(lerp(field[q0], field[q0 + 1], s.bw[i]), lerp(field[q1], field[q1 + 1], s.bw[i]), s.aw[i]) * s.mask[i] * p.bright
      const heat = Math.max(0, energy - .28) ** 1.8 * .76
      D.R[i] = (1 - Math.exp(-(tint[0] * energy * 1.35 + hot[0] * heat) * 1.35)) ** .84
      D.G[i] = (1 - Math.exp(-(tint[1] * energy * 1.35 + hot[1] * heat) * 1.35)) ** .84
      D.B[i] = (1 - Math.exp(-(tint[2] * energy * 1.35 + hot[2] * heat) * 1.35)) ** .84
    }
  }
  const HOLY_RAYS = [
    ['holy-iris', '虹膜开合', 'iris', 17], ['holy-breathe', '呼吸霞光', 'breathe', 9],
    ['holy-layers', '双层天幕', 'layers', 14], ['holy-crown', '涌动光冠', 'crown', 52],
    ['holy-meteor', '流星放射', 'meteor', 41], ['holy-rotate', '旋转圣光', 'rotate', 29],
    ['holy-fans', '交错光扇', 'fan', 39],
  ].map(([id, label, type, count]) => ({
    id, label, group: '环绕光效', palette: 'gold', lifecycle: 'loop', displayMapped: true,
    hint: '沿轮廓环绕的柔和放射光，数量、宽度、长度、圈数、明暗变化、光晕和亮度可调',
    params: [P('count', '光束数量', 4, 80, 1, count), P('width', '光束宽度', .3, 3, .05, 1), P('reach', '光束长度', .3, 3, .05, 1), P('laps', '环绕圈数', 1, 6, 1, 1), P('flicker', '明暗变化', 1, 6, 1, 2), PP.glow, PP.bright],
    prepare: prepareHoly, render: (ctx, t, D) => renderHoly(type, ctx, t, D),
    ai: (w) => ['rays', `soft holy light rays orbiting the ${w.noun}, beams of varied widths and lengths, bright fine cores and soft halos, empty centre, ${type} motion`],
  }))
  LIST.push(...HOLY_RAYS,
    {
      id: 'holy-aurora', label: '极光冠冕', group: '环绕光效', palette: 'gold', lifecycle: 'loop', retired: true,
      hint: '柔软丝状光幕沿轮廓起伏，波峰持续环绕',
      params: [P('count', '光丝数量', 32, 320, 1, 200), PP.width, P('reach', '光幕高度', .3, 3, .05, 1), P('laps', '环绕圈数', 1, 6, 1, 1), PP.glow, PP.bright],
      prepare: (ctx) => ({ T: outlineParam(ctx.geo) }),
      render(ctx, t, D) {
        const { geo: g, params: p, state, pal } = ctx, phase = TAU * frac(t), turn = phase * p.laps * (ctx.project.direction === 'cw' ? -1 : 1)
        const scale = Math.min(g.W, g.H) / 500, hot = pal.hot, mid = pal.mid
        for (let i = 0; i < g.N; i++) {
          const d = Math.max(0, g.sd[i]) / scale, u = state.T[i]
          const crest = .5 + .5 * Math.sin(TAU * u * 5 - turn * 2 + Math.sin(TAU * u * 3 + phase))
          const height = Math.max(7, (20 + 67 * crest * crest + 13 * Math.sin(TAU * u * 9 + phase)) * p.reach)
          const thread = (.5 + .5 * Math.cos(TAU * u * p.count + d * .045 * Math.sin(turn))) ** (4 / p.width)
          const envelope = Math.exp(-((d / height) ** 1.7)) * smooth(-1, 2, g.sd[i] / scale)
          const energy = envelope * (.13 + .42 * thread) * p.bright
          addPixel(D, i, energy, mid)
          addPixel(D, i, Math.exp(-((d / (2.8 * p.width)) ** 2)) * (.1 + .18 * crest) * p.bright * smooth(-1, 2, g.sd[i] / scale), hot)
        }
      },
      ai: (w) => ['rays', `a soft silky aurora curtain flowing around the outside of a ${w.noun}, fine shimmering filaments rising and falling in travelling waves`],
    },
    {
      id: 'holy-twin', label: '双流交辉', group: '环绕光效', palette: 'gold', lifecycle: 'loop',
      hint: '两道长尾光流反向沿轮廓游走，交汇自然提亮',
      params: [P('count', '光流数量', 1, 8, 1, 2), PP.width, P('trail', '拖尾长度', .1, .8, .01, .46), P('laps', '环绕圈数', 1, 6, 1, 1), PP.glow, PP.bright],
      render(ctx, t, D) {
        const { geo: g, params: p, pal } = ctx, unit = Math.min(g.W, g.H) / 500
        const phase = frac(t) * p.laps * (ctx.project.direction === 'cw' ? -1 : 1), G = glowLines(g)
        for (let k = 0; k < p.count; k++) {
          const dir = k % 2 ? -1 : 1, head = phase * dir + k / p.count + (k % 2 ? .05 : 0), offset = (4 + (k % 2) * 7) * unit
          let prev = null
          for (let j = 0; j <= 90; j++) {
            const z = j / 90, u = head - dir * p.trail * (1 - z), q = FXM().pointOnOutline(g, u), sway = 2 * unit * Math.sin(TAU * u * 5 - TAU * frac(t))
            const now = [q.x + q.nx * (offset + sway), q.y + q.ny * (offset + sway)]
            if (prev) lineGlow(G, g, ...prev, ...now, 1.8 * unit * p.width, 1.8 * unit * p.width, z ** 2.2 * p.bright, z ** 2.2 * p.bright, 4.2, .24)
            prev = now
          }
          const q = FXM().pointOnOutline(g, head), x = q.x + q.nx * offset, y = q.y + q.ny * offset
          dot(D, x, y, 7 * unit * p.width, .6 * p.bright, pal.mid)
          star(D, x, y, 1.1 * unit * p.width, 0, .65 * p.bright, pal.hot)
        }
        flushGlow(D, G, pal.hot, pal.mid)
      },
      ai: (w) => ['frame', `two bright light streams with long fading tails running in opposite directions around a ${w.noun}, glowing softly where they meet`],
    },
    {
      id: 'holy-tide', label: '脉冲光潮', group: '环绕光效', palette: 'gold', lifecycle: 'loop',
      hint: '轮廓光波层层外放，亮区环绕推进',
      params: [P('count', '光波层数', 1, 8, 1, 4), PP.width, P('reach', '扩散距离', .3, 3, .05, 1), P('laps', '脉冲次数', 1, 6, 1, 2), PP.glow, PP.bright],
      prepare: (ctx) => ({ T: outlineParam(ctx.geo) }),
      render(ctx, t, D) {
        const { geo: g, params: p, state, pal } = ctx, unit = Math.min(g.W, g.H) / 500
        const phase = frac(t) * (ctx.project.direction === 'cw' ? -1 : 1)
        for (let i = 0; i < g.N; i++) {
          const d = g.sd[i] / unit
          if (d < -3) continue
          const pulse = .16 + .84 * ((1 + Math.cos(TAU * (state.T[i] - phase))) / 2) ** 5
          let energy = 0
          for (let k = 0; k < p.count; k++) {
            const age = frac(frac(t) * p.laps + k / p.count), offset = age * 78 * p.reach, envelope = Math.sin(age * Math.PI) ** 1.5
            energy += holyGaussian(d - offset, 1.1 * p.width) * envelope * pulse * .8
            energy += holyGaussian(d - offset, 4.4 * p.width) * envelope * pulse * .16
          }
          addPixel(D, i, energy * p.bright, pal.hot)
        }
        // Keep the original moving bright tail and short rays between the expanding waves.
        const G = glowLines(g)
        let previous = null
        for (let j = 0; j <= 64; j++) {
          const z = j / 64, u = phase - .35 * (1 - z), q = FXM().pointOnOutline(g, u)
          const now = [q.x + q.nx * 3 * unit, q.y + q.ny * 3 * unit]
          if (previous) lineGlow(G, g, ...previous, ...now, 1.5 * unit * p.width, 1.5 * unit * p.width, z ** 2.2 * .9 * p.bright, z ** 2.2 * .9 * p.bright, 4, .2)
          previous = now
        }
        for (let j = 0; j < 24; j++) {
          const q = FXM().pointOnOutline(g, j / 24), dx = q.x - g.cx, dy = q.y - g.cy, radius = Math.hypot(dx, dy) || 1
          const length = (24 + 40 * (.5 + .5 * Math.sin(TAU * (frac(t) * 2 - j / 24)))) * p.reach * unit
          streak(D, q.x, q.y, q.x + dx / radius * length, q.y + dy / radius * length, 1.2 * unit * p.width, 2.5 * unit * p.width, .12 * p.bright, 0, pal.mid, pal.mid)
        }
        flushGlow(D, G, pal.hot, pal.mid)
      },
      ai: (w) => ['rays', `several waves of light expanding outward from a ${w.noun}, a bright area travelling around the waves, soft glowing contours fading out`],
    })
  for (const e of LIST) {
    if (HOLY_RAYS.includes(e) || ['godrays', 'aura'].includes(e.id)) e.group = '光晕放射'
    if (e.id === 'holy-twin') e.group = '轮廓流光'
    if (e.id === 'holy-tide') e.group = '扩散'
  }
  const GROUP_ORDER = ['轮廓流光', '技能', '光晕放射', '法阵', '闪电', '烟雾', '水', '冰', '扩散', '爆炸', '消失', '破碎']
  const ALL = LIST.slice().sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
  // 粒子类（自己管出场 / 收场，一次性结尾清空）
  const OVERLAY = ['fireworks', 'charge', 'sparkspread']
  const DIRS = ['vortex', 'orb', 'swirl', 'slash', 'charge', 'runeA', 'runeB']
  // 不跟轮廓走、只看形状中心和大小的（2026-10-15 用户：「很多效果不需要轮廓，没必要显示轮廓」）——编辑器里只给一个位置框
  const CENTERED = ['orb', 'swirl', 'slash', 'charge', 'fireball', 'runeA', 'runeB', 'runeC', 'vortex', 'fireworks', 'wave', 'sparkspread', 'rburst', 'firebomb', 'strike', 'plasma', 'thunderburst', 'thundercharge', 'smokerise', 'ripple', 'splash', 'iceburst']
  for (const e of ALL) {
    e.kind = 'lib'
    // 事件类（自己管出场 / 收场的一次性效果）：切成循环 = 重复播放，从空画面直接开始
    e.event = !!e.ownEnvelope && e.id !== 'sparkspread'   // 光点扩散循环时是连续发射，本来就首尾相接
    e.particle = OVERLAY.includes(e.id)
    e.centered = CENTERED.includes(e.id)
    e.inert = e.inert || {}
    if (e.id === 'shatter') { e.inert.trail = '这个效果没有拖尾'; e.inert.size = '碎块大小跟着「碎块」数量变' }
    if (!e.emit) e.inert.emit = '这个效果的发射位置是固定的'
    if (!DIRS.includes(e.id) && !e.id.startsWith('holy-')) e.inert.direction = '这个效果没有方向'
    e.inert.start = '没有起点'
  }

  /** 一层效果的能量（HDR 三通道）。ctx 由核心给：geo / params / loop / n / project / pal / palOf / state。 */
  function renderInto(ctx, t, D) {
    ctx.t = t
    if (ctx.params.bright == null) ctx.params.bright = 1
    ctx.params.bright0 = ctx.params.bright
    ctx.fx.render(ctx, t, D)
  }
  function palettes(project, fx) {
    const mode = project.colour && project.colour.mode
    if (mode === 'white') return { pal: PAL.white, palOf: () => PAL.white }
    if (mode === 'custom') { const pal = palFromHex(project.colour.value); return { pal, palOf: () => pal } }
    if (fx.palette === 'multi') return { pal: PAL.gold, palOf: (i) => MULTI[i % MULTI.length] }
    const pal = PAL[fx.palette] || PAL.white
    return { pal, palOf: () => pal }
  }

  FXM().registerLibrary({ effects: ALL, renderInto, palettes, outlineParam })
})(typeof self !== 'undefined' ? self : globalThis)
