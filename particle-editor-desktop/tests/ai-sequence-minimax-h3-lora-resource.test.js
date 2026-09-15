const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const resourcePath = path.join(root, 'particle-editor', 'ai-sequence-minimax-h3-lora.resource.js')
const resourceSource = fs.readFileSync(resourcePath, 'utf8')

function loadResource() {
  const context = { module: { exports: {} }, exports: {}, console }
  context.globalThis = context
  vm.runInNewContext(resourceSource, context, { filename: resourcePath })
  return { api: context.module.exports, browserApi: context.NovaFlowAiSequenceMiniMaxH3LoraResource }
}

function item(overrides = {}) {
  return {
    name: 'compatible.safetensors',
    modelFamily: 'fl2va',
    kind: 'standard',
    supportedSteps: null,
    strengthRange: { min: 0, max: 2, default: 1, step: 0.05 },
    fingerprint: 'size:mtime:header',
    ...overrides,
  }
}

test('a runtime log-lock error remains diagnostic detail and does not flood the sidebar', async () => {
  const { api } = loadResource()
  const store = api.createMiniMaxH3LoraStore({ maxNotReadyRetries: 0 })
  const detail = 'Move-Item : runtime.out.log is used by another process\nFullyQualifiedErrorId: MoveFileInfoItemIOError'
  await assert.rejects(store.refreshCatalog({ electronAPI: {
    minimaxH3LoraCatalog: async () => ({ ok: false, error: detail }),
  } }), /Move-Item/)
  assert.equal(store.getSnapshot().error, 'H3 服务尚未就绪，请稍后重新选择模型重试。')
  assert.equal(store.getSnapshot().loading, false)
  await store.refreshCatalog({ electronAPI: { minimaxH3LoraCatalog: async () => ({ ok: true, items: [item()] }) } })
  assert.equal(store.getSnapshot().error, '')
  assert.equal(store.getSnapshot().items.length, 1)
})

test('exports a browser and CommonJS MiniMax H3 LoRA resource with integer step boundaries', () => {
  const { api, browserApi } = loadResource()
  assert.equal(api, browserApi)
  assert.equal(api.DEFAULT_STEPS, 4)
  assert.equal(api.normalizeSteps(1), 1)
  assert.equal(api.normalizeSteps('10000'), 10000)
  assert.throws(() => api.normalizeSteps(0), /1 to 10000/)
  assert.throws(() => api.normalizeSteps(4.5), /integer/)
  assert.throws(() => api.normalizeSteps(10001), /1 to 10000/)
})

test('maps UI and workflow modes to the correct model family', () => {
  const { api } = loadResource()
  for (const mode of ['text_video', 'image_video', 'first_last', 't2v', 'i2v', 'fl2v']) {
    assert.equal(api.familyForMode(mode), 'fl2va')
  }
  assert.equal(api.familyForMode('multi_reference'), 'ref2va')
  assert.equal(api.familyForMode('r2v'), 'ref2va')
  assert.throws(() => api.familyForMode('missing'), /Unsupported MiniMax H3 mode/)
})

test('catalog filtering is fail closed for accelerator, unknown, wrong-family, and wrong-step items', () => {
  const { api } = loadResource()
  const filtered = api.filterCatalog([
    item(),
    item({ name: 'duplicate.safetensors', fingerprint: 'dup-a' }),
    item({ name: 'DUPLICATE.safetensors', fingerprint: 'dup-b' }),
    item({ name: 'wrong-family.safetensors', modelFamily: 'ref2va', fingerprint: 'ref' }),
    item({ name: 'wrong-step.safetensors', supportedSteps: [20], fingerprint: 'step' }),
    item({ name: 'managed-turbo.safetensors', kind: 'accelerator', supportedSteps: [4], fingerprint: 'turbo' }),
    { name: 'unknown.safetensors', kind: 'standard', fingerprint: 'unknown' },
  ], { mode: 't2v', steps: 4 })

  assert.deepEqual(Array.from(filtered, (entry) => entry.name), [
    'compatible.safetensors',
    'duplicate.safetensors',
  ])
  assert.equal(filtered.every(Object.isFrozen), true)
})

test('accepts structurally identified H3 entries while retaining explicit family restrictions', () => {
  const { api } = loadResource()
  const entries = [item({ name: 'shared.safetensors', modelFamily: 'h3' }), item({ name: 'fl2va.safetensors' })]
  assert.deepEqual(Array.from(api.filterCatalog(entries, { mode: 't2v', steps: 4 }), e => e.name), ['fl2va.safetensors', 'shared.safetensors'])
  assert.deepEqual(Array.from(api.filterCatalog(entries, { mode: 'r2v', steps: 4 }), e => e.name), ['shared.safetensors'])
})

test('refreshes from the narrow IPC bridge and prunes selections when mode or steps change', async () => {
  const { api } = loadResource()
  const calls = []
  const electronAPI = {
    minimaxH3LoraCatalog: async (payload) => {
      calls.push(payload)
      return {
        ok: true,
        items: [
          item({ name: 'all-fl2va.safetensors', fingerprint: 'all' }),
          item({ name: 'four-only.safetensors', supportedSteps: [4], fingerprint: 'four' }),
          item({ name: 'ref-only.safetensors', modelFamily: 'ref2va', fingerprint: 'ref' }),
        ],
      }
    },
  }
  const store = api.createMiniMaxH3LoraStore()
  await store.refreshCatalog({ mode: 'text_video', steps: 4, electronAPI })
  assert.equal(JSON.stringify(calls), JSON.stringify([{ mode: 't2v', steps: 4 }]))
  assert.deepEqual(Array.from(store.getSnapshot().items, (entry) => entry.name), [
    'all-fl2va.safetensors',
    'four-only.safetensors',
  ])
  store.setSelection([{ name: 'four-only.safetensors', strength: 0.75 }])
  assert.equal(store.getSnapshot().selected[0].strength, 0.75)
  store.setContext({ mode: 't2v', steps: 20 })
  assert.deepEqual(Array.from(store.getSnapshot().selected), [])
  assert.deepEqual(Array.from(store.getSnapshot().items, (entry) => entry.name), ['all-fl2va.safetensors'])
})

test('revalidates every selected LoRA immediately before workflow construction', async () => {
  const { api } = loadResource()
  const sourceItem = item({ name: 'hero-style.safetensors', fingerprint: 'stable' })
  const catalogAPI = { minimaxH3LoraCatalog: async () => ({ ok: true, items: [sourceItem] }) }
  const store = api.createMiniMaxH3LoraStore()
  await store.refreshCatalog({ mode: 't2v', steps: 7, electronAPI: catalogAPI })
  store.setSelection([{ name: sourceItem.name, strength: 1.2 }])

  const calls = []
  const validated = await store.validateSelection({
    mode: 't2v',
    steps: 7,
    electronAPI: {
      minimaxH3LoraValidate: async (payload) => {
        calls.push(payload)
        return { ok: true, item: sourceItem }
      },
    },
  })

  assert.equal(JSON.stringify(calls), JSON.stringify([{
    name: sourceItem.name,
    fingerprint: 'stable',
    mode: 't2v',
    steps: 7,
    strength: 1.2,
  }]))
  assert.deepEqual(Array.from(validated, (entry) => ({
    name: entry.name,
    strength: entry.strength,
    modelFamily: entry.modelFamily,
    kind: entry.kind,
    enabled: entry.enabled,
    fingerprint: entry.fingerprint,
  })), [{
    name: sourceItem.name,
    strength: 1.2,
    modelFamily: 'fl2va',
    kind: 'standard',
    enabled: true,
    fingerprint: 'stable',
  }])
})

test('fails closed when catalog or submit validation bridges are missing or stale', async () => {
  const { api } = loadResource()
  const store = api.createMiniMaxH3LoraStore()
  await assert.rejects(
    store.refreshCatalog({ mode: 't2v', steps: 4, electronAPI: {} }),
    /compatibility service is unavailable/,
  )

  await store.refreshCatalog({
    mode: 't2v',
    steps: 4,
    electronAPI: { minimaxH3LoraCatalog: async () => ({ ok: true, items: [item()] }) },
  })
  store.setSelection(['compatible.safetensors'])
  await assert.rejects(
    store.validateSelection({ mode: 't2v', steps: 4, electronAPI: {} }),
    /validation is unavailable/,
  )
  await assert.rejects(
    store.validateSelection({
      mode: 't2v',
      steps: 4,
      electronAPI: { minimaxH3LoraValidate: async () => ({ ok: false, error: 'fingerprint_changed' }) },
    }),
    /fingerprint_changed/,
  )
})

test('a not-ready catalog failure retries in the background until the H3 runtime is up', async () => {
  const { api } = loadResource()
  const timers = []
  const store = api.createMiniMaxH3LoraStore({
    notReadyRetryDelayMs: 4000,
    maxNotReadyRetries: 3,
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length },
    clearTimeout: () => {},
  })
  let calls = 0
  const electronAPI = { minimaxH3LoraCatalog: async () => { calls += 1; return calls < 3 ? { ok: false, error: 'starting' } : { ok: true, items: [item()] } } }
  await assert.rejects(store.refreshCatalog({ mode: 't2v', steps: 4, electronAPI }), /starting/)
  assert.equal(store.getSnapshot().error, 'H3 服务启动中，兼容 LoRA 列表将自动加载…')
  assert.equal(store.getSnapshot().loading, false)
  assert.equal(timers.length, 1)
  assert.equal(timers[0].delay, 4000)
  await timers[0].callback()
  assert.equal(calls, 2)
  assert.equal(store.getSnapshot().error, 'H3 服务启动中，兼容 LoRA 列表将自动加载…')
  assert.equal(timers.length, 2)
  await timers[1].callback()
  assert.equal(calls, 3)
  assert.equal(store.getSnapshot().error, '')
  assert.equal(store.getSnapshot().items.length, 1)
  assert.equal(timers.length, 2)
})

test('not-ready retries stop at the limit and a newer request supersedes a pending retry', async () => {
  const { api } = loadResource()
  const timers = []
  const store = api.createMiniMaxH3LoraStore({
    notReadyRetryDelayMs: 0,
    maxNotReadyRetries: 2,
    setTimeout: (callback) => { timers.push(callback); return timers.length },
    clearTimeout: () => {},
  })
  const failing = { minimaxH3LoraCatalog: async () => ({ ok: false, error: 'runtime_start_failed' }) }
  await assert.rejects(store.refreshCatalog({ mode: 't2v', steps: 4, electronAPI: failing }), /runtime_start_failed/)
  await timers[0]()
  await timers[1]()
  assert.equal(timers.length, 2, 'no retry is scheduled beyond the limit')
  assert.equal(store.getSnapshot().error, 'H3 服务尚未就绪，请稍后重新选择模型重试。')

  // A manual refresh resets the budget; a newer request makes the stale retry a no-op.
  await assert.rejects(store.refreshCatalog({ mode: 't2v', steps: 4, electronAPI: failing }), /runtime_start_failed/)
  assert.equal(timers.length, 3)
  let laterCalls = 0
  await store.refreshCatalog({ mode: 't2v', steps: 4, electronAPI: { minimaxH3LoraCatalog: async () => { laterCalls += 1; return { ok: true, items: [item()] } } } })
  assert.equal(store.getSnapshot().items.length, 1)
  await timers[2]()
  assert.equal(laterCalls, 1, 'the superseded retry must not issue another catalog request')
  assert.equal(store.getSnapshot().error, '')
  assert.equal(store.getSnapshot().items.length, 1)
})
