const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
require('../../renderer/spine-auto-mesh-attach.js')
const Attach = globalThis.NovaFlowAutoMeshAttach
const source = fs.readFileSync(path.resolve(__dirname, '../../renderer/spine-skeleton-editor.js'), 'utf8').replace(/\r\n/g, '\n')
const section = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)))
const fn = name => source.match(new RegExp('^  (?:async )?function ' + name + '\\([^]*?^  \\}', 'm'))[0]

function disk(name = 'project') {
  let clock = 100
  const root = dir(name)
  const bytesOf = async (b) => {
    if (typeof b === 'string') return new TextEncoder().encode(b)
    if (b instanceof Blob) return new Uint8Array(await b.arrayBuffer())
    if (b instanceof ArrayBuffer) return new Uint8Array(b)
    if (ArrayBuffer.isView(b)) return new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
    return new Uint8Array(b)
  }
  function dir(name, parent) {
    const nodes = new Map()
    return { kind: 'directory', name, parent, nodes, queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      async *entries() { yield* nodes },
      async resolve(other) { const parts = []; for (let n = other; n; n = n.parent) { if (n === this) return parts.reverse(); parts.push(n.name) } return null },
      async removeEntry(name) { nodes.delete(name) },
      async getDirectoryHandle(name, opts = {}) { if (!nodes.has(name) && opts.create) nodes.set(name, dir(name, this)); const n = nodes.get(name); if (!n || n.kind !== 'directory') throw Error('NotFound'); return n },
      async getFileHandle(name, opts = {}) {
        if (!nodes.has(name) && opts.create) nodes.set(name, { kind: 'file', name, parent: this, data: new File([], name),
          async getFile() { return this.data },
          async remove() { if (this.parent) this.parent.nodes.delete(this.name) },
          async move(dest, newName) {
            const dir = typeof dest === 'string' ? this.parent : dest
            const next = typeof dest === 'string' ? dest : (newName || this.name)
            if (dir.nodes.has(next) && dir.nodes.get(next) !== this) { const err = new Error('exists'); err.name = 'InvalidModificationError'; throw err }
            this.parent.nodes.delete(this.name)
            this.name = next
            this.parent = dir
            dir.nodes.set(next, this)
          },
          // createWritable() without keepExistingData drops the bytes immediately, which is the
          // failure mode a project save has to avoid. keepExistingData holds them until close.
          async createWritable(opts = {}) {
            const n = this
            const keep = !!(opts && opts.keepExistingData)
            const original = n.data
            if (!keep) n.data = new File([], n.name, { lastModified: clock++ })
            let buf = keep ? new Uint8Array(await original.arrayBuffer()) : new Uint8Array(0)
            let pos = 0
            const publish = () => { n.data = new File([buf], n.name, { lastModified: clock++ }) }
            return {
              async write(b) {
                const chunk = await bytesOf(b)
                const next = new Uint8Array(Math.max(buf.length, pos + chunk.length))
                next.set(buf)
                next.set(chunk, pos)
                buf = next
                pos += chunk.length
                publish()
              },
              async truncate(size) {
                const next = new Uint8Array(size)
                next.set(buf.subarray(0, Math.min(size, buf.length)))
                buf = next
                pos = Math.min(pos, size)
                publish()
              },
              async close() { publish() },
              async abort() { n.data = original },
            }
          },
        })
        const n = nodes.get(name); if (!n || n.kind !== 'file') throw Error('NotFound'); return n
      },
    }
  }
  return { root, async put(rel, data) { const parts = rel.split('/'); let d = root; for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true }); const f = await d.getFileHandle(parts.at(-1), { create: true }); const w = await f.createWritable(); await w.write(data); await w.close(); return f } }
}
const json = () => ({ skeleton: { spine: '3.8.99' }, bones: [{ name: 'root' }], slots: [{ name: 'pic', bone: 'root', attachment: 'pic' }],
  skins: [{ name: 'default', attachments: { pic: { pic: { width: 1, height: 1 } } } }], animations: { idle: { bones: { root: { rotate: [{ angle: 5 }] } } } } })
const atlas = () => Attach.synthesizeAtlas([{ fileName: 'pic.png', width: 1, height: 1 }])
async function gzip(data) { return new Uint8Array(await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()) }
async function unpack(bytes) { return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()) }
function fixture() {
  const state = { json: json(), atlasText: atlas(), fileName: 'scene.json', name: 'scene', images: new Map(), folderKey: 'key', sections: new Set(), pma: false, history: [], future: [] }
  const projects = [{ snap: null }], records = new Map(), status = [], picker = []
  const w = { NovaFlowSequenceAtlas: { safeName: s => s }, showSaveFilePicker: async () => { throw Error('not configured') }, showDirectoryPicker: async opts => { picker.push(opts); if (!w.directory) return null; return w.directory } }; w.parent = w
  const c = vm.createContext({ console, window: w, state, projects, activeProject: 0, Blob, File, Response, CompressionStream, DecompressionStream, Uint8Array, fetch,
    Attach, lower: s => String(s).toLowerCase(), stem: s => s.replace(/\.[^.]+$/, ''), baseName: s => s.split('/').pop(),
    rt: {}, pagePixels: new Map(), frameThumbs: new Map(), imgTree: null, refresh() {}, applyJson(j) { state.json = j },
    imageFromBlob: async blob => ({ naturalWidth: 1, naturalHeight: 1, blob }),
    folderDbDo: async (_mode, run) => run({ get: k => records.get(k), put: (v, k) => records.set(k, v) }),
    status: (...a) => status.push(a),
  })
  vm.runInContext(section('  const IMG_RX =', '  /**\n   * New material into the image folder:') +
    section('  const PROJECT_FILE_FORMAT =', '  /** The 工程 属性 X / Y boxes') + section('  const pageEntry =', '  function readProjectData('), c)
  vm.runInContext(section('  async function pickDirectory(', '  /** Premultiplied pixels'), c)
  c.loadParts = async p => {
    if (state.json && projects[c.activeProject]) projects[c.activeProject].snap = { ...state }
    Object.assign(state, { json: p.json, name: p.label, fileName: p.jsonName, atlasName: p.atlasName, atlasText: p.atlasText,
      imageFolder: p.imageFolder, projectDirectory: p.projectDirectory, projectAccessRoot: p.projectAccessRoot, projectImageRefs: p.imageRefs || [], imagePath: p.imagePath,
      images: new Map((p.images || []).map(im => [im.fileName.toLowerCase(), { ...im, img: { naturalWidth: 1, naturalHeight: 1 } }])), folderKey: p.folderKey, pma: !!p.pma })
    projects.push({ snap: null, visible: p.visible !== false }); c.activeProject = projects.length - 1
  }
  c.switchProject = n => { c.activeProject = n; if (projects[n].snap) Object.assign(state, projects[n].snap) }
  c.pictureRels = async root => Array.from(await c.listProjectImages(c.folderFromHandle(root, root.name)), f => f.rel)
  let opened = false
  return { c, state, projects, records, status, picker, window: w,
    realLifecycle() {
      Object.assign(state, { temp: new Map(), collapsed: new Set() })
      Object.assign(c, { projectSerial: 0, newFolderKey: () => 'new-key', fit() {}, depthOf: () => 0, rememberFolder() {},
        $: () => ({}), Ops: { tidy: j => j, prepare: j => j }, leaveProjectEdits() {}, dropProjectRuntime() {}, renderTree() {},
        snapProject: () => ({ ...state, temp: new Map(state.temp), collapsed: new Set(state.collapsed) }),
        restoreProject: snap => Object.assign(state, snap),
        projectName: i => i === c.activeProject ? state.name : projects[i].snap.name,
      })
      w.confirm = () => true
      vm.runInContext([fn('loadParts'), fn('loadSource'), fn('newProject'), fn('deleteProject')].join('\n'), c)
    },
    save: async dir => { c.dir = dir; return unpack((await vm.runInContext('projectFileBytes(dir)', c)).bytes) },
    open: async (data, handle, options) => { if (!opened) { projects.length = 0; state.json = null; c.activeProject = -1; opened = true } c.input = data; c.handle = handle; c.options = options; return vm.runInContext('openProjectFile(input, handle, options)', c) },
  }
}

test('v2 saves external relative references with no embedded image bytes and leaves current source files intact', async () => {
  const d = disk(), file = await d.put('pic.png', 'latest disk pixels'), f = fixture()
  f.state.imageFolder = f.c.folderFromHandle(d.root, d.root.name)
  f.state.images.set('pic.png', { blob: new Blob(['obsolete snapshot']) })
  const before = JSON.stringify(f.state.json), out = await f.save(d.root)
  assert.equal(out.version, 2)
  assert.equal(out.projects[0].imagePath, '.')
  assert.deepEqual(out.projects[0].images, [{ fileName: 'pic.png', path: 'pic.png', pma: false }])
  assert(!JSON.stringify(out).includes('data:image'))
  assert(!JSON.stringify(out).includes('obsolete snapshot'))
  assert.equal(await (await file.getFile()).text(), 'latest disk pixels')
  assert.equal(await f.state.images.get('pic.png').blob.text(), 'latest disk pixels')
  assert.equal(JSON.stringify(f.state.json), before)
})

test('session-created pictures become separate files beside .nfproj, then reopen from disk changes', async () => {
  const d = disk(), f = fixture()
  f.state.images.set('pic.png', { blob: new Blob(['generated']), img: { naturalWidth: 1, naturalHeight: 1 } })
  const out = await f.save(d.root)
  assert.equal(await (await (await d.root.getFileHandle('pic.png')).getFile()).text(), 'generated')
  await d.put('pic.png', 'updated after save')
  const g = fixture()
  await g.open(new File([await gzip(out)], 'scene.nfproj'), null, { directory: { handle: d.root } })
  assert.equal(await g.state.images.get('pic.png').blob.text(), 'updated after save')
  assert(!JSON.stringify(out.projects[0].images).includes('generated'))
})

test('a project and its image subdirectory move together without old cached folder pixels', async () => {
  const d = disk(), imageDir = await d.root.getDirectoryHandle('PNG', { create: true }), f = fixture()
  await d.put('PNG/pic.png', 'original')
  f.state.imageFolder = f.c.folderFromHandle(imageDir, 'PNG')
  const out = await f.save(d.root)
  assert.equal(out.projects[0].imagePath, 'PNG')
  const moved = disk('moved'), project = await moved.put('scene.nfproj', await gzip(out))
  await moved.put('PNG/pic.png', 'moved current pixels')
  const g = fixture(); g.records.set('key', { handle: imageDir, projectDirectory: d.root })
  g.window.directory = moved.root
  await g.open(await project.getFile(), project)
  assert.equal(g.picker[0].startIn, project)
  assert.equal(await g.state.images.get('pic.png').blob.text(), 'moved current pixels')
})

test('legacy embedded projects migrate to external files on save, preserving their animation', async () => {
  const d = disk(), f = fixture()
  const p = { json: json(), atlasText: atlas(), fileName: 'scene.json', name: 'scene', folderKey: 'old', images: [{ fileName: 'pic.png', dataUrl: 'data:image/png;base64,' + Buffer.from('legacy pixels').toString('base64') }] }
  await f.open(new File([await gzip({ format: 'novaflow-spine-projects', version: 1, active: 0, projects: [p] })], 'old.nfproj'), null, { directory: { handle: d.root } })
  const out = await f.save(d.root)
  assert.equal(out.version, 2)
  assert.deepEqual(out.projects[0].json.animations, p.json.animations)
  assert.equal(await (await (await d.root.getFileHandle('pic.png')).getFile()).text(), 'legacy pixels')
  assert(!JSON.stringify(out).includes('dataUrl'))
})

test('missing external pictures do not fall back to embedded v2 bytes or overwrite a valid project', async () => {
  const d = disk(), f = fixture()
  const p = { json: json(), atlasText: atlas(), fileName: 'scene.json', name: 'scene', images: [{ fileName: 'pic.png', path: 'pic.png', dataUrl: 'data:image/png;base64,eA==' }] }
  await f.open(new File([await gzip({ format: 'novaflow-spine-projects', version: 2, projects: [p] })], 'scene.nfproj'), null, { directory: { handle: d.root } })
  assert.equal(f.state.images.size, 0)
  assert.match(f.status.at(-1)[0], /缺少 1 张外部图片/)
  await assert.rejects(f.save(d.root), /缺少图片/)
  assert.equal(d.root.nodes.size, 0)
})

test('resource paths cannot write outside the selected image directory', () => {
  const { c } = fixture()
  for (const p of ['../secret.png', 'C:/secret.png', '/secret.png', 'data:image/png']) assert.throws(() => c.projectPath(p))
  assert.deepEqual(Array.from(c.projectPath('../PNG', ['sub'])), ['PNG'])
})

test('an explicitly assigned folder outside the project directory stays external without copying or embedding', async () => {
  const d = disk('project'), images = disk('chosen-images'), f = fixture()
  await images.put('pic.png', 'current external bytes')
  f.state.imageFolder = f.c.folderFromHandle(images.root, images.root.name)
  const out = await f.save(d.root)
  assert.equal(out.projects[0].externalFolder, true)
  assert.equal(out.projects[0].imagePath, 'chosen-images')
  assert.equal(d.root.nodes.size, 0)
  const project = await d.put('scene.nfproj', await gzip(out)), g = fixture()
  g.records.set('key', f.records.get('key'))
  await g.open(await project.getFile(), project)
  assert.equal(g.picker.length, 0)
  assert.equal(await g.state.images.get('pic.png').blob.text(), 'current external bytes')
})

test('Ctrl+S retains its file and reads modified external pixels without another picker', async () => {
  const d = disk(), f = fixture(), handle = await d.put('scene.nfproj', '')
  await d.put('pic.png', 'first')
  f.state.imageFolder = f.c.folderFromHandle(d.root, d.root.name)
  let saves = 0
  f.window.showSaveFilePicker = async opts => { saves++; assert.equal(opts.startIn, d.root); return handle }
  const read = async (rel) => new Uint8Array(await (await (await d.root.getFileHandle(rel)).getFile()).arrayBuffer())
  await vm.runInContext('saveProjectFileNow()', f.c)
  const first = await read('scene.nfproj')
  assert.equal((await unpack(first)).version, 2)
  await d.put('pic.png', 'second')
  const r = await vm.runInContext('saveProjectFileNow()', f.c)
  assert.equal(r.overwritten, true)
  assert.equal(saves, 1)
  assert.equal(f.picker.length, 0)
  assert.equal(await f.state.images.get('pic.png').blob.text(), 'second')
  assert.equal((await unpack(await read('scene.nfproj'))).version, 2)
  assert.equal(d.root.nodes.has('scene.nfproj.bak'), false)
  assert.equal([...d.root.nodes.keys()].some((n) => String(n).endsWith('.tmp')), false)
})

test('deleting an external picture does not resurrect a runtime copy when saving', async () => {
  const d = disk(), f = fixture()
  await d.put('pic.png', 'present')
  f.state.imageFolder = f.c.folderFromHandle(d.root, d.root.name)
  await f.save(d.root)
  d.root.nodes.delete('pic.png')
  await f.c.refreshFolderPictures(f.state, f.state.imageFolder)
  assert.equal(f.state.images.has('pic.png'), false)
  await assert.rejects(f.save(d.root), /缺少图片/)
  assert.equal(d.root.nodes.has('pic.png'), false)
})

test('relative sibling image directories survive folder import and saving', async () => {
  const d = disk(), f = fixture()
  await d.put('pictures/pic.png', 'sibling pixels')
  const p = { json: json(), atlasText: atlas(), fileName: 'scene.json', name: 'scene', folderKey: 'sibling', imagePath: '../pictures', images: [{ fileName: 'pic.png', path: 'pic.png' }] }
  const project = await d.put('scenes/scene.nfproj', await gzip({ format: 'novaflow-spine-projects', version: 2, projects: [p] }))
  await f.open(await project.getFile(), project, { directory: { handle: d.root } })
  assert.equal(await f.state.images.get('pic.png').blob.text(), 'sibling pixels')
  const sceneDir = await d.root.getDirectoryHandle('scenes')
  const saved = await f.save(sceneDir)
  assert.equal(saved.projects[0].imagePath, '../pictures')
  assert.equal(saved.projects[0].externalFolder, undefined)
})

test('invalid cached folder records fall back to the current project directory', async () => {
  const d = disk(), f = fixture()
  await d.put('pic.png', 'current')
  const p = { json: json(), atlasText: atlas(), fileName: 'scene.json', name: 'scene', folderKey: 'invalid', images: [{ fileName: 'pic.png', path: 'pic.png' }] }
  const file = await d.put('scene.nfproj', await gzip({ format: 'novaflow-spine-projects', version: 2, projects: [p] }))
  f.records.set('invalid', { projectDirectory: { name: 'stale handle' } })
  f.window.directory = d.root
  await f.open(await file.getFile(), file)
  assert.equal(f.picker.length, 1)
  assert.equal(await f.state.images.get('pic.png').blob.text(), 'current')
})

test('deleting the last project then creating a new one never lets Ctrl+S write to the deleted project file', async () => {
  const d = disk(), f = fixture(); f.realLifecycle()
  const p = { name: 'original', fileName: 'original.json', json: json(), atlasText: '', images: [] }
  const bytes = await gzip({ format: 'novaflow-spine-projects', version: 2, projects: [p] })
  const original = await d.put('original.nfproj', bytes)
  await f.open(await original.getFile(), original, { directory: { handle: d.root } })
  f.c.deleteProject(0)
  assert.equal(f.projects.length, 0)
  await f.c.newProject('fresh', { operation: 'append' })
  let picks = 0; f.window.directory = d.root
  f.window.showSaveFilePicker = async opts => { picks++; assert.equal(opts.suggestedName, 'fresh.nfproj'); return d.root.getFileHandle('fresh.nfproj', { create: true }) }
  await vm.runInContext('saveProjectFileNow()', f.c)
  assert.equal(picks, 1)
  assert.deepEqual(new Uint8Array(await (await original.getFile()).arrayBuffer()), bytes)
})

test('explicit append honours identical source filenames; replace affects only the current project and refresh keeps saving', async () => {
  const d = disk(), f = fixture(); f.realLifecycle()
  await d.put('pic.png', 'current pixels')
  const original = await d.put('scene.nfproj', '')
  f.window.directory = d.root; let picks = 0
  f.window.showSaveFilePicker = async () => { picks++; return original }
  await vm.runInContext('saveProjectFileNow()', f.c)
  const src = { skeleton: { fileName: 'scene.json', text: JSON.stringify(json()) }, images: [] }
  await f.c.loadSource(src, { operation: 'append' })
  assert.equal(f.projects.length, 2)
  await vm.runInContext('saveProjectFileNow()', f.c)
  assert.equal(picks, 2, 'append detaches the previous save file')
  await f.c.loadSource(src, { operation: 'refresh' })
  await vm.runInContext('saveProjectFileNow()', f.c)
  assert.equal(picks, 2, 'internal write-backs keep the explicit save file')
  await f.c.loadSource(src, { operation: 'replace' })
  assert.equal(f.projects.length, 2)
  await vm.runInContext('saveProjectFileNow()', f.c)
  assert.equal(picks, 3, 'replacement detaches the previous save file')
})

test('when move cannot replace an existing file, a failed in-place write leaves that file', async () => {
  const d = disk(), f = fixture()
  await d.put('pic.png', 'pixels')
  const handle = await d.put('scene.nfproj', 'previous-project')
  f.state.imageFolder = f.c.folderFromHandle(d.root, d.root.name)
  f.window.showSaveFilePicker = async () => handle
  const real = handle.createWritable.bind(handle)
  handle.createWritable = async (opts) => {
    assert.equal(!!(opts && opts.keepExistingData), true)
    const w = await real(opts)
    w.write = async () => { throw new Error('disk full') }
    return w
  }
  await assert.rejects(vm.runInContext('saveProjectFileNow()', f.c), /disk full/)
  assert.equal(d.root.nodes.has('scene.nfproj'), true)
  assert.equal(await (await handle.getFile()).text(), 'previous-project')
  assert.equal(d.root.nodes.has('scene.nfproj.bak'), false)
  assert.equal([...d.root.nodes.keys()].some((n) => String(n).includes('.tmp')), false)
})

test('a save that throws while serializing leaves the previous project file unchanged', async () => {
  const d = disk(), f = fixture(), handle = await d.put('scene.nfproj', 'good-project-bytes')
  f.state.imageFolder = f.c.folderFromHandle(d.root, d.root.name)
  f.window.directory = d.root
  f.window.showSaveFilePicker = async () => handle
  await assert.rejects(vm.runInContext('saveProjectFileNow()', f.c), /缺少图片/)
  assert.equal(await (await handle.getFile()).text(), 'good-project-bytes')
  assert.equal(d.root.nodes.has('scene.nfproj.bak'), false)
  assert.equal([...d.root.nodes.keys()].some((n) => String(n).includes('.tmp')), false)
})

test('a serialization failure after the picker created an empty file removes that file', async () => {
  const d = disk(), f = fixture()
  f.state.imageFolder = f.c.folderFromHandle(d.root, d.root.name)
  f.window.showSaveFilePicker = async () => d.root.getFileHandle('scene.nfproj', { create: true })
  await assert.rejects(vm.runInContext('saveProjectFileNow()', f.c), /缺少图片/)
  assert.equal(d.root.nodes.has('scene.nfproj'), false)
  assert.equal([...d.root.nodes.keys()].some((n) => String(n).includes('.tmp') || String(n).endsWith('.bak')), false)
})

test('cancelling the directory picker removes the empty file the save picker created', async () => {
  const d = disk(), f = fixture()
  f.window.showSaveFilePicker = async () => d.root.getFileHandle('scene.nfproj', { create: true })
  const result = await vm.runInContext('saveProjectFileNow()', f.c)
  assert.equal(result, null)
  assert.equal(d.root.nodes.has('scene.nfproj'), false)
  assert.equal([...d.root.nodes.keys()].some((n) => String(n).includes('.tmp')), false)
})

test('an empty project file shows the empty-file message and does not import', async () => {
  const f = fixture()
  const alerts = []
  f.window.alert = (m) => { alerts.push(String(m)) }
  const message = '工程文件为空（0 字节），无法打开，请让对方重新保存后再发送'
  await assert.rejects(f.open(new File([], 'blank.nfproj')), new RegExp(message.replace(/[()]/g, '\\$&')))
  assert.equal(alerts[0], message)
  assert.equal(f.status.at(-1)[0], message)
  assert.equal(f.state.json, null)
})
