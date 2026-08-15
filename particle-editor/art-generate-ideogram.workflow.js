(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowArtGenerateIdeogramWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const VERSION = '20260813-ideogram4-instant-1'
  const MODEL_KEY = 'ideogram4-instant'
  const UNET_NAME = 'Fal_Ideo_4_NSFW-int8_convrot.safetensors'
  const CLIP_NAME = 'qwen3vl_8b_nvfp4.safetensors'
  const VAE_NAME = 'flux2-vae.safetensors'
  const DEFAULT_WIDTH = 720
  const DEFAULT_HEIGHT = 1280
  const DEFAULT_SEED = 402421902939803
  const DEFAULT_OUTPUT_PREFIX = 'NovaFlow_Ideogram4'
  const PROMPT_NODE_ID = '167'
  const OUTPUT_NODE_ID = '241'

  const REQUIRED_NODE_TYPES = Object.freeze([
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

  const REQUIRED_MODELS = Object.freeze({
    unet: UNET_NAME,
    clip: CLIP_NAME,
    vae: VAE_NAME,
  })

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
    Object.values(value).forEach(deepFreeze)
    return Object.freeze(value)
  }

  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue)
    if (!value || typeof value !== 'object') return value
    const output = {}
    Object.entries(value).forEach(([key, item]) => {
      output[key] = cloneValue(item)
    })
    return output
  }

  const WORKFLOW_TEMPLATE = deepFreeze({
    '167': {
      inputs: {
        text: '',
        clip: ['243', 0],
      },
      class_type: 'CLIPTextEncode',
      _meta: { title: 'Ideogram 4 Structured Prompt' },
    },
    '198': {
      inputs: {
        shift: 5.25,
        model: ['219', 0],
      },
      class_type: 'ModelSamplingAuraFlow',
      _meta: { title: 'Model Sampling AuraFlow' },
    },
    '219': {
      inputs: {
        unet_name: UNET_NAME,
        weight_dtype: 'default',
      },
      class_type: 'UNETLoader',
      _meta: { title: 'Ideogram 4 UNet' },
    },
    '230': {
      inputs: {
        conditioning: ['167', 0],
      },
      class_type: 'ConditioningZeroOut',
      _meta: { title: 'Zero Negative Conditioning' },
    },
    '235': {
      inputs: {
        seed: DEFAULT_SEED,
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
    },
    '240': {
      inputs: {
        samples: ['235', 0],
        vae: ['244', 0],
      },
      class_type: 'VAEDecode',
      _meta: { title: 'Decode Ideogram Image' },
    },
    '241': {
      inputs: {
        filename_prefix: DEFAULT_OUTPUT_PREFIX,
        images: ['240', 0],
      },
      class_type: 'SaveImage',
      _meta: { title: 'NovaFlow Ideogram Output' },
    },
    '243': {
      inputs: {
        clip_name: CLIP_NAME,
        type: 'ideogram4',
        device: 'default',
      },
      class_type: 'CLIPLoader',
      _meta: { title: 'Qwen3-VL Text Encoder' },
    },
    '244': {
      inputs: {
        vae_name: VAE_NAME,
      },
      class_type: 'VAELoader',
      _meta: { title: 'Flux 2 VAE' },
    },
    '247': {
      inputs: {
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        batch_size: 1,
      },
      class_type: 'EmptyFlux2LatentImage',
      _meta: { title: 'Empty Flux 2 Latent Image' },
    },
  })

  function cloneWorkflow() {
    return cloneValue(WORKFLOW_TEMPLATE)
  }

  function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null)
  }

  function normalizePrompt(value) {
    const prompt = String(value == null ? '' : value).trim()
    if (!prompt) throw new Error('Ideogram workflow requires a non-empty positive prompt')
    return prompt
  }

  function compileStructuredPrompt(value) {
    const prompt = normalizePrompt(value)
    return JSON.stringify({
      high_level_description: prompt,
      compositional_deconstruction: {
        background: '',
        elements: [],
      },
    })
  }

  function normalizeDimension(value, fallback) {
    const parsed = Number(value)
    const finite = Number.isFinite(parsed) ? parsed : fallback
    return Math.max(64, Math.min(16384, Math.round(finite / 16) * 16))
  }

  function normalizeSeed(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return DEFAULT_SEED
    return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(parsed)))
  }

  function normalizeOutputPrefix(value) {
    return String(value == null ? '' : value).trim() || DEFAULT_OUTPUT_PREFIX
  }

  function build(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('Ideogram workflow options must be an object')
    }
    const state = options.state && typeof options.state === 'object' && !Array.isArray(options.state)
      ? options.state
      : {}
    const prompt = normalizePrompt(firstDefined(options.prompt, options.positivePrompt, state.prompt, ''))
    const structuredPrompt = compileStructuredPrompt(prompt)
    const width = normalizeDimension(firstDefined(options.width, state.width), DEFAULT_WIDTH)
    const height = normalizeDimension(firstDefined(options.height, state.height), DEFAULT_HEIGHT)
    const seed = normalizeSeed(firstDefined(options.seed, state.seed))
    const outputPrefix = normalizeOutputPrefix(firstDefined(options.outputPrefix, state.outputPrefix))
    const workflow = cloneWorkflow()

    workflow[PROMPT_NODE_ID].inputs.text = structuredPrompt
    workflow['247'].inputs.width = width
    workflow['247'].inputs.height = height
    workflow['235'].inputs.seed = seed
    workflow[OUTPUT_NODE_ID].inputs.filename_prefix = outputPrefix

    return Object.freeze({
      workflow,
      modelKey: MODEL_KEY,
      promptNodeId: PROMPT_NODE_ID,
      outputNodeId: OUTPUT_NODE_ID,
      outputNodeIds: Object.freeze([OUTPUT_NODE_ID]),
      metadata: Object.freeze({
        version: VERSION,
        modelKey: MODEL_KEY,
        width,
        height,
        seed,
        outputPrefix,
        structuredPrompt,
        negativePromptSupported: false,
        sampling: Object.freeze({
          steps: 8,
          cfg: 1,
          samplerName: 'euler',
          scheduler: 'simple',
          denoise: 1,
          shift: 5.25,
        }),
      }),
    })
  }

  return Object.freeze({
    VERSION,
    MODEL_KEY,
    UNET_NAME,
    CLIP_NAME,
    VAE_NAME,
    DEFAULT_WIDTH,
    DEFAULT_HEIGHT,
    DEFAULT_SEED,
    DEFAULT_OUTPUT_PREFIX,
    PROMPT_NODE_ID,
    OUTPUT_NODE_ID,
    REQUIRED_NODE_TYPES,
    REQUIRED_MODELS,
    compileStructuredPrompt,
    clone: cloneWorkflow,
    cloneWorkflow,
    build,
    buildWorkflow: build,
  })
})
