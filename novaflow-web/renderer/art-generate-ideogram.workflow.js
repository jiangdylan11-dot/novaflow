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

  // The structured prompt's `background` must never be empty: with it blank the model drops the
  // scene on a large share of seeds (measured 4 of 8: grey plates, black plates, and the
  // "Image blocked by safety filter" placeholder it learned from its API distillation). Filling it
  // with the prompt's own scene sentence restored the room on 4 of those 5 seeds; repeating the whole
  // description restored it on 4 of 4, while a generic phrase only rescued 2 of 4.
  const BACKGROUND_LABEL_RE = /(?:场景与背景|场景|背景|环境)(?:设定|描述)?\s*[：:]\s*([^。\n；;]+)/
  const BACKGROUND_WORD_RE = /(背景|场景|环境|室内|室外|房间|卧室|客厅|教室|办公室|厨房|走廊|庭院|花园|公园|街道|街头|城市|乡村|森林|山|海|湖|河|沙滩|天空|草原|沙漠|雪地|废墟|洞穴|神殿|寺庙|城堡|宫殿|舞台|田野|夜晚|黄昏|清晨|夕阳|星空|地板|地面|纸门|门|窗|墙|屋顶|榻榻米|桌|椅|灯光|光线|阳光|月光|树|樱花|花|草|云|雨|雪|雾|建筑|楼|桥|道路|background|scene|environment|room|street|forest|city|sky|beach|indoor|outdoor|landscape|castle|temple|night|sunset|floor|wall|window|door|tree|light)/i
  const SUBJECT_WORD_RE = /(少女|少年|女孩|男孩|女性|男性|人物|角色|英雄|主体包括|character|girl|boy|woman|man|hero)/i
  const SECTION_NAMES = ['风格设定', '主体物品', '环境背景', '光线与色彩', '拍摄参数']
  const SECTION_SPLIT_RE = /(?:^|\n)[ \t]*[[【](风格设定|主体物品|环境背景|光线与色彩|拍摄参数)[\]】]/

  // The AI 助手's five-section prompt ([风格设定][主体物品][环境背景][光线与色彩][拍摄参数]) as
  // { 环境背景, ..., text: the same prose without the headers }, or null when a header is missing.
  function readSections(prompt) {
    const parts = prompt.split(SECTION_SPLIT_RE)
    const sections = {}
    for (let index = 1; index < parts.length; index += 2) {
      sections[parts[index]] = [sections[parts[index]], parts[index + 1].trim()].filter(Boolean).join('\n')
    }
    if (!SECTION_NAMES.every((name) => name in sections)) return null
    sections.text = parts.filter((_, index) => index % 2 === 0).join('\n')
      .split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
    return sections
  }

  function extractBackground(value) {
    const source = String(value == null ? '' : value).trim()
    // A five-section prompt has its background written out: the [环境背景] body, no headers.
    const sections = readSections(source)
    if (sections && sections['环境背景']) return sections['环境背景']
    const prompt = sections ? sections.text : source
    const labelled = prompt.match(BACKGROUND_LABEL_RE)
    if (labelled && labelled[1].trim()) return labelled[1].trim().slice(0, 160)
    // Free-form prompts: keep the scene clauses, but not ones that also describe the subject,
    // or the character would be painted a second time as part of the background.
    const clauses = prompt.split(/[。；;\n]+/).map((clause) => clause.trim())
      .filter((clause) => clause && BACKGROUND_WORD_RE.test(clause) && !SUBJECT_WORD_RE.test(clause))
    if (clauses.length) return clauses.join('，').slice(0, 160)
    // Nothing scene-like to quote: the whole description is a better background than an empty
    // field or a generic phrase (no duplicated figure showed up on any tested seed).
    return prompt
  }

  function compileStructuredPrompt(value) {
    const prompt = normalizePrompt(value)
    const sections = readSections(prompt)
    return JSON.stringify({
      high_level_description: sections ? sections.text : prompt,
      compositional_deconstruction: {
        background: extractBackground(prompt),
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
    extractBackground,
    compileStructuredPrompt,
    clone: cloneWorkflow,
    cloneWorkflow,
    build,
    buildWorkflow: build,
  })
})
