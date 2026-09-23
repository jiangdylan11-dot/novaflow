(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowArtGenerateProviderWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const TASK_TYPE = 'local_workflow_image'
  const GPT_TEXT_MODEL = 'gpt-image-2.5-flare'
  const GPT_EDIT_MODEL = 'gpt-image-2.5-sunburst'
  const GOOGLE_TEXT_MODEL = 'gemini-2.5-flash-image'
  const GOOGLE_EDIT_MODEL = 'gemini-3-pro-image-preview'
  const TEXT_EVENT_TYPE = 3
  const MAX_REFERENCES = 3
  const PROVIDER_REFERENCE_LIMITS = Object.freeze({
    gpt: 16,
    google: 14,
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
    if (value == null || value === '') return MAX_REFERENCES
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
    const bounded = normalizeInteger(value, 1024, 1024, 3840)
    return Math.max(1024, Math.min(3840, Math.round(bounded / 16) * 16))
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

  function validateGoogleEditTaskProfile(options) {
    const taskProfile = normalizeOptionalText(options?.taskProfile).toLowerCase()
    if (taskProfile !== 'ui-design') return

    const referenceRoles = Array.isArray(options?.referenceRoles) ? options.referenceRoles : []
    if (normalizeReferenceRole(referenceRoles[0]) !== 'ui_layout') {
      throw new Error('Google UI design requires referenceRoles[0] to be ui_layout')
    }
    if (normalizeOptionalText(options?.layoutGuideEncoding).toLowerCase() !== 'soft-occupancy-heatmap-v1') {
      throw new Error('Google UI design requires layoutGuideEncoding=soft-occupancy-heatmap-v1')
    }
    if (!normalizeOptionalText(options?.systemPrompt)) {
      throw new Error('Google UI design requires a non-empty systemPrompt')
    }
  }

  function normalizeNodeIdPrefix(value) {
    const requested = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
    if (requested) return `${requested}_`
    workflowNonce += 1
    return `nf_art_${Date.now().toString(36)}_${workflowNonce.toString(36)}_${Math.random().toString(16).slice(2, 10)}_`
  }

  function namespacedNodeId(nodeIdPrefix, index) {
    return `${nodeIdPrefix}${index}`
  }

  function addLoadImageNodes(workflow, uploadedNames, firstNodeId, nodeIdPrefix) {
    return uploadedNames.map((name, index) => {
      const nodeId = namespacedNodeId(nodeIdPrefix, firstNodeId + index)
      workflow[nodeId] = {
        inputs: { image: name },
        class_type: 'LoadImage',
      }
      return [nodeId, 0]
    })
  }

  function addSaveImageNode(workflow, nodeId, imageSource, outputPrefix) {
    workflow[String(nodeId)] = {
      inputs: {
        filename_prefix: outputPrefix,
        images: imageSource,
      },
      class_type: 'SaveImage',
    }
  }

  function buildGptWorkflow(options, mode, uploadedNames, outputPrefix, nodeIdPrefix) {
    const model = mode === 'img2img' ? GPT_EDIT_MODEL : GPT_TEXT_MODEL
    const workflow = {}
    const references = addLoadImageNodes(workflow, uploadedNames, 1, nodeIdPrefix)
    const providerNodeId = namespacedNodeId(nodeIdPrefix, references.length + 1)
    const settings = options.settings && typeof options.settings === 'object' ? options.settings : {}
    const size = normalizeChoice(settings.size, [
      'auto',
      '1024x1024',
      '1024x1536',
      '1536x1024',
      '2048x2048',
      '2048x1152',
      '1152x2048',
      '3840x2160',
      '2160x3840',
      'Custom',
    ], '1024x1024')
    const customWidth = normalizeDimension(settings.customWidth)
    const customHeight = normalizeDimension(settings.customHeight)
    if (size === 'Custom') {
      const aspectRatio = Math.max(customWidth, customHeight) / Math.min(customWidth, customHeight)
      if (aspectRatio > 3) throw new Error('GPT custom image aspect ratio cannot exceed 3:1')
      if (customWidth * customHeight > 8294400) {
        throw new Error('GPT custom image size cannot exceed 8,294,400 pixels')
      }
    }
    const inputs = {
      prompt: String(options.prompt || ''),
      model,
      'model.size': size,
      'model.custom_width': customWidth,
      'model.custom_height': customHeight,
      'model.background': 'auto',
      'model.quality': normalizeChoice(settings.quality, ['low', 'medium', 'high'], 'low'),
      n: 1,
      seed: normalizeInteger(settings.seed, 0, 0, 2147483647),
    }
    references.forEach((source, index) => {
      inputs[`model.images.image_${index + 1}`] = source
    })

    workflow[providerNodeId] = {
      inputs,
      class_type: 'OpenAIGPTImageNodeV2',
    }

    addSaveImageNode(workflow, namespacedNodeId(nodeIdPrefix, references.length + 2), [providerNodeId, 0], outputPrefix)
    return {
      workflow,
      providerNodeIds: [providerNodeId],
      providerNodeType: 'OpenAIGPTImageNodeV2',
      modelKey: model,
      taskType: TASK_TYPE,
    }
  }

  function buildGoogleTextWorkflow(options, outputPrefix, nodeIdPrefix) {
    const settings = options.settings && typeof options.settings === 'object' ? options.settings : {}
    const providerNodeId = namespacedNodeId(nodeIdPrefix, 1)
    const workflow = {
      [providerNodeId]: {
        inputs: {
          prompt: String(options.prompt || ''),
          model: GOOGLE_TEXT_MODEL,
          seed: normalizeInteger(settings.seed, 42, 0, Number.MAX_SAFE_INTEGER),
          aspect_ratio: normalizeChoice(settings.aspectRatio, [
            'auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
          ], 'auto'),
          response_modalities: 'IMAGE',
        },
        class_type: 'GeminiImageNode',
      },
    }
    addSaveImageNode(workflow, namespacedNodeId(nodeIdPrefix, 2), [providerNodeId, 0], outputPrefix)
    return {
      workflow,
      providerNodeIds: [providerNodeId],
      providerNodeType: 'GeminiImageNode',
      modelKey: GOOGLE_TEXT_MODEL,
      taskType: TASK_TYPE,
    }
  }

  function buildGoogleEditWorkflow(options, uploadedNames, outputPrefix, nodeIdPrefix) {
    const settings = options.settings && typeof options.settings === 'object' ? options.settings : {}
    validateGoogleEditTaskProfile(options)
    const workflow = {}
    const references = addLoadImageNodes(workflow, uploadedNames, 1, nodeIdPrefix)
    const batchNodeId = namespacedNodeId(nodeIdPrefix, references.length + 1)
    const providerNodeId = namespacedNodeId(nodeIdPrefix, references.length + 2)
    const batchInputs = {}
    references.forEach((source, index) => {
      batchInputs[`images.image${index}`] = source
    })
    workflow[batchNodeId] = {
      inputs: batchInputs,
      class_type: 'BatchImagesNode',
    }
    const providerInputs = {
      prompt: String(options.prompt || ''),
      model: GOOGLE_EDIT_MODEL,
      seed: normalizeInteger(settings.seed, 42, 0, Number.MAX_SAFE_INTEGER),
      aspect_ratio: normalizeChoice(settings.aspectRatio, [
        'auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
      ], 'auto'),
      resolution: normalizeChoice(settings.resolution, ['1K', '2K', '4K'], '1K'),
      response_modalities: 'IMAGE',
      images: [batchNodeId, 0],
    }
    const systemPrompt = normalizeOptionalText(options.systemPrompt)
    if (systemPrompt) providerInputs.system_prompt = systemPrompt
    workflow[providerNodeId] = {
      inputs: providerInputs,
      class_type: 'GeminiImage2Node',
    }
    addSaveImageNode(workflow, namespacedNodeId(nodeIdPrefix, references.length + 3), [providerNodeId, 0], outputPrefix)
    return {
      workflow,
      providerNodeIds: [providerNodeId],
      providerNodeType: 'GeminiImage2Node',
      modelKey: GOOGLE_EDIT_MODEL,
      taskType: TASK_TYPE,
    }
  }

  function buildWorkflow(options = {}) {
    const provider = normalizeProvider(options.provider)
    const mode = normalizeMode(options.mode)
    const uploadedNames = normalizeUploadedNames(options.uploadedNames, mode, options, provider)
    const outputPrefix = normalizeOutputPrefix(options.outputPrefix)
    const nodeIdPrefix = normalizeNodeIdPrefix(options.nodeIdPrefix)
    if (provider === 'gpt') return buildGptWorkflow(options, mode, uploadedNames, outputPrefix, nodeIdPrefix)
    if (provider === 'google' && mode === 'txt2img') return buildGoogleTextWorkflow(options, outputPrefix, nodeIdPrefix)
    if (provider === 'google' && mode === 'img2img') return buildGoogleEditWorkflow(options, uploadedNames, outputPrefix, nodeIdPrefix)
    throw new Error(`Unsupported Art Generate provider: ${provider || '(empty)'}`)
  }

  function buildRunWorkflow(options = {}) {
    const provider = normalizeProvider(options.provider)
    const mode = normalizeMode(options.mode)
    if (provider === 'local') {
      if (!options.localWorkflow || typeof options.localWorkflow !== 'object') throw new Error('Local Art Generate workflow is required')
      const taskProfile = normalizeOptionalText(options.taskProfile).toLowerCase()
      let localWorkflow = options.localWorkflow
      let uiLocal = null
      let uiRefine = null
      if (taskProfile === 'ui-design' && String(options.localModelKey || '') === 'qwen-image-2.1-ui') {
        uiLocal = { workflow: localWorkflow, metadata: Object.freeze({ taskProfile, engine: 'qwen-2.1', mode }) }
      } else if (taskProfile === 'ui-design') {
        const localUiWorkflow = root?.NovaFlowUiDesignLocalWorkflow
        if (typeof localUiWorkflow?.build !== 'function') {
          throw new Error('Local UI workflow module is required for taskProfile=ui-design')
        }
        uiLocal = localUiWorkflow.build({
          taskProfile,
          mode,
          referenceRoles: options.referenceRoles,
          layoutGuideEncoding: options.layoutGuideEncoding,
          localWorkflow,
          state: options.state,
        })
        localWorkflow = uiLocal.workflow
      } else if (taskProfile === 'ui-design-refine') {
        const localUiRefineWorkflow = root?.NovaFlowUiDesignLocalRefineWorkflow
        if (typeof localUiRefineWorkflow?.build !== 'function') {
          throw new Error('Local UI refinement workflow module is required for taskProfile=ui-design-refine')
        }
        uiRefine = localUiRefineWorkflow.build({
          taskProfile,
          mode,
          localWorkflow,
          uploadedNames: options.uploadedNames,
          preset: options.state?.localUiRefinePreset,
          denoise: options.state?.localUiRefineDenoise,
          state: options.state,
        })
        localWorkflow = uiRefine.workflow
      }
      return {
        workflow: localWorkflow,
        providerNodeIds: [],
        providerNodeType: '',
        modelKey: String(options.localModelKey || 'local'),
        taskType: TASK_TYPE,
        uiLocal: uiLocal?.metadata || null,
        uiRefine: uiRefine?.metadata || null,
      }
    }
    const built = buildWorkflow(options)
    return {
      ...built,
      providerNodeIds: Array.isArray(built.providerNodeIds) ? built.providerNodeIds.map((item) => String(item)) : [],
      providerNodeType: String(built.providerNodeType || ''),
      modelKey: String(built.modelKey || provider),
      taskType: TASK_TYPE,
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
