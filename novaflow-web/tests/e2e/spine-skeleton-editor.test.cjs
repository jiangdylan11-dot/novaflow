// node novaflow-web/tests/e2e/spine-skeleton-editor.test.cjs
// The 骨骼动画 editor's project operations (renderer/spine-structure.ops.js) and mesh editing
// (renderer/spine-mesh-edit.js): every op runs on real rigs, the result is loaded with the vendored
// Spine 3.8 runtime (no atlas: a stub loader) and world poses are compared. The 伽夜 rig (the user's
// template, work/skeleton-structure-lab/samples/jiaye, not in git) adds cases when it is there.
'use strict'
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const assert = require('assert')
const ROOT = path.resolve(__dirname, '..', '..', '..')
// the renderer folder is an ES module package: these modules hang themselves on globalThis
require(path.join(ROOT, 'novaflow-web/renderer/spine-structure.ops.js'))
const Ops = globalThis.NovaFlowSpineStructureOps
const code = fs.readFileSync(path.join(ROOT, 'novaflow-web/renderer/vendor/spine/spine-webgl-3.8.js'), 'utf8')
const sandbox = { console, Math, Float32Array, Int16Array, Uint16Array, Array, Object, Error, setTimeout }
sandbox.window = sandbox
vm.createContext(sandbox)
vm.runInContext(code + '\n;this.spine = spine', sandbox)
const spine = sandbox.spine

const loader = {
  newRegionAttachment: (skin, name) => { const a = new spine.RegionAttachment(name); a.region = fakeRegion(); return a },
  newMeshAttachment: (skin, name) => { const a = new spine.MeshAttachment(name); a.region = fakeRegion(); return a },
  newBoundingBoxAttachment: (skin, name) => new spine.BoundingBoxAttachment(name),
  newPathAttachment: (skin, name) => new spine.PathAttachment(name),
  newPointAttachment: (skin, name) => new spine.PointAttachment(name),
  newClippingAttachment: (skin, name) => new spine.ClippingAttachment(name),
}
function fakeRegion() {
  return { u: 0, v: 0, u2: 1, v2: 1, width: 1, height: 1, originalWidth: 1, originalHeight: 1, offsetX: 0, offsetY: 0, rotate: false, degrees: 0, renderObject: null, texture: null }
}

function load(json) {
  const copy = JSON.parse(JSON.stringify(json))
  copy.skeleton = { ...(copy.skeleton || {}), spine: '3.8.99' }
  const data = new spine.SkeletonJson(loader).readSkeletonData(copy)
  const sk = new spine.Skeleton(data)
  sk.setToSetupPose()
  sk.updateWorldTransform()
  return sk
}

function pose(sk, anim, t) {
  sk.setToSetupPose()
  if (anim) sk.data.findAnimation(anim).apply(sk, 0, t, false, null, 1, spine.MixBlend.setup, spine.MixDirection.mixIn)
  sk.updateWorldTransform()
  return sk
}

const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps
function sameWorld(b1, b2, msg) {
  for (const k of ['worldX', 'worldY', 'a', 'b', 'c', 'd']) {
    assert(near(b1[k], b2[k]), `${msg}: ${k} ${b1[k]} vs ${b2[k]}`)
  }
}
const matrixOf = (b) => ({ a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY })

let passed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('ok  ', name) } catch (e) { console.log('FAIL', name, '\n     ', e.message); process.exitCode = 1 }
}

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const wild = read(path.join(ROOT, 'particle-editor/debug-assets/debug-assets/wild/wild.json'))
const jiayePath = path.join(ROOT, 'work/skeleton-structure-lab/samples/jiaye/a.json')
const jiaye = fs.existsSync(jiayePath) ? read(jiayePath) : null

// ------------------------------------------------------------------ wild
const wildAnim = Object.keys(wild.animations || {})[0]
const deepBone = (() => {
  // a bone with children, slots in its branch and keys in the first animation
  const j = Ops.prepare(wild)
  let best = null
  for (const b of j.bones) {
    if (!b.parent) continue
    const br = Ops.branch(j, b.name)
    const slots = j.slots.filter((s) => br.includes(s.bone)).length
    const keyed = br.filter((n) => j.animations[wildAnim]?.bones?.[n]).length
    const score = slots * 10 + keyed + br.length
    if (br.length > 2 && br.length < 15 && slots && keyed && (!best || score > best.score)) best = { name: b.name, score }
  }
  return best.name
})()
console.log('wild: animation', wildAnim, '| branch root', deepBone)

test('original wild loads', () => { load(wild) })

test('duplicateBone with branch + slots + animation: copy moves exactly like the original', () => {
  const r = Ops.duplicateBone(wild, deepBone)
  const sk = load(r.json)
  const j = Ops.prepare(wild)
  const br = Ops.branch(j, deepBone)
  assert.strictEqual(r.bones.length, br.length)
  assert(r.slots.length > 0, 'slots copied')
  for (const t of [0, 0.37, 0.8]) {
    pose(sk, wildAnim, t)
    br.forEach((n, i) => sameWorld(sk.findBone(n), sk.findBone(r.bones[i]), `t=${t} ${n}`))
  }
  // original bone indices unchanged (weighted meshes elsewhere stay bound)
  r.json.bones.slice(0, wild.bones.length).forEach((b, i) => assert.strictEqual(b.name, wild.bones[i].name))
  // copied slots sit right above the original block
  const names = r.json.slots.map((s) => s.name)
  const lastOrig = Math.max(...j.slots.filter((s) => br.includes(s.bone)).map((s) => names.indexOf(s.name)))
  assert.strictEqual(names[lastOrig + 1], r.slots[0])
})

test('duplicateBone without animation leaves the copy at setup pose', () => {
  const r = Ops.duplicateBone(wild, deepBone, { animation: false })
  const anim = r.json.animations[wildAnim]
  for (const b of r.bones) assert(!anim.bones || !anim.bones[b], 'no keys for ' + b)
  load(r.json)
})

test('duplicateBone single bone (no children) keeps children only on original', () => {
  const r = Ops.duplicateBone(wild, deepBone, { children: false, slots: false })
  assert.strictEqual(r.bones.length, 1)
  assert.strictEqual(r.json.bones.filter((b) => b.parent === r.bone).length, 0)
  load(r.json)
})

test('duplicateSlot copies attachments + keys and draws directly above', () => {
  const j = Ops.prepare(wild)
  const keyedSlot = Object.keys(j.animations[wildAnim]?.slots || {})[0] || j.slots[0].name
  const r = Ops.duplicateSlot(wild, keyedSlot)
  const names = r.json.slots.map((s) => s.name)
  assert.strictEqual(names.indexOf(r.slot), names.indexOf(keyedSlot) + 1)
  const def = r.json.skins.find((s) => s.name === 'default')
  assert.deepStrictEqual(def.attachments[r.slot], def.attachments[keyedSlot])
  const sk = load(r.json)
  pose(sk, wildAnim, 0.5)
  const a = sk.findSlot(keyedSlot), b = sk.findSlot(r.slot)
  assert.strictEqual(a.getAttachment()?.name, b.getAttachment()?.name)
})

test('rename bone / slot keeps everything loadable and keyed', () => {
  let r = Ops.renameBone(wild, deepBone, '改名骨骼')
  const sk = load(r.json)
  assert(sk.findBone('改名骨骼'))
  const slot = wild.slots[0].name
  r = Ops.renameSlot(r.json, slot, '改名插槽')
  load(r.json)
})

test('deleteBone remaps weighted meshes and refuses when weights would dangle', () => {
  const j = Ops.prepare(wild)
  // find a leaf bone with no weights on it
  const used = new Set()
  for (const s of j.skins) for (const slot of Object.keys(s.attachments)) for (const a of Object.values(s.attachments[slot])) for (const b of Ops.weightBones(a)) used.add(b)
  const victim = j.bones.find((b, i) => b.parent && !used.has(i) && !Ops.children(j, b.name).length && i < j.bones.length - 3)
  if (victim) {
    const before = load(wild)
    const r = Ops.deleteBone(wild, victim.name)
    const after = load(r.json)
    // every surviving mesh vertex should still sit where it did
    for (const slot of after.slots) {
      const att = slot.getAttachment()
      if (!att || !att.computeWorldVertices || !(att instanceof spine.MeshAttachment)) continue
      const os = before.findSlot(slot.data.name)
      const oa = os && os.getAttachment()
      if (!oa) continue
      const n = att.worldVerticesLength
      const v1 = new Float32Array(n), v2 = new Float32Array(n)
      oa.computeWorldVertices(os, 0, n, v1, 0, 2)
      att.computeWorldVertices(slot, 0, n, v2, 0, 2)
      for (let i = 0; i < n; i++) assert(near(v1[i], v2[i], 0.05), `${slot.data.name} vertex ${i}`)
    }
  }
  const usedBone = j.bones[[...used].find((i) => i > 0)]
  if (usedBone) assert.throws(() => Ops.deleteBone(wild, usedBone.name), /权重/)
})

test('slot props: color, blend, setup attachment, re-hang keeps world placement', () => {
  const base = load(wild)
  const j = Ops.prepare(wild)
  const slot = j.slots.find((s) => {
    const att = j.skins[0].attachments[s.name]?.[s.attachment]
    return att && (att.type || 'region') === 'region'
  })
  const other = j.bones.find((b) => b.name !== slot.bone && b.parent)
  const mats = { [slot.bone]: matrixOf(base.findBone(slot.bone)), [other.name]: matrixOf(base.findBone(other.name)) }
  const r = Ops.setSlotProps(wild, slot.name, { color: 'ff000080', blend: 'additive', bone: other.name }, mats)
  const sk = load(r.json)
  const s1 = base.findSlot(slot.name), s2 = sk.findSlot(slot.name)
  const v1 = new Float32Array(8), v2 = new Float32Array(8)
  s1.getAttachment().computeWorldVertices(s1.bone, v1, 0, 2)
  s2.getAttachment().computeWorldVertices(s2.bone, v2, 0, 2)
  for (let i = 0; i < 8; i++) assert(near(v1[i], v2[i], 0.1), `corner ${i}: ${v1[i]} vs ${v2[i]}`)
  assert(near(s2.color.a, 128 / 255, 0.01))
  assert.strictEqual(sk.data.findSlot(slot.name).blendMode, spine.BlendMode.Additive)
  const r2 = Ops.setSlotProps(wild, slot.name, { attachment: null })
  assert.strictEqual(load(r2.json).findSlot(slot.name).getAttachment(), null)
})

test('moveSlot reorders draw order', () => {
  const name = wild.slots[0].name
  const r = Ops.moveSlot(wild, name, 3)
  assert.strictEqual(r.json.slots[3].name, name)
  load(r.json)
})

test('attachment keys: switch + hide, color key, remove', () => {
  const j = Ops.prepare(wild)
  const slot = j.slots.find((s) => s.attachment && !Object.values(j.animations).some((a) => a.slots?.[s.name]?.attachment))
  let r = Ops.addRegionAttachment(wild, 'default', slot.name, { name: 'extra', path: slot.attachment, width: 10, height: 10, show: false })
  r = Ops.keyAttachment(r.json, wildAnim, slot.name, 0.2, 'extra')
  r = Ops.keyAttachment(r.json, wildAnim, slot.name, 0.4, null)
  r = Ops.keyColor(r.json, wildAnim, slot.name, 0.2, '00ff00ff')
  const sk = load(r.json)
  pose(sk, wildAnim, 0.3)
  assert.strictEqual(sk.findSlot(slot.name).getAttachment().name, 'extra')
  pose(sk, wildAnim, 0.5)
  assert.strictEqual(sk.findSlot(slot.name).getAttachment(), null)
  r = Ops.removeKeyAt(r.json, wildAnim, ['slots', slot.name, 'attachment'], 0.4)
  assert.strictEqual(Ops.slotKeys(r.json, wildAnim, slot.name).attachment.filter((k) => k.time === 0.4).length, 0)
  load(r.json)
})

test('rename attachment keeps image via path, keys follow', () => {
  const j = Ops.prepare(wild)
  const slot = j.slots.find((s) => s.attachment)
  let r = Ops.keyAttachment(wild, wildAnim, slot.name, 0.1, slot.attachment)
  r = Ops.renameAttachment(r.json, slot.name, slot.attachment, '新名字')
  const att = r.json.skins.find((s) => s.name === 'default').attachments[slot.name]['新名字']
  assert(att && (att.path || '').length)
  assert.strictEqual(r.json.slots.find((s) => s.name === slot.name).attachment, '新名字')
  assert(Ops.slotKeys(r.json, wildAnim, slot.name).attachment.some((k) => k.name === '新名字'))
  load(r.json)
})

test('transfer attachment to a slot on another bone stays in place', () => {
  const base = load(wild)
  const j = Ops.prepare(wild)
  const regionSlot = (pred) => j.slots.find((s) => {
    const att = j.skins[0].attachments[s.name]?.[s.attachment]
    return att && (att.type || 'region') === 'region' && pred(s)
  })
  const from = regionSlot(() => true)
  const to = j.slots.find((s) => s.bone !== from.bone)
  const mats = {}
  for (const b of base.bones) mats[b.data.name] = matrixOf(b)
  const r = Ops.transferAttachment(wild, 'default', from.name, from.attachment, to.name, { move: true }, mats)
  const sk = load(r.json)
  const s1 = base.findSlot(from.name), s2 = sk.findSlot(to.name)
  assert.strictEqual(s2.getAttachment().name, r.attachment)
  const v1 = new Float32Array(8), v2 = new Float32Array(8)
  s1.getAttachment().computeWorldVertices(s1.bone, v1, 0, 2)
  s2.getAttachment().computeWorldVertices(s2.bone, v2, 0, 2)
  for (let i = 0; i < 8; i++) assert(near(v1[i], v2[i], 0.1), `corner ${i}`)
  assert.strictEqual(sk.findSlot(from.name).getAttachment(), null)
})

test('skins: create empty / copy, per-skin attachment, rename, delete, switching works', () => {
  const j = Ops.prepare(wild)
  const slot = j.slots.find((s) => s.attachment && (j.skins[0].attachments[s.name]?.[s.attachment]?.type || 'region') === 'region')
  let r = Ops.createSkin(wild, '红色')
  r = Ops.createSkin(r.json, '蓝色', { copyFrom: 'default' })
  r = Ops.copyAttachmentToSkin(r.json, 'default', slot.name, slot.attachment, '红色')
  r = Ops.setAttachmentProps(r.json, '红色', slot.name, slot.attachment, { x: 50 })
  let sk = load(r.json)
  sk.setSkinByName('红色'); sk.setSlotsToSetupPose(); sk.updateWorldTransform()
  assert(near(sk.findSlot(slot.name).getAttachment().x, 50))
  r = Ops.renameSkin(r.json, '红色', '赤')
  r = Ops.deleteSkin(r.json, '蓝色')
  sk = load(r.json)
  assert(sk.data.findSkin('赤') && !sk.data.findSkin('蓝色'))
  assert.throws(() => Ops.deleteSkin(r.json, 'default'))
})

test('skin membership: bone only active with its skin', () => {
  const r0 = Ops.addBone(wild, { name: '皮肤骨', parent: wild.bones[0].name })
  let r = Ops.createSkin(r0.json, 'S')
  r = Ops.setSkinMembership(r.json, 'S', 'bones', '皮肤骨', true)
  const sk = load(r.json)
  assert.strictEqual(sk.findBone('皮肤骨').active, false)
  sk.setSkinByName('S'); sk.updateCache()
  assert.strictEqual(sk.findBone('皮肤骨').active, true)
})

// a two-bone chain for IK: parent with a child that has length
function chain(json) {
  const j = Ops.prepare(json)
  for (const b of j.bones) {
    if (!b.parent || !b.length) continue
    const kid = j.bones.find((c) => c.parent === b.name && c.length)
    if (kid) return [b.name, kid.name]
  }
  return null
}

test('createIk with new target at the tip keeps the chain in setup pose', () => {
  const pair = chain(wild)
  assert(pair, 'need a chain')
  const base = load(wild)
  const end = base.findBone(pair[1])
  const tip = [end.worldX + end.data.length * end.a, end.worldY + end.data.length * end.c]
  const rootB = base.findBone(wild.bones[0].name)
  const local = Ops.toLocal(matrixOf(rootB), tip[0], tip[1])
  const r = Ops.createIk(wild, { bones: pair, targetAt: { x: local[0], y: local[1] } })
  assert(r.createdTarget)
  const sk = load(r.json)
  pose(sk, null)
  const e2 = sk.findBone(pair[1])
  const tip2 = [e2.worldX + e2.data.length * e2.a, e2.worldY + e2.data.length * e2.c]
  assert(near(tip[0], tip2[0], 0.5) && near(tip[1], tip2[1], 0.5), `tip ${tip} vs ${tip2}`)
  // moving the target pulls the end bone's tip toward it
  const tb = sk.findBone(r.target)
  tb.x += 15
  sk.updateWorldTransform()
  const tip3 = [e2.worldX + e2.data.length * e2.a, e2.worldY + e2.data.length * e2.c]
  assert(Math.hypot(tip3[0] - tip[0], tip3[1] - tip[1]) > 3, 'IK followed the target')
})

test('createIk rejects cycles and wrong chains', () => {
  const pair = chain(wild)
  assert.throws(() => Ops.createIk(wild, { bones: [pair[1], pair[0]], target: wild.bones[0].name }), /子骨骼/)
  assert.throws(() => Ops.createIk(wild, { bones: [pair[0]], target: pair[1] }), /循环/)
})

test('createTransform: full rotate mix copies the target rotation; mixes edit + key', () => {
  const j = Ops.prepare(wild)
  const pair = chain(wild)
  const target = j.bones.find((b) => b.parent && !Ops.branch(j, pair[0]).includes(b.name) && !Ops.branch(j, b.name).includes(pair[0]))
  let r = Ops.createTransform(wild, { bones: [pair[0]], target: target.name, translateMix: 0, scaleMix: 0, shearMix: 0 })
  let sk = load(r.json)
  pose(sk, null)
  const ang = (b) => Math.atan2(b.c, b.a) * 180 / Math.PI
  assert(near(ang(sk.findBone(pair[0])), ang(sk.findBone(target.name)), 0.05), 'rotation follows')
  r = Ops.setConstraintProps(r.json, 'transform', r.constraint, { rotateMix: 0.5, rotation: 30 })
  r = Ops.keyConstraint(r.json, wildAnim, 'transform', r.json.transform.slice(-1)[0].name, 0.2, { rotateMix: 0 })
  sk = load(r.json)
  pose(sk, wildAnim, 0.2)
  r = Ops.deleteConstraint(r.json, 'transform', r.json.transform.slice(-1)[0].name)
  assert(!(r.json.animations[wildAnim].transform || {})[r.constraint])
  load(r.json)
})

test('constraint order + rename + IK key', () => {
  const pair = chain(wild)
  let r = Ops.createIk(wild, { bones: [pair[1]], target: Ops.prepare(wild).bones.find((b) => b.parent && !Ops.branch(Ops.prepare(wild), pair[1]).includes(b.name) && b.name !== pair[0] && !Ops.branch(Ops.prepare(wild), b.name).includes(pair[1])).name, name: 'ik1' })
  r = Ops.keyConstraint(r.json, wildAnim, 'ik', 'ik1', 0.3, { mix: 0.25 })
  r = Ops.renameConstraint(r.json, 'ik', 'ik1', '手IK')
  r = Ops.setConstraintProps(r.json, 'ik', '手IK', { order: 0, bendPositive: false })
  assert.strictEqual(r.json.ik.find((c) => c.name === '手IK').order, 0)
  assert(r.json.animations[wildAnim].ik['手IK'])
  load(r.json)
})

test('duplicateBone copies a constraint that lives inside the branch', () => {
  const pair = chain(wild)
  const j = Ops.prepare(wild)
  const parent = j.bones.find((b) => b.name === pair[0]).parent
  // target inside the branch: a new child of the chain parent's branch root
  let r = Ops.addBone(wild, { name: 'tgt', parent: pair[0], x: 20 })
  r = Ops.createIk(r.json, { bones: [pair[1]], target: 'tgt', name: 'inner' })
  r = Ops.duplicateBone(r.json, pair[0])
  const copy = r.json.ik.find((c) => c.name === 'inner2')
  assert(copy, 'constraint copied')
  assert.strictEqual(copy.target, 'tgt2')
  assert(parent !== undefined)
  load(r.json)
})

test('reparentBone keeps world pose, moves branch after a later parent, meshes stay put', () => {
  const base = load(wild)
  const j = Ops.prepare(wild)
  const mats = {}
  for (const b of base.bones) mats[b.data.name] = matrixOf(b)
  // move an early bone (with weighted children somewhere) under the LAST bone
  const last = j.bones[j.bones.length - 1].name
  const victim = j.bones.find((b) => b.parent && b.parent !== j.bones[0].name && !Ops.branch(j, b.name).includes(last))
  const r = Ops.reparentBone(wild, victim.name, last, mats)
  const sk = load(r.json)
  for (const n of Ops.branch(j, victim.name)) sameWorld(base.findBone(n), sk.findBone(n), 'branch ' + n)
  for (const slot of sk.slots) {
    const att = slot.getAttachment()
    if (!(att instanceof spine.MeshAttachment)) continue
    const os = base.findSlot(slot.data.name)
    const n = att.worldVerticesLength
    const v1 = new Float32Array(n), v2 = new Float32Array(n)
    os.getAttachment().computeWorldVertices(os, 0, n, v1, 0, 2)
    att.computeWorldVertices(slot, 0, n, v2, 0, 2)
    for (let i = 0; i < n; i++) assert(near(v1[i], v2[i], 0.05), `${slot.data.name} v${i}`)
  }
  assert.throws(() => Ops.reparentBone(wild, j.bones[1].name, Ops.branch(j, j.bones[1].name).slice(-1)[0], mats))
})

test('addSlot then add image attachment', () => {
  let r = Ops.addSlot(wild, wild.bones[1].name)
  const j = Ops.prepare(wild)
  const anyAtt = j.slots.find((s) => s.attachment && (j.skins[0].attachments[s.name][s.attachment].type || 'region') === 'region')
  const region = j.skins[0].attachments[anyAtt.name][anyAtt.attachment]
  r = Ops.addRegionAttachment(r.json, 'default', r.slot, { name: anyAtt.attachment, path: region.path || anyAtt.attachment, width: region.width, height: region.height })
  const sk = load(r.json)
  assert(sk.findSlot(r.json.slots.slice(-1)[0].name).getAttachment())
})

test('transformOffsets: a new world transform constraint does not move the bone', () => {
  const base = load(wild)
  const j = Ops.prepare(wild)
  const pair = chain(wild)
  const target = j.bones.find((b) => b.parent && !Ops.branch(j, pair[0]).includes(b.name) && !Ops.branch(j, b.name).includes(pair[0]) && b.rotation)
  const off = Ops.transformOffsets(matrixOf(base.findBone(pair[0])), matrixOf(base.findBone(target.name)))
  const r = Ops.createTransform(wild, { bones: [pair[0]], target: target.name, ...off })
  const sk = load(r.json)
  pose(sk, null)
  sameWorld(base.findBone(pair[0]), sk.findBone(pair[0]), 'kept')
  // and it now follows the target
  sk.findBone(target.name).rotation += 30
  sk.updateWorldTransform()
  const ang = (b) => Math.atan2(b.c, b.a) * 180 / Math.PI
  assert(Math.abs(ang(sk.findBone(pair[0])) - ang(base.findBone(pair[0]))) > 10)
})

test('mesh copied into a skin is a linked mesh that keeps the deform keys', () => {
  const j = Ops.prepare(wild)
  // give a visible mesh a deform key: every deform value +6
  const slotM = j.slots.find((s) => s.attachment && j.skins[0].attachments[s.name][s.attachment].type === 'mesh')
  const mesh = j.skins[0].attachments[slotM.name][slotM.attachment]
  let len = 0
  if (Ops.isWeighted(mesh)) { let i = 0; while (i < mesh.vertices.length) { const n = mesh.vertices[i]; len += n * 2; i += 1 + n * 4 } } else len = mesh.vertices.length
  const an = Object.keys(j.animations)[0]
  j.animations[an].deform = { default: { [slotM.name]: { [slotM.attachment]: [{ time: 0 }, { time: 0.3, vertices: new Array(len).fill(6) }] } } }
  const found = { an, slot: slotM.name, name: slotM.attachment }
  let r = Ops.createSkin(j, 'S')
  r = Ops.copyAttachmentToSkin(r.json, 'default', found.slot, found.name, 'S')
  assert.strictEqual(r.json.skins.find((s) => s.name === 'S').attachments[found.slot][found.name].type, 'linkedmesh')
  const a = load(r.json), b = load(r.json)
  b.setSkinByName('S'); b.setSlotsToSetupPose()
  const dur = a.data.findAnimation(found.an).duration
  for (const t of [dur * 0.3, dur * 0.7]) {
    pose(a, found.an, t); pose(b, found.an, t)
    const sa = a.findSlot(found.slot), sb = b.findSlot(found.slot)
    assert(sb.getAttachment() !== sa.getAttachment(), 'skin S draws its own attachment')
    const n = sa.getAttachment().worldVerticesLength
    const v1 = new Float32Array(n), v2 = new Float32Array(n)
    sa.getAttachment().computeWorldVertices(sa, 0, n, v1, 0, 2)
    sb.getAttachment().computeWorldVertices(sb, 0, n, v2, 0, 2)
    for (let i = 0; i < n; i++) assert(near(v1[i], v2[i], 0.01), 'deformed vertex ' + i)
    const rest = load(wild); pose(rest, found.an, t)
    const sr = rest.findSlot(found.slot), v0 = new Float32Array(n)
    sr.getAttachment().computeWorldVertices(sr, 0, n, v0, 0, 2)
    assert(Math.abs(v0[0] - v1[0]) + Math.abs(v0[1] - v1[1]) > 0.5, 'the deform key really moves the mesh')
  }
  assert.throws(() => Ops.deleteAttachment(r.json, 'default', found.slot, found.name), /链接/)
  r = Ops.setAttachmentProps(r.json, 'S', found.slot, found.name, { path: 'wild_hair' })
  load(r.json)
})

test('autoOrderConstraints: a transform that carries an IK target is moved before the IK', () => {
  const base = load(wild)
  const pair = chain(wild)
  const end = base.findBone(pair[1])
  const tip = [end.worldX + end.data.length * end.a, end.worldY + end.data.length * end.c]
  const rootM = matrixOf(base.findBone(wild.bones[0].name))
  const local = Ops.toLocal(rootM, tip[0], tip[1])
  let r = Ops.createIk(wild, { bones: pair, targetAt: { x: local[0], y: local[1] } })
  const ikName = r.constraint, target = r.target
  // a driver bone near the tip; the target follows it with a 25 px offset
  r = Ops.addBone(r.json, { name: 'driver', parent: wild.bones[0].name, x: local[0] - 25, y: local[1] - 10 })
  r = Ops.createTransform(r.json, { bones: [target], target: 'driver', rotateMix: 0, scaleMix: 0, shearMix: 0, x: 25, y: 10 })
  const trName = r.constraint
  // wrong: the transform was appended after the IK
  const wrong = r.json
  assert(wrong.ik.find((c) => c.name === ikName).order < wrong.transform.find((c) => c.name === trName).order)
  const fixed = Ops.autoOrderConstraints(wrong)
  assert(fixed.changed > 0)
  assert(fixed.json.transform.find((c) => c.name === trName).order < fixed.json.ik.find((c) => c.name === ikName).order)
  // move the driver: with the fixed order the chain tip lands on the moved target
  // pull the driver 20 px toward the shoulder so the target stays in reach
  const b0 = base.findBone(pair[0])
  const d = Math.hypot(b0.worldX - tip[0], b0.worldY - tip[1])
  const goal = Ops.toLocal(rootM, tip[0] + (b0.worldX - tip[0]) / d * 20, tip[1] + (b0.worldY - tip[1]) / d * 20)
  const moveDriver = (j) => Ops.setBoneProps(j, 'driver', { x: goal[0] - 25, y: goal[1] - 10 }).json
  const tipGap = (j) => {
    const sk = load(j); pose(sk, null)
    const e = sk.findBone(pair[1]), t = sk.findBone(target)
    return Math.hypot(e.worldX + e.data.length * e.a - t.worldX, e.worldY + e.data.length * e.c - t.worldY)
  }
  const gapWrong = tipGap(moveDriver(wrong)), gapFixed = tipGap(moveDriver(fixed.json))
  assert(gapFixed < 0.5 && gapWrong > 5, `gap wrong ${gapWrong.toFixed(2)} fixed ${gapFixed.toFixed(2)}`)
  // running it again changes nothing
  assert.strictEqual(Ops.autoOrderConstraints(fixed.json).changed, 0)
})

test('skin placeholders: convert a mesh, each skin its own image, switching skins swaps it, deform keys follow', () => {
  const slot = 'wild_head2', key = 'wild_head'
  const j0 = Ops.prepare(wild)
  // a deform key on the head so we can see it follow every skin
  const mesh = j0.skins[0].attachments[slot][key]
  let len = 0
  if (Ops.isWeighted(mesh)) { let i = 0; while (i < mesh.vertices.length) { const n = mesh.vertices[i]; len += n * 2; i += 1 + n * 4 } } else len = mesh.vertices.length
  const an = Object.keys(j0.animations)[0]
  j0.animations[an].deform = { default: { [slot]: { [key]: [{ time: 0 }, { time: 0.3, vertices: new Array(len).fill(6) }] } } }
  let r = Ops.createSkin(j0, '红')
  r = Ops.createSkin(r.json, '蓝')
  assert.throws(() => Ops.convertToPlaceholder(wild, slot, key), /先新建皮肤/)
  r = Ops.convertToPlaceholder(r.json, slot, key)
  assert.strictEqual(r.owner, '红')
  assert(Ops.isPlaceholder(r.json, slot, key))
  r = Ops.fillPlaceholder(r.json, '蓝', slot, key, { path: 'wild_hair', width: 50, height: 60 })
  const list = Ops.placeholderList(r.json, slot)
  assert.deepStrictEqual(list.map((p) => p.name), [key])
  assert.deepStrictEqual(Object.keys(list[0].skins).sort(), ['红', '蓝'].sort())
  assert.strictEqual(list[0].skins['蓝'].type, 'linkedmesh')
  const sk = load(r.json)
  const show = (skin) => { sk.setSkin(null); if (skin) sk.setSkinByName(skin); sk.setSlotsToSetupPose(); sk.updateWorldTransform(); return sk.findSlot(slot).getAttachment() }
  assert.strictEqual(show(null), null, 'no skin: the placeholder is empty')
  assert.strictEqual(show('红').path, 'wild_head')
  assert.strictEqual(show('蓝').path, 'wild_hair')
  // the deform key moves both skins' head the same way
  for (const skin of ['红', '蓝']) {
    show(skin)
    pose(sk, an, 0.3)
    const s = sk.findSlot(slot), a = s.getAttachment()
    const n = a.worldVerticesLength, v = new Float32Array(n)
    a.computeWorldVertices(s, 0, n, v, 0, 2)
    const ref = load(j0); pose(ref, an, 0.3)
    const rs = ref.findSlot(slot), rv = new Float32Array(n)
    rs.getAttachment().computeWorldVertices(rs, 0, n, rv, 0, 2)
    for (let i = 0; i < n; i++) assert(near(v[i], rv[i], 0.01), `${skin} vertex ${i}`)
  }
})

test('skin placeholders: empty placeholder, fill one skin, clear keeps it, rename, delete, export strips the lab key', () => {
  const slot = wild.slots.find((s) => s.attachment).name
  let r = Ops.createSkin(wild, 'A')
  r = Ops.createSkin(r.json, 'B')
  r = Ops.addPlaceholder(r.json, slot, '帽子')
  assert(Ops.isPlaceholder(r.json, slot, '帽子'))
  load(Ops.exportable(r.json))
  assert(!Ops.exportable(r.json).nfPlaceholders)
  r = Ops.setSlotProps(r.json, slot, { attachment: '帽子' })
  r = Ops.fillPlaceholder(r.json, 'A', slot, '帽子', { path: 'wild_hair', width: 40, height: 30, x: 5 })
  assert(!r.json.nfPlaceholders, 'filled placeholders leave the lab list')
  let sk = load(r.json)
  sk.setSkinByName('A'); sk.setSlotsToSetupPose()
  assert.strictEqual(sk.findSlot(slot).getAttachment().path, 'wild_hair')
  sk.setSkin(null); sk.setSkinByName('B'); sk.setSlotsToSetupPose()
  assert.strictEqual(sk.findSlot(slot).getAttachment(), null, 'B has nothing there yet')
  // B gets the same placement as A, its own image
  r = Ops.fillPlaceholder(r.json, 'B', slot, '帽子', { path: 'wild_head', width: 70, height: 70 })
  assert.strictEqual(r.json.skins.find((s) => s.name === 'B').attachments[slot]['帽子'].x, 5)
  r = Ops.clearPlaceholder(r.json, 'A', slot, '帽子')
  r = Ops.clearPlaceholder(r.json, 'B', slot, '帽子')
  assert(Ops.isPlaceholder(r.json, slot, '帽子'), 'cleared everywhere, still a placeholder')
  assert.strictEqual(r.json.slots.find((s) => s.name === slot).attachment, '帽子')
  r = Ops.fillPlaceholder(r.json, 'A', slot, '帽子', { path: 'wild_hair', width: 40, height: 30 })
  r = Ops.keyAttachment(r.json, Object.keys(wild.animations)[0], slot, 0.2, '帽子')
  r = Ops.renameAttachment(r.json, slot, '帽子', '头饰')
  assert(r.json.skins.find((s) => s.name === 'A').attachments[slot]['头饰'])
  assert.strictEqual(r.json.slots.find((s) => s.name === slot).attachment, '头饰')
  assert(Ops.slotKeys(r.json, Object.keys(wild.animations)[0], slot).attachment.some((k) => k.name === '头饰'))
  r = Ops.deletePlaceholder(r.json, slot, '头饰')
  assert(!Ops.isPlaceholder(r.json, slot, '头饰'))
  load(r.json)
})

test('skin placeholders survive slot copy / rename / bone copy', () => {
  const j = Ops.prepare(wild)
  const slot = j.slots.find((s) => s.attachment)
  let r = Ops.addPlaceholder(wild, slot.name, 'P')
  r = Ops.duplicateSlot(r.json, slot.name)
  assert(Ops.isPlaceholder(r.json, r.slot, 'P'))
  r = Ops.renameSlot(r.json, r.slot, '新插槽')
  assert(Ops.isPlaceholder(r.json, '新插槽', 'P'))
  r = Ops.duplicateBone(r.json, slot.bone)
  assert(r.slots.some((s) => Ops.isPlaceholder(r.json, s, 'P')))
  load(Ops.exportable(r.json))
})

test('keyBone: the posed local values come back exactly at that frame', () => {
  const an = Object.keys(wild.animations)[0]
  const j = Ops.prepare(wild)
  const b = j.bones.find((x) => x.parent && x.scaleX === undefined && x.length)
  const want = { rotation: (b.rotation || 0) + 33.5, x: (b.x || 0) + 7, y: (b.y || 0) - 4, scaleX: 1.4, scaleY: 0.8, shearX: 0, shearY: 12 }
  let r = Ops.keyBone(wild, an, b.name, 0.3, want)
  const keys = Ops.boneKeys(r.json, an, b.name)
  for (const k of ['rotate', 'translate', 'scale', 'shear']) assert(keys[k].some((t) => Math.abs(t - 0.3) < 1e-4), k)
  const sk = load(r.json)
  pose(sk, an, 0.3 + 1e-4) // keys are float32 in the runtime: 0.3 → 0.30000001
  const bb = sk.findBone(b.name)
  for (const [k, v] of Object.entries(want)) assert(near(bb[k], v, 0.01), `${k} ${bb[k]} vs ${v}`)
  // re-key the same frame replaces it, remove works
  r = Ops.keyBone(r.json, an, b.name, 0.3, { rotation: want.rotation + 10 })
  assert.strictEqual(r.json.animations[an].bones[b.name].rotate.filter((k) => Math.abs((k.time || 0) - 0.3) < 1e-4).length, 1)
  r = Ops.removeKeyAt(r.json, an, ['bones', b.name, 'rotate'], 0.3)
  load(r.json)
})

test('keepWorld: after a parent moves, its children are put back where they were (Spine bone compensation)', () => {
  const base = load(wild)
  const j = Ops.prepare(wild)
  const p = j.bones.find((b) => b.parent && Ops.children(j, b.name).length >= 1 && (b.transform || 'normal') === 'normal' && !Ops.children(j, b.name).some((c) => (j.bones.find((x) => x.name === c).transform || 'normal') !== 'normal'))
  const kids = Ops.children(j, p.name)
  const worlds = {}
  for (const k of kids) worlds[k] = matrixOf(base.findBone(k))
  const moved = Ops.setBoneProps(wild, p.name, { rotation: (p.rotation || 0) + 25, x: (p.x || 0) + 10, scaleX: 1.3 })
  // the parent's new world matrix, from its own parent's world
  const pp = matrixOf(base.findBone(p.parent))
  const newP = Ops.worldFromLocal(pp, moved.json.bones.find((b) => b.name === p.name))
  const sk1 = load(moved.json); pose(sk1, null)
  sameWorld(sk1.findBone(p.name), newP, 'worldFromLocal matches the runtime')
  const parents = {}
  for (const k of kids) parents[k] = newP
  const r = Ops.keepWorld(moved.json, worlds, parents)
  const sk = load(r.json); pose(sk, null)
  for (const k of kids) sameWorld(sk.findBone(k), base.findBone(k), 'child ' + k)
})

test('animations: create / rename (order kept) / duplicate / delete', () => {
  let r = Ops.createAnimation(wild)
  const n = r.animation
  r = Ops.renameAnimation(r.json, Object.keys(wild.animations)[0], '第一个')
  assert.strictEqual(Object.keys(r.json.animations)[0], '第一个')
  r = Ops.duplicateAnimation(r.json, '第一个')
  assert(r.json.animations[r.animation])
  r = Ops.deleteAnimation(r.json, n)
  assert(!r.json.animations[n])
  load(r.json)
})

test('dopesheet: move / delete / copy-paste keys, curves; the runtime agrees', () => {
  const an = Object.keys(wild.animations)[0]
  const tracks = Ops.keyTracks(wild, an)
  const tr = tracks.find((x) => x.path[0] === 'bones' && x.path[2] === 'rotate' && x.times.length >= 3)
  assert(tr, 'a rotate track with 3+ keys')
  const [bone] = [tr.path[1]]
  const base = load(wild)
  const angleAt = (sk, t) => { pose(sk, an, t + 1e-4); return sk.findBone(bone).rotation }
  // move the second key 2 frames later: the old pose at t shows up at t + 2/30
  const t1 = tr.times[1], dt = 2 / 30
  let r = Ops.moveKeys(wild, an, [{ path: tr.path, time: t1 }], dt)
  assert(r.keys.length === 1 && Math.abs(r.keys[0].time - (t1 + dt)) < 1e-3)
  const moved = load(r.json)
  assert(near(angleAt(moved, t1 + dt), angleAt(base, t1), 0.05), 'key value moved with it')
  // moving onto the next key replaces it
  const t2 = tr.times[2]
  r = Ops.moveKeys(wild, an, [{ path: tr.path, time: t1 }], t2 - t1)
  assert.strictEqual(Ops.keyTracks(r.json, an).find((x) => JSON.stringify(x.path) === JSON.stringify(tr.path)).times.length, tr.times.length - 1)
  // delete
  r = Ops.deleteKeys(wild, an, [{ path: tr.path, time: t1 }])
  assert.strictEqual(r.deleted, 1)
  load(r.json)
  // copy two keys and paste them 10 frames later
  const clip = Ops.copyKeys(wild, an, [{ path: tr.path, time: tr.times[0] }, { path: tr.path, time: tr.times[1] }])
  assert.strictEqual(clip.length, 2)
  r = Ops.pasteKeys(wild, an, clip, 1.0)
  const after = Ops.keyTracks(r.json, an).find((x) => JSON.stringify(x.path) === JSON.stringify(tr.path)).times
  assert(after.some((t) => Math.abs(t - 1.0) < 1e-3) && after.some((t) => Math.abs(t - (1.0 + tr.times[1] - tr.times[0])) < 1e-3))
  const pasted = load(r.json)
  assert(near(angleAt(pasted, 1.0), angleAt(base, tr.times[0]), 0.05))
  // stepped: halfway to the next key the value still is the key's own
  r = Ops.setKeyCurve(wild, an, [{ path: tr.path, time: tr.times[0] }], 'stepped')
  assert.strictEqual(Ops.keyCurve(r.json, an, { path: tr.path, time: tr.times[0] }), 'stepped')
  const st = load(r.json)
  assert(near(angleAt(st, (tr.times[0] + tr.times[1]) / 2), angleAt(st, tr.times[0]), 0.01))
  r = Ops.setKeyCurve(r.json, an, [{ path: tr.path, time: tr.times[0] }], 'ease')
  assert.strictEqual(Ops.keyCurve(r.json, an, { path: tr.path, time: tr.times[0] }), 'ease')
  load(r.json)
  // deleting a track's last key removes the track
  const all = Ops.keyTracks(wild, an).filter((x) => x.path[0] === 'slots')
  if (all.length) {
    const s0 = all[0]
    r = Ops.deleteKeys(wild, an, s0.times.map((time) => ({ path: s0.path, time })))
    assert(!Ops.keyTracks(r.json, an).some((x) => JSON.stringify(x.path) === JSON.stringify(s0.path)))
    load(r.json)
  }
})

test('curve editor: a custom bezier changes how the value moves between two keys', () => {
  const an = Object.keys(wild.animations)[0]
  const tr = Ops.keyTracks(wild, an).find((x) => x.path[0] === 'bones' && x.path[2] === 'rotate' && x.times.length >= 2)
  const key = { path: tr.path, time: tr.times[0] }
  const t1 = Ops.nextKeyTime(wild, an, key)
  assert(Math.abs(t1 - tr.times[1]) < 1e-4)
  const angleAt = (json, t) => { const sk = load(json); pose(sk, an, t + 1e-4); return sk.findBone(tr.path[1]).rotation }
  // slow start: at half time the value has done far less than half of its change
  let r = Ops.setKeyBezier(wild, an, [key], [0.9, 0, 1, 0.1])
  assert.deepStrictEqual(Ops.keyBezier(r.json, an, key), { kind: 'bezier', c: [0.9, 0, 1, 0.1] })
  const a0 = angleAt(r.json, tr.times[0]), a1 = angleAt(r.json, t1)
  const mid = angleAt(r.json, (tr.times[0] + t1) / 2)
  assert(Math.abs(a1 - a0) > 0.5, 'the segment moves')
  assert(Math.abs(mid - a0) < Math.abs(a1 - a0) * 0.2, `slow start: ${a0} → ${mid} → ${a1}`)
  // handles at the diagonal = linear again (the curve fields go away)
  r = Ops.setKeyBezier(r.json, an, [key], [0, 0, 1, 1])
  assert.strictEqual(Ops.keyBezier(r.json, an, key).kind, 'linear')
  const lin = angleAt(r.json, (tr.times[0] + t1) / 2)
  assert(Math.abs(lin - (a0 + a1) / 2) < Math.abs(a1 - a0) * 0.02 + 0.01, 'linear halfway')
  assert.strictEqual(Ops.nextKeyTime(wild, an, { path: tr.path, time: tr.times[tr.times.length - 1] }), null)
})

// move vertex 0 of a slot's mesh by (dx, dy) in world space at time t, through a deform key
function deformMove(json, an, slotName, t, dx, dy) {
  const sk = load(json); pose(sk, an, t + 1e-4)
  const slot = sk.findSlot(slotName), att = slot.getAttachment()
  const n = att.worldVerticesLength
  const before = new Float32Array(n); att.computeWorldVertices(slot, 0, n, before, 0, 2)
  const inv = (m, x, y) => { const det = m.a * m.d - m.b * m.c; return [(m.d * x - m.b * y) / det, (m.a * y - m.c * x) / det] }
  let offsets
  if (att.bones) {
    offsets = new Array(att.vertices.length / 3 * 2).fill(0)
    // vertex 0's influences are the first entries
    const count = att.bones[0]
    for (let i = 0; i < count; i++) {
      const b = sk.bones[att.bones[1 + i]]
      const o = inv(b, dx, dy)
      offsets[i * 2] = o[0]; offsets[i * 2 + 1] = o[1]
    }
  } else {
    offsets = new Array(att.vertices.length).fill(0)
    const o = inv(slot.bone, dx, dy)
    offsets[0] = o[0]; offsets[1] = o[1]
  }
  const r = Ops.keyDeform(json, an, 'default', slotName, att.name, t, offsets)
  const sk2 = load(r.json); pose(sk2, an, t + 1e-4)
  const s2 = sk2.findSlot(slotName), a2 = s2.getAttachment()
  const after = new Float32Array(n); a2.computeWorldVertices(s2, 0, n, after, 0, 2)
  return { before, after, r }
}

test('keyDeform: a weighted mesh vertex lands exactly where it was dragged', () => {
  const j = Ops.prepare(wild)
  const an = Object.keys(wild.animations)[0]
  const slot = j.slots.find((s) => s.attachment && Ops.isWeighted(j.skins[0].attachments[s.name][s.attachment]) && j.skins[0].attachments[s.name][s.attachment].type === 'mesh')
  const { before, after, r } = deformMove(wild, an, slot.name, 0.2, 10, 5)
  assert(near(after[0], before[0] + 10, 0.05) && near(after[1], before[1] + 5, 0.05), `v0 ${before[0]},${before[1]} → ${after[0]},${after[1]}`)
  for (let i = 2; i < before.length; i++) assert(near(after[i], before[i], 0.05), 'other vertices stay ' + i)
  assert(r.json.animations[an].deform.default[slot.name][slot.attachment][0].vertices.length > 0)
  // an all-zero key keeps the mesh at rest
  const z = Ops.keyDeform(r.json, an, 'default', slot.name, slot.attachment, 0.2, [0, 0, 0])
  assert(!z.json.animations[an].deform.default[slot.name][slot.attachment].find((k) => Math.abs((k.time || 0) - 0.2) < 1e-4).vertices)
  load(z.json)
})

test('dopesheet 移位 / 偏移 / 调整', () => {
  const an = Object.keys(wild.animations)[0]
  const tr = Ops.keyTracks(wild, an).find((x) => x.path[0] === 'bones' && x.path[2] === 'rotate' && x.times.length >= 4)
  const frames = (j) => Ops.keyTracks(j, an).find((x) => JSON.stringify(x.path) === JSON.stringify(tr.path)).times.map((t) => Math.round(t * 30))
  const f0 = tr.times.map((t) => Math.round(t * 30))
  // 移位: moving the 2nd key +2 frames moves every later key by +2 too
  let r = Ops.moveKeys(wild, an, [{ path: tr.path, time: tr.times[1] }], 2 / 30, { shift: true })
  assert.deepStrictEqual(frames(r.json), [f0[0], ...f0.slice(1).map((f) => f + 2)])
  // without it, only that key moves
  r = Ops.moveKeys(wild, an, [{ path: tr.path, time: tr.times[1] }], 1 / 30)
  assert.deepStrictEqual(frames(r.json), [f0[0], f0[1] + 1, ...f0.slice(2)])
  // 偏移: offsetting every key of the row by 3 frames wraps them; keys at 0 and the end are equal
  const end = Math.round(Math.max(...Ops.keyTracks(wild, an).flatMap((x) => x.times)) * 30)
  r = Ops.moveKeys(wild, an, tr.times.map((time) => ({ path: tr.path, time })), 3 / 30, { offset: true })
  const fr = frames(r.json)
  assert(fr.every((f) => f >= 0 && f <= end), 'all inside the loop ' + fr)
  assert.strictEqual(fr[0], 0); assert.strictEqual(fr[fr.length - 1], end)
  const list = r.json.animations[an].bones[tr.path[1]].rotate
  assert(Math.abs((list[0].angle || 0) - (list[list.length - 1].angle || 0)) < 1e-3, 'seam keys match')
  load(r.json)
  // the runtime loops seamlessly: pose at 0 == pose at the end
  const sk = load(r.json)
  const at = (t) => { pose(sk, an, t); return sk.findBone(tr.path[1]).rotation }
  assert(near(at(0), at(end / 30 - 1e-4), 0.05))
  // 调整: +15 degrees on the selected rotate keys
  r = Ops.adjustKeys(wild, an, tr.times.slice(0, 3).map((time) => ({ path: tr.path, time })), { [tr.path[1]]: { rotation: 15 } })
  assert.strictEqual(r.adjusted, 3)
  const a0 = wild.animations[an].bones[tr.path[1]].rotate, a1 = r.json.animations[an].bones[tr.path[1]].rotate
  for (let i = 0; i < 3; i++) assert(near((a1[i].angle || 0) - (a0[i].angle || 0), 15, 1e-3))
  assert(near((a1[3].angle || 0), (a0[3].angle || 0), 1e-6), 'unselected key untouched')
})

test('setup mode: moving mesh vertices changes the mesh (weighted and plain), the image follows', () => {
  const inv = (b, x, y) => { const det = b.a * b.d - b.b * b.c; return [(b.d * x - b.b * y) / det, (b.a * y - b.c * x) / det] }
  const worldOf = (sk, slot) => { const s = sk.findSlot(slot); const a = s.getAttachment(); const n = a.worldVerticesLength; const v = new Float32Array(n); a.computeWorldVertices(s, 0, n, v, 0, 2); return v }
  const sd = wild.slots.find((x) => x.attachment && wild.skins[0].attachments[x.name] && (wild.skins[0].attachments[x.name][x.attachment] || {}).type === 'mesh')
  // a plain (unweighted) copy of the same mesh: its setup world vertices in the slot bone's space
  const plain = Ops.prepare(wild)
  {
    const sk = load(wild), slot = sk.findSlot(sd.name), w = worldOf(sk, sd.name), bone = slot.bone, v = []
    for (let i = 0; i < w.length / 2; i++) v.push(...inv(bone, w[i * 2] - bone.worldX, w[i * 2 + 1] - bone.worldY))
    plain.skins[0].attachments[sd.name][sd.attachment].vertices = v
  }
  for (const [kind, json] of [['weighted', wild], ['plain', plain]]) {
    const sk0 = load(json)
    const slot = sk0.findSlot(sd.name), a = slot.getAttachment()
    assert.strictEqual(!!a.bones, kind === 'weighted')
    // move vertex 2 by (+12, -7) in world space
    const dx = 12, dy = -7, vi = 2
    const off = new Array(a.bones ? a.vertices.length / 3 * 2 : a.vertices.length).fill(0)
    if (a.bones) {
      let f = 0, vtx = 0
      for (let b = 0; b < a.bones.length; vtx++) {
        const n = a.bones[b++]
        for (let k = 0; k < n; k++, f++) if (vtx === vi) { const o = inv(sk0.bones[a.bones[b + k]], dx, dy); off[f * 2] = o[0]; off[f * 2 + 1] = o[1] }
        b += n
      }
    } else { const o = inv(slot.bone, dx, dy); off[vi * 2] = o[0]; off[vi * 2 + 1] = o[1] }
    const r = Ops.moveMeshVertices(json, 'default', sd.name, sd.attachment, off)
    const before = worldOf(sk0, sd.name), after = worldOf(load(r.json), sd.name)
    for (let i = 0; i < before.length / 2; i++) {
      const ex = i === vi ? [dx, dy] : [0, 0]
      assert(near(after[i * 2] - before[i * 2], ex[0], 0.02) && near(after[i * 2 + 1] - before[i * 2 + 1], ex[1], 0.02), `${kind} vertex ${i}`)
    }
    assert.deepStrictEqual(r.json.skins[0].attachments[sd.name][sd.attachment].uvs, json.skins[0].attachments[sd.name][sd.attachment].uvs, 'uvs untouched')
  }
  // a linked mesh in another skin edits the mesh it links to
  let r = Ops.createSkin(wild, 'S')
  r = Ops.copyAttachmentToSkin(r.json, 'default', sd.name, sd.attachment, 'S')
  const off = new Array(4).fill(0); off[0] = 5
  const m = Ops.moveMeshVertices(r.json, 'S', sd.name, sd.attachment, off)
  assert.notDeepStrictEqual(m.json.skins[0].attachments[sd.name][sd.attachment].vertices, r.json.skins[0].attachments[sd.name][sd.attachment].vertices)
})

test('attachment 复制: image copy, independent mesh (with / without keys), linked mesh', () => {
  const j = Ops.prepare(wild)
  const sd = j.slots.find((x) => x.attachment && (j.skins[0].attachments[x.name][x.attachment] || {}).type === 'mesh')
  const slot = sd.name, name = sd.attachment
  const mesh = j.skins[0].attachments[slot][name]
  let len = 0
  { let i = 0; while (i < mesh.vertices.length) { const n = mesh.vertices[i]; len += n * 2; i += 1 + n * 4 } }
  const an = Object.keys(j.animations)[0]
  j.animations[an].deform = { default: { [slot]: { [name]: [{ time: 0 }, { time: 0.3, vertices: new Array(len).fill(6) }] } } }
  assert(Ops.hasDeformKeys(j, 'default', slot, name))
  const worldAt = (json, att, t) => {
    const sk = load(json); pose(sk, an, t)
    const s = sk.findSlot(slot); s.setAttachment(sk.getAttachment(s.data.index, att))
    pose(sk, an, t)
    s.setAttachment(sk.getAttachment(s.data.index, att))
    sk.updateWorldTransform()
    // apply the deform timeline for that attachment by hand (setAttachment cleared it)
    const a = sk.data.findAnimation(an)
    for (const tl of a.timelines) if (tl.slotIndex === s.data.index && tl.attachment && (tl.attachment === s.getAttachment() || tl.attachment === s.getAttachment().deformAttachment)) tl.apply(sk, t, t, null, 1, spine.MixBlend.setup, spine.MixDirection.mixIn)
    const at = s.getAttachment(); const n = at.worldVerticesLength; const v = new Float32Array(n); at.computeWorldVertices(s, 0, n, v, 0, 2); return v
  }
  const orig = worldAt(j, name, 0.3)
  // independent copy with keys: same shape at 0.3, own deform track
  let r = Ops.duplicateAttachment(j, 'default', slot, name, { animation: true })
  assert.strictEqual(r.attachment, name + '2')
  assert.strictEqual(r.json.skins[0].attachments[slot][r.attachment].type, 'mesh')
  assert(r.json.animations[an].deform.default[slot][r.attachment])
  let v = worldAt(r.json, r.attachment, 0.3)
  for (let i = 0; i < v.length; i++) assert(near(v[i], orig[i], 0.01), 'independent copy vertex ' + i)
  // independent copy without keys: setup shape at 0.3 (no deform)
  r = Ops.duplicateAttachment(j, 'default', slot, name, { animation: false })
  assert(!r.json.animations[an].deform.default[slot][r.attachment])
  // its vertices are its own: moving them leaves the original alone
  const moved = Ops.moveMeshVertices(r.json, 'default', slot, r.attachment, [5, 5])
  assert.deepStrictEqual(moved.json.skins[0].attachments[slot][name].vertices, j.skins[0].attachments[slot][name].vertices)
  // linked mesh: uses the original's vertices and deform keys
  r = Ops.duplicateAttachment(j, 'default', slot, name, { linked: true })
  const lm = r.json.skins[0].attachments[slot][r.attachment]
  assert.strictEqual(lm.type, 'linkedmesh'); assert.strictEqual(lm.parent, name)
  v = worldAt(r.json, r.attachment, 0.3)
  for (let i = 0; i < v.length; i++) assert(near(v[i], orig[i], 0.01), 'linked copy vertex ' + i)
  // a linked copy of the linked mesh links to the source mesh
  const r2 = Ops.duplicateAttachment(r.json, 'default', slot, r.attachment, { linked: true })
  assert.strictEqual(r2.json.skins[0].attachments[slot][r2.attachment].parent, name)
  // a region image copies as a region with the same picture
  const rs = j.slots.find((x) => x.attachment && !(j.skins[0].attachments[x.name][x.attachment] || {}).type)
  if (rs) {
    const rr = Ops.duplicateAttachment(j, 'default', rs.name, rs.attachment)
    const c = rr.json.skins[0].attachments[rs.name][rr.attachment]
    assert.strictEqual(c.path || rr.attachment, j.skins[0].attachments[rs.name][rs.attachment].path || rs.attachment)
    assert.throws(() => Ops.duplicateAttachment(j, 'default', rs.name, rs.attachment, { linked: true }), /只有网格/)
  }
})

test('events: create, values, key in an animation, move / delete keys, rename, delete', () => {
  const an = Object.keys(wild.animations)[0]
  let r = Ops.createEvent(wild, 'footstep')
  assert.strictEqual(r.event, 'footstep')
  r = Ops.setEventProps(r.json, 'footstep', { int: 2, string: 'L', float: 0 })
  assert.deepStrictEqual(r.json.events.footstep, { int: 2, string: 'L' })
  r = Ops.keyEvent(r.json, an, 'footstep', 0.1)
  r = Ops.keyEvent(r.json, an, 'footstep', 0.2)
  r = Ops.keyEvent(r.json, an, 'footstep', 0.2)            // same time: one key
  const r2 = Ops.createEvent(r.json, 'footstep')           // taken: footstep2
  assert.strictEqual(r2.event, 'footstep2')
  r = Ops.keyEvent(r2.json, an, 'footstep2', 0.15)
  const tr = Ops.keyTracks(r.json, an).filter((x) => x.path[0] === 'events')
  assert.deepStrictEqual(tr.map((x) => [x.path[1], x.times]), [['footstep', [0.1, 0.2]], ['footstep2', [0.15]]])
  // the runtime reads them: an event timeline firing footstep with int 2
  const sk = load(r.json)
  const tl = sk.data.findAnimation(an).timelines.find((x) => x instanceof spine.EventTimeline)
  assert(tl, 'event timeline')
  assert.deepStrictEqual(Array.from(tl.frames).map((x) => Math.round(x * 100) / 100), [0.1, 0.15, 0.2])
  assert.strictEqual(tl.events[0].data.name, 'footstep'); assert.strictEqual(tl.events[0].intValue, 2); assert.strictEqual(tl.events[0].stringValue, 'L')
  // dopesheet moves only that event's keys
  r = Ops.moveKeys(r.json, an, [{ path: ['events', 'footstep'], time: 0.2 }], 0.1)
  assert.deepStrictEqual(r.json.animations[an].events.map((k) => [k.name, k.time]), [['footstep', 0.1], ['footstep2', 0.15], ['footstep', 0.3]])
  r = Ops.deleteKeys(r.json, an, [{ path: ['events', 'footstep2'], time: 0.15 }])
  assert.deepStrictEqual(r.json.animations[an].events.map((k) => k.name), ['footstep', 'footstep'])
  // rename follows into the keys; delete takes the keys with it
  r = Ops.renameEvent(r.json, 'footstep', 'step')
  assert(r.json.events.step && !r.json.events.footstep)
  assert(r.json.animations[an].events.every((k) => k.name === 'step'))
  const d = Ops.deleteEvent(r.json, 'step')
  assert.strictEqual(d.keys, 2)
  assert(!d.json.animations[an].events)
  load(d.json)
})

// ------------------------------------------------------------------ 编辑网格 (mesh-edit.js)
require(path.join(ROOT, 'novaflow-web/renderer/spine-mesh-edit.js'))
const MeshEdit = globalThis.NovaFlowMeshEdit
// the renderer folder is an ES module package: the core hangs itself on globalThis
require(path.join(ROOT, 'novaflow-web/renderer/spine-auto-mesh-core.js'))
const Core = globalThis.NovaFlowAutoMeshCore
const meshCtx = (json, slotName) => {
  const sk = load(json)
  const slot = sk.findSlot(slotName), att = slot.getAttachment()
  const n = att.worldVerticesLength, world = new Float32Array(n)
  att.computeWorldVertices(slot, 0, n, world, 0, 2)
  const mats = sk.bones.map((b) => ({ a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY }))
  const name = json.slots.find((x) => x.name === slotName).attachment
  return { sk, slot, att, world, mats, slotBone: slot.bone.data.index, name, json: json.skins[0].attachments[slotName][name] }
}
const worldOfSlot = (json, slotName) => { const c = meshCtx(json, slotName); return Array.from(c.world) }

test('region → mesh keeps the picture in place', () => {
  const sd = wild.slots.find((x) => x.attachment && !(wild.skins[0].attachments[x.name][x.attachment] || {}).type)
  const sk0 = load(wild)
  const s0 = sk0.findSlot(sd.name), a0 = s0.getAttachment(), q = new Float32Array(8)
  a0.computeWorldVertices(s0.bone, q, 0, 2)
  const r = Ops.regionToMesh(wild, 'default', sd.name, sd.attachment)
  assert.strictEqual(r.json.skins[0].attachments[sd.name][sd.attachment].type, 'mesh')
  const w = worldOfSlot(r.json, sd.name)
  // region corner order (BL, TL, TR, BR) vs mesh (TL, TR, BR, BL)
  const order = [1, 2, 3, 0]
  for (let i = 0; i < 4; i++) assert(near(w[i * 2], q[order[i] * 2], 0.01) && near(w[i * 2 + 1], q[order[i] * 2 + 1], 0.01), 'corner ' + i)
})

test('编辑网格: the model round-trips, adds / deletes / moves vertices, keeps deform keys', () => {
  const sd = wild.slots.find((x) => x.attachment && (wild.skins[0].attachments[x.name][x.attachment] || {}).type === 'mesh')
  const j0 = Ops.prepare(wild)
  const an = Object.keys(j0.animations)[0]
  const c0 = meshCtx(j0, sd.name)
  const mesh = c0.json
  let len = 0
  { let i = 0; while (i < mesh.vertices.length) { const n = mesh.vertices[i]; len += n * 2; i += 1 + n * 4 } }
  j0.animations[an].deform = { default: { [sd.name]: { [c0.name]: [{ time: 0 }, { time: 0.3, vertices: new Array(len).fill(4) }] } } }
  const model = MeshEdit.fromAttachment(mesh, c0.world, { width: mesh.width, height: mesh.height })
  assert(model.weighted)
  // round trip: same world vertices
  const back = MeshEdit.toAttachment(model, c0.mats, c0.slotBone)
  let r = Ops.setMesh(j0, 'default', sd.name, c0.name, back, MeshEdit.remapOf(model))
  const w1 = worldOfSlot(r.json, sd.name)
  for (let i = 0; i < w1.length; i++) assert(near(w1[i], c0.world[i], 0.02), 'round trip ' + i)
  // add a vertex inside: the old ones stay, the new one lands where it was put
  const t0 = model.tris
  const A = model.points[t0[0]], B = model.points[t0[1]], C = model.points[t0[2]]
  const px = (A.x + B.x + C.x) / 3, py = (A.y + B.y + C.y) / 3
  const m2 = MeshEdit.addPoint(model, px, py, Core)
  assert.strictEqual(m2.points.length, model.points.length + 1)
  r = Ops.setMesh(j0, 'default', sd.name, c0.name, MeshEdit.toAttachment(m2, c0.mats, c0.slotBone), MeshEdit.remapOf(m2))
  const w2 = worldOfSlot(r.json, sd.name)
  for (let i = 0; i < c0.world.length; i++) assert(near(w2[i], c0.world[i], 0.02), 'kept vertex ' + i)
  const ni = m2.points.length - 1
  assert(near(w2[ni * 2], px, 0.05) && near(w2[ni * 2 + 1], py, 0.05), 'new vertex where it was put')
  // deform keys: kept vertices keep theirs, the new vertex starts at zero
  const k = r.json.animations[an].deform.default[sd.name][c0.name][1]
  const full = new Array(len + m2.points[ni].w.length * 2).fill(0); (k.vertices || []).forEach((v, i) => { full[(k.offset || 0) + i] = v })
  assert(full.slice(0, len).every((v) => v === 4), 'old offsets kept')
  assert(full.slice(len).every((v) => v === 0), 'new vertex offsets zero')
  // the mesh still loads and every triangle index is valid
  const tri = r.json.skins[0].attachments[sd.name][c0.name].triangles
  assert(tri.every((i) => i >= 0 && i < m2.points.length))
  // delete it again
  const m3 = MeshEdit.removePoints(m2, [ni], Core)
  assert.strictEqual(m3.points.length, model.points.length)
  // move with 变形 off: the vertex slides over the picture (uv changes), with 变形 on the uv stays
  const inner = Math.max(0, model.points.findIndex((p, i) => i >= model.hull))
  const mOff = MeshEdit.movePoints(model, [inner], 3, 2, false, Core)
  const mOn = MeshEdit.movePoints(model, [inner], 3, 2, true, Core)
  assert(Math.abs(mOff.points[inner].u - model.points[inner].u) + Math.abs(mOff.points[inner].v - model.points[inner].v) > 0.01, 'uv slides')
  assert.strictEqual(mOn.points[inner].u, model.points[inner].u)
  // reset: the image rectangle in place
  const mr = MeshEdit.reset(model, Core)
  assert.strictEqual(mr.hull, 4); assert.strictEqual(mr.points.length, 4); assert.strictEqual(mr.tris.length, 6)
  // generate adds inner vertices, all inside, triangles valid
  const mg = MeshEdit.generate(mr, Core)
  assert(mg.points.length > 4)
  r = Ops.setMesh(j0, 'default', sd.name, c0.name, MeshEdit.toAttachment(mg, c0.mats, c0.slotBone), MeshEdit.remapOf(mg))
  load(r.json)
})

test('编辑网格: an unweighted mesh, 新建 and 描绘', () => {
  // a region turned into a mesh is unweighted
  const sd = wild.slots.find((x) => x.attachment && !(wild.skins[0].attachments[x.name][x.attachment] || {}).type)
  const j = Ops.regionToMesh(wild, 'default', sd.name, sd.attachment).json
  const c = meshCtx(j, sd.name)
  const model = MeshEdit.fromAttachment(c.json, c.world, { width: c.json.width, height: c.json.height })
  assert(!model.weighted)
  // 新建: a triangle hull through three clicked points
  const P = model.points
  const mid = (a, b) => [(a.x + b.x) / 2, (a.y + b.y) / 2]
  const mn = MeshEdit.newHull(model, [mid(P[0], P[1]), mid(P[1], P[2]), mid(P[2], P[3])], Core)
  assert.strictEqual(mn.hull, 3); assert.strictEqual(mn.tris.length, 3)
  let r = Ops.setMesh(j, 'default', sd.name, c.name, MeshEdit.toAttachment(mn, c.mats, c.slotBone), MeshEdit.remapOf(mn))
  const w = worldOfSlot(r.json, sd.name)
  assert(near(w[0], mid(P[0], P[1])[0], 0.05) && near(w[1], mid(P[0], P[1])[1], 0.05))
  // 描绘: an opaque disc in a 64×64 picture becomes a round hull
  const W = 64, H = 64, rgba = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - 32, y - 32) < 20) rgba[(y * W + x) * 4 + 3] = 255
  const small = { ...model, width: W, height: H, points: model.points.map((p) => ({ ...p, u: p.u / model.width * W, v: p.v / model.height * H })) }
  const mt = MeshEdit.trace(small, rgba, Core)
  assert(mt.hull >= 8, 'hull ' + mt.hull)
  assert(mt.points.slice(0, mt.hull).every((p) => Math.abs(Math.hypot(p.u - 32, p.v - 32) - 20) < 3), 'on the outline')
})

test('编辑网格: a concave hull keeps its edges; 描绘 settings; 生成 keeps adding', () => {
  // a U: two fingers with a gap between them
  const W = 80, H = 80, rgba = new Uint8ClampedArray(W * H * 4)
  const opaque = (x, y) => (y >= 50 && y < 70 && x >= 10 && x < 70) || (y >= 10 && y < 70 && ((x >= 10 && x < 30) || (x >= 50 && x < 70)))
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (opaque(x, y)) rgba[(y * W + x) * 4 + 3] = 255
  const blank = { width: W, height: H, hull: 4, weighted: false, tris: [0, 1, 2, 0, 2, 3],
    points: [[0, 0], [W, 0], [W, H], [0, H]].map(([u, v], i) => ({ u, v, x: u, y: -v, w: null, src: i })) }
  const areaOf = (m) => { let a = 0; for (let t = 0; t < m.tris.length; t += 3) { const [A, B, C] = [0, 1, 2].map((k) => m.points[m.tris[t + k]]); a += Math.abs((B.u - A.u) * (C.v - A.v) - (B.v - A.v) * (C.u - A.u)) / 2 } return a }
  const polyArea = (P) => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return Math.abs(a / 2) }
  // default 描绘 follows the gap; the triangles fill the outline exactly (none across the gap, no holes)
  const m = MeshEdit.trace(blank, rgba, Core)
  const hull = m.points.slice(0, m.hull).map((p) => [p.u, p.v])
  assert(MeshEdit.pointInPoly(40, 60, hull), 'the palm is inside')
  assert(!MeshEdit.pointInPoly(40, 25, hull), 'the gap between the fingers is outside')
  assert(near(areaOf(m), polyArea(hull), 1e-6), 'triangles cover the outline exactly: ' + areaOf(m) + ' vs ' + polyArea(hull))
  // 精致度 100: every opaque pixel centre is inside; 填充 10 grows the outline by about that much
  const tight = MeshEdit.traceOutline(rgba, W, H, Core, { refine: 100 })
  let missed = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (opaque(x, y) && !MeshEdit.pointInPoly(x + 0.5, y + 0.5, tight)) missed++
  assert(missed <= 4, 'refine 100 covers the pixels, missed ' + missed)
  const pad = MeshEdit.traceOutline(rgba, W, H, Core, { padding: 6 })
  assert(polyArea(pad) > polyArea(tight) + 6 * 150, 'padding grows the outline')
  // 凹度 0 = the convex hull (the gap is inside); 细节 changes the vertex count
  const convex = MeshEdit.traceOutline(rgba, W, H, Core, { concavity: 0 })
  assert(MeshEdit.pointInPoly(40, 25, convex), 'convex hull bridges the gap')
  const disc = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - 40, y - 40) < 34) disc[(y * W + x) * 4 + 3] = 255
  const lo = MeshEdit.traceOutline(disc, W, H, Core, { detail: 10 }).length, hi = MeshEdit.traceOutline(disc, W, H, Core, { detail: 95 }).length
  assert(hi > lo + 4, `detail: ${lo} → ${hi}`)
  // two pieces apart become one outline around both
  const two = new Uint8ClampedArray(W * H * 4)
  for (let y = 20; y < 40; y++) for (let x = 0; x < W; x++) if (x < 20 || x >= 60) two[(y * W + x) * 4 + 3] = 255
  const both = MeshEdit.traceOutline(two, W, H, Core)
  assert(MeshEdit.pointInPoly(10, 30, both) && MeshEdit.pointInPoly(70, 30, both), 'both pieces inside one hull')
  // 生成: every click adds more, inside the outline, and the outline edges stay
  let g = m, counts = [m.points.length]
  for (let k = 0; k < 4; k++) { g = MeshEdit.generate(g, Core); counts.push(g.points.length) }
  for (let k = 1; k < counts.length; k++) assert(counts[k] > counts[k - 1], 'generate keeps adding: ' + counts.join(' → '))
  assert(g.points.slice(g.hull).every((p) => MeshEdit.pointInPoly(p.u, p.v, hull)), 'inner vertices inside')
  assert(near(areaOf(g), polyArea(hull), 1e-6), 'still covers the outline exactly')
})

test('编辑网格: edges dragged between vertices stay in the triangles and in the file', () => {
  // a 4×4 grid: hull of 12, 4 inside
  const pts = []
  const ring = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [0, 3], [0, 2], [0, 1]]
  for (const [x, y] of ring) pts.push([x * 10, y * 10])
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) pts.push([x * 10 + 1, y * 10 + 2])
  const model = { width: 30, height: 30, hull: 12, weighted: false, tris: [], edges: [],
    points: pts.map(([u, v], i) => ({ u, v, x: u, y: -v, w: null, src: i })) }
  model.tris = MeshEdit.triangulate(model, Core)
  const hasEdge = (m, a, b) => { for (let t = 0; t < m.tris.length; t += 3) { const T = [m.tris[t], m.tris[t + 1], m.tris[t + 2]]; if (T.includes(a) && T.includes(b)) return true } return false }
  // the diagonal 12 → 15 is forced in
  const m = MeshEdit.addEdge(model, 12, 15, Core)
  assert.deepStrictEqual(m.edges, [[12, 15]]); assert(hasEdge(m, 12, 15))
  // the other diagonal would cross it; one outside the hull is refused
  assert.throws(() => MeshEdit.addEdge(m, 13, 14, Core), /交叉/)
  // round trip: Spine's edges = hull pairs + the user's, indices × 2
  const att = MeshEdit.toAttachment(m, [{ a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0 }], 0)
  assert.strictEqual(att.edges.length, (12 + 1) * 2); assert.deepStrictEqual(att.edges.slice(-2), [24, 30])
  const back = MeshEdit.fromAttachment({ ...att, width: 30, height: 30 }, m.points.flatMap((p) => [p.x, p.y]), { width: 30, height: 30 })
  assert.deepStrictEqual(back.edges, [[12, 15]])
  // deleting a vertex before it shifts the edge; deleting its end drops it; removeEdge drops it
  const r1 = MeshEdit.removePoints(m, [13], Core)
  assert.deepStrictEqual(r1.edges, [[12, 14]])
  assert.deepStrictEqual(MeshEdit.removePoints(m, [15], Core).edges, [])
  assert.deepStrictEqual(MeshEdit.removeEdge(m, 0, Core).edges, [])
  // a vertex added into the hull shifts the indices after it
  const grown = MeshEdit.addPoint(m, 15, 5, Core)   // outside (y up: v = -5 → above the top edge)
  assert(grown.hull === 13 && grown.edges[0][0] === 13 && grown.edges[0][1] === 16, JSON.stringify(grown.edges))
})

test('编辑网格: 生成 = one more even division per click (Spine); vertices stop at the image', () => {
  // the BIG WIN picture's shape: wide and low
  const W = 1338, H = 386
  const rect = () => ({ width: W, height: H, hull: 4, weighted: false, edges: [], tris: [0, 1, 3, 1, 2, 3],
    points: [[0, 0], [W, 0], [W, H], [0, H]].map(([u, v], i) => ({ u, v, x: u, y: -v, w: null, src: i })) })
  const cells = (m) => [new Set(m.points.map((p) => p.u.toFixed(3))).size - 1, new Set(m.points.map((p) => p.v.toFixed(3))).size - 1]
  let m = rect()
  const seq = []
  for (let k = 0; k < 14; k++) { m = MeshEdit.generate(m, Core); seq.push(cells(m).join('×')) }
  // columns first, rows join in (Spine shows 9×2 and 14×3 on this picture)
  assert.deepStrictEqual(seq, ['2×1', '3×1', '4×1', '5×1', '6×1', '7×1', '8×2', '9×2', '10×2', '11×2', '12×3', '13×3', '14×3', '15×4'])
  // a full grid: the outline carries the edge points, every cell split along the same "/" diagonal
  const [cu, cv] = cells(m)
  assert.strictEqual(m.points.length, (cu + 1) * (cv + 1)); assert.strictEqual(m.hull, 2 * (cu + cv)); assert.strictEqual(m.tris.length, cu * cv * 6)
  for (let t = 0; t < m.tris.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = m.points[m.tris[t + e]], b = m.points[m.tris[t + (e + 1) % 3]]
    if (Math.abs(a.u - b.u) > 1e-6 && Math.abs(a.v - b.v) > 1e-6) assert((b.u - a.u) * (b.v - a.v) < 0, 'diagonal "/"')
  }
  // a hand-placed vertex stays through the next click
  const g = MeshEdit.generate(MeshEdit.addPoint(m, 100.3, -100.7, Core), Core)
  assert(g.points.some((p) => near(p.x, 100.3, 1e-6) && near(p.y, -100.7, 1e-6)), 'hand vertex kept')
  assert.strictEqual(g.points.length, 17 * 5, 'the next grid (17 × 5 points; the one next to the hand vertex gives way to it)')
  // 创建 above the top edge: the vertex lands on the edge, its world place on the picture's edge (no stretch)
  const up = MeshEdit.addPoint(rect(), 500, 80, Core)
  const np = up.points.find((p) => p.src === -1)
  assert(near(np.u, 500, 1e-6) && near(np.v, 0, 1e-6) && near(np.x, 500, 1e-6) && near(np.y, 0, 1e-6), JSON.stringify(np))
  assert.strictEqual(up.hull, 5, 'on the outline')
  assert.throws(() => MeshEdit.addPoint(rect(), -300, 300, Core), /已经有顶点/)
  // 修改 dragged past the right edge: it stops there, still on the same picture pixel row
  const inner = MeshEdit.addPoint(rect(), 600, -200, Core)
  const ii = inner.points.findIndex((p) => p.src === -1)
  const mv = MeshEdit.movePoints(inner, [ii], 2000, 0, false, Core)
  assert(near(mv.points[ii].u, W, 1e-6) && near(mv.points[ii].x, W, 1e-6) && near(mv.points[ii].y, -200, 1e-6), JSON.stringify(mv.points[ii]))
  // 新建: clicks off the picture land on its edges, world and image places agree
  const nh = MeshEdit.newHull(rect(), [[-50, 50], [W + 50, 50], [W / 2, -H - 50]], Core)
  assert(nh.points.every((p) => p.u >= 0 && p.u <= W && p.v >= 0 && p.v <= H && near(p.x, p.u, 1e-6) && near(p.y, -p.v, 1e-6)))
})

test('权重: list order lives in the vertices; 直接 nudges the picked vertices', () => {
  const pts = [
    { u: 0, v: 0, x: 0, y: 0, w: [[4, 0.5], [2, 0.5]], src: 0 },
    { u: 1, v: 0, x: 1, y: 0, w: [[2, 0.7], [7, 0.3]], src: 1 },
    { u: 0, v: 1, x: 0, y: 1, w: [[4, 1]], src: 2 },
  ]
  const model = { width: 1, height: 1, hull: 3, points: pts, tris: [0, 1, 2], weighted: true }
  assert.deepStrictEqual(MeshEdit.boneOrder(model), [4, 2, 7])
  const re = MeshEdit.orderInfluences(model, [2, 4, 7])
  assert.deepStrictEqual(MeshEdit.boneOrder(re), [2, 4, 7], 'a reordered list reads back')
  assert.deepStrictEqual(MeshEdit.orderInfluences(model, [7, 4, 2]).points[1].w, [[7, 0.3], [2, 0.7]])
  // 直接: +20% of bone 2 on vertices 0 and 1; the rest keep their ratio and the sums stay one
  const n = MeshEdit.nudgeWeights(model, [0, 1], 2, 0.2)
  assert(near(n.points[0].w.find(([b]) => b === 2)[1], 0.7, 1e-9) && near(n.points[1].w.find(([b]) => b === 2)[1], 0.9, 1e-9))
  for (const p of n.points) assert(near(p.w.reduce((a, [, x]) => a + x, 0), 1, 1e-9))
  assert(near(MeshEdit.meanWeight(model, [0, 1], 2), 0.6, 1e-9)); assert.strictEqual(MeshEdit.meanWeight(model, [2], 7), null)
  // set to an exact value; a bone a vertex lacks joins it
  const s = MeshEdit.nudgeWeights(model, [2], 2, 0, 0.25)
  assert.deepStrictEqual(s.points[2].w.map(([b, x]) => [b, Math.round(x * 100)]), [[4, 75], [2, 25]])
  // 修剪 only on the picked vertices
  const pr = MeshEdit.pruneWeights(model, 0.4, [1])
  assert.deepStrictEqual(pr.points[1].w, [[2, 1]]); assert.strictEqual(pr.points[0].w.length, 2)
})

test('IK like Spine: one / two bones, 压缩 伸展 统一 in setup, 正向 伸展 柔软度 keyed', () => {
  const j0 = jiaye || wild
  const ik = (j0.ik || []).find((c) => c.bones.length === 2)
  if (!ik) return
  const an = Object.keys(j0.animations)[0]
  // drop the child: a one-bone IK with 压缩 / 伸展 / 统一
  let r = Ops.setConstraintProps(j0, 'ik', ik.name, { bones: [ik.bones[0]] })
  r = Ops.setConstraintProps(r.json, 'ik', ik.name, { compress: true, stretch: true, uniform: true })
  let sk = load(r.json)
  let d = sk.data.findIkConstraint(ik.name)
  assert(d.bones.length === 1 && d.compress && d.stretch && d.uniform)
  // the child back; 正向 off, 伸展 and 柔软度 keyed at 0.3
  r = Ops.setConstraintProps(r.json, 'ik', ik.name, { bones: ik.bones, compress: false, uniform: false })
  r = Ops.keyConstraint(r.json, an, 'ik', ik.name, 0.3, { mix: 0.5, softness: 12, bendPositive: false, stretch: true })
  const key = r.json.animations[an].ik[ik.name].find((k) => Math.abs((k.time || 0) - 0.3) < 1e-4)
  assert.deepStrictEqual({ mix: key.mix, softness: key.softness, bendPositive: key.bendPositive, stretch: key.stretch }, { mix: 0.5, softness: 12, bendPositive: false, stretch: true })
  sk = load(r.json)
  pose(sk, an, 0.3 + 1e-4)
  const c = sk.findIkConstraint(ik.name)
  assert(c.bones.length === 2 && near(c.mix, 0.5) && near(c.softness, 12) && c.bendDirection === -1 && c.stretch, 'the runtime plays the key')
  // a child that is not the parent's child is refused
  const other = j0.bones.find((b) => b.parent && b.parent !== ik.bones[0] && b.name !== ik.bones[0])
  assert.throws(() => Ops.setConstraintProps(j0, 'ik', ik.name, { bones: [ik.bones[0], other.name] }))
})

test('剪裁: new clipping, polygon, 结束插槽, colour; the runtime clips from its slot to the end slot', () => {
  const j0 = wild
  const slots = j0.slots.map((x) => x.name)
  const at = Math.max(0, slots.length - 4)
  let r = Ops.addSlot(j0, j0.slots[at].bone, 'mask')
  // the new slot goes on top; drop it under the last three
  const order = r.json.slots.map((x) => x.name).filter((n) => n !== 'mask')
  order.splice(order.length - 3, 0, 'mask')
  r = Ops.reorderSlots(r.json, order)
  r = Ops.createClipping(r.json, 'mask')
  const name = r.attachment
  assert.strictEqual(r.json.slots.find((x) => x.name === 'mask').attachment, name, 'the slot shows the new clipping')
  assert.strictEqual(r.json.skins[0].attachments.mask[name].vertexCount, 0)
  load(r.json)   // an empty clipping still loads
  r = Ops.setClipping(r.json, 'default', 'mask', name, { vertices: [0, 0, 100, 0, 100, 100, 0, 100], end: order[order.length - 2], color: '00ff00ff' })
  const att = r.json.skins[0].attachments.mask[name]
  assert.deepStrictEqual([att.vertexCount, att.end, att.color], [4, order[order.length - 2], '00ff00ff'])
  const sk = load(r.json)
  const live = sk.findSlot('mask').getAttachment()
  assert(live instanceof spine.ClippingAttachment && live.worldVerticesLength === 8)
  assert.strictEqual(live.endSlot.name, order[order.length - 2])
  // the default colour is not written; '' end = to the top; renaming the end slot follows
  r = Ops.setClipping(r.json, 'default', 'mask', name, { color: 'CE3A3AFF' })
  assert(!('color' in r.json.skins[0].attachments.mask[name]))
  r = Ops.renameSlot(r.json, order[order.length - 2], 'endslot')
  assert.strictEqual(r.json.skins[0].attachments.mask[name].end, 'endslot')
  r = Ops.setClipping(r.json, 'default', 'mask', name, { end: '' })
  assert(!('end' in r.json.skins[0].attachments.mask[name]))
  assert.throws(() => Ops.setClipping(r.json, 'default', 'mask', name, { end: 'nope' }))
  // its vertices move in 设置 and are keyed in an animation (deform), like a mesh
  const an = Object.keys(r.json.animations)[0]
  r = Ops.moveMeshVertices(r.json, 'default', 'mask', name, [5, 0, 0, 0, 0, 0, 0, 0])
  assert.deepStrictEqual(r.json.skins[0].attachments.mask[name].vertices.slice(0, 2), [5, 0])
  r = Ops.keyDeform(r.json, an, 'default', 'mask', name, 0.25, [0, 0, 10, 0, 10, 10, 0, 0])
  const sk2 = load(r.json)
  pose(sk2, an, 0.25 + 1e-4)
  const sl = sk2.findSlot('mask'), ca = sl.getAttachment()
  const wv = new Float32Array(8)
  ca.computeWorldVertices(sl, 0, 8, wv, 0, 2)
  const b = sl.bone
  const toW = (x, y) => [b.a * x + b.b * y + b.worldX, b.c * x + b.d * y + b.worldY]
  assert(near(wv[2], toW(110, 0)[0], 0.01) && near(wv[5], toW(110, 110)[1], 0.01), 'the deform key moves the clipping')
})

test('导出 unticked: the image stays in the editor, the export leaves it out cleanly', () => {
  const sd = wild.slots.find((x) => x.attachment && (wild.skins[0].attachments[x.name][x.attachment] || {}).type === 'mesh')
  const an = Object.keys(wild.animations)[0]
  let r = Ops.createSkin(wild, 'S')
  r = Ops.copyAttachmentToSkin(r.json, 'default', sd.name, sd.attachment, 'S')       // a linked mesh drawing from it
  r = Ops.keyAttachment(r.json, an, sd.name, 0.2, sd.attachment)
  r = Ops.keyDeform(r.json, an, 'default', sd.name, sd.attachment, 0.1, [1, 1])
  r = Ops.setAttachmentExport(r.json, 'default', sd.name, sd.attachment, false)
  assert(!Ops.isExported(r.json, 'default', sd.name, sd.attachment))
  assert(r.json.skins[0].attachments[sd.name][sd.attachment], 'still in the editor')
  load(r.json)
  const out = Ops.exportable(r.json)
  assert(!out.nfNoExport)
  assert(!(out.skins[0].attachments[sd.name] || {})[sd.attachment], 'not exported')
  assert(!(out.skins.find((s) => s.name === 'S').attachments[sd.name] || {})[sd.attachment], 'its linked mesh not exported')
  assert(!out.slots.find((s) => s.name === sd.name).attachment, 'slot no longer shows it')
  assert(out.animations[an].slots[sd.name].attachment.every((k) => k.name !== sd.attachment))
  assert(!((out.animations[an].deform || {}).default || {})[sd.name] || !out.animations[an].deform.default[sd.name][sd.attachment])
  load(out)
  // ticked again: exported as before
  r = Ops.setAttachmentExport(r.json, 'default', sd.name, sd.attachment, true)
  assert(Ops.isExported(r.json, 'default', sd.name, sd.attachment)); assert(!r.json.nfNoExport)
})

test('自动蒙皮 + 权重: a generated mesh in place, painted weights sum to one, the mesh still loads', () => {
  require(path.join(ROOT, 'novaflow-web/renderer/spine-auto-mesh.js'))
  require(path.join(ROOT, 'novaflow-web/renderer/spine-auto-weights.js'))
  const AM = globalThis.NovaFlowAutoMesh, AW = globalThis.NovaFlowAutoWeights
  // a region → mesh, then a generated mesh from a drawn disc
  const sd = wild.slots.find((x) => x.attachment && !(wild.skins[0].attachments[x.name][x.attachment] || {}).type)
  const j = Ops.regionToMesh(wild, 'default', sd.name, sd.attachment).json
  const c = meshCtx(j, sd.name)
  const model = MeshEdit.fromAttachment(c.json, c.world, { width: c.json.width, height: c.json.height })
  const W = Math.round(model.width), Hh = Math.round(model.height), rgba = new Uint8ClampedArray(W * Hh * 4)
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - W / 2, y - Hh / 2) < Math.min(W, Hh) * 0.4) rgba[(y * W + x) * 4 + 3] = 255
  const gen = AM.buildMesh(rgba, W, Hh, { density: 12 })
  assert(gen && gen.hull >= 6, 'generated')
  const mg = MeshEdit.fromImageMesh(model, gen)
  let r = Ops.setMesh(j, 'default', sd.name, c.name, MeshEdit.toAttachment(mg, c.mats, c.slotBone), MeshEdit.remapOf(mg))
  const w0 = worldOfSlot(r.json, sd.name)
  // the generated vertices sit where the picture is
  const s0 = MeshEdit.sampleAt(model, gen.vertices[0], gen.vertices[1], 'uv')
  assert(near(w0[0], s0.x, 0.05) && near(w0[1], s0.y, 0.05))
  // weights: to weighted, paint another bone, every row sums to one, the world stays put
  const c2 = meshCtx(r.json, sd.name)
  let mw = MeshEdit.toWeighted(MeshEdit.fromAttachment(c2.json, c2.world, { width: c2.json.width, height: c2.json.height }), c2.slotBone)
  const other = c2.slotBone === 0 ? 1 : 0
  mw = MeshEdit.paintWeights(mw, mw.points.map((_, i) => [i, i % 2 ? 1 : 0.5]), other, 'add', 0.6)
  for (const p of mw.points) assert(near(p.w.reduce((a, [, x]) => a + x, 0), 1, 1e-6), 'sum 1')
  assert(mw.points.some((p) => p.w.length === 2), 'two bones on some vertices')
  mw = MeshEdit.smoothWeights(mw)
  mw = MeshEdit.pruneWeights(mw, 0.05)
  for (const p of mw.points) assert(near(p.w.reduce((a, [, x]) => a + x, 0), 1, 1e-6), 'sum 1 after smooth / prune')
  r = Ops.setMesh(r.json, 'default', sd.name, c.name, MeshEdit.toAttachment(mw, c2.mats, c2.slotBone), MeshEdit.remapOf(mw))
  const w1 = worldOfSlot(r.json, sd.name)
  for (let i = 0; i < w1.length; i++) assert(near(w1[i], c2.world[i], 0.05), 'weighted mesh keeps its place ' + i)
  // the production solver gives heat weights for these vertices
  const V = Array.from(c2.world), bones = [c2.mats[c2.slotBone], c2.mats[other]].map((m) => ({ ax: m.worldX, ay: m.worldY, bx: m.worldX + 30 * m.a, by: m.worldY + 30 * m.c }))
  const hw = AW.heatWeights(V, Array.from(c2.json.triangles), bones)
  assert.strictEqual(hw.weights.length, V.length / 2 * 2)
})

test('draw order: keys play back, a setup reorder keeps the keyed orders', () => {
  const an = Object.keys(wild.animations)[0]
  const setup = wild.slots.map((s) => s.name)
  // key: the first slot drawn on top, the last two swapped
  const order = setup.slice(1)
  order.push(setup[0])
  const n = order.length; [order[n - 2], order[n - 3]] = [order[n - 3], order[n - 2]]
  let r = Ops.keyDrawOrder(wild, an, 0.2, order)
  const sk = load(r.json)
  pose(sk, an, 0.2 + 1e-3)
  assert.deepStrictEqual(sk.drawOrder.map((s) => s.data.name), order, 'the runtime draws the keyed order')
  // a key back to the setup order carries no offsets
  r = Ops.keyDrawOrder(r.json, an, 0.4, setup)
  assert(!r.json.animations[an].drawOrder.find((k) => Math.abs((k.time || 0) - 0.4) < 1e-4).offsets)
  // reorder the setup: the keyed order at 0.2 is still the same picture
  const newSetup = setup.slice().reverse()
  r = Ops.reorderSlots(r.json, newSetup)
  assert.deepStrictEqual(r.json.slots.map((s) => s.name), newSetup)
  const sk2 = load(r.json)
  pose(sk2, an, 0.2 + 1e-3)
  assert.deepStrictEqual(sk2.drawOrder.map((s) => s.data.name), order, 'keys rewritten for the new setup order')
  pose(sk2, an, 0.4 + 1e-3)
  assert.deepStrictEqual(sk2.drawOrder.map((s) => s.data.name), setup, 'the 0.4 key still shows the old setup order')
  // encode / decode agree on a random shuffle
  const shuf = setup.slice().sort(() => 0.5 - Math.sin(setup.length))
  assert.deepStrictEqual(Ops.decodeDrawOrder(setup, Ops.encodeDrawOrder(setup, shuf)), shuf)
})

test('权重: removing a bone hands its weight to the others; counts per bone', () => {
  const pts = [
    { u: 0, v: 0, x: 0, y: 0, w: [[1, 0.5], [2, 0.5]], src: 0 },
    { u: 1, v: 0, x: 1, y: 0, w: [[2, 1]], src: 1 },
    { u: 0, v: 1, x: 0, y: 1, w: [[1, 0.25], [3, 0.75]], src: 2 },
  ]
  const model = { width: 1, height: 1, hull: 3, points: pts, tris: [0, 1, 2], weighted: true }
  assert.deepStrictEqual([...MeshEdit.boneCounts(model).entries()].sort(), [[1, 2], [2, 2], [3, 1]])
  const m = MeshEdit.removeBone(model, 2, 9)
  assert.deepStrictEqual(m.points[0].w, [[1, 1]])
  assert.deepStrictEqual(m.points[1].w, [[9, 1]], 'only that bone: onto the fallback')
  assert.deepStrictEqual(m.points[2].w, [[1, 0.25], [3, 0.75]], 'untouched')
  // 替换 sets the weight to the value; the rest keeps its ratio
  const r = MeshEdit.paintWeights(model, [[2, 1]], 1, 'set', 0.5)
  assert(near(r.points[2].w.find(([b]) => b === 1)[1], 0.5, 1e-9)); assert(near(r.points[2].w.find(([b]) => b === 3)[1], 0.5, 1e-9))
})

// ------------------------------------------------------------------ jiaye (user template)
if (jiaye) {
  const anim = Object.keys(jiaye.animations || {})[0]
  test('jiaye loads', () => { load(jiaye) })
  test('jiaye: duplicate every top-level branch under root with animation, poses match', () => {
    const j = Ops.prepare(jiaye)
    const tops = j.bones.filter((b) => b.parent === j.bones[0].name).slice(0, 3)
    let json = jiaye
    const pairs = []
    for (const b of tops) {
      const r = Ops.duplicateBone(json, b.name)
      json = r.json
      pairs.push([Ops.branch(j, b.name), r.bones])
    }
    const sk = load(json)
    for (const t of [0, 0.5, 1.1]) {
      pose(sk, anim, t)
      for (const [orig, copies] of pairs) orig.forEach((n, i) => sameWorld(sk.findBone(n), sk.findBone(copies[i]), `${n} t=${t}`))
    }
  })
  test('jiaye: copying an arm branch brings the weighted arm mesh, bound to the copied bones', () => {
    const j = Ops.prepare(jiaye)
    const r = Ops.duplicateBone(jiaye, 'Upper_arm_l')
    assert(r.slots.includes('arm_r2') || r.slots.some((s) => s.startsWith('arm_r')), 'arm slot copied: ' + r.slots)
    const copySlot = r.slots.find((s) => s.startsWith('arm_r'))
    // move the copied arm: the copy mesh must follow, the original must not
    const ub = j.bones.find((b) => b.name === 'Upper_arm_l')
    const moved = Ops.setBoneProps(r.json, r.bone, { x: (ub.x || 0) + 60 })
    const sk = load(moved.json)
    for (const t of [0, 0.6]) {
      pose(sk, anim, t)
      const a = sk.findSlot('arm_r'), b = sk.findSlot(copySlot)
      const n = a.getAttachment().worldVerticesLength
      const v1 = new Float32Array(n), v2 = new Float32Array(n)
      a.getAttachment().computeWorldVertices(a, 0, n, v1, 0, 2)
      b.getAttachment().computeWorldVertices(b, 0, n, v2, 0, 2)
      let maxd = 0
      for (let i = 0; i < n; i++) maxd = Math.max(maxd, Math.abs(v1[i] - v2[i]))
      assert(maxd > 20, 'copy mesh follows the rotated copy arm, max diff ' + maxd)
    }
    // the arm IK target was copied too: moving it moves only the copy arm
    assert(r.bones.includes('arm5') || r.bones.some((b) => b.startsWith('arm')), 'ik target copied: ' + r.bones.slice(-3))
    const tgtCopy = r.json.ik.find((c) => c.bones[0] === r.bone).target
    assert.notStrictEqual(tgtCopy, 'arm3')
    const sk3 = load(Ops.setBoneProps(r.json, tgtCopy, { x: (r.json.bones.find((b) => b.name === tgtCopy).x || 0) + 80 }).json)
    const base3 = load(r.json)
    pose(sk3, null); pose(base3, null)
    sameWorld(sk3.findBone('Upper_arm_l'), base3.findBone('Upper_arm_l'), 'original arm untouched')
    assert(Math.abs(sk3.findBone(r.bone).a - base3.findBone(r.bone).a) > 0.01, 'copy arm follows its own target')
    // unrotated: identical
    const sk2 = load(r.json)
    pose(sk2, anim, 0.6)
    const a = sk2.findSlot('arm_r'), b = sk2.findSlot(copySlot)
    const n = a.getAttachment().worldVerticesLength
    const v1 = new Float32Array(n), v2 = new Float32Array(n)
    a.getAttachment().computeWorldVertices(a, 0, n, v1, 0, 2)
    b.getAttachment().computeWorldVertices(b, 0, n, v2, 0, 2)
    for (let i = 0; i < n; i++) assert(near(v1[i], v2[i], 0.01))
  })
  test('jiaye: the artist order is already right; a scrambled order comes back to the same poses', () => {
    assert.strictEqual(Ops.autoOrderConstraints(jiaye).changed, 0)
    const j = Ops.prepare(jiaye)
    const all = []
    for (const k of ['ik', 'transform', 'path']) for (const c of j[k] || []) all.push(c)
    all.sort((a, b) => (a.order || 0) - (b.order || 0))
    const artist = new Map(all.map((c, i) => [c, i]))
    // scramble (reverse), but constraints driving the same bone keep their order: only the user knows that one
    const order = all.slice().reverse()
    for (let i = 0; i < order.length; i++) {
      for (let k = i + 1; k < order.length; k++) {
        if (order[i].bones.some((b) => order[k].bones.includes(b)) && artist.get(order[i]) > artist.get(order[k])) {
          const t = order[i]; order[i] = order[k]; order[k] = t
        }
      }
    }
    order.forEach((c, i) => { c.order = i })
    const scrambled = load(j)
    const fixed = Ops.autoOrderConstraints(j)
    assert(fixed.changed > 10 && !fixed.cycles.length)
    const good = load(jiaye), sk = load(fixed.json)
    let worst = 0
    for (const t of [0, 0.4, 1.1]) {
      pose(good, anim, t); pose(sk, anim, t); pose(scrambled, anim, t)
      for (const b of good.bones) sameWorld(b, sk.findBone(b.data.name), `${b.data.name} t=${t}`)
      for (const b of good.bones) worst = Math.max(worst, Math.hypot(b.worldX - scrambled.findBone(b.data.name).worldX, b.worldY - scrambled.findBone(b.data.name).worldY))
    }
    assert(worst > 1, 'the scrambled order really breaks the pose (' + worst.toFixed(1) + ' px)')
  })
  test('jiaye: keyDeform moves an unweighted mesh vertex exactly', () => {
    const j = Ops.prepare(jiaye)
    const slot = j.slots.find((s) => s.attachment && j.skins.some((sk) => { const a = sk.attachments[s.name] && sk.attachments[s.name][s.attachment]; return a && a.type === 'mesh' && !Ops.isWeighted(a) }))
    if (!slot) return
    const { before, after } = deformMove(jiaye, anim, slot.name, 0.4, -6, 12)
    assert(near(after[0], before[0] - 6, 0.05) && near(after[1], before[1] + 12, 0.05), `v0 moved ${after[0] - before[0]},${after[1] - before[1]}`)
  })
  test('jiaye: weighted-mesh slot copy deforms identically', () => {
    const j = Ops.prepare(jiaye)
    const meshSlot = j.slots.find((s) => j.skins.some((sk) => Ops.isWeighted(sk.attachments[s.name]?.[s.attachment])))
    if (!meshSlot) return
    const r = Ops.duplicateSlot(jiaye, meshSlot.name)
    const sk = load(r.json)
    pose(sk, anim, 0.7)
    const a = sk.findSlot(meshSlot.name), b = sk.findSlot(r.slot)
    const n = a.getAttachment().worldVerticesLength
    const v1 = new Float32Array(n), v2 = new Float32Array(n)
    a.getAttachment().computeWorldVertices(a, 0, n, v1, 0, 2)
    b.getAttachment().computeWorldVertices(b, 0, n, v2, 0, 2)
    for (let i = 0; i < n; i++) assert(near(v1[i], v2[i], 0.01))
  })
} else {
  console.log('(skip jiaye: samples/jiaye/a.json not present)')
}

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`)
