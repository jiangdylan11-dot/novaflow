const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const modulePath = path.resolve(__dirname, '../../particle-editor/art-generate-ideogram.workflow.js')
require(modulePath)
const ideogram = globalThis.NovaFlowArtGenerateIdeogramWorkflow

const STANDARD_NODE_TYPES = new Set([
  'CLIPTextEncode',
  'ModelSamplingAuraFlow',
  'UNETLoader',
  'ConditioningZeroOut',
  'KSampler',
  'VAEDecode',
  'SaveImage',
  'CLIPLoader',
  'VAELoader',
  'EmptyFlux2LatentImage',
])

function nodeTypes(workflow) {
  return Object.values(workflow).map((node) => node.class_type)
}

test('exports a frozen browser-global API using the shared workflow module wrapper', () => {
  assert.equal(globalThis.NovaFlowArtGenerateIdeogramWorkflow, ideogram)
  assert.equal(Object.isFrozen(ideogram), true)
  assert.equal(ideogram.MODEL_KEY, 'ideogram4-instant')
  assert.deepEqual(ideogram.REQUIRED_MODELS, {
    unet: 'Fal_Ideo_4_NSFW-int8_convrot.safetensors',
    clip: 'qwen3vl_8b_nvfp4.safetensors',
    vae: 'flux2-vae.safetensors',
  })
})

test('clone returns an isolated standard-node graph without optional LoRA or custom nodes', () => {
  const first = ideogram.clone()
  const second = ideogram.cloneWorkflow()
  const types = nodeTypes(first)

  assert.notEqual(first, second)
  assert.deepEqual(
    Object.keys(first).sort(),
    ['167', '198', '219', '230', '235', '240', '241', '243', '244', '247'].sort(),
  )
  assert.deepEqual(new Set(types), STANDARD_NODE_TYPES)
  types.forEach((type) => assert.ok(STANDARD_NODE_TYPES.has(type), `${type} must be a standard runtime node`))
  assert.equal(types.includes('Ideogram4PromptBuilderKJ'), false)
  assert.equal(types.includes('StarSampler'), false)
  assert.equal(types.includes('FantasticLoraLoader'), false)
  assert.equal(types.includes('PreviewAny'), false)
  assert.equal(types.includes('PreviewImage'), false)
  assert.deepEqual(first['198'].inputs.model, ['219', 0], 'UNet must feed AuraFlow directly')
  assert.deepEqual(first['241'], {
    inputs: {
      filename_prefix: 'NovaFlow_Ideogram4',
      images: ['240', 0],
    },
    class_type: 'SaveImage',
    _meta: { title: 'NovaFlow Ideogram Output' },
  })

  const serialized = JSON.stringify(first)
  assert.doesNotMatch(serialized, /large breasts|thot_shot|photography|FantasticLoraLoader/i)
  assert.doesNotMatch(serialized, /qwen_image_2512|Qwen-Image-2512-Lightning/i)

  first['235'].inputs.steps = 99
  first['247'].inputs.width = 64
  assert.equal(second['235'].inputs.steps, 8)
  assert.equal(second['247'].inputs.width, 720)
})

test('compiles the user text to neutral compact Ideogram 4 structured JSON', () => {
  const text = 'A finished fantasy inventory interface\nwith readable labels.'
  const compiled = ideogram.compileStructuredPrompt(`  ${text}  `)
  assert.equal(compiled.includes('\n'), false, 'compact JSON must not contain literal line breaks')
  assert.deepEqual(JSON.parse(compiled), {
    high_level_description: text,
    compositional_deconstruction: {
      background: text,
      elements: [],
    },
  })
  assert.doesNotMatch(compiled, /style_description|photo|photography|breasts/i)
})

test('the structured background field is never empty: scene sentence, scene clauses, or the whole description', () => {
  // Smart-AI style prompt: the labelled 场景 segment is the background.
  assert.equal(
    ideogram.extractBackground('主体包括一名猫耳少女，蓝眼睛。姿态与动作：坐姿。场景：背景为日式房间。光色与氛围：光线为自然光。'),
    '背景为日式房间'
  )
  assert.equal(ideogram.extractBackground('背景：雪山脚下的木屋，黄昏'), '雪山脚下的木屋，黄昏')
  // Free-form prompt: scene clauses are kept, clauses that also describe the subject are not
  // (the character would otherwise be painted again as part of the background).
  assert.equal(ideogram.extractBackground('一名少女坐在日式房间里。木地板与纸门，自然光。'), '木地板与纸门，自然光')
  assert.equal(ideogram.extractBackground('一名少女坐在日式房间里。'), '一名少女坐在日式房间里。')
  assert.equal(ideogram.extractBackground('A finished fantasy inventory interface'), 'A finished fantasy inventory interface')
  const compiled = JSON.parse(ideogram.compileStructuredPrompt('少女站在樱花树下。场景：春日公园。'))
  assert.equal(compiled.compositional_deconstruction.background, '春日公园')
})

test('build injects structured prompt, aligned dimensions, seed, and output prefix while preserving sampling', () => {
  const result = ideogram.build({
    prompt: '  A finished fantasy inventory interface\nwith readable labels.  ',
    width: 1079,
    height: 1818,
    seed: 123456789,
    outputPrefix: '  NovaFlow_Test_Ideogram  ',
  })
  const workflow = result.workflow
  const parsedPrompt = JSON.parse(workflow['167'].inputs.text)

  assert.equal(parsedPrompt.high_level_description, 'A finished fantasy inventory interface\nwith readable labels.')
  assert.deepEqual(parsedPrompt.compositional_deconstruction, { background: 'A finished fantasy inventory interface\nwith readable labels.', elements: [] })
  assert.equal(workflow['247'].inputs.width, 1072)
  assert.equal(workflow['247'].inputs.height, 1824)
  assert.equal(workflow['235'].inputs.seed, 123456789)
  assert.equal(workflow['241'].inputs.filename_prefix, 'NovaFlow_Test_Ideogram')
  assert.deepEqual(workflow['235'], {
    inputs: {
      seed: 123456789,
      steps: 8,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
      model: ['198', 0],
      positive: ['167', 0],
      negative: ['230', 0],
      latent_image: ['247', 0],
    },
    class_type: 'KSampler',
    _meta: { title: 'Ideogram 4 Sampler' },
  })
  assert.deepEqual(workflow['240'].inputs, { samples: ['235', 0], vae: ['244', 0] })
  assert.equal(result.modelKey, 'ideogram4-instant')
  assert.equal(result.promptNodeId, '167')
  assert.equal(result.outputNodeId, '241')
  assert.deepEqual(result.outputNodeIds, ['241'])
  assert.deepEqual(result.metadata.sampling, {
    steps: 8,
    cfg: 1,
    samplerName: 'euler',
    scheduler: 'simple',
    denoise: 1,
    shift: 5.25,
  })
  assert.equal(result.metadata.negativePromptSupported, false)
})

test('build accepts runtime state fallbacks and never mutates a prior build', () => {
  const first = ideogram.build({
    prompt: 'first prompt',
    width: 720,
    height: 1280,
    seed: 1,
  })
  const second = ideogram.buildWorkflow({
    state: {
      prompt: 'second prompt',
      width: 721,
      height: 1279,
      seed: 2,
      outputPrefix: 'State_Output',
    },
  })

  assert.equal(JSON.parse(first.workflow['167'].inputs.text).high_level_description, 'first prompt')
  assert.equal(first.workflow['235'].inputs.seed, 1)
  assert.equal(JSON.parse(second.workflow['167'].inputs.text).high_level_description, 'second prompt')
  assert.equal(second.workflow['247'].inputs.width, 720)
  assert.equal(second.workflow['247'].inputs.height, 1280)
  assert.equal(second.workflow['235'].inputs.seed, 2)
  assert.equal(second.workflow['241'].inputs.filename_prefix, 'State_Output')
})

test('every graph connection resolves and invalid build requests fail closed', () => {
  const workflow = ideogram.clone()
  Object.entries(workflow).forEach(([nodeId, node]) => {
    Object.entries(node.inputs || {}).forEach(([inputName, value]) => {
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string') return
      assert.ok(workflow[value[0]], `${nodeId}.${inputName} references missing node ${value[0]}`)
      assert.equal(Number.isInteger(value[1]), true)
    })
  })

  assert.throws(() => ideogram.build(), /non-empty positive prompt/)
  assert.throws(() => ideogram.build([]), /options must be an object/)
  assert.throws(() => ideogram.compileStructuredPrompt('   '), /non-empty positive prompt/)
})
