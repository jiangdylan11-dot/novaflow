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

// 万物迁移 hands the model a BLUE PLACEMENT SILHOUETTE and repaints the WHOLE picture in one pass; the
// frame it decodes is the result. That is the ORIGINAL recipe, restored after a day of trying to improve
// on it. Handed a blue shape the model DRAWS the object in the picture’s own language; handed the object
// composited in, it retouches a pasted 3D render, and nothing stops that reading as a sticker. Rejected,
// in order:
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
  assert.equal(sampler.inputs.denoise, 0.9, 'the blue shape is only replaced at 0.9 and above')

  const [, text] = byType('TextEncodeQwenImageEditPlus')[0]
  assert.deepEqual(text.inputs.image1, ['1', 0], 'the scene reference is the plate, not a rescale of it')
  assert.deepEqual(text.inputs.image2, ['2', 0], 'the object reference stays image2')
})


test('the picture is drawn in one pass from a blue placement guide, and nothing is composited', () => {
  const source = read(RUNTIME)
  // Swept live: 0.8 came back with the blue silhouette still sitting in the picture, untouched. 0.9 and
  // 1.0 both replace it and both repaint the whole frame (drift ~36-43/255, sky ~16-19). There is no
  // "change less" setting here — that is the price of the model drawing the object rather than
  // retouching a pasted one, and it is the trade the user chose over every alternative.
  assert.match(source, /const OBJECT_TRANSFER_DENOISE = 0\.9/, 'below 0.9 the blue guide survives into the output')
  assert.match(source, /const placementGuideCanvas = objectTransferBlueGuideCanvas\(baseCanvas, transferMaskCanvas\)/, 'the guide is the blue silhouette, not the object composited in')
  assert.match(source, /guideMode: 'blue-guide-aligned-plate-single-pass'/, 'the debug record names the pass')
  assert.doesNotMatch(source, /objectTransferCompGuideCanvas\(baseCanvas, transferSubjectCanvas\)/, 'the composited-object guide is what made it a sticker')

  // The two mechanical defects of the original, and only those, are fixed.
  const plateBuilder = source.slice(source.indexOf('function buildQwenEditPlateWorkflow('), source.indexOf('function buildObjectTransferQwenWorkflow('))
  assert.doesNotMatch(plateBuilder, /class_type: 'FluxKontextImageScale'/, 'the centre-cropping rescale is gone from the transfer graph')
  assert.match(source, /const plateSize = qwenEditPlateSize\(size\.width, size\.height\)\n\s+const plateCanvas = qwenEditPlateCanvas\(placementGuideCanvas, plateSize\)/, 'the aligned plate replaces it')
  assert.match(source, /function qwenEditPlateCanvas\([\s\S]{0,600}?ctx\.imageSmoothingQuality = 'high'/, 'scaled at high quality')

  // No paste-back, so no seam: the decoded frame IS the result.
  const resultFn = source.slice(source.indexOf('async function objectTransferDecodedResultDataUrl('))
  const resultBody = resultFn.slice(0, resultFn.indexOf('\n  }\n'))
  assert.match(resultBody, /const finalCanvas = await qwenEditPlateResultCanvas\(dataUrl, assets\.plateSize, assets\.plateContent, width, height, '[^']+'\)/, 'the decoded frame is the result')
  assert.doesNotMatch(resultBody, /compositeRemovalRgbResult|pasteBackEngine|featherMaskCanvas|drawImage/, 'nothing is composited over the decode')
  assert.match(source, /pasteBack: 'none-single-pass-decode'/, 'the debug record names the path')
  assert.doesNotMatch(source, /objectTransferProtectedResultDataUrl|objectTransferScenePixels|objectTransferHarmonizeCanvas|objectTransferCastShadowCanvas/, 'no paste, no grade, no drawn shadow')

  // The original long Chinese prompt, restored verbatim. Every English rewrite of it drifted away from
  // what the user wanted; the concise-English lesson holds for the effect tools, not for a whole repaint.
  const at = source.indexOf('function objectTransferPromptText()')
  const literal = source.slice(source.indexOf('return [', at) + 'return '.length, source.indexOf('.join(', at))
  const prompt = eval(literal).join('\n')
  assert.match(prompt, /蓝色轮廓只指定物体的位置、大小和姿态，不是裁切边界/, 'the blue shape is position, size and pose only')
  assert.match(prompt, /舍弃图2的背景、打光、投影、描边、渲染风格与表面细节密度/, 'image 2 contributes identity, never its own rendering or shadow')
  assert.match(prompt, /像图1的原作者亲手画出新物体/, 'the object is drawn by image 1 own artist')
  assert.match(prompt, /去掉全部蓝色定位标记/, 'and the blue marks come out')

  // With a blue guide the model never sees the object's own rendering, so there is nothing to restyle.
  assert.doesNotMatch(source, /const styled = await objectTransferStyledCutoutDataUrl\(/, 'the restyle pass is not run: it was 50s of nothing on this path')
})
