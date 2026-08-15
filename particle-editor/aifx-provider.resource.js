(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAifxProviderResource = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const VERSION = 'aifx-provider-v1'
  const AUTH_SURFACE = 'aifx'
  const REFERENCE_ROLES = Object.freeze({
    image1: 'template_sheet',
    image2: 'style_reference',
  })

  const PROVIDER_OPTIONS = Object.freeze([
    Object.freeze({ value: 'local', label: '\u672c\u5730\u6a21\u578b' }),
    Object.freeze({ value: 'gpt', label: 'GPT' }),
    Object.freeze({ value: 'google', label: 'Google' }),
  ])
  const PROVIDER_KEYS = new Set(PROVIDER_OPTIONS.map((option) => option.value))

  function strengthCapability(mode, verification) {
    return Object.freeze({
      mode,
      exact: false,
      verification,
    })
  }

  const CAPABILITIES = Object.freeze({
    local: Object.freeze({
      provider: 'local',
      status: 'available',
      runnable: true,
      deferred: false,
      execution: 'local',
      workflowFamily: 'qwen-image-edit-controlnet-union',
      promptDialect: 'positive-negative',
      referenceLimit: 2,
      referenceRoles: REFERENCE_ROLES,
      structurePolicy: 'layout-hard-motion-soft-silhouette-generative',
      controlGuidance: 'neutral-grayscale-motion-guide',
      strength: strengthCapability('conditioning-mix', 'pending-local-acceptance'),
    }),
    gpt: Object.freeze({
      provider: 'gpt',
      status: 'deferred',
      runnable: false,
      deferred: true,
      execution: 'cloud',
      workflowFamily: 'gpt-image-edit',
      promptDialect: 'merged-prohibitions',
      referenceLimit: 2,
      referenceRoles: REFERENCE_ROLES,
      structurePolicy: 'layout-hard-motion-soft-silhouette-generative',
      strength: strengthCapability('prompt-band', 'provider-has-no-exact-reference-weight'),
    }),
    google: Object.freeze({
      provider: 'google',
      status: 'deferred',
      runnable: false,
      deferred: true,
      execution: 'cloud',
      workflowFamily: 'gemini-image-edit',
      promptDialect: 'system-user',
      referenceLimit: 2,
      referenceRoles: REFERENCE_ROLES,
      structurePolicy: 'layout-hard-motion-soft-silhouette-generative',
      strength: strengthCapability('prompt-band', 'provider-has-no-exact-reference-weight'),
    }),
  })

  const STRENGTH_BANDS = Object.freeze({
    weak: Object.freeze({
      value: 'weak',
      minimum: 0,
      maximum: 33,
      promptDirective: 'Use image2 as a restrained material cue while preserving layout and the soft motion plan; allow a subtle material-specific outline instead of tracing image1 pixels.',
    }),
    balanced: Object.freeze({
      value: 'balanced',
      minimum: 34,
      maximum: 66,
      promptDirective: 'Apply a clear material and outline transformation from image2 while preserving frame count, grid, order, cell dimensions, motion anchors, and lifecycle coherence.',
    }),
    strong: Object.freeze({
      value: 'strong',
      minimum: 67,
      maximum: 100,
      promptDirective: 'Apply image2 material language and material-specific silhouette strongly without breaking frame count, grid, order, cell dimensions, motion path, or lifecycle.',
    }),
  })

  function normalizeProvider(value) {
    const provider = String(value || '').trim().toLowerCase()
    return PROVIDER_KEYS.has(provider) ? provider : 'local'
  }

  function normalizeStyleStrength(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 50
    return Math.max(0, Math.min(100, Math.round(parsed)))
  }

  function strengthBandFor(value) {
    const requestedPercent = normalizeStyleStrength(value)
    if (requestedPercent <= STRENGTH_BANDS.weak.maximum) return STRENGTH_BANDS.weak
    if (requestedPercent <= STRENGTH_BANDS.balanced.maximum) return STRENGTH_BANDS.balanced
    return STRENGTH_BANDS.strong
  }

  function capabilityFor(value) {
    return CAPABILITIES[normalizeProvider(value)]
  }

  function isRunnable(value) {
    return capabilityFor(value).runnable === true
  }

  function strengthContractFor(providerValue, strengthValue) {
    const provider = normalizeProvider(providerValue)
    const requestedPercent = normalizeStyleStrength(strengthValue)
    if (provider === 'local') {
      return Object.freeze({
        mode: 'conditioning-mix',
        requestedPercent,
        normalizedValue: requestedPercent / 100,
        exact: false,
        verified: false,
        verification: CAPABILITIES.local.strength.verification,
        endpoints: Object.freeze({
          minimum: 'structure_conditioning',
          maximum: 'structure_plus_style_conditioning',
        }),
      })
    }
    const band = strengthBandFor(requestedPercent)
    return Object.freeze({
      mode: 'prompt-band',
      requestedPercent,
      band: band.value,
      promptDirective: band.promptDirective,
      exact: false,
      verified: false,
      verification: capabilityFor(provider).strength.verification,
    })
  }

  function createState(initial = {}) {
    const provider = normalizeProvider(initial.provider)
    return {
      provider,
      styleStrength: normalizeStyleStrength(initial.styleStrength),
      running: initial.running === true,
      status: String(initial.status || ''),
      error: String(initial.error || ''),
    }
  }

  function selectProvider(state, value) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new TypeError('AIFX provider state is required')
    }
    if (state.running) return state.provider
    state.provider = normalizeProvider(value)
    state.status = ''
    state.error = ''
    return state.provider
  }

  function assertRunnable(value) {
    const capability = capabilityFor(value)
    if (capability.runnable) return capability
    const error = new Error(`${capability.provider.toUpperCase()} AIFX execution is deferred`)
    error.code = 'AIFX_PROVIDER_DEFERRED'
    error.provider = capability.provider
    throw error
  }

  return Object.freeze({
    version: VERSION,
    AUTH_SURFACE,
    REFERENCE_ROLES,
    PROVIDER_OPTIONS,
    CAPABILITIES,
    STRENGTH_BANDS,
    normalizeProvider,
    normalizeStyleStrength,
    strengthBandFor,
    strengthContractFor,
    capabilityFor,
    isRunnable,
    createState,
    selectProvider,
    assertRunnable,
  })
})
