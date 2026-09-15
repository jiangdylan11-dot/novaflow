(function () {
  'use strict'

  const TOOL_ID = 'png_remove_black'
  const ROOT_ID = 'novaflow-png-remove-black-root'
  const STYLE_ID = 'novaflow-png-remove-black-style'
  const BUTTON_ATTR = 'data-novaflow-png-remove-black-entry'
  const state = { active: false, items: [], selectedId: '', processing: false, exporting: false }
  let nativeWorkspace = null
  let objectUrls = []

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
  const fileStem = (name) => String(name || 'effect.png').replace(/\.png$/i, '')
  const outputName = (name) => `${fileStem(name)}_alpha.png`
  const dataUrlToBlob = async (dataUrl) => await (await fetch(dataUrl)).blob()
  const blobBytes = async (blob) => Array.from(new Uint8Array(await blob.arrayBuffer()))

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      #${ROOT_ID}{position:fixed;z-index:120;display:grid;grid-template-columns:220px minmax(0,1fr);gap:12px;padding:14px 14px 14px 12px;background:#151515;color:#e6e6e6;box-sizing:border-box;overflow:hidden;font-size:13px}
      #${ROOT_ID} *{box-sizing:border-box} #${ROOT_ID} button,#${ROOT_ID} input{font:inherit}
      .nf-prb-side{min-width:0;display:grid;grid-template-rows:44px auto minmax(0,1fr);gap:8px;overflow:hidden}
      .nf-prb-upload{width:220px;height:44px;border:1px dashed rgba(255,255,255,.16);border-radius:8px;background:#1b1b1b;color:#f3f3f3;cursor:pointer;font-size:12px;font-weight:400;padding:0}
      .nf-prb-controls{display:grid;gap:8px}.nf-prb-count,.nf-prb-status{font-size:11px;line-height:1.6;color:#929292}.nf-prb-status{min-height:16px;color:#bfe8d7}
      .nf-prb-actions{display:grid;grid-template-columns:220px;gap:6px}.nf-prb-btn{width:220px;height:40px;border:0;border-radius:8px;background:#1ea672;color:#effcf5;cursor:pointer;font-size:12px;font-weight:400;padding:0 12px}.nf-prb-btn.alt{height:34px;background:rgba(255,255,255,.043);color:rgba(232,239,246,.78);padding:0 10px}.nf-prb-btn:disabled{opacity:.45;cursor:default;filter:none}
      .nf-prb-list{min-height:0;overflow-y:auto;padding:0 12px 12px;display:grid;align-content:start;gap:6px}.nf-prb-item{position:relative;width:100%;min-width:0;max-width:100%;min-height:52px;height:52px;max-height:52px;display:grid;grid-template-columns:42px minmax(0,1fr);column-gap:8px;align-items:center;padding:6px 30px 6px 8px;border:0;border-radius:6px;background:transparent;color:#eee;text-align:left;cursor:pointer;overflow:hidden}.nf-prb-item.active{background:linear-gradient(90deg,rgba(30,166,114,.12),rgba(30,166,114,.02) 68%,rgba(30,166,114,0));box-shadow:inset 2px 0 0 rgba(37,188,132,.92)}
      .nf-prb-thumb{width:40px;height:40px;min-width:40px;min-height:40px;max-width:40px;max-height:40px;object-fit:contain;border-radius:6px;border:0;margin:0;background:#111}.nf-prb-item-info{min-width:0;height:40px;display:flex;align-items:center;overflow:hidden}.nf-prb-item-name{line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:400;color:#f8fafc}.nf-prb-item-meta{display:none}.nf-prb-item-status{display:none}
      .nf-prb-item-delete{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:18px;height:18px;padding:0;border:0;border-radius:0;background:transparent;color:#fff;font-size:16px;line-height:18px;text-align:center;cursor:pointer;opacity:.88}.nf-prb-item-delete:hover{background:transparent;color:#fff;opacity:1}
      .nf-prb-main{position:relative;min-width:100%;max-width:calc(100% + 14px);min-height:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:minmax(0,1fr);gap:14px;margin-top:-14px;margin-right:-14px;width:calc(100% + 14px);height:100%;padding:12px 12px 16px;background:#090a0a;overflow:hidden}
      .nf-prb-panel{min-width:0;min-height:0;display:grid;grid-template-rows:49px minmax(0,1fr);overflow:hidden}.nf-prb-panel-head{display:flex;align-items:center;justify-content:space-between;color:#f8fafc;font-size:14px;font-weight:400}.nf-prb-panel-head small{color:rgba(232,239,246,.62);font-size:11px;font-weight:400;line-height:1}
      .nf-prb-preview{min-width:0;min-height:0;display:grid;place-items:center;overflow:hidden;border:1px solid #262626;background:transparent}
      .nf-prb-preview img{display:block;max-width:94%;max-height:94%;object-fit:contain}.nf-prb-empty{text-align:center;color:#777;font-size:12px;line-height:1.8}
      #${ROOT_ID} :where(.nf-prb-upload,.nf-prb-btn,.nf-prb-top-actions button){position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;white-space:nowrap;cursor:pointer;font-size:12px!important;font-weight:400!important;line-height:1!important;transition:none!important}
      #${ROOT_ID} :where(.nf-prb-upload,.nf-prb-btn,.nf-prb-top-actions button):not(:disabled):not([disabled]):not([aria-disabled="true"])::after{content:"";position:absolute;inset:0;border-radius:inherit;background:rgba(255,255,255,.045);opacity:0;pointer-events:none;transition:none!important}
      #${ROOT_ID} :where(.nf-prb-upload,.nf-prb-btn,.nf-prb-top-actions button):not(:disabled):not([disabled]):not([aria-disabled="true"]):hover{filter:brightness(1.08);border-color:rgba(255,255,255,.20)!important}
      #${ROOT_ID} :where(.nf-prb-upload,.nf-prb-btn,.nf-prb-top-actions button):not(:disabled):not([disabled]):not([aria-disabled="true"]):hover::after{opacity:1}
      #${ROOT_ID} :where(.nf-prb-upload,.nf-prb-btn,.nf-prb-top-actions button):not(:disabled):not([disabled]):not([aria-disabled="true"]):active{filter:brightness(1.02)}
      #${ROOT_ID} :where(.nf-prb-upload,.nf-prb-btn,.nf-prb-top-actions button):focus-visible{outline:2px solid rgba(255,255,255,.22);outline-offset:2px}
      #${ROOT_ID} :where(.nf-prb-upload,.nf-prb-btn,.nf-prb-top-actions button):is(:disabled,[disabled],[aria-disabled="true"]){opacity:.45;cursor:default;filter:none}
      #${ROOT_ID} :where(.nf-prb-upload,.nf-prb-btn,.nf-prb-top-actions button):is(:disabled,[disabled],[aria-disabled="true"]):hover{filter:none}
      .nf-prb-top-actions{position:absolute;right:26px;top:14px;display:flex;gap:8px}#${ROOT_ID} .nf-prb-top-actions button{width:102px;height:36px;padding:0 12px;border:0;border-radius:8px;background:linear-gradient(135deg,rgba(30,166,114,.96),rgba(30,166,114,.92));color:#effcf5;font-size:12px!important;font-weight:400!important;line-height:normal!important}#${ROOT_ID} .nf-prb-top-actions button:last-child{background:#b98218;color:#fff2c0;border-color:rgba(255,211,105,.32)}#${ROOT_ID} .nf-prb-top-actions button:disabled{opacity:.45;cursor:default;filter:none}
    `
    document.head.appendChild(style)
  }

  function textOf(node) { return String(node?.textContent || '').replace(/\s+/g, ' ').trim() }

  function findEntry(label) {
    return Array.from(document.querySelectorAll('button,[role="button"]')).find((node) => {
      if (!(node instanceof HTMLElement) || node.hasAttribute(BUTTON_ATTR)) return false
      const rect = node.getBoundingClientRect()
      return textOf(node).includes(label) && rect.width > 100 && rect.left >= 0 && rect.left < 360 && rect.top > 40
    }) || null
  }

  function isToolsSectionActive() {
    return Array.from(document.querySelectorAll('button,[role="button"]')).some((node) => {
      if (!(node instanceof HTMLElement)) return false
      const rect = node.getBoundingClientRect()
      const selected = node.getAttribute('aria-pressed') === 'true' || node.hasAttribute('data-state') && node.getAttribute('data-state') === 'active'
      return textOf(node) === '工具' && rect.left < 110 && selected
    })
  }

  function findWorkspace() {
    const candidates = Array.from(document.querySelectorAll('div')).filter((node) => {
      const rect = node.getBoundingClientRect()
      const text = textOf(node)
      const style = getComputedStyle(node)
      return rect.left >= 300 && rect.width > 900 && rect.height > 600
        && style.display === 'grid' && style.gridTemplateColumns.startsWith('220px ')
        && text.includes('原图') && text.includes('结果图')
        && (text.includes('PNG 压缩预览') || text.includes('JPG 压缩预览'))
    })
    const marker = candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect()
      const br = b.getBoundingClientRect()
      return ar.width * ar.height - br.width * br.height
    })[0]
    if (!marker) return null
    return marker
  }

  function syncBounds() {
    const root = document.getElementById(ROOT_ID)
    if (!root || !state.active) return
    const workspace = nativeWorkspace || findWorkspace()
    const rect = workspace?.getBoundingClientRect?.()
    if (!rect || rect.width < 500 || rect.height < 300) return
    root.style.left = `${Math.round(rect.left)}px`
    root.style.top = `${Math.round(rect.top)}px`
    root.style.width = `${Math.round(rect.width)}px`
    root.style.height = `${Math.round(rect.height)}px`
  }

  function setEntryVisual(active) {
    const entry = document.querySelector(`[${BUTTON_ATTR}="1"]`)
    if (!(entry instanceof HTMLElement)) return
    entry.style.setProperty('background', active ? '#25bc84' : '#333333', 'important')
    entry.style.setProperty('color', '#ffffff', 'important')
    entry.setAttribute('data-novaflow-tools-entry-active', active ? '1' : '0')
    if (active) {
      ;['PNG 压缩', 'JPG 压缩'].forEach((label) => {
        const nativeButton = findEntry(label)
        if (!(nativeButton instanceof HTMLElement)) return
        nativeButton.style.setProperty('background', '#333333', 'important')
        nativeButton.setAttribute('data-novaflow-tools-entry-active', '0')
      })
    }
  }

  function handleToolEntryClick(event) {
    const entry = event.target instanceof Element ? event.target.closest('[data-novaflow-tools-entry]') : null
    if (entry && entry.getAttribute('data-novaflow-tools-entry') !== TOOL_ID) deactivate()
  }

  function deactivate() {
    if (!state.active) return
    state.active = false
    document.getElementById(ROOT_ID)?.remove()
    if (nativeWorkspace instanceof HTMLElement) nativeWorkspace.style.removeProperty('visibility')
    nativeWorkspace = null
    setEntryVisual(false)
  }

  function activate() {
    installStyle()
    state.active = true
    nativeWorkspace = findWorkspace()
    if (nativeWorkspace instanceof HTMLElement) nativeWorkspace.style.setProperty('visibility', 'hidden', 'important')
    setEntryVisual(true)
    render()
    syncBounds()
  }

  function ensureEntry() {
    const existing = document.querySelector(`[${BUTTON_ATTR}="1"]`)
    const toolsActive = isToolsSectionActive()
    const png = toolsActive ? findEntry('PNG 压缩') : null
    const jpg = toolsActive ? findEntry('JPG 压缩') : null
    const validToolsHost = toolsActive
      && png instanceof HTMLElement
      && jpg instanceof HTMLElement
      && png.parentElement instanceof HTMLElement
      && png.parentElement === jpg.parentElement
    if (!validToolsHost) {
      deactivate()
      existing?.remove()
      return
    }
    if (existing instanceof HTMLElement) { if (state.active) setEntryVisual(true); return }
    const button = jpg.cloneNode(true)
    button.setAttribute(BUTTON_ATTR, '1')
    button.setAttribute('data-novaflow-tools-entry', TOOL_ID)
    button.removeAttribute('data-novaflow-tools-entry-listener')
    button.removeAttribute('data-novaflow-tools-entry-active')
    button.textContent = 'PNG 去黑'
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); activate() })
    jpg.parentElement.appendChild(button)
    setEntryVisual(false)
    ;['PNG 压缩', 'JPG 压缩'].forEach((label) => {
      const nativeButton = findEntry(label)
      if (nativeButton?.getAttribute('data-novaflow-png-remove-black-bound') === '1') return
      nativeButton?.setAttribute('data-novaflow-png-remove-black-bound', '1')
      nativeButton?.addEventListener('click', deactivate, true)
    })
  }

  async function readFile(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('读取 PNG 失败'))
      reader.readAsDataURL(file)
    })
    const image = await new Promise((resolve, reject) => {
      const node = new Image()
      node.onload = () => resolve(node)
      node.onerror = () => reject(new Error('PNG 解码失败'))
      node.src = dataUrl
    })
    let filePath = ''
    try { filePath = String(window.electronAPI?.getPathForFile?.(file) || file.path || '') } catch (_) {}
    return { id: `${Date.now()}_${Math.random().toString(16).slice(2)}`, name: file.name, filePath, dataUrl, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height, status: '等待处理', result: null }
  }

  async function addFiles(files) {
    const pngs = Array.from(files || []).filter((file) => file.type === 'image/png' || /\.png$/i.test(file.name || ''))
    for (const file of pngs) state.items.push(await readFile(file))
    if (!state.selectedId && state.items[0]) state.selectedId = state.items[0].id
    render()
  }

  async function processAll() {
    if (state.processing || !state.items.length) return
    const api = window.NovaFlowBackgroundRemoval
    if (!api?.unmultBlackBackgroundDataUrl) { alert('PNG 去黑能力未加载，请重启 NovaFlow 后重试。'); return }
    state.processing = true
    render()
    for (const item of state.items) {
      item.status = '正在去黑…'; render()
      try {
        const result = await api.unmultBlackBackgroundDataUrl(item.dataUrl)
        const blob = await dataUrlToBlob(result.dataUrl)
        const url = URL.createObjectURL(blob)
        objectUrls.push(url)
        item.result = { dataUrl: result.dataUrl, blob, url, fileName: outputName(item.name), stats: result.stats }
        item.status = '处理完成'
      } catch (error) { item.status = String(error?.message || error || '处理失败') }
      render()
    }
    state.processing = false
    render()
  }

  async function exportAll() {
    const ready = state.items.filter((item) => item.result?.blob)
    const api = window.electronAPI
    if (!ready.length || state.exporting) return
    state.exporting = true; render()
    try {
      if (api?.pickDirectory && api?.writeBinaryFile) {
        const picked = await api.pickDirectory()
        if (!picked?.dir || picked.canceled) return
        for (const item of ready) await api.writeBinaryFile({ dir: picked.dir, fileName: item.result.fileName, bytes: await blobBytes(item.result.blob) })
        alert(`已导出 ${ready.length} 张透明 PNG。`)
      } else ready.forEach((item, index) => window.setTimeout(() => { const a = document.createElement('a'); a.href = item.result.url; a.download = item.result.fileName; a.click() }, index * 120))
    } finally { state.exporting = false; render() }
  }

  async function overwriteAll() {
    const ready = state.items.filter((item) => item.result?.blob && item.filePath)
    const api = window.electronAPI
    if (!ready.length || !api?.writeBinaryFile || state.exporting) return
    state.exporting = true; render()
    try {
      for (const item of ready) {
        const normalized = item.filePath.replace(/\\/g, '/')
        const split = normalized.lastIndexOf('/')
        await api.writeBinaryFile({ dir: item.filePath.slice(0, split), fileName: item.filePath.slice(split + 1), bytes: await blobBytes(item.result.blob) })
        item.status = '处理完成｜已覆盖原图'
      }
      alert(`已直接覆盖 ${ready.length} 张原始 PNG。`)
    } finally { state.exporting = false; render() }
  }

  function clearAll() {
    objectUrls.forEach((url) => { try { URL.revokeObjectURL(url) } catch (_) {} })
    objectUrls = []; state.items = []; state.selectedId = ''; render()
  }

  function removeItem(id) {
    const index = state.items.findIndex((item) => item.id === id)
    if (index < 0 || state.processing) return
    const item = state.items[index]
    if (item?.result?.url) {
      try { URL.revokeObjectURL(item.result.url) } catch (_) {}
      objectUrls = objectUrls.filter((url) => url !== item.result.url)
    }
    state.items.splice(index, 1)
    if (state.selectedId === id) state.selectedId = state.items[index]?.id || state.items[index - 1]?.id || ''
    render()
  }

  function handleRootDragOver(event) {
    event.preventDefault()
  }

  function handleRootDrop(event) {
    event.preventDefault()
    addFiles(event.dataTransfer?.files)
  }

  function render() {
    if (!state.active) return
    let root = document.getElementById(ROOT_ID)
    if (!root) {
      root = document.createElement('section')
      root.id = ROOT_ID
      root.addEventListener('dragover', handleRootDragOver)
      root.addEventListener('drop', handleRootDrop)
      document.body.appendChild(root)
    }
    const selected = state.items.find((item) => item.id === state.selectedId) || state.items[0] || null
    const done = state.items.filter((item) => item.result).length
    const overwriteReady = state.items.some((item) => item.result && item.filePath)
    root.innerHTML = `
      <input data-prb-file type="file" accept="image/png,.png" multiple hidden>
      <div class="nf-prb-side">
        <button class="nf-prb-upload" data-prb-pick>＋　选择 PNG</button>
        <div class="nf-prb-controls"><div class="nf-prb-actions"><button class="nf-prb-btn" data-prb-run ${state.processing || !state.items.length ? 'disabled' : ''}>${state.processing ? '处理中…' : '开始去黑'}</button><button class="nf-prb-btn alt" data-prb-clear ${state.processing || !state.items.length ? 'disabled' : ''}>清空</button></div><div class="nf-prb-count">已选 ${state.items.length} 张｜完成 ${done} 张｜可导出 ${done} 张</div><div class="nf-prb-status">${state.processing ? '正在按顺序处理 PNG，请稍候…' : ''}</div></div>
        <div class="nf-prb-list">${state.items.length ? state.items.map((item) => `<div class="nf-prb-item ${item.id === selected?.id ? 'active' : ''}" data-prb-item="${item.id}" role="button" tabindex="0"><img class="nf-prb-thumb" src="${item.dataUrl}"><div class="nf-prb-item-info"><div class="nf-prb-item-name">${escapeHtml(item.name)}</div><div class="nf-prb-item-meta">${item.width} × ${item.height}</div><div class="nf-prb-item-meta nf-prb-item-status">${escapeHtml(item.status)}</div></div><button class="nf-prb-item-delete" type="button" data-prb-delete="${item.id}" aria-label="删除 ${escapeHtml(item.name)}">×</button></div>`).join('') : '<div class="nf-prb-empty">支持批量 PNG 去黑</div>'}</div>
      </div>
      <div class="nf-prb-main">
        <div class="nf-prb-panel"><div class="nf-prb-panel-head"><span>原图</span><small>${selected ? `${selected.width} × ${selected.height}` : ''}</small></div><div class="nf-prb-preview">${selected ? `<img src="${selected.dataUrl}">` : '<div class="nf-prb-empty">还没有图片</div>'}</div></div>
        <div class="nf-prb-panel"><div class="nf-prb-panel-head"><span>结果图</span><small></small></div><div class="nf-prb-preview">${selected?.result ? `<img src="${selected.result.dataUrl}">` : '<div class="nf-prb-empty">等待处理结果<br>结果区使用棋盘格显示透明区域</div>'}</div></div>
      </div>
      <div class="nf-prb-top-actions"><button data-prb-export ${state.exporting || !done ? 'disabled' : ''}>${state.exporting ? '导出中…' : '导出到文件夹'}</button><button data-prb-overwrite ${state.exporting || !overwriteReady ? 'disabled' : ''}>直接覆盖</button></div>`
    root.querySelector('[data-prb-pick]')?.addEventListener('click', () => root.querySelector('[data-prb-file]')?.click())
    root.querySelector('[data-prb-file]')?.addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = '' })
    root.querySelector('[data-prb-run]')?.addEventListener('click', processAll)
    root.querySelector('[data-prb-clear]')?.addEventListener('click', clearAll)
    root.querySelector('[data-prb-export]')?.addEventListener('click', exportAll)
    root.querySelector('[data-prb-overwrite]')?.addEventListener('click', overwriteAll)
    root.querySelectorAll('[data-prb-item]').forEach((item) => {
      item.addEventListener('click', () => { state.selectedId = item.getAttribute('data-prb-item') || ''; render() })
      item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); state.selectedId = item.getAttribute('data-prb-item') || ''; render() } })
    })
    root.querySelectorAll('[data-prb-delete]').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); removeItem(button.getAttribute('data-prb-delete') || '') }))
    syncBounds()
  }

  installStyle()
  document.addEventListener('click', handleToolEntryClick, true)
  let entrySyncTimer = 0
  const syncEntryFromMutations = () => {
    entrySyncTimer = 0
    ensureEntry()
    if (state.active && !document.getElementById(ROOT_ID)) render()
  }
  const mutationAddsElement = (mutation) => Array.from(mutation.addedNodes || []).some((node) => node.nodeType === 1)
  const observer = new MutationObserver((mutations) => {
    // Only newly added elements can mount the Tools entry host; text edits and attribute churn cannot.
    if (!mutations.some(mutationAddsElement)) return
    // Outside the primary Tools section with nothing mounted, ensureEntry() is a no-op; the 1s interval still covers section switches.
    if (!state.active && !document.body?.classList.contains('novaflow-primary-target-tools') && !document.querySelector(`[${BUTTON_ATTR}="1"]`)) return
    if (entrySyncTimer) return
    entrySyncTimer = window.setTimeout(syncEntryFromMutations, 120)
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('resize', syncBounds)
  window.setInterval(ensureEntry, 1000)
  ensureEntry()
})()
