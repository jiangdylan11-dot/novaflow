(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignStructureTool = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const DEFAULT_PROJECT_WIDTH = 1920
  const DEFAULT_PROJECT_HEIGHT = 1080
  const MIN_PROJECT_SIZE = 320
  const MAX_PROJECT_SIZE = 8192
  const MIN_BLOCK_WIDTH = 32
  const MIN_BLOCK_HEIGHT = 24
  const GRAPH_SCHEMA_VERSION = 3
  const GRAPH_GENERATOR_REFERENCE_LIMIT = 15
  const GRAPH_NODE_TYPES = Object.freeze(['reference', 'layout', 'generator', 'result'])
  const GRAPH_NODE_DEFAULTS = Object.freeze({
    reference: Object.freeze({ width: 260, height: 240, title: '参考图' }),
    layout: Object.freeze({ width: 360, height: 280, title: '页面结构' }),
    generator: Object.freeze({ width: 360, height: 260, title: 'UI 生成器' }),
    result: Object.freeze({ width: 320, height: 260, title: '生成结果' }),
  })

  function text(value, fallback = '') {
    const normalized = String(value == null ? '' : value).trim()
    return normalized || fallback
  }

  function number(value, fallback) {
    const normalized = Number(value)
    return Number.isFinite(normalized) ? normalized : fallback
  }

  function isFiniteNumericValue(value) {
    return value !== null
      && value !== undefined
      && typeof value !== 'boolean'
      && (typeof value !== 'string' || value.trim().length > 0)
      && Number.isFinite(Number(value))
  }

  function normalizedBlockSource(blockValue) {
    const block = isObject(blockValue) ? blockValue : {}
    return [
      block.xNorm ?? block.leftNorm,
      block.yNorm ?? block.topNorm,
      block.wNorm ?? block.widthNorm,
      block.hNorm ?? block.heightNorm,
    ]
  }

  function hasNormalizedBlockGeometry(blockValue) {
    return normalizedBlockSource(blockValue).every(isFiniteNumericValue)
  }

  function integer(value, fallback) {
    return Math.round(number(value, fallback))
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value))
  }

  function boolean(value, fallback) {
    if (value === true || value === false) return value
    if (value === 'true' || value === '1' || value === 1) return true
    if (value === 'false' || value === '0' || value === 0) return false
    return fallback
  }

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

  function outputSources(value) {
    const source = isObject(value) ? value : {}
    return [source.output, source.canvasSize, source.canvas, source]
      .filter(isObject)
  }

  function outputDimension(sources, names, fallback) {
    for (const source of sources) {
      for (const name of names) {
        const value = Number(source[name])
        if (Number.isFinite(value) && value > 0) {
          return clamp(Math.round(value), MIN_PROJECT_SIZE, MAX_PROJECT_SIZE)
        }
      }
    }
    return fallback
  }

  function normalizeGeneratorOutput(value, fallback) {
    const fallbackSources = outputSources(fallback)
    const fallbackWidth = outputDimension(fallbackSources, ['width', 'w'], DEFAULT_PROJECT_WIDTH)
    const fallbackHeight = outputDimension(fallbackSources, ['height', 'h'], DEFAULT_PROJECT_HEIGHT)
    const sources = outputSources(value)
    return {
      width: outputDimension(sources, ['width', 'w'], fallbackWidth),
      height: outputDimension(sources, ['height', 'h'], fallbackHeight),
    }
  }

  function normalizeGeneratorSettings(value, fallback) {
    const fallbackSettings = isObject(fallback) ? cloneSerializable(fallback) : {}
    const source = isObject(value) ? cloneSerializable(value) : {}
    const settings = { ...fallbackSettings, ...source }
    // Output dimensions have their own canonical home at generator.data.output.
    // Legacy values are read by generatorOutputFromNode before this object is
    // normalized, but are not written back into generationSettings.
    delete settings.output
    delete settings.width
    delete settings.height
    delete settings.w
    delete settings.h
    delete settings.canvas
    delete settings.canvasSize
    return settings
  }

  function hasOutputDimensions(value) {
    return outputSources(value).some((source) => ['width', 'w', 'height', 'h'].some((name) => {
      const dimension = Number(source[name])
      return Number.isFinite(dimension) && dimension > 0
    }))
  }

  function generatorOutputFromNode(nodeValue, fallback) {
    const node = isObject(nodeValue) ? nodeValue : {}
    const data = isObject(node.data) ? node.data : {}
    const legacySettings = isObject(data.generationSettings) ? data.generationSettings : {}
    const legacyDirect = normalizeGeneratorOutput(legacySettings, fallback)
    const legacyNested = normalizeGeneratorOutput(legacySettings.output, legacyDirect)
    // Deliberately inspect only node.data. node.width/node.height are editor-card
    // dimensions and must never become generation output dimensions.
    return normalizeGeneratorOutput(data.output, legacyNested)
  }

  function generatorSettingsFromNode(nodeValue, fallback) {
    const node = isObject(nodeValue) ? nodeValue : {}
    const data = isObject(node.data) ? node.data : {}
    return normalizeGeneratorSettings(data.generationSettings, fallback)
  }

  function normalizedBlockBounds(blockValue, sourceSize) {
    const block = isObject(blockValue) ? blockValue : {}
    const source = normalizeGeneratorOutput(sourceSize)
    const normalizedSource = normalizedBlockSource(block)
    const hasNormalized = normalizedSource.every(isFiniteNumericValue)
    const [rawX, rawY, rawWidth, rawHeight] = hasNormalized
      ? normalizedSource.map(Number)
      : [NaN, NaN, NaN, NaN]
    const x = clamp(hasNormalized ? rawX : number(block.x, 0) / source.width, 0, 1)
    const y = clamp(hasNormalized ? rawY : number(block.y, 0) / source.height, 0, 1)
    const width = clamp(hasNormalized ? rawWidth : number(block.width, 1) / source.width, 0, 1 - x)
    const height = clamp(hasNormalized ? rawHeight : number(block.height, 1) / source.height, 0, 1 - y)
    return { x, y, width, height }
  }

  function mapLayoutBlocksToOutput(blockValues, sourceSize, outputSize) {
    const output = normalizeGeneratorOutput(outputSize, sourceSize)
    return (Array.isArray(blockValues) ? blockValues : []).map((blockValue) => {
      const block = isObject(blockValue) ? cloneSerializable(blockValue) : {}
      const bounds = normalizedBlockBounds(block, sourceSize)
      return {
        ...block,
        x: Math.round(bounds.x * output.width),
        y: Math.round(bounds.y * output.height),
        width: Math.max(1, Math.round(bounds.width * output.width)),
        height: Math.max(1, Math.round(bounds.height * output.height)),
        xNorm: Number(bounds.x.toFixed(6)),
        yNorm: Number(bounds.y.toFixed(6)),
        wNorm: Number(bounds.width.toFixed(6)),
        hNorm: Number(bounds.height.toFixed(6)),
      }
    })
  }

  function uniqueId(prefix, requestedId, usedIds) {
    const requested = text(requestedId)
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

  function normalizeLayoutBlocks(value) {
    const blocks = Array.isArray(value) ? value : []
    const usedIds = new Set()
    return blocks.map((item, index) => {
      const source = isObject(item) ? cloneSerializable(item) : {}
      const id = uniqueId('block', source.id, usedIds)
      const output = {
        ...source,
        id,
        kind: text(source.kind, 'region'),
        name: text(source.name, `矩形块 ${index + 1}`),
        purpose: text(source.purpose),
        requirements: text(source.requirements),
        x: number(source.x, 0),
        y: number(source.y, 0),
        width: Math.max(Number.EPSILON, number(source.width, 0.25)),
        height: Math.max(Number.EPSILON, number(source.height, 0.2)),
        zIndex: integer(source.zIndex, index + 1),
        locked: boolean(source.locked, false),
        participates: boolean(source.participates, true),
      }
      delete output.dataUrl
      delete output.imageDataUrl
      return output
    })
  }

  function normalizeNodeType(value) {
    const type = text(value).toLowerCase()
    return GRAPH_NODE_TYPES.includes(type) ? type : ''
  }

  function normalizeGraphNode(value, index = 0, usedIds = new Set()) {
    const source = isObject(value) ? value : {}
    const type = normalizeNodeType(source.type || source.kind)
    if (!type) return null
    const defaults = GRAPH_NODE_DEFAULTS[type]
    const position = isObject(source.position) ? source.position : {}
    const rawData = isObject(source.data) ? source.data : {}
    const data = {}

    if (type === 'reference') {
      data.resourceId = text(rawData.resourceId || source.resourceId)
      data.role = text(rawData.role || source.role, 'reference')
      if (!data.resourceId) return null
    } else if (type === 'result') {
      data.resultId = text(rawData.resultId || source.resultId)
      const sourceNodeId = text(rawData.sourceNodeId || source.sourceNodeId)
      if (sourceNodeId) data.sourceNodeId = sourceNodeId
      if (!data.resultId) return null
    } else if (type === 'layout') {
      data.description = text(rawData.description ?? source.description)
      data.blocks = normalizeLayoutBlocks(rawData.blocks || source.blocks)
      const rawAnalysisSource = isObject(rawData.analysisSource) ? rawData.analysisSource : null
      if (rawAnalysisSource) {
        if (text(rawData.analysisReview).toLowerCase() !== 'confirmed') return null
      }
      const rawCanvasSize = isObject(rawData.canvasSize) ? rawData.canvasSize : rawAnalysisSource
      if (rawCanvasSize) {
        const width = integer(rawCanvasSize.width ?? rawCanvasSize.sourceWidth, 0)
        const height = integer(rawCanvasSize.height ?? rawCanvasSize.sourceHeight, 0)
        if (width > 0 && height > 0) {
          data.canvasSize = { width, height }
          data.blocks = mapLayoutBlocksToOutput(data.blocks, data.canvasSize, data.canvasSize)
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
      id: uniqueId(type, source.id, usedIds),
      type,
      title: text(source.title || source.name, defaults.title),
      position: {
        x: number(position.x, number(source.x, index * 36)),
        y: number(position.y, number(source.y, index * 36)),
      },
      width: Math.max(120, number(source.width, defaults.width)),
      height: Math.max(80, number(source.height, defaults.height)),
      data,
    }
  }

  function defaultOutputPort(type) {
    if (type === 'layout') return 'layout'
    if (type === 'generator') return 'result'
    return 'reference'
  }

  function defaultInputPort(type, kind) {
    if (type === 'generator') {
      if (kind === 'layout') return 'layout'
      if (kind === 'iteration') return 'iteration'
      return 'reference'
    }
    if (type === 'result') return 'result'
    return 'reference'
  }

  function canonicalPort(nodeType, direction, value, kind) {
    const requested = text(value).toLowerCase()
    const aliases = {
      image: 'reference',
      input: defaultInputPort(nodeType, kind),
      in: defaultInputPort(nodeType, kind),
      output: defaultOutputPort(nodeType),
      out: defaultOutputPort(nodeType),
    }
    return aliases[requested] || requested || (direction === 'from'
      ? defaultOutputPort(nodeType)
      : defaultInputPort(nodeType, kind))
  }

  function connectionRule(fromType, fromPort, toType, toPort) {
    const key = `${fromType}:${fromPort}>${toType}:${toPort}`
    const rules = {
      'layout:layout>generator:layout': { kind: 'layout', maximum: 1, group: 'generator-layout' },
      'reference:reference>generator:reference': { kind: 'reference', maximum: GRAPH_GENERATOR_REFERENCE_LIMIT, group: 'generator-reference' },
      'generator:result>result:result': { kind: 'result', maximum: 1, group: 'result-source' },
      'result:reference>generator:reference': { kind: 'reference', maximum: GRAPH_GENERATOR_REFERENCE_LIMIT, group: 'generator-reference' },
      'result:reference>generator:iteration': { kind: 'iteration', maximum: 1, group: 'generator-iteration' },
    }
    return rules[key] || null
  }

  function normalizeGraphLineage(value) {
    const entries = Array.isArray(value)
      ? value
      : (isObject(value) ? Object.keys(value).map((resultId) => ({ resultId, ...value[resultId] })) : [])
    const usedResultIds = new Set()
    return entries.reduce((output, item) => {
      const source = isObject(item) ? item : {}
      const resultId = text(source.resultId)
      if (!resultId || usedResultIds.has(resultId)) return output
      usedResultIds.add(resultId)
      const entry = {
        resultId,
        generatorNodeId: text(source.generatorNodeId),
        resultNodeId: text(source.resultNodeId),
        layoutNodeId: text(source.layoutNodeId),
        parentResultIds: Array.from(new Set((Array.isArray(source.parentResultIds) ? source.parentResultIds : []).map((id) => text(id)).filter(Boolean))),
        referenceResourceIds: Array.from(new Set((Array.isArray(source.referenceResourceIds) ? source.referenceResourceIds : []).map((id) => text(id)).filter(Boolean))),
      }
      const createdAt = text(source.createdAt)
      if (createdAt) entry.createdAt = createdAt
      output.push(entry)
      return output
    }, [])
  }

  function graphInput(value) {
    if (isObject(value) && isObject(value.graph)) return value.graph
    return isObject(value) ? value : {}
  }

  function validateConnection(graphValue, edgeValue, options = {}) {
    const graph = graphInput(graphValue)
    const source = isObject(edgeValue) ? edgeValue : {}
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
    const edges = Array.isArray(graph.edges) ? graph.edges : []
    const fromNodeId = text(source.fromNodeId)
    const toNodeId = text(source.toNodeId)
    const fromNode = nodes.find((node) => node.id === fromNodeId)
    const toNode = nodes.find((node) => node.id === toNodeId)
    if (!fromNode || !toNode) return { ok: false, code: 'missing-node', error: '连接的节点不存在' }
    if (fromNodeId === toNodeId) return { ok: false, code: 'self-connection', error: '节点不能连接自身' }
    const requestedKind = text(source.kind).toLowerCase()
    const inferredKind = requestedKind
      || (fromNode.type === 'layout' ? 'layout' : '')
      || (fromNode.type === 'generator' ? 'result' : '')
      || 'reference'
    const fromPort = canonicalPort(fromNode.type, 'from', source.fromPort, inferredKind)
    const toPort = canonicalPort(toNode.type, 'to', source.toPort, inferredKind)
    const rule = connectionRule(fromNode.type, fromPort, toNode.type, toPort)
    if (!rule) return { ok: false, code: 'incompatible-ports', error: '这两个端口不能连接' }
    if (requestedKind && requestedKind !== rule.kind) return { ok: false, code: 'invalid-kind', error: '连接类型与端口不匹配' }
    const ignoredEdgeId = text(options.ignoreEdgeId)
    const activeEdges = edges.filter((edge) => edge.id !== ignoredEdgeId)
    const duplicate = activeEdges.some((edge) => edge.fromNodeId === fromNodeId
      && edge.fromPort === fromPort
      && edge.toNodeId === toNodeId
      && edge.toPort === toPort)
    if (duplicate) return { ok: false, code: 'duplicate-edge', error: '节点已经连接' }
    const incomingCount = activeEdges.reduce((count, edge) => {
      if (edge.toNodeId !== toNodeId) return count
      const edgeFrom = nodes.find((node) => node.id === edge.fromNodeId)
      const edgeTo = nodes.find((node) => node.id === edge.toNodeId)
      if (!edgeFrom || !edgeTo) return count
      const edgeRule = connectionRule(edgeFrom.type, edge.fromPort, edgeTo.type, edge.toPort)
      return edgeRule && edgeRule.group === rule.group ? count + 1 : count
    }, 0)
    const requestedExternalLimit = Number(options.externalReferenceLimit)
    const externalReferenceLimit = Number.isFinite(requestedExternalLimit)
      ? clamp(Math.round(requestedExternalLimit), 0, GRAPH_GENERATOR_REFERENCE_LIMIT)
      : GRAPH_GENERATOR_REFERENCE_LIMIT
    if (toNode.type === 'generator' && (rule.kind === 'reference' || rule.kind === 'iteration')) {
      const externalIncomingCount = activeEdges.filter((edge) => (
        edge.toNodeId === toNodeId && (edge.kind === 'reference' || edge.kind === 'iteration')
      )).length
      if (externalIncomingCount >= externalReferenceLimit) {
        return {
          ok: false,
          code: 'provider-reference-limit',
          error: `当前模型最多连接 ${externalReferenceLimit} 张外部参考图`,
        }
      }
    }
    if (incomingCount >= rule.maximum) {
      return { ok: false, code: 'port-limit', error: '该输入端口已达到连接上限' }
    }
    return {
      ok: true,
      edge: {
        fromNodeId,
        fromPort,
        toNodeId,
        toPort,
        kind: rule.kind,
      },
    }
  }

  function stableEdgeBase(edge) {
    return `edge_${edge.fromNodeId}_${edge.fromPort}_${edge.toNodeId}_${edge.toPort}`
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
  }

  function normalizeGraph(value, options = {}) {
    const source = graphInput(value)
    const usedNodeIds = new Set()
    const sourceNodes = Array.isArray(source.nodes) ? source.nodes : []
    const nodes = sourceNodes
      .map((node, index) => normalizeGraphNode(node, index, usedNodeIds))
      .filter(Boolean)
    const legacyBlocks = Array.isArray(options.legacyBlocks)
      ? options.legacyBlocks
      : (Array.isArray(value && value.blocks) ? value.blocks : [])
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
    ;(Array.isArray(source.edges) ? source.edges : []).forEach((candidate) => {
      const validated = validateConnection(graph, candidate)
      if (!validated.ok) return
      const edge = validated.edge
      edge.id = uniqueId(stableEdgeBase(edge), candidate && candidate.id, usedEdgeIds)
      graph.edges.push(edge)
    })
    return graph
  }

  function createGraphNode(graphValue, nodeValue = {}) {
    const graph = normalizeGraph(graphValue)
    const usedIds = new Set(graph.nodes.map((node) => node.id))
    const node = normalizeGraphNode(nodeValue, graph.nodes.length, usedIds)
    if (!node) return { ok: false, graph, code: 'invalid-node', error: '节点类型或资源标识无效' }
    const nextGraph = normalizeGraph({ ...graph, nodes: graph.nodes.concat(node) })
    return { ok: true, graph: nextGraph, node: nextGraph.nodes.find((item) => item.id === node.id) }
  }

  function updateGraphNode(graphValue, nodeId, patch = {}) {
    const graph = normalizeGraph(graphValue)
    const id = text(nodeId)
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
    const usedIds = new Set()
    const node = normalizeGraphNode(merged, graph.nodes.indexOf(current), usedIds)
    if (!node) return { ok: false, graph, code: 'invalid-node', error: '节点数据无效' }
    node.id = current.id
    const nextGraph = normalizeGraph({
      ...graph,
      nodes: graph.nodes.map((item) => item.id === id ? node : item),
    })
    return { ok: true, graph: nextGraph, node: nextGraph.nodes.find((item) => item.id === id) }
  }

  function removeGraphNode(graphValue, nodeId) {
    const graph = normalizeGraph(graphValue)
    const id = text(nodeId)
    if (!graph.nodes.some((node) => node.id === id)) {
      return { ok: false, graph, code: 'missing-node', error: '节点不存在' }
    }
    const removedResultIds = new Set(graph.nodes
      .filter((node) => node.id === id && node.type === 'result')
      .map((node) => node.data.resultId))
    const nextGraph = normalizeGraph({
      ...graph,
      nodes: graph.nodes.filter((node) => node.id !== id),
      edges: graph.edges.filter((edge) => edge.fromNodeId !== id && edge.toNodeId !== id),
      lineage: graph.lineage.filter((entry) => !removedResultIds.has(entry.resultId)
        && entry.generatorNodeId !== id
        && entry.resultNodeId !== id),
    })
    return { ok: true, graph: nextGraph, removedNodeId: id }
  }

  function connectGraph(graphValue, edgeValue = {}, options = {}) {
    const graph = normalizeGraph(graphValue)
    const validated = validateConnection(graph, edgeValue, options)
    if (!validated.ok) return { ...validated, graph }
    const usedIds = new Set(graph.edges.map((edge) => edge.id))
    const edge = {
      ...validated.edge,
      id: uniqueId(stableEdgeBase(validated.edge), edgeValue.id, usedIds),
    }
    const nextGraph = normalizeGraph({ ...graph, edges: graph.edges.concat(edge) })
    return { ok: true, graph: nextGraph, edge: nextGraph.edges.find((item) => item.id === edge.id) }
  }

  function removeGraphEdge(graphValue, edgeId) {
    const graph = normalizeGraph(graphValue)
    const id = text(edgeId)
    if (!graph.edges.some((edge) => edge.id === id)) {
      return { ok: false, graph, code: 'missing-edge', error: '连接不存在' }
    }
    return {
      ok: true,
      graph: normalizeGraph({ ...graph, edges: graph.edges.filter((edge) => edge.id !== id) }),
      removedEdgeId: id,
    }
  }

  function graphSnapshot(graphValue) {
    return cloneSerializable(normalizeGraph(graphValue))
  }

  function uniqueBlockId(requestedId, usedIds, index) {
    const requested = text(requestedId)
    if (requested && !usedIds.has(requested)) {
      usedIds.add(requested)
      return requested
    }
    let suffix = Math.max(1, integer(index, 0) + 1)
    let candidate = `block_${suffix}`
    while (usedIds.has(candidate)) {
      suffix += 1
      candidate = `block_${suffix}`
    }
    usedIds.add(candidate)
    return candidate
  }

  function normalizeBlock(value, index, projectSize, usedIds) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const projectWidth = projectSize.width
    const projectHeight = projectSize.height
    const hasNormalizedGeometry = hasNormalizedBlockGeometry(source)
    const normalized = hasNormalizedGeometry ? normalizedBlockBounds(source, projectSize) : null
    const x = clamp(
      hasNormalizedGeometry ? Math.round(normalized.x * projectWidth) : integer(source.x, 0),
      0,
      Math.max(0, projectWidth - MIN_BLOCK_WIDTH),
    )
    const y = clamp(
      hasNormalizedGeometry ? Math.round(normalized.y * projectHeight) : integer(source.y, 0),
      0,
      Math.max(0, projectHeight - MIN_BLOCK_HEIGHT),
    )
    const width = clamp(
      hasNormalizedGeometry
        ? Math.round(normalized.width * projectWidth)
        : integer(source.width, Math.min(360, projectWidth)),
      MIN_BLOCK_WIDTH,
      Math.max(MIN_BLOCK_WIDTH, projectWidth - x),
    )
    const height = clamp(
      hasNormalizedGeometry
        ? Math.round(normalized.height * projectHeight)
        : integer(source.height, Math.min(180, projectHeight)),
      MIN_BLOCK_HEIGHT,
      Math.max(MIN_BLOCK_HEIGHT, projectHeight - y),
    )
    const id = uniqueBlockId(source.id, usedIds, index)
    const block = {
      id,
      kind: text(source.kind, 'region'),
      name: text(source.name, `矩形块 ${index + 1}`),
      purpose: text(source.purpose),
      requirements: text(source.requirements),
      x,
      y,
      width,
      height,
      zIndex: integer(source.zIndex, index + 1),
      locked: boolean(source.locked, false),
      participates: boolean(source.participates, true),
    }
    if (hasNormalizedGeometry) {
      block.xNorm = Number((x / projectWidth).toFixed(6))
      block.yNorm = Number((y / projectHeight).toFixed(6))
      block.wNorm = Number((width / projectWidth).toFixed(6))
      block.hNorm = Number((height / projectHeight).toFixed(6))
    }
    return block
  }

  function normalize(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const width = clamp(integer(source.width, DEFAULT_PROJECT_WIDTH), MIN_PROJECT_SIZE, MAX_PROJECT_SIZE)
    const height = clamp(integer(source.height, DEFAULT_PROJECT_HEIGHT), MIN_PROJECT_SIZE, MAX_PROJECT_SIZE)
    const sourceGraph = normalizeGraph(source.graph, {
      legacyBlocks: Array.isArray(source.blocks) ? source.blocks : [],
    })
    const sourceLayout = sourceGraph.nodes.find((node) => node.type === 'layout')
    const coordinateCanvas = isObject(sourceLayout?.data?.canvasSize) ? sourceLayout.data.canvasSize : null
    const coordinateWidth = integer(coordinateCanvas?.width, 0)
    const coordinateHeight = integer(coordinateCanvas?.height, 0)
    const blockCanvas = coordinateWidth > 0 && coordinateHeight > 0
      ? { width: coordinateWidth, height: coordinateHeight }
      : { width, height }
    const sourceBlocks = sourceLayout ? sourceLayout.data.blocks : []
    const usedIds = new Set()
    const blocks = sourceBlocks
      .map((block, index) => normalizeBlock(block, index, blockCanvas, usedIds))
    let graph = sourceGraph
    const layout = sourceLayout && graph.nodes.find((node) => node.id === sourceLayout.id)
    if (layout) {
      const updated = updateGraphNode(graph, layout.id, { data: { ...layout.data, blocks } })
      if (updated.ok) graph = updated.graph
    } else if (blocks.length) {
      const created = createGraphNode(graph, {
        id: 'layout_1',
        type: 'layout',
        title: '页面结构',
        position: { x: 0, y: 0 },
        data: { blocks },
      })
      if (created.ok) graph = created.graph
    }
    return {
      id: text(source.id, 'ui-project'),
      title: text(source.title, '未命名 UI'),
      width,
      height,
      blocks,
      graph,
    }
  }

  function nextBlockId(project) {
    const ids = new Set(project.blocks.map((block) => block.id))
    let suffix = 1
    while (ids.has(`block_${suffix}`)) suffix += 1
    return `block_${suffix}`
  }

  function replaceLayoutBlocks(project, blocks) {
    let graph = normalizeGraph(project.graph)
    const layout = graph.nodes.find((node) => node.type === 'layout')
    if (layout) {
      const updated = updateGraphNode(graph, layout.id, { data: { ...layout.data, blocks } })
      if (updated.ok) graph = updated.graph
    } else if (blocks.length) {
      const created = createGraphNode(graph, {
        id: 'layout_1',
        type: 'layout',
        title: '页面结构',
        position: { x: 0, y: 0 },
        data: { blocks },
      })
      if (created.ok) graph = created.graph
    }
    return normalize({ ...project, blocks, graph })
  }

  function create(projectValue, blockValue = {}) {
    const project = normalize(projectValue)
    const source = blockValue && typeof blockValue === 'object' && !Array.isArray(blockValue) ? blockValue : {}
    const defaultWidth = Math.min(360, Math.max(MIN_BLOCK_WIDTH, Math.round(project.width * 0.45)))
    const defaultHeight = Math.min(180, Math.max(MIN_BLOCK_HEIGHT, Math.round(project.height * 0.25)))
    const maxZ = project.blocks.reduce((highest, block) => Math.max(highest, block.zIndex), 0)
    const block = {
      id: nextBlockId(project),
      kind: 'region',
      name: `矩形块 ${project.blocks.length + 1}`,
      purpose: '',
      requirements: '',
      x: Math.round((project.width - defaultWidth) / 2),
      y: Math.round((project.height - defaultHeight) / 2),
      width: defaultWidth,
      height: defaultHeight,
      zIndex: maxZ + 1,
      locked: false,
      participates: true,
      ...source,
    }
    if (!text(source.id)) block.id = nextBlockId(project)
    return replaceLayoutBlocks(project, [...project.blocks, block])
  }

  function update(projectValue, blockId, patch = {}) {
    const project = normalize(projectValue)
    const id = text(blockId)
    if (!id) return project
    const sourcePatch = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
    let found = false
    const blocks = project.blocks.map((block) => {
      if (block.id !== id) return block
      found = true
      return { ...block, ...sourcePatch, id: block.id }
    })
    return found ? replaceLayoutBlocks(project, blocks) : project
  }

  function remove(projectValue, blockId) {
    const project = normalize(projectValue)
    const id = text(blockId)
    if (!id) return project
    return replaceLayoutBlocks(project, project.blocks.filter((block) => block.id !== id))
  }

  function find(projectValue, blockId) {
    const project = normalize(projectValue)
    const id = text(blockId)
    return project.blocks.find((block) => block.id === id) || null
  }

  return Object.freeze({
    DEFAULT_PROJECT_WIDTH,
    DEFAULT_PROJECT_HEIGHT,
    MIN_PROJECT_SIZE,
    MAX_PROJECT_SIZE,
    MIN_BLOCK_WIDTH,
    MIN_BLOCK_HEIGHT,
    GRAPH_SCHEMA_VERSION,
    GRAPH_GENERATOR_REFERENCE_LIMIT,
    GRAPH_NODE_TYPES,
    normalizeGeneratorOutput,
    normalizeGeneratorSettings,
    generatorOutputFromNode,
    generatorSettingsFromNode,
    hasNormalizedBlockGeometry,
    normalizedBlockBounds,
    mapLayoutBlocksToOutput,
    normalizeLayoutBlocksForOutput: mapLayoutBlocksToOutput,
    normalize,
    create,
    update,
    remove,
    find,
    normalizeProject: normalize,
    createBlock: create,
    updateBlock: update,
    removeBlock: remove,
    normalizeGraph,
    normalizeNode: normalizeGraphNode,
    normalizeGraphNode,
    validateConnection,
    createGraphNode,
    addGraphNode: createGraphNode,
    addNode: createGraphNode,
    updateGraphNode,
    patchGraphNode: updateGraphNode,
    updateNode: updateGraphNode,
    removeGraphNode,
    removeNode: removeGraphNode,
    connectGraph,
    connect: connectGraph,
    removeGraphEdge,
    disconnectGraph: removeGraphEdge,
    disconnect: removeGraphEdge,
    snapshotGraph: graphSnapshot,
    graphSnapshot,
  })
})
