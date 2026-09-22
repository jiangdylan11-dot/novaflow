(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignProjectResource = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const SERIAL_VERSION = 1
  const GRAPH_SCHEMA_VERSION = 3
  const MAX_REFERENCES = 2
  const MAX_GENERATOR_GRAPH_REFERENCES = 15
  const MIN_OUTPUT_SIZE = 320
  const MAX_OUTPUT_SIZE = 8192
  const DEFAULT_OUTPUT_WIDTH = 1920
  const DEFAULT_OUTPUT_HEIGHT = 1080
  const GRAPH_NODE_TYPES = Object.freeze(['reference', 'layout', 'generator', 'result'])

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }

  function cloneSerializable(value) {
    if (Array.isArray(value)) return value.map(cloneSerializable)
    if (!isObject(value)) return value
    const cloned = {}
    Object.keys(value).forEach((key) => {
      const item = value[key]
      if (typeof item !== 'function' && typeof item !== 'undefined') cloned[key] = cloneSerializable(item)
    })
    return cloned
  }

  function localOutputSources(value) {
    const source = isObject(value) ? value : {}
    return [source.output, source.canvasSize, source.canvas, source]
      .filter(isObject)
  }

  function localOutputDimension(sources, names, fallback) {
    for (const source of sources) {
      for (const name of names) {
        const value = Number(source[name])
        if (Number.isFinite(value) && value > 0) {
          return Math.max(MIN_OUTPUT_SIZE, Math.min(MAX_OUTPUT_SIZE, Math.round(value)))
        }
      }
    }
    return fallback
  }

  function localNormalizeGeneratorOutput(value, fallback) {
    const fallbackSources = localOutputSources(fallback)
    const fallbackWidth = localOutputDimension(fallbackSources, ['width', 'w'], DEFAULT_OUTPUT_WIDTH)
    const fallbackHeight = localOutputDimension(fallbackSources, ['height', 'h'], DEFAULT_OUTPUT_HEIGHT)
    const sources = localOutputSources(value)
    return {
      width: localOutputDimension(sources, ['width', 'w'], fallbackWidth),
      height: localOutputDimension(sources, ['height', 'h'], fallbackHeight),
    }
  }

  function localNormalizeGeneratorSettings(value, fallback) {
    const fallbackSettings = isObject(fallback) ? cloneSerializable(fallback) : {}
    const source = isObject(value) ? cloneSerializable(value) : {}
    const settings = { ...fallbackSettings, ...source }
    delete settings.output
    delete settings.width
    delete settings.height
    delete settings.w
    delete settings.h
    delete settings.canvas
    delete settings.canvasSize
    return settings
  }

  function generatorHelper(name, localHelper) {
    const tool = root && root.NovaFlowUiDesignStructureTool
    return tool && typeof tool[name] === 'function' ? tool[name] : localHelper
  }

  function normalizeGeneratorOutput(value, fallback) {
    return generatorHelper('normalizeGeneratorOutput', localNormalizeGeneratorOutput)(value, fallback)
  }

  function normalizeGeneratorSettings(value, fallback) {
    return generatorHelper('normalizeGeneratorSettings', localNormalizeGeneratorSettings)(value, fallback)
  }

  function localHasOutputDimensions(value) {
    return localOutputSources(value).some((source) => ['width', 'w', 'height', 'h'].some((name) => {
      const dimension = Number(source[name])
      return Number.isFinite(dimension) && dimension > 0
    }))
  }

  function localGeneratorOutputFromNode(nodeValue, fallback) {
    const node = isObject(nodeValue) ? nodeValue : {}
    const data = isObject(node.data) ? node.data : {}
    const legacySettings = isObject(data.generationSettings) ? data.generationSettings : {}
    const legacyDirect = localNormalizeGeneratorOutput(legacySettings, fallback)
    const legacyNested = localNormalizeGeneratorOutput(legacySettings.output, legacyDirect)
    return localNormalizeGeneratorOutput(data.output, legacyNested)
  }

  function generatorOutputFromNode(nodeValue, fallback) {
    return generatorHelper('generatorOutputFromNode', localGeneratorOutputFromNode)(nodeValue, fallback)
  }

  function localGeneratorSettingsFromNode(nodeValue, fallback) {
    const node = isObject(nodeValue) ? nodeValue : {}
    const data = isObject(node.data) ? node.data : {}
    return localNormalizeGeneratorSettings(data.generationSettings, fallback)
  }

  function generatorSettingsFromNode(nodeValue, fallback) {
    return generatorHelper('generatorSettingsFromNode', localGeneratorSettingsFromNode)(nodeValue, fallback)
  }

  function hasOutputDimensions(value) {
    return localHasOutputDimensions(value)
  }

  function normalizeText(value, fallback) {
    const text = String(value == null ? '' : value).trim()
    return text || fallback
  }

  function mimeTypeFromDataUrl(dataUrl, fallback) {
    const match = /^data:([^;,]+)[;,]/i.exec(String(dataUrl || ''))
    return match ? match[1].toLowerCase() : normalizeText(fallback, 'image/png')
  }

  function extensionForMimeType(mimeType) {
    const type = String(mimeType || '').toLowerCase()
    if (type.includes('jpeg')) return 'jpg'
    if (type.includes('webp')) return 'webp'
    if (type.includes('gif')) return 'gif'
    if (type.includes('svg')) return 'svg'
    return 'png'
  }

  function normalizePositiveNumber(value) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : 0
  }

  function assertImageDataUrl(value) {
    const dataUrl = String(value || '').trim()
    if (!/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(dataUrl)) {
      throw new TypeError('UI resource must be an image data URL')
    }
    return dataUrl
  }

  function finiteNumber(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  function uniqueGraphId(prefix, requestedId, usedIds) {
    const requested = normalizeText(requestedId, '')
    if (requested && !usedIds.has(requested)) {
      usedIds.add(requested)
      return requested
    }
    let suffix = 1
    let candidate = `${prefix}_${suffix}`
    while (usedIds.has(candidate)) {
      suffix += 1
      candidate = `${prefix}_${suffix}`
    }
    usedIds.add(candidate)
    return candidate
  }

  function graphNodeDefaults(type) {
    if (type === 'reference') return { title: '参考图', width: 260, height: 240 }
    if (type === 'layout') return { title: '页面结构', width: 360, height: 280 }
    if (type === 'generator') return { title: 'UI 生成器', width: 360, height: 260 }
    return { title: '生成结果', width: 320, height: 260 }
  }

  function normalizeGraphBlocks(value) {
    const usedIds = new Set()
    return (Array.isArray(value) ? value : []).map((item, index) => {
      const source = isObject(item) ? cloneSerializable(item) : {}
      const block = {
        ...source,
        id: uniqueGraphId('block', source.id, usedIds),
        kind: normalizeText(source.kind, 'region'),
        name: normalizeText(source.name, `矩形块 ${index + 1}`),
        purpose: normalizeText(source.purpose, ''),
        requirements: normalizeText(source.requirements, ''),
        x: finiteNumber(source.x, 0),
        y: finiteNumber(source.y, 0),
        width: Math.max(Number.EPSILON, finiteNumber(source.width, 0.25)),
        height: Math.max(Number.EPSILON, finiteNumber(source.height, 0.2)),
        zIndex: Math.round(finiteNumber(source.zIndex, index + 1)),
        locked: Boolean(source.locked),
        participates: source.participates !== false,
      }
      delete block.dataUrl
      delete block.imageDataUrl
      return block
    })
  }

  function normalizeGraphBlocksForCanvas(value, canvasSize) {
    const width = Math.max(1, finiteNumber(canvasSize?.width, 1))
    const height = Math.max(1, finiteNumber(canvasSize?.height, 1))
    return normalizeGraphBlocks(value).map((block) => {
      const normalized = [block.xNorm, block.yNorm, block.wNorm, block.hNorm]
      const hasNormalized = normalized.every((item) => Number.isFinite(Number(item)))
      const rawX = hasNormalized ? Number(block.xNorm) : finiteNumber(block.x, 0) / width
      const rawY = hasNormalized ? Number(block.yNorm) : finiteNumber(block.y, 0) / height
      const xNorm = Math.max(0, Math.min(1, rawX))
      const yNorm = Math.max(0, Math.min(1, rawY))
      const rawWidth = hasNormalized ? Number(block.wNorm) : finiteNumber(block.width, 1) / width
      const rawHeight = hasNormalized ? Number(block.hNorm) : finiteNumber(block.height, 1) / height
      const wNorm = Math.max(0, Math.min(1 - xNorm, rawWidth))
      const hNorm = Math.max(0, Math.min(1 - yNorm, rawHeight))
      return {
        ...block,
        x: Math.round(xNorm * width),
        y: Math.round(yNorm * height),
        width: Math.max(1, Math.round(wNorm * width)),
        height: Math.max(1, Math.round(hNorm * height)),
        xNorm: Number(xNorm.toFixed(6)),
        yNorm: Number(yNorm.toFixed(6)),
        wNorm: Number(wNorm.toFixed(6)),
        hNorm: Number(hNorm.toFixed(6)),
      }
    })
  }

  function normalizeGraphNode(value, index, usedIds) {
    const source = isObject(value) ? value : {}
    const type = normalizeText(source.type || source.kind, '').toLowerCase()
    if (!GRAPH_NODE_TYPES.includes(type)) return null
    const defaults = graphNodeDefaults(type)
    const position = isObject(source.position) ? source.position : {}
    const rawData = isObject(source.data) ? source.data : {}
    const data = {}
    if (type === 'reference') {
      data.resourceId = normalizeText(rawData.resourceId || source.resourceId, '')
      data.role = normalizeText(rawData.role || source.role, 'reference')
      if (!data.resourceId) return null
    } else if (type === 'result') {
      data.resultId = normalizeText(rawData.resultId || source.resultId, '')
      const sourceNodeId = normalizeText(rawData.sourceNodeId || source.sourceNodeId, '')
      if (sourceNodeId) data.sourceNodeId = sourceNodeId
      if (!data.resultId) return null
    } else if (type === 'layout') {
      data.description = normalizeText(rawData.description ?? source.description, '')
      data.blocks = normalizeGraphBlocks(rawData.blocks || source.blocks)
      const rawAnalysisSource = isObject(rawData.analysisSource) ? rawData.analysisSource : null
      if (rawAnalysisSource) {
        if (normalizeText(rawData.analysisReview, '').toLowerCase() !== 'confirmed') return null
      }
      const rawCanvasSize = isObject(rawData.canvasSize) ? rawData.canvasSize : rawAnalysisSource
      if (rawCanvasSize) {
        const width = Math.round(finiteNumber(rawCanvasSize.width ?? rawCanvasSize.sourceWidth, 0))
        const height = Math.round(finiteNumber(rawCanvasSize.height ?? rawCanvasSize.sourceHeight, 0))
        if (width > 0 && height > 0) {
          data.canvasSize = { width, height }
          data.blocks = normalizeGraphBlocksForCanvas(data.blocks, data.canvasSize)
        }
      }
    } else {
      Object.keys(rawData).forEach((key) => {
        if (!/^(?:dataUrl|imageDataUrl|resource|result)$/i.test(key)) data[key] = cloneSerializable(rawData[key])
      })
      if (type === 'generator') {
        const legacySettings = isObject(rawData.generationSettings) ? rawData.generationSettings : null
        const hasExplicitOutput = isObject(rawData.output)
          || isObject(legacySettings && legacySettings.output)
          || hasOutputDimensions(legacySettings)
        if (legacySettings) data.generationSettings = normalizeGeneratorSettings(legacySettings)
        if (hasExplicitOutput) data.output = generatorOutputFromNode({ data: rawData })
      }
    }
    return {
      id: uniqueGraphId(type, source.id, usedIds),
      type,
      title: normalizeText(source.title || source.name, defaults.title),
      position: {
        x: finiteNumber(position.x, finiteNumber(source.x, index * 36)),
        y: finiteNumber(position.y, finiteNumber(source.y, index * 36)),
      },
      width: Math.max(120, finiteNumber(source.width, defaults.width)),
      height: Math.max(80, finiteNumber(source.height, defaults.height)),
      data,
    }
  }

  function graphRule(fromType, fromPort, toType, toPort) {
    const rules = {
      'layout:layout>generator:layout': { kind: 'layout', maximum: 1, group: 'generator-layout' },
      'reference:reference>generator:reference': { kind: 'reference', maximum: MAX_GENERATOR_GRAPH_REFERENCES, group: 'generator-reference' },
      'generator:result>result:result': { kind: 'result', maximum: 1, group: 'result-source' },
      'result:reference>generator:reference': { kind: 'reference', maximum: MAX_GENERATOR_GRAPH_REFERENCES, group: 'generator-reference' },
      'result:reference>generator:iteration': { kind: 'iteration', maximum: 1, group: 'generator-iteration' },
    }
    return rules[`${fromType}:${fromPort}>${toType}:${toPort}`] || null
  }

  function defaultGraphOutput(type) {
    if (type === 'layout') return 'layout'
    if (type === 'generator') return 'result'
    return 'reference'
  }

  function defaultGraphInput(type, kind) {
    if (type === 'generator') return kind === 'layout' ? 'layout' : (kind === 'iteration' ? 'iteration' : 'reference')
    return type === 'result' ? 'result' : 'reference'
  }

  function validateGraphConnection(graph, value) {
    const source = isObject(value) ? value : {}
    const fromNodeId = normalizeText(source.fromNodeId, '')
    const toNodeId = normalizeText(source.toNodeId, '')
    const fromNode = graph.nodes.find((node) => node.id === fromNodeId)
    const toNode = graph.nodes.find((node) => node.id === toNodeId)
    if (!fromNode || !toNode) return { ok: false, code: 'missing-node', error: '连接的节点不存在' }
    if (fromNodeId === toNodeId) return { ok: false, code: 'self-connection', error: '节点不能连接自身' }
    const requestedKind = normalizeText(source.kind, '').toLowerCase()
    const kindHint = requestedKind || (fromNode.type === 'layout' ? 'layout' : (fromNode.type === 'generator' ? 'result' : 'reference'))
    const fromPort = normalizeText(source.fromPort, defaultGraphOutput(fromNode.type)).toLowerCase()
      .replace(/^(?:out|output|image)$/, defaultGraphOutput(fromNode.type))
    const toPort = normalizeText(source.toPort, defaultGraphInput(toNode.type, kindHint)).toLowerCase()
      .replace(/^(?:in|input)$/, defaultGraphInput(toNode.type, kindHint))
      .replace(/^image$/, 'reference')
    const rule = graphRule(fromNode.type, fromPort, toNode.type, toPort)
    if (!rule) return { ok: false, code: 'incompatible-ports', error: '这两个端口不能连接' }
    if (requestedKind && requestedKind !== rule.kind) return { ok: false, code: 'invalid-kind', error: '连接类型与端口不匹配' }
    if (graph.edges.some((edge) => edge.fromNodeId === fromNodeId && edge.fromPort === fromPort
      && edge.toNodeId === toNodeId && edge.toPort === toPort)) {
      return { ok: false, code: 'duplicate-edge', error: '节点已经连接' }
    }
    const incoming = graph.edges.reduce((count, edge) => {
      if (edge.toNodeId !== toNodeId) return count
      const edgeFrom = graph.nodes.find((node) => node.id === edge.fromNodeId)
      const edgeTo = graph.nodes.find((node) => node.id === edge.toNodeId)
      const edgeRule = edgeFrom && edgeTo ? graphRule(edgeFrom.type, edge.fromPort, edgeTo.type, edge.toPort) : null
      return edgeRule && edgeRule.group === rule.group ? count + 1 : count
    }, 0)
    if (toNode.type === 'generator' && (rule.kind === 'reference' || rule.kind === 'iteration')) {
      const externalIncoming = graph.edges.filter((edge) => (
        edge.toNodeId === toNodeId && (edge.kind === 'reference' || edge.kind === 'iteration')
      )).length
      if (externalIncoming >= MAX_GENERATOR_GRAPH_REFERENCES) {
        return { ok: false, code: 'provider-reference-limit', error: `生成器最多保留 ${MAX_GENERATOR_GRAPH_REFERENCES} 张外部参考图连接` }
      }
    }
    if (incoming >= rule.maximum) return { ok: false, code: 'port-limit', error: '该输入端口已达到连接上限' }
    return { ok: true, edge: { fromNodeId, fromPort, toNodeId, toPort, kind: rule.kind } }
  }

  function normalizeGraphLineage(value) {
    const entries = Array.isArray(value)
      ? value
      : (isObject(value) ? Object.keys(value).map((resultId) => ({ resultId, ...value[resultId] })) : [])
    const used = new Set()
    return entries.reduce((output, item) => {
      const source = isObject(item) ? item : {}
      const resultId = normalizeText(source.resultId, '')
      if (!resultId || used.has(resultId)) return output
      used.add(resultId)
      const entry = {
        resultId,
        generatorNodeId: normalizeText(source.generatorNodeId, ''),
        resultNodeId: normalizeText(source.resultNodeId, ''),
        layoutNodeId: normalizeText(source.layoutNodeId, ''),
        parentResultIds: Array.from(new Set((Array.isArray(source.parentResultIds) ? source.parentResultIds : []).map(String).filter(Boolean))),
        referenceResourceIds: Array.from(new Set((Array.isArray(source.referenceResourceIds) ? source.referenceResourceIds : []).map(String).filter(Boolean))),
      }
      const createdAt = normalizeText(source.createdAt, '')
      if (createdAt) entry.createdAt = createdAt
      output.push(entry)
      return output
    }, [])
  }

  function localNormalizeGraph(value, legacyBlocks = []) {
    const source = isObject(value) ? value : {}
    const usedNodeIds = new Set()
    const sourceNodes = Array.isArray(source.nodes) ? source.nodes : []
    const nodes = sourceNodes
      .map((node, index) => normalizeGraphNode(node, index, usedNodeIds))
      .filter(Boolean)
    if (!sourceNodes.length && !nodes.length && legacyBlocks.length) {
      nodes.push(normalizeGraphNode({
        id: 'layout_1',
        type: 'layout',
        title: '页面结构',
        position: { x: 0, y: 0 },
        data: { blocks: legacyBlocks },
      }, 0, usedNodeIds))
    }
    const graph = {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      nodes,
      edges: [],
      lineage: normalizeGraphLineage(source.lineage || source.resultLineage),
    }
    const usedEdgeIds = new Set()
    ;(Array.isArray(source.edges) ? source.edges : []).forEach((item) => {
      const validated = validateGraphConnection(graph, item)
      if (!validated.ok) return
      const edge = validated.edge
      const base = `edge_${edge.fromNodeId}_${edge.fromPort}_${edge.toNodeId}_${edge.toPort}`.replace(/[^a-zA-Z0-9_-]+/g, '_')
      edge.id = uniqueGraphId(base, item && item.id, usedEdgeIds)
      graph.edges.push(edge)
    })
    return graph
  }

  function structureTool() {
    const tool = root && root.NovaFlowUiDesignStructureTool
    return tool && typeof tool.normalizeGraph === 'function' ? tool : null
  }

  function normalizeGraph(value, legacyBlocks = []) {
    const tool = structureTool()
    return tool
      ? tool.normalizeGraph(value, { legacyBlocks })
      : localNormalizeGraph(value, legacyBlocks)
  }

  function firstGraphLayout(graph) {
    return graph.nodes.find((node) => node.type === 'layout') || null
  }

  function graphBlocks(value) {
    const graph = normalizeGraph(value)
    const layout = firstGraphLayout(graph)
    return layout ? cloneSerializable(layout.data.blocks) : []
  }

  function synchronizeGraphBlocks(value, blocks) {
    let graph = normalizeGraph(value, blocks)
    const layout = firstGraphLayout(graph)
    if (!layout) return graph
    graph = normalizeGraph({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === layout.id
        ? { ...node, data: { ...node.data, blocks: cloneSerializable(blocks) } }
        : node),
    }, blocks)
    return graph
  }

  function addNodeToGraph(value, nodeValue) {
    const tool = structureTool()
    if (tool && typeof tool.createGraphNode === 'function') return tool.createGraphNode(value, nodeValue)
    const graph = localNormalizeGraph(value)
    const usedIds = new Set(graph.nodes.map((node) => node.id))
    const node = normalizeGraphNode(nodeValue, graph.nodes.length, usedIds)
    if (!node) return { ok: false, graph, code: 'invalid-node', error: '节点类型或资源标识无效' }
    const nextGraph = localNormalizeGraph({ ...graph, nodes: graph.nodes.concat(node) })
    return { ok: true, graph: nextGraph, node: nextGraph.nodes.find((item) => item.id === node.id) }
  }

  function patchNodeInGraph(value, nodeId, patch) {
    const tool = structureTool()
    if (tool && typeof tool.updateGraphNode === 'function') return tool.updateGraphNode(value, nodeId, patch)
    const graph = localNormalizeGraph(value)
    const id = normalizeText(nodeId, '')
    const current = graph.nodes.find((node) => node.id === id)
    if (!current) return { ok: false, graph, code: 'missing-node', error: '节点不存在' }
    const sourcePatch = isObject(patch) ? cloneSerializable(patch) : {}
    const merged = {
      ...current,
      ...sourcePatch,
      id: current.id,
      type: current.type,
      position: { ...current.position, ...(isObject(sourcePatch.position) ? sourcePatch.position : {}) },
      data: { ...current.data, ...(isObject(sourcePatch.data) ? sourcePatch.data : {}) },
    }
    const node = normalizeGraphNode(merged, graph.nodes.indexOf(current), new Set())
    if (!node) return { ok: false, graph, code: 'invalid-node', error: '节点数据无效' }
    node.id = current.id
    const nextGraph = localNormalizeGraph({
      ...graph,
      nodes: graph.nodes.map((item) => item.id === id ? node : item),
    })
    return { ok: true, graph: nextGraph, node: nextGraph.nodes.find((item) => item.id === id) }
  }

  function removeNodeFromGraph(value, nodeId) {
    const tool = structureTool()
    if (tool && typeof tool.removeGraphNode === 'function') return tool.removeGraphNode(value, nodeId)
    const graph = localNormalizeGraph(value)
    const id = normalizeText(nodeId, '')
    const node = graph.nodes.find((item) => item.id === id)
    if (!node) return { ok: false, graph, code: 'missing-node', error: '节点不存在' }
    const resultId = node.type === 'result' ? node.data.resultId : ''
    return {
      ok: true,
      graph: localNormalizeGraph({
        ...graph,
        nodes: graph.nodes.filter((item) => item.id !== id),
        edges: graph.edges.filter((edge) => edge.fromNodeId !== id && edge.toNodeId !== id),
        lineage: graph.lineage.filter((entry) => entry.resultId !== resultId
          && entry.generatorNodeId !== id
          && entry.resultNodeId !== id),
      }),
      removedNodeId: id,
    }
  }

  function connectNodesInGraph(value, edgeValue) {
    const tool = structureTool()
    if (tool && typeof tool.connectGraph === 'function') return tool.connectGraph(value, edgeValue)
    const graph = localNormalizeGraph(value)
    const validated = validateGraphConnection(graph, edgeValue)
    if (!validated.ok) return { ...validated, graph }
    const usedIds = new Set(graph.edges.map((edge) => edge.id))
    const edge = validated.edge
    const base = `edge_${edge.fromNodeId}_${edge.fromPort}_${edge.toNodeId}_${edge.toPort}`.replace(/[^a-zA-Z0-9_-]+/g, '_')
    edge.id = uniqueGraphId(base, edgeValue && edgeValue.id, usedIds)
    const nextGraph = localNormalizeGraph({ ...graph, edges: graph.edges.concat(edge) })
    return { ok: true, graph: nextGraph, edge: nextGraph.edges.find((item) => item.id === edge.id) }
  }

  function removeEdgeFromGraph(value, edgeId) {
    const tool = structureTool()
    if (tool && typeof tool.removeGraphEdge === 'function') return tool.removeGraphEdge(value, edgeId)
    const graph = localNormalizeGraph(value)
    const id = normalizeText(edgeId, '')
    if (!graph.edges.some((edge) => edge.id === id)) {
      return { ok: false, graph, code: 'missing-edge', error: '连接不存在' }
    }
    return {
      ok: true,
      graph: localNormalizeGraph({ ...graph, edges: graph.edges.filter((edge) => edge.id !== id) }),
      removedEdgeId: id,
    }
  }

  function legacyGeneratorOutput(settingsValue, projectValue) {
    const settings = isObject(settingsValue) ? settingsValue : {}
    const projectOutput = normalizeGeneratorOutput(projectValue)
    const settingsDirect = normalizeGeneratorOutput(settings, projectOutput)
    return normalizeGeneratorOutput(settings.output, settingsDirect)
  }

  function normalizeGeneratorGraph(value, settingsValue, projectValue, legacyBlocks = []) {
    const graph = normalizeGraph(value, legacyBlocks)
    const fallbackOutput = legacyGeneratorOutput(settingsValue, projectValue)
    const fallbackSettings = normalizeGeneratorSettings(settingsValue)
    const nodes = graph.nodes.map((node) => {
      if (node.type !== 'generator') return node
      return {
        ...node,
        data: {
          ...node.data,
          generationSettings: generatorSettingsFromNode(node, fallbackSettings),
          output: generatorOutputFromNode(node, fallbackOutput),
        },
      }
    })
    return normalizeGraph({ ...graph, nodes }, legacyBlocks)
  }

  function createProjectStore(initialState = {}, storeOptions = {}) {
    const initial = isObject(initialState) ? initialState : {}
    const options = isObject(storeOptions) ? storeOptions : {}
    const listeners = new Set()
    let disposed = false
    let idSequence = 0
    const usedIds = new Set()

    function nextId(prefix, preferred) {
      const requested = String(preferred || '').trim()
      if (requested && !usedIds.has(requested)) {
        usedIds.add(requested)
        return requested
      }
      let candidate = ''
      do {
        idSequence += 1
        candidate = `${prefix}-${idSequence}`
      } while (usedIds.has(candidate))
      usedIds.add(candidate)
      return candidate
    }

    function normalizeResource(input, index) {
      const source = isObject(input) ? input : { dataUrl: input }
      const dataUrl = assertImageDataUrl(source.dataUrl)
      const mimeType = mimeTypeFromDataUrl(dataUrl, source.mimeType || source.type)
      const sharedResourceId = normalizeText(source.sharedResourceId, '')
      return {
        ...cloneSerializable(source),
        id: nextId('ui-resource', source.id),
        name: normalizeText(source.name || source.fileName, `UI参考图-${index + 1}.${extensionForMimeType(mimeType)}`),
        kind: normalizeText(source.kind, 'imported'),
        mimeType,
        dataUrl,
        width: normalizePositiveNumber(source.width),
        height: normalizePositiveNumber(source.height),
        isReference: Boolean(source.isReference),
        createdAt: normalizeText(source.createdAt, new Date().toISOString()),
        ...(sharedResourceId ? { sharedResourceId } : {}),
      }
    }

    function normalizeResult(input, index) {
      const source = isObject(input) ? input : { dataUrl: input }
      const dataUrl = assertImageDataUrl(source.dataUrl)
      const mimeType = mimeTypeFromDataUrl(dataUrl, source.mimeType || source.type)
      const sharedResourceId = normalizeText(source.sharedResourceId, '')
      return {
        ...cloneSerializable(source),
        id: nextId('ui-result', source.id),
        name: normalizeText(source.name || source.fileName, `UI方案-${index + 1}.${extensionForMimeType(mimeType)}`),
        kind: normalizeText(source.kind, 'generated'),
        mimeType,
        dataUrl,
        width: normalizePositiveNumber(source.width),
        height: normalizePositiveNumber(source.height),
        createdAt: normalizeText(source.createdAt, new Date().toISOString()),
        ...(sharedResourceId ? { sharedResourceId } : {}),
      }
    }

    const resources = (Array.isArray(initial.resources) ? initial.resources : []).map(normalizeResource)
    const results = (Array.isArray(initial.results) ? initial.results : []).map(normalizeResult)
    const requestedReferences = Array.isArray(initial.referenceIds)
      ? initial.referenceIds.map(String)
      : resources.filter((resource) => resource.isReference).map((resource) => resource.id)
    const referenceIds = requestedReferences
      .filter((id, index, values) => resources.some((resource) => resource.id === id) && values.indexOf(id) === index)
      .slice(0, MAX_REFERENCES)
    const referenceSet = new Set(referenceIds)
    resources.forEach((resource) => { resource.isReference = referenceSet.has(resource.id) })

    const initialProject = isObject(initial.project) ? cloneSerializable(initial.project) : {}
    const initialGeometry = isObject(initialProject.geometry) ? initialProject.geometry : {}
    const requestedInitialBlocks = Array.isArray(initialProject.blocks)
      ? initialProject.blocks
      : (Array.isArray(initialGeometry.blocks) ? initialGeometry.blocks : [])
    let graph = normalizeGraph(initialProject.graph || initial.graph || initialGeometry.graph, requestedInitialBlocks)
    const initialBlocks = graphBlocks(graph)
    graph = normalizeGraph(graph, initialBlocks)
    let project = {
      ...initialProject,
      id: normalizeText(initialProject.id, 'ui-project'),
      title: normalizeText(initialProject.title || initialProject.name, '未命名 UI'),
      name: normalizeText(initialProject.name || initialProject.title, '未命名 UI'),
      width: normalizePositiveNumber(initialProject.width) || 1920,
      height: normalizePositiveNumber(initialProject.height) || 1080,
      blocks: cloneSerializable(initialBlocks),
      graph,
      geometry: {
        artboards: [],
        ...initialGeometry,
        blocks: cloneSerializable(initialBlocks),
        graph: cloneSerializable(graph),
      },
    }
    const legacyProjectSettings = isObject(initialProject.settings) ? initialProject.settings : {}
    const settings = {
      provider: 'local',
      referenceLimit: MAX_REFERENCES,
      ...cloneSerializable(legacyProjectSettings),
      ...(isObject(initial.settings) ? cloneSerializable(initial.settings) : {}),
      referenceLimit: MAX_REFERENCES,
    }
    graph = normalizeGeneratorGraph(graph, settings, project, initialBlocks)
    project = {
      ...project,
      graph,
      geometry: { ...project.geometry, graph: cloneSerializable(graph) },
    }

    let state = {
      project,
      settings,
      resources,
      results,
      selectedResourceId: resources.some((resource) => resource.id === String(initial.selectedResourceId || ''))
        ? String(initial.selectedResourceId)
        : '',
      selectedResultId: results.some((result) => result.id === String(initial.selectedResultId || ''))
        ? String(initial.selectedResultId)
        : '',
      referenceIds,
      graph,
    }

    function getState() {
      return state
    }

    function getSnapshot() {
      return cloneSerializable(state)
    }

    function getGraphSnapshot() {
      return cloneSerializable(state.graph)
    }

    function generatorNodeById(nodeId) {
      const requested = normalizeText(nodeId, '')
      return state.graph.nodes.find((node) => node.type === 'generator' && (!requested || node.id === requested)) || null
    }

    function getGeneratorOutput(nodeId) {
      const node = generatorNodeById(nodeId)
      return generatorOutputFromNode(node, legacyGeneratorOutput(state.settings, state.project))
    }

    function getGeneratorSettings(nodeId) {
      const node = generatorNodeById(nodeId)
      return generatorSettingsFromNode(node, normalizeGeneratorSettings(state.settings))
    }

    function notify(previous, reason) {
      Array.from(listeners).forEach((listener) => listener(state, previous, reason))
    }

    function replaceState(next, reason) {
      if (disposed) return state
      const previous = state
      state = next
      notify(previous, reason)
      return state
    }

    function subscribe(listener, options = {}) {
      if (typeof listener !== 'function') throw new TypeError('UI project subscriber must be a function')
      if (disposed) return function unsubscribeDisposedStore() {}
      listeners.add(listener)
      if (options && options.emitCurrent) listener(state, state, 'subscribe')
      return function unsubscribe() {
        listeners.delete(listener)
      }
    }

    function projectWithGraph(nextValue) {
      const nextGraph = normalizeGeneratorGraph(nextValue, state.settings, state.project)
      const nextBlocks = graphBlocks(nextGraph)
      const nextProject = {
        ...state.project,
        blocks: cloneSerializable(nextBlocks),
        graph: nextGraph,
        geometry: {
          ...state.project.geometry,
          blocks: cloneSerializable(nextBlocks),
          graph: cloneSerializable(nextGraph),
        },
      }
      return { graph: nextGraph, project: nextProject }
    }

    function applyGraph(nextValue, reason) {
      const next = projectWithGraph(nextValue)
      const nextGraph = next.graph
      const nextProject = next.project
      replaceState({ ...state, project: nextProject, graph: nextGraph }, reason)
      return nextGraph
    }

    function replaceGraph(nextValue, reason = 'graph-replace') {
      const resolved = typeof nextValue === 'function'
        ? nextValue(getGraphSnapshot())
        : nextValue
      return applyGraph(isObject(resolved) ? resolved : state.graph, reason)
    }

    function mutateGraph(mutator, reason = 'graph-mutate') {
      if (typeof mutator !== 'function') {
        return { ok: false, graph: getGraphSnapshot(), code: 'invalid-mutator', error: '图修改器必须是函数' }
      }
      const draft = getGraphSnapshot()
      const returned = mutator(draft)
      const candidate = isObject(returned) && isObject(returned.graph)
        ? returned.graph
        : (isObject(returned) ? returned : draft)
      return { ok: true, graph: applyGraph(candidate, reason) }
    }

    function addGraphNode(nodeValue) {
      const result = addNodeToGraph(state.graph, nodeValue)
      if (!result.ok) return result
      const graph = applyGraph(result.graph, 'graph-add-node')
      return { ...result, graph, node: graph.nodes.find((node) => node.id === result.node.id) }
    }

    function patchGraphNode(nodeId, patch) {
      const result = patchNodeInGraph(state.graph, nodeId, patch)
      if (!result.ok) return result
      const graph = applyGraph(result.graph, 'graph-update-node')
      return { ...result, graph, node: graph.nodes.find((node) => node.id === result.node.id) }
    }

    function removeGraphNode(nodeId) {
      const result = removeNodeFromGraph(state.graph, nodeId)
      if (!result.ok) return result
      return { ...result, graph: applyGraph(result.graph, 'graph-remove-node') }
    }

    function connectGraph(edgeValue) {
      const result = connectNodesInGraph(state.graph, edgeValue)
      if (!result.ok) return result
      const graph = applyGraph(result.graph, 'graph-connect')
      return { ...result, graph, edge: graph.edges.find((edge) => edge.id === result.edge.id) }
    }

    function removeGraphEdge(edgeId) {
      const result = removeEdgeFromGraph(state.graph, edgeId)
      if (!result.ok) return result
      return { ...result, graph: applyGraph(result.graph, 'graph-remove-edge') }
    }

    function recordResultLineage(value) {
      const source = isObject(value) ? value : {}
      const resultId = normalizeText(source.resultId, '')
      if (!resultId) return { ok: false, code: 'missing-result-id', error: '结果标识不能为空' }
      const normalized = normalizeGraphLineage([source])[0]
      const lineage = state.graph.lineage.filter((entry) => entry.resultId !== resultId).concat(normalized)
      const graph = applyGraph({ ...state.graph, lineage }, 'graph-lineage')
      return {
        ok: true,
        graph,
        lineage: cloneSerializable(graph.lineage.find((entry) => entry.resultId === resultId)),
      }
    }

    function patchProject(patch) {
      const resolved = typeof patch === 'function' ? patch(state.project) : patch
      if (!isObject(resolved)) return state.project
      const geometryPatch = isObject(resolved.geometry) ? resolved.geometry : null
      const hasBlocksPatch = Array.isArray(resolved.blocks) || Boolean(geometryPatch && Array.isArray(geometryPatch.blocks))
      const hasGraphPatch = isObject(resolved.graph) || Boolean(geometryPatch && isObject(geometryPatch.graph))
      const nextWidth = Object.prototype.hasOwnProperty.call(resolved, 'width')
        ? (normalizePositiveNumber(resolved.width) || state.project.width)
        : state.project.width
      const nextHeight = Object.prototype.hasOwnProperty.call(resolved, 'height')
        ? (normalizePositiveNumber(resolved.height) || state.project.height)
        : state.project.height
      let nextBlocks = Array.isArray(resolved.blocks)
        ? cloneSerializable(resolved.blocks)
        : (geometryPatch && Array.isArray(geometryPatch.blocks)
          ? cloneSerializable(geometryPatch.blocks)
          : state.project.blocks)
      let nextGraph = normalizeGraph(
        (isObject(resolved.graph) && resolved.graph)
          || (geometryPatch && isObject(geometryPatch.graph) && geometryPatch.graph)
          || state.graph,
        nextBlocks,
      )
      if (hasGraphPatch) nextBlocks = graphBlocks(nextGraph)
      else if (hasBlocksPatch) {
        nextGraph = synchronizeGraphBlocks(nextGraph, nextBlocks)
        nextBlocks = graphBlocks(nextGraph)
      }
      nextGraph = normalizeGeneratorGraph(nextGraph, state.settings, { width: nextWidth, height: nextHeight }, nextBlocks)
      const nextProject = {
        ...state.project,
        ...cloneSerializable(resolved),
        title: Object.prototype.hasOwnProperty.call(resolved, 'title')
          ? normalizeText(resolved.title, state.project.title)
          : (Object.prototype.hasOwnProperty.call(resolved, 'name')
            ? normalizeText(resolved.name, state.project.title)
            : state.project.title),
        name: Object.prototype.hasOwnProperty.call(resolved, 'name')
          ? normalizeText(resolved.name, state.project.name)
          : (Object.prototype.hasOwnProperty.call(resolved, 'title')
            ? normalizeText(resolved.title, state.project.name)
            : state.project.name),
        width: nextWidth,
        height: nextHeight,
        blocks: nextBlocks,
        graph: nextGraph,
        geometry: geometryPatch
          ? { ...state.project.geometry, ...cloneSerializable(geometryPatch), blocks: cloneSerializable(nextBlocks), graph: cloneSerializable(nextGraph) }
          : { ...state.project.geometry, blocks: cloneSerializable(nextBlocks), graph: cloneSerializable(nextGraph) },
      }
      replaceState({ ...state, project: nextProject, graph: nextGraph }, 'patch-project')
      return nextProject
    }

    function patchSettings(patch) {
      const resolved = typeof patch === 'function' ? patch(state.settings) : patch
      if (!isObject(resolved)) return state.settings
      const nextSettings = {
        ...state.settings,
        ...cloneSerializable(resolved),
        referenceLimit: MAX_REFERENCES,
      }
      replaceState({ ...state, settings: nextSettings }, 'patch-settings')
      return nextSettings
    }

    function addDataUrls(items) {
      const sources = Array.isArray(items) ? items : [items]
      if (!sources.length) return []
      const added = sources.map((item, index) => normalizeResource(item, state.resources.length + index))
      replaceState({
        ...state,
        resources: state.resources.concat(added),
        selectedResourceId: added[added.length - 1].id,
      }, 'add-resources')
      return added
    }

    function bytesToDataUrl(bytes, mimeType) {
      let binary = ''
      const values = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      const chunkSize = 0x8000
      for (let offset = 0; offset < values.length; offset += chunkSize) {
        binary += String.fromCharCode.apply(null, values.subarray(offset, offset + chunkSize))
      }
      const btoa = root && typeof root.btoa === 'function' ? root.btoa.bind(root) : null
      if (btoa) return `data:${mimeType};base64,${btoa(binary)}`
      const BufferCtor = root && root.Buffer
      if (BufferCtor && typeof BufferCtor.from === 'function') {
        return `data:${mimeType};base64,${BufferCtor.from(values).toString('base64')}`
      }
      throw new Error('This environment cannot encode imported image files')
    }

    function readFileAsDataUrl(file) {
      if (file && typeof file.dataUrl === 'string') return Promise.resolve(file.dataUrl)
      const FileReaderCtor = root && root.FileReader
      if (typeof FileReaderCtor === 'function') {
        return new Promise((resolve, reject) => {
          const reader = new FileReaderCtor()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => reject(reader.error || new Error('读取 UI 参考图失败'))
          reader.readAsDataURL(file)
        })
      }
      if (file && typeof file.arrayBuffer === 'function') {
        return Promise.resolve(file.arrayBuffer()).then((buffer) => bytesToDataUrl(buffer, normalizeText(file.type, 'image/png')))
      }
      return Promise.reject(new TypeError('Imported UI resource is not a readable file'))
    }

    async function addImportedFiles(files) {
      const list = Array.from(files || [])
      if (!list.length) return []
      const entries = await Promise.all(list.map(async (file, index) => {
        if (typeof file === 'string') return { name: `UI参考图-${index + 1}.png`, dataUrl: file }
        const mimeType = normalizeText(file && file.type, 'image/png')
        if (!mimeType.startsWith('image/')) throw new TypeError('UI resource import only accepts image files')
        return {
          name: normalizeText(file && (file.name || file.fileName), `UI参考图-${index + 1}.${extensionForMimeType(mimeType)}`),
          kind: normalizeText(file && file.kind, 'imported'),
          mimeType,
          dataUrl: await readFileAsDataUrl(file),
          width: normalizePositiveNumber(file && file.width),
          height: normalizePositiveNumber(file && file.height),
        }
      }))
      return addDataUrls(entries)
    }

    function setSelectedResource(id) {
      const selectedResourceId = String(id || '')
      if (selectedResourceId && !state.resources.some((resource) => resource.id === selectedResourceId)) return false
      if (state.selectedResourceId === selectedResourceId) return true
      replaceState({ ...state, selectedResourceId }, 'select-resource')
      return true
    }

    function setSelectedResult(id) {
      const selectedResultId = String(id || '')
      if (selectedResultId && !state.results.some((result) => result.id === selectedResultId)) return false
      if (state.selectedResultId === selectedResultId) return true
      replaceState({ ...state, selectedResultId }, 'select-result')
      return true
    }

    function patchResource(id, patch) {
      const resourceId = String(id || '')
      const index = state.resources.findIndex((resource) => resource.id === resourceId)
      if (index < 0) return null
      const current = state.resources[index]
      const resolved = typeof patch === 'function' ? patch(current) : patch
      if (!isObject(resolved)) return current
      const source = { ...current, ...cloneSerializable(resolved), id: current.id }
      if (Object.prototype.hasOwnProperty.call(resolved, 'dataUrl')) source.dataUrl = assertImageDataUrl(resolved.dataUrl)
      source.mimeType = mimeTypeFromDataUrl(source.dataUrl, source.mimeType || source.type)
      source.name = normalizeText(source.name || source.fileName, current.name)
      source.width = normalizePositiveNumber(source.width)
      source.height = normalizePositiveNumber(source.height)
      source.sharedResourceId = normalizeText(source.sharedResourceId, '')
      if (!source.sharedResourceId) delete source.sharedResourceId
      const resources = state.resources.slice()
      resources[index] = source
      replaceState({ ...state, resources }, 'update-resource')
      return source
    }

    function patchResult(id, patch) {
      const resultId = String(id || '')
      const index = state.results.findIndex((result) => result.id === resultId)
      if (index < 0) return null
      const current = state.results[index]
      const resolved = typeof patch === 'function' ? patch(current) : patch
      if (!isObject(resolved)) return current
      const source = { ...current, ...cloneSerializable(resolved), id: current.id }
      if (Object.prototype.hasOwnProperty.call(resolved, 'dataUrl')) source.dataUrl = assertImageDataUrl(resolved.dataUrl)
      source.mimeType = mimeTypeFromDataUrl(source.dataUrl, source.mimeType || source.type)
      source.name = normalizeText(source.name || source.fileName, current.name)
      source.width = normalizePositiveNumber(source.width)
      source.height = normalizePositiveNumber(source.height)
      source.sharedResourceId = normalizeText(source.sharedResourceId, '')
      if (!source.sharedResourceId) delete source.sharedResourceId
      const results = state.results.slice()
      results[index] = source
      replaceState({ ...state, results }, 'update-result')
      return source
    }

    function syncSharedResources(items, syncOptions = {}) {
      const sources = Array.isArray(items) ? items : []
      const authoritative = isObject(syncOptions) && syncOptions.authoritative === true
      const snapshotIds = new Set(sources
        .filter(isObject)
        .map((item) => normalizeText(item.sharedResourceId || item.id, ''))
        .filter(Boolean))
      const resources = state.resources.slice()
      const results = state.results.slice()
      const syncedIds = []

      sources.forEach((item) => {
        if (!isObject(item)) return
        const sharedResourceId = normalizeText(item.sharedResourceId || item.id, '')
        const dataUrl = String(item.dataUrl || '')
        if (!sharedResourceId || !/^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(dataUrl)) return
        const externalId = normalizeText(item.externalId, '')
        const linkedResultIndex = results.findIndex((result) => (
          normalizeText(result.sharedResourceId, '') === sharedResourceId
          || (externalId && result.id === externalId)
        ))
        const resourceIndex = resources.findIndex((resource) => (
          normalizeText(resource.sharedResourceId, '') === sharedResourceId
          || (!resource.sharedResourceId && externalId && resource.id === externalId)
        ))
        const resourceValue = {
          ...cloneSerializable(item),
          sharedResourceId,
          dataUrl,
          name: normalizeText(item.name || item.fileName, '共享资源'),
          kind: normalizeText(item.kind, linkedResultIndex >= 0 ? 'generated' : 'shared'),
          ...(linkedResultIndex >= 0 ? { linkedResultId: results[linkedResultIndex].id } : {}),
        }
        if (resourceIndex >= 0) {
          const current = resources[resourceIndex]
          resources[resourceIndex] = {
            ...current,
            ...resourceValue,
            id: current.id,
            mimeType: mimeTypeFromDataUrl(dataUrl, item.mimeType || item.type || current.mimeType),
            width: normalizePositiveNumber(item.width) || current.width,
            height: normalizePositiveNumber(item.height) || current.height,
            isReference: Boolean(current.isReference),
          }
        } else {
          resources.push(normalizeResource({
            ...resourceValue,
            id: sharedResourceId,
            isReference: false,
          }, resources.length))
        }
        const resultIndex = linkedResultIndex
        if (resultIndex >= 0) {
          results[resultIndex] = {
            ...results[resultIndex],
            sharedResourceId,
            dataUrl,
            width: normalizePositiveNumber(item.width) || results[resultIndex].width,
            height: normalizePositiveNumber(item.height) || results[resultIndex].height,
          }
        }
        syncedIds.push(sharedResourceId)
      })

      if (syncedIds.length) replaceState({ ...state, resources, results }, 'sync-shared-resources')

      if (authoritative) {
        const staleSharedResourceIds = Array.from(new Set(state.resources
          .concat(state.results)
          .map((item) => normalizeText(item.sharedResourceId, ''))
          .filter((sharedResourceId) => sharedResourceId && !snapshotIds.has(sharedResourceId))))
        staleSharedResourceIds.forEach(removeSharedResource)
      }

      return Array.from(new Set(syncedIds))
    }

    function removeSharedResource(id) {
      const sharedResourceId = String(id || '')
      if (!sharedResourceId) return { resources: 0, results: 0 }
      const resourceIds = state.resources
        .filter((resource) => String(resource.sharedResourceId || '') === sharedResourceId)
        .map((resource) => resource.id)
      const resultIds = state.results
        .filter((result) => String(result.sharedResourceId || '') === sharedResourceId)
        .map((result) => result.id)
      resultIds.forEach((resultId) => removeResult(resultId, { external: true }))
      resourceIds.forEach((resourceId) => removeResource(resourceId, { external: true }))
      return { resources: resourceIds.length, results: resultIds.length }
    }

    function toggleReference(id, force) {
      const resourceId = String(id || '')
      const resource = state.resources.find((item) => item.id === resourceId)
      if (!resource) return { ok: false, error: '未找到 UI 参考图' }
      const currentlyActive = state.referenceIds.includes(resourceId)
      const shouldActivate = typeof force === 'boolean' ? force : !currentlyActive
      if (shouldActivate === currentlyActive) {
        return { ok: true, active: currentlyActive, referenceIds: state.referenceIds.slice() }
      }
      if (shouldActivate && state.referenceIds.length >= MAX_REFERENCES) {
        return { ok: false, error: `最多只能选择 ${MAX_REFERENCES} 张参考图`, referenceIds: state.referenceIds.slice() }
      }
      const referenceIds = shouldActivate
        ? state.referenceIds.concat(resourceId)
        : state.referenceIds.filter((candidate) => candidate !== resourceId)
      const referenceSet = new Set(referenceIds)
      const nextResources = state.resources.map((item) => item.id === resourceId
        ? { ...item, isReference: referenceSet.has(item.id) }
        : item)
      replaceState({ ...state, resources: nextResources, referenceIds }, 'toggle-reference')
      return { ok: true, active: shouldActivate, referenceIds: referenceIds.slice() }
    }

    function addResult(input) {
      const result = normalizeResult(input, state.results.length)
      const lineageSource = isObject(input && input.lineage)
        ? { ...input.lineage, resultId: result.id }
        : (input && (input.generatorNodeId || input.resultNodeId || input.layoutNodeId || input.parentResultIds || input.referenceResourceIds)
          ? { ...input, resultId: result.id }
          : null)
      const nextGraphValue = lineageSource
        ? { ...state.graph, lineage: state.graph.lineage.filter((entry) => entry.resultId !== result.id).concat(normalizeGraphLineage([lineageSource])) }
        : state.graph
      const next = projectWithGraph(nextGraphValue)
      replaceState({
        ...state,
        project: next.project,
        graph: next.graph,
        results: state.results.concat(result),
        selectedResultId: result.id,
      }, 'add-result')
      return result
    }

    function removeResource(id, removeOptions = {}) {
      const resourceId = String(id || '')
      const resourceRecord = state.resources.find((resource) => resource.id === resourceId)
      if (!resourceRecord) return false
      const sharedResourceId = String(resourceRecord.sharedResourceId || '')
      const nodeIds = new Set(state.graph.nodes
        .filter((node) => node.type === 'reference' && node.data.resourceId === resourceId)
        .map((node) => node.id))
      const next = projectWithGraph({
        ...state.graph,
        nodes: state.graph.nodes.filter((node) => !nodeIds.has(node.id)),
        edges: state.graph.edges.filter((edge) => !nodeIds.has(edge.fromNodeId) && !nodeIds.has(edge.toNodeId)),
        lineage: state.graph.lineage.map((entry) => ({
          ...entry,
          referenceResourceIds: entry.referenceResourceIds.filter((candidate) => candidate !== resourceId),
        })),
      })
      replaceState({
        ...state,
        project: next.project,
        graph: next.graph,
        resources: state.resources.filter((resource) => resource.id !== resourceId),
        referenceIds: state.referenceIds.filter((candidate) => candidate !== resourceId),
        selectedResourceId: state.selectedResourceId === resourceId ? '' : state.selectedResourceId,
      }, 'remove-resource')
      if (sharedResourceId && removeOptions.external !== true && typeof options.onRemoveSharedResource === 'function') {
        try { options.onRemoveSharedResource(sharedResourceId, { entity: 'resource', localId: resourceId }) } catch {}
      }
      return true
    }

    function removeResult(id, removeOptions = {}) {
      const resultId = String(id || '')
      const resultRecord = state.results.find((result) => result.id === resultId)
      if (!resultRecord) return false
      const sharedResourceId = String(resultRecord.sharedResourceId || '')
      const nodeIds = new Set(state.graph.nodes
        .filter((node) => node.type === 'result' && node.data.resultId === resultId)
        .map((node) => node.id))
      const next = projectWithGraph({
        ...state.graph,
        nodes: state.graph.nodes.filter((node) => !nodeIds.has(node.id)),
        edges: state.graph.edges.filter((edge) => !nodeIds.has(edge.fromNodeId) && !nodeIds.has(edge.toNodeId)),
        lineage: state.graph.lineage.filter((entry) => entry.resultId !== resultId)
          .map((entry) => ({
            ...entry,
            parentResultIds: entry.parentResultIds.filter((candidate) => candidate !== resultId),
          })),
      })
      replaceState({
        ...state,
        project: next.project,
        graph: next.graph,
        results: state.results.filter((result) => result.id !== resultId),
        selectedResultId: state.selectedResultId === resultId ? '' : state.selectedResultId,
      }, 'remove-result')
      if (sharedResourceId && removeOptions.external !== true && typeof options.onRemoveSharedResource === 'function') {
        try { options.onRemoveSharedResource(sharedResourceId, { entity: 'result', localId: resultId }) } catch {}
      }
      return true
    }

    function remove(id, kind) {
      if (String(kind || '').toLowerCase() === 'result') return removeResult(id)
      if (String(kind || '').toLowerCase() === 'resource') return removeResource(id)
      return removeResource(id) || removeResult(id)
    }

    function referenceResources() {
      const references = new Set(state.referenceIds)
      return state.resources.filter((resource) => references.has(resource.id))
    }

    function serializeProject() {
      return {
        version: SERIAL_VERSION,
        schemaVersion: GRAPH_SCHEMA_VERSION,
        project: cloneSerializable(state.project),
        settings: cloneSerializable(state.settings),
      }
    }

    function serializeProjectGeometry() {
      return {
        version: SERIAL_VERSION,
        schemaVersion: GRAPH_SCHEMA_VERSION,
        project: {
          id: state.project.id,
          title: state.project.title,
          name: state.project.name,
          width: state.project.width,
          height: state.project.height,
          blocks: cloneSerializable(state.project.blocks),
          graph: cloneSerializable(state.graph),
        },
        geometry: {
          ...cloneSerializable(state.project.geometry),
          width: state.project.width,
          height: state.project.height,
          blocks: cloneSerializable(state.project.blocks),
          graph: cloneSerializable(state.graph),
        },
        settings: cloneSerializable(state.settings),
      }
    }

    function serializeJson() {
      return JSON.stringify(serializeProject())
    }

    function destroy() {
      disposed = true
      listeners.clear()
    }

    return Object.freeze({
      getState,
      getSnapshot,
      snapshot: getSnapshot,
      getGraphSnapshot,
      getGeneratorOutput,
      getGeneratorSettings,
      subscribe,
      patchProject,
      patchSettings,
      replaceGraph,
      mutateGraph,
      addGraphNode,
      addNode: addGraphNode,
      patchGraphNode,
      updateGraphNode: patchGraphNode,
      updateNode: patchGraphNode,
      removeGraphNode,
      removeNode: removeGraphNode,
      connectGraph,
      connect: connectGraph,
      removeGraphEdge,
      removeEdge: removeGraphEdge,
      disconnectGraph: removeGraphEdge,
      recordResultLineage,
      addDataUrls,
      addImportedFiles,
      toggleReference,
      getReferenceResources: referenceResources,
      setSelectedResource,
      selectResource: setSelectedResource,
      setSelectedResult,
      selectResult: setSelectedResult,
      patchResource,
      updateResource: patchResource,
      patchResult,
      updateResult: patchResult,
      syncSharedResources,
      removeSharedResource,
      addResult,
      remove,
      removeResource,
      removeResult,
      serialize: serializeProject,
      serializeProject,
      serializeProjectGeometry,
      serializeJson,
      destroy,
    })
  }

  return Object.freeze({
    SERIAL_VERSION,
    GRAPH_SCHEMA_VERSION,
    GRAPH_NODE_TYPES,
    MAX_REFERENCES,
    MAX_GENERATOR_GRAPH_REFERENCES,
    normalizeGeneratorOutput,
    normalizeGeneratorSettings,
    generatorOutputFromNode,
    generatorSettingsFromNode,
    createStore: createProjectStore,
    createProjectStore,
  })
})
