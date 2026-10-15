// 骨骼动画「粒子特效」弹框的粒子核心（2026-10-16 用户：粒子特效不必独立一页，做成骨骼动画里的扩展弹框，
// 生成序列或生成 Spine 动画都直接进当前工程）。用粒子页同一个引擎 / Spine 导出 / 内置贴图 / 模板库，
// esbuild 成 renderer/assets/particle-fx.js（node novaflow-web/tools/build-particle-fx.mjs），挂在 window.NovaFlowParticleFx。
import { ParticleEngine } from './ParticleEngine'
import { exportToSpine } from './SpineExporter'
import { getBuiltinSprites } from './BuiltinSprites'
import { defaultConfig } from '../types'
import type { ParticleSprite, ParticleSystemConfig } from '../types'
import { BUILTIN_PARTICLE_TEMPLATES } from './particleTemplates'

/** 粒子页的模板库（内置 + 用户存的）就在这个 localStorage 键里，弹框读同一份 */
export const TEMPLATE_STORE_KEY = 'particle-editor-templates-v1'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

/** 内置贴图（和粒子页模板里的内置贴图同样的字段） */
export function builtinSprite(key: string): ParticleSprite | null {
  const def = getBuiltinSprites().find((d) => d.key === key)
  if (!def) return null
  return {
    id: `builtin_${def.key}_1`, name: def.label, dataUrl: def.dataUrl, path: 'built-in/', weight: 1, mode: 'single',
    colorMode: 'fixed', colorStops: [{ t: 0, color: '#ffffff' }, { t: 1, color: '#ffffff' }], blendMode: 'normal', color: '#ffffff'
  } as ParticleSprite
}

export function builtinSpriteList() {
  return getBuiltinSprites().map((d) => ({ key: d.key, label: d.label, dataUrl: d.dataUrl }))
}

/** 模板配置 → 完整配置：补默认值，内置贴图引用（{ builtin: key }）换成贴图 */
export function normalizeConfig(cfg: any): ParticleSystemConfig {
  const out: any = { ...clone(defaultConfig), ...clone(cfg || {}) }
  out.shape = { ...clone(defaultConfig.shape), ...(out.shape || {}) }
  out.sprites = (Array.isArray(out.sprites) ? out.sprites : []).map((s: any) => (s && s.builtin ? builtinSprite(s.builtin) : s)).filter(Boolean)
  if (!out.id) out.id = '1'
  return out as ParticleSystemConfig
}

/** 模板库：粒子页存的那份（内置 + 用户存的），没有就用内置的 13 个 */
export function templates(): { id: string; name: string; config: ParticleSystemConfig; builtin: boolean }[] {
  let list: any[] | null = null
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(TEMPLATE_STORE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed) && parsed.length) list = parsed
  } catch (_) { list = null }
  const src = list || BUILTIN_PARTICLE_TEMPLATES.map((t, i) => ({ id: `builtin_tpl_${i + 1}`, name: t.name, config: t.config }))
  return src.filter((t) => t && t.config).map((t, i) => ({
    id: String(t.id || `tpl_${i + 1}`), name: String(t.name || t.config.systemName || `模板 ${i + 1}`),
    config: normalizeConfig(t.config), builtin: String(t.id || '').startsWith('builtin_')
  }))
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('贴图读取失败'))
    img.src = src
  })
}

/** 引擎要的贴图：按 sprites 的顺序，「序列」播放的序列贴图展开成每一帧 */
export async function loadSpriteImages(cfg: ParticleSystemConfig): Promise<HTMLImageElement[]> {
  const out: HTMLImageElement[] = []
  const seq = cfg.spritePlayback === 'sequence'
  for (const s of cfg.sprites || []) {
    if (seq && s.mode === 'sequence' && Array.isArray(s.frames) && s.frames.length) { for (const f of s.frames) out.push(await loadImage(f.dataUrl)) }
    else out.push(await loadImage(s.dataUrl))
  }
  return out
}

/** 生成序列用的配置：循环的持续发射把发射时长对齐到循环长度（和粒子页导出序列一样） */
export function sequenceConfig(cfg: ParticleSystemConfig, duration: number, loop: boolean): ParticleSystemConfig {
  const c: any = { ...cfg, loopAnimation: loop, loopDurationSec: duration }
  if (loop && c.mode === 'stream') { c.streamDurationSec = duration; c.streamLoopEnabled = true }
  else if (!loop && c.mode === 'stream') { c.streamDurationSec = duration; c.streamLoopEnabled = false }   // 一次性：只在时长里发
  return c
}

/**
 * 渲染序列帧：width × height 的透明画布，frames 张、共 duration 秒；循环的先空跑一整圈（首尾接得上，和粒子页导出序列一样）。
 * onFrame(i, canvas) 每帧回调（画布每帧复用，回调里自己取像素）。
 */
export async function renderSequence(opts: { config: ParticleSystemConfig; width: number; height: number; frames: number; duration: number; loop: boolean; seed?: number; onFrame: (i: number, canvas: HTMLCanvasElement) => void | Promise<void> }) {
  const { width, height, frames, duration, loop } = opts
  const cfg = sequenceConfig(opts.config, duration, loop)
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建渲染画布')
  const seed = Number.isFinite(opts.seed as any) ? Number(opts.seed) : Math.floor(Math.random() * 2147483647 + 1)
  const engine = new ParticleEngine(ctx, cfg, loop ? { seed, resetSeedOnLoop: true } : undefined)
  engine.setSprites(await loadSpriteImages(cfg))
  engine.reset(cfg)
  const step = duration / Math.max(1, frames)
  if (loop) { const n = Math.round(duration / step); for (let k = 0; k < n; k++) engine.step(step, { draw: false }) }
  for (let i = 0; i < frames; i++) {
    if (i > 0) engine.step(step, { draw: false })
    engine.draw()
    await opts.onFrame(i, canvas)
  }
}

async function toPng(src: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(src)
  const w = Math.max(1, img.naturalWidth || img.width || 128), h = Math.max(1, img.naturalHeight || img.height || 128)
  const c = document.createElement('canvas'); c.width = w; c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  return { dataUrl: c.toDataURL('image/png'), width: w, height: h }
}

/**
 * 生成 Spine 动画用：粒子页的 Spine 导出（3.8 骨骼 JSON，每个粒子一个插槽打关键帧）+ 用到的贴图（PNG，按附件名）。
 * 序列贴图在这里按单张（第一帧）处理。
 */
export async function spineParts(cfg: ParticleSystemConfig, duration: number, loop: boolean) {
  const c: any = sequenceConfig(cfg, duration, loop)
  c.spritePlayback = c.spritePlayback === 'sequence' ? 'single' : c.spritePlayback
  c.sprites = (c.sprites || []).map((s: any) => (s.mode === 'sequence' ? { ...s, mode: 'single', dataUrl: (s.frames && s.frames[0] && s.frames[0].dataUrl) || s.dataUrl } : s))
  const images: { regionName: string; dataUrl: string; width: number; height: number }[] = []
  const bases: Record<string, number> = {}
  const seen = new Set<string>()
  if (!c.sprites.length) c.sprites = [builtinSprite('feather_circle')]
  for (const sp of c.sprites) {
    const name = sp.name || 'particle'
    if (seen.has(name)) continue
    seen.add(name)
    const png = await toPng(sp.dataUrl)
    images.push({ regionName: name, ...png })
    bases[name] = Math.max(1, Math.round(Math.max(png.width, png.height)))
  }
  const skeleton = JSON.parse(exportToSpine([c], '3.8', { attachmentBases: bases }))
  if (!Array.isArray(skeleton.skins)) skeleton.skins = Object.entries(skeleton.skins || {}).map(([name, attachments]) => ({ name, attachments }))
  return { skeleton, images }
}

/**
 * 画在骨骼动画舞台上的引擎（2026-10-16 用户：粒子直接作用在画布里，底下是原有动画）：引擎按 width × height 的画板算，
 * drawTo(ctx) 画到别人的画布上（调用方先 setTransform 好画板像素 → 屏幕的变换；引擎只用 save / translate，不重设变换）。
 */
export async function createStageEngine(cfg: ParticleSystemConfig, width: number, height: number, opts?: { seed?: number; loop?: boolean }) {
  const dummy = document.createElement('canvas')
  dummy.width = 2; dummy.height = 2
  const engine: any = new ParticleEngine(dummy.getContext('2d')!, cfg, opts?.loop ? { seed: opts?.seed ?? Math.floor(Math.random() * 2147483647 + 1), resetSeedOnLoop: true } : undefined)
  engine.width = width; engine.height = height
  engine.setSprites(await loadSpriteImages(cfg))
  engine.reset(cfg, { draw: false })
  return {
    engine,
    step: (dt: number) => engine.step(dt, { draw: false }),
    drawTo: (ctx: CanvasRenderingContext2D) => { const prev = engine.ctx; engine.ctx = ctx; try { engine.draw({ clear: false }) } finally { engine.ctx = prev } }
  }
}

const api = { ParticleEngine, createStageEngine, exportToSpine, builtinSprite, builtinSpriteList, normalizeConfig, templates, loadSpriteImages, sequenceConfig, renderSequence, spineParts, defaultConfig, TEMPLATE_STORE_KEY }
;(globalThis as any).NovaFlowParticleFx = api
export default api
