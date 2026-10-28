const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../../renderer')
require(path.join(root, 'spine-auto-mesh-attach.js'))
const Attach = globalThis.NovaFlowAutoMeshAttach
const source = fs.readFileSync(path.join(root, 'spine-skeleton-editor.js'), 'utf8')
const fn = name => source.match(new RegExp('^  (?:async )?function ' + name + '\\([^]*?^  \\}', 'm'))[0]

function harness(pixels = []) {
  const textures = [], labels = [], uploads = new WeakMap()
  const c = vm.createContext({ console, Uint8Array, Float32Array, Math, Attach, externalPageUploads: uploads,
    lower: s => String(s).toLowerCase(), state: { images: new Map() }, rt: { missingRegions: new Set() },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({
      drawImage() {}, getImageData: () => ({ data: pixels }), fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText: s => labels.push(s),
    }) }) },
    pageEntry: (images, name) => images.get(String(name).toLowerCase()),
    pageTexture: (_gl, img) => { const t = { getImage: () => img, dispose() { t.disposed = true }, setFilters() {}, setWraps() {} }; textures.push(t); return t },
  })
  vm.runInContext(fs.readFileSync(path.join(root, 'vendor/spine/spine-webgl-3.8.js'), 'utf8'), c)
  vm.runInContext(fn('prepareExternalPage') + '\n' + fn('tolerantLoader'), c)
  return { c, textures, labels, uploads }
}

test('stale PMA metadata on a straight external PNG cannot expose white under transparent pixels', () => {
  const { c, uploads } = harness([255, 255, 255, 128, 0, 0, 0, 0])
  const img = { naturalWidth: 2, naturalHeight: 1 }, blob = {}, im = { img, blob, fileName: 'pic.png', sourceFolder: {}, pma: true }
  const atlas = Attach.synthesizeAtlas([{ fileName: 'pic.png', width: 2, height: 1 }])
  const out = c.prepareExternalPage(im, atlas)
  assert.equal(out.pma, false, 'straight soft pixels must be premultiplied on texture upload')
  assert.equal(out.blob, blob, 'original bytes are retained')
  assert.equal(uploads.has(img), false)
})

test('black translucent pixels retain their alpha and PMA preview clears only invisible RGB', () => {
  const { c, uploads } = harness([0, 0, 0, 153, 0, 0, 0, 0])
  const img = { naturalWidth: 2, naturalHeight: 1 }, im = { img, fileName: 'black.png', sourceFolder: {}, pma: true }
  const atlas = Attach.synthesizeAtlas([{ fileName: 'black.png', width: 2, height: 1 }])
  assert.equal(c.prepareExternalPage(im, atlas), im)
  assert(uploads.has(img), 'canvas upload strips invisible white RGB from an ordinary PNG')
  assert.equal(im.pma, true, 'black with alpha is valid in either representation')
  const explicit = { ...im, img: {} }
  c.prepareExternalPage(explicit, atlas.replace('repeat: none', 'repeat: none\npma: true'))
  assert.equal(uploads.has(explicit.img), false, 'explicit atlas PMA stays authoritative')
})

test('missing page and region use MISSING textures without changing region, mesh or bone geometry', () => {
  const { c, textures, labels } = harness()
  const spine = c.spine
  const text = Attach.synthesizeAtlas([{ fileName: 'pic.png', width: 64, height: 32 }])
  const atlas = new spine.TextureAtlas(text, () => ({ getImage: () => ({ width: 64, height: 32 }), setFilters() {}, setWraps() {}, dispose() {} }))
  const available = new Map([['pic.png', { img: {} }]])
  const json = { skeleton: { spine: '3.8.99' }, bones: [{ name: 'root', x: 17, y: 9 }],
    slots: [{ name: 's', bone: 'root', attachment: 'pic' }],
    skins: [{ name: 'default', attachments: { s: { pic: { width: 64, height: 32, x: 3, y: 5 },
      mesh: { type: 'mesh', path: 'pic', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], vertices: [-32, 16, 32, 16, 32, -16], hull: 3 } } } }], animations: { idle: {} } }
  const read = images => new spine.SkeletonJson(c.tolerantLoader(atlas, {}, images)).readSkeletonData(json)
  const loaded = read(available), missing = read(new Map())
  const a = new spine.Skeleton(loaded), b = new spine.Skeleton(missing)
  a.updateWorldTransform(); b.updateWorldTransform()
  assert.deepEqual(Array.from(a.slots[0].attachment.offset), Array.from(b.slots[0].attachment.offset))
  const meshA = loaded.defaultSkin.getAttachment(0, 'mesh'), meshB = missing.defaultSkin.getAttachment(0, 'mesh')
  assert.deepEqual(Array.from(meshA.vertices), Array.from(meshB.vertices))
  assert.deepEqual(Array.from(meshA.triangles), Array.from(meshB.triangles))
  assert.equal(b.bones[0].worldX, a.bones[0].worldX)
  assert(labels.includes('MISSING'))
  assert.equal(textures.length, 1, 'missing attachments in one atlas share one texture')
  assert.notEqual(b.slots[0].attachment.region.texture, a.slots[0].attachment.region.texture)
  const loader = c.tolerantLoader(atlas, {}, new Map())
  assert(loader.newRegionAttachment(null, 'unknown', 'no-such-region').region.texture)
  atlas.dispose()
  assert.equal(textures[0].disposed, true)
})
