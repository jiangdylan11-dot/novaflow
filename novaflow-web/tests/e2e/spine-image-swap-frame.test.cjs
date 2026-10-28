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

function fixture(prepared) {
  let j = Ops.prepare({ bones: [{ name: 'root' }], slots: [{ name: 'pifu', bone: 'root', attachment: 'pifu' }],
    skins: [{ name: 'default', attachments: {} }, { name: 'owner', attachments: { pifu: { pifu: { width: 80, height: 120, path: 'old' } } } },
      { name: 'picked', attachments: {} }, { name: 'sibling', attachments: {} }], animations: { idle: {} } })
  j = Ops.regionToMesh(j, 'owner', 'pifu', 'pifu').json
  j = Ops.fillPlaceholder(j, 'picked', 'pifu', 'pifu', { path: 'old', width: 80, height: 120 }).json
  j = Ops.fillPlaceholder(j, 'sibling', 'pifu', 'pifu', { path: 'old', width: 80, height: 120 }).json
  j = Ops.keyDeform(j, 'idle', 'owner', 'pifu', 'pifu', 0, [1, 0, 0, 0, 0, 0, 0, 0]).json
  const sel = { kind: 'att', skin: 'picked', slot: 'pifu', name: 'pifu' }
  const state = { json: j, sel, images: new Map(), atlasText: 'old atlas', atlasChanged: false }, history = []
  const ctx = vm.createContext({ state, rt: {}, Ops, prepareSwapImage: async () => prepared, lower: s => s.toLowerCase(), regionSize: () => ({ width: 40, height: 60 }),
    status() {}, edit: (_label, op, after) => { history.push({ json: state.json, atlasText: state.atlasText }); const r = op(state.json); state.json = r.json; after(r) } })
  vm.runInContext(section('  const pictureOf =', '  /**\n   * A name that came')
    + section('  function namedAfterPicture(', '  // 换图')
    + section('  async function swapImage(', '  /** 换图 for'), ctx)
  return { ctx, state, history, sel, original: j }
}

test('swapping a linked mesh changes its texture frame in one undo step, preserving sharing, weights and deform keys', async () => {
  const f = fixture({ path: 'new', atlasText: 'aligned atlas', width: 80, height: 120, image: { fileName: 'aligned.png' } })
  await f.ctx.swapImage(f.sel, 'new', {})
  const picked = f.state.json.skins.find(s => s.name === 'picked').attachments.pifu.pifu
  assert.equal(picked.type, 'linkedmesh'); assert.equal(picked.parent, 'pifu'); assert.equal(picked.skin, 'owner'); assert.equal(picked.path, 'new')
  for (const skin of ['owner', 'sibling']) assert.deepEqual(f.state.json.skins.find(s => s.name === skin), f.original.skins.find(s => s.name === skin))
  assert.deepEqual(f.state.json.animations, f.original.animations)
  assert.equal(f.history.length, 1); assert.equal(f.history[0].atlasText, 'old atlas'); assert.equal(f.state.atlasText, 'aligned atlas')
  assert.deepEqual(f.history[0].json, f.original)
})

test('swap all applies the same prepared frame to every use without renaming the placeholder', async () => {
  const f = fixture({ path: 'new', atlasText: 'aligned atlas', width: 80, height: 120, image: { fileName: 'aligned.png' } })
  await f.ctx.swapImage(f.sel, 'new', { all: true })
  for (const skin of f.state.json.skins.slice(1)) assert.equal(skin.attachments.pifu.pifu.path, 'new')
  assert.equal(f.state.json.slots[0].attachment, 'pifu')
  assert.deepEqual(f.state.json.animations, f.original.animations)
})

test('generated atlas pages keep the public image name separate from the private page filename', () => {
  const regions = Attach.parseAtlas(Attach.synthesizeAtlas([{ fileName: '__nf_swap_1.png', name: 'new picture', width: 80, height: 120 }]))
  assert.equal(regions.get('new picture').page, '__nf_swap_1.png')
  assert.equal(regions.get('new picture').origW, 80)
})

test('preparing the frame keeps a used replacement intact and allocates a separate region and page', async () => {
  const f = fixture(null)
  f.state.json.skins.push({ name: 'unrelated', attachments: { other: { new: { path: 'new' } } } })
  const old = { originalWidth: 80, originalHeight: 120 }, next = { originalWidth: 40, originalHeight: 60 }
  const regions = new Map([['old', old], ['new', next]])
  const state = { ...f.state, images: new Map([['__nf_swap_1.png', {}]]),
    projectImageRefs: [{ fileName: '__nf_swap_3.png', path: 'missing-old.png' }],
    atlasText: Attach.synthesizeAtlas([{ fileName: 'new.png', width: 40, height: 60 }, { fileName: '__nf_swap_2.png', name: 'unused-old', width: 1, height: 1 }]) }
  const canvas = () => ({ getContext: () => ({ putImageData() {}, drawImage() {} }), toBlob: cb => cb({}) })
  const ctx = vm.createContext({ state, Attach, rt: { atlas: { findRegion: name => regions.get(name) } }, document: { createElement: canvas },
    ImageData: class {}, imageFromBlob: async () => ({}), lower: s => s.toLowerCase(),
    regionPixels: r => r === old ? rgba(80, 120, 4, 6, 72, 108) : rgba(40, 60) })
  vm.runInContext(section('  const pictureOf =', '  /**\n   * A name that came')
    + section('  async function prepareSwapImage(', '  /**\n   * 换图:'), ctx)
  const before = state.atlasText
  const prepared = await ctx.prepareSwapImage(state.json, f.sel, 'new')
  assert.equal(prepared.path, 'new_2'); assert.equal(prepared.image.fileName, '__nf_swap_4.png', 'reserve historical pages even when their pixels are missing')
  assert.equal(state.atlasText, before, 'async preparation does not modify the project')
  const result = Attach.parseAtlas(prepared.atlasText)
  assert.equal(result.get('new').page, 'new.png'); assert.equal(result.get('new').origW, 40)
  assert.equal(result.get('new_2').origW, 80); assert.equal(result.get('new_2').origH, 120)
})
