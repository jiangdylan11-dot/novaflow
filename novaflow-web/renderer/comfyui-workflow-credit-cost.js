(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowComfyWorkflowCreditCost = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const PROVIDER_KEY = 'comfyui'
  const VIDEO_NODE_TYPES = Object.freeze([
    'KlingVideoNode',
    'KlingFirstLastFrameNode',
    'KlingOmniProImageToVideoNode',
    'ByteDance2ReferenceNode',
    'ByteDance2FirstLastFrameNode',
  ])
  const IMAGE_NODE_TYPES = Object.freeze([])
  const SUPPORTED_NODE_TYPES = Object.freeze([...VIDEO_NODE_TYPES, ...IMAGE_NODE_TYPES])
  const SUPPORTED_NODE_TYPE_SET = new Set(SUPPORTED_NODE_TYPES)
  const IMAGE_NODE_TYPE_SET = new Set(IMAGE_NODE_TYPES)
  const CREDIT_COST_KEYS = new Set([
    'creditcost',
    'credits',
    'estimatedcreditcost',
    'novaflowcreditcost',
    'modelcreditcost',
    'modelcredits',
  ])
  const CREDITS_PER_USD = 211
  const KLING_USD_RATES = {
    '4k': { off: 0.42, on: 0.42 },
    '1080p': { off: 0.112, on: 0.168 },
    '720p': { off: 0.084, on: 0.126 },
  }
  const KLING_OMNI_USD_RATES = {
    '4k': { off: 0.42, on: 0.42 },
    '1080p': { off: 0.112, on: 0.14 },
    '720p': { off: 0.084, on: 0.112 },
  }
  const SEEDANCE2_RATES = {
    '480p': 10044,
    '720p': 21600,
    '1080p': 48800,
  }
  const SEEDANCE2_PRICE_PER_1K = {
    standard: 0.01001,
    fast: 0.008008,
    video: 0.006149,
    videoFast: 0.004719,
  }

  function positiveNumber(value) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }

  function normalizeCostKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  }

  function readExplicitCreditCost(value, depth = 0, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return 0
    seen.add(value)
    for (const [key, item] of Object.entries(value)) {
      if (CREDIT_COST_KEYS.has(normalizeCostKey(key))) {
        const amount = positiveNumber(item)
        if (amount > 0) return amount
      }
      if (item && typeof item === 'object') {
        const nested = readExplicitCreditCost(item, depth + 1, seen)
        if (nested > 0) return nested
      }
    }
    return 0
  }

  function readInput(inputs, names) {
    if (!inputs || typeof inputs !== 'object') return undefined
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(inputs, name)) return inputs[name]
    }
    return undefined
  }

  function truthyInput(value) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) && value > 0
    const text = String(value ?? '').trim().toLowerCase()
    if (!text) return false
    if (['true', 'yes', 'on'].includes(text)) return true
    const numericPrefix = Number.parseFloat(text)
    return Number.isFinite(numericPrefix) && numericPrefix > 0
  }

  function workflowNodes(workflow) {
    if (!workflow || typeof workflow !== 'object') return null
    return workflow.prompt && typeof workflow.prompt === 'object' ? workflow.prompt : workflow
  }

  function findProviderWorkflowNodes(workflow) {
    const nodes = workflowNodes(workflow)
    if (!nodes || typeof nodes !== 'object') return []
    const matches = []
    for (const node of Object.values(nodes)) {
      const nodeType = String(node?.class_type || node?.classType || node?.type || '')
      if (SUPPORTED_NODE_TYPE_SET.has(nodeType)) matches.push({ node, nodeType })
    }
    return matches
  }

  function klingDurationSeconds(inputs) {
    if (!inputs || typeof inputs !== 'object') return 0
    let duration = 0
    if (truthyInput(readInput(inputs, ['multi_shot', 'model.multi_shot']))) {
      for (const [key, value] of Object.entries(inputs)) {
        if (/^multi_shot\.storyboard_\d+_duration$/i.test(String(key || ''))) {
          duration += positiveNumber(value)
        }
      }
    }
    if (duration <= 0) {
      duration = positiveNumber(readInput(inputs, ['duration', 'model.duration', 'video.duration']))
    }
    return Math.max(0, Math.min(15, duration))
  }

  function estimateKlingCreditCost(inputs) {
    const duration = klingDurationSeconds(inputs)
    if (duration <= 0) return 0
    const resolution = String(readInput(inputs, ['model.resolution', 'resolution']) || '720p').trim().toLowerCase()
    const audio = truthyInput(readInput(inputs, ['model.generate_audio', 'generate_audio', 'audio']))
    const rates = KLING_USD_RATES[resolution] || KLING_USD_RATES['720p']
    return rates[audio ? 'on' : 'off'] * duration * CREDITS_PER_USD
  }

  function estimateKlingOmniCreditCost(inputs) {
    const duration = Math.max(0, Math.min(15, positiveNumber(readInput(inputs, ['duration']))))
    if (duration <= 0) return 0
    const resolution = String(readInput(inputs, ['resolution']) || '720p').trim().toLowerCase()
    const modelName = String(readInput(inputs, ['model_name']) || '').trim().toLowerCase()
    const audio = modelName.includes('v3') && truthyInput(readInput(inputs, ['generate_audio', 'audio']))
    const rates = KLING_OMNI_USD_RATES[resolution] || KLING_OMNI_USD_RATES['720p']
    return rates[audio ? 'on' : 'off'] * duration * CREDITS_PER_USD
  }

  function hasJimengReferenceVideo(inputs) {
    return Object.entries(inputs || {}).some(([key, value]) => Boolean(value) && (
      /^model\.reference_videos\.video_\d+$/i.test(String(key || '')) ||
      /^video_\d+$/i.test(String(key || ''))
    ))
  }

  function estimateJimengCreditCost(inputs, nodeType) {
    if (!inputs || typeof inputs !== 'object') return 0
    const resolution = String(readInput(inputs, ['model.resolution', 'resolution']) || '720p').trim().toLowerCase()
    const duration = Math.max(4, Math.min(15, positiveNumber(readInput(inputs, ['model.duration', 'duration'])) || 7))
    const model = String(readInput(inputs, ['model']) || '').toLowerCase()
    const isFast = model.includes('fast')
    const rate = SEEDANCE2_RATES[resolution] || SEEDANCE2_RATES['480p']
    const hasVideo = nodeType === 'ByteDance2ReferenceNode' && hasJimengReferenceVideo(inputs)
    const usd = hasVideo
      ? (15 + duration) * rate * (isFast ? SEEDANCE2_PRICE_PER_1K.videoFast : SEEDANCE2_PRICE_PER_1K.video) / 1000
      : duration * rate * (isFast ? SEEDANCE2_PRICE_PER_1K.fast : SEEDANCE2_PRICE_PER_1K.standard) / 1000
    return usd * CREDITS_PER_USD
  }

  function estimateWorkflowCreditCost(workflow, options = {}) {
    const providerNodes = findProviderWorkflowNodes(workflow)
    const providerNode = providerNodes[0] || null
    if (!providerNode && !options.allowCloudPrompt) return null

    const node = providerNode?.node || null
    const nodeType = providerNode?.nodeType || 'comfyui_cloud_prompt'
    const inputs = node?.inputs && typeof node.inputs === 'object' ? node.inputs : {}
    if (IMAGE_NODE_TYPE_SET.has(nodeType)) {
      const selectedModel = String(inputs.model || nodeType).trim().toLowerCase()
      return {
        providerKey: PROVIDER_KEY,
        modelKey: selectedModel || nodeType.toLowerCase(),
        taskType: 'local_workflow_image',
        workflowNodeType: nodeType,
        known: false,
        estimatedCreditCost: 0,
        creditCost: 0,
        pricingStatus: 'pending_pricing',
        pricingSource: 'unknown',
      }
    }
    const explicit = providerNodes.length > 1 ? 0 : (readExplicitCreditCost(inputs) || readExplicitCreditCost(workflow))
    let estimatedCreditCost = explicit
    let pricingSource = explicit > 0 ? 'workflow_explicit' : 'unknown'

    if (providerNodes.length === 1 && estimatedCreditCost <= 0 && nodeType === 'KlingOmniProImageToVideoNode') {
      estimatedCreditCost = estimateKlingOmniCreditCost(inputs)
      if (estimatedCreditCost > 0) pricingSource = 'kling_omni_static_v1'
    } else if (providerNodes.length === 1 && estimatedCreditCost <= 0 && (nodeType === 'KlingVideoNode' || nodeType === 'KlingFirstLastFrameNode')) {
      estimatedCreditCost = estimateKlingCreditCost(inputs)
      if (estimatedCreditCost > 0) pricingSource = 'kling_static_v1'
    } else if (providerNodes.length === 1 && estimatedCreditCost <= 0 && (nodeType === 'ByteDance2ReferenceNode' || nodeType === 'ByteDance2FirstLastFrameNode')) {
      estimatedCreditCost = estimateJimengCreditCost(inputs, nodeType)
      if (estimatedCreditCost > 0) pricingSource = 'jimeng_static_v1'
    }

    const known = Number.isFinite(estimatedCreditCost) && estimatedCreditCost > 0
    const normalizedEstimate = known ? estimatedCreditCost : 0
    return {
      providerKey: PROVIDER_KEY,
      modelKey: providerNode ? nodeType.toLowerCase() : 'comfyui-cloud',
      taskType: 'local_workflow_video',
      workflowNodeType: nodeType,
      known,
      estimatedCreditCost: normalizedEstimate,
      creditCost: known ? Math.ceil(normalizedEstimate) : 0,
      pricingStatus: known ? 'known' : 'pending_pricing',
      pricingSource,
    }
  }

  return Object.freeze({
    PROVIDER_KEY,
    SUPPORTED_NODE_TYPES,
    estimateWorkflowCreditCost,
  })
})
