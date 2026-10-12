// 序列扫光 生成核心：底图 → 一组扫光切片（透明 PNG 帧）。
// 纯 Float32Array 计算，不碰 DOM。经典脚本：页面里 <script> 直接加载，Worker 里 importScripts，
// 都挂到 globalThis.NovaFlowSweepLight；Node 测试用 vm 跑同一份。
//
// 用法：
//   const ctx = analyzeBase(rgba, w, h, params)        // 一次分析（亮度、局部色、轮廓、法线、亮点…）
//   const frame = renderSweepFrame(ctx, p, params)      // 进度 p∈[0,1] 的一帧 → { data: Uint8ClampedArray RGBA, w, h }
//   generateSweepSequence(rgba, w, h, params, onProgress) // 整组帧
//
// 帧的内容由 叠加模式 决定：
//   add    叠加：帧 = 字内已按底图做过滤色的光 + 字外发光，插槽用 叠加 混合 → 和演示一模一样
//   screen 滤色：帧 = 原始光（未与底图相乘），插槽用 滤色 混合，GPU 自己做 (1 - dst) 这一步
//   normal 正常：帧 = 底图 + 光 的完整合成图，插槽用 正常 混合

;(function (root) {
  'use strict'

// sigma = 光带宽度（进度单位，宽度 1 时）、span = 整段扫光走过的进度长度：帧数少到相邻两帧的光带
// 错开超过光带宽度时，交叉淡入淡出会一步一暗（闪），所以每个方案的默认帧数按它的光带定，
// 生成时还会把光带加宽到不闪（见 effectiveWidth）。
const SWEEP_SCHEMES = [
  { id: 'base', label: '底图流光', group: '线性扫光', hint: '光带内底图提亮，字外柔和发光', sigma: 0.10, span: 1.4, frames: 24 },
  { id: 'metal-highlight', label: '金属高光', group: '线性扫光', hint: '窄锐利高光，亮部先亮，底图色光晕', sigma: 0.03, span: 1.4, frames: 32 },
  { id: 'gold', label: '流金扫光', group: '线性扫光', hint: '光带内转成指定色调（默认金色）', color: '#ffd173', colorMode: 'custom', sigma: 0.10, span: 1.4, frames: 24 },
  { id: 'metal-reflect', label: '金属反光', group: '形态驱动', hint: '按图上明暗算凹凸，朝光的凸面闪', sigma: 0.22, span: 1.4, frames: 16 },
  { id: 'rim', label: '边缘流光', group: '形态驱动', hint: '光带只点亮轮廓，轮廓外溢一圈光晕', sigma: 0.14, span: 1.4, frames: 24 },
  { id: 'outline', label: '底图色描光', group: '形态驱动', hint: '一段彩光沿外框四周跑一圈（左上起顺时针）', radial: true, wrap: true, sigma: 0.045, span: 1, frames: 36 },
  { id: 'sparkle', label: '星芒闪烁', group: '局部高光', hint: '光带扫过时亮点处冒小闪点，错开闪', sigma: 0.08, span: 1.4, frames: 24 },
  { id: 'hotspot', label: '高光点扫光', group: '局部高光', hint: '只有图上原有的高光区亮起来', sigma: 0.13, span: 1.5, frames: 24 },
  { id: 'ring', label: '环形扩散', group: '径向', hint: '光环从中心向外扩散', radial: true, sigma: 0.05, span: 1.35, frames: 32 },
  { id: 'rays', label: '放射光芒', group: '径向', hint: '光带扫到的部分向外放射光线', padRatio: 0.24, sigma: 0.09, span: 1.5, frames: 24 },
]

/** 相邻两帧的光带错开多少（进度单位）。 */
function stepOf(scheme, n) { return (scheme.span || 1) / Math.max(1, scheme.wrap ? n : n - 1) }
/**
 * 不闪的光带宽度倍率：交叉淡入淡出到一半时光带中心至少还有 92% 亮度 ⇔ sigma ≥ 1.7 × 步长。
 * 用户给的宽度够宽就用用户的，不够就加宽到这个下限。
 */
function effectiveWidth(params) {
  const scheme = SWEEP_SCHEMES.find((x) => x.id === params.scheme) || SWEEP_SCHEMES[0]
  const n = Math.max(2, Math.min(240, Math.round(Number(params.frames) || 12)))
  const wk = Math.max(0.2, Number(params.width) || 1)
  const floor = (1.7 * stepOf(scheme, n)) / (scheme.sigma || 0.1)
  return { wk: Math.max(wk, floor), floor, widened: wk < floor - 1e-6 }
}
/** 用户给的宽度下，不加宽也不闪的最少帧数。 */
function minFrames(params) {
  const scheme = SWEEP_SCHEMES.find((x) => x.id === params.scheme) || SWEEP_SCHEMES[0]
  const wk = Math.max(0.2, Number(params.width) || 1)
  const steps = Math.ceil((scheme.span || 1) / ((scheme.sigma || 0.1) * wk / 1.7))
  return Math.max(2, scheme.wrap ? steps : steps + 1)
}

const BLEND_MODES = [
  { id: 'add', label: '叠加' },
  { id: 'screen', label: '滤色' },
  { id: 'normal', label: '正常' },
]

const DEFAULT_PARAMS = {
  scheme: 'base',
  angle: 25,          // 扫光方向（度）；径向类用作起始角
  width: 1,           // 光带宽度倍率
  intensity: 1,       // 强度倍率
  glow: 1,            // 光晕范围倍率
  rayLength: 1,       // 放射长度倍率（放射光芒）
  colorMode: 'base',  // base 底图色 | white 白光 | custom 自定义
  color: '#ffffff',
  frames: 12,
  blend: 'add',
  pad: 0,             // 0 = 自动（36 px，放射光芒按图宽的 20%）
}

// ---------- 小工具

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t) }
const gaussOf = (d, w) => Math.exp(-(d * d) / (2 * w * w))

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return [1, 1, 1]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function boxesForGauss(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1)
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--
  const wu = wl + 2
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4))
  const sizes = []
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu)
  return sizes
}

function boxBlurH(src, dst, w, h, r) {
  const iarr = 1 / (r + r + 1)
  for (let i = 0; i < h; i++) {
    let ti = i * w, li = ti, ri = ti + r
    const fv = src[ti], lv = src[ti + w - 1]
    let val = (r + 1) * fv
    for (let j = 0; j < r; j++) val += src[ti + j]
    for (let j = 0; j <= r; j++) { val += src[ri++] - fv; dst[ti++] = val * iarr }
    for (let j = r + 1; j < w - r; j++) { val += src[ri++] - src[li++]; dst[ti++] = val * iarr }
    for (let j = w - r; j < w; j++) { val += lv - src[li++]; dst[ti++] = val * iarr }
  }
}

function boxBlurV(src, dst, w, h, r) {
  const iarr = 1 / (r + r + 1)
  for (let i = 0; i < w; i++) {
    let ti = i, li = ti, ri = ti + r * w
    const fv = src[ti], lv = src[ti + w * (h - 1)]
    let val = (r + 1) * fv
    for (let j = 0; j < r; j++) val += src[ti + j * w]
    for (let j = 0; j <= r; j++) { val += src[ri] - fv; dst[ti] = val * iarr; ri += w; ti += w }
    for (let j = r + 1; j < h - r; j++) { val += src[ri] - src[li]; dst[ti] = val * iarr; li += w; ri += w; ti += w }
    for (let j = h - r; j < h; j++) { val += lv - src[li]; dst[ti] = val * iarr; li += w; ti += w }
  }
}

/** 高斯模糊（三次盒模糊近似），返回新数组。 */
function blurPlane(src, w, h, sigma) {
  const out = new Float32Array(src)
  if (!(sigma > 0.25)) return out
  const tmp = new Float32Array(src.length)
  const rMax = Math.max(0, Math.floor((Math.min(w, h) - 1) / 2))
  for (const size of boxesForGauss(sigma, 3)) {
    const r = Math.min(rMax, (size - 1) / 2)
    if (r <= 0) continue
    boxBlurH(out, tmp, w, h, r)
    boxBlurV(tmp, out, w, h, r)
  }
  return out
}

function blurRGB(p, w, h, sigma) { return [blurPlane(p[0], w, h, sigma), blurPlane(p[1], w, h, sigma), blurPlane(p[2], w, h, sigma)] }

/** 方窗最大 / 最小滤波（k 为窗口边长，奇数）。 */
function rankPlane(src, w, h, k, useMax) {
  const r = Math.max(0, (k - 1) >> 1)
  if (r === 0) return new Float32Array(src)
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let v = src[row + x]
      for (let d = 1; d <= r; d++) {
        const a = x - d >= 0 ? src[row + x - d] : v, b = x + d < w ? src[row + x + d] : v
        if (useMax) { if (a > v) v = a; if (b > v) v = b } else { if (a < v) v = a; if (b < v) v = b }
      }
      tmp[row + x] = v
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x]
      for (let d = 1; d <= r; d++) {
        const a = y - d >= 0 ? tmp[(y - d) * w + x] : v, b = y + d < h ? tmp[(y + d) * w + x] : v
        if (useMax) { if (a > v) v = a; if (b > v) v = b } else { if (a < v) v = a; if (b < v) v = b }
      }
      out[y * w + x] = v
    }
  }
  return out
}
const dilate = (p, w, h, k) => rankPlane(p, w, h, k, true)
const erode = (p, w, h, k) => rankPlane(p, w, h, k, false)

function plane(n, v = 0) { const p = new Float32Array(n); if (v) p.fill(v); return p }
function rgbPlanes(n) { return [plane(n), plane(n), plane(n)] }

/** 把 lit（预乘 RGB）以 (cx,cy) 为中心一级级放大叠加 → 放射光线。半分辨率算，省时间。 */
function zoomRays(lit, w, h, cx, cy, n, smax, gain) {
  // 30 万像素以内全分辨率（细的亮边才放得出亮光线），再大减半算（754×391 的图 24 帧从 32 s 降到约 8 s）
  const half = w * h > 300000 ? 2 : 1
  const sw = Math.max(2, Math.round(w / half)), sh = Math.max(2, Math.round(h / half))
  const sx = w / sw, sy = h / sh
  const small = rgbPlanes(sw * sh)
  for (let c = 0; c < 3; c++) {
    const src = lit[c], dst = small[c]
    if (half === 1) { for (let i = 0; i < src.length; i++) dst[i] = clamp01(src[i]); continue }
    for (let y = 0; y < sh; y++) {
      const y0 = Math.min(h - 1, Math.floor(y * sy)), y1 = Math.min(h - 1, y0 + 1)
      for (let x = 0; x < sw; x++) {
        const x0 = Math.min(w - 1, Math.floor(x * sx)), x1 = Math.min(w - 1, x0 + 1)
        dst[y * sw + x] = clamp01(0.25 * (src[y0 * w + x0] + src[y0 * w + x1] + src[y1 * w + x0] + src[y1 * w + x1]))
      }
    }
  }
  const acc = rgbPlanes(sw * sh)
  const scx = cx / sx, scy = cy / sy
  for (let i = 1; i <= n; i++) {
    const sc = 1 + (smax - 1) * (i / n)
    const wgt = gain * Math.pow(1 - i / (n + 1), 1.2)
    for (let y = 0; y < sh; y++) {
      const v = scy + (y - scy) / sc
      const vy = Math.floor(v), fy = v - vy
      if (vy < 0 || vy >= sh - 1) continue
      for (let x = 0; x < sw; x++) {
        const u = scx + (x - scx) / sc
        const ux = Math.floor(u), fx = u - ux
        if (ux < 0 || ux >= sw - 1) continue
        const i00 = vy * sw + ux, i10 = i00 + 1, i01 = i00 + sw, i11 = i01 + 1
        const o = y * sw + x
        for (let c = 0; c < 3; c++) {
          const s = small[c]
          acc[c][o] += wgt * ((s[i00] * (1 - fx) + s[i10] * fx) * (1 - fy) + (s[i01] * (1 - fx) + s[i11] * fx) * fy)
        }
      }
    }
  }
  if (half === 1) return acc
  const out = rgbPlanes(w * h)
  for (let c = 0; c < 3; c++) {
    const s = acc[c], d = out[c]
    for (let y = 0; y < h; y++) {
      const v = Math.min(sh - 1.001, y / sy), vy = Math.floor(v), fy = v - vy
      for (let x = 0; x < w; x++) {
        const u = Math.min(sw - 1.001, x / sx), ux = Math.floor(u), fx = u - ux
        const i00 = vy * sw + ux
        d[y * w + x] = (s[i00] * (1 - fx) + s[i00 + 1] * fx) * (1 - fy) + (s[i00 + sw] * (1 - fx) + s[i00 + sw + 1] * fx) * fy
      }
    }
  }
  return out
}

function mulberry32(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function percentile(values, q) {
  if (!values.length) return 0
  const s = Float32Array.from(values).sort()
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]
}

function autoPad(w, h, params) {
  if (params.pad > 0) return Math.round(params.pad)
  const s = SWEEP_SCHEMES.find((x) => x.id === params.scheme)
  const ratio = s?.padRatio || 0
  return Math.max(36, Math.round(Math.max(w, h) * ratio))
}

// ---------- 分析底图

/**
 * @param {Uint8ClampedArray} rgba 底图像素（直通 alpha）
 * @param {number} w @param {number} h
 * @param {object} params 见 DEFAULT_PARAMS（用到 scheme / pad / colorMode / color）
 */
function analyzeBase(rgba, w, h, params = DEFAULT_PARAMS) {
  const P = { ...DEFAULT_PARAMS, ...params }
  const pad = autoPad(w, h, P)
  const W = w + pad * 2, H = h + pad * 2, N = W * H
  const a = plane(N), r = plane(N), g = plane(N), b = plane(N)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, o = (y + pad) * W + x + pad
      a[o] = rgba[i + 3] / 255; r[o] = rgba[i] / 255; g[o] = rgba[i + 1] / 255; b[o] = rgba[i + 2] / 255
    }
  }
  const lum = plane(N), pr = plane(N), pg = plane(N), pb = plane(N)
  for (let i = 0; i < N; i++) {
    lum[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i]
    pr[i] = r[i] * a[i]; pg[i] = g[i] * a[i]; pb[i] = b[i] * a[i]
  }

  // 底图提亮：伽马提亮 + 饱和度提升（暗部不加饱和，深色描边不会变红）
  const liftCache = new Map()
  const liftBase = (gamma, sat, uniform = false) => {
    const key = gamma + '/' + sat + (uniform ? '/u' : '')
    if (liftCache.has(key)) return liftCache.get(key)
    const o = rgbPlanes(N)
    for (let i = 0; i < N; i++) {
      const l = lum[i], k = uniform ? sat : 1 + (sat - 1) * Math.sqrt(clamp01(l))
      o[0][i] = Math.pow(clamp01(l + (r[i] - l) * k), gamma)
      o[1][i] = Math.pow(clamp01(l + (g[i] - l) * k), gamma)
      o[2][i] = Math.pow(clamp01(l + (b[i] - l) * k), gamma)
    }
    liftCache.set(key, o)
    return o
  }
  const liftColor = (c, gamma, sat) => {
    const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2], k = 1 + (sat - 1) * Math.sqrt(clamp01(l))
    return c.map((v) => Math.pow(clamp01(l + (v - l) * k), gamma))
  }

  // 光色：底图色 / 白光 / 自定义
  const solid = P.colorMode === 'white' ? [1, 1, 1] : P.colorMode === 'custom' ? hexToRgb(P.color) : null
  let LC, LCO, TINT, lift, LCR
  if (solid) {
    LC = rgbPlanes(N); LCO = rgbPlanes(N)
    for (let c = 0; c < 3; c++) { LC[c].fill(solid[c]); LCO[c].fill(solid[c]) }
    TINT = solid.slice(); LCR = LC
    const solidCache = new Map()
    lift = (gamma, sat) => {   // 纯色模式：颜色 × 亮度形状，保留明暗
      const key = gamma + '/' + sat
      if (solidCache.has(key)) return solidCache.get(key)
      const o = rgbPlanes(N)
      for (let i = 0; i < N; i++) { const s = 0.35 + 0.65 * Math.pow(clamp01(lum[i]), gamma); o[0][i] = solid[0] * s; o[1][i] = solid[1] * s; o[2][i] = solid[2] * s }
      solidCache.set(key, o); return o
    }
  } else {
    lift = liftBase
    LC = liftBase(0.45, 1.35)
    LCR = liftBase(0.45, 1.35, true)   // 放射光芒的取色：全饱和提亮（早期的那种金色）
    const ba = blurPlane(a, W, H, 10)
    LCO = rgbPlanes(N)
    for (let c = 0; c < 3; c++) {
      const t = plane(N); for (let i = 0; i < N; i++) t[i] = LC[c][i] * a[i]
      const bt = blurPlane(t, W, H, 10)
      for (let i = 0; i < N; i++) LCO[c][i] = a[i] > 0.5 ? LC[c][i] : clamp01(bt[i] / Math.max(ba[i], 0.02))
    }
    const inside = []; for (let i = 0; i < N; i++) if (a[i] > 0.5) inside.push(lum[i])
    const thr = percentile(inside, 0.7)
    let sr = 0, sg = 0, sb = 0, n = 0
    for (let i = 0; i < N; i++) if (a[i] > 0.5 && lum[i] > thr) { sr += r[i]; sg += g[i]; sb += b[i]; n++ }
    TINT = n ? liftColor([sr / n, sg / n, sb / n], 0.45, 1.3) : [1, 1, 1]
  }
  const seedColor = (i) => solid ? solid : liftColor([r[i], g[i], b[i]], 0.7, 1.3)

  // 轮廓：内边 / 外圈
  const aIn = erode(a, W, H, 5)
  const edge = plane(N); for (let i = 0; i < N; i++) edge[i] = clamp01(a[i] - aIn[i])
  const edgeB = blurPlane(edge, W, H, 0.8); for (let i = 0; i < N; i++) edge[i] = clamp01(edgeB[i] * 1.8)
  const aD3 = dilate(a, W, H, 3)
  const aOut = plane(N); for (let i = 0; i < N; i++) aOut[i] = clamp01(aD3[i] - a[i])

  // 包围盒 / 中心 / 对角线
  let x0 = W, x1 = -1, y0 = H, y1 = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a[y * W + x] > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (x1 < 0) { x0 = 0; x1 = W - 1; y0 = 0; y1 = H - 1 }
  const CX = (x0 + x1) / 2, CY = (y0 + y1) / 2, DIAG = Math.hypot(x1 - x0, y1 - y0) || 1
  let lumMean = 0, lumN = 0; for (let i = 0; i < N; i++) if (a[i] > 0.5) { lumMean += lum[i]; lumN++ }
  lumMean = lumN ? lumMean / lumN : 0.5

  // 边缘渐隐（放射光线用）
  const FADE = plane(N)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) FADE[y * W + x] = smooth(0, pad * 0.95, x) * smooth(0, pad * 0.95, W - 1 - x) * smooth(0, pad * 0.95, y) * smooth(0, pad * 0.95, H - 1 - y)

  // 伪法线（金属反光）：图上的明暗起伏当凹凸
  const lumA = plane(N); for (let i = 0; i < N; i++) lumA[i] = lum[i] * a[i]
  const lumA3 = blurPlane(lumA, W, H, 3)
  const lbSrc = plane(N); for (let i = 0; i < N; i++) lbSrc[i] = lumA[i] + (1 - a[i]) * lumA3[i]
  const lb = blurPlane(lbSrc, W, H, 1.2)
  const NS = 10
  const NX = plane(N), NY = plane(N), NZ = plane(N)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    const gx = (x === 0 ? lb[i + 1] - lb[i] : x === W - 1 ? lb[i] - lb[i - 1] : (lb[i + 1] - lb[i - 1]) / 2)
    const gy = (y === 0 ? lb[i + W] - lb[i] : y === H - 1 ? lb[i] - lb[i - W] : (lb[i + W] - lb[i - W]) / 2)
    const nz = 1 / Math.sqrt(1 + gx * NS * gx * NS + gy * NS * gy * NS)
    NX[i] = -gx * NS * nz; NY[i] = -gy * NS * nz; NZ[i] = nz
  }

  // 亮点种子（星芒）：模糊亮度的局部极大
  const lbs = blurPlane(lumA, W, H, 2)
  const cand = []
  for (let y = pad + 4; y < H - pad - 4; y += 3) for (let x = pad + 4; x < W - pad - 4; x += 3) {
    const i = y * W + x
    if (a[i] <= 0.9 || lbs[i] <= 0.55) continue
    let isMax = true
    for (let dy = -3; dy <= 3 && isMax; dy++) for (let dx = -3; dx <= 3; dx++) if (lbs[(y + dy) * W + x + dx] > lbs[i]) { isMax = false; break }
    if (isMax) cand.push([lbs[i], x, y])
  }
  cand.sort((p, q) => q[0] - p[0])
  const rng = mulberry32(7)
  const SPOTS = []
  const minD2 = (DIAG * 0.03) ** 2
  for (const [, x, y] of cand) {
    if (SPOTS.every((s) => (x - s.x) ** 2 + (y - s.y) ** 2 > minD2)) SPOTS.push({ x, y, ph: rng() * 0.08 - 0.04, i: y * W + x })
    if (SPOTS.length >= 60) break
  }

  // 高光区遮罩（高光点扫光）：比周围亮的局部，不是整片亮区
  const lumA6 = blurPlane(lumA, W, H, 6)
  const locSrc = plane(N); for (let i = 0; i < N; i++) locSrc[i] = lumA[i] + (1 - a[i]) * lumA6[i]
  const loc7 = blurPlane(locSrc, W, H, 7)
  const hl = plane(N); for (let i = 0; i < N; i++) hl[i] = clamp01(smooth(0.03, 0.16, lum[i] - loc7[i]) * smooth(0.45, 0.75, lum[i]) * a[i])
  const HILITE = blurPlane(hl, W, H, 0.8)

  // 扫光坐标：沿方向角归一化到 [0,1]
  const coordCache = new Map()
  const coord = (angleDeg) => {
    const key = Math.round(angleDeg * 100)
    if (coordCache.has(key)) return coordCache.get(key)
    const ph = (angleDeg * Math.PI) / 180, cs = Math.cos(ph), sn = Math.sin(ph)
    const corners = [0, (W - 1) * cs, (H - 1) * sn, (W - 1) * cs + (H - 1) * sn]
    const lo = Math.min(...corners), hi = Math.max(...corners), span = hi - lo || 1
    const u = plane(N)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) u[y * W + x] = (x * cs + y * sn - lo) / span
    coordCache.set(key, u)
    return u
  }

  return { w, h, pad, W, H, N, a, r, g, b, lum, pr, pg, pb, LC, LCR, LCO, TINT, bbox: { x0, x1, y0, y1 }, lift, seedColor, edge, aOut, CX, CY, DIAG, lumMean, FADE, NX, NY, NZ, SPOTS, HILITE, coord, solid, params: P }
}

// ---------- 各方案：返回 { inner, outer }（都是预乘 RGB 的光；inner 在字内、要和底图做滤色，outer 直接相加）

function bloom(ctx, layer, r1, r2, k1, k2) {
  const { W, H, N } = ctx
  const b1 = blurRGB(layer, W, H, r1), b2 = blurRGB(layer, W, H, r2)
  const o = rgbPlanes(N)
  for (let c = 0; c < 3; c++) for (let i = 0; i < N; i++) o[c][i] = b1[c][i] * k1 + b2[c][i] * k2
  return o
}
function addInto(dst, src, k = 1) { for (let c = 0; c < 3; c++) { const d = dst[c], s = src[c]; for (let i = 0; i < d.length; i++) d[i] += s[i] * k } return dst }
function scaleRGB(src, mask, k = 1) { const o = rgbPlanes(src[0].length); for (let c = 0; c < 3; c++) { const s = src[c], d = o[c]; for (let i = 0; i < d.length; i++) d[i] = s[i] * mask[i] * k } return o }
function colorTimes(col, mask, k = 1) { const n = mask.length, o = rgbPlanes(n); for (let c = 0; c < 3; c++) { const d = o[c], cc = col[c]; for (let i = 0; i < n; i++) d[i] = cc * mask[i] * k } return o }
function planesTimes(colPlanes, mask, k = 1) { return scaleRGB(colPlanes, mask, k) }
function clipRGB(p) { for (let c = 0; c < 3; c++) { const d = p[c]; for (let i = 0; i < d.length; i++) d[i] = clamp01(d[i]) } return p }

function band(ctx, p, angle, span) {
  const u = ctx.coord(angle), N = ctx.N, pos = span[0] + p * (span[1] - span[0])
  const d = plane(N); for (let i = 0; i < N; i++) d[i] = u[i] - pos
  return d
}
function gaussPlane(d, w) { const o = plane(d.length); for (let i = 0; i < d.length; i++) o[i] = gaussOf(d[i], w); return o }

const LINEAR_SPAN = [-0.2, 1.2]

const SCHEME_FN = {
  base(ctx, p, k) {
    const { a, lum, N } = ctx
    const m = gaussPlane(band(ctx, p, k.angle, LINEAR_SPAN), 0.10 * k.wk)
    const mask = plane(N); for (let i = 0; i < N; i++) mask[i] = m[i] * a[i] * 0.6 * k.ik
    const inner = planesTimes(ctx.lift(0.55, 1.25), mask)
    const lw = plane(N); for (let i = 0; i < N; i++) lw[i] = Math.pow(lum[i], 1.2)
    const outer = bloom(ctx, scaleRGB(inner, lw), 5 * k.gk, 16 * k.gk, 0.45, 0.3)
    return { inner, outer }
  },

  'metal-highlight'(ctx, p, k) {
    const { a, lum, N, LC } = ctx
    const d = band(ctx, p, k.angle, LINEAR_SPAN)
    const core = plane(N), halo = plane(N)
    for (let i = 0; i < N; i++) {
      const x = d[i]
      core[i] = smooth(-0.035 * k.wk, -0.008 * k.wk, x) * (1 - smooth(0.008 * k.wk, 0.035 * k.wk, x)) * a[i] * (0.5 + 0.5 * Math.pow(lum[i], 1.3))
      halo[i] = gaussOf(x, 0.09 * k.wk) * a[i] * 0.35
    }
    const spec = planesTimes(LC, core), soft = planesTimes(ctx.lift(0.6, 1.2), halo)
    const inner = rgbPlanes(N)
    for (let c = 0; c < 3; c++) for (let i = 0; i < N; i++) inner[c][i] = (spec[c][i] * 0.95 + soft[c][i]) * k.ik
    const outer = bloom(ctx, spec, 4 * k.gk, 14 * k.gk, 0.5 * k.ik, 0.35 * k.ik)
    addInto(outer, blurRGB(soft, ctx.W, ctx.H, 10 * k.gk), 0.2 * k.ik)
    return { inner, outer }
  },

  gold(ctx, p, k) {
    const { a, lum, N, W, H } = ctx
    const col = ctx.solid || [1, 0.82, 0.45]
    const m = gaussPlane(band(ctx, p, k.angle, LINEAR_SPAN), 0.10 * k.wk)
    const inner = rgbPlanes(N)
    for (let i = 0; i < N; i++) {
      const s = Math.sqrt(clamp01(lum[i])) * 1.1, mm = m[i] * a[i] * 0.7 * k.ik
      for (let c = 0; c < 3; c++) inner[c][i] = clamp01(s * col[c]) * mm
    }
    const aD = dilate(a, W, H, 5)
    const om = plane(N); for (let i = 0; i < N; i++) om[i] = aD[i] * m[i]
    const ob = blurPlane(om, W, H, 12 * k.gk)
    const outer = bloom(ctx, inner, 5 * k.gk, 16 * k.gk, 0.3, 0.2)
    for (let c = 0; c < 3; c++) for (let i = 0; i < N; i++) outer[c][i] += col[c] * ob[i] * 0.35 * (1 - a[i] * 0.5) * k.ik
    return { inner, outer }
  },

  'metal-reflect'(ctx, p, k) {
    const { a, lum, N, LC, NX, NY, NZ } = ctx
    const d = band(ctx, p, k.angle, LINEAR_SPAN)
    const ph = (k.angle * Math.PI) / 180, az = ph + ((70 - 140 * p) * Math.PI) / 180, el = (38 * Math.PI) / 180
    const L = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)]
    let hx = L[0], hy = L[1], hz = L[2] + 1; const hn = Math.hypot(hx, hy, hz); hx /= hn; hy /= hn; hz /= hn
    const specM = plane(N), difM = plane(N)
    for (let i = 0; i < N; i++) {
      const m = gaussOf(d[i], 0.22 * k.wk) * a[i]
      const ndh = clamp01(NX[i] * hx + NY[i] * hy + NZ[i] * hz), ndl = clamp01(NX[i] * L[0] + NY[i] * L[1] + NZ[i] * L[2])
      const spec = Math.pow(ndh, 24) * 3 + Math.pow(ndh, 6) * 0.5
      specM[i] = spec * m * (0.5 + 0.5 * Math.pow(lum[i], 0.8))
      difM[i] = Math.max(0, (ndl - 0.35) * 1.2 * m)
    }
    const specL = clipRGB(planesTimes(LC, specM)), dif = clipRGB(planesTimes(ctx.lift(0.6, 1.2), difM))
    const inner = rgbPlanes(N)
    for (let c = 0; c < 3; c++) for (let i = 0; i < N; i++) inner[c][i] = (specL[c][i] + dif[c][i]) * k.ik
    const outer = bloom(ctx, specL, 3 * k.gk, 10 * k.gk, 0.7 * k.ik, 0.4 * k.ik)
    return { inner, outer }
  },

  rim(ctx, p, k) {
    const { a, N, W, H, LCO, edge, aOut } = ctx
    const d = band(ctx, p, k.angle, LINEAR_SPAN)
    const kk = 0.9 - 0.45 * ctx.lumMean
    const m = gaussPlane(d, 0.14 * k.wk)
    const rimM = plane(N), ringM = plane(N), g1 = plane(N), g2 = plane(N), inM = plane(N)
    for (let i = 0; i < N; i++) {
      rimM[i] = edge[i] * m[i] * 1.1 * kk; ringM[i] = aOut[i] * m[i] * 0.8 * kk
      g1[i] = (edge[i] + aOut[i]) * m[i]; g2[i] = aOut[i] * m[i]
      inM[i] = gaussOf(d[i], 0.07 * k.wk) * a[i] * 0.25
    }
    const b1 = blurPlane(g1, W, H, 6 * k.gk), b2 = blurPlane(g2, W, H, 16 * k.gk)
    const inner = planesTimes(LCO, rimM, k.ik)
    addInto(inner, planesTimes(ctx.lift(0.7, 1.1), inM), k.ik)
    const outer = rgbPlanes(N)
    for (let c = 0; c < 3; c++) for (let i = 0; i < N; i++) outer[c][i] = LCO[c][i] * (ringM[i] + (b1[i] * 0.8 + b2[i] * 0.5) * kk * 0.8) * k.ik
    return { inner, outer }
  },

  outline(ctx, p, k) {
    // 光沿外框周长跑一圈（左上角起顺时针：上 → 右 → 下 → 左），不是绕中心转角度：
    // 每个点按「中心射线打到外框的位置」换算成周长坐标，光带宽度按周长算，各处一样宽
    const { a, N, W, H, LCO, edge, aOut } = ctx
    if (!ctx._perim) {
      const { x0, x1, y0, y1 } = ctx.bbox
      const hw = Math.max(1, (x1 - x0) / 2), hh = Math.max(1, (y1 - y0) / 2), per = 4 * hw + 4 * hh
      const sOf = (dx, dy) => {
        const t = Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh)
        if (t < 1e-6) return 0
        const px = dx / t, py = dy / t
        let s
        if (Math.abs(dy) / hh >= Math.abs(dx) / hw) s = dy < 0 ? px + hw : 2 * hw + 2 * hh + (hw - px)
        else s = dx > 0 ? 2 * hw + (py + hh) : 4 * hw + 2 * hh + (hh - py)
        return s / per
      }
      const sp = plane(N)
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sp[y * W + x] = sOf(x - ctx.CX, y - ctx.CY)
      ctx._perim = { sp, sOf }
    }
    const ph = (k.angle * Math.PI) / 180
    const s0 = ctx._perim.sOf(Math.cos(ph) * 1e4, Math.sin(ph) * 1e4)
    const sp = ctx._perim.sp
    const m = plane(N)
    for (let i = 0; i < N; i++) {
      let d = sp[i] - s0 - p
      d -= Math.round(d)                       // 环绕：[-0.5, 0.5)
      // 主带 + 身后的拖尾（前方平滑收掉，没有硬边）
      m[i] = clamp01(gaussOf(d, 0.045 * k.wk) + gaussOf(d + 0.07, 0.08) * 0.4 * (1 - smooth(0, 0.06, d)))
    }
    const rimM = plane(N), ringM = plane(N), g1 = plane(N), g2 = plane(N)
    for (let i = 0; i < N; i++) { rimM[i] = edge[i] * m[i] * 1.2; ringM[i] = aOut[i] * m[i] * 0.9; g1[i] = (edge[i] + aOut[i]) * m[i]; g2[i] = aOut[i] * m[i] }
    const b1 = blurPlane(g1, W, H, 5 * k.gk), b2 = blurPlane(g2, W, H, 14 * k.gk), b3 = blurPlane(g2, W, H, 30 * k.gk)
    const inner = planesTimes(LCO, rimM, k.ik)
    const outer = rgbPlanes(N)
    for (let c = 0; c < 3; c++) for (let i = 0; i < N; i++) outer[c][i] = LCO[c][i] * (ringM[i] + (b1[i] * 0.9 + b2[i] * 0.6 + b3[i] * 0.3) * (1 - a[i] * 0.5)) * k.ik
    return { inner, outer }
  },

  sparkle(ctx, p, k) {
    const { a, lum, N, W, H, SPOTS, DIAG } = ctx
    const d = band(ctx, p, k.angle, LINEAR_SPAN)
    const m = gaussPlane(d, 0.08 * k.wk)
    const inM = plane(N); for (let i = 0; i < N; i++) inM[i] = m[i] * a[i] * 0.35
    const inner = planesTimes(ctx.lift(0.65, 1.2), inM, k.ik)
    const px = Math.min(3, Math.max(0.8, DIAG / 550))
    const layer = rgbPlanes(N)
    for (const s of SPOTS) {
      const kk = gaussOf(d[s.i] + s.ph, 0.03 * k.wk)
      if (kk < 0.03) continue
      const col = ctx.seedColor(s.i)
      const sz = (2.2 + 1.5 * lum[s.i]) * px, reach = Math.ceil(sz * 5 + 2)
      for (let y = Math.max(0, s.y - reach); y <= Math.min(H - 1, s.y + reach); y++) {
        for (let x = Math.max(0, s.x - reach); x <= Math.min(W - 1, s.x + reach); x++) {
          const dx = x - s.x, dy = y - s.y
          const dot = Math.exp(-(dx * dx + dy * dy) / (2 * sz * sz)) * 1.4
          const cross = (Math.exp(-(dy * dy) / (1.2 * px)) * Math.pow(clamp01(1 - Math.abs(dx) / (sz * 5)), 2) + Math.exp(-(dx * dx) / (1.2 * px)) * Math.pow(clamp01(1 - Math.abs(dy) / (sz * 5)), 2)) * 0.9
          const v = Math.min(1.6, dot + cross) * kk
          const i = y * W + x
          for (let c = 0; c < 3; c++) layer[c][i] += col[c] * v
        }
      }
    }
    for (let c = 0; c < 3; c++) for (let i = 0; i < N; i++) inner[c][i] += layer[c][i] * a[i] * k.ik
    const outer = bloom(ctx, layer, 3 * k.gk, 9 * k.gk, 0.5 * k.ik, 0.3 * k.ik)
    for (let c = 0; c < 3; c++) for (let i = 0; i < N; i++) outer[c][i] += layer[c][i] * (1 - a[i]) * k.ik
    return { inner, outer }
  },

  hotspot(ctx, p, k) {
    const { a, N, LC, HILITE } = ctx
    const m = gaussPlane(band(ctx, p, k.angle, [-0.25, 1.25]), 0.13 * k.wk)
    const litM = plane(N), faintM = plane(N)
    for (let i = 0; i < N; i++) { litM[i] = HILITE[i] * m[i] * 1.1; faintM[i] = m[i] * a[i] * 0.12 }
    const lit = planesTimes(LC, litM)
    const inner = planesTimes(LC, litM, k.ik)
    addInto(inner, planesTimes(ctx.lift(0.7, 1.1), faintM), k.ik)
    const outer = bloom(ctx, lit, 3 * k.gk, 9 * k.gk, 0.45 * k.ik, 0.25 * k.ik)
    return { inner, outer }
  },

  ring(ctx, p, k) {
    const { a, N, W, H, LCO, CX, CY, DIAG } = ctx
    const r0 = -0.15 + p * 1.35
    const m = plane(N), core = plane(N)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x
      const d = Math.hypot(x - CX, y - CY) / (DIAG * 0.5) - r0
      core[i] = gaussOf(d, 0.05 * k.wk)
      m[i] = clamp01(core[i] + gaussOf(d + 0.1, 0.09 * k.wk) * 0.5)
    }
    const inM = plane(N); for (let i = 0; i < N; i++) inM[i] = m[i] * a[i] * 0.9
    const inner = planesTimes(ctx.lift(0.5, 1.3), inM, k.ik)
    const aD = dilate(a, W, H, 7)
    const ringM = plane(N); for (let i = 0; i < N; i++) ringM[i] = core[i] * aD[i] * 0.6
    const ringB = blurRGB(planesTimes(LCO, ringM), W, H, 6 * k.gk)
    const outer = bloom(ctx, inner, 5 * k.gk, 16 * k.gk, 0.3, 0.2)
    addInto(outer, ringB, 0.8 * k.ik)
    return { inner, outer }
  },

  rays(ctx, p, k) {
    const { a, lum, N, W, H, LCR, CX, CY, FADE } = ctx
    const LC = LCR
    const m = gaussPlane(band(ctx, p, k.angle, [-0.25, 1.25]), 0.09 * k.wk)
    const litM = plane(N); for (let i = 0; i < N; i++) litM[i] = m[i] * a[i] * (0.3 + 0.7 * lum[i]) * 1.6
    const lit = blurRGB(planesTimes(LC, litM), W, H, 2.5)
    let rays = zoomRays(lit, W, H, CX, CY, 48, 1 + 2.2 * k.rayLength, 0.055)
    rays = blurRGB(rays, W, H, 1.2)
    const inM = plane(N); for (let i = 0; i < N; i++) inM[i] = m[i] * a[i] * 0.5
    const inner = planesTimes(LC, inM, k.ik)
    const outer = rgbPlanes(N)
    for (let c = 0; c < 3; c++) for (let i = 0; i < N; i++) {
      const rv = rays[c][i] * FADE[i]
      inner[c][i] += rv * 0.5 * a[i] * k.ik
      outer[c][i] = rv * (1 - a[i] * 0.65) * k.ik
    }
    return { inner, outer }
  },
}

/** 进度 p∈[0,1] 的一帧。返回 { data: Uint8ClampedArray(RGBA, 直通 alpha), w: W, h: H, pad } */
function renderSweepFrame(ctx, p, params = ctx.params) {
  const P = { ...DEFAULT_PARAMS, ...ctx.params, ...params }
  const fn = SCHEME_FN[P.scheme] || SCHEME_FN.base
  const k = { angle: Number(P.angle) || 0, wk: effectiveWidth(P).wk, ik: Math.max(0, Number(P.intensity) || 1), gk: Math.max(0.2, Number(P.glow) || 1), rayLength: Math.max(0.2, Number(P.rayLength) || 1) }
  const { inner, outer } = fn(ctx, p, k)
  const { N, W, H, a, pr, pg, pb } = ctx
  const prem = [pr, pg, pb]
  const data = new Uint8ClampedArray(N * 4)
  const L = [0, 0, 0]
  for (let i = 0; i < N; i++) {
    let alpha
    if (P.blend === 'normal') {
      let mo = 0
      for (let c = 0; c < 3; c++) { const o = outer[c][i]; if (o > mo) mo = o; L[c] = clamp01(prem[c][i] + (1 - prem[c][i]) * inner[c][i] + o) }
      alpha = clamp01(a[i] + mo)
    } else {
      let mx = 0
      for (let c = 0; c < 3; c++) {
        const v = P.blend === 'screen' ? clamp01(inner[c][i] + outer[c][i]) : clamp01((1 - prem[c][i]) * inner[c][i] + outer[c][i])
        L[c] = v; if (v > mx) mx = v
      }
      alpha = mx
    }
    const o = i * 4
    if (alpha > 0.002) {
      data[o] = Math.round((L[0] / alpha) * 255); data[o + 1] = Math.round((L[1] / alpha) * 255); data[o + 2] = Math.round((L[2] / alpha) * 255); data[o + 3] = Math.round(alpha * 255)
    }
  }
  return { data, w: W, h: H, pad: ctx.pad }
}

/** 整组帧。frames 张，p 从 0 到 1 均分；onProgress(i, n)。 */
function generateSweepSequence(rgba, w, h, params = DEFAULT_PARAMS, onProgress) {
  const P = { ...DEFAULT_PARAMS, ...params }
  const n = Math.max(2, Math.min(240, Math.round(Number(P.frames) || 12)))
  const ctx = analyzeBase(rgba, w, h, P)
  const wrap = !!(SWEEP_SCHEMES.find((s) => s.id === P.scheme) || {}).wrap   // 绕一圈的：末帧不重复首帧
  const frames = []
  for (let i = 0; i < n; i++) {
    frames.push(renderSweepFrame(ctx, wrap ? i / n : i / (n - 1), P))
    if (onProgress) onProgress(i + 1, n)
  }
  return { frames, pad: ctx.pad, w: ctx.W, h: ctx.H }
}

/**
 * 写入动画用的透明度曲线：第 i 张 0 → 100 → 0，后一张在前一张最亮时开始（和 writeSweep 一致）。
 * 直线扫光：整段 (n + 1) 步，第 i 张在 i·step 起、(i+1)·step 最亮、(i+2)·step 熄。
 * 绕一圈的（wrap）：整段 n 步，第 i 张在 i·step 最亮，前后各一步淡入淡出，首尾相接：
 * 最后一张淡出时第一张同时淡入，循环回到开头不断光。
 */
function sweepAlphaAt(i, n, t, step, wrap) {
  if (!wrap) {
    const t0 = i * step, t1 = (i + 1) * step, t2 = (i + 2) * step
    if (t <= t0 || t >= t2) return 0
    return t < t1 ? (t - t0) / step : (t2 - t) / step
  }
  const total = n * step
  let d = ((t - i * step) % total + total) % total   // 离最亮时刻多远（环上）
  if (d > total / 2) d -= total
  const a = 1 - Math.abs(d) / step
  return a > 0 ? a : 0
}
/** 写入动画的关键帧（时间 → 透明度 0/1），wrap 时首尾相接。 */
function sweepAlphaKeys(i, n, step, wrap) {
  if (!wrap) return [[0, 0], ...(i > 0 ? [[i * step, 0]] : []), [(i + 1) * step, 1], [(i + 2) * step, 0]]
  const total = n * step
  if (i === 0) return [[0, 1], [step, 0], ...(n > 2 ? [[(n - 1) * step, 0]] : []), [total, 1]]
  return [[0, 0], ...(i > 1 ? [[(i - 1) * step, 0]] : []), [i * step, 1], [(i + 1) * step, 0], ...((i + 1) * step < total ? [[total, 0]] : [])]
}

  root.NovaFlowSweepLight = { SWEEP_SCHEMES, BLEND_MODES, DEFAULT_PARAMS, analyzeBase, renderSweepFrame, generateSweepSequence, sweepAlphaAt, sweepAlphaKeys, autoPad, blurPlane, effectiveWidth, minFrames, stepOf }
})(typeof self !== 'undefined' ? self : globalThis)
