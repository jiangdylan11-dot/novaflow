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
    SLOT_TRACKS:()=>[], BONE_TRACKS:()=>[], wireAudioEventDrop() {}, keyBtn() {}, meshKeyEnd() {}, consKeyEnd() {},
    bone: name => j.bones.find(b => b.name === name), animOn: () => state.mode === 'animate', isSel: () => false,
    selectedAttachments: () => [], selectedSkins: () => [], allConstraints: () => [{ kind: 'transform', c: { name: 'follow' } }],
    drawOrderNow: () => ['slot'], clipRanges: () => new Map(), slotOf: name => j.slots.find(s => s.name === name),
    caret() {}, visDot() {}, wireDrag() {}, boneIcon() {}, consOf: () => [], consRowEnd() {},
    newSkin() {}, newEvent() {}, newAnimation() {},
    renderAudioNode: rows => rows.push(h('div', { class: 'row', 'data-key': 'audio' }, '音频')),
    renderImagesNode: rows => rows.push(h('div', { class: 'row', 'data-key': 'images' }, '图片')),
    closeMenu() {}, mountMenu: n => { ctx.menu = n }, innerHeight: 800,
  })
  vm.runInContext(section('  const TREE_FILTERS =', '\n\n  const $')
    + src.match(/^  const byName = .+$/m)[0] + '\n'
    + section('  function slotContents(', '  /** Drag & drop in the tree')
    + section('  function searchMatches(', '  function focusRename(')
    + section('  function renderTree(', '  /** Enter in the search box:')
    + section('  function filterMenu(', '\n\n  /**'), ctx)
  vm.runInContext('state.filter = Object.fromEntries(TREE_FILTERS.map(([key]) => [key, true]))', ctx)
  return { state, ctx, tree, only(...keys) { for (const key in state.filter) state.filter[key] = keys.includes(key) },
    keys() { ctx.renderTree(); return tree.rows.map(r => r.attrs['data-key']).filter(Boolean) },
    rigKeys() { return this.keys().filter(k => /^(att:|ph:|b:|slot:)/.test(k)) },
    texts() { const text = n => typeof n === 'string' ? n : (n?.kids || []).map(text).join(' '); return tree.rows.map(text).join(' ') } }
}

test('mesh-only finds regular, linked, and current-skin placeholder meshes without bones or slots', () => {
  const f = fixture(); f.only('mesh'); f.state.collapsed.add('s:slot'); f.state.collapsed.add('b:root')
  assert.deepEqual(f.rigKeys(), ['att:default:slot:mesh', 'att:default:slot:linked', 'ph:slot:placeholder'])
  f.state.skin = 'red'; assert.deepEqual(f.rigKeys(), ['att:default:slot:mesh', 'att:default:slot:linked'])
})

test('hidden slots promote matching attachments under visible bones and ignore the hidden slot collapse', () => {
  const f = fixture(); f.only('bones', 'mesh'); f.state.collapsed.add('s:slot')
  assert.deepEqual(f.rigKeys(), ['b:root', 'att:default:slot:mesh', 'att:default:slot:linked', 'ph:slot:placeholder'])
  f.state.collapsed.add('b:root'); assert.deepEqual(f.rigKeys(), ['b:root'])
})

test('slot-only and placeholder-only are independent categories; placeholders never duplicate', () => {
  const f = fixture(); f.only('slots'); assert.deepEqual(f.rigKeys(), ['slot:slot'])
  f.only('placeholder'); assert.deepEqual(f.rigKeys(), ['ph:slot:placeholder', 'ph:slot:empty'])
  f.only('placeholder', 'mesh'); assert.equal(f.keys().filter(k => k === 'ph:slot:placeholder').length, 1)
  f.state.skin = 'default'; f.only('mesh'); assert.deepEqual(f.rigKeys(), ['att:default:slot:mesh', 'att:default:slot:linked'])
})

test('search and type filters compose even when bones and slots are hidden', () => {
  const f = fixture(); f.only('mesh'); f.state.search = 'blueImage'
  assert.deepEqual(f.keys(), ['ph:slot:placeholder'])
  f.state.search = 'image'; assert.deepEqual(f.keys(), ['ph:slot:placeholder'])
  f.state.search = 'not-found'; assert.deepEqual(f.keys(), []); assert(f.texts().includes('当前筛选无匹配节点'))
  f.only('slots'); f.state.search = 'mesh'; assert.deepEqual(f.rigKeys(), ['slot:slot'])
})

test('management sections remain available independently of hierarchy type filters', () => {
  const f = fixture()
  for (const filter of [[], ['mesh'], ['images']]) {
    f.only(...filter)
    const keys = f.keys()
    for (const key of ['transform:follow', 'skin:blue', 'event:end', 'anim:idle']) assert(keys.includes(key))
  }
  f.only(); assert.deepEqual(f.rigKeys(), [])
})

test('one image switch controls ordinary image attachments and the image library', () => {
  const f = fixture(); f.only('images')
  assert.deepEqual(f.rigKeys(), ['att:default:slot:image', 'ph:slot:empty']); assert(f.keys().includes('images'))
  f.state.skin = 'red'; assert.deepEqual(f.rigKeys(), ['att:default:slot:image', 'ph:slot:placeholder'])
  f.only('mesh'); assert(!f.keys().includes('images')); assert(!f.rigKeys().includes('att:default:slot:image'))
})

test('menu contains the eight hierarchy filters and both bulk actions', () => {
  const f = fixture(), btn = { getBoundingClientRect: () => ({ right: 600, bottom: 100 }) }
  f.ctx.filterMenu(btn)
  const labels = () => f.ctx.menu.kids.filter(n => n.tag === 'button').map(n => n.kids.filter(x => typeof x === 'string').join(''))
  assert.deepEqual(labels(), ['骨骼', '插槽', '图片', '网格', '剪裁', '边界框', '路径', '皮肤占位符', '全部显示', '全部隐藏'])
  const click = label => f.ctx.menu.kids.find(n => n.tag === 'button' && n.kids.includes(label)).attrs.onclick({ stopPropagation() {} })
  click('全部隐藏'); assert(Object.values(f.state.filter).every(v => !v)); assert.deepEqual(f.rigKeys(), [])
  click('网格'); assert.deepEqual(f.rigKeys(), ['att:default:slot:mesh', 'att:default:slot:linked', 'ph:slot:placeholder'])
  click('全部显示'); assert(Object.values(f.state.filter).every(Boolean)); assert(f.keys().includes('skin:blue'))
})

test('imported bounding boxes and points remain accessible in the full tree and are excluded from region/mesh-only results', () => {
  const f = fixture(); f.state.json.skins[0].attachments.slot.importedBox = { type: 'boundingbox' }
  f.state.json.skins[0].attachments.slot.importedPoint = { type: 'point' }
  assert(f.keys().includes('att:default:slot:importedBox'))
  assert(f.keys().includes('att:default:slot:importedPoint'))
  for (const type of ['images', 'mesh']) { f.only(type); assert(!f.keys().includes('att:default:slot:importedBox')); assert(!f.keys().includes('att:default:slot:importedPoint')) }
})

test('bounding box filter works independently of image, mesh and clipping filters', () => {
  const f = fixture(); f.state.json.skins[0].attachments.slot.hit = { type: 'boundingbox' };
  f.only('boundingbox'); assert.deepEqual(f.rigKeys(), ['att:default:slot:hit']);
  f.only('clipping'); assert.deepEqual(f.rigKeys(), []);
})

test('animation mode hides both resource groups, while setup restores them',()=>{
 const f=fixture();assert(f.keys().includes('images'));assert(f.keys().includes('audio'));
 f.state.mode='animate';assert(!f.keys().includes('images'));assert(!f.keys().includes('audio'));assert(f.keys().includes('event:end'));
 f.state.mode='setup';assert(f.keys().includes('images'));assert(f.keys().includes('audio'));
});
