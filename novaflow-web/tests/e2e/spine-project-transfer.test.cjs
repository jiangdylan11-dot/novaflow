const test = require('node:test'), assert = require('node:assert/strict')
require('../../renderer/spine-structure.ops.js')
require('../../renderer/spine-project-transfer.js')
const T = globalThis.NovaFlowSpineProjectTransfer, Ops = globalThis.NovaFlowSpineStructureOps
const source = () => ({ skeleton: { spine: '3.8.99' }, bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 10 }, { name: 'hand', parent: 'arm', x: 20 }],
  slots: [{ name: 'art', bone: 'arm', attachment: 'pic' }], skins: [{ name: 'default', attachments: { art: { pic: { path: 'picture', width: 8, height: 8 } } } }],
  animations: { source: { bones: { arm: { rotate: [{ angle: 30 }, { time: 1, angle: 40 }] } } } } })
const target = () => ({ skeleton: { spine: '3.8.99' }, bones: [{ name: 'root' }, { name: 'arm', parent: 'root' }],
  slots: [{ name: 'art', bone: 'arm', attachment: 'pic' }], skins: [{ name: 'default', attachments: { art: { pic: { path: 'picture', width: 4, height: 4 } } } }], animations: { target: { bones: { arm: { rotate: [{ angle: 8 }] } } } } })
test('copies a branch with its slots and skin attachments, protects destination names and leaves animations unchanged', () => {
  const s = source(), d = target(), before = JSON.stringify([s, d])
  const r = T.transfer(s, d, ['arm'], { parent: 'root' })
  assert.deepEqual(r.bones, ['arm_2', 'hand'])
  assert.equal(r.json.bones.find(b => b.name === 'hand').parent, 'arm_2')
  assert.equal(r.json.slots.find(s => s.name === 'art_2').bone, 'arm_2')
  assert.equal(r.json.skins[0].attachments.art_2.pic.path, 'picture_2')
  assert.deepEqual(r.json.animations, d.animations)
  assert.equal(JSON.stringify([s, d]), before)
})
test('weighted meshes bring external influencing bones and remap every index to the destination skeleton', () => {
  const s = source(), att = s.skins[0].attachments.art.pic
  s.slots[0].bone = 'root'
  Object.assign(att, { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], hull: 3,
    vertices: [2,1,0,0,.8,0,0,0,.2, 2,1,8,0,.8,0,8,0,.2, 2,1,8,8,.8,0,8,8,.2] })
  const r = T.transfer(s, target(), ['arm'])
  assert(r.bones.includes('root_2'))
  const copied = r.json.skins[0].attachments.art_2.pic, names = [...Ops.weightBones(copied)].map(i => r.json.bones[i].name).sort()
  assert.deepEqual(names, ['arm_2', 'root_2'])
})
test('keeps internal constraints and remaps clipping endpoints without dangling references', () => {
  const s = source(); s.ik = [{ name: 'ik', target: 'hand', bones: ['arm'], order: 0 }]
  s.slots.unshift({ name: 'clip', bone: 'arm', attachment: 'clip' })
  s.skins[0].attachments.clip = { clip: { type: 'clipping', end: 'art', vertexCount: 3, vertices: [0,0,8,0,8,8] } }
  const r = T.transfer(s, target(), ['arm'])
  assert.equal(r.json.ik[0].target, 'hand')
  assert.equal(r.json.ik[0].bones[0], 'arm_2')
  assert.equal(r.json.skins[0].attachments.clip.clip.end, 'art_2')
})
test('external constraints are omitted explicitly and setup world positions can be retained under a new parent', () => {
  const s = source(); s.ik = [{ name: 'outside', bones: ['arm'], target: 'root' }]
  const r = T.transfer(s, target(), ['arm'], { parent: 'arm', sourceMatrices: { arm: { a:1,b:0,c:0,d:1,worldX:30,worldY:20 } }, parentMatrix: { a:1,b:0,c:0,d:1,worldX:10,worldY:5 } })
  assert.equal(r.skippedConstraints, 1)
  assert.equal(r.json.bones.find(b => b.name === 'arm_2').x, 20)
  assert.equal(r.json.bones.find(b => b.name === 'arm_2').y, 15)
})
test('unused files already in the destination folder also reserve image names', () => {
  const r = T.transfer(source(), target(), ['arm'], { imageNames: ['picture_2', 'picture_3'] })
  assert.deepEqual(r.images, [{ from: 'picture', to: 'picture_4' }])
})
