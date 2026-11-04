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
  // The library modal sits above the topbar (2147483620) and the 仓库/导出 rail
  // cells (2147483628) so its mask really does cover everything, and below the
  // host's export dialog (2147483640) so that still opens over it. The shell
  // itself cannot reach this far - it is pinned below the topbar - so the modal
  // is moved to the body once the panel is wired.
  const AIFX_LIBRARY_STACK_Z = 2147483632
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
  const AIFX_ACCENT = '#1EA672'
  const AIFX_SLIDER_ACCENT = '#20c997'
  const AIFX_SURFACE_BASE = '#181818'
  const AIFX_SURFACE_ELEVATED = '#333333'
  const AIFX_SURFACE_MUTED = '#1b1b1b'
  const AIFX_OVERLAY_SURFACE = 'rgba(12, 12, 12, 0.84)'

  const IDLE_STATUS = '等待素材'
  const IDLE_DETAIL = '上传一段黑底特效动画，或点「模板制作」做一个。'
  const PREVIEW_FPS = 16
  const RESTYLE = () => window.NovaFlowAifxRestyleWorkflow || null
  const CLIENT = () => window.NovaFlowAifxRestyleClient || null
  // As many look references as the workflow takes (aifx-restyle.workflow.js MAX_REFERENCE_IMAGES).
  const MAX_REFERENCES = 4

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
    // Nothing to compare before a run, so the canvas shows the material; once
    // a result exists the pair is what the artist wants to see. There is no
    // switch for this any more (2026-09-20: 生成后默认对比，没生成前默认模板).
    previewMode: 'template',
    status: IDLE_STATUS,
    detail: IDLE_DETAIL,
    isGenerating: false,
    // The uploaded clip: its object URL for playback, the runtime-side name the
    // workflow refers to, and the decoded frames the preview scrubs through.
    source: null,
    sourceFrames: [],
    // The look references, in the order they came in (up to MAX_REFERENCES). H3 reads material,
    // colour and surface off them, which is why the slot is wired rather than decorative; several
    // are blended into one material.
    references: [],
    // Nothing is picked until the artist picks it: the card under 风格库 says
    // so, and 生成 waits for a style or a reference image.
    attribute: '',
    libraryKind: '',
    strength: null,
    supplement: '',
    lockedSeed: null,
    shapeArchetype: '',
    shapeAuto: '',
    lifecycle: '',
    lifecycleAuto: '',
    // Templates the artist saved (their clip travels as base64 in userData,
    // the same channel the particle 模板库 uses). 2026-10-15: the 20 built-ins
    // are gone (AI-made, the artist found them ugly); 模板制作 makes new ones,
    // and a template made there keeps its project so 编辑 reopens it.
    userTemplateId: '',
    userTemplates: [],
    templateStoreLoaded: false,
    // What 模板制作 said about the shape it drew (plain words for the AI);
    // wins over the archetype's generic wording until the artist picks a shape.
    customShape: null,
    result: null,
    resultFrames: [],
    // One roll is not representative: the same recipe with a different seed can
    // land anywhere from a clean crescent to a shapeless drip. A run produces a
    // few and the artist picks.
    candidateCount: 2,
    candidates: [],
    selectedCandidate: 0,
    playhead: 0,
    playing: false,
    playTimer: 0,
    abort: null,
    hostScrollSnapshots: [],
    hostScrollFreezeEpoch: 0,
    hostScrollFreezeRafId: 0,
    hostScrollFreezeTimerId: 0,
    sectionOpen: { template: false, mode: false },
  }

  window.__NOVA_AIFX_RUNTIME_SCOPE = {
    pipeline: PIPELINE_ID,
    source: RUNTIME_SOURCE,
    usesComfy: true,
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
      // The version divider extends beyond its button; it is not a scroll container.
      if (element.matches('.nf-brand-version')) return false
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

  // The brand runtime pins the shell's left edge, column split and side widths through
  // body.novaflow-aifx-open; copy the computed values inline before that class goes away so the shell
  // does not move during the leaving state.
  const LEAVE_FROZEN_BOX_PROPS = ['width', 'min-width', 'max-width']
  const freezeShellGeometryForLeave = () => {
    const root = state.refs.root
    if (!(root instanceof HTMLElement)) return
    const rootStyle = getComputedStyle(root)
    root.style.setProperty('left', rootStyle.left, 'important')
    root.style.setProperty('grid-template-columns', rootStyle.gridTemplateColumns, 'important')
    const side = root.querySelector('.aifx-side')
    if (!(side instanceof HTMLElement)) return
    const sideWidth = getComputedStyle(side).width
    LEAVE_FROZEN_BOX_PROPS.forEach((property) => side.style.setProperty(property, sideWidth, 'important'))
    const panel = side.querySelector(':scope > .aifx-panel')
    if (!(panel instanceof HTMLElement)) return
    const panelStyle = getComputedStyle(panel)
    LEAVE_FROZEN_BOX_PROPS.forEach((property) => panel.style.setProperty(property, panelStyle.width, 'important'))
    panel.style.setProperty('margin-left', panelStyle.marginLeft, 'important')
  }
  const unfreezeShellGeometry = () => {
    const root = state.refs.root
    if (!(root instanceof HTMLElement)) return
    root.style.removeProperty('left')
    root.style.removeProperty('grid-template-columns')
    const side = root.querySelector('.aifx-side')
    if (!(side instanceof HTMLElement)) return
    LEAVE_FROZEN_BOX_PROPS.forEach((property) => side.style.removeProperty(property))
    const panel = side.querySelector(':scope > .aifx-panel')
    if (!(panel instanceof HTMLElement)) return
    LEAVE_FROZEN_BOX_PROPS.forEach((property) => panel.style.removeProperty(property))
    panel.style.removeProperty('margin-left')
  }

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
  // context while the shell stays painted exactly as it was (side panel, shield and the secondary
  // entries above it) - and the shell hides inside the mutation batch in which the pressed primary
  // entry leaves 特效 (before paint).
  const beginPrimaryLeave = () => {
    cancelScheduledHostScrollFreeze()
    restoreHostScroll()
    freezeShellGeometryForLeave()
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
      unfreezeShellGeometry()
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
        font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
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
      /* The leaving state must look exactly like the open state until React commits the new section:
         the shield keeps its normal offset so the 粒子特效 / AI特效 entries above the side panel stay
         visible (extending it to the top hid them ~300ms before the rest of the shell went away). */
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
        border-top: 1px solid rgba(160, 160, 160, 0.14);
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
        border-bottom: 1px solid rgba(160, 160, 160, 0.14);
      }
      .aifx-title { font-size: 15px; font-weight: 600; letter-spacing: 0; }
      .aifx-subtitle { font-size: 12px; color: rgba(230, 230, 230, 0.6); }
      .aifx-close {
        margin-left: auto;
        height: 32px;
        padding: 0 12px;
        border: 0;
        border-radius: 8px;
        background: ${AIFX_SURFACE_ELEVATED};
        color: #e5edf8;
        cursor: pointer;
        font-weight: 600;
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
        font-weight: 600;
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
        color: rgba(208, 208, 208, 0.82);
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
        font-weight: 600;
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
        font-weight: 600;
        color: #E8E8E8;
      }
      .nf-upload-dropzone__hint {
        max-width: calc(100% - 32px);
        font-size: 11px;
        font-weight: 600;
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
      /* A filled dropzone shows what is in it. The name used to be pinned to
         the bottom of the box on top of the "点击选择…" hint, which is what made
         the two lines print over each other. */
      #${APP_ID} .nf-upload-dropzone__preview { display: none; width: 100%; }
      #${APP_ID} .nf-upload-dropzone__preview video,
      #${APP_ID} .nf-upload-dropzone__preview img {
        display: block; width: 100%; max-height: 150px; object-fit: contain;
        border-radius: 8px; background: #000; pointer-events: none;
      }
      #${APP_ID} .nf-upload-dropzone[data-filled="1"] { padding: 8px; gap: 6px; }
      #${APP_ID} .nf-upload-dropzone[data-filled="1"] .nf-upload-dropzone__preview { display: block; }
      /* The loaded template's way out: a small × on the preview's corner. */
      #${APP_ID} [data-template-preview] { position: relative; }
      #${APP_ID} [data-template-clear-x] {
        position: absolute; top: 6px; right: 6px; z-index: 2;
        width: 20px !important; height: 20px !important; min-width: 20px !important; min-height: 20px !important;
        max-width: 20px !important; max-height: 20px !important; padding: 0 !important; border: 0; border-radius: 5px !important;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, 0.62); color: #ffffff; cursor: pointer;
      }
      #${APP_ID} [data-template-clear-x]:hover { --nf-x-bg: rgba(0, 0, 0, 0.82); --nf-x-fg: #ff6b6b; }
      #${APP_ID} .nf-upload-dropzone[data-filled="1"] .nf-upload-dropzone__icon,
      #${APP_ID} .nf-upload-dropzone[data-filled="1"] .nf-upload-dropzone__title,
      #${APP_ID} .nf-upload-dropzone[data-filled="1"] .nf-upload-dropzone__hint { display: none; }
      #${APP_ID} .nf-upload-dropzone[data-filled="1"] .nf-upload-dropzone__meta {
        position: static; width: 100%; padding: 0; background: transparent; text-align: left;
      }
      .aifx-prompt-field { display: grid; gap: 6px; margin: 10px 0 2px; }
      .aifx-prompt-field > label { font-size: 12px; color: rgba(230, 230, 230, 0.72); }
      #${APP_ID} .aifx-side textarea.aifx-prompt-input {
        width: 100%;
        min-height: 60px;
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
      #${APP_ID} .aifx-side textarea.aifx-prompt-input:focus { border-color: ${AIFX_ACCENT}; }
      .aifx-prompt-hint { font-size: 11px; line-height: 1.4; color: rgba(208, 208, 208, 0.58); }
      .aifx-row { display: flex; align-items: center; gap: 8px; }
      .aifx-row[hidden] { display: none; }
      .aifx-row > label { min-width: 74px; font-size: 12px; color: rgba(230, 230, 230, 0.72); }
      .aifx-material-engine { display: grid; gap: 6px; margin-top: 4px; }
      .aifx-help:empty { display: none; }
      /* 风格库's pick and the artist's own pictures are one thing - material sources - so they are
         one list of equal cards, the 风格库 pick first, and the upload box follows the last card at
         the same height. With nothing in it the list is just the upload box. */
      /* One column that never grows past the panel: a long file name is cut, not the card. */
      #${APP_ID} .aifx-material-board { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; margin-top: 8px; }
      #${APP_ID} .aifx-material-items { display: contents; }
      #${APP_ID} .aifx-material-tile {
        position: relative; display: flex; align-items: center; gap: 10px; padding: 8px; min-width: 0; box-sizing: border-box;
        border-radius: 10px; background: #161616; border: 1px solid rgba(255,255,255,0.10);
      }
      #${APP_ID} .aifx-material-tile video, #${APP_ID} .aifx-material-tile img { display: block; width: 72px; height: 72px; flex: none; border-radius: 8px; background: #000; object-fit: cover; pointer-events: none; }
      #${APP_ID} .aifx-material-tile-label { flex: 1; min-width: 0; font-size: 12px; font-weight: 600; color: #e8e8e8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #${APP_ID} .aifx-material-tile-index { display: block; font-size: 11px; font-weight: 400; color: #9a9fa5; margin-bottom: 3px; }
      #${APP_ID} .aifx-material-remove {
        width: 24px; height: 24px; border-radius: 999px; flex: none; padding: 0;
        background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25);
        color: #fff; cursor: pointer; font-size: 13px; line-height: 1;
      }
      #${APP_ID} .aifx-material-remove:hover { color: #ff6b6b; }
      .aifx-section-body .nf-upload-dropzone.aifx-reference-zone.aifx-material-add { min-height: 90px; padding: 8px; gap: 4px; box-sizing: border-box; }
      .aifx-reference-zone .nf-upload-dropzone__icon { font-size: 18px; }
      .aifx-material-status { margin-top: 6px; font-size: 11px; line-height: 1.5; color: #9a9fa5; }
      .aifx-material-status:empty { display: none; }
      .aifx-material-engine-label { font-size: 12px; color: rgba(230, 230, 230, 0.72); }
      /* The picker and its look come from xiaotao-art-agent.css; only its place in this panel is set here. */
      .aifx-material-engine #aifx-material-model.aifx-material-model { position: relative; }
      .aifx-material-engine #aifx-material-model.aifx-material-model .nf-xiaotao-brains { display: block; }
      .aifx-material-engine #aifx-material-model.aifx-material-model .nf-xiaotao-brains .nf-xiaotao-model-trigger { display: flex; align-items: center; width: 100%; max-width: none; height: 32px; min-height: 32px; box-sizing: border-box; padding: 0 26px 0 10px; border: 1px solid #343434; border-radius: 6px; background: #262626; color: #e9e9e9; }
      .aifx-material-engine #aifx-material-model.aifx-material-model .nf-xiaotao-brains .nf-xiaotao-model-trigger:hover:not(:disabled) { background: #2c2c2c; border-color: #3a3a3a; }
      .aifx-material-engine #aifx-material-model.aifx-material-model .nf-xiaotao-model-trigger .nf-xiaotao-model-name { color: #e9e9e9; font-size: 12px; font-weight: 400; line-height: 30px; }
      .aifx-material-engine #aifx-material-model.aifx-material-model .nf-xiaotao-model-trigger > .nf-xiaotao-model-note,
      .aifx-material-engine #aifx-material-model.aifx-material-model .nf-xiaotao-model-trigger .nf-xiaotao-model-sizer { display: none; }
      .aifx-material-model-portal { position: fixed; inset: 0; z-index: 2147483640; pointer-events: none; }
      .aifx-material-model-portal > * { pointer-events: auto; }
      .aifx-material-model-portal .nf-xiaotao-model-popup { position: fixed; width: 300px; max-width: calc(100vw - 24px); z-index: 1; }
      .aifx-material-engine-note, .aifx-material-engine-settlement { color: rgba(232,237,242,.62); font-size: 11px; line-height: 17px; }
      .aifx-material-engine-settlement:empty { display: none; }
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
        border-radius: 7px;
        background: ${AIFX_ACCENT};
        color: white;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
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
      .aifx-primary:hover:not(:disabled) { background: #20b490; }
      .aifx-button:disabled, .aifx-primary:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }
      .aifx-select {
        height: 36px;
        padding: 0 10px;
        border: 0;
        border-radius: 8px;
        background: ${AIFX_SURFACE_ELEVATED};
        color: #e8eaed;
        cursor: pointer;
        font-weight: 600;
      }
      .aifx-select:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }
      /* The picked style, shown under 风格库 as a playing card. Greys only:
         the first cut copied the recovered TemplateLibrary.tsx's blue-black
         tones, which read blue next to the rest of the panel. */
      /* The reading is automatic, but it can be wrong - a square panel read as
         a ring is described to the model as a ring, and a ring is what comes
         back - so the line that reports it is also the way to correct it. */
      .aifx-detected:empty { display: none; }
      .aifx-detected button {
        margin-left: 6px; padding: 1px 7px; border-radius: 6px;
        background: #2a2a2a; border: 1px solid rgba(255,255,255,0.12);
        color: #cbd0d6; font: inherit; font-size: 11px; cursor: pointer;
      }
      .aifx-detected button:hover { border-color: ${AIFX_ACCENT}; color: #fff; }
      .aifx-shape-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
      .aifx-shape-pick {
        padding: 10px 8px; border-radius: 10px; background: #161616;
        border: 1px solid rgba(255,255,255,0.12) !important;
        color: #d7d7d7; font: inherit; font-size: 12px; cursor: pointer; text-align: center;
      }
      .aifx-shape-pick:hover { border-color: ${AIFX_ACCENT} !important; color: #fff; }
      .aifx-shape-pick.is-active {
        border-color: ${AIFX_ACCENT} !important;
        box-shadow: 0 0 0 1px ${AIFX_ACCENT} inset !important;
      }
      /* The two libraries: the particle editor's 模板库, over the preview. */
      /* A modal, like 万物迁移: centred behind a mask that covers the window.
         Two traps, both of which this hit: the shell root is
         pointer-events:none and every child opts back in, so without the
         opt-in every click fell straight through the panel (it looked dead
         and the mask blocked nothing); and position: absolute keeps the
         mask inside the shell, which starts below the topbar and right of
         the rail, so those stayed lit and clickable. Fixed positioning is
         viewport-relative here because no ancestor is transformed. */
      .aifx-library {
        position: fixed; inset: 0; z-index: ${AIFX_LIBRARY_STACK_Z};
        display: flex; align-items: center; justify-content: center; padding: 72px 24px 24px;
        background: rgba(0, 0, 0, 0.58);
        pointer-events: auto;
        color: #e5edf8;
        font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
      }
      /* It lives on the body, so the shell's own reset does not reach it. */
      .aifx-library, .aifx-library * { box-sizing: border-box; }
      .aifx-library[hidden] { display: none; }
      .aifx-library-panel {
        position: relative;
        display: flex; flex-direction: column;
        width: 980px; max-width: 100%; max-height: 100%;
        background: #1c1c1c; border: 1px solid rgba(255,255,255,0.10);
        border-radius: 12px; padding: 12px;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
      }
      .aifx-library-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
      .aifx-library-title { height: 30px; display: flex; align-items: center; font-weight: 600; font-size: 14px; color: rgba(255,255,255,0.92); }
      .aifx-library-actions { display: flex; gap: 8px; }
      .aifx-library-btn {
        height: 30px; min-width: 86px; padding: 0 12px; background: #2a2a2a;
        border: 1px solid rgba(255,255,255,0.10); border-radius: 8px; color: #fff;
        cursor: pointer; font-weight: 600; font-size: 12px;
      }
      .aifx-library-btn:hover { background: #333333; }
      .aifx-library-btn.aifx-library-close { width:24px;min-width:24px;height:24px;padding:0;background:transparent;border:0;font-size:18px;font-weight:400;line-height:24px; }
      .aifx-library-btn.aifx-library-close:hover { background:#373737; }
      .aifx-library-btn[hidden] { display: none; }
      .aifx-library-btn.is-primary { background: ${AIFX_ACCENT}; border-color: transparent; }
      .aifx-library-body { flex: 1; min-height: 0; overflow-y: auto; padding-right: 4px; }
      .aifx-library-group { font-size: 11px; color: #9a9fa5; margin: 4px 0 6px 2px; }
      .aifx-library-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
      /* The host flattens every button and [role="button"] with
         border-color:transparent and box-shadow:none, both !important
         (the blackgray normalization), which swallowed both the hover ring and
         the selected state on these cards. Only these few declarations take it
         back. */
      .aifx-library-card {
        position: relative; background: #161616; border: 1px solid rgba(255,255,255,0.12);
        border-radius: 10px; padding: 8px; cursor: pointer; text-align: left; color: #d7d7d7; font: inherit;
        transition: border-color 120ms ease-out, box-shadow 120ms ease-out;
      }
      /* The host flattens every button and [role=button] with a transparent
         border and no shadow, both !important, through a selector that counts
         four classes and an element. !important alone does not beat that - the
         more specific selector still wins - so the hover ring and the selected
         ring carry the extra attributes they need to outrank it. */
      .aifx-library[data-library] .aifx-library-card[data-library-card][role="button"] {
        border: 1px solid rgba(255,255,255,0.12) !important;
      }
      .aifx-library[data-library] .aifx-library-card[data-library-card][role="button"]:hover,
      .aifx-library[data-library] .aifx-library-card[data-library-card][role="button"].is-active {
        border-color: ${AIFX_ACCENT} !important;
        box-shadow: 0 0 0 1px ${AIFX_ACCENT} inset !important;
      }
      .aifx-library-thumb { position: relative; width: 100%; aspect-ratio: 16 / 10; border-radius: 8px; overflow: hidden; background: #000; }
      .aifx-library-thumb video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
      .aifx-library-del {
        position: absolute; right: 6px; top: 6px; width: 20px; height: 20px; border-radius: 999px;
        background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25); color: #fff;
        cursor: pointer; font-size: 12px; line-height: 1; padding: 0;
      }
      .aifx-library[data-library] .aifx-library-thumb button.aifx-library-del[type="button"] {
        border: 1px solid rgba(255,255,255,0.25) !important;
      }
      .aifx-library[data-library] .aifx-library-thumb button.aifx-library-del[type="button"]:hover {
        background: rgba(220,38,38,0.85);
        border-color: rgba(255,255,255,0.65) !important;
      }
      .aifx-library[data-library] .aifx-library-thumb button.aifx-library-edit[type="button"] {
        position: absolute; left: 6px; top: 6px; height: 20px; padding: 0 8px; border-radius: 999px;
        background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25) !important; color: #fff;
        cursor: pointer; font-size: 11px; line-height: 18px;
      }
      .aifx-library[data-library] .aifx-library-thumb button.aifx-library-edit[type="button"]:hover {
        background: ${AIFX_ACCENT}; border-color: ${AIFX_ACCENT} !important;
      }
      .aifx-library-name {
        margin-top: 6px; font-size: 11px; color: #cbd0d6;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        border-radius: 4px; padding: 1px 3px; margin-left: -3px;
      }
      .aifx-library-name[data-rename="1"] { cursor: text; }
      .aifx-library-name[data-rename="1"]:hover { background: rgba(255,255,255,0.10); color: #fff; }
      input.aifx-library-rename {
        width: 100%; box-sizing: border-box; padding: 0 2px; margin: 0;
        background: #0f0f0f; border: 1px solid ${AIFX_ACCENT}; border-radius: 4px;
        color: #fff; font: inherit; font-size: 11px; line-height: 16px; outline: none;
      }
      /* Same frame as every other card - only the border says "add". */
      .aifx-library[data-library] button.aifx-library-card.aifx-library-add[type="button"] {
        border: 1px dashed rgba(255,255,255,0.28) !important; text-align: left;
      }
      .aifx-library[data-library] button.aifx-library-card.aifx-library-add[type="button"]:hover:not(:disabled) {
        border-color: ${AIFX_ACCENT} !important;
        box-shadow: 0 0 0 1px ${AIFX_ACCENT} inset !important;
      }
      .aifx-library-add:disabled { cursor: not-allowed; opacity: 0.5; }
      .aifx-library-add .aifx-library-thumb {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.03); color: #fff; gap: 2px;
      }
      .aifx-library-add-plus { font-size: 46px; line-height: 1; font-weight: 200; }
      .aifx-library-add-hint { font-size: 11px; color: rgba(255,255,255,0.55); }
      .aifx-library-save {
        position: absolute; inset: 0; background: rgba(0,0,0,0.5); border-radius: 12px;
        display: flex; align-items: center; justify-content: center; padding: 12px; z-index: 2;
      }
      .aifx-library-save[hidden] { display: none; }
      .aifx-library-save-box { width: 360px; background: #1c1c1c; border: 1px solid rgba(255,255,255,0.10); border-radius: 10px; overflow: hidden; }
      .aifx-library-save-title { padding: 10px 12px; background: #161616; border-bottom: 1px solid rgba(255,255,255,0.10); color: #e5e7eb; font-weight: 600; font-size: 12px; }
      .aifx-library-save-body { padding: 12px; }
      .aifx-library-save-hint { color: #9a9fa5; font-size: 11px; margin-bottom: 8px; }
      .aifx-library-save-input {
        width: 100%; box-sizing: border-box; padding: 8px 10px; background: #161616;
        border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; color: #fff; font-size: 12px; outline: none;
      }
      .aifx-library-save-input:focus { border-color: ${AIFX_ACCENT}; }
      .aifx-library-save-actions { display: flex; gap: 10px; margin-top: 12px; }
      .aifx-library-save-actions .aifx-library-btn { flex: 1; height: 36px; }
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
      /* Plain text, no plate. Centred while the canvas is empty, which is the
         state it mostly speaks for; once there is something to look at it moves
         to the top so it never sits on the artwork. */
      .aifx-preview-status {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        z-index: 4;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-width: 0;
        max-width: min(520px, calc(100% - 64px));
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: rgba(230, 230, 230, 0.72);
        opacity: 1;
        pointer-events: none;
        box-shadow: none;
        text-align: center;
      }
      .aifx-preview-status[data-placement="top"] {
        top: 18px;
        transform: translate(-50%, 0);
        flex-direction: row;
        align-items: center;
        gap: 8px;
        max-width: min(520px, calc(100% - 280px));
      }
      .aifx-preview-status-title {
        flex: 0 0 auto;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.35;
        white-space: nowrap;
      }
      .aifx-preview-status-detail {
        min-width: 0;
        overflow: hidden;
        color: rgba(230, 230, 230, 0.56);
        font-size: 11px;
        line-height: 1.5;
      }
      .aifx-preview-status[data-placement="top"] .aifx-preview-status-detail {
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .aifx-preview-status-detail:empty { display: none; }
      /* A run's progress sits under its status line, the bar and a square stop as the other docks have. */
      .aifx-preview-status { flex-wrap: wrap; }
      .aifx-preview-progress {
        flex: 0 0 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        pointer-events: auto;
      }
      .aifx-preview-progress[hidden] { display: none; }
      .aifx-preview-progress-track {
        flex: 0 1 360px;
        width: 360px;
        height: 3px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.12);
        overflow: hidden;
      }
      .aifx-preview-progress-fill {
        height: 100%;
        width: 0%;
        background: #1ea672;
        transition: width 0.3s ease;
      }
      #${APP_ID} .aifx-preview-progress-cancel {
        flex: 0 0 auto;
        width: auto;
        min-width: 24px;
        height: 24px;
        min-height: 24px;
        padding: 0 10px;
        font-size: 12px;
        white-space: nowrap;
        border-radius: 5px;
        border: 1px solid rgba(239, 68, 68, 0.55) !important;
        background: rgba(239, 68, 68, 0.18) !important;
        color: #fff !important;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
      }
      #${APP_ID} .aifx-preview-progress-cancel:not(:disabled):hover { background: rgba(239, 68, 68, 0.28) !important; }
      .aifx-preview-status[data-tone="working"] { color: rgba(140, 240, 210, 0.96); }
      .aifx-preview-status[data-tone="success"] { color: rgba(170, 245, 222, 0.92); }
      .aifx-preview-status[data-tone="warning"] { color: rgba(250, 214, 137, 0.96); }
      .aifx-preview-status[data-tone="error"] { color: rgba(255, 160, 160, 0.98); }
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
        grid-template-columns: auto minmax(120px, 1fr) auto;
        gap: 10px;
        align-items: center;
      }
      .aifx-timeline input { width: 100%; }
      .aifx-candidates {
        position: absolute;
        left: 18px;
        bottom: 80px;
        z-index: 5;
        display: flex;
        gap: 8px;
        align-items: center;
        /* Runs accumulate while the template stays, so the row scrolls
           sideways instead of pushing past the preview. */
        max-width: calc(100% - 36px);
        overflow-x: auto;
        overflow-y: hidden;
        padding: 2px 2px 4px;
        scrollbar-width: thin;
        scrollbar-color: #3d4b44 transparent;
      }
      .aifx-candidates[hidden] { display: none; }
      /* Sits above the candidate strip in the preview column. It has to be
         positioned the same way the strip is: .aifx-main is a plain block
         with an absolutely-placed preview on top, so a static child lands
         underneath the canvas and cannot be clicked.
         The app forces border:none on every button, so the ring is a shadow. */
      .aifx-seed-lock[data-action="lock-seed"] {
        position: absolute;
        left: 18px;
        /* Clear of the strip below even when that shows its scrollbar. */
        bottom: 168px;
        z-index: 5;
        padding: 5px 12px;
        border-radius: 6px;
        font: inherit;
        font-size: 12px;
        white-space: nowrap;
        cursor: pointer;
      }
      /* The host flattens every button's border, shadow and colours with
         !important through selectors stronger than a class, so the ring and
         fills carry the app id to outrank them. */
      #${APP_ID} .aifx-seed-lock[data-action="lock-seed"] {
        background: #1f1f1f !important;
        color: #fff !important;
        box-shadow: 0 0 0 1px ${AIFX_ACCENT} inset !important;
      }
      #${APP_ID} .aifx-seed-lock[data-action="lock-seed"]:not(:disabled):hover {
        background: rgba(30,166,114,0.22) !important;
      }
      #${APP_ID} .aifx-seed-lock[data-action="lock-seed"].is-on {
        background: ${AIFX_ACCENT} !important;
        color: #fff !important;
      }
      #${APP_ID} .aifx-seed-lock[data-action="lock-seed"].is-on:not(:disabled):hover {
        background: #22B87F !important;
      }
      #${APP_ID} .aifx-seed-lock[data-action="lock-seed"]:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .aifx-seed-lock[hidden] { display: none; }
      .aifx-candidate {
        flex: 0 0 auto;
        width: 62px;
        height: 62px;
        border-radius: 6px;
        border: 2px solid rgba(255,255,255,0.12);
        background: #0c0c0c;
        padding: 0;
        cursor: pointer;
        overflow: hidden;
        position: relative;
      }
      #${APP_ID} .aifx-candidates[data-candidates] button.aifx-candidate {
        border: 1px solid rgba(255,255,255,0.12) !important;
        box-shadow: none !important;
      }
      #${APP_ID} .aifx-candidates[data-candidates] button.aifx-candidate:hover {
        border-color: rgba(30,166,114,0.5) !important;
      }
      #${APP_ID} .aifx-candidates[data-candidates] button.aifx-candidate.is-active {
        border-color: ${AIFX_ACCENT} !important;
      }
      .aifx-candidate canvas { width: 100%; height: 100%; display: block; }
      .aifx-candidate-index {
        position: absolute;
        left: 3px;
        top: 2px;
        font-size: 11px;
        color: rgba(255,255,255,0.7);
        text-shadow: 0 1px 2px #000;
      }
      @media (max-width: 1280px) {
        #${APP_ID} {
          grid-template-columns: var(--aifx-shell-width, ${HOST_LEFT_FRAME_WIDTH}px) minmax(360px, 1fr);
        }
      }
      @media (max-width: 900px) {
        .aifx-preview-status[data-placement="top"] { top: 62px; max-width: calc(100% - 36px); }
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
            <div class="aifx-section nf-panel" data-novaflow-editor-panel="1" data-aifx-section="template" data-open="0">
              <button class="aifx-section-header nf-panel-header" type="button" data-section-toggle="template" aria-expanded="false">
                <span class="aifx-section-title-wrap"><i class="fas fa-layer-group aifx-section-title-icon" aria-hidden="true"></i><span class="aifx-section-title">特效模板</span></span>
                <i class="fas fa-chevron-right aifx-section-chevron" data-section-chevron aria-hidden="true"></i>
              </button>
              <div class="aifx-section-body nf-panel-body" data-section-body="template" hidden>
                <div class="nf-upload-dropzone nf-upload-dropzone--medium" data-nf-upload-dropzone="1" data-action="pick-template" data-template-zone>
                  <div class="nf-upload-dropzone__preview" data-template-preview></div>
                  <span class="nf-upload-dropzone__icon" data-template-empty>+</span>
                  <div class="nf-upload-dropzone__title">上传素材</div>
                  <div class="nf-upload-dropzone__hint">黑底特效动画 MP4 / WebM / GIF，或一组 PNG 序列帧</div>
                  <div class="nf-upload-dropzone__meta" data-template-meta></div>
                </div>
                <div class="aifx-help aifx-detected" data-template-detected style="color:#6f7479; margin-top:6px"></div>
                <div class="aifx-row" style="margin-top:8px">
                  <button class="aifx-button" data-action="open-template-maker" type="button" style="flex:1" title="选效果、画轮廓、拉几个滑块，做一段黑底特效当素材或存进模板库">模板制作</button>
                </div>
                <div class="aifx-row" style="margin-top:8px">
                  <button class="aifx-button" data-action="open-template-library" type="button" style="flex:1">模板库</button>
                  <button class="aifx-button" data-action="clear-template" type="button" hidden style="display:none">清空</button>
                </div>
              </div>
            </div>
            <div class="aifx-section nf-panel" data-novaflow-editor-panel="1" data-aifx-section="mode" data-open="0">
              <button class="aifx-section-header nf-panel-header" type="button" data-section-toggle="mode" aria-expanded="false">
                <span class="aifx-section-title-wrap"><i class="fas fa-magic aifx-section-title-icon" aria-hidden="true"></i><span class="aifx-section-title">特效生成</span></span>
                <i class="fas fa-chevron-right aifx-section-chevron" data-section-chevron aria-hidden="true"></i>
              </button>
              <div class="aifx-section-body nf-panel-body" data-section-body="mode" hidden>
                <button class="aifx-primary" data-action="generate" type="button" style="width:100%">生成特效</button>
                <div class="aifx-row" style="margin-top:12px">
                  <label>数量</label>
                  <input class="aifx-slider" data-action="candidates" type="range" min="1" max="4" value="2">
                  <div class="aifx-value" data-candidates-value>2</div>
                </div>
                <div class="aifx-help" data-effect-type></div>
                <div class="aifx-material-engine" data-aifx-material-engine>
                  <div class="aifx-material-engine-label">模型选择</div>
                  <div id="aifx-material-model" class="aifx-material-model nf-xiaotao-model-host" data-aifx-material-model><div class="nf-xiaotao-brains" data-aifx-material-model-slot></div></div>
                  <div class="aifx-material-engine-note" data-aifx-material-credit></div>
                  <div class="aifx-material-engine-settlement" data-aifx-material-settlement></div>
                </div>
                <div class="aifx-prompt-field">
                  <label for="novaflow-aifx-prompt-supplement">提示词补充</label>
                  <textarea id="novaflow-aifx-prompt-supplement" class="aifx-prompt-input" data-action="prompt-supplement" rows="3" maxlength="400" placeholder="可选。例：下缘不断滴落融水"></textarea>
                </div>
                <button class="aifx-button" data-action="open-style-library" type="button" style="width:100%; margin-top:12px">风格库</button>
                <div class="aifx-material-board" data-material-board>
                  <div class="aifx-material-items" data-material-items></div>
                  <div class="nf-upload-dropzone nf-upload-dropzone--small aifx-reference-zone aifx-material-add" data-nf-upload-dropzone="1" data-action="pick-style" data-style-zone title="上传参考图" aria-label="上传参考图">
                    <span class="nf-upload-dropzone__icon">+</span>
                    <div class="nf-upload-dropzone__title">参考图</div>
                  </div>
                </div>
                <div class="aifx-material-status" data-material-status></div>
              </div>
            </div>
          </div>
        </aside>
        <main class="aifx-main">
          <header class="aifx-header">
            <div>
              <div class="aifx-title">AI 特效</div>
              <div class="aifx-subtitle" data-aifx-subtitle>把一段黑底特效换成另一种属性，形态跟着材质重建。</div>
            </div>
          </header>
          <section class="aifx-preview-wrap">
            <canvas class="aifx-preview-grid" data-preview-grid></canvas>
            <canvas class="aifx-preview-canvas" data-preview></canvas>
            <div class="aifx-preview-status" data-preview-status data-tone="idle" role="status" aria-live="polite" aria-atomic="true">
              <span class="aifx-preview-status-title" data-preview-status-title>等待素材</span>
              <span class="aifx-preview-status-detail" data-preview-status-detail>上传一段黑底特效动画，或载入内置模板。</span>
              <div class="aifx-preview-progress" data-preview-progress hidden>
                <div class="aifx-preview-progress-track"><div class="aifx-preview-progress-fill" data-preview-progress-fill></div></div>
                <button class="aifx-preview-progress-cancel" data-action="cancel-generate" type="button" title="任务中止" aria-label="任务中止">任务中止</button>
              </div>
            </div>
          </section>
          <section class="aifx-candidates" data-candidates hidden></section>
          <button class="aifx-seed-lock" data-action="lock-seed" type="button" hidden></button>
          <section class="aifx-timeline">
            <button class="aifx-button aifx-icon-button" data-action="play" type="button" title="播放" aria-label="播放"><i class="fas fa-play" aria-hidden="true"></i></button>
            <input data-action="timeline" type="range" min="0" max="0" value="0">
            <div data-frame-label>0 / 0</div>
          </section>
        </main>
        <div class="aifx-library" data-library data-novaflow-runtime-ignore="1" hidden>
          <div class="aifx-library-panel">
            <div class="aifx-library-head">
              <div class="aifx-library-title" data-library-title>模板库</div>
              <div class="aifx-library-actions">
                <button class="aifx-library-btn aifx-library-close" data-action="close-library" type="button" title="关闭" aria-label="关闭">×</button>
              </div>
            </div>
            <div class="aifx-library-body" data-library-body></div>
            <div class="aifx-library-save" data-library-save hidden>
              <div class="aifx-library-save-box">
                <div class="aifx-library-save-title">存储模板</div>
                <div class="aifx-library-save-body">
                  <div class="aifx-library-save-hint">请输入模板名称</div>
                  <input class="aifx-library-save-input" data-library-save-name type="text" maxlength="40">
                  <div class="aifx-library-save-actions">
                <button class="aifx-library-btn" data-action="library-save-cancel" type="button">取消</button>
                <button class="aifx-library-btn is-primary" data-action="library-save-confirm" type="button">保存</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <input class="aifx-hidden" data-template-input type="file" multiple accept="video/mp4,video/webm,image/gif,image/apng,image/png">
        <input class="aifx-hidden" data-style-input type="file" multiple accept="image/*">
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

    const topbarRect = (() => {
      const bar = document.querySelector('.nf-topbar')
      const rect = bar instanceof HTMLElement ? bar.getBoundingClientRect() : null
      if (rect && rect.top <= 2 && rect.height >= 40 && rect.height <= 90) return rect
      return Array.from(document.body.children)
        .map((element) => (element instanceof HTMLElement ? element.getBoundingClientRect() : null))
        .find((candidate) => candidate && candidate.top <= 2 && candidate.height >= 40 && candidate.height <= 90)
        || null
    })()
    if (topbarRect) {
      // Floor, so a fractional bottom makes the shell start a hair early and
      // tuck under the bar instead of leaving a gap under it.
      top = Math.max(50, Math.min(90, Math.floor(topbarRect.bottom)))
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
    state.status = (window.NovaFlowNeutralText || String)(status)
    state.detail = (window.NovaFlowNeutralText || String)(detail || '')
    refreshUi()
  }

  // Decode a clip into canvases once, so scrubbing and the compare view never
  // pay for a seek. Capped because a long source would otherwise pin a few
  // hundred full-size bitmaps in memory for a preview nobody scrubs that far.
  const MAX_PREVIEW_FRAMES = 96

  // A file written by MediaRecorder (which is what the 序列帧 path produces, and
  // what a screen recorder hands over) carries no duration in its header: the
  // element reports Infinity, or a single frame's worth. Seeking far past the
  // end makes the decoder walk to the last cluster and fill the real duration
  // in. Without this a twelve-frame sequence decoded as one frame.
  const SHORT_CLIP_SEC = 0.25
  const resolveClipDuration = (video) => new Promise((resolve) => {
    const initial = Number(video.duration)
    if (Number.isFinite(initial) && initial > SHORT_CLIP_SEC) return resolve(initial)
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeEventListener('timeupdate', onTick)
      video.removeEventListener('seeked', onTick)
      const found = Number(video.duration)
      try { video.currentTime = 0 } catch (_) {}
      resolve(Number.isFinite(found) && found > 0 ? found : initial)
    }
    const onTick = () => {
      const found = Number(video.duration)
      if (Number.isFinite(found) && found > 0 && found !== initial) finish()
    }
    const timer = window.setTimeout(finish, 2000)
    video.addEventListener('timeupdate', onTick)
    video.addEventListener('seeked', onTick)
    try { video.currentTime = 1e101 } catch (_) { finish() }
  })

  const decodeClipFrames = (url) => new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url
    const frames = []
    const fail = () => reject(new Error('AI 特效：素材解码失败'))
    video.onerror = fail
    video.onloadedmetadata = async () => {
      const duration = await resolveClipDuration(video)
      if (!Number.isFinite(duration) || duration <= 0) return fail()
      const count = Math.max(1, Math.min(MAX_PREVIEW_FRAMES, Math.round(duration * PREVIEW_FPS)))
      const canvasWidth = video.videoWidth || 512
      const canvasHeight = video.videoHeight || 512
      let index = 0
      const seekNext = () => {
        if (index >= count) {
          resolve({ frames, width: canvasWidth, height: canvasHeight, duration })
          return
        }
        // Sample at frame centres: seeking to exactly `duration` lands past the
        // last frame on some decoders and yields a blank grab.
        video.currentTime = Math.min(duration - 1e-3, ((index + 0.5) / count) * duration)
      }
      video.onseeked = () => {
        const canvas = document.createElement('canvas')
        canvas.width = canvasWidth
        canvas.height = canvasHeight
        canvas.getContext('2d').drawImage(video, 0, 0, canvasWidth, canvasHeight)
        frames.push(canvas)
        index += 1
        seekNext()
      }
      seekNext()
    }
  })

  const SHAPES = () => window.NovaFlowAifxShapeDetect || null

  // Feed the detector small frames: it reduces everything to a 64x64 grid
  // anyway, and reading 640x640 ImageData for a whole clip is pure cost.
  const detectShape = (frames) => {
    const shapes = SHAPES()
    if (!shapes || !frames.length) return null
    const probe = document.createElement('canvas')
    probe.width = 128
    probe.height = 128
    const context = probe.getContext('2d', { willReadFrequently: true })
    const samples = []
    for (const frame of frames) {
      context.clearRect(0, 0, 128, 128)
      context.drawImage(frame, 0, 0, 128, 128)
      samples.push(context.getImageData(0, 0, 128, 128))
    }
    return shapes.analyse(samples)
  }

  const currentLifecycleClause = () => {
    const shapes = SHAPES()
    const entry = shapes && shapes.LIFECYCLES[state.lifecycle]
    return entry ? entry.clause : ''
  }

  const currentShape = () => {
    if (state.customShape && state.customShape.archetype === state.shapeArchetype) return state.customShape.shape
    const shapes = SHAPES()
    const entry = shapes && shapes.ARCHETYPES[state.shapeArchetype]
    return entry ? entry.shape : ''
  }

  // The wording used when a reference image is supplying the material.
  const currentPlainShape = () => {
    if (state.customShape && state.customShape.archetype === state.shapeArchetype) return state.customShape.plainShape
    const shapes = SHAPES()
    const entry = shapes && shapes.ARCHETYPES[state.shapeArchetype]
    return entry ? (entry.plainShape || entry.shape) : ''
  }

  // The upload boxes show their own content: the clip loops inside the box and
  // the file name sits under it in normal flow.
  const syncDropzonePreview = (zone, host, entry, build) => {
    if (!zone || !host) return
    const filled = entry ? '1' : '0'
    if (zone.getAttribute('data-filled') !== filled) zone.setAttribute('data-filled', filled)
    const key = entry ? String(entry.objectUrl || '') : ''
    if (host.getAttribute('data-preview-src') === key) return
    host.setAttribute('data-preview-src', key)
    for (const media of Array.from(host.querySelectorAll('video'))) {
      media.pause()
      media.removeAttribute('src')
      media.load()
    }
    host.innerHTML = ''
    if (entry) host.appendChild(build(entry))
  }

  const revokeSource = (entry) => {
    if (entry && entry.objectUrl) {
      try { URL.revokeObjectURL(entry.objectUrl) } catch (_) {}
    }
  }

  const setStatusFromState = () => {
    if (state.isGenerating) return
    if (state.result) return setStatus('完成', '已生成 ' + state.resultFrames.length + ' 帧，可直接导出带透明通道的序列。')
    if (state.source) return setStatus('就绪', '选好属性后点生成特效。')
    return setStatus(IDLE_STATUS, IDLE_DETAIL)
  }

  const adoptSource = async (blob, fileName) => {
    const objectUrl = URL.createObjectURL(blob)
    let decoded
    try {
      decoded = await decodeClipFrames(objectUrl)
    } catch (error) {
      URL.revokeObjectURL(objectUrl)
      throw error
    }
    revokeSource(state.source)
    state.source = {
      blob,
      fileName: String(fileName || 'source.mp4'),
      objectUrl,
      width: decoded.width,
      height: decoded.height,
      duration: decoded.duration,
      uploadedName: '',
    }
    state.sourceFrames = decoded.frames
    state.userTemplateId = ''
    state.customShape = null
    const detected = detectShape(decoded.frames)
    state.shapeArchetype = detected ? detected.archetype : 'blob'
    state.shapeAuto = detected ? detected.label : ''
    state.lifecycle = detected ? detected.lifecycle : 'once'
    state.lifecycleAuto = detected ? detected.lifecycleLabel : ''
    state.result = null
    state.resultFrames = []
    state.candidates = []
    state.selectedCandidate = 0
    state.playhead = 0
    syncPreviewMode()
    setStatusFromState()
    refreshUi()
    drawPreview()
  }

  // The colour a reference hands to the init, the way a style hands over its
  // accent. Pixels count by how coloured and how bright they are, so a black
  // plate, grey haze and white highlights do not drag it towards grey; the
  // result is pushed to full brightness because the node multiplies it by
  // the source's own luma. A picture with next to no colour in it has none to
  // give and keeps the grey init. `hues` is the same colour in 36 ten-degree hue bins (summing to 1),
  // which tells a read's colour words from colours the picture does not have (pictureRead).
  const referenceColour = (image) => {
    try {
      const size = 64
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0, size, size)
      const { data } = context.getImageData(0, 0, size, size)
      let red = 0
      let green = 0
      let blue = 0
      let coloured = 0
      let lit = 0
      const hues = new Array(36).fill(0)
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index]
        const g = data[index + 1]
        const b = data[index + 2]
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        const weight = (max - min) * max * data[index + 3]
        red += r * weight
        green += g * weight
        blue += b * weight
        coloured += weight
        lit += max * max * data[index + 3]
        if (!weight) continue
        const sector = max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
        hues[Math.floor(sector * 6) % 36] += weight
      }
      if (!coloured || coloured < lit * 0.1) return { accent: '', hues: null }
      const peak = Math.max(red, green, blue)
      return {
        accent: '#' + [red, green, blue].map(value => Math.round(value / peak * 255).toString(16).padStart(2, '0')).join(''),
        hues: hues.map(value => value / coloured),
      }
    } catch {
      return { accent: '', hues: null }
    }
  }

  // The video model follows words and barely the picture. The reference is read as a
  // material entry first, by the model picked in 材质识别: the same picker and the same
  // model list as 小桃 (xiaotao-art-agent.js builds it). The local model reads for free;
  // an online model reads through 小桃's online operation and is charged by real usage.
  // A failure stays on the chosen model. 提示词补充 translation stays local.
  const REFERENCE_MATERIAL_TIMEOUT_MS = 180000
  const referenceMaterials = new WeakMap()
  const materialMeta = new WeakMap()
  const materialSources = new WeakMap()
  const materialBlobs = new Set()
  // The AI 助手 hands the GPU over only when the image runtime's queue is empty, and refuses while
  // anything is drawing or while it is busy with another request. 2026-10-15: a 2-minute picture job
  // from elsewhere on the same runtime made the leaf read fail at once and the run fell back to the
  // picture path - no leaves at all. The run's own generation queues behind that job anyway, so
  // wait for it (asking again every 3 s, up to 10 minutes) instead of giving up.
  const ASSISTANT_BUSY = new Set(['runtime-generation-busy', 'prompt-assistant-busy'])
  const ASSISTANT_BUSY_RETRY_MS = 3000
  const ASSISTANT_BUSY_WAIT_MS = 600000
  // While it waits, the page's queue notice says so (how many prompts the runtime still has) and
  // can stop it - the run too, when one is waiting on it.
  const ASSISTANT_WAIT_LABEL = { 'aifx-material': '识别参考图材质', 'aifx-supplement': '翻译提示词补充' }
  // The choice lives on this page only and starts on the local model every time.
  const LOCAL_MATERIAL_MODEL = 'qwen3.5-9b-heretic'
  // The server's material read: system text + question length, and its answer budget.
  // tests/e2e/aifx-material-engine.test.mjs keeps these equal to xiaotao-style-framework-v3.mjs.
  const MATERIAL_PROMPT_CHARS = 1292
  const MATERIAL_OUTPUT_TOKENS = 300
  try { localStorage.removeItem('novaflow.aifx.material.engine.v1') } catch { /* storage unavailable */ }
  let materialModelId = LOCAL_MATERIAL_MODEL
  let materialModelEpoch = 0
  const materialModelListeners = new Set()
  // The page runtime checks an online read against this snapshot, as it does for 小桃's own choice.
  const materialSelection = Object.freeze({
    businessModelSnapshot: () => Object.freeze({ provider: materialModelId === LOCAL_MATERIAL_MODEL ? 'local' : 'api', modelId: materialModelId, epoch: materialModelEpoch }),
    subscribeBusinessModel: (listener) => {
      if (typeof listener !== 'function') throw new Error('invalid listener')
      materialModelListeners.add(listener)
      return () => materialModelListeners.delete(listener)
    },
  })
  window.FoartAifxMaterialModel = materialSelection
  const xiaotaoAgent = () => window.NovaFlowXiaotaoArtAgent || null
  const xiaotaoController = () => xiaotaoAgent()?.panel?.controller || null
  // A run from the 小桃 panel reads with the model chosen there; the choice here stays for the next run.
  let panelModel = ''
  const materialModel = () => materialModelId
  const activeMaterialModel = () => panelModel || materialModelId
  const isLocalMaterialModel = (id) => id === LOCAL_MATERIAL_MODEL
  const materialSource = activeMaterialModel
  const onlineFailureText = '在线材质识别失败，请稍后重试'
  const localFailureText = '本地材质识别不可用，请打开本地算力节点后重试'
  const failureText = (modelId) => isLocalMaterialModel(modelId) ? localFailureText : onlineFailureText
  // The live estimate of each online read under way, by request; several pictures read at once.
  const materialQuotes = new Map()
  let materialPricingPending = false
  const refreshMaterialPricing = () => {
    const controller = xiaotaoController()
    if (!controller || materialPricingPending || typeof controller.refreshPricingPolicy !== 'function') return
    materialPricingPending = true
    Promise.resolve(controller.refreshPricingPolicy()).catch(() => null).finally(() => { materialPricingPending = false; refreshUi() })
  }
  const formatCredits = (value) => {
    const number = Number(value)
    return Number.isFinite(number) ? String(Number(number.toFixed(2))) : ''
  }
  // The same prediction 小桃 shows under its input, for this one image read.
  const materialCreditText = () => {
    if (isLocalMaterialModel(materialModelId)) return ''
    const controller = xiaotaoController()
    if (!controller) return '在线价格暂不可用'
    const live = [...materialQuotes.values()].filter((quote) => quote.modelId === materialModelId)
    if (live.length && state.references.some((entry) => entry.materialState === 'reading')) {
      return '本次预估 ' + formatCredits(live.reduce((sum, quote) => sum + Number(quote.credits || 0), 0)) + ' 积分，按实际用量结算'
    }
    if (!controller.pricingPolicyKey()) { refreshMaterialPricing(); return '正在获取在线价格…' }
    if (!controller.styleReadAvailable(materialModelId)) return '该模型暂未开通图片材质识别，请换一个模型'
    // Each picture is its own read, so the estimate is one read per picture.
    const images = state.references.length ? state.references.map((entry) => entry.image) : [null]
    let credits = 0
    for (const image of images) {
      const scale = image ? Math.min(1, 768 / Math.max(1, image.naturalWidth, image.naturalHeight)) : 1
      const quote = controller.operationEstimate({
        modelId: materialModelId,
        promptChars: MATERIAL_PROMPT_CHARS,
        outputTokens: MATERIAL_OUTPUT_TOKENS,
        images: [image ? { width: Math.round(image.naturalWidth * scale), height: Math.round(image.naturalHeight * scale) } : {}],
      })
      if (!quote || quote.credits == null) return '在线价格暂不可用'
      credits += Number(quote.credits)
    }
    return '本次预估 ' + formatCredits(credits) + ' 积分，按实际用量结算'
  }
  const dropMaterial = (blob) => { referenceMaterials.delete(blob); materialSources.delete(blob); materialMeta.delete(blob) }
  const clearMaterialCache = () => {
    for (const blob of materialBlobs) dropMaterial(blob)
    materialBlobs.clear()
  }
  const nestedResult = (result) => result?.result && typeof result.result === 'object' ? result.result : {}
  const onlineFailureMessage = (result) => {
    const text = String(result?.error || nestedResult(result).error || '')
    if (/登录|积分|开通|结算|账单/.test(text)) return text
    return onlineFailureText
  }
  // Local only. An online read must not enter this function.
  const askAssistant = async (payload, timeoutMs) => {
    const api = window.electronAPI
    if (!api || typeof api.promptAssistantDescribeArtStyle !== 'function') return null
    const started = Date.now()
    const key = 'aifx-' + payload.purpose
    let cancelled = false
    try {
      for (;;) {
        let timer = 0
        const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs) })
        const result = await Promise.race([api.promptAssistantDescribeArtStyle(payload), timeout]).finally(() => clearTimeout(timer))
        if (!result || !ASSISTANT_BUSY.has(result.errorCode) || Date.now() - started > ASSISTANT_BUSY_WAIT_MS) return result
        const handoff = result.resourceHandoff || {}
        const ahead = Number(handoff.running) + Number(handoff.pending)
        window.NovaFlowQueueNotice?.wait(key, {
          label: ASSISTANT_WAIT_LABEL[payload.purpose] || '',
          ahead: Number.isFinite(ahead) ? ahead : null,
          onCancel: () => { cancelled = true; cancelGenerate() },
        })
        await new Promise(resolve => setTimeout(resolve, ASSISTANT_BUSY_RETRY_MS))
        if (cancelled) return null
      }
    } finally {
      window.NovaFlowQueueNotice?.done(key)
    }
  }
  // Online only, through 小桃's online operation: quoted before it runs, charged by
  // real usage after. A failure here does not call the local describer.
  const askOnlineMaterial = async (payload, timeoutMs, modelId, isCurrent) => {
    const api = window.electronAPI
    if (!api || typeof api.promptAssistantDescribeArtStyle !== 'function') return { ok: false, error: '在线材质识别不可用，请刷新网页后重试' }
    const fromPanel = Boolean(panelModel)
    const controller = xiaotaoController()
    const owner = fromPanel ? controller : materialSelection
    const selected = owner?.businessModelSnapshot?.()
    if (!selected || selected.provider !== 'api' || selected.modelId !== modelId) return { ok: false, error: '模型选择已变化，请重新识别' }
    const requestId = crypto.randomUUID()
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), timeoutMs)
    // From the 小桃 panel the charge is shown in 小桃's chat; from here it is shown under the picker.
    const ui = fromPanel && typeof controller?.onlineBusinessUi === 'function' ? controller.onlineBusinessUi(modelId) : {
      confirmImageUpload: async () => isCurrent(),
      onPricingQuote: (quote) => {
        if (quote?.requestId !== requestId) return
        materialQuotes.set(requestId, { modelId, credits: quote.estimatedCredits })
        refreshUi()
      },
      confirmPricingQuote: async () => isCurrent(),
      onBillingNotice: (row) => row?.requestId === requestId && row.submitted === true,
    }
    try {
      const result = await api.promptAssistantDescribeArtStyle({
        requestId,
        name: payload.name || 'reference.jpg',
        purpose: 'aifx-material',
        dataUrl: payload.dataUrl,
        assistantSelectionScope: fromPanel ? 'xiaotao' : 'aifx-material',
        assistantProvider: 'api',
        assistantModelId: modelId,
        assistantSelectionEpoch: selected.epoch,
        signal: abort.signal,
        isInputCurrent: () => isCurrent() === true,
        ...ui,
      })
      return result || { ok: false, error: onlineFailureText }
    } catch {
      return { ok: false, error: onlineFailureText }
    } finally {
      clearTimeout(timer)
      materialQuotes.delete(requestId)
    }
  }
  // No automatic switch: the local model never reads online, an online model never reads locally.
  const askMaterial = (payload, timeoutMs, modelId, isCurrent) => isLocalMaterialModel(modelId)
    ? askAssistant(payload, timeoutMs)
    : askOnlineMaterial(payload, timeoutMs, modelId, isCurrent)
  const materialFromResult = (result, modelId, image) => {
    const nested = nestedResult(result)
    const entry = result?.material || nested.material
    const material = String(entry && entry.material || '').trim()
    if (!result || result.ok === false || nested.ok === false || !material) {
      return {
        read: null,
        quota: null,
        error: isLocalMaterialModel(modelId) ? localFailureText : onlineFailureMessage(result),
      }
    }
    const read = {
      name: String(entry.name || '').trim() || 'REFERENCE',
      material,
      elements: String(entry.elements || '').trim(),
      colours: String(entry.colours || '').trim(),
      breakup: String(entry.breakup || '').trim(),
    }
    const restyle = RESTYLE()
    return {
      read: restyle && restyle.pictureRead ? restyle.pictureRead(read, referenceColour(image).hues) : read,
      quota: result.quota || nested.quota || null,
      error: '',
    }
  }
  const readReferenceMaterial = (blob, image) => {
    const source = materialSource()
    if (referenceMaterials.has(blob) && materialSources.get(blob) !== source) dropMaterial(blob)
    if (!referenceMaterials.has(blob)) {
      materialSources.set(blob, source)
      const job = (async () => {
        // On the black plate the effect will sit on, and no bigger than the model looks at.
        const scale = Math.min(1, 768 / Math.max(1, image.naturalWidth, image.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
        const context = canvas.getContext('2d')
        context.fillStyle = '#000'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const input = { name: 'reference.jpg', dataUrl: canvas.toDataURL('image/jpeg', 0.92), purpose: 'aifx-material' }
        const result = await askMaterial(input, REFERENCE_MATERIAL_TIMEOUT_MS, source, () => materialSource() === source)
        const outcome = materialFromResult(result, source, image)
        if (materialSource() === source) materialMeta.set(blob, { model: source, quota: outcome.quota, error: outcome.error || '' })
        return outcome
      })().catch((error) => {
        const outcome = {
          read: null,
          quota: null,
          error: isLocalMaterialModel(source) ? (String(error?.message || '') || localFailureText) : onlineFailureText,
        }
        if (materialSource() === source) materialMeta.set(blob, { model: source, quota: null, error: outcome.error })
        return outcome
      })
      referenceMaterials.set(blob, job)
      materialBlobs.add(blob)
      job.then((outcome) => {
        if (materialSource() !== source || referenceMaterials.get(blob) !== job) return
        if (!outcome.read) referenceMaterials.delete(blob)
      })
    }
    return referenceMaterials.get(blob).then((outcome) => outcome && outcome.read)
  }
  const applyMaterialOutcome = (entry, read) => {
    const meta = materialMeta.get(entry.blob) || {}
    entry.material = read
    entry.materialQuota = read ? meta.quota || null : null
    entry.materialError = read ? '' : (meta.error || failureText(activeMaterialModel()))
    entry.materialState = read ? 'ready' : 'failed'
    entry.readingSince = 0
  }
  const MATERIAL_MODEL_IDS = () => (xiaotaoAgent()?.MODEL_PICKER_GROUPS || []).flatMap((group) => group.ids)
  const setMaterialModel = (value) => {
    const next = String(value || '')
    if (next === materialModelId || !(isLocalMaterialModel(next) || MATERIAL_MODEL_IDS().includes(next))) {
      refreshUi()
      return next === materialModelId
    }
    materialModelId = next
    materialModelEpoch += 1
    materialQuotes.clear()
    for (const listener of materialModelListeners) { try { listener() } catch { /* listener gone */ } }
    if (!isLocalMaterialModel(next)) refreshMaterialPricing()
    clearMaterialCache()
    for (const entry of state.references) {
      entry.material = null
      entry.materialQuota = null
      entry.materialError = ''
      readEntryMaterial(entry, () => materialModelId === next)
    }
    refreshUi()
    return true
  }
  // Built once 小桃 is on the page: it owns the picker, the model notes and the prices.
  let materialPicker = null
  const placeMaterialMenu = () => {
    const box = materialPicker.trigger.getBoundingClientRect(), menu = materialPicker.menu
    const room = window.innerHeight - box.bottom - 12
    menu.style.left = Math.max(12, box.left) + 'px'
    menu.style.top = room >= 240 ? box.bottom + 4 + 'px' : ''
    menu.style.bottom = room >= 240 ? '' : window.innerHeight - box.top + 4 + 'px'
  }
  const ensureMaterialPicker = () => {
    if (materialPicker) return true
    const agent = xiaotaoAgent(), slot = state.refs?.materialModelSlot, host = state.refs?.materialModelHost
    if (!slot || !host || typeof agent?.createModelPicker !== 'function' || !xiaotaoController()) return false
    materialPicker = agent.createModelPicker(document, {
      label: '选择材质识别模型',
      menuLabel: '材质识别模型',
      listboxId: 'aifx-material-model-listbox',
      optionIdPrefix: 'aifx-material-model-option-',
      describe: (id) => agent.modelOptionInfo(xiaotaoController(), id, {
        localNote: '本地识别免费',
        localChecks: false,
        available: (modelId) => xiaotaoController().styleReadAvailable(modelId),
      }),
      current: () => materialModelId,
      choose: (id) => setMaterialModel(id),
      isShown: () => Boolean(host.isConnected),
      beforeOpen: () => { xiaotaoController()?.prefetchPricingPolicy?.(); refreshMaterialPricing(); placeMaterialMenu() },
    })
    slot.append(materialPicker.trigger)
    // The panel clips and restyles what is inside it, so the menu opens outside, the same as 小桃's.
    const portal = document.createElement('div')
    portal.className = 'nf-xiaotao-model-host aifx-material-model-portal'
    portal.setAttribute('data-novaflow-runtime-ignore', '1')
    portal.append(materialPicker.backdrop, materialPicker.menu)
    document.body.append(portal)
    materialPicker.sync()
    return true
  }

  // 提示词补充 typed in Chinese is followed far less than the same words in English, so the local AI
  // 助手 translates it first (the builder then names the colours and the placement, see
  // supplementClause). Once per wording; no assistant or a failed translation keeps the Chinese,
  // which is what every run used to get.
  const SUPPLEMENT_TIMEOUT_MS = 120000
  const supplementTranslations = new Map()
  const translateSupplement = (text) => {
    const supplement = String(text || '').trim()
    if (!supplement || !/[㐀-鿿]/.test(supplement)) return Promise.resolve(supplement)
    if (!supplementTranslations.has(supplement)) {
      const job = (async () => {
        const result = await askAssistant({ purpose: 'aifx-supplement', supplement }, SUPPLEMENT_TIMEOUT_MS)
        const english = String(result && result.ok !== false && result.supplement || '').trim()
        return english && !/[㐀-鿿]/.test(english) ? english : ''
      })().catch(() => '')
      supplementTranslations.set(supplement, job)
      // A failure is not remembered: the next run asks again.
      job.then((english) => { if (!english) supplementTranslations.delete(supplement) })
    }
    return supplementTranslations.get(supplement)
  }

  // Reads one reference's material and puts the outcome on it, while it is still loaded.
  const readEntryMaterial = (entry, stillWanted = () => true) => {
    if (entry.materialState !== 'reading' || !entry.readingSince) entry.readingSince = Date.now()
    entry.materialState = 'reading'
    startMaterialTicker()
    const read = readReferenceMaterial(entry.blob, entry.image)
    read.then((material) => {
      if (!state.references.includes(entry) || !stillWanted()) return
      applyMaterialOutcome(entry, material)
      refreshUi()
    })
    return read
  }

  // Each picture added joins the others; the same picture twice is kept once.
  const adoptReference = (blob, fileName) => new Promise((resolve, reject) => {
    if (state.references.some((entry) => entry.blob === blob)) { resolve(); return }
    if (state.references.length >= MAX_REFERENCES) {
      reject(new Error('AI 特效：参考图最多 ' + MAX_REFERENCES + ' 张，先移除一张再加'))
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      if (state.references.length >= MAX_REFERENCES) {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('AI 特效：参考图最多 ' + MAX_REFERENCES + ' 张，先移除一张再加'))
        return
      }
      const entry = {
        blob, fileName: String(fileName || 'reference.png'), objectUrl, image, uploadedName: '',
        accent: referenceColour(image).accent,
        material: null,
        materialState: 'reading',
      }
      state.references.push(entry)
      readEntryMaterial(entry)
      refreshUi()
      drawPreview()
      resolve()
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('AI 特效：参考图读取失败'))
    }
    image.src = objectUrl
  })

  const adoptReferences = async (files) => {
    const images = Array.from(files || []).filter((file) => /image\//.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || ''))
    if (!images.length) throw new Error('AI 特效：请选择图片')
    const room = MAX_REFERENCES - state.references.length
    if (room <= 0) throw new Error('AI 特效：参考图最多 ' + MAX_REFERENCES + ' 张，先移除一张再加')
    for (const file of images.slice(0, room)) await adoptReference(file, file.name)
    if (images.length > room) throw new Error('AI 特效：参考图最多 ' + MAX_REFERENCES + ' 张，多出的 ' + (images.length - room) + ' 张没有加入')
  }

  // A reference image now decides the material, so each one needs its own way out (the × on its
  // thumbnail), and 移除全部参考图 drops them all without taking the template with them.
  const removeReference = (entry) => {
    const index = state.references.indexOf(entry)
    if (index < 0) return
    revokeSource(entry)
    state.references.splice(index, 1)
    setStatusFromState()
    refreshUi()
  }

  const clearReferences = () => {
    state.references.forEach(revokeSource)
    state.references = []
    setStatusFromState()
    refreshUi()
  }

  const clearTemplate = () => {
    revokeSource(state.source)
    state.references.forEach(revokeSource)
    state.source = null
    state.sourceFrames = []
    state.references = []
    state.shapeArchetype = ''
    state.shapeAuto = ''
    state.lifecycle = ''
    state.lifecycleAuto = ''
    state.userTemplateId = ''
    state.customShape = null
    state.result = null
    state.resultFrames = []
    state.candidates = []
    state.selectedCandidate = 0
    state.playhead = 0
    state.playing = false
    syncPreviewMode()
    setStatusFromState()
    refreshUi()
    drawPreview()
  }

  const currentStrength = () => {
    // An explicit drag wins; otherwise each attribute brings its own default,
    // because they do not all rebuild at the same denoise - and typing in
    // 提示词补充 asks for the words to win, which costs the init its grip, so
    // the default moves up as soon as that box has anything in it.
    if (state.strength != null) return state.strength
    const restyle = RESTYLE()
    if (!restyle) return 20
    // A reference image takes the preset out of the prompt, so letting the
    // greyed-out preset still choose the denoise would be a hidden setting -
    // 雷电 and 冰霜 would give different results from the same picture. The
    // reference tests were all run at the plain default.
    const attribute = state.references.length ? '' : state.attribute
    return restyle.defaultStrengthFor(attribute, state.lifecycle,
      Boolean(String(state.supplement || '').trim()))
  }

  // The stop under the status line: the poll loop sees the signal, and /interrupt cancels the task on
  // the node - including one still waiting for a node, which ends the upload wait with it.
  const cancelGenerate = () => {
    if (!state.isGenerating || !state.abort || state.abort.signal.aborted) return
    state.abort.abort()
    // Pressed once is enough: the stop dims until the next run.
    const stop = document.querySelector(`#${APP_ID} [data-action="cancel-generate"]`)
    if (stop) stop.disabled = true
    setStatus('正在中止', '')
    CLIENT()?.interrupt?.()
  }

  const runGenerate = async ({ model = '' } = {}) => {
    const restyle = RESTYLE()
    const client = CLIENT()
    if (!restyle || !client) throw new Error('AI 特效：生成模块未加载')
    if (!state.source) throw new Error('AI 特效：请先上传素材')
    // Clearing the style and writing 提示词补充 instead is the prompt-only
    // case: the words become the material description. What is not allowed is
    // having neither.
    if (!state.references.length && !restyle.getPreset(state.attribute) && !String(state.supplement || '').trim()) {
      throw new Error('AI 特效：选个风格，或放参考图，或在提示词补充里写材质')
    }
    state.isGenerating = true
    state.abort = new AbortController()
    const stop = document.querySelector(`#${APP_ID} [data-action="cancel-generate"]`)
    if (stop) stop.disabled = false
    state.progress = 0
    refreshUi()
    let stageLabel = ''
    let stageBase = 0
    let stageSpan = 1
    // One run is 1..4 candidates in a row; each owns an equal slice of the bar.
    const setProgress = (fraction) => {
      state.progress = stageBase + stageSpan * clamp(fraction, 0, 1)
      refreshUi()
    }
    const onWait = (event) => {
      if (!state.isGenerating || signal.aborted) return
      state.detail = [stageLabel, '等待算力节点 ' + (event.detail?.seconds || 0) + ' 秒'].filter(Boolean).join(' \u00b7 ')
      setProgress(0.04)
    }
    window.addEventListener('novaflow:web-task-wait', onWait)
    // 中止 must end the run at once: the runtime check and the node wait do not look at the signal.
    const signal = state.abort.signal
    const stoppable = (promise) => new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new Error('AI 特效生成已取消')); return }
      signal.addEventListener('abort', () => reject(new Error('AI 特效生成已取消')), { once: true })
      promise.then(resolve, reject)
    })
    try {
      panelModel = String(model || '')
      // Before the runtime: the read runs on the AI 助手's own model and hands the GPU back after.
      // The references this run uses, fixed now: adding or removing one mid-run waits for the next.
      const references = state.references.slice()
      const items = materialItems()
      supplementMentions(state.supplement, items)
      let referenceReads = null
      if (references.length) {
        setStatus('识别参考图材质', references.map((entry) => entry.fileName).join('、'))
        // A read that failed when the picture came in is asked again here; the card follows.
        const reads = await stoppable(Promise.all(references.map((entry) => readEntryMaterial(entry))))
        refreshUi()
        referenceReads = reads.every(Boolean) ? reads : null
      }
      // Read out as words, the references go through the style path and their pictures are not sent
      // at all. That needs every one read: one unread picture sends them all as pictures instead.
      const referencePicture = references.length > 0 && !referenceReads
      // 提示词补充 wins where it conflicts: its spread and colour asks replace the defaults (see
      // splitSupplement), and only what is left is translated and said. With no style and no
      // picture the words are the material itself and go through whole.
      const promptOnly = !references.length && !restyle.getPreset(state.attribute)
      // Each @参考图N goes through the split and the translation as a placeholder the translator
      // leaves alone, and only then becomes the words for that source.
      const phraseFor = (n) => {
        const item = items[n - 1]
        const read = item.kind === 'upload' && referenceReads ? referenceReads[item.picture - 1] : null
        return mentionPhrase(item, read, referencePicture)
      }
      const placeholder = (n) => 'REFMARK' + n + 'X'
      const marked = String(state.supplement || '').replace(MENTION, (all, n) => placeholder(Number(n)))
      const unmark = (text) => String(text || '').replace(/REFMARK([0-9]+)X/g, (all, n) => phraseFor(Number(n)))
      const controls = promptOnly ? null : restyle.splitSupplement(marked)
      const toSay = controls ? controls.additions : marked.trim()
      let supplementEnglish = toSay
      if (/[㐀-鿿]/.test(toSay)) {
        setStatus('翻译提示词补充', '')
        // A failed translation keeps the Chinese rather than dropping the request, and so does one
        // that lost or doubled a placeholder.
        const english = await stoppable(translateSupplement(toSay))
        const kept = (text) => (String(text).match(/REFMARK[0-9]+X/g) || []).sort().join()
        supplementEnglish = english && kept(english) === kept(toSay) ? english : toSay
      }
      supplementEnglish = unmark(supplementEnglish)
      const supplementText = unmark(marked)
      const recolour = controls && controls.colour
      const overrides = { shape: currentShape(), spread: controls ? controls.spread : '', colour: recolour }
      const preset = restyle.getPreset(state.attribute)
      // The first source on the board paints the init (see referenceColour), unless the words
      // recolour it.
      const accent = references.length
        ? (recolour && recolour.tint) || (preset ? preset.accent : references[0].accent)
        : undefined
      // The 风格库 pick is one more material read, first in line, blended with the pictures.
      const blended = referenceReads
        ? [...(preset ? [{ name: preset.name, elements: preset.material, colours: '', breakup: preset.breakup || '' }] : []), ...referenceReads]
        : null
      const attribute = blended
        ? {
            id: 'reference',
            name: blended.map((read) => read.name).filter(Boolean).join(' AND ') || 'REFERENCE',
            breakup: blended.map((read) => read.breakup).filter(Boolean).join(' '),
            material: restyle.referenceMaterial(blended, overrides),
            accent,
          }
        : preset && (overrides.spread || recolour) ? restyle.presetWithOverrides(preset, overrides) : state.attribute
      const tint = accent
      setStatus('准备运行时', '正在准备生成环境。')
      await stoppable(client.ensureRuntime({ reason: 'aifx-restyle' }))

      // On the Web a staged upload belongs to the one task that takes it, so every run (and every
      // candidate below) uploads afresh; the desktop runtime keeps the files and the names stay valid.
      const web = !!(typeof window === 'object' && window.NovaFlowWebRuntime && window.NovaFlowWebRuntime.isWeb)
      const uploadInputs = async () => {
        setStatus('上传素材', state.source.fileName)
        state.source.uploadedName = await stoppable(client.uploadFile(state.source.blob, state.source.fileName))
        if (referencePicture) {
          for (const entry of references) {
            setStatus('上传参考图', entry.fileName)
            entry.uploadedName = await stoppable(client.uploadFile(entry.blob, entry.fileName))
          }
        }
      }
      if (web || !state.source.uploadedName || (referencePicture && references.some((entry) => !entry.uploadedName))) await uploadInputs()

      const label = restyle.getPreset(state.attribute)?.label || ''
      const total = Math.max(1, Math.min(4, Math.round(state.candidateCount) || 1))
      // Earlier runs stay on the strip while the template stays: a rerun with
      // another style or wording adds to the row, and each candidate carries
      // the recipe that made it so clicking it puts that recipe back.
      const recipe = snapshotRecipe()
      stageSpan = 1 / total
      for (let index = 0; index < total; index += 1) {
        if (state.abort.signal.aborted) throw new Error('AI 特效生成已取消')
        stageBase = index / total
        setProgress(0.01)
        if (web && index > 0) await uploadInputs()
        const seed = state.lockedSeed == null
          ? Math.floor(Math.random() * 0xffffffff)
          : (state.lockedSeed + index) >>> 0
        const workflow = restyle.buildWorkflow({
          sourceVideo: state.source.uploadedName,
          referenceImages: referencePicture ? references.map((entry) => entry.uploadedName) : [],
          tint,
          attribute,
          supplement: supplementText,
          // Older compute nodes ignore these and keep using the Chinese above.
          supplementEnglish,
          supplementControls: controls ? { spread: controls.spread, colour: recolour ? recolour.words : '' } : undefined,
          shape: currentShape(),
          plainShape: currentPlainShape(),
          shapeArchetype: state.shapeArchetype,
          lifecycle: state.lifecycle,
          lifecycleClause: currentLifecycleClause(),
          strength: currentStrength(),
          width: state.source.width,
          height: state.source.height,
          // The clip's own length decides how many frames H3 samples and how
          // fast the result plays back, so a 0.7s effect stays a 0.7s effect.
          durationSec: state.source.duration,
          seed,
        })
        restyle.validateWorkflow(workflow)
        stageLabel = [label, total > 1 ? '\u5019\u9009 ' + (index + 1) + '/' + total : ''].filter(Boolean).join(' \u00b7 ')
        setStatus('生成中', stageLabel)
        setProgress(0.03)
        const startedAt = Date.now()
        const result = await stoppable(client.submit(workflow, {
          signal,
          // The node's own percentage when it reports one; otherwise a slow creep so the bar is alive.
          onProgress: ({ progress } = {}) => {
            if (signal.aborted) return
            const reported = Number(progress)
            const creep = 1 - Math.exp(-(Date.now() - startedAt) / 90000)
            state.detail = stageLabel
            setProgress(0.05 + 0.85 * (reported > 0 ? reported / 100 : creep))
          },
        }))
        const frames = []
        for (const url of result.frames) {
          frames.push(await client.loadImage(url))
          setProgress(0.9 + 0.1 * frames.length / Math.max(1, result.frames.length))
        }
        const candidate = { seed, result, frames, recipe }
        state.candidates.push(candidate)
        // Show the first one the moment it lands rather than leaving the canvas
        // empty while the rest render.
        if (index === 0) {
          state.selectedCandidate = state.candidates.length - 1
          state.result = result
          state.resultFrames = frames
          state.playhead = 0
          syncPreviewMode()
          refreshUi()
          drawPreview()
        }
        renderCandidates()
        void saveCandidateToWarehouse(candidate)
      }
    } catch (error) {
      // A stopped run ends quietly; the candidates that did land stay.
      if (!state.abort?.signal.aborted) throw error
    } finally {
      panelModel = ''
      window.removeEventListener('novaflow:web-task-wait', onWait)
      const stopped = Boolean(state.abort?.signal.aborted)
      state.progress = 0
      // The summary has to be written after the flag clears: setStatusFromState
      // deliberately leaves a run's progress text alone while one is in flight.
      state.isGenerating = false
      state.abort = null
      if (stopped) setStatus('已中止', '')
      else setStatusFromState()
      refreshUi()
      drawPreview()
    }
  }

  // Every candidate is a fresh random seed, so a result the artist likes can
  // never be asked for again - not the same one with another style, not a
  // neighbour of it. Locking takes that candidate's seed and the next run
  // starts from it, candidate N getting seed+N, so the first one reproduces
  // exactly and the rest are its neighbours.
  const toggleSeedLock = () => {
    if (state.lockedSeed != null) {
      state.lockedSeed = null
    } else {
      const candidate = state.candidates[state.selectedCandidate]
      if (!candidate) return
      state.lockedSeed = candidate.seed
    }
    refreshUi()
  }

  // What the panel was set to when a candidate was made. The reference images
  // travel as their blobs: removing one revokes its object URL, so the entries
  // themselves cannot be kept.
  const snapshotRecipe = () => ({
    attribute: state.attribute,
    supplement: state.supplement,
    strength: state.strength,
    references: state.references.map((entry) => ({ blob: entry.blob, fileName: entry.fileName })),
    shapeArchetype: state.shapeArchetype,
    shapeAuto: state.shapeAuto,
    lifecycle: state.lifecycle,
    lifecycleAuto: state.lifecycleAuto,
  })

  const restoreRecipe = async (recipe) => {
    if (!recipe) return
    state.attribute = recipe.attribute
    state.supplement = recipe.supplement
    state.strength = recipe.strength
    state.shapeArchetype = recipe.shapeArchetype
    state.shapeAuto = recipe.shapeAuto
    state.lifecycle = recipe.lifecycle
    state.lifecycleAuto = recipe.lifecycleAuto
    const wanted = recipe.references || []
    const same = wanted.length === state.references.length && wanted.every((item, index) => item.blob === state.references[index].blob)
    if (!same) {
      clearReferences()
      for (const item of wanted) await adoptReference(item.blob, item.fileName)
    }
  }

  // Each candidate goes to the 仓库 as the black-plate MP4 H3 rendered, one
  // file per candidate. The web runtime keeps this panel's tasks out of the
  // automatic save (dozens of raw PNG frames per candidate), and nothing else
  // put the result anywhere. The plate is the finished clip and doubles as a
  // template for another pass.
  const candidateFileName = (candidate) => {
    const restyle = RESTYLE()
    const saved = state.userTemplates.find(item => item.id === state.userTemplateId)
    const template = saved ? saved.label
      : String(state.source && state.source.fileName || 'template').replace(/\.[^.]+$/, '')
    const recipe = candidate.recipe || {}
    const referenceCount = (recipe.references || []).length
    const preset = restyle && !referenceCount ? restyle.getPreset(recipe.attribute) : null
    const material = referenceCount ? '参考图' + (referenceCount > 1 ? referenceCount + '张' : '')
      : preset ? preset.label
        : String(recipe.supplement || '').trim().slice(0, 20) || '自定义'
    const clean = (value) => String(value || '').replace(/[\\/<>:"|?*\u0000-\u001f\s·]+/g, '_').replace(/^_+|_+$/g, '')
    return ['AI特效', clean(template), clean(material), candidate.seed].filter(Boolean).join('_') + '.mp4'
  }

  const saveCandidateToWarehouse = async (candidate) => {
    const warehouse = window.NovaFlowWebWarehouse
    if (!warehouse || typeof warehouse.save !== 'function') return
    const videos = candidate.result && Array.isArray(candidate.result.videos) ? candidate.result.videos : []
    if (!videos.length) return
    try {
      const response = await fetch(String(videos[0]))
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const bytes = await response.arrayBuffer()
      candidate.saved = await warehouse.save({ blob: new Blob([bytes], { type: 'video/mp4' }), name: candidateFileName(candidate) })
    } catch (error) {
      console.warn('[Foart aifx] 结果入库失败', error)
    }
  }

  const selectCandidate = async (index) => {
    const candidate = state.candidates[index]
    if (!candidate) return
    stopPlayback()
    state.selectedCandidate = index
    state.result = candidate.result
    state.resultFrames = candidate.frames
    state.playhead = 0
    syncPreviewMode()
    renderCandidates()
    // The strip is the memory of what was tried: picking a candidate puts its
    // style, wording and reference back so 生成 continues from that version.
    // Not while a run is still reading these for its remaining candidates.
    if (!state.isGenerating) await restoreRecipe(candidate.recipe)
    refreshUi()
    drawPreview()
  }

  const renderCandidates = () => {
    const host = state.refs.candidates
    if (!host) return
    host.hidden = state.candidates.length < 1
    host.innerHTML = ''
    state.candidates.forEach((candidate, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'aifx-candidate' + (index === state.selectedCandidate ? ' is-active' : '')
      button.title = '\u5019\u9009 ' + (index + 1) + ' \u00b7 seed ' + candidate.seed
      const thumb = document.createElement('canvas')
      thumb.width = 62
      thumb.height = 62
      // A frame from a third of the way in: the opening frames of most elements
      // look alike and the tail is usually empty.
      const frame = candidate.frames[Math.floor(candidate.frames.length * 0.35)] || candidate.frames[0]
      if (frame) {
        const context = thumb.getContext('2d')
        const width = frame.naturalWidth || frame.width
        const height = frame.naturalHeight || frame.height
        const size = Math.min(width, height)
        context.drawImage(frame, (width - size) / 2, (height - size) / 2, size, size, 0, 0, 62, 62)
      }
      button.appendChild(thumb)
      const badge = document.createElement('span')
      badge.className = 'aifx-candidate-index'
      badge.textContent = String(index + 1)
      button.appendChild(badge)
      button.addEventListener('click', guard(() => selectCandidate(index)))
      host.appendChild(button)
    })
    // Keep the selected one in view once the row is longer than the column.
    const active = host.children[state.selectedCandidate]
    if (active && host.scrollWidth > host.clientWidth) {
      host.scrollLeft = clamp(active.offsetLeft - (host.clientWidth - active.offsetWidth) / 2, 0, host.scrollWidth - host.clientWidth)
    }
  }

  // The only place the preview mode is decided.
  const syncPreviewMode = () => {
    state.previewMode = state.resultFrames.length ? 'compare' : 'template'
    return state.previewMode
  }

  const frameCount = () => {
    if (state.previewMode === 'template') return state.sourceFrames.length
    if (state.resultFrames.length) return state.resultFrames.length
    return state.sourceFrames.length
  }

  const stopPlayback = () => {
    state.playing = false
    if (state.playTimer) {
      clearInterval(state.playTimer)
      state.playTimer = 0
    }
  }

  const togglePlayback = () => {
    if (state.playing) {
      stopPlayback()
      refreshUi()
      return
    }
    const total = frameCount()
    if (total < 2) return
    state.playing = true
    state.playTimer = setInterval(() => {
      state.playhead = (state.playhead + 1) % frameCount()
      refreshUi()
      drawPreview()
    }, Math.round(1000 / PREVIEW_FPS))
    refreshUi()
  }


  // --- libraries ------------------------------------------------------------
  // Both pickers are what the particle editor's 模板库 is: a panel over the
  // preview with a five-column grid of cards, a 16:10 thumbnail playing in
  // each and a name under it; the template library also has the dashed
  // "点击存储" card first, a × on every card and 重置. The template cards
  // play the shipped clips; the style cards play a 240px cut of each style's
  // own crescent render, so what the artist picks from is what the recipe
  // actually produces.
  const STYLE_PREVIEW_URL = (id) => './aifx-styles/' + id + '.mp4'

  // --- the template store --------------------------------------------------
  // Saved templates live in userData under one key, like the particle
  // library's `templates`: metadata plus the clip as base64. The desktop
  // app writes it through user-data-write (encrypted per machine); the 4783
  // preview has no such IPC, so it falls back to IndexedDB, which keeps the
  // feature testable there.
  const TEMPLATE_STORE_KEY = 'aifxTemplates'
  const TEMPLATE_CLIP_MAX_BYTES = 24 * 1024 * 1024

  const idb = (mode, run) => new Promise((resolve, reject) => {
    const open = indexedDB.open('novaflow-aifx', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('kv')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('kv', mode)
      const request = run(tx.objectStore('kv'))
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      tx.oncomplete = () => db.close()
    }
  })

  const readTemplateStore = async () => {
    const api = window.electronAPI
    if (api && typeof api.loadUserData === 'function') {
      const result = await api.loadUserData(TEMPLATE_STORE_KEY)
      if (result && result.ok === false) throw new Error(String(result.error || '模板库读取失败'))
      const data = result && typeof result === 'object' && 'data' in result ? result.data : result
      return data && typeof data === 'object' ? data : null
    }
    return idb('readonly', (store) => store.get(TEMPLATE_STORE_KEY))
  }

  const writeTemplateStore = async (data) => {
    const api = window.electronAPI
    if (api && typeof api.saveUserData === 'function') {
      const result = await api.saveUserData({ key: TEMPLATE_STORE_KEY, data })
      if (result && result.ok === false) throw new Error(String(result.error || '模板库保存失败'))
      return
    }
    await idb('readwrite', (store) => store.put(data, TEMPLATE_STORE_KEY))
  }

  const ensureTemplateStore = async () => {
    if (state.templateStoreLoaded) return
    state.templateStoreLoaded = true
    let data = null
    try {
      data = await readTemplateStore()
    } catch (error) {
      console.warn('[AI 特效] 模板库读取失败，按空库处理', error)
    }
    const items = data && Array.isArray(data.items) ? data.items : []
    // 2026-10-16 用户：「以前存进去的删掉好了」——第 2 版之前存的模板只有视频、没有工程（不能「编辑」），
    // 读到旧库时一次清掉并按新格式存回；新库里用「点击存储」存的素材照常保留
    const legacy = !!data && !(Number(data.version) >= 2)
    state.userTemplates = items
      .filter(item => item && typeof item === 'object' && item.id && item.data)
      .filter(item => !legacy || item.project)
      .map(item => ({ ...item, objectUrl: '' }))
    if (legacy) {
      try {
        await persistTemplateStore()
      } catch (error) {
        console.warn('[AI 特效] 旧模板清理后写回失败', error)
      }
    }
  }

  const persistTemplateStore = () => writeTemplateStore({
    version: 2,
    items: state.userTemplates.map(({ objectUrl, ...item }) => item),
  })

  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('读取素材失败'))
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(blob)
  })

  const base64ToBlob = (data, mime) => {
    const binary = atob(String(data || ''))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return new Blob([bytes], { type: mime || 'video/mp4' })
  }

  const userTemplateUrl = (item) => {
    if (!item.objectUrl) item.objectUrl = URL.createObjectURL(base64ToBlob(item.data, item.mime))
    return item.objectUrl
  }

  const defaultTemplateName = () => {
    const user = state.userTemplates.find(item => item.id === state.userTemplateId)
    if (user) return user.label
    const fileName = state.source ? String(state.source.fileName || '') : ''
    return fileName.replace(/\.[a-z0-9]{1,5}$/i, '') || '模板'
  }

  const saveCurrentAsTemplate = async (name) => {
    if (!state.source) throw new Error('AI 特效：先上传素材，再存进模板库')
    if (state.source.blob.size > TEMPLATE_CLIP_MAX_BYTES) {
      throw new Error('AI 特效：素材超过 24 MB，存不进模板库')
    }
    await ensureTemplateStore()
    const label = String(name || '').trim() || defaultTemplateName()
    const item = {
      id: 'user-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2, 8),
      label,
      fileName: String(state.source.fileName || 'template.mp4'),
      mime: state.source.blob.type || 'video/mp4',
      size: state.source.blob.size,
      width: state.source.width,
      height: state.source.height,
      createdAt: Date.now(),
      // What the detector (or a built-in's own metadata) settled on, so the
      // template comes back exactly as it was when it was saved.
      archetype: state.shapeArchetype,
      lifecycle: state.lifecycle,
      data: await blobToBase64(state.source.blob),
      objectUrl: '',
    }
    state.userTemplates.push(item)
    await persistTemplateStore()
    state.userTemplateId = item.id
    refreshUi()
    return item.id
  }

  // A clip from 模板制作 (or 骨骼动画 → 特效扫光 → 存入 AI 特效模板库). It keeps the project
  // (base picture included) so 编辑 reopens it; `id` updates that template in place.
  const addTemplate = async ({ blob: given, label, width, height, ai, project, id } = {}) => {
    // 骨骼动画编辑器在 iframe 里：它的 Blob 不是本页的 Blob（instanceof 不认），按样子判断，复制一份本页的
    if (!given || typeof given.size !== 'number' || typeof given.arrayBuffer !== 'function') throw new Error('AI 特效：没有模板视频')
    const blob = new Blob([await given.arrayBuffer()], { type: given.type || 'video/mp4' })
    if (blob.size > TEMPLATE_CLIP_MAX_BYTES) throw new Error('AI 特效：模板超过 24 MB，存不进模板库')
    await ensureTemplateStore()
    const words = ai || {}
    const fields = {
      label: String(label || '').trim() || '模板',
      fileName: (String(label || 'template').trim() || 'template') + '.mp4',
      mime: blob.type || 'video/mp4',
      size: blob.size,
      width: Number(width) || 0,
      height: Number(height) || 0,
      archetype: String(words.archetype || ''),
      lifecycle: String(words.lifecycle || ''),
      shape: String(words.shape || ''),
      plainShape: String(words.plainShape || words.shape || ''),
      project: project || null,
      data: await blobToBase64(blob),
    }
    const existing = id ? state.userTemplates.find(item => item.id === String(id)) : null
    if (existing) {
      if (existing.objectUrl) {
        try { URL.revokeObjectURL(existing.objectUrl) } catch (_) {}
      }
      Object.assign(existing, fields, { objectUrl: '', updatedAt: Date.now() })
    } else {
      state.userTemplates.push({ id: 'user-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2, 8), createdAt: Date.now(), objectUrl: '', ...fields })
    }
    await persistTemplateStore()
    refreshUi()
    if (state.libraryKind === 'template' && state.refs.library && !state.refs.library.hidden) await openLibrary('template')
    return existing ? existing.id : state.userTemplates[state.userTemplates.length - 1].id
  }

  // Clicking a card's name edits it in place. A built-in keeps its shipped
  // label in code, so the new one is stored as an override beside the
  // deletions and 重置 clears both.
  const renameTemplate = async (id, label) => {
    await ensureTemplateStore()
    const key = String(id || '')
    const next = String(label || '').trim()
    if (!next) return false
    const user = state.userTemplates.find(item => item.id === key)
    if (user) {
      if (user.label === next) return false
      user.label = next
    } else {
      return false
    }
    await persistTemplateStore()
    refreshUi()
    return true
  }

  const deleteTemplate = async (id) => {
    await ensureTemplateStore()
    const key = String(id || '')
    const user = state.userTemplates.find(item => item.id === key)
    if (user) {
      if (user.objectUrl) {
        try { URL.revokeObjectURL(user.objectUrl) } catch (_) {}
      }
      state.userTemplates = state.userTemplates.filter(item => item.id !== key)
      if (state.userTemplateId === key) state.userTemplateId = ''
    } else {
      return false
    }
    await persistTemplateStore()
    refreshUi()
    return true
  }

  const loadUserTemplate = async (id) => {
    await ensureTemplateStore()
    const item = state.userTemplates.find(entry => entry.id === String(id || ''))
    if (!item) throw new Error('AI 特效：这个模板已经不在库里')
    if (state.source && state.userTemplateId === item.id) return
    setStatus('载入中', item.label)
    refreshUi()
    await adoptSource(base64ToBlob(item.data, item.mime), item.fileName)
    const shapes = SHAPES()
    if (item.archetype && shapes && shapes.ARCHETYPES[item.archetype]) {
      state.shapeArchetype = item.archetype
      state.shapeAuto = shapes.ARCHETYPES[item.archetype].label
    }
    if (item.lifecycle && shapes && shapes.LIFECYCLES[item.lifecycle]) {
      state.lifecycle = item.lifecycle
      state.lifecycleAuto = shapes.LIFECYCLES[item.lifecycle].label
    }
    if (item.shape) state.customShape = { archetype: state.shapeArchetype, shape: item.shape, plainShape: item.plainShape || item.shape }
    state.userTemplateId = item.id
    refreshUi()
  }

  // --- 模板制作 -----------------------------------------------------------------
  // The editor lives in aifx-template-maker.*.js (plus the sweep core it draws
  // the outline lights with). index.html lists them as text/plain so the build
  // hash-stamps their URLs; they are only executed the first time it opens.
  const MAKER_SCRIPTS = ['sweep-light.core.js', 'aifx-template-maker.core.js', 'aifx-template-maker.fx.js', 'aifx-template-maker.mp4.js', 'aifx-template-maker.ui.js']
  let makerLoading = null
  const loadTemplateMaker = () => {
    if (window.NovaFlowFxMakerUI && window.NovaFlowFxMaker && window.NovaFlowSweepLight) return Promise.resolve()
    if (makerLoading) return makerLoading
    const bare = (u) => String(u || '').split('#')[0].split('?')[0].replace(/^\.\//, '').split('/').pop()
    const urlOf = (name) => {
      for (const tag of document.querySelectorAll('script[src]')) if (bare(tag.getAttribute('src')) === name) return tag.getAttribute('src')
      return './' + name
    }
    const globals = { 'sweep-light.core.js': 'NovaFlowSweepLight', 'aifx-template-maker.core.js': 'NovaFlowFxMaker', 'aifx-template-maker.mp4.js': 'NovaFlowFxMp4', 'aifx-template-maker.ui.js': 'NovaFlowFxMakerUI' }
    makerLoading = MAKER_SCRIPTS.reduce((chain, name) => chain.then(() => new Promise((resolve, reject) => {
      if (globals[name] && window[globals[name]]) { resolve(); return }
      const tag = document.createElement('script')
      tag.src = urlOf(name)
      tag.onload = () => resolve()
      tag.onerror = () => reject(new Error('AI 特效：模板制作没有加载（' + name + '）'))
      document.head.appendChild(tag)
    })), Promise.resolve()).catch((error) => { makerLoading = null; throw error })
    return makerLoading
  }

  // 用作素材 = this clip becomes the source (with what the editor knows about
  // its shape) and a copy goes to the warehouse; 存入模板库 keeps the project.
  const openTemplateMaker = async ({ project = null, name = '', templateId = '' } = {}) => {
    await loadTemplateMaker()
    let editingId = templateId
    window.NovaFlowFxMakerUI.open({
      project,
      name,
      title: templateId ? '模板制作 · ' + name : '模板制作',
      onSaveWarehouse: async (blob) => {
        const warehouse = window.NovaFlowWebWarehouse
        if (warehouse && typeof warehouse.save === 'function') await warehouse.save({ blob, name: 'template.mp4' })
      },
      onUse: async (blob, info) => {
        await adoptSource(blob, (info.name || '模板') + '.mp4')
        const ai = info.ai || {}
        const shapes = SHAPES()
        if (ai.archetype && shapes && shapes.ARCHETYPES[ai.archetype]) {
          state.shapeArchetype = ai.archetype
          state.shapeAuto = shapes.ARCHETYPES[ai.archetype].label
        }
        if (ai.lifecycle && shapes && shapes.LIFECYCLES[ai.lifecycle]) {
          state.lifecycle = ai.lifecycle
          state.lifecycleAuto = shapes.LIFECYCLES[ai.lifecycle].label
        }
        if (ai.shape) state.customShape = { archetype: state.shapeArchetype, shape: ai.shape, plainShape: ai.plainShape || ai.shape }
        refreshUi()
      },
      onSaveTemplate: async (blob, info) => {
        editingId = await addTemplate({ blob, label: info.name, width: info.width, height: info.height, ai: info.ai, project: info.project, id: editingId })
      },
    })
  }

  // --- the panel ---------------------------------------------------------------
  const startRename = (nameEl, current, commit) => {
    if (nameEl.getAttribute('data-editing') === '1') return
    nameEl.setAttribute('data-editing', '1')
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'aifx-library-rename'
    input.maxLength = 40
    input.value = current
    nameEl.textContent = ''
    nameEl.appendChild(input)
    input.focus()
    input.select()
    let settled = false
    const finish = (save) => {
      if (settled) return
      settled = true
      const next = String(input.value || '').trim()
      nameEl.removeAttribute('data-editing')
      const keep = save && next ? next : current
      nameEl.textContent = keep
      nameEl.title = keep
      if (save && next && next !== current) {
        Promise.resolve(commit(next)).catch((error) => {
          setStatus('出错了', String(error && error.message || error))
          refreshUi()
        })
      }
    }
    input.addEventListener('click', (event) => event.stopPropagation())
    input.addEventListener('blur', () => finish(true))
    input.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter' || event.key === 'Return' || event.keyCode === 13) {
        event.preventDefault()
        finish(true)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        finish(false)
      }
    })
  }

  const libraryCard = ({ id, label, url, active, onPick, onDelete, onRename, onEdit }) => {
    const card = document.createElement('div')
    card.className = 'aifx-library-card' + (active ? ' is-active' : '')
    card.setAttribute('data-library-card', id)
    card.setAttribute('role', 'button')
    card.tabIndex = 0
    const thumb = document.createElement('div')
    thumb.className = 'aifx-library-thumb'
    const video = document.createElement('video')
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = url
    thumb.appendChild(video)
    if (onDelete) {
      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'aifx-library-del'
      del.title = '删除'
      del.textContent = '×'
      del.setAttribute('data-action', 'library-delete')
      del.setAttribute('data-library-delete', id)
      del.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        onDelete()
      })
      thumb.appendChild(del)
    }
    if (onEdit) {
      const edit = document.createElement('button')
      edit.type = 'button'
      edit.className = 'aifx-library-edit'
      edit.title = '在模板制作里接着改'
      edit.textContent = '编辑'
      edit.setAttribute('data-action', 'library-edit')
      edit.setAttribute('data-library-edit', id)
      edit.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        onEdit()
      })
      thumb.appendChild(edit)
    }
    card.appendChild(thumb)
    const name = document.createElement('div')
    name.className = 'aifx-library-name'
    name.textContent = label
    name.title = onRename ? label + '（点一下改名）' : label
    if (onRename) {
      name.setAttribute('data-rename', '1')
      name.setAttribute('data-library-name', id)
      name.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        startRename(name, label, onRename)
      })
    }
    card.appendChild(name)
    card.addEventListener('click', onPick)
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onPick(event)
      }
    })
    return card
  }

  // Only the cards in view decode: fifty-four clips at once is more than a
  // laptop GPU wants to spend on a picker.
  let libraryObserver = null
  const watchLibraryVideos = (body) => {
    if (libraryObserver) libraryObserver.disconnect()
    libraryObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.play().catch(() => {})
        else entry.target.pause()
      }
    }, { root: body, rootMargin: '80px 0px' })
    for (const video of Array.from(body.querySelectorAll('video'))) libraryObserver.observe(video)
  }

  const closeLibrarySaveDialog = () => {
    const refs = state.refs
    if (refs.librarySave) refs.librarySave.hidden = true
  }

  const openLibrarySaveDialog = () => {
    const refs = state.refs
    if (!refs.librarySave || !refs.librarySaveName) return
    if (!state.source) {
      setStatus('先上传素材', '把一段黑底特效放进来，才能存成模板。')
      return
    }
    refs.librarySaveName.value = defaultTemplateName()
    refs.librarySave.hidden = false
    try { refs.librarySaveName.focus(); refs.librarySaveName.select() } catch (_) {}
  }

  const confirmLibrarySave = async () => {
    const refs = state.refs
    const name = refs.librarySaveName ? refs.librarySaveName.value : ''
    closeLibrarySaveDialog()
    await saveCurrentAsTemplate(name)
    setStatus('已存入模板库', String(name || '').trim() || defaultTemplateName())
    await openLibrary('template')
  }

  const closeLibrary = () => {
    const refs = state.refs
    if (!refs.library || !refs.libraryBody) return
    closeLibrarySaveDialog()
    if (libraryObserver) {
      libraryObserver.disconnect()
      libraryObserver = null
    }
    for (const video of Array.from(refs.libraryBody.querySelectorAll('video'))) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    refs.libraryBody.innerHTML = ''
    refs.library.hidden = true
    state.libraryKind = ''
  }

  const openLibrary = async (kind) => {
    const refs = state.refs
    const restyle = RESTYLE()
    if (!refs.library || !refs.libraryBody) return
    closeLibrary()
    const body = refs.libraryBody
    if (kind === 'style') {
      if (!restyle) return
      const groups = new Map()
      for (const preset of restyle.ATTRIBUTE_PRESETS) {
        if (!groups.has(preset.group)) groups.set(preset.group, [])
        groups.get(preset.group).push(preset)
      }
      for (const [name, presets] of groups) {
        const title = document.createElement('div')
        title.className = 'aifx-library-group'
        title.textContent = name
        body.appendChild(title)
        const grid = document.createElement('div')
        grid.className = 'aifx-library-grid'
        for (const preset of presets) {
          grid.appendChild(libraryCard({
            id: preset.id, label: preset.label, url: STYLE_PREVIEW_URL(preset.id),
            active: preset.id === state.attribute,
            onPick: guard(() => {
              closeLibrary()
              state.attribute = preset.id
              refreshUi()
            }),
          }))
        }
        body.appendChild(grid)
      }
    } else if (kind === 'shape') {
      const shapes = SHAPES()
      if (!shapes) return
      const grid = document.createElement('div')
      grid.className = 'aifx-shape-grid'
      for (const [id, entry] of Object.entries(shapes.ARCHETYPES)) {
        const pick = document.createElement('button')
        pick.type = 'button'
        pick.className = 'aifx-shape-pick' + (id === state.shapeArchetype ? ' is-active' : '')
        pick.textContent = entry.label
        pick.setAttribute('data-shape-pick', id)
        pick.addEventListener('click', guard(() => {
          closeLibrary()
          state.shapeArchetype = id
          state.shapeAuto = entry.label
          state.customShape = null
          refreshUi()
        }))
        grid.appendChild(pick)
      }
      body.appendChild(grid)
      const note = document.createElement('div')
      note.className = 'aifx-library-group'
      note.style.marginTop = '10px'
      note.textContent = '形状决定提示词怎么描述这段素材。识别错了会直接影响结果的外形，改完重新生成即可。'
      body.appendChild(note)
    } else {
      await ensureTemplateStore()
      const grid = document.createElement('div')
      grid.className = 'aifx-library-grid'
      const add = document.createElement('button')
      add.type = 'button'
      add.className = 'aifx-library-card aifx-library-add'
      add.setAttribute('data-action', 'library-save')
      add.disabled = !state.source
      add.innerHTML = '<div class="aifx-library-thumb">'
        + '<div class="aifx-library-add-plus">+</div>'
        + '<div class="aifx-library-add-hint">' + (state.source ? '把上传的素材存成模板' : '先上传素材') + '</div>'
        + '</div><div class="aifx-library-name">点击存储</div>'
      add.addEventListener('click', guard(() => { openLibrarySaveDialog() }))
      grid.appendChild(add)
      for (const item of state.userTemplates) {
        grid.appendChild(libraryCard({
          id: item.id, label: item.label, url: userTemplateUrl(item),
          active: item.id === state.userTemplateId,
          onPick: guard(() => {
            closeLibrary()
            return loadUserTemplate(item.id)
          }),
          onDelete: guard(async () => {
            await deleteTemplate(item.id)
            await openLibrary('template')
          }),
          onRename: (next) => renameTemplate(item.id, next),
          onEdit: item.project ? guard(() => {
            closeLibrary()
            return openTemplateMaker({ project: item.project, name: item.label, templateId: item.id })
          }) : null,
        }))
      }
      if (!state.userTemplates.length) {
        const empty = document.createElement('div')
        empty.className = 'aifx-library-group'
        empty.style.gridColumn = '1 / -1'
        empty.textContent = '还没有模板。点「模板制作」做一个，或把上传的素材存进来。'
        grid.appendChild(empty)
      }
      body.appendChild(grid)
    }
    state.libraryKind = kind
    if (refs.libraryTitle) {
      refs.libraryTitle.textContent = kind === 'style' ? '风格库' : kind === 'shape' ? '形状' : '模板库'
    }
    refs.library.hidden = false
    watchLibraryVideos(body)
  }

  // The card under 风格库: the picked style playing, its name, and a way to
  // unpick it. Rebuilt only when the pick changes, because refreshUi runs on
  // every playhead tick and a recreated video would restart each time.
  // The material sources in board order: the 风格库 pick first, then the uploaded pictures. The
  // same order numbers them for 提示词补充's @参考图N.
  const materialItems = () => {
    const preset = RESTYLE()?.getPreset(state.attribute) || null
    return [
      ...(preset ? [{ kind: 'preset', preset }] : []),
      ...state.references.map((entry, index) => ({ kind: 'upload', entry, picture: index + 1 })),
    ]
  }

  // A read can wait minutes for a free compute node, so the line says how long it has waited and,
  // when the pool reports it, that it is queued - a bare "正在识别" looked hung.
  let materialNodeWait = null
  let materialWaitHeard = false
  let materialTicker = 0
  const startMaterialTicker = () => {
    if (!materialWaitHeard && typeof window.addEventListener === 'function') {
      materialWaitHeard = true
      window.addEventListener('novaflow:web-task-wait', (event) => {
        if (!state.references.some((entry) => entry.materialState === 'reading')) return
        materialNodeWait = { seconds: Number(event.detail?.seconds) || 0, at: Date.now() }
      })
    }
    if (materialTicker) return
    materialTicker = setInterval(() => {
      if (!state.references.some((entry) => entry.materialState === 'reading')) {
        clearInterval(materialTicker)
        materialTicker = 0
        materialNodeWait = null
      }
      put(state.refs.materialStatus, 'textContent', materialStatusText())
    }, 1000)
  }
  const materialStatusText = () => {
    const entries = state.references
    const reading = entries.filter((entry) => entry.materialState === 'reading')
    const failed = entries.find((entry) => entry.materialState === 'failed')
    if (reading.length) {
      const since = Math.min(...reading.map((entry) => entry.readingSince || Date.now()))
      const seconds = Math.max(0, Math.round((Date.now() - since) / 1000))
      const queued = materialNodeWait && Date.now() - materialNodeWait.at < 5000
      return (queued ? '等待算力节点识别参考图材质' : '正在识别参考图材质')
        + (seconds >= 3 ? '（已等 ' + seconds + ' 秒）' : '…')
    }
    return failed ? (failed.materialError || '材质未识别，按参考图直接生成') : ''
  }

  // 提示词补充 can @ any source on the board as @参考图N (the board's own numbering), through the
  // same @ menu the other prompt boxes use.
  const mentionResources = () => materialItems().map((item, index) => ({
    key: 'aifx_material_' + (index + 1),
    label: '参考图' + (index + 1),
    kind: item.kind === 'preset' ? 'video' : 'image',
    previewUrl: item.kind === 'preset' ? STYLE_PREVIEW_URL(item.preset.id) : item.entry.objectUrl,
    fileName: item.kind === 'preset' ? item.preset.label : item.entry.fileName,
    occupied: true,
    available: true,
  }))
  let mentionSignature = null
  const syncSupplementMentions = () => {
    const tool = window.NovaFlowResourceMentionTool
    const textarea = state.refs.supplement
    if (!tool || typeof tool.mountTextarea !== 'function' || !textarea || !textarea.isConnected) return
    const signature = mentionResources().map((item) => item.key + ':' + item.previewUrl).join('|')
    if (signature === mentionSignature) return
    mentionSignature = signature
    tool.mountTextarea({ textarea, surface: 'aifx', getResources: mentionResources })
  }

  // The @参考图N in 提示词补充, checked against the board before anything runs.
  const MENTION = /@参考图([1-9][0-9]*)/g
  const supplementMentions = (text, items) => {
    const numbers = [...String(text || '').matchAll(MENTION)].map((match) => Number(match[1]))
    const missing = numbers.filter((n) => n > items.length)
    if (missing.length) throw new Error('AI 特效：提示词补充里的 @参考图' + missing[0] + ' 没有对应的风格或参考图')
    return numbers
  }
  // What an @参考图N becomes in the English prompt: read out as words, the source's material by
  // name; sent as pictures, an upload is its own <Picture N>.
  const mentionPhrase = (item, read, picturePath) => {
    if (item.kind === 'preset') return 'the ' + String(item.preset.name || item.preset.label).toLowerCase() + ' material'
    if (picturePath) return 'the material of <Picture ' + item.picture + '>'
    return 'the ' + String(read && read.name || 'reference').toLowerCase() + ' material'
  }

  // Rebuilt only when the set of sources changes, because each one carries a playing video or a
  // picture that would restart.
  const renderMaterialBoard = () => {
    const host = state.refs.materialItems
    if (!host) return
    const items = materialItems()
    const key = items.map((item) => item.kind === 'preset' ? 'preset:' + item.preset.id : item.entry.objectUrl).join('|')
    if (host.getAttribute('data-rendered') !== key) {
      host.setAttribute('data-rendered', key)
      for (const media of Array.from(host.querySelectorAll('video'))) { media.pause(); media.removeAttribute('src'); media.load() }
      host.innerHTML = ''
      items.forEach((item, index) => {
        const tile = document.createElement('div')
        tile.className = 'aifx-material-tile'
        tile.setAttribute('data-material-tile', item.kind)
        let media
        if (item.kind === 'preset') {
          media = document.createElement('video')
          media.muted = true
          media.loop = true
          media.playsInline = true
          media.autoplay = true
          media.src = STYLE_PREVIEW_URL(item.preset.id)
        } else {
          media = document.createElement('img')
          media.alt = item.entry.fileName
          media.src = item.entry.objectUrl
        }
        tile.appendChild(media)
        const label = document.createElement('div')
        label.className = 'aifx-material-tile-label'
        const number = document.createElement('span')
        number.className = 'aifx-material-tile-index'
        number.textContent = '@参考图' + (index + 1)
        label.appendChild(number)
        label.appendChild(document.createTextNode(item.kind === 'preset' ? item.preset.label : item.entry.fileName))
        label.title = item.kind === 'preset' ? item.preset.label : item.entry.fileName
        tile.appendChild(label)
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'aifx-material-remove'
        remove.textContent = '×'
        remove.title = item.kind === 'preset' ? '取消这个风格' : '移除这张参考图'
        remove.setAttribute('aria-label', remove.title)
        remove.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (state.isGenerating) return
          if (item.kind === 'preset') { state.attribute = ''; refreshUi() } else removeReference(item.entry)
        })
        tile.appendChild(remove)
        host.appendChild(tile)
      })
    }
    put(state.refs.materialStatus, 'textContent', materialStatusText())
    put(state.refs.styleZone, 'hidden', state.references.length >= MAX_REFERENCES)
  }

  const guard = (handler) => async (event) => {
    if (event) event.preventDefault()
    try {
      await handler(event)
    } catch (error) {
      console.error('[Foart aifx]', error)
      setStatus('出错了', String(error && error.message || error))
      refreshUi()
    }
  }

  // --- a PNG sequence becomes a black-background clip ---------------------------
  // The rest of the app can already turn a frame sequence into a webm
  // (createLocalVideoFromImageSequence in the bundle), but that one clears the
  // canvas between frames, so a transparent sequence arrives with whatever the
  // encoder makes of the alpha. This pipeline reads luminance as the alpha, so
  // the frames have to be composited onto black here, and the panel needs its
  // own copy anyway: the bundle's version lives inside a React prop bag.
  const CLIP_TYPES = /video\/|\.(mp4|webm|mov|m4v|gif)$/i
  // Stills that can make up a sequence. GIF and APNG are clips, not stills, so
  // CLIP_TYPES claims them first.
  const SEQUENCE_TYPES = /^image\/(png|jpeg|webp|bmp)$|\.(png|jpe?g|webp|bmp)$/i
  const SEQUENCE_FPS = 24
  const SEQUENCE_MAX_FRAMES = 240

  const decodeSequenceFrame = async (file, revokeList) => {
    if (typeof window.createImageBitmap === 'function') {
      try { return await window.createImageBitmap(file) } catch (_) {}
    }
    const url = URL.createObjectURL(file)
    revokeList.push(url)
    const image = new Image()
    image.crossOrigin = 'anonymous'
    await new Promise((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('AI 特效：序列帧读取失败 ' + file.name))
      image.src = url
    })
    return image
  }

  // Natural sort, so frame_9 comes before frame_10.
  const sortSequence = (files) => Array.from(files).sort((a, b) => String(a.name || '')
    .localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }))

  const sequenceToBlackClip = async (files) => {
    if (typeof window.MediaRecorder !== 'function') {
      throw new Error('AI 特效：当前环境不支持把序列帧合成视频')
    }
    const ordered = sortSequence(files).slice(0, SEQUENCE_MAX_FRAMES)
    if (ordered.length < 2) throw new Error('AI 特效：序列帧至少要两张')
    const revokeList = []
    try {
      setStatus('正在合成', '把 ' + ordered.length + ' 张序列帧合成黑底视频…')
      refreshUi()
      const frames = []
      for (const file of ordered) frames.push(await decodeSequenceFrame(file, revokeList))
      const width = Math.round(Number(frames[0].width || frames[0].naturalWidth || 0))
      const height = Math.round(Number(frames[0].height || frames[0].naturalHeight || 0))
      if (!(width > 0 && height > 0)) throw new Error('AI 特效：序列帧尺寸无效')
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { alpha: false })
      const stream = canvas.captureStream ? canvas.captureStream(SEQUENCE_FPS) : null
      if (!stream) throw new Error('AI 特效：无法创建视频流')
      const chunks = []
      let recorder = null
      for (const options of [{ mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 8e6 },
        { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8e6 }, undefined]) {
        try {
          recorder = new window.MediaRecorder(stream, options)
          break
        } catch (_) {}
      }
      if (!recorder) throw new Error('AI 特效：无法创建录制器')
      recorder.ondataavailable = (event) => {
        if (event && event.data && event.data.size > 0) chunks.push(event.data)
      }
      const stopped = new Promise(resolve => { recorder.onstop = () => resolve() })
      recorder.start()
      const hold = Math.max(1, Math.round(1000 / SEQUENCE_FPS))
      for (let index = 0; index < frames.length; index += 1) {
        // Black first, every frame: that is the whole point of this path.
        context.fillStyle = '#000000'
        context.fillRect(0, 0, width, height)
        context.drawImage(frames[index], 0, 0, width, height)
        if (index % 12 === 0) {
          setStatus('正在合成', '第 ' + (index + 1) + ' / ' + frames.length + ' 帧')
          refreshUi()
        }
        await new Promise(resolve => window.setTimeout(resolve, hold))
      }
      try { recorder.requestData() } catch (_) {}
      recorder.stop()
      await stopped
      try { stream.getTracks().forEach(track => { try { track.stop() } catch (_) {} }) } catch (_) {}
      for (const frame of frames) {
        if (frame && typeof frame.close === 'function') {
          try { frame.close() } catch (_) {}
        }
      }
      const blob = new Blob(chunks, { type: 'video/webm' })
      if (!blob.size) throw new Error('AI 特效：序列帧合成失败')
      return blob
    } finally {
      for (const url of revokeList) {
        try { URL.revokeObjectURL(url) } catch (_) {}
      }
    }
  }

  // One entry point for the dropzone and the file picker: a clip goes straight
  // in, a pile of stills is composited first.
  const adoptTemplateFiles = async (list) => {
    const files = Array.from(list || [])
    if (!files.length) throw new Error('AI 特效：请拖入一段视频素材，或一组序列帧')
    const clip = firstFileOf(files, CLIP_TYPES)
    if (clip) return adoptSource(clip, clip.name)
    const stills = files.filter(file => SEQUENCE_TYPES.test(file.type) || SEQUENCE_TYPES.test(file.name))
    if (!stills.length) throw new Error('AI 特效：请拖入一段视频素材，或一组序列帧')
    if (stills.length < 2) throw new Error('AI 特效：序列帧至少要两张，单张图请放到参考图那里')
    const ordered = sortSequence(stills)
    const blob = await sequenceToBlackClip(ordered)
    const stem = String(ordered[0].name || 'sequence').replace(/[._-]?\d+\.[a-z0-9]+$/i, '') || 'sequence'
    return adoptSource(blob, stem + '.webm')
  }

  const firstFileOf = (list, accept) => {
    for (const file of Array.from(list || [])) {
      if (!accept || accept.test(file.type) || accept.test(file.name)) return file
    }
    return null
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
    refs.previewProgress = root.querySelector('[data-preview-progress]')
    refs.previewProgressFill = root.querySelector('[data-preview-progress-fill]')
    root.querySelector('[data-action="cancel-generate"]')?.addEventListener('click', cancelGenerate)
    refs.materialItems = root.querySelector('[data-material-items]')
    refs.materialStatus = root.querySelector('[data-material-status]')
    refs.openStyle = root.querySelector('[data-action="open-style-library"]')
    refs.openTemplate = root.querySelector('[data-action="open-template-library"]')
    refs.library = root.querySelector('[data-library]')
    refs.libraryBody = root.querySelector('[data-library-body]')
    refs.libraryTitle = root.querySelector('[data-library-title]')
    refs.librarySave = root.querySelector('[data-library-save]')
    refs.librarySaveName = root.querySelector('[data-library-save-name]')
    refs.effectType = root.querySelector('[data-effect-type]')
    refs.frameLabel = root.querySelector('[data-frame-label]')
    refs.timeline = root.querySelector('[data-action="timeline"]')
    refs.generate = root.querySelector('[data-action="generate"]')
    refs.templateInput = root.querySelector('[data-template-input]')
    refs.styleInput = root.querySelector('[data-style-input]')
    refs.templateMeta = root.querySelector('[data-template-meta]')
    refs.supplement = root.querySelector('[data-action="prompt-supplement"]')
    refs.templateZone = root.querySelector('[data-template-zone]')
    refs.templatePreview = root.querySelector('[data-template-preview]')
    refs.templateClearX = document.createElement('button')
    refs.templateClearX.type = 'button'
    refs.templateClearX.textContent = '×'
    refs.templateClearX.title = '清空'
    refs.templateClearX.setAttribute('aria-label', '清空')
    refs.templateClearX.setAttribute('data-template-clear-x', '')
    refs.styleZone = root.querySelector('[data-style-zone]')
    refs.materialCredit = root.querySelector('[data-aifx-material-credit]')
    refs.materialSettlement = root.querySelector('[data-aifx-material-settlement]')
    refs.materialModelHost = root.querySelector('[data-aifx-material-model]')
    refs.materialModelSlot = root.querySelector('[data-aifx-material-model-slot]')
    ensureMaterialPicker()
    refs.templateEmpty = root.querySelector('[data-template-empty]')
    refs.templateDetected = root.querySelector('[data-template-detected]')
    refs.playButton = root.querySelector('[data-action="play"]')
    refs.candidates = root.querySelector('[data-candidates]')
    refs.seedLock = root.querySelector('[data-action="lock-seed"]')
    refs.candidateCount = root.querySelector('[data-action="candidates"]')
    refs.candidateCountValue = root.querySelector('[data-candidates-value]')
    renderMaterialBoard()
    syncSectionOpen(root)

    for (const toggle of Array.from(root.querySelectorAll('[data-section-toggle]'))) {
      toggle.addEventListener('click', () => {
        const key = toggle.getAttribute('data-section-toggle') || ''
        if (!key) return
        state.sectionOpen[key] = state.sectionOpen[key] === false
        syncSectionOpen(root)
      })
    }

    // 「返回粒子特效」按钮已取消（特效 = AI 特效，2026-10-16）：有就挂，没有跳过
    root.querySelector('[data-action="close"]')?.addEventListener('click', closeApp)
    const IMAGE_TYPES = /image\//

    root.querySelector('[data-action="pick-template"]')
      .addEventListener('click', () => refs.templateInput?.click())
    root.querySelector('[data-action="pick-style"]')
      .addEventListener('click', () => refs.styleInput?.click())
    refs.templateInput?.addEventListener('change', guard(async () => {
      const files = Array.from(refs.templateInput.files || [])
      refs.templateInput.value = ''
      if (files.length) await adoptTemplateFiles(files)
    }))
    refs.styleInput?.addEventListener('change', guard(async () => {
      const files = Array.from(refs.styleInput.files || [])
      refs.styleInput.value = ''
      if (files.length) await adoptReferences(files)
    }))

    refs.openTemplate.addEventListener('click', guard(() => { openLibrary('template') }))
    root.querySelector('[data-action="open-template-maker"]').addEventListener('click', guard(() => openTemplateMaker()))
    refs.openStyle.addEventListener('click', guard(() => { openLibrary('style') }))
    root.querySelector('[data-action="close-library"]')
      .addEventListener('click', guard(() => { closeLibrary() }))
    // Clicking the mask closes it, the way every other modal here behaves.
    refs.library.addEventListener('click', guard((event) => {
      if (event.target !== refs.library) return
      if (refs.librarySave && !refs.librarySave.hidden) closeLibrarySaveDialog()
      else closeLibrary()
    }))
    root.querySelector('[data-action="library-save-cancel"]')
      .addEventListener('click', guard(() => { closeLibrarySaveDialog() }))
    root.querySelector('[data-action="library-save-confirm"]')
      .addEventListener('click', guard(() => confirmLibrarySave()))
    refs.librarySaveName.addEventListener('keydown', guard((event) => {
      if (event.key === 'Enter' || event.key === 'Return' || event.keyCode === 13) {
        event.preventDefault()
        return confirmLibrarySave()
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeLibrarySaveDialog()
      }
      return undefined
    }))
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !isAifxAppOpen() || !refs.library || refs.library.hidden) return
      if (refs.librarySave && !refs.librarySave.hidden) closeLibrarySaveDialog()
      else closeLibrary()
    })
    // Space plays and pauses the timeline whatever has focus. Without this it only "pressed" the
    // last thing clicked: the play button after a click on it, a candidate card after picking one -
    // which picked the card again instead. Typing and the library dialog keep their Space.
    const isSpace = (event) => event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
    const typingIn = (node) => node instanceof Element && Boolean(node.closest(
      'textarea, select, [contenteditable=""], [contenteditable="true"], input:not([type]), '
      + 'input[type="text"], input[type="search"], input[type="number"], input[type="email"], input[type="url"]'))
    let spaceTaken = false
    document.addEventListener('keydown', (event) => {
      if (!isSpace(event) || !isAifxAppOpen() || typingIn(event.target)) return
      if (refs.library && !refs.library.hidden) return
      event.preventDefault()
      event.stopPropagation()
      spaceTaken = true
      if (!event.repeat) togglePlayback()
    }, true)
    // A focused button fires its click on keyup; the press above already did the job.
    document.addEventListener('keyup', (event) => {
      if (!spaceTaken || !isSpace(event)) return
      spaceTaken = false
      event.preventDefault()
      event.stopPropagation()
    }, true)
    // Everything above is bound; moving the node keeps its listeners and lets
    // the mask escape the shell's stacking context.
    document.body.appendChild(refs.library)
    root.querySelector('[data-action="clear-template"]')
      .addEventListener('click', guard(() => { clearTemplate() }))
    // The same clear as 清空; stopped here so the zone does not open the picker.
    refs.templateClearX.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (!state.isGenerating) clearTemplate()
    })
    root.querySelector('[data-action="generate"]')
      .addEventListener('click', guard(() => runGenerate()))
    refs.playButton?.addEventListener('click', guard(() => togglePlayback()))

    for (const dropzone of Array.from(root.querySelectorAll('[data-nf-upload-dropzone]'))) {
      const wantsClip = dropzone.getAttribute('data-action') === 'pick-template'
      dropzone.removeAttribute('aria-disabled')
      dropzone.addEventListener('dragover', (event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        dropzone.classList.add('is-dragover')
      })
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'))
      dropzone.addEventListener('drop', guard(async (event) => {
        dropzone.classList.remove('is-dragover')
        if (wantsClip) {
          await adoptTemplateFiles(event.dataTransfer?.files)
          return
        }
        if (!firstFileOf(event.dataTransfer?.files, IMAGE_TYPES)) throw new Error('AI 特效：请拖入图片')
        await adoptReferences(event.dataTransfer?.files)
      }))
    }

    refs.supplement?.addEventListener('input', () => {
      state.supplement = String(refs.supplement.value || '')
      // Typing here now decides three things - whether 生成 is allowed at all
      // with no style, which denoise the run gets, and what the 材质来源 line
      // says - so the panel has to follow the keystrokes.
      refreshUi()
    })
    refs.seedLock?.addEventListener('click', toggleSeedLock)
    refs.candidateCount?.addEventListener('input', () => {
      state.candidateCount = Number(refs.candidateCount.value) || 1
      refreshUi()
    })
    refs.timeline?.addEventListener('input', () => {
      stopPlayback()
      state.playhead = Number(refs.timeline.value) || 0
      refreshUi()
      drawPreview()
    })

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

  // refreshUi runs on every preview frame. Writing an unchanged value still
  // records a mutation (title, disabled, hidden, text), and each one sends the
  // host's observers into a full pass, so only changed values are written.
  const put = (node, key, value) => { if (node && node[key] !== value) node[key] = value }
  const putAttr = (node, name, value) => { if (node && node.getAttribute(name) !== value) node.setAttribute(name, value) }

  const refreshUi = () => {
    const refs = state.refs
    if (!refs.root) return
    const restyle = RESTYLE()
    const statusText = String(state.status || IDLE_STATUS).trim() || IDLE_STATUS
    const detailText = String(state.detail || '').trim()
    put(refs.previewStatusTitle, 'textContent', statusText)
    put(refs.previewStatusDetail, 'textContent', detailText)
    if (ensureMaterialPicker()) materialPicker.sync()
    const materialCreditLine = materialCreditText()
    put(refs.materialCredit, 'textContent', materialCreditLine)
    put(refs.materialCredit, 'hidden', !materialCreditLine)
    // What the reads actually charged, added up over the pictures.
    const settled = isLocalMaterialModel(materialModelId) ? []
      : state.references.filter((entry) => entry.materialState === 'ready' && entry.materialQuota).map((entry) => entry.materialQuota)
    const charged = settled.reduce((sum, quota) => sum + Number(quota.charged_credits != null ? quota.charged_credits : quota.settled_credits || 0), 0)
    const settledQuota = settled.length ? { charged_credits: formatCredits(charged), balance_after: settled[settled.length - 1].balance_after } : null
    put(refs.materialSettlement, 'textContent', window.NovaFlowFeatureCreditPrices?.settlementText?.(settledQuota) || '')
    if (refs.previewStatus) {
      // Centred only while there is nothing on the canvas to cover.
      putAttr(refs.previewStatus, 'data-placement', state.source ? 'top' : 'center')
      // The overlay is an empty-state and an error surface, not a permanent
      // banner: once there is something on the canvas it gets out of the way.
      const hasPixels = frameCount() > 0
      // ... except a failure: with frames on the canvas an error would otherwise never be seen.
      put(refs.previewStatus.style, 'display', hasPixels && !state.isGenerating && statusText !== '出错了' ? 'none' : '')
      putAttr(refs.previewStatus, 'data-tone', statusText === '出错了' ? 'warning' : 'idle')
      putAttr(refs.previewStatus, 'title', [statusText, detailText].filter(Boolean).join(' · '))
    }
    put(refs.previewProgress, 'hidden', !state.isGenerating)
    if (refs.previewProgressFill) {
      put(refs.previewProgressFill.style, 'width', (clamp(Number(state.progress) || 0, 0, 1) * 100).toFixed(1) + '%')
    }

    const total = frameCount()
    if (refs.timeline) {
      put(refs.timeline, 'max', String(Math.max(0, total - 1)))
      put(refs.timeline, 'value', String(Math.min(state.playhead, Math.max(0, total - 1))))
      put(refs.timeline, 'disabled', total < 2)
    }
    if (refs.frameLabel) {
      put(refs.frameLabel, 'textContent', total ? `${Math.min(state.playhead + 1, total)} / ${total}` : '0 / 0')
    }
    if (refs.playButton) {
      // Rebuilt only when play / pause flips, not on every frame.
      if (refs.playButton.dataset.aifxPlayIcon !== (state.playing ? 'pause' : 'play')) {
        refs.playButton.dataset.aifxPlayIcon = state.playing ? 'pause' : 'play'
        // The host draws the playback icon from the button's title.
        refs.playButton.title = state.playing ? '暂停' : '播放'
        refs.playButton.setAttribute('aria-label', state.playing ? '暂停' : '播放')
        refs.playButton.innerHTML = state.playing
          ? '<i class="fas fa-pause" aria-hidden="true"></i>'
          : '<i class="fas fa-play" aria-hidden="true"></i>'
      }
      put(refs.playButton, 'disabled', total < 2)
    }
    if (refs.generate) {
      const chosen = state.references.length > 0 || Boolean(restyle && restyle.getPreset(state.attribute))
        || Boolean(String(state.supplement || '').trim())
      put(refs.generate, 'disabled', state.isGenerating || !state.source || !restyle || !chosen)
      put(refs.generate, 'textContent', state.isGenerating ? '生成中…' : '生成特效')
    }
    if (refs.templateMeta) {
      const saved = state.userTemplates.find(item => item.id === state.userTemplateId)
      const shown = saved ? saved.label : state.source ? state.source.fileName : ''
      const restyle = RESTYLE()
      const notes = []
      if (state.source && restyle) {
        // H3 samples at most 73 frames however long the clip is, so past ~3s
        // the same 73 frames get spread thinner and the result plays choppy.
        // The artist cannot see that coming from the source's own frame rate.
        const timing = restyle.timingFor(state.source.duration)
        const fps = Math.min(60, timing.fps)
        if (fps < 20) notes.push(`结果 ${timing.length} 帧 · ${fps.toFixed(0)}fps，会卡顿，建议裁短`)
        // Generation follows the source's size, but only up to a point. Every
        // size also gets aligned to a multiple of 32, and saying so for a
        // 322x320 clip is noise - only the cap is worth reporting.
        if (Math.max(state.source.width, state.source.height) > restyle.MAX_GENERATION_SIDE) {
          const size = restyle.generationSize(state.source.width, state.source.height)
          notes.push(`生成 ${size.width}×${size.height}`)
        }
      }
      put(refs.templateMeta, 'textContent', state.source
        ? [`${shown} · ${state.source.width}×${state.source.height} · ${state.sourceFrames.length} 帧`]
          .concat(notes).join(' · ')
        : '')
    }
    put(refs.templateEmpty, 'textContent', state.source ? '✓' : '+')
    // Rebuilt only when the file changes: refreshUi runs on every playhead
    // tick and a recreated <video> would restart on each one.
    syncDropzonePreview(refs.templateZone, refs.templatePreview, state.source, (entry) => {
      const video = document.createElement('video')
      video.muted = true
      video.loop = true
      video.playsInline = true
      video.autoplay = true
      video.src = entry.objectUrl
      return video
    })
    // The preview is rebuilt on a new file, which drops the ×; put it back.
    if (refs.templateClearX && refs.templatePreview && refs.templateClearX.parentElement !== refs.templatePreview) {
      refs.templatePreview.appendChild(refs.templateClearX)
    }
    // 风格库's pick and the uploaded pictures sit together and are blended; neither gives way.
    renderMaterialBoard()
    syncSupplementMentions()
    put(refs.openStyle, 'disabled', state.isGenerating)
    put(refs.openTemplate, 'disabled', state.isGenerating)
    if (refs.supplement) {
      if (refs.supplement.value !== state.supplement) refs.supplement.value = state.supplement
      put(refs.supplement, 'disabled', state.isGenerating)
    }
    // Detection is not a control any more - the artist uploads and the panel
    // reads the clip - but what it read is still shown, so an odd result has
    // an explanation.
    if (refs.templateDetected) {
      put(refs.templateDetected, 'textContent', state.source && state.shapeAuto
        ? '已识别：' + state.shapeAuto + (state.lifecycleAuto ? ' · ' + state.lifecycleAuto : '')
        : '')
    }
    if (refs.seedLock) {
      const locked = state.lockedSeed != null
      put(refs.seedLock, 'hidden', !state.candidates.length)
      put(refs.seedLock, 'disabled', state.isGenerating)
      if (refs.seedLock.classList.contains('is-on') !== locked) refs.seedLock.classList.toggle('is-on', locked)
      put(refs.seedLock, 'textContent', locked ? '已锁定这版种子 · 点此解锁' : '以这版为准再生成')
    }
    if (refs.candidateCount) {
      put(refs.candidateCount, 'value', String(state.candidateCount))
      put(refs.candidateCountValue, 'textContent', String(state.candidateCount))
      put(refs.candidateCount, 'disabled', state.isGenerating)
    }
    if (refs.effectType && restyle) {
      // The style card above already says where the material comes from, so
      // this line only carries what it cannot: that the picked style has not
      // been render-checked.
      const preset = restyle.getPreset(state.attribute)
      put(refs.effectType, 'textContent', !state.references.length && preset && !preset.verified
        ? preset.label + ' 尚未逐条验证，可多出几个候选'
        : '')
    }
    syncAllRangeProgress()
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

    const pickFrame = (frames) => {
      if (!frames.length) return null
      // The two sequences can differ in length (the source is sampled for
      // preview, the result comes back at its own frame count), so scrub by
      // normalised position rather than by index.
      const total = Math.max(1, frameCount())
      const ratioAlong = total > 1 ? state.playhead / (total - 1) : 0
      return frames[Math.min(frames.length - 1, Math.round(ratioAlong * (frames.length - 1)))]
    }

    const blit = (frame, x, y, boxWidth, boxHeight) => {
      if (!frame) return
      const frameWidth = frame.naturalWidth || frame.width
      const frameHeight = frame.naturalHeight || frame.height
      if (!frameWidth || !frameHeight) return
      const scale = Math.min(boxWidth / frameWidth, boxHeight / frameHeight)
      const drawWidth = frameWidth * scale
      const drawHeight = frameHeight * scale
      ctx.drawImage(frame, x + (boxWidth - drawWidth) / 2, y + (boxHeight - drawHeight) / 2,
        drawWidth, drawHeight)
    }

    const caption = (text, x, y, boxWidth) => {
      ctx.fillStyle = 'rgba(230, 230, 230, 0.72)'
      ctx.font = (12 * ratio) + 'px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(text, x + boxWidth / 2, y + 18 * ratio)
    }

    const inset = 16 * ratio
    const boxWidth = width - inset * 2
    const boxHeight = height - inset * 2

    if (state.previewMode === 'compare' && state.sourceFrames.length && state.resultFrames.length) {
      const half = (boxWidth - inset) / 2
      blit(pickFrame(state.sourceFrames), inset, inset, half, boxHeight)
      blit(pickFrame(state.resultFrames), inset + half + inset, inset, half, boxHeight)
      caption('原素材', inset, inset, half)
      caption('生成结果', inset + half + inset, inset, half)
      return
    }

    const frames = state.previewMode === 'template'
      ? state.sourceFrames
      : (state.resultFrames.length ? state.resultFrames : state.sourceFrames)
    blit(pickFrame(frames), inset, inset, boxWidth, boxHeight)
  }

  // --- export ------------------------------------------------------------------
  // The brand runtime owns the 导出 dialog. Opened over this panel it locks the
  // modal to the "aifx" context and hands the confirmed mode, name and format
  // here (dispatchExport), and it reads getState() first to know whether there
  // is anything to export. The files go through the same main-process IPCs the
  // video board uses, so a result exports exactly like a video dropped on that
  // board: the result mp4's own bytes go to ffmpeg as-is (sourceConvert) for
  // mp4 / webm / gif at the source frame rate, and 序列帧 writes the keyed RGBA
  // PNGs the panel already produces for its own preview.
  const exportApi = () => {
    const api = window.electronAPI
    if (!api || typeof api.writeBinaryFile !== 'function') {
      throw new Error('AI 特效：导出仅支持桌面版')
    }
    return api
  }

  const joinPath = (dir, name) => {
    const base = String(dir || '')
    if (/[\\/]$/.test(base)) return base + name
    return base + (base.includes('\\') ? '\\' : '/') + name
  }

  const resultVideoUrl = () => {
    const videos = state.result && Array.isArray(state.result.videos) ? state.result.videos : []
    return videos.length ? String(videos[0]) : ''
  }

  const resultVideoBytes = async () => {
    const url = resultVideoUrl()
    if (!url) throw new Error('AI 特效：这个结果没有视频文件')
    const response = await fetch(url)
    if (!response.ok) throw new Error('AI 特效：读取结果视频失败 (' + response.status + ')')
    return new Uint8Array(await response.arrayBuffer())
  }

  const pngBytes = (canvas) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('AI 特效：PNG 编码失败'))
        return
      }
      blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject)
    }, 'image/png')
  })

  const exportBaseName = (options) => {
    const name = String(options && options.name || '').trim()
    return name || 'foart_aifx'
  }

  // 画板上的原素材文件（没有生成结果时导出它）
  const sourceVideoBytes = async () => {
    const blob = state.source && state.source.blob
    if (!(blob instanceof Blob)) throw new Error('AI 特效：这份素材没有视频文件，请用序列帧导出')
    return new Uint8Array(await blob.arrayBuffer())
  }

  const exportResultVideo = async (options = {}, fromSource = false) => {
    const api = exportApi()
    for (const method of ['exportPickSaveFile', 'exportCreateTempDir', 'exportEncodeVideoToVideo', 'exportCleanupDir']) {
      if (typeof api[method] !== 'function') throw new Error('AI 特效：导出仅支持桌面版')
    }
    const format = options.format === 'webm' || options.format === 'gif' ? options.format : 'mp4'
    const pick = await api.exportPickSaveFile({ baseName: exportBaseName(options), format })
    if (pick && pick.canceled) return { canceled: true }
    if (!pick || !pick.filePath) throw new Error('AI 特效：没有选择保存位置')
    const scale = Number(options.scalePct)
    const scalePct = Number.isFinite(scale) && scale > 0 ? Math.max(10, Math.min(200, Math.round(scale))) : 100
    setStatus('导出中', fromSource ? '正在读取素材视频…' : '正在读取结果视频…')
    const bytes = fromSource ? await sourceVideoBytes() : await resultVideoBytes()
    let dir = ''
    try {
      const temp = await api.exportCreateTempDir({ prefix: 'novaflow_aifx_vid_' })
      if (!temp || temp.ok === false || !temp.dir) {
        throw new Error(String((temp && temp.error) || 'AI 特效：创建临时目录失败'))
      }
      dir = String(temp.dir)
      const written = await api.writeBinaryFile({ dir, fileName: 'aifx_result.mp4', bytes })
      if (written && written.ok === false) throw new Error(String(written.error || 'AI 特效：写入临时文件失败'))
      setStatus('导出中', '正在转换为 ' + format.toUpperCase() + '…')
      const encoded = await api.exportEncodeVideoToVideo({
        inPath: joinPath(dir, 'aifx_result.mp4'),
        outPath: String(pick.filePath),
        format,
        fps: 24,
        scalePct,
        // The source's own bytes, its own frame rate: this is the video board's
        // format-conversion branch, not a re-render.
        sourceConvert: true,
        keepAlpha: false,
        novaflowTrace: { tool: 'aifx', source: 'export-aifx', kind: 'aifx-result-video-convert' },
      })
      if (encoded && encoded.ok === false) throw new Error(String(encoded.error || 'AI 特效：导出失败'))
    } finally {
      if (dir) {
        try { await api.exportCleanupDir({ dir }) } catch (_) {}
      }
    }
    setStatus('完成', '已导出 ' + format.toUpperCase() + '：' + String(pick.filePath))
    return { canceled: false, filePath: String(pick.filePath), format }
  }

  const exportResultSequence = async (options = {}, shownFrames = null) => {
    const api = exportApi()
    if (typeof api.pickDirectory !== 'function') throw new Error('AI 特效：导出仅支持桌面版')
    const client = CLIENT()
    if (!client) throw new Error('AI 特效：导出模块未加载')
    const pick = await api.pickDirectory()
    if (pick && pick.canceled) return { canceled: true }
    if (!pick || !pick.dir) throw new Error('AI 特效：没有选择文件夹')
    const dir = String(pick.dir)
    const baseName = exportBaseName(options)
    const frames = shownFrames || state.result.frames
    const total = frames.length
    const digits = Math.max(4, String(total).length)
    // 透明背景 is the point of the panel, so it is the default; the dialog can
    // still ask for the frames as rendered, on black.
    const transparent = options.transparent !== false
    for (let index = 0; index < total; index += 1) {
      setStatus('导出中', '正在写入序列帧 ' + (index + 1) + '/' + total)
      const image = typeof frames[index] === 'string' ? await client.loadImage(frames[index]) : frames[index]
      let canvas
      if (transparent) {
        canvas = client.keyFrameToRgba(image, {})
      } else {
        canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth || image.width
        canvas.height = image.naturalHeight || image.height
        canvas.getContext('2d').drawImage(image, 0, 0)
      }
      const fileName = baseName + '_' + String(index + 1).padStart(digits, '0') + '.png'
      const written = await api.writeBinaryFile({ dir, fileName, bytes: await pngBytes(canvas) })
      if (written && written.ok === false) throw new Error(String(written.error || ('AI 特效：写入 ' + fileName + ' 失败')))
    }
    setStatus('完成', '已导出 ' + total + ' 张' + (transparent ? '透明' : '') + '序列帧到 ' + dir)
    return { canceled: false, dir, count: total, transparent }
  }

  // 导出画板上显示的东西（2026-10-16 用户：没有生成也能导出）：和 drawPreview 一样——
  // 模板预览 / 还没生成 = 原素材，有生成结果（对比 / 结果）= 结果
  const exportTarget = () => {
    const hasResult = Boolean(state.result && Array.isArray(state.result.frames) && state.result.frames.length)
    const hasSource = Array.isArray(state.sourceFrames) && state.sourceFrames.length > 0
    if (hasResult && state.previewMode !== 'template') return { kind: 'result', frames: state.result.frames }
    if (hasSource) return { kind: 'source', frames: state.sourceFrames }
    if (hasResult) return { kind: 'result', frames: state.result.frames }
    return null
  }

  const dispatchExport = async (mode, options = {}) => {
    if (state.isGenerating) throw new Error('AI 特效正在生成，请完成后再导出')
    const target = exportTarget()
    if (!target) throw new Error('AI 特效：画板上还没有可导出的内容')
    const kind = String(mode || 'final')
    if (kind === 'video') return exportResultVideo(options, target.kind === 'source')
    if (kind === 'final' || kind === 'seq') return exportResultSequence(options, target.frames)
    if (kind === 'spine') throw new Error('AI 特效暂不支持 Spine 导出，请用序列帧或视频')
    throw new Error('AI 特效：未知的导出方式 ' + kind)
  }

  // What the brand runtime's availability check reads before it opens the
  // dialog: a result and its frames.
  const exportState = () => {
    const target = exportTarget()
    return {
      ...state,
      finalProduct: target
        ? { video: target.kind === 'result' ? resultVideoUrl() : String((state.source && state.source.objectUrl) || ''), frameCount: target.frames.length, source: target.kind }
        : null,
      generatedFrames: target ? target.frames : [],
    }
  }

  const openApp = async (trigger) => {
    uiTraceCurrent('CurrentAifxRuntimePanel', { phase: 'openApp' })
    cancelScheduledHostScrollFreeze()
    const root = mount()
    if (!root.classList.contains('is-open')) {
      // 进入时「特效模板」默认打开，其他组收起（2026-10-16 用户）
      for (const key of Object.keys(state.sectionOpen)) state.sectionOpen[key] = key === 'template'
      syncSectionOpen(root)
    }
    updateShellInset(trigger)
    freezeHostLeftScroll()
    applyHostTabVisuals(trigger)
    document.body.classList.remove(LEAVING_CLASS)
    unfreezeShellGeometry()
    document.body.classList.add('novaflow-aifx-open')
    root.classList.add('is-open')
    scheduleHostScrollFreeze(root)
    refreshUi()
    drawPreview()
  }

  const hideApp = (options = {}) => {
    stopPrimaryLeaveWatch()
    closeLibrary()
    window.__NovaFlowAifxLastHide = { reason: String(options.reason || 'unspecified'), at: Math.round(performance.now()) }
    window.__NovaFlowAifxExportIntentUntil = 0
    cancelScheduledHostScrollFreeze()
    syncPreviewMode()
    state.refs.root?.classList.remove('is-open')
    document.body.classList.remove('novaflow-aifx-open')
    document.body.classList.remove(LEAVING_CLASS)
    unfreezeShellGeometry()
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
      const insideShell = Boolean(root && root.contains(event.target))
        || Boolean(state.refs.library && state.refs.library.contains(event.target))
      if (root?.classList.contains('is-open') && isProtectedExportInteraction(event.target)) return
      if (action && isTopMenuLabel(action.textContent)) {
        hideApp()
        return
      }
      if (root?.classList.contains('is-open') && !insideShell) {
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
        // Nothing else outside the shell leaves it: the top bar, the rail's gaps and 仓库, or the click a
        // drag out of the shell ends with, all hid it while the AI特效 entry stayed selected.
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

  const notYet = (name) => async () => {
    const error = new Error('AI 特效：' + name + ' 尚未接线')
    error.code = 'AIFX_NOT_WIRED'
    throw error
  }

  window.NovaFlowAifxMvp = {
    pipeline: PIPELINE_ID,
    source: RUNTIME_SOURCE,
    open: openApp,
    hide: hideApp,
    close: closeApp,
    isOpen: isAifxAppOpen,
    // Debug and smoke-test surface: the preview server can drive the whole
    // panel through these without synthesising pointer events.
    setAttribute: (id) => { state.attribute = String(id || ''); refreshUi() },
    setStrength: (value) => { state.strength = Number(value); refreshUi() },
    setSupplement: (value) => { state.supplement = String(value || ''); refreshUi() },
    setShape: (value) => { state.shapeArchetype = String(value || ''); refreshUi() },
    detectedShape: () => ({
      archetype: state.shapeArchetype,
      label: state.shapeAuto,
      phrase: currentShape(),
      lifecycle: state.lifecycle,
      lifecycleLabel: state.lifecycleAuto,
    }),
    setLifecycle: (value) => { state.lifecycle = String(value || ''); refreshUi() },
    setCandidateCount: (value) => { state.candidateCount = Number(value) || 1; refreshUi() },
    selectCandidate,
    loadSourceBlob: (blob, fileName) => adoptSource(blob, fileName),
    loadSourceFiles: (files) => adoptTemplateFiles(files),
    sequenceToBlackClip,
    loadStyleBlob: (blob, fileName) => adoptReference(blob, fileName),
    loadStyleFiles: (files) => adoptReferences(files),
    removeReference: (index) => { const entry = state.references[index]; if (entry) removeReference(entry) },
    materialModel,
    setMaterialModel,
    materialCreditText,
    recognizeMaterial: (blob, image) => readReferenceMaterial(blob, image).then((read) => ({
      read,
      model: materialMeta.get(blob)?.model || activeMaterialModel(),
      quota: materialMeta.get(blob)?.quota || null,
      error: materialMeta.get(blob)?.error || '',
    })),
    translateSupplement,
    clearTemplate,
    clearReferences,
    openLibrary,
    closeLibrary,
    saveCurrentAsTemplate,
    deleteTemplate,
    renameTemplate,
    loadUserTemplate,
    listTemplates: () => ({
      user: state.userTemplates.map(({ data, objectUrl, ...item }) => ({ ...item })),
    }),
    addTemplate,
    openTemplateMaker,
    runProductionPipeline: runGenerate,
    cancel: cancelGenerate,
    agentResultFile: async () => {
      if(!state.result||!state.resultFrames.length)throw new Error('AI特效没有真实的生成结果');
      return {name:'aifx-result-'+String(state.candidates[state.selectedCandidate]?.seed||0)+'.mp4',blob:new Blob([await resultVideoBytes()],{type:'video/mp4'})};
    },
    agentFiles: async (format) => {
      const target=exportTarget();if(!target||state.isGenerating)throw new Error('特效没有可导出的实际结果');
      if(format==='video')return [{name:exportBaseName({})+'.mp4',blob:new Blob([target.kind==='result'?await resultVideoBytes():await sourceVideoBytes()],{type:'video/mp4'})}];
      if(format!=='seq')throw new Error('特效导出格式无效');
      const files=[];for(let i=0;i<target.frames.length;i++){const image=typeof target.frames[i]==='string'?await CLIENT().loadImage(target.frames[i]):target.frames[i],canvas=CLIENT().keyFrameToRgba(image,{});files.push({name:exportBaseName({})+'_'+String(i+1).padStart(4,'0')+'.png',blob:new Blob([await pngBytes(canvas)],{type:'image/png'})});}return files;
    },
    exportRgbaFrames: async (options) => {
      const client = CLIENT()
      if (!client) throw new Error('AI 特效：导出模块未加载')
      if (!state.result) throw new Error('AI 特效：还没有可导出的结果')
      return client.keyFrames(state.result.frames, options || {})
    },
    dispatchExport,
    exportSpineProject: notYet('exportSpineProject'),
    applyToProject: notYet('applyToProject'),
    pureHelpers: Object.freeze({ decodeClipFrames }),
    getState: exportState,
  }
})()
