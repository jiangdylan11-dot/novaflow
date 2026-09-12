(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowArtGenerateModels = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function capability(referenceLimit, fields, negativePrompt) {
    return Object.freeze({
      referenceLimit,
      fields: Object.freeze(fields.slice()),
      negativePrompt,
    })
  }

  const CAPABILITIES = Object.freeze({
    local: Object.freeze({
      txt2img: capability(0, ['width', 'height', 'textQuality', 'seed', 'nsfw'], true),
      img2img: capability(3, ['width', 'height', 'editStrength', 'seed', 'nsfw'], true),
    }),
    gpt: Object.freeze({
      txt2img: capability(0, ['quality', 'size'], false),
      img2img: capability(3, ['quality', 'size'], false),
    }),
    google: Object.freeze({
      txt2img: capability(0, ['aspectRatio'], false),
      img2img: capability(3, ['aspectRatio', 'resolution'], false),
    }),
  })

  const LOCAL_IDEOGRAM_TEXT_CAPABILITY = capability(
    0,
    ['width', 'height', 'instantQuality', 'seed', 'nsfw'],
    false,
  )

  const providerOptions = Object.freeze([
    Object.freeze({ value: 'local', label: '本地模型' }),
    Object.freeze({ value: 'gpt', label: 'GPT' }),
    Object.freeze({ value: 'google', label: 'Google' }),
  ])

  const LOCAL_TEXT_QUALITY_OPTIONS = Object.freeze([
    Object.freeze({ value: 'fast', label: '\u5feb\u901f' }),
    Object.freeze({ value: 'fine', label: '\u7cbe\u7ec6' }),
  ])

  const LOCAL_EDIT_STRENGTH_OPTIONS = Object.freeze([
    Object.freeze({ value: 'faithful', label: '\u4fdd\u771f' }),
    Object.freeze({ value: 'enhanced', label: '\u589e\u5f3a' }),
  ])

  function preset(steps, cfg, samplerName, scheduler, lightning) {
    const value = {
      steps,
      cfg,
      samplerName,
      scheduler,
      denoise: 1,
    }
    if (typeof lightning === 'boolean') value.lightning = lightning
    return Object.freeze(value)
  }

  const LOCAL_WORKFLOW_PRESETS = Object.freeze({
    txt2img: Object.freeze({
      standard: Object.freeze({
        fast: preset(4, 1, 'euler', 'simple', true),
        fine: preset(25, 4, 'euler', 'simple', false),
      }),
      rapid: Object.freeze({
        fast: preset(4, 1, 'euler_ancestral', 'beta', false),
        fine: preset(6, 1, 'euler_ancestral', 'beta', false),
      }),
    }),
    img2img: Object.freeze({
      standard: Object.freeze({
        faithful: preset(4, 1, 'euler', 'simple', true),
        enhanced: preset(12, 4, 'euler', 'simple', false),
      }),
      rapid: Object.freeze({
        faithful: preset(4, 1, 'euler_ancestral', 'beta', false),
        enhanced: preset(6, 1, 'euler_ancestral', 'beta', false),
      }),
    }),
  })

  function normalizeLocalTextQuality(value) {
    return String(value || '').trim().toLowerCase() === 'fast' ? 'fast' : 'fine'
  }

  function normalizeLocalEditStrength(value) {
    return String(value || '').trim().toLowerCase() === 'enhanced' ? 'enhanced' : 'faithful'
  }

  function getCapability(provider, mode) {
    const providerKey = String(provider || '').trim().toLowerCase()
    const modeKey = String(mode || '').trim().toLowerCase()
    return CAPABILITIES[providerKey]?.[modeKey] || null
  }

  function normalizeProvider(value) {
    const provider = String(value || '').trim().toLowerCase()
    return provider === 'gpt' || provider === 'google' ? provider : 'local'
  }

  function normalizeMode(value) {
    return String(value || '').trim().toLowerCase() === 'img2img' ? 'img2img' : 'txt2img'
  }

  function providerTitle(value) {
    const provider = normalizeProvider(value)
    if (provider === 'gpt') return 'GPT'
    if (provider === 'google') return 'Google'
    return '\u672c\u5730\u6a21\u578b'
  }

  function renderKey(state) {
    const provider = normalizeProvider(state?.provider)
    const mode = normalizeMode(state?.mode)
    const route = provider === 'local' && mode === 'txt2img'
      ? (state?.nsfw === true ? 'rapid' : 'ideogram-instant')
      : ''
    return `${provider}:${mode}:${route}`
  }

  function capabilityFor(provider, mode, state) {
    const providerKey = normalizeProvider(provider)
    const modeKey = normalizeMode(mode)
    if (providerKey === 'local' && modeKey === 'txt2img' && state?.nsfw !== true) {
      return LOCAL_IDEOGRAM_TEXT_CAPABILITY
    }
    return getCapability(providerKey, modeKey) || {
      referenceLimit: modeKey === 'img2img' ? 3 : 0,
      fields: providerKey === 'local'
        ? (modeKey === 'img2img'
          ? ['width', 'height', 'editStrength', 'seed', 'nsfw']
          : ['width', 'height', 'textQuality', 'seed', 'nsfw'])
        : [],
      negativePrompt: providerKey === 'local',
    }
  }

  function localPresetFor(state, mode) {
    const source = state && typeof state === 'object' ? state : {}
    const modeKey = normalizeMode(mode || source.mode)
    const familyKey = modeKey === 'img2img' || source.nsfw ? 'rapid' : 'standard'
    const selection = modeKey === 'img2img'
      ? normalizeLocalEditStrength(source.localEditStrength)
      : normalizeLocalTextQuality(source.localTextQuality)
    return LOCAL_WORKFLOW_PRESETS[modeKey][familyKey][selection]
  }

  function isLightningToggle(node) {
    if (String(node?.class_type || '') !== 'PrimitiveBoolean') return false
    const title = String(node?._meta?.title || '')
      .trim()
      .toLowerCase()
      .replace(/[?\uff1f]/g, '')
      .replace(/step\(s\)/g, 'steps')
      .replace(/\s+/g, '')
    return title === 'enable4steplora' || title === 'enable4stepslora'
  }

  function applyLocalWorkflowPreset(workflow, state, mode) {
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
      throw new TypeError('\u672c\u5730\u751f\u6210\u5de5\u4f5c\u6d41\u65e0\u6548')
    }
    const source = state && typeof state === 'object' ? state : {}
    const selectedPreset = localPresetFor(source, mode)
    const nodes = Object.values(workflow)
    const samplers = nodes.filter((node) => String(node?.class_type || '') === 'KSampler' && node?.inputs && typeof node.inputs === 'object')
    if (!samplers.length) throw new Error('\u672c\u5730\u751f\u6210\u5de5\u4f5c\u6d41\u7f3a\u5c11 KSampler \u8282\u70b9')

    const rapidFamily = normalizeMode(mode || source.mode) === 'img2img' || source.nsfw
    const lightningToggles = rapidFamily ? [] : nodes.filter(isLightningToggle)
    if (!rapidFamily && !lightningToggles.length) {
      throw new Error('\u672c\u5730\u751f\u6210\u5de5\u4f5c\u6d41\u7f3a\u5c11 Enable 4 Step(s) LoRA \u5f00\u5173')
    }

    samplers.forEach((node) => {
      node.inputs.steps = selectedPreset.steps
      node.inputs.cfg = selectedPreset.cfg
      node.inputs.sampler_name = selectedPreset.samplerName
      node.inputs.scheduler = selectedPreset.scheduler
      node.inputs.denoise = selectedPreset.denoise
    })
    lightningToggles.forEach((node) => {
      node.inputs.value = selectedPreset.lightning
    })
    return workflow
  }

  function workflowSettings(state, provider, mode) {
    const providerKey = normalizeProvider(provider)
    const modeKey = normalizeMode(mode)
    if (providerKey === 'gpt') {
      return {
        quality: modeKey === 'img2img' ? state.gptQualityImg2img : state.gptQualityTxt2img,
        size: state.gptSize,
        customWidth: state.gptCustomWidth,
        customHeight: state.gptCustomHeight,
        background: 'auto',
      }
    }
    if (providerKey === 'google') {
      return {
        aspectRatio: modeKey === 'img2img' ? state.googleAspectRatioImg2img : state.googleAspectRatioTxt2img,
        resolution: state.googleResolution,
      }
    }
    if (modeKey === 'txt2img' && state?.nsfw !== true) return { textQuality: 'instant' }
    return modeKey === 'img2img'
      ? { editStrength: normalizeLocalEditStrength(state.localEditStrength) }
      : { textQuality: normalizeLocalTextQuality(state.localTextQuality) }
  }

  return Object.freeze({
    providerOptions,
    LOCAL_TEXT_QUALITY_OPTIONS,
    LOCAL_EDIT_STRENGTH_OPTIONS,
    getCapability,
    normalizeProvider,
    normalizeMode,
    providerTitle,
    renderKey,
    capabilityFor,
    normalizeLocalTextQuality,
    normalizeLocalEditStrength,
    localPresetFor,
    applyLocalWorkflowPreset,
    workflowSettings,
  })
})
