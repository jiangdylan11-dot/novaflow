const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadSpine } = require('../../tools/qwen-rapid-migration-smoke.cjs')

const root = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const RUNTIME = 'particle-editor/spine-split-runtime.js'
const plain = (value) => JSON.parse(JSON.stringify(value))

const combo = (options) => [options, {}]
const fakeInfo = () => ({
  UNETLoader: { input: { required: { unet_name: combo(['qwen_image_edit_2511_bf16.safetensors']), weight_dtype: combo(['default', 'fp8_e4m3fn']) } } },
  CLIPLoader: { input: { required: { clip_name: combo(['qwen_2.5_vl_7b_fp8_scaled.safetensors']), type: combo(['qwen_image']) }, optional: { device: combo(['default']) } } },
  VAELoader: { input: { required: { vae_name: combo(['qwen_image_vae.safetensors']) } } },
  VAEEncode: { input: { required: { pixels: ['IMAGE', {}], vae: ['VAE', {}] } } },
  TextEncodeQwenImageEditPlus: { input: { required: { clip: ['CLIP', {}], prompt: ['STRING', { default: '' }] }, optional: { vae: ['VAE', {}], image1: ['IMAGE', {}], image2: ['IMAGE', {}] } } },
  KSampler: { input: { required: { model: ['MODEL', {}], seed: ['INT', { default: 0 }], steps: ['INT', { default: 20 }], cfg: ['FLOAT', { default: 8 }], sampler_name: combo(['euler']), scheduler: combo(['simple']), positive: ['CONDITIONING', {}], negative: ['CONDITIONING', {}], latent_image: ['LATENT', {}], denoise: ['FLOAT', { default: 1 }] } } },
  VAEDecode: { input: { required: { samples: ['LATENT', {}], vae: ['VAE', {}] } } },
  SaveImage: { input: { required: { images: ['IMAGE', {}], filename_prefix: ['STRING', { default: 'ComfyUI' }] } } },
  ModelSamplingAuraFlow: { input: { required: { model: ['MODEL', {}], shift: ['FLOAT', { default: 3 }] } } },
  CFGNorm: { input: { required: { model: ['MODEL', {}], strength: ['FLOAT', { default: 1 }] } } },
  LoraLoaderModelOnly: { input: { required: { model: ['MODEL', {}], lora_name: combo(['Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors']), strength_model: ['FLOAT', { default: 1 }] } } },
  FluxKontextImageScale: { input: { required: { image: ['IMAGE', {}] } } }
})

// 万物迁移 used to send the placement through FluxKontextImageScale and sample the whole frame, so the
// model re-rendered the entire picture and the app pasted a patch of a DIFFERENT picture back: wrong
// style, wrong colour, wrong shadow and a visible block at the join (the user's 2026-09-17 report).
// Measured on that scene: 20.3/255 outside the placement with the stair edges 5px off; with the latent
// noise mask, 1.22/255 and 0px.
test('the transfer graph sends an unscaled plate and only denoises the placement region', () => {
  const s = loadSpine(RUNTIME)
  const resolved = { unetName: 'qwen_image_edit_2511_bf16.safetensors', clipName: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', vaeName: 'qwen_image_vae.safetensors', loraName: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors' }
  const workflow = plain(s.buildObjectTransferQwenWorkflow(fakeInfo(), { placementName: 'plate.png', referenceName: 'ref.png', maskName: 'mask.png' }, 'NovaFlow_object_transfer_x', resolved))
  const byType = (type) => Object.entries(workflow).filter(([, node]) => node.class_type === type)

  assert.equal(byType('FluxKontextImageScale').length, 0, 'the rescale node center-crops one axis and cannot be inverted')
  assert.equal(workflow['1'].inputs.image, 'plate.png')
  assert.equal(workflow['2'].inputs.image, 'ref.png')
  assert.equal(workflow['3'].inputs.image, 'mask.png', 'the placement mask is loaded as an image')

  const [, encode] = byType('VAEEncode')[0]
  assert.deepEqual(encode.inputs.pixels, ['1', 0], 'the plate is encoded at its own resolution')
  const [maskId, toMask] = byType('ImageToMask')[0]
  assert.deepEqual(toMask.inputs.image, ['3', 0])
  assert.equal(toMask.inputs.channel, 'red')
  const [noiseId, noiseMask] = byType('SetLatentNoiseMask')[0]
  assert.deepEqual(noiseMask.inputs.mask, [maskId, 0])
  const [, sampler] = byType('KSampler')[0]
  assert.deepEqual(sampler.inputs.latent_image, [noiseId, 0], 'the sampler runs on the masked latent')
  assert.equal(sampler.inputs.denoise, 1)

  const [, text] = byType('TextEncodeQwenImageEditPlus')[0]
  assert.deepEqual(text.inputs.image1, ['1', 0], 'the scene reference is the plate, not a rescale of it')
  assert.deepEqual(text.inputs.image2, ['2', 0], 'the object reference stays image2')
})

test('the scene subject is protected in the latent and the model region is pasted verbatim', () => {
  const source = read(RUNTIME)
  assert.match(source, /const OBJECT_TRANSFER_NOISE_GROW_RATIO = 0\.02\n\s+const OBJECT_TRANSFER_NOISE_GROW_MIN = 6\n\s+const OBJECT_TRANSFER_NOISE_GROW_MAX = 24/, 'the growth stays close to the placement guide')
  assert.match(source, /const plateSize = qwenEditPlateSize\(size\.width, size\.height\)\n\s+const plateCanvas = qwenEditPlateCanvas\(placementGuideCanvas, plateSize\)/, 'the placement goes out on a plate Qwen does not reframe')
  assert.match(source, /const resultCanvas = await qwenEditPlateResultCanvas\(dataUrl, assets\.plateSize, assets\.plateContent, width, height, '万物迁移'\)/, 'the decode size is asserted before it is mapped back')
  // Rebuilding the object, its shadow and its light wrap from per-pixel rules after the fact is what made
  // the result look like a sticker. The model renders them as one thing, against the frozen pixels around
  // them, and that whole region is kept as one.
  // A blue silhouette turns the job into "fill this hole" and the model fills it by copying the
  // reference's own rendering. A rough composite makes it a repaint, which is what an edit model is for.
  assert.match(source, /const placementGuideCanvas = objectTransferCompGuideCanvas\(baseCanvas, transferSubjectCanvas, contactMaskCanvas\)/, 'the object is composited into the plate, not stamped as a blue shape')
  assert.doesNotMatch(source, /objectTransferBlueGuideCanvas/, 'the blue silhouette guide is gone')
  assert.match(source, /guideMode: 'rough-comp-qwen-noise-latent'/, 'the debug record names the guide')
  assert.match(source, /'Image 1 already contains the new object, pasted in flat and unlit\.',/, 'the prompt asks for a repaint, in the concise English this model follows')
  assert.match(source, /const roomMaskCanvas = expandedMaskCanvas\(paintableMaskCanvas\(transferMaskCanvas, 8, false\), noiseGrow, 0\)/, 'the mask must be white-on-transparent or expandedMaskCanvas paints its own black over it')
  assert.match(source, /const sceneSubjectMask = expandedMaskCanvas\(paintableMaskCanvas\(sceneSubjectCanvas, OBJECT_TRANSFER_SCENE_SUBJECT_ALPHA, true\), OBJECT_TRANSFER_SCENE_SUBJECT_GROW, 0\)/, 'the scene subject comes from the same RMBG the rest of the app uses')
  assert.match(source, /const protectionCanvas = maskSubtractCanvas\(sceneSubjectMask, objectMaskCanvas, 8\)/, 'the object may occlude the subject; nothing else may touch it')
  assert.match(source, /const noiseMaskCanvas = maskSubtractCanvas\(roomMaskCanvas, protectionCanvas, 8\)/, 'the protection is applied to the LATENT mask, before sampling')
  assert.match(source, /const pastedCanvas = compositeRemovalRgbResult\(baseCanvas, resultCanvas, assets\.noiseMaskCanvas, \{ x: 0, y: 0, width, height \}\)/, 'the masked region is pasted verbatim')
  assert.match(source, /pasteBack: 'latent-protected-verbatim-paste'/, 'the debug record names the path')
  assert.doesNotMatch(source, /objectTransferScenePixels|objectTransferNormalizeResultDataUrl|objectTransferPasteMaskCanvas|objectTransferCompositeCanvas|OBJECT_TRANSFER_SHADOW_MAX_DARKEN/, 'no rule-based shadow or silhouette compositing survives')

  // The model lights the object with its own lamp: on the user's dusk scene the robot came back at
  // highlight R/B 1.25 against the marble's 1.08. The grade matches the light, not the object's paint.
  assert.match(source, /const finalCanvas = objectTransferHarmonizeCanvas\(pastedCanvas, baseCanvas, assets\.noiseMaskCanvas, OBJECT_TRANSFER_HARMONIZE_STRENGTH\)/, 'the whole pasted region is graded together, so object and shadow stay consistent')
  const harmonizeBlock = source.slice(source.indexOf('function objectTransferHarmonizeCanvas('), source.indexOf('async function objectTransferProtectedResultDataUrl('))
  assert.match(harmonizeBlock, /const gainLuma = rawGain\[0\] \* 0\.2126 \+ rawGain\[1\] \* 0\.7152 \+ rawGain\[2\] \* 0\.0722/, 'the grade is luminance neutral: it shifts colour, not brightness')
  assert.match(harmonizeBlock, /const weight = amount \* Math\.sqrt\(clampNumber\(luminance\(image\.data, i\) \/ 255, 0, 1\)\)/, 'lit pixels take more of the shift than pixels in shadow')
  // An ambient fill that lifted the object's black point was tried and removed: it also lifted the cast
  // shadow inside the mask and, with the blue gain on top, turned it into a washed blue-purple smear.
  assert.doesNotMatch(source, /OBJECT_TRANSFER_AMBIENT_FILL|ambientFill/, 'the object keeps its own contrast; only the colour of the light is matched')
  assert.match(source, /const OBJECT_TRANSFER_HARMONIZE_STRENGTH = 0\.7\n\s+const OBJECT_TRANSFER_HARMONIZE_GAIN_MIN = 0\.85\n\s+const OBJECT_TRANSFER_HARMONIZE_GAIN_MAX = 1\.2/, 'the grade is partial and clamped, so the object keeps its identity colours')
})
