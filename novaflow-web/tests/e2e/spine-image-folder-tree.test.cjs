const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
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
  const context = vm.createContext({ state: { json: json(), sections: new Set() }, imgTree: null,
    regionList: () => [{ name: 'chicken' }], status() {}, refresh() {},
    rememberFolder: handle => remembered.push(handle),
    unpackAtlasInto: async handle => { unpacked.push(handle); return { written: 0, skipped: 1, unpremultiplied: 0 } },
    pictureRels: async root => { const rels = []; const walk = async (dir, prefix) => { for await (const [name, item] of dir.entries()) {
      const rel = prefix + name; if (item.kind === 'directory') await walk(item, rel + '/'); else if (/\.png$/i.test(name)) rels.push(rel)
    } }; await walk(root, ''); return rels },
  })
  vm.runInContext(section('  const IMG_RX =', '  /**\n   * New material into the image folder:') +
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
