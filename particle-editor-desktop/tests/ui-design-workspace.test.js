const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const repoRoot = path.resolve(__dirname, '..', '..')
const structurePath = path.join(repoRoot, 'particle-editor', 'ui-design.structure.tool.js')
const inspectorPath = path.join(repoRoot, 'particle-editor', 'ui-design.inspector.tool.js')
const generateToolPath = path.join(repoRoot, 'particle-editor', 'ui-design-generate.tool.js')
const workspacePath = path.join(repoRoot, 'particle-editor', 'ui-design.workspace.js')
const runtimePath = path.join(repoRoot, 'particle-editor', 'novaflow-brand-runtime.js')

class FakeStyle {
  setProperty(name, value) { this[name] = String(value) }
  removeProperty(name) { delete this[name] }
  getPropertyValue(name) { return this[name] || '' }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || 'div').toUpperCase()
    this.ownerDocument = ownerDocument
    this.children = []
    this.parentElement = null
    this.attributes = new Map()
    this.listeners = new Map()
    this.style = new FakeStyle()
    this.textContent = ''
    this.value = ''
    this.checked = false
    this.disabled = false
    this.hidden = false
    this.isContentEditable = false
    this.type = ''
    this.title = ''
    this.files = []
    this.clientWidth = 1200
    this.clientHeight = 760
    this._rect = { left: 0, top: 0, width: 1200, height: 760 }
    this.capturedPointerIds = new Set()
  }

  get firstChild() { return this.children[0] || null }

  appendChild(child) {
    if (!child) return child
    if (child.parentElement) {
      const index = child.parentElement.children.indexOf(child)
      if (index >= 0) child.parentElement.children.splice(index, 1)
    }
    child.parentElement = this
    this.children.push(child)
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parentElement = null
    return child
  }

  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentElement = null })
    this.children = []
    children.forEach((child) => this.appendChild(child))
  }

  remove() {
    if (!this.parentElement) return
    this.parentElement.removeChild(this)
  }

  contains(node) {
    if (node === this) return true
    return this.children.some((child) => child.contains(node))
  }

  setAttribute(name, value) { this.attributes.set(String(name), String(value)) }
  getAttribute(name) {
    const key = String(name)
    return this.attributes.has(key) ? this.attributes.get(key) : null
  }
  removeAttribute(name) { this.attributes.delete(String(name)) }

  addEventListener(type, listener) {
    const options = arguments.length > 2 ? arguments[2] : false
    const listeners = this.listeners.get(type) || []
    listeners.push({
      listener,
      capture: options === true || Boolean(options && options.capture),
      once: Boolean(options && options.once),
    })
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    this.listeners.set(type, listeners.filter((item) => item.listener !== listener))
  }

  dispatchEvent(input) {
    const event = input || {}
    event.type = String(event.type || '')
    event.target = event.target || this
    event.defaultPrevented = !!event.defaultPrevented
    event.preventDefault = event.preventDefault || function preventDefault() { this.defaultPrevented = true }
    event.stopPropagation = event.stopPropagation || function stopPropagation() {
      this.cancelBubble = true
      this._propagationStopped = true
    }
    event.stopImmediatePropagation = event.stopImmediatePropagation || function stopImmediatePropagation() {
      this.cancelBubble = true
      this._propagationStopped = true
      this._immediateStopped = true
    }
    const path = []
    let current = this
    while (current) {
      path.push(current)
      current = current.parentElement
    }
    const invoke = (element, capture) => {
      event.currentTarget = element
      const entries = [...(element.listeners.get(event.type) || [])]
      for (const entry of entries) {
        if (entry.capture !== capture) continue
        entry.listener.call(element, event)
        if (entry.once) element.removeEventListener(event.type, entry.listener)
        if (event._immediateStopped) break
      }
      event._immediateStopped = false
    }
    for (let index = path.length - 1; index > 0 && !event._propagationStopped; index -= 1) {
      invoke(path[index], true)
    }
    if (!event._propagationStopped) {
      invoke(this, true)
      if (!event._immediateStopped) invoke(this, false)
    }
    if (event.bubbles !== false) {
      for (let index = 1; index < path.length && !event._propagationStopped; index += 1) {
        invoke(path[index], false)
      }
    }
    return !event.defaultPrevented
  }

  getBoundingClientRect() {
    return {
      ...this._rect,
      right: this._rect.left + this._rect.width,
      bottom: this._rect.top + this._rect.height,
    }
  }

  setPointerCapture(pointerId) { this.capturedPointerIds.add(pointerId) }
  releasePointerCapture(pointerId) { this.capturedPointerIds.delete(pointerId) }
  hasPointerCapture(pointerId) { return this.capturedPointerIds.has(pointerId) }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this
  }

  blur() {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null
  }

  matches(selector) {
    const value = String(selector || '').trim()
    const attribute = value.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/)
    if (attribute) {
      const actual = this.getAttribute(attribute[1])
      return attribute[2] == null ? actual !== null : actual === attribute[2]
    }
    return value ? this.tagName.toLowerCase() === value.toLowerCase() : false
  }

  closest(selector) {
    let current = this
    while (current) {
      if (current.matches && current.matches(selector)) return current
      current = current.parentElement
    }
    return null
  }
}

class FakeWindow {
  constructor() {
    this.frames = new Map()
    this.nextFrameId = 1
    this.timers = new Map()
    this.nextTimerId = 1
  }
  requestAnimationFrame(callback) {
    const id = this.nextFrameId
    this.nextFrameId += 1
    this.frames.set(id, callback)
    return id
  }
  cancelAnimationFrame(id) { this.frames.delete(id) }
  flushAnimationFrames() {
    const frames = [...this.frames.values()]
    this.frames.clear()
    frames.forEach((callback) => callback())
  }
  setTimeout(callback) {
    const id = this.nextTimerId
    this.nextTimerId += 1
    this.timers.set(id, callback)
    return id
  }
  clearTimeout(id) { this.timers.delete(id) }
  flushTimers() {
    const timers = [...this.timers.values()]
    this.timers.clear()
    timers.forEach((callback) => callback())
  }
}

class FakeDocument {
  constructor() {
    this.defaultView = new FakeWindow()
    this.activeElement = null
    this.hitTarget = null
  }
  createElement(tagName) { return new FakeElement(tagName, this) }
  createElementNS(namespace, tagName) { return new FakeElement(tagName, this) }
  elementFromPoint() { return this.hitTarget }
}

function findByAttribute(root, name, value) {
  if (!root) return null
  if (root.getAttribute && root.getAttribute(name) === String(value)) return root
  for (const child of root.children || []) {
    const match = findByAttribute(child, name, value)
    if (match) return match
  }
  return null
}

function findAllByAttribute(root, name) {
  if (!root) return []
  const matches = root.getAttribute && root.getAttribute(name) !== null ? [root] : []
  for (const child of root.children || []) matches.push(...findAllByAttribute(child, name))
  return matches
}

function findByTag(root, tagName) {
  if (!root) return null
  if (root.tagName === String(tagName).toUpperCase()) return root
  for (const child of root.children || []) {
    const match = findByTag(child, tagName)
    if (match) return match
  }
  return null
}

function loadApi(context, filePath, globalName) {
  context.module = { exports: {} }
  context.exports = context.module.exports
  vm.runInContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath })
  const commonJsExport = context.module.exports
  assert.equal(commonJsExport, context[globalName])
  return commonJsExport
}

function loadUiDesignApis() {
  const context = vm.createContext({ console, setTimeout, clearTimeout })
  context.globalThis = context
  const structure = loadApi(context, structurePath, 'NovaFlowUiDesignStructureTool')
  const inspector = loadApi(context, inspectorPath, 'NovaFlowUiDesignInspectorTool')
  const generateTool = loadApi(context, generateToolPath, 'NovaFlowUiDesignGenerateTool')
  const workspace = loadApi(context, workspacePath, 'NovaFlowUiDesignWorkspace')
  return { context, structure, inspector, generateTool, workspace }
}

function plain(value) { return JSON.parse(JSON.stringify(value)) }
function pointer(type, clientX, clientY, pointerId = 1, button = 0, extra = {}) {
  const activeButtons = type === 'pointerup' || type === 'pointercancel' ? 0 : (button === 2 ? 2 : 1)
  return { type, clientX, clientY, pointerId, button, buttons: activeButtons, bubbles: true, ...extra }
}

function keydown(key, target) {
  return { type: 'keydown', key, target, bubbles: true }
}

function connectedProject(structure, options = {}) {
  const blocks = options.blocks || [
    { id: 'hero', name: 'Hero', x: 80, y: 60, width: 800, height: 400, zIndex: 1 },
    { id: 'footer', name: 'Footer', x: 80, y: 560, width: 1120, height: 100, zIndex: 2 },
  ]
  const nodes = [
    {
      id: 'reference-a',
      type: 'reference',
      title: 'Reference A',
      position: { x: -360, y: 120 },
      width: 260,
      height: 240,
      data: { resourceId: 'resource-a', role: 'style' },
    },
    {
      id: 'layout-a',
      type: 'layout',
      title: 'Page Structure',
      position: { x: 80, y: 80 },
      width: 360,
      height: 280,
      data: { blocks },
    },
    {
      id: 'generator-a',
      type: 'generator',
      title: 'UI Generator',
      position: { x: 620, y: 100 },
      width: 280,
      height: 220,
      data: {},
    },
  ]
  if (options.results !== false) {
    nodes.push(
      {
        id: 'result-a',
        type: 'result',
        title: 'Result A',
        position: { x: 1060, y: 40 },
        width: 320,
        height: 260,
        data: { resultId: 'result-a', sourceNodeId: 'generator-a' },
      },
      {
        id: 'result-b',
        type: 'result',
        title: 'Result B',
        position: { x: 1060, y: 360 },
        width: 320,
        height: 260,
        data: { resultId: 'result-b', sourceNodeId: 'generator-a' },
      },
    )
  }
  const edges = [
    {
      id: 'edge-layout',
      fromNodeId: 'layout-a',
      fromPort: 'layout',
      toNodeId: 'generator-a',
      toPort: 'layout',
      kind: 'layout',
    },
    {
      id: 'edge-reference',
      fromNodeId: 'reference-a',
      fromPort: 'reference',
      toNodeId: 'generator-a',
      toPort: 'reference',
      kind: 'reference',
    },
  ]
  if (options.results !== false) {
    edges.push(
      {
        id: 'edge-result-a',
        fromNodeId: 'generator-a',
        fromPort: 'result',
        toNodeId: 'result-a',
        toPort: 'result',
        kind: 'result',
      },
      {
        id: 'edge-iteration',
        fromNodeId: 'result-a',
        fromPort: 'reference',
        toNodeId: 'generator-a',
        toPort: 'iteration',
        kind: 'iteration',
      },
    )
  }
  return structure.normalize({
    id: options.id || 'connected-project',
    title: 'Connected project',
    width: 1280,
    height: 720,
    blocks,
    graph: { schemaVersion: 2, nodes, edges, lineage: [] },
  })
}

function singleLayoutProject(structure) {
  const blocks = [
    { id: 'hero', name: 'Hero', x: 120, y: 80, width: 900, height: 420, zIndex: 1 },
  ]
  return structure.normalize({
    id: 'single-layout-project',
    title: 'Single layout',
    width: 1280,
    height: 720,
    blocks,
    graph: {
      schemaVersion: 2,
      nodes: [{
        id: 'layout-only',
        type: 'layout',
        title: 'Page Structure',
        position: { x: 100, y: 100 },
        width: 360,
        height: 280,
        data: { blocks },
      }],
      edges: [],
      lineage: [],
    },
  })
}

function mountWorkspaceFixture(options = {}) {
  const apis = loadUiDesignApis()
  if (options.imagePreviewDialog) apis.context.NovaFlowUiDesignImagePreviewDialog = options.imagePreviewDialog
  const document = new FakeDocument()
  const host = document.createElement('div')
  const state = {
    project: options.project || connectedProject(apis.structure),
    resources: options.resources || [
      { id: 'resource-a', name: 'style.png', dataUrl: 'data:image/png;base64,U1RZTEU=' },
    ],
    results: options.results || [
      { id: 'result-a', name: 'result-a.png', dataUrl: 'data:image/png;base64,UkVTVUxUX0E=' },
      { id: 'result-b', name: 'result-b.png', dataUrl: 'data:image/png;base64,UkVTVUxUX0I=' },
    ],
    changes: [],
    generations: [],
  }
  const handle = apis.workspace.mount({
    host,
    getProject: () => state.project,
    getResources: () => state.resources,
    getResults: () => state.results,
    onProjectChange(next, detail) {
      state.project = next
      state.changes.push({ project: plain(next), detail: plain(detail) })
      if (typeof options.onProjectChange === 'function') options.onProjectChange(next, detail, { host, state })
    },
    onImportFiles: options.onImportFiles,
    onGenerateRequest(payload) { state.generations.push(payload) },
    onUseResultAsReference: options.onUseResultAsReference,
    mountPromptMentions: options.mountPromptMentions,
    onOpenDesignAssistant: options.onOpenDesignAssistant,
  })
  document.defaultView.flushAnimationFrames()
  return {
    ...apis,
    document,
    host,
    state,
    handle,
    viewport: findByAttribute(host, 'data-novaflow-ui-design-viewport', '1'),
    world: findByAttribute(host, 'data-novaflow-ui-design-world', '1'),
  }
}

test('structure tool keeps legacy block editing while graph nodes support negative world coordinates', () => {
  const { structure } = loadUiDesignApis()
  const source = {
    id: 'project-a',
    title: 'Lobby',
    width: 100,
    height: 120,
    blocks: [
      { id: 'hero', name: 'Hero', x: -50, y: 900, width: 900, height: 2, locked: 'true', participates: 'false' },
      { id: 'hero', name: 'CTA', x: 10, y: 12, width: 80, height: 44 },
    ],
  }
  const normalized = structure.normalize(source)
  assert.equal(normalized.width, 320)
  assert.equal(normalized.height, 320)
  assert.equal(normalized.blocks[0].x, 0)
  assert.notEqual(normalized.blocks[0].id, normalized.blocks[1].id)

  const layout = normalized.graph.nodes.find((node) => node.type === 'layout')
  const moved = structure.updateGraphNode(normalized.graph, layout.id, { position: { x: -860, y: -420 } })
  assert.equal(moved.ok, true)
  assert.deepEqual(plain(moved.node.position), { x: -860, y: -420 })

  const created = structure.create(normalized, {
    id: 'footer',
    name: 'Footer',
    x: 20,
    y: 240,
    width: 260,
    height: 64,
  })
  assert.equal(created.blocks.length, 3)
  const updated = structure.update(created, 'footer', { name: 'Bottom nav' })
  assert.equal(structure.find(updated, 'footer').name, 'Bottom nav')
  assert.equal(structure.remove(updated, 'footer').blocks.length, 2)
})

test('inspector edits semantic block fields and never exposes raw geometry inputs', () => {
  const { structure, inspector } = loadUiDesignApis()
  const document = new FakeDocument()
  const host = document.createElement('div')
  const project = structure.create(structure.normalize({ id: 'p', width: 1280, height: 720 }), {
    id: 'hero',
    name: 'Hero',
    purpose: 'Main visual',
    requirements: 'Large focal image',
    x: 20,
    y: 30,
    width: 900,
    height: 420,
  })
  const layoutNode = project.graph.nodes.find((node) => node.type === 'layout')
  const block = layoutNode.data.blocks.find((item) => item.id === 'hero')
  const selection = { kind: 'block', node: layoutNode, nodeId: layoutNode.id, block, blockId: block.id }
  const patches = []
  const removals = []
  const handle = inspector.mount({
    host,
    getSelection: () => selection,
    onPatchSelection(selected, patch) { patches.push({ id: selected.blockId, patch: plain(patch) }) },
    onRemoveSelection(selected) { removals.push(selected.blockId) },
  })

  const nameInput = findByAttribute(host, 'data-novaflow-ui-design-inspector-field', 'name')
  const purposeInput = findByAttribute(host, 'data-novaflow-ui-design-inspector-field', 'purpose')
  const requirementsInput = findByAttribute(host, 'data-novaflow-ui-design-inspector-field', 'requirements')
  nameInput.dispatchEvent({ type: 'blur', bubbles: false })
  nameInput.value = 'Primary'
  nameInput.dispatchEvent({ type: 'input', bubbles: false })
  nameInput.value = 'Primary Hero'
  nameInput.dispatchEvent({ type: 'input', bubbles: false })
  assert.equal(host.contains(nameInput), true)
  assert.equal(nameInput.value, 'Primary Hero')
  assert.deepEqual(patches, [], 'typing keeps a DOM draft and does not patch the project')
  nameInput.dispatchEvent({ type: 'change', bubbles: false })
  nameInput.dispatchEvent({ type: 'blur', bubbles: false })

  purposeInput.dispatchEvent({ type: 'compositionstart', bubbles: false })
  purposeInput.value = '核心主视觉'
  purposeInput.dispatchEvent({ type: 'input', bubbles: false })
  purposeInput.value = '核心主视觉与品牌氛围'
  purposeInput.dispatchEvent({ type: 'input', bubbles: false })
  purposeInput.dispatchEvent({ type: 'compositionend', bubbles: false })
  assert.equal(purposeInput.value, '核心主视觉与品牌氛围')
  assert.equal(patches.length, 1, 'IME composition must not patch while typing')
  purposeInput.dispatchEvent({ type: 'blur', bubbles: false })
  purposeInput.dispatchEvent({ type: 'change', bubbles: false })

  requirementsInput.value = '突出角色，保持按钮层级清晰'
  requirementsInput.dispatchEvent({ type: 'input', bubbles: false })
  assert.equal(patches.length, 2)
  requirementsInput.dispatchEvent({ type: 'change', bubbles: false })
  requirementsInput.dispatchEvent({ type: 'blur', bubbles: false })
  assert.deepEqual(patches, [
    { id: 'hero', patch: { name: 'Primary Hero' } },
    { id: 'hero', patch: { purpose: '核心主视觉与品牌氛围' } },
    { id: 'hero', patch: { requirements: '突出角色，保持按钮层级清晰' } },
  ], 'change and blur share one deduplicated commit per text field')
  for (const field of ['kind', 'x', 'y', 'width', 'height']) {
    assert.equal(findByAttribute(host, 'data-novaflow-ui-design-inspector-field', field), null)
  }
  findByAttribute(host, 'data-novaflow-ui-design-inspector-remove', '1')
    .dispatchEvent({ type: 'click', bubbles: false })
  assert.deepEqual(removals, ['hero'])
  handle.destroy()
  assert.equal(host.children.length, 0)
})

test('layout inspector exposes semantic fields without an automatic-analysis action', () => {
  const { structure, inspector } = loadUiDesignApis()
  const document = new FakeDocument()
  const host = document.createElement('div')
  const project = structure.normalize({
    id: 'layout-analysis',
    width: 1280,
    height: 720,
    blocks: [{ id: 'hero', name: 'Hero', x: 20, y: 20, width: 800, height: 420 }],
  })
  const layoutNode = project.graph.nodes.find((node) => node.type === 'layout')
  const selection = { kind: 'node', node: layoutNode, nodeId: layoutNode.id }
  const handle = inspector.mount({ host, getSelection: () => selection })

  const analyze = findByAttribute(host, 'data-novaflow-ui-design-analyze-layout', '1')
  assert.equal(analyze, null)
  handle.destroy()
})

test('workspace is an infinite connected node canvas with bottom tools and clean generation input', () => {
  const { structure, workspace } = loadUiDesignApis()
  const document = new FakeDocument()
  const host = document.createElement('div')
  let project = null
  const resources = [
    { id: 'resource-a', name: 'style.png', dataUrl: 'data:image/png;base64,U1RZTEU=' },
    { id: 'resource-b', name: 'layout-a.png', dataUrl: 'data:image/png;base64,TEFZT1VUX0E=' },
    { id: 'resource-c', name: 'layout-b.png', dataUrl: 'data:image/png;base64,TEFZT1VUX0I=' },
  ]
  const changes = []
  const generations = []
  const modificationBaseRequests = []
  const results = []
  const handle = workspace.mount({
    host,
    getProject: () => project,
    getResources: () => resources,
    getResults: () => results,
    onProjectChange(next, detail) {
      project = next
      changes.push({ project: plain(next), detail: plain(detail) })
    },
    onGenerateRequest(payload) { generations.push(payload) },
    onUseResultAsReference(result, node) { modificationBaseRequests.push({ result: plain(result), node: plain(node) }) },
  })
  document.defaultView.flushAnimationFrames()

  const viewport = findByAttribute(host, 'data-novaflow-ui-design-viewport', '1')
  const world = findByAttribute(host, 'data-novaflow-ui-design-world', '1')
  assert.ok(viewport && world)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-board', '1'), null)
  for (const action of ['reference', 'layout', 'generator', 'region', 'undo', 'redo']) {
    assert.ok(findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', action), action)
  }
  const bottomDock = findByAttribute(host, 'data-novaflow-ui-design-bottom-dock', '1')
  const toolbar = findByAttribute(host, 'data-novaflow-ui-design-toolbar', '1')
  assert.equal(toolbar.parentElement, bottomDock)
  assert.equal(bottomDock.children.length, 1)

  const starterActions = ['reference', 'template', 'blank'].map((action) => (
    findByAttribute(host, 'data-novaflow-ui-design-empty-action', action)
  ))
  assert.ok(starterActions.every(Boolean), 'empty UI project must expose all three starter actions')
  assert.deepEqual(starterActions.map((button) => button.style.width), ['96px', '96px', '96px'])

  findByAttribute(host, 'data-novaflow-ui-design-empty-action', 'template')
    .dispatchEvent({ type: 'click', bubbles: false })
  assert.equal(project.graph.nodes.filter((node) => node.type === 'layout').length, 1)
  assert.equal(project.graph.nodes.filter((node) => node.type === 'generator').length, 1)
  assert.equal(project.graph.edges.filter((edge) => edge.kind === 'layout').length, 1)
  assert.ok(findAllByAttribute(host, 'data-novaflow-ui-design-block').length >= 4)

  const layout = project.graph.nodes.find((node) => node.type === 'layout')
  const moved = structure.updateGraphNode(project.graph, layout.id, { position: { x: -700, y: -360 } })
  project = structure.normalize({ ...project, graph: moved.graph })
  handle.update(project)
  const layoutElement = findByAttribute(host, 'data-novaflow-ui-design-node', layout.id)
  assert.equal(layoutElement.style.left, '-700px')
  assert.equal(layoutElement.style.top, '-360px')

  const firstAutoReference = handle.addReferenceResource(resources[1])
  const secondAutoReference = handle.addReferenceResource(resources[2])
  assert.equal(firstAutoReference.ok, true)
  assert.equal(secondAutoReference.ok, true)
  const autoNodes = project.graph.nodes.filter((node) => ['resource-b', 'resource-c'].includes(node.data.resourceId))
  assert.equal(autoNodes.length, 2)
  assert.ok(autoNodes.every((node) => node.position.x < -700))
  assert.ok(Math.abs(autoNodes[0].position.y - autoNodes[1].position.y) >= 240)

  const referenceResult = handle.addReferenceResource(resources[0], { x: -1020, y: -240 }, 'style')
  assert.equal(referenceResult.ok, true)
  const referenceNode = referenceResult.node
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-reference-analyze', referenceNode.id), null)
  assert.equal(project.graph.nodes.find((node) => node.id === referenceNode.id).data.role, 'style')
  assert.equal(changes.some((entry) => entry.detail.reason === 'mark-layout-reference'), false)
  const generator = project.graph.nodes.find((node) => node.type === 'generator')
  const referenceTarget = findByAttribute(host, 'data-novaflow-ui-design-port', generator.id + ':reference')
  findByAttribute(host, 'data-novaflow-ui-design-port', referenceNode.id + ':reference')
    .dispatchEvent(pointer('pointerdown', 180, 160, 16))
  document.hitTarget = referenceTarget
  viewport.dispatchEvent(pointer('pointerup', 680, 180, 16))
  document.hitTarget = null
  assert.equal(project.graph.edges.filter((edge) => edge.kind === 'reference').length, 1)

  const resultNodeResult = handle.addResultNode({ id: 'result-a', name: 'result-a.png' }, generator.id)
  assert.equal(resultNodeResult.ok, true)
  const resultNode = project.graph.nodes.find((node) => node.type === 'result' && node.data.resultId === 'result-a')
  const secondResultNodeResult = handle.addResultNode({ id: 'result-b', name: 'result-b.png' }, generator.id)
  assert.equal(secondResultNodeResult.ok, true)
  results.push(
    { id: 'result-a', name: 'result-a.png', dataUrl: 'data:image/png;base64,QQ==' },
    { id: 'result-b', name: 'result-b.png', dataUrl: 'data:image/png;base64,Qg==' },
  )
  handle.setResults(results)
  const secondResultNode = project.graph.nodes.find((node) => node.type === 'result' && node.data.resultId === 'result-b')
  assert.equal(secondResultNode.position.x, resultNode.position.x)
  assert.ok(
    secondResultNode.position.y >= resultNode.position.y + resultNode.height + 36,
    'successive generated results must occupy separate visible slots',
  )
  assert.equal(
    findByAttribute(host, 'data-novaflow-ui-design-port', generator.id + ':iteration'),
    null,
    'legacy iteration wiring must not be exposed as an unexplained canvas port',
  )
  const useFirstResult = findByAttribute(host, 'data-novaflow-ui-design-result-iterate', resultNode.id)
  assert.equal(useFirstResult.textContent, '设为修改底图')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-result-edit', resultNode.id), null)
  useFirstResult.dispatchEvent({ type: 'click', bubbles: false })
  const useSecondResult = findByAttribute(host, 'data-novaflow-ui-design-result-iterate', secondResultNode.id)
  useSecondResult.dispatchEvent({ type: 'click', bubbles: false })
  assert.deepEqual(modificationBaseRequests.map((entry) => entry.result.id), ['result-a', 'result-b'])

  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'region')
    .dispatchEvent({ type: 'click', bubbles: false })
  const blockId = project.graph.nodes.find((node) => node.id === layout.id).data.blocks[0].id
  findByAttribute(host, 'data-novaflow-ui-design-block', blockId)
    .dispatchEvent(pointer('pointerdown', 20, 20, 19))
  assert.equal(handle.getSelection().kind, 'block')
  findByAttribute(host, 'data-novaflow-ui-design-node-drag-handle', layout.id)
    .dispatchEvent(pointer('pointerdown', 30, 30, 20))
  assert.equal(handle.getSelection().kind, 'node')
  assert.equal(handle.getSelection().nodeId, layout.id)

  const beforeZoom = world.style.transform
  viewport.dispatchEvent({ type: 'wheel', deltaY: -120, clientX: 500, clientY: 300, bubbles: false })
  assert.notEqual(world.style.transform, beforeZoom)
  assert.equal(world.style.willChange, 'auto')
  document.defaultView.flushTimers()
  assert.equal(world.style.willChange, 'auto')
  const beforePan = world.style.transform
  viewport.dispatchEvent(pointer('pointerdown', 500, 300, 11, 2))
  viewport.dispatchEvent(pointer('pointermove', 560, 355, 11, 2))
  viewport.dispatchEvent(pointer('pointerup', 560, 355, 11, 2))
  assert.notEqual(world.style.transform, beforePan)

  findByAttribute(host, 'data-novaflow-ui-design-node-generate-action', '1')
    .dispatchEvent({ type: 'click', bubbles: false })
  assert.equal(generations.length, 1)
  assert.equal(generations[0].project.graph.schemaVersion, structure.GRAPH_SCHEMA_VERSION)
  assert.equal(generations[0].layoutGuide.clean, true)
  assert.equal(generations[0].layoutGuide.editorSnapshot, false)
  assert.match(generations[0].layoutGuide.dataUrl, /^data:image\//)
  assert.ok(handle.fit().zoom > 0)

  handle.destroy()
  assert.equal(host.children.length, 0)
  assert.ok(changes.some((entry) => entry.detail.reason === 'create-workflow-starter'))
})

test('workspace defaults to direct selection and right-button panning from nested canvas content', () => {
  const fixture = mountWorkspaceFixture()
  const { host, viewport, world, handle, document, state } = fixture

  const referenceCard = findByAttribute(host, 'data-novaflow-ui-design-node', 'reference-a')
  const referenceImage = findByTag(referenceCard, 'img')
  referenceImage.dispatchEvent(pointer('pointerdown', 140, 120, 40))
  viewport.dispatchEvent(pointer('pointerup', 140, 120, 40))
  assert.equal(handle.getSelection().kind, 'node')
  assert.equal(handle.getSelection().nodeId, 'reference-a')
  assert.equal(document.activeElement, viewport, 'canvas interaction should keep keyboard deletion focused')

  const block = findByAttribute(host, 'data-novaflow-ui-design-block', 'hero')
  block.dispatchEvent(pointer('pointerdown', 330, 240, 41))
  viewport.dispatchEvent(pointer('pointerup', 330, 240, 41))
  assert.equal(handle.getSelection().kind, 'block')
  assert.equal(handle.getSelection().blockId, 'hero')

  const layoutHeader = findByAttribute(host, 'data-novaflow-ui-design-node-drag-handle', 'layout-a')
  layoutHeader.dispatchEvent(pointer('pointerdown', 380, 140, 42))
  viewport.dispatchEvent(pointer('pointerup', 380, 140, 42))
  assert.equal(handle.getSelection().kind, 'node')
  assert.equal(handle.getSelection().nodeId, 'layout-a')

  viewport.dispatchEvent(pointer('pointerdown', 1120, 710, 43))
  viewport.dispatchEvent(pointer('pointerup', 1120, 710, 43))
  assert.equal(handle.getSelection(), null, 'left-clicking empty canvas should clear selection')

  const originalLayout = plain(state.project.graph.nodes.find((node) => node.id === 'layout-a'))
  const originalBlockCount = originalLayout.data.blocks.length
  const panFrom = (target, pointerId) => {
    const before = world.style.transform
    target.dispatchEvent(pointer('pointerdown', 420, 240, pointerId, 2))
    assert.equal(world.style.willChange, 'auto')
    viewport.dispatchEvent(pointer('pointermove', 475, 285, pointerId, 2))
    viewport.dispatchEvent(pointer('pointerup', 475, 285, pointerId, 2))
    assert.equal(world.style.willChange, 'auto')
    assert.notEqual(world.style.transform, before)
    const afterRelease = world.style.transform
    viewport.dispatchEvent(pointer('pointermove', 520, 330, pointerId, 2))
    assert.equal(world.style.transform, afterRelease, 'released right-button pan must not remain sticky')
  }

  panFrom(viewport, 51)
  panFrom(findByAttribute(host, 'data-novaflow-ui-design-node-drag-handle', 'layout-a'), 52)
  panFrom(findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a'), 53)
  panFrom(findByAttribute(host, 'data-novaflow-ui-design-block', 'hero'), 54)
  panFrom(findByAttribute(host, 'data-novaflow-ui-design-port', 'layout-a:layout'), 55)

  const currentLayout = state.project.graph.nodes.find((node) => node.id === 'layout-a')
  assert.deepEqual(plain(currentLayout.position), originalLayout.position)
  assert.equal(currentLayout.data.blocks.length, originalBlockCount)
  handle.destroy()
})

test('workspace patches an explicit block snapshot after the live selection moves elsewhere', () => {
  const fixture = mountWorkspaceFixture()
  const { host, viewport, handle, state } = fixture

  const selectBlock = (blockId, pointerId) => {
    findByAttribute(host, 'data-novaflow-ui-design-block', blockId)
      .dispatchEvent(pointer('pointerdown', 330, 240, pointerId))
    viewport.dispatchEvent(pointer('pointerup', 330, 240, pointerId))
  }

  selectBlock('hero', 61)
  const heroSelectionSnapshot = handle.getSelection()
  assert.equal(heroSelectionSnapshot.blockId, 'hero')

  selectBlock('footer', 62)
  assert.equal(handle.getSelection().blockId, 'footer')

  assert.equal(handle.patchSelection(heroSelectionSnapshot, { purpose: 'Only the original hero block' }), true)
  const layout = state.project.graph.nodes.find((node) => node.id === 'layout-a')
  const hero = layout.data.blocks.find((block) => block.id === 'hero')
  const footer = layout.data.blocks.find((block) => block.id === 'footer')
  assert.equal(hero.purpose, 'Only the original hero block')
  assert.notEqual(footer.purpose, 'Only the original hero block')
  assert.equal(handle.getSelection().blockId, 'footer', 'patching the snapshot must not move the live selection')

  assert.equal(handle.patchSelection({ name: 'Footer through the legacy one-argument API' }), true)
  const updatedLayout = state.project.graph.nodes.find((node) => node.id === 'layout-a')
  assert.equal(
    updatedLayout.data.blocks.find((block) => block.id === 'footer').name,
    'Footer through the legacy one-argument API',
  )
  handle.destroy()
})

test('generated result images open the shared zoom preview by pointer or keyboard without selecting or moving the canvas', () => {
  const opens = []
  let closes = 0
  const previewHandle = { close() { closes += 1 } }
  const fixture = mountWorkspaceFixture({
    imagePreviewDialog: {
      open(payload) {
        opens.push(payload)
        return previewHandle
      },
    },
  })
  const { document, host, handle } = fixture
  const image = findByAttribute(host, 'data-novaflow-ui-design-result-preview', 'result-a')
  assert.ok(image, 'generated result image must expose a zoom preview target')
  assert.equal(image.getAttribute('role'), 'button')
  assert.equal(image.getAttribute('tabindex'), '0')
  assert.equal(image.getAttribute('aria-haspopup'), 'dialog')
  assert.match(image.getAttribute('aria-label'), /result-a\.png/)
  assert.equal(image.style.cursor, 'zoom-in')

  const previewPointerDown = pointer('pointerdown', 1100, 120, 101)
  image.dispatchEvent(previewPointerDown)
  assert.equal(previewPointerDown._propagationStopped, true)
  assert.equal(handle.getSelection(), null, 'opening a result preview must not select the canvas node')
  const previewClick = { type: 'click', bubbles: true }
  assert.equal(image.dispatchEvent(previewClick), false)
  assert.equal(previewClick._propagationStopped, true)
  assert.equal(opens.length, 1)
  assert.equal(opens[0].src, 'data:image/png;base64,UkVTVUxUX0E=')
  assert.equal(opens[0].name, 'result-a.png')
  assert.equal(opens[0].documentRef, document)
  assert.equal(handle.getSelection(), null)

  assert.equal(image.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true }), false)
  assert.equal(image.dispatchEvent({ type: 'keydown', key: ' ', bubbles: true }), false)
  image.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true })
  assert.equal(opens.length, 3, 'only Enter and Space should activate the preview')
  assert.equal(handle.getSelection(), null, 'keyboard activation must not bubble into node selection')

  handle.destroy()
  assert.equal(closes, 1, 'destroying the workspace must close the preview it opened')
})

test('a self-closed generated result preview releases the workspace closer before destroy', () => {
  let openPayload = null
  let closes = 0
  const fixture = mountWorkspaceFixture({
    imagePreviewDialog: {
      open(payload) {
        openPayload = payload
        return { close() { closes += 1 } }
      },
    },
  })
  const { host, handle } = fixture
  const image = findByAttribute(host, 'data-novaflow-ui-design-result-preview', 'result-a')
  image.dispatchEvent({ type: 'click', bubbles: true })
  assert.equal(typeof openPayload.onClose, 'function')
  openPayload.onClose('escape')
  handle.destroy()
  assert.equal(closes, 0, 'destroy must not retain or close an already closed preview handle')
})

test('layout-block drawing stays active across repeated draws and exits explicitly', () => {
  const fixture = mountWorkspaceFixture()
  const { host, viewport, state, handle } = fixture
  const previewRect = { left: 100, top: 100, width: 640, height: 360 }
  const initialBlockCount = state.project.graph.nodes.find((node) => node.id === 'layout-a').data.blocks.length

  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'region')
    .dispatchEvent({ type: 'click', bubbles: false })
  const initialPreview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  initialPreview._rect = previewRect
  initialPreview.dispatchEvent(pointer('pointerdown', 180, 160, 58))
  assert.equal(viewport.hasPointerCapture(58), true)

  // Chromium returns a zero rect for the detached preview after renderNodes().
  initialPreview._rect = { left: 0, top: 0, width: 0, height: 0 }
  viewport.dispatchEvent(pointer('pointermove', 420, 280, 58))
  let draft = findByAttribute(host, 'data-novaflow-ui-design-draft', '1')
  assert.ok(Math.abs(parseFloat(draft.style.width) - 37.5) < 0.01)
  assert.ok(Math.abs(parseFloat(draft.style.height) - (100 / 3)) < 0.01)

  const currentPreview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  currentPreview._rect = previewRect
  viewport.dispatchEvent(pointer('pointermove', 500, 320, 58))
  draft = findByAttribute(host, 'data-novaflow-ui-design-draft', '1')
  assert.ok(Math.abs(parseFloat(draft.style.width) - 50) < 0.01)
  assert.ok(Math.abs(parseFloat(draft.style.height) - (400 / 9)) < 0.01)
  viewport.dispatchEvent(pointer('pointerup', 500, 320, 58))

  const blocks = state.project.graph.nodes.find((node) => node.id === 'layout-a').data.blocks
  const created = blocks.find((block) => !['hero', 'footer'].includes(block.id))
  assert.ok(created)
  assert.ok(Math.abs(created.x - 160) < 0.01)
  assert.ok(Math.abs(created.y - 120) < 0.01)
  assert.ok(Math.abs(created.width - 640) < 0.01)
  assert.ok(Math.abs(created.height - 320) < 0.01)
  assert.equal(viewport.hasPointerCapture(58), false)
  assert.equal(handle.getTool(), 'region', 'a completed block keeps continuous drawing active')

  const repeatPreview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  repeatPreview._rect = previewRect
  repeatPreview.dispatchEvent(pointer('pointerdown', 520, 120, 59))
  assert.equal(viewport.hasPointerCapture(59), true)
  viewport.dispatchEvent(pointer('pointermove', 700, 200, 59))
  viewport.dispatchEvent(pointer('pointerup', 700, 200, 59))
  assert.equal(viewport.hasPointerCapture(59), false)
  assert.equal(
    state.project.graph.nodes.find((node) => node.id === 'layout-a').data.blocks.length,
    initialBlockCount + 2,
    'a second block is created without clicking the toolbar again',
  )
  assert.equal(handle.getTool(), 'region')

  const invalidPreview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  invalidPreview._rect = previewRect
  invalidPreview.dispatchEvent(pointer('pointerdown', 200, 180, 60))
  viewport.dispatchEvent(pointer('pointermove', 201, 181, 60))
  viewport.dispatchEvent(pointer('pointerup', 201, 181, 60))
  assert.equal(
    state.project.graph.nodes.find((node) => node.id === 'layout-a').data.blocks.length,
    initialBlockCount + 2,
  )
  assert.equal(handle.getTool(), 'region', 'an undersized draw only cancels the current draft')

  const cancelPreview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  cancelPreview._rect = previewRect
  cancelPreview.dispatchEvent(pointer('pointerdown', 240, 200, 61))
  assert.equal(viewport.hasPointerCapture(61), true)
  viewport.dispatchEvent({ type: 'lostpointercapture', pointerId: 61, bubbles: false })
  assert.equal(viewport.hasPointerCapture(61), false)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-draft', '1'), null)
  assert.equal(handle.getTool(), 'region', 'pointer cancellation keeps the continuous tool active')

  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'region')
    .dispatchEvent({ type: 'click', bubbles: false })
  assert.equal(handle.getTool(), 'select', 'clicking the active toolbar button exits drawing')

  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'region')
    .dispatchEvent({ type: 'click', bubbles: false })
  const escapePreview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  escapePreview._rect = previewRect
  escapePreview.dispatchEvent(pointer('pointerdown', 260, 220, 62))
  viewport.dispatchEvent(pointer('pointermove', 420, 300, 62))
  assert.ok(findByAttribute(host, 'data-novaflow-ui-design-draft', '1'))
  viewport.dispatchEvent(keydown('Escape', viewport))
  assert.equal(viewport.hasPointerCapture(62), false)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-draft', '1'), null)
  assert.equal(handle.getTool(), 'select', 'Escape cancels the current draft and exits drawing')
  handle.destroy()
})

test('layout previews follow generator output while preserving neutral canvas coordinates', () => {
  const { structure } = loadUiDesignApis()
  const sourceBlocks = [{
    id: 'hero', name: 'Hero', x: 108, y: 192, width: 540, height: 960,
    xNorm: 0.1, yNorm: 0.1, wNorm: 0.5, hNorm: 0.5, zIndex: 1,
  }]
  let project = connectedProject(structure, { results: false, blocks: sourceBlocks })
  let updated = structure.updateGraphNode(project.graph, 'layout-a', {
    data: {
      blocks: sourceBlocks,
      canvasSize: { width: 1080, height: 1920 },
    },
  })
  updated = structure.updateGraphNode(updated.graph, 'generator-a', {
    data: { output: { width: 1024, height: 1024 } },
  })
  project = structure.normalize({ ...project, width: 1024, height: 1024, blocks: sourceBlocks, graph: updated.graph })
  const fixture = mountWorkspaceFixture({ project, results: [] })
  const { host, viewport, state, handle } = fixture
  const previewRect = { left: 100, top: 100, width: 270, height: 270 }

  let preview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  assert.equal(preview.style.aspectRatio, '1024 / 1024')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-layout-output', 'layout-a').textContent, '结构 1024 × 1024')
  preview._rect = previewRect
  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'region')
    .dispatchEvent({ type: 'click', bubbles: false })
  preview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  preview._rect = previewRect
  preview.dispatchEvent(pointer('pointerdown', 127, 127, 71))
  viewport.dispatchEvent(pointer('pointermove', 235, 235, 71))
  preview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  preview._rect = previewRect
  viewport.dispatchEvent(pointer('pointerup', 235, 235, 71))

  let layout = state.project.graph.nodes.find((node) => node.id === 'layout-a')
  let created = layout.data.blocks.find((block) => block.id !== 'hero')
  assert.deepEqual(
    plain({ x: created.x, y: created.y, width: created.width, height: created.height }),
    { x: 108, y: 192, width: 432, height: 768 },
  )
  assert.deepEqual(
    plain({ xNorm: created.xNorm, yNorm: created.yNorm, wNorm: created.wNorm, hNorm: created.hNorm }),
    { xNorm: 0.1, yNorm: 0.1, wNorm: 0.4, hNorm: 0.4 },
  )

  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'region')
    .dispatchEvent({ type: 'click', bubbles: false })
  assert.equal(handle.getTool(), 'select')
  preview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  preview._rect = previewRect
  const createdElement = findByAttribute(host, 'data-novaflow-ui-design-block', created.id)
  createdElement.dispatchEvent(pointer('pointerdown', 154, 154, 72))
  viewport.dispatchEvent(pointer('pointermove', 181, 181, 72))
  viewport.dispatchEvent(pointer('pointerup', 181, 181, 72))
  layout = state.project.graph.nodes.find((node) => node.id === 'layout-a')
  created = layout.data.blocks.find((block) => block.id === created.id)
  assert.deepEqual(
    plain({ x: created.x, y: created.y, width: created.width, height: created.height }),
    { x: 216, y: 384, width: 432, height: 768 },
  )
  assert.deepEqual(
    plain({ xNorm: created.xNorm, yNorm: created.yNorm, wNorm: created.wNorm, hNorm: created.hNorm }),
    { xNorm: 0.2, yNorm: 0.2, wNorm: 0.4, hNorm: 0.4 },
  )

  handle.patchGeneratorOutput('generator-a', { width: 1920, height: 1080 })
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a').style.aspectRatio, '1920 / 1080')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-layout-output', 'layout-a').textContent, '结构 1920 × 1080')
  const restored = structure.normalize(JSON.parse(JSON.stringify(state.project)))
  const restoredLayout = restored.graph.nodes.find((node) => node.id === 'layout-a')
  const restoredBlock = restoredLayout.data.blocks.find((block) => block.id === created.id)
  assert.deepEqual(plain(restoredLayout.data.canvasSize), { width: 1080, height: 1920 })
  assert.deepEqual(
    plain({ x: restoredBlock.x, y: restoredBlock.y, width: restoredBlock.width, height: restoredBlock.height }),
    { x: 216, y: 384, width: 432, height: 768 },
  )
  assert.deepEqual(
    plain({ xNorm: restoredBlock.xNorm, yNorm: restoredBlock.yNorm, wNorm: restoredBlock.wNorm, hNorm: restoredBlock.hNorm }),
    { xNorm: 0.2, yNorm: 0.2, wNorm: 0.4, hNorm: 0.4 },
  )
  handle.destroy()
})

test('Delete and Backspace remove the current canvas selection but never edit through form controls', () => {
  const fixture = mountWorkspaceFixture()
  const { host, viewport, handle, state, document } = fixture

  let header = findByAttribute(host, 'data-novaflow-ui-design-node-drag-handle', 'layout-a')
  header.dispatchEvent(pointer('pointerdown', 360, 140, 61))
  viewport.dispatchEvent(pointer('pointerup', 360, 140, 61))
  viewport.dispatchEvent(keydown('Delete', viewport))
  assert.equal(state.project.graph.nodes.some((node) => node.id === 'layout-a'), false)
  assert.equal(
    state.project.graph.edges.some((edge) => edge.fromNodeId === 'layout-a' || edge.toNodeId === 'layout-a'),
    false,
    'deleting a node must cascade its attached edges',
  )

  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'undo')
    .dispatchEvent({ type: 'click', bubbles: false })
  assert.ok(state.project.graph.nodes.some((node) => node.id === 'layout-a'))

  let block = findByAttribute(host, 'data-novaflow-ui-design-block', 'hero')
  block.dispatchEvent(pointer('pointerdown', 350, 230, 62))
  viewport.dispatchEvent(pointer('pointerup', 350, 230, 62))
  viewport.dispatchEvent(keydown('Backspace', viewport))
  assert.equal(
    state.project.graph.nodes.find((node) => node.id === 'layout-a').data.blocks.some((item) => item.id === 'hero'),
    false,
  )

  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'undo')
    .dispatchEvent({ type: 'click', bubbles: false })
  assert.ok(state.project.graph.nodes.find((node) => node.id === 'layout-a').data.blocks.some((item) => item.id === 'hero'))

  header = findByAttribute(host, 'data-novaflow-ui-design-node-drag-handle', 'reference-a')
  header.dispatchEvent(pointer('pointerdown', 160, 130, 63))
  viewport.dispatchEvent(pointer('pointerup', 160, 130, 63))
  const input = document.createElement('input')
  viewport.appendChild(input)
  input.focus()
  input.dispatchEvent(keydown('Delete', input))
  assert.ok(state.project.graph.nodes.some((node) => node.id === 'reference-a'))

  const editable = document.createElement('div')
  editable.isContentEditable = true
  viewport.appendChild(editable)
  editable.focus()
  editable.dispatchEvent(keydown('Backspace', editable))
  assert.ok(state.project.graph.nodes.some((node) => node.id === 'reference-a'))
  handle.destroy()
})

test('connections expose a midpoint cut control while preserving Delete and Undo', () => {
  const fixture = mountWorkspaceFixture()
  const { host, viewport, state, handle } = fixture
  const hit = findByAttribute(host, 'data-novaflow-ui-design-edge-hit', 'edge-reference')
  assert.ok(hit, 'connections need a selectable hit path')
  hit.dispatchEvent(pointer('pointerdown', 500, 160, 66))
  assert.equal(handle.getSelection().kind, 'edge')
  assert.equal(handle.getSelection().edgeId, 'edge-reference')
  let cut = findByAttribute(host, 'data-novaflow-ui-design-edge-cut', 'edge-reference')
  assert.ok(cut, 'a selected connection needs a midpoint cut control')
  assert.equal(cut.getAttribute('opacity'), '1')
  viewport.dispatchEvent(keydown('Delete', viewport))
  assert.equal(state.project.graph.edges.some((edge) => edge.id === 'edge-reference'), false)
  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'undo')
    .dispatchEvent({ type: 'click', bubbles: false })
  assert.ok(state.project.graph.edges.some((edge) => edge.id === 'edge-reference'))

  const restoredHit = findByAttribute(host, 'data-novaflow-ui-design-edge-hit', 'edge-reference')
  cut = findByAttribute(host, 'data-novaflow-ui-design-edge-cut', 'edge-reference')
  assert.equal(cut.getAttribute('opacity'), '0')
  assert.equal(cut.getAttribute('pointer-events'), 'none')
  restoredHit.dispatchEvent({ type: 'pointerenter', bubbles: false })
  assert.equal(cut.getAttribute('opacity'), '1')
  assert.equal(cut.getAttribute('pointer-events'), 'all')
  cut.dispatchEvent({ type: 'click', button: 0, bubbles: true })
  assert.equal(state.project.graph.edges.some((edge) => edge.id === 'edge-reference'), false)
  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'undo')
    .dispatchEvent({ type: 'click', bubbles: false })
  assert.ok(state.project.graph.edges.some((edge) => edge.id === 'edge-reference'))
  handle.destroy()
})

test('layout node resizing is freeform, supports a portrait editor card, keeps output geometry semantic, and participates in history and fit', () => {
  const { structure } = loadUiDesignApis()
  const fixture = mountWorkspaceFixture({ project: singleLayoutProject(structure), resources: [], results: [] })
  const { host, viewport, state, handle } = fixture
  const beforeNode = plain(state.project.graph.nodes.find((node) => node.id === 'layout-only'))
  const beforeBlocks = plain(beforeNode.data.blocks)
  const beforeFit = handle.fit()
  const preview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-only')
  assert.equal(preview.style.aspectRatio, '1280 / 720')

  const resize = findByAttribute(host, 'data-novaflow-ui-design-node-resize', 'layout-only')
  assert.ok(resize, 'page structure node must expose a resize handle')
  resize.dispatchEvent(pointer('pointerdown', 460, 380, 71))
  viewport.dispatchEvent(pointer('pointermove', 250, 900, 71))
  const previewCard = findByAttribute(host, 'data-novaflow-ui-design-node', 'layout-only')
  assert.ok(parseFloat(previewCard.style.width) < beforeNode.width, 'width must resize independently before pointer release')
  assert.ok(parseFloat(previewCard.style.height) > beforeNode.height, 'height must resize independently before pointer release')
  viewport.dispatchEvent(pointer('pointerup', 250, 900, 71))

  const resized = plain(state.project.graph.nodes.find((node) => node.id === 'layout-only'))
  assert.ok(resized.width < beforeNode.width)
  assert.ok(resized.height > beforeNode.height)
  assert.ok(resized.height > resized.width, 'the page structure editor card must be able to become portrait')
  assert.deepEqual(resized.data.blocks, beforeBlocks, 'node resizing must not rewrite semantic rectangles')
  assert.equal(state.project.width, 1280)
  assert.equal(state.project.height, 720)
  assert.ok(Math.abs(resized.width / resized.height - 1280 / 720) > 0.2, 'outer editor geometry must not stay locked to the output ratio')
  const afterFit = handle.fit()
  assert.ok(afterFit.zoom < beforeFit.zoom, 'auto-fit must use the resized node bounds')

  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'undo')
    .dispatchEvent({ type: 'click', bubbles: false })
  const undone = state.project.graph.nodes.find((node) => node.id === 'layout-only')
  assert.equal(undone.width, beforeNode.width)
  assert.equal(undone.height, beforeNode.height)
  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'redo')
    .dispatchEvent({ type: 'click', bubbles: false })
  const redone = state.project.graph.nodes.find((node) => node.id === 'layout-only')
  assert.equal(redone.width, resized.width)
  assert.equal(redone.height, resized.height)
  handle.destroy()
})

test('portrait projects create ratio-correct layout nodes and contain previews from older card sizes', () => {
  const { structure } = loadUiDesignApis()
  const project = structure.normalize({
    id: 'portrait-project',
    title: 'Portrait project',
    width: 540,
    height: 1024,
    blocks: [{ id: 'hero', name: 'Hero', x: 40, y: 80, width: 460, height: 620, zIndex: 1 }],
    graph: {
      schemaVersion: 2,
      nodes: [{
        id: 'legacy-layout',
        type: 'layout',
        title: 'Legacy layout',
        position: { x: 80, y: 80 },
        width: 360,
        height: 280,
        data: { blocks: [{ id: 'hero', name: 'Hero', x: 40, y: 80, width: 460, height: 620, zIndex: 1 }] },
      }],
      edges: [],
      lineage: [],
    },
  })
  const fixture = mountWorkspaceFixture({ project, resources: [], results: [] })
  const { host, state, handle } = fixture
  const aspect = 540 / 1024

  const legacyPreview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'legacy-layout')
  const legacyWidth = parseFloat(legacyPreview.style.width)
  const legacyHeight = parseFloat(legacyPreview.style.height)
  assert.ok(legacyWidth <= 338 && legacyHeight <= 190)
  assert.ok(Math.abs(legacyWidth / legacyHeight - aspect) < 0.001, 'old fixed cards must contain rather than stretch portrait previews')

  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'layout')
    .dispatchEvent({ type: 'click', bubbles: false })
  const created = state.project.graph.nodes.filter((node) => node.type === 'layout' && node.id !== 'legacy-layout')[0]
  assert.ok(created)
  assert.ok(Math.abs((created.width - 22) / (created.height - 90) - aspect) < 0.001)
  const createdPreview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', created.id)
  assert.ok(Math.abs(parseFloat(createdPreview.style.width) / parseFloat(createdPreview.style.height) - aspect) < 0.001)
  handle.destroy()
})

test('generator forwards its identity to prompt mentions and the dedicated design assistant', () => {
  const mentionMounts = []
  const assistantRequests = []
  const fixture = mountWorkspaceFixture({
    mountPromptMentions(textarea, details) {
      mentionMounts.push({ textarea, details: plain(details) })
      return { unmount() {} }
    },
    onOpenDesignAssistant(payload) {
      assistantRequests.push(payload)
      return false
    },
  })
  const { host, handle } = fixture
  assert.equal(mentionMounts.length, 1)
  assert.equal(mentionMounts[0].details.generatorNodeId, 'generator-a')
  assert.equal(mentionMounts[0].details.provider, 'local')
  assert.equal(mentionMounts[0].textarea.getAttribute('data-novaflow-ui-design-prompt-field'), 'prompt')

  findByAttribute(host, 'data-novaflow-ui-design-design-assistant', '1')
    .dispatchEvent({ type: 'click', bubbles: false })
  assert.equal(assistantRequests.length, 1)
  assert.equal(assistantRequests[0].generatorNodeId, 'generator-a')
  assert.equal(typeof assistantRequests[0].apply, 'function')
  handle.destroy()
})

test('generator settings persist stable @ reference identity snapshots', () => {
  const fixture = mountWorkspaceFixture()
  const { handle } = fixture
  const updated = handle.patchGeneratorSettings('generator-a', {
    promptMentionBindings: { '@参考图1': 'resource-stable-id' },
    promptMentionSourceOrder: ['resource-stable-id', 'second-resource'],
  })
  assert.notEqual(updated?.ok, false)
  const settings = handle.getGeneratorSettings('generator-a').generationSettings
  assert.deepEqual(plain(settings.promptMentionBindings), { '@参考图1': 'resource-stable-id' })
  assert.deepEqual(plain(settings.promptMentionSourceOrder), ['resource-stable-id', 'second-resource'])
  handle.destroy()
})

test('generator output settings project the connected layout preview without changing its coordinate space', () => {
  const { structure } = loadUiDesignApis()
  let project = connectedProject(structure, { results: false })
  const configured = structure.updateGraphNode(project.graph, 'generator-a', {
    data: {
      generationSettings: { provider: 'local', localEditStrength: 'faithful', randomSeed: true },
      output: { width: 1080, height: 1920 },
      settingsExpanded: false,
    },
  })
  project = structure.normalize({ ...project, graph: configured.graph })
  const fixture = mountWorkspaceFixture({ project, resources: [], results: [] })
  const { host, state, handle } = fixture

  let preview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  assert.equal(preview.style.aspectRatio, '1080 / 1920')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-layout-output', 'layout-a').textContent, '结构 1080 × 1920')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-layout-aspect-warning', 'layout-a'), null)
  assert.ok(findByAttribute(host, 'data-novaflow-ui-design-generator-controls', 'generator-a'))
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-provider', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-node-params-body', '1').hidden, false)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-node-params-toggle', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-node', 'generator-a').style.height, '686px')

  let prompt = findByAttribute(host, 'data-novaflow-ui-design-prompt-field', 'prompt')
  prompt.value = 'ornate fantasy lobby with strong visual hierarchy'
  prompt.dispatchEvent({ type: 'input', bubbles: false })
  prompt.dispatchEvent({ type: 'change', bubbles: false })
  let negativePrompt = findByAttribute(host, 'data-novaflow-ui-design-prompt-field', 'negativePrompt')
  negativePrompt.value = 'avoid tiny labels and muddy contrast'
  negativePrompt.dispatchEvent({ type: 'input', bubbles: false })
  negativePrompt.dispatchEvent({ type: 'change', bubbles: false })
  assert.deepEqual(plain(handle.getGeneratorSettings('generator-a').generationSettings), {
    provider: 'local',
    localEditStrength: 'faithful',
    randomSeed: true,
    seed: 0,
    nsfw: false,
    prompt: 'ornate fantasy lobby with strong visual hierarchy',
    negativePrompt: 'avoid tiny labels and muddy contrast',
    negativePromptSource: 'user',
    gptQualityImg2img: 'low',
    gptSize: 'Custom',
    gptCustomWidth: 1080,
    gptCustomHeight: 1920,
    googleAspectRatioImg2img: '9:16',
    googleResolution: '1K',
  })

  const preset = findByAttribute(host, 'data-novaflow-ui-design-output-size-preset', '1')
  preset.value = '1920x1080'
  preset.dispatchEvent({ type: 'change', bubbles: false })
  const generator = state.project.graph.nodes.find((node) => node.id === 'generator-a')
  assert.deepEqual(plain(generator.data.output), { width: 1920, height: 1080 })
  preview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  assert.equal(preview.style.aspectRatio, '1920 / 1080')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-layout-output', 'layout-a').textContent, '结构 1920 × 1080')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-layout-aspect-warning', 'layout-a'), null)
  assert.deepEqual(plain(handle.getGeneratorSettings('generator-a').output), { width: 1920, height: 1080 })
  const layout = state.project.graph.nodes.find((node) => node.id === 'layout-a')
  assert.deepEqual(plain({ width: state.project.width, height: state.project.height }), { width: 1280, height: 720 })
  assert.deepEqual(
    plain(layout.data.blocks.map((block) => ({ id: block.id, x: block.x, y: block.y, width: block.width, height: block.height }))),
    [
      { id: 'hero', x: 80, y: 60, width: 800, height: 400 },
      { id: 'footer', x: 80, y: 560, width: 1120, height: 100 },
    ],
  )

  assert.equal(state.project.graph.nodes.find((node) => node.id === 'generator-a').height, 686)
  handle.patchGeneratorSettings('generator-a', { provider: 'gpt' })
  assert.equal(state.project.graph.nodes.find((node) => node.id === 'generator-a').height, 578)
  handle.patchGeneratorSettings('generator-a', { provider: 'google' })
  assert.equal(state.project.graph.nodes.find((node) => node.id === 'generator-a').height, 586)
  handle.patchGeneratorSettings('generator-a', { provider: 'local' })
  const randomSeed = findByAttribute(host, 'data-novaflow-ui-design-param', 'randomSeed')
  assert.equal(randomSeed.getAttribute('role'), 'switch')
  assert.equal(randomSeed.getAttribute('aria-checked'), 'true')
  randomSeed.dispatchEvent({ type: 'click', button: 0, bubbles: false })
  assert.equal(state.project.graph.nodes.find((node) => node.id === 'generator-a').height, 686)
  prompt = findByAttribute(host, 'data-novaflow-ui-design-prompt-field', 'prompt')
  negativePrompt = findByAttribute(host, 'data-novaflow-ui-design-prompt-field', 'negativePrompt')
  assert.equal(prompt.value, 'ornate fantasy lobby with strong visual hierarchy')
  assert.equal(negativePrompt.value, 'avoid tiny labels and muddy contrast')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-node-params-body', '1').hidden, false)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-node', 'generator-a').style.height, '686px')
  handle.destroy()
})

test('shared layouts follow the selected generator and stay neutral when selection is ambiguous', () => {
  const { structure } = loadUiDesignApis()
  let project = connectedProject(structure, { results: false })
  let configured = structure.updateGraphNode(project.graph, 'generator-a', {
    data: { output: { width: 1920, height: 1080 } },
  })
  const created = structure.createGraphNode(configured.graph, {
    id: 'generator-b',
    type: 'generator',
    title: 'Portrait Generator',
    position: { x: 980, y: 100 },
    data: { output: { width: 1152, height: 2048 } },
  })
  assert.equal(created.ok, true)
  configured = structure.connectGraph(created.graph, {
    id: 'edge-layout-b',
    fromNodeId: 'layout-a',
    fromPort: 'layout',
    toNodeId: 'generator-b',
    toPort: 'layout',
    kind: 'layout',
  })
  assert.equal(configured.ok, true)
  project = structure.normalize({ ...project, graph: configured.graph })

  const fixture = mountWorkspaceFixture({ project, resources: [], results: [] })
  const { host, state, handle } = fixture
  let preview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  assert.equal(preview.style.aspectRatio, '1280 / 720')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-layout-output', 'layout-a').textContent, '结构 1280 × 720')

  assert.equal(handle.focusGenerator('generator-b'), true)
  preview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  assert.equal(preview.style.aspectRatio, '1152 / 2048')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-layout-output', 'layout-a').textContent, '结构 1152 × 2048')

  assert.equal(handle.focusGenerator('generator-a'), true)
  preview = findByAttribute(host, 'data-novaflow-ui-design-layout-preview', 'layout-a')
  assert.equal(preview.style.aspectRatio, '1920 / 1080')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-layout-output', 'layout-a').textContent, '结构 1920 × 1080')
  assert.deepEqual(plain({ width: state.project.width, height: state.project.height }), { width: 1280, height: 720 })
  handle.destroy()
})

test('reference cards expose no analysis action and starter workflows connect references directly to generators', () => {
  const { structure } = loadUiDesignApis()
  const project = structure.normalize({
    id: 'starter-project',
    width: 1280,
    height: 720,
    blocks: [],
    graph: { schemaVersion: 2, nodes: [], edges: [], lineage: [] },
  })
  const reference = { id: 'resource-a', name: 'layout-reference.png', dataUrl: 'data:image/png;base64,UkVGRVJFTkNF' }
  const fixture = mountWorkspaceFixture({ project, resources: [reference], results: [] })
  const { host, state, handle } = fixture

  const created = handle.createWorkflowStarter('blank', { x: 0, y: 0 }, reference)
  assert.equal(created.ok, true)
  const referenceNode = state.project.graph.nodes.find((node) => node.type === 'reference' && node.data.resourceId === reference.id)
  assert.ok(referenceNode)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-reference-analyze', referenceNode.id), null)
  assert.equal(Object.prototype.hasOwnProperty.call(handle, 'setLayoutAnalysisStatus'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(handle, 'applyAnalyzedLayout'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(handle, 'confirmAnalyzedLayout'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(handle, 'discardAnalyzedLayout'), false)

  assert.ok(state.project.graph.edges.some((edge) => (
    edge.fromNodeId === referenceNode.id
      && edge.toNodeId === created.generatorNodeId
      && edge.fromPort === 'reference'
      && edge.toPort === 'reference'
      && edge.kind === 'reference'
  )))
  assert.equal(state.project.graph.edges.some((edge) => (
    edge.fromNodeId === referenceNode.id && edge.toNodeId === created.layoutNodeId
  )), false)
  handle.destroy()
})

test('generate flushes the focused prompt before reading generator settings', () => {
  const fixture = mountWorkspaceFixture()
  const { host, state, handle } = fixture
  const prompt = findByAttribute(host, 'data-novaflow-ui-design-prompt-field', 'prompt')
  prompt.value = 'polished fantasy login screen with a clear primary action'
  prompt.dispatchEvent({ type: 'input', bubbles: false })

  assert.equal(handle.getGeneratorSettings('generator-a').generationSettings.prompt, '')
  findByAttribute(host, 'data-novaflow-ui-design-node-generate-action', '1')
    .dispatchEvent({ type: 'click', bubbles: false })

  assert.equal(state.generations.length, 1)
  assert.equal(
    state.generations[0].generationSettings.prompt,
    'polished fantasy login screen with a clear primary action',
  )
  assert.equal(
    handle.getGeneratorSettings('generator-a').generationSettings.prompt,
    'polished fantasy login screen with a clear primary action',
  )
  handle.destroy()
})

test('connected edge paths stay attached during node move and layout-node resize previews', () => {
  const fixture = mountWorkspaceFixture()
  const { host, viewport, state, handle } = fixture

  let edge = findByAttribute(host, 'data-novaflow-ui-design-edge', 'edge-layout')
  const beforeMovePath = edge.getAttribute('d')
  const beforePosition = plain(state.project.graph.nodes.find((node) => node.id === 'layout-a').position)
  findByAttribute(host, 'data-novaflow-ui-design-node-drag-handle', 'layout-a')
    .dispatchEvent(pointer('pointerdown', 360, 130, 81))
  viewport.dispatchEvent(pointer('pointermove', 500, 250, 81))
  const movingCard = findByAttribute(host, 'data-novaflow-ui-design-node', 'layout-a')
  assert.equal(Number.isInteger(parseFloat(movingCard.style.left)), true)
  assert.equal(Number.isInteger(parseFloat(movingCard.style.top)), true)
  edge = findByAttribute(host, 'data-novaflow-ui-design-edge', 'edge-layout')
  assert.notEqual(edge.getAttribute('d'), beforeMovePath, 'edge path must update before the node move commits')
  assert.deepEqual(
    plain(state.project.graph.nodes.find((node) => node.id === 'layout-a').position),
    beforePosition,
    'drag preview should not write the graph on every pointer move',
  )
  viewport.dispatchEvent(pointer('pointerup', 500, 250, 81))
  assert.ok(findByAttribute(host, 'data-novaflow-ui-design-edge', 'edge-layout'))
  const movedLayout = state.project.graph.nodes.find((node) => node.id === 'layout-a')
  assert.equal(Number.isInteger(movedLayout.position.x), true)
  assert.equal(Number.isInteger(movedLayout.position.y), true)

  edge = findByAttribute(host, 'data-novaflow-ui-design-edge', 'edge-layout')
  const beforeResizePath = edge.getAttribute('d')
  findByAttribute(host, 'data-novaflow-ui-design-node-resize', 'layout-a')
    .dispatchEvent(pointer('pointerdown', 600, 450, 82))
  viewport.dispatchEvent(pointer('pointermove', 820, 560, 82))
  const resizingCard = findByAttribute(host, 'data-novaflow-ui-design-node', 'layout-a')
  assert.equal(Number.isInteger(parseFloat(resizingCard.style.width)), true)
  assert.equal(Number.isInteger(parseFloat(resizingCard.style.height)), true)
  edge = findByAttribute(host, 'data-novaflow-ui-design-edge', 'edge-layout')
  assert.notEqual(edge.getAttribute('d'), beforeResizePath, 'edge path must update before the resize commits')
  viewport.dispatchEvent(pointer('pointerup', 820, 560, 82))
  assert.ok(findByAttribute(host, 'data-novaflow-ui-design-edge', 'edge-layout'))
  const resizedLayout = state.project.graph.nodes.find((node) => node.id === 'layout-a')
  assert.equal(Number.isInteger(resizedLayout.width), true)
  assert.equal(Number.isInteger(resizedLayout.height), true)
  handle.destroy()
})

test('incremental canvas nodes preserve the current camera until auto-fit is requested', () => {
  const fixture = mountWorkspaceFixture()
  const { host, viewport, world, document, state, handle } = fixture

  viewport.dispatchEvent({ type: 'wheel', deltaY: -120, clientX: 500, clientY: 300, bubbles: false })
  document.defaultView.flushTimers()
  const camera = world.style.transform

  handle.addReferenceResource(state.resources[0])
  assert.equal(world.style.transform, camera, 'adding a reference must not reset the user camera')
  handle.addResultNode({ id: 'result-camera', name: 'result-camera.png' }, 'generator-a')
  assert.equal(world.style.transform, camera, 'adding a generated result must not reset the user camera')
  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'generator')
    .dispatchEvent({ type: 'click', bubbles: false })
  assert.equal(world.style.transform, camera, 'adding an individual generator must not reset the user camera')

  findByAttribute(host, 'data-novaflow-ui-design-auto-fit', '1')
    .dispatchEvent({ type: 'click', bubbles: false })
  assert.notEqual(world.style.transform, camera, 'explicit auto-fit must still frame the expanded graph')
  handle.destroy()
})

test('refitIfFitted follows viewport changes only while the camera remains auto-fitted', () => {
  const fixture = mountWorkspaceFixture()
  const { viewport, world, document, handle } = fixture
  const initialTransform = world.style.transform

  viewport._rect = { left: 0, top: 0, width: 820, height: 520 }
  viewport.clientWidth = 820
  viewport.clientHeight = 520
  const refitted = handle.refitIfFitted()
  assert.ok(refitted && refitted.zoom > 0)
  assert.notEqual(world.style.transform, initialTransform)

  viewport.dispatchEvent({ type: 'wheel', deltaY: -120, clientX: 410, clientY: 260, bubbles: false })
  document.defaultView.flushTimers()
  const manualTransform = world.style.transform
  viewport._rect = { left: 0, top: 0, width: 1440, height: 900 }
  viewport.clientWidth = 1440
  viewport.clientHeight = 900
  assert.equal(handle.refitIfFitted(), false)
  assert.equal(world.style.transform, manualTransform, 'manual zoom must not be overwritten by viewport reflow')
  handle.destroy()
})

test('synchronous project reconciliation does not rebuild the canvas twice', () => {
  let handleRef = null
  let nodeRenderedByUpdate = null
  const fixture = mountWorkspaceFixture({
    onProjectChange(nextProject, detail, context) {
      if (!handleRef) return
      handleRef.update(nextProject)
      nodeRenderedByUpdate = findByAttribute(context.host, 'data-novaflow-ui-design-node', 'generator-a')
    },
  })
  handleRef = fixture.handle

  const patched = handleRef.patchGeneratorSettings('generator-a', { localEditStrength: 'creative' })
  assert.equal(patched.ok, true)
  assert.ok(nodeRenderedByUpdate)
  assert.equal(
    findByAttribute(fixture.host, 'data-novaflow-ui-design-node', 'generator-a'),
    nodeRenderedByUpdate,
    'commitGraph must reuse the synchronous external update render',
  )
  handleRef.destroy()
})

test('ports connect by left-button drag only and cancel cleanly on blank, incompatible, Escape, or pointercancel', () => {
  const fixture = mountWorkspaceFixture()
  const { host, viewport, document, state, handle } = fixture
  const switched = handle.patchGeneratorSettings('generator-a', { provider: 'gpt' })
  assert.equal(switched.ok, true)
  const summary = findByAttribute(host, 'data-novaflow-ui-design-generator-connection-summary', 'generator-a')
  assert.equal(summary.getAttribute('data-novaflow-ui-design-reference-count'), '2')
  assert.equal(summary.getAttribute('data-novaflow-ui-design-reference-limit'), '15')
  const originalEdges = plain(state.project.graph.edges)
  const source = () => findByAttribute(host, 'data-novaflow-ui-design-port', 'result-b:reference')
  const referenceTarget = () => findByAttribute(host, 'data-novaflow-ui-design-port', 'generator-a:reference')

  source().dispatchEvent({ type: 'click', bubbles: true })
  referenceTarget().dispatchEvent({ type: 'click', bubbles: true })
  assert.deepEqual(plain(state.project.graph.edges), originalEdges, 'two independent clicks must not use the removed connection mode')

  source().dispatchEvent(pointer('pointerdown', 1080, 460, 91))
  assert.ok(findByAttribute(host, 'data-novaflow-ui-design-pending-edge', '1'))
  viewport.dispatchEvent(pointer('pointermove', 760, 230, 91))
  assert.equal(referenceTarget().getAttribute('data-novaflow-ui-design-port-compatible'), 'true')
  document.hitTarget = referenceTarget()
  viewport.dispatchEvent(pointer('pointerup', 760, 230, 91))
  document.hitTarget = null
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-pending-edge', '1'), null)
  assert.equal(state.project.graph.edges.length, originalEdges.length + 1)
  assert.ok(state.project.graph.edges.some((edge) => edge.fromNodeId === 'result-b' && edge.toPort === 'reference'))

  const afterSuccess = plain(state.project.graph.edges)
  source().dispatchEvent(pointer('pointerdown', 1080, 460, 92))
  viewport.dispatchEvent(pointer('pointermove', 980, 640, 92))
  viewport.dispatchEvent(pointer('pointerup', 980, 640, 92))
  assert.deepEqual(plain(state.project.graph.edges), afterSuccess)

  const layoutOutput = findByAttribute(host, 'data-novaflow-ui-design-port', 'layout-a:layout')
  const iterationTarget = findByAttribute(host, 'data-novaflow-ui-design-port', 'generator-a:iteration')
  layoutOutput.dispatchEvent(pointer('pointerdown', 430, 140, 93))
  document.hitTarget = iterationTarget
  viewport.dispatchEvent(pointer('pointerup', 650, 220, 93))
  document.hitTarget = null
  assert.deepEqual(plain(state.project.graph.edges), afterSuccess)

  source().dispatchEvent(pointer('pointerdown', 1080, 460, 94))
  viewport.dispatchEvent(keydown('Escape', viewport))
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-pending-edge', '1'), null)
  assert.deepEqual(plain(state.project.graph.edges), afterSuccess)

  source().dispatchEvent(pointer('pointerdown', 1080, 460, 95))
  document.hitTarget = referenceTarget()
  viewport.dispatchEvent(pointer('pointercancel', 760, 230, 95))
  document.hitTarget = null
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-pending-edge', '1'), null)
  assert.deepEqual(plain(state.project.graph.edges), afterSuccess)
  handle.destroy()
})

test('legacy iteration edges stay compatible behind a clear modification-base chip', () => {
  const fixture = mountWorkspaceFixture()
  const { host, state, handle } = fixture
  const initialIteration = plain(state.project.graph.edges.find((edge) => edge.toPort === 'iteration'))
  assert.equal(initialIteration.fromNodeId, 'result-a')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-port', 'generator-a:iteration'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-edge', initialIteration.id), null)
  const chip = findByAttribute(host, 'data-novaflow-ui-design-modification-base', 'generator-a')
  assert.ok(chip)
  assert.match(chip.children[0].textContent, /修改底图/)
  findByAttribute(host, 'data-novaflow-ui-design-modification-base-clear', 'generator-a')
    .dispatchEvent({ type: 'click', bubbles: false })
  let iterations = state.project.graph.edges.filter((edge) => edge.toNodeId === 'generator-a' && edge.toPort === 'iteration')
  assert.equal(iterations.length, 0)

  findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', 'undo')
    .dispatchEvent({ type: 'click', bubbles: false })
  iterations = state.project.graph.edges.filter((edge) => edge.toNodeId === 'generator-a' && edge.toPort === 'iteration')
  assert.equal(iterations.length, 1)
  assert.equal(iterations[0].fromNodeId, initialIteration.fromNodeId, 'one undo must restore the hidden compatibility edge')
  assert.ok(findByAttribute(host, 'data-novaflow-ui-design-modification-base', 'generator-a'))
  handle.destroy()
})

test('canvas chrome keeps only workflow tools, a top-right auto-fit action, and safe port rails', () => {
  const fixture = mountWorkspaceFixture()
  const { host, viewport, world, document, state, handle } = fixture
  for (const action of ['reference', 'layout', 'generator', 'region', 'undo', 'redo']) {
    assert.ok(findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', action), action)
  }
  for (const removed of ['select', 'pan', 'connect', 'generate']) {
    assert.equal(findByAttribute(host, 'data-novaflow-ui-design-toolbar-action', removed), null, removed)
  }
  const bottomDock = findByAttribute(host, 'data-novaflow-ui-design-bottom-dock', '1')
  const toolbar = findByAttribute(host, 'data-novaflow-ui-design-toolbar', '1')
  assert.deepEqual(bottomDock.children, [toolbar], 'bottom dock must not duplicate the generator action')
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-zoom-controls', '1'), null)
  assert.equal(findByAttribute(host, 'data-novaflow-ui-design-zoom', '1'), null)
  assert.equal(viewport.getAttribute('data-preview-ui'), '1', 'UI canvas must opt out of the shared preview pan handler')

  const fit = findByAttribute(host, 'data-novaflow-ui-design-auto-fit', '1')
  assert.ok(fit)
  assert.equal(fit.textContent, '自动适配')
  assert.equal(fit.style.top, '8px')
  assert.equal(fit.style.right, '8px')
  assert.equal(fit.style.width, '92px')
  assert.equal(fit.style.height, '34px')
  const beforeWheel = world.style.transform
  viewport.dispatchEvent({ type: 'wheel', deltaY: -120, clientX: 500, clientY: 300, bubbles: false })
  assert.notEqual(world.style.transform, beforeWheel, 'wheel zoom must remain available')
  assert.equal(world.style.willChange, 'auto')
  document.defaultView.flushTimers()
  assert.equal(world.style.willChange, 'auto')
  fit.dispatchEvent({ type: 'click', bubbles: false })
  assert.ok(handle.fit().zoom > 0)

  state.project.graph.nodes.forEach((node) => {
    const card = findByAttribute(host, 'data-novaflow-ui-design-node', node.id)
    const rail = findByAttribute(card, 'data-novaflow-ui-design-port-rail', node.id)
    assert.ok(rail, node.id)
    assert.equal(card.children[1], rail, 'the port rail must sit between header and content')
    const railHeight = parseFloat(rail.style.height)
    const ports = findAllByAttribute(card, 'data-novaflow-ui-design-port')
    ports.forEach((port) => {
      const top = parseFloat(port.style.top)
      assert.ok(top >= 42, node.id + ' port begins below the header')
      assert.ok(top + parseFloat(port.style.height) <= 42 + railHeight, node.id + ' port stays inside its reserved rail')
      assert.equal(port.tagName, 'SPAN', node.id + ' port hit target must avoid shared button CSS')
      assert.equal(port.style.width, '24px')
      assert.equal(port.style.height, '24px')
      assert.equal(port.style.background, 'transparent')
      const dot = findByAttribute(port, 'data-novaflow-ui-design-port-dot', port.getAttribute('data-novaflow-ui-design-port'))
      assert.ok(dot, node.id + ' port must contain an independent visible dot')
      assert.equal(dot.style.width, '12px')
      assert.equal(dot.style.height, '12px')
      assert.equal(dot.style.borderRadius, '50%')
      assert.equal(dot.style.pointerEvents, 'none')
    })
  })

  findByAttribute(host, 'data-novaflow-ui-design-node-generate-action', '1')
    .dispatchEvent({ type: 'click', bubbles: false })
  assert.equal(state.generations.length, 1)
  assert.equal(state.generations[0].project.graph.schemaVersion, fixture.structure.GRAPH_SCHEMA_VERSION)
  assert.equal(state.generations[0].layoutGuide.clean, true)
  assert.equal(state.generations[0].layoutGuide.editorSnapshot, false)
  assert.match(state.generations[0].layoutGuide.dataUrl, /^data:image\//)

  viewport.dispatchEvent({ type: 'wheel', deltaY: -120, clientX: 500, clientY: 300, bubbles: false })
  assert.equal(document.defaultView.timers.size, 0)
  handle.destroy()
  assert.equal(document.defaultView.timers.size, 0, 'canvas transforms must not leave a compositor settle timer')
})

test('file-picker references use the non-overlapping layout-side placement while explicit drops keep their point', async () => {
  const { structure, workspace } = loadUiDesignApis()
  const document = new FakeDocument()
  const host = document.createElement('div')
  let project = structure.normalize({
    id: 'picker-placement',
    width: 1280,
    height: 720,
    blocks: [{ id: 'hero', name: 'Hero', x: 50, y: 40, width: 900, height: 420 }],
  })
  const layout = project.graph.nodes.find((node) => node.type === 'layout')
  const moved = structure.updateGraphNode(project.graph, layout.id, { position: { x: 240, y: -80 } })
  project = structure.normalize({ ...project, graph: moved.graph })
  const resource = { id: 'picked-reference', name: 'picked.png', dataUrl: 'data:image/png;base64,UElDS0VE' }
  const handle = workspace.mount({
    host,
    getProject: () => project,
    getResources: () => [resource],
    getResults: () => [],
    async onImportFiles() { return [resource] },
    onProjectChange(next) { project = next },
  })

  const fileInput = findByAttribute(host, 'data-novaflow-ui-design-canvas-file-input', '1')
  fileInput.files = [{ name: 'picked.png' }]
  fileInput.dispatchEvent({ type: 'change', bubbles: false })
  await new Promise((resolve) => setImmediate(resolve))
  const picked = project.graph.nodes.find((node) => node.type === 'reference' && node.data.resourceId === resource.id)
  assert.ok(picked)
  assert.ok(picked.position.x < moved.node.position.x - 100, 'picker import must leave a visible gap left of the layout')

  const explicit = handle.addReferenceResource({ ...resource, id: 'dropped-reference' }, { x: 910, y: 340 }, 'reference')
  assert.equal(explicit.ok, true)
  assert.deepEqual(plain(explicit.node.position), { x: 910, y: 340 })
  handle.destroy()
})

test('a pending reference import cannot write back after the workspace is destroyed', async () => {
  let resolveImport
  const fixture = mountWorkspaceFixture({
    onImportFiles() {
      return new Promise((resolve) => { resolveImport = resolve })
    },
  })
  const { host, state, handle } = fixture
  const beforeProject = plain(state.project)
  const beforeChanges = state.changes.length
  const fileInput = findByAttribute(host, 'data-novaflow-ui-design-canvas-file-input', '1')
  fileInput.files = [{ name: 'late.png', type: 'image/png' }]
  fileInput.dispatchEvent({ type: 'change', bubbles: false })
  assert.equal(typeof resolveImport, 'function')

  handle.destroy()
  resolveImport([{ id: 'late-resource', name: 'late.png', dataUrl: 'data:image/png;base64,TEFURQ==' }])
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(plain(state.project), beforeProject)
  assert.equal(state.changes.length, beforeChanges)
  assert.equal(host.children.length, 0)
})

test('AI animation pan handlers are route-scoped so they cannot consume UI canvas right drags', () => {
  const source = fs.readFileSync(runtimePath, 'utf8')
  const functionStart = source.indexOf('function markAiAnimationUserCanvasPanIntent(event, mainStage)')
  const rightDragStart = source.indexOf('const isRightDrag = Boolean', functionStart)
  assert.ok(functionStart >= 0, 'AI animation pan intent function should exist')
  assert.ok(rightDragStart > functionStart, 'right-drag handling should remain inside the function')
  assert.match(
    source.slice(functionStart, rightDragStart),
    /document\.body\.classList\.contains\("novaflow-primary-target-animation"\)/,
  )
  const viewportFunctionStart = source.indexOf('function getAiSequencePreviewViewportForEvent(event)')
  const skeletonGuardStart = source.indexOf('if (isSkeletonAnimationEventTarget', viewportFunctionStart)
  assert.ok(viewportFunctionStart >= 0, 'AI preview event viewport resolver should exist')
  assert.ok(skeletonGuardStart > viewportFunctionStart, 'preview event checks should remain inside the resolver')
  assert.match(
    source.slice(viewportFunctionStart, skeletonGuardStart),
    /document\.body\.classList\.contains\("novaflow-primary-target-animation"\)/,
  )
})

test('fallback clean guide excludes labels, outlines and disabled blocks', () => {
  const { workspace } = loadUiDesignApis()
  const dataUrl = workspace.getSkeletonSvgDataUrl({
    id: 'p',
    title: 'Test',
    width: 800,
    height: 600,
    blocks: [
      { id: 'included', name: 'Included', x: 10, y: 10, width: 200, height: 100, participates: true },
      { id: 'excluded', name: 'Excluded', x: 10, y: 130, width: 200, height: 100, participates: false },
    ],
  })
  const svg = decodeURIComponent(dataUrl.split(',').slice(1).join(','))
  assert.match(svg, /x="10" y="10"/)
  assert.doesNotMatch(svg, /y="130"/)
  assert.doesNotMatch(svg, /Included|Excluded|<text|stroke=/)
})
