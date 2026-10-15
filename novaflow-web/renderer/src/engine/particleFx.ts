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

/** 模板配置 → 完整配置：补默认值 */
export function normalizeConfig(cfg: any): ParticleSystemConfig {
  const out: any = { ...clone(defaultConfig), ...clone(cfg || {}) }
  out.shape = { ...clone(defaultConfig.shape), ...(out.shape || {}) }
  out.sprites = (Array.isArray(out.sprites) ? out.sprites : []).filter(Boolean)
  if (!out.id) out.id = '1'
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
export async function createPreview(systems: ParticleSystemConfig[], canvas: HTMLCanvasElement, scale = 0.35) {
  const ctx = canvas.getContext('2d')!
  const scaled = systems.map((c) => ({ ...c, systemScale: (Number(c.systemScale) || 1) * scale, systemX: (Number(c.systemX) || 0) * scale, systemY: (Number(c.systemY) || 0) * scale }))
  const list = await engines(scaled.map((c) => sequenceConfig({ ...c, loopAnimation: true } as any, Math.max(0.5, Number((c as any).loopDurationSec) || 2))), () => ctx, canvas.width, canvas.height)
  return {
    step: (dt: number) => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); for (const e of list) { e.engine.step(dt, { draw: false }); e.engine.draw({ clear: false }) } }
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

const api = { contourToNormalizedPoints, loadCurvePresets, saveCurvePresets, defaultCurvePresets, normalizeColorStops, mergeStopsWithCurve, normalizeKey1DCurve, sampleColorStops, ParticleEngine, createStageEngine, createPreview, exportToSpine, builtinSprite, builtinSpriteList, normalizeConfig, systemsOf, loadTemplates, saveTemplates, resetTemplates, loadSpriteImages, sequenceConfig, anyLoop, renderSequence, spineParts, defaultConfig, getBuiltinSprites }
;(globalThis as any).NovaFlowParticleFx = api
export default api
