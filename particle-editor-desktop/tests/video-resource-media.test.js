const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  VIDEO_RESOURCE_MEDIA_SCHEME,
  registerVideoResourceMediaScheme,
  createVideoResourceMediaService,
  registerVideoResourceMediaIpc,
} = require('../main/video-resource-media')

test('video resource media scheme is privileged for secure streaming', () => {
  const calls = []
  registerVideoResourceMediaScheme({ registerSchemesAsPrivileged: (value) => calls.push(value) })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], [{
    scheme: VIDEO_RESOURCE_MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }])
})

test('path-backed video resources stream through an opaque token and preserve range requests', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaflow-video-resource-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const filePath = path.join(dir, 'merged result.mp4')
  fs.writeFileSync(filePath, Buffer.from('video-bytes'))
  const protocolHandlers = new Map()
  const fetchCalls = []
  const service = createVideoResourceMediaService({
    fs,
    path,
    crypto: { randomBytes: () => Buffer.alloc(24, 7) },
    protocol: { handle: (scheme, handler) => protocolHandlers.set(scheme, handler) },
    electronNet: {
      fetch: async (url, options) => {
        fetchCalls.push({ url, options })
        return new Response('streamed', { status: 200 })
      },
    },
  })

  assert.equal(service.registerProtocol(), true)
  assert.equal(service.registerProtocol(), true)
  assert.equal(protocolHandlers.size, 1)
  const registered = service.register(42, { filePath })
  assert.equal(registered.ok, true)
  assert.match(registered.url, /^novaflow-media:\/\/resource\/[0-9a-f]+\//)
  assert.equal(registered.url.includes(encodeURIComponent(filePath)), false)
  assert.equal(registered.filePath, filePath)

  const response = await protocolHandlers.get(VIDEO_RESOURCE_MEDIA_SCHEME)({
    url: registered.url,
    headers: new Headers({ range: 'bytes=2-6' }),
  })
  assert.equal(response.status, 200)
  assert.equal(fetchCalls.length, 1)
  assert.equal(fetchCalls[0].url.startsWith('file:'), true)
  assert.equal(fetchCalls[0].options.headers.get('range'), 'bytes=2-6')
  assert.deepEqual(service.release(7, { token: registered.token }), { ok: false, error: 'video_resource_owner_mismatch' })
  assert.deepEqual(service.release(42, { token: registered.token }), { ok: true, released: true })
  assert.equal((await protocolHandlers.get(VIDEO_RESOURCE_MEDIA_SCHEME)({ url: registered.url, headers: new Headers() })).status, 404)
})

test('video resource media IPC releases every token when its renderer is destroyed', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaflow-video-resource-ipc-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const filePath = path.join(dir, 'merged.webm')
  fs.writeFileSync(filePath, Buffer.from('video-bytes'))
  const service = createVideoResourceMediaService({
    fs,
    path,
    crypto: require('node:crypto'),
    protocol: { handle() {} },
    electronNet: { fetch: async () => new Response('streamed') },
  })
  const handlers = new Map()
  registerVideoResourceMediaIpc({ service, handleIpc: (channel, handler) => handlers.set(channel, handler) })
  let destroyed = null
  const sender = { id: 91, once: (event, handler) => { if (event === 'destroyed') destroyed = handler } }
  const registered = await handlers.get('video-resource-media-register')({ sender }, { filePath })
  assert.equal(registered.ok, true)
  assert.equal(service.debugSnapshot().resourceCount, 1)
  destroyed()
  assert.equal(service.debugSnapshot().resourceCount, 0)
})
