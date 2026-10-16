// 骨骼动画「粒子特效」的粒子核心（2026-10-16 用户：粒子特效不必独立一页，做成骨骼动画里的扩展面板，
// 粒子直接画在舞台上，生成序列或生成 Spine 动画都直接进当前工程）。用粒子页同一个引擎 / Spine 导出 / 内置贴图 / 模板库，
// esbuild 成 renderer/assets/particle-fx.js（node novaflow-web/tools/build-particle-fx.mjs），挂在 window.NovaFlowParticleFx。
// 一个模板可以是一个粒子系统（config），也可以是整组叠加（systems）；这里统一成 systems 数组。
import { ParticleEngine } from './ParticleEngine'
import { exportToSpine } from './SpineExporter'
import { getBuiltinSprites } from './BuiltinSprites'
import { defaultConfig } from '../types'
import type { ParticleSprite, ParticleSystemConfig } from '../types'
import { contourToNormalizedPoints } from '../utils/contour'
import { fitClosedBezier, autoHandles } from '../utils/bezierFit'
import { loadCurvePresets, saveCurvePresets, defaultCurvePresets } from '../utils/curvePresets'
import { normalizeColorStops, mergeStopsWithCurve, normalizeKey1DCurve, sampleColorStops } from '../utils/curveMath'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

/** 内置贴图（和粒子页内置贴图同样的字段） */
export function builtinSprite(key: string): ParticleSprite | null {
  const def = getBuiltinSprites().find((d) => d.key === key)
  if (!def) return null
  return {
    id: `builtin_${def.key}_${Date.now().toString(36)}`, name: def.label, dataUrl: def.dataUrl, path: 'built-in/', weight: 1, mode: 'single',
    colorMode: 'fixed', colorStops: [{ t: 0, color: '#ffffff' }, { t: 1, color: '#ffffff' }], blendMode: 'add', color: '#ffffff'
  } as ParticleSprite
}

export function builtinSpriteList() {
  return getBuiltinSprites().map((d) => ({ key: d.key, label: d.label, dataUrl: d.dataUrl }))
}

/** 椭圆（半径 rx / ry）的闭合自定义路径：4 个点 + 贝塞尔控制柄，从右边起、按角度增大的方向走（和引擎的圆形路径同向） */
export function ellipsePathPoints(rx: number, ry: number) {
  const k = 0.5522847498, r = (v: number) => Math.round(v * 10) / 10
  const kx = r(k * rx), ky = r(k * ry)
  return [
    { x: r(rx), y: 0, in: { x: 0, y: -ky }, out: { x: 0, y: ky } },
    { x: 0, y: r(ry), in: { x: kx, y: 0 }, out: { x: -kx, y: 0 } },
    { x: r(-rx), y: 0, in: { x: 0, y: ky }, out: { x: 0, y: -ky } },
    { x: 0, y: r(-ry), in: { x: -kx, y: 0 }, out: { x: kx, y: 0 } },
  ]
}

/**
 * 路径只留「自定义」（2026-10-16 用户：圆 / 椭圆没必要）：老模板开着的圆 / 椭圆路径换成同样大小的闭合自定义路径，
 * 角速度（°/s）换成沿线速度（px/s），起始角换成起点，负速度换成「反向」——看起来和原来一样，还能在画布上拖点
 */
function circlePathToCustom(out: any) {
  if (!out.pathEnabled || out.pathType === 'custom') return
  const circle = (out.pathType || 'circle') === 'circle', off = Number(out.pathRadiusOffset) || 0
  const rx0 = Math.max(0, Number(out.pathRadiusX) || 0), ryRaw = Math.max(0, Number(out.pathRadiusY) || 0)
  const ry0 = circle ? (rx0 || ryRaw) : (ryRaw || rx0)
  const rx = Math.max(1, (rx0 > 0 ? rx0 : 120) + off), ry = Math.max(1, (ry0 > 0 ? ry0 : (rx0 > 0 ? rx0 : 120)) + off)
  const omega = (((Number(out.pathSpeedDegPerSec) || 0) * Math.PI) / 180) * (out.pathReverse ? -1 : 1)
  const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
  const turn = ((Number(out.pathStartAngleDeg) || 0) / 360) % 1
  Object.assign(out, {
    pathType: 'custom', pathClosed: true, pathPoints: ellipsePathPoints(rx, ry), pathRadiusOffset: 0,
    pathSpeedPxPerSec: Math.round(Math.abs(omega) * (perimeter / (Math.PI * 2))), pathReverse: omega < 0, pathStartT: turn < 0 ? turn + 1 : turn,
  })
}

/**
 * 图片轮廓 → 自定义路径：轮廓先取密集的点（不简化），再拟合成尽量少的贝塞尔点（2026-10-16 用户：要曲线，不要无数的点）。
 * tolerance = 允许偏离轮廓的像素（目标尺寸里的像素），越大点越少
 */
export async function contourToBezierPath(dataUrl: string, options: { alphaThreshold: number; smoothIterations: number; targetSize: number; tolerance: number }) {
  const dense = await contourToNormalizedPoints(dataUrl, { alphaThreshold: options.alphaThreshold, smoothIterations: options.smoothIterations, simplifyEpsilon: 0, targetSize: options.targetSize })
  if (!dense || dense.length < 3) return []
  return fitClosedBezier(dense, Math.max(0.3, Number(options.tolerance) || 3))
}

/** 模板配置 → 完整配置：补默认值 */
export function normalizeConfig(cfg: any): ParticleSystemConfig {
  const out: any = { ...clone(defaultConfig), ...clone(cfg || {}) }
  out.shape = { ...clone(defaultConfig.shape), ...(out.shape || {}) }
  out.sprites = (Array.isArray(out.sprites) ? out.sprites : []).filter(Boolean)
  if (!out.id) out.id = '1'
  // 发射器形状是「路径」时基础属性的路径关掉：两个一起开，引擎让后者盖掉发射器的路径，面板上它也是不可用的
  if (out.shape.type === 'custom_path') out.pathEnabled = false
  circlePathToCustom(out)
  return out as ParticleSystemConfig
}
/** 模板（config 或整组 systems）→ 系统数组 */
export function systemsOf(t: any): ParticleSystemConfig[] {
  const list = Array.isArray(t && t.systems) && t.systems.length ? t.systems : [t && t.config]
  return list.filter(Boolean).map((c: any) => normalizeConfig(c)).filter((c: any) => c.enabled !== false)
}

// ---------------------------------------------------------------- 模板库（和粒子页同一份）
// 粒子页的模板库存在应用的本地数据里（electronAPI.loadUserData('templates')：网页版是 IndexedDB，第一次用 templates/particle-bundled.json
// 里的内置模板；用户存的、删的都在这份里）。骨骼动画编辑器在 iframe 里，外层页面的 electronAPI 也能用。
function userDataApi(): any {
  const own = (globalThis as any).electronAPI
  if (own && typeof own.loadUserData === 'function') return own
  try { const p = (globalThis as any).parent; if (p && p !== globalThis && p.electronAPI && typeof p.electronAPI.loadUserData === 'function') return p.electronAPI } catch (_) { /* cross-origin */ }
  return null
}
export async function loadTemplates(): Promise<any[]> {
  const api = userDataApi()
  if (api) {
    const r = await api.loadUserData('templates')
    if (r && r.ok !== false && Array.isArray(r.data) && r.data.length) return r.data
  }
  try { const raw = globalThis.localStorage && globalThis.localStorage.getItem('particle-editor-templates-v1'); const d = raw ? JSON.parse(raw) : null; if (Array.isArray(d) && d.length) return d } catch (_) { /* ignore */ }
  const res = await fetch('./templates/particle-bundled.json')
  if (!res.ok) throw new Error('内置粒子模板读取失败')
  return await res.json()
}
export async function saveTemplates(list: any[]) {
  const api = userDataApi()
  if (!api || typeof api.saveUserData !== 'function') throw new Error('保存不了模板库')
  const r = await api.saveUserData({ key: 'templates', data: list })
  if (r && r.ok === false) throw new Error(r.error || '保存模板库失败')
}
export async function resetTemplates(): Promise<any[]> {
  const api = userDataApi()
  if (api && typeof api.templatesResetToBundled === 'function') { const r = await api.templatesResetToBundled(); if (r && r.ok !== false && Array.isArray(r.data)) return r.data }
  const res = await fetch('./templates/particle-bundled.json')
  const data = await res.json()
  await saveTemplates(data)
  return data
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('贴图读取失败'))
    img.src = src
  })
}

/** 引擎要的贴图：按 sprites 的顺序，「序列」播放的序列贴图展开成每一帧（和引擎的 rebuildSpriteFrameRanges 对得上） */
export async function loadSpriteImages(cfg: ParticleSystemConfig): Promise<HTMLImageElement[]> {
  const out: HTMLImageElement[] = []
  const seq = cfg.spritePlayback === 'sequence'
  for (const s of cfg.sprites || []) {
    if (seq && Array.isArray(s.frames) && s.frames.length) { for (const f of s.frames) out.push(await loadImage(f.dataUrl)) }
    else out.push(await loadImage(s.dataUrl || (s.frames && s.frames[0] && s.frames[0].dataUrl) || ''))
  }
  return out
}

/** 时长落到配置上（每个系统自己的「首尾循环」不变）：循环的持续发射对齐到循环长度（和粒子页导出序列一样） */
export function sequenceConfig(cfg: ParticleSystemConfig, duration: number): ParticleSystemConfig {
  const c: any = { ...cfg, loopDurationSec: duration }
  if (c.loopAnimation && c.mode === 'stream') { c.streamDurationSec = duration; c.streamLoopEnabled = true }
  return c
}
export const anyLoop = (systems: ParticleSystemConfig[]) => systems.some((c) => !!c.loopAnimation)

/** 一组系统各一个引擎 */
async function engines(systems: ParticleSystemConfig[], ctxFor: () => CanvasRenderingContext2D, width: number, height: number, seed?: number) {
  const list: any[] = []
  const s0 = seed ?? Math.floor(Math.random() * 2147483647 + 1)
  for (const [i, cfg] of systems.entries()) {
    const engine: any = new ParticleEngine(ctxFor(), cfg, cfg.loopAnimation ? { seed: s0 + i * 7919, resetSeedOnLoop: true } : undefined)
    engine.width = width; engine.height = height
    engine.setSprites(await loadSpriteImages(cfg))
    engine.reset(cfg, { draw: false })
    list.push({ engine, cfg })
  }
  return list
}

/**
 * 渲染序列帧：width × height 的透明画布，frames 张、共 duration 秒；循环的先空跑一整圈（首尾接得上，和粒子页导出序列一样）。
 * onFrame(i, canvas) 每帧回调（画布每帧复用）。
 */
export async function renderSequence(opts: { systems: ParticleSystemConfig[]; width: number; height: number; frames: number; duration: number; seed?: number; onFrame: (i: number, canvas: HTMLCanvasElement) => void | Promise<void> }) {
  const { width, height, frames, duration } = opts
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建渲染画布')
  const list = await engines(opts.systems.map((c) => sequenceConfig(c, duration)), () => ctx, width, height, opts.seed)
  const step = duration / Math.max(1, frames)
  // 循环的系统先空跑一整圈（首尾接得上）
  const n = Math.round(duration / step)
  for (const e of list) if (e.cfg.loopAnimation) for (let k = 0; k < n; k++) e.engine.step(step, { draw: false })
  for (let i = 0; i < frames; i++) {
    if (i > 0) for (const e of list) e.engine.step(step, { draw: false })
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, width, height)
    for (const e of list) e.engine.draw({ clear: false })
    await opts.onFrame(i, canvas)
  }
}

/**
 * 画在骨骼动画舞台上的引擎（粒子直接作用在画布里，底下是原有动画）：引擎按 width × height 的画板算，
 * drawTo(ctx) 画到舞台画布上（调用方先 setTransform 好画板像素 → 屏幕的变换；引擎只用 save / translate，不重设变换）。
 */
export async function createStageEngine(systems: ParticleSystemConfig[], width: number, height: number, opts?: { seed?: number }) {
  const dummy = document.createElement('canvas')
  dummy.width = 2; dummy.height = 2
  const dctx = dummy.getContext('2d')!
  const list = await engines(systems, () => dctx, width, height, opts?.seed)
  return {
    list,
    reset: () => { for (const e of list) e.engine.reset(e.cfg, { draw: false }) },
    step: (dt: number) => { for (const e of list) e.engine.step(dt, { draw: false }) },
    drawTo: (ctx: CanvasRenderingContext2D) => { for (const e of list) { const prev = e.engine.ctx; e.engine.ctx = ctx; try { e.engine.draw({ clear: false }) } finally { e.engine.ctx = prev } } }
  }
}

/** 模板库卡片里的小预览：一组系统缩到 w × h 的画布里，自己跑（step(dt) 每帧调） */
/**
 * 模板库卡片预览（和粒子页一样，2026-10-16 用户：漩涡变成一团了）：先按粒子能跑到的范围定一个「世界」
 * （速度 × 寿命 + 重力 + 发射形状 + 吸引 / 螺旋起始半径，256–1024），在离屏画布上按世界尺寸模拟——
 * 螺旋从世界的一半处转进来；预跑半秒量出有内容的范围（留 6%），裁下来缩进卡片。
 * 之前直接拿小卡片当世界，螺旋只能从几十像素处出发，大雾气贴图叠成一团
 */
function previewWorldSize(cfg: any) {
  const life = Math.max(0.01, cfg.lifetimeMax || 0.01), speed = Math.max(0, cfg.speedMax || 0)
  const gravity = cfg.gravityEnabled ? Math.hypot(cfg.gravityX || 0, cfg.gravityY || 0) : 0
  const travel = speed * life + 0.5 * gravity * life * life
  const shape = cfg.shape || { type: 'point' }
  const shapeRadius = shape.type === 'circle' ? Math.max(0, shape.outerRadius || 0)
    : shape.type === 'rect' ? Math.max(0, Math.hypot((shape.width || 0) / 2, (shape.height || 0) / 2))
      : shape.type === 'cone' ? Math.max(0, shape.coneRadius || 0) : 0
  const attractor = cfg.attractorEnabled ? Math.max(0, cfg.attractorRadius || 0) : 0
  const spiral = cfg.attractorEnabled && cfg.attractorMode === 'spiral' ? Math.max(0, cfg.spiralStartRadius || 0) : 0
  const size = Math.ceil((shapeRadius + travel + Math.max(attractor, spiral) + 80) * 2)
  return Math.max(256, Math.min(1024, size || 512))
}
export async function createPreview(systems: ParticleSystemConfig[], canvas: HTMLCanvasElement, _scale = 0.35) {
  const ctx = canvas.getContext('2d')!
  const world = systems.reduce((acc, c) => Math.max(acc, previewWorldSize(c)), 0) || 512
  const k = Math.min(1, 384 / world)
  const off = document.createElement('canvas'); off.width = off.height = Math.max(1, Math.round(world * k))
  const octx = off.getContext('2d')!
  const local = systems.map((c) => sequenceConfig({ ...c, systemX: 0, systemY: 0, loopAnimation: true } as any, Math.max(0.5, Number((c as any).loopDurationSec) || 2)))
  const list = await engines(local, () => octx, world, world)
  const paint = () => { octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, off.width, off.height); octx.setTransform(k, 0, 0, k, 0, 0); for (const e of list) e.engine.draw({ clear: false }) }
  // 有内容的范围（缩到 160 量 alpha > 10），留 6% 边
  const measure = () => {
    const probe = document.createElement('canvas'); probe.width = probe.height = 160
    const p = probe.getContext('2d', { willReadFrequently: true })!; p.drawImage(off, 0, 0, 160, 160)
    const d = p.getImageData(0, 0, 160, 160).data
    let x0 = 160, y0 = 160, x1 = -1, y1 = -1
    for (let y = 0; y < 160; y++) for (let x = 0; x < 160; x++) if (d[(y * 160 + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y }
    if (x1 < 0) return null
    const w = off.width, pad = 0.06 * w
    const L = Math.max(0, Math.floor((x0 / 160) * w - pad)), T = Math.max(0, Math.floor((y0 / 160) * w - pad))
    const R = Math.min(w - 1, Math.ceil(((x1 + 1) / 160) * w + pad)), B = Math.min(w - 1, Math.ceil(((y1 + 1) / 160) * w + pad))
    return { x: L, y: T, w: Math.max(1, R - L + 1), h: Math.max(1, B - T + 1) }
  }
  for (let i = 0; i < 30; i++) for (const e of list) e.engine.step(1 / 60, { draw: false })
  paint()
  const crop = measure()
  return {
    step: (dt: number) => {
      for (const e of list) e.engine.step(dt, { draw: false })
      paint()
      const w = canvas.width, h = canvas.height, c = crop || { x: 0, y: 0, w: off.width, h: off.height }
      const fit = Math.min(w / c.w, h / c.h) * 0.995, dw = c.w * fit, dh = c.h * fit
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h); ctx.imageSmoothingEnabled = true
      ctx.drawImage(off, c.x, c.y, c.w, c.h, (w - dw) / 2, (h - dh) / 2, dw, dh)
    }
  }
}

async function toPng(src: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(src)
  const w = Math.max(1, img.naturalWidth || img.width || 128), h = Math.max(1, img.naturalHeight || img.height || 128)
  const c = document.createElement('canvas'); c.width = w; c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  return { dataUrl: c.toDataURL('image/png'), width: w, height: h }
}
// 序列贴图的附件 / 区域名（和粒子页的 Spine 导出一样，exportToSpine 按这个找）
const seqId = (sp: any) => { const idRaw = String(sp.id || '').trim(); return idRaw ? idRaw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) : '' }
const seqFrameName = (sp: any, i: number) => { const base = String(sp.name || 'particle').trim() || 'particle', id = seqId(sp), idx = String(Math.max(0, i)).padStart(4, '0'); return id ? `${base}_${id}_${idx}` : `${base}_${idx}` }
const seqAttName = (sp: any) => { const base = String(sp.name || 'particle').trim() || 'particle', id = seqId(sp); return id ? `${base}_${id}_seq` : `${base}_seq` }

/**
 * 生成 Spine 动画用：粒子页的 Spine 导出（3.8 骨骼 JSON，每个粒子一个插槽打关键帧，整组的每个系统各一组）+ 用到的贴图（PNG，按区域名）。
 * 贴图收集和粒子页「导出 Spine 工程」一样（单张按贴图名，序列按每帧的区域名）。
 */
export async function spineParts(systems: ParticleSystemConfig[], duration: number) {
  const cs: any[] = systems.map((c) => sequenceConfig(c, duration))
  const images: { regionName: string; dataUrl: string; width: number; height: number }[] = []
  const bases: Record<string, number> = {}
  const seen = new Set<string>()
  const fallback = builtinSprite('feather_circle')
  for (const c of cs) if (!(c.sprites || []).length && fallback) c.sprites = [{ ...fallback, name: 'particle' }]
  for (const c of cs) for (const sp of c.sprites || []) {
    if (sp.mode === 'sequence' && Array.isArray(sp.frames) && sp.frames.length) {
      let seqBase = 0
      for (let i = 0; i < sp.frames.length; i++) {
        const name = seqFrameName(sp, i)
        if (seen.has(name)) continue
        seen.add(name)
        const png = await toPng(sp.frames[i].dataUrl)
        images.push({ regionName: name, ...png })
        bases[name] = Math.max(1, Math.round(Math.max(png.width, png.height)))
        seqBase = Math.max(seqBase, bases[name])
      }
      if (seqBase > 0) bases[seqAttName(sp)] = seqBase
      // 随机 / 单张播放时序列贴图按贴图名当一张图用（导出的附件就叫贴图名）：第一帧也按贴图名放一份
      const own = sp.name || 'particle'
      if (!seen.has(own)) { seen.add(own); const png = await toPng(sp.frames[0].dataUrl); images.push({ regionName: own, ...png }); bases[own] = Math.max(1, Math.round(Math.max(png.width, png.height))) }
      continue
    }
    const name = sp.name || 'particle'
    if (seen.has(name)) continue
    seen.add(name)
    const png = await toPng(sp.dataUrl)
    images.push({ regionName: name, ...png })
    bases[name] = Math.max(1, Math.round(Math.max(png.width, png.height)))
  }
  const skeleton = JSON.parse(exportToSpine(cs, '3.8', { attachmentBases: bases }))
  if (!Array.isArray(skeleton.skins)) skeleton.skins = Object.entries(skeleton.skins || {}).map(([name, attachments]) => ({ name, attachments }))
  return { skeleton, images }
}

const api = { contourToNormalizedPoints, contourToBezierPath, autoHandles, ellipsePathPoints, loadCurvePresets, saveCurvePresets, defaultCurvePresets, normalizeColorStops, mergeStopsWithCurve, normalizeKey1DCurve, sampleColorStops, ParticleEngine, createStageEngine, createPreview, exportToSpine, builtinSprite, builtinSpriteList, normalizeConfig, systemsOf, loadTemplates, saveTemplates, resetTemplates, loadSpriteImages, sequenceConfig, anyLoop, renderSequence, spineParts, defaultConfig, getBuiltinSprites }
;(globalThis as any).NovaFlowParticleFx = api
export default api
