(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceMiniMaxH3LoraResource = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const MIN_STEPS = 1
  const MAX_STEPS = 10000
  const DEFAULT_STEPS = 4

  const MODE_FAMILY = Object.freeze({
    text_video: 'fl2va',
    image_video: 'fl2va',
    first_last: 'fl2va',
    multi_reference: 'ref2va',
    t2v: 'fl2va',
    i2v: 'fl2va',
    fl2v: 'fl2va',
    r2v: 'ref2va',
  })

  const MODE_NAME = Object.freeze({
    text_video: 't2v',
    image_video: 'i2v',
    first_last: 'fl2v',
    multi_reference: 'r2v',
    t2v: 't2v',
    i2v: 'i2v',
    fl2v: 'fl2v',
    r2v: 'r2v',
  })

  function stringValue(value) {
    return value == null ? '' : String(value)
  }

  function normalizeMode(value) {
    const key = stringValue(value).trim().toLowerCase()
    const mode = MODE_NAME[key]
    if (!mode) throw new Error(`Unsupported MiniMax H3 mode: ${key || '(empty)'}`)
    return mode
  }

  function familyForMode(value) {
    const key = stringValue(value).trim().toLowerCase()
    const family = MODE_FAMILY[key]
    if (!family) throw new Error(`Unsupported MiniMax H3 mode: ${key || '(empty)'}`)
    return family
  }

  function normalizeSteps(value) {
    const number = Number(value)
    if (!Number.isInteger(number) || number < MIN_STEPS || number > MAX_STEPS) {
      throw new RangeError(`MiniMax H3 steps must be an integer from ${MIN_STEPS} to ${MAX_STEPS}`)
    }
    return number
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
    if (!Array.isArray(value)) throw new TypeError('MiniMax H3 LoRA supportedSteps must be an array or null')
    return Object.freeze(Array.from(new Set(value.map(normalizeSteps))).sort((a, b) => a - b))
  }

  function normalizeCatalogItem(value) {
    if (!value || typeof value !== 'object') throw new TypeError('MiniMax H3 LoRA catalog item must be an object')
    const name = stringValue(value.name).trim()
    const modelFamily = stringValue(value.modelFamily).trim().toLowerCase()
    const kind = stringValue(value.kind || 'standard').trim().toLowerCase()
    const fingerprint = stringValue(value.fingerprint).trim()
    if (!name || !fingerprint) throw new Error('MiniMax H3 LoRA catalog item is missing name or fingerprint')
    if (!['fl2va', 'ref2va', 'h3'].includes(modelFamily)) throw new Error(`Unsupported MiniMax H3 LoRA family: ${modelFamily}`)
    if (kind !== 'standard') throw new Error(`MiniMax H3 managed accelerator cannot be selected: ${name}`)
    return Object.freeze({
      name,
      modelFamily,
      kind,
      supportedSteps: normalizeSupportedSteps(value.supportedSteps),
      strengthRange: normalizeStrengthRange(value.strengthRange),
      fingerprint,
    })
  }

  function itemSupportsContext(item, mode, steps) {
    const family = familyForMode(mode)
    const normalizedSteps = normalizeSteps(steps)
    return (item.modelFamily === family || item.modelFamily === 'h3') && (
      item.supportedSteps == null || item.supportedSteps.includes(normalizedSteps)
    )
  }

  function filterCatalog(items, context = {}) {
    const mode = normalizeMode(context.mode)
    const steps = normalizeSteps(context.steps)
    const seen = new Set()
    const normalized = []
    for (const raw of Array.isArray(items) ? items : []) {
      let item
      try {
        item = normalizeCatalogItem(raw)
      } catch {
        continue
      }
      const key = item.name.toLowerCase()
      if (seen.has(key) || !itemSupportsContext(item, mode, steps)) continue
      seen.add(key)
      normalized.push(item)
    }
    return Object.freeze(normalized.sort((a, b) => a.name.localeCompare(b.name, 'en')))
  }

  function clampStrength(value, range) {
    const number = Number(value)
    const fallback = range.default
    return Math.max(range.min, Math.min(range.max, Number.isFinite(number) ? number : fallback))
  }

  function freezeSelection(item, strength) {
    return Object.freeze({
      name: item.name,
      strength: clampStrength(strength, item.strengthRange),
      modelFamily: item.modelFamily,
      kind: item.kind,
      supportedSteps: item.supportedSteps,
      fingerprint: item.fingerprint,
      strengthRange: item.strengthRange,
    })
  }

  function createMiniMaxH3LoraStore(options = {}) {
    const listeners = new Set()
    let requestVersion = 0
    let state = {
      mode: normalizeMode(options.mode || 't2v'),
      steps: normalizeSteps(options.steps == null ? DEFAULT_STEPS : options.steps),
      items: Object.freeze([]),
      selected: Object.freeze([]),
      loading: false,
      error: '',
    }

    function snapshot() {
      return Object.freeze({
        mode: state.mode,
        modelFamily: familyForMode(state.mode),
        steps: state.steps,
        internalTurboEnabled: state.steps === 4,
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

    function setContext(context = {}) {
      const mode = normalizeMode(context.mode == null ? state.mode : context.mode)
      const steps = normalizeSteps(context.steps == null ? state.steps : context.steps)
      const items = filterCatalog(state.items, { mode, steps })
      const byName = new Map(items.map((item) => [item.name.toLowerCase(), item]))
      const selected = Object.freeze(state.selected.flatMap((entry) => {
        const item = byName.get(entry.name.toLowerCase())
        return item && item.fingerprint === entry.fingerprint ? [freezeSelection(item, entry.strength)] : []
      }))
      state = { ...state, mode, steps, items, selected, error: '' }
      return emit()
    }

    function setSelection(values) {
      const list = Array.isArray(values) ? values : []
      const byName = new Map(state.items.map((item) => [item.name.toLowerCase(), item]))
      const seen = new Set()
      const selected = []
      for (const raw of list) {
        const name = stringValue(typeof raw === 'string' ? raw : raw?.name).trim()
        const key = name.toLowerCase()
        const item = byName.get(key)
        if (!item) throw new Error(`MiniMax H3 LoRA is not compatible with the current mode and steps: ${name || '(empty)'}`)
        if (seen.has(key)) continue
        seen.add(key)
        selected.push(freezeSelection(item, typeof raw === 'string' ? undefined : raw?.strength))
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
      if (!found) throw new Error(`MiniMax H3 LoRA is not selected: ${stringValue(name).trim()}`)
      state = { ...state, selected: Object.freeze(selected), error: '' }
      return emit()
    }

    function resolveBridge(name, explicitApi) {
      const api = explicitApi || (typeof globalThis === 'object' ? globalThis.electronAPI : null)
      const bridge = api && api[name]
      return typeof bridge === 'function' ? bridge.bind(api) : null
    }

    async function refreshCatalog(context = {}) {
      const mode = normalizeMode(context.mode == null ? state.mode : context.mode)
      const steps = normalizeSteps(context.steps == null ? state.steps : context.steps)
      const bridge = resolveBridge('minimaxH3LoraCatalog', context.electronAPI)
      if (!bridge) throw new Error('MiniMax H3 LoRA compatibility service is unavailable')
      const version = ++requestVersion
      state = { ...state, mode, steps, loading: true, error: '' }
      emit()
      try {
        const response = await bridge({ mode, steps })
        if (response?.ok === false) throw new Error(stringValue(response.error || response.message || 'catalog_failed'))
        const rawItems = Array.isArray(response) ? response : (response?.items || response?.catalog || [])
        const items = filterCatalog(rawItems, { mode, steps })
        if (version !== requestVersion) return snapshot()
        const byName = new Map(items.map((item) => [item.name.toLowerCase(), item]))
        const selected = Object.freeze(state.selected.flatMap((entry) => {
          const item = byName.get(entry.name.toLowerCase())
          return item && item.fingerprint === entry.fingerprint ? [freezeSelection(item, entry.strength)] : []
        }))
        state = { ...state, mode, steps, items, selected, loading: false, error: '' }
        return emit()
      } catch (error) {
        if (version !== requestVersion) return snapshot()
        state = {
          ...state,
          mode,
          steps,
          items: Object.freeze([]),
          selected: Object.freeze([]),
          loading: false,
          error: stringValue(error?.message || error || 'catalog_failed'),
        }
        emit()
        throw error
      }
    }

    async function validateSelection(context = {}) {
      const mode = normalizeMode(context.mode == null ? state.mode : context.mode)
      const steps = normalizeSteps(context.steps == null ? state.steps : context.steps)
      const bridge = resolveBridge('minimaxH3LoraValidate', context.electronAPI)
      if (!state.selected.length) return Object.freeze([])
      if (!bridge) throw new Error('MiniMax H3 LoRA compatibility validation is unavailable')
      const output = []
      for (const selected of state.selected) {
        if (!itemSupportsContext(selected, mode, steps)) {
          throw new Error(`MiniMax H3 LoRA is not compatible with the current mode and steps: ${selected.name}`)
        }
        const response = await bridge({
          name: selected.name,
          fingerprint: selected.fingerprint,
          mode,
          steps,
          strength: selected.strength,
        })
        if (!response?.ok) {
          throw new Error(`MiniMax H3 LoRA validation failed: ${selected.name} (${stringValue(response?.error || 'incompatible')})`)
        }
        const item = normalizeCatalogItem(response.item)
        if (item.name !== selected.name || item.fingerprint !== selected.fingerprint || !itemSupportsContext(item, mode, steps)) {
          throw new Error(`MiniMax H3 LoRA changed after selection: ${selected.name}`)
        }
        output.push(Object.freeze({
          name: item.name,
          strength: clampStrength(selected.strength, item.strengthRange),
          enabled: true,
          modelFamily: item.modelFamily,
          kind: item.kind,
          supportedSteps: item.supportedSteps,
          fingerprint: item.fingerprint,
        }))
      }
      return Object.freeze(output)
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('MiniMax H3 LoRA listener must be a function')
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

  const store = createMiniMaxH3LoraStore()

  return Object.freeze({
    MIN_STEPS,
    MAX_STEPS,
    DEFAULT_STEPS,
    normalizeMode,
    normalizeSteps,
    familyForMode,
    normalizeCatalogItem,
    filterCatalog,
    createMiniMaxH3LoraStore,
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
