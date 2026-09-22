(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowArtGenerateCreditPricing = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const START_LABEL = '开始生成'
  const UNAVAILABLE_LABEL = '开始生成 · 积分待确认'
  const UPDATE_EVENT = 'novaflow:art-generate-credit-updated'
  const CREDITS_PER_USD = 211
  // Mirrors ART_GENERATE_MAX_COUNT in the brand Runtime (绘图 生成数量 upper bound).
  const MAX_COUNT = 10
  const RETRY_DELAYS_MS = Object.freeze([250, 750, 1500, 3000, 6000])
  const NODE_CACHE_LIMIT = 8
  const ESTIMATE_CACHE_LIMIT = 32
  const SETTLEMENT_CACHE_LIMIT = 64
  const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$/

  const nodeDefinitionRequests = new Map()
  const estimateRequests = new Map()
  const estimateCache = new Map()
  const settlementCache = new Map()
  const retryState = new Map()
  let latestSignature = ''
  let estimateEpoch = 0

  function trimMap(map, limit) {
    while (map.size > limit) map.delete(map.keys().next().value)
  }

  function normalizeProvider(value) {
    const api = root && root.NovaFlowArtGenerateModels
    if (api && typeof api.normalizeProvider === 'function') return api.normalizeProvider(value)
    const provider = String(value || '').trim().toLowerCase()
    return ['local', 'gpt', 'google'].includes(provider) ? provider : 'local'
  }

  function normalizeMode(value) {
    return String(value || '').trim().toLowerCase() === 'img2img' ? 'img2img' : 'txt2img'
  }

  function nodeTypeFor(provider, mode) {
    if (provider === 'gpt') return 'OpenAIGPTImageNodeV2'
    if (provider === 'google') return mode === 'img2img' ? 'GeminiImage2Node' : 'GeminiImageNode'
    return ''
  }

  function copyState(state) {
    const input = state && typeof state === 'object' ? state : {}
    return {
      provider: normalizeProvider(input.provider),
      mode: normalizeMode(input.mode),
      gptQualityTxt2img: String(input.gptQualityTxt2img || 'low'),
      gptQualityImg2img: String(input.gptQualityImg2img || 'low'),
      gptSize: String(input.gptSize || '1024x1024'),
      gptCustomWidth: Number(input.gptCustomWidth || 1024),
      gptCustomHeight: Number(input.gptCustomHeight || 1024),
      googleAspectRatioTxt2img: String(input.googleAspectRatioTxt2img || 'auto'),
      googleAspectRatioImg2img: String(input.googleAspectRatioImg2img || 'auto'),
      googleResolution: String(input.googleResolution || '1K'),
      referenceCount: Math.max(0, Array.isArray(input.references) ? input.references.filter(Boolean).length : 0),
      // 生成数量: the priced node runs once per image, so the estimate scales with it.
      count: Math.max(1, Math.min(MAX_COUNT, Math.round(Number(input.count)) || 1)),
    }
  }

  function createSnapshot(state, options = {}) {
    const values = copyState(state)
    const provider = values.provider
    const mode = values.mode
    const models = root && root.NovaFlowArtGenerateModels
    const settings = models && typeof models.workflowSettings === 'function'
      ? models.workflowSettings({ ...(state || {}), ...values }, provider, mode)
      : {}
    const baseUrl = String(options.baseUrl || options.runtimeBaseUrl || '').trim().replace(/\/+$/, '')
    const signature = JSON.stringify([
      baseUrl,
      provider,
      mode,
      settings,
      values.referenceCount,
      values.count,
    ])
    return Object.freeze({
      ...values,
      provider,
      mode,
      nodeType: nodeTypeFor(provider, mode),
      settings: settings && typeof settings === 'object' ? settings : {},
      baseUrl,
      requestJson: typeof options.requestJson === 'function' ? options.requestJson : null,
      signature,
    })
  }

  function dispatchUpdate(kind, detail = {}) {
    if (!root || typeof root.dispatchEvent !== 'function') return
    const payload = { kind, ...detail }
    try {
      const event = typeof root.CustomEvent === 'function'
        ? new root.CustomEvent(UPDATE_EVENT, { detail: payload })
        : { type: UPDATE_EVENT, detail: payload }
      root.dispatchEvent(event)
    } catch {
      // Credit display updates must never block generation controls.
    }
  }

  function buildProviderInputs(snapshot) {
    const workflowApi = root && root.NovaFlowArtGenerateProviderWorkflow
    if (!workflowApi || typeof workflowApi.buildWorkflow !== 'function') return {}
    try {
      const built = workflowApi.buildWorkflow({
        provider: snapshot.provider,
        mode: snapshot.mode,
        prompt: '',
        uploadedNames: snapshot.mode === 'img2img' ? ['__novaflow_price_estimate__.png'] : [],
        outputPrefix: 'NovaFlow_Price_Estimate',
        nodeIdPrefix: 'nf_art_price_estimate',
        settings: snapshot.settings,
      })
      const providerNodeId = Array.isArray(built && built.providerNodeIds) ? String(built.providerNodeIds[0] || '') : ''
      const node = providerNodeId && built && built.workflow ? built.workflow[providerNodeId] : null
      return node && node.inputs && typeof node.inputs === 'object' ? node.inputs : {}
    } catch {
      return {}
    }
  }

  function normalizeWidgetValue(name, value) {
    if (name === 'resolution' && typeof value === 'string' && /^[124]K$/i.test(value)) return value.toLowerCase()
    return value
  }

  function buildPricingContext(snapshot, priceBadge) {
    const dependencies = priceBadge && priceBadge.depends_on && typeof priceBadge.depends_on === 'object'
      ? priceBadge.depends_on
      : {}
    const providerInputs = buildProviderInputs(snapshot)
    const widgets = {}
    for (const entry of Array.isArray(dependencies.widgets) ? dependencies.widgets : []) {
      const name = typeof entry === 'string' ? entry : String(entry && entry.name || '')
      if (!name) continue
      widgets[name] = normalizeWidgetValue(name, providerInputs[name])
    }
    const inputs = {}
    for (const entry of Array.isArray(dependencies.inputs) ? dependencies.inputs : []) {
      const name = typeof entry === 'string' ? entry : String(entry && entry.name || '')
      if (name) inputs[name] = { connected: false }
    }
    const inputGroups = {}
    for (const entry of Array.isArray(dependencies.input_groups) ? dependencies.input_groups : []) {
      const name = typeof entry === 'string' ? entry : String(entry && entry.name || '')
      if (name) inputGroups[name] = 0
    }
    return { widgets, inputs, inputGroups }
  }

  async function evaluatePriceBadge(snapshot, priceBadge) {
    if (!priceBadge || !priceBadge.expr || String(priceBadge.engine || 'jsonata') !== 'jsonata') return null
    const factory = root && root.jsonata
    if (typeof factory !== 'function') return null
    const expression = factory(String(priceBadge.expr))
    return expression.evaluate(buildPricingContext(snapshot, priceBadge))
  }

  function finiteNumber(value) {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : null
  }

  function formatCreditsValue(usd) {
    const value = finiteNumber(usd)
    if (value === null) return ''
    const rounded = Math.round(value * CREDITS_PER_USD * 10) / 10
    const digits = Math.abs(rounded - Math.round(rounded)) > 1e-9 ? 1 : 0
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(rounded)
  }

  function formatPricingResult(result) {
    if (!result || typeof result !== 'object') return ''
    const format = result.format && typeof result.format === 'object' ? result.format : {}
    const prefix = format.approximate ? '~' : ''
    if (result.type === 'usd') {
      const value = formatCreditsValue(result.usd)
      return value ? `${prefix}${value}` : ''
    }
    if (result.type === 'range_usd') {
      const min = formatCreditsValue(result.min_usd)
      const max = formatCreditsValue(result.max_usd)
      if (!min || !max) return ''
      return `${prefix}${min === max ? min : `${min}-${max}`}`
    }
    if (result.type === 'list_usd' && Array.isArray(result.usd)) {
      const values = result.usd.map(formatCreditsValue).filter(Boolean)
      return values.length ? `${prefix}${values.join(format.separator || '/')}` : ''
    }
    if (result.type === 'text') return String(result.text || '').trim()
    if (!('type' in result) && 'usd' in result) return formatCreditsValue(result.usd)
    return ''
  }

  function unavailableEstimate(snapshot) {
    return Object.freeze({
      signature: snapshot.signature,
      status: 'unavailable',
      nodeType: snapshot.nodeType,
      approximate: true,
      minCredits: null,
      maxCredits: null,
      formattedCredits: '',
      buttonLabel: UNAVAILABLE_LABEL,
    })
  }

  function scalePricingResult(result, count) {
    // The price badge quotes one run of the node; 生成数量 runs it once per image.
    const times = Math.max(1, Math.min(MAX_COUNT, Math.round(Number(count)) || 1))
    if (times === 1 || !result || typeof result !== 'object') return result
    const scale = (value) => (finiteNumber(value) === null ? value : finiteNumber(value) * times)
    const scaled = { ...result }
    if (result.type === 'range_usd') {
      scaled.min_usd = scale(result.min_usd)
      scaled.max_usd = scale(result.max_usd)
    } else if (result.type === 'list_usd' && Array.isArray(result.usd)) {
      scaled.usd = result.usd.map(scale)
    } else if (result.type === 'usd' || (!('type' in result) && 'usd' in result)) {
      scaled.usd = scale(result.usd)
    }
    return scaled
  }

  function readyEstimate(snapshot, rawResult) {
    const result = scalePricingResult(rawResult, snapshot.count)
    const formattedCredits = formatPricingResult(result)
    if (!formattedCredits) return unavailableEstimate(snapshot)
    const minCredits = result && result.type === 'range_usd' ? finiteNumber(result.min_usd) * CREDITS_PER_USD : null
    const maxCredits = result && result.type === 'range_usd' ? finiteNumber(result.max_usd) * CREDITS_PER_USD : null
    return Object.freeze({
      signature: snapshot.signature,
      status: 'ready',
      nodeType: snapshot.nodeType,
      approximate: Boolean(result && result.format && result.format.approximate),
      minCredits,
      maxCredits,
      formattedCredits,
      buttonLabel: `${START_LABEL} · ${formattedCredits}积分`,
    })
  }

  function responseNodeDefinition(response, nodeType) {
    const value = response && typeof response === 'object' && 'data' in response ? response.data : response
    return value && typeof value === 'object' ? value[nodeType] || null : null
  }

  function nodeDefinitionKey(snapshot) {
    return `${snapshot.baseUrl}|${snapshot.nodeType}`
  }

  function requestNodeDefinition(snapshot) {
    const key = nodeDefinitionKey(snapshot)
    if (nodeDefinitionRequests.has(key)) return nodeDefinitionRequests.get(key)
    if (!snapshot.requestJson || !snapshot.baseUrl || !snapshot.nodeType) return Promise.resolve(null)
    const request = Promise.resolve(snapshot.requestJson({
      baseUrl: snapshot.baseUrl,
      path: `/object_info/${encodeURIComponent(snapshot.nodeType)}`,
      init: { method: 'GET' },
    })).then((response) => responseNodeDefinition(response, snapshot.nodeType)).catch((error) => {
      nodeDefinitionRequests.delete(key)
      throw error
    })
    nodeDefinitionRequests.set(key, request)
    trimMap(nodeDefinitionRequests, NODE_CACHE_LIMIT)
    return request
  }

  function clearRetry(signature) {
    const record = retryState.get(signature)
    if (record && record.timer) clearTimeout(record.timer)
    retryState.delete(signature)
  }

  function scheduleRetry(snapshot) {
    const current = retryState.get(snapshot.signature) || { attempt: 0, timer: null }
    if (current.timer || current.attempt >= RETRY_DELAYS_MS.length) return
    const delay = RETRY_DELAYS_MS[current.attempt]
    current.attempt += 1
    current.timer = setTimeout(() => {
      current.timer = null
      if (latestSignature !== snapshot.signature) return
      estimateCache.delete(snapshot.signature)
      nodeDefinitionRequests.delete(nodeDefinitionKey(snapshot))
      startEstimate(snapshot)
    }, delay)
    current.timer?.unref?.()
    retryState.set(snapshot.signature, current)
  }

  function startEstimate(snapshot) {
    if (!snapshot.nodeType || estimateRequests.has(snapshot.signature) || estimateCache.has(snapshot.signature)) return
    const requestEpoch = estimateEpoch
    const request = requestNodeDefinition(snapshot).then(async (nodeDefinition) => {
      if (requestEpoch !== estimateEpoch) return null
      if (!nodeDefinition || !nodeDefinition.price_badge) {
        nodeDefinitionRequests.delete(nodeDefinitionKey(snapshot))
        const unavailable = unavailableEstimate(snapshot)
        estimateCache.set(snapshot.signature, unavailable)
        trimMap(estimateCache, ESTIMATE_CACHE_LIMIT)
        scheduleRetry(snapshot)
        if (latestSignature === snapshot.signature) dispatchUpdate('estimate', unavailable)
        return unavailable
      }
      const result = await evaluatePriceBadge(snapshot, nodeDefinition.price_badge)
      if (requestEpoch !== estimateEpoch) return null
      const estimate = readyEstimate(snapshot, result)
      estimateCache.set(snapshot.signature, estimate)
      trimMap(estimateCache, ESTIMATE_CACHE_LIMIT)
      if (estimate.status === 'ready') clearRetry(snapshot.signature)
      else scheduleRetry(snapshot)
      if (latestSignature === snapshot.signature) dispatchUpdate('estimate', estimate)
      return estimate
    }).catch(() => {
      if (requestEpoch !== estimateEpoch) return null
      const unavailable = unavailableEstimate(snapshot)
      estimateCache.set(snapshot.signature, unavailable)
      trimMap(estimateCache, ESTIMATE_CACHE_LIMIT)
      scheduleRetry(snapshot)
      if (latestSignature === snapshot.signature) dispatchUpdate('estimate', unavailable)
      return unavailable
    }).finally(() => {
      if (estimateRequests.get(snapshot.signature) === request) estimateRequests.delete(snapshot.signature)
    })
    estimateRequests.set(snapshot.signature, request)
  }

  function getEstimate(snapshot) {
    if (!snapshot || !snapshot.signature || !snapshot.nodeType) {
      latestSignature = ''
      return Object.freeze({ status: 'not_applicable', buttonLabel: START_LABEL, formattedCredits: '' })
    }
    latestSignature = snapshot.signature
    if (estimateCache.has(snapshot.signature)) {
      const cached = estimateCache.get(snapshot.signature)
      if (cached && cached.status === 'unavailable') scheduleRetry(snapshot)
      return cached
    }
    startEstimate(snapshot)
    return Object.freeze({
      signature: snapshot.signature,
      status: 'loading',
      nodeType: snapshot.nodeType,
      formattedCredits: '',
      buttonLabel: UNAVAILABLE_LABEL,
    })
  }

  function getButtonLabel(snapshot) {
    return getEstimate(snapshot).buttonLabel || START_LABEL
  }

  function canonicalAmount(value) {
    if (value === null || value === undefined || value === '') return ''
    const text = typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : String(value)
    if (!DECIMAL_PATTERN.test(text)) return ''
    return text
  }

  function formatCanonicalAmount(value) {
    const text = canonicalAmount(value)
    if (!text) return ''
    const [whole, fraction = ''] = text.split('.')
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    const trimmed = fraction.replace(/0+$/, '')
    return trimmed ? `${grouped}.${trimmed}` : grouped
  }

  function settlementAmount(record) {
    const settlement = record && record.settlement && typeof record.settlement === 'object' ? record.settlement : {}
    const credits = record && record.credits && typeof record.credits === 'object' ? record.credits : {}
    const candidates = [
      settlement.charge_amount_text,
      credits.deducted_text,
      settlement.charge_amount,
      credits.deducted,
    ]
    for (const candidate of candidates) {
      const formatted = formatCanonicalAmount(candidate)
      if (formatted) return formatted
    }
    return ''
  }

  function recordSettlement(payload) {
    if (!payload || typeof payload !== 'object') return false
    const promptValue = payload.promptId ?? payload.prompt_id
    if (typeof promptValue !== 'string') return false
    const promptId = promptValue.trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(promptId)) return false
    const settlement = payload.settlement && typeof payload.settlement === 'object' ? { ...payload.settlement } : {}
    const credits = payload.credits && typeof payload.credits === 'object' ? { ...payload.credits } : {}
    const providerBudget = payload.providerBudget && typeof payload.providerBudget === 'object'
      ? { ...payload.providerBudget }
      : (payload.provider_budget && typeof payload.provider_budget === 'object' ? { ...payload.provider_budget } : {})
    const pricing = payload.pricing && typeof payload.pricing === 'object' ? { ...payload.pricing } : {}
    const record = Object.freeze({
      promptId,
      settlement: Object.freeze(settlement),
      credits: Object.freeze(credits),
      providerBudget: Object.freeze(providerBudget),
      pricing: Object.freeze(pricing),
    })
    settlementCache.delete(promptId)
    settlementCache.set(promptId, record)
    trimMap(settlementCache, SETTLEMENT_CACHE_LIMIT)
    dispatchUpdate('settlement', { promptId })
    return true
  }

  function getProgressView(options = {}) {
    const promptId = String(options.promptId || options.prompt_id || '').trim()
    const record = promptId ? settlementCache.get(promptId) : null
    if (record) {
      const status = String(record.settlement.status || '').trim().toLowerCase()
      if (['not_charged', 'failed', 'cancelled', 'canceled'].includes(status)) {
        return Object.freeze({ status: 'not_charged', text: '未扣积分', chargedCredits: '', balance: '' })
      }
      const amount = settlementAmount(record)
      if (status === 'settled' && amount) {
        const balance = formatCanonicalAmount(record.credits.balance_text ?? record.credits.balance)
        return Object.freeze({ status: 'settled', text: `本次扣 ${amount}积分`, chargedCredits: amount, balance })
      }
      return Object.freeze({ status: 'pending_pricing', text: '积分待官方结算', chargedCredits: '', balance: '' })
    }
    if (options.running && options.snapshot) {
      const estimate = getEstimate(options.snapshot)
      if (estimate.status === 'ready' && estimate.formattedCredits) {
        return Object.freeze({ status: 'estimated', text: `预计 ${estimate.formattedCredits}积分`, chargedCredits: '', balance: '' })
      }
    }
    if (promptId && !options.running && options.snapshot && options.snapshot.provider !== 'local') {
      return Object.freeze({ status: 'pending_pricing', text: '积分待官方结算', chargedCredits: '', balance: '' })
    }
    return null
  }

  function resetEstimate() {
    estimateEpoch += 1
    for (const record of retryState.values()) {
      if (record && record.timer) clearTimeout(record.timer)
    }
    retryState.clear()
    nodeDefinitionRequests.clear()
    estimateRequests.clear()
    estimateCache.clear()
    latestSignature = ''
  }

  return Object.freeze({
    UPDATE_EVENT,
    createSnapshot,
    getEstimate,
    getButtonLabel,
    recordSettlement,
    getProgressView,
    resetEstimate,
  })
})
