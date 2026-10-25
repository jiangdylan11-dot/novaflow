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
  const json = Ops.prepare({ bones: [{ name: 'root' }], slots: [{ name: 'pifu', bone: 'root', attachment: 'pifu' }],
    skins: [{ name: 'default', attachments: {} }, ...['dawang', 'fangpian1', 'fangpian2', 'empty'].map((name, i) => ({ name,
      attachments: i === 3 ? {} : { pifu: { pifu: { path: name, width: 64, height: 32, x: i * 10 } } } }))], animations: {} })
  const state = { json, skin: 'fangpian2', mode: 'setup', sel: { kind: 'ph', slot: 'pifu', name: 'pifu' } }
  const history = [], edits = [], picks = []
  const h = (tag, props, ...children) => ({ tag, props, children: children.flat(Infinity).filter(x => x != null) })
  const ctx = vm.createContext({ state, Ops, rt: {}, h,
    skinOf: name => state.json.skins.find(s => s.name === name), animOn: () => false,
    textInput: value => h('input', { value }), ibtn: (title, label) => h('button', { title: label }, title),
    field: (label, child) => h('field', {}, label, child),
    check: (label, checked, onchange) => h('check', { label, checked, onchange }),
    btn: (label, onclick, props) => h('button', { ...props, label, onclick }),
    edit: (_label, op, after) => { const result = op(state.json); history.push(state.json); state.json = result.json; if (after) after(result); return result },
    enterMeshEdit: sel => edits.push(plain(sel)), openSwapImage() {}, deleteSelection() {},
    openImagePicker: (title, done) => picks.push({ title, done }),
    fillPlaceholder: (skin, slot, name, image) => { state.json = Ops.fillPlaceholder(state.json, skin, slot, name, image).json }
  })
  vm.runInContext(section('  function layerSel()', '  const attJson')
    + section('  function attPanel(', '  // ---------- 剪裁')
    + section('  function placeholderAttachment(', '  // ---------- 动画'), ctx)
  const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' ? [node, ...nodes(node.children || [])] : []
  const panel = () => nodes(ctx.placeholderPanel(state.sel))
  const control = label => panel().find(n => n.props.label === label)
  return { state, ctx, history, edits, picks, panel, control,
    att: skin => state.json.skins.find(s => s.name === skin).attachments.pifu?.pifu }
}

test('placeholder properties show only the active image and expose its mesh controls', () => {
  const f = fixture(), before = JSON.stringify(f.state.json)
  const panel = JSON.stringify(f.panel())
  assert(panel.includes('fangpian2')); assert(!panel.includes('fangpian1')); assert(!panel.includes('dawang'))
  assert.equal(f.control('网格').props.checked, false)
  assert.equal(f.control('编辑网格').props.disabled, true)
  assert.equal(JSON.stringify(f.state.json), before, 'rendering must not remove any skins')
})

test('mesh conversion, editing and undo target the active skin without changing its siblings', () => {
  const f = fixture(), before = plain(f.state.json)
  f.control('网格').props.onchange(true)
  assert.equal(f.att('fangpian2').type, 'mesh')
  assert.deepEqual(f.att('fangpian1'), before.skins.find(s => s.name === 'fangpian1').attachments.pifu.pifu)
  assert(Ops.isPlaceholder(f.state.json, 'pifu', 'pifu'))
  assert.equal(f.control('编辑网格').props.disabled, false)
  f.control('编辑网格').props.onclick()
  assert.deepEqual(f.edits[0], { kind: 'att', skin: 'fangpian2', slot: 'pifu', name: 'pifu' })
  assert.equal(f.history.length, 1)
  f.state.json = f.history.pop()
  assert.deepEqual(plain(f.state.json), before)
  f.state.skin = 'fangpian1'; f.control('网格').props.onchange(true)
  assert.equal(f.att('fangpian1').type, 'mesh'); assert.equal(f.att('fangpian2').type, undefined)
  f.control('网格').props.onchange(false)
  assert.equal(f.att('fangpian1').type, undefined)
  assert.equal(f.att('fangpian1').path, 'fangpian1')
})

test('weight tool resolves the selected placeholder in the current skin, with default fallback', () => {
  const f = fixture()
  assert.equal(f.ctx.layerSel().skin, 'fangpian2')
  f.state.skin = 'fangpian1'; assert.equal(f.ctx.layerSel().skin, 'fangpian1')
  f.state.skin = 'empty'; assert.equal(f.ctx.layerSel(), null)
  f.state.json.skins[0].attachments.pifu = { pifu: { path: 'fallback', width: 10, height: 20 } }
  assert.equal(f.ctx.layerSel().skin, 'default')
  assert(f.control('放图'), 'fallback offers a way to fill the active skin')
  f.control('网格').props.onchange(true)
  assert.equal(f.att('default').type, 'mesh'); assert.equal(f.att('empty'), undefined)
})

test('an empty current skin offers fill without borrowing a different skin, and clear preserves siblings', () => {
  const f = fixture(), before = plain(f.att('fangpian1'))
  f.state.skin = 'empty'
  assert.equal(f.control('网格'), undefined)
  f.control('放图').props.onclick()
  assert(f.picks[0].title.includes('empty'))
  f.picks[0].done({ path: 'new-image', width: 20, height: 30 })
  assert.equal(f.att('empty').path, 'new-image')
  f.control('清空图片').props.onclick()
  assert.equal(f.att('empty'), undefined)
  assert.deepEqual(plain(f.att('fangpian1')), before)
  assert(Ops.isPlaceholder(f.state.json, 'pifu', 'pifu'))
})
