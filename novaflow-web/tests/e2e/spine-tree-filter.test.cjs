const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
require(path.join(renderer, 'spine-structure.ops.js'))
const Ops = globalThis.NovaFlowSpineStructureOps
const src = fs.readFileSync(path.join(renderer, 'spine-skeleton-editor.js'), 'utf8').replace(/\r\n/g, '\n')
const section = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a))) + '\n'

function fixture() {
  const j = Ops.prepare({ bones: [{ name: 'root' }], slots: [{ name: 'slot', bone: 'root' }], events: { end: {} }, animations: { idle: {} },
    skins: [{ name: 'default', attachments: { slot: { image: { width: 32, height: 32 }, mesh: { type: 'mesh' }, linked: { type: 'linkedmesh', parent: 'mesh' } } } },
      { name: 'blue', attachments: { slot: { placeholder: { type: 'mesh', path: 'blueImage' }, empty: { width: 32, height: 32 } } } },
      { name: 'red', attachments: { slot: { placeholder: { path: 'redImage', width: 32, height: 32 } } } }] })
  const state = { json: j, skin: 'blue', name: 'filter QA', filter: {}, collapsed: new Set(), sections: new Set(), hiddenSlots: new Set(), hiddenBones: new Set(),
    multi: [], multiSlots: [], roles: new Map(), search: '', sel: null }
  const tree = { scrollTop: 0, append(n) { this.rows = n.kids }, textContent: '' }
  const h = (tag, attrs, ...kids) => ({ tag, attrs: attrs || {}, kids: kids.flat(Infinity).filter(x => x != null) })
  const ctx = vm.createContext({ state, Ops, rt: {}, h, $: () => tree, projects: [], activeProject: 0, KEY_COLOR: { event: '#fff' },
    ICON: new Proxy({}, { get: (_, key) => String(key) }), skinOf: name => j.skins.find(s => s.name === name),
    bone: name => j.bones.find(b => b.name === name), animOn: () => false, isSel: () => false,
    selectedAttachments: () => [], selectedSkins: () => [], allConstraints: () => [{ kind: 'transform', c: { name: 'follow' } }],
    drawOrderNow: () => ['slot'], clipRanges: () => new Map(), slotOf: name => j.slots.find(s => s.name === name),
    caret() {}, visDot() {}, wireDrag() {}, boneIcon() {}, consOf: () => [], consRowEnd() {},
    newSkin() {}, newEvent() {}, newAnimation() {},
    renderImagesNode: rows => rows.push(h('div', { class: 'row', 'data-key': 'images' }, '图片')),
    closeMenu() {}, mountMenu: n => { ctx.menu = n }, innerHeight: 800,
  })
  vm.runInContext(section('  const TREE_FILTERS =', '\n\n  const $')
    + section('  function slotContents(', '  /** Drag & drop in the tree')
    + section('  function searchMatches(', '  function focusRename(')
    + section('  function renderTree(', '  /** Enter in the search box:')
    + section('  function filterMenu(', '\n\n  /**'), ctx)
  vm.runInContext('state.filter = Object.fromEntries(TREE_FILTERS.map(([key]) => [key, true]))', ctx)
  return { state, ctx, tree, only(...keys) { for (const key in state.filter) state.filter[key] = keys.includes(key) },
    keys() { ctx.renderTree(); return tree.rows.map(r => r.attrs['data-key']).filter(Boolean) },
    texts() { const text = n => typeof n === 'string' ? n : (n?.kids || []).map(text).join(' '); return tree.rows.map(text).join(' ') } }
}

test('mesh-only finds regular, linked, and current-skin placeholder meshes without bones or slots', () => {
  const f = fixture(); f.only('mesh'); f.state.collapsed.add('s:slot'); f.state.collapsed.add('b:root')
  assert.deepEqual(f.keys(), ['att:default:slot:mesh', 'att:default:slot:linked', 'ph:slot:placeholder'])
  assert(!f.texts().includes('动画')); assert(!f.texts().includes('皮肤'))
  f.state.skin = 'red'; assert.deepEqual(f.keys(), ['att:default:slot:mesh', 'att:default:slot:linked'])
})

test('hidden slots promote matching attachments under visible bones and ignore the hidden slot collapse', () => {
  const f = fixture(); f.only('bones', 'mesh'); f.state.collapsed.add('s:slot')
  assert.deepEqual(f.keys(), ['b:root', 'att:default:slot:mesh', 'att:default:slot:linked', 'ph:slot:placeholder'])
  f.state.collapsed.add('b:root'); assert.deepEqual(f.keys(), ['b:root'])
})

test('slot-only and placeholder-only are independent categories; placeholders never duplicate', () => {
  const f = fixture(); f.only('slots'); assert.deepEqual(f.keys(), ['slot:slot'])
  f.only('placeholder'); assert.deepEqual(f.keys(), ['ph:slot:placeholder', 'ph:slot:empty'])
  f.only('placeholder', 'mesh'); assert.equal(f.keys().filter(k => k === 'ph:slot:placeholder').length, 1)
  f.state.skin = 'default'; f.only('mesh'); assert.deepEqual(f.keys(), ['att:default:slot:mesh', 'att:default:slot:linked'])
})

test('search and type filters compose even when bones and slots are hidden', () => {
  const f = fixture(); f.only('mesh'); f.state.search = 'blueImage'
  assert.deepEqual(f.keys(), ['ph:slot:placeholder'])
  f.state.search = 'image'; assert.deepEqual(f.keys(), ['ph:slot:placeholder'])
  f.state.search = 'not-found'; assert.deepEqual(f.keys(), []); assert(f.texts().includes('当前筛选无匹配节点'))
  f.only('slots'); f.state.search = 'mesh'; assert.deepEqual(f.keys(), ['slot:slot'])
})

test('constraints, skins, events, animations and images obey their own switches', () => {
  const f = fixture()
  for (const [filter, key] of [['cons', 'transform:follow'], ['skins', 'skin:blue'], ['events', 'event:end'], ['anims', 'anim:idle'], ['images', 'images']]) {
    f.only(filter); const keys = f.keys(); assert(keys.includes(key)); assert(keys.every(k => filter === 'skins' ? k.startsWith('skin:') : k === key))
  }
  f.only(); assert.deepEqual(f.keys(), []); assert(f.texts().includes('当前筛选无匹配节点'))
})

test('menu matches supported tree types, removes bounding boxes and points, and all-hide/all-show control every switch', () => {
  const f = fixture(), btn = { getBoundingClientRect: () => ({ right: 600, bottom: 100 }) }
  f.ctx.filterMenu(btn)
  const labels = () => f.ctx.menu.kids.filter(n => n.tag === 'button').map(n => n.kids.filter(x => typeof x === 'string').join(''))
  assert(!labels().includes('边界框')); assert(!labels().includes('端点')); assert(labels().includes('约束')); assert(labels().includes('图片'))
  const click = label => f.ctx.menu.kids.find(n => n.tag === 'button' && n.kids.includes(label)).attrs.onclick({ stopPropagation() {} })
  click('全部隐藏'); assert(Object.values(f.state.filter).every(v => !v)); assert.deepEqual(f.keys(), [])
  click('网格'); assert.deepEqual(f.keys(), ['att:default:slot:mesh', 'att:default:slot:linked', 'ph:slot:placeholder'])
  click('全部显示'); assert(Object.values(f.state.filter).every(Boolean)); assert(f.keys().includes('skin:blue'))
})

test('imported bounding boxes and points remain accessible in the full tree and are excluded from region/mesh-only results', () => {
  const f = fixture(); f.state.json.skins[0].attachments.slot.importedBox = { type: 'boundingbox' }
  f.state.json.skins[0].attachments.slot.importedPoint = { type: 'point' }
  assert(f.keys().includes('att:default:slot:importedBox'))
  assert(f.keys().includes('att:default:slot:importedPoint'))
  for (const type of ['region', 'mesh']) { f.only(type); assert(!f.keys().includes('att:default:slot:importedBox')); assert(!f.keys().includes('att:default:slot:importedPoint')) }
})
