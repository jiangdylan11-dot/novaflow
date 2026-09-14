const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..', '..')
const workflowPath = path.join(root, 'particle-editor', 'ai-sequence-minimax-h3.workflow.js')
const window = {}
window.window = window
window.globalThis = window

vm.runInNewContext(readFileSync(workflowPath, 'utf8'), {
  window,
  globalThis: window,
  console,
}, { filename: workflowPath })

const api = window.NovaFlowAiSequenceMiniMaxH3Workflow
assert.ok(api, 'MiniMax H3 workflow module must be exposed')
assert.equal(api.MODEL_ID, 'MiniMax_h3')
assert.deepEqual(Array.from(api.MODES), ['t2v', 'i2v', 'fl2v', 'r2v'])
for (const name of [
  'getWorkflowJson',
  'patchWorkflow',
  'buildWorkflow',
  'validateWorkflow',
  'calculateResolution',
  'normalizeSteps',
  'normalizeLoras',
  'normalizeDuration',
  'normalizeFps',
]) {
  assert.equal(typeof api[name], 'function', name + ' must be exposed')
}

const FL2VA = 'Minimax_H3\\10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors'
const REF2VA = 'Minimax_H3\\10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors'
const TURBO_LORA = 'minimax_h3\\minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors'
const VALID_LORA_FINGERPRINT = 'v1:123456:1750000000000.125:' + 'a'.repeat(64)
const FORBIDDEN_CLASS = /kj|te.?speed|negative/i
const FORBIDDEN_INPUT = /^(high|low|lora|lora_name|kj|sage|sage_attention|te_speed|negative|negative_prompt)$/i
const H3_ASPECT_RATIOS = Object.freeze(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'])
const H3_MEGAPIXELS = Object.freeze([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.98, 1, 1.2, 1.5, 1.8, 2])

assert.equal(api.OUTPUT_FPS, 24)
assert.deepEqual(Array.from(api.FPS_OPTIONS), [16, 24])
assert.equal(api.OUTPUT_STEPS, 4)
assert.equal(api.DEFAULT_STEPS, 4)
assert.deepEqual(Array.from(api.STEP_OPTIONS), [4, 20])
assert.equal(api.MIN_STEPS, 1)
assert.equal(api.MAX_STEPS, 10000)
assert.equal(api.R2V_STEPS, 4)
assert.equal(api.RESOLUTION_MULTIPLE, 32)
assert.equal(api.MIN_MEGAPIXELS, 0.2)
assert.equal(api.MAX_MEGAPIXELS, 2)
assert.equal(api.MAX_CANVAS_PIXELS, 2208 * 960)
assert.equal(api.MIN_DURATION, 1)
assert.equal(api.MAX_DURATION, 30)
assert.equal(api.DURATION_STEP, 0.01)
assert.deepEqual(Array.from(api.ASPECT_RATIOS, (entry) => entry.value), H3_ASPECT_RATIOS)
assert.deepEqual(Array.from(api.ASPECT_RATIOS, (entry) => entry.label), [
  '1:1（方形）',
  '2:3（竖屏照片）',
  '3:2（横屏照片）',
  '3:4（竖屏标准）',
  '4:3（横屏标准）',
  '9:16（竖屏宽银幕）',
  '16:9（横屏宽银幕）',
  '21:9（超宽屏）',
])
assert.deepEqual(Array.from(api.MEGAPIXEL_OPTIONS), H3_MEGAPIXELS)

function entriesByClass(workflow, classType) {
  return Object.entries(workflow).filter(([, value]) => value.class_type === classType)
}

function oneByClass(workflow, classType) {
  const entries = entriesByClass(workflow, classType)
  assert.equal(entries.length, 1, 'expected exactly one ' + classType)
  return entries[0]
}

function hostClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function provenLora(value) {
  return { fingerprint: VALID_LORA_FINGERPRINT, ...value }
}

function assertStepTopology(workflow, expectedSteps, mode, declaredLoras = []) {
  const [unetId] = oneByClass(workflow, 'UNETLoader')
  const scheduler = oneByClass(workflow, 'BasicScheduler')[1]
  assert.equal(scheduler.inputs.steps, expectedSteps)
  assert.deepEqual(hostClone(scheduler.inputs.model), [unetId, 0], 'scheduler must always use the raw UNET')
  const guider = oneByClass(workflow, 'BasicGuider')[1]
  const loraLoaders = entriesByClass(workflow, 'LoraLoaderModelOnly')
  const expectedLoras = declaredLoras.filter((descriptor) => descriptor.enabled !== false)
  assert.equal(
    loraLoaders.length,
    expectedLoras.length,
    'LoRA loader count must match the declared chain',
  )
  const unused = new Map(loraLoaders)
  const takeNext = (upstreamId) => {
    const matches = Array.from(unused.entries()).filter(([, value]) => (
      value.inputs.model[0] === upstreamId && value.inputs.model[1] === 0
    ))
    assert.equal(matches.length, 1, 'LoRA chain must have exactly one next node')
    unused.delete(matches[0][0])
    return matches[0]
  }
  let upstreamId = unetId

  for (const descriptor of expectedLoras) {
    const [loraId, lora] = takeNext(upstreamId)
    assert.equal(lora.inputs.lora_name, descriptor.name)
    assert.equal(lora.inputs.strength_model, descriptor.strength ?? descriptor.weight ?? 1)
    upstreamId = loraId
  }
  assert.equal(unused.size, 0, 'every LoRA loader must be part of the declared chain')
  const [sageId, sage] = oneByClass(workflow, 'NovaFlowH3SageAttention')
  assert.deepEqual(hostClone(sage.inputs.model), [upstreamId, 0])
  assert.deepEqual(hostClone(guider.inputs.model), [sageId, 0], 'guider must use Sage after the LoRA chain')
}

function assertWorkflowContract(workflow, expectedUnet, expectedSteps, mode, loras = [], expectedFps = 24) {
  assert.equal(api.validateWorkflow(workflow, { mode, steps: expectedSteps, loras, fps: expectedFps }), true)
  const unets = entriesByClass(workflow, 'UNETLoader')
  assert.equal(unets.length, 1, 'each mode must have exactly one UNETLoader')
  assert.equal(unets[0][1].inputs.unet_name, expectedUnet)
  assert.equal(unets[0][1].inputs.weight_dtype, 'default')
  for (const node of Object.values(workflow)) {
    assert.doesNotMatch(node.class_type, FORBIDDEN_CLASS)
    if (node.class_type !== 'LoraLoaderModelOnly') {
      for (const key of Object.keys(node.inputs)) assert.doesNotMatch(key, FORBIDDEN_INPUT)
    }
  }
  const scheduler = oneByClass(workflow, 'BasicScheduler')[1]
  assert.equal(scheduler.inputs.scheduler, 'simple')
  assert.equal(scheduler.inputs.denoise, 1)
  assertStepTopology(workflow, expectedSteps, mode, loras)
  assert.equal(oneByClass(workflow, 'KSamplerSelect')[1].inputs.sampler_name, 'res_multistep')
  assert.equal(oneByClass(workflow, 'CreateVideo')[1].inputs.fps, expectedFps)
  assert.equal(oneByClass(workflow, 'CreateVideo')[1].inputs.bit_depth, 8)
}

for (const mode of api.MODES) {
  const defaultTemplate = JSON.parse(api.getWorkflowJson({ mode }))
  assert.equal(api.validateWorkflow(defaultTemplate), true, mode + ' default template must validate')
  assertStepTopology(defaultTemplate, 4, mode)
  for (const steps of [1, 4, 5, 20, 10000]) {
    const template = JSON.parse(api.getWorkflowJson({ mode, steps }))
    assert.equal(
      api.validateWorkflow(template, { mode, steps }),
      true,
      mode + ' ' + steps + '-step template must validate',
    )
    assert.equal(entriesByClass(template, 'UNETLoader').length, 1)
    assertStepTopology(template, steps, mode)
  }
}

const firstTemplate = JSON.parse(api.getWorkflowJson({ mode: 't2v' }))
firstTemplate['1'].inputs.unet_name = 'mutated.safetensors'
const secondTemplate = JSON.parse(api.getWorkflowJson({ mode: 't2v' }))
assert.equal(secondTemplate['1'].inputs.unet_name, FL2VA, 'getWorkflowJson must return a fresh template')

const portrait04 = hostClone(api.calculateResolution({ aspectRatio: '9:16', megapixels: 0.4 }))
assert.equal(portrait04.aspectRatio, '9:16')
assert.equal(portrait04.megapixels, 0.4)
assert.equal(portrait04.width, 480)
assert.equal(portrait04.height, 864)

const landscape04 = hostClone(api.calculateResolution({ aspectRatio: '16:9', megapixels: 0.4 }))
assert.equal(landscape04.aspectRatio, '16:9')
assert.equal(landscape04.megapixels, 0.4)
assert.equal(landscape04.width, 864)
assert.equal(landscape04.height, 480)

const EXPECTED_RESOLUTIONS = Object.freeze([
  [0.2, [[448, 448], [384, 576], [576, 384], [384, 544], [544, 384], [352, 608], [608, 352], [704, 288]]],
  [0.3, [[576, 576], [448, 672], [672, 448], [480, 640], [640, 480], [416, 736], [736, 416], [864, 352]]],
  [0.4, [[640, 640], [544, 800], [800, 544], [576, 736], [736, 576], [480, 864], [864, 480], [992, 416]]],
  [0.5, [[736, 736], [576, 896], [896, 576], [640, 832], [832, 640], [544, 960], [960, 544], [1120, 480]]],
  [0.6, [[800, 800], [640, 960], [960, 640], [672, 928], [928, 672], [608, 1056], [1056, 608], [1216, 512]]],
  [0.7, [[864, 864], [704, 1056], [1056, 704], [736, 992], [992, 736], [640, 1152], [1152, 640], [1312, 576]]],
  [0.8, [[928, 928], [736, 1120], [1120, 736], [800, 1056], [1056, 800], [672, 1216], [1216, 672], [1408, 608]]],
  [0.9, [[960, 960], [800, 1184], [1184, 800], [832, 1120], [1120, 832], [736, 1280], [1280, 736], [1472, 640]]],
  [0.98, [[1024, 1024], [832, 1248], [1248, 832], [864, 1184], [1184, 864], [768, 1344], [1344, 768], [1536, 672]]],
  [1, [[1024, 1024], [832, 1248], [1248, 832], [896, 1184], [1184, 896], [768, 1376], [1376, 768], [1568, 672]]],
  [1.2, [[1120, 1120], [928, 1376], [1376, 928], [960, 1280], [1280, 960], [832, 1504], [1504, 832], [1728, 736]]],
  [1.5, [[1248, 1248], [1024, 1536], [1536, 1024], [1088, 1440], [1440, 1088], [928, 1664], [1664, 928], [1920, 832]]],
  [1.8, [[1376, 1376], [1120, 1696], [1696, 1120], [1184, 1600], [1600, 1184], [1024, 1824], [1824, 1024], [2112, 896]]],
  [2, [[1440, 1440], [1184, 1760], [1760, 1184], [1248, 1664], [1664, 1248], [1088, 1920], [1920, 1088], [2208, 960]]],
])

for (const [megapixels, dimensions] of EXPECTED_RESOLUTIONS) {
  for (let index = 0; index < H3_ASPECT_RATIOS.length; index += 1) {
    const aspectRatio = H3_ASPECT_RATIOS[index]
    const resolved = hostClone(api.calculateResolution({ aspectRatio, megapixels }))
    assert.equal(resolved.aspectRatio, aspectRatio)
    assert.equal(resolved.megapixels, megapixels)
    assert.deepEqual([resolved.width, resolved.height], dimensions[index], aspectRatio + ' @ ' + megapixels + ' MP')
    assert.equal(resolved.width % 32, 0, aspectRatio + ' width must align to 32')
    assert.equal(resolved.height % 32, 0, aspectRatio + ' height must align to 32')
    assert.ok(resolved.pixels <= api.MAX_CANVAS_PIXELS, aspectRatio + ' must fit the rounded preset envelope')
  }
}

const ultrawide2 = hostClone(api.calculateResolution({ aspectRatio: '21:9', megapixels: 2 }))
assert.deepEqual([ultrawide2.width, ultrawide2.height], [2208, 960])
assert.ok(ultrawide2.pixels > 2 * 1024 * 1024, 'native axis rounding must not be rejected by a simple 2 MP hard cap')

for (const invalidResolution of [
  { aspectRatio: '5:4', megapixels: 0.4 },
  { aspectRatio: '16:9', megapixels: 0 },
  { aspectRatio: '16:9', megapixels: 2.01 },
  { aspectRatio: '16:9', megapixels: Number.NaN },
]) {
  assert.throws(
    () => api.calculateResolution(invalidResolution),
    (error) => error?.name === 'RangeError' || error?.name === 'TypeError',
    'invalid H3 resolution inputs must be rejected instead of silently clamped',
  )
}

for (const mode of api.MODES) {
  assert.equal(api.normalizeSteps(undefined, mode), 4, mode + ' must default to four steps')
  for (const steps of [1, 4, 5, 20, 10000]) {
    assert.equal(api.normalizeSteps(String(steps), mode), steps)
  }
  assert.equal(api.normalizeSteps('20', mode), 20)
}
for (const invalidSteps of [0, -1, 1.5, 10001, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(() => api.normalizeSteps(invalidSteps, 't2v'), /integer between 1 and 10000/i)
}

const duration4 = hostClone(api.normalizeDuration({ seconds: 4 }))
assert.equal(duration4.requestedDuration, 4)
assert.equal(duration4.frames, 107)
assert.equal(duration4.actualDuration, 107 / 24)

const duration1 = hostClone(api.normalizeDuration({ seconds: 1 }))
assert.equal(duration1.requestedDuration, 1)
assert.equal(duration1.frames, 39)
assert.equal(duration1.actualDuration, 1.625)

const duration6 = hostClone(api.normalizeDuration(6))
assert.equal(duration6.requestedDuration, 6)
assert.equal(duration6.frames, 158)
assert.equal(duration6.actualDuration, 158 / 24)

const duration517 = hostClone(api.normalizeDuration({ seconds: 5.17 }))
assert.equal(duration517.requestedDuration, 5.17)
assert.equal(duration517.frames, 124, 'duration must round to a frame before snapping to the source-workflow 17n+5 grid')
assert.equal(duration517.actualDuration, 124 / 24)

const duration446 = hostClone(api.normalizeDuration({ seconds: 4.46 }))
assert.equal(duration446.requestedDuration, 4.46)
assert.equal(duration446.frames, 107, '4.46 seconds must not jump an extra 17-frame group')
assert.equal(duration446.actualDuration, 107 / 24)
assert.ok(
  duration517.requestedDuration - duration517.actualDuration <= 0.5 / 24,
  'source-workflow rounding may shorten by at most half of one 24 FPS frame',
)

const duration15 = hostClone(api.normalizeDuration(15))
assert.equal(duration15.requestedDuration, 15)
assert.equal(duration15.frames, 362)
assert.equal(duration15.actualDuration, 362 / 24)

const duration30 = hostClone(api.normalizeDuration(30))
assert.equal(duration30.requestedDuration, 30)
assert.equal(duration30.frames, 736)
assert.equal(duration30.actualDuration, 736 / 24)

assert.equal(api.normalizeFps(undefined), 24)
assert.equal(api.normalizeFps('16'), 16)
assert.equal(api.normalizeFps(24), 24)
for (const invalidFps of [15, 23.976, 30, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(
    () => api.normalizeFps(invalidFps),
    (error) => error?.name === 'RangeError' || error?.name === 'TypeError',
    'H3 output FPS must be limited to the local 16/24 test gears',
  )
}

const duration30At16 = hostClone(api.normalizeDuration({ seconds: 30, fps: 16 }))
assert.equal(duration30At16.requestedDuration, 30)
assert.equal(duration30At16.frames, 481)
assert.equal(duration30At16.actualDuration, 481 / 16)
assert.equal(duration30At16.fps, 16)

for (const invalidDuration of [0.99, 30.01, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(
    () => api.normalizeDuration(invalidDuration),
    (error) => error?.name === 'RangeError' || error?.name === 'TypeError',
    'duration outside 1.00-30.00 seconds must be rejected instead of silently clamped',
  )
}

const parameterizedT2v = api.buildWorkflow({
  mode: 't2v',
  prompt: 'A wide establishing shot with synchronized native ambience.',
  aspectRatio: '16:9',
  megapixels: 0.4,
  durationSeconds: 6,
})
const parameterizedConditioning = oneByClass(parameterizedT2v, 'MiniMaxH3ImageToVideo')[1]
assertWorkflowContract(parameterizedT2v, FL2VA, 4, 't2v')
assert.equal(parameterizedConditioning.inputs.width, 864)
assert.equal(parameterizedConditioning.inputs.height, 480)
assert.equal(parameterizedConditioning.inputs.length, 158)

const lowFpsT2v = api.buildWorkflow({
  mode: 't2v',
  prompt: 'A local low-FPS long-duration H3 test clip.',
  aspectRatio: '9:16',
  megapixels: 0.4,
  durationSeconds: 30,
  fps: 16,
})
const lowFpsConditioning = oneByClass(lowFpsT2v, 'MiniMaxH3ImageToVideo')[1]
assertWorkflowContract(lowFpsT2v, FL2VA, 4, 't2v', [], 16)
assert.equal(lowFpsConditioning.inputs.length, 481)

const ultrawide2Workflow = api.buildWorkflow({
  mode: 't2v',
  prompt: 'A two-megapixel ultrawide H3 contract frame.',
  aspectRatio: '21:9',
  megapixels: 2,
  durationSeconds: 4,
})
assertWorkflowContract(ultrawide2Workflow, FL2VA, 4, 't2v')
const ultrawide2Conditioning = oneByClass(ultrawide2Workflow, 'MiniMaxH3ImageToVideo')[1]
assert.deepEqual([ultrawide2Conditioning.inputs.width, ultrawide2Conditioning.inputs.height], [2208, 960])

const t2v = api.buildWorkflow({
  mode: 't2v',
  model: 'MiniMax_h3',
  prompt: 'A paper dragon flies over a lantern-lit city with native ambience.',
  width: 479,
  height: 865,
  duration: 5,
  seed: 123,
  outputPrefix: 'video/minimax/t2v',
})
assertWorkflowContract(t2v, FL2VA, 4, 't2v')
assert.equal(Object.keys(t2v).length, 15)
assert.equal(entriesByClass(t2v, 'LoadImage').length, 0)
const t2vConditioning = oneByClass(t2v, 'MiniMaxH3ImageToVideo')[1]
assert.equal(t2vConditioning.inputs.width, 480)
assert.equal(t2vConditioning.inputs.height, 864)
assert.equal(t2vConditioning.inputs.length, 124)
assert.equal(t2vConditioning.inputs.first_frame, undefined)
assert.equal(t2vConditioning.inputs.last_frame, undefined)
assert.equal(oneByClass(t2v, 'RandomNoise')[1].inputs.noise_seed, 123)
assert.equal(oneByClass(t2v, 'SaveVideo')[1].inputs.filename_prefix, 'video/minimax/t2v')

const i2v = api.buildWorkflow({
  mode: 'i2v',
  params: {
    prompt: 'The character turns toward camera while wind moves the costume.',
    images: ['prepared-first-frame.png'],
    duration: 5,
    seed: 456,
  },
})
assertWorkflowContract(i2v, FL2VA, 4, 'i2v')
assert.equal(entriesByClass(i2v, 'LoadImage').length, 1)
const [i2vImageId, i2vImage] = oneByClass(i2v, 'LoadImage')
assert.equal(i2vImage.inputs.image, 'prepared-first-frame.png')
const i2vConditioning = oneByClass(i2v, 'MiniMaxH3ImageToVideo')[1]
assert.deepEqual(hostClone(i2vConditioning.inputs.first_frame), [i2vImageId, 0])
assert.equal(i2vConditioning.inputs.last_frame, undefined)

const fl2v = api.buildWorkflow({
  mode: 'fl2v',
  prompt: 'Move continuously from the opening pose to the closing pose.',
  firstFrame: 'prepared-first-frame.png',
  lastFrame: 'prepared-last-frame.png',
  duration: 6,
  seed: 789,
})
assertWorkflowContract(fl2v, FL2VA, 4, 'fl2v')
const fl2vImages = entriesByClass(fl2v, 'LoadImage')
assert.equal(fl2vImages.length, 2)
assert.deepEqual(fl2vImages.map(([, value]) => value.inputs.image), [
  'prepared-first-frame.png',
  'prepared-last-frame.png',
])
const fl2vConditioning = oneByClass(fl2v, 'MiniMaxH3ImageToVideo')[1]
assert.notEqual(fl2vConditioning.inputs.first_frame[0], fl2vConditioning.inputs.last_frame[0])
assert.equal(fl2vConditioning.inputs.length % 17, 5)

for (const [mode, modeOptions] of [
  ['t2v', {}],
  ['i2v', { images: ['twenty-step-first.png'] }],
  ['fl2v', { firstFrame: 'twenty-step-first.png', lastFrame: 'twenty-step-last.png' }],
]) {
  const twentyStep = api.buildWorkflow({
    mode,
    prompt: 'A native twenty-step MiniMax H3 validation clip.',
    steps: 20,
    duration: 4,
    ...modeOptions,
  })
  assertWorkflowContract(twentyStep, FL2VA, 20, mode)
}

const references = [
  'reference-1.png',
  'reference-2.png',
  'reference-3.png',
  'reference-4.png',
]
const r2v = api.buildWorkflow({
  mode: 'r2v',
  prompt: [
    '<Picture 1>, <Picture 2>, <Picture 3>, and <Picture 4> meet in a market.',
    '<Video 1> supplies the motion and <Audio 1> supplies the standalone voice reference.',
  ].join(' '),
  referenceImages: references,
  referenceVideo: 'reference-motion.mp4',
  referenceAudio: 'reference-voice.wav',
  duration: 5,
  seed: 101112,
})
assertWorkflowContract(r2v, REF2VA, 4, 'r2v')
assert.equal(entriesByClass(r2v, 'LoadImage').length, 4)
assert.equal(entriesByClass(r2v, 'LoadVideo').length, 1)
assert.equal(entriesByClass(r2v, 'GetVideoComponents').length, 1)
assert.equal(entriesByClass(r2v, 'LoadAudio').length, 1)
assert.deepEqual(
  entriesByClass(r2v, 'LoadImage').map(([, value]) => value.inputs.image),
  references,
)

const [videoId, videoNode] = oneByClass(r2v, 'LoadVideo')
const [componentsId, componentsNode] = oneByClass(r2v, 'GetVideoComponents')
const [audioId, audioNode] = oneByClass(r2v, 'LoadAudio')
assert.equal(videoNode.inputs.file, 'reference-motion.mp4')
assert.deepEqual(hostClone(componentsNode.inputs.video), [videoId, 0])
assert.equal(audioNode.inputs.audio, 'reference-voice.wav')

const r2vConditioning = oneByClass(r2v, 'MiniMaxH3ReferenceToVideo')[1]
assert.equal(r2vConditioning.inputs.ref_image_size, 'match')
for (let index = 0; index < 4; index += 1) {
  const link = r2vConditioning.inputs['ref_images.ref_image_' + index]
  assert.equal(r2v[link[0]].class_type, 'NovaFlowH3PrepareReferenceImage')
  assert.equal(r2v[r2v[link[0]].inputs.image[0]].class_type, 'LoadImage')
  assert.equal(link[1], 0)
}
assert.deepEqual(
  hostClone(r2vConditioning.inputs['ref_videos.ref_video_0']),
  [componentsId, 0],
)
assert.equal(r2vConditioning.inputs['ref_video_audios.ref_video_audio_0'], undefined)
assert.deepEqual(
  hostClone(r2vConditioning.inputs['ref_audios.ref_audio_0']),
  [audioId, 0],
)

const imageOnlyR2v = api.buildWorkflow({
  mode: 'r2v',
  prompt: '<Picture 1> walks through a sunlit courtyard.',
  referenceImages: ['single-reference.png'],
})
assertWorkflowContract(imageOnlyR2v, REF2VA, 4, 'r2v')
assert.equal(entriesByClass(imageOnlyR2v, 'LoadImage').length, 1)
assert.equal(entriesByClass(imageOnlyR2v, 'LoadVideo').length, 0)
assert.equal(entriesByClass(imageOnlyR2v, 'GetVideoComponents').length, 0)
assert.equal(entriesByClass(imageOnlyR2v, 'LoadAudio').length, 0)

const patchTemplate = JSON.parse(api.getWorkflowJson({ mode: 'i2v' }))
const patched = api.patchWorkflow({ prompt: patchTemplate }, {
  mode: 'i2v',
  prompt: 'Patched image-to-video prompt.',
  images: ['patched-first-frame.png'],
})
assert.equal(oneByClass(patched, 'LoadImage')[1].inputs.image, 'patched-first-frame.png')
assert.equal(patchTemplate['20'].inputs.image, 'first-frame.png', 'patchWorkflow must not mutate its input')

const patchTemplate20 = JSON.parse(api.getWorkflowJson({ mode: 't2v', steps: 20 }))
const patched20 = api.patchWorkflow(patchTemplate20, {
  mode: 't2v',
  steps: 20,
  prompt: 'Patched native twenty-step prompt.',
})
assertWorkflowContract(patched20, FL2VA, 20, 't2v')
assert.throws(() => api.patchWorkflow(patchTemplate20, {
  mode: 't2v',
  steps: 4,
  prompt: 'A mismatched topology must not be silently rewritten.',
}), /step topology mismatch/i)

const fl2vaLoras = [
  provenLora({
    name: 'minimax_h3\\portrait-detail-fl2va.safetensors',
    strength: 0.65,
    enabled: true,
    modelFamily: 'fl2va',
    kind: 'standard',
    supportedSteps: [4, 5, 20],
  }),
  provenLora({
    name: 'minimax_h3\\motion-style-fl2va.safetensors',
    weight: 1.25,
    modelFamily: 'fl2va',
    kind: 'standard',
  }),
]
const fourStepWithLoras = api.buildWorkflow({
  mode: 't2v',
  prompt: 'A controlled four-step H3 user LoRA chain.',
  steps: 4,
  loras: fl2vaLoras,
})
assertWorkflowContract(fourStepWithLoras, FL2VA, 4, 't2v', fl2vaLoras)
assert.throws(
  () => api.validateWorkflow(fourStepWithLoras),
  /undeclared user LoRA/i,
  'a validator call without options.loras must not trust injected user LoRA nodes',
)

const modeInputs = {
  t2v: {},
  i2v: { firstFrame: 'lora-mode-first.png' },
  fl2v: { firstFrame: 'lora-mode-first.png', lastFrame: 'lora-mode-last.png' },
  r2v: { referenceImages: ['lora-mode-reference.png'] },
}
for (const mode of api.MODES) {
  const family = mode === 'r2v' ? 'ref2va' : 'fl2va'
  for (const steps of [1, 4, 5, 20, 10000]) {
    const editableStepWorkflow = api.buildWorkflow({
      mode,
      prompt: 'An editable ' + steps + '-step ' + mode + ' workflow.',
      steps,
      ...modeInputs[mode],
    })
    assertWorkflowContract(
      editableStepWorkflow,
      mode === 'r2v' ? REF2VA : FL2VA,
      steps,
      mode,
    )
  }
  const loras = [provenLora({
    name: 'minimax_h3\\' + mode + '-standard.safetensors',
    strength: 0.8,
    modelFamily: family,
    kind: 'standard',
    supportedSteps: [5],
  })]
  const workflow = api.buildWorkflow({
    mode,
    prompt: 'A five-step ' + mode + ' compatibility-filter contract.',
    steps: 5,
    loras,
    ...modeInputs[mode],
  })
  assertWorkflowContract(workflow, mode === 'r2v' ? REF2VA : FL2VA, 5, mode, loras)
}

const patchTemplate5 = JSON.parse(api.getWorkflowJson({ mode: 't2v', steps: 5 }))
const patchLoras = [provenLora({
  name: 'minimax_h3\\patch-fl2va.safetensors',
  weight: 0.4,
  modelFamily: 'fl2va',
  kind: 'standard',
})]
const patchedWithLora = api.patchWorkflow(patchTemplate5, {
  mode: 't2v',
  steps: 5,
  prompt: 'A patched controlled user LoRA chain.',
  loras: patchLoras,
})
assertWorkflowContract(patchedWithLora, FL2VA, 5, 't2v', patchLoras)

const disabledLora = [provenLora({
  name: 'minimax_h3\\disabled-fl2va.safetensors',
  strength: 1,
  enabled: false,
  modelFamily: 'fl2va',
  kind: 'standard',
})]
const disabledLoraWorkflow = api.buildWorkflow({
  mode: 't2v',
  prompt: 'A disabled LoRA must not create a loader.',
  steps: 5,
  loras: disabledLora,
})
assertWorkflowContract(disabledLoraWorkflow, FL2VA, 5, 't2v', disabledLora)

const normalizedProof = hostClone(api.normalizeLoras([provenLora({
  name: 'minimax_h3/proof-retained.safetensors',
  modelFamily: 'fl2va',
  kind: 'standard',
})], 't2v', 5))
assert.equal(normalizedProof[0].fingerprint, VALID_LORA_FINGERPRINT)

for (const unsafeName of [
  '..\\escape.safetensors',
  'folder/../escape.safetensors',
  'folder/./escape.safetensors',
  'C:\\models\\escape.safetensors',
  '/absolute/escape.safetensors',
  '\\\\server\\share\\escape.safetensors',
  'folder//empty-segment.safetensors',
  'folder/not-a-safetensor.ckpt',
]) {
  assert.throws(() => api.buildWorkflow({
    mode: 't2v',
    prompt: 'Unsafe LoRA paths must not enter the workflow.',
    steps: 5,
    loras: [provenLora({ name: unsafeName, modelFamily: 'fl2va', kind: 'standard' })],
  }), /safe relative safetensors path/i, unsafeName + ' must be rejected')
}

assert.throws(() => api.buildWorkflow({
  mode: 't2v',
  prompt: 'A foreign plain filename without catalog proof must be rejected.',
  steps: 5,
  loras: [{ name: 'foreign.safetensors', modelFamily: 'fl2va', kind: 'standard' }],
}), /fingerprint is required.*catalog format/i)
assert.throws(() => api.buildWorkflow({
  mode: 't2v',
  prompt: 'A fabricated catalog proof must be rejected.',
  steps: 5,
  loras: [{
    name: 'foreign.safetensors',
    fingerprint: 'v1:12:34:not-a-real-header-hash',
    modelFamily: 'fl2va',
    kind: 'standard',
  }],
}), /fingerprint is required.*catalog format/i)

for (const [label, loras, errorPattern] of [
  ['wrong family', [provenLora({ name: 'wrong-family.safetensors', modelFamily: 'ref2va', kind: 'standard' })], /requires a fl2va LoRA/i],
  ['accelerator', [provenLora({ name: 'accelerator.safetensors', modelFamily: 'fl2va', kind: 'accelerator' })], /only supports standard/i],
  ['internal Turbo duplicate', [provenLora({ name: TURBO_LORA, modelFamily: 'fl2va', kind: 'standard' })], /internal Turbo.*cannot be added/i],
  ['unsupported steps', [provenLora({ name: 'four-only.safetensors', modelFamily: 'fl2va', kind: 'standard', supportedSteps: [4] })], /does not support 5 steps/i],
  ['negative strength', [provenLora({ name: 'negative.safetensors', strength: -0.01, modelFamily: 'fl2va', kind: 'standard' })], /strength must be between 0 and 2/i],
  ['excess strength', [provenLora({ name: 'excess.safetensors', strength: 2.01, modelFamily: 'fl2va', kind: 'standard' })], /strength must be between 0 and 2/i],
  ['duplicate names', [
    provenLora({ name: 'duplicate.safetensors', modelFamily: 'fl2va', kind: 'standard' }),
    provenLora({ name: 'DUPLICATE.safetensors', modelFamily: 'fl2va', kind: 'standard' }),
  ], /cannot be added more than once/i],
]) {
  assert.throws(() => api.buildWorkflow({
    mode: 't2v',
    prompt: 'Rejected controlled LoRA: ' + label,
    steps: 5,
    loras,
  }), errorPattern, label + ' must be rejected before workflow submission')
}

assert.throws(() => api.buildWorkflow({
  mode: 'r2v',
  prompt: '<Picture 1> rejects an FL2VA-only LoRA.',
  steps: 5,
  referenceImages: ['family-guard.png'],
  loras: [provenLora({ name: 'fl2va-only.safetensors', modelFamily: 'fl2va', kind: 'standard' })],
}), /requires a ref2va LoRA/i)

for (const [key, value] of [
  ['high', true],
  ['low', true],
  ['loraName', 'turbo.safetensors'],
  ['kj', true],
  ['sageAttention', true],
  ['teSpeed', true],
  ['negativePrompt', 'bad anatomy'],
  ['unetName', 'other.safetensors'],
  ['unetHighName', 'wan-high.safetensors'],
  ['unetLowName', 'wan-low.safetensors'],
]) {
  assert.throws(() => api.buildWorkflow({
    mode: 't2v',
    prompt: 'Rejected option test.',
    [key]: value,
  }), /not supported/i, key + ' must be rejected')
}

for (const invalidSteps of [0, -1, 1.25, 10001, Number.NaN]) {
  assert.throws(() => api.buildWorkflow({
    mode: 't2v',
    prompt: 'Rejected step count test.',
    steps: invalidSteps,
  }), /integer between 1 and 10000/i)
}

assert.throws(() => api.buildWorkflow({
  mode: 't2v',
  model: 'Wan2_2',
  prompt: 'Wrong model.',
}), /model id is fixed/i)
assert.throws(() => api.buildWorkflow({
  mode: 't2v',
  prompt: 'No image should be accepted.',
  images: ['unexpected.png'],
}), /does not accept image/i)
assert.throws(() => api.buildWorkflow({
  mode: 'i2v',
  prompt: 'Missing first frame.',
}), /requires a first frame/i)
assert.throws(() => api.buildWorkflow({
  mode: 'fl2v',
  prompt: 'Missing last frame.',
  images: ['only-first.png'],
}), /requires first and last/i)
assert.throws(() => api.buildWorkflow({
  mode: 'r2v',
  prompt: 'Too many references.',
  referenceImages: ['1.png', '2.png', '3.png', '4.png', '5.png'],
}), /at most four/i)
assert.throws(() => api.buildWorkflow({
  mode: 'r2v',
  prompt: 'No references.',
}), /requires an image, video, or audio/i)
assert.doesNotThrow(() => api.buildWorkflow({
  mode: 'r2v', prompt: 'A geometric animation follows <Audio 1>.', referenceAudio: 'standalone-only.wav',
}))

const duplicateUnet = hostClone(t2v)
duplicateUnet['99'] = hostClone(duplicateUnet['1'])
assert.throws(() => api.validateWorkflow(duplicateUnet), /exactly one UNETLoader|requires 1 UNETLoader/i)

const loraInjected = hostClone(t2v)
loraInjected['99'] = {
  class_type: 'LoraLoaderModelOnly',
  inputs: { model: ['1', 0], lora_name: 'forbidden.safetensors', strength_model: 1 },
}
assert.throws(() => api.validateWorkflow(loraInjected), /undeclared user LoRA/i)

const wrongUserLoraName = hostClone(fourStepWithLoras)
entriesByClass(wrongUserLoraName, 'LoraLoaderModelOnly')
  .find(([, value]) => value.inputs.lora_name === fl2vaLoras[0].name)[1]
  .inputs.lora_name = 'minimax_h3\\tampered-name.safetensors'
assert.throws(
  () => api.validateWorkflow(wrongUserLoraName, { mode: 't2v', steps: 4, loras: fl2vaLoras }),
  /user LoRA 1.*wrong name or strength/i,
)

const wrongUserLoraStrength = hostClone(fourStepWithLoras)
entriesByClass(wrongUserLoraStrength, 'LoraLoaderModelOnly')
  .find(([, value]) => value.inputs.lora_name === fl2vaLoras[0].name)[1]
  .inputs.strength_model = 1.5
assert.throws(
  () => api.validateWorkflow(wrongUserLoraStrength, { mode: 't2v', steps: 4, loras: fl2vaLoras }),
  /user LoRA 1.*wrong name or strength/i,
)

const wrongUserLoraOrder = hostClone(fourStepWithLoras)
const [unetChainId] = oneByClass(wrongUserLoraOrder, 'UNETLoader')
entriesByClass(wrongUserLoraOrder, 'LoraLoaderModelOnly')
  .find(([, value]) => value.inputs.lora_name === fl2vaLoras[1].name)[1]
  .inputs.model = [unetChainId, 0]
assert.throws(
  () => api.validateWorkflow(wrongUserLoraOrder, { mode: 't2v', steps: 4, loras: fl2vaLoras }),
  /invalid model-chain order/i,
)

assert.throws(
  () => api.validateWorkflow(fourStepWithLoras, {
    mode: 't2v',
    steps: 4,
    loras: [...fl2vaLoras].reverse(),
  }),
  /user LoRA 1.*wrong name or strength/i,
  'validator options.loras must lock the declared order',
)

const twentyTemplate = api.buildWorkflow({
  mode: 't2v',
  prompt: 'Twenty-step topology mutation guard.',
  steps: 20,
})
const fourWithoutExtraLora = hostClone(twentyTemplate)
oneByClass(fourWithoutExtraLora, 'BasicScheduler')[1].inputs.steps = 4
assert.equal(api.validateWorkflow(fourWithoutExtraLora), true)

const twentyWithoutExtraLora = hostClone(t2v)
oneByClass(twentyWithoutExtraLora, 'BasicScheduler')[1].inputs.steps = 20
assert.equal(api.validateWorkflow(twentyWithoutExtraLora), true)

const negativeInjected = hostClone(t2v)
oneByClass(negativeInjected, 'MiniMaxH3ImageToVideo')[1].inputs.negative_prompt = 'forbidden'
assert.throws(() => api.validateWorkflow(negativeInjected), /forbidden input/i)

const wrongR2vUnet = hostClone(r2v)
oneByClass(wrongR2vUnet, 'UNETLoader')[1].inputs.unet_name = 'wrong-model.safetensors'
assert.throws(() => api.validateWorkflow(wrongR2vUnet), /wrong UNet/i)

console.log('AI sequence MiniMax H3 workflow tests passed')
