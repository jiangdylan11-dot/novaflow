(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignQualityProfile = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const VERSION = '20260724-ui-design-quality-profile-3'
  const CONTENT_TYPES = Object.freeze([
    Object.freeze({ value: 'auto', label: '智能识别' }),
    Object.freeze({ value: 'game-ui', label: '精品游戏 UI' }),
    Object.freeze({ value: 'slot', label: '精品 Slot' }),
    Object.freeze({ value: 'web', label: '网页 / 落地页' }),
    Object.freeze({ value: 'marketing', label: '游戏美宣' }),
  ])
  const QUALITY_TENDENCIES = Object.freeze([
    Object.freeze({ value: 'commercial', label: '稳妥商业化' }),
    Object.freeze({ value: 'creative', label: '更有创意' }),
    Object.freeze({ value: 'restrained', label: '高级克制' }),
  ])
  const PURPOSES = Object.freeze({
    auto: Object.freeze([{ value: 'auto', label: '智能识别用途' }]),
    'game-ui': Object.freeze([
      { value: 'auto', label: '智能识别用途' }, { value: 'lobby', label: '大厅 / 主界面' },
      { value: 'shop', label: '商城 / 活动' }, { value: 'hud', label: '战斗 HUD' },
      { value: 'inventory', label: '角色 / 背包' }, { value: 'result', label: '结算 / 弹窗' },
    ].map(Object.freeze)),
    slot: Object.freeze([
      { value: 'auto', label: '智能识别用途' }, { value: 'base-game', label: '基础游戏主界面' },
      { value: 'bonus', label: 'Bonus / 免费旋转' }, { value: 'jackpot', label: '大奖 / Jackpot' },
      { value: 'lobby', label: 'Slot 游戏大厅' },
    ].map(Object.freeze)),
    web: Object.freeze([
      { value: 'auto', label: '智能识别用途' }, { value: 'landing', label: '品牌落地页' },
      { value: 'official', label: '游戏官网' }, { value: 'campaign', label: '活动专题页' },
      { value: 'dashboard', label: '后台 / 工具页面' },
    ].map(Object.freeze)),
    marketing: Object.freeze([
      { value: 'auto', label: '智能识别用途' }, { value: 'key-visual', label: '主视觉 KV' },
      { value: 'banner', label: '运营 Banner' }, { value: 'store', label: '商店宣传图' },
      { value: 'event', label: '活动宣传图' },
    ].map(Object.freeze)),
  })
  const PROFILE_CONTRACTS = Object.freeze({
    'game-ui': '质量基准：成熟头部商业游戏成品，不使用任何具体公司或游戏的商标、角色、专属构图与可识别资产。页面版块、内容类型、控件和重复项数量只能来自用户要求、页面结构和已声明职责的参考图，不自动补充角色主视觉、面板、按钮或图标模板。先保证参考约束下真实可执行的功能布局、清晰信息层级和操作路径，再提升既有视觉资产、字体气质、材质与光影的一致性。关键控件必须具有可辨识状态；装饰不得压过信息，不得把可用界面画成只有氛围的概念图。',
    slot: '质量基准：成熟精品全屏奖励符号游戏 UI 商业成品，不复制任何具体厂商的商标、角色、符号、专属构图或可识别视觉资产。界面载体必须由用户显式需求决定；未声明时默认输出目标画布内的原生全屏数字游戏界面，使画面边界与界面视口完全重合，并把全部功能组件整合在同一正视屏幕平面。页面版块、控件类型、内容分组、重复项数量和层级关系只能来自用户要求、页面结构和已声明职责的参考图；必须保留适用参考图中的位置、比例、分组与数量关系，不得自动套用固定的标题、角色、转轴、底栏或操作控件模板。优先保证目标视口与缩略显示下的功能分区、符号和关键数值清晰可辨。使用高对比、明确奖励感和精细材质，但避免廉价黄金堆砌、无意义强光、符号同质化和赌场网页模板感；Bonus、Wild、Scatter、Jackpot 等仅在页面结构、适用参考图职责或用户需求声明时表现。',
    web: '质量基准：成熟头部品牌数字产品成品，不复制任何具体公司的商标、网站、文案或设计系统。官网与落地页必须建立首屏主张、主视觉、行动按钮、内容节奏和转化路径；后台与工具页面必须优先导航、信息密度、表格表单和交互可读性。使用可靠网格、统一间距、真实组件状态和可实现的响应式关系，避免游戏概念海报化、模板拼贴感和只有装饰没有产品逻辑。',
    marketing: '质量基准：成熟头部游戏商业美宣成品，不复制任何具体公司的商标、角色、活动文案或专属构图。明确传播焦点和第一视觉落点，建立主体、利益点、标题安全区、品牌区和行动信息的阅读顺序；文字区域只预留可排版空间，不要求图像模型生成可靠正文。构图、角色姿态、环境、特效、色彩和光影必须共同服务传播主题，避免主体平均分散、背景抢戏、信息区不可用和只有壁纸感。',
  })

  function text(value) { return String(value == null ? '' : value).trim() }
  function normalizeContentType(value) {
    const normalized = text(value).toLowerCase().replace(/[\s_]+/g, '-')
    return CONTENT_TYPES.some((item) => item.value === normalized) ? normalized : 'auto'
  }
  function normalizeTendency(value) {
    const normalized = text(value).toLowerCase().replace(/[\s_]+/g, '-')
    return QUALITY_TENDENCIES.some((item) => item.value === normalized) ? normalized : 'commercial'
  }
  function purposesFor(value) { return PURPOSES[normalizeContentType(value)] || PURPOSES.auto }
  function normalizePurpose(contentType, value) {
    const normalized = text(value).toLowerCase().replace(/[\s_]+/g, '-')
    return purposesFor(contentType).some((item) => item.value === normalized) ? normalized : 'auto'
  }
  function inferContentType(structure, requirements) {
    const source = [
      structure?.name, structure?.description, requirements,
      ...(Array.isArray(structure?.regions) ? structure.regions.flatMap((item) => [item?.name, item?.purpose, item?.requirements]) : []),
    ].map(text).join(' ').toLowerCase()
    if (/(老虎机|slot|spin|reel|转轴|jackpot|bonus|wild|scatter)/i.test(source)) return 'slot'
    if (/(海报|美宣|banner|kv|主视觉|宣传图|商店图|运营图)/i.test(source)) return 'marketing'
    if (/(网页|网站|官网|落地页|dashboard|后台|专题页|web)/i.test(source)) return 'web'
    return 'game-ui'
  }
  function tendencyContract(value) {
    const tendency = normalizeTendency(value)
    if (tendency === 'creative') return '创意倾向：在不改变功能结构和可读性的前提下，允许更鲜明的主题化构图、视觉符号和材质组合，但必须保持商业可用。'
    if (tendency === 'restrained') return '创意倾向：高级克制，减少无意义装饰、过度发光和材质堆叠，以比例、留白、排版、细节和统一性体现完成度。'
    return '创意倾向：稳妥商业化，优先成熟、清晰、统一、容易被目标用户理解的方案，不为猎奇牺牲功能和转化目标。'
  }
  function compile(options = {}, structure = {}) {
    const requestedType = normalizeContentType(options.contentType)
    const contentType = requestedType === 'auto' ? inferContentType(structure, options.requirements) : requestedType
    const purpose = normalizePurpose(contentType, options.contentPurpose)
    const profile = CONTENT_TYPES.find((item) => item.value === contentType)
    const purposeProfile = purposesFor(contentType).find((item) => item.value === purpose)
    const checklist = [
      '美术导演检查：先确定页面唯一核心目标、第一视觉焦点、信息层级、版式骨架、色彩关系、材质体系、光影策略、组件状态、文字安全区和参考图职责，再组织最终设计要求。',
      '所有专业判断必须融合进一段可直接生成成品的描述，不输出分析过程、评分、清单标题或多个备选方案。',
      PROFILE_CONTRACTS[contentType],
      tendencyContract(options.qualityTendency),
    ]
    if (purpose !== 'auto') checklist.push(`明确用途：${purposeProfile?.label || purpose}。不得据此增加页面结构中未声明的功能。`)
    return Object.freeze({
      requestedType, contentType, contentTypeLabel: profile?.label || contentType,
      purpose, purposeLabel: purposeProfile?.label || '智能识别用途',
      qualityTendency: normalizeTendency(options.qualityTendency),
      instruction: checklist.filter(Boolean).join('\n'),
    })
  }

  return Object.freeze({
    VERSION, CONTENT_TYPES, QUALITY_TENDENCIES, PURPOSES,
    normalizeContentType, normalizePurpose, normalizeTendency, purposesFor, inferContentType, compile,
  })
})
