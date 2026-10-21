const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
require(path.join(renderer, 'spine-structure.ops.js'))
const Ops = globalThis.NovaFlowSpineStructureOps
const source = fs.readFileSync(path.join(renderer, 'spine-skeleton-editor.js'), 'utf8')
const code = source.slice(source.indexOf('  function renameTreeBone('), source.indexOf('  function selectSlotRange('))

function fixture() {
  const listeners = {}, errors = [], history = []
  const state = { pick: null, json: { bones: [{ name: 'root' }, { name: 'bone1', parent: 'root' }, { name: 'child', parent: 'bone1' }],
    slots: [{ name: 'layer', bone: 'bone1' }], animations: { idle: { bones: { bone1: { rotate: [{ angle: 0 }, { time: 1, angle: 30 }] } } } } } }
  let input = null
  const label = { closest: s => s === '.row[data-key]' ? row : null, replaceWith: n => { input = n } }
  const row = { dataset: { key: 'b:bone1' }, querySelector: s => s === '.label' ? label : input }
  const tree = { contains: n => [tree, label, row, input].includes(n), addEventListener: (type, fn) => { listeners[type] = fn } }
  const ctx = vm.createContext({ state, pfx: null, Ops,
    document: { querySelectorAll: () => [row], elementFromPoint: () => label }, $: () => tree,
    bone: name => state.json.bones.find(b => b.name === name),
    h: (_tag, attrs) => ({ value: attrs.value, events: {}, addEventListener(type, fn) { this.events[type] = fn }, focus() { this.focused = true }, select() { this.selected = true } }),
    renderTree: () => { input = null }, status: msg => errors.push(msg),
    edit: (_label, op, after) => {
      try { const result = op(state.json); history.push(state.json); state.json = result.json; after(result); input = null; return result }
      catch (e) { errors.push(e.message); input = null; return null }
    }
  })
  vm.runInContext(code + '\nbindTreeBoneRename()', ctx)
  const click = (time, opts = {}) => {
    const event = { target: label, button: 0, timeStamp: time, clientX: 100, clientY: 100,
      preventDefault() { this.prevented = true }, stopImmediatePropagation() { this.stopped = true }, ...opts }
    listeners.click(event)
    return event
  }
  const key = (key, opts = {}) => input.events.keydown({ key, stopPropagation() {}, preventDefault() {}, ...opts })
  return { state, ctx, row, tree, listeners, click, key, input: () => input, errors, history }
}

test('double-click survives row replacement; a single click keeps normal selection behavior', () => {
  const f = fixture()
  assert(!f.click(100).stopped)
  assert.equal(f.input(), null)
  assert(f.click(220).stopped)
  assert(f.input().focused && f.input().selected)
})

test('Enter renames references once, including the blur generated when the input is removed', () => {
  const f = fixture(); f.click(100); f.click(200)
  const input = f.input(); input.value = ' 主骨骼 '
  f.key('Enter'); input.events.blur()
  assert.equal(f.history.length, 1)
  assert.equal(f.state.json.bones[1].name, '主骨骼')
  assert.equal(f.state.json.bones[2].parent, '主骨骼')
  assert.equal(f.state.json.slots[0].bone, '主骨骼')
  assert(f.state.json.animations.idle.bones['主骨骼'])
  assert(!f.state.json.animations.idle.bones.bone1)
  assert.equal(f.state.sel.name, '主骨骼')
})

test('Escape cancels and subsequent blur does not commit; unchanged names create no history', () => {
  for (const cancel of [true, false]) {
    const f = fixture(); f.click(100); f.click(200); const input = f.input()
    if (cancel) input.value = 'discard'
    f.key(cancel ? 'Escape' : 'Enter'); input.events.blur()
    assert.equal(f.history.length, 0); assert.equal(f.state.json.bones[1].name, 'bone1')
  }
})

test('blur saves, blank input stays editable, duplicate names leave the rig intact, IME Enter does not commit', () => {
  const f = fixture(); f.click(100); f.click(200)
  f.input().value = ' '; f.key('Enter'); assert(f.input()); assert.equal(f.history.length, 0)
  f.input().value = '新名字'; f.key('Enter', { isComposing: true }); assert.equal(f.history.length, 0)
  f.input().events.blur(); assert.equal(f.state.json.bones[1].name, '新名字')
  const g = fixture(); g.click(100); g.click(200); g.input().value = 'root'; g.key('Enter')
  assert.equal(g.history.length, 0); assert.equal(g.state.json.bones[1].name, 'bone1'); assert(g.errors.some(e => e.includes('已存在')))
})

test('slow clicks, movement, modifiers and selection / particle tools do not start renaming', () => {
  for (const opts of [{ timeStamp: 800 }, { clientX: 120 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
    const f = fixture(); f.click(100); f.click(200, opts); assert.equal(f.input(), null)
  }
  for (const mode of ['pick', 'pfx']) {
    const f = fixture(); if (mode === 'pick') f.state.pick = {}; else f.ctx.pfx = {}
    f.click(100); f.click(200); assert.equal(f.input(), null)
  }
})

test('native double-click on the stable tree resolves the current bone row at the pointer', () => {
  const f = fixture()
  f.listeners.dblclick({ target: f.tree, clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {} })
  assert(f.input())
})
