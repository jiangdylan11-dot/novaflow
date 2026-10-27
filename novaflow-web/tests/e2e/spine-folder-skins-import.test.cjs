const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../../renderer')
require(path.join(root, 'spine-auto-mesh-attach.js'))
const Attach = globalThis.NovaFlowAutoMeshAttach
const source = fs.readFileSync(path.join(root, 'spine-auto-mesh.panel.js'), 'utf8')
const section = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)))

async function importFolder(json, paths, crop = null, jsonPath = 'project/skeleton.json') {
  const cache = {}, statuses = []
  const file = rel => ({ name: rel.split('/').pop(), webkitRelativePath: rel })
  const files = [{ ...file(jsonPath), text: async () => JSON.stringify(json) }, ...paths.map(file)]
  const ctx = vm.createContext({ window: { NovaFlowAutoMeshAttach: Attach, __NovaFlowSpineImportInlineBridgeCache: cache,
    __NovaFlowSpineImportInlineBridge: { start: async () => true } },
    state: { layers: new Map() }, readFileAsText: f => f.text(), readFileAsDataUrl: async f => f.webkitRelativePath,
    imageSize: async () => ({ width: 32, height: 48 }), trimToArtwork: async () => crop,
    nextFrame: async () => {}, syncLayersFromSource() {},
  })
  const helper = source.includes('  function photoshopImagePlan(') ? section('  function photoshopImagePlan(', '  async function importPhotoshopProject(') : ''
  vm.runInContext(helper + section('  async function importPhotoshopProject(', '  const nextFrame ='), ctx)
  const count = await ctx.importPhotoshopProject(files, s => statuses.push(s))
  return { cache, count, json: JSON.parse(cache.json.text), regions: Attach.parseAtlas(cache.atlas.text) }
}

const skeleton = () => ({ skeleton: { spine: '3.7.94' }, bones: [{ name: 'root' }], slots: [{ name: 'pifu', bone: 'root', attachment: 'pifu' }],
  skins: { default: { pifu: { card: { path: 'base', width: 32, height: 48 } } },
    fangpian8: { pifu: { pifu: { name: 'fangpian8', width: 32, height: 48 } } },
    heitao1: { pifu: { pifu: { type: 'mesh', name: 'heitao1', vertices: [-16,24,16,24,16,-24,-16,-24], uvs: [0,0,1,0,1,1,0,1], triangles: [0,1,2,2,3,0], hull: 4 } } } }, animations: {} })

test('folder import includes every named skin image by path, legacy name, then placeholder key', async () => {
  const j = skeleton(), before = JSON.stringify(j)
  const f = await importFolder(j, ['project/img/base.png', 'project/img/fangpian8.png', 'project/img/heitao1.png', 'project/img/unrelated.png'])
  assert.deepEqual([...f.regions.keys()].sort(), ['base', 'fangpian8', 'heitao1'])
  assert.equal(f.count, 3); assert.equal(f.json.skins.length, 3)
  assert(f.json.skins.find(s => s.name === 'fangpian8').attachments.pifu.pifu)
  assert.equal(JSON.stringify(j), before)
})

test('nested image paths survive the generated atlas and similarly named folders do not collide', async () => {
  const j = skeleton(); j.skins.default.pifu = { card: { path: 'pai/blue_01' }, other: { path: 'other/blue_01' } }; delete j.skins.fangpian8; delete j.skins.heitao1
  const f = await importFolder(j, ['project/img/pai/blue_01.png', 'project/img/other/blue_01.png'])
  assert.deepEqual([...f.regions.keys()].sort(), ['other/blue_01', 'pai/blue_01'])
  for (const name of ['pai/blue_01', 'other/blue_01']) assert(f.cache.images.some(im => im.fileName === f.regions.get(name).page))
})

test('3.8 skin arrays and linked meshes honor explicit paths over legacy names', async () => {
  const j = skeleton(); j.skins = [{ name: 'default', attachments: { pifu: { pifu: { path: 'real', name: 'old' }, linked: { type: 'linkedmesh', path: 'linkedImage', parent: 'pifu' }, clip: { type: 'clipping', name: 'notAnImage' } } } }]
  const f = await importFolder(j, ['project/img/real.png', 'project/img/old.png', 'project/img/linkedImage.png', 'project/img/notAnImage.png'])
  assert.deepEqual([...f.regions.keys()].sort(), ['linkedImage', 'real'])
})

test('folder imports keep original pixels and attachment frames; only export packing may trim them', async () => {
  const j = skeleton(); delete j.skins.default; delete j.skins.heitao1
  const f = await importFolder(j, ['project/img/fangpian8.png'], { dataUrl: 'cropped', x0: 4, y0: 6, width: 20, height: 30, origW: 32, origH: 48 })
  const a = f.json.skins.find(s => s.name === 'fangpian8').attachments.pifu.pifu
  assert.equal(a.name, 'fangpian8'); assert.equal(a.width, 32); assert.equal(a.height, 48)
  assert.equal(f.cache.images[0].dataUrl, 'project/img/fangpian8.png')
  assert(f.regions.has('fangpian8'))
})

test('ambiguous image basenames fail visibly instead of selecting a different folder silently', async () => {
  const j = skeleton(); j.skins = { default: { pifu: { card: { path: 'card' } } } }
  await assert.rejects(importFolder(j, ['project/front/card.png', 'project/back/card.png']), /贴图路径不明确/)
})

test('Photoshop absolute images directory resolves duplicate copies beside the JSON', async () => {
  const j = skeleton(); j.skeleton.images = 'D:\\art\\高级房\\images\\e\\'
  j.skins = { default: { chicken: { chicken: { width: 32, height: 48 } } } }
  const f = await importFolder(j, ['高级房/chicken.png', '高级房/images/e/chicken.png'], null, '高级房/Guandan_Selectroom.json')
  assert.equal(f.count, 1)
  assert.equal(f.cache.images[0].dataUrl, '高级房/images/e/chicken.png')
})

test('relative images directories resolve against the selected JSON including parent paths', async () => {
  const j = skeleton(); j.skeleton.images = '../images/e/'
  j.skins = { default: { chicken: { chicken: {} } } }
  const f = await importFolder(j, ['project/chicken.png', 'project/images/e/chicken.png'], null, 'project/json/skeleton.json')
  assert.equal(f.cache.images[0].dataUrl, 'project/images/e/chicken.png')
})

test('declared image directories keep ambiguity errors when duplicate formats remain in that directory', async () => {
  const j = skeleton(); j.skeleton.images = 'images/e/'
  j.skins = { default: { chicken: { chicken: {} } } }
  await assert.rejects(importFolder(j, ['project/chicken.png', 'project/images/e/chicken.png', 'project/images/e/chicken.webp']), /贴图路径不明确/)
})

test('images with placeholder-key names remain compatible and unused pictures stay excluded', async () => {
  const j = skeleton(); j.skins = { default: { pifu: { card: { width: 32, height: 48 } } } }
  const f = await importFolder(j, ['project/img/card.png', 'project/img/unused.png'])
  assert.deepEqual([...f.regions.keys()], ['card'])
})
