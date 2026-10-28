const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
require('../../renderer/spine-auto-mesh-attach.js')
const Attach = globalThis.NovaFlowAutoMeshAttach
const source = fs.readFileSync(path.resolve(__dirname, '../../renderer/spine-skeleton-editor.js'), 'utf8').replace(/\r\n/g, '\n')
const section = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)))
const json = () => ({ skeleton: { images: 'D:/art/project/images/e/' }, skins: [{ name: 'default', attachments: { chicken: { chicken: {} } } }] })

function handles(name, tree) {
  const children = Object.entries(tree).map(([name, item]) => [name, item === null ? { kind: 'file', name, getFile: async () => ({ name }) } : handles(name, item)])
  return { kind: 'directory', name, async *entries() { yield* children }, async getDirectoryHandle(name) {
    const found = children.find(([key, item]) => key === name && item.kind === 'directory')
    if (!found) throw Error('Directory not found: ' + name)
    return found[1]
  } }
}

function harness() {
  const remembered = [], unpacked = []
  const context = vm.createContext({ state: { json: json(), sections: new Set(), images: new Map() }, imgTree: null,
    Attach, lower: s => String(s).toLowerCase(), rt: {}, pagePixels: new Map(), frameThumbs: new Map(), applyJson() {}, imageFromBlob: async () => ({ naturalWidth: 1, naturalHeight: 1 }), prepareExternalPage: im => im,
    regionList: () => [{ name: 'chicken' }], status() {}, refresh() {}, connectProjectImages: async () => {},
    rememberFolder: handle => remembered.push(handle),
    unpackAtlasInto: async handle => { unpacked.push(handle); return { written: 0, skipped: 1, unpremultiplied: 0 } },
    pictureRels: async root => { const rels = []; const walk = async (dir, prefix) => { for await (const [name, item] of dir.entries()) {
      const rel = prefix + name; if (item.kind === 'directory') await walk(item, rel + '/'); else if (/\.png$/i.test(name)) rels.push(rel)
    } }; await walk(root, ''); return rels },
  })
  vm.runInContext(section('  const IMG_RX =', '  /**\n   * New material into the image folder:') +
    section('  const pageEntry =', '  function readProjectData(') +
    section('  async function useFolderHandle(', '  // The image folder survives') +
    section('  async function useRememberedFolder(', '  async function restoreImageFolder('), context)
  return { context, remembered, unpacked }
}

const tree = () => ({ 'skeleton.json': null, images: { e: { 'chicken.png': null, 'template.png': null }, NovaFlow: { 'a_0000.png': null } } })

async function checkFolder(folder) {
  const root = await folder.list()
  assert.deepEqual(Array.from(root.dirs, d => d.name), ['e', 'NovaFlow'])
  const e = await root.dirs.find(d => d.name === 'e').list()
  const chicken = e.files.find(f => f.name === 'chicken.png')
  assert.equal(chicken.rel, 'e/chicken.png')
  assert.equal(chicken.imageName, 'chicken')
  assert.equal(e.files.find(f => f.name === 'template.png').imageName, undefined)
  const frames = await root.dirs.find(d => d.name === 'NovaFlow').list()
  assert.equal(frames.files[0].rel, 'NovaFlow/a_0000.png')
}

test('PS folder snapshots keep sibling folders while existing attachments retain their image names', async () => {
  const { context } = harness()
  const files = ['project/skeleton.json', 'project/images/e/chicken.png', 'project/images/e/template.png', 'project/images/NovaFlow/a_0000.png']
    .map(rel => ({ name: rel.split('/').pop(), webkitRelativePath: rel }))
  await checkFolder(context.folderFromProjectFiles(files, json(), 'skeleton.json'))
})

test('PS directory handles retain e and NovaFlow instead of descending into e', async () => {
  const { context } = harness()
  await checkFolder(await context.folderForProject(handles('project', tree()), json(), 'skeleton.json'))
})

test('explicitly selected folder remains the visible and remembered root; atlas unpacking targets its image subfolder', async () => {
  const { context, remembered, unpacked } = harness()
  const root = handles('images', tree().images)
  await context.useFolderHandle(root)
  assert.equal(context.state.imageFolder.handle, root)
  assert.equal(remembered[0], root)
  assert.equal(unpacked[0].name, 'e')
  await checkFolder(context.state.imageFolder)
})

test('restoring a remembered root also restores image aliases without losing sibling folders', async () => {
  const { context } = harness()
  const root = handles('images', tree().images)
  await context.useRememberedFolder(context.state, root)
  await checkFolder(context.state.imageFolder)
})

test('folder replacements update the rendered and saved images while keeping skeleton and animation unchanged', async () => {
  const { context: c } = harness()
  const original = c.state.json
  c.state.atlasText = Attach.synthesizeAtlas([{ fileName: 'chicken.png', width: 12, height: 8 }])
  c.state.images.set('chicken.png', { blob: { old: true } })
  let file = { size: 21, lastModified: 1 }
  const folder = { list: async () => ({ dirs: [], files: [{ rel: 'chicken.png', file: async () => file }] }) }
  c.state.imageFolder = folder
  assert.equal(await c.refreshFolderPictures(c.state, folder), 1)
  assert.equal(c.state.json, original)
  assert.equal(c.state.images.get('chicken.png').blob, file)
  assert.equal(Attach.parseAtlas(c.state.atlasText).size, 1)
  const revision = c.state.imageFolderGen
  assert.equal(await c.refreshFolderPictures(c.state, folder), 0, 'unchanged files are not decoded again')
  file = { size: 21, lastModified: 2 }
  assert.equal(await c.refreshFolderPictures(c.state, folder), 1, 'a same-size overwrite refreshes pixels')
  assert.equal(c.state.images.get('chicken.png').blob, file)
  assert.equal(c.state.imageFolderGen, revision + 1)
  assert.equal(c.state.atlasText.split('\n').filter(l => l === 'chicken.png').length, 1, 'old standalone pages do not accumulate')
})

test('replacing one packed region keeps other regions on its page and does not duplicate its old region', async () => {
  const { context: c } = harness()
  c.state.atlasText = 'page.png\nsize: 20,10\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nchicken\n  xy: 0,0\n  size: 10,10\n  orig: 10,10\nother\n  xy: 10,0\n  size: 10,10\n  orig: 10,10\n'
  c.state.images.set('page.png', { blob: 'packed' })
  const folder = { list: async () => ({ dirs: [], files: [{ rel: 'chicken.png', file: async () => ({ size: 21, lastModified: 1 }) }] }) }
  c.state.imageFolder = folder
  await c.refreshFolderPictures(c.state, folder)
  const regions = Attach.parseAtlas(c.state.atlasText)
  assert.equal(regions.size, 2)
  assert.equal(regions.get('other').page, 'page.png')
  assert.notEqual(regions.get('chicken').page, 'page.png')
  assert.equal(c.state.atlasText.split('\n').filter(l => l === 'chicken').length, 1)
  assert.equal(c.state.images.get('page.png').blob, 'packed')
})

test('explicit external references win over similarly named files in another folder and retain PMA bytes', async () => {
  const { context: c } = harness(), png = { size: 2, lastModified: 2 }, jpg = { size: 3, lastModified: 3 }
  const folder = { list: async () => ({ dirs: [], files: [
    { rel: 'JPG/chicken.png', imageName: 'chicken', file: async () => jpg },
    { rel: 'PNG/chicken.png', imageName: 'chicken', file: async () => png },
  ] }) }
  c.state.imageFolder = folder
  c.state.atlasText = Attach.synthesizeAtlas([{ fileName: 'chicken.png', width: 1, height: 1 }])
  c.state.images.set('chicken.png', { fileName: 'chicken.png', blob: { size: 1, lastModified: 1 }, sourceFolder: folder, sourcePath: 'PNG/chicken.png', pma: true })
  await c.refreshFolderPictures(c.state, folder)
  assert.equal(c.state.images.get('chicken.png').blob, png)
  assert.equal(c.state.images.get('chicken.png').pma, true)
})

test('overwriting an external packed atlas page updates its pixels without changing region coordinates', async () => {
  const { context: c } = harness(), file = { size: 20, lastModified: 2 }
  const folder = { list: async () => ({ dirs: [], files: [{ rel: 'page.png', file: async () => file }] }) }
  c.state.imageFolder = folder
  c.state.atlasText = 'page.png\nsize: 20,10\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nchicken\n  xy: 0,0\n  size: 10,10\nother\n  xy: 10,0\n  size: 10,10\n'
  const original = c.state.atlasText
  c.state.images.set('page.png', { fileName: 'page.png', blob: { size: 10, lastModified: 1 }, sourceFolder: folder, sourcePath: 'page.png', pma: true })
  assert.equal(await c.refreshFolderPictures(c.state, folder), 1)
  assert.equal(c.state.atlasText, original)
  assert.equal(c.state.images.get('page.png').blob, file)
  assert.equal(c.state.images.get('page.png').pma, true)
  assert.equal(await c.refreshFolderPictures(c.state, folder), 0)
})
