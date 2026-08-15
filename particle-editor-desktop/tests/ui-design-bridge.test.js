const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const bridgePath = path.join(root, 'particle-editor', 'ui-design.bridge.js')
const structurePath = path.join(root, 'particle-editor', 'ui-design.structure.tool.js')
const structureSandbox = { module: { exports: {} }, exports: {} }
structureSandbox.globalThis = structureSandbox
vm.runInNewContext(fs.readFileSync(structurePath, 'utf8'), structureSandbox, { filename: structurePath })
const structureTool = structureSandbox.module.exports
const resourcePath = path.join(root, 'particle-editor', 'ui-design.project.resource.js')
const inspectorPath = path.join(root, 'particle-editor', 'ui-design.inspector.tool.js')
const modePath = path.join(root, 'particle-editor', 'ui-design-mode.tool.js')
const accordionPath = path.join(root, 'particle-editor', 'left-panel-accordion.helper.js')
const indexPath = path.join(root, 'particle-editor', 'index.html')
const splitRuntimePath = path.join(root, 'particle-editor', 'spine-split-runtime.js')
const brandRuntimePath = path.join(root, 'particle-editor', 'novaflow-brand-runtime.js')
const syncPath = path.join(root, 'scripts', 'sync-runtime.mjs')
const checkPath = path.join(root, 'scripts', 'check-runtime-sync.mjs')
const removedLayoutAnalysisFiles = [
  path.join(root, 'particle-editor', 'ui-design-layout-analysis.workflow.js'),
  path.join(root, 'particle-editor-desktop', 'renderer', 'ui-design-layout-analysis.workflow.js'),
  path.join(root, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'ui-design-layout-analysis.workflow.js'),
]

test('UI Design bridge owns the UI route without taking over Drawing', () => {
  const context = { module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(bridgePath, 'utf8'), context, { filename: bridgePath })
  const bridge = context.module.exports
  const leftHost = { appendChild() {} }
  const workspaceHost = {
    appendChild() {},
    getBoundingClientRect() { return { width: 1000, height: 720 } },
  }
  const leftColumn = {
    appendChild() {},
    parentElement: { children: [] },
  }
  leftColumn.parentElement.children = [leftColumn, workspaceHost]
  const documentRef = {
    body: { classList: { contains: (name) => name === 'novaflow-primary-target-art' } },
    querySelector(selector) {
      if (selector === '[data-novaflow-art-ui-host="1"]') return leftHost
      if (selector === '[data-novaflow-left-column="1"]') return leftColumn
      return null
    },
  }

  const hosts = bridge.locateHosts(documentRef)
  assert.equal(hosts.active, true)
  assert.equal(hosts.leftHost, leftHost)
  assert.equal(hosts.workspaceHost, workspaceHost)

  documentRef.querySelector = (selector) => selector === '[data-novaflow-left-column="1"]' ? leftColumn : null
  assert.equal(bridge.isUiDesignRoute(documentRef), false, 'Drawing must not mount the independent UI workspace')
})

test('UI resource panel width follows the Drawing right workspace contract', () => {
  const bridgeSource = fs.readFileSync(bridgePath, 'utf8')
  const drawingSource = fs.readFileSync(splitRuntimePath, 'utf8')
  const uiWidth = bridgeSource.match(/const UI_RESOURCE_PANEL_WIDTH_PX = (\d+)/)
  const drawingWidth = drawingSource.match(/const SPLIT_RIGHT_WORKSPACE_WIDTH = (\d+)/)

  assert.ok(uiWidth, 'UI resource panel width constant must remain explicit')
  assert.ok(drawingWidth, 'Drawing right workspace width constant must remain explicit')
  assert.equal(Number(uiWidth[1]), Number(drawingWidth[1]))
  assert.ok(bridgeSource.includes('gridTemplateColumns: `minmax(0, 1fr) ${UI_RESOURCE_PANEL_WIDTH_PX}px`'))
})

test('UI Design entry loads all modules in dependency order and ships them through both runtime mirrors', () => {
  const index = fs.readFileSync(indexPath, 'utf8')
  const sync = fs.readFileSync(syncPath, 'utf8')
  const check = fs.readFileSync(checkPath, 'utf8')
  const modules = [
    'left-panel-accordion.helper.js',
    'ui-design.structure.tool.js',
    'ui-design.inspector.tool.js',
    'ui-design.project.resource.js',
    'ui-design.preview.js',
    'ui-design-layout-guide.helper.js',
    'ui-design-image-preview.dialog.js',
    'ui-design.workspace.js',
    'ui-design-generate.workflow.js',
    'ui-design-generate.tool.js',
    'ui-design-mode.tool.js',
    'ui-design-assistant.workflow.js',
    'ui-design-assistant.dialog.js',
    'ui-design.bridge.js',
  ]
  let previousIndex = -1
  modules.forEach((fileName) => {
    const currentIndex = index.indexOf(`./${fileName}`)
    assert.ok(currentIndex > previousIndex, `${fileName} must load after its UI Design dependencies`)
    previousIndex = currentIndex
    assert.match(sync, new RegExp(fileName.replaceAll('.', '\\.')))
    assert.match(check, new RegExp(fileName.replaceAll('.', '\\.')))
  })
  assert.doesNotMatch(index, /ui-design-layout-analysis\.workflow\.js/)
  removedLayoutAnalysisFiles.forEach((filePath) => assert.equal(fs.existsSync(filePath), false, `${filePath} must be removed`))
  assert.ok(index.indexOf('./novaflow-client-auth.js') < index.indexOf('./ui-design-generate.tool.js'))
})

test('Drawing exposes one-shot silent shared-resource registration and full replacement notifications', () => {
  const source = fs.readFileSync(splitRuntimePath, 'utf8')
  const appendSection = source.slice(source.indexOf('function appendSourceResource'), source.indexOf('function syncActiveSourceResourceFromState'))
  const restoreSection = source.slice(source.indexOf('function restoreImageOutpaintStateSnapshot'), source.indexOf('async function commitImageOutpaintResult'))
  const publicBridge = source.slice(source.indexOf('window.NovaFlowSpineSplitBridge = {'))
  assert.match(appendSection, /activateSourceResource\(next\.id, \{ \.\.\.options, notify: false \}\)/)
  assert.equal((appendSection.match(/notifySourceResourceChange\('add'/g) || []).length, 1)
  assert.match(restoreSection, /notifySourceResourceChange\('replace'/)
  assert.match(publicBridge, /supportsSilentSourceResourceRegistration:\s*true/)
  assert.match(publicBridge, /registerSourceDataUrlResource/)
  assert.match(publicBridge, /getSourceResources/)
  assert.match(publicBridge, /subscribeSourceResources/)
})

test('persisted graph drops asset nodes that cannot be restored without their image resources', () => {
  let initialState = null
  const persisted = {
    project: {
      width: 1280,
      height: 720,
      graph: {
        schemaVersion: 2,
        nodes: [
          { id: 'layout-1', type: 'layout', data: { blocks: [] } },
          { id: 'reference-1', type: 'reference', data: { resourceId: 'missing-resource' } },
          { id: 'result-1', type: 'result', data: { resultId: 'missing-result' } },
        ],
        edges: [
          { id: 'edge-1', fromNodeId: 'reference-1', toNodeId: 'layout-1' },
        ],
        lineage: [{ resultId: 'missing-result', resultNodeId: 'result-1' }],
      },
    },
    settings: { provider: 'local' },
  }
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem(key) {
        if (key === 'novaflow-ui-design-project-initialized-v1') return '1'
        return JSON.stringify(persisted)
      },
    },
    NovaFlowUiDesignProjectResource: {
      createProjectStore(initial) {
        initialState = initial
        return { getState() { return { project: initial.project || {}, settings: initial.settings || {} } } }
      },
    },
  }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(bridgePath, 'utf8'), context, { filename: bridgePath })
  context.module.exports.ensureStore()
  assert.deepEqual(Array.from(initialState.project.graph.nodes, (node) => node.id), ['layout-1'])
  assert.deepEqual(Array.from(initialState.project.graph.edges), [])
  assert.deepEqual(Array.from(initialState.project.graph.lineage), [])
})

test('first UI entry ignores legacy auto-saved graph until the user has explicitly started a project', () => {
  let initialState = null
  const persisted = {
    project: {
      graph: {
        schemaVersion: 2,
        nodes: [
          { id: 'layout-legacy', type: 'layout', data: { blocks: [] } },
          { id: 'generator-legacy', type: 'generator', data: {} },
        ],
        edges: [],
        lineage: [],
      },
    },
  }
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem(key) {
        if (key === 'novaflow-ui-design-project-v1') return JSON.stringify(persisted)
        return null
      },
    },
    NovaFlowUiDesignProjectResource: {
      createProjectStore(initial) {
        initialState = initial
        return { getState() { return { project: initial.project || {}, settings: initial.settings || {} } } }
      },
    },
  }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(bridgePath, 'utf8'), context, { filename: bridgePath })
  context.module.exports.ensureStore()
  assert.equal(Object.keys(initialState).length, 0)
  assert.equal(context.module.exports.INITIALIZED_STORAGE_KEY, 'novaflow-ui-design-project-initialized-v1')
  const source = fs.readFileSync(bridgePath, 'utf8')
  assert.match(source, /Array\.isArray\(nodes\) && nodes\.length/)
  assert.match(source, /setItem\?\.\(INITIALIZED_STORAGE_KEY, '1'\)/)
})

test('Drawing and UI share Mode and Attribute terminology without moving generation ownership', () => {
  const source = fs.readFileSync(bridgePath, 'utf8')
  const modeSource = fs.readFileSync(modePath, 'utf8')
  const accordionSource = fs.readFileSync(accordionPath, 'utf8')
  const drawingSource = fs.readFileSync(splitRuntimePath, 'utf8')
  const brandRuntimeSource = fs.readFileSync(brandRuntimePath, 'utf8')
  const attributeSection = source.slice(source.indexOf('function createAttributeSection'), source.indexOf('function createSplitPlaceholder'))
  assert.match(drawingSource, /id:\s*'generate',[\s\S]*?label:\s*'模式'/)
  assert.match(modeSource, /text:\s*'模式'/)
  assert.match(source, /text:\s*'属性'/)
  assert.doesNotMatch(source, /text:\s*'布局设计'/)
  assert.match(source, /text:\s*'UI 拆图'/)
  assert.match(source, /disabled:\s*true/)
  assert.doesNotMatch(source, /text:\s*'结构工具'/)
  assert.doesNotMatch(source, /text:\s*'导出'/)
  assert.match(attributeSection, /'aria-expanded':\s*'false'/)
  assert.match(attributeSection, /'data-novaflow-left-accordion-panel':\s*'1'/)
  assert.match(attributeSection, /style:\s*accordion\.bodyStyle\(false\)/)
  assert.match(attributeSection, /let expanded = false/)
  assert.match(attributeSection, /className:\s*'fas fa-sliders-h'/)
  assert.match(attributeSection, /accordion\.chevronClass\(false\)/)
  assert.match(attributeSection, /accordion\.syncExpanded\(section, header, body, chevron, expanded\)/)
  assert.doesNotMatch(attributeSection, /text:\s*'›'|text:\s*'⌄'/)
  assert.match(modeSource, /NovaFlowClientAuth/)
  assert.match(modeSource, /data-novaflow-ui-design-mode-provider/)
  assert.match(modeSource, /'data-novaflow-left-accordion-panel':\s*'1'/)
  assert.match(modeSource, /className:\s*'fas fa-magic'/)
  assert.match(modeSource, /style:\s*accordion\.headerStyle\(false\)/)
  assert.match(modeSource, /style:\s*accordion\.bodyStyle\(false\)/)
  assert.match(modeSource, /record\.accordion\.syncExpanded/)
  assert.match(accordionSource, /headerHeight:\s*'36px'/)
  assert.match(accordionSource, /headerPadding:\s*'0 12px'/)
  assert.match(accordionSource, /bodyPadding:\s*'6px 12px 8px'/)
  assert.match(accordionSource, /bodyGap:\s*'6px'/)
  assert.match(drawingSource, /window\.NovaFlowLeftPanelAccordion/)
  assert.match(brandRuntimeSource, /data-novaflow-left-accordion-panel/)
  assert.match(drawingSource, /SPLIT_LEFT_PANEL_ACCORDION\?\.headerStyle\?\.\(expanded\)/)
  assert.match(source, /workspaceHandle\.patchGeneratorSettings\?\.\(generatorId, \{ provider \}\)/)
  const entrySource = fs.readFileSync(indexPath, 'utf8')
  assert.match(entrySource, /left-panel-accordion\.helper\.js\?v=20260723-ui-layout-projection-1/)
  assert.match(entrySource, /novaflow-brand-runtime\.js\?v=20260813-ideogram-instant-1/)
  assert.match(entrySource, /ui-design-image-preview\.dialog\.js\?v=20260723-ui-result-preview-1/)
  assert.match(entrySource, /ui-design\.workspace\.js\?v=20260724-ui-selection-snapshot-1/)
  assert.match(entrySource, /ui-design-generate\.tool\.js\?v=20260724-ui-random-seed-default-1/)
  assert.match(entrySource, /ui-design-mode\.tool\.js\?v=20260723-ui-layout-projection-1/)
  assert.match(entrySource, /ui-design\.bridge\.js\?v=20260730-ui-local-strict-retry-1/)
  assert.ok(entrySource.indexOf('./left-panel-accordion.helper.js') < entrySource.indexOf('./spine-split-runtime.js'))
  assert.ok(entrySource.indexOf('./left-panel-accordion.helper.js') < entrySource.indexOf('./ui-design-mode.tool.js'))
  assert.doesNotMatch(source, /data-novaflow-ui-design-generate-host/)
  assert.doesNotMatch(source, /generateHandle/)
  assert.doesNotMatch(source, /getReferenceResources\(\)\.slice/, 'unconnected resources must not enter graph generation')
  assert.match(source, /NovaFlowUiDesignGenerateWorkflow/)
})

test('canvas generation is owned by each generator node instead of the removed left generator panel', () => {
  const source = fs.readFileSync(bridgePath, 'utf8')
  const start = source.indexOf('async function runGeneration')
  const end = source.indexOf('\n  function mountUi', start)
  const runGeneration = source.slice(start, end)
  assert.doesNotMatch(runGeneration, /generateHandle|generateTool/)
  assert.match(runGeneration, /generatorProfile\(state, context\.generator\)/)
  assert.match(runGeneration, /generatorNodeId/)
  assert.match(source, /workspaceHandle\?\.setGeneratorStatus\?/)
  assert.match(source, /getGeneratorSettings\?/)
  assert.match(source, /modeHandle\?\.update\?\.\(\)/)
  assert.match(source, /generatorProfile\(state, generator, false\)/, 'workspace fallback state must not read back through the workspace API')
})

test('reference and result inspector actions keep layout recognition out of the primary workflow', () => {
  const source = fs.readFileSync(inspectorPath, 'utf8')
  const reference = source.slice(source.indexOf('function renderReference'), source.indexOf('function renderLayout'))
  const layout = source.slice(source.indexOf('function renderLayout'), source.indexOf('function renderGenerator'))
  const generator = source.slice(source.indexOf('function renderGenerator'), source.indexOf('function renderResult'))
  const result = source.slice(source.indexOf('function renderResult'), source.indexOf('function render()'))
  assert.doesNotMatch(reference, /识别为页面结构|analyze-layout/)
  assert.doesNotMatch(layout, /重新识别|analyze-layout/)
  assert.doesNotMatch(reference, /data\.role.*===\s*'layout'/)
  assert.match(layout, /field\('页面目标',\s*data\.description/)
  assert.doesNotMatch(layout, /页面说明|整体生成要求|data\.requirements/)
  assert.doesNotMatch(generator, /inspector-generate|onGenerate/)
  assert.match(result, /设为修改底图/)
  assert.doesNotMatch(result, /送入绘图|result-edit|onSendResultToDrawing/)
})

test('UI bridge exposes no automatic layout-analysis workflow', () => {
  const source = fs.readFileSync(bridgePath, 'utf8')
  assert.doesNotMatch(source, /analyzeLayoutReference|layoutAnalysisPromises|layoutAnalysisEpoch|layoutAnalysisSequence/)
  assert.doesNotMatch(source, /NovaFlowUiDesignLayoutAnalysisWorkflow|onAnalyzeLayout|setLayoutAnalysisStatus|applyAnalyzedLayout/)
})

test('Local UI quality retry keeps the stronger reviewed candidate instead of blindly preferring the newer image', () => {
  const { bridge } = loadBehaviorBridge([], async () => {
    throw new Error('generation is not used by this comparator test')
  })
  const first = {
    status: 'FAIL',
    failureCodes: ['STRUCTURE_MISSING'],
    hardFailures: ['back and status-banner are missing'],
    scores: {
      themeAdherence: 78,
      structureAdherence: 68,
      referenceLeakage: 85,
      readability: 62,
      commercialFinish: 72,
      commercialCompleteness: 70,
    },
  }
  const worseRetry = {
    ...first,
    scores: {
      ...first.scores,
      themeAdherence: 55,
      structureAdherence: 48,
      readability: 40,
      commercialFinish: 58,
      commercialCompleteness: 50,
    },
  }
  assert.equal(bridge.qualityRetryImproves(first, worseRetry), false)
  assert.equal(bridge.qualityRetryImproves(first, { status: 'PASS', hardFailures: [], failureCodes: [] }), true)
  assert.equal(bridge.qualityRetryImproves(first, first), false)
  const firstWithChecklist = {
    ...first,
    failedChecklistTokens: ['region-1:back', 'region-2:status-banner'],
  }
  const retryWithFewerChecklistFailures = {
    ...first,
    failedChecklistTokens: ['region-1:back'],
  }
  assert.equal(bridge.qualityRetryImproves(firstWithChecklist, retryWithFewerChecklistFailures), true)
  assert.equal(bridge.qualityRetryImproves(retryWithFewerChecklistFailures, firstWithChecklist), false)
  assert.equal(bridge.qualityRetryImproves(firstWithChecklist, {
    ...retryWithFewerChecklistFailures,
    scores: {
      ...first.scores,
      commercialFinish: 45,
      commercialCompleteness: 40,
    },
  }), false)
  assert.equal(bridge.qualityRetryImproves(
    { status: 'FAIL', failureCodes: ['STRUCTURE_MISSING'], failedChecklistTokens: ['region-1:back'] },
    { status: 'FAIL', failureCodes: [], failedChecklistTokens: [] },
  ), false)
})

test('inspector patches preserve the selection snapshot captured by the edited field', () => {
  const source = fs.readFileSync(bridgePath, 'utf8')
  const callbackStart = source.indexOf('onPatchSelection(selection, patch)')
  const callbackEnd = source.indexOf('onRemoveSelection()', callbackStart)
  const callback = source.slice(callbackStart, callbackEnd)

  assert.ok(callbackStart >= 0, 'bridge must expose the inspector patch callback')
  assert.match(callback, /workspaceHandle\.patchSelection\?\.\(selection,\s*patch\)/)
  assert.doesNotMatch(callback, /workspaceHandle\.patchSelection\?\.\(patch\)/)
})

test('leaving the UI route always closes the design assistant session', () => {
  let closes = 0
  const context = {
    module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout,
    NovaFlowUiDesignAssistantDialog: { close(reason) { closes += 1; assert.equal(reason, 'route-change') } },
  }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(bridgePath, 'utf8'), context, { filename: bridgePath })
  assert.equal(context.module.exports.deactivate(), false)
  assert.equal(closes, 1)
})

function loadBehaviorBridge(blocks, workflowRun, extraContext = {}) {
  const normalizedBlocks = Array.isArray(blocks) ? blocks : []
  const drawingResources = []
  const state = {
    project: {
      width: 1920,
      height: 1080,
      blocks: normalizedBlocks,
      graph: {
        schemaVersion: 2,
        nodes: [
          { id: 'layout-1', type: 'layout', data: { blocks: normalizedBlocks } },
          { id: 'generator-1', type: 'generator', data: {} },
        ],
        edges: [{ id: 'layout-edge', fromNodeId: 'layout-1', fromPort: 'layout', toNodeId: 'generator-1', toPort: 'layout', kind: 'layout' }],
        lineage: [],
      },
    },
    settings: { provider: 'local' },
    resources: [],
    results: [],
  }
  const store = {
    getState() { return state },
    serializeProject() { return state.project },
    getReferenceResources() { return [] },
    addResult(result) {
      state.results.push(result)
      return result
    },
    removeResult(id) {
      const index = state.results.findIndex((item) => item.id === id)
      if (index < 0) return false
      state.results.splice(index, 1)
      return true
    },
    recordResultLineage() {},
  }
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    NovaFlowUiDesignProjectResource: { createProjectStore() { return store } },
    NovaFlowUiDesignStructureTool: { normalizeGraph(value) { return value } },
    NovaFlowUiDesignLayoutGuide: {
      createCleanLayoutGuide(project) {
        return {
          kind: 'ui-layout-guide',
          role: 'ui_layout',
          clean: true,
          editorSnapshot: false,
          dataUrl: 'data:image/png;base64,GUIDE',
          semantic: { schemaVersion: 1, description: project.description, regions: project.blocks },
        }
      },
    },
    NovaFlowUiDesignGenerateWorkflow: { run: workflowRun },
    NovaFlowSpineSplitBridge: {
      getSourceResources() { return drawingResources.slice() },
      async registerSourceDataUrlResource(fileName, dataUrl, options) {
        const resource = {
          id: `drawing-${options.externalId}`,
          fileName,
          name: fileName,
          dataUrl,
          origin: options.origin,
          externalId: options.externalId,
        }
        drawingResources.push(resource)
        return resource
      },
      deleteSourceResource(id) {
        const index = drawingResources.findIndex((item) => item.id === id)
        if (index >= 0) drawingResources.splice(index, 1)
        return index >= 0
      },
    },
    ...extraContext,
  }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(bridgePath, 'utf8'), context, { filename: bridgePath })
  return { bridge: context.module.exports, state }
}

test('runGeneration rejects empty and fully excluded projects without submitting work', async (t) => {
  for (const fixture of [
    { name: 'empty project', blocks: [], message: /创建页面结构.*布局块/ },
    { name: 'all blocks excluded', blocks: [{ id: 'hero', participates: false }], message: /启用一个参与生成的布局块/ },
  ]) {
    await t.test(fixture.name, async () => {
      let workflowCalls = 0
      const { bridge } = loadBehaviorBridge(fixture.blocks, async () => {
        workflowCalls += 1
        return { dataUrl: 'data:image/png;base64,UNEXPECTED' }
      })
      await assert.rejects(
        () => bridge.runGeneration({ skeletonDataUrl: 'data:image/svg+xml;base64,SKELETON' }),
        fixture.message,
      )
      assert.equal(workflowCalls, 0)
    })
  }
})

test('runGeneration deduplicates concurrent entry points and stores one result', async () => {
  let workflowCalls = 0
  let resolveWorkflow
  const deferred = new Promise((resolve) => { resolveWorkflow = resolve })
  const { bridge, state } = loadBehaviorBridge([
    { id: 'hero', name: 'Hero', participates: true },
  ], () => {
    workflowCalls += 1
    return deferred
  })
  const request = { skeletonDataUrl: 'data:image/svg+xml;base64,SKELETON' }
  const first = bridge.runGeneration(request)
  const second = bridge.runGeneration(request)
  assert.equal(workflowCalls, 1)
  resolveWorkflow({ id: 'generated-1', dataUrl: 'data:image/png;base64,RESULT' })
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.deepEqual(firstResult, secondResult)
  assert.equal(state.results.length, 1)
  assert.equal(state.results[0].id, 'generated-1')
})

test('Local UI compiles generator grid semantics into the soft layout guide', async () => {
  let guideOptions = null
  const { bridge, state } = loadBehaviorBridge([
    { id: 'content', name: '主内容区域', role: 'content', participates: true },
  ], async () => ({
    id: 'generated-grid-guide',
    dataUrl: 'data:image/png;base64,GRID',
  }), {
    NovaFlowUiDesignLayoutGuide: {
      createCleanLayoutGuide(project, options) {
        guideOptions = options
        return {
          kind: 'ui-layout-guide',
          role: 'ui_layout',
          clean: true,
          editorSnapshot: false,
          dataUrl: 'data:image/png;base64,GUIDE',
          semantic: { schemaVersion: 1, description: project.description, regions: project.blocks },
        }
      },
    },
  })
  state.settings.prompt = '中间主内容区域为3×3老虎机转轴，底部保留Spin按钮'

  await bridge.runGeneration({ generatorNodeId: 'generator-1' })
  assert.equal(guideOptions.visualEncoding, 'soft-ui-semantic-scaffold-v2')
  assert.equal(guideOptions.semanticSubgrid, true)
  assert.equal(guideOptions.semanticText, state.settings.prompt)
})

test('Local UI quality review freezes a generated fallback target when the user prompt is empty', async () => {
  const reviews = []
  const { bridge } = loadBehaviorBridge([
    { id: 'content', name: '主内容区域', role: 'content', participates: true },
  ], async () => ({
    id: 'generated-empty-prompt',
    generationPrompt: '根据页面结构生成完整游戏UI',
    dataUrl: 'data:image/png;base64,EMPTY_PROMPT',
  }), {
    NovaFlowUiDesignQualityReviewWorkflow: {
      async run(request) {
        reviews.push(request)
        return { status: 'PASS', unavailable: false, hardFailures: [], retryPrompt: '' }
      },
      shouldRetry() { return false },
      compileRubric() { return '完整页面结构' },
    },
  })

  const result = await bridge.runGeneration({ generatorNodeId: 'generator-1' })
  assert.equal(reviews.length, 1)
  assert.equal(reviews[0].targetPrompt, '根据页面结构生成完整游戏UI')
  assert.equal(result.qualityAccepted, true)
})

test('Local UI returns the deterministic polished candidate when quality review is unavailable', async () => {
  const generationRequests = []
  const { bridge } = loadBehaviorBridge([
    { id: 'content', name: 'Main content', role: 'content', participates: true },
  ], async (request) => {
    generationRequests.push(request)
    const number = generationRequests.length
    return {
      id: `unavailable-review-${number}`,
      name: `unavailable-review-${number}.png`,
      promptId: `unavailable-review-prompt-${number}`,
      dataUrl: `data:image/png;base64,UNAVAILABLE${number}`,
    }
  })

  const result = await bridge.runGeneration({ generatorNodeId: 'generator-1' })
  assert.equal(generationRequests.length, 2)
  assert.equal(generationRequests[1].skipDirector, true)
  assert.equal(generationRequests[1].state.localUiRefinePreset, 'polish')
  assert.equal(generationRequests[1].refinementCandidate.id, 'unavailable-review-1')
  assert.equal(result.id, 'unavailable-review-2')
  assert.equal(result.localDraft.id, 'unavailable-review-1')
  assert.equal(result.qualityReview.unavailable, true)
  assert.equal(result.qualityAccepted, false)
})

test('Local UI txt2img redesign skips the hot deterministic img2img polish pass', async () => {
  const generationRequests = []
  let reviewCalls = 0
  const { bridge } = loadBehaviorBridge([
    { id: 'content', name: 'Main content', role: 'content', participates: true },
  ], async (request) => {
    generationRequests.push(request)
    return {
      id: 'txt2img-first-pass',
      name: 'txt2img-first-pass.png',
      promptId: 'txt2img-first-pass-prompt',
      dataUrl: 'data:image/png;base64,TXT2IMG',
      localWorkflow: { synthesisMode: 'txt2img' },
    }
  }, {
    NovaFlowUiDesignQualityReviewWorkflow: {
      async run() {
        reviewCalls += 1
        throw new Error('txt2img must not launch the sustained-GPU local visual review')
      },
    },
  })

  const result = await bridge.runGeneration({ generatorNodeId: 'generator-1' })
  assert.equal(generationRequests.length, 1)
  assert.equal(reviewCalls, 0)
  assert.equal(result.id, 'txt2img-first-pass')
  assert.equal(result.localDraft, undefined)
  assert.equal(result.qualityReview.unavailable, true)
  assert.equal(result.qualityReview.reason, 'thermal-safe-manual-review')
  assert.equal(result.qualityAccepted, false)
})

test('Local UI txt2img thermal guard falls back to the stable top-level result mode', async () => {
  let reviewCalls = 0
  const { bridge } = loadBehaviorBridge([
    { id: 'content', name: 'Main content', role: 'content', participates: true },
  ], async () => ({
    id: 'txt2img-top-level-mode',
    name: 'txt2img-top-level-mode.png',
    promptId: 'txt2img-top-level-mode-prompt',
    dataUrl: 'data:image/png;base64,TXT2IMG_TOP_LEVEL',
    mode: 'txt2img',
  }), {
    NovaFlowUiDesignQualityReviewWorkflow: {
      async run() {
        reviewCalls += 1
        throw new Error('top-level txt2img mode must keep the thermal guard active')
      },
    },
  })

  const result = await bridge.runGeneration({ generatorNodeId: 'generator-1' })
  assert.equal(reviewCalls, 0)
  assert.equal(result.id, 'txt2img-top-level-mode')
  assert.equal(result.qualityReview.reason, 'thermal-safe-manual-review')
})

test('Local UI performance-mode reference-guided redesign preserves the single-pass thermal guard', async () => {
  const generationRequests = []
  let reviewCalls = 0
  const { bridge, state } = loadBehaviorBridge([
    { id: 'content', name: 'Main content', role: 'content', participates: true },
  ], async (request) => {
    generationRequests.push(request)
    return {
      id: 'reference-guided-first-pass',
      name: 'reference-guided-first-pass.png',
      promptId: 'reference-guided-first-pass-prompt',
      dataUrl: 'data:image/png;base64,REFERENCE_GUIDED',
      mode: 'img2img',
      localWorkflow: { synthesisMode: 'img2img' },
      referenceGuidedRedesign: true,
    }
  }, {
    NovaFlowUiDesignQualityReviewWorkflow: {
      async run() {
        reviewCalls += 1
        throw new Error('reference-guided first pass must not launch the sustained-GPU review')
      },
      shouldRetry() {
        throw new Error('reference-guided first pass must not enter automatic retry')
      },
    },
  })
  state.settings.localUiQualityMode = 'performance'

  const result = await bridge.runGeneration({ generatorNodeId: 'generator-1' })
  assert.equal(generationRequests.length, 1)
  assert.equal(generationRequests[0].state.localUiQualityMode, 'performance')
  assert.equal(reviewCalls, 0)
  assert.equal(result.id, 'reference-guided-first-pass')
  assert.equal(result.localDraft, undefined)
  assert.equal(result.qualityReview.unavailable, true)
  assert.equal(result.qualityReview.reason, 'thermal-safe-reference-guided-manual-review')
  assert.equal(result.qualityRetryCount, 0)
  assert.equal(result.qualityAccepted, false)
})

test('Local UI quality-mode automatic ordinary reference enters the real quality gate without thermal downgrade', async () => {
  const generationRequests = []
  let reviewCalls = 0
  const { bridge, state } = loadBehaviorBridge([
    { id: 'content', name: 'Main content', role: 'content', participates: true },
  ], async (request) => {
    generationRequests.push(request)
    return {
      id: 'quality-reference-first-pass',
      name: 'quality-reference-first-pass.png',
      promptId: 'quality-reference-first-pass-prompt',
      dataUrl: 'data:image/png;base64,QUALITY_REFERENCE_FIRST',
      mode: 'img2img',
      localPrimaryReference: {
        applied: true,
        strategy: 'connection-order',
        referenceIndex: 0,
        treatment: 'composition-guidance',
        proxyEncoding: 'composition-proxy-raster-v2',
      },
      localReferenceContentPrompt: '参考构图要求：严格3列×3行，共9格，底部金额和五个操作按钮完整。',
      localWorkflow: {
        synthesisMode: 'img2img',
        qualityMode: 'quality',
        latentReference: {
          strategy: 'semantic-layout-guide',
          conditioningStrategy: 'conditioning-only-auto-primary',
        },
      },
      referenceGuidedRedesign: true,
    }
  }, {
    NovaFlowUiDesignQualityReviewWorkflow: {
      compileRubric(structure, additional) {
        assert.match(additional, /严格3列×3行，共9格/)
        assert.match(additional, /构图相似不是参考泄漏/)
        return 'reference-guided quality rubric'
      },
      async run() {
        reviewCalls += 1
        return {
          status: 'PASS',
          unavailable: false,
          hardFailures: [],
          failureCodes: [],
          scores: { structureAdherence: 92 },
          retryPrompt: '',
        }
      },
      shouldRetry() { return false },
    },
  })
  state.settings.localUiQualityMode = 'quality'

  const result = await bridge.runGeneration({
    generatorNodeId: 'generator-1',
  })

  assert.equal(generationRequests.length, 1)
  assert.equal(generationRequests[0].state.localUiQualityMode, 'quality')
  assert.equal(reviewCalls, 1)
  assert.equal(result.id, 'quality-reference-first-pass')
  assert.equal(result.localDraft, undefined)
  assert.equal(result.qualityReview.status, 'PASS')
  assert.equal(result.qualityReview.unavailable, false)
  assert.equal(result.qualityRetryCount, 0)
  assert.equal(result.qualityAccepted, true)
  assert.equal(result.qualityStageCount, undefined)
  assert.equal(result.qualityPolished, undefined)
})

test('Local UI quality review follows synthesized material metadata while keeping the primary reference as layout', async () => {
  const reviews = []
  const { bridge, state } = loadBehaviorBridge([
    { id: 'content', name: 'Main content', role: 'content', participates: true },
  ], async () => ({
    id: 'role-aligned-first-pass',
    name: 'role-aligned-first-pass.png',
    promptId: 'role-aligned-first-pass-prompt',
    dataUrl: 'data:image/png;base64,ROLE_ALIGNED_FIRST',
    mode: 'img2img',
    localPrimaryReference: {
      applied: true,
      referenceIndex: 1,
    },
    localSynthesisReferenceOrder: {
      guideLast: true,
      layoutGuideImageNumber: 3,
      externalModelImageNumbers: [2, 1],
    },
    referenceRoles: ['reference', 'material', 'ui_layout'],
    localWorkflow: {
      synthesisMode: 'img2img',
      qualityMode: 'quality',
    },
    referenceGuidedRedesign: true,
  }), {
    NovaFlowUiDesignQualityReviewWorkflow: {
      compileRubric() { return 'quality rubric' },
      async run(request) {
        reviews.push(request)
        return {
          status: 'PASS',
          unavailable: false,
          hardFailures: [],
          failureCodes: [],
          retryPrompt: '',
        }
      },
      shouldRetry() { return false },
    },
  })
  state.settings.localUiQualityMode = 'quality'
  state.resources.push(
    {
      id: 'resource-support',
      name: 'support.png',
      dataUrl: 'data:image/png;base64,SUPPORT',
    },
    {
      id: 'resource-primary',
      name: 'primary.png',
      dataUrl: 'data:image/png;base64,PRIMARY',
    },
  )
  state.project.graph.nodes.push(
    {
      id: 'reference-support',
      type: 'reference',
      data: { resourceId: 'resource-support', role: 'reference' },
    },
    {
      id: 'reference-primary',
      type: 'reference',
      data: { resourceId: 'resource-primary', role: 'reference' },
    },
  )
  state.project.graph.edges.push(
    {
      id: 'reference-edge-support',
      fromNodeId: 'reference-support',
      fromPort: 'reference',
      toNodeId: 'generator-1',
      toPort: 'reference',
      kind: 'reference',
    },
    {
      id: 'reference-edge-primary',
      fromNodeId: 'reference-primary',
      fromPort: 'reference',
      toNodeId: 'generator-1',
      toPort: 'reference',
      kind: 'reference',
    },
  )

  await bridge.runGeneration({ generatorNodeId: 'generator-1' })

  assert.equal(reviews.length, 1)
  assert.deepEqual(
    Array.from(reviews[0].references, ({ name, role }) => ({ name, role })),
    [
      { name: 'support.png', role: 'material' },
      { name: 'primary.png', role: 'layout' },
    ],
  )
})

test('Local UI quality review preserves declared reference roles when synthesis role metadata is unavailable', async () => {
  const reviews = []
  const { bridge, state } = loadBehaviorBridge([
    { id: 'content', name: 'Main content', role: 'content', participates: true },
  ], async () => ({
    id: 'role-fallback-first-pass',
    name: 'role-fallback-first-pass.png',
    promptId: 'role-fallback-first-pass-prompt',
    dataUrl: 'data:image/png;base64,ROLE_FALLBACK_FIRST',
    mode: 'img2img',
    localPrimaryReference: {
      applied: true,
      referenceIndex: 1,
    },
    localWorkflow: {
      synthesisMode: 'img2img',
      qualityMode: 'quality',
    },
    referenceGuidedRedesign: true,
  }), {
    NovaFlowUiDesignQualityReviewWorkflow: {
      compileRubric() { return 'quality rubric' },
      async run(request) {
        reviews.push(request)
        return {
          status: 'PASS',
          unavailable: false,
          hardFailures: [],
          failureCodes: [],
          retryPrompt: '',
        }
      },
      shouldRetry() { return false },
    },
  })
  state.settings.localUiQualityMode = 'quality'
  state.resources.push(
    {
      id: 'resource-support-fallback',
      name: 'support-fallback.png',
      dataUrl: 'data:image/png;base64,SUPPORT_FALLBACK',
    },
    {
      id: 'resource-primary-fallback',
      name: 'primary-fallback.png',
      dataUrl: 'data:image/png;base64,PRIMARY_FALLBACK',
    },
  )
  state.project.graph.nodes.push(
    {
      id: 'reference-support-fallback',
      type: 'reference',
      data: { resourceId: 'resource-support-fallback', role: 'reference' },
    },
    {
      id: 'reference-primary-fallback',
      type: 'reference',
      data: { resourceId: 'resource-primary-fallback', role: 'reference' },
    },
  )
  state.project.graph.edges.push(
    {
      id: 'reference-edge-support-fallback',
      fromNodeId: 'reference-support-fallback',
      fromPort: 'reference',
      toNodeId: 'generator-1',
      toPort: 'reference',
      kind: 'reference',
    },
    {
      id: 'reference-edge-primary-fallback',
      fromNodeId: 'reference-primary-fallback',
      fromPort: 'reference',
      toNodeId: 'generator-1',
      toPort: 'reference',
      kind: 'reference',
    },
  )

  await bridge.runGeneration({ generatorNodeId: 'generator-1' })

  assert.equal(reviews.length, 1)
  assert.deepEqual(
    Array.from(reviews[0].references, ({ name, role }) => ({ name, role })),
    [
      { name: 'support-fallback.png', role: 'reference' },
      { name: 'primary-fallback.png', role: 'layout' },
    ],
  )
})

test('Local UI quality gate retries one actionable hard failure and preserves the first attempt', async () => {
  const generationRequests = []
  const reviews = []
  const repairMaskRequests = []
  const { bridge, state } = loadBehaviorBridge([
    { id: 'hero', name: 'Hero', participates: true },
  ], async (request) => {
    generationRequests.push(request)
    const number = generationRequests.length
    return {
      id: `generated-quality-${number}`,
      name: `quality-${number}.png`,
      promptId: `quality-prompt-${number}`,
      generationPrompt: number === 1 ? '哪吒主题老虎机目标要求' : '哪吒主题老虎机修正要求',
      dataUrl: `data:image/png;base64,QUALITY${number}`,
      localContentIdentityLock: number === 1
        ? {
            schemaVersion: 1,
            source: 'user-prompt',
            sourceFingerprint: 'lock-1',
            identityAnchors: ['哪吒主题'],
            requiredElements: ['3×3转轴'],
            exactTokens: ['WIN', 'Spin'],
            forbidSubstitution: true,
          }
        : request.state?.localUiContentLock,
      localContentLockPrompt: number === 1
        ? 'Dynamic content identity lock: 哪吒主题; 3×3转轴; WIN; Spin.'
        : String(request.state?.localUiContentLockPrompt || ''),
    }
  }, {
    NovaFlowUiDesignLayoutGuide: {
      createCleanLayoutGuide(project) {
        return {
          kind: 'ui-layout-guide',
          role: 'ui_layout',
          clean: true,
          editorSnapshot: false,
          dataUrl: 'data:image/png;base64,GUIDE',
          semantic: { schemaVersion: 1, description: project.description, regions: project.blocks },
        }
      },
      createSemanticRepairMask(guide, options) {
        repairMaskRequests.push({ guide, options })
        return {
          name: options.name,
          dataUrl: 'data:image/png;base64,REPAIR_MASK',
          visualEncoding: 'semantic-repair-mask-v1',
          selectedTokens: ['back', 'status-banner'],
        }
      },
    },
    NovaFlowUiDesignQualityReviewWorkflow: {
      async run(request) {
        reviews.push(request)
        return reviews.length === 1
          ? {
              status: 'FAIL',
              unavailable: false,
              failureClass: 'READABILITY',
              hardFailures: ['REFERENCE_CONTENT_LEAKAGE'],
              failedChecklistTokens: ['region-1:back', 'region-2:status-banner'],
              retryPrompt: '移除波塞冬与原Logo，只保留哪吒主题和3×3结构。',
            }
          : {
              status: 'PASS',
              unavailable: false,
              hardFailures: [],
              retryPrompt: '',
            }
      },
      shouldRetry(review, retryCount) {
        return retryCount < 1 && review.status === 'FAIL' && Boolean(review.retryPrompt)
      },
      compileRubric() {
        return '角色主视觉、严格3×3转轴、余额、投注、WIN与Spin'
      },
      buildActionableRetryPrompt({ targetPrompt, rubric, review }) {
        return `完整修正目标：${targetPrompt}；必需结构：${rubric}；检测问题：${review.retryPrompt}`
      },
    },
  })
  state.settings.prompt = '原始稳定目标：哪吒主题、严格3×3转轴和底部Spin'

  const result = await bridge.runGeneration({ generatorNodeId: 'generator-1' })
  assert.equal(generationRequests.length, 3)
  assert.equal(generationRequests[1].skipDirector, true)
  assert.equal(generationRequests[1].state.localUiRefinePreset, 'polish')
  assert.equal(generationRequests[1].state.localUiRefineDenoise, 0.35)
  assert.match(generationRequests[1].state.localUiContentLockPrompt, /哪吒主题/)
  assert.deepEqual(generationRequests[1].state.localUiContentLock.identityAnchors, ['哪吒主题'])
  assert.equal(generationRequests[1].state.localUiContentLockSourcePrompt, state.settings.prompt)
  assert.equal(generationRequests[1].refinementCandidate.id, 'generated-quality-1')
  assert.equal(generationRequests[2].prompt, state.settings.prompt)
  assert.match(generationRequests[2].qualityCorrectionPrompt, /边到边的平面数字界面/)
  assert.match(generationRequests[2].qualityCorrectionPrompt, /边缘编号和专属图标/)
  assert.match(generationRequests[2].qualityCorrectionPrompt, /移除波塞冬与原Logo，只保留哪吒主题和3×3结构/)
  assert.equal(generationRequests[2].skipDirector, true)
  assert.equal(generationRequests[2].state.localEditStrength, 'enhanced')
  assert.equal(generationRequests[2].refinementCandidate.id, 'generated-quality-2')
  assert.equal(generationRequests[2].refinementCandidate.dataUrl, 'data:image/png;base64,QUALITY2')
  assert.equal(generationRequests[2].state.localUiRefineDenoise, 0.55)
  assert.equal(generationRequests[2].state.localUiContentLockPrompt, generationRequests[1].state.localUiContentLockPrompt)
  assert.equal(generationRequests[2].state.localUiContentLock, generationRequests[1].state.localUiContentLock)
  assert.equal(repairMaskRequests.length, 1)
  assert.equal(repairMaskRequests[0].options.review.status, 'FAIL')
  assert.deepEqual(Array.from(repairMaskRequests[0].options.review.hardFailures), ['REFERENCE_CONTENT_LEAKAGE'])
  assert.deepEqual(
    Array.from(repairMaskRequests[0].options.review.failedChecklistTokens),
    ['region-1:back', 'region-2:status-banner'],
  )
  assert.match(repairMaskRequests[0].options.name, /^NovaFlow_UI_semantic_repair_\d+\.png$/)
  assert.equal(generationRequests[2].repairMask.visualEncoding, 'semantic-repair-mask-v1')
  assert.deepEqual(Array.from(generationRequests[2].repairMask.selectedTokens), ['back', 'status-banner'])
  assert.equal(generationRequests[2].state.localUiRepairMaskEncoding, 'semantic-repair-mask-v1')
  assert.equal(reviews.length, 2)
  assert.equal(reviews[0].targetPrompt, state.settings.prompt)
  assert.equal(reviews[1].targetPrompt, state.settings.prompt)
  assert.equal(reviews[0].layoutGuide?.kind, 'ui-layout-guide')
  assert.equal(reviews[1].layoutGuide?.kind, 'ui-layout-guide')
  assert.equal(reviews[0].rubric, reviews[1].rubric)
  assert.doesNotMatch(reviews[0].targetPrompt, /generationPrompt|哪吒主题老虎机目标要求/)
  assert.equal(result.id, 'generated-quality-3')
  assert.equal(result.qualityRetryCount, 1)
  assert.equal(result.qualityRetryMode, 'enhanced-redraw')
  assert.equal(result.qualityReview.status, 'PASS')
  assert.equal(result.qualityAccepted, true)
  assert.equal(result.localDraft.id, 'generated-quality-1')
  assert.equal(result.qualityFirstAttempt.id, 'generated-quality-2')
  assert.equal(result.qualityFirstAttempt.dataUrl, undefined)
  assert.equal(result.qualityFirstAttempt.review.status, 'FAIL')
  assert.equal(state.results.length, 1, 'only the final reviewed candidate is added to the visible result list')
})

test('Local UI preserves the first candidate when localized failures cannot produce a safe repair mask', async () => {
  const generationRequests = []
  let reviewCalls = 0
  const { bridge, state } = loadBehaviorBridge([
    { id: 'header', name: 'Header', role: 'header', purpose: 'Title and back button', participates: true },
  ], async (request) => {
    generationRequests.push(request)
    const number = generationRequests.length
    return {
      id: `safe-mask-${number}`,
      name: `safe-mask-${number}.png`,
      promptId: `safe-mask-prompt-${number}`,
      dataUrl: `data:image/png;base64,SAFE${number}`,
      mode: 'img2img',
      referenceGuidedRedesign: true,
      localWorkflow: {
        synthesisMode: 'img2img',
        qualityMode: 'quality',
      },
    }
  }, {
    NovaFlowUiDesignLayoutGuide: {
      createCleanLayoutGuide(project) {
        return {
          kind: 'ui-layout-guide',
          role: 'ui_layout',
          clean: true,
          editorSnapshot: false,
          dataUrl: 'data:image/png;base64,GUIDE',
          semantic: { schemaVersion: 1, description: project.description, regions: project.blocks },
        }
      },
      createSemanticRepairMask() {
        return null
      },
    },
    NovaFlowUiDesignQualityReviewWorkflow: {
      async run() {
        reviewCalls += 1
        return {
          status: 'FAIL',
          unavailable: false,
          failureClass: 'STRUCTURE',
          hardFailures: ['The required back navigation control is missing.'],
          failureCodes: ['STRUCTURE_MISSING'],
          failedChecklistTokens: ['region-1:back'],
          retryPrompt: 'Restore the missing back navigation control.',
          summary: 'One localized required control is missing.',
        }
      },
      shouldRetry(review, retryCount) {
        return retryCount < 1 && review.status === 'FAIL'
      },
      compileRubric() {
        return 'Keep every required region and control.'
      },
      buildActionableRetryPrompt({ targetPrompt, review }) {
        return `${targetPrompt}; ${review.retryPrompt}`
      },
    },
  })
  state.settings.localUiQualityMode = 'quality'

  const result = await bridge.runGeneration({ generatorNodeId: 'generator-1' })

  assert.equal(generationRequests.length, 1)
  assert.equal(reviewCalls, 1)
  assert.equal(result.id, 'safe-mask-1')
  assert.equal(result.qualityReview.status, 'REVIEW')
  assert.equal(result.qualityReview.unavailable, true)
  assert.equal(result.qualityReview.reason, 'semantic-repair-mask-unavailable')
  assert.match(result.qualityReview.summary, /保留首轮成品/)
  assert.equal(result.qualityRetryCount, 0)
  assert.equal(result.qualityRetryMode, 'localized-mask-unavailable')
  assert.equal(result.qualityAccepted, false)
  assert.equal(state.results.length, 1)
})

test('Local UI deterministic polish does not run a duplicate polish-only quality retry', async () => {
  const generationRequests = []
  let reviewCalls = 0
  const { bridge } = loadBehaviorBridge([
    { id: 'content', name: 'Main content', participates: true },
  ], async (request) => {
    generationRequests.push(request)
    const number = generationRequests.length
    return {
      id: `polish-candidate-${number}`,
      name: `polish-candidate-${number}.png`,
      promptId: `polish-prompt-${number}`,
      dataUrl: `data:image/png;base64,POLISH${number}`,
    }
  }, {
    NovaFlowUiDesignQualityReviewWorkflow: {
      async run() {
        reviewCalls += 1
        return reviewCalls === 1
          ? {
              status: 'FAIL',
              unavailable: false,
              hardFailures: ['商业完成度和材质一致性不足'],
              failureCodes: ['QUALITY_POLISH_INSUFFICIENT'],
              failureClass: 'POLISH',
              retryPrompt: '保持结构和内容，只提高材质、光影、层级和资产一致性。',
            }
          : {
              status: 'PASS',
              unavailable: false,
              hardFailures: [],
              failureCodes: [],
              failureClass: '',
              retryPrompt: '',
            }
      },
      shouldRetry(review, retryCount) {
        return retryCount < 1 && review.status === 'FAIL'
      },
      compileRubric() {
        return '保持用户声明的所有页面区域和功能'
      },
      buildActionableRetryPrompt({ targetPrompt, review }) {
        return `${targetPrompt}；${review.retryPrompt}`
      },
      failureClassForCodes() {
        return 'POLISH'
      },
    },
  })

  const result = await bridge.runGeneration({ generatorNodeId: 'generator-1' })
  assert.equal(generationRequests.length, 2)
  assert.equal(generationRequests[1].skipDirector, true)
  assert.equal(generationRequests[1].state.localUiRefinePreset, 'polish')
  assert.equal(generationRequests[1].state.localUiRefineDenoise, 0.35)
  assert.equal(generationRequests[1].refinementCandidate.id, 'polish-candidate-1')
  assert.equal(generationRequests[1].refinementCandidate.dataUrl, 'data:image/png;base64,POLISH1')
  assert.equal(generationRequests[1].repairMask, undefined)
  assert.equal(generationRequests[1].state.localUiRepairMaskEncoding, undefined)
  assert.equal(result.id, 'polish-candidate-2')
  assert.equal(reviewCalls, 1)
  assert.equal(result.qualityRetryMode, 'polish-complete')
  assert.equal(result.qualityRetryCount, 0)
  assert.equal(result.qualityAccepted, false)
  assert.equal(result.localDraft.id, 'polish-candidate-1')
  assert.equal(result.qualityFirstAttempt.id, 'polish-candidate-2')
})

test('Local UI keeps a twice-failed candidate inspectable but never marks it quality accepted', async () => {
  const generationRequests = []
  let reviewCalls = 0
  const qualityWorkflow = {
    async run() {
      reviewCalls += 1
      return {
        status: 'FAIL',
        unavailable: false,
        hardFailures: ['必需页面结构或核心操作区明显缺失'],
        retryPrompt: '补齐严格3×3转轴与底部Spin操作区。',
      }
    },
    shouldRetry(review, retryCount) {
      return retryCount < 1 && review.status === 'FAIL'
    },
    compileRubric() {
      return '严格3×3转轴与底部Spin操作区'
    },
    buildActionableRetryPrompt({ targetPrompt }) {
      return `${targetPrompt}；严格3×3转轴与底部Spin操作区`
    },
  }
  const { bridge, state } = loadBehaviorBridge([
    { id: 'reels', name: '主内容区域', purpose: '严格3×3转轴', participates: true },
  ], async (request) => {
    generationRequests.push(request)
    const generationCalls = generationRequests.length
    return {
      id: `twice-failed-${generationCalls}`,
      name: `twice-failed-${generationCalls}.png`,
      dataUrl: `data:image/png;base64,FAILED${generationCalls}`,
    }
  }, {
    NovaFlowUiDesignQualityReviewWorkflow: qualityWorkflow,
  })
  state.settings.prompt = '哪吒主题老虎机'

  const result = await bridge.runGeneration({ generatorNodeId: 'generator-1' })
  assert.equal(generationRequests.length, 3)
  assert.equal(generationRequests[2].state.localUiRefineDenoise, 0.55)
  assert.equal(generationRequests[2].repairMask, undefined)
  assert.equal(generationRequests[2].state.localUiRepairMaskEncoding, undefined)
  assert.equal(reviewCalls, 2)
  assert.equal(result.qualityReview.status, 'FAIL')
  assert.equal(result.qualityRetryCount, 1)
  assert.equal(result.qualityAccepted, false)
  assert.equal(state.results.length, 1, 'failed result remains available for enlargement and manual inspection')
})

test('Local UI iteration preserves its base and bypasses the redesign anti-copy quality gate', async () => {
  let generationRequest = null
  let reviewCalls = 0
  const { bridge, state } = loadBehaviorBridge([
    { id: 'hero', name: 'Hero', participates: true },
  ], async (request) => {
    generationRequest = request
    return {
      id: 'generated-iteration',
      name: 'iteration.png',
      dataUrl: 'data:image/png;base64,ITERATION',
    }
  }, {
    NovaFlowUiDesignQualityReviewWorkflow: {
      async run() {
        reviewCalls += 1
        throw new Error('iteration must not enter redesign anti-copy review')
      },
    },
  })
  state.project.graph.nodes.push({
    id: 'previous-result-node',
    type: 'result',
    data: { resultId: 'previous-result', sourceNodeId: 'generator-1' },
  })
  state.project.graph.edges.push({
    id: 'iteration-edge',
    fromNodeId: 'previous-result-node',
    fromPort: 'reference',
    toNodeId: 'generator-1',
    toPort: 'iteration',
    kind: 'iteration',
  })
  state.results.push({
    id: 'previous-result',
    kind: 'ui-design',
    name: 'previous.png',
    dataUrl: 'data:image/png;base64,PREVIOUS',
  })

  const result = await bridge.runGeneration({ generatorNodeId: 'generator-1' })
  assert.equal(generationRequest.state.uiRunIntent, 'iteration')
  assert.equal(reviewCalls, 0)
  assert.equal(result.id, 'generated-iteration')
  assert.equal(result.qualityReview, undefined)
  assert.equal(result.qualityRetryCount, undefined)
})

test('runGeneration registers its result as a silent shared drawing resource', async () => {
  const registrations = []
  const { bridge, state } = loadBehaviorBridge([
    { id: 'hero', name: 'Hero', participates: true },
  ], async () => ({
    id: 'generated-shared',
    name: 'UI方案.png',
    dataUrl: 'data:image/png;base64,SHARED',
  }), {
    NovaFlowSpineSplitBridge: {
      getSourceResources() { return [] },
      async registerSourceDataUrlResource(fileName, dataUrl, options) {
        registrations.push({ fileName, dataUrl, options })
        return {
          id: 'drawing-source-shared',
          fileName,
          name: fileName,
          dataUrl,
          origin: options.origin,
          externalId: options.externalId,
        }
      },
    },
  })

  const result = await bridge.runGeneration({ skeletonDataUrl: 'data:image/svg+xml;base64,SKELETON' })
  assert.equal(state.results.length, 1)
  assert.equal(result.id, 'generated-shared')
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].fileName, 'UI方案.png')
  assert.equal(registrations[0].dataUrl, 'data:image/png;base64,SHARED')
  assert.equal(registrations[0].options.activate, false)
  assert.equal(registrations[0].options.resetViewport, false)
  assert.equal(registrations[0].options.origin, 'ui-design')
  assert.equal(registrations[0].options.externalId, 'generated-shared')
})

test('runGeneration rolls back instead of activating Drawing through an unversioned legacy resource bridge', async () => {
  let unsafeAdds = 0
  const { bridge, state } = loadBehaviorBridge([
    { id: 'hero', name: 'Hero', participates: true },
  ], async () => ({
    id: 'generated-local-only',
    name: 'local-only.png',
    dataUrl: 'data:image/png;base64,LOCALONLY',
  }), {
    NovaFlowSpineSplitBridge: {
      getState() { return { sourceResources: [] } },
      addSourceDataUrlResource() {
        unsafeAdds += 1
        return true
      },
    },
  })

  await assert.rejects(
    () => bridge.runGeneration({ skeletonDataUrl: 'data:image/svg+xml;base64,SKELETON' }),
    /公共资源服务暂不可用/,
  )
  assert.equal(state.results.length, 0)
  assert.equal(unsafeAdds, 0, 'legacy add may activate Drawing and must not be used without an explicit silent capability')
})

test('deleting a pending generated result cancels shared registration without reviving the result', async () => {
  let resolveRegistration
  const registration = new Promise((resolve) => { resolveRegistration = resolve })
  const deletedSharedIds = []
  const { bridge, state } = loadBehaviorBridge([
    { id: 'hero', name: 'Hero', participates: true },
  ], async () => ({
    id: 'generated-pending-delete',
    name: 'pending.png',
    dataUrl: 'data:image/png;base64,PENDING',
  }), {
    NovaFlowSpineSplitBridge: {
      getSourceResources() { return [] },
      registerSourceDataUrlResource() { return registration },
      deleteSourceResource(id) {
        deletedSharedIds.push(id)
        return true
      },
    },
  })

  const pending = bridge.runGeneration({ skeletonDataUrl: 'data:image/svg+xml;base64,SKELETON' })
  for (let index = 0; index < 12 && state.results.length === 0; index += 1) await Promise.resolve()
  assert.equal(state.results.length, 1, 'result must exist locally while shared registration is pending')
  state.results.splice(0, 1)
  resolveRegistration({
    id: 'drawing-pending-delete',
    name: 'pending.png',
    dataUrl: 'data:image/png;base64,PENDING',
    origin: 'ui-design',
    externalId: 'generated-pending-delete',
  })

  const result = await pending
  assert.equal(result, null)
  assert.deepEqual(deletedSharedIds, ['drawing-pending-delete'])
  assert.equal(state.results.length, 0)
  assert.equal(state.project.graph.nodes.some((node) => node.type === 'result'), false)
  assert.deepEqual(state.project.graph.lineage, [])
})

test('deleting a pending imported reference cancels shared registration and returns nothing to the workspace', async () => {
  const resourceContext = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
  }
  resourceContext.globalThis = resourceContext
  vm.runInNewContext(fs.readFileSync(resourcePath, 'utf8'), resourceContext, { filename: resourcePath })

  const apiMarker = 'const api = Object.freeze({'
  const originalBridgeSource = fs.readFileSync(bridgePath, 'utf8')
  assert.match(originalBridgeSource, /const api = Object\.freeze\(\{/)
  const bridgeSource = originalBridgeSource.replace(
    apiMarker,
    `${apiMarker}\n    __testImportUiSharedFiles: importUiSharedFiles,`,
  )

  let sharedResources = []
  let resolveRegistration
  let registrationStarted = false
  const deletedSharedIds = []
  const registration = new Promise((resolve) => { resolveRegistration = resolve })
  const bridgeContext = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    NovaFlowSpineSplitBridge: {
      getSourceResources() { return sharedResources.slice() },
      registerSourceDataUrlResource() {
        registrationStarted = true
        return registration
      },
      deleteSourceResource(id) {
        deletedSharedIds.push(id)
        sharedResources = sharedResources.filter((item) => item.id !== id)
        return true
      },
    },
  }
  bridgeContext.globalThis = bridgeContext
  vm.runInNewContext(bridgeSource, bridgeContext, { filename: bridgePath })

  const store = resourceContext.module.exports.createStore()
  const pending = bridgeContext.module.exports.__testImportUiSharedFiles(store, [{
    name: 'pending.png',
    type: 'image/png',
    dataUrl: 'data:image/png;base64,QQ==',
  }])
  for (let index = 0; index < 30 && !registrationStarted; index += 1) await Promise.resolve()
  assert.equal(registrationStarted, true, 'shared registration must be pending before the local delete')
  assert.equal(store.getState().resources.length, 1)

  const localId = store.getState().resources[0].id
  store.removeResource(localId)
  const sharedResource = {
    id: 'drawing-pending-import-delete',
    name: 'pending.png',
    dataUrl: 'data:image/png;base64,QQ==',
    origin: 'ui-design',
    externalId: localId,
  }
  sharedResources = [sharedResource]
  resolveRegistration(sharedResource)

  const imported = await pending
  assert.equal(imported.length, 0, 'workspace must not receive a deleted reference to create a node')
  assert.deepEqual(deletedSharedIds, ['drawing-pending-import-delete'])
  assert.equal(store.getState().resources.length, 0)
  assert.equal(store.getState().project.graph.nodes.some((node) => node.type === 'reference'), false)
})

test('runGeneration blocks an unsupported provider size before submitting work', async () => {
  let workflowCalls = 0
  const { bridge, state } = loadBehaviorBridge([
    { id: 'hero', participates: true },
  ], async () => {
    workflowCalls += 1
    return { dataUrl: 'data:image/png;base64,UNEXPECTED' }
  }, {
    NovaFlowUiDesignGenerateTool: {
      resolveOutputContract() {
        return { valid: false, error: 'GPT 输出尺寸必须使用 16 的倍数' }
      },
    },
  })
  state.project.graph.nodes.find((node) => node.id === 'generator-1').data = {
    generationSettings: { provider: 'gpt' },
    output: { width: 1920, height: 1080 },
  }
  await assert.rejects(() => bridge.runGeneration({ generatorNodeId: 'generator-1' }), /16 的倍数/)
  assert.equal(workflowCalls, 0)
})

test('bridge exposes only provider-allowed connected references to @ mentions and the design assistant', async () => {
  let dialogOptions = null
  const { bridge, state } = loadBehaviorBridge([
    { id: 'hero', name: 'Hero', role: 'hero', participates: true },
  ], async () => ({ id: 'unused', dataUrl: 'data:image/png;base64,UNUSED' }), {
    localStorage: {
      getItem(key) {
        return key === 'novaflow.client.auth.session.v1'
          ? JSON.stringify({ session: { token: 'signed-in-token' } })
          : null
      },
    },
    NovaFlowUiDesignAssistantWorkflow: { createSession() {} },
    NovaFlowUiDesignAssistantDialog: {
      open(options) {
        dialogOptions = options
        return { close() {} }
      },
    },
  })
  const generator = state.project.graph.nodes.find((node) => node.id === 'generator-1')
  state.project.graph.nodes.find((node) => node.id === 'layout-1').data.description = '竖屏角色装备管理页面'
  generator.data = {
    generationSettings: { provider: 'local', prompt: 'current UI', negativePrompt: 'bad layout' },
    output: { width: 900, height: 1600 },
  }
  state.project.graph.nodes.push(
    { id: 'reference-1', type: 'reference', data: { resourceId: 'resource-1', role: 'style' } },
    { id: 'reference-2', type: 'reference', data: { resourceId: 'resource-2', role: 'material' } },
    { id: 'result-node', type: 'result', data: { resultId: 'previous-result', sourceNodeId: generator.id } },
  )
  state.project.graph.edges.push(
    { id: 'reference-edge-1', fromNodeId: 'reference-1', fromPort: 'reference', toNodeId: generator.id, toPort: 'reference', kind: 'reference' },
    { id: 'reference-edge-2', fromNodeId: 'reference-2', fromPort: 'reference', toNodeId: generator.id, toPort: 'reference', kind: 'reference' },
    { id: 'iteration-edge', fromNodeId: 'result-node', fromPort: 'reference', toNodeId: generator.id, toPort: 'iteration', kind: 'iteration' },
  )
  state.resources.push(
    { id: 'resource-1', name: 'style.png', dataUrl: 'data:image/png;base64,STYLE' },
    { id: 'resource-2', name: 'material.png', dataUrl: 'data:image/png;base64,MATERIAL' },
  )
  state.results.push({ id: 'previous-result', name: 'previous.png', dataUrl: 'data:image/png;base64,PREVIOUS' })

  const mentions = bridge.getGeneratorReferenceDescriptors(state, generator.id)
  assert.deepEqual(Array.from(mentions, (item) => item.name), ['previous.png', 'style.png'])
  assert.deepEqual(Array.from(mentions, (item) => item.key), ['ui_reference_1', 'ui_reference_2'])
  assert.deepEqual(Array.from(mentions, (item) => item.sourceId), ['previous-result', 'resource-1'])

  const applied = []
  bridge.openDesignAssistant({
    generatorNodeId: generator.id,
    prompt: 'current UI',
    negativePrompt: 'bad layout',
    apply(value) { applied.push(value) },
  })
  assert.ok(dialogOptions)
  assert.equal(dialogOptions.provider, 'local')
  assert.deepEqual(JSON.parse(JSON.stringify(dialogOptions.size)), { width: 900, height: 1600 })
  assert.equal(dialogOptions.getSessionToken(), 'signed-in-token')
  assert.deepEqual(Array.from(await dialogOptions.getReferences(), (item) => item.name), ['previous.png', 'style.png'])
  const structure = await dialogOptions.getStructureContext()
  assert.equal(structure.width, 900)
  assert.equal(structure.height, 1600)
  assert.equal(structure.description, '竖屏角色装备管理页面')
  assert.deepEqual(Array.from(structure.blocks, (item) => item.id), ['hero'])
  dialogOptions.apply({ prompt: 'assistant result' })
  assert.deepEqual(applied, [{ prompt: 'assistant result' }])
})

test('generation follows the selected generator graph, scopes its layout, and prioritizes iteration input', async () => {
  const layoutA = { id: 'layout-a', type: 'layout', data: { blocks: [{ id: 'a', name: 'A', participates: true }] } }
  const layoutB = { id: 'layout-b', type: 'layout', data: { blocks: [{ id: 'b', name: 'B', participates: true }] } }
  const generator = { id: 'generator-b', type: 'generator', data: {} }
  const referenceOne = { id: 'reference-1', type: 'reference', data: { resourceId: 'resource-1', role: 'style' } }
  const referenceTwo = { id: 'reference-2', type: 'reference', data: { resourceId: 'resource-2', role: 'material' } }
  const resultNode = { id: 'result-1', type: 'result', data: { resultId: 'result-1', sourceNodeId: generator.id } }
  const state = {
    project: {
      width: 1920,
      height: 1080,
      blocks: layoutA.data.blocks,
      graph: {
        schemaVersion: 2,
        nodes: [layoutA, layoutB, generator, referenceOne, referenceTwo, resultNode],
        edges: [
          { id: 'layout-edge', fromNodeId: layoutB.id, fromPort: 'layout', toNodeId: generator.id, toPort: 'layout', kind: 'layout' },
          { id: 'reference-edge-1', fromNodeId: referenceOne.id, fromPort: 'reference', toNodeId: generator.id, toPort: 'reference', kind: 'reference' },
          { id: 'iteration-edge', fromNodeId: resultNode.id, fromPort: 'reference', toNodeId: generator.id, toPort: 'iteration', kind: 'iteration' },
        ],
        lineage: [],
      },
    },
    settings: { provider: 'local' },
    resources: [
      { id: 'resource-1', name: 'style.png', dataUrl: 'data:image/png;base64,STYLE' },
      { id: 'resource-2', name: 'material.png', dataUrl: 'data:image/png;base64,MATERIAL' },
      { id: 'unconnected', name: 'unused.png', dataUrl: 'data:image/png;base64,UNUSED' },
    ],
    results: [{ id: 'result-1', kind: 'ui-design', name: 'previous.png', dataUrl: 'data:image/png;base64,PREVIOUS' }],
  }
  let workflowRequest = null
  let guideProject = null
  let lineage = null
  const store = {
    getState() { return state },
    getReferenceResources() { return state.resources },
    addResult(result) { state.results.push(result); return result },
    recordResultLineage(value) { lineage = value },
  }
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    NovaFlowUiDesignProjectResource: { createProjectStore() { return store } },
    NovaFlowUiDesignStructureTool: { normalizeGraph(value) { return value } },
    NovaFlowUiDesignLayoutGuide: {
      createCleanLayoutGuide(project) {
        guideProject = project
        return {
          kind: 'ui-layout-guide', role: 'ui_layout', clean: true, editorSnapshot: false,
          dataUrl: 'data:image/png;base64,SCOPED', semantic: { schemaVersion: 1, regions: project.blocks },
        }
      },
    },
    NovaFlowUiDesignGenerateWorkflow: {
      async run(request) {
        workflowRequest = request
        return { id: 'result-2', kind: 'ui-design', dataUrl: 'data:image/png;base64,NEXT' }
      },
    },
    NovaFlowSpineSplitBridge: {
      getSourceResources() { return [] },
      async registerSourceDataUrlResource(fileName, dataUrl, options) {
        return {
          id: 'drawing-result-2', fileName, name: fileName, dataUrl,
          origin: options.origin, externalId: options.externalId,
        }
      },
    },
  }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(bridgePath, 'utf8'), context, { filename: bridgePath })
  await context.module.exports.runGeneration({ generatorNodeId: generator.id, layoutGuide: { clean: true, editorSnapshot: false, dataUrl: 'data:image/png;base64,STALE' } })

  assert.deepEqual(Array.from(guideProject.graph.nodes, (node) => node.id), [layoutB.id])
  assert.deepEqual(Array.from(guideProject.blocks, (block) => block.id), ['b'])
  assert.equal(workflowRequest.layoutGuide.dataUrl, 'data:image/png;base64,SCOPED')
  assert.deepEqual(Array.from(workflowRequest.refs, (item) => item.id), ['result-1', 'resource-1'])
  assert.equal(workflowRequest.refs[0].kind, 'generated')
  assert.deepEqual(Array.from(lineage.parentResultIds), ['result-1'])
  assert.deepEqual(Array.from(lineage.referenceResourceIds), ['resource-1'])
})

test('generation rejects reference overflow instead of silently ignoring an input', async () => {
  let workflowCalls = 0
  const { bridge, state } = loadBehaviorBridge([
    { id: 'hero', name: 'Hero', participates: true },
  ], async () => {
    workflowCalls += 1
    return { id: 'unexpected', dataUrl: 'data:image/png;base64,UNEXPECTED' }
  })
  state.project.graph.nodes.push(
    { id: 'reference-1', type: 'reference', data: { resourceId: 'resource-1', role: 'style' } },
    { id: 'reference-2', type: 'reference', data: { resourceId: 'resource-2', role: 'material' } },
    { id: 'result-node', type: 'result', data: { resultId: 'previous-result', sourceNodeId: 'generator-1' } },
  )
  state.project.graph.edges.push(
    { id: 'reference-edge-1', fromNodeId: 'reference-1', fromPort: 'reference', toNodeId: 'generator-1', toPort: 'reference', kind: 'reference' },
    { id: 'reference-edge-2', fromNodeId: 'reference-2', fromPort: 'reference', toNodeId: 'generator-1', toPort: 'reference', kind: 'reference' },
    { id: 'iteration-edge', fromNodeId: 'result-node', fromPort: 'reference', toNodeId: 'generator-1', toPort: 'iteration', kind: 'iteration' },
  )
  state.resources.push(
    { id: 'resource-1', dataUrl: 'data:image/png;base64,ONE' },
    { id: 'resource-2', dataUrl: 'data:image/png;base64,TWO' },
  )
  state.results.push({ id: 'previous-result', dataUrl: 'data:image/png;base64,BASE' })

  await assert.rejects(
    () => bridge.runGeneration({ generatorNodeId: 'generator-1' }),
    /修改底图.*最多还能连接 1 张普通参考图/,
  )
  assert.equal(workflowCalls, 0)
})

test('provider changes keep every graph edge while generation context applies local, GPT, and Google limits', () => {
  const { bridge, state } = loadBehaviorBridge([
    { id: 'hero', name: 'Hero', participates: true },
  ], async () => ({ id: 'unused', dataUrl: 'data:image/png;base64,UNUSED' }))
  const generator = state.project.graph.nodes.find((node) => node.id === 'generator-1')
  generator.data = { generationSettings: { provider: 'gpt' } }
  for (let index = 1; index <= 15; index += 1) {
    const nodeId = `reference-${index}`
    const resourceId = `resource-${index}`
    state.project.graph.nodes.push({ id: nodeId, type: 'reference', data: { resourceId, role: 'style' } })
    state.project.graph.edges.push({
      id: `reference-edge-${index}`,
      fromNodeId: nodeId,
      fromPort: 'reference',
      toNodeId: generator.id,
      toPort: 'reference',
      kind: 'reference',
    })
    state.resources.push({ id: resourceId, dataUrl: `data:image/png;base64,REF${index}` })
  }

  const gpt = bridge.resolveGenerationContext(state, generator.id)
  assert.equal(gpt.referenceLimit, 15)
  assert.equal(gpt.references.length, 15)
  assert.equal(gpt.referenceOverflow, 0)

  generator.data.generationSettings.provider = 'google'
  const google = bridge.resolveGenerationContext(state, generator.id)
  assert.equal(google.referenceLimit, 13)
  assert.equal(google.references.length, 15)
  assert.equal(google.referenceOverflow, 2)

  generator.data.generationSettings.provider = 'local'
  const local = bridge.resolveGenerationContext(state, generator.id)
  assert.equal(local.referenceLimit, 2)
  assert.equal(local.references.length, 15, 'provider downgrade must never truncate connected graph inputs')
  assert.equal(local.referenceOverflow, 13)
  assert.equal(state.project.graph.edges.filter((edge) => edge.kind === 'reference').length, 15)
})

test('multiple generators keep independent settings and scale layouts into landscape or portrait output', async () => {
  let resultIndex = 0
  const requests = []
  const sourceBlock = { id: 'hero', name: 'Hero', x: 192, y: 108, width: 960, height: 540, participates: true }
  const { bridge, state } = loadBehaviorBridge([sourceBlock], async (request) => {
    requests.push(JSON.parse(JSON.stringify(request)))
    resultIndex += 1
    return { id: `generated-${resultIndex}`, dataUrl: `data:image/png;base64,RESULT${resultIndex}` }
  })
  const layoutA = state.project.graph.nodes.find((node) => node.id === 'layout-1')
  layoutA.data.description = '横屏战斗信息总览页面'
  const generatorA = state.project.graph.nodes.find((node) => node.id === 'generator-1')
  generatorA.data = {
    generationSettings: {
      provider: 'local', localEditStrength: 'enhanced', seed: 11,
      prompt: 'dark sci-fi HUD', negativePrompt: 'overlapping controls',
    },
    output: { width: 1600, height: 900 },
  }
  const layoutB = {
    id: 'layout-2',
    type: 'layout',
    data: {
      description: '竖屏角色装备管理页面',
      blocks: [{ ...sourceBlock, id: 'hero-portrait' }],
    },
  }
  const generatorB = {
    id: 'generator-2',
    type: 'generator',
    data: {
      generationSettings: {
        provider: 'gpt', localEditStrength: 'creative', seed: 22,
        prompt: 'portrait inventory', negativePrompt: 'tiny unreadable labels',
      },
      output: { width: 900, height: 1600 },
    },
  }
  state.project.graph.nodes.push(layoutB, generatorB)
  state.project.graph.edges.push({
    id: 'layout-edge-2',
    fromNodeId: layoutB.id,
    fromPort: 'layout',
    toNodeId: generatorB.id,
    toPort: 'layout',
    kind: 'layout',
  })
  state.settings = { provider: 'legacy', localEditStrength: 'faithful', seed: 0 }
  const originalProject = JSON.stringify(state.project)

  await bridge.runGeneration({ generatorNodeId: generatorA.id })
  await bridge.runGeneration({ generatorNodeId: generatorB.id })

  assert.equal(requests.length, 3)
  assert.equal(requests[1].skipDirector, true)
  assert.equal(requests[1].state.localUiRefinePreset, 'polish')
  assert.equal(requests[1].refinementCandidate.id, 'generated-1')
  const primaryRequests = [requests[0], requests[2]]
  assert.deepEqual(
    primaryRequests.map((request) => ({
      provider: request.state.provider,
      strength: request.state.localEditStrength,
      seed: request.state.seed,
      width: request.state.width,
      height: request.state.height,
    })),
    [
      { provider: 'local', strength: 'enhanced', seed: 11, width: 1600, height: 900 },
      { provider: 'gpt', strength: 'creative', seed: 22, width: 900, height: 1600 },
    ],
  )
  assert.deepEqual(primaryRequests[0].project.canvas, { width: 1600, height: 900 })
  assert.deepEqual(primaryRequests[1].project.canvas, { width: 900, height: 1600 })
  assert.equal(primaryRequests[0].project.description, '横屏战斗信息总览页面')
  assert.equal(primaryRequests[1].project.description, '竖屏角色装备管理页面')
  assert.equal(primaryRequests[0].semanticLayout.description, '横屏战斗信息总览页面')
  assert.equal(primaryRequests[1].semanticLayout.description, '竖屏角色装备管理页面')
  assert.equal(primaryRequests[0].prompt, 'dark sci-fi HUD')
  assert.equal(primaryRequests[0].negativePrompt, 'overlapping controls')
  assert.equal(primaryRequests[1].prompt, 'portrait inventory')
  assert.equal(primaryRequests[1].negativePrompt, 'tiny unreadable labels')
  assert.deepEqual(
    primaryRequests[0].project.blocks[0],
    { ...sourceBlock, x: 160, y: 90, width: 800, height: 450 },
  )
  assert.deepEqual(
    primaryRequests[1].project.blocks[0],
    { ...sourceBlock, id: 'hero-portrait', x: 90, y: 160, width: 450, height: 800 },
  )
  assert.equal(JSON.stringify(state.project), originalProject, 'generation must not mutate the persisted page structure')
  assert.equal(layoutA.data.blocks[0].width, 960)
  assert.equal(layoutB.data.blocks[0].height, 540)
})

test('portrait layout geometry maps from its neutral canvas into a square generator output', async () => {
  let workflowRequest = null
  const sourceBlock = {
    id: 'hero', name: 'Hero', x: 108, y: 384, width: 864, height: 960,
    xNorm: 0.1, yNorm: 0.2, wNorm: 0.8, hNorm: 0.5,
    participates: true,
  }
  const { bridge, state } = loadBehaviorBridge([sourceBlock], async (request) => {
    workflowRequest = JSON.parse(JSON.stringify(request))
    return { id: 'portrait-result', dataUrl: 'data:image/png;base64,PORTRAIT' }
  }, { NovaFlowUiDesignStructureTool: structureTool })
  state.project.width = 1024
  state.project.height = 1024
  const layout = state.project.graph.nodes.find((node) => node.id === 'layout-1')
  layout.data.canvasSize = { width: 1080, height: 1920 }
  const generator = state.project.graph.nodes.find((node) => node.id === 'generator-1')
  generator.data = { generationSettings: { provider: 'local' }, output: { width: 1024, height: 1024 } }
  const originalLayout = JSON.stringify(layout.data)

  await bridge.runGeneration({ generatorNodeId: generator.id })

  const generatedBlock = workflowRequest.project.blocks[0]
  assert.deepEqual({
    x: generatedBlock.x, y: generatedBlock.y,
    width: generatedBlock.width, height: generatedBlock.height,
    xNorm: generatedBlock.xNorm, yNorm: generatedBlock.yNorm,
    wNorm: generatedBlock.wNorm, hNorm: generatedBlock.hNorm,
  }, {
    x: 102, y: 205, width: 819, height: 512,
    xNorm: 0.1, yNorm: 0.2, wNorm: 0.8, hNorm: 0.5,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(workflowRequest.project.canvas)), { width: 1024, height: 1024 })
  assert.equal(JSON.stringify(layout.data), originalLayout, 'generation must not rewrite the layout coordinate canvas')
})

test('setting a result as modify base targets its source generator and replaces the previous base edge', () => {
  const result = { id: 'result-new', kind: 'ui-design', dataUrl: 'data:image/png;base64,NEW' }
  const resultNode = { id: 'result-node-new', type: 'result', data: { resultId: result.id, sourceNodeId: 'generator-2' } }
  const graph = {
    schemaVersion: 2,
    nodes: [
      { id: 'generator-1', type: 'generator', data: {} },
      { id: 'generator-2', type: 'generator', data: {} },
      { id: 'result-node-old', type: 'result', data: { resultId: 'result-old', sourceNodeId: 'generator-2' } },
      resultNode,
    ],
    edges: [{ id: 'old-iteration', fromNodeId: 'result-node-old', fromPort: 'reference', toNodeId: 'generator-2', toPort: 'iteration', kind: 'iteration' }],
    lineage: [],
  }
  const state = { project: { width: 1920, height: 1080, graph }, settings: {}, resources: [], results: [result] }
  const removed = []
  let connected = null
  const store = {
    getState() { return state },
    removeGraphEdge(id) { removed.push(id); graph.edges = graph.edges.filter((edge) => edge.id !== id); return { ok: true, graph } },
    connectGraph(edge) { connected = edge; return { ok: true, edge } },
  }
  const context = {
    module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout,
    NovaFlowUiDesignProjectResource: { createProjectStore() { return store } },
    NovaFlowUiDesignStructureTool: { normalizeGraph(value) { return value } },
  }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(bridgePath, 'utf8'), context, { filename: bridgePath })
  const response = context.module.exports.useResultAsReference(result, resultNode)
  assert.equal(response.ok, true)
  assert.deepEqual(removed, ['old-iteration'])
  assert.equal(connected.toNodeId, 'generator-2')
  assert.equal(connected.fromNodeId, resultNode.id)
  assert.equal(connected.kind, 'iteration')
})

test('setting a modify base refuses to hide either of two ordinary references', () => {
  const result = { id: 'result-new', kind: 'ui-design', dataUrl: 'data:image/png;base64,NEW' }
  const resultNode = { id: 'result-node-new', type: 'result', data: { resultId: result.id, sourceNodeId: 'generator-1' } }
  const graph = {
    schemaVersion: 2,
    nodes: [
      { id: 'generator-1', type: 'generator', data: {} },
      { id: 'reference-1', type: 'reference', data: { resourceId: 'resource-1' } },
      { id: 'reference-2', type: 'reference', data: { resourceId: 'resource-2' } },
      resultNode,
    ],
    edges: [
      { id: 'reference-edge-1', fromNodeId: 'reference-1', toNodeId: 'generator-1', kind: 'reference' },
      { id: 'reference-edge-2', fromNodeId: 'reference-2', toNodeId: 'generator-1', kind: 'reference' },
    ],
    lineage: [],
  }
  const state = { project: { width: 1920, height: 1080, graph }, settings: {}, resources: [], results: [result] }
  let removed = 0
  let connected = 0
  const store = {
    getState() { return state },
    removeGraphEdge() { removed += 1 },
    connectGraph() { connected += 1; return { ok: true } },
  }
  const context = {
    module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout,
    NovaFlowUiDesignProjectResource: { createProjectStore() { return store } },
    NovaFlowUiDesignStructureTool: { normalizeGraph(value) { return value } },
  }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(bridgePath, 'utf8'), context, { filename: bridgePath })

  const response = context.module.exports.useResultAsReference(result, resultNode)
  assert.equal(response.ok, false)
  assert.match(response.error, /最多保留 1 张普通参考图/)
  assert.equal(removed, 0)
  assert.equal(connected, 0)
})
