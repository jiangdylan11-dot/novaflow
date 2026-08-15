(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceWan22LoraResource = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const MIN_STEPS = 1
  const MAX_STEPS = 10000
  const DEFAULT_STEPS = 4
  const MODEL_FAMILY = 'wan2.2_i2v_14b'

  function stringValue(value) {
    return value == null ? '' : String(value)
  }

  function normalizeSteps(value) {
    const number = Number(value)
    if (!Number.isInteger(number) || number < MIN_STEPS || number > MAX_STEPS) {
      throw new RangeError(`Wan2.2 steps must be an integer from ${MIN_STEPS} to ${MAX_STEPS}`)
    }
    return number
  }

  function normalizeContext(value = {}, fallback = {}) {
    return Object.freeze({
      highName: stringValue(value.highName == null ? fallback.highName : value.highName).trim(),
      lowName: stringValue(value.lowName == null ? fallback.lowName : value.lowName).trim(),
      steps: normalizeSteps(value.steps == null ? (fallback.steps == null ? DEFAULT_STEPS : fallback.steps) : value.steps),
    })
  }

  function contextKey(value) {
    return `${value.highName}\n${value.lowName}\n${value.steps}`
  }

  function normalizeStrengthRange(value) {
    const source = value && typeof value === 'object' ? value : {}
    const min = Number.isFinite(Number(source.min)) ? Number(source.min) : 0
    const max = Number.isFinite(Number(source.max)) ? Number(source.max) : 2
    const lower = Math.min(min, max)
    const upper = Math.max(min, max)
    const defaultValue = Number.isFinite(Number(source.default)) ? Number(source.default) : 1
    const step = Number.isFinite(Number(source.step)) && Number(source.step) > 0 ? Number(source.step) : 0.05
    return Object.freeze({
      min: lower,
      max: upper,
      default: Math.max(lower, Math.min(upper, defaultValue)),
      step,
    })
  }

  function normalizeSupportedSteps(value) {
    if (value == null) return null
    if (!Array.isArray(value)) throw new TypeError('Wan2.2 LoRA supportedSteps must be an array or null')
    return Object.freeze(Array.from(new Set(value.map(normalizeSteps))).sort((a, b) => a - b))
  }

  function normalizeCatalogItem(value) {
    if (!value || typeof value !== 'object') throw new TypeError('Wan2.2 LoRA catalog item must be an object')
    const name = stringValue(value.name).trim()
    const modelFamily = stringValue(value.modelFamily).trim().toLowerCase()
    const role = stringValue(value.role).trim().toLowerCase()
    const kind = stringValue(value.kind).trim().toLowerCase()
    const fingerprint = stringValue(value.fingerprint).trim()
    const highFingerprint = stringValue(value.highFingerprint).trim()
    const lowFingerprint = stringValue(value.lowFingerprint).trim()
    if (!name || !fingerprint || !highFingerprint || !lowFingerprint) {
      throw new Error('Wan2.2 LoRA catalog item is missing a name or fingerprint')
    }
    if (modelFamily !== MODEL_FAMILY || !['high', 'low', 'shared'].includes(role) || kind !== 'standard') {
      throw new Error(`Wan2.2 LoRA is not compatible: ${name}`)
    }
    return Object.freeze({
      name,
      modelFamily,
      role,
      kind,
      supportedSteps: normalizeSupportedSteps(value.supportedSteps),
      strengthRange: normalizeStrengthRange(value.strengthRange),
      fingerprint,
      highFingerprint,
      lowFingerprint,
    })
  }

  function itemSupportsSteps(item, steps) {
    const normalizedSteps = normalizeSteps(steps)
    return item.supportedSteps == null || item.supportedSteps.includes(normalizedSteps)
  }

  function filterCatalog(values, context = {}) {
    const normalizedContext = normalizeContext(context)
    if (!normalizedContext.highName || !normalizedContext.lowName) return Object.freeze([])
    const seen = new Set()
    const items = []
    for (const raw of Array.isArray(values) ? values : []) {
      let item
      try {
        item = normalizeCatalogItem(raw)
      } catch {
        continue
      }
      const key = item.name.toLowerCase()
      if (seen.has(key) || !itemSupportsSteps(item, normalizedContext.steps)) continue
      seen.add(key)
      items.push(item)
    }
    return Object.freeze(items.sort((a, b) => a.name.localeCompare(b.name, 'en')))
  }

  function clampStrength(value, range) {
    const number = Number(value)
    return Math.max(range.min, Math.min(range.max, Number.isFinite(number) ? number : range.default))
  }

  function freezeSelection(item, strength) {
    const normalizedStrength = clampStrength(strength, item.strengthRange)
    return Object.freeze({
      name: item.name,
      strength: normalizedStrength,
      weight: normalizedStrength,
      enabled: true,
      modelFamily: item.modelFamily,
      role: item.role,
      kind: item.kind,
      supportedSteps: item.supportedSteps,
      strengthRange: item.strengthRange,
      fingerprint: item.fingerprint,
      highFingerprint: item.highFingerprint,
      lowFingerprint: item.lowFingerprint,
    })
  }

  function sameIdentity(left, right) {
    return left.name === right.name &&
      left.role === right.role &&
      left.fingerprint === right.fingerprint &&
      left.highFingerprint === right.highFingerprint &&
      left.lowFingerprint === right.lowFingerprint
  }

  function createWan22LoraStore(options = {}) {
    const listeners = new Set()
    let requestVersion = 0
    let state = {
      context: normalizeContext(options),
      items: Object.freeze([]),
      selected: Object.freeze([]),
      loading: false,
      error: '',
    }

    function snapshot() {
      return Object.freeze({
        highName: state.context.highName,
        lowName: state.context.lowName,
        steps: state.context.steps,
        items: state.items,
        selected: state.selected,
        loading: state.loading,
        error: state.error,
      })
    }

    function emit() {
      const value = snapshot()
      for (const listener of Array.from(listeners)) {
        try { listener(value) } catch { void 0 }
      }
      return value
    }

    function setContext(value = {}) {
      const nextContext = normalizeContext(value, state.context)
      const changed = contextKey(nextContext) !== contextKey(state.context)
      state = changed
        ? { ...state, context: nextContext, items: Object.freeze([]), selected: Object.freeze([]), loading: false, error: '' }
        : { ...state, context: nextContext, error: '' }
      return emit()
    }

    function setSelection(values) {
      const byName = new Map(state.items.map((item) => [item.name.toLowerCase(), item]))
      const seen = new Set()
      const selected = []
      for (const raw of Array.isArray(values) ? values : []) {
        const name = stringValue(typeof raw === 'string' ? raw : raw?.name).trim()
        const key = name.toLowerCase()
        const item = byName.get(key)
        if (!item) throw new Error(`Wan2.2 LoRA is not compatible with the current models and steps: ${name || '(empty)'}`)
        if (seen.has(key)) continue
        seen.add(key)
        selected.push(freezeSelection(item, typeof raw === 'string' ? undefined : (raw?.strength ?? raw?.weight)))
      }
      state = { ...state, selected: Object.freeze(selected), error: '' }
      return emit()
    }

    function remove(name) {
      const key = stringValue(name).trim().toLowerCase()
      state = { ...state, selected: Object.freeze(state.selected.filter((entry) => entry.name.toLowerCase() !== key)) }
      return emit()
    }

    function updateStrength(name, strength) {
      const key = stringValue(name).trim().toLowerCase()
      let found = false
      const selected = state.selected.map((entry) => {
        if (entry.name.toLowerCase() !== key) return entry
        found = true
        const item = state.items.find((candidate) => candidate.name.toLowerCase() === key)
        return freezeSelection(item || entry, strength)
      })
      if (!found) throw new Error(`Wan2.2 LoRA is not selected: ${stringValue(name).trim()}`)
      state = { ...state, selected: Object.freeze(selected), error: '' }
      return emit()
    }

    function resolveBridge(name, explicitApi) {
      const api = explicitApi || (typeof globalThis === 'object' ? globalThis.electronAPI : null)
      const bridge = api && api[name]
      return typeof bridge === 'function' ? bridge.bind(api) : null
    }

    async function refreshCatalog(value = {}) {
      const nextContext = normalizeContext(value, state.context)
      const changed = contextKey(nextContext) !== contextKey(state.context)
      if (changed) setContext(nextContext)
      const bridge = resolveBridge('wan22LoraCatalog', value.electronAPI)
      const version = ++requestVersion
      state = { ...state, context: nextContext, loading: true, error: '' }
      emit()
      try {
        if (!nextContext.highName || !nextContext.lowName) throw new Error('Wan2.2 High and Low models must both be selected')
        if (!bridge) throw new Error('Wan2.2 LoRA compatibility service is unavailable')
        const response = await bridge(nextContext)
        if (response?.ok === false) throw new Error(stringValue(response.error || response.message || 'catalog_failed'))
        const rawItems = Array.isArray(response) ? response : (response?.items || response?.catalog || [])
        const items = filterCatalog(rawItems, nextContext)
        if (version !== requestVersion) return snapshot()
        const byName = new Map(items.map((item) => [item.name.toLowerCase(), item]))
        const selected = Object.freeze(state.selected.flatMap((entry) => {
          const item = byName.get(entry.name.toLowerCase())
          return item && sameIdentity(item, entry) ? [freezeSelection(item, entry.strength)] : []
        }))
        state = { ...state, context: nextContext, items, selected, loading: false, error: '' }
        return emit()
      } catch (error) {
        if (version !== requestVersion) return snapshot()
        state = {
          ...state,
          context: nextContext,
          items: Object.freeze([]),
          selected: Object.freeze([]),
          loading: false,
          error: stringValue(error?.message || error || 'catalog_failed'),
        }
        emit()
        throw error
      }
    }

    async function validateSelection(value = {}) {
      const currentContext = normalizeContext(value, state.context)
      if (contextKey(currentContext) !== contextKey(state.context)) {
        throw new Error('Wan2.2 LoRA selection context changed before validation')
      }
      if (!state.selected.length) return Object.freeze([])
      const bridge = resolveBridge('wan22LoraValidate', value.electronAPI)
      if (!bridge) throw new Error('Wan2.2 LoRA compatibility validation is unavailable')
      const output = []
      for (const selected of state.selected) {
        if (!itemSupportsSteps(selected, currentContext.steps)) {
          throw new Error(`Wan2.2 LoRA is not compatible with the current steps: ${selected.name}`)
        }
        const response = await bridge({
          ...currentContext,
          name: selected.name,
          role: selected.role,
          fingerprint: selected.fingerprint,
          highFingerprint: selected.highFingerprint,
          lowFingerprint: selected.lowFingerprint,
          strength: selected.strength,
        })
        if (!response?.ok) {
          throw new Error(`Wan2.2 LoRA validation failed: ${selected.name} (${stringValue(response?.error || 'incompatible')})`)
        }
        const item = normalizeCatalogItem(response.item)
        if (!sameIdentity(item, selected) || !itemSupportsSteps(item, currentContext.steps)) {
          throw new Error(`Wan2.2 LoRA or model files changed after selection: ${selected.name}`)
        }
        const strength = clampStrength(response.strength == null ? selected.strength : response.strength, item.strengthRange)
        output.push(freezeSelection(item, strength))
      }
      return Object.freeze(output)
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Wan2.2 LoRA listener must be a function')
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    return Object.freeze({
      getSnapshot: snapshot,
      subscribe,
      setContext,
      setSelection,
      remove,
      updateStrength,
      refreshCatalog,
      validateSelection,
      clear: () => setSelection([]),
    })
  }

  const store = createWan22LoraStore()

  return Object.freeze({
    MIN_STEPS,
    MAX_STEPS,
    DEFAULT_STEPS,
    MODEL_FAMILY,
    normalizeSteps,
    normalizeContext,
    normalizeCatalogItem,
    filterCatalog,
    createWan22LoraStore,
    store,
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    setContext: store.setContext,
    setSelection: store.setSelection,
    remove: store.remove,
    updateStrength: store.updateStrength,
    refreshCatalog: store.refreshCatalog,
    validateSelection: store.validateSelection,
    clear: store.clear,
  })
})
