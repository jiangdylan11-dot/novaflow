(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceVideoMergeExportWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const SCHEMA = 'novaflow.video-compositor.export/v1'
  const EXPORT_UNAVAILABLE_MESSAGE = '当前环境暂不支持视频合并导出，请在完整的 Foart 桌面版中使用。'

  function finite(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  function normalizeText(value, fallback) {
    const text = String(value == null ? '' : value).trim()
    return text || fallback
  }

  function createJobId() {
    try {
      if (typeof root?.crypto?.randomUUID === 'function') return root.crypto.randomUUID()
    } catch (_) {}
    return `video-merge-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  function inspectCapability(apiValue) {
    const api = apiValue && typeof apiValue === 'object' ? apiValue : {}
    const capability = {
      canOpenSession: typeof api.videoCompositorOpenSession === 'function',
      canRegisterSource: false,
      canReleaseSource: false,
      canPutMask: false,
      canPickOutput: typeof api.exportPickSaveFile === 'function',
      canReserveResourceOutput: typeof api.aiSeqCacheReserveOutput === 'function',
      canReleaseResourceOutput: typeof api.aiSeqCacheReleaseOutput === 'function',
      canStartExport: false,
    }
    capability.canRegisterSource = capability.canOpenSession && typeof api.videoCompositorRegisterSource === 'function'
    capability.canReleaseSource = capability.canRegisterSource && typeof api.videoCompositorReleaseSource === 'function'
    capability.canPutMask = capability.canOpenSession && typeof api.videoCompositorPutMask === 'function'
    capability.canStartExport = capability.canOpenSession && typeof api.videoCompositorExport === 'function'
    const compositorReady = capability.canRegisterSource && capability.canPutMask && capability.canStartExport
    capability.canExportToFile = compositorReady && capability.canPickOutput
    capability.canSaveToResources = compositorReady && capability.canReserveResourceOutput && capability.canReleaseResourceOutput
    capability.canExport = capability.canExportToFile
    capability.available = capability.canExportToFile || capability.canSaveToResources
    capability.message = capability.available ? '' : EXPORT_UNAVAILABLE_MESSAGE
    return Object.freeze(capability)
  }

  function assertProjectState(state) {
    if (!state || typeof state !== 'object') throw new TypeError('video_merge_project_required')
    if (!Array.isArray(state.layers) || state.layers.length !== 2) throw new TypeError('video_merge_exactly_two_layers_required')
    if (!state.layers.every(function (layer) { return Boolean(layer?.source?.sourceId) })) {
      throw new TypeError('请先载入两个视频')
    }
    return state
  }

  function buildManifest(state, options) {
    assertProjectState(state)
    const config = options && typeof options === 'object' ? options : {}
    const format = state.format === 'webm' ? 'webm' : 'mp4'
    const fps = Number(state.canvas?.fps) === 60 ? 60 : 30
    const audioLayer = state.layers.find(function (layer) { return layer.id === state.audioSourceLayerId })
    return {
      schema: SCHEMA,
      sessionId: normalizeText(config.sessionId, ''),
      jobId: normalizeText(config.jobId, createJobId()),
      output: {
        filePath: normalizeText(config.filePath, ''),
        format,
        width: Math.round(finite(state.canvas?.width, 1920)),
        height: Math.round(finite(state.canvas?.height, 1080)),
        fps,
      },
      layers: state.layers.map(function (layer) {
        const maskId = config.maskIds && Object.prototype.hasOwnProperty.call(config.maskIds, layer.id)
          ? config.maskIds[layer.id]
          : null
        return {
          layerId: layer.id,
          sourceId: layer.source.sourceId,
          maskId: maskId || null,
          visible: layer.visible !== false,
          transform: {
            centerX: finite(layer.transform?.centerX, state.canvas.width / 2),
            centerY: finite(layer.transform?.centerY, state.canvas.height / 2),
            scale: finite(layer.transform?.scale, 1),
          },
        }
      }),
      audio: audioLayer && audioLayer.source?.probe?.hasAudio
        ? { mode: 'single', sourceLayerId: audioLayer.id }
        : { mode: 'none', sourceLayerId: null },
    }
  }

  function canvasToPngArrayBuffer(canvas) {
    if (canvas && typeof canvas.convertToBlob === 'function') {
      return Promise.resolve(canvas.convertToBlob({ type: 'image/png' })).then(function (blob) {
        if (!blob || typeof blob.arrayBuffer !== 'function') throw new Error('video_merge_mask_encode_failed')
        return blob.arrayBuffer()
      })
    }
    if (!canvas || typeof canvas.toBlob !== 'function') {
      return Promise.reject(new TypeError('video_merge_mask_canvas_required'))
    }
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error('video_merge_mask_encode_failed'))
          return
        }
        Promise.resolve(blob.arrayBuffer()).then(resolve, reject)
      }, 'image/png')
    })
  }

  async function surfaceToPngArrayBuffer(surface) {
    if (!surface) return null
    if (typeof surface.toPngArrayBuffer === 'function') return surface.toPngArrayBuffer()
    if (typeof surface.toPngBlob === 'function') {
      const blob = await surface.toPngBlob()
      return blob ? blob.arrayBuffer() : null
    }
    const canvas = typeof surface.getCanvas === 'function'
      ? surface.getCanvas()
      : (typeof surface.getCoverageCanvas === 'function' ? surface.getCoverageCanvas() : null)
    return canvasToPngArrayBuffer(canvas)
  }

  function createWorkflow(options) {
    const config = options && typeof options === 'object' ? options : {}
    const electronAPI = config.electronAPI || root?.electronAPI || {}
    const capability = inspectCapability(electronAPI)
    let sessionId = ''
    let sessionPromise = null
    let activeJobId = ''
    let activeExportTask = null
    let active = true
    let progressUnsubscribe = null
    const maskCache = new Map()

    function reportProgress(payload) {
      if (!active || !payload || (activeJobId && payload.jobId && payload.jobId !== activeJobId)) return
      const normalized = Object.assign({}, payload)
      if (!Number.isFinite(Number(normalized.progress01))) normalized.progress01 = Number(normalized.progress) || 0
      try { config.onProgress?.(normalized) } catch (_) {}
    }

    function bindProgress() {
      if (progressUnsubscribe || typeof electronAPI.onVideoCompositorProgress !== 'function') return
      const maybeUnsubscribe = electronAPI.onVideoCompositorProgress(reportProgress)
      if (typeof maybeUnsubscribe === 'function') progressUnsubscribe = maybeUnsubscribe
    }

    async function openSession(payload) {
      if (!active) throw new Error('video_merge_export_workflow_closed')
      if (sessionId) return sessionId
      if (sessionPromise) return sessionPromise
      if (!capability.canOpenSession) throw new Error(EXPORT_UNAVAILABLE_MESSAGE)
      sessionPromise = (async function () {
        const result = await electronAPI.videoCompositorOpenSession(payload || {})
        if (!result || result.ok === false) throw new Error(result?.error || 'video_merge_session_open_failed')
        const openedSessionId = normalizeText(result.sessionId || result.id, '')
        if (!openedSessionId) throw new Error('video_merge_session_id_missing')
        if (!active) {
          try {
            await electronAPI.videoCompositorCloseSession?.({ sessionId: openedSessionId })
          } catch (_) {}
          throw new Error('video_merge_export_workflow_closed')
        }
        sessionId = openedSessionId
        bindProgress()
        return sessionId
      })()
      try {
        return await sessionPromise
      } finally {
        sessionPromise = null
      }
    }

    async function registerSource(payload) {
      if (!capability.canRegisterSource) throw new Error(EXPORT_UNAVAILABLE_MESSAGE)
      const id = await openSession({ projectId: config.projectId, boardId: config.boardId })
      const result = await electronAPI.videoCompositorRegisterSource(Object.assign({}, payload || {}, { sessionId: id }))
      if (!result || result.ok === false) throw new Error(result?.error || 'video_merge_source_register_failed')
      return result
    }

    async function releaseSource(sourceId) {
      const normalizedSourceId = normalizeText(sourceId, '')
      if (!normalizedSourceId) return { ok: true, released: false }
      for (const [layerId, cached] of Array.from(maskCache.entries())) {
        if (cached.sourceId === normalizedSourceId) maskCache.delete(layerId)
      }
      if (!sessionId || typeof electronAPI.videoCompositorReleaseSource !== 'function') {
        return { ok: true, released: false }
      }
      const result = await electronAPI.videoCompositorReleaseSource({ sessionId, sourceId: normalizedSourceId })
      if (!result || result.ok === false) throw new Error(result?.error || 'video_merge_source_release_failed')
      return result
    }

    async function putMask(layer, surface) {
      if (!surface || !layer?.source) return null
      const revision = Math.max(0, Math.round(finite(layer.maskRevision, 0)))
      const cached = maskCache.get(layer.id)
      if (cached && cached.sourceId === layer.source.sourceId && cached.revision === revision && cached.maskId) return cached.maskId
      if (revision === 0 && typeof surface.isPristine === 'function' && surface.isPristine()) return null
      if (!capability.canPutMask) throw new Error(EXPORT_UNAVAILABLE_MESSAGE)
      const arrayBuffer = await surfaceToPngArrayBuffer(surface)
      if (!arrayBuffer) return null
      const id = await openSession({ projectId: config.projectId, boardId: config.boardId })
      const result = await electronAPI.videoCompositorPutMask({
        sessionId: id,
        layerId: layer.id,
        sourceId: layer.source.sourceId,
        width: layer.source.probe.displayWidth,
        height: layer.source.probe.displayHeight,
        encoding: 'png-rgba8-alpha',
        semantics: 'coverage-alpha',
        coordinateSpace: 'display-normalized',
        featherBaked: true,
        bytes: arrayBuffer,
      })
      if (!result || result.ok === false) throw new Error(result?.error || 'video_merge_mask_put_failed')
      const maskId = normalizeText(result.maskId || result.id, '')
      if (!maskId) throw new Error('video_merge_mask_id_missing')
      maskCache.set(layer.id, { sourceId: layer.source.sourceId, revision, maskId })
      return maskId
    }

    async function chooseOutput(state, baseName) {
      if (!capability.canPickOutput) throw new Error(EXPORT_UNAVAILABLE_MESSAGE)
      const result = await electronAPI.exportPickSaveFile({
        mode: 'video',
        format: state.format === 'webm' ? 'webm' : 'mp4',
        baseName: normalizeText(baseName, 'novaflow_video_merge'),
      })
      if (result?.canceled) return null
      if (result && result.ok === false) throw new Error(result.error || 'video_merge_save_picker_failed')
      const filePath = normalizeText(result?.filePath, '')
      if (!filePath) throw new Error('video_merge_output_path_missing')
      return filePath
    }

    async function reserveResourceOutput(state, baseName) {
      if (!capability.canReserveResourceOutput) throw new Error(EXPORT_UNAVAILABLE_MESSAGE)
      const format = state.format === 'webm' ? 'webm' : 'mp4'
      const result = await electronAPI.aiSeqCacheReserveOutput({
        format,
        baseName: normalizeText(baseName, 'novaflow_video_merge'),
      })
      if (!result || result.ok === false) throw new Error(result?.error || 'video_merge_resource_output_reserve_failed')
      const filePath = normalizeText(result?.path || result?.filePath, '')
      if (!filePath) throw new Error('video_merge_output_path_missing')
      return filePath
    }

    async function releaseResourceOutput(filePath) {
      const outputPath = normalizeText(filePath, '')
      if (!outputPath || typeof electronAPI.aiSeqCacheReleaseOutput !== 'function') return { ok: true, released: false }
      const result = await electronAPI.aiSeqCacheReleaseOutput({ path: outputPath })
      if (!result || result.ok === false) throw new Error(result?.error || 'video_merge_resource_output_release_failed')
      return result
    }

    async function exportProject(stateValue, surfaces, exportOptions) {
      if (activeExportTask || activeJobId) throw new Error('video_merge_export_already_running')
      const state = assertProjectState(stateValue)
      const configExport = exportOptions && typeof exportOptions === 'object' ? exportOptions : {}
      const task = { canceled: false }
      let reservedOutputPath = ''
      let exportSucceeded = false
      activeExportTask = task
      try {
        let filePath = normalizeText(configExport.filePath, '')
        if (!filePath && configExport.destination === 'resource') {
          filePath = await reserveResourceOutput(state, configExport.baseName)
          reservedOutputPath = filePath
        }
        if (!filePath) filePath = await chooseOutput(state, configExport.baseName)
        if (!filePath || task.canceled) return { ok: false, canceled: true }
        const id = await openSession({ projectId: config.projectId, boardId: config.boardId })
        if (task.canceled) return { ok: false, canceled: true }
        const maskIds = {}
        for (const layer of state.layers) {
          if (task.canceled) return { ok: false, canceled: true }
          const surface = surfaces instanceof Map ? surfaces.get(layer.id) : surfaces?.[layer.id]
          maskIds[layer.id] = await putMask(layer, surface)
          if (task.canceled) return { ok: false, canceled: true }
        }
        const jobId = createJobId()
        const manifest = buildManifest(state, { sessionId: id, jobId, filePath, maskIds })
        activeJobId = jobId
        reportProgress({ jobId, stage: 'prepare', progress01: 0, message: '准备合成…' })
        try {
          if (!capability.canStartExport) throw new Error(EXPORT_UNAVAILABLE_MESSAGE)
          const result = await electronAPI.videoCompositorExport(manifest)
          if (!result || result.ok === false) {
            if (result?.canceled || result?.code === 'export_canceled') return Object.assign({}, result, { canceled: true })
            throw new Error(result?.error || 'video_merge_export_failed')
          }
          reportProgress({ jobId, stage: 'done', progress01: 1, message: '视频合并完成' })
          exportSucceeded = true
          return Object.assign({ manifest }, result)
        } finally {
          activeJobId = ''
        }
      } catch (error) {
        if (task.canceled) return { ok: false, canceled: true }
        throw error
      } finally {
        if (reservedOutputPath && !exportSucceeded) {
          try { await releaseResourceOutput(reservedOutputPath) } catch (_) {}
        }
        if (activeExportTask === task) activeExportTask = null
      }
    }

    async function cancel() {
      const task = activeExportTask
      if (task) task.canceled = true
      const jobId = activeJobId
      if (!jobId || typeof electronAPI.videoCompositorCancel !== 'function') {
        return { ok: true, idle: !task, canceled: Boolean(task), preparing: Boolean(task) }
      }
      return electronAPI.videoCompositorCancel({ sessionId, jobId })
    }

    async function close() {
      if (!active) return { ok: true }
      active = false
      try { await cancel() } catch (_) {}
      try { await sessionPromise } catch (_) {}
      try { progressUnsubscribe?.() } catch (_) {}
      progressUnsubscribe = null
      maskCache.clear()
      if (!sessionId || typeof electronAPI.videoCompositorCloseSession !== 'function') return { ok: true }
      const closingId = sessionId
      sessionId = ''
      return electronAPI.videoCompositorCloseSession({ sessionId: closingId })
    }

    return Object.freeze({
      openSession,
      registerSource,
      releaseSource,
      putMask,
      reserveResourceOutput,
      releaseResourceOutput,
      exportProject,
      cancel,
      close,
      getCapability: function () { return capability },
      getSessionId: function () { return sessionId },
      getActiveJobId: function () { return activeJobId },
    })
  }

  return Object.freeze({
    version: 1,
    schema: SCHEMA,
    unavailableMessage: EXPORT_UNAVAILABLE_MESSAGE,
    inspectCapability,
    buildManifest,
    surfaceToPngArrayBuffer,
    create: createWorkflow,
    createWorkflow,
  })
})
