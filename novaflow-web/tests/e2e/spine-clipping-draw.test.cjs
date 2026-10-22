const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
require(path.join(renderer, 'spine-structure.ops.js'))
const Ops = globalThis.NovaFlowSpineStructureOps
const source = fs.readFileSync(path.join(renderer, 'spine-skeleton-editor.js'), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))

function fixture(vertices = []) {
  const ctx = vm.createContext({ console, Float32Array, setTimeout })
  vm.runInContext(fs.readFileSync(path.join(renderer, 'vendor/spine/spine-webgl-3.8.js'), 'utf8') + '\nthis.spine = spine', ctx)
  const { spine } = ctx
  const state = { mode: 'setup', offset: { x: 0, y: 0 }, sel: { kind: 'att', skin: 'default', slot: 'mask', name: 'clip' },
    opt: { otherVis: true }, hiddenSlots: new Set(), json: Ops.prepare({ bones: [{ name: 'root', x: 20, y: 30 }],
      slots: [{ name: 'mask', bone: 'root', attachment: 'clip' }],
      skins: [{ name: 'default', attachments: { mask: { clip: { type: 'clipping', vertexCount: vertices.length / 2, vertices } } } }], animations: {} }) }
  const rt = {}, history = [], messages = []
  const load = () => {
    const loader = { newClippingAttachment: (_skin, name) => new spine.ClippingAttachment(name) }
    rt.data = new spine.SkeletonJson(loader).readSkeletonData(state.json)
    rt.skeleton = new spine.Skeleton(rt.data); rt.skeleton.setToSetupPose(); rt.skeleton.updateWorldTransform()
  }
  Object.assign(ctx, { state, rt, Ops, refresh() {}, renderClipPanel() {}, status: msg => messages.push(msg),
    toScreen: (x, y) => [x + state.offset.x, y + state.offset.y], toWorld: (x, y) => [x - state.offset.x, y - state.offset.y],
    edit: (_label, op, after) => { const r = op(state.json); history.push(state.json); state.json = r.json; load(); after?.(r); return r }
  })
  vm.runInContext(source.slice(source.indexOf('  function enterClipEdit('), source.indexOf('  /** The clipping whose outline')), ctx)
  load(); ctx.enterClipEdit(state.sel)
  return { ctx, state, rt, history, messages, click: (x, y) => ctx.clipPointerDown({}, x, y),
    attachment: () => state.json.skins[0].attachments.mask.clip }
}

test('third and later clicks stay open, append in drawing order and never activate runtime clipping', () => {
  const f = fixture()
  const points = [[100, 100], [200, 100], [200, 200], [120, 150], [100, 200]]
  points.forEach(([x, y]) => { f.click(x, y); assert.equal(f.rt.skeleton.findSlot('mask').getAttachment().worldVerticesLength, 0) })
  assert.deepEqual(plain(f.state.clipEdit.draft), points)
  assert.deepEqual(f.attachment().vertices, [])
  assert.equal(f.history.length, 0)
})

test('clicking the start closes once, keeps vertex order and converts world points to bone space', () => {
  const f = fixture()
  for (const p of [[100, 100], [200, 100], [200, 200], [100, 200]]) f.click(...p)
  f.click(100, 100)
  assert.equal(f.state.clipEdit.draft, null)
  assert.deepEqual(f.attachment().vertices, [80, 70, 180, 70, 180, 170, 80, 170])
  assert.equal(f.attachment().vertexCount, 4)
  assert.equal(f.history.length, 1)
  const runtime = f.ctx.clipRuntime()
  const points = f.ctx.clipWorld(runtime.slot, runtime.att)
  ;[[100, 100], [200, 100], [200, 200], [100, 200]].forEach((p, i) => p.forEach((v, axis) => assert(Math.abs(points[i][axis] - v) < 1e-4)))
})

test('explicit close rejects fewer than three points; cancelling a draft never saves an implicit polygon', () => {
  const f = fixture(); f.click(100, 100); f.click(200, 100)
  assert.equal(f.ctx.closeClipDraft(), false)
  f.click(200, 200); f.ctx.exitClipEdit()
  assert.equal(f.state.clipEdit, null)
  assert.equal(f.history.length, 0)
  assert.deepEqual(f.attachment().vertices, [])
})

test('draft vertices can be moved and deleted before explicitly closing', () => {
  const f = fixture(); f.click(100, 100); f.click(200, 100); f.click(200, 200); f.click(100, 200)
  const drag = f.click(200, 100); drag.moved = true; f.state.clipDrag = { vi: 1, p: [220, 90] }
  f.ctx.finishClipMove(drag)
  f.state.clipEdit.tool = 'delete'; f.click(100, 200)
  assert.deepEqual(plain(f.state.clipEdit.draft), [[100, 100], [220, 90], [200, 200]])
  assert.equal(f.history.length, 0)
  assert.equal(f.ctx.closeClipDraft(), true)
  assert.deepEqual(f.attachment().vertices, [80, 70, 200, 60, 180, 170])
})

test('open outline never connects back to the start; the trailing guide stays visible after three points', () => {
  const f = fixture(); f.click(100, 100); f.click(200, 100); f.click(200, 200)
  let closes = 0, dashed = 0
  const g = new Proxy({}, { get: (_target, key) => key === 'closePath' ? () => closes++ : key === 'setLineDash' ? a => { if (a.length) dashed++ } : () => {}, set: () => true })
  f.state.meshPointer = [100, 200]; f.ctx.drawClips(g)
  assert.equal(closes, 0); assert.equal(dashed, 1)
  f.ctx.closeClipDraft(); f.ctx.drawClips(g)
  assert.equal(closes, 1)
})

test('existing closed polygons retain nearest-edge insertion and vertex dragging', () => {
  const f = fixture([80, 70, 180, 70, 180, 170, 80, 170])
  assert.equal(f.state.clipEdit.draft, undefined)
  f.click(150, 100)
  assert.deepEqual(f.attachment().vertices, [80, 70, 130, 70, 180, 70, 180, 170, 80, 170])
  const drag = f.click(150, 100); drag.moved = true; f.state.clipDrag = { vi: 1, p: [150, 90] }; f.ctx.finishClipMove(drag)
  assert.deepEqual(f.attachment().vertices.slice(2, 4), [130, 60])
})

test('project view offset does not change the committed clipping geometry', () => {
  const f = fixture(); f.state.offset = { x: 300, y: -40 }
  for (const p of [[400, 60], [500, 60], [500, 160]]) f.click(...p)
  f.click(400, 60)
  assert.deepEqual(f.attachment().vertices, [80, 70, 180, 70, 180, 170])
})
