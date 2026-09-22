(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceCloudWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const MAX_TOTAL_SECONDS = 15

  const KLING_OMNI_IMAGE_TO_VIDEO = {
    '1': {
      inputs: { image: 'input.png' },
      class_type: 'LoadImage',
      _meta: { title: 'reference_image' },
    },
    '3': {
      inputs: {
        model_name: 'kling-v3-omni',
        prompt: '',
        aspect_ratio: '16:9',
        duration: 4,
        reference_images: ['1', 0],
        resolution: '720p',
        storyboards: '1 storyboard',
        'storyboards.storyboard_1_prompt': '',
        'storyboards.storyboard_1_duration': 4,
        generate_audio: true,
        seed: 0,
      },
      class_type: 'KlingOmniProImageToVideoNode',
      _meta: { title: 'Kling 3.0 Omni Image to Video' },
    },
    '2': {
      inputs: {
        filename_prefix: 'video/Kling_v3_omni_i2v',
        format: 'auto',
        codec: 'auto',
        video: ['3', 0],
      },
      class_type: 'SaveVideo',
      _meta: { title: 'save_video' },
    },
  }

  const SEEDANCE_STRICT_IMAGE_TO_VIDEO = {
    '3': {
      inputs: { image: 'first_frame.png' },
      class_type: 'LoadImage',
      _meta: { title: 'first_frame' },
    },
    '2': {
      inputs: {
        model: 'Seedance 2.0',
        'model.prompt': '',
        'model.resolution': '720p',
        'model.ratio': 'adaptive',
        'model.duration': 7,
        'model.generate_audio': true,
        seed: 0,
        watermark: false,
        first_frame_asset_id: '',
        last_frame_asset_id: '',
        first_frame: ['3', 0],
      },
      class_type: 'ByteDance2FirstLastFrameNode',
      _meta: { title: 'Seedance 2.0 Strict First Frame' },
    },
    '7': {
      inputs: {
        filename_prefix: 'video/seedance2_0_strict_i2v',
        format: 'auto',
        codec: 'auto',
        video: ['2', 0],
      },
      class_type: 'SaveVideo',
      _meta: { title: 'save_video' },
    },
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  function clampInteger(value, fallback, minimum, maximum) {
    const parsed = Math.round(Number(value))
    const normalized = Number.isFinite(parsed) ? parsed : fallback
    return Math.max(minimum, Math.min(maximum, normalized))
  }

  function booleanValue(value, fallback) {
    if (value === true || value === false) return value
    if (value == null || value === '') return fallback
    return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase())
  }

  function normalizedSnapshot(value) {
    const snapshot = value && typeof value === 'object' ? value : {}
    return {
      ...snapshot,
      mode: 'cloud',
      params: snapshot.params && typeof snapshot.params === 'object' ? snapshot.params : {},
    }
  }

  function resolveRoute(snapshot) {
    const frameMode = root && root.NovaFlowAiSequenceFrameMode
    if (!frameMode || typeof frameMode.resolveRoute !== 'function') {
      throw new TypeError('AI sequence frame-mode helper is unavailable')
    }
    return frameMode.resolveRoute(normalizedSnapshot(snapshot))
  }

  function handlesRoute(snapshot) {
    const route = resolveRoute(snapshot)
    return route.nodeType === 'KlingOmniProImageToVideoNode' || (
      route.provider === 'jimeng' &&
      route.genType === 'image_video' &&
      route.strictFirstFrame &&
      route.nodeType === 'ByteDance2FirstLastFrameNode'
    )
  }

  function getWorkflowJson(snapshot) {
    const route = resolveRoute(snapshot)
    if (route.nodeType === 'KlingOmniProImageToVideoNode') {
      return JSON.stringify(KLING_OMNI_IMAGE_TO_VIDEO)
    }
    if (handlesRoute(snapshot)) return JSON.stringify(SEEDANCE_STRICT_IMAGE_TO_VIDEO)
    throw new TypeError(`Unsupported modular cloud route: ${route.nodeType || 'unknown'}`)
  }

  function effectiveStoryboardDurations(params, count) {
    const fallback = clampInteger(params.duration, 4, 1, MAX_TOTAL_SECONDS)
    const durations = []
    let used = 0
    for (let index = 1; index <= count; index += 1) {
      const remaining = count - index
      const available = MAX_TOTAL_SECONDS - used
      const requested = clampInteger(params[`storyboard${index}Duration`], fallback, 1, MAX_TOTAL_SECONDS)
      const duration = Math.max(1, Math.min(requested, available - remaining))
      durations.push(duration)
      used += duration
    }
    return durations
  }

  function patchKlingOmni(workflow, options, params) {
    const imageName = String(options.images && options.images[0] || '').trim()
    if (!imageName) throw new Error('Kling Omni reference image is required')
    const prompt = String(options.prompt || '').trim()
    const count = clampInteger(params.storyboardCount, 1, 1, 6)
    const durations = effectiveStoryboardDurations(params, count)
    const livePrompts = Array.isArray(options.storyboardPrompts) ? options.storyboardPrompts : []
    const node = workflow['3']
    workflow['1'].inputs.image = imageName
    node.inputs.model_name = 'kling-v3-omni'
    node.inputs.prompt = prompt
    node.inputs.aspect_ratio = String(params.aspectRatio || '16:9')
    node.inputs.resolution = String(params.resolution || '720p')
    node.inputs.duration = durations.reduce((total, duration) => total + duration, 0)
    node.inputs.reference_images = ['1', 0]
    node.inputs.storyboards = `${count} storyboard${count > 1 ? 's' : ''}`
    node.inputs.generate_audio = booleanValue(params.generateAudio, true)
    node.inputs.seed = clampInteger(options.seed, 0, 0, 2147483647)
    for (let index = 1; index <= 6; index += 1) {
      const promptKey = `storyboards.storyboard_${index}_prompt`
      const durationKey = `storyboards.storyboard_${index}_duration`
      if (index > count) {
        delete node.inputs[promptKey]
        delete node.inputs[durationKey]
        continue
      }
      const storyboardPrompt = String(
        livePrompts[index - 1] || params[`storyboard${index}Prompt`] || prompt,
      ).trim()
      if (!storyboardPrompt) throw new Error('Kling storyboard prompt is empty')
      node.inputs[promptKey] = storyboardPrompt
      node.inputs[durationKey] = durations[index - 1]
    }
    return workflow
  }

  function patchSeedanceStrict(workflow, options, params) {
    const imageName = String(options.images && options.images[0] || '').trim()
    if (!imageName) throw new Error('Seedance strict first frame is required')
    const node = workflow['2']
    const ratio = String(params.aspectRatio || 'adaptive')
    workflow['3'].inputs.image = imageName
    node.inputs.model = String(params.model || 'Seedance 2.0')
    node.inputs['model.prompt'] = String(options.prompt || '').trim()
    node.inputs['model.resolution'] = String(params.resolution || '720p')
    node.inputs['model.ratio'] = ratio === 'original' ? 'adaptive' : ratio
    node.inputs['model.duration'] = clampInteger(params.duration, 7, 4, MAX_TOTAL_SECONDS)
    node.inputs['model.generate_audio'] = booleanValue(params.generateAudio, true)
    node.inputs.seed = clampInteger(options.seed, 0, 0, 2147483647)
    node.inputs.watermark = false
    node.inputs.first_frame_asset_id = ''
    node.inputs.last_frame_asset_id = ''
    node.inputs.first_frame = ['3', 0]
    delete node.inputs.last_frame
    return workflow
  }

  function patchWorkflow(workflowValue, options = {}) {
    const workflow = workflowValue && workflowValue.prompt && typeof workflowValue.prompt === 'object'
      ? workflowValue.prompt
      : workflowValue
    if (!workflow || typeof workflow !== 'object') throw new TypeError('Cloud workflow JSON is invalid')
    const snapshot = normalizedSnapshot(options)
    if (!handlesRoute(snapshot)) throw new TypeError('Cloud route is not owned by the modular workflow')
    const params = snapshot.params
    const route = resolveRoute(snapshot)
    if (route.nodeType === 'KlingOmniProImageToVideoNode') {
      return patchKlingOmni(workflow, options, params)
    }
    return patchSeedanceStrict(workflow, options, params)
  }

  return Object.freeze({
    handlesRoute,
    getWorkflowJson,
    patchWorkflow,
  })
})
