(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignBridge = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const STORAGE_KEY = 'novaflow-ui-design-project-v1'
  const INITIALIZED_STORAGE_KEY = 'novaflow-ui-design-project-initialized-v1'
  const CLIENT_AUTH_STORAGE_KEY = 'novaflow.client.auth.session.v1'
  const ACTIVE_ATTRIBUTE = 'data-novaflow-ui-design-active'
  const MOUNTED_ATTRIBUTE = 'data-novaflow-ui-design-mounted'
  const UI_RESOURCE_PANEL_WIDTH_PX = 260
  const NAVIGATION_SYNC_DELAYS = Object.freeze([0, 80, 220, 420])

  let store = null
  let mounted = null
  let selectedEntity = null
  let generationState = null
  let generationAbort = null
  let generationPromise = null
  let featureRefresh = null
  let generationStatus = ''
  let generationStatusError = false
  let generationStatusGeneratorId = ''
  let sharedResourceUnsubscribe = null
  let sharedResourceSubscriptionBridge = null
  let started = false
  let resizeFrame = 0
  const syncTimers = new Set()

  function dependencies() {
    return {
      structure: root && root.NovaFlowUiDesignStructureTool,
      inspector: root && root.NovaFlowUiDesignInspectorTool,
      resource: root && root.NovaFlowUiDesignProjectResource,
      preview: root && root.NovaFlowUiDesignPreview,
      layoutGuide: root && root.NovaFlowUiDesignLayoutGuide,
      workspace: root && root.NovaFlowUiDesignWorkbench,
      generateWorkflow: root && root.NovaFlowUiDesignGenerateWorkflow,
      mode: root && root.NovaFlowUiDesignModeTool,
      accordion: root && root.NovaFlowLeftPanelAccordion,
      resourceMention: root && root.NovaFlowResourceMentionTool,
      assistantWorkflow: root && root.NovaFlowUiDesignAssistantWorkflow,
      assistantDialog: root && root.NovaFlowUiDesignAssistantDialog,
    }
  }

  function missingDependencies() {
    const modules = dependencies()
    return Object.entries(modules)
      .filter(([, value]) => !value || typeof value !== 'object')
      .map(([name]) => name)
  }

  function createElement(documentRef, tagName, attributes = {}, children = []) {
    const element = documentRef.createElement(tagName)
    Object.entries(attributes).forEach(([name, value]) => {
      if (name === 'text') element.textContent = String(value == null ? '' : value)
      else if (name === 'style') Object.assign(element.style, value || {})
      else if (name in element && !name.startsWith('data-') && !name.startsWith('aria-')) element[name] = value
      else if (value != null) element.setAttribute(name, String(value))
    })
    ;(Array.isArray(children) ? children : [children]).filter(Boolean).forEach((child) => element.appendChild(child))
    return element
  }

  function accordionApi() {
    const accordion = root?.NovaFlowLeftPanelAccordion
    if (!accordion || typeof accordion.syncExpanded !== 'function') {
      throw new TypeError('NovaFlow left-panel accordion helper is required')
    }
    return accordion
  }

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }

  function positiveInteger(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? Math.max(1, Math.round(number)) : fallback
  }

  function uiProviderCapability(provider) {
    const resolver = dependencies().generateWorkflow?.providerCapability
    if (typeof resolver === 'function') return resolver(provider)
    const normalized = String(provider || '').trim().toLowerCase()
    const totalReferenceLimit = normalized === 'gpt' ? 16 : (normalized === 'google' ? 14 : 3)
    return {
      provider: normalized === 'gpt' || normalized === 'google' ? normalized : 'local',
      totalReferenceLimit,
      reservedLayoutReferences: 1,
      externalReferenceLimit: totalReferenceLimit - 1,
    }
  }

  function scaleLayoutBlocks(blocks, sourceSize, outputSize) {
    const mapper = dependencies().structure?.mapLayoutBlocksToOutput
    if (typeof mapper === 'function') return mapper(blocks, sourceSize, outputSize)
    const sourceWidth = positiveInteger(sourceSize?.width, outputSize.width)
    const sourceHeight = positiveInteger(sourceSize?.height, outputSize.height)
    const scaleX = outputSize.width / sourceWidth
    const scaleY = outputSize.height / sourceHeight
    return (Array.isArray(blocks) ? blocks : []).map((block) => {
      const source = isObject(block) ? block : {}
      const next = { ...source }
      ;[['x', scaleX], ['width', scaleX], ['y', scaleY], ['height', scaleY]].forEach(([key, scale]) => {
        const value = Number(source[key])
        if (Number.isFinite(value)) next[key] = Math.round(value * scale)
      })
      return next
    })
  }

  function selectedGeneratorId(state) {
    const activeId = mounted?.workspaceHandle?.getActiveGeneratorId?.()
    if (activeId) return activeId
    const selection = mounted?.workspaceHandle?.getSelection?.() || selectedEntity
    const selectedNode = selection?.node || selection
    if (selectedNode?.type === 'generator' && selectedNode.id) return String(selectedNode.id)
    const graph = projectGraph(state)
    return String(graph.nodes.find((node) => node.type === 'generator')?.id || '')
  }

  function readPersistedState() {
    try {
      if (root?.localStorage?.getItem?.(INITIALIZED_STORAGE_KEY) !== '1') return {}
      const raw = root?.localStorage?.getItem?.(STORAGE_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  function drawingResourceBridge() {
    const bridge = root && root.NovaFlowSpineSplitBridge
    return bridge && typeof bridge === 'object' ? bridge : null
  }

  function sharedResourceId(value) {
    return String(value?.sharedResourceId || value?.id || '').trim()
  }

  function sharedResourceSnapshot(bridge = drawingResourceBridge()) {
    if (!bridge) return null
    try {
      if (typeof bridge.getSourceResources === 'function') {
        const resources = bridge.getSourceResources()
        return Array.isArray(resources) ? resources : []
      }
      const resources = bridge.getState?.()?.sourceResources
      return Array.isArray(resources) ? resources.slice() : null
    } catch {
      return null
    }
  }

  function syncSharedResourceSnapshot(activeStore, resources, syncOptions = {}) {
    if (!activeStore || typeof activeStore.syncSharedResources !== 'function') return []
    const suppliedSnapshot = Array.isArray(resources)
    const snapshot = suppliedSnapshot ? resources : sharedResourceSnapshot()
    if (!Array.isArray(snapshot)) return []
    return activeStore.syncSharedResources(snapshot, {
      authoritative: syncOptions.authoritative === true || (!suppliedSnapshot && syncOptions.authoritative !== false),
    })
  }

  function removeDrawingSharedResource(id) {
    const bridge = drawingResourceBridge()
    const resourceId = String(id || '')
    if (!bridge || !resourceId || typeof bridge.deleteSourceResource !== 'function') return false
    try {
      return bridge.deleteSourceResource(resourceId) !== false
    } catch {
      return false
    }
  }

  function ensureSharedResourceSubscription(activeStore) {
    const bridge = drawingResourceBridge()
    if (!bridge || typeof bridge.subscribeSourceResources !== 'function') return false
    if (sharedResourceSubscriptionBridge === bridge && typeof sharedResourceUnsubscribe === 'function') return true
    if (typeof sharedResourceUnsubscribe === 'function') {
      try { sharedResourceUnsubscribe() } catch {}
    }
    sharedResourceUnsubscribe = null
    sharedResourceSubscriptionBridge = null
    try {
      const unsubscribe = bridge.subscribeSourceResources((event) => {
        const type = String(event?.type || '')
        const resourceId = String(event?.resourceId || sharedResourceId(event?.resource) || '')
        const resources = Array.isArray(event?.resources) ? event.resources : sharedResourceSnapshot(bridge)
        if (Array.isArray(resources)) syncSharedResourceSnapshot(activeStore, resources, { authoritative: true })
        else if (type === 'delete' && resourceId) activeStore.removeSharedResource?.(resourceId)
      })
      if (typeof unsubscribe !== 'function') return false
      sharedResourceUnsubscribe = unsubscribe
      sharedResourceSubscriptionBridge = bridge
      return true
    } catch {
      return false
    }
  }

  async function registerUiSharedResource(activeStore, value, kind) {
    const bridge = drawingResourceBridge()
    const dataUrl = String(value?.dataUrl || value?.imageUrl || '')
    if (!bridge || !/^data:image\//i.test(dataUrl)) return null
    const externalId = String(value?.id || '').trim()
    const fileName = String(value?.fileName || value?.name || (kind === 'result' ? 'UI设计结果.png' : 'UI参考图.png'))
    const registerOptions = {
      activate: false,
      resetViewport: false,
      origin: 'ui-design',
      externalId,
      category: kind === 'result' ? 'result' : 'reference',
    }
    let createdShared = false
    let shared = (sharedResourceSnapshot(bridge) || []).find((item) => (
      String(item?.origin || '') === 'ui-design'
      && externalId
      && String(item?.externalId || '') === externalId
    )) || null
    try {
      if (!shared && typeof bridge.registerSourceDataUrlResource === 'function') {
        shared = await bridge.registerSourceDataUrlResource(fileName, dataUrl, registerOptions)
        createdShared = Boolean(shared)
      } else if (!shared
        && bridge.supportsSilentSourceResourceRegistration === true
        && typeof bridge.addSourceDataUrlResource === 'function') {
        const before = sharedResourceSnapshot(bridge) || []
        const beforeIds = new Set(before.map(sharedResourceId).filter(Boolean))
        const added = await bridge.addSourceDataUrlResource(fileName, dataUrl, registerOptions)
        if (added !== false) {
          const after = sharedResourceSnapshot(bridge) || []
          shared = after.find((item) => externalId && String(item?.externalId || '') === externalId)
            || after.find((item) => !beforeIds.has(sharedResourceId(item)))
            || after.find((item) => String(item?.dataUrl || '') === dataUrl && String(item?.fileName || item?.name || '') === fileName)
            || null
          createdShared = Boolean(shared)
        }
      }
    } catch {
      const leaked = (sharedResourceSnapshot(bridge) || []).find((item) => (
        String(item?.origin || '') === 'ui-design'
        && externalId
        && String(item?.externalId || '') === externalId
      )) || null
      const leakedId = sharedResourceId(leaked)
      if (leakedId) {
        removeDrawingSharedResource(leakedId)
        activeStore.removeSharedResource?.(leakedId)
      }
      shared = null
    }
    const resourceId = sharedResourceId(shared)
    if (!shared || !resourceId) return null
    const currentState = activeStore.getState?.() || {}
    const localItems = kind === 'result' ? currentState.results : currentState.resources
    const localEntity = Array.isArray(localItems)
      ? localItems.find((item) => String(item?.id || '') === externalId)
      : null
    if (!localEntity) {
      if (createdShared) removeDrawingSharedResource(resourceId)
      activeStore.removeSharedResource?.(resourceId)
      return null
    }
    const hasProjection = Array.isArray(currentState.resources)
      && currentState.resources.some((item) => String(item?.sharedResourceId || '') === resourceId)
    const hasMapping = String(localEntity.sharedResourceId || '') === resourceId
    if (!hasProjection || !hasMapping) {
      syncSharedResourceSnapshot(activeStore, [shared], { authoritative: false })
    }
    return shared
  }

  async function importUiSharedFiles(activeStore, files) {
    const added = await activeStore.addImportedFiles(files)
    try {
      for (const resource of added) {
        const shared = await registerUiSharedResource(activeStore, resource, 'reference')
        const localExists = activeStore.getState().resources.some((item) => item.id === resource.id)
        if (localExists && !shared) throw new Error('公共资源服务暂不可用，参考图未导入')
      }
    } catch (error) {
      added.forEach((resource) => activeStore.removeResource?.(resource.id))
      throw error
    }
    const state = activeStore.getState()
    return added
      .map((resource) => state.resources.find((item) => item.id === resource.id) || null)
      .filter(Boolean)
  }

  function reconcilePersistedAssetNodes(value) {
    if (!value || typeof value !== 'object') return {}
    const project = value.project && typeof value.project === 'object' ? value.project : null
    const graph = project?.graph && typeof project.graph === 'object' ? project.graph : null
    if (!graph || !Array.isArray(graph.nodes)) return value
    const resourceIds = new Set((Array.isArray(value.resources) ? value.resources : []).map((item) => String(item?.id || '')).filter(Boolean))
    const resultIds = new Set((Array.isArray(value.results) ? value.results : []).map((item) => String(item?.id || '')).filter(Boolean))
    const nodes = graph.nodes.filter((node) => {
      if (node?.type === 'reference') return resourceIds.has(String(node?.data?.resourceId || ''))
      if (node?.type === 'result') return resultIds.has(String(node?.data?.resultId || ''))
      return true
    })
    if (nodes.length === graph.nodes.length) return value
    const nodeIds = new Set(nodes.map((node) => String(node?.id || '')).filter(Boolean))
    const edges = (Array.isArray(graph.edges) ? graph.edges : []).filter((edge) => (
      nodeIds.has(String(edge?.fromNodeId || '')) && nodeIds.has(String(edge?.toNodeId || ''))
    ))
    const lineage = (Array.isArray(graph.lineage) ? graph.lineage : []).filter((entry) => {
      const resultId = String(entry?.resultId || '')
      const resultNodeId = String(entry?.resultNodeId || '')
      return (!resultId || resultIds.has(resultId)) && (!resultNodeId || nodeIds.has(resultNodeId))
    })
    return {
      ...value,
      project: {
        ...project,
        graph: { ...graph, nodes, edges, lineage },
      },
    }
  }

  function persistState() {
    if (!store) return false
    try {
      const serialized = store.serializeProject()
      root?.localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(serialized))
      const nodes = serialized?.project?.graph?.nodes
      if (Array.isArray(nodes) && nodes.length) {
        root?.localStorage?.setItem?.(INITIALIZED_STORAGE_KEY, '1')
      }
      return true
    } catch {
      return false
    }
  }

  function ensureStore() {
    if (store) {
      ensureSharedResourceSubscription(store)
      return store
    }
    const resource = dependencies().resource
    if (!resource || typeof resource.createProjectStore !== 'function') return null
    store = resource.createProjectStore(reconcilePersistedAssetNodes(readPersistedState()), {
      onRemoveSharedResource(sharedId) {
        removeDrawingSharedResource(sharedId)
      },
    })
    syncSharedResourceSnapshot(store)
    ensureSharedResourceSubscription(store)
    const state = store.getState()
    generationState = {
      ...(state.settings || {}),
      mode: 'img2img',
      width: state.project.width,
      height: state.project.height,
      running: false,
    }
    return store
  }

  function isElement(value) {
    return Boolean(value) && typeof value === 'object' && typeof value.appendChild === 'function'
  }

  function findMainWorkspace(leftColumn, documentRef) {
    const parent = leftColumn?.parentElement
    const candidates = parent && parent.children ? Array.from(parent.children).filter((item) => item !== leftColumn && isElement(item)) : []
    const measured = candidates.filter((item) => {
      try {
        const style = root?.getComputedStyle?.(item)
        const rect = item.getBoundingClientRect?.()
        return style?.position !== 'fixed' && Number(rect?.width) >= 360 && Number(rect?.height) >= 260
      } catch {
        return false
      }
    })
    if (measured.length) return measured.sort((left, right) => {
      const leftRect = left.getBoundingClientRect()
      const rightRect = right.getBoundingClientRect()
      return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height)
    })[0]
    if (isElement(leftColumn?.nextElementSibling)) return leftColumn.nextElementSibling
    return candidates[candidates.length - 1] || documentRef?.querySelector?.('.nf-app-body > div:last-child') || null
  }

  function locateHosts(documentRef = root?.document) {
    if (!documentRef) return { active: false, leftHost: null, workspaceHost: null }
    const body = documentRef.body
    const leftHost = documentRef.querySelector?.('[data-novaflow-art-ui-host="1"]') || null
    const leftColumn = documentRef.querySelector?.('[data-novaflow-left-column="1"]') || null
    const workspaceHost = leftColumn ? findMainWorkspace(leftColumn, documentRef) : null
    const active = Boolean(
      body?.classList?.contains?.('novaflow-primary-target-art') &&
      isElement(leftHost) &&
      isElement(workspaceHost),
    )
    return { active, leftHost, leftColumn, workspaceHost }
  }

  function isUiDesignRoute(documentRef = root?.document) {
    return locateHosts(documentRef).active
  }

  function getCurrentExportSource() {
    const activeStore = ensureStore()
    const state = activeStore?.getState?.()
    if (!state || !isUiDesignRoute()) return null
    const selection = mounted?.workspaceHandle?.getSelection?.() || selectedEntity
    const selectedResultId = selection?.node?.type === 'result'
      ? String(selection.node.data?.resultId || '')
      : String(selection?.result?.id || '')
    const results = Array.isArray(state.results) ? state.results : []
    const result = results.find((item) => String(item?.id || '') === selectedResultId)
      || results[results.length - 1]
      || null
    const dataUrl = String(result?.dataUrl || result?.imageUrl || '')
    if (!dataUrl.startsWith('data:image/')) return null
    return {
      dataUrl,
      name: result?.name || 'novaflow_ui_design.png',
      label: '当前 UI 画板结果',
    }
  }

  function buttonStyle(active) {
    return {
      height: '32px',
      minWidth: '0',
      padding: '0 8px',
      border: active ? '1px solid rgba(82,226,167,0.7)' : '1px solid rgba(255,255,255,0.1)',
      borderRadius: '7px',
      background: active ? 'rgba(30,166,114,0.3)' : '#262626',
      color: active ? '#65e1ae' : 'rgba(255,255,255,0.78)',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: '600',
    }
  }

  function createAttributeSection(documentRef, inspectorHost) {
    const accordion = accordionApi()
    const section = createElement(documentRef, 'section', {
      'data-novaflow-left-accordion-panel': '1',
      'data-novaflow-ui-design-attribute-section': '1',
      'data-open': '0',
      className: 'nf-panel',
      style: accordion.panelStyle(),
    })
    const title = createElement(documentRef, 'span', { style: accordion.titleStyle() }, [
      createElement(documentRef, 'i', {
        className: 'fas fa-sliders-h',
        'aria-hidden': 'true',
        style: accordion.iconStyle(),
      }),
      createElement(documentRef, 'span', { text: '结构生成器', style: accordion.labelStyle() }),
    ])
    const chevron = createElement(documentRef, 'i', {
      className: accordion.chevronClass(false),
      'aria-hidden': 'true',
      style: accordion.chevronStyle(),
    })
    const header = createElement(documentRef, 'button', {
      type: 'button',
      'data-novaflow-ui-design-attribute-toggle': '1',
      'aria-expanded': 'false',
      className: 'nf-panel-header',
      style: accordion.headerStyle(false),
    }, [title, chevron])
    const help = createElement(documentRef, 'div', {
      text: '在中央画板规划布局，点击模块编辑属性。布局可选。',
      style: { color: 'rgba(255,255,255,0.46)', fontSize: '10px', lineHeight: '1.55' },
    })

    const body = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-attribute-body': '1',
      className: 'nf-panel-body',
      style: accordion.bodyStyle(false),
    }, [help, inspectorHost])
    const add = createElement(documentRef, 'button', { type: 'button', text: '+ 添加模块', style: { padding: '8px', color: '#fff', background: '#292929', border: '1px solid #444', borderRadius: '6px' } })
    add.addEventListener('click', () => mounted?.workspaceHandle?.addBlock?.())
    const use = createElement(documentRef, 'button', { type: 'button', text: '生成布局参考', style: { padding: '8px', color: '#fff', background: '#17a582', border: '0', borderRadius: '6px' } })
    use.addEventListener('click', () => mounted?.workspaceHandle?.useLayout?.())
    body.prepend(add)
    body.appendChild(use)
    let expanded = false
    header.addEventListener('click', () => {
      expanded = !expanded
      accordion.syncExpanded(section, header, body, chevron, expanded)
      if (expanded) mounted?.workspaceHandle?.showLayout?.()
    })
    section.appendChild(header)
    section.appendChild(body)
    return { section, syncToolButtons() {} }
  }

  function createSplitPlaceholder(documentRef) {
    return createElement(documentRef, 'button', {
      type: 'button',
      disabled: true,
      'data-novaflow-ui-design-split-placeholder': '1',
      title: 'UI 拆图将在第二阶段接入现有拆图能力',
      style: {
        width: '100%', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 10px', border: '0', borderRadius: '8px', background: '#282828',
        color: 'rgba(255,255,255,0.42)', fontSize: '12px', fontWeight: '600', cursor: 'not-allowed',
      },
    }, [
      createElement(documentRef, 'span', { text: 'UI 拆图' }),
      createElement(documentRef, 'span', {
        text: '第二阶段',
        style: { fontSize: '9px', fontWeight: '600', color: 'rgba(255,255,255,0.32)' },
      }),
    ])
  }

  function generatorSettings(state, generator, workspaceValue) {
    const promptDefaults = {
      prompt: '',
      negativePrompt: '',
      negativePromptSource: '',
    }
    const legacy = isObject(state?.settings) ? state.settings : {}
    const stored = isObject(generator?.data?.generationSettings) ? generator.data.generationSettings : {}
    const workspaceSettings = isObject(workspaceValue?.generationSettings)
      ? workspaceValue.generationSettings
      : (isObject(workspaceValue) ? workspaceValue : {})
    const merged = { ...promptDefaults, ...legacy, ...stored, ...workspaceSettings }
    // A generator saved while the automatic negative list was filled in carries it with source
    // 'default'; that list is no longer applied (an empty negative keeps the run at normal speed).
    if (merged.negativePromptSource === 'default') {
      merged.negativePrompt = ''
      merged.negativePromptSource = ''
    }
    const normalize = dependencies().structure?.normalizeGeneratorSettings
    return typeof normalize === 'function' ? normalize(merged) : merged
  }

  function generatorOutput(state, generator, workspaceValue) {
    const project = isObject(state?.project) ? state.project : {}
    const fallback = {
      width: positiveInteger(project.width, 1920),
      height: positiveInteger(project.height, 1080),
    }
    const structure = dependencies().structure
    const stored = typeof structure?.generatorOutputFromNode === 'function'
      ? structure.generatorOutputFromNode(generator, fallback)
      : (isObject(generator?.data?.output) ? generator.data.output : fallback)
    const provided = isObject(workspaceValue?.output) ? workspaceValue.output : {}
    if (typeof structure?.normalizeGeneratorOutput === 'function') {
      return structure.normalizeGeneratorOutput(provided, stored)
    }
    return {
      width: positiveInteger(provided.width ?? provided.w ?? stored.width ?? stored.w, fallback.width),
      height: positiveInteger(provided.height ?? provided.h ?? stored.height ?? stored.h, fallback.height),
    }
  }

  function generatorProfile(state, generator, readWorkspace = true) {
    let workspaceValue = null
    if (readWorkspace) {
      try {
        workspaceValue = generator?.id ? mounted?.workspaceHandle?.getGeneratorSettings?.(generator.id) : null
      } catch {
        workspaceValue = null
      }
    }
    const settings = generatorSettings(state, generator, workspaceValue)
    return { settings, output: generatorOutput(state, generator, workspaceValue) }
  }

  function currentGenerationState(generator, output) {
    const state = ensureStore()?.getState?.()
    if (!state) return generationState || { mode: 'img2img', provider: 'local' }
    // This state is also used as the workspace's fallback while rendering a
    // generator. Reading the workspace handle here would recurse back through
    // getGenerationState, so live workspace reads are reserved for runGeneration.
    const profile = generator ? generatorProfile(state, generator, false) : null
    const settings = profile?.settings || state.settings || {}
    const target = output || profile?.output || generatorOutput(state, generator)
    return {
      ...settings,
      mode: 'img2img',
      width: target.width,
      height: target.height,
      running: Boolean(generationPromise),
    }
  }

  function setGenerationStatus(message, options = {}) {
    generationStatus = String(message || '')
    generationStatusError = options.error === true
    const hasGeneratorNodeId = Object.prototype.hasOwnProperty.call(options, 'generatorNodeId')
    const generatorNodeId = hasGeneratorNodeId
      ? String(options.generatorNodeId || '')
      : generationStatusGeneratorId
    if (hasGeneratorNodeId) generationStatusGeneratorId = generatorNodeId
    const state = ensureStore()?.getState?.()
    const generator = generatorNodeId
      ? projectGraph(state).nodes.find((node) => node.type === 'generator' && String(node.id) === generatorNodeId)
      : null
    generationState = { ...currentGenerationState(generator), running: options.running === true }
    mounted?.workspaceHandle?.setGeneratorStatus?.(generatorNodeId, generationStatus, {
      error: generationStatusError,
      running: options.running === true,
    })
  }

  function projectGraph(state) {
    const value = state?.project?.graph || state?.graph || {}
    return dependencies().structure?.normalizeGraph?.(value, {
      legacyBlocks: Array.isArray(state?.project?.blocks) ? state.project.blocks : [],
    }) || { schemaVersion: 2, nodes: [], edges: [], lineage: [] }
  }

  function layoutCoordinateSize(state, layout, fallback) {
    const fallbackWidth = positiveInteger(fallback?.width, 1920)
    const fallbackHeight = positiveInteger(fallback?.height, 1080)
    const projectSize = {
      width: positiveInteger(state?.project?.width, fallbackWidth),
      height: positiveInteger(state?.project?.height, fallbackHeight),
    }
    const coordinateSize = isObject(layout?.data?.canvasSize) ? layout.data.canvasSize : null
    const sourceWidth = Number(coordinateSize?.width)
    const sourceHeight = Number(coordinateSize?.height)
    if (Number.isFinite(sourceWidth) && sourceWidth > 0 && Number.isFinite(sourceHeight) && sourceHeight > 0) {
      return {
        width: positiveInteger(sourceWidth, projectSize.width),
        height: positiveInteger(sourceHeight, projectSize.height),
      }
    }
    return projectSize
  }

  function generationContext(state, requestedGeneratorId) {
    const graph = projectGraph(state)
    const generator = graph.nodes.find((node) => node.type === 'generator' && node.id === requestedGeneratorId)
      || graph.nodes.find((node) => node.type === 'generator')
      || null
    const layoutEdge = generator && graph.edges.find((edge) => edge.toNodeId === generator.id && edge.kind === 'layout')
    const connectedLayout = layoutEdge
      ? graph.nodes.find((node) => node.id === layoutEdge.fromNodeId && node.type === 'layout')
      : null
    const blocks = Array.isArray(connectedLayout?.data?.blocks)
      ? connectedLayout.data.blocks.filter((block) => block && block.participates !== false)
      : []
    const layout = blocks.length ? connectedLayout : null
    const connected = generator
      ? graph.edges.filter((edge) => edge.toNodeId === generator.id && (edge.kind === 'reference' || edge.kind === 'iteration'))
      : []
    function referenceFromEdge(edge) {
      const node = graph.nodes.find((item) => item.id === edge.fromNodeId)
      if (!node) return null
      if (node.type === 'reference') {
        const resource = (Array.isArray(state.resources) ? state.resources : []).find((item) => item.id === node.data.resourceId)
        return resource ? {
          ...resource,
          role: node.data.role || resource.role || 'reference',
          nodeId: node.id,
          connectionKind: edge.kind,
        } : null
      }
      if (node.type === 'result') {
        const result = (Array.isArray(state.results) ? state.results : []).find((item) => item.id === node.data.resultId)
        return result ? {
          ...result,
          kind: 'generated',
          sourceKind: result.kind || 'ui-design',
          name: result.name || '迭代结果',
          role: 'content',
          nodeId: node.id,
          connectionKind: edge.kind,
        } : null
      }
      return null
    }
    const settings = generator ? generatorSettings(state, generator) : {}
    const capability = uiProviderCapability(settings.provider)
    const iterationReferences = connected
      .filter((edge) => edge.kind === 'iteration')
      .map(referenceFromEdge)
      .filter(Boolean)
    const ordinaryReferences = connected
      .filter((edge) => edge.kind === 'reference')
      .map(referenceFromEdge)
      .filter(Boolean)
    const baseReferences = iterationReferences.slice(0, 1)
    const ordinaryLimit = Math.max(0, capability.externalReferenceLimit - baseReferences.length)
    const references = baseReferences.concat(ordinaryReferences)
    const referenceOverflow = Math.max(0, iterationReferences.length - 1)
      + Math.max(0, ordinaryReferences.length - ordinaryLimit)
    return {
      graph,
      generator,
      layout,
      blocks,
      references,
      referenceOverflow,
      provider: capability.provider,
      referenceLimit: capability.externalReferenceLimit,
      ordinaryReferenceLimit: ordinaryLimit,
      capability,
      ordinaryReferenceCount: ordinaryReferences.length,
      iterationReferenceCount: iterationReferences.length,
    }
  }

  function generationOutputContract(provider, output, settings) {
    const resolver = root?.NovaFlowUiDesignGenerateTool?.resolveOutputContract
    if (typeof resolver !== 'function') return { valid: true, exact: provider !== 'google', error: '' }
    return resolver(provider, output, settings)
  }

  function generatorReferenceDescriptors(state, requestedGeneratorId) {
    const context = generationContext(state, String(requestedGeneratorId || ''))
    return context.references.map((reference, index) => ({
      key: `ui_reference_${index + 1}`,
      id: String(reference.id || reference.sourceId || reference.resourceId || reference.nodeId || `ui_reference_${index + 1}`),
      sourceId: String(reference.id || reference.sourceId || reference.resourceId || ''),
      nodeId: String(reference.nodeId || ''),
      label: String(reference.name || reference.fileName || `参考图${index + 1}`),
      // The model sees the layout guide as image 1 unless the engine takes none (Qwen-Image-2.1).
      modelImageNumber: index + 1 + (context.layout ? Math.max(0, Number(context.capability?.reservedLayoutReferences) || 0) : 0),
      name: String(reference.name || reference.fileName || `ui_reference_${index + 1}.png`),
      fileName: String(reference.fileName || reference.name || `ui_reference_${index + 1}.png`),
      kind: 'image',
      occupied: true,
      previewUrl: String(reference.dataUrl || reference.imageUrl || ''),
      dataUrl: String(reference.dataUrl || reference.imageUrl || ''),
      imageUrl: String(reference.imageUrl || reference.dataUrl || ''),
      role: String(reference.role || 'reference'),
    }))
  }

  function generatorStructureContext(state, requestedGeneratorId) {
    const context = generationContext(state, String(requestedGeneratorId || ''))
    const profile = context.generator ? generatorProfile(state, context.generator, false) : null
    const layoutData = isObject(context.layout?.data) ? context.layout.data : {}
    const output = {
      width: positiveInteger(profile?.output?.width, positiveInteger(state?.project?.width, 1920)),
      height: positiveInteger(profile?.output?.height, positiveInteger(state?.project?.height, 1080)),
    }
    const sourceSize = layoutCoordinateSize(state, context.layout, output)
    const blocks = scaleLayoutBlocks(context.blocks, sourceSize, output)
    return {
      name: String(layoutData.name || context.layout?.title || state?.project?.title || ''),
      description: String(layoutData.description || state?.project?.description || ''),
      width: output.width,
      height: output.height,
      blocks,
      regions: blocks.map((block) => ({ ...block })),
    }
  }

  function readClientSessionToken() {
    try {
      const raw = root?.localStorage?.getItem?.(CLIENT_AUTH_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      return String(parsed?.session?.token || '').trim()
    } catch {
      return ''
    }
  }

  function mountGeneratorPromptMentions(textarea, details = {}) {
    const modules = dependencies()
    const generatorNodeId = String(details.generatorNodeId || '')
    if (!textarea || typeof modules.resourceMention?.mountTextarea !== 'function') return null
    let disposed = false
    let mentionHandle = null
    let timer = 0
    const timerHost = textarea.ownerDocument?.defaultView || root
    const mount = () => {
      timer = 0
      if (disposed || textarea.isConnected === false) return
      mentionHandle = modules.resourceMention.mountTextarea({
        textarea,
        surface: 'ui-design',
        getResources() {
          const state = ensureStore()?.getState?.()
          return state ? generatorReferenceDescriptors(state, generatorNodeId) : []
        },
        onMentionsChange(snapshot) {
          if (!details.state || typeof details.state !== 'object') return
          details.state.promptMentionBindings = isObject(snapshot?.bindings)
            ? { ...snapshot.bindings }
            : {}
          details.state.promptMentionSourceOrder = Array.isArray(snapshot?.orderedSourceIds)
            ? snapshot.orderedSourceIds.map((value) => String(value || '')).filter(Boolean)
            : []
        },
      })
    }
    if (timerHost && typeof timerHost.setTimeout === 'function') timer = timerHost.setTimeout(mount, 0)
    else mount()
    return Object.freeze({
      unmount() {
        if (disposed) return false
        disposed = true
        if (timer && timerHost && typeof timerHost.clearTimeout === 'function') timerHost.clearTimeout(timer)
        timer = 0
        if (typeof mentionHandle?.unmount === 'function') return mentionHandle.unmount()
        return modules.resourceMention?.unmountTextarea?.(textarea) || false
      },
    })
  }

  function assistantInput(state, context, profile) {
    return {
      provider: context.provider,
      engine: profile.settings.assistantEngine || 'grok',
      prompt: String(profile.settings.prompt || ''),
      negativePrompt: String(profile.settings.negativePrompt || ''),
      size: { ...profile.output },
      references: generatorReferenceDescriptors(state, context.generator.id),
      structure: generatorStructureContext(state, context.generator.id),
      electronAPI: root?.electronAPI,
      getSessionToken: readClientSessionToken,
    }
  }

  function openDesignAssistant(payload = {}) {
    const state = ensureStore()?.getState?.()
    const generatorNodeId = String(payload.generatorNodeId || '')
    const context = state ? generationContext(state, generatorNodeId) : null
    const modules = dependencies()
    if (!state || !context?.generator) throw new Error('请先选择一个 UI 生成器节点')
    if (typeof modules.assistantDialog?.open !== 'function') throw new Error('AI 助手尚未就绪')
    const profile = generatorProfile(state, context.generator, false)
    return modules.assistantDialog.open({
      documentRef: payload.promptTextarea?.ownerDocument || root?.document,
      workflow: modules.assistantWorkflow,
      electronAPI: root?.electronAPI,
      provider: context.provider,
      engine: profile.settings.assistantEngine || 'grok',
      getInputRevision: () => {
        const latest = ensureStore().getState()
        const ctx = generationContext(latest, context.generator.id)
        return root.NovaFlowUiDesignPromptPipeline.key(assistantInput(latest, ctx, generatorProfile(latest, ctx.generator, false)))
      },
      state: { ...profile.settings, ...profile.output },
      size: { ...profile.output },
      prompt: String(payload.prompt || profile.settings.prompt || ''),
      negativePrompt: context.provider === 'local'
        ? String(payload.negativePrompt || profile.settings.negativePrompt || '')
        : '',
      promptTextarea: payload.promptTextarea,
      getPrompt: () => String(payload.promptTextarea?.value ?? payload.prompt ?? ''),
      getReferences: () => generatorReferenceDescriptors(ensureStore()?.getState?.() || state, context.generator.id),
      getStructureContext: () => generatorStructureContext(ensureStore()?.getState?.() || state, context.generator.id),
      getSessionToken: readClientSessionToken,
      apply(result) {
        const input = assistantInput(state, context, profile)
        input.prompt = String(payload.prompt ?? input.prompt)
        input.engine = result.engine || input.engine
        const applied = payload.apply?.(result)
        if (applied === false) return false
        mounted?.workspaceHandle?.patchGeneratorSettings?.(context.generator.id, { assistantEngine: input.engine })
        const latest = ensureStore().getState()
        const latestContext = generationContext(latest, context.generator.id)
        const next = assistantInput(latest, latestContext, generatorProfile(latest, latestContext.generator, false))
        root.NovaFlowUiDesignPromptPipeline.remember(context.generator.id, input, result, next)
        mounted?.workspaceHandle?.recordOptimization?.(context.generator.id, input, result)
        return true
      },
    })
  }

  function nodeFromSelection(value) {
    if (!value || typeof value !== 'object') return null
    return value.node && typeof value.node === 'object' ? value.node : value
  }

  function useResultAsReference(resultValue, nodeValue) {
    const activeStore = ensureStore()
    const state = activeStore?.getState?.()
    const result = resultValue?.result || resultValue
    const node = nodeValue || nodeFromSelection(resultValue)
    const graph = projectGraph(state)
    const resultNode = node?.type === 'result'
      ? node
      : graph.nodes.find((item) => item.type === 'result' && item.data?.resultId === result?.id)
    const lineage = graph.lineage.find((entry) => entry.resultNodeId === resultNode?.id || entry.resultId === result?.id)
    const sourceGeneratorId = resultNode?.data?.sourceNodeId || lineage?.generatorNodeId || ''
    const generator = graph.nodes.find((item) => item.type === 'generator' && item.id === sourceGeneratorId)
      || graph.nodes.find((item) => item.type === 'generator')
    if (!resultNode || !generator) {
      mounted?.workspaceHandle?.showStatus?.('没有可连接的结果或生成器节点', true)
      return { ok: false, error: '没有可连接的结果或生成器节点' }
    }
    const ordinaryReferenceCount = graph.edges.filter((edge) => (
      edge.toNodeId === generator.id && edge.kind === 'reference'
    )).length
    const settings = generatorSettings(state, generator)
    const capability = uiProviderCapability(settings.provider)
    const ordinaryLimit = Math.max(0, capability.externalReferenceLimit - 1)
    if (ordinaryReferenceCount > ordinaryLimit) {
      const removeCount = ordinaryReferenceCount - ordinaryLimit
      const error = `当前${capability.provider === 'gpt' ? ' GPT' : (capability.provider === 'google' ? ' Google' : '本地')}模型设为修改底图后最多保留 ${ordinaryLimit} 张普通参考图，请先移除 ${removeCount} 张`
      mounted?.workspaceHandle?.showStatus?.(error, true)
      return { ok: false, error }
    }
    graph.edges
      .filter((edge) => edge.toNodeId === generator.id && edge.kind === 'iteration')
      .forEach((edge) => activeStore.removeGraphEdge?.(edge.id))
    const connected = activeStore.connectGraph?.({
      fromNodeId: resultNode.id,
      fromPort: 'reference',
      toNodeId: generator.id,
      toPort: 'iteration',
      kind: 'iteration',
    })
    if (!connected?.ok) mounted?.workspaceHandle?.showStatus?.(connected?.error || '修改底图连接失败', true)
    else {
      mounted?.workspaceHandle?.focusGenerator?.(generator.id)
      mounted?.workspaceHandle?.showStatus?.('已设为修改底图，请在生成器中确认参数后生成')
    }
    return connected
  }

  async function runGeneration(request = {}) {
    if (generationPromise) return generationPromise
    const activeStore = ensureStore()
    const modules = dependencies()
    if (!activeStore || typeof modules.generateWorkflow?.run !== 'function') {
      const error = new Error('UI 生成功能尚未就绪')
      setGenerationStatus(error.message, {
        generatorNodeId: String(request.generatorNodeId || ''),
        error: true,
        running: false,
      })
      throw error
    }
    // The local reference limit depends on the node's engine; ask it again before checking. A
    // second click during the question waits for the same answer and then joins the first run.
    if (root?.NovaFlowWebRuntime && typeof root?.electronAPI?.runtimeFeatures === 'function') {
      if (!featureRefresh) {
        featureRefresh = Promise.resolve(root.electronAPI.runtimeFeatures()).catch(() => {}).finally(() => { featureRefresh = null })
      }
      await featureRefresh
      if (generationPromise) return generationPromise
    }
    const state = activeStore.getState()
    const context = generationContext(state, String(request.generatorNodeId || ''))
    const generatorNodeId = String(context.generator?.id || request.generatorNodeId || '')
    if (!context.generator) {
      const error = new Error('请先添加 UI 生成器节点')
      setGenerationStatus(error.message, { generatorNodeId, error: true, running: false })
      throw error
    }
    if (context.referenceOverflow > 0) {
      const removeCount = context.referenceOverflow
      const message = context.iterationReferenceCount > 1
        ? '每个生成器只能连接 1 张修改底图，请移除多余连接'
        : (context.iterationReferenceCount > 0
            ? `当前模型已设置修改底图，最多还能连接 ${context.ordinaryReferenceLimit} 张普通参考图，请移除 ${removeCount} 张`
            : `当前模型最多连接 ${context.referenceLimit} 张普通参考图，请移除 ${removeCount} 张`)
      const error = new Error(message)
      setGenerationStatus(error.message, { generatorNodeId, error: true, running: false })
      throw error
    }

    const profile = generatorProfile(state, context.generator)
    if (!String(profile.settings.prompt || '').trim() && !context.references.length && !context.blocks.length) {
      const error = new Error('请填写设计需求、添加参考图或创建布局')
      setGenerationStatus(error.message, { generatorNodeId, error: true, running: false })
      throw error
    }
    const output = profile.output
    const outputContract = generationOutputContract(context.provider, output, profile.settings)
    if (outputContract?.valid === false) {
      const error = new Error(String(outputContract.error || '当前模型不支持所选输出尺寸'))
      setGenerationStatus(error.message, { generatorNodeId, error: true, running: false })
      throw error
    }
    const runState = {
      ...profile.settings,
      // UI design has no NSFW route; a generator saved before it was removed may still carry the flag.
      nsfw: false,
      mode: 'img2img',
      width: output.width,
      height: output.height,
      running: true,
      uiRunIntent: context.iterationReferenceCount > 0 ? 'iteration' : 'redesign',
      iterationReferenceCount: context.iterationReferenceCount,
    }
    generationState = runState
    setGenerationStatus('准备生成 UI', { generatorNodeId, running: true })
    const sourceSize = layoutCoordinateSize(state, context.layout, output)
    const scaledBlocks = scaleLayoutBlocks(context.blocks, sourceSize, output)
    const scopedLayout = {
      ...context.layout,
      data: {
        ...(isObject(context.layout?.data) ? context.layout.data : {}),
        blocks: scaledBlocks,
        canvasSize: { ...output },
      },
    }
    const project = {
      ...state.project,
      description: String(context.layout?.data?.description || state.project?.description || ''),
      width: output.width,
      height: output.height,
      canvas: { width: output.width, height: output.height },
      graph: { ...context.graph, nodes: context.layout ? [scopedLayout] : [], edges: [], lineage: [] },
      blocks: scaledBlocks,
    }
    const layoutGuide = context.layout ? modules.layoutGuide?.createCleanLayoutGuide?.(project, {
      visualEncoding: context.provider === 'local'
        ? 'soft-ui-semantic-scaffold-v2'
        : context.provider === 'google'
          ? 'soft-occupancy-heatmap-v1'
          : 'filled-regions-only',
      semanticSubgrid: context.provider === 'local',
      semanticText: context.provider === 'local' ? String(runState.prompt || '') : '',
    }) : null
    if (context.layout && (!layoutGuide || layoutGuide.clean !== true || layoutGuide.editorSnapshot !== false)) {
      const error = new Error('无法编译当前页面结构的干净布局控制图')
      setGenerationStatus(error.message, { generatorNodeId, error: true, running: false })
      throw error
    }
    project.layoutGuide = layoutGuide
    const references = context.references
    const progressHandler = (progress) => {
      setGenerationStatus(progress?.label || 'UI 生成中', {
        generatorNodeId,
        error: progress?.phase === 'error',
        running: !['complete', 'error', 'cancelled'].includes(progress?.phase),
      })
    }
    const abort = new AbortController()
    generationAbort = abort
    const generationOptions = {
      signal: abort.signal,
      project,
      layoutGuide,
      semanticLayout: layoutGuide?.semantic || null,
      refs: references,
      prompt: String(runState.prompt || ''),
      negativePrompt: String(runState.negativePrompt || ''),
      state: runState,
      onProgress: progressHandler,
    }
    const task = (async () => {
      setGenerationStatus('理解需求…', { generatorNodeId, running: true })
      const input = assistantInput(state, context, profile)
      const optimized = await root.NovaFlowUiDesignPromptPipeline.run({ id: generatorNodeId, input, signal: abort.signal, assistant: modules.assistantWorkflow })
      if (abort.signal.aborted) { const error = new Error('任务已中止'); error.name = 'AbortError'; throw error }
      generationOptions.prompt = optimized.prompt
      if (profile.settings.negativePromptSource !== 'user' && optimized.hasNegativePrompt) generationOptions.negativePrompt = optimized.negativePrompt
      const promptMentionBindings = { ...(runState.promptMentionBindings || {}) }
      for (const match of optimized.prompt.matchAll(/@参考图([1-9][0-9]*)/g)) {
        const ref = references[Number(match[1]) - 1]
        const sourceId = String(ref?.sourceId || ref?.id || '')
        if (input.prompt.includes(match[0]) && promptMentionBindings[match[0]] && promptMentionBindings[match[0]] !== sourceId) throw new Error('参考图引用已变化，请重新选择该引用')
        if (sourceId) promptMentionBindings[match[0]] = sourceId
      }
      generationOptions.state = { ...runState, prompt: generationOptions.prompt, negativePrompt: generationOptions.negativePrompt, promptMentionBindings }
      mounted?.workspaceHandle?.recordOptimization?.(generatorNodeId, input, optimized)
      setGenerationStatus('生成 UI…', { generatorNodeId, running: true })
      let result = await modules.generateWorkflow.run(generationOptions)
      result = { ...result, originalUserPrompt: input.prompt, optimizedPrompt: optimized.prompt, optimizationEngine: input.engine }

      if (context.provider !== 'local' || runState.uiRunIntent === 'iteration') return result
      // Local UI is one Qwen-Image-2.1 pass; nothing refines or reviews it afterwards.
      return {
        ...result,
        qualityReview: {
          status: 'REVIEW',
          unavailable: true,
          reason: 'qwen21-single-pass',
          summary: '多参考图结果已生成，本次保留结果供人工验收。',
          hardFailures: [],
          failureCodes: [],
          scores: {},
          retryPrompt: '',
          confidence: 0,
        },
        qualityRetryCount: 0,
        qualityAccepted: false,
      }
    })().then(async (result) => {
      const dataUrl = String(result?.dataUrl || result?.imageUrl || '')
      let added = activeStore.addResult({ ...result, dataUrl })
      const shared = await registerUiSharedResource(activeStore, added, 'result')
      added = activeStore.getState().results.find((item) => item.id === added.id) || null
      if (!added) {
        setGenerationStatus('UI 设计结果已删除，已取消写入画布', { generatorNodeId, running: false })
        return null
      }
      if (!shared) {
        activeStore.removeResult?.(added.id)
        throw new Error('公共资源服务暂不可用，UI 结果未写入')
      }
      const resultNode = mounted?.workspaceHandle?.addResultNode?.(added, context.generator?.id || request.generatorNodeId || '')
      const latestState = activeStore.getState()
      const latestGraph = projectGraph(latestState)
      const latestResultNode = resultNode?.node || latestGraph.nodes.find((node) => node.type === 'result' && node.data?.resultId === added.id)
      activeStore.recordResultLineage?.({
        resultId: added.id,
        generatorNodeId: context.generator?.id || request.generatorNodeId || '',
        resultNodeId: latestResultNode?.id || '',
        layoutNodeId: context.layout?.id || '',
        parentResultIds: references.filter((item) => item.kind === 'generated').map((item) => item.id),
        referenceResourceIds: references.filter((item) => item.kind !== 'generated').map((item) => item.id),
        createdAt: added.createdAt,
      })
      const qualityStatus = String(added.qualityReview?.status || '').toUpperCase()
      const reviewed = Boolean(qualityStatus)
      const qualityAccepted = reviewed ? added.qualityAccepted === true : true
      const statusLabel = qualityAccepted
        ? (added.qualityRetryCount > 0 ? 'UI 设计生成完成（已自动修正 1 次）' : 'UI 设计生成完成')
        : qualityStatus === 'FAIL'
          ? 'UI 设计已生成，但自动修正后仍未通过结构质量审查'
          : 'UI 设计已生成，质量审查待人工复核'
      setGenerationStatus(statusLabel, {
        generatorNodeId,
        running: false,
        error: reviewed && qualityStatus === 'FAIL',
      })
      return added
    }).catch((error) => {
      setGenerationStatus(String(error?.message || error || 'UI 生成失败'), {
        generatorNodeId,
        error: true,
        running: false,
      })
      throw error
    }).finally(() => {
      if (generationAbort === abort) generationAbort = null
      generationPromise = null
      generationState = { ...currentGenerationState(context.generator, output), running: false }
    })
    generationPromise = task
    return task
  }

  function mountUi(hosts = locateHosts()) {
    if (!hosts.active) return false
    if (mounted && mounted.leftHost === hosts.leftHost && mounted.workspaceHost === hosts.workspaceHost) return true
    unmountUi()
    const missing = missingDependencies()
    if (missing.length) {
      console.error(`[NovaFlow] UI Design modules missing: ${missing.join(', ')}`)
      return false
    }
    const activeStore = ensureStore()
    if (!activeStore) return false
    const documentRef = hosts.leftHost.ownerDocument || root.document
    const modules = dependencies()

    const previousLeftStyle = hosts.leftHost.getAttribute?.('style') || ''
    Object.assign(hosts.leftHost.style, {
      display: 'block',
      width: '100%',
      minWidth: '0',
      minHeight: 'calc(100vh - 112px)',
      padding: '0 0 24px',
      border: '0',
      borderRadius: '0',
      background: 'transparent',
      color: '#fff',
      fontSize: '12px',
      fontWeight: '400',
      textAlign: 'left',
      boxSizing: 'border-box',
      overflow: 'visible',
    })

    const leftRoot = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-left-root': '1',
      style: { display: 'grid', gap: accordionApi().TOKENS.panelGap, width: '100%', minWidth: '0' },
    })
    const inspectorHost = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-inspector-host': '1',
      style: { minWidth: '0', borderRadius: '8px', background: '#1d1d1d', overflow: 'hidden' },
    })
    const modeHost = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-mode-host': '1',
      style: { minWidth: '0', width: '100%' },
    })
    const attribute = createAttributeSection(documentRef, inspectorHost)
    leftRoot.appendChild(modeHost)
    leftRoot.appendChild(attribute.section)

    hosts.leftHost.replaceChildren(leftRoot)

    const mountRoot = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-mount-root': '1',
      style: {
        position: 'relative', width: '100%', height: '100%', minWidth: '0', minHeight: '0',
        zIndex: '2147483000', overflow: 'hidden', background: '#101010',
      },
    })
    const shell = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-shell': '1',
      style: {
        position: 'absolute', top: '0', right: '0', bottom: '0', left: '0', minWidth: '0', minHeight: '0',
        display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${UI_RESOURCE_PANEL_WIDTH_PX}px`, overflow: 'hidden', background: '#101010',
      },
    })
    const canvasHost = createElement(documentRef, 'main', {
      'data-novaflow-ui-design-canvas-host': '1',
      style: { minWidth: '0', minHeight: '0', overflow: 'hidden', position: 'relative' },
    })
    const previewHost = createElement(documentRef, 'aside', {
      'data-novaflow-ui-design-preview-host': '1',
      style: { minWidth: '0', minHeight: '0', overflow: 'hidden', borderLeft: '1px solid rgba(255,255,255,0.08)' },
    })
    shell.appendChild(canvasHost)
    shell.appendChild(previewHost)
    mountRoot.appendChild(shell)
    hosts.workspaceHost.appendChild(mountRoot)

    let modeHandle = null
    const workspaceHandle = modules.workspace.mount({
      host: canvasHost,
      onActiveGeneratorChange: () => modeHandle?.update?.(),
      getProject: () => activeStore.getState().project,
      getResources: () => activeStore.getState().resources,
      getResults: () => activeStore.getState().results,
      getGenerationState(generatorNodeId) {
        const state = activeStore.getState()
        const id = String(generatorNodeId || '')
        if (!id) return currentGenerationState()
        const generator = projectGraph(state).nodes.find((node) => node.type === 'generator' && String(node.id) === id)
        return currentGenerationState(generator)
      },
      onProjectChange(project) {
        activeStore.patchProject(project)
      },
      onSelectionChange(id, entity) {
        selectedEntity = entity || null
        mounted?.inspectorHandle?.update?.()
        modeHandle?.update?.()
      },
      onImportFiles(files) {
        return importUiSharedFiles(activeStore, files)
      },
      onGenerateRequest(payload) {
        return runGeneration(payload).catch(() => {})
      },
      // 任务中止: the workflow sees the signal, interrupts the runtime and reports 任务已中止.
      onStopGenerateRequest() {
        if (!generationAbort || generationAbort.signal.aborted) return false
        generationAbort.abort('\u4efb\u52a1\u5df2\u4e2d\u6b62')
        return true
      },
      mountPromptMentions(textarea, details) {
        return mountGeneratorPromptMentions(textarea, details)
      },
      onOpenDesignAssistant(payload) {
        return openDesignAssistant(payload)
      },
      onUseResultAsReference(result, node) {
        useResultAsReference(result, node)
      },
    })
    const inspectorHandle = modules.inspector.mount({
      host: inspectorHost,
      getProject: () => activeStore.getState().project,
      getSelection: () => workspaceHandle.getSelection?.() || selectedEntity,
      onPatchSelection(selection, patch) {
        workspaceHandle.patchSelection?.(selection, patch)
      },
      onRemoveSelection() {
        workspaceHandle.removeSelection?.()
      },
      onActivateRegionTool() {
        workspaceHandle.setTool?.('region')
      },
      onUseResultAsReference(selection) {
        useResultAsReference(selection)
      },
    })
    modeHandle = modules.mode.mount({
      host: modeHost,
      getContext() {
        const state = activeStore.getState()
        const generatorId = selectedGeneratorId(state)
        const generator = projectGraph(state).nodes.find((node) => node.type === 'generator' && String(node.id) === generatorId)
        const profile = generator ? generatorProfile(state, generator) : null
        return {
          id: generator ? String(generator.id) : '',
          title: String(generator?.title || 'UI 生成器'),
          provider: String(profile?.settings?.provider || 'local'),
          disabled: Boolean(generationPromise),
        }
      },
      onProviderChange(provider, context) {
        const generatorId = String(context?.id || selectedGeneratorId(activeStore.getState()) || '')
        if (!generatorId) return false
        workspaceHandle.patchGeneratorSettings?.(generatorId, { provider })
        return true
      },
    })
    const previewHandle = modules.preview.mount({
      host: previewHost,
      store: activeStore,
      onSelectResource: item => workspaceHandle.showImage?.(item),
      onSelectResult: item => workspaceHandle.showImage?.(item),
    })
    generationState = currentGenerationState()

    const unsubscribe = activeStore.subscribe((state, previous, reason) => {
      if (!mounted) return
      if (reason === 'patch-project' || String(reason || '').startsWith('graph-')) {
        workspaceHandle.update(state.project)
        inspectorHandle.update()
        modeHandle.update()
        const generatorId = selectedGeneratorId(state)
        const generator = projectGraph(state).nodes.find((node) => node.type === 'generator' && String(node.id) === generatorId)
        generationState = currentGenerationState(generator)
        persistState()
      } else if (reason === 'patch-settings') {
        const generatorId = selectedGeneratorId(state)
        const generator = projectGraph(state).nodes.find((node) => node.type === 'generator' && String(node.id) === generatorId)
        generationState = currentGenerationState(generator)
        workspaceHandle.update(state.project)
        modeHandle.update()
        persistState()
      } else if (reason === 'add-result' || reason === 'remove-result') {
        workspaceHandle.update(state.project)
        inspectorHandle.update()
      } else if (reason === 'add-resources' || reason === 'remove-resource') {
        workspaceHandle.update(state.project)
        inspectorHandle.update()
      } else if (reason === 'sync-shared-resources' || reason === 'update-resource' || reason === 'update-result') {
        workspaceHandle.update(state.project)
        inspectorHandle.update()
      }
    })

    mounted = {
      leftHost: hosts.leftHost,
      workspaceHost: hosts.workspaceHost,
      mountRoot,
      shell,
      previousLeftStyle,
      workspaceHandle,
      inspectorHandle,
      previewHandle,
      modeHandle,
      unsubscribe,
    }
    attribute.syncToolButtons(workspaceHandle.getTool?.() || 'select')
    if (generationStatus) {
      workspaceHandle.setGeneratorStatus?.(generationStatusGeneratorId, generationStatus, {
        error: generationStatusError,
        running: Boolean(generationPromise),
      })
    }
    documentRef.body?.setAttribute?.(ACTIVE_ATTRIBUTE, '1')
    shell.setAttribute(MOUNTED_ATTRIBUTE, '1')
    return true
  }

  function unmountUi() {
    try {
      dependencies().assistantDialog?.close?.('route-change')
    } catch {
      // Route teardown must continue even if an assistant surface was already removed.
    }
    if (!mounted) {
      root?.document?.body?.removeAttribute?.(ACTIVE_ATTRIBUTE)
      return false
    }
    const record = mounted
    mounted = null
    record.unsubscribe?.()
    record.modeHandle?.destroy?.()
    record.inspectorHandle?.destroy?.()
    record.workspaceHandle?.destroy?.()
    record.previewHandle?.unmount?.()
    record.mountRoot?.remove?.()
    if (record.leftHost?.isConnected !== false) {
      record.leftHost.replaceChildren?.()
      if (typeof record.leftHost.setAttribute === 'function') record.leftHost.setAttribute('style', record.previousLeftStyle)
    }
    root?.document?.body?.removeAttribute?.(ACTIVE_ATTRIBUTE)
    return true
  }

  function sync() {
    const hosts = locateHosts()
    if (hosts.active) return mountUi(hosts)
    unmountUi()
    return false
  }

  function clearSyncTimers() {
    syncTimers.forEach((timer) => root?.clearTimeout?.(timer))
    syncTimers.clear()
  }

  // The local reference limit and controls follow the node's engine; redraw once the node answers.
  root?.addEventListener?.('novaflow:runtime-features', () => scheduleSync(0))

  function scheduleSync(delays = NAVIGATION_SYNC_DELAYS) {
    ;(Array.isArray(delays) ? delays : [delays]).forEach((delay) => {
      const timer = root?.setTimeout?.(() => {
        syncTimers.delete(timer)
        sync()
      }, Math.max(0, Number(delay) || 0))
      if (timer != null) syncTimers.add(timer)
    })
  }

  function isNavigationClick(event) {
    const target = event?.target
    if (!target || typeof target.closest !== 'function') return false
    if (target.closest('[data-novaflow-primary-entry], [data-novaflow-secondary-entry], [data-novaflow-art-ui-host], [data-novaflow-art-drawing-host]')) return true
    const button = target.closest('button')
    const label = String(button?.textContent || '').replace(/\s+/g, '')
    return ['美工', '绘图', 'UI', '特效', '动画', '工具', '仓库'].includes(label)
  }

  function start() {
    if (started || !root?.document) return false
    started = true
    const documentRef = root.document
    documentRef.addEventListener?.('click', (event) => {
      if (!isNavigationClick(event)) return
      // Mount before the next paint: from a timer alone, 绘图 -> UI painted a
      // frame with an empty canvas, no resource panel and 绘图's left panel.
      root.requestAnimationFrame?.(() => sync())
      scheduleSync()
    }, true)
    root.addEventListener?.('novaflow:app-ready', () => scheduleSync([0, 100, 300]))
    root.addEventListener?.('resize', () => {
      if (!mounted || resizeFrame) return
      const schedule = typeof root.requestAnimationFrame === 'function'
        ? root.requestAnimationFrame.bind(root)
        : (callback) => root.setTimeout?.(callback, 16)
      resizeFrame = schedule(() => {
        resizeFrame = 0
        mounted?.workspaceHandle?.refitIfFitted?.()
      })
    })
    if (documentRef.readyState === 'loading') {
      documentRef.addEventListener?.('DOMContentLoaded', () => scheduleSync([0, 120, 360]), { once: true })
    } else {
      scheduleSync([0, 120, 360])
    }
    return true
  }

  const api = Object.freeze({
    STORAGE_KEY,
    INITIALIZED_STORAGE_KEY,
    locateHosts,
    isUiDesignRoute,
    ensureStore,
    getStore: () => store,
    getState: () => store?.getState?.() || null,
    getCurrentExportSource,
    resolveGenerationContext: generationContext,
    getGeneratorReferenceDescriptors: generatorReferenceDescriptors,
    getGeneratorStructureContext: generatorStructureContext,
    openDesignAssistant,
    useResultAsReference,
    activate: mountUi,
    deactivate: unmountUi,
    runGeneration,
    scheduleSync,
    sync,
    start,
    stop() {
      clearSyncTimers()
      return unmountUi()
    },
  })

  start()
  return api
})
