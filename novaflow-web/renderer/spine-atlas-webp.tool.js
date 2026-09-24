(function () {
  'use strict'

  const TOOL_ID = 'spine_atlas_webp'
  const ROOT_ID = 'novaflow-spine-atlas-webp-root'
  const STYLE_ID = 'novaflow-spine-atlas-webp-style'
  const BUTTON_ATTR = 'data-novaflow-spine-atlas-webp-entry'
  const PRESETS = [{ id: 'clarity', label: '画质优先', quality: 95 }, { id: 'compact', label: '均衡', quality: 90 }, { id: 'small', label: '更小体积', quality: 70 }]
  const state = { active: false, atlases: [], images: [], selectedId: '', preset: 'compact', processing: false, exporting: false, resultAtlases: [], warnings: [] }
  let nativeWorkspaces = []
  let objectUrls = []

  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
  const normalizeName = (value) => String(value || '').replace(/\\/g, '/').split('/').pop().trim().toLowerCase()
  const textBytes = (value) => Array.from(new TextEncoder().encode(String(value || '')))
  const getResultSize = (item) => Number(item?.result?.size || item?.result?.bytes?.length || 0)

  function getFilePath(file) {
    try {
      return String(window.electronAPI?.getPathForFile?.(file) || file?.path || '')
    } catch (_) {
      return ''
    }
  }

  function formatBytes(value) {
    const size = Number(value || 0)
    if (!Number.isFinite(size) || size <= 0) return '-'
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 100 * 1024 ? 1 : 0)} KB`
    return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 2 : 1)} MB`
  }

  function formatSizeDelta(sourceSize, outputSize) {
    const before = Number(sourceSize || 0)
    const after = Number(outputSize || 0)
    if (!before || !after) return ''
    const diff = after - before
    const percent = Math.round((diff / before) * 100)
    if (percent === 0) return '持平'
    return `${diff > 0 ? '+' : ''}${percent}%`
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      #${ROOT_ID}{position:fixed;z-index:120;display:grid;grid-template-columns:220px minmax(0,1fr);gap:12px;padding:14px 14px 14px 12px;background:#151515;color:#e6e6e6;box-sizing:border-box;overflow:hidden;font-size:13px;container-type:inline-size}
      #${ROOT_ID} *{box-sizing:border-box} #${ROOT_ID} button,#${ROOT_ID} input{font:inherit}
      .nf-saw-side{min-width:0;display:grid;grid-template-rows:44px auto minmax(0,1fr);gap:8px;overflow:hidden}
      .nf-saw-upload{width:220px;height:44px;border:1px dashed rgba(255,255,255,.16);border-radius:8px;background:#1b1b1b;color:#f3f3f3;cursor:pointer;font-size:12px;font-weight:400;padding:0}
      .nf-saw-controls{display:grid;gap:8px}.nf-saw-count,.nf-saw-status{font-size:11px;line-height:1.6;color:#929292}.nf-saw-status{min-height:16px;color:#bfe8d7}
      .nf-saw-preset{display:grid;gap:6px;width:220px;min-width:0;font-size:12px;color:#bfe8d7}.nf-saw-preset-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.nf-saw-preset button{height:34px;min-width:0;padding:0 6px;border:0;border-radius:7px;background:#282828;color:#cbd3d9;font-size:12px!important}.nf-saw-preset button.active{background:#1ea672;color:#effcf5}
      .nf-saw-alpha{display:grid;gap:6px;min-width:0;font-size:12px;color:#bfe8d7}.nf-saw-alpha span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nf-saw-alpha select{width:220px;height:34px;border:1px solid #363636;border-radius:7px;background:#242424;color:#f3f3f3;font:inherit;padding:0 8px}.nf-saw-alpha select:focus-visible{outline:2px solid #25bc84;outline-offset:2px}.nf-saw-status{max-height:64px;overflow:auto;overflow-wrap:anywhere}
      .nf-saw-actions{display:grid;grid-template-columns:220px;gap:6px}.nf-saw-btn{width:220px;height:40px;border:0;border-radius:8px;background:#1ea672;color:#effcf5;cursor:pointer;font-size:12px;font-weight:400;padding:0 12px}.nf-saw-btn.alt{height:34px;background:rgba(255,255,255,.043);color:rgba(232,239,246,.78);padding:0 10px}.nf-saw-btn:disabled{opacity:.45;cursor:default;filter:none}
      .nf-saw-list{min-height:0;overflow-y:auto;padding:0 12px 12px;display:grid;align-content:start;gap:6px}.nf-saw-item{position:relative;width:100%;min-width:0;max-width:100%;min-height:52px;height:52px;max-height:52px;display:grid;grid-template-columns:42px minmax(0,1fr);column-gap:8px;align-items:center;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:#eee;text-align:left;cursor:pointer;overflow:hidden}.nf-saw-item.has-format{grid-template-columns:42px minmax(0,1fr) 62px}.nf-saw-item.active{background:linear-gradient(90deg,rgba(30,166,114,.12),rgba(30,166,114,.02) 68%,rgba(30,166,114,0));box-shadow:inset 2px 0 0 rgba(37,188,132,.92)}
      .nf-saw-thumb{width:40px;height:40px;min-width:40px;min-height:40px;max-width:40px;max-height:40px;object-fit:contain;border-radius:6px;border:0;margin:0;background:#111}.nf-saw-fileicon{width:40px;height:40px;border-radius:6px;background:#242424;color:#bfe8d7;display:grid;place-items:center;font-size:10px}
      .nf-saw-item-info{min-width:0;height:40px;display:flex;flex-direction:column;justify-content:center;overflow:hidden}.nf-saw-item-name{line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:400;color:#f8fafc}.nf-saw-item-meta{font-size:11px;color:#929292;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nf-saw-format{width:62px;height:24px;display:grid;grid-template-columns:1fr 1fr;gap:3px}.nf-saw-format button{height:24px;min-width:0;border:0;border-radius:6px;background:rgba(255,255,255,.055);color:rgba(232,239,246,.72);font-size:10px!important;padding:0}.nf-saw-format button.active{background:rgba(30,166,114,.92);color:#effcf5}
      .nf-saw-main{position:relative;min-width:100%;max-width:calc(100% + 14px);min-height:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:minmax(0,1fr);gap:14px;margin-top:-14px;margin-right:-14px;width:calc(100% + 14px);height:100%;padding:12px 12px 16px;background:#090a0a;overflow:hidden}
      .nf-saw-panel{min-width:0;min-height:0;display:grid;grid-template-rows:49px minmax(0,1fr);overflow:hidden}.nf-saw-panel-head{display:flex;align-items:center;justify-content:flex-start;gap:8px;color:#f8fafc;font-size:14px;font-weight:400}.nf-saw-panel-head small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(232,239,246,.62);font-size:11px;font-weight:400;line-height:1}
      .nf-saw-preview{min-width:0;min-height:0;display:grid;place-items:center;overflow:hidden;border:1px solid #262626;background:transparent}.nf-saw-preview img{display:block;max-width:94%;max-height:94%;object-fit:contain}.nf-saw-empty{text-align:center;color:#777;font-size:12px;line-height:1.8;padding:12px}.nf-saw-atlas{width:100%;height:100%;overflow:auto;padding:12px;color:#b8c0c8;font-size:12px;line-height:1.7;white-space:pre-wrap}
      #${ROOT_ID} :where(.nf-saw-upload,.nf-saw-btn,.nf-saw-preset button,.nf-saw-format button,.nf-saw-top-actions button){position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;white-space:nowrap;cursor:pointer;font-weight:400!important;line-height:1!important;transition:none!important}
      #${ROOT_ID} :where(.nf-saw-upload,.nf-saw-btn,.nf-saw-preset button,.nf-saw-format button,.nf-saw-top-actions button):not(:disabled):not([disabled]):not([aria-disabled="true"])::after{content:"";position:absolute;inset:0;border-radius:inherit;background:rgba(255,255,255,.045);opacity:0;pointer-events:none;transition:none!important}
      #${ROOT_ID} :where(.nf-saw-upload,.nf-saw-btn,.nf-saw-preset button,.nf-saw-format button,.nf-saw-top-actions button):not(:disabled):not([disabled]):not([aria-disabled="true"]):hover{filter:brightness(1.08);border-color:rgba(255,255,255,.20)!important}
      #${ROOT_ID} :where(.nf-saw-upload,.nf-saw-btn,.nf-saw-preset button,.nf-saw-format button,.nf-saw-top-actions button):not(:disabled):not([disabled]):not([aria-disabled="true"]):hover::after{opacity:1}
      #${ROOT_ID} :where(.nf-saw-upload,.nf-saw-btn,.nf-saw-preset button,.nf-saw-format button,.nf-saw-top-actions button):not(:disabled):not([disabled]):not([aria-disabled="true"]):active{filter:brightness(1.02)}
      #${ROOT_ID} :where(.nf-saw-upload,.nf-saw-btn,.nf-saw-preset button,.nf-saw-format button,.nf-saw-top-actions button):focus-visible{outline:2px solid rgba(255,255,255,.22);outline-offset:2px}
      #${ROOT_ID} :where(.nf-saw-upload,.nf-saw-btn,.nf-saw-preset button,.nf-saw-format button,.nf-saw-top-actions button):is(:disabled,[disabled],[aria-disabled="true"]){opacity:.45;cursor:default;filter:none}
      #${ROOT_ID} :where(.nf-saw-upload,.nf-saw-btn,.nf-saw-preset button,.nf-saw-format button,.nf-saw-top-actions button):is(:disabled,[disabled],[aria-disabled="true"]):hover{filter:none}
      .nf-saw-top-actions{position:absolute;right:26px;top:14px;display:flex;gap:8px}#${ROOT_ID} .nf-saw-top-actions button{width:102px;height:36px;padding:0 12px;border:0;border-radius:8px;background:linear-gradient(135deg,rgba(30,166,114,.96),rgba(30,166,114,.92));color:#effcf5;font-size:12px!important;font-weight:400!important;line-height:normal!important}#${ROOT_ID} .nf-saw-top-actions button:last-child{background:#b98218;color:#fff2c0;border-color:rgba(255,211,105,.32)}#${ROOT_ID} .nf-saw-top-actions button:disabled{opacity:.45;cursor:default;filter:none}
      @container (max-width:980px){#${ROOT_ID} .nf-saw-main{padding-top:56px}}
    `
    document.head.appendChild(style)
  }

  function textOf(node) { return String(node?.textContent || '').replace(/\s+/g, ' ').trim() }

  function findEntry(label) {
    return Array.from(document.querySelectorAll('button,[role="button"]')).find((node) => {
      if (!(node instanceof HTMLElement) || node.hasAttribute(BUTTON_ATTR) || !textOf(node).includes(label)) return false
      const rect = node.getBoundingClientRect()
      return rect.width > 100 && rect.left >= 0 && rect.left < 360 && rect.top > 40
    }) || null
  }

  const PRIMARY_SECTION_LABELS = ['特效', '动画', '美工', '工具']

  function isToolsSectionActive() {
    // Pressed buttons are few (sidebar, tabs), so the attribute pre-filter keeps this cheap enough to
    // run on every element-adding mutation batch.
    return Array.from(document.querySelectorAll('button[aria-pressed="true"], [role="button"][aria-pressed="true"], button[data-state="active"], [role="button"][data-state="active"]')).some((node) => (
      node instanceof HTMLElement && textOf(node) === '工具' && node.getBoundingClientRect().left < 110
    ))
  }

  // Primary sidebar button (特效 / 动画 / 美工 / 工具) hit by a click; 仓库 / 导出 are runtime shortcuts.
  function primarySectionButtonFromEvent(event) {
    const target = event.target instanceof Element ? event.target : null
    const button = target ? target.closest('button,[role="button"]') : null
    if (!(button instanceof HTMLElement) || !PRIMARY_SECTION_LABELS.includes(textOf(button))) return null
    const rect = button.getBoundingClientRect()
    return rect.left < 110 && rect.top > 40 && rect.width > 0 ? button : null
  }

  // Leaving the primary Tools section: drop the injected entry before React re-renders the secondary
  // list, otherwise the clone lingers inside the next section's list for a frame and visibly jumps.
  function handlePrimarySectionClick(event) {
    const button = primarySectionButtonFromEvent(event)
    if (!button || textOf(button) === '工具') return
    deactivate()
    document.querySelector(`[${BUTTON_ATTR}="1"]`)?.remove()
  }

  function findWorkspaces() {
    // The tools workspace as the app marks it (its grid moved to a flex row,
    // which the shape test below no longer recognises).
    const marked = document.querySelector('[data-novaflow-tools-workspace]')
    if (marked instanceof HTMLElement && marked.getBoundingClientRect().width > 500) return [marked]
    return Array.from(document.querySelectorAll('div')).filter((node) => {
      if (!(node instanceof HTMLElement) || node.id === ROOT_ID || node.closest(`#${ROOT_ID}`)) return false
      const rect = node.getBoundingClientRect()
      const text = textOf(node)
      const style = getComputedStyle(node)
      return rect.left >= 300 && rect.width > 500 && rect.height > 300
        && style.display === 'grid' && style.gridTemplateColumns.startsWith('220px ')
        && text.includes('原图') && text.includes('结果图')
    }).sort((a, b) => {
      const ar = a.getBoundingClientRect()
      const br = b.getBoundingClientRect()
      return br.width * br.height - ar.width * ar.height
    })
  }

  function findWorkspace() {
    return findWorkspaces()[0] || null
  }

  function syncBounds() {
    const root = document.getElementById(ROOT_ID)
    if (!root || !state.active) return
    const workspace = nativeWorkspaces[0] || findWorkspace()
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
      ;['PNG 压缩', 'JPG 压缩', 'PNG 去黑'].forEach((label) => {
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
    nativeWorkspaces.forEach((workspace) => workspace.style.removeProperty('visibility'))
    nativeWorkspaces = []
    setEntryVisual(false)
  }

  function activate() {
    installStyle()
    state.active = true
    nativeWorkspaces = findWorkspaces()
    nativeWorkspaces.forEach((workspace) => workspace.style.setProperty('visibility', 'hidden', 'important'))
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
    button.textContent = 'SPINE 图集转换'
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); activate() })
    jpg.parentElement.appendChild(button)
    setEntryVisual(false)
    ;['PNG 压缩', 'JPG 压缩', 'PNG 去黑'].forEach((label) => {
      const nativeButton = findEntry(label)
      if (nativeButton?.getAttribute('data-novaflow-spine-atlas-webp-bound') === '1') return
      nativeButton?.setAttribute('data-novaflow-spine-atlas-webp-bound', '1')
      nativeButton?.addEventListener('click', deactivate, true)
    })
  }

  async function readAtlasFile(file) {
    const text = await file.text()
    return { id: `${Date.now()}_${Math.random().toString(16).slice(2)}`, name: file.name, inputPath: getFilePath(file), text, status: '已选择 atlas' }
  }

  async function readPngFile(file) {
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()))
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
    return { id: `${Date.now()}_${Math.random().toString(16).slice(2)}`, name: file.name, inputPath: getFilePath(file), bytes, sourceSize: file.size || bytes.length, dataUrl, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height, status: '等待转换', outputFormat: 'webp', alphaMode: 'pma', result: null }
  }

  async function addFiles(files) {
    if (state.processing || state.exporting) return
    revokeResults()
    for (const file of Array.from(files || [])) {
      const name = String(file.name || '')
      if (/\.atlas$/i.test(name)) state.atlases.push(await readAtlasFile(file))
      else if (file.type === 'image/png' || /\.png$/i.test(name)) state.images.push(await readPngFile(file))
    }
    if (!state.selectedId && state.images[0]) state.selectedId = state.images[0].id
    state.resultAtlases = []
    state.warnings = []
    render()
  }

  function revokeResults() {
    objectUrls.forEach((url) => { try { URL.revokeObjectURL(url) } catch (_) {} })
    objectUrls = []
    state.images.forEach((item) => { item.result = null; item.status = '等待转换' })
    state.resultAtlases = []
    state.warnings = []
  }

  async function processAll() {
    if (state.processing || state.exporting || !state.atlases.length || !state.images.length) return
    const api = window.electronAPI
    if (!api?.convertSpineAtlasWebp) { alert('SPINE 转 WebP 能力未加载，请重启 NovaFlow 后重试。'); return }
    state.processing = true
    revokeResults()
    render()
    try {
      state.images.forEach((item) => { item.status = '正在转换…' })
      render()
      const result = await api.convertSpineAtlasWebp({
        atlases: state.atlases.map((item) => ({ fileName: item.name, text: item.text })),
        images: state.images.map((item) => ({ fileName: item.name, bytes: item.bytes, outputFormat: item.outputFormat || 'webp', alphaMode: item.alphaMode || 'pma' })),
        options: { preset: state.preset }
      })
      if (!result?.ok) throw new Error(result?.error || '转换失败')
      const bySource = new Map((result.images || []).map((item) => [normalizeName(item.sourceName), item]))
      for (const item of state.images) {
        const output = bySource.get(normalizeName(item.name))
        if (!output) {
          item.status = 'atlas 未引用'
          continue
        }
        const blob = new Blob([new Uint8Array(output.bytes || [])], { type: output.format === 'jpg' ? 'image/jpeg' : 'image/webp' })
        const url = URL.createObjectURL(blob)
        objectUrls.push(url)
        item.result = { ...output, blob, url }
        item.status = output.encoding === 'pma-compatible' ? `已转换 Q${output.quality}｜Alpha 已校验` : output.rgbaVerified ? '已转换｜RGBA 已校验' : '转换完成'
      }
      state.resultAtlases = Array.isArray(result.atlases) && result.atlases.length ? result.atlases : (result.atlas ? [result.atlas] : [])
      state.warnings = Array.isArray(result.warnings) ? result.warnings : []
    } catch (error) {
      const message = String(error?.message || error || '转换失败')
      state.images.forEach((item) => { if (!item.result) item.status = message })
      alert(message)
    } finally {
      state.processing = false
      render()
    }
  }

  async function exportAll() {
    const ready = state.images.filter((item) => item.result?.bytes?.length)
    const api = window.electronAPI
    if (!state.resultAtlases.length || !ready.length || state.exporting) return
    state.exporting = true
    render()
    try {
      if (api?.saveSpineAtlasWebpOutput) {
        const saved = await api.saveSpineAtlasWebpOutput({
          atlases: state.resultAtlases.map((atlas) => ({ fileName: atlas.fileName || 'spine.atlas', text: atlas.text })),
          images: ready.map((item) => ({ fileName: item.result.fileName, bytes: item.result.bytes }))
        })
        if (saved?.canceled) return
        if (!saved?.ok) throw new Error(saved?.error || saved?.message || '导出失败')
        alert(`已导出 ${ready.length} 张图集和 ${state.resultAtlases.length} 个 atlas。`)
      } else if (api?.pickDirectory && api?.writeBinaryFile) {
        const picked = await api.pickDirectory()
        if (!picked?.dir || picked.canceled) return
        for (const atlas of state.resultAtlases) {
          const atlasWrite = await api.writeBinaryFile({ dir: picked.dir, fileName: atlas.fileName || 'spine.atlas', bytes: textBytes(atlas.text) })
          if (!atlasWrite?.ok) throw new Error(atlasWrite?.error || atlasWrite?.message || `${atlas.fileName || 'atlas'} 导出失败`)
        }
        for (const item of ready) {
          const imageWrite = await api.writeBinaryFile({ dir: picked.dir, fileName: item.result.fileName, bytes: item.result.bytes })
          if (!imageWrite?.ok) throw new Error(imageWrite?.error || imageWrite?.message || `${item.result.fileName} 导出失败`)
        }
        alert(`已导出 ${ready.length} 张图集和 ${state.resultAtlases.length} 个 atlas。`)
      } else {
        state.resultAtlases.forEach((atlas, index) => window.setTimeout(() => {
          const atlasBlob = new Blob([atlas.text], { type: 'text/plain;charset=utf-8' })
          const atlasUrl = URL.createObjectURL(atlasBlob)
          const a = document.createElement('a'); a.href = atlasUrl; a.download = atlas.fileName || 'spine.atlas'; a.click()
          window.setTimeout(() => URL.revokeObjectURL(atlasUrl), 1000)
        }, index * 120))
        ready.forEach((item, index) => window.setTimeout(() => { const link = document.createElement('a'); link.href = item.result.url; link.download = item.result.fileName; link.click() }, (index + 1) * 120))
      }
    } finally {
      state.exporting = false
      render()
    }
  }

  async function overwriteAll() {
    const ready = state.images.filter((item) => item.result?.bytes?.length)
    const api = window.electronAPI
    if (!state.resultAtlases.length || !ready.length || state.exporting) return
    if (!api?.overwriteSpineAtlasWebpOutput) { alert('直接覆盖能力未加载，请重启 NovaFlow 后重试。'); return }
    const atlasPathByName = new Map(state.atlases.map((atlas) => [normalizeName(atlas.name), atlas.inputPath || '']))
    const missing = []
    const atlases = state.resultAtlases.map((atlas) => {
      const sourcePath = atlasPathByName.get(normalizeName(atlas.fileName)) || ''
      if (!sourcePath) missing.push(atlas.fileName || 'atlas')
      return { fileName: atlas.fileName || 'spine.atlas', sourcePath, text: atlas.text }
    })
    const images = ready.map((item) => {
      if (!item.inputPath) missing.push(item.name)
      return { sourceName: item.name, sourcePath: item.inputPath || '', fileName: item.result.fileName, bytes: item.result.bytes }
    })
    if (missing.length) {
      alert(`直接覆盖需要从本地文件选择 atlas 和 PNG，以下文件缺少原路径：${missing.slice(0, 6).join('、')}${missing.length > 6 ? '…' : ''}`)
      return
    }
    state.exporting = true
    render()
    try {
      const saved = await api.overwriteSpineAtlasWebpOutput({ atlases, images })
      if (!saved?.ok) throw new Error(saved?.error || saved?.message || '直接覆盖失败')
      ready.forEach((item) => { item.status = '已覆盖｜原 PNG 已删除'; item.inputPath = '' })
      alert(`已直接覆盖 ${state.resultAtlases.length} 个 atlas，写入 ${ready.length} 张图集，并删除 ${saved.deletedPngs?.length || ready.length} 张原 PNG。`)
    } catch (error) {
      alert(String(error?.message || error || '直接覆盖失败'))
    } finally {
      state.exporting = false
      render()
    }
  }

  function clearAll() {
    revokeResults()
    state.atlases = []
    state.images = []
    state.selectedId = ''
    render()
  }

  function setPreset(preset) {
    if (!PRESETS.some((item) => item.id === preset) || state.preset === preset || state.processing || state.exporting) return
    state.preset = preset
    revokeResults()
    render()
    document.querySelector(`[data-saw-preset="${preset}"]`)?.focus({ preventScroll: true })
  }

  function setImageFormat(id, format) {
    const image = state.images.find((item) => item.id === id)
    if (!image || state.processing || state.exporting) return
    const nextFormat = format === 'jpg' ? 'jpg' : 'webp'
    if (image.outputFormat === nextFormat) return
    image.outputFormat = nextFormat
    revokeResults()
    render()
  }

  function setImageAlpha(id, alphaMode) {
    const image = state.images.find((item) => item.id === id)
    if (!image || state.processing || state.exporting || !['straight', 'pma'].includes(alphaMode)) return
    image.alphaMode = alphaMode
    revokeResults()
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
    const selected = state.images.find((item) => item.id === state.selectedId) || state.images[0] || null
    const done = state.images.filter((item) => item.result).length
    const readyForOverwrite = state.images.filter((item) => item.result)
    const overwriteReady = state.resultAtlases.length > 0
      && readyForOverwrite.length > 0
      && readyForOverwrite.every((item) => item.inputPath)
      && state.resultAtlases.every((atlas) => state.atlases.some((item) => normalizeName(item.name) === normalizeName(atlas.fileName) && item.inputPath))
    const canRun = state.atlases.length > 0 && state.images.length > 0 && !state.processing && !state.exporting
    const status = state.processing ? '正在转换 SPINE 图集…' : state.warnings.join('\n') || ''
    const resultAtlas = state.resultAtlases[0] || null
    const atlasByName = new Map(state.resultAtlases.map((atlas) => [normalizeName(atlas.fileName), atlas]))
    const selectedResultSize = getResultSize(selected)
    const selectedSourceMeta = selected ? formatBytes(selected.sourceSize) : ''
    const selectedResultDelta = formatSizeDelta(selected?.sourceSize, selectedResultSize)
    const selectedResultMeta = selected?.result ? `${formatBytes(selectedResultSize)}${selectedResultDelta ? `｜${selectedResultDelta}` : ''}` : ''
    root.innerHTML = `
      <input data-saw-file type="file" accept=".atlas,image/png,.png" multiple hidden>
      <div class="nf-saw-side">
        <button class="nf-saw-upload" data-saw-pick>＋　选择 atlas / PNG</button>
        <div class="nf-saw-controls"><div class="nf-saw-preset"><span>压缩档位</span><div class="nf-saw-preset-options" role="group" aria-label="压缩档位">${PRESETS.map((preset) => `<button data-saw-preset="${preset.id}" class="${state.preset === preset.id ? 'active' : ''}" aria-pressed="${state.preset === preset.id}" title="Q${preset.quality}" ${state.processing || state.exporting ? 'disabled' : ''}>${preset.label}</button>`).join('')}</div></div><div class="nf-saw-actions"><button class="nf-saw-btn" data-saw-run ${canRun ? '' : 'disabled'}>${state.processing ? '转换中…' : '开始转换'}</button><button class="nf-saw-btn alt" data-saw-clear ${state.processing || state.exporting || (!state.atlases.length && !state.images.length) ? 'disabled' : ''}>清空</button></div><div class="nf-saw-count">Atlas ${state.atlases.length} 个｜PNG ${state.images.length} 张｜完成 ${done} 张</div><div class="nf-saw-status">${escapeHtml(status)}</div></div>
        <div class="nf-saw-list">${state.atlases.length ? state.atlases.map((atlas) => { const output = atlasByName.get(normalizeName(atlas.name)); return `<div class="nf-saw-item"><div class="nf-saw-fileicon">ATLAS</div><div class="nf-saw-item-info"><div class="nf-saw-item-name">${escapeHtml(atlas.name)}</div><div class="nf-saw-item-meta">${escapeHtml(output?.fileName || atlas.status)}</div></div></div>` }).join('') : ''}${state.images.length ? state.images.map((item) => { const outputSize = getResultSize(item); const sizeText = item.result ? `原 ${formatBytes(item.sourceSize)} → 改 ${formatBytes(outputSize)}｜${formatSizeDelta(item.sourceSize, outputSize)}` : `原 ${formatBytes(item.sourceSize)}｜${item.status}`; return `<div class="nf-saw-item has-format ${item.id === selected?.id ? 'active' : ''}" data-saw-item="${item.id}" role="button" tabindex="0"><img class="nf-saw-thumb" src="${item.dataUrl}"><div class="nf-saw-item-info"><div class="nf-saw-item-name">${escapeHtml(item.name)}</div><div class="nf-saw-item-meta">${escapeHtml(sizeText)}</div></div><div class="nf-saw-format"><button data-saw-format="${item.id}:jpg" class="${item.outputFormat === 'jpg' ? 'active' : ''}" title="输出 JPG，透明会变黑底">JPG</button><button data-saw-format="${item.id}:webp" class="${item.outputFormat !== 'jpg' ? 'active' : ''}" title="输出 WebP，保留透明">WEBP</button></div></div>` }).join('') : '<div class="nf-saw-empty">用于 PNG 图集转 JPG 和 WEBP 格式，需同时上传 atlas + PNG 图集</div>'}</div>
      </div>
      <div class="nf-saw-main">
        <div class="nf-saw-panel"><div class="nf-saw-panel-head"><span>原图</span><small>${escapeHtml(selectedSourceMeta)}</small></div><div class="nf-saw-preview">${selected ? `<img src="${selected.dataUrl}">` : state.atlases[0] ? `<pre class="nf-saw-atlas">${escapeHtml(state.atlases[0].text.slice(0, 4000))}</pre>` : '<div class="nf-saw-empty">还没有文件</div>'}</div></div>
        <div class="nf-saw-panel"><div class="nf-saw-panel-head"><span>结果图</span><small>${escapeHtml(selectedResultMeta)}</small></div><div class="nf-saw-preview">${selected?.result ? `<img src="${selected.result.url}">` : resultAtlas ? `<pre class="nf-saw-atlas">${escapeHtml(resultAtlas.text.slice(0, 4000))}</pre>` : '<div class="nf-saw-empty">等待转换结果</div>'}</div></div>
      </div>
      <div class="nf-saw-top-actions"><button data-saw-export ${state.exporting || !done || !state.resultAtlases.length ? 'disabled' : ''}>${state.exporting ? '导出中…' : '导出另存'}</button><button data-saw-overwrite ${state.exporting || !overwriteReady ? 'disabled' : ''}>导出覆盖</button></div>`
    root.querySelector('[data-saw-pick]')?.addEventListener('click', () => root.querySelector('[data-saw-file]')?.click())
    root.querySelector('[data-saw-file]')?.addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = '' })
    root.querySelector('[data-saw-run]')?.addEventListener('click', processAll)
    const controls = root.querySelector('.nf-saw-controls')
    const alphaLabel = document.createElement('label')
    alphaLabel.className = 'nf-saw-alpha'
    alphaLabel.innerHTML = `<span title="${escapeHtml(selected?.name || '')}">原图 Alpha${selected ? ` · ${escapeHtml(selected.name)}` : ''}</span><select data-saw-alpha aria-label="当前图集原图 Alpha" ${!selected || state.processing || state.exporting ? 'disabled' : ''}><option value="pma">已预乘（PMA）</option><option value="straight">未预乘（Straight）</option></select>`
    const alphaSelect = alphaLabel.querySelector('select')
    alphaSelect.value = selected?.alphaMode || 'pma'
    alphaSelect.addEventListener('change', () => setImageAlpha(selected?.id, alphaSelect.value))
    controls.insertBefore(alphaLabel, controls.querySelector('.nf-saw-actions'))
    root.querySelector('[data-saw-clear]')?.addEventListener('click', clearAll)
    root.querySelector('[data-saw-export]')?.addEventListener('click', exportAll)
    root.querySelector('[data-saw-overwrite]')?.addEventListener('click', overwriteAll)
    root.querySelectorAll('[data-saw-preset]').forEach((button) => button.addEventListener('click', () => setPreset(button.getAttribute('data-saw-preset'))))
    root.querySelectorAll('[data-saw-format]').forEach((button) => button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const [id, format] = String(button.getAttribute('data-saw-format') || '').split(':')
      setImageFormat(id, format)
    }))
    root.querySelectorAll('[data-saw-item]').forEach((item) => {
      item.addEventListener('click', () => { state.selectedId = item.getAttribute('data-saw-item') || ''; render() })
      item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); state.selectedId = item.getAttribute('data-saw-item') || ''; render() } })
    })
    syncBounds()
  }

  installStyle()
  document.addEventListener('click', handleToolEntryClick, true)
  document.addEventListener('click', handlePrimarySectionClick, true)
  const syncEntryFromMutations = () => {
    ensureEntry()
    if (state.active && !document.getElementById(ROOT_ID)) render()
  }
  const mutationAddsElement = (mutation) => Array.from(mutation.addedNodes || []).some((node) => node.nodeType === 1)
  // body.novaflow-primary-target-tools is set by the brand runtime after React's commit, so the pressed
  // sidebar button (already updated in the commit) is checked as well.
  const toolsSectionSelected = () => Boolean(document.body?.classList.contains('novaflow-primary-target-tools')) || isToolsSectionActive()
  const observer = new MutationObserver((mutations) => {
    // Only newly added elements can mount the Tools entry host; text edits and attribute churn cannot.
    if (!mutations.some(mutationAddsElement)) return
    // Outside the primary Tools section with nothing mounted, ensureEntry() is a no-op; the 1s interval still covers section switches.
    if (!state.active && !document.querySelector(`[${BUTTON_ATTR}="1"]`) && !toolsSectionSelected()) return
    // Synchronous: the entry mounts (and unmounts) in the same task as React's commit, so it paints
    // together with PNG 压缩 / JPG 压缩 instead of 120ms or more later.
    syncEntryFromMutations()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('resize', syncBounds)
  window.setInterval(ensureEntry, 1000)
  ensureEntry()
})()
