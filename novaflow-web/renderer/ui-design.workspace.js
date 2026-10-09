(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignWorkspace = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const MIN_ZOOM = 0.18
  const MAX_ZOOM = 2.5
  const ZOOM_PRECISION = 10000
  const FIT_PADDING = 104
  const GRID_SIZE = 24
  const HISTORY_LIMIT = 40
  const CARD_HEADER_HEIGHT = 42
  const STANDARD_PORT_RAIL_HEIGHT = 30
  const GENERATOR_PORT_RAIL_HEIGHT = 78
  const LAYOUT_HORIZONTAL_PADDING = 22
  const LAYOUT_VERTICAL_CHROME = CARD_HEADER_HEIGHT + STANDARD_PORT_RAIL_HEIGHT + 18
  const MIN_LAYOUT_NODE_WIDTH = 260
  const MIN_LAYOUT_NODE_HEIGHT = 220
  const GENERATOR_NODE_WIDTH = 360
  const GENERATOR_PROMPT_EDITOR_HEIGHT = 250
  const LOCAL_NEGATIVE_PROMPT_EXTRA_HEIGHT = 40
  const GENERATOR_NODE_HEIGHT = 260 + GENERATOR_PROMPT_EDITOR_HEIGHT
  const PROVIDER_REFERENCE_LIMIT_FALLBACKS = Object.freeze({ local: 2, gpt: 15, google: 13 })
  const BLOCK_COLORS = ['#22c58b', '#38bdf8', '#a78bfa', '#f59e0b', '#fb7185', '#84cc16']
  const GENERATOR_SETTING_KEYS = Object.freeze([
    'provider', 'localEditStrength', 'randomSeed', 'seed',
    'prompt', 'negativePrompt', 'negativePromptSource',
    'promptMentionBindings', 'promptMentionSourceOrder',
    'gptQualityImg2img', 'gptSize', 'gptCustomWidth', 'gptCustomHeight',
    'googleAspectRatioImg2img', 'googleResolution',
  ])
  const NODE_ACCENTS = Object.freeze({
    reference: '#38bdf8',
    layout: '#f59e0b',
    generator: '#22c58b',
    result: '#a78bfa',
  })
  const REFERENCE_ROLES = Object.freeze({
    layout: '布局参考',
    style: '风格参考',
    character: '角色参考',
    subject: '内容参考',
    asset: '素材参考',
    material: '材质参考',
    color: '色彩参考',
    reference: '普通参考',
  })

  function structureTool() {
    const tool = root && root.NovaFlowUiDesignStructureTool
    if (!tool || typeof tool.normalize !== 'function' || typeof tool.normalizeGraph !== 'function') {
      throw new Error('NovaFlow UI Design structure tool is not ready')
    }
    return tool
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value))
  }

  function finite(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone)
    if (!value || typeof value !== 'object') return value
    const output = {}
    Object.keys(value).forEach(function (key) {
      if (typeof value[key] !== 'function' && typeof value[key] !== 'undefined') output[key] = clone(value[key])
    })
    return output
  }

  function style(node, values) {
    if (node && node.style && values) Object.assign(node.style, values)
    return node
  }

  function append(parent, children) {
    const list = Array.isArray(children) ? children : [children]
    list.filter(Boolean).forEach(function (child) { parent.appendChild(child) })
    return parent
  }

  function createElement(documentRef, tagName, attributes, children) {
    const node = documentRef.createElement(tagName)
    Object.entries(attributes || {}).forEach(function (entry) {
      const name = entry[0]
      const value = entry[1]
      if (name === 'style') style(node, value)
      else if (name === 'text') node.textContent = String(value == null ? '' : value)
      else if (name === 'className') node.className = String(value || '')
      else if (name in node && !name.startsWith('data-') && !name.startsWith('aria-')) node[name] = value
      else if (value != null) node.setAttribute(name, String(value))
    })
    return append(node, children || [])
  }

  function createSvgElement(documentRef, tagName, attributes) {
    const node = typeof documentRef.createElementNS === 'function'
      ? documentRef.createElementNS('http://www.w3.org/2000/svg', tagName)
      : documentRef.createElement(tagName)
    Object.entries(attributes || {}).forEach(function (entry) {
      node.setAttribute(entry[0], String(entry[1]))
    })
    return node
  }

  function defaultProject() {
    return structureTool().normalize({
      id: 'ui-project',
      title: '未命名 UI',
      width: 1920,
      height: 1080,
      blocks: [],
      graph: { schemaVersion: 2, nodes: [], edges: [], lineage: [] },
    })
  }

  function normalizeProject(value) {
    return structureTool().normalize(value && typeof value === 'object' ? value : defaultProject())
  }

  function graphOf(project) {
    return structureTool().normalizeGraph(project && project.graph, {
      legacyBlocks: Array.isArray(project && project.blocks) ? project.blocks : [],
    })
  }

  function firstLayoutBlocks(graph) {
    const layout = graph.nodes.find(function (node) { return node.type === 'layout' })
    return layout && Array.isArray(layout.data && layout.data.blocks) ? layout.data.blocks : []
  }

  function projectWithGraph(project, graphValue) {
    const graph = structureTool().normalizeGraph(graphValue)
    const blocks = clone(firstLayoutBlocks(graph))
    const normalized = normalizeProject(Object.assign({}, project, { blocks: blocks, graph: graph }))
    return Object.assign({}, normalized, { blocks: blocks, graph: graph })
  }

  function resourceById(options, id) {
    const resources = typeof options.getResources === 'function' ? options.getResources() : []
    return (Array.isArray(resources) ? resources : []).find(function (item) {
      return item && String(item.id || '') === String(id || '')
    }) || null
  }

  function resultById(options, id, fallbackResults) {
    const results = typeof options.getResults === 'function' ? options.getResults() : fallbackResults
    return (Array.isArray(results) ? results : []).find(function (item) {
      return item && String(item.id || '') === String(id || '')
    }) || null
  }

  function imageUrl(item) {
    return String(item && (item.dataUrl || item.imageUrl || item.url || item.src) || '')
  }

  function selectionKey(selection) {
    if (!selection) return ''
    if (selection.kind === 'block') return 'block:' + selection.nodeId + ':' + selection.blockId
    if (selection.kind === 'edge') return 'edge:' + selection.edgeId
    return selection.nodeId ? 'node:' + selection.nodeId : ''
  }

  // A generator card is as tall as its controls (measured once they are laid out), so no empty band
  // is left under 生成参数 whatever the provider, the expanded settings or a height saved by an older version.
  const generatorFitHeights = new Map()

  function nodeSize(node) {
    const type = String(node && node.type || '')
    const fitted = type === 'generator' ? generatorFitHeights.get(node && node.id) : 0
    if (fitted) return { width: Math.max(GENERATOR_NODE_WIDTH, finite(node && node.width, GENERATOR_NODE_WIDTH)), height: fitted }
    const data = node && node.data && typeof node.data === 'object' ? node.data : {}
    const settings = data.generationSettings && typeof data.generationSettings === 'object'
      ? data.generationSettings
      : {}
    const provider = String(settings.provider || 'local')
    const generatorHeight = provider === 'local'
      ? 396 + GENERATOR_PROMPT_EDITOR_HEIGHT + LOCAL_NEGATIVE_PROMPT_EXTRA_HEIGHT
      : (provider === 'google' ? 336 : 328) + GENERATOR_PROMPT_EDITOR_HEIGHT
    return {
      width: Math.max(type === 'generator' ? GENERATOR_NODE_WIDTH : 120, finite(node && node.width, type === 'generator' ? GENERATOR_NODE_WIDTH : 280)),
      height: Math.max(type === 'generator' ? generatorHeight : 80, finite(node && node.height, type === 'generator' ? generatorHeight : 220)),
    }
  }

  function portDefinitions(node) {
    if (!node) return []
    if (node.type === 'reference') {
      return [{ id: 'reference', direction: 'out', label: '参考图', kind: 'reference', y: 57 }]
    }
    if (node.type === 'layout') {
      return [{ id: 'layout', direction: 'out', label: '页面结构', kind: 'layout', y: 57 }]
    }
    if (node.type === 'generator') {
      return [
        { id: 'layout', direction: 'in', label: '结构', kind: 'layout', y: 56 },
        { id: 'reference', direction: 'in', label: '参考', kind: 'reference', y: 82 },
        { id: 'iteration', direction: 'in', label: '修改底图', kind: 'iteration', y: 108, hidden: true },
        { id: 'result', direction: 'out', label: '结果', kind: 'result', y: 82 },
      ]
    }
    return [
      { id: 'result', direction: 'in', label: '生成结果', kind: 'result', y: 57 },
      { id: 'reference', direction: 'out', label: '作为参考', kind: 'reference', y: 57 },
    ]
  }

  function portRailHeight(node) {
    return node && node.type === 'generator' ? GENERATOR_PORT_RAIL_HEIGHT : STANDARD_PORT_RAIL_HEIGHT
  }

  function canvasSize(value, fallback) {
    const base = fallback && typeof fallback === 'object' ? fallback : { width: 1920, height: 1080 }
    return {
      width: clamp(Math.round(finite(value && value.width, finite(base.width, 1920))), 320, 8192),
      height: clamp(Math.round(finite(value && value.height, finite(base.height, 1080))), 320, 8192),
    }
  }

  function projectAspectRatio(value) {
    const size = canvasSize(value)
    return Math.max(0.1, size.width / Math.max(1, size.height))
  }

  function layoutNodeHeightForWidth(width, project) {
    return Math.max(180, LAYOUT_VERTICAL_CHROME + (Math.max(MIN_LAYOUT_NODE_WIDTH, width) - LAYOUT_HORIZONTAL_PADDING) / projectAspectRatio(project))
  }

  function layoutNodeSize(project, requestedWidth) {
    const width = Math.max(MIN_LAYOUT_NODE_WIDTH, finite(requestedWidth, 360))
    return { width: width, height: layoutNodeHeightForWidth(width, project) }
  }

  function layoutPreviewSize(node, project, targetCanvas) {
    const size = nodeSize(node)
    const availableWidth = Math.max(1, size.width - LAYOUT_HORIZONTAL_PADDING)
    const availableHeight = Math.max(1, size.height - LAYOUT_VERTICAL_CHROME)
    const aspect = projectAspectRatio(targetCanvas || project)
    const width = Math.min(availableWidth, availableHeight * aspect)
    return { width: width, height: width / aspect }
  }

  function portAnchor(node, portId, direction) {
    const size = nodeSize(node)
    const port = portDefinitions(node).find(function (item) {
      return item.id === portId && item.direction === direction
    }) || portDefinitions(node).find(function (item) { return item.direction === direction })
    return {
      x: finite(node.position && node.position.x, 0) + (direction === 'out' ? size.width : 0),
      y: finite(node.position && node.position.y, 0) + finite(port && port.y, size.height / 2),
    }
  }

  function edgePath(from, to) {
    const distance = Math.max(80, Math.abs(to.x - from.x) * 0.45)
    return 'M ' + from.x + ' ' + from.y + ' C ' + (from.x + distance) + ' ' + from.y + ', ' +
      (to.x - distance) + ' ' + to.y + ', ' + to.x + ' ' + to.y
  }

  function blockColor(block, index) {
    const seed = String(block && (block.kind || block.role) || '').split('').reduce(function (sum, character) {
      return sum + character.charCodeAt(0)
    }, index)
    return BLOCK_COLORS[Math.abs(seed) % BLOCK_COLORS.length]
  }

  function fallbackCleanGuide(project) {
    const width = Math.max(1, Math.round(finite(project && project.width, 1920)))
    const height = Math.max(1, Math.round(finite(project && project.height, 1080)))
    const graph = graphOf(project)
    const blocks = firstLayoutBlocks(graph).filter(function (block) { return block.participates !== false })
    const regions = blocks.map(function (block, index) {
      const shade = 62 + ((index * 31) % 90)
      return '<rect x="' + Math.round(finite(block.x, 0)) + '" y="' + Math.round(finite(block.y, 0)) +
        '" width="' + Math.max(1, Math.round(finite(block.width, 1))) + '" height="' +
        Math.max(1, Math.round(finite(block.height, 1))) + '" rx="12" fill="rgb(' + shade + ',' +
        (shade + 12) + ',' + (shade + 20) + ')" fill-opacity="0.88"/>'
    }).join('')
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
      '" viewBox="0 0 ' + width + ' ' + height + '"><rect width="100%" height="100%" fill="#171717"/>' +
      regions + '</svg>'
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  }

  function cleanLayoutGuide(project) {
    const helper = root && root.NovaFlowUiDesignLayoutGuide
    if (helper && typeof helper.createCleanLayoutGuide === 'function') {
      return helper.createCleanLayoutGuide(project)
    }
    return {
      kind: 'ui-layout-guide',
      role: 'ui_layout',
      clean: true,
      editorSnapshot: false,
      dataUrl: fallbackCleanGuide(project),
      width: project.width,
      height: project.height,
    }
  }

  function mount(options) {
    options = options || {}
    const host = options.host
    if (!host || typeof host.replaceChildren !== 'function') throw new TypeError('UI Design workspace host is required')
    const documentRef = host.ownerDocument || (root && root.document)
    if (!documentRef || typeof documentRef.createElement !== 'function') {
      throw new TypeError('UI Design workspace document is required')
    }
    const windowRef = documentRef.defaultView || root
    const structure = structureTool()
    const supplied = typeof options.getProject === 'function' ? options.getProject() : null
    let project = supplied && typeof supplied === 'object' ? normalizeProject(supplied) : defaultProject()
    let graph = graphOf(project)
    let active = true
    let activeTool = 'select'
    let zoom = 0.82
    let panX = 180
    let panY = 120
    let fitted = false
    let interaction = null
    let selection = null
    let pendingImportMode = 'plain'
    let fitFrame = 0
    let statusTimer = 0
    let transformSettleTimer = 0
    let renderRevision = 0
    let resultFallback = []
    let resultImagePreviewCloser = null
    const generatorStatuses = new Map()
    const history = []
    const future = []
    const nodeElements = new Map()
    const blockElements = new Map()
    const portElements = new Map()
    const layoutPreviewElements = new Map()
    const generatorToolHandles = new Map()
    const nodeIdCounters = new Map()

    function fallbackGenerationState() {
      const value = typeof options.getGenerationState === 'function' ? options.getGenerationState() : {}
      return value && typeof value === 'object' ? value : {}
    }

    function pickGeneratorSettings(value) {
      const source = value && typeof value === 'object' ? value : {}
      return GENERATOR_SETTING_KEYS.reduce(function (output, key) {
        if (Object.prototype.hasOwnProperty.call(source, key)) output[key] = clone(source[key])
        return output
      }, {})
    }

    function generatorPromptDefaults() {
      return {
        prompt: '',
        negativePrompt: '',
        negativePromptSource: '',
      }
    }

    function generatorSettings(node) {
      const fallback = Object.assign(
        { provider: 'local', localEditStrength: 'faithful', randomSeed: true, seed: 0 },
        generatorPromptDefaults(),
        pickGeneratorSettings(fallbackGenerationState()),
      )
      if (structure && typeof structure.generatorSettingsFromNode === 'function') {
        return structure.generatorSettingsFromNode(node, fallback)
      }
      return Object.assign(
        fallback,
        pickGeneratorSettings(node && node.data && node.data.generationSettings),
      )
    }

    function generatorOutput(node) {
      const fallback = canvasSize(fallbackGenerationState(), project)
      if (structure && typeof structure.generatorOutputFromNode === 'function') {
        return structure.generatorOutputFromNode(node, fallback)
      }
      const data = node && node.data && typeof node.data === 'object' ? node.data : {}
      return canvasSize(data.output || (data.generationSettings && data.generationSettings.output), fallback)
    }

    function connectedGeneratorForLayout(layoutNode) {
      if (!layoutNode) return null
      const linkedIds = graph.edges.filter(function (edge) {
        return edge.fromNodeId === layoutNode.id && edge.kind === 'layout'
      }).map(function (edge) { return edge.toNodeId })
      const selected = selection && selection.nodeId
        ? graph.nodes.find(function (node) { return node.id === selection.nodeId && node.type === 'generator' && linkedIds.includes(node.id) })
        : null
      if (selected) return selected
      if (linkedIds.length !== 1) return null
      return graph.nodes.find(function (node) { return node.type === 'generator' && node.id === linkedIds[0] }) || null
    }

    function layoutCoordinateCanvas(layoutNode) {
      const coordinateSize = layoutNode && layoutNode.data && layoutNode.data.canvasSize
      const sourceWidth = Math.round(finite(coordinateSize && coordinateSize.width, 0))
      const sourceHeight = Math.round(finite(coordinateSize && coordinateSize.height, 0))
      if (sourceWidth > 0 && sourceHeight > 0) return { width: sourceWidth, height: sourceHeight }
      return canvasSize(project)
    }

    function layoutDisplayCanvas(layoutNode) {
      const generator = connectedGeneratorForLayout(layoutNode)
      return generator ? generatorOutput(generator) : layoutCoordinateCanvas(layoutNode)
    }

    function layoutBlockBounds(layoutNode, block) {
      const canvas = layoutCoordinateCanvas(layoutNode)
      const normalized = typeof structure.normalizedBlockBounds === 'function'
        ? structure.normalizedBlockBounds(block, canvas)
        : {
            x: clamp(finite(block && block.x, 0) / canvas.width, 0, 1),
            y: clamp(finite(block && block.y, 0) / canvas.height, 0, 1),
            width: clamp(finite(block && block.width, 1) / canvas.width, 0, 1),
            height: clamp(finite(block && block.height, 1) / canvas.height, 0, 1),
          }
      return {
        x: normalized.x * canvas.width,
        y: normalized.y * canvas.height,
        width: normalized.width * canvas.width,
        height: normalized.height * canvas.height,
      }
    }

    function blockWithCanvasGeometry(layoutNode, block, bounds) {
      const canvas = layoutCoordinateCanvas(layoutNode)
      const output = Object.assign({}, block, bounds)
      const hasNormalizedGeometry = typeof structure.hasNormalizedBlockGeometry === 'function'
        ? structure.hasNormalizedBlockGeometry(block)
        : [block && block.xNorm, block && block.yNorm, block && block.wNorm, block && block.hNorm]
          .every(function (value) {
            return value !== null
              && value !== undefined
              && typeof value !== 'boolean'
              && (typeof value !== 'string' || value.trim().length > 0)
              && Number.isFinite(Number(value))
          })
      if (layoutNode?.data?.canvasSize || hasNormalizedGeometry) {
        output.xNorm = Number((bounds.x / canvas.width).toFixed(6))
        output.yNorm = Number((bounds.y / canvas.height).toFixed(6))
        output.wNorm = Number((bounds.width / canvas.width).toFixed(6))
        output.hNorm = Number((bounds.height / canvas.height).toFixed(6))
      }
      return output
    }

    function generatorExpandedHeight(node, settings) {
      const provider = String(settings && settings.provider || 'local')
      if (provider === 'local') return 396 + GENERATOR_PROMPT_EDITOR_HEIGHT + LOCAL_NEGATIVE_PROMPT_EXTRA_HEIGHT
      return (provider === 'google' ? 336 : 328) + GENERATOR_PROMPT_EDITOR_HEIGHT
    }

    function normalizedGeneratorProvider(value) {
      const provider = String(value || '').trim().toLowerCase()
      return provider === 'gpt' || provider === 'google' ? provider : 'local'
    }

    function generatorExternalReferenceLimit(node) {
      const provider = normalizedGeneratorProvider(generatorSettings(node).provider)
      const fallback = PROVIDER_REFERENCE_LIMIT_FALLBACKS[provider]
      const workflow = root && root.NovaFlowUiDesignGenerateWorkflow
      let capability = null
      if (workflow && typeof workflow.providerCapability === 'function') {
        try { capability = workflow.providerCapability(provider) } catch {}
      }
      const requestedValue = capability && capability.externalReferenceLimit
      const requested = requestedValue == null || requestedValue === '' ? NaN : Number(requestedValue)
      const maximum = Math.max(0, finite(structure && structure.GRAPH_GENERATOR_REFERENCE_LIMIT, 15))
      return Number.isFinite(requested)
        ? clamp(Math.round(requested), 0, maximum)
        : clamp(fallback, 0, maximum)
    }

    function generatorConnectionOptions(connection, baseOptions) {
      const connectionOptions = Object.assign({}, baseOptions || {})
      const toNode = connection && graph.nodes.find(function (node) { return node.id === connection.toNodeId })
      const kind = String(connection && connection.kind || '')
      const toPort = String(connection && connection.toPort || '')
      if (toNode && toNode.type === 'generator' &&
        (kind === 'reference' || kind === 'iteration' || toPort === 'reference' || toPort === 'iteration')) {
        connectionOptions.externalReferenceLimit = generatorExternalReferenceLimit(toNode)
      }
      return connectionOptions
    }

    function newGeneratorData() {
      return {
        generationSettings: Object.assign({}, generatorPromptDefaults(), pickGeneratorSettings(fallbackGenerationState())),
        output: canvasSize(fallbackGenerationState(), project),
        settingsExpanded: false,
      }
    }

    function destroyGeneratorTools() {
      generatorToolHandles.forEach(function (handle) {
        try { handle && handle.destroy && handle.destroy() } catch {}
      })
      generatorToolHandles.clear()
    }

    const shell = createElement(documentRef, 'section', {
      'data-novaflow-ui-design-workspace': '1',
      style: {
        position: 'relative',
        width: '100%',
        height: '100%',
        minWidth: '0',
        minHeight: '0',
        overflow: 'hidden',
        background: '#111111',
        color: '#fff',
        userSelect: 'none',
      },
    })
    const viewport = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-viewport': '1',
      'data-preview-ui': '1',
      tabindex: '0',
      style: {
        position: 'absolute',
        inset: '0',
        overflow: 'hidden',
        outline: '0',
        backgroundColor: '#131313',
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
        cursor: 'default',
      },
    })
    const world = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-world': '1',
      style: {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '1px',
        height: '1px',
        transformOrigin: '0 0',
        willChange: 'auto',
        overflow: 'visible',
      },
    })
    const edgesRoot = createSvgElement(documentRef, 'svg', {
      'data-novaflow-ui-design-edges': '1',
      width: '1',
      height: '1',
      style: 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none',
    })
    const nodesRoot = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-nodes': '1',
      style: { position: 'absolute', left: '0', top: '0', width: '1px', height: '1px', overflow: 'visible' },
    })
    const emptyState = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-empty-state': '1',
      style: {
        position: 'absolute',
        left: '50%',
        top: '44%',
        transform: 'translate(-50%,-50%)',
        width: 'min(520px, calc(100% - 48px))',
        display: 'none',
        gap: '14px',
        justifyItems: 'center',
        textAlign: 'center',
        zIndex: '4',
        pointerEvents: 'auto',
      },
    })
    const emptyTitle = createElement(documentRef, 'div', {
      text: '从参考图或页面结构开始',
      style: { fontSize: '20px', fontWeight: '850', color: '#f8fafc' },
    })
    const emptyHint = createElement(documentRef, 'div', {
      text: '参考图、页面结构、生成器和结果都会成为可连接的画布节点',
      style: { fontSize: '12px', lineHeight: '1.6', color: 'rgba(230,230,230,0.55)' },
    })
    const emptyActions = createElement(documentRef, 'div', {
      style: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px' },
    })
    emptyState.appendChild(emptyTitle)
    emptyState.appendChild(emptyHint)
    emptyState.appendChild(emptyActions)

    const toolbar = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-toolbar': '1',
      style: {
        position: 'relative',
        zIndex: '1',
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        padding: '7px',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '12px',
        background: 'rgba(31,31,31,0.96)',
        boxShadow: '0 14px 34px rgba(0,0,0,0.42)',
        backdropFilter: 'blur(10px)',
      },
    })
    const autoFitButton = createElement(documentRef, 'button', {
      type: 'button',
      text: '自动适配',
      title: '自动适配全部节点',
      'data-novaflow-ui-design-toolbar-action': 'fit',
      'data-novaflow-ui-design-auto-fit': '1',
      style: {
        position: 'absolute',
        right: '8px',
        top: '8px',
        zIndex: '12',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '92px',
        minWidth: '92px',
        height: '34px',
        padding: '0 12px',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '8px',
        background: '#2a2a2a',
        color: '#fff',
        fontSize: '13px',
        fontWeight: '400',
        cursor: 'pointer',
      },
    })
    const bottomDock = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-bottom-dock': '1',
      style: {
        position: 'absolute',
        left: '50%',
        bottom: '18px',
        transform: 'translateX(-50%)',
        zIndex: '12',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        maxWidth: 'calc(100% - 36px)',
      },
    }, [toolbar])
    const statusBubble = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-canvas-status': '1',
      style: {
        position: 'absolute',
        left: '50%',
        bottom: '74px',
        transform: 'translateX(-50%)',
        zIndex: '14',
        display: 'none',
        maxWidth: '460px',
        padding: '8px 12px',
        borderRadius: '8px',
        background: 'rgba(23,23,23,0.96)',
        color: '#e5e7eb',
        fontSize: '11px',
        lineHeight: '1.45',
        boxShadow: '0 8px 22px rgba(0,0,0,0.36)',
        pointerEvents: 'none',
      },
    })
    const fileInput = createElement(documentRef, 'input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp',
      multiple: true,
      'data-novaflow-ui-design-canvas-file-input': '1',
      style: { display: 'none' },
    })

    world.appendChild(edgesRoot)
    world.appendChild(nodesRoot)
    viewport.appendChild(world)
    shell.appendChild(viewport)
    shell.appendChild(emptyState)
    shell.appendChild(bottomDock)
    shell.appendChild(autoFitButton)
    shell.appendChild(statusBubble)
    shell.appendChild(fileInput)
    host.replaceChildren(shell)

    function viewportRect() {
      const rect = typeof viewport.getBoundingClientRect === 'function' ? viewport.getBoundingClientRect() : null
      return {
        left: finite(rect && rect.left, 0),
        top: finite(rect && rect.top, 0),
        width: Math.max(1, finite(rect && rect.width, viewport.clientWidth || 1200)),
        height: Math.max(1, finite(rect && rect.height, viewport.clientHeight || 760)),
      }
    }

    function localPoint(event) {
      const rect = viewportRect()
      return {
        x: finite(event && event.clientX, rect.left + rect.width / 2) - rect.left,
        y: finite(event && event.clientY, rect.top + rect.height / 2) - rect.top,
      }
    }

    function worldPoint(event) {
      const point = localPoint(event)
      return { x: (point.x - panX) / zoom, y: (point.y - panY) / zoom }
    }

    function centerWorldPoint() {
      const rect = viewportRect()
      return { x: (rect.width / 2 - panX) / zoom, y: (rect.height / 2 - panY) / zoom }
    }

    function showStatus(message, isError) {
      statusBubble.textContent = (root && root.NovaFlowNeutralText || String)(message || '')
      statusBubble.style.display = message ? 'block' : 'none'
      statusBubble.style.color = isError ? '#fecaca' : '#e5e7eb'
      statusBubble.style.border = isError ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,255,255,0.1)'
      if (statusTimer && root && typeof root.clearTimeout === 'function') root.clearTimeout(statusTimer)
      statusTimer = 0
      if (message && root && typeof root.setTimeout === 'function') {
        statusTimer = root.setTimeout(function () {
          statusTimer = 0
          if (active) statusBubble.style.display = 'none'
        }, 2600)
      }
    }

    function transformTimerHost() {
      if (windowRef && typeof windowRef.setTimeout === 'function') return windowRef
      return root
    }

    function clearTransformSettleTimer() {
      if (!transformSettleTimer) return
      const timerHost = transformTimerHost()
      if (timerHost && typeof timerHost.clearTimeout === 'function') timerHost.clearTimeout(transformSettleTimer)
      transformSettleTimer = 0
    }

    function beginInteractiveTransform() {
      clearTransformSettleTimer()
      // Keeping the DOM cards on a forced compositor layer makes Chromium
      // reuse a scaled text texture while zooming/panning, then rasterize it
      // again after release. That produces the visible clear/blur flicker.
      world.style.willChange = 'auto'
    }

    function settleInteractiveTransform() {
      clearTransformSettleTimer()
      if (!active) return
      world.style.willChange = 'auto'
      syncWorldTransform()
    }

    function syncWorldTransform() {
      world.style.transform = 'translate(' + Math.round(panX) + 'px,' + Math.round(panY) + 'px) scale(' + zoom + ')'
      const grid = Math.max(8, GRID_SIZE * zoom)
      viewport.style.backgroundSize = grid + 'px ' + grid + 'px'
      viewport.style.backgroundPosition = (panX % grid) + 'px ' + (panY % grid) + 'px'
    }

    function zoomAround(nextZoomValue, anchor) {
      const nextZoom = Math.round(clamp(nextZoomValue, MIN_ZOOM, MAX_ZOOM) * ZOOM_PRECISION) / ZOOM_PRECISION
      if (Math.abs(nextZoom - zoom) < 0.0001) return
      const rect = viewportRect()
      const point = anchor || { x: rect.width / 2, y: rect.height / 2 }
      const worldX = (point.x - panX) / zoom
      const worldY = (point.y - panY) / zoom
      panX = point.x - worldX * nextZoom
      panY = point.y - worldY * nextZoom
      zoom = nextZoom
      syncWorldTransform()
    }

    function fitAll() {
      clearTransformSettleTimer()
      world.style.willChange = 'auto'
      const rect = viewportRect()
      if (!graph.nodes.length) {
        zoom = 1
        panX = rect.width / 2
        panY = rect.height / 2
        fitted = true
        syncWorldTransform()
        return { zoom: zoom, panX: panX, panY: panY }
      }
      const bounds = graph.nodes.reduce(function (output, node) {
        const size = nodeSize(node)
        const x = finite(node.position && node.position.x, 0)
        const y = finite(node.position && node.position.y, 0)
        output.minX = Math.min(output.minX, x)
        output.minY = Math.min(output.minY, y)
        output.maxX = Math.max(output.maxX, x + size.width)
        output.maxY = Math.max(output.maxY, y + size.height)
        return output
      }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
      const contentWidth = Math.max(1, bounds.maxX - bounds.minX)
      const contentHeight = Math.max(1, bounds.maxY - bounds.minY)
      const availableWidth = Math.max(80, rect.width - FIT_PADDING * 2)
      const availableHeight = Math.max(80, rect.height - FIT_PADDING * 2)
      zoom = Math.round(clamp(Math.min(availableWidth / contentWidth, availableHeight / contentHeight, 1.15), MIN_ZOOM, MAX_ZOOM) * ZOOM_PRECISION) / ZOOM_PRECISION
      panX = (rect.width - contentWidth * zoom) / 2 - bounds.minX * zoom
      panY = (rect.height - contentHeight * zoom) / 2 - bounds.minY * zoom
      fitted = true
      syncWorldTransform()
      return { zoom: zoom, panX: panX, panY: panY }
    }

    function focusViewport() {
      if (!active || typeof viewport.focus !== 'function') return
      try { viewport.focus({ preventScroll: true }) } catch {
        try { viewport.focus() } catch {}
      }
    }

    function refreshSelectionAppearance() {
      nodeElements.forEach(function (card, nodeId) {
        const node = graph.nodes.find(function (item) { return item.id === nodeId })
        if (!node || !card || !card.style) return
        const selected = Boolean(selection && selection.nodeId === nodeId)
        const accent = NODE_ACCENTS[node.type] || '#A0A0A0'
        card.style.border = selected ? '2px solid ' + accent : '1px solid rgba(255,255,255,0.14)'
        card.style.boxShadow = selected
          ? '0 0 0 2px rgba(255,255,255,0.08), 0 18px 40px rgba(0,0,0,0.42)'
          : '0 12px 30px rgba(0,0,0,0.34)'
      })
      blockElements.forEach(function (element, key) {
        if (!element || !element.style) return
        const parts = String(key || '').split(':')
        const selected = Boolean(selection && selection.kind === 'block' && selection.nodeId === parts[0] && selection.blockId === parts.slice(1).join(':'))
        element.style.border = selected ? '2px solid #fff' : String(element.__novaflowBaseBorder || '1.5px solid #22c58b')
        const resize = element.__novaflowResizeHandle
        if (resize && resize.style) {
          resize.style.opacity = selected ? '1' : '0'
          resize.style.pointerEvents = selected ? 'auto' : 'none'
        }
      })
      Array.from(edgesRoot.children || []).forEach(function (path) {
        if (!path || typeof path.setAttribute !== 'function') return
        const selected = Boolean(selection && selection.kind === 'edge' && selection.edgeId === path.__novaflowEdgeId)
        if (path.__novaflowEdgeVisible) {
          path.setAttribute('stroke-width', selected ? '4' : '2.5')
          path.setAttribute('opacity', selected ? '1' : '0.9')
        }
        if (path.__novaflowEdgeCut) {
          const visible = selected || path.__novaflowEdgeHovered === true
          path.setAttribute('opacity', visible ? '1' : '0')
          path.setAttribute('pointer-events', visible ? 'all' : 'none')
        }
      })
    }

    function emitSelection(nextSelection) {
      selection = nextSelection ? clone(nextSelection) : null
      const payload = resolveSelection(selection)
      if (typeof options.onSelectionChange === 'function') {
        options.onSelectionChange(selectionKey(selection), payload)
      }
      refreshSelectionAppearance()
    }

    function effectiveNode(node) {
      if (!node || !interaction || interaction.nodeId !== node.id || !interaction.preview) return node
      if (interaction.kind === 'move-node') {
        return Object.assign({}, node, { position: interaction.preview })
      }
      if (interaction.kind === 'resize-node') {
        return Object.assign({}, node, {
          width: interaction.preview.width,
          height: interaction.preview.height,
        })
      }
      return node
    }

    function resolveSelection(value) {
      if (!value) return null
      if (value.kind === 'edge') {
        const edge = graph.edges.find(function (item) { return item.id === value.edgeId })
        return edge ? { kind: 'edge', edge: edge, edgeId: edge.id } : null
      }
      const node = graph.nodes.find(function (item) { return item.id === value.nodeId })
      if (!node) return null
      if (value.kind === 'block') {
        const blocks = Array.isArray(node.data && node.data.blocks) ? node.data.blocks : []
        const block = blocks.find(function (item) { return item.id === value.blockId })
        return block ? { kind: 'block', node: node, nodeId: node.id, block: block, blockId: block.id } : null
      }
      return { kind: 'node', node: node, nodeId: node.id }
    }

    function recordHistory() {
      history.push(clone(project))
      if (history.length > HISTORY_LIMIT) history.shift()
      future.length = 0
    }

    function commitGraph(nextGraph, detail, trackHistory) {
      if (trackHistory !== false) recordHistory()
      graph = structure.normalizeGraph(nextGraph)
      project = projectWithGraph(project, graph)
      const revisionBeforeCallback = renderRevision
      if (typeof options.onProjectChange === 'function') options.onProjectChange(project, detail || { reason: 'graph-change' })
      if (renderRevision === revisionBeforeCallback) render()
      return project
    }

    function graphMutation(method, args, detail) {
      const fn = structure[method]
      if (typeof fn !== 'function') return { ok: false, graph: graph, error: '图操作不可用' }
      const result = fn.apply(structure, [graph].concat(args || []))
      if (!result || result.ok === false) {
        showStatus(result && result.error || '图操作失败', true)
        return result || { ok: false, graph: graph }
      }
      commitGraph(result.graph, detail)
      return result
    }

    function uniqueNodeId(prefix) {
      const used = new Set(graph.nodes.map(function (node) { return node.id }))
      const marker = prefix + '_'
      const highestUsed = graph.nodes.reduce(function (highest, node) {
        const id = String(node && node.id || '')
        if (!id.startsWith(marker)) return highest
        const suffix = Number(id.slice(marker.length))
        return Number.isInteger(suffix) && suffix > highest ? suffix : highest
      }, 0)
      let suffix = Math.max(Number(nodeIdCounters.get(prefix)) || 1, highestUsed + 1)
      let id = prefix + '_' + suffix
      while (used.has(id)) {
        suffix += 1
        id = prefix + '_' + suffix
      }
      nodeIdCounters.set(prefix, suffix + 1)
      return id
    }

    function addNode(type, position, data, title) {
      const nodeValue = {
        id: uniqueNodeId(type),
        type: type,
        title: title,
        position: { x: finite(position && position.x, 0), y: finite(position && position.y, 0) },
        data: data || {},
      }
      if (type === 'layout') Object.assign(nodeValue, layoutNodeSize(project))
      return graphMutation('createGraphNode', [nodeValue], { reason: 'add-node', nodeType: type })
    }

    function patchNode(nodeId, patch, reason) {
      return graphMutation('updateGraphNode', [nodeId, patch], { reason: reason || 'update-node', nodeId: nodeId })
    }

    function generatorNode(nodeId) {
      const id = String(nodeId || '')
      return graph.nodes.find(function (node) { return node.type === 'generator' && node.id === id }) || null
    }

    function generatorProfile(nodeId) {
      const node = generatorNode(nodeId)
      if (!node) return null
      return {
        generationSettings: clone(generatorSettings(node)),
        output: clone(generatorOutput(node)),
        settingsExpanded: Boolean(node.data && node.data.settingsExpanded),
      }
    }

    function patchGeneratorSettings(nodeId, value) {
      const node = generatorNode(nodeId)
      if (!node) return { ok: false, error: 'UI 生成器节点不存在' }
      const incoming = value && typeof value === 'object' ? value : {}
      const nextSettings = Object.assign({}, generatorSettings(node), pickGeneratorSettings(incoming))
      const normalized = structure && typeof structure.normalizeGeneratorSettings === 'function'
        ? structure.normalizeGeneratorSettings(nextSettings)
        : nextSettings
      const nextNode = Object.assign({}, node, {
        data: Object.assign({}, node.data, { generationSettings: normalized }),
      })
      return patchNode(node.id, {
        data: { generationSettings: normalized },
        height: generatorExpandedHeight(nextNode, normalized),
      }, 'update-generator-settings')
    }

    function patchGeneratorOutput(nodeId, value) {
      const node = generatorNode(nodeId)
      if (!node) return { ok: false, error: 'UI 生成器节点不存在' }
      const output = structure && typeof structure.normalizeGeneratorOutput === 'function'
        ? structure.normalizeGeneratorOutput(value, generatorOutput(node))
        : canvasSize(value, generatorOutput(node))
      return patchNode(node.id, { data: { output: output } }, 'update-generator-output')
    }

    function setGeneratorExpanded(nodeId, expanded) {
      const node = generatorNode(nodeId)
      if (!node) return { ok: false, error: 'UI 生成器节点不存在' }
      const settings = generatorSettings(node)
      const nextNode = Object.assign({}, node, {
        data: Object.assign({}, node.data, { settingsExpanded: expanded === true }),
      })
      return patchNode(node.id, {
        data: { settingsExpanded: expanded === true },
        height: generatorExpandedHeight(nextNode, settings),
      }, 'toggle-generator-settings')
    }

    function setGeneratorStatus(nodeId, message, statusOptions) {
      const id = String(nodeId || '')
      const value = {
        message: String(message || ''),
        error: Boolean(statusOptions && statusOptions.error),
        running: Boolean(statusOptions && statusOptions.running),
      }
      if (!id) {
        showStatus(value.message, value.error)
        return false
      }
      generatorStatuses.set(id, value)
      const handle = generatorToolHandles.get(id)
      if (handle && typeof handle.setStatus === 'function') {
        handle.setStatus(value.message, { error: value.error, running: value.running })
      } else if (generatorNode(id)) {
        renderNodes()
        renderEdges()
      }
      return true
    }

    function focusGenerator(nodeId) {
      const node = generatorNode(nodeId)
      if (!node) return false
      emitSelection({ kind: 'node', nodeId: node.id })
      renderNodes()
      renderEdges()
      focusViewport()
      return true
    }

    function removeNode(nodeId) {
      return graphMutation('removeGraphNode', [nodeId], { reason: 'remove-node', nodeId: nodeId })
    }

    function connectNodes(connection) {
      const connectionOptions = generatorConnectionOptions(connection)
      if (typeof structure.validateConnection === 'function') {
        const validated = structure.validateConnection(graph, connection, connectionOptions)
        if (!validated || validated.ok === false) {
          showStatus(validated && validated.error || '节点连接失败', true)
          return validated || { ok: false, graph: graph }
        }
      }
      let externalResult = null
      if (typeof options.onConnect === 'function') {
        try { externalResult = options.onConnect(clone(connection)) } catch (error) {
          externalResult = { ok: false, error: String(error && error.message || error) }
        }
      }
      if (externalResult && externalResult.ok === false) {
        showStatus(externalResult.error || '节点连接失败', true)
        return externalResult
      }
      if (externalResult && externalResult.graph) {
        graph = structure.normalizeGraph(externalResult.graph)
        project = projectWithGraph(project, graph)
        render()
        return externalResult
      }
      return graphMutation('connectGraph', [connection, connectionOptions], { reason: 'connect-nodes' })
    }

    function removeEdge(edgeId) {
      return graphMutation('removeGraphEdge', [edgeId], { reason: 'remove-edge', edgeId: edgeId })
    }

    function templateBlocks() {
      const width = project.width
      const height = project.height
      return [
        { id: 'header', kind: 'header', name: '顶部导航', purpose: '品牌、主要入口和账户操作', x: Math.round(width * 0.05), y: Math.round(height * 0.04), width: Math.round(width * 0.9), height: Math.round(height * 0.1), zIndex: 1, locked: false, participates: true },
        { id: 'hero', kind: 'hero', name: '主视觉', purpose: '展示核心角色与主要行动入口', x: Math.round(width * 0.08), y: Math.round(height * 0.18), width: Math.round(width * 0.84), height: Math.round(height * 0.43), zIndex: 2, locked: false, participates: true },
        { id: 'cards', kind: 'card_grid', name: '卖点卡片', purpose: '承载三个并列功能卖点', x: Math.round(width * 0.08), y: Math.round(height * 0.66), width: Math.round(width * 0.84), height: Math.round(height * 0.22), zIndex: 3, locked: false, participates: true },
        { id: 'footer', kind: 'footer', name: '底部信息', purpose: '辅助导航和版权信息', x: Math.round(width * 0.08), y: Math.round(height * 0.91), width: Math.round(width * 0.84), height: Math.round(height * 0.05), zIndex: 4, locked: false, participates: true },
      ]
    }

    function createWorkflowStarter(kind, anchor, reference) {
      const center = anchor || centerWorldPoint()
      const layoutSize = layoutNodeSize(project)
      const startGraph = graph
      let nextGraph = startGraph
      let layoutResult = structure.createGraphNode(nextGraph, {
        id: uniqueNodeId('layout'),
        type: 'layout',
        title: '页面结构',
        position: { x: center.x - 300, y: center.y - layoutSize.height / 2 },
        width: layoutSize.width,
        height: layoutSize.height,
        data: { blocks: kind === 'template' ? templateBlocks() : [] },
      })
      if (!layoutResult.ok) return layoutResult
      nextGraph = layoutResult.graph
      const layoutNode = layoutResult.node
      const generatorResult = structure.createGraphNode(nextGraph, {
        id: uniqueNodeId('generator'),
        type: 'generator',
        title: 'UI 生成器',
        position: { x: center.x + 180, y: center.y - GENERATOR_NODE_HEIGHT / 2 },
        data: newGeneratorData(),
      })
      if (!generatorResult.ok) return generatorResult
      nextGraph = generatorResult.graph
      const generatorNode = generatorResult.node
      const linked = structure.connectGraph(nextGraph, {
        fromNodeId: layoutNode.id,
        fromPort: 'layout',
        toNodeId: generatorNode.id,
        toPort: 'layout',
        kind: 'layout',
      })
      if (linked.ok) nextGraph = linked.graph
      if (reference) {
        const referenceResult = structure.createGraphNode(nextGraph, {
          id: uniqueNodeId('reference'),
          type: 'reference',
          title: reference.name || '布局参考',
          position: { x: center.x - 660, y: center.y - 130 },
          data: { resourceId: reference.id, role: 'layout' },
        })
        if (referenceResult.ok) {
          nextGraph = referenceResult.graph
          const referenceEdge = structure.connectGraph(nextGraph, {
            fromNodeId: referenceResult.node.id,
            fromPort: 'reference',
            toNodeId: generatorNode.id,
            toPort: 'reference',
            kind: 'reference',
          })
          if (referenceEdge.ok) nextGraph = referenceEdge.graph
        }
      }
      commitGraph(nextGraph, { reason: 'create-workflow-starter', starter: kind })
      emitSelection({ kind: 'node', nodeId: layoutNode.id })
      fitAll()
      return { ok: true, layoutNodeId: layoutNode.id, generatorNodeId: generatorNode.id, graph: graph }
    }

    function defaultReferencePosition() {
      const center = centerWorldPoint()
      const resolved = resolveSelection(selection)
      const layouts = graph.nodes.filter(function (node) { return node.type === 'layout' })
      let layout = resolved && resolved.node && resolved.node.type === 'layout' ? resolved.node : null
      if (!layout && layouts.length) {
        layout = layouts.slice().sort(function (left, right) {
          const leftX = finite(left.position && left.position.x, 0) - center.x
          const leftY = finite(left.position && left.position.y, 0) - center.y
          const rightX = finite(right.position && right.position.x, 0) - center.x
          const rightY = finite(right.position && right.position.y, 0) - center.y
          return leftX * leftX + leftY * leftY - (rightX * rightX + rightY * rightY)
        })[0]
      }
      if (!layout) return center

      const referenceSize = { width: 260, height: 240 }
      const x = finite(layout.position && layout.position.x, 0) - referenceSize.width - 140
      let y = finite(layout.position && layout.position.y, 0)
      const occupied = graph.nodes.filter(function (node) { return node.type === 'reference' })
      function overlaps(candidateY, node) {
        const size = nodeSize(node)
        const nodeX = finite(node.position && node.position.x, 0)
        const nodeY = finite(node.position && node.position.y, 0)
        return x < nodeX + size.width + 24 && x + referenceSize.width + 24 > nodeX &&
          candidateY < nodeY + size.height + 24 && candidateY + referenceSize.height + 24 > nodeY
      }
      let attempts = 0
      while (occupied.some(function (node) { return overlaps(y, node) }) && attempts < 40) {
        y += referenceSize.height + 30
        attempts += 1
      }
      return { x: x, y: y }
    }

    function addReferenceResource(resource, position, role) {
      if (!resource || !resource.id) return { ok: false, error: '参考图资源无效' }
      const result = addNode('reference', position || defaultReferencePosition(), {
        resourceId: resource.id,
        role: role || 'reference',
      }, resource.name || '参考图')
      if (result && result.ok) {
        emitSelection({ kind: 'node', nodeId: result.node.id })
      }
      return result
    }

    function addResultNode(result, generatorNodeId) {
      if (!result || !result.id) return { ok: false, error: '生成结果无效' }
      const generator = graph.nodes.find(function (node) { return node.id === generatorNodeId && node.type === 'generator' }) ||
        graph.nodes.find(function (node) { return node.type === 'generator' })
      const position = (function () {
        if (!generator) return centerWorldPoint()
        const resultSize = nodeSize({ width: 320, height: 260 })
        const x = generator.position.x + nodeSize(generator).width + 150
        let y = generator.position.y - 20
        const occupied = graph.nodes.filter(function (node) { return node.type === 'result' })
        let attempts = 0
        function overlaps(node) {
          const size = nodeSize(node)
          const gap = 36
          return x < node.position.x + size.width + gap &&
            x + resultSize.width + gap > node.position.x &&
            y < node.position.y + size.height + gap &&
            y + resultSize.height + gap > node.position.y
        }
        while (occupied.some(overlaps) && attempts < 80) {
          y += resultSize.height + 40
          attempts += 1
        }
        return { x: x, y: y }
      })()
      const added = addNode('result', position, {
        resultId: result.id,
        sourceNodeId: generator && generator.id || '',
      }, result.name || '生成结果')
      if (!added || !added.ok) return added
      if (generator) {
        connectNodes({
          fromNodeId: generator.id,
          fromPort: 'result',
          toNodeId: added.node.id,
          toPort: 'result',
          kind: 'result',
        })
      }
      emitSelection({ kind: 'node', nodeId: added.node.id })
      return added
    }

    function requestGenerate(generatorNodeId) {
      let generator = graph.nodes.find(function (node) { return node.id === generatorNodeId && node.type === 'generator' })
      if (!generator) generator = graph.nodes.find(function (node) { return node.type === 'generator' })
      if (!generator) {
        const layout = graph.nodes.find(function (node) { return node.type === 'layout' })
        if (!layout || !(layout.data && Array.isArray(layout.data.blocks) && layout.data.blocks.some(function (block) { return block.participates !== false }))) {
          showStatus('请先创建页面结构，并添加至少一个参与生成的布局块', true)
          return false
        }
        const created = addNode('generator', {
          x: layout.position.x + nodeSize(layout).width + 140,
          y: layout.position.y + 20,
        }, newGeneratorData(), 'UI 生成器')
        if (!created || !created.ok) return false
        generator = created.node
        connectNodes({
          fromNodeId: layout.id,
          fromPort: 'layout',
          toNodeId: generator.id,
          toPort: 'layout',
          kind: 'layout',
        })
      }
      const layoutEdge = graph.edges.find(function (edge) {
        return edge.toNodeId === generator.id && edge.kind === 'layout'
      })
      const layout = layoutEdge && graph.nodes.find(function (node) {
        return node.id === layoutEdge.fromNodeId && node.type === 'layout'
      })
      if (!layout) {
        showStatus('请先把页面结构连接到 UI 生成器的结构端口', true)
        return false
      }
      if (!(layout.data && Array.isArray(layout.data.blocks) && layout.data.blocks.some(function (block) { return block.participates !== false }))) {
        showStatus('请在已连接的页面结构中添加至少一个参与生成的布局块', true)
        return false
      }
      if (typeof options.onGenerateRequest !== 'function') return false
      const scopedProject = projectWithGraph(project, {
        ...graph,
        nodes: [layout],
        edges: [],
        lineage: [],
      })
      scopedProject.blocks = layout.data.blocks.slice()
      const guide = cleanLayoutGuide(scopedProject)
      return options.onGenerateRequest({
        project: clone(scopedProject),
        generatorNodeId: generator.id,
        generationSettings: clone(generatorSettings(generator)),
        output: clone(generatorOutput(generator)),
        layoutGuide: guide,
        semanticLayout: guide.semantic || null,
      })
    }

    function openReferencePicker(mode) {
      pendingImportMode = mode || 'plain'
      if (typeof fileInput.click === 'function') fileInput.click()
    }

    async function importFiles(files, point, mode) {
      const list = Array.from(files || [])
      if (!active || !list.length || typeof options.onImportFiles !== 'function') return []
      try {
        const added = await options.onImportFiles(list)
        if (!active) return []
        const resources = Array.isArray(added) ? added : []
        if (!resources.length) return []
        if (mode === 'starter' && !graph.nodes.length) {
          createWorkflowStarter('blank', point || centerWorldPoint(), resources[0])
          resources.slice(1).forEach(function (resource, index) {
            addReferenceResource(resource, {
              x: (point || centerWorldPoint()).x - 660,
              y: (point || centerWorldPoint()).y + 150 + index * 270,
            }, 'reference')
          })
        } else {
          resources.forEach(function (resource, index) {
            addReferenceResource(resource, point ? {
              x: finite(point.x, centerWorldPoint().x) + index * 32,
              y: finite(point.y, centerWorldPoint().y) + index * 270,
            } : null, 'reference')
          })
        }
        showStatus('已把 ' + resources.length + ' 张参考图加入画布', false)
        return resources
      } catch (error) {
        if (active) showStatus(String(error && error.message || error || '参考图导入失败'), true)
        return []
      }
    }

    function undo() {
      if (!history.length) return false
      future.push(clone(project))
      project = normalizeProject(history.pop())
      graph = graphOf(project)
      emitSelection(null)
      if (typeof options.onProjectChange === 'function') options.onProjectChange(project, { reason: 'undo' })
      render()
      return true
    }

    function redo() {
      if (!future.length) return false
      history.push(clone(project))
      project = normalizeProject(future.pop())
      graph = graphOf(project)
      emitSelection(null)
      if (typeof options.onProjectChange === 'function') options.onProjectChange(project, { reason: 'redo' })
      render()
      return true
    }

    function toolbarButton(action, label, config) {
      config = config || {}
      const selected = config.tool && activeTool === action
      const button = createElement(documentRef, 'button', {
        type: 'button',
        text: label,
        title: config.title || label,
        'data-novaflow-ui-design-toolbar-action': action,
        'aria-pressed': config.tool ? (selected ? 'true' : 'false') : 'false',
        disabled: config.disabled === true,
        style: {
          height: '34px',
          minWidth: config.wide ? '82px' : '38px',
          padding: config.wide ? '0 11px' : '0 9px',
          border: selected ? '1px solid rgba(110,231,183,0.72)' : '1px solid rgba(255,255,255,0.1)',
          borderRadius: '7px',
          background: selected ? '#176b50' : '#292929',
          color: config.disabled ? 'rgba(255,255,255,0.28)' : '#f4f4f5',
          cursor: config.disabled ? 'not-allowed' : 'pointer',
          fontSize: '11px',
          fontWeight: '600',
          whiteSpace: 'nowrap',
        },
      })
      if (typeof config.onClick === 'function') button.addEventListener('click', config.onClick)
      return button
    }

    function setTool(nextTool) {
      const allowed = ['select', 'region']
      activeTool = allowed.includes(nextTool) ? nextTool : 'select'
      viewport.style.cursor = activeTool === 'region' ? 'crosshair' : 'default'
      renderToolbar()
      renderNodes()
      return activeTool
    }

    function renderToolbar() {
      toolbar.replaceChildren(
        toolbarButton('reference', '+ 参考图', { wide: true, onClick: function () { openReferencePicker('plain') } }),
        toolbarButton('layout', '+ 页面结构', { wide: true, onClick: function () {
          const point = centerWorldPoint()
          const size = layoutNodeSize(project)
          const added = addNode('layout', { x: point.x - size.width / 2, y: point.y - size.height / 2 }, { blocks: [] }, '页面结构')
          if (added && added.ok) emitSelection({ kind: 'node', nodeId: added.node.id })
        } }),
        toolbarButton('generator', '+ 生成器', { wide: true, onClick: function () {
          const resolved = resolveSelection(selection)
          const layout = resolved && resolved.node && resolved.node.type === 'layout'
            ? resolved.node
            : graph.nodes.find(function (node) { return node.type === 'layout' })
          const point = layout
            ? { x: layout.position.x + nodeSize(layout).width + 140, y: layout.position.y + 20 }
            : centerWorldPoint()
          const added = addNode('generator', point, newGeneratorData(), 'UI 生成器')
          if (added && added.ok) {
            emitSelection({ kind: 'node', nodeId: added.node.id })
          }
        } }),
        toolbarButton('region', '布局块', { tool: true, onClick: function () {
          const selected = resolveSelection(selection)
          if (!selected || !selected.node || selected.node.type !== 'layout') {
            const layout = graph.nodes.find(function (node) { return node.type === 'layout' })
            if (layout) emitSelection({ kind: 'node', nodeId: layout.id })
            else {
              showStatus('请先添加一个页面结构节点', true)
              return
            }
          }
          setTool(activeTool === 'region' ? 'select' : 'region')
        } }),
        toolbarButton('undo', '↶', { title: '撤销', disabled: !history.length, onClick: undo }),
        toolbarButton('redo', '↷', { title: '重做', disabled: !future.length, onClick: redo }),
      )
    }

    function nodeCardBase(node, selected) {
      const size = nodeSize(node)
      const accent = NODE_ACCENTS[node.type] || '#A0A0A0'
      return {
        position: 'absolute',
        left: finite(node.position && node.position.x, 0) + 'px',
        top: finite(node.position && node.position.y, 0) + 'px',
        width: size.width + 'px',
        height: size.height + 'px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'visible',
        border: selected ? '2px solid ' + accent : '1px solid rgba(255,255,255,0.14)',
        borderRadius: '11px',
        background: '#232323',
        boxShadow: selected ? '0 0 0 2px rgba(255,255,255,0.08), 0 18px 40px rgba(0,0,0,0.42)' : '0 12px 30px rgba(0,0,0,0.34)',
        boxSizing: 'border-box',
        color: '#fff',
      }
    }

    function captureInteractionPointer(event) {
      if (typeof viewport.setPointerCapture !== 'function' || !event || event.pointerId == null) return
      try { viewport.setPointerCapture(event.pointerId) } catch {}
    }

    function startNodeMove(event, node) {
      if (!active || finite(event && event.button, 0) !== 0) return
      event && event.preventDefault && event.preventDefault()
      event && event.stopPropagation && event.stopPropagation()
      emitSelection({ kind: 'node', nodeId: node.id })
      focusViewport()
      if (activeTool !== 'select') return
      interaction = {
        kind: 'move-node',
        pointerId: event && event.pointerId,
        nodeId: node.id,
        start: worldPoint(event),
        original: { x: node.position.x, y: node.position.y },
        preview: null,
      }
      captureInteractionPointer(event)
    }

    function startNodeResize(event, node) {
      if (!active || !node || node.type !== 'layout' || finite(event && event.button, 0) !== 0) return
      event && event.preventDefault && event.preventDefault()
      event && event.stopPropagation && event.stopPropagation()
      emitSelection({ kind: 'node', nodeId: node.id })
      focusViewport()
      const size = nodeSize(node)
      interaction = {
        kind: 'resize-node',
        pointerId: event && event.pointerId,
        nodeId: node.id,
        start: worldPoint(event),
        original: { width: size.width, height: size.height },
        preview: null,
      }
      captureInteractionPointer(event)
    }

    function layoutPreviewMetrics(node, preview) {
      const rect = preview && typeof preview.getBoundingClientRect === 'function' ? preview.getBoundingClientRect() : null
      const card = nodeSize(node)
      return {
        left: finite(rect && rect.left, 0),
        top: finite(rect && rect.top, 0),
        width: Math.max(1, finite(rect && rect.width, card.width - 24)),
        height: Math.max(1, finite(rect && rect.height, card.height - LAYOUT_VERTICAL_CHROME)),
      }
    }

    function outputPoint(event, node, preview, fixedMetrics) {
      const metrics = fixedMetrics || layoutPreviewMetrics(node, preview)
      const canvas = layoutCoordinateCanvas(node)
      return {
        x: clamp((finite(event && event.clientX, metrics.left) - metrics.left) / metrics.width * canvas.width, 0, canvas.width),
        y: clamp((finite(event && event.clientY, metrics.top) - metrics.top) / metrics.height * canvas.height, 0, canvas.height),
      }
    }

    function updateLayoutBlocks(nodeId, blocks, detail) {
      return patchNode(nodeId, { data: { blocks: blocks } }, detail || 'update-layout-blocks')
    }

    function startBlockMove(event, node, block, preview) {
      if (finite(event && event.button, 0) !== 0) return
      event && event.preventDefault && event.preventDefault()
      event && event.stopPropagation && event.stopPropagation()
      emitSelection({ kind: 'block', nodeId: node.id, blockId: block.id })
      focusViewport()
      if (activeTool !== 'select' || block.locked) return
      const previewMetrics = layoutPreviewMetrics(node, preview)
      const canvas = layoutCoordinateCanvas(node)
      interaction = {
        kind: 'move-block',
        pointerId: event && event.pointerId,
        nodeId: node.id,
        blockId: block.id,
        previewElement: preview,
        previewMetrics: previewMetrics,
        canvas: canvas,
        start: outputPoint(event, node, preview, previewMetrics),
        original: Object.assign({}, clone(block), layoutBlockBounds(node, block)),
        preview: null,
      }
      captureInteractionPointer(event)
    }

    function startBlockResize(event, node, block, preview) {
      if (finite(event && event.button, 0) !== 0) return
      event && event.preventDefault && event.preventDefault()
      event && event.stopPropagation && event.stopPropagation()
      emitSelection({ kind: 'block', nodeId: node.id, blockId: block.id })
      focusViewport()
      if (block.locked) return
      const previewMetrics = layoutPreviewMetrics(node, preview)
      const canvas = layoutCoordinateCanvas(node)
      interaction = {
        kind: 'resize-block',
        pointerId: event && event.pointerId,
        nodeId: node.id,
        blockId: block.id,
        previewElement: preview,
        previewMetrics: previewMetrics,
        canvas: canvas,
        start: outputPoint(event, node, preview, previewMetrics),
        original: Object.assign({}, clone(block), layoutBlockBounds(node, block)),
        preview: null,
      }
      captureInteractionPointer(event)
    }

    function startBlockCreate(event, node, preview) {
      if (activeTool !== 'region' || finite(event && event.button, 0) !== 0) return
      event && event.preventDefault && event.preventDefault()
      event && event.stopPropagation && event.stopPropagation()
      focusViewport()
      const previewMetrics = layoutPreviewMetrics(node, preview)
      const point = outputPoint(event, node, preview, previewMetrics)
      const canvas = layoutCoordinateCanvas(node)
      interaction = {
        kind: 'create-block',
        pointerId: event && event.pointerId,
        nodeId: node.id,
        previewElement: preview,
        previewMetrics: previewMetrics,
        canvas: canvas,
        start: point,
        preview: { x: point.x, y: point.y, width: 1, height: 1 },
      }
      captureInteractionPointer(event)
      renderNodes()
    }

    function portElementKey(nodeId, direction, portId) {
      return String(nodeId || '') + ':' + String(direction || '') + ':' + String(portId || '')
    }

    function replacementEdgeFor(connection) {
      if (!connection || connection.toPort !== 'iteration') return null
      return graph.edges.find(function (edge) {
        return edge.toNodeId === connection.toNodeId && edge.toPort === 'iteration' && edge.kind === 'iteration'
      }) || null
    }

    function validatePortConnection(connection) {
      if (!connection || typeof structure.validateConnection !== 'function') return { ok: false, error: '连接校验不可用' }
      const replacement = replacementEdgeFor(connection)
      const validationOptions = generatorConnectionOptions(connection, replacement ? { ignoreEdgeId: replacement.id } : {})
      const result = structure.validateConnection(graph, connection, validationOptions)
      return Object.assign({}, result, { replacement: replacement })
    }

    function connectionFromTarget(target) {
      if (!interaction || interaction.kind !== 'connect-edge' || !target || target.direction !== 'in') return null
      return {
        fromNodeId: interaction.source.nodeId,
        fromPort: interaction.source.port.id,
        toNodeId: target.nodeId,
        toPort: target.port.id,
        kind: target.port.kind,
      }
    }

    function portTargetFromElement(element) {
      let current = element
      while (current && current !== viewport) {
        if (current.__novaflowPortTarget) return current.__novaflowPortTarget
        current = current.parentElement || current.parentNode || null
      }
      return null
    }

    function targetPortAtEvent(event) {
      let target = portTargetFromElement(event && event.target)
      const canHitTest = Boolean(documentRef && typeof documentRef.elementFromPoint === 'function')
      if (!target && canHitTest) {
        try {
          target = portTargetFromElement(documentRef.elementFromPoint(
            finite(event && event.clientX, 0),
            finite(event && event.clientY, 0),
          ))
        } catch {}
      }
      if (target) return target
      if (canHitTest) return null
      const clientX = finite(event && event.clientX, NaN)
      const clientY = finite(event && event.clientY, NaN)
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null
      let resolved = null
      portElements.forEach(function (element) {
        if (resolved || !element || !element.__novaflowPortTarget || element.__novaflowPortTarget.direction !== 'in') return
        const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null
        const left = finite(rect && rect.left, NaN)
        const top = finite(rect && rect.top, NaN)
        const width = finite(rect && rect.width, 0)
        const height = finite(rect && rect.height, 0)
        if (Number.isFinite(left) && Number.isFinite(top) && width > 0 && height > 0 &&
          clientX >= left - 8 && clientX <= left + width + 8 && clientY >= top - 8 && clientY <= top + height + 8) {
          resolved = element.__novaflowPortTarget
        }
      })
      return resolved
    }

    function updatePortHighlights() {
      const connecting = interaction && interaction.kind === 'connect-edge'
      portElements.forEach(function (button) {
        if (!button || !button.style || !button.__novaflowPortTarget) return
        const dot = button.__novaflowPortDot
        if (!dot || !dot.style) return
        const target = button.__novaflowPortTarget
        const isSource = Boolean(connecting && target.direction === 'out' &&
          interaction.source.nodeId === target.nodeId && interaction.source.port.id === target.port.id)
        let compatible = false
        let currentTarget = false
        if (connecting && target.direction === 'in') {
          const candidate = connectionFromTarget(target)
          compatible = Boolean(validatePortConnection(candidate).ok)
          currentTarget = Boolean(interaction.target && interaction.target.nodeId === target.nodeId && interaction.target.port.id === target.port.id)
        }
        dot.style.opacity = connecting && target.direction === 'in' && !compatible ? '0.35' : '1'
        dot.style.transform = currentTarget ? 'translate(-50%,-50%) scale(1.28)' : 'translate(-50%,-50%) scale(1)'
        dot.style.boxShadow = isSource
          ? '0 0 0 4px rgba(255,255,255,0.32)'
          : currentTarget
            ? '0 0 0 5px rgba(110,231,183,0.3)'
            : compatible
              ? '0 0 0 3px rgba(110,231,183,0.2)'
              : '0 0 0 1px rgba(255,255,255,0.22)'
        if (typeof button.setAttribute === 'function') {
          button.setAttribute('data-novaflow-ui-design-port-compatible', compatible ? 'true' : 'false')
          button.setAttribute('data-novaflow-ui-design-port-targeted', currentTarget ? 'true' : 'false')
        }
      })
    }

    function startPortConnection(event, node, port) {
      if (!active || !node || !port || port.direction !== 'out' || finite(event && event.button, 0) !== 0) return
      event && event.preventDefault && event.preventDefault()
      event && event.stopPropagation && event.stopPropagation()
      emitSelection({ kind: 'node', nodeId: node.id })
      focusViewport()
      interaction = {
        kind: 'connect-edge',
        pointerId: event && event.pointerId,
        nodeId: node.id,
        source: { nodeId: node.id, port: clone(port) },
        previewPoint: worldPoint(event),
        target: null,
      }
      captureInteractionPointer(event)
      renderEdges()
      updatePortHighlights()
    }

    function connectDraggedPorts(connection) {
      const validated = validatePortConnection(connection)
      if (!validated.ok) return validated
      let externalResult = null
      if (typeof options.onConnect === 'function') {
        try { externalResult = options.onConnect(clone(connection)) } catch (error) {
          externalResult = { ok: false, error: String(error && error.message || error) }
        }
      }
      if (externalResult && externalResult.ok === false) return externalResult
      if (externalResult && externalResult.graph) {
        commitGraph(externalResult.graph, { reason: 'connect-nodes' })
        return externalResult
      }
      const baseGraph = validated.replacement
        ? structure.normalizeGraph(Object.assign({}, graph, {
          edges: graph.edges.filter(function (edge) { return edge.id !== validated.replacement.id }),
        }))
        : graph
      const connected = structure.connectGraph(baseGraph, connection, generatorConnectionOptions(connection))
      if (!connected || connected.ok === false) return connected || { ok: false, error: '节点连接失败' }
      commitGraph(connected.graph, {
        reason: validated.replacement ? 'replace-iteration-edge' : 'connect-nodes',
        replacedEdgeId: validated.replacement && validated.replacement.id || '',
      })
      return connected
    }

    function renderPort(card, node, port) {
      if (port && port.hidden === true) return
      const accent = port.kind === 'layout' ? '#f59e0b' : port.kind === 'result' ? '#a78bfa' : port.kind === 'iteration' ? '#fb7185' : '#38bdf8'
      const button = createElement(documentRef, 'span', {
        role: 'button',
        tabindex: '-1',
        'aria-label': (port.direction === 'out' ? '输出：' : '输入：') + port.label,
        title: (port.direction === 'out' ? '输出：' : '输入：') + port.label,
        'data-novaflow-ui-design-port': node.id + ':' + port.id,
        'data-novaflow-ui-design-port-node': node.id,
        'data-novaflow-ui-design-port-id': port.id,
        'data-novaflow-ui-design-port-direction': port.direction,
        'data-novaflow-ui-design-port-kind': port.kind,
        style: {
          position: 'absolute',
          left: port.direction === 'in' ? '-12px' : 'auto',
          right: port.direction === 'out' ? '-12px' : 'auto',
          top: (port.y - 12) + 'px',
          width: '24px',
          height: '24px',
          padding: '0',
          border: '0',
          borderRadius: '50%',
          background: 'transparent',
          cursor: 'crosshair',
          boxSizing: 'border-box',
          overflow: 'visible',
          zIndex: '4',
        },
      })
      const dot = createElement(documentRef, 'span', {
        'data-novaflow-ui-design-port-dot': node.id + ':' + port.id,
        style: {
          position: 'absolute',
          display: 'block',
          left: '50%',
          top: '50%',
          width: '12px',
          height: '12px',
          border: '2px solid #232323',
          borderRadius: '50%',
          background: accent,
          boxSizing: 'border-box',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.22)',
          transform: 'translate(-50%,-50%) scale(1)',
          transformOrigin: 'center',
          transition: 'transform 100ms ease, box-shadow 100ms ease, opacity 100ms ease',
          pointerEvents: 'none',
        },
      })
      button.appendChild(dot)
      button.__novaflowPortTarget = { nodeId: node.id, direction: port.direction, port: clone(port) }
      button.__novaflowPortDot = dot
      if (port.direction === 'out') {
        button.addEventListener('pointerdown', function (event) { startPortConnection(event, node, port) })
      }
      button.addEventListener('click', function (event) {
        event && event.preventDefault && event.preventDefault()
        event && event.stopPropagation && event.stopPropagation()
      })
      card.appendChild(button)
      portElements.set(portElementKey(node.id, port.direction, port.id), button)
      const label = createElement(documentRef, 'span', {
        text: port.label,
        style: {
          position: 'absolute',
          left: port.direction === 'in' ? '11px' : 'auto',
          right: port.direction === 'out' ? '11px' : 'auto',
          top: (port.y - 6) + 'px',
          color: 'rgba(230,230,230,0.58)',
          fontSize: '11px',
          lineHeight: '12px',
          pointerEvents: 'none',
        },
      })
      card.appendChild(label)
    }

    function cardHeader(node) {
      const accent = NODE_ACCENTS[node.type] || '#A0A0A0'
      const header = createElement(documentRef, 'header', {
        'data-novaflow-ui-design-node-drag-handle': node.id,
        style: {
          minHeight: CARD_HEADER_HEIGHT + 'px',
          height: CARD_HEADER_HEIGHT + 'px',
          flex: '0 0 ' + CARD_HEADER_HEIGHT + 'px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '0 12px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '10px 10px 0 0',
          background: 'linear-gradient(90deg,' + accent + '24,rgba(255,255,255,0.015))',
          cursor: 'move',
          boxSizing: 'border-box',
        },
      }, [
        createElement(documentRef, 'span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: accent, flex: '0 0 auto' } }),
        createElement(documentRef, 'span', {
          text: node.title,
          style: { minWidth: '0', flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', fontWeight: '850' },
        }),
      ])
      header.addEventListener('pointerdown', function (event) { startNodeMove(event, node) })
      return header
    }

    function portRail(node) {
      const rail = createElement(documentRef, 'div', {
        'data-novaflow-ui-design-port-rail': node.id,
        style: {
          position: 'relative',
          flex: '0 0 ' + portRailHeight(node) + 'px',
          height: portRailHeight(node) + 'px',
          borderBottom: '1px solid rgba(255,255,255,0.055)',
          background: 'rgba(5,8,10,0.12)',
          pointerEvents: 'none',
          boxSizing: 'border-box',
        },
      })
      if (node && node.type === 'generator') {
        const incoming = graph.edges.filter(function (edge) { return edge.toNodeId === node.id })
        const layoutReady = incoming.some(function (edge) {
          if (edge.kind !== 'layout') return false
          return graph.nodes.some(function (item) { return item.id === edge.fromNodeId && item.type === 'layout' })
        })
        const iteration = incoming.find(function (edge) { return edge.kind === 'iteration' }) || null
        const referenceCount = incoming.filter(function (edge) { return edge.kind === 'reference' }).length
        const externalReferenceCount = referenceCount + (iteration ? 1 : 0)
        const referenceLimit = generatorExternalReferenceLimit(node)
        const referenceOverLimit = externalReferenceCount > referenceLimit
        const sourceNode = iteration && graph.nodes.find(function (item) { return item.id === iteration.fromNodeId })
        const sourceResult = sourceNode && sourceNode.type === 'result'
          ? resultById(options, sourceNode.data && sourceNode.data.resultId, resultFallback)
          : null
        const modificationName = String(sourceResult && sourceResult.name || sourceNode && sourceNode.title || '已设置')
        const summary = createElement(documentRef, 'div', {
          'data-novaflow-ui-design-generator-connection-summary': node.id,
          'data-novaflow-ui-design-reference-count': externalReferenceCount,
          'data-novaflow-ui-design-reference-limit': referenceLimit,
          'data-novaflow-ui-design-reference-over-limit': referenceOverLimit ? 'true' : 'false',
          text: (layoutReady ? '结构已连接' : '等待页面结构') + ' · 外部参考 ' + externalReferenceCount + '/' + referenceLimit,
          style: {
            position: 'absolute', left: '12px', right: iteration ? '150px' : '12px', bottom: '6px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: referenceOverLimit ? '#f87171' : (layoutReady ? '#6ee7b7' : '#fbbf24'), fontSize: '9px', fontWeight: '750',
          },
        })
        rail.appendChild(summary)
        if (iteration) {
          const chip = createElement(documentRef, 'div', {
            'data-novaflow-ui-design-modification-base': node.id,
            title: '修改底图：' + modificationName,
            style: {
              position: 'absolute', right: '10px', bottom: '4px', maxWidth: '136px', height: '22px',
              display: 'flex', alignItems: 'center', gap: '4px', padding: '0 3px 0 7px',
              borderRadius: '999px', border: '1px solid rgba(251,113,133,0.34)',
              background: 'rgba(251,113,133,0.11)', color: '#fda4af', boxSizing: 'border-box',
              pointerEvents: 'auto',
            },
          })
          chip.appendChild(createElement(documentRef, 'span', {
            text: '修改底图 ' + modificationName,
            style: { minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '8px', fontWeight: '600' },
          }))
          const clear = createElement(documentRef, 'button', {
            type: 'button',
            text: '×',
            title: '取消修改底图',
            'aria-label': '取消修改底图',
            'data-novaflow-ui-design-modification-base-clear': node.id,
            style: {
              width: '16px', height: '16px', flex: '0 0 16px', padding: '0', border: '0',
              borderRadius: '50%', background: 'rgba(255,255,255,0.08)', color: '#fecdd3',
              cursor: 'pointer', lineHeight: '15px', fontSize: '12px',
            },
          })
          clear.addEventListener('pointerdown', function (event) {
            event && event.stopPropagation && event.stopPropagation()
          })
          clear.addEventListener('click', function (event) {
            event && event.preventDefault && event.preventDefault()
            event && event.stopPropagation && event.stopPropagation()
            removeEdge(iteration.id)
          })
          chip.appendChild(clear)
          rail.appendChild(chip)
        }
      }
      return rail
    }

    function referenceBody(node) {
      const resource = resourceById(options, node.data && node.data.resourceId)
      const src = imageUrl(resource)
      const role = String(node.data && node.data.role || 'reference')
      const body = createElement(documentRef, 'div', {
        style: { minHeight: '0', flex: '1', display: 'grid', gridTemplateRows: 'minmax(0,1fr) 26px', padding: '9px', gap: '6px' },
      })
      if (src) {
        body.appendChild(createElement(documentRef, 'img', {
          src: src,
          alt: resource && resource.name || '参考图',
          draggable: false,
          style: { width: '100%', height: '100%', minHeight: '0', objectFit: 'contain', borderRadius: '7px', background: '#131313' },
        }))
      } else {
        body.appendChild(createElement(documentRef, 'div', {
          text: '资源不可用',
          style: { display: 'grid', placeItems: 'center', borderRadius: '7px', background: '#171717', color: 'rgba(255,255,255,0.38)', fontSize: '11px' },
        }))
      }
      const actionRow = createElement(documentRef, 'div', {
        style: { minWidth: '0', display: 'flex', alignItems: 'center' },
      })
      actionRow.appendChild(createElement(documentRef, 'div', {
        text: REFERENCE_ROLES[role] || REFERENCE_ROLES.reference,
        style: { minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#7dd3fc', fontSize: '11px', fontWeight: '600' },
      }))
      body.appendChild(actionRow)
      return body
    }

    function layoutBody(node) {
      const coordinateCanvas = layoutCoordinateCanvas(node)
      const targetCanvas = layoutDisplayCanvas(node)
      const previewSize = layoutPreviewSize(node, project, targetCanvas)
      const body = createElement(documentRef, 'div', {
        style: {
          position: 'relative',
          minHeight: '0',
          flex: '1',
          display: 'grid',
          placeItems: 'center',
          padding: '9px 11px',
          overflow: 'hidden',
          boxSizing: 'border-box',
        },
      })
      const preview = createElement(documentRef, 'div', {
        'data-novaflow-ui-design-layout-preview': node.id,
        style: {
          position: 'relative',
          width: previewSize.width + 'px',
          height: previewSize.height + 'px',
          maxWidth: '100%',
          maxHeight: '100%',
          aspectRatio: targetCanvas.width + ' / ' + targetCanvas.height,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.13)',
          borderRadius: '7px',
          background: '#191919',
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.026) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.026) 1px,transparent 1px)',
          backgroundSize: '14px 14px',
          cursor: activeTool === 'region' ? 'crosshair' : 'default',
        },
      })
      layoutPreviewElements.set(node.id, preview)
      const blocks = Array.isArray(node.data && node.data.blocks) ? node.data.blocks : []
      blocks.slice().sort(function (a, b) { return finite(a.zIndex, 0) - finite(b.zIndex, 0) }).forEach(function (block, index) {
        const selected = selection && selection.kind === 'block' && selection.nodeId === node.id && selection.blockId === block.id
        const color = blockColor(block, index)
        const bounds = layoutBlockBounds(node, block)
        const element = createElement(documentRef, 'div', {
          'data-novaflow-ui-design-block': block.id,
          'data-novaflow-ui-design-block-node': node.id,
          title: block.name,
          style: {
            position: 'absolute',
            left: clamp(bounds.x / coordinateCanvas.width * 100, 0, 100) + '%',
            top: clamp(bounds.y / coordinateCanvas.height * 100, 0, 100) + '%',
            width: clamp(bounds.width / coordinateCanvas.width * 100, 0.2, 100) + '%',
            height: clamp(bounds.height / coordinateCanvas.height * 100, 0.2, 100) + '%',
            minWidth: '6px',
            minHeight: '6px',
            padding: '5px 6px',
            border: selected ? '2px solid #fff' : '1.5px solid ' + color,
            borderRadius: '4px',
            background: color + (block.participates === false ? '12' : '28'),
            color: '#f8fafc',
            opacity: block.participates === false ? '0.46' : '1',
            overflow: 'hidden',
            boxSizing: 'border-box',
            cursor: block.locked ? 'not-allowed' : 'move',
            fontSize: '8px',
            lineHeight: '1.2',
            fontWeight: '600',
          },
        }, [createElement(documentRef, 'span', { text: block.name })])
        element.__novaflowBaseBorder = '1.5px solid ' + color
        element.addEventListener('pointerdown', function (event) { startBlockMove(event, node, block, preview) })
        if (!block.locked) {
          const resize = createElement(documentRef, 'button', {
            type: 'button',
            'data-novaflow-ui-design-resize-handle': block.id,
            style: {
              position: 'absolute',
              right: '-1px',
              bottom: '-1px',
              width: '11px',
              height: '11px',
              padding: '0',
              border: '2px solid #fff',
              borderRadius: '3px 0 3px 0',
              background: '#22c58b',
              cursor: 'nwse-resize',
              opacity: selected ? '1' : '0',
              pointerEvents: selected ? 'auto' : 'none',
            },
          })
          resize.addEventListener('pointerdown', function (event) { startBlockResize(event, node, block, preview) })
          element.appendChild(resize)
          element.__novaflowResizeHandle = resize
        }
        preview.appendChild(element)
        blockElements.set(node.id + ':' + block.id, element)
      })
      if (interaction && interaction.kind === 'create-block' && interaction.nodeId === node.id && interaction.preview) {
        const draft = interaction.preview
        preview.appendChild(createElement(documentRef, 'div', {
          'data-novaflow-ui-design-draft': '1',
          style: {
            position: 'absolute',
            left: clamp(draft.x / coordinateCanvas.width * 100, 0, 100) + '%',
            top: clamp(draft.y / coordinateCanvas.height * 100, 0, 100) + '%',
            width: clamp(draft.width / coordinateCanvas.width * 100, 0, 100) + '%',
            height: clamp(draft.height / coordinateCanvas.height * 100, 0, 100) + '%',
            border: '2px dashed #22c58b',
            background: 'rgba(34,197,139,0.16)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          },
        }))
      }
      preview.addEventListener('pointerdown', function (event) {
        if (event && event.target !== preview) return
        startBlockCreate(event, node, preview)
      })
      body.appendChild(preview)
      body.appendChild(createElement(documentRef, 'span', {
        'data-novaflow-ui-design-layout-output': node.id,
        'data-novaflow-ui-design-layout-size': node.id,
        text: '结构 ' + targetCanvas.width + ' × ' + targetCanvas.height,
        title: '页面结构的当前输出投影尺寸',
        style: {
          position: 'absolute',
          right: '12px',
          top: '8px',
          zIndex: '3',
          padding: '3px 6px',
          borderRadius: '5px',
          background: 'rgba(8,11,14,0.82)',
          color: 'rgba(230,230,230,0.72)',
          fontSize: '9px',
          lineHeight: '12px',
          pointerEvents: 'none',
        },
      }))
      return body
    }

    // The card = header + port rail + the controls' own height. Layout heights ignore the canvas zoom.
    function fitGeneratorCard(nodeId, body, host) {
      const fit = function () {
        const card = body.parentElement
        if (!card || !host.isConnected) return
        const content = Math.ceil(finite(host.scrollHeight, 0))
        if (content < 120) return
        const height = Math.ceil(finite(card.offsetHeight, 0) - finite(body.offsetHeight, 0)) + content
        if (Math.abs(height - finite(generatorFitHeights.get(nodeId), 0)) < 2 && Math.abs(height - finite(card.offsetHeight, 0)) < 2) return
        generatorFitHeights.set(nodeId, height)
        card.style.height = height + 'px'
      }
      const view = documentRef.defaultView || root
      // One observer per generator: a re-render replaces the controls, so the old observer goes.
      generatorFitObservers.get(nodeId)?.disconnect()
      if (view && typeof view.ResizeObserver === 'function') {
        const observer = new view.ResizeObserver(fit)
        observer.observe(host)
        generatorFitObservers.set(nodeId, observer)
      }
      if (view && typeof view.requestAnimationFrame === 'function') view.requestAnimationFrame(fit)
    }
    const generatorFitObservers = new Map()

    function generatorBody(node) {
      const body = createElement(documentRef, 'div', {
        'data-novaflow-ui-design-generator-body': node.id,
        style: {
          minHeight: '0', flex: '1', display: 'grid', alignContent: 'start',
          overflow: 'hidden', borderRadius: '0 0 10px 10px',
        },
      })
      const host = createElement(documentRef, 'div', {
        'data-novaflow-ui-design-generator-controls': node.id,
        style: { width: '100%', minWidth: '0', minHeight: '0' },
      })
      body.appendChild(host)
      fitGeneratorCard(node.id, body, host)
      const tool = root && root.NovaFlowUiDesignGenerateTool
      const status = generatorStatuses.get(node.id) || { message: '', error: false, running: false }
      const settings = generatorSettings(node)
      const output = generatorOutput(node)
      if (tool && typeof tool.mount === 'function') {
        const state = Object.assign({}, settings, output, {
          mode: 'img2img',
          running: status.running === true,
        })
        const handle = tool.mount({
          host: host,
          variant: 'node',
          state: state,
          expanded: Boolean(node.data && node.data.settingsExpanded),
          getCanvasSize: function () { return generatorOutput(generatorNode(node.id) || node) },
          onChange: function (change) {
            patchGeneratorSettings(node.id, change && change.snapshot || change && change.state || {})
          },
          onOutputSizeChange: function (size) {
            patchGeneratorOutput(node.id, size)
          },
          onExpandedChange: function (expanded) {
            setGeneratorExpanded(node.id, expanded)
          },
          mountPromptMentions: function (textarea, details) {
            if (typeof options.mountPromptMentions !== 'function') return null
            return options.mountPromptMentions(textarea, Object.assign({}, details, {
              generatorNodeId: node.id,
            }))
          },
          onOpenDesignAssistant: function (payload) {
            if (typeof options.onOpenDesignAssistant !== 'function') return false
            return options.onOpenDesignAssistant(Object.assign({}, payload, {
              generatorNodeId: node.id,
            }))
          },
          onStop: function () {
            return typeof options.onStopGenerateRequest === 'function' ? options.onStopGenerateRequest({ generatorNodeId: node.id }) : false
          },
          onGenerate: function (payload) {
            const flushed = patchGeneratorSettings(node.id, payload && payload.snapshot || {})
            if (!flushed || flushed.ok === false) return false
            return requestGenerate(node.id)
          },
        })
        generatorToolHandles.set(node.id, handle)
        if (status.message && handle && typeof handle.setStatus === 'function') {
          handle.setStatus(status.message, { error: status.error, running: status.running })
        }
      } else {
        const fallback = createElement(documentRef, 'button', {
          type: 'button',
          text: '生成 UI',
          'data-novaflow-ui-design-node-generate-action': '1',
          style: {
            margin: '14px 12px', height: '36px', border: '0', borderRadius: '7px',
            background: '#1ea672', color: '#fff', fontSize: '11px', fontWeight: '600', cursor: 'pointer',
          },
        })
        fallback.addEventListener('click', function (event) {
          event && event.preventDefault && event.preventDefault()
          event && event.stopPropagation && event.stopPropagation()
          requestGenerate(node.id)
        })
        host.appendChild(fallback)
      }
      return body
    }

    function resultBody(node) {
      const result = resultById(options, node.data && node.data.resultId, resultFallback)
      const src = imageUrl(result)
      const resultName = String(result && (result.name || result.fileName) || '生成结果')
      const body = createElement(documentRef, 'div', {
        style: { minHeight: '0', flex: '1', display: 'grid', gridTemplateRows: 'minmax(0,1fr) 31px', padding: '9px', gap: '7px' },
      })
      if (src) {
        const preview = createElement(documentRef, 'img', {
          src: src,
          alt: resultName,
          draggable: false,
          role: 'button',
          tabindex: '0',
          'aria-label': '放大查看 ' + resultName,
          'aria-haspopup': 'dialog',
          title: '点击放大查看',
          'data-novaflow-ui-design-result-preview': node.id,
          style: { width: '100%', height: '100%', minHeight: '0', objectFit: 'contain', borderRadius: '7px', background: '#131313', cursor: 'zoom-in' },
        })
        function openPreview(event) {
          event && event.preventDefault && event.preventDefault()
          event && event.stopPropagation && event.stopPropagation()
          const dialog = root && root.NovaFlowUiDesignImagePreviewDialog
          if (!dialog || typeof dialog.open !== 'function') return
          try {
            let openedPreview = null
            const opened = dialog.open({
              src: src,
              name: resultName,
              documentRef: documentRef,
              onClose: function () {
                if (resultImagePreviewCloser === openedPreview) resultImagePreviewCloser = null
              },
            })
            openedPreview = opened && typeof opened.close === 'function'
              ? opened
              : (typeof dialog.close === 'function' ? dialog : null)
            resultImagePreviewCloser = openedPreview
          } catch {}
        }
        preview.addEventListener('pointerdown', function (event) {
          if (finite(event && event.button, 0) !== 0) return
          event && event.stopPropagation && event.stopPropagation()
        })
        preview.addEventListener('click', openPreview)
        preview.addEventListener('keydown', function (event) {
          if (!event || (event.key !== 'Enter' && event.key !== ' ')) return
          openPreview(event)
        })
        body.appendChild(preview)
      } else {
        body.appendChild(createElement(documentRef, 'div', {
          text: '结果资源不可用',
          style: { display: 'grid', placeItems: 'center', borderRadius: '7px', background: '#171717', color: 'rgba(255,255,255,0.38)', fontSize: '11px' },
        }))
      }
      const actions = createElement(documentRef, 'div', { style: { display: 'flex', gap: '6px' } })
      const iterate = createElement(documentRef, 'button', {
        type: 'button',
        text: '设为修改底图',
        title: '把这张结果作为下一次生成的修改底图，不会立即生成',
        'data-novaflow-ui-design-result-iterate': node.id,
        style: { width: '100%', border: '0', borderRadius: '6px', background: '#323232', color: '#ddd6fe', fontSize: '9px', cursor: 'pointer' },
      })
      iterate.addEventListener('click', function (event) {
        event && event.stopPropagation && event.stopPropagation()
        if (typeof options.onUseResultAsReference === 'function' && result) options.onUseResultAsReference(result, node)
      })
      actions.appendChild(iterate)
      body.appendChild(actions)
      return body
    }

    function renderNode(node) {
      const selected = selection && selection.nodeId === node.id
      const card = createElement(documentRef, 'article', {
        'data-novaflow-ui-design-node': node.id,
        'data-novaflow-ui-design-node-type': node.type,
        tabindex: '0',
        role: 'group',
        'aria-label': node.title,
        style: nodeCardBase(node, selected),
      })
      card.addEventListener('pointerdown', function (event) {
        if (finite(event && event.button, 0) !== 0) return
        emitSelection({ kind: 'node', nodeId: node.id })
        // A press on the generator's own controls leaves the focus where it is: taking it to the canvas
        // would save and rebuild 设计要求 under the pointer, and that first click would be lost.
        const target = event && event.target
        if (target && typeof target.closest === 'function' && target.closest('[data-novaflow-ui-design-generator-controls]')) return
        focusViewport()
      })
      card.addEventListener('keydown', function (event) {
        if (event && (event.key === 'Enter' || event.key === ' ')) emitSelection({ kind: 'node', nodeId: node.id })
      })
      card.appendChild(cardHeader(node))
      card.appendChild(portRail(node))
      if (node.type === 'reference') card.appendChild(referenceBody(node))
      else if (node.type === 'layout') card.appendChild(layoutBody(node))
      else if (node.type === 'generator') card.appendChild(generatorBody(node))
      else card.appendChild(resultBody(node))
      portDefinitions(node).forEach(function (port) { renderPort(card, node, port) })
      if (node.type === 'layout') {
        const resize = createElement(documentRef, 'button', {
          type: 'button',
          title: '调整页面结构节点大小',
          'aria-label': '调整页面结构节点大小',
          'data-novaflow-ui-design-node-resize': node.id,
          style: {
            position: 'absolute',
            right: '-5px',
            bottom: '-5px',
            width: '18px',
            height: '18px',
            padding: '0',
            border: '2px solid #fbbf24',
            borderRadius: '5px',
            background: '#232323',
            cursor: 'nwse-resize',
            boxShadow: '0 0 0 2px rgba(0,0,0,0.34)',
            zIndex: '7',
          },
        })
        resize.addEventListener('pointerdown', function (event) { startNodeResize(event, node) })
        card.appendChild(resize)
      }
      nodeElements.set(node.id, card)
      return card
    }

    function renderEdges() {
      while (edgesRoot.firstChild) edgesRoot.removeChild(edgesRoot.firstChild)
      if (Array.isArray(edgesRoot.children) && typeof edgesRoot.replaceChildren === 'function') edgesRoot.replaceChildren()
      graph.edges.forEach(function (edge) {
        const fromNode = edge && graph.nodes.find(function (node) { return node.id === edge.fromNodeId })
        if (edge && edge.kind === 'iteration') return
        const toNode = graph.nodes.find(function (node) { return node.id === edge.toNodeId })
        if (!fromNode || !toNode) return
        const from = portAnchor(effectiveNode(fromNode), edge.fromPort, 'out')
        const to = portAnchor(effectiveNode(toNode), edge.toPort, 'in')
        const color = edge.kind === 'layout' ? '#f59e0b' : edge.kind === 'result' ? '#a78bfa' : edge.kind === 'iteration' ? '#fb7185' : '#38bdf8'
        const selected = Boolean(selection && selection.kind === 'edge' && selection.edgeId === edge.id)
        const shadow = createSvgElement(documentRef, 'path', {
          d: edgePath(from, to),
          fill: 'none',
          stroke: 'rgba(0,0,0,0.52)',
          'stroke-width': selected ? '9' : '7',
          'stroke-linecap': 'round',
        })
        const path = createSvgElement(documentRef, 'path', {
          d: edgePath(from, to),
          fill: 'none',
          stroke: color,
          'stroke-width': selected ? '4' : '2.5',
          'stroke-linecap': 'round',
          opacity: selected ? '1' : '0.9',
          'data-novaflow-ui-design-edge': edge.id,
        })
        path.__novaflowEdgeId = edge.id
        path.__novaflowEdgeVisible = true
        const hit = createSvgElement(documentRef, 'path', {
          d: edgePath(from, to),
          fill: 'none',
          stroke: 'rgba(0,0,0,0.001)',
          'stroke-width': '16',
          'stroke-linecap': 'round',
          'pointer-events': 'stroke',
          cursor: 'pointer',
          'data-novaflow-ui-design-edge-hit': edge.id,
        })
        hit.addEventListener('pointerdown', function (event) {
          if (finite(event && event.button, 0) !== 0) return
          event && event.preventDefault && event.preventDefault()
          event && event.stopPropagation && event.stopPropagation()
          emitSelection({ kind: 'edge', edgeId: edge.id })
          focusViewport()
        })
        const midpoint = {
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2,
        }
        const cut = createSvgElement(documentRef, 'g', {
          transform: 'translate(' + midpoint.x + ' ' + midpoint.y + ')',
          opacity: selected ? '1' : '0',
          'pointer-events': selected ? 'all' : 'none',
          cursor: 'pointer',
          title: '剪断连接',
          'data-novaflow-ui-design-edge-cut': edge.id,
        })
        cut.__novaflowEdgeId = edge.id
        cut.__novaflowEdgeCut = true
        cut.__novaflowEdgeHovered = false
        cut.appendChild(createSvgElement(documentRef, 'circle', {
          cx: '0',
          cy: '0',
          r: '9',
          fill: '#232323',
          stroke: color,
          'stroke-width': '1.5',
        }))
        cut.appendChild(createSvgElement(documentRef, 'path', {
          d: 'M -3 -3 L 3 3 M 3 -3 L -3 3',
          fill: 'none',
          stroke: '#f8fafc',
          'stroke-width': '1.5',
          'stroke-linecap': 'round',
          'pointer-events': 'none',
        }))
        function refreshCutVisibility(hovered) {
          cut.__novaflowEdgeHovered = hovered === true
          const currentSelected = Boolean(selection && selection.kind === 'edge' && selection.edgeId === edge.id)
          const visible = currentSelected || cut.__novaflowEdgeHovered
          cut.setAttribute('opacity', visible ? '1' : '0')
          cut.setAttribute('pointer-events', visible ? 'all' : 'none')
        }
        hit.addEventListener('pointerenter', function () { refreshCutVisibility(true) })
        hit.addEventListener('pointerleave', function (event) {
          const related = event && event.relatedTarget
          if (related === cut || (cut.contains && cut.contains(related))) return
          refreshCutVisibility(false)
        })
        cut.addEventListener('pointerenter', function () { refreshCutVisibility(true) })
        cut.addEventListener('pointerleave', function (event) {
          if (event && event.relatedTarget === hit) return
          refreshCutVisibility(false)
        })
        cut.addEventListener('pointerdown', function (event) {
          if (finite(event && event.button, 0) !== 0) return
          event && event.preventDefault && event.preventDefault()
          event && event.stopPropagation && event.stopPropagation()
          focusViewport()
        })
        cut.addEventListener('click', function (event) {
          event && event.preventDefault && event.preventDefault()
          event && event.stopPropagation && event.stopPropagation()
          const result = removeEdge(edge.id)
          if (result && result.ok) {
            if (selection && selection.kind === 'edge' && selection.edgeId === edge.id) emitSelection(null)
            showStatus('连接已断开', false)
          }
        })
        edgesRoot.appendChild(shadow)
        edgesRoot.appendChild(path)
        edgesRoot.appendChild(hit)
        edgesRoot.appendChild(cut)
      })
      if (interaction && interaction.kind === 'connect-edge' && interaction.previewPoint) {
        const sourceNode = graph.nodes.find(function (node) { return node.id === interaction.source.nodeId })
        if (sourceNode) {
          const from = portAnchor(effectiveNode(sourceNode), interaction.source.port.id, 'out')
          const targetNode = interaction.target && graph.nodes.find(function (node) { return node.id === interaction.target.nodeId })
          const to = targetNode
            ? portAnchor(effectiveNode(targetNode), interaction.target.port.id, 'in')
            : interaction.previewPoint
          if (to) {
            edgesRoot.appendChild(createSvgElement(documentRef, 'path', {
              d: edgePath(from, to),
              fill: 'none',
              stroke: '#6ee7b7',
              'stroke-width': '2.5',
              'stroke-dasharray': '7 5',
              'stroke-linecap': 'round',
              'pointer-events': 'none',
              'data-novaflow-ui-design-pending-edge': '1',
            }))
          }
        }
      }
    }

    function renderNodes() {
      destroyGeneratorTools()
      nodesRoot.replaceChildren()
      nodeElements.clear()
      blockElements.clear()
      portElements.clear()
      layoutPreviewElements.clear()
      graph.nodes.forEach(function (node) { nodesRoot.appendChild(renderNode(node)) })
      emptyState.style.display = graph.nodes.length ? 'none' : 'grid'
      updatePortHighlights()
    }

    function renderEmptyActions() {
      function action(label, value, primary) {
        const button = createElement(documentRef, 'button', {
          type: 'button',
          text: label,
          'data-novaflow-ui-design-empty-action': value,
          style: {
            height: '38px',
            width: '96px',
            padding: '0 10px',
            border: primary ? '1px solid rgba(86,239,180,0.55)' : '1px solid rgba(255,255,255,0.12)',
            borderRadius: '8px',
            background: primary ? '#176b50' : '#282828',
            color: '#fff',
            fontSize: '11px',
            fontWeight: '850',
            cursor: 'pointer',
          },
        })
        button.addEventListener('click', function () {
          if (value === 'reference') openReferencePicker('starter')
          else createWorkflowStarter(value, centerWorldPoint())
        })
        return button
      }
      emptyActions.replaceChildren(
        action('从参考图开始', 'reference', true),
        action('从模板开始', 'template', false),
        action('空白布局', 'blank', false),
      )
    }

    function render() {
      if (!active) return
      renderRevision += 1
      renderEdges()
      renderNodes()
      renderToolbar()
      syncWorldTransform()
    }

    function startPan(event) {
      fitted = false
      beginInteractiveTransform()
      const point = localPoint(event)
      interaction = {
        kind: 'pan',
        pointerId: event && event.pointerId,
        start: point,
        original: { x: panX, y: panY },
      }
      viewport.style.cursor = 'grabbing'
      if (typeof viewport.setPointerCapture === 'function' && event && event.pointerId != null) {
        try { viewport.setPointerCapture(event.pointerId) } catch {}
      }
    }

    function releaseInteractionPointer(completed) {
      if (!completed || completed.pointerId == null || typeof viewport.releasePointerCapture !== 'function') return
      try {
        if (typeof viewport.hasPointerCapture !== 'function' || viewport.hasPointerCapture(completed.pointerId)) {
          viewport.releasePointerCapture(completed.pointerId)
        }
      } catch {}
    }

    function handlePointerDown(event) {
      if (!active || interaction) return
      const button = finite(event && event.button, 0)
      if (button === 2) {
        event && event.preventDefault && event.preventDefault()
        event && event.stopPropagation && event.stopPropagation()
        focusViewport()
        startPan(event)
        return
      }
      if (button !== 0) return
      if (event && (event.target === viewport || event.target === world || event.target === nodesRoot || event.target === edgesRoot)) {
        emitSelection(null)
        focusViewport()
      }
    }

    function handlePointerMove(event) {
      if (!active || !interaction) return
      if (interaction.pointerId != null && event && event.pointerId != null && interaction.pointerId !== event.pointerId) return
      if (interaction.kind === 'pan') {
        if (event && typeof event.buttons === 'number' && (event.buttons & 2) === 0) {
          finishInteraction(event, false)
          return
        }
        const point = localPoint(event)
        panX = interaction.original.x + point.x - interaction.start.x
        panY = interaction.original.y + point.y - interaction.start.y
        syncWorldTransform()
        return
      }
      if (interaction.kind === 'connect-edge') {
        interaction.previewPoint = worldPoint(event)
        const candidate = targetPortAtEvent(event)
        const connection = connectionFromTarget(candidate)
        interaction.target = connection && validatePortConnection(connection).ok ? candidate : null
        renderEdges()
        updatePortHighlights()
        return
      }
      if (interaction.kind === 'move-node') {
        const point = worldPoint(event)
        interaction.preview = {
          x: Math.round(interaction.original.x + point.x - interaction.start.x),
          y: Math.round(interaction.original.y + point.y - interaction.start.y),
        }
        const element = nodeElements.get(interaction.nodeId)
        if (element) {
          element.style.left = interaction.preview.x + 'px'
          element.style.top = interaction.preview.y + 'px'
        }
        renderEdges()
        return
      }
      if (interaction.kind === 'resize-node') {
        const point = worldPoint(event)
        const dx = point.x - interaction.start.x
        const dy = point.y - interaction.start.y
        interaction.preview = {
          width: Math.round(clamp(interaction.original.width + dx, MIN_LAYOUT_NODE_WIDTH, 2400)),
          height: Math.round(clamp(interaction.original.height + dy, MIN_LAYOUT_NODE_HEIGHT, 2400)),
        }
        const element = nodeElements.get(interaction.nodeId)
        if (element) {
          element.style.width = interaction.preview.width + 'px'
          element.style.height = interaction.preview.height + 'px'
        }
        const node = graph.nodes.find(function (item) { return item.id === interaction.nodeId })
        const preview = layoutPreviewElements.get(interaction.nodeId)
        if (node && preview) {
          const size = layoutPreviewSize(effectiveNode(node), project, layoutCoordinateCanvas(node))
          preview.style.width = size.width + 'px'
          preview.style.height = size.height + 'px'
        }
        renderEdges()
        return
      }
      const node = graph.nodes.find(function (item) { return item.id === interaction.nodeId })
      if (!node) return
      const canvas = interaction.canvas || layoutCoordinateCanvas(node)
      const point = outputPoint(event, node, interaction.previewElement, interaction.previewMetrics)
      if (interaction.kind === 'create-block') {
        interaction.preview = {
          x: Math.min(interaction.start.x, point.x),
          y: Math.min(interaction.start.y, point.y),
          width: Math.abs(point.x - interaction.start.x),
          height: Math.abs(point.y - interaction.start.y),
        }
        renderNodes()
        return
      }
      const dx = point.x - interaction.start.x
      const dy = point.y - interaction.start.y
      if (interaction.kind === 'move-block') {
        interaction.preview = Object.assign({}, interaction.original, {
          x: clamp(interaction.original.x + dx, 0, canvas.width - interaction.original.width),
          y: clamp(interaction.original.y + dy, 0, canvas.height - interaction.original.height),
        })
      } else if (interaction.kind === 'resize-block') {
        interaction.preview = Object.assign({}, interaction.original, {
          width: clamp(interaction.original.width + dx, structure.MIN_BLOCK_WIDTH || 32, canvas.width - interaction.original.x),
          height: clamp(interaction.original.height + dy, structure.MIN_BLOCK_HEIGHT || 24, canvas.height - interaction.original.y),
        })
      }
      const element = blockElements.get(interaction.nodeId + ':' + interaction.blockId)
      if (element && interaction.preview) {
        element.style.left = interaction.preview.x / canvas.width * 100 + '%'
        element.style.top = interaction.preview.y / canvas.height * 100 + '%'
        element.style.width = interaction.preview.width / canvas.width * 100 + '%'
        element.style.height = interaction.preview.height / canvas.height * 100 + '%'
      }
    }

    function finishInteraction(event, cancelled) {
      if (!interaction) return
      if (interaction.pointerId != null && event && event.pointerId != null && interaction.pointerId !== event.pointerId) return
      const completed = interaction
      if (completed.kind === 'connect-edge' && !cancelled) {
        completed.previewPoint = worldPoint(event)
        const candidate = targetPortAtEvent(event) || completed.target
        const connection = connectionFromTarget(candidate)
        completed.target = connection && validatePortConnection(connection).ok ? candidate : null
      }
      interaction = null
      releaseInteractionPointer(completed)
      if (completed.kind === 'pan') settleInteractiveTransform(true)
      viewport.style.cursor = activeTool === 'region' ? 'crosshair' : 'default'
      if (completed.kind === 'connect-edge') {
        updatePortHighlights()
        renderEdges()
        if (cancelled || !completed.target) return
        const connection = {
          fromNodeId: completed.source.nodeId,
          fromPort: completed.source.port.id,
          toNodeId: completed.target.nodeId,
          toPort: completed.target.port.id,
          kind: completed.target.port.kind,
        }
        const connected = connectDraggedPorts(connection)
        if (!connected || connected.ok === false) {
          showStatus(connected && connected.error || '节点连接失败', true)
          render()
          return
        }
        showStatus('节点已连接', false)
        return
      }
      if (cancelled) {
        render()
        return
      }
      if (completed.kind === 'move-node' && completed.preview) {
        patchNode(completed.nodeId, { position: completed.preview }, 'move-node')
        return
      }
      if (completed.kind === 'resize-node' && completed.preview) {
        patchNode(completed.nodeId, {
          width: completed.preview.width,
          height: completed.preview.height,
        }, 'resize-layout-node')
        return
      }
      const node = graph.nodes.find(function (item) { return item.id === completed.nodeId })
      if (!node || node.type !== 'layout') {
        render()
        return
      }
      const blocks = Array.isArray(node.data && node.data.blocks) ? node.data.blocks.slice() : []
      if (completed.kind === 'create-block' && completed.preview) {
        const rect = completed.preview
        if (rect.width >= (structure.MIN_BLOCK_WIDTH || 32) && rect.height >= (structure.MIN_BLOCK_HEIGHT || 24)) {
          const usedIds = new Set(blocks.map(function (block) { return String(block.id || '') }))
          let suffix = 1
          while (usedIds.has('block_' + suffix)) suffix += 1
          const maxZ = blocks.reduce(function (highest, block) { return Math.max(highest, finite(block.zIndex, 0)) }, 0)
          const created = blockWithCanvasGeometry(node, {
            id: 'block_' + suffix,
            kind: 'region',
            name: '矩形块 ' + (blocks.length + 1),
            purpose: '',
            requirements: '',
            zIndex: maxZ + 1,
            locked: false,
            participates: true,
          }, rect)
          const nextBlocks = blocks.concat([created])
          updateLayoutBlocks(node.id, nextBlocks, 'create-layout-block')
          emitSelection({ kind: 'block', nodeId: node.id, blockId: created && created.id })
          return
        }
      } else if ((completed.kind === 'move-block' || completed.kind === 'resize-block') && completed.preview) {
        const nextBlocks = blocks.map(function (block) {
          return block.id === completed.blockId
            ? blockWithCanvasGeometry(node, Object.assign({}, block, { id: block.id }), completed.preview)
            : block
        })
        updateLayoutBlocks(node.id, nextBlocks, completed.kind)
        return
      }
      render()
    }

    function handlePointerUp(event) {
      finishInteraction(event, false)
    }

    function handlePointerCancel(event) {
      finishInteraction(event, true)
    }

    function handleLostPointerCapture(event) {
      if (!active || !interaction) return
      if (interaction.pointerId != null && event && event.pointerId != null && interaction.pointerId !== event.pointerId) return
      finishInteraction(event, true)
    }

    function handleContextMenu(event) {
      event && event.preventDefault && event.preventDefault()
    }

    function handleWheel(event) {
      if (!active) return
      event && event.preventDefault && event.preventDefault()
      fitted = false
      beginInteractiveTransform()
      const direction = finite(event && event.deltaY, 0) < 0 ? 1.1 : 1 / 1.1
      zoomAround(zoom * direction, localPoint(event))
      settleInteractiveTransform(false)
    }

    function handleKeyDown(event) {
      if (!active || !event) return
      const target = event.target
      const tag = String(target && target.tagName || '').toLowerCase()
      const contentEditable = Boolean(target && (target.isContentEditable === true ||
        (typeof target.getAttribute === 'function' && String(target.getAttribute('contenteditable') || '').toLowerCase() === 'true') ||
        (typeof target.closest === 'function' && target.closest('[contenteditable="true"]'))))
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || contentEditable) return
      if (event.key === 'Escape') {
        if (interaction && interaction.kind === 'connect-edge') {
          event.preventDefault && event.preventDefault()
          finishInteraction(event, true)
          return
        }
        if (interaction && interaction.kind === 'create-block') {
          event.preventDefault && event.preventDefault()
          finishInteraction(event, true)
          setTool('select')
          return
        }
        if (activeTool === 'region') {
          event.preventDefault && event.preventDefault()
          setTool('select')
          return
        }
      }
      if ((event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 'z') {
        event.preventDefault && event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 'y') {
        event.preventDefault && event.preventDefault()
        redo()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault && event.preventDefault()
        removeSelection()
      }
    }

    function handleDragOver(event) {
      event && event.preventDefault && event.preventDefault()
      if (event && event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    function handleDrop(event) {
      event && event.preventDefault && event.preventDefault()
      const point = worldPoint(event)
      const transfer = event && event.dataTransfer
      let resourceId = ''
      try {
        resourceId = String(transfer && transfer.getData && (
          transfer.getData('application/x-novaflow-ui-resource') ||
          transfer.getData('text/novaflow-ui-resource')
        ) || '')
      } catch {}
      if (resourceId) {
        const resource = resourceById(options, resourceId)
        if (resource) addReferenceResource(resource, point, 'reference')
        return
      }
      const files = transfer && transfer.files
      if (files && files.length) void importFiles(files, point, 'plain')
    }

    function patchSelection(selectionOrPatch, maybePatch) {
      const hasSelectionSnapshot = arguments.length > 1
      const targetSelection = hasSelectionSnapshot ? selectionOrPatch : selection
      const patch = hasSelectionSnapshot ? maybePatch : selectionOrPatch
      const resolved = resolveSelection(targetSelection)
      if (!resolved) return false
      if (resolved.kind === 'node') {
        const nodePatch = {}
        if (Object.prototype.hasOwnProperty.call(patch || {}, 'title')) nodePatch.title = patch.title
        const dataPatch = Object.assign({}, patch && patch.data || {})
        Object.keys(patch || {}).forEach(function (key) {
          if (!['title', 'data', 'position', 'width', 'height'].includes(key)) dataPatch[key] = patch[key]
        })
        if (Object.keys(dataPatch).length) nodePatch.data = dataPatch
        const result = patchNode(resolved.node.id, nodePatch, 'patch-node-properties')
        return Boolean(result && result.ok)
      }
      if (resolved.kind === 'block') {
        const blocks = resolved.node.data.blocks.map(function (block) {
          return block.id === resolved.block.id ? Object.assign({}, block, patch || {}, { id: block.id }) : block
        })
        const result = updateLayoutBlocks(resolved.node.id, blocks, 'patch-block-properties')
        return Boolean(result && result.ok)
      }
      return false
    }

    function removeSelection() {
      const resolved = resolveSelection(selection)
      if (!resolved) return false
      if (resolved.kind === 'edge') {
        const result = removeEdge(resolved.edge.id)
        if (result && result.ok) emitSelection(null)
        return Boolean(result && result.ok)
      }
      if (resolved.kind === 'node') {
        const result = removeNode(resolved.node.id)
        if (result && result.ok) emitSelection(null)
        return Boolean(result && result.ok)
      }
      const blocks = resolved.node.data.blocks.filter(function (block) { return block.id !== resolved.block.id })
      const result = updateLayoutBlocks(resolved.node.id, blocks, 'remove-layout-block')
      if (result && result.ok) emitSelection({ kind: 'node', nodeId: resolved.node.id })
      return Boolean(result && result.ok)
    }

    fileInput.addEventListener('change', function () {
      const files = fileInput.files || []
      const mode = pendingImportMode
      pendingImportMode = 'plain'
      void importFiles(files, mode === 'starter' ? centerWorldPoint() : null, mode).finally(function () {
        try { fileInput.value = '' } catch {}
      })
    })
    autoFitButton.addEventListener('click', fitAll)
    autoFitButton.addEventListener('pointerenter', function () { autoFitButton.style.background = '#3b3b3b' })
    autoFitButton.addEventListener('pointerleave', function () { autoFitButton.style.background = '#2a2a2a' })
    viewport.addEventListener('pointerdown', handlePointerDown, true)
    viewport.addEventListener('pointermove', handlePointerMove)
    viewport.addEventListener('pointerup', handlePointerUp)
    viewport.addEventListener('pointercancel', handlePointerCancel)
    viewport.addEventListener('lostpointercapture', handleLostPointerCapture)
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    viewport.addEventListener('contextmenu', handleContextMenu)
    viewport.addEventListener('keydown', handleKeyDown)
    viewport.addEventListener('dragover', handleDragOver)
    viewport.addEventListener('drop', handleDrop)

    renderEmptyActions()
    render()
    if (!supplied && typeof options.onProjectChange === 'function') {
      options.onProjectChange(project, { reason: 'initialize' })
    }
    // Fit now when the viewport is already laid out: the bridge mounts from an
    // animation frame, so a frame requested here came a frame late and 绘图 -> UI
    // painted the nodes unfitted (small, top-left) before they jumped into place.
    const mountedRect = viewport.isConnected && typeof viewport.getBoundingClientRect === 'function'
      ? viewport.getBoundingClientRect()
      : null
    if (mountedRect && mountedRect.width > 0 && mountedRect.height > 0) {
      fitAll()
    } else if (windowRef && typeof windowRef.requestAnimationFrame === 'function') {
      fitFrame = windowRef.requestAnimationFrame(function () {
        fitFrame = 0
        if (active) fitAll()
      })
    } else {
      fitAll()
    }

    return Object.freeze({
      update(nextProject) {
        if (!active) return false
        const external = nextProject && typeof nextProject === 'object'
          ? nextProject
          : (typeof options.getProject === 'function' ? options.getProject() : null)
        if (external && typeof external === 'object') {
          project = normalizeProject(external)
          graph = graphOf(project)
        }
        if (!resolveSelection(selection)) emitSelection(null)
        render()
        return true
      },
      destroy() {
        if (!active) return
        active = false
        const previewCloser = resultImagePreviewCloser
        resultImagePreviewCloser = null
        if (previewCloser && typeof previewCloser.close === 'function') {
          try { previewCloser.close() } catch {}
        }
        destroyGeneratorTools()
        const abandonedInteraction = interaction
        interaction = null
        releaseInteractionPointer(abandonedInteraction)
        if (fitFrame && windowRef && typeof windowRef.cancelAnimationFrame === 'function') windowRef.cancelAnimationFrame(fitFrame)
        if (statusTimer && root && typeof root.clearTimeout === 'function') root.clearTimeout(statusTimer)
        clearTransformSettleTimer()
        viewport.removeEventListener('pointerdown', handlePointerDown, true)
        viewport.removeEventListener('pointermove', handlePointerMove)
        viewport.removeEventListener('pointerup', handlePointerUp)
        viewport.removeEventListener('pointercancel', handlePointerCancel)
        viewport.removeEventListener('lostpointercapture', handleLostPointerCapture)
        viewport.removeEventListener('wheel', handleWheel)
        viewport.removeEventListener('contextmenu', handleContextMenu)
        viewport.removeEventListener('keydown', handleKeyDown)
        viewport.removeEventListener('dragover', handleDragOver)
        viewport.removeEventListener('drop', handleDrop)
        if (shell.parentElement === host) shell.remove()
      },
      getSkeletonDataUrl() {
        return cleanLayoutGuide(project).dataUrl
      },
      getLayoutGuide() {
        return cleanLayoutGuide(project)
      },
      getProject() {
        return clone(project)
      },
      getGraph() {
        return clone(graph)
      },
      getSelection() {
        return resolveSelection(selection)
      },
      getGeneratorSettings: generatorProfile,
      patchGeneratorSettings,
      patchGeneratorOutput,
      setGeneratorStatus,
      focusGenerator,
      patchSelection,
      removeSelection,
      setTool,
      getTool() {
        return active ? activeTool : ''
      },
      fit: fitAll,
      refitIfFitted() {
        return active && fitted === true ? fitAll() : false
      },
      undo,
      redo,
      addReferenceResource,
      addResultNode,
      createWorkflowStarter,
      setResults(nextResults) {
        resultFallback = (Array.isArray(nextResults) ? nextResults : []).slice()
        renderNodes()
        return resultFallback.length
      },
      showStatus,
    })
  }

  return Object.freeze({
    mount: mount,
    createDefaultProject: defaultProject,
    getSkeletonDataUrl: function (project) { return cleanLayoutGuide(normalizeProject(project)).dataUrl },
    getSkeletonSvgDataUrl: function (project) { return fallbackCleanGuide(normalizeProject(project)) },
    getCleanLayoutGuide: function (project) { return cleanLayoutGuide(normalizeProject(project)) },
  })
})
