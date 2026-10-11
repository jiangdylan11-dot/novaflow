// node novaflow-web/tests/e2e/spine-version-convert.test.cjs
// The 骨骼动画 editor edits Spine 3.8 data; a 4.x project is converted on import and back on
// export (renderer/spine-version-convert.js). Checked here with the two vendored runtimes: the
// 4.0 wheelspin rig plays the same in 4.0 (original) and 3.8 (converted), and the way back gives
// the original file again; 4.1 sequences and 4.2 physics survive the round trip.
'use strict'
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert')

const ROOT = path.resolve(__dirname, '..', '..', '..')
require(path.join(ROOT, 'novaflow-web/renderer/spine-version-convert.js'))
const V = globalThis.NovaFlowSpineVersion

function runtime(file, name) {
  const ctx = { console, Math, Float32Array, Int16Array, Uint16Array, Array, Object, Error, setTimeout, Map, Set }
  ctx.window = ctx
  vm.createContext(ctx)
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'novaflow-web/renderer/vendor/spine', file), 'utf8') + '\n;this.' + name + ' = spine', ctx)
  return ctx[name]
}
const S38 = runtime('spine-webgl-3.8.js', 'spine38')
const S40 = runtime('spine-webgl-4.0.js', 'spine40')

function fakeRegion() {
  const r = { u: 0, v: 0, u2: 1, v2: 1, width: 1, height: 1, originalWidth: 1, originalHeight: 1, offsetX: 0, offsetY: 0, rotate: false, degrees: 0, texture: null }
  r.renderObject = r
  return r
}
function loaderFor(S) {
  return {
    newRegionAttachment: (skin, name) => { const a = new S.RegionAttachment(name); a.region = fakeRegion(); if (a.setRegion) try { a.setRegion(a.region) } catch {} return a },
    newMeshAttachment: (skin, name) => { const a = new S.MeshAttachment(name); a.region = fakeRegion(); return a },
    newBoundingBoxAttachment: (skin, name) => new S.BoundingBoxAttachment(name),
    newPathAttachment: (skin, name) => new S.PathAttachment(name),
    newPointAttachment: (skin, name) => new S.PointAttachment(name),
    newClippingAttachment: (skin, name) => new S.ClippingAttachment(name),
  }
}
function load(S, json) {
  const data = new S.SkeletonJson(loaderFor(S)).readSkeletonData(JSON.parse(JSON.stringify(json)))
  const sk = new S.Skeleton(data)
  sk.setToSetupPose()
  sk.updateWorldTransform()
  return sk
}
function pose(S, sk, anim, t) {
  sk.setToSetupPose()
  if (anim) sk.data.findAnimation(anim).apply(sk, 0, t, false, null, 1, S.MixBlend.setup, S.MixDirection.mixIn)
  sk.updateWorldTransform()
  return sk
}

let passed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('ok  ', name) } catch (e) { console.log('FAIL', name, '\n     ', e.message); process.exitCode = 1 }
}

const wheelPath = path.join(ROOT, 'particle-editor/debug-assets/wheelspin-local/wheelspin.json')
const wheel = JSON.parse(fs.readFileSync(wheelPath, 'utf8'))

test('wheelspin (4.0): converted to 3.8, every animation plays the same in the 3.8 runtime', () => {
  assert(V.is4(wheel), 'the fixture is a 4.x file')
  const j38 = V.toSpine38(wheel)
  assert.strictEqual(V.versionOf(j38), '3.8.99')
  const a = load(S40, wheel), b = load(S38, j38)
  let worst = 0, where = ''
  for (const anim of Object.keys(wheel.animations)) {
    const dur = a.data.findAnimation(anim).duration
    for (let t = 0; t <= dur + 1e-6; t += 1 / 30) {
      pose(S40, a, anim, t + 1e-4); pose(S38, b, anim, t + 1e-4)
      for (let i = 0; i < a.bones.length; i++) {
        const p = a.bones[i], q = b.bones[i]
        const d = Math.max(Math.abs(p.worldX - q.worldX), Math.abs(p.worldY - q.worldY), Math.abs(p.a - q.a) * 100, Math.abs(p.d - q.d) * 100)
        if (d > worst) { worst = d; where = `${anim} @${t.toFixed(3)} ${p.data.name}` }
      }
    }
  }
  // one shared 3.8 curve stands in for 4.0's per-channel curves: a small drift is the cost
  assert(worst < 2, `max difference ${worst.toFixed(3)} at ${where}`)
  console.log('      max bone difference', worst.toFixed(4), where)
})

test('wheelspin: 3.8 back to 4.0 gives the original file (untouched keys come back exactly)', () => {
  const back = V.fromSpine38(V.toSpine38(wheel))
  assert.strictEqual(V.versionOf(back), V.versionOf(wheel))
  // the same 4.0 project asked for as 4.2 / 3.8
  assert(V.versionOf(V.fromSpine38(V.toSpine38(wheel), '4.2')).startsWith('4.2'))
  const as38 = V.fromSpine38(V.toSpine38(wheel), '3.8')
  assert.strictEqual(V.versionOf(as38), '3.8.99'); assert(!as38[V.STASH]); load(S38, as38)
  assert.deepStrictEqual(back.animations, wheel.animations)
  assert.deepStrictEqual(back.transform || [], wheel.transform || [])
  assert.deepStrictEqual(back.path || [], wheel.path || [])
  assert.deepStrictEqual(back.bones, wheel.bones)
  load(S40, back)
})

test('an edited 3.8 key goes back to 4.0 with its curve converted (absolute time / value)', () => {
  const j = { skeleton: { spine: '4.0.64' }, bones: [{ name: 'root' }], slots: [], skins: [{ name: 'default', attachments: {} }],
    animations: { a: { bones: { root: { rotate: [{ value: 10, curve: [0.25, 20, 0.75, 40] }, { time: 1, value: 50 }], translate: [{ x: 0, y: 0, curve: [0.1, 1, 0.9, 9, 0.1, 0, 0.9, 0] }, { time: 1, x: 10, y: 0 }] } } } } }
  const j38 = V.toSpine38(j)
  const r = j38.animations.a.bones.root.rotate[0]
  assert.deepStrictEqual([r.angle, r.curve, r.c2, r.c3, r.c4], [10, 0.25, 0.25, 0.75, 0.75])
  // translate: y does not move, the curve comes from x
  const tr = j38.animations.a.bones.root.translate[0]
  assert.deepStrictEqual([tr.curve, tr.c2, tr.c3, tr.c4], [0.1, 0.1, 0.9, 0.9])
  // edit the rotate key: it is converted, the untouched translate goes back as it was
  j38.animations.a.bones.root.rotate[0].angle = 30
  const back = V.fromSpine38(j38)
  assert.deepStrictEqual(back.animations.a.bones.root.rotate[0], { value: 30, curve: [0.25, 35, 0.75, 45] })
  assert.deepStrictEqual(back.animations.a.bones.root.translate, j.animations.a.bones.root.translate)
  // the 3.8 and the 4.0 reading of the same curve agree in the runtimes
  const a = load(S40, j), b = load(S38, V.toSpine38(j))
  for (const t of [0.2, 0.5, 0.8]) {
    pose(S40, a, 'a', t); pose(S38, b, 'a', t)
    assert(Math.abs(a.bones[0].rotation - b.bones[0].rotation) < 1e-3 || Math.abs(a.bones[0].worldX - b.bones[0].worldX) < 1e-3)
  }
})

test('4.0 split channels, rgb + alpha, mixes: converted for 3.8 and restored', () => {
  const j = { skeleton: { spine: '4.0.64' }, bones: [{ name: 'root' }, { name: 'b', parent: 'root' }, { name: 't', parent: 'root' }],
    slots: [{ name: 's', bone: 'b', color: 'ff8800ff' }], skins: [{ name: 'default', attachments: {} }],
    transform: [{ name: 'tc', bones: ['b'], target: 't', mixRotate: 0.5, mixX: 0.25, mixY: 0.75, mixScaleX: 0.5, mixShearY: 0 }],
    animations: { a: {
      bones: { b: { translatex: [{ value: 0 }, { time: 1, value: 10 }], translatey: [{ time: 0.5, value: 4 }] } },
      slots: { s: { rgb: [{ color: 'ff0000' }, { time: 1, color: '00ff00' }], alpha: [{ value: 1 }, { time: 1, value: 0.5 }] } },
      transform: { tc: [{ mixRotate: 0.5, mixX: 0.25, mixY: 0.75 }, { time: 1, mixRotate: 1, mixX: 1, mixY: 1 }] },
    } } }
  const j38 = V.toSpine38(j)
  assert.strictEqual(j38.transform[0].rotateMix, 0.5)
  assert.strictEqual(j38.transform[0].translateMix, 0.25)
  assert(!('mixX' in j38.transform[0]))
  const tl = j38.animations.a.bones.b.translate
  assert.deepStrictEqual(tl.map((k) => [k.time || 0, k.x, k.y]), [[0, 0, 4], [0.5, 5, 4], [1, 10, 4]])
  assert(j38.animations.a.slots.s.color.length >= 2 && /^ff0000ff$/i.test(j38.animations.a.slots.s.color[0].color))
  load(S38, j38)
  const back = V.fromSpine38(j38)
  assert.deepStrictEqual(back.animations, j.animations)
  assert.deepStrictEqual(back.transform, j.transform)
})

test('4.1 sequences + attachment timelines, 4.2 physics + inherit: kept for the way back', () => {
  const j = { skeleton: { spine: '4.2.11' }, bones: [{ name: 'root' }, { name: 'b', parent: 'root', inherit: 'noScale' }],
    slots: [{ name: 's', bone: 'b', attachment: 'fx' }],
    skins: [{ name: 'default', attachments: { s: { fx: { width: 10, height: 10, sequence: { count: 3, start: 1, digits: 2 } } } } }],
    physics: [{ name: 'p', bone: 'b', x: 1 }],
    animations: { a: {
      attachments: { default: { s: { fx: { sequence: [{ mode: 'loop', delay: 0.1 }] } } } },
      physics: { p: { mix: [{ value: 1 }] } },
      bones: { b: { inherit: [{ inherit: 'normal' }] } },
    } } }
  const j38 = V.toSpine38(j)
  assert.strictEqual(j38.bones[1].transform, 'noScale')
  assert.strictEqual(j38.skins[0].attachments.s.fx.path, 'fx01', 'the first frame of the sequence')
  assert(!j38.physics && !j38.animations.a.physics && !j38.animations.a.attachments)
  const back = V.fromSpine38(j38)
  assert.deepStrictEqual(back, j)
})

test('a 3.8 project exported as 4.0 / 4.1 / 4.2: loads in the 4.0 runtime and poses the same', () => {
  const wild = JSON.parse(fs.readFileSync(path.join(ROOT, 'particle-editor/debug-assets/debug-assets/wild/wild.json'), 'utf8'))
  const a = load(S38, wild)
  for (const target of ['4.0', '4.1', '4.2']) {
    const out = V.fromSpine38(wild, target)
    assert(V.versionOf(out).startsWith(target), V.versionOf(out))
    assert(!JSON.stringify(out).includes('"nf4"') && !out[V.STASH])
    const b = load(S40, out)
    for (const anim of Object.keys(wild.animations)) {
      const dur = a.data.findAnimation(anim).duration
      let worst = 0
      for (let t = 0; t <= dur + 1e-6; t += 1 / 24) {
        pose(S38, a, anim, t + 1e-4); pose(S40, b, anim, t + 1e-4)
        for (let i = 0; i < a.bones.length; i++) { const p = a.bones[i], q = b.bones[i]; worst = Math.max(worst, Math.abs(p.worldX - q.worldX), Math.abs(p.worldY - q.worldY)) }
      }
      assert(worst < 0.5, `${target} ${anim}: ${worst}`)
    }
    // 4.1+ keeps deform keys under attachments; 4.0 under deform
    const anim = Object.values(out.animations).find((x) => x.deform || x.attachments)
    if (anim) assert(target === '4.0' ? !!anim.deform && !anim.attachments : !!anim.attachments && !anim.deform, target + ' deform placement')
  }
})

test('a 3.7 file (array curves) opens as 3.8 and plays the same', () => {
  const wild = JSON.parse(fs.readFileSync(path.join(ROOT, 'particle-editor/debug-assets/debug-assets/wild/wild.json'), 'utf8'))
  // the same rig written the 3.7 way: curve: [c1, c2, c3, c4]
  const old = JSON.parse(JSON.stringify(wild))
  old.skeleton.spine = '3.7.94'
  let n = 0
  const walk = (v) => { if (Array.isArray(v)) { for (const k of v) if (k && typeof k === 'object') { if (typeof k.curve === 'number') { k.curve = [k.curve, k.c2 || 0, k.c3 || 1, k.c4 || 1]; delete k.c2; delete k.c3; delete k.c4; n++ } walk(k) } } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x) }
  walk(old.animations)
  assert(n > 0, 'the fixture has curves')
  const up = V.toSpine38(old)
  assert.strictEqual(V.versionOf(up), '3.8.99')
  assert.deepStrictEqual(up.animations, wild.animations)
})

test('a 3.8 project is left alone', () => {
  const wild = JSON.parse(fs.readFileSync(path.join(ROOT, 'particle-editor/debug-assets/debug-assets/wild/wild.json'), 'utf8'))
  assert(!V.is4(wild))
  assert.deepStrictEqual(V.toSpine38(wild), wild)
  assert.deepStrictEqual(V.fromSpine38(wild), wild)
})

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`)
