(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignImagePreviewDialog = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const VERSION = '20260723-ui-result-preview-1'
  const ROOT_ATTRIBUTE = 'data-novaflow-ui-design-image-preview'
  const MIN_SCALE = 0.02
  const MAX_SCALE = 8
  let active = null

  function text(value) {
    return String(value == null ? '' : value)
  }

  function finite(value, fallback = 0) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value))
  }

  function element(documentRef, tagName, attributes = {}, children = []) {
    const node = documentRef.createElement(tagName)
    Object.entries(attributes).forEach(([name, value]) => {
      if (name === 'text') node.textContent = text(value)
      else if (name === 'className') node.className = text(value)
      else if (name === 'style' && value && typeof value === 'object') Object.assign(node.style, value)
      else if (name === 'draggable') node.draggable = Boolean(value)
      else if (value !== undefined && value !== null) node.setAttribute(name, text(value))
    })
    ;(Array.isArray(children) ? children : [children]).filter(Boolean).forEach((child) => node.appendChild(child))
    return node
  }

  function viewportSize(record) {
    const bounds = record.stage?.getBoundingClientRect?.() || {}
    const view = record.view || {}
    const documentElement = record.documentRef?.documentElement || {}
    const width = finite(bounds.width, 0) || finite(record.stage?.clientWidth, 0)
      || Math.max(1, finite(view.innerWidth, finite(documentElement.clientWidth, 1200)) - 48)
    const height = finite(bounds.height, 0) || finite(record.stage?.clientHeight, 0)
      || Math.max(1, finite(view.innerHeight, finite(documentElement.clientHeight, 800)) - 112)
    return { width: Math.max(1, width), height: Math.max(1, height) }
  }

  function imageSize(record) {
    return {
      width: Math.max(1, finite(record.image?.naturalWidth, finite(record.options.width, 1))),
      height: Math.max(1, finite(record.image?.naturalHeight, finite(record.options.height, 1))),
    }
  }

  function syncTransform(record) {
    if (!record?.image) return
    record.image.style.transform = `translate3d(-50%, -50%, 0) translate3d(${record.x}px, ${record.y}px, 0) scale(${record.scale})`
    record.scaleLabel.textContent = `${Math.round(record.scale * 100)}%`
  }

  function fit(record) {
    if (!record || active !== record) return false
    const viewport = viewportSize(record)
    const image = imageSize(record)
    record.fitScale = clamp(Math.min(viewport.width / image.width, viewport.height / image.height, 1), MIN_SCALE, MAX_SCALE)
    record.scale = record.fitScale
    record.x = 0
    record.y = 0
    syncTransform(record)
    return true
  }

  function zoomAt(record, nextScale, clientX, clientY) {
    const scale = clamp(finite(nextScale, record.scale), MIN_SCALE, MAX_SCALE)
    if (scale === record.scale) return
    const bounds = record.stage?.getBoundingClientRect?.() || {}
    const viewport = viewportSize(record)
    const centerX = finite(bounds.left, 0) + viewport.width / 2
    const centerY = finite(bounds.top, 0) + viewport.height / 2
    const cursorX = finite(clientX, centerX) - centerX
    const cursorY = finite(clientY, centerY) - centerY
    const ratio = scale / record.scale
    record.x = cursorX - ((cursorX - record.x) * ratio)
    record.y = cursorY - ((cursorY - record.y) * ratio)
    record.scale = scale
    syncTransform(record)
  }

  function close(reason = 'close') {
    if (!active) return false
    const record = active
    active = null
    record.documentRef.removeEventListener?.('keydown', record.onKeyDown, true)
    record.view?.removeEventListener?.('resize', record.onResize)
    record.host?.removeEventListener?.('wheel', record.onWheelBlock, true)
    record.host?.remove?.()
    try { record.previousFocus?.focus?.() } catch {}
    try { record.options.onClose?.(reason) } catch {}
    return true
  }

  function closeRecord(record, reason = 'close') {
    if (!record || active !== record) return false
    return close(reason)
  }

  function open(options = {}) {
    close('replace')
    const documentRef = options.documentRef || root?.document
    const src = text(options.src)
    if (!documentRef?.createElement || !src) throw new Error('结果图预览缺少图片或文档环境')

    const view = documentRef.defaultView || root
    const host = element(documentRef, 'div', {
      [ROOT_ATTRIBUTE]: '1',
      'data-novaflow-runtime-ignore': '1',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': `查看大图 ${text(options.name || '生成结果')}`,
      style: {
        position: 'fixed', inset: '0', zIndex: '2147483645', display: 'grid', placeItems: 'center',
        padding: '16px', boxSizing: 'border-box', background: 'rgba(0,0,0,0.78)', color: '#fff',
        pointerEvents: 'auto',
      },
    })
    const panel = element(documentRef, 'div', {
      style: {
        width: '100%', height: '100%', minWidth: '0', minHeight: '0', overflow: 'hidden',
        display: 'grid', gridTemplateRows: '52px minmax(0,1fr)', borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.1)', background: '#1b1b1b',
        boxShadow: '0 28px 100px rgba(0,0,0,0.62)',
      },
    })
    const title = element(documentRef, 'div', {
      text: text(options.name || '生成结果'),
      title: text(options.name || '生成结果'),
      style: {
        minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontSize: '13px', fontWeight: '800',
      },
    })
    const scaleLabel = element(documentRef, 'span', {
      text: '100%',
      'aria-live': 'polite',
      style: { minWidth: '48px', textAlign: 'center', color: 'rgba(255,255,255,0.68)', fontSize: '11px' },
    })
    const fitButton = element(documentRef, 'button', {
      type: 'button',
      text: '适配',
      'aria-label': '恢复适配窗口',
      style: {
        height: '30px', padding: '0 12px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '7px',
        background: 'rgba(255,255,255,0.07)', color: '#fff', fontSize: '11px', fontWeight: '700', cursor: 'pointer',
      },
    })
    const closeButton = element(documentRef, 'button', {
      type: 'button',
      text: '×',
      'aria-label': '关闭大图预览',
      style: {
        width: '32px', height: '32px', border: '0', borderRadius: '7px', background: 'transparent',
        color: 'rgba(255,255,255,0.78)', fontSize: '22px', lineHeight: '1', cursor: 'pointer',
      },
    })
    const header = element(documentRef, 'header', {
      style: {
        display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto auto', alignItems: 'center', gap: '8px',
        padding: '0 10px 0 16px', borderBottom: '1px solid rgba(255,255,255,0.09)',
        background: '#212121',
      },
    }, [title, scaleLabel, fitButton, closeButton])
    const stage = element(documentRef, 'div', {
      'data-novaflow-ui-design-image-preview-stage': '1',
      title: '滚轮缩放，拖动查看，双击恢复适配',
      style: {
        position: 'relative', minWidth: '0', minHeight: '0', overflow: 'hidden',
        background: '#141414',
        cursor: 'grab', touchAction: 'none', userSelect: 'none',
      },
    })
    const image = element(documentRef, 'img', {
      src,
      alt: text(options.name || '生成结果'),
      draggable: false,
      'data-novaflow-ui-design-image-preview-image': '1',
      style: {
        position: 'absolute', left: '50%', top: '50%', maxWidth: 'none', maxHeight: 'none',
        transformOrigin: 'center center', willChange: 'transform', pointerEvents: 'none',
        userSelect: 'none', WebkitUserDrag: 'none',
      },
    })
    stage.appendChild(image)
    panel.append(header, stage)
    host.appendChild(panel)

    const record = {
      options, documentRef, view, host, panel, stage, image, scaleLabel,
      previousFocus: documentRef.activeElement,
      scale: 1, fitScale: 1, x: 0, y: 0, drag: null,
      onKeyDown: null, onResize: null, onWheelBlock: null,
    }
    active = record

    fitButton.addEventListener('click', () => fit(record))
    closeButton.addEventListener('click', () => close('close'))
    host.addEventListener('pointerdown', (event) => {
      if (event.target === host) close('backdrop')
    })
    record.onWheelBlock = (event) => {
      event.preventDefault?.()
    }
    host.addEventListener('wheel', record.onWheelBlock, { capture: true, passive: false })
    stage.addEventListener('wheel', (event) => {
      event.preventDefault?.()
      event.stopPropagation?.()
      const deltaY = finite(event.deltaY, 0)
      if (deltaY === 0) return
      const direction = deltaY < 0 ? 1 : -1
      zoomAt(record, record.scale * (direction > 0 ? 1.12 : (1 / 1.12)), event.clientX, event.clientY)
    }, { passive: false })
    stage.addEventListener('pointerdown', (event) => {
      if (finite(event.button, 0) !== 0) return
      event.preventDefault?.()
      event.stopPropagation?.()
      record.drag = {
        pointerId: event.pointerId,
        clientX: finite(event.clientX, 0),
        clientY: finite(event.clientY, 0),
        x: record.x,
        y: record.y,
      }
      stage.style.cursor = 'grabbing'
      try { stage.setPointerCapture?.(event.pointerId) } catch {}
    })
    stage.addEventListener('pointermove', (event) => {
      if (!record.drag || (record.drag.pointerId != null && event.pointerId !== record.drag.pointerId)) return
      event.preventDefault?.()
      event.stopPropagation?.()
      record.x = record.drag.x + finite(event.clientX, record.drag.clientX) - record.drag.clientX
      record.y = record.drag.y + finite(event.clientY, record.drag.clientY) - record.drag.clientY
      syncTransform(record)
    })
    function endDrag(event) {
      if (!record.drag || (record.drag.pointerId != null && event.pointerId !== record.drag.pointerId)) return
      const pointerId = record.drag.pointerId
      record.drag = null
      stage.style.cursor = 'grab'
      try { stage.releasePointerCapture?.(pointerId) } catch {}
    }
    stage.addEventListener('pointerup', endDrag)
    stage.addEventListener('pointercancel', endDrag)
    stage.addEventListener('dblclick', (event) => {
      event.preventDefault?.()
      event.stopPropagation?.()
      fit(record)
    })
    image.addEventListener('load', () => fit(record))
    record.onKeyDown = (event) => {
      if (event.key === 'Escape' && active === record) {
        event.preventDefault?.()
        event.stopPropagation?.()
        close('escape')
      } else if (event.key === 'Tab' && active === record) {
        const focused = documentRef.activeElement
        if (event.shiftKey && focused === fitButton) {
          event.preventDefault?.()
          closeButton.focus?.()
        } else if (!event.shiftKey && focused === closeButton) {
          event.preventDefault?.()
          fitButton.focus?.()
        } else if (focused !== fitButton && focused !== closeButton) {
          event.preventDefault?.()
          ;(event.shiftKey ? closeButton : fitButton).focus?.()
        }
      }
    }
    record.onResize = () => fit(record)
    documentRef.addEventListener?.('keydown', record.onKeyDown, true)
    view?.addEventListener?.('resize', record.onResize)
    ;(documentRef.body || documentRef.documentElement).appendChild(host)
    if (image.complete && finite(image.naturalWidth, 0) > 0) fit(record)
    else syncTransform(record)
    try { closeButton.focus?.() } catch {}

    return Object.freeze({
      close: () => closeRecord(record, 'api'),
      fit: () => fit(record),
      snapshot: () => ({
        open: active === record,
        scale: record.scale,
        fitScale: record.fitScale,
        x: record.x,
        y: record.y,
        name: text(options.name || '生成结果'),
      }),
    })
  }

  function snapshot() {
    return active
      ? {
          open: true,
          scale: active.scale,
          fitScale: active.fitScale,
          x: active.x,
          y: active.y,
          name: text(active.options.name || '生成结果'),
        }
      : { open: false, scale: 1, fitScale: 1, x: 0, y: 0, name: '' }
  }

  return Object.freeze({ VERSION, open, close, snapshot })
})
