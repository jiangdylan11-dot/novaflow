(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignQualityReviewWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const VERSION = '20260729-ui-design-quality-review-workflow-5'
  const PURPOSE = 'ui-design-quality-review'
  const MAX_REFERENCE_IMAGES = 2
  const MAX_MANDATORY_CHECKLIST_ITEMS = 48
  const MAX_AUTO_RETRIES = 1
  const DEFAULT_TIMEOUT_MS = 300000
  const SCORE_GATE_MIN_CONFIDENCE = 0.55
  const PASS_MIN_CONFIDENCE = 0.45
  const POLISH_GATE_MIN_CONFIDENCE = 0.70
  const POLISH_DIMENSION_FLOOR = 45
  const POLISH_AVERAGE_FLOOR = 55
  const SCORE_FAILURE_THRESHOLDS = Object.freeze({
    themeAdherence: 55,
    structureAdherence: 60,
    referenceLeakage: 45,
    readability: 45,
  })
  const LEGACY_SCORE_KEYS = Object.freeze([
    'themeAdherence',
    'structureAdherence',
    'referenceLeakage',
    'readability',
    'commercialFinish',
  ])
  const POLISH_SCORE_KEYS = Object.freeze([
    'visualHierarchy',
    'materialCoherence',
    'lightingCoherence',
    'assetConsistency',
    'commercialCompleteness',
  ])
  const SCORE_KEYS = Object.freeze([...LEGACY_SCORE_KEYS, ...POLISH_SCORE_KEYS])
  const FAILURE_CLASSES = Object.freeze({
    STRUCTURE: 'STRUCTURE',
    CONTENT: 'CONTENT',
    POLISH: 'POLISH',
    READABILITY: 'READABILITY',
    LEAKAGE: 'LEAKAGE',
  })
  const FAILURE_CODES = Object.freeze({
    TARGET_CONTENT_MISMATCH: 'TARGET_CONTENT_MISMATCH',
    STRUCTURE_MISSING: 'STRUCTURE_MISSING',
    QUALITY_POLISH_INSUFFICIENT: 'QUALITY_POLISH_INSUFFICIENT',
    CORE_UI_UNREADABLE: 'CORE_UI_UNREADABLE',
    REFERENCE_CONTENT_LEAKAGE: 'REFERENCE_CONTENT_LEAKAGE',
    QUALITY_GATE_FAILED: 'QUALITY_GATE_FAILED',
  })
  const FAILURE_CODE_CLASSES = Object.freeze({
    [FAILURE_CODES.TARGET_CONTENT_MISMATCH]: FAILURE_CLASSES.CONTENT,
    [FAILURE_CODES.STRUCTURE_MISSING]: FAILURE_CLASSES.STRUCTURE,
    [FAILURE_CODES.QUALITY_POLISH_INSUFFICIENT]: FAILURE_CLASSES.POLISH,
    [FAILURE_CODES.CORE_UI_UNREADABLE]: FAILURE_CLASSES.READABILITY,
    [FAILURE_CODES.REFERENCE_CONTENT_LEAKAGE]: FAILURE_CLASSES.LEAKAGE,
    [FAILURE_CODES.QUALITY_GATE_FAILED]: FAILURE_CLASSES.CONTENT,
  })
  const FAILURE_CLASS_PRIORITY = Object.freeze([
    FAILURE_CLASSES.STRUCTURE,
    FAILURE_CLASSES.CONTENT,
    FAILURE_CLASSES.READABILITY,
    FAILURE_CLASSES.LEAKAGE,
    FAILURE_CLASSES.POLISH,
  ])
  const FAILURE_CODE_CORRECTIONS = Object.freeze({
    [FAILURE_CODES.TARGET_CONTENT_MISMATCH]: '严格恢复用户指定的主题、主体身份与必需内容，不得用通用角色或其他题材替代。',
    [FAILURE_CODES.STRUCTURE_MISSING]: '补齐用户要求的页面区域、数量关系、核心功能与操作控件，并保持清晰稳定的界面分组。',
    [FAILURE_CODES.QUALITY_POLISH_INSUFFICIENT]: '提高视觉层级、材质、光影、资产一致性与商业完成度，但不得改变正确内容和结构。',
    [FAILURE_CODES.CORE_UI_UNREADABLE]: '提高核心文字、数字、图标、符号与控件的清晰度、对比度和可辨识性。',
    [FAILURE_CODES.REFERENCE_CONTENT_LEAKAGE]: '移除所有不属于用户目标的参考图主体、标志、标题、背景、控件与版式；不得复述或替换成被移除内容的专名。',
    [FAILURE_CODES.QUALITY_GATE_FAILED]: '重新核对用户目标与页面结构，只修正未满足项并输出完整可交付的数字界面成品。',
  })
  const DEFAULT_RUBRIC = [
    '检查候选图是否忠实执行目标主题、主体身份和视觉风格。',
    '检查用户明确要求的页面区域、主要内容、核心功能与操作控件是否完整。',
    '用户明确声明的行数、列数、网格尺寸、重复项总数、符号清单、金额文案与控件名称属于硬约束；任一缺失、增减、错位、替换或无法辨认都必须判定为结构或内容失败。',
    '当用户要求的是页面、界面或全屏数字画布且没有明确要求实体设备时，候选图出现机柜、机身、手机框、系统状态栏、产品展示外壳、物理台面或硬件按钮，属于页面载体错误，必须判定为结构失败；仅当用户明确要求硬件、设备外观或产品样机时才允许这些实体载体。',
    '检查是否错误复制参考图中的人物、Logo、标题、背景、按钮、版式或其他未被要求的内容。',
    '检查页面结构图的矩形框、节点、连线、端口、编号、辅助线或编辑器痕迹是否被画进成品。',
    '检查核心文字、数字、图标、符号与控件在目标输出尺寸下是否清晰可读。',
    '检查视觉层级是否有明确焦点、稳定分组和合理的对比节奏。',
    '检查材质语言是否符合目标风格并在组件之间保持一致；扁平风格不应因缺少立体高光而被扣分。',
    '检查光影或明暗值阶是否方向一致、层次清楚并服务于信息分离，而不是追求固定的戏剧化效果。',
    '检查图标、符号、卡牌、插画等视觉资产在透视、比例、边缘、留白和渲染语言上是否统一。',
    '检查所要求的页面区域、状态、操作和边缘细节是否闭合，达到可交付的商业成品完整度。',
  ].join('\n')
  const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpe?g|webp);base64,/i

  function text(value) {
    return String(value == null ? '' : value).trim()
  }

  function clamp(value, minimum, maximum, fallback) {
    const number = Number(value)
    if (!Number.isFinite(number)) return fallback
    return Math.min(maximum, Math.max(minimum, number))
  }

  function normalizeStatus(value) {
    const status = text(value).toUpperCase()
    return status === 'PASS' || status === 'FAIL' || status === 'REVIEW' ? status : 'REVIEW'
  }

  function normalizeHardFailures(value) {
    const source = Array.isArray(value)
      ? value
      : text(value)
        ? text(value).split(/[\n；;]+/)
        : []
    return Object.freeze(source
      .map((item) => text(item).slice(0, 240))
      .filter(Boolean)
      .slice(0, 12))
  }

  function normalizeSemanticChecklistToken(value) {
    const token = text(value).toLowerCase()
    return /^[a-z0-9][a-z0-9-]{0,63}$/.test(token) ? token : ''
  }

  function normalizeExpectedRect(value) {
    const source = value && typeof value === 'object' ? value : {}
    const xNorm = Number(source.xNorm)
    const yNorm = Number(source.yNorm)
    const wNorm = Number(source.wNorm)
    const hNorm = Number(source.hNorm)
    if (
      ![xNorm, yNorm, wNorm, hNorm].every(Number.isFinite)
      || xNorm < 0
      || yNorm < 0
      || wNorm <= 0
      || hNorm <= 0
      || xNorm + wNorm > 1.0001
      || yNorm + hNorm > 1.0001
    ) return null
    const rounded = (number) => Math.round(number * 10000) / 10000
    return Object.freeze({
      xNorm: rounded(xNorm),
      yNorm: rounded(yNorm),
      wNorm: rounded(wNorm),
      hNorm: rounded(hNorm),
    })
  }

  function normalizeMandatoryChecklist(value) {
    if (Array.isArray(value) && value.some((item) => text(item?.checklistToken))) {
      const checklist = []
      value.slice(0, MAX_MANDATORY_CHECKLIST_ITEMS).forEach((item) => {
        const source = item && typeof item === 'object' ? item : {}
        const semanticToken = normalizeSemanticChecklistToken(source.semanticToken)
        const checklistToken = text(source.checklistToken)
        if (
          !semanticToken
          || !/^region-[1-9]\d{0,2}:[a-z0-9][a-z0-9-]{0,63}$/.test(checklistToken)
          || !checklistToken.endsWith(`:${semanticToken}`)
          || checklist.some((entry) => entry.checklistToken === checklistToken)
        ) return
        const expectedRect = normalizeExpectedRect(source.expectedRect)
        checklist.push(Object.freeze({
          checklistToken,
          regionId: text(source.regionId).slice(0, 120),
          kind: text(source.kind).toLowerCase().slice(0, 48),
          semanticToken,
          ...(expectedRect ? { expectedRect } : {}),
        }))
      })
      return Object.freeze(checklist)
    }
    const specifications = Array.isArray(value)
      ? value
      : (Array.isArray(value?.semanticScaffoldSpecifications)
          ? value.semanticScaffoldSpecifications
          : [])
    const checklist = []
    specifications.slice(0, 32).forEach((specification, regionIndex) => {
      const source = specification && typeof specification === 'object' ? specification : {}
      const regionId = text(source.regionId).slice(0, 120)
      const kind = text(source.kind).toLowerCase().slice(0, 48)
      const tokens = Array.isArray(source.tokens) ? source.tokens : []
      tokens.forEach((sourceToken) => {
        if (checklist.length >= MAX_MANDATORY_CHECKLIST_ITEMS) return
        const semanticToken = normalizeSemanticChecklistToken(sourceToken)
        if (!semanticToken) return
        const checklistToken = `region-${regionIndex + 1}:${semanticToken}`
        if (checklist.some((item) => item.checklistToken === checklistToken)) return
        const expectedRect = normalizeExpectedRect(source.expectedRects?.[semanticToken])
        checklist.push(Object.freeze({
          checklistToken,
          regionId,
          kind,
          semanticToken,
          ...(expectedRect ? { expectedRect } : {}),
        }))
      })
    })
    return Object.freeze(checklist)
  }

  function mandatoryChecklistFromOptions(options = {}) {
    const candidates = [
      options.layoutGuide,
      options.mandatoryChecklist,
      options.semanticScaffoldSpecifications,
      options.structure,
      options.semanticLayout,
    ]
    for (const candidate of candidates) {
      const checklist = normalizeMandatoryChecklist(candidate)
      if (checklist.length) return checklist
    }
    return Object.freeze([])
  }

  function normalizeFailedChecklistTokens(value, mandatoryChecklist = []) {
    const source = Array.isArray(value)
      ? value
      : text(value)
        ? text(value).split(/[\n,，；;]+/)
        : []
    const allowed = new Set(
      normalizeMandatoryChecklist(mandatoryChecklist).map((item) => item.checklistToken),
    )
    if (!allowed.size) return Object.freeze([])
    return Object.freeze([...new Set(source
      .map((item) => text(item))
      .filter((item) => allowed.has(item))
    )].slice(0, MAX_MANDATORY_CHECKLIST_ITEMS))
  }

  function normalizeScores(value) {
    const source = value && typeof value === 'object' ? value : {}
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(source, key)
    const commercialFallback = hasOwn('commercialFinish')
      ? clamp(source.commercialFinish, 0, 100, 0)
      : clamp(source.commercialCompleteness, 0, 100, 0)
    const fallbackByKey = {
      commercialFinish: commercialFallback,
      visualHierarchy: commercialFallback,
      materialCoherence: commercialFallback,
      lightingCoherence: commercialFallback,
      assetConsistency: commercialFallback,
      commercialCompleteness: commercialFallback,
    }
    return Object.freeze(Object.fromEntries(
      SCORE_KEYS.map((key) => [
        key,
        Math.round(clamp(
          hasOwn(key) ? source[key] : fallbackByKey[key],
          0,
          100,
          Math.round(fallbackByKey[key] || 0),
        )),
      ]),
    ))
  }

  function normalizeConfidence(value) {
    let confidence = clamp(value, 0, 100, 0)
    if (confidence > 1) confidence /= 100
    return Math.round(clamp(confidence, 0, 1, 0) * 1000) / 1000
  }

  function inferFailureCode(value) {
    const raw = text(value)
    const normalized = raw.toUpperCase().replace(/[\s-]+/g, '_')
    if (Object.values(FAILURE_CODES).includes(normalized)) return normalized
    if (/REFERENCE.*(?:LEAK|COPY)|参考图.*(?:照搬|泄漏)|照搬.*参考图/.test(normalized + raw)) {
      return FAILURE_CODES.REFERENCE_CONTENT_LEAKAGE
    }
    if (/STRUCTURE|LAYOUT|结构|区域|操作区|功能区/.test(normalized + raw)) {
      return FAILURE_CODES.STRUCTURE_MISSING
    }
    if (/READAB|UNREAD|不可读|文字.*模糊|核心\s*UI/.test(normalized + raw)) {
      return FAILURE_CODES.CORE_UI_UNREADABLE
    }
    if (/POLISH|FINISH|HIERARCH|MATERIAL|LIGHTING|CONSIST|完成度|层级|材质|光影|一致性/.test(normalized + raw)) {
      return FAILURE_CODES.QUALITY_POLISH_INSUFFICIENT
    }
    if (/THEME|SUBJECT|CONTENT|主题|主体|内容/.test(normalized + raw)) {
      return FAILURE_CODES.TARGET_CONTENT_MISMATCH
    }
    return FAILURE_CODES.QUALITY_GATE_FAILED
  }

  function normalizeFailureCodes(value, hardFailures = []) {
    const source = Array.isArray(value)
      ? value
      : text(value)
        ? text(value).split(/[\n,，；;]+/)
        : []
    return Object.freeze([...new Set(
      [...source, ...(Array.isArray(hardFailures) ? hardFailures : [])]
        .map(inferFailureCode)
        .filter(Boolean),
    )].slice(0, 12))
  }

  function failureClassForCodes(value) {
    const codes = Array.isArray(value) ? value : []
    const classes = new Set(codes.map((code) => FAILURE_CODE_CLASSES[code]).filter(Boolean))
    return FAILURE_CLASS_PRIORITY.find((failureClass) => classes.has(failureClass)) || ''
  }

  function polishAssessment(scores) {
    const values = POLISH_SCORE_KEYS.map((key) => Number(scores?.[key]) || 0)
    const lowDimensions = POLISH_SCORE_KEYS.filter((key) => Number(scores?.[key]) < POLISH_DIMENSION_FLOOR)
    const average = values.length
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
      : 0
    return Object.freeze({
      average,
      lowDimensions: Object.freeze(lowDimensions),
      objectiveFailure: average < POLISH_AVERAGE_FLOOR || lowDimensions.length >= 2,
    })
  }

  function normalizeQualityReview(value, options = {}) {
    const source = value && typeof value === 'object' ? value : {}
    const mandatoryChecklist = normalizeMandatoryChecklist(
      options.mandatoryChecklist
      || options.layoutGuide
      || options.semanticScaffoldSpecifications,
    )
    const failedChecklistTokens = normalizeFailedChecklistTokens(
      source.failedChecklistTokens,
      mandatoryChecklist,
    )
    const scores = normalizeScores(source.scores)
    const confidence = normalizeConfidence(source.confidence)
    const sourceHardFailures = [...normalizeHardFailures(source.hardFailures)]
    const sourceFailureCodes = [...normalizeFailureCodes(source.failureCodes, sourceHardFailures)]
    const suppressUncertainPolish = confidence < POLISH_GATE_MIN_CONFIDENCE
      && sourceFailureCodes.includes(FAILURE_CODES.QUALITY_POLISH_INSUFFICIENT)
    const hardFailures = suppressUncertainPolish
      ? sourceHardFailures.filter((item) => inferFailureCode(item) !== FAILURE_CODES.QUALITY_POLISH_INSUFFICIENT)
      : sourceHardFailures
    const failureCodes = suppressUncertainPolish
      ? sourceFailureCodes.filter((code) => code !== FAILURE_CODES.QUALITY_POLISH_INSUFFICIENT)
      : sourceFailureCodes
    const polish = polishAssessment(scores)
    let status = normalizeStatus(source.status)
    if (suppressUncertainPolish && status === 'FAIL' && !hardFailures.length && !failureCodes.length) {
      status = 'REVIEW'
    }
    function addFailure(code, detail) {
      if (!failureCodes.includes(code)) failureCodes.push(code)
      if (detail && !hardFailures.includes(detail)) hardFailures.push(detail)
    }
    if (failedChecklistTokens.length) {
      addFailure(
        FAILURE_CODES.STRUCTURE_MISSING,
        `必需语义检查项缺失或不符合要求：${failedChecklistTokens.join('、')}`.slice(0, 240),
      )
    }
    if (confidence >= SCORE_GATE_MIN_CONFIDENCE) {
      if (scores.themeAdherence < SCORE_FAILURE_THRESHOLDS.themeAdherence) {
        addFailure(FAILURE_CODES.TARGET_CONTENT_MISMATCH, '目标主题或指定主体明显不符合要求')
      }
      if (scores.structureAdherence < SCORE_FAILURE_THRESHOLDS.structureAdherence) {
        addFailure(FAILURE_CODES.STRUCTURE_MISSING, '必需页面结构或核心操作区明显缺失')
      }
      if (scores.referenceLeakage < SCORE_FAILURE_THRESHOLDS.referenceLeakage) {
        addFailure(FAILURE_CODES.REFERENCE_CONTENT_LEAKAGE, '候选成品错误照搬了原参考图内容')
      }
      if (scores.readability < SCORE_FAILURE_THRESHOLDS.readability) {
        addFailure(FAILURE_CODES.CORE_UI_UNREADABLE, '核心 UI 严重不可读')
      }
    }
    if (polish.objectiveFailure && confidence >= POLISH_GATE_MIN_CONFIDENCE) {
      addFailure(
        FAILURE_CODES.QUALITY_POLISH_INSUFFICIENT,
        '视觉层级、材质、光影、资产一致性或商业完整度的组合质量明显不足',
      )
    }
    if (hardFailures.length || failureCodes.length) status = 'FAIL'
    else if (
      status === 'PASS'
      && (confidence < PASS_MIN_CONFIDENCE || (polish.objectiveFailure && confidence < POLISH_GATE_MIN_CONFIDENCE))
    ) status = 'REVIEW'
    if (status === 'FAIL' && !failureCodes.length) {
      failureCodes.push(FAILURE_CODES.QUALITY_GATE_FAILED)
    }
    const normalizedFailures = status === 'FAIL' && !hardFailures.length
      ? Object.freeze(['QUALITY_GATE_FAILED'])
      : Object.freeze([...new Set(hardFailures)].slice(0, 12))
    const normalizedFailureCodes = status === 'FAIL'
      ? Object.freeze([...new Set(failureCodes)].slice(0, 12))
      : Object.freeze([])
    return Object.freeze({
      status,
      hardFailures: normalizedFailures,
      failureCodes: normalizedFailureCodes,
      failedChecklistTokens: status === 'FAIL' ? failedChecklistTokens : Object.freeze([]),
      failureClass: status === 'FAIL' ? failureClassForCodes(normalizedFailureCodes) : '',
      scores,
      summary: text(source.summary).slice(0, 800),
      retryPrompt: status === 'FAIL' ? text(source.retryPrompt).slice(0, 4000) : '',
      confidence,
      unavailable: false,
      reason: '',
    })
  }

  function unavailableReview(detail) {
    const reason = text(detail) || '本地质量审查服务不可用'
    return Object.freeze({
      status: 'REVIEW',
      hardFailures: Object.freeze([]),
      failureCodes: Object.freeze([]),
      failedChecklistTokens: Object.freeze([]),
      failureClass: '',
      scores: Object.freeze(Object.fromEntries(SCORE_KEYS.map((key) => [key, null]))),
      summary: `本地 UI 质量审查暂不可用：${reason}`.slice(0, 800),
      retryPrompt: '',
      confidence: 0,
      unavailable: true,
      reason: 'unavailable',
    })
  }

  function imageDataUrl(value) {
    if (typeof value === 'string') return text(value)
    if (!value || typeof value !== 'object') return ''
    return text(value.dataUrl || value.imageUrl || value.url || value.src)
  }

  function normalizeCandidate(value) {
    const dataUrl = imageDataUrl(value)
    if (!IMAGE_DATA_URL_PATTERN.test(dataUrl)) {
      throw new TypeError('candidate 必须是 PNG、JPEG 或 WebP 的 data URL')
    }
    const source = value && typeof value === 'object' ? value : {}
    return Object.freeze({
      name: text(source.name || source.fileName || source.filename) || 'ui-design-candidate.png',
      label: text(source.label || source.displayLabel) || '本次生成结果',
      role: 'candidate',
      slotType: 'candidate',
      dataUrl,
    })
  }

  function normalizeReference(value, index) {
    const dataUrl = imageDataUrl(value)
    if (!IMAGE_DATA_URL_PATTERN.test(dataUrl)) {
      throw new TypeError(`参考图${index + 1}必须是 PNG、JPEG 或 WebP 的 data URL`)
    }
    const source = value && typeof value === 'object' ? value : {}
    const role = text(source.role || source.slotType || source.referenceRole) || 'reference'
    return Object.freeze({
      name: text(source.name || source.fileName || source.filename) || `ui-design-reference-${index + 1}.png`,
      label: text(source.label || source.displayLabel) || `原参考图${index + 1}`,
      role,
      slotType: role,
      dataUrl,
    })
  }

  function normalizeReferences(values) {
    const source = Array.isArray(values) ? values : []
    if (source.length > MAX_REFERENCE_IMAGES) {
      throw new RangeError(`UI 质量审查最多接收 ${MAX_REFERENCE_IMAGES} 张原参考图`)
    }
    return Object.freeze(source.map(normalizeReference))
  }

  function compileRubric(value, additional = '') {
    const source = value && typeof value === 'object' ? value : {}
    const semantic = source.semantic && typeof source.semantic === 'object'
      ? source.semantic
      : source
    const regions = Array.isArray(semantic.regions)
      ? semantic.regions
      : (Array.isArray(semantic.blocks) ? semantic.blocks : [])
    const checklist = normalizeMandatoryChecklist(source)
    const regionLines = regions.slice(0, 32).map((region, index) => {
      const name = text(region?.name || region?.title || region?.label) || `区域${index + 1}`
      const detail = [
        text(region?.purpose || region?.description),
        text(region?.requirements || region?.requirement),
      ].filter(Boolean).join('；')
      return detail ? `${name}：${detail}` : name
    })
    const checklistLines = checklist.map((item) => (
      `${item.checklistToken}（区域：${item.regionId || '未命名'}；职责：${item.kind || 'ui'}）`
    ))
    return [
      text(additional),
      checklistLines.length
        ? `页面语义必检项（只供审查，稳定ID不得作为界面文案）：\n${checklistLines.join('\n')}`
        : '',
      regionLines.length ? `本次页面必需结构：\n${regionLines.join('\n')}` : '',
      DEFAULT_RUBRIC,
    ].filter(Boolean).join('\n').slice(0, 2000)
  }

  function retryIssueText(review) {
    const source = review && typeof review === 'object' ? review : {}
    const codes = normalizeFailureCodes(source.failureCodes, source.hardFailures)
    const effectiveCodes = codes.length
      ? codes
      : (normalizeStatus(source.status) === 'FAIL' ? [FAILURE_CODES.QUALITY_GATE_FAILED] : [])
    return effectiveCodes
      .map((code) => FAILURE_CODE_CORRECTIONS[code])
      .filter(Boolean)
      .join('；')
  }

  function buildActionableRetryPrompt(options = {}) {
    const targetPrompt = text(options.targetPrompt || options.currentPrompt || options.prompt)
    const rubric = text(options.rubric || options.requirements)
      || compileRubric(options.structure || options.semanticLayout)
    const issue = retryIssueText(options.review || options.qualityReview)
    return [
      '重新生成一张完整、可直接使用的游戏 UI 成品，不得输出海报、纯插画、人物合影、设备照片或概念图。',
      targetPrompt ? `用户原始目标（最高优先级，必须完整执行）：\n${targetPrompt}` : '',
      rubric ? `必须逐项落实的页面结构、核心控件与通用质量要求：\n${rubric}` : '',
      issue ? `上一次结果存在的问题：\n${issue}` : '',
      '先确保页面类型、用户要求的功能区域、主要内容和核心操作完整，再针对低分项修正层级、材质、光影、资产一致性、可读性或商业完整度。',
      '禁止使用任何按序号指代输入图像的表述；禁止复制原参考图的主题、人物、Logo、标题、背景或完整布局。',
    ].filter(Boolean).join('\n').slice(0, 4000)
  }

  function buildPayload(options = {}) {
    const candidate = normalizeCandidate(options.candidate || options.candidateDataUrl || options.dataUrl)
    const references = normalizeReferences(options.references || options.refs)
    const targetPrompt = text(options.targetPrompt || options.currentPrompt || options.prompt)
    if (!targetPrompt) throw new TypeError('targetPrompt 不能为空')
    const rubric = text(options.rubric || options.requirements)
      || compileRubric(options.structure || options.semanticLayout)
    const mandatoryChecklist = mandatoryChecklistFromOptions(options)
    return Object.freeze({
      prompt: targetPrompt,
      currentPrompt: targetPrompt,
      requirements: rubric.slice(0, 2000),
      purpose: PURPOSE,
      surface: 'ui-design',
      provider: 'local',
      mandatoryChecklist,
      mandatoryChecklistTokens: Object.freeze(
        mandatoryChecklist.map((item) => item.checklistToken),
      ),
      images: Object.freeze([candidate, ...references]),
    })
  }

  function findQualityReview(value) {
    const queue = [value]
    const visited = new Set()
    while (queue.length) {
      const current = queue.shift()
      if (!current || typeof current !== 'object' || visited.has(current)) continue
      visited.add(current)
      if (current.qualityReview && typeof current.qualityReview === 'object') return current.qualityReview
      for (const key of ['data', 'result', 'payload']) {
        if (current[key] && typeof current[key] === 'object') queue.push(current[key])
      }
    }
    return null
  }

  function withTimeout(task, timeoutMs) {
    const configured = Number(timeoutMs)
    const duration = Number.isFinite(configured) && configured > 0
      ? Math.max(1, configured)
      : DEFAULT_TIMEOUT_MS
    let timer = 0
    return new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('本地 UI 质量审查请求超时')), duration)
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => clearTimeout(timer))
    })
  }

  async function run(options = {}) {
    const payload = buildPayload(options)
    const api = options.electronAPI || root?.electronAPI || {}
    const call = api.promptAssistantReverseImagePrompt
    if (typeof call !== 'function') return unavailableReview('Prompt Assistant API 未就绪')
    try {
      const response = await withTimeout(() => call(payload), options.timeoutMs)
      if (response && response.ok === false) {
        return unavailableReview(text(response.error || response.message) || 'Prompt Assistant 请求失败')
      }
      const review = findQualityReview(response)
      if (!review) return unavailableReview('服务未返回 qualityReview')
      return normalizeQualityReview(review, {
        mandatoryChecklist: payload.mandatoryChecklist,
      })
    } catch (error) {
      return unavailableReview(error?.message || error)
    }
  }

  function shouldRetry(value, retryCount = 0) {
    const review = value?.qualityReview && typeof value.qualityReview === 'object'
      ? value.qualityReview
      : value
    const count = Math.max(0, Math.floor(Number(retryCount) || 0))
    return Boolean(
      count < MAX_AUTO_RETRIES
      && review
      && review.unavailable !== true
      && normalizeStatus(review.status) === 'FAIL'
      && Array.isArray(review.hardFailures)
      && review.hardFailures.length
      && text(buildActionableRetryPrompt({
        targetPrompt: 'required',
        review,
      })),
    )
  }

  return Object.freeze({
    VERSION,
    PURPOSE,
    MAX_REFERENCE_IMAGES,
    MAX_AUTO_RETRIES,
    DEFAULT_TIMEOUT_MS,
    SCORE_GATE_MIN_CONFIDENCE,
    PASS_MIN_CONFIDENCE,
    POLISH_GATE_MIN_CONFIDENCE,
    POLISH_DIMENSION_FLOOR,
    POLISH_AVERAGE_FLOOR,
    SCORE_FAILURE_THRESHOLDS,
    LEGACY_SCORE_KEYS,
    POLISH_SCORE_KEYS,
    SCORE_KEYS,
    FAILURE_CLASSES,
    FAILURE_CODES,
    FAILURE_CODE_CLASSES,
    FAILURE_CODE_CORRECTIONS,
    DEFAULT_RUBRIC,
    normalizeStatus,
    normalizeScores,
    normalizeSemanticChecklistToken,
    normalizeMandatoryChecklist,
    mandatoryChecklistFromOptions,
    normalizeFailedChecklistTokens,
    normalizeFailureCodes,
    failureClassForCodes,
    polishAssessment,
    normalizeQualityReview,
    unavailableReview,
    normalizeCandidate,
    normalizeReferences,
    compileRubric,
    buildActionableRetryPrompt,
    buildPayload,
    shouldRetry,
    run,
  })
})
