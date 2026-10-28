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
    if(typeof cpu!=='function'||typeof root.NovaFlowWebRuntime?.auth!=='function') throw new Error('完整在线看图分析需要更新本地助手并登录 NovaFlow；本次未调用付费分析');
    const request=[stripTargetStyleContract(options.prompt),options.requirements||''].filter(Boolean).join('\n');
    const callCpu=async payload=>{const r=await cpu({surface:'ui-design',...payload});if(r?.ok===false||!r?.data)throw new Error(r?.error||'UI CPU 组件未返回有效结果');return r.data;};
    const reverse=localApi(options,references);
    if(typeof reverse!=='function')throw new Error('在线目录设计需要本地助手先识别布局；未切换分析来源');
    const capability=await cpu({surface:'ui-design',action:'capabilities'});
    if((capability?.data?.localCompletePlanner!=='native-catalog-v3'||capability?.data?.sourceContract!=='observed-rows-v2'))throw new Error('请更新 2.0.81 本地助手后使用完整在线目录设计；本次未调用付费分析');
    const sourceResult=await reverse({uiPlanner:'native-catalog-v3',surface:'ui-design',targetEngine:'qwen-2.1',uiDesignIntent:'redesign',uiPreserveLayout:true,uiAnalysisStage:'source-only',currentPrompt:request,images:references.map(r=>({dataUrl:r.dataUrl,role:r.role}))});
    checkActive();const source=sourceResult?.data||sourceResult;
    if(sourceResult?.ok===false||!source?.bundle||source.uiCatalog?.recognitionMethod!=='native-source-catalog-v3')throw new Error(sourceResult?.error||'在线分析的前置布局识别未完成；未提交云端分析或生图');
    const job=await callCpu({action:'native-ui-cloud',bundle:source.bundle,images:references.map(r=>({dataUrl:r.dataUrl,role:r.role}))});
    checkActive();
    const requestId=root.crypto?.randomUUID?.();if(!requestId)throw new Error('浏览器不能创建分析请求标识');
    const reply=await root.NovaFlowWebRuntime.auth('POST','/api/client/runninghub/ui-catalog',{...job,requestId},180000);
    checkActive();
    const model=typeof reply?.model==='string'?reply.model.trim():'';
    if(!reply?.ok||!model||reply.providerCallCount!==1||reply.retryCount!==0||reply.clientRequestId!==requestId||reply.finishReason!=='completed'||typeof reply.rawOutputText!=='string'||!reply.rawOutputText.trim())throw new Error(reply?.error||'在线目录分析未完成；未切换分析来源或提交生图');
    const compiled=await callCpu({action:'native-ui-compile',bundle:source.bundle,raw:reply.rawOutputText});
    checkActive();
    const layoutReference=references.findIndex(r=>r.role==='layout')+1;
    return {prompt:compiled.prompt,negativePrompt:'',uiCatalog:{...source.uiCatalog,recognitionMethod:'native-grok-catalog-v3',analysisProvider:'grok',layoutAnalysisProvider:'local',model:reply.model,providerCallCount:1,providerRequestId:reply.requestId,proof:compiled.proof},
      uiPlan:{version:1,layoutMode:'preserve',layoutReference,visualMode:'theme-redesign',references:references.map((r,i)=>({index:i+1,role:r.role==='layout'?'layout':r.role==='style'?'style':'content'})),layoutChanges:[],preserve:[],grids:[]}};
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
        if(typeof api.promptAssistantUiDesignCpu!=='function')throw new Error('请更新本地助手后使用完整UI设计，本次未调用其他分析模型');
        const capability=await api.promptAssistantUiDesignCpu({surface:'ui-design',action:'capabilities'});
        checkActive();
        if((capability?.data?.localCompletePlanner!=='native-catalog-v3'||capability?.data?.sourceContract!=='observed-rows-v2'))throw new Error('当前算力节点需要更新 2.0.81 本地助手后才能运行完整UI设计，本次未提交分析或生图');
      }
      const request = [stripTargetStyleContract(options.prompt), options.requirements || ''].filter(Boolean).join('\n')
      const result = engine==='grok' ? await withTimeout(()=>runGrokComplete(options,references,checkActive),options.timeoutMs||900000,engine) : await withTimeout(() => call({ uiPlanner:'native-catalog-v3', surface:'ui-design', targetEngine:'qwen-2.1',
        uiDesignIntent:'redesign', uiPreserveLayout:true, currentPrompt:request, uiStructure:structure,
        images:references.map(ref => ({ dataUrl:ref.dataUrl, role:ref.role, label:ref.label })) }), options.timeoutMs || 900000, engine)
      checkActive()
      if (typeof options.getRevision === 'function' && options.getRevision() !== revision) throw new Error('设计要求已变化，本次结果未覆盖当前内容')
      const data = result?.data || result
      if (result?.ok === false || !data?.prompt || data?.uiCatalog?.schema !== 'nf.ui.structure-catalog.v1') throw new Error(result?.error || '结构编译未返回有效结果，本次未提交生成')
      if (data.uiCatalog.recognitionMethod !== (engine==='grok'?'native-grok-catalog-v3':'native-source-catalog-v3')) throw new Error('算力节点的 UI 分析组件需要更新，请安装最新本地助手后重试；本次未提交生图')
      return Object.freeze({ ...data, provider, engine, targetStyle:'auto', purpose:'ui-design-reference', referenceCount:references.length,
        references, structure, scene, hasNegativePrompt:false, negativePrompt:'' })
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
      if (!sessionToken) throw new Error('请先登录 NovaFlow 账号')
      checkActive()
      const request = {
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
    prepareReferencesForEngine,
    protectText,
    restoreText,
    run,
    createSession,
  })
})
