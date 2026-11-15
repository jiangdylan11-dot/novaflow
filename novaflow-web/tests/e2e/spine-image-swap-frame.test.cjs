const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const renderer = path.resolve(__dirname, '../../renderer')
require(path.join(renderer, 'spine-auto-mesh-attach.js'))
require(path.join(renderer, 'spine-structure.ops.js'))
const Attach = globalThis.NovaFlowAutoMeshAttach, Ops = globalThis.NovaFlowSpineStructureOps
const src = fs.readFileSync(path.join(renderer, 'spine-skeleton-editor.js'), 'utf8').replace(/\r\n/g, '\n')
const section = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)))
function rgba(w, h, x = 0, y = 0, width = w, height = h) {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let j = y; j < y + height; j++) for (let i = x; i < x + width; i++) out[(j * w + i) * 4 + 3] = 255
  return out
}

test('a cropped lower-resolution copy keeps the old asymmetric transparent margins', () => {
  const f = Attach.replacementFrame(rgba(320, 440, 13, 19, 287, 396), 320, 440, rgba(160, 221), 160, 221)
  assert.equal(f.width, 320); assert.equal(f.height, 440)
  assert(Math.abs(f.destination.x - 13) < 1); assert(Math.abs(f.destination.y - 19) < 1)
  assert(Math.abs(f.destination.width - 287) < 1); assert.equal(f.destination.height, 396)
  assert(Math.abs(f.destination.width / f.destination.height - 160 / 221) < 1e-9, 'keep artwork aspect ratio')
})

test('same canvas, resized full canvas, and images without old margins keep their normal UV mapping', () => {
  assert.equal(Attach.replacementFrame(rgba(80, 120, 4, 6, 72, 108), 80, 120, rgba(80, 120), 80, 120), null)
  assert.equal(Attach.replacementFrame(rgba(80, 120, 4, 6, 72, 108), 80, 120, rgba(40, 60, 2, 3, 36, 54), 40, 60), null)
  assert.equal(Attach.replacementFrame(rgba(80, 120), 80, 120, rgba(40, 60), 40, 60), null)
  assert.equal(Attach.replacementFrame(new Uint8ClampedArray(80 * 120 * 4), 80, 120, rgba(40, 60), 40, 60), null)
})

test('a different aspect ratio fits inside the old content frame without stretching', () => {
  const f = Attach.replacementFrame(rgba(100, 160, 10, 20, 80, 120), 100, 160, rgba(20, 20), 20, 20)
  assert.deepEqual(f.destination, { x: 10, y: 40, width: 80, height: 80 })
})

function fixture(sizes = { old: { width: 80, height: 120 }, new: { width: 40, height: 60 } }) {
  let j = Ops.prepare({ bones: [{ name: 'root' }], slots: [{ name: 'pifu', bone: 'root', attachment: 'pifu' }],
    skins: [{ name: 'default', attachments: {} }, { name: 'owner', attachments: { pifu: { pifu: { width: 80, height: 120, path: 'old' } } } },
      { name: 'picked', attachments: {} }, { name: 'sibling', attachments: {} }], animations: { idle: {} } })
  j = Ops.regionToMesh(j, 'owner', 'pifu', 'pifu').json
  j = Ops.fillPlaceholder(j, 'picked', 'pifu', 'pifu', { path: 'old', width: 80, height: 120 }).json
  j = Ops.fillPlaceholder(j, 'sibling', 'pifu', 'pifu', { path: 'old', width: 80, height: 120 }).json
  j = Ops.keyDeform(j, 'idle', 'owner', 'pifu', 'pifu', 0, [1, 0, 0, 0, 0, 0, 0, 0]).json
  const sel = { kind: 'att', skin: 'picked', slot: 'pifu', name: 'pifu' }
  const state = { json: j, sel, images: new Map(), atlasText: 'old atlas', atlasChanged: false }, history = []
  const ctx = vm.createContext({ state, rt: {}, Ops, lower: s => s.toLowerCase(), regionSize: (n) => sizes[n] || null,
    status() {}, edit: (_label, op, after) => { history.push({ json: state.json, atlasText: state.atlasText }); const r = op(state.json); state.json = r.json; after(r) } })
  vm.runInContext(section('  const pictureOf =', '  /**\n   * A name that came')
    + section('  function namedAfterPicture(', '  // 换图')
    + section('  function swapImage(', '  /** 换图 for'), ctx)
  return { ctx, state, history, sel, original: j }
}

test('swapping a linked mesh changes only its picture in one undo step, preserving sharing, weights and deform keys, with no extra image', () => {
  const f = fixture()
  f.ctx.swapImage(f.sel, 'new', {})
  const picked = f.state.json.skins.find(s => s.name === 'picked').attachments.pifu.pifu
  assert.equal(picked.type, 'linkedmesh'); assert.equal(picked.parent, 'pifu'); assert.equal(picked.skin, 'owner'); assert.equal(picked.path, 'new')
  for (const skin of ['owner', 'sibling']) assert.deepEqual(f.state.json.skins.find(s => s.name === skin), f.original.skins.find(s => s.name === skin))
  assert.deepEqual(f.state.json.animations, f.original.animations)
  assert.equal(f.history.length, 1); assert.equal(f.state.atlasText, 'old atlas'); assert.equal(f.state.images.size, 0)
  assert.deepEqual(f.history[0].json, f.original)
})

test('a region takes the new picture size (Spine), keeping position, rotation and scale', () => {
  const sizes = { old: { width: 80, height: 120 }, icon: { width: 64, height: 64 } }
  let j = Ops.prepare({ bones: [{ name: 'root' }], slots: [{ name: 's', bone: 'root', attachment: 'old' }],
    skins: [{ name: 'default', attachments: { s: { old: { x: 3, y: 4, rotation: 20, scaleX: 2, width: 80, height: 120 } } } }] })
  const state = { json: j }
  const ctx = vm.createContext({ state, rt: {}, Ops, lower: s => s.toLowerCase(), regionSize: (n) => sizes[n] || null,
    status() {}, edit: (_label, op, after) => { const r = op(state.json); state.json = r.json; after(r) } })
  vm.runInContext(section('  const pictureOf =', '  /**\n   * A name that came') + section('  function namedAfterPicture(', '  // 换图') + section('  function swapImage(', '  /** 换图 for'), ctx)
  ctx.swapImage({ kind: 'att', skin: 'default', slot: 's', name: 'old' }, 'icon', {})
  const a = state.json.skins[0].attachments.s.icon
  assert.equal(a.width, 64); assert.equal(a.height, 64); assert.equal(a.x, 3); assert.equal(a.y, 4); assert.equal(a.rotation, 20); assert.equal(a.scaleX, 2)
})

test('a mesh scales along its picture axes to the new size; deform keys scale with it', () => {
  let j = Ops.prepare({ bones: [{ name: 'root' }], slots: [{ name: 's', bone: 'root', attachment: 'a' }],
    skins: [{ name: 'default', attachments: { s: { a: { x: 5, y: 7, rotation: 30, width: 100, height: 50 } } } }], animations: { idle: {} } })
  j = Ops.regionToMesh(j, 'default', 's', 'a').json
  j = Ops.keyDeform(j, 'idle', 'default', 's', 'a', 0, [0, 0, 0, 0, 10, 0, 0, 0]).json
  const got = Ops.fitAttachmentToImage(j, 'default', 's', 'a', 100, 50, 40, 80).json
  let ref = Ops.prepare({ bones: [{ name: 'root' }], slots: [{ name: 's', bone: 'root' }], skins: [{ name: 'default', attachments: { s: { a: { x: 5, y: 7, rotation: 30, width: 40, height: 80 } } } }] })
  ref = Ops.regionToMesh(ref, 'default', 's', 'a').json
  const m = got.skins[0].attachments.s.a
  m.vertices.forEach((v, i) => assert(Math.abs(v - ref.skins[0].attachments.s.a.vertices[i]) < 0.01))
  assert.deepEqual(m.uvs, ref.skins[0].attachments.s.a.uvs)
  const key = got.animations.idle.deform.default.s.a[0]
  // (10, 0) at 30°: along the picture's width ×0.4, across ×1.6
  const c = Math.cos(Math.PI / 6), sn = Math.sin(Math.PI / 6), du = 10 * c * 0.4, dv = -10 * sn * 1.6
  assert(Math.abs(key.vertices[0] - (du * c - dv * sn)) < 0.01); assert(Math.abs(key.vertices[1] - (du * sn + dv * c)) < 0.01)
})

test('swap all changes every use without renaming the placeholder', () => {
  const f = fixture()
  f.ctx.swapImage(f.sel, 'new', { all: true })
  for (const skin of f.state.json.skins.slice(1)) assert.equal(skin.attachments.pifu.pifu.path, 'new')
  assert.equal(f.state.json.slots[0].attachment, 'pifu')
})

test('generated atlas pages keep the public image name separate from the private page filename', () => {
  const regions = Attach.parseAtlas(Attach.synthesizeAtlas([{ fileName: '__nf_swap_1.png', name: 'new picture', width: 80, height: 120 }]))
  assert.equal(regions.get('new picture').page, '__nf_swap_1.png')
  assert.equal(regions.get('new picture').origW, 80)
})

test('old swap copies left in an image folder are never listed, picked or exported', () => {
  assert.match(src, /const INTERNAL_PICTURE = \/\^_\+nf_\/i/)
  assert.match(src, /if \(!INTERNAL_PICTURE\.test\(f\.name\)\) out\.push/)
  assert.match(src, /if \(generated && !usedPages\.has\(lower\(fileName\)\)\) continue/)
  assert(!/__nf_swap_\$\{k\}/.test(src), 'swapping makes no image file')
})
