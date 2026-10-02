(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceVideoMergeResource = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const SCHEMA_VERSION = 1
  const MAX_LAYERS = 2
  const MIN_CANVAS_SIZE = 16
  const MAX_CANVAS_SIZE = 8192
  const SUPPORTED_EXTENSIONS = Object.freeze(['mp4', 'webm'])
  const SUPPORTED_MIME_TYPES = Object.freeze(['video/mp4', 'video/webm'])

  function finite(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value))
  }

  function evenCanvasDimension(value) {
    const normalized = clamp(Math.round(finite(value, MIN_CANVAS_SIZE)), MIN_CANVAS_SIZE, MAX_CANVAS_SIZE)
    return Math.min(MAX_CANVAS_SIZE, normalized % 2 ? normalized + 1 : normalized)
  }

  function normalizeText(value, fallback) {
    const text = String(value == null ? '' : value).trim()
    return text || fallback
  }

  function extensionOf(name) {
    const match = normalizeText(name, '').toLowerCase().match(/\.([a-z0-9]+)$/)
    return match ? match[1] : ''
  }

  function isSupportedVideo(value) {
    if (!value || typeof value !== 'object') return false
    const mimeType = normalizeText(value.type || value.mimeType, '').toLowerCase()
    const extension = extensionOf(value.name || value.fileName || value.path)
    return SUPPORTED_MIME_TYPES.includes(mimeType) || SUPPORTED_EXTENSIONS.includes(extension)
  }

  function assertSupportedVideo(value) {
    if (!isSupportedVideo(value)) {
      const error = new TypeError('视频合并一期仅支持 H.264 MP4 与 VP8/VP9 WebM')
      error.code = 'video_merge_unsupported_input'
      throw error
    }
    return value
  }

  function cloneSerializable(value) {
    if (Array.isArray(value)) return value.map(cloneSerializable)
    if (!value || typeof value !== 'object') return value
    const output = {}
    Object.keys(value).forEach(function (key) {
      const item = value[key]
      if (typeof item === 'function' || typeof item === 'undefined' || key === 'file') return
      output[key] = cloneSerializable(item)
    })
    return output
  }

  function createLayer(id, index) {
    return {
      id,
      slot: index,
      title: `视频 ${index + 1}`,
      visible: true,
      source: null,
      transform: { centerX: 0, centerY: 0, scale: 1 },
      maskRevision: 0,
    }
  }

  function normalizeProbe(value) {
    const source = value && typeof value === 'object'
      ? (value.probe && typeof value.probe === 'object' ? value.probe : value)
      : {}
    const codedWidth = clamp(Math.round(finite(source.codedWidth ?? source.width, 0)), 0, MAX_CANVAS_SIZE)
    const codedHeight = clamp(Math.round(finite(source.codedHeight ?? source.height, 0)), 0, MAX_CANVAS_SIZE)
    const rotation = ((Math.round(finite(source.rotationDeg ?? source.rotation, 0)) % 360) + 360) % 360
    const rotated = rotation === 90 || rotation === 270
    const displayWidth = clamp(Math.round(finite(
      source.displayWidth,
      rotated ? codedHeight : codedWidth,
    )), 0, MAX_CANVAS_SIZE)
    const displayHeight = clamp(Math.round(finite(
      source.displayHeight,
      rotated ? codedWidth : codedHeight,
    )), 0, MAX_CANVAS_SIZE)
    return Object.freeze({
      width: codedWidth,
      height: codedHeight,
      displayWidth,
      displayHeight,
      durationSec: clamp(finite(source.durationSec ?? source.duration, 0), 0, 24 * 60 * 60),
      fps: clamp(finite(source.fps ?? source.avgFps, 0), 0, 240),
      rotationDeg: rotation,
      hasAudio: source.hasAudio === true || Number(source.audioStreamCount) > 0,
      hasAlpha: source.hasAlpha === true || String(source.alphaMode || '') === '1',
      codec: normalizeText(source.codec ?? source.codecName, ''),
      pixelFormat: normalizeText(source.pixelFormat ?? source.pixFmt, ''),
    })
  }

  function pathToFileUrl(filePath) {
    const value = normalizeText(filePath, '')
    if (!value) return ''
    if (/^(?:blob:|data:|https?:|file:)/i.test(value)) return value
    const normalized = value.replace(/\\/g, '/')
    const prefix = normalized.startsWith('/') ? 'file://' : 'file:///'
    return prefix + normalized.split('/').map(function (segment, index) {
      return index === 0 && /^[a-z]:$/i.test(segment) ? segment : encodeURIComponent(segment)
    }).join('/')
  }

  function probeClientVideo(rootValue, objectUrl, options) {
    const config = options && typeof options === 'object' ? options : {}
    const sourceUrl = normalizeText(objectUrl, '')
    if (!sourceUrl) return Promise.reject(new Error('video_merge_preview_source_required'))
    return new Promise(function (resolve, reject) {
      const video = rootValue?.document?.createElement?.('video')
      if (!video || typeof video.addEventListener !== 'function') {
        reject(new Error('video_merge_client_probe_unavailable'))
        return
      }
      const schedule = typeof rootValue?.setTimeout === 'function'
        ? rootValue.setTimeout.bind(rootValue)
        : setTimeout
      const cancel = typeof rootValue?.clearTimeout === 'function'
        ? rootValue.clearTimeout.bind(rootValue)
        : clearTimeout
      const timeoutMs = clamp(Math.round(finite(config.timeoutMs, 10000)), 1000, 60000)
      let settled = false
      let timer = null
      const cleanup = function () {
        if (timer != null) cancel(timer)
        try { video.removeEventListener('loadedmetadata', onLoadedMetadata) } catch (_) {}
        try { video.removeEventListener('error', onError) } catch (_) {}
        try { video.pause?.() } catch (_) {}
        try {
          video.removeAttribute?.('src')
          video.load?.()
        } catch (_) {}
      }
      const settle = function (error, probe) {
        if (settled) return
        settled = true
        cleanup()
        if (error) reject(error)
        else resolve(probe)
      }
      const onLoadedMetadata = function () {
        const width = Math.round(finite(video.videoWidth, 0))
        const height = Math.round(finite(video.videoHeight, 0))
        const durationSec = finite(video.duration, 0)
        if (!width || !height || durationSec <= 0) {
          settle(new Error('video_merge_source_metadata_invalid'))
          return
        }
        settle(null, {
          width,
          height,
          displayWidth: width,
          displayHeight: height,
          durationSec,
          fps: Number(config.fps) === 60 ? 60 : 30,
          rotationDeg: 0,
          hasAudio: false,
          hasAlpha: false,
          codec: '',
          pixelFormat: '',
        })
      }
      const onError = function () { settle(new Error('video_merge_client_probe_failed')) }
      video.addEventListener('loadedmetadata', onLoadedMetadata)
      video.addEventListener('error', onError)
      timer = schedule(function () { settle(new Error('video_merge_client_probe_timeout')) }, timeoutMs)
      try {
        video.preload = 'metadata'
        video.muted = true
        video.playsInline = true
        video.src = sourceUrl
        video.load?.()
      } catch (_) {
        settle(new Error('video_merge_client_probe_failed'))
      }
    })
  }

  function createProjectStore(options) {
    const config = options && typeof options === 'object' ? options : {}
    const listeners = new Set()
    const importVersions = new Map()
    const pendingImports = new Map()
    const createObjectUrl = typeof config.createObjectUrl === 'function'
      ? config.createObjectUrl
      : function (file) { return root?.URL?.createObjectURL?.(file) || '' }
    const revokeObjectUrl = typeof config.revokeObjectUrl === 'function'
      ? config.revokeObjectUrl
      : function (url) { try { root?.URL?.revokeObjectURL?.(url) } catch (_) {} }
    const getPathForFile = typeof config.getPathForFile === 'function'
      ? config.getPathForFile
      : function (file) { return root?.electronAPI?.getPathForFile?.(file) || file?.path || '' }
    const hasRegisterSource = typeof config.registerSource === 'function'
    const registerSource = hasRegisterSource ? config.registerSource : null
    const probeClientSource = typeof config.probeClientSource === 'function'
      ? config.probeClientSource
      : function (payload) {
          return probeClientVideo(root, payload?.objectUrl, {
            fps: payload?.fps,
            timeoutMs: config.clientProbeTimeoutMs,
          })
        }
    const releaseRegisteredSourceApi = typeof config.releaseSource === 'function'
      ? config.releaseSource
      : async function () { return { ok: true, released: false } }

    let disposed = false
    let revision = 0
    let state = {
      schemaVersion: SCHEMA_VERSION,
      projectId: normalizeText(config.projectId, `video-merge-${Date.now()}`),
      canvas: {
        width: evenCanvasDimension(config.width || 1920),
        height: evenCanvasDimension(config.height || 1080),
        fps: config.fps === 60 ? 60 : 30,
        initializedFromSource: false,
      },
      layers: [createLayer('video-layer-bottom', 0), createLayer('video-layer-top', 1)],
      selectedLayerId: 'video-layer-top',
      timeSec: 0,
      playing: false,
      format: config.format === 'mp4' ? 'mp4' : 'webm',
      audioSourceLayerId: null,
      importingLayerId: null,
      importingLayerIds: [],
      importingCount: 0,
      message: '',
      error: '',
      revision,
    }

    function assertActive() {
      if (disposed) throw new Error('video_merge_resource_destroyed')
    }

    function importStatus(preferredLayerId) {
      const layerIds = Array.from(new Set(pendingImports.values()))
      const preferred = String(preferredLayerId || '')
      return {
        importingLayerId: preferred && layerIds.includes(preferred) ? preferred : (layerIds[layerIds.length - 1] || null),
        importingLayerIds: layerIds,
        importingCount: pendingImports.size,
      }
    }

    function layerIndex(layerId) {
      return state.layers.findIndex(function (layer) { return layer.id === String(layerId || '') })
    }

    function layerById(layerId) {
      const index = layerIndex(layerId)
      return index >= 0 ? state.layers[index] : null
    }

    function snapshot() {
      return cloneSerializable(state)
    }

    function emit(reason) {
      revision += 1
      state.revision = revision
      const next = snapshot()
      listeners.forEach(function (listener) {
        try { listener(next, reason || 'update') } catch (_) {}
      })
      return next
    }

    function patchState(patch, reason) {
      assertActive()
      state = Object.assign({}, state, patch || {})
      return emit(reason)
    }

    function patchLayer(layerId, patch, reason) {
      assertActive()
      const index = layerIndex(layerId)
      if (index < 0) return false
      const layers = state.layers.slice()
      layers[index] = Object.assign({}, layers[index], patch || {})
      state = Object.assign({}, state, { layers })
      emit(reason || 'layer-patch')
      return true
    }

    function projectDurationSec() {
      return state.layers.reduce(function (maximum, layer) {
        return Math.max(maximum, finite(layer?.source?.probe?.durationSec, 0))
      }, 0)
    }

    function defaultAudioLayerId(layers) {
      const list = Array.isArray(layers) ? layers : state.layers
      const bottom = list[0]
      const top = list[1]
      if (bottom?.source?.probe?.hasAudio) return bottom.id
      if (top?.source?.probe?.hasAudio) return top.id
      return null
    }

    function containScale(probe, canvas) {
      const width = Math.max(1, finite(probe?.displayWidth, 1))
      const height = Math.max(1, finite(probe?.displayHeight, 1))
      return clamp(Math.min(finite(canvas?.width, 1) / width, finite(canvas?.height, 1) / height), 0.01, 32)
    }

    function releaseObjectUrl(source) {
      if (!source || !source.ownedObjectUrl || !source.objectUrl) return
      revokeObjectUrl(source.objectUrl)
    }

    async function releaseRegisteredSource(source) {
      const sourceId = normalizeText(source?.sourceId || source, '')
      if (!sourceId) return false
      try {
        await releaseRegisteredSourceApi(sourceId)
        return true
      } catch (_) {
        return false
      }
    }

    function sourceName(fileLike, fallback) {
      return normalizeText(fileLike?.name || fileLike?.fileName, fallback)
    }

    async function importDescriptor(layerId, descriptor) {
      assertActive()
      const layer = layerById(layerId)
      if (!layer) throw new Error('video_merge_layer_not_found')
      const importVersion = (importVersions.get(layer.id) || 0) + 1
      importVersions.set(layer.id, importVersion)
      const importToken = `${layer.id}:${importVersion}`
      const item = descriptor && typeof descriptor === 'object' ? descriptor : {}
      assertSupportedVideo(item)
      const filePath = normalizeText(item.path || item.filePath || item.localPath, '')
      const fileLike = item.file && typeof item.file === 'object'
        ? item.file
        : (item.blob && typeof item.blob === 'object' ? item.blob : null)
      let objectUrl = normalizeText(item.objectUrl || item.url, '')
      let ownedObjectUrl = item.ownedObjectUrl === true

      pendingImports.set(importToken, layer.id)
      patchState(Object.assign(importStatus(layer.id), { message: `正在读取 ${sourceName(item, layer.title)}…`, error: '' }), 'source-import-start')
      let registeredSourceId = ''
      let registrationCommitted = false
      try {
        if (!objectUrl && fileLike) {
          objectUrl = normalizeText(createObjectUrl(fileLike), '')
          ownedObjectUrl = Boolean(objectUrl)
        }
        const previewObjectUrl = objectUrl || pathToFileUrl(filePath)
        const usesRegisteredSource = Boolean(hasRegisterSource && filePath)
        if (!usesRegisteredSource && !previewObjectUrl) {
          throw new Error('video_merge_preview_source_required')
        }
        let sourceRecord = null
        let registration = null
        if (usesRegisteredSource) {
          registration = await registerSource({
            layerId: layer.id,
            filePath,
            path: filePath,
            fileName: sourceName(item, layer.title),
            mimeType: normalizeText(item.type || item.mimeType, ''),
            alphaSourceConfirmed: extensionOf(item.name || item.fileName || filePath) === 'webm',
          })
          if (!registration || registration.ok === false) {
            throw new Error(registration?.error || 'video_merge_source_probe_failed')
          }
          sourceRecord = registration.source && typeof registration.source === 'object'
            ? registration.source
            : registration
          registeredSourceId = normalizeText(sourceRecord.sourceId || registration.sourceId, '')
        } else {
          sourceRecord = {
            sourceId: '',
            probe: await probeClientSource({
              layerId: layer.id,
              file: fileLike,
              fileName: sourceName(item, layer.title),
              mimeType: normalizeText(item.type || item.mimeType, ''),
              objectUrl: previewObjectUrl,
              fps: state.canvas.fps,
            }),
          }
          registration = sourceRecord
        }
        if (disposed || importVersions.get(layer.id) !== importVersion) {
          await releaseRegisteredSource(registeredSourceId)
          registeredSourceId = ''
          if (disposed) throw new Error('video_merge_resource_destroyed')
          throw new Error('video_merge_source_import_superseded')
        }
        const probe = normalizeProbe(sourceRecord.probe || registration.probe || sourceRecord.meta || registration.meta || sourceRecord)
        if (!probe.displayWidth || !probe.displayHeight || !probe.durationSec) {
          throw new Error('video_merge_source_metadata_invalid')
        }

        const firstSource = !state.layers.some(function (candidate) { return candidate.source })
        const canvas = firstSource || !state.canvas.initializedFromSource
          ? {
              width: evenCanvasDimension(probe.displayWidth),
              height: evenCanvasDimension(probe.displayHeight),
              fps: state.canvas.fps,
              initializedFromSource: true,
            }
          : state.canvas
        const source = Object.freeze({
          sourceId: usesRegisteredSource ? normalizeText(registeredSourceId, filePath) : '',
          filePath,
          fileName: sourceName(item, layer.title),
          mimeType: normalizeText(item.type || item.mimeType, ''),
          objectUrl: previewObjectUrl,
          ownedObjectUrl,
          exportReady: usesRegisteredSource,
          previewOnly: !usesRegisteredSource,
          probe,
        })
        const previousSource = layer.source
        const layers = state.layers.map(function (candidate) {
          if (candidate.id !== layer.id) return candidate
          return Object.assign({}, candidate, {
            title: source.fileName,
            source,
            transform: {
              centerX: canvas.width / 2,
              centerY: canvas.height / 2,
              scale: containScale(probe, canvas),
            },
            maskRevision: 0,
          })
        })
        const selectedAudioLayer = layers.find(function (candidate) {
          return candidate.id === state.audioSourceLayerId && candidate.source?.probe?.hasAudio
        })
        pendingImports.delete(importToken)
        state = Object.assign({}, state, {
          canvas,
          layers,
          selectedLayerId: layer.id,
          ...importStatus(),
          audioSourceLayerId: selectedAudioLayer ? selectedAudioLayer.id : defaultAudioLayerId(layers),
          message: `${source.fileName} 已载入`,
          error: '',
        })
        registrationCommitted = true
        emit('source-import-complete')
        void releaseRegisteredSource(previousSource)
        releaseObjectUrl(previousSource)
        return source
      } catch (error) {
        pendingImports.delete(importToken)
        if (registeredSourceId && !registrationCommitted) void releaseRegisteredSource(registeredSourceId)
        if (ownedObjectUrl && objectUrl && !registrationCommitted) revokeObjectUrl(objectUrl)
        if (!disposed && importVersions.get(layer.id) === importVersion) {
          patchState(Object.assign(importStatus(), {
            error: String(error?.message || error),
            message: '',
          }), 'source-import-error')
        } else if (!disposed) {
          patchState(importStatus(), 'source-import-settle')
        }
        throw error
      }
    }

    async function importFile(layerId, file) {
      assertSupportedVideo(file)
      const filePath = normalizeText(getPathForFile(file), '')
      return importDescriptor(layerId, {
        file,
        name: file.name,
        type: file.type,
        path: filePath,
      })
    }

    function removeSource(layerId) {
      const layer = layerById(layerId)
      if (!layer) return false
      importVersions.set(layer.id, (importVersions.get(layer.id) || 0) + 1)
      void releaseRegisteredSource(layer.source)
      releaseObjectUrl(layer.source)
      const layers = state.layers.map(function (candidate) {
        return candidate.id === layer.id
          ? Object.assign({}, candidate, {
              title: `视频 ${candidate.slot + 1}`,
              source: null,
              transform: { centerX: state.canvas.width / 2, centerY: state.canvas.height / 2, scale: 1 },
              maskRevision: 0,
            })
          : candidate
      })
      state = Object.assign({}, state, {
        layers,
        ...importStatus(),
        playing: false,
        timeSec: Math.min(state.timeSec, layers.reduce(function (maximum, candidate) {
          return Math.max(maximum, finite(candidate?.source?.probe?.durationSec, 0))
        }, 0)),
        audioSourceLayerId: defaultAudioLayerId(layers),
      })
      emit('source-remove')
      return true
    }

    function selectLayer(layerId) {
      if (!layerById(layerId)) return false
      patchState({ selectedLayerId: String(layerId) }, 'layer-select')
      return true
    }

    function toggleVisibility(layerId) {
      const layer = layerById(layerId)
      return layer ? patchLayer(layer.id, { visible: !layer.visible }, 'layer-visibility') : false
    }

    function moveLayer(layerId, direction) {
      const index = layerIndex(layerId)
      const target = index + (Number(direction) > 0 ? 1 : -1)
      if (index < 0 || target < 0 || target >= state.layers.length) return false
      const layers = state.layers.slice()
      const moved = layers.splice(index, 1)[0]
      layers.splice(target, 0, moved)
      state = Object.assign({}, state, { layers })
      emit('layer-reorder')
      return true
    }

    function patchTransform(layerId, patch) {
      const layer = layerById(layerId)
      if (!layer?.source) return false
      const next = Object.assign({}, layer.transform, patch || {})
      next.centerX = clamp(finite(next.centerX, layer.transform.centerX), -MAX_CANVAS_SIZE * 2, MAX_CANVAS_SIZE * 3)
      next.centerY = clamp(finite(next.centerY, layer.transform.centerY), -MAX_CANVAS_SIZE * 2, MAX_CANVAS_SIZE * 3)
      const maxScale = Math.max(0.01, Math.min(
        32,
        MAX_CANVAS_SIZE / Math.max(1, finite(layer.source.probe?.displayWidth, 1)),
        MAX_CANVAS_SIZE / Math.max(1, finite(layer.source.probe?.displayHeight, 1)),
      ))
      next.scale = clamp(finite(next.scale, layer.transform.scale), 0.01, maxScale)
      return patchLayer(layer.id, { transform: next }, 'layer-transform')
    }

    function fitLayer(layerId) {
      const layer = layerById(layerId)
      if (!layer?.source) return false
      return patchTransform(layer.id, {
        centerX: state.canvas.width / 2,
        centerY: state.canvas.height / 2,
        scale: containScale(layer.source.probe, state.canvas),
      })
    }

    function setMaskRevision(layerId, maskRevision) {
      const layer = layerById(layerId)
      if (!layer) return false
      return patchLayer(layer.id, { maskRevision: Math.max(0, Math.round(finite(maskRevision, 0))) }, 'mask-revision')
    }

    function setTime(timeSec) {
      const duration = projectDurationSec()
      const next = clamp(finite(timeSec, 0), 0, Math.max(0, duration))
      if (Math.abs(next - state.timeSec) < 0.0005) return snapshot()
      return patchState({ timeSec: next }, 'timeline-seek')
    }

    function setPlaying(playing) {
      return patchState({ playing: Boolean(playing) }, 'timeline-playing')
    }

    function setFps(fps) {
      const canvas = Object.assign({}, state.canvas, { fps: Number(fps) === 60 ? 60 : 30 })
      return patchState({ canvas }, 'output-fps')
    }

    function setFormat(format) {
      return patchState({ format: String(format) === 'webm' ? 'webm' : 'mp4' }, 'output-format')
    }

    function setAudioSource(layerId) {
      if (layerId == null || layerId === '' || layerId === 'none') {
        return patchState({ audioSourceLayerId: null }, 'audio-source')
      }
      const layer = layerById(layerId)
      if (!layer?.source?.probe?.hasAudio) return false
      patchState({ audioSourceLayerId: layer.id }, 'audio-source')
      return true
    }

    function setMessage(message, error) {
      return patchState({
        message: error ? '' : normalizeText(message, ''),
        error: error ? normalizeText(message, '') : '',
      }, error ? 'message-error' : 'message')
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') return function () {}
      listeners.add(listener)
      return function () { listeners.delete(listener) }
    }

    function destroy() {
      if (disposed) return
      disposed = true
      importVersions.clear()
      pendingImports.clear()
      state.layers.forEach(function (layer) {
        void releaseRegisteredSource(layer.source)
        releaseObjectUrl(layer.source)
      })
      listeners.clear()
    }

    return Object.freeze({
      getState: function () { return state },
      getSnapshot: snapshot,
      subscribe,
      importFile,
      importDescriptor,
      removeSource,
      selectLayer,
      toggleVisibility,
      moveLayer,
      patchTransform,
      fitLayer,
      setMaskRevision,
      setTime,
      setPlaying,
      setFps,
      setFormat,
      setAudioSource,
      setMessage,
      projectDurationSec,
      destroy,
    })
  }

  return Object.freeze({
    version: SCHEMA_VERSION,
    SCHEMA_VERSION,
    MAX_LAYERS,
    SUPPORTED_EXTENSIONS,
    SUPPORTED_MIME_TYPES,
    isSupportedVideo,
    normalizeProbe,
    pathToFileUrl,
    createStore: createProjectStore,
    createProjectStore,
  })
})
