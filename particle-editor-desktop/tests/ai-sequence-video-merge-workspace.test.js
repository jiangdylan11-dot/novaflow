const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')

const repoRoot = path.resolve(__dirname, '..', '..')

function loadUmd(relativePath) {
  const filePath = path.join(repoRoot, relativePath)
  const source = fs.readFileSync(filePath, 'utf8')
  const sandbox = { module: { exports: {} }, exports: {}, URL, console, setTimeout, clearTimeout }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox, { filename: filePath })
  return { api: sandbox.module.exports, source, sandbox }
}

const resourceModule = loadUmd('particle-editor/ai-sequence-video-merge.resource.js')
const exportModule = loadUmd('particle-editor/ai-sequence-video-merge-export.workflow.js')
const previewSource = fs.readFileSync(path.join(repoRoot, 'particle-editor/ai-sequence-video-merge.preview.js'), 'utf8')
const workspaceSource = fs.readFileSync(path.join(repoRoot, 'particle-editor/ai-sequence-video-merge.workspace.js'), 'utf8')

function sourceResult(payload, overrides = {}) {
  const webm = /\.webm$/i.test(payload.filePath)
  return {
    ok: true,
    sourceId: `source:${payload.filePath}`,
    probe: {
      width: webm ? 1280 : 1920,
      height: webm ? 720 : 1080,
      displayWidth: webm ? 1280 : 1920,
      displayHeight: webm ? 720 : 1080,
      durationSec: webm ? 2 : 4,
      fps: 30,
      hasAudio: !webm,
      hasAlpha: webm,
      codec: webm ? 'vp9' : 'h264',
      ...overrides,
    },
  }
}

test('resource module owns exactly two isolated video layers and validates supported inputs', () => {
  assert.equal(Object.isFrozen(resourceModule.api), true)
  assert.equal(resourceModule.api.MAX_LAYERS, 2)
  assert.equal(resourceModule.api.isSupportedVideo({ name: 'clip.mp4', type: '' }), true)
  assert.equal(resourceModule.api.isSupportedVideo({ name: 'clip.webm', type: 'video/webm' }), true)
  assert.equal(resourceModule.api.isSupportedVideo({ name: 'clip.mov', type: 'video/quicktime' }), false)
})

test('first imported source defines the canvas and two sources retain independent transforms and z-order', async () => {
  const registrations = []
  const store = resourceModule.api.createStore({
    getPathForFile: (file) => file.localPath,
    createObjectUrl: (file) => `blob:${file.name}`,
    revokeObjectUrl() {},
    registerSource: async (payload) => {
      registrations.push(payload)
      return sourceResult(payload)
    },
  })
  await store.importFile('video-layer-bottom', { name: 'bottom.mp4', type: 'video/mp4', localPath: 'D:\\bottom.mp4' })
  await store.importFile('video-layer-top', { name: 'top.webm', type: 'video/webm', localPath: 'D:\\top.webm' })
  const state = store.getState()
  assert.equal(registrations.length, 2)
  assert.equal(state.layers.length, 2)
  assert.deepEqual([state.canvas.width, state.canvas.height], [1920, 1080])
  assert.equal(state.layers[0].source.sourceId, 'source:D:\\bottom.mp4')
  assert.equal(state.layers[1].source.probe.hasAlpha, true)
  assert.equal(state.audioSourceLayerId, 'video-layer-bottom')
  assert.equal(store.projectDurationSec(), 4)

  store.patchTransform('video-layer-top', { centerX: 240, centerY: 300, scale: 0.5 })
  store.moveLayer('video-layer-top', -1)
  assert.equal(store.getState().layers[0].id, 'video-layer-top')
  assert.equal(store.getState().layers[0].transform.centerX, 240)
  assert.equal(store.getState().layers[1].transform.centerX, 960)
  store.destroy()
})

test('resource state rejects unsupported files without mutating a layer', async () => {
  const store = resourceModule.api.createStore({ getPathForFile: (file) => file.localPath })
  await assert.rejects(
    store.importFile('video-layer-bottom', { name: 'legacy.mov', type: 'video/quicktime', localPath: 'D:\\legacy.mov' }),
    /仅支持/,
  )
  assert.equal(store.getState().layers[0].source, null)
  store.destroy()
})

test('a slower replaced import cannot overwrite the latest layer source', async () => {
  const pending = new Map()
  const revoked = []
  const store = resourceModule.api.createStore({
    getPathForFile: (file) => file.localPath,
    createObjectUrl: (file) => `blob:${file.name}`,
    revokeObjectUrl: (url) => revoked.push(url),
    registerSource: (payload) => new Promise((resolve) => pending.set(payload.filePath, () => resolve(sourceResult(payload)))),
  })
  const first = store.importFile('video-layer-top', { name: 'first.mp4', type: 'video/mp4', localPath: 'D:\\first.mp4' })
  const second = store.importFile('video-layer-top', { name: 'second.mp4', type: 'video/mp4', localPath: 'D:\\second.mp4' })
  pending.get('D:\\second.mp4')()
  await second
  pending.get('D:\\first.mp4')()
  await assert.rejects(first, /superseded/)
  assert.equal(store.getState().layers[1].source.fileName, 'second.mp4')
  assert.deepEqual(revoked, ['blob:first.mp4'])
  store.destroy()
})

test('concurrent layer imports remain busy until every registration settles', async () => {
  const deferred = new Map()
  const store = resourceModule.api.createStore({
    getPathForFile: (file) => file.localPath,
    createObjectUrl: () => '',
    registerSource: async (payload) => {
      if (/base/i.test(payload.filePath)) return sourceResult(payload)
      return new Promise((resolve) => deferred.set(payload.filePath, () => resolve(sourceResult(payload))))
    },
  })
  await store.importFile('video-layer-bottom', { name: 'bottom-base.mp4', type: 'video/mp4', localPath: 'D:\\bottom-base.mp4' })
  await store.importFile('video-layer-top', { name: 'top-base.mp4', type: 'video/mp4', localPath: 'D:\\top-base.mp4' })

  const bottomImport = store.importFile('video-layer-bottom', { name: 'bottom-new.mp4', type: 'video/mp4', localPath: 'D:\\bottom-new.mp4' })
  const topImport = store.importFile('video-layer-top', { name: 'top-new.mp4', type: 'video/mp4', localPath: 'D:\\top-new.mp4' })
  assert.equal(store.getState().importingCount, 2)
  assert.deepEqual(Array.from(store.getState().importingLayerIds).sort(), ['video-layer-bottom', 'video-layer-top'])

  deferred.get('D:\\bottom-new.mp4')()
  await bottomImport
  assert.equal(store.getState().importingCount, 1)
  assert.deepEqual(Array.from(store.getState().importingLayerIds), ['video-layer-top'])
  assert.equal(store.getState().importingLayerId, 'video-layer-top')

  deferred.get('D:\\top-new.mp4')()
  await topImport
  assert.equal(store.getState().importingCount, 0)
  assert.deepEqual(Array.from(store.getState().importingLayerIds), [])
  assert.equal(store.getState().importingLayerId, null)
  store.destroy()
})

test('replacing and destroying layers releases compositor source registrations', async () => {
  const released = []
  const store = resourceModule.api.createStore({
    getPathForFile: (file) => file.localPath,
    createObjectUrl: () => '',
    registerSource: async (payload) => sourceResult(payload),
    releaseSource: async (sourceId) => { released.push(sourceId); return { ok: true, released: true } },
  })
  await store.importFile('video-layer-bottom', { name: 'first.mp4', type: 'video/mp4', localPath: 'D:\\first.mp4' })
  await store.importFile('video-layer-bottom', { name: 'second.mp4', type: 'video/mp4', localPath: 'D:\\second.mp4' })
  assert.deepEqual(released, ['source:D:\\first.mp4'])
  store.destroy()
  await Promise.resolve()
  assert.deepEqual(released, ['source:D:\\first.mp4', 'source:D:\\second.mp4'])
})

test('layer scale is clamped to the compositor 8192 pixel limit', async () => {
  const store = resourceModule.api.createStore({
    getPathForFile: (file) => file.localPath,
    createObjectUrl: () => '',
    registerSource: async (payload) => sourceResult(payload, { width: 4000, height: 2160, displayWidth: 4000, displayHeight: 2160 }),
  })
  await store.importFile('video-layer-top', { name: 'large.mp4', type: 'video/mp4', localPath: 'D:\\large.mp4' })
  store.patchTransform('video-layer-top', { scale: 32 })
  const layer = store.getState().layers[1]
  assert.equal(layer.transform.scale, 8192 / 4000)
  assert.ok(Math.round(layer.source.probe.displayWidth * layer.transform.scale) <= 8192)
  store.destroy()

  const tinyStore = resourceModule.api.createStore({
    getPathForFile: (file) => file.localPath,
    createObjectUrl: () => '',
    registerSource: async (payload) => sourceResult(payload, /canvas/.test(payload.filePath)
      ? { width: 8192, height: 8192, displayWidth: 8192, displayHeight: 8192 }
      : { width: 1, height: 1, displayWidth: 1, displayHeight: 1 }),
  })
  await tinyStore.importFile('video-layer-bottom', { name: 'canvas.mp4', type: 'video/mp4', localPath: 'D:\\canvas.mp4' })
  await tinyStore.importFile('video-layer-top', { name: 'tiny.mp4', type: 'video/mp4', localPath: 'D:\\tiny.mp4' })
  assert.equal(tinyStore.getState().layers[1].transform.scale, 32)
  tinyStore.destroy()
})

test('export manifest preserves bottom-to-top order, static masks, explicit audio and deterministic output defaults', () => {
  const state = {
    format: 'webm',
    canvas: { width: 1920, height: 1080, fps: 60 },
    audioSourceLayerId: 'bottom',
    layers: [
      { id: 'bottom', visible: true, source: { sourceId: 'source-bottom', probe: { hasAudio: true } }, transform: { centerX: 960, centerY: 540, scale: 1 } },
      { id: 'top', visible: true, source: { sourceId: 'source-top', probe: { hasAudio: false } }, transform: { centerX: 840, centerY: 480, scale: 0.5 } },
    ],
  }
  const manifest = exportModule.api.buildManifest(state, {
    sessionId: 'session', jobId: 'job', filePath: 'D:\\out.webm', maskIds: { bottom: null, top: 'mask-top' },
  })
  assert.equal(manifest.schema, 'novaflow.video-compositor.export/v1')
  assert.deepEqual(Array.from(manifest.layers, (layer) => layer.layerId), ['bottom', 'top'])
  assert.equal(manifest.layers[1].maskId, 'mask-top')
  assert.equal(manifest.output.format, 'webm')
  assert.equal(manifest.output.fps, 60)
  assert.equal(manifest.audio.mode, 'single')
  assert.equal(manifest.audio.sourceLayerId, 'bottom')
  assert.equal(Object.hasOwn(manifest.layers[0].transform, 'rotationDeg'), false)
  assert.equal(Object.hasOwn(manifest.layers[0].transform, 'opacity'), false)
})

test('export manifest refuses projects that do not contain both video sources', () => {
  assert.throws(() => exportModule.api.buildManifest({
    format: 'mp4', canvas: { width: 1920, height: 1080, fps: 30 },
    layers: [{ id: 'bottom', source: null }, { id: 'top', source: null }],
  }, { sessionId: 'session', filePath: 'D:\\out.mp4' }), /载入两个视频/)
})

test('export workflow reports compositor capability without blocking the browser workspace', async () => {
  const workflow = exportModule.api.createWorkflow({ electronAPI: {} })
  const capability = workflow.getCapability()
  assert.equal(Object.isFrozen(capability), true)
  assert.equal(capability.canOpenSession, false)
  assert.equal(capability.canRegisterSource, false)
  assert.equal(capability.canReleaseSource, false)
  assert.equal(capability.canExport, false)
  assert.equal(capability.available, false)
  assert.match(capability.message, /当前环境暂不支持视频合并导出/)
  assert.doesNotMatch(capability.message, /video_merge_/)
  await assert.rejects(workflow.openSession({ boardId: 'browser-board' }), /当前环境暂不支持视频合并导出/)
  await workflow.close()

  const fullCapability = exportModule.api.inspectCapability({
    videoCompositorOpenSession() {},
    videoCompositorRegisterSource() {},
    videoCompositorReleaseSource() {},
    videoCompositorPutMask() {},
    exportPickSaveFile() {},
    aiSeqCacheReserveOutput() {},
    aiSeqCacheReleaseOutput() {},
    videoCompositorExport() {},
  })
  assert.equal(fullCapability.canRegisterSource, true)
  assert.equal(fullCapability.canReleaseSource, true)
  assert.equal(fullCapability.canExport, true)
  assert.equal(fullCapability.canExportToFile, true)
  assert.equal(fullCapability.canSaveToResources, true)
  assert.equal(fullCapability.message, '')
})

test('resource save reserves an internal cache target without opening the save picker', async () => {
  let pickerCalls = 0
  const reservedPaths = []
  const manifests = []
  const workflow = exportModule.api.createWorkflow({
    electronAPI: {
      videoCompositorOpenSession: async () => ({ ok: true, sessionId: 'session-resource-save' }),
      videoCompositorRegisterSource() {},
      videoCompositorPutMask() {},
      videoCompositorExport: async (manifest) => { manifests.push(manifest); return { ok: true, filePath: manifest.output.filePath } },
      videoCompositorCloseSession: async () => ({ ok: true }),
      exportPickSaveFile: async () => { pickerCalls += 1; return { ok: true, filePath: 'D:\\exports\\should-not-be-used.mp4' } },
      aiSeqCacheReserveOutput: async () => {
        const path = 'C:\\NovaFlowTemp\\novaflow_video_merge_internal.mp4'
        reservedPaths.push(path)
        return { ok: true, path }
      },
      aiSeqCacheReleaseOutput: async () => ({ ok: true, released: true }),
    },
  })
  const state = {
    format: 'mp4', canvas: { width: 16, height: 16, fps: 30 }, audioSourceLayerId: null,
    layers: [
      { id: 'bottom', visible: true, maskRevision: 0, source: { sourceId: 'source-bottom', probe: { hasAudio: false } }, transform: { centerX: 8, centerY: 8, scale: 1 } },
      { id: 'top', visible: true, maskRevision: 0, source: { sourceId: 'source-top', probe: { hasAudio: false } }, transform: { centerX: 8, centerY: 8, scale: 1 } },
    ],
  }
  const result = await workflow.exportProject(state, new Map(), { destination: 'resource', baseName: 'novaflow_video_merge' })
  assert.equal(result.ok, true)
  assert.equal(pickerCalls, 0)
  assert.deepEqual(reservedPaths, ['C:\\NovaFlowTemp\\novaflow_video_merge_internal.mp4'])
  assert.equal(manifests[0].output.filePath, reservedPaths[0])
  await workflow.close()
})

test('export workflow shares an in-flight compositor session open', async () => {
  let openCalls = 0
  let resolveOpen
  const opened = new Promise((resolve) => { resolveOpen = resolve })
  const workflow = exportModule.api.createWorkflow({
    electronAPI: {
      videoCompositorOpenSession: async () => { openCalls += 1; return opened },
      videoCompositorCloseSession: async () => ({ ok: true }),
    },
  })
  const first = workflow.openSession({ boardId: 'board-1' })
  const second = workflow.openSession({ boardId: 'board-1' })
  assert.equal(openCalls, 1)
  resolveOpen({ ok: true, sessionId: 'session-one' })
  assert.deepEqual(await Promise.all([first, second]), ['session-one', 'session-one'])
  await workflow.close()
})

test('closing during session creation closes the late session instead of leaking it', async () => {
  let resolveOpen
  const closed = []
  const opened = new Promise((resolve) => { resolveOpen = resolve })
  const workflow = exportModule.api.createWorkflow({
    electronAPI: {
      videoCompositorOpenSession: async () => opened,
      videoCompositorCloseSession: async (payload) => { closed.push(payload.sessionId); return { ok: true } },
    },
  })
  const opening = workflow.openSession({ boardId: 'board-1' })
  const closing = workflow.close()
  resolveOpen({ ok: true, sessionId: 'late-session' })
  await assert.rejects(opening, /workflow_closed/)
  await closing
  assert.deepEqual(closed, ['late-session'])
})

test('mask export encodes the OffscreenCanvas convertToBlob path used by Electron', async () => {
  const expected = new Uint8Array([137, 80, 78, 71]).buffer
  let requestedType = ''
  const actual = await exportModule.api.surfaceToPngArrayBuffer({
    getCanvas: () => ({
      convertToBlob: async (options) => {
        requestedType = options.type
        return { arrayBuffer: async () => expected }
      },
    }),
  })
  assert.equal(requestedType, 'image/png')
  assert.deepEqual(Array.from(new Uint8Array(actual)), [137, 80, 78, 71])
})

test('mask cache is scoped to the registered source when a layer video is replaced', async () => {
  const uploads = []
  const workflow = exportModule.api.createWorkflow({
    electronAPI: {
      videoCompositorOpenSession: async () => ({ ok: true, sessionId: 'session-mask-cache' }),
      videoCompositorPutMask: async (payload) => {
        uploads.push(payload.sourceId)
        return { ok: true, maskId: `mask-${payload.sourceId}` }
      },
      videoCompositorCloseSession: async () => ({ ok: true }),
    },
  })
  const surface = { toPngArrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
  const layer = {
    id: 'video-layer-top', maskRevision: 1,
    source: { sourceId: 'source-old', probe: { displayWidth: 16, displayHeight: 16 } },
  }
  assert.equal(await workflow.putMask(layer, surface), 'mask-source-old')
  layer.source = { sourceId: 'source-new', probe: { displayWidth: 16, displayHeight: 16 } }
  assert.equal(await workflow.putMask(layer, surface), 'mask-source-new')
  assert.deepEqual(uploads, ['source-old', 'source-new'])
  await workflow.close()
})

test('an export can be canceled during preparation and blocks a concurrent export', async () => {
  let resolveSession
  let exportCalls = 0
  const sessionResult = new Promise((resolve) => { resolveSession = resolve })
  const workflow = exportModule.api.createWorkflow({
    electronAPI: {
      videoCompositorOpenSession: async () => sessionResult,
      videoCompositorExport: async () => { exportCalls += 1; return { ok: true } },
      videoCompositorCloseSession: async () => ({ ok: true }),
    },
  })
  const state = {
    format: 'mp4', canvas: { width: 1920, height: 1080, fps: 30 }, audioSourceLayerId: null,
    layers: [
      { id: 'bottom', visible: true, maskRevision: 0, source: { sourceId: 'source-bottom', probe: { hasAudio: false } }, transform: { centerX: 960, centerY: 540, scale: 1 } },
      { id: 'top', visible: true, maskRevision: 0, source: { sourceId: 'source-top', probe: { hasAudio: false } }, transform: { centerX: 960, centerY: 540, scale: 1 } },
    ],
  }
  const first = workflow.exportProject(state, new Map(), { filePath: 'D:\\first.mp4' })
  await assert.rejects(
    workflow.exportProject(state, new Map(), { filePath: 'D:\\second.mp4' }),
    /already_running/,
  )
  const canceled = await workflow.cancel()
  assert.equal(canceled.preparing, true)
  resolveSession({ ok: true, sessionId: 'session-prepare-cancel' })
  assert.equal((await first).canceled, true)
  assert.equal(exportCalls, 0)
  await workflow.close()
})

test('the desktop export_canceled result is treated as a normal cancellation', async () => {
  const workflow = exportModule.api.createWorkflow({
    electronAPI: {
      videoCompositorOpenSession: async () => ({ ok: true, sessionId: 'session-canceled-result' }),
      videoCompositorExport: async () => ({ ok: false, code: 'export_canceled', error: 'export_canceled' }),
      videoCompositorCloseSession: async () => ({ ok: true }),
    },
  })
  const state = {
    format: 'mp4', canvas: { width: 16, height: 16, fps: 30 }, audioSourceLayerId: null,
    layers: [
      { id: 'bottom', visible: true, maskRevision: 0, source: { sourceId: 'source-bottom', probe: { hasAudio: false } }, transform: { centerX: 8, centerY: 8, scale: 1 } },
      { id: 'top', visible: true, maskRevision: 0, source: { sourceId: 'source-top', probe: { hasAudio: false } }, transform: { centerX: 8, centerY: 8, scale: 1 } },
    ],
  }
  const result = await workflow.exportProject(state, new Map(), { filePath: 'D:\\canceled.mp4' })
  assert.equal(result.canceled, true)
  await workflow.close()
})

test('save picker backend failures surface their original error', async () => {
  const workflow = exportModule.api.createWorkflow({
    electronAPI: {
      exportPickSaveFile: async () => ({ ok: false, error: 'save_picker_backend_unavailable' }),
    },
  })
  const state = {
    format: 'mp4', canvas: { width: 16, height: 16, fps: 30 }, audioSourceLayerId: null,
    layers: [
      { id: 'bottom', visible: true, maskRevision: 0, source: { sourceId: 'source-bottom', probe: { hasAudio: false } }, transform: { centerX: 8, centerY: 8, scale: 1 } },
      { id: 'top', visible: true, maskRevision: 0, source: { sourceId: 'source-top', probe: { hasAudio: false } }, transform: { centerX: 8, centerY: 8, scale: 1 } },
    ],
  }
  await assert.rejects(workflow.exportProject(state, new Map()), /save_picker_backend_unavailable/)
  await workflow.close()
})

test('preview implements viewport-resolution layer composition, coverage masking and drift correction', () => {
  assert.match(previewSource, /globalCompositeOperation = 'destination-in'/)
  assert.match(previewSource, /SYNC_DRIFT_SECONDS = 0\.08/)
  assert.match(previewSource, /requestAnimationFrame/)
  assert.match(previewSource, /video\.readyState >= 2 && !video\.paused && !video\.ended/)
  assert.match(previewSource, /loadedmetadata/)
  assert.match(previewSource, /setInteractionLocked/)
  assert.match(previewSource, /store\.moveLayer|state\.layers\.forEach/)
  assert.match(previewSource, /centerX/)
  assert.match(previewSource, /layerScale/)
  assert.match(previewSource, /fitToViewport/)
  assert.match(previewSource, /handleWheel/)
  assert.match(previewSource, /event\.button === 2/)
  assert.match(previewSource, /viewportZoom/)
  assert.doesNotMatch(previewSource, /manualFrames|frameOverrides|round\(time\s*\*\s*1000\)/)
})

class WorkspaceFakeEventTarget {
  constructor() { this.listeners = new Map() }
  addEventListener(type, listener, options) {
    const capture = options === true || options?.capture === true
    const entries = this.listeners.get(type) || []
    entries.push({ listener, capture })
    this.listeners.set(type, entries)
  }
  removeEventListener(type, listener, options) {
    const capture = options === true || options?.capture === true
    const entries = this.listeners.get(type) || []
    this.listeners.set(type, entries.filter((entry) => entry.listener !== listener || entry.capture !== capture))
  }
  dispatchEvent(event) {
    if (!event || !event.type) throw new TypeError('event type required')
    if (!event.target) event.target = this
    Array.from(this.listeners.get(event.type) || []).forEach((entry) => entry.listener.call(this, event))
    return event.defaultPrevented !== true
  }
  listenerCount(type) { return (this.listeners.get(type) || []).length }
}

class WorkspaceFakeStyle {
  constructor() { this.values = new Map() }
  get position() { return this.getPropertyValue('position') }
  setProperty(name, value) { this.values.set(name, String(value)) }
  removeProperty(name) { this.values.delete(name) }
  getPropertyValue(name) { return this.values.get(name) || '' }
  getPropertyPriority() { return '' }
}

class WorkspaceFakeNode extends WorkspaceFakeEventTarget {
  constructor(ownerDocument, tagName) {
    super()
    this.ownerDocument = ownerDocument
    this.tagName = String(tagName || '').toUpperCase()
    this.children = []
    this.parentElement = null
    this.parentNode = null
    this.style = new WorkspaceFakeStyle()
    this.attributes = new Map()
    this.className = ''
    this.textContent = ''
    this.focusCalls = []
  }
  appendChild(child) {
    child.parentElement = this
    child.parentNode = this
    this.children.push(child)
    return child
  }
  append(...children) { children.forEach((child) => this.appendChild(child)) }
  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentElement = null; child.parentNode = null })
    this.children = []
    this.append(...children)
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
  hasAttribute(name) { return this.attributes.has(name) }
  removeAttribute(name) { this.attributes.delete(name) }
  contains(candidate) {
    if (candidate === this) return true
    return this.children.some((child) => child.contains?.(candidate))
  }
  matches(selector) {
    const match = /^\[([^=\]]+)(?:=["']([^"']*)["'])?\]$/.exec(String(selector || ''))
    if (!match || !this.attributes.has(match[1])) return false
    return match[2] === undefined || this.attributes.get(match[1]) === match[2]
  }
  closest(selector) {
    let node = this
    while (node) {
      if (node.matches?.(selector)) return node
      node = node.parentElement
    }
    return null
  }
  querySelectorAll(selector) {
    const matches = []
    this.children.forEach((child) => {
      if (child.matches?.(selector)) matches.push(child)
      matches.push(...(child.querySelectorAll?.(selector) || []))
    })
    return matches
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
  focus(options) { this.focusCalls.push(options || null) }
  remove() {
    if (!this.parentElement) return
    const siblings = this.parentElement.children
    const index = siblings.indexOf(this)
    if (index >= 0) siblings.splice(index, 1)
    this.parentElement = null
    this.parentNode = null
  }
}

function createWorkspaceInteractionHarness(options = {}) {
  const windowRef = new WorkspaceFakeEventTarget()
  windowRef.getComputedStyle = () => ({ position: 'static' })
  const documentRef = new WorkspaceFakeEventTarget()
  documentRef.defaultView = windowRef
  documentRef.createElement = (tagName) => new WorkspaceFakeNode(documentRef, tagName)
  documentRef.createDocumentFragment = () => new WorkspaceFakeNode(documentRef, '#fragment')
  const documentBody = new WorkspaceFakeNode(documentRef, 'body')
  documentRef.body = documentBody
  const previewHost = new WorkspaceFakeNode(documentRef, 'div')
  const boardControls = new WorkspaceFakeNode(documentRef, 'div')
  boardControls.setAttribute('data-novaflow-ai-board-controls-top-left', '1')
  documentBody.append(previewHost, boardControls)
  const postSection = new WorkspaceFakeNode(documentRef, 'div')
  postSection.setAttribute('data-novaflow-ai-post-section', '1')
  const imports = []
  const resolvedDrops = []
  const resolvedResourceIds = []
  const publishedOutputs = []
  const releasedOutputs = []
  const exportCalls = []
  const moves = []
  const previewCalls = { pause: 0, play: 0, seek: [], mask: [], brush: [], fit: 0 }
  const loadedSource = (name) => ({
    sourceId: `source:${name}`,
    fileName: `${name}.mp4`,
    objectUrl: `blob:${name}`,
    exportReady: options.exportReady === true,
    probe: { displayWidth: 1920, displayHeight: 1080, durationSec: 2, hasAudio: false, hasAlpha: false },
  })
  const state = {
    projectId: 'workspace-test', format: 'mp4', audioSourceLayerId: null,
    canvas: { width: 1920, height: 1080, fps: 30 },
    selectedLayerId: 'video-layer-bottom', playing: false, timeSec: 0,
    importingCount: 0, importingLayerIds: [], importingLayerId: null, error: '', message: '',
    layers: [
      { id: 'video-layer-bottom', title: 'bottom', visible: true, source: options.loaded ? loadedSource('bottom') : null, maskRevision: 0 },
      { id: 'video-layer-top', title: 'top', visible: true, source: options.loaded ? loadedSource('top') : null, maskRevision: 0 },
    ],
  }
  const maskSurface = {
    canUndo: () => false,
    canRedo: () => false,
    copyCoverage: () => new Uint8ClampedArray([255]),
    debugState: () => ({ revision: 0 }),
    undo() {}, redo() {}, reset() {}, destroy() {},
  }
  function importDescriptor(layerId, descriptor) {
    imports.push({ layerId, descriptor })
    const layer = state.layers.find((candidate) => candidate.id === layerId)
    layer.source = {
      sourceId: `source:${descriptor.localPath || descriptor.path}`,
      fileName: descriptor.fileName || descriptor.name,
      exportReady: false,
      probe: { displayWidth: 1920, displayHeight: 1080, durationSec: 2, hasAudio: false, hasAlpha: false },
    }
    return Promise.resolve(layer.source)
  }
  const store = {
    getState: () => state,
    getSnapshot: () => state,
    subscribe: () => () => {},
    setMessage(message, error) { state.message = message; state.error = error ? message : '' },
    importDescriptor,
    importFile: (layerId, file) => importDescriptor(layerId, { path: file.path, name: file.name }),
    setMaskRevision(layerId, revision) { state.layers.find((layer) => layer.id === layerId).maskRevision = revision },
    toggleVisibility() {}, removeSource() {}, selectLayer(layerId) { state.selectedLayerId = layerId },
    moveLayer(layerId, direction) { moves.push({ layerId, direction }) }, fitLayer() {}, setFormat() {}, setFps() {}, setAudioSource() {},
    projectDurationSec: () => options.durationSec || 0,
    destroy() {},
  }
  const previewCanvas = new WorkspaceFakeNode(documentRef, 'canvas')
  const preview = {
    pause() { previewCalls.pause += 1; state.playing = false },
    play() { previewCalls.play += 1; state.playing = true; return Promise.resolve(true) },
    seek(value) { previewCalls.seek.push(Number(value)); state.timeSec = Number(value) },
    fitToViewport() { previewCalls.fit += 1; return true },
    render() {}, destroy() {}, setInteractionLocked() {},
    setMaskEditing(value) { previewCalls.mask.push(value) },
    updateMaskBrush(value) { previewCalls.brush.push({ ...value }) },
    getCanvas: () => previewCanvas,
    debugSnapshot: () => ({}),
  }
  const dropAdapter = {
    async resolveDrop(dataTransfer) {
      resolvedDrops.push(dataTransfer)
      return { kind: 'files', descriptors: [{ localPath: dataTransfer.testPath, fileName: 'drop.mp4', mimeType: 'video/mp4' }], rejectedCount: 0 }
    },
    async resolveResource(resourceId) {
      resolvedResourceIds.push(resourceId)
      return { resourceId, localPath: `D:\\${resourceId}.mp4`, fileName: `${resourceId}.mp4`, mimeType: 'video/mp4' }
    },
    async publishExportedVideo(payload) {
      publishedOutputs.push(payload)
      if (options.publishError) throw new Error(options.publishError)
      return {
        resourceId: 'merged-output',
        localPath: payload.filePath,
        fileName: 'merged.mp4',
        mimeType: 'video/mp4',
        objectUrl: 'novaflow-media://resource/token/merged.mp4',
      }
    },
  }
  const sandbox = {
    module: { exports: {} }, exports: {}, URL, console, setTimeout, clearTimeout,
    NovaFlowAiSequenceVideoMergeResource: { createStore: () => store },
    NovaFlowAiSequenceVideoMergeResourceBridge: {
      createAdapter: () => dropAdapter,
      planLayerAssignments(layers, descriptors, explicitLayerId) {
        const targets = explicitLayerId
          ? layers.filter((layer) => layer.id === explicitLayerId).slice(0, 1)
          : layers.filter((layer) => !layer.source)
        return targets.slice(0, descriptors.length).map((layer, index) => ({ layerId: layer.id, descriptor: descriptors[index] }))
      },
      readResourceId: () => '',
      RESOURCE_MIME: 'application/x-novaflow-ai-generated',
    },
    NovaFlowAiSequenceVideoMergePreview: { mount: () => preview },
    NovaFlowAiSequenceVideoMergeMaskTool: { createSurface: () => maskSurface },
    NovaFlowAiSequenceVideoMergeExportWorkflow: {
      unavailableMessage: 'unavailable',
      createWorkflow: () => ({
        getCapability: () => ({ canExport: options.exportReady === true, canRegisterSource: false }),
        async exportProject(stateValue, surfaces, exportOptions) {
          exportCalls.push({ stateValue, surfaces, exportOptions })
          if (options.exportCanceled) return { ok: false, canceled: true }
          return { ok: true, filePath: exportOptions.destination === 'resource' ? 'C:\\NovaFlowTemp\\merged.mp4' : 'D:\\exports\\merged.mp4' }
        },
        async releaseResourceOutput(filePath) { releasedOutputs.push(filePath); return { ok: true, released: true } },
        close: () => Promise.resolve(),
      }),
    },
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(workspaceSource, sandbox, { filename: 'ai-sequence-video-merge.workspace.js' })
  const handle = sandbox.module.exports.open({ previewHost, ...(options.externalControls ? { postSection } : {}) })
  return {
    windowRef, documentRef, previewHost, boardControls, postSection, handle, imports, resolvedDrops, resolvedResourceIds,
    state, previewCalls, previewCanvas, maskSurface, publishedOutputs, releasedOutputs, exportCalls, moves,
  }
}

function workspaceDropEvent(target, testPath) {
  return {
    type: 'drop', target,
    dataTransfer: { types: ['Files'], testPath, dropEffect: '' },
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.propagationStopped = true },
  }
}

async function flushWorkspaceTasks() {
  await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
}

test('workspace exposes two video slots, layer ordering, canvas transforms, global mask and fixed-output save flow', () => {
  assert.match(workspaceSource, /data-novaflow-ai-video-merge-workspace/)
  assert.match(workspaceSource, /--novaflow-ai-resource-sidebar-width,260px/)
  assert.match(workspaceSource, /grid-template-columns:220px minmax\(0,1fr\)/)
  assert.doesNotMatch(workspaceSource, /elevatePreviewBranch|rightPanel|video-merge-file-input/)
  assert.match(workspaceSource, /NovaFlowAiSequenceVideoMergeResourceBridge/)
  assert.match(workspaceSource, /dropAdapter\.resolveDrop/)
  assert.match(workspaceSource, /novaflow:ai-sequence-video-merge-import-resource/)
  assert.match(workspaceSource, /dropAdapter\.resolveResource/)
  assert.match(workspaceSource, /documentRef\.addEventListener\('drop',[\s\S]{0,120}true\)/)
  assert.match(workspaceSource, /documentRef\.addEventListener\('dragend'/)
  assert.match(workspaceSource, /documentRef\.removeEventListener\('drop'/)
  assert.match(workspaceSource, /documentRef\.removeEventListener\('dragend'/)
  assert.match(workspaceSource, /windowRef\.addEventListener\(RESOURCE_IMPORT_EVENT/)
  assert.match(workspaceSource, /windowRef\.removeEventListener\(RESOURCE_IMPORT_EVENT/)
  assert.match(workspaceSource, /stageHost\.addEventListener\('drop'/)
  assert.match(workspaceSource, /bindLayerDropTarget/)
  assert.match(workspaceSource, /projectIsImporting/)
  assert.doesNotMatch(workspaceSource, /exporting\s*=\s*!\[['"]done/)
  assert.match(workspaceSource, /视频图层（上层在前）/)
  assert.match(workspaceSource, /上移一层/)
  assert.match(workspaceSource, /下移一层/)
  assert.doesNotMatch(workspaceSource, /图层变换|拖右下角控制点等比缩放|居中适配画板/)
  assert.match(workspaceSource, /蒙版编辑（应用全部帧）/)
  assert.match(workspaceSource, /擦除/)
  assert.match(workspaceSource, /修复/)
  assert.match(workspaceSource, /羽化/)
  assert.match(workspaceSource, /撤销/)
  assert.match(workspaceSource, /重做/)
  assert.doesNotMatch(workspaceSource, /输出设置|输出格式|输出帧率|音频来源|导出合并视频/)
  assert.doesNotMatch(workspaceSource, /store\.setFormat|store\.setFps|store\.setAudioSource/)
  assert.doesNotMatch(workspaceSource, /headerExport|data-novaflow-ai-video-merge-export/)
  assert.doesNotMatch(workspaceSource, /nf-vm-header|nf-vm-title|nf-vm-subtitle/)
  assert.match(workspaceSource, /externalControlsHost\.appendChild\(leftPanel\)/)
  assert.match(workspaceSource, /data-novaflow-ai-video-merge-controls-external/)
  assert.match(workspaceSource, /编辑图层蒙版/)
  assert.doesNotMatch(workspaceSource, /编辑当前图层蒙版|退出视频合并|nf-vm-exit|nf-vm-layer-actions/)
  assert.match(workspaceSource, /nf-vm-layer-toolbar/)
  assert.match(workspaceSource, /data-novaflow-ai-video-merge-edit-mask[\s\S]{0,80}height:34px/)
  assert.match(workspaceSource, /nf-vm-panel[\s\S]{0,180}padding:10px 0 14px/)
  assert.match(workspaceSource, /nf-vm-layer[\s\S]{0,240}min-height:64px[\s\S]{0,160}background:#222/)
  assert.match(workspaceSource, /nf-vm-layer-thumbnail/)
  assert.match(workspaceSource, /context\.drawImage\(video/)
  assert.doesNotMatch(workspaceSource, /nf-vm-layer-index|层级 \$\{layerIndex\}/)
  assert.match(workspaceSource, /data-novaflow-ai-video-merge-auto-fit/)
  assert.match(workspaceSource, /data-novaflow-ai-video-merge-host-active/)
  assert.match(workspaceSource, /nf-vm-timeline[\s\S]{0,260}border-radius:8px[\s\S]{0,120}rgba\(24,24,24,\.96\)/)
  assert.match(workspaceSource, /exportFeedbackVisible/)
  assert.match(workspaceSource, /取消导出/)
  assert.match(workspaceSource, /workflow\.getCapability/)
  assert.match(workspaceSource, /exportCapability\.canRegisterSource/)
  assert.match(workspaceSource, /exportCapability\.canExport/)
  assert.match(workspaceSource, /source\.exportReady === true/)
  assert.match(workspaceSource, /storeOptions\.registerSource = workflow\.registerSource/)
  assert.doesNotMatch(workspaceSource, /nf-vm-empty|短视频结束后自动透明/)
  assert.doesNotMatch(workspaceSource, /单帧擦除|manualFrames|frameOverrides|全局复选框/)
})

test('workspace mounts editing controls below the shared left section and removes them on close', async () => {
  const harness = createWorkspaceInteractionHarness({ externalControls: true, loaded: true, durationSec: 2 })
  const shell = harness.previewHost.querySelector('[data-novaflow-ai-video-merge-workspace="1"]')
  const panel = harness.postSection.querySelector('[data-novaflow-ai-video-merge-control-panel="1"]')

  assert.ok(panel)
  assert.equal(shell.querySelector('[data-novaflow-ai-video-merge-control-panel="1"]'), null)
  assert.equal(panel.querySelector('[aria-label="关闭视频合并"]'), null)
  assert.equal(shell.getAttribute('data-novaflow-ai-video-merge-controls-external'), '1')

  const maskPanel = panel.querySelector('[data-novaflow-ai-video-merge-mask-panel="1"]')
  const editMask = panel.querySelector('[data-novaflow-ai-video-merge-edit-mask="1"]')
  const toolbar = panel.querySelector('[data-novaflow-ai-video-merge-layer-toolbar="1"]')
  const moveButtons = panel.querySelectorAll('[data-novaflow-ai-video-merge-move]')
  const cards = panel.querySelectorAll('[data-novaflow-ai-video-merge-layer]')
  const thumbnails = panel.querySelectorAll('[data-novaflow-ai-video-merge-layer-thumbnail]')
  const outputPanel = panel.querySelector('[data-novaflow-ai-video-merge-output-panel="1"]')
  const autoFit = shell.querySelector('[data-novaflow-ai-video-merge-auto-fit="1"]')
  assert.equal(maskPanel.parentElement.children[0], maskPanel)
  assert.equal(editMask.textContent, '编辑图层蒙版')
  assert.ok(toolbar)
  assert.equal(moveButtons.length, 2)
  assert.equal(cards.length, 2)
  assert.equal(thumbnails.length, 2)
  assert.ok(outputPanel)
  assert.equal(shell.querySelector('[data-novaflow-ai-video-merge-output-panel="1"]'), null)
  assert.equal(harness.previewHost.getAttribute('data-novaflow-ai-video-merge-host-active'), '1')
  assert.equal(harness.previewHost.ownerDocument.body.getAttribute('data-novaflow-ai-video-merge-host-active'), '1')
  assert.equal(harness.boardControls.style.getPropertyValue('display'), 'none')
  assert.ok(autoFit)
  autoFit.dispatchEvent({ type: 'click', target: autoFit })
  assert.equal(harness.previewCalls.fit, 1)
  cards.forEach((card) => assert.equal(card.querySelector('[data-novaflow-ai-video-merge-move]'), null))
  panel.querySelector('[data-novaflow-ai-video-merge-move="up"]').dispatchEvent({ type: 'click' })
  assert.deepEqual(harness.moves, [{ layerId: 'video-layer-bottom', direction: 1 }])

  editMask.dispatchEvent({ type: 'click', target: editMask })
  await flushWorkspaceTasks()
  const plus = {
    type: 'keydown', key: '+', code: 'Equal', target: panel,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.propagationStopped = true },
  }
  panel.dispatchEvent(plus)
  assert.deepEqual(harness.previewCalls.brush.at(-1), { feather: 1 })
  assert.equal(plus.defaultPrevented, true)

  harness.handle.close({ reason: 'test' })
  assert.equal(harness.previewHost.getAttribute('data-novaflow-ai-video-merge-host-active'), null)
  assert.equal(harness.previewHost.ownerDocument.body.getAttribute('data-novaflow-ai-video-merge-host-active'), null)
  assert.equal(harness.boardControls.style.getPropertyValue('display'), '')
  assert.equal(panel.parentElement, null)
  assert.equal(harness.postSection.querySelector('[data-novaflow-ai-video-merge-control-panel="1"]'), null)
})

test('fixed output settings stay hidden while idle and reserve feedback for export outcomes', () => {
  const harness = createWorkspaceInteractionHarness({ externalControls: true, loaded: true, durationSec: 2, exportReady: true })
  const shell = harness.previewHost.querySelector('[data-novaflow-ai-video-merge-workspace="1"]')
  const outputPanel = harness.postSection.querySelector('[data-novaflow-ai-video-merge-output-panel="1"]')

  assert.equal(shell.querySelector('[data-novaflow-ai-video-merge-output-panel="1"]'), null)
  assert.equal(outputPanel.hidden, true)
  assert.equal(outputPanel.children.length, 0)
  harness.handle.close({ reason: 'test' })
})

test('mask editing keeps the merge timeline active and routes feather shortcuts to the preview', async () => {
  const harness = createWorkspaceInteractionHarness({ loaded: true, durationSec: 2 })
  const shell = harness.previewHost.querySelector('[data-novaflow-ai-video-merge-workspace="1"]')
  const maskPanel = shell.querySelector('[data-novaflow-ai-video-merge-mask-panel="1"]')
  const editMaskButton = maskPanel.querySelector('[data-novaflow-ai-video-merge-edit-mask="1"]')

  editMaskButton.dispatchEvent({ type: 'click', target: editMaskButton })
  await flushWorkspaceTasks()

  assert.equal(harness.previewCalls.pause, 1)
  assert.equal(harness.previewCanvas.focusCalls.length, 1)
  assert.equal(harness.previewCanvas.focusCalls[0]?.preventScroll, true)

  const playButton = shell.querySelector('[data-novaflow-ai-video-merge-play="1"]')
  const timelineRange = shell.querySelector('[data-novaflow-ai-video-merge-timeline-range="1"]')
  assert.equal(playButton.disabled, false)
  assert.equal(timelineRange.disabled, false)

  playButton.dispatchEvent({ type: 'click', target: playButton })
  assert.equal(harness.previewCalls.play, 1)
  timelineRange.value = '1.25'
  timelineRange.dispatchEvent({ type: 'input', target: timelineRange })
  assert.deepEqual(harness.previewCalls.seek, [1.25])

  const shortcutEvent = (key, code, target = harness.previewCanvas, modifiers = {}) => ({
    type: 'keydown', key, code, target, ...modifiers,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.propagationStopped = true },
  })
  const plus = shortcutEvent('+', 'Equal', harness.previewCanvas, { shiftKey: true })
  shell.dispatchEvent(plus)
  shell.dispatchEvent(shortcutEvent('+', 'NumpadAdd'))
  shell.dispatchEvent(shortcutEvent('-', 'Minus'))
  shell.dispatchEvent(shortcutEvent('-', 'NumpadSubtract'))

  assert.deepEqual(harness.previewCalls.brush.slice(-4), [
    { feather: 1 }, { feather: 2 }, { feather: 1 }, { feather: 0 },
  ])
  assert.equal(plus.defaultPrevented, true)
  assert.equal(plus.propagationStopped, true)

  const callCount = harness.previewCalls.brush.length
  shell.dispatchEvent(shortcutEvent('+', 'Equal', harness.previewCanvas, { ctrlKey: true }))
  const input = new WorkspaceFakeNode(harness.documentRef, 'input')
  shell.dispatchEvent(shortcutEvent('+', 'Equal', input))
  const editable = new WorkspaceFakeNode(harness.documentRef, 'div')
  editable.setAttribute('contenteditable', 'true')
  shell.dispatchEvent(shortcutEvent('+', 'Equal', editable))
  assert.equal(harness.previewCalls.brush.length, callCount)

  harness.handle.close({ reason: 'test' })
})

test('workspace document capture routes drops to a layer or the stage and dragend clears highlights', async () => {
  const harness = createWorkspaceInteractionHarness()
  const shell = harness.previewHost.querySelector('[data-novaflow-ai-video-merge-workspace="1"]')
  const stage = shell.querySelector('[data-novaflow-ai-video-merge-stage="1"]')
  const topLayer = shell.querySelector('[data-novaflow-ai-video-merge-layer="video-layer-top"]')

  harness.documentRef.dispatchEvent(workspaceDropEvent(topLayer, 'D:\\top-drop.mp4'))
  await flushWorkspaceTasks()
  harness.documentRef.dispatchEvent(workspaceDropEvent(stage, 'D:\\stage-drop.mp4'))
  await flushWorkspaceTasks()

  assert.deepEqual(harness.imports.map((entry) => entry.layerId), ['video-layer-top', 'video-layer-bottom'])
  assert.equal(harness.resolvedDrops.length, 2)

  const renderedTopLayer = shell.querySelector('[data-novaflow-ai-video-merge-layer="video-layer-top"]')
  stage.setAttribute('data-drop-active', '1')
  renderedTopLayer.setAttribute('data-drop-active', '1')
  harness.documentRef.dispatchEvent({ type: 'dragend', target: renderedTopLayer })
  assert.equal(stage.hasAttribute('data-drop-active'), false)
  assert.equal(renderedTopLayer.hasAttribute('data-drop-active'), false)

  assert.equal(harness.documentRef.listenerCount('drop'), 1)
  assert.equal(harness.documentRef.listenerCount('dragend'), 1)
  harness.handle.close({ reason: 'test' })
  assert.equal(harness.documentRef.listenerCount('drop'), 0)
  assert.equal(harness.documentRef.listenerCount('dragend'), 0)
})

test('workspace resource import event resolves the stable resource ID without synthesizing a drop', async () => {
  const harness = createWorkspaceInteractionHarness()
  harness.windowRef.dispatchEvent({
    type: 'novaflow:ai-sequence-video-merge-import-resource',
    detail: { resourceId: 'resource-42', layerId: 'video-layer-top' },
  })
  await flushWorkspaceTasks()

  assert.deepEqual(harness.resolvedResourceIds, ['resource-42'])
  assert.equal(harness.resolvedDrops.length, 0)
  assert.deepEqual(harness.imports.map((entry) => entry.layerId), ['video-layer-top'])
  assert.equal(harness.windowRef.listenerCount('novaflow:ai-sequence-video-merge-import-resource'), 1)

  harness.handle.close({ reason: 'test' })
  assert.equal(harness.windowRef.listenerCount('novaflow:ai-sequence-video-merge-import-resource'), 0)
})

test('save and close exports once, publishes the path, then tears down the workspace', async () => {
  const harness = createWorkspaceInteractionHarness({ loaded: true, durationSec: 2, exportReady: true })
  const result = await harness.handle.saveAndClose()

  assert.equal(result.ok, true)
  assert.equal(harness.exportCalls.length, 1)
  assert.equal(harness.exportCalls[0].exportOptions.baseName, 'novaflow_video_merge')
  assert.equal(harness.exportCalls[0].exportOptions.destination, 'resource')
  assert.equal(harness.publishedOutputs.length, 1)
  assert.equal(harness.publishedOutputs[0].filePath, 'C:\\NovaFlowTemp\\merged.mp4')
  assert.equal(harness.publishedOutputs[0].mimeType, 'video/mp4')
  assert.equal(result.resource.resourceId, 'merged-output')
  assert.equal(harness.handle.debugSnapshot().open, false)
})

test('save and close releases its internal output and keeps editing open when publication fails', async () => {
  const harness = createWorkspaceInteractionHarness({ externalControls: true, loaded: true, durationSec: 2, exportReady: true, publishError: 'publish-failed' })
  const result = await harness.handle.saveAndClose()
  await flushWorkspaceTasks()

  assert.equal(result.ok, false)
  assert.equal(result.filePath, 'C:\\NovaFlowTemp\\merged.mp4')
  assert.deepEqual(harness.releasedOutputs, ['C:\\NovaFlowTemp\\merged.mp4'])
  assert.equal(harness.state.error.includes('publish-failed'), true)
  assert.equal(harness.state.error.includes('C:\\NovaFlowTemp\\merged.mp4'), false)
  assert.equal(harness.handle.debugSnapshot().open, true)
  assert.equal(harness.handle.debugSnapshot().exporting, false)
  const outputPanel = harness.postSection.querySelector('[data-novaflow-ai-video-merge-output-panel="1"]')
  assert.equal(outputPanel.hidden, false)
  assert.equal(outputPanel.children[0].children[0].textContent.includes('publish-failed'), true)
  harness.handle.close({ reason: 'test' })
})

test('canceling an internal resource save keeps the merge workspace open and publish-free', async () => {
  const harness = createWorkspaceInteractionHarness({ externalControls: true, loaded: true, durationSec: 2, exportReady: true, exportCanceled: true })
  const result = await harness.handle.saveAndClose()
  await flushWorkspaceTasks()

  assert.equal(result.canceled, true)
  assert.equal(harness.publishedOutputs.length, 0)
  assert.equal(harness.handle.debugSnapshot().open, true)
  assert.equal(harness.handle.debugSnapshot().exporting, false)
  const outputPanel = harness.postSection.querySelector('[data-novaflow-ai-video-merge-output-panel="1"]')
  assert.equal(outputPanel.hidden, true)
  harness.handle.close({ reason: 'test' })
})

test('workspace export uses the file destination without publishing or closing', async () => {
  const harness = createWorkspaceInteractionHarness({ loaded: true, durationSec: 2, exportReady: true })
  const result = await harness.handle.export()

  assert.equal(result.ok, true)
  assert.equal(harness.exportCalls.length, 1)
  assert.equal(harness.exportCalls[0].exportOptions.destination, 'file')
  assert.equal(harness.publishedOutputs.length, 0)
  assert.equal(result.filePath, 'D:\\exports\\merged.mp4')
  assert.equal(harness.handle.debugSnapshot().open, true)
  harness.handle.close({ reason: 'test' })
})

test('workspace initialization failure rolls back its shell, host position and workflow', () => {
  class FakeStyle {
    constructor() { this.values = new Map() }
    get position() { return this.getPropertyValue('position') }
    setProperty(name, value) { this.values.set(name, String(value)) }
    removeProperty(name) { this.values.delete(name) }
    getPropertyValue(name) { return this.values.get(name) || '' }
    getPropertyPriority() { return '' }
  }
  class FakeNode {
    constructor(ownerDocument, tagName) {
      this.ownerDocument = ownerDocument
      this.tagName = String(tagName || '').toUpperCase()
      this.children = []
      this.parentElement = null
      this.style = new FakeStyle()
      this.attributes = new Map()
      this.className = ''
      this.textContent = ''
    }
    appendChild(child) {
      child.parentElement = this
      this.children.push(child)
      return child
    }
    append(...children) { children.forEach((child) => this.appendChild(child)) }
    setAttribute(name, value) { this.attributes.set(name, String(value)) }
    remove() {
      if (!this.parentElement) return
      const siblings = this.parentElement.children
      const index = siblings.indexOf(this)
      if (index >= 0) siblings.splice(index, 1)
      this.parentElement = null
    }
  }
  const documentRef = {
    defaultView: { getComputedStyle: () => ({ position: 'static' }) },
    createElement(tagName) { return new FakeNode(documentRef, tagName) },
  }
  const previewHost = new FakeNode(documentRef, 'div')
  let workflowCloseCalls = 0
  const sandbox = {
    module: { exports: {} }, exports: {}, URL, console, setTimeout, clearTimeout,
    NovaFlowAiSequenceVideoMergeResource: { createStore: () => { throw new Error('store-boom') } },
    NovaFlowAiSequenceVideoMergeResourceBridge: { createAdapter: () => ({ resolveDrop() {} }), planLayerAssignments() { return [] }, readResourceId() {}, RESOURCE_MIME: 'application/x-novaflow-ai-generated' },
    NovaFlowAiSequenceVideoMergePreview: { mount: () => ({ destroy() {} }) },
    NovaFlowAiSequenceVideoMergeMaskTool: { createSurface() {} },
    NovaFlowAiSequenceVideoMergeExportWorkflow: {
      createWorkflow: () => ({
        registerSource() {}, releaseSource() {},
        close() { workflowCloseCalls += 1; return Promise.resolve() },
      }),
    },
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(workspaceSource, sandbox, { filename: 'ai-sequence-video-merge.workspace.js' })
  assert.throws(() => sandbox.module.exports.open({ previewHost }), /store-boom/)
  assert.equal(previewHost.children.length, 0)
  assert.equal(previewHost.style.position, '')
  assert.equal(workflowCloseCalls, 1)
  assert.equal(sandbox.module.exports.isOpen(), false)
})

test('workspace teardown releases preview, masks, store and compositor session', () => {
  assert.match(workspaceSource, /preview\.destroy\(\)/)
  assert.match(workspaceSource, /maskSurfaces\.forEach/)
  assert.match(workspaceSource, /store\.destroy\(\)/)
  assert.match(workspaceSource, /workflow\.close\(\)/)
  assert.match(workspaceSource, /shell\.remove\(\)/)
  assert.doesNotMatch(workspaceSource, /restorePreviewElevation|elevatePreviewBranch/)
  assert.match(workspaceSource, /restorePreviewHostPosition\(\)/)
})
