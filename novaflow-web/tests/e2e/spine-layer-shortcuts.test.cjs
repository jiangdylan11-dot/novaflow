const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
require(path.join(renderer, 'spine-structure.ops.js'))
const Ops = globalThis.NovaFlowSpineStructureOps
const src = fs.readFileSync(path.join(renderer, 'spine-skeleton-editor.js'), 'utf8')
const section = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)))

function fixture({ selected = ['b'], mode = 'setup', posed } = {}) {
  const setup = ['a', 'b', 'c', 'd']
  const initialOrder = ['d', 'a', 'b', 'c']
  const state = { json: { bones: [{ name: 'root' }], slots: setup.map(name => ({ name, bone: 'root' })),
    animations: { idle: { drawOrder: [{ time: 0.5, offsets: Ops.encodeDrawOrder(setup, initialOrder) }] } } },
    anim: 'idle', frame: 30, pick: null, sel: { kind: 'slot', name: selected.at(-1) }, multiSlots: selected }
  const history = [], messages = []
  const ctx = vm.createContext({ state, Ops, pfx: null, PFX_LOCKED: 'locked', document: { activeElement: { tagName: 'BODY' } },
    animOn: () => mode === 'animate', timeSec: () => 1, status: msg => messages.push(msg),
    drawOrderNow: () => posed || state.json.slots.map(s => s.name),
    edit: (label, op) => { history.push(state.json); state.json = op(state.json).json; messages.push(label) }
  })
  vm.runInContext(section('  function currentSlot(', '  function propsKind(') + section('  function handleLayerOrderKey(', '  /** The dopesheet'), ctx)
  const key = (key, options = {}) => {
    const event = { key, target: {}, preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true }, ...options }
    return { handled: ctx.handleLayerOrderKey(event), event }
  }
  return { state, ctx, history, key, messages, order: () => state.json.slots.map(s => s.name), initialOrder }
}

test('+ / = raise one layer, - lowers one layer, including keypad shortcuts', () => {
  for (const [key, code, expected] of [['+', 'Equal', ['a', 'c', 'b', 'd']], ['=', 'Equal', ['a', 'c', 'b', 'd']],
    ['-', 'Minus', ['b', 'a', 'c', 'd']], ['Add', 'NumpadAdd', ['a', 'c', 'b', 'd']], ['Subtract', 'NumpadSubtract', ['b', 'a', 'c', 'd']]]) {
    const f = fixture(), result = f.key(key, { code })
    assert(result.handled && result.event.prevented && result.event.stopped)
    assert.deepEqual(f.order(), expected)
    assert.equal(f.state.sel.name, 'b')
  }
})

test('selected blocks and scattered layers keep relative order while moving one step', () => {
  const f = fixture({ selected: ['a', 'b'] }); f.key('+')
  assert.deepEqual(f.order(), ['c', 'a', 'b', 'd'])
  const g = fixture({ selected: ['a', 'c'] }); g.key('+')
  assert.deepEqual(g.order(), ['b', 'a', 'd', 'c'])
  const h = fixture({ selected: ['b', 'c'] }); h.key('-')
  assert.deepEqual(h.order(), ['b', 'c', 'a', 'd'])
})

test('repeated presses stop at the edge without extra undo entries', () => {
  const f = fixture()
  for (let i = 0; i < 5; i++) f.key('+', { repeat: i > 0 })
  assert.deepEqual(f.order(), ['a', 'c', 'd', 'b']); assert.equal(f.history.length, 2)
  const g = fixture({ selected: ['a', 'b', 'c', 'd'] }); g.key('-'); assert.equal(g.history.length, 0)
})

test('setup reordering preserves the existing animation draw order', () => {
  const f = fixture(); f.key('+')
  assert.deepEqual(Ops.decodeDrawOrder(f.order(), f.state.json.animations.idle.drawOrder[0].offsets), f.initialOrder)
})

test('animation mode starts from the posed order and keys this frame without changing setup or earlier keys', () => {
  const posed = ['d', 'a', 'b', 'c'], f = fixture({ mode: 'animate', posed })
  const earlier = JSON.stringify(f.state.json.animations.idle.drawOrder[0])
  f.key('+')
  assert.deepEqual(f.order(), ['a', 'b', 'c', 'd'])
  const keys = f.state.json.animations.idle.drawOrder
  assert.equal(JSON.stringify(keys[0]), earlier)
  assert.equal(keys[1].time, 1)
  assert.deepEqual(Ops.decodeDrawOrder(f.order(), keys[1].offsets), ['d', 'a', 'c', 'b'])
})

test('an attachment targets its slot; an unrelated bone or pick does not reorder layers', () => {
  const f = fixture(); f.state.sel = { kind: 'att', slot: 'b', name: 'image' }; f.key('+')
  assert.deepEqual(f.order(), ['a', 'c', 'b', 'd'])
  for (const kind of ['bone', 'section']) { const g = fixture(); g.state.sel = { kind, name: 'root' }; assert(!g.key('+').handled); assert.equal(g.history.length, 0) }
  const g = fixture(); g.state.pick = {}; assert(!g.key('-').handled)
})

test('text / numeric fields, editable content, modifiers and IME keep their normal input behavior', () => {
  const f = fixture()
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) { f.ctx.document.activeElement = { tagName }; assert(!f.key('-').handled) }
  f.ctx.document.activeElement = { tagName: 'DIV', isContentEditable: true }; assert(!f.key('+').handled)
  f.ctx.document.activeElement = { tagName: 'BODY' }
  for (const opt of ['ctrlKey', 'metaKey', 'altKey', 'isComposing', 'defaultPrevented']) assert(!f.key('+', { [opt]: true }).handled)
  assert(!f.key('+', { target: { isContentEditable: true } }).handled)
  assert(!f.key('x').handled); assert.equal(f.history.length, 0)
})

test('particle editing keeps its skeleton lock', () => {
  const f = fixture(); f.ctx.pfx = {}; assert(f.key('+').handled); assert.equal(f.history.length, 0); assert.equal(f.messages[0], 'locked')
})
