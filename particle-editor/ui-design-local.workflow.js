(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignLocalWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const VERSION = '20260729-local-ui-workflow-25'
  const UI_TASK_PROFILE = 'ui-design'
  const REQUIRED_LAYOUT_GUIDE_ENCODING = 'soft-ui-semantic-scaffold-v2'
  const REDESIGN_INTENT = 'redesign'
  const ITERATION_INTENT = 'iteration'
  const QUALITY_MODE = 'quality'
  const PERFORMANCE_MODE = 'performance'
  const QWEN_EDIT_MODEL_NAME = 'qwen_image_edit_2511_fp8mixed.safetensors'
  const QWEN_EDIT_4STEP_LORA = 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors'
  const REDESIGN_ANTI_COPY_PREFIX = '本地UI重绘约束：'
  const ITERATION_ANTI_COPY_PREFIX = '本地UI修改约束：'
  const FULLSCREEN_DIGITAL_UI_CONTRACT = '整张画布即单一原生数字界面，画面边界与界面视口完全重合，连续背景延伸到四边，全部可见内容均为同一正视屏幕平面内的浅层二维软件图形'
  const FULLSCREEN_DIGITAL_UI_FINAL_OVERRIDE = 'FINAL SCREEN-NATIVE OUTPUT: render one finished digital interface edge-to-edge. The image boundary equals the viewport boundary. Keep one continuous background reaching all four edges, with every panel, control and gameplay element integrated as a shallow 2D HUD layer on the same straight-on orthographic screen plane.'
  const AUTO_PRIMARY_MAX_WORKING_PIXELS = Math.round(720 * 1280 * 0.64)
  const TEXT_ONLY_LAYOUT_CONTRACT = [
    `${REDESIGN_ANTI_COPY_PREFIX}本轮没有视觉布局参考图，只按语义区域重建画面，不得把结构说明、辅助线、标注框或结构矩形画成可见内容。`,
    'There is no visual layout reference in this synthesis pass.',
    'Treat region order, relative coverage, required item counts and functional groups as the layout contract.',
    'Invent the finished composition, shapes and materials directly from the written requirements.',
  ].join(' ')

  const ENHANCED_SAMPLING = Object.freeze({
    editStrength: 'enhanced',
    steps: 4,
    cfg: 1,
    samplerName: 'euler',
    scheduler: 'simple',
    denoise: 1,
    lightning: true,
  })

  const FAITHFUL_SAMPLING = Object.freeze({
    editStrength: 'faithful',
    steps: 4,
    cfg: 1,
    samplerName: 'euler',
    scheduler: 'simple',
    denoise: 1,
    lightning: true,
  })
  const RAPID_ENHANCED_SAMPLING = Object.freeze({
    editStrength: 'enhanced',
    steps: 6,
    cfg: 1,
    samplerName: 'euler_ancestral',
    scheduler: 'beta',
    denoise: 1,
    lightning: false,
  })
  const RAPID_FAITHFUL_SAMPLING = Object.freeze({
    editStrength: 'faithful',
    steps: 4,
    cfg: 1,
    samplerName: 'euler_ancestral',
    scheduler: 'beta',
    denoise: 1,
    lightning: false,
  })

  // Local UI redesign always carries one Gaussian-only semantic scaffold.
  // Ordinary references may be routed ahead of it so the model sees real UI
  // artwork first; the scaffold controls soft occupancy only and is never
  // visible UI artwork.
  const REDESIGN_SAMPLING = Object.freeze({
    ...ENHANCED_SAMPLING,
    editStrength: 'ui-structure-draft',
    steps: 4,
  })
  const QUALITY_REFERENCE_SAMPLING = Object.freeze({
    editStrength: 'ui-native-quality-structure-draft',
    steps: 40,
    cfg: 4,
    samplerName: 'euler',
    scheduler: 'simple',
    denoise: 1,
    lightning: false,
    modelName: QWEN_EDIT_MODEL_NAME,
  })
  const QUALITY_REFERENCE_RETRY_SAMPLING = Object.freeze({
    ...QUALITY_REFERENCE_SAMPLING,
    editStrength: 'ui-native-quality-correction',
    steps: 40,
  })

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone)
    if (!value || typeof value !== 'object') return value
    const output = {}
    Object.entries(value).forEach(([key, item]) => {
      output[key] = clone(item)
    })
    return output
  }

  function referenceRole(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
      ? value.role
      : value
    return cleanText(source).toLowerCase().replace(/[\s-]+/g, '_')
  }

  function normalizedReferenceRoles(value) {
    return (Array.isArray(value) ? value : []).map((item, index) => ({
      index,
      role: referenceRole(item),
      name: cleanText(item && typeof item === 'object' ? item.name : ''),
      sourceId: cleanText(item && typeof item === 'object' ? item.sourceId : ''),
      autoPrimary: item && typeof item === 'object' && item.autoPrimary === true,
      roleSource: cleanText(item && typeof item === 'object' ? item.roleSource : ''),
    }))
  }

  function validateUiLocalContract(options = {}) {
    if (cleanText(options.taskProfile).toLowerCase() !== UI_TASK_PROFILE) {
      throw new Error('Local UI workflow requires taskProfile=ui-design')
    }
    const roles = normalizedReferenceRoles(options.referenceRoles)
    const layoutGuideRoles = roles.filter((item) => item.role === 'ui_layout')
    if (layoutGuideRoles.length !== 1) {
      throw new Error('Local UI workflow requires exactly one ui_layout reference role')
    }
    if (cleanText(options.layoutGuideEncoding).toLowerCase() !== REQUIRED_LAYOUT_GUIDE_ENCODING) {
      throw new Error(`Local UI workflow requires layoutGuideEncoding=${REQUIRED_LAYOUT_GUIDE_ENCODING}`)
    }
    if (!options.localWorkflow || typeof options.localWorkflow !== 'object' || Array.isArray(options.localWorkflow)) {
      throw new Error('Local UI workflow requires a valid localWorkflow object')
    }
    return roles
  }

  function referenceDeclaresIteration(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const candidates = [
      value.kind,
      value.connectionKind,
      value.referenceKind,
      value.intent,
    ]
    return candidates.some((item) => cleanText(item).toLowerCase() === ITERATION_INTENT)
  }

  function resolveIntent(state = {}, referenceRoles = []) {
    const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {}
    const explicit = [
      source.uiRunIntent,
      source.uiGenerationIntent,
      source.generationIntent,
      source.runIntent,
      source.intent,
    ].map((item) => cleanText(item).toLowerCase()).find(Boolean)
    if (explicit === ITERATION_INTENT) return ITERATION_INTENT
    if (explicit === REDESIGN_INTENT) return REDESIGN_INTENT
    if (
      source.iteration === true
      || source.isIteration === true
      || Number(source.iterationReferenceCount) > 0
      || (
        Array.isArray(referenceRoles)
        && referenceRoles.some((item) => referenceRole(item) !== 'ui_layout' && referenceDeclaresIteration(item))
      )
    ) return ITERATION_INTENT
    return REDESIGN_INTENT
  }

  function resolveQualityMode(intent, state = {}, roles = []) {
    if (intent === ITERATION_INTENT || state?.nsfw === true) return PERFORMANCE_MODE
    const automaticPrimaryReference = roles.some((item) => (
      item.role === 'reference' && item.autoPrimary === true
    ))
    if (!automaticPrimaryReference) return PERFORMANCE_MODE
    const explicit = cleanText(state?.localUiQualityMode).toLowerCase()
    return explicit === PERFORMANCE_MODE ? PERFORMANCE_MODE : QUALITY_MODE
  }

  function samplingForIntent(intent, state = {}, qualityMode = PERFORMANCE_MODE) {
    const rapidFamily = state?.nsfw === true
    if (intent !== ITERATION_INTENT) {
      if (rapidFamily) {
        return Object.freeze({ ...RAPID_ENHANCED_SAMPLING, editStrength: 'ui-quality-redesign' })
      }
      if (qualityMode === QUALITY_MODE) {
        return cleanText(state?.localUiRefinePreset).toLowerCase() === 'enhanced-redraw'
          ? QUALITY_REFERENCE_RETRY_SAMPLING
          : QUALITY_REFERENCE_SAMPLING
      }
      return cleanText(state?.localEditStrength).toLowerCase() === 'enhanced'
        ? Object.freeze({ ...ENHANCED_SAMPLING, editStrength: 'ui-enhanced-redraw' })
        : REDESIGN_SAMPLING
    }
    if (rapidFamily) {
      return cleanText(state?.localEditStrength).toLowerCase() === 'enhanced'
        ? RAPID_ENHANCED_SAMPLING
        : RAPID_FAITHFUL_SAMPLING
    }
    return cleanText(state?.localEditStrength).toLowerCase() === 'enhanced'
      ? ENHANCED_SAMPLING
      : FAITHFUL_SAMPLING
  }

  function isLightningToggle(node) {
    if (cleanText(node?.class_type) !== 'PrimitiveBoolean') return false
    const title = cleanText(node?._meta?.title)
      .toLowerCase()
      .replace(/[?？]/g, '')
      .replace(/step\(s\)/g, 'steps')
      .replace(/\s+/g, '')
    return title === 'enable4steplora' || title === 'enable4stepslora'
  }

  function applySampling(workflow, sampling) {
    const nodes = Object.values(workflow)
    const samplers = nodes.filter((node) => (
      cleanText(node?.class_type) === 'KSampler'
      && node?.inputs
      && typeof node.inputs === 'object'
      && !Array.isArray(node.inputs)
    ))
    if (!samplers.length) throw new Error('Local UI workflow requires at least one KSampler node')
    samplers.forEach((node) => {
      node.inputs.steps = sampling.steps
      node.inputs.cfg = sampling.cfg
      node.inputs.sampler_name = sampling.samplerName
      node.inputs.scheduler = sampling.scheduler
      node.inputs.denoise = sampling.denoise
    })
    nodes.filter(isLightningToggle).forEach((node) => {
      node.inputs.value = sampling.lightning
    })
    const loraLoaders = nodes.filter((node) => (
      cleanText(node?.class_type) === 'LoraLoaderModelOnly'
      && node?.inputs
      && typeof node.inputs === 'object'
      && !Array.isArray(node.inputs)
    ))
    if (sampling.loraName) {
      if (!loraLoaders.length) {
        throw new Error(`Local UI ${sampling.steps}-step quality contract requires LoraLoaderModelOnly`)
      }
      loraLoaders.forEach((node) => {
        node.inputs.lora_name = sampling.loraName
        node.inputs.strength_model = 1
      })
    }
    const unetLoaders = nodes.filter((node) => (
      cleanText(node?.class_type) === 'UNETLoader'
      && node?.inputs
      && typeof node.inputs === 'object'
      && !Array.isArray(node.inputs)
    ))
    const requestedModelName = cleanText(
      sampling.modelName
      || (sampling.loraName ? QWEN_EDIT_MODEL_NAME : ''),
    )
    if (requestedModelName) {
      if (!unetLoaders.length) {
        throw new Error(`Local UI ${sampling.steps}-step quality contract requires UNETLoader`)
      }
      unetLoaders.forEach((node) => {
        node.inputs.unet_name = requestedModelName
      })
    }
    return {
      samplerCount: samplers.length,
      lightningToggleCount: nodes.filter(isLightningToggle).length,
      loraLoaderCount: loraLoaders.length,
      unetLoaderCount: unetLoaders.length,
      loraName: sampling.loraName || '',
      modelName: unetLoaders.length
        ? cleanText(unetLoaders[0]?.inputs?.unet_name)
        : '',
    }
  }

  function workflowNodeEntries(workflow, classType) {
    return Object.entries(workflow || {}).filter(([, node]) => (
      cleanText(node?.class_type) === classType
      && node?.inputs
      && typeof node.inputs === 'object'
      && !Array.isArray(node.inputs)
    ))
  }

  function connection(value) {
    if (!Array.isArray(value) || value.length < 2 || !cleanText(value[0])) return null
    const outputIndex = Number(value[1])
    return [String(value[0]), Number.isFinite(outputIndex) ? outputIndex : 0]
  }

  function connectionKey(value) {
    const source = connection(value)
    return source ? `${source[0]}:${source[1]}` : ''
  }

  function samplerVaeEncoderIds(workflow) {
    const ids = new Set()
    workflowNodeEntries(workflow, 'KSampler').forEach(([, node]) => {
      const source = connection(node.inputs.latent_image)
      if (!source) return
      const sourceNode = workflow[source[0]]
      if (cleanText(sourceNode?.class_type) === 'VAEEncode') ids.add(source[0])
    })
    return ids
  }

  function routeLayoutReferenceToLatent(workflow, roles, intent, options = {}) {
    const fallback = (reason, details = {}) => ({
      applied: false,
      strategy: 'workflow-default',
      role: '',
      referenceIndex: -1,
      imageNumber: 0,
      imageSlot: '',
      sourceNodeId: '',
      sourceOutputIndex: 0,
      promptEncoderCount: 0,
      vaeEncoderCount: 0,
      fallbackReason: reason,
      ...details,
    })
    if (intent === ITERATION_INTENT) {
      return fallback('iteration-preserves-base-image')
    }
    const externalRoles = roles.filter((item) => item.role !== 'ui_layout')
    const explicitLayoutReference = externalRoles.find((item) => item.role === 'layout')
    const automaticPrimaryReference = explicitLayoutReference
      ? null
      : (
          externalRoles.find((item) => item.role === 'reference' && item.autoPrimary)
          || externalRoles.find((item) => item.role === 'reference')
        )
    const layoutReference = explicitLayoutReference || automaticPrimaryReference
    if (!layoutReference) {
      return fallback('no-explicit-layout-reference')
    }
    const imageNumber = layoutReference.index + 1
    const imageSlot = `image${imageNumber}`
    const encoders = workflowNodeEntries(workflow, 'TextEncodeQwenImageEditPlus')
      .filter(([, node]) => connection(node.inputs[imageSlot]))
    const sources = new Map()
    encoders.forEach(([, node]) => {
      const source = connection(node.inputs[imageSlot])
      if (source) sources.set(connectionKey(source), source)
    })
    const details = {
      role: layoutReference.role,
      referenceIndex: layoutReference.index,
      imageNumber,
      imageSlot,
      promptEncoderCount: encoders.length,
    }
    if (!encoders.length) {
      return fallback('layout-conditioning-slot-missing', details)
    }
    if (sources.size !== 1) {
      return fallback('layout-conditioning-source-ambiguous', details)
    }
    const source = Array.from(sources.values())[0]
    if (!explicitLayoutReference && options.conditioningOnlyAutoPrimary === true) {
      return {
        applied: false,
        strategy: 'conditioning-only-auto-primary',
        ...details,
        sourceNodeId: source[0],
        sourceOutputIndex: source[1],
        vaeEncoderCount: 0,
        fallbackReason: '',
      }
    }
    const vaeIds = samplerVaeEncoderIds(workflow)
    if (!vaeIds.size) {
      return fallback('sampler-vae-encoder-not-directly-provable', {
        ...details,
        sourceNodeId: source[0],
        sourceOutputIndex: source[1],
      })
    }
    vaeIds.forEach((nodeId) => {
      workflow[nodeId].inputs.pixels = [...source]
    })
    return {
      applied: true,
      strategy: explicitLayoutReference
        ? 'declared-layout-reference'
        : 'auto-primary-reference',
      ...details,
      sourceNodeId: source[0],
      sourceOutputIndex: source[1],
      vaeEncoderCount: vaeIds.size,
      fallbackReason: '',
    }
  }

  function routeSemanticGuideToLatent(workflow, roles) {
    const guide = roles.find((item) => item.role === 'ui_layout')
    if (!guide) throw new Error('Local UI quality mode requires the semantic layout guide')
    const imageNumber = guide.index + 1
    const imageSlot = `image${imageNumber}`
    const encoders = workflowNodeEntries(workflow, 'TextEncodeQwenImageEditPlus')
      .filter(([, node]) => connection(node.inputs[imageSlot]))
    const sources = new Map()
    encoders.forEach(([, node]) => {
      const source = connection(node.inputs[imageSlot])
      if (source) sources.set(connectionKey(source), source)
    })
    if (!encoders.length || sources.size !== 1) {
      throw new Error('Local UI quality mode cannot resolve the semantic guide conditioning source')
    }
    const source = Array.from(sources.values())[0]
    const vaeIds = samplerVaeEncoderIds(workflow)
    if (!vaeIds.size) {
      throw new Error('Local UI quality mode requires a sampler VAE latent path')
    }
    vaeIds.forEach((nodeId) => {
      workflow[nodeId].inputs.pixels = [...source]
    })
    return {
      applied: true,
      strategy: 'semantic-layout-guide',
      role: guide.role,
      referenceIndex: guide.index,
      imageNumber,
      imageSlot,
      sourceNodeId: source[0],
      sourceOutputIndex: source[1],
      promptEncoderCount: encoders.length,
      vaeEncoderCount: vaeIds.size,
      fallbackReason: '',
    }
  }

  function compileAntiCopyPrompt(prompt, options = {}) {
    const source = cleanText(prompt)
    if (source.includes(REDESIGN_ANTI_COPY_PREFIX) || source.includes(ITERATION_ANTI_COPY_PREFIX)) return source
    const intent = resolveIntent(options.state, options.referenceRoles)
    const screenNative = intent !== ITERATION_INTENT
      && cleanText(options.carrierIntent).toLowerCase() !== 'hardware'
    if (options.textOnly === true && intent === REDESIGN_INTENT) {
      return [
        TEXT_ONLY_LAYOUT_CONTRACT,
        screenNative ? `${FULLSCREEN_DIGITAL_UI_CONTRACT}。` : '',
        source,
        screenNative ? FULLSCREEN_DIGITAL_UI_FINAL_OVERRIDE : '',
      ].filter(Boolean).join(' ')
    }
    const layoutGuide = normalizedReferenceRoles(options.referenceRoles)
      .find((item) => item.role === 'ui_layout')
    const layoutGuideImageNumber = layoutGuide ? layoutGuide.index + 1 : 1
    const constraint = intent === ITERATION_INTENT
      ? `${ITERATION_ANTI_COPY_PREFIX}图1是唯一修改底图；其余图像必须按已声明的参考职责真实参与修改。布局参考约束位置、比例、分组、层级和重复项数量；风格、配色与材质参考约束对应的视觉属性；角色、主体与内容参考约束其声明的身份和内容。用户明确要求用于解决冲突，禁止把未要求的Logo、文案或主题身份带入结果。`
      : `${REDESIGN_ANTI_COPY_PREFIX}图${layoutGuideImageNumber}仅是高斯柔性页面结构引导，只表达区域中心、相对占比、顺序、留白与重复项数量，不得输出结构框、底板、辅助线、坐标或标注。其余参考图必须按已声明职责真实参与合成：布局参考保留主要位置、比例、分组、层级、控件关系与重复项数量；风格、配色和材质参考保留对应视觉属性；角色、主体和内容参考保留其声明的身份与内容。用户明确要求用于解决冲突，禁止带入未要求的Logo、文案或主题身份，也不得把同一内容擅自扩展到其他区域。`
    const digitalCanvasConstraint = screenNative ? ` ${FULLSCREEN_DIGITAL_UI_CONTRACT}。` : ''
    const finalOverride = screenNative ? ` ${FULLSCREEN_DIGITAL_UI_FINAL_OVERRIDE}` : ''
    return source
      ? `${constraint}${digitalCanvasConstraint} ${source}${finalOverride}`
      : `${constraint}${digitalCanvasConstraint}${finalOverride}`
  }

  function buildLocalUiWorkflow(options = {}) {
    const roles = validateUiLocalContract(options)
    const sourceState = options.state && typeof options.state === 'object' && !Array.isArray(options.state)
      ? options.state
      : {}
    const rapidCheckpoint = Object.values(options.localWorkflow || {}).some((node) => (
      node?.class_type === 'CheckpointLoaderSimple'
      && node.inputs?.ckpt_name === 'Qwen-Rapid-AIO-NSFW-v20.safetensors'
    ))
    const state = rapidCheckpoint ? { ...sourceState, nsfw: true } : sourceState
    const intent = resolveIntent(state, options.referenceRoles)
    const qualityMode = resolveQualityMode(intent, state, roles)
    const sampling = samplingForIntent(intent, state, qualityMode)
    const workflow = clone(options.localWorkflow)
    const applied = applySampling(workflow, sampling)
    const latentReference = routeLayoutReferenceToLatent(workflow, roles, intent, {
      conditioningOnlyAutoPrimary: false,
    })
    const resolutionApi = root && root.NovaFlowUiDesignLocalResolution
    if (typeof resolutionApi?.apply !== 'function') {
      throw new Error('Local UI safe resolution helper is required')
    }
    const requestedPixels = Math.max(0, Number(state?.width) || 0)
      * Math.max(0, Number(state?.height) || 0)
    const usePerformanceAutoPrimaryThermalCanvas = qualityMode === PERFORMANCE_MODE
      && latentReference.strategy === 'auto-primary-reference'
      && requestedPixels === 720 * 1280
    const resolved = resolutionApi.apply(workflow, {
      state,
      clone: false,
      forceWorkingImageScale: latentReference.applied,
      forceOutputFinish: qualityMode === QUALITY_MODE,
      outputSharpenAlpha: 0.6,
      maxWorkingPixels: usePerformanceAutoPrimaryThermalCanvas
        ? AUTO_PRIMARY_MAX_WORKING_PIXELS
        : undefined,
    })
    const latentCanvas = Object.freeze({
      applied: latentReference.applied === true,
      strategy: latentReference.strategy,
      nodeId: '',
      width: Math.max(0, Math.round(Number(resolved.metadata?.working?.width) || 0)),
      height: Math.max(0, Math.round(Number(resolved.metadata?.working?.height) || 0)),
      samplerCount: applied.samplerCount,
    })
    const synthesisMode = cleanText(options.mode).toLowerCase() || cleanText(resolved.metadata?.mode).toLowerCase()
    const samplingMetadata = {
      editStrength: sampling.editStrength,
      steps: sampling.steps,
      cfg: sampling.cfg,
      samplerName: sampling.samplerName,
      scheduler: sampling.scheduler,
      denoise: sampling.denoise,
      lightning: sampling.lightning,
    }
    return {
      workflow: resolved.workflow,
      intent,
      synthesisMode,
      sampling: samplingMetadata,
      metadata: {
        version: VERSION,
        taskProfile: UI_TASK_PROFILE,
        intent,
        synthesisMode,
        layoutGuideEncoding: REQUIRED_LAYOUT_GUIDE_ENCODING,
        referenceRoles: roles.map((item) => item.role),
        qualityMode,
        loraName: applied.loraName,
        modelName: applied.modelName,
        sampling: { ...samplingMetadata },
        samplerCount: applied.samplerCount,
        lightningToggleCount: applied.lightningToggleCount,
        loraLoaderCount: applied.loraLoaderCount,
        unetLoaderCount: applied.unetLoaderCount,
        latentReference: Object.freeze({ ...latentReference }),
        latentCanvas,
        resolution: resolved.metadata,
      },
    }
  }

  return Object.freeze({
    VERSION,
    UI_TASK_PROFILE,
    REQUIRED_LAYOUT_GUIDE_ENCODING,
    REDESIGN_INTENT,
    ITERATION_INTENT,
    QUALITY_MODE,
    PERFORMANCE_MODE,
    QWEN_EDIT_MODEL_NAME,
    QWEN_EDIT_4STEP_LORA,
    ENHANCED_SAMPLING,
    FAITHFUL_SAMPLING,
    RAPID_ENHANCED_SAMPLING,
    RAPID_FAITHFUL_SAMPLING,
    REDESIGN_SAMPLING,
    QUALITY_REFERENCE_SAMPLING,
    AUTO_PRIMARY_MAX_WORKING_PIXELS,
    validateUiLocalContract,
    resolveIntent,
    resolveQualityMode,
    compileAntiCopyPrompt,
    routeLayoutReferenceToLatent,
    routeSemanticGuideToLatent,
    buildLocalUiWorkflow,
    build: buildLocalUiWorkflow,
  })
})
