const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const resourcePath = path.join(root, 'particle-editor', 'ai-sequence-minimax-h3-output.resource.js')
const resourceSource = fs.readFileSync(resourcePath, 'utf8')

function loadResource(overrides = {}) {
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    Blob,
    URL,
    Uint8Array,
    ArrayBuffer,
    ...overrides,
  }
  context.globalThis = context
  vm.runInNewContext(resourceSource, context, { filename: resourcePath })
  return { api: context.module.exports, browserApi: context.NovaFlowAiSequenceMiniMaxH3OutputResource, context }
}

function localItem(index, overrides = {}) {
  return {
    id: `h3-${index}`,
    runtimeKind: 'minimax_h3_local',
    type: 'local',
    localPath: `C:\\NovaFlow\\sessions\\h3-${index}.mp4`,
    fileName: `h3-${index}.mp4`,
    promptId: `prompt-${index}`,
    mimeType: 'video/mp4',
    createdAt: 1000 + index,
    ...overrides,
  }
}

function previewItem(index, overrides = {}) {
  return {
    ...localItem(index),
    localPath: '',
    viewUrl: `/__ai_sequence_h3_output/view?id=h3-${index}`,
    ...overrides,
  }
}

test('exports one browser/CommonJS output resource with the narrow public contract', () => {
  const { api, browserApi } = loadResource()
  assert.equal(api, browserApi)
  assert.equal(api.RUNTIME_KIND, 'minimax_h3_local')
  assert.equal(api.ENDPOINT_PATH, '/__ai_sequence_h3_output')
  assert.equal(api.MAX_ITEMS, 30)
  for (const method of ['extractHistoryTiming', 'createOutputResource', 'publish', 'list', 'getSnapshot', 'subscribe', 'dispose']) {
    assert.equal(typeof api[method], 'function')
  }
  assert.ok(Object.isFrozen(api))
})

test('extracts only the execution_start to execution_success elapsed time from a history entry', () => {
  const { api } = loadResource()
  const timing = api.extractHistoryTiming({
    status: {
      messages: [
        ['execution_start', { timestamp: 1_786_510_755_726 }],
        ['execution_cached', { timestamp: 1_786_510_755_746 }],
        ['execution_success', { timestamp: 1_786_511_128_264 }],
      ],
    },
  })
  assert.deepEqual(JSON.parse(JSON.stringify(timing)), { generationElapsedSec: 372.538 })
  assert.equal(Object.isFrozen(timing), true)
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.extractHistoryTiming({ status: { messages: [] } }))),
    { generationElapsedSec: null },
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.extractHistoryTiming({
      status: { messages: [['execution_success', { timestamp: 20 }], ['execution_start', { timestamp: 10 }]] },
    }))),
    { generationElapsedSec: null },
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.extractHistoryTiming({
      status: {
        messages: [
          ['execution_start', { timestamp: 0 }],
          ['execution_success', { timestamp: (24 * 60 * 60 * 1000) + 1 }],
        ],
      },
    }))),
    { generationElapsedSec: null },
  )
})

test('prefers late-injected desktop IPC, never calls HTTP, and hydrates playable Blob URLs', async () => {
  let httpCalls = 0
  const calls = []
  const { browserApi, context } = loadResource({
    fetch: async () => {
      httpCalls += 1
      throw new Error('HTTP must not run when desktop IPC exists')
    },
  })
  context.electronAPI = {
    minimaxH3OutputPublish: async (payload) => {
      calls.push(['publish', payload])
      return {
        ok: true,
        item: localItem(1, { mediaDurationSec: 15.084, generationElapsedSec: 372.538 }),
      }
    },
    minimaxH3OutputList: async (payload) => {
      calls.push(['list', payload])
      return {
        ok: true,
        items: [localItem(2, { mediaDurationSec: 2.333, generationElapsedSec: 126.975 })],
      }
    },
    aiSeqReadTempFile: async (payload) => {
      calls.push(['read', payload])
      return { ok: true, bytes: new Uint8Array([0, 1, 2, 3]), mimeType: 'video/mp4' }
    },
  }

  const published = await browserApi.publish({
    promptId: 'prompt-1',
    filename: 'h3-1.mp4',
    subfolder: 'video',
    type: 'output',
    mediaDurationSec: 15.084,
    generationElapsedSec: 372.538,
    ignored: 'must-not-cross-the-bridge',
  })
  assert.match(published.objectUrl, /^blob:/)
  assert.equal(published.localPath, 'C:\\NovaFlow\\sessions\\h3-1.mp4')
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), {
    promptId: 'prompt-1',
    filename: 'h3-1.mp4',
    subfolder: 'video',
    type: 'output',
    mediaDurationSec: 15.084,
    generationElapsedSec: 372.538,
  })
  assert.equal(published.mediaDurationSec, 15.084)
  assert.equal(published.generationElapsedSec, 372.538)

  const restored = await browserApi.list()
  assert.equal(restored.length, 1)
  assert.match(restored[0].objectUrl, /^blob:/)
  assert.equal(restored[0].filename, 'h3-2.mp4')
  assert.equal(restored[0].mediaDurationSec, 2.333)
  assert.equal(restored[0].generationElapsedSec, 126.975)
  assert.equal(httpCalls, 0)
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find((entry) => entry[0] === 'list')[1])), {})
  assert.deepEqual(
    calls.filter((entry) => entry[0] === 'read').map((entry) => entry[1].path),
    ['C:\\NovaFlow\\sessions\\h3-1.mp4', 'C:\\NovaFlow\\sessions\\h3-2.mp4'],
  )
  browserApi.dispose()
})

test('falls back to the preview endpoint with {action,payload} and accepts only its same-origin view URL', async () => {
  const requests = []
  const { api } = loadResource({
    location: { href: 'http://127.0.0.1:4783/index.html' },
  })
  const store = api.createOutputResource({
    baseUrl: 'http://127.0.0.1:4783',
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body)
      requests.push({ url, init, body })
      if (body.action === 'publish') return { ok: true, json: async () => ({ ok: true, item: previewItem(3) }) }
      return { ok: true, json: async () => ({ ok: true, items: [previewItem(4)] }) }
    },
  })

  const published = await store.publish({ promptId: 'prompt-3', filename: 'h3-3.mp4', subfolder: '', type: 'output' })
  assert.equal(published.objectUrl, '/__ai_sequence_h3_output/view?id=h3-3')
  assert.equal(published.localPath, '')
  const listed = await store.list()
  assert.equal(listed[0].objectUrl, '/__ai_sequence_h3_output/view?id=h3-4')
  assert.deepEqual(requests.map((entry) => entry.url), [
    'http://127.0.0.1:4783/__ai_sequence_h3_output',
    'http://127.0.0.1:4783/__ai_sequence_h3_output',
  ])
  assert.equal(requests[0].body.action, 'publish')
  assert.deepEqual(requests[0].body.payload, {
    promptId: 'prompt-3', filename: 'h3-3.mp4', subfolder: '', type: 'output',
  })
  assert.deepEqual(requests[1].body, { action: 'list', payload: {} })

  const unsafe = api.createOutputResource({
    baseUrl: 'http://127.0.0.1:4783',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ok: true, items: [previewItem(5, { viewUrl: 'https://attacker.invalid/video.mp4' })] }),
    }),
  })
  await assert.rejects(unsafe.list(), /same-origin|outside the output endpoint/)
})

test('recognizes the preview proxy response after its electronAPI wrapper is injected late', async () => {
  let directFetchCalls = 0
  const { browserApi, context } = loadResource({
    location: { href: 'http://127.0.0.1:4783/index.html' },
    fetch: async () => {
      directFetchCalls += 1
      throw new Error('the late preview proxy API owns this request')
    },
  })
  context.electronAPI = {
    minimaxH3OutputList: async () => ({ preview: true, ok: true, items: [previewItem(8)] }),
  }
  const items = await browserApi.list()
  assert.equal(items[0].objectUrl, '/__ai_sequence_h3_output/view?id=h3-8')
  assert.equal(items[0].localPath, '')
  assert.equal(directFetchCalls, 0)
})

test('restores a deduplicated newest-first snapshot capped at thirty items and notifies subscribers', async () => {
  const source = [previewItem(35), previewItem(35, { createdAt: 9999 })]
  for (let index = 1; index <= 35; index += 1) source.push(previewItem(index))
  const { api } = loadResource({ location: { href: 'http://127.0.0.1:4783/' } })
  const store = api.createOutputResource({
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, items: source }) }),
  })
  const notifications = []
  const unsubscribe = store.subscribe((snapshot) => notifications.push(snapshot))
  const restored = await store.list()

  assert.equal(restored.length, 30)
  assert.equal(restored.filter((item) => item.promptId === 'prompt-35').length, 1)
  assert.equal(restored[0].id, 'h3-35')
  assert.equal(restored, store.getSnapshot())
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0], restored)
  assert.ok(Object.isFrozen(restored))
  assert.equal(restored.every(Object.isFrozen), true)
  unsubscribe()
})

test('fails closed on illegal restored items and preserves the last valid snapshot', async () => {
  const responses = [
    { ok: true, items: [previewItem(1)] },
    { ok: true, items: [previewItem(2), previewItem(3, { runtimeKind: 'wan2_2_local' })] },
    { ok: true, items: [previewItem(4, { type: 'output' })] },
  ]
  const { api } = loadResource({ location: { href: 'http://127.0.0.1:4783/' } })
  const store = api.createOutputResource({
    fetchImpl: async () => ({ ok: true, json: async () => responses.shift() }),
  })
  const valid = await store.list()
  await assert.rejects(store.list(), /runtimeKind is invalid/)
  assert.equal(store.getSnapshot(), valid)
  await assert.rejects(store.list(), /type must be local/)
  assert.equal(store.getSnapshot(), valid)
})

test('rejects malformed publish descriptors and has no unrelated runtime/provider dependency', async () => {
  const { api } = loadResource()
  assert.throws(
    () => api.normalizePublishDescriptor({ promptId: 'p', filename: '../escape.mp4', type: 'output' }),
    /fileName is invalid/,
  )
  assert.throws(
    () => api.normalizePublishDescriptor({ promptId: 'p', filename: 'image.png', type: 'output' }),
    /MP4 or WebM/,
  )
  assert.throws(
    () => api.normalizePublishDescriptor({ promptId: 'p', filename: 'video.mp4', type: 'local' }),
    /type must be output/,
  )
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.normalizePublishDescriptor({
      promptId: 'p',
      filename: 'video.mp4',
      type: 'output',
      mediaDurationSec: 15.084,
      generationElapsedSec: 372.538,
    }))),
    {
      promptId: 'p',
      filename: 'video.mp4',
      subfolder: '',
      type: 'output',
      mediaDurationSec: 15.084,
      generationElapsedSec: 372.538,
    },
  )
  for (const [field, value] of [
    ['mediaDurationSec', 0],
    ['mediaDurationSec', 60.001],
    ['mediaDurationSec', Infinity],
    ['generationElapsedSec', -0.001],
    ['generationElapsedSec', 86_400.001],
    ['generationElapsedSec', '10'],
  ]) {
    assert.throws(
      () => api.normalizePublishDescriptor({ promptId: 'p', filename: 'video.mp4', type: 'output', [field]: value }),
      new RegExp(`${field} is invalid`),
    )
  }
  assert.doesNotMatch(resourceSource, /8188|object_info|provider|auth|wan2|seedance|kling/i)
})
