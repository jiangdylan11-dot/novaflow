const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const bridgePath = path.resolve(__dirname, '..', '..', 'particle-editor', 'ai-sequence-video-merge.resource-bridge.js')
const resourcePath = path.resolve(__dirname, '..', '..', 'particle-editor', 'ai-sequence-video-merge.resource.js')
const rendererBundlePath = path.resolve(__dirname, '..', '..', 'particle-editor', 'assets', 'index-BbIa-2NM.js')
const sandbox = { module: { exports: {} }, exports: {}, URL, console, setTimeout, clearTimeout }
sandbox.globalThis = sandbox
vm.runInNewContext(fs.readFileSync(bridgePath, 'utf8'), sandbox, { filename: bridgePath })
const bridgeModule = sandbox.module.exports
const resourceSandbox = { module: { exports: {} }, exports: {}, URL, console, setTimeout, clearTimeout }
resourceSandbox.globalThis = resourceSandbox
vm.runInNewContext(fs.readFileSync(resourcePath, 'utf8'), resourceSandbox, { filename: resourcePath })
const resourceModule = resourceSandbox.module.exports
const rendererBundleSource = fs.readFileSync(rendererBundlePath, 'utf8')
const assetBridgeStart = rendererBundleSource.indexOf('NovaFlowAiSequenceAssetBridge=')
const assetBridgeEnd = rendererBundleSource.indexOf('return{aiSeqMode:', assetBridgeStart)
const assetBridgeSource = rendererBundleSource.slice(assetBridgeStart, assetBridgeEnd)

function extractAsyncArrowProperty(source, propertyName) {
  const marker = `${propertyName}:async e=>`
  const markerIndex = source.indexOf(marker)
  assert.ok(markerIndex >= 0, `${propertyName} must exist`)
  const arrowStart = markerIndex + propertyName.length + 1
  const bodyStart = source.indexOf('{', arrowStart)
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(arrowStart, index + 1)
    }
  }
  throw new Error(`${propertyName} body did not close`)
}

function createResolveVideoResourceHarness(asset, electronAPI, fetchImpl) {
  class MockFile {
    constructor(parts = [], name = '', options = {}) {
      this.parts = Array.from(parts || [])
      this.name = String(name || '')
      this.type = String(options.type || '')
      this.size = this.parts.reduce((total, part) => total + (Number(part?.size) || 0), 0)
      this.lastModified = Number(options.lastModified) || 0
    }
  }
  const state = { assets: [asset] }
  const context = {
    File: MockFile,
    URL,
    Uint8Array,
    Object,
    Error,
    setTimeout,
    fetch: fetchImpl,
    window: { electronAPI },
    et: { current: state.assets },
    $e(update) {
      state.assets = update(state.assets)
      context.et.current = state.assets
    },
    fn: async () => '',
  }
  const source = extractAsyncArrowProperty(assetBridgeSource, 'resolveVideoResource')
  return {
    MockFile,
    resolve: vm.runInNewContext(`(${source})`, context),
    state,
  }
}

function file(name, type, size = 10) {
  return { name, type, size, lastModified: 1 }
}

test('resource card drop resolves the shared asset id without reading native files', async () => {
  const calls = []
  const adapter = bridgeModule.createAdapter({
    assetBridge: {
      resolveVideoResource: async (resourceId) => {
        calls.push(resourceId)
        return { resourceId, fileName: 'generated.mp4', mimeType: 'video/mp4', localPath: 'D:\\cache\\generated.mp4' }
      },
    },
  })
  const result = await adapter.resolveDrop({
    types: [bridgeModule.RESOURCE_MIME, 'text/plain'],
    files: [],
    getData(type) { return type === bridgeModule.RESOURCE_MIME ? 'asset-7' : '' },
  })
  assert.deepEqual(calls, ['asset-7'])
  assert.equal(result.kind, 'resource')
  assert.equal(result.descriptors[0].resourceId, 'asset-7')
  assert.equal(result.descriptors[0].localPath, 'D:\\cache\\generated.mp4')
  assert.equal(Object.isFrozen(result.descriptors[0]), true)
})

test('resource card identity wins when Chromium also exposes a native Files drag payload', async () => {
  const calls = []
  const adapter = bridgeModule.createAdapter({
    assetBridge: {
      resolveVideoResource: async (resourceId) => {
        calls.push(resourceId)
        return { resourceId, fileName: 'shared.mp4', mimeType: 'video/mp4', objectUrl: 'blob:shared-video' }
      },
      addLocalVideoFiles: async () => { throw new Error('resource drag must not be re-imported as a native file') },
    },
  })
  const result = await adapter.resolveDrop({
    types: [bridgeModule.RESOURCE_MIME, 'Files'],
    files: [file('thumbnail.mp4', 'video/mp4')],
    getData(type) { return type === bridgeModule.RESOURCE_MIME ? 'asset-with-files' : '' },
  })
  assert.deepEqual(calls, ['asset-with-files'])
  assert.equal(result.kind, 'resource')
  assert.equal(result.descriptors[0].resourceId, 'asset-with-files')
})

test('native files are added to the authoritative shared list before layer import', async () => {
  const accepted = []
  const adapter = bridgeModule.createAdapter({
    assetBridge: {
      addLocalVideoFiles: async (files, options) => {
        accepted.push({ files, options })
        return files.map((candidate, index) => ({
          resourceId: `local-${index}`,
          fileName: candidate.name,
          mimeType: candidate.type,
          file: candidate,
        }))
      },
    },
  })
  const mp4 = file('one.mp4', 'video/mp4')
  const webm = file('two.webm', 'video/webm')
  const result = await adapter.resolveDrop({ types: ['Files'], files: [mp4, webm], items: [] })
  assert.equal(result.kind, 'files')
  assert.equal(result.descriptors.length, 2)
  assert.deepEqual(Array.from(accepted[0].files, (candidate) => candidate.name), ['one.mp4', 'two.webm'])
  assert.equal(accepted[0].options.sourceKind, 'video_merge_drop')
})

test('exported video paths are published through the authoritative shared resource bridge', async () => {
  const calls = []
  const adapter = bridgeModule.createAdapter({
    assetBridge: {
      publishVideoResource: async (payload, options) => {
        calls.push({ payload, options })
        return {
          resourceId: 'merged-output',
          fileName: 'merged.mp4',
          mimeType: 'video/mp4',
          localPath: payload.filePath,
          objectUrl: 'novaflow-media://resource/token/merged.mp4',
          mediaToken: 'token',
        }
      },
    },
  })
  const descriptor = await adapter.publishExportedVideo({ filePath: 'D:\\exports\\merged.mp4' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].payload.filePath, 'D:\\exports\\merged.mp4')
  assert.equal(calls[0].options.sourceKind, 'video_merge_output')
  assert.equal(descriptor.resourceId, 'merged-output')
  assert.equal(descriptor.mediaToken, 'token')
  assert.equal(descriptor.objectUrl, 'novaflow-media://resource/token/merged.mp4')
})

test('browser descriptors retain File or Blob preview sources without requiring a native path', () => {
  const browserFile = file('browser.mp4', 'video/mp4')
  const fileDescriptor = bridgeModule.normalizeDescriptor({ resourceId: 'file-video', file: browserFile }, '')
  assert.equal(fileDescriptor.file, browserFile)
  assert.equal(fileDescriptor.localPath, '')

  const browserBlob = { type: 'video/webm' }
  const blobDescriptor = bridgeModule.normalizeDescriptor({
    resourceId: 'blob-video',
    fileName: 'browser.webm',
    blob: browserBlob,
    objectUrl: 'blob:source-owned',
  }, '')
  assert.equal(blobDescriptor.blob, browserBlob)
  assert.equal(blobDescriptor.objectUrl, 'blob:source-owned')
  assert.equal(blobDescriptor.ownedObjectUrl, false)
})

test('folder drops are read recursively and unsupported entries are reported', async () => {
  const mp4 = file('inside.mp4', 'video/mp4')
  const png = file('ignored.png', 'image/png')
  const asEntry = (candidate) => ({ isFile: true, isDirectory: false, file(resolve) { resolve(candidate) } })
  let reads = 0
  const directory = {
    isFile: false,
    isDirectory: true,
    createReader() {
      return {
        readEntries(resolve) {
          reads += 1
          resolve(reads === 1 ? [asEntry(mp4), asEntry(png)] : [])
        },
      }
    },
  }
  const adapter = bridgeModule.createAdapter({
    assetBridge: {
      addLocalVideoFiles: async (files) => files.map((candidate) => ({
        resourceId: 'folder-video', fileName: candidate.name, mimeType: candidate.type, file: candidate,
      })),
    },
  })
  const result = await adapter.resolveDrop({
    types: ['Files'],
    files: [],
    items: [{ kind: 'file', webkitGetAsEntry: () => directory, getAsFile: () => null }],
  })
  assert.equal(result.descriptors.length, 1)
  assert.equal(result.descriptors[0].fileName, 'inside.mp4')
  assert.equal(result.rejectedCount, 1)
})

test('flat drops scan past thirty unsupported files before accepting a video', async () => {
  const images = Array.from({ length: 30 }, (_, index) => file(`image-${index}.png`, 'image/png'))
  const mp4 = file('after-images.mp4', 'video/mp4')
  const accepted = []
  const adapter = bridgeModule.createAdapter({
    assetBridge: {
      addLocalVideoFiles: async (files) => {
        accepted.push(...files)
        return files.map((candidate) => ({
          resourceId: 'late-video', fileName: candidate.name, mimeType: candidate.type, file: candidate,
        }))
      },
    },
  })
  const result = await adapter.resolveDrop({ types: ['Files'], files: [...images, mp4], items: [] })
  assert.deepEqual(accepted.map((candidate) => candidate.name), ['after-images.mp4'])
  assert.equal(result.descriptors[0].fileName, 'after-images.mp4')
  assert.equal(result.rejectedCount, 30)
})

test('folder drops do not let duplicate unsupported entries hide a later nested video', async () => {
  const duplicate = file('duplicate.png', 'image/png')
  const webm = file('nested-late.webm', 'video/webm')
  const asEntry = (candidate) => ({ isFile: true, isDirectory: false, file(resolve) { resolve(candidate) } })
  let reads = 0
  const directory = {
    isFile: false,
    isDirectory: true,
    createReader() {
      return {
        readEntries(resolve) {
          reads += 1
          if (reads === 1) return resolve(Array.from({ length: 30 }, () => asEntry(duplicate)))
          if (reads === 2) return resolve([asEntry(webm)])
          resolve([])
        },
      }
    },
  }
  const adapter = bridgeModule.createAdapter({
    assetBridge: {
      addLocalVideoFiles: async (files) => files.map((candidate) => ({
        resourceId: 'nested-video', fileName: candidate.name, mimeType: candidate.type, file: candidate,
      })),
    },
  })
  const result = await adapter.resolveDrop({
    types: ['Files'],
    files: [],
    items: [{ kind: 'file', webkitGetAsEntry: () => directory, getAsFile: () => null }],
  })
  assert.equal(result.descriptors[0].fileName, 'nested-late.webm')
  assert.equal(result.rejectedCount, 1)
})

test('unsupported drops fail without mutating the shared list', async () => {
  let called = false
  const adapter = bridgeModule.createAdapter({
    assetBridge: { addLocalVideoFiles: async () => { called = true; return [] } },
  })
  await assert.rejects(
    adapter.resolveDrop({ types: ['Files'], files: [file('image.png', 'image/png')], items: [] }),
    /video_merge_unsupported_video/
  )
  assert.equal(called, false)
})

test('layer assignment fills bottom then top and never overwrites a full canvas implicitly', () => {
  const descriptors = [{ resourceId: 'one' }, { resourceId: 'two' }]
  const emptyLayers = [
    { id: 'video-layer-bottom', source: null },
    { id: 'video-layer-top', source: null },
  ]
  const automatic = bridgeModule.planLayerAssignments(emptyLayers, descriptors, '')
  assert.deepEqual(Array.from(automatic, (item) => item.layerId), ['video-layer-bottom', 'video-layer-top'])

  const fullLayers = emptyLayers.map((layer) => ({ ...layer, source: { sourceId: layer.id } }))
  assert.equal(bridgeModule.planLayerAssignments(fullLayers, descriptors, '').length, 0)
  const explicit = bridgeModule.planLayerAssignments(fullLayers, descriptors, 'video-layer-top')
  assert.equal(explicit.length, 1)
  assert.equal(explicit[0].layerId, 'video-layer-top')
  assert.equal(explicit[0].descriptor.resourceId, 'one')
})

test('authoritative shared asset bridge exposes frozen video import and resolution contracts', () => {
  assert.ok(assetBridgeStart >= 0 && assetBridgeEnd > assetBridgeStart)
  assert.match(assetBridgeSource, /commitCutoutFile:async/)
  assert.match(assetBridgeSource, /addLocalVideoFiles:async/)
  assert.match(assetBridgeSource, /publishVideoResource:async/)
  assert.match(assetBridgeSource, /resolveVideoResource:async/)
  assert.match(assetBridgeSource, /videoResourceMediaRegister/)
  assert.match(assetBridgeSource, /videoResourceMediaRelease/)
  assert.match(assetBridgeSource, /Object\.freeze\(r\.map/)
  assert.match(assetBridgeSource, /stable local path unavailable/)
})

test('shared video resolution owns a stable cache copy before the layer imports it', () => {
  assert.match(assetBridgeSource, /aiSeqCacheTempFile/)
  assert.match(assetBridgeSource, /aiSeqCacheCopyFromPath/)
  assert.match(assetBridgeSource, /videoMergeCachedPath/)
  assert.match(assetBridgeSource, /new Uint8Array\(await a\.arrayBuffer\(\)\)/)
  assert.match(assetBridgeSource, /await fetch\(e\)/)
})

test('blob-only and memory-only shared videos materialize into the AI sequence cache', async () => {
  const calls = []
  const electronAPI = {
    videoCompositorOpenSession: async () => ({ ok: true }),
    videoCompositorRegisterSource: async () => ({ ok: true }),
    getPathForFile: () => '',
    aiSeqCacheTempFile: async (payload) => {
      calls.push(payload)
      return { ok: true, path: 'D:\\cache\\owned.mp4' }
    },
  }
  const blobHarness = createResolveVideoResourceHarness(
    { id: 'blob-video', filename: 'blob.mp4', type: 'local', objectUrl: 'blob:shared-video' },
    electronAPI,
    async () => ({
      ok: true,
      blob: async () => ({ arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }),
    })
  )
  const blobDescriptor = await blobHarness.resolve('blob-video')
  assert.equal(blobDescriptor.localPath, 'D:\\cache\\owned.mp4')
  assert.equal(blobHarness.state.assets[0].videoMergeCachedPath, 'D:\\cache\\owned.mp4')

  const memoryFile = new blobHarness.MockFile()
  Object.assign(memoryFile, {
    name: 'memory.webm',
    type: 'video/webm',
    arrayBuffer: async () => Uint8Array.from([4, 5, 6]).buffer,
  })
  const memoryHarness = createResolveVideoResourceHarness(
    { id: 'memory-video', filename: 'memory.webm', type: 'local', file: memoryFile },
    electronAPI,
    async () => { throw new Error('fetch must not run for a File') }
  )
  memoryHarness.state.assets[0].file = Object.assign(new memoryHarness.MockFile(), memoryFile)
  memoryHarness.state.assets[0].name = 'memory.webm'
  memoryHarness.state.assets[0].filename = 'memory.webm'
  const memoryDescriptor = await memoryHarness.resolve('memory-video')
  assert.equal(memoryDescriptor.localPath, 'D:\\cache\\owned.mp4')
  assert.equal(memoryDescriptor.file, undefined)
  assert.equal(calls.length, 2)

  const cachedMemoryDescriptor = await memoryHarness.resolve('memory-video')
  assert.equal(cachedMemoryDescriptor.localPath, 'D:\\cache\\owned.mp4')
  assert.equal(calls.length, 2)
})

test('browser shared videos retain an importable File when cache IPC is unavailable', async () => {
  const memoryHarness = createResolveVideoResourceHarness(
    { id: 'memory-video', filename: 'memory.mp4', type: 'local' },
    { getPathForFile: () => '' },
    async () => { throw new Error('fetch must not run for a File') }
  )
  const memoryFile = new memoryHarness.MockFile([], 'memory.mp4', { type: 'video/mp4' })
  memoryFile.arrayBuffer = async () => Uint8Array.from([1, 2, 3]).buffer
  memoryHarness.state.assets[0].file = memoryFile
  const memoryDescriptor = await memoryHarness.resolve('memory-video')
  assert.equal(memoryDescriptor.file, memoryFile)
  assert.equal(memoryDescriptor.localPath, undefined)

  const fetchedBlob = { type: 'video/webm', size: 3 }
  const blobHarness = createResolveVideoResourceHarness(
    {
      id: 'blob-video',
      filename: 'browser.webm',
      type: 'local',
      objectUrl: 'blob:shared-video',
      localPath: 'D:\\stale-cache\\browser.webm',
      videoMergeCachedPath: 'D:\\stale-cache\\browser.webm',
    },
    {},
    async () => ({ ok: true, blob: async () => fetchedBlob })
  )
  const blobDescriptor = await blobHarness.resolve('blob-video')
  assert.ok(blobDescriptor.file instanceof blobHarness.MockFile)
  assert.notEqual(blobDescriptor.file, fetchedBlob)
  assert.equal(blobDescriptor.file.name, 'browser.webm')
  assert.equal(blobDescriptor.file.type, 'video/webm')
  assert.equal(blobDescriptor.localPath, undefined)
})

test('browser resolution refuses a local-path-only asset instead of leaking a file URL into preview', async () => {
  const harness = createResolveVideoResourceHarness(
    {
      id: 'path-only-video',
      filename: 'path-only.mp4',
      type: 'local',
      localPath: 'D:\\cache\\path-only.mp4',
      videoMergeCachedPath: 'D:\\cache\\path-only.mp4',
    },
    {},
    async () => { throw new Error('fetch must not run without an object URL') }
  )
  await assert.rejects(harness.resolve('path-only-video'), /stable local path unavailable/)
})

test('resource store commits pathless browser Files as preview-only sources and owns their object URLs', async () => {
  const probes = []
  const revoked = []
  const store = resourceModule.createStore({
    getPathForFile: () => '',
    createObjectUrl: (candidate) => `blob:layer-owned-${candidate.name}`,
    revokeObjectUrl: (url) => revoked.push(url),
    probeClientSource: async (payload) => {
      probes.push(payload)
      return {
        width: 1280,
        height: 720,
        displayWidth: 1280,
        displayHeight: 720,
        durationSec: 3.5,
        fps: 30,
      }
    },
  })

  const first = await store.importFile('video-layer-bottom', file('first.mp4', 'video/mp4'))
  assert.equal(first.sourceId, '')
  assert.equal(first.filePath, '')
  assert.equal(first.objectUrl, 'blob:layer-owned-first.mp4')
  assert.equal(first.ownedObjectUrl, true)
  assert.equal(first.exportReady, false)
  assert.equal(first.previewOnly, true)
  assert.equal(first.probe.displayWidth, 1280)
  assert.equal(probes[0].objectUrl, 'blob:layer-owned-first.mp4')

  const second = await store.importFile('video-layer-bottom', file('second.webm', 'video/webm'))
  assert.equal(second.objectUrl, 'blob:layer-owned-second.webm')
  assert.deepEqual(revoked, ['blob:layer-owned-first.mp4'])
  store.removeSource('video-layer-bottom')
  assert.deepEqual(revoked, ['blob:layer-owned-first.mp4', 'blob:layer-owned-second.webm'])
  store.destroy()
})

test('failed browser metadata probes revoke the pending layer-owned object URL', async () => {
  const revoked = []
  const store = resourceModule.createStore({
    getPathForFile: () => '',
    createObjectUrl: () => 'blob:failed-probe',
    revokeObjectUrl: (url) => revoked.push(url),
    probeClientSource: async () => { throw new Error('metadata failed') },
  })
  await assert.rejects(
    store.importFile('video-layer-bottom', file('broken.mp4', 'video/mp4')),
    /metadata failed/
  )
  assert.equal(store.getState().layers[0].source, null)
  assert.deepEqual(revoked, ['blob:failed-probe'])
  store.destroy()
})

test('resource store keeps compositor registration authoritative when a native path is available', async () => {
  const registrations = []
  let clientProbeCalls = 0
  const store = resourceModule.createStore({
    getPathForFile: (candidate) => candidate.localPath,
    createObjectUrl: (candidate) => `blob:${candidate.name}`,
    registerSource: async (payload) => {
      registrations.push(payload)
      return {
        ok: true,
        sourceId: 'desktop-source',
        probe: { width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080, durationSec: 4, fps: 30 },
      }
    },
    probeClientSource: async () => { clientProbeCalls += 1; throw new Error('client probe must not run') },
  })
  const source = await store.importFile('video-layer-top', {
    name: 'desktop.mp4',
    type: 'video/mp4',
    localPath: 'D:\\video\\desktop.mp4',
  })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].filePath, 'D:\\video\\desktop.mp4')
  assert.equal(clientProbeCalls, 0)
  assert.equal(source.sourceId, 'desktop-source')
  assert.equal(source.exportReady, true)
  assert.equal(source.previewOnly, false)
  store.destroy()
})

test('default browser metadata probe reads dimensions and duration from a detached video', async () => {
  const listeners = new Map()
  const fakeVideo = {
    videoWidth: 854,
    videoHeight: 480,
    duration: 2.25,
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type)
    },
    load() {
      const listener = listeners.get('loadedmetadata')
      if (listener) Promise.resolve().then(listener)
    },
    pause() {},
    removeAttribute() {},
  }
  resourceSandbox.document = { createElement: (tagName) => tagName === 'video' ? fakeVideo : null }
  const store = resourceModule.createStore({
    getPathForFile: () => '',
    createObjectUrl: () => 'blob:metadata-probe',
    revokeObjectUrl() {},
  })
  try {
    const source = await store.importFile('video-layer-top', file('metadata.mp4', 'video/mp4'))
    assert.equal(source.probe.displayWidth, 854)
    assert.equal(source.probe.displayHeight, 480)
    assert.equal(source.probe.durationSec, 2.25)
    assert.equal(source.exportReady, false)
  } finally {
    store.destroy()
    delete resourceSandbox.document
  }
})

test('file-url shared videos are copied before a resource card can delete its temp directory', async () => {
  const copied = []
  const harness = createResolveVideoResourceHarness(
    {
      id: 'sequence-video',
      filename: 'sequence.webm',
      type: 'local',
      objectUrl: 'file:///D:/shared-temp/sequence.webm',
      tmpDir: 'D:\\shared-temp',
    },
    {
      videoCompositorOpenSession: async () => ({ ok: true }),
      videoCompositorRegisterSource: async () => ({ ok: true }),
      aiSeqCacheCopyFromPath: async ({ inputPath }) => {
        copied.push(inputPath)
        return { ok: true, path: 'D:\\cache\\sequence-copy.webm' }
      },
    },
    async () => { throw new Error('fetch must not run for file URLs') }
  )
  const descriptor = await harness.resolve('sequence-video')
  assert.equal(copied.length, 1)
  assert.match(copied[0].replace(/\\/g, '/'), /D:\/shared-temp\/sequence\.webm$/i)
  assert.equal(descriptor.localPath, 'D:\\cache\\sequence-copy.webm')
  assert.equal(harness.state.assets[0].videoMergeCachedPath, 'D:\\cache\\sequence-copy.webm')
})

test('shared upload remains resource-only while the video merge workspace is open', () => {
  assert.match(rendererBundleSource, /nfVideoMergeUploadOnly=!!document\.querySelector/)
  assert.equal((rendererBundleSource.match(/nfVideoMergeUploadOnly\|\|await ie\?\.\(C\)/g) || []).length, 1)
  assert.equal((rendererBundleSource.match(/nfVideoMergeUploadOnly\|\|n\[0\]&&await ie\?\.\(n\[0\]\)/g) || []).length, 1)
  assert.equal((rendererBundleSource.match(/nfVideoMergeUploadOnly\|\|d\[0\]&&Promise\.resolve\(ie\?\.\(d\[0\]\)\)/g) || []).length, 1)
  assert.equal((rendererBundleSource.match(/nfVideoMergeUploadOnly\|\|e\[0\]&&Promise\.resolve\(ie\?\.\(e\[0\]\)\)/g) || []).length, 2)
})
