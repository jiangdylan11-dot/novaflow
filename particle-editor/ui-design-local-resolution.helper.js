(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignLocalResolution = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const VERSION = '20260729-ui-local-safe-resolution-3'
  const DEFAULT_MAX_WORKING_PIXELS = 720 * 1280
  const DIMENSION_MULTIPLE = 16

  function positiveInteger(value, fallback = 0) {
    const number = Math.round(Number(value))
    return Number.isFinite(number) && number > 0 ? number : fallback
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

  function isNode(node, classType) {
    return Boolean(
      node
      && String(node.class_type || '') === classType
      && node.inputs
      && typeof node.inputs === 'object'
      && !Array.isArray(node.inputs),
    )
  }

  function nodeEntries(workflow, classTypes) {
    const allowed = new Set(Array.isArray(classTypes) ? classTypes : [classTypes])
    return Object.entries(workflow || {}).filter(([, node]) => (
      allowed.has(String(node?.class_type || ''))
      && node?.inputs
      && typeof node.inputs === 'object'
      && !Array.isArray(node.inputs)
    ))
  }

  function sameSource(value, nodeId) {
    return Array.isArray(value) && String(value[0]) === String(nodeId) && Number(value[1]) === 0
  }

  // The 图生图 patch can already put its own output scale between the decode
  // and the save. Follow that short chain so this finish lands last instead of
  // reporting the save as disconnected.
  function outputChainSource(workflow, node, decodeId, depth = 3) {
    let source = node?.inputs?.images
    for (let step = 0; step <= depth; step += 1) {
      if (!Array.isArray(source)) return null
      if (sameSource(source, decodeId)) return node.inputs.images
      const upstream = workflow[String(source[0])]
      if (!isNode(upstream, 'ImageScale') && !isNode(upstream, 'ImageSharpen')) return null
      source = upstream.inputs.image
    }
    return null
  }

  function nextNodeId(workflow) {
    let next = 900001
    while (Object.prototype.hasOwnProperty.call(workflow, String(next))) next += 1
    return String(next)
  }

  function explicitRequestedSize(options = {}) {
    const state = options.state && typeof options.state === 'object' && !Array.isArray(options.state)
      ? options.state
      : {}
    return {
      width: positiveInteger(options.width ?? state.width, 0),
      height: positiveInteger(options.height ?? state.height, 0),
    }
  }

  function requestedSizeFromWorkflow(workflow) {
    const pads = nodeEntries(workflow, 'ImagePadForOutpaint')
    for (const [, pad] of pads) {
      const source = Array.isArray(pad.inputs.image) ? String(pad.inputs.image[0]) : ''
      const scale = source ? workflow[source] : null
      if (!isNode(scale, 'ImageScale')) continue
      const width = positiveInteger(scale.inputs.width, 0)
        + positiveInteger(pad.inputs.left, 0)
        + positiveInteger(pad.inputs.right, 0)
      const height = positiveInteger(scale.inputs.height, 0)
        + positiveInteger(pad.inputs.top, 0)
        + positiveInteger(pad.inputs.bottom, 0)
      if (width > 0 && height > 0) return { width, height }
    }

    const targetScale = nodeEntries(workflow, 'ImageScale').find(([, node]) => (
      /novaflow\s+(aspect fit|target canvas)/i.test(String(node?._meta?.title || ''))
    ))
    if (targetScale) {
      return {
        width: positiveInteger(targetScale[1].inputs.width, 0),
        height: positiveInteger(targetScale[1].inputs.height, 0),
      }
    }

    const latent = nodeEntries(workflow, ['EmptyLatentImage', 'EmptySD3LatentImage'])[0]
    if (latent) {
      return {
        width: positiveInteger(latent[1].inputs.width, 0),
        height: positiveInteger(latent[1].inputs.height, 0),
      }
    }
    return { width: 0, height: 0 }
  }

  function resolveRequestedSize(workflow, options = {}) {
    const explicit = explicitRequestedSize(options)
    if (explicit.width > 0 && explicit.height > 0) return explicit
    return requestedSizeFromWorkflow(workflow)
  }

  function alignDown(value, multiple = DIMENSION_MULTIPLE) {
    const aligned = Math.floor(positiveInteger(value, multiple) / multiple) * multiple
    return Math.max(multiple, aligned)
  }

  function plan(options = {}) {
    const requested = {
      width: positiveInteger(options.width, 0),
      height: positiveInteger(options.height, 0),
    }
    const maxWorkingPixels = positiveInteger(options.maxWorkingPixels, DEFAULT_MAX_WORKING_PIXELS)
    if (!(requested.width > 0 && requested.height > 0)) {
      return Object.freeze({
        active: false,
        requested,
        working: { ...requested },
        scaled: false,
        maxWorkingPixels,
      })
    }
    const requestedPixels = requested.width * requested.height
    if (requestedPixels <= maxWorkingPixels) {
      return Object.freeze({
        active: true,
        requested,
        working: { ...requested },
        scaled: false,
        maxWorkingPixels,
      })
    }
    const scale = Math.sqrt(maxWorkingPixels / requestedPixels)
    const working = {
      width: alignDown(requested.width * scale),
      height: alignDown(requested.height * scale),
    }
    while (working.width * working.height > maxWorkingPixels) {
      if (working.width >= working.height) working.width = Math.max(DIMENSION_MULTIPLE, working.width - DIMENSION_MULTIPLE)
      else working.height = Math.max(DIMENSION_MULTIPLE, working.height - DIMENSION_MULTIPLE)
    }
    return Object.freeze({
      active: true,
      requested,
      working,
      scaled: true,
      maxWorkingPixels,
    })
  }

  function addOutputFinish(workflow, decodeEntries, saveEntries, target, options = {}) {
    const scaleOutput = options.scaleOutput !== false
    const sharpenAlpha = Number.isFinite(Number(options.sharpenAlpha))
      ? Math.max(0, Math.min(2, Number(options.sharpenAlpha)))
      : (scaleOutput ? 0.6 : 0.15)
    const outputScaleNodeIds = []
    const sharpenNodeIds = []
    let saveNodeCount = 0
    decodeEntries.forEach(([decodeId]) => {
      const connectedSaves = saveEntries.filter(([, node]) => outputChainSource(workflow, node, decodeId))
      if (!connectedSaves.length) return
      const decodeSource = outputChainSource(workflow, connectedSaves[0][1], decodeId)
      let finishSource = decodeSource
      if (scaleOutput) {
        const scaleId = nextNodeId(workflow)
        workflow[scaleId] = {
          inputs: {
            image: decodeSource,
            upscale_method: 'lanczos',
            width: target.width,
            height: target.height,
            crop: 'disabled',
          },
          class_type: 'ImageScale',
          _meta: { title: 'NovaFlow Local UI Output Scale' },
        }
        finishSource = [scaleId, 0]
        outputScaleNodeIds.push(scaleId)
      }
      const sharpenId = nextNodeId(workflow)
      workflow[sharpenId] = {
        inputs: {
          image: finishSource,
          sharpen_radius: 1,
          sigma: 0.8,
          alpha: sharpenAlpha,
        },
        class_type: 'ImageSharpen',
        _meta: { title: 'NovaFlow Local UI Output Sharpen' },
      }
      connectedSaves.forEach(([, node]) => {
        node.inputs.images = [sharpenId, 0]
        saveNodeCount += 1
      })
      sharpenNodeIds.push(sharpenId)
    })
    return { outputScaleNodeIds, sharpenNodeIds, saveNodeCount }
  }

  function apply(workflowInput, options = {}) {
    if (!workflowInput || typeof workflowInput !== 'object' || Array.isArray(workflowInput)) {
      throw new TypeError('Local UI safe resolution requires a workflow object')
    }
    const workflow = options.clone === false ? workflowInput : clone(workflowInput)
    const requested = resolveRequestedSize(workflow, options)
    const resolutionPlan = plan({
      width: requested.width,
      height: requested.height,
      maxWorkingPixels: options.maxWorkingPixels,
    })
    const vaeEncoders = nodeEntries(workflow, 'VAEEncode')
    const latentNodes = nodeEntries(workflow, ['EmptyLatentImage', 'EmptySD3LatentImage'])
    const mode = vaeEncoders.length ? 'img2img' : latentNodes.length ? 'txt2img' : 'unknown'
    const forceWorkingImageScale = options.forceWorkingImageScale === true && mode === 'img2img'
    const forceOutputFinish = options.forceOutputFinish === true
    const metadata = {
      version: VERSION,
      active: resolutionPlan.active,
      mode,
      requested: { ...resolutionPlan.requested },
      working: { ...resolutionPlan.working },
      scaled: resolutionPlan.scaled,
      maxWorkingPixels: resolutionPlan.maxWorkingPixels,
      forceWorkingImageScale,
      forceOutputFinish,
      workingScaleNodeIds: [],
      outputScaleNodeIds: [],
      sharpenNodeIds: [],
      saveNodeCount: 0,
    }
    const prepareWorkingCanvas = resolutionPlan.active
      && (resolutionPlan.scaled || forceWorkingImageScale)
    if (!prepareWorkingCanvas && !forceOutputFinish) {
      return { workflow, metadata: Object.freeze(metadata) }
    }
    if (mode === 'unknown') {
      throw new Error('Local UI safe resolution requires VAEEncode or an empty latent node')
    }

    if (prepareWorkingCanvas) {
      if (mode === 'img2img') {
        const scaleBySource = new Map()
        vaeEncoders.forEach(([, node]) => {
          const source = node.inputs.pixels
          if (!Array.isArray(source)) throw new Error('Local UI safe resolution requires a VAE image source')
          const sourceKey = `${String(source[0])}:${Number(source[1]) || 0}`
          let scaleId = scaleBySource.get(sourceKey)
          if (!scaleId) {
            scaleId = nextNodeId(workflow)
            workflow[scaleId] = {
              inputs: {
                image: clone(source),
                upscale_method: 'lanczos',
                width: resolutionPlan.working.width,
                height: resolutionPlan.working.height,
                crop: 'disabled',
              },
              class_type: 'ImageScale',
              _meta: { title: 'NovaFlow Local UI Working Canvas' },
            }
            scaleBySource.set(sourceKey, scaleId)
            metadata.workingScaleNodeIds.push(scaleId)
          }
          node.inputs.pixels = [scaleId, 0]
        })
      } else {
        latentNodes.forEach(([, node]) => {
          node.inputs.width = resolutionPlan.working.width
          node.inputs.height = resolutionPlan.working.height
        })
      }
    }

    if (!resolutionPlan.scaled && !forceOutputFinish) {
      return { workflow, metadata: Object.freeze(metadata) }
    }

    const finish = addOutputFinish(
      workflow,
      nodeEntries(workflow, 'VAEDecode'),
      nodeEntries(workflow, 'SaveImage'),
      resolutionPlan.requested,
      {
        scaleOutput: resolutionPlan.scaled,
        sharpenAlpha: options.outputSharpenAlpha,
      },
    )
    if (!finish.saveNodeCount) {
      throw new Error('Local UI safe resolution requires VAEDecode connected directly to SaveImage')
    }
    metadata.outputScaleNodeIds = finish.outputScaleNodeIds
    metadata.sharpenNodeIds = finish.sharpenNodeIds
    metadata.saveNodeCount = finish.saveNodeCount
    return { workflow, metadata: Object.freeze(metadata) }
  }

  return Object.freeze({
    VERSION,
    DEFAULT_MAX_WORKING_PIXELS,
    DIMENSION_MULTIPLE,
    resolveRequestedSize,
    plan,
    apply,
  })
})
