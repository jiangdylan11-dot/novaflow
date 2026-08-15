const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const workflowPath = path.resolve(__dirname, '../../particle-editor/split-inpaint-nsfw.workflow.js')
let loadNonce = 0

async function loadWorkflow() {
  loadNonce += 1
  await import(`${pathToFileURL(workflowPath).href}?test=${loadNonce}`)
  return globalThis.NovaFlowSplitInpaintNsfwWorkflow
}

function runtimeInfo(checkpoints = ['Qwen-Rapid-AIO-NSFW-v20.safetensors']) {
  const info = {}
  for (const name of [
    'LoadImage',
    'ImageToMask',
    'TextEncodeQwenImageEditPlus',
    'TextEncodeQwenImageEdit',
    'InpaintModelConditioning',
    'KSampler',
    'VAEDecode',
    'SaveImage',
  ]) info[name] = { input: { required: {} } }
  info.CheckpointLoaderSimple = {
    input: {
      required: {
        ckpt_name: [checkpoints, {}],
      },
    },
  }
  return info
}

const EXPECTED_NEGATIVE_PROMPT = [
  'minor',
  'child',
  'underage',
  'teenager',
  'young-looking person',
  'childlike face',
  'childlike body',
  'loli',
  'shota',
  'age ambiguity',
  'low quality',
  'blurry',
  'distorted anatomy',
  'extra limbs',
  'text',
  'watermark',
].join(', ')

function expectedRapidWorkflow(mode) {
  const imageName = `${mode}-source.png`
  const maskName = `${mode}-mask.png`
  const prefix = `novaflow_nsfw_${mode}`
  const request = `${mode} the selected adult character detail`
  const positivePrompt = mode === 'completion'
    ? [
        'The first image is the editable image crop.',
        'The white region represented by the supplied mask is the missing area to complete; black pixels must remain unchanged.',
        'Infer the missing adult subject structure from the surrounding image and connect it naturally with consistent anatomy, materials, lighting, color, perspective, and art style.',
        `User request: ${request}`,
      ].join(' ')
    : [
        'The first image is the editable image crop.',
        'The white region represented by the supplied mask is the only area to modify; black pixels must remain unchanged.',
        'Apply the requested edit to the adult subject while preserving surrounding identity, anatomy, composition, lighting, perspective, and art style.',
        `User request: ${request}`,
      ].join(' ')
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'Qwen-Rapid-AIO-NSFW-v20.safetensors' },
    },
    '5': { class_type: 'LoadImage', inputs: { image: imageName } },
    '6': { class_type: 'LoadImage', inputs: { image: maskName } },
    '7': { class_type: 'ImageToMask', inputs: { image: ['6', 0], channel: 'red' } },
    '8': {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: {
        clip: ['1', 1],
        vae: ['1', 2],
        image1: ['5', 0],
        prompt: positivePrompt,
      },
    },
    '9': {
      class_type: 'TextEncodeQwenImageEdit',
      inputs: { clip: ['1', 1], prompt: EXPECTED_NEGATIVE_PROMPT },
    },
    '10': {
      class_type: 'InpaintModelConditioning',
      inputs: {
        positive: ['8', 0],
        negative: ['9', 0],
        vae: ['1', 2],
        pixels: ['5', 0],
        mask: ['7', 0],
        noise_mask: true,
      },
    },
    '11': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        seed: 123456789,
        steps: 16,
        cfg: 3.6,
        sampler_name: 'euler',
        scheduler: 'simple',
        positive: ['10', 0],
        negative: ['10', 1],
        latent_image: ['10', 2],
        denoise: 1,
      },
    },
    '12': { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['1', 2] } },
    '13': { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: prefix } },
  }
}

function nodeByType(workflow, classType) {
  const entries = Object.entries(workflow).filter(([, node]) => node.class_type === classType)
  assert.equal(entries.length, 1, `expected one ${classType} node`)
  return entries[0]
}

test('module exposes the exact checkpoint and validates live Runtime support without fallback', async () => {
  const api = await loadWorkflow()
  assert.ok(api)
  assert.equal(api.CHECKPOINT_NAME, 'Qwen-Rapid-AIO-NSFW-v20.safetensors')
  assert.equal(api.normalizeMode(' EDIT '), 'edit')
  assert.equal(api.normalizeMode('Completion'), 'completion')
  assert.throws(() => api.normalizeMode('repair'), /edit.*completion/i)
  assert.deepEqual(api.REQUIRED_NODE_TYPES, [
    'CheckpointLoaderSimple',
    'LoadImage',
    'ImageToMask',
    'TextEncodeQwenImageEditPlus',
    'TextEncodeQwenImageEdit',
    'InpaintModelConditioning',
    'KSampler',
    'VAEDecode',
    'SaveImage',
  ])
  assert.deepEqual(api.assertRuntimeSupport(runtimeInfo()), {
    checkpointName: api.CHECKPOINT_NAME,
  })
  assert.throws(
    () => api.assertRuntimeSupport(runtimeInfo(['another-model.safetensors'])),
    /Qwen-Rapid-AIO-NSFW-v20\.safetensors/,
  )
  const missing = runtimeInfo()
  delete missing.InpaintModelConditioning
  assert.throws(() => api.assertRuntimeSupport(missing), /InpaintModelConditioning/)
})

test('workflow builder rejects incomplete or unsupported requests', async () => {
  const api = await loadWorkflow()
  const base = {
    runtimeInfo: runtimeInfo(),
    mode: 'edit',
    imageName: 'source.png',
    maskName: 'mask.png',
    prefix: 'novaflow_nsfw_edit',
    prompt: 'replace the selected fabric',
  }
  for (const key of ['imageName', 'maskName', 'prefix', 'prompt']) {
    assert.throws(() => api.buildWorkflow({ ...base, [key]: '' }), new RegExp(key, 'i'))
  }
  assert.throws(() => api.buildWorkflow({ ...base, mode: 'repair' }), /edit.*completion/i)
})

test('source guide reuses real source alpha and never calls background removal', async () => {
  const api = await loadWorkflow()
  let removalCalls = 0
  const result = await api.prepareSourceGuide({
    sourceDataUrl: 'data:image/png;base64,transparent-source',
    alphaStats: {
      alphaThreshold: 128,
      total: 262144,
      visible: 110000,
      transparent: 152144,
      bboxWidth: 300,
      bboxHeight: 400,
    },
    removeBackground: async () => {
      removalCalls += 1
      return 'data:image/png;base64,unexpected'
    },
  })

  assert.deepEqual(result, {
    dataUrl: 'data:image/png;base64,transparent-source',
    backgroundRemoved: false,
  })
  assert.equal(removalCalls, 0)
})

test('source guide removes a white-backed rectangle even when the outer crop is transparent', async () => {
  const api = await loadWorkflow()
  let removalCalls = 0
  const result = await api.prepareSourceGuide({
    sourceDataUrl: 'data:image/png;base64,transparent-margin-opaque-rectangle',
    alphaStats: {
      alphaThreshold: 128,
      total: 512 * 512,
      visible: 400 * 400,
      transparent: 512 * 512 - 400 * 400,
      bboxWidth: 400,
      bboxHeight: 400,
    },
    removeBackground: async () => {
      removalCalls += 1
      return 'data:image/png;base64,rectangle-with-background-removed'
    },
  })

  assert.deepEqual(result, {
    dataUrl: 'data:image/png;base64,rectangle-with-background-removed',
    backgroundRemoved: true,
  })
  assert.equal(removalCalls, 1)
})

test('source guide accepts a small irregular cutout by absolute pixels instead of canvas ratio', async () => {
  const api = await loadWorkflow()
  let removalCalls = 0
  const stats = {
    alphaThreshold: 128,
    total: 512 * 512,
    visible: 1200,
    transparent: 512 * 512 - 1200,
    bboxWidth: 40,
    bboxHeight: 40,
    whiteRatio: 1,
  }
  const analysis = api.assertPreparedSourceGuide(stats)
  const result = await api.prepareSourceGuide({
    sourceDataUrl: 'data:image/png;base64,small-irregular-cutout',
    alphaStats: stats,
    removeBackground: async () => {
      removalCalls += 1
      return 'data:image/png;base64,unexpected'
    },
  })

  assert.equal(analysis.visible, 1200)
  assert.equal(analysis.bboxFillRatio, 0.75)
  assert.deepEqual(result, {
    dataUrl: 'data:image/png;base64,small-irregular-cutout',
    backgroundRemoved: false,
  })
  assert.equal(removalCalls, 0)
})

test('source guide locks the 0.995 bounding-box fill boundary', async () => {
  const api = await loadWorkflow()
  assert.deepEqual(api.assertPreparedSourceGuide({
    alphaThreshold: 128,
    total: 201,
    visible: 199,
    transparent: 2,
    bboxWidth: 20,
    bboxHeight: 10,
  }), {
    visible: 199,
    transparent: 2,
    bboxFillRatio: 0.995,
  })
  assert.throws(() => api.assertPreparedSourceGuide({
    alphaThreshold: 128,
    total: 251,
    visible: 249,
    transparent: 2,
    bboxWidth: 25,
    bboxHeight: 10,
  }), /subject silhouette/i)
})

test('source guide removes an opaque background once and fails closed on invalid preparation', async () => {
  const api = await loadWorkflow()
  let removalCalls = 0
  const result = await api.prepareSourceGuide({
    sourceDataUrl: 'data:image/png;base64,opaque-source',
    alphaStats: {
      alphaThreshold: 128,
      total: 512 * 512,
      visible: 512 * 512,
      transparent: 0,
      bboxWidth: 512,
      bboxHeight: 512,
    },
    removeBackground: async (dataUrl) => {
      removalCalls += 1
      assert.equal(dataUrl, 'data:image/png;base64,opaque-source')
      return 'data:image/png;base64,subject-guide'
    },
  })

  assert.deepEqual(result, {
    dataUrl: 'data:image/png;base64,subject-guide',
    backgroundRemoved: true,
  })
  assert.equal(removalCalls, 1)
  await assert.rejects(() => api.prepareSourceGuide({
    sourceDataUrl: '',
    alphaStats: { alphaThreshold: 128, total: 16, visible: 16, transparent: 0, bboxWidth: 4, bboxHeight: 4 },
    removeBackground: async () => 'unused',
  }), /sourceDataUrl/i)
  await assert.rejects(() => api.prepareSourceGuide({
    sourceDataUrl: 'data:image/png;base64,opaque-source',
    alphaStats: { alphaThreshold: 128, total: 16, visible: 16, transparent: 0, bboxWidth: 4, bboxHeight: 4 },
  }), /removeBackground/i)
  await assert.rejects(() => api.prepareSourceGuide({
    sourceDataUrl: 'data:image/png;base64,opaque-source',
    alphaStats: { alphaThreshold: 128, total: 16, visible: 16, transparent: 0, bboxWidth: 4, bboxHeight: 4 },
    removeBackground: async () => '',
  }), /background removal/i)
  assert.throws(() => api.assertPreparedSourceGuide({
    alphaThreshold: 128,
    total: 512 * 512,
    visible: 400 * 400,
    transparent: 512 * 512 - 400 * 400,
    bboxWidth: 400,
    bboxHeight: 400,
  }), /subject silhouette/i)
  assert.throws(() => api.assertPreparedSourceGuide({
    alphaThreshold: 128,
    total: 512 * 512,
    visible: 15,
    transparent: 512 * 512 - 15,
    bboxWidth: 5,
    bboxHeight: 4,
  }), /visible pixels/i)
  assert.throws(() => api.assertPreparedSourceGuide({
    alphaThreshold: 64,
    total: 512 * 512,
    visible: 1200,
    transparent: 512 * 512 - 1200,
    bboxWidth: 40,
    bboxHeight: 40,
  }), /alpha threshold/i)
})

test('workflow owns the edit and completion subject-join policy', async () => {
  const api = await loadWorkflow()
  assert.deepEqual(api.resolveSubjectJoinPolicy('edit', 512), {
    ringWidth: 4,
    guideAlphaThreshold: 128,
    falloffExponent: 1,
    restoreAlpha: true,
  })
  assert.deepEqual(api.resolveSubjectJoinPolicy('completion', 128), {
    ringWidth: 16,
    guideAlphaThreshold: 128,
    falloffExponent: 0.5,
    restoreAlpha: true,
  })
  assert.deepEqual(api.resolveSubjectJoinPolicy('completion', 512), {
    ringWidth: 32,
    guideAlphaThreshold: 128,
    falloffExponent: 0.5,
    restoreAlpha: true,
  })
  assert.deepEqual(api.resolveSubjectJoinPolicy('completion', 392), {
    ringWidth: 25,
    guideAlphaThreshold: 128,
    falloffExponent: 0.5,
    restoreAlpha: true,
  })
  assert.deepEqual(api.resolveSubjectJoinPolicy('completion', 4096), {
    ringWidth: 32,
    guideAlphaThreshold: 128,
    falloffExponent: 0.5,
    restoreAlpha: true,
  })
  assert.throws(() => api.resolveSubjectJoinPolicy('completion', 0), /shortEdge/i)
})

for (const mode of ['edit', 'completion']) {
  test(`${mode} builds the proven Rapid AIO masked workflow`, async () => {
    const api = await loadWorkflow()
    const workflow = api.buildWorkflow({
      runtimeInfo: runtimeInfo(),
      mode,
      imageName: `${mode}-source.png`,
      maskName: `${mode}-mask.png`,
      prefix: `novaflow_nsfw_${mode}`,
      prompt: `${mode} the selected adult character detail`,
      seed: 123456789,
    })

    assert.deepEqual(workflow, expectedRapidWorkflow(mode), 'the proven prompt, graph, mask wiring, and sampler must remain exact')
  })
}
