// 自动架设's figure pass (renderer/spine-auto-pose.js): a character whose limbs share layers is
// rigged from the body joints; an artist's split (one layer per limb) is left to the builder.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const R = path.join(__dirname, '..', '..', 'renderer')
require(path.join(R, 'spine-auto-mesh-core.js'))
require(path.join(R, 'spine-auto-weights.js'))
require(path.join(R, 'spine-auto-bones.js'))
require(path.join(R, 'spine-auto-pose.js'))
const AP = globalThis.NovaFlowAutoPose

// a standing figure, world coordinates (y up): 17 body points then the two big toes
const J = { nose: [0, 560], lSh: [50, 480], rSh: [-50, 480], lEl: [70, 380], rEl: [-70, 380], lWr: [80, 290], rWr: [-80, 290], lHip: [30, 300], rHip: [-30, 300], lKn: [35, 160], rKn: [-35, 160], lAn: [38, 30], rAn: [-38, 30], lToe: [70, 10], rToe: [-70, 10] }
const KPS = [J.nose, [10, 570], [-10, 570], [25, 560], [-25, 560], J.lSh, J.rSh, J.lEl, J.rEl, J.lWr, J.rWr, J.lHip, J.rHip, J.lKn, J.rKn, J.lAn, J.rAn, J.lToe, J.rToe].map((p) => [p[0], p[1], 0.8])

const cap = (name, pts, r) => AP.capsuleLayer(name, pts, pts.map(() => r), null)
/** One picture holding several capsules. */
function picture(name, shapes) {
  const parts = shapes.map(([pts, r]) => cap(name, pts, r))
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of parts) { x0 = Math.min(x0, p.place.x - p.width / 2); x1 = Math.max(x1, p.place.x + p.width / 2); y0 = Math.min(y0, p.place.y - p.height / 2); y1 = Math.max(y1, p.place.y + p.height / 2) }
  const w = Math.ceil(x1 - x0), h = Math.ceil(y1 - y0), rgba = new Uint8ClampedArray(w * h * 4)
  for (const p of parts) {
    const ox = Math.round(p.place.x - p.width / 2 - x0), oy = Math.round(y1 - (p.place.y + p.height / 2))
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (p.rgba[(y * p.width + x) * 4 + 3]) { const q = ((y + oy) * w + x + ox) * 4; rgba[q] = rgba[q + 1] = rgba[q + 2] = 180; rgba[q + 3] = 255 }
  }
  return { name, att: name, width: w, height: h, rgba, place: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } }
}
const TORSO = [[[0, 290], [0, 490]], 55], HEAD = [[[0, 540], [0, 580]], 38]
const ARM_L = [[J.lSh, J.lEl, J.lWr], 16], ARM_R = [[J.rSh, J.rEl, J.rWr], 16]
const LEG_L = [[J.lHip, J.lKn, J.lAn, J.lToe], 20], LEG_R = [[J.rHip, J.rKn, J.rAn, J.rToe], 20]

test('a clothing split: both legs in one layer are rigged from the joints', () => {
  const layers = [picture('legwear', [LEG_L, LEG_R]), picture('topwear', [TORSO, ARM_L, ARM_R]), picture('face', [HEAD])]
  const built = AP.buildSkeleton(layers, KPS)
  assert.ok(built.figure, 'the figure pass ran')
  assert.deepEqual(Object.keys(built.figure.covered).sort(), ['legwear', 'topwear'])
  const bone = (n) => built.bones.find((b) => b.name === n)
  // knees and elbows sit on the joints, not at the middle of a layer's axis
  const near = (b, end, p, tol) => assert.ok(Math.hypot(b[end + 'x'] - p[0], b[end + 'y'] - p[1]) <= tol, `${b.name} ${end} at ${Math.round(b[end + 'x'])},${Math.round(b[end + 'y'])}, wanted ${p}`)
  const shins = built.bones.filter((b) => /^lowerLeg_/.test(b.name)), fore = built.bones.filter((b) => /^forearm_/.test(b.name))
  assert.equal(shins.length, 2); assert.equal(fore.length, 2)
  for (const s of shins) near(s, 'a', s.ax > 0 ? J.lKn : J.rKn, 12)
  for (const f of fore) near(f, 'a', f.ax > 0 ? J.lEl : J.rEl, 12)
  // every covered picture stays on the root and is bound to the part bones it carries
  for (const name of ['legwear', 'topwear']) { assert.equal(built.slotBone[name], built.bones[0].name); assert.ok(built.figure.covered[name].length >= 4) }
  assert.ok(built.figure.covered.legwear.some((n) => /^lowerLeg_/.test(n)) && !built.figure.covered.legwear.some((n) => /^forearm_/.test(n)))
  assert.ok(!built.bones.some((b) => /^(arm|leg|shin|forearm|hand|foot)_[lr]$/.test(b.layer || '') && !bone(b.name)))
  // no slot is made for the part layers
  for (const k of Object.keys(built.slotBone)) assert.ok(!/^(body|arm_|forearm_|hand_|leg_|shin_|foot_)/.test(k) || layers.some((l) => l.name === k), k)
})

test('the whole character as one picture', () => {
  const built = AP.buildSkeleton([picture('art', [TORSO, HEAD, ARM_L, ARM_R, LEG_L, LEG_R])], KPS)
  assert.ok(built.figure && built.figure.covered.art.length >= 10)
})

test("an artist's split (a layer per limb) is left to the builder", () => {
  const layers = [picture('p1', [LEG_L]), picture('p2', [LEG_R]), picture('p3', [TORSO]), picture('p4', [ARM_L]), picture('p5', [ARM_R]), picture('p6', [HEAD])]
  assert.equal(AP.figureLayers(layers, KPS), null)
})

test('not a figure (weak shoulders and hips): no figure pass', () => {
  const weak = KPS.map((p) => [p[0], p[1], 0.2])
  assert.equal(AP.figureLayers([picture('art', [TORSO, HEAD, LEG_L, LEG_R])], weak), null)
})

test('cloth hanging off the figure inside a covered layer gets a chain of its own', () => {
  const FLAP = [[[95, 300], [190, 200], [240, 60]], 18]   // a coat tail swinging out from the hip
  const layers = [picture('legwear', [LEG_L, LEG_R]), picture('topwear', [TORSO, ARM_L, ARM_R, FLAP]), picture('face', [HEAD])]
  const built = AP.buildSkeleton(layers, KPS)
  const chain = built.bones.filter((b) => /^topwear~/.test(b.layer || '') && b.kind === 'bone')
  assert.ok(chain.length >= 2, 'the flap has a chain')
  // it starts at its upper end, where it leaves the body, and runs down
  assert.ok(chain[0].ay > chain[chain.length - 1].by)
  for (const b of chain) assert.ok(built.figure.covered.topwear.includes(b.name))
  assert.ok(!Object.keys(built.slotBone).some((k) => k.includes('~')))
})
