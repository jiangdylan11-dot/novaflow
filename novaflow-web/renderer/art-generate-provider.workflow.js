(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowArtGenerateProviderWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const TASK_TYPE = 'local_workflow_image'
  const TEXT_EVENT_TYPE = 3
  const MAX_REFERENCES = 3
  const PROVIDER_REFERENCE_LIMITS = Object.freeze({
    gpt: 16,
  })
  let workflowNonce = 0

  function normalizeProvider(value) {
    return String(value || '').trim().toLowerCase()
  }

  function normalizeMode(value) {
    const mode = String(value || '').trim().toLowerCase()
    if (mode !== 'txt2img' && mode !== 'img2img') throw new Error(`Unsupported Art Generate mode: ${mode || '(empty)'}`)
    return mode
  }

  function normalizeMaxReferences(value, provider) {
    if (value == null || value === '') return PROVIDER_REFERENCE_LIMITS[provider] || MAX_REFERENCES
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error('maxReferences must be a positive integer')
    const providerLimit = PROVIDER_REFERENCE_LIMITS[provider] || MAX_REFERENCES
    if (parsed > providerLimit) {
      throw new Error(`${provider || 'Provider'} supports at most ${providerLimit} reference images`)
    }
    return parsed
  }

  function normalizeUploadedNames(value, mode, options, provider) {
    if (mode !== 'img2img') return []
    const names = (Array.isArray(value) ? value : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    if (names.length === 0) throw new Error('Image-to-image generation requires at least one uploaded reference')
    const maxReferences = normalizeMaxReferences(options?.maxReferences, provider)
    if (names.length > maxReferences) {
      throw new Error(
        `Image-to-image generation received ${names.length} references; maximum is ${maxReferences}`,
      )
    }
    return names
  }

  function normalizeChoice(value, allowed, fallback) {
    const normalized = String(value || '').trim()
    return allowed.includes(normalized) ? normalized : fallback
  }

  function normalizeInteger(value, fallback, minimum, maximum) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(minimum, Math.min(maximum, Math.round(parsed)))
  }

  function normalizeDimension(value) {
    const bounded = normalizeInteger(value, 1024, 480, 3840)
    return Math.max(480, Math.min(3840, Math.round(bounded / 16) * 16))
  }

  function normalizeOutputPrefix(value) {
    return String(value || '').trim() || 'NovaFlow_Art_Generate'
  }

  function normalizeOptionalText(value) {
    return String(value == null ? '' : value).trim()
  }

  function normalizeReferenceRole(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
      ? value.role
      : value
    return normalizeOptionalText(source).toLowerCase()
  }

  function buildWorkflow() {
    throw new Error('云端出图已改为 RunningHub，不再构建 Comfy 工作流')
  }

  function buildRunWorkflow(options = {}) {
    const provider = normalizeProvider(options.provider)
    const mode = normalizeMode(options.mode)
    if (provider !== 'local') {
      throw new Error(provider === 'gpt'
        ? 'GPT 出图请走 RunningHub，不再提交 Comfy 云节点'
        : 'Google 出图已删除，请改用 Qwen（本地）或 GPT Image 2.5')
    }
    if (!options.localWorkflow || typeof options.localWorkflow !== 'object') throw new Error('Local Art Generate workflow is required')
    const taskProfile = normalizeOptionalText(options.taskProfile).toLowerCase()
    const localWorkflow = options.localWorkflow
    let uiLocal = null
    if (taskProfile === 'ui-design') {
      // Local UI runs only on Qwen-Image-2.1.
      if (String(options.localModelKey || '') !== 'qwen-image-2.1-ui') throw new Error('本地 UI 设计工作流不可用，请刷新页面后重试')
      uiLocal = Object.freeze({ taskProfile, engine: 'qwen-2.1', mode })
    }
    return {
      workflow: localWorkflow,
      providerNodeIds: [],
      providerNodeType: '',
      modelKey: String(options.localModelKey || 'local'),
      taskType: TASK_TYPE,
      uiLocal,
    }
  }

  function toUint8Array(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    return null
  }

  function parseComfyProgressTextFrame(value) {
    try {
      const bytes = toUint8Array(value)
      if (!bytes || bytes.byteLength < 8) return null
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      if (view.getUint32(0, false) !== TEXT_EVENT_TYPE) return null
      const nodeIdLength = view.getUint32(4, false)
      const textOffset = 8 + nodeIdLength
      if (nodeIdLength <= 0 || textOffset > bytes.byteLength) return null
      const decoder = new TextDecoder('utf-8')
      const nodeId = decoder.decode(bytes.subarray(8, textOffset))
      const text = decoder.decode(bytes.subarray(textOffset))
      const exactMatch = text.match(/NovaFlow-Price-Exact:\s*((?:0|[1-9]\d{0,13})\.\d{6})\s*credits\b/i)
      const match = exactMatch || text.match(/Price:\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*credits\b/i)
      if (!match) return null
      const amountText = match[1].replace(/,/g, '')
      const credits = Number(amountText)
      if (!nodeId || !Number.isFinite(credits) || credits <= 0) return null
      const exact = Boolean(exactMatch)
      return {
        nodeId,
        amountText,
        credits,
        exact,
        source: exact ? 'comfy_api_exact_price_v1' : 'comfy_api_legacy_price_v1',
      }
    } catch {
      return null
    }
  }

  function createWebSocketUrl(runtimeBaseUrl, clientId) {
    const value = String(runtimeBaseUrl || '').trim()
    if (!value) throw new Error('Runtime base URL is required')
    const url = new URL(value)
    if (url.protocol === 'http:') url.protocol = 'ws:'
    else if (url.protocol === 'https:') url.protocol = 'wss:'
    else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('Runtime URL must use http, https, ws, or wss')
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/ws`
    url.search = ''
    url.hash = ''
    url.searchParams.set('clientId', String(clientId || ''))
    return url.toString()
  }

  async function messageDataToBinary(value) {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value
    if (value && typeof value.arrayBuffer === 'function') return value.arrayBuffer()
    return null
  }

  function createPriceObserver(options = {}) {
    const runtimeBaseUrl = options.runtimeBaseUrl || options.baseUrl || options.runtime
    const socketUrl = createWebSocketUrl(runtimeBaseUrl, options.clientId)
    const providerNodeIds = new Set(
      (Array.isArray(options.providerNodeIds) ? options.providerNodeIds : [])
        .map((value) => String(value || ''))
        .filter(Boolean),
    )
    const waiters = new Set()
    const requirePromptOwnership = options.requirePromptOwnership === true
    const promptPrices = new Map()
    let latestCredits = 0
    let latestExactPrice = null
    let boundPromptId = ''
    let activePromptId = ''
    let activeNodeId = ''
    let closed = false
    let socketUnavailable = false
    let socket = null
    let connectionTimer = null
    let readySettled = false
    let settleReady = null
    const ready = new Promise((resolve) => {
      settleReady = resolve
    })

    function finishReady(value) {
      if (connectionTimer !== null) {
        clearTimeout(connectionTimer)
        connectionTimer = null
      }
      if (readySettled) return
      readySettled = true
      settleReady(value)
    }

    function settleWaiter(waiter, value) {
      if (!waiters.delete(waiter)) return
      if (waiter.timer) clearTimeout(waiter.timer)
      waiter.resolve(value)
    }

    function exactPriceValue() {
      return latestExactPrice ? { ...latestExactPrice } : null
    }

    function settleAll() {
      for (const waiter of Array.from(waiters)) {
        if (waiter.exactOnly && !latestExactPrice) continue
        settleWaiter(waiter, waiter.exactOnly ? exactPriceValue() : (latestCredits > 0 ? latestCredits : null))
      }
    }

    function settleUnavailableWaiters() {
      for (const waiter of Array.from(waiters)) {
        settleWaiter(waiter, waiter.exactOnly ? exactPriceValue() : (latestCredits > 0 ? latestCredits : null))
      }
    }

    function applyPriceRecord(current, parsed) {
      const next = current && typeof current === 'object'
        ? { credits: Number(current.credits) || 0, exactPrice: current.exactPrice || null }
        : { credits: 0, exactPrice: null }
      const candidate = {
        amountText: parsed.amountText,
        credits: parsed.credits,
        exact: true,
        source: parsed.source,
      }
      if (parsed.exact) {
        if (!next.exactPrice || parsed.credits >= Number(next.exactPrice.credits || 0)) next.exactPrice = candidate
        next.credits = Number(next.exactPrice.credits) || 0
      } else if (!next.exactPrice) {
        next.credits = Math.max(next.credits, parsed.credits)
      }
      return next
    }

    function markSocketUnavailable(closeSocket) {
      if (socketUnavailable) return
      socketUnavailable = true
      finishReady(false)
      settleUnavailableWaiters()
      if (!closeSocket) return
      try {
        socket?.close()
      } catch {
        // Connection teardown is best-effort after the price channel becomes unavailable.
      }
    }

    function handleJsonMessage(value) {
      try {
        const message = JSON.parse(String(value || ''))
        if (String(message?.type || '') !== 'executing') return
        const data = message?.data && typeof message.data === 'object' ? message.data : {}
        activePromptId = String(data.prompt_id || '')
        activeNodeId = String(data.node || '')
      } catch {
        // Non-JSON text messages are unrelated to Comfy execution ownership.
      }
    }

    async function handleMessage(event) {
      if (closed || socketUnavailable) return
      if (typeof event?.data === 'string') {
        handleJsonMessage(event.data)
        return
      }
      const binary = await messageDataToBinary(event?.data)
      if (closed || socketUnavailable || !binary) return
      const parsed = parseComfyProgressTextFrame(binary)
      if (!parsed || !providerNodeIds.has(parsed.nodeId) || parsed.credits <= 0) return
      if (requirePromptOwnership) {
        if (!activePromptId || activeNodeId !== parsed.nodeId) return
        if (boundPromptId && activePromptId !== boundPromptId) return
        const record = applyPriceRecord(promptPrices.get(activePromptId), parsed)
        promptPrices.set(activePromptId, record)
        if (!boundPromptId || activePromptId !== boundPromptId) return
        latestCredits = record.credits
        latestExactPrice = record.exactPrice
      } else {
        const record = applyPriceRecord({ credits: latestCredits, exactPrice: latestExactPrice }, parsed)
        latestCredits = record.credits
        latestExactPrice = record.exactPrice
      }
      settleAll()
    }

    function bind(type, listener) {
      if (!socket) return
      if (typeof socket.addEventListener === 'function') socket.addEventListener(type, listener)
      else socket[`on${type}`] = listener
    }

    try {
      if (typeof options.webSocketFactory === 'function') socket = options.webSocketFactory(socketUrl)
      else {
        const SocketConstructor = options.WebSocket || root?.WebSocket
        if (typeof SocketConstructor === 'function') socket = new SocketConstructor(socketUrl)
      }
      if (socket) {
        socket.binaryType = 'arraybuffer'
        bind('open', () => {
          if (!closed && !socketUnavailable) finishReady(true)
        })
        bind('message', handleMessage)
        bind('error', () => markSocketUnavailable(true))
        bind('close', () => markSocketUnavailable(false))
        const configuredTimeout = Number(options.connectTimeoutMs)
        const connectTimeoutMs = Math.max(0, Number.isFinite(configuredTimeout) ? configuredTimeout : 5000)
        connectionTimer = setTimeout(() => markSocketUnavailable(true), connectTimeoutMs)
      } else {
        markSocketUnavailable(false)
      }
    } catch {
      socket = null
      markSocketUnavailable(false)
    }

    function waitForCredits(timeoutMs = 5000) {
      if (latestCredits > 0) return Promise.resolve(latestCredits)
      if (closed || socketUnavailable) return Promise.resolve(null)
      const duration = Math.max(0, Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 5000)
      if (duration === 0) return Promise.resolve(null)
      return new Promise((resolve) => {
        const waiter = { resolve, timer: null, exactOnly: false }
        waiter.timer = setTimeout(() => settleWaiter(waiter, latestCredits > 0 ? latestCredits : null), duration)
        waiters.add(waiter)
      })
    }

    function waitForExactPrice(timeoutMs = 5000) {
      if (latestExactPrice) return Promise.resolve(exactPriceValue())
      if (closed || socketUnavailable) return Promise.resolve(null)
      const duration = Math.max(0, Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 5000)
      if (duration === 0) return Promise.resolve(null)
      return new Promise((resolve) => {
        const waiter = { resolve, timer: null, exactOnly: true }
        waiter.timer = setTimeout(() => settleWaiter(waiter, exactPriceValue()), duration)
        waiters.add(waiter)
      })
    }

    function bindPrompt(promptId) {
      boundPromptId = String(promptId || '').trim()
      const record = boundPromptId ? promptPrices.get(boundPromptId) : null
      latestCredits = Number(record?.credits || 0)
      latestExactPrice = record?.exactPrice || null
      if (latestCredits > 0 || latestExactPrice) settleAll()
      return Boolean(boundPromptId)
    }

    function close() {
      if (closed) return
      closed = true
      socketUnavailable = true
      finishReady(false)
      settleUnavailableWaiters()
      try {
        socket?.close()
      } catch {
        // Closing is best-effort; price capture must not affect a successful generation result.
      }
    }

    return Object.freeze({
      ready,
      bindPrompt,
      waitForCredits,
      waitForExactPrice,
      close,
      getLatestCredits: () => (latestCredits > 0 ? latestCredits : null),
    })
  }

  return Object.freeze({
    buildWorkflow,
    buildRunWorkflow,
    parseComfyProgressTextFrame,
    createPriceObserver,
  })
})
