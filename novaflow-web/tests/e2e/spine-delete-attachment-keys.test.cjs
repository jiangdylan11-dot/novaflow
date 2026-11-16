// node novaflow-web/tests/e2e/spine-delete-attachment-keys.test.cjs
// 骨骼动画: deleting an attachment takes its attachment keys (and deform keys) out of every animation,
// so playback never lands on a key that points at nothing; the previous image holds until the next key.
// Projects saved before the fix still carry such keys: opening (pruneDeadKeys) and export drop them.
'use strict'
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert')
const ROOT = path.resolve(__dirname, '..', '..', '..')
require(path.join(ROOT, 'novaflow-web/renderer/spine-structure.ops.js'))
const Ops = globalThis.NovaFlowSpineStructureOps
const code = fs.readFileSync(path.join(ROOT, 'novaflow-web/renderer/vendor/spine/spine-webgl-3.8.js'), 'utf8')
const sandbox = { console, Math, Float32Array, Int16Array, Uint16Array, Array, Object, Error, setTimeout }
sandbox.window = sandbox
vm.createContext(sandbox)
vm.runInContext(code + '\n;this.spine = spine', sandbox)
const spine = sandbox.spine
const region = () => ({ u: 0, v: 0, u2: 1, v2: 1, width: 1, height: 1, originalWidth: 1, originalHeight: 1, offsetX: 0, offsetY: 0, rotate: false, degrees: 0, renderObject: null, texture: null })
const loader = {
  newRegionAttachment: (skin, name) => { const a = new spine.RegionAttachment(name); a.region = region(); return a },
  newMeshAttachment: (skin, name) => { const a = new spine.MeshAttachment(name); a.region = region(); return a },
  newBoundingBoxAttachment: (skin, name) => new spine.BoundingBoxAttachment(name),
  newPathAttachment: (skin, name) => new spine.PathAttachment(name),
  newPointAttachment: (skin, name) => new spine.PointAttachment(name),
  newClippingAttachment: (skin, name) => new spine.ClippingAttachment(name),
}

let failed = 0
function test(name, fn) {
  try { fn(); console.log('ok -', name) } catch (e) { failed++; console.log('FAIL -', name); console.log(e && e.stack || e) }
}

const FRAMES = 6
const frame = (i) => `win_${String(i).padStart(4, '0')}`
function rig() {
  const atts = {}
  for (let i = 0; i < FRAMES; i++) atts[frame(i)] = { width: 10, height: 10 }
  atts.mesh = { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], vertices: [0, 0, 10, 0, 10, 10], triangles: [0, 1, 2], hull: 3, width: 10, height: 10 }
  return {
    skeleton: { spine: '3.8.99' },
    bones: [{ name: 'root' }, { name: 'board_1', parent: 'root' }],
    slots: [{ name: 'slot_1', bone: 'board_1', attachment: frame(0) }, { name: 'slot_2', bone: 'board_1', attachment: 'mesh' }],
    skins: [{ name: 'default', attachments: { slot_1: atts, slot_2: { mesh: atts.mesh } } }],
    animations: {
      idle: {
        slots: { slot_1: { attachment: Array.from({ length: FRAMES }, (_, i) => ({ time: i / 30, name: frame(i) })) } },
        deform: { default: { slot_1: { mesh: [{ time: 0, vertices: [1, 1] }] }, slot_2: { mesh: [{ time: 0, vertices: [1, 1] }] } } },
      },
      blink: { slots: { slot_1: { attachment: [{ time: 0, name: frame(2) }, { time: 0.1, name: null }] } } },
    },
  }
}
const keyNames = (json, anim = 'idle', slot = 'slot_1') => ((((json.animations[anim] || {}).slots || {})[slot] || {}).attachment || []).map((k) => k.name)

/** What the slot shows at `time` with the Spine 3.8 runtime. */
function shownAt(json, anim, time, slot = 'slot_1') {
  const copy = JSON.parse(JSON.stringify(Ops.exportable(json)))
  const data = new spine.SkeletonJson(loader).readSkeletonData(copy)
  const sk = new spine.Skeleton(data)
  sk.setToSetupPose()
  data.findAnimation(anim).apply(sk, 0, time, false, null, 1, spine.MixBlend.setup, spine.MixDirection.mixIn)
  const a = sk.findSlot(slot).getAttachment()
  return a ? a.name : null
}

test('deleting one attachment removes its keys in every animation; the previous image holds', () => {
  const j = Ops.deleteAttachment(rig(), 'default', 'slot_1', frame(2)).json
  assert.deepStrictEqual(keyNames(j), [frame(0), frame(1), frame(3), frame(4), frame(5)])
  assert.deepStrictEqual(keyNames(j, 'blink'), [null])
  assert.strictEqual(shownAt(j, 'idle', 2 / 30 + 0.001), frame(1))
  assert.strictEqual(shownAt(j, 'idle', 3 / 30 + 0.001), frame(3))
})

test('deleting several attachments (one batch, like multi-select) leaves no dead keys', () => {
  let j = rig()
  for (const n of [frame(2), frame(5), frame(0)]) j = Ops.deleteAttachment(j, 'default', 'slot_1', n).json
  assert.deepStrictEqual(keyNames(j), [frame(1), frame(3), frame(4)])
  const all = new Set(Object.keys(j.skins[0].attachments.slot_1))
  for (const anim of Object.values(j.animations)) for (const k of (anim.slots && anim.slots.slot_1 && anim.slots.slot_1.attachment) || []) assert.ok(k.name == null || all.has(k.name), k.name)
})

test('deleting every keyed attachment drops the empty timeline', () => {
  let j = rig()
  for (let i = 0; i < FRAMES; i++) j = Ops.deleteAttachment(j, 'default', 'slot_1', frame(i)).json
  assert.ok(!j.animations.idle.slots || !j.animations.idle.slots.slot_1)
})

test('deform keys of a deleted mesh go too, other slots keep theirs', () => {
  const j = Ops.deleteAttachment(rig(), 'default', 'slot_1', 'mesh').json
  assert.ok(!j.animations.idle.deform.default.slot_1)
  assert.ok(j.animations.idle.deform.default.slot_2.mesh)
})

test('deleting a slot removes its keys', () => {
  const j = Ops.deleteSlot(rig(), 'slot_1').json
  assert.ok(!j.animations.idle.slots || !j.animations.idle.slots.slot_1)
})

test('placeholders: clearing one skin keeps the keys, deleting the placeholder removes them', () => {
  let j = rig()
  j.skins.push({ name: 'red', attachments: { slot_1: { [frame(1)]: { width: 10, height: 10 } } } })
  delete j.skins[0].attachments.slot_1[frame(1)]
  j = Ops.clearPlaceholder(j, 'red', 'slot_1', frame(1)).json
  assert.ok(keyNames(j).includes(frame(1)), 'an empty placeholder is still keyable')
  j = Ops.deletePlaceholder(j, 'slot_1', frame(1)).json
  assert.ok(!keyNames(j).includes(frame(1)))
})

test('the same image left in another skin keeps its keys', () => {
  const j0 = rig()
  j0.skins.push({ name: 'red', attachments: { slot_1: { [frame(3)]: { width: 10, height: 10 } } } })
  const j = Ops.deleteAttachment(j0, 'default', 'slot_1', frame(3)).json
  assert.ok(keyNames(j).includes(frame(3)))
})

test('older projects: pruneDeadKeys on open and exportable drop keys to attachments already gone', () => {
  const legacy = rig()
  delete legacy.skins[0].attachments.slot_1[frame(1)]
  delete legacy.skins[0].attachments.slot_1[frame(4)]
  delete legacy.skins[0].attachments.slot_1.mesh
  const out = Ops.exportable(legacy)
  assert.deepStrictEqual(keyNames(out), [frame(0), frame(2), frame(3), frame(5)])
  assert.ok(!out.animations.idle.deform.default.slot_1)
  assert.deepStrictEqual(keyNames(legacy).length, FRAMES, 'exportable works on a copy')
  const opened = Ops.tidy(Ops.prepare(legacy))
  assert.strictEqual(Ops.pruneDeadKeys(opened), 3)
  assert.deepStrictEqual(keyNames(opened), [frame(0), frame(2), frame(3), frame(5)])
  assert.strictEqual(shownAt(opened, 'idle', 1 / 30 + 0.001), frame(0))
  assert.strictEqual(Ops.pruneDeadKeys(Ops.prepare(rig())), 0, 'a clean project is left alone')
})

if (failed) { console.log(`${failed} failed`); process.exit(1) }
console.log('all passed')
