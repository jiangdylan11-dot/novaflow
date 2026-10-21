const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
require(path.join(renderer, 'spine-structure.ops.js'))
const Ops = globalThis.NovaFlowSpineStructureOps
const source = fs.readFileSync(path.join(renderer, 'spine-skeleton-editor.js'), 'utf8')
const code = source.slice(source.indexOf('  function treeRenameTarget('), source.indexOf('  function selectSlotRange('))

function fixture(kind = 'bone', extra = {}) {
  const listeners = {}, errors = [], history = []
  const state = { pick: null, anim: 'idle', json: { bones: [{ name: 'root' }, { name: 'bone1', parent: 'root' }, { name: 'child', parent: 'bone1' }],
    slots: [{ name: 'layer', bone: 'bone1', attachment: 'picture:one' }, { name: 'other', bone: 'root' }],
    skins: [{ name: 'default', attachments: { layer: { 'picture:one': { width: 32, height: 32 }, occupied: { width: 32, height: 32 } }, other: { 'picture:one': { width: 32, height: 32 } } } },
      { name: 'costume', attachments: { layer: { placeholder: { path: 'picture:one', width: 32, height: 32 } } } }, { name: 'spare', attachments: {} }],
    events: { sound: { int: 7 }, occupied: {} },
    ik: [{ name: 'ik1', bones: ['bone1'], target: 'root' }], transform: [{ name: 'transform1', bones: ['bone1'], target: 'root' }], path: [{ name: 'path1', bones: ['bone1'], target: 'layer' }],
    animations: { idle: { bones: { bone1: { rotate: [{ angle: 0 }, { time: 1, angle: 30 }] } }, slots: { layer: { attachment: [{ name: 'picture:one' }] } }, events: [{ name: 'sound', time: 0.5 }],
      ik: { ik1: [{ time: 0, mix: 0.5 }] }, transform: { transform1: [{ time: 0, rotateMix: 0.5 }] }, path: { path1: { position: [{ time: 0, position: 2 }] } } }, walk: {} } } }
  let input = null
  const names = { bone: 'bone1', anim: 'idle', slot: 'layer', att: 'picture:one', ph: 'placeholder', skin: 'costume', event: 'sound', ik: 'ik1', transform: 'transform1', path: 'path1', project: 'project1' }
  const target = { kind, name: names[kind], ...(kind === 'att' ? { slot: 'layer', skin: 'default' } : kind === 'ph' ? { slot: 'layer' } : kind === 'project' ? { projectId: 'p1' } : {}), ...extra }
  const label = { closest: s => s.startsWith('.row[') ? row : null, replaceWith: n => { input = n } }
  const row = { dataset: kind === 'bone' || kind === 'anim' ? { key: (kind === 'bone' ? 'b:' : 'anim:') + target.name } : { rename: JSON.stringify(target) }, querySelector: s => s === '.label' ? label : input }
  const tree = { contains: n => [tree, label, row, input].includes(n), addEventListener: (type, fn) => { listeners[type] = fn } }
  const ctx = vm.createContext({ state, pfx: null, Ops, projects: [{ id: 'p1' }],
    renameProject: (_i, name) => { state.name = name; input = null }, renderProps() {},
    document: { querySelectorAll: () => [row], elementFromPoint: () => label }, $: () => tree,
    bone: name => state.json.bones.find(b => b.name === name),
    h: (_tag, attrs) => ({ value: attrs.value, events: {}, addEventListener(type, fn) { this.events[type] = fn }, focus() { this.focused = true }, select() { this.selected = true } }),
    renderTree: () => { input = null }, status: msg => errors.push(msg),
    edit: (_label, op, after) => {
      try { const result = op(state.json); history.push(state.json); state.json = result.json; after(result); input = null; return result }
      catch (e) { errors.push(e.message); input = null; return null }
    }
  })
  vm.runInContext(code + '\nbindTreeRename()', ctx)
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

test('animation double-click renames in place, keeps its tracks and list position, and updates the active animation', () => {
  const f = fixture('anim'), tracks = JSON.stringify(f.state.json.animations.idle)
  f.click(100); f.click(200); f.input().value = ' 待机动画 '; f.key('Enter')
  assert.equal(f.state.anim, '待机动画'); assert.equal(f.state.sel.kind, 'anim'); assert.equal(f.state.sel.name, '待机动画')
  assert.deepEqual(Object.keys(f.state.json.animations), ['待机动画', 'walk'])
  assert.equal(JSON.stringify(f.state.json.animations['待机动画']), tracks)
  assert.equal(f.history.length, 1)
})

test('animation rename supports cancellation and blur, rejects blank / duplicate names, and preserves a different active animation', () => {
  const f = fixture('anim'); f.click(100); f.click(200); const cancelled = f.input(); cancelled.value = 'discard'; f.key('Escape'); cancelled.events.blur()
  assert.equal(f.history.length, 0); assert.equal(f.state.anim, 'idle')
  const g = fixture('anim'); g.click(100); g.click(200); g.input().value = ' '; g.key('Enter'); assert(g.input()); assert.equal(g.history.length, 0)
  g.input().value = 'walk'; g.key('Enter'); assert.equal(g.history.length, 0); assert(g.errors.some(e => e.includes('已存在')))
  const h = fixture('anim'); h.state.anim = 'walk'; h.click(100); h.click(200); h.input().value = 'new-idle'; h.input().events.blur()
  assert.equal(h.state.anim, 'walk'); assert(h.state.json.animations['new-idle'])
})

test('bone and animation rows with the same name cannot form a double-click pair', () => {
  const f = fixture('anim'); f.click(100); f.row.dataset.key = 'b:idle'; f.click(200); assert.equal(f.input(), null)
})

test('slots rename in the hierarchy and draw-order rows, updating attachments and animated slot references', () => {
  for (const prefix of ['slot:', 'order:']) {
    const f = fixture('slot'); f.row.dataset = { key: prefix + 'layer' }
    f.click(100); f.click(220); assert(f.input()); f.input().value = '新插槽'; f.key('Enter')
    assert.equal(f.state.json.slots[0].name, '新插槽')
    assert(f.state.json.skins[0].attachments['新插槽']['picture:one'])
    assert.equal(f.state.json.animations.idle.slots['新插槽'].attachment[0].name, 'picture:one')
    assert.equal(f.state.json.path[0].target, '新插槽'); assert.equal(f.history.length, 1)
  }
})

test('attachment names with colons rename only within the chosen slot and keep image paths and animation keys', () => {
  const f = fixture('att'); f.state.multiAtts = [{ kind: 'att', slot: 'layer', skin: 'default', name: 'picture:one' }]; f.state.attachmentAnchor = f.state.multiAtts[0]
  f.click(100); f.click(200); f.input().value = '附件:新名字'; f.key('Enter')
  assert.equal(f.state.json.slots[0].attachment, '附件:新名字')
  assert.equal(f.state.json.skins[0].attachments.layer['附件:新名字'].path, 'picture:one')
  assert(f.state.json.skins[0].attachments.other['picture:one'])
  assert.equal(f.state.json.animations.idle.slots.layer.attachment[0].name, '附件:新名字')
  assert.equal(f.state.multiAtts[0].name, '附件:新名字'); assert.equal(f.state.attachmentAnchor.name, '附件:新名字')
})

test('skin placeholders and named skins rename with their contents intact and keep the active skin', () => {
  const f = fixture('ph'); f.click(100); f.click(200); f.input().value = '新占位符'; f.key('Enter')
  assert(f.state.json.skins[1].attachments.layer['新占位符']); assert.equal(f.state.sel.kind, 'ph')
  const g = fixture('skin'); g.state.skin = 'costume'; g.click(100); g.click(200); g.input().value = '新皮肤'; g.input().events.blur()
  assert.equal(g.state.skin, '新皮肤'); assert(g.state.json.skins.find(s => s.name === '新皮肤').attachments.layer.placeholder)
})

test('events and all three constraint kinds rename with animation timelines following', () => {
  for (const kind of ['event', 'ik', 'transform', 'path']) {
    const f = fixture(kind); f.click(100); f.click(200); f.input().value = '新名字'; f.key('Enter')
    assert.equal(f.state.sel.kind, kind); assert.equal(f.state.sel.name, '新名字'); assert.equal(f.history.length, 1)
    if (kind === 'event') { assert.equal(f.state.json.events['新名字'].int, 7); assert.equal(f.state.json.animations.idle.events[0].name, '新名字') }
    else { assert.equal(f.state.json[kind][0].name, '新名字'); assert(f.state.json.animations.idle[kind]['新名字']) }
  }
})

test('newly supported nodes share blank, duplicate, Escape, Enter/blur and modifier handling', () => {
  const occupied = { slot: 'other', att: 'occupied', skin: 'spare', event: 'occupied', ik: 'transform1', transform: 'ik1', path: 'ik1' }
  for (const kind of Object.keys(occupied)) {
    const f = fixture(kind); f.click(100); f.click(200, { ctrlKey: true }); assert.equal(f.input(), null)
    f.click(400); f.click(500); f.input().value = ' '; f.key('Enter'); assert(f.input()); assert.equal(f.history.length, 0)
    f.input().value = '取消'; const input = f.input(); f.key('Escape'); input.events.blur(); assert.equal(f.history.length, 0)
    f.click(800); f.click(900); f.input().value = occupied[kind]; f.key('Enter'); assert.equal(f.history.length, 0); assert(f.errors.some(e => e.includes('已')))
  }
})

test('project double-click uses stable identity and Escape cannot commit on the subsequent blur', () => {
  const f = fixture('project'); f.click(100); f.click(200); f.input().value = '取消'; const cancelled = f.input(); f.key('Escape'); cancelled.events.blur(); assert.equal(f.state.name, undefined)
  f.click(500); f.click(600); f.input().value = ' 新工程 '; const input = f.input(); f.key('Enter'); input.events.blur()
  assert.equal(f.state.name, '新工程'); assert.equal(f.state.sel.name, '新工程')
})

test('fixed section headers and external image-library rows do not resolve as editable skeleton entities', () => {
  const f = fixture()
  assert.equal(f.ctx.treeRenameTarget({ dataset: {} }), null)
  assert.equal(f.ctx.treeRenameTarget({ dataset: { key: 'images:red' } }), null)
})
