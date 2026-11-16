// node --test novaflow-web/tests/e2e/spine-canvas-drop-import.test.cjs
// A project dropped on the 骨骼动画 canvas: the editor's stage hands the drop to the left panel's
// import (spine-auto-mesh.panel.js importDrop). Three shapes: JSON + ATLAS + PNG together,
// a PS export folder, a Foart project (the .foart or the folder that holds it).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../../renderer')
const panel = fs.readFileSync(path.join(root, 'spine-auto-mesh.panel.js'), 'utf8')
const editor = fs.readFileSync(path.join(root, 'spine-skeleton-editor.js'), 'utf8')
const section = (source, a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)))

function harness({ busy = false } = {}) {
  const calls = { imported: [], openedFile: [], openedFolder: [], said: [] }
  let settled
  const done = new Promise((resolve) => { settled = resolve })
  const api = {
    openProjectFile: async (file, handle) => { calls.openedFile.push({ file, handle }); return 2 },
    openProjectFolder: async (handle) => { calls.openedFolder.push(handle); return 1 }
  }
  const ctx = vm.createContext({
    state: { busy },
    window: { NovaFlowSkeletonEditor: { ready: async () => api } },
    sayHere: (text, tone) => calls.said.push([text, tone]),
    guardWith: () => async (fn) => { try { await fn() } catch (e) { calls.error = e } finally { settled() } },
    entryFiles: async (roots) => roots.flatMap((r) => r.files),
    rememberProjectFolder: (files) => { calls.remembered = files },
    importPhotoshopProject: async (files) => { calls.imported.push(Array.from(files, (f) => f.name)); return files.some((f) => /\.atlas$/.test(f.name)) ? { pages: 1 } : 3 },
    diag: () => {}
  })
  vm.runInContext(section(panel, '    const openDroppedFoart =', "    button.addEventListener('dragover'") + '\nthis.importDrop = importDrop', ctx)
  return { calls, done, drop: (items) => ctx.importDrop({ dataTransfer: { items, files: items.flatMap((i) => i.entry.files) } }) }
}
const fileItem = (name) => {
  const file = { name }
  const handle = { kind: 'file', name, getFile: async () => file }
  return { kind: 'file', entry: { isFile: true, files: [file] }, handle, webkitGetAsEntry() { return this.entry }, getAsFileSystemHandle: async () => handle }
}
const folderItem = (name, names) => {
  const handle = { kind: 'directory', name, async *entries() { for (const n of names.filter((x) => !x.includes('/'))) yield [n, { kind: 'file', name: n }] } }
  return { kind: 'file', entry: { isDirectory: true, files: names.map((n) => ({ name: n.split('/').pop(), webkitRelativePath: name + '/' + n })) }, handle, webkitGetAsEntry() { return this.entry }, getAsFileSystemHandle: async () => handle }
}

test('JSON + ATLAS + PNG dropped together load as one animation project', async () => {
  const h = harness()
  assert.equal(h.drop([fileItem('hero.json'), fileItem('hero.atlas'), fileItem('hero.png')]), true)
  await h.done
  assert.deepEqual(h.calls.imported, [['hero.json', 'hero.atlas', 'hero.png']])
  assert.equal(h.calls.openedFile.length + h.calls.openedFolder.length, 0)
  assert.deepEqual(h.calls.said.at(-1), ['已载入工程（1 张图集页面）', 'ok'])
})

test('a PS export folder goes through the PS import with its relative paths', async () => {
  const h = harness()
  assert.equal(h.drop([folderItem('role', ['role.json', 'images/head.png', 'images/body.png'])]), true)
  await h.done
  assert.deepEqual(h.calls.imported, [['role.json', 'head.png', 'body.png']])
  assert.equal(h.calls.remembered[1].webkitRelativePath, 'role/images/head.png')
  assert.equal(h.calls.openedFolder.length, 0)
})

test('a .foart opens with its handle, so Ctrl+S saves back to it', async () => {
  const h = harness()
  const item = fileItem('scene.foart')
  h.drop([item])
  await h.done
  assert.equal(h.calls.openedFile.length, 1)
  assert.equal(h.calls.openedFile[0].handle, item.handle)
  assert.equal(h.calls.imported.length, 0)
  assert.deepEqual(h.calls.said.at(-1), ['已打开 Foart 工程（2 个工程）', 'ok'])
})

test('the folder that holds a .foart opens as a project folder (pictures beside it stay reachable)', async () => {
  const h = harness()
  const item = folderItem('scene', ['scene.foart', 'img/a.png'])
  h.drop([item])
  await h.done
  assert.deepEqual(h.calls.openedFolder, [item.handle])
  assert.equal(h.calls.imported.length, 0)
})

test('without file-system handles a Foart drop still opens through the file list', async () => {
  const h = harness()
  const item = fileItem('scene.foart')
  delete item.getAsFileSystemHandle
  h.drop([item])
  await h.done
  assert.deepEqual(h.calls.imported, [['scene.foart']])
})

test('a drop without files, or while an import is running, is not taken', () => {
  assert.equal(harness().drop([]), false)
  assert.equal(harness({ busy: true }).drop([fileItem('a.json')]), false)
})

test('the embedded editor hands a canvas drop to the panel', () => {
  const drop = section(editor, "stage.addEventListener('drop'", 'async function filesFromDrop')
  assert.match(drop, /if \(EMBED\) \{[\s\S]*panel\.importDrop\(e\)/)
  assert.match(panel, /importDrop: \(ev\) =>/)
})
