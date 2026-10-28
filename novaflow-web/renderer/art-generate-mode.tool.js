(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowArtGenerateModeTool = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const PROVIDER_OPTIONS = Object.freeze([
    Object.freeze({ value: 'local', label: 'Qwen（本地）' }),
    Object.freeze({ value: 'gpt', label: 'GPT Image 2.5' }),
  ])
  const PROVIDER_KEYS = new Set(PROVIDER_OPTIONS.map((option) => option.value))
  const mountedControls = new WeakMap()
  let settlementRefreshBound = false

  function normalizeProvider(value) {
    const provider = String(value || '').trim().toLowerCase()
    return PROVIDER_KEYS.has(provider) ? provider : 'local'
  }

  function ownsSelect(select) {
    if (!select || String(select.tagName || '').toUpperCase() !== 'SELECT' || typeof select.getAttribute !== 'function') return false
    return select.getAttribute('data-novaflow-art-generate-provider') === '1' ||
      select.getAttribute('data-novaflow-art-generate-select-field') === '1'
  }

  function syncDisabled(select, disabled) {
    if (disabled) select.setAttribute('disabled', 'disabled')
    else if (typeof select.removeAttribute === 'function') select.removeAttribute('disabled')
  }

  function syncControlLayout(host) {
    const panelBody = host?.closest?.('.nf-panel-body')
    const panel = panelBody?.parentElement
    if (panel?.getAttribute?.('data-novaflow-spine-split-control-category') !== 'generate') return
    const bodyPadding = root?.NovaFlowLeftPanelAccordion?.TOKENS?.bodyPadding || '6px 12px 8px'
    panelBody.style.setProperty('padding', bodyPadding, 'important')
  }

  function mountSharedAccount(record, enabled = true) {
    if (!enabled) {
      if (record.authMounted) root.NovaFlowClientAuth?.unmount?.('art-generate')
      record.authMounted = false
      record.accountSlot.remove()
      return
    }
    if (record.accountSlot.parentElement !== record.host) record.host.insertBefore(record.accountSlot, record.modelField)
    if (record.authMounted) return
    const auth = root && root.NovaFlowClientAuth
    if (!auth || typeof auth.mount !== 'function') return
    auth.mount('art-generate', record.accountSlot)
    record.authMounted = true
    if (!settlementRefreshBound && typeof root?.addEventListener === 'function') {
      settlementRefreshBound = true
      root.addEventListener('message', (event) => {
        if (event?.data?.type !== 'novaflow-provider-usage-settled') return
        if (event.source !== root) return
        const accepted = root.NovaFlowArtGenerateCreditPricing?.recordSettlement?.(event.data.payload)
        if (accepted !== true) return
      })
    }
  }

  function syncModelChoices(select, documentRef, options) {
    const choices=[]
    for(const item of PROVIDER_OPTIONS){
      const option=documentRef.createElement('option');option.value=item.value;option.textContent=item.label;choices.push(option)
    }
    select.replaceChildren(...choices)
    select.value=normalizeProvider(options.provider)
  }

  function mount(options = {}) {
    const host = options.host
    if (!host || typeof host.replaceChildren !== 'function') throw new TypeError('Art Generate control host is required')
    const documentRef = host.ownerDocument || (root && root.document)
    if (!documentRef || typeof documentRef.createElement !== 'function') throw new TypeError('Art Generate control document is required')
    syncControlLayout(host)

    const existing = mountedControls.get(host)
    if (existing) {
      existing.onProviderChange = options.onProviderChange
      syncModelChoices(existing.select,documentRef,options)
      syncDisabled(existing.select, options.disabled)
      mountSharedAccount(existing, options.showAccount !== false)
      return existing.handle
    }

    const accountSlot = documentRef.createElement('div')
    accountSlot.setAttribute('data-novaflow-art-generate-account-slot', '1')

    const modelField = documentRef.createElement('div')
    modelField.setAttribute('data-novaflow-art-generate-model-field', '1')
    modelField.setAttribute('style', 'display:grid;gap:6px;min-width:0;')

    const label = documentRef.createElement('label')
    label.textContent = '模型方式'
    // Created in the brand spec's final look, so the first frame is not a white flash.
    label.setAttribute('style', 'font-size:11px;font-weight:400;color:#a9a9a9;line-height:16.5px;')

    const select = documentRef.createElement('select')
    select.setAttribute('aria-label', '模型方式')
    select.setAttribute('data-novaflow-art-generate-provider', '1')
    select.setAttribute('style', 'width:100%;height:32px;min-height:32px;max-height:32px;min-width:0;border-radius:6px;border:1px solid #343434;background:#262626;color:#e9e9e9;padding:0 26px 0 10px;font-size:12px;box-sizing:border-box;appearance:none;-webkit-appearance:none;')
    syncDisabled(select, options.disabled)
    syncModelChoices(select,documentRef,options)
    const record = {
      host,
      modelField,
      accountSlot,
      select,
      onProviderChange: options.onProviderChange,
      authMounted: false,
      handle: null,
    }
    select.addEventListener('change', () => {
      if (typeof record.onProviderChange === 'function') record.onProviderChange(normalizeProvider(select.value))
    })

    modelField.appendChild(label)
    modelField.appendChild(select)
    host.replaceChildren(...(options.showAccount === false ? [modelField] : [accountSlot, modelField]))

    let active = true
    record.handle = Object.freeze({
      accountSlot,
      select,
      unmount() {
        if (!active) return
        active = false
        mountedControls.delete(host)
        if (record.authMounted) {
          const currentAuth = root && root.NovaFlowClientAuth
          if (currentAuth && typeof currentAuth.unmount === 'function') currentAuth.unmount('art-generate')
        }
      }
    })
    mountedControls.set(host, record)
    mountSharedAccount(record, options.showAccount !== false)
    return record.handle
  }

  function modelsApi() {
    return root && root.NovaFlowArtGenerateModels
  }

  function ensureWorkspaceStyles(workspaceId) {
    const documentRef = root && root.document
    const id = 'novaflow-art-generate-provider-style'
    if (!documentRef || documentRef.getElementById?.(id)) return
    const style = documentRef.createElement('style')
    style.id = id
    style.textContent = `
      #${workspaceId}.novaflow-app .novaflow-art-generate-param select {
        height:26px!important;min-height:26px!important;max-height:26px!important;min-width:76px!important;
        padding:3px 24px 3px 8px!important;border:0!important;border-radius:8px!important;
        background:#070707!important;color:#fff!important;font-size:12px!important;line-height:18px!important;
        box-sizing:border-box!important;outline:0!important;cursor:pointer!important;
      }
      #${workspaceId}.novaflow-app .novaflow-art-generate-prompt-row {display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))!important;width:100%!important;min-width:0!important;max-width:none!important;}
      [data-novaflow-art-generate-account-slot="1"][data-novaflow-client-auth-panel="1"] {
        margin-bottom:5px!important;
      }
      [data-novaflow-art-generate-model-field="1"] > label {
        width:100%!important;text-align:left!important;justify-self:stretch!important;
      }
    `
    ;(documentRef.head || documentRef.documentElement)?.appendChild(style)
  }

  function renderSelect(options) {
    const createElement = options.createElement
    const select = createElement('select', {
      'aria-label': options.label,
      'data-novaflow-art-generate-select-field': '1',
      onchange: (event) => {
        options.onChange(String(event.currentTarget?.value || ''))
        options.rerender?.()
      },
    }, options.values.map((entry) => {
      const item = typeof entry === 'string' ? { value: entry, label: entry } : entry
      return createElement('option', {
        value: item.value,
        selected: String(item.value) === String(options.value) ? 'selected' : null,
      }, item.label)
    }))
    return createElement('label', { className: 'novaflow-art-generate-param' }, [options.label, select])
  }

  function renderParameterFields(options = {}) {
    const state = options.state || {}
    const provider = normalizeProvider(options.provider || state.provider)
    const mode = String(options.mode || state.mode) === 'img2img' ? 'img2img' : 'txt2img'
    const capability = modelsApi()?.capabilityFor?.(provider, mode, state) || modelsApi()?.getCapability?.(provider, mode) || { fields: [] }
    const fields = new Set(Array.isArray(capability.fields) ? capability.fields : [])
    const nodes = []
    const createElement = options.createElement
    const rerender = options.rerender
    if (provider === 'local') {
      const models = modelsApi()
      if (fields.has('width') || fields.has('height')) nodes.push(createElement('span', { className: 'novaflow-art-generate-param', text: '\u5206\u8fa8\u7387' }))
      if (fields.has('width')) nodes.push(options.renderNumber('W', 'width', 256, 2048))
      if (fields.has('height')) nodes.push(options.renderNumber('H', 'height', 256, 2048))
      // Steps and CFG start from the route's own defaults (2.1, NSFW, the 2511 route); see
      // localSamplingFor.
      if (fields.has('steps') && typeof options.renderSampling === 'function') nodes.push(options.renderSampling('steps', mode))
      if (fields.has('cfg') && typeof options.renderSampling === 'function') nodes.push(options.renderSampling('cfg', mode))
      if (fields.has('seed')) nodes.push(options.renderSeedToggle())
      if (fields.has('nsfw') && options.nsfwSwitch) nodes.push(options.nsfwSwitch)
      if (options.accelerationSwitch) nodes.push(options.accelerationSwitch)
      return nodes
    }
    if (provider === 'gpt') {
      const qualityKey = mode === 'img2img' ? 'gptQualityImg2img' : 'gptQualityTxt2img'
      if (fields.has('quality')) nodes.push(renderSelect({ createElement, label: '\u8d28\u91cf', value: state[qualityKey], values: [
        { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
      ], onChange: (value) => { state[qualityKey] = value }, rerender }))
      if (fields.has('size')) {
        nodes.push(renderSelect({ createElement, label: '\u5c3a\u5bf8', value: state.gptSize, values: [
          'auto', '1024x1024', '1024x1536', '1536x1024', '2048x2048', '2048x1152', '1152x2048', '3840x2160', '2160x3840', 'Custom',
        ], onChange: (value) => { state.gptSize = value }, rerender }))
        if (state.gptSize === 'Custom') {
          nodes.push(options.renderNumber('W', 'gptCustomWidth', 480, 3840))
          nodes.push(options.renderNumber('H', 'gptCustomHeight', 480, 3840))
        }
      }
      return nodes
    }
    return nodes
  }

  function syncControlPanel(options = {}) {
    const host = options.host
    const state = options.state || {}
    if (!host) return false
    ensureWorkspaceStyles(options.workspaceId || 'novaflow-art-generate-workspace')
    mount({
      host,
      showAccount: options.showAccount,
      provider: state.provider, localQwen21Variant: state.localQwen21Variant, showTurboRoute: options.showTurboRoute===true&&state.nsfw!==true,
      disabled: Boolean(state.running),
      onProviderChange(provider) {
        if (state.running) return
        const nextProvider = normalizeProvider(provider)
        if (nextProvider === state.provider) return
        state.provider = nextProvider
        state.error = ''
        state.status = ''
        options.onChange?.(nextProvider)
      },
    })
    return true
  }

  return Object.freeze({
    PROVIDER_OPTIONS,
    ownsSelect,
    mount,
    ensureWorkspaceStyles,
    renderParameterFields,
    syncControlPanel,
  })
})
