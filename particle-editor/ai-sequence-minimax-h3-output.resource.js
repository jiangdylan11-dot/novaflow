(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceMiniMaxH3OutputResource = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const RUNTIME_KIND = 'minimax_h3_local'
  const LOCAL_TYPE = 'local'
  const OUTPUT_TYPE = 'output'
  const ENDPOINT_PATH = '/__ai_sequence_h3_output'
  const MAX_ITEMS = 30
  const MAX_MEDIA_DURATION_SEC = 60
  const MAX_GENERATION_ELAPSED_SEC = 24 * 60 * 60

  function text(value) {
    return value == null ? '' : String(value).trim()
  }

  function safeFileName(value) {
    const name = text(value)
    if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
      throw new TypeError('MiniMax H3 output fileName is invalid')
    }
    if (!/\.(?:mp4|webm)$/i.test(name)) {
      throw new TypeError('MiniMax H3 output must be an MP4 or WebM video')
    }
    return name
  }

  function safePromptId(value) {
    const promptId = text(value)
    if (!promptId || promptId.length > 256 || /[\0\r\n]/.test(promptId)) {
      throw new TypeError('MiniMax H3 output promptId is invalid')
    }
    return promptId
  }

  function safeSubfolder(value) {
    const subfolder = text(value).replace(/\\/g, '/')
    if (!subfolder) return ''
    if (
      subfolder.startsWith('/') ||
      /^[a-z]:/i.test(subfolder) ||
      subfolder.split('/').some((part) => !part || part === '.' || part === '..') ||
      /[\0\r\n]/.test(subfolder)
    ) {
      throw new TypeError('MiniMax H3 output subfolder is invalid')
    }
    return subfolder
  }

  function optionalMetric(value, label, minimum, maximum, minimumInclusive) {
    if (value == null) return undefined
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (minimumInclusive ? value < minimum : value <= minimum) ||
      value > maximum
    ) {
      throw new TypeError(`MiniMax H3 output ${label} is invalid`)
    }
    return value
  }

  function optionalTimingFields(value) {
    const mediaDurationSec = optionalMetric(
      value?.mediaDurationSec,
      'mediaDurationSec',
      0,
      MAX_MEDIA_DURATION_SEC,
      false,
    )
    const generationElapsedSec = optionalMetric(
      value?.generationElapsedSec,
      'generationElapsedSec',
      0,
      MAX_GENERATION_ELAPSED_SEC,
      true,
    )
    return {
      ...(mediaDurationSec === undefined ? {} : { mediaDurationSec }),
      ...(generationElapsedSec === undefined ? {} : { generationElapsedSec }),
    }
  }

  function extractHistoryTiming(historyEntry) {
    const messages = Array.isArray(historyEntry?.status?.messages)
      ? historyEntry.status.messages
      : []
    let startedAt = null
    let completedAt = null
    for (const message of messages) {
      if (!Array.isArray(message) || message.length < 2) continue
      const eventName = text(message[0]).toLowerCase()
      const timestamp = message[1] && typeof message[1] === 'object'
        ? Number(message[1].timestamp)
        : NaN
      if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > Number.MAX_SAFE_INTEGER) continue
      if (eventName === 'execution_start' && startedAt == null) startedAt = timestamp
      if (eventName === 'execution_success' && startedAt != null && timestamp >= startedAt) {
        completedAt = timestamp
        break
      }
    }
    const elapsed = startedAt == null || completedAt == null
      ? null
      : Math.round(completedAt - startedAt) / 1000
    const generationElapsedSec = elapsed != null && elapsed <= MAX_GENERATION_ELAPSED_SEC
      ? elapsed
      : null
    return Object.freeze({ generationElapsedSec })
  }

  function normalizePublishDescriptor(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('MiniMax H3 output descriptor must be an object')
    }
    const type = text(value.type).toLowerCase()
    if (type !== OUTPUT_TYPE) throw new TypeError('MiniMax H3 output descriptor type must be output')
    return Object.freeze({
      promptId: safePromptId(value.promptId),
      filename: safeFileName(value.filename || value.fileName),
      subfolder: safeSubfolder(value.subfolder),
      type: OUTPUT_TYPE,
      ...optionalTimingFields(value),
    })
  }

  function endpointFor(baseUrl) {
    const base = text(baseUrl).replace(/\/+$/, '')
    return base ? `${base}${ENDPOINT_PATH}` : ENDPOINT_PATH
  }

  function allowedViewOrigin(baseUrl) {
    const locationHref = text(root?.location?.href)
    const endpoint = endpointFor(baseUrl)
    try {
      if (locationHref) return new root.URL(endpoint, locationHref).origin
      if (/^https?:\/\//i.test(endpoint)) return new root.URL(endpoint).origin
    } catch {}
    return ''
  }

  function normalizeViewUrl(value, baseUrl) {
    const raw = text(value)
    if (!raw || /[\0\r\n]/.test(raw)) {
      throw new TypeError('MiniMax H3 preview output viewUrl is invalid')
    }
    const locationHref = text(root?.location?.href)
    const fallbackBase = /^https?:\/\//i.test(endpointFor(baseUrl)) ? endpointFor(baseUrl) : ''
    let parsed
    try {
      parsed = new root.URL(raw, locationHref || fallbackBase || 'http://novaflow.invalid/')
    } catch {
      throw new TypeError('MiniMax H3 preview output viewUrl is invalid')
    }
    const expectedOrigin = allowedViewOrigin(baseUrl)
    if (/^https?:\/\//i.test(raw) && (!expectedOrigin || parsed.origin !== expectedOrigin)) {
      throw new TypeError('MiniMax H3 preview output viewUrl must be same-origin')
    }
    if (!(parsed.pathname === ENDPOINT_PATH || parsed.pathname.startsWith(`${ENDPOINT_PATH}/`))) {
      throw new TypeError('MiniMax H3 preview output viewUrl is outside the output endpoint')
    }
    if (parsed.username || parsed.password || parsed.hash) {
      throw new TypeError('MiniMax H3 preview output viewUrl is invalid')
    }
    return raw
  }

  function mimeFor(fileName, value) {
    const mime = text(value).toLowerCase()
    if (mime && mime !== 'video/mp4' && mime !== 'video/webm') {
      throw new TypeError('MiniMax H3 output mimeType is invalid')
    }
    return mime || (/\.webm$/i.test(fileName) ? 'video/webm' : 'video/mp4')
  }

  function normalizeBytes(value) {
    if (value == null) return null
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    if (value && value.type === 'Buffer' && Array.isArray(value.data)) return new Uint8Array(value.data)
    if (Array.isArray(value)) return new Uint8Array(value)
    return null
  }

  function identityOf(item) {
    return item.id.toLowerCase()
  }

  function createOutputResource(config = {}) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError('MiniMax H3 output resource config must be an object')
    }

    let items = Object.freeze([])
    let operation = Promise.resolve()
    const listeners = new Set()
    const ownedObjectUrls = new Set()
    const explicitElectronApi = config.electronApi
    const explicitFetch = config.fetchImpl
    const baseUrl = text(config.baseUrl)

    function currentElectronApi() {
      if (explicitElectronApi && typeof explicitElectronApi === 'object') return explicitElectronApi
      return root && typeof root.electronAPI === 'object' ? root.electronAPI : null
    }

    function currentFetch() {
      if (typeof explicitFetch === 'function') return explicitFetch
      return root && typeof root.fetch === 'function' ? root.fetch.bind(root) : null
    }

    function notify() {
      for (const listener of Array.from(listeners)) {
        try { listener(items) } catch {}
      }
    }

    function replaceItems(nextItems) {
      const retainedUrls = new Set(nextItems.map((item) => item.objectUrl).filter(Boolean))
      for (const objectUrl of Array.from(ownedObjectUrls)) {
        if (retainedUrls.has(objectUrl)) continue
        try { root?.URL?.revokeObjectURL?.(objectUrl) } catch {}
        ownedObjectUrls.delete(objectUrl)
      }
      items = Object.freeze(nextItems.slice(0, MAX_ITEMS))
      notify()
      return items
    }

    function dedupe(nextItems) {
      const seen = new Set()
      const output = []
      for (const item of nextItems) {
        const identity = identityOf(item)
        if (seen.has(identity)) continue
        seen.add(identity)
        output.push(item)
        if (output.length === MAX_ITEMS) break
      }
      return output
    }

    function releaseCreated(createdUrls) {
      for (const objectUrl of createdUrls) {
        try { root?.URL?.revokeObjectURL?.(objectUrl) } catch {}
        ownedObjectUrls.delete(objectUrl)
      }
    }

    async function objectUrlFromLocalPath(api, localPath, mimeType, createdUrls) {
      if (typeof api?.aiSeqReadTempFile !== 'function') {
        throw new Error('MiniMax H3 local output playback bridge is unavailable')
      }
      const response = await api.aiSeqReadTempFile({ path: localPath })
      const bytes = normalizeBytes(response?.bytes)
      if (!response?.ok || !bytes || bytes.byteLength === 0) {
        throw new Error(text(response?.error) || 'MiniMax H3 local output file could not be read')
      }
      const resolvedMime = mimeFor(localPath, response?.mimeType || mimeType)
      if (typeof root?.Blob !== 'function' || typeof root?.URL?.createObjectURL !== 'function') {
        throw new Error('MiniMax H3 local output object URL service is unavailable')
      }
      const objectUrl = root.URL.createObjectURL(new root.Blob([bytes], { type: resolvedMime }))
      ownedObjectUrls.add(objectUrl)
      createdUrls.push(objectUrl)
      return objectUrl
    }

    async function normalizeItem(value, transport, api, createdUrls) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('MiniMax H3 output item must be an object')
      }
      if (text(value.runtimeKind) !== RUNTIME_KIND) {
        throw new TypeError('MiniMax H3 output runtimeKind is invalid')
      }
      if (text(value.type).toLowerCase() !== LOCAL_TYPE) {
        throw new TypeError('MiniMax H3 output item type must be local')
      }
      const fileName = safeFileName(value.fileName || value.filename)
      const promptId = safePromptId(value.promptId)
      const localPath = text(value.localPath)
      if (localPath && /[\0\r\n]/.test(localPath)) {
        throw new TypeError('MiniMax H3 output localPath is invalid')
      }
      const mimeType = mimeFor(fileName, value.mimeType)
      let objectUrl = ''
      if (transport === 'ipc') {
        if (!localPath) throw new TypeError('MiniMax H3 desktop output localPath is required')
        objectUrl = await objectUrlFromLocalPath(api, localPath, mimeType, createdUrls)
      } else {
        objectUrl = normalizeViewUrl(value.viewUrl, baseUrl)
      }
      const createdAtValue = Number(value.createdAt)
      const createdAt = Number.isFinite(createdAtValue) && createdAtValue > 0 ? createdAtValue : 0
      const id = text(value.id) || `${RUNTIME_KIND}:${promptId}:${fileName}`
      if (id.length > 2048 || /[\0\r\n]/.test(id)) {
        throw new TypeError('MiniMax H3 output id is invalid')
      }
      return Object.freeze({
        id,
        runtimeKind: RUNTIME_KIND,
        type: LOCAL_TYPE,
        localPath: transport === 'ipc' ? localPath : '',
        fileName,
        filename: fileName,
        promptId,
        subfolder: '',
        objectUrl,
        mimeType,
        sourceKind: text(value.sourceKind) || 'minimax_h3_output',
        createdAt,
        ...optionalTimingFields(value),
      })
    }

    async function httpRequest(action, payload) {
      const fetcher = currentFetch()
      if (!fetcher) throw new Error('MiniMax H3 output bridge is unavailable')
      const response = await fetcher(endpointFor(baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      })
      if (!response || response.ok === false || typeof response.json !== 'function') {
        throw new Error(`MiniMax H3 output ${action} request failed`)
      }
      const result = await response.json()
      if (!result?.ok) throw new Error(text(result?.error) || `MiniMax H3 output ${action} request failed`)
      return result
    }

    function enqueue(work) {
      const pending = operation.catch(() => {}).then(work)
      operation = pending
      return pending
    }

    function publish(descriptor) {
      const payload = normalizePublishDescriptor(descriptor)
      return enqueue(async () => {
        const api = currentElectronApi()
        const useIpc = typeof api?.minimaxH3OutputPublish === 'function'
        const response = useIpc
          ? await api.minimaxH3OutputPublish(payload)
          : await httpRequest('publish', payload)
        if (!response?.ok) throw new Error(text(response?.error) || 'MiniMax H3 output publish failed')
        const createdUrls = []
        try {
          const transport = useIpc && response.preview !== true ? 'ipc' : 'http'
          const item = await normalizeItem(response.item, transport, api, createdUrls)
          replaceItems(dedupe([item, ...items]))
          return item
        } catch (error) {
          releaseCreated(createdUrls)
          throw error
        }
      })
    }

    function list() {
      return enqueue(async () => {
        const api = currentElectronApi()
        const useIpc = typeof api?.minimaxH3OutputList === 'function'
        const response = useIpc
          ? await api.minimaxH3OutputList({})
          : await httpRequest('list', {})
        if (!response?.ok || !Array.isArray(response.items)) {
          throw new Error(text(response?.error) || 'MiniMax H3 output list failed')
        }
        const createdUrls = []
        try {
          const normalized = []
          const transport = useIpc && response.preview !== true ? 'ipc' : 'http'
          for (const value of response.items) {
            normalized.push(await normalizeItem(value, transport, api, createdUrls))
          }
          normalized.sort((left, right) => right.createdAt - left.createdAt)
          return replaceItems(dedupe(normalized))
        } catch (error) {
          releaseCreated(createdUrls)
          throw error
        }
      })
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('MiniMax H3 output listener must be a function')
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    function dispose() {
      replaceItems([])
      listeners.clear()
    }

    return Object.freeze({
      publish,
      list,
      getSnapshot: () => items,
      subscribe,
      dispose,
    })
  }

  const resource = createOutputResource()

  return Object.freeze({
    RUNTIME_KIND,
    ENDPOINT_PATH,
    MAX_ITEMS,
    extractHistoryTiming,
    normalizePublishDescriptor,
    createOutputResource,
    resource,
    publish: resource.publish,
    list: resource.list,
    getSnapshot: resource.getSnapshot,
    subscribe: resource.subscribe,
    dispose: resource.dispose,
  })
})
