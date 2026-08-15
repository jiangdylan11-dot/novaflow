(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAifxRmbgBridge = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const VERSION = '20260731-aifx-rmbg-workflow-1'
  const DEFAULT_TIMEOUT_MS = 180000
  const MAX_TIMEOUT_MS = 300000
  const DEFAULT_POLL_INTERVAL_MS = 750
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
    error.name = 'NovaFlowAifxRmbgError'
    error.code = code
    error.retryable = details.retryable === true
    Object.assign(error, details)
    return error
  }

  function abortError(reason) {
    const message = cleanText(reason?.message || reason) || 'AIFX background removal was cancelled.'
    const error = typedError('AIFX_RMBG_ABORTED', message, { retryable: false })
    error.name = 'AbortError'
    return error
  }

  function timeoutError(message, details = {}) {
    return typedError(
      'AIFX_RMBG_TIMEOUT',
      cleanText(message) || 'AIFX background removal exceeded its bounded timeout.',
      { ...details, retryable: false },
    )
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError(signal.reason)
  }

  function executionBridge(context) {
    // Resolve at call time because the source module is loaded before the shared Runtime bridge.
    const bridge = context?.bridge || (root && root.NovaFlowArtGenerateExecutionBridge)
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
      throw typedError(
        'AIFX_RMBG_BRIDGE_INCOMPLETE',
        `NovaFlow Art Generate execution bridge is incomplete: ${missing.join(', ')}`,
        { missing },
      )
    }
    return bridge
  }

  function decodeBase64(value, code, label) {
    try {
      if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'))
      if (typeof root?.atob === 'function') {
        const binary = root.atob(value)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
        return bytes
      }
    } catch (cause) {
      throw typedError(code, `${label} contains invalid base64 PNG data.`, { cause })
    }
    throw typedError(code, 'Base64 decoding is unavailable in this environment.')
  }

  function readUint32(bytes, offset) {
    return (
      ((bytes[offset] << 24) >>> 0)
      + (bytes[offset + 1] << 16)
      + (bytes[offset + 2] << 8)
      + bytes[offset + 3]
    ) >>> 0
  }

  function chunkName(bytes, offset) {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
  }

  function inspectPngDataUrl(dataUrl, options = {}) {
    const code = cleanText(options.code) || 'AIFX_RMBG_PNG_INVALID'
    const label = cleanText(options.label) || 'Image'
    const raw = cleanText(dataUrl)
    const match = raw.match(/^data:image\/png;base64,([\s\S]+)$/i)
    if (!match) throw typedError(code, `${label} must be a PNG data URL.`)
    const bytes = decodeBase64(match[1].replace(/\s+/g, ''), code, label)
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte)) {
      throw typedError(code, `${label} is not a valid PNG image.`)
    }
    if (readUint32(bytes, 8) !== 13 || chunkName(bytes, 12) !== 'IHDR') {
      throw typedError(code, `${label} is missing a valid PNG IHDR chunk.`)
    }
    const width = readUint32(bytes, 16)
    const height = readUint32(bytes, 20)
    const bitDepth = bytes[24]
    const colorType = bytes[25]
    if (!width || !height) throw typedError(code, `${label} has invalid PNG dimensions.`)

    let hasTransparencyChunk = false
    let hasIend = false
    let offset = 8
    while (offset + 12 <= bytes.length) {
      const length = readUint32(bytes, offset)
      const end = offset + 12 + length
      if (end > bytes.length) break
      const type = chunkName(bytes, offset + 4)
      if (type === 'tRNS') hasTransparencyChunk = true
      offset = end
      if (type === 'IEND') {
        hasIend = true
        break
      }
    }
    if (!hasIend) throw typedError(code, `${label} is missing a complete PNG IEND chunk.`)
    return Object.freeze({
      width,
      height,
      bitDepth,
      colorType,
      hasAlphaChannel: colorType === 4 || colorType === 6 || hasTransparencyChunk,
    })
  }

  function responseData(response) {
    return response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'data')
      ? response.data
      : response
  }

  function choiceValues(spec) {
    return Array.isArray(spec) && Array.isArray(spec[0]) ? spec[0].slice() : []
  }

  function specDefault(spec) {
    const options = Array.isArray(spec) && spec[1] && typeof spec[1] === 'object' ? spec[1] : {}
    if (Object.prototype.hasOwnProperty.call(options, 'default')) return options.default
    const choices = choiceValues(spec)
    return choices.length ? choices[0] : undefined
  }

  function nodeInputGroups(nodeInfo) {
    const input = nodeInfo?.input && typeof nodeInfo.input === 'object' ? nodeInfo.input : {}
    return {
      required: input.required && typeof input.required === 'object' ? input.required : {},
      optional: input.optional && typeof input.optional === 'object' ? input.optional : {},
    }
  }

  function chooseModel(nodeType, nodeInfo, requestedModel) {
    const { required, optional } = nodeInputGroups(nodeInfo)
    const spec = required.model || optional.model || required.model_name || optional.model_name
    const choices = choiceValues(spec)
    const requested = cleanText(requestedModel)
    if (requested) {
      if (!choices.length || choices.includes(requested)) return requested
      throw typedError('AIFX_RMBG_MODEL_UNAVAILABLE', `Requested RMBG model is not installed: ${requested}`, {
        requestedModel: requested,
        availableModels: choices,
      })
    }
    const preferred = nodeType === 'BiRefNetRMBG'
      ? ['BiRefNet-general', 'BiRefNet_toonout', 'BiRefNet-HR', 'BiRefNet-matting']
      : ['RMBG-2.0', 'INSPYRENET', 'BEN2', 'BEN']
    return preferred.find((name) => !choices.length || choices.includes(name)) || specDefault(spec)
  }

  function buildNodeInputs(nodeType, nodeInfo, imageRef, context = {}) {
    const groups = nodeInputGroups(nodeInfo)
    const all = { ...groups.required, ...groups.optional }
    const model = chooseModel(nodeType, nodeInfo, context.model)
    const overrides = {
      image: imageRef,
      images: imageRef,
      model,
      model_name: model,
      mask_blur: Number.isFinite(Number(context.maskBlur)) ? Math.max(0, Math.round(Number(context.maskBlur))) : 0,
      mask_offset: Number.isFinite(Number(context.maskOffset)) ? Math.round(Number(context.maskOffset)) : 0,
      invert_output: false,
      invert: false,
      refine_foreground: context.refineForeground === true,
      background: 'Alpha',
      output_format: 'Alpha',
      output_type: 'Alpha',
      sensitivity: Number.isFinite(Number(context.sensitivity)) ? Number(context.sensitivity) : 1,
    }
    const inputs = {}
    for (const [name, spec] of Object.entries(all)) {
      let value = Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : specDefault(spec)
      const choices = choiceValues(spec)
      if (choices.length && !choices.includes(value)) value = specDefault(spec)
      if (value !== undefined) inputs[name] = value
    }
    for (const name of Object.keys(groups.required)) {
      if (inputs[name] === undefined) {
        throw typedError('AIFX_RMBG_NODE_UNSUPPORTED', `${nodeType} has an unsupported required input: ${name}`, {
          nodeType,
          inputName: name,
        })
      }
    }
    return inputs
  }

  function buildWorkflow(objectInfo, imageName, outputPrefix, context = {}) {
    const info = objectInfo && typeof objectInfo === 'object' ? objectInfo : {}
    if (!info.LoadImage) {
      throw typedError('AIFX_RMBG_NODE_UNAVAILABLE', 'NovaFlow AI Runtime is missing LoadImage.')
    }
    const nodeType = info.BiRefNetRMBG ? 'BiRefNetRMBG' : (info.RMBG ? 'RMBG' : '')
    if (!nodeType) {
      throw typedError(
        'AIFX_RMBG_NODE_UNAVAILABLE',
        'NovaFlow AI Runtime has no supported BiRefNetRMBG or RMBG node.',
      )
    }
    const prefix = cleanText(outputPrefix).replace(/[^\w./-]+/g, '_') || `NovaFlow_AIFX_RMBG_${Date.now()}`
    const workflow = {
      '1': { class_type: 'LoadImage', inputs: { image: imageName } },
      '2': { class_type: nodeType, inputs: buildNodeInputs(nodeType, info[nodeType], ['1', 0], context) },
    }
    let outputNodeId = ''
    let alphaStrategy = ''
    if (info.SaveImageWithAlpha && info.InvertMask) {
      // KJNodes SaveImageWithAlpha writes alpha as (1 - mask), while RMBG emits a
      // foreground-white mask. Invert once here so the saved alpha remains foreground-white.
      workflow['3'] = { class_type: 'InvertMask', inputs: { mask: ['2', 1] } }
      workflow['4'] = {
        class_type: 'SaveImageWithAlpha',
        inputs: { images: ['1', 0], mask: ['3', 0], filename_prefix: prefix },
      }
      outputNodeId = '4'
      alphaStrategy = 'save-image-with-alpha'
    } else if (info.JoinImageWithAlpha && info.SaveImage) {
      workflow['3'] = { class_type: 'JoinImageWithAlpha', inputs: { image: ['1', 0], alpha: ['2', 1] } }
      workflow['4'] = { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: prefix } }
      outputNodeId = '4'
      alphaStrategy = 'join-image-with-alpha'
    } else if (info.SaveImage) {
      workflow['3'] = { class_type: 'SaveImage', inputs: { images: ['2', 0], filename_prefix: prefix } }
      outputNodeId = '3'
      alphaStrategy = 'rmbg-alpha-image'
    } else {
      throw typedError(
        'AIFX_RMBG_ALPHA_OUTPUT_UNAVAILABLE',
        'NovaFlow AI Runtime has no supported transparent PNG output node chain.',
      )
    }
    return Object.freeze({ workflow, nodeType, outputNodeId, alphaStrategy, outputPrefix: prefix })
  }

  function uploadedName(value, fallback) {
    if (typeof value === 'string') return cleanText(value) || fallback
    return cleanText(value?.name || value?.filename || value?.fileName || value?.data?.name || value?.data?.filename) || fallback
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

  function emitProgress(callback, phase, label, progress, details = {}) {
    if (typeof callback !== 'function') return
    try {
      callback(Object.freeze({
        phase,
        label,
        progress: Math.max(0, Math.min(1, Number(progress) || 0)),
        ...details,
      }))
    } catch {
      // Presentation callbacks never own Runtime control flow.
    }
  }

  async function inspectAlphaPixels(dataUrl, context = {}) {
    if (typeof context.inspectAlphaPixels === 'function') {
      return await context.inspectAlphaPixels(dataUrl)
    }
    if (typeof root?.Image !== 'function' || typeof root?.document?.createElement !== 'function') return null
    const image = new root.Image()
    await new Promise((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(typedError('AIFX_RMBG_OUTPUT_INVALID', 'The transparent PNG could not be decoded.'))
      image.src = dataUrl
    })
    const canvas = root.document.createElement('canvas')
    canvas.width = image.naturalWidth || image.width
    canvas.height = image.naturalHeight || image.height
    const drawing = canvas.getContext?.('2d', { willReadFrequently: true })
    if (!drawing) {
      throw typedError('AIFX_RMBG_OUTPUT_INVALID', 'Canvas alpha inspection is unavailable for the RMBG output.')
    }
    drawing.clearRect(0, 0, canvas.width, canvas.height)
    drawing.drawImage(image, 0, 0)
    const pixels = drawing.getImageData(0, 0, canvas.width, canvas.height).data
    let alphaMin = 255
    let alphaMax = 0
    let translucentPixels = 0
    for (let offset = 3; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset]
      if (alpha < alphaMin) alphaMin = alpha
      if (alpha > alphaMax) alphaMax = alpha
      if (alpha > 0 && alpha < 255) translucentPixels += 1
    }
    return Object.freeze({ alphaMin, alphaMax, translucentPixels })
  }

  function remainingMs(deadline) {
    return Math.max(0, deadline - Date.now())
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

  async function bridgeCall(bridge, task, stageTimeoutMs, message, errorCode, signal, deadline) {
    throwIfAborted(signal)
    const remaining = remainingMs(deadline)
    if (remaining <= 0) throw timeoutError(message, { hardTimeout: true })
    const timeoutMs = Math.max(1, Math.min(remaining, Number(stageTimeoutMs) || remaining))
    try {
      const request = Promise.resolve().then(() => bridge.withTimeout(task, timeoutMs, message))
      return await raceAbortTimeout(request, signal, timeoutMs, message)
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'AIFX_RMBG_ABORTED') {
        throw abortError(signal?.reason || error)
      }
      if (error?.code === 'AIFX_RMBG_TIMEOUT' || remainingMs(deadline) <= 0 || /timed?\s*out|timeout|\u8d85\u65f6/i.test(cleanText(error?.message))) {
        throw timeoutError(message, { cause: error })
      }
      if (error?.name === 'NovaFlowAifxRmbgError') throw error
      throw typedError(errorCode, cleanText(error?.message || error) || message, { cause: error })
    }
  }

  function wait(ms, signal, deadline) {
    throwIfAborted(signal)
    const remaining = remainingMs(deadline)
    if (remaining <= 0) return Promise.reject(timeoutError('', { hardTimeout: true }))
    const duration = Math.max(0, Math.min(Number(ms) || 0, remaining))
    return raceAbortTimeout(new Promise((resolve) => setTimeout(resolve, duration)), signal, remaining, 'AIFX background removal timed out.')
  }

  async function removeBackgroundDataUrl(dataUrl, context = {}) {
    const source = inspectPngDataUrl(dataUrl, {
      code: 'AIFX_RMBG_INPUT_INVALID',
      label: 'AIFX RMBG input',
    })
    const signal = context.signal || null
    throwIfAborted(signal)
    const bridge = executionBridge(context)
    const requestedTimeout = Number(context.timeoutMs)
    const timeoutMs = Number.isFinite(requestedTimeout)
      ? Math.max(1, Math.min(MAX_TIMEOUT_MS, Math.round(requestedTimeout)))
      : DEFAULT_TIMEOUT_MS
    const deadline = Date.now() + timeoutMs
    const requestedPollInterval = Number(context.pollIntervalMs)
    const pollIntervalMs = Number.isFinite(requestedPollInterval)
      ? Math.max(0, Math.min(5000, Math.round(requestedPollInterval)))
      : DEFAULT_POLL_INTERVAL_MS
    const onProgress = context.onProgress || context.progress
    const inputName = cleanText(context.fileName).replace(/[^\w.-]+/g, '_') || `novaflow_vfx_rmbg_${Date.now()}.png`
    const outputPrefix = cleanText(context.outputPrefix) || `NovaFlow_VFX_RMBG_${Date.now()}`
    const clientId = cleanText(context.clientId) || `novaflow_vfx_rmbg_${Date.now()}_${Math.random().toString(16).slice(2)}`

    emitProgress(onProgress, 'connect', 'Connecting to NovaFlow AI Runtime', 0.03)
    try {
      const baseUrl = await bridgeCall(
        bridge,
        () => bridge.detectBaseUrl(),
        STAGE_TIMEOUTS.connect,
        'Connecting to NovaFlow AI Runtime timed out.',
        'AIFX_RMBG_RUNTIME_UNAVAILABLE',
        signal,
        deadline,
      )
      if (!cleanText(baseUrl)) {
        throw typedError('AIFX_RMBG_RUNTIME_UNAVAILABLE', 'NovaFlow AI Runtime is unavailable.')
      }

      emitProgress(onProgress, 'inspect', 'Resolving Runtime RMBG nodes', 0.08)
      const objectInfoResponse = await bridgeCall(
        bridge,
        () => bridge.requestJson(baseUrl, '/object_info', { method: 'GET' }),
        STAGE_TIMEOUTS.objectInfo,
        'Reading NovaFlow AI Runtime node definitions timed out.',
        'AIFX_RMBG_OBJECT_INFO_FAILED',
        signal,
        deadline,
      )
      if (!objectInfoResponse || objectInfoResponse.ok === false) {
        throw typedError(
          'AIFX_RMBG_OBJECT_INFO_FAILED',
          cleanText(objectInfoResponse?.error || objectInfoResponse?.raw) || 'Failed to read Runtime node definitions.',
        )
      }
      const objectInfo = responseData(objectInfoResponse)

      emitProgress(onProgress, 'upload', 'Uploading the generated AIFX sheet', 0.14)
      const upload = await bridgeCall(
        bridge,
        () => bridge.uploadDataUrl(baseUrl, inputName, dataUrl),
        STAGE_TIMEOUTS.upload,
        'Uploading the AIFX sheet for background removal timed out.',
        'AIFX_RMBG_UPLOAD_FAILED',
        signal,
        deadline,
      )
      const built = buildWorkflow(objectInfo, uploadedName(upload, inputName), outputPrefix, context)

      emitProgress(onProgress, 'validate', 'Validating the AIFX RMBG workflow', 0.2, {
        nodeType: built.nodeType,
        alphaStrategy: built.alphaStrategy,
      })
      await bridgeCall(
        bridge,
        () => bridge.validateWorkflowNodes(baseUrl, built.workflow),
        STAGE_TIMEOUTS.validate,
        'Validating the AIFX RMBG workflow timed out.',
        'AIFX_RMBG_WORKFLOW_INVALID',
        signal,
        deadline,
      )

      emitProgress(onProgress, 'submit', 'Submitting AIFX background removal', 0.25)
      const sent = await bridgeCall(
        bridge,
        () => bridge.requestJson(baseUrl, '/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, prompt: built.workflow }),
        }),
        STAGE_TIMEOUTS.prompt,
        'Submitting the AIFX RMBG workflow timed out.',
        'AIFX_RMBG_PROMPT_FAILED',
        signal,
        deadline,
      )
      const sentData = responseData(sent)
      const promptId = cleanText(sentData?.prompt_id || sentData?.data?.prompt_id)
      if (!sent || sent.ok === false || !promptId) {
        throw typedError(
          'AIFX_RMBG_PROMPT_REJECTED',
          cleanText(sent?.error || sent?.raw || (sent?.data ? JSON.stringify(sent.data) : '')) || 'NovaFlow AI Runtime did not return a prompt_id.',
        )
      }

      let files = []
      let emptyQueueHits = 0
      const submittedAt = Date.now()
      while (remainingMs(deadline) > 0) {
        throwIfAborted(signal)
        const history = await bridgeCall(
          bridge,
          () => bridge.requestJson(baseUrl, `/history/${encodeURIComponent(promptId)}`, { method: 'GET' }),
          STAGE_TIMEOUTS.history,
          'Reading the AIFX RMBG result timed out.',
          'AIFX_RMBG_HISTORY_FAILED',
          signal,
          deadline,
        )
        if (!history || history.ok === false) {
          throw typedError(
            'AIFX_RMBG_HISTORY_FAILED',
            cleanText(history?.error || history?.raw) || 'Failed to read the AIFX RMBG result.',
            { promptId },
          )
        }
        const item = historyItem(history, promptId)
        const executionError = cleanText(bridge.historyErrorMessage(item))
        if (executionError) {
          throw typedError('AIFX_RMBG_RUNTIME_EXECUTION_FAILED', executionError, { promptId })
        }
        files = (bridge.extractFiles(item) || []).filter((file) => /\.png$/i.test(cleanText(file?.filename || file?.name)))
        if (files.length) break

        const queue = await bridgeCall(
          bridge,
          () => bridge.readQueueState(baseUrl),
          STAGE_TIMEOUTS.queue,
          'Reading the AIFX RMBG queue timed out.',
          'AIFX_RMBG_QUEUE_FAILED',
          signal,
          deadline,
        )
        emptyQueueHits = queue?.empty ? emptyQueueHits + 1 : 0
        if (emptyQueueHits >= 4 && Date.now() - submittedAt >= 2000) {
          throw typedError(
            'AIFX_RMBG_RESULT_MISSING',
            'The Runtime queue finished without a transparent PNG output.',
            { promptId },
          )
        }
        emitProgress(onProgress, 'running', 'Removing the generated background', 0.3, { promptId })
        await wait(pollIntervalMs, signal, deadline)
      }
      if (!files.length) throw timeoutError('AIFX background removal exceeded its bounded timeout.', { promptId, hardTimeout: true })

      const file = files[0]
      emitProgress(onProgress, 'download', 'Downloading transparent AIFX PNG', 0.92, { promptId })
      const blob = await bridgeCall(
        bridge,
        () => bridge.fetchBlob(baseUrl, resultFileUrl(file)),
        STAGE_TIMEOUTS.download,
        'Downloading the transparent AIFX PNG timed out.',
        'AIFX_RMBG_DOWNLOAD_FAILED',
        signal,
        deadline,
      )
      if (!blob) throw typedError('AIFX_RMBG_DOWNLOAD_FAILED', 'NovaFlow AI Runtime returned no PNG data.', { promptId })
      const outputDataUrl = await bridgeCall(
        bridge,
        () => bridge.blobToDataUrl(blob),
        STAGE_TIMEOUTS.download,
        'Decoding the transparent AIFX PNG timed out.',
        'AIFX_RMBG_DOWNLOAD_FAILED',
        signal,
        deadline,
      )
      const output = inspectPngDataUrl(outputDataUrl, {
        code: 'AIFX_RMBG_OUTPUT_INVALID',
        label: 'AIFX RMBG output',
      })
      if (output.width !== source.width || output.height !== source.height) {
        throw typedError(
          'AIFX_RMBG_OUTPUT_SIZE_MISMATCH',
          `Runtime RMBG changed the image dimensions from ${source.width}x${source.height} to ${output.width}x${output.height}.`,
          { expected: source, actual: output, promptId },
        )
      }
      if (!output.hasAlphaChannel) {
        throw typedError(
          'AIFX_RMBG_OUTPUT_ALPHA_MISSING',
          'Runtime RMBG returned a PNG without an alpha channel.',
          { output, promptId },
        )
      }
      let alphaStats = null
      try {
        const remaining = remainingMs(deadline)
        if (remaining <= 0) throw timeoutError('', { promptId, hardTimeout: true })
        alphaStats = await raceAbortTimeout(
          inspectAlphaPixels(outputDataUrl, context),
          signal,
          remaining,
          'Inspecting the transparent AIFX PNG timed out.',
        )
      } catch (error) {
        if (error?.name === 'NovaFlowAifxRmbgError' || error?.name === 'AbortError') throw error
        throw typedError('AIFX_RMBG_OUTPUT_INVALID', cleanText(error?.message || error) || 'Failed to inspect PNG alpha.', {
          cause: error,
          promptId,
        })
      }
      if (alphaStats && Number(alphaStats.alphaMin) >= 255) {
        throw typedError(
          'AIFX_RMBG_OUTPUT_ALPHA_MISSING',
          'Runtime RMBG returned a fully opaque PNG instead of a transparent asset.',
          { output, alphaStats, promptId },
        )
      }
      if (alphaStats && Number(alphaStats.alphaMax) <= 0) {
        throw typedError(
          'AIFX_RMBG_OUTPUT_EMPTY',
          'Runtime RMBG returned a fully transparent PNG with no visible foreground.',
          { output, alphaStats, promptId },
        )
      }
      emitProgress(onProgress, 'complete', 'Transparent AIFX PNG is ready', 1, {
        promptId,
        width: output.width,
        height: output.height,
        nodeType: built.nodeType,
        alphaStrategy: built.alphaStrategy,
        alphaStats,
      })
      return outputDataUrl
    } catch (error) {
      const finalError = signal?.aborted
        ? abortError(signal.reason || error)
        : error?.name === 'NovaFlowAifxRmbgError' || error?.name === 'AbortError'
          ? error
          : typedError('AIFX_RMBG_FAILED', cleanText(error?.message || error) || 'AIFX background removal failed.', { cause: error })
      emitProgress(onProgress, finalError?.name === 'AbortError' ? 'cancelled' : 'error', finalError.message, 0, {
        error: finalError,
      })
      throw finalError
    }
  }

  return Object.freeze({
    VERSION,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    STAGE_TIMEOUTS,
    inspectPngDataUrl,
    buildWorkflow,
    removeBackgroundDataUrl,
  })
})
