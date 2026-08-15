const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const resolutionPath = path.resolve(__dirname, '../../particle-editor/ui-design-local-resolution.helper.js')
const modulePath = path.resolve(__dirname, '../../particle-editor/ui-design-local-refine.workflow.js')
require(resolutionPath)

function freshRequire() {
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  return globalThis.NovaFlowUiDesignLocalRefineWorkflow
}

function workflowFixture() {
  return {
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'UI', images: ['decode', 0] },
    },
    '41': {
      class_type: 'LoadImage',
      inputs: { image: 'layout-guide.png' },
      _meta: { title: 'First image' },
    },
    '83': {
      class_type: 'LoadImage',
      inputs: { image: 'style-reference.png' },
      _meta: { title: 'Second image' },
    },
    positive: {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: {
        prompt: 'Preserve the finished UI and improve material detail.',
        clip: ['clip', 0],
        vae: ['vae', 0],
        image1: ['scaled-layout', 0],
        image2: ['83', 0],
      },
      _meta: { title: 'Positive' },
    },
    negative: {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: {
        prompt: 'blurred UI',
        clip: ['clip', 0],
        vae: ['vae', 0],
        image1: ['scaled-layout', 0],
        image3: ['83', 0],
      },
      _meta: { title: 'Negative' },
    },
    encode: {
      class_type: 'VAEEncode',
      inputs: { pixels: ['scaled-layout', 0], vae: ['vae', 0] },
    },
    sampler: {
      class_type: 'KSampler',
      inputs: {
        seed: 7,
        steps: 4,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 0.58,
        model: ['model-switch', 0],
        positive: ['positive', 0],
        negative: ['negative', 0],
        latent_image: ['old-latent', 0],
      },
    },
    lightning: {
      class_type: 'PrimitiveBoolean',
      inputs: { value: true },
      _meta: { title: 'Enable 4steps LoRA?' },
    },
    decode: {
      class_type: 'VAEDecode',
      inputs: { samples: ['sampler', 0], vae: ['vae', 0] },
    },
  }
}

test('polish makes the first-pass result the first image condition and sampling latent', () => {
  const api = freshRequire()
  const original = workflowFixture()
  const result = api.build({
    taskProfile: 'ui-design-refine',
    localWorkflow: original,
    firstResultName: 'first-pass-result.png',
  })

  assert.notEqual(result.workflow, original)
  assert.equal(original['41'].inputs.image, 'layout-guide.png', 'input workflow must remain immutable')
  assert.equal(result.workflow['41'].inputs.image, 'first-pass-result.png')
  assert.deepEqual(result.workflow.positive.inputs.image1, ['41', 0])
  assert.deepEqual(result.workflow.negative.inputs.image1, ['41', 0])
  assert.equal('image2' in result.workflow.positive.inputs, false)
  assert.equal('image3' in result.workflow.negative.inputs, false)
  assert.deepEqual(result.workflow.encode.inputs.pixels, ['41', 0])
  assert.deepEqual(result.workflow.sampler.inputs.latent_image, ['encode', 0])
  assert.equal(result.workflow.sampler.inputs.steps, 20)
  assert.equal(result.workflow.sampler.inputs.cfg, 4)
  assert.equal(result.workflow.sampler.inputs.sampler_name, 'euler')
  assert.equal(result.workflow.sampler.inputs.scheduler, 'simple')
  assert.equal(result.workflow.sampler.inputs.denoise, 0.35)
  assert.equal(result.workflow.lightning.inputs.value, false)
  assert.equal(result.workflow.decode.class_type, 'VAEDecode')
  assert.equal(result.preset, 'polish')
  assert.equal(result.metadata.taskProfile, 'ui-design-refine')
  assert.equal(result.metadata.firstLoadImageNodeId, '41')
  assert.equal(result.metadata.firstVaeEncodeNodeId, 'encode')
  assert.equal(result.metadata.textEncoderCount, 2)
  assert.equal(result.metadata.lightningToggleCount, 1)
  assert.equal(result.metadata.resolution.outputScaleNodeIds.length, 0)
  assert.equal(result.metadata.resolution.sharpenNodeIds.length, 1)
  const sharpenId = result.metadata.resolution.sharpenNodeIds[0]
  assert.deepEqual(result.workflow[sharpenId].inputs, {
    image: ['decode', 0],
    sharpen_radius: 1,
    sigma: 0.8,
    alpha: 0.15,
  })
  assert.deepEqual(result.workflow['9'].inputs.images, [sharpenId, 0])
})

test('polish accepts a configured denoise and clamps it to the valid sampler range', () => {
  const api = freshRequire()
  const low = api.build({
    taskProfile: api.TASK_PROFILE,
    localWorkflow: workflowFixture(),
    uploadedNames: ['result-low.png'],
    denoise: -5,
  })
  const high = api.build({
    taskProfile: api.TASK_PROFILE,
    localWorkflow: workflowFixture(),
    resultImageName: 'result-high.png',
    denoise: 9,
  })
  const configured = api.build({
    taskProfile: api.TASK_PROFILE,
    localWorkflow: workflowFixture(),
    baseImageName: 'result-configured.png',
    denoise: 0.42,
  })

  assert.equal(low.sampling.denoise, api.MIN_DENOISE)
  assert.equal(high.sampling.denoise, api.MAX_DENOISE)
  assert.equal(configured.sampling.denoise, 0.42)
  assert.equal(low.workflow['41'].inputs.image, 'result-low.png')
  assert.equal(high.workflow['41'].inputs.image, 'result-high.png')
  assert.equal(configured.workflow['41'].inputs.image, 'result-configured.png')
})

test('enhanced redraw uses the theme-agnostic controlled-denoise BF16 preset', () => {
  const api = freshRequire()
  for (const alias of ['enhanced-redraw', 'enhanced_redraw', 'enhanced', 'redraw']) {
    const result = api.build({
      taskProfile: api.TASK_PROFILE,
      localWorkflow: workflowFixture(),
      firstResultName: 'first-pass.png',
      preset: alias,
    })
    assert.equal(result.preset, 'enhanced-redraw')
    assert.deepEqual(result.sampling, {
      preset: 'enhanced-redraw',
      steps: 40,
      cfg: 4,
      samplerName: 'euler',
      scheduler: 'simple',
      denoise: 0.55,
      lightning: false,
    })
    assert.equal(result.workflow.lightning.inputs.value, false)
  }
})

test('1080x1920 refinement samples its VAE at 720x1280 and finishes at the requested size', () => {
  const api = freshRequire()
  const result = api.build({
    taskProfile: api.TASK_PROFILE,
    localWorkflow: workflowFixture(),
    firstResultName: 'first-pass.png',
    state: { width: 1080, height: 1920 },
  })

  assert.equal(result.sampling.steps, 20)
  assert.equal(result.sampling.cfg, 4)
  assert.equal(result.sampling.lightning, false)
  assert.equal(result.metadata.resolution.mode, 'img2img')
  assert.deepEqual(result.metadata.resolution.requested, { width: 1080, height: 1920 })
  assert.deepEqual(result.metadata.resolution.working, { width: 720, height: 1280 })
  const workingId = result.metadata.resolution.workingScaleNodeIds[0]
  const outputId = result.metadata.resolution.outputScaleNodeIds[0]
  const sharpenId = result.metadata.resolution.sharpenNodeIds[0]
  assert.deepEqual(result.workflow.encode.inputs.pixels, [workingId, 0])
  assert.deepEqual(result.workflow[workingId].inputs, {
    image: ['41', 0],
    upscale_method: 'lanczos',
    width: 720,
    height: 1280,
    crop: 'disabled',
  })
  assert.deepEqual(result.workflow[outputId].inputs, {
    image: ['decode', 0],
    upscale_method: 'lanczos',
    width: 1080,
    height: 1920,
    crop: 'disabled',
  })
  assert.deepEqual(result.workflow[sharpenId].inputs, {
    image: [outputId, 0],
    sharpen_radius: 1,
    sigma: 0.8,
    alpha: 0.6,
  })
  assert.deepEqual(result.workflow['9'].inputs.images, [sharpenId, 0])
})

test('semantic repair mask limits both latent sampling and final pixels while text sees only the candidate', () => {
  const api = freshRequire()
  const result = api.build({
    taskProfile: api.TASK_PROFILE,
    localWorkflow: workflowFixture(),
    uploadedNames: ['candidate.png', 'repair-mask.png'],
    state: {
      width: 1080,
      height: 1920,
      localUiRepairMaskEncoding: api.REPAIR_MASK_ENCODING,
    },
  })

  const ids = result.metadata.repairMaskNodeIds
  assert.equal(result.metadata.maskedRepair, true)
  assert.equal(result.metadata.repairMaskEncoding, 'semantic-repair-mask-v1')
  assert.equal(result.workflow['83'].inputs.image, 'repair-mask.png')
  assert.deepEqual(result.workflow.positive.inputs.image1, ['41', 0])
  assert.equal('image2' in result.workflow.positive.inputs, false)
  assert.equal('image3' in result.workflow.negative.inputs, false)
  assert.deepEqual(result.workflow[ids.workingScaleNodeId].inputs, {
    image: ['83', 0],
    upscale_method: 'bilinear',
    width: 720,
    height: 1280,
    crop: 'disabled',
  })
  assert.equal(result.workflow[ids.workingMaskNodeId].class_type, 'ImageToMask')
  assert.deepEqual(result.workflow[ids.latentMaskNodeId].inputs, {
    samples: ['encode', 0],
    mask: [ids.workingMaskNodeId, 0],
  })
  assert.deepEqual(result.workflow.sampler.inputs.latent_image, [ids.latentMaskNodeId, 0])
  assert.deepEqual(result.workflow[ids.requestedScaleNodeId].inputs, {
    image: ['83', 0],
    upscale_method: 'bilinear',
    width: 1080,
    height: 1920,
    crop: 'disabled',
  })
  assert.equal(result.workflow[ids.requestedMaskNodeId].class_type, 'ImageToMask')
  assert.equal(ids.compositeNodeIds.length, 1)
  const composite = result.workflow[ids.compositeNodeIds[0]]
  assert.deepEqual(composite.inputs.destination, ['41', 0])
  assert.deepEqual(composite.inputs.source, [result.metadata.resolution.sharpenNodeIds[0], 0])
  assert.deepEqual(composite.inputs.mask, [ids.requestedMaskNodeId, 0])
  assert.deepEqual(result.workflow['9'].inputs.images, [ids.compositeNodeIds[0], 0])
})

test('mask uploads do not alter ordinary refinement without the semantic mask encoding', () => {
  const api = freshRequire()
  const result = api.build({
    taskProfile: api.TASK_PROFILE,
    localWorkflow: workflowFixture(),
    uploadedNames: ['candidate.png', 'ignored-mask.png'],
    state: { width: 720, height: 1280 },
  })

  assert.equal(result.metadata.maskedRepair, false)
  assert.equal(result.metadata.repairMaskEncoding, '')
  assert.equal(result.workflow['83'].inputs.image, 'style-reference.png')
  assert.deepEqual(result.workflow.sampler.inputs.latent_image, ['encode', 0])
  assert.deepEqual(
    result.workflow['9'].inputs.images,
    [result.metadata.resolution.sharpenNodeIds[0], 0],
  )
})

test('semantic repair mask fails closed when output dimensions are unavailable', () => {
  const api = freshRequire()
  assert.throws(() => api.build({
    taskProfile: api.TASK_PROFILE,
    localWorkflow: workflowFixture(),
    uploadedNames: ['candidate.png', 'repair-mask.png'],
    state: { localUiRepairMaskEncoding: api.REPAIR_MASK_ENCODING },
  }), /reliable working\/output dimensions/)
})

test('rapid NSFW refinement uses its model-family preset without requiring a Lightning switch', () => {
  const api = freshRequire()
  const workflow = workflowFixture()
  delete workflow.lightning
  const result = api.build({
    taskProfile: api.TASK_PROFILE,
    localWorkflow: workflow,
    firstResultName: 'rapid-first-pass.png',
    preset: 'polish',
    nsfw: true,
  })

  assert.equal(result.metadata.modelFamily, 'rapid')
  assert.equal(result.metadata.lightningToggleCount, 0)
  assert.deepEqual(result.sampling, {
    preset: 'polish',
    steps: 6,
    cfg: 1,
    samplerName: 'euler_ancestral',
    scheduler: 'beta',
    denoise: 0.35,
    lightning: false,
  })
  assert.equal(result.workflow.sampler.inputs.steps, 6)
  assert.equal(result.workflow.sampler.inputs.cfg, 1)
  assert.equal(result.workflow.sampler.inputs.sampler_name, 'euler_ancestral')
  assert.equal(result.workflow.sampler.inputs.scheduler, 'beta')
})

test('refinement rejects the wrong task profile and incomplete local workflows', () => {
  const api = freshRequire()
  assert.throws(() => api.build({
    taskProfile: 'ui-design',
    localWorkflow: workflowFixture(),
  }), /taskProfile=ui-design-refine/)
  assert.throws(() => api.build({
    taskProfile: api.TASK_PROFILE,
    localWorkflow: null,
  }), /valid localWorkflow/)

  const required = [
    [['41', '83'], /LoadImage/],
    [['positive', 'negative'], /TextEncodeQwenImageEditPlus/],
    [['encode'], /VAEEncode/],
    [['sampler'], /KSampler/],
    [['lightning'], /Enable 4 Step/],
  ]
  required.forEach(([nodeIds, pattern]) => {
    const workflow = workflowFixture()
    nodeIds.forEach((nodeId) => delete workflow[nodeId])
    assert.throws(() => api.build({
      taskProfile: api.TASK_PROFILE,
      localWorkflow: workflow,
      firstResultName: 'first-pass.png',
    }), pattern)
  })
})

test('the first existing LoadImage remains the canonical result source when no override is supplied', () => {
  const api = freshRequire()
  const workflow = workflowFixture()
  workflow['41'].inputs.image = 'already-uploaded-first-pass.png'
  const result = api.build({
    taskProfile: api.TASK_PROFILE,
    localWorkflow: workflow,
  })

  assert.equal(result.metadata.firstResultImageName, 'already-uploaded-first-pass.png')
  assert.deepEqual(result.workflow.positive.inputs.image1, ['41', 0])
  assert.deepEqual(result.workflow.encode.inputs.pixels, ['41', 0])
  assert.deepEqual(result.workflow.sampler.inputs.latent_image, ['encode', 0])
})
