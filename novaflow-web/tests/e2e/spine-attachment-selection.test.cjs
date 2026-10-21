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
const plain = value => JSON.parse(JSON.stringify(value))

function fixture() {
  const atts = Object.fromEntries(['frame:0', 'frame1', 'frame2', 'frame3', 'frame4'].map(name => [name, { path: 'image', width: 32, height: 32 }]))
  const state = { json: Ops.prepare({ bones: [{ name: 'root' }], slots: [{ name: 'slot:frames', bone: 'root', attachment: 'frame:0' }, { name: 'other', bone: 'root' }],
    skins: [{ name: 'default', attachments: { 'slot:frames': atts, other: { frame1: { path: 'image', width: 32, height: 32 } } } }], animations: { idle: {} } }),
    sel: null, multi: [], multiSlots: [], multiCons: [], multiAtts: [], attachmentAnchor: null, temp: new Map(), selHistory: [], selIdx: -1 }
  const identities = Object.keys(atts).map(name => ({ kind: 'att', skin: 'default', slot: 'slot:frames', name }))
  const rows = [...identities, { kind: 'att', skin: 'default', slot: 'other', name: 'frame1' }].map(a => ({ dataset: { attSkin: a.skin, attSlot: a.slot, attName: a.name } }))
  const history = [], errors = [], questions = []
  const ctx = vm.createContext({ state, Ops, rt: {}, meCache: null, weCache: null,
    document: { querySelectorAll: () => rows, querySelector: () => null }, refresh() {}, revealInTree() {},
    status: message => errors.push(message), askDialog: (_title, _lines, answer) => questions.push(answer),
    edit: (_label, op, after) => { try { const r = op(state.json); history.push(state.json); state.json = r.json; if (after) after(r); ctx.validateSelection() } catch (e) { errors.push(e.message) } }
  })
  vm.runInContext(section('  function validateSelection(', '  function selectedBones(')
    + section('  function sameAttachment(', '  function propsKind(')
    + section('  function duplicateAttachments(', '  /** A small 是')
    + section('  function deleteSelection(', '  function newChildBone('), ctx)
  const click = (i, modifiers = {}) => ctx.selectAttachment(identities[i], modifiers)
  return { state, ctx, click, identities, rows, history, errors, questions, picked: () => plain(ctx.selectedAttachments()).map(a => a.name) }
}

test('Ctrl / Meta toggles attachments; a plain click resets and switching type clears the group', () => {
  const f = fixture(); f.click(0); f.click(2, { ctrlKey: true }); f.click(4, { metaKey: true })
  assert.deepEqual(f.picked(), ['frame:0', 'frame2', 'frame4'])
  f.click(2, { ctrlKey: true }); assert.deepEqual(f.picked(), ['frame:0', 'frame4'])
  f.click(1); assert.deepEqual(f.picked(), ['frame1'])
  f.click(1, { ctrlKey: true }); assert.equal(f.state.sel, null)
  f.click(0); f.click(2, { ctrlKey: true }); f.ctx.select({ kind: 'bone', name: 'root' }, false)
  assert.equal(f.state.multiAtts.length, 0); assert.equal(f.state.attachmentAnchor, null)
})

test('Shift keeps its anchor across successive ranges; Ctrl+Shift adds instead of replacing', () => {
  const f = fixture(); f.click(1); f.click(3, { shiftKey: true }); assert.deepEqual(f.picked(), ['frame1', 'frame2', 'frame3'])
  f.click(4, { shiftKey: true }); assert.deepEqual(f.picked(), ['frame1', 'frame2', 'frame3', 'frame4'])
  f.click(0, { shiftKey: true }); assert.deepEqual(f.picked(), ['frame:0', 'frame1'])
  f.click(4, { ctrlKey: true }); f.click(3, { ctrlKey: true, shiftKey: true })
  assert.deepEqual(f.picked(), ['frame:0', 'frame1', 'frame4', 'frame3'])
})

test('range uses visible same-slot rows, supports colon names, and selection leaves displayed attachment unchanged', () => {
  const f = fixture(); f.rows.splice(2, 1); f.click(0); f.click(4, { shiftKey: true })
  assert.deepEqual(f.picked(), ['frame:0', 'frame1', 'frame3', 'frame4'])
  assert.equal(f.state.json.slots[0].attachment, 'frame:0')
  f.ctx.selectAttachment({ kind: 'att', skin: 'default', slot: 'other', name: 'frame1' }, { shiftKey: true })
  assert.equal(f.picked().length, 1); assert.equal(f.state.sel.slot, 'other')
})

test('Ctrl+A selects the current visible slot group and does not take over mesh editing or picks', () => {
  const f = fixture(); f.click(2); assert(f.ctx.selectAllAttachments()); assert.equal(f.picked().length, 5)
  for (const mode of ['meshEdit', 'weightEdit', 'clipEdit', 'pathEdit', 'pick']) {
    f.state[mode] = {}; assert(!f.ctx.selectAllAttachments()); f.state[mode] = null
  }
})

test('selection history restores both the group and range anchor; missing attachments are filtered', () => {
  const f = fixture(); f.click(0); f.click(2, { shiftKey: true }); const entry = f.state.selHistory.at(-1)
  f.click(4); f.ctx.restoreSelection(entry)
  assert.deepEqual(f.picked(), ['frame:0', 'frame1', 'frame2']); assert.equal(f.state.attachmentAnchor.name, 'frame:0')
  delete f.state.json.skins[0].attachments['slot:frames'].frame1; f.ctx.validateSelection()
  assert.deepEqual(f.picked(), ['frame:0', 'frame2'])
  delete f.state.json.skins[0].attachments['slot:frames'].frame2; f.ctx.validateSelection()
  assert.equal(f.state.sel.kind, 'slot'); assert.equal(f.picked().length, 0)
})

test('batch duplicate copies all selected attachments in one undo step and selects the copies', () => {
  const f = fixture(); f.click(1); f.click(3, { ctrlKey: true }); f.ctx.duplicateAttachments()
  assert.equal(f.history.length, 1); assert.equal(f.picked().length, 2)
  assert(f.picked().every(n => !['frame1', 'frame3'].includes(n)))
  assert.equal(Object.keys(f.state.json.skins[0].attachments['slot:frames']).length, 7)
  assert.equal(f.state.json.slots[0].attachment, 'frame:0')
})

test('batch delete is one atomic undo step, removing only selected attachments', () => {
  const f = fixture(); f.click(1); f.click(3, { ctrlKey: true }); f.ctx.deleteSelection()
  assert.equal(f.history.length, 1); assert.deepEqual(Object.keys(f.state.json.skins[0].attachments['slot:frames']), ['frame:0', 'frame2', 'frame4'])
  assert.equal(f.state.sel.kind, 'slot'); assert.equal(f.state.multiAtts.length, 0)
  assert.equal(Object.keys(f.history[0].skins[0].attachments['slot:frames']).length, 5)
})

test('linked children delete before selected parents; unselected dependents block the entire batch', () => {
  for (const includeChild of [true, false]) {
    const f = fixture(), map = f.state.json.skins[0].attachments['slot:frames']
    map.frame1 = { type: 'mesh', vertices: [0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], hull: 3 }
    map.frame2 = { type: 'linkedmesh', parent: 'frame1' }
    f.click(1); f.click(includeChild ? 2 : 3, { ctrlKey: true }); const before = JSON.stringify(f.state.json)
    f.ctx.deleteSelection()
    if (includeChild) { assert.equal(f.history.length, 1); assert(!f.state.json.skins[0].attachments['slot:frames'].frame1); assert(!f.state.json.skins[0].attachments['slot:frames'].frame2) }
    else { assert.equal(f.history.length, 0); assert.equal(JSON.stringify(f.state.json), before); assert(f.errors.some(e => e.includes('链接'))); assert.equal(f.picked().length, 2) }
  }
})

test('duplicate asks once about deform keys and honors the answer for all meshes', () => {
  const f = fixture(), map = f.state.json.skins[0].attachments['slot:frames']
  for (const name of ['frame1', 'frame2']) map[name] = { type: 'mesh', vertices: [0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 0, 1], triangles: [0, 1, 2], hull: 3 }
  f.state.json.animations.idle.deform = { default: { 'slot:frames': { frame1: [{ time: 0, vertices: [1, 0] }], frame2: [{ time: 0, vertices: [2, 0] }] } } }
  f.click(1); f.click(2, { ctrlKey: true }); f.ctx.duplicateAttachments()
  assert.equal(f.questions.length, 1); assert.equal(f.history.length, 0); f.questions[0](true)
  assert.equal(f.history.length, 1)
  for (const n of f.picked()) assert.equal(f.state.json.animations.idle.deform.default['slot:frames'][n].length, 1)
})
