(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceVideoMergePreview = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const mounted = new WeakMap()
  const SELECTION_COLOR = '#27c889'
  const SYNC_DRIFT_SECONDS = 0.08
  const MIN_VIEW_ZOOM = 0.1
  const MAX_VIEW_ZOOM = 8

  function finite(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value))
  }

  function createElement(documentRef, tagName, attributes) {
    const node = documentRef.createElement(tagName)
    Object.entries(attributes || {}).forEach(function (entry) {
      const name = entry[0]
      const value = entry[1]
      if (name === 'style') Object.assign(node.style, value || {})
      else if (name in node && !name.startsWith('data-') && !name.startsWith('aria-')) node[name] = value
      else if (value != null) node.setAttribute(name, String(value))
    })
    return node
  }

  function mount(options) {
    const config = options && typeof options === 'object' ? options : {}
    const host = config.host
    const store = config.store
    if (!host || typeof host.appendChild !== 'function') throw new TypeError('video merge preview host is required')
    if (!store || typeof store.getState !== 'function' || typeof store.subscribe !== 'function') {
      throw new TypeError('video merge preview store is required')
    }
    const documentRef = host.ownerDocument || root?.document
    if (!documentRef) throw new TypeError('video merge preview document is required')
    mounted.get(host)?.destroy?.()

    let active = true
    let animationFrame = 0
    let maskRenderFrame = 0
    let maskRenderRequestCount = 0
    let maskRenderFrameCount = 0
    let maskRenderCoalescedCount = 0
    let maskRenderSyncFlushCount = 0
    let clockStartedAt = 0
    let clockStartedTime = 0
    let lastTimelinePublishAt = 0
    let interaction = null
    let interactionLocked = false
    let maskEditing = null
    let hoverPoint = null
    let viewZoom = 1
    let viewPanX = 0
    let viewPanY = 0
    let resizeObserver = null
    let renderCount = 0
    let syncCorrectionCount = 0
    const renderDurationsMs = []
    const videos = new Map()
    const offscreenByLayer = new Map()
    const windowRef = documentRef.defaultView || root

    const shell = createElement(documentRef, 'div', {
      'data-novaflow-ai-video-merge-preview': '1',
      style: {
        position: 'relative', width: '100%', height: '100%', minWidth: '0', minHeight: '0', overflow: 'hidden',
        backgroundColor: '#0b0b0b', backgroundImage: 'none',
      },
    })
    const canvas = createElement(documentRef, 'canvas', {
      'data-novaflow-ai-video-merge-canvas': '1',
      tabindex: '0',
      style: { width: '100%', height: '100%', display: 'block', touchAction: 'none', outline: 'none' },
    })
    const mediaHost = createElement(documentRef, 'div', {
      'data-novaflow-ai-video-merge-media-host': '1',
      'aria-hidden': 'true',
      style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', opacity: '0', pointerEvents: 'none' },
    })
    const brushOverlay = createElement(documentRef, 'div', {
      'data-novaflow-ai-video-merge-brush-overlay': '1',
      'aria-hidden': 'true',
      style: {
        position: 'absolute', left: '0', top: '0', width: '0', height: '0', overflow: 'visible',
        pointerEvents: 'none', display: 'none', zIndex: '2', willChange: 'transform',
      },
    })
    const brushFeather = createElement(documentRef, 'div', {
      'data-novaflow-ai-video-merge-brush-feather': '1',
      style: {
        position: 'absolute', left: '0', top: '0', boxSizing: 'border-box', borderRadius: '50%', borderWidth: '1px',
        borderStyle: 'dashed', pointerEvents: 'none', willChange: 'transform', display: 'none',
      },
    })
    const brushCore = createElement(documentRef, 'div', {
      'data-novaflow-ai-video-merge-brush-core': '1',
      style: {
        position: 'absolute', left: '0', top: '0', boxSizing: 'border-box', borderRadius: '50%', borderWidth: '1px',
        borderStyle: 'solid', pointerEvents: 'none', willChange: 'transform',
      },
    })
    brushOverlay.append(brushFeather, brushCore)
    shell.append(canvas, mediaHost, brushOverlay)
    host.replaceChildren(shell)
    const context = canvas.getContext('2d', { alpha: true, desynchronized: true })
    if (!context) throw new Error('video_merge_canvas_2d_unavailable')

    function requestFrame(callback) {
      return typeof windowRef?.requestAnimationFrame === 'function'
        ? windowRef.requestAnimationFrame(callback)
        : windowRef.setTimeout(function () { callback(Date.now()) }, 16)
    }

    function cancelFrame(id) {
      if (!id) return
      if (typeof windowRef?.cancelAnimationFrame === 'function') windowRef.cancelAnimationFrame(id)
      else windowRef?.clearTimeout?.(id)
    }

    function scheduleMaskRender() {
      if (!active) return false
      maskRenderRequestCount += 1
      if (maskRenderFrame) {
        maskRenderCoalescedCount += 1
        return false
      }
      maskRenderFrame = requestFrame(function () {
        maskRenderFrame = 0
        if (!active) return
        maskRenderFrameCount += 1
        render()
      })
      return true
    }

    function flushMaskRender() {
      if (!maskRenderFrame) return false
      cancelFrame(maskRenderFrame)
      maskRenderFrame = 0
      if (!active) return false
      maskRenderSyncFlushCount += 1
      render()
      return true
    }

    function cancelMaskRender() {
      if (!maskRenderFrame) return false
      cancelFrame(maskRenderFrame)
      maskRenderFrame = 0
      return true
    }

    function canvasRect() {
      return canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: canvas.width, height: canvas.height }
    }

    function resizeCanvas() {
      if (!active) return false
      const rect = canvasRect()
      const dpr = clamp(finite(windowRef?.devicePixelRatio, 1), 1, 2)
      const width = Math.max(2, Math.round(Math.max(1, rect.width) * dpr))
      const height = Math.max(2, Math.round(Math.max(1, rect.height) * dpr))
      if (canvas.width === width && canvas.height === height) return false
      canvas.width = width
      canvas.height = height
      if (hoverPoint) hoverPoint = canvasPoint(hoverPoint, store.getState(), rect)
      render()
      return true
    }

    function fitStageMetrics(state) {
      const width = Math.max(1, finite(state.canvas?.width, 1920))
      const height = Math.max(1, finite(state.canvas?.height, 1080))
      const padding = Math.max(12, Math.min(canvas.width, canvas.height) * 0.045)
      const scale = Math.max(0.0001, Math.min((canvas.width - padding * 2) / width, (canvas.height - padding * 2) / height))
      return {
        projectWidth: width,
        projectHeight: height,
        scale,
        originX: (canvas.width - width * scale) / 2,
        originY: (canvas.height - height * scale) / 2,
      }
    }

    function stageMetrics(state) {
      const fit = fitStageMetrics(state)
      return Object.assign({}, fit, {
        scale: fit.scale * viewZoom,
        originX: fit.originX + viewPanX,
        originY: fit.originY + viewPanY,
      })
    }

    function canvasPoint(event, state, providedRect) {
      const rect = providedRect || canvasRect()
      const clientX = finite(event?.clientX, rect.left)
      const clientY = finite(event?.clientY, rect.top)
      const cssX = clientX - rect.left
      const cssY = clientY - rect.top
      const backingX = cssX * (canvas.width / Math.max(1, rect.width))
      const backingY = cssY * (canvas.height / Math.max(1, rect.height))
      const stage = stageMetrics(state)
      return {
        clientX,
        clientY,
        cssX,
        cssY,
        backingX,
        backingY,
        projectX: (backingX - stage.originX) / stage.scale,
        projectY: (backingY - stage.originY) / stage.scale,
        backingPerCss: canvas.width / Math.max(1, rect.width),
        stage,
      }
    }

    function layerGeometry(layer, state, stage) {
      const probe = layer?.source?.probe || {}
      const sourceWidth = Math.max(1, finite(probe.displayWidth, 1))
      const sourceHeight = Math.max(1, finite(probe.displayHeight, 1))
      const layerScale = Math.max(0.01, finite(layer?.transform?.scale, 1))
      const centerX = finite(layer?.transform?.centerX, state.canvas.width / 2)
      const centerY = finite(layer?.transform?.centerY, state.canvas.height / 2)
      const projectWidth = sourceWidth * layerScale
      const projectHeight = sourceHeight * layerScale
      return {
        sourceWidth,
        sourceHeight,
        layerScale,
        centerX,
        centerY,
        projectWidth,
        projectHeight,
        left: stage.originX + (centerX - projectWidth / 2) * stage.scale,
        top: stage.originY + (centerY - projectHeight / 2) * stage.scale,
        width: projectWidth * stage.scale,
        height: projectHeight * stage.scale,
      }
    }

    function offscreenForLayer(layerId) {
      let target = offscreenByLayer.get(layerId)
      if (!target) {
        target = createElement(documentRef, 'canvas')
        offscreenByLayer.set(layerId, target)
      }
      if (target.width !== canvas.width) target.width = canvas.width
      if (target.height !== canvas.height) target.height = canvas.height
      return target
    }

    function maskSurfaceFor(layerId) {
      if (typeof config.getMaskSurface === 'function') return config.getMaskSurface(layerId)
      return config.maskSurfaces instanceof Map ? config.maskSurfaces.get(layerId) : config.maskSurfaces?.[layerId]
    }

    function disposeRecord(record) {
      const video = record?.video
      if (!video) return
      try { video.pause() } catch (_) {}
      for (const entry of record.listeners || []) {
        try { video.removeEventListener(entry[0], entry[1]) } catch (_) {}
      }
      try { video.removeAttribute('src') } catch (_) {}
      try { video.load() } catch (_) {}
      try { video.remove() } catch (_) {}
    }

    function syncMedia(state) {
      const activeIds = new Set()
      state.layers.forEach(function (layer) {
        const source = layer.source
        if (!source?.objectUrl) return
        activeIds.add(layer.id)
        let record = videos.get(layer.id)
        if (record && record.url !== source.objectUrl) {
          disposeRecord(record)
          videos.delete(layer.id)
          record = null
        }
        if (!record) {
          const video = createElement(documentRef, 'video', {
            preload: 'auto', playsInline: true, disablePictureInPicture: true,
          })
          video.setAttribute('webkit-playsinline', 'true')
          video.src = source.objectUrl
          const syncLoadedFrame = function () {
            const latest = store.getState()
            setVideoTime(video, finite(latest.timeSec, 0), finite(layer.source?.probe?.durationSec, 0))
            render()
          }
          const handleError = function () {
            try { config.onError?.(new Error(`无法预览 ${source.fileName || layer.title}`)) } catch (_) {}
          }
          const listeners = [
            ['loadedmetadata', syncLoadedFrame],
            ['loadeddata', syncLoadedFrame],
            ['seeked', render],
            ['error', handleError],
          ]
          listeners.forEach(function (entry) { video.addEventListener(entry[0], entry[1]) })
          mediaHost.appendChild(video)
          record = { video, url: source.objectUrl, layerId: layer.id, listeners }
          videos.set(layer.id, record)
        }
        record.video.muted = state.audioSourceLayerId !== layer.id
        record.video.volume = state.audioSourceLayerId === layer.id ? 1 : 0
      })
      Array.from(videos.entries()).forEach(function (entry) {
        if (activeIds.has(entry[0])) return
        disposeRecord(entry[1])
        videos.delete(entry[0])
      })
    }

    function drawLayer(layer, state, stage) {
      if (!layer?.source || layer.visible === false) return
      const record = videos.get(layer.id)
      const video = record?.video
      const duration = finite(layer.source.probe?.durationSec, 0)
      const time = finite(state.timeSec, 0)
      if (!video || video.readyState < 2 || time > duration + 0.001) return
      const geometry = layerGeometry(layer, state, stage)
      const offscreen = offscreenForLayer(layer.id)
      const layerContext = offscreen.getContext('2d', { alpha: true, desynchronized: true })
      layerContext.clearRect(0, 0, offscreen.width, offscreen.height)
      layerContext.save()
      layerContext.translate(stage.originX + geometry.centerX * stage.scale, stage.originY + geometry.centerY * stage.scale)
      layerContext.scale(stage.scale * geometry.layerScale, stage.scale * geometry.layerScale)
      try {
        layerContext.drawImage(video, -geometry.sourceWidth / 2, -geometry.sourceHeight / 2, geometry.sourceWidth, geometry.sourceHeight)
      } catch (_) {
        layerContext.restore()
        return
      }
      const surface = maskSurfaceFor(layer.id)
      const maskCanvas = surface && typeof surface.getCanvas === 'function' ? surface.getCanvas() : null
      if (maskCanvas) {
        layerContext.globalCompositeOperation = 'destination-in'
        layerContext.drawImage(maskCanvas, -geometry.sourceWidth / 2, -geometry.sourceHeight / 2, geometry.sourceWidth, geometry.sourceHeight)
      }
      layerContext.restore()
      context.drawImage(offscreen, 0, 0)
    }

    function drawSelection(state, stage) {
      const layer = state.layers.find(function (candidate) { return candidate.id === state.selectedLayerId })
      if (!layer?.source || layer.visible === false) return
      const geometry = layerGeometry(layer, state, stage)
      context.save()
      context.strokeStyle = SELECTION_COLOR
      context.lineWidth = Math.max(1.5, finite(windowRef?.devicePixelRatio, 1))
      context.setLineDash(maskEditing?.enabled ? [7, 5] : [])
      context.strokeRect(geometry.left, geometry.top, geometry.width, geometry.height)
      if (!maskEditing?.enabled) {
        const size = 10 * clamp(finite(windowRef?.devicePixelRatio, 1), 1, 2)
        context.fillStyle = SELECTION_COLOR
        context.fillRect(geometry.left + geometry.width - size / 2, geometry.top + geometry.height - size / 2, size, size)
      }
      context.restore()
    }

    function positionBrushRing(node, diameter) {
      const normalizedDiameter = Math.max(2, finite(diameter, 2))
      node.style.width = `${normalizedDiameter}px`
      node.style.height = `${normalizedDiameter}px`
      node.style.transform = `translate3d(${-normalizedDiameter / 2}px, ${-normalizedDiameter / 2}px, 0)`
    }

    function brushOverlayIsVisible(state) {
      return Boolean(
        active && !interactionLocked && interaction?.kind !== 'pan' && maskEditing?.enabled && hoverPoint && maskEditing.layerId === state.selectedLayerId,
      )
    }

    function syncCanvasCursor(state, brushVisible) {
      const visible = typeof brushVisible === 'boolean'
        ? brushVisible
        : brushOverlayIsVisible(state || store.getState())
      canvas.style.cursor = interactionLocked
        ? 'default'
        : (interaction?.kind === 'pan' ? 'grabbing' : (maskEditing?.enabled ? (visible ? 'none' : 'crosshair') : 'default'))
    }

    function syncBrushOverlay(state) {
      const visible = brushOverlayIsVisible(state)
      brushOverlay.style.display = visible ? 'block' : 'none'
      syncCanvasCursor(state, visible)
      if (!visible) {
        brushFeather.style.display = 'none'
        return
      }
      const brushSize = Math.max(1, finite(maskEditing.brushSize, 22))
      const feather = Math.max(0, finite(maskEditing.feather, 0))
      const brushColor = maskEditing.mode === 'restore' ? '#f7f7f7' : '#27c889'
      const contrast = '0 0 0 2px rgba(0,0,0,.82)'
      brushOverlay.style.transform = `translate3d(${hoverPoint.cssX}px, ${hoverPoint.cssY}px, 0)`
      brushCore.style.borderColor = brushColor
      brushCore.style.boxShadow = contrast
      positionBrushRing(brushCore, brushSize)
      if (feather > 0) {
        brushFeather.style.display = 'block'
        brushFeather.style.borderColor = brushColor
        brushFeather.style.boxShadow = contrast
        brushFeather.style.opacity = '0.92'
        positionBrushRing(brushFeather, brushSize + feather * 2)
      } else brushFeather.style.display = 'none'
    }

    function fitToViewport() {
      if (!active) return false
      viewZoom = 1
      viewPanX = 0
      viewPanY = 0
      if (hoverPoint) hoverPoint = canvasPoint(hoverPoint, store.getState(), canvasRect())
      syncBrushOverlay(store.getState())
      render()
      return true
    }

    function handleWheel(event) {
      if (!active || interactionLocked) return
      const rect = canvasRect()
      const deltaScale = event?.deltaMode === 1 ? 16 : (event?.deltaMode === 2 ? Math.max(1, rect.height) : 1)
      const delta = finite(event?.deltaY, 0) * deltaScale
      if (!delta) return
      const state = store.getState()
      const stage = stageMetrics(state)
      const anchorProjectX = Math.max(1, finite(state.canvas?.width, 1920)) / 2
      const anchorProjectY = Math.max(1, finite(state.canvas?.height, 1080)) / 2
      const anchorBackingX = stage.originX + anchorProjectX * stage.scale
      const anchorBackingY = stage.originY + anchorProjectY * stage.scale
      const nextZoom = clamp(viewZoom * Math.exp(-delta * 0.0015), MIN_VIEW_ZOOM, MAX_VIEW_ZOOM)
      if (Math.abs(nextZoom - viewZoom) < 0.0001) return
      const fit = fitStageMetrics(state)
      viewZoom = nextZoom
      const nextScale = fit.scale * viewZoom
      viewPanX = anchorBackingX - anchorProjectX * nextScale - fit.originX
      viewPanY = anchorBackingY - anchorProjectY * nextScale - fit.originY
      hoverPoint = canvasPoint(event, state, rect)
      event.preventDefault?.()
      render()
    }

    function handleContextMenu(event) {
      if (!active) return
      event.preventDefault?.()
    }

    function render() {
      if (!active) return
      const startedAt = typeof windowRef?.performance?.now === 'function' ? windowRef.performance.now() : Date.now()
      const state = store.getState()
      syncMedia(state)
      const stage = stageMetrics(state)
      context.clearRect(0, 0, canvas.width, canvas.height)
      if (state.layers.some(function (layer) { return Boolean(layer.source) })) {
        context.save()
        context.strokeStyle = 'rgba(255,255,255,.12)'
        context.lineWidth = 1
        context.strokeRect(stage.originX - 0.5, stage.originY - 0.5, stage.projectWidth * stage.scale + 1, stage.projectHeight * stage.scale + 1)
        context.restore()
      }
      state.layers.forEach(function (layer) { drawLayer(layer, state, stage) })
      drawSelection(state, stage)
      syncBrushOverlay(state)
      const finishedAt = typeof windowRef?.performance?.now === 'function' ? windowRef.performance.now() : Date.now()
      renderCount += 1
      renderDurationsMs.push(Math.max(0, finishedAt - startedAt))
      if (renderDurationsMs.length > 180) renderDurationsMs.shift()
    }

    function layerAtPoint(point, state) {
      const stage = point.stage
      for (let index = state.layers.length - 1; index >= 0; index -= 1) {
        const layer = state.layers[index]
        if (!layer?.source || layer.visible === false) continue
        const geometry = layerGeometry(layer, state, stage)
        if (point.backingX >= geometry.left && point.backingX <= geometry.left + geometry.width &&
            point.backingY >= geometry.top && point.backingY <= geometry.top + geometry.height) return layer
      }
      return null
    }

    function maskPoint(point, layer, state) {
      const geometry = layerGeometry(layer, state, point.stage)
      const sourceX = (point.projectX - geometry.centerX) / geometry.layerScale + geometry.sourceWidth / 2
      const sourceY = (point.projectY - geometry.centerY) / geometry.layerScale + geometry.sourceHeight / 2
      return { x: sourceX, y: sourceY, geometry }
    }

    function handlePointerDown(event) {
      if (!active || interactionLocked) return
      try { canvas.focus?.({ preventScroll: true }) } catch (_) { try { canvas.focus?.() } catch (_) {} }
      const state = store.getState()
      const point = canvasPoint(event, state, canvasRect())
      hoverPoint = point
      if (event.button === 2) {
        interaction = {
          kind: 'pan', pointerId: event.pointerId,
          startBackingX: point.backingX, startBackingY: point.backingY,
          startPanX: viewPanX, startPanY: viewPanY,
        }
        event.preventDefault?.()
        try { canvas.setPointerCapture?.(event.pointerId) } catch (_) {}
        syncCanvasCursor()
        syncBrushOverlay(state)
        return
      }
      if (event.button !== 0) return
      syncBrushOverlay(state)
      if (maskEditing?.enabled) {
        const layer = state.layers.find(function (candidate) { return candidate.id === maskEditing.layerId })
        const surface = maskEditing.surface || maskSurfaceFor(maskEditing.layerId)
        if (!layer?.source || !surface) return
        const local = maskPoint(point, layer, state)
        if (local.x < 0 || local.y < 0 || local.x >= local.geometry.sourceWidth || local.y >= local.geometry.sourceHeight) return
        if (store.getState().playing) pause()
        const radiusSource = Math.max(0.5, finite(maskEditing.brushSize, 22) * point.backingPerCss * 0.5 / (point.stage.scale * local.geometry.layerScale))
        const featherSource = Math.max(0, finite(maskEditing.feather, 0) * point.backingPerCss / (point.stage.scale * local.geometry.layerScale))
        surface.beginStroke({ mode: maskEditing.mode === 'restore' ? 'restore' : 'erase', radiusPx: radiusSource, featherPx: featherSource, x: local.x, y: local.y })
        interaction = { kind: 'mask', pointerId: event.pointerId, layer, surface }
      } else {
        let layer = layerAtPoint(point, state)
        if (!layer) return
        if (layer.id !== state.selectedLayerId) {
          store.selectLayer?.(layer.id)
          try { config.onSelectLayer?.(layer.id) } catch (_) {}
        }
        const geometry = layerGeometry(layer, state, point.stage)
        const handleRadius = 16 * point.backingPerCss
        const handleDistance = Math.hypot(point.backingX - (geometry.left + geometry.width), point.backingY - (geometry.top + geometry.height))
        if (handleDistance <= handleRadius) {
          interaction = {
            kind: 'scale', pointerId: event.pointerId, layerId: layer.id,
            centerX: geometry.centerX, centerY: geometry.centerY,
            startDistance: Math.max(1, Math.hypot(point.projectX - geometry.centerX, point.projectY - geometry.centerY)),
            startScale: geometry.layerScale,
          }
        } else {
          interaction = {
            kind: 'move', pointerId: event.pointerId, layerId: layer.id,
            offsetX: point.projectX - geometry.centerX, offsetY: point.projectY - geometry.centerY,
          }
        }
      }
      event.preventDefault?.()
      try { canvas.setPointerCapture?.(event.pointerId) } catch (_) {}
      if (interaction?.kind === 'mask') scheduleMaskRender()
      else render()
    }

    function handlePointerMove(event) {
      if (!active) return
      if (interaction?.kind === 'pan' && (Number(event?.buttons) & 2) !== 2) {
        finishPointer(event)
        return
      }
      const state = store.getState()
      const point = canvasPoint(event, state, canvasRect())
      hoverPoint = point
      syncBrushOverlay(state)
      if (!interaction || interaction.pointerId !== event.pointerId) {
        return
      }
      if (interaction.kind === 'mask') {
        const local = maskPoint(point, interaction.layer, state)
        interaction.surface.extendStroke({ x: local.x, y: local.y })
      } else if (interaction.kind === 'move') {
        store.patchTransform?.(interaction.layerId, {
          centerX: point.projectX - interaction.offsetX,
          centerY: point.projectY - interaction.offsetY,
        })
      } else if (interaction.kind === 'scale') {
        const distance = Math.max(1, Math.hypot(point.projectX - interaction.centerX, point.projectY - interaction.centerY))
        store.patchTransform?.(interaction.layerId, { scale: interaction.startScale * distance / interaction.startDistance })
      } else if (interaction.kind === 'pan') {
        viewPanX = interaction.startPanX + point.backingX - interaction.startBackingX
        viewPanY = interaction.startPanY + point.backingY - interaction.startBackingY
      }
      event.preventDefault?.()
      syncCanvasCursor()
      if (interaction.kind === 'mask') scheduleMaskRender()
      else render()
    }

    function finishPointer(event) {
      if (!interaction || interaction.pointerId !== event.pointerId) return
      const completed = interaction
      interaction = null
      if (completed.kind === 'mask') {
        flushMaskRender()
        completed.surface.endStroke()
        try { config.onMaskChange?.(completed.layer.id, completed.surface.debugState?.().revision || 0) } catch (_) {}
      }
      try { canvas.releasePointerCapture?.(event.pointerId) } catch (_) {}
      event.preventDefault?.()
      syncCanvasCursor()
      if (completed.kind !== 'mask') render()
    }

    function handlePointerLeave() {
      if (interaction) return
      hoverPoint = null
      syncBrushOverlay(store.getState())
    }

    function stopCapturedPanEvent(event) {
      event?.preventDefault?.()
      event?.stopImmediatePropagation?.()
      event?.stopPropagation?.()
    }

    function handleCapturedPanStart(event) {
      if (!active || interactionLocked || event?.target !== canvas || Number(event?.button) !== 2) return
      handlePointerDown(event)
      if (interaction?.kind === 'pan') stopCapturedPanEvent(event)
    }

    function handleCapturedPanMove(event) {
      if (!active || interaction?.kind !== 'pan' || interaction.pointerId !== event?.pointerId) return
      handlePointerMove(event)
      stopCapturedPanEvent(event)
    }

    function handleCapturedPanEnd(event) {
      if (!active || interaction?.kind !== 'pan' || interaction.pointerId !== event?.pointerId) return
      finishPointer(event)
      stopCapturedPanEvent(event)
    }

    function handleCapturedContextMenu(event) {
      if (!active || event?.target !== canvas) return
      stopCapturedPanEvent(event)
    }

    function setVideoTime(video, time, duration) {
      if (!video || !Number.isFinite(time)) return
      const target = clamp(time, 0, Math.max(0, duration - 0.0001))
      try {
        if (Math.abs(finite(video.currentTime, 0) - target) > 0.02) video.currentTime = target
      } catch (_) {}
    }

    function seek(timeSec) {
      const state = store.getState()
      const target = clamp(finite(timeSec, 0), 0, store.projectDurationSec?.() || 0)
      state.layers.forEach(function (layer) {
        const record = videos.get(layer.id)
        if (!record) return
        setVideoTime(record.video, target, finite(layer.source?.probe?.durationSec, 0))
      })
      store.setTime?.(target)
      render()
      return target
    }

    function pause() {
      cancelFrame(animationFrame)
      animationFrame = 0
      videos.forEach(function (record) { try { record.video.pause() } catch (_) {} })
      store.setPlaying?.(false)
      render()
    }

    function masterRecord(state) {
      const audio = state.audioSourceLayerId ? videos.get(state.audioSourceLayerId) : null
      const isRunning = function (record) {
        const video = record?.video
        return Boolean(video && video.readyState >= 2 && !video.paused && !video.ended)
      }
      if (isRunning(audio) && finite(audio.video.duration, 0) > finite(state.timeSec, 0)) return audio
      let selected = null
      let duration = -1
      state.layers.forEach(function (layer) {
        const record = videos.get(layer.id)
        const sourceDuration = finite(layer.source?.probe?.durationSec, 0)
        if (isRunning(record) && sourceDuration > duration) { selected = record; duration = sourceDuration }
      })
      return selected
    }

    function animationTick(now) {
      if (!active || !store.getState().playing) return
      const state = store.getState()
      const duration = store.projectDurationSec?.() || 0
      const master = masterRecord(state)
      let target = master && !master.video.ended
        ? finite(master.video.currentTime, state.timeSec)
        : clockStartedTime + (finite(now, Date.now()) - clockStartedAt) / 1000
      if (target >= duration) {
        seek(duration)
        pause()
        return
      }
      state.layers.forEach(function (layer) {
        const record = videos.get(layer.id)
        if (!record || record === master) return
        const layerDuration = finite(layer.source?.probe?.durationSec, 0)
        if (target >= layerDuration) return
        if (Math.abs(finite(record.video.currentTime, 0) - target) > SYNC_DRIFT_SECONDS) {
          syncCorrectionCount += 1
          setVideoTime(record.video, target, layerDuration)
        }
      })
      if (finite(now, 0) - lastTimelinePublishAt >= 80) {
        lastTimelinePublishAt = finite(now, 0)
        store.setTime?.(target)
        try { config.onTime?.(target) } catch (_) {}
      }
      render()
      animationFrame = requestFrame(animationTick)
    }

    async function play() {
      const state = store.getState()
      const duration = store.projectDurationSec?.() || 0
      if (!duration) return false
      if (state.timeSec >= duration - 0.001) seek(0)
      const current = store.getState()
      syncMedia(current)
      current.layers.forEach(function (layer) {
        const record = videos.get(layer.id)
        if (!record) return
        setVideoTime(record.video, current.timeSec, finite(layer.source?.probe?.durationSec, 0))
        record.video.muted = current.audioSourceLayerId !== layer.id
        Promise.resolve(record.video.play()).catch(function () {
          record.video.muted = true
          return record.video.play().catch(function () {})
        })
      })
      store.setPlaying?.(true)
      clockStartedAt = typeof windowRef?.performance?.now === 'function' ? windowRef.performance.now() : Date.now()
      clockStartedTime = current.timeSec
      cancelFrame(animationFrame)
      animationFrame = requestFrame(animationTick)
      return true
    }

    function setMaskEditing(value) {
      cancelMaskRender()
      maskEditing = value && value.enabled
        ? {
            enabled: true,
            layerId: String(value.layerId || ''),
            surface: value.surface || null,
            mode: value.mode === 'restore' ? 'restore' : 'erase',
            brushSize: clamp(finite(value.brushSize, 22), 1, 300),
            feather: clamp(finite(value.feather, 0), 0, 300),
          }
        : null
      syncCanvasCursor()
      if (maskEditing) pause()
      render()
    }

    function updateMaskBrush(patch) {
      if (!maskEditing) return false
      maskEditing = Object.assign({}, maskEditing, patch || {})
      maskEditing.mode = maskEditing.mode === 'restore' ? 'restore' : 'erase'
      maskEditing.brushSize = clamp(finite(maskEditing.brushSize, 22), 1, 300)
      maskEditing.feather = clamp(finite(maskEditing.feather, 0), 0, 300)
      syncBrushOverlay(store.getState())
      return true
    }

    function setInteractionLocked(locked) {
      interactionLocked = Boolean(locked)
      if (interactionLocked) {
        interaction = null
        cancelMaskRender()
      }
      syncCanvasCursor()
      render()
      return interactionLocked
    }

    function debugSnapshot() {
      const state = store.getState()
      const sortedDurations = renderDurationsMs.slice().sort(function (left, right) { return left - right })
      const percentile = function (ratio) {
        if (!sortedDurations.length) return 0
        return sortedDurations[Math.min(sortedDurations.length - 1, Math.floor((sortedDurations.length - 1) * ratio))]
      }
      return Object.freeze({
        mounted: active,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        mediaCount: videos.size,
        playing: Boolean(state.playing),
        timeSec: finite(state.timeSec, 0),
        durationSec: store.projectDurationSec?.() || 0,
        maskEditing: Boolean(maskEditing),
        activeInteraction: interaction?.kind || '',
        interactionLocked,
        viewportZoom: viewZoom,
        viewportPanX: viewPanX,
        viewportPanY: viewPanY,
        renderCount,
        renderSampleCount: sortedDurations.length,
        renderP50Ms: percentile(0.5),
        renderP95Ms: percentile(0.95),
        syncCorrectionCount,
        maskRenderPending: Boolean(maskRenderFrame),
        maskRenderRequestCount,
        maskRenderFrameCount,
        maskRenderCoalescedCount,
        maskRenderSyncFlushCount,
      })
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', finishPointer)
    canvas.addEventListener('pointercancel', finishPointer)
    canvas.addEventListener('lostpointercapture', finishPointer)
    canvas.addEventListener('pointerleave', handlePointerLeave)
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    canvas.addEventListener('contextmenu', handleContextMenu)
    windowRef?.addEventListener?.('pointerdown', handleCapturedPanStart, { capture: true, passive: false })
    windowRef?.addEventListener?.('pointermove', handleCapturedPanMove, { capture: true, passive: false })
    windowRef?.addEventListener?.('pointerup', handleCapturedPanEnd, { capture: true, passive: false })
    windowRef?.addEventListener?.('pointercancel', handleCapturedPanEnd, { capture: true, passive: false })
    windowRef?.addEventListener?.('contextmenu', handleCapturedContextMenu, { capture: true, passive: false })
    const unsubscribe = store.subscribe(function (_state, reason) {
      if (!active) return
      if (reason === 'timeline-seek' && !store.getState().playing) {
        const time = store.getState().timeSec
        store.getState().layers.forEach(function (layer) {
          const record = videos.get(layer.id)
          if (record) setVideoTime(record.video, time, finite(layer.source?.probe?.durationSec, 0))
        })
      }
      render()
    })
    if (typeof windowRef?.ResizeObserver === 'function') {
      resizeObserver = new windowRef.ResizeObserver(resizeCanvas)
      resizeObserver.observe(host)
    } else windowRef?.addEventListener?.('resize', resizeCanvas)
    resizeCanvas()
    render()

    const handle = Object.freeze({
      render,
      seek,
      play,
      pause,
      setMaskEditing,
      updateMaskBrush,
      setInteractionLocked,
      fitToViewport,
      getCanvas: function () { return canvas },
      debugSnapshot,
      destroy: function () {
        if (!active) return
        active = false
        cancelFrame(animationFrame)
        animationFrame = 0
        cancelMaskRender()
        unsubscribe?.()
        resizeObserver?.disconnect?.()
        if (!resizeObserver) windowRef?.removeEventListener?.('resize', resizeCanvas)
        canvas.removeEventListener('pointerdown', handlePointerDown)
        canvas.removeEventListener('pointermove', handlePointerMove)
        canvas.removeEventListener('pointerup', finishPointer)
        canvas.removeEventListener('pointercancel', finishPointer)
        canvas.removeEventListener('lostpointercapture', finishPointer)
        canvas.removeEventListener('pointerleave', handlePointerLeave)
        canvas.removeEventListener('wheel', handleWheel)
        canvas.removeEventListener('contextmenu', handleContextMenu)
        windowRef?.removeEventListener?.('pointerdown', handleCapturedPanStart, true)
        windowRef?.removeEventListener?.('pointermove', handleCapturedPanMove, true)
        windowRef?.removeEventListener?.('pointerup', handleCapturedPanEnd, true)
        windowRef?.removeEventListener?.('pointercancel', handleCapturedPanEnd, true)
        windowRef?.removeEventListener?.('contextmenu', handleCapturedContextMenu, true)
        videos.forEach(disposeRecord)
        videos.clear()
        offscreenByLayer.clear()
        interaction = null
        maskEditing = null
        if (mounted.get(host) === handle) mounted.delete(host)
        host.replaceChildren()
      },
    })
    mounted.set(host, handle)
    return handle
  }

  return Object.freeze({ version: 1, mount })
})
