const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
require(path.join(renderer, 'spine-structure.ops.js'))
require(path.join(renderer, 'motion-calculation.animation.js'))
const Ops = globalThis.NovaFlowSpineStructureOps
const Motion = globalThis.NovaFlowMotionAnimation
const ctx = vm.createContext({ console, Float32Array, setTimeout })
vm.runInContext(fs.readFileSync(path.join(renderer, 'vendor/spine/spine-webgl-3.8.js'), 'utf8') + '\nthis.spine = spine', ctx)
const spine = ctx.spine
const curve = { curve: 0.15, c2: -0.15, c3: 0.8, c4: 1.05 }
function project(kind = 'rotate', extra = {}) {
  const values = kind === 'rotate' ? [{ angle: 0 }, { angle: 70 }, { angle: 0 }]
    : [{ x: 0, y: 0 }, { x: 80, y: -30 }, { x: 0, y: 0 }]
  return { bones: [{ name: 'root' }], slots: [], skins: [], animations: { loop: { bones: { root: {
    [kind]: values.map((v, i) => ({ ...v, time: i / 2, ...(i < 2 ? curve : {}), ...extra }))
  } } } } }
}
function sample(json, kind, time) {
  const data = new spine.SkeletonJson({}).readSkeletonData(Ops.editorData(json))
  const sk = new spine.Skeleton(data); sk.setToSetupPose()
  data.findAnimation('loop').apply(sk, 0, time, false, null, 1, spine.MixBlend.setup, spine.MixDirection.mixIn)
  const b = sk.findBone('root')
  return kind === 'rotate' ? [b.rotation] : [b.x, b.y]
}
const keysOf = (j, kind) => j.animations.loop.bones.root[kind]
const picked = (j, kind) => keysOf(j, kind).map(k => ({ path: ['bones', 'root', kind], time: k.time || 0 }))
const wrap = t => ((t % 1) + 1) % 1
function compareShift(before, after, kind, dt, tolerance = 0.8) {
  let worst = 0
  for (let i = 0; i < 200; i++) {
    const t = (i + 0.37) / 200, expected = sample(before, kind, wrap(t - dt)), actual = sample(after, kind, t)
    expected.forEach((v, axis) => { worst = Math.max(worst, Math.abs(actual[axis] - v)) })
  }
  assert(worst < tolerance, `runtime error ${worst} exceeds ${tolerance}`)
}

test('positive, negative, and multiple-period offsets split the seam cubic and preserve runtime motion', () => {
  for (const dt of [0.17, -0.17, 2.17, -2.17, 0.5]) {
    const j = project(), before = JSON.stringify(j)
    const r = Ops.moveKeys(j, 'loop', picked(j, 'rotate'), dt, { offset: true })
    assert.equal(JSON.stringify(j), before)
    compareShift(j, r.json, 'rotate', dt)
    const list = keysOf(r.json, 'rotate')
    assert.equal(list[0].angle, list.at(-1).angle)
    assert.equal(typeof list[0].curve, 'number', 'curve remains editable at the new seam')
    assert(list.every(k => [k.curve, k.c2, k.c3, k.c4].filter(v => typeof v === 'number').every(Number.isFinite)))
  }
})

test('offset preserves independent X/Y easing including sparse default coordinates', () => {
  const j = project('translate', { nfCurves: { x: [0.2, 0, 0.7, 1], y: [0.8, 0, 1, 0.2] } })
  delete keysOf(j, 'translate')[0].y; delete keysOf(j, 'translate')[2].y
  const r = Ops.moveKeys(j, 'loop', picked(j, 'translate'), 0.19, { offset: true })
  compareShift(j, r.json, 'translate', 0.19, 0.03)
  const first = keysOf(r.json, 'translate')[0]
  assert(first.nfCurves.x && first.nfCurves.y)
  assert.notDeepEqual(first.nfCurves.x, first.nfCurves.y)
})

test('stepped segments keep their hold when offset across the seam', () => {
  const j = project('rotate', { curve: 'stepped' })
  const r = Ops.moveKeys(j, 'loop', picked(j, 'rotate'), 0.17, { offset: true })
  compareShift(j, r.json, 'rotate', 0.17, 1e-6)
  assert.equal(keysOf(r.json, 'rotate')[0].curve, 'stepped')
})

test('ordinary move and shift carry curve metadata with every moved key', () => {
  const j = project('translate', { nfCurves: { x: [0.2, 0, 0.7, 1], y: [0.8, 0, 1, 0.2] } })
  for (const opts of [{}, { shift: true }]) {
    const r = Ops.moveKeys(j, 'loop', picked(j, 'translate'), 0.2, opts)
    const moved = keysOf(r.json, 'translate')
    keysOf(j, 'translate').forEach((k, i) => {
      assert(Math.abs(moved[i].time - k.time - 0.2) < 1e-6)
      for (const field of ['curve', 'c2', 'c3', 'c4', 'nfCurves']) assert.deepEqual(moved[i][field], k[field])
    })
    for (let i = 0; i < 100; i++) {
      const t = (i + .37) / 100
      const before = sample(j, 'translate', t), after = sample(r.json, 'translate', t + .2)
      before.forEach((v, axis) => assert(Math.abs(v - after[axis]) < .03))
    }
  }
})

test('splitting an overshoot at equal-valued endpoints keeps a finite curve and its excursion', () => {
  const j = project('rotate', { curve: 1/3, c2: 3, c3: 2/3, c4: -2 })
  // y=t*(4t-3)^2 returns to zero at x=.75; that half needs an extra point.
  const dt = 0.125
  const r = Ops.moveKeys(j, 'loop', picked(j, 'rotate'), dt, { offset: true })
  assert(keysOf(r.json, 'rotate').length >= 5)
  for (let i=0; i<400; i++) {
    const t=(i+.37)/400
    assert(Math.abs(Motion.scalar(keysOf(j,'rotate'),wrap(t-dt),'angle',0)-Motion.scalar(keysOf(r.json,'rotate'),t,'angle',0))<.08)
  }
  assert(keysOf(r.json,'rotate').every(k => [k.curve,k.c2,k.c3,k.c4].filter(v=>typeof v==='number').every(Number.isFinite)))
})

test('zero and whole-period offsets leave authored curves and keys unchanged', () => {
  const j = project()
  for (const dt of [0, 1, -2]) {
    const r=Ops.moveKeys(j,'loop',picked(j,'rotate'),dt,{offset:true})
    assert.deepEqual(keysOf(r.json,'rotate'),keysOf(j,'rotate'))
  }
})

test('unrelated timelines retain their keys and curves exactly', () => {
  const j = project(); j.animations.loop.bones.other = { translate: [{ x: 0, ...curve }, { time: 1, x: 20 }] }
  j.bones.push({ name: 'other', parent: 'root' })
  const before = JSON.stringify(j.animations.loop.bones.other)
  const r = Ops.moveKeys(j, 'loop', picked(j, 'rotate'), -0.31, { offset: true })
  assert.equal(JSON.stringify(r.json.animations.loop.bones.other), before)
})
