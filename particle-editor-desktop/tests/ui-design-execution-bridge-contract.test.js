const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const runtimePath = path.resolve(__dirname, '../../particle-editor/novaflow-brand-runtime.js')
const source = fs.readFileSync(runtimePath, 'utf8')
const indexPath = path.resolve(__dirname, '../../particle-editor/index.html')
const index = fs.readFileSync(indexPath, 'utf8')
const referenceRoutingCacheVersion = '20260724-ui-reference-routing-9'
const referenceSynthesisCacheVersion = '20260724-ui-reference-routing-2'
const localQualityCacheVersion = '20260729-ui-local-quality-21'
const localStrictRetryCacheVersion = '20260730-ui-local-strict-retry-1'
const layoutHelperCacheVersion = '20260730-ui-grid-anchor-3'
const localColorProxyCacheVersion = '20260730-ui-local-semantic-fusion-2'
const localResolutionCacheVersion = '20260729-ui-local-quality-21'
const qualityCacheVersion = '20260729-ui-quality-refine-4'
const digitalCanvasCacheVersion = '20260724-ui-digital-canvas-2'
const quality40CacheVersion = '20260724-ui-quality40-3'
const semanticScaffoldCacheVersion = '20260724-ui-semantic-scaffold-6'
const refineResolutionCacheVersion = '20260724-ui-local-safe-resolution-1'
const localTxt2ImgCacheVersion = '20260724-ui-local-txt2img-1'
const runtimeBridgeCacheVersion = '20260813-ideogram-instant-1'
const referenceContractCacheVersion = '20260729-ui-reference-contract-4'

assert.match(source, /function artWorkflowKeyForState\(state = ART_GENERATE_STATE\)/)
assert.match(source, /function patchArtWorkflow\([^\n]+referenceSizes = \[\]\)/)
assert.match(source, /function buildArtGenerateRunWorkflow\([^\n]+referenceSizes = \[\]\)/)
assert.match(source, /arguments\.length > 8[\s\S]{0,180}ART_GENERATE_STATE/)
assert.match(source, /const providerOptions = arguments\.length > 10/)
assert.match(source, /systemPrompt: String\(providerOptions\.systemPrompt \|\| ""\)/)
assert.match(source, /taskProfile: String\(providerOptions\.taskProfile \|\| ""\)/)
assert.match(source, /layoutGuideEncoding: String\(providerOptions\.layoutGuideEncoding \|\| ""\)/)
assert.match(source, /referenceRoles: Array\.isArray\(providerOptions\.referenceRoles\)/)
assert.match(source, /systemPrompt: options\.systemPrompt[\s\S]{0,240}referenceRoles: options\.referenceRoles/)
assert.match(source, /localUiRepairMaskEncoding: String\(source\.localUiRepairMaskEncoding \|\| ""\)/)
assert.match(source, /window\.NovaFlowArtGenerateExecutionBridge = createArtGenerateExecutionBridge\(\)/)
for (const [scriptName, cacheVersion] of [
  ['art-generate-provider.workflow.js', localTxt2ImgCacheVersion],
  ['novaflow-brand-runtime.js', runtimeBridgeCacheVersion],
  ['ui-design-layout-guide.helper.js', layoutHelperCacheVersion],
  ['ui-design-local-resolution.helper.js', localResolutionCacheVersion],
  ['ui-design-local.workflow.js', localQualityCacheVersion],
  ['ui-design-local-reference.helper.js', localColorProxyCacheVersion],
  ['ui-design-local-director.workflow.js', referenceContractCacheVersion],
  ['ui-design-local-refine.workflow.js', localQualityCacheVersion],
  ['ui-design-generate.workflow.js', localColorProxyCacheVersion],
  ['ui-design-quality-review.workflow.js', qualityCacheVersion],
  ['ui-design.bridge.js', localStrictRetryCacheVersion],
]) {
  assert.match(
    index,
    new RegExp(`${scriptName.replaceAll('.', '\\.')}\\?v=${cacheVersion}`),
    `${scriptName} should cache-bust the locked browser surface`,
  )
}

for (const method of [
  'detectBaseUrl',
  'requestJson',
  'fetchBlob',
  'uploadDataUrl',
  'buildRunWorkflow',
  'validateWorkflowNodes',
  'extractFiles',
  'historyErrorMessage',
  'readQueueState',
  'withTimeout',
  'blobToDataUrl',
]) {
  assert.match(source, new RegExp(`${method}:|${method}\\(options`), `execution bridge should expose ${method}`)
}

console.log('ui design execution bridge contract tests passed')
