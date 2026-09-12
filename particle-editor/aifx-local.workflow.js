(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAifxLocalWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const VERSION = '20260912-aifx-rapid-1'
  const PIPELINE = 'qwen-rapid-aio-spritesheet-conditioned-v2'
  const DEFAULT_CONTROL_TYPE = 'hed/pidi/scribble/ted'
  const DEFAULT_CONTROL_STRENGTH = 0.62
  const DEFAULT_CONTROL_END_PERCENT = 0.72
  const ANCHOR_ROLES = Object.freeze(['peak', 'onset', 'decay', 'breakup', 'dissipation'])
  const SEQUENCE_PHASES = Object.freeze(['onset', 'growth', 'peak', 'follow-through', 'decay', 'breakup', 'dissipation'])
  const MATERIAL_SHAPE_EVOLUTION = Object.freeze({
    fire: 'Fire silhouette evolution: asymmetric flame tongues lick outward and retract, edge wisps split into embers, and the trailing body breaks into sparks during decay.',
    lightning: 'Lightning silhouette evolution: keep a narrow travelling main bolt while sharp forks, gaps, re-branches, and short plasma offshoots appear and disappear coherently.',
    ice: 'Ice silhouette evolution: faceted wedges and shard spikes grow from the anchor, fracture around the peak, and separate into angular chips and cold dust during decay.',
    poison: 'Poison silhouette evolution: viscous blobs, holes, sticky tendrils, bubbles, drops, and splashes stretch along the path and separate into toxic droplets during decay.',
    default: 'Material silhouette evolution: regenerate a changing outer shape around the motion anchors instead of tracing the template pixels.',
  })
  const REQUIRED_NODES = Object.freeze([
    'CheckpointLoaderSimple',
    'LoadImage',
    'TextEncodeQwenImageEditPlus',
    'TextEncodeQwenImageEdit',
    'ConditioningAverage',
    'ConditioningSetTimestepRange',
    'ConditioningCombine',
    'ControlNetLoader',
    'SetUnionControlNetType',
    'ControlNetApplyAdvanced',
    'EmptyQwenImageLayeredLatentImage',
    'KSampler',
    'VAEDecode',
    'SaveImage',
  ])

  const DEFAULT_STRUCTURE_PROMPT = [
    'Generate exactly one complete game VFX sprite sheet from Image 1.',
    'Image 1 is hard authority only for frame count, grid, row-major order and cell dimensions.',
    'Use its normalized motion anchors, path, direction, occupancy trend and lifecycle only as soft temporal guidance.',
    'Never copy Image 1 colors, subject, rendering, texture or pixel-for-pixel silhouette.',
    'Every cell is one chronological frame of the same coherent animation, never a gallery or contact-sheet variant.',
    'Do not merge, remove, reorder or add cells, and do not let content cross a cell boundary.',
  ].join(' ')

  const DEFAULT_NEGATIVE_PROMPT = [
    'character, person, face, body, weapon object, scene, environment, camera view',
    'text, logo, watermark, frame label, number, border, grid line, contact sheet annotation, gallery, variant sheet',
    'changed layout, merged cells, missing cells, duplicated cells, cropped cells, reordered frames',
    'incoherent animation, random frame style, independent design options, unrelated object, flat opaque sticker',
    'copied template color, copied template subject, pixel-for-pixel template silhouette, identical silhouette across materials',
  ].join(', ')

  function cleanText(value) {
    return String(value == null ? '' : value).trim()
  }

  function clamp(value, min, max) {
    const number = Number(value)
    if (!Number.isFinite(number)) return min
    return Math.max(min, Math.min(max, number))
  }

  function typedError(code, message, details) {
    const error = new Error(cleanText(message) || code)
    error.name = 'NovaFlowAifxWorkflowError'
    error.code = code
    error.retryable = false
    if (details && typeof details === 'object') error.details = details
    return error
  }

  function normalizeDirectionDeg(value, fallback = 0) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    const normalized = ((parsed + 180) % 360 + 360) % 360 - 180
    return Object.is(normalized, -0) ? 0 : normalized
  }

  function normalizePhase(value, fallback) {
    const normalized = cleanText(value)
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/-{2,}/g, '-')
    const aliases = {
      start: 'onset',
      birth: 'onset',
      appear: 'onset',
      build: 'growth',
      rise: 'growth',
      expand: 'growth',
      climax: 'peak',
      hold: 'follow-through',
      travel: 'follow-through',
      release: 'follow-through',
      tail: 'follow-through',
      fade: 'decay',
      'fade-out': 'decay',
      fragment: 'breakup',
      fragmentation: 'breakup',
      'break-up': 'breakup',
      dissipate: 'dissipation',
      dissipating: 'dissipation',
      end: 'dissipation',
    }
    const phase = aliases[normalized] || normalized || fallback
    if (!SEQUENCE_PHASES.includes(phase)) {
      throw typedError('AIFX_LOCAL_SEQUENCE_PLAN_INVALID', `Unsupported AIFX sequence phase: ${phase}.`)
    }
    return phase
  }

  function defaultSequencePlan(frameCountValue) {
    const frameCount = Number(frameCountValue)
    if (!Number.isInteger(frameCount) || frameCount < 1) return Object.freeze([])
    const peakIndex = frameCount <= 1
      ? 0
      : frameCount === 2
        ? 1
        : frameCount === 3
          ? 1
          : Math.max(2, Math.min(frameCount - 2, Math.round((frameCount - 1) * 0.45)))
    return Object.freeze(Array.from({ length: frameCount }, (_, index) => {
      const phase = index === 0 && peakIndex > 0
        ? 'onset'
        : index < peakIndex
          ? 'growth'
          : index === peakIndex
            ? 'peak'
            : 'decay'
      const energy = phase === 'onset'
        ? 0.12
        : phase === 'growth'
          ? 0.2 + 0.68 * (index / Math.max(1, peakIndex))
          : phase === 'peak'
            ? 1
            : 0.08 + 0.74 * (1 - (index - peakIndex) / Math.max(1, frameCount - 1 - peakIndex))
      return Object.freeze({
        index,
        phase,
        energy: Number(clamp(energy, 0, 1).toFixed(4)),
        centerX: 0.5,
        centerY: 0.5,
        directionDeg: 0,
        occupancy: Number(clamp(0.08 + energy * 0.78, 0, 1).toFixed(4)),
      })
    }))
  }

  function normalizeSequencePlan(value, frameCountValue) {
    const supplied = value == null ? null : value
    if (supplied !== null && !Array.isArray(supplied)) {
      throw typedError('AIFX_LOCAL_SEQUENCE_PLAN_INVALID', 'sequencePlan must be an array.')
    }
    const requestedFrameCount = Number(frameCountValue)
    const frameCount = Number.isInteger(requestedFrameCount) && requestedFrameCount > 0
      ? requestedFrameCount
      : Array.isArray(supplied) && supplied.length ? supplied.length : 0
    if (!frameCount) return Object.freeze([])
    const defaults = defaultSequencePlan(frameCount)
    if (supplied === null || supplied.length === 0) return defaults
    if (supplied.length !== frameCount) {
      throw typedError('AIFX_LOCAL_SEQUENCE_PLAN_INVALID', `sequencePlan must contain exactly ${frameCount} frames.`)
    }
    const byIndex = new Map()
    supplied.forEach((entry, position) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw typedError('AIFX_LOCAL_SEQUENCE_PLAN_INVALID', `sequencePlan[${position}] must be an object.`)
      }
      const index = entry.index == null ? position : Number(entry.index)
      if (!Number.isInteger(index) || index < 0 || index >= frameCount || byIndex.has(index)) {
        throw typedError('AIFX_LOCAL_SEQUENCE_PLAN_INVALID', `sequencePlan[${position}] has an invalid or duplicate index.`)
      }
      const fallback = defaults[index]
      const phase = normalizePhase(entry.phase, fallback.phase)
      const normalizedNumber = (raw, fallbackValue) => Number(clamp(Number.isFinite(Number(raw)) ? Number(raw) : fallbackValue, 0, 1).toFixed(4))
      byIndex.set(index, Object.freeze({
        index,
        phase,
        energy: normalizedNumber(entry.energy, fallback.energy),
        centerX: normalizedNumber(entry.centerX, fallback.centerX),
        centerY: normalizedNumber(entry.centerY, fallback.centerY),
        directionDeg: Number(normalizeDirectionDeg(entry.directionDeg, fallback.directionDeg).toFixed(3)),
        occupancy: normalizedNumber(entry.occupancy, fallback.occupancy),
      }))
    })
    const plan = Object.freeze(defaults.map((_, index) => byIndex.get(index)))
    const phaseRanks = new Map(SEQUENCE_PHASES.map((phase, index) => [phase, index]))
    for (let index = 1; index < plan.length; index += 1) {
      if (phaseRanks.get(plan[index].phase) < phaseRanks.get(plan[index - 1].phase)) {
        throw typedError('AIFX_LOCAL_SEQUENCE_PLAN_INVALID', 'sequencePlan phases must progress continuously from onset through growth, peak, follow-through, decay, breakup, and dissipation.')
      }
    }
    return plan
  }

  function sequencePlanPrompt(sequencePlan) {
    if (!sequencePlan.length) return ''
    return [
      `F1\u2192F${sequencePlan.length} CONTINUOUS SEQUENCE PLAN (soft motion guidance, never a pixel mask):`,
      ...sequencePlan.map((frame) => (
        `F${frame.index + 1}: phase=${frame.phase}; energy=${frame.energy.toFixed(4)}; motionAnchor=(${frame.centerX.toFixed(4)},${frame.centerY.toFixed(4)}); directionDeg=${frame.directionDeg.toFixed(3)}; occupancy=${frame.occupancy.toFixed(4)}.`
      )),
      'Follow these anchors and the onset-growth-peak-follow-through-decay-breakup-dissipation progression while regenerating a material-specific outer shape. Do not trace Image 1 alpha pixels.',
    ].join(' ')
  }

  function materialTypeFor(options, target) {
    const explicit = cleanText(options?.materialType || options?.inferredEffectType).toLowerCase()
    if (explicit && explicit !== 'default' && Object.prototype.hasOwnProperty.call(MATERIAL_SHAPE_EVOLUTION, explicit)) {
      return explicit
    }
    const source = `${explicit} ${cleanText(target)} ${cleanText(options?.stylePrompt)} ${cleanText(options?.styleDescription)}`.toLowerCase()
    const candidates = [
      ['fire', /\b(?:fire|flame|burn|ember|blaze)\b|\u706b\u7130|\u706b/],
      ['lightning', /\b(?:lightning|electric|electricity|thunder|plasma|bolt)\b|\u96f7\u7535|\u96f7/],
      ['ice', /\b(?:ice|snow|frost|frozen|crystal|crystalline)\b|\u51b0\u96ea|\u51b0/],
      ['poison', /\b(?:poison|toxic|venom|slime|acid)\b|\u6bd2\u6db2|\u6bd2/],
    ]
    return candidates.find(([, pattern]) => pattern.test(source))?.[0] || explicit || 'default'
  }

  function normalizeAnchorRole(value, allowEmpty = false) {
    const anchorRole = cleanText(value).toLowerCase()
    if (!anchorRole && allowEmpty) return ''
    if (!ANCHOR_ROLES.includes(anchorRole)) {
      throw typedError(
        'AIFX_LOCAL_ANCHOR_ROLE_INVALID',
        `anchorRole must be one of: ${ANCHOR_ROLES.join(', ')}.`,
        { anchorRole },
      )
    }
    return anchorRole
  }

  function normalizeAnchorFrame(value, anchorRoleValue) {
    const anchorRole = normalizeAnchorRole(anchorRoleValue)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw typedError('AIFX_LOCAL_ANCHOR_FRAME_INVALID', 'anchorFrame must be an object.')
    }
    const globalIndex = Number(value.globalIndex ?? value.index)
    if (!Number.isInteger(globalIndex) || globalIndex < 0) {
      throw typedError(
        'AIFX_LOCAL_ANCHOR_FRAME_INVALID',
        'anchorFrame.globalIndex must be a non-negative integer.',
        { globalIndex: value.globalIndex ?? value.index },
      )
    }
    let phase = ''
    try {
      phase = normalizePhase(value.phase, anchorRole)
    } catch (error) {
      throw typedError(
        'AIFX_LOCAL_ANCHOR_FRAME_INVALID',
        `anchorFrame.phase must match anchorRole ${anchorRole}.`,
        { anchorRole, phase: cleanText(value.phase), cause: cleanText(error?.message) },
      )
    }
    if (phase !== anchorRole) {
      throw typedError(
        'AIFX_LOCAL_ANCHOR_FRAME_INVALID',
        `anchorFrame.phase must match anchorRole ${anchorRole}.`,
        { anchorRole, phase },
      )
    }
    const defaultEnergy = anchorRole === 'peak'
      ? 1
      : anchorRole === 'onset'
        ? 0.12
        : anchorRole === 'decay'
          ? 0.25
          : anchorRole === 'breakup'
            ? 0.1
            : 0.03
    const defaultOccupancy = anchorRole === 'peak'
      ? 0.85
      : anchorRole === 'onset'
        ? 0.12
        : anchorRole === 'decay'
          ? 0.28
          : anchorRole === 'breakup'
            ? 0.1
            : 0.025
    const normalizedNumber = (raw, fallbackValue) => Number(clamp(
      Number.isFinite(Number(raw)) ? Number(raw) : fallbackValue,
      0,
      1,
    ).toFixed(4))
    return Object.freeze({
      index: globalIndex,
      globalIndex,
      phase,
      energy: normalizedNumber(value.energy, defaultEnergy),
      centerX: normalizedNumber(value.centerX, 0.5),
      centerY: normalizedNumber(value.centerY, 0.5),
      directionDeg: Number(normalizeDirectionDeg(value.directionDeg, 0).toFixed(3)),
      occupancy: normalizedNumber(value.occupancy, defaultOccupancy),
    })
  }

  function objectInfoData(value) {
    if (value && typeof value === 'object' && value.data && typeof value.data === 'object') return value.data
    return value && typeof value === 'object' ? value : {}
  }

  function nodeInput(nodeInfo, inputName) {
    return nodeInfo?.input?.required?.[inputName] || nodeInfo?.input?.optional?.[inputName] || null
  }

  function comboOptions(nodeInfo, inputName) {
    const entry = nodeInput(nodeInfo, inputName)
    if (!Array.isArray(entry)) return []
    if (Array.isArray(entry[0])) return entry[0].map(cleanText).filter(Boolean)
    if (entry[0] === 'COMBO' && Array.isArray(entry[1]?.options)) {
      return entry[1].options.map(cleanText).filter(Boolean)
    }
    return []
  }

  function normalizedName(value) {
    return cleanText(value).toLowerCase().replace(/\\/g, '/')
  }

  function supportsIdentityImage(objectInfoValue) {
    const info = objectInfoData(objectInfoValue)
    const image2 = nodeInput(info.TextEncodeQwenImageEditPlus, 'image2')
    return Array.isArray(image2) && normalizedName(image2[0]) === 'image'
  }

  function selectModel(options, predicate, score, label) {
    const ranked = (Array.isArray(options) ? options : [])
      .filter((name) => predicate(normalizedName(name)))
      .map((name) => ({ name, score: Number(score(normalizedName(name))) || 0 }))
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    if (!ranked.length) {
      throw typedError('AIFX_LOCAL_MODEL_UNAVAILABLE', `NovaFlow AI Runtime has no compatible ${label}.`, {
        label,
        available: Array.isArray(options) ? [...options] : [],
      })
    }
    return ranked[0].name
  }

  function selectExactOption(nodeInfo, inputName, preferred, label) {
    const options = comboOptions(nodeInfo, inputName)
    for (const wanted of preferred) {
      const match = options.find((option) => normalizedName(option) === normalizedName(wanted))
      if (match) return match
    }
    throw typedError('AIFX_LOCAL_NODE_OPTION_UNAVAILABLE', `NovaFlow AI Runtime has no compatible ${label}.`, {
      inputName,
      preferred,
      available: options,
    })
  }

  function resolveModels(objectInfoValue) {
    const info = objectInfoData(objectInfoValue)
    const missingNodes = REQUIRED_NODES.filter((name) => !info[name])
    if (missingNodes.length) {
      throw typedError('AIFX_LOCAL_DEPENDENCY_MISSING', `NovaFlow AI Runtime is missing required AIFX nodes: ${missingNodes.join(', ')}`, {
        missingNodes,
      })
    }

    const checkpoint = selectModel(
      comboOptions(info.CheckpointLoaderSimple, 'ckpt_name'),
      (name) => name === 'qwen-rapid-aio-nsfw-v20.safetensors',
      () => 1,
      'Qwen Rapid AIO checkpoint',
    )
    const controlNet = selectModel(
      comboOptions(info.ControlNetLoader, 'control_net_name'),
      (name) => name.includes('qwen') && name.includes('image') && name.includes('control') && name.includes('union'),
      (name) => (name.includes('controlnet-union') ? 12 : 0) + (name.includes('instantx') ? 2 : 0),
      'Qwen Image ControlNet Union',
    )

    const samplerName = selectExactOption(info.KSampler, 'sampler_name', ['euler_ancestral'], 'Qwen Rapid sampler')
    const scheduler = selectExactOption(info.KSampler, 'scheduler', ['beta'], 'Qwen Rapid scheduler')
    const controlType = selectExactOption(
      info.SetUnionControlNetType,
      'type',
      [DEFAULT_CONTROL_TYPE, 'canny/lineart/anime_lineart/mlsd'],
      'Qwen ControlNet compatibility selector',
    )

    return Object.freeze({
      checkpoint,
      controlNet,
      samplerName,
      scheduler,
      controlType,
    })
  }

  function align16(value, label) {
    const number = Math.round(Number(value))
    if (!Number.isFinite(number) || number < 16 || number > 16384) {
      throw typedError('AIFX_LOCAL_DIMENSION_INVALID', `${label} must be between 16 and 16384 pixels.`, {
        label,
        value,
      })
    }
    return Math.ceil(number / 16) * 16
  }

  function normalizeSeed(value) {
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0) return Math.floor(Math.random() * 2147483647)
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number))
  }

  function compilePrompts(options) {
    const target = cleanText(options?.prompt) || 'Transform the effect into the material and energy style shown in Image 2.'
    const anchorRole = normalizeAnchorRole(options?.anchorRole, true)
    const anchorFrame = anchorRole ? normalizeAnchorFrame(options?.anchorFrame, anchorRole) : null
    const sequencePlan = anchorRole
      ? Object.freeze([])
      : normalizeSequencePlan(options?.sequencePlan, options?.frameCount)
    const sequenceDirective = sequencePlanPrompt(sequencePlan)
    const materialType = materialTypeFor(options, target)
    const materialShape = MATERIAL_SHAPE_EVOLUTION[materialType] || MATERIAL_SHAPE_EVOLUTION.default
    const negative = cleanText(options?.negativePrompt) || DEFAULT_NEGATIVE_PROMPT
    if (options?.promptsPrecompiled === true) {
      const structure = cleanText(options?.structurePrompt)
      const style = cleanText(options?.stylePrompt)
      if (!structure || !style) {
        throw typedError(
          'AIFX_LOCAL_PRECOMPILED_PROMPT_INVALID',
          'Precompiled AIFX Local prompts require both structurePrompt and stylePrompt.',
        )
      }
      return Object.freeze({
        structure,
        style,
        negative,
        target,
        materialType,
        sequencePlan,
        anchorRole,
        anchorFrame,
        precompiled: true,
      })
    }
    if (anchorRole) {
      throw typedError(
        'AIFX_LOCAL_ANCHOR_PROMPT_REQUIRED',
        'Anchor generation requires prompts precompiled by compileLocalAnchor.',
        { anchorRole },
      )
    }
    const structure = [cleanText(options?.structurePrompt) || DEFAULT_STRUCTURE_PROMPT, sequenceDirective].filter(Boolean).join(' ')
    const customStylePrompt = cleanText(options?.stylePrompt)
    const styleBase = customStylePrompt || [
      'Image 2 is style and material guidance only; never copy its subject, composition or camera framing.',
      `Target effect direction: ${target}`,
      'Transfer its material, color palette, glow behavior, highlights, internal texture, edge breakup and particles consistently across every frame.',
    ].join(' ')
    const style = [
      styleBase,
      `MATERIAL-SPECIFIC OUTLINE EVOLUTION (${materialType}): ${materialShape}`,
      'Do not retain Image 1 as a recolored cutout or copy its pixel silhouette.',
      'Output one chronological animation sprite sheet, never a gallery, contact-sheet variants, or independent design options.',
      'Output only the finished sprite sheet with clean dark neutral gutters and no annotations.',
    ].filter(Boolean).join(' ')
    return Object.freeze({
      structure,
      style,
      negative,
      target,
      materialType,
      sequencePlan,
      anchorRole: '',
      anchorFrame: null,
      precompiled: false,
    })
  }

  function buildWorkflow(options = {}) {
    const anchorRole = normalizeAnchorRole(options.anchorRole, true)
    const anchorFrame = anchorRole ? normalizeAnchorFrame(options.anchorFrame, anchorRole) : null
    const sheetImageName = cleanText(options.guideImageName || options.sheetImageName)
    const styleImageName = cleanText(options.styleImageName)
    const identityImageName = cleanText(options.identityImageName)
    if (!sheetImageName || !styleImageName) {
      throw typedError('AIFX_LOCAL_INPUT_INVALID', 'AIFX Local requires uploaded sheet and style image names.')
    }
    if (!anchorRole && (identityImageName || options.anchorFrame != null)) {
      throw typedError(
        'AIFX_LOCAL_ANCHOR_ROLE_REQUIRED',
        'anchorRole is required when anchorFrame or identityImageName is provided.',
      )
    }
    if (anchorRole === 'peak' && identityImageName) {
      throw typedError(
        'AIFX_LOCAL_ANCHOR_IDENTITY_FORBIDDEN',
        'The peak anchor must establish identity and cannot receive identityImageName.',
      )
    }
    const materialReferenceMode = cleanText(options.materialReferenceMode)
    const semanticMaterialConditioning = Boolean(
      anchorRole
      && anchorRole !== 'peak'
      && !identityImageName
      && materialReferenceMode === 'semantic-peak-material-identity',
    )
    const peakMaterialTokenConditioning = Boolean(
      anchorRole
      && anchorRole !== 'peak'
      && materialReferenceMode === 'generated-peak-material-token',
    )

    const models = resolveModels(options.objectInfo)
    if (identityImageName && !supportsIdentityImage(options.objectInfo)) {
      throw typedError(
        'AIFX_LOCAL_IDENTITY_INPUT_UNAVAILABLE',
        'TextEncodeQwenImageEditPlus does not expose a second image input for the peak identity reference.',
      )
    }
    const requestedWidth = Math.round(Number(options.width))
    const requestedHeight = Math.round(Number(options.height))
    const width = align16(requestedWidth, 'Sprite-sheet width')
    const height = align16(requestedHeight, 'Sprite-sheet height')
    const requestedStrength = Number(options.strength)
    const effectiveStrength = clamp(Number.isFinite(requestedStrength) ? requestedStrength : 0.7, 0, 1)
    // Qwen treats the conditioning mix as a generative-composition weight, not
    // as a harmless UI opacity. Keep layout conditioning useful while leaving
    // later denoising steps free to form material-specific silhouettes.
    const conditioningStrength = Math.round(clamp(0.45 + effectiveStrength * 0.18, 0.45, 0.64) * 10000) / 10000
    const stagedReferenceConditioning = Boolean(anchorRole)
    const tailMaterialVocabulary = anchorRole === 'breakup' || anchorRole === 'dissipation'
    const visualReferenceEndPercent = semanticMaterialConditioning
      ? 0
      : peakMaterialTokenConditioning
        // The token is deliberately macro-free, so it can safely carry material
        // identity during the earliest denoising evaluations without copying the
        // accepted peak silhouette. Tail anchors get only the first evaluation;
        // body anchors keep one additional early evaluation for identity stability.
        ? tailMaterialVocabulary ? 0.12 : 0.25
      : stagedReferenceConditioning
      ? tailMaterialVocabulary ? 0.12 : 0.25
      : 1
    const controlStrength = clamp(Number.isFinite(Number(options.controlStrength)) ? options.controlStrength : DEFAULT_CONTROL_STRENGTH, 0, 1)
    const controlEndPercent = clamp(Number.isFinite(Number(options.controlEndPercent)) ? options.controlEndPercent : DEFAULT_CONTROL_END_PERCENT, 0.01, 1)
    const prompts = compilePrompts({ ...options, anchorRole, anchorFrame })
    const outputPrefix = cleanText(options.outputPrefix) || `NovaFlow_VFX_${Date.now()}`
    const seed = normalizeSeed(options.seed)
    const styleConditioningInputs = semanticMaterialConditioning
      ? {
          clip: ['3', 1],
          prompt: prompts.style,
        }
      : stagedReferenceConditioning
      ? {
          clip: ['3', 1],
          vae: ['3', 2],
          image1: ['2', 0],
          prompt: prompts.style,
        }
      : {
          clip: ['3', 1],
          vae: ['3', 2],
          image1: ['1', 0],
          image2: ['2', 0],
          prompt: prompts.style,
        }
    if (identityImageName) {
      styleConditioningInputs[stagedReferenceConditioning ? 'image2' : 'image3'] = ['18', 0]
    }

    const workflow = {
      '1': { class_type: 'LoadImage', inputs: { image: sheetImageName } },
      '2': { class_type: 'LoadImage', inputs: { image: styleImageName } },
      '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: models.checkpoint } },
      '7': {
        class_type: stagedReferenceConditioning ? 'TextEncodeQwenImageEdit' : 'TextEncodeQwenImageEditPlus',
        inputs: stagedReferenceConditioning
          ? { clip: ['3', 1], prompt: prompts.structure }
          : { clip: ['3', 1], vae: ['3', 2], image1: ['1', 0], prompt: prompts.structure },
      },
      '8': {
        class_type: semanticMaterialConditioning ? 'TextEncodeQwenImageEdit' : 'TextEncodeQwenImageEditPlus',
        inputs: styleConditioningInputs,
      },
      '9': {
        class_type: 'ConditioningAverage',
        inputs: {
          conditioning_to: ['8', 0],
          conditioning_from: ['7', 0],
          conditioning_to_strength: conditioningStrength,
        },
      },
      '10': {
        class_type: 'TextEncodeQwenImageEdit',
        inputs: { clip: ['3', 1], prompt: prompts.negative },
      },
      '11': { class_type: 'ControlNetLoader', inputs: { control_net_name: models.controlNet } },
      '12': {
        class_type: 'SetUnionControlNetType',
        inputs: { control_net: ['11', 0], type: models.controlType },
      },
      '13': {
        class_type: 'ControlNetApplyAdvanced',
        inputs: {
          positive: [stagedReferenceConditioning && !semanticMaterialConditioning ? '21' : '9', 0],
          negative: ['10', 0],
          control_net: ['12', 0],
          image: ['1', 0],
          strength: controlStrength,
          start_percent: 0,
          end_percent: controlEndPercent,
          vae: ['3', 2],
        },
      },
      '14': {
        class_type: 'EmptyQwenImageLayeredLatentImage',
        inputs: { width, height, layers: 0, batch_size: 1 },
      },
      '15': {
        class_type: 'KSampler',
        inputs: {
          model: ['3', 0],
          seed,
          steps: 6,
          cfg: 1,
          sampler_name: models.samplerName,
          scheduler: models.scheduler,
          positive: ['13', 0],
          negative: ['13', 1],
          latent_image: ['14', 0],
          denoise: 1,
        },
      },
      '16': { class_type: 'VAEDecode', inputs: { samples: ['15', 0], vae: ['3', 2] } },
      '17': { class_type: 'SaveImage', inputs: { images: ['16', 0], filename_prefix: outputPrefix } },
    }
    if (identityImageName) {
      workflow['18'] = { class_type: 'LoadImage', inputs: { image: identityImageName } }
    }
    if (stagedReferenceConditioning && !semanticMaterialConditioning) {
      workflow['19'] = {
        class_type: 'ConditioningSetTimestepRange',
        inputs: { conditioning: ['8', 0], start: 0, end: visualReferenceEndPercent },
      }
      workflow['20'] = {
        class_type: 'ConditioningSetTimestepRange',
        // The Rapid sampler keeps the short tail reference window at its first
        // evaluation. Keep the role-specific structure condition active across the
        // full tail schedule so that first evaluation averages token identity with
        // breakup/dissipation topology instead of becoming a token-only shape lock.
        inputs: {
          conditioning: ['7', 0],
          start: peakMaterialTokenConditioning && tailMaterialVocabulary ? 0 : visualReferenceEndPercent,
          end: 1,
        },
      }
      workflow['21'] = {
        class_type: 'ConditioningCombine',
        inputs: { conditioning_1: ['19', 0], conditioning_2: ['20', 0] },
      }
    }

    const warnings = []
    if (Number.isFinite(requestedStrength) && requestedStrength !== effectiveStrength) {
      warnings.push(`Style strength was clamped from ${requestedStrength} to ${effectiveStrength}.`)
    }
    if (requestedWidth !== width || requestedHeight !== height) {
      warnings.push(`Sprite-sheet latent size was aligned from ${requestedWidth}x${requestedHeight} to ${width}x${height}.`)
    }

    const modelKey = [PIPELINE, models.checkpoint, models.controlNet].join(':')
    return Object.freeze({
      version: VERSION,
      pipeline: PIPELINE,
      workflow,
      modelKey,
      models,
      prompts,
      effectiveStrength,
      conditioningStrength,
      conditioningMode: semanticMaterialConditioning
        ? 'semantic-material-identity-plus-motion-control'
        : peakMaterialTokenConditioning
          ? tailMaterialVocabulary
            ? 'parallel-early-peak-material-token-tail-topology-synthesis'
            : 'early-peak-material-token-phase-topology-synthesis'
        : stagedReferenceConditioning ? 'early-visual-material-late-motion-synthesis' : 'average',
      visualReferenceEndPercent,
      visualReferenceConnected: !semanticMaterialConditioning,
      visualReferenceEffective: !semanticMaterialConditioning && visualReferenceEndPercent > 0,
      semanticMaterialConditioning,
      peakMaterialTokenConditioning,
      materialReferenceMode,
      tailMaterialVocabulary,
      controlStrength,
      controlEndPercent,
      controlType: models.controlType,
      sequencePlan: prompts.sequencePlan,
      anchorRole: prompts.anchorRole,
      anchorFrame: prompts.anchorFrame,
      identityConditioned: Boolean(identityImageName),
      promptsPrecompiled: prompts.precompiled,
      seed,
      width,
      height,
      requestedWidth,
      requestedHeight,
      warnings: Object.freeze(warnings),
    })
  }

  return Object.freeze({
    VERSION,
    PIPELINE,
    REQUIRED_NODES,
    DEFAULT_CONTROL_TYPE,
    DEFAULT_CONTROL_STRENGTH,
    DEFAULT_CONTROL_END_PERCENT,
    ANCHOR_ROLES,
    DEFAULT_STRUCTURE_PROMPT,
    DEFAULT_NEGATIVE_PROMPT,
    MATERIAL_SHAPE_EVOLUTION,
    comboOptions,
    resolveModels,
    defaultSequencePlan,
    normalizeSequencePlan,
    normalizeAnchorRole,
    normalizeAnchorFrame,
    supportsIdentityImage,
    compilePrompts,
    buildWorkflow,
  })
})
