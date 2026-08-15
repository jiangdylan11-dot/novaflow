const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const repoRoot = path.resolve(__dirname, '..', '..')
const structurePath = path.join(repoRoot, 'particle-editor', 'ui-design.structure.tool.js')
const resourcePath = path.join(repoRoot, 'particle-editor', 'ui-design.project.resource.js')
const IMAGE = 'data:image/png;base64,iVBORw0KGgo='

function loadApi(filePath, root) {
  const source = fs.readFileSync(filePath, 'utf8')
  const localModule = { exports: {} }
  Function('module', 'exports', 'globalThis', source)(localModule, localModule.exports, root)
  return localModule.exports
}

function loadGraphApis() {
  const root = { Buffer }
  const structure = loadApi(structurePath, root)
  const resource = loadApi(resourcePath, root)
  return { root, structure, resource }
}

function node(id, type, x, y, data = {}) {
  return { id, type, position: { x, y }, data }
}

test('current graph schema migrates legacy blocks while graph nodes keep infinite-world coordinates', () => {
  const { structure, resource } = loadGraphApis()
  const legacyBlock = {
    id: 'hero', name: 'Hero', x: 120, y: 80, width: 900, height: 420,
    xNorm: '', yNorm: ' ', wNorm: null, hNorm: false,
  }
  const normalized = structure.normalize({ id: 'legacy', width: 1920, height: 1080, blocks: [legacyBlock] })

  assert.equal(normalized.blocks.length, 1)
  assert.equal(normalized.graph.schemaVersion, structure.GRAPH_SCHEMA_VERSION)
  assert.equal(normalized.graph.nodes.length, 1)
  assert.equal(normalized.graph.nodes[0].type, 'layout')
  assert.deepEqual(normalized.graph.nodes[0].data.blocks.map((block) => block.id), ['hero'])
  assert.deepEqual(
    normalized.blocks.map(({ x, y, width, height }) => ({ x, y, width, height })),
    [{ x: 120, y: 80, width: 900, height: 420 }],
    'blank legacy norm fields must not override absolute geometry',
  )
  assert.equal(structure.hasNormalizedBlockGeometry(legacyBlock), false)

  const store = resource.createStore({ project: normalized })
  const added = store.addGraphNode(node('reference-a', 'reference', -1800, -640, {
    resourceId: 'resource-a',
    role: 'layout',
    dataUrl: IMAGE,
  }))
  assert.equal(added.ok, true)
  assert.deepEqual(added.node.position, { x: -1800, y: -640 })
  assert.deepEqual(added.node.data, { resourceId: 'resource-a', role: 'layout' })
  assert.equal(Object.prototype.hasOwnProperty.call(added.node.data, 'dataUrl'), false)

  store.patchProject({ blocks: [{ ...legacyBlock, name: 'Primary hero' }] })
  assert.equal(store.getState().project.blocks[0].name, 'Primary hero')
  assert.equal(store.getState().graph.nodes.find((item) => item.type === 'layout').data.blocks[0].name, 'Primary hero')
})

test('layout page target and block requirements survive graph and project serialization', () => {
  const { structure, resource } = loadGraphApis()
  const graph = structure.normalizeGraph({
    schemaVersion: 2,
    nodes: [node('layout-a', 'layout', 0, 0, {
      description: '竖屏角色装备管理页面',
      blocks: [{
        id: 'hero',
        purpose: '展示当前角色与装备槽位',
        requirements: '角色主体保持完整，装备槽位清晰可读',
        x: 80,
        y: 120,
        width: 760,
        height: 1080,
      }],
    })],
  })
  assert.equal(graph.nodes[0].data.description, '竖屏角色装备管理页面')
  assert.equal(graph.nodes[0].data.blocks[0].requirements, '角色主体保持完整，装备槽位清晰可读')

  const store = resource.createStore({ project: { width: 900, height: 1600, graph } })
  const patched = store.patchGraphNode('layout-a', { data: { description: '竖屏角色养成与装备页面' } })
  assert.equal(patched.ok, true)
  const payload = store.serializeProject()
  const serializedLayout = payload.project.graph.nodes.find((item) => item.id === 'layout-a')
  assert.equal(serializedLayout.data.description, '竖屏角色养成与装备页面')
  assert.equal(serializedLayout.data.blocks[0].requirements, '角色主体保持完整，装备槽位清晰可读')

  const restored = resource.createStore(JSON.parse(JSON.stringify(payload)))
  const restoredLayout = restored.getState().graph.nodes.find((item) => item.id === 'layout-a')
  assert.equal(restoredLayout.data.description, '竖屏角色养成与装备页面')
  assert.equal(restoredLayout.data.blocks[0].requirements, '角色主体保持完整，装备槽位清晰可读')
})

test('legacy pending layouts are removed without reviving stale top-level blocks', () => {
  const { structure } = loadGraphApis()
  const analysisSource = {
    referenceNodeId: 'reference-a', resourceId: 'resource-a', sourceWidth: 1080, sourceHeight: 1920,
  }
  const migrated = structure.normalize({
    width: 1080,
    height: 1920,
    blocks: [{ id: 'legacy-leak', x: 0, y: 0, width: 1080, height: 1920 }],
    graph: {
      schemaVersion: 2,
      nodes: [
        node('reference-a', 'reference', -400, 0, { resourceId: 'resource-a' }),
        node('layout-pending', 'layout', 0, 0, { blocks: [{ id: 'pending' }], analysisSource, analysisReview: 'pending' }),
        node('layout-missing-review', 'layout', 400, 0, { blocks: [{ id: 'missing' }], analysisSource }),
        node('layout-invalid-review', 'layout', 800, 0, { blocks: [{ id: 'invalid' }], analysisSource, analysisReview: 'unknown' }),
      ],
      edges: [
        { id: 'edge-analysis', fromNodeId: 'reference-a', fromPort: 'reference', toNodeId: 'layout-pending', toPort: 'reference', kind: 'reference' },
      ],
    },
  })

  assert.equal(migrated.graph.schemaVersion, structure.GRAPH_SCHEMA_VERSION)
  assert.deepEqual(migrated.graph.nodes.map((item) => item.id), ['reference-a'])
  assert.deepEqual(migrated.graph.edges, [])
  assert.deepEqual(migrated.blocks, [], 'legacy top-level blocks must not resurrect a deleted machine draft')
  assert.doesNotMatch(JSON.stringify(migrated), /analysisSource|analysisReview/)
})

test('legacy pending layout removal keeps a manual layout authoritative', () => {
  const { structure, resource } = loadGraphApis()
  const analysisSource = {
    referenceNodeId: 'reference-a', resourceId: 'resource-a', sourceWidth: 1080, sourceHeight: 1920,
  }
  const project = {
    id: 'mixed-layout-project',
    width: 1080,
    height: 1920,
    blocks: [{ id: 'stale-mirror', x: 0, y: 0, width: 1080, height: 1920 }],
    graph: {
      schemaVersion: 2,
      nodes: [
        node('reference-a', 'reference', -400, 0, { resourceId: 'resource-a' }),
        node('layout-draft', 'layout', 0, 0, {
          blocks: [{ id: 'draft-main', x: 0, y: 0, width: 1080, height: 1920 }],
          analysisSource,
          analysisReview: 'pending',
        }),
        node('layout-manual', 'layout', 500, 0, {
          blocks: [{ id: 'manual-panel', x: 100, y: 120, width: 800, height: 600 }],
        }),
        node('generator-a', 'generator', 1000, 0),
      ],
      edges: [
        { id: 'edge-analysis', fromNodeId: 'reference-a', fromPort: 'reference', toNodeId: 'layout-draft', toPort: 'reference', kind: 'reference' },
        { id: 'edge-manual', fromNodeId: 'layout-manual', fromPort: 'layout', toNodeId: 'generator-a', toPort: 'layout', kind: 'layout' },
        { id: 'edge-reference', fromNodeId: 'reference-a', fromPort: 'reference', toNodeId: 'generator-a', toPort: 'reference', kind: 'reference' },
      ],
    },
  }

  const normalized = structure.normalize(project)
  assert.deepEqual(normalized.blocks.map((block) => block.id), ['manual-panel'])
  assert.equal(normalized.graph.nodes.some((item) => item.id === 'layout-draft'), false)
  assert.deepEqual(normalized.graph.edges.map((edge) => edge.id), ['edge-manual', 'edge-reference'])

  const sourceStore = resource.createStore({
    resources: [{ id: 'resource-a', name: 'reference.png', dataUrl: IMAGE, isReference: true }],
    referenceIds: ['resource-a'],
    project,
  })
  assert.deepEqual(sourceStore.getState().project.blocks.map((block) => block.id), ['manual-panel'])
  assert.doesNotMatch(JSON.stringify(sourceStore.serializeProject()), /analysisSource|analysisReview/)

  const fallbackResource = loadApi(resourcePath, { Buffer })
  const fallbackStore = fallbackResource.createStore({
    resources: [{ id: 'resource-a', name: 'reference.png', dataUrl: IMAGE, isReference: true }],
    referenceIds: ['resource-a'],
    project,
  })
  assert.deepEqual(fallbackStore.getState().project.blocks.map((block) => block.id), ['manual-panel'])
  assert.equal(fallbackStore.getState().graph.nodes.some((item) => item.id === 'layout-draft'), false)
})

test('confirmed portrait layouts migrate to a neutral canvas and round-trip idempotently', () => {
  const { structure, resource } = loadGraphApis()
  const legacyGraph = {
    schemaVersion: 2,
    nodes: [
      node('reference-a', 'reference', -400, 0, { resourceId: 'resource-a' }),
      node('layout-confirmed', 'layout', 0, 0, {
        description: 'Accepted portrait layout',
        blocks: [{ id: 'hero', x: 108, y: 192, width: 540, height: 960 }],
        analysisSource: {
          referenceNodeId: 'reference-a', resourceId: 'resource-a', sourceWidth: 1080, sourceHeight: 1920,
        },
        analysisReview: 'confirmed',
      }),
      node('generator-a', 'generator', 500, 0),
    ],
    edges: [
      { id: 'edge-analysis', fromNodeId: 'reference-a', fromPort: 'reference', toNodeId: 'layout-confirmed', toPort: 'reference', kind: 'reference' },
      { id: 'edge-layout', fromNodeId: 'layout-confirmed', fromPort: 'layout', toNodeId: 'generator-a', toPort: 'layout', kind: 'layout' },
      { id: 'edge-reference', fromNodeId: 'reference-a', fromPort: 'reference', toNodeId: 'generator-a', toPort: 'reference', kind: 'reference' },
    ],
  }

  const first = structure.normalizeGraph(legacyGraph)
  const layout = first.nodes.find((item) => item.id === 'layout-confirmed')
  assert.deepEqual(layout.data.canvasSize, { width: 1080, height: 1920 })
  assert.deepEqual(
    (({ xNorm, yNorm, wNorm, hNorm }) => ({ xNorm, yNorm, wNorm, hNorm }))(layout.data.blocks[0]),
    { xNorm: 0.1, yNorm: 0.1, wNorm: 0.5, hNorm: 0.5 },
  )
  assert.equal(Object.prototype.hasOwnProperty.call(layout.data, 'analysisSource'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(layout.data, 'analysisReview'), false)
  assert.deepEqual(first.edges.map((edge) => edge.id), ['edge-layout', 'edge-reference'])

  const second = structure.normalizeGraph(JSON.parse(JSON.stringify(first)))
  assert.deepEqual(second, first, 'legacy migration must be idempotent')

  const store = resource.createStore({
    resources: [{ id: 'resource-a', name: 'reference.png', dataUrl: IMAGE, isReference: true }],
    referenceIds: ['resource-a'],
    project: { width: 1024, height: 1024, graph: legacyGraph },
  })
  const payload = store.serializeProject()
  assert.doesNotMatch(JSON.stringify(payload), /analysisSource|analysisReview/)
  assert.deepEqual(payload.project.graph.nodes.find((item) => item.id === 'layout-confirmed').data.canvasSize, { width: 1080, height: 1920 })
  const restored = resource.createStore(JSON.parse(JSON.stringify(payload)))
  assert.deepEqual(restored.serializeProject(), payload)

  const fallbackResource = loadApi(resourcePath, { Buffer })
  const fallbackStore = fallbackResource.createStore({ project: { width: 1024, height: 1024, graph: legacyGraph } })
  const fallbackLayout = fallbackStore.getState().graph.nodes.find((item) => item.id === 'layout-confirmed')
  assert.deepEqual(fallbackLayout.data.canvasSize, { width: 1080, height: 1920 })
  assert.deepEqual(
    (({ xNorm, yNorm, wNorm, hNorm }) => ({ xNorm, yNorm, wNorm, hNorm }))(fallbackLayout.data.blocks[0]),
    { xNorm: 0.1, yNorm: 0.1, wNorm: 0.5, hNorm: 0.5 },
  )
  assert.doesNotMatch(JSON.stringify(fallbackStore.serializeProject()), /analysisSource|analysisReview/)
})

test('constrained ports accept the UI workflow and reject incompatible or over-limit edges', () => {
  const { structure } = loadGraphApis()
  let graph = structure.normalizeGraph({
    nodes: [
      node('reference-a', 'reference', -600, -200, { resourceId: 'resource-a', role: 'layout' }),
      node('reference-b', 'reference', -600, 100, { resourceId: 'resource-b', role: 'style' }),
      node('reference-c', 'reference', -600, 400, { resourceId: 'resource-c', role: 'style' }),
      node('layout-a', 'layout', -100, -100, { blocks: [] }),
      node('layout-b', 'layout', -100, 300, { blocks: [] }),
      node('generator-a', 'generator', 400, 0),
      node('result-a', 'result', 900, 0, { resultId: 'result-a', dataUrl: IMAGE }),
    ],
  })

  function connect(value, options) {
    const result = structure.connectGraph(graph, value, options)
    if (result.ok) graph = result.graph
    return result
  }

  assert.equal(connect({ fromNodeId: 'reference-a', toNodeId: 'layout-a' }).code, 'incompatible-ports')
  const layoutEdge = connect({ fromNodeId: 'layout-a', toNodeId: 'generator-a' })
  assert.equal(layoutEdge.ok, true)
  assert.equal(layoutEdge.edge.kind, 'layout')
  assert.equal(connect({ fromNodeId: 'layout-b', toNodeId: 'generator-a' }).code, 'port-limit')

  assert.equal(connect({ fromNodeId: 'reference-a', toNodeId: 'generator-a' }).ok, true)
  assert.equal(connect({ fromNodeId: 'reference-b', toNodeId: 'generator-a' }).ok, true)
  assert.equal(connect(
    { fromNodeId: 'reference-c', toNodeId: 'generator-a' },
    { externalReferenceLimit: 2 },
  ).code, 'provider-reference-limit')
  assert.equal(connect({ fromNodeId: 'reference-c', toNodeId: 'generator-a' }).ok, true, 'the persisted graph keeps the absolute GPT-sized capacity')
  assert.equal(connect({ fromNodeId: 'reference-a', toNodeId: 'result-a' }).code, 'incompatible-ports')

  const resultEdge = connect({ fromNodeId: 'generator-a', toNodeId: 'result-a' })
  assert.equal(resultEdge.ok, true)
  assert.equal(resultEdge.edge.kind, 'result')
  assert.match(resultEdge.edge.id, /^edge_/)
  assert.equal(connect({
    fromNodeId: 'result-a',
    fromPort: 'reference',
    toNodeId: 'generator-a',
    toPort: 'iteration',
    kind: 'iteration',
  }).ok, true)

  const roundTrip = structure.normalizeGraph(JSON.parse(JSON.stringify(graph)))
  assert.deepEqual(roundTrip.edges.map((edge) => edge.id), graph.edges.map((edge) => edge.id))
})

test('store snapshots are isolated and removing a node cascades its edges', () => {
  const { resource } = loadGraphApis()
  const store = resource.createStore()
  const reference = store.addGraphNode(node('reference-a', 'reference', -500, 0, { resourceId: 'resource-a' }))
  const layout = store.addGraphNode(node('layout-a', 'layout', 0, 0, { blocks: [] }))
  const generator = store.addGraphNode(node('generator-a', 'generator', 500, 0))
  assert.equal(reference.ok && layout.ok && generator.ok, true)
  assert.equal(store.connectGraph({ fromNodeId: reference.node.id, toNodeId: generator.node.id }).ok, true)

  const snapshot = store.getSnapshot()
  snapshot.graph.nodes[0].position.x = 999999
  snapshot.project.graph.nodes.length = 0
  assert.equal(store.getState().graph.nodes.find((item) => item.id === reference.node.id).position.x, -500)
  assert.notEqual(store.getState().project.graph.nodes.length, 0)

  const removed = store.removeGraphNode(reference.node.id)
  assert.equal(removed.ok, true)
  assert.equal(store.getState().graph.nodes.some((item) => item.id === reference.node.id), false)
  assert.equal(store.getState().graph.edges.length, 0)
})

test('graph and result lineage persist without embedding resource or result images', () => {
  const { resource } = loadGraphApis()
  const store = resource.createStore({
    project: {
      id: 'hud',
      blocks: [{ id: 'hero', x: 100, y: 80, width: 800, height: 420 }],
    },
  })
  const imported = store.addDataUrls({ name: 'layout.png', dataUrl: IMAGE })[0]
  const reference = store.addGraphNode(node('reference-a', 'reference', -600, 0, {
    resourceId: imported.id,
    role: 'layout',
  }))
  const generator = store.addGraphNode(node('generator-a', 'generator', 500, 0))
  const layout = store.getState().graph.nodes.find((item) => item.type === 'layout')
  assert.equal(store.connectGraph({ fromNodeId: reference.node.id, toNodeId: generator.node.id }).ok, true)
  assert.equal(store.connectGraph({ fromNodeId: layout.id, toNodeId: generator.node.id }).ok, true)

  const generated = store.addResult({
    name: 'HUD result',
    dataUrl: IMAGE,
    generatorNodeId: generator.node.id,
    layoutNodeId: layout.id,
    referenceResourceIds: [imported.id],
  })
  const resultNode = store.addGraphNode(node('result-a', 'result', 920, 0, {
    resultId: generated.id,
    sourceNodeId: generator.node.id,
    dataUrl: IMAGE,
  }))
  assert.equal(resultNode.ok, true)
  assert.deepEqual(resultNode.node.data, { resultId: generated.id, sourceNodeId: generator.node.id })
  assert.equal(store.connectGraph({ fromNodeId: generator.node.id, toNodeId: resultNode.node.id }).ok, true)
  assert.equal(store.recordResultLineage({
    resultId: generated.id,
    resultNodeId: resultNode.node.id,
    generatorNodeId: generator.node.id,
    layoutNodeId: layout.id,
    referenceResourceIds: [imported.id],
  }).ok, true)

  const payload = store.serializeProject()
  assert.equal(payload.version, 1, 'the existing serialization envelope remains compatible')
  assert.equal(payload.schemaVersion, resource.GRAPH_SCHEMA_VERSION)
  assert.equal(payload.project.graph.schemaVersion, resource.GRAPH_SCHEMA_VERSION)
  assert.equal(payload.project.graph.lineage[0].resultId, generated.id)
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'resources'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'results'), false)
  assert.doesNotMatch(JSON.stringify(payload.project.graph), /data:image\//)

  const restored = resource.createStore(payload)
  assert.deepEqual(restored.getState().graph.edges.map((edge) => edge.id), payload.project.graph.edges.map((edge) => edge.id))
  assert.equal(restored.getState().graph.lineage[0].generatorNodeId, generator.node.id)
})

test('generator output is canonical per node, clamped independently from editor-card size, and survives graph round trips', () => {
  const { structure } = loadGraphApis()
  const graph = structure.normalizeGraph({
    nodes: [
      node('layout-a', 'layout', 0, 0, { blocks: [] }),
      {
        ...node('generator-a', 'generator', 500, 0, {
          output: { width: 1080, height: 1920 },
          generationSettings: { provider: 'local', output: { width: 1024, height: 1024 }, customFlag: 'A' },
        }),
      },
      {
        ...node('generator-b', 'generator', 500, 340, {
          generationSettings: { provider: 'gpt', output: { width: 99999, height: 120 }, customFlag: 'B' },
        }),
      },
    ],
    edges: [
      { id: 'edge-layout-a', fromNodeId: 'layout-a', fromPort: 'layout', toNodeId: 'generator-a', toPort: 'layout', kind: 'layout' },
      { id: 'edge-layout-b', fromNodeId: 'layout-a', fromPort: 'layout', toNodeId: 'generator-b', toPort: 'layout', kind: 'layout' },
    ],
  })

  const first = graph.nodes.find((item) => item.id === 'generator-a')
  const second = graph.nodes.find((item) => item.id === 'generator-b')
  assert.deepEqual(first.data.output, { width: 1080, height: 1920 }, 'canonical data.output wins over legacy nested output')
  assert.deepEqual(second.data.output, { width: 8192, height: 320 }, 'output dimensions clamp to the project safety range')
  assert.equal(first.width, 360)
  assert.equal(first.height, 260)
  assert.equal(first.data.generationSettings.customFlag, 'A')
  assert.equal(Object.prototype.hasOwnProperty.call(first.data.generationSettings, 'output'), false)
  assert.equal(second.data.generationSettings.customFlag, 'B')

  const roundTrip = structure.normalizeGraph(JSON.parse(JSON.stringify(graph)))
  assert.deepEqual(roundTrip.nodes.find((item) => item.id === 'generator-a').data, first.data)
  assert.deepEqual(roundTrip.nodes.find((item) => item.id === 'generator-b').data, second.data)
  assert.deepEqual(roundTrip.edges.map((edge) => edge.id), ['edge-layout-a', 'edge-layout-b'])

  assert.deepEqual(structure.generatorOutputFromNode({
    width: 777,
    height: 333,
    data: { generationSettings: { output: { width: 1152, height: 2048 } } },
  }), { width: 1152, height: 2048 }, 'editor-card size is never read as output')
})

test('layout blocks map through normalized coordinates into a generator-scoped output', () => {
  const { structure } = loadGraphApis()
  const mapped = structure.mapLayoutBlocksToOutput([
    { id: 'hero', x: 192, y: 108, width: 960, height: 540, purpose: 'Hero' },
    { id: 'cta', xNorm: 0.75, yNorm: 0.8, wNorm: 0.2, hNorm: 0.1 },
  ], { width: 1920, height: 1080 }, { width: 1080, height: 1920 })

  assert.deepEqual({ x: mapped[0].x, y: mapped[0].y, width: mapped[0].width, height: mapped[0].height }, {
    x: 108,
    y: 192,
    width: 540,
    height: 960,
  })
  assert.deepEqual({ xNorm: mapped[0].xNorm, yNorm: mapped[0].yNorm, wNorm: mapped[0].wNorm, hNorm: mapped[0].hNorm }, {
    xNorm: 0.1,
    yNorm: 0.1,
    wNorm: 0.5,
    hNorm: 0.5,
  })
  assert.deepEqual({ x: mapped[1].x, y: mapped[1].y, width: mapped[1].width, height: mapped[1].height }, {
    x: 810,
    y: 1536,
    width: 216,
    height: 192,
  })

  const mappedLegacyBlankNorm = structure.mapLayoutBlocksToOutput([{
    id: 'legacy-blank',
    x: 384,
    y: 216,
    width: 480,
    height: 270,
    xNorm: '',
    yNorm: ' ',
    wNorm: null,
    hNorm: false,
  }], { width: 1920, height: 1080 }, { width: 1080, height: 1920 })[0]
  assert.deepEqual(
    { x: mappedLegacyBlankNorm.x, y: mappedLegacyBlankNorm.y, width: mappedLegacyBlankNorm.width, height: mappedLegacyBlankNorm.height },
    { x: 216, y: 384, width: 270, height: 480 },
    'direct generation mapping must fall back to absolute geometry when legacy norm fields are blank',
  )
})
