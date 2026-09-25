(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceVideoMergeWorkspace = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const WORKSPACE_ATTRIBUTE = 'data-novaflow-ai-video-merge-workspace'
  const HOST_ACTIVE_ATTRIBUTE = 'data-novaflow-ai-video-merge-host-active'
  const RESOURCE_IMPORT_EVENT = 'novaflow:ai-sequence-video-merge-import-resource'
  const EXPORT_UNAVAILABLE_MESSAGE = '当前环境暂不支持视频合并导出，请在完整的 NovaFlow 桌面版中使用。'
  const PREVIEW_ONLY_MESSAGE = '当前载入的视频仅支持预览，暂时无法导出。'
  const DEFAULT_EXPORT_CAPABILITY = Object.freeze({
    canOpenSession: false,
    canRegisterSource: false,
    canReleaseSource: false,
    canPutMask: false,
    canPickOutput: false,
    canReserveResourceOutput: false,
    canReleaseResourceOutput: false,
    canStartExport: false,
    canExportToFile: false,
    canSaveToResources: false,
    canExport: false,
    available: false,
    message: EXPORT_UNAVAILABLE_MESSAGE,
  })
  let activeHandle = null

  const CSS = `
    [${WORKSPACE_ATTRIBUTE}="1"]{position:absolute;top:0;bottom:0;left:0;right:var(--novaflow-ai-preview-right,calc(var(--novaflow-ai-resource-sidebar-width,260px) + var(--novaflow-ai-resource-sidebar-gap,8px)));z-index:120;display:block;min-width:0;overflow:hidden;background:transparent;color:#f5f5f5;font-family:Inter,"Microsoft YaHei",sans-serif;box-sizing:border-box}
    [${HOST_ACTIVE_ATTRIBUTE}="1"] [data-novaflow-ai-board-controls-top-left="1"]{display:none!important}
    [${WORKSPACE_ATTRIBUTE}="1"] *{box-sizing:border-box}
    [${WORKSPACE_ATTRIBUTE}="1"] button,[${WORKSPACE_ATTRIBUTE}="1"] select,[${WORKSPACE_ATTRIBUTE}="1"] input{font:inherit}
    .nf-vm-panel,.nf-vm-panel *{box-sizing:border-box}.nf-vm-panel button,.nf-vm-panel select,.nf-vm-panel input{font:inherit}
    .nf-vm-body{height:100%;min-height:0;display:block;background:transparent}.nf-vm-body[data-controls-inline="1"]{display:grid;grid-template-columns:220px minmax(0,1fr);gap:1px;background:rgba(255,255,255,.08)}
    .nf-vm-panel{width:calc(100% - 22px);min-width:0;min-height:0;margin:0 11px;padding:10px 0 14px;background:transparent;overflow:visible}.nf-vm-body[data-controls-inline="1"]>.nf-vm-panel{width:auto;margin:0;padding:12px;background:#1b1b1b;overflow:auto}.nf-vm-center{width:100%;height:100%;min-width:0;min-height:0;display:grid;grid-template-rows:minmax(0,1fr) auto;gap:8px;padding:var(--novaflow-ai-sequence-effective-top,59px) 0 0;background:transparent}
    .nf-vm-stage{min-width:0;min-height:0;position:relative;overflow:hidden;margin:0;border-radius:10px;background:var(--novaflow-ai-preview-color,#242424)}.nf-vm-timeline{display:grid;grid-template-columns:34px minmax(0,1fr) 94px;gap:9px;align-items:center;min-height:58px;padding:10px 16px;border:0;border-radius:10px;background:#161616;overflow:hidden}
    .nf-vm-section{margin:0 0 14px}.nf-vm-section:last-child{margin-bottom:0}.nf-vm-section-title{margin:0 0 8px;color:rgba(255,255,255,.72);font-size:11px;font-weight:800;letter-spacing:.04em}
    .nf-vm-layer-toolbar{display:flex;justify-content:flex-end;gap:5px;height:25px;margin-bottom:5px}.nf-vm-btn.nf-vm-layer-move{width:33px;min-width:33px;min-height:25px;height:25px;padding:0;border:0;border-radius:8px;background:#333;color:rgba(238,244,252,.9)}.nf-vm-btn.nf-vm-layer-move:disabled{background:#202020;color:rgba(238,244,252,.38);opacity:1!important}.nf-vm-layer-move i{font-size:11px;pointer-events:none}
    .nf-vm-layer-list{display:flex;flex-direction:column;gap:5px}.nf-vm-layer{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:64px;padding:8px 10px;border:1px solid transparent;border-radius:8px;background:#222;cursor:pointer}
    .nf-vm-layer[aria-selected="true"]{border-color:transparent;background:#333;box-shadow:none}.nf-vm-layer:hover,.nf-vm-layer:focus-within{border-color:rgba(32,201,151,.96);outline:0}.nf-vm-layer-leading{display:flex;align-items:center;gap:8px;min-width:0;flex:1}.nf-vm-layer-thumbnail{position:relative;width:44px;min-width:44px;height:44px;overflow:hidden;border-radius:6px;background:#151515;color:rgba(255,255,255,.45);display:grid;place-items:center}.nf-vm-layer-thumbnail canvas{width:100%;height:100%;display:none;object-fit:cover}.nf-vm-layer-thumbnail[data-ready="1"] canvas{display:block}.nf-vm-layer-thumbnail[data-ready="1"] i{display:none}.nf-vm-layer-thumbnail i{font-size:14px}.nf-vm-layer-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(229,235,242,.92);font-size:11px;font-weight:400}.nf-vm-btn.nf-vm-layer-visibility{width:30px;min-width:30px;min-height:26px;height:26px;padding:0;border:0;border-radius:8px;background:rgba(34,197,94,.18);color:#fff}.nf-vm-btn.nf-vm-layer-visibility[data-visible="0"]{background:#292929;color:rgba(255,255,255,.42)}.nf-vm-btn.nf-vm-layer-remove{width:26px;min-width:26px;min-height:26px;height:26px;padding:0;border:0;background:transparent;color:rgba(255,255,255,.55)}
    .nf-vm-layer[data-drop-active="1"]{border-color:#5be0ad;background:#174333;box-shadow:0 0 0 2px rgba(39,200,137,.22)}.nf-vm-stage[data-drop-active="1"]::after{content:"释放以加入视频图层";position:absolute;inset:12px;z-index:12;display:flex;align-items:center;justify-content:center;border:2px dashed rgba(91,224,173,.85);border-radius:12px;background:rgba(10,61,44,.48);color:#d9fff0;font-size:13px;font-weight:800;pointer-events:none}
    .nf-vm-btn{min-height:30px;padding:0 10px;border:1px solid rgba(255,255,255,.11);border-radius:7px;background:#303030;color:rgba(255,255,255,.84);font-size:11px;cursor:pointer}.nf-vm-btn:hover:not(:disabled){filter:brightness(1.13)}.nf-vm-btn:disabled{opacity:.38;cursor:default}
    .nf-vm-btn-primary{background:linear-gradient(135deg,#1ea672,#188f64);border-color:rgba(84,234,178,.3);color:#effcf6;font-weight:800}.nf-vm-btn-danger{background:#5b2929;color:#ffd6d6}.nf-vm-icon{width:28px;min-width:28px;padding:0}
    [data-novaflow-ai-video-merge-edit-mask="1"]{height:34px;min-height:34px}
    .nf-vm-auto-fit{position:absolute;top:8px;right:0;z-index:14;width:92px;min-width:92px;height:34px;min-height:34px;padding:0 18px;border:0;border-radius:8px;background:#2a2a2a;color:#fff;font-size:13px;font-weight:400;line-height:34px;cursor:pointer}
    .nf-vm-row{display:grid;grid-template-columns:minmax(0,1fr) 49px;gap:8px;align-items:center;margin:8px 0 2px}.nf-vm-label{color:rgba(255,255,255,.7);font-size:11px}input.nf-vm-value{width:49px;min-width:49px;max-width:49px;height:24px;min-height:24px;max-height:24px;padding:0 8px;border:0;border-radius:8px;background:#272727;color:#fff;font-size:11px;line-height:24px;text-align:center;outline:0;box-sizing:border-box;-moz-appearance:textfield;appearance:textfield}input.nf-vm-value::-webkit-inner-spin-button,input.nf-vm-value::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}input.nf-vm-value:disabled{opacity:.48}
    .nf-vm-select{width:100%;height:30px;padding:0 8px;border:1px solid rgba(255,255,255,.12);border-radius:7px;background:#282828;color:#eee;font-size:11px}.nf-vm-range{width:100%;accent-color:#27c889}
    input.nf-vm-range{appearance:none!important;-webkit-appearance:none!important;height:20px!important;min-height:20px!important;padding:0!important;border:0!important;border-radius:0!important;outline:none;background:linear-gradient(to right,#1fc896 0%,#1fc896 var(--nf-vm-fill,0%),#333 var(--nf-vm-fill,0%),#333 100%) center/100% 2px no-repeat!important;cursor:pointer}
    input.nf-vm-range::-webkit-slider-runnable-track{height:2px!important;background:transparent!important;border:0!important}
    input.nf-vm-range::-webkit-slider-thumb{appearance:none!important;-webkit-appearance:none!important;width:12px!important;height:12px!important;margin-top:-5px!important;border:0!important;border-radius:50%!important;background:#d9e2e8!important;box-shadow:none!important}
    .nf-vm-mode{display:grid;grid-template-columns:1fr 1fr;gap:3px;height:37px;padding:3px;border:1px solid #262626;border-radius:8px;background:#101010}.nf-vm-mode .nf-vm-btn{min-height:29px;height:29px;padding:0 6px;border:0;border-radius:7px;background:transparent;color:#eaeaea;font-size:12px;font-weight:500}.nf-vm-mode .nf-vm-btn:hover:not(:disabled){filter:none;background:#303030}.nf-vm-mode .nf-vm-btn[aria-pressed="true"]{border-radius:5px;background:#1c4136;color:#9be4cd;box-shadow:inset 0 0 0 1px #2c604f}.nf-vm-mode .nf-vm-btn:disabled{opacity:.48;cursor:not-allowed}.nf-vm-mode:has(> .nf-vm-btn:disabled){background:transparent;border-color:transparent}
    .nf-vm-mask-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}.nf-vm-mask-help{margin-top:8px;color:rgba(255,255,255,.43);font-size:9px;line-height:1.55}
    .nf-vm-status{min-height:34px;padding:8px;border-radius:7px;background:rgba(255,255,255,.045);color:rgba(255,255,255,.62);font-size:10px;line-height:1.45;word-break:break-word}.nf-vm-status[data-error="1"]{background:rgba(239,68,68,.12);color:#fca5a5}.nf-vm-status[data-success="1"]{background:rgba(39,200,137,.11);color:#8ff0c7}
    .nf-vm-progress{height:5px;margin-top:7px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}.nf-vm-progress>i{display:block;width:0;height:100%;background:#27c889;transition:width .15s linear}
    .nf-vm-time{font-variant-numeric:tabular-nums;color:rgba(255,255,255,.62);font-size:10px;text-align:right}
    .nf-vm-output{min-width:0;margin-top:8px;padding:0;border:0;background:transparent}.nf-vm-output[hidden]{display:none}.nf-vm-output-content{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;align-items:start}.nf-vm-output-status{min-width:0;margin:0}.nf-vm-output-cancel{width:100%;white-space:nowrap}
    @media(max-width:1366px){.nf-vm-body[data-controls-inline="1"]>.nf-vm-panel{padding:10px}}
  `

  function finite(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value))
  }

  function text(value, fallback) {
    const normalized = String(value == null ? '' : value).trim()
    return normalized || fallback
  }

  function formatTime(seconds) {
    const value = Math.max(0, finite(seconds, 0))
    const minutes = Math.floor(value / 60)
    const remaining = value - minutes * 60
    return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(2).padStart(5, '0')}`
  }

  function createElement(documentRef, tagName, attributes, children) {
    const node = documentRef.createElement(tagName)
    Object.entries(attributes || {}).forEach(function (entry) {
      const name = entry[0]
      const value = entry[1]
      if (name === 'className') node.className = String(value || '')
      else if (name === 'text') node.textContent = String(value == null ? '' : value)
      else if (name === 'style') Object.assign(node.style, value || {})
      else if (name in node && !name.startsWith('data-') && !name.startsWith('aria-')) node[name] = value
      else if (value != null) node.setAttribute(name, String(value))
    })
    ;(Array.isArray(children) ? children : [children]).filter(Boolean).forEach(function (child) { node.appendChild(child) })
    return node
  }

  function button(documentRef, label, attributes) {
    return createElement(documentRef, 'button', Object.assign({ type: 'button', className: 'nf-vm-btn', text: label }, attributes || {}))
  }

  function dependencies() {
    const resource = root?.NovaFlowAiSequenceVideoMergeResource
    const resourceBridge = root?.NovaFlowAiSequenceVideoMergeResourceBridge
    const preview = root?.NovaFlowAiSequenceVideoMergePreview
    const mask = root?.NovaFlowAiSequenceVideoMergeMaskTool
    const exportWorkflow = root?.NovaFlowAiSequenceVideoMergeExportWorkflow
    if (!resource?.createStore) throw new Error('视频合并资源模块未加载')
    if (!resourceBridge?.createAdapter || !resourceBridge?.planLayerAssignments) throw new Error('视频合并共享资源桥未加载')
    if (!preview?.mount) throw new Error('视频合并预览模块未加载')
    if (!mask?.createSurface) throw new Error('视频合并蒙版模块未加载')
    if (!exportWorkflow?.createWorkflow) throw new Error('视频合并导出模块未加载')
    return { resource, resourceBridge, preview, mask, exportWorkflow }
  }

  function open(options) {
    const config = options && typeof options === 'object' ? options : {}
    const previewHost = config.previewHost
    if (!previewHost || typeof previewHost.appendChild !== 'function') throw new TypeError('视频合并画板宿主不可用')
    activeHandle?.close?.({ reason: 'replace' })
    const modules = dependencies()
    const dropAdapter = modules.resourceBridge.createAdapter({ assetBridge: config.assetBridge })
    const documentRef = previewHost.ownerDocument || root?.document
    const windowRef = documentRef.defaultView || root
    const documentHost = documentRef.body
    const priorPosition = previewHost.style?.position || ''
    const priorHostActive = previewHost.getAttribute?.(HOST_ACTIVE_ATTRIBUTE)
    const priorDocumentHostActive = documentHost?.getAttribute?.(HOST_ACTIVE_ATTRIBUTE)
    const nativeBoardControls = Array.from(documentHost?.querySelectorAll?.('[data-novaflow-ai-board-controls-top-left="1"]') || []).map(function (node) {
      return {
        node,
        display: node.style?.getPropertyValue?.('display') || '',
        displayPriority: node.style?.getPropertyPriority?.('display') || '',
      }
    })
    let changedHostPosition = false
    function restorePreviewHostPosition() {
      if (!changedHostPosition) return
      changedHostPosition = false
      try {
        if (priorPosition) previewHost.style.setProperty('position', priorPosition)
        else previewHost.style.removeProperty('position')
      } catch (_) {}
    }
    function restorePreviewHostActive() {
      try {
        if (priorHostActive == null) previewHost.removeAttribute?.(HOST_ACTIVE_ATTRIBUTE)
        else previewHost.setAttribute?.(HOST_ACTIVE_ATTRIBUTE, priorHostActive)
        if (priorDocumentHostActive == null) documentHost?.removeAttribute?.(HOST_ACTIVE_ATTRIBUTE)
        else documentHost?.setAttribute?.(HOST_ACTIVE_ATTRIBUTE, priorDocumentHostActive)
        nativeBoardControls.forEach(function (record) {
          if (record.display) record.node.style?.setProperty?.('display', record.display, record.displayPriority)
          else record.node.style?.removeProperty?.('display')
        })
      } catch (_) {}
    }

    let alive = true
    let exporting = false
    let maskEditing = null
    let exportFeedbackVisible = false
    let maskEntryCoverage = null
    let dropBusy = false
    let stageDragDepth = 0
    let renderQueued = false
    let lastSourceIds = new Map()
    let exportCapability = DEFAULT_EXPORT_CAPABILITY
    let exportUnavailableMessage = EXPORT_UNAVAILABLE_MESSAGE
    const maskSurfaces = new Map()
    const layerThumbnails = new Map()

    const shell = createElement(documentRef, 'section', {
      [WORKSPACE_ATTRIBUTE]: '1',
      'data-novaflow-runtime-ignore': '1',
      'aria-label': '视频合并',
    })
    const style = createElement(documentRef, 'style', { 'data-novaflow-ai-video-merge-style': '1', text: CSS })
    const body = createElement(documentRef, 'div', { className: 'nf-vm-body' })
    const leftPanel = createElement(documentRef, 'aside', {
      className: 'nf-vm-panel',
      'data-novaflow-runtime-ignore': '1',
      'data-novaflow-ai-video-merge-layer-panel': '1',
      'data-novaflow-ai-video-merge-control-panel': '1',
    })
    const center = createElement(documentRef, 'main', { className: 'nf-vm-center' })
    const stageHost = createElement(documentRef, 'div', { className: 'nf-vm-stage', 'data-novaflow-ai-video-merge-stage': '1' })
    const timeline = createElement(documentRef, 'div', { className: 'nf-vm-timeline' })
    const playButton = button(documentRef, '▶', { className: 'nf-vm-btn nf-vm-icon', 'aria-label': '播放', 'data-novaflow-ai-video-merge-play': '1' })
    const timelineRange = createElement(documentRef, 'input', { className: 'nf-vm-range', type: 'range', min: '0', max: '0', step: '0.001', value: '0', 'aria-label': '时间轴', 'data-novaflow-ai-video-merge-timeline-range': '1' })
    const timeLabel = createElement(documentRef, 'div', { className: 'nf-vm-time', text: '00:00.00 / 00:00.00' })
    const fitButton = button(documentRef, '自动适配', {
      className: 'nf-vm-auto-fit',
      title: '自动适配',
      'aria-label': '自动适配',
      'data-novaflow-ai-video-merge-auto-fit': '1',
    })
    timeline.append(playButton, timelineRange, timeLabel)
    const outputPanel = createElement(documentRef, 'section', {
      className: 'nf-vm-output',
      'data-novaflow-ai-video-merge-output-panel': '1',
      hidden: true,
    })
    center.append(stageHost, timeline)
    body.append(center)
    shell.append(style, body, fitButton)

    let progressValue = 0
    let progressMessage = ''
    let successMessage = ''
    let workflow = null
    let store = null
    let preview = null
    try {
      const computed = windowRef?.getComputedStyle?.(previewHost)
      if (!computed || computed.position === 'static') {
        previewHost.style.setProperty('position', 'relative')
        changedHostPosition = true
      }
      previewHost.setAttribute?.(HOST_ACTIVE_ATTRIBUTE, '1')
      documentHost?.setAttribute?.(HOST_ACTIVE_ATTRIBUTE, '1')
      nativeBoardControls.forEach(function (record) { record.node.style?.setProperty?.('display', 'none', 'important') })
      previewHost.appendChild(shell)
      const externalControlsHost = config.postSection && typeof config.postSection.appendChild === 'function'
        ? config.postSection
        : null
      if (externalControlsHost) {
        shell.setAttribute('data-novaflow-ai-video-merge-controls-external', '1')
        externalControlsHost.appendChild(leftPanel)
      } else {
        body.setAttribute('data-controls-inline', '1')
        body.insertBefore ? body.insertBefore(leftPanel, center) : body.appendChild(leftPanel)
      }
      workflow = modules.exportWorkflow.createWorkflow({
        electronAPI: config.electronAPI || root?.electronAPI,
        boardId: config.boardId,
        projectId: `video-merge-${text(config.boardId, 'board')}-${Date.now()}`,
        onProgress: function (payload) {
          if (!alive) return
          progressValue = clamp(finite(payload?.progress01, 0), 0, 1)
          progressMessage = text(payload?.message, exporting ? '正在合成…' : '')
          queueRender()
        },
      })
      const reportedCapability = workflow.getCapability?.()
      if (reportedCapability && typeof reportedCapability === 'object') {
        exportCapability = Object.freeze(Object.assign({}, DEFAULT_EXPORT_CAPABILITY, reportedCapability, {
          canOpenSession: reportedCapability.canOpenSession === true,
          canRegisterSource: reportedCapability.canRegisterSource === true,
          canReleaseSource: reportedCapability.canReleaseSource === true,
          canExportToFile: reportedCapability.canExportToFile === true || (reportedCapability.canExportToFile == null && reportedCapability.canExport === true),
          canSaveToResources: reportedCapability.canSaveToResources === true || (reportedCapability.canSaveToResources == null && reportedCapability.canExport === true),
          canExport: reportedCapability.canExport === true,
          available: reportedCapability.available === true || (reportedCapability.available == null && reportedCapability.canExport === true),
        }))
      }
      exportUnavailableMessage = text(exportCapability.message, modules.exportWorkflow.unavailableMessage || EXPORT_UNAVAILABLE_MESSAGE)
      const storeOptions = {
        projectId: `video-merge-${text(config.boardId, 'board')}`,
        getPathForFile: function (file) { return (config.electronAPI || root?.electronAPI)?.getPathForFile?.(file) || file?.path || '' },
      }
      if (exportCapability.canRegisterSource && typeof workflow.registerSource === 'function') {
        storeOptions.registerSource = workflow.registerSource
        if (exportCapability.canReleaseSource && typeof workflow.releaseSource === 'function') storeOptions.releaseSource = workflow.releaseSource
      }
      store = modules.resource.createStore(storeOptions)
      if (!exportCapability.available) store.setMessage(exportUnavailableMessage, false)
      preview = modules.preview.mount({
        host: stageHost,
        store,
        getMaskSurface: function (layerId) { return maskSurfaces.get(layerId) || null },
        onSelectLayer: function () { queueRender() },
        onMaskChange: function (layerId, revision) {
          store.setMaskRevision(layerId, revision)
          queueRender()
        },
        onTime: function () { queueRender() },
        onError: function (error) { store.setMessage(String(error?.message || error), true) },
      })
      fitButton.addEventListener('click', function () { preview?.fitToViewport?.() })
    } catch (error) {
      alive = false
      try { preview?.destroy?.() } catch (_) {}
      try { store?.destroy?.() } catch (_) {}
      try { Promise.resolve(workflow?.close?.()).catch(function () {}) } catch (_) {}
      try { leftPanel.remove() } catch (_) {}
      try { shell.remove() } catch (_) {}
      restorePreviewHostActive()
      restorePreviewHostPosition()
      throw error
    }

    function surfaceIsPristine(surface) {
      if (!surface || typeof surface.copyCoverage !== 'function') return true
      const coverage = surface.copyCoverage()
      for (let index = 0; index < coverage.length; index += 1) if (coverage[index] !== 255) return false
      return true
    }

    function selectedLayer() {
      const state = store.getState()
      return state.layers.find(function (layer) { return layer.id === state.selectedLayerId }) || null
    }

    function projectIsImporting(state) {
      return Number(state?.importingCount) > 0 || Boolean(state?.importingLayerIds?.length) || Boolean(state?.importingLayerId)
    }

    function sourceExportReady(source) {
      return Boolean(source?.sourceId) && source.exportReady === true
    }

    function projectExportUnavailableMessage(state) {
      if (!exportCapability.available) return exportUnavailableMessage
      if (!state?.layers?.every(function (layer) { return Boolean(layer.source) })) return '请先载入两个视频图层'
      if (!state.layers.every(function (layer) { return sourceExportReady(layer.source) })) return PREVIEW_ONLY_MESSAGE
      return ''
    }

    function updateMaskPreview() {
      if (!maskEditing) {
        preview.setMaskEditing({ enabled: false })
        return
      }
      preview.setMaskEditing({
        enabled: true,
        layerId: maskEditing.layerId,
        surface: maskEditing.surface,
        mode: maskEditing.mode,
        brushSize: maskEditing.brushSize,
        feather: maskEditing.feather,
      })
    }

    function beginMaskEditing() {
      if (maskEditing?.layerId === selectedLayer()?.id) return true
      if (exporting || projectIsImporting(store.getState())) return false
      const layer = selectedLayer()
      if (!layer?.source) {
        store.setMessage('请先为当前图层载入视频', true)
        return false
      }
      if (maskEditing) applyMaskEditing()
      preview.pause()
      let surface = maskSurfaces.get(layer.id)
      if (!surface) {
        surface = modules.mask.createSurface({ width: layer.source.probe.displayWidth, height: layer.source.probe.displayHeight })
        maskSurfaces.set(layer.id, surface)
        maskEntryCoverage = null
      } else maskEntryCoverage = surface.copyCoverage()
      maskEditing = { layerId: layer.id, surface, mode: 'erase', brushSize: 22, feather: 0 }
      updateMaskPreview()
      queueRender()
      const previewCanvas = preview.getCanvas?.()
      try {
        previewCanvas?.focus?.({ preventScroll: true })
      } catch (_) {
        try { previewCanvas?.focus?.() } catch (_) {}
      }
      return true
    }

    function applyMaskEditing() {
      if (!maskEditing) return false
      const revision = maskEditing.surface.debugState().revision
      store.setMaskRevision(maskEditing.layerId, revision)
      maskEditing = null
      maskEntryCoverage = null
      updateMaskPreview()
      queueRender()
      return true
    }

    function cancelMaskEditing() {
      if (!maskEditing) return false
      if (maskEntryCoverage) maskEditing.surface.reset(maskEntryCoverage)
      else {
        maskEditing.surface.destroy()
        maskSurfaces.delete(maskEditing.layerId)
        store.setMaskRevision(maskEditing.layerId, 0)
      }
      maskEditing = null
      maskEntryCoverage = null
      updateMaskPreview()
      queueRender()
      return true
    }

    function destroyLayerMask(layerId) {
      if (maskEditing?.layerId === layerId) cancelMaskEditing()
      const surface = maskSurfaces.get(layerId)
      surface?.destroy?.()
      maskSurfaces.delete(layerId)
      store.setMaskRevision(layerId, 0)
    }

    function dropPayloadSupported(dataTransfer) {
      const types = (() => { try { return Array.from(dataTransfer?.types || []).map(String) } catch (_) { return [] } })()
      return Boolean(
        modules.resourceBridge.readResourceId?.(dataTransfer) ||
        types.includes('Files') ||
        types.includes(modules.resourceBridge.RESOURCE_MIME)
      )
    }

    function clearDropHighlights() {
      stageDragDepth = 0
      stageHost.removeAttribute('data-drop-active')
      leftPanel.querySelectorAll?.('[data-drop-active="1"]').forEach(function (node) { node.removeAttribute('data-drop-active') })
    }

    function dropErrorMessage(error) {
      const code = String(error?.message || error || '')
      if (code.includes('unsupported') || code.includes('no_supported')) return '仅支持拖入 MP4 或 WebM 视频'
      if (code.includes('drop_empty')) return '没有从拖拽内容中读取到视频文件'
      if (code.includes('resource_not_found') || code.includes('resource not found')) return '共享资源已失效，请刷新资源列表后重试'
      if (code.includes('stable local path') || code.includes('source_missing')) return '该视频资源暂时无法取得稳定本地文件'
      if (code.includes('asset_bridge') || code.includes('resource_resolver') || code.includes('resource_importer')) return '共享资源服务尚未就绪，请稍后重试'
      return code || '视频拖入失败'
    }

    async function importResolvedVideos(resolveVideos, explicitLayerId, loadingMessage) {
      clearDropHighlights()
      const before = store.getState()
      if (exporting || dropBusy || projectIsImporting(before)) {
        store.setMessage('请等待当前视频任务完成', true)
        queueRender()
        return false
      }
      if (maskEditing) applyMaskEditing()
      dropBusy = true
      successMessage = ''
      store.setMessage(text(loadingMessage, '正在读取拖入的视频…'), false)
      preview.pause()
      preview.setInteractionLocked?.(true)
      queueRender()
      try {
        const resolved = await resolveVideos()
        if (!alive) return false
        const descriptors = Array.from(resolved?.descriptors || [])
        const current = store.getState()
        const assignments = modules.resourceBridge.planLayerAssignments(current.layers, descriptors, explicitLayerId)
        if (!assignments.length) {
          const prefix = resolved?.kind === 'files' ? `${descriptors.length} 个视频已加入右侧资源列表；` : ''
          store.setMessage(`${prefix}两个图层都已有视频，请拖到需要替换的图层卡片`, true)
          return false
        }
        for (let index = 0; index < assignments.length; index += 1) {
          const assignment = assignments[index]
          const descriptor = assignment?.descriptor
          if (!descriptor || !assignment?.layerId) break
          if (descriptor.file) await store.importFile(assignment.layerId, descriptor.file)
          else await store.importDescriptor(assignment.layerId, {
            path: descriptor.localPath,
            name: descriptor.fileName,
            type: descriptor.mimeType,
            blob: descriptor.blob,
            objectUrl: descriptor.objectUrl,
            ownedObjectUrl: descriptor.ownedObjectUrl === true,
          })
          if (!alive) return false
          destroyLayerMask(assignment.layerId)
        }
        const remaining = Math.max(0, descriptors.length - assignments.length)
        const rejected = Math.max(0, Number(resolved?.rejectedCount) || 0)
        successMessage = `${assignments.length} 个视频已加入合并图层${remaining ? `，其余 ${remaining} 个保留在资源列表` : ''}${rejected ? `；忽略 ${rejected} 个非视频文件` : ''}`
        store.setMessage(successMessage, false)
        return true
      } catch (error) {
        if (alive) store.setMessage(dropErrorMessage(error), true)
        return false
      } finally {
        dropBusy = false
        if (alive) {
          preview.setInteractionLocked?.(exporting)
          queueRender()
        }
      }
    }

    function importDroppedVideos(dataTransfer, explicitLayerId) {
      return importResolvedVideos(
        function () { return dropAdapter.resolveDrop(dataTransfer) },
        explicitLayerId,
        '正在读取拖入的视频…',
      )
    }

    function importSharedResource(resourceId, explicitLayerId) {
      const normalizedId = text(resourceId, '')
      if (!normalizedId) return Promise.resolve(false)
      return importResolvedVideos(
        async function () {
          return Object.freeze({
            kind: 'resource',
            descriptors: Object.freeze([await dropAdapter.resolveResource(normalizedId)]),
            rejectedCount: 0,
          })
        },
        explicitLayerId,
        '正在读取共享视频…',
      )
    }

    function dropLayerIdFromTarget(target) {
      const card = target?.closest?.('[data-novaflow-ai-video-merge-layer]')
      if (!card || (typeof shell.contains === 'function' && !shell.contains(card))) return ''
      return text(card.getAttribute?.('data-novaflow-ai-video-merge-layer'), '')
    }

    function isInsideDropTarget(target, container) {
      return Boolean(target && container && (target === container || container.contains?.(target)))
    }

    function handleDocumentDrop(event) {
      const explicitLayerId = dropLayerIdFromTarget(event?.target)
      if (!explicitLayerId && !isInsideDropTarget(event?.target, stageHost)) return
      if (!prepareDropEvent(event)) {
        clearDropHighlights()
        return
      }
      clearDropHighlights()
      void importDroppedVideos(event.dataTransfer, explicitLayerId)
    }

    function handleDocumentDragEnd() {
      clearDropHighlights()
    }

    function handleSharedResourceImport(event) {
      const resourceId = text(event?.detail?.resourceId, '')
      if (!resourceId) return
      event.preventDefault?.()
      void importSharedResource(resourceId, text(event?.detail?.layerId, ''))
    }

    function requestClose(reason) {
      if (!alive) return
      if (exporting) {
        store.setMessage('正在导出，请先取消导出任务', true)
        return
      }
      if (typeof config.onRequestClose === 'function') config.onRequestClose(reason || 'close')
      else handle.close({ reason: reason || 'close' })
    }

    async function runExport(options) {
      const exportOptions = options && typeof options === 'object' ? options : {}
      const publishToResources = exportOptions.publishToResources === true
      if (exporting || dropBusy) return { ok: false, blocked: true }
      exportFeedbackVisible = true
      if (maskEditing) applyMaskEditing()
      const state = store.getSnapshot()
      const requestedCapability = publishToResources
        ? exportCapability.canSaveToResources
        : exportCapability.canExportToFile
      const canRunRequestedExport = requestedCapability || (requestedCapability == null && exportCapability.canExport)
      if (!canRunRequestedExport) {
        store.setMessage(exportUnavailableMessage, false)
        return { ok: false, unavailable: true }
      }
      if (projectIsImporting(state)) {
        store.setMessage('请等待当前视频载入完成', true)
        return { ok: false, blocked: true }
      }
      const unavailableMessage = projectExportUnavailableMessage(state)
      if (unavailableMessage) {
        store.setMessage(unavailableMessage, !state.layers.every(function (layer) { return Boolean(layer.source) }))
        return { ok: false, unavailable: true }
      }
      store.setMessage('', false)
      exporting = true
      preview.setInteractionLocked?.(true)
      progressValue = 0
      progressMessage = publishToResources ? '正在合成并保存到资源列表…' : '准备导出…'
      successMessage = ''
      queueRender()
      let exportedFilePath = ''
      let resourcePublished = false
      try {
        const result = await workflow.exportProject(state, maskSurfaces, {
          baseName: 'novaflow_video_merge',
          destination: publishToResources ? 'resource' : 'file',
        })
        if (result?.canceled) {
          exportFeedbackVisible = false
          progressMessage = ''
          successMessage = ''
          return { ok: false, canceled: true }
        }
        exportedFilePath = text(result?.output?.filePath || result?.filePath, '')
        if (!exportedFilePath) throw new Error('video_merge_output_path_missing')
        let resource = null
        if (publishToResources) {
          progressValue = 1
          progressMessage = '正在加入资源列表…'
          queueRender()
          resource = await dropAdapter.publishExportedVideo({
            filePath: exportedFilePath,
            mimeType: state.format === 'webm' ? 'video/webm' : 'video/mp4',
          })
          resourcePublished = true
        }
        successMessage = publishToResources
          ? '已保存到资源列表'
          : `导出完成：${exportedFilePath}`
        progressMessage = ''
        if (publishToResources) {
          if (typeof config.onExportComplete === 'function') config.onExportComplete({ result, resource, filePath: exportedFilePath })
          else handle.close({ reason: 'export-complete' })
        }
        return { ok: true, result, resource, filePath: exportedFilePath }
      } catch (error) {
        const message = String(error?.message || error)
        if (publishToResources && exportedFilePath && !resourcePublished) {
          try { await workflow.releaseResourceOutput?.(exportedFilePath) } catch (_) {}
        }
        store.setMessage(publishToResources ? `保存到资源列表失败：${message}` : message, true)
        progressMessage = ''
        return { ok: false, error: message, filePath: exportedFilePath }
      } finally {
        exporting = false
        if (alive) {
          preview.setInteractionLocked?.(false)
          progressValue = 0
          queueRender()
        }
      }
    }

    function startExport() {
      return runExport({ publishToResources: false })
    }

    function saveAndClose() {
      return runExport({ publishToResources: true })
    }

    async function cancelExport() {
      if (!exporting) return
      progressMessage = '正在取消…'
      queueRender()
      try { await workflow.cancel() } catch (_) {}
    }

    function prepareDropEvent(event) {
      if (!dropPayloadSupported(event?.dataTransfer)) return false
      event.preventDefault?.()
      event.stopPropagation?.()
      try {
        const blocked = exporting || dropBusy || projectIsImporting(store.getState())
        event.dataTransfer.dropEffect = blocked ? 'none' : 'copy'
      } catch (_) {}
      return true
    }

    function bindLayerDropTarget(card, layerId) {
      card.addEventListener('dragenter', function (event) {
        if (!prepareDropEvent(event)) return
        if (!exporting && !dropBusy && !projectIsImporting(store.getState())) card.setAttribute('data-drop-active', '1')
      })
      card.addEventListener('dragover', prepareDropEvent)
      card.addEventListener('dragleave', function (event) {
        if (event.relatedTarget && card.contains?.(event.relatedTarget)) return
        card.removeAttribute('data-drop-active')
      })
      card.addEventListener('drop', function (event) {
        if (!prepareDropEvent(event)) return
        clearDropHighlights()
        void importDroppedVideos(event.dataTransfer, layerId)
      })
    }

    function layerMeta(layer) {
      if (!layer.source) return '拖入共享资源或本地视频'
      const probe = layer.source.probe
      const alpha = probe.hasAlpha ? ' · Alpha' : ''
      return `${probe.displayWidth}×${probe.displayHeight} · ${formatTime(probe.durationSec)}${alpha}`
    }

    function disposeThumbnailVideo(record) {
      const video = record?.video
      if (!video) return
      ;(record.listeners || []).forEach(function (entry) {
        try { video.removeEventListener?.(entry[0], entry[1]) } catch (_) {}
      })
      record.listeners = []
      try { video.pause?.() } catch (_) {}
      try { video.removeAttribute?.('src') } catch (_) {}
      try { video.load?.() } catch (_) {}
      try { video.remove?.() } catch (_) {}
      record.video = null
    }

    function releaseLayerThumbnail(layerId) {
      const record = layerThumbnails.get(layerId)
      if (!record) return
      record.disposed = true
      disposeThumbnailVideo(record)
      layerThumbnails.delete(layerId)
    }

    function ensureLayerThumbnail(layer) {
      const source = layer?.source
      const sourceUrl = text(source?.objectUrl, '')
      const sourceKey = text(`${source?.sourceId || ''}|${sourceUrl}|${source?.fileName || ''}`, '')
      const current = layerThumbnails.get(layer.id)
      if (!source || !sourceUrl || !sourceKey) {
        if (current) releaseLayerThumbnail(layer.id)
        return null
      }
      if (current?.sourceKey === sourceKey) return current
      if (current) releaseLayerThumbnail(layer.id)

      const canvas = createElement(documentRef, 'canvas', {
        width: 88,
        height: 88,
        'aria-hidden': 'true',
        'data-novaflow-ai-video-merge-layer-thumbnail-canvas': '1',
      })
      const record = { sourceKey, canvas, ready: false, disposed: false, video: null, listeners: [] }
      layerThumbnails.set(layer.id, record)
      if (typeof canvas.getContext !== 'function') return record
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) return record

      const video = createElement(documentRef, 'video', { preload: 'auto', muted: true, playsInline: true, disablePictureInPicture: true })
      record.video = video
      video.setAttribute?.('webkit-playsinline', 'true')
      const drawFrame = function () {
        if (record.disposed || layerThumbnails.get(layer.id) !== record || finite(video.readyState, 0) < 2) return
        const sourceWidth = Math.max(1, finite(video.videoWidth, source.probe?.displayWidth || 1))
        const sourceHeight = Math.max(1, finite(video.videoHeight, source.probe?.displayHeight || 1))
        const cropSize = Math.min(sourceWidth, sourceHeight)
        const cropX = (sourceWidth - cropSize) / 2
        const cropY = (sourceHeight - cropSize) / 2
        try {
          context.clearRect(0, 0, 88, 88)
          context.drawImage(video, cropX, cropY, cropSize, cropSize, 0, 0, 88, 88)
          record.ready = true
          canvas.setAttribute?.('data-ready', '1')
          disposeThumbnailVideo(record)
          queueRender()
        } catch (_) {}
      }
      const handleError = function () {
        if (record.disposed) return
        disposeThumbnailVideo(record)
        queueRender()
      }
      record.listeners = [['loadeddata', drawFrame], ['seeked', drawFrame], ['error', handleError]]
      record.listeners.forEach(function (entry) { video.addEventListener?.(entry[0], entry[1]) })
      try {
        video.src = sourceUrl
        video.load?.()
        drawFrame()
      } catch (_) { handleError() }
      return record
    }

    function renderLayerPanel(state) {
      const editingLocked = exporting || dropBusy || projectIsImporting(state)
      const selectedLayer = state.layers.find(function (layer) { return layer.id === state.selectedLayerId }) || null
      const section = createElement(documentRef, 'section', { className: 'nf-vm-section' })
      section.appendChild(createElement(documentRef, 'h3', { className: 'nf-vm-section-title', text: '视频图层（上层在前）' }))
      const toolbar = createElement(documentRef, 'div', {
        className: 'nf-vm-layer-toolbar',
        'data-novaflow-ai-video-merge-layer-toolbar': '1',
      })
      const down = button(documentRef, '', {
        className: 'nf-vm-btn nf-vm-layer-move',
        title: '下移一层',
        'aria-label': '下移选中图层',
        'data-novaflow-ai-video-merge-move': 'down',
        disabled: editingLocked || !selectedLayer || state.layers[0]?.id === selectedLayer.id,
      })
      down.appendChild(createElement(documentRef, 'i', { className: 'fas fa-arrow-down', 'aria-hidden': 'true' }))
      down.addEventListener('click', function () { if (selectedLayer) store.moveLayer(selectedLayer.id, -1) })
      const up = button(documentRef, '', {
        className: 'nf-vm-btn nf-vm-layer-move',
        title: '上移一层',
        'aria-label': '上移选中图层',
        'data-novaflow-ai-video-merge-move': 'up',
        disabled: editingLocked || !selectedLayer || state.layers[state.layers.length - 1]?.id === selectedLayer.id,
      })
      up.appendChild(createElement(documentRef, 'i', { className: 'fas fa-arrow-up', 'aria-hidden': 'true' }))
      up.addEventListener('click', function () { if (selectedLayer) store.moveLayer(selectedLayer.id, 1) })
      toolbar.append(down, up)
      section.appendChild(toolbar)
      const list = createElement(documentRef, 'div', { className: 'nf-vm-layer-list' })
      state.layers.slice().reverse().forEach(function (layer) {
        const displayName = layer.source?.fileName || layer.title
        const card = createElement(documentRef, 'article', {
          className: 'nf-vm-layer',
          'data-novaflow-ai-video-merge-layer': layer.id,
          'aria-selected': state.selectedLayerId === layer.id ? 'true' : 'false',
          title: `${displayName} · ${layerMeta(layer)}`,
          tabindex: '0',
        })
        const visibilityLabel = layer.visible ? '隐藏图层' : '显示图层'
        const visibility = button(documentRef, '', {
          className: 'nf-vm-btn nf-vm-layer-visibility',
          title: visibilityLabel,
          'aria-label': visibilityLabel,
          'data-visible': layer.visible ? '1' : '0',
          disabled: editingLocked,
        })
        visibility.appendChild(createElement(documentRef, 'i', { className: layer.visible ? 'fas fa-eye' : 'fas fa-eye-slash', 'aria-hidden': 'true' }))
        visibility.addEventListener('click', function (event) { event.stopPropagation(); store.toggleVisibility(layer.id) })
        const thumbnailRecord = ensureLayerThumbnail(layer)
        const thumbnail = createElement(documentRef, 'span', {
          className: 'nf-vm-layer-thumbnail',
          'data-ready': thumbnailRecord?.ready ? '1' : '0',
          'data-novaflow-ai-video-merge-layer-thumbnail': layer.id,
          'aria-hidden': 'true',
        })
        if (thumbnailRecord?.canvas) thumbnail.appendChild(thumbnailRecord.canvas)
        thumbnail.appendChild(createElement(documentRef, 'i', { className: 'fas fa-video', 'aria-hidden': 'true' }))
        const leading = createElement(documentRef, 'div', { className: 'nf-vm-layer-leading' })
        leading.append(
          visibility,
          thumbnail,
          createElement(documentRef, 'span', { className: 'nf-vm-layer-name', text: displayName }),
        )
        const remove = button(documentRef, '×', { className: 'nf-vm-btn nf-vm-layer-remove', title: '移除视频', disabled: editingLocked || !layer.source })
        remove.addEventListener('click', function (event) {
          event.stopPropagation()
          preview.pause()
          destroyLayerMask(layer.id)
          store.removeSource(layer.id)
        })
        card.append(leading, remove)
        card.addEventListener('click', function () {
          if (maskEditing && maskEditing.layerId !== layer.id) applyMaskEditing()
          store.selectLayer(layer.id)
        })
        bindLayerDropTarget(card, layer.id)
        list.appendChild(card)
      })
      section.appendChild(list)
      return section
    }

    function paintRange(input) {
      const min = Number(input.min) || 0, max = Number(input.max) || 1
      input.style.setProperty('--nf-vm-fill', Math.max(0, Math.min(100, (Number(input.value) - min) / Math.max(1, max - min) * 100)) + '%')
      input.style.setProperty('background', 'linear-gradient(to right,#1fc896 0%,#1fc896 var(--nf-vm-fill,0%),#333 var(--nf-vm-fill,0%),#333 100%) center / 100% 2px no-repeat', 'important')
    }

    function rangeRow(label, value, minimum, maximum, step, onInput, suffix) {
      const wrapper = createElement(documentRef, 'div')
      const row = createElement(documentRef, 'div', { className: 'nf-vm-row' })
      const labelNode = createElement(documentRef, 'span', { className: 'nf-vm-label', text: label })
      const valueNode = createElement(documentRef, 'input', { className: 'nf-vm-value', type: 'number', min: String(minimum), max: String(maximum), step: String(step), value: String(Math.round(value)), 'aria-label': label })
      const input = createElement(documentRef, 'input', { className: 'nf-vm-range', type: 'range', min: String(minimum), max: String(maximum), step: String(step), value: String(value) })
      paintRange(input)
      input.addEventListener('input', function () {
        paintRange(input)
        valueNode.value = String(Math.round(finite(input.value, value)))
        onInput(finite(input.value, value))
      })
      const commitValue = function () {
        const next = clamp(finite(valueNode.value, finite(input.value, value)), minimum, maximum)
        valueNode.value = String(Math.round(next))
        input.value = String(next)
        paintRange(input)
        onInput(next)
      }
      valueNode.addEventListener('change', commitValue)
      valueNode.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return
        event.preventDefault()
        commitValue()
        valueNode.blur()
      })
      void suffix
      row.append(labelNode, valueNode)
      wrapper.append(row, input)
      return wrapper
    }

    function renderLayerTools(state) {
      const layer = state.layers.find(function (candidate) { return candidate.id === state.selectedLayerId })
      const importing = projectIsImporting(state)
      const fragment = documentRef.createDocumentFragment()

      const maskSection = createElement(documentRef, 'section', { className: 'nf-vm-section', 'data-novaflow-ai-video-merge-mask-panel': '1' })
      if (!maskEditing) {
        const mode = createElement(documentRef, 'div', { className: 'nf-vm-mode' })
        mode.append(button(documentRef, '擦除', { disabled: true }), button(documentRef, '修复', { disabled: true }))
        maskSection.appendChild(mode)
        for (const row of [rangeRow('笔刷', 22, 1, 200, 1, () => {}, ''), rangeRow('羽化', 0, 0, 100, 1, () => {}, '')]) {
          row.querySelectorAll('input').forEach(function (node) { node.disabled = true })
          maskSection.appendChild(row)
        }
        maskSection.appendChild(createElement(documentRef, 'div', { className: 'nf-vm-mask-help', text: '载入并选中视频图层后，可直接擦除或修复蒙版。' }))
      } else {
        maskSection.appendChild(createElement(documentRef, 'h3', { className: 'nf-vm-section-title', text: '蒙版编辑（应用全部帧）' }))
        const mode = createElement(documentRef, 'div', { className: 'nf-vm-mode' })
        const erase = button(documentRef, '擦除', { 'aria-pressed': maskEditing.mode === 'erase' ? 'true' : 'false' })
        const restore = button(documentRef, '修复', { 'aria-pressed': maskEditing.mode === 'restore' ? 'true' : 'false' })
        erase.addEventListener('click', function () { maskEditing.mode = 'erase'; preview.updateMaskBrush({ mode: 'erase' }); queueRender() })
        restore.addEventListener('click', function () { maskEditing.mode = 'restore'; preview.updateMaskBrush({ mode: 'restore' }); queueRender() })
        mode.append(erase, restore)
        maskSection.appendChild(mode)
        maskSection.appendChild(rangeRow('笔刷', maskEditing.brushSize, 1, 200, 1, function (value) {
          maskEditing.brushSize = value
          preview.updateMaskBrush({ brushSize: value })
        }, ''))
        maskSection.appendChild(rangeRow('羽化', maskEditing.feather, 0, 100, 1, function (value) {
          maskEditing.feather = value
          preview.updateMaskBrush({ feather: value })
        }, ''))
        maskSection.appendChild(createElement(documentRef, 'div', { className: 'nf-vm-mask-help', text: '蒙版始终影响全部帧。Ctrl+Z 撤销，Ctrl+Shift+Z / Ctrl+Y 重做；[ ] 调笔刷，- / + 调羽化。' }))
      }
      fragment.appendChild(maskSection)

      return fragment
    }

    function renderLeftPanel(state) {
      const fragment = documentRef.createDocumentFragment()
      const actions = createElement(documentRef, 'div', { 'data-nf-tool-panel-actions': '1' })
      Object.assign(actions.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', paddingTop: '12px', marginBottom: '12px' })
      const confirm = button(documentRef, '确定', { 'data-nf-merge-confirm': '1', disabled: exporting, className: 'nf-vm-btn nf-vm-btn-primary' })
      const cancel = button(documentRef, '取消', { 'data-nf-merge-cancel': '1', disabled: exporting })
      confirm.addEventListener('click', () => saveAndClose())
      cancel.addEventListener('click', () => requestClose('panel-cancel'))
      actions.append(confirm, cancel)
      fragment.appendChild(actions)
      fragment.appendChild(renderLayerTools(state))
      fragment.appendChild(renderLayerPanel(state))
      fragment.appendChild(outputPanel)
      leftPanel.replaceChildren(fragment)
    }

    function renderOutputPanel(state) {
      const unavailableMessage = projectExportUnavailableMessage(state)
      const loadedButPreviewOnly = state.layers.every(function (layer) { return Boolean(layer.source) }) && Boolean(unavailableMessage)
      const primaryStatus = state.error || progressMessage || successMessage || state.message || ''
      const availabilityNotice = (!exportCapability.available || loadedButPreviewOnly) ? unavailableMessage : ''
      const statusText = primaryStatus && availabilityNotice && primaryStatus !== availabilityNotice
        ? `${primaryStatus} · ${availabilityNotice}`
        : (primaryStatus || availabilityNotice || '等待操作')
      const feedbackVisible = exportFeedbackVisible || exporting || Boolean(state.error)
      outputPanel.hidden = !feedbackVisible
      if (!feedbackVisible) {
        outputPanel.replaceChildren()
        return
      }

      const content = createElement(documentRef, 'div', { className: 'nf-vm-output-content' })
      const status = createElement(documentRef, 'div', {
        className: 'nf-vm-status nf-vm-output-status', text: statusText,
        'data-error': state.error ? '1' : '0',
        'data-success': successMessage && !state.error ? '1' : '0',
      })
      if (exporting || progressValue > 0) {
        const progress = createElement(documentRef, 'div', { className: 'nf-vm-progress' })
        progress.appendChild(createElement(documentRef, 'i', { style: { width: `${Math.round(progressValue * 100)}%` } }))
        status.appendChild(progress)
      }
      content.appendChild(status)
      if (exporting) {
        const cancel = button(documentRef, '取消导出', { className: 'nf-vm-btn nf-vm-btn-danger nf-vm-output-cancel' })
        cancel.addEventListener('click', cancelExport)
        content.appendChild(cancel)
      }
      outputPanel.replaceChildren(content)
    }

    function renderTimeline(state) {
      const duration = store.projectDurationSec()
      timelineRange.max = String(Math.max(0, duration))
      timelineRange.value = String(clamp(state.timeSec, 0, Math.max(0, duration)))
      paintRange(timelineRange)
      timelineRange.disabled = duration <= 0
      playButton.textContent = state.playing ? 'Ⅱ' : '▶'
      playButton.setAttribute('aria-label', state.playing ? '暂停' : '播放')
      playButton.disabled = duration <= 0 || dropBusy
      timeLabel.textContent = `${formatTime(state.timeSec)} / ${formatTime(duration)}`
    }

    function render() {
      if (!alive) return
      renderQueued = false
      const state = store.getState()
      if (!exporting && !dropBusy && !projectIsImporting(state)) {
        const selected = state.layers.find(layer => layer.id === state.selectedLayerId)
        if (selected?.source && maskEditing?.layerId !== selected.id) beginMaskEditing()
        else if (!selected?.source && maskEditing) applyMaskEditing()
      }
      renderLeftPanel(state)
      renderOutputPanel(state)
      renderTimeline(state)
      preview.render()
    }

    function queueRender() {
      if (!alive || renderQueued) return
      renderQueued = true
      Promise.resolve().then(render)
    }

    const unsubscribe = store.subscribe(function (state) {
      state.layers.forEach(function (layer) {
        const nextId = layer.source?.sourceId || ''
        const previousId = lastSourceIds.get(layer.id) || ''
        if (previousId && nextId !== previousId) {
          const surface = maskSurfaces.get(layer.id)
          surface?.destroy?.()
          maskSurfaces.delete(layer.id)
        }
        lastSourceIds.set(layer.id, nextId)
      })
      queueRender()
    })

    stageHost.addEventListener('dragenter', function (event) {
      if (!prepareDropEvent(event)) return
      if (event.relatedTarget && stageHost.contains?.(event.relatedTarget)) return
      stageDragDepth += 1
      if (!exporting && !dropBusy && !projectIsImporting(store.getState())) stageHost.setAttribute('data-drop-active', '1')
    }, true)
    stageHost.addEventListener('dragover', prepareDropEvent, true)
    stageHost.addEventListener('dragleave', function (event) {
      if (event.relatedTarget && stageHost.contains?.(event.relatedTarget)) return
      stageDragDepth = Math.max(0, stageDragDepth - 1)
      if (stageDragDepth === 0) stageHost.removeAttribute('data-drop-active')
    }, true)
    stageHost.addEventListener('drop', function (event) {
      if (!prepareDropEvent(event)) return
      clearDropHighlights()
      void importDroppedVideos(event.dataTransfer, '')
    }, true)
    documentRef.addEventListener('drop', handleDocumentDrop, true)
    documentRef.addEventListener('dragend', handleDocumentDragEnd, true)
    windowRef.addEventListener(RESOURCE_IMPORT_EVENT, handleSharedResourceImport)
    playButton.addEventListener('click', function () { store.getState().playing ? preview.pause() : void preview.play() })
    timelineRange.addEventListener('input', function () { preview.seek(finite(timelineRange.value, 0)) })
    function handleMaskShortcut(event) {
      if (!maskEditing) return
      const tag = String(event.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return
      const editableTarget = event.target?.closest?.('[contenteditable]')
      if (event.target?.isContentEditable || (editableTarget && String(editableTarget.getAttribute?.('contenteditable') || 'true').toLowerCase() !== 'false')) return
      const key = String(event.key || '')
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) maskEditing.surface.redo()
        else maskEditing.surface.undo()
        store.setMaskRevision(maskEditing.layerId, maskEditing.surface.debugState().revision)
        preview.render(); queueRender(); return
      }
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'y') {
        event.preventDefault(); maskEditing.surface.redo(); store.setMaskRevision(maskEditing.layerId, maskEditing.surface.debugState().revision); preview.render(); queueRender(); return
      }
      const adjustmentShortcut = !event.ctrlKey && !event.metaKey && !event.altKey
      if (adjustmentShortcut && (key === '[' || key === ']')) {
        event.preventDefault()
        event.stopPropagation()
        maskEditing.brushSize = clamp(maskEditing.brushSize + (key === ']' ? 2 : -2), 1, 200)
        preview.updateMaskBrush({ brushSize: maskEditing.brushSize }); queueRender(); return
      }
      const code = String(event.code || '')
      const featherDelta = code === 'Minus' || code === 'NumpadSubtract' || key === '-'
        ? -1
        : (code === 'Equal' || code === 'NumpadAdd' || key === '=' || key === '+' ? 1 : 0)
      if (adjustmentShortcut && featherDelta) {
        event.preventDefault()
        event.stopPropagation()
        maskEditing.feather = clamp(maskEditing.feather + featherDelta, 0, 100)
        preview.updateMaskBrush({ feather: maskEditing.feather }); queueRender(); return
      }

    }
    shell.addEventListener('keydown', handleMaskShortcut)
    leftPanel.addEventListener('keydown', handleMaskShortcut)

    const handle = Object.freeze({
      open: function () { return handle },
      getStore: function () { return store },
      getPreview: function () { return preview },
      getMaskSurface: function (layerId) { return maskSurfaces.get(layerId) || null },
      importResource: importSharedResource,
      export: startExport,
      saveAndClose,
      cancelExport,
      requestClose,
      debugSnapshot: function () {
        return Object.freeze({
          open: alive,
          exporting,
          dropBusy,
          maskEditing: maskEditing?.layerId || '',
          layerCount: store.getState().layers.length,
          sourceCount: store.getState().layers.filter(function (layer) { return Boolean(layer.source) }).length,
          maskCount: maskSurfaces.size,
          thumbnailCount: layerThumbnails.size,
          exportCapability,
          preview: preview.debugSnapshot(),
        })
      },
      close: function (closeOptions) {
        if (!alive) return false
        alive = false
        exporting = false
        unsubscribe?.()
        documentRef.removeEventListener('drop', handleDocumentDrop, true)
        documentRef.removeEventListener('dragend', handleDocumentDragEnd, true)
        windowRef.removeEventListener(RESOURCE_IMPORT_EVENT, handleSharedResourceImport)
        preview.destroy()
        maskSurfaces.forEach(function (surface) { surface?.destroy?.() })
        maskSurfaces.clear()
        Array.from(layerThumbnails.keys()).forEach(releaseLayerThumbnail)
        clearDropHighlights()
        store.destroy()
        void workflow.close().catch(function () {})
        leftPanel.remove()
        shell.remove()
        restorePreviewHostActive()
        restorePreviewHostPosition()
        if (activeHandle === handle) activeHandle = null
        try { config.onClosed?.(closeOptions?.reason || 'close') } catch (_) {}
        return true
      },
    })
    activeHandle = handle
    render()

    if (exportCapability.canRegisterSource) {
      void workflow.openSession({ boardId: config.boardId, projectId: store.getState().projectId }).catch(function (error) {
        if (alive) store.setMessage(String(error?.message || error), true)
      })
    }
    return handle
  }

  function close(options) {
    return activeHandle?.close?.(options || {}) || false
  }

  function saveAndClose() {
    return activeHandle?.saveAndClose?.() || Promise.resolve({ ok: false, inactive: true })
  }

  function exportToFile() {
    return activeHandle?.export?.() || Promise.resolve({ ok: false, inactive: true })
  }

  function isOpen() {
    return Boolean(activeHandle?.debugSnapshot?.().open)
  }

  return Object.freeze({ version: 3, RESOURCE_IMPORT_EVENT, open, close, saveAndClose, exportToFile, isOpen })
})
