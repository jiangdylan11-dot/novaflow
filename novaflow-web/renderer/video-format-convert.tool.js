(function () {
  'use strict'

  const TOOL_ID = 'video_format_convert'
  const ROOT_ID = 'novaflow-video-format-convert-root'
  const STYLE_ID = 'novaflow-video-format-convert-style'
  const BUTTON_ATTR = 'data-novaflow-video-format-convert-entry'
  const MP4_ENTRY_ATTR = 'data-novaflow-mp4-compress-entry'
  const SPINE_ENTRY_ATTR = 'data-novaflow-spine-atlas-webp-entry'
  const FORMATS = [
    { id: 'mp4', label: 'MP4', note: 'H.264 + AAC，通用播放和引擎导入都认。' },
    { id: 'webm', label: 'WEBM', note: 'VP9，同画质下体积更小，网页内嵌常用。' },
    { id: 'gif', label: 'GIF', note: '无声循环动图，颜色会被压到 256 色，时间越长体积越大。' }
  ]
  // ffmpeg reads more than this; the list is what the file picker will open.
  const INPUT_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.ts', '.mpg', '.mpeg', '.gif']
  const DEFAULT_SCALE_PCT = 100
  const state = { active: false, items: [], selectedId: '', format: 'mp4', scalePct: DEFAULT_SCALE_PCT, processing: false, exporting: false }
  let nativeWorkspace = null
  let objectUrls = []
  let stopProgress = null

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
  const fileStem = (name) => String(name || 'video').replace(/\.[^.]+$/, '') || 'video'
  const outputName = (name, format) => `${fileStem(name)}.${format}`
  const isVideoFile = (file) => /^video\//.test(file?.type || '') || INPUT_EXTENSIONS.some((ext) => String(file?.name || '').toLowerCase().endsWith(ext))

  // The tools sliders are the runtime's own: a 2px track filled to the value, a 12px round thumb,
  // no border. The fill is a background gradient driven by --nf-range-pct, so the percentage has to
  // be written back on every value change the way novaflow-brand-runtime's syncRangeFillVisual does.
  const syncRangeFill = (input) => {
    if (!(input instanceof HTMLInputElement)) return
    const min = Number(input.min || 0)
    const max = Number(input.max || 100)
    const pct = max > min ? clamp(((Number(input.value || 0) - min) / (max - min)) * 100, 0, 100) : 0
    input.setAttribute('data-novaflow-tools-range', '1')
    input.style.setProperty('--nf-range-pct', `${pct}%`)
  }

  const formatBytes = (bytes) => {
    const value = Number(bytes) || 0
    if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
    if (value >= 1024) return `${Math.round(value / 1024)} KB`
    return `${value} B`
  }

  const formatDuration = (seconds) => {
    const total = Math.max(0, Math.round(Number(seconds) || 0))
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      #${ROOT_ID}{position:fixed;z-index:120;display:grid;grid-template-columns:220px minmax(0,1fr);gap:12px;padding:14px 14px 14px 12px;background:#151515;color:#e6e6e6;box-sizing:border-box;overflow:hidden;font-size:13px}
      #${ROOT_ID} *{box-sizing:border-box} #${ROOT_ID} button,#${ROOT_ID} input{font:inherit}
      .nf-vfc-side{min-width:0;display:grid;grid-template-rows:44px 44px auto minmax(0,1fr);gap:8px;overflow:hidden}
      .nf-vfc-formats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;width:220px}.nf-vfc-format{height:44px;border:0;border-radius:8px;background:rgba(255,255,255,.043);color:rgba(232,239,246,.78);cursor:pointer;font-size:12px;font-weight:400;padding:0}.nf-vfc-format.active{background:#1ea672;color:#effcf5}
      .nf-vfc-upload{width:220px;height:44px;border:1px dashed rgba(255,255,255,.16);border-radius:8px;background:#1b1b1b;color:#f3f3f3;cursor:pointer;font-size:12px;font-weight:400;padding:0}
      .nf-vfc-controls{display:grid;gap:8px}.nf-vfc-count,.nf-vfc-status{font-size:11px;line-height:1.6;color:#929292}.nf-vfc-status{min-height:16px;color:#bfe8d7}
      .nf-vfc-scale{display:grid;gap:6px}.nf-vfc-scale span{color:#bfe8d7;font-size:11px;font-weight:400}
      #${ROOT_ID} input[type=range]{-webkit-appearance:none;appearance:none;width:220px;height:12px;min-height:12px;max-height:12px;padding:0;margin:0;border:0;accent-color:#20c997;background:linear-gradient(90deg,#20c997 0%,#20c997 var(--nf-range-pct,0%),#303030 var(--nf-range-pct,0%),#303030 100%) center / 100% 2px no-repeat;background-color:transparent;cursor:pointer;box-sizing:border-box}
      #${ROOT_ID} input[type=range]::-webkit-slider-runnable-track{height:2px;border:0;background:transparent}
      #${ROOT_ID} input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;margin-top:-5px;border:0;border-radius:999px;background:#dfe7ee;box-shadow:0 0 0 1px rgba(255,255,255,0.20),0 1px 4px rgba(0,0,0,0.35)}
      .nf-vfc-hint{font-size:11px;line-height:1.7;color:#9a9a9a}
      .nf-vfc-actions{display:grid;grid-template-columns:220px;gap:6px}.nf-vfc-btn{width:220px;height:40px;border:0;border-radius:8px;background:#1ea672;color:#effcf5;cursor:pointer;font-size:12px;font-weight:400;padding:0 12px}.nf-vfc-btn.alt{height:34px;background:rgba(255,255,255,.043);color:rgba(232,239,246,.78);padding:0 10px}.nf-vfc-btn:disabled{opacity:.45;cursor:default;filter:none}
      .nf-vfc-list{min-height:0;overflow-y:auto;padding:0 12px 12px;display:grid;align-content:start;gap:6px}.nf-vfc-item{position:relative;width:100%;min-width:0;max-width:100%;min-height:52px;height:52px;max-height:52px;display:grid;grid-template-columns:42px minmax(0,1fr);column-gap:8px;align-items:center;padding:6px 30px 6px 8px;border:0;border-radius:6px;background:transparent;color:#eee;text-align:left;cursor:pointer;overflow:hidden}.nf-vfc-item.active{background:linear-gradient(90deg,rgba(30,166,114,.12),rgba(30,166,114,.02) 68%,rgba(30,166,114,0));box-shadow:inset 2px 0 0 rgba(37,188,132,.92)}
      .nf-vfc-thumb{width:40px;height:40px;min-width:40px;min-height:40px;max-width:40px;max-height:40px;display:grid;place-items:center;border-radius:6px;border:0;margin:0;background:#111;color:#5f7f72;font-size:9px;letter-spacing:.04em;text-transform:uppercase}.nf-vfc-item-info{min-width:0;height:40px;display:grid;align-content:center;gap:2px;overflow:hidden}.nf-vfc-item-name{line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:400;color:#f8fafc}.nf-vfc-item-meta{line-height:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#8b8b8b}.nf-vfc-item-meta.done{color:#7fd3ae}
      .nf-vfc-item-delete{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:18px;height:18px;padding:0;border:0;border-radius:0;background:transparent;color:#fff;font-size:16px;line-height:18px;text-align:center;cursor:pointer;opacity:.88}.nf-vfc-item-delete:hover{background:transparent;color:#fff;opacity:1}
      .nf-vfc-main{position:relative;min-width:100%;max-width:calc(100% + 14px);min-height:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:minmax(0,1fr);gap:14px;margin-top:-14px;margin-right:-14px;width:calc(100% + 14px);height:100%;padding:12px 12px 16px;background:#090a0a;overflow:hidden}
      .nf-vfc-panel{min-width:0;min-height:0;display:grid;grid-template-rows:49px minmax(0,1fr);overflow:hidden}.nf-vfc-panel-head{display:flex;align-items:center;justify-content:flex-start;gap:8px;color:#f8fafc;font-size:14px;font-weight:400}.nf-vfc-panel-head small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(232,239,246,.62);font-size:11px;font-weight:400;line-height:1}
      .nf-vfc-preview{min-width:0;min-height:0;display:grid;place-items:center;overflow:hidden;border:1px solid #262626;background:transparent}
      .nf-vfc-preview video,.nf-vfc-preview img{display:block;max-width:94%;max-height:94%;object-fit:contain;background:#000}.nf-vfc-empty{text-align:center;color:#777;font-size:12px;line-height:1.8}
      #${ROOT_ID} :where(.nf-vfc-upload,.nf-vfc-btn,.nf-vfc-format,.nf-vfc-top-actions button){position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;white-space:nowrap;cursor:pointer;font-size:12px!important;font-weight:400!important;line-height:1!important;transition:none!important}
      #${ROOT_ID} :where(.nf-vfc-upload,.nf-vfc-btn,.nf-vfc-format,.nf-vfc-top-actions button):not(:disabled):not([disabled]):not([aria-disabled="true"])::after{content:"";position:absolute;inset:0;border-radius:inherit;background:rgba(255,255,255,.045);opacity:0;pointer-events:none;transition:none!important}
      #${ROOT_ID} :where(.nf-vfc-upload,.nf-vfc-btn,.nf-vfc-format,.nf-vfc-top-actions button):not(:disabled):not([disabled]):not([aria-disabled="true"]):hover{filter:brightness(1.08);border-color:rgba(255,255,255,.20)!important}
      #${ROOT_ID} :where(.nf-vfc-upload,.nf-vfc-btn,.nf-vfc-format,.nf-vfc-top-actions button):not(:disabled):not([disabled]):not([aria-disabled="true"]):hover::after{opacity:1}
      #${ROOT_ID} :where(.nf-vfc-upload,.nf-vfc-btn,.nf-vfc-format,.nf-vfc-top-actions button):not(:disabled):not([disabled]):not([aria-disabled="true"]):active{filter:brightness(1.02)}
      #${ROOT_ID} :where(.nf-vfc-upload,.nf-vfc-btn,.nf-vfc-format,.nf-vfc-top-actions button):focus-visible{outline:none}
      #${ROOT_ID} :where(.nf-vfc-upload,.nf-vfc-btn,.nf-vfc-format,.nf-vfc-top-actions button):is(:disabled,[disabled],[aria-disabled="true"]){opacity:.45;cursor:default;filter:none}
      #${ROOT_ID} :where(.nf-vfc-upload,.nf-vfc-btn,.nf-vfc-format,.nf-vfc-top-actions button):is(:disabled,[disabled],[aria-disabled="true"]):hover{filter:none}
      .nf-vfc-top-actions{position:absolute;right:26px;top:14px;display:flex;gap:8px}#${ROOT_ID} .nf-vfc-top-actions button{width:102px;height:36px;padding:0 12px;border:0;border-radius:8px;background:linear-gradient(135deg,rgba(30,166,114,.96),rgba(30,166,114,.92));color:#effcf5;font-size:12px!important;font-weight:400!important;line-height:normal!important}#${ROOT_ID} .nf-vfc-top-actions button:disabled{opacity:.45;cursor:default;filter:none}
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
    return Array.from(document.querySelectorAll('button[aria-pressed="true"], [role="button"][aria-pressed="true"], button[data-state="active"], [role="button"][data-state="active"]')).some((node) => (
      node instanceof HTMLElement && textOf(node) === '工具' && node.getBoundingClientRect().left < 110
    ))
  }

  function primarySectionButtonFromEvent(event) {
    const target = event.target instanceof Element ? event.target : null
    const button = target ? target.closest('button,[role="button"]') : null
    if (!(button instanceof HTMLElement) || !PRIMARY_SECTION_LABELS.includes(textOf(button))) return null
    const rect = button.getBoundingClientRect()
    return rect.left < 110 && rect.top > 40 && rect.width > 0 ? button : null
  }

  function handlePrimarySectionClick(event) {
    const button = primarySectionButtonFromEvent(event)
    if (!button || textOf(button) === '工具') return
    deactivate()
    document.querySelector(`[${BUTTON_ATTR}="1"]`)?.remove()
  }

  function findWorkspace() {
    // The tools workspace as the app marks it (its grid moved to a flex row,
    // which the shape test below no longer recognises).
    const marked = document.querySelector('[data-novaflow-tools-workspace]')
    if (marked instanceof HTMLElement && marked.getBoundingClientRect().width > 500) return marked
    const candidates = Array.from(document.querySelectorAll('div')).filter((node) => {
      const rect = node.getBoundingClientRect()
      const text = textOf(node)
      const style = getComputedStyle(node)
      return rect.left >= 300 && rect.width > 900 && rect.height > 600
        && style.display === 'grid' && style.gridTemplateColumns.startsWith('220px ')
        && text.includes('原图') && text.includes('结果图')
        && (text.includes('PNG 压缩预览') || text.includes('JPG 压缩预览'))
    })
    return candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect()
      const br = b.getBoundingClientRect()
      return ar.width * ar.height - br.width * br.height
    })[0] || null
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

  // Directly below MP4 压缩, falling back to above SPINE 图集转换 while that entry has not mounted
  // yet. Which patch module's interval fires first is not fixed, so the slot is re-checked on every
  // pass instead of being trusted from the one insert -- but only written when it is actually
  // wrong, or the nudge would feed the brand runtime's mutation observer once a second.
  function placeEntry(list, button) {
    const mp4Entry = document.querySelector(`[${MP4_ENTRY_ATTR}="1"]`)
    if (mp4Entry instanceof HTMLElement && mp4Entry.parentElement === list) {
      if (mp4Entry.nextElementSibling !== button) list.insertBefore(button, mp4Entry.nextSibling)
      return
    }
    const spineEntry = document.querySelector(`[${SPINE_ENTRY_ATTR}="1"]`)
    if (spineEntry instanceof HTMLElement && spineEntry.parentElement === list) {
      if (spineEntry.previousElementSibling !== button) list.insertBefore(button, spineEntry)
      return
    }
    if (list.lastElementChild !== button) list.appendChild(button)
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
    if (existing instanceof HTMLElement) {
      if (existing.parentElement === jpg.parentElement) placeEntry(jpg.parentElement, existing)
      if (state.active) setEntryVisual(true)
      return
    }
    const button = jpg.cloneNode(true)
    button.setAttribute(BUTTON_ATTR, '1')
    button.setAttribute('data-novaflow-tools-entry', TOOL_ID)
    button.removeAttribute('data-novaflow-tools-entry-listener')
    button.removeAttribute('data-novaflow-tools-entry-active')
    button.textContent = '视频格式转换'
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); activate() })
    placeEntry(jpg.parentElement, button)
    setEntryVisual(false)
    ;['PNG 压缩', 'JPG 压缩'].forEach((label) => {
      const nativeButton = findEntry(label)
      if (nativeButton?.getAttribute('data-novaflow-video-format-convert-bound') === '1') return
      nativeButton?.setAttribute('data-novaflow-video-format-convert-bound', '1')
      nativeButton?.addEventListener('click', deactivate, true)
    })
  }

  async function readFile(file) {
    const url = URL.createObjectURL(file)
    objectUrls.push(url)
    // Chromium refuses HEVC, AVI and a few others, and that is exactly what this tool is for:
    // a source it cannot decode gets no inline preview, but ffmpeg still converts it.
    const meta = await new Promise((resolve) => {
      const node = document.createElement('video')
      node.preload = 'metadata'
      node.onloadedmetadata = () => resolve({ width: node.videoWidth || 0, height: node.videoHeight || 0, durationSec: Number.isFinite(node.duration) ? node.duration : 0, playable: true })
      node.onerror = () => resolve({ width: 0, height: 0, durationSec: 0, playable: false })
      node.src = url
    })
    let filePath = ''
    try { filePath = String(window.electronAPI?.getPathForFile?.(file) || file.path || '') } catch (_) {}
    const ext = String(file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || 'video'
    return { id: `${Date.now()}_${Math.random().toString(16).slice(2)}`, name: file.name, ext, filePath, url, bytes: file.size || 0, ...meta, status: '等待转换', progress01: 0, result: null }
  }

  async function addFiles(files) {
    const videos = Array.from(files || []).filter(isVideoFile)
    for (const file of videos) state.items.push(await readFile(file))
    if (!state.selectedId && state.items[0]) state.selectedId = state.items[0].id
    render()
  }

  function bindProgress() {
    if (stopProgress || typeof window.electronAPI?.onVideoToolProgress !== 'function') return
    stopProgress = window.electronAPI.onVideoToolProgress((data) => {
      const item = state.items.find((entry) => entry.jobId && entry.jobId === data?.jobId)
      if (!item) return
      item.progress01 = clamp(Number(data?.progress01) || 0, 0, 1)
      item.status = `正在转换… ${Math.round(item.progress01 * 100)}%`
      paintItem(item)
      paintControls()
    })
  }

  async function processAll() {
    if (state.processing || !state.items.length) return
    const api = window.electronAPI
    if (!api?.convertVideoFormat) { alert('视频格式转换能力未加载，请重启 NovaFlow 后重试。'); return }
    const missing = state.items.filter((item) => !item.filePath)
    if (missing.length) { alert(`视频格式转换需要本地文件路径，以下文件缺少原路径：${missing.slice(0, 6).map((item) => item.name).join('、')}${missing.length > 6 ? '…' : ''}`); return }
    bindProgress()
    state.processing = true
    render()
    for (const item of state.items) {
      item.jobId = `vfc_${item.id}`
      item.progress01 = 0
      item.status = '正在转换… 0%'
      paintItem(item)
      paintControls()
      try {
        const result = await api.convertVideoFormat({ jobId: item.jobId, inputPath: item.filePath, fileName: item.name, format: state.format, scalePct: state.scalePct })
        if (!result?.ok) throw new Error(result?.error || '视频格式转换失败')
        const preview = await api.videoResourceMediaRegister?.({ filePath: result.outPath })
        item.result = {
          srcPath: result.outPath,
          fileName: result.fileName || outputName(item.name, state.format),
          format: result.format || state.format,
          bytesOut: result.bytesOut,
          url: preview?.ok ? preview.url : '',
          token: preview?.ok ? preview.token : ''
        }
        item.status = `已转换为 ${String(item.result.format).toUpperCase()}`
      } catch (error) {
        item.result = null
        item.status = String(error?.message || error || '转换失败')
      }
      item.progress01 = 1
      paintItem(item)
      if (item.id === (state.selectedId || state.items[0]?.id)) paintResultPanel()
      paintControls()
    }
    state.processing = false
    render()
  }

  async function exportAll() {
    const ready = state.items.filter((item) => item.result?.srcPath)
    const api = window.electronAPI
    if (!ready.length || state.exporting) return
    if (!api?.saveVideoToolOutput) { alert('导出能力未加载，请重启 NovaFlow 后重试。'); return }
    state.exporting = true
    paintControls()
    try {
      const saved = await api.saveVideoToolOutput({ items: ready.map((item) => ({ srcPath: item.result.srcPath, fileName: item.result.fileName })) })
      if (saved?.canceled) return
      if (saved?.ok === false) throw new Error(saved?.error || '导出失败')
      alert(`已导出 ${ready.length} 个转换结果。`)
    } catch (error) {
      alert(String(error?.message || error || '导出失败'))
    } finally {
      state.exporting = false
      paintControls()
    }
  }

  function releaseItemPreview(item) {
    if (item?.url) {
      try { URL.revokeObjectURL(item.url) } catch (_) {}
      objectUrls = objectUrls.filter((url) => url !== item.url)
    }
    if (item?.result?.token) {
      try { window.electronAPI?.videoResourceMediaRelease?.({ token: item.result.token }) } catch (_) {}
    }
  }

  function clearAll() {
    state.items.forEach(releaseItemPreview)
    objectUrls.forEach((url) => { try { URL.revokeObjectURL(url) } catch (_) {} })
    objectUrls = []
    state.items = []
    state.selectedId = ''
    try { window.electronAPI?.clearVideoToolOutput?.({ tool: 'video-convert' }) } catch (_) {}
    render()
  }

  function removeItem(id) {
    const index = state.items.findIndex((item) => item.id === id)
    if (index < 0 || state.processing) return
    releaseItemPreview(state.items[index])
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

  function selectedItem() {
    return state.items.find((item) => item.id === state.selectedId) || state.items[0] || null
  }

  function itemMetaText(item) {
    const size = item.result ? `${formatBytes(item.bytes)} → ${formatBytes(item.result.bytesOut)}` : formatBytes(item.bytes)
    return `${size}｜${escapeHtml(item.status)}`
  }

  // Converting takes long enough that a full re-render on every progress tick would restart
  // whatever the user is watching in the preview, so ticks patch the rows and the buttons in place.
  function paintItem(item) {
    const root = document.getElementById(ROOT_ID)
    const meta = root?.querySelector(`[data-vfc-item="${item.id}"] .nf-vfc-item-meta`)
    if (!(meta instanceof HTMLElement)) return
    meta.innerHTML = itemMetaText(item)
    meta.classList.toggle('done', Boolean(item.result))
  }

  function paintControls() {
    const root = document.getElementById(ROOT_ID)
    if (!root) return
    const done = state.items.filter((item) => item.result).length
    const busy = state.processing || !state.items.length
    const run = root.querySelector('[data-vfc-run]')
    if (run instanceof HTMLButtonElement) { run.disabled = busy; run.textContent = state.processing ? '转换中…' : `转换为 ${state.format.toUpperCase()}` }
    const clear = root.querySelector('[data-vfc-clear]')
    if (clear instanceof HTMLButtonElement) clear.disabled = busy
    root.querySelectorAll('[data-vfc-format]').forEach((button) => { if (button instanceof HTMLButtonElement) button.disabled = state.processing })
    const slider = root.querySelector('[data-vfc-scale]')
    if (slider instanceof HTMLInputElement) slider.disabled = state.processing
    const count = root.querySelector('.nf-vfc-count')
    if (count instanceof HTMLElement) count.textContent = `已选 ${state.items.length} 个｜完成 ${done} 个｜可导出 ${done} 个`
    const status = root.querySelector('.nf-vfc-status')
    if (status instanceof HTMLElement) status.textContent = state.processing ? '正在按顺序转换视频，请稍候…' : ''
    const exportButton = root.querySelector('[data-vfc-export]')
    if (exportButton instanceof HTMLButtonElement) { exportButton.disabled = state.exporting || !done; exportButton.textContent = state.exporting ? '导出中…' : '导出另存' }
  }

  function resultPanelHtml(item) {
    if (!item?.result) return '<div class="nf-vfc-empty">等待转换结果<br>分辨率按缩放比例走原片，帧率和时长保持不变。</div>'
    if (!item.result.url) return `<div class="nf-vfc-empty">转换完成<br>${escapeHtml(formatBytes(item.result.bytesOut))}</div>`
    if (item.result.format === 'gif') return `<img src="${escapeHtml(item.result.url)}" alt="${escapeHtml(item.result.fileName)}">`
    return `<video src="${escapeHtml(item.result.url)}" controls preload="metadata"></video>`
  }

  function resultHeadHtml(item) {
    if (!item?.result) return ''
    return `${String(item.result.format).toUpperCase()}｜${formatBytes(item.bytes)} → ${formatBytes(item.result.bytesOut)}`
  }

  function paintResultPanel() {
    const root = document.getElementById(ROOT_ID)
    const panel = root?.querySelector('[data-vfc-result-preview]')
    const head = root?.querySelector('[data-vfc-result-head]')
    const item = selectedItem()
    if (panel instanceof HTMLElement) panel.innerHTML = resultPanelHtml(item)
    if (head instanceof HTMLElement) head.textContent = resultHeadHtml(item)
  }

  function sourcePanelHtml(item) {
    if (!item) return '<div class="nf-vfc-empty">还没有视频</div>'
    if (!item.playable) return `<div class="nf-vfc-empty">${escapeHtml(String(item.ext).toUpperCase())} 无法在界面内预览<br>转换仍然由 ffmpeg 处理，结果可以正常播放。</div>`
    return `<video src="${escapeHtml(item.url)}" controls preload="metadata"></video>`
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
    const selected = selectedItem()
    const done = state.items.filter((item) => item.result).length
    const active = FORMATS.find((format) => format.id === state.format) || FORMATS[0]
    root.innerHTML = `
      <input data-vfc-file type="file" accept="video/*,${INPUT_EXTENSIONS.join(',')}" multiple hidden>
      <div class="nf-vfc-side">
        <div class="nf-vfc-formats">${FORMATS.map((format) => `<button class="nf-vfc-format ${format.id === state.format ? 'active' : ''}" data-vfc-format="${format.id}" ${state.processing ? 'disabled' : ''}>${format.label}</button>`).join('')}</div>
        <button class="nf-vfc-upload" data-vfc-pick><span class="nf-tool-upload-plus" data-novaflow-plus-glyph="1" aria-hidden="true"></span><span>选择视频</span></button>
        <div class="nf-vfc-controls">
          <label class="nf-vfc-scale"><span>输出尺寸 ${state.scalePct}%</span><input data-vfc-scale data-novaflow-tools-range="1" type="range" min="10" max="200" value="${state.scalePct}" ${state.processing ? 'disabled' : ''}></label>
          <div class="nf-vfc-hint">${escapeHtml(active.note)}</div>
          <div class="nf-vfc-actions"><button class="nf-vfc-btn" data-vfc-run ${state.processing || !state.items.length ? 'disabled' : ''}>${state.processing ? '转换中…' : `转换为 ${active.label}`}</button><button class="nf-vfc-btn alt" data-vfc-clear ${state.processing || !state.items.length ? 'disabled' : ''}>清空</button></div>
          <div class="nf-vfc-count">已选 ${state.items.length} 个｜完成 ${done} 个｜可导出 ${done} 个</div>
          <div class="nf-vfc-status">${state.processing ? '正在按顺序转换视频，请稍候…' : ''}</div>
        </div>
        <div class="nf-vfc-list">${state.items.length ? state.items.map((item) => `<div class="nf-vfc-item ${item.id === selected?.id ? 'active' : ''}" data-vfc-item="${item.id}" role="button" tabindex="0"><div class="nf-vfc-thumb">${escapeHtml(item.ext)}</div><div class="nf-vfc-item-info"><div class="nf-vfc-item-name">${escapeHtml(item.name)}</div><div class="nf-vfc-item-meta ${item.result ? 'done' : ''}">${itemMetaText(item)}</div></div><button class="nf-vfc-item-delete" type="button" data-vfc-delete="${item.id}" aria-label="删除 ${escapeHtml(item.name)}">×</button></div>`).join('') : '<div class="nf-vfc-empty">支持批量转换，MOV / AVI / MKV 等都可以</div>'}</div>
      </div>
      <div class="nf-vfc-main">
        <div class="nf-vfc-panel"><div class="nf-vfc-panel-head"><span>原片</span><small>${selected ? `${selected.width || '?'} × ${selected.height || '?'}｜${formatDuration(selected.durationSec)}｜${formatBytes(selected.bytes)}` : ''}</small></div><div class="nf-vfc-preview">${sourcePanelHtml(selected)}</div></div>
        <div class="nf-vfc-panel"><div class="nf-vfc-panel-head"><span>结果片</span><small data-vfc-result-head>${resultHeadHtml(selected)}</small></div><div class="nf-vfc-preview" data-vfc-result-preview>${resultPanelHtml(selected)}</div></div>
      </div>
      <div class="nf-vfc-top-actions"><button data-vfc-export ${state.exporting || !done ? 'disabled' : ''}>${state.exporting ? '导出中…' : '导出另存'}</button></div>`
    root.querySelector('[data-vfc-pick]')?.addEventListener('click', () => root.querySelector('[data-vfc-file]')?.click())
    root.querySelector('[data-vfc-file]')?.addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = '' })
    root.querySelectorAll('[data-vfc-format]').forEach((button) => button.addEventListener('click', () => {
      if (state.processing) return
      state.format = button.getAttribute('data-vfc-format') || 'mp4'
      render()
    }))
    syncRangeFill(root.querySelector('[data-vfc-scale]'))
    root.querySelector('[data-vfc-scale]')?.addEventListener('input', (event) => {
      state.scalePct = clamp(Math.round(Number(event.target.value) || DEFAULT_SCALE_PCT), 10, 200)
      syncRangeFill(event.target)
      const label = root.querySelector('.nf-vfc-scale span')
      if (label instanceof HTMLElement) label.textContent = `输出尺寸 ${state.scalePct}%`
    })
    root.querySelector('[data-vfc-run]')?.addEventListener('click', processAll)
    root.querySelector('[data-vfc-clear]')?.addEventListener('click', clearAll)
    root.querySelector('[data-vfc-export]')?.addEventListener('click', exportAll)
    root.querySelectorAll('[data-vfc-item]').forEach((item) => {
      item.addEventListener('click', () => { state.selectedId = item.getAttribute('data-vfc-item') || ''; render() })
      item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); state.selectedId = item.getAttribute('data-vfc-item') || ''; render() } })
    })
    root.querySelectorAll('[data-vfc-delete]').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); removeItem(button.getAttribute('data-vfc-delete') || '') }))
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
  const toolsSectionSelected = () => Boolean(document.body?.classList.contains('novaflow-primary-target-tools')) || isToolsSectionActive()
  const observer = new MutationObserver((mutations) => {
    if (!mutations.some(mutationAddsElement)) return
    if (!state.active && !document.querySelector(`[${BUTTON_ATTR}="1"]`) && !toolsSectionSelected()) return
    syncEntryFromMutations()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('resize', syncBounds)
  window.setInterval(() => { if (!document.hidden) ensureEntry() }, 1000)
  ensureEntry()
})()
