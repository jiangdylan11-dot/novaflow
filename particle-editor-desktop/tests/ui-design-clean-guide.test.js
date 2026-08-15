const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const projectRoot = path.resolve(__dirname, '..', '..')
const helperPath = path.join(projectRoot, 'particle-editor', 'ui-design-layout-guide.helper.js')
const workflowPath = path.join(projectRoot, 'particle-editor', 'ui-design-generate.workflow.js')
const localWorkflowPath = path.join(projectRoot, 'particle-editor', 'ui-design-local.workflow.js')
const localReferencePath = path.join(projectRoot, 'particle-editor', 'ui-design-local-reference.helper.js')

function loadCommonJs(filePath, globals = {}) {
  const context = {
    module: { exports: {} },
    exports: {},
    Buffer,
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    ...globals,
  }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath })
  return { api: context.module.exports, context }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('semantic compiler accepts graph layout blocks and normalized region data', () => {
  const { api: helper } = loadCommonJs(helperPath)
  const graphSemantic = helper.compileSemanticLayout({
    canvas: { width: 1600, height: 900 },
    blocks: [{ id: 'stale-legacy', name: '旧数据', x: 0, y: 0, width: 10, height: 10 }],
    graph: {
      schemaVersion: 2,
      nodes: [{
        id: 'layout-1',
        type: 'layout',
        data: {
          blocks: [
            { id: 'hero', name: 'Hero 主视觉', purpose: '展示角色', x: 80, y: 90, width: 960, height: 500 },
            { id: 'cta', name: 'CTA', requirements: '高对比按钮', x: 1180, y: 720, width: 280, height: 100 },
            { id: 'debug', name: '不参与', participates: false, x: 0, y: 0, width: 10, height: 10 },
          ],
        },
      }],
      edges: [],
    },
  })

  assert.equal(graphSemantic.kind, 'ui-layout-semantic')
  assert.deepEqual(plain(graphSemantic.canvas), { width: 1600, height: 900 })
  assert.deepEqual(Array.from(graphSemantic.regions, (region) => region.id), ['hero', 'cta'])
  assert.equal(graphSemantic.regions[0].xNorm, 0.05)
  assert.equal(graphSemantic.regions[1].requirements, '高对比按钮')

  const normalizedSemantic = helper.compileSemanticLayout({
    data: {
      regions: [{
        id: 'nav',
        name: '导航栏',
        role: 'navigation',
        xNorm: 0.05,
        yNorm: 0.04,
        wNorm: 0.9,
        hNorm: 0.1,
        purpose: '一级导航',
      }],
    },
  })
  assert.equal(normalizedSemantic.regions[0].hasGeometry, true)
  assert.deepEqual(
    plain(normalizedSemantic.regions[0]),
    {
      id: 'nav',
      name: '导航栏',
      role: 'navigation',
      purpose: '一级导航',
      requirements: '',
      zIndex: 1,
      hasGeometry: true,
      xNorm: 0.05,
      yNorm: 0.04,
      wNorm: 0.9,
      hNorm: 0.1,
    },
  )
})

test('semantic prompt keeps exact geometry and editor labels out of model-visible text', () => {
  const { api: helper } = loadCommonJs(helperPath)
  const prompt = helper.compileSemanticPrompt({
    name: '商城首页',
    description: '暗色奇幻游戏商城',
    requirement: '突出角色和主要行动按钮',
    canvas: { width: 1600, height: 900 },
    graph: {
      schemaVersion: 2,
      nodes: [{
        id: 'layout-1',
        type: 'layout',
        data: {
          blocks: [
            { id: 'region_1', name: 'Hero 主视觉', purpose: '展示核心角色和活动主题', x: 80, y: 90, width: 960, height: 500 },
            { id: 'region_2', name: '购买按钮', requirements: '高对比金色按钮', x: 1180, y: 720, width: 280, height: 100 },
          ],
        },
      }],
      edges: [],
    },
  })

  assert.match(prompt, /横向全屏游戏界面/)
  assert.match(prompt, /暗色奇幻游戏商城/)
  assert.match(prompt, /展示核心角色和活动主题/)
  assert.match(prompt, /高对比金色按钮/)
  assert.doesNotMatch(prompt, /1600\s*[×x]\s*900|Hero 主视觉|购买按钮|region_[12]/)
  assert.doesNotMatch(prompt, /项目：|内容职责：|生成要求：/)
  assert.doesNotMatch(prompt, /(?:^|[\s；，])(?:x|y|w|h)\s*=/i)
  assert.doesNotMatch(prompt, /\d+(?:\.\d+)?\s*%/)
})

test('clean guide is a deterministic PNG made only from filled semantic regions', () => {
  const { api: helper } = loadCommonJs(helperPath)
  const source = {
    canvas: { width: 1920, height: 1080 },
    blocks: [{
      id: 'hero',
      name: 'THIS_LABEL_MUST_NOT_ENTER_THE_GUIDE',
      purpose: 'THIS_PURPOSE_MUST_NOT_ENTER_THE_GUIDE',
      x: 160,
      y: 120,
      width: 1200,
      height: 620,
    }],
  }
  const first = helper.createCleanLayoutGuide(source, { maxEdge: 256 })
  const second = helper.createCleanLayoutGuide(source, { maxEdge: 256 })
  const bytes = Buffer.from(first.dataUrl.split(',')[1], 'base64')

  assert.equal(helper.isCleanLayoutGuide(first), true)
  assert.equal(first.visualEncoding, 'filled-regions-only')
  assert.deepEqual(Array.from(first.excludedArtifacts), ['text', 'labels', 'strokes', 'selection', 'ports', 'editor-chrome'])
  assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(bytes.includes(Buffer.from('THIS_LABEL_MUST_NOT_ENTER_THE_GUIDE')), false)
  assert.equal(bytes.includes(Buffer.from('THIS_PURPOSE_MUST_NOT_ENTER_THE_GUIDE')), false)
  assert.equal(first.dataUrl, second.dataUrl)
})

test('soft occupancy guide is a deterministic grayscale PNG without filled-region encoding', () => {
  const { api: helper } = loadCommonJs(helperPath)
  const source = {
    canvas: { width: 1080, height: 1920 },
    blocks: [
      { id: 'header', role: 'header', x: 40, y: 40, width: 1000, height: 180 },
      { id: 'hero', role: 'hero', x: 120, y: 280, width: 840, height: 620 },
      { id: 'content', role: 'content', x: 80, y: 960, width: 920, height: 650 },
      { id: 'footer', role: 'footer', x: 40, y: 1660, width: 1000, height: 200 },
    ],
  }
  const soft = helper.createCleanLayoutGuide(source, {
    maxEdge: 256,
    visualEncoding: 'soft-occupancy-heatmap-v1',
  })
  const repeated = helper.createCleanLayoutGuide(source, {
    maxEdge: 256,
    visualEncoding: 'soft-occupancy-heatmap-v1',
  })
  const filled = helper.createCleanLayoutGuide(source, { maxEdge: 256 })
  const bytes = Buffer.from(soft.dataUrl.split(',')[1], 'base64')

  assert.equal(helper.isCleanLayoutGuide(soft), true)
  assert.equal(soft.visualEncoding, 'soft-occupancy-heatmap-v1')
  assert.equal(bytes[24], 8, 'soft guide should use 8-bit pixels')
  assert.equal(bytes[25], 0, 'soft guide should use grayscale PNG color type')
  assert.equal(soft.dataUrl, repeated.dataUrl)
  assert.notEqual(soft.dataUrl, filled.dataUrl)
})

function createBridge() {
  const calls = { uploads: [], builds: [] }
  return {
    calls,
    bridge: {
      async detectBaseUrl() { return 'http://127.0.0.1:8188' },
      async requestJson(_baseUrl, requestPath) {
        if (requestPath === '/prompt') return { ok: true, data: { prompt_id: 'clean-guide-run' } }
        if (requestPath === '/history/clean-guide-run') {
          return {
            ok: true,
            data: {
              'clean-guide-run': {
                outputs: { save: { images: [{ filename: 'ui-clean.png', type: 'output', subfolder: '' }] } },
              },
            },
          }
        }
        return { ok: true, data: {} }
      },
      async fetchBlob() { return { kind: 'blob' } },
      async uploadDataUrl(baseUrl, name, dataUrl) {
        calls.uploads.push({ baseUrl, name, dataUrl })
        return `uploaded_${calls.uploads.length}.png`
      },
      buildRunWorkflow(options) {
        calls.builds.push(options)
        return { workflow: { save: { class_type: 'SaveImage', inputs: {} } }, modelKey: 'fixture' }
      },
      async validateWorkflowNodes() { return true },
      extractFiles(history) { return history?.outputs?.save?.images || [] },
      historyErrorMessage() { return '' },
      async readQueueState() { return { empty: false, pending: 1 } },
      async withTimeout(task) { return await task() },
      async blobToDataUrl() { return 'data:image/png;base64,RESULT' },
    },
  }
}

for (const provider of ['local', 'gpt', 'google']) {
  test(`${provider} generation never uploads raw editor skeleton pixels`, async () => {
    const { api: helper } = loadCommonJs(helperPath)
    const { api: localWorkflow } = loadCommonJs(localWorkflowPath)
    const { api: localReference } = loadCommonJs(localReferencePath)
    const { calls, bridge } = createBridge()
    let releases = 0
    const { api: workflow } = loadCommonJs(workflowPath, {
      NovaFlowUiDesignLayoutGuide: helper,
      NovaFlowUiDesignLocalWorkflow: localWorkflow,
      NovaFlowUiDesignLocalReference: localReference,
      NovaFlowArtGenerateExecutionBridge: bridge,
      NovaFlowArtGenerateModels: {
        normalizeProvider(value) { return ['gpt', 'google'].includes(value) ? value : 'local' },
        workflowSettings() { return {} },
      },
      NovaFlowClientAuth: {
        createAuthorizationContext() { return { release() { releases += 1 } } },
      },
      electronAPI: { runtimeProviderUsageSettlement: 'preload-price-v1' },
    })
    const rawEditorSkeleton = 'data:image/png;base64,RAW_EDITOR_LABELS_BORDERS_PORTS'
    const refs = [
      { id: 'style', role: 'style', name: 'style.png', dataUrl: 'data:image/png;base64,STYLE' },
      { id: 'character', role: 'character', name: 'character.png', dataUrl: 'data:image/png;base64,CHARACTER' },
      { id: 'material', role: 'material', name: 'material.png', dataUrl: 'data:image/png;base64,MATERIAL' },
    ].slice(0, provider === 'local' ? 2 : 3)
    const expectedRoles = provider === 'local'
      ? ['ui_layout', 'style', 'character']
      : ['ui_layout', 'style', 'character', 'material']
    const expectedEncoding = provider === 'local'
      ? 'soft-ui-semantic-scaffold-v2'
      : provider === 'google'
        ? 'soft-occupancy-heatmap-v1'
        : 'filled-regions-only'
    const result = await workflow.run({
      provider,
      project: {
        name: '活动页',
        canvas: { width: 1280, height: 720 },
        graph: {
          schemaVersion: 2,
          nodes: [{
            id: 'layout',
            type: 'layout',
            data: {
              blocks: [{ id: 'hero', name: 'Hero 主视觉', purpose: '展示活动角色', x: 80, y: 80, width: 900, height: 420 }],
            },
          }],
          edges: [],
        },
        skeleton: { name: 'legacy-editor-skeleton.png', dataUrl: rawEditorSkeleton },
      },
      layoutGuide: provider === 'google'
        ? {
            kind: 'ui-layout-guide',
            role: 'ui_layout',
            clean: true,
            editorSnapshot: false,
            visualEncoding: 'filled-regions-only',
            name: 'supplied-filled-guide.png',
            dataUrl: rawEditorSkeleton,
          }
        : { dataUrl: rawEditorSkeleton },
      refs,
      state: { provider, width: 1280, height: 720 },
      async localReferenceTransformer(reference) {
        return {
          dataUrl: `data:image/png;base64,PROXY_${reference.index}`,
          width: 24,
          height: 24,
          proxyEncoding: 'test-low-frequency',
        }
      },
      pollIntervalMs: 0,
    })

    assert.equal(calls.uploads.length, refs.length + 1)
    assert.notEqual(calls.uploads[0].dataUrl, rawEditorSkeleton)
    assert.match(calls.uploads[0].dataUrl, /^data:image\/png;base64,iVBOR/)
    assert.equal(
      calls.uploads.some((item) => item.dataUrl === rawEditorSkeleton),
      false,
      'the raw editor skeleton must never enter synthesis',
    )
    assert.deepEqual(plain(calls.builds[0].referenceRoles).map(({ role }) => role), expectedRoles)
    assert.equal(calls.builds[0].taskProfile, 'ui-design')
    assert.equal(calls.builds[0].layoutGuideEncoding, expectedEncoding)
    assert.equal(calls.builds[0].layoutGuide.visualEncoding, expectedEncoding)
    assert.equal(calls.builds[0].semanticLayout.regions[0].name, 'Hero 主视觉')
    if (provider === 'local') {
      assert.equal(calls.builds[0].mode, 'img2img')
      assert.match(calls.builds[0].prompt, /\[LAYOUT\]/)
      assert.match(calls.builds[0].prompt, /\[REFERENCE\]/)
      assert.match(calls.builds[0].prompt, /图1仅表达功能区顺序、相对占比、留白与重复项数量/)
      assert.match(calls.builds[0].prompt, /\[OUTPUT\]/)
      assert.doesNotMatch(calls.builds[0].prompt, /There is no visual layout reference|analysis-only/i)
      assert.doesNotMatch(calls.builds[0].prompt, /soft, theme-neutral semantic UI scaffold/i)
      assert.equal(calls.builds[0].systemPrompt, '')
    } else if (provider === 'google') {
      assert.match(calls.builds[0].prompt, /Image 1.*soft, low-frequency spatial occupancy guide/i)
      assert.match(calls.builds[0].prompt, /region centers, relative coverage, ordering and whitespace/i)
      assert.match(calls.builds[0].prompt, /does not imply a card, frame, panel, halo, border, container or background band/i)
      assert.doesNotMatch(calls.builds[0].prompt, /turn every guide shape into finished visual content/i)
      assert.match(calls.builds[0].systemPrompt, /non-visual soft spatial occupancy guide/i)
      assert.match(calls.builds[0].systemPrompt, /does not imply a card, frame, panel, halo, border, container or background band/i)
    } else {
      assert.match(calls.builds[0].prompt, /Image 1.*clean geometry guide/i)
      assert.match(calls.builds[0].prompt, /turn every guide shape into finished visual content/i)
      assert.equal(calls.builds[0].systemPrompt, '')
    }
    if (provider === 'local') {
      assert.match(calls.builds[0].prompt, /图2仅提供风格、材质、线条、光影与装饰语言/)
      assert.match(calls.builds[0].prompt, /图3仅提供已声明角色的身份和外观特征/)
      assert.equal(result.referenceGuidedRedesign, true)
      assert.equal(result.analysisOnlyReferenceCount, 0)
      assert.equal(result.synthesisReferenceCount, refs.length + 1)
      assert.deepEqual(Array.from(result.localReferenceProxyEncodings), [])
    } else {
      assert.match(calls.builds[0].prompt, /图2（风格参考）/)
      assert.match(calls.builds[0].prompt, /图3（角色参考）/)
      assert.match(calls.builds[0].prompt, /图4（材质参考）/)
    }
    assert.doesNotMatch(calls.builds[0].prompt, /1280\s*[×x]\s*720|Hero 主视觉|\bhero\b/i)
    assert.doesNotMatch(calls.builds[0].prompt, /(?:^|[\s；，])(?:x|y|w|h)\s*[:=：]/i)
    assert.doesNotMatch(calls.builds[0].prompt, /\d+(?:\.\d+)?\s*%/)
    assert.equal(calls.builds[0].prompt.includes('\n'), false)
    assert.equal(result.layoutGuideSource, 'semantic-layout-compiler')
    assert.deepEqual(Array.from(result.referenceRoles), expectedRoles)
    assert.equal(releases, provider === 'local' ? 0 : 1)
  })
}
