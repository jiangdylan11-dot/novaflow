(function (root, factory) {
  const localWorkflow = typeof module === 'object' && module.exports
    ? require('./aifx-local.workflow.js')
    : root && root.NovaFlowAifxLocalWorkflow
  const api = factory(root, localWorkflow)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAifxGenerateWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, localWorkflow) {
  'use strict'

  const VERSION = '20260731-aifx-generate-workflow-1'
  const HARD_TIMEOUT_MS = 300000
  const DEFAULT_POLL_INTERVAL_MS = 1000
  const CANCELLATION_TIMEOUT_MS = 5000
  const CANCELLATION_CONFIRM_ATTEMPTS = 3
  const CANCELLATION_CONFIRM_DELAY_MS = 120
  const STAGE_TIMEOUTS = Object.freeze({
    connect: 8000,
    objectInfo: 20000,
    upload: 30000,
    validate: 30000,
    prompt: 30000,
    history: 20000,
    queue: 10000,
    download: 30000,
  })

  function cleanText(value) {
    return String(value == null ? '' : value).trim()
  }

  function typedError(code, message, details = {}) {
    const error = new Error(cleanText(message) || code)
    error.name = 'NovaFlowAifxGenerateError'
    error.code = code
    error.retryable = details.retryable === true
    Object.assign(error, details)
    return error
  }

  function abortError(reason) {
    const error = new Error(cleanText(reason?.message || reason) || 'AIFX generation cancelled')
    error.name = 'AbortError'
    error.code = 'AIFX_ABORTED'
    error.retryable = false
    return error
  }

  function timeoutError(message, details = {}) {
    return typedError('AIFX_TIMEOUT', cleanText(message) || 'AIFX generation exceeded the 300 second hard timeout.', {
      retryable: true,
      ...details,
    })
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError(signal.reason)
  }

  function normalizeProvider(value) {
    const provider = cleanText(value || 'local').toLowerCase()
    if (['local', 'gpt', 'google'].includes(provider)) return provider
    throw typedError('AIFX_PROVIDER_UNSUPPORTED', `Unsupported AIFX provider: ${provider}`, {
      provider,
      retryable: false,
    })
  }

  function deferredProviderError(provider) {
    return typedError('AIFX_PROVIDER_DEFERRED', `AIFX ${provider} generation is deferred; Local is the only enabled provider in this phase.`, {
      provider,
      deferred: true,
      retryable: false,
    })
  }

  function executionBridge(options) {
    const bridge = options?.bridge || (root && root.NovaFlowArtGenerateExecutionBridge)
    const required = [
      'detectBaseUrl',
      'requestJson',
      'fetchBlob',
      'uploadDataUrl',
      'validateWorkflowNodes',
      'extractFiles',
      'historyErrorMessage',
      'readQueueState',
      'withTimeout',
      'blobToDataUrl',
    ]
    const missing = required.filter((name) => typeof bridge?.[name] !== 'function')
    if (missing.length) {
      throw typedError('AIFX_BRIDGE_INCOMPLETE', `NovaFlow Art Generate execution bridge is incomplete: ${missing.join(', ')}`, {
        missing,
      })
    }
    return bridge
  }

  function imageInput(value, fallbackName, width, height) {
    const source = typeof value === 'string' ? { dataUrl: value } : (value && typeof value === 'object' ? value : {})
    const dataUrl = cleanText(source.dataUrl || source.imageUrl || source.url || source.src)
    if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(dataUrl)) {
      throw typedError('AIFX_INPUT_INVALID', `${fallbackName} must be a PNG, JPEG or WebP data URL.`)
    }
    return Object.freeze({
      name: cleanText(source.name || source.fileName || source.filename) || fallbackName,
      dataUrl,
      width: Math.round(Number(source.width || width) || 0),
      height: Math.round(Number(source.height || height) || 0),
    })
  }

  function uploadedName(value, fallback) {
    if (typeof value === 'string') return cleanText(value) || fallback
    return cleanText(value?.name || value?.filename || value?.fileName || value?.data?.name || value?.data?.filename) || fallback
  }

  function responseData(response) {
    return response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'data')
      ? response.data
      : response
  }

  function promptIdFromResponse(response) {
    const data = responseData(response)
    return cleanText(data?.prompt_id || data?.data?.prompt_id)
  }

  function queueEntryIdentity(entry) {
    if (Array.isArray(entry)) {
      return {
        promptId: cleanText(entry[1]),
        clientId: cleanText(entry[3]?.client_id || entry[3]?.clientId),
      }
    }
    if (entry && typeof entry === 'object') {
      const extra = entry.extra_data || entry.extraData || {}
      return {
        promptId: cleanText(entry.prompt_id || entry.promptId || entry.id),
        clientId: cleanText(entry.client_id || entry.clientId || extra.client_id || extra.clientId),
      }
    }
    return { promptId: '', clientId: '' }
  }

  function promptQueueOwnership(response, promptId, clientId) {
    const data = responseData(response)
    const queue = data && typeof data === 'object' ? data : {}
    const inspect = (entries) => {
      let own = false
      let ownershipMismatch = false
      for (const entry of Array.isArray(entries) ? entries : []) {
        const identity = queueEntryIdentity(entry)
        if (identity.promptId !== promptId) continue
        if (identity.clientId && clientId && identity.clientId !== clientId) {
          ownershipMismatch = true
          continue
        }
        own = true
      }
      return { own, ownershipMismatch }
    }
    const pending = inspect(queue.queue_pending)
    const running = inspect(queue.queue_running)
    return {
      pending: pending.own,
      running: running.own,
      ownershipMismatch: pending.ownershipMismatch || running.ownershipMismatch,
    }
  }

  function cancellationResponseAccepted(response) {
    const status = Number(response?.status)
    if (response == null) return false
    if (Number.isFinite(status)) return status >= 200 && status < 300
    return response.ok === true
  }

  function historyItem(response, promptId) {
    const data = responseData(response)
    return data && typeof data === 'object' && data[promptId] ? data[promptId] : data
  }

  function resultFileUrl(file) {
    const query = new URLSearchParams()
    query.set('filename', cleanText(file?.filename || file?.name))
    if (cleanText(file?.subfolder)) query.set('subfolder', cleanText(file.subfolder))
    query.set('type', cleanText(file?.type) || 'output')
    return `/view?${query.toString()}`
  }

  function emitProgress(callback, phase, label, progress, detail = {}) {
    if (typeof callback !== 'function') return
    try {
      callback(Object.freeze({
        phase,
        label,
        progress: Math.max(0, Math.min(1, Number(progress) || 0)),
        ...detail,
      }))
    } catch {
      // Presentation callbacks never own generation control flow.
    }
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue)
    if (!value || typeof value !== 'object') return value
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stableValue(value[key])
      return out
    }, {})
  }

  function canonicalJson(value) {
    return JSON.stringify(stableValue(value))
  }

  async function sha256Hex(value) {
    const text = typeof value === 'string' ? value : canonicalJson(value)
    if (root?.crypto?.subtle && typeof TextEncoder === 'function') {
      const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    }
    if (typeof require === 'function') {
      return require('node:crypto').createHash('sha256').update(text).digest('hex')
    }
    throw typedError('AIFX_HASH_UNAVAILABLE', 'SHA-256 is unavailable in this environment.')
  }

  function raceAbort(promise, signal) {
    throwIfAborted(signal)
    if (!signal || typeof signal.addEventListener !== 'function') return Promise.resolve(promise)
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve(value)
      }
      const onAbort = () => finish(abortError(signal.reason))
      signal.addEventListener('abort', onAbort, { once: true })
      Promise.resolve(promise).then((value) => finish(null, value), (error) => finish(error))
    })
  }

  function raceAbortTimeout(promise, signal, timeoutMs, message) {
    throwIfAborted(signal)
    const duration = Math.max(1, Number(timeoutMs) || 1)
    return new Promise((resolve, reject) => {
      let settled = false
      let timer = 0
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve(value)
      }
      const onAbort = () => finish(abortError(signal?.reason))
      if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => finish(timeoutError(message)), duration)
      Promise.resolve(promise).then((value) => finish(null, value), (error) => finish(error))
    })
  }

  function remainingMs(deadline) {
    return Math.max(0, deadline - Date.now())
  }

  async function bridgeCall(bridge, task, requestedTimeoutMs, message, signal, deadline) {
    throwIfAborted(signal)
    const remaining = remainingMs(deadline)
    if (remaining <= 0) throw timeoutError(message, { hardTimeout: true })
    const timeoutMs = Math.max(1, Math.min(remaining, Number(requestedTimeoutMs) || remaining))
    const request = bridge.withTimeout(task, timeoutMs, message)
    try {
      return await raceAbortTimeout(request, signal, timeoutMs, message)
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw abortError(signal?.reason || error)
      if (remainingMs(deadline) <= 0 || /timeout|timed out|超时/i.test(cleanText(error?.message))) {
        throw timeoutError(message, { cause: error })
      }
      throw error
    }
  }

  function wait(ms, signal, deadline) {
    throwIfAborted(signal)
    const duration = Math.max(0, Math.min(Number(ms) || 0, remainingMs(deadline)))
    if (duration <= 0) {
      if (remainingMs(deadline) <= 0) return Promise.reject(timeoutError())
      return Promise.resolve()
    }
    return raceAbort(new Promise((resolve) => setTimeout(resolve, duration)), signal)
  }

  async function cancellationRequest(bridge, baseUrl, path, init, message, deadline) {
    const timeoutMs = Math.max(0, Math.min(CANCELLATION_TIMEOUT_MS, Number(deadline) - Date.now()))
    if (timeoutMs <= 0) throw timeoutError('AIFX Runtime cancellation deadline expired.')
    const request = Promise.resolve().then(() => bridge.requestJson(baseUrl, path, init))
    return raceAbortTimeout(request, null, timeoutMs, message)
  }

  async function readCancellationOwnership(bridge, baseUrl, promptId, clientId, deadline) {
    const response = await cancellationRequest(
      bridge,
      baseUrl,
      '/queue',
      { method: 'GET' },
      'Reading Runtime queue for AIFX cancellation timed out.',
      deadline,
    )
    if (response?.ok === false && !(Number(response?.status) >= 200 && Number(response?.status) < 300)) {
      throw new Error(cleanText(response?.error || response?.raw) || 'Runtime queue inspection failed during AIFX cancellation.')
    }
    return promptQueueOwnership(response, promptId, clientId)
  }

  async function confirmCancellation(bridge, baseUrl, promptId, clientId, deadline) {
    let ownership = null
    for (let attempt = 0; attempt < CANCELLATION_CONFIRM_ATTEMPTS; attempt += 1) {
      ownership = await readCancellationOwnership(bridge, baseUrl, promptId, clientId, deadline)
      if (ownership.ownershipMismatch || (!ownership.pending && !ownership.running)) return ownership
      if (attempt + 1 < CANCELLATION_CONFIRM_ATTEMPTS) {
        const delayMs = Math.max(0, Math.min(CANCELLATION_CONFIRM_DELAY_MS, Number(deadline) - Date.now()))
        if (delayMs <= 0) break
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
    return ownership
  }

  function cancellationReceipt(overrides = {}) {
    return Object.freeze({
      attempted: false,
      confirmed: false,
      action: 'none',
      status: 'wait-only',
      promptId: '',
      detail: '',
      ...overrides,
    })
  }

  async function cancelSubmittedPrompt(bridge, baseUrl, promptId, clientId) {
    const base = { attempted: true, promptId, clientId }
    if (!cleanText(baseUrl) || !cleanText(promptId)) {
      return cancellationReceipt({ ...base, attempted: false, status: 'prompt-id-unavailable' })
    }
    try {
      const cleanupDeadline = Date.now() + CANCELLATION_TIMEOUT_MS
      let ownership = await readCancellationOwnership(bridge, baseUrl, promptId, clientId, cleanupDeadline)
      if (ownership.ownershipMismatch) {
        return cancellationReceipt({ ...base, status: 'ownership-mismatch', detail: 'Runtime queue client_id did not match this AIFX run.' })
      }
      if (!ownership.pending && !ownership.running) {
        return cancellationReceipt({ ...base, status: 'not-active', detail: 'The AIFX prompt was not active in the Runtime queue.' })
      }

      if (ownership.pending) {
        let deleteResponse = null
        let deleteError = null
        try {
          deleteResponse = await cancellationRequest(
            bridge,
            baseUrl,
            '/queue',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ delete: [promptId] }),
            },
            'Deleting the pending AIFX prompt timed out.',
            cleanupDeadline,
          )
        } catch (error) {
          deleteError = error
        }
        const deleteAccepted = cancellationResponseAccepted(deleteResponse)
        ownership = await confirmCancellation(bridge, baseUrl, promptId, clientId, cleanupDeadline)
        if (ownership.ownershipMismatch) {
          return cancellationReceipt({ ...base, action: 'delete-pending', status: 'ownership-mismatch' })
        }
        if (!ownership.pending && !ownership.running) {
          return cancellationReceipt({
            ...base,
            action: 'delete-pending',
            confirmed: deleteAccepted,
            status: deleteAccepted ? 'cancelled' : 'not-active',
            detail: deleteError ? cleanText(deleteError.message) : '',
          })
        }
        if (ownership.pending) {
          return cancellationReceipt({
            ...base,
            action: 'delete-pending',
            status: 'delete-not-confirmed',
            detail: cleanText(deleteError?.message || deleteResponse?.error || deleteResponse?.raw),
          })
        }
        // A pending prompt can become running between queue inspection and deletion.
        // Continue only because the Runtime now explicitly reports our own promptId as running.
      }

      if (!ownership.running) {
        return cancellationReceipt({ ...base, status: 'not-active' })
      }
      const interruptResponse = await cancellationRequest(
        bridge,
        baseUrl,
        '/interrupt',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt_id: promptId }),
        },
        'Interrupting the running AIFX prompt timed out.',
        cleanupDeadline,
      )
      const interruptAccepted = cancellationResponseAccepted(interruptResponse)
      const confirmed = await confirmCancellation(bridge, baseUrl, promptId, clientId, cleanupDeadline)
      if (confirmed.ownershipMismatch) {
        return cancellationReceipt({ ...base, action: 'interrupt-running', status: 'ownership-mismatch' })
      }
      const absent = !confirmed.pending && !confirmed.running
      return cancellationReceipt({
        ...base,
        action: 'interrupt-running',
        confirmed: interruptAccepted && absent,
        status: interruptAccepted && absent ? 'cancelled' : 'interrupt-not-confirmed',
        detail: interruptAccepted ? '' : cleanText(interruptResponse?.error || interruptResponse?.raw),
      })
    } catch (error) {
      return cancellationReceipt({ ...base, status: 'cleanup-failed', detail: cleanText(error?.message || error) })
    }
  }

  function attachRuntimeCancellation(error, receipt) {
    if (!error || typeof error !== 'object') return error
    error.runtimeCancellation = receipt
    error.runtimeCancelled = receipt?.confirmed === true
    return error
  }

  async function run(options = {}) {
    const provider = normalizeProvider(options.provider)
    if (provider !== 'local') throw deferredProviderError(provider)
    if (!localWorkflow || typeof localWorkflow.buildWorkflow !== 'function') {
      throw typedError('AIFX_LOCAL_WORKFLOW_MISSING', 'NovaFlow AIFX Local workflow module is unavailable.')
    }

    const anchorRole = localWorkflow.normalizeAnchorRole(options.anchorRole, true)
    const identitySource = options.identityReference || options.identity || (options.identityDataUrl
      ? { dataUrl: options.identityDataUrl, name: options.identityName }
      : null)
    const hasIdentityReference = identitySource != null && identitySource !== false
    if (!anchorRole && (hasIdentityReference || options.anchorFrame != null)) {
      throw typedError(
        'AIFX_LOCAL_ANCHOR_ROLE_REQUIRED',
        'anchorRole is required when anchorFrame or identityReference is provided.',
      )
    }
    if (anchorRole === 'peak' && hasIdentityReference) {
      throw typedError(
        'AIFX_LOCAL_ANCHOR_IDENTITY_FORBIDDEN',
        'The peak anchor must establish identity and cannot receive identityReference.',
      )
    }
    const anchorFrame = anchorRole
      ? localWorkflow.normalizeAnchorFrame(options.anchorFrame, anchorRole)
      : null

    const signal = options.signal || null
    throwIfAborted(signal)
    const bridge = executionBridge(options)
    const onProgress = options.onProgress || options.progress
    const sheetSource = options.guide || options.sheet || options.spriteSheet || {
      dataUrl: options.sheetDataUrl,
      name: options.sheetName,
      width: options.width,
      height: options.height,
    }
    const styleSource = options.styleReference || options.style || {
      dataUrl: options.styleDataUrl,
      name: options.styleName,
    }
    const sheet = imageInput(sheetSource, 'aifx_control_sheet.png', options.width, options.height)
    const style = imageInput(styleSource, 'aifx_style_reference.png')
    const identity = hasIdentityReference
      ? imageInput(identitySource, 'aifx_peak_identity_reference.png')
      : null
    if (sheet.width < 16 || sheet.height < 16) {
      throw typedError('AIFX_INPUT_INVALID', 'AIFX control sheet width and height are required.')
    }

    const startedAt = Date.now()
    const requestedTimeoutMs = Number(options.timeoutMs)
    const hardTimeoutMs = Number.isFinite(requestedTimeoutMs)
      ? Math.max(1, Math.min(HARD_TIMEOUT_MS, Math.round(requestedTimeoutMs)))
      : HARD_TIMEOUT_MS
    const deadline = startedAt + hardTimeoutMs
    const pollIntervalMs = Math.max(0, Number.isFinite(Number(options.pollIntervalMs))
      ? Number(options.pollIntervalMs)
      : DEFAULT_POLL_INTERVAL_MS)
    const timing = { startedAt: new Date(startedAt).toISOString(), hardTimeoutMs }
    // The locked 4783 preview deliberately blocks the retired legacy AIFX prompt
    // namespace. Keep the source-driven workflow on a distinct namespace so the
    // preview proxy can reject the old endpoint without rejecting this workflow.
    const clientId = cleanText(options.clientId) || `novaflow_vfxgen_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const outputPrefix = cleanText(options.outputPrefix) || `NovaFlow_VFX_Local_${Date.now()}`
    let runtimeBaseUrl = ''
    let promptId = ''
    let runAbandoned = false
    let cleanupPromptId = ''
    let cleanupPromise = null

    const requestRuntimeCancellation = (submittedPromptId) => {
      const ownedPromptId = cleanText(submittedPromptId)
      if (!ownedPromptId || !runtimeBaseUrl) {
        return Promise.resolve(cancellationReceipt({ status: 'prompt-id-unavailable', promptId: ownedPromptId }))
      }
      if (cleanupPromise && cleanupPromptId === ownedPromptId) return cleanupPromise
      cleanupPromptId = ownedPromptId
      cleanupPromise = cancelSubmittedPrompt(bridge, runtimeBaseUrl, ownedPromptId, clientId)
      return cleanupPromise
    }

    async function timed(name, task) {
      const stageStartedAt = Date.now()
      try {
        return await task()
      } finally {
        timing[`${name}Ms`] = Math.max(0, Date.now() - stageStartedAt)
      }
    }

    emitProgress(onProgress, 'start', 'Preparing AIFX generation', 0, { provider })
    try {
      emitProgress(onProgress, 'connect', 'Connecting to NovaFlow AI Runtime', 0.03)
      const baseUrl = await timed('connect', () => bridgeCall(
        bridge,
        () => bridge.detectBaseUrl(),
        STAGE_TIMEOUTS.connect,
        'Connecting to NovaFlow AI Runtime timed out.',
        signal,
        deadline,
      ))
      if (!cleanText(baseUrl)) throw typedError('AIFX_RUNTIME_UNAVAILABLE', 'NovaFlow AI Runtime is unavailable.')
      runtimeBaseUrl = baseUrl

      emitProgress(onProgress, 'inspect', 'Resolving installed Qwen AIFX models', 0.07)
      const objectInfoResponse = await timed('objectInfo', () => bridgeCall(
        bridge,
        () => bridge.requestJson(baseUrl, '/object_info', { method: 'GET' }),
        STAGE_TIMEOUTS.objectInfo,
        'Reading NovaFlow AI Runtime node definitions timed out.',
        signal,
        deadline,
      ))
      if (objectInfoResponse?.ok === false) {
        throw typedError('AIFX_OBJECT_INFO_FAILED', cleanText(objectInfoResponse.error || objectInfoResponse.raw) || 'Failed to read Runtime node definitions.')
      }
      const objectInfo = responseData(objectInfoResponse)

      emitProgress(onProgress, 'upload', 'Uploading control sprite sheet', 0.12, { role: 'control_sheet' })
      const sheetUpload = await timed('sheetUpload', () => bridgeCall(
        bridge,
        () => bridge.uploadDataUrl(baseUrl, sheet.name, sheet.dataUrl),
        STAGE_TIMEOUTS.upload,
        'Uploading AIFX control sheet timed out.',
        signal,
        deadline,
      ))
      throwIfAborted(signal)
      emitProgress(onProgress, 'upload', 'Uploading style reference', 0.18, { role: 'style_reference' })
      const styleUpload = await timed('styleUpload', () => bridgeCall(
        bridge,
        () => bridge.uploadDataUrl(baseUrl, style.name, style.dataUrl),
        STAGE_TIMEOUTS.upload,
        'Uploading AIFX style reference timed out.',
        signal,
        deadline,
      ))
      let identityUpload = null
      if (identity) {
        emitProgress(onProgress, 'upload', 'Uploading peak identity reference', 0.21, { role: 'identity_reference' })
        identityUpload = await timed('identityUpload', () => bridgeCall(
          bridge,
          () => bridge.uploadDataUrl(baseUrl, identity.name, identity.dataUrl),
          STAGE_TIMEOUTS.upload,
          'Uploading AIFX peak identity reference timed out.',
          signal,
          deadline,
        ))
      }

      emitProgress(onProgress, 'build', 'Building Qwen sprite-sheet workflow', 0.23)
      const buildStartedAt = Date.now()
      const workflowRun = localWorkflow.buildWorkflow({
        objectInfo,
        sheetImageName: uploadedName(sheetUpload, sheet.name),
        guideImageName: uploadedName(sheetUpload, sheet.name),
        styleImageName: uploadedName(styleUpload, style.name),
        identityImageName: identity ? uploadedName(identityUpload, identity.name) : '',
        width: sheet.width,
        height: sheet.height,
        prompt: options.prompt,
        structurePrompt: options.structurePrompt,
        stylePrompt: options.stylePrompt,
        promptsPrecompiled: options.promptsPrecompiled === true,
        negativePrompt: options.negativePrompt,
        frameCount: options.frameCount,
        sequencePlan: options.sequencePlan,
        anchorRole,
        anchorFrame,
        materialReferenceMode: options.materialReferenceMode,
        materialType: options.materialType,
        strength: options.strength ?? options.styleStrength,
        controlStrength: options.controlStrength,
        controlEndPercent: options.controlEndPercent,
        seed: options.seed,
        outputPrefix,
      })
      timing.buildMs = Math.max(0, Date.now() - buildStartedAt)
      const workflow = workflowRun.workflow
      const [promptHash, workflowHash] = await timed('hash', () => Promise.all([
        sha256Hex(workflowRun.prompts),
        sha256Hex(workflow),
      ]))

      emitProgress(onProgress, 'validate', 'Validating AIFX workflow nodes', 0.27)
      await timed('validate', () => bridgeCall(
        bridge,
        () => bridge.validateWorkflowNodes(baseUrl, workflow),
        STAGE_TIMEOUTS.validate,
        'Validating the AIFX workflow timed out.',
        signal,
        deadline,
      ))

      emitProgress(onProgress, 'submit', 'Submitting AIFX generation', 0.31)
      const promptTimeoutMs = Math.max(1, Math.min(STAGE_TIMEOUTS.prompt, remainingMs(deadline)))
      const promptRequest = Promise.resolve().then(() => bridge.requestJson(baseUrl, '/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, prompt: workflow }),
        }))
      promptRequest.then((lateResponse) => {
        const latePromptId = promptIdFromResponse(lateResponse)
        if (!latePromptId || (!runAbandoned && !signal?.aborted && remainingMs(deadline) > 0)) return
        requestRuntimeCancellation(latePromptId).catch(() => {})
      }, () => {})
      const sent = await timed('submit', () => raceAbortTimeout(
        promptRequest,
        signal,
        promptTimeoutMs,
        'Submitting the AIFX workflow timed out.',
      ))
      const sentData = responseData(sent)
      promptId = cleanText(sentData?.prompt_id || sentData?.data?.prompt_id)
      if (!sent || sent.ok === false || !promptId) {
        throw typedError(
          'AIFX_PROMPT_REJECTED',
          cleanText(sent?.error || sent?.raw || (sent?.data ? JSON.stringify(sent.data) : '')) || 'NovaFlow AI Runtime did not return a prompt_id.',
        )
      }

      const generationStartedAt = Date.now()
      let files = []
      let emptyQueueHits = 0
      while (remainingMs(deadline) > 0) {
        throwIfAborted(signal)
        const history = await bridgeCall(
          bridge,
          () => bridge.requestJson(baseUrl, `/history/${encodeURIComponent(promptId)}`, { method: 'GET' }),
          STAGE_TIMEOUTS.history,
          'Reading the AIFX generation result timed out.',
          signal,
          deadline,
        )
        const item = historyItem(history, promptId)
        const historyError = cleanText(bridge.historyErrorMessage(item))
        if (historyError) {
          throw typedError('AIFX_RUNTIME_EXECUTION_FAILED', historyError, { promptId })
        }
        files = (bridge.extractFiles(item) || []).filter(Boolean)
        if (files.length) break

        const queue = await bridgeCall(
          bridge,
          () => bridge.readQueueState(baseUrl),
          STAGE_TIMEOUTS.queue,
          'Reading the AIFX queue timed out.',
          signal,
          deadline,
        )
        emptyQueueHits = queue?.empty ? emptyQueueHits + 1 : 0
        const elapsed = Date.now() - generationStartedAt
        if (emptyQueueHits >= 4 && elapsed >= 10000) {
          throw typedError('AIFX_RESULT_MISSING', 'The Runtime queue finished without an AIFX output image.', { promptId })
        }
        emitProgress(onProgress, 'running', 'Generating coherent AIFX sprite sheet', Math.min(0.94, 0.35 + elapsed / HARD_TIMEOUT_MS), {
          promptId,
          queueRemaining: Math.max(0, Number(queue?.pending) || 0),
        })
        await wait(pollIntervalMs, signal, deadline)
      }
      timing.generationMs = Math.max(0, Date.now() - generationStartedAt)
      if (!files.length) throw timeoutError('AIFX generation exceeded the 300 second hard timeout.', { promptId, hardTimeout: true })

      const file = files[0]
      emitProgress(onProgress, 'download', 'Downloading raw AIFX sprite sheet', 0.96, { promptId })
      const blob = await timed('download', () => bridgeCall(
        bridge,
        () => bridge.fetchBlob(baseUrl, resultFileUrl(file)),
        STAGE_TIMEOUTS.download,
        'Downloading the AIFX sprite sheet timed out.',
        signal,
        deadline,
      ))
      if (!blob) throw typedError('AIFX_DOWNLOAD_FAILED', 'NovaFlow AI Runtime returned no AIFX image data.', { promptId })
      const dataUrl = await timed('decode', () => bridgeCall(
        bridge,
        () => bridge.blobToDataUrl(blob),
        STAGE_TIMEOUTS.download,
        'Decoding the AIFX sprite sheet timed out.',
        signal,
        deadline,
      ))
      if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(cleanText(dataUrl))) {
        throw typedError('AIFX_DOWNLOAD_FAILED', 'Downloaded AIFX output is not a supported image data URL.', { promptId })
      }

      const completedAt = Date.now()
      timing.totalMs = Math.max(0, completedAt - startedAt)
      timing.completedAt = new Date(completedAt).toISOString()
      const name = cleanText(file?.filename || file?.name) || `${outputPrefix}.png`
      const warnings = [...workflowRun.warnings]
      const rawOutput = Object.freeze({
        name,
        dataUrl,
        width: workflowRun.width,
        height: workflowRun.height,
      })
      const candidate = Object.freeze({
        id: `aifx_${anchorRole ? 'frame' : 'sheet'}_${completedAt.toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
        kind: anchorRole ? 'aifx-raw-frame-candidate' : 'aifx-raw-sheet-candidate',
        status: 'ready',
        source: 'aifx-generate-workflow',
        provider: 'local',
        promptId,
        name,
        dataUrl,
        imageUrl: dataUrl,
        width: workflowRun.width,
        height: workflowRun.height,
        ...(anchorRole
          ? {
              anchorRole: workflowRun.anchorRole,
              anchorFrame: workflowRun.anchorFrame,
              rawFrame: rawOutput,
            }
          : { rawSheet: rawOutput }),
        modelKey: workflowRun.modelKey,
        models: workflowRun.models,
        seed: workflowRun.seed,
        effectiveStrength: workflowRun.effectiveStrength,
        conditioningMode: workflowRun.conditioningMode,
        visualReferenceConnected: workflowRun.visualReferenceConnected !== false,
        visualReferenceEffective: workflowRun.visualReferenceEffective === true,
        visualReferenceEndPercent: workflowRun.visualReferenceEndPercent,
        semanticMaterialConditioning: workflowRun.semanticMaterialConditioning === true,
        peakMaterialTokenConditioning: workflowRun.peakMaterialTokenConditioning === true,
        materialReferenceMode: workflowRun.materialReferenceMode,
        promptHash,
        workflowHash,
        timing: Object.freeze({ ...timing }),
        warnings: Object.freeze(warnings),
      })
      emitProgress(onProgress, 'complete', 'AIFX sprite sheet generation complete', 1, { promptId, candidate })
      return candidate
    } catch (error) {
      runAbandoned = true
      const cancelled = error?.name === 'AbortError' || signal?.aborted
      const finalError = cancelled ? abortError(signal?.reason || error) : error
      if (promptId && (cancelled || finalError?.code === 'AIFX_TIMEOUT')) {
        const receipt = await requestRuntimeCancellation(promptId)
        attachRuntimeCancellation(finalError, receipt)
      } else if (cancelled || finalError?.code === 'AIFX_TIMEOUT') {
        attachRuntimeCancellation(finalError, cancellationReceipt({
          attempted: false,
          status: 'prompt-id-unavailable',
          promptId: '',
          detail: 'The frontend stopped before Runtime returned a prompt_id.',
        }))
      }
      emitProgress(onProgress, cancelled ? 'cancelled' : 'error', cleanText(finalError?.message || finalError), 0, { error: finalError })
      throw finalError
    }
  }

  return Object.freeze({
    VERSION,
    HARD_TIMEOUT_MS,
    STAGE_TIMEOUTS,
    normalizeProvider,
    canonicalJson,
    sha256Hex,
    run,
  })
})
