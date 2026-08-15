(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignModeTool = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const AUTH_SURFACE_KEY = 'ui-design'
  const FALLBACK_PROVIDER_OPTIONS = Object.freeze([
    Object.freeze({ value: 'local', label: '本地模型' }),
    Object.freeze({ value: 'gpt', label: 'GPT' }),
    Object.freeze({ value: 'google', label: 'Google' }),
  ])
  const mountedControls = new WeakMap()

  function accordionApi() {
    const accordion = root?.NovaFlowLeftPanelAccordion
    if (!accordion || typeof accordion.syncExpanded !== 'function') {
      throw new TypeError('NovaFlow left-panel accordion helper is required')
    }
    return accordion
  }

  function createElement(documentRef, tagName, attributes = {}, children = []) {
    const node = documentRef.createElement(tagName)
    Object.entries(attributes).forEach(([name, value]) => {
      if (name === 'text') node.textContent = String(value == null ? '' : value)
      else if (name === 'style') Object.assign(node.style, value || {})
      else if (name in node && !name.startsWith('data-') && !name.startsWith('aria-')) node[name] = value
      else if (value != null) node.setAttribute(name, String(value))
    })
    ;(Array.isArray(children) ? children : [children]).filter(Boolean).forEach((child) => node.appendChild(child))
    return node
  }

  function providerOptions() {
    const options = root?.NovaFlowUiDesignGenerateTool?.PROVIDER_OPTIONS
    return Array.isArray(options) && options.length ? options : FALLBACK_PROVIDER_OPTIONS
  }

  function normalizeProvider(value) {
    const provider = String(value || '').trim().toLowerCase()
    return providerOptions().some((option) => option.value === provider) ? provider : 'local'
  }

  function readContext(record) {
    try {
      const value = record.options.getContext?.()
      return value && typeof value === 'object' ? value : {}
    } catch {
      return {}
    }
  }

  function mountAuth(record) {
    if (record.authMounted) return true
    const auth = root?.NovaFlowClientAuth
    if (!auth || typeof auth.mount !== 'function') return false
    auth.mount(AUTH_SURFACE_KEY, record.accountSlot)
    record.authMounted = true
    return true
  }

  function sync(record) {
    const context = readContext(record)
    const generatorId = String(context.id || '')
    const disabled = !generatorId || context.disabled === true
    record.context = context
    record.select.value = normalizeProvider(context.provider)
    record.select.disabled = disabled
    if (disabled) record.select.setAttribute('disabled', 'disabled')
    else record.select.removeAttribute?.('disabled')
    record.target.textContent = generatorId
      ? `当前目标：${String(context.title || 'UI 生成器')}`
      : '请先添加 UI 生成器'
    record.target.setAttribute('data-disabled', disabled ? '1' : '0')
  }

  function syncExpanded(record) {
    record.accordion.syncExpanded(record.section, record.header, record.body, record.chevron, record.expanded)
    if (record.expanded) mountAuth(record)
  }

  function mount(options = {}) {
    const host = options.host
    if (!host || typeof host.replaceChildren !== 'function') throw new TypeError('UI Design Mode host is required')
    const existing = mountedControls.get(host)
    if (existing) {
      existing.options = options
      sync(existing)
      return existing.handle
    }

    const documentRef = host.ownerDocument || root?.document
    if (!documentRef || typeof documentRef.createElement !== 'function') throw new TypeError('UI Design Mode document is required')
    const accordion = accordionApi()
    const title = createElement(documentRef, 'span', { style: accordion.titleStyle() }, [
      createElement(documentRef, 'i', {
        className: 'fas fa-magic',
        'aria-hidden': 'true',
        style: accordion.iconStyle(),
      }),
      createElement(documentRef, 'span', { text: '模式', style: accordion.labelStyle() }),
    ])
    const chevron = createElement(documentRef, 'i', {
      className: accordion.chevronClass(false),
      'aria-hidden': 'true',
      style: accordion.chevronStyle(),
    })
    const header = createElement(documentRef, 'button', {
      type: 'button',
      'data-novaflow-ui-design-mode-toggle': '1',
      'aria-expanded': 'false',
      className: 'nf-panel-header',
      style: accordion.headerStyle(false),
    }, [title, chevron])
    const accountSlot = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-mode-account-slot': '1',
      style: { minWidth: '0', width: '100%' },
    })
    const label = createElement(documentRef, 'label', {
      text: '模型方式',
      style: { color: 'rgba(255,255,255,0.78)', fontSize: '11px', fontWeight: '800' },
    })
    const select = createElement(documentRef, 'select', {
      'aria-label': '模型方式',
      'data-novaflow-ui-design-mode-provider': '1',
      style: {
        width: '100%', height: '32px', minWidth: '0', borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.12)', background: '#070707',
        color: '#fff', padding: '0 9px', boxSizing: 'border-box', cursor: 'pointer',
      },
    }, providerOptions().map((option) => createElement(documentRef, 'option', {
      value: option.value,
      text: option.label,
    })))
    const modelField = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-mode-model-field': '1',
      style: { display: 'grid', gap: '6px', minWidth: '0' },
    }, [label, select])
    const target = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-mode-target': '1',
      style: { color: 'rgba(255,255,255,0.46)', fontSize: '9px', lineHeight: '1.4' },
    })
    const body = createElement(documentRef, 'div', {
      'data-novaflow-ui-design-mode-body': '1',
      className: 'nf-panel-body',
      style: accordion.bodyStyle(false),
    }, [accountSlot, modelField, target])
    const section = createElement(documentRef, 'section', {
      'data-novaflow-left-accordion-panel': '1',
      'data-novaflow-ui-design-mode-tool': '1',
      'data-open': '0',
      className: 'nf-panel',
      style: accordion.panelStyle(),
    }, [header, body])
    const record = {
      host,
      options,
      section,
      accordion,
      header,
      body,
      chevron,
      accountSlot,
      select,
      target,
      context: {},
      expanded: options.expanded === true,
      authMounted: false,
      active: true,
      handle: null,
    }
    header.addEventListener('click', () => {
      record.expanded = !record.expanded
      syncExpanded(record)
    })
    select.addEventListener('change', () => {
      if (record.select.disabled) return
      const provider = normalizeProvider(record.select.value)
      record.options.onProviderChange?.(provider, record.context)
      sync(record)
    })
    record.handle = Object.freeze({
      update() {
        if (!record.active) return false
        sync(record)
        return true
      },
      destroy() {
        if (!record.active) return
        record.active = false
        mountedControls.delete(host)
        if (record.authMounted) root?.NovaFlowClientAuth?.unmount?.(AUTH_SURFACE_KEY)
        record.authMounted = false
        record.section.remove?.()
      },
    })
    mountedControls.set(host, record)
    host.replaceChildren(section)
    sync(record)
    syncExpanded(record)
    return record.handle
  }

  return Object.freeze({
    AUTH_SURFACE_KEY,
    PROVIDER_OPTIONS: FALLBACK_PROVIDER_OPTIONS,
    mount,
  })
})
