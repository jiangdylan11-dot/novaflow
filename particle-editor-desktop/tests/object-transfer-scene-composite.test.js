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
  FluxKontextMultiReferenceLatentMethod: { input: { required: { conditioning: ['CONDITIONING', {}], reference_latents_method: combo(['offset', 'index', 'uxo-uno', 'index_timestep_zero']) } } },
  FluxKontextImageScale: { input: { required: { image: ['IMAGE', {}] } } }
})

// 万物迁移 is the user's own 图生图 graph plus the two things 图生图 does not have: a placement and a size.
// The user said so in as many words: "万物迁移。只是多了一个定位。和大小控制 还有就是 风格变化", and set the
// quality bar at what that graph produced. So this graph IS that graph — shift 3.1, 4 Lightning steps, a
// real negative branch, index_timestep_zero — and the placement is carried by the INPUT it is handed: the
// picture with the object already arranged in it. Nothing is composited afterwards.
// Rejected on the way here, in order: a region pasted back over the original ("有明显的衔接方块"), a
// silhouette-shaped latent mask ("这根本不是融合"), a graded whole-frame mask ("你现在做的全是乱贴"), and a
// cast shadow computed in JS ("这投影明显是你后加进去的").
test('the transfer graph is the 图生图 graph: no mask, no rescale, one denoise, a real negative', () => {
  const s = loadSpine(RUNTIME)
  const resolved = { unetName: 'qwen_image_edit_2511_bf16.safetensors', clipName: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', vaeName: 'qwen_image_vae.safetensors', loraName: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors' }
  const workflow = plain(s.buildObjectTransferQwenWorkflow(fakeInfo(), { placementName: 'plate.png', referenceName: 'scene.png' }, 'NovaFlow_object_transfer_x', resolved))
  const byType = (type) => Object.entries(workflow).filter(([, node]) => node.class_type === type)

  // FluxKontextImageScale picks a preset by aspect and centre-crops one axis; there is no inverse, so the
  // object came back stretched and offset. Measured on a grid probe: output_x = (input_x - 28.9) * 1.3524.
  assert.equal(byType('FluxKontextImageScale').length, 0, 'the rescale node center-crops one axis and cannot be inverted')
  assert.equal(byType('SetLatentNoiseMask').length, 0, 'no mask: any mask makes part of the picture the repainted part')
  assert.equal(byType('ImageToMask').length, 0, 'and nothing loads one')
  assert.equal(workflow['1'].inputs.image, 'plate.png')
  assert.equal(workflow['2'].inputs.image, 'scene.png')

  const [encodeId, encode] = byType('VAEEncode')[0]
  assert.deepEqual(encode.inputs.pixels, ['1', 0], 'the plate is encoded at its own resolution')
  const [, sampler] = byType('KSampler')[0]
  assert.deepEqual(sampler.inputs.latent_image, [encodeId, 0], 'the sampler runs straight on the encoded plate')
  // Qwen's CONST flow scales the input latent by (1 - sigma) and sigma starts at 1.0 for anything at or
  // above 0.81 on a 4-step schedule, so every "strength" below 1 was the same run under a worse name.
  assert.equal(sampler.inputs.denoise, 1, 'denoise is not a strength dial on this sampler')
  assert.equal(sampler.inputs.steps, 4, '4 steps, as the Lightning LoRA and the 图生图 graph both expect')
  assert.equal(sampler.inputs.cfg, 1.2, 'above 1 so the negative branch is evaluated, and no higher: 1.5 re-lit the whole picture on two seeds in three')

  const [, auraflow] = byType('ModelSamplingAuraFlow')[0]
  assert.equal(auraflow.inputs.shift, 3.1, 'the 图生图 graph shift; 1.5 was mine and it cost the quality')

  // At cfg 1 ComfyUI never evaluates the negative branch and CFGNorm collapses to identity, so a real
  // negative prompt only becomes reachable together with cfg > 1. Both, or neither.
  assert.equal(byType('ConditioningZeroOut').length, 0, 'the zeroed negative belongs to the cfg 1 path')
  const texts = byType('TextEncodeQwenImageEditPlus')
  assert.equal(texts.length, 2, 'positive and negative are both encoded over the same two images')
  const [, positive] = texts[0]
  const [negativeId, negative] = texts[1]
  assert.deepEqual(positive.inputs.image1, ['1', 0], 'the guide is image1, not a rescale of it')
  assert.deepEqual(positive.inputs.image2, ['2', 0], 'the untouched picture is image2')
  assert.deepEqual(negative.inputs.image1, ['1', 0], 'the negative sees the same frame')
  // Naming 阴影/投影 in the negative made the model overcorrect into a spotlight on the ground.
  // A negative term is a direction to move away from: 地面发亮 in this list came back as a black blot
  // under the object and the whole frame gone blue. It may not describe light, tone or shadow at all.
  assert.doesNotMatch(negative.inputs.prompt, /阴影|投影|发亮|变暗|打光|色调/, 'the negative must not describe how anything is lit')
  assert.match(negative.inputs.prompt, /物体浮在半空/, 'it forbids the floating-sticker failure instead')

  const refs = byType('FluxKontextMultiReferenceLatentMethod')
  assert.equal(refs.length, 2, 'both conditionings pin the reference method, as the 图生图 graph does')
  for (const [, node] of refs) assert.equal(node.inputs.reference_latents_method, 'index_timestep_zero', 'offset stacks the reference latents and moves everything')
  const refIds = refs.map(([id]) => id)
  assert.ok(refIds.includes(sampler.inputs.positive[0]), 'the sampler takes the pinned positive')
  assert.ok(refIds.includes(sampler.inputs.negative[0]), 'and the pinned negative')
  assert.ok(refs.some(([, node]) => node.inputs.conditioning[0] === negativeId), 'the negative is routed through its own')
})


test('the picture is drawn in one pass from an arranged frame, and nothing is composited', () => {
  const source = read(RUNTIME)
  assert.match(source, /const OBJECT_TRANSFER_DENOISE = 1\b/, 'anything below 1 is the same run under a worse name')
  assert.match(source, /const OBJECT_TRANSFER_SHIFT = 3\.1\b/)
  assert.match(source, /const OBJECT_TRANSFER_STEPS = 4\b/)
  assert.match(source, /const OBJECT_TRANSFER_CFG = 1\.2\b/)

  // The guide is the picture with the object already placed and sized. That IS 定位 and 大小控制: the model
  // is handed an arranged frame as an INPUT and asked to repaint it, never a result to be patched.
  assert.match(source, /const placementGuideCanvas = objectTransferCompGuideCanvas\(baseCanvas, transferSubjectCanvas\)/, 'the guide carries the object, at the placement the user dragged')
  assert.match(source, /guideMode: 'comp-guide-aligned-plate-single-pass'/, 'the debug record names the pass')
  assert.doesNotMatch(source, /objectTransferBlueGuideCanvas|objectTransferContactMaskCanvas|objectTransferCombinedMaskCanvas/, 'the blue silhouette and its contact ellipse are gone')

  // bf16 at the loader's default dtype, because that is what the 图生图 graph loads and the bar is its output.
  assert.match(source, /OBJECT_TRANSFER_QWEN_UNETS = \['qwen_image_edit_2511_bf16\.safetensors'/, 'bf16 first, fp8mixed only as a fallback')

  const plateBuilder = source.slice(source.indexOf('function buildQwenEditPlateWorkflow('), source.indexOf('function buildObjectTransferQwenWorkflow('))
  assert.doesNotMatch(plateBuilder, /class_type: 'FluxKontextImageScale'/, 'the centre-cropping rescale is gone from the transfer graph')
  assert.match(source, /const plateSize = qwenEditPlateSize\(size\.width, size\.height\)\n\s+const plateCanvas = qwenEditPlateCanvas\(placementGuideCanvas, plateSize\)/, 'the aligned plate replaces it')
  assert.match(source, /function qwenEditPlateCanvas\([\s\S]{0,600}?ctx\.imageSmoothingQuality = 'high'/, 'scaled at high quality')

  // The picture and the object are still RENDERED together in one pass — that is what makes the
  // object's shading, its cast shadow and the picture's effects over it the same brush strokes.
  // After the decode the untouched picture is faded back in wherever the pass changed something it was
  // not asked to change: at denoise 1 it relights the whole frame, and 227k pixels outside the
  // placement box came back changed on the tuned picture. The user asked for exactly this once they
  // saw it — "可以用A..然后回贴不就好了。尽量去掉影响".
  const resultFn = source.slice(source.indexOf('async function objectTransferDecodedResultDataUrl('))
  const resultBody = resultFn.slice(0, resultFn.indexOf('\n  }\n'))
  assert.ok(resultBody.includes("const decodedCanvas = await qwenEditPlateResultCanvas(dataUrl, assets.plateSize, assets.plateContent, width, height, '"), 'the frame is still decoded whole')
  assert.ok(resultBody.includes('objectTransferRestoredCanvas(baseCanvas, decodedCanvas, assets.subjectMaskCanvas)'), 'and the picture is restored around it')
  assert.match(source, /pasteBack: 'continuous-restore-outside-object'/, 'the debug record names the path')
  // It must stay CONTINUOUS. Four earlier attempts cut a region out and dropped it back in, and the cut
  // showed as a rectangle every time — "有明显的衔接方块". Two smooth factors multiply and neither has an
  // edge: the object's own feathered silhouette, and how much the pixel actually changed.
  const restoreFn = source.slice(source.indexOf('function objectTransferRestoredCanvas('))
  const restoreBody = restoreFn.slice(0, restoreFn.indexOf('\n  }\n'))
  const weightFn = source.slice(source.indexOf('function objectTransferRestoreWeightCanvas('))
  const weightBody = weightFn.slice(0, weightFn.indexOf('\n  }\n'))
  // Keyed on the object's SILHOUETTE, not its placement box. The box is far larger than the object —
  // on the tuned picture it covers the woman's lower half and her dress — so keying on it kept the
  // model's edits to her along with the object's own.
  assert.ok(weightBody.includes('expandedMaskCanvas(paintableMaskCanvas(subjectMaskCanvas, 8, false), 4)'), 'the object silhouette is what is kept')
  assert.ok(weightBody.includes('OBJECT_TRANSFER_RESTORE_FEATHER}px)'), 'and it is feathered, so it has no edge')
  assert.ok(weightBody.includes('const ground = groundY * Math.max(0, 1 - dx / reachSide)'), 'the ground under it falls off linearly')
  assert.ok(restoreBody.includes('w = near * Math.min(1, Math.max(0, (diff - OBJECT_TRANSFER_RESTORE_KEEP_FROM) / OBJECT_TRANSFER_RESTORE_KEEP_RAMP))'), 'the difference ramps, it does not threshold, and it multiplies the position weight')
  assert.doesNotMatch(restoreBody, /fillRect|drawImage/, 'nothing is drawn: every pixel is a weighted mix')
  assert.doesNotMatch(source, /objectTransferProtectedResultDataUrl|objectTransferScenePixels|objectTransferHarmonizeCanvas|objectTransferCastShadowCanvas/, 'no region paste, no colour grade, no drawn shadow')

  // 风格变化: the object is repainted on flat grey before it is ever placed. The user's condition for
  // dropping this pass was that fusion alone make the object match the picture, and it does not.
  assert.match(source, /const styledCutoutDataUrl = await objectTransferStyledCutoutForRun\(baseUrl, info, resolved, runId\)/, 'the restyle pass runs before the placement')
  assert.match(source, /objectTransferBuildInputCanvases\(styledCutoutDataUrl\)/, 'and the restyled object is what gets placed')

  // And that pass reads the scene's style out as WORDS first. Measured on four scenes rebuilt from one
  // picture (cel-shaded, ink wash, pixel art, photographic): handed only the scene as a reference image
  // the object came back unrendered in four cases out of five, at every cfg, step count and reference
  // order tried. Handed the same style as text it rendered all four. The scene image still goes in with
  // the words — asked for ink wash by text alone the model painted paper grain over the grey plate and
  // broke the RMBG that runs next.
  assert.match(source, /const sceneArtStyle = await objectTransferSceneArtStyleText\(sceneCanvas\)/, 'the scene style is read before the object is repainted')
  assert.match(source, /promptAssistantDescribeArtStyle/, 'via the local VLM the prompt assistant already ships')
  const reader = source.slice(source.indexOf('async function objectTransferSceneArtStyleText('))
  const readerBody = reader.slice(0, reader.indexOf("\n  }\n"))
  assert.match(readerBody, /if \(!api \|\| typeof api\.promptAssistantDescribeArtStyle !== 'function'\) return ''/, 'best effort: no bridge, no words, the pass still runs')
  assert.match(readerBody, /catch \(error\)[\s\S]{0,400}?return ''/, 'and a failed VLM never fails the transfer')
  // The cache has to see the scene too, or the same object dropped on a second picture reuses the first
  // picture's paint job.
  assert.match(source, /referenceStyledKey === key/, 'the restyle is cached')
  assert.match(source, /sceneArtStyle\.slice\(0, 200\)/, 'and the cache key carries the scene style')

  // The scene's style goes INTO the prompt that shipped, as one slot in sentence 4, and nothing else
  // moves. Rewriting the whole prompt around the style text pinned the object so hard that it stopped
  // absorbing the scene's light: it came back in its own cold green instead of picking up the picture's
  // warmth, and the user called it immediately — "本质上的画面融合给你弄没了". The five sentences around
  // the slot are the ones that were bought with measured failures; they stay verbatim.
  const promptFn = source.slice(source.indexOf('function objectTransferRestylePromptText('))
  assert.match(promptFn.slice(0, 5000), /const painted = style && OBJECT_TRANSFER_NON_PAINTERLY_STYLE\.test\(style\)/, 'the style text fills sentence 4, and only when the tuned wording would be wrong for the scene')
  // The classifier, checked against the five descriptions the local VLM actually produced plus one
  // paraphrase. A soft painted scene keeps the shipped sentence, because substituting a read-out
  // description there pins the object hard enough that it stops absorbing the scene's light.
  const classifierLine = source.split('\n').find((l) => l.includes('OBJECT_TRANSFER_NON_PAINTERLY_STYLE = '))
  const classifier = eval(classifierLine.slice(classifierLine.indexOf('/')))
  for (const painterly of [
    'Render with digital brush strokes mimicking soft, blended gradients and subtle texture overlays, creating smooth transitions without harsh edges or defined contours.',
    'Soft digital painting with blended gradients, gentle edges, layered glazes and no visible linework.'
  ]) assert.equal(classifier.test(painterly), false, 'soft painting keeps the tuned wording: ' + painterly.slice(0, 40))
  for (const other of [
    'Flat cel shading with bold, clean black outlines, solid color blocks, minimal gradients, sharp edges, no blending.',
    'Apply ink with broad, wet brushstrokes that bleed into paper, pooling at edges; leave large bare areas unpainted.',
    'Render in 8-bit pixel art: square pixels, uniform size, sharp edges, blocky forms, no anti-aliasing, flat color fills.',
    'Render with photorealistic 3D rasterization: smooth continuous shading with soft ambient occlusion and crisp silhouette edges.'
  ]) assert.equal(classifier.test(other), true, 'a scene the tuned wording gets wrong needs the description: ' + other.slice(0, 40))
  assert.match(promptFn.slice(0, 5000), /: 'Change only how it is painted: image 2 soft painted shading/, 'and without it that sentence keeps its tuned wording')
  assert.match(promptFn.slice(0, 5000), /as if the artist of image 2 had drawn it/, 'pointing at the artist is what stops it coming back a flat vector sticker')
  assert.equal(promptFn.slice(0, 5000).split("'Redraw the object from image 1").length - 1, 1, 'one prompt, not two branches that can drift apart')
  // The restyle pass runs at the plate builder's own numbers, and that is load-bearing. Raising it to 8
  // steps / cfg 2.5 was measured as necessary BEFORE the scene's style was named in words; with the words,
  // cfg 1 renders cel shading harder and cleaner than 2.5 did. What 2.5 actually bought was a
  // high-contrast object lit for the grey plate, and the integration pass copies that lighting verbatim,
  // so the object stops belonging to the picture — the user caught it on sight. Measured on the tuned
  // scene, 2.5 -> 1: darkened ground 30.3 -> 20.6%, R-B -22.1 -> -22.4 against the original's -24.8,
  // whole-frame drift 20.9 -> 17.9. Every number improved.
  assert.match(source, /const OBJECT_TRANSFER_RESTYLE_STEPS = 6\b/)
  assert.match(source, /const OBJECT_TRANSFER_RESTYLE_CFG = 1\b/)

  // Three sentences. The long repaint prompt that used to be here was the colour drift: same picture, same
  // settings, prompt swapped, and R-B went from -8.8 back to -26.4 against the original's -24.8.
  const at = source.indexOf('function objectTransferPromptText()')
  const literal = source.slice(source.indexOf('return [', at) + 'return '.length, source.indexOf('.join(', at))
  const lines = eval(literal)
  const prompt = lines.join('')
  assert.equal(lines.length, 3, 'three sentences; a prompt that describes the whole picture makes it redraw the whole picture')
  assert.ok(prompt.length < 220, 'and short: ' + prompt.length)
  assert.match(prompt, /按图1里的位置和大小/, 'the placement comes from the arranged frame it was handed')
  // The one defect that survived everything else: every earlier prompt only said 保持不变, which forbids
  // touching the ground, so the object stood on clean marble with no contact shading — "投影...好像都没了".
  assert.match(prompt, /重新绘制物体底部周围的地面/, 'the ground is explicitly released, or the model never shades it')
  assert.match(prompt, /一小片浅淡接触暗部/, 'without 浅淡 the same sentence returns a long hard silhouette')
  // Asking only for 接触处 with no 投影 came back as a black ellipse under the feet, like a hole.
  assert.match(prompt, /投影短而柔和/, 'a soft short cast shadow, not a contact patch on its own')
  // And NO size cap. I added one because 51.7% darkened ground looked wrong to me; the version the user
  // rates highest draws 47.7%, and capping it to 20.6% is what made the shadow read as fake — "投影真实"
  // was their word for the uncapped one. That cap was my judgement overriding the measurement.
  assert.doesNotMatch(prompt, /宽度不超过|不要拉长|不要大片|不要盖住/, 'the shadow is not capped: a capped one reads as fake')
  assert.doesNotMatch(prompt, /机器人|台阶|大理石/, 'it runs on whatever the user dropped in, so it may not name the object')
})
