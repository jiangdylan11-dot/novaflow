;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.NovaFlowUiDesignPromptPipeline = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'
  // One record per active generator; retain original and manually applied text as equivalent inputs.
  const cache = new Map()
  const QWEN_LAYOUT_MODES = ['preserve', 'partial', 'reflow', 'create']
  const QWEN_VISUAL_MODES = ['style-transfer', 'theme-redesign', 'partial', 'create']
  const QWEN_REFERENCE_ROLES = ['layout', 'style', 'content', 'asset', 'combined']
  function requestsThemeRedesign(input) {
    // The human's theme replacement takes precedence over a style label from
    // the selector or assistant. Negation applies to its nearby action, not an
    // entire request such as "不要旧主题，换成深海主题".
    const actions = /(?:更换|切换|改变|重设|重做|重新设计|改成|改为|换)(?:成|为|一个|个)?[^，。；;,\r\n]{0,16}主题|主题(?:更换|切换|改成|改为|换成|换为|重设|重做|重设计|重新设计)|\b(?:(?:change|replace|switch|reset|redesign)\s+(?:(?:the|this|current|old)\s+)?theme|theme[- ]?redesign|re[- ]?theme)\b/giu
    return String(input.prompt || '').split(/[，。；;,\r\n]/u).some(clause => {
      for (const match of clause.matchAll(actions)) {
        const prefix = clause.slice(Math.max(0, match.index - 24), match.index)
        if (/(?:不要|不需要|不必|不用|无需|无须|并非|不是|不想|不希望|未要求|勿|不)(?:再|去|把|将|要|进行|直接)?\s*$/u.test(prefix)
          || /\b(?:no|not|without|don't|do not|never|avoid)\s+(?:(?:a|any|the)\s+)?$/iu.test(prefix)) continue
        // "只换画风并保留原主题" is about the style, not a theme action.
        if (/保留|保持|沿用/u.test(match[0])) continue
        return true
      }
      return false
    })
  }
  function themePreserveFacts(facts, redesignForms = false) {
    return facts.filter(fact => {
      // A planner's source-frame measurements must not turn a new theme into
      // a recolour of the same boxes. Human-specified measurements still win.
      if (redesignForms && !/用户指定|用户明确/u.test(fact) && /轮廓|外形|框形|矩形|圆角|边框|外框|长宽|宽高|大小|尺寸|面积|占比|比例|精确坐标/u.test(fact)) return false
      if (/新主题|新人物|新物品|新符号|新标题|用户指定|替换后|目标主题/u.test(fact)) return true
      const geometry = /位置|区域|面积|占比|尺寸|布局|数量|行列|层级/u.test(fact)
      if (geometry && !/身份|人设|标题文字|文案|原主题|旧主题/u.test(fact)) return true
      return !/(?:原|旧)(?:人物|角色|物品|符号|图案|标题|主题)|(?:人物|角色|物品|符号|图案|标题|主题).{0,12}(?:身份|保持原样|保持不变|不变)/u.test(fact)
    })
  }
  function normalizeQwenPlan(value, input) {
    const count = input.references?.length || 0
    const fail = () => { throw new Error('Qwen 2.1 UI 设计规划不完整，请重试；本次未提交生成') }
    if (!value || value.version !== 1 || !QWEN_LAYOUT_MODES.includes(value.layoutMode) || !QWEN_VISUAL_MODES.includes(value.visualMode)) fail()
    const layoutReference = value.layoutReference
    if (!Number.isInteger(layoutReference) || layoutReference < 0 || layoutReference > count) fail()
    if ((value.layoutMode === 'create') !== (layoutReference === 0)) fail()
    const references = value.references
    if (!Array.isArray(references) || references.length !== count) fail()
    const seen = new Set()
    for (const ref of references) {
      if (!ref || !Number.isInteger(ref.index) || ref.index < 1 || ref.index > count || seen.has(ref.index) || !QWEN_REFERENCE_ROLES.includes(ref.role)) fail()
      seen.add(ref.index)
      const source = input.references[ref.index - 1]
      if (source.role === 'layout' && !['layout', 'combined'].includes(ref.role)) fail()
      if (['style', 'color', 'material'].includes(source.role) && ref.role !== 'style') fail()
      if (['character', 'subject', 'asset'].includes(source.role) && ref.role !== 'asset') fail()
    }
    if (layoutReference && !['layout', 'combined', 'content'].includes(references.find(r => r.index === layoutReference)?.role)) fail()
    const editorIndex=input.references.findIndex(ref=>ref.uiLayoutId&&ref.uiStructure?.regions?.length)
    if(editorIndex>=0&&layoutReference!==editorIndex+1)throw new Error('设计规划未采用当前自建布局，本次未提交生成')
    const list = key => {
      if (!Array.isArray(value[key]) || value[key].length > 30 || value[key].some(s => typeof s !== 'string' || !s.trim() || s.length > 800)) fail()
      return value[key].map(s => s.trim())
    }
    const layoutChanges = list('layoutChanges'), preserve = list('preserve')
    const grids = value.grids === undefined ? [] : value.grids
    if (!Array.isArray(grids) || grids.length > 16 || grids.some(g => !g || typeof g.description !== 'string' || !g.description.trim() || g.description.length > 200 || !Number.isInteger(g.columns) || g.columns < 1 || g.columns > 100 || !Number.isInteger(g.rows) || g.rows < 1 || g.rows > 100)) fail()
    if (value.layoutMode === 'partial' && (!layoutChanges.length || !preserve.length)) fail()
    if (value.layoutMode === 'preserve' && layoutChanges.length) fail()
    return { version: 1, layoutMode: value.layoutMode, layoutReference, visualMode: value.visualMode,
      references: [...references].sort((a,b) => a.index-b.index).map(r => ({index:r.index,role:r.role})), layoutChanges, preserve,
      ...(value.grids !== undefined ? {grids:grids.map(g=>({description:g.description.trim(),columns:g.columns,rows:g.rows}))} : {}) }
  }
  function fallbackQwenPlan(input) {
    const sources = input.references || []
    const layoutIndex = sources.findIndex(ref => ref.uiLayoutId && ref.uiStructure?.regions?.length)
    const explicitIndex = sources.findIndex(ref => ref.role === 'layout')
    const ordinaryIndex = sources.findIndex(ref => ['reference', 'content'].includes(ref.role))
    const anchor = layoutIndex >= 0 ? layoutIndex : explicitIndex >= 0 ? explicitIndex : input.preserveLayout !== false ? ordinaryIndex : -1
    const visualMode = requestsThemeRedesign(input) ? 'theme-redesign'
      : input.generationIntent === 'style-transfer' ? 'style-transfer'
      : input.generationIntent === 'iteration' ? 'partial' : 'theme-redesign'
    const references = sources.map((ref, index) => ({ index: index + 1, role: index === anchor ? 'layout'
      : ['style', 'color', 'material'].includes(ref.role) ? 'style'
        : ['character', 'subject', 'asset'].includes(ref.role) ? 'asset'
          : ref.role === 'layout' ? 'layout' : 'content' }))
    return { version: 1, layoutMode: anchor >= 0 ? 'preserve' : 'create', layoutReference: anchor + 1,
      visualMode, references, layoutChanges: [], preserve: [], grids: [] }
  }
  function resolveQwenPlan(value, input) {
    let plan
    try { plan = normalizeQwenPlan(value, input) } catch (error) {
      if (!/规划不完整|未采用当前自建布局/u.test(String(error?.message || error))) throw error
    }
    const fallback = fallbackQwenPlan(input)
    // The selected image or the user's live layout is the editing canvas.
    // A malformed AI contract cannot turn it into a style-only source.
    if (!plan || (fallback.layoutReference
      && (plan.layoutReference !== fallback.layoutReference || plan.layoutMode === 'create'))) return fallback
    if (input.preserveLayout === true && requestsThemeRedesign(input)) {
      return { ...plan, layoutMode: 'preserve', visualMode: 'theme-redesign', layoutChanges: [], preserve: themePreserveFacts(plan.preserve, input.generationIntent !== 'iteration') }
    }
    if (input.preserveLayout === true && input.generationIntent === 'style-transfer') {
      return { ...plan, layoutMode: 'preserve', visualMode: 'style-transfer', layoutChanges: [] }
    }
    return plan
  }
  function compileQwenPlan(result, input) {
    const resolved = resolveQwenPlan(result.uiPlan, input)
    const themeFormRedesign = resolved.visualMode === 'theme-redesign' && resolved.layoutMode === 'preserve' && input.generationIntent !== 'iteration'
    const plan = themeFormRedesign ? { ...resolved, preserve: themePreserveFacts(resolved.preserve, true) } : resolved
    // The layout/content anchor is native image 1. Keep every supplied image in
    // the native edit as well as the planner; role instructions isolate geometry.
    const wireframe=Boolean(input.references[plan.layoutReference-1]?.uiLayoutId)
    const order = input.references.map((_,i) => i + 1)
    if (plan.layoutReference) order.unshift(...order.splice(order.indexOf(plan.layoutReference),1))
    const remap = value => String(value || '').replace(/(?:@?参考图|图)([1-9][0-9]*)|<image([1-9][0-9]*)>/g, (_,n,tag) => { const source = Number(n || tag); const at = order.indexOf(source); if (at < 0) throw new Error('设计规划引用了不存在的参考图'); return '@参考图' + (at + 1) })
    remap(input.prompt) // Validate the source's identifiers without sending a second full request.
    const native = value => remap(value).replace(/@参考图([1-9][0-9]*)/g, (_,n) => order.length === 1 ? '图片' : `<image${n}>`)
    const modelReferences = plan.references.filter(r=>order.includes(r.index))
    const roles = [...modelReferences].sort((a,b) => order.indexOf(a.index)-order.indexOf(b.index)).map(r => {
      const image = order.length === 1 ? '图片' : `<image${order.indexOf(r.index)+1}>`
      const sourceRole = input.references[r.index-1]?.role
      const description = r.index === plan.layoutReference && wireframe
        ? themeFormRedesign
          ? '自建布局定位图，是唯一玩法结构与主要区域锚点依据；只提供锚定区域、分组和数量，不是成品外观或人物物品身份，组件外轮廓与尺寸比例可在定位区域内设计，不保留灰块和占位框'
          : '自建布局定位图，是唯一几何布局依据；只提供区域位置、占比、分组和数量，不是成品外观或人物物品身份，不保留灰块和占位框'
        : r.index === plan.layoutReference
        ? themeFormRedesign
          ? '编辑画布，是唯一玩法结构与主要区域锚点依据；仅保留玩法拓扑、网格行列数量、控件功能、信息层级及主要区域锚点；人物、背景、玩法物品和标题按用户的新主题要求重做，不默认保留旧内容身份'
          : `编辑画布，是唯一几何布局依据，构图和功能布局以它为准；${plan.visualMode==='style-transfer'?'保留原内容，只按要求改变美术表现':plan.visualMode==='theme-redesign'?'仅提供区域位置、占比、网格和功能关系；人物、背景、玩法物品和标题按用户的新主题要求重做，不默认保留旧内容身份':'布局来源，美术按需求重做'}`
        : r.role === 'style'
        ? sourceRole === 'color' ? '配色来源，只参考色彩关系，不复制人物物品、布局或文案'
          : sourceRole === 'material' ? '质感来源，只参考材质纹理与表面细节，不复制人物物品、布局或文案'
            : '风格来源，只迁移美术表现及其强度，不复制人物物品、布局或文案'
        : r.role === 'asset' || r.role === 'content' || r.role === 'combined'
        ? '人物或元素素材来源，只融合用户指定区域所需的身份与内容，不带入素材的背景、布局、文案或额外控件'
        : themeFormRedesign ? '辅助布局参考，只参考用户指定的局部结构与锚点，不改变编辑画布的玩法拓扑与主要区域锚点，不带入无关内容或文案'
          : '辅助布局参考，只参考用户指定的局部关系，不改变编辑画布的整体几何布局，不带入无关内容或文案'
      return `${image}是${description}`
    }).join('；')
    const layout = plan.layoutMode === 'preserve' ? themeFormRedesign
      ? '除用户明确要求改变的部分外，保留玩法拓扑、网格行列数量、控件数量与功能、信息层级及主要区域锚点；锚定区域内可创意重设计标题、主框、奖励栏和按钮的轮廓、尺寸比例与装饰负形，使造型回应新主题。区域锚点不是旧矩形框的固定外轮廓，不要求逐像素复刻原框体；保持文字清晰、点击目标可辨识，装饰不得遮挡玩法内容或控件，不画占位线框。'
      : '除用户明确要求改变的部分外，沿用布局参考的区域位置、面积比例、网格行列及功能数量；在原位置逐区处理视觉，不画占位线框。'
      : plan.layoutMode === 'partial' ? `只调整这些布局项目：${plan.layoutChanges.map(remap).join('；')}。其余区域的位置、占比、数量和功能关系保持参考图，不扩展为整张重新排版。`
      : plan.layoutMode === 'reflow' ? '按用户要求重新组织布局，保留用户指定的功能，不继承参考图未被要求保留的位置。'
      : '没有布局来源，根据用户要求设计完整布局；风格图、人物和物品图不提供布局。'
    // Keep one editing directive. Repeating the source request and every preserved object's
    // appearance invites regeneration instead of preservation (Qwen's official edit guidance).
    const directive = String(result.prompt || '').replace(/(?:^|\n)参考标识[^\n]*/g, '').trim()
    if (!directive) throw new Error('UI 编辑指令为空，本次未提交生成')
    const scope = native(layout)
    const geometry = input.structure?.regions?.length ? `${themeFormRedesign ? '主要区域锚点与用途（定位范围，不锁定组件外轮廓或尺寸比例）' : '模块位置与用途'}：${input.structure.regions.map(r =>
      `${r.purpose || '界面模块'}，左${Math.round(r.x/input.structure.width*100)}%、上${Math.round(r.y/input.structure.height*100)}%、宽${Math.round(r.width/input.structure.width*100)}%、高${Math.round(r.height/input.structure.height*100)}%`).join('；')}` : ''
    const prompt = [native(directive), roles, scope,
      plan.layoutReference ? themeFormRedesign
        ? '用户明确指定的布局调整优先；玩法拓扑、网格行列数量、控件功能、信息层级与主要区域锚点只由编辑画布决定，风格、配色、质感和人物元素图不得重新定义这些结构关系；原有框体形状与装饰只作可替换的视觉参考。'
        : '用户明确指定的布局调整优先；其余区域位置、面积比例、网格数量与功能关系只由编辑画布决定，风格、配色、质感和人物元素图不得重新定义布局。' : '',
      plan.visualMode === 'style-transfer' && !wireframe ? '本次仅改变指定的画风、配色与质感，保留画布内的原人物与物品身份、文案和功能；用户明确指定素材替换的区域按其要求处理。' : '',
      plan.visualMode === 'theme-redesign' && !wireframe ? '本次是主题重设：玩法与布局按上述约束处理；人物、背景、玩法物品与标题按用户明确的新主题和替换要求重新设计，不沿用未被要求保留的旧人设、旧物品或旧标题。未要求改变的金额、规则、控制功能及其状态保持正确；用户明确替换的内容优先于规划中的旧内容保留描述。' : '',
      themeFormRedesign ? '直接设计完整界面，以主要区域锚点保持整体构图与玩法流程；区域内部的框体衔接、视觉轮廓和装饰叠放可按新主题重新设计，不将画面改成整齐的通用格子模板。'
        : '直接设计完整界面，保留参考的整体构图、区域衔接与叠放关系，不将画面改成整齐的通用格子模板。',
      // The native reference carries its arrangement; do not hard-code a vision model's guessed cell counts.
      plan.preserve.length ? `保留这些${themeFormRedesign ? '玩法、功能与区域锚点' : '布局与功能'}事实：${plan.preserve.map(native).join('；')}` : '', geometry,
      wireframe ? '输出完整UI成品，只呈现用户需求指定的最终文案、物品图案与功能控件。布局定位图中的区域名、诊断编号、示例文字、灰块与空白占位仅用于定位，必须删除并替换为对应真实成品元素与功能图标；不得继承定位图中未被用户指定的文字，不得以编号替代物品，不得输出缺少功能图标的空白按钮。'
        : '输出完整UI成品，保留未要求修改的文字与功能。'].filter(Boolean).join('。').replace(/[\r\n]+/g, ' ').replace(/。{2,}/g, '。')
    const modelPlan = { ...plan, layoutReference: plan.layoutReference ? 1 : 0,
      references: modelReferences.map(r => ({ ...r, index: order.indexOf(r.index) + 1 })).sort((a,b) => a.index-b.index),
      layoutChanges: plan.layoutChanges.map(remap), preserve: plan.preserve.map(remap) }
    return { prompt, references: order.map(i => input.references[i-1]), plan: modelPlan, analysisPlan:plan, order }
  }
  function key(input) {
    return JSON.stringify({ contract: 'ui-native-edit-7', provider: input.provider, engine: input.engine || 'grok', targetEngine: input.targetEngine || '', prompt: input.prompt || '', negativePrompt: input.negativePrompt || '', generationIntent: input.generationIntent || '', preserveLayout: input.preserveLayout === true, size: input.size, structure: input.structure, references: (input.references || []).map(r => ({ id: r.id, dataUrl: r.dataUrl || r.imageUrl, role: r.role })) })
  }
  function remember(id, input, result, appliedInput) {
    cache.set(id, { keys: [key(input), ...(appliedInput ? [key(appliedInput)] : [])], result: { ...result } })
    if (cache.size > 16) cache.delete(cache.keys().next().value)
  }
  function aborted() { const error = new Error('任务已中止'); error.name = 'AbortError'; return error }
  async function run(options) {
    const { id, input, signal, assistant } = options
    if (signal?.aborted) throw aborted()
    const previous = cache.get(id)
    if (previous?.keys.includes(key(input))) return { ...previous.result, reused: true }
    let cancel
    const stopped = new Promise((_, reject) => { cancel = () => reject(aborted()); signal?.addEventListener('abort', cancel, { once: true }) })
    try {
      const result = await Promise.race([stopped, Promise.resolve().then(() => assistant.run({...input,signal}))])
      if (signal?.aborted) throw aborted()
      if (!result?.prompt?.trim()) throw new Error('AI 助手未返回可用设计要求')
      remember(id, input, result)
      return { ...result, reused: false }
    } finally { signal?.removeEventListener('abort', cancel) }
  }
  return Object.freeze({ run, remember, key, normalizeQwenPlan, resolveQwenPlan, compileQwenPlan })
})
