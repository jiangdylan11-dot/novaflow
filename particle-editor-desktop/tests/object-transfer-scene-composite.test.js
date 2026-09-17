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

// 万物迁移 repaints the WHOLE picture in one pass with the object composited into it, and the frame the
// model decodes is the result. Everything else was tried and rejected by the user, in this order:
// a region pasted back over the original ("有明显的衔接方块"), a silhouette-shaped latent mask so only the
// object's surroundings changed ("这投影完全就是后期加的...这根本不是融合"), a graded whole-frame mask that
// still left the object's neighbourhood as the only repainted part ("你现在做的全是乱贴"), and a cast
// shadow computed in JS and multiplied into the guide ("这投影明显是你后加进去的").
// What survived is the earliest thing that was tried: no mask at all, one uniform denoise strength, so
// no part of the picture is more re-rendered than any other and nothing reads as a patch.
test('the transfer graph repaints the whole frame: no mask, no rescale, one denoise', () => {
  const s = loadSpine(RUNTIME)
  const resolved = { unetName: 'qwen_image_edit_2511_bf16.safetensors', clipName: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', vaeName: 'qwen_image_vae.safetensors', loraName: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors' }
  const workflow = plain(s.buildObjectTransferQwenWorkflow(fakeInfo(), { placementName: 'plate.png', referenceName: 'ref.png' }, 'NovaFlow_object_transfer_x', resolved))
  const byType = (type) => Object.entries(workflow).filter(([, node]) => node.class_type === type)

  // FluxKontextImageScale picks a preset by aspect and centre-crops one axis; there is no inverse, so the
  // object came back stretched and offset. Measured on a grid probe: output_x = (input_x - 28.9) * 1.3524.
  assert.equal(byType('FluxKontextImageScale').length, 0, 'the rescale node center-crops one axis and cannot be inverted')
  assert.equal(byType('SetLatentNoiseMask').length, 0, 'no mask: any mask makes part of the picture the repainted part')
  assert.equal(byType('ImageToMask').length, 0, 'and nothing loads one')
  assert.equal(workflow['1'].inputs.image, 'plate.png')
  assert.equal(workflow['2'].inputs.image, 'ref.png')

  const [encodeId, encode] = byType('VAEEncode')[0]
  assert.deepEqual(encode.inputs.pixels, ['1', 0], 'the plate is encoded at its own resolution')
  const [, sampler] = byType('KSampler')[0]
  assert.deepEqual(sampler.inputs.latent_image, [encodeId, 0], 'the sampler runs straight on the encoded plate')
  assert.equal(sampler.inputs.denoise, 0.7, 'one uniform strength for the whole frame')

  const [, text] = byType('TextEncodeQwenImageEditPlus')[0]
  assert.deepEqual(text.inputs.image1, ['1', 0], 'the scene reference is the plate, not a rescale of it')
  assert.deepEqual(text.inputs.image2, ['2', 0], 'the object reference stays image2')
})

test('the picture is generated in one pass and nothing is composited afterwards', () => {
  const source = read(RUNTIME)
  // 1.0 rebuilt the sky, the floor and her dress (drift 87/255); 0.85 held the picture and fused the
  // object (20.4); 0.70 is the closest to the original that still repaints the object into it (17.2).
  assert.match(source, /const OBJECT_TRANSFER_DENOISE = 0\.7/, 'the denoise strength is the whole constraint')
  assert.doesNotMatch(source, /OBJECT_TRANSFER_REGION_|OBJECT_TRANSFER_FRAME_FLOOR|OBJECT_TRANSFER_OBJECT_STRENGTH|OBJECT_TRANSFER_NOISE_GROW|OBJECT_TRANSFER_GROUND_DROP/, 'every per-region strength is gone')
  assert.doesNotMatch(source, /objectTransferRegionMaskCanvas|objectTransferGroundRoomCanvas|objectTransferCastShadowCanvas|objectTransferContactMaskCanvas/, 'and so is the machinery that built them')
  // The plate is sized to a fixed point of Qwen's own ~1MP reference rescale, so the model does not
  // reframe it: matched plate -> edge correlation 0.976/0.981 at 0px, against 0.38 at 4px.
  assert.match(source, /const plateSize = qwenEditPlateSize\(size\.width, size\.height\)\n\s+const plateCanvas = qwenEditPlateCanvas\(placementGuideCanvas, plateSize\)/, 'the placement goes out on a plate Qwen does not reframe')
  assert.match(source, /function qwenEditPlateCanvas\([\s\S]{0,600}?ctx\.imageSmoothingQuality = 'high'/, 'the plate is scaled at high quality')
  assert.match(source, /async function qwenEditPlateResultCanvas\([\s\S]{0,1200}?ctx\.imageSmoothingQuality = 'high'/, 'and scaled back the same way')
  // A blue silhouette turns the job into "fill this hole" and the model fills it by copying the
  // reference's own rendering. A rough composite makes it a repaint, which is what an edit model is for.
  assert.match(source, /const placementGuideCanvas = objectTransferCompGuideCanvas\(baseCanvas, transferSubjectCanvas\)/, 'the object is composited into the picture, not stamped as a blue shape')
  assert.doesNotMatch(source, /objectTransferBlueGuideCanvas/, 'the blue silhouette guide is gone')
  assert.match(source, /guideMode: 'single-pass-whole-frame-repaint'/, 'the debug record names the pass')

  // THE POINT OF THIS TEST. "不要2次加工，应该是生成之前就约束好。直接生成成品才对。你现在做的全是乱贴"
  // — the frame the model decodes IS the result; objectTransferDecodedResultDataUrl does nothing but undo
  // the plate scaling.
  const resultFn = source.slice(source.indexOf('async function objectTransferDecodedResultDataUrl('))
  const resultBody = resultFn.slice(0, resultFn.indexOf('\n  }\n'))
  assert.match(resultBody, /const finalCanvas = await qwenEditPlateResultCanvas\(dataUrl, assets\.plateSize, assets\.plateContent, width, height, '[^']+'\)/, 'the decoded frame is the result')
  assert.doesNotMatch(resultBody, /compositeRemovalRgbResult|pasteBackEngine|featherMaskCanvas|drawImage/, 'nothing is composited, feathered or drawn over the decode')
  assert.match(source, /pasteBack: 'none-single-pass-decode'/, 'the debug record names the path')
  assert.doesNotMatch(source, /objectTransferProtectedResultDataUrl/, 'the paste-back path is gone')
  assert.doesNotMatch(source, /objectTransferHarmonizeCanvas|OBJECT_TRANSFER_HARMONIZE|ambientFill|objectTransferScenePixels|objectTransferNormalizeResultDataUrl/, 'no colour grade, no ambient fill, no rule-based compositing')

  // Stage 1: the reference object is repainted into the picture's style on its own, on flat grey, and
  // only then placed. Naming the style ("art style of image 2") produced a flat vector sticker; asking
  // for the artist's rendering language keeps the object and changes only how it is drawn.
  assert.match(source, /function objectTransferRestylePromptText\(\) \{[\s\S]{0,900}?'Redraw the object from image 1 as if the artist of image 2 had drawn it\.',/, 'stage 1 asks for a redraw, not a style name')
  // "same palette as image 2" recoloured the robot into the scene's pale marble; saying only "lit parts
  // stay lit" switched the eyes to blazing AND invented a glowing lamp on its chest, which then made the
  // second pass light the marble like a spotlight. Colour, proportion and lit parts are all pinned.
  assert.match(source, /'Keep the object own colours, materials, markings and proportions exactly the same; do not recolour it and do not redesign it\.',/, 'stage 1 may repaint the object, not recolour or redesign it')
  assert.match(source, /'Copy image 1 exactly on which parts are lit: the parts that glow in image 1 keep glowing in the same colour and no brighter, with no extra bloom around them, and every part that is not lit in image 1 stays unlit\. Do not add any new lamp, light or glowing panel anywhere on it\.',/, 'stage 1 keeps the object own lights on, and adds none')
  assert.match(source, /const styled = await objectTransferStyledCutoutDataUrl\(baseUrl, info, resolved, tool\.referenceCutoutDataUrl, sceneCanvas, runId\)/, 'stage 1 runs before the placement is built')
  assert.match(source, /if \(!tool\.referenceStyledDataUrl \|\| tool\.referenceStyledKey !== styleKey\) \{/, 'the restyled object is cached per scene and reference')
  assert.match(source, /const cutoutCanvas = await canvasFromDataUrl\(tool\.referenceStyledDataUrl \|\| tool\.referenceCutoutDataUrl, tool\.referenceWidth, tool\.referenceHeight\)/, 'the placed object is the restyled one')

  // Stage 2 never says glow. Banning it by name painted a warm spotlight on the marble in six runs out of
  // six across three wordings and two placements; dropping the word entirely removed it.
  const stage2Body = source.slice(source.indexOf('return [', source.indexOf('function objectTransferPromptText()')))
  const stage2Prompt = stage2Body.slice(0, stage2Body.indexOf("].join(' ')"))
  assert.doesNotMatch(stage2Prompt, /glow|halo|light pool|spotlight|bloom|bright patch/, 'stage 2 never says glow: saying it is what summons the spotlight')
  assert.match(source, /'Repaint the object and everything around it as one piece of the same painting, so the object was always there\.',/, 'stage 2 asks for one painting, not for a patch')
  assert.match(source, /'Whatever sparkles, motes and streaks image 1 already has near the object carry across it and in front of it, wrapping around its silhouette, exactly in image 1 own style\.',/, 'the picture own effects carry across the object')
})
