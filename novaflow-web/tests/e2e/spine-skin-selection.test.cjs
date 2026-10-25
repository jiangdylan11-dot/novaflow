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
  const names = ['red', 'card:one', 'card2', 'card3', 'empty']
  const state = { json: Ops.prepare({ bones: [{ name: 'root' }], slots: [], animations: {},
    skins: [{ name: 'default', attachments: {} }, ...names.map(name => ({ name, attachments: {} }))] }),
    skin: 'default', sel: null, multi: [], multiSlots: [], multiAtts: [], multiCons: [], multiSkins: [], skinAnchor: null,
    temp: new Map(), selHistory: [], selIdx: -1 }
  const rows = names.map(name => ({ dataset: { skinName: name } })), previews = [], history = [], errors = []
  const ctx = vm.createContext({ state, Ops, rt: {}, meCache: null, weCache: null,
    document: { querySelectorAll: () => rows, querySelector: () => null }, refresh() {}, revealInTree() {},
    setSkin: name => { state.skin = name; previews.push(name) }, status: msg => errors.push(msg),
    edit: (_label, op, after) => { try { const r = op(state.json); history.push(state.json); state.json = r.json; if (!r.json.skins.some(s => s.name === state.skin)) state.skin = 'default'; if (after) after(r); ctx.validateSelection() } catch (e) { errors.push(e.message) } }
  })
  vm.runInContext(section('  function validateSelection(', '  function selectedBones(')
    + section('  function sameAttachment(', '  function propsKind(')
    + section('  function deleteSelection(', '  function newChildBone('), ctx)
  return { state, ctx, names, rows, previews, history, errors, click: (i, e = {}) => ctx.selectSkin(names[i], e), picked: () => plain(ctx.selectedSkins()) }
}

test('Ctrl / Meta add and toggle skin rows without changing the preview; a plain click resets both', () => {
  const f = fixture(); f.click(0); f.click(2, { ctrlKey: true }); f.click(4, { metaKey: true })
  assert.deepEqual(f.picked(), ['red', 'card2', 'empty']); assert.equal(f.state.skin, 'red'); assert.deepEqual(f.previews, ['red'])
  f.click(2, { ctrlKey: true }); assert.deepEqual(f.picked(), ['red', 'empty'])
  f.click(1); assert.deepEqual(f.picked(), ['card:one']); assert.equal(f.state.skin, 'card:one')
  f.click(1, { ctrlKey: true }); assert.deepEqual(f.picked(), []); assert.equal(f.state.sel, null)
})

test('Shift keeps a stable range anchor; Ctrl+Shift adds a range in visible tree order', () => {
  const f = fixture(); f.click(1); f.click(3, { shiftKey: true })
  assert.deepEqual(f.picked(), ['card:one', 'card2', 'card3']); assert.equal(f.state.skinAnchor, 'card:one'); assert.equal(f.state.skin, 'card:one')
  f.click(4, { shiftKey: true }); assert.deepEqual(f.picked(), ['card:one', 'card2', 'card3', 'empty'])
  f.click(0, { shiftKey: true }); assert.deepEqual(f.picked(), ['red', 'card:one'])
  f.click(4, { ctrlKey: true }); f.click(3, { ctrlKey: true, shiftKey: true })
  assert.deepEqual(f.picked(), ['red', 'card:one', 'empty', 'card3'])
})

test('range and Ctrl+A follow visible named skins and never select default', () => {
  const f = fixture(); f.rows.splice(2, 1); f.click(0); f.click(4, { shiftKey: true })
  assert.deepEqual(f.picked(), ['red', 'card:one', 'card3', 'empty'])
  f.click(1); assert(f.ctx.selectAllSkins()); assert.deepEqual(f.picked(), ['red', 'card:one', 'card3', 'empty'])
  for (const mode of ['meshEdit', 'weightEdit', 'pathEdit', 'clipEdit', 'pick']) { f.state[mode] = {}; assert(!f.ctx.selectAllSkins()); f.state[mode] = null }
})

test('selection history restores the group and anchor; removed skins and type switches clear stale selections', () => {
  const f = fixture(); f.click(0); f.click(2, { shiftKey: true }); const entry = f.state.selHistory.at(-1)
  f.click(4); f.ctx.restoreSelection(entry); assert.deepEqual(f.picked(), ['red', 'card:one', 'card2']); assert.equal(f.state.skinAnchor, 'red')
  f.state.json.skins = f.state.json.skins.filter(s => !['red', 'card2'].includes(s.name)); f.ctx.validateSelection()
  assert.deepEqual(f.picked(), ['card:one']); assert.equal(f.state.sel.name, 'card:one'); assert.equal(f.state.skinAnchor, null)
  f.ctx.select({ kind: 'bone', name: 'root' }, false); assert.deepEqual(f.picked(), []); assert.equal(f.state.multiSkins.length, 0)
})

test('batch delete is one undo step and resets a deleted preview to default', () => {
  const f = fixture(); f.click(0); f.click(2, { ctrlKey: true }); f.ctx.deleteSelection()
  assert.equal(f.history.length, 1); assert.equal(f.errors.length, 0); assert.equal(f.state.skin, 'default')
  assert.deepEqual(f.state.json.skins.map(s => s.name), ['default', 'card:one', 'card3', 'empty'])
  assert.equal(f.state.sel, null); assert.equal(f.state.multiSkins.length, 0)
  f.state.json = f.history.pop(); f.ctx.validateSelection(); assert.equal(f.state.json.skins.length, 6)
})

function linkedFixture() {
  let j = Ops.prepare({ bones: [{ name: 'root' }], slots: [{ name: 'slot', bone: 'root', attachment: 'image' }], animations: { idle: {} },
    skins: [{ name: 'default', attachments: {} }, ...['owner', 'child', 'unrelated'].map(name => ({ name, attachments: {} }))] })
  j = Ops.addRegionAttachment(j, 'owner', 'slot', { name: 'image', width: 32, height: 32 }).json
  j = Ops.regionToMesh(j, 'owner', 'slot', 'image').json
  j = Ops.fillPlaceholder(j, 'child', 'slot', 'image', { path: 'other', width: 32, height: 32 }).json
  j = Ops.keyDeform(j, 'idle', 'owner', 'slot', 'image', 0, [1, 0, 0, 0, 0, 0, 0, 0]).json
  return j
}

test('a selected linked mesh and its owner can be deleted together in either order', () => {
  for (const names of [['owner', 'child'], ['child', 'owner']]) {
    const j = linkedFixture(), before = JSON.stringify(j), r = Ops.deleteSkins(j, names)
    assert.deepEqual(r.json.skins.map(s => s.name), ['default', 'unrelated'])
    assert(!r.json.animations.idle.deform?.owner)
    assert.equal(JSON.stringify(j), before)
  }
})

test('links from unselected skins block the entire deletion, and default remains protected', () => {
  const j = linkedFixture(), before = JSON.stringify(j)
  assert.throws(() => Ops.deleteSkins(j, ['owner', 'unrelated']), /child.*链接/)
  assert.throws(() => Ops.deleteSkin(j, 'owner'), /child.*链接/)
  assert.throws(() => Ops.deleteSkins(j, ['default', 'child']), /default/)
  assert.equal(JSON.stringify(j), before)
})
