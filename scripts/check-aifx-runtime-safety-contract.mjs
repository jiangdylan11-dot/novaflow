import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtime = readFileSync(path.join(root, 'particle-editor/aifx-repaint-runtime.js'), 'utf8')
const materialReconstruct = readFileSync(path.join(root, 'particle-editor/aifx-material-reconstruct.workflow.js'), 'utf8')

const functionSlice = (startMarker, endMarker) => {
  const start = runtime.indexOf(startMarker)
  const end = runtime.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0, 'missing runtime marker: ' + startMarker)
  assert.ok(end > start, 'missing runtime end marker: ' + endMarker)
  return runtime.slice(start, end)
}

const runtimeWindow = { addEventListener() {}, setTimeout, clearTimeout }
const runtimeContext = {
  window: runtimeWindow,
  document: { readyState: 'loading', addEventListener() {} },
  performance: { now: () => 0 },
  console: { warn() {}, error() {}, log() {} },
  setTimeout,
  clearTimeout,
  AbortController,
  TextEncoder,
  Uint8ClampedArray,
  Float32Array,
}
vm.runInNewContext(runtime, runtimeContext, { filename: 'aifx-repaint-runtime.js' })

const helpers = runtimeWindow.NovaFlowAifxMvp?.pureHelpers
assert.equal(typeof helpers?.canonicalAifxFrameName, 'function')
assert.equal(typeof helpers?.buildAifxExportSessionDir, 'function')
assert.equal(typeof helpers?.assertAifxImagePixelBudget, 'function')
assert.equal(typeof helpers?.assertAifxLifecycleAlphaQuality, 'function')

assert.equal(helpers.canonicalAifxFrameName(0), 'frame_000.png')
assert.equal(helpers.canonicalAifxFrameName(9), 'frame_009.png')
assert.equal(helpers.canonicalAifxFrameName(123), 'frame_123.png')

const deterministicDir = helpers.buildAifxExportSessionDir('C:\\Exports\\', '../NovaFlow AIFX', '../run-1')
assert.equal(deterministicDir, 'C:\\Exports\\NovaFlow_AIFX_run-1')
assert.ok(!path.win32.basename(deterministicDir).includes('..'))
const uniqueDirA = helpers.buildAifxExportSessionDir('C:\\Exports', 'NovaFlow_AIFX')
const uniqueDirB = helpers.buildAifxExportSessionDir('C:\\Exports', 'NovaFlow_AIFX')
assert.notEqual(uniqueDirA, uniqueDirB, 'each desktop export must use a unique asset directory')

assert.equal(helpers.assertAifxImagePixelBudget(2048, 2048), 4 * 1024 * 1024)
assert.throws(
  () => helpers.assertAifxImagePixelBudget(2049, 2048),
  (error) => error?.code === 'AIFX_INPUT_PIXEL_BUDGET_EXCEEDED',
)

const lifecycle = { mode: 'one-shot', startFrame: 0, endFrame: 2, peakFrame: 1 }
const goodLifecycle = [
  { sampledPixels: 1000, visiblePixels: 0, coverageRatio: 0 },
  { sampledPixels: 1000, visiblePixels: 320, coverageRatio: 0.32 },
  { sampledPixels: 1000, visiblePixels: 1, coverageRatio: 0.001 },
]
assert.equal(helpers.assertAifxLifecycleAlphaQuality(goodLifecycle, lifecycle, 'AIFX_TEST'), goodLifecycle)
assert.throws(
  () => helpers.assertAifxLifecycleAlphaQuality(
    [goodLifecycle[0], { sampledPixels: 1000, visiblePixels: 0, coverageRatio: 0 }, goodLifecycle[2]],
    lifecycle,
    'AIFX_TEST',
  ),
  (error) => error?.code === 'AIFX_TEST_ALPHA_EMPTY',
)
assert.throws(
  () => helpers.assertAifxLifecycleAlphaQuality(
    [goodLifecycle[0], { sampledPixels: 1000, visiblePixels: 985, coverageRatio: 0.985 }, goodLifecycle[2]],
    lifecycle,
    'AIFX_TEST',
  ),
  (error) => error?.code === 'AIFX_TEST_ALPHA_COVERAGE_INVALID',
)

assert.match(runtime, /maxTemplateFrames: 48/)
assert.match(runtime, /maxInputFileBytes: 32 \* 1024 \* 1024/)
assert.match(runtime, /maxTemplateFileBytes: 192 \* 1024 \* 1024/)
assert.match(runtime, /maxFramePixels: 4 \* 1024 \* 1024/)
assert.match(runtime, /maxTemplatePixels: 24 \* 1024 \* 1024/)
assert.match(runtime, /maxStylePixels: 16 \* 1024 \* 1024/)
assert.match(runtime, /maxSheetDimension: 4096/)
assert.match(runtime, /maxSheetPixels: 8 \* 1024 \* 1024/)

const frameDecode = functionSlice('const dataUrlToFrame', '\n  const readTemplateFiles')
assert.ok(
  frameDecode.indexOf('assertAifxImagePixelBudget') < frameDecode.indexOf('const canvas = createCanvas'),
  'frame pixel budget must be checked before canvas allocation',
)
assert.match(frameDecode, /AIFX_TEMPLATE_TOTAL_PIXELS_EXCEEDED/)

const templateImport = functionSlice('const readTemplateFiles', '\n  const normalizeFrameSize')
assert.ok(
  templateImport.indexOf('maxTemplateFrames') < templateImport.indexOf('imageFileToFrame'),
  'frame-count budget must run before image decoding',
)
assert.ok(
  templateImport.indexOf('maxTemplateFileBytes') < templateImport.indexOf('imageFileToFrame'),
  'aggregate file budget must run before image decoding',
)
assert.match(templateImport, /remainingPixels: AIFX_RUNTIME_BUDGET\.maxTemplatePixels - totalPixels/)

const styleImport = functionSlice('const readStyleFile', '\n  const readStyleDataUrl')
assert.ok(
  styleImport.indexOf('assertAifxFileByteBudget') < styleImport.indexOf('fileToDataUrl'),
  'style file bytes must be checked before FileReader allocation',
)
assert.ok(
  styleImport.indexOf('assertAifxImagePixelBudget') < styleImport.indexOf('const sampleSize'),
  'style pixels must be checked before canvas allocation',
)

const templateSheet = functionSlice('const prepareAifxTemplateSheet', '\n  const aifxProgressText')
assert.ok(
  templateSheet.indexOf('assertAifxProductionSheetBudget') < templateSheet.indexOf('templateResource.packFrames'),
  'sheet budget must be checked before packing the production canvas',
)
assert.ok(
  templateSheet.indexOf('assertAifxLifecycleAlphaQuality') < templateSheet.indexOf('templateResource.packFrames'),
  'template alpha must fail closed before model submission',
)

const production = functionSlice('const runAifxProductionPipeline', '\n  const runAifxSpritesheetConditionedRegenPipelineSequence')
assert.match(production, /assertSheetBudget: assertAifxProductionSheetBudget/)
assert.match(production, /assertLifecycleAlphaQuality: assertAifxLifecycleAlphaQuality/)
assert.match(production, /postprocessWorkflow: modules\.postprocess/)
assert.match(production, /qualityWorkflow: modules\.quality/)
assert.match(materialReconstruct, /assertSheetBudget\(\{[\s\S]*?postprocessWorkflow\.validateGeneratedSheetGeometry/)
assert.match(materialReconstruct, /assertLifecycleAlphaQuality\(frameQuality, options\.lifecycle, 'AIFX_FINAL'\)/)
assert.match(materialReconstruct, /postprocessWorkflow\.postprocessGeneratedSheet\(\{/)
assert.match(materialReconstruct, /qualityWorkflow\.evaluate\(\{/)
assert.doesNotMatch(production, /buildAifxGeometryLockedFrames\(/)
assert.doesNotMatch(production, /enforceAifxTemplateAlpha\(/)
assert.doesNotMatch(production, /quality\.some\(\(entry\) => entry\.alphaPixels > 0\)/)

const pngExport = functionSlice('const exportPngSequence', '\n  const applyToProject')
assert.match(pngExport, /const exportName = sanitizeAifxExportName\(options\.name, ''\)/)
assert.match(pngExport, /buildAifxExportSessionDir\(parentDir, exportName \|\| 'NovaFlow_AIFX'\)/)
assert.match(pngExport, /downloadBrowserFinalProductZip\(product, \{ name: exportName \}\)/)
assert.match(pngExport, /const frameDir = .*assetDir/)
assert.ok(pngExport.indexOf('for (const frame') < pngExport.indexOf('const atlasBytes'))
assert.ok(pngExport.indexOf('const atlasBytes') < pngExport.indexOf('atlasMetadata.name'))
assert.ok(pngExport.indexOf('atlasMetadata.name') < pngExport.indexOf('generationManifest.name'))
assert.ok(pngExport.indexOf('generationManifest.name') < pngExport.indexOf('state.lastExportDir = assetDir'))
assert.doesNotMatch(pngExport, /result\?\.ok === false/)

const spineExport = functionSlice('const exportSpineProject', '\n  const buildSpineAtlas')
assert.match(spineExport, /const exportName = sanitizeAifxExportName\(options\.name, ''\)/)
assert.match(spineExport, /buildAifxExportSessionDir\(parentDir, exportName \|\| 'NovaFlow_AIFX_Spine'\)/)
assert.match(spineExport, /const base = exportName \|\| 'aifx_conditioned_regen'/)
assert.ok(spineExport.indexOf('fileName: \`\$\{base\}\.png\`') < spineExport.indexOf('writeTextAsBinary(assetDir, \`\$\{base\}\.atlas\`'))
assert.ok(spineExport.indexOf('writeTextAsBinary(assetDir, \`\$\{base\}\.atlas\`') < spineExport.indexOf('writeTextAsBinary(assetDir, \`\$\{base\}\.json\`'))
assert.ok(spineExport.indexOf('writeTextAsBinary(assetDir, \`\$\{base\}\.json\`') < spineExport.indexOf('state.lastExportDir = assetDir'))
assert.doesNotMatch(spineExport, /atlasImageResult\?\.ok === false/)

const clearState = functionSlice('const clearGeneratedState', '\n  const freezeAifxSnapshotValue')
assert.match(clearState, /releaseAifxGeneratedResources\(\)/)
assert.match(clearState, /window\.__NOVA_AIFX_LAST_PRODUCT = null/)
assert.match(clearState, /window\.__NOVA_AIFX_LAST_SEQUENCE = null/)
assert.doesNotMatch(clearState, /state\.templateFrames = \[\]/)
assert.doesNotMatch(clearState, /state\.styleReference = null/)

const hideApp = functionSlice('const hideApp', '\n  const closeApp')
assert.ok(hideApp.indexOf("generationAbort.abort('AIFX panel closed by user')") < hideApp.indexOf('clearGeneratedState()'))
assert.match(hideApp, /state\.previewMode = 'template'/)
assert.doesNotMatch(hideApp, /state\.templateFrames = \[\]/)
assert.doesNotMatch(hideApp, /state\.styleReference = null/)

console.log('aifx-runtime-safety-contract: PASS')
