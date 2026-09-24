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
      img2img: capability(3, ['width', 'height', 'seed', 'nsfw'], true),
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

  // A local node with Qwen-Image-2.1 runs non-NSFW, LoRA-free drawing on it (the worker picks the
  // engine). 2.1 has no quality or edit-strength setting; its img2img takes up to 15 references (the
  // encoder has 16 inputs, as in the UI module) and keeps W / H, which a new reference 1 fills with
  // its size; the negative prompt stays (a filled one switches the run to real guidance).
  const LOCAL_QWEN21_CAPABILITIES = Object.freeze({
    txt2img: Object.freeze({ ...capability(0, ['width', 'height', 'seed', 'nsfw'], true), engine: 'qwen-2.1' }),
    img2img: Object.freeze({ ...capability(15, ['width', 'height', 'seed', 'nsfw'], true), engine: 'qwen-2.1' }),
  })

  function localQwen21Drawing(state) {
    if (state?.nsfw === true || (Array.isArray(state?.loras) && state.loras.length)) return false
    try {
      return globalThis?.electronAPI?.runtimeFeaturesSync?.()?.qwenImage21 === true
    } catch {
      return false
    }
  }

  const providerOptions = Object.freeze([
    Object.freeze({ value: 'local', label: '本地模型' }),
    Object.freeze({ value: 'gpt', label: 'GPT' }),
    Object.freeze({ value: 'google', label: 'Google' }),
  ])

  const LOCAL_TEXT_QUALITY_OPTIONS = Object.freeze([
    Object.freeze({ value: 'fast', label: '\u5feb\u901f' }),
    Object.freeze({ value: 'fine', label: '\u7cbe\u7ec6' }),
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

  // The drawing panel has no edit-strength choice. NSFW img2img (Rapid AIO) runs its 4-step preset;
  // the 2511 route (a LoRA run) samples fully (12 steps, cfg 4, no Lightning) only when a negative
  // prompt is filled in, since at cfg 1 the negative is never evaluated - the rule Qwen-Image-2.1
  // follows. UI design keeps its own setting.
  function drawingEditStrength(state, negativePrompt) {
    if (state?.nsfw === true) return 'faithful'
    return String(negativePrompt || '').trim() ? 'enhanced' : 'faithful'
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
    const route = provider === 'local' && localQwen21Drawing(state)
      ? 'qwen-2.1'
      : provider === 'local' && mode === 'txt2img'
        ? (state?.nsfw === true ? 'rapid' : 'ideogram-instant')
        : ''
    return `${provider}:${mode}:${route}`
  }

  function capabilityFor(provider, mode, state) {
    const providerKey = normalizeProvider(provider)
    const modeKey = normalizeMode(mode)
    if (providerKey === 'local' && localQwen21Drawing(state)) return LOCAL_QWEN21_CAPABILITIES[modeKey]
    if (providerKey === 'local' && modeKey === 'txt2img' && state?.nsfw !== true) {
      return LOCAL_IDEOGRAM_TEXT_CAPABILITY
    }
    return getCapability(providerKey, modeKey) || {
      referenceLimit: modeKey === 'img2img' ? 3 : 0,
      fields: providerKey === 'local'
        ? (modeKey === 'img2img'
          ? ['width', 'height', 'seed', 'nsfw']
          : ['width', 'height', 'textQuality', 'seed', 'nsfw'])
        : [],
      negativePrompt: providerKey === 'local',
    }
  }

  function localPresetFor(state, mode) {
    const source = state && typeof state === 'object' ? state : {}
    const modeKey = normalizeMode(mode || source.mode)
    const familyKey = source.nsfw ? 'rapid' : 'standard'
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

    const lightningToggles = source.nsfw ? [] : nodes.filter(isLightningToggle)
    if (!source.nsfw && !lightningToggles.length) {
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
    getCapability,
    normalizeProvider,
    normalizeMode,
    providerTitle,
    renderKey,
    capabilityFor,
    normalizeLocalTextQuality,
    normalizeLocalEditStrength,
    drawingEditStrength,
    localPresetFor,
    applyLocalWorkflowPreset,
    workflowSettings,
  })
})
