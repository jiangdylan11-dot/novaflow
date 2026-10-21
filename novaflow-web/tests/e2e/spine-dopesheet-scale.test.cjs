// Exercise the actual canvas hit testing and pointer handlers, including the empty area
// below the tracks where the selection edges used to be unreachable.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
require(path.join(renderer, 'spine-structure.ops.js'))
const Ops = globalThis.NovaFlowSpineStructureOps
const source = fs.readFileSync(path.join(renderer, 'spine-skeleton-editor.js'), 'utf8')
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))

function fixture({ full = false, first = 0 } = {}) {
  const track = ['bones', 'root', 'rotate']
  const other = ['bones', 'root', 'translate']
  const times = [first, first + 10, first + 20].map(f => f / 30)
  const keys = times.map(time => ({ path: track, time }))
  const state = { anim: 'idle', dope: { pxf: 10, f0: 0, scrollY: 0, keySel: keys,
    rows: Array.from({ length: full ? 8 : 2 }, () => ({ keys })), shift: false, offset: false },
    json: { bones: [{ name: 'root' }], animations: { idle: { bones: { root: {
      rotate: [...times.map((time, i) => ({ time, angle: i * 20, curve: i === 0 ? 'stepped' : undefined })), { time: 3, angle: 99 }],
      translate: [{ time: 0, x: 3 }, { time: 1, x: 8 }]
    } } } } } }
  const events = new Map()
  const canvas = { clientHeight: 210, style: {}, setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }), addEventListener: (name, fn) => events.set(name, fn) }
  let edits = 0
  const ctx = vm.createContext({ state, Ops, FPS: 30,
    $: () => canvas, document: { addEventListener() {} }, setTimeout() {},
    animOn: () => true, rowKeys: row => row.keys.map(key => ({ keys: [key], frame: key.time * 30 })),
    isKeySel: k => state.dope.keySel.some(s => JSON.stringify(s.path) === JSON.stringify(k.path) && Math.abs(s.time - k.time) < 1e-4),
    pathId: JSON.stringify, renderCurvePanel() {}, status() {},
    edit: (_label, op, after) => { const result = op(state.json); state.json = result.json; after(result); edits++ }
  })
  vm.runInContext(section('  const DOPE =', '  const KEY_COLOR =') +
    section('  function dopeEndFrame(', '  function rowKeys(') +
    section('  function dopeHit(', '  function setFrame(') +
    section('  function bindDope(', '  const TRACK_LABEL =') + '\nbindDope()', ctx)
  const pointer = (type, x, y) => events.get(type)({ clientX: x, clientY: y, pointerId: 1, button: 0 })
  const drag = (from, to, y) => { pointer('pointerdown', from, y); pointer('pointermove', to, y); pointer('pointerup', to, y) }
  return { state, canvas, ctx, pointer, drag, track, other, edits: () => edits,
    frames: () => Ops.keyTracks(state.json, 'idle').find(t => JSON.stringify(t.path) === JSON.stringify(track)).times.map(t => Math.round(t * 30)) }
}

test('both selection edges can be grabbed below the last row, including frame 0', () => {
  const f = fixture()
  assert.equal(vm.runInContext('dopeHit(dopeX(0), 130).edge', f.ctx), 'start')
  assert.equal(vm.runInContext('dopeHit(dopeX(20), 130).edge', f.ctx), 'end')
  f.pointer('pointermove', 400, 130)
  assert.equal(f.canvas.style.cursor, 'ew-resize')
})

test('right edge stretches all picked keys about the first frame and preserves other keys / curves', () => {
  const f = fixture()
  const untouched = JSON.stringify(f.state.json.animations.idle.bones.root.translate)
  f.drag(400, 600, 130)
  assert.deepEqual(f.frames(), [0, 20, 40, 90])
  assert.equal(f.state.json.animations.idle.bones.root.rotate[0].curve, 'stepped')
  assert.equal(JSON.stringify(f.state.json.animations.idle.bones.root.translate), untouched)
  assert.equal(f.state.dope.keySel.length, 3)
  assert.equal(f.edits(), 1)
})

test('left edge compresses about the last frame', () => {
  const f = fixture()
  f.drag(200, 300, 130)
  assert.deepEqual(f.frames(), [10, 15, 20, 90])
})

test('bottom grip remains usable with rows filling the whole sheet', () => {
  const f = fixture({ full: true })
  // y=199 is the middle of the final row: its key used to intercept this press.
  f.drag(400, 500, 199)
  assert.deepEqual(f.frames(), [0, 15, 30, 90])
})

test('dragging a diamond still translates the selected keys', () => {
  const f = fixture()
  f.drag(400, 450, 45)
  assert.deepEqual(f.frames(), [5, 15, 25, 90])
})

test('scale cannot flip, cross frame zero, or create an edit on click', () => {
  const f = fixture({ first: 10 })
  f.drag(500, 500, 130)
  assert.equal(f.edits(), 0)
  f.drag(300, 100, 130)
  assert.deepEqual(f.frames(), [0, 15, 30, 90])
  const g = fixture()
  g.drag(400, 100, 130)
  assert.deepEqual(g.frames(), [0, 1, 90])
})

test('one selected time has no scale handles', () => {
  const f = fixture()
  f.state.dope.keySel = [f.state.dope.keySel[0]]
  assert.equal(vm.runInContext('dopeHit(dopeX(0), 130).kind', f.ctx), 'empty')
})
