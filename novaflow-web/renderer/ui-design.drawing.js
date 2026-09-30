/* UI design extends the real image-to-image surface. It owns no generation dock or resource panel. */
;(function (root) {
  'use strict'
  let mounted = null, preparation = null
  const copy = value => JSON.parse(JSON.stringify(value))
  const drawing = () => root.__NovaFlowArtGenerate
  const isActive = () => Boolean(root.document?.body?.classList.contains('novaflow-primary-target-art') && root.document.querySelector('[data-novaflow-art-ui-host="1"]'))
  function modelStructure(value = {}) {
    return {
      width: value.width, height: value.height,
      regions: (value.regions || []).map(block => ({
        x: block.x, y: block.y, width: block.width, height: block.height,
        purpose: [...new Set([block.purpose || block.description, block.requirements].map(text => String(text || '').trim()).filter(Boolean))].join('\n'),
      })),
    }
  }
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
    let editor, inspector, alive = true, opened = false, frame = 0, lastSize = '', lastLayout = '', resizing = false
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
    const actions = element(doc, 'div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' } }, [button('+ 布局块', () => editor.addBlock())])
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
      return { node, structure: modelStructure({ ...size, regions: node?.data.blocks || [] }) }
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
      const guide = root.NovaFlowUiDesignLayoutGuide.createCleanLayoutGuide({ width: structure.width, height: structure.height, blocks: structure.regions })
      api.setReference(target, { id: 'ui-layout-' + node.id, uiLayoutId: node.id, name: '布局参考.png', dataUrl: guide.dataUrl, width: structure.width, height: structure.height, role: 'layout', uiStructure: structure })
      // Layout dimensions are controlled by the same W/H fields, not by a reference-image autosize.
      api.state.referenceSizeFillPending = ''
      lastLayout = key
      if (!resizing || !api.refreshReferences?.()) api.render({ forceBottom: true })
      message.textContent = '已加入参考图，编辑布局会同步更新'
      if (explicit) show(false)
    }
    function syncSize() {
      if (!editor || !drawing()) return
      const size = outputSize(drawing().state), key = size.width + ':' + size.height
      if (lastSize !== key) {
        lastSize = key
        resizing = true
        try { editor.patchGeneratorOutput(editor.getActiveGeneratorId(), size); inspector?.update() }
        finally { resizing = false }
      }
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
      // React may reuse the old Drawing host for one frame. Wait for the UI category
      // set and shared canvas to be mounted before opening generation or measuring it.
      if (!generate || leftHost.getAttribute('data-psd-fusion-ui') !== '1' ||
          leftHost.querySelectorAll('[data-novaflow-spine-split-control-category]').length !== 1 ||
          !doc.getElementById('novaflow-spine-split-workspace-content')) return
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
    mounted = { store, editor, getSessionToken, layoutContext, sync, syncSize }
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
  function explicitlyChangesLayout(prompt) {
    const affirmative = String(prompt || '').replace(/不(?:要|用|必|需要)?(?:改变|修改|重做|更改|调整)(?:页面|界面)?布局|不(?:要|用|必|需要)?重新(?:布局|排版)|(?:布局|排版)(?:不变|不改|不要改)/g, '')
    return /重新布局|重新排版|(?:改变|修改|重做|更改|调整)布局|布局.{0,8}(?:改成|改为|换成|重新|重做|调整)|不(?:需要|用)?保留布局|不要沿用.{0,6}布局|自由(?:布局|排版)/i.test(affirmative)
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
      targetEngine: (state.provider || 'local') === 'local' ? root.NovaFlowArtGenerateModels?.capabilityFor?.('local', state.mode, state)?.engine || '' : '',
      prompt, negativePrompt: String(state.negativePrompt || ''),
      preserveLayout: refs.length > 0 && !explicitlyChangesLayout(prompt),
      generationIntent: /(?:不(?:需要|用|必)?保留任何(?:元素|内容|东西)|无需保留任何|(?:全部|整体)重做|整(?:个|张)\s*(?:UI|界面).{0,8}重新设计|start over)/i.test(prompt)
        ? 'redesign'
        : /(?:风格迁移|只.{0,8}(?:风格|画风)|(?:换|更换|改变|转换|切换).{0,8}(?:画风|风格)|(?:画风|风格).{0,8}(?:改成|换成|改为)|style.?transfer)/i.test(prompt) ? 'style-transfer'
        : /(?:其他|其它|其余|剩余|其[他它]部分).{0,12}(?:不变|保持|保留)|(?:只|仅)(?:修改|调整|替换|更改)|\b(?:only (?:change|edit|replace)|keep .{0,24}unchanged)\b/i.test(prompt) ? 'iteration' : 'redesign',
      size: outputSize(state),
      structure: modelStructure(layout?.uiStructure),
      references: refs.map((ref, index) => ({ ...ref, ...(ref.uiStructure ? { uiStructure: modelStructure(ref.uiStructure) } : {}), id: ref.id || `drawing-ref-${index}`, role: ref.uiLayoutId ? 'layout' : (ref.role || 'reference') })),
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
      state.nsfw = false
      state.uiRunIntent = input.generationIntent
      state.uiPreserveLayout = input.preserveLayout
      state.localDrawEngine = root.NovaFlowArtGenerateModels?.capabilityFor?.(state.provider, state.mode, state)?.engine || ''
      // With no references the same img2img controls still own the text-only run's cloud settings.
      if (!input.references.length) {
        state.gptQualityTxt2img = state.gptQualityImg2img
        state.googleAspectRatioTxt2img = state.googleAspectRatioImg2img
      }
      const result = await root.NovaFlowUiDesignPromptPipeline.run({ id: 'ui-drawing', input, signal: controller.signal, assistant: root.NovaFlowUiDesignAssistantWorkflow })
      if (controller.signal.aborted) throw new Error('任务已中止')
      if (input.targetEngine === 'qwen-2.1') {
        const compiled = root.NovaFlowUiDesignPromptPipeline.compileQwenPlan(result, input)
        state.uiLayoutMode = compiled.plan.layoutMode
        state.uiPreserveLayout = ['preserve', 'partial'].includes(compiled.plan.layoutMode)
        state.uiRunIntent = compiled.plan.visualMode === 'theme-redesign' ? 'redesign' : compiled.plan.visualMode === 'partial' ? 'iteration' : compiled.plan.visualMode === 'create' ? 'redesign' : 'style-transfer'
        return { promptSnapshot: { prompt: compiled.prompt, negativePrompt: input.negativePrompt || result.negativePrompt || '' },
          references: compiled.references, originalPrompt, optimizedPrompt: result.prompt, uiPlan: compiled.plan, state, store: session?.store }
      }
      const layoutText = input.structure.regions?.length ? `\n布局参考中的模块约束（只约束布局与功能，不把线框画入成品）：\n${JSON.stringify(input.structure)}` : ''
      const intentText = input.generationIntent === 'style-transfer'
        ? '本次是风格迁移：保留内容参考图的功能、文字、人物身份、姿势和物品；未要求改变的区域布局、网格行列及数量不变，只改变用户要求的画风、配色、材质和组件视觉。风格图只提供视觉语言，不带入它的内容或布局。'
        : input.generationIntent === 'iteration'
        ? '本次是局部修改，只修改用户指定部分，保留用户要求不变的区域。'
        : '本次是完整 UI 重新设计。参考图提供用户指定的布局、风格或素材，不是必须保留的原图。除用户明确要求保留的内容外，按目标主题重新设计背景、人物、符号、面板、按钮和装饰；不能只给原人物换衣服或只修改局部。'
      const designText = input.preserveLayout
        ? (input.generationIntent === 'style-transfer'
          ? result.prompt.match(/\[视觉规范\]([\s\S]*)/)?.[1]
          : result.prompt.match(/\[区域设计\]([\s\S]*)/)?.[1]) || result.prompt
        : result.prompt
      const prompt = [
        input.preserveLayout ? '编辑布局参考图中的 UI，在原位置逐区执行用户要求。' : '生成完整的 UI 界面设计图。',
        `用户原始需求（最高优先级）：${input.prompt || '根据参考图生成新的完整 UI 设计'}`,
        intentText,
        input.preserveLayout ? '布局硬约束：完整保留布局参考图的全部区域，包括人物展示区、图标区和底部操作区；相对位置、占比、顺序、叠放关系、图标网格行列数及控件数量不变。视觉重做不等于重新布局，不得删除区域或扩大图标区挤占人物区；按同一区域一一替换所有视觉。' : '',
        `视觉要求：\n${designText}`,
        layoutText,
        '执行优先级：用户原始需求 > 布局参考的功能、分布和数量 > 设计方案。方案中与用户需求冲突的原人物、旧主题、背景、图标或文案不应保留；用户要求不保留任何元素时，全部视觉元素都要重新设计，但未明确要求重排时仍保留布局。',
      ].filter(Boolean).join('\n\n')
      return {
        promptSnapshot: { prompt, negativePrompt: input.negativePrompt || result.negativePrompt || '' },
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
    prepared.store?.addResult({ ...result, dataUrl: result.imageUrl, originalUserPrompt: prepared.originalPrompt, optimizedPrompt: prepared.optimizedPrompt, uiPlan: prepared.uiPlan || null })
  }
  root.NovaFlowUiDesignDrawing = Object.freeze({ mount, isActive, inputFor, prepare, openAssistant, recordResult,
    syncOutputSize() { mounted?.syncSize() },
    cancelPreparation() { if (!preparation) return false; preparation.abort(); return true },
  })
})(typeof window !== 'undefined' ? window : globalThis)
