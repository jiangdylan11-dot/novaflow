const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const resolutionPath = path.resolve(__dirname, '../../particle-editor/ui-design-local-resolution.helper.js')
const workflowPath = path.resolve(__dirname, '../../particle-editor/ui-design-local.workflow.js')
const FULLSCREEN_DIGITAL_UI_CONTRACT = '整张画布即单一原生数字界面，画面边界与界面视口完全重合，连续背景延伸到四边，全部可见内容均为同一正视屏幕平面内的浅层二维软件图形'
require(resolutionPath)
require(workflowPath)
const localUi = globalThis.NovaFlowUiDesignLocalWorkflow

function localWorkflowFixture() {
  return {
    layoutGuide: {
      class_type: 'LoadImage',
      inputs: { image: 'layout-guide.png' },
    },
    layoutReference: {
      class_type: 'LoadImage',
      inputs: { image: 'layout-reference.png' },
    },
    styleReference: {
      class_type: 'LoadImage',
      inputs: { image: 'style-reference.png' },
    },
    positive: {
      class_type: 'TextEncodeQwenImageEditPlus',
      inputs: {
        image1: ['layoutGuide', 0],
        image2: ['layoutReference', 0],
        image3: ['styleReference', 0],
        prompt: 'positive prompt',
      },
      _meta: { title: 'Input Prompt' },
    },
    encode: {
      class_type: 'VAEEncode',
      inputs: {
        pixels: ['layoutGuide', 0],
        vae: ['vae', 0],
      },
    },
    detachedEncode: {
      class_type: 'VAEEncode',
      inputs: {
        pixels: ['layoutGuide', 0],
        vae: ['vae', 0],
      },
    },
    sampler: {
      class_type: 'KSampler',
      inputs: {
        seed: 42,
        steps: ['steps-switch', 0],
        cfg: ['cfg-switch', 0],
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 0.6,
        latent_image: ['encode', 0],
      },
    },
    unet: {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: 'qwen_image_edit_2511_bf16.safetensors',
        weight_dtype: 'default',
      },
    },
    lora: {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        lora_name: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
        strength_model: 1,
        model: ['unet', 0],
      },
    },
    lightning: {
      class_type: 'PrimitiveBoolean',
      inputs: { value: true },
      _meta: { title: 'Enable 4 Step(s) LoRA?' },
    },
    untouched: {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: 'NovaFlow_UI',
        images: ['decode', 0],
      },
    },
    decode: {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['sampler', 0],
        vae: ['vae', 0],
      },
    },
  }
}

function validOptions(overrides = {}) {
  return {
    taskProfile: 'ui-design',
    referenceRoles: [
      { index: 0, role: 'ui_layout', name: 'layout.png' },
      { index: 1, role: 'style', name: 'style.png' },
    ],
    layoutGuideEncoding: 'soft-ui-semantic-scaffold-v2',
    localWorkflow: localWorkflowFixture(),
    state: {},
    ...overrides,
  }
}

test('Local UI builder fails closed outside the dedicated soft-guide contract', () => {
  assert.throws(
    () => localUi.build(validOptions({ taskProfile: 'art-generate' })),
    /taskProfile=ui-design/,
  )
  assert.throws(
    () => localUi.build(validOptions({ referenceRoles: [{ role: 'reference' }] })),
    /ui_layout/,
  )
  assert.throws(
    () => localUi.build(validOptions({ layoutGuideEncoding: 'filled-regions-only' })),
    /layoutGuideEncoding=soft-ui-semantic-scaffold-v2/,
  )
  assert.throws(
    () => localUi.build(validOptions({ localWorkflow: [] })),
    /valid localWorkflow object/,
  )
  assert.throws(
    () => localUi.build(validOptions({ localWorkflow: { save: { class_type: 'SaveImage', inputs: {} } } })),
    /at least one KSampler/,
  )
})

test('redesign clones the workflow and uses the four-step Lightning structure-draft preset', () => {
  const input = localWorkflowFixture()
  const result = localUi.build(validOptions({
    localWorkflow: input,
    state: { localEditStrength: 'faithful' },
  }))

  assert.equal(localUi.VERSION, '20260729-local-ui-workflow-25')
  assert.equal(result.intent, 'redesign')
  assert.equal(result.synthesisMode, 'img2img')
  assert.deepEqual(result.sampling, {
    editStrength: 'ui-structure-draft',
    steps: 4,
    cfg: 1,
    samplerName: 'euler',
    scheduler: 'simple',
    denoise: 1,
    lightning: true,
  })
  assert.deepEqual(result.workflow.sampler.inputs, {
    seed: 42,
    steps: 4,
    cfg: 1,
    sampler_name: 'euler',
    scheduler: 'simple',
    denoise: 1,
    latent_image: ['encode', 0],
  })
  assert.equal(result.workflow.lightning.inputs.value, true)
  assert.equal(input.sampler.inputs.sampler_name, 'dpmpp_2m', 'input workflow must remain untouched')
  assert.equal(input.lightning.inputs.value, true, 'input lightning state must remain untouched')
  assert.equal(result.metadata.intent, 'redesign')
  assert.equal(result.metadata.synthesisMode, 'img2img')
  assert.equal(result.metadata.layoutGuideEncoding, 'soft-ui-semantic-scaffold-v2')
  assert.deepEqual(result.metadata.referenceRoles, ['ui_layout', 'style'])
})

test('the selected ordinary primary drives the quality latent while the semantic guide remains conditioning', () => {
  const workflow = localWorkflowFixture()
  workflow.positive.inputs.image1 = ['layoutReference', 0]
  workflow.positive.inputs.image2 = ['layoutGuide', 0]
  delete workflow.positive.inputs.image3
  const result = localUi.build(validOptions({
    localWorkflow: workflow,
    referenceRoles: [
      {
        index: 0,
        role: 'reference',
        name: 'primary-reference.png',
        autoPrimary: true,
        roleSource: 'auto-general-reference',
      },
      { index: 1, role: 'ui_layout', name: 'gaussian.png' },
    ],
    state: {
      width: 720,
      height: 1280,
      uiRunIntent: 'redesign',
      localUiQualityMode: 'quality',
    },
  }))

  assert.equal(result.metadata.latentReference.applied, true)
  assert.equal(result.metadata.latentReference.strategy, 'auto-primary-reference')
  assert.equal(result.metadata.latentReference.role, 'reference')
  assert.equal(result.metadata.latentReference.referenceIndex, 0)
  assert.equal(result.metadata.latentReference.imageNumber, 1)
  assert.equal(result.metadata.latentReference.imageSlot, 'image1')
  assert.equal(result.metadata.latentReference.sourceNodeId, 'layoutReference')
  assert.equal(result.sampling.steps, 40)
  assert.equal(result.sampling.cfg, 4)
  assert.equal(result.sampling.samplerName, 'euler')
  assert.equal(result.sampling.scheduler, 'simple')
  assert.equal(result.workflow.sampler.inputs.steps, 40)
  const latentNodeId = result.workflow.sampler.inputs.latent_image[0]
  assert.equal(result.workflow[latentNodeId].class_type, 'VAEEncode')
  const workingScaleId = result.workflow[latentNodeId].inputs.pixels[0]
  assert.equal(result.workflow[workingScaleId].class_type, 'ImageScale')
  assert.deepEqual(result.workflow[workingScaleId].inputs.image, ['layoutReference', 0])
  assert.equal(result.workflow[workingScaleId].inputs.width, 720)
  assert.equal(result.workflow[workingScaleId].inputs.height, 1280)
  assert.deepEqual(result.metadata.resolution.working, { width: 720, height: 1280 })
  assert.equal(result.metadata.resolution.maxWorkingPixels, 720 * 1280)
  assert.deepEqual(result.workflow.positive.inputs.image1, ['layoutReference', 0])
  assert.deepEqual(result.workflow.positive.inputs.image2, ['layoutGuide', 0])
  assert.equal(Object.hasOwn(result.workflow.positive.inputs, 'image3'), false)
  assert.deepEqual(result.metadata.referenceRoles, ['reference', 'ui_layout'])
})

test('an automatic ordinary primary enables the native-canvas forty-step base-model quality stage without hard-coding a theme or page type', () => {
  const workflow = localWorkflowFixture()
  workflow.unet.inputs.unet_name = 'existing-general-unet.safetensors'
  workflow.lora.inputs.lora_name = 'existing-general-lora.safetensors'
  workflow.positive.inputs.image1 = ['layoutReference', 0]
  workflow.positive.inputs.image2 = ['layoutGuide', 0]
  delete workflow.positive.inputs.image3
  const result = localUi.build(validOptions({
    localWorkflow: workflow,
    referenceRoles: [
      {
        index: 0,
        role: 'reference',
        name: 'ordinary-reference.png',
        autoPrimary: true,
        roleSource: 'auto-general-reference',
      },
      { index: 1, role: 'ui_layout', name: 'semantic-guide.png' },
    ],
    state: {
      width: 720,
      height: 1280,
      uiRunIntent: 'redesign',
    },
  }))

  assert.equal(result.metadata.qualityMode, 'quality')
  assert.equal(result.sampling.steps, 40)
  assert.equal(result.sampling.cfg, 4)
  assert.equal(result.sampling.samplerName, 'euler')
  assert.equal(result.sampling.scheduler, 'simple')
  assert.equal(result.workflow.sampler.inputs.steps, 40)
  assert.equal(result.workflow.sampler.inputs.cfg, 4)
  assert.equal(result.workflow.sampler.inputs.sampler_name, 'euler')
  assert.equal(result.workflow.sampler.inputs.scheduler, 'simple')
  assert.equal(result.metadata.latentReference.strategy, 'auto-primary-reference')
  assert.equal(result.metadata.latentReference.referenceIndex, 0)
  assert.equal(result.metadata.latentCanvas.strategy, 'auto-primary-reference')
  assert.deepEqual(result.metadata.resolution.requested, { width: 720, height: 1280 })
  assert.deepEqual(result.metadata.resolution.working, { width: 720, height: 1280 })
  assert.equal(result.workflow.unet.inputs.unet_name, 'qwen_image_edit_2511_bf16.safetensors')
  assert.equal(result.metadata.modelName, 'qwen_image_edit_2511_bf16.safetensors')
  assert.equal(result.workflow.lightning.inputs.value, false)
  assert.equal(result.workflow.lora.inputs.lora_name, 'existing-general-lora.safetensors')
  assert.equal(result.metadata.loraName, '')
})

test('an automatic-primary quality correction escalates to the native forty-step base-model pass', () => {
  const workflow = localWorkflowFixture()
  workflow.unet.inputs.unet_name = 'existing-general-unet.safetensors'
  workflow.lora.inputs.lora_name = 'existing-general-lora.safetensors'
  workflow.positive.inputs.image1 = ['layoutReference', 0]
  workflow.positive.inputs.image2 = ['layoutGuide', 0]
  delete workflow.positive.inputs.image3
  const result = localUi.build(validOptions({
    localWorkflow: workflow,
    referenceRoles: [
      {
        index: 0,
        role: 'reference',
        name: 'ordinary-reference.png',
        autoPrimary: true,
        roleSource: 'auto-general-reference',
      },
      { index: 1, role: 'ui_layout', name: 'semantic-guide.png' },
    ],
    state: {
      width: 720,
      height: 1280,
      uiRunIntent: 'redesign',
      localUiRefinePreset: 'enhanced-redraw',
    },
  }))

  assert.equal(result.metadata.qualityMode, 'quality')
  assert.equal(result.sampling.steps, 40)
  assert.equal(result.sampling.cfg, 4)
  assert.equal(result.workflow.sampler.inputs.steps, 40)
  assert.equal(result.workflow.sampler.inputs.cfg, 4)
  assert.equal(result.workflow.lightning.inputs.value, false)
  assert.equal(result.workflow.unet.inputs.unet_name, 'qwen_image_edit_2511_bf16.safetensors')
  assert.equal(result.metadata.loraName, '')
})

test('a quality setting without an automatic ordinary primary preserves the existing model family', () => {
  const workflow = localWorkflowFixture()
  workflow.unet.inputs.unet_name = 'existing-general-unet.safetensors'
  workflow.lora.inputs.lora_name = 'existing-general-lora.safetensors'
  const result = localUi.build(validOptions({
    localWorkflow: workflow,
    state: {
      width: 720,
      height: 1280,
      uiRunIntent: 'redesign',
      localUiQualityMode: 'quality',
    },
  }))

  assert.equal(result.workflow.lora.inputs.lora_name, 'existing-general-lora.safetensors')
  assert.equal(result.workflow.unet.inputs.unet_name, 'existing-general-unet.safetensors')
  assert.equal(result.workflow.sampler.inputs.steps, 4)
  assert.equal(result.workflow.sampler.inputs.cfg, 1)
  assert.equal(result.workflow.sampler.inputs.sampler_name, 'euler')
  assert.equal(result.workflow.sampler.inputs.scheduler, 'simple')
  assert.equal(result.workflow.lightning.inputs.value, true)
  assert.equal(result.metadata.qualityMode, 'performance')
  assert.equal(result.metadata.loraName, '')
  assert.equal(result.metadata.modelName, 'existing-general-unet.safetensors')
})

test('performance mode preserves the existing four-step Local UI contract', () => {
  const workflow = localWorkflowFixture()
  workflow.unet.inputs.unet_name = 'existing-performance-unet.safetensors'
  workflow.lora.inputs.lora_name = 'existing-performance-lora.safetensors'
  const result = localUi.build(validOptions({
    localWorkflow: workflow,
    state: {
      width: 720,
      height: 1280,
      uiRunIntent: 'redesign',
      localUiQualityMode: 'performance',
    },
  }))

  assert.equal(result.workflow.lora.inputs.lora_name, 'existing-performance-lora.safetensors')
  assert.equal(result.workflow.unet.inputs.unet_name, 'existing-performance-unet.safetensors')
  assert.equal(result.workflow.sampler.inputs.steps, 4)
  assert.equal(result.workflow.sampler.inputs.cfg, 1)
  assert.equal(result.workflow.sampler.inputs.sampler_name, 'euler')
  assert.equal(result.workflow.sampler.inputs.scheduler, 'simple')
  assert.equal(result.workflow.lightning.inputs.value, true)
  assert.equal(result.metadata.qualityMode, 'performance')
  assert.equal(result.metadata.loraName, '')
  assert.equal(result.metadata.modelName, 'existing-performance-unet.safetensors')
})

test('performance-mode automatic ordinary reference keeps the previous 64-percent 720x1280 canvas contract', () => {
  const workflow = localWorkflowFixture()
  workflow.positive.inputs.image1 = ['layoutReference', 0]
  workflow.positive.inputs.image2 = ['layoutGuide', 0]
  delete workflow.positive.inputs.image3
  const result = localUi.build(validOptions({
    localWorkflow: workflow,
    referenceRoles: [
      {
        index: 0,
        role: 'reference',
        name: 'ordinary-reference.png',
        autoPrimary: true,
        roleSource: 'auto-general-reference',
      },
      { index: 1, role: 'ui_layout', name: 'semantic-guide.png' },
    ],
    state: {
      width: 720,
      height: 1280,
      uiRunIntent: 'redesign',
      localUiQualityMode: 'performance',
    },
  }))

  assert.equal(result.metadata.qualityMode, 'performance')
  assert.equal(result.metadata.latentReference.strategy, 'auto-primary-reference')
  assert.deepEqual(result.metadata.resolution.working, { width: 576, height: 1024 })
  assert.equal(
    result.metadata.resolution.maxWorkingPixels,
    localUi.AUTO_PRIMARY_MAX_WORKING_PIXELS,
  )
  assert.equal(result.metadata.loraName, '')
})

test('an explicit image2 layout reference drives only the sampler latent while image1 remains Gaussian conditioning', () => {
  const source = localWorkflowFixture()
  const result = localUi.build(validOptions({
    localWorkflow: source,
    referenceRoles: [
      { index: 0, role: 'ui_layout', name: 'gaussian.png' },
      { index: 1, role: 'layout', name: 'layout.png' },
      { index: 2, role: 'style', name: 'style.png' },
    ],
    state: { width: 720, height: 1280, uiRunIntent: 'redesign' },
  }))

  assert.deepEqual(result.workflow.positive.inputs.image1, ['layoutGuide', 0])
  assert.deepEqual(result.workflow.positive.inputs.image2, ['layoutReference', 0])
  assert.deepEqual(result.workflow.positive.inputs.image3, ['styleReference', 0])
  assert.deepEqual(result.metadata.latentReference, {
    applied: true,
    strategy: 'declared-layout-reference',
    role: 'layout',
    referenceIndex: 1,
    imageNumber: 2,
    imageSlot: 'image2',
    sourceNodeId: 'layoutReference',
    sourceOutputIndex: 0,
    promptEncoderCount: 1,
    vaeEncoderCount: 1,
    fallbackReason: '',
  })
  assert.equal(result.metadata.resolution.forceWorkingImageScale, true)
  assert.equal(result.metadata.resolution.scaled, false)
  assert.deepEqual(result.metadata.resolution.requested, { width: 720, height: 1280 })
  assert.deepEqual(result.metadata.resolution.working, { width: 720, height: 1280 })
  assert.equal(result.metadata.resolution.outputScaleNodeIds.length, 0)
  assert.equal(result.metadata.resolution.sharpenNodeIds.length, 0)

  const samplerScaleId = result.workflow.encode.inputs.pixels[0]
  assert.equal(result.workflow[samplerScaleId].class_type, 'ImageScale')
  assert.deepEqual(result.workflow[samplerScaleId].inputs.image, ['layoutReference', 0])
  assert.deepEqual(result.workflow[samplerScaleId].inputs.width, 720)
  assert.deepEqual(result.workflow[samplerScaleId].inputs.height, 1280)

  const detachedScaleId = result.workflow.detachedEncode.inputs.pixels[0]
  assert.notEqual(detachedScaleId, samplerScaleId)
  assert.deepEqual(
    result.workflow[detachedScaleId].inputs.image,
    ['layoutGuide', 0],
    'VAE encoders not connected directly to KSampler must keep their original Gaussian source',
  )
  assert.deepEqual(source.encode.inputs.pixels, ['layoutGuide', 0], 'source fixture remains immutable')
})

test('a layout reference in the third image slot routes the sampler latent from image3', () => {
  const result = localUi.build(validOptions({
    referenceRoles: [
      { index: 0, role: 'ui_layout', name: 'gaussian.png' },
      { index: 1, role: 'reference', name: 'ordinary-primary.png' },
      { index: 2, role: 'layout', name: 'layout.png' },
    ],
    state: { width: 720, height: 1280, uiRunIntent: 'redesign' },
  }))

  assert.equal(result.metadata.latentReference.applied, true)
  assert.equal(result.metadata.latentReference.role, 'layout')
  assert.equal(result.metadata.latentReference.referenceIndex, 2)
  assert.equal(result.metadata.latentReference.imageSlot, 'image3')
  assert.equal(result.metadata.latentReference.sourceNodeId, 'styleReference')
  const samplerScaleId = result.workflow.encode.inputs.pixels[0]
  assert.deepEqual(result.workflow[samplerScaleId].inputs.image, ['styleReference', 0])
  assert.deepEqual(result.workflow.positive.inputs.image1, ['layoutGuide', 0])
})

test('style and character references do not automatically replace the Gaussian latent source', () => {
  const result = localUi.build(validOptions({
    referenceRoles: [
      { index: 0, role: 'ui_layout', name: 'gaussian.png' },
      { index: 1, role: 'style', name: 'style.png' },
      { index: 2, role: 'character', name: 'character.png' },
    ],
    state: { width: 720, height: 1280, uiRunIntent: 'redesign' },
  }))

  assert.deepEqual(result.workflow.encode.inputs.pixels, ['layoutGuide', 0])
  assert.equal(result.metadata.latentReference.applied, false)
  assert.equal(result.metadata.latentReference.strategy, 'workflow-default')
  assert.equal(result.metadata.latentReference.fallbackReason, 'no-explicit-layout-reference')
  assert.equal(result.metadata.resolution.forceWorkingImageScale, false)
  assert.equal(result.metadata.resolution.scaled, false)
  assert.deepEqual(result.metadata.resolution.requested, { width: 720, height: 1280 })
  assert.deepEqual(result.metadata.resolution.working, { width: 720, height: 1280 })
  assert.equal(result.metadata.resolution.workingScaleNodeIds.length, 0)
  assert.equal(result.metadata.resolution.outputScaleNodeIds.length, 0)
  assert.equal(result.metadata.resolution.sharpenNodeIds.length, 0)
})

test('iteration with ordinary references preserves the existing base latent path', () => {
  const workflow = localWorkflowFixture()
  workflow.unet.inputs.unet_name = 'existing-iteration-unet.safetensors'
  workflow.lora.inputs.lora_name = 'existing-iteration-lora.safetensors'
  const result = localUi.build(validOptions({
    localWorkflow: workflow,
    referenceRoles: [
      { index: 0, role: 'ui_layout', name: 'iteration-base.png' },
      { index: 1, role: 'reference', name: 'ordinary-a.png' },
      { index: 2, role: 'reference', name: 'ordinary-b.png' },
    ],
    state: {
      width: 720,
      height: 1280,
      uiRunIntent: 'iteration',
      localUiQualityMode: 'quality',
    },
  }))

  assert.equal(result.intent, 'iteration')
  assert.equal(result.workflow.sampler.inputs.steps, 4)
  assert.equal(result.workflow.lora.inputs.lora_name, 'existing-iteration-lora.safetensors')
  assert.equal(result.workflow.unet.inputs.unet_name, 'existing-iteration-unet.safetensors')
  assert.equal(result.metadata.loraName, '')
  assert.equal(result.metadata.latentReference.applied, false)
  assert.equal(result.metadata.latentReference.fallbackReason, 'iteration-preserves-base-image')
  assert.deepEqual(result.workflow.encode.inputs.pixels, ['layoutGuide', 0])
  assert.equal(result.metadata.resolution.forceWorkingImageScale, false)
  assert.equal(result.metadata.resolution.scaled, false)
  assert.deepEqual(result.metadata.resolution.requested, { width: 720, height: 1280 })
  assert.deepEqual(result.metadata.resolution.working, { width: 720, height: 1280 })
  assert.equal(result.metadata.resolution.workingScaleNodeIds.length, 0)
  assert.equal(result.metadata.resolution.outputScaleNodeIds.length, 0)
  assert.equal(result.metadata.resolution.sharpenNodeIds.length, 0)
})

test('conflicting positive and negative sources for the declared layout slot fall back safely', () => {
  const workflow = localWorkflowFixture()
  workflow.negative = {
    class_type: 'TextEncodeQwenImageEditPlus',
    inputs: {
      image1: ['layoutGuide', 0],
      image2: ['styleReference', 0],
      image3: ['layoutReference', 0],
      prompt: 'negative prompt',
    },
    _meta: { title: 'Negative Prompt' },
  }
  const result = localUi.build(validOptions({
    localWorkflow: workflow,
    referenceRoles: [
      { index: 0, role: 'ui_layout', name: 'gaussian.png' },
      { index: 1, role: 'layout', name: 'layout.png' },
      { index: 2, role: 'style', name: 'style.png' },
    ],
    state: { width: 720, height: 1280, uiRunIntent: 'redesign' },
  }))

  assert.equal(result.metadata.latentReference.applied, false)
  assert.equal(result.metadata.latentReference.promptEncoderCount, 2)
  assert.equal(result.metadata.latentReference.fallbackReason, 'layout-conditioning-source-ambiguous')
  assert.deepEqual(result.workflow.encode.inputs.pixels, ['layoutGuide', 0])
  assert.equal(result.metadata.resolution.forceWorkingImageScale, false)
})

test('a quality-gate structural retry stays on the safe four-step Lightning redraw preset', () => {
  const result = localUi.build(validOptions({
    state: { uiRunIntent: 'redesign', localEditStrength: 'enhanced' },
  }))

  assert.equal(result.intent, 'redesign')
  assert.deepEqual(result.sampling, {
    editStrength: 'ui-enhanced-redraw',
    steps: 4,
    cfg: 1,
    samplerName: 'euler',
    scheduler: 'simple',
    denoise: 1,
    lightning: true,
  })
  assert.equal(result.workflow.sampler.inputs.steps, 4)
  assert.equal(result.workflow.sampler.inputs.cfg, 1)
  assert.equal(result.workflow.sampler.inputs.denoise, 1)
  assert.equal(result.workflow.lightning.inputs.value, true)
})

test('iteration keeps faithful by default and honors an explicit enhanced state', () => {
  const faithful = localUi.build(validOptions({
    state: { uiRunIntent: 'iteration', localEditStrength: 'faithful' },
  }))
  assert.equal(faithful.intent, 'iteration')
  assert.equal(faithful.workflow.sampler.inputs.steps, 4)
  assert.equal(faithful.workflow.sampler.inputs.cfg, 1)
  assert.equal(faithful.workflow.lightning.inputs.value, true)

  const enhanced = localUi.build(validOptions({
    state: { iterationReferenceCount: 1, localEditStrength: 'enhanced' },
  }))
  assert.equal(enhanced.intent, 'iteration')
  assert.equal(enhanced.workflow.sampler.inputs.steps, 4)
  assert.equal(enhanced.workflow.sampler.inputs.cfg, 1)
  assert.equal(enhanced.workflow.lightning.inputs.value, true)
  assert.equal(enhanced.metadata.intent, 'iteration')
})

test('1080x1920 img2img redesign scales the soft semantic scaffold and returns a sharpened full-size image', () => {
  const workflow = localWorkflowFixture()
  const result = localUi.build(validOptions({
    localWorkflow: workflow,
    state: { width: 1080, height: 1920, uiRunIntent: 'redesign' },
  }))

  assert.equal(result.sampling.steps, 4)
  assert.equal(result.sampling.cfg, 1)
  assert.equal(result.sampling.lightning, true)
  assert.equal(result.synthesisMode, 'img2img')
  assert.equal(result.metadata.synthesisMode, 'img2img')
  assert.equal(result.metadata.resolution.mode, 'img2img')
  const workingScaleId = result.metadata.resolution.workingScaleNodeIds[0]
  assert.deepEqual(result.workflow[workingScaleId].inputs, {
    image: ['layoutGuide', 0],
    upscale_method: 'lanczos',
    width: 720,
    height: 1280,
    crop: 'disabled',
  })
  assert.deepEqual(result.workflow.encode.inputs.pixels, [workingScaleId, 0])
  assert.deepEqual(result.metadata.resolution.requested, { width: 1080, height: 1920 })
  assert.deepEqual(result.metadata.resolution.working, { width: 720, height: 1280 })
  assert.equal(result.metadata.resolution.outputScaleNodeIds.length, 1)
  assert.equal(result.metadata.resolution.sharpenNodeIds.length, 1)
})

test('1080x1920 automatic-reference quality redesign uses the composition latent and one output sharpen', () => {
  const workflow = localWorkflowFixture()
  workflow.positive.inputs.image1 = ['layoutReference', 0]
  workflow.positive.inputs.image2 = ['layoutGuide', 0]
  delete workflow.positive.inputs.image3
  const result = localUi.build(validOptions({
    localWorkflow: workflow,
    referenceRoles: [
      {
        index: 0,
        role: 'reference',
        name: 'ordinary-reference.png',
        autoPrimary: true,
        roleSource: 'auto-general-reference',
      },
      { index: 1, role: 'ui_layout', name: 'semantic-guide.png' },
    ],
    state: {
      width: 1080,
      height: 1920,
      uiRunIntent: 'redesign',
      localUiQualityMode: 'quality',
    },
  }))

  assert.equal(result.sampling.steps, 40)
  assert.equal(result.sampling.cfg, 4)
  assert.equal(result.workflow.sampler.inputs.steps, 40)
  assert.equal(result.workflow.sampler.inputs.cfg, 4)
  assert.equal(result.workflow.lightning.inputs.value, false)
  assert.equal(result.metadata.loraName, '')
  assert.deepEqual(result.metadata.resolution.requested, { width: 1080, height: 1920 })
  assert.deepEqual(result.metadata.resolution.working, { width: 720, height: 1280 })
  assert.equal(result.metadata.resolution.outputScaleNodeIds.length, 1)
  assert.equal(result.metadata.resolution.sharpenNodeIds.length, 1)
  const outputScaleId = result.metadata.resolution.outputScaleNodeIds[0]
  const sharpenId = result.metadata.resolution.sharpenNodeIds[0]
  assert.deepEqual(result.workflow[sharpenId].inputs.image, [outputScaleId, 0])
  assert.deepEqual(result.workflow.untouched.inputs.images, [sharpenId, 0])
  const latentNodeId = result.workflow.sampler.inputs.latent_image[0]
  assert.equal(result.workflow[latentNodeId].class_type, 'VAEEncode')
  const workingScaleId = result.workflow[latentNodeId].inputs.pixels[0]
  assert.equal(result.workflow[workingScaleId].class_type, 'ImageScale')
  assert.deepEqual(result.workflow[workingScaleId].inputs.image, ['layoutReference', 0])
  assert.equal(result.workflow[workingScaleId].inputs.width, 720)
  assert.equal(result.workflow[workingScaleId].inputs.height, 1280)
  assert.equal(result.metadata.latentReference.strategy, 'auto-primary-reference')
  assert.equal(result.metadata.latentReference.referenceIndex, 0)
})

test('720x1280 automatic-reference quality redesign applies native output sharpen without rescaling', () => {
  const workflow = localWorkflowFixture()
  workflow.positive.inputs.image1 = ['layoutReference', 0]
  workflow.positive.inputs.image2 = ['layoutGuide', 0]
  delete workflow.positive.inputs.image3
  const result = localUi.build(validOptions({
    localWorkflow: workflow,
    referenceRoles: [
      {
        index: 0,
        role: 'reference',
        name: 'ordinary-reference.png',
        autoPrimary: true,
        roleSource: 'auto-general-reference',
      },
      { index: 1, role: 'ui_layout', name: 'semantic-guide.png' },
    ],
    state: {
      width: 720,
      height: 1280,
      uiRunIntent: 'redesign',
      localUiQualityMode: 'quality',
    },
  }))

  assert.equal(result.sampling.steps, 40)
  assert.equal(result.metadata.resolution.scaled, false)
  assert.equal(result.metadata.resolution.forceOutputFinish, true)
  assert.equal(result.metadata.resolution.outputScaleNodeIds.length, 0)
  assert.equal(result.metadata.resolution.sharpenNodeIds.length, 1)
  const sharpenId = result.metadata.resolution.sharpenNodeIds[0]
  assert.deepEqual(result.workflow[sharpenId].inputs, {
    image: ['decode', 0],
    sharpen_radius: 1,
    sigma: 0.8,
    alpha: 0.6,
  })
  assert.deepEqual(result.workflow.untouched.inputs.images, [sharpenId, 0])
})

test('NSFW UI paths retain the rapid model-family sampler contract', () => {
  const workflow = localWorkflowFixture()
  workflow.unet.inputs.unet_name = 'existing-nsfw-unet.safetensors'
  workflow.lora.inputs.lora_name = 'existing-nsfw-lora.safetensors'
  delete workflow.lightning
  const redesign = localUi.build(validOptions({
    localWorkflow: workflow,
    state: { nsfw: true, uiRunIntent: 'redesign' },
  }))
  assert.equal(redesign.sampling.editStrength, 'ui-quality-redesign')
  assert.equal(redesign.sampling.steps, 6)
  assert.equal(redesign.sampling.cfg, 1)
  assert.equal(redesign.sampling.samplerName, 'euler_ancestral')
  assert.equal(redesign.sampling.scheduler, 'beta')
  assert.equal(redesign.sampling.lightning, false)
  assert.equal(redesign.workflow.unet.inputs.unet_name, 'existing-nsfw-unet.safetensors')
  assert.equal(redesign.workflow.lora.inputs.lora_name, 'existing-nsfw-lora.safetensors')
  assert.equal(redesign.metadata.loraName, '')

  const faithfulIteration = localUi.build(validOptions({
    localWorkflow: workflow,
    state: { nsfw: true, uiRunIntent: 'iteration', localEditStrength: 'faithful' },
  }))
  assert.equal(faithfulIteration.sampling.steps, 4)
  assert.equal(faithfulIteration.sampling.samplerName, 'euler_ancestral')
  assert.equal(faithfulIteration.workflow.unet.inputs.unet_name, 'existing-nsfw-unet.safetensors')
  assert.equal(faithfulIteration.workflow.lora.inputs.lora_name, 'existing-nsfw-lora.safetensors')
})

test('reference metadata can explicitly mark iteration without changing image order', () => {
  const options = validOptions({
    referenceRoles: [
      { index: 0, role: 'ui_layout', name: 'layout.png' },
      { index: 1, role: 'content', kind: 'iteration', name: 'base.png' },
      { index: 2, role: 'style', name: 'style.png' },
    ],
  })
  const originalOrder = options.referenceRoles.map((item) => item.name)
  const result = localUi.build(options)

  assert.equal(result.intent, 'iteration')
  assert.deepEqual(options.referenceRoles.map((item) => item.name), originalOrder)
  assert.deepEqual(result.metadata.referenceRoles, ['ui_layout', 'content', 'style'])
})

test('anti-copy prompt gives role-aware references real synthesis value without fixing a page type or theme', () => {
  const redesign = localUi.compileAntiCopyPrompt('根据用户当前需求生成高质量数字界面', validOptions())
  assert.match(redesign, /^本地UI重绘约束：/)
  assert.match(redesign, /图1仅是高斯柔性页面结构引导/)
  assert.match(redesign, /其余参考图必须按已声明职责真实参与合成/)
  assert.match(redesign, /布局参考保留主要位置、比例、分组、层级、控件关系与重复项数量/)
  assert.doesNotMatch(redesign, /There is no visual layout reference in this synthesis pass/)
  assert.doesNotMatch(redesign, /analysis-only|only for analysis|does not enter synthesis/i)
  assert.doesNotMatch(redesign, /\b(slot|casino|hero|footer|navbar)\b|Nezha|哪吒|老虎机|3\s*[x×]\s*3/i)
  assert.equal(
    redesign.includes(FULLSCREEN_DIGITAL_UI_CONTRACT),
    true,
    'every Local UI redesign prompt must positively establish a screen-native viewport',
  )
  assert.match(redesign, /根据用户当前需求生成高质量数字界面/)
  assert.match(redesign, /FINAL SCREEN-NATIVE OUTPUT:/)
  assert.match(redesign, /The image boundary equals the viewport boundary/)
  assert.match(redesign, /shallow 2D HUD layer/)
  assert.match(redesign, /same straight-on orthographic screen plane/)
  assert.equal(localUi.compileAntiCopyPrompt(redesign, validOptions()), redesign)

  const textOnly = localUi.compileAntiCopyPrompt('生成完整数字转轴游戏界面', validOptions({
    textOnly: true,
  }))
  assert.match(textOnly, /There is no visual layout reference in this synthesis pass/)
  assert.match(textOnly, new RegExp(FULLSCREEN_DIGITAL_UI_CONTRACT))
  assert.match(textOnly, /FINAL SCREEN-NATIVE OUTPUT:/)

  const explicitHardware = localUi.compileAntiCopyPrompt('展示实体机柜产品外观', validOptions({
    textOnly: true,
    carrierIntent: 'hardware',
  }))
  assert.doesNotMatch(explicitHardware, /FINAL SCREEN-NATIVE OUTPUT:/)
  assert.equal(explicitHardware.includes(FULLSCREEN_DIGITAL_UI_CONTRACT), false)

  const iteration = localUi.compileAntiCopyPrompt('只修改底部按钮', validOptions({
    state: { uiRunIntent: 'iteration' },
  }))
  assert.match(iteration, /^本地UI修改约束：/)
  assert.match(iteration, /图1是唯一修改底图/)
  assert.match(iteration, /其余图像必须按已声明的参考职责真实参与修改/)
  assert.equal(
    iteration.includes(FULLSCREEN_DIGITAL_UI_CONTRACT),
    false,
    'iteration must preserve its existing base contract instead of inheriting redesign-only framing rules',
  )
  assert.match(iteration, /只修改底部按钮$/)
})
