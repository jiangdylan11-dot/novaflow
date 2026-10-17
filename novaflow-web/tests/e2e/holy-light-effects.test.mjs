import assert from 'node:assert/strict'
import test from 'node:test'
import '../../renderer/sweep-light.core.js'
import '../../renderer/aifx-template-maker.core.js'
import '../../renderer/aifx-template-maker.fx.js'

const F = globalThis.NovaFlowFxMaker
const effects = F.effects().filter((e) => e.id.startsWith('holy-') && !e.retired)
const project = (effect, patch = {}) => ({ ...F.defaultProject(), effect, lifecycle: 'loop', params: { ...F.effectDefaults(effect), ...patch } })
const render = (p, fraction = .23) => {
  const ctx = F.prepare(p, .125)
  return F.renderFrame(ctx, Math.round(fraction * ctx.n))
}
const difference = (a, b) => { let total = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) total += Math.abs(a[i] - b[i]); return total / (a.length / 4 * 3) }
const energy = (a) => { let total = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) total += a[i]; return total }

test('preview cache reuses geometry without sharing mutable effect frames or changing output', () => {
  const cache = {}, p = project('holy-rotate'), a = F.prepare(p, .125, null, cache)
  const expected = F.renderFrame(a, 7).slice()
  for (const effect of effects) {
    const q = project(effect.id, { bright: 1.3 })
    const cached = F.prepare(q, .125, null, cache), fresh = F.prepare(q, .125)
    assert.equal(cached.geo.sd, a.geo.sd)
    assert.notEqual(cached.state.field, a.state.field)
    assert.deepEqual(F.renderFrame(cached, 7), F.renderFrame(fresh, 7), effect.label)
  }
  assert.deepEqual(F.renderFrame(a, 7), expected)
  for (const q of [{ ...p, offset: 7 }, { ...p, corner: 0 }, { ...p, outerOnly: true }]) {
    const c = F.prepare(q, .125, null, cache)
    assert.notEqual(c.geo.sd, a.geo.sd)
    assert.deepEqual(F.renderFrame(c, 7), F.renderFrame(F.prepare(q, .125), 7))
  }
  assert.notEqual(F.prepare(p, .25, null, cache).geo.sd, a.geo.sd)
})

test('nine selectable effects have behaviour-based categories; retired projects remain readable', () => {
  assert.deepEqual(effects.map((e) => e.label).sort(), ['虹膜开合', '呼吸霞光', '双层天幕', '涌动光冠', '流星放射', '双流交辉', '脉冲光潮', '旋转圣光', '交错光扇'].sort())
  assert.equal(new Set(effects.map((e) => e.id)).size, 9)
  assert.equal(F.effectOf('holy-aurora').retired, true)
  assert.equal(F.effectOf('holy-twin').group, '轮廓流光')
  assert.equal(F.effectOf('holy-tide').group, '扩散')
  for (const id of ['godrays', 'aura', 'holy-rotate', 'holy-iris']) assert.equal(F.effectOf(id).group, '光晕放射')
  for (const e of effects) { assert.equal(e.kind, 'lib'); assert.equal(e.centered, false); assert.ok(!e.needsBase); assert.ok(e.params.some((p) => p.key === 'bright')) }
})

test('every exposed numeric parameter changes actual generated pixels', () => {
  for (const effect of effects) {
    for (const def of effect.params) {
      if (def.options) continue
      const mode = def.key === 'speed' ? 'single' : ['angle', 'cycles'].includes(def.key) && effect.params.some(p => p.key === 'orbitMode') ? 'swing' : undefined
      const p = project(effect.id, mode ? { orbitMode: mode } : {}), base = [.23, .57].map((at) => render(p, at))
      const next = Math.abs(def.max - def.def) >= Math.abs(def.def - def.min) ? def.max : def.min
      const q = { ...p, params: { ...p.params, [def.key]: next } }
      const diff = Math.max(...[.23, .57].map((at, i) => difference(base[i], render(q, at))))
      assert.ok(diff > .08, `${effect.label}: ${def.label} changed pixels by ${diff.toFixed(4)}`)
    }
  }
})

test('all nine effects expose the same motion choices while retaining stationary local animation', () => {
  for (const e of effects) {
    assert.deepEqual(e.params.find(p => p.key === 'orbitMode').options.map(o => o.id), ['still', 'swing', 'single'])
    const angle = e.params.find(p => p.key === 'angle')
    assert.ok(angle.def > 0 && angle.def <= 30)
    const p = project(e.id, { angle: 0, orbitMode: 'swing' })
    assert.deepEqual(render(p), render({ ...p, direction: 'cw' }))
    const ctx = F.prepare(project(e.id, { angle: angle.max, cycles: 3, orbitMode: 'swing' }), .125)
    assert.deepEqual(F.renderFrame(ctx, 0), F.renderFrame(ctx, ctx.n))
    const still = project(e.id, { orbitMode: 'still' })
    assert.ok(difference(render(still, .12), render(still, .35)) > .08, e.label + ' local animation')
    assert.ok(difference(render(still), render(project(e.id, { orbitMode: 'single' }))) > .08, e.label + ' real angular motion')
  }
})

test('direction, colours and JSON project reopening retain their real effect', () => {
  for (const effect of effects) {
    const p = project(effect.id), original = render(p)
    const reverse = { ...p, direction: 'cw' }
    if (effect.inert.direction || p.params.orbitMode === 'still') assert.deepEqual(original, render(reverse), effect.label + ' stationary direction')
    else assert.ok(difference(original, render(reverse)) > .08, effect.label + ' direction')
    const blue = { ...p, colour: { mode: 'custom', value: '#2385ff' } }
    assert.ok(difference(original, render(blue)) > .2, effect.label + ' colour')
    const edited = project(effect.id, { width: 1.65, bright: 1.3, laps: 2 })
    assert.deepEqual(render(edited), render(JSON.parse(JSON.stringify(edited))), effect.label + ' saved parameters')
  }
})

test('single direction advances monotonically in degrees per second and blends a partial loop seam', () => {
  for (const { id } of effects) {
    const p = project(id, { orbitMode: 'single', speed: 20 }), ctx = F.prepare(p, .125)
    const motion = t => ctx.fx.motionAt(ctx, t)
    for (let i = 1; i < 10; i++) for (let layer = 0; layer < 2; layer++) assert.ok(motion(i / 10)[layer].turn > motion((i - 1) / 10)[layer].turn)
    const expected = 20 * Math.PI / 180 * ctx.n / F.FPS
    assert.ok(Math.abs(motion(.8)[0].turn - motion(.2)[0].turn - expected * .6) < 1e-9)
    const reversed = F.prepare({ ...p, direction: 'cw' }, .125)
    assert.ok(reversed.fx.motionAt(reversed, .5)[0].turn < 0)
    const slow = F.prepare(project(id, { orbitMode: 'single', speed: .5 }), .125)
    assert.ok(slow.fx.motionAt(slow, .5)[0].turn > 0)
    const first = F.renderFrame(ctx, 0).slice(), last = F.renderFrame(ctx, ctx.n - .00001)
    assert.ok(difference(first, last) < (['holy-twin', 'holy-tide'].includes(id) ? .05 : .01), id + ' fractional-turn seam')
    const still = F.prepare(project(id, { orbitMode: 'still' }), .125)
    assert.deepEqual(still.fx.motionAt(still, .4), [{ turn: 0, weight: 1 }])
    assert.deepEqual(render(p), render(JSON.parse(JSON.stringify(p))))
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
