const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { loadSpine } = require('../../tools/qwen-rapid-migration-smoke.cjs')

const root = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const RUNTIME = 'particle-editor/spine-split-runtime.js'
const CACHE_VERSION = '20260922-layer-seam-seal'
const plain = (value) => JSON.parse(JSON.stringify(value))

function loadRuntime() {
  const s = loadSpine(RUNTIME)
  s.state = { parts: [] }
  return s
}

// Minimal object_info shapes: buildComfyNodeInputs walks required/optional specs and fills defaults.
const combo = (options) => [options, {}]
const fakeInfo = (withLora) => ({
  FluxKontextImageScale: { input: { required: { image: ['IMAGE', {}] } } },
  UNETLoader: { input: { required: { unet_name: combo(['qwen_image_edit_2511_bf16.safetensors']), weight_dtype: combo(['default', 'fp8_e4m3fn']) } } },
  CLIPLoader: { input: { required: { clip_name: combo(['qwen_2.5_vl_7b_fp8_scaled.safetensors']), type: combo(['qwen_image']) }, optional: { device: combo(['default']) } } },
  VAELoader: { input: { required: { vae_name: combo(['qwen_image_vae.safetensors']) } } },
  VAEEncode: { input: { required: { pixels: ['IMAGE', {}], vae: ['VAE', {}] } } },
  TextEncodeQwenImageEditPlus: { input: { required: { clip: ['CLIP', {}], prompt: ['STRING', { default: '' }] }, optional: { vae: ['VAE', {}], image1: ['IMAGE', {}], image2: ['IMAGE', {}], image3: ['IMAGE', {}] } } },
  ConditioningZeroOut: { input: { required: { conditioning: ['CONDITIONING', {}] } } },
  KSampler: { input: { required: { model: ['MODEL', {}], seed: ['INT', { default: 0 }], steps: ['INT', { default: 20 }], cfg: ['FLOAT', { default: 8 }], sampler_name: combo(['euler']), scheduler: combo(['simple']), positive: ['CONDITIONING', {}], negative: ['CONDITIONING', {}], latent_image: ['LATENT', {}], denoise: ['FLOAT', { default: 1 }] } } },
  VAEDecode: { input: { required: { samples: ['LATENT', {}], vae: ['VAE', {}] } } },
  SaveImage: { input: { required: { images: ['IMAGE', {}], filename_prefix: ['STRING', { default: 'ComfyUI' }] } } },
  ModelSamplingAuraFlow: { input: { required: { model: ['MODEL', {}], shift: ['FLOAT', { default: 3 }] } } },
  CFGNorm: { input: { required: { model: ['MODEL', {}], strength: ['FLOAT', { default: 1 }] } } },
  ...(withLora ? { LoraLoaderModelOnly: { input: { required: { model: ['MODEL', {}], lora_name: combo(['Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors']), strength_model: ['FLOAT', { default: 1 }] } } } } : {})
})

test('the smart cutout toolbar leads with a default-off 特效 switch and routes 执行抠图 to the effect pipeline', () => {
  const html = read('particle-editor/index.html')
  assert.ok(html.includes(`spine-split-runtime.js?v=${CACHE_VERSION}`), 'index.html must load the effect-extract build of the split runtime')
  const source = read(RUNTIME)
  assert.match(source, /effectToolAvailable \? button\('\\u7279\\u6548', \(\) => toggleSelectionEffectMode\(\), effectModeEnabled, \{\n\s+\[TOOL_ACTION_ATTR\]: 'selectionEffect',\n\s+'data-novaflow-selection-effect': effectModeEnabled \? 'on' : 'off',\n\s+'data-novaflow-selection-effect-kind': effectRemovalTool \? 'remove' : 'extract',\n\s+role: 'switch',[\s\S]{0,900}?\}\) : null,\n\s+button\('\\u7ed8\\u5236', \(\) => setSelectionPaintMode\('draw'\)/, 'the 特效 switch sits before 绘制 on both tools that have it')
  assert.match(source, /const effectToolAvailable = isCutoutTool \|\| effectRemovalTool/, 'the switch renders for 智能抠图 and 去除物体')
  assert.match(source, /inpaintNsfwEnabled: false,\n\s+effectMode: false,\n\s+sourceTargetLocked: mode === 'cutout' && sourceTarget/, 'starting the tool resets the switch to off')
  assert.match(source, /inpaintNsfwEnabled: false,\n\s+effectMode: false\n\s+\}\n\s+selectionToolSession = null/, 'resetting the tool clears the switch')
  assert.match(source, /if \(action === 'selectionEffect'\) return toggleSelectionEffectMode\(\)/, 'the tool action dispatcher toggles the switch')
  assert.match(source, /return startSelectionTool\('cutout'\)\n\s+if \(state\.selectionTool\.effectMode\) return executeEffectExtractTool\(\)/, '执行抠图 runs the effect pipeline while the switch is on')
  assert.match(source, /cutout: isCutting \? '智能抠图中…' : \(isEffectExtracting \? '特效提取中…' : \(cutoutActive \? \(effectModeActive \? '执行特效提取' : '执行抠图'\) : '智能抠图'\)\)/, 'the left button relabels while the switch is on')
  assert.match(source, /const COMFY_BUSY_ACTIONS = new Set\(\['split', 'cutout', 'removeBackground', 'effectExtract'/, 'the extraction shows the ComfyUI busy overlay with elapsed time')
  assert.match(source, /effectExtract: '\\u6b63\\u5728\\u63d0\\u53d6\\u7279\\u6548\.\.\.'/, 'the busy overlay names the extraction')
  assert.match(source, /patchSplitToolButtonVisual\('selectionEffect', effectEnabled\)/, 'the in-place toolbar patch re-applies the switch state')
  assert.match(source, /if \(!bounds \|\| bounds\.count < 16\) bounds = null \/\/ 不涂抹 = 整图/, 'no mask means the whole image')
  assert.match(source, /const unmult = await api\.unmultBlackBackgroundDataUrl\(resultDataUrl\)\n\s+const effectCanvas = await qwenEditPlateResultCanvas\(unmult\.dataUrl, input\.plateSize, input\.plateContent, width, height, stageLabel\)/, 'the black-background render goes through the same pure unmult as the 工具 PNG 去黑, then maps back from the plate with a size assert')
  // FluxKontextImageScale center-crops one axis — measured 2026-09-17 with a grid probe: 29 columns off
  // each side of a 756x816 crop, and that crop has no inverse, so the key came back stretched 8.3%.
  assert.doesNotMatch(source.slice(source.indexOf('function buildEffectExtractQwenWorkflow('), source.indexOf('function effectExtractCropOptions(')), /class_type: 'FluxKontextImageScale'/, 'the extraction graph no longer rescales behind our back')
  assert.match(source, /const plateSize = qwenEditPlateSize\(cropBox\.width, cropBox\.height\)\n\s+const plateCanvas = qwenEditPlateCanvas\(inputCanvas, plateSize\)/, 'the crop is sent at a size whose reference rescale is a no-op')
  assert.doesNotMatch(source, /removeBlackBackgroundFromImageData\(generatedImage|refillEffectRgbFromSource/, 'no glow-expanding remover and no source refill: the model output shape is kept as-is')
  assert.match(source, /typeof api\.unmultBlackBackgroundDataUrl !== 'function'\) throw new Error\('去黑能力未加载/, 'the pipeline refuses to run without the unmult API')
  assert.match(source, /kind: 'effect-extract',\n\s+source: 'executeEffectExtractTool',\n\s+provider: result\.provider,\n\s+blend: 'additive',/, 'the layer is tagged as an additive effect')
  assert.match(source, /const layer = spineLayerRank\(\{ id: 'effect_front' \}\)/, 'the effect layer takes the effect_front rank')
  assert.match(source, /has\('__novaflow_effect_extract_smoke'\)/, 'the in-page smoke is wired to a query flag')
  assert.match(source, /setSelectionEffectMode,\n\s+toggleSelectionEffectMode,\n\s+executeEffectExtractTool,\n\s+runEffectExtractSmokeTest,/, 'the debug hooks expose the extraction')
})

test('the effect workflow is a single-image Qwen 2511 edit with a fixed seed and the black-background prompt', () => {
  const s = loadRuntime()
  const resolved = { unetName: 'qwen_image_edit_2511_bf16.safetensors', clipName: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', vaeName: 'qwen_image_vae.safetensors', loraName: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors' }
  const workflow = plain(s.buildEffectExtractQwenWorkflow(fakeInfo(true), 'effect_input.png', 'NovaFlow_effect_extract_x', resolved))
  const byType = (type) => Object.entries(workflow).filter(([, node]) => node.class_type === type)
  assert.equal(byType('LoadImage').length, 1, 'one input image only')
  assert.equal(workflow['1'].inputs.image, 'effect_input.png')
  assert.equal(byType('FluxKontextImageScale').length, 0, 'the rescale node is gone: it center-crops and cannot be inverted')
  const [textId, text] = byType('TextEncodeQwenImageEditPlus')[0]
  assert.deepEqual(text.inputs.image1, ['1', 0], 'the plate goes to the model as uploaded')
  assert.equal(text.inputs.image2, undefined, 'no reference image')
  assert.equal(text.inputs.prompt, s.effectExtractPromptText())
  assert.match(text.inputs.prompt, /pure black \(#000000\)/)
  assert.match(text.inputs.prompt, /Keep only the glowing light effects and sparkle particles that are already in the image/)
  assert.match(text.inputs.prompt, /Do not add new effects, do not move or redraw them\./)
  assert.doesNotMatch(text.inputs.prompt, /fire|lightning|magic|smoke/i, 'naming effect kinds makes the model paint them')
  const [, zero] = byType('ConditioningZeroOut')[0]
  assert.deepEqual(zero.inputs.conditioning, [textId, 0])
  const [, sampler] = byType('KSampler')[0]
  assert.equal(sampler.inputs.seed, 916202601)
  assert.equal(sampler.inputs.steps, 6)
  assert.equal(sampler.inputs.cfg, 1)
  assert.equal(sampler.inputs.denoise, 1)
  const [loraId, lora] = byType('LoraLoaderModelOnly')[0]
  assert.deepEqual(lora.inputs.model, ['4', 0])
  assert.equal(lora.inputs.lora_name, resolved.loraName)
  const [auraId, aura] = byType('ModelSamplingAuraFlow')[0]
  assert.deepEqual(aura.inputs.model, [loraId, 0])
  const [cfgId, cfg] = byType('CFGNorm')[0]
  assert.deepEqual(cfg.inputs.model, [auraId, 0])
  assert.deepEqual(sampler.inputs.model, [cfgId, 0])
  const [, save] = byType('SaveImage')[0]
  assert.equal(save.inputs.filename_prefix, 'NovaFlow_effect_extract_x')

  const plainRun = plain(s.buildEffectExtractQwenWorkflow(fakeInfo(false), 'in.png', 'p', { ...resolved, loraName: '' }))
  assert.equal(Object.values(plainRun).some((node) => node.class_type === 'LoraLoaderModelOnly'), false)
  assert.equal(Object.values(plainRun).find((node) => node.class_type === 'KSampler').inputs.steps, 30)
})

test('the alpha floor only drops VAE noise below 3/255 and leaves every visible pixel untouched', () => {
  const s = loadRuntime()
  // px0: already transparent; px1: 2/255 noise → cleared; px2: exactly the floor → kept; px3: bright → kept verbatim
  const effect = new Uint8ClampedArray([
    9, 9, 9, 0,
    40, 30, 20, 2,
    40, 30, 20, 3,
    250, 200, 100, 128
  ])
  const stats = plain(s.floorEffectAlpha(effect, 3))
  assert.deepEqual(stats, { visible: 2, floored: 1 })
  assert.deepEqual(Array.from(effect), [9, 9, 9, 0, 0, 0, 0, 0, 40, 30, 20, 3, 250, 200, 100, 128])
  assert.deepEqual(plain(s.floorEffectAlpha(null, 3)), { visible: 0, floored: 0 })
})

test('the soft mask only attenuates alpha and clears fully gated RGB', () => {
  const s = loadRuntime()
  const effect = new Uint8ClampedArray([
    200, 100, 50, 255,
    200, 100, 50, 200,
    200, 100, 50, 100,
    200, 100, 50, 0
  ])
  const mask = new Uint8ClampedArray([
    255, 255, 255, 255,
    128, 128, 128, 255,
    0, 0, 0, 255,
    255, 255, 255, 255
  ])
  const stats = plain(s.gateEffectAlphaBySoftMask(effect, mask))
  assert.deepEqual(stats, { visible: 2, gated: 2 })
  assert.deepEqual(Array.from(effect), [200, 100, 50, 255, 200, 100, 50, 100, 0, 0, 0, 0, 200, 100, 50, 0])
  assert.deepEqual(plain(s.gateEffectAlphaBySoftMask(effect, null)), { visible: 0, gated: 0 })
})

// The primary rail entries are 特效/动画/美工/工具 and the cutout toolbar's 特效 switch shares the first
// name. The brand runtime resolves a section switch from a button's text, so without a scope guard a
// click on the switch repainted the rail and tore the split workspace down (2026-09-16).
test('the brand runtime never reads a split-editor toolbar button as a primary section entry', () => {
  const brand = read('particle-editor/novaflow-brand-runtime.js')
  assert.match(brand, /const SPINE_SPLIT_SURFACE_SELECTOR = \[\n\s+"#novaflow-spine-split-workspace-overlay",\n\s+"#novaflow-spine-split-right-workspace-host",\n\s+"\[data-novaflow-spine-split-tool-action\]",\n\s+"\[data-novaflow-spine-split-control-action\]"\n\s+\]\.join\(", "\);/, 'the split editor surfaces are listed in one selector')
  assert.match(brand, /function isPrimaryEntryIntentButton\(button\) \{[\s\S]{0,700}?if \(isSpineSplitSurfaceElement\(button\)\) return false;/, 'a split editor surface is never a primary entry')
  assert.match(brand, /function getPrimaryLabelForButton\(button\) \{\n\s+if \(!\(button instanceof HTMLElement\)\) return null;\n\s+const label = buttonTextCandidates\(button\)\.map\(resolvePrimaryEntryLabel\)\.find\(Boolean\) \|\| null;\n\s+if \(!label\) return null;\n\s+return isPrimaryEntryIntentButton\(button\) \? label : null;\n\s+\}/, 'a matching label only counts when the button really is a rail entry')
  assert.match(brand, /if \(!isSpineSplitSurfaceElement\(button\) && \(buttonLabel\.includes\("\\u7279\\u6548"\) \|\| buttonLabel\.includes\("\\u52a8\\u753b"\)\)\) \{/, 'the segment refresh ignores the split toolbars too')
})
