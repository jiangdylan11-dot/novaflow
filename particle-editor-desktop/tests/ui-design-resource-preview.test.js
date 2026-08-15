const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const projectRoot = path.resolve(__dirname, '..', '..')
const resourcePath = path.join(projectRoot, 'particle-editor', 'ui-design.project.resource.js')
const previewPath = path.join(projectRoot, 'particle-editor', 'ui-design.preview.js')
const resourceSource = fs.readFileSync(resourcePath, 'utf8')
const previewSource = fs.readFileSync(previewPath, 'utf8')

function loadCommonJs(source) {
  const localModule = { exports: {} }
  const browserRoot = { Buffer }
  Function('module', 'exports', 'globalThis', source)(localModule, localModule.exports, browserRoot)
  return localModule.exports
}

const resourceApi = loadCommonJs(resourceSource)
const previewApi = loadCommonJs(previewSource)

const IMAGE_A = 'data:image/png;base64,QQ=='
const IMAGE_B = 'data:image/png;base64,Qg=='
const IMAGE_C = 'data:image/png;base64,Qw=='
const IMAGE_D = 'data:image/png;base64,RA=='

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || 'div').toUpperCase()
    this.ownerDocument = ownerDocument
    this.children = []
    this.attributes = new Map()
    this.listeners = new Map()
    this.parentElement = null
    this.textContent = ''
    this.value = ''
    this.files = []
  }

  appendChild(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentElement = null })
    this.children = []
    children.forEach((child) => this.appendChild(child))
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value))
  }

  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  async dispatchEvent(event) {
    const dispatched = event || {}
    dispatched.type = String(dispatched.type || '')
    dispatched.target = dispatched.target || this
    dispatched.currentTarget = this
    for (const listener of this.listeners.get(dispatched.type) || []) {
      await listener.call(this, dispatched)
    }
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this)
  }
}

function descendants(node) {
  const output = []
  const queue = node && Array.isArray(node.children) ? node.children.slice() : []
  while (queue.length) {
    const child = queue.shift()
    output.push(child)
    if (Array.isArray(child.children)) queue.push(...child.children)
  }
  return output
}

function findByAttribute(node, name, value) {
  return descendants(node).find((item) => {
    const actual = item.getAttribute?.(name)
    return actual != null && (typeof value === 'undefined' || actual === String(value))
  }) || null
}

function findAllByAttribute(node, name) {
  return descendants(node).filter((item) => item.getAttribute?.(name) != null)
}

test('resource and preview modules expose CommonJS and browser globals', () => {
  assert.equal(typeof resourceApi.createStore, 'function')
  assert.equal(typeof previewApi.mount, 'function')

  const resourceContext = { globalThis: null }
  resourceContext.globalThis = resourceContext
  vm.runInNewContext(resourceSource, resourceContext, { filename: resourcePath })
  assert.equal(typeof resourceContext.NovaFlowUiDesignProjectResource.createStore, 'function')

  const previewContext = { globalThis: null }
  previewContext.globalThis = previewContext
  vm.runInNewContext(previewSource, previewContext, { filename: previewPath })
  assert.equal(typeof previewContext.NovaFlowUiDesignPreview.mount, 'function')
})

test('UI project store owns independent project, settings, resources, results and selections', () => {
  const store = resourceApi.createStore({
    project: { id: 'project-a', name: '商城界面' },
    settings: { provider: 'gpt' },
  })
  const state = store.getState()
  assert.equal(state.project.id, 'project-a')
  assert.equal(state.project.name, '商城界面')
  assert.equal(state.project.width, 1920)
  assert.equal(state.project.height, 1080)
  assert.deepEqual(state.project.blocks, [])
  assert.deepEqual(state.project.geometry.artboards, [])
  assert.equal(state.settings.provider, 'gpt')
  assert.equal(state.settings.referenceLimit, 2)
  assert.deepEqual(state.resources, [])
  assert.deepEqual(state.results, [])
  assert.equal(state.selectedResourceId, '')
  assert.equal(state.selectedResultId, '')
  assert.deepEqual(state.referenceIds, [])
  assert.doesNotMatch(resourceSource, /SpineSplitBridge|NovaFlowSpineSplit/i)
})

test('store migrates legacy output fallbacks into independent generator data without using card dimensions', () => {
  const store = resourceApi.createStore({
    project: {
      id: 'legacy-generators',
      width: 1080,
      height: 1920,
      graph: {
        schemaVersion: 2,
        nodes: [
          { id: 'generator-settings', type: 'generator', width: 777, height: 333, data: {} },
          { id: 'generator-output', type: 'generator', data: { output: { width: 2048, height: 1152 }, generationSettings: { localEditStrength: 'enhanced' } } },
          { id: 'generator-legacy-nested', type: 'generator', data: { generationSettings: { provider: 'gpt', output: { width: 1024, height: 1536 } } } },
        ],
        edges: [],
      },
    },
    settings: { provider: 'google', width: 720, height: 1280, googleResolution: '2K' },
  })

  const byId = (id) => store.getState().graph.nodes.find((node) => node.id === id)
  assert.deepEqual(byId('generator-settings').data.output, { width: 720, height: 1280 }, 'legacy global settings precede project dimensions')
  assert.equal(byId('generator-settings').width, 777)
  assert.equal(byId('generator-settings').height, 333)
  assert.deepEqual(byId('generator-output').data.output, { width: 2048, height: 1152 })
  assert.deepEqual(byId('generator-legacy-nested').data.output, { width: 1024, height: 1536 })
  assert.equal(byId('generator-output').data.generationSettings.localEditStrength, 'enhanced')
  assert.equal(Object.prototype.hasOwnProperty.call(byId('generator-legacy-nested').data.generationSettings, 'output'), false)

  store.patchGraphNode('generator-output', { data: { output: { width: 3840, height: 2160 } } })
  assert.deepEqual(store.getGeneratorOutput('generator-output'), { width: 3840, height: 2160 })
  assert.deepEqual(store.getGeneratorOutput('generator-settings'), { width: 720, height: 1280 }, 'editing one generator cannot change another')

  const restored = resourceApi.createStore(store.serializeProject())
  assert.deepEqual(restored.getGeneratorOutput('generator-output'), { width: 3840, height: 2160 })
  assert.deepEqual(restored.getGeneratorOutput('generator-settings'), { width: 720, height: 1280 })

  const projectFallback = resourceApi.createStore({
    project: {
      width: 1080,
      height: 1920,
      graph: { schemaVersion: 2, nodes: [{ id: 'generator-project', type: 'generator', width: 640, height: 180, data: {} }], edges: [] },
    },
    settings: { provider: 'local' },
  })
  assert.deepEqual(projectFallback.getGeneratorOutput('generator-project'), { width: 1080, height: 1920 })
})

test('subscriptions observe one atomic update and stop after unsubscribe', () => {
  const store = resourceApi.createStore()
  const updates = []
  const unsubscribe = store.subscribe((next, previous, reason) => {
    updates.push({ next, previous, reason })
  })
  const added = store.addDataUrls([
    { name: '角色.png', dataUrl: IMAGE_A, kind: 'character' },
    { name: '风格.png', dataUrl: IMAGE_B },
  ])
  assert.equal(added.length, 2)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].reason, 'add-resources')
  assert.equal(updates[0].previous.resources.length, 0)
  assert.equal(updates[0].next.resources.length, 2)
  assert.equal(store.getState().selectedResourceId, added[1].id)

  unsubscribe()
  store.patchSettings({ provider: 'google' })
  assert.equal(updates.length, 1)
})

test('reference selection is capped at two without evicting an existing reference', () => {
  const store = resourceApi.createStore()
  const resources = store.addDataUrls([
    { name: 'A.png', dataUrl: IMAGE_A },
    { name: 'B.png', dataUrl: IMAGE_B },
    { name: 'C.png', dataUrl: IMAGE_C },
  ])

  assert.deepEqual(store.toggleReference(resources[0].id), {
    ok: true,
    active: true,
    referenceIds: [resources[0].id],
  })
  assert.equal(store.toggleReference(resources[1].id).ok, true)
  const rejected = store.toggleReference(resources[2].id)
  assert.equal(rejected.ok, false)
  assert.match(rejected.error, /最多只能选择 2 张参考图/)
  assert.deepEqual(store.getState().referenceIds, [resources[0].id, resources[1].id])
  assert.equal(store.getState().resources[2].isReference, false)

  assert.equal(store.toggleReference(resources[0].id, false).ok, true)
  assert.equal(store.toggleReference(resources[2].id, true).ok, true)
  assert.deepEqual(store.getState().referenceIds, [resources[1].id, resources[2].id])
  assert.deepEqual(store.getReferenceResources().map((resource) => resource.id), [resources[1].id, resources[2].id])
})

test('project geometry/settings serialize without coupling image resources into the project payload', () => {
  const store = resourceApi.createStore({ project: { id: 'hud', name: '战斗 HUD' } })
  store.patchProject({
    width: 1280,
    height: 720,
    blocks: [{ id: 'hero', role: '主视觉', x: 120, y: 180, width: 900, height: 480 }],
  })
  store.patchSettings({ provider: 'google', structureStrength: 0.8 })
  store.addDataUrls([{ name: 'style.png', dataUrl: IMAGE_A }])

  const serialized = store.serializeProjectGeometry()
  assert.equal(serialized.version, 1)
  assert.equal(serialized.project.id, 'hud')
  assert.equal(serialized.project.name, '战斗 HUD')
  assert.equal(serialized.project.width, 1280)
  assert.equal(serialized.project.height, 720)
  assert.equal(serialized.project.blocks[0].role, '主视觉')
  assert.equal(serialized.geometry.width, 1280)
  assert.equal(serialized.geometry.blocks[0].role, '主视觉')
  assert.equal(serialized.settings.provider, 'google')
  assert.equal(Object.prototype.hasOwnProperty.call(serialized, 'resources'), false)

  const projectPayload = JSON.parse(store.serializeJson())
  assert.equal(projectPayload.project.blocks.length, 1)
  assert.equal(projectPayload.project.geometry.blocks.length, 1)
  assert.equal(projectPayload.settings.structureStrength, 0.8)
  assert.equal(Object.prototype.hasOwnProperty.call(projectPayload, 'results'), false)
})

test('results have independent selection and removal lifecycle', () => {
  const store = resourceApi.createStore()
  const first = store.addResult({ name: '方案 A', dataUrl: IMAGE_A, provider: 'local' })
  const second = store.addResult({ name: '方案 B', dataUrl: IMAGE_B, provider: 'gpt' })
  assert.equal(store.getState().results.length, 2)
  assert.equal(store.getState().selectedResultId, second.id)
  assert.equal(store.setSelectedResult(first.id), true)
  assert.equal(store.getState().selectedResultId, first.id)
  assert.equal(store.removeResult(first.id), true)
  assert.equal(store.getState().selectedResultId, '')
  assert.deepEqual(store.getState().results.map((result) => result.id), [second.id])
})

test('addImportedFiles accepts file-like entries carrying data URLs', async () => {
  const store = resourceApi.createStore()
  const added = await store.addImportedFiles([
    { name: 'portrait.png', type: 'image/png', dataUrl: IMAGE_A },
    { name: 'layout.webp', type: 'image/webp', dataUrl: 'data:image/webp;base64,QQ==' },
  ])
  assert.equal(added.length, 2)
  assert.deepEqual(store.getState().resources.map((resource) => resource.name), ['portrait.png', 'layout.webp'])
})

test('shared result projection stays unique and shared deletion preserves graph cleanup', () => {
  const sharedDeletes = []
  let store = null
  store = resourceApi.createStore({}, {
    onRemoveSharedResource(sharedResourceId) {
      sharedDeletes.push(sharedResourceId)
      store.removeSharedResource(sharedResourceId)
    },
  })
  const result = store.addResult({
    id: 'ui-result-shared',
    name: 'UI方案.png',
    dataUrl: IMAGE_D,
    createdAt: '2026-07-22T11:00:00.000Z',
  })
  store.addGraphNode({
    id: 'result-node-shared',
    type: 'result',
    data: { resultId: result.id, sourceNodeId: 'generator-1' },
  })
  store.recordResultLineage({
    resultId: result.id,
    resultNodeId: 'result-node-shared',
    generatorNodeId: 'generator-1',
  })

  const shared = {
    id: 'drawing-source-shared',
    origin: 'ui-design',
    externalId: result.id,
    name: 'UI方案.png',
    dataUrl: IMAGE_D,
    width: 1152,
    height: 2048,
    createdAt: '2026-07-22T11:00:00.000Z',
  }
  store.syncSharedResources([shared])
  store.syncSharedResources([shared])

  let state = store.getState()
  assert.equal(state.resources.length, 1)
  assert.equal(state.resources[0].sharedResourceId, shared.id)
  assert.equal(state.resources[0].linkedResultId, result.id)
  assert.equal(state.results[0].sharedResourceId, shared.id)
  assert.equal(state.resources[0].width, 1152)
  assert.equal(state.resources[0].height, 2048)

  assert.equal(store.removeResult(result.id), true)
  state = store.getState()
  assert.deepEqual(sharedDeletes, [shared.id])
  assert.equal(state.resources.length, 0)
  assert.equal(state.results.length, 0)
  assert.equal(state.graph.nodes.some((node) => node.id === 'result-node-shared'), false)
  assert.equal(state.graph.lineage.some((entry) => entry.resultId === result.id), false)
})

test('authoritative shared snapshot removes missing resource and result graph projections', () => {
  const store = resourceApi.createStore({
    resources: [
      { id: 'local-resource', name: '本地旧资源.png', dataUrl: IMAGE_A },
      {
        id: 'stale-shared-resource',
        sharedResourceId: 'shared-stale',
        name: '已删除共享资源.png',
        dataUrl: IMAGE_B,
        isReference: true,
      },
    ],
    referenceIds: ['stale-shared-resource'],
    results: [
      { id: 'stale-shared-result', sharedResourceId: 'shared-stale', name: '已删除共享结果.png', dataUrl: IMAGE_C },
      { id: 'local-result', name: '本地旧结果.png', dataUrl: IMAGE_D },
    ],
  })
  const referenceNode = store.addGraphNode({
    id: 'stale-reference-node',
    type: 'reference',
    position: { x: -500, y: 0 },
    data: { resourceId: 'stale-shared-resource' },
  }).node
  const generatorNode = store.addGraphNode({
    id: 'generator-node',
    type: 'generator',
    position: { x: 0, y: 0 },
    data: {},
  }).node
  const staleResultNode = store.addGraphNode({
    id: 'stale-result-node',
    type: 'result',
    position: { x: 500, y: -100 },
    data: { resultId: 'stale-shared-result', sourceNodeId: generatorNode.id },
  }).node
  const localResultNode = store.addGraphNode({
    id: 'local-result-node',
    type: 'result',
    position: { x: 500, y: 180 },
    data: { resultId: 'local-result', sourceNodeId: generatorNode.id },
  }).node
  assert.equal(store.connectGraph({ fromNodeId: referenceNode.id, toNodeId: generatorNode.id }).ok, true)
  assert.equal(store.connectGraph({ fromNodeId: generatorNode.id, toNodeId: staleResultNode.id }).ok, true)
  assert.equal(store.connectGraph({ fromNodeId: generatorNode.id, toNodeId: localResultNode.id }).ok, true)
  assert.equal(store.recordResultLineage({
    resultId: 'stale-shared-result',
    resultNodeId: staleResultNode.id,
    generatorNodeId: generatorNode.id,
    referenceResourceIds: ['stale-shared-resource'],
  }).ok, true)
  assert.equal(store.recordResultLineage({
    resultId: 'local-result',
    resultNodeId: localResultNode.id,
    generatorNodeId: generatorNode.id,
    parentResultIds: ['stale-shared-result'],
    referenceResourceIds: ['stale-shared-resource'],
  }).ok, true)

  store.syncSharedResources([{
    id: 'shared-kept',
    name: '仍在共享快照中.png',
    dataUrl: IMAGE_A,
  }], { authoritative: true })

  const state = store.getState()
  assert.deepEqual(state.resources.map((resource) => resource.id).sort(), ['local-resource', 'shared-kept'])
  assert.deepEqual(state.results.map((result) => result.id), ['local-result'])
  assert.deepEqual(state.referenceIds, [])
  assert.equal(state.graph.nodes.some((node) => node.id === referenceNode.id), false)
  assert.equal(state.graph.nodes.some((node) => node.id === staleResultNode.id), false)
  assert.equal(state.graph.nodes.some((node) => node.id === generatorNode.id), true)
  assert.equal(state.graph.nodes.some((node) => node.id === localResultNode.id), true)
  assert.equal(state.graph.edges.some((edge) => (
    edge.fromNodeId === referenceNode.id
    || edge.toNodeId === referenceNode.id
    || edge.fromNodeId === staleResultNode.id
    || edge.toNodeId === staleResultNode.id
  )), false)
  assert.equal(state.graph.edges.some((edge) => (
    edge.fromNodeId === generatorNode.id && edge.toNodeId === localResultNode.id
  )), true)
  assert.equal(state.graph.lineage.some((entry) => entry.resultId === 'stale-shared-result'), false)
  const localLineage = state.graph.lineage.find((entry) => entry.resultId === 'local-result')
  assert.deepEqual(localLineage.parentResultIds, [])
  assert.deepEqual(localLineage.referenceResourceIds, [])
})

test('empty authoritative snapshot clears only shared projections', () => {
  const store = resourceApi.createStore({
    resources: [
      { id: 'local-resource', name: '本地旧资源.png', dataUrl: IMAGE_A },
      { id: 'shared-resource', sharedResourceId: 'shared-resource-a', name: '共享资源.png', dataUrl: IMAGE_B },
    ],
    results: [
      { id: 'local-result', name: '本地旧结果.png', dataUrl: IMAGE_C },
      { id: 'shared-result', sharedResourceId: 'shared-result-a', name: '共享结果.png', dataUrl: IMAGE_D },
    ],
  })

  assert.deepEqual(store.syncSharedResources([]), [])
  assert.deepEqual(store.getState().resources.map((resource) => resource.id), ['local-resource', 'shared-resource'])
  assert.deepEqual(store.getState().results.map((result) => result.id), ['local-result', 'shared-result'])

  assert.deepEqual(store.syncSharedResources([], { authoritative: true }), [])
  assert.deepEqual(store.getState().resources.map((resource) => resource.id), ['local-resource'])
  assert.deepEqual(store.getState().results.map((result) => result.id), ['local-result'])
})

test('preview renders one compact headerless resource list without tabs or duplicate import controls', () => {
  const document = new FakeDocument()
  const host = document.createElement('aside')
  const store = resourceApi.createStore({
    resources: [{ name: '已有参考.png', dataUrl: IMAGE_A, width: 1280, height: 720, createdAt: '2026-07-22T08:00:00.000Z' }],
    results: [{ name: '生成结果.png', title: '首页方案', dataUrl: IMAGE_D, width: 1920, height: 1080, createdAt: '2026-07-22T09:00:00.000Z' }],
  })
  const mounted = previewApi.mount({ host, store })

  const panel = findByAttribute(host, 'data-novaflow-ui-design-preview', '1')
  assert.ok(panel)
  assert.equal(panel.getAttribute('data-novaflow-ui-design-resource-panel'), '1')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-preview-header', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-preview-title', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-preview-count', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-tabs', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-tab'), null)
  const style = findByAttribute(host, 'data-novaflow-ui-design-preview-style', '1')
  assert.match(style.textContent, /\[data-novaflow-ui-design-preview=/)
  assert.doesNotMatch(style.textContent, /\.nf-|\.novaflow-art-generate/)
  assert.doesNotMatch(style.textContent, /ui-design-preview-(?:header|title|count)/)
  assert.match(style.textContent, /grid-template-columns:minmax\(0,1fr\)/)
  assert.match(style.textContent, /min-height:46px;height:46px/)
  assert.match(style.textContent, /grid-template-columns:34px minmax\(0,1fr\) 22px/)
  assert.match(style.textContent, /width:34px;height:34px/)
  assert.match(style.textContent, /card-meta="1"[\s\S]*height:30px[\s\S]*grid-template-rows:14px 12px/)
  assert.match(style.textContent, /card-title="1"[\s\S]*font-size:12px;line-height:14px;font-weight:500/)
  assert.match(style.textContent, /card-name="1"[\s\S]*font-size:10px;line-height:12px/)
  assert.match(style.textContent, /data-novaflow-ui-design-remove[\s\S]*width:24px;height:24px;min-width:24px/)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-import', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-file-input', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-add-canvas'), null)

  const resource = store.getState().resources[0]
  const result = store.getState().results[0]
  const resourceCard = findByAttribute(host, 'data-novaflow-ui-design-resource-card', resource.id)
  const resultCard = findByAttribute(host, 'data-novaflow-ui-design-result-card', result.id)
  assert.ok(resourceCard)
  assert.ok(resultCard)
  assert.equal(findByAttribute(resourceCard, 'data-novaflow-ui-design-card-title', '1').textContent, '原图资源')
  assert.equal(findByAttribute(resourceCard, 'data-novaflow-ui-design-card-name', '1').textContent, '已有参考.png · 1280x720')
  assert.equal(findByAttribute(resultCard, 'data-novaflow-ui-design-card-title', '1').textContent, '首页方案')
  assert.equal(findByAttribute(resultCard, 'data-novaflow-ui-design-card-name', '1').textContent, '生成结果.png · 1920x1080')
  assert.ok(findByAttribute(host, 'data-novaflow-ui-design-remove', resource.id))
  assert.ok(findByAttribute(host, 'data-novaflow-ui-design-remove', result.id))
  const list = findByAttribute(host, 'data-novaflow-ui-design-card-list', '1')
  assert.deepEqual(list.children.map((card) => card.getAttribute('data-novaflow-ui-design-card-kind')), ['result', 'resource'])

  mounted.unmount()
  assert.equal(host.children.length, 0)
})

test('preview empty resource state keeps the panel headerless and centers one area label', () => {
  const document = new FakeDocument()
  const host = document.createElement('aside')
  const store = resourceApi.createStore()
  const mounted = previewApi.mount({ host, store })

  const empty = findByAttribute(host, 'data-novaflow-ui-design-empty', '1')
  assert.ok(empty)
  assert.equal(empty.textContent, '资源区域')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-preview-header', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-preview-title', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-preview-count', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-preview-body', '1').getAttribute('data-empty'), '1')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-import', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-file-input', '1'), null)

  mounted.unmount()
})

test('preview merges newest items first and preserves resource drag, kind-specific deletion, and result selection', async () => {
  const document = new FakeDocument()
  const host = document.createElement('aside')
  const store = resourceApi.createStore()
  const resources = store.addDataUrls([
    { name: 'A.png', dataUrl: IMAGE_A, createdAt: '2026-07-22T08:00:00.000Z' },
    { name: 'B.png', dataUrl: IMAGE_B, createdAt: '2026-07-22T10:00:00.000Z' },
    { name: 'C.png', dataUrl: IMAGE_C, createdAt: '2026-07-22T10:00:00.000Z' },
  ])
  const olderResult = store.addResult({ name: '生成方案 1.png', dataUrl: IMAGE_D, createdAt: '2026-07-22T09:00:00.000Z' })
  const newestResult = store.addResult({ name: '生成方案 2.png', dataUrl: IMAGE_D, createdAt: '2026-07-22T11:00:00.000Z' })
  const selected = []
  const mounted = previewApi.mount({
    host,
    store,
    onSelectResult(result) {
      selected.push(result.id)
    },
  })

  const list = findByAttribute(host, 'data-novaflow-ui-design-card-list', '1')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-preview-header', '1'), null)
  assert.equal(list.children.length, 5)
  assert.deepEqual(list.children.map((card) => (
    card.getAttribute('data-novaflow-ui-design-resource-card') || card.getAttribute('data-novaflow-ui-design-result-card')
  )), [newestResult.id, resources[2].id, resources[1].id, olderResult.id, resources[0].id])

  const transfers = {}
  const resourceCard = findByAttribute(host, 'data-novaflow-ui-design-resource-card', resources[0].id)
  await resourceCard.dispatchEvent({
    type: 'dragstart',
    dataTransfer: {
      effectAllowed: '',
      setData(type, value) { transfers[type] = value },
    },
  })
  assert.deepEqual(transfers, {
    'application/x-novaflow-ui-resource': resources[0].id,
    'text/novaflow-ui-resource': resources[0].id,
  })

  const removeResource = findAllByAttribute(host, 'data-novaflow-ui-design-remove')
    .find((button) => button.getAttribute('data-novaflow-ui-design-remove-kind') === 'resource' && button.getAttribute('data-novaflow-ui-design-remove') === resources[2].id)
  await removeResource.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} })
  assert.deepEqual(store.getState().resources.map((resource) => resource.id), [resources[0].id, resources[1].id])
  assert.deepEqual(store.getState().results.map((result) => result.id), [olderResult.id, newestResult.id])

  const removeResult = findAllByAttribute(host, 'data-novaflow-ui-design-remove')
    .find((button) => button.getAttribute('data-novaflow-ui-design-remove-kind') === 'result' && button.getAttribute('data-novaflow-ui-design-remove') === newestResult.id)
  await removeResult.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} })
  assert.deepEqual(store.getState().results.map((result) => result.id), [olderResult.id])
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-preview-count', '1'), null)
  assert.equal(findAllByAttribute(host, 'data-novaflow-ui-design-card-kind').length, 3)

  const resultCard = findByAttribute(host, 'data-novaflow-ui-design-result-card', olderResult.id)
  assert.equal(findByAttribute(resultCard, 'data-novaflow-ui-design-card-title', '1').textContent, 'UI生成资源')
  assert.equal(findByAttribute(resultCard, 'data-novaflow-ui-design-card-name', '1').textContent, '生成方案 1.png')
  await resultCard.dispatchEvent({ type: 'click' })
  assert.equal(store.getState().selectedResultId, olderResult.id)
  assert.deepEqual(selected, [olderResult.id])
  assert.equal(findAllByAttribute(host, 'data-novaflow-ui-design-result-card').length, 1)

  mounted.unmount()
})

test('preview deduplicates a shared result projection while keeping result semantics and resource drag identity', async () => {
  const document = new FakeDocument()
  const host = document.createElement('aside')
  const sharedDeletes = []
  let store = null
  store = resourceApi.createStore({
    resources: [{
      id: 'shared-resource-projection',
      name: '共享结果.png',
      dataUrl: IMAGE_D,
      width: 1280,
      height: 720,
      sharedResourceId: 'shared-result-1',
      linkedResultId: 'generated-result-1',
      createdAt: '2026-07-22T12:00:01.000Z',
    }],
    results: [{
      id: 'generated-result-1',
      name: '共享结果.png',
      title: '战斗 HUD 方案',
      dataUrl: IMAGE_D,
      width: 1280,
      height: 720,
      sharedResourceId: 'shared-result-1',
      createdAt: '2026-07-22T12:00:00.000Z',
    }],
  }, {
    onRemoveSharedResource(sharedResourceId, detail) {
      sharedDeletes.push({ sharedResourceId, detail })
      store.removeSharedResource(sharedResourceId)
    },
  })
  const selected = []
  const mounted = previewApi.mount({
    host,
    store,
    onSelectResult(result) { selected.push(result.id) },
  })

  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-preview-header', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-preview-count', '1'), null)
  assert.equal(findAllByAttribute(host, 'data-novaflow-ui-design-card-kind').length, 1)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-resource-card', 'shared-resource-projection'), null)
  const resultCard = findByAttribute(host, 'data-novaflow-ui-design-result-card', 'generated-result-1')
  assert.ok(resultCard)
  assert.equal(resultCard.getAttribute('draggable'), 'true')
  assert.equal(findByAttribute(resultCard, 'data-novaflow-ui-design-card-title', '1').textContent, '战斗 HUD 方案')

  const transfers = {}
  await resultCard.dispatchEvent({
    type: 'dragstart',
    dataTransfer: {
      effectAllowed: '',
      setData(type, value) { transfers[type] = value },
    },
  })
  assert.deepEqual(transfers, {
    'application/x-novaflow-ui-resource': 'shared-resource-projection',
    'text/novaflow-ui-resource': 'shared-resource-projection',
  })
  await resultCard.dispatchEvent({ type: 'click' })
  assert.equal(store.getState().selectedResultId, 'generated-result-1')
  assert.deepEqual(selected, ['generated-result-1'])

  const remove = findAllByAttribute(host, 'data-novaflow-ui-design-remove')
    .find((button) => button.getAttribute('data-novaflow-ui-design-remove-kind') === 'result')
  await remove.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} })
  assert.deepEqual(sharedDeletes, [{
    sharedResourceId: 'shared-result-1',
    detail: { entity: 'result', localId: 'generated-result-1' },
  }])
  assert.deepEqual(store.getState().results, [])
  assert.deepEqual(store.getState().resources, [])
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-preview-header', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-preview-count', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-empty', '1').textContent, '资源区域')

  mounted.unmount()
})
