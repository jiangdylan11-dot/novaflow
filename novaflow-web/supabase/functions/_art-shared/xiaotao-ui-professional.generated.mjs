// GENERATED COPY - source: packages/shared/src/xiaotao-ui-professional.generated.mjs
// GENERATED: server-local wrappers around unchanged renderer UI rules.
// Sources: {"ui-design-prompt.pipeline.js":"44b1da267fc06ccf043e3d74ac8178a1dc3e6345b2b80806747f9ac17e23a374","ui-design-assistant.workflow.js":"cfe7dcc8dc8105c8abcbb5162837150d7f6affe51a058bab8a822f216f4395ba"}
const isolated=(()=>{const globalThis=Object.create(null);const module=undefined;
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
    const ids = references.map(ref => ref?.id).filter(Boolean)
    if (new Set(ids).size !== ids.length) throw new Error('参考图标识重复，请重新添加图片；本次未提交生成')
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
  const FORM_ACTION = /(?:重新设计|重设计|重做|重设|重构|改变|改动|优化)[^，。；;,\r\n]{0,24}(?:造型|构造|轮廓|外形|形状|外壳|边框|角饰|连接方式|承托|支撑|负空间)|(?:造型|构造|轮廓|外形|形状|外壳|边框|角饰|连接方式|承托|支撑|负空间)[^，。；;,\r\n]{0,16}(?:重新设计|重设计|重做|重设|重构|改变|改动|优化|创新)|\b(?:redesign|reshape|rebuild)\s+(?:(?:the|this|current|old|ui|button|reward)\s+){0,3}(?:forms?|shapes?|silhouettes?|components?|housings?|borders?)\b/giu
  function isNegatedAction(clause, match) {
    const prefix = clause.slice(Math.max(0, match.index - 24), match.index)
    return /(?:不要|不得|不能|不可|别|不需要|不必|不用|无需|无须|并非|不是|不想|不希望|未要求|勿|不)(?:再|去|把|将|要|进行|直接)?\s*$/u.test(prefix)
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
  function requestsFormPreservation(input) {
    // Theme content and component construction are independent. Explicit whole
    // UI reskinning overrides a default redesign intent, but a local round Spin
    // or unchanged gameplay layout cannot freeze every other component.
    const localTarget = /主按钮|按钮|Spin|BUY|标题|主框|主盘|奖励栏|奖励牌|图标|人物|角色|符号|物品|局部|\b(?:button|title|reward|character|icon)\b/iu
    const globalTarget = /整体|全局|全图|整(?:个|张)(?:UI|界面)|(?:所有|全部|各)(?:UI)?(?:组件|部件)|\b(?:all|every)\s+(?:ui\s+)?components?\b|\b(?:whole|entire)\s+(?:ui|interface)\b/iu
    const construction = /保形|造型|构造|轮廓|外形|形状|外壳|边框|框体|承托|支撑|连接(?:方式|结构|件)|\b(?:forms?|shapes?|silhouettes?|construction|housings?|frames?|supports?|connectors?|connections?)\b/iu
    const pure = /(?:纯(?:粹)?|仅(?:仅)?|只)(?:做|进行|是)?\s*(?:换皮|风格迁移)|(?:仅(?:仅)?|只)(?:改|换|改变|更换|调整)(?:画风|风格|配色|材质|纹理)|(?:仅(?:仅)?|只)(?:把|将)?(?:整体|全屏|整个|整张)?(?:UI|界面|画面|图片)?(?:的)?(?:画风|风格|配色|材质|纹理)(?:改成|换成|改为|更换|调整|转换|切换)|\b(?:reskin\s+only|only\s+(?:reskin|restyle|restyling)|pure(?:ly)?\s+(?:reskin|restyling|style[- ]transfer))\b/giu
    return String(input.prompt || '').split(FORM_CLAUSE).some(clause => {
      for (const match of clause.matchAll(pure)) {
        if (!isNegatedAction(clause, match) && !localTarget.test(clause.slice(0, match.index))) return true
      }
      if (!construction.test(clause) || /(?:功能|玩法)(?:连接|构造|结构)/u.test(clause) && !/轮廓|外形|形状|外壳|边框|承托/u.test(clause)) return false
      const global = globalTarget.test(clause) || !localTarget.test(clause)
      if (!global) return false
      const actions = [...clause.matchAll(FORM_ACTION)]
      const negated = match => isNegatedAction(clause, match)
        || /(?:造型|构造|轮廓|外形|形状|外壳|边框|承托|支撑|连接方式).{0,8}(?:不要|不得|不能|不需要|不必|不用|无需|勿|不)(?:再)?(?:改变|改动|重新设计|重设计|重做|优化)/u.test(match[0])
      if (actions.some(match => !negated(match))) return false
      if ((FORM_KEEP.test(clause) || /保形|不(?:再)?改变|不(?:再)?改动/u.test(clause)) && !FORM_DONT_KEEP.test(clause)
        && !/(?:不必|不用|无需|无须|不要|不能|不得|勿)\s*(?:保留|保持|沿用|保形)|\b(?:need not|no need to|not required to|not)\s+(?:preserve|keep|retain)\b/iu.test(clause)) return true
      return actions.some(negated)
    })
  }
  function preservingFormDirective(value, prompt) {
    const clauses = value.split(/[，。；;\r\n]|(?<![0-9]),|,(?![0-9])|\.(?:\s|$)/u).map(s => s.trim()).filter(Boolean)
    const kept = clauses.flatMap(clause => {
      const parts = clause.split(/(?:并且|同时|以及|并|\band\b)\s*(?=(?:重新设计|重设计|重做|重构|改变|改动|redesign|reshape|rebuild))/iu)
      return parts.filter(part => {
        const component = /组件|部件|按钮|控件|标题|主框|主盘|奖励栏|奖励牌|边框|外壳|框体|承托|支撑|连接|负空间|\b(?:components?|buttons?|frames?|housings?|supports?|connectors?)\b/iu.test(part)
        const contentOnly = /人物|角色|符号|物品|\b(?:characters?|objects?|symbols?)\b/iu.test(part) && !component
        const conflict = !contentOnly && (requestsFormRedesign({ prompt: part }) || FORM_FACT.test(part) && FORM_DONT_KEEP.test(part)
          || /(?:不能|不得|不要|不应|避免|do not|never).{0,10}(?:仅|只|only).{0,16}(?:材质|换皮|换角饰|restyle|material)/iu.test(part))
        return !conflict || String(prompt || '').includes(part)
      })
    })
    return kept.length === clauses.length && kept.every((clause, index) => clause === clauses[index]) ? value : kept.join('；')
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
    // A local edit never authorizes whole-screen theme replacement. The human
    // may request a new complete screen naturally, without the word "theme".
    if (input.generationIntent === 'iteration') return false
    const actions = /(?:更换|切换|改变|重设|重做|重新设计|改成|改为|换)(?:成|为|一个|个)?[^，。；;,\r\n]{0,16}主题|主题(?:更换|切换|改成|改为|换成|换为|重设|重做|重设计|重新设计)|\b(?:(?:change|replace|switch|reset|redesign)\s+(?:(?:the|this|current|old)\s+)?theme|theme[- ]?redesign|re[- ]?theme)\b/giu
    const whole = '(?:整屏|全屏|整张|整个|全部|整体|完整)(?:的)?(?:UI|界面|页面|画面)?'
    const rebuild = '(?:重新设计|重设计|重做|重新制作|重新绘制)'
    const complete = new RegExp('(?:' + whole + '\\s*' + rebuild + '|' + rebuild + '\\s*' + whole + ')(?:(?:成|为)([^，。；;,\\r\\n]+))?', 'giu')
    const prompt = String(input.prompt || '')
    const keepTheme = /(?:保留|保持|沿用)(?:原有|原来|原|现有|当前|旧)(?:的)?(?:主题|题材)|(?:不|不要|不得)(?:更换|改变|替换|换)(?:主题|题材)/u.test(prompt)
    return prompt.split(/[，。；;,\r\n]/u).some(clause => {
      for (const match of clause.matchAll(actions)) {
        if (isNegatedAction(clause, match) || /保留|保持|沿用/u.test(match[0])) continue
        return true
      }
      // Preserve a stated reskin/current identity; construction-only work is
      // still form-only. An affirmative new whole screen takes precedence over
      // an unrelated material or character preservation clause.
      if (keepTheme || requestsFormPreservation(input)) return false
      // A separate target-theme clause is still a theme request: e.g. change
      // the art style, then name the new theme after a comma. A description of
      // the current theme or a style-only edit must not expand that scope.
      const target = clause.trim().replace(/^[：:\s]+/, '')
      if (!/^(?:不|别|勿|无须|无需)/u.test(target) && !/保留|保持|沿用|原有|原来|原图|原主题|旧主题|现有|当前|参考图|不要|不得|不能|不换|别换|禁止|并非|不是|无需|不变|不改/u.test(target)
        && /^(?:(?:目标|新|输出)(?:主题)?\s*[：:是为]\s*[^，。；;,\r\n]{1,48}|(?:(?:生成|制作|设计|做成|采用|使用)(?:一个|一张|一幅|为|成)?\s*)?[^，。；;,\r\n]{1,32}主题(?:的)?(?:老虎机|游戏(?:UI|界面)?|UI|界面|页面|画面|设计)?)[！!？?]?$/iu.test(target)) return true
      for (const match of clause.matchAll(complete)) {
        if (isNegatedAction(clause, match)) continue
        if (match[1]) {
          if (!/画风|风格|配色|材质|质感|光影|纹理|换肤|换皮/u.test(match[1])) return true
        } else if (!requestsFormRedesign({ prompt: clause })) return true
      }
      return false
    })
  }
  function themePreserveFacts(facts, redesignForms = false, prompt = '') {
    const candidates = redesignForms ? formPreserveFacts(facts, prompt) : facts
    const split = value => value.split(/[，。；;\r\n]|(?<![0-9]),|,(?![0-9])|\.(?:\s|$)/u).map(s => s.trim()).filter(Boolean)
    const oldIdentity = /(?:原|旧)(?:图|主题)?(?:的)?(?:人物|角色|物品|符号|图案|标题|主题|背景|装饰|道具)|(?:人物|角色|物品|符号|图案|标题|主题).{0,12}(?:身份|人设|保持原样|保持不变|不变)|\b(?:old|original|source)\b.{0,50}\b(?:identity|appearance|characters?|objects?|symbols?|decorations?|theme|scenery|title)\b/iu
    const explicitKeep = clause => {
      const substance = clause.replace(/^(?:保留|保持|沿用|keep|preserve|retain)\s*(?:the\s+)?/iu, '').replace(/(?:保持原样|保持不变|保持一致|不变|\bunchanged)$/iu, '').trim().toLowerCase()
      return substance && split(String(prompt || '')).some(human => human.toLowerCase().includes(substance)
        && FORM_KEEP.test(human) && !FORM_DONT_KEEP.test(human))
    }
    // Split mixed facts before removing old identities. A character and a
    // balance may share one planner sentence; only the human can keep identity.
    return candidates.flatMap(fact => {
      const clauses = split(fact).flatMap(clause => oldIdentity.test(clause) && !explicitKeep(clause)
        ? clause.split(/、|以及|与|和|\band\b/iu).map(s => s.trim()).filter(s => s && !/^(?:身份|人设|外观|顺序)(?:保持|不变|保持不变)/u.test(s)) : [clause])
      const kept = clauses.filter(clause => explicitKeep(clause) || /新主题|新人物|新物品|新符号|新标题|替换后|目标主题/u.test(clause)
        || /展示区|区域|锚点/u.test(clause) && !/身份|人设|外观|(?:原|旧)(?:图|人物|角色|物品|符号|图案|装饰|道具)/u.test(clause)
        || !oldIdentity.test(clause)
        || /(?:\d+|[零一二三四五六七八九十百两]+)(?:个|种|类|格)\s*(?:玩法)?(?:物品|符号|图案)/u.test(clause) && !/(?:原|旧)(?:人物|角色|物品|符号|图案)/u.test(clause))
      return kept.length === clauses.length ? [fact] : kept.length ? [kept.join('，')] : []
    })
  }
  function layoutBusinessFacts(facts, layoutReference) {
    // Explicit source mentions are authority, including in a planner's list.
    // Do not promote style/material/asset text into the editing canvas's data.
    return facts.flatMap(fact => {
      const clauses = fact.split(/[，。；;\r\n]|(?<![0-9]),|,(?![0-9])|\.(?:\s|$)/u).map(s => s.trim()).filter(Boolean)
      let source = layoutReference
      const kept = clauses.filter(clause => {
        const mentions = [...clause.matchAll(/(?:@?参考图|图)([1-9][0-9]*)(?![0-9]|\s*[×xX*]\s*[0-9])|<image([1-9][0-9]*)>/g)]
        if (mentions.length) source = Number(mentions.at(-1)[1] || mentions.at(-1)[2])
        return source === layoutReference && mentions.every(match => Number(match[1] || match[2]) === layoutReference)
      })
      return kept.length === clauses.length ? [fact] : kept.length ? [kept.join('，')] : []
    })
  }
  function normalizeQwenPlan(value, input) {
    input = { ...input, references: requireLayoutReferences(input.references) }
    const count = input.references.length
    const fail = () => { throw new Error('Qwen 2.1 UI 设计规划不完整，请重试；本次未提交生成') }
    if (!value || value.version !== 1 || !QWEN_LAYOUT_MODES.includes(value.layoutMode) || !QWEN_VISUAL_MODES.includes(value.visualMode)) fail()
    const layoutReference = value.layoutReference
    if (!Number.isInteger(layoutReference) || layoutReference < 1 || layoutReference > count) fail()
    const suppliedReferences = value.references
    if (!Array.isArray(suppliedReferences) || suppliedReferences.length !== count) fail()
    const references = suppliedReferences.map(ref => ref && typeof ref === 'object' ? { ...ref } : ref)
    const seen = new Set()
    for (const ref of references) {
      if (!ref || !Number.isInteger(ref.index) || ref.index < 1 || ref.index > count || seen.has(ref.index)) fail()
      seen.add(ref.index)
      // The input snapshot owns stable image IDs and the user's explicit role.
      // An AI role suggestion may fill an unassigned slot, never relabel one.
      const source = input.references[ref.index - 1]
      const authority = source.uiLayoutId || source.role === 'layout' ? 'layout'
        : ['style', 'color', 'material'].includes(source.role) ? 'style'
          : ['character', 'subject', 'asset'].includes(source.role) ? 'asset'
            : source.role === 'content' ? 'content' : source.role === 'combined' ? 'combined' : ''
      if (authority) ref.role = authority
      if (!QWEN_REFERENCE_ROLES.includes(ref.role)) fail()
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
      : requestsFormPreservation(input) ? 'style-transfer'
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
    if (input.generationIntent === 'iteration' && input.editRegion) {
      return { ...plan, layoutMode: 'preserve', visualMode: 'partial', layoutChanges: [] }
    }
    if (input.preserveLayout === true && requestsThemeRedesign(input)) {
      return { ...plan, layoutMode: 'preserve', visualMode: 'theme-redesign', layoutChanges: [], preserve: themePreserveFacts(layoutBusinessFacts(plan.preserve, plan.layoutReference), input.generationIntent !== 'iteration' && !requestsFormPreservation(input), input.prompt) }
    }
    if (input.preserveLayout === true && requestsFormPreservation(input)) {
      return { ...plan, layoutMode: 'preserve', visualMode: 'style-transfer', layoutChanges: [] }
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
  function observedBusinessFacts(directive, input, layoutReference, wireframe) {
    // Recover only explicit inventories already observed by the planner when
    // it omitted preserve[]. Never infer amounts from a theme or guide image.
    if (wireframe || !layoutReference) return []
    const change = /(?:金额|数值|奖池|档位|文案|按钮|控件|功能).{0,16}(?:改为|改成|替换为|删除|移除|新增)|(?:删除|移除|新增).{0,12}(?:按钮|控件|功能)|\b(?:change|replace|remove|add)\b.{0,24}\b(?:amounts?|jackpots?|labels?|controls?|buttons?)\b/iu
    if (change.test(input.prompt || '')) return []
    const text = String(directive || '')
    const inventories = /(?:金额|奖池|奖励档位|档位|功能栏|操作栏|控制栏|业务事实|\bjackpots?|\brewards?|\bamounts?|\bcontrols?|\bbusiness facts)\s*[:：]?\s*[（(]([^()（）\r\n]{1,180})[）)]/giu
    const facts = []
    for (const match of text.matchAll(inventories)) {
      const mentions = [...text.slice(0, match.index).matchAll(/(?:@?参考图|图)([1-9][0-9]*)(?![0-9]|\s*[×xX*]\s*[0-9])|<image([1-9][0-9]*)>/g)]
      const last = mentions.at(-1)
      if (last ? Number(last[1] || last[2]) !== layoutReference : input.references.length !== 1) continue
      const fact = match[1].trim()
      if (fact && !facts.includes(fact)) facts.push(fact)
      if (facts.length === 4) break
    }
    return facts
  }
  function themeDesignProposal(value, input, businessFacts, layoutReference) {
    const split = text => String(text || '').split(/[，。；;\r\n]|(?<![0-9]),|,(?![0-9])|\.(?:\s|$)/u).map(s => s.trim()).filter(Boolean)
    const reference = /(?:@?参考图|图)([1-9][0-9]*)(?![0-9]|\s*[×xX*]\s*[0-9])|<image([1-9][0-9]*)>/g
    const key = text => String(text || '').replace(reference, (_, n, tag) => 'image' + (n || tag)).replace(/[\s，。；;,.:：]/g, '').toLowerCase()
    const human = String(input.prompt || '').trim(), humanKey = key(human)
    const excluded = split(human).flatMap(clause => {
      const match = clause.match(/(?:不要|不得|禁止|不使用|不采用|不出现|去掉|移除|删除|取消|\b(?:do not use|don't use|avoid|without|no)\s+)(.+)$/iu)
      return match ? match[1].replace(/^(?:出现|使用|采用|包含|加入|添加|生成|保留|复制|照搬)\s*/u, '').split(/、|或|和|及|\bor\b|\band\b/iu).map(key).filter(s => s.length > 0) : []
    })
    const shapes = /圆角矩形|圆形|椭圆|矩形|方形|胶囊|\b(?:circular|round|oval|rectangular|square|capsule)\b/giu
    const fixedForms = humanFormClauses(human).filter(clause => FORM_KEEP.test(clause) || /必须|指定|只能|要求|\bmust\b/iu.test(clause))
    const keepIdentity = split(human).some(clause => FORM_KEEP.test(clause) && /(?:原|现有|当前)(?:人物|角色|主角)|\b(?:original|current)\s+character/iu.test(clause))
    const seen = new Set(), kept = []
    let source = layoutReference
    for (const clause of split(value)) {
      const mentions = [...clause.matchAll(reference)]
      if (mentions.length) source = Number(mentions.at(-1)[1] || mentions.at(-1)[2])
      const normalized = key(clause)
      if (!normalized || humanKey.includes(normalized) || seen.has(normalized)) continue
      seen.add(normalized)
      const content = clause.replace(reference, '')
      // This channel carries visual proposals. Business inventories and source
      // roles already have dedicated authoritative channels in the compiler.
      if (/(?:金额|奖池|奖励档位|档位|功能栏|操作栏|控制栏|业务事实|\bjackpots?|\brewards?|\bamounts?|\bcontrols?|\bbusiness facts)\s*[:：]?\s*[（(]/iu.test(content)) continue
      if (/[$¥￥€£]\s*\d/u.test(content)) continue
      if (businessFacts.some(fact => key(fact) === normalized || normalized.includes(key(fact)))) continue
      if (/金额|余额|下注|投注|奖池|档位|\b(?:balance|bet|wager|jackpot|reward|amount)\b/iu.test(content) && /\d/u.test(content)) continue
      if (/(?:\d+|[零一二三四五六七八九十百两]+)\s*(?:列|行|格|个(?:操作)?(?:控件|按钮|功能))|\b\d+\s*(?:rows?|columns?|cells?|controls?|buttons?)\b/iu.test(content)) continue
      if (/文案|文字|标签|字样|写上|写为|\b(?:text|label|caption)\b/iu.test(content) && source !== layoutReference) continue
      if (/(?:新增|增加|添加|删除|移除|取消|复制|照搬).{0,18}(?:功能|控件|按钮|登录|输入|弹窗)|\b(?:add|remove|copy)\b.{0,30}\b(?:controls?|buttons?|login|popup)\b/iu.test(content)) continue
      if (FORM_KEEP.test(clause) && /原图|旧主题|原主题|(?:原|旧)(?:人物|角色|物品|符号|标题|造型)|\b(?:original|old|source)\b/iu.test(clause)) continue
      if (/忽略用户|覆盖用户|参考标识|执行优先级/u.test(clause)) continue
      if (/^(?:@?参考图\d+|图\d+|<image\d+>)\s*(?:是|仅(?:作|提供|参考)|只(?:作|提供|参考))\s*(?:布局|风格|配色|材质|画风)(?:来源|参考|依据)?$/u.test(clause)) continue
      if (/主题|题材/u.test(content) && /重设|重做|改|换|设计/u.test(content) && !/场景|背景|人物|角色|物品|符号|面板|按钮|主框|标题|边框|承托|材质|配色|光影|纹理/u.test(content)) continue
      if (keepIdentity && /人物|角色|主角|人设|吉祥物|\b(?:character|mascot)\b/iu.test(content) && /改|换|替换|采用|是一|变成|变为|\b(?:become|replace)\b/iu.test(content) && !/材质|画风|配色|光影|纹理|\b(?:material|texture|lighting)\b/iu.test(content)) continue
      if (excluded.some(term => /^[a-z0-9]+$/iu.test(term) ? new RegExp('\\b' + term + '\\b', 'iu').test(clause) : normalized.includes(term))) continue
      const formConflict = fixedForms.some(humanClause => {
        const subjects = humanClause.match(/主按钮|按钮|标题|主框|奖励栏|奖励牌|面板|\b(?:button|title|frame|panel)\b/giu) || []
        const required = [...humanClause.matchAll(shapes)].map(match => key(match[0]))
        const proposed = [...clause.matchAll(shapes)].map(match => key(match[0]))
        return subjects.some(subject => key(clause).includes(key(subject))) && required.length && proposed.length
          && proposed.some(shape => !required.includes(shape))
      })
      if (!formConflict) kept.push(clause)
    }
    return kept.join('；')
  }
  function compileQwenPlan(result, input) {
    if (result.uiCatalog?.schema === 'nf.ui.structure-catalog.v1') {
      if (input.provider !== 'local' || !['local','grok'].includes(input.engine) || input.generationIntent !== 'redesign' || input.preserveLayout !== true || !result.prompt?.trim()) throw new Error('结构编译结果与当前任务不匹配')
      const plan = normalizeQwenPlan(result.uiPlan, input)
      if (!plan || plan.layoutMode !== 'preserve' || plan.visualMode !== 'theme-redesign') throw new Error('结构编译布局结果无效')
      return { prompt:result.prompt, references:input.references, plan, analysisPlan:plan, order:input.references.map((_,i)=>i+1), businessFacts:[], businessFactsSource:'typed-source-catalog', uiCatalog:result.uiCatalog }
    }
    input = { ...input, references: requireLayoutReferences(input.references) }
    const resolved = resolveQwenPlan(result.uiPlan, input)
    const preserveForms = requestsFormPreservation(input)
    const formOnlyRedesign = !preserveForms && resolved.layoutMode === 'preserve' && !requestsThemeRedesign(input) && requestsFormRedesign(input)
    const themeFormRedesign = !preserveForms && !formOnlyRedesign && resolved.visualMode === 'theme-redesign' && resolved.layoutMode === 'preserve' && input.generationIntent !== 'iteration'
    const redesignForms = themeFormRedesign || formOnlyRedesign
    const plan = resolved.visualMode === 'theme-redesign' && input.generationIntent !== 'iteration' ? { ...resolved, preserve: themePreserveFacts(layoutBusinessFacts(resolved.preserve, resolved.layoutReference), themeFormRedesign, input.prompt) }
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
      : `除用户明确要求改变的部分外，沿用布局参考的区域位置、面积比例、网格行列及功能数量；在原位置逐区处理视觉，不画占位线框。${preserveForms ? '保留组件外轮廓、尺寸比例、主体承托、边框组织与连接结构，仅重绘用户要求的主题外观、画风、配色、材质和表面装饰；新主题内容替换不授权改变组件构造。' : ''}`
      : plan.layoutMode === 'partial' ? `只调整这些布局项目：${plan.layoutChanges.map(remap).join('；')}。其余区域的位置、占比、数量和功能关系保持参考图，不扩展为整张重新排版。`
      : '按用户要求重新组织布局，保留用户指定的功能，不继承参考图未被要求保留的位置。'
    // Keep one editing directive. Repeating the source request and every preserved object's
    // appearance invites regeneration instead of preservation (Qwen's official edit guidance).
    const sourceDirective = String(result.prompt || '').replace(/(?:^|\n)参考标识[^\n]*/g, '').trim()
    const directive = preserveForms ? preservingFormDirective(sourceDirective, input.prompt) || String(input.prompt || '').trim()
      : redesignForms ? formEditingDirective(sourceDirective, input.prompt) || String(input.prompt || '').trim() : sourceDirective
    if (!directive) throw new Error('UI 编辑指令为空，本次未提交生成')
    const scope = native(layout)
    const geometry = input.structure?.regions?.length ? `${redesignForms ? '主要区域锚点与用途（定位范围，不锁定组件外轮廓或尺寸比例）' : '模块位置与用途'}：${input.structure.regions.map(r =>
      `${r.purpose || '界面模块'}，左${Math.round(r.x/input.structure.width*100)}%、上${Math.round(r.y/input.structure.height*100)}%、宽${Math.round(r.width/input.structure.width*100)}%、高${Math.round(r.height/input.structure.height*100)}%`).join('；')}` : ''
    const detailedPrompt = [native(directive), roles, scope,
      plan.layoutReference ? redesignForms
        ? '用户明确指定的布局调整优先；玩法拓扑、网格行列数量、控件功能、信息层级与主要区域锚点只由编辑画布决定，风格、配色、质感和人物元素图不得重新定义这些结构关系；原有框体形状、构造、连接方式与角饰不作为默认保留事实。'
        : '用户明确指定的布局调整优先；其余区域位置、面积比例、网格数量与功能关系只由编辑画布决定，风格、配色、质感和人物元素图不得重新定义布局。' : '',
      formOnlyRedesign ? '本次仅按用户要求重设计组件造型与构造，原主题、人物与物品身份、有效文案、金额、规则、控制功能及其状态保持正确；造型重做不授权更换主题或新增功能。'
        : plan.visualMode === 'style-transfer' && !wireframe ? '本次仅改变指定的画风、配色与质感，保留画布内的原人物与物品身份、文案和功能；用户明确指定素材替换的区域按其要求处理。' : '',
      plan.visualMode === 'theme-redesign' ? '本次是主题重设：玩法与布局按上述约束处理；人物、背景、玩法物品与标题按用户明确的新主题和替换要求重新设计，不沿用未被要求保留的旧人设、旧物品或旧标题。未要求改变的金额、规则、控制功能及其状态保持正确；用户明确替换的内容优先于规划中的旧内容保留描述。' : '',
      plan.visualMode === 'theme-redesign' && !formOnlyRedesign && !preserveForms ? '主题重设计只保留布局图的业务结构：玩法盘数量与行列、特殊标记的含义、奖励档位及金额、余额下注赢取信息、有效规则文案、操作功能及状态。全部人物、装饰、道具与图标外观必须按用户指定的新题材重新设计，按钮造型、面板边框、字体视觉、材质与配色不继承旧主题；结构参考不约束旧对象身份和旧美术。未明确要求逐格保持时，不锁定旧格位美术和原图细节比例。关键功能不得省略或重复，不增加登录、邀请、任务或其他新功能；没有给出的数值不得编造。自建定位图的诊断文字与示例值不是业务数据，只采用用户明确提供的业务要求。'
        : '除用户明确要求改变的项目外，完整布局图中已有的玩法盘数量、每个盘的行列和逐格实例、重复符号关系、玩法特殊标记、奖励档位、金额数值、余额、下注、赢取信息、有效规则文案、全部操作图标及功能状态逐项保留，主题或构造变化不得省略或重复这些内容。功能数量由用户布局图和原文决定，不因题材猜测增加登录、邀请、任务或其他新功能；没有给出的数值不得编造。自建定位图中的诊断文字与示例值不属于业务数据，只采用用户明确提供的业务要求。',
      redesignForms ? '直接设计完整界面，以主要区域锚点保持整体构图与玩法流程；区域内部的框体衔接、视觉轮廓和装饰叠放按本次设计要求处理，不将画面改成整齐的通用格子模板。'
        : '直接设计完整界面，保留参考的整体构图、区域衔接与叠放关系，不将画面改成整齐的通用格子模板。',
      // The native reference carries its arrangement; do not hard-code a vision model's guessed cell counts.
      plan.preserve.length ? `保留这些${redesignForms ? '玩法、功能与区域锚点' : '布局与功能'}事实：${plan.preserve.map(native).join('；')}` : '', geometry,
      (redesignForms || preserveForms) && humanFormClauses(input.prompt).length ? `用户原文中的造型要求优先：${humanFormClauses(input.prompt).map(native).join('；')}` : '',
      wireframe ? '输出完整UI成品，只呈现用户需求指定的最终文案、物品图案与功能控件。布局定位图中的区域名、诊断编号、示例文字、灰块与空白占位仅用于定位，必须删除并替换为对应真实成品元素与功能图标；不得继承定位图中未被用户指定的文字，不得以编号替代物品，不得输出缺少功能图标的空白按钮。'
        : '输出完整UI成品，保留未要求修改的文字与功能。'].filter(Boolean).join('。').replace(/[\r\n]+/g, ' ').replace(/。{2,}/g, '。')
    // Whole-theme editing has one role-first contract. The human's request is
    // authoritative; repeating a planner's full prose can reintroduce old scenery.
    // Preserve its business inventory once and merge only non-conflicting visual clauses.
    const conciseRoles = modelReferences.sort((a,b)=>order.indexOf(a.index)-order.indexOf(b.index)).map(r=>{
      const image = order.length === 1 ? '图片' : `<image${order.indexOf(r.index)+1}>`;
      const role = input.references[r.index-1]?.role;
      return r.index === plan.layoutReference ? `${image}是唯一布局与业务依据`
        : r.role === 'style' ? `${image}是${role === 'material' ? '质感来源' : role === 'color' ? '配色来源' : '风格来源'}，只取画风材质配色，不取布局、文字或人物`
        : ['asset','content','combined'].includes(r.role) ? `${image}是人物或元素素材来源，只取用户指定身份，不取背景、布局或文字`
        : `${image}只提供用户指定的局部关系，不改整体布局`;
    }).join('；');
    const observedFacts = themeFormRedesign ? observedBusinessFacts(sourceDirective, input, plan.layoutReference, wireframe) : []
    // A partial preserve list may only say "bottom controls unchanged". Keep
    // the labels actually observed in its layout inventory, rather than strip
    // that inventory from the visual proposal and lose the names entirely.
    // Explicit plan values stay authoritative: do not append inferred amounts.
    const observedLabels = plan.preserve.length ? observedFacts.filter(fact => !/[0-9$¥￥€£]/u.test(fact)
      && !plan.preserve.some(kept => kept.includes(fact))).slice(0, Math.max(0, 30 - plan.preserve.length)) : []
    const businessFacts = themeFormRedesign ? plan.preserve.length ? [...plan.preserve, ...observedLabels] : observedFacts : plan.preserve
    const humanDirective = String(input.prompt || '').trim()
    // Artwork lettering is a literal payload, independent of instruction
    // language. Keep explicitly requested new labels even if a planner
    // paraphrases its surrounding edit description.
    const requestedLettering=[...new Set([...humanDirective.matchAll(/(?:文字|文案|标题|文本|标签)[^\n]{0,40}?(?:改为|改成|替换为|替换成|写成|设为|显示为)\s*[“"「]([^”"」\n]+)[”"」]/gu)].map(match=>match[1]))]
    const lettering=requestedLettering.length?'用户指定的画面文字须逐字使用：'+requestedLettering.map(text=>'“'+text+'”').join('、'):''
    const proposal = themeFormRedesign && humanDirective ? themeDesignProposal(directive, input, businessFacts, plan.layoutReference) : ''
    // Qwen's edit policy separates modified attributes from preserved content.
    // A local revision should not carry the whole-interface redesign essay,
    // which can make a one-button change redraw unrelated parts of the UI.
    const localRevision=plan.visualMode==='partial'||input.generationIntent==='iteration'
    const prompt = localRevision ? [native(directive),lettering,conciseRoles,native(layout),
      '只执行上述指定对象及属性的修改，其他区域的身份、布局、风格、光照与功能状态保持输入一致；不根据参考素材重新描写或重做未修改区域。',
      '除用户明确要求改动的部分外，全部操作图标及功能状态逐项保留，不得遗漏或重复；不新增用户未要求的功能，不编造未提供的数值。',
      businessFacts.length?`保留布局与功能事实：${businessFacts.map(native).join('；')}`:'',geometry,
      '有效画面文字保留原语言、拼写、标点及数值；仅替换用户点名的文字，不把编辑说明、参考编号或内部模块名绘入界面。',
      wireframe?'定位图只提供位置与用途，灰块、诊断文字与示例值不作为成品内容。':'输出完整UI成品，保留未要求修改的文字与功能。'
    ].filter(Boolean).join('。').replace(/[\r\n]+/g,' ').replace(/。{2,}/g,'。') : themeFormRedesign ? [conciseRoles, native(humanDirective || directive),lettering,
      proposal ? `规划补充（用户明确要求优先）：${native(proposal)}` : '',
      '主题重设计只保留布局图的业务结构：玩法拓扑、网格行列数量、控件数量与功能、信息层级及主要区域锚点。人物、背景、玩法物品和标题按用户的新主题要求重做；除用户明确保留的身份外，旧题材的展示物与装饰须替换为新题材物件，不只改材质。未要求改变的金额、规则、控制功能及其状态保持正确，不增加或重复区域，不得新增登录、输入、设置、弹窗等新功能。锚定区域内可创意重设计组件构造；点击目标可辨识，装饰不得遮挡玩法内容或控件。按钮造型、面板边框、字体视觉、材质与配色不继承旧主题。',
      businessFacts.length ? `业务事实：${businessFacts.map(native).join('；')}` : '', geometry,
      wireframe ? '定位图的标号与演示数值不是业务内容；不照搬灰框占位符，只使用用户提供的业务文案。' : '',
    ].filter(Boolean).join('。').replace(/[\r\n]+/g,' ').replace(/。{2,}/g,'。') : detailedPrompt;
    const modelPlan = { ...plan, layoutReference: plan.layoutReference ? 1 : 0,
      references: modelReferences.map(r => ({ ...r, index: order.indexOf(r.index) + 1 })).sort((a,b) => a.index-b.index),
      layoutChanges: plan.layoutChanges.map(remap), preserve: businessFacts.map(remap) }
    return { prompt, references: order.map(i => input.references[i-1]), plan: modelPlan, analysisPlan:plan, order, businessFacts: businessFacts.map(remap), businessFactsSource: plan.preserve.length ? observedLabels.length ? 'plan+observed-labels' : 'plan' : businessFacts.length ? 'observed-directive' : 'none' }
  }
  function key(input) {
    return JSON.stringify({ contract: 'ui-native-edit-20-scoped-attributes', uiCatalogEnabled:input.uiCatalogEnabled === true, provider: input.provider, engine: input.engine || 'local', targetEngine: input.targetEngine || '', prompt: input.prompt || '', negativePrompt: input.negativePrompt || '', generationIntent: input.generationIntent || '', preserveLayout: input.preserveLayout === true, editRegion: input.editRegion || null, size: input.size, structure: input.structure, references: (input.references || []).map(r => ({ id: r.id, dataUrl: r.dataUrl || r.imageUrl, role: r.role })) })
  }
  function remember(id, input, result, appliedInput) {
    const normalized = value => ({ ...value, references: requireLayoutReferences(value.references) })
    cache.set(id, { keys: [key(normalized(input)), ...(appliedInput ? [key(normalized(appliedInput))] : [])], result: JSON.parse(JSON.stringify(result)) })
    if (cache.size > 16) cache.delete(cache.keys().next().value)
  }
  function aborted() { const error = new Error('任务已中止'); error.name = 'AbortError'; return error }
  async function run(options) {
    const { id, signal, assistant } = options
    const input = { ...options.input, references: requireLayoutReferences(options.input?.references) }
    if (signal?.aborted) throw aborted()
    const previous = cache.get(id)
    if (previous?.keys.includes(key(input))) return { ...JSON.parse(JSON.stringify(previous.result)), reused: true }
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
  return Object.freeze({ run, remember, key, requireLayoutReferences, requestsThemeRedesign, requestsFormRedesign, requestsFormPreservation, normalizeQwenPlan, resolveQwenPlan, compileQwenPlan })
})

;
(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignAssistantWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const VERSION = '20260722-ui-design-assistant-workflow-6'
  // These vision routes have no fixed image-count limit. Transport size, context and
  // local memory limits still apply; do not confuse them with generation-model slots.
  const ANALYSIS_REFERENCE_LIMITS = Object.freeze({ grok: Infinity, local: Infinity })
  const MAX_ANALYSIS_REFERENCES = ANALYSIS_REFERENCE_LIMITS.grok
  const UI_STYLE_PRESETS = Object.freeze([
    Object.freeze({
      value: 'auto',
      label: '智能匹配',
      instruction: '根据页面功能、现有结构、用户要求和参考图职责，自动选择统一且适合该游戏产品的视觉语言。',
    }),
    Object.freeze({
      value: 'reference',
      label: '跟随参考图',
      instruction: '仅从职责为“风格”的参考图提取配色、材质、字体气质、线条、光影和装饰语言，不复制其布局、文字或功能。',
    }),
    Object.freeze({
      value: 'eastern-fantasy',
      label: '东方幻想',
      instruction: '采用克制的东方幻想视觉语言，以古典纹样、玉石、鎏金、织物或宣纸质感建立精致层级，避免装饰压过信息。',
    }),
    Object.freeze({
      value: 'anime-polished',
      label: '二次元精致',
      instruction: '采用高完成度二次元游戏 UI 语言，使用清晰色块、轻盈层次、细腻高光和统一描边，保证控件与文字易读。',
    }),
    Object.freeze({
      value: 'sci-fi-future',
      label: '科幻未来',
      instruction: '采用科幻未来视觉语言，以冷色发光边缘、半透明层板、精密线框和适量全息反馈建立技术感，避免过度霓虹。',
    }),
    Object.freeze({
      value: 'dark-epic',
      label: '暗黑史诗',
      instruction: '采用暗黑史诗视觉语言，以深色石材、旧金属、雕刻纹理、暗金强调和戏剧性明暗建立厚重感，同时保持操作清晰。',
    }),
    Object.freeze({
      value: 'cartoon-casual',
      label: '卡通休闲',
      instruction: '采用轻松友好的卡通游戏 UI 语言，以明快配色、圆润轮廓、柔和阴影和明确反馈降低理解成本。',
    }),
    Object.freeze({
      value: 'modern-minimal',
      label: '现代极简',
      instruction: '采用现代极简视觉语言，以克制配色、精细排版、清晰留白和轻量层级突出内容，避免空洞或网页模板感。',
    }),
  ])
  const UI_SCENE_HINTS = Object.freeze([
    Object.freeze({ label: '登录 / 选服', terms: Object.freeze(['登录', '选服', '服务器选择', '账号登录', 'login', 'server select']) }),
    Object.freeze({ label: '主界面 / 大厅', terms: Object.freeze(['主界面', '大厅', '主菜单', 'lobby', 'main menu']) }),
    Object.freeze({ label: '战斗 HUD', terms: Object.freeze(['战斗', '战场', '血条', '小地图', '准星', 'hud']) }),
    Object.freeze({ label: '角色 / 背包', terms: Object.freeze(['背包', '物品栏', '装备管理', '角色详情', 'inventory', 'character screen']) }),
    Object.freeze({ label: '商城 / 活动', terms: Object.freeze(['商城', '商店', '充值', '礼包', '活动中心', 'shop', 'store']) }),
    Object.freeze({ label: '弹窗 / 结算', terms: Object.freeze(['弹窗', '结算', '战斗结算', '战斗结果', '胜利界面', '失败界面', 'modal', 'result']) }),
  ])
  // Match the native UI request boundary; UI rules plus real layout facts can
  // exceed the old ordinary-image 1950-character limit before user text begins.
  const REQUIREMENTS_TRANSPORT_LIMIT = 4000
  const DEFAULT_TIMEOUT_MS = 120000
  const LOCAL_TIMEOUT_MS = 300000
  let protectionSequence = 0

  function text(value) {
    return String(value == null ? '' : value).trim()
  }

  function compactText(value, limit) {
    return text(value).replace(/\s+/g, ' ').slice(0, Math.max(0, Number(limit) || 0))
  }

  function budgetText(value, limit) {
    const normalized = text(value).replace(/\s+/g, ' ')
    const size = Math.max(0, Number(limit) || 0)
    if (normalized.length <= size) return normalized
    return `${normalized.slice(0, Math.max(0, size - 1))}…`
  }

  function normalizeProvider(value) {
    const provider = text(value).toLowerCase()
    return provider === 'gpt' ? 'gpt' : 'local'
  }

  function normalizeEngine(value) {
    return text(value).toLowerCase() === 'local' ? 'local' : 'grok'
  }

  function analysisReferenceLimit(engine) {
    return ANALYSIS_REFERENCE_LIMITS[normalizeEngine(engine)]
  }

  function normalizeTargetStyle(value) {
    const style = text(value).toLowerCase().replace(/[\s_]+/g, '-')
    return UI_STYLE_PRESETS.some((item) => item.value === style) ? style : 'auto'
  }

  function targetStyleInstruction(value) {
    const style = normalizeTargetStyle(value)
    return UI_STYLE_PRESETS.find((item) => item.value === style)?.instruction || ''
  }

  function targetStyleContractLine(value, legacy = false) {
    const style = normalizeTargetStyle(value)
    if (style === 'auto') return ''
    const preset = UI_STYLE_PRESETS.find((item) => item.value === style)
    if (!preset) return ''
    const suffix = legacy ? '' : ' 后文视觉描述若与本条冲突，以本条为准。'
    return `视觉风格约束（不改变页面结构）：${preset.label}。${preset.instruction}${suffix}`
  }

  function stripTargetStyleContract(value) {
    let prompt = String(value == null ? '' : value).replace(/\r\n/g, '\n').trim()
    let matched = true
    while (prompt && matched) {
      matched = false
      for (const preset of UI_STYLE_PRESETS) {
        if (preset.value === 'auto') continue
        for (const line of [targetStyleContractLine(preset.value), targetStyleContractLine(preset.value, true)]) {
          if (prompt === line) {
            prompt = ''
            matched = true
            break
          }
          if (prompt.startsWith(`${line}\n`)) {
            prompt = prompt.slice(line.length + 1).trimStart()
            matched = true
            break
          }
        }
        if (matched) break
      }
    }
    return prompt
  }

  function applyTargetStyleContract(value, targetStyle) {
    const prompt = stripTargetStyleContract(value)
    const style = normalizeTargetStyle(targetStyle)
    if (!prompt || style === 'auto') return prompt
    const contract = targetStyleContractLine(style)
    return contract ? `${contract}\n${prompt}` : prompt
  }

  function normalizeAction(value) {
    const action = text(value).toLowerCase()
    return ['create', 'preserve', 'style', 'combine'].includes(action) ? action : 'preserve'
  }

  function normalizeReferenceRole(value) {
    const role = text(value).toLowerCase().replace(/[\s_]+/g, '-')
    if (['style', 'visual-style', '风格'].includes(role)) return 'style'
    if (['layout', 'ui-layout', '布局'].includes(role)) return 'layout'
    if (['color', 'palette', '配色'].includes(role)) return 'color'
    if (['material', 'texture', '材质'].includes(role)) return 'material'
    if (role === 'asset') return 'asset'
    if (role === 'combined') return 'combined'
    if (['content', '内容', '素材'].includes(role)) return 'content'
    if (['character', '角色'].includes(role)) return 'character'
    if (['subject', 'identity', '主体'].includes(role)) return 'subject'
    return 'reference'
  }

  function normalizeReference(value, index) {
    if (!value || typeof value !== 'object') return null
    const dataUrl = text(value.dataUrl || value.imageUrl || value.url || value.src)
    if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(dataUrl)) return null
    return Object.freeze({
      id: text(value.id || value.sourceId || value.resourceId) || `ui_reference_${index + 1}`,
      name: text(value.name || value.fileName || value.filename) || `ui_reference_${index + 1}.png`,
      label: text(value.label || value.displayLabel) || `参考图${index + 1}`,
      role: normalizeReferenceRole(value.role || value.referenceRole || value.kind),
      ...(value.uiLayoutId ? {uiLayoutId:text(value.uiLayoutId)} : {}),
      dataUrl,
    })
  }

  function referenceSnapshot(values, engine = 'local') {
    const source = Array.isArray(values) ? values : []
    const normalizedEngine = normalizeEngine(engine)
    const limit = analysisReferenceLimit(normalizedEngine)
    if (source.length > limit) {
      const label = normalizedEngine === 'local' ? '本地模型' : '云端模型'
      throw new Error(`${label}一次最多分析 ${limit} 张参考图，请取消多余选择后再提交。`)
    }
    const references = source.map(normalizeReference).filter(Boolean)
    if (references.length !== source.length) throw new Error('参考图数据无效，AI 助手只接受 PNG、JPEG 或 WebP 图片。')
    return Object.freeze(references)
  }

  function structureSnapshot(value) {
    const source = value && typeof value === 'object' ? value : {}
    const regions = Array.isArray(source.regions)
      ? source.regions
      : Array.isArray(source.blocks)
        ? source.blocks
        : []
    return Object.freeze({
      name: text(source.name || source.title),
      description: text(source.description || source.summary || source.requirement),
      width: Math.max(0, Math.round(Number(source.width || source.canvas?.width) || 0)),
      height: Math.max(0, Math.round(Number(source.height || source.canvas?.height) || 0)),
      regions: Object.freeze(regions.map((region, index) => Object.freeze({
        name: text(region?.name || region?.title || region?.label) || `区块${index + 1}`,
        role: compactText(region?.role || region?.kind || region?.type, 40) || 'region',
        purpose: text(region?.purpose || region?.description),
        requirements: text(region?.requirements || region?.requirement),
        x: region?.x, y: region?.y, width: region?.width, height: region?.height,
      }))),
    })
  }

  function inferPageScene(value) {
    const structure = structureSnapshot(value)
    const sources = [
      { value: structure.name, weight: 4 },
      { value: structure.description, weight: 3 },
      ...structure.regions.flatMap((region) => [
        { value: region.name, weight: 2 },
        { value: [region.role, region.purpose, region.requirements].join(' '), weight: 1 },
      ]),
    ].map((source) => ({ ...source, value: text(source.value).toLowerCase() }))
    let bestLabel = '通用页面'
    let bestScore = 0
    let bestSpecificity = 0
    for (const hint of UI_SCENE_HINTS) {
      const score = sources.reduce((total, source) => (
        total + hint.terms.reduce((matches, term) => matches + (source.value.includes(term) ? source.weight : 0), 0)
      ), 0)
      const specificity = sources.reduce((total, source) => (
        total + hint.terms.reduce((matches, term) => matches + (source.value.includes(term) ? source.weight * term.length : 0), 0)
      ), 0)
      if (score > bestScore || (score === bestScore && specificity > bestSpecificity)) {
        bestScore = score
        bestSpecificity = specificity
        bestLabel = hint.label
      }
    }
    return bestScore >= 2 ? bestLabel : '通用页面'
  }

  function actionInstruction(action) {
    const instructions = {
      create: '从当前页面结构出发建立完整的新 UI 视觉方案，补足视觉层级、配色、材质与组件状态。',
      preserve: '严格保持现有页面结构、信息层级和功能分区，只提高视觉完成度与一致性。',
      style: '保持页面结构和功能不变，按所选目标风格重绘视觉；只有目标风格为“跟随参考图”时，才由职责为“风格”的参考图决定视觉语言。',
      combine: '组合多张参考图中被指定的单一职责，页面结构优先，禁止让任一参考图覆盖整体功能结构。',
    }
    return instructions[normalizeAction(action)]
  }

  function buildRequirements(options, structure, references) {
    const size = options.size || structure
    const preserveForms = root?.NovaFlowUiDesignPromptPipeline?.requestsFormPreservation?.(options) === true
    const preservedConstruction = '本次明确要求整体保形换皮：沿用布局图的全部组件外轮廓、尺寸比例、主体承托、边框组织、连接结构和负空间，仅重绘指定主题外观、画风、配色、材质与表面装饰，不提出构造或轮廓创新。更换主题时仍按用户要求替换人物、背景、玩法符号及标题内容，不因保形而保留旧主题身份；未要求替换的内容身份和文案保持，用户明确指定的局部改变仅处理该部分。'
    const wholeTheme = root?.NovaFlowUiDesignPromptPipeline?.requestsThemeRedesign?.(options) === true
    const businessInventory = '业务事实只来自指定布局图和用户明确业务要求，风格、配色、材质或人物素材里的文字、金额与控件不得加入业务清单。先从用户完整布局图逐区清点实际业务内容：玩法盘数量，' + (wholeTheme ? '每个盘的准确行列、重复符号关系、玩法特殊标记及其文字数值；普通物件的原身份和外观不写入保留事实，按新主题替换；' : '每个盘的准确行列和逐格实例、字母牌与重复符号关系、玩法特殊标记及其数值；') + '全部奖励档位名称与金额、余额、下注、赢取信息、规则文案，以及各操作图标的实际功能和状态。将准确读到的名称、数值、数量和功能写入最终要求及保留事实，不按常见游戏模板猜测；看不清的内容以原图为准，不编造。主题内容可一对一替换普通物件，未被用户明确要求修改的业务文字、金额、特殊标记和功能必须保留，不能新增或重复游戏盘，不能因为主题而添加登录、邀请、任务或其他功能。自建定位图的诊断文字与示例值不属于业务数据，只采用用户明确提供的业务要求。'
    if (options.targetEngine === 'qwen-2.1') {
      const requirements = [
        '这是 Qwen 2.1 UI 原生参考编辑规划。依据用户原文理解每张图的职责，独立判断视觉修改范围与布局修改范围，不使用固定主题或五段式绘图模板。',
        // Adapted from Qwen Image 2.1's edit guidance and the user's referenced
        // iamyoki/qwen-image-2.1-skill: isolate changed attributes and literal text.
        'Qwen编辑表达：以本次具体修改动作开头，明确改动对象和属性；未点名的区域用概括性保留条款，不重复描写旧外观诱发重绘。布局、风格、配色、质感和人物素材分工绑定到各自真实图片，不把某图的未指定属性一起迁移。描述语言与画面文字独立：保留有效文案的原语言、拼写、标点和数值；仅修改用户指定的文字，内部模块名称、图片编号与说明不能出现在成品里。简洁任务不凑字数，不添加未要求的装饰或功能。',
        'UI设计必须有布局图片，layoutReference必须指向有效布局图，不能为0，layoutMode不能是create。只有一张图片时这张就是布局图，包括原来标为风格或默认参考的图片；多图使用指定布局图或首张普通主图，自建布局图优先。保留布局图主要区域位置与功能关系，人物缩小、按钮上移、增加一行等仅处理用户明确要求的局部调整；其他风格或素材图不提供布局。',
        businessInventory,
        preserveForms ? preservedConstruction : '风格迁移保留未要求改变的内容身份与组件构造，新主题则贯穿人物、背景、符号和组件；局部修改只改指定部分。未明确要求纯换皮或整体保形的主题重设默认重新设计组件构造，自建布局矩形只约束区域锚点、用途与玩法关系，不锁定成品轮廓。仅重设计造型且主题不变时保留原主题、人物物品身份、有效文案和状态；用户明确要求固定形状或只迁移风格时按其范围处理。',
        preserveForms ? '逐组件说明原有轮廓、承托和连接如何保留，以及主题内容和表面美术如何替换；同类功能识别一致，文字、动作图标与点击目标清楚，装饰不遮挡玩法或金融条，不新增或遗漏功能。'
          : '主题或造型重设计必须落实到具体组件：分别描述标题、主框、奖励栏和按钮等组件的功能、文字或动作图标，实际承托它们的主体，主体外轮廓，以及与相邻部件的连接；说明怎样组织边框、装饰支撑和负空间。循环箭头只表示动作，不等于圆形按钮外壳；主体形体根据目标主题选择，不套固定题材模板或统一一种形体。保持目标完整画风与配色，并完成材质和光影，通过轮廓、承托与连接关系的具体变化辨认新构造，不能只换材质或把原角饰换成相同位置的主题饰件。同类功能的视觉识别保持一致，文字和点击目标清楚，装饰不遮挡玩法、文字和点击目标，不新增功能。构造变更限定在对应功能区域内，不挤占金额、余额、下注等金融条或其他控件，也不靠删除功能腾出空间；无法容纳时优先选择低占用的承托与连接设计。',
        preserveForms ? '在完整布局图与整张UI关系中保形重绘，统一目标画风、材质、配色和光照，保持原组件轮廓、承托、连接及视觉比例，最终输出完整界面。'
          : '在完整布局图和整张UI的关系中设计或修改组件，最终输出完整界面；各组件共同遵循目标主题的形状语言、材质表现、光照方向与视觉比例。不同外轮廓应来自主题物件的承托与连接逻辑，不能用任意替换几何形状代替构造设计；局部迭代须与未修改区域的既有画风、光照和尺度衔接。',
        options.generationIntent === 'iteration' ? '本次在完整UI参考图上迭代，仅修改用户指定部分；其余已正确的文案、金额、规则、图案身份与位置、全部控件及功能状态保持准确完整，不能遗漏或用空白替代。' : '',
        preserveForms ? 'preserve应记录源图组件的轮廓、主体承托、边框组织与连接结构，以及玩法拓扑、符号数量、功能、金额状态和主要区域锚点；用户要求新主题时，不保留未指定的旧人物、旧符号身份或旧标题。'
          : 'preserve只记录玩法拓扑、网格数量、功能、金额状态、主要区域锚点及用户实际指定的限制。主题或造型重设计时，不把源图的四角铆钉、角饰数量与位置、原边框组织、连接件、支撑底座、固定轮廓和尺寸比例写成保留事实；用户原文确实要求保留的具体构造优先。',
        '给出完整且具体的美术设计：形状语言、色彩层级、材质和光影，区分常见与稀有符号，重复符号造型统一、有效文字准确。不按题材固定配色和渲染方式，也不擅自添加功能。',
        '风格参考的主色、强调色、明暗对比、材质反光和体积塑造需要落实到设计，不泛化成题材词。用户要求有质感时避免全部区域同色同亮度；淡彩、扁平或简约需求仍以用户原风格为准。',
        `输出尺寸：${size.width || structure.width}×${size.height || structure.height}。`,
        references.length ? `输入顺序和指定用途：${references.map((r,i)=>`图${i+1}：${r.role}`).join('；')}` : '',
        structure.regions.length && references.some(r=>r.uiLayoutId) ? `图${references.findIndex(r=>r.uiLayoutId)+1}是当前自建布局定位图，layoutReference必须使用它；灰块仅代表空间占位，不是成品造型、原有内容或文案。` : '',
        structure.regions.length ? `自建布局（坐标和用途有效，名称不作为画面文字）：${JSON.stringify(structure)}` : '',
        options.requirements || '',
      ].filter(Boolean).join('\n')
      if (requirements.length > REQUIREMENTS_TRANSPORT_LIMIT) throw new Error('布局说明和补充要求过长，请精简后再试；本次未截断提交。')
      return requirements
    }
    const content = [
      '你是 UI 视觉设计助手。只输出可直接生成设计图的最终中文提示词。根据用户要求理解布局、风格和人物物品参考的分工，不强加预设风格、内容类型或商业化倾向。',
      businessInventory,
      `有完整UI布局参考时，先逐区清点原界面：人物展示区、图标区、提示栏和操作栏全部保留。记录主要区域锚点、用途、功能顺序、网格准确行列数和控件数量，必须逐行逐列数清，不按常见模板猜测。${preserveForms ? preservedConstruction : '未明确要求纯换皮或整体保形的主题重做保持玩法拓扑与主要功能区域，默认重新设计区域内的组件造型和构造，不把旧框体轮廓、边框组织、四角装饰、连接件或支撑结构当成玩法约束；不能仅换材质或换成同位置的主题角饰。'}用户说不保留任何元素，指美术内容，不代表取消布局；只有明确要求重新布局或重新排版时才改变功能结构。仅风格迁移和局部编辑保留未要求改变的原构造；用户明确固定形状时优先。风格图和人物物品图不提供布局。`,
      preserveForms ? '本次为明确保形换皮，人物、物品、背景和标题是否替换按用户原文处理；默认redesign标记不授权改变组件构造或未要求替换的内容身份，保形也不冻结明确指定的新主题内容。'
        : options.generationIntent === 'style-transfer'
        ? '本次为风格迁移，保持参考界面的功能、文案和内容身份；用户未要求改变的布局、网格行列及物品数量不变，只改变指定视觉风格，不能重做内容。'
        : options.generationIntent === 'iteration'
        ? '本次在完整UI参考图上迭代，仅修改用户指定部分；其余已正确的文案、金额、规则、图案身份与位置、全部控件及功能状态保持准确完整，不能遗漏或用空白替代。'
        : '本次为完整 UI 设计。参考图只按用户指定用途借鉴，不默认锁定原图的人物、背景、图标、文案或旧主题。用户要求重新设计或不保留任何元素时，全部视觉区域一起改成目标主题，不能只替换人物服装；最终提示词必须明确这些改动，不能描述成原图局部编辑。',
      '用户明确要求优先；UI设计必须使用布局图片，自建布局图优先，只有一张图片时它就是布局图，多图中指定布局图或首张普通主图提供主要区域位置、用途和功能关系。其他风格图只借鉴配色、材质、按钮、边框和图标，不移植整体排布或无关人物、商品、文字。按要求融合指定元素。',
      preserveForms ? '逐组件保留原轮廓、主体承托、边框和连接，落实新主题内容与指定画风、材质、光影；保形不冻结需要替换的人物、符号或标题身份，完整保留金额、规则、文案及控件功能状态，装饰不得遮挡玩法或金融条。'
        : '主题或造型重设计须分别描述主要组件的功能、文字或动作图标，实际承托它们的主体，主体外轮廓，以及与相邻部件的连接；说明边框组织、装饰支撑、叠放和负空间。循环箭头只表示动作，不等于圆形按钮外壳；主体形体根据目标主题选择，不套固定题材模板或统一一种形体。保持目标完整画风与配色，并完成材质和光影，通过轮廓、承托与连接关系辨认具体构造差异；仅要求造型重做而主题不变时，原主题、人物物品身份、有效文案、金额和状态保持正确。同类功能识别一致，文字与点击目标清楚。构造变更限定在对应功能区域内，不挤占金额、余额、下注等金融条或其他控件，也不靠删除功能腾出空间；无法容纳时优先选择低占用的承托与连接设计。',
      preserveForms ? '在完整布局图与整张UI关系中保形重绘，统一目标画风、材质、配色和光照，保持原组件轮廓、承托、连接及视觉比例，最终输出完整界面。'
        : '在完整布局图和整张UI的关系中设计或修改组件，最终输出完整界面；各组件共同遵循目标主题的形状语言、材质表现、光照方向与视觉比例。不同外轮廓应来自主题物件的承托与连接逻辑，不能用任意替换几何形状代替构造设计；局部迭代须与未修改区域的既有画风、光照和尺度衔接。',
      '区分软件编辑器外框和目标 UI 内容：不生成编辑器手柄与辅助线；目标 UI 的按钮、菜单和用户指定文案必须保留。局部修改时保留未要求改变的内容。不要擅自增加金币、角标等功能。',
      '所有 __NOVAFLOW_ 开头并以双下划线结尾的引用占位符原样原次数保留；图片编号按输入顺序，不重新编号。不要输出分析过程或多套方案。',
      `输出尺寸：${size.width || structure.width}×${size.height || structure.height}。`,
      structure.regions.length ? `自建布局（坐标只指导构图，不作为画面文字）：${JSON.stringify(structure)}` : '',
      references.length ? `参考图：${references.map((r,i) => `图${i+1}：${r.role === 'reference' ? '根据需求判断用途' : r.role}`).join('；')}` : '',
      options.requirements ? `补充要求：${options.requirements}` : '',
    ].filter(Boolean).join('\n')
    if (content.length > REQUIREMENTS_TRANSPORT_LIMIT) throw new Error('布局说明和补充要求过长，请精简后再优化；本次未截断提交。')
    return content
  }

  // Prompt drafting without a reference is distinct from image-based UI
  // generation: keep the existing professional constraints, but never claim
  // to have seen a layout, inferred business text or analysed a reference.
  function buildTextOnlyRequirements(options, structure) {
    const size=options.size||structure
    const content=[
      '你是 UI 视觉设计助手。只优化用户给出的界面需求，不假装已经看到或分析图片。业务功能、文案、金额、数量及状态只来自用户明确描述或已提供的结构，不按常见模板猜测。',
      '围绕用户实际要求组织主要区域、组件功能、文字与动作图标、点击目标和视觉层级。主题、画风、材质、配色与光照以用户要求为准，不强加固定题材或商业功能。',
      '需要调整组件造型时，具体说明主体承托、外轮廓、边框连接与负空间；保持同类功能识别一致，不让装饰遮挡文案、金额或控件，不靠删除功能腾空间。',
      '只修改用户明确要求的内容。不要添加未要求的按钮、奖励、金币、数值、人物或游戏盘；未知事实保持未指定，不编造现有界面细节。区分目标 UI 和编辑器外框，不输出编辑器手柄或辅助线。',
      '所有 __NOVAFLOW_ 开头并以双下划线结尾的占位符须原样保留。不要输出分析过程或多套方案。',
      `输出尺寸：${size.width||structure.width}×${size.height||structure.height}。`,
      structure.regions.length?`用户提供的结构（坐标只指导构图，名称不作为画面文字）：${JSON.stringify(structure)}`:'',
      options.requirements?`补充要求：${options.requirements}`:'',
    ].filter(Boolean).join('\n')
    if(content.length>REQUIREMENTS_TRANSPORT_LIMIT)throw new Error('布局说明和补充要求过长，请精简后再优化；本次未截断提交。')
    return content
  }

  async function prepareReferencesForEngine(references, engine) {
    if (normalizeEngine(engine) !== 'grok' || !references.length) return references
    const helper = root?.NovaFlowUiDesignAssistantImageHelper
    if (typeof helper?.normalizeReferencesForGrok !== 'function') return references
    const prepared = await helper.normalizeReferencesForGrok(references)
    if (!Array.isArray(prepared) || prepared.length !== references.length) {
      throw new Error('参考图预处理失败，请重新选择参考图。')
    }
    return referenceSnapshot(prepared, 'grok')
  }

  function fallbackProtect(value) {
    const sourceText = String(value == null ? '' : value)
    const sequence = ++protectionSequence
    const tokens = []
    const protectedText = sourceText.replace(/@参考图[1-9][0-9]*/g, (token) => {
      const placeholder = `__NOVAFLOW_UI_REFERENCE_${sequence}_${tokens.length}__`
      tokens.push({ placeholder, token })
      return placeholder
    })
    return { text: protectedText, tokens, sourceText }
  }

  function protectText(value) {
    const tool = root?.NovaFlowResourceMentionTool
    return typeof tool?.protectText === 'function' ? tool.protectText(value) : fallbackProtect(value)
  }

  function restoreText(value, protection) {
    const tool = root?.NovaFlowResourceMentionTool
    if (typeof tool?.restoreText === 'function') return tool.restoreText(value, protection)
    let restored = String(value == null ? '' : value)
    for (const item of protection?.tokens || []) {
      const count = restored.split(item.placeholder).length - 1
      if (count !== 1) return { ok: false, text: restored, reason: 'protected resource mention is missing or duplicated' }
    }
    for (const item of protection?.tokens || []) restored = restored.replace(item.placeholder, item.token)
    return { ok: true, text: restored }
  }

  function unwrapResult(result) {
    if (!result || result.ok === false) throw new Error(text(result?.error) || 'AI 助手执行失败')
    const data = result.result && typeof result.result === 'object'
      ? result.result
      : result.data && typeof result.data === 'object'
        ? result.data
        : result
    const prompt = text(
      result?.prompt || result?.positivePrompt || result?.positive_prompt || result?.output_text
      || data?.prompt || data?.positivePrompt || data?.positive_prompt || data?.output_text,
    )
    const negativePrompt = text(
      result?.negativePrompt || result?.negative_prompt || data?.negativePrompt || data?.negative_prompt,
    )
    if (!prompt) throw new Error('AI 助手未返回可用的设计要求')
    return { prompt, negativePrompt, uiPlan: result.uiPlan || data.uiPlan || result.ui_plan || data.ui_plan }
  }

  function timeoutForEngine(engine, timeoutMs) {
    const configured = Number(timeoutMs)
    if (Number.isFinite(configured) && configured > 0) return Math.max(1, configured)
    return normalizeEngine(engine) === 'local' ? LOCAL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS
  }

  function withTimeout(task, timeoutMs, engine) {
    const ms = timeoutForEngine(engine, timeoutMs)
    let timer = 0
    return new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('AI 助手请求超时，请稍后重试')), ms)
      Promise.resolve().then(task).then(resolve, reject).finally(() => clearTimeout(timer))
    })
  }

  function localApi(options, references) {
    const api = options?.electronAPI || root?.electronAPI || {}
    return references.length ? api.promptAssistantReverseImagePrompt : api.promptAssistantOptimizePrompt
  }

  function grokApi(options, references) {
    const api = options?.electronAPI || root?.electronAPI || {}
    return references.length ? api.smartAiImageReverse : api.smartAiPromptOptimize
  }

  async function resolveValue(value, fallback) {
    if (typeof value !== 'function') return value == null ? fallback : value
    return await value()
  }

  async function runGrokComplete(options,references,checkActive) {
    const api=options.electronAPI||root.electronAPI||{},cpu=api.promptAssistantUiDesignCpu;
    if(typeof cpu!=='function'||typeof root.NovaFlowWebRuntime?.auth!=='function') throw new Error('完整在线看图分析需要更新 Foart并登录官网；本次未调用付费分析');
    const request=[stripTargetStyleContract(options.prompt),options.requirements||''].filter(Boolean).join('\n');
    const callCpu=async payload=>{const r=await cpu({surface:'ui-design',...payload});if(r?.ok===false||!r?.data)throw new Error(r?.error||'UI CPU 组件未返回有效结果');return r.data;};
    const reverse=localApi(options,references);
    if(typeof reverse!=='function')throw new Error('在线目录设计需要算力助手先识别布局；未切换分析来源');
    const capability=await cpu({surface:'ui-design',action:'capabilities'});
    if((capability?.data?.localCompletePlanner!=='native-catalog-v3'||capability?.data?.sourceContract!=='observed-rows-v2'))throw new Error('请更新 Foart后使用完整在线目录设计；本次未调用付费分析');
    const sourceResult=await reverse({uiPlanner:'native-catalog-v3',surface:'ui-design',targetEngine:'qwen-2.1',uiDesignIntent:'redesign',uiPreserveLayout:true,uiAnalysisStage:'source-only',currentPrompt:request,images:references.map(r=>({dataUrl:r.dataUrl,role:r.role}))});
    checkActive();const source=sourceResult?.data||sourceResult;
    if(sourceResult?.ok===false||!source?.bundle||source.uiCatalog?.recognitionMethod!=='native-source-catalog-v3')throw new Error(sourceResult?.error||'在线分析的前置布局识别未完成；未提交云端分析或生图');
    const job=await callCpu({action:'native-ui-cloud',bundle:source.bundle,images:references.map(r=>({dataUrl:r.dataUrl,role:r.role}))});
    checkActive();
    const requestId=root.crypto?.randomUUID?.();if(!requestId)throw new Error('浏览器不能创建分析请求标识');
    const reply=await root.NovaFlowWebRuntime.auth('POST','/api/client/runninghub/ui-catalog',{...job,requestId,foartUiContract:options.foartUiContract},180000);
    checkActive();
    const model=typeof reply?.model==='string'?reply.model.trim():'';
    if(!reply?.ok||!model||reply.providerCallCount!==1||reply.retryCount!==0||reply.clientRequestId!==requestId||reply.finishReason!=='completed'||typeof reply.rawOutputText!=='string'||!reply.rawOutputText.trim())throw new Error(reply?.error||'在线目录分析未完成；未切换分析来源或提交生图');
    const compiled=await callCpu({action:'native-ui-compile',bundle:source.bundle,raw:reply.rawOutputText});
    checkActive();
    const layoutReference=references.findIndex(r=>r.role==='layout')+1;
    return {prompt:compiled.prompt,negativePrompt:'',quota:reply.quota||null,uiCatalog:{...source.uiCatalog,recognitionMethod:'native-grok-catalog-v3',analysisProvider:'grok',layoutAnalysisProvider:'local',model:reply.model,providerCallCount:1,providerRequestId:reply.requestId,proof:compiled.proof},
      uiPlan:{version:1,layoutMode:'preserve',layoutReference,visualMode:'theme-redesign',references:references.map((r,i)=>({index:i+1,role:r.role==='layout'?'layout':r.role==='style'?'style':'content'})),layoutChanges:[],preserve:[],grids:[]}};
  }

  function chargeQuota(result) {
    const quota = result?.quota || result?.result?.quota || result?.data?.quota
    return quota && typeof quota === 'object' ? quota : null
  }

  async function run(options = {}) {
    const checkActive = () => { if (options.signal?.aborted) { const error = new Error('任务已中止'); error.name = 'AbortError'; throw error } }
    checkActive()
    const provider = normalizeProvider(options.provider)
    const engine = normalizeEngine(options.engine)
    const rawReferences = await resolveValue(options.getReferences, options.references || [])
    const layoutValidator = root?.NovaFlowUiDesignPromptPipeline?.requireLayoutReferences
    if (typeof layoutValidator !== 'function') throw new Error('UI 布局校验组件未就绪，本次未提交生成')
    const references = layoutValidator(referenceSnapshot(rawReferences, engine))
    const targetStyle = 'auto'
    if (targetStyle === 'reference' && !references.some((reference) => reference.role === 'style')) {
      throw new Error('“跟随参考图”需要至少选择一张职责为“风格”的参考图。')
    }
    const requestReferences = await prepareReferencesForEngine(references, engine)
    const rawStructure = await resolveValue(options.getStructureContext, options.structure || options.snapshot || {})
    const structure = structureSnapshot(rawStructure)
    const scene = inferPageScene(structure)
    const useCatalog = options.uiCatalogEnabled === true && ['local','grok'].includes(engine) && options.targetEngine === 'qwen-2.1'
      && options.preserveLayout === true && options.generationIntent === 'redesign'
      && !references.some(ref => ref.uiLayoutId)
      && root.NovaFlowUiDesignPromptPipeline.requestsThemeRedesign(options)
      && !root.NovaFlowUiDesignPromptPipeline.requestsFormPreservation(options)
    if (useCatalog) {
      const revision = typeof options.getRevision === 'function' ? options.getRevision() : options.revision
      const call = engine==='grok' ? null : localApi(options, references)
      if (engine!=='grok' && typeof call !== 'function') throw new Error('本地模型未就绪')
      if(engine==='local'){
        const api=options.electronAPI||root.electronAPI||{};
        if(typeof api.promptAssistantUiDesignCpu!=='function')throw new Error('请更新 Foart后使用完整UI设计，本次未调用其他分析模型');
        const capability=await api.promptAssistantUiDesignCpu({surface:'ui-design',action:'capabilities'});
        checkActive();
        if((capability?.data?.localCompletePlanner!=='native-catalog-v3'||capability?.data?.sourceContract!=='observed-rows-v2'))throw new Error('当前算力节点需要更新 Foart后才能运行完整UI设计，本次未提交分析或生图');
      }
      const request = [stripTargetStyleContract(options.prompt), options.requirements || ''].filter(Boolean).join('\n')
      const result = engine==='grok' ? await withTimeout(()=>runGrokComplete(options,references,checkActive),options.timeoutMs||900000,engine) : await withTimeout(() => call({ uiPlanner:'native-catalog-v3', surface:'ui-design', targetEngine:'qwen-2.1',
        uiDesignIntent:'redesign', uiPreserveLayout:true, currentPrompt:request, uiStructure:structure,
        images:references.map(ref => ({ dataUrl:ref.dataUrl, role:ref.role, label:ref.label })) }), options.timeoutMs || 900000, engine)
      checkActive()
      if (typeof options.getRevision === 'function' && options.getRevision() !== revision) throw new Error('设计要求已变化，本次结果未覆盖当前内容')
      const data = result?.data || result
      if (result?.ok === false || !data?.prompt || data?.uiCatalog?.schema !== 'nf.ui.structure-catalog.v1') throw new Error(result?.error || '结构编译未返回有效结果，本次未提交生成')
      if (data.uiCatalog.recognitionMethod !== (engine==='grok'?'native-grok-catalog-v3':'native-source-catalog-v3')) throw new Error('算力节点的 UI 分析组件需要更新，请安装最新版 Foart后重试；本次未提交生图')
      return Object.freeze({ ...data, provider, engine, targetStyle:'auto', purpose:'ui-design-reference', referenceCount:references.length,
        references, structure, scene, hasNegativePrompt:false, negativePrompt:'', quota: chargeQuota(result) })
    }
    const requirements = buildRequirements(options, structure, references)
    const currentPrompt = stripTargetStyleContract(options.prompt)
    if (currentPrompt.length > 18000 || String(options.negativePrompt || '').length > 10000) throw new Error('提示词过长，请精简后再试；本次未截断提交。')
    const currentNegative = String(options.negativePrompt == null ? '' : options.negativePrompt)
    const promptProtection = protectText(currentPrompt.replace(/(?<!@参考)(?:参考图|图)\s*([1-9][0-9]*)/g, (token, index, offset, full) => full.slice(Math.max(0, offset - 1), offset) === '@' ? token : `@参考图${index}`))
    const negativeProtection = protectText(currentNegative)
    const revision = typeof options.getRevision === 'function' ? options.getRevision() : options.revision
    const supportsNegativePrompt = provider === 'local'
    const requestedPurpose = text(options.purpose).toLowerCase().replace(/[\s_]+/g, '-')
    const purpose = requestedPurpose.startsWith('ui-design-')
      ? requestedPurpose
      : 'ui-design-reference'

    const call = engine === 'local' ? localApi(options, references) : grokApi(options, references)
    if (typeof call !== 'function') throw new Error(engine === 'local' ? '本地模型未就绪' : '云端模型未就绪')

    let result
    if (engine === 'grok') {
      const sessionToken = text(await resolveValue(options.getSessionToken, options.sessionToken))
      if (!sessionToken) throw new Error('请先登录 Foart 账号')
      checkActive()
      const request = {
        foartUiContract: options.foartUiContract,
        token: sessionToken,
        prompt: promptProtection.text,
        currentPrompt: promptProtection.text,
        negativePrompt: supportsNegativePrompt ? negativeProtection.text : '',
        supportsNegativePrompt,
        requirements,
        purpose,
        surface: 'ui-design',
        targetEngine: options.targetEngine || '',
        uiDesignIntent: ['iteration', 'style-transfer'].includes(options.generationIntent) ? options.generationIntent : 'redesign',
        uiPreserveLayout: options.preserveLayout === true,
        scenario: references.length ? 'role_reference' : undefined,
        sourceCount: references.length,
        targetIndex: 0,
        images: requestReferences.map((reference) => ({
          imageUrl: reference.dataUrl,
          label: reference.label,
          role: reference.role,
          slotType: reference.role,
        })),
      }
      result = await withTimeout(() => call(request), options.timeoutMs, engine)
    } else if (references.length) {
      result = await withTimeout(() => call({
        prompt: promptProtection.text,
        currentPrompt: promptProtection.text,
        negativePrompt: supportsNegativePrompt ? negativeProtection.text : '',
        requirements,
        purpose,
        surface: 'ui-design',
        targetEngine: options.targetEngine || '',
        uiDesignIntent: ['iteration', 'style-transfer'].includes(options.generationIntent) ? options.generationIntent : 'redesign',
        uiPreserveLayout: options.preserveLayout === true,
        provider,
        images: references.map((reference) => ({
          dataUrl: reference.dataUrl,
          label: reference.label,
          role: reference.role,
          slotType: reference.role,
        })),
      }), options.timeoutMs, engine)
    } else {
      result = await withTimeout(() => call({
        prompt: promptProtection.text,
        currentPrompt: promptProtection.text,
        negativePrompt: supportsNegativePrompt ? negativeProtection.text : '',
        requirements,
        purpose,
        surface: 'ui-design',
        targetEngine: options.targetEngine || '',
        uiDesignIntent: ['iteration', 'style-transfer'].includes(options.generationIntent) ? options.generationIntent : 'redesign',
        uiPreserveLayout: options.preserveLayout === true,
        provider,
      }), options.timeoutMs, engine)
    }

    if (typeof options.getRevision === 'function' && options.getRevision() !== revision) {
      const error = new Error('设计要求已在助手处理期间发生变化，本次结果未覆盖当前内容')
      error.name = 'StaleResultError'
      throw error
    }

    checkActive()
    const parsed = unwrapResult(result)
    if (options.targetEngine !== 'qwen-2.1' && options.preserveLayout) parsed.prompt = parsed.prompt.replace(/\[布局与功能\][\s\S]*?(?=\[区域设计\])/, '[布局与功能]\n除用户明确要求改变的项目外，沿用布局参考图的全部区域、位置、面积占比、顺序、叠放、对齐、网格行列和控件数量，人物展示区不得遗漏；逐区替换视觉，不扩大符号区挤占人物区。任何不确定的布局数据直接以参考图为准，禁止估算或套用常见模板。\n')
    const restoredPrompt = restoreText(parsed.prompt, promptProtection)
    if (!restoredPrompt.ok) throw new Error('参考图引用保护失败，已保留原设计要求')
    let restoredNegative = { ok: true, text: '' }
    if (supportsNegativePrompt && parsed.negativePrompt) {
      restoredNegative = restoreText(parsed.negativePrompt, negativeProtection)
      if (!restoredNegative.ok) throw new Error('负面要求中的参考图引用保护失败，已保留原内容')
    }

    const finalPrompt = restoredPrompt.text
    if (options.targetEngine === 'qwen-2.1') {
      if (!parsed.uiPlan) throw new Error('Qwen 2.1 UI 设计规划不完整，本次未提交生成')
      // Validate the analysis contract before applying defensive scope guards.
      // Invalid analysis is an error, never permission to invent a fallback.
      root.NovaFlowUiDesignPromptPipeline.normalizeQwenPlan(parsed.uiPlan, { ...options, references })
      const restoreList = list => Array.isArray(list) ? list.map(value => {
        let restored = value
        if (typeof restored !== 'string') return restored
        for (const item of promptProtection.tokens || []) restored = restored.replaceAll(item.placeholder, item.token)
        if (/__NOVAFLOW_[A-Z0-9_:-]+__/.test(restored)) throw new Error('设计规划包含无效的参考图标识')
        return restored
      }) : list
      parsed.uiPlan = { ...parsed.uiPlan, layoutChanges: restoreList(parsed.uiPlan.layoutChanges), preserve: restoreList(parsed.uiPlan.preserve) }
    }

    return Object.freeze({
      quota: chargeQuota(result),
      prompt: finalPrompt,
      uiPlan: options.targetEngine === 'qwen-2.1' ? root.NovaFlowUiDesignPromptPipeline.resolveQwenPlan(parsed.uiPlan, { references, prompt: currentPrompt, preserveLayout: options.preserveLayout, generationIntent: options.generationIntent }) : null,
      negativePrompt: supportsNegativePrompt ? restoredNegative.text : '',
      hasNegativePrompt: supportsNegativePrompt && Boolean(restoredNegative.text),
      provider,
      engine,
      targetStyle,
      purpose,
      referenceCount: references.length,
      references,
      structure,
      scene,
    })
  }

  function createSession() {
    let token = 0
    return Object.freeze({
      cancel() { token += 1 },
      async run(options) {
        const requestToken = ++token
        const result = await run(options)
        if (requestToken !== token) {
          const error = new Error('AI 助手请求已取消')
          error.name = 'AbortError'
          throw error
        }
        return result
      },
    })
  }

  return Object.freeze({
    VERSION,
    ANALYSIS_REFERENCE_LIMITS,
    MAX_ANALYSIS_REFERENCES,
    REQUIREMENTS_TRANSPORT_LIMIT,
    DEFAULT_TIMEOUT_MS,
    LOCAL_TIMEOUT_MS,
    UI_STYLE_PRESETS,
    normalizeProvider,
    normalizeEngine,
    timeoutForEngine,
    analysisReferenceLimit,
    normalizeTargetStyle,
    targetStyleInstruction,
    targetStyleContractLine,
    stripTargetStyleContract,
    applyTargetStyleContract,
    normalizeReferenceRole,
    referenceSnapshot,
    structureSnapshot,
    inferPageScene,
    buildRequirements,
    buildTextOnlyRequirements,
    prepareReferencesForEngine,
    protectText,
    restoreText,
    run,
    createSession,
  })
})

const pipeline=globalThis.NovaFlowUiDesignPromptPipeline,assistant=globalThis.NovaFlowUiDesignAssistantWorkflow;
if(!pipeline||!assistant)throw Error('ui-compiler-unavailable');
return Object.freeze({pipeline:Object.freeze({requireLayoutReferences:pipeline.requireLayoutReferences,normalizeQwenPlan:pipeline.normalizeQwenPlan}),assistant:Object.freeze({structureSnapshot:assistant.structureSnapshot,buildRequirements:assistant.buildRequirements,buildTextOnlyRequirements:assistant.buildTextOnlyRequirements,restoreText:assistant.restoreText})});})();
export const pipeline=isolated.pipeline;export const assistant=isolated.assistant;
export const sourceHashes=Object.freeze({"ui-design-prompt.pipeline.js":"44b1da267fc06ccf043e3d74ac8178a1dc3e6345b2b80806747f9ac17e23a374","ui-design-assistant.workflow.js":"cfe7dcc8dc8105c8abcbb5162837150d7f6affe51a058bab8a822f216f4395ba"});
