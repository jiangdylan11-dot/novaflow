const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const mentionPath = path.join(root, 'particle-editor', 'resource-mention.tool.js')
const mentionCssPath = path.join(root, 'particle-editor', 'resource-mention.tool.css')
const workflowPath = path.join(root, 'particle-editor', 'ui-design-generate.workflow.js')

function loadMentionTool() {
  const context = { console }
  context.window = context
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(mentionPath, 'utf8'), context, { filename: mentionPath })
  return context.NovaFlowResourceMentionTool
}

function loadWorkflow(extra = {}) {
  const context = {
    module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout,
    URLSearchParams, ...extra,
  }
  context.globalThis = context
  vm.runInNewContext(fs.readFileSync(workflowPath, 'utf8'), context, { filename: workflowPath })
  return context.module.exports
}

function uiResources(count) {
  return Array.from({ length: count }, (_, index) => ({
    key: `resource_${index + 1}`,
    sourceId: `source-${index + 1}`,
    occupied: true,
    fileName: `reference_${index + 1}.png`,
    previewUrl: `data:image/png;base64,${index + 1}`,
  }))
}

test('ui-design mention surface is dynamic, capped at 15, and reserves model image 1 for layout', () => {
  const tool = loadMentionTool()
  const resources = uiResources(18)
  const compiled = tool.compileText({
    surface: 'ui-design',
    resources,
    text: '@参考图1 提供布局，@参考图15 提供材质，@参考图16 不应可用',
  })
  assert.equal(tool.UI_DESIGN_MAX_REFERENCES, 15)
  assert.equal(compiled.text, '图2 提供布局，图16 提供材质，@参考图16 不应可用')
  assert.deepEqual(Array.from(compiled.invalidTokens), ['@参考图16'])
  assert.deepEqual(Array.from(compiled.mentions, (item) => item.modelLabel), ['图2', '图16'])
})

test('ui-design mention edits snapshot stable resource identities instead of only visible positions', () => {
  const tool = loadMentionTool()
  const snapshot = tool.uiDesignMentionBindingSnapshot('@参考图2 与 @参考图1', uiResources(3))
  assert.deepEqual({ ...snapshot.bindings }, {
    '@参考图1': 'source-1',
    '@参考图2': 'source-2',
  })
  assert.deepEqual(Array.from(snapshot.orderedSourceIds), ['source-1', 'source-2', 'source-3'])
})

test('mention editor geometry converts transformed screen pixels back into host-local coordinates', () => {
  const tool = loadMentionTool()
  const scaled = tool.overlayGeometry(
    { left: 120, top: 70, width: 300, height: 80 },
    { left: 100, top: 50, width: 400, height: 200 },
    { offsetWidth: 200, offsetHeight: 100, clientLeft: 1, clientTop: 1, scrollLeft: 0, scrollTop: 0 },
  )
  assert.deepEqual({ ...scaled }, { left: 9, top: 9, width: 150, height: 40 })

  const unscaled = tool.overlayGeometry(
    { left: 120, top: 70, width: 150, height: 40 },
    { left: 100, top: 50, width: 200, height: 100 },
    { offsetWidth: 200, offsetHeight: 100, clientLeft: 1, clientTop: 1, scrollLeft: 0, scrollTop: 0 },
  )
  assert.deepEqual({ ...unscaled }, { left: 19, top: 19, width: 150, height: 40 })
})

test('ui-design mention editor is the only visible prompt layer without changing other surfaces', () => {
  const css = fs.readFileSync(mentionCssPath, 'utf8')
  const scopedSelector = '[data-novaflow-ui-design-prompt-editor].nf-resource-mention-host'
  const scopedStart = css.indexOf(scopedSelector)
  assert.notEqual(scopedStart, -1, 'UI design needs a surface-scoped backing rule')
  const scopedRule = css.slice(scopedStart, css.indexOf('}', scopedStart) + 1)
  assert.match(scopedRule, />\s*textarea\.nf-resource-mention-backing/)
  assert.match(scopedRule, /opacity:\s*0\s*!important/)

  const globalStart = css.indexOf('textarea.nf-resource-mention-backing {')
  const globalRule = css.slice(globalStart, css.indexOf('}', globalStart) + 1)
  assert.doesNotMatch(globalRule, /opacity:/, 'art and animation backing layers must keep their established rendering contract')
})

test('ui-design only exposes connected references while art and seedance numbering stay unchanged', () => {
  const tool = loadMentionTool()
  const ui = tool.compileText({ surface: 'ui-design', resources: uiResources(2), text: '@参考图2 @参考图3' })
  assert.equal(ui.text, '图3 @参考图3')
  assert.deepEqual(Array.from(ui.invalidTokens), ['@参考图3'])

  const art = tool.compileText({
    surface: 'art-generate',
    resources: [{ key: 'art_reference_1', occupied: true }],
    text: '@参考图1',
  })
  assert.equal(art.text, '图1')

  const seedance = tool.compileText({
    surface: 'seedance',
    resources: [{ key: 'ref_image', occupied: true }],
    text: '@参考图1',
  })
  assert.equal(seedance.text, '@Image 1')
})

test('workflow rejects invalid UI mentions before connect or upload', async () => {
  let connects = 0
  let uploads = 0
  const bridge = {
    detectBaseUrl: async () => { connects += 1; return 'http://127.0.0.1:8188' },
    requestJson: async () => ({}),
    fetchBlob: async () => ({}),
    uploadDataUrl: async () => { uploads += 1; return 'uploaded.png' },
    buildRunWorkflow: async () => ({ workflow: {} }),
    validateWorkflowNodes: async () => true,
    extractFiles: () => [],
    historyErrorMessage: () => '',
    readQueueState: async () => ({ empty: true }),
    withTimeout: async (task) => await task(),
    blobToDataUrl: async () => 'data:image/png;base64,result',
  }
  const workflow = loadWorkflow({
    NovaFlowUiDesignLocalWorkflow: {
      resolveIntent() { return 'redesign' },
    },
    NovaFlowUiDesignLocalReference: {
      buildReferencePlan(refs) { return { entries: refs } },
      async materializeReferencePlan(plan) { return plan },
    },
    NovaFlowUiDesignLayoutGuide: {
      createCleanLayoutGuide() {
        return {
          kind: 'ui-layout-guide',
          role: 'ui_layout',
          clean: true,
          editorSnapshot: false,
          name: 'ui_layout_guide.png',
          dataUrl: 'data:image/png;base64,GUIDE',
          width: 1920,
          height: 1080,
          visualEncoding: 'soft-ui-semantic-scaffold-v2',
          semantic: { canvas: { width: 1920, height: 1080 }, regions: [] },
        }
      },
    },
  })
  await assert.rejects(
    workflow.run({
      bridge,
      provider: 'local',
      project: { width: 1920, height: 1080, blocks: [] },
      refs: [{ name: 'one.png', dataUrl: 'data:image/png;base64,one' }],
      prompt: '采用 @参考图2 的风格',
    }),
    /@参考图2/,
  )
  assert.equal(connects, 0)
  assert.equal(uploads, 0)
})

test('provider capability declares negative channel ownership', () => {
  const workflow = loadWorkflow()
  assert.equal(workflow.providerCapability('local').negativePrompt, true)
  assert.equal(workflow.providerCapability('gpt').negativePrompt, false)
  assert.equal(workflow.providerCapability('google').negativePrompt, false)
  const compiled = workflow.compileUiMentions('@参考图1 和 @参考图2', [
    { sourceId: 'a' }, { sourceId: 'b' },
  ])
  assert.equal(compiled.text, '图2 和 图3')
  const analysisOnly = workflow.compileUiMentions('@参考图1 和 @参考图2', [
    { sourceId: 'a' }, { sourceId: 'b' },
  ], { analysisOnly: true })
  assert.equal(analysisOnly.text, '所选参考图1的视觉方向 和 所选参考图2的视觉方向')
})

test('workflow blocks a readable mention when its original source identity moved', () => {
  const workflow = loadWorkflow()
  const references = [{ sourceId: 'current-a' }, { sourceId: 'current-b' }]
  assert.equal(workflow.assertStableUiMentionBindings(
    '沿用 @参考图2 的配色',
    references,
    { '@参考图2': 'current-b' },
  ), true)
  assert.throws(() => workflow.assertStableUiMentionBindings(
    '沿用 @参考图2 的配色',
    references,
    { '@参考图2': 'previous-resource' },
  ), /原绑定已变化.*重新选择参考图/)
  assert.throws(() => workflow.assertStableUiMentionBindings(
    '沿用 @参考图1 的配色',
    references,
    {},
  ), /原绑定已变化/)
})
