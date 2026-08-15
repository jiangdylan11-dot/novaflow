const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const resourcePath = path.join(root, 'particle-editor', 'ai-sequence-wan22-lora.resource.js')
const resourceSource = fs.readFileSync(resourcePath, 'utf8')

function loadResource() {
  const context = { module: { exports: {} }, exports: {}, console }
  context.globalThis = context
  vm.runInNewContext(resourceSource, context, { filename: resourcePath })
  return { api: context.module.exports, browserApi: context.NovaFlowAiSequenceWan22LoraResource }
}

function item(overrides = {}) {
  return {
    name: 'wan-style.safetensors',
    modelFamily: 'wan2.2_i2v_14b',
    role: 'shared',
    kind: 'standard',
    supportedSteps: null,
    strengthRange: { min: 0, max: 2, default: 1, step: 0.05 },
    fingerprint: 'v1:10:20:lora',
    highFingerprint: 'v1:11:21:high',
    lowFingerprint: 'v1:12:22:low',
    ...overrides,
  }
}

const context = Object.freeze({ highName: 'wan-high.safetensors', lowName: 'wan-low.safetensors', steps: 4 })

test('exports an independent browser and CommonJS Wan2.2 LoRA resource', () => {
  const { api, browserApi } = loadResource()
  assert.equal(api, browserApi)
  assert.equal(api.MODEL_FAMILY, 'wan2.2_i2v_14b')
  assert.equal(api.DEFAULT_STEPS, 4)
  assert.equal(api.normalizeSteps('10000'), 10000)
  assert.throws(() => api.normalizeSteps(0), /1 to 10000/)
  assert.equal('NovaFlowAiSequenceMiniMaxH3LoraResource' in globalThis, false)
})

test('catalog filtering accepts explicit High Low and shared standard Wan items with complete fingerprints', () => {
  const { api } = loadResource()
  const filtered = api.filterCatalog([
    item(),
    item({ name: 'high-detail.safetensors', role: 'high', fingerprint: 'high' }),
    item({ name: 'low-motion.safetensors', role: 'low', fingerprint: 'low' }),
    item({ name: 'duplicate.safetensors', role: 'high', fingerprint: 'a' }),
    item({ name: 'DUPLICATE.safetensors', role: 'low', fingerprint: 'b' }),
    item({ name: 'wrong-family.safetensors', modelFamily: 'fl2va' }),
    item({ name: 'wrong-role.safetensors', role: 'unknown' }),
    item({ name: 'accelerator.safetensors', kind: 'accelerator' }),
    item({ name: 'wrong-step.safetensors', supportedSteps: [20] }),
    { name: 'missing-fingerprint.safetensors', modelFamily: 'wan2.2_i2v_14b', role: 'shared', kind: 'standard' },
  ], context)
  assert.deepEqual(Array.from(filtered, (entry) => `${entry.role}:${entry.name}`), [
    'high:duplicate.safetensors',
    'high:high-detail.safetensors',
    'low:low-motion.safetensors',
    'shared:wan-style.safetensors',
  ])
  assert.equal(filtered.every(Object.isFrozen), true)
})

test('selection descriptors preserve role and all three anti-TOCTOU fingerprints', async () => {
  const { api } = loadResource()
  const catalog = [
    item({ name: 'high.safetensors', role: 'high', fingerprint: 'high-lora' }),
    item({ name: 'low.safetensors', role: 'low', fingerprint: 'low-lora' }),
    item({ name: 'shared.safetensors', role: 'shared', fingerprint: 'shared-lora' }),
  ]
  const store = api.createWan22LoraStore(context)
  await store.refreshCatalog({
    ...context,
    electronAPI: { wan22LoraCatalog: async () => ({ ok: true, items: catalog }) },
  })
  store.setSelection(catalog.map(({ name }) => ({ name, strength: 0.75 })))

  const selected = Array.from(store.getSnapshot().selected)
  assert.deepEqual(selected.map(({ role }) => role), ['high', 'low', 'shared'])
  for (const descriptor of selected) {
    const source = catalog.find(({ name }) => name === descriptor.name)
    assert.equal(descriptor.fingerprint, source.fingerprint)
    assert.equal(descriptor.highFingerprint, source.highFingerprint)
    assert.equal(descriptor.lowFingerprint, source.lowFingerprint)
    assert.equal(descriptor.weight, 0.75)
    assert.equal(Object.isFrozen(descriptor), true)
  }
})

test('refreshes only through the narrow bridge and clears selection on high low or step changes', async () => {
  const { api } = loadResource()
  const calls = []
  const electronAPI = {
    wan22LoraCatalog: async (payload) => {
      calls.push(payload)
      return { ok: true, items: [item()] }
    },
  }
  const store = api.createWan22LoraStore(context)
  await store.refreshCatalog({ ...context, electronAPI })
  store.setSelection([{ name: 'wan-style.safetensors', strength: 0.8 }])
  assert.equal(store.getSnapshot().selected[0].weight, 0.8)

  store.setContext({ ...context, steps: 5 })
  assert.deepEqual(Array.from(store.getSnapshot().items), [])
  assert.deepEqual(Array.from(store.getSnapshot().selected), [])
  assert.equal(JSON.stringify(calls), JSON.stringify([context]))

  await assert.rejects(
    store.refreshCatalog({ ...context, highName: '', electronAPI }),
    /High and Low models must both be selected/,
  )
  assert.deepEqual(Array.from(store.getSnapshot().items), [])
})

test('fails closed without bridges and revalidates LoRA plus both model fingerprints', async () => {
  const { api } = loadResource()
  const sourceItem = item()
  const store = api.createWan22LoraStore(context)
  await assert.rejects(store.refreshCatalog(context), /service is unavailable/)
  await store.refreshCatalog({ ...context, electronAPI: { wan22LoraCatalog: async () => ({ ok: true, items: [sourceItem] }) } })
  store.setSelection([{ name: sourceItem.name, weight: 1.25 }])

  await assert.rejects(store.validateSelection(context), /validation is unavailable/)
  const calls = []
  const validated = await store.validateSelection({
    ...context,
    electronAPI: {
      wan22LoraValidate: async (payload) => {
        calls.push(payload)
        return { ok: true, item: sourceItem, strength: 1.25 }
      },
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].role, 'shared')
  assert.equal(calls[0].fingerprint, sourceItem.fingerprint)
  assert.equal(calls[0].highFingerprint, sourceItem.highFingerprint)
  assert.equal(calls[0].lowFingerprint, sourceItem.lowFingerprint)
  assert.equal(calls[0].highName, context.highName)
  assert.equal(calls[0].lowName, context.lowName)
  assert.equal(validated[0].name, sourceItem.name)
  assert.equal(validated[0].role, 'shared')
  assert.equal(validated[0].weight, 1.25)
  assert.equal(validated[0].enabled, true)

  await assert.rejects(
    store.validateSelection({
      ...context,
      electronAPI: {
        wan22LoraValidate: async () => ({ ok: true, item: { ...sourceItem, role: 'high' }, strength: 1.25 }),
      },
    }),
    /changed after selection/,
    'validation must reject a role change even when every fingerprint is unchanged',
  )

  await assert.rejects(
    store.validateSelection({ ...context, steps: 20, electronAPI: { wan22LoraValidate: async () => ({ ok: true, item: sourceItem }) } }),
    /context changed/,
  )
})

test('never reads an object_info endpoint or exposes a raw-list fallback', () => {
  assert.doesNotMatch(resourceSource, /object_info|127\.0\.0\.1:8188|comfyRequestJson|fetch\s*\(/)
  assert.match(resourceSource, /wan22LoraCatalog/)
  assert.match(resourceSource, /wan22LoraValidate/)
})
