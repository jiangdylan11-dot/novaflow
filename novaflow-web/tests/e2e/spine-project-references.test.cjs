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
    rt: {}, pagePixels: new Map(), frameThumbs: new Map(), imgTree: null, refresh() {}, applyJson(j) { state.json = j }, prepareExternalPage: im => im,
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
        TREE_FILTERS: [['bones'], ['slots'], ['images']], document: { querySelectorAll: () => [] },
        pv: { items: new Map() }, pfx: null, imgSeen: { folder: null, names: new Map() }, hostListeners: new Set(), watchImageFolder() {},
        $: () => ({}), Ops: { tidy: j => j, prepare: j => j }, leaveProjectEdits() {}, dropProjectRuntime() {}, renderTree() {},
        snapProject: () => ({ ...state, temp: new Map(state.temp), collapsed: new Set(state.collapsed) }),
        restoreProject: snap => Object.assign(state, snap),
        projectName: i => i === c.activeProject ? state.name : projects[i].snap.name,
      })
      w.confirm = () => true
      vm.runInContext(section('  function createEditorState()', '  const state =') +
        [fn('clearReplacedWorkspace'), fn('loadParts'), fn('loadSource'), fn('newProject'), fn('deleteProject')].join('\n'), c)
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
  await g.open(await project.getFile(), project, { directory: { handle: moved.root } })
  assert.equal(g.picker.length, 0)
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

test('a project with missing external pictures saves its references and edits without inventing pixels', async () => {
  const d = disk(), f = fixture()
  const p = { json: json(), atlasText: atlas(), fileName: 'scene.json', name: 'scene', images: [{ fileName: 'pic.png', path: 'pic.png', dataUrl: 'data:image/png;base64,eA==' }] }
  await f.open(new File([await gzip({ format: 'novaflow-spine-projects', version: 2, projects: [p] })], 'scene.nfproj'), null, { directory: { handle: d.root } })
  assert.equal(f.state.images.size, 0)
  assert.match(f.status.at(-1)[0], /缺少 1 张外部图片/)
  const saved = await f.save(d.root)
  assert.equal(saved.projects[0].images[0].path, 'pic.png')
  assert.deepEqual(saved.projects[0].json, p.json)
  assert.equal(d.root.nodes.size, 0)
})

test('resource paths cannot write outside the selected image directory', () => {
  const { c } = fixture()
  for (const p of ['../secret.png', 'C:/secret.png', '/secret.png', 'data:image/png']) assert.throws(() => c.projectPath(p))
  assert.deepEqual(Array.from(c.projectPath('../PNG', ['sub'])), ['PNG'])
})

test('a changed recorded image path stays missing without guessing a similarly named subtree', async () => {
  const d = disk(), f = fixture()
  await d.put('images/JPG/pic.png', 'correct JPG pixels')
  await d.put('images/PNG/pic.png', 'different PNG pixels')
  const p = { json: json(), atlasText: atlas(), fileName: 'spin.json', name: 'spin', imagePath: '.', visible: false,
    images: [{ fileName: 'pic.png', path: 'JPG/pic.png', pma: true }] }
  await f.open(new File([await gzip({ format: 'novaflow-spine-projects', version: 2, projects: [p] })], 'spin.nfproj'), null, { directory: { handle: d.root } })
  assert.equal(f.state.images.size, 0)
  assert.equal(f.projects[0].visible, false)
  assert.match(f.status.at(-1)[0], /当前工程「spin」已隐藏/)
  assert.match(f.status.at(-1)[0], /MISSING/)
  await f.c.refreshFolderPictures(f.state, f.state.imageFolder)
  assert.equal(f.state.images.size, 0, 'live folder refresh also respects the recorded path')
})

test('exact project references win and ambiguous relocated copies are left missing', async () => {
  const d = disk(), f = fixture()
  await d.put('JPG/exact.png', 'exact')
  await d.put('images/JPG/exact.png', 'relocated')
  await d.put('first/JPG/ambiguous.png', 'first')
  await d.put('second/JPG/ambiguous.png', 'second')
  await d.put('PNG/missing.png', 'wrong directory')
  const folder = f.c.folderFromHandle(d.root, d.root.name)
  const images = await f.c.referencedProjectImages([
    { fileName: 'exact.png', path: 'JPG/exact.png' },
    { fileName: 'ambiguous.png', path: 'JPG/ambiguous.png' },
    { fileName: 'missing.png', path: 'JPG/missing.png' },
  ], folder)
  assert.equal(images.length, 1)
  assert.equal(await images[0].blob.text(), 'exact')
})

test('empty setup pose suggests an attachment animation instead of the first empty animation', async () => {
  const d = disk(), f = fixture(), j = json()
  delete j.slots[0].attachment
  j.animations = { auto: {}, idle: { slots: { pic: { attachment: [{ name: 'pic' }] } } } }
  const before = JSON.stringify(j)
  const p = { json: j, atlasText: atlas(), fileName: 'spin.json', name: 'spin', images: [] }
  await f.open(new File([await gzip({ format: 'novaflow-spine-projects', version: 2, projects: [p] })], 'spin.nfproj'), null, { directory: { handle: d.root } })
  assert.match(f.status.at(-1)[0], /设置姿势没有显示附件.*选择动画「idle」/)
  assert.equal(JSON.stringify(f.state.json), before, 'opening never rewrites authored setup attachments or animation')
  assert.equal(f.projects[0].visible, true)
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
  const saved = await f.save(d.root)
  assert.equal(saved.projects[0].images[0].path, 'pic.png')
  assert.equal(d.root.nodes.has('pic.png'), false)
})

test('a generated swap frame is persisted separately from the picked source and reopens with its exact bytes', async () => {
  const d = disk(), f = fixture()
  await d.put('pic.png', 'unmodified replacement source')
  await d.put('__nf_swap_13.png', 'another existing file')
  f.state.imageFolder = f.c.folderFromHandle(d.root, d.root.name)
  f.state.atlasText = Attach.synthesizeAtlas([{ fileName: '__nf_swap_13.png', name: 'pic', width: 1, height: 1 }])
  const blob = new Blob(['padded swap pixels'])
  f.state.images.set('__nf_swap_13.png', { fileName: '__nf_swap_13.png', blob, img: { naturalWidth: 1, naturalHeight: 1 }, pma: false, sessionGenerated: true })
  const saved = await f.save(d.root), ref = saved.projects[0].images[0]
  assert.equal(ref.fileName, '__nf_swap_13.png')
  assert.equal(ref.path, '__nf_swap_13_2.png', 'never overwrite an unrelated existing disk file')
  assert.equal(await (await (await d.root.getFileHandle(ref.path)).getFile()).text(), 'padded swap pixels')
  assert.equal(await (await (await d.root.getFileHandle('pic.png')).getFile()).text(), 'unmodified replacement source')
  assert.equal(await (await (await d.root.getFileHandle('__nf_swap_13.png')).getFile()).text(), 'another existing file')
  const g = fixture()
  await g.open(new File([await gzip(saved)], 'saved.nfproj'), null, { directory: { handle: d.root } })
  assert.equal(await g.state.images.get('__nf_swap_13.png').blob.text(), 'padded swap pixels')
  const savedAgain = await f.save(d.root)
  assert.equal(savedAgain.projects[0].images[0].path, ref.path, 'repeated saves reuse the persisted generated frame')
})

test('missing private swap pages do not block saving and report the unresolved pictures clearly', async () => {
  const d = disk(), f = fixture(), handle = await d.put('cards.nfproj', '')
  f.state.imageFolder = f.c.folderFromHandle(d.root, d.root.name)
  f.state.atlasText = Attach.synthesizeAtlas([{ fileName: '__nf_swap_13.png', name: 'star_1', width: 1, height: 1 }])
  f.state.json.skins[0].attachments.pic.pic.path = 'star_1'
  f.state.projectImageRefs = [{ fileName: '__nf_swap_13.png', path: 'old-folder/img/star_1.png' }]
  f.window.directory = d.root; f.window.showSaveFilePicker = async () => handle
  const result = await vm.runInContext('saveProjectFileNow()', f.c)
  assert.equal(result.missing.length, 1)
  assert.match(f.status.at(-1)[0], /已保存.*缺少 1 张图片.*保留引用/)
  const saved = await unpack(await (await handle.getFile()).arrayBuffer())
  assert.equal(saved.projects[0].images[0].path, 'star_1.png', 'a manually assigned folder becomes the reference root')
  assert.deepEqual(saved.projects[0].json, f.state.json)
})

test('unused old swap pages do not produce missing-image warnings on open or save', async () => {
  const d = disk(), f = fixture()
  await d.put('pic.png', 'current pixels')
  const stale = { fileName: '__nf_swap_13.png', path: 'star_1.png' }
  const p = { name: 'cards', json: json(), atlasText: atlas() + '\n\n' + Attach.synthesizeAtlas([{ fileName: stale.fileName, name: 'star_1', width: 1, height: 1 }]),
    images: [{ fileName: 'pic.png', path: 'pic.png' }, stale], imagePath: '.', folderKey: 'cards' }
  const handle = await d.put('cards.nfproj', await gzip({ format: 'novaflow-spine-projects', version: 2, projects: [p] }))
  await f.open(await handle.getFile(), handle, { directory: { handle: d.root } })
  assert(!f.status.at(-1)[0].includes('缺少'))
  const result = await vm.runInContext('saveProjectFileNow()', f.c)
  assert.equal(result.missing.length, 0)
  const saved = await unpack(await (await handle.getFile()).arrayBuffer())
  assert.deepEqual(saved.projects[0].json, p.json)
  assert(saved.projects[0].images.some(ref => ref.fileName === stale.fileName), 'diagnostics do not delete historical project data')
  f.state.json.skins[0].attachments.pic.pic.path = 'star_1'
  const missing = await vm.runInContext('saveProjectFileNow()', f.c)
  assert.equal(missing.missing.length, 1, 'a picture used by any skin must still be reported')
})

test('missing reports include live picture paths and sequence frames', async () => {
  const f = fixture(), j = json()
  j.skins[0].attachments.pic.pic = { path: 'run', sequence: { start: 1, digits: 2, count: 2 } }
  const atlasText = Attach.synthesizeAtlas([{ name: 'run01', fileName: 'a.png', width: 1, height: 1 }, { name: 'run02', fileName: 'b.png', width: 1, height: 1 }, { name: 'unused', fileName: 'c.png', width: 1, height: 1 }])
  const refs = ['a', 'b', 'c'].map(name => ({ fileName: name + '.png', path: 'images/' + name + '.png' }))
  assert.deepEqual(Array.from(f.c.missingProjectImageRefs(j, atlasText, refs, []), ref => ref.path), ['images/a.png', 'images/b.png'])
  await f.open(new File([await gzip({ format: 'novaflow-spine-projects', version: 2, projects: [{ name: 'cards', json: j, atlasText, images: refs }] })], 'cards.nfproj'))
  assert.match(f.status.at(-1)[0], /缺少 2 张.*images\/a.png.*images\/b.png/)
  assert(!f.status.at(-1)[0].includes('images/c.png'))
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

test('invalid cached folder records leave missing pictures without opening a directory picker', async () => {
  const d = disk(), f = fixture()
  await d.put('pic.png', 'current')
  const p = { json: json(), atlasText: atlas(), fileName: 'scene.json', name: 'scene', folderKey: 'invalid', images: [{ fileName: 'pic.png', path: 'pic.png' }] }
  const file = await d.put('scene.nfproj', await gzip({ format: 'novaflow-spine-projects', version: 2, projects: [p] }))
  f.records.set('invalid', { projectDirectory: { name: 'stale handle' } })
  f.window.directory = d.root
  await f.open(await file.getFile(), file)
  assert.equal(f.picker.length, 0)
  assert.equal(f.state.images.size, 0)
  assert.equal(f.state.json.bones[0].name, 'root')
  assert.match(f.status.at(-1)[0], /MISSING/)
})

test('every subproject restores its own external folder without prompting or mixing identical file names', async () => {
  const d = disk(), left = disk('left-images'), right = disk('right-images'), f = fixture()
  await left.put('pic.png', 'left pixels'); await right.put('pic.png', 'right pixels')
  const part = (name) => ({ json: json(), atlasText: atlas(), fileName: name + '.json', name, folderKey: name,
    externalFolder: true, imagePath: name + '-images', images: [{ fileName: 'pic.png', path: 'pic.png', pma: false }] })
  const file = await d.put('both.nfproj', await gzip({ format: 'novaflow-spine-projects', version: 2, active: 1, projects: [part('left'), part('right')] }))
  f.records.set('left', { handle: left.root, projectDirectory: d.root })
  f.records.set('right', { handle: right.root, projectDirectory: d.root })
  await f.open(await file.getFile(), file)
  assert.equal(f.picker.length, 0)
  assert.equal(f.projects.length, 2)
  assert.equal(await f.projects[0].snap.images.get('pic.png').blob.text(), 'left pixels')
  assert.equal(await f.state.images.get('pic.png').blob.text(), 'right pixels')
  assert.equal(f.projects[0].snap.imageFolder.handle, left.root)
  assert.equal(f.state.imageFolder.handle, right.root)
})

test('saving and reopening multiple projects retains separate relative directories and current disk pixels', async () => {
  const d = disk(), f = fixture()
  await d.put('left/pic.png', 'left original'); await d.put('right/pic.png', 'right original')
  const left = await d.root.getDirectoryHandle('left'), right = await d.root.getDirectoryHandle('right')
  Object.assign(f.state, { name: 'left', folderKey: 'left', imageFolder: f.c.folderFromHandle(left, 'left') })
  await f.c.loadParts({ json: json(), label: 'right', jsonName: 'right.json', atlasText: atlas(), folderKey: 'right',
    imageFolder: f.c.folderFromHandle(right, 'right'), images: [], imageRefs: [] })
  const saved = await f.save(d.root)
  assert.deepEqual(saved.projects.map(p => p.imagePath), ['left', 'right'])
  assert.deepEqual(saved.projects.map(p => p.images[0].path), ['pic.png', 'pic.png'])
  const file = await d.put('both.nfproj', await gzip(saved))
  await d.put('left/pic.png', 'left changed'); await d.put('right/pic.png', 'right changed')
  const g = fixture()
  for (const [key, rec] of f.records) g.records.set(key, rec)
  await g.open(await file.getFile(), file)
  assert.equal(g.picker.length, 0)
  assert.equal(await g.projects[0].snap.images.get('pic.png').blob.text(), 'left changed')
  assert.equal(await g.state.images.get('pic.png').blob.text(), 'right changed')
})

test('a missing recorded subdirectory does not borrow same-name images from its parent', async () => {
  const d = disk(), f = fixture()
  await d.put('pic.png', 'unrelated parent image')
  const p = { json: json(), atlasText: atlas(), fileName: 'scene.json', name: 'scene', imagePath: 'deleted', images: [{ fileName: 'pic.png', path: 'pic.png' }] }
  await f.open(new File([await gzip({ format: 'novaflow-spine-projects', version: 2, projects: [p] })], 'scene.nfproj'), null, { directory: { handle: d.root } })
  assert.equal(f.state.imageFolder, null)
  assert.equal(f.state.images.size, 0)
  assert.match(f.status.at(-1)[0], /MISSING/)
  assert.equal(f.picker.length, 0)
})

test('remembering folders keeps project-location records captured before another project is selected', async () => {
  const f = fixture(), d = disk(), left = disk('left'), right = disk('right'), writes = []
  f.c.folderDbDo = async (_mode, run) => { writes.push(run) }
  vm.runInContext(fn('rememberFolder'), f.c)
  Object.assign(f.state, { folderKey: 'left', projectDirectory: d.root, projectAccessRoot: left.root })
  f.c.rememberFolder(left.root)
  Object.assign(f.state, { folderKey: 'right', projectDirectory: right.root, projectAccessRoot: right.root })
  f.c.rememberFolder(right.root)
  for (const run of writes) run({ put: (rec, key) => f.records.set(key, rec) })
  assert.equal(f.records.get('left').projectDirectory, d.root)
  assert.equal(f.records.get('left').projectAccessRoot, left.root)
  assert.equal(f.records.get('right').handle, right.root)
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

test('append keeps independent projects, refresh keeps saving, and replace discards every old project', async () => {
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
  assert.equal(f.projects.length, 1)
  await vm.runInContext('saveProjectFileNow()', f.c)
  assert.equal(picks, 3, 'replacement detaches the previous save file')
})

test('workspace replacement clears old selection, filtering, hidden layers, undo, previews and clipboard', async () => {
  const f = fixture(); f.realLifecycle()
  const src = name => ({ skeleton: { fileName: name + '.json', text: JSON.stringify(json()) }, images: [] })
  await f.c.loadSource(src('old-a'), { operation: 'append' })
  await f.c.loadSource(src('old-b'), { operation: 'append' })
  const disposed = [], events = []
  f.c.dropProjectRuntime = id => disposed.push(id)
  f.c.hostListeners.add(type => events.push(type))
  f.c.pv.items.set(1, { atlas: { dispose: () => disposed.push('preview') } })
  Object.assign(f.c.pv, { open: true, track: 3, projectId: 1 })
  f.c.boneClipboard = { names: ['old-bone'] }
  Object.assign(f.state, { search: 'old-query', hiddenBones: new Set(['root']), hiddenSlots: new Set(['pic']),
    opt: { imgVis: false }, history: ['old-undo'], future: ['old-redo'], groups: { old: ['root'] },
    staleEditorSession: { from: 'old-a' } })
  await f.c.loadSource(src('fresh'), { operation: 'replace' })
  assert.equal(f.projects.length, 1)
  assert.equal(f.state.name, 'fresh')
  assert.equal(f.state.search, '')
  assert.equal(f.state.hiddenBones.size + f.state.hiddenSlots.size, 0)
  assert.equal(f.state.opt.imgVis, true)
  assert.equal(f.state.history.length + f.state.future.length, 0)
  assert.equal(Object.keys(f.state.groups).length, 0)
  assert.equal(f.state.staleEditorSession, undefined)
  assert.equal(f.c.pv.items.size, 0)
  assert.equal(f.c.pv.open, false)
  assert.equal(f.c.boneClipboard, null)
  assert(disposed.includes('preview'))
  assert.deepEqual(events, ['workspace-reset'])
})

test('an old folder listing cannot refill a fresh workspace cache with the same cache key', async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const c = vm.createContext({ imgTree: { key: 'same', nodes: new Map(), pending: new Set() },
    frameRootKey: () => 'same', imageFolder: () => ({ list: () => pending }), renderTree() {} })
  vm.runInContext(fn('imagesListing'), c)
  c.imagesListing('')
  c.imgTree = { key: 'same', nodes: new Map(), pending: new Set() }
  finish({ files: [{ name: 'old.png' }], dirs: [] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(c.imgTree.nodes.size, 0)
})

test('replacing with a multi-project file resets once, loads all new projects and saves to the newly opened file', async () => {
  const d = disk(), f = fixture(); f.realLifecycle()
  const part = name => ({ name, fileName: name + '.json', json: json(), images: [] })
  const oldBytes = await gzip({ format: 'novaflow-spine-projects', version: 2, projects: [part('old-a'), part('old-b'), part('old-c')] })
  const oldFile = await d.put('old.nfproj', oldBytes)
  await f.open(await oldFile.getFile(), oldFile, { directory: { handle: d.root } })
  const freshFile = await d.put('fresh.nfproj', await gzip({ format: 'novaflow-spine-projects', version: 2, active: 1, projects: [part('new-a'), part('new-b')] }))
  const events = []
  f.c.hostListeners.add(type => events.push(type))
  await f.open(await freshFile.getFile(), freshFile, { operation: 'replace', directory: { handle: d.root } })
  assert.equal(f.projects.length, 2)
  assert.equal(f.state.name, 'new-b')
  assert.equal(f.projects[0].snap.name, 'new-a')
  assert.deepEqual(events, ['workspace-reset'])
  await vm.runInContext('saveProjectFileNow()', f.c)
  assert.equal(f.picker.length, 0, 'Ctrl+S uses the newly opened file')
  assert.deepEqual(new Uint8Array(await (await oldFile.getFile()).arrayBuffer()), oldBytes)
  const saved = await unpack(await (await freshFile.getFile()).arrayBuffer())
  assert.deepEqual(saved.projects.map(p => p.name), ['new-a', 'new-b'])
})

test('a failed replacement keeps the old workspace and its save target', async () => {
  const d = disk(), f = fixture(); f.realLifecycle()
  f.state.imageFolder = f.c.folderFromHandle(d.root, d.root.name)
  await d.put('pic.png', 'pixels')
  const original = await d.put('original.nfproj', '')
  f.window.directory = d.root
  f.window.showSaveFilePicker = async () => original
  await vm.runInContext('saveProjectFileNow()', f.c)
  const before = f.state.json, beforeCount = f.projects.length, apply = f.c.applyJson
  f.state.search = 'keep filter'
  f.c.applyJson = j => { if (j.bad) throw Error('invalid rig'); apply(j) }
  await assert.rejects(f.c.loadSource({ skeleton: { fileName: 'bad.json', text: JSON.stringify({ ...json(), bad: true }) }, images: [] }, { operation: 'replace' }), /invalid rig/)
  assert.equal(f.state.json, before)
  assert.equal(f.state.search, 'keep filter')
  assert.equal(f.projects.length, beforeCount)
  const saved = await vm.runInContext('saveProjectFileNow()', f.c)
  assert.equal(saved.overwritten, true)
})

test('the host discards old tool/export state and rejects an export prepared before workspace replacement', async () => {
  const host = fs.readFileSync(path.resolve(__dirname, '../../renderer/spine-skeleton-editor.host.js'), 'utf8')
  const hostFn = name => host.match(new RegExp('^  (?:async )?function ' + name + '\\([^]*?^  \\}', 'm'))[0]
  const cache = {}, calls = [], current = {}, source = { json: { text: 'stale export' }, atlas: {}, images: [] }
  let resolvePack
  const packing = new Promise(resolve => { resolvePack = resolve })
  const a = { loaded: () => true, json: () => current, packForApp: () => packing }
  const ctx = vm.createContext({ workspaceRevision: 0, ready: async () => a, packMode: () => 'atts', exportVersion: () => '3.8',
    wantVersion: 'spine', imageRevision: () => 1, settingsKey: () => '', appJson: null, appVersion: null,
    appMode: null, appImages: null, appSettings: null, chosenVersion: '4.2', ownText: 'old text',
    window: { __NOVA_SPINE_LAST_SOURCE: { old: true }, __NovaFlowSpineImportInlineBridgeCache: cache,
      __NovaFlowSpineImportInlineBridge: { start: async () => calls.push('import-old-export') },
      NovaFlowMotionEditing: { collapse: () => calls.push('collapse') } },
    durations: new Map([['old', 1]]), forgetReact: () => calls.push('forget'), closeLeftPanels: () => calls.push('close'),
  })
  vm.runInContext(hostFn('onEditorEvent') + '\n' + hostFn('syncApp'), ctx)
  const pending = ctx.syncApp()
  await Promise.resolve()
  ctx.onEditorEvent('workspace-reset', {})
  resolvePack({ source })
  await assert.rejects(pending, /工程已替换/)
  assert.equal(ctx.chosenVersion, null)
  assert.equal(ctx.ownText, null)
  assert.equal(ctx.durations.size, 0)
  assert.equal(Object.keys(cache).length, 0, 'stale packing cannot refill the import bridge')
  assert(!calls.includes('import-old-export'))
  assert(calls.includes('collapse'))
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
  f.c.projectFileBytes = async () => { throw Error('serialization failed') }
  await assert.rejects(vm.runInContext('saveProjectFileNow()', f.c), /serialization failed/)
  assert.equal(await (await handle.getFile()).text(), 'good-project-bytes')
  assert.equal(d.root.nodes.has('scene.nfproj.bak'), false)
  assert.equal([...d.root.nodes.keys()].some((n) => String(n).includes('.tmp')), false)
})

test('a serialization failure after the picker created an empty file removes that file', async () => {
  const d = disk(), f = fixture()
  f.state.imageFolder = f.c.folderFromHandle(d.root, d.root.name)
  f.window.showSaveFilePicker = async () => d.root.getFileHandle('scene.nfproj', { create: true })
  f.c.projectFileBytes = async () => { throw Error('serialization failed') }
  await assert.rejects(vm.runInContext('saveProjectFileNow()', f.c), /serialization failed/)
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
