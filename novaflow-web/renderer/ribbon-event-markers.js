(() => {
  if (window.__novaFlowRibbonEventMarkersInstalled) return
  window.__novaFlowRibbonEventMarkersInstalled = true

  const TEXT = {
    boneAnimation: '\u9aa8\u9abc\u52a8\u753b',
    boneTree: '\u9aa8\u9abc\u6811',
    ribbonCalc: '\u98d8\u5e26\u8ba1\u7b97',
    addCurrentTime: '\u6dfb\u52a0\u5f53\u524d\u65f6\u95f4',
    clearEvents: '\u6e05\u7a7a\u4e8b\u4ef6\u70b9',
    ribbonEvents: '\u98d8\u5e26\u4e8b\u4ef6\u70b9',
    remove: '\u5220\u9664',
    noEvents: '\u6682\u65e0\u4e8b\u4ef6\u70b9',
    cleared: '\u5df2\u6e05\u7a7a\u98d8\u5e26\u4e8b\u4ef6\u70b9'
  }
  const RIBBON_STATUS_LABELS = [
    '\u5f53\u524d\u9aa8\u9abc',
    '\u591a\u9009\u9aa8\u9abc',
    '\u5f53\u524d\u9aa8\u94fe',
    '\u5f53\u524d\u52a8\u753b',
    '\u5199\u5165\u65b9\u5f0f'
  ]

  const state = {
    overlay: null,
    scheduled: false,
    lastEventEntries: []
  }

  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

  const isVisible = (element) => {
    if (!(element instanceof Element)) return false
    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  const parseNumber = (value) => {
    const next = Number.parseFloat(String(value))
    return Number.isFinite(next) ? next : null
  }

  const visibleButtons = () => Array.from(document.querySelectorAll('button')).filter(isVisible)

  const findButton = (label) =>
    visibleButtons().find((button) => normalizeText(button.textContent).includes(label)) || null

  const isBoneAnimationView = () => {
    const boneButton = Array.from(document.querySelectorAll('button')).find(
      (button) => normalizeText(button.textContent) === TEXT.boneAnimation
    )
    if (!boneButton || !isVisible(boneButton)) return false
    const pressed = boneButton.getAttribute('aria-pressed')
    const selected = boneButton.getAttribute('aria-selected')
    const current = boneButton.getAttribute('aria-current')
    if (pressed === 'true' || selected === 'true' || current === 'page') return true
    const pageText = normalizeText(document.body.textContent)
    return pageText.includes(TEXT.boneTree) && pageText.includes(TEXT.ribbonCalc)
  }

  const visibleRanges = (scope = document) =>
    Array.from(scope.querySelectorAll('input[type="range"]')).filter(isVisible)

  const hideRibbonStatusNotes = () => {
    const candidates = Array.from(document.querySelectorAll('div')).filter((node) => {
      if (!(node instanceof HTMLElement)) return false
      if (node.dataset.novaflowRibbonStatusHidden === 'true') return false
      if (node.querySelector('button,input,select,textarea')) return false
      const text = normalizeText(node.textContent)
      if (text.length > 260) return false
      const hitCount = RIBBON_STATUS_LABELS.filter((label) => text.includes(label)).length
      return hitCount >= 3
    })

    for (const node of candidates) {
      node.dataset.novaflowRibbonStatusHidden = 'true'
      node.style.display = 'none'
    }
  }

  const findTimelineSlider = () => {
    let best = null
    let bestScore = -Infinity
    for (const input of visibleRanges()) {
      const rect = input.getBoundingClientRect()
      if (rect.width < 140) continue
      const score = rect.width * 2 + rect.top * 0.25
      if (score > bestScore) {
        best = input
        bestScore = score
      }
    }
    return best
  }

  const findRibbonPanel = () => {
    const anchor = findButton(TEXT.addCurrentTime) || findButton(TEXT.clearEvents)
    if (!anchor) return null
    let current = anchor.parentElement
    while (current && current !== document.body) {
      if (normalizeText(current.textContent).includes(TEXT.ribbonEvents)) return current
      current = current.parentElement
    }
    return anchor.parentElement
  }

  const findEventCardForSlider = (slider) => {
    let current = slider.parentElement
    while (current && current !== document.body) {
      const ranges = visibleRanges(current)
      const hasDelete = Array.from(current.querySelectorAll('button')).some(
        (button) => isVisible(button) && normalizeText(button.textContent) === TEXT.remove
      )
      if (hasDelete && ranges.length >= 4) return current
      current = current.parentElement
    }
    return null
  }

  const isSelectedEventCard = (card) => {
    if (!(card instanceof HTMLElement)) return false
    const activeElement = document.activeElement
    if (activeElement instanceof Element && card.contains(activeElement)) return true
    const style = window.getComputedStyle(card)
    const borderColor = String(style.borderColor || '')
    const boxShadow = String(style.boxShadow || '')
    return /96,\s*165,\s*250|59,\s*130,\s*246/.test(borderColor) || /96,\s*165,\s*250|59,\s*130,\s*246/.test(boxShadow)
  }

  const collectEventEntries = (panel, duration) => {
    const deleteButtons = visibleButtons().filter((button) => normalizeText(button.textContent) === TEXT.remove)
    if (!deleteButtons.length) return []

    const ranges = visibleRanges()
    const entries = []
    for (let index = 0; index <= ranges.length - 4; index += 1) {
      const timeSlider = ranges[index]
      const strengthSlider = ranges[index + 1]
      const durationSlider = ranges[index + 2]
      const reboundSlider = ranges[index + 3]
      const timeMin = parseNumber(timeSlider.min)
      const strengthMin = parseNumber(strengthSlider.min)
      const strengthMax = parseNumber(strengthSlider.max)
      const durationMin = parseNumber(durationSlider.min)
      const reboundMin = parseNumber(reboundSlider.min)
      const reboundMax = parseNumber(reboundSlider.max)
      const looksLikeEventBlock =
        timeMin === 0 &&
        strengthMin === -100 &&
        strengthMax === 100 &&
        durationMin !== null &&
        durationMin <= 0.02 &&
        reboundMin === 0 &&
        reboundMax === 100
      if (!looksLikeEventBlock) continue

      const time = parseNumber(timeSlider.value)
      if (time === null) continue
      if (duration > 0 && time > duration + 0.001) continue
      const card = findEventCardForSlider(timeSlider)
      entries.push({
        time: Math.max(0, time),
        active: isSelectedEventCard(card)
      })
      if (entries.length >= deleteButtons.length) break
    }
    return entries.sort((left, right) => left.time - right.time)
  }

  const ensureOverlay = () => {
    if (state.overlay && document.body.contains(state.overlay)) return state.overlay
    const overlay = document.createElement('div')
    overlay.setAttribute('data-ribbon-event-overlay', 'true')
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '8',
      display: 'none'
    })
    state.overlay = overlay
    return overlay
  }

  const hideOverlay = () => {
    if (!state.overlay) return
    state.overlay.replaceChildren()
    state.overlay.style.display = 'none'
  }

  const renderMarkers = (slider, duration, eventEntries) => {
    if (!(duration > 0) || !eventEntries.length) {
      hideOverlay()
      return
    }
    const rect = slider.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      hideOverlay()
      return
    }
    const host = slider.parentElement
    if (!(host instanceof HTMLElement)) {
      hideOverlay()
      return
    }
    if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative'
    const overlay = ensureOverlay()
    if (overlay.parentElement !== host) host.appendChild(overlay)
    overlay.replaceChildren()
    overlay.style.display = 'block'

    const hostRect = host.getBoundingClientRect()
    const trackY = rect.top - hostRect.top + rect.height / 2
    const mergedEntries = []
    for (const entry of eventEntries) {
      const roundedTime = Number(entry.time.toFixed(3))
      const existing = mergedEntries.find((item) => item.time === roundedTime)
      if (existing) existing.active = existing.active || entry.active
      else mergedEntries.push({ time: roundedTime, active: Boolean(entry.active) })
    }

    for (const entry of mergedEntries) {
      const percent = Math.max(0, Math.min(1, entry.time / duration))
      const marker = document.createElement('div')
      marker.setAttribute('role', 'img')
      marker.setAttribute('aria-label', `${TEXT.ribbonEvents} ${entry.time.toFixed(2)} \u79d2`)
      marker.title = `${entry.time.toFixed(2)}s`
      const isActive = Boolean(entry.active)
      Object.assign(marker.style, {
        position: 'absolute',
        left: `${rect.left - hostRect.left + rect.width * percent}px`,
        top: `${trackY}px`,
        width: '10px',
        height: '10px',
        borderRadius: '999px',
        transform: 'translate(-50%, -50%)',
        background: isActive ? 'rgba(250,204,21,0.98)' : 'rgba(96,165,250,0.95)',
        border: isActive ? '1px solid rgba(254,240,138,0.98)' : '1px solid rgba(219,234,254,0.95)',
        boxShadow: isActive
          ? '0 0 0 2px rgba(234,179,8,0.30), 0 0 10px rgba(250,204,21,0.76)'
          : '0 0 0 2px rgba(37,99,235,0.28), 0 0 8px rgba(59,130,246,0.68)'
      })
      overlay.appendChild(marker)
    }
  }

  const refresh = () => {
    if (!isBoneAnimationView()) {
      state.lastEventEntries = []
      hideOverlay()
      return
    }
    hideRibbonStatusNotes()

    const timelineSlider = findTimelineSlider()
    if (!timelineSlider) {
      hideOverlay()
      return
    }

    const duration = parseNumber(timelineSlider.max) || parseNumber(timelineSlider.getAttribute('max')) || 0
    if (!(duration > 0)) {
      hideOverlay()
      return
    }

    const panel = findRibbonPanel()
    if (panel) {
      const panelText = normalizeText(panel.textContent)
      const entries = collectEventEntries(panel, duration)
      if (entries.length) state.lastEventEntries = entries
      else if (panelText.includes(TEXT.noEvents) || panelText.includes(TEXT.cleared)) state.lastEventEntries = []
    }
    const pageText = normalizeText(document.body.textContent)
    if (
      !state.lastEventEntries.length ||
      pageText.includes(TEXT.noEvents) ||
      pageText.includes(TEXT.cleared)
    ) {
      const visibleDeleteCount = visibleButtons().filter(
        (button) => normalizeText(button.textContent) === TEXT.remove
      ).length
      if (visibleDeleteCount === 0 && (pageText.includes(TEXT.noEvents) || pageText.includes(TEXT.cleared))) {
        state.lastEventEntries = []
      }
    }

    const usableEntries = state.lastEventEntries.filter(
      (entry) => Number.isFinite(entry.time) && entry.time >= 0 && entry.time <= duration + 0.001
    )
    if (!usableEntries.length) {
      hideOverlay()
      return
    }

    renderMarkers(timelineSlider, duration, usableEntries)
  }

  const schedule = () => {
    if (state.scheduled) return
    state.scheduled = true
    window.setTimeout(() => {
      state.scheduled = false
      refresh()
    }, 0)
  }

  document.addEventListener('input', schedule, true)
  document.addEventListener('change', schedule, true)
  document.addEventListener(
    'click',
    () => {
      window.setTimeout(schedule, 0)
    },
    true
  )
  window.addEventListener('resize', schedule, true)
  window.addEventListener('scroll', schedule, true)

  // Redrawing the markers mutates the overlay; reacting to that would redraw forever.
  const isOwnMutation = (record) =>
    !!state.overlay && (record.target === state.overlay || state.overlay.contains(record.target))
  const observer = new MutationObserver((records) => {
    if (records.every(isOwnMutation)) return
    schedule()
  })
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'aria-pressed', 'aria-selected', 'aria-current']
  })

  if (typeof ResizeObserver === 'function') {
    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(document.documentElement)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule, { once: true })
  }
  schedule()
  window.setTimeout(schedule, 300)
  window.setTimeout(schedule, 1200)
})()
