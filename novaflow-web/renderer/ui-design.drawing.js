/* UI design extends the real image-to-image surface. It owns no generation dock or resource panel. */
;(function (root) {
  'use strict'
  let mounted = null, preparation = null
  const copy = value => JSON.parse(JSON.stringify(value))
  const drawing = () => root.__NovaFlowArtGenerate
  const isActive = () => Boolean(root.document?.body?.classList.contains('novaflow-primary-target-art') && root.document.querySelector('[data-novaflow-art-ui-host="1"]'))
  function outputSize(state) {
    if (state.provider === 'gpt') {
      if (state.gptSize === 'Custom') return { width: state.gptCustomWidth || 1024, height: state.gptCustomHeight || 1024 }
      const preset = /^(\d+)x(\d+)$/.exec(state.gptSize || '')
      if (preset) return { width: Number(preset[1]), height: Number(preset[2]) }
    }
    if (state.provider === 'google') {
      const ratio = /^(\d+):(\d+)$/.exec(state.googleAspectRatioImg2img || '')
      if (ratio) {
        const edge = ({ '1K': 1024, '2K': 2048, '4K': 4096 })[state.googleResolution] || 1024
        const a = Number(ratio[1]), b = Number(ratio[2])
        return { width: Math.round(edge * a / Math.max(a,b)), height: Math.round(edge * b / Math.max(a,b)) }
      }
    }
    return { width: state.width || 1024, height: state.height || 1024 }
  }
  function element(doc, tag, attrs = {}, children = []) {
    const node = doc.createElement(tag)
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'text') node.textContent = value
      else if (key === 'style') Object.assign(node.style, value)
      else node.setAttribute(key, value)
    }
    for (const child of children) node.appendChild(child)
    return node
  }
  function mount({ leftHost, store, getSessionToken }) {
    const doc = leftHost.ownerDocument, accordion = root.NovaFlowLeftPanelAccordion
    let editor, inspector, alive = true, opened = false, frame = 0, lastSize = '', lastLayout = ''
    const host = element(doc, 'div', { 'data-novaflow-ui-layout-overlay': '1', style: { display: 'none', position: 'fixed', zIndex: '2147483000', background: '#222', overflow: 'hidden' } })
    doc.body.appendChild(host)
    const inspectorHost = element(doc, 'div')
    const message = element(doc, 'div', { 'aria-live': 'polite', style: { color: '#a9a9a9', fontSize: '11px', lineHeight: '1.5' } })
    const header = element(doc, 'button', { type: 'button', class: 'nf-panel-header', 'data-novaflow-ui-design-attribute-toggle': '1', style: accordion.headerStyle(false) }, [element(doc, 'span', { style: accordion.titleStyle() }, [element(doc, 'i', { class: 'fas fa-sliders-h', style: accordion.iconStyle() }), element(doc, 'span', { text: '布局编辑', style: accordion.labelStyle() })])])
    const chevron = element(doc, 'i', { class: accordion.chevronClass(false), style: accordion.chevronStyle() })
    header.appendChild(chevron)
    const button = (label, onClick, primary = false) => {
      const node = element(doc, 'button', { type: 'button', text: label, style: { padding: '6px 8px', minHeight: '28px', border: '1px solid ' + (primary ? '#17a582' : '#343434'), borderRadius: '6px', background: primary ? '#17a582' : '#262626', color: '#e9e9e9', fontSize: '11px', cursor: 'pointer' } })
      node.addEventListener('click', onClick)
      return node
    }
    const actions = element(doc, 'div', { style: { display: 'flex', gap: '6px' } }, [button('+ 布局块', () => editor.addBlock()), button('撤销', () => editor.undo()), button('重做', () => editor.redo())])
    const body = element(doc, 'div', { class: 'nf-panel-body', style: accordion.bodyStyle(false) }, [actions, inspectorHost, message, button('生成布局参考', () => {
      editor.useLayout()
      publishLayout(true)
    }, true)])
    const section = element(doc, 'section', { class: 'nf-panel', 'data-novaflow-ui-layout-section': '1', 'data-open': '0', style: accordion.panelStyle() }, [header, body])
    function show(open) {
      opened = open
      accordion.syncExpanded(section, header, body, chevron, opened)
      host.style.display = opened ? 'block' : 'none'
      if (opened) { syncSize(); editor.showLayout(); position() }
    }
    header.addEventListener('click', () => show(!opened))
    function layoutContext() {
      const node = editor?.getLayout(), size = node?.data.canvasSize || { width: 1024, height: 1024 }
      return { node, structure: { ...size, regions: (node?.data.blocks || []).filter(b => b.participates !== false).map(b => ({ ...b })) } }
    }
    function publishLayout(explicit = false) {
      const api = drawing(), { node, structure } = layoutContext()
      if (!node || !api) return
      const refs = api.references(), index = refs.findIndex(ref => ref?.uiLayoutId === node.id)
      if (!explicit && index < 0) return
      if (!structure.regions.length) {
        if (index >= 0) { api.setReference(index, null); api.render({ forceBottom: true }) }
        if (explicit) message.textContent = '请先添加一个布局块'
        return
      }
      const key = JSON.stringify(structure)
      if (!explicit && key === lastLayout) return
      let target = index >= 0 ? index : refs.findIndex(ref => !ref?.dataUrl)
      if (target < 0) target = refs.length
      if (target >= api.referenceLimit()) { message.textContent = '参考图已满，请先移除一张再添加布局'; return }
      const project = store.getState().project
      const guide = root.NovaFlowUiDesignLayoutGuide.createCleanLayoutGuide({ ...project, ...node.data.canvasSize, graph: { ...project.graph, nodes: [node], edges: [] }, blocks: structure.regions })
      api.setReference(target, { id: 'ui-layout-' + node.id, uiLayoutId: node.id, name: '布局参考.png', dataUrl: guide.dataUrl, width: structure.width, height: structure.height, role: 'layout', uiStructure: structure })
      // Layout dimensions are controlled by the same W/H fields, not by a reference-image autosize.
      api.state.referenceSizeFillPending = ''
      lastLayout = key
      api.render({ forceBottom: true })
      message.textContent = '已加入参考图，编辑布局会同步更新'
      if (explicit) show(false)
    }
    function syncSize() {
      if (!editor || !drawing()) return
      const size = outputSize(drawing().state), key = size.width + ':' + size.height
      if (lastSize === key) return
      lastSize = key
      editor.patchGeneratorOutput(editor.getActiveGeneratorId(), size)
    }
    editor = root.NovaFlowUiDesignWorkbench.mount({
      host, layoutOnly: true, getProject: () => store.getState().project,
      getResources: () => store.getState().resources, getResults: () => store.getState().results,
      getGenerationState: () => drawing()?.state || {},
      onProjectChange: project => store.patchProject(project),
      onLayoutChange: () => { if (editor) publishLayout() },
      onSelectionChange: () => inspector?.update(),
    })
    inspector = root.NovaFlowUiDesignInspectorTool.mount({
      host: inspectorHost, compact: true, getProject: () => store.getState().project, getSelection: () => editor.getSelection(),
      onPatchSelection: (selection, patch) => editor.patchSelection(selection, patch),
      onRemoveSelection: () => editor.removeSelection(), onActivateRegionTool: () => editor.addBlock(),
    })
    function position() {
      frame = 0
      if (!alive || !opened) return
      const canvas = doc.querySelector('#novaflow-spine-split-workspace-content')
      const rect = canvas?.getBoundingClientRect()
      if (!rect || rect.width <= 0 || rect.height <= 0) return
      Object.assign(host.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' })
      syncSize()
    }
    const queuePosition = () => { if (!frame) frame = root.requestAnimationFrame(position) }
    let started = false
    function sync() {
      if (!alive) return
      // The drawing runtime may rebuild its accordion; reattach the extension without replacing it.
      const generate = leftHost.querySelector('[data-novaflow-spine-split-control-category="generate"]')
      if (!generate) return
      if (!section.isConnected || section.previousElementSibling !== generate) generate.after(section)
      if (!started && drawing()) { started = true; drawing().activate(drawing().state.running ? undefined : 'img2img') }
      queuePosition()
    }
    const observer = new root.MutationObserver(sync)
    observer.observe(leftHost, { childList: true, subtree: true })
    root.addEventListener('resize', queuePosition)
    root.addEventListener('novaflow:stage-box', queuePosition)
    const onOtherPanel = event => { if (event.target.closest?.('.nf-panel-header') && !section.contains(event.target)) show(false) }
    leftHost.addEventListener('click', onOtherPanel, true)
    const unsubscribe = store.subscribe(() => { try {
      root.localStorage.setItem('novaflow-ui-design-project-v1', JSON.stringify(store.serializeProject()))
      root.localStorage.setItem('novaflow-ui-design-project-initialized-v1', '1')
    } catch {} })
    mounted = { store, editor, getSessionToken, layoutContext, sync }
    sync()
    return {
      workspaceHandle: editor, inspectorHandle: inspector, sync,
      destroy() {
        alive = false; observer.disconnect(); unsubscribe?.(); if (frame) root.cancelAnimationFrame(frame)
        root.removeEventListener('resize', queuePosition); root.removeEventListener('novaflow:stage-box', queuePosition)
        leftHost.removeEventListener('click', onOtherPanel, true)
        inspector.destroy(); editor.destroy(); section.remove(); host.remove()
        if (mounted?.editor === editor) mounted = null
      },
    }
  }
  function inputFor({ state, references, referenceLimit }) {
    const refs = references.filter(ref => ref?.dataUrl)
    if (refs.length > referenceLimit) throw new Error(`当前模型最多支持 ${referenceLimit} 张参考图，请先移除多余图片`)
    const layout = refs.find(ref => ref.uiLayoutId)
    const numbered = new Map()
    references.forEach((ref, slot) => { if (ref?.dataUrl) numbered.set(slot + 1, refs.indexOf(ref) + 1) })
    const prompt = String(state.prompt || '').replace(/(?:@参考图|图)([1-9][0-9]*)/g, (token, number) => {
      if (!numbered.has(Number(number))) throw new Error(`参考图 ${number} 已移除，请更新提示词中的引用`)
      return '@参考图' + numbered.get(Number(number))
    })
    return {
      provider: state.provider || 'local', engine: mounted?.store.getState().settings?.assistantEngine || 'grok',
      prompt, negativePrompt: String(state.negativePrompt || ''),
      size: outputSize(state),
      structure: layout?.uiStructure || { regions: [] },
      references: refs.map((ref, index) => ({ ...ref, id: ref.id || `drawing-ref-${index}`, role: ref.uiLayoutId ? 'layout' : (ref.role || 'reference') })),
      electronAPI: root.electronAPI, getSessionToken: mounted?.getSessionToken,
    }
  }
  async function prepare(context) {
    if (preparation) throw new Error('正在理解 UI 设计需求')
    const controller = new AbortController(), session = mounted
    preparation = controller
    try {
      const originalPrompt = String(context.state.prompt || '')
      const input = inputFor(context)
      if (!input.prompt.trim() && !input.references.length) throw new Error('请输入设计需求或添加参考图')
      const keys = ['mode', 'provider', 'width', 'height', 'count', 'nsfw', 'randomSeed', 'seed', 'loras', 'samplingOverrides', 'localTextQuality', 'localEditStrength', 'negativePrompt', 'gptQualityImg2img', 'gptQualityTxt2img', 'gptSize', 'gptCustomWidth', 'gptCustomHeight', 'googleAspectRatioImg2img', 'googleAspectRatioTxt2img', 'googleResolution']
      const state = copy(Object.fromEntries(keys.filter(key => context.state[key] !== undefined).map(key => [key, context.state[key]])))
      state.localDrawEngine = root.NovaFlowArtGenerateModels?.capabilityFor?.(state.provider, state.mode, state)?.engine || ''
      // With no references the same img2img controls still own the text-only run's cloud settings.
      if (!input.references.length) {
        state.gptQualityTxt2img = state.gptQualityImg2img
        state.googleAspectRatioTxt2img = state.googleAspectRatioImg2img
      }
      const result = await root.NovaFlowUiDesignPromptPipeline.run({ id: 'ui-drawing', input, signal: controller.signal, assistant: root.NovaFlowUiDesignAssistantWorkflow })
      if (controller.signal.aborted) throw new Error('任务已中止')
      const layoutText = input.structure.regions?.length ? `\n布局参考中的模块约束（只约束布局与功能，不把线框画入成品）：\n${JSON.stringify(input.structure)}` : ''
      return {
        promptSnapshot: { prompt: result.prompt + layoutText, negativePrompt: input.negativePrompt || result.negativePrompt || '' },
        references: input.references, originalPrompt, optimizedPrompt: result.prompt, state,
        store: session?.store,
      }
    } finally { if (preparation === controller) preparation = null }
  }
  function openAssistant() {
    const api = drawing()
    if (!api || api.state.running) return false
    api.capturePrompt()
    const context = () => ({ state: api.state, references: api.references(), referenceLimit: api.referenceLimit() })
    const input = inputFor(context())
    const textarea = root.document.querySelector('#novaflow-art-generate-workspace [data-novaflow-art-generate-prompt-kind="positive"] textarea')
    return root.NovaFlowUiDesignAssistantDialog.open({
      documentRef: root.document, workflow: root.NovaFlowUiDesignAssistantWorkflow, ...input,
      state: api.state, promptTextarea: textarea, getPrompt: () => api.state.prompt,
      getReferences: () => inputFor(context()).references, getStructureContext: () => inputFor(context()).structure,
      getInputRevision: () => root.NovaFlowUiDesignPromptPipeline.key(inputFor(context())),
      apply(result) {
        const slots = api.references().map((ref, index) => ref?.dataUrl ? index + 1 : null).filter(Boolean)
        api.state.prompt = result.prompt.replace(/@参考图([1-9][0-9]*)/g, (token, number) => slots[Number(number) - 1] ? '@参考图' + slots[Number(number) - 1] : token)
        if (!api.state.negativePrompt && result.negativePrompt) api.state.negativePrompt = result.negativePrompt
        mounted?.store.patchSettings({ assistantEngine: result.engine || input.engine })
        input.engine = result.engine || input.engine
        root.NovaFlowUiDesignPromptPipeline.remember('ui-drawing', input, result, inputFor(context()))
        api.render({ forceBottom: true })
        return true
      },
    })
  }
  function recordResult(result, prepared) {
    prepared.store?.addResult({ ...result, dataUrl: result.imageUrl, originalUserPrompt: prepared.originalPrompt, optimizedPrompt: prepared.optimizedPrompt })
  }
  root.NovaFlowUiDesignDrawing = Object.freeze({ mount, isActive, inputFor, prepare, openAssistant, recordResult,
    cancelPreparation() { if (!preparation) return false; preparation.abort(); return true },
  })
})(typeof window !== 'undefined' ? window : globalThis)
