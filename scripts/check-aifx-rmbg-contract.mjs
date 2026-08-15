import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import zlib from 'node:zlib'

const commonJsModule = { exports: {} }
const sandbox = {
  module: commonJsModule,
  exports: commonJsModule.exports,
  Buffer,
  URLSearchParams,
  AbortController,
  setTimeout,
  clearTimeout,
}
sandbox.globalThis = sandbox
runInNewContext(
  readFileSync('particle-editor/aifx-rmbg.workflow.js', 'utf8'),
  sandbox,
  { filename: 'particle-editor/aifx-rmbg.workflow.js' },
)
const api = commonJsModule.exports

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

function pngDataUrl(width, height, colorType = 6) {
  const channels = colorType === 6 ? 4 : 3
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = colorType
  const rowSize = 1 + width * channels
  const pixels = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * rowSize
    pixels[row] = 0
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * channels
      pixels[offset] = 220
      pixels[offset + 1] = 90
      pixels[offset + 2] = 30
      if (channels === 4) pixels[offset + 3] = x === 0 && y === 0 ? 0 : 255
    }
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(pixels)),
    pngChunk('IEND'),
  ])
  return `data:image/png;base64,${png.toString('base64')}`
}

function imageNode() {
  return { input: { required: { image: ['IMAGE', {}] } } }
}

function objectInfo(options = {}) {
  const info = {
    LoadImage: imageNode(),
    SaveImage: {
      input: {
        required: {
          images: ['IMAGE', {}],
          filename_prefix: ['STRING', { default: 'ComfyUI' }],
        },
      },
    },
    JoinImageWithAlpha: {
      input: { required: { image: ['IMAGE', {}], alpha: ['MASK', {}] } },
    },
    InvertMask: {
      input: { required: { mask: ['MASK', {}] } },
    },
    SaveImageWithAlpha: {
      input: {
        required: {
          images: ['IMAGE', {}],
          mask: ['MASK', {}],
          filename_prefix: ['STRING', { default: 'ComfyUI' }],
        },
      },
    },
    BiRefNetRMBG: {
      input: {
        required: {
          image: ['IMAGE', {}],
          model: [['BiRefNet-general', 'BiRefNet_toonout'], { default: 'BiRefNet-general' }],
        },
        optional: {
          mask_blur: ['INT', { default: 0 }],
          mask_offset: ['INT', { default: 0 }],
          invert_output: ['BOOLEAN', { default: false }],
          refine_foreground: ['BOOLEAN', { default: false }],
          background: [['Alpha', 'Color'], { default: 'Alpha' }],
          background_color: ['COLORCODE', { default: '#222222' }],
        },
      },
      output: ['IMAGE', 'MASK', 'IMAGE'],
    },
    RMBG: {
      input: {
        required: {
          image: ['IMAGE', {}],
          model: [['RMBG-2.0', 'INSPYRENET'], { default: 'RMBG-2.0' }],
        },
        optional: {
          sensitivity: ['FLOAT', { default: 1 }],
          process_res: ['INT', { default: 1024 }],
          mask_blur: ['INT', { default: 0 }],
          mask_offset: ['INT', { default: 0 }],
          invert_output: ['BOOLEAN', { default: false }],
          refine_foreground: ['BOOLEAN', { default: false }],
          background: [['Alpha', 'Color'], { default: 'Alpha' }],
        },
      },
      output: ['IMAGE', 'MASK', 'IMAGE'],
    },
  }
  for (const name of options.omit || []) delete info[name]
  return info
}

function makeBridge(options = {}) {
  const calls = {
    detect: 0,
    objectInfo: 0,
    upload: 0,
    validate: 0,
    prompt: 0,
    history: 0,
    queue: 0,
    download: 0,
    decode: 0,
    workflow: null,
  }
  const promptId = 'prompt-rmbg-contract'
  const info = options.info || objectInfo()
  const bridge = {
    async detectBaseUrl() {
      calls.detect += 1
      if (options.neverConnect) return await new Promise(() => {})
      if (options.detectError) throw options.detectError
      return 'http://127.0.0.1:8188'
    },
    async requestJson(_baseUrl, path, init = {}) {
      if (path === '/object_info') {
        calls.objectInfo += 1
        return options.objectInfoResponse || { ok: true, data: info }
      }
      if (path === '/prompt' && init.method === 'POST') {
        calls.prompt += 1
        if (options.promptError) throw options.promptError
        if (options.rejectPrompt) return { ok: false, error: 'contract prompt rejected' }
        return { ok: true, data: { prompt_id: promptId } }
      }
      if (path === `/history/${promptId}`) {
        calls.history += 1
        const item = {
          status: options.executionError
            ? { messages: [['execution_error', { exception_message: options.executionError }]] }
            : { messages: [] },
          outputs: options.noFiles ? {} : {
            '4': { images: [{ filename: 'contract_rgba.png', subfolder: '', type: 'output' }] },
          },
        }
        return { ok: true, data: { [promptId]: item } }
      }
      throw new Error(`Unexpected request path: ${path}`)
    },
    async uploadDataUrl(_baseUrl, name, value) {
      calls.upload += 1
      assert.match(name, /\.png$/)
      assert.match(value, /^data:image\/png;base64,/)
      return options.uploadName || 'uploaded_contract.png'
    },
    async validateWorkflowNodes(_baseUrl, workflow) {
      calls.validate += 1
      calls.workflow = workflow
      if (options.validationError) throw options.validationError
      const missing = Object.values(workflow)
        .map((node) => node.class_type)
        .filter((type) => !info[type])
      assert.deepEqual(missing, [])
    },
    extractFiles(item) {
      return item?.outputs?.['4']?.images || item?.outputs?.['3']?.images || []
    },
    historyErrorMessage(item) {
      const entry = item?.status?.messages?.find((value) => value?.[0] === 'execution_error')
      return entry ? String(entry[1]?.exception_message || 'Runtime execution failed') : ''
    },
    async readQueueState() {
      calls.queue += 1
      return { running: options.noFiles ? 0 : 1, pending: 0, empty: options.noFiles === true }
    },
    async fetchBlob(_baseUrl, path) {
      calls.download += 1
      assert.match(path, /^\/view\?filename=contract_rgba\.png/)
      return { contractBlob: true }
    },
    async blobToDataUrl(blob) {
      calls.decode += 1
      assert.equal(blob?.contractBlob, true)
      return options.outputDataUrl || pngDataUrl(37, 19, 6)
    },
    withTimeout(task) {
      return Promise.resolve().then(typeof task === 'function' ? task : () => task)
    },
  }
  return { bridge, calls, promptId }
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, code)
    assert.equal(error?.retryable, false)
    return true
  })
}

assert.equal(sandbox.NovaFlowAifxRmbgBridge, api)
assert.equal(typeof api.removeBackgroundDataUrl, 'function')

const source = pngDataUrl(37, 19, 6)
const output = pngDataUrl(37, 19, 6)
const preferred = makeBridge({ outputDataUrl: output })
const progress = []
const result = await api.removeBackgroundDataUrl(source, {
  bridge: preferred.bridge,
  timeoutMs: 5000,
  pollIntervalMs: 0,
  inspectAlphaPixels() {
    return { alphaMin: 0, alphaMax: 255, translucentPixels: 12 }
  },
  onProgress(event) {
    progress.push(event)
  },
})
assert.equal(result, output)
assert.equal(preferred.calls.detect, 1)
assert.equal(preferred.calls.objectInfo, 1)
assert.equal(preferred.calls.upload, 1)
assert.equal(preferred.calls.validate, 1)
assert.equal(preferred.calls.prompt, 1)
assert.equal(preferred.calls.history, 1)
assert.equal(preferred.calls.queue, 0)
assert.equal(preferred.calls.download, 1)
assert.equal(preferred.calls.decode, 1)
assert.equal(progress.at(-1)?.phase, 'complete')

const graph = preferred.calls.workflow
assert.deepEqual(Object.keys(graph), ['1', '2', '3', '4'])
assert.deepEqual(plain(graph['1']), { class_type: 'LoadImage', inputs: { image: 'uploaded_contract.png' } })
assert.equal(graph['2'].class_type, 'BiRefNetRMBG', 'BiRefNetRMBG must be preferred over RMBG')
assert.equal(graph['2'].inputs.model, 'BiRefNet-general')
assert.equal(graph['2'].inputs.background, 'Alpha')
assert.equal(graph['2'].inputs.invert_output, false)
assert.deepEqual(plain(graph['3']), { class_type: 'InvertMask', inputs: { mask: ['2', 1] } })
assert.equal(graph['4'].class_type, 'SaveImageWithAlpha')
assert.deepEqual(plain(graph['4'].inputs.images), ['1', 0], 'the alpha save path must preserve original RGB dimensions')
assert.deepEqual(plain(graph['4'].inputs.mask), ['3', 0], 'KJNodes mask inversion must be compensated explicitly')
assert.equal(Object.values(graph).some((node) => /resize|scale/i.test(node.class_type)), false)

const fallbackInfo = objectInfo({ omit: ['BiRefNetRMBG', 'SaveImageWithAlpha', 'InvertMask'] })
const fallbackBuilt = api.buildWorkflow(fallbackInfo, 'fallback.png', 'fallback_contract')
assert.equal(fallbackBuilt.nodeType, 'RMBG')
assert.equal(fallbackBuilt.alphaStrategy, 'join-image-with-alpha')
assert.equal(fallbackBuilt.workflow['2'].inputs.model, 'RMBG-2.0')
assert.deepEqual(plain(fallbackBuilt.workflow['3'].inputs.alpha), ['2', 1])

await expectCode(
  api.removeBackgroundDataUrl('data:image/jpeg;base64,AAAA', { bridge: preferred.bridge }),
  'AIFX_RMBG_INPUT_INVALID',
)

await expectCode(
  api.removeBackgroundDataUrl(source, { bridge: {} }),
  'AIFX_RMBG_BRIDGE_INCOMPLETE',
)

const missingNodes = makeBridge({
  info: objectInfo({ omit: ['BiRefNetRMBG', 'RMBG'] }),
})
await expectCode(
  api.removeBackgroundDataUrl(source, { bridge: missingNodes.bridge, timeoutMs: 5000 }),
  'AIFX_RMBG_NODE_UNAVAILABLE',
)

const rejected = makeBridge({ rejectPrompt: true })
await expectCode(
  api.removeBackgroundDataUrl(source, { bridge: rejected.bridge, timeoutMs: 5000 }),
  'AIFX_RMBG_PROMPT_REJECTED',
)
assert.equal(rejected.calls.prompt, 1, 'a rejected prompt must not be retried automatically')
assert.equal(rejected.calls.history, 0)

const runtimeFailure = makeBridge({ executionError: 'contract node failure' })
await expectCode(
  api.removeBackgroundDataUrl(source, { bridge: runtimeFailure.bridge, timeoutMs: 5000 }),
  'AIFX_RMBG_RUNTIME_EXECUTION_FAILED',
)
assert.equal(runtimeFailure.calls.prompt, 1, 'a Runtime execution failure must not resubmit the workflow')
assert.equal(runtimeFailure.calls.history, 1)

const wrongSize = makeBridge({ outputDataUrl: pngDataUrl(38, 19, 6) })
await expectCode(
  api.removeBackgroundDataUrl(source, { bridge: wrongSize.bridge, timeoutMs: 5000 }),
  'AIFX_RMBG_OUTPUT_SIZE_MISMATCH',
)

const noAlpha = makeBridge({ outputDataUrl: pngDataUrl(37, 19, 2) })
await expectCode(
  api.removeBackgroundDataUrl(source, { bridge: noAlpha.bridge, timeoutMs: 5000 }),
  'AIFX_RMBG_OUTPUT_ALPHA_MISSING',
)

const fullyOpaque = makeBridge({ outputDataUrl: pngDataUrl(37, 19, 6) })
await expectCode(
  api.removeBackgroundDataUrl(source, {
    bridge: fullyOpaque.bridge,
    timeoutMs: 5000,
    inspectAlphaPixels() {
      return { alphaMin: 255, alphaMax: 255, translucentPixels: 0 }
    },
  }),
  'AIFX_RMBG_OUTPUT_ALPHA_MISSING',
)

const fullyTransparent = makeBridge({ outputDataUrl: pngDataUrl(37, 19, 6) })
await expectCode(
  api.removeBackgroundDataUrl(source, {
    bridge: fullyTransparent.bridge,
    timeoutMs: 5000,
    inspectAlphaPixels() {
      return { alphaMin: 0, alphaMax: 0, translucentPixels: 0 }
    },
  }),
  'AIFX_RMBG_OUTPUT_EMPTY',
)

const controller = new AbortController()
controller.abort('contract cancellation')
await expectCode(
  api.removeBackgroundDataUrl(source, { bridge: preferred.bridge, signal: controller.signal }),
  'AIFX_RMBG_ABORTED',
)

const hanging = makeBridge({ neverConnect: true })
await expectCode(
  api.removeBackgroundDataUrl(source, { bridge: hanging.bridge, timeoutMs: 20 }),
  'AIFX_RMBG_TIMEOUT',
)
assert.equal(hanging.calls.detect, 1, 'a timed-out connection must not be retried automatically')

console.log('AIFX RMBG bridge contract: PASS')
