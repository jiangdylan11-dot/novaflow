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
  { id: 'ring', label: '环形扩散', group: '径向', hint: '光环从中心向外扩散', radial: true, sigma: 0.05, span: 1.35, frames: 32, inert: { angle: '光环从中心向外扩，没有方向' } },
  { id: 'rays', label: '放射光芒', group: '径向', hint: '光带扫到的部分向外放射光线', padRatio: 0.24, sigma: 0.09, span: 1.5, frames: 24, inert: { glow: '放射光线本身就是光晕，用「放射长度」调' } },
]
// 边缘扫光（2026-10-13 用户在 work/sweep-light-lab 五轮里选定）：光只沿轮廓走，绕一圈首尾相接。
// fixedColor = 效果自带配色（火焰 / 冰蓝 / 彩虹…），光色选项不适用。角度 / 宽度 不用（见 edgeGeo）。
// 每种的专属参数 extra = { label, min, max, step, def }；noStart = 起点不适用（火焰 / 烟雾 / 光剑整圈同时动）。
// 通用：起点（光从轮廓哪里出发，斜向扫光是方向）、粗细（整体放大缩小）、次数（时长内重复几次，整数才首尾相接）、
// 色相（自带配色的才有）；光晕 / 强度 同其他方案。
const TRAIL = { label: '拖尾', min: 0.3, max: 2.5, step: 0.05, def: 1 }
const EDGE_SCHEMES = [
  { id: 'edge-meteor', label: '流星环绕', group: '边缘环绕', hint: '一颗拖长尾的流星沿轮廓绕圈', extra: TRAIL },
  { id: 'edge-twin', label: '双星追逐', group: '边缘环绕', hint: '青、粉两颗流星一前一后沿边追', fixedColor: true, extra: TRAIL },
  { id: 'edge-meet', label: '分流汇合', group: '边缘环绕', hint: '两道光从起点分头沿边跑，在对面汇合炸开', extra: TRAIL },
  { id: 'edge-stardust', label: '星尘拖尾', group: '边缘环绕', hint: '流星走过的边缘留下闪烁的星尘', extra: { label: '星尘', min: 0.3, max: 3, step: 0.05, def: 1 } },
  { id: 'edge-firecomet', label: '火焰流星', group: '边缘环绕', hint: '拖着火焰尾巴的流星沿边绕圈', fixedColor: true, extra: { label: '火苗', min: 0.3, max: 2.5, step: 0.05, def: 1 } },
  { id: 'edge-bolt', label: '闪电环绕', group: '边缘环绕', hint: '一道电弧沿边绕圈，噼啪抖动', fixedColor: true, extra: { label: '抖动', min: 0, max: 2.5, step: 0.05, def: 1 } },
  { id: 'edge-wideband', label: '宽光带环绕', group: '边缘环绕', hint: '一大段柔光沿边转，中间一道亮线', extra: { label: '光带', min: 0.3, max: 2.5, step: 0.05, def: 1 } },
  { id: 'edge-counter', label: '双色对绕', group: '边缘环绕', hint: '底图色和补色两颗流星反向绕，交汇处闪光', extra: TRAIL },
  { id: 'edge-innerflow', label: '内光流转', group: '边缘环绕', hint: '两团光沿边框内侧反向流动', extra: { label: '光团', min: 0.3, max: 2.5, step: 0.05, def: 1 } },
  { id: 'edge-fire', label: '火焰描边', group: '边缘描边', hint: '整圈轮廓燃烧，朝上的边火苗更高', fixedColor: true, noStart: true, extra: { label: '火苗', min: 0.3, max: 2.5, step: 0.05, def: 1 } },
  { id: 'edge-chrome', label: '镀铬环光', group: '边缘描边', hint: '光绕物体转，朝光一侧的边缘亮起金属高光', extra: { label: '锐度', min: 0.3, max: 2.5, step: 0.05, def: 1 } },
  { id: 'edge-aurora', label: '炫彩光晕', group: '边缘描边', hint: '彩色光晕绕着轮廓旋转', fixedColor: true, extra: { label: '范围', min: 0.3, max: 2.5, step: 0.05, def: 1 } },
  { id: 'edge-saber', label: '光剑描边', group: '边缘描边', hint: '光剑般的发光描边，轻微闪烁', fixedColor: true, noStart: true, extra: { label: '闪烁', min: 0, max: 3, step: 0.05, def: 1 } },
  { id: 'edge-goldfoil', label: '金箔闪耀', group: '边缘描边', hint: '金色描边，高光转动，边上星点闪', fixedColor: true, extra: { label: '星点', min: 0.3, max: 3, step: 0.05, def: 1 } },
  { id: 'edge-wisps', label: '魔法烟雾', group: '边缘描边', hint: '轮廓上冒出流动的彩色烟雾', fixedColor: true, noStart: true, extra: { label: '烟雾', min: 0.3, max: 2.5, step: 0.05, def: 1 } },
  { id: 'edge-neon', label: '霓虹流彩', group: '边缘描边', hint: '彩虹色沿整圈描边流动', fixedColor: true, extra: { label: '彩带', min: 1, max: 4, step: 1, def: 1 } },
  { id: 'edge-diagonal', label: '斜向扫光', group: '边缘律动', hint: '一道斜线扫过，只点亮经过的轮廓', extra: { label: '光带', min: 0.3, max: 3, step: 0.05, def: 1 } },
  { id: 'edge-ripple', label: '边缘涟漪', group: '边缘律动', hint: '轮廓一圈圈向外扩，亮段沿边流动', extra: { label: '光环', min: 1, max: 5, step: 1, def: 3 } },
  { id: 'edge-charge', label: '充能满圈', group: '边缘律动', hint: '光沿边填满一圈，满了整圈一闪', extra: { label: '外扩', min: 0.3, max: 2.5, step: 0.05, def: 1 } },
  { id: 'edge-hop', label: '星光跳跃', group: '边缘律动', hint: '星芒在边上跳着亮，亮处沿边晕开', extra: { label: '星点', min: 2, max: 10, step: 1, def: 6 } },
]
// inert：这个方案里不起作用的参数（对话框里置灰禁用，悬停说明原因），由测试逐个核对其余参数都真改画面
for (const e of EDGE_SCHEMES) SWEEP_SCHEMES.push({ ...e, edge: true, wrap: true, fixedColor: !!e.fixedColor, noStart: !!e.noStart, sigma: 1, span: 1, frames: 40, ...(e.noStart ? { inert: { start: '整圈同时在动，没有起点' } } : {}) })

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
  start: 0,           // 边缘扫光：起点（度，沿轮廓）/ 斜向扫光的方向
  laps: 1,            // 边缘扫光：时长内重复几次
  hue: 0,             // 边缘扫光（自带配色的）：色相偏移（度）
  // extra 不给默认：各方案自己的默认值（EDGE_SCHEMES[].extra.def）
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
  // 光晕开大，泛光伸得更远：边距跟着放大（不然切片边上被切出矩形）；光晕对它无效的方案不放大
  const gk = s && s.inert && s.inert.glow ? 1 : Math.max(1, Number(params.glow) || 1)
  if (s && s.edge) return Math.max(24, Math.round(48 * edgeScale(w, h, params) * gk))   // 外扩的光环 / 火苗 / 烟雾要的空间
  const ratio = s?.padRatio || 0
  return Math.round(Math.max(36, Math.round(Math.max(w, h) * ratio)) * gk)
}

// ---------- 分析底图

/**
 * @param {Uint8ClampedArray} rgba 底图像素（直通 alpha）
 * @param {number} w @param {number} h
 * @param {object} params 见 DEFAULT_PARAMS（用到 scheme / pad / colorMode / color）
 */
function analyzeBase(rgba, w, h, params = DEFAULT_PARAMS) {
  let P = { ...DEFAULT_PARAMS, ...params }
  const sch = SWEEP_SCHEMES.find((x) => x.id === P.scheme)
  if (sch && sch.edge && !P._inner) {
    const e = analyzeEdgeBase(rgba, w, h, P)
    if (e && e.ctx) return e.ctx
    if (e) P = e.Q
  }
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
  // 光晕参数：半径在各方案的调用里 × gk，强度在这里 × gk（只改半径时 0.3 ↔ 2.5 几乎看不出来）
  const gk = ctx._gk || 1; k1 *= gk; k2 *= gk
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

// ---------- 边缘扫光（2026-10-13，work/sweep-light-lab 五轮里用户选定的 20 种）
// 光只沿轮廓走，不是整张图扫过：轮廓按 alpha 0.5 追踪（每个字 / 部件 / 镂空各一圈），每个像素拿到
// 最近轮廓点的「沿轮廓位置」T∈[0,1)、内外距离 din / dout、带符号距离 sd（字内为负）、外法线；
// 20 种效果都是这些量的函数。原型是 work/sweep-light-lab/edge-sweeps{,2,3,5}.py（numpy），这里逐项照搬；
// 像素尺寸按原型（图对角线 ≤ 700 px），更大的图按对角线等比放大（edgeScale）。

/** 边缘效果的像素尺度：小图 1，大图按对角线放大；预览图缩小了 params.scale 倍，尺寸跟着缩。 */
function edgeScale(w, h, params) {
  const sc = Number(params && params.scale) > 0 ? Number(params.scale) : 1
  return Math.max(1, Math.hypot(w, h) / sc / 700) * sc
}

/**
 * 边缘扫光只在图的可见内容附近算：大片透明边的图（958×1350 里一只 251×405 的手臂）裁到内容 + 边距再算，
 * 算完贴回原尺寸的帧（切片尺寸 / 对位不变）；尺度按可见内容的对角线，不按画布。
 */
function analyzeEdgeBase(rgba, w, h, P) {
  let x0 = w, x1 = -1, y0 = h, y1 = -1, ox0 = w, ox1 = -1, oy0 = h, oy1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const al = rgba[(y * w + x) * 4 + 3]
    if (al > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    if (al > 127) { if (x < ox0) ox0 = x; if (x > ox1) ox1 = x; if (y < oy0) oy0 = y; if (y > oy1) oy1 = y }
  }
  if (x1 < 0) return null
  const diag = ox1 >= 0 ? Math.hypot(ox1 - ox0 + 1, oy1 - oy0 + 1) : Math.hypot(x1 - x0 + 1, y1 - y0 + 1)
  const S = edgeScale(diag, 0, P) * Math.max(0.2, Number(P.width) || 1)   // 粗细：整体放大缩小（边距跟着变）
  const pad = P.pad > 0 ? Math.round(P.pad) : Math.max(24, Math.round(48 * S * Math.max(1, Number(P.glow) || 1)))
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1
  const Q = { ...P, pad, _edgeS: S }
  if (cw * ch > w * h * 0.8) return { Q }                       // 内容占满画布：不裁
  const sub = new Uint8ClampedArray(cw * ch * 4)
  for (let y = 0; y < ch; y++) sub.set(rgba.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + cw) * 4), y * cw * 4)
  const inner = analyzeBase(sub, cw, ch, { ...Q, _inner: true })
  return { ctx: { crop: { x: x0, y: y0 }, inner, w, h, pad, W: w + 2 * pad, H: h + 2 * pad, params: Q } }
}

const circ = (d) => { d = (d + 0.5) % 1; if (d < 0) d += 1; return d - 0.5 }
function hsvToRgb(h, s, v) {
  h = (((h % 1) + 1) % 1) * 6
  const i = Math.floor(h) % 6, f = h - Math.floor(h)
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f))
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i]
}
function rgbToHsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  let h = 0
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6; if (h < 0) h += 1
  }
  return [h, mx > 0 ? d / mx : 0, mx]
}
function complementColor(mid) {
  const [hh, s] = rgbToHsv(mid[0], mid[1], mid[2])
  return hsvToRgb(hh + 0.5, Math.max(s, 0.65), 1)
}

// 平滑值噪声（256 格周期）+ 分形
let NOISE_LAT = null
function vnoise(x, y) {
  if (!NOISE_LAT) { const rnd = mulberry32(7); NOISE_LAT = new Float32Array(65536); for (let i = 0; i < 65536; i++) NOISE_LAT[i] = rnd() }
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const x0 = xi & 255, y0 = yi & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255
  const A = NOISE_LAT[y0 * 256 + x0], B = NOISE_LAT[y0 * 256 + x1], C = NOISE_LAT[y1 * 256 + x0], D = NOISE_LAT[y1 * 256 + x1]
  const top = A + (B - A) * ux
  return top + (C + (D - C) * ux - top) * uy
}
function fbm(x, y, oct) {
  let s = 0, amp = 1, tot = 0, m = 1
  for (let o = 0; o < oct; o++) { s += amp * vnoise(x * m + o * 37.1, y * m + o * 11.7); tot += amp; amp *= 0.5; m *= 2 }
  return s / tot
}
function hash1(x) { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; const f = v - Math.trunc(v); return ((f % 1) + 1) % 1 }
/** 沿轮廓的一维噪声，时间上首尾相接（p=0 与 p=1 相同）。 */
function loopNoise(t, p, freq, seed) {
  let out = 0, amp = 1
  const ph = 2 * Math.PI * p
  for (let o = 0; o < 3; o++) {
    const f = freq * (1 << o), x = t * f, i0 = Math.floor(x), fr = x - i0, u = fr * fr * (3 - 2 * fr)
    const a0 = Math.sin(hash1(i0 + seed + o * 17) * 6.283 + ph * (1 + o))
    const a1 = Math.sin(hash1(((i0 + 1) % f) + seed + o * 17) * 6.283 + ph * (1 + o))
    out += amp * (a0 + (a1 - a0) * u); amp *= 0.5
  }
  return out / 1.75
}
/** 同 loopNoise，但先按这一帧的 p 把格点值算成表，像素上只插值（闪电 / 光剑每帧几十万次）。 */
function loopNoiseTable(p, freq, seed) {
  const ph = 2 * Math.PI * p, oct = []
  for (let o = 0; o < 3; o++) {
    const f = freq * (1 << o), tab = new Float64Array(f + 1)
    for (let i = 0; i <= f; i++) tab[i] = Math.sin(hash1((i % f) + seed + o * 17) * 6.283 + ph * (1 + o))
    oct.push({ f, tab })
  }
  return (t) => {
    let out = 0, amp = 1
    for (let o = 0; o < 3; o++) {
      const { f, tab } = oct[o], x = t * f, i0 = Math.floor(x), fr = x - i0, u = fr * fr * (3 - 2 * fr)
      const k = ((i0 % f) + f) % f, a0 = tab[k], a1 = tab[k + 1]
      out += amp * (a0 + (a1 - a0) * u); amp *= 0.5
    }
    return out / 1.75
  }
}
const FIRE_STOPS = [[0, 0, 0], [0.55, 0.06, 0.02], [1, 0.38, 0.05], [1, 0.78, 0.25], [1, 1, 0.85]], FIRE_POS = [0, 0.3, 0.55, 0.8, 1]
function fireRamp(v, out) {
  v = clamp01(v)
  for (let k = 0; k < 4; k++) {
    if (v <= FIRE_POS[k + 1]) {
      const t = (v - FIRE_POS[k]) / (FIRE_POS[k + 1] - FIRE_POS[k]), A = FIRE_STOPS[k], B = FIRE_STOPS[k + 1]
      out[0] = A[0] + (B[0] - A[0]) * t; out[1] = A[1] + (B[1] - A[1]) * t; out[2] = A[2] + (B[2] - A[2]) * t
      return out
    }
  }
  out[0] = 1; out[1] = 1; out[2] = 0.85; return out
}
/** 拖尾配色：尾端深色 → 主体底图色 → 头部白。 */
function ramp3(f, deep, mid, hot, out) {
  f = clamp01(f)
  if (f < 0.6) { const u = f / 0.6; for (let c = 0; c < 3; c++) out[c] = deep[c] * (1 - u) + mid[c] * u }
  else { const u = (f - 0.6) / 0.4; for (let c = 0; c < 3; c++) out[c] = mid[c] * (1 - u) + hot[c] * u }
  return out
}

// 精确欧氏距离变换（Felzenszwalb），可带最近种子的下标
function edt1(f, n, d, arg, v, z) {
  let k = 0
  v[0] = 0; z[0] = -1e30; z[1] = 1e30
  for (let q = 1; q < n; q++) {
    let r = v[k], s = (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r)
    while (s <= z[k]) { k--; r = v[k]; s = (f[q] + q * q - (f[r] + r * r)) / (2 * q - 2 * r) }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e30
  }
  k = 0
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const r = v[k]; d[q] = (q - r) * (q - r) + f[r]; arg[q] = r }
}
function edt(seed, W, H, wantArg) {
  const N = W * H, INF = 1e20, n = Math.max(W, H)
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1), v = new Int32Array(n), ag = new Int32Array(n)
  const col = new Float64Array(N), colArg = wantArg ? new Int32Array(N) : null
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = seed[y * W + x] ? 0 : INF
    edt1(f, H, d, ag, v, z)
    for (let y = 0; y < H; y++) { col[y * W + x] = d[y]; if (colArg) colArg[y * W + x] = ag[y] }
  }
  const d2 = new Float32Array(N), arg = wantArg ? new Int32Array(N) : null
  for (let y = 0; y < H; y++) {
    const row = y * W
    for (let x = 0; x < W; x++) f[x] = col[row + x]
    edt1(f, W, d, ag, v, z)
    for (let x = 0; x < W; x++) { d2[row + x] = d[x]; if (arg) { const sx = ag[x]; arg[row + x] = colArg[row + sx] * W + sx } }
  }
  return { d2, arg }
}

/** 轮廓：二值图上的 marching squares（前景按 8 连通），每圈一条闭合折线；外圈逆时针、镂空顺时针（同 OpenCV），从最上最左起。 */
function traceContours(mask, W, H, minLen) {
  const N = W * H
  const nbA = new Int32Array(2 * N).fill(-1), nbB = new Int32Array(2 * N).fill(-1)
  const link = (e1, e2) => { if (nbA[e1] < 0) nbA[e1] = e2; else nbB[e1] = e2; if (nbA[e2] < 0) nbA[e2] = e1; else nbB[e2] = e1 }
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const i = y * W + x
    const c = (mask[i] << 3) | (mask[i + 1] << 2) | (mask[i + W + 1] << 1) | mask[i + W]
    if (c === 0 || c === 15) continue
    const top = i * 2, bottom = (i + W) * 2, left = i * 2 + 1, right = (i + 1) * 2 + 1
    switch (c) {
      case 1: case 14: link(left, bottom); break
      case 2: case 13: link(bottom, right); break
      case 3: case 12: link(left, right); break
      case 4: case 11: link(top, right); break
      case 6: case 9: link(top, bottom); break
      case 7: case 8: link(left, top); break
      case 5: link(left, top); link(bottom, right); break
      case 10: link(top, right); link(left, bottom); break
    }
  }
  const seen = new Uint8Array(2 * N), out = []
  for (let e0 = 0; e0 < 2 * N; e0++) {
    if (nbA[e0] < 0 || seen[e0]) continue
    const ids = []
    let prev = -1, cur = e0
    for (;;) {
      seen[cur] = 1; ids.push(cur)
      const nx = nbA[cur] !== prev ? nbA[cur] : nbB[cur]
      prev = cur; cur = nx
      if (cur < 0 || cur === e0 || seen[cur]) break
    }
    if (ids.length < 8) continue
    const n = ids.length, xs = new Float32Array(n), ys = new Float32Array(n), inside = new Int32Array(n)
    for (let k = 0; k < n; k++) {
      const e = ids[k], pix = e >> 1, x = pix % W, y = (pix - x) / W
      if (e & 1) { xs[k] = x; ys[k] = y + 0.5; inside[k] = mask[pix] ? pix : pix + W }
      else { xs[k] = x + 0.5; ys[k] = y; inside[k] = mask[pix] ? pix : pix + 1 }
    }
    let len = 0, area = 0
    for (let k = 0; k < n; k++) { const j = (k + 1) % n; len += Math.hypot(xs[j] - xs[k], ys[j] - ys[k]); area += xs[k] * ys[j] - xs[j] * ys[k] }
    if (len < minLen) continue
    // 外圈（前景在圈里）还是镂空：看第一点的前景像素在不在圈里
    const px = inside[0] % W, py = (inside[0] - px) / W
    let inPoly = false
    for (let k = 0, j = n - 1; k < n; j = k++) if ((ys[k] > py) !== (ys[j] > py) && px < ((xs[j] - xs[k]) * (py - ys[k])) / (ys[j] - ys[k]) + xs[k]) inPoly = !inPoly
    if ((inPoly && area > 0) || (!inPoly && area < 0)) { xs.reverse(); ys.reverse(); inside.reverse() }
    let s0 = 0
    for (let k = 1; k < n; k++) if (ys[k] < ys[s0] || (ys[k] === ys[s0] && xs[k] < xs[s0])) s0 = k
    const X = new Float32Array(n), Y = new Float32Array(n), I = new Int32Array(n), t = new Float32Array(n)
    for (let k = 0; k < n; k++) { const j = (k + s0) % n; X[k] = xs[j]; Y[k] = ys[j]; I[k] = inside[j] }
    let acc = 0
    for (let k = 0; k < n; k++) { t[k] = acc / len; const j = (k + 1) % n; acc += Math.hypot(X[j] - X[k], Y[j] - Y[k]) }
    out.push({ x: X, y: Y, inside: I, t, len })
  }
  return out
}

/** 一次分析（缓存在 ctx 上）：轮廓、T、距离、法线、主色调。 */
function edgeGeo(ctx) {
  if (ctx._edge) return ctx._edge
  const { W, H, N, a, r, g, b } = ctx
  const S = ctx.params._edgeS || edgeScale(ctx.w, ctx.h, ctx.params)
  const mask = new Uint8Array(N), inv = new Uint8Array(N)
  let any = false
  for (let i = 0; i < N; i++) { const m = a[i] > 0.5 ? 1 : 0; mask[i] = m; inv[i] = 1 - m; if (m) any = true }
  const din = plane(N), dout = plane(N)
  if (any) {
    const ei = edt(inv, W, H, false), eo = edt(mask, W, H, false)
    for (let i = 0; i < N; i++) { if (mask[i]) din[i] = Math.sqrt(ei.d2[i]); else dout[i] = Math.sqrt(eo.d2[i]) }
  } else dout.fill(1e6)
  const contours = any ? traceContours(mask, W, H, 20) : []
  const T = plane(N), Lpx = plane(N, 1), CID = new Int32Array(N).fill(-1)
  if (contours.length) {
    const seed = new Uint8Array(N), sT = plane(N), sL = plane(N), sC = new Int32Array(N)
    contours.forEach((c, ci) => { for (let k = 0; k < c.t.length; k++) { const px = c.inside[k]; seed[px] = 1; sT[px] = c.t[k]; sL[px] = c.len; sC[px] = ci } })
    const { arg } = edt(seed, W, H, true)
    for (let i = 0; i < N; i++) { T[i] = sT[arg[i]]; Lpx[i] = sL[arg[i]]; CID[i] = sC[arg[i]] }
  }
  // 接缝（用户 2026-10-13：轮廓上一圈杂点、不圆润）：原来按 alpha 0.5 硬切成字内 / 字外，轮廓那圈半透明
  // （抗锯齿）像素 din = 0、又在两边的遮罩里都算满，比两侧都亮，沿锯齿断断续续成一圈亮点。现在：
  //  · 距离连续：轮廓上的半透明像素 din = a、dout = 1 − a（a 0.5 正好在边上；纯边像素 a=1 → din 1、a=0 → dout 1 不变），
  //    sd = dout − din 从 −1 平滑过到 +1
  //  · 字内光带 × wIn、字外光晕 × wOut，按覆盖率互补（加起来 = 1），不再两边都算满
  //  · 合成不切：整层光 (1 − 底图预乘)·L（字内防曝、字外相加），纯字内 / 纯字外像素和原来一样
  for (let i = 0; i < N; i++) {
    const ai = a[i]
    if (ai > 0.02 && ai < 0.98 && (mask[i] ? din[i] <= 1 : dout[i] <= 1)) { din[i] = ai; dout[i] = 1 - ai }
  }
  //  · 距离场在二值遮罩上算，轮廓是像素阶梯：光带峰值沿阶梯走就是一条锯齿亮线。sd 轻模糊（0.8 px）抹平阶梯，
  //    再由它统一推出 din / dout（−1..1 之间线性过渡）和 wIn / wOut，处处连续
  const sd0 = plane(N)
  for (let i = 0; i < N; i++) sd0[i] = dout[i] - din[i]
  const sd = blurPlane(sd0, W, H, 0.8)
  const wIn = plane(N), wOut = plane(N)
  let dinMax = 0
  for (let i = 0; i < N; i++) {
    const v = sd[i]
    if (v <= -1) { din[i] = -v; dout[i] = 0 } else if (v >= 1) { din[i] = 0; dout[i] = v } else { din[i] = (1 - v) / 2; dout[i] = (1 + v) / 2 }
    const w = clamp01((1 - v) / 2); wIn[i] = w; wOut[i] = 1 - w
    if (din[i] > dinMax) dinMax = din[i]
  }
  const sm = blurPlane(sd, W, H, 2 * S)
  const nx = plane(N), ny = plane(N)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    const gx = x === 0 ? sm[i + 1] - sm[i] : x === W - 1 ? sm[i] - sm[i - 1] : (sm[i + 1] - sm[i - 1]) / 2
    const gy = y === 0 ? sm[i + W] - sm[i] : y === H - 1 ? sm[i] - sm[i - W] : (sm[i + W] - sm[i - W]) / 2
    const n = Math.sqrt(gx * gx + gy * gy) + 1e-6
    nx[i] = gx / n; ny[i] = gy / n
  }
  // 两个字 / 部件之间：每个像素只认最近那条轮廓，分界线上光的位置 / 颜色一下跳到另一条轮廓的（光晕里一道竖直切线）。
  // 分界线（字外、四邻属于不同轮廓）附近把光和它的模糊版混一下（edgeFinish 用 vmix）
  let vmix = null
  if (contours.length > 1) {
    const B = plane(N)
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      if (sd[i] <= 0.5) continue
      const c = CID[i]
      if (CID[i - 1] !== c || CID[i + 1] !== c || CID[i - W] !== c || CID[i + W] !== c) B[i] = 1
    }
    const bb = blurPlane(B, W, H, 3 * S)
    vmix = plane(N)
    let any = false
    for (let i = 0; i < N; i++) { const v = clamp01(bb[i] * 5) * clamp01((sd[i] - 1) / (2 * S)); vmix[i] = v; if (v > 0.001) any = true }
    if (!any) vmix = null
  }
  // 只算离轮廓 64 px（× 尺度）以内的像素
  const lim = 64 * S, nearList = []
  for (let i = 0; i < N; i++) if (Math.abs(sd[i]) <= lim) nearList.push(i)
  const near = Int32Array.from(nearList)
  // 图本身的光色：饱和色的主色调（BIG WIN → 蓝，金饰 → 金），提到满亮度；不是几种颜色的灰平均
  const hist = new Float64Array(36)
  let cx = 0, cy = 0, cn = 0
  for (let i = 0; i < N; i++) {
    if (!mask[i]) continue
    const x = i % W; cx += x; cy += (i - x) / W; cn++
    const [hh, s, v] = rgbToHsv(Math.round(r[i] * 255) / 255, Math.round(g[i] * 255) / 255, Math.round(b[i] * 255) / 255)
    hist[Math.min(35, Math.floor(hh * 36))] += s * v
  }
  const sm5 = new Float64Array(36)
  for (let k = 0; k < 36; k++) sm5[k] = hist[(k + 34) % 36] + 2 * hist[(k + 35) % 36] + 3 * hist[k] + 2 * hist[(k + 1) % 36] + hist[(k + 2) % 36]
  let pk = 0; for (let k = 1; k < 36; k++) if (sm5[k] > sm5[pk]) pk = k
  const glow = hsvToRgb((pk + 0.5) / 36, 0.62, 1)
  const mid = ctx.solid ? ctx.solid.slice() : glow
  const { x0, x1, y0, y1 } = ctx.bbox
  ctx._edge = { S, W, H, N, a, wIn, wOut, vmix, mask, din, dout, sd, nx, ny, T, L: Lpx, contours, near, dinMax, glow, mid, deep: mid.map((v) => v * 0.45), hot: [1, 1, 1], bbox: { x0, x1, y0, y1 }, cx: cn ? cx / cn : W / 2, cy: cn ? cy / cn : H / 2, cache: {} }
  return ctx._edge
}

/** 起点：沿轮廓位置整体挪 start（0..1）。按 start 缓存一份挪过的 T / 轮廓 t（随机点缓存也各自一份）。 */
function edgeGeoK(ctx, K) {
  const E = edgeGeo(ctx)
  const off = (((K.start || 0) % 1) + 1) % 1
  if (off < 1e-6) return E
  const key = Math.round(off * 1e6)
  E.views = E.views || new Map()
  if (E.views.has(key)) return E.views.get(key)
  const T = plane(E.N)
  for (let i = 0; i < E.N; i++) { let v = E.T[i] - off; if (v < 0) v += 1; T[i] = v }
  const contours = E.contours.map((c) => { const t = new Float32Array(c.t.length); for (let k = 0; k < t.length; k++) { let v = c.t[k] - off; if (v < 0) v += 1; t[k] = v } return { ...c, t } })
  const view = { ...E, T, contours, cache: {} }
  E.views.set(key, view)
  return view
}
function hueRotate(L, deg) {
  if (!deg) return L
  const a = Math.cos((deg * Math.PI) / 180), b = Math.sin((deg * Math.PI) / 180)
  const m = [0.213 + 0.787 * a - 0.213 * b, 0.715 - 0.715 * a - 0.715 * b, 0.072 - 0.072 * a + 0.928 * b,
    0.213 - 0.213 * a + 0.143 * b, 0.715 + 0.285 * a + 0.140 * b, 0.072 - 0.072 * a - 0.283 * b,
    0.213 - 0.213 * a - 0.787 * b, 0.715 - 0.715 * a + 0.715 * b, 0.072 + 0.928 * a + 0.072 * b]
  const [R, G, B] = L
  for (let i = 0; i < R.length; i++) {
    const r = R[i], g = G[i], bb = B[i]
    if (r === 0 && g === 0 && bb === 0) continue
    R[i] = Math.max(0, m[0] * r + m[1] * g + m[2] * bb); G[i] = Math.max(0, m[3] * r + m[4] * g + m[5] * bb); B[i] = Math.max(0, m[6] * r + m[7] * g + m[8] * bb)
  }
  return L
}

/** 每条够长的轮廓上、沿轮廓位置最接近 t 的点：[x, y, 强度]。 */
function headPoints(E, t) {
  const out = []
  for (const c of E.contours) {
    if (c.len < 60 * E.S) continue
    let best = 0, bd = 2
    for (let k = 0; k < c.t.length; k++) { const d = Math.abs(circ(c.t[k] - t)); if (d < bd) { bd = d; best = k } }
    out.push([c.x[best], c.y[best], Math.min(1, c.len / (300 * E.S))])
  }
  return out
}
/** 同上，再带外法线与切线：{ x, y, nx, ny, tx, ty, len } */
function rimAt(E, t) {
  const out = []
  for (const c of E.contours) {
    if (c.len < 60 * E.S) continue
    const n = c.t.length
    let best = 0, bd = 2
    for (let k = 0; k < n; k++) { const d = Math.abs(circ(c.t[k] - t)); if (d < bd) { bd = d; best = k } }
    const i0 = (best - 3 + n) % n, i1 = (best + 3) % n
    let tx = c.x[i1] - c.x[i0], ty = c.y[i1] - c.y[i0]
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l
    const xi = Math.min(E.W - 1, Math.round(c.x[best])), yi = Math.min(E.H - 1, Math.round(c.y[best]))
    let nx = E.nx[yi * E.W + xi], ny = E.ny[yi * E.W + xi]
    if (Math.abs(nx) + Math.abs(ny) < 1e-3) { nx = ty; ny = -tx }
    out.push({ x: c.x[best], y: c.y[best], nx, ny, tx, ty, len: c.len })
  }
  return out
}

/** 四角星芒（可旋转）加到光层 L 上：pts = [[x, y, 强度]]，col 为颜色。 */
function starInto(E, L, col, pts, size, rot, gain) {
  const { W, H } = E, sz = size * E.S
  const ca = Math.cos(rot), sa = Math.sin(rot), rad = Math.floor(22 * sz) + 2
  const cs2 = 2 * (1.8 * sz) ** 2, aw = 0.7 * sz, al = 8 * sz
  for (const [x, y, k] of pts) {
    if (!(k > 0.003)) continue
    const xa = Math.max(0, Math.floor(x) - rad), xb = Math.min(W - 1, Math.floor(x) + rad), ya = Math.max(0, Math.floor(y) - rad), yb = Math.min(H - 1, Math.floor(y) + rad)
    for (let yy = ya; yy <= yb; yy++) for (let xx = xa; xx <= xb; xx++) {
      const dx = xx - x, dy = yy - y, u = dx * ca + dy * sa, v = -dx * sa + dy * ca
      const val = k * gain * (Math.exp(-(dx * dx + dy * dy) / cs2) * 1.6 + (Math.exp(-Math.abs(v) / aw - Math.abs(u) / al) + Math.exp(-Math.abs(u) / aw - Math.abs(v) / al)) * 0.9)
      if (val < 1e-4) continue
      const i = yy * W + xx
      L[0][i] += col[0] * val; L[1][i] += col[1] * val; L[2][i] += col[2] * val
    }
  }
}

/** 一颗沿轮廓跑的流星（头 + 指数拖尾，光带随拖尾变细，深色 → 底图色 → 白）。 */
function cometInto(E, L, head, length, o = {}) {
  const dir = o.dir || 1, hw = o.headW || 0.010, gain = o.gain == null ? 1 : o.gain, flare = o.flare == null ? 1 : o.flare, base = o.base == null ? 0.12 : o.base
  const cols = o.cols || E, deep = cols.deep, mid = cols.mid, hot = cols.hot
  const { near, T, a, din, dout, S } = E, col = [0, 0, 0]
  for (let j = 0; j < near.length; j++) {
    const i = near[j], ai = a[i]
    const bi0 = base && (Math.exp(-((din[i] / (1.2 * S)) ** 2)) * base) * E.wIn[i]
    const d = circ((T[i] - head) * dir)
    const core = Math.exp(-((d / hw) ** 2))
    let tail = d <= 0 ? Math.exp(d / length) : 0
    if (d > 0 && core > tail) tail = core
    if (tail < 1e-4 && core < 1e-4) { if (bi0) { L[0][i] += mid[0] * bi0; L[1][i] += mid[1] * bi0; L[2][i] += mid[2] * bi0 } continue }
    const f = clamp01(tail + core * 0.6)
    const bi = (Math.exp(-((din[i] / Math.max((1.4 + 2.8 * f) * S, 0.3)) ** 2))) * E.wIn[i]
    const bo = (Math.exp(-((dout[i] / Math.max((2.5 + 9.5 * f) * S, 0.3)) ** 2))) * E.wOut[i]
    const lit = (bi * 1.5 + bo * 0.9) * Math.pow(tail, 0.9) * gain
    const hv = clamp01(core * bi * 1.8 - 0.3)
    ramp3(f, deep, mid, hot, col)
    for (let c = 0; c < 3; c++) L[c][i] += col[c] * lit + hot[c] * hv + mid[c] * bi0
  }
  if (flare) starInto(E, L, mid.map((v) => v * 0.3 + 0.7), headPoints(E, head), flare, head * 2 * Math.PI, 0.55)
}

/** 轮廓上一圈常亮的细描边，光在两次经过之间形状也看得清。 */
function baseRimInto(E, L, col, k) {
  if (!(k > 0)) return
  const { near, a, din, S } = E
  for (let j = 0; j < near.length; j++) {
    const i = near[j]
    if (!(E.wIn[i] > 0)) continue
    const v = Math.exp(-((din[i] / (1.2 * S)) ** 2)) * k * E.wIn[i]
    L[0][i] += col[0] * v; L[1][i] += col[1] * v; L[2][i] += col[2] * v
  }
}
function bandIO(E, i, f, i0, i1, o0, o1) {
  const S = E.S, ai = E.a[i]
  BAND[0] = (Math.exp(-((E.din[i] / Math.max((i0 + (i1 - i0) * f) * S, 0.3)) ** 2))) * E.wIn[i]
  BAND[1] = (Math.exp(-((E.dout[i] / Math.max((o0 + (o1 - o0) * f) * S, 0.3)) ** 2))) * E.wOut[i]
  return BAND
}
const BAND = [0, 0]

/**
 * 收尾：泛光（光层 + 模糊 × k），按 alpha 0.5 分成字内（滤色到底图上）和字外（相加）两层，
 * 再换算成 renderSweepFrame 的 inner / outer（和原型的合成公式一致：底图 + (a − 底图预乘)·字内光 + (1 − a)·字外光）。
 */
function edgeFinish(ctx, E, L, bloom, kb, K, replace) {
  const { W, H, N, a } = E
  hueRotate(L, K.hue)
  // 光晕：泛光半径 × gk、泛光强度 × gk、轮廓外的光 × gk^0.6（只改半径时 0.3 ↔ 2.5 几乎看不出来）。
  // 原型没泛光的（火焰 / 光剑 / 金箔）：光晕 > 1 才加一层泛光
  const noBloom = bloom === 0 && !replace, outerK = Math.pow(K.gk, 0.6)
  if (noBloom && K.gk > 1.001) { bloom = 4; kb = 0.6 * (K.gk - 1) / K.gk }
  else if (!replace) kb *= K.gk
  if (bloom > 0) {
    const b = blurRGB(L, W, H, bloom * E.S * K.gk)
    for (let c = 0; c < 3; c++) { const d = L[c], s = b[c]; if (replace) for (let i = 0; i < N; i++) d[i] = s[i] * replace; else for (let i = 0; i < N; i++) d[i] += s[i] * kb }
  }
  if (E.vmix) {   // 两条轮廓之间的分界线：和模糊版混合，光晕不被一刀切开
    const vb = blurRGB(L, W, H, 3 * E.S), vm = E.vmix
    for (let c = 0; c < 3; c++) { const d = L[c], b = vb[c]; for (let i = 0; i < N; i++) { const k = vm[i]; if (k > 0) d[i] += (b[i] - d[i]) * k } }
  }
  // 不按 alpha 切：整层光 (1 − 底图预乘)·L —— renderSweepFrame 的 inner 就是这个，outer 为空
  const wIn = E.wIn, ik = K.ik
  for (let c = 0; c < 3; c++) {
    const d = L[c]
    for (let i = 0; i < N; i++) { let v = d[i]; if (!(v > 0)) continue; if (outerK !== 1) v *= wIn[i] + (1 - wIn[i]) * outerK; v *= ik; d[i] = v > 1 ? 1 : v }
  }
  return { inner: L, outer: zeroRGB(N) }
}
let ZERO_RGB = null
function zeroRGB(N) { if (!ZERO_RGB || ZERO_RGB[0].length !== N) ZERO_RGB = rgbPlanes(N); return ZERO_RGB }
/** 每个效果固定的随机点（星尘 / 金箔星点），按 seed 缓存。 */
function edgeRandomPoints(E, key, seed, every, minLen) {
  if (E.cache[key]) return E.cache[key]
  const rnd = mulberry32(seed), pts = []
  for (const c of E.contours) {
    if (c.len < minLen * E.S) continue
    const k = Math.max(1, Math.floor(c.len / (every * E.S)))
    for (let m = 0; m < k; m++) {
      const idx = Math.min(c.t.length - 1, Math.floor(rnd() * c.t.length))
      const u1 = Math.max(1e-9, rnd()), u2 = rnd(), u3 = Math.max(1e-9, rnd()), u4 = rnd()
      pts.push({ x: c.x[idx], y: c.y[idx], t: c.t[idx], r: rnd(), ox: Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2), oy: Math.sqrt(-2 * Math.log(u3)) * Math.cos(2 * Math.PI * u4) })
    }
  }
  E.cache[key] = pts
  return pts
}

const TWIN_A = { deep: [0, 0.35, 0.6], mid: [0.25, 0.85, 1], hot: [0.9, 1, 1] }
const TWIN_B = { deep: [0.55, 0, 0.35], mid: [1, 0.35, 0.75], hot: [1, 0.92, 1] }
const ICE = [0.5, 0.88, 1]
const AURORA_PAL = [[1, 0.35, 0.65], [0.65, 0.35, 1], [0.3, 0.6, 1], [1, 0.62, 0.3]]
const GOLD = [1, 0.76, 0.3], PALE = [1, 0.95, 0.75]
const WISP_A = [0.55, 0.2, 1], WISP_B = [0.2, 1, 0.75]

const EDGE_FN = {
  'edge-meteor'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N)
    cometInto(E, L, p, 0.28 * K.x)
    return edgeFinish(ctx, E, L, 4, 0.55, K)
  },

  'edge-twin'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N)
    cometInto(E, L, p, 0.2 * K.x, { cols: TWIN_A, base: 0.08 })
    cometInto(E, L, (p + 0.5) % 1, 0.2 * K.x, { cols: TWIN_B, base: 0 })
    return edgeFinish(ctx, E, L, 4, 0.55, K)
  },

  'edge-meet'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, T, mid, hot } = E
    if (p < 0.8) {
      const q = p / 0.8, pos = 0.5 * q * q * (3 - 2 * q)
      cometInto(E, L, pos, 0.12 * K.x, { base: 0.1, gain: 1.1 })
      cometInto(E, L, ((1 - pos) % 1 + 1) % 1, 0.12 * K.x, { dir: -1, base: 0, gain: 1.1 })
    } else {
      const b = (p - 0.8) / 0.2, burst = Math.exp(-b * 3.5), col = mid.map((v) => v * 0.5 + 0.5)
      for (let j = 0; j < near.length; j++) {
        const i = near[j], spread = Math.exp(-Math.abs(circ(T[i] - 0.5)) / (0.02 + 0.35 * b)) * burst
        const [bi, bo] = bandIO(E, i, clamp01(spread * 1.5), 1.5, 6, 3, 22)
        const v = (bi * 1.8 + bo * 1.4) * spread
        L[0][i] += col[0] * v; L[1][i] += col[1] * v; L[2][i] += col[2] * v
      }
      starInto(E, L, hot, headPoints(E, 0.5), 2.2 * (1 - b) + 0.4, 0, burst)
      baseRimInto(E, L, mid, 0.1)
    }
    return edgeFinish(ctx, E, L, 5, 0.6, K)
  },

  'edge-stardust'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), S = E.S
    cometInto(E, L, p, 0.12, { gain: 1.1 })
    const pts = []
    for (const d of edgeRandomPoints(E, 'dust' + K.x, 77, 7 / K.x, 60)) {
      const age = circ(p - d.t)                  // > 0：流星头经过这一点多久了
      if (age < 0 || age > 0.45) continue
      const tw = Math.sin(2 * Math.PI * (age * 9 + d.r)) ** 2
      pts.push([d.x + d.ox * 3 * S, d.y + d.oy * 3 * S - age * 14 * S, Math.pow(1 - age / 0.45, 1.5) * tw * 0.9])
    }
    starInto(E, L, E.mid.map((v) => v * 0.4 + 0.6), pts, 0.55, 0.785, 1)
    return edgeFinish(ctx, E, L, 4, 0.55, K)
  },

  'edge-firecomet'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, T, a, din, sd, W, S } = E, col = [0, 0, 0]
    for (let j = 0; j < near.length; j++) {
      const i = near[j], d = circ(T[i] - p), core = Math.exp(-((d / 0.012) ** 2))
      let tail = d <= 0 ? Math.exp(d / 0.22) : 0
      if (d > 0 && core > tail) tail = core
      if (tail < 1e-4 && core < 1e-4) continue
      const x = i % W, y = (i - x) / W, xs = (x * 0.11) / S, ys = (y * 0.11) / S
      const n = fbm(xs + p * 3, ys + p * 7, 3) * (1 - p) + fbm(xs + (p - 1) * 3, ys + (p - 1) * 7, 3) * p
      const reach = (3 + 16 * tail) * S * K.x, out = Math.max(sd[i], 0)
      const flame = sd[i] > -2 * S ? clamp01(n * 1.5 - out / Math.max(reach, 0.5) - 0.15) * tail : 0
      const rim = (Math.exp(-((din[i] / ((1.5 + 2.5 * tail) * S)) ** 2)) * tail) * E.wIn[i]
      const nearRim = Math.exp(-((Math.abs(sd[i]) / (5 * S)) ** 2))
      const v = clamp01(flame * 1.2 + rim * 0.9 + core * nearRim * 0.9)
      fireRamp(v, col)
      const k = clamp01(v * 1.7)
      L[0][i] += col[0] * k; L[1][i] += col[1] * k; L[2][i] += col[2] * k
    }
    starInto(E, L, [1, 0.9, 0.6], headPoints(E, p), 1.1, p * 2 * Math.PI, 0.5)
    return edgeFinish(ctx, E, L, 3, 0.5, K)
  },

  'edge-bolt'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, T, sd, S } = E
    const n1 = loopNoiseTable(p, 70, 2.2), n2 = loopNoiseTable((p * 3) % 1, 160, 6.6), n3 = loopNoiseTable((p * 2) % 1, 40, 8.1)
    for (let j = 0; j < near.length; j++) {
      const i = near[j], d = circ(T[i] - p), core = Math.exp(-((d / 0.01) ** 2))
      let tail = d <= 0 ? Math.exp(d / 0.18) : 0
      if (d > 0 && core > tail) tail = core
      if (tail < 1e-4 && core < 1e-4) continue
      const disp = (n1(T[i]) * 5 * tail + n2(T[i]) * 2 * tail) * S * K.x
      const arc = Math.exp(-(((sd[i] - disp) / (1.2 * S)) ** 2))
      const gate = clamp01(n3(T[i]) * 1.8 + 0.4)
      const lit = arc * tail * (0.6 + 0.9 * gate) * 1.6 + arc * core * 2
      const halo = Math.exp(-((Math.abs(sd[i]) / (10 * S)) ** 2)) * tail * 0.5
      const wv = clamp01(lit - 1)
      for (let c = 0; c < 3; c++) L[c][i] += ICE[c] * (lit + halo) + wv
    }
    starInto(E, L, ICE, headPoints(E, p), 1, p * 3 * Math.PI, 0.5)   // 星芒转整数个 π/2：循环接得上
    return edgeFinish(ctx, E, L, 3.5, 0.6, K)
  },

  'edge-wideband'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, T, a, din, mid, hot, S } = E
    const col = mid.map((v) => v * 0.75 + 0.25)
    for (let j = 0; j < near.length; j++) {
      const i = near[j], d = circ(T[i] - p), arc = Math.exp(-((d / (0.11 * K.x)) ** 2)), shine = Math.exp(-((d / 0.025) ** 2))
      const [bi, bo] = bandIO(E, i, clamp01(arc), 1.6, 5.5, 3, 16)
      const bi0 = (Math.exp(-((din[i] / (1.3 * S)) ** 2)) * 0.18) * E.wIn[i]
      const v1 = (bi * 1.3 + bo * 0.9) * arc, v2 = (bi * 1.4 + bo * 0.5) * shine
      for (let c = 0; c < 3; c++) L[c][i] += col[c] * v1 + hot[c] * v2 + mid[c] * bi0
    }
    return edgeFinish(ctx, E, L, 5, 0.5, K)
  },

  'edge-counter'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, T, mid, hot } = E
    const c2 = complementColor(mid)
    const cB = { deep: c2.map((v) => v * 0.45), mid: c2, hot: [0.92, 1, 1] }
    cometInto(E, L, p, 0.16 * K.x, { base: 0.1, gain: 1.1, flare: 0.7 })
    cometInto(E, L, (((0.5 - p) % 1) + 1) % 1, 0.16 * K.x, { dir: -1, cols: cB, base: 0, gain: 1.1, flare: 0.7 })
    const mixc = mid.map((v, c) => (v + c2[c]) * 0.35 + 0.3)
    for (const meet of [0.25, 0.75]) {
      const env = Math.exp(-((Math.abs(circ(p - meet)) / 0.035) ** 2))
      if (env < 0.02) continue
      for (let j = 0; j < near.length; j++) {
        const i = near[j], spread = Math.exp(-Math.abs(circ(T[i] - meet)) / 0.05)
        const [bi, bo] = bandIO(E, i, clamp01(spread), 1.5, 5, 3, 18)
        const v = (bi * 1.4 + bo * 1.2) * spread * env
        L[0][i] += mixc[0] * v; L[1][i] += mixc[1] * v; L[2][i] += mixc[2] * v
      }
      starInto(E, L, hot, headPoints(E, meet), 1 + 1.6 * env, p * 1.5 * Math.PI, env)
    }
    return edgeFinish(ctx, E, L, 4, 0.55, K)
  },

  'edge-innerflow'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, T, a, din, dout, sd, mid, hot, S } = E
    const c2 = complementColor(mid).map((v, c) => v * 0.35 + mid[c] * 0.65)
    const depth = Math.max(6 * S, Math.min(18 * S, E.dinMax * 0.45))   // 光伸进面里多深
    baseRimInto(E, L, mid, 0.12)
    for (const [head, col] of [[p, mid], [(p + 0.5) % 1, c2]]) {
      for (let j = 0; j < near.length; j++) {
        const i = near[j], d = circ(T[i] - head), body = Math.exp(-((d / (0.12 * K.x)) ** 2)), core = Math.exp(-((d / 0.035) ** 2))
        if (body < 1e-4) continue
        const inner = (Math.exp(-Math.pow(din[i] / (depth * (0.45 + 0.55 * body)), 1.5))) * E.wIn[i]
        const rim = Math.exp(-(((sd[i] + 0.8 * S) / (1.6 * S)) ** 2))
        const lip = (Math.exp(-((dout[i] / (5 * S)) ** 2))) * E.wOut[i]
        const lit = inner * body * 1.15 + rim * (body * 1.4 + core * 1.2) + lip * body * 0.6
        const w = clamp01(rim * core * 1.6 - 0.4) + inner * core * 0.35
        for (let c = 0; c < 3; c++) L[c][i] += col[c] * lit + hot[c] * w
      }
    }
    return edgeFinish(ctx, E, L, 4, 0.5, K)
  },

  'edge-fire'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, ny, sd, W, S } = E, col = [0, 0, 0]
    const P = 48 * S
    for (let j = 0; j < near.length; j++) {
      const i = near[j], s = sd[i]
      if (s < -8 * S || s > 44 * S * K.x) continue
      const x = i % W, y = (i - x) / W, xs = (x * 0.09) / S
      const field = (q) => fbm(xs, ((y + q * P) * 0.09 * 0.55) / S + 3, 4)
      const n = field(p) * (1 - p) + field(p - 1) * p
      const up = clamp01(-ny[i]), reach = (7 + 20 * Math.pow(up, 1.5)) * S * K.x
      let v
      if (s > 0) v = clamp01(n * 1.55 - (s / reach) * 1.1 - 0.12)
      else v = Math.exp(-((-s / (2.6 * S)) ** 2)) * (0.55 + 0.45 * n) * 0.85
      if (v <= 0) continue
      fireRamp(v * 1.05, col)
      const k = clamp01(v * 1.6)
      L[0][i] += col[0] * k; L[1][i] += col[1] * k; L[2][i] += col[2] * k
    }
    return edgeFinish(ctx, E, L, 0, 0, K)
  },

  'edge-chrome'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, nx, ny, a, din, dout, mid, S } = E
    const lx = Math.cos(2 * Math.PI * (p + K.start)), ly = Math.sin(2 * Math.PI * (p + K.start)), col = mid.map((v) => v * 0.35 + 0.65), ex = 18 * K.x
    for (let j = 0; j < near.length; j++) {
      const i = near[j], facing = clamp01(nx[i] * lx + ny[i] * ly)
      if (facing <= 0) continue
      const spec = Math.pow(facing, ex), soft = facing * facing * facing
      const bevel = (Math.exp(-((din[i] / (4 * S)) ** 2))) * E.wIn[i]
      const lip = (Math.exp(-((dout[i] / (3 * S)) ** 2))) * E.wOut[i]
      const v = (spec * 2.4 + soft * 0.45) * bevel + spec * 1.6 * lip
      L[0][i] += col[0] * v; L[1][i] += col[1] * v; L[2][i] += col[2] * v
    }
    return edgeFinish(ctx, E, L, 6, 0.9, K)
  },

  'edge-aurora'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, a, din, dout, W, cx, cy, S } = E
    for (let j = 0; j < near.length; j++) {
      const i = near[j], x = i % W, y = (i - x) / W
      let th = Math.atan2(y - cy, (x - cx) * 0.6) / (2 * Math.PI) + 1 - p - K.start
      th = ((th % 1) + 1) % 1
      const k = th * 4, i0 = Math.floor(k) % 4, i1 = (i0 + 1) % 4
      let f = k - Math.floor(k); f = f * f * (3 - 2 * f)
      const inner = (Math.exp(-din[i] / (9 * S * K.x)) * 0.75) * E.wIn[i]
      const outer = (Math.exp(-dout[i] / (10 * S * K.x))) * E.wOut[i]
      const sweep = 0.55 + 0.45 * Math.cos(2 * Math.PI * th) ** 2, v = (inner + outer) * sweep
      for (let c = 0; c < 3; c++) L[c][i] += (AURORA_PAL[i0][c] * (1 - f) + AURORA_PAL[i1][c] * f) * v
    }
    return edgeFinish(ctx, E, L, 2, 0, K, 1.35)
  },

  'edge-saber'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, T, sd, S } = E
    const col = hsvToRgb((0.86 + 0.12 * Math.sin(2 * Math.PI * p)) % 1, 0.85, 1)
    const flick = 0.82 + (0.18 * loopNoise(0.3, p, 3, 4.2) + 0.08 * Math.sin(2 * Math.PI * p * 9)) * K.x
    const cc = col.map((v) => v * 0.25 + 0.75), nw = loopNoiseTable(p, 30, 1.7)
    for (let j = 0; j < near.length; j++) {
      const i = near[j], s = sd[i], as = Math.abs(s)
      const wob = nw(T[i]) * 0.6 * S * K.x
      const core = Math.exp(-(((s + 0.4 * S - wob) / (1.15 * S)) ** 2))
      const g1 = Math.exp(-((as / (5 * S)) ** 2)), g2 = Math.exp(-as / (13 * S)) * 0.55
      const v1 = (g1 * 1.2 + g2) * flick, v2 = core * 1.6 * flick
      for (let c = 0; c < 3; c++) L[c][i] += col[c] * v1 + cc[c] * v2
    }
    return edgeFinish(ctx, E, L, 0, 0, K)
  },

  'edge-goldfoil'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, nx, ny, a, din, dout, S } = E
    const lx = Math.cos(2 * Math.PI * (p + K.start)), ly = Math.sin(2 * Math.PI * (p + K.start))
    for (let j = 0; j < near.length; j++) {
      const i = near[j], facing = Math.pow(clamp01(nx[i] * lx + ny[i] * ly), 3)
      const band = (Math.exp(-((din[i] / (4.5 * S)) ** 2))) * E.wIn[i]
      const lip = (Math.exp(-((dout[i] / (4 * S)) ** 2))) * E.wOut[i]
      const v = band * (0.75 + facing * 1.8) + lip * (0.35 + facing * 1.2), w = clamp01(band * facing - 0.55) * 0.9
      for (let c = 0; c < 3; c++) L[c][i] += GOLD[c] * v + w
    }
    const pts = []
    for (const d of edgeRandomPoints(E, 'foil' + K.x, 23, 9 / K.x, 0)) {
      const ph = (p * 3 + d.r) % 1
      pts.push([d.x, d.y, (ph < 0.35 ? Math.max(0, Math.sin((Math.PI * ph) / 0.35)) : 0) * 0.9])
    }
    starInto(E, L, PALE, pts, 0.75, Math.PI / 4, 1)
    return edgeFinish(ctx, E, L, 0, 0, K)
  },

  'edge-wisps'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, ny, sd, a, din, W, S } = E
    const P = 60 * S
    for (let j = 0; j < near.length; j++) {
      const i = near[j], s = sd[i]
      if (s < -8 * S || s > 50 * S * K.x) continue
      const x = i % W, y = (i - x) / W
      const field = (q) => {
        const Y = y + q * P
        const wx = fbm((x * 0.035) / S + 7, (Y * 0.035) / S, 3)
        return fbm((x * 0.05) / S + wx * 2.2, (Y * 0.05) / S + wx * 1.5, 4)
      }
      const n = field(p) * (1 - p) + field(p - 1) * p
      const reach = (10 + 26 * clamp01(-ny[i])) * S * K.x
      const smoke = s > -S ? clamp01(n * 1.7 - Math.max(s, 0) / reach - 0.35) : 0
      const rim = (Math.exp(-((din[i] / (2.5 * S)) ** 2)) * (0.4 + 0.6 * n)) * E.wIn[i]
      const v = smoke * 1.4 + rim * 0.9
      if (v <= 0) continue
      for (let c = 0; c < 3; c++) L[c][i] += (WISP_A[c] * (1 - n) + WISP_B[c] * n) * v
    }
    return edgeFinish(ctx, E, L, 2.5, 0.5, K)
  },

  'edge-neon'(ctx, p, K) {
    // 原型直接给字内 / 字外两层；这里按覆盖率合成一层（同其他边缘效果，轮廓上没有接缝）
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, T, din, dout, wIn, wOut, S } = E
    const nb = Math.max(1, Math.round(K.x))
    for (let j = 0; j < near.length; j++) {
      const i = near[j]
      const win = Math.exp(-((din[i] / (2.6 * S)) ** 2)) * wIn[i] * 1.35
      const wout = Math.exp(-((dout[i] / (12 * S)) ** 2)) * wOut[i] * 1.05
      if (win < 1e-4 && wout < 1e-4) continue
      const col = hsvToRgb(T[i] * nb - p, 0.85, 1), flow = 0.75 + 0.25 * Math.cos(2 * Math.PI * (T[i] * 3 * nb - p * 3)), v = (win + wout) * flow
      for (let c = 0; c < 3; c++) L[c][i] = col[c] * v
    }
    return edgeFinish(ctx, E, L, 0, 0, K)
  },

  'edge-diagonal'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, a, din, sd, W, mid, hot, S } = E
    // 斜线走完整张图（末尾已出右下角），扫过留下的余光最后 15% 淡掉：循环回到开头不闪
    // 方向：0° = 原型的方向（左上 → 右下偏平）；包围盒归一化坐标里的单位方向，投影值缩放到 0..1.35
    const { x0, x1, y0, y1 } = E.bbox, pos = -0.25 + 1.7 * p, col = mid.map((v) => v * 0.55 + 0.45), wakeK = clamp01((1 - p) / 0.15)
    const th = Math.atan2(0.35, 1) + (K.startDeg * Math.PI) / 180, dx = Math.cos(th), dy = Math.sin(th)
    const corners = [0, dx, dy, dx + dy], umin = Math.min(...corners), uspan = Math.max(...corners) - umin || 1
    for (let j = 0; j < near.length; j++) {
      const i = near[j], x = i % W, y = (i - x) / W
      const dd = (((x - x0) / Math.max(1, x1 - x0)) * dx + ((y - y0) / Math.max(1, y1 - y0)) * dy - umin) / uspan * 1.35 - pos
      const front = Math.exp(-((dd / (0.035 * K.x)) ** 2)), wake = dd < 0 ? Math.exp(dd / 0.25) * wakeK : 0
      const edge = Math.exp(-(((sd[i] + S) / (3 * S)) ** 2)), halo = Math.exp(-((Math.abs(sd[i]) / (11 * S)) ** 2))
      const v = edge * (front * 3 + wake * 0.9) + halo * front * 1.1, w = clamp01(edge * front * 1.3 - 0.5)
      const bi0 = (Math.exp(-((din[i] / (1.3 * S)) ** 2)) * 0.15) * E.wIn[i]
      for (let c = 0; c < 3; c++) L[c][i] += col[c] * v + hot[c] * w + mid[c] * bi0
    }
    return edgeFinish(ctx, E, L, 4, 0.5, K)
  },

  'edge-ripple'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, T, sd, deep, mid, hot, S } = E
    const nr = Math.max(1, Math.round(K.x))
    const rings = Array.from({ length: nr }, (_, k) => k).map((k) => { const ph = (p * 3 + k / nr) % 1; return { r: (1.5 + 24 * Math.pow(ph, 0.85)) * S, w: (1.6 + 3.2 * ph) * S, fade: Math.pow(1 - ph, 1.8), col: ramp3(0.75 - 0.35 * ph, deep, mid, hot, [0, 0, 0]) } })
    const col = [0, 0, 0]
    for (let j = 0; j < near.length; j++) {
      const i = near[j], s = sd[i], d = circ(T[i] - p), flow = 0.25 + 1.1 * Math.exp(-((d / 0.22) ** 2))
      if (s > -S) for (const R of rings) {
        const v = Math.exp(-(((s - R.r) / R.w) ** 2)) * R.fade * flow * 1.5
        L[0][i] += R.col[0] * v; L[1][i] += R.col[1] * v; L[2][i] += R.col[2] * v
      }
      const f = clamp01(flow / 1.35)
      const [bi, bo] = bandIO(E, i, f, 1.2, 3.6, 2, 8)
      ramp3(f * 0.9, deep, mid, hot, col)
      const v = (bi * 1.5 + bo * 0.8) * flow
      L[0][i] += col[0] * v; L[1][i] += col[1] * v; L[2][i] += col[2] * v
    }
    return edgeFinish(ctx, E, L, 3.5, 0.5, K)
  },

  'edge-charge'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, T, sd, deep, mid, hot, S } = E, col = [0, 0, 0]
    if (p < 0.7) {
      const q = p / 0.7, F = q * q * (3 - 2 * q)
      for (let j = 0; j < near.length; j++) {
        const i = near[j], t = T[i], behind = F - t
        const start = Math.pow(clamp01(t / 0.06), 1.5)       // 起点处淡入，不是一刀切
        const level = behind >= 0 ? (0.75 + 0.6 * Math.exp(-behind / 0.1)) * start : 0
        const core = Math.exp(-(((t - F) / 0.008) ** 2))
        if (level <= 0 && core < 1e-4) continue
        const f = clamp01(level + core * 0.5)
        const [bi, bo] = bandIO(E, i, f, 1.2, 3.8, 2, 10)
        ramp3(f * 0.8, deep, mid, hot, col)
        const v = (bi * 1.7 + bo * 1.1) * Math.max(level, core), w = clamp01(core * bi * 2 - 0.3)
        for (let c = 0; c < 3; c++) L[c][i] += col[c] * v + hot[c] * w
      }
      starInto(E, L, mid.map((v) => v * 0.3 + 0.7), headPoints(E, F), 0.9, q * 8, 0.6)
      baseRimInto(E, L, mid, 0.1)
    } else {
      const b = (p - 0.7) / 0.3, env = b < 0.12 ? b / 0.12 : Math.exp(-(b - 0.12) * 5.5)
      const cm = mid.map((v) => v * 0.5 + 0.5), lvl = 0.9 * (1 - Math.min(1, b * 4)) + env * 1.2, wh = Math.max(0, env - 0.4)
      const ringR = (2 + 30 * b * K.x) * S, ringW = (1.5 + 3 * b * K.x) * S, ringK = (1 - b) ** 2 * 1.2
      for (let j = 0; j < near.length; j++) {
        const i = near[j]
        const [bi, bo] = bandIO(E, i, Math.min(1, env), 1.5, 5, 3, 20)
        const ring = sd[i] > 0 ? Math.exp(-(((sd[i] - ringR) / ringW) ** 2)) * ringK : 0
        const v = (bi * 1.6 + bo * 1.3) * lvl + ring
        for (let c = 0; c < 3; c++) L[c][i] += cm[c] * v + hot[c] * bi * wh
      }
      if (b < 0.5) starInto(E, L, hot, rimAt(E, 0).map((r) => [r.x, r.y, 1]), 2.2 * (1 - b * 2) + 0.3, b * 3, env)
      if (env < 1) baseRimInto(E, L, mid, 0.1 * (1 - env))
    }
    return edgeFinish(ctx, E, L, 4.5, 0.6, K)
  },

  'edge-hop'(ctx, p, K) {
    const E = edgeGeoK(ctx, K), L = rgbPlanes(E.N), { near, T, deep, mid, hot } = E, col = [0, 0, 0]
    baseRimInto(E, L, mid, 0.14)
    const NH = Math.max(1, Math.round(K.x))
    for (let k = 0; k < NH; k++) {
      const spot = (k * 0.385 + 0.07) % 1
      const q = (((p * NH - k) % NH) + NH) % NH           // 这一跳过去了几个跳拍
      if (q > 3) continue
      const env = q < 0.1 ? q / 0.1 : Math.exp(-(q - 0.1) * 1.25)
      const reach = 0.03 + 0.16 * (1 - Math.exp(-q * 1.6))   // 光沿边往两头跑开
      for (let j = 0; j < near.length; j++) {
        const i = near[j], dd = Math.abs(circ(T[i] - spot))
        if (dd > reach * 2.2) continue
        const spread = Math.exp(-((dd / reach) ** 4)) * (0.55 + 0.45 * Math.exp(-(((dd - reach * 0.9) / 0.025) ** 2)))
        const f = clamp01(spread * env)
        const [bi, bo] = bandIO(E, i, f, 1.2, 4, 2, 12)
        ramp3(f * 0.85, deep, mid, hot, col)
        const v = (bi * 2.2 + bo * 1.5) * spread * env * 1.3
        L[0][i] += col[0] * v; L[1][i] += col[1] * v; L[2][i] += col[2] * v
      }
      if (q < 0.8) {
        const k2 = Math.pow(Math.sin(Math.PI * Math.min(1, q / 0.8)), 1.2)
        starInto(E, L, mid.map((v) => v * 0.25 + 0.75), rimAt(E, spot).map((r) => [r.x, r.y, 1]), 0.6 + 1.6 * k2, q * 2, k2)
      }
    }
    return edgeFinish(ctx, E, L, 4, 0.55, K)
  },
}

Object.assign(SCHEME_FN, EDGE_FN)

/** 进度 p∈[0,1] 的一帧。返回 { data: Uint8ClampedArray(RGBA, 直通 alpha), w: W, h: H, pad } */
function renderSweepFrame(ctx, p, params = ctx.params) {
  if (ctx.crop) {   // 裁过的边缘扫光：里面算，贴回原尺寸
    const f = renderSweepFrame(ctx.inner, p, { ...params, pad: ctx.pad, _inner: true, _edgeS: ctx.params._edgeS })
    const data = new Uint8ClampedArray(ctx.W * ctx.H * 4), rowLen = f.w * 4
    for (let y = 0; y < f.h; y++) data.set(f.data.subarray(y * rowLen, (y + 1) * rowLen), ((y + ctx.crop.y) * ctx.W + ctx.crop.x) * 4)
    return { data, w: ctx.W, h: ctx.H, pad: ctx.pad }
  }
  const P = { ...DEFAULT_PARAMS, ...ctx.params, ...params }
  const fn = SCHEME_FN[P.scheme] || SCHEME_FN.base
  const k = { angle: Number(P.angle) || 0, wk: effectiveWidth(P).wk, ik: Math.max(0, Number(P.intensity) || 1), gk: Math.max(0.2, Number(P.glow) || 1), rayLength: Math.max(0.2, Number(P.rayLength) || 1) }
  const es = SWEEP_SCHEMES.find((x) => x.id === P.scheme)
  if (es && es.edge) {
    k.startDeg = Number(P.start) || 0
    k.start = es.noStart ? 0 : k.startDeg / 360
    k.laps = Math.max(1, Math.min(8, Math.round(Number(P.laps) || 1)))
    k.x = P.extra != null && P.extra !== '' && Number.isFinite(Number(P.extra)) ? Number(P.extra) : (es.extra ? es.extra.def : 1)
    k.hue = es.fixedColor ? Number(P.hue) || 0 : 0
    p = (p * k.laps) % 1                                  // 次数：整数圈，p=1 仍回到 p=0，首尾相接
  }
  ctx._gk = k.gk
  const { inner, outer } = fn(ctx, p, k)
  const { N, W, H, a, pr, pg, pb } = ctx
  const prem = [pr, pg, pb]
  const data = new Uint8ClampedArray(N * 4)
  const L = [0, 0, 0]
  // 切片最外一圈（边距的六成）里光平滑淡到 0：泛光再大也不会在切片边上切出矩形
  const FB = Math.max(4, Math.round(ctx.pad * 0.6))
  for (let i = 0; i < N; i++) {
    const fx = i % W, fy = (i - fx) / W, bd = Math.min(fx, W - 1 - fx, fy, H - 1 - fy)
    const fade = bd >= FB ? 1 : smooth(0, FB, bd)
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
    if (fade < 1) { alpha *= fade; L[0] *= fade; L[1] *= fade; L[2] *= fade }
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

  root.NovaFlowSweepLight = { SWEEP_SCHEMES, BLEND_MODES, DEFAULT_PARAMS, analyzeBase, renderSweepFrame, generateSweepSequence, sweepAlphaAt, sweepAlphaKeys, autoPad, blurPlane, effectiveWidth, minFrames, stepOf, edgeScale }
})(typeof self !== 'undefined' ? self : globalThis)
