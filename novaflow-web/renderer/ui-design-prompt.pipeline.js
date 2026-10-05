;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.NovaFlowUiDesignPromptPipeline = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'
  // One record per active generator; retain original and manually applied text as equivalent inputs.
  const cache = new Map()
  const QWEN_LAYOUT_MODES = ['preserve', 'partial', 'reflow']
  const QWEN_VISUAL_MODES = ['style-transfer', 'theme-redesign', 'partial', 'create']
  const QWEN_REFERENCE_ROLES = ['layout', 'style', 'content', 'asset', 'combined']
  function requireLayoutReferences(values) {
    const references = Array.isArray(values) ? values : []
    if (!references.length) throw new Error('UI 设计必须有布局图，请添加界面布局图片或生成自建布局参考；本次未提交生成')
    const guide = references.findIndex(ref => ref?.uiLayoutId)
    const explicit = references.findIndex(ref => ['layout', 'combined'].includes(ref?.role))
    const ordinary = references.findIndex(ref => !ref?.role || ref.role === 'reference')
    const anchor = guide >= 0 ? guide : explicit >= 0 ? explicit : references.length === 1 ? 0 : ordinary
    if (anchor < 0) throw new Error('UI 设计缺少布局图，请将一张界面图片设为布局参考，或生成自建布局参考；风格和人物素材不能代替布局图，本次未提交生成')
    // The only image is always the layout, including a legacy style label.
    // In a multi-image run use the explicit layout or the first ordinary image.
    return references.map((ref, index) => index === anchor && ref.role !== 'layout' ? { ...ref, role: 'layout' } : ref)
  }
  const FORM_FACT = /造型|构造|轮廓|外形|形状|框形|矩形|圆角|圆形|椭圆|方形|直径|切角|圆点|边框|外框|长宽|宽高|大小|尺寸|面积|占比|比例|精确坐标|四角|角饰|边饰|边角|铆钉|铆接|装饰节点|装饰位置|装饰数量|连接方式|连接结构|连接件|框体衔接|视觉衔接|承托|支撑|底座|独立牌|悬挂|镂空|负形|负空间|\b(?:silhouettes?|shapes?|rectangular|rounded|oval|circular|diameters?|borders?|frames?|four[- ]corner|corner decorations?|studs?|rivets?|plaques?|construction|assembly|joinery|connectors?|connection (?:structure|hardware|style)|supports?|mounts?|suspension|negative space|dimensions?|proportions?|exact coordinates)\b/iu
  const FORM_KEEP = /保留|保持|沿用|沿袭|维持|复刻|不变|不改变|不改动|不得改变|锁定|\b(?:preserve|keep|retain|unchanged|fixed|replicate|do not change|don't change)\b/iu
  const FORM_DONT_KEEP = /(?:不要|不得|不能|不必|不用|无需|勿|不)(?:再)?(?:保留|保持|沿用|沿袭|复刻|锁定)|\b(?:do not|don't|never|avoid|without)\s+(?:(?:the|any|a)\s+)?(?:preserv\w*|keep\w*|retain\w*|replicat\w*)\b/iu
  const FORM_CLAUSE = /[，。；;,\r\n]|\.(?:\s|$)/u
  const FORM_ACTION = /(?:重新设计|重设计|重做|重设|重构|改变|改动|优化)[^，。；;,\r\n]{0,24}(?:造型|构造|轮廓|外形|形状|边框|角饰|连接方式|承托|支撑|负空间)|(?:造型|构造|轮廓|外形|形状|边框|角饰|连接方式|承托|支撑|负空间)[^，。；;,\r\n]{0,16}(?:重新设计|重设计|重做|重设|重构|改变|改动|优化|创新)|\b(?:redesign|reshape|rebuild)\s+(?:(?:the|this|current|old|ui|button|reward)\s+){0,3}(?:forms?|shapes?|silhouettes?|components?|borders?)\b/giu
  function isNegatedAction(clause, match) {
    const prefix = clause.slice(Math.max(0, match.index - 24), match.index)
    return /(?:不要|不需要|不必|不用|无需|无须|并非|不是|不想|不希望|未要求|勿|不)(?:再|去|把|将|要|进行|直接)?\s*$/u.test(prefix)
      || /\b(?:no|not|without|don't|do not|never|avoid)\s+(?:(?:a|any|the)\s+)?$/iu.test(prefix)
  }
  function requestsFormRedesign(input) {
    // Local edits keep their local scope. Only an affirmative human form
    // request can expand a style-labelled run beyond surface restyling.
    if (input.generationIntent === 'iteration') return false
    return String(input.prompt || '').split(/[，。；;,\r\n]/u).some(clause =>
      [...clause.matchAll(FORM_ACTION)].some(match => !isNegatedAction(clause, match)
        && !/(?:造型|构造|轮廓|外形|形状|边框|角饰|连接方式|承托|支撑|负空间).{0,8}(?:不要|不得|不能|不需要|不必|不用|无需|勿|不)(?:再)?(?:改变|改动|重新设计|重设计|重做|优化)/u.test(match[0])))
  }
  function humanFormClauses(prompt) {
    return String(prompt || '').split(FORM_CLAUSE).map(s => s.trim()).filter(s => s && FORM_FACT.test(s))
  }
  function humanPreservesForm(fact, prompt) {
    // A planner cannot authorize its own constraint by prefixing "用户明确".
    // Keep a form fact only when its substance occurs in a human keep request.
    const substance = fact.replace(/^用户(?:明确)?(?:要求|指定)?/u, '').replace(/^(?:keep|preserve|retain)\s+(?:the\s+)?/iu, '').replace(/(?:保持原样|保持不变|保持一致|不变)$/u, '').trim().toLowerCase()
    return substance && humanFormClauses(prompt).some(clause => clause.toLowerCase().includes(substance)
      && (FORM_KEEP.test(clause) || /必须|指定|要求|\bmust\b/iu.test(clause))
      && !FORM_DONT_KEEP.test(clause) && !/去掉|删除|取消|\b(?:remove|delete|discard)\b/iu.test(clause))
  }
  function formIndependentFacts(clause, prompt) {
    if (!FORM_FACT.test(clause) || humanPreservesForm(clause, prompt)) return [clause]
    // A visual measurement may share one sentence with gameplay data. Release
    // only that measurement; never discard amounts, counts or states with it.
    const subject = clause.match(/(?:\d+|[零一二三四五六七八九十百两]+)(?:个|种|类|格|档)\s*(?:玩法)?(?:符号|物品|图案|按钮|控件|奖励|奖池)/u)?.[0] || ''
    const suffix = clause.match(/(?:保持原样|保持不变|保持一致|不变|\bunchanged)$/iu)?.[0] || ''
    const kept = clause.split(/、|以及|与|和|及|\band\b/iu).flatMap(part => {
      part = part.trim()
      if (!part) return []
      if (!FORM_FACT.test(part) || humanPreservesForm(part, prompt)) {
        const fact = subject && /^(?:身份|人设|功能|状态|选中状态|禁用状态|规则|数量|文字|文案)/u.test(part) ? `${subject}的${part}` : part
        return [suffix && !FORM_KEEP.test(fact) ? fact + suffix : fact]
      }
      const amounts = [...part.matchAll(/(?:余额|金额|下注|投注|赌注|(?:奖励|奖池)(?:金额|数值)?|\b(?:balance|bet|wager|credit|amount))\s*[:：]?\s*(?:[$¥￥€£]\s*)?\d+(?:\.\d+)?(?:元|美元|金币)?/giu)].map(match => match[0] + suffix)
      return [...(subject && part.includes(subject) ? [subject + suffix] : []), ...amounts]
    })
    return [...new Set(kept)].filter(fact => !(subject && fact === subject + suffix && kept.some(other => other.startsWith(subject + '的'))))
  }
  function formPreserveFacts(facts, prompt) {
    return facts.flatMap(fact => {
      const clauses = fact.split(FORM_CLAUSE).map(s => s.trim()).filter(Boolean)
      const kept = clauses.flatMap(clause => formIndependentFacts(clause, prompt))
      return kept.length === clauses.length && kept.every((clause, index) => clause === clauses[index]) ? [fact] : kept.length ? [kept.join('，')] : []
    })
  }
  function formEditingDirective(value, prompt) {
    const clauses = value.split(FORM_CLAUSE).map(s => s.trim()).filter(Boolean)
    const kept = clauses.flatMap(clause => {
      if (!FORM_FACT.test(clause) || humanPreservesForm(clause, prompt)) return [clause]
      if (FORM_DONT_KEEP.test(clause) || /重新设计|重设计|重做|可改变|可替换|\b(?:redesign|reshape|rebuild|replace)\b/iu.test(clause) || !FORM_KEEP.test(clause)) return [clause]
      return formIndependentFacts(clause, prompt)
    })
    return kept.length === clauses.length && kept.every((clause, index) => clause === clauses[index]) ? value : kept.join('；')
  }
  function requestsThemeRedesign(input) {
    // The human's theme replacement takes precedence over a style label from
    // the selector or assistant. Negation applies to its nearby action, not an
    // entire request such as "不要旧主题，换成深海主题".
    const actions = /(?:更换|切换|改变|重设|重做|重新设计|改成|改为|换)(?:成|为|一个|个)?[^，。；;,\r\n]{0,16}主题|主题(?:更换|切换|改成|改为|换成|换为|重设|重做|重设计|重新设计)|\b(?:(?:change|replace|switch|reset|redesign)\s+(?:(?:the|this|current|old)\s+)?theme|theme[- ]?redesign|re[- ]?theme)\b/giu
    return String(input.prompt || '').split(/[，。；;,\r\n]/u).some(clause => {
      for (const match of clause.matchAll(actions)) {
        if (isNegatedAction(clause, match)) continue
        // "只换画风并保留原主题" is about the style, not a theme action.
        if (/保留|保持|沿用/u.test(match[0])) continue
        return true
      }
      return false
    })
  }
  function themePreserveFacts(facts, redesignForms = false, prompt = '') {
    return (redesignForms ? formPreserveFacts(facts, prompt) : facts).filter(fact => {
      if (/新主题|新人物|新物品|新符号|新标题|用户指定|替换后|目标主题/u.test(fact)) return true
      if (/(?:\d+|[零一二三四五六七八九十百两]+)(?:个|种|类|格)\s*(?:玩法)?(?:物品|符号|图案)/u.test(fact) && !/(?:原|旧)(?:人物|角色|物品|符号|图案)/u.test(fact)) return true
      const geometry = /位置|区域|面积|占比|尺寸|布局|数量|行列|层级/u.test(fact)
      if (geometry && !/身份|人设|标题文字|文案|原主题|旧主题/u.test(fact)) return true
      return !/(?:原|旧)(?:人物|角色|物品|符号|图案|标题|主题)|(?:人物|角色|物品|符号|图案|标题|主题).{0,12}(?:身份|保持原样|保持不变|不变)/u.test(fact)
    })
  }
  function normalizeQwenPlan(value, input) {
    input = { ...input, references: requireLayoutReferences(input.references) }
    const count = input.references.length
    const fail = () => { throw new Error('Qwen 2.1 UI 设计规划不完整，请重试；本次未提交生成') }
    if (!value || value.version !== 1 || !QWEN_LAYOUT_MODES.includes(value.layoutMode) || !QWEN_VISUAL_MODES.includes(value.visualMode)) fail()
    const layoutReference = value.layoutReference
    if (!Number.isInteger(layoutReference) || layoutReference < 1 || layoutReference > count) fail()
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
    const editorIndex=input.references.findIndex(ref=>ref.uiLayoutId)
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
    const sources = requireLayoutReferences(input.references)
    const layoutIndex = sources.findIndex(ref => ref.uiLayoutId)
    const explicitIndex = sources.findIndex(ref => ref.role === 'layout')
    const anchor = layoutIndex >= 0 ? layoutIndex : explicitIndex
    const visualMode = requestsThemeRedesign(input) ? 'theme-redesign'
      : requestsFormRedesign(input) ? 'style-transfer'
      : input.generationIntent === 'style-transfer' ? 'style-transfer'
      : input.generationIntent === 'iteration' ? 'partial' : 'theme-redesign'
    const references = sources.map((ref, index) => ({ index: index + 1, role: index === anchor ? 'layout'
      : ['style', 'color', 'material'].includes(ref.role) ? 'style'
        : ['character', 'subject', 'asset'].includes(ref.role) ? 'asset'
          : ref.role === 'layout' ? 'layout' : 'content' }))
    return { version: 1, layoutMode: 'preserve', layoutReference: anchor + 1,
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
    if (!plan || plan.layoutReference !== fallback.layoutReference) return fallback
    if (input.preserveLayout === true && requestsThemeRedesign(input)) {
      return { ...plan, layoutMode: 'preserve', visualMode: 'theme-redesign', layoutChanges: [], preserve: themePreserveFacts(plan.preserve, input.generationIntent !== 'iteration', input.prompt) }
    }
    if (input.preserveLayout === true && requestsFormRedesign(input)) {
      // Reuse the content-preserving visual contract for form-only work;
      // changing button construction does not authorize changing its theme.
      return { ...plan, layoutMode: 'preserve', visualMode: 'style-transfer', layoutChanges: [], preserve: formPreserveFacts(plan.preserve, input.prompt) }
    }
    if (input.preserveLayout === true && input.generationIntent === 'style-transfer') {
      return { ...plan, layoutMode: 'preserve', visualMode: 'style-transfer', layoutChanges: [] }
    }
    return plan
  }
  function compileQwenPlan(result, input) {
    input = { ...input, references: requireLayoutReferences(input.references) }
    const resolved = resolveQwenPlan(result.uiPlan, input)
    const formOnlyRedesign = resolved.layoutMode === 'preserve' && !requestsThemeRedesign(input) && requestsFormRedesign(input)
    const themeFormRedesign = !formOnlyRedesign && resolved.visualMode === 'theme-redesign' && resolved.layoutMode === 'preserve' && input.generationIntent !== 'iteration'
    const redesignForms = themeFormRedesign || formOnlyRedesign
    const plan = themeFormRedesign ? { ...resolved, preserve: themePreserveFacts(resolved.preserve, true, input.prompt) }
      : formOnlyRedesign ? { ...resolved, preserve: formPreserveFacts(resolved.preserve, input.prompt) } : resolved
    // The layout/content anchor is native image 1. Keep every supplied image in
    // the native edit as well as the planner; role instructions isolate geometry.
    const wireframe=Boolean(input.references[plan.layoutReference-1]?.uiLayoutId)
    const order = input.references.map((_,i) => i + 1)
    if (plan.layoutReference) order.unshift(...order.splice(order.indexOf(plan.layoutReference),1))
    const remap = value => String(value || '').replace(/(?:@?参考图|图)([1-9][0-9]*)(?![0-9]|\s*[×xX*]\s*[0-9])|<image([1-9][0-9]*)>/g, (_,n,tag) => { const source = Number(n || tag); const at = order.indexOf(source); if (at < 0) throw new Error('设计规划引用了不存在的参考图'); return '@参考图' + (at + 1) })
    remap(input.prompt) // Validate the source's identifiers without sending a second full request.
    const native = value => remap(value).replace(/@参考图([1-9][0-9]*)(?![0-9]|\s*[×xX*]\s*[0-9])/g, (_,n) => order.length === 1 ? '图片' : `<image${n}>`)
    const modelReferences = plan.references.filter(r=>order.includes(r.index))
    const roles = [...modelReferences].sort((a,b) => order.indexOf(a.index)-order.indexOf(b.index)).map(r => {
      const image = order.length === 1 ? '图片' : `<image${order.indexOf(r.index)+1}>`
      const sourceRole = input.references[r.index-1]?.role
      const description = r.index === plan.layoutReference && wireframe
        ? redesignForms
          ? '自建布局定位图，是唯一玩法结构与主要区域锚点依据；只提供锚定区域、分组和数量，不是成品外观或人物物品身份，组件外轮廓与尺寸比例可在定位区域内设计，不保留灰块和占位框'
          : '自建布局定位图，是唯一几何布局依据；只提供区域位置、占比、分组和数量，不是成品外观或人物物品身份，不保留灰块和占位框'
        : r.index === plan.layoutReference
        ? redesignForms
          ? `编辑画布，是唯一玩法结构与主要区域锚点依据；仅保留玩法拓扑、网格行列数量、控件功能、信息层级及主要区域锚点；${formOnlyRedesign ? '原主题、人物物品身份、有效文字与状态保持正确，按用户要求重新设计组件构造' : '人物、背景、玩法物品和标题按用户的新主题要求重做，不默认保留旧内容身份'}`
          : `编辑画布，是唯一几何布局依据，构图和功能布局以它为准；${plan.visualMode==='style-transfer'?'保留原内容，只按要求改变美术表现':plan.visualMode==='theme-redesign'?'仅提供区域位置、占比、网格和功能关系；人物、背景、玩法物品和标题按用户的新主题要求重做，不默认保留旧内容身份':'布局来源，美术按需求重做'}`
        : r.role === 'style'
        ? sourceRole === 'color' ? '配色来源，只参考色彩关系，不复制人物物品、布局或文案'
          : sourceRole === 'material' ? '质感来源，只参考材质纹理与表面细节，不复制人物物品、布局或文案'
            : '风格来源，只迁移美术表现及其强度，不复制人物物品、布局或文案'
        : r.role === 'asset' || r.role === 'content' || r.role === 'combined'
        ? '人物或元素素材来源，只融合用户指定区域所需的身份与内容，不带入素材的背景、布局、文案或额外控件'
        : redesignForms ? '辅助布局参考，只参考用户指定的局部结构与锚点，不改变编辑画布的玩法拓扑与主要区域锚点，不带入无关内容或文案'
          : '辅助布局参考，只参考用户指定的局部关系，不改变编辑画布的整体几何布局，不带入无关内容或文案'
      return `${image}是${description}`
    }).join('；')
    const layout = plan.layoutMode === 'preserve' ? redesignForms
      ? `除用户明确要求改变的部分外，保留玩法拓扑、网格行列数量、控件数量与功能、信息层级及主要区域锚点；锚定区域内可创意重设计标题、主框、奖励栏和按钮的轮廓、尺寸比例与装饰负形，使造型回应${formOnlyRedesign ? '当前主题与用户的造型要求' : '新主题'}。同时重新设计组件构造、边框组织、连接方式、装饰承托与支撑结构、层间叠放和负空间；保持目标完整画风与配色，并完成材质和光影，通过轮廓、承托与连接关系的具体变化辨认新构造，不能只给相同骨架换材质、换角饰或把铆钉改成同位置的主题装饰。区域锚点不是旧矩形框的固定外轮廓，不要求逐像素复刻原框体；同类功能保持清楚一致的识别方式，用户明确指定的形状与结构优先；保持文字清晰、点击目标可辨识，装饰不得遮挡玩法内容或控件，不画占位线框。`
      : '除用户明确要求改变的部分外，沿用布局参考的区域位置、面积比例、网格行列及功能数量；在原位置逐区处理视觉，不画占位线框。'
      : plan.layoutMode === 'partial' ? `只调整这些布局项目：${plan.layoutChanges.map(remap).join('；')}。其余区域的位置、占比、数量和功能关系保持参考图，不扩展为整张重新排版。`
      : '按用户要求重新组织布局，保留用户指定的功能，不继承参考图未被要求保留的位置。'
    // Keep one editing directive. Repeating the source request and every preserved object's
    // appearance invites regeneration instead of preservation (Qwen's official edit guidance).
    const sourceDirective = String(result.prompt || '').replace(/(?:^|\n)参考标识[^\n]*/g, '').trim()
    const directive = redesignForms ? formEditingDirective(sourceDirective, input.prompt) || String(input.prompt || '').trim() : sourceDirective
    if (!directive) throw new Error('UI 编辑指令为空，本次未提交生成')
    const scope = native(layout)
    const geometry = input.structure?.regions?.length ? `${redesignForms ? '主要区域锚点与用途（定位范围，不锁定组件外轮廓或尺寸比例）' : '模块位置与用途'}：${input.structure.regions.map(r =>
      `${r.purpose || '界面模块'}，左${Math.round(r.x/input.structure.width*100)}%、上${Math.round(r.y/input.structure.height*100)}%、宽${Math.round(r.width/input.structure.width*100)}%、高${Math.round(r.height/input.structure.height*100)}%`).join('；')}` : ''
    const prompt = [native(directive), roles, scope,
      plan.layoutReference ? redesignForms
        ? '用户明确指定的布局调整优先；玩法拓扑、网格行列数量、控件功能、信息层级与主要区域锚点只由编辑画布决定，风格、配色、质感和人物元素图不得重新定义这些结构关系；原有框体形状、构造、连接方式与角饰不作为默认保留事实。'
        : '用户明确指定的布局调整优先；其余区域位置、面积比例、网格数量与功能关系只由编辑画布决定，风格、配色、质感和人物元素图不得重新定义布局。' : '',
      formOnlyRedesign ? '本次仅按用户要求重设计组件造型与构造，原主题、人物与物品身份、有效文案、金额、规则、控制功能及其状态保持正确；造型重做不授权更换主题或新增功能。'
        : plan.visualMode === 'style-transfer' && !wireframe ? '本次仅改变指定的画风、配色与质感，保留画布内的原人物与物品身份、文案和功能；用户明确指定素材替换的区域按其要求处理。' : '',
      plan.visualMode === 'theme-redesign' && !wireframe ? '本次是主题重设：玩法与布局按上述约束处理；人物、背景、玩法物品与标题按用户明确的新主题和替换要求重新设计，不沿用未被要求保留的旧人设、旧物品或旧标题。未要求改变的金额、规则、控制功能及其状态保持正确；用户明确替换的内容优先于规划中的旧内容保留描述。' : '',
      redesignForms ? '直接设计完整界面，以主要区域锚点保持整体构图与玩法流程；区域内部的框体衔接、视觉轮廓和装饰叠放按本次设计要求处理，不将画面改成整齐的通用格子模板。'
        : '直接设计完整界面，保留参考的整体构图、区域衔接与叠放关系，不将画面改成整齐的通用格子模板。',
      // The native reference carries its arrangement; do not hard-code a vision model's guessed cell counts.
      plan.preserve.length ? `保留这些${redesignForms ? '玩法、功能与区域锚点' : '布局与功能'}事实：${plan.preserve.map(native).join('；')}` : '', geometry,
      redesignForms && humanFormClauses(input.prompt).length ? `用户原文中的造型要求优先：${humanFormClauses(input.prompt).map(native).join('；')}` : '',
      wireframe ? '输出完整UI成品，只呈现用户需求指定的最终文案、物品图案与功能控件。布局定位图中的区域名、诊断编号、示例文字、灰块与空白占位仅用于定位，必须删除并替换为对应真实成品元素与功能图标；不得继承定位图中未被用户指定的文字，不得以编号替代物品，不得输出缺少功能图标的空白按钮。'
        : '输出完整UI成品，保留未要求修改的文字与功能。'].filter(Boolean).join('。').replace(/[\r\n]+/g, ' ').replace(/。{2,}/g, '。')
    const modelPlan = { ...plan, layoutReference: plan.layoutReference ? 1 : 0,
      references: modelReferences.map(r => ({ ...r, index: order.indexOf(r.index) + 1 })).sort((a,b) => a.index-b.index),
      layoutChanges: plan.layoutChanges.map(remap), preserve: plan.preserve.map(remap) }
    return { prompt, references: order.map(i => input.references[i-1]), plan: modelPlan, analysisPlan:plan, order }
  }
  function key(input) {
    return JSON.stringify({ contract: 'ui-native-edit-10', provider: input.provider, engine: input.engine || 'grok', targetEngine: input.targetEngine || '', prompt: input.prompt || '', negativePrompt: input.negativePrompt || '', generationIntent: input.generationIntent || '', preserveLayout: input.preserveLayout === true, size: input.size, structure: input.structure, references: (input.references || []).map(r => ({ id: r.id, dataUrl: r.dataUrl || r.imageUrl, role: r.role })) })
  }
  function remember(id, input, result, appliedInput) {
    const normalized = value => ({ ...value, references: requireLayoutReferences(value.references) })
    cache.set(id, { keys: [key(normalized(input)), ...(appliedInput ? [key(normalized(appliedInput))] : [])], result: { ...result } })
    if (cache.size > 16) cache.delete(cache.keys().next().value)
  }
  function aborted() { const error = new Error('任务已中止'); error.name = 'AbortError'; return error }
  async function run(options) {
    const { id, signal, assistant } = options
    const input = { ...options.input, references: requireLayoutReferences(options.input?.references) }
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
  return Object.freeze({ run, remember, key, requireLayoutReferences, normalizeQwenPlan, resolveQwenPlan, compileQwenPlan })
})
