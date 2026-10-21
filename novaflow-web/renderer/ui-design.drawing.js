/* UI design extends the real image-to-image surface. It owns no generation dock or resource panel. */
;(function (root) {
  'use strict'
  let mounted = null, preparation = null
  const copy = value => JSON.parse(JSON.stringify(value))
  const drawing = () => root.__NovaFlowArtGenerate
  const isActive = () => Boolean(root.document?.body?.classList.contains('novaflow-primary-target-art') && root.document.querySelector('[data-novaflow-art-ui-host="1"]'))
  function shouldPrepare({ state, references } = {}) {
    if (isActive()) return true
    if (references?.some(ref => ref?.uiSplitContext)) return true
    // The shared Drawing form can receive an explicit interface redesign.
    // A character/scene edit or a style-only change keeps its original route.
    if (!root.document?.body?.classList.contains('novaflow-primary-target-art')) return false
    const prompt = String(state?.prompt || '')
    return Array.isArray(references) && references.some(ref => ref?.dataUrl)
      && /(?:UI|界面|老虎机|\bslot(?:\s+machine)?\b)/iu.test(prompt)
      && /布局|\blayout\b/iu.test(prompt)
      && root.NovaFlowUiDesignPromptPipeline.requestsThemeRedesign?.({ prompt, generationIntent: requestIntent(prompt) }) === true
  }
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
    let editor, inspector, alive = true, opened = false, frame = 0, lastSize = '', lastLayout = '', resizing = false, selectionBinding = null
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
    function bindSelection() {
      const selection = editor?.getSelection?.();
      try { selectionBinding = selection ? selectionSourceBinding(selection, drawing()?.references?.() || [], drawing()?.state?.prompt) : null }
      catch { selectionBinding = null }
    }
    editor = root.NovaFlowUiDesignWorkbench.mount({
      host, layoutOnly: true, getProject: () => store.getState().project,
      getResources: () => store.getState().resources, getResults: () => store.getState().results,
      getGenerationState: () => drawing()?.state || {},
      onProjectChange: project => store.patchProject(project),
      onLayoutChange: () => { if (editor) publishLayout() },
      onSelectionChange: () => { bindSelection(); inspector?.update() },
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
      smartSplit?.sync()
      // The drawing runtime may rebuild its accordion; reattach the extension without replacing it.
      const generate = leftHost.querySelector('[data-novaflow-spine-split-control-category="generate"]')
      // React may reuse the old Drawing host for one frame. Wait for the UI category
      // set and shared canvas to be mounted before opening generation or measuring it.
      if (!generate || leftHost.getAttribute('data-psd-fusion-ui') !== '1' ||
          [...leftHost.querySelectorAll('[data-novaflow-spine-split-control-category]')].some(node => !['generate', 'split'].includes(node.getAttribute('data-novaflow-spine-split-control-category'))) ||
          !doc.getElementById('novaflow-spine-split-workspace-content')) return
      if (!section.isConnected || section.previousElementSibling !== generate) generate.after(section)
      if (!started && drawing()) { started = true; drawing().activate(drawing().state.running ? undefined : 'img2img') }
      layers?.sync()
      queuePosition()
    }
    const smartSplit = root.NovaFlowUiSmartSplit?.mount({ leftHost, store, onOpen: () => show(false) })
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
    const layers = root.NovaFlowUiDesignLayers?.mount({ leftHost, store, onOpen: () => show(false) })
    mounted = { store, editor, getSessionToken, layoutContext, sync, syncSize, getSelectionBinding: () => selectionBinding }
    bindSelection()
    sync()
    return {
      workspaceHandle: editor, inspectorHandle: inspector, sync,
      destroy() {
        alive = false; smartSplit?.destroy(); observer.disconnect(); unsubscribe?.(); if (frame) root.cancelAnimationFrame(frame)
        root.removeEventListener('resize', queuePosition); root.removeEventListener('novaflow:stage-box', queuePosition)
        leftHost.removeEventListener('click', onOtherPanel, true)
        layers?.destroy(); inspector.destroy(); editor.destroy(); section.remove(); host.remove()
        if (mounted?.editor === editor) { preparation?.abort(); mounted = null }
      },
    }
  }
  function explicitlyChangesLayout(prompt) {
    const affirmative = String(prompt || '').replace(/不(?:要|用|必|需要)?(?:改变|修改|重做|更改|调整)(?:页面|界面)?布局|不(?:要|用|必|需要)?重新(?:布局|排版)|(?:布局|排版)(?:不变|不改|不要改)/g, '')
    return /重新布局|重新排版|(?:改变|修改|重做|更改|调整)布局|布局[^，。；;,\r\n]{0,8}(?:改成|改为|换成|重新|重做|调整)|不(?:需要|用)?保留布局|不要沿用.{0,6}布局|自由(?:布局|排版)/i.test(affirmative)
  }
  function assignExplicitReferenceRoles(references, prompt) {
    const assigned = new Map()
    const declarations = /(?:@?参考图|图)([1-9][0-9]*)\s*(?:只\s*)?(?:是|为|作为|用作|作)\s*((?:(?:主|副|主要|次要|辅助)\s*)?(?:风格(?:[／/]材质)?|画风|材质|质感|配色|布局|角色(?:身份)?|主体|素材|内容))/g
    for (const match of String(prompt || '').matchAll(declarations)) {
      const prefix = String(prompt).slice(0, match.index).split(/[。；;\n]/).pop()
      if (/(?:不要|不应|不能|不允许|禁止).{0,8}$/.test(prefix)) continue
      const index = Number(match[1]) - 1, source = references[index]
      if (!source || source.uiLayoutId || (source.role && source.role !== 'reference')) continue
      const label = match[2], role = /材质|质感/.test(label) ? 'material'
        : /风格|画风/.test(label) ? 'style' : /布局/.test(label) ? 'layout'
          : /角色/.test(label) ? 'character' : /主体/.test(label) ? 'subject'
            : /配色/.test(label) ? 'color' : /素材/.test(label) ? 'asset' : 'content'
      if (assigned.has(index) && assigned.get(index) !== role) throw new Error('参考图' + (index + 1) + '被指定为不同用途，请保留一个明确用途')
      assigned.set(index, role)
    }
    return references.map((reference, index) => assigned.has(index) ? { ...reference, role: assigned.get(index) } : reference)
  }
  function requestIntent(prompt) { if (/局部(?:修改|调整|替换)|\b(?:edit|replace|change) (?:only )?(?:the )?selected\b/iu.test(prompt)) return 'iteration'; if (!explicitLocalEdit(prompt) && root.NovaFlowUiDesignPromptPipeline.requestsThemeRedesign?.({ prompt })) return 'redesign'; return /(?:不(?:需要|用|必)?保留任何(?:元素|内容|东西)|无需保留任何|(?:全部|整体)重做|整(?:个|张)\s*(?:UI|界面).{0,8}重新设计|start over)/i.test(prompt)
        ? 'redesign'
        : /(?:风格迁移|只.{0,8}(?:风格|画风)|(?:换|更换|改变|转换|切换).{0,8}(?:画风|风格)|(?:画风|风格).{0,8}(?:改成|换成|改为)|style.?transfer)/i.test(prompt) ? 'style-transfer'
        : /(?:其他|其它|其余|剩余|其[他它]部分).{0,12}(?:不变|保持|保留)|(?:只|仅)(?:修改|调整|替换|更改)|\b(?:only (?:change|edit|replace)|keep .{0,24}unchanged)\b/i.test(prompt) ? 'iteration' : 'redesign' }
  function explicitLocalEdit(prompt) { return /(?:只|仅)(?:修改|调整|替换|更改)|局部(?:修改|调整|替换)|\bonly (?:change|edit|replace)\b/iu.test(prompt) }
  function selectedEditRegion(selection) {
    if (selection?.kind !== 'block' || !selection.block) return null
    const size = selection.node?.data?.canvasSize, block = selection.block
    const w = Number(size?.width), h = Number(size?.height)
    const values = [block.x, block.y, block.width, block.height].map(Number)
    if (![w,h].every(Number.isFinite) || !(w > 0 && h > 0) || values.some(n => !Number.isFinite(n)) || values[0] < 0 || values[1] < 0 || values[2] <= 0 || values[3] <= 0 || values[0] + values[2] > w || values[1] + values[3] > h) throw new Error('选中的修改区域超出画板，请调整范围后再生成')
    if (values[2] * values[3] >= w * h * .999) throw new Error('局部修改区域不能覆盖整个画板')
    return { x: values[0] / w, y: values[1] / h, width: values[2] / w, height: values[3] / h, source: 'layout-selection', blockId: String(block.id || selection.blockId || '') }
  }
  async function editReferenceFill(reference, region) {
    const image = await new Promise((resolve, reject) => { const image = new root.Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('修改底图无法读取')); image.src = reference.dataUrl })
    const w = Number(image.naturalWidth || image.width), h = Number(image.naturalHeight || image.height)
    const canvas = root.document.createElement('canvas'); canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
    const x = Math.floor(region.x * w), y = Math.floor(region.y * h), right = Math.min(w - 1, Math.ceil((region.x + region.width) * w) - 1), bottom = Math.min(h - 1, Math.ceil((region.y + region.height) * h) - 1)
    const pixels = [[x,y],[right,y],[x,bottom],[right,bottom]].map(([px,py]) => ctx.getImageData(px,py,1,1).data)
    const channel = n => Math.round(pixels.reduce((sum,p) => sum + p[n], 0) / pixels.length)
    return (channel(0) << 16) | (channel(1) << 8) | channel(2)
  }
  function selectionSourceBinding(selection, references, prompt) {
    const region = selectedEditRegion(selection)
    if (!region) return null
    const assigned = assignExplicitReferenceRoles(references, prompt)
    const refs = root.NovaFlowUiDesignPromptPipeline.requireLayoutReferences(assigned.filter(ref => ref?.dataUrl && !ref.uiLayoutId))
    const base = refs.find(ref => ref.role === 'layout')
    return JSON.stringify({ baseId: base?.id || '', dataUrl: base?.dataUrl || '', nodeId: selection.node?.id || selection.nodeId || '', blockId: region.blockId, canvasSize: selection.node.data.canvasSize })
  }
  function inputFor({ state, references, referenceLimit, selection }) {
    const intent = requestIntent(String(state.prompt || ''))
    const selected = selection === undefined ? mounted?.editor?.getSelection?.() : selection
    const editRegion = (state.provider || 'local') === 'local' && intent === 'iteration' ? selectedEditRegion(selected) : null
    if (editRegion) {
      const size = outputSize(state), canvas = selected.node.data.canvasSize
      if (![size.width,size.height].every(n => Number.isInteger(Number(n)) && Number(n) >= 64 && Number(n) <= 4096 && Number(n) % 8 === 0) || Number(size.width) !== Number(canvas.width) || Number(size.height) !== Number(canvas.height)) throw new Error('修改区域与输出尺寸不匹配，请核对尺寸并重新选区')
      if (mounted && mounted.getSelectionBinding?.() !== selectionSourceBinding(selected, references, state.prompt)) throw new Error('修改底图或画板尺寸已变化，请重新选中修改区域；本次未提交生成')
    }
    // For an edit, the selected block supplies geometry, not a competing guide bitmap.
    if (editRegion) references = references.map(ref => ref?.uiLayoutId ? null : ref)
    const live = mounted?.layoutContext?.()
    // Editor blocks are drafts until the user publishes a real guide reference.
    // Refresh only that published layout; an imported screen keeps authority
    // when no guide exists, including after the user removes a former guide.
    const published = references.some(ref => ref?.dataUrl && live?.node?.id && ref.uiLayoutId === live.node.id)
    const liveStructure = modelStructure(published ? live?.structure : undefined)
    const snapshot = snapshotLayoutReferences(references, live?.node?.id, liveStructure, referenceLimit)
    if (!snapshot.length) root.NovaFlowUiDesignPromptPipeline.requireLayoutReferences(snapshot)
    const numbered = new Map()
    let occupied = 0
    references.forEach((ref, slot) => { if (ref?.dataUrl) numbered.set(slot + 1, ++occupied) })
    const prompt = String(state.prompt || '').replace(/(?:@?参考图|图)([1-9][0-9]*)/g, (token, number) => {
      if (!numbered.has(Number(number))) throw new Error(`参考图 ${number} 已移除，请更新提示词中的引用`)
      return '@参考图' + numbered.get(Number(number))
    })
    const refs = root.NovaFlowUiDesignPromptPipeline.requireLayoutReferences(assignExplicitReferenceRoles(snapshot, prompt))
    const layout = refs.find(ref => ref.uiLayoutId)
    return {
      uiCatalogEnabled: true, provider: state.provider || 'local', engine: mounted?.store.getState().settings?.assistantEngine || 'local',
      targetEngine: (state.provider || 'local') === 'local' ? root.NovaFlowArtGenerateModels?.capabilityFor?.('local', state.mode, state)?.engine || '' : '',
      prompt, negativePrompt: String(state.negativePrompt || ''),
      preserveLayout: refs.length > 0 && !explicitlyChangesLayout(prompt),
      generationIntent: intent,
      editRegion,
      size: outputSize(state),
      structure: editRegion ? modelStructure({ ...outputSize(state), regions: [{ x: editRegion.x * outputSize(state).width, y: editRegion.y * outputSize(state).height, width: editRegion.width * outputSize(state).width, height: editRegion.height * outputSize(state).height, purpose: '本次选中的局部修改区域；其余区域保持' }] }) : modelStructure(layout?.uiStructure),
      references: refs.map((ref, index) => ({ ...ref, ...(ref.uiStructure ? { uiStructure: modelStructure(ref.uiStructure) } : {}), id: ref.id || `drawing-ref-${index}`, role: ref.uiLayoutId ? 'layout' : (ref.role || 'reference') })),
      electronAPI: root.electronAPI, getSessionToken: mounted?.getSessionToken,
    }
  }
  function snapshotLayoutReferences(references, layoutId, structure, limit) {
    const refs=references.filter(ref=>ref?.dataUrl).map(ref=>({...ref}))
    const current=refs.findIndex(ref=>layoutId && ref.uiLayoutId===layoutId)
    if(current>=0 && structure?.regions?.length) {
      const create=root.NovaFlowUiDesignLayoutGuide?.createCleanLayoutGuide
      if(typeof create!=='function')throw new Error('布局图生成组件未就绪，本次未提交生成')
      const guide=create({width:structure.width,height:structure.height,blocks:structure.regions})
      if(!guide?.dataUrl)throw new Error('布局图未生成，本次未提交生成')
      refs[current]={...refs[current],uiLayoutId:layoutId,name:'布局参考.png',dataUrl:guide.dataUrl,width:structure.width,height:structure.height,role:'layout',uiStructure:copy(structure)}
    }
    if(refs.length>limit)throw new Error(`当前模型最多支持 ${limit} 张参考图${refs.some(ref=>ref.uiLayoutId)?'（包含自建布局图）':''}，请先移除多余图片`)
    return refs
  }
  async function prepare(context) {
    const repair = root.NovaFlowUiSmartSplit?.prepareRepair(context)
    if (repair) return repair
    if (preparation) throw new Error('正在理解 UI 设计需求')
    const controller = new AbortController(), session = mounted
    preparation = controller
    try {
      const originalPrompt = String(context.state.prompt || '')
      const originalSurface = context.generationSurface
      const input = inputFor(context)
      const selectedBase = input.editRegion ? input.references.find(ref => ref.role === 'layout') : null
      const revision = root.NovaFlowUiDesignPromptPipeline.key(input)
      function assertCurrent() {
        if (controller.signal.aborted || session !== mounted) throw new Error('任务已中止')
        const current = context.getCurrentContext ? context.getCurrentContext() : context
        if (originalSurface !== undefined && current.generationSurface !== originalSurface) throw new Error('生成页面已切换；旧设计任务未提交')
        if (root.NovaFlowUiDesignPromptPipeline.key(inputFor(current)) !== revision) throw new Error('参考图、设计要求、尺寸或选区已变化，请重新生成；旧结果未应用')
      }
      async function alive(task) {
        assertCurrent()
        let stop
        const stopped = new Promise((_, reject) => { stop = () => reject(new Error('任务已中止')); controller.signal.addEventListener('abort', stop, { once: true }) })
        try { const value = await Promise.race([Promise.resolve().then(task), stopped]); assertCurrent(); return value }
        finally { controller.signal.removeEventListener('abort', stop) }
      }
      if (!input.prompt.trim() && !input.references.length) throw new Error('请输入设计需求或添加参考图')
      if (input.generationIntent === 'iteration' && input.targetEngine !== 'qwen-2.1') throw new Error('当前生成方式不支持原生局部选区；任务未提交，不会退为全图编辑')
      if (input.targetEngine === 'qwen-2.1' && input.generationIntent === 'iteration' && !input.editRegion) throw new Error('请先在布局编辑中选中要修改的区域；局部修改不会改成全图生成')
      const keys = ['mode', 'provider', 'width', 'height', 'count', 'nsfw', 'randomSeed', 'seed', 'loras', 'samplingOverrides', 'localTextQuality', 'localEditStrength', 'negativePrompt', 'gptQualityImg2img', 'gptQualityTxt2img', 'gptSize', 'gptCustomWidth', 'gptCustomHeight', 'googleAspectRatioImg2img', 'googleAspectRatioTxt2img', 'googleResolution']
      const state = copy(Object.fromEntries(keys.filter(key => context.state[key] !== undefined).map(key => [key, context.state[key]])))
      state.nsfw = false
      state.uiRunIntent = input.generationIntent
      state.uiPreserveLayout = input.preserveLayout
      state.localDrawEngine = root.NovaFlowArtGenerateModels?.capabilityFor?.(state.provider, state.mode, state)?.engine || ''
      const result = await root.NovaFlowUiDesignPromptPipeline.run({ id: 'ui-drawing', input, signal: controller.signal, assistant: root.NovaFlowUiDesignAssistantWorkflow })
      assertCurrent()
      if (input.targetEngine === 'qwen-2.1') {
        const compiled = root.NovaFlowUiDesignPromptPipeline.compileQwenPlan(result, input)
        const partial = compiled.plan.visualMode === 'partial' || compiled.plan.layoutMode === 'partial' || input.generationIntent === 'iteration'
        if (partial && !input.editRegion) throw new Error('请先在布局编辑中选中要修改的区域')
        if (partial && (!selectedBase || compiled.references[0]?.id !== selectedBase.id || compiled.references[0]?.dataUrl !== selectedBase.dataUrl)) throw new Error('编译后的修改底图与选区绑定不匹配，请重新选区；任务未提交')
        const neutralize = partial && /替换|改成|换成|补回|重画|重新绘制|\b(?:replace|change .{0,60} to|turn .{0,60} into)\b/iu.test(input.prompt)
        const nativeEdit = partial ? { regions: [input.editRegion], baseSourceId: compiled.references[0].id, neutralizeConditioning: neutralize, fillColor: neutralize ? await alive(() => editReferenceFill(compiled.references[0], input.editRegion)) : 0x808080 } : null
        state.uiLayoutMode = compiled.plan.layoutMode
        state.uiNativeEditPrompt = true
        state.localUiEngine = input.targetEngine
        state.uiPreserveLayout = ['preserve', 'partial'].includes(compiled.plan.layoutMode)
        state.uiRunIntent = partial ? 'iteration' : compiled.plan.visualMode === 'theme-redesign' ? 'redesign' : compiled.plan.visualMode === 'create' ? 'redesign' : 'style-transfer'
        if (nativeEdit) { state.uiPreserveLayout = true; state.uiLayoutMode = 'partial' }
        const styleSamples = root.NovaFlowUiDesignStyleReference;
        if (!styleSamples?.prepare) throw new Error('风格参考处理器未加载，生成未提交');
        const fullDesignLanguage = !partial && root.NovaFlowUiDesignPromptPipeline.requestsFormRedesign?.(input) === true && !root.NovaFlowUiDesignPromptPipeline.requestsFormPreservation?.(input);
        const references = compiled.uiCatalog ? compiled.references : await alive(() => styleSamples.prepare(compiled.references, compiled.plan, { preservePageDesignLanguage: fullDesignLanguage }));
        if (controller.signal.aborted) throw new Error('生成已终止');
        styleSamples.show(references);
        return { promptSnapshot: { prompt: compiled.prompt, negativePrompt: input.negativePrompt || result.negativePrompt || '' },
          references, sourceReferences: compiled.references, originalPrompt, optimizedPrompt: result.prompt, uiPlan: compiled.plan, analysisUiPlan:compiled.analysisPlan, uiCatalog:compiled.uiCatalog || null, nativeEdit, state, assertCurrent, store: session?.store }
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
        references: input.references, originalPrompt, optimizedPrompt: result.prompt, state, assertCurrent,
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
  function generationOptions(prepared) {
    if (!prepared?.uiPlan) return {}
    return { taskProfile: 'ui-design', ...(prepared.nativeEdit ? { uiNativeEdit: copy(prepared.nativeEdit) } : {}), referenceRoles: prepared.uiPlan.references.map(ref => ({
      index: ref.index - 1, role: ref.role, sourceId: prepared.references[ref.index - 1]?.id,
    })) }
  }
  function recordResult(result, prepared) {
    prepared.store?.addResult({ ...result, dataUrl: result.imageUrl, originalUserPrompt: prepared.originalPrompt, optimizedPrompt: prepared.optimizedPrompt, uiPlan: prepared.uiPlan || null, analysisUiPlan:prepared.analysisUiPlan || null, uiCatalog:prepared.uiCatalog || null, referenceTreatments:(prepared.references || []).map(ref=>ref.uiReferenceTreatment).filter(Boolean) })
  }
  root.NovaFlowUiDesignDrawing = Object.freeze({ mount, isActive, shouldPrepare, inputFor, selectedEditRegion, snapshotLayoutReferences, prepare, openAssistant, recordResult, generationOptions,
    syncOutputSize() { mounted?.syncSize() },
    cancelPreparation() { if (!preparation) return false; preparation.abort(); return true },
  })
})(typeof window !== 'undefined' ? window : globalThis)
