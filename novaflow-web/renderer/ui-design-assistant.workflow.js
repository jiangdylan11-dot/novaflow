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
  const REQUIREMENTS_TRANSPORT_LIMIT = 1950
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
    return provider === 'gpt' || provider === 'google' ? provider : 'local'
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
    if (['content', 'asset', '内容', '素材'].includes(role)) return 'content'
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
    if (options.targetEngine === 'qwen-2.1') {
      const requirements = [
        '这是 Qwen 2.1 UI 原生参考编辑规划。依据用户原文理解每张图的职责，独立判断视觉修改范围与布局修改范围，不使用固定主题或五段式绘图模板。',
        '用户未提出改变布局时沿用有效布局来源；人物缩小、按钮上移、增加一行等属于局部布局调整，不能被整体保留规则否定，也不代表全部重排。只有风格或素材图时不继承它的布局。',
        '风格迁移保留未要求改变的内容身份，新主题则贯穿人物、背景、符号和组件；局部修改保留其他区域。自建布局矩形仅约束位置与用途，组件轮廓可以重新设计。',
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
      '有完整UI布局参考时，先逐区清点原界面：人物展示区、图标区、提示栏和操作栏全部保留。记录相对位置、占比、顺序、叠放关系、网格准确行列数和控件数量，必须逐行逐列数清，不按常见模板猜测。主题重做只替换视觉，禁止重排、合并、删除区域或改变格数。用户说不保留任何元素，指美术内容，不代表取消布局；只有明确要求重新布局或重新排版时才改变结构。风格图和人物物品图不提供布局。',
      options.generationIntent === 'style-transfer'
        ? '本次为风格迁移，保持参考界面的功能、文案和内容身份；用户未要求改变的布局、网格行列及物品数量不变，只改变指定视觉风格，不能重做内容。'
        : options.generationIntent === 'iteration'
        ? '本次为局部编辑，用户指定要保留的部分不变。'
        : '本次为完整 UI 设计。参考图只按用户指定用途借鉴，不默认锁定原图的人物、背景、图标、文案或旧主题。用户要求重新设计或不保留任何元素时，全部视觉区域一起改成目标主题，不能只替换人物服装；最终提示词必须明确这些改动，不能描述成原图局部编辑。',
      '用户明确要求优先；有自建布局时遵守各区域位置、用途和数量。没有布局时按用户需求和布局参考合理排布。风格图只借鉴配色、材质、按钮、边框、图标和排版，不移植无关人物、商品或文字。按要求融合指定元素。',
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

  async function run(options = {}) {
    const checkActive = () => { if (options.signal?.aborted) { const error = new Error('任务已中止'); error.name = 'AbortError'; throw error } }
    checkActive()
    const provider = normalizeProvider(options.provider)
    const engine = normalizeEngine(options.engine)
    const rawReferences = await resolveValue(options.getReferences, options.references || [])
    const references = referenceSnapshot(rawReferences, engine)
    const targetStyle = 'auto'
    if (targetStyle === 'reference' && !references.some((reference) => reference.role === 'style')) {
      throw new Error('“跟随参考图”需要至少选择一张职责为“风格”的参考图。')
    }
    const requestReferences = await prepareReferencesForEngine(references, engine)
    const rawStructure = await resolveValue(options.getStructureContext, options.structure || options.snapshot || {})
    const structure = structureSnapshot(rawStructure)
    const scene = inferPageScene(structure)
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
      : (references.length ? 'ui-design-reference' : (currentPrompt.trim() ? 'ui-design-optimize' : 'ui-design-create'))

    const call = engine === 'local' ? localApi(options, references) : grokApi(options, references)
    if (typeof call !== 'function') throw new Error(engine === 'local' ? '本地模型未就绪' : '云端模型未就绪')

    let result
    if (engine === 'grok') {
      const sessionToken = text(await resolveValue(options.getSessionToken, options.sessionToken))
      if (!sessionToken) throw new Error('请先登录 NovaFlow 账号')
      checkActive()
      result = await withTimeout(() => call({
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
      }), options.timeoutMs, engine)
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
    if (parsed.uiPlan && options.targetEngine === 'qwen-2.1') {
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
      prompt: finalPrompt,
      uiPlan: options.targetEngine === 'qwen-2.1' ? root.NovaFlowUiDesignPromptPipeline.normalizeQwenPlan(parsed.uiPlan, { references }) : null,
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
    prepareReferencesForEngine,
    protectText,
    restoreText,
    run,
    createSession,
  })
})
