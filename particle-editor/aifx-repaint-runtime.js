'use strict'

// NovaFlow AI Effect UI shell.
// The AIFX generation pipeline (sprite-sheet style transfer, material transfer, temporal conform, export)
// was retired on 2026-09-16 together with its ComfyUI models and nodes. This file keeps only the
// "AI特效" entry takeover and the left-panel skeleton so the surface stays in place until the module is rebuilt.
;(() => {

  const APP_ID = 'novaflow-aifx-mvp'
  const STYLE_ID = 'novaflow-aifx-mvp-style'
  const PIPELINE_ID = 'AIFX_UI_SHELL'
  const RUNTIME_SOURCE = 'particle-editor/aifx-repaint-runtime.js'
  const HOST_LEFT_EDGE = 'rgba(154, 159, 165, 0.05)'
  const HOST_ENTRY_STACK_Z = 2147483605
  const AIFX_SHELL_STACK_Z = 2147483610
  const HOST_LEFT_FRAME_LEFT = 100
  const HOST_LEFT_FRAME_WIDTH = 334
  const HOST_LEFT_CONTENT_INSET = 11
  const HOST_LEFT_PANEL_WIDTH = 302
  const AIFX_SECTION_GAP = 8
  const AIFX_LEFT_PANEL_ACCORDION = window.NovaFlowLeftPanelAccordion || null
  const AIFX_LEFT_PANEL_TOKENS = AIFX_LEFT_PANEL_ACCORDION?.TOKENS || Object.freeze({
    panelGap: '5px',
    radius: '8px',
    headerHeight: '36px',
    headerPadding: '0 12px',
    headerBackground: '#2f2f2f',
    headerFontSize: '13px',
    headerFontWeight: '400',
    headerGap: '8px',
    bodyPadding: '6px 12px 8px',
    bodyGap: '6px',
  })
  const AIFX_ACCENT = '#1ea672'
  const AIFX_SLIDER_ACCENT = '#20c997'
  const AIFX_SURFACE_BASE = '#181818'
  const AIFX_SURFACE_ELEVATED = '#333333'
  const AIFX_SURFACE_MUTED = '#1b1b1b'
  const AIFX_OVERLAY_SURFACE = 'rgba(12, 12, 12, 0.84)'

  const REBUILD_STATUS = '功能重构中'
  const REBUILD_DETAIL = 'AI 特效生成链路已下线，当前仅保留界面骨架。'

  const UI_TRACE_FILE = 'particle-editor-desktop/dist/win-unpacked/resources/app/renderer/aifx-repaint-runtime.js'
  const UI_TRACE_SEEN = new Set()
  const uiTraceTime = () => {
    try { return performance.now() } catch { return Date.now() }
  }
  const uiTraceCurrent = (component, detail = {}) => {
    const key = `current:${component}:${detail.phase || ''}`
    if (UI_TRACE_SEEN.has(key)) return
    UI_TRACE_SEEN.add(key)
    const payload = { file: UI_TRACE_FILE, component, time: uiTraceTime(), ...detail }
    if (window.NovaFlowUiTrace?.markCurrent) return window.NovaFlowUiTrace.markCurrent(UI_TRACE_FILE, component, detail)
    console.warn('[UI_TRACE][CURRENT_RENDERED]', payload)
  }

  const state = {
    mounted: false,
    refs: {},
    shellInset: {
      top: 58,
      shellLeft: HOST_LEFT_FRAME_LEFT,
      shellWidth: HOST_LEFT_FRAME_WIDTH,
      shellRight: HOST_LEFT_FRAME_LEFT + HOST_LEFT_FRAME_WIDTH,
      sideOffset: 142,
    },
    previewMode: 'result',
    status: REBUILD_STATUS,
    detail: REBUILD_DETAIL,
    isGenerating: false,
    hostScrollSnapshots: [],
    hostScrollFreezeEpoch: 0,
    hostScrollFreezeRafId: 0,
    hostScrollFreezeTimerId: 0,
    sectionOpen: { mode: false, template: false, generate: false },
  }

  window.__NOVA_AIFX_RUNTIME_SCOPE = {
    pipeline: PIPELINE_ID,
    source: RUNTIME_SOURCE,
    usesComfy: false,
    retired: true,
    ownsOnly: 'AI特效',
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
  const lerp = (a, b, t) => a + (b - a) * t
  const normalize = (value) => String(value || '').replace(/\s+/g, '').trim()
  const isAiEffectLabel = (value) => normalize(value) === 'AI特效'
  const isParticleEffectLabel = (value) => normalize(value) === '粒子特效'
  const isTopMenuLabel = (value) => {
    const text = normalize(value)
    return text === '文件' || text === '帮助'
  }
  const pad = (value, length = 4) => String(value).padStart(length, '0')

  const getActionElement = (target) => {
    if (!(target instanceof Element)) return null
    return target.closest('button,[role="button"],[tabindex]')
  }

  const findButtonsByText = (predicate) =>
    Array.from(document.querySelectorAll('button,[role="button"],[tabindex]')).filter((element) =>
      predicate(String(element.textContent || '')),
    )

  const restoreHostScroll = () => {
    for (const snapshot of state.hostScrollSnapshots) {
      if (!(snapshot.element instanceof HTMLElement)) continue
      snapshot.element.scrollTop = snapshot.scrollTop
      snapshot.element.scrollLeft = snapshot.scrollLeft
      snapshot.element.style.cssText = snapshot.cssText
    }
    state.hostScrollSnapshots = []
  }

  const cancelScheduledHostScrollFreeze = () => {
    state.hostScrollFreezeEpoch += 1
    if (state.hostScrollFreezeRafId) window.cancelAnimationFrame(state.hostScrollFreezeRafId)
    if (state.hostScrollFreezeTimerId) window.clearTimeout(state.hostScrollFreezeTimerId)
    state.hostScrollFreezeRafId = 0
    state.hostScrollFreezeTimerId = 0
  }

  const isHostScrollFreezeActive = (root, epoch) =>
    epoch === state.hostScrollFreezeEpoch &&
    root instanceof HTMLElement &&
    root === state.refs.root &&
    root.isConnected &&
    root.classList.contains('is-open') &&
    document.body instanceof HTMLElement &&
    document.body.classList.contains('novaflow-aifx-open')

  const scheduleHostScrollFreeze = (root) => {
    const epoch = state.hostScrollFreezeEpoch
    state.hostScrollFreezeRafId = window.requestAnimationFrame(() => {
      if (epoch !== state.hostScrollFreezeEpoch) return
      state.hostScrollFreezeRafId = 0
      if (!isHostScrollFreezeActive(root, epoch)) return
      freezeHostLeftScroll()
    })
    state.hostScrollFreezeTimerId = window.setTimeout(() => {
      if (epoch !== state.hostScrollFreezeEpoch) return
      state.hostScrollFreezeTimerId = 0
      if (!isHostScrollFreezeActive(root, epoch)) return
      freezeHostLeftScroll()
    }, 120)
  }

  const freezeHostLeftScroll = () => {
    restoreHostScroll()
    const nodes = [document.documentElement, document.body, ...Array.from(document.querySelectorAll('body *'))].filter((element) => {
      if (!(element instanceof HTMLElement)) return false
      if (element.id === APP_ID || element.closest(`#${APP_ID}`)) return false
      return element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2
    })
    nodes.forEach((element) => {
      state.hostScrollSnapshots.push({
        element,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
        cssText: element.style.cssText || '',
      })
      element.scrollTop = 0
      element.scrollLeft = 0
      element.style.setProperty('overflow', 'hidden', 'important')
      element.style.setProperty('overflow-x', 'hidden', 'important')
      element.style.setProperty('overflow-y', 'hidden', 'important')
      element.style.setProperty('overscroll-behavior', 'contain', 'important')
    })
  }

  const PRIMARY_SIDEBAR_LABELS = ['特效', '动画', '美工', '工具']

  const isPrimarySidebarAction = (action) => {
    if (!(action instanceof HTMLElement) || !PRIMARY_SIDEBAR_LABELS.includes(normalize(action.textContent))) return false
    const rect = action.getBoundingClientRect()
    return rect.left < 110 && rect.top > 40 && rect.width > 0
  }

  const activePrimaryLabel = () => {
    const pressed = Array.from(document.querySelectorAll('button[aria-pressed="true"]')).find((node) =>
      PRIMARY_SIDEBAR_LABELS.includes(normalize(node.textContent)) && node.getBoundingClientRect().left < 110,
    )
    return pressed ? normalize(pressed.textContent) : ''
  }

  const LEAVING_CLASS = 'novaflow-aifx-leaving'
  let primaryLeaveWatch = null

  const stopPrimaryLeaveWatch = () => {
    if (!primaryLeaveWatch) return
    primaryLeaveWatch.observer.disconnect()
    window.clearTimeout(primaryLeaveWatch.timer)
    primaryLeaveWatch = null
  }

  // A primary sidebar click does not switch sections inside its own dispatch: React commits the new
  // section asynchronously (about 230ms later, behind the brand runtime's entry-preview transaction).
  // Hiding the shell at the click therefore exposed the particle panel underneath for that long, but
  // keeping the semantic open state (body.novaflow-aifx-open) makes the runtime reject that commit.
  // So the click swaps the open class for the leaving class - the runtime no longer sees an AI特效
  // context while the shell stays painted over the left column - and the shell hides inside the
  // mutation batch in which the pressed primary entry leaves 特效 (before paint).
  const beginPrimaryLeave = () => {
    cancelScheduledHostScrollFreeze()
    restoreHostScroll()
    document.body.classList.remove('novaflow-aifx-open')
    document.body.classList.add(LEAVING_CLASS)
    if (primaryLeaveWatch) return
    const check = () => {
      if (!state.refs.root?.classList.contains('is-open')) { stopPrimaryLeaveWatch(); return }
      const label = activePrimaryLabel()
      if (!label || label === '特效') return
      stopPrimaryLeaveWatch()
      hideApp({ reason: 'primary-switch:' + label })
    }
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'class'] })
    const timer = window.setTimeout(() => {
      // The switch never happened (rolled back): back to the fully open shell.
      stopPrimaryLeaveWatch()
      if (!state.refs.root?.classList.contains('is-open')) return
      document.body.classList.remove(LEAVING_CLASS)
      document.body.classList.add('novaflow-aifx-open')
      freezeHostLeftScroll()
    }, 3000)
    primaryLeaveWatch = { observer, timer }
  }

  const setHostTabState = (activeLabel, aiAction) => {
    const aiEntry = aiAction instanceof HTMLElement ? aiAction : findButtonsByText(isAiEffectLabel)[0]
    const particleEntry = findButtonsByText(isParticleEffectLabel)[0]
    const aiActive = activeLabel === 'ai'
    if (particleEntry instanceof HTMLElement) {
      particleEntry.setAttribute('data-novaflow-secondary-entry', '1')
      particleEntry.setAttribute('data-novaflow-secondary-active', aiActive ? '0' : '1')
      particleEntry.setAttribute('aria-pressed', aiActive ? 'false' : 'true')
      if (!aiActive) particleEntry.setAttribute('aria-current', 'page')
      else particleEntry.removeAttribute('aria-current')
    }
    if (aiEntry instanceof HTMLElement) {
      if (aiActive) aiEntry.setAttribute('aria-current', 'page')
      else aiEntry.removeAttribute('aria-current')
      aiEntry.setAttribute('data-novaflow-secondary-entry', '1')
      aiEntry.setAttribute('data-novaflow-secondary-active', aiActive ? '1' : '0')
      aiEntry.setAttribute('aria-pressed', aiActive ? 'true' : 'false')
    }
    window.NovaFlowSecondaryEntries?.setActive?.(['粒子特效', 'AI特效'], aiActive ? 'AI特效' : '粒子特效')
  }

  const applyHostTabVisuals = (aiAction) => {
    const aiEntry = aiAction instanceof HTMLElement ? aiAction : findButtonsByText(isAiEffectLabel)[0]
    setHostTabState('ai', aiAction)
  }

  const installStyle = () => {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      #${APP_ID} {
        position: fixed;
        top: var(--aifx-shell-top, 58px);
        left: var(--aifx-shell-left, ${HOST_LEFT_FRAME_LEFT}px);
        right: 0;
        bottom: 0;
        z-index: ${AIFX_SHELL_STACK_Z};
        display: none;
        grid-template-columns: var(--aifx-shell-width, ${HOST_LEFT_FRAME_WIDTH}px) minmax(420px, 1fr);
        grid-template-rows: 1fr;
        background: transparent;
        color: #e5edf8;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        pointer-events: none;
      }
      body.novaflow-aifx-open {
        overflow: hidden !important;
        overscroll-behavior: contain !important;
      }
      body.novaflow-aifx-open [data-novaflow-secondary-group="1"] {
        position: relative !important;
        z-index: ${HOST_ENTRY_STACK_Z} !important;
      }
      body.novaflow-aifx-leaving {
        overflow: hidden !important;
        overscroll-behavior: contain !important;
      }
      body.novaflow-aifx-leaving #${APP_ID}.is-open::before {
        top: 0 !important;
      }
      body.novaflow-aifx-leaving #${APP_ID}.is-open .aifx-side {
        margin-top: 0 !important;
        height: 100% !important;
      }
      body.novaflow-aifx-open [data-novaflow-left-content-root="1"] * {
        visibility: hidden !important;
        pointer-events: none !important;
      }
      body.novaflow-aifx-open [data-novaflow-left-content-root="1"] [data-novaflow-secondary-group="1"],
      body.novaflow-aifx-open [data-novaflow-left-content-root="1"] [data-novaflow-secondary-group="1"] * {
        visibility: visible !important;
        pointer-events: auto !important;
      }
      #${APP_ID}.is-open { display: grid; }
      #${APP_ID}.is-open::before {
        content: "";
        position: absolute;
        left: 0;
        top: var(--aifx-shield-offset, var(--aifx-side-offset, 132px));
        bottom: 0;
        width: var(--aifx-shell-width, ${HOST_LEFT_FRAME_WIDTH}px);
        box-sizing: border-box;
        background: ${AIFX_SURFACE_BASE};
        border-right: 0;
        pointer-events: auto;
        z-index: 0;
      }
      #${APP_ID} * { box-sizing: border-box; }
      .aifx-side {
        min-height: 0;
        overflow: auto;
        background: ${AIFX_SURFACE_BASE};
        pointer-events: auto;
      }
      .aifx-side, .aifx-main {
        position: relative;
        z-index: 1;
      }
      .aifx-side {
        grid-column: 1;
        margin-top: var(--aifx-side-offset, 142px);
        height: calc(100% - var(--aifx-side-offset, 142px));
        background: ${AIFX_SURFACE_BASE};
        border-right: none;
        overflow-x: hidden;
        overflow-y: auto;
        pointer-events: auto;
      }
      .aifx-main {
        grid-column: 2;
        min-width: 0;
        min-height: 0;
        position: relative;
        isolation: isolate;
        overflow: hidden;
        background: #000000;
        border-top: 1px solid rgba(148, 163, 184, 0.14);
        pointer-events: auto;
      }
      .aifx-main::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        background:
          radial-gradient(120% 62% at 50% 70%, rgba(44, 44, 44, 0.18) 0%, rgba(28, 28, 28, 0.09) 36%, rgba(0, 0, 0, 0) 70%),
          radial-gradient(88% 56% at 50% 42%, rgba(40, 40, 40, 0.12) 0%, rgba(26, 26, 26, 0.08) 34%, rgba(0, 0, 0, 0) 68%),
          linear-gradient(180deg, rgba(10, 10, 10, 1) 0%, rgba(12, 12, 12, 0.995) 20%, rgba(14, 14, 14, 1) 48%, rgba(12, 12, 12, 1) 78%, rgba(9, 9, 9, 1) 100%);
      }
      .aifx-main::after {
        content: "";
        position: absolute;
        left: -10%;
        top: -44%;
        right: -10%;
        bottom: -12%;
        z-index: 1;
        pointer-events: none;
        transform-origin: center bottom;
        transform: perspective(640px) rotateX(34deg);
        opacity: 1;
        background-image:
          linear-gradient(rgba(130, 146, 164, 0.26) 1px, transparent 1px),
          linear-gradient(90deg, rgba(130, 146, 164, 0.26) 1px, transparent 1px),
          linear-gradient(90deg, transparent calc(50% - 1px), rgba(170, 184, 198, 0.34) 50%, transparent calc(50% + 1px));
        background-size: 72px 72px, 72px 72px, 100% 100%;
        background-position: center bottom;
        -webkit-mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.92) 0%, rgba(0, 0, 0, 0.72) 70%, transparent 100%);
        mask-image: linear-gradient(to top, rgba(0, 0, 0, 0.92) 0%, rgba(0, 0, 0, 0.72) 70%, transparent 100%);
      }
      .aifx-header {
        display: none;
        height: 0;
        align-items: center;
        gap: 12px;
        padding: 0 20px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.14);
      }
      .aifx-title { font-size: 15px; font-weight: 900; letter-spacing: 0; }
      .aifx-subtitle { font-size: 12px; color: rgba(226, 232, 240, 0.6); }
      .aifx-close {
        margin-left: auto;
        height: 32px;
        padding: 0 12px;
        border: 0;
        border-radius: 8px;
        background: ${AIFX_SURFACE_ELEVATED};
        color: #e5edf8;
        cursor: pointer;
        font-weight: 800;
      }
      .aifx-panel { padding: 18px 16px; display: grid; gap: 14px; max-height: none; overflow: visible; pointer-events: auto; }
      .aifx-side .aifx-panel {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        justify-content: flex-start;
        gap: ${AIFX_LEFT_PANEL_TOKENS.panelGap};
        min-height: 100%;
        width: var(--aifx-panel-width, ${HOST_LEFT_PANEL_WIDTH}px);
        min-width: var(--aifx-panel-width, ${HOST_LEFT_PANEL_WIDTH}px);
        max-width: var(--aifx-panel-width, ${HOST_LEFT_PANEL_WIDTH}px);
        margin-left: var(--aifx-content-inset, ${HOST_LEFT_CONTENT_INSET}px);
        padding: ${AIFX_LEFT_PANEL_TOKENS.panelGap} 0 28px;
        overflow-x: hidden;
      }
      .aifx-section {
        width: 100%;
        max-width: 100%;
        min-width: 0;
        margin-bottom: ${AIFX_SECTION_GAP}px;
        border: 0 !important;
        border-radius: 0 !important;
        padding: 0;
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        box-shadow: none !important;
        backdrop-filter: none;
        overflow: visible;
      }
      .aifx-side .aifx-section[data-aifx-section] {
        margin: 0;
        border-radius: ${AIFX_LEFT_PANEL_TOKENS.radius} !important;
        overflow: hidden;
      }
      body.novaflow-aifx-open #${APP_ID} .aifx-side .aifx-section.nf-panel[data-novaflow-editor-panel="1"] {
        border: 0 !important;
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        box-shadow: none !important;
      }
      .aifx-section:last-child {
        margin-bottom: 0;
      }
      .aifx-section[data-open="0"] {
        border-color: #0000;
      }
      .aifx-section-header {
        width: 100%;
        box-sizing: border-box;
        height: ${AIFX_LEFT_PANEL_TOKENS.headerHeight};
        min-height: ${AIFX_LEFT_PANEL_TOKENS.headerHeight};
        max-height: ${AIFX_LEFT_PANEL_TOKENS.headerHeight};
        padding: ${AIFX_LEFT_PANEL_TOKENS.headerPadding};
        border: 0 !important;
        border-bottom: none;
        border-radius: ${AIFX_LEFT_PANEL_TOKENS.radius};
        background: ${AIFX_LEFT_PANEL_TOKENS.headerBackground} !important;
        background-color: ${AIFX_LEFT_PANEL_TOKENS.headerBackground} !important;
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: ${AIFX_LEFT_PANEL_TOKENS.headerGap};
        cursor: pointer;
        user-select: none;
        text-align: left;
        font-family: inherit;
        font-size: ${AIFX_LEFT_PANEL_TOKENS.headerFontSize};
        font-weight: ${AIFX_LEFT_PANEL_TOKENS.headerFontWeight};
        appearance: none;
      }
      .aifx-section[data-open="1"] .aifx-section-header {
        border-bottom: none;
        border-radius: ${AIFX_LEFT_PANEL_TOKENS.radius} ${AIFX_LEFT_PANEL_TOKENS.radius} 0 0;
      }
      .aifx-section-header:hover {
        background: #3b3b3b !important;
        background-color: #3b3b3b !important;
      }
      .aifx-section-title {
        font-size: 13px;
        font-weight: 700;
        margin: 0;
        color: #e5e7ebd9;
      }
      .aifx-side .aifx-section[data-aifx-section] .aifx-section-title {
        font-size: ${AIFX_LEFT_PANEL_TOKENS.headerFontSize};
        font-weight: ${AIFX_LEFT_PANEL_TOKENS.headerFontWeight};
        color: #fff;
      }
      .aifx-section-title-wrap {
        display: flex;
        align-items: center;
        min-width: 0;
      }
      .aifx-section-title-icon {
        width: 18px;
        margin-right: 8px;
        text-align: center;
        font-size: 14px;
        color: #e5e7ebd9;
      }
      .aifx-section-chevron {
        font-size: 12px;
        opacity: 0.7;
        color: #e5e7ebd9;
      }
      .aifx-section-body {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: ${AIFX_LEFT_PANEL_TOKENS.bodyGap};
        width: 100%;
        min-width: 0;
        max-width: 100%;
        margin: 0;
        padding: ${AIFX_LEFT_PANEL_TOKENS.bodyPadding};
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        border-radius: 0;
        box-sizing: border-box;
      }
      .aifx-section-body > * {
        width: 100%;
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
      }
      .aifx-section[data-open="0"] .aifx-section-body {
        display: none !important;
      }
      .aifx-template-current,
      .aifx-help {
        font-size: 11px;
        line-height: 1.45;
        color: rgba(203, 213, 225, 0.82);
      }
      .aifx-template-current {
        margin-bottom: 8px;
      }
      .aifx-help {
        margin-top: 10px;
      }
      .nf-upload-dropzone {
        position: relative;
        min-height: 120px;
        padding: 16px;
        border: 1px dashed #3A3A3A;
        border-radius: 12px;
        background: #1B1B1B;
        background-image: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        text-align: center;
        color: #E8E8E8;
        cursor: pointer;
        overflow: hidden;
        box-sizing: border-box;
        box-shadow: none;
        transition: background-color 120ms ease-out, border-color 120ms ease-out;
      }
      .nf-upload-dropzone:hover {
        border-color: #21C487;
        background: #242424;
      }
      .nf-upload-dropzone__icon {
        font-size: 24px;
        line-height: 1;
        font-weight: 800;
        color: #E8E8E8;
      }
      .nf-upload-dropzone[aria-disabled="true"] {
        pointer-events: none;
        opacity: 0.48;
        cursor: not-allowed;
      }
      .nf-upload-dropzone__title {
        font-size: 13px;
        line-height: 1.25;
        font-weight: 900;
        color: #E8E8E8;
      }
      .nf-upload-dropzone__hint {
        max-width: calc(100% - 32px);
        font-size: 11px;
        font-weight: 700;
        line-height: 1.35;
        color: #A0A0A0;
      }
      .nf-upload-dropzone:has(img) .nf-upload-dropzone__hint,
      .nf-upload-dropzone:has(img) .nf-upload-dropzone__title {
        display: none;
      }
      .nf-upload-dropzone img {
        max-width: 100%;
        max-height: 130px;
        object-fit: contain;
        display: block;
      }
      .nf-upload-dropzone__meta {
        position: absolute;
        left: 8px;
        right: 8px;
        bottom: 8px;
        padding: 5px 8px;
        border-radius: 6px;
        background: #202020;
        font-size: 11px;
        color: #A0A0A0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .nf-upload-dropzone__meta:empty { display: none; }
      .aifx-row { display: flex; align-items: center; gap: 8px; }
      .aifx-row:has([data-action="contour"]) { display: none; }
      .aifx-row > label { min-width: 74px; font-size: 12px; color: rgba(226, 232, 240, 0.72); }
      .aifx-prompt-field { display: grid; gap: 6px; margin: 6px 0 12px; }
      .aifx-prompt-field > label { font-size: 12px; color: rgba(226, 232, 240, 0.72); }
      #${APP_ID} .aifx-side textarea.aifx-prompt-input {
        width: 100%;
        min-height: 64px;
        max-height: 140px;
        padding: 9px 10px;
        border: 1px solid #3a3a3a;
        border-radius: 8px;
        background: #1b1b1b;
        color: #e8e8e8;
        font: inherit;
        font-size: 12px;
        line-height: 1.5;
        resize: vertical;
        outline: none;
        box-sizing: border-box;
      }
      #${APP_ID} .aifx-side textarea.aifx-prompt-input:focus { border-color: #21c487; }
      .aifx-prompt-hint { font-size: 10px; line-height: 1.4; color: rgba(203, 213, 225, 0.58); }
      .aifx-slider,
      .aifx-timeline input {
        flex: 1;
        min-width: 0;
        height: 4px;
        border: 0 !important;
        border-radius: 999px;
        outline: 0;
        box-shadow: none !important;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
        background: linear-gradient(90deg, #20c997 0%, #20c997 var(--aifx-range-pct, 0%), #303030 var(--aifx-range-pct, 0%), #303030 100%);
      }
      .aifx-slider::-webkit-slider-runnable-track,
      .aifx-timeline input::-webkit-slider-runnable-track {
        height: 4px;
        border: 0 !important;
        border-radius: 999px;
        background: transparent;
        box-shadow: none !important;
      }
      .aifx-slider::-webkit-slider-thumb,
      .aifx-timeline input::-webkit-slider-thumb {
        width: 12px;
        height: 12px;
        margin-top: -4px;
        border: 0 !important;
        border-radius: 999px;
        background: #dce3ea;
        box-shadow: none !important;
        -webkit-appearance: none;
        appearance: none;
      }
      .aifx-slider::-moz-range-track,
      .aifx-timeline input::-moz-range-track {
        height: 4px;
        border: 0 !important;
        border-radius: 999px;
        background: #303030;
        box-shadow: none !important;
      }
      .aifx-slider::-moz-range-progress,
      .aifx-timeline input::-moz-range-progress {
        height: 4px;
        border: 0 !important;
        border-radius: 999px;
        background: #20c997;
      }
      .aifx-slider::-moz-range-thumb,
      .aifx-timeline input::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border: 0 !important;
        border-radius: 999px;
        background: #dce3ea;
        box-shadow: none !important;
      }
      .aifx-value {
        width: 30px;
        min-height: 20px;
        border: 0;
        border-radius: 0;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        font-size: 12px;
        color: rgba(238, 244, 252, 0.96);
        background: transparent;
      }
      .aifx-primary, .aifx-button {
        height: 36px;
        border: 0;
        border-radius: 8px;
        background: ${AIFX_ACCENT};
        color: white;
        cursor: pointer;
        font-weight: 900;
      }
      .aifx-button {
        background: ${AIFX_SURFACE_ELEVATED};
        border-color: transparent;
      }
      .aifx-timeline .aifx-icon-button {
        width: 36px;
        height: 36px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
      }
      .aifx-button:disabled, .aifx-primary:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }
      .aifx-preview-wrap {
        position: absolute;
        left: 0;
        top: 0;
        right: 0;
        bottom: 0;
        min-width: 0;
        min-height: 0;
        margin: 0;
        border: 0;
        border-radius: 0;
        overflow: hidden;
        background: transparent;
      }
      .aifx-preview-grid {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        display: none;
        pointer-events: none;
        background: transparent;
      }
      .aifx-preview-canvas {
        position: relative;
        z-index: 3;
        width: 100%;
        height: 100%;
        display: block;
        background: transparent;
      }
      .aifx-mode {
        position: absolute;
        top: 18px;
        right: 18px;
        z-index: 4;
        display: flex;
        gap: 6px;
        padding: 0;
        border-radius: 8px;
        background: transparent;
        border: 0;
      }
      .aifx-mode button {
        height: 34px;
        min-height: 34px;
        max-height: 34px;
        min-width: 58px;
        padding: 0 16px;
        border: 0;
        border-radius: 8px;
        background: #2a2a2a;
        color: #fff;
        cursor: pointer;
        font-weight: 800;
        font-size: 13px;
        letter-spacing: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        box-shadow: none;
      }
      .aifx-mode button.is-active { background: ${AIFX_ACCENT}; border: 0; color: white; }
      .aifx-preview-status {
        position: absolute;
        top: 18px;
        left: 18px;
        z-index: 4;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        min-height: 34px;
        max-width: min(520px, calc(100% - 280px));
        padding: 7px 12px;
        border: 1px solid rgba(148, 163, 184, 0.12);
        border-radius: 8px;
        background: rgba(18, 18, 18, 0.62);
        color: rgba(226, 232, 240, 0.64);
        opacity: 0.78;
        pointer-events: none;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      }
      .aifx-preview-status-title {
        flex: 0 0 auto;
        font-size: 12px;
        font-weight: 800;
        line-height: 1.35;
        white-space: nowrap;
      }
      .aifx-preview-status-detail {
        min-width: 0;
        overflow: hidden;
        color: rgba(226, 232, 240, 0.56);
        font-size: 11px;
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .aifx-preview-status-detail:empty { display: none; }
      .aifx-preview-status[data-tone="working"] {
        border-color: rgba(30, 178, 132, 0.42);
        background: rgba(14, 54, 43, 0.9);
        color: rgba(228, 255, 247, 0.96);
        opacity: 1;
      }
      .aifx-preview-status[data-tone="success"] {
        border-color: rgba(30, 178, 132, 0.26);
        background: rgba(18, 46, 38, 0.82);
        color: rgba(224, 250, 242, 0.9);
        opacity: 0.94;
      }
      .aifx-preview-status[data-tone="warning"] {
        border-color: rgba(245, 190, 73, 0.42);
        background: rgba(61, 46, 17, 0.9);
        color: rgba(255, 241, 202, 0.96);
        opacity: 1;
      }
      .aifx-preview-status[data-tone="error"] {
        border-color: rgba(239, 68, 68, 0.5);
        background: rgba(69, 22, 22, 0.92);
        color: rgba(255, 226, 226, 0.98);
        opacity: 1;
      }
      .aifx-timeline {
        position: absolute;
        left: 18px;
        right: 18px;
        bottom: 18px;
        z-index: 5;
        margin: 0;
        border: 0;
        border-radius: 8px;
        padding: 14px 16px;
        background: #181818;
        display: grid;
        grid-template-columns: auto auto auto minmax(120px, 1fr) auto;
        gap: 10px;
        align-items: center;
      }
      .aifx-timeline input { width: 100%; }
      @media (max-width: 1280px) {
        #${APP_ID} {
          grid-template-columns: var(--aifx-shell-width, ${HOST_LEFT_FRAME_WIDTH}px) minmax(360px, 1fr);
        }
      }
      @media (max-width: 900px) {
        .aifx-preview-status {
          top: 62px;
          right: 18px;
          max-width: none;
        }
      }
      .aifx-hidden { display: none !important; }
    `
    document.head.appendChild(style)
  }

  const mount = () => {
    uiTraceCurrent('AifxRuntimeOverlayMount', { phase: 'mount' })
    installStyle()
    let root = document.getElementById(APP_ID)
    if (!root) {
      root = document.createElement('div')
      root.id = APP_ID
      root.innerHTML = `
        <aside class="aifx-side">
          <div class="aifx-panel">
            <div class="aifx-section nf-panel" data-novaflow-editor-panel="1" data-aifx-section="mode" data-open="0">
              <button class="aifx-section-header nf-panel-header" type="button" data-section-toggle="mode" aria-expanded="false">
                <span class="aifx-section-title-wrap"><i class="fas fa-magic aifx-section-title-icon" aria-hidden="true"></i><span class="aifx-section-title">模式</span></span>
                <i class="fas fa-chevron-right aifx-section-chevron" data-section-chevron aria-hidden="true"></i>
              </button>
              <div class="aifx-section-body nf-panel-body" data-section-body="mode" hidden>
                <div data-aifx-provider-host style="display:grid; gap:8px"></div>
              </div>
            </div>
            <div class="aifx-section nf-panel" data-novaflow-editor-panel="1" data-aifx-section="template" data-open="0">
              <button class="aifx-section-header nf-panel-header" type="button" data-section-toggle="template" aria-expanded="false">
                <span class="aifx-section-title-wrap"><i class="fas fa-layer-group aifx-section-title-icon" aria-hidden="true"></i><span class="aifx-section-title">自定义模板</span></span>
                <i class="fas fa-chevron-right aifx-section-chevron" data-section-chevron aria-hidden="true"></i>
              </button>
              <div class="aifx-section-body nf-panel-body" data-section-body="template" hidden>
                <div class="nf-upload-dropzone nf-upload-dropzone--medium" data-nf-upload-dropzone="1" data-action="pick-template">
                  <span class="nf-upload-dropzone__icon" data-template-empty>+</span>
                  <div class="nf-upload-dropzone__title">上传素材</div>
                  <div class="nf-upload-dropzone__hint">点击选择，或直接把素材拖到这里</div>
                  <div class="nf-upload-dropzone__meta" data-template-meta></div>
                </div>
                <div class="aifx-help">模板导入将在 AI 特效重构后重新开放。</div>
                <div class="aifx-row" style="margin-top:10px">
                  <button class="aifx-button" data-action="load-builtin" type="button" style="flex:1">载入内置模板</button>
                  <button class="aifx-button" data-action="clear-template" type="button">清空</button>
                </div>
              </div>
            </div>
            <div class="aifx-section nf-panel" data-novaflow-editor-panel="1" data-aifx-section="generate" data-open="0">
              <button class="aifx-section-header nf-panel-header" type="button" data-section-toggle="generate" aria-expanded="false">
                <span class="aifx-section-title-wrap"><i class="fas fa-magic aifx-section-title-icon" aria-hidden="true"></i><span class="aifx-section-title">生成控制</span></span>
                <i class="fas fa-chevron-right aifx-section-chevron" data-section-chevron aria-hidden="true"></i>
              </button>
              <div class="aifx-section-body nf-panel-body" data-section-body="generate" hidden>
                <div class="nf-upload-dropzone nf-upload-dropzone--medium" data-nf-upload-dropzone="1" data-action="pick-style">
                  <span class="nf-upload-dropzone__icon" data-style-empty>+</span>
                  <div class="nf-upload-dropzone__title">参考图</div>
                  <div class="nf-upload-dropzone__hint">点击选择，或直接把素材拖到这里</div>
                  <div class="nf-upload-dropzone__meta" data-style-meta></div>
                </div>
                <div class="aifx-prompt-field">
                  <label for="novaflow-aifx-prompt-supplement">提示词补充</label>
                  <textarea id="novaflow-aifx-prompt-supplement" class="aifx-prompt-input" data-action="prompt-supplement" rows="3" maxlength="400" placeholder="补充材质、颜色、光效、纹理或粒子细节（可选）"></textarea>
                  <div class="aifx-prompt-hint">只补充视觉细节，不改变模板结构与生命周期。</div>
                </div>
                <div class="aifx-row">
                  <label>材质强度</label>
                  <input class="aifx-slider" data-action="material" type="range" min="0" max="100" value="86">
                  <div class="aifx-value" data-material-value>86</div>
                </div>
                <div class="aifx-row" style="margin-top:12px">
                  <label>纹理细节</label>
                  <input class="aifx-slider" data-action="contour" type="range" min="0" max="100" value="32">
                  <div class="aifx-value" data-contour-value>32</div>
                </div>
                <div class="aifx-help" data-effect-type>生成控制将在 AI 特效重构后重新开放。</div>
                <button class="aifx-primary" data-action="generate" type="button" style="width:100%; margin-top:14px">生成特效</button>
              </div>
            </div>
          </div>
        </aside>
        <main class="aifx-main">
          <header class="aifx-header">
            <div>
              <div class="aifx-title">AI 特效</div>
              <div class="aifx-subtitle">生成功能重构中，当前仅保留界面骨架。</div>
            </div>
            <button class="aifx-close" data-action="close" type="button">返回粒子特效</button>
          </header>
          <section class="aifx-preview-wrap">
            <canvas class="aifx-preview-grid" data-preview-grid></canvas>
            <canvas class="aifx-preview-canvas" data-preview></canvas>
            <div class="aifx-preview-status" data-preview-status data-tone="idle" role="status" aria-live="polite" aria-atomic="true">
              <span class="aifx-preview-status-title" data-preview-status-title>功能重构中</span>
              <span class="aifx-preview-status-detail" data-preview-status-detail>AI 特效生成链路已下线，当前仅保留界面骨架。</span>
            </div>
            <div class="aifx-mode">
              <button data-mode="template" type="button">模板</button>
              <button data-mode="result" type="button" class="is-active">结果</button>
              <button data-mode="compare" type="button">对比</button>
            </div>
          </section>
          <section class="aifx-timeline">
            <button class="aifx-button aifx-icon-button" data-action="prev" type="button" title="上一帧" aria-label="上一帧"><i class="fas fa-step-backward" aria-hidden="true"></i></button>
            <button class="aifx-button aifx-icon-button" data-action="play" type="button" title="播放" aria-label="播放"><i class="fas fa-play" aria-hidden="true"></i></button>
            <button class="aifx-button aifx-icon-button" data-action="next" type="button" title="下一帧" aria-label="下一帧"><i class="fas fa-step-forward" aria-hidden="true"></i></button>
            <input data-action="timeline" type="range" min="0" max="0" value="0">
            <div data-frame-label>0 / 0</div>
          </section>
        </main>
        <input class="aifx-hidden" data-template-input type="file" accept="image/*" multiple>
        <input class="aifx-hidden" data-style-input type="file" accept="image/*">
      `
      document.body.appendChild(root)
      wireUi(root)
    }
    state.mounted = true
    state.refs.root = root
    return root
  }

  const updateShellInset = (trigger) => {
    let top = 58
    let shellLeft = HOST_LEFT_FRAME_LEFT
    let shellWidth = HOST_LEFT_FRAME_WIDTH
    let contentInset = HOST_LEFT_CONTENT_INSET
    let sideOffset = 142
    let hasSecondaryEntryMetrics = false

    const leftColumn =
      document.querySelector('[data-novaflow-left-column="1"]') ||
      document.querySelector('.novaflow-app .nf-app-body > div:first-child')
    const hostShell =
      document.querySelector('[data-novaflow-left-content-shell="1"]') ||
      document.querySelector('[data-novaflow-left-content-root="1"]')
    const columnRect = leftColumn instanceof HTMLElement ? leftColumn.getBoundingClientRect() : null
    const shellRect = hostShell instanceof HTMLElement ? hostShell.getBoundingClientRect() : null
    if (columnRect && Number.isFinite(columnRect.left) && Number.isFinite(columnRect.right) && columnRect.width > 240) {
      const columnPaddingLeft = leftColumn instanceof HTMLElement ? Number.parseFloat(getComputedStyle(leftColumn).paddingLeft || '0') : 0
      const railWidth = Number.isFinite(columnPaddingLeft) && columnPaddingLeft > HOST_LEFT_CONTENT_INSET
        ? Math.max(0, Math.round(columnPaddingLeft - HOST_LEFT_CONTENT_INSET))
        : HOST_LEFT_FRAME_LEFT
      shellLeft = Math.max(0, Math.round(columnRect.left + railWidth))
      shellWidth = Math.max(240, Math.round(columnRect.right - shellLeft))
    } else if (shellRect && Number.isFinite(shellRect.left) && Number.isFinite(shellRect.width) && shellRect.width > 240) {
      shellLeft = Math.max(0, Math.round(shellRect.left - HOST_LEFT_CONTENT_INSET))
      shellWidth = Math.max(240, Math.round(shellRect.width + HOST_LEFT_CONTENT_INSET * 2))
    }
    if (shellRect && Number.isFinite(shellRect.left)) {
      contentInset = Math.max(0, Math.round(shellRect.left - shellLeft))
    }

    const topCandidate = Array.from(document.body.children)
      .map((element) => (element instanceof HTMLElement ? element.getBoundingClientRect() : null))
      .find((rect) => rect && rect.top <= 2 && rect.height >= 40 && rect.height <= 90)
    if (topCandidate) {
      top = Math.max(50, Math.min(90, Math.round(topCandidate.height)))
    }

    const secondaryEntries = [findButtonsByText(isParticleEffectLabel)[0], findButtonsByText(isAiEffectLabel)[0]]
      .filter((element) => element instanceof HTMLElement)
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => Number.isFinite(rect.left) && Number.isFinite(rect.right) && rect.width > 20)
    if (secondaryEntries.length) {
      hasSecondaryEntryMetrics = true
      const bottom = Math.max(...secondaryEntries.map((rect) => rect.bottom))
      if (Number.isFinite(bottom)) sideOffset = Math.max(0, Math.round(bottom - top))
    }

    const source =
      trigger instanceof Element && trigger !== document.body && trigger !== document.documentElement
        ? trigger
        : findButtonsByText(isAiEffectLabel)[0]
    if (!hasSecondaryEntryMetrics && source instanceof Element) {
      const rect = source.getBoundingClientRect()
      if (Number.isFinite(rect.bottom)) sideOffset = Math.max(88, Math.round(rect.bottom - top))
    }
    if (!hasSecondaryEntryMetrics && source instanceof Element) {
      const rect = source.getBoundingClientRect()
      if (Number.isFinite(rect.bottom)) sideOffset = Math.max(88, Math.round(rect.bottom - top))
    }

    const shellRight = shellLeft + shellWidth
    state.shellInset = { top, shellLeft, shellWidth, shellRight, sideOffset }
    const panelWidth = Math.max(240, Math.min(HOST_LEFT_PANEL_WIDTH, shellWidth))
    const root = state.refs.root
    if (root instanceof HTMLElement) {
      root.style.setProperty('--aifx-shell-top', `${top}px`)
      root.style.setProperty('--aifx-shell-left', `${shellLeft}px`)
      root.style.setProperty('--aifx-shell-width', `${shellWidth}px`)
      root.style.setProperty('--aifx-panel-width', `${panelWidth}px`)
      root.style.setProperty('--aifx-content-inset', `${contentInset}px`)
      root.style.setProperty('--aifx-side-offset', `${sideOffset}px`)
      root.style.setProperty('--aifx-shield-offset', `${sideOffset}px`)
    }
  }

  const syncSectionOpen = (root = state.refs.root) => {
    if (!(root instanceof HTMLElement)) return
    for (const section of Array.from(root.querySelectorAll('[data-aifx-section]'))) {
      if (!(section instanceof HTMLElement)) continue
      const key = section.getAttribute('data-aifx-section') || ''
      const open = state.sectionOpen?.[key] === true
      const toggle = section.querySelector('[data-section-toggle]')
      const chevron = section.querySelector('[data-section-chevron]')
      const body = section.querySelector('[data-section-body]')
      if (body instanceof HTMLElement) body.hidden = !open
      if (AIFX_LEFT_PANEL_ACCORDION?.syncExpanded) {
        AIFX_LEFT_PANEL_ACCORDION.syncExpanded(section, toggle, body, chevron, open)
        if (chevron instanceof HTMLElement) chevron.classList.add('aifx-section-chevron')
        continue
      }
      section.setAttribute('data-open', open ? '1' : '0')
      if (toggle instanceof HTMLElement) toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
      if (chevron instanceof HTMLElement) {
        chevron.classList.toggle('fa-chevron-down', open)
        chevron.classList.toggle('fa-chevron-right', !open)
      }
      if (body instanceof HTMLElement) {
        if (open) body.style.removeProperty('display')
        else body.style.setProperty('display', 'none', 'important')
      }
    }
  }

  const setStatus = (status, detail) => {
    state.status = status
    state.detail = detail || ''
    refreshUi()
  }

  const notifyRebuild = () => {
    setStatus(REBUILD_STATUS, REBUILD_DETAIL)
  }

  const wireUi = (root) => {
    const refs = state.refs
    refs.main = root.querySelector('.aifx-main')
    refs.previewWrap = root.querySelector('.aifx-preview-wrap')
    refs.previewGrid = root.querySelector('[data-preview-grid]')
    refs.preview = root.querySelector('[data-preview]')
    refs.previewStatus = root.querySelector('[data-preview-status]')
    refs.previewStatusTitle = root.querySelector('[data-preview-status-title]')
    refs.previewStatusDetail = root.querySelector('[data-preview-status-detail]')
    refs.providerHost = root.querySelector('[data-aifx-provider-host]')
    refs.effectType = root.querySelector('[data-effect-type]')
    refs.frameLabel = root.querySelector('[data-frame-label]')
    refs.timeline = root.querySelector('[data-action="timeline"]')
    refs.generate = root.querySelector('[data-action="generate"]')
    const material = root.querySelector('[data-action="material"]')
    if (material) {
      const label = material.closest('.aifx-row')?.querySelector('label')
      if (label) label.textContent = '风格强度'
    }
    if (refs.providerHost) {
      refs.providerHost.innerHTML = '<div class="aifx-help">模式选择将在 AI 特效重构后重新开放。</div>'
    }
    syncSectionOpen(root)

    for (const toggle of Array.from(root.querySelectorAll('[data-section-toggle]'))) {
      toggle.addEventListener('click', () => {
        const key = toggle.getAttribute('data-section-toggle') || ''
        if (!key) return
        state.sectionOpen[key] = state.sectionOpen[key] === false
        syncSectionOpen(root)
      })
    }

    root.querySelector('[data-action="close"]').addEventListener('click', closeApp)
    for (const button of Array.from(root.querySelectorAll('[data-mode]'))) {
      button.addEventListener('click', () => {
        state.previewMode = button.getAttribute('data-mode') || 'result'
        refreshUi()
        drawPreview()
      })
    }

    // Retired controls stay visible but only report the rebuild notice.
    for (const action of ['pick-template', 'pick-style', 'load-builtin', 'clear-template', 'generate', 'prev', 'next', 'play']) {
      const element = root.querySelector('[data-action="' + action + '"]')
      if (!(element instanceof HTMLElement)) continue
      element.addEventListener('click', (event) => {
        event.preventDefault()
        notifyRebuild()
      })
    }
    for (const dropzone of Array.from(root.querySelectorAll('[data-nf-upload-dropzone]'))) {
      dropzone.setAttribute('aria-disabled', 'true')
      dropzone.addEventListener('dragover', (event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'none'
      })
      dropzone.addEventListener('drop', (event) => {
        event.preventDefault()
        notifyRebuild()
      })
    }
    for (const control of Array.from(root.querySelectorAll('input[type="range"], textarea, input[type="file"]'))) {
      control.disabled = true
    }

    window.addEventListener('resize', drawPreview)
  }

  const syncRangeProgress = (input) => {
    if (!(input instanceof HTMLInputElement)) return
    const min = Number(input.min || 0)
    const max = Number(input.max || 100)
    const value = Number(input.value || 0)
    const span = Math.max(1, max - min)
    const pct = clamp(((value - min) / span) * 100, 0, 100)
    input.style.setProperty('--aifx-range-pct', `${pct}%`)
  }

  const syncAllRangeProgress = (root = state.refs.root) => {
    if (!(root instanceof HTMLElement)) return
    for (const input of Array.from(root.querySelectorAll('input[type="range"]'))) {
      syncRangeProgress(input)
    }
  }

  const refreshUi = () => {
    const refs = state.refs
    if (!refs.root) return
    const statusText = String(state.status || REBUILD_STATUS).trim() || REBUILD_STATUS
    const detailText = String(state.detail || '').trim()
    if (refs.previewStatusTitle) refs.previewStatusTitle.textContent = statusText
    if (refs.previewStatusDetail) refs.previewStatusDetail.textContent = detailText
    if (refs.previewStatus) {
      refs.previewStatus.setAttribute('data-tone', 'warning')
      refs.previewStatus.setAttribute('title', [statusText, detailText].filter(Boolean).join(' · '))
    }
    if (refs.timeline) {
      refs.timeline.max = '0'
      refs.timeline.value = '0'
      refs.timeline.disabled = true
    }
    if (refs.frameLabel) refs.frameLabel.textContent = '0 / 0'
    if (refs.generate) {
      refs.generate.disabled = true
      refs.generate.textContent = REBUILD_STATUS
    }
    syncAllRangeProgress()
    for (const button of Array.from(refs.root.querySelectorAll('[data-mode]'))) {
      button.classList.toggle('is-active', button.getAttribute('data-mode') === state.previewMode)
    }
  }

  const isAifxAppOpen = () => !!state.refs.root?.classList.contains('is-open')

  const drawParticlePreviewBackground = (ctx, width, height) => {
    const centerX = width / 2
    const gridTop = height * 0.35
    const gridBottom = height * 1.18
    const baseGradient = ctx.createLinearGradient(0, 0, 0, height)
    baseGradient.addColorStop(0, '#080808')
    baseGradient.addColorStop(0.48, '#0b0b0b')
    baseGradient.addColorStop(1, '#050505')
    ctx.fillStyle = baseGradient
    ctx.fillRect(0, 0, width, height)

    const glow = ctx.createRadialGradient(centerX, height * 0.58, 0, centerX, height * 0.58, Math.max(width, height) * 0.76)
    glow.addColorStop(0, 'rgba(70,70,70,0.10)')
    glow.addColorStop(0.52, 'rgba(24,24,24,0.06)')
    glow.addColorStop(1, 'rgba(0,0,0,0.56)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, width, height)

    ctx.save()
    ctx.lineWidth = 1
    const lineGradient = ctx.createLinearGradient(0, gridTop, 0, gridBottom)
    lineGradient.addColorStop(0, 'rgba(96,96,96,0)')
    lineGradient.addColorStop(0.34, 'rgba(96,96,96,0.12)')
    lineGradient.addColorStop(1, 'rgba(96,96,96,0.30)')
    ctx.strokeStyle = lineGradient
    for (let index = -30; index <= 30; index += 1) {
      const topX = centerX + index * 46
      const bottomX = centerX + index * 185
      ctx.globalAlpha = 0.68
      ctx.beginPath()
      ctx.moveTo(topX, gridTop)
      ctx.lineTo(bottomX, gridBottom)
      ctx.stroke()
    }

    ctx.strokeStyle = 'rgba(96,96,96,0.30)'
    for (let index = 0; index < 36; index += 1) {
      const progress = index / 35
      const y = gridTop + (gridBottom - gridTop) * Math.pow(progress, 1.9)
      ctx.globalAlpha = 0.018 + 0.245 * Math.pow(progress, 1.55)
      ctx.beginPath()
      ctx.moveTo(-width * 0.28, y + 0.5)
      ctx.lineTo(width * 1.28, y + 0.5)
      ctx.stroke()
    }
    ctx.restore()
  }

  const drawPreview = () => {
    const canvas = state.refs.preview
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const ratio = Math.max(1, window.devicePixelRatio || 1)
    const width = Math.max(1, Math.floor(rect.width * ratio))
    const height = Math.max(1, Math.floor(rect.height * ratio))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    drawParticlePreviewBackground(ctx, width, height)
    ctx.fillStyle = 'rgba(226, 232, 240, 0.55)'
    ctx.font = (14 * ratio) + 'px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('AI 特效功能重构中', width / 2, height / 2)
  }

  const openApp = async (trigger) => {
    uiTraceCurrent('CurrentAifxRuntimePanel', { phase: 'openApp' })
    cancelScheduledHostScrollFreeze()
    const root = mount()
    if (!root.classList.contains('is-open')) {
      for (const key of Object.keys(state.sectionOpen)) state.sectionOpen[key] = false
      syncSectionOpen(root)
    }
    updateShellInset(trigger)
    freezeHostLeftScroll()
    applyHostTabVisuals(trigger)
    document.body.classList.remove(LEAVING_CLASS)
    document.body.classList.add('novaflow-aifx-open')
    root.classList.add('is-open')
    scheduleHostScrollFreeze(root)
    refreshUi()
    drawPreview()
  }

  const hideApp = (options = {}) => {
    stopPrimaryLeaveWatch()
    window.__NovaFlowAifxLastHide = { reason: String(options.reason || 'unspecified'), at: Math.round(performance.now()) }
    window.__NovaFlowAifxExportIntentUntil = 0
    cancelScheduledHostScrollFreeze()
    state.previewMode = 'result'
    state.refs.root?.classList.remove('is-open')
    document.body.classList.remove('novaflow-aifx-open')
    document.body.classList.remove(LEAVING_CLASS)
    restoreHostScroll()
    if (options.activateParticle) setHostTabState('particle')
    refreshUi()
  }

  const closeApp = () => {
    hideApp({ activateParticle: true })
    const particleEntry = findButtonsByText(isParticleEffectLabel)[0]
    if (particleEntry instanceof HTMLElement) {
      particleEntry.click()
    }
  }

  const isProtectedExportInteraction = (target) => {
    const element = target instanceof Element ? target : null
    if (!element) return false
    if (element.closest([
      '[data-novaflow-primary-export-entry="1"]',
      '[data-novaflow-export-modal-root="1"][data-novaflow-export-context-kind="aifx"]',
      '[data-novaflow-license-modal-root="1"]',
      '[data-novaflow-license-dialog="1"]',
    ].join(', '))) return true
    const exportModalOpen = Boolean(document.querySelector(
      '[data-novaflow-export-modal-root="1"][data-novaflow-export-context-kind="aifx"]',
    ))
    const exportModalDropdownOpen = Boolean(document.querySelector(
      '[data-novaflow-export-modal-dropdown="1"]',
    ))
    if (exportModalOpen && (
      element.closest('[data-novaflow-export-modal-dropdown="1"]') ||
      (exportModalDropdownOpen && element.closest(
        '#novaflow-global-dropdown-overlay, #novaflow-global-dropdown-portal',
      ))
    )) return true
    const action = getActionElement(element)
    const actionText = normalize(action?.textContent)
    const topbarExportSurface = element.closest([
      '.nf-topbar',
      '#novaflow-global-dropdown-overlay',
      '#novaflow-global-dropdown-portal',
      '[data-novaflow-dropdown-panel="1"]',
      '[data-novaflow-topbar-layer="1"]',
      '[data-novaflow-topbar-menu-layer="1"]',
      '[data-novaflow-topbar-dropdown-layer="1"]',
    ].join(', '))
    if (topbarExportSurface && (actionText === '文件' || actionText.startsWith('导出'))) {
      window.__NovaFlowAifxExportIntentUntil = Date.now() + 4000
      return true
    }
    if (action) return false
    if (Number(window.__NovaFlowAifxExportIntentUntil || 0) <= Date.now()) return false
    return Boolean(topbarExportSurface)
  }

  document.addEventListener(
    'click',
    (event) => {
      const root = state.refs.root
      const action = getActionElement(event.target)
      if (root?.classList.contains('is-open') && isProtectedExportInteraction(event.target)) return
      if (action && isTopMenuLabel(action.textContent)) {
        hideApp()
        return
      }
      if (root?.classList.contains('is-open') && !root.contains(event.target)) {
        if (action && isParticleEffectLabel(action.textContent)) {
          hideApp({ activateParticle: true })
          return
        }
        if (isPrimarySidebarAction(action)) {
          // Leaving 特效 through the primary sidebar: hiding here, before React switches, exposed the
          // particle panel for the whole ~230ms transition; hide when the switch commits instead.
          if (normalize(action.textContent) !== '特效') beginPrimaryLeave()
          return
        }
        if (!action || !isAiEffectLabel(action.textContent)) hideApp()
      }
      if (!action || !isAiEffectLabel(action.textContent)) return
      event.preventDefault()
      event.stopPropagation()
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
      openApp(action)
    },
    true,
  )

  document.addEventListener(
    'wheel',
    (event) => {
      const root = state.refs.root
      if (!root?.classList.contains('is-open')) return
      const shellLeft = state.shellInset?.shellLeft ?? HOST_LEFT_FRAME_LEFT
      const shellRight = state.shellInset?.shellRight ?? (HOST_LEFT_FRAME_LEFT + HOST_LEFT_FRAME_WIDTH)
      if (event.clientX < shellLeft || event.clientX > shellRight) return
      const panel = event.target instanceof Element ? event.target.closest(`#${APP_ID} .aifx-panel`) : null
      if (panel) return
      freezeHostLeftScroll()
      event.preventDefault()
      event.stopPropagation()
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
    },
    { capture: true, passive: false },
  )

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const action = getActionElement(event.target)
      if (!action || !isAiEffectLabel(action.textContent)) return
      event.preventDefault()
      event.stopPropagation()
      openApp(action)
    },
    true,
  )

  const start = () => {
    installStyle()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }

  const retiredCall = (name) => async () => {
    notifyRebuild()
    const error = new Error('AI 特效功能重构中：' + name + ' 暂不可用')
    error.code = 'AIFX_RETIRED'
    throw error
  }

  window.NovaFlowAifxMvp = {
    pipeline: PIPELINE_ID,
    source: RUNTIME_SOURCE,
    retired: true,
    open: openApp,
    hide: hideApp,
    close: closeApp,
    isOpen: isAifxAppOpen,
    runProductionPipeline: retiredCall('runProductionPipeline'),
    loadBuiltinTemplate: retiredCall('loadBuiltinTemplate'),
    loadStyleDataUrl: retiredCall('loadStyleDataUrl'),
    dispatchExport: retiredCall('dispatchExport'),
    exportFinalProduct: retiredCall('exportFinalProduct'),
    exportSpineProject: retiredCall('exportSpineProject'),
    applyToProject: retiredCall('applyToProject'),
    pureHelpers: Object.freeze({}),
    getState: () => state,
  }
})()
