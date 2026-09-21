const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..', '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const CORE = 'spine-auto-mesh-core.js'
const BONES = 'spine-auto-bones.js'
const EDITOR = 'spine-bones.editor.js'
const PANEL = 'spine-auto-mesh.panel.js'
const WEIGHTS = 'spine-auto-weights.js'
const CACHE_BUSTER = '20260921-auto-mesh-48'

// particle-editor is an ESM package: `require` runs the scripts and their exports land on globalThis
require(path.join(root, 'particle-editor', CORE))
require(path.join(root, 'particle-editor', WEIGHTS))
require(path.join(root, 'particle-editor', BONES))
require(path.join(root, 'particle-editor', EDITOR))
const E = globalThis.NovaFlowBonesEditor
const AB = globalThis.NovaFlowAutoBones
const AW = globalThis.NovaFlowAutoWeights

// ---------------------------------------------------------------- wiring ---

test('the auto skeleton and the bone editor are wired into index.html in dependency order', () => {
  const html = read('particle-editor/index.html')
  for (const file of [BONES, EDITOR]) assert.ok(html.includes(`./${file}?v=${CACHE_BUSTER}`), `${file} missing or stale in index.html`)
  assert.ok(html.indexOf(`./${CORE}?v=`) < html.indexOf(`./${BONES}?v=`), 'the core must load before the auto skeleton')
  assert.ok(html.indexOf(`./${EDITOR}?v=`) < html.indexOf(`./${PANEL}?v=`), 'the editor must load before the panel that opens it')
  assert.ok(html.indexOf(`./${BONES}?v=`) < html.indexOf(`./${PANEL}?v=`), 'the auto skeleton must load before the panel that runs it')
})

test('both files are shipped by the renderer build and the sync chain', () => {
  const build = read('particle-editor-desktop/scripts/build-renderer.mjs')
  const sync = read('scripts/sync-runtime.mjs'), check = read('scripts/check-runtime-sync.mjs')
  for (const file of [BONES, EDITOR]) {
    assert.equal(build.split(`"${file}"`).length - 1, 2, `${file} must appear in both build-renderer lists`)
    assert.ok(sync.includes(`label: '${file}'`), `${file} missing a sync-runtime group`)
    assert.ok(check.includes(`'${file}'`), `${file} missing from check-runtime-sync`)
  }
})

test('the panel has a 骨骼架设 panel of its own: expanding it IS the edit mode, plus the auto rig and the write-back', () => {
  const panel = read(`particle-editor/${PANEL}`)
  for (const needle of ["'骨骼架设'", 'NovaFlowBonesEditor', 'NovaFlowAutoBones', 'autoRig', 'applyBones', 'setBonesEditing', "'自动架设'", 'freezePreview', 'data-novaflow-bones-panel']) {
    assert.ok(panel.includes(needle), `panel must reference ${needle}`)
  }
  // the 编辑骨骼 checkbox is gone: open = editing, collapsed = preview back (user decision)
  assert.ok(!/const swLabel = el\('span', null, '编辑骨骼'\)/.test(panel), 'no 编辑骨骼 checkbox')
  assert.ok(/setOpen: \(v\) => \{\s*state\.openBones = v[\s\S]{0,160}setBonesEditing\(v\)/.test(panel), 'opening the panel turns editing on, collapsing turns it off')
  // rigging, meshing and binding are three panels, in that order
  assert.ok(panel.indexOf('{ mark: BMARK, spec: bonesSpec }') < panel.indexOf('{ mark: MARK, spec: meshSpec }'), '骨骼架设 mounts before 自动蒙皮')
  // every panel starts collapsed on entry and nothing about that is persisted across launches
  for (const needle of ['state.open = false', 'state.openWeights = false', 'state.openBones = false']) assert.ok(panel.includes(needle), needle)
  assert.ok(!/readStore\((STORAGE_OPEN|'novaflow\.[a-zA-Z]+\.(open|panelOpen)')/.test(panel), 'the open state is not read back from storage')
})

test("while the rig is edited the app's own 显示骨骼 overlay is suppressed, and put back afterwards", () => {
  const panel = read(`particle-editor/${PANEL}`)
  assert.ok(panel.includes('hideAppBones(p)') && panel.includes('showAppBones(p)'), 'freeze hides the app bones, thaw shows them')
  assert.ok(panel.includes("p.setDebugOverlays = function (overlays) {"), 'the player setter is wrapped so the app cannot turn its bones back on mid-edit')
  assert.ok(panel.includes("hidden.want = !!(overlays && overlays.bones)"), 'the app intent is remembered')
  assert.ok(panel.includes("Object.assign({}, overlays || {}, { bones: false })"), 'bones stay off while editing')
  assert.ok(panel.includes("{ bones: hidden.want }"), 'the intent is restored on exit')
  assert.ok(panel.includes("want: explicit ? !!p.debugOverlays.bones : !!bones.appBonesWant"), 'a reloaded player (no overlay setting yet) inherits the intent of the player before it')
})

test('constraint targets and zero-length bones are controls; a pose rotation turns the world frame even under a reflected parent', () => {
  const skel = {
    bones: [
      { name: 'root' },
      { name: 'body', parent: 'root', length: 100, rotation: 90 },
      { name: 'flip', parent: 'root', length: 50, scaleX: -1 },
      { name: 'pivot', parent: 'flip', x: 50 },                        // zero length under a reflected parent
      { name: 'arm', parent: 'pivot', length: 40, rotation: 10 },
      { name: 'target', parent: 'root', length: 5, x: 200, y: 50 },   // an IK target with length
      { name: 'follow', parent: 'root', length: 12, x: -80 }          // a transform-constraint target
    ],
    slots: [], skins: [{ name: 'default', attachments: {} }],
    ik: [{ name: 'ik', bones: ['arm'], target: 'target' }],
    transform: [{ name: 'tc', bones: ['body'], target: 'follow' }],
    animations: {}
  }
  const names = (set) => [...set].map((i) => skel.bones[i].name).sort()
  assert.deepEqual(names(E.controlsOf(skel, [])), ['follow', 'pivot', 'root', 'target'], 'zero-length bones and every IK/TC target are controls, deform bones are not')
  const W0 = E.worldTransforms(skel)
  const rot = (m) => Math.atan2(m.c, m.a) * 180 / Math.PI
  const res = E.poseRotate(skel, 3, 20)
  const W1 = E.worldTransforms(res.skeleton)
  const wrap = (v) => { while (v > 180) v -= 360; while (v < -180) v += 360; return v }
  assert.ok(Math.abs(wrap(rot(W1[3]) - rot(W0[3])) - 20) < 1e-6, 'the pivot turned by +20 in world terms (its parent is mirrored, so locally that is -20)')
  assert.ok(Math.abs(wrap(rot(W1[4]) - rot(W0[4])) - 20) < 1e-6, 'its child arm followed: a pose is not compensated')
  assert.ok(Math.abs(W1[3].worldX - W0[3].worldX) < 1e-9 && Math.abs(W1[3].worldY - W0[3].worldY) < 1e-9, 'a pose rotation is about the origin')
  assert.ok(Math.abs(res.skeleton.bones[3].rotation + 20) < 1e-6, 'local rotation went the other way under scaleX -1')
  const src = read(`particle-editor/${EDITOR}`)
  assert.ok(src.includes("kind: 'poseRotate'") && src.includes('const poseAny = !rigEdit && !!ev.altKey'), 'controls (and any bone with Alt) drag/turn as poses')
  assert.ok(src.includes('frozen: st.derived }') && !src.includes('frozen: st.owned }'), 'rig edits carry the controls on a joint along; only helper chains stay put')
  // two zero-length controls on one spot: the deeper one (later in the list) is what a click picks
  const stacked = { bones: [{ name: 'root' }, { name: 'master', parent: 'root', x: 10, y: 10 }, { name: 'hips', parent: 'master' }], slots: [], skins: [{ name: 'default', attachments: {} }], animations: {} }
  const Ws = E.worldTransforms(stacked)
  assert.equal(E.hitTest(Ws, 10, -10, (px, py) => [px, -py], 9).index, 2, 'the child control wins over the parent it sits on')
  // a pivot parked on a joint: the control is picked over the limb starting there, whichever comes first
  const parked = { bones: [{ name: 'root' }, { name: 'pivot', parent: 'root', x: 10, y: 10 }, { name: 'thigh', parent: 'pivot', length: 50 }, { name: 'shin', parent: 'thigh', x: 50, length: 40 }, { name: 'knee', parent: 'root', x: 60, y: 10 }], slots: [], skins: [{ name: 'default', attachments: {} }], ik: [{ name: 'knee', bones: ['thigh'], target: 'knee' }], animations: {} }
  const Wp = E.worldTransforms(parked)
  const ctl = E.controlsOf(parked, [])
  const pick = (px, py) => parked.bones[E.hitTest(Wp, px, -py, (a, b) => [a, -b], 9, null, (i) => ctl.has(i)).index].name
  assert.equal(pick(10, 10), 'pivot', 'the pivot (earlier in the list) beats the thigh origin on it')
  assert.equal(pick(60, 10), 'knee', 'the IK target (later in the list) beats the shin origin on it')
  assert.equal(parked.bones[E.hitTest(Wp, 10, -10, (a, b) => [a, -b], 9).index].name, 'thigh', 'without a preference the later bone wins (the thigh starts on the pivot)')
})

test('drag steps copy only the rig: skins are shared until an edit touches an attachment, and the source never changes', () => {
  const skel = {
    bones: [{ name: 'root' }, { name: 'a', parent: 'root', length: 50 }, { name: 'b', parent: 'a', x: 50, length: 40 }],
    slots: [{ name: 's', bone: 'b', attachment: 'img' }],
    skins: [{ name: 'default', attachments: { s: { img: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], vertices: [1, 2, 10, 5, 1, 1, 2, 20, 5, 1, 1, 2, 30, 5, 1], hull: 3 } } } }],
    animations: { idle: { bones: { a: { rotate: [{ angle: 10 }] } } } }
  }
  const copy = E.cloneRig(skel)
  assert.notEqual(copy.bones, skel.bones, 'bones are copied')
  assert.equal(copy.skins, skel.skins, 'skins are shared')
  assert.equal(copy.animations, skel.animations, 'animations are shared')
  const before = JSON.stringify(skel)
  const W = E.worldTransforms(skel)
  const moved = E.moveJoint(skel, E.tipOf(W[1]), [60, 10], { tol: 1.5 }).skeleton
  assert.equal(JSON.stringify(skel), before, 'the source skeleton (an undo entry) is untouched by the compensation')
  assert.notEqual(moved.skins, skel.skins, 'the edited copy forked its skins')
  const att = moved.skins[0].attachments.s.img
  assert.notEqual(att.vertices, skel.skins[0].attachments.s.img.vertices, 'the touched attachment owns its vertices')
  assert.equal(att.uvs, skel.skins[0].attachments.s.img.uvs, 'untouched arrays stay shared')
  const posed = E.poseMove(skel, 1, 5, 5).skeleton
  assert.equal(posed.skins, skel.skins, 'a pose move never touches the skins')
})

test('re-parenting: P picks a parent, the project tree can be dragged, and Ctrl+Z reaches the page', () => {
  const src = read(`particle-editor/${EDITOR}`)
  assert.ok(src.includes("if (k === 'p' && !ev.ctrlKey"), 'P arms the parent pick')
  assert.ok(src.includes('reparentSelected(0)'), 'Shift+P hangs the bone on the root')
  assert.ok(src.includes('if (st.pickParent) {'), 'the next canvas click names the parent')
  assert.ok(src.includes('function reparentNamed'), 'the tree drag re-parents by name')
  const panel = read(`particle-editor/${PANEL}`)
  for (const needle of ['onTreePointerDown', 'onTreePointerUp', 'reparentNamed', 'BONE_ROW_SEL', 'tuneSkeletonSidebar']) assert.ok(panel.includes(needle), needle)
  assert.ok(panel.includes("sec.style.display = 'none'"), "the app's own sidebar blocks are replaced by the hierarchy")
  assert.ok(panel.includes('function ensureHierarchy') && panel.includes('function hierModel'), 'one project hierarchy owns the sidebar')
  assert.ok(panel.includes("hier.scroll.style.maxHeight = maxH + 'px'"), 'and it is sized to the sidebar')
  assert.ok(!panel.includes('state.fitBonesList'), 'the second (left) bone tree is gone')
  // the Electron menu must not eat the undo shortcut before the renderer sees it
  const main = read('particle-editor-desktop/main.js')
  assert.ok(/{ role: "undo", label: "撤销", registerAccelerator: false }/.test(main), 'undo accelerator not registered')
  assert.ok(/{ role: "redo", label: "重做", registerAccelerator: false }/.test(main), 'redo accelerator not registered')
})

test('the overlay follows the camera every frame instead of a 250 ms timer', () => {
  const src = read(`particle-editor/${EDITOR}`)
  assert.ok(src.includes('function frameLoop') && src.includes('window.requestAnimationFrame(frameLoop)'), 'a frame loop drives the redraw')
  assert.ok(src.includes('function viewSignature'), 'the redraw only happens when the camera or the canvas box moved')
  assert.ok(!/setInterval\([^)]*draw\(\)/.test(src), 'the interval no longer draws')
})

test('a drawn chain hangs off the selected bone, sits under it in the list, and keeps the weights straight', () => {
  const skel = {
    bones: [{ name: 'root' }, { name: 'a', parent: 'root', length: 40 }, { name: 'b', parent: 'a', x: 40, length: 40 }, { name: 'other', parent: 'root', x: -50, length: 30 }],
    slots: [{ name: 's', bone: 'other', attachment: 'img' }],
    skins: [{ name: 'default', attachments: { s: { img: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], vertices: [1, 3, 5, 5, 1, 1, 3, 6, 5, 1, 1, 1, 7, 5, 1], hull: 3 } } } }],
    animations: {}
  }
  // drawn under 'a' (index 1): it belongs right after a's subtree, i.e. after 'b'
  const first = E.addBone(skel, { parentIndex: 1, origin: [40, 0], tip: [40, 40] })
  assert.equal(first.index, 3, 'inserted after the parent subtree, not appended')
  assert.deepEqual(first.skeleton.bones.map((b) => b.name), ['root', 'a', 'b', 'bone', 'other'])
  assert.equal(first.skeleton.bones[3].parent, 'a')
  const verts = first.skeleton.skins[0].attachments.s.img.vertices
  assert.deepEqual([verts[1], verts[6], verts[11]], [4, 4, 1], "the mesh's weighted bone indices followed the shift (3 -> 4)")
  // the chain continues: the next bone hangs off the one just drawn
  const second = E.addBone(first.skeleton, { parentIndex: first.index, origin: [40, 40], tip: [40, 80] })
  assert.equal(second.skeleton.bones[second.index].parent, 'bone')
  assert.equal(second.index, 4, 'and sits right under it')
  // parent before child everywhere, which is what the runtime needs
  const order = new Map(second.skeleton.bones.map((b, i) => [b.name, i]))
  for (const b of second.skeleton.bones) if (b.parent) assert.ok(order.get(b.parent) < order.get(b.name), `${b.parent} must come before ${b.name}`)
  const src = read(`particle-editor/${EDITOR}`)
  assert.ok(src.includes('const parentIndex = st.selected >= 0 ? st.selected : 0'), 'the selected bone is the default parent')
  assert.ok(src.includes('toSetupFrame(d.origin, parentIndex)'), 'points drawn on the posed skeleton are written in the setup frame')
  const panel = read(`particle-editor/${PANEL}`)
  assert.ok(!panel.includes('onCreate: () => bones.focusName()'), 'creating no longer steals focus into the name field')
})

test('the hierarchy is a Spine-style tree: groups closed by default, both ways of selecting, skins and animations forwarded', () => {
  const panel = read(`particle-editor/${PANEL}`)
  assert.ok(panel.includes("const hier = { box: null, scroll: null, open: new Set()"), 'every group starts collapsed')
  for (const needle of ["'骨架'", "'约束'", "'皮肤'", "'动画'", "'图层'"]) assert.ok(panel.includes(needle), `the tree needs a ${needle} group`)
  assert.ok(panel.includes('function revealInTree'), 'the selection opens its ancestors in the tree')
  assert.ok(panel.includes('scrollIntoBox(row, hier.scroll)'), 'and is scrolled inside the tree only')
  assert.ok(panel.includes('revealInTree(i >= 0 && list[i] ? list[i].name : null)'), 'every selection change drives it')
  assert.ok(panel.includes('if (i >= 0) { ctl.select(i); bones.syncUi(); return }'), 'clicking a row selects that bone in the editor')
  assert.ok(panel.includes('function toggleHierKey') && panel.includes("chev.addEventListener('click'"), 'the arrow folds, the name selects (Spine)')
  assert.ok(panel.includes('function appButton'), 'skins and animations stay with the app: its buttons are clicked')
  assert.ok(panel.includes('function activeSkinName') && panel.includes('function activeAnimationName'), 'the active one is read from the runtime')
  assert.ok(panel.includes('const btn = appButton(r.pick[0], r.pick[1])'), 'a skin / animation row forwards to that button')
  assert.ok(panel.includes('if (sec.hasAttribute(HIER_MARK))'), "the app tags our box as one of its sections; it must never be hidden with them")
  const editor = read(`particle-editor/${EDITOR}`)
  assert.ok(editor.includes('peek: () => st.skel') && editor.includes('roleOf: (i) => roleOf(i)'), 'the tree reads the working copy and the colour roles')
})

test('one drawing style for 显示骨骼 and 编辑骨骼, with a colour per role', () => {
  const skel = {
    bones: [{ name: 'root' }, { name: 'thigh', parent: 'root', length: 60 }, { name: 'shin', parent: 'thigh', x: 60, length: 50 }, { name: 'target', parent: 'root', x: 100, y: -10 }, { name: 'plain', parent: 'root', x: -40, length: 20 }],
    slots: [], skins: [{ name: 'default', attachments: {} }],
    ik: [{ name: 'leg', bones: ['thigh', 'shin'], target: 'target' }],
    animations: {}
  }
  const names = (set) => [...set].map((i) => skel.bones[i].name).sort()
  assert.deepEqual(names(E.constrainedOf(skel)), ['shin', 'thigh'], 'the bones an IK drives are marked')
  assert.deepEqual(names(E.controlsOf(skel, [])), ['root', 'target'], 'the target stays a control')
  assert.ok(!E.constrainedOf(skel).has(4), 'a plain deform bone is neither')
  for (const role of ['bone', 'driven', 'control', 'helper']) assert.ok(E.ROLE_COLORS[role] && E.ROLE_COLORS[role].line, `${role} has a colour`)
  assert.notEqual(E.ROLE_COLORS.driven.line, E.ROLE_COLORS.bone.line, 'constraint-driven bones do not look like plain ones')
  assert.notEqual(E.ROLE_COLORS.control.line, E.ROLE_COLORS.driven.line, 'controls do not look like the bones they drive')
  const src = read(`particle-editor/${EDITOR}`)
  assert.ok(src.includes('function setPreview'), 'the overlay can draw without taking input')
  assert.ok(src.includes('host.liveWorld()'), 'and it follows the running animation, not the setup pose')
  assert.ok(src.includes("if (st.preview) { recompute(); draw()"), 'every frame while previewing')
  const panel = read(`particle-editor/${PANEL}`)
  assert.ok(panel.includes('function syncBonePreview'), '显示骨骼 is routed through the editor overlay')
  assert.ok(panel.includes('liveWorld: () => {'), 'the panel hands the runtime matrices over')
  assert.ok(panel.includes("['#c79bff', '受约束驱动']"), 'the panel carries the legend')
})

test('the editor stays dependency free and exposes the tools', () => {
  const src = read(`particle-editor/${EDITOR}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.ok(!/\brequire\(/.test(src), 'must not require anything')
  assert.deepEqual(E.TOOLS.map((t) => t.id), ['select', 'rotate', 'create'])
  for (const fn of ['worldTransforms', 'moveJoint', 'translateBone', 'rotateBone', 'addBone', 'deleteBone', 'renameBone', 'reparentBone', 'parseMechanisms', 'rebuildMechanisms', 'hitTest', 'poseMove', 'poseRotate', 'controlsOf', 'cloneRig', 'forkAttachments', 'createController']) assert.equal(typeof E[fn], 'function', fn)
})

test('a control (IK target / pivot) poses the chain, Shift edits the joint under it, derived helpers stay untouchable', () => {
  const src = read(`particle-editor/${EDITOR}`)
  assert.ok(src.includes("st.drag = { kind: 'pose'"), 'controls drag as a pose move')
  assert.ok(src.includes('const rigEdit = !!ev.shiftKey'), 'Shift turns the control hit into a joint edit')
  assert.ok(src.includes("rigEdit ? (i) => editable(i) && !st.controls.has(i) : editable"), 'with Shift the control itself is skipped so the joint under it is hit')
  assert.ok(src.includes('editable = (i) => !st.derived.has(i)'), 'hidden helper chains are never hit')
  assert.ok(src.includes('host.poseWorld'), 'the display is the constrained pose, not the FK tree')
})

// ------------------------------------------------------------------ math ---

/** root → a (100 long, 30°) → b (80 long, −40° relative); a region attachment on b. */
function rig() {
  return {
    bones: [
      { name: 'root' },
      { name: 'a', parent: 'root', x: 10, y: 20, rotation: 30, length: 100 },
      { name: 'b', parent: 'a', x: 100, rotation: -40, length: 80 },
      { name: 'ctl', parent: 'b', x: 80 }
    ],
    slots: [{ name: 'img', bone: 'b', attachment: 'img' }, { name: 'pic', bone: 'a', attachment: 'pic' }],
    skins: { default: { img: { img: { x: 40, y: 5, rotation: 12, width: 50, height: 30 } }, pic: { pic: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], vertices: [0, 0, 10, 0, 10, 10], hull: 3, width: 10, height: 10 } } } }
  }
}
const near = (p, q, tol, msg) => assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) <= (tol || 0.05), `${msg || 'points'}: ${p} vs ${q}`)
function regionWorld(skel, slotName, attName) {
  const W = E.worldTransforms(skel)
  const bi = skel.bones.findIndex((b) => b.name === skel.slots.find((s) => s.name === slotName).bone)
  const att = skel.skins.default[slotName][attName]
  const m = W[bi], x = att.x || 0, y = att.y || 0
  return { p: [m.a * x + m.b * y + m.worldX, m.c * x + m.d * y + m.worldY], rot: Math.atan2(m.c, m.a) * 180 / Math.PI + (att.rotation || 0) }
}

test('world transforms agree with the weight solver for the normal inherit mode', () => {
  const skel = rig()
  const W = E.worldTransforms(skel), M = AW.setupPoseMatrices(skel)
  W.forEach((m, i) => { near([m.worldX, m.worldY], [M[i].worldX, M[i].worldY], 1e-9, skel.bones[i].name); assert.ok(Math.abs(m.a - M[i].a) < 1e-9 && Math.abs(m.c - M[i].c) < 1e-9) })
  near(E.tipOf(W[1]), [10 + 100 * Math.cos(Math.PI / 6), 20 + 100 * Math.sin(Math.PI / 6)], 1e-9, 'tip of a')
})

test('a non-inheriting bone keeps its world angle (the generator writes it as absolute)', () => {
  const skel = rig()
  skel.bones[2].transform = 'noRotationOrReflection'
  skel.bones[2].rotation = 15
  const W = E.worldTransforms(skel)
  assert.ok(Math.abs(Math.atan2(W[2].c, W[2].a) * 180 / Math.PI - 15) < 1e-6, 'world angle equals the JSON rotation')
  const gen = read(`particle-editor/${BONES}`)
  assert.ok(gen.includes("const absolute = b.inherit === 'noRotationOrReflection' || b.inherit === 'onlyTranslation'"), 'the generator emits absolute angles for those bones')
})

test('moving a joint keeps the far endpoints and the artwork where they are', () => {
  const skel = rig()
  const W0 = E.worldTransforms(skel)
  const J = E.tipOf(W0[1])                       // a's tip = b's origin
  const bTip0 = E.tipOf(W0[2]), ctl0 = [W0[3].worldX, W0[3].worldY]
  const img0 = regionWorld(skel, 'img', 'img'), pic0 = AW.attachmentWorld(skel.skins.default.pic.pic, AW.setupPoseMatrices(skel), 1)
  const res = E.moveJoint(skel, J, [J[0] + 25, J[1] - 15])
  assert.deepEqual([...res.changed].map((i) => skel.bones[i].name).sort(), ['a', 'b'])
  const W1 = E.worldTransforms(res.skeleton)
  near(E.tipOf(W1[1]), [J[0] + 25, J[1] - 15], 0.05, 'a tip moved')
  near([W1[2].worldX, W1[2].worldY], [J[0] + 25, J[1] - 15], 0.05, 'b origin moved with it')
  near(E.tipOf(W1[2]), bTip0, 0.05, 'b tip stayed')
  near([W1[3].worldX, W1[3].worldY], ctl0, 0.05, 'the control bone under b stayed')
  const img1 = regionWorld(res.skeleton, 'img', 'img')
  near(img1.p, img0.p, 0.05, 'region attachment stayed')
  assert.ok(Math.abs(((img1.rot - img0.rot + 540) % 360) - 180) < 0.05, 'region rotation stayed')
  const pic1 = AW.attachmentWorld(res.skeleton.skins.default.pic.pic, AW.setupPoseMatrices(res.skeleton), 1)
  for (let i = 0; i < 3; i++) near([pic1[2 * i], pic1[2 * i + 1]], [pic0[2 * i], pic0[2 * i + 1]], 0.05, 'mesh vertex ' + i)
})

test('rotate and translate go through the same joint rule', () => {
  const skel = rig()
  const W0 = E.worldTransforms(skel)
  const rot = E.rotateBone(skel, 1, 20)
  const W1 = E.worldTransforms(rot.skeleton)
  assert.ok(Math.abs(Math.atan2(W1[1].c, W1[1].a) * 180 / Math.PI - 50) < 1e-6, 'a turned by 20°')
  near([W1[2].worldX, W1[2].worldY], E.tipOf(W1[1]), 0.05, 'b follows a\'s tip')
  near(E.tipOf(W1[2]), E.tipOf(W0[2]), 0.05, 'b\'s tip stays')
  const tr = E.translateBone(skel, 2, 5, -7)
  const W2 = E.worldTransforms(tr.skeleton)
  near([W2[2].worldX, W2[2].worldY], [W0[2].worldX + 5, W0[2].worldY - 7], 0.05, 'b moved')
  near(E.tipOf(W2[1]), [W0[2].worldX + 5, W0[2].worldY - 7], 0.05, 'a\'s tip came along')
  near(E.tipOf(W2[2]), [E.tipOf(W0[2])[0] + 5, E.tipOf(W0[2])[1] - 7], 0.05, 'b\'s tip moved too')
})

test('add / rename / delete / re-parent keep the world and the references straight', () => {
  const skel = rig()
  assert.equal(E.nextName(skel), 'bone')
  const added = E.addBone(skel, { parentIndex: 2, origin: [200, 50], tip: [230, 90] })
  assert.equal(added.name, 'bone')
  assert.equal(added.skeleton.bones[added.index].parent, 'b')
  const Wa = E.worldTransforms(added.skeleton)
  near([Wa[added.index].worldX, Wa[added.index].worldY], [200, 50], 0.05, 'new origin')
  near(E.tipOf(Wa[added.index]), [230, 90], 0.05, 'new tip')
  assert.equal(E.nextName(added.skeleton), 'bone2')
  assert.equal(E.renameBone(added.skeleton, added.index, 'a'), null, 'a taken name is refused')
  const renamed = E.renameBone(added.skeleton, 1, 'arm')
  assert.equal(renamed.bones[2].parent, 'arm', 'children follow the rename')
  assert.equal(renamed.slots[1].bone, 'arm', 'slots follow the rename')
  const W0 = E.worldTransforms(renamed)
  const del = E.deleteBone(renamed, 2)                 // delete b: ctl and bone move under arm, img re-binds
  const names = del.bones.map((b) => b.name)
  assert.deepEqual(names, ['root', 'arm', 'ctl', 'bone'])
  assert.equal(del.bones[2].parent, 'arm')
  assert.equal(del.slots[0].bone, 'arm')
  const W1 = E.worldTransforms(del)
  near([W1[2].worldX, W1[2].worldY], [W0[3].worldX, W0[3].worldY], 0.05, 'ctl kept its place')
  near([W1[3].worldX, W1[3].worldY], [W0[4].worldX, W0[4].worldY], 0.05, 'bone kept its place')
  const img = regionWorld(del, 'img', 'img'), img0 = regionWorld(renamed, 'img', 'img')
  near(img.p, img0.p, 0.05, 'img stayed after its bone was deleted')
  assert.equal(E.deleteBone(renamed, 0), null, 'root cannot be deleted')
  const rp = E.reparentBone(renamed, 3, 0)             // ctl under root
  const W2 = E.worldTransforms(rp)
  const ci = rp.bones.findIndex((b) => b.name === 'ctl')
  assert.equal(rp.bones[ci].parent, 'root')
  near([W2[ci].worldX, W2[ci].worldY], [W0[3].worldX, W0[3].worldY], 0.05, 'ctl kept its place when re-parented')
  assert.equal(E.reparentBone(renamed, 1, 3), null, 'a bone cannot hang from its own descendant')
})

/** A limb the way spine-auto-bones builds it: pivot, upper, lower, joint / end targets and a helper chain. */
function limb() {
  const skel = {
    bones: [
      { name: 'root' },
      { name: 'pivot', parent: 'root', x: 0, y: 100 },
      { name: 'upper', parent: 'pivot', rotation: -80, length: 100 },
      // the joint: 100 along −80° from the pivot
      { name: 't1', parent: 'root', x: 100 * Math.cos(-80 * Math.PI / 180), y: 100 + 100 * Math.sin(-80 * Math.PI / 180) }, { name: 't2', parent: 'root' },
      { name: 'lower', parent: 't1', rotation: -100, length: 90 },
      { name: 'h1', parent: 'pivot' }, { name: 'h2', parent: 'h1' }
    ],
    slots: [], skins: { default: {} },
    ik: [
      { name: 'leg_helper_ik', order: 0, bones: ['h1', 'h2'], target: 't2' },
      { name: 'leg_upper_ik', order: 1, bones: ['upper'], target: 't1', compress: true, stretch: true },
      { name: 'leg_lower_ik', order: 2, bones: ['lower'], target: 't2', compress: true, stretch: true }
    ],
    transform: [{ name: 'leg_knee_follow', order: 3, bones: ['t1'], target: 'h2', rotateMix: 0.6, translateMix: 0.6, scaleMix: 0.6, shearMix: 0.6 }]
  }
  // the end target on the foot, a first guess of the helper chain, then the rebuild places it properly
  const W = E.worldTransforms(skel)
  const T = E.tipOf(W[5])
  const s2 = E.setEndpoints(skel, new Map([[4, { origin: T }], [6, { origin: [0, 100], tip: [30, 40] }], [7, { origin: [30, 40], tip: T }]])).skeleton
  return E.rebuildMechanisms(s2)
}

test('the auto rig mechanism is parsed back and rebuilt consistently when a joint moves', () => {
  const skel = limb()
  const mechs = E.parseMechanisms(skel)
  assert.equal(mechs.length, 1)
  const m = mechs[0]
  assert.deepEqual([m.upper, m.lower, m.t1, m.t2, m.h1, m.h2, m.pivot].map((i) => skel.bones[i].name), ['upper', 'lower', 't1', 't2', 'h1', 'h2', 'pivot'])
  const owned = E.mechanismOwned(skel, mechs)
  assert.ok(owned.has(m.h1) && owned.has(m.t1) && owned.has(m.pivot) && !owned.has(m.upper))
  const W0 = E.worldTransforms(skel)
  const P = [W0[m.upper].worldX, W0[m.upper].worldY], J = E.tipOf(W0[m.upper]), T = E.tipOf(W0[m.lower])
  near([W0[m.t1].worldX, W0[m.t1].worldY], J, 0.05, 't1 on the joint')
  near(E.tipOf(W0[m.h2]), T, 0.05, 'helper ends on the end target')
  const K0 = E.tipOf(W0[m.h1])
  const side0 = Math.sign((T[0] - P[0]) * (K0[1] - P[1]) - (T[1] - P[1]) * (K0[0] - P[0]))
  // move the knee 30 px sideways; the mechanism must follow
  const moved = E.rebuildMechanisms(E.moveJoint(skel, J, [J[0] + 30, J[1]], { frozen: owned }).skeleton)
  const W1 = E.worldTransforms(moved)
  near(E.tipOf(W1[m.upper]), [J[0] + 30, J[1]], 0.05, 'upper tip moved')
  near([W1[m.lower].worldX, W1[m.lower].worldY], [J[0] + 30, J[1]], 0.05, 'lower origin moved')
  near(E.tipOf(W1[m.lower]), T, 0.05, 'the foot stayed')
  near([W1[m.t1].worldX, W1[m.t1].worldY], [J[0] + 30, J[1]], 0.05, 't1 follows the joint')
  near([W1[m.t2].worldX, W1[m.t2].worldY], T, 0.05, 't2 stays on the foot')
  near([W1[m.h1].worldX, W1[m.h1].worldY], P, 0.05, 'helper starts at the pivot')
  near(E.tipOf(W1[m.h2]), T, 0.05, 'helper ends at the foot')
  near(E.tipOf(W1[m.h1]), [W1[m.h2].worldX, W1[m.h2].worldY], 0.05, 'helper chain is connected')
  const K1 = E.tipOf(W1[m.h1])
  const side1 = Math.sign((T[0] - P[0]) * (K1[1] - P[1]) - (T[1] - P[1]) * (K1[0] - P[0]))
  assert.equal(side1, side0, 'the helper knee stays on its side')
  const k = Math.max(1.12, 1.05 * Math.hypot(T[0] - P[0], T[1] - P[1]) / (W1[m.upper].length + W1[m.lower].length))
  assert.ok(Math.abs(W1[m.h1].length - k * W1[m.upper].length) < 0.1 && Math.abs(W1[m.h2].length - k * W1[m.lower].length) < 0.1, 'helper lengths scale with the limb')
  const tc = moved.transform[0]
  const [ox, oy] = E._internals.toLocalPoint(W1[m.h2], W1[m.t1].worldX, W1[m.t1].worldY)
  assert.ok(Math.abs((tc.x || 0) - ox) < 0.02 && Math.abs((tc.y || 0) - oy) < 0.02, 'follow offset = the joint seen from the helper knee')
})

test('hit testing prefers joints over shafts and skips mechanism bones', () => {
  const skel = rig()
  const W = E.worldTransforms(skel)
  const toS = (x, y) => [x * 2, -y * 2]
  const J = E.tipOf(W[1])
  const hit = E.hitTest(W, J[0] * 2 + 3, -J[1] * 2 - 2, toS, 9)
  assert.ok(hit && hit.end !== 'shaft')
  const mid = [(W[1].worldX + J[0]) / 2, (W[1].worldY + J[1]) / 2]
  const shaft = E.hitTest(W, mid[0] * 2, -mid[1] * 2, toS, 9)
  assert.deepEqual([shaft.index, shaft.end], [1, 'shaft'])
  assert.equal(E.hitTest(W, mid[0] * 2, -mid[1] * 2, toS, 9, (i) => i !== 1), null)
})

test('the real auto rig round-trips: FK matches the generator and a knee move keeps every image in place', () => {
  const file = path.join(root, 'tools', 'autoskin-bench', 'out', 'jiaye', 'autobones.json')
  if (!fs.existsSync(file)) return
  const skel = JSON.parse(fs.readFileSync(file, 'utf8'))
  const W = E.worldTransforms(skel)
  const mechs = E.parseMechanisms(skel)
  assert.equal(mechs.length, 4, 'two legs, two arms')
  const before = JSON.stringify(E.worldTransforms(E.rebuildMechanisms(skel)).map((m) => [Math.round(m.worldX), Math.round(m.worldY)]))
  const after = JSON.stringify(W.map((m) => [Math.round(m.worldX), Math.round(m.worldY)]))
  assert.equal(before, after, 'rebuilding an untouched rig changes nothing')
  const idx = new Map(skel.bones.map((b, i) => [b.name, i]))
  const J = E.tipOf(W[idx.get('leg_r')])
  const owned = E.mechanismOwned(skel, mechs)
  const next = E.rebuildMechanisms(E.moveJoint(skel, J, [J[0] + 30, J[1] - 10], { frozen: owned }).skeleton)
  // the mode-aware FK: the sash chain does not inherit rotation, which the weight solver's FK ignores
  const M0 = E.worldTransforms(skel), M1 = E.worldTransforms(next)
  const sb = new Map(skel.slots.map((s) => [s.name, idx.get(s.bone)]))
  for (const { slot, att } of E.attachmentList(skel)) {
    if ((att.type || 'region') !== 'region') continue
    const a1 = E.attachmentList(next).find((e) => e.slot === slot).att
    const m0 = M0[sb.get(slot)], m1 = M1[sb.get(slot)]
    const p0 = [m0.a * (att.x || 0) + m0.b * (att.y || 0) + m0.worldX, m0.c * (att.x || 0) + m0.d * (att.y || 0) + m0.worldY]
    const p1 = [m1.a * (a1.x || 0) + m1.b * (a1.y || 0) + m1.worldX, m1.c * (a1.x || 0) + m1.d * (a1.y || 0) + m1.worldY]
    near(p1, p0, 0.05, slot)
  }
})
