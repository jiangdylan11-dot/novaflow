(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceMiniMaxH3Workflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const MODEL_ID = 'MiniMax_h3'
  const MODES = Object.freeze(['t2v', 'i2v', 'fl2v', 'r2v'])
  const MODE_SET = new Set(MODES)
  const OUTPUT_FPS = 24
  const DEFAULT_STEPS = 4
  const OUTPUT_STEPS = DEFAULT_STEPS
  const STEP_OPTIONS = Object.freeze([4, 20])
  const MIN_STEPS = 1
  const MAX_STEPS = 10000
  // Kept as a compatibility alias for older callers. R2V now shares the
  // editable default and the same 1..10000 step range as every H3 mode.
  const R2V_STEPS = DEFAULT_STEPS
  const RESOLUTION_MULTIPLE = 32
  const MIN_MEGAPIXELS = 0.2
  const MAX_MEGAPIXELS = 2
  const DEFAULT_WIDTH = 480
  const DEFAULT_HEIGHT = 864
  const DEFAULT_DURATION = 5
  const MIN_DURATION = 1
  const MAX_DURATION = 15
  const DURATION_STEP = 0.01
  const DEFAULT_PREFIX = 'video/MiniMax_H3'
  const MAX_REFERENCE_IMAGES = 4

  const ASPECT_RATIOS = Object.freeze([
    Object.freeze({ value: '1:1', width: 1, height: 1, orientation: 'square', label: '1:1（方形）' }),
    Object.freeze({ value: '2:3', width: 2, height: 3, orientation: 'portrait', label: '2:3（竖屏照片）' }),
    Object.freeze({ value: '3:2', width: 3, height: 2, orientation: 'landscape', label: '3:2（横屏照片）' }),
    Object.freeze({ value: '3:4', width: 3, height: 4, orientation: 'portrait', label: '3:4（竖屏标准）' }),
    Object.freeze({ value: '4:3', width: 4, height: 3, orientation: 'landscape', label: '4:3（横屏标准）' }),
    Object.freeze({ value: '9:16', width: 9, height: 16, orientation: 'portrait', label: '9:16（竖屏宽银幕）' }),
    Object.freeze({ value: '16:9', width: 16, height: 9, orientation: 'landscape', label: '16:9（横屏宽银幕）' }),
    Object.freeze({ value: '21:9', width: 21, height: 9, orientation: 'landscape', label: '21:9（超宽屏）' }),
  ])
  const MEGAPIXEL_OPTIONS = Object.freeze([
    0.2,
    0.3,
    0.4,
    0.5,
    0.6,
    0.7,
    0.8,
    0.9,
    0.98,
    1,
    1.2,
    1.5,
    1.8,
    2,
  ])
  // ResolutionSelector rounds both axes independently to 32. The widest 2 MP
  // preset therefore reaches 2208 x 960, slightly above a simple 2 * 1024^2 cap.
  const MAX_CANVAS_PIXELS = 2208 * 960

  const MODE_ALIASES = Object.freeze({
    t2v: 't2v',
    textvideo: 't2v',
    texttovideo: 't2v',
    i2v: 'i2v',
    imagevideo: 'i2v',
    imagetovideo: 'i2v',
    fl2v: 'fl2v',
    firstlast: 'fl2v',
    firstlastvideo: 'fl2v',
    firstlasttovideo: 'fl2v',
    r2v: 'r2v',
    reference: 'r2v',
    referencevideo: 'r2v',
    referencetovideo: 'r2v',
    multireference: 'r2v',
    multireferencevideo: 'r2v',
  })

  const MODELS = Object.freeze({
    fl2va: 'Minimax_H3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    ref2va: 'Minimax_H3\\minimax_h3_ref2va_pruned_int8_convrot.safetensors',
    turboLora: 'minimax_h3\\minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors',
    clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    videoVae: 'minimax_h3_video_vae_fp16.safetensors',
    audioVae: 'minimax_h3_audio_vae_fp32.safetensors',
  })

  const CORE_NODE_TYPES = new Set([
    'UNETLoader',
    'CLIPLoader',
    'VAELoader',
    'MiniMaxH3ImageToVideo',
    'MiniMaxH3ReferenceToVideo',
    'LoraLoaderModelOnly',
    'BasicScheduler',
    'KSamplerSelect',
    'RandomNoise',
    'BasicGuider',
    'SamplerCustomAdvanced',
    'VAEDecode',
    'VAEDecodeAudio',
    'CreateVideo',
    'SaveVideo',
    'LoadImage',
    'LoadVideo',
    'GetVideoComponents',
    'LoadAudio',
  ])

  const FORBIDDEN_KEY_TOKENS = new Set([
    'high',
    'low',
    'highmodel',
    'lowmodel',
    'lora',
    'loras',
    'loraname',
    'lorastrength',
    'kj',
    'kjnodes',
    'sage',
    'sageattention',
    'tespeed',
    'negative',
    'negativeprompt',
    'unethigh',
    'unethighname',
    'unetlow',
    'unetlowname',
    'highunetname',
    'lowunetname',
  ])

  const LOCKED_OPTION_TOKENS = new Set([
    'unet',
    'unetname',
    'diffusionmodel',
    'clipname',
    'vaename',
    'videovae',
    'audiovae',
    'sampler',
    'samplername',
    'scheduler',
    'denoise',
    'fps',
    'bitdepth',
    'refimagesize',
  ])

  const LORA_DESCRIPTOR_KEYS = new Set([
    'name',
    'fingerprint',
    'strength',
    'weight',
    'enabled',
    'modelFamily',
    'kind',
    'supportedSteps',
  ])

  function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function normalizedKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  function normalizeMode(value) {
    const source = isRecord(value) ? value.mode : value
    const token = normalizedKey(source)
    const mode = MODE_ALIASES[token] || token
    if (!MODE_SET.has(mode)) {
      throw new TypeError('Unsupported MiniMax H3 mode: ' + (source || 'missing'))
    }
    return mode
  }

  function optionBag(options) {
    if (!isRecord(options)) throw new TypeError('MiniMax H3 options must be an object')
    const params = isRecord(options.params) ? options.params : {}
    return { ...params, ...options }
  }

  function rejectLockedOptions(options) {
    const seen = new WeakSet()
    const visit = (value, path) => {
      if (!value || typeof value !== 'object' || seen.has(value)) return
      seen.add(value)
      for (const [key, child] of Object.entries(value)) {
        const token = normalizedKey(key)
        const controlledLoras = token === 'loras' && (
          path.length === 0 ||
          (path.length === 1 && normalizedKey(path[0]) === 'params')
        )
        if ((FORBIDDEN_KEY_TOKENS.has(token) && !controlledLoras) || LOCKED_OPTION_TOKENS.has(token)) {
          throw new TypeError('MiniMax H3 option is not supported: ' + key)
        }
        visit(child, path.concat(key))
      }
    }
    visit(options, [])
  }

  function ensureModelIdentity(options) {
    for (const key of ['model', 'modelId']) {
      if (options[key] == null || options[key] === '') continue
      if (String(options[key]).trim() !== MODEL_ID) {
        throw new TypeError('MiniMax H3 model id is fixed to ' + MODEL_ID)
      }
    }
  }

  function clampInteger(value, fallback, minimum, maximum) {
    if (value == null || value === '') return fallback
    const parsed = Math.round(Number(value))
    const normalized = Number.isFinite(parsed) ? parsed : fallback
    return Math.max(minimum, Math.min(maximum, normalized))
  }

  function alignDimension(value, fallback) {
    const clamped = clampInteger(value, fallback, 32, 16384)
    return Math.max(32, Math.round(clamped / RESOLUTION_MULTIPLE) * RESOLUTION_MULTIPLE)
  }

  function aspectRatio(value) {
    const token = String(value || '').trim().toLowerCase().replace(/[x/]/g, ':')
    const ratio = ASPECT_RATIOS.find((entry) => entry.value === token)
    if (!ratio) throw new RangeError('Unsupported MiniMax H3 aspect ratio: ' + (value || 'missing'))
    return ratio
  }

  function normalizeMegapixels(value, fallback = 0.4) {
    const parsed = value == null || value === '' ? fallback : Number(value)
    if (!Number.isFinite(parsed) || parsed < MIN_MEGAPIXELS || parsed > MAX_MEGAPIXELS) {
      throw new RangeError(
        'MiniMax H3 megapixels must be between ' + MIN_MEGAPIXELS + ' and ' + MAX_MEGAPIXELS,
      )
    }
    return Math.round(parsed * 100) / 100
  }

  function normalizeSteps(value, modeValue) {
    normalizeMode(modeValue)
    const parsed = value == null || value === '' ? DEFAULT_STEPS : Number(value)
    if (!Number.isInteger(parsed) || parsed < MIN_STEPS || parsed > MAX_STEPS) {
      throw new RangeError(
        'MiniMax H3 steps must be an integer between ' + MIN_STEPS + ' and ' + MAX_STEPS,
      )
    }
    return parsed
  }

  function loraIdentity(value) {
    return String(value || '').trim().replace(/\//g, '\\').toLowerCase()
  }

  function normalizeLoraName(value) {
    const name = String(value || '').trim()
    if (!name || /^[a-z]:/i.test(name) || /^[\\/]/.test(name)) {
      throw new TypeError('MiniMax H3 LoRA name must be a safe relative safetensors path')
    }
    const segments = name.split(/[\\/]/)
    if (
      segments.some((segment) => !segment || segment === '.' || segment === '..') ||
      !/\.safetensors$/i.test(segments[segments.length - 1])
    ) {
      throw new TypeError('MiniMax H3 LoRA name must be a safe relative safetensors path')
    }
    return name
  }

  function normalizeLoraFingerprint(value) {
    const fingerprint = String(value || '').trim()
    if (!/^v1:\d+:\d+(?:\.\d+)?:[a-f0-9]{64}$/.test(fingerprint)) {
      throw new TypeError('MiniMax H3 LoRA fingerprint is required and must match the catalog format')
    }
    return fingerprint
  }

  function normalizeLoras(value, modeValue, stepsValue) {
    const mode = normalizeMode(modeValue)
    const steps = normalizeSteps(stepsValue, mode)
    if (value == null) return []
    if (!Array.isArray(value)) throw new TypeError('MiniMax H3 loras must be an array')

    const expectedFamily = mode === 'r2v' ? 'ref2va' : 'fl2va'
    const internalTurboIdentity = loraIdentity(MODELS.turboLora)
    const seenNames = new Set()
    const normalized = []
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = value[index]
      if (!isRecord(descriptor)) {
        throw new TypeError('MiniMax H3 LoRA descriptor ' + index + ' must be an object')
      }
      for (const key of Object.keys(descriptor)) {
        if (!LORA_DESCRIPTOR_KEYS.has(key)) {
          throw new TypeError('MiniMax H3 LoRA descriptor contains an unsupported field: ' + key)
        }
      }
      if (descriptor.enabled != null && typeof descriptor.enabled !== 'boolean') {
        throw new TypeError('MiniMax H3 LoRA enabled must be a boolean')
      }

      const name = normalizeLoraName(descriptor.name)
      const fingerprint = normalizeLoraFingerprint(descriptor.fingerprint)
      const identity = loraIdentity(name)
      if (identity === internalTurboIdentity) {
        throw new TypeError('MiniMax H3 internal Turbo LoRA cannot be added as a user LoRA')
      }
      if (seenNames.has(identity)) {
        throw new TypeError('MiniMax H3 user LoRA cannot be added more than once: ' + name)
      }

      const kind = String(descriptor.kind || '').trim().toLowerCase()
      if (kind !== 'standard') {
        throw new TypeError('MiniMax H3 only supports standard user LoRAs; accelerator LoRAs are managed internally')
      }
      const modelFamily = String(descriptor.modelFamily || '').trim().toLowerCase()
      if (modelFamily !== expectedFamily) {
        throw new TypeError(
          'MiniMax H3 ' + mode + ' mode requires a ' + expectedFamily + ' LoRA',
        )
      }

      const hasStrength = descriptor.strength != null && descriptor.strength !== ''
      const hasWeight = descriptor.weight != null && descriptor.weight !== ''
      if (hasStrength && hasWeight && Number(descriptor.strength) !== Number(descriptor.weight)) {
        throw new TypeError('MiniMax H3 LoRA strength and weight must match when both are provided')
      }
      const strength = Number(hasStrength ? descriptor.strength : (hasWeight ? descriptor.weight : 1))
      if (!Number.isFinite(strength) || strength < 0 || strength > 2) {
        throw new RangeError('MiniMax H3 LoRA strength must be between 0 and 2')
      }

      let supportedSteps = null
      if (descriptor.supportedSteps != null) {
        if (!Array.isArray(descriptor.supportedSteps) || descriptor.supportedSteps.length === 0) {
          throw new TypeError('MiniMax H3 LoRA supportedSteps must be a non-empty array')
        }
        supportedSteps = descriptor.supportedSteps.map((entry) => {
          if (typeof entry !== 'number') {
            throw new TypeError('MiniMax H3 LoRA supportedSteps must contain numbers')
          }
          return normalizeSteps(entry, mode)
        })
        if (!supportedSteps.includes(steps)) {
          throw new RangeError('MiniMax H3 LoRA does not support ' + steps + ' steps: ' + name)
        }
      }

      seenNames.add(identity)
      if (descriptor.enabled === false) continue
      normalized.push({
        name,
        fingerprint,
        strength,
        enabled: true,
        modelFamily,
        kind,
        supportedSteps,
      })
    }
    return normalized
  }

  function calculateResolution(options = {}) {
    if (!isRecord(options)) throw new TypeError('MiniMax H3 resolution options must be an object')
    const multiple = options.multiple == null ? RESOLUTION_MULTIPLE : Number(options.multiple)
    if (multiple !== RESOLUTION_MULTIPLE) {
      throw new TypeError('MiniMax H3 resolution multiple is fixed to ' + RESOLUTION_MULTIPLE)
    }
    const ratio = aspectRatio(options.aspectRatio || options.aspect || '9:16')
    const megapixels = normalizeMegapixels(options.megapixels)
    const targetPixels = megapixels * 1024 * 1024
    const scale = Math.sqrt(targetPixels / (ratio.width * ratio.height))
    const width = Math.max(
      RESOLUTION_MULTIPLE,
      Math.round((ratio.width * scale) / RESOLUTION_MULTIPLE) * RESOLUTION_MULTIPLE,
    )
    const height = Math.max(
      RESOLUTION_MULTIPLE,
      Math.round((ratio.height * scale) / RESOLUTION_MULTIPLE) * RESOLUTION_MULTIPLE,
    )
    return Object.freeze({
      aspectRatio: ratio.value,
      orientation: ratio.orientation,
      megapixels,
      multiple: RESOLUTION_MULTIPLE,
      width,
      height,
      pixels: width * height,
    })
  }

  function matchResolution(options = {}) {
    if (!isRecord(options)) throw new TypeError('MiniMax H3 resolution match options must be an object')
    const width = alignDimension(options.width, DEFAULT_WIDTH)
    const height = alignDimension(options.height, DEFAULT_HEIGHT)
    let best = null
    for (const ratio of ASPECT_RATIOS) {
      for (const megapixels of MEGAPIXEL_OPTIONS) {
        const candidate = calculateResolution({ aspectRatio: ratio.value, megapixels })
        const score = Math.abs(candidate.width - width) + Math.abs(candidate.height - height)
        if (!best || score < best.score) best = { ...candidate, score }
      }
    }
    return Object.freeze({ ...best, exact: best.width === width && best.height === height })
  }

  function normalizeDimensions(options) {
    if (options.aspectRatio != null || options.aspect != null || options.megapixels != null) {
      return calculateResolution(options)
    }
    let width = alignDimension(options.width, DEFAULT_WIDTH)
    let height = alignDimension(options.height, DEFAULT_HEIGHT)
    if (width * height > MAX_CANVAS_PIXELS) {
      throw new RangeError('MiniMax H3 canvas exceeds the supported 2 MP preset envelope')
    }
    return { width, height }
  }

  function alignFrameCount(value) {
    let frames = clampInteger(value, 124, 5, 362)
    while (frames % 17 !== 5 && frames < 362) frames += 1
    return Math.min(362, frames)
  }

  function normalizeDuration(value) {
    const source = isRecord(value)
      ? firstProvided(value.seconds, value.duration, value.durationSeconds)
      : value
    const parsed = source == null || source === '' ? DEFAULT_DURATION : Number(source)
    if (!Number.isFinite(parsed) || parsed < MIN_DURATION || parsed > MAX_DURATION) {
      throw new RangeError(
        'MiniMax H3 duration must be between ' + MIN_DURATION + ' and ' + MAX_DURATION + ' seconds',
      )
    }
    const requestedDuration = Math.round(parsed / DURATION_STEP) * DURATION_STEP
    const frames = alignFrameCount(Math.round(requestedDuration * OUTPUT_FPS))
    return Object.freeze({
      requestedDuration: Math.round(requestedDuration * 100) / 100,
      frames,
      actualDuration: frames / OUTPUT_FPS,
      fps: OUTPUT_FPS,
    })
  }

  function normalizeLength(options) {
    if (options.length != null && options.length !== '') {
      return alignFrameCount(options.length)
    }
    return normalizeDuration(firstProvided(options.duration, options.durationSeconds, options.seconds)).frames
  }

  function normalizeSeed(value) {
    return clampInteger(value, 0, 0, Number.MAX_SAFE_INTEGER)
  }

  function requiredText(value, label) {
    const text = String(value == null ? '' : value).trim()
    if (!text) throw new TypeError(label + ' is required')
    return text
  }

  function optionalFile(value, label) {
    if (value == null || value === '') return ''
    if (typeof value !== 'string') throw new TypeError(label + ' must be a file name')
    const file = value.trim()
    if (!file) return ''
    return file
  }

  function fileList(value, label) {
    if (value == null) return []
    if (!Array.isArray(value)) throw new TypeError(label + ' must be an array')
    return value
      .map((entry, index) => optionalFile(entry, label + '[' + index + ']'))
      .filter(Boolean)
  }

  function firstProvided() {
    for (const value of arguments) {
      if (value != null && value !== '') return value
    }
    return ''
  }

  function node(classType, inputs, title) {
    return {
      inputs: inputs || {},
      class_type: classType,
      _meta: { title: title || classType },
    }
  }

  function createBaseWorkflow(mode, stepsValue) {
    const steps = normalizeSteps(stepsValue, mode)
    const conditioningClass = mode === 'r2v'
      ? 'MiniMaxH3ReferenceToVideo'
      : 'MiniMaxH3ImageToVideo'
    const conditioningInputs = {
      clip: ['2', 0],
      vae: ['3', 0],
      prompt: '',
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      length: 124,
    }
    if (mode === 'r2v') {
      conditioningInputs.audio_vae = ['4', 0]
      conditioningInputs.ref_image_size = 'match'
    }

    const workflow = {
      '1': node('UNETLoader', {
        unet_name: mode === 'r2v' ? MODELS.ref2va : MODELS.fl2va,
        weight_dtype: 'default',
      }, 'MiniMax H3 UNet'),
      '2': node('CLIPLoader', {
        clip_name: MODELS.clip,
        type: 'minimax',
        device: 'default',
      }, 'MiniMax H3 text encoder'),
      '3': node('VAELoader', {
        vae_name: MODELS.videoVae,
      }, 'MiniMax H3 video VAE'),
      '4': node('VAELoader', {
        vae_name: MODELS.audioVae,
      }, 'MiniMax H3 audio VAE'),
      '5': node(conditioningClass, conditioningInputs, conditioningClass),
      '6': node('BasicScheduler', {
        scheduler: 'simple',
        steps,
        denoise: 1,
        model: ['1', 0],
      }, 'MiniMax H3 scheduler'),
      '7': node('KSamplerSelect', {
        sampler_name: 'res_multistep',
      }, 'MiniMax H3 sampler'),
      '8': node('RandomNoise', {
        noise_seed: 0,
      }, 'MiniMax H3 seed'),
      '9': node('BasicGuider', {
        model: ['1', 0],
        conditioning: ['5', 0],
      }, 'MiniMax H3 guider'),
      '10': node('SamplerCustomAdvanced', {
        noise: ['8', 0],
        guider: ['9', 0],
        sampler: ['7', 0],
        sigmas: ['6', 0],
        latent_image: ['5', 1],
      }, 'MiniMax H3 sampling'),
      '11': node('VAEDecode', {
        samples: ['10', 0],
        vae: ['3', 0],
      }, 'Decode MiniMax H3 video'),
      '12': node('VAEDecodeAudio', {
        samples: ['10', 0],
        vae: ['4', 0],
      }, 'Decode MiniMax H3 audio'),
      '13': node('CreateVideo', {
        images: ['11', 0],
        audio: ['12', 0],
        fps: OUTPUT_FPS,
        bit_depth: 8,
      }, 'Create MiniMax H3 video'),
      '14': node('SaveVideo', {
        video: ['13', 0],
        filename_prefix: DEFAULT_PREFIX,
        format: 'auto',
        codec: 'auto',
      }, 'Save MiniMax H3 video'),
    }

    if (steps === 4) {
      workflow['15'] = node('LoraLoaderModelOnly', {
        model: ['1', 0],
        lora_name: MODELS.turboLora,
        strength_model: 0.75,
      }, 'MiniMax H3 Turbo 4-step LoRA')
      workflow['9'].inputs.model = ['15', 0]
    }

    return workflow
  }

  function createTemplate(modeValue) {
    const mode = normalizeMode(modeValue)
    const steps = normalizeSteps(isRecord(modeValue) ? modeValue.steps : undefined, mode)
    const workflow = createBaseWorkflow(mode, steps)
    if (mode === 'i2v') {
      workflow['20'] = node('LoadImage', { image: 'first-frame.png' }, 'first_frame')
      workflow['5'].inputs.first_frame = ['20', 0]
    } else if (mode === 'fl2v') {
      workflow['20'] = node('LoadImage', { image: 'first-frame.png' }, 'first_frame')
      workflow['21'] = node('LoadImage', { image: 'last-frame.png' }, 'last_frame')
      workflow['5'].inputs.first_frame = ['20', 0]
      workflow['5'].inputs.last_frame = ['21', 0]
    } else if (mode === 'r2v') {
      for (let index = 0; index < MAX_REFERENCE_IMAGES; index += 1) {
        const id = String(20 + index)
        workflow[id] = node('LoadImage', {
          image: 'reference-image-' + (index + 1) + '.png',
        }, 'reference_image_' + (index + 1))
        workflow['5'].inputs['ref_images.ref_image_' + index] = [id, 0]
      }
      workflow['24'] = node('LoadVideo', { file: 'reference-video.mp4' }, 'reference_video')
      workflow['25'] = node('GetVideoComponents', { video: ['24', 0] }, 'reference_video_components')
      workflow['26'] = node('LoadAudio', { audio: 'reference-audio.wav' }, 'reference_audio')
      workflow['5'].inputs['ref_videos.ref_video_0'] = ['25', 0]
      workflow['5'].inputs['ref_audios.ref_audio_0'] = ['26', 0]
    }
    return workflow
  }

  function getWorkflowJson(options = {}) {
    return JSON.stringify(createTemplate(options))
  }

  function unwrapWorkflow(value) {
    const workflow = isRecord(value) && isRecord(value.prompt) ? value.prompt : value
    if (!isRecord(workflow)) throw new TypeError('MiniMax H3 workflow JSON is invalid')
    return workflow
  }

  function entriesByClass(workflow, classType) {
    return Object.entries(workflow).filter(([, value]) => value && value.class_type === classType)
  }

  function oneByClass(workflow, classType) {
    const matches = entriesByClass(workflow, classType)
    if (matches.length !== 1) {
      throw new TypeError('MiniMax H3 workflow requires exactly one ' + classType)
    }
    return matches[0]
  }

  function isLink(value) {
    return Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      Number.isInteger(value[1])
  }

  function inferMode(workflow) {
    const reference = entriesByClass(workflow, 'MiniMaxH3ReferenceToVideo')
    const image = entriesByClass(workflow, 'MiniMaxH3ImageToVideo')
    if (reference.length === 1 && image.length === 0) return 'r2v'
    if (image.length !== 1 || reference.length !== 0) {
      throw new TypeError('MiniMax H3 workflow has an invalid conditioning topology')
    }
    const inputs = image[0][1].inputs || {}
    if (isLink(inputs.last_frame)) return 'fl2v'
    if (isLink(inputs.first_frame)) return 'i2v'
    return 't2v'
  }

  function nextNodeId(workflow, start = 20) {
    let value = start
    while (workflow[String(value)]) value += 1
    return String(value)
  }

  function removeReferenceLoaders(workflow) {
    const removable = new Set(['LoadImage', 'LoadVideo', 'GetVideoComponents', 'LoadAudio'])
    for (const [id, value] of Object.entries(workflow)) {
      if (removable.has(value && value.class_type)) delete workflow[id]
    }
  }

  function removeReferenceInputs(inputs) {
    for (const key of Object.keys(inputs)) {
      if (
        key.startsWith('ref_images.') ||
        key.startsWith('ref_videos.') ||
        key.startsWith('ref_video_audios.') ||
        key.startsWith('ref_audios.')
      ) {
        delete inputs[key]
      }
    }
  }

  function patchReferenceWorkflow(workflow, conditioning, options) {
    const referenceImages = fileList(
      options.referenceImages != null ? options.referenceImages : options.images,
      'referenceImages',
    )
    if (referenceImages.length > MAX_REFERENCE_IMAGES) {
      throw new RangeError('MiniMax H3 supports at most four reference images')
    }
    const referenceVideo = optionalFile(
      firstProvided(options.referenceVideo, options.video),
      'referenceVideo',
    )
    const referenceAudio = optionalFile(
      firstProvided(options.referenceAudio, options.audio),
      'referenceAudio',
    )
    if (!referenceImages.length && !referenceVideo && !referenceAudio) {
      throw new TypeError('MiniMax H3 reference mode requires an image, video, or audio reference')
    }
    if (referenceAudio && !referenceImages.length && !referenceVideo) {
      throw new TypeError('MiniMax H3 standalone audio cannot be the only reference')
    }

    removeReferenceLoaders(workflow)
    removeReferenceInputs(conditioning.inputs)

    for (let index = 0; index < referenceImages.length; index += 1) {
      const id = nextNodeId(workflow)
      workflow[id] = node('LoadImage', {
        image: referenceImages[index],
      }, 'reference_image_' + (index + 1))
      conditioning.inputs['ref_images.ref_image_' + index] = [id, 0]
    }

    if (referenceVideo) {
      const videoId = nextNodeId(workflow)
      workflow[videoId] = node('LoadVideo', { file: referenceVideo }, 'reference_video')
      const componentsId = nextNodeId(workflow)
      workflow[componentsId] = node('GetVideoComponents', {
        video: [videoId, 0],
      }, 'reference_video_components')
      conditioning.inputs['ref_videos.ref_video_0'] = [componentsId, 0]
    }

    if (referenceAudio) {
      const audioId = nextNodeId(workflow)
      workflow[audioId] = node('LoadAudio', { audio: referenceAudio }, 'reference_audio')
      conditioning.inputs['ref_audios.ref_audio_0'] = [audioId, 0]
    }
  }

  function patchFrameWorkflow(workflow, mode, conditioning, options) {
    const images = fileList(options.images, 'images')
    const firstFrame = optionalFile(
      firstProvided(options.firstFrame, options.firstImage, images[0]),
      'firstFrame',
    )
    const lastFrame = optionalFile(
      firstProvided(options.lastFrame, options.lastImage, images[1]),
      'lastFrame',
    )
    const video = optionalFile(firstProvided(options.referenceVideo, options.video), 'referenceVideo')
    const audio = optionalFile(firstProvided(options.referenceAudio, options.audio), 'referenceAudio')
    if (video || audio) {
      throw new TypeError('Video and audio references are only supported in MiniMax H3 r2v mode')
    }

    const imageNodes = entriesByClass(workflow, 'LoadImage')
    if (mode === 't2v') {
      if (firstFrame || lastFrame || images.length) {
        throw new TypeError('MiniMax H3 t2v mode does not accept image references')
      }
      if (imageNodes.length !== 0) throw new TypeError('MiniMax H3 t2v template contains image loaders')
      delete conditioning.inputs.first_frame
      delete conditioning.inputs.last_frame
      return
    }

    if (mode === 'i2v') {
      if (!firstFrame) throw new TypeError('MiniMax H3 i2v mode requires a first frame')
      if (lastFrame || images.length > 1) {
        throw new TypeError('MiniMax H3 i2v mode accepts exactly one image')
      }
      if (imageNodes.length !== 1) throw new TypeError('MiniMax H3 i2v template requires one LoadImage')
      imageNodes[0][1].inputs.image = firstFrame
      conditioning.inputs.first_frame = [imageNodes[0][0], 0]
      delete conditioning.inputs.last_frame
      return
    }

    if (!firstFrame || !lastFrame) {
      throw new TypeError('MiniMax H3 fl2v mode requires first and last frames')
    }
    if (images.length > 2) throw new TypeError('MiniMax H3 fl2v mode accepts exactly two images')
    if (imageNodes.length !== 2) throw new TypeError('MiniMax H3 fl2v template requires two LoadImage nodes')
    imageNodes[0][1].inputs.image = firstFrame
    imageNodes[1][1].inputs.image = lastFrame
    conditioning.inputs.first_frame = [imageNodes[0][0], 0]
    conditioning.inputs.last_frame = [imageNodes[1][0], 0]
  }

  function applyUserLoras(workflow, loras, steps) {
    const [unetId] = oneByClass(workflow, 'UNETLoader')
    const guider = oneByClass(workflow, 'BasicGuider')[1]
    let upstreamId = unetId
    if (steps === 4) {
      const internalTurbo = entriesByClass(workflow, 'LoraLoaderModelOnly')
        .find(([, value]) => loraIdentity(value.inputs.lora_name) === loraIdentity(MODELS.turboLora))
      if (!internalTurbo) {
        throw new TypeError('MiniMax H3 4-step workflow is missing its internal Turbo LoRA')
      }
      upstreamId = internalTurbo[0]
    }

    for (const descriptor of loras) {
      const id = nextNodeId(workflow, 30)
      workflow[id] = node('LoraLoaderModelOnly', {
        model: [upstreamId, 0],
        lora_name: descriptor.name,
        strength_model: descriptor.strength,
      }, 'MiniMax H3 user LoRA')
      upstreamId = id
    }
    guider.inputs.model = [upstreamId, 0]
  }

  function patchWorkflow(workflowValue, options = {}) {
    rejectLockedOptions(options)
    const normalized = optionBag(options)
    ensureModelIdentity(normalized)
    const mode = normalizeMode(normalized.mode)
    const workflow = clone(unwrapWorkflow(workflowValue))
    const templateMode = inferMode(workflow)
    if (templateMode !== mode) {
      throw new TypeError('MiniMax H3 workflow mode mismatch: expected ' + mode + ', found ' + templateMode)
    }
    const templateSteps = normalizeSteps(oneByClass(workflow, 'BasicScheduler')[1].inputs.steps, mode)
    const requestedSteps = normalizeSteps(
      normalized.steps == null || normalized.steps === '' ? templateSteps : normalized.steps,
      mode,
    )
    const loras = normalizeLoras(normalized.loras, mode, requestedSteps)
    if (templateSteps !== requestedSteps) {
      throw new TypeError(
        'MiniMax H3 workflow step topology mismatch: expected ' + requestedSteps + ', found ' + templateSteps,
      )
    }

    const conditioning = mode === 'r2v'
      ? oneByClass(workflow, 'MiniMaxH3ReferenceToVideo')[1]
      : oneByClass(workflow, 'MiniMaxH3ImageToVideo')[1]
    const dimensions = normalizeDimensions(normalized)
    conditioning.inputs.prompt = requiredText(normalized.prompt, 'MiniMax H3 prompt')
    conditioning.inputs.width = dimensions.width
    conditioning.inputs.height = dimensions.height
    conditioning.inputs.length = normalizeLength(normalized)
    oneByClass(workflow, 'RandomNoise')[1].inputs.noise_seed = normalizeSeed(normalized.seed)
    oneByClass(workflow, 'SaveVideo')[1].inputs.filename_prefix = String(
      firstProvided(normalized.outputPrefix, normalized.filenamePrefix, DEFAULT_PREFIX),
    ).trim() || DEFAULT_PREFIX

    if (mode === 'r2v') {
      conditioning.inputs.ref_image_size = 'match'
      patchReferenceWorkflow(workflow, conditioning, normalized)
    } else {
      patchFrameWorkflow(workflow, mode, conditioning, normalized)
    }

    // A supplied template may not smuggle pre-existing LoRA nodes into the
    // controlled chain. Validate the clean topology first, then build the
    // exact user chain declared by options.loras.
    validateWorkflow(workflow, { mode, steps: requestedSteps, loras: [] })
    applyUserLoras(workflow, loras, requestedSteps)
    validateWorkflow(workflow, { mode, steps: requestedSteps, loras })
    return workflow
  }

  function collectInputLinks(nodeValue) {
    const links = []
    for (const value of Object.values(nodeValue.inputs || {})) {
      if (isLink(value)) links.push(value)
    }
    return links
  }

  function requireLink(value, nodeId, outputIndex, label) {
    if (!isLink(value) || value[0] !== nodeId || value[1] !== outputIndex) {
      throw new TypeError(label + ' has an invalid link')
    }
  }

  function requireClassCount(workflow, classType, expected) {
    const count = entriesByClass(workflow, classType).length
    if (count !== expected) {
      throw new TypeError(
        'MiniMax H3 workflow requires ' + expected + ' ' + classType + ' node(s), found ' + count,
      )
    }
  }

  function validateReferenceTopology(workflow, conditioning) {
    const inputs = conditioning.inputs
    const imageEntries = Object.entries(inputs)
      .filter(([key]) => /^ref_images\.ref_image_\d+$/.test(key))
      .sort((a, b) => Number(a[0].match(/\d+$/)[0]) - Number(b[0].match(/\d+$/)[0]))
    const imageNodes = entriesByClass(workflow, 'LoadImage')
    if (imageEntries.length > MAX_REFERENCE_IMAGES || imageEntries.length !== imageNodes.length) {
      throw new TypeError('MiniMax H3 r2v image reference topology is invalid')
    }
    const usedImages = new Set()
    for (let index = 0; index < imageEntries.length; index += 1) {
      const [key, link] = imageEntries[index]
      if (key !== 'ref_images.ref_image_' + index || !isLink(link)) {
        throw new TypeError('MiniMax H3 r2v image references must be contiguous')
      }
      const target = workflow[link[0]]
      if (!target || target.class_type !== 'LoadImage' || link[1] !== 0 || usedImages.has(link[0])) {
        throw new TypeError('MiniMax H3 r2v image reference link is invalid')
      }
      usedImages.add(link[0])
    }

    const videoNodes = entriesByClass(workflow, 'LoadVideo')
    const componentNodes = entriesByClass(workflow, 'GetVideoComponents')
    const pairedVideoAudioKeys = Object.keys(inputs).filter((key) => key.startsWith('ref_video_audios.'))
    if (pairedVideoAudioKeys.length) {
      throw new TypeError('MiniMax H3 r2v uses the standalone audio slot only; embedded video audio is disabled')
    }
    if (videoNodes.length !== componentNodes.length || videoNodes.length > 1) {
      throw new TypeError('MiniMax H3 r2v video reference topology is invalid')
    }
    if (videoNodes.length === 1) {
      const [videoId] = videoNodes[0]
      const [componentId, componentNode] = componentNodes[0]
      requireLink(componentNode.inputs.video, videoId, 0, 'MiniMax H3 reference video components')
      requireLink(inputs['ref_videos.ref_video_0'], componentId, 0, 'MiniMax H3 reference video')
    } else if (inputs['ref_videos.ref_video_0'] != null) {
      throw new TypeError('MiniMax H3 r2v has dangling video reference inputs')
    }

    const audioNodes = entriesByClass(workflow, 'LoadAudio')
    if (audioNodes.length > 1) throw new TypeError('MiniMax H3 r2v supports one standalone audio reference')
    if (audioNodes.length === 1) {
      requireLink(
        inputs['ref_audios.ref_audio_0'],
        audioNodes[0][0],
        0,
        'MiniMax H3 standalone reference audio',
      )
    } else if (inputs['ref_audios.ref_audio_0'] != null) {
      throw new TypeError('MiniMax H3 r2v has a dangling standalone audio input')
    }

    if (!imageEntries.length && !videoNodes.length && !audioNodes.length) {
      throw new TypeError('MiniMax H3 r2v requires at least one reference')
    }
  }

  function validateWorkflow(workflowValue, options = {}) {
    const workflow = unwrapWorkflow(workflowValue)
    const ids = Object.keys(workflow)
    if (!ids.length) throw new TypeError('MiniMax H3 workflow is empty')

    for (const [id, value] of Object.entries(workflow)) {
      if (!isRecord(value) || typeof value.class_type !== 'string' || !value.class_type) {
        throw new TypeError('MiniMax H3 workflow node ' + id + ' has no class_type')
      }
      if (!CORE_NODE_TYPES.has(value.class_type)) {
        throw new TypeError('MiniMax H3 workflow contains a non-core node: ' + value.class_type)
      }
      if (!isRecord(value.inputs)) {
        throw new TypeError('MiniMax H3 workflow node ' + id + ' has invalid inputs')
      }
      for (const key of Object.keys(value.inputs)) {
        const token = normalizedKey(key)
        const internalTurboInput = value.class_type === 'LoraLoaderModelOnly' && token === 'loraname'
        if (FORBIDDEN_KEY_TOKENS.has(token) && !internalTurboInput) {
          throw new TypeError('MiniMax H3 workflow contains a forbidden input: ' + key)
        }
      }
      for (const link of collectInputLinks(value)) {
        if (!workflow[link[0]]) {
          throw new TypeError('MiniMax H3 workflow node ' + id + ' references missing node ' + link[0])
        }
      }
    }

    const expectedCounts = {
      UNETLoader: 1,
      CLIPLoader: 1,
      VAELoader: 2,
      BasicScheduler: 1,
      KSamplerSelect: 1,
      RandomNoise: 1,
      BasicGuider: 1,
      SamplerCustomAdvanced: 1,
      VAEDecode: 1,
      VAEDecodeAudio: 1,
      CreateVideo: 1,
      SaveVideo: 1,
    }
    for (const [classType, expected] of Object.entries(expectedCounts)) {
      requireClassCount(workflow, classType, expected)
    }

    const mode = inferMode(workflow)
    const requestedMode = isRecord(options) && options.mode != null
      ? normalizeMode(options.mode)
      : mode
    if (mode !== requestedMode) {
      throw new TypeError('MiniMax H3 workflow mode mismatch')
    }

    const [unetId, unet] = oneByClass(workflow, 'UNETLoader')
    const expectedUnet = mode === 'r2v' ? MODELS.ref2va : MODELS.fl2va
    if (
      unet.inputs.unet_name !== expectedUnet ||
      unet.inputs.weight_dtype !== 'default'
    ) {
      throw new TypeError('MiniMax H3 workflow uses the wrong UNet')
    }

    const clip = oneByClass(workflow, 'CLIPLoader')[1]
    if (
      clip.inputs.clip_name !== MODELS.clip ||
      clip.inputs.type !== 'minimax' ||
      clip.inputs.device !== 'default'
    ) {
      throw new TypeError('MiniMax H3 workflow uses the wrong text encoder')
    }

    const vaeNames = new Set(entriesByClass(workflow, 'VAELoader').map(([, value]) => value.inputs.vae_name))
    if (
      vaeNames.size !== 2 ||
      !vaeNames.has(MODELS.videoVae) ||
      !vaeNames.has(MODELS.audioVae)
    ) {
      throw new TypeError('MiniMax H3 workflow uses the wrong VAE set')
    }

    const scheduler = oneByClass(workflow, 'BasicScheduler')[1]
    const steps = normalizeSteps(scheduler.inputs.steps, mode)
    const requestedSteps = isRecord(options) && options.steps != null
      ? normalizeSteps(options.steps, mode)
      : steps
    if (steps !== requestedSteps || scheduler.inputs.steps !== steps) {
      throw new TypeError('MiniMax H3 workflow step count does not match the requested topology')
    }
    requireLink(scheduler.inputs.model, unetId, 0, 'MiniMax H3 scheduler model')
    if (
      scheduler.inputs.scheduler !== 'simple' ||
      scheduler.inputs.denoise !== 1
    ) {
      throw new TypeError('MiniMax H3 workflow must use the simple scheduler at full denoise')
    }
    const sampler = oneByClass(workflow, 'KSamplerSelect')[1]
    if (sampler.inputs.sampler_name !== 'res_multistep') {
      throw new TypeError('MiniMax H3 workflow uses the wrong sampler')
    }
    const guider = oneByClass(workflow, 'BasicGuider')[1]
    const hasDeclaredLoras = isRecord(options) && Object.prototype.hasOwnProperty.call(options, 'loras')
    const expectedUserLoras = hasDeclaredLoras
      ? normalizeLoras(options.loras, mode, steps)
      : []
    const loraLoaders = entriesByClass(workflow, 'LoraLoaderModelOnly')
    const expectedLoaderCount = expectedUserLoras.length + (steps === 4 ? 1 : 0)
    if (loraLoaders.length !== expectedLoaderCount) {
      if (!hasDeclaredLoras && loraLoaders.length > (steps === 4 ? 1 : 0)) {
        throw new TypeError('MiniMax H3 workflow contains an undeclared user LoRA')
      }
      throw new TypeError(
        'MiniMax H3 workflow LoRA count does not match the declared chain: expected ' +
        expectedLoaderCount + ', found ' + loraLoaders.length,
      )
    }

    const unusedLoaders = new Map(loraLoaders)
    const takeNextLoader = (upstreamId, label) => {
      const matches = Array.from(unusedLoaders.entries()).filter(([, value]) => (
        isLink(value.inputs.model) &&
        value.inputs.model[0] === upstreamId &&
        value.inputs.model[1] === 0
      ))
      if (matches.length !== 1) {
        throw new TypeError(label + ' has an invalid model-chain order')
      }
      unusedLoaders.delete(matches[0][0])
      return matches[0]
    }
    const requireLoraInputs = (value, expectedName, expectedStrength, label) => {
      const keys = Object.keys(value.inputs).sort()
      if (
        keys.length !== 3 ||
        keys[0] !== 'lora_name' ||
        keys[1] !== 'model' ||
        keys[2] !== 'strength_model' ||
        value.inputs.lora_name !== expectedName ||
        value.inputs.strength_model !== expectedStrength
      ) {
        throw new TypeError(label + ' has the wrong name or strength')
      }
    }

    let guiderModelId = unetId
    if (steps === 4) {
      const [turboId, turbo] = takeNextLoader(unetId, 'MiniMax H3 internal Turbo LoRA')
      requireLoraInputs(turbo, MODELS.turboLora, 0.75, 'MiniMax H3 internal Turbo LoRA')
      guiderModelId = turboId
    }
    for (let index = 0; index < expectedUserLoras.length; index += 1) {
      const descriptor = expectedUserLoras[index]
      const [loraId, loraNode] = takeNextLoader(
        guiderModelId,
        'MiniMax H3 user LoRA ' + (index + 1),
      )
      requireLoraInputs(
        loraNode,
        descriptor.name,
        descriptor.strength,
        'MiniMax H3 user LoRA ' + (index + 1),
      )
      guiderModelId = loraId
    }
    if (unusedLoaders.size) {
      throw new TypeError('MiniMax H3 workflow contains a LoRA outside the declared model chain')
    }
    requireLink(guider.inputs.model, guiderModelId, 0, 'MiniMax H3 guider model')

    const conditioning = mode === 'r2v'
      ? oneByClass(workflow, 'MiniMaxH3ReferenceToVideo')[1]
      : oneByClass(workflow, 'MiniMaxH3ImageToVideo')[1]
    if (
      !Number.isInteger(conditioning.inputs.width) ||
      !Number.isInteger(conditioning.inputs.height) ||
      conditioning.inputs.width % 32 !== 0 ||
      conditioning.inputs.height % 32 !== 0 ||
      conditioning.inputs.width <= 0 ||
      conditioning.inputs.height <= 0 ||
      conditioning.inputs.width * conditioning.inputs.height > MAX_CANVAS_PIXELS
    ) {
      throw new TypeError('MiniMax H3 workflow has invalid canvas dimensions')
    }
    if (
      !Number.isInteger(conditioning.inputs.length) ||
      conditioning.inputs.length < 5 ||
      conditioning.inputs.length > 362 ||
      conditioning.inputs.length % 17 !== 5
    ) {
      throw new TypeError('MiniMax H3 workflow has an invalid frame count')
    }

    const createVideo = oneByClass(workflow, 'CreateVideo')[1]
    if (createVideo.inputs.fps !== OUTPUT_FPS || createVideo.inputs.bit_depth !== 8) {
      throw new TypeError('MiniMax H3 output must be 24 fps at 8-bit')
    }

    if (mode === 't2v') {
      requireClassCount(workflow, 'LoadImage', 0)
      if (conditioning.inputs.first_frame != null || conditioning.inputs.last_frame != null) {
        throw new TypeError('MiniMax H3 t2v must not contain keyframes')
      }
    } else if (mode === 'i2v') {
      requireClassCount(workflow, 'LoadImage', 1)
      const imageId = oneByClass(workflow, 'LoadImage')[0]
      requireLink(conditioning.inputs.first_frame, imageId, 0, 'MiniMax H3 first frame')
      if (conditioning.inputs.last_frame != null) {
        throw new TypeError('MiniMax H3 i2v must not contain a last frame')
      }
    } else if (mode === 'fl2v') {
      requireClassCount(workflow, 'LoadImage', 2)
      const imageIds = new Set(entriesByClass(workflow, 'LoadImage').map(([id]) => id))
      if (
        !isLink(conditioning.inputs.first_frame) ||
        !isLink(conditioning.inputs.last_frame) ||
        !imageIds.has(conditioning.inputs.first_frame[0]) ||
        !imageIds.has(conditioning.inputs.last_frame[0]) ||
        conditioning.inputs.first_frame[0] === conditioning.inputs.last_frame[0]
      ) {
        throw new TypeError('MiniMax H3 fl2v keyframe topology is invalid')
      }
    } else {
      if (conditioning.inputs.ref_image_size !== 'match') {
        throw new TypeError('MiniMax H3 r2v reference image sizing is fixed to match')
      }
      validateReferenceTopology(workflow, conditioning)
    }

    if (mode !== 'r2v') {
      requireClassCount(workflow, 'LoadVideo', 0)
      requireClassCount(workflow, 'GetVideoComponents', 0)
      requireClassCount(workflow, 'LoadAudio', 0)
    }

    const saveVideo = oneByClass(workflow, 'SaveVideo')
    const reachable = new Set()
    const stack = [saveVideo[0]]
    while (stack.length) {
      const id = stack.pop()
      if (reachable.has(id)) continue
      reachable.add(id)
      for (const link of collectInputLinks(workflow[id])) stack.push(link[0])
    }
    if (reachable.size !== ids.length) {
      throw new TypeError('MiniMax H3 workflow contains disconnected nodes')
    }

    return true
  }

  function buildWorkflow(options = {}) {
    rejectLockedOptions(options)
    const normalized = optionBag(options)
    const mode = normalizeMode(normalized.mode)
    normalizeSteps(normalized.steps, mode)
    const workflow = createTemplate(normalized)
    return patchWorkflow(workflow, normalized)
  }

  return Object.freeze({
    MODEL_ID,
    MODES,
    OUTPUT_FPS,
    OUTPUT_STEPS,
    DEFAULT_STEPS,
    STEP_OPTIONS,
    MIN_STEPS,
    MAX_STEPS,
    R2V_STEPS,
    RESOLUTION_MULTIPLE,
    MIN_MEGAPIXELS,
    MAX_MEGAPIXELS,
    MAX_CANVAS_PIXELS,
    ASPECT_RATIOS,
    MEGAPIXEL_OPTIONS,
    MIN_DURATION,
    MAX_DURATION,
    DURATION_STEP,
    calculateResolution,
    matchResolution,
    normalizeSteps,
    normalizeLoras,
    normalizeDuration,
    getWorkflowJson,
    patchWorkflow,
    buildWorkflow,
    validateWorkflow,
  })
})
