const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const proxyPath = path.resolve(__dirname, '../../particle-editor/proxy-electron-api.js')
const source = fs.readFileSync(proxyPath, 'utf8')

function loadProxy(existingApi, fetchImpl) {
  const window = { electronAPI: existingApi || {} }
  window.window = window
  const storage = new Map()
  const context = vm.createContext({
    window,
    localStorage: {
      getItem(key) { return storage.get(key) || null },
      setItem(key, value) { storage.set(key, String(value)) },
    },
    fetch: fetchImpl,
    Headers,
    Response,
    Request,
    FormData,
    Blob,
    URL,
    URLSearchParams,
    Uint8Array,
    TextDecoder,
    btoa,
    atob,
    console,
  })
  vm.runInContext(source, context, { filename: proxyPath })
  return window.electronAPI
}

test('preview exposes only the fixed fail-closed AI-sequence LoRA adapter actions', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const body = JSON.parse(init.body)
    calls.push({ url: String(url), init, body })
    return new Response(JSON.stringify(
      body.action.endsWith('-catalog')
        ? { ok: true, items: [{ name: `${body.action}.safetensors` }] }
        : { ok: true, item: body.payload, strength: body.payload.strength },
    ), { status: 200 })
  }
  const api = loadProxy({}, fetchImpl)
  const context = { highName: 'high.safetensors', lowName: 'low.safetensors', steps: 4 }
  const descriptor = {
    ...context,
    name: 'wan.safetensors',
    role: 'high',
    fingerprint: 'lora-fingerprint',
    highFingerprint: 'high-fingerprint',
    lowFingerprint: 'low-fingerprint',
    strength: 0.75,
  }

  await api.wan22LoraCatalog(context)
  await api.wan22LoraValidate(descriptor)
  await api.minimaxH3LoraCatalog({ mode: 'r2v', steps: 20 })
  await api.minimaxH3LoraValidate({ mode: 'r2v', steps: 20, name: 'h3.safetensors' })

  assert.deepEqual(calls.map(({ url }) => url), Array(4).fill('/__ai_sequence_lora'))
  assert.deepEqual(calls.map(({ init }) => init.method), Array(4).fill('POST'))
  assert.deepEqual(calls.map(({ init }) => init.cache), Array(4).fill('no-store'))
  assert.deepEqual(calls.map(({ body }) => body.action), [
    'wan22-catalog',
    'wan22-validate',
    'minimax-h3-catalog',
    'minimax-h3-validate',
  ])
  assert.deepEqual(calls[1].body.payload, descriptor)
  assert.equal(calls.some(({ url }) => /object_info|__runtime_proxy|8188/i.test(url)), false)

  const adapterStart = source.indexOf('const aiSequenceLoraRequest =')
  const adapterEnd = source.indexOf('const clientApiRequest =', adapterStart)
  assert.ok(adapterStart >= 0 && adapterEnd > adapterStart)
  assert.doesNotMatch(
    source.slice(adapterStart, adapterEnd),
    /object_info|runtimeRequestJson|comfyRequestJson|__runtime_proxy|127\.0\.0\.1:8188/,
    'the compatibility adapter must not regain a raw Runtime or object_info fallback',
  )
})

test('trusted preload LoRA methods always win over the preview HTTP adapter', async () => {
  const previewCalls = []
  const nativeCalls = []
  const native = {
    wan22LoraCatalog: async (payload) => { nativeCalls.push(['wan22-catalog', payload]); return { ok: true, items: [] } },
    wan22LoraValidate: async (payload) => { nativeCalls.push(['wan22-validate', payload]); return { ok: true } },
    minimaxH3LoraCatalog: async (payload) => { nativeCalls.push(['minimax-h3-catalog', payload]); return { ok: true, items: [] } },
    minimaxH3LoraValidate: async (payload) => { nativeCalls.push(['minimax-h3-validate', payload]); return { ok: true } },
  }
  const api = loadProxy(native, async (url) => {
    previewCalls.push(String(url))
    return new Response(JSON.stringify({ ok: false }), { status: 500 })
  })

  assert.equal(api.wan22LoraCatalog, native.wan22LoraCatalog)
  assert.equal(api.wan22LoraValidate, native.wan22LoraValidate)
  assert.equal(api.minimaxH3LoraCatalog, native.minimaxH3LoraCatalog)
  assert.equal(api.minimaxH3LoraValidate, native.minimaxH3LoraValidate)
  await api.wan22LoraCatalog({ steps: 4 })
  await api.wan22LoraValidate({ role: 'shared' })
  await api.minimaxH3LoraCatalog({ mode: 't2v' })
  await api.minimaxH3LoraValidate({ mode: 't2v' })
  assert.equal(nativeCalls.length, 4)
  assert.deepEqual(previewCalls, [])
})

test('invalid preview responses fail closed without exposing raw candidates', async () => {
  const api = loadProxy({}, async () => new Response('not-json', { status: 502 }))
  const result = await api.wan22LoraCatalog({ highName: 'high', lowName: 'low', steps: 4 })
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    ok: false,
    status: 502,
    error: 'invalid_ai_sequence_lora_response',
    preview: true,
  })
  assert.equal('items' in result, false)
})


test('Qwen uses the shared preview adapter and preserves native preload when present', async () => {
  const calls = [];
  const api = loadProxy({}, async (url, init) => { calls.push([url, JSON.parse(init.body)]); return new Response(JSON.stringify({ok:true, items:[]})); });
  await api.qwenLoraCatalog({ nsfw: true });
  assert.deepEqual(calls, [['/__ai_sequence_lora', {action:'qwen-catalog', payload:{nsfw:true}}]]);
  const native = async () => ({ok:true, items:[]});
  assert.equal(loadProxy({qwenLoraCatalog:native}, () => { throw new Error('unexpected HTTP'); }).qwenLoraCatalog, native);
});
