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
      txt2img: capability(0, ['width', 'height', 'steps', 'cfg', 'seed'], true),
      img2img: capability(3, ['width', 'height', 'steps', 'cfg', 'seed'], true),
    }),
    gpt: Object.freeze({
      txt2img: capability(0, ['quality', 'size'], false),
      img2img: capability(16, ['quality', 'size'], false),
    }),
  })

  // Non-NSFW local drawing runs on Qwen-Image-2.1, on the local assistant and on the shared pool
  // alike, LoRAs included (the list offers only LoRAs made for 2.1); the page tells the worker so
  // with the run. There is one layout: 2.1 has no quality or edit-strength setting; its img2img
  // takes up to 10 references (the model card's limit, as in the UI module) and keeps W / H, which
  // a new reference 1 fills with its size; the negative prompt stays (a filled one switches the run
  // to real guidance). The old Rapid AIO drawing route is retired.
  const LOCAL_QWEN21_CAPABILITIES = Object.freeze({
    txt2img: Object.freeze({ ...capability(0, ['width', 'height', 'steps', 'cfg', 'seed', 'nsfwLora'], true), engine: 'qwen-2.1' }),
    img2img: Object.freeze({ ...capability(10, ['width', 'height', 'steps', 'cfg', 'seed', 'nsfwLora'], true), engine: 'qwen-2.1' }),
  })

  function localQwen21Drawing(state) {
    return state?.nsfw !== true
  }

  // Cloud image lines on RunningHub (Dylan, 2026-11-10). provider stays 'gpt' for every cloud
  // line; which line runs is state.cloudImageModel. The 模型方式 select shows them as one list:
  // 'gpt' is GPT Image 2.5, the others are 'gpt:<model id>'. Mirrors
  // packages/shared/src/runninghub-gpt-image.mjs CLOUD_IMAGE_MODELS (labels, reference limits).
  const DEFAULT_CLOUD_IMAGE_MODEL = 'gpt-image-2.5'
  const CLOUD_IMAGE_MODELS = Object.freeze([
    Object.freeze({ id: 'gpt-image-2.5', label: 'GPT Image 2.5', referenceLimit: 16, credits: { img2img: 20, txt2img: null } }),
    Object.freeze({ id: 'nano-banana-2.1', label: 'Nano Banana 2.1', referenceLimit: 14, credits: { img2img: 13, txt2img: 13 } }),
    Object.freeze({ id: 'gpt-image-2', label: 'GPT Image 2', referenceLimit: 10, credits: { img2img: 11, txt2img: 4 } }),
    Object.freeze({ id: 'grok-imagine', label: 'Grok 图像', referenceLimit: 1, credits: { img2img: 8, txt2img: 8 } }),
    Object.freeze({ id: 'gpt-image-2.6', label: 'GPT Image 2.6', referenceLimit: 16, credits: { img2img: null, txt2img: null } }),
  ])
  function normalizeCloudImageModel(value) {
    const id = String(value || '').trim().toLowerCase().replace(/^gpt:/, '')
    return CLOUD_IMAGE_MODELS.some((item) => item.id === id) ? id : DEFAULT_CLOUD_IMAGE_MODEL
  }
  function cloudImageModelInfo(value) {
    const id = normalizeCloudImageModel(value)
    return CLOUD_IMAGE_MODELS.find((item) => item.id === id) || CLOUD_IMAGE_MODELS[0]
  }
  // The cloud line a state runs on, '' for a local state.
  function cloudImageModelFor(state) {
    return normalizeProvider(state?.provider) === 'gpt' ? normalizeCloudImageModel(state?.cloudImageModel) : ''
  }
  // What the 模型方式 select shows for a state, and what a chosen option means for the state.
  function providerSelection(state) {
    if (normalizeProvider(state?.provider) !== 'gpt') return 'local'
    const model = normalizeCloudImageModel(state?.cloudImageModel)
    return model === DEFAULT_CLOUD_IMAGE_MODEL ? 'gpt' : `gpt:${model}`
  }
  function applyProviderSelection(value) {
    const raw = String(value || '').trim().toLowerCase()
    if (raw === 'local' || raw === '' || raw === 'google' || raw === 'gemini') return { provider: 'local', cloudImageModel: DEFAULT_CLOUD_IMAGE_MODEL }
    return { provider: 'gpt', cloudImageModel: normalizeCloudImageModel(raw) }
  }
  const providerOptions = Object.freeze([
    Object.freeze({ value: 'local', label: 'Qwen（本地）' }),
    ...CLOUD_IMAGE_MODELS.map((item) => Object.freeze({ value: item.id === DEFAULT_CLOUD_IMAGE_MODEL ? 'gpt' : `gpt:${item.id}`, label: item.label })),
  ])
  // What 小桃 tells the user about each line when it asks which one to draw with (Dylan,
  // 2026-11-10: "现在模型多可以让小桃问一下用户用什么"). Findings from the live comparison.
  const MODEL_LINE_NOTES = Object.freeze({
    local: '不扣积分，约半分钟，适合换皮和格子少的界面',
    'gpt-image-2.5': '画质最高，等待一到两分钟',
    'nano-banana-2.1': '结构和文字最稳，性价比高，约一分钟',
    'gpt-image-2': '画质好，文生图最便宜，图生图较慢',
    'grok-imagine': '最便宜最快，忠实度一般',
    'gpt-image-2.6': 'GPT 最新版，按实际用量扣分（质量越高越贵），等待一到两分钟',
  })
  // One row per drawable line for the current mode: option value, label, credits a picture
  // (0 local, null when billed by usage), note, and whether it is the selected one.
  // `quote` is the browser price card's quoteGptImage; without it credits are unknown (null).
  function modelLines(state, quote) {
    const mode = normalizeMode(state?.mode)
    const selected = providerSelection(state)
    const credits = (id) => {
      if (typeof quote !== 'function') return null
      try {
        const quoted = quote({ mode, model: id, count: 1 })
        if (!quoted || quoted.billingMode === 'token') return null
        return Number.isFinite(Number(quoted.credits)) ? Number(quoted.credits) : null
      } catch { return null }
    }
    return Object.freeze([
      Object.freeze({ value: 'local', label: 'Qwen（本地）', credits: 0, note: MODEL_LINE_NOTES.local, selected: selected === 'local' }),
      ...CLOUD_IMAGE_MODELS.map((item) => {
        const value = item.id === DEFAULT_CLOUD_IMAGE_MODEL ? 'gpt' : `gpt:${item.id}`
        return Object.freeze({ value, label: item.label, credits: credits(item.id), note: MODEL_LINE_NOTES[item.id] || '', selected: selected === value })
      }),
    ])
  }

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

  // Steps and CFG on the drawing panel, for every local route that samples (Ideogram Instant has
  // neither). Each route starts from what its publisher recommends; a value the user types is kept
  // per route and mode, so switching to NSFW never carries 2.1's drawing steps over. Only the user's own
  // negative prompt counts as filled: the quality profile's automatic negatives would otherwise
  // switch every run to real guidance.
  //   Qwen-Image-2.1: 25 drawing steps (user's default); UI retains its 40-step baseline. CFG 1, where the negative prompt is
  //     never evaluated; a filled negative raises it to 2.5 (ComfyUI's note: raise cfg only with one).
  //   NSFW, Rapid AIO: 6 steps, CFG 1 (the author: 4 basic, 6 usually best, never more than 8;
  //     only CFG 1).
  //   The 2511 route (a LoRA run): 4 steps with the Lightning LoRA at CFG 1; a filled negative
  //     switches to the base model's 40 steps at CFG 4. Past 8 steps the Lightning LoRA is off.
  const LOCAL_SAMPLING_ROUTES = Object.freeze({
    'qwen-2.1': Object.freeze({ steps: [1, 100], cfg: [1, 10] }),
    'qwen-2.1-turbo': Object.freeze({ steps: [8, 8], cfg: [1, 10] }),
    rapid: Object.freeze({ steps: [1, 8], cfg: [1, 10] }),
    standard: Object.freeze({ steps: [1, 100], cfg: [1, 10] }),
  })
  const QWEN21_DEFAULT_STEPS = 25
  const QWEN21_NEGATIVE_CFG = 2.5
  const RAPID_DEFAULT_STEPS = 6
  const STANDARD_LIGHTNING_STEPS = 4
  const STANDARD_LIGHTNING_MAX_STEPS = 8
  const STANDARD_FULL_STEPS = 40
  const STANDARD_FULL_CFG = 4

  function localSamplingRoute(state, mode) {
    if (normalizeProvider(state?.provider) !== 'local') return ''
    if (localQwen21Drawing(state)) return 'qwen-2.1-turbo'
    if (state?.nsfw === true) return 'rapid'
    return normalizeMode(mode || state?.mode) === 'img2img' ? 'standard' : ''
  }

  function clampLocalSampling(route, key, value) {
    const limits = LOCAL_SAMPLING_ROUTES[route]?.[key]
    const numeric = Number(value)
    if (!limits || !Number.isFinite(numeric)) return null
    const bounded = Math.max(limits[0], Math.min(limits[1], numeric))
    return key === 'steps' ? Math.round(bounded) : Math.round(bounded * 10) / 10
  }

  function localSamplingOverride(state, route, modeKey) {
    const entry = state?.samplingOverrides?.[`${route}:${modeKey}`]
    return entry && typeof entry === 'object' ? entry : {}
  }

  // A style redraw is one subject first, then only style references. The prompt carries the style
  // in words, so both 2.1 routes need real guidance and an evaluated negative prompt. The subject
  // goes in small so its photographic look does not outweigh the style words, and the run samples
  // on a larger canvas (1536 x 1152 at 4:3) for a crisper finish, delivered at W / H as usual.
  const STYLE_REDRAW_CFG = 3
  const STYLE_REDRAW_CONTENT_PIXELS = 250000
  const STYLE_REDRAW_WORKING_PIXELS = 1769472
  function isStyleRedraw(runPolicy) {
    const roles = runPolicy?.referenceRoles
    return runPolicy?.taskProfile === 'art-direction' && Array.isArray(roles) && roles.length >= 2
      && roles[0] === 'subject' && roles.slice(1).every(role => role === 'style')
  }

  // What a drawing run samples with, and what the panel shows: { route, steps, cfg, lightning,
  // defaultSteps, defaultCfg, stepsManual, cfgManual }. userNegativePrompt is the text the user wrote
  // (state.negativePrompt when not given). The panel finds the route from the node's features; a run
  // names the route it actually builds. null off the sampling routes.
  function localSamplingFor(state, mode, userNegativePrompt, route, surface = 'drawing', runPolicy) {
    const modeKey = normalizeMode(mode || state?.mode)
    route = route==='qwen-2.1'?'qwen-2.1-turbo':LOCAL_SAMPLING_ROUTES[route] ? route : localSamplingRoute(state, modeKey)
    if (!route) return null
    const negative = String(userNegativePrompt ?? state?.negativePrompt ?? '').trim()
    const override = localSamplingOverride(state, route, modeKey)
    const manualSteps = clampLocalSampling(route, 'steps', override.steps)
    const manualCfg = clampLocalSampling(route, 'cfg', override.cfg)
    const defaultSteps = route === 'qwen-2.1-turbo' ? 8 : route === 'qwen-2.1'
      ? (surface === 'ui' ? 40 : QWEN21_DEFAULT_STEPS)
      : route === 'rapid'
        ? RAPID_DEFAULT_STEPS
        : (negative ? STANDARD_FULL_STEPS : STANDARD_LIGHTNING_STEPS)
    const steps = manualSteps ?? defaultSteps
    const lightning = route === 'standard' ? steps <= STANDARD_LIGHTNING_MAX_STEPS : false
    const styleRedraw = surface === 'drawing' && modeKey === 'img2img'
      && (route === 'qwen-2.1' || route === 'qwen-2.1-turbo') && isStyleRedraw(runPolicy)
    const defaultCfg = styleRedraw ? STYLE_REDRAW_CFG : route === 'qwen-2.1'
      ? (negative ? QWEN21_NEGATIVE_CFG : 1)
      : route === 'standard' && !lightning ? STANDARD_FULL_CFG : 1
    return Object.freeze({
      route,
      mode: modeKey,
      steps,
      cfg: manualCfg ?? defaultCfg,
      lightning,
      defaultSteps,
      defaultCfg,
      stepsManual: manualSteps != null,
      cfgManual: manualCfg != null,
      limits: LOCAL_SAMPLING_ROUTES[route],
    })
  }

  // A typed value is kept for this route and mode; an empty field, or the value the route would use
  // anyway, goes back to following the route's default. Turbo's explicit CFG,
  // including 1, is retained because its confirmed anime default can be 3.
  function setLocalSamplingValue(state, mode, key, rawValue, runPolicy) {
    if (!state || typeof state !== 'object' || (key !== 'steps' && key !== 'cfg')) return null
    const modeKey = normalizeMode(mode || state.mode)
    const route = localSamplingRoute(state, modeKey)
    if (!route) return null
    const overrides = state.samplingOverrides && typeof state.samplingOverrides === 'object' ? { ...state.samplingOverrides } : {}
    const entryKey = `${route}:${modeKey}`
    const entry = { ...(overrides[entryKey] || {}) }
    delete entry[key]
    overrides[entryKey] = entry
    state.samplingOverrides = overrides
    const text = String(rawValue ?? '').trim()
    const value = text === '' ? null : clampLocalSampling(route, key, text)
    if (value != null) {
      const automatic = localSamplingFor(state, modeKey, undefined, undefined, 'drawing', runPolicy)
      if (route === 'qwen-2.1-turbo' && key === 'cfg' || value !== (key === 'steps' ? automatic.defaultSteps : automatic.defaultCfg)) entry[key] = value
    }
    if (!Object.keys(entry).length) delete overrides[entryKey]
    return localSamplingFor(state, modeKey, undefined, undefined, 'drawing', runPolicy)
  }

  function getCapability(provider, mode) {
    const providerKey = String(provider || '').trim().toLowerCase()
    const modeKey = String(mode || '').trim().toLowerCase()
    return CAPABILITIES[providerKey]?.[modeKey] || null
  }

  function normalizeProvider(value) {
    const provider = String(value || '').trim().toLowerCase()
    if (provider === 'google' || provider === 'gemini') return 'local'
    return provider === 'gpt' || provider.startsWith('gpt:') ? 'gpt' : 'local'
  }

  function normalizeMode(value) {
    return String(value || '').trim().toLowerCase() === 'img2img' ? 'img2img' : 'txt2img'
  }

  // The title of the line a state runs on: a cloud state names its model, a local one Qwen.
  function providerTitle(value, state) {
    const provider = normalizeProvider(value)
    if (provider !== 'gpt') return 'Qwen（本地）'
    const raw = String(value || '').trim().toLowerCase()
    const model = raw.startsWith('gpt:') ? raw : state && typeof state === 'object' ? state.cloudImageModel : ''
    return cloudImageModelInfo(model).label
  }

  function renderKey(state) {
    const provider = normalizeProvider(state?.provider)
    const mode = normalizeMode(state?.mode)
    const route = provider === 'local' && localQwen21Drawing(state)
      ? 'qwen-2.1-turbo'
      : provider === 'local' && mode === 'txt2img' ? 'rapid' : ''
    return `${provider}:${mode}:${route}`
  }

  function capabilityFor(provider, mode, state) {
    const providerKey = normalizeProvider(provider)
    const modeKey = normalizeMode(mode)
    if (providerKey === 'local' && localQwen21Drawing(state)) return LOCAL_QWEN21_CAPABILITIES[modeKey]
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

  // sampling (from localSamplingFor) sets a drawing run's steps, CFG and Lightning switch over the
  // family's sampler; without it (UI design) the edit-strength / quality preset applies.
  function applyLocalWorkflowPreset(workflow, state, mode, sampling) {
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
      throw new TypeError('\u672c\u5730\u751f\u6210\u5de5\u4f5c\u6d41\u65e0\u6548')
    }
    const source = state && typeof state === 'object' ? state : {}
    const familyPreset = localPresetFor(source, mode)
    const selectedPreset = sampling && typeof sampling === 'object'
      ? { ...familyPreset, steps: sampling.steps, cfg: sampling.cfg, lightning: source.nsfw ? familyPreset.lightning : sampling.lightning === true }
      : familyPreset
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
    if (modeKey === 'txt2img' && state?.nsfw !== true) return { textQuality: 'instant' }
    return modeKey === 'img2img'
      ? { editStrength: normalizeLocalEditStrength(state.localEditStrength) }
      : { textQuality: normalizeLocalTextQuality(state.localTextQuality) }
  }

  return Object.freeze({
    providerOptions,
    CLOUD_IMAGE_MODELS,
    DEFAULT_CLOUD_IMAGE_MODEL,
    normalizeCloudImageModel,
    cloudImageModelInfo,
    cloudImageModelFor,
    providerSelection,
    applyProviderSelection,
    modelLines,
    getCapability,
    normalizeProvider,
    normalizeMode,
    providerTitle,
    renderKey,
    capabilityFor,
    normalizeLocalTextQuality,
    normalizeLocalEditStrength,
    localSamplingRoute,
    STYLE_REDRAW_CFG,
    STYLE_REDRAW_CONTENT_PIXELS,
    STYLE_REDRAW_WORKING_PIXELS,
    isStyleRedraw,
    localSamplingFor,
    setLocalSamplingValue,
    localPresetFor,
    applyLocalWorkflowPreset,
    workflowSettings,
  })
})
