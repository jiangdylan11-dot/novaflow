const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const RUNTIME = 'particle-editor/spine-split-runtime.js'
const CACHE_VERSION = '20260922-layer-seam-seal'

// 去除物体 repaints everything the stroke covers, so a stroke over a glow changed the rest of the
// picture too (the user's 2026-09-16 report). The 特效 switch keys the effect the way 智能抠图 does
// and hands that key to the removal as its mask, so only the effect's own pixels are rewritten.
test('去除物体 carries the same 特效 switch as 智能抠图 and relabels 执行删除', () => {
  const html = read('particle-editor/index.html')
  assert.ok(html.includes(`spine-split-runtime.js?v=${CACHE_VERSION}`), 'index.html must load the effect-removal build of the split runtime')
  const source = read(RUNTIME)
  assert.match(source, /const effectRemovalTool = isInpaint && selectedInpaintMode === 'repair'/, 'the switch belongs to 去除物体, not to 局部编辑 or 智能补图')
  assert.match(source, /const effectToolAvailable = isCutoutTool \|\| effectRemovalTool/, 'one switch, two tools')
  assert.match(source, /'data-novaflow-selection-effect-kind': effectRemovalTool \? 'remove' : 'extract',/, 'the switch says which side it is on')
  assert.match(source, /function selectionEffectModeAvailable\(tool\) \{[\s\S]{0,420}?return current\.mode === 'inpaint' && normalizeSelectionInpaintMode\(current\.inpaintMode\) === 'repair'/, 'availability is shared by the toolbar, the setter and the in-place patch')
  assert.match(source, /if \(next !== 'repair'\) state\.selectionTool\.effectMode = false/, 'switching to 局部编辑/智能补图 drops the switch')
  assert.match(source, /if \(selectionEffectRemovalActive\(\)\) return executeEffectRemoveTool\(\)/, '执行删除 runs the removal while the switch is on')
  assert.match(source, /inpaint: isEffectRemoving \? '特效去除中…' : \(isInpainting \? selectionInpaintModeBusyLabel\(selectedInpaintMode\) : \(inpaintActive \? \(effectRemovalActive \? '执行特效去除' : selectionInpaintModeExecuteLabel\(selectedInpaintMode\)\) : '\\u667a\\u80fd\\u8865\\u56fe'\)\),/, 'the 智能补图 control relabels too')
  assert.match(source, /inpaintRepair: isEffectRemoving \? '特效去除中…' : \(isInpainting && selectedInpaintMode === 'repair' \? selectionInpaintModeBusyLabel\('repair'\) : \(inpaintActive && selectedInpaintMode === 'repair' \? \(effectRemovalActive \? '执行特效去除' : selectionInpaintModeExecuteLabel\('repair'\)\) : selectionInpaintModeStartLabel\('repair'\)\)\),/, '去除物体 → 执行删除 → 执行特效去除')
  assert.match(source, /const COMFY_BUSY_ACTIONS = new Set\(\['split', 'cutout', 'removeBackground', 'effectExtract', 'effectRemove',/, 'the removal shows the ComfyUI busy overlay with elapsed time')
  assert.match(source, /effectRemove: '\\u6b63\\u5728\\u53bb\\u9664\\u7279\\u6548\.\.\.'/, 'the busy overlay names the removal')
  assert.match(source, /name === 'selectionExit' \|\| name === 'selectionEffect' \|\| \(kind === 'cutout' && name === 'selectionRemoveBackground'\)/, 'the switch stays clickable while the inpaint tool holds the workspace')
  assert.match(source, /has\('__novaflow_effect_remove_smoke'\)/, 'the in-page smoke is wired to a query flag')
  assert.match(source, /executeEffectRemoveTool,\n\s+runEffectRemoveSmokeTest,\n\s+runObjectTransferSmokeTest,\n\s+objectTransferBuildInputCanvases,\n\s+buildObjectTransferQwenWorkflow,\n\s+selectionEffectModeAvailable,\n\s+selectionEffectRemovalActive,\n\s+effectRemovalMaskCanvas,\n\s+effectRemovalMaskGrowPx,\n\s+effectDeeffectPromptText,\n\s+buildEffectDeeffectQwenWorkflow,\n\s+qwenEditReferenceSize,\n\s+qwenEditPlateSize,/, 'the debug hooks expose the plate sizing and the de-effect pass')
})

test('the removal keys the effect with the extraction pipeline and uses that key as the removal mask', () => {
  const source = read(RUNTIME)
  assert.doesNotMatch(source, /buildEffectRemoveQwenWorkflow|effectRemovePromptText/, 'one prompt and one extraction workflow for both directions')
  assert.match(source, /const extraction = await runEffectExtractPipeline\(\{ baseCanvas: layerOriginalCanvas, maskCanvas: processingMaskCanvas \}, bounds, \{\n\s+prefix: EFFECT_REMOVE_FILENAME_PREFIX,\n\s+stageLabel: '特效识别',\n\s+emptyMessage: '没有识别到可去除的特效，请涂抹更靠近特效的区域后重试',\n\s+gateBySoftMask: false \/\/ the stroke bounds the crop, not the key\n\s+\}\)/, 'pass 1 keys the whole crop: the stroke bounds the crop, not the key')
  // Gating the key by the stroke left every sparkle just outside it in the picture (2026-09-17 report),
  // because the de-effected plate is only pasted where the key says effect.
  assert.match(source, /if \(input\.softMask && options\.gateBySoftMask !== false\) \{/, '智能抠图 keeps the stroke gate, 特效去除 turns it off')
  assert.match(source, /if \(!bounds \|\| bounds\.count < 16\) bounds = null \/\/ 不涂抹 = 整图，和智能抠图的特效模式一致/, 'no stroke means the whole image, same as 智能抠图')
  assert.match(source, /const effectMask = effectRemovalMaskCanvas\(extraction\.finalCanvas, EFFECT_REMOVE_MASK_FLOOR, effectRemovalMaskGrowPx\(layerOriginalCanvas\)\)/, 'the keyed effect becomes the mask')
  assert.match(source, /const plate = await runEffectDeeffectPass\(extraction, runId\)/, 'pass 2 de-effects the very same plate the key came from')
  assert.match(source, /const cropBox = extraction\.input\.cropBox\n\s+const cropMask = cropMaskToBlackWhite\(effectMask, cropBox\)\n\s+\/\/ Mask-limited composite[^\n]*\n\s+const finalCanvas = compositeRemovalRgbResult\(layerOriginalCanvas, plate\.plate, cropMask, cropBox\)/, 'one crop for both passes, and only keyed pixels are written back')
  assert.match(source, /function effectDeeffectPromptText\(\) \{[\s\S]{0,700}?'Remove all the glowing light effects and sparkle particles from the image\.',/, 'the de-effect prompt mirrors the extraction prompt')
  // The FLUX fill it replaces kept repainting the sparkles from the surrounding context.
  assert.doesNotMatch(source.slice(source.indexOf('async function executeEffectRemoveTool('), source.indexOf('function localMaskCount(')), /runLayerInpaintValidated|resolveInpaintWorkflowRoute/, 'the removal no longer goes through the inpaint fill')
  assert.match(source, /kind: 'effect-removal',\n\s+source: 'executeEffectRemoveTool',/, 'the result layer is tagged')
  assert.match(source, /replacementForPartId: part\.id \}\n\s+const nextParts = state\.parts\.map\(\(item\) => String\(item && item\.id \|\| ''\) === String\(part\.id\) \? \{ \.\.\.item, visible: false \} : item\)/, 'the cleaned layer replaces the source layer, same as 执行删除')
  assert.match(source, /const EFFECT_REMOVE_MASK_FLOOR = EFFECT_EXTRACT_ALPHA_FLOOR/, 'everything the extraction kept counts as effect; a higher floor left glitter behind')
  // A full Qwen 2511 de-effect pass erases the effects but re-renders the whole crop, so its plate
  // cannot be pasted back through the key — the fill model is what keeps unmasked pixels intact.
  assert.match(source, /const plate = await qwenEditPlateResultCanvas\(dataUrl, plateSize, extraction\.input\.plateContent, extraction\.input\.cropBox\.width, extraction\.input\.cropBox\.height, '去特效化'\)/, 'the plate is asserted to come back at the size we sent and is mapped onto the crop')
  // A tight key is a speckle field and the fill model paints the sparkles straight back; grown to ~12px
  // on a 756px picture the glow becomes one solid hole and comes out clean (tuned live 2026-09-16).
  assert.match(source, /const EFFECT_REMOVE_MASK_GROW_RATIO = 0\.008\n\s+const EFFECT_REMOVE_MASK_GROW_MIN = 4\n\s+const EFFECT_REMOVE_MASK_GROW_MAX = 16/, 'an aligned plate only needs the key grown over the glow edge, not over a misregistration')
  assert.match(source, /function effectRemovalMaskGrowPx\(canvas\) \{[\s\S]{0,320}?clampNumber\(shortest \* EFFECT_REMOVE_MASK_GROW_RATIO, EFFECT_REMOVE_MASK_GROW_MIN, EFFECT_REMOVE_MASK_GROW_MAX\)/, 'the growth scales with the shortest side')
  assert.match(source, /function effectDeeffectPromptText\(\) \{[\s\S]{0,700}?'Remove all the glowing light effects and sparkle particles from the image\.',/, 'the de-effect prompt mirrors the extraction prompt')
})

test('the keyed mask is white-on-transparent so the stroke helpers can read and grow it', () => {
  const source = read(RUNTIME)
  const block = source.slice(source.indexOf('function effectRemovalMaskCanvas('), source.indexOf('async function executeEffectRemoveTool('))
  assert.match(block, /image\.data\[i \+ 3\] = on \? 255 : 0/, 'transparent where there is no effect — an opaque black mask cannot be dilated by drawImage')
  assert.match(block, /image\.data\[i\] = 255\n\s+image\.data\[i \+ 1\] = 255\n\s+image\.data\[i \+ 2\] = 255/, 'white where the effect is, exactly like the brush paints')
  assert.match(block, /const on = \(effect\.data\[i \+ 3\] \|\| 0\) >= limit/, 'the effect alpha decides')
  assert.match(block, /const grown = expandedMaskCanvas\(seed, Math\.max\(0, Math\.round\(grow \|\| 0\)\), 0\)/, 'grown with no blur so the mask stays binary')
})
