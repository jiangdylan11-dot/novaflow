import assert from 'node:assert/strict'
import test from 'node:test'
import '../../renderer/sweep-light.core.js'
import '../../renderer/aifx-template-maker.core.js'
import '../../renderer/aifx-template-maker.fx.js'

const F = globalThis.NovaFlowFxMaker
const effects = F.effects().filter((e) => e.group === '环绕光效')
const project = (effect, patch = {}) => ({ ...F.defaultProject(), effect, lifecycle: 'loop', params: { ...F.effectDefaults(effect), ...patch } })
const render = (p, fraction = .23) => {
  const ctx = F.prepare(p, .125)
  return F.renderFrame(ctx, Math.round(fraction * ctx.n))
}
const difference = (a, b) => { let total = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) total += Math.abs(a[i] - b[i]); return total / (a.length / 4 * 3) }
const energy = (a) => { let total = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) total += a[i]; return total }

test('the ten selected original effects form one contour-capable shared group', () => {
  assert.deepEqual(effects.map((e) => e.label).sort(), ['虹膜开合', '呼吸霞光', '双层天幕', '涌动光冠', '流星放射', '极光冠冕', '双流交辉', '脉冲光潮', '旋转圣光', '交错光扇'].sort())
  assert.equal(new Set(effects.map((e) => e.id)).size, 10)
  for (const e of effects) { assert.equal(e.kind, 'lib'); assert.equal(e.centered, false); assert.ok(!e.inert.direction); assert.ok(!e.needsBase); assert.ok(e.params.some((p) => p.key === 'bright')) }
})

test('every exposed numeric parameter changes actual generated pixels', () => {
  for (const effect of effects) {
    const p = project(effect.id), base = [.23, .57].map((at) => render(p, at))
    for (const def of effect.params) {
      const next = Math.abs(def.max - def.def) >= Math.abs(def.def - def.min) ? def.max : def.min
      const q = project(effect.id, { [def.key]: next })
      const diff = Math.max(...[.23, .57].map((at, i) => difference(base[i], render(q, at))))
      assert.ok(diff > .08, `${effect.label}: ${def.label} changed pixels by ${diff.toFixed(4)}`)
    }
  }
})

test('direction, colours and JSON project reopening retain their real effect', () => {
  for (const effect of effects) {
    const p = project(effect.id), original = render(p)
    const reverse = { ...p, direction: 'cw' }
    assert.ok(difference(original, render(reverse)) > .08, effect.label + ' direction')
    const blue = { ...p, colour: { mode: 'custom', value: '#2385ff' } }
    assert.ok(difference(original, render(blue)) > .2, effect.label + ' colour')
    const edited = project(effect.id, { width: 1.65, bright: 1.3, laps: 2 })
    assert.deepEqual(render(edited), render(JSON.parse(JSON.stringify(edited))), effect.label + ' saved parameters')
  }
})

test('loop endpoints coincide, once-only ends clear, and transparent slices composite correctly', () => {
  for (const effect of effects) {
    const p = project(effect.id), ctx = F.prepare(p, .125)
    const centre = F.renderFrame(ctx, Math.round(ctx.n * .6)), offset = (40 * 80 + 40) * 4
    assert.ok(centre[offset] + centre[offset + 1] + centre[offset + 2] < 4, effect.label + ' empty middle stays black')
    assert.deepEqual(F.renderFrame(ctx, 0), F.renderFrame(ctx, ctx.n), effect.label + ' loop seam')
    const once = F.prepare({ ...p, lifecycle: 'once' }, .125)
    assert.ok(energy(F.renderFrame(once, Math.round(once.n * .4))) > 1000)
    assert.equal(energy(F.renderFrame(once, once.n - 1)), 0, effect.label + ' once end')
    const opaque = render(p), alpha = render({ ...p, sliceAlpha: true })
    let clear = 0
    for (let i = 0; i < alpha.length; i += 4) {
      if (!alpha[i + 3]) clear++
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(alpha[i + c] * alpha[i + 3] / 255 - opaque[i + c]) < 2, effect.label + ' alpha composite')
    }
    assert.ok(clear > 100, effect.label + ' transparent background')
  }
})

test('star and irregular outlines remain distinct and canvas borders stay dark', () => {
  for (const effect of effects) {
    const p = project(effect.id), rectangle = render(p)
    for (const kind of ['star', 'heart']) {
      const q = project(effect.id)
      q.corner = 0
      q.shape.kind = kind
      q.outlines = [{ points: F.shapeOutline(kind, { x: 180, y: 170, w: 270, h: 280 }), hole: false }]
      const frame = render(q)
      assert.ok(difference(frame, rectangle) > .2, effect.label + ' ' + kind)
      const w = 80
      for (let j = 0; j < w; j++) for (const pixel of [j, (w - 1) * w + j, j * w, j * w + w - 1]) {
        assert.ok(frame[pixel * 4] + frame[pixel * 4 + 1] + frame[pixel * 4 + 2] < 3, effect.label + ' border')
      }
    }
  }
})
