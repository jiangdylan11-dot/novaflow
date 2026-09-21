const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..', '..')

// particle-editor is an ESM package, so `require` runs the script but its exports
// land on globalThis -- the same way the browser <script> path publishes it.
require(path.join(root, 'particle-editor', 'spine-auto-mesh-core.js'))
require(path.join(root, 'particle-editor', 'spine-auto-bones.js'))
const AB = globalThis.NovaFlowAutoBones

// ------------------------------------------------------------- fixtures ---

/** Solid RGBA layer from shapes: capsules {x0,y0,x1,y1,r} and ellipses {cx,cy,rx,ry}. */
function paint(w, h, shapes) {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = false
      for (const s of shapes) {
        if (s.rx !== undefined) { const dx = (x + 0.5 - s.cx) / s.rx, dy = (y + 0.5 - s.cy) / s.ry; if (dx * dx + dy * dy <= 1) { on = true; break } }
        else {
          const dx = s.x1 - s.x0, dy = s.y1 - s.y0, l2 = dx * dx + dy * dy
          let t = l2 > 0 ? ((x + 0.5 - s.x0) * dx + (y + 0.5 - s.y0) * dy) / l2 : 0
          t = Math.max(0, Math.min(1, t))
          if (Math.hypot(x + 0.5 - (s.x0 + t * dx), y + 0.5 - (s.y0 + t * dy)) <= s.r) { on = true; break }
        }
      }
      if (!on) continue
      const o = 4 * (y * w + x)
      rgba[o] = 200; rgba[o + 1] = 150; rgba[o + 2] = 120; rgba[o + 3] = 255
    }
  }
  return rgba
}
// a stick figure in three layers: torso (with neck stub), one bent arm, one straight leg
const W = 300, H = 400
const body = { name: 'body', width: W, height: H, rgba: paint(W, H, [{ x0: 150, y0: 80, x1: 150, y1: 220, r: 40 }, { x0: 150, y0: 60, x1: 150, y1: 85, r: 14 }]), place: { x: 0, y: 0 } }
const arm = { name: 'arm_l', width: W, height: H, rgba: paint(W, H, [{ x0: 185, y0: 100, x1: 250, y1: 160, r: 16 }, { x0: 250, y0: 160, x1: 235, y1: 240, r: 14 }]), place: { x: 0, y: 0 } }
const leg = { name: 'leg_l', width: W, height: H, rgba: paint(W, H, [{ x0: 165, y0: 215, x1: 175, y1: 370, r: 20 }]), place: { x: 0, y: 0 } }
const face = { name: 'face', width: W, height: H, rgba: paint(W, H, [{ cx: 150, cy: 35, rx: 30, ry: 32 }]), place: { x: 0, y: 0 } }

// ------------------------------------------------------------- analysis ---

test('the module publishes itself on globalThis and reads the studio layer names', () => {
  assert.equal(typeof AB.buildSkeleton, 'function')
  assert.deepEqual(AB.nameHint('hair_back'), { part: 'hair', side: null })
  assert.deepEqual(AB.nameHint('arm_l'), { part: 'arm', side: 'l' })
  assert.equal(AB.nameHint('zuodatui').part, 'leg')
  assert.equal(AB.nameHint('faec').part, 'face')
  assert.equal(AB.nameHint('toufa_1').part, 'hair')
  assert.equal(AB.nameHint('part3').part, null)
})

test('a bent capsule thins to one axis with the bend as a corner and the tips reaching the ends', () => {
  const a = AB.analyzeLayer(arm.rgba, W, H, {})
  assert.ok(a && a.graph.edges.length >= 1, 'one branch expected')
  const leaves = a.graph.nodes.filter((n) => n.deg === 1)
  assert.equal(leaves.length, 2, 'two ends')
  // the corner near the elbow (250,160) survives Douglas-Peucker
  const poly = a.graph.edges.flatMap((e) => e.poly)
  let best = Infinity
  for (let i = 0; i < poly.length; i += 2) best = Math.min(best, Math.hypot(poly[i] - 250, poly[i + 1] - 160))
  assert.ok(best < 14, `elbow corner missing (nearest polyline point ${best.toFixed(1)} px away)`)
  // radius estimate close to the capsule radius
  assert.ok(Math.abs(a.graph.edges[0].rMean - 15) < 6, `radius ${a.graph.edges[0].rMean}`)
})

test('spur pruning removes bumps but keeps real branches', () => {
  // a bar with a small bump (spur) and a long branch
  const rgba = paint(W, H, [{ x0: 40, y0: 200, x1: 260, y1: 200, r: 18 }, { x0: 120, y0: 200, x1: 120, y1: 214, r: 12 }, { x0: 200, y0: 200, x1: 200, y1: 320, r: 12 }])
  const a = AB.analyzeLayer(rgba, W, H, {})
  const leaves = a.graph.nodes.filter((n) => n.deg === 1).length
  assert.equal(leaves, 3, `bar ends + long branch = 3 leaves, got ${leaves}`)
})

// ------------------------------------------------------------- skeleton ---

test('a three-layer stick figure gets a trunk, a head, a limb chain with IK and a leg from the hips', () => {
  const built = AB.buildSkeleton([body, arm, leg, face], {})
  const names = built.bones.map((b) => b.name)
  // the template's trunk: root → y → x (hips) → abdomen → waist (target) → chest → neck → head
  for (const n of ['root', 'y', 'x', 'abdomen', 'waist', 'chest', 'neck', 'head']) assert.ok(names.includes(n), `missing ${n}`)
  const byName = new Map(built.bones.map((b) => [b.name, b]))
  assert.equal(byName.get('x').parent, 'y'); assert.equal(byName.get('y').parent, 'root')
  // the trunk runs upward and the head sits above the neck
  assert.ok(byName.get('chest').by > byName.get('waist').ay, 'chest above waist')
  assert.ok(byName.get('head').by > byName.get('neck').by, 'head above neck')
  // the arm hangs from a shoulder connector on the trunk and bends: two bones + IK
  const armBones = built.bones.filter((b) => b.layer === 'arm_l' && b.kind === 'bone')
  assert.ok(armBones.length >= 2, `arm needs >= 2 bones, got ${armBones.length}`)
  assert.ok(built.json.ik.some((c) => c.bones[0] === armBones[0].name), 'IK on the arm chain')
  // the studio mechanism: upper bone under a pivot, the pivot under the waist pivot / a body bone,
  // a stretchy single-bone IK per bone, a hidden helper chain and a joint target that follows it
  const armPivot = byName.get(armBones[0].parent)
  assert.equal(armPivot.kind, 'pivot', 'arm hangs from a pivot')
  assert.equal(byName.get(armPivot.parent).layer, 'body', 'the arm pivot hangs from the body')
  assert.ok(built.json.ik.some((c) => c.name === 'arm1' && c.target === 'arm1' && c.stretch && c.compress), 'stretchy upper-arm IK, named after its target')
  assert.ok(built.json.ik.some((c) => c.name === 'arm2' && c.target === 'arm2' && c.stretch), 'stretchy forearm IK')
  // the template's names: the only arm is arm 'r' (image side): jian1 pivot, Upper_arm_r /
  // forearm_r, elbow target arm1, wrist target arm2, helper chain jian3 → jian4
  assert.equal(armPivot.name, 'jian1'); assert.equal(armBones[0].name, 'Upper_arm_r'); assert.equal(armBones[1].name, 'forearm_r')
  assert.ok(built.json.ik.some((c) => c.name === 'arm2a' && c.bones.length === 2 && c.target === 'arm2'), 'two-bone helper IK on the wrist target, named target + a')
  const follow = built.json.transform.find((c) => c.name === 'jian4')
  assert.ok(follow && follow.target === 'jian4' && follow.translateMix === 0.6, 'the elbow target follows the helper knee at 0.6')
  const helper1 = byName.get('jian3'), helper2 = byName.get('jian4')
  assert.ok(helper1.len > armBones[0].len * 1.05 && helper2.len > byName.get(armBones[1].name).len * 1.05, 'the helper chain is longer than the arm')
  // constraint order inside a limb: helper IK → joint follow → upper IK → lower IK
  const ord = (n) => (built.json.ik.find((c) => c.name === n) || built.json.transform.find((c) => c.name === n)).order
  assert.ok(ord('arm2a') < ord('jian4') && ord('jian4') < ord('arm1') && ord('arm1') < ord('arm2'), 'limb constraint order: helper, follow, upper, lower')
  // the template parents the arm targets to the shoulder pivot
  const boneOf = (n) => built.json.bones.find((b) => b.name === n)
  assert.equal(boneOf('arm1').parent, 'jian1'); assert.equal(boneOf('arm2').parent, 'jian1')
  // the leg hangs from the hips through a hip connector and a pivot; its shin under the knee target
  const legBones = built.bones.filter((b) => b.layer === 'leg_l' && b.kind === 'bone')
  assert.ok(legBones.length >= 2)
  const legPivot = byName.get(legBones[0].parent)
  assert.equal(legPivot.kind, 'pivot')
  assert.equal(legPivot.name, 'kua1'); assert.equal(legPivot.parent, 'x', 'the leg pivot hangs from the hips (x)')
  assert.equal(legBones[0].name, 'leg_r'); assert.equal(legBones[1].name, 'lowerLeg_r')
  assert.equal(byName.get(legBones[1].name).parent, 'leg1', 'the shin hangs under the knee target')
  assert.ok(byName.get('hip_r') && byName.get('hip_r').parent === 'x', 'a hip bone from x to the pivot')
  // trunk: abdomen stretched to a root-level waist pivot that follows the hips half-way
  assert.ok(built.json.ik.some((c) => c.name === 'yao' && c.bones[0] === 'abdomen' && c.target === 'waist'))
  assert.ok(built.json.transform.some((c) => c.name === 'x' && c.bones[0] === 'waist' && c.target === 'x' && c.translateMix === 0.5))
  // sliders and face controllers
  for (const n of ['body_up_turn', 'body_down_turn', 'face_turn', 'face_turn_back']) assert.ok(names.includes(n), `missing slider ${n}`)
  assert.ok(built.json.transform.some((c) => c.name === 'all' && c.bones[0] === 'face_turn_back' && c.translateMix === -1))
  assert.equal(built.plan.layers.leg_l.parent, 'body')
  assert.equal(built.plan.layers.face.role, 'head')
  // every slot is bound to one of its own bones (the face to the head)
  assert.equal(built.slotBone.face, 'head')
  assert.equal(byName.get(built.slotBone.arm_l).layer, 'arm_l')
})

test('the Spine JSON is a valid tree in local coordinates and round-trips the world positions', () => {
  const built = AB.buildSkeleton([body, arm, leg, face], {})
  const json = built.json.bones
  const index = new Map(json.map((b, i) => [b.name, i]))
  const world = []
  json.forEach((b, i) => {
    if (i === 0) { assert.equal(b.parent, undefined); world.push({ x: 0, y: 0, rot: 0 }); return }
    assert.ok(index.has(b.parent) && index.get(b.parent) < i, `${b.name}: parent must precede it`)
    for (const k of ['x', 'y', 'rotation', 'length']) if (b[k] !== undefined) assert.ok(Number.isFinite(b[k]), `${b.name}.${k}`)
    const p = world[index.get(b.parent)]
    const rot = p.rot + (b.rotation || 0) * Math.PI / 180
    const c = Math.cos(p.rot), s = Math.sin(p.rot)
    world.push({ x: p.x + c * (b.x || 0) - s * (b.y || 0), y: p.y + s * (b.x || 0) + c * (b.y || 0), rot })
  })
  built.bones.forEach((b, i) => {
    assert.ok(Math.hypot(world[i].x - b.ax, world[i].y - b.ay) < 0.05, `${b.name} origin drifts`)
    if (b.len > 0) {
      const tx = world[i].x + Math.cos(world[i].rot) * b.len, ty = world[i].y + Math.sin(world[i].rot) * b.len
      assert.ok(Math.hypot(tx - b.bx, ty - b.by) < 0.05, `${b.name} tip drifts`)
    }
  })
  for (const c of built.json.ik) { assert.ok(index.has(c.target)); for (const n of c.bones) assert.ok(index.has(n)) }
})

test('applyToSkeleton rebinds the PS export slots and keeps region attachments where they were', () => {
  const ps = { bones: [{ name: 'root' }], slots: [{ name: 'body', bone: 'root', attachment: 'body' }, { name: 'arm_l', bone: 'root', attachment: 'arm_l' }, { name: 'leg_l', bone: 'root', attachment: 'leg_l' }, { name: 'face', bone: 'root', attachment: 'face' }], skins: { default: { body: { body: { x: 0, y: 0, width: W, height: H } }, arm_l: { arm_l: { x: 0, y: 0, width: W, height: H } }, leg_l: { leg_l: { x: 0, y: 0, width: W, height: H } }, face: { face: { x: 0, y: 0, width: W, height: H } } } } }
  const built = AB.buildSkeleton([body, arm, leg, face], {})
  const out = AB.applyToSkeleton(ps, built)
  assert.equal(out.bones.length, built.bones.length)
  const byName = new Map(built.bones.map((b) => [b.name, b]))
  const index = new Map(built.json.bones.map((b, i) => [b.name, i]))
  for (const slot of out.slots) {
    assert.equal(slot.bone, built.slotBone[slot.name])
    const att = out.skins.default[slot.name][slot.attachment]
    // the attachment centre, mapped through the bone, must land back at the PS placement (0,0)
    const b = byName.get(slot.bone)
    let rot = 0, k = index.get(slot.bone)
    while (k !== undefined && k >= 0) { const jb = built.json.bones[k]; rot += (jb.rotation || 0); k = jb.parent !== undefined ? index.get(jb.parent) : -1 }
    const r = rot * Math.PI / 180
    const wx = b.ax + Math.cos(r) * att.x - Math.sin(r) * att.y, wy = b.ay + Math.sin(r) * att.x + Math.cos(r) * att.y
    assert.ok(Math.hypot(wx, wy) < 0.05, `${slot.name} attachment drifted to (${wx.toFixed(2)}, ${wy.toFixed(2)})`)
  }
  assert.ok(Array.isArray(out.ik) && out.ik.length >= 1)
})

test('the simple style is still available: plain two-bone IK, no pivots or helpers', () => {
  const built = AB.buildSkeleton([body, arm, leg, face], { rigStyle: 'simple' })
  assert.ok(!built.bones.some((b) => b.kind === 'helper' || b.kind === 'slider'))
  assert.ok(built.json.ik.some((c) => c.bones.length === 2 && c.bones[0] === 'arm_l_1'))
  assert.equal(built.json.transform.length, 0)
})

test('with names switched off the same figure is still a trunk with limbs (geometry alone)', () => {
  const built = AB.buildSkeleton([body, arm, leg, face], { names: false })
  const names = built.bones.map((b) => b.name)
  for (const n of ['x', 'waist', 'chest', 'neck']) assert.ok(names.includes(n))
  const armBones = built.bones.filter((b) => b.layer === 'arm_l' && b.kind === 'bone')
  const legBones = built.bones.filter((b) => b.layer === 'leg_l' && b.kind === 'bone')
  assert.ok(armBones.length >= 2 && legBones.length >= 2)
  assert.equal(built.plan.layers.leg_l.role, 'limb', 'a part standing on the ground is a leg')
})
