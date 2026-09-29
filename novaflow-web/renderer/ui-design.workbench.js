/* UI workbench: keep graph persistence compatible, expose a canvas and a reference strip. */
;(function (root) {
  'use strict'
  const copy = value => JSON.parse(JSON.stringify(value))
  const src = value => String(value?.dataUrl || value?.imageUrl || '')
  function mount(options) {
    const host = options.host, doc = host.ownerDocument
    const structure = root.NovaFlowUiDesignStructureTool
    let project = structure.normalize(options.getProject()), graph = project.graph
    let activeId = graph.nodes.find(n => n.type === 'generator')?.id
    let selected = null, view = 'result', shown = options.getResults().at(-1) || null
    let active = true, controls = null, controlKey = '', drag = null, syncingControls = false
    const statuses = new Map(), undoStack = [], redoStack = []
    const el = (tag, attrs = {}, children = []) => {
      const node = doc.createElement(tag)
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'style') Object.assign(node.style, value)
        else if (key === 'text') node.textContent = value
        else node.setAttribute(key, value)
      }
      children.forEach(child => node.appendChild(child))
      return node
    }
    const button = (text, fn, attrs = {}) => {
      const node = el('button', { type: 'button', text, ...attrs })
      node.addEventListener('click', fn)
      return node
    }
    const style = el('style', { text: `
      [data-ui-workbench]{height:100%;display:grid;grid-template-rows:auto minmax(120px,1fr) auto;min-width:0;color:#ddd;background:#202020;font-size:12px}
      [data-ui-workbench] button{border:1px solid #444;background:#292929;color:#ddd;border-radius:6px;padding:6px 10px;cursor:pointer}
      [data-ui-workbench] button:hover{border-color:#17a582}
      [data-ui-workbench] button:focus-visible{outline:2px solid #17a582}
      [data-ui-workbench] [aria-pressed=true]{background:#1c4136;border-color:#17a582}
      [data-ui-workbench-toolbar]{display:flex;gap:8px;padding:8px 12px;align-items:center}
      [data-ui-workbench-stage]{position:relative;display:flex;align-items:center;justify-content:center;min-height:0;overflow:hidden;padding:16px}
      [data-ui-workbench-board]{position:relative;background:#181818;border:1px solid #555;box-shadow:0 8px 28px #0003;touch-action:none;flex-shrink:0}
      [data-ui-workbench-block]{position:absolute;box-sizing:border-box;border:1px solid #17a582;background:#1c4136aa;color:#eee;padding:8px;overflow:hidden;cursor:move;user-select:none}
      [data-ui-workbench-block][aria-selected=true]{border:2px solid #69e5b9}
      [data-ui-workbench-block] small{display:block;opacity:.6;margin-top:5px}
      [data-ui-workbench] [data-ui-resize]{position:absolute;right:0;bottom:0;width:14px;height:14px;padding:0;background:#17a582;border:0;border-radius:0;cursor:nwse-resize}
      [data-ui-workbench-bottom]{background:#1d1d1d;border-top:1px solid #383838;padding:8px 12px;max-height:49vh;overflow:auto}
      [data-ui-workbench-refs]{display:flex;gap:8px;overflow-x:auto;align-items:center;min-height:64px;padding:6px 0}
      [data-ui-workbench-thumb]{position:relative;flex:0 0 82px;max-width:82px;text-align:center}
      [data-ui-workbench-thumb] img{width:76px;height:48px;object-fit:contain;background:#151515;cursor:pointer}
      [data-ui-workbench-thumb] span{display:block;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      [data-ui-workbench-thumb] button{position:absolute;right:0;top:0;padding:0;width:18px;height:18px;background:#111d}
      [data-ui-workbench-message]{color:#a7bcb5;font-size:11px;min-height:16px}
    ` })
    const toolbar = el('div', { 'data-ui-workbench-toolbar': '' })
    const stage = el('div', { 'data-ui-workbench-stage': '', tabindex: '0', 'aria-label': 'UI 画板' })
    const refsHost = el('div', { 'data-ui-workbench-refs': '', 'aria-label': '参考图' })
    const controlsHost = el('div')
    const message = el('div', { 'data-ui-workbench-message': '', 'aria-live': 'polite' })
    const optimization = el('details', { style: { fontSize: '11px', color: '#999' } })
    const bottom = el('div', { 'data-ui-workbench-bottom': '' }, [controlsHost, optimization, message])
    const shell = el('div', { 'data-ui-workbench': '' }, [style, toolbar, stage, bottom])
    host.replaceChildren(shell)
    function status(text, error = false) { message.textContent = text || ''; message.style.color = error ? '#fca5a5' : '#a7bcb5' }
    function generator(id = activeId) { return graph.nodes.find(n => n.id === id && n.type === 'generator') }
    function profile(id = activeId) {
      const node = generator(id)
      return { generationSettings: { ...options.getGenerationState?.(id), ...node?.data?.generationSettings }, output: structure.generatorOutputFromNode(node, project) }
    }
    function layout() {
      const linked = graph.edges.find(e => e.toNodeId === activeId && e.kind === 'layout')
      const draftId = generator()?.data?.workbenchLayoutId
      return graph.nodes.find(n => n.type === 'layout' && n.id === (linked?.fromNodeId || draftId)) || null
    }
    function layoutEnabled() { return graph.edges.some(e => e.toNodeId === activeId && e.kind === 'layout') }
    function save(history = true) {
      if (history) { undoStack.push(copy(project)); if (undoStack.length > 40) undoStack.shift(); redoStack.length = 0 }
      const activeLayout = layout()
      if (layoutEnabled() && !activeLayout?.data.blocks.some(block => block.participates !== false)) {
        graph = { ...graph, edges: graph.edges.filter(edge => !(edge.toNodeId === activeId && edge.kind === 'layout')) }
      }
      project = structure.normalize({ ...project, graph })
      graph = project.graph
      options.onProjectChange(copy(project))
      if (!syncingControls) render()
    }
    function mutate(method, ...args) {
      const result = structure[method](graph, ...args)
      if (!result.ok) { status(result.error, true); return result }
      graph = result.graph
      return result
    }
    function patchGeneratorSettings(id, patch) {
      const node = generator(id)
      if (!node) return { ok: false }
      const result = mutate('updateGraphNode', id, { data: { generationSettings: structure.normalizeGeneratorSettings(patch, node.data.generationSettings) } })
      if (result.ok) save(false)
      return result
    }
    function patchGeneratorOutput(id, output) {
      const result = mutate('updateGraphNode', id, { data: { output } })
      const node = id === activeId ? layout() : null
      if (result.ok && node) {
        const blocks = structure.mapLayoutBlocksToOutput(node.data.blocks, node.data.canvasSize || profile(id).output, output)
        mutate('updateGraphNode', node.id, { data: { blocks, canvasSize: output } })
      }
      if (result.ok) save()
      return result
    }
    function ensureLayout() {
      if (layout()) return layout()
      const created = mutate('createGraphNode', { type: 'layout', title: '布局参考', data: { blocks: [], canvasSize: profile().output } })
      if (!created.ok) return null
      mutate('updateGraphNode', activeId, { data: { workbenchLayoutId: created.node.id } })
      save()
      return layout()
    }
    function selectBlock(id) {
      selected = id
      options.onSelectionChange(id, getSelection())
    }
    function getSelection() {
      const node = layout(), block = node?.data.blocks.find(b => b.id === selected)
      return block ? { kind: 'block', node, nodeId: node.id, block, blockId: block.id, id: block.id } : null
    }
    function showLayout() { ensureLayout(); view = 'layout'; render(); return true }
    function addBlock() {
      const node = ensureLayout()
      if (!node) return
      const size = node.data.canvasSize || profile().output
      const count = node.data.blocks.length
      const block = { id: `block_${Date.now()}_${count}`, name: `模块 ${count + 1}`, purpose: '', requirements: '', x: Math.round(size.width * .05), y: Math.round(size.height * .05), width: Math.round(size.width * .3), height: Math.round(size.height * .3), participates: true }
      mutate('updateGraphNode', node.id, { data: { blocks: [...node.data.blocks, block] } })
      selected = block.id; view = 'layout'; save(); selectBlock(block.id)
    }
    function patchSelection(selection, patch) {
      const node = graph.nodes.find(n => n.id === selection?.nodeId)
      if (!node) return false
      const blocks = node.data.blocks.map(block => {
        if (block.id !== selection.blockId) return block
        const next = { ...block, ...patch }
        if (['x', 'y', 'width', 'height'].some(key => key in patch)) for (const key of ['xNorm','yNorm','wNorm','hNorm']) delete next[key]
        return next
      })
      mutate('updateGraphNode', node.id, { data: { blocks } }); save(); selectBlock(selection.blockId)
      return true
    }
    function removeSelection() {
      const selection = getSelection()
      if (!selection || selection.block.locked) return false
      mutate('updateGraphNode', selection.nodeId, { data: { blocks: selection.node.data.blocks.filter(b => b.id !== selection.blockId) } })
      selected = null; save(); selectBlock(null); return true
    }
    function useLayout() {
      const node = ensureLayout()
      if (!node?.data.blocks.some(b => b.participates !== false)) { status('请先添加一个布局模块', true); return }
      if (!layoutEnabled()) {
        const result = mutate('connectGraph', { fromNodeId: node.id, fromPort: 'layout', toNodeId: activeId, toPort: 'layout', kind: 'layout' })
        if (!result.ok) return
      }
      save(); status('布局参考已启用，后续编辑会自动更新')
    }
    function referenceEntries() {
      return graph.edges.filter(e => e.toNodeId === activeId && ['reference', 'iteration'].includes(e.kind))
        .sort((a,b) => Number(b.kind === 'iteration') - Number(a.kind === 'iteration'))
        .map(edge => {
          const node = graph.nodes.find(n => n.id === edge.fromNodeId)
          const item = node?.type === 'result' ? options.getResults().find(r => r.id === node.data.resultId) : options.getResources().find(r => r.id === node?.data.resourceId)
          return { edge, node, item }
        }).filter(entry => entry.item)
    }
    function addReferenceResource(resource, iteration = false) {
      if (!resource?.id) return { ok: false }
      const existing = referenceEntries().find(e => e.item.id === resource.id)
      if (existing && (!iteration || existing.edge.kind === 'iteration')) { status('这张图已经在参考列表中'); return { ok: true } }
      if (iteration && referenceEntries().length && /(?:参考图|图)\s*[1-9]/.test(profile().generationSettings.prompt || '')) {
        status('设为修改底图会调整参考顺序，请先移除提示词中的图片编号引用', true); return { ok: false }
      }
      const resultItem = options.getResults().some(item => item.id === resource.id)
      let node = graph.nodes.find(n => resultItem ? n.type === 'result' && n.data.resultId === resource.id : n.type === 'reference' && n.data.resourceId === resource.id)
      const before = copy(graph)
      if (iteration) {
        for (const entry of referenceEntries()) if (entry.edge.kind === 'iteration') mutate('removeGraphEdge', entry.edge.id)
        if (existing) mutate('removeGraphEdge', existing.edge.id)
      }
      if (!node) {
        const result = mutate('createGraphNode', { type: resultItem ? 'result' : 'reference', title: resource.name, data: resultItem ? { resultId: resource.id } : { resourceId: resource.id, role: resource.role || 'reference' } })
        if (!result.ok) return result
        node = result.node
      }
      const linked = mutate('connectGraph', { fromNodeId: node.id, fromPort: 'reference', toNodeId: activeId, toPort: iteration ? 'iteration' : 'reference', kind: iteration ? 'iteration' : 'reference' })
      if (!linked.ok) { graph = before; return linked }
      save(); return { ok: true, node }
    }
    function removeReference(entry, index) {
      const settings = profile().generationSettings
      const pattern = /(@?参考图|图)\s*(\d+)/g
      if ([settings.prompt, settings.negativePrompt].some(value => [...String(value || '').matchAll(pattern)].some(m => Number(m[2]) === index + 1))) {
        status(`请先移除提示词中对图${index + 1}的引用，再删除该参考`, true); return
      }
      const patch = {}
      for (const key of ['prompt', 'negativePrompt']) patch[key] = String(settings[key] || '').replace(pattern, (all, prefix, number) => Number(number) > index + 1 ? prefix + (Number(number) - 1) : all)
      mutate('removeGraphEdge', entry.edge.id)
      mutate('updateGraphNode', activeId, { data: { generationSettings: { ...settings, ...patch } } }); save()
    }
    async function importFiles(files) {
      try {
        const before = new Set(options.getResources().map(r => r.id))
        await options.onImportFiles(files)
        for (const resource of options.getResources()) if (!before.has(resource.id)) addReferenceResource(resource)
      } catch (error) { status(error.message, true) }
    }
    function renderReferences() {
      refsHost.replaceChildren()
      const input = el('input', { type: 'file', accept: 'image/*', multiple: '', hidden: '' })
      input.addEventListener('change', () => importFiles(Array.from(input.files || [])))
      refsHost.append(button('+ 参考图', () => input.click()), input)
      const thumb = (image, label, onClick, onRemove) => {
        const img = el('img', { src: image, alt: label, tabindex: '0', role: 'button' })
        img.addEventListener('click', onClick)
        img.addEventListener('keydown', e => { if (e.key === 'Enter') onClick() })
        refsHost.append(el('div', { 'data-ui-workbench-thumb': '', title: label }, [img, el('span', { text: label }), button('×', onRemove, { 'aria-label': '移除' + label })]))
      }
      if (layoutEnabled() && layout()) {
        const node = layout(), size = node.data.canvasSize || profile().output
        const guide = root.NovaFlowUiDesignLayoutGuide.createCleanLayoutGuide({ ...project, ...size, graph: { ...graph, nodes: [node], edges: [] }, blocks: node.data.blocks })
        thumb(guide.dataUrl, '布局参考 · 可编辑', showLayout, () => {
          const edge = graph.edges.find(e => e.toNodeId === activeId && e.kind === 'layout')
          mutate('removeGraphEdge', edge.id); save()
        })
      }
      referenceEntries().forEach((entry, index) => thumb(src(entry.item), `图${index + 1} · ${entry.item.name || '参考图'}`, () => showImage(entry.item), () => removeReference(entry, index)))
    }
    function showImage(item) { shown = item; view = 'result'; renderStage(); renderToolbar() }
    function renderToolbar() {
      toolbar.replaceChildren()
      if (layout()) toolbar.append(button('结果', () => { view = 'result'; render() }, { 'aria-pressed': String(view === 'result') }), button('布局', showLayout, { 'aria-pressed': String(view === 'layout') }))
      if (view === 'layout') toolbar.append(button('撤销', undo), button('重做', redo))
      if (shown && view === 'result') {
        toolbar.append(button('加入参考', () => addReferenceResource(shown)))
        if (options.getResults().some(item => item.id === shown.id)) toolbar.append(button('继续修改', () => addReferenceResource(shown, true)))
      }
      const generators = graph.nodes.filter(n => n.type === 'generator')
      if (generators.length > 1) {
        const select = el('select', { 'aria-label': '已保存方案' })
        generators.forEach(n => select.append(el('option', { value: n.id, text: n.title })))
        select.value = activeId
        select.addEventListener('change', () => { activeId = select.value; selectBlock(null); controls?.destroy(); controls = null; render(); options.onActiveGeneratorChange?.() })
        toolbar.append(select)
      }
      toolbar.append(el('span', { text: view === 'layout' ? '点击模块编辑属性 · 拖动调整布局' : '上传参考图并描述需求，即可生成 UI', style: { color: '#888', fontSize: '11px', marginLeft: 'auto' } }))
    }
    function renderStage() {
      if (drag) return
      stage.replaceChildren()
      if (view !== 'layout' || !layout()) {
        stage.append(shown ? el('img', { src: src(shown), alt: shown.name || 'UI 设计结果', style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } }) : el('div', { text: '在这里查看 UI 设计；也可以展开左侧结构生成器规划布局', style: { color: '#777', textAlign: 'center', lineHeight: '1.8', padding: '24px' } }))
        return
      }
      const node = layout(), size = node.data.canvasSize || profile().output
      const output = profile().output
      const rect = stage.getBoundingClientRect()
      const scale = Math.min(Math.max(120, rect.width - 48) / output.width, Math.max(100, rect.height - 40) / output.height)
      const board = el('div', { 'data-ui-workbench-board': '', style: { width: output.width * scale + 'px', height: output.height * scale + 'px' } })
      for (const block of node.data.blocks) {
        const part = el('div', { 'data-ui-workbench-block': block.id, tabindex: '0', role: 'button', 'aria-label': block.name, 'aria-selected': String(selected === block.id), style: { left: block.x / size.width * 100 + '%', top: block.y / size.height * 100 + '%', width: block.width / size.width * 100 + '%', height: block.height / size.height * 100 + '%' } }, [el('span', { text: block.name }), el('small', { text: block.purpose })])
        const start = (event, resizing) => {
          if (event.button !== 0) return
          event.preventDefault(); event.stopPropagation(); selectBlock(block.id)
          board.querySelectorAll('[data-ui-workbench-block]').forEach(n => n.setAttribute('aria-selected', String(n === part)))
          if (block.locked) return
          const bounds = board.getBoundingClientRect()
          drag = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, block: copy(block), selection: getSelection(), size, bounds, part, resizing, patch: null }
          stage.setPointerCapture(event.pointerId)
        }
        part.addEventListener('pointerdown', event => start(event, false))
        part.addEventListener('keydown', e => { if (e.key === 'Enter') { selectBlock(block.id); renderStage() } })
        if (!block.locked) { const resize = button('', () => {}, { 'data-ui-resize': '', 'aria-label': '调整模块大小' }); resize.addEventListener('pointerdown', e => start(e, true)); part.append(resize) }
        board.append(part)
      }
      board.addEventListener('pointerdown', e => { if (e.target === board) { selectBlock(null); renderStage() } })
      stage.append(board)
    }
    stage.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointer) return
      const { block, size, bounds, part } = drag
      const dx = (event.clientX - drag.startX) / bounds.width * size.width, dy = (event.clientY - drag.startY) / bounds.height * size.height
      const clamp = (n, min, max) => Math.round(Math.max(min, Math.min(max, n)))
      drag.patch = drag.resizing ? { width: clamp(block.width + dx, 24, size.width - block.x), height: clamp(block.height + dy, 24, size.height - block.y) } : { x: clamp(block.x + dx, 0, size.width - block.width), y: clamp(block.y + dy, 0, size.height - block.height) }
      for (const [key, val] of Object.entries(drag.patch)) part.style[({x:'left',y:'top'})[key] || key] = val / (['x','width'].includes(key) ? size.width : size.height) * 100 + '%'
    })
    const endDrag = event => {
      if (!drag || event.pointerId !== drag.pointer) return
      const previous = drag; drag = null
      if (stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId)
      if (event.type === 'pointerup' && previous.patch) patchSelection(previous.selection, previous.patch)
      else renderStage()
    }
    stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag); stage.addEventListener('lostpointercapture', endDrag)
    stage.addEventListener('keydown', e => { if (e.key === 'Delete' && e.target === stage) removeSelection() })
    shell.addEventListener('dragover', e => { e.preventDefault() })
    shell.addEventListener('drop', e => {
      e.preventDefault()
      const id = e.dataTransfer?.getData('application/x-novaflow-ui-resource') || e.dataTransfer?.getData('text/novaflow-ui-resource')
      if (id) addReferenceResource(options.getResources().find(r => r.id === id) || options.getResults().find(r => r.id === id))
      else if (e.dataTransfer?.files?.length) importFiles(Array.from(e.dataTransfer.files))
    })
    function renderControls() {
      if (syncingControls) return
      const p = profile(), state = { ...p.generationSettings, ...p.output, running: statuses.get(activeId)?.running === true }
      const key = JSON.stringify([activeId, state])
      if (controls && key === controlKey) return
      controlKey = key
      const id = activeId
      controlsHost.setAttribute('data-novaflow-ui-design-generator-controls', id)
      controls = root.NovaFlowUiDesignGenerateTool.mount({
        host: controlsHost, variant: 'workbench', state, expanded: true, referenceSlot: refsHost,
        getCanvasSize: () => profile(id).output,
        onChange: change => {
          syncingControls = true
          try { patchGeneratorSettings(id, change.snapshot || change.state) } finally { syncingControls = false }
          const current = profile(id)
          controlKey = JSON.stringify([id, { ...current.generationSettings, ...current.output, running: statuses.get(id)?.running === true }])
        },
        onOutputSizeChange: size => patchGeneratorOutput(id, size),
        mountPromptMentions: (textarea, details) => options.mountPromptMentions?.(textarea, { ...details, generatorNodeId: id }),
        onOpenDesignAssistant: payload => options.onOpenDesignAssistant?.({ ...payload, generatorNodeId: id }),
        onStop: () => options.onStopGenerateRequest?.(),
        onGenerate: payload => { patchGeneratorSettings(id, payload.snapshot); return options.onGenerateRequest({ generatorNodeId: id }) },
      })
      const current = statuses.get(id)
      if (current) controls.setStatus(current.message, current)
    }
    function render() {
      if (!active) return
      renderToolbar(); renderStage(); renderReferences(); renderControls()
      const result = generator()?.data?.optimization
      optimization.hidden = !result
      if (result) optimization.replaceChildren(el('summary', { text: '查看上次生成指令' }), el('pre', { text: `原始需求：${result.originalPrompt}\n\n生成指令：${result.prompt}`, style: { whiteSpace: 'pre-wrap', maxHeight: '160px', overflow: 'auto' } }))
    }
    function undo() { if (!undoStack.length) return; redoStack.push(copy(project)); project = undoStack.pop(); graph = project.graph; save(false); selectBlock(null) }
    function redo() { if (!redoStack.length) return; undoStack.push(copy(project)); project = redoStack.pop(); graph = project.graph; save(false); selectBlock(null) }
    if (!activeId) {
      const created = mutate('createGraphNode', { type: 'generator', title: 'UI 设计', data: { generationSettings: options.getGenerationState?.() || {}, output: { width: project.width, height: project.height } } })
      activeId = created.node.id
      // Preserve an existing unconnected layout as an editable draft, without making it required.
      const existingLayout = graph.nodes.find(n => n.type === 'layout')
      if (existingLayout) mutate('updateGraphNode', activeId, { data: { workbenchLayoutId: existingLayout.id } })
      save(false)
    }
    let lastStageSize = ''
    const observer = typeof root.ResizeObserver === 'function' ? new root.ResizeObserver(entries => {
      const rect = entries[0].contentRect
      const size = Math.round(rect.width) + ':' + Math.round(rect.height)
      if (size === lastStageSize) return
      lastStageSize = size
      root.requestAnimationFrame(() => { if (active) renderStage() })
    }) : null
    observer?.observe(stage)
    render()
    return {
      update(value) { if (value) { project = structure.normalize(value); graph = project.graph }; if (!syncingControls) render() },
      destroy() { active = false; observer?.disconnect(); controls?.destroy(); shell.remove() },
      getProject: () => copy(project), getGraph: () => copy(graph), getSelection,
      getActiveGeneratorId: () => activeId, getGeneratorSettings: profile, patchGeneratorSettings, patchGeneratorOutput,
      setGeneratorStatus(id, text, opts = {}) { statuses.set(id || activeId, { message: text, ...opts }); if (!id || id === activeId) { status(text, opts.error); renderControls() } },
      recordOptimization(id, input, result) { mutate('updateGraphNode', id, { data: { optimization: { originalPrompt: input.prompt, prompt: result.prompt, negativePrompt: result.negativePrompt || '', engine: input.engine } } }); save(false) },
      showStatus: status, showImage, showLayout, addBlock, useLayout, patchSelection, removeSelection,
      setTool(tool) { if (tool === 'region') addBlock(); else showLayout() }, getTool: () => 'select',
      addReferenceResource,
      addResultNode(item, sourceNodeId) { const result = mutate('createGraphNode', { type: 'result', data: { resultId: item.id, sourceNodeId } }); if (result.ok) save(false); showImage(item); return result },
      focusGenerator() { controlsHost.scrollIntoView?.({ block: 'nearest' }) }, undo, redo, fit: renderStage, refitIfFitted: renderStage,
    }
  }
  root.NovaFlowUiDesignWorkbench = Object.freeze({ mount })
})(typeof window !== 'undefined' ? window : globalThis)
