const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('NSFW workflow and pixel helper are loaded, packaged, synced, and hash-checked before the split Runtime', () => {
  const index = read('particle-editor/index.html')
  const build = read('particle-editor-desktop/scripts/build-renderer.mjs')
  const sync = read('scripts/sync-runtime.mjs')
  const check = read('scripts/check-runtime-sync.mjs')
  const moduleName = 'split-inpaint-nsfw.workflow.js'
  const pixelHelperName = 'split-inpaint-nsfw-pixels.helper.js'
  const moduleIndex = index.indexOf(moduleName)
  const pixelHelperIndex = index.indexOf(pixelHelperName)
  const splitIndex = index.indexOf('spine-split-runtime.js')

  assert.ok(pixelHelperIndex >= 0, 'source index must load the NSFW pixel helper')
  assert.ok(moduleIndex >= 0, 'source index must load the NSFW workflow module')
  assert.ok(pixelHelperIndex < splitIndex, 'NSFW pixel helper must load before the split Runtime')
  assert.ok(moduleIndex < splitIndex, 'NSFW workflow module must load before the split Runtime')
  assert.match(index, /split-inpaint-nsfw-pixels\.helper\.js\?v=20260712-split-inpaint-nsfw-7/)
  assert.match(index, /split-inpaint-nsfw\.workflow\.js\?v=20260712-split-inpaint-nsfw-7/)
  assert.match(index, /spine-split-runtime\.js\?v=20260714-split-observer-debug-gate-1/)
  for (const [label, source] of [['build', build], ['sync', sync], ['check', check]]) {
    assert.ok(source.includes(moduleName), `${label} manifest must include ${moduleName}`)
    assert.ok(source.includes(pixelHelperName), `${label} manifest must include ${pixelHelperName}`)
  }
  assert.match(build, /requiredRuntimeShellFiles[\s\S]*split-inpaint-nsfw\.workflow\.js/)
  assert.match(build, /requiredRuntimeShellFiles[\s\S]*split-inpaint-nsfw-pixels\.helper\.js/)
})

test('Runtime keeps normal and removal routes while adding an explicit Rapid AIO route', () => {
  const source = read('particle-editor/spine-split-runtime.js')

  assert.match(source, /provider:\s*'qwen-edit-v5'/)
  assert.match(source, /provider:\s*'qwen-completion-v4'/)
  assert.match(source, /provider:\s*'removal-v4'/)
  assert.match(source, /provider:\s*'qwen-rapid-aio-nsfw-v20'/)
  assert.match(source, /workflow:\s*'rapid-aio-nsfw'/)
  assert.match(source, /NovaFlowSplitInpaintNsfwWorkflow/)
  assert.match(source, /route\.workflow === 'rapid-aio-nsfw'/)
  assert.match(source, /initialRoute\.workflow === 'rapid-aio-nsfw'[\s\S]*\?\s*''\s*:/)
  assert.match(source, /if \(route\.workflow === 'rapid-aio-nsfw'\) return await defaultRapidAioNsfwInpaintWorkflow/)
  const rapidBuilder = source.match(/async function defaultRapidAioNsfwInpaintWorkflow[\s\S]*?\n\s*async function defaultRemovalInpaintWorkflow/)
  assert.ok(rapidBuilder, 'Rapid AIO builder must be independently discoverable')
  assert.doesNotMatch(rapidBuilder[0], /defaultQwenInpaintWorkflow|fallback/i)
})

test('selection tool exposes a default-off busy-safe switch only for edit and completion', () => {
  const source = read('particle-editor/spine-split-runtime.js')

  assert.match(source, /inpaintNsfwEnabled:\s*false/)
  assert.match(source, /function selectionInpaintNsfwAvailable\(mode\)/)
  assert.match(source, /\['edit', 'completion'\]\.includes\(normalizeSelectionInpaintMode\(mode\)\)/)
  assert.match(source, /function setSelectionInpaintNsfwEnabled\(enabled\)/)
  assert.match(source, /if \(state\.busy\) return/)
  assert.match(source, /data-novaflow-selection-inpaint-nsfw/)
  assert.match(source, /role:\s*'switch'/)
  assert.match(source, /'aria-checked':\s*inpaintNsfwEnabled \? 'true' : 'false'/)
  assert.match(source, /\[TOOL_ACTION_ATTR\]:\s*'selectionNsfw'/)
  assert.match(source, /selectedInpaintMode[\s\S]{0,240}selectionInpaintNsfwAvailable/)
  assert.match(source, /function patchSelectionToolChrome\(\)[\s\S]{0,900}nsfwButton\.disabled = state\.busy/)
  assert.match(source, /function patchSelectionToolChrome\(\)[\s\S]{0,1100}nsfwButton\.setAttribute\('aria-disabled', state\.busy \? 'true' : 'false'\)/)
})

test('new entry, mode change, exit, and successful completion reset OFF while failure preserves retry state', () => {
  const source = read('particle-editor/spine-split-runtime.js')

  assert.match(source, /function resetSelectionTool\(\)[\s\S]*inpaintNsfwEnabled:\s*false/)
  assert.match(source, /async function startSelectionTool\(mode, inpaintMode\)[\s\S]*inpaintNsfwEnabled:\s*false/)
  assert.match(source, /function applySelectionInpaintMode\(mode\)[\s\S]*state\.selectionTool\.inpaintNsfwEnabled = false/)
  assert.match(source, /state\.parts = normalizeSpineLayerOrder[\s\S]*resetSelectionTool\(\)/)
  const executeBody = source.match(/async function executeInpaintTool[\s\S]*?\n\s*function renderSelectionToolCanvas/)
  assert.ok(executeBody, 'executeInpaintTool body must be discoverable')
  assert.match(executeBody[0], /let committedPart = null[\s\S]*state\.parts = normalizeSpineLayerOrder[\s\S]*committedPart = patchPart[\s\S]*resetSelectionTool\(\)/)
  const catchBlock = executeBody[0].match(/\} catch \(error\) \{([\s\S]*?)\n\s*\} finally/)
  assert.ok(catchBlock, 'executeInpaintTool catch block must be discoverable')
  assert.doesNotMatch(catchBlock[1], /inpaintNsfwEnabled|resetSelectionTool/)
  assert.match(catchBlock[1], /if \(committedPart\)[\s\S]*已写入图层[\s\S]*else setMessage/)
})

test('execution selects the NSFW provider, reuses proven V4 model preprocessing, and isolates foreground cleanup', () => {
  const source = read('particle-editor/spine-split-runtime.js')

  assert.match(source, /resolveInpaintWorkflowRoute\(selectionInpaintMode,\s*state\.selectionTool && state\.selectionTool\.inpaintNsfwEnabled/)
  assert.match(source, /inpaintInputCanvasesForRoute\(qwenCrop\.cropImage, qwenCrop\.cropMask, executionRoute\)/)
  const inputDispatcher = source.match(/function inpaintInputCanvasesForRoute[\s\S]*?\n\s*function alphaMaskFromCanvas/)
  assert.ok(inputDispatcher, 'inpaint input dispatcher must be discoverable')
  assert.doesNotMatch(inputDispatcher[0], /rapid-aio-nsfw|buildRapidAioNsfwInpaintCanvases/, 'Rapid AIO must keep the proven edit/completion preprocessing')
  assert.match(inputDispatcher[0], /resolved\.v4 && resolved\.mode === 'completion'[\s\S]*buildQwenCompletionV4Canvases/)
  assert.match(inputDispatcher[0], /if \(resolved\.v4\) return buildQwenV4RetouchCanvases/)
  assert.match(source, /runLayerInpaintValidated\(inputCanvases\.modelInput\.toDataURL\('image\/png'\), modelMaskCanvas\.toDataURL\('image\/png'\)/)
  assert.match(source, /mergeInpaintResult\(part, qwenCrop, layerOriginalCanvas, normalizedFullMask, result, \{ inputCanvases, route: executionRoute \}\)/)
  assert.match(source, /const rapidAioNsfw = !!\(route && route\.workflow === 'rapid-aio-nsfw'\)[\s\S]*if \(rapidAioNsfw\) \{[\s\S]{0,180}cleanRapidAioNsfwForeground\([^,]+, crop\.cropMask\)/)
  const mergeBody = source.match(/async function mergeInpaintResult[\s\S]*?\n\s*function compositeRemovalRgbResult/)
  assert.ok(mergeBody, 'inpaint merge must be independently discoverable')
  assert.ok(mergeBody[0].indexOf('qwenRgbWithRmbgAlpha') < mergeBody[0].indexOf('cleanRapidAioNsfwForeground'))
  assert.match(
    mergeBody[0],
    /let candidateForegroundCanvas = await qwenRgbWithRmbgAlpha[\s\S]*candidateForegroundCanvas = cleanRapidAioNsfwForeground\(candidateForegroundCanvas, crop\.cropMask\)[\s\S]*foregroundCanvas = candidateForegroundCanvas/,
    'Rapid cleanup must succeed before the foreground is committed',
  )
  const removalBody = source.match(/async function mergeRemovalInpaintResult[\s\S]*?\n\s*async function executeInpaintTool/)
  assert.ok(removalBody, 'removal merge must be independently discoverable')
  assert.doesNotMatch(removalBody[0], /cleanRapidAioNsfwForeground|removeWhiteMatteRgb/)
  const qwenAlphaMerge = source.match(/async function qwenRgbWithRmbgAlpha[\s\S]*?\n\s*function cleanRapidAioNsfwForeground/)
  assert.ok(qwenAlphaMerge, 'shared Qwen alpha merge must be discoverable')
  const sharedQwenAlphaMerge = qwenAlphaMerge[0].replace(/\n\s*function cleanRapidAioNsfwForeground[\s\S]*$/, '')
  assert.doesNotMatch(sharedQwenAlphaMerge, /removeWhiteMatte|Nsfw/i, 'shared normal-route alpha merge must remain unchanged')
})

test('Rapid subject join stays post-model and outside all normal and removal paths', () => {
  const source = read('particle-editor/spine-split-runtime.js')
  const inputDispatcher = source.match(/function inpaintInputCanvasesForRoute[\s\S]*?\n\s*function alphaMaskFromCanvas/)
  const mergeBody = source.match(/async function mergeInpaintResult[\s\S]*?\n\s*function compositeRemovalRgbResult/)
  const removalBody = source.match(/async function mergeRemovalInpaintResult[\s\S]*?\n\s*async function executeInpaintTool/)
  const executeBody = source.match(/async function executeInpaintTool[\s\S]*?\n\s*function renderSelectionToolCanvas/)

  assert.ok(inputDispatcher)
  assert.ok(mergeBody)
  assert.ok(removalBody)
  assert.ok(executeBody)
  assert.doesNotMatch(inputDispatcher[0], /SourceGuide|SubjectJoin|blendSubjectJoinRgb/)
  assert.doesNotMatch(executeBody[0].match(/const inputCanvases[\s\S]*?runLayerInpaintValidated/)?.[0] || '', /SourceGuide|SubjectJoin|blendSubjectJoinRgb/)
  assert.match(
    mergeBody[0],
    /const sourceGuideCanvas = rapidAioNsfw\s*\? await prepareRapidAioNsfwSourceGuide\(crop\.cropImage, joinPolicy\)\s*:\s*null/,
    'normal edit and completion must never prepare the Rapid source guide',
  )
  assert.match(mergeBody[0], /resolveSubjectJoinPolicy\(route\.mode,\s*Math\.min\(crop\.cropBox\.width, crop\.cropBox\.height\)\)/)
  assert.doesNotMatch(mergeBody[0], /0\.047|clampNumber\([^)]*16,\s*32/)
  assert.match(mergeBody[0], /candidateForegroundCanvas = cleanRapidAioNsfwForeground[\s\S]*candidateForegroundCanvas = blendRapidAioNsfwSubjectJoin/)
  assert.ok(mergeBody[0].indexOf('qwenRgbWithRmbgAlpha') < mergeBody[0].indexOf('cleanRapidAioNsfwForeground'))
  assert.ok(mergeBody[0].indexOf('cleanRapidAioNsfwForeground') < mergeBody[0].indexOf('blendRapidAioNsfwSubjectJoin'))
  assert.ok(mergeBody[0].indexOf('blendRapidAioNsfwSubjectJoin') < mergeBody[0].indexOf('foregroundCanvas = candidateForegroundCanvas'))
  assert.doesNotMatch(removalBody[0], /SourceGuide|SubjectJoin|blendSubjectJoinRgb/)
  const sharedAlphaMerge = source.match(/async function qwenRgbWithRmbgAlpha[\s\S]*?\n\s*function cleanRapidAioNsfwForeground/)
  assert.ok(sharedAlphaMerge)
  assert.doesNotMatch(sharedAlphaMerge[0].replace(/\n\s*function cleanRapidAioNsfwForeground[\s\S]*$/, ''), /SourceGuide|SubjectJoin|blendSubjectJoinRgb/)
  assert.match(source, /workflowApi\.assertPreparedSourceGuide\(guideStats\)/)
  assert.match(source, /falloffExponent:\s*joinPolicy\.falloffExponent/)
  assert.match(source, /restoreAlpha:\s*joinPolicy\.restoreAlpha/)
  assert.match(source, /rapidAioNsfwJoinAlphaRaisedPixels/)
  assert.match(mergeBody[0], /rapidAioNsfw[\s\S]*10b_composite_preview/)
  assert.doesNotMatch(mergeBody[0], /^\s+\{ name: '10b_composite_preview', dataUrl: compositePreviewCanvas\.toDataURL/m)
})
