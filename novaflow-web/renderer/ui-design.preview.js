(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignPreview = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const mountedPreviews = new WeakMap()

  const PANEL_CSS = `
    [data-novaflow-ui-design-preview="1"] {
      width:100%;height:100%;min-width:0;display:flex;flex-direction:column;overflow:hidden;
      box-sizing:border-box;background:#151515;color:#f4f4f5;font-family:Inter,"Microsoft YaHei",sans-serif;
    }
    [data-novaflow-ui-design-preview="1"] * { box-sizing:border-box; }
    [data-novaflow-ui-design-preview-body="1"] { min-height:0;flex:1;overflow:auto;padding:10px; }
    [data-novaflow-ui-design-preview-body="1"][data-empty="1"] {
      display:grid;place-items:center;overflow:hidden;padding:18px;
    }
    [data-novaflow-ui-design-card-list="1"] { display:grid;grid-template-columns:minmax(0,1fr);gap:6px; }
    [data-novaflow-ui-design-resource-card], [data-novaflow-ui-design-result-card] {
      min-width:0;min-height:46px;height:46px;display:grid;grid-template-columns:34px minmax(0,1fr) 22px;
      align-items:center;gap:8px;padding:5px 8px;border:1px solid transparent;border-radius:7px;
      background:#2f2f2f;overflow:hidden;cursor:pointer;
    }
    [data-novaflow-ui-design-resource-card][aria-selected="true"],
    [data-novaflow-ui-design-result-card][aria-selected="true"] {
      background:#123126;box-shadow:inset 3px 0 0 rgba(37,184,127,.98);
    }
    [data-novaflow-ui-design-thumbnail="1"] {
      width:34px;height:34px;min-width:34px;display:block;object-fit:contain;border-radius:7px;background:#050505;
    }
    [data-novaflow-ui-design-card-meta="1"] {
      min-width:0;height:30px;display:grid;grid-template-rows:14px 12px;
      align-content:center;align-self:center;gap:2px;
    }
    [data-novaflow-ui-design-card-title="1"] {
      min-width:0;overflow:hidden;color:#fff;font-size:12px;line-height:14px;font-weight:500;white-space:nowrap;text-overflow:ellipsis;
    }
    [data-novaflow-ui-design-card-name="1"] {
      min-width:0;overflow:hidden;color:rgba(148,163,184,.9);font-size:10px;line-height:12px;white-space:nowrap;text-overflow:ellipsis;
    }
    [data-novaflow-ui-design-remove] {
      width:24px;height:24px;min-width:24px;padding:0;border:0;border-radius:6px;background:transparent;color:rgba(255,255,255,.7);
      font-size:18px;line-height:20px;text-align:center;cursor:pointer;
    }
    [data-novaflow-ui-design-remove]:hover { background:rgba(255,255,255,.08);color:#fff; }
    [data-novaflow-ui-design-empty="1"] {
      min-height:0;padding:0;text-align:center;color:rgba(226,232,240,.78);font-size:12px;line-height:1.7;
    }
    [data-novaflow-ui-design-message="1"] { margin:0 10px 8px;padding:7px 9px;border-radius:7px;background:#292929;color:#cfcfcf;font-size:10px; }
    [data-novaflow-ui-design-message="1"][data-error="1"] { background:rgba(239,68,68,.12);color:#fca5a5; }
  `

  function setAttributes(element, attributes) {
    Object.keys(attributes || {}).forEach((name) => {
      const value = attributes[name]
      if (value == null || value === false) return
      element.setAttribute(name, value === true ? '1' : String(value))
    })
    return element
  }

  function createElement(documentRef, tagName, attributes, text) {
    const element = setAttributes(documentRef.createElement(tagName), attributes)
    if (text != null) element.textContent = String(text)
    return element
  }

  function stopEvent(event) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
  }

  function mount(options = {}) {
    const host = options.host
    const store = options.store
    if (!host || typeof host.replaceChildren !== 'function') throw new TypeError('UI Design preview host is required')
    if (!store || typeof store.getState !== 'function' || typeof store.subscribe !== 'function') {
      throw new TypeError('UI Design preview requires an independent project store')
    }
    const documentRef = host.ownerDocument || (root && root.document)
    if (!documentRef || typeof documentRef.createElement !== 'function') throw new TypeError('UI Design preview document is required')

    mountedPreviews.get(host)?.unmount?.()
    let active = true
    let message = ''
    let messageIsError = false

    function showMessage(value, isError) {
      message = String(value || '')
      messageIsError = Boolean(isError)
      render()
      if (typeof options.onMessage === 'function') options.onMessage(message, { error: messageIsError })
    }

    function selectResource(resource) {
      store.setSelectedResource?.(resource.id)
      if (typeof options.onSelectResource === 'function') options.onSelectResource(resource)
    }

    function selectResult(result) {
      store.setSelectedResult?.(result.id)
      if (typeof options.onSelectResult === 'function') options.onSelectResult(result)
    }

    function appendThumbnail(card, item) {
      const image = createElement(documentRef, 'img', {
        'data-novaflow-ui-design-thumbnail': '1',
        src: item.dataUrl,
        alt: item.name || 'UI image',
        draggable: 'false',
      })
      card.appendChild(image)
    }

    function enableResourceDrag(card, resource, title) {
      if (!resource?.id) return
      card.setAttribute('draggable', 'true')
      if (title) card.setAttribute('title', title)
      card.addEventListener('dragstart', (event) => {
        const transfer = event?.dataTransfer
        if (!transfer || typeof transfer.setData !== 'function') return
        transfer.effectAllowed = 'copy'
        transfer.setData('application/x-novaflow-ui-resource', resource.id)
        transfer.setData('text/novaflow-ui-resource', resource.id)
      })
    }

    function cardSubtitle(item) {
      const name = String(item?.name || '')
      const width = Number(item?.width)
      const height = Number(item?.height)
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return name
      return `${name} · ${Math.round(width)}x${Math.round(height)}`
    }

    function renderResourceCard(resource, state) {
      const selected = state.selectedResourceId === resource.id
      const card = createElement(documentRef, 'article', {
        'data-novaflow-ui-design-resource-card': resource.id,
        'data-novaflow-ui-design-card-kind': 'resource',
        'aria-selected': selected ? 'true' : 'false',
        role: 'button',
        tabindex: '0',
      })
      card.addEventListener('click', () => selectResource(resource))
      card.addEventListener('keydown', (event) => {
        if (event?.key === 'Enter' || event?.key === ' ') selectResource(resource)
      })
      enableResourceDrag(card, resource, '拖到中央无限画布')
      appendThumbnail(card, resource)

      const meta = createElement(documentRef, 'div', { 'data-novaflow-ui-design-card-meta': '1' })
      const subtitle = cardSubtitle(resource)
      meta.appendChild(createElement(documentRef, 'div', { 'data-novaflow-ui-design-card-title': '1' }, resource.title || '原图资源'))
      meta.appendChild(createElement(documentRef, 'div', { 'data-novaflow-ui-design-card-name': '1', title: subtitle }, subtitle))
      const removeButton = createElement(documentRef, 'button', {
        type: 'button',
        'data-novaflow-ui-design-remove': resource.id,
        'data-novaflow-ui-design-remove-kind': 'resource',
        'aria-label': `删除 ${resource.name}`,
      }, '×')
      removeButton.addEventListener('click', (event) => {
        stopEvent(event)
        store.removeResource?.(resource.id)
      })
      card.appendChild(meta)
      card.appendChild(removeButton)
      return card
    }

    function renderResultCard(result, state, resourceProjection) {
      const card = createElement(documentRef, 'article', {
        'data-novaflow-ui-design-result-card': result.id,
        'data-novaflow-ui-design-card-kind': 'result',
        'aria-selected': state.selectedResultId === result.id ? 'true' : 'false',
        role: 'button',
        tabindex: '0',
      })
      card.addEventListener('click', () => selectResult(result))
      card.addEventListener('keydown', (event) => {
        if (event?.key === 'Enter' || event?.key === ' ') selectResult(result)
      })
      if (resourceProjection) {
        enableResourceDrag(card, resourceProjection, '点击选择生成结果，或拖到中央画布作为参考')
      }
      appendThumbnail(card, result)
      const meta = createElement(documentRef, 'div', { 'data-novaflow-ui-design-card-meta': '1' })
      const subtitle = cardSubtitle(result)
      meta.appendChild(createElement(documentRef, 'div', { 'data-novaflow-ui-design-card-title': '1' }, result.title || 'UI生成资源'))
      meta.appendChild(createElement(documentRef, 'div', { 'data-novaflow-ui-design-card-name': '1', title: subtitle }, subtitle))
      const removeButton = createElement(documentRef, 'button', {
        type: 'button',
        'data-novaflow-ui-design-remove': result.id,
        'data-novaflow-ui-design-remove-kind': 'result',
        'aria-label': `删除 ${result.name}`,
      }, '×')
      removeButton.addEventListener('click', (event) => {
        stopEvent(event)
        store.removeResult?.(result.id)
      })
      card.appendChild(meta)
      card.appendChild(removeButton)
      return card
    }

    function mergedEntries(state) {
      const resources = Array.isArray(state.resources) ? state.resources : []
      const results = Array.isArray(state.results) ? state.results : []
      const rawEntries = resources.map((item, index) => ({ kind: 'resource', item, order: index }))
        .concat(results.map((item, index) => ({ kind: 'result', item, order: resources.length + index })))
      const groups = new Map()
      const standalone = []
      rawEntries.forEach((entry) => {
        const sharedResourceId = String(entry.item?.sharedResourceId || '').trim()
        if (!sharedResourceId) {
          standalone.push(entry)
          return
        }
        const current = groups.get(sharedResourceId) || { time: 0, order: -1, resource: null, result: null }
        const time = Date.parse(entry.item?.createdAt || '') || 0
        current.time = Math.max(current.time, time)
        current.order = Math.max(current.order, entry.order)
        const existing = current[entry.kind]
        const existingTime = Date.parse(existing?.item?.createdAt || '') || 0
        if (!existing || time > existingTime || (time === existingTime && entry.order > existing.order)) current[entry.kind] = entry
        groups.set(sharedResourceId, current)
      })
      const entries = standalone.concat(Array.from(groups.values()).map((group) => {
        if (group.result) {
          return {
            kind: 'result',
            item: group.result.item,
            resourceProjection: group.resource?.item || null,
            order: group.order,
            sortTime: group.time,
          }
        }
        return { ...group.resource, sortTime: group.time, order: group.order }
      }))
      return entries.sort((left, right) => {
        const leftTime = Number.isFinite(left.sortTime) ? left.sortTime : (Date.parse(left.item?.createdAt || '') || 0)
        const rightTime = Number.isFinite(right.sortTime) ? right.sortTime : (Date.parse(right.item?.createdAt || '') || 0)
        return rightTime - leftTime || right.order - left.order
      })
    }

    function renderItems(body, state, entries) {
      if (!entries.length) {
        body.appendChild(createElement(documentRef, 'div', { 'data-novaflow-ui-design-empty': '1' }, '资源区域'))
        return
      }
      const list = createElement(documentRef, 'div', { 'data-novaflow-ui-design-card-list': '1' })
      entries.forEach((entry) => {
        list.appendChild(entry.kind === 'resource'
          ? renderResourceCard(entry.item, state)
          : renderResultCard(entry.item, state, entry.resourceProjection))
      })
      body.appendChild(list)
    }

    function render() {
      if (!active) return
      const state = store.getState()
      const entries = mergedEntries(state)
      const panel = createElement(documentRef, 'section', {
        'data-novaflow-ui-design-preview': '1',
        'data-novaflow-ui-design-resource-panel': '1',
      })
      const style = createElement(documentRef, 'style', { 'data-novaflow-ui-design-preview-style': '1' })
      style.textContent = PANEL_CSS
      panel.appendChild(style)

      if (message) {
        panel.appendChild(createElement(documentRef, 'div', {
          'data-novaflow-ui-design-message': '1',
          'data-error': messageIsError ? '1' : '0',
        }, message))
      }
      const body = createElement(documentRef, 'div', {
        'data-novaflow-ui-design-preview-body': '1',
        'data-empty': entries.length ? null : '1',
      })
      renderItems(body, state, entries)
      panel.appendChild(body)
      host.replaceChildren(panel)
    }

    const unsubscribe = store.subscribe(render)
    const handle = Object.freeze({
      render,
      unmount() {
        if (!active) return
        active = false
        unsubscribe?.()
        if (mountedPreviews.get(host) === handle) mountedPreviews.delete(host)
        host.replaceChildren()
      },
    })
    mountedPreviews.set(host, handle)
    render()
    return handle
  }

  return Object.freeze({ mount })
})
