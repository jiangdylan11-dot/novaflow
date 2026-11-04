(function () {
  'use strict'

  const TOOL_ID = 'spine_viewer'
  const ROOT_ID = 'novaflow-spine-viewer-root'
  const ENTRY = '[data-novaflow-spine-viewer-entry="1"]'
  const viewerUrl = new URL('./vendor/spine-viewer/index.html', document.currentScript.src).href
  let active = false
  let frame = null
  let frameReady = false
  let frameError = ''
  let loadTimer = 0
  let loadRequest = null
  const workspaces = new Map()
  const viewerApi = () => { try { return frame?.contentWindow?.NovaFlowSpineViewer } catch { return null } }

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
    viewerApi()?.setActive(active && !document.hidden)
  }

  function completeFrame() {
    if(!viewerApi())return false
    const root=document.getElementById(ROOT_ID);if(!root)return false
    window.clearTimeout(loadTimer);frameReady=true;frameError=''
    root.querySelector('[data-viewer-error]')?.remove()
    frame.style.visibility='visible';root.dataset.viewerReady='1';root.setAttribute('aria-busy','false')
    syncBounds();notifyViewer();return true
  }
  function loadTimedOut() {if(!completeFrame())failFrame('SPINE 查看器加载超时，请检查网络后重试')}

  async function loadFrame() {
    loadRequest?.abort();loadRequest=new AbortController()
    window.clearTimeout(loadTimer);loadTimer=window.setTimeout(loadTimedOut,15000)
    try {
      const response=await fetch(viewerUrl,{cache:'no-store',credentials:'same-origin',signal:loadRequest.signal})
      if(!response.ok)throw new Error('HTTP '+response.status)
      const html=await response.text()
      if(!html.includes('id="dropZone"')||!html.includes('app.js'))throw new Error('查看器页面未返回，请重新登录后重试')
      // Keep this owned document on the same origin, as the editor host does.
      // Its base preserves relative styles, modules and runtime assets.
      frame.srcdoc=html.replace(/<head>/i,'<head><base href="'+new URL('.',viewerUrl).href+'">')
    } catch(error) {if(error.name!=='AbortError')failFrame('SPINE 查看器加载失败：'+error.message)}
  }

  function failFrame(message) {
    if(frameReady||frameError)return
    window.clearTimeout(loadTimer)
    frameError=message
    const root=document.getElementById(ROOT_ID);if(!root)return
    root.setAttribute('aria-busy','false');root.dataset.viewerReady='error'
    root.style.visibility='visible'
    const panel=document.createElement('div');panel.dataset.viewerError='1'
    Object.assign(panel.style,{position:'absolute',inset:'0',display:'grid',placeContent:'center',gap:'12px',padding:'24px',color:'#ddd',background:'#151515'})
    const text=document.createElement('p');text.textContent=message
    const retry=document.createElement('button');retry.textContent='重试加载';retry.onclick=()=>{panel.remove();frameError='';root.dataset.viewerReady='0';root.setAttribute('aria-busy','true');void loadFrame()}
    panel.append(text,retry);root.appendChild(panel)
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
    const panelWidth = document.querySelector('[data-novaflow-tools-left-panel]')?.getBoundingClientRect().width
    const viewerDocument = frame?.contentDocument?.documentElement
    if (panelWidth > 0 && viewerDocument) viewerDocument.style.setProperty('--nf-tools-params-width', `${panelWidth}px`)
    root.style.visibility = frameReady || frameError ? 'visible' : 'hidden'
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
      Object.assign(frame.style, { display: 'block', border: '0', width: '100%', height: '100%', visibility: 'hidden', background: '#151515', colorScheme: 'dark' })
      frame.addEventListener('load', () => {
        if(!frame.hasAttribute('srcdoc'))return
        // Keep the previous workspace painted until the styled viewer is ready.
        // The parent clock also runs if the user switches tools while it loads.
        let settled=false
        const finish=()=>{
          if(settled)return;settled=true;window.clearTimeout(loadTimer);window.clearTimeout(paintTimer)
          if(!completeFrame())failFrame('SPINE 查看器页面未正常启动，请重新加载')
        }
        // An occluded Chromium window can pause rAF even with visibilityState
        // "visible". Loading an editor must not depend on a future paint.
        const paintTimer=window.setTimeout(finish,150)
        window.requestAnimationFrame(() => window.requestAnimationFrame(finish))
      })
      frame.addEventListener('error',()=>failFrame('SPINE 查看器加载失败，请检查网络后重试'))
      root.appendChild(frame)
      document.body.appendChild(root)
      void loadFrame()
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
  ;(window.NovaFlowProductionTools ||= {}).spine_viewer = {
    snapshot: () => ({name:'spine_viewer',active,busy:active&&!frameReady&&!frameError,error:frameError,items:[],viewer:viewerApi()?.agentContext?.()||null}),
    addFiles: files => {const api=viewerApi();if(!api?.importFiles)throw new Error(frameError||'查看器尚未就绪');return api.importFiles(files)},
  }
  ensureEntry()
})()
