// AI 特效「模板制作」核心的测试（2026-10-15 从 work/aifx-template-maker-lab 接入）：node --test novaflow-web/tests/e2e/aifx-template-maker.test.mjs
// 和扫光一样的规矩：界面上能拖的参数都要真改画面（不起作用的标 inert 置灰）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import test from 'node:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const sandbox = { console }
sandbox.globalThis = sandbox
const vmctx = createContext(sandbox)
const renderer = path.resolve(here, '../../renderer')
runInContext(readFileSync(path.join(renderer, 'sweep-light.core.js'), 'utf8'), vmctx)
runInContext(readFileSync(path.join(renderer, 'aifx-template-maker.core.js'), 'utf8'), vmctx)
runInContext(readFileSync(path.join(renderer, 'aifx-template-maker.fx.js'), 'utf8'), vmctx)
const FX = sandbox.NovaFlowFxMaker
const copy = (v) => JSON.parse(JSON.stringify(v))

function project(effect, extra = {}) {
  const p = FX.defaultProject()
  p.effect = effect
  p.params = FX.effectDefaults(effect)
  p.lifecycle = FX.effectOf(effect).lifecycle
  return Object.assign(p, extra)
}
const SCALE = 0.25
// 图标在画板中间、四周有余地（实际用法）：画板内适配不会把滑块的后半段吃掉
function roomy(effect, extra = {}) {
  const p = project(effect, extra), box = { x: 200, y: 200, w: 240, h: 240 }
  p.outlines = [{ points: FX.shapeOutline('roundrect', box), hole: false }]
  p.corner = 40
  p.start = { x: 320, y: 200 }
  return p
}
function frame(p, i) { return FX.renderFrame(FX.prepare(copy(p), SCALE), i) }
function diff(a, b) { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 4) / 3 }
function mean(a) { let s = 0; for (let i = 0; i < a.length; i += 4) s += a[i] + a[i + 1] + a[i + 2]; return s / (a.length / 4) / 3 }

test('every shape gives a closed outline whose area is what it should be', () => {
  const box = { x: 160, y: 160, w: 320, h: 320 }
  const area = (kind, corner = 0) => {
    const p = FX.defaultProject()
    p.shape.kind = kind
    p.outlines = [{ points: FX.shapeOutline(kind, box, { points: 5, inner: 0.45 }), hole: false }]
    p.corner = corner
    return FX.geometry(p, 1).area
  }
  assert.ok(Math.abs(area('rect') - 320 * 320) / (320 * 320) < 0.01, 'rect')
  const circle = area('circle'), ideal = Math.PI * 160 * 160
  assert.ok(Math.abs(circle - ideal) / ideal < 0.01, 'circle ' + circle + ' vs ' + ideal)
  assert.ok(area('roundrect', 60) < area('rect') && area('roundrect', 60) > circle, 'rounded corners cut the square')
  assert.ok(area('star') > 0.25 * ideal && area('star') < 0.6 * ideal, 'star')
  assert.ok(area('heart') > 0.4 * 320 * 320 && area('heart') < 0.8 * 320 * 320, 'heart')
  // 圆角开满的正方形接近圆
  assert.ok(Math.abs(area('rect', 500) - circle) / circle < 0.01, 'a square rounded all the way is a circle: ' + area('rect', 500))
})

test('外扩 grows the shape, 内缩 shrinks it, and separate parts merge when pushed out', () => {
  const p = FX.defaultProject()
  const base = FX.geometry(p, 0.5).area
  p.offset = 20
  const out = FX.geometry(p, 0.5).area
  p.offset = -20
  const inn = FX.geometry(p, 0.5).area
  assert.ok(out > base * 1.1 && inn < base * 0.9, `${inn} < ${base} < ${out}`)
  // 两个分开的圆：外扩 0 两条外圈，外扩够大合成一条
  const two = FX.defaultProject()
  two.shape.kind = 'free'
  two.outlines = [{ points: FX.shapeOutline('circle', { x: 100, y: 250, w: 180, h: 180 }), hole: false }, { points: FX.shapeOutline('circle', { x: 330, y: 250, w: 180, h: 180 }), hole: false }]
  assert.equal(FX.geometry(two, 0.5).outer.length, 2)
  two.offset = 40
  assert.equal(FX.geometry(two, 0.5).outer.length, 1, 'pushed out, the two parts are one ring')
})

test('图片轮廓 finds the outer edge of a picture; holes only when asked', () => {
  // 一个带镂空的方框（外 200 内 120）+ 一个分开的小块
  const w = 300, h = 300, rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ring = x >= 50 && x < 250 && y >= 50 && y < 250 && !(x >= 90 && x < 210 && y >= 90 && y < 210)
    const dot = x >= 260 && x < 290 && y >= 10 && y < 40
    if (ring || dot) rgba[(y * w + x) * 4 + 3] = 255
  }
  const place = { x: 170, y: 170, w: 300, h: 300 }
  const outer = FX.traceImage(rgba, w, h, place, 640, 640, 0.5, true)
  assert.equal(outer.filter((o) => !o.hole).length, 2, 'the frame and the separate dot')
  assert.equal(outer.filter((o) => o.hole).length, 0)
  const span = (o) => Math.max(...o.points.map((q) => q.x)) - Math.min(...o.points.map((q) => q.x))
  const big = outer.reduce((a, o) => (span(o) > span(a) ? o : a))
  const xs = big.points.map((q) => q.x)
  assert.ok(Math.abs(Math.min(...xs) - 220) < 4 && Math.abs(Math.max(...xs) - 420) < 4, 'traced where the picture sits on the canvas')
  const withHoles = FX.traceImage(rgba, w, h, place, 640, 640, 0.5, false)
  assert.equal(withHoles.filter((o) => o.hole).length, 1, 'the hole when 含内圈')
  // 精细度：越高点越多
  const coarse = FX.traceImage(rgba, w, h, place, 640, 640, 0, true), fine = FX.traceImage(rgba, w, h, place, 640, 640, 1, true)
  assert.ok(fine.reduce((a, o) => a + o.points.length, 0) >= coarse.reduce((a, o) => a + o.points.length, 0))
})

test('loops close: the last frame runs into the first like any two neighbours', () => {
  const bad = []
  for (const fx of FX.effects().filter((e) => !e.needsBase)) {
    const p = project(fx.id, { lifecycle: 'loop' })
    const ctx = FX.prepare(copy(p), SCALE), n = FX.frameCount(p)
    if (fx.event) {   // 事件类循环 = 重复播放：结尾要清空，下一遍从空画面开始才不跳
      const last = mean(FX.renderFrame(ctx, n - 1))
      if (!(last < 1.2)) bad.push(`${fx.label}: last loop frame not clear (${last.toFixed(2)})`)
      continue
    }
    const f = [n - 2, n - 1, 0, 1].map((i) => FX.renderFrame(ctx, i))
    const seam = diff(f[1], f[2]), step = Math.max(diff(f[0], f[1]), diff(f[2], f[3]))
    if (!(seam <= step * 2.2 + 0.6)) bad.push(`${fx.label}: seam ${seam.toFixed(2)} vs step ${step.toFixed(2)}`)
  }
  assert.deepEqual(bad, [])
})

test('loops are exactly periodic: the frame at t = 1 is the frame at t = 0', () => {
  // 2026-10-15：转动的噪声「每段转整数格」并不等于转回原样（吸积盘 / 能量环流 / 符文环 / 能量球流光都栽过），
  // 相邻帧差的门槛太松抓不到，直接比 t = 0 和 t = 1。速度线每几帧随机换一批，本来就是闪的，不算。
  const bad = []
  for (const fx of FX.effects().filter((e) => !e.needsBase)) {
    if (fx.id === 'speedlines' || fx.loopFadeIn) continue   // 开头淡入的（分流汇合）t = 1 那帧不播，接缝看上面那条
    const p = project(fx.id, { lifecycle: 'loop' })
    const ctx = FX.prepare(copy(p), SCALE), n = FX.frameCount(p)
    const d = diff(FX.renderFrame(ctx, 0), FX.renderFrame(ctx, n))
    if (!(d < 0.35)) bad.push(`${fx.label}: ${d.toFixed(2)}`)
  }
  assert.deepEqual(bad, [])
})

test('effects stay inside the canvas: nothing bright reaches its edge', () => {
  // 2026-10-15 用户：「东西需要显示完整，而不是被最终尺寸切割掉」——画板最外一圈（2%）里不能有明显的光
  const bad = []
  for (const fx of FX.effects().filter((e) => !e.needsBase)) {
    if (fx.kind !== 'lib') continue
    for (const p of [project(fx.id), roomy(fx.id)]) {
      const ctx = FX.prepare(copy(p), 0.5), n = FX.frameCount(p), { W, H } = ctx.geo, band = Math.max(2, Math.round(0.02 * Math.min(W, H)))
      let worst = 0
      for (const f of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) {
        const img = FX.renderFrame(ctx, Math.round((n - 1) * f))
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (x >= band && y >= band && x < W - band && y < H - band) continue
          const o = (y * W + x) * 4, v = Math.max(img[o], img[o + 1], img[o + 2])
          if (v > worst) worst = v
        }
      }
      if (worst > 60) bad.push(`${fx.label}: edge pixel ${worst}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('outline glows still reach out around a big shape, and stay off the canvas edge', () => {
  // 2026-10-15 用户：灵气外溢 / 圣光放射「只有把外扩拉小了才能显示，否则只有一个描边」——
  // 原来按整个形状离画板最近处给统一长度；大形状 / 斜放时处处缩没。现在逐点按空间，光平均伸出轮廓的距离（单位 u）要够
  const diag = (p) => {
    const c = Math.cos(-0.7), s = Math.sin(-0.7)
    p.outlines = [{ points: [[-260, -60], [260, -60], [260, 60], [-260, 60]].map(([x, y]) => ({ x: 320 + x * c - y * s, y: 320 + x * s + y * c, s: false })), hole: false }]
    p.corner = 30
    return p
  }
  const need = { aura: 19, godrays: 30, pulse: 24, magic: 18 }, bad = []
  for (const id of Object.keys(need)) {
    for (const [name, p] of [['斜长条', diag(project(id))], ['外扩 40', project(id, { offset: 40 })]]) {
      const ctx = FX.prepare(copy(p), 0.5), n = FX.frameCount(p), { W, H, sd, u, N } = ctx.geo, band = Math.max(2, Math.round(0.02 * Math.min(W, H)))
      let reach = 0, edge = 0
      for (const f of [0.2, 0.45, 0.7]) {
        const img = FX.renderFrame(ctx, Math.round(f * (n - 1)))
        let ws = 0, w = 0
        for (let i = 0; i < N; i++) {
          const x = i % W, y = (i - x) / W
          if (x < band || y < band || x >= W - band || y >= H - band) edge = Math.max(edge, img[i * 4], img[i * 4 + 1], img[i * 4 + 2])
          if (sd[i] < 4 * u) continue
          const v = img[i * 4] + img[i * 4 + 1] + img[i * 4 + 2]
          ws += v * sd[i]; w += v
        }
        reach = Math.max(reach, ws / Math.max(1, w) / u)
      }
      if (reach < need[id]) bad.push(`${FX.effectOf(id).label} ${name}: reach ${reach.toFixed(1)}u`)
      if (edge > 60) bad.push(`${FX.effectOf(id).label} ${name}: edge pixel ${edge}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('火球 burning modes: loops close, stays inside the canvas', () => {
  // 2026-10-15 用户：火球应该能调燃烧方式——外扩 / 向上 都不出画板，循环首尾一致（风向、拖尾后来用户说不要）
  const bad = []
  for (const burn of ['out', 'up']) for (const width of [1, 3]) {
    const p = project('fireball'); p.params.burn = burn; p.params.width = width
    const ctx = FX.prepare(copy(p), 0.5), n = FX.frameCount(p), { W, H } = ctx.geo, band = Math.max(2, Math.round(0.02 * Math.min(W, H)))
    let edge = 0
    for (const f of [0.2, 0.5, 0.8]) {
      const img = FX.renderFrame(ctx, Math.round((n - 1) * f))
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < band || y < band || x >= W - band || y >= H - band) edge = Math.max(edge, img[(y * W + x) * 4], img[(y * W + x) * 4 + 1], img[(y * W + x) * 4 + 2])
    }
    if (edge > 60) bad.push(`${burn} 火舌 ${width}: edge pixel ${edge}`)
    const q = FX.prepare(copy(p), SCALE), d = diff(FX.renderFrame(q, 0), FX.renderFrame(q, n))
    if (!(d < 0.35)) bad.push(`${burn} 火舌 ${width}: loop seam ${d.toFixed(2)}`)
  }
  assert.deepEqual(bad, [])
})

test('一次性 clears by the last frame', () => {
  for (const fx of FX.effects().filter((e) => !e.needsBase)) {
    const p = project(fx.id, { lifecycle: 'once' })
    const ctx = FX.prepare(copy(p), SCALE), n = FX.frameCount(p)
    const mid = Math.max(...[0.2, 0.35, 0.5].map((f) => mean(FX.renderFrame(ctx, Math.round(f * (n - 1))))))
    const last = mean(FX.renderFrame(ctx, n - 1))
    assert.ok(mid > 0.3, `${fx.label}: something shows (${mid.toFixed(2)})`)
    assert.ok(last < mid * 0.15 + 0.3, `${fx.label}: last frame ${last.toFixed(2)} vs ${mid.toFixed(2)}`)
  }
})

test('every slider that is not greyed out changes the picture', () => {
  const bad = []
  for (const fx of FX.effects().filter((e) => !e.needsBase)) {
    const p = fx.kind === 'lib' ? roomy(fx.id) : project(fx.id)
    const n = FX.frameCount(p), at = [0.1, 0.3, 0.5, 0.7, 0.86, 0.95].map((f) => Math.round((n - 1) * f))
    const ref = at.map((i) => frame(p, i))
    for (const d of fx.params) {
      if (fx.inert && fx.inert[d.key]) continue
      if (d.options) {
        // 选项型（火球的 燃烧）：每个别的选项都要改画面
        for (const o of d.options) {
          if (o.id === p.params[d.key]) continue
          const q = copy(p); q.params[d.key] = o.id
          const change = Math.max(...at.map((i, k) => diff(frame(q, i), ref[k])))
          if (!(change > 0.15)) bad.push(`${fx.label} · ${d.label} → ${o.label} changed ${change.toFixed(3)}`)
        }
        continue
      }
      // 只在某些设置下起作用的（火球的 风向 只管 向上 / 拖尾）：换到它起作用的设置再测
      let base = p, baseRef = ref
      if (d.inertWhen && d.inertWhen(p.params)) {
        const opt = fx.params.find((x) => x.options && x.options.some((o) => !d.inertWhen({ ...p.params, [x.key]: o.id })))
        base = copy(p); base.params[opt.key] = opt.options.find((o) => !d.inertWhen({ ...p.params, [opt.key]: o.id })).id
        baseRef = at.map((i) => frame(base, i))
      }
      const def = base.params[d.key]
      const other = Math.abs(d.max - def) >= Math.abs(def - d.min) ? d.max : d.min
      const q = copy(base); q.params[d.key] = other
      const change = Math.max(...at.map((i, k) => diff(frame(q, i), baseRef[k])))
      if (!(change > 0.15)) bad.push(`${fx.label} · ${d.label} ${def} → ${other} changed ${change.toFixed(3)}`)
    }
  }
  assert.deepEqual(bad, [])
})

test('size sliders keep growing past the sweep tool\'s old top (火苗 2.5 → 6 is a bigger fire)', () => {
  // 扫光核心只算轮廓 64×S px 以内：火苗超过 2 以后改成整体放大，不然拉过去就截平了
  for (const id of ['edge-fire', 'edge-wisps', 'edge-aurora', 'edge-wideband']) {
    const a = project(id), b = project(id)
    a.params.extra = 2.5; b.params.extra = 6
    const lit = (f) => { let n = 0; for (let i = 0; i < f.length; i += 4) if (f[i] + f[i + 1] + f[i + 2] > 60) n++; return n }
    const la = lit(frame(a, 12)), lb = lit(frame(b, 12))
    assert.ok(lb > la * 1.4, `${FX.effectOf(id).label}: lit pixels ${la} → ${lb}`)
  }
})

test('colour, particle look, start, direction and motion all reach the picture', () => {
  const at = 12
  const meteor = project('edge-meteor')
  const ref = frame(meteor, at)
  const changes = {
    colour: { colour: { mode: 'custom', value: '#ff3030' } },
    start: { start: { x: 320, y: 500 } },
    direction: { direction: 'cw' },
    motion: { motion: { kind: 'breathe', amount: 2 } },
  }
  for (const [name, extra] of Object.entries(changes)) {
    const q = Object.assign(copy(meteor), copy(extra))
    assert.ok(diff(frame(q, name === 'motion' ? 5 : at), frame(meteor, name === 'motion' ? 5 : at)) > 0.1, name)
  }
  assert.ok(diff(ref, frame(Object.assign(copy(meteor), { offset: 30 }), at)) > 0.1, 'offset')
  // 效果库的颜色三档：默认配色 / 白光 / 自选
  const pulse = project('pulse')
  for (const colour of [{ mode: 'white' }, { mode: 'custom', value: '#ff3030' }]) {
    assert.ok(diff(frame(pulse, 10), frame(Object.assign(copy(pulse), { colour }), 10)) > 0.1, 'colour ' + colour.mode)
  }
  // 起点 / 方向置灰的效果：真的没变化（不然就不该置灰）
  const fire = project('edge-fire')
  assert.ok(FX.effectOf('edge-fire').inert.start)
  assert.ok(diff(frame(fire, at), frame(Object.assign(copy(fire), { start: { x: 320, y: 500 } }), at)) < 0.05, 'edge-fire ignores the start')
})

test('break / vanish effects break the uploaded picture itself, not just a glowing shape', () => {
  // 2026-10-15 用户：「这些碎裂消失是根据用户上传的图去做的吗？如果不是就没什么用」
  const w = 120, h = 120, data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; if ((x - 60) ** 2 + (y - 60) ** 2 < 50 ** 2) { data[o] = 230; data[o + 1] = 30; data[o + 2] = 30; data[o + 3] = 255 } }
  const baseImg = { w, h, data }
  const red = (img) => { let n = 0; for (let i = 0; i < img.length; i += 4) if (img[i] > 120 && img[i] > img[i + 1] * 2 && img[i] > img[i + 2] * 2) n++; return n }
  // 每个效果取画面最清楚的那一刻（碎裂迸散开头整块发光，取碎开以后）
  const when = { shatter: 0.5, glassbreak: 0.1, crackglow: 0.1, crumble: 0.3, smokeout: 0.02 }
  for (const id of Object.keys(when)) {
    const p = project(id)
    p.base = { w, h, scale: 0.6, opacity: 0.5 }
    p.shape.kind = 'trace'
    p.outlines = FX.traceImage(data, w, h, FX.basePlacement(p), 640, 640, 0.6, true)
    const n = FX.frameCount(p), at = Math.round((n - 1) * when[id])
    const withImg = red(FX.renderFrame(FX.prepare(copy(p), SCALE, baseImg), at))
    const off = red(FX.renderFrame(FX.prepare(Object.assign(copy(p), { useImage: false }), SCALE, baseImg), at))
    assert.ok(withImg > 20, `${FX.effectOf(id).label}: the picture's red shows (${withImg})`)
    assert.ok(off < withImg * 0.2, `${FX.effectOf(id).label}: 只用发光形状 has none of it (${off})`)
  }
})

test('the AI gets the shape the editor drew, not a guess', () => {
  const p = project('edge-meteor')
  for (const [kind, word] of [['rect', 'rectangular border'], ['roundrect', 'rounded-rectangle border'], ['circle', 'circular border'], ['star', 'star-shaped border'], ['heart', 'heart-shaped border'], ['trace', 'custom-shaped border']]) {
    p.shape.kind = kind
    const ai = FX.aiDescriptor(p)
    assert.equal(ai.archetype, 'frame')
    assert.ok(ai.shape.startsWith(word), kind + ': ' + ai.shape)
    assert.ok(!/ of light|glowing/.test(ai.plainShape), 'the plain wording names no light')
  }
  assert.equal(FX.aiDescriptor(project('shatter')).archetype, 'shatter')
  assert.equal(FX.aiDescriptor(project('fireworks')).archetype, 'burst')
  assert.equal(FX.aiDescriptor(project('charge')).archetype, 'converge')
  assert.equal(FX.aiDescriptor(project('firebomb')).lifecycle, 'once')
  for (const fx of FX.effects()) assert.ok(FX.aiDescriptor(project(fx.id)).shape.length > 20, fx.label + ' has words for the AI')
})

test('按底图本身扫（线性扫光 / 形态驱动 / 局部高光 / 径向）：有底图出光、没底图是空画面、成片不带底图', () => {
  // 2026-10-15 用户：特效扫光存进模板库的也要能在模板制作里再编辑，所以模板制作也有这几类
  const w = 120, h = 80, data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, inside = Math.hypot((x - 60) / 50, (y - 40) / 30) < 1; data[o] = 200; data[o + 1] = 120 + (x % 40); data[o + 2] = 40; data[o + 3] = inside ? 255 : 0 }
  const base = { w, h, data }
  const ids = FX.effects().filter((e) => e.kind === 'basesweep').map((e) => e.id)
  assert.equal(ids.length, 10)
  for (const id of ids) {
    const p = project(id, { lifecycle: 'loop', base: { w, h, scale: 0.7, opacity: 0.5 } })
    const ctx = FX.prepare(copy(p), SCALE, base), n = FX.frameCount(p)
    const lit = Math.max(...[0.2, 0.4, 0.6, 0.8].map((f) => mean(FX.renderFrame(ctx, Math.round(f * (n - 1))))))
    assert.ok(lit > 0.3, `${FX.effectOf(id).label}: lights up (${lit.toFixed(2)})`)
    const none = FX.prepare(copy({ ...p, base: null }), SCALE, null)
    assert.ok(mean(FX.renderFrame(none, 10)) < 0.05, `${FX.effectOf(id).label}: no base, no light`)
  }
})

test('特效扫光出切片：精确画板（不按 32 取整）+ 任意帧数', () => {
  const p = project('aura', { canvas: { preset: 'exact', w: 333, h: 217 }, framesFree: true, frames: 17 })
  const size = FX.canvasSize(p)
  assert.equal(size.w, 333); assert.equal(size.h, 217)
  assert.equal(FX.frameCount(p), 17)
  const ctx = FX.prepare(copy(p), 1)
  assert.equal(FX.renderFrame(ctx, 3).length, 333 * 217 * 4)
  assert.equal(FX.frameCount(project('aura', { frames: 17 })), 39, 'templates keep the four durations')
})

test('特效扫光的打碎 / 化开底图切片：直通透明度——底图画面（暗色也）不透明、画面外透明；黑底成片照旧', () => {
  // 2026-10-16 用户：打碎、化开底图也算编辑底图，特效扫光里要有；切片在 Spine 里正常混合、替掉原底图
  const w = 120, h = 120, data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; if ((x - 60) ** 2 + (y - 60) ** 2 < 50 ** 2) { data[o] = 40; data[o + 1] = 30; data[o + 2] = 50; data[o + 3] = 255 } }
  const baseImg = { w, h, data }
  const p = project('crumble', { canvas: { preset: 'exact', w: 200, h: 200 }, framesFree: true, frames: 12 })
  p.base = { w, h, scale: 1 / Math.min(200 / w, 200 / h), opacity: 0.5 }
  p.shape.kind = 'trace'
  p.outlines = FX.traceImage(data, w, h, FX.basePlacement(p), 200, 200, 0.5, true)
  const plate = FX.renderFrame(FX.prepare(copy(p), 1, baseImg), 0)
  for (let i = 3; i < plate.length; i += 4) assert.equal(plate[i], 255, 'black-plate frames stay opaque')
  const slice = FX.renderFrame(FX.prepare(Object.assign(copy(p), { sliceAlpha: true }), 1, baseImg), 0)
  let solidDark = 0, clearOutside = 0, outside = 0
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
    const o = (y * 200 + x) * 4, r = Math.hypot(x - 100, y - 100)
    if (r < 40 && slice[o + 3] > 250 && slice[o] < 80) solidDark++
    if (r > 80) { outside++; if (slice[o + 3] < 5) clearOutside++ }
  }
  assert.ok(solidDark > Math.PI * 40 * 40 * 0.9, `the dark picture is solid in the slice (${solidDark})`)
  assert.ok(clearOutside > outside * 0.95, `outside the picture is see-through (${clearOutside}/${outside})`)
})
