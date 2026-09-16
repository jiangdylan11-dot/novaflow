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
  // The band around the silhouette IS the shadow room now, so it has to be wide enough to hold a contact
  // shadow: 0.02 gave 6px on a 223px object and the shadow had nowhere to go.
  assert.match(source, /const OBJECT_TRANSFER_NOISE_GROW_RATIO = 0\.055\n\s+const OBJECT_TRANSFER_NOISE_GROW_MIN = 8\n\s+const OBJECT_TRANSFER_NOISE_GROW_MAX = 32/, 'the band is wide enough for a contact shadow and no wider')
  assert.match(source, /const plateSize = qwenEditPlateSize\(size\.width, size\.height\)\n\s+const plateCanvas = qwenEditPlateCanvas\(placementGuideCanvas, plateSize\)/, 'the placement goes out on a plate Qwen does not reframe')
  assert.match(source, /const resultCanvas = await qwenEditPlateResultCanvas\(dataUrl, assets\.plateSize, assets\.plateContent, width, height, '万物迁移'\)/, 'the decode size is asserted before it is mapped back')
  // Rebuilding the object, its shadow and its light wrap from per-pixel rules after the fact is what made
  // the result look like a sticker. The model renders them as one thing, against the frozen pixels around
  // them, and that whole region is kept as one.
  // A blue silhouette turns the job into "fill this hole" and the model fills it by copying the
  // reference's own rendering. A rough composite makes it a repaint, which is what an edit model is for.
  assert.match(source, /const placementGuideCanvas = objectTransferCompGuideCanvas\(baseCanvas, transferSubjectCanvas\)/, 'the object is composited into the plate, not stamped as a blue shape')
  assert.doesNotMatch(source, /objectTransferBlueGuideCanvas/, 'the blue silhouette guide is gone')
  // A faint ground patch under the object used to mark where the contact shadow went. The model came back
  // with a glowing pool of light dead centre on it: it explains any patch it is handed.
  assert.doesNotMatch(source, /objectTransferContactMaskCanvas|objectTransferCombinedMaskCanvas|OBJECT_TRANSFER_CONTACT_HINT/, 'nothing but the object is pre-painted into the guide')
  assert.match(source, /const transferMaskCanvas = hardAlphaMask\n/, 'the mask is the silhouette; an extra oval of room came back as a puddle, then as a decal')
  assert.match(source, /guideMode: 'rough-comp-qwen-noise-latent'/, 'the debug record names the guide')
  assert.match(source, /'Image 1 already contains the new object, pasted in flat and unlit\.',/, 'the prompt asks for a repaint, in the concise English this model follows')
  assert.match(source, /const roomMaskCanvas = expandedMaskCanvas\(objectTransferGroundRoomCanvas\(paintableMaskCanvas\(transferMaskCanvas, 8, false\), groundDrop\), noiseGrow, 0\)/, 'the mask must be white-on-transparent or expandedMaskCanvas paints its own black over it')
  // A symmetric band around the silhouette left the shadow to chance: one seed in three came back with no
  // contact shadow at all. Dropping the room a few pixels made it three in three.
  assert.match(source, /const OBJECT_TRANSFER_GROUND_DROP_RATIO = 0\.015\n\s+const OBJECT_TRANSFER_GROUND_DROP_MIN = 2\n\s+const OBJECT_TRANSFER_GROUND_DROP_MAX = 10/, 'the room reaches a little below the object, where a shadow falls')
  assert.match(source, /const sceneSubjectMask = expandedMaskCanvas\(paintableMaskCanvas\(sceneSubjectCanvas, OBJECT_TRANSFER_SCENE_SUBJECT_ALPHA, true\), OBJECT_TRANSFER_SCENE_SUBJECT_GROW, 0\)/, 'the scene subject comes from the same RMBG the rest of the app uses')
  assert.match(source, /const protectionCanvas = maskSubtractCanvas\(sceneSubjectMask, objectMaskCanvas, 8\)/, 'the object may occlude the subject; nothing else may touch it')
  assert.match(source, /const noiseMaskCanvas = maskSubtractCanvas\(roomMaskCanvas, protectionCanvas, 8\)/, 'the protection is applied to the LATENT mask, before sampling')
  assert.match(source, /const pastedCanvas = compositeRemovalRgbResult\(baseCanvas, resultCanvas, assets\.noiseMaskCanvas, \{ x: 0, y: 0, width, height \}\)/, 'the masked region is pasted verbatim')
  assert.match(source, /pasteBack: 'latent-protected-verbatim-paste'/, 'the debug record names the path')
  assert.doesNotMatch(source, /objectTransferScenePixels|objectTransferNormalizeResultDataUrl|objectTransferPasteMaskCanvas|objectTransferCompositeCanvas|OBJECT_TRANSFER_SHADOW_MAX_DARKEN/, 'no rule-based shadow or silhouette compositing survives')

  // No post grade of any kind. A white balance was tried and an ambient fill after it; the fill lifted the
  // cast shadow inside the mask into a blue-purple smear, and a curve after the fact cannot do what the
  // model does during the render anyway. The style is fixed BEFORE the object is placed instead.
  assert.match(source, /const finalCanvas = pastedCanvas/, 'what the model rendered is the result')
  assert.doesNotMatch(source, /objectTransferHarmonizeCanvas|OBJECT_TRANSFER_HARMONIZE|ambientFill/, 'no colour grade, no ambient fill')

  // Stage 1: the reference object is repainted into the picture's style on its own, on flat grey, and
  // only then placed. Naming the style ("art style of image 2") produced a flat vector sticker; asking
  // for the artist's rendering language keeps the object and changes only how it is drawn.
  assert.match(source, /function objectTransferRestylePromptText\(\) \{[\s\S]{0,900}?'Redraw the object from image 1 as if the artist of image 2 had drawn it\.',/, 'stage 1 asks for a redraw, not a style name')
  // "same palette as image 2" recoloured the robot into the scene's pale marble; banning highlights
  // switched its glowing eyes off. Colour, proportion and lit parts are all pinned now.
  assert.match(source, /'Keep the object own colours, materials, markings and proportions exactly the same; do not recolour it and do not redesign it\.',/, 'stage 1 may repaint the object, not recolour or redesign it')
  assert.match(source, /'Every lit or glowing part of the object stays lit and glowing exactly as in image 1, same colour and same brightness\.',/, 'stage 1 keeps the object own lights on')
  assert.match(source, /const styled = await objectTransferStyledCutoutDataUrl\(baseUrl, info, resolved, tool\.referenceCutoutDataUrl, sceneCanvas, runId\)/, 'stage 1 runs before the placement is built')
  assert.match(source, /if \(!tool\.referenceStyledDataUrl \|\| tool\.referenceStyledKey !== styleKey\) \{/, 'the restyled object is cached per scene and reference')
  assert.match(source, /const cutoutCanvas = await canvasFromDataUrl\(tool\.referenceStyledDataUrl \|\| tool\.referenceCutoutDataUrl, tool\.referenceWidth, tool\.referenceHeight\)/, 'the placed object is the restyled one')
  assert.match(source, /function objectTransferPromptText\(\) \{[\s\S]{0,1400}?'Keep its position, size, pose, design and colours exactly as pasted\.',/, 'stage 2 no longer has to fix the style, only the light and the contact')
  // Both of these are live failures the wording had to fix: the model lit the marble like a spotlight,
  // and a shadow described as "matching image 1" came back as a black puddle while "barely visible" came
  // back as nothing at all.
  assert.match(source, /'It does not light the scene around it: no glow, halo, light pool, spotlight or bright patch on the ground or on nearby surfaces\. Lit parts of the object itself stay exactly as they are\.',/, 'the invented light source is banned, but only outside the object: banning it outright switched the robot eyes off')
  assert.match(source, /'Under its feet paint a soft light grey contact shadow on the ground[^']*never black and never hard edged[^']*',/, 'the contact shadow is described as light grey and soft, not as matching')
})
