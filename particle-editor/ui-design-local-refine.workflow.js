(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignLocalRefineWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const VERSION = '20260729-ui-local-refine-workflow-7'
  const TASK_PROFILE = 'ui-design-refine'
  const REPAIR_MASK_ENCODING = 'semantic-repair-mask-v1'
  const POLISH_PRESET = 'polish'
  const ENHANCED_REDRAW_PRESET = 'enhanced-redraw'
  const MIN_DENOISE = 0.05
  const MAX_DENOISE = 1

  const PRESETS = Object.freeze({
    [POLISH_PRESET]: Object.freeze({
      name: POLISH_PRESET,
      steps: 20,
      cfg: 4,
      samplerName: 'euler',
      scheduler: 'simple',
      denoise: 0.35,
      lightning: false,
    }),
    [ENHANCED_REDRAW_PRESET]: Object.freeze({
      name: ENHANCED_REDRAW_PRESET,
      steps: 40,
      cfg: 4,
      samplerName: 'euler',
      scheduler: 'simple',
      denoise: 0.55,
      lightning: false,
    }),
  })
  const RAPID_PRESETS = Object.freeze({
    [POLISH_PRESET]: Object.freeze({
      name: POLISH_PRESET,
      steps: 6,
      cfg: 1,
      samplerName: 'euler_ancestral',
      scheduler: 'beta',
      denoise: 0.35,
      lightning: false,
    }),
    [ENHANCED_REDRAW_PRESET]: Object.freeze({
      name: ENHANCED_REDRAW_PRESET,
      steps: 6,
      cfg: 1,
      samplerName: 'euler_ancestral',
      scheduler: 'beta',
      denoise: 0.58,
      lightning: false,
    }),
  })

  function text(value) {
    return String(value == null ? '' : value).trim()
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

  function normalizePreset(value) {
    const key = text(value).toLowerCase().replace(/[\s_]+/g, '-')
    if (['enhanced', 'redraw', 'enhanced-redraw'].includes(key)) return ENHANCED_REDRAW_PRESET
    return POLISH_PRESET
  }

  function finiteNumber(value, fallback) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value))
  }

  function resolveDenoise(value, preset) {
    return clamp(finiteNumber(value, preset.denoise), MIN_DENOISE, MAX_DENOISE)
  }

  function isNode(node, classType) {
    return Boolean(
      node
      && text(node.class_type) === classType
      && node.inputs
      && typeof node.inputs === 'object'
      && !Array.isArray(node.inputs),
    )
  }

  function isLightningToggle(node) {
    if (!isNode(node, 'PrimitiveBoolean')) return false
    const title = text(node?._meta?.title)
      .toLowerCase()
      .replace(/[?？]/g, '')
      .replace(/step\(s\)/g, 'steps')
      .replace(/\s+/g, '')
    return title === 'enable4steplora' || title === 'enable4stepslora'
  }

  function nodeEntries(workflow, classType) {
    return Object.entries(workflow).filter(([, node]) => isNode(node, classType))
  }

  function nextNodeId(workflow) {
    let next = 900001
    while (Object.prototype.hasOwnProperty.call(workflow, String(next))) next += 1
    return String(next)
  }

  function addNode(workflow, classType, inputs, title) {
    const nodeId = nextNodeId(workflow)
    workflow[nodeId] = { class_type: classType, inputs, _meta: { title } }
    return nodeId
  }

  function firstResultImageName(options, loadImage) {
    const uploadedNames = Array.isArray(options.uploadedNames) ? options.uploadedNames : []
    return text(
      options.firstResultName
      || options.resultImageName
      || options.baseImageName
      || uploadedNames[0]
      || loadImage?.inputs?.image,
    )
  }

  function assertContract(options, workflow) {
    if (text(options.taskProfile).toLowerCase() !== TASK_PROFILE) {
      throw new Error(`Local UI refinement requires taskProfile=${TASK_PROFILE}`)
    }
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
      throw new TypeError('Local UI refinement requires a valid localWorkflow object')
    }
  }

  function build(options = {}) {
    const sourceWorkflow = options.localWorkflow
    assertContract(options, sourceWorkflow)
    const workflow = clone(sourceWorkflow)
    const loads = nodeEntries(workflow, 'LoadImage')
    const textEncoders = nodeEntries(workflow, 'TextEncodeQwenImageEditPlus')
    const vaeEncoders = nodeEntries(workflow, 'VAEEncode')
    const samplers = nodeEntries(workflow, 'KSampler')
    const lightningToggles = Object.entries(workflow).filter(([, node]) => isLightningToggle(node))

    if (!loads.length) throw new Error('Local UI refinement requires at least one LoadImage node')
    if (!textEncoders.length) throw new Error('Local UI refinement requires TextEncodeQwenImageEditPlus')
    if (!vaeEncoders.length) throw new Error('Local UI refinement requires VAEEncode')
    if (!samplers.length) throw new Error('Local UI refinement requires at least one KSampler node')
    const rapidFamily = options.nsfw === true || Object.values(workflow).some((node) => (
      node?.class_type === 'CheckpointLoaderSimple'
      && node.inputs?.ckpt_name === 'Qwen-Rapid-AIO-NSFW-v20.safetensors'
    ))
    if (!rapidFamily && !lightningToggles.length) {
      throw new Error('Local UI refinement requires an Enable 4 Step(s) LoRA switch')
    }

    const [firstLoadId, firstLoad] = loads[0]
    const firstImageName = firstResultImageName(options, firstLoad)
    if (!firstImageName) throw new Error('Local UI refinement requires the first-pass result image')
    firstLoad.inputs.image = firstImageName
    const uploadedNames = Array.isArray(options.uploadedNames) ? options.uploadedNames : []
    const maskImageName = text(uploadedNames[1])
    const maskEncoding = text(options.state?.localUiRepairMaskEncoding)
    const maskedRepair = Boolean(maskImageName && maskEncoding === REPAIR_MASK_ENCODING)
    if (maskedRepair && !loads[1]) {
      throw new Error('Masked Local UI refinement requires a second LoadImage node')
    }
    if (maskedRepair) loads[1][1].inputs.image = maskImageName

    textEncoders.forEach(([, node]) => {
      node.inputs.image1 = [firstLoadId, 0]
      delete node.inputs.image2
      delete node.inputs.image3
    })

    const [firstVaeEncodeId] = vaeEncoders[0]
    vaeEncoders.forEach(([, node]) => {
      node.inputs.pixels = [firstLoadId, 0]
    })

    const presetName = normalizePreset(options.preset || options.refinePreset || options.mode)
    const preset = rapidFamily ? RAPID_PRESETS[presetName] : PRESETS[presetName]
    const denoise = resolveDenoise(options.denoise, preset)
    samplers.forEach(([, node]) => {
      node.inputs.steps = preset.steps
      node.inputs.cfg = preset.cfg
      node.inputs.sampler_name = preset.samplerName
      node.inputs.scheduler = preset.scheduler
      node.inputs.denoise = denoise
      node.inputs.latent_image = [firstVaeEncodeId, 0]
    })
    lightningToggles.forEach(([, node]) => {
      node.inputs.value = preset.lightning
    })
    const resolutionApi = root && root.NovaFlowUiDesignLocalResolution
    if (typeof resolutionApi?.apply !== 'function') {
      throw new Error('Local UI safe resolution helper is required')
    }
    const resolved = resolutionApi.apply(workflow, {
      state: options.state,
      width: options.width,
      height: options.height,
      clone: false,
      forceOutputFinish: true,
    })
    const repairNodeIds = {
      maskLoadImageNodeId: maskedRepair ? loads[1][0] : '',
      workingScaleNodeId: '',
      workingMaskNodeId: '',
      latentMaskNodeId: '',
      requestedScaleNodeId: '',
      requestedMaskNodeId: '',
      compositeNodeIds: [],
    }
    if (maskedRepair) {
      const { requested, working, active } = resolved.metadata
      const validSize = active
        && requested.width > 0 && requested.height > 0
        && working.width > 0 && working.height > 0
      const saves = nodeEntries(resolved.workflow, 'SaveImage')
        .filter(([, node]) => Array.isArray(node.inputs.images))
      if (!validSize || !saves.length) {
        throw new Error('Masked Local UI refinement requires reliable working/output dimensions and SaveImage')
      }
      repairNodeIds.workingScaleNodeId = addNode(resolved.workflow, 'ImageScale', {
        image: [repairNodeIds.maskLoadImageNodeId, 0], upscale_method: 'bilinear',
        width: working.width, height: working.height, crop: 'disabled',
      }, 'NovaFlow Local UI Repair Mask Working Scale')
      repairNodeIds.workingMaskNodeId = addNode(resolved.workflow, 'ImageToMask', {
        image: [repairNodeIds.workingScaleNodeId, 0], channel: 'red',
      }, 'NovaFlow Local UI Repair Working Mask')
      repairNodeIds.latentMaskNodeId = addNode(resolved.workflow, 'SetLatentNoiseMask', {
        samples: [firstVaeEncodeId, 0], mask: [repairNodeIds.workingMaskNodeId, 0],
      }, 'NovaFlow Local UI Repair Latent Mask')
      samplers.forEach(([, node]) => {
        node.inputs.latent_image = [repairNodeIds.latentMaskNodeId, 0]
      })
      repairNodeIds.requestedScaleNodeId = addNode(resolved.workflow, 'ImageScale', {
        image: [repairNodeIds.maskLoadImageNodeId, 0], upscale_method: 'bilinear',
        width: requested.width, height: requested.height, crop: 'disabled',
      }, 'NovaFlow Local UI Repair Mask Output Scale')
      repairNodeIds.requestedMaskNodeId = addNode(resolved.workflow, 'ImageToMask', {
        image: [repairNodeIds.requestedScaleNodeId, 0], channel: 'red',
      }, 'NovaFlow Local UI Repair Output Mask')
      saves.forEach(([, node]) => {
        const compositeId = addNode(resolved.workflow, 'ImageCompositeMasked', {
          destination: [firstLoadId, 0], source: clone(node.inputs.images),
          x: 0, y: 0, resize_source: false, mask: [repairNodeIds.requestedMaskNodeId, 0],
        }, 'NovaFlow Local UI Pixel-Locked Repair Composite')
        node.inputs.images = [compositeId, 0]
        repairNodeIds.compositeNodeIds.push(compositeId)
      })
    }

    const sampling = Object.freeze({
      preset: presetName,
      steps: preset.steps,
      cfg: preset.cfg,
      samplerName: preset.samplerName,
      scheduler: preset.scheduler,
      denoise,
      lightning: preset.lightning,
    })
    return Object.freeze({
      workflow: resolved.workflow,
      preset: presetName,
      sampling,
      metadata: Object.freeze({
        version: VERSION,
        taskProfile: TASK_PROFILE,
        preset: presetName,
        modelFamily: rapidFamily ? 'rapid' : 'standard',
        firstResultImageName: firstImageName,
        firstLoadImageNodeId: firstLoadId,
        firstVaeEncodeNodeId: firstVaeEncodeId,
        textEncoderCount: textEncoders.length,
        vaeEncoderCount: vaeEncoders.length,
        samplerCount: samplers.length,
        lightningToggleCount: lightningToggles.length,
        sampling,
        resolution: resolved.metadata,
        maskedRepair,
        repairMaskEncoding: maskedRepair ? REPAIR_MASK_ENCODING : '',
        repairMaskNodeIds: Object.freeze(repairNodeIds),
      }),
    })
  }

  return Object.freeze({
    VERSION,
    TASK_PROFILE,
    POLISH_PRESET,
    ENHANCED_REDRAW_PRESET,
    MIN_DENOISE,
    MAX_DENOISE,
    REPAIR_MASK_ENCODING,
    PRESETS,
    RAPID_PRESETS,
    normalizePreset,
    resolveDenoise,
    build,
  })
})
