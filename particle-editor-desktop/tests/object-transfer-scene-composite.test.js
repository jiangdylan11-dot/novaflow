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

test('the picture is generated in one pass and nothing is composited afterwards', () => {
  const source = read(RUNTIME)
  // A mask made by dilating the silhouette can only contain shapes that are a function of the distance
  // to it — an aura. A cast shadow is the silhouette projected onto the ground and is not a subset of any
  // dilation, which is why every band, ellipse and drop attempt came back stamped-on. The region is an
  // apron whose shape has nothing to do with the silhouette, and it is much larger than any shadow so the
  // shadow's falloff ends inside it instead of being cut off at its edge.
  assert.match(source, /const OBJECT_TRANSFER_REGION_PAD_X = 0\.4\n\s+const OBJECT_TRANSFER_REGION_PAD_UP = 0\.08\n\s+const OBJECT_TRANSFER_REGION_PAD_DOWN = 0\.3/, 'the region reaches much further down than up, where a shadow lands')
  // A latent noise mask is a per-pixel denoise strength, not a stencil (KSamplerX0Inpaint blends the
  // prediction with the frozen latent by the mask VALUE at every step). Measured live at this placement:
  // 110 -> no shadow, 170 -> a soft shadow lying on the steps, 210 -> heavy, binary 255 -> the model
  // rebuilt the floor and painted a black silhouette.
  assert.match(source, /const OBJECT_TRANSFER_REGION_STRENGTH = 170/, 'the region is partly denoised, which is what anchors the ground and sets the shadow density')
  // Non-zero everywhere, so the frame really is sampled as one picture rather than a hole being filled.
  // Measured: a floor of 40 moved the far edges no more than a floor of 0 (3.4 vs 3.2 / 255).
  assert.match(source, /const OBJECT_TRANSFER_FRAME_FLOOR = 24/, 'the whole frame is sampled, at a strength low enough to keep its detail')
  // At full strength the sampler rebuilds the object from noise and its value drifts: it came back darker
  // than the picture and the model painted a warm halo around it to explain the dark silhouette.
  assert.match(source, /const OBJECT_TRANSFER_OBJECT_STRENGTH = 205/, 'the placed object keeps pulling its own colours back while its shading is repainted')
  assert.doesNotMatch(source, /OBJECT_TRANSFER_NOISE_GROW|OBJECT_TRANSFER_GROUND_DROP|objectTransferGroundRoomCanvas/, 'the silhouette band and its downward drop are gone')
  assert.match(source, /const plateSize = qwenEditPlateSize\(size\.width, size\.height\)\n\s+const plateCanvas = qwenEditPlateCanvas\(placementGuideCanvas, plateSize\)/, 'the placement goes out on a plate Qwen does not reframe')
  assert.match(source, /const finalCanvas = await qwenEditPlateResultCanvas\(dataUrl, assets\.plateSize, assets\.plateContent, width, height, '[^']+'\)/, 'the decode size is asserted before it is mapped back')
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
  assert.match(source, /const transferMaskCanvas = hardAlphaMask\n/, 'nothing but the object is pre-painted into the guide')
  assert.match(source, /guideMode: 'single-pass-graded-frame-latent'/, 'the debug record names the pass')
  assert.match(source, /'Image 1 already contains the new object, pasted in flat and unlit\.',/, 'the prompt asks for a repaint, in the concise English this model follows')
  assert.match(source, /const roomMaskCanvas = maskMaxCanvas\(maskMaxCanvas\(regionMaskCanvas, objectBandCanvas\), frameFloorCanvas\)/, 'object, ground and the rest of the frame each get their own denoise strength')
  assert.match(source, /const objectBandCanvas = maskScaleCanvas\(featherMaskCanvas\([\s\S]{0,260}?OBJECT_TRANSFER_OBJECT_STRENGTH \/ 255\)/, 'the object band carries the object strength')
  // The mask is point-sampled down to the latent grid (bilinear, ~7.3 scene px per cell), so a ramp only
  // survives as a ramp if it is tens of pixels wide.
  assert.match(source, /const OBJECT_TRANSFER_REGION_FEATHER_RATIO = 0\.09\n\s+const OBJECT_TRANSFER_REGION_FEATHER_MIN = 24/, 'the region edge is a wide ramp, not a cliff')
  assert.match(source, /const sceneSubjectMask = expandedMaskCanvas\(paintableMaskCanvas\(sceneSubjectCanvas, OBJECT_TRANSFER_SCENE_SUBJECT_ALPHA, true\), OBJECT_TRANSFER_SCENE_SUBJECT_GROW, 0\)/, 'the scene subject comes from the same RMBG the rest of the app uses')
  assert.match(source, /const protectionCanvas = maskSubtractCanvas\(sceneSubjectMask, objectMaskCanvas, 8\)/, 'the object may occlude the subject; nothing else may touch it')
  assert.match(source, /const noiseMaskCanvas = maskAttenuateCanvas\(roomMaskCanvas, featherMaskCanvas\(thresholdMaskCanvas\(protectionCanvas, 8\), OBJECT_TRANSFER_PROTECTION_FEATHER\)\)/, 'the protection fades the region out instead of punching a cliff in it')
  // The mask the sampler gets keeps its grading; re-binarising it here was what turned the ramp back into
  // a cliff. The paste, by contrast, takes everything the sampler could move at all — grading it a second
  // time would fade out the shadow's tail, the part that makes it read as cast rather than stuck on.
  assert.match(source, /const noiseMaskPlateCanvas = qwenEditPlateCanvas\(noiseMaskCanvas, plateSize\)/, 'the sampler gets the graded mask, not a re-binarised one')
  // THE POINT OF THIS TEST. The user rejected every version that stitched a region back over the
  // original: "不要2次加工，应该是生成之前就约束好。直接生成成品才对。你现在做的全是乱贴". The model is
  // handed the whole frame plus a per-pixel denoise strength decided before the pass, and the frame it
  // decodes IS the result — so the object's shading, its cast shadow and the picture's own light over it
  // are the same brush strokes as the rest of the painting.
  const resultFn = source.slice(source.indexOf('async function objectTransferDecodedResultDataUrl('))
  const resultBody = resultFn.slice(0, resultFn.indexOf('\n  }\n'))
  assert.match(resultBody, /const finalCanvas = await qwenEditPlateResultCanvas\(dataUrl, assets\.plateSize, assets\.plateContent, width, height, '[^']+'\)/, 'the decoded frame is the result')
  assert.doesNotMatch(resultBody, /compositeRemovalRgbResult|pasteBackEngine|featherMaskCanvas|drawImage/, 'nothing is composited, feathered or drawn over the decode')
  assert.match(source, /pasteBack: 'none-single-pass-decode'/, 'the debug record names the path')
  assert.doesNotMatch(source, /objectTransferProtectedResultDataUrl/, 'the paste-back path is gone')
  assert.doesNotMatch(source, /objectTransferScenePixels|objectTransferNormalizeResultDataUrl|objectTransferPasteMaskCanvas|objectTransferCompositeCanvas|OBJECT_TRANSFER_SHADOW_MAX_DARKEN/, 'no rule-based shadow or silhouette compositing survives')

  // No post grade of any kind. A white balance was tried and an ambient fill after it; the fill lifted the
  // cast shadow inside the mask into a blue-purple smear, and a curve after the fact cannot do what the
  // model does during the render anyway. The style is fixed BEFORE the object is placed instead.
  assert.doesNotMatch(source, /const finalCanvas = pastedCanvas/, 'there is no pasted canvas any more')
  assert.match(source, /function qwenEditPlateCanvas\([\s\S]{0,600}?ctx\.imageSmoothingQuality = 'high'/, 'the plate is scaled at high quality or the region comes back softer than the picture around it')
  assert.match(source, /async function qwenEditPlateResultCanvas\([\s\S]{0,1200}?ctx\.imageSmoothingQuality = 'high'/, 'and scaled back the same way')
  assert.doesNotMatch(source, /objectTransferHarmonizeCanvas|OBJECT_TRANSFER_HARMONIZE|ambientFill/, 'no colour grade, no ambient fill')

  // Stage 1: the reference object is repainted into the picture's style on its own, on flat grey, and
  // only then placed. Naming the style ("art style of image 2") produced a flat vector sticker; asking
  // for the artist's rendering language keeps the object and changes only how it is drawn.
  assert.match(source, /function objectTransferRestylePromptText\(\) \{[\s\S]{0,900}?'Redraw the object from image 1 as if the artist of image 2 had drawn it\.',/, 'stage 1 asks for a redraw, not a style name')
  // "same palette as image 2" recoloured the robot into the scene's pale marble; banning highlights
  // switched its glowing eyes off. Colour, proportion and lit parts are all pinned now.
  assert.match(source, /'Keep the object own colours, materials, markings and proportions exactly the same; do not recolour it and do not redesign it\.',/, 'stage 1 may repaint the object, not recolour or redesign it')
  // Saying only "lit parts stay lit" switched the eyes to blazing AND invented a glowing lamp on the
  // robot's chest that the reference never had, which is what made stage 2 light the marble like a
  // spotlight. Lit parts are pinned in both directions now.
  assert.match(source, /'Copy image 1 exactly on which parts are lit: the parts that glow in image 1 keep glowing in the same colour and no brighter, with no extra bloom around them, and every part that is not lit in image 1 stays unlit\. Do not add any new lamp, light or glowing panel anywhere on it\.',/, 'stage 1 keeps the object own lights on, and adds none')
  assert.match(source, /const styled = await objectTransferStyledCutoutDataUrl\(baseUrl, info, resolved, tool\.referenceCutoutDataUrl, sceneCanvas, runId\)/, 'stage 1 runs before the placement is built')
  assert.match(source, /if \(!tool\.referenceStyledDataUrl \|\| tool\.referenceStyledKey !== styleKey\) \{/, 'the restyled object is cached per scene and reference')
  assert.match(source, /const cutoutCanvas = await canvasFromDataUrl\(tool\.referenceStyledDataUrl \|\| tool\.referenceCutoutDataUrl, tool\.referenceWidth, tool\.referenceHeight\)/, 'the placed object is the restyled one')
  assert.match(source, /function objectTransferPromptText\(\) \{[\s\S]{0,1400}?'Keep its position, size, pose, design and colours exactly as pasted\.',/, 'stage 2 no longer has to fix the style, only the light and the contact')
  // Banning the glow by name painted a warm spotlight on the marble in six runs out of six, across three
  // wordings and two placements; dropping the word entirely removed it in both seeds on the same plate.
  // Negating a concept raises it for this model — the same lesson as naming the effect in 特效去除.
  const stage2Body = source.slice(source.indexOf('return [', source.indexOf('function objectTransferPromptText()')))
  const stage2Prompt = stage2Body.slice(0, stage2Body.indexOf("].join(' ')"))
  assert.doesNotMatch(stage2Prompt, /glow|halo|light pool|spotlight|bloom|bright patch/, 'stage 2 never says glow: saying it is what summons the spotlight')
  // With a region of ground to work in, the shadow is described by what it physically does instead of
  // what it should look like; its density is set by the region's denoise strength.
  assert.match(source, /'It stands on the surface below it and casts its shadow across that surface: the shadow lies flat on the ground, bends over any edges it crosses, falls away from the key[^']*',/, 'the shadow is asked for as a cast shadow on the surface')
  // "这个光影效果也没重绘": the picture's own effects have to be repainted across the object too.
  assert.match(source, /'Whatever sparkles, motes and streaks image 1 already has near the object carry across it and in front of it, wrapping around its silhouette, exactly in image 1 own style\.',/, 'the picture own effects carry across the object')
})
