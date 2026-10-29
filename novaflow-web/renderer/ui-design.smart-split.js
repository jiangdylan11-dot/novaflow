;(function (root) {
  'use strict'
  const core = root.NovaFlowUiSmartSplitCore
  // Route changes rebuild the UI; keep committed candidates bound to immutable image content.
  const sessionsByDocument = new WeakMap()
  const copy = value => JSON.parse(JSON.stringify(value))
  function contextForPart(part, set) {
    const context = part?.metadata?.legacyUiLayer?.uiSplit || part?.uiSplit
    if (!context) return null
    const state = root.NovaFlowSpineSplitBridge?.getState?.()
    const owner = set || state?.splitSets?.find(s => s.parts?.some(p => p.id === part.id))
    const original = owner?.uiLayerProject?.uiSplitOriginal || owner?.originalUiLayerProject?.uiSplitOriginal
    const resource = root.NovaFlowSpineSplitBridge?.getSourceResource?.(context.sourceResourceId)
    const dataUrl = original?.originalDataUrl || resource?.dataUrl
    return dataUrl ? { ...context, originalDataUrl: dataUrl } : null
  }
  function mount({ leftHost, store, onOpen }) {
    const doc = leftHost.ownerDocument, accordion = root.NovaFlowLeftPanelAccordion
    let sessions = sessionsByDocument.get(doc)
    if (!sessions) { sessions = { candidates: new Map(), hashes: new Map() }; sessionsByDocument.set(doc, sessions) }
    let source, proposal, image, opened = false, busy = false, destroyed = false, controller, operation, mode = 'select', drag, manualActions = 0, refinementAttempts = []
    const make = (tag, text, attrs = {}) => { const node = doc.createElement(tag); if (text) node.textContent = text; for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node }
    const panel = make('section', '', { class: 'nf-panel', 'data-novaflow-ui-smart-split': '1', 'data-open': '0' }); Object.assign(panel.style, accordion.panelStyle())
    const header = make('button', '', { type: 'button', class: 'nf-panel-header' }); Object.assign(header.style, accordion.headerStyle(false))
    const title = make('span'); Object.assign(title.style, accordion.titleStyle())
    const icon = make('i', '', { class: 'fas fa-layer-group' }); Object.assign(icon.style, accordion.iconStyle())
    const label = make('span', '拆图'); Object.assign(label.style, accordion.labelStyle()); title.append(icon, label); header.append(title)
    const arrow = make('i', '', { class: accordion.chevronClass(false) }); Object.assign(arrow.style, accordion.chevronStyle()); header.append(arrow)
    const controls = make('div', '', { class: 'nf-panel-body' }); Object.assign(controls.style, accordion.bodyStyle(false))
    const actions = make('div'); Object.assign(actions.style, { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '6px' })
    const editActions = make('div'); Object.assign(editActions.style, { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px' })
    const footerActions = make('div'); Object.assign(footerActions.style, { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '6px', marginTop: '6px' })
    const note = make('div', '先识别原图，修正选区后批量拆层。'); Object.assign(note.style, { color: '#aaa', fontSize: '11px', lineHeight: '1.5' })
    const selection = make('select', '', { 'aria-label': '选中区域的提取方式', 'data-novaflow-art-generate-select-field': '1' }); Object.assign(selection.style, { width: '100%', minWidth: '0', height: '30px', boxSizing: 'border-box', background: '#292929', color: '#ddd', border: '1px solid #444', borderRadius: '5px', padding: '5px 8px', fontSize: '12px' })
    for (const [value, text] of [['object', '对象轮廓（透明抠图）'], ['panel', '完整区块（保留框内像素）'], ['text', '文字保护（保留框内像素）'], ['group', '组织组（不提取像素）']]) { const option = make('option', text); option.value = value; selection.append(option) }
    const correctionHint = make('div', 'Ctrl 按住拖框添加选区；拖动框移动，拖边角缩放。Shift 多选，Delete 删除，Alt 重画。', { 'data-ui-split-correction-hint': '1' }); Object.assign(correctionHint.style, { color: '#999', fontSize: '11px', lineHeight: '1.5' })
    controls.append(actions, editActions, selection, correctionHint, note, footerActions); panel.append(header, controls)
    const overlay = make('div', '', { 'data-novaflow-ui-split-preview': '1', tabindex: '0', 'aria-label': 'UI 拆图候选画布' }); Object.assign(overlay.style, { position: 'absolute', inset: '0', zIndex: '12', display: 'none', overflow: 'hidden', background: '#242424' })
    const previewImage = make('img', '', { draggable: 'false' }); Object.assign(previewImage.style, { position: 'absolute', objectFit: 'contain', pointerEvents: 'none', userSelect: 'none' })
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); Object.assign(svg.style, { position: 'absolute', touchAction: 'none', overflow: 'visible' }); overlay.append(previewImage, svg)
    const selected = () => proposal?.regions.filter(r => r.selected) || []
    const bridge = () => root.NovaFlowSpineSplitBridge
    const message = (text, error = false) => { note.textContent = text; note.style.color = error ? '#fca5a5' : '#aaa' }
    function button(text, action, allowBusy = false, host = actions, primary = false) {
      const b = make('button', text, { type: 'button', 'data-foart-action': primary ? 'primary' : 'neutral' }); Object.assign(b.style, { width: '100%', minWidth: '0', height: '30px', minHeight: '30px', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid ' + (primary ? '#17a582' : '#343434'), borderRadius: '6px', color: '#e9e9e9', background: primary ? '#17a582' : '#262626', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' })
      b.addEventListener('click', () => { if (busy && !allowBusy) return; try { Promise.resolve(action()).catch(error => message(error.message, true)) } catch (error) { message(error.message, true) } }); host.append(b); return b
    }
    const recognizeButton = button('对象识别', recognize, false, actions, true)
    button('添加选区', () => { mode = 'add'; message('在原图上拖出遗漏区域。') }, false, editActions)
    button('删除选区', removeSelectedCandidates, false, editActions)
    const splitButton = button('确认拆图', split, false, footerActions, true)
    const cancelButton = button('取消', () => { cancelOperation(); cancelDrag(); opened = false; render() }, true, footerActions)
    selection.addEventListener('change', () => { for (const region of selected()) { region.kind = selection.value; region.manualEdits++; } manualActions++; render() })
    header.addEventListener('click', () => {
      cancelDrag(); cancelOperation(); opened = !opened
      if (opened) { onOpen?.(); activateCurrent().catch(error => message(error.message, true)) }
      render()
    })
    const onOtherPanel = event => { if (event.target.closest?.('.nf-panel-header') && !panel.contains(event.target)) { cancelOperation(); cancelDrag(); opened = false; render() } }
    leftHost.addEventListener('click', onOtherPanel, true)
    function removeSelectedCandidates() {
      if (!opened || busy || drag || !proposal) return false
      const ids = new Set(selected().map(r => r.id)); if (!ids.size) return false
      proposal.regions = proposal.regions.filter(r => !ids.has(r.id)); manualActions++; mode = 'select'; render(); return true
    }
    function handleCandidateDelete(event) {
      if (event.key !== 'Delete' || event.ctrlKey || event.metaKey || event.altKey || leftHost.getAttribute('data-psd-fusion-ui') !== '1') return
      const target = event.target
      if (target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')) return
      if (removeSelectedCandidates()) { event.preventDefault(); event.stopPropagation() }
    }
    overlay.addEventListener('keydown', handleCandidateDelete); panel.addEventListener('keydown', handleCandidateDelete)
    function handleCandidateEscape(event) {
      if (event.key !== 'Escape' || !drag || event.target?.isContentEditable || event.target?.closest?.('input, textarea, select, [contenteditable]')) return
      cancelDrag(); render(); event.preventDefault(); event.stopPropagation()
    }
    overlay.addEventListener('keydown', handleCandidateEscape); panel.addEventListener('keydown', handleCandidateEscape)
    function currentMatches(snapshot) {
      const state = bridge()?.getState?.()
      return state?.source?.dataUrl === snapshot.dataUrl && (!snapshot.id || state.activeSourceResourceId === snapshot.id) && state.sourceSize?.width === snapshot.width && state.sourceSize?.height === snapshot.height
    }
    const sessionKey = snapshot => snapshot?.sha256 ? snapshot.sha256 + ':' + snapshot.width + 'x' + snapshot.height : ''
    function saveSession() {
      const key = sessionKey(source)
      if (!key || !proposal || busy || drag || destroyed) return
      updateGroups()
      const previous = sessions.candidates.get(key)
      sessions.candidates.set(key, { version: (previous?.version || 0) + 1, source: { ...source }, proposal: copy(proposal), manualActions, refinementAttempts: copy(refinementAttempts) })
    }
    function cancelOperation() { controller?.abort(); controller = null; operation = null; busy = false }
    function beginOperation(snapshot, type) {
      cancelDrag(); saveSession()
      const next = { source: { ...snapshot }, type, controller: new AbortController(), key: sessionKey(snapshot), version: sessions.candidates.get(sessionKey(snapshot))?.version || 0 }
      operation = next; controller = next.controller; busy = true; return next
    }
    function operationCurrent(next) {
      return operation === next && !next.controller.signal.aborted && !destroyed && currentMatches(next.source) && (!next.key || (sessions.candidates.get(next.key)?.version || 0) === next.version)
    }
    function finishOperation(next) {
      if (operation !== next) return
      operation = null; controller = null; busy = false; render()
    }
    function show() {
      accordion.syncExpanded(panel, header, controls, arrow, opened)
      overlay.style.display = opened && proposal ? 'block' : 'none'
      correctionHint.style.display = proposal ? '' : 'none'
    }
    let canvasHost
    function syncHandleSize() {
      const bounds = svg.getBoundingClientRect()
      for (const node of svg.querySelectorAll('[data-resize-x]')) {
        const pixels = node.hasAttribute('data-resize') ? 14 : 6, width = pixels * 1000 / Math.max(1, bounds.width), height = pixels * 1000 / Math.max(1, bounds.height)
        for (const [key, value] of Object.entries({ x: Number(node.getAttribute('data-resize-x')) - width / 2, y: Number(node.getAttribute('data-resize-y')) - height / 2, width, height })) node.setAttribute(key, value)
      }
    }
    function sync() {
      if (destroyed) return
      const active = leftHost.getAttribute('data-psd-fusion-ui') === '1'
      panel.style.display = active ? '' : 'none'
      if (!active && opened) { cancelOperation(); cancelDrag(); opened = false; render() }
      if (source && !currentMatches(source) && !operation?.importing) {
        cancelDrag(); cancelOperation(); saveSession(); source = null; proposal = null; manualActions = 0; refinementAttempts = []
        show()
      }
      const generate = leftHost.querySelector('[data-novaflow-spine-split-control-category="generate"]')
      if (generate && leftHost.getAttribute('data-psd-fusion-ui') === '1' && !panel.isConnected) leftHost.append(panel)
      const content = doc.getElementById('novaflow-spine-split-workspace-content')
      if (content && overlay.parentElement !== content) { if (getComputedStyle(content).position === 'static') content.style.position = 'relative'; content.append(overlay) }
      if (content && content !== canvasHost) {
        canvasObserver.disconnect(); canvasHost = content
        canvasObserver.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
      }
      if (source && content) {
        const art = content.querySelector('[data-novaflow-split-canvas-art="1"]')
        // The existing generation preview composes its fit scale through a CSS variable.
        // Keep that native transform current so right-button pan paints immediately.
        if (art?.hasAttribute('data-novaflow-art-generate-fit-art')) {
          const transform = art.style.getPropertyValue('transform') || 'translate(0px, 0px)'
          if (art.style.getPropertyValue('--novaflow-art-generate-native-transform') !== transform) art.style.setProperty('--novaflow-art-generate-native-transform', transform)
        }
        const bounds = art?.getBoundingClientRect(), host = content.getBoundingClientRect()
        const w = content.clientWidth, h = content.clientHeight, scale = Math.min(w / source.width, h / source.height)
        const width = bounds?.width || source.width * scale, height = bounds?.height || source.height * scale
        const left = bounds?.width ? bounds.left - host.left : (w - width) / 2, top = bounds?.height ? bounds.top - host.top : (h - height) / 2
        for (const node of [previewImage, svg]) Object.assign(node.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' })
        syncHandleSize()
      }
      const current = bridge()?.getState?.()
      if (opened && active && !source && !busy && current?.source?.dataUrl && current.sourceSize) activateCurrent().catch(error => message(error.message, true))
    }
    function updateGroups() {
      if (!proposal) return
      proposal.groups = proposal.regions.filter(r => r.kind === 'group').map(group => {
        const children = proposal.regions.filter(r => r.parentId === group.id), original = group.originalBox || group.box
        group.box = [Math.min(original[0], ...children.map(r => r.box[0])), Math.min(original[1], ...children.map(r => r.box[1])), Math.max(original[2], ...children.map(r => r.box[2])), Math.max(original[3], ...children.map(r => r.box[3]))]
        return { id: group.id, name: group.name, box: group.box, originalBox: original, childIds: children.map(r => r.id), pixelLayer: false }
      })
    }
    function render() {
      if (destroyed) return
      svg.replaceChildren(); if (!proposal) { show(); sync(); return }
      updateGroups()
      svg.setAttribute('viewBox', '0 0 1000 1000'); svg.setAttribute('preserveAspectRatio', 'none')
      for (const region of proposal.regions) {
        const group = doc.createElementNS(svg.namespaceURI, 'g'), rect = doc.createElementNS(svg.namespaceURI, 'rect'), [x, y, right, bottom] = region.box
        const color = ({ object: '#17a582', icon: '#17a582', panel: '#60a5fa', button: '#60a5fa', text: '#f9b454', group: '#c084fc' })[region.kind] || '#17a582'
        for (const [key, value] of Object.entries({ x, y, width: right - x, height: bottom - y, fill: region.kind === 'group' ? 'none' : region.selected ? color + '33' : '#00000008', stroke: color, 'stroke-dasharray': region.kind === 'group' ? '8 5' : 'none', 'stroke-width': region.selected ? 3 : 2, 'vector-effect': 'non-scaling-stroke', 'data-region-id': region.id })) rect.setAttribute(key, value)
        group.append(rect)
        rect.style.cursor = 'move'
        if (region.selected) for (const [direction, hx, hy] of [['nw', x, y], ['n', (x + right) / 2, y], ['ne', right, y], ['e', right, (y + bottom) / 2], ['se', right, bottom], ['s', (x + right) / 2, bottom], ['sw', x, bottom], ['w', x, (y + bottom) / 2]]) {
          const handle = doc.createElementNS(svg.namespaceURI, 'rect'), dot = doc.createElementNS(svg.namespaceURI, 'rect')
          for (const node of [handle, dot]) { node.setAttribute('data-resize-x', hx); node.setAttribute('data-resize-y', hy) }
          for (const [key, value] of Object.entries({ fill: 'transparent', 'data-region-id': region.id, 'data-resize': direction === 'se' ? '1' : direction, 'data-resize-direction': direction })) handle.setAttribute(key, value)
          handle.style.cursor = ['n', 's'].includes(direction) ? 'ns-resize' : ['e', 'w'].includes(direction) ? 'ew-resize' : ['nw', 'se'].includes(direction) ? 'nwse-resize' : 'nesw-resize'
          dot.setAttribute('fill', color); dot.style.pointerEvents = 'none'; group.append(handle, dot)
        }
        svg.append(group)
      }
      selection.disabled = busy || !selected().length
      if (selected().length === 1) selection.value = ['object', 'icon'].includes(selected()[0].kind) ? 'object' : ['group', 'text'].includes(selected()[0].kind) ? selected()[0].kind : 'panel'
      recognizeButton.disabled = busy; splitButton.disabled = busy || !proposal.regions.some(r => r.kind !== 'group'); cancelButton.disabled = false
      saveSession(); show(); sync()
    }
    const point = event => { const rect = svg.getBoundingClientRect(); return [Math.max(0, Math.min(1000, (event.clientX - rect.left) / rect.width * 1000)), Math.max(0, Math.min(1000, (event.clientY - rect.top) / rect.height * 1000))] }
    svg.addEventListener('pointerdown', event => {
      if (busy || !proposal || event.button !== 0) return
      event.preventDefault(); overlay.focus({ preventScroll: true })
      const adding = mode === 'add' || event.ctrlKey
      const redraw = event.altKey && mode === 'select' && !adding
      if (redraw && selected().length !== 1) { message('请先选中一个框，再按 Alt 拖框重画边界'); return }
      const p = point(event), id = event.target.getAttribute('data-region-id'), region = redraw ? selected()[0] : proposal.regions.find(r => r.id === id)
      if (mode === 'divide') { proposal.regions = core.divide(proposal.regions, selected()[0]?.id, event.shiftKey ? 'y' : 'x', p[event.shiftKey ? 1 : 0]); manualActions++; mode = 'select'; render(); return }
      if (!adding && !redraw) { if (!event.shiftKey) for (const r of proposal.regions) r.selected = r === region; else if (region) region.selected = !region.selected }
      drag = { point: p, region: region?.id, box: region?.box.slice(), resize: !!event.target.getAttribute('data-resize'), direction: event.target.getAttribute('data-resize-direction') || 'se', redraw, add: adding, pointer: event.pointerId }
      svg.setPointerCapture(event.pointerId); render()
    })
    svg.addEventListener('pointermove', event => {
      if (!drag || busy) return
      const p = point(event), region = proposal.regions.find(r => r.id === drag.region)
      if (region && !drag.add) {
        const [x, y, right, bottom] = drag.box
        if (drag.redraw) region.box = [Math.min(drag.point[0], p[0]), Math.min(drag.point[1], p[1]), Math.max(drag.point[0], p[0]), Math.max(drag.point[1], p[1])].map(Math.round)
        else if (drag.resize) region.box = [drag.direction.includes('w') ? Math.min(right - 3, p[0]) : x, drag.direction.includes('n') ? Math.min(bottom - 3, p[1]) : y, drag.direction.includes('e') ? Math.max(x + 3, p[0]) : right, drag.direction.includes('s') ? Math.max(y + 3, p[1]) : bottom].map(Math.round)
        else { const dx = Math.max(-x, Math.min(1000 - right, p[0] - drag.point[0])), dy = Math.max(-y, Math.min(1000 - bottom, p[1] - drag.point[1])); region.box = [x + dx, y + dy, right + dx, bottom + dy].map(Math.round) }
        render()
      }
    })
    svg.addEventListener('pointerup', event => {
      if (!drag) return
      const p = point(event)
      if (drag.redraw && (Math.abs(p[0] - drag.point[0]) <= 3 || Math.abs(p[1] - drag.point[1]) <= 3)) proposal.regions.find(r => r.id === drag.region).box = drag.box
      if (drag.add && Math.abs(p[0] - drag.point[0]) > 3 && Math.abs(p[1] - drag.point[1]) > 3) {
        for (const r of proposal.regions) r.selected = false
        const box = [Math.min(p[0], drag.point[0]), Math.min(p[1], drag.point[1]), Math.max(p[0], drag.point[0]), Math.max(p[1], drag.point[1])].map(Math.round)
        const parent = proposal.regions.find(r => r.kind === 'group' && (box[0] + box[2]) / 2 >= r.box[0] && (box[0] + box[2]) / 2 <= r.box[2] && (box[1] + box[3]) / 2 >= r.box[1] && (box[1] + box[3]) / 2 <= r.box[3])
        proposal.regions.push({ id: 'manual_' + Date.now(), name: '补选区域', kind: 'panel', origin: 'manual', parentId: parent?.id || '', box, selected: true, manualEdits: 1 }); manualActions++
      } else if (drag.region && JSON.stringify(proposal.regions.find(r => r.id === drag.region)?.box) !== JSON.stringify(drag.box)) { proposal.regions.find(r => r.id === drag.region).manualEdits++; manualActions++ }
      drag = null; mode = 'select'; render()
    })
    function cancelDrag() {
      if (!drag) { mode = 'select'; return false }
      const pending = drag, region = proposal?.regions.find(r => r.id === pending.region)
      if (region && !pending.add) region.box = pending.box
      drag = null; mode = 'select'
      if (svg.hasPointerCapture?.(pending.pointer)) svg.releasePointerCapture(pending.pointer)
      return true
    }
    svg.addEventListener('pointercancel', () => { if (cancelDrag()) render() })
    svg.addEventListener('lostpointercapture', () => { if (cancelDrag()) render() })
    function recognize() { return activateCurrent({ forceRecognize: true }) }
    async function activateCurrent({ forceRecognize = false } = {}) {
      if (busy || destroyed) return
      const state = bridge()?.getState?.(), current = state?.source
      if (!current?.dataUrl || !state.sourceSize) throw new Error('请先在原图视图拖入一张 UI 原图')
      cancelDrag(); saveSession()
      const snapshot = { id: state.activeSourceResourceId || current.id || '', dataUrl: current.dataUrl, ...state.sourceSize, proposalId: source && currentMatches(source) ? source.proposalId : 'ui_split_' + Date.now().toString(36), sha256: sessions.hashes.get(current.dataUrl) || '' }
      if (!source || !currentMatches(source)) { proposal = null; manualActions = 0; refinementAttempts = [] }
      const next = beginOperation(snapshot, 'recognize'); source = snapshot; message('正在读取原图候选会话…'); render()
      try {
        snapshot.sha256 = snapshot.sha256 || await core.sourceHash(snapshot.dataUrl)
        if (!operationCurrent(next)) return
        sessions.hashes.set(snapshot.dataUrl, snapshot.sha256)
        next.source = { ...snapshot }; next.key = sessionKey(snapshot); next.version = sessions.candidates.get(next.key)?.version || 0
        const saved = sessions.candidates.get(next.key)
        if (saved && !forceRecognize) {
          source = { ...snapshot, proposalId: saved.source.proposalId }; proposal = copy(saved.proposal); manualActions = saved.manualActions; refinementAttempts = copy(saved.refinementAttempts); previewImage.src = source.dataUrl
          message('已恢复本图的候选调整。确认后才拆层。'); return
        }
        if (root.__NovaFlowArtGenerate?.state.running || bridge()?.getState?.().busy) throw new Error('当前有生成或拆图任务运行中，请完成后识别')
        const api = root.electronAPI
        if (typeof api?.promptAssistantReverseImagePrompt !== 'function') throw new Error('本机视觉识别接口不可用，请连接桌面计算节点')
        message('正在调用本机视觉模型识别原图，不预设布局…')
        const result = await api.promptAssistantReverseImagePrompt({ surface: 'ui-design', purpose: 'ui-layer-proposal', visualSchema: 'nf.ui.split.v1', images: [{ name: current.fileName || 'ui.png', role: 'source', dataUrl: snapshot.dataUrl }] })
        if (!operationCurrent(next)) return
        if (result?.ok === false) throw new Error(result.error || '本机视觉识别失败')
        if (result?.data?.validationError) throw new Error(result.data.validationError)
        const parsed = core.validate(result?.data?.proposal || result?.proposal)
        snapshot.proposalId = 'ui_split_' + Date.now().toString(36)
        source = snapshot; proposal = parsed; manualActions = 0; refinementAttempts = []; previewImage.src = source.dataUrl; opened = true
        message('识别出 ' + proposal.regions.length + ' 个区域。拖动/缩放修正，Shift 多选；确认后才拆层。')
      } finally { finishOperation(next) }
    }
    async function refine() {
      if (busy || !proposal) return
      if (!currentMatches(source)) throw new Error('原图已切换，请重新识别')
      const targets = selected().filter(r => ['panel', 'button', 'group'].includes(r.kind))
      if (!targets.length || targets.length > 2) throw new Error('请选中一至两个成组区域再细分')
      if (root.__NovaFlowArtGenerate?.state.running || bridge()?.getState?.().busy) throw new Error('当前有其他任务在运行')
      const next = beginOperation(source, 'refine'); render()
      try {
        for (const parent of targets) {
          if (!operationCurrent(next)) return
          const { crop, dataUrl } = await core.detailCrop(next.source, parent, doc)
          if (!operationCurrent(next)) return
          message('局部识别：' + parent.name + '，原图保持不变…')
          const started = Date.now(), result = await root.electronAPI.promptAssistantReverseImagePrompt({ surface: 'ui-design', purpose: 'ui-layer-proposal', visualSchema: 'nf.ui.split.v1', uiSplitScope: 'children', uiSplitGroupName: parent.name, images: [{ name: parent.id + '-detail.png', role: 'source', dataUrl }] })
          if (!operationCurrent(next)) return
          refinementAttempts.push({ parentId: parent.id, crop, durationMs: Date.now() - started, rawOutput: result?.data?.rawOutput, validationError: result?.data?.validationError || result?.error || '', modelCandidates: result?.data?.proposal?.regions })
          if (result?.ok === false || result?.data?.validationError) throw new Error(result.error || result.data.validationError)
          proposal = core.mapChildren(proposal, parent.id, crop, next.source, result?.data?.proposal || result?.proposal)
          render()
        }
        message('已映射局部子框。虚线父组不提取像素；请检查文字框和对象边缘后确认。')
      } finally { finishOperation(next) }
    }
    async function split() {
      if (busy || !proposal) return
      if (!currentMatches(source)) throw new Error('原图已切换，请重新识别')
      const next = beginOperation(source, 'split'); render()
      try {
        const work = proposal
        if (!work.regions.length) throw new Error('请先选中本次要提取的区域')
        const project = await core.extract(next.source, work, { document: doc, signal: next.controller.signal, cutout: (data, options) => bridge().extractUiObject(data, options), onProgress: ({ index, total, name }) => message('提取 ' + (index + 1) + '/' + total + '：' + name) })
        if (!operationCurrent(next)) return
        next.importing = true
        const imported = await bridge().importUiLayerProject(project, { name: 'UI 智能拆图', activate: true })
        store?.patchProject?.({ uiSmartSplitLast: { sourceResourceId: source.id, sourceSha256: source.sha256, regions: proposal.regions, extractedRegionIds: work.regions.map(r => r.id), manualActions, layerCount: project.layers.length, failures: project.uiSplitFailures, setId: imported.setId } })
        opened = false; message('已拆出 ' + (project.layers.length - 1) + ' 个区域，另保留未补全背景。' + (project.uiSplitFailures.length ? '失败区域：' + project.uiSplitFailures.map(f => f.name + '（' + f.error + '）').join('；') : '') + ' 图层可拖到下方参考区修复。', project.uiSplitFailures.length > 0)
      } finally { finishOperation(next) }
    }
    overlay.addEventListener('wheel', event => {
      const art = canvasHost?.querySelector('[data-novaflow-split-canvas-art="1"]')
      if (!opened || !art) return
      event.preventDefault(); event.stopPropagation()
      if (drag || busy) return
      art.dispatchEvent(new root.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, clientX: event.clientX, clientY: event.clientY }))
      sync()
    }, { passive: false })
    const canvasObserver = new root.MutationObserver(records => { if (records.some(record => record.target !== overlay && !overlay.contains(record.target))) sync() })
    const unsubscribeSources = bridge()?.subscribeSourceResources?.(sync)
    const observer = new root.MutationObserver(sync); observer.observe(leftHost, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-psd-fusion-ui'] })
    const resize = typeof root.ResizeObserver === 'function' ? new root.ResizeObserver(sync) : null
    resize?.observe(leftHost); root.addEventListener('resize', sync)
    sync()
    return { sync, recognize, refine, snapshot: () => ({ source, proposal, refinementAttempts, manualActions, busy }), destroy() { cancelOperation(); cancelDrag(); saveSession(); destroyed = true; unsubscribeSources?.(); canvasObserver.disconnect(); observer.disconnect(); resize?.disconnect(); root.removeEventListener('resize', sync); leftHost.removeEventListener('click', onOtherPanel, true); overlay.removeEventListener('keydown', handleCandidateDelete); panel.removeEventListener('keydown', handleCandidateDelete); overlay.removeEventListener('keydown', handleCandidateEscape); panel.removeEventListener('keydown', handleCandidateEscape); panel.remove(); overlay.remove() } }
  }
  root.NovaFlowUiSmartSplit = Object.freeze({ mount, contextForPart, prepareRepair: context => core.repair(context) })
})(typeof window === 'undefined' ? globalThis : window)
