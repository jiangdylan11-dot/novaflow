(function (root, factory) {
  const api = factory()
  root.NovaFlowSplitInpaintNsfwWorkflow = api
  if (typeof module === 'object' && module && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const CHECKPOINT_NAME = 'Qwen-Rapid-AIO-NSFW-v20.safetensors'
  const GUIDE_ALPHA_THRESHOLD = 128
  const REQUIRED_NODE_TYPES = Object.freeze([
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
  const NEGATIVE_PROMPT = [
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

  function requiredText(options, key) {
    const value = String(options && options[key] || '').trim()
    if (!value) throw new Error(`${key} is required for the NSFW inpaint workflow`)
    return value
  }

  function checkpointChoices(nodeInfo) {
    const inputs = nodeInfo && nodeInfo.input
    const definition = inputs && (
      inputs.required && inputs.required.ckpt_name
      || inputs.optional && inputs.optional.ckpt_name
    )
    if (!Array.isArray(definition)) return []
    const values = Array.isArray(definition[0]) ? definition[0] : definition
    return values.filter((value) => typeof value === 'string')
  }

  function assertRuntimeSupport(runtimeInfo) {
    if (!runtimeInfo || typeof runtimeInfo !== 'object') {
      throw new Error('NSFW inpaint Runtime object_info is unavailable')
    }
    for (const nodeType of REQUIRED_NODE_TYPES) {
      if (!runtimeInfo[nodeType]) {
        throw new Error(`NSFW inpaint Runtime is missing required node: ${nodeType}`)
      }
    }
    const choices = checkpointChoices(runtimeInfo.CheckpointLoaderSimple)
    if (!choices.includes(CHECKPOINT_NAME)) {
      throw new Error(`NSFW inpaint Runtime does not provide checkpoint: ${CHECKPOINT_NAME}`)
    }
    return { checkpointName: CHECKPOINT_NAME }
  }

  function normalizeMode(mode) {
    const normalized = String(mode || '').trim().toLowerCase()
    if (normalized !== 'edit' && normalized !== 'completion') {
      throw new Error('NSFW inpaint workflow mode must be edit or completion')
    }
    return normalized
  }

  function normalizeSeed(seed) {
    const numeric = Number(seed)
    if (Number.isFinite(numeric) && numeric >= 0) return Math.trunc(numeric)
    return Math.floor(Math.random() * 1_000_000_000)
  }

  function analyzeSourceGuideAlpha(alphaStats) {
    const stats = alphaStats && typeof alphaStats === 'object' ? alphaStats : {}
    const alphaThreshold = Number(stats.alphaThreshold)
    const total = Number(stats.total)
    const visible = Number(stats.visible)
    const transparent = Number(stats.transparent)
    const bboxWidth = Number(stats.bboxWidth)
    const bboxHeight = Number(stats.bboxHeight)
    if (
      alphaThreshold !== GUIDE_ALPHA_THRESHOLD
      || !Number.isInteger(total) || total < 1
      || !Number.isInteger(visible) || visible < 0 || visible > total
      || !Number.isInteger(transparent) || transparent < 0 || transparent > total
      || visible + transparent !== total
      || !Number.isInteger(bboxWidth) || bboxWidth < 0
      || !Number.isInteger(bboxHeight) || bboxHeight < 0
    ) {
      throw new Error(`alphaStats must use the NSFW source guide alpha threshold ${GUIDE_ALPHA_THRESHOLD} and contain complete pixel counts`)
    }
    const bboxArea = bboxWidth * bboxHeight
    if ((visible > 0 && (!bboxArea || visible > bboxArea)) || bboxArea > total) {
      throw new Error('alphaStats must contain a valid NSFW source guide bounding box')
    }
    const bboxFillRatio = bboxArea ? visible / bboxArea : 0
    return {
      total,
      visible,
      transparent,
      bboxFillRatio,
      hasSubjectSilhouette: visible >= 16 && transparent > 0 && bboxFillRatio <= 0.995,
    }
  }

  function assertPreparedSourceGuide(alphaStats) {
    const analysis = analyzeSourceGuideAlpha(alphaStats)
    if (analysis.visible < 16) {
      throw new Error('NSFW source guide must contain at least 16 visible pixels')
    }
    if (!analysis.hasSubjectSilhouette) {
      throw new Error('NSFW source guide must contain a non-rectangular subject silhouette')
    }
    return {
      visible: analysis.visible,
      transparent: analysis.transparent,
      bboxFillRatio: analysis.bboxFillRatio,
    }
  }

  function resolveSubjectJoinPolicy(mode, shortEdge) {
    const normalizedMode = normalizeMode(mode)
    const edge = Number(shortEdge)
    if (!Number.isFinite(edge) || edge <= 0) {
      throw new Error('shortEdge must be a positive number for the NSFW subject join policy')
    }
    return {
      ringWidth: normalizedMode === 'completion'
        ? Math.round(Math.max(16, Math.min(32, edge * 0.0625)))
        : 4,
      guideAlphaThreshold: GUIDE_ALPHA_THRESHOLD,
      falloffExponent: normalizedMode === 'completion' ? 0.5 : 1,
      restoreAlpha: true,
    }
  }

  async function prepareSourceGuide(options) {
    const request = options && typeof options === 'object' ? options : {}
    const sourceDataUrl = requiredText(request, 'sourceDataUrl')
    const analysis = analyzeSourceGuideAlpha(request.alphaStats)
    if (analysis.visible < 16) {
      throw new Error('NSFW source guide must contain at least 16 visible pixels')
    }
    if (analysis.hasSubjectSilhouette) {
      return { dataUrl: sourceDataUrl, backgroundRemoved: false }
    }
    if (typeof request.removeBackground !== 'function') {
      throw new Error('removeBackground is required when the NSFW source guide has no valid subject silhouette')
    }
    const dataUrl = String(await request.removeBackground(sourceDataUrl) || '').trim()
    if (!dataUrl) throw new Error('NSFW source guide background removal returned no image')
    return { dataUrl, backgroundRemoved: true }
  }

  function positivePrompt(mode, prompt) {
    if (mode === 'completion') {
      return [
        'The first image is the editable image crop.',
        'The white region represented by the supplied mask is the missing area to complete; black pixels must remain unchanged.',
        'Infer the missing adult subject structure from the surrounding image and connect it naturally with consistent anatomy, materials, lighting, color, perspective, and art style.',
        `User request: ${prompt}`,
      ].join(' ')
    }
    return [
      'The first image is the editable image crop.',
      'The white region represented by the supplied mask is the only area to modify; black pixels must remain unchanged.',
      'Apply the requested edit to the adult subject while preserving surrounding identity, anatomy, composition, lighting, perspective, and art style.',
      `User request: ${prompt}`,
    ].join(' ')
  }

  function buildWorkflow(options) {
    const request = options && typeof options === 'object' ? options : {}
    const runtime = assertRuntimeSupport(request.runtimeInfo)
    const mode = normalizeMode(request.mode)
    const imageName = requiredText(request, 'imageName')
    const maskName = requiredText(request, 'maskName')
    const prefix = requiredText(request, 'prefix')
    const prompt = requiredText(request, 'prompt')
    const seed = normalizeSeed(request.seed)

    return {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: runtime.checkpointName },
      },
      '5': {
        class_type: 'LoadImage',
        inputs: { image: imageName },
      },
      '6': {
        class_type: 'LoadImage',
        inputs: { image: maskName },
      },
      '7': {
        class_type: 'ImageToMask',
        inputs: { image: ['6', 0], channel: 'red' },
      },
      '8': {
        class_type: 'TextEncodeQwenImageEditPlus',
        inputs: {
          clip: ['1', 1],
          vae: ['1', 2],
          image1: ['5', 0],
          prompt: positivePrompt(mode, prompt),
        },
      },
      '9': {
        class_type: 'TextEncodeQwenImageEdit',
        inputs: {
          clip: ['1', 1],
          prompt: NEGATIVE_PROMPT,
        },
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
          seed,
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
      '12': {
        class_type: 'VAEDecode',
        inputs: { samples: ['11', 0], vae: ['1', 2] },
      },
      '13': {
        class_type: 'SaveImage',
        inputs: { images: ['12', 0], filename_prefix: prefix },
      },
    }
  }

  return Object.freeze({
    CHECKPOINT_NAME,
    REQUIRED_NODE_TYPES,
    normalizeMode,
    assertRuntimeSupport,
    assertPreparedSourceGuide,
    resolveSubjectJoinPolicy,
    prepareSourceGuide,
    buildWorkflow,
  })
})
