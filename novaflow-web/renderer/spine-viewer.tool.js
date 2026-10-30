(function () {
  'use strict'

  const TOOL_ID = 'spine_viewer'
  const ROOT_ID = 'novaflow-spine-viewer-root'
  const ENTRY = '[data-novaflow-spine-viewer-entry="1"]'
  const viewerUrl = new URL('./vendor/spine-viewer/index.html', document.currentScript.src).href
  let active = false
  let frame = null
  let frameReady = false
  const workspaces = new Map()

  const textOf = (node) => String(node?.textContent || '').replace(/\s+/g, ' ').trim()
  const toolsActive = () => Array.from(document.querySelectorAll('button[aria-pressed="true"], [role="button"][aria-pressed="true"], button[data-state="active"]')).some((node) => textOf(node) === '工具' && node.getBoundingClientRect().left < 110)
  const entryFor = (label) => Array.from(document.querySelectorAll('button,[role="button"]')).find((node) => {
    const rect = node.getBoundingClientRect()
    return textOf(node).includes(label) && rect.width > 100 && rect.left >= 0 && rect.left < 360 && rect.top > 40
  })

  function syncSelection() {
    document.querySelectorAll('[data-novaflow-tools-entry]').forEach((button) => {
      if (button.matches(ENTRY) || active) {
        const selected = active && button.matches(ENTRY)
        button.setAttribute('data-novaflow-tools-entry-active', selected ? '1' : '0')
        button.setAttribute('aria-selected', String(selected))
        button.style.setProperty('background', selected ? '#1b4035' : 'transparent', 'important')
        button.style.setProperty('color', selected ? '#6ee7ce' : '#d4d4d4', 'important')
      }
    })
  }

  function notifyViewer() {
    frame?.contentWindow?.NovaFlowSpineViewer?.setActive(active && !document.hidden)
  }

  function syncBounds() {
    if (!active) return
    const workspace = document.querySelector('[data-novaflow-tools-workspace]')
    const root = document.getElementById(ROOT_ID)
    if (!(workspace instanceof HTMLElement) || !root) return
    if (frameReady) {
      if (!workspaces.has(workspace)) {
        workspaces.set(workspace, [workspace.style.getPropertyValue('visibility'), workspace.style.getPropertyPriority('visibility')])
      }
      workspace.style.setProperty('visibility', 'hidden', 'important')
    }
    const rect = workspace.getBoundingClientRect()
    Object.assign(root.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
    root.style.visibility = frameReady ? 'visible' : 'hidden'
  }

  function deactivate() {
    if (!active) return
    active = false
    notifyViewer()
    const root = document.getElementById(ROOT_ID)
    if (root) { root.hidden = true; root.inert = true }
    workspaces.forEach(([value, priority], workspace) => {
      if (value) workspace.style.setProperty('visibility', value, priority)
      else workspace.style.removeProperty('visibility')
    })
    workspaces.clear()
    syncSelection()
  }

  function activate() {
    active = true
    let root = document.getElementById(ROOT_ID)
    if (!root) {
      root = document.createElement('section')
      root.id = ROOT_ID
      root.setAttribute('aria-label', 'SPINE 查看器')
      Object.assign(root.style, { position: 'fixed', zIndex: '120', overflow: 'hidden', background: '#151515', visibility: 'hidden' })
      root.setAttribute('aria-busy', 'true')
      root.dataset.viewerReady = '0'
      frame = document.createElement('iframe')
      frame.title = 'SPINE 查看器'
      frame.src = viewerUrl
      Object.assign(frame.style, { display: 'block', border: '0', width: '100%', height: '100%', visibility: 'hidden', background: '#151515', colorScheme: 'dark' })
      frame.addEventListener('load', () => {
        // Keep the previous workspace painted until the styled viewer is ready.
        // The parent clock also runs if the user switches tools while it loads.
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
          frameReady = true
          frame.style.visibility = 'visible'
          root.dataset.viewerReady = '1'
          root.setAttribute('aria-busy', 'false')
          syncBounds()
          notifyViewer()
        }))
      })
      root.appendChild(frame)
      document.body.appendChild(root)
    }
    root.hidden = false
    root.inert = false
    frame.style.visibility = frameReady ? 'visible' : 'hidden'
    syncBounds()
    syncSelection()
    notifyViewer()
  }

  function ensureEntry() {
    const existing = document.querySelector(ENTRY)
    const png = toolsActive() ? entryFor('PNG 压缩') : null
    const jpg = toolsActive() ? entryFor('JPG 压缩') : null
    if (!png || !jpg || png.parentElement !== jpg.parentElement) {
      deactivate()
      existing?.remove()
      return
    }
    let button = existing
    if (!button) {
      button = jpg.cloneNode(true)
      Array.from(button.attributes).forEach(({ name }) => {
        if (name.startsWith('data-novaflow-') || name.startsWith('aria-') || name === 'id') button.removeAttribute(name)
      })
      button.textContent = 'SPINE 查看器'
      button.setAttribute('data-novaflow-spine-viewer-entry', '1')
      button.setAttribute('data-novaflow-tools-entry', TOOL_ID)
      button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); activate() })
      jpg.parentElement.appendChild(button)
    }
    const atlas = entryFor('SPINE 图集转换')
    if (atlas && atlas.nextElementSibling !== button) atlas.after(button)
    syncSelection()
    syncBounds()
  }

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button,[role="button"]') : null
    if (!button || button.matches(ENTRY)) return
    const rect = button.getBoundingClientRect()
    if (button.hasAttribute('data-novaflow-tools-entry') ||
        (rect.left < 110 && ['特效', '动画', '美工', '工具', '仓库', '导出'].includes(textOf(button))) ||
        ['PNG 压缩', 'JPG 压缩', 'PNG 去黑', 'MP4 压缩', '视频格式转换', 'SPINE 图集转换'].includes(textOf(button))) deactivate()
  }, true)
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => node.nodeType === 1)) &&
        (active || document.querySelector(ENTRY) || toolsActive())) ensureEntry()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('resize', syncBounds)
  document.addEventListener('visibilitychange', notifyViewer)
  window.setInterval(() => { if (!document.hidden) ensureEntry() }, 1000)
  ensureEntry()
})()
