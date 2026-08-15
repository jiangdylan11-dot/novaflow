(() => {
  'use strict'

  const TRACE_FILE = 'particle-editor/ui-render-trace.js'
  const LEGACY_TAG = '[UI_TRACE][LEGACY_RENDERED]'
  const CURRENT_TAG = '[UI_TRACE][CURRENT_RENDERED]'
  const REPLACED_TAG = '[UI_TRACE][UI_REPLACED]'
  const FIRST_TAG = '[UI_TRACE][FIRST_DOM_SIGNATURE]'
  const SNAPSHOT_TAG = '[UI_TRACE][DOM_SNAPSHOT]'
  const seen = new Set()
  const events = Array.isArray(window.__NOVAFLOW_UI_TRACE_EVENTS__)
    ? window.__NOVAFLOW_UI_TRACE_EVENTS__
    : []
  window.__NOVAFLOW_UI_TRACE_EVENTS__ = events

  const traceEnabled = (() => {
    try {
      const query = new URLSearchParams(window.location.search || '').get('novaflow_ui_trace')
      const stored = window.localStorage
        ? window.localStorage.getItem('novaflow_ui_trace') || window.localStorage.getItem('NOVAFLOW_UI_TRACE')
        : ''
      return query === '1' || query === 'true' || stored === '1' || stored === 'true'
    } catch {
      return false
    }
  })()

  if (!traceEnabled) {
    const noop = () => null
    window.__NOVAFLOW_DUMP_UI__ = () => ''
    window.NovaFlowUiTrace = {
      enabled: false,
      legacyRendered: noop,
      currentRendered: noop,
      snapshot: noop,
      scheduleSnapshots: noop,
      markRuntimePatch: noop,
      markCurrent: noop,
    }
    return
  }

  let firstSignatureLogged = false
  let reactMountedLogged = false
  let lastComponent = ''

  const now = () => {
    try {
      return performance.now()
    } catch {
      return Date.now()
    }
  }

  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()

  const emit = (tag, payload) => {
    const record = {
      file: payload.file || TRACE_FILE,
      component: payload.component || 'Unknown',
      time: now(),
      readyState: document.readyState,
      url: location.href,
      bodyClass: document.body ? document.body.className : '',
      ...payload,
    }
    events.push({ tag, ...record })
    if (events.length > 600) events.splice(0, events.length - 600)
    console.warn(tag, JSON.stringify(record))
    return record
  }

  const legacyRendered = (payload) => {
    const key = `${payload.file || TRACE_FILE}:${payload.component}:${payload.reason || payload.phase || ''}`
    if (seen.has(key)) return null
    seen.add(key)
    return emit(LEGACY_TAG, payload)
  }

  const currentRendered = (payload) => {
    const key = `current:${payload.file || TRACE_FILE}:${payload.component}:${payload.reason || payload.phase || ''}`
    if (seen.has(key)) return null
    seen.add(key)
    return emit(CURRENT_TAG, payload)
  }

  const rootHtml = (limit = 3000) => {
    const root = document.querySelector('#root')
    return root && root.innerHTML ? root.innerHTML.slice(0, limit) : ''
  }

  window.__NOVAFLOW_DUMP_UI__ = () => {
    const html = rootHtml(5000)
    console.log('[UI_TRACE][ROOT_HTML]', html)
    return html
  }

  const snapshot = (phase) => emit(SNAPSHOT_TAG, {
    file: TRACE_FILE,
    component: classify(normalize(document.body ? document.body.innerText : '')),
    phase,
    html: rootHtml(3000),
  })

  const scheduleSnapshots = (basePhase) => {
    snapshot(`${basePhase}:0ms`)
    window.setTimeout(() => snapshot(`${basePhase}:50ms`), 50)
    window.setTimeout(() => snapshot(`${basePhase}:200ms`), 200)
  }

  window.NovaFlowUiTrace = {
    enabled: true,
    legacyRendered,
    currentRendered,
    snapshot,
    scheduleSnapshots,
    markRuntimePatch(file, component, detail = {}) {
      return legacyRendered({ file, component, ...detail })
    },
    markCurrent(file, component, detail = {}) {
      return currentRendered({ file, component, ...detail })
    },
  }

  const legacyPatterns = [
    {
      component: 'BundleLegacyPrimaryEntry',
      file: 'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/assets/index-Bqc1waVn.js',
      markers: ['AI-粒子特效', 'AI-动画', 'AI-美术设计'],
    },
    {
      component: 'BundleAiEffectPanelCandidate',
      file: 'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/assets/index-Bqc1waVn.js',
      legacyMarkers: ['AIFX v2.1', 'PathControl', 'RGBA'],
    },
  ]

  const currentPatterns = [
    {
      component: 'CurrentAppShell',
      file: 'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/assets/index-Bqc1waVn.js',
      markers: ['特效', '动画', '美工'],
    },
    {
      component: 'CurrentParticlePanel',
      file: 'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/assets/index-Bqc1waVn.js',
      markers: ['粒子系统列表', '发射模式', '外观与资源'],
    },
    {
      component: 'CurrentAiSequencePanel',
      file: 'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/assets/index-Bqc1waVn.js',
      markers: ['AI序列动画', '模式选择', 'LORA'],
    },
    {
      component: 'CurrentArtPanel',
      file: 'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/assets/index-Bqc1waVn.js',
      markers: ['UI 板块开发中'],
    },
    {
      component: 'CurrentAifxRuntimePanel',
      file: 'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/aifx-repaint-runtime.js',
      selector: '#novaflow-aifx-mvp.is-open',
    },
    {
      component: 'CurrentSpineSplitRuntimePanel',
      file: 'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/spine-split-runtime.js',
      selector: '#novaflow-spine-split-workspace-overlay',
    },
  ]

  const classify = (text) => {
    if (text.includes('AI序列动画') && text.includes('模式选择')) return 'CurrentAiSequencePanel'
    if (text.includes('骨骼动画') && text.includes('拆图编辑')) return 'CurrentSkeletonSplitPanel'
    if (text.includes('UI 板块开发中') || text.includes('绘图板块开发中')) return 'CurrentArtPanel'
    if (text.includes('特效') && text.includes('动画') && text.includes('美工') && text.includes('粒子系统列表')) return 'CurrentParticlePanel'
    if (text.includes('粒子系统列表') && text.includes('发射模式')) return 'BundleParticlePanel'
    if (text.includes('AI特效')) return 'BundleAiEffectPanelCandidate'
    return 'Unknown'
  }

  const scan = (reason) => {
    if (!document.body) return
    const text = normalize(document.body.innerText)
    if (!text) return
    if (!firstSignatureLogged) {
      firstSignatureLogged = true
      emit(FIRST_TAG, {
        file: TRACE_FILE,
        component: classify(text),
        reason,
        textHead: text.slice(0, 260),
      })
    }
    for (const pattern of legacyPatterns) {
      const selectorHit = pattern.selector ? document.querySelector(pattern.selector) : null
      const markerHit = pattern.markers && pattern.markers.every((marker) => text.includes(marker))
      const legacyHit = pattern.legacyMarkers && pattern.legacyMarkers.some((marker) => text.includes(marker))
      if (!selectorHit && !markerHit && !legacyHit) continue
      legacyRendered({
        file: pattern.file,
        component: pattern.component,
        reason,
        selector: pattern.selector || '',
        matchedLegacyText: legacyHit || false,
        textHead: text.slice(0, 260),
      })
    }
    for (const pattern of currentPatterns) {
      const selectorHit = pattern.selector ? document.querySelector(pattern.selector) : null
      const markerHit = pattern.markers && pattern.markers.every((marker) => text.includes(marker))
      if (!selectorHit && !markerHit) continue
      currentRendered({
        file: pattern.file,
        component: pattern.component,
        reason,
        selector: pattern.selector || '',
        textHead: text.slice(0, 260),
      })
    }
    const root = document.querySelector('#root')
    if (!reactMountedLogged && root && root.children && root.children.length > 0) {
      reactMountedLogged = true
      scheduleSnapshots('react-mounted')
    }
    const component = classify(text)
    if (lastComponent && component !== lastComponent) {
      emit(REPLACED_TAG, {
        file: TRACE_FILE,
        component,
        from: lastComponent,
        to: component,
        reason,
        textHead: text.slice(0, 260),
      })
    }
    lastComponent = component
  }

  const start = () => {
    scan('trace-start')
    scheduleSnapshots('domcontentloaded')
    if (typeof MutationObserver !== 'function' || !document.documentElement) return
    const observer = new MutationObserver(() => scan('mutation'))
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }

  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button, [role="button"], [tabindex]')
    if (!(button instanceof HTMLElement)) return
    const label = normalize(button.textContent)
    const switchLabels = ['特效', '动画', '美工', '工具', '粒子特效', 'AI特效', 'AI序列动画', '骨骼动画', 'UI', '绘图']
    if (!switchLabels.some((item) => label.includes(item))) return
    snapshot(`switch-before:${label}`)
    window.setTimeout(() => snapshot(`switch-after:${label}:0ms`), 0)
    window.setTimeout(() => snapshot(`switch-after:${label}:50ms`), 50)
    window.setTimeout(() => snapshot(`switch-after:${label}:200ms`), 200)
  }, { capture: true, passive: true })
})()
