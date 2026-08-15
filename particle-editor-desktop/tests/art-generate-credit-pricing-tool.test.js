const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const toolPath = path.join(root, 'particle-editor', 'art-generate-credit-pricing.tool.js')
const jsonataPath = path.join(root, 'particle-editor', 'vendor', 'jsonata', 'jsonata.min.js')
const jsonataContext = { console, setTimeout, clearTimeout }
jsonataContext.window = jsonataContext
jsonataContext.globalThis = jsonataContext
vm.runInNewContext(fs.readFileSync(jsonataPath, 'utf8'), jsonataContext, { filename: jsonataPath })
const jsonata = jsonataContext.jsonata
assert.equal(typeof jsonata, 'function', 'vendored JSONata should load as a browser global')

assert.equal(fs.existsSync(toolPath), true, 'Art Generate credit pricing tool should exist')
const toolSource = fs.readFileSync(toolPath, 'utf8')
assert.doesNotMatch(toolSource, /NovaFlowAiSequenceCreditPricing/, 'Art pricing must not couple to AI Sequence pricing')

const priceBadges = {
  OpenAIGPTImageNodeV2: {
    engine: 'jsonata',
    depends_on: { widgets: [{ name: 'model' }, { name: 'model.quality' }, { name: 'n' }], inputs: [], input_groups: [] },
    expr: `(
      $ranges := {"gpt-image-2":{"low":[0.0048,0.019],"medium":[0.041,0.168],"high":[0.165,0.67]}};
      $range := $lookup($lookup($ranges, widgets.model), $lookup(widgets, "model.quality"));
      {"type":"range_usd","min_usd":$range[0],"max_usd":$range[1],"format":{"approximate":true}}
    )`,
  },
  GeminiImageNode: {
    engine: 'jsonata',
    depends_on: { widgets: [], inputs: [], input_groups: [] },
    expr: '{"type":"usd","usd":0.039,"format":{"approximate":true}}',
  },
  GeminiImage2Node: {
    engine: 'jsonata',
    depends_on: { widgets: [{ name: 'model' }, { name: 'resolution' }], inputs: [], input_groups: [] },
    expr: `(
      $prices := {"1k":0.134,"2k":0.134,"4k":0.24};
      {"type":"usd","usd":$lookup($prices, widgets.resolution),"format":{"approximate":true}}
    )`,
  },
}

function makeTool(options = {}) {
  const events = []
  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = type
      this.detail = options.detail
    }
  }
  const models = {
    normalizeProvider(value) {
      return ['local', 'gpt', 'google'].includes(String(value)) ? String(value) : 'local'
    },
    workflowSettings(state, provider, mode) {
      if (provider === 'gpt') {
        return {
          quality: mode === 'img2img' ? state.gptQualityImg2img : state.gptQualityTxt2img,
          size: state.gptSize,
          customWidth: state.gptCustomWidth,
          customHeight: state.gptCustomHeight,
        }
      }
      return {
        aspectRatio: mode === 'img2img' ? state.googleAspectRatioImg2img : state.googleAspectRatioTxt2img,
        resolution: state.googleResolution,
      }
    },
  }
  const workflow = {
    buildWorkflow(options) {
      if (options.provider === 'gpt') {
        return {
          providerNodeIds: ['provider'],
          providerNodeType: 'OpenAIGPTImageNodeV2',
          workflow: {
            provider: {
              class_type: 'OpenAIGPTImageNodeV2',
              inputs: { model: 'gpt-image-2', 'model.quality': options.settings.quality, n: 1 },
            },
          },
        }
      }
      const nodeType = options.mode === 'img2img' ? 'GeminiImage2Node' : 'GeminiImageNode'
      return {
        providerNodeIds: ['provider'],
        providerNodeType: nodeType,
        workflow: {
          provider: {
            class_type: nodeType,
            inputs: {
              model: options.mode === 'img2img' ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image',
              resolution: options.settings.resolution,
            },
          },
        },
      }
    },
  }
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
    URL,
    Intl,
    Promise,
    Map,
    Set,
    Date,
    Math,
    Number,
    String,
    Object,
    Array,
    RegExp,
    JSON,
    jsonata,
    NovaFlowArtGenerateModels: models,
    NovaFlowArtGenerateProviderWorkflow: workflow,
    CustomEvent: FakeCustomEvent,
    dispatchEvent(event) {
      events.push(event)
      return true
    },
  }
  context.window = context
  context.globalThis = context
  vm.runInNewContext(toolSource, context, { filename: toolPath })
  return { api: context.NovaFlowArtGenerateCreditPricing, events }
}

function state(provider, mode = 'txt2img', overrides = {}) {
  return {
    provider,
    mode,
    gptQualityTxt2img: 'low',
    gptQualityImg2img: 'low',
    gptSize: '2048x2048',
    gptCustomWidth: 1024,
    gptCustomHeight: 1024,
    googleAspectRatioTxt2img: '1:1',
    googleAspectRatioImg2img: '1:1',
    googleResolution: '1K',
    references: [],
    ...overrides,
  }
}

async function settleAsyncWork() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

function objectInfoResponse(nodeType) {
  return { data: { [nodeType]: { price_badge: priceBadges[nodeType] } } }
}

test('uses live price badges for GPT and Google without submitting a prompt', async () => {
  const { api } = makeTool()
  const paths = []
  const requestJson = async (request) => {
    paths.push(request)
    const nodeType = decodeURIComponent(String(request.path).split('/').pop())
    return objectInfoResponse(nodeType)
  }

  const cases = [
    [state('gpt'), '开始生成 · ~1-4积分'],
    [state('google'), '开始生成 · ~8.2积分'],
    [state('google', 'img2img', { googleResolution: '4K', references: [{}] }), '开始生成 · ~50.6积分'],
  ]
  for (const [input, expected] of cases) {
    const snapshot = api.createSnapshot(input, { baseUrl: 'http://127.0.0.1:8188', requestJson })
    api.getButtonLabel(snapshot)
    await settleAsyncWork()
    assert.equal(api.getButtonLabel(snapshot), expected)
  }

  assert.equal(paths.length, 3)
  for (const request of paths) {
    assert.equal(request.init.method, 'GET')
    assert.match(request.path, /^\/object_info\//)
    assert.doesNotMatch(request.path, /prompt|upload|authorize/i)
  }
})

test('coalesces requests, isolates local mode, and fails without a fabricated price', async () => {
  const { api } = makeTool()
  let requestCount = 0
  const requestJson = async () => {
    requestCount += 1
    return { data: { OpenAIGPTImageNodeV2: {} } }
  }
  const snapshot = api.createSnapshot(state('gpt'), { baseUrl: 'http://127.0.0.1:8188', requestJson })
  api.getButtonLabel(snapshot)
  api.getButtonLabel(snapshot)
  await settleAsyncWork()
  assert.equal(requestCount, 1)
  assert.equal(api.getButtonLabel(snapshot), '开始生成 · 积分待确认')

  const local = api.createSnapshot(state('local'), { baseUrl: 'http://127.0.0.1:8188', requestJson })
  assert.equal(api.getButtonLabel(local), '开始生成')
  assert.equal(requestCount, 1)
  api.resetEstimate()
})

test('does not publish a stale estimate after the active signature changes', async () => {
  const { api, events } = makeTool()
  const resolvers = new Map()
  const requestJson = ({ path: requestPath }) => new Promise((resolve) => {
    resolvers.set(decodeURIComponent(String(requestPath).split('/').pop()), resolve)
  })
  const gpt = api.createSnapshot(state('gpt'), { baseUrl: 'http://127.0.0.1:8188', requestJson })
  const google = api.createSnapshot(state('google'), { baseUrl: 'http://127.0.0.1:8188', requestJson })
  api.getButtonLabel(gpt)
  api.getButtonLabel(google)

  resolvers.get('OpenAIGPTImageNodeV2')(objectInfoResponse('OpenAIGPTImageNodeV2'))
  await settleAsyncWork()
  assert.equal(events.some((event) => event.detail?.signature === gpt.signature), false)

  resolvers.get('GeminiImageNode')(objectInfoResponse('GeminiImageNode'))
  await settleAsyncWork()
  assert.equal(events.some((event) => event.detail?.signature === google.signature), true)
  assert.equal(api.getButtonLabel(google), '开始生成 · ~8.2积分')
})

test('keeps actual settlement feedback prompt-scoped and backend-authoritative', () => {
  const { api } = makeTool()
  assert.equal(api.recordSettlement({ promptId: '' }), false)
  assert.equal(api.recordSettlement({ nope: true }), false)
  assert.equal(api.recordSettlement({ promptId: 123, settlement: { status: 'settled' } }), false)
  assert.equal(api.recordSettlement({ promptId: {}, settlement: { status: 'settled' } }), false)
  assert.equal(api.recordSettlement({ promptId: 'bad prompt', settlement: { status: 'settled' } }), false)
  assert.equal(api.recordSettlement({
    promptId: 'prompt-a',
    settlement: { status: 'settled', charge_amount_text: '4.270000', estimated_credit_cost: 1 },
    credits: { deducted_text: '4.270000', balance_text: '3599.730000' },
    providerBudget: { deducted_text: '4.270000', balance_text: '8240.730000' },
  }), true)
  assert.equal(api.recordSettlement({
    promptId: 'prompt-b',
    settlement: { status: 'pending_pricing', estimated_credit_cost: 99 },
  }), true)
  assert.equal(api.recordSettlement({
    promptId: 'prompt-c',
    settlement: { status: 'not_charged' },
  }), true)

  assert.equal(api.getProgressView({ promptId: 'prompt-a', running: false }).text, '本次扣 4.27积分')
  assert.equal(api.getProgressView({ promptId: 'prompt-b', running: false }).text, '积分待官方结算')
  assert.equal(api.getProgressView({ promptId: 'prompt-c', running: false }).text, '未扣积分')
  assert.equal(api.getProgressView({ promptId: 'prompt-missing', running: false }), null)
})

test('rejects non-authoritative camelCase amount fields and snapshots settlement objects', () => {
  const { api } = makeTool()
  const settlement = { status: 'settled', chargeAmountText: '4.270000', chargeAmount: '4.270000' }
  const credits = { balance_text: '3599.730000' }
  assert.equal(api.recordSettlement({ promptId: 'camel-only', settlement, credits }), true)
  settlement.charge_amount_text = '9.990000'
  credits.deducted_text = '9.990000'
  assert.equal(
    api.getProgressView({ promptId: 'camel-only', running: false }).text,
    '积分待官方结算',
    'camelCase and post-record mutations must not create an actual charge',
  )
})

test('uses the exact retry schedule and resumes retry when a signature becomes active again', async () => {
  const scheduled = []
  const fakeSetTimeout = (callback, delay) => {
    const timer = { callback, delay, unref() {} }
    scheduled.push(timer)
    return timer
  }
  const { api } = makeTool({ setTimeout: fakeSetTimeout, clearTimeout() {} })
  const requestJson = async () => ({ data: { OpenAIGPTImageNodeV2: {} } })
  const gpt = api.createSnapshot(state('gpt'), { baseUrl: 'http://retry', requestJson })
  const local = api.createSnapshot(state('local'), { baseUrl: 'http://retry', requestJson })

  api.getButtonLabel(gpt)
  await settleAsyncWork()
  assert.deepEqual(scheduled.map((timer) => timer.delay), [250])

  api.getButtonLabel(local)
  scheduled[0].callback()
  api.getButtonLabel(gpt)
  assert.deepEqual(scheduled.map((timer) => timer.delay), [250, 750])

  for (const expectedDelay of [1500, 3000, 6000]) {
    scheduled.at(-1).callback()
    await settleAsyncWork()
    assert.equal(scheduled.at(-1).delay, expectedDelay)
  }
  scheduled.at(-1).callback()
  await settleAsyncWork()
  assert.deepEqual(scheduled.map((timer) => timer.delay), [250, 750, 1500, 3000, 6000])
  api.resetEstimate()
})

test('reset prevents an older in-flight request from repopulating caches or dispatching updates', async () => {
  const { api, events } = makeTool()
  let resolveFirst
  let requestCount = 0
  const requestJson = () => {
    requestCount += 1
    if (requestCount === 1) return new Promise((resolve) => { resolveFirst = resolve })
    return Promise.resolve(objectInfoResponse('OpenAIGPTImageNodeV2'))
  }
  const snapshot = api.createSnapshot(state('gpt'), { baseUrl: 'http://reset', requestJson })
  api.getButtonLabel(snapshot)
  api.resetEstimate()
  resolveFirst(objectInfoResponse('OpenAIGPTImageNodeV2'))
  await settleAsyncWork()
  assert.equal(events.length, 0)

  api.getButtonLabel(snapshot)
  await settleAsyncWork()
  assert.equal(requestCount, 2)
  assert.equal(api.getButtonLabel(snapshot), '开始生成 · ~1-4积分')
})

test('bounds estimate/node caches and settlement records', async () => {
  const { api } = makeTool()
  let requestCount = 0
  const requestJson = async () => {
    requestCount += 1
    return objectInfoResponse('OpenAIGPTImageNodeV2')
  }
  const snapshots = []
  for (let index = 0; index < 33; index += 1) {
    const snapshot = api.createSnapshot(state('gpt'), { baseUrl: `http://cache-${index}`, requestJson })
    snapshots.push(snapshot)
    api.getButtonLabel(snapshot)
    await settleAsyncWork()
  }
  assert.equal(requestCount, 33)
  api.getButtonLabel(snapshots[0])
  await settleAsyncWork()
  assert.equal(requestCount, 34, 'the oldest estimate and node definition should both be evicted')

  for (let index = 0; index < 65; index += 1) {
    api.recordSettlement({
      promptId: `prompt-${index}`,
      settlement: { status: 'settled', charge_amount_text: '1.000000' },
    })
  }
  assert.equal(api.getProgressView({ promptId: 'prompt-0', running: false }), null)
  assert.equal(api.getProgressView({ promptId: 'prompt-64', running: false }).text, '本次扣 1积分')
})

test('evicts the oldest node-definition promise when the ninth node key is added', () => {
  const { api } = makeTool()
  let requestCount = 0
  const requestJson = () => {
    requestCount += 1
    return new Promise(() => {})
  }
  for (let index = 0; index < 9; index += 1) {
    const snapshot = api.createSnapshot(state('gpt'), { baseUrl: `http://node-cache-${index}`, requestJson })
    api.getButtonLabel(snapshot)
  }
  assert.equal(requestCount, 9)

  const firstKeyWithNewEstimateSignature = api.createSnapshot(
    state('gpt', 'txt2img', { gptQualityTxt2img: 'medium' }),
    { baseUrl: 'http://node-cache-0', requestJson },
  )
  api.getButtonLabel(firstKeyWithNewEstimateSignature)
  assert.equal(requestCount, 10, 'the first node promise must be evicted at an exact cache size of eight')
})

test('shows only an estimate while running and re-requests after reset', async () => {
  const { api } = makeTool()
  let requestCount = 0
  const requestJson = async () => {
    requestCount += 1
    return objectInfoResponse('OpenAIGPTImageNodeV2')
  }
  const snapshot = api.createSnapshot(state('gpt'), { baseUrl: 'http://127.0.0.1:8188', requestJson })
  api.getButtonLabel(snapshot)
  await settleAsyncWork()
  assert.equal(api.getProgressView({ promptId: '', snapshot, running: true }).text, '预计 ~1-4积分')
  api.resetEstimate()
  api.getButtonLabel(snapshot)
  await settleAsyncWork()
  assert.equal(requestCount, 2)
})
