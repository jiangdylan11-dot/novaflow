(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAifxProviderTool = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const AUTH_SURFACE = 'aifx'
  const FALLBACK_OPTIONS = Object.freeze([
    Object.freeze({ value: 'local', label: '\u672c\u5730\u6a21\u578b' }),
    Object.freeze({ value: 'gpt', label: 'GPT' }),
    Object.freeze({ value: 'google', label: 'Google' }),
  ])
  const mountedControls = new WeakMap()

  function resourceApi() {
    return root && root.NovaFlowAifxProviderResource
  }

  function providerOptions() {
    const options = resourceApi()?.PROVIDER_OPTIONS
    return Array.isArray(options) && options.length ? options : FALLBACK_OPTIONS
  }

  function normalizeProvider(value) {
    const resource = resourceApi()
    if (typeof resource?.normalizeProvider === 'function') return resource.normalizeProvider(value)
    const provider = String(value || '').trim().toLowerCase()
    return provider === 'gpt' || provider === 'google' ? provider : 'local'
  }

  function capabilityFor(value) {
    const provider = normalizeProvider(value)
    const resource = resourceApi()
    if (typeof resource?.capabilityFor === 'function') return resource.capabilityFor(provider)
    return Object.freeze({
      provider,
      status: provider === 'local' ? 'available' : 'deferred',
      runnable: provider === 'local',
      deferred: provider !== 'local',
    })
  }

  function ownsSelect(select) {
    if (!select || String(select.tagName || '').toUpperCase() !== 'SELECT' || typeof select.getAttribute !== 'function') return false
    return select.getAttribute('data-novaflow-aifx-provider') === '1'
  }

  function syncDisabled(select, disabled) {
    if (disabled) select.setAttribute('disabled', 'disabled')
    else if (typeof select.removeAttribute === 'function') select.removeAttribute('disabled')
  }

  function syncOptionAvailability(select) {
    const options = Array.from(select?.children || [])
    options.forEach((option) => {
      const capability = capabilityFor(option.value)
      option.disabled = capability.runnable !== true
      option.setAttribute?.('data-novaflow-aifx-provider-status', capability.status)
      if (capability.runnable) option.removeAttribute?.('disabled')
      else option.setAttribute?.('disabled', 'disabled')
    })
  }

  function providerStatusText(value) {
    const capability = capabilityFor(value)
    if (capability.runnable) return '\u672c\u5730\u6a21\u578b\u5df2\u542f\u7528'
    return `${capability.provider === 'gpt' ? 'GPT' : 'Google'} \u5df2\u4fdd\u7559\u63a5\u53e3\uff0c\u6267\u884c\u63a5\u5165\u6392\u540e`
  }

  function mountAuth(record) {
    if (record.authMounted) return
    const auth = root && root.NovaFlowClientAuth
    if (!auth || typeof auth.mount !== 'function') return
    auth.mount(AUTH_SURFACE, record.accountSlot)
    record.authMounted = true
  }

  function syncRecord(record, options) {
    record.onProviderChange = options.onProviderChange
    record.provider = normalizeProvider(options.provider)
    record.select.value = record.provider
    syncDisabled(record.select, options.disabled)
    syncOptionAvailability(record.select)
    record.status.textContent = providerStatusText(record.provider)
    record.status.setAttribute('data-status', capabilityFor(record.provider).status)
    mountAuth(record)
  }

  function mount(options = {}) {
    const host = options.host
    if (!host || typeof host.replaceChildren !== 'function') throw new TypeError('AIFX provider control host is required')
    const documentRef = host.ownerDocument || (root && root.document)
    if (!documentRef || typeof documentRef.createElement !== 'function') throw new TypeError('AIFX provider control document is required')

    const existing = mountedControls.get(host)
    if (existing) {
      syncRecord(existing, options)
      return existing.handle
    }

    const accountSlot = documentRef.createElement('div')
    accountSlot.setAttribute('data-novaflow-aifx-account-slot', '1')

    const modelField = documentRef.createElement('div')
    modelField.setAttribute('data-novaflow-aifx-model-field', '1')
    modelField.setAttribute('style', 'display:grid;gap:6px;min-width:0;')

    const label = documentRef.createElement('label')
    label.textContent = '\u6a21\u578b\u65b9\u5f0f'
    label.setAttribute('style', 'font-size:11px;font-weight:800;color:rgba(255,255,255,0.78);')

    const select = documentRef.createElement('select')
    select.setAttribute('aria-label', '\u6a21\u578b\u65b9\u5f0f')
    select.setAttribute('data-novaflow-aifx-provider', '1')
    select.setAttribute('style', 'width:100%;height:32px;min-width:0;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:#2f2f2f;color:#fff;padding:0 9px;box-sizing:border-box;')
    providerOptions().forEach((providerOption) => {
      const option = documentRef.createElement('option')
      option.value = providerOption.value
      option.textContent = providerOption.label
      select.appendChild(option)
    })

    const status = documentRef.createElement('div')
    status.setAttribute('data-novaflow-aifx-provider-message', '1')
    status.setAttribute('style', 'font-size:10px;line-height:1.4;color:rgba(255,255,255,0.48);')

    const record = {
      accountSlot,
      select,
      status,
      provider: 'local',
      onProviderChange: options.onProviderChange,
      authMounted: false,
      handle: null,
    }
    select.addEventListener('change', () => {
      const nextProvider = normalizeProvider(select.value)
      const capability = capabilityFor(nextProvider)
      if (!capability.runnable) {
        select.value = record.provider
        record.status.textContent = providerStatusText(nextProvider)
        record.status.setAttribute('data-status', capability.status)
        return
      }
      record.provider = nextProvider
      record.status.textContent = providerStatusText(nextProvider)
      record.status.setAttribute('data-status', capability.status)
      if (typeof record.onProviderChange === 'function') record.onProviderChange(nextProvider)
    })

    modelField.appendChild(label)
    modelField.appendChild(select)
    modelField.appendChild(status)
    host.replaceChildren(accountSlot, modelField)

    let active = true
    record.handle = Object.freeze({
      accountSlot,
      select,
      status,
      unmount() {
        if (!active) return
        active = false
        mountedControls.delete(host)
        if (!record.authMounted) return
        const auth = root && root.NovaFlowClientAuth
        if (auth && typeof auth.unmount === 'function') auth.unmount(AUTH_SURFACE)
      },
    })
    mountedControls.set(host, record)
    syncRecord(record, options)
    return record.handle
  }

  function syncControlPanel(options = {}) {
    const state = options.state
    if (!state || typeof state !== 'object') throw new TypeError('AIFX provider state is required')
    if (!options.host) return false
    mount({
      host: options.host,
      provider: state.provider,
      disabled: state.running === true,
      onProviderChange(provider) {
        if (state.running) return
        const resource = resourceApi()
        if (typeof resource?.selectProvider === 'function') resource.selectProvider(state, provider)
        else state.provider = normalizeProvider(provider)
        options.onChange?.(state.provider)
      },
    })
    return true
  }

  return Object.freeze({
    AUTH_SURFACE,
    PROVIDER_OPTIONS: FALLBACK_OPTIONS,
    normalizeProvider,
    capabilityFor,
    ownsSelect,
    providerStatusText,
    mount,
    syncControlPanel,
  })
})
