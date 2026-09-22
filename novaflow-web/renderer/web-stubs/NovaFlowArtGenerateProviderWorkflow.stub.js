// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowArtGenerateProviderWorkflow.
// UI helpers are kept verbatim; every graph builder is replaced by a
// recorder, so this file contains no ComfyUI topology (asserted by
// tools/generate-workflow-stubs.mjs --check and by the protocol suite).
(function (root) {
  const __record = (module, method, options) => {
    const intent = { __novaflowWorkflowIntent: true, module, method, options };
    try { (root.NovaFlowWebRuntime && root.NovaFlowWebRuntime.recordWorkflowIntent || (() => {}))(intent); } catch (_) {}
    return intent;
  };
  const __api = {};
  __api["buildWorkflow"] = function (options) {
    return __record("NovaFlowArtGenerateProviderWorkflow", "buildWorkflow", options);
  };
  __api["buildRunWorkflow"] = function buildRunWorkflow(options = {}) {
    const provider = normalizeProvider(options.provider)
    const mode = normalizeMode(options.mode)
    if (provider === 'local') {
      if (!options.localWorkflow || typeof options.localWorkflow !== 'object') throw new Error('Local Art Generate workflow is required')
      const taskProfile = normalizeOptionalText(options.taskProfile).toLowerCase()
      let localWorkflow = options.localWorkflow
      let uiLocal = null
      let uiRefine = null
      if (taskProfile === 'ui-design') {
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
          nsfw: options.state?.nsfw === true,
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
  };
  __api["parseComfyProgressTextFrame"] = function parseComfyProgressTextFrame(value) {
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
  };
  __api["createPriceObserver"] = function createPriceObserver(options = {}) {
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
  };
  root["NovaFlowArtGenerateProviderWorkflow"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
