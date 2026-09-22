(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignLocalDirectorWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const VERSION = '20260724-ui-design-local-director-7'
  const MAX_CACHE_ENTRIES = 12
  const REFERENCE_CONTENT_GROUP_LIMIT = 24
  const cache = new Map()
  const STYLE_PROFILE_FIELDS = Object.freeze([
    Object.freeze({
      key: 'palette',
      label: '配色',
      sourceKeys: Object.freeze(['palette', 'colorPalette', 'colors']),
      aliases: Object.freeze(['配色', '色彩体系', '色彩关系', '主色调', '色盘', 'palette', 'color palette']),
    }),
    Object.freeze({
      key: 'contrast',
      label: '对比',
      sourceKeys: Object.freeze(['contrast', 'valueContrast', 'contrastHierarchy']),
      aliases: Object.freeze(['对比', '对比关系', '明暗对比', '层级对比', 'contrast']),
    }),
    Object.freeze({
      key: 'material',
      label: '材质',
      sourceKeys: Object.freeze(['material', 'materials', 'texture']),
      aliases: Object.freeze(['材质', '材质体系', '表面质感', 'texture', 'material']),
    }),
    Object.freeze({
      key: 'lighting',
      label: '光影',
      sourceKeys: Object.freeze(['lighting', 'light', 'illumination']),
      aliases: Object.freeze(['光影', '灯光', '照明', 'lighting', 'light']),
    }),
    Object.freeze({
      key: 'shapeLanguage',
      label: '形状语言',
      sourceKeys: Object.freeze(['shapeLanguage', 'shape', 'lineLanguage', 'graphicLanguage']),
      aliases: Object.freeze(['形状语言', '造型语言', '图形语言', '线条语言', 'shape language']),
    }),
    Object.freeze({
      key: 'ornamentDensity',
      label: '装饰密度',
      sourceKeys: Object.freeze(['ornamentDensity', 'ornament', 'decorationDensity']),
      aliases: Object.freeze(['装饰密度', '装饰语言', '纹样密度', 'ornament density']),
    }),
    Object.freeze({
      key: 'typographyMood',
      label: '字体气质',
      sourceKeys: Object.freeze(['typographyMood', 'typography', 'typeMood']),
      aliases: Object.freeze(['字体气质', '字形气质', '排版气质', 'typography mood', 'typography']),
    }),
    Object.freeze({
      key: 'finish',
      label: '渲染完成度',
      sourceKeys: Object.freeze(['finish', 'renderFinish', 'commercialFinish']),
      aliases: Object.freeze(['渲染完成度', '商业完成度', '画面完成度', 'render finish', 'finish']),
    }),
  ])
  const STYLE_PROFILE_REQUIREMENT = [
    'styleProfile必须严格使用安全枚举和十六进制色值，不得输出自由文本；不得写入主题、人物、物体、界面功能、布局、文字或Logo。',
    'contentIdentityLock只能使用用户目标中真实出现的原文短语，不得从参考图提取或推测内容。',
  ].join('')
  const SAFE_STYLE_ENUMS = Object.freeze({
    contrast: Object.freeze({
      low: '低对比',
      medium: '中等对比',
      high: '高对比',
      'focal-emphasis': '焦点高对比',
      'layered-values': '分层明暗对比',
    }),
    material: Object.freeze({
      matte: '哑光表面',
      glossy: '亮面表面',
      'polished-metal': '抛光金属',
      'gilded-metal': '鎏金金属',
      stone: '石材',
      'jade-like': '玉石质感',
      glass: '玻璃',
      ceramic: '陶瓷',
      wood: '木材',
      'woven-fabric': '织物',
      paper: '纸张',
      leather: '皮革',
      translucent: '半透明材质',
      emissive: '自发光材质',
      painted: '绘制表面',
    }),
    lighting: Object.freeze({
      flat: '均匀平光',
      'soft-diffuse': '柔和漫射光',
      directional: '方向性主光',
      'rim-accent': '克制轮廓光',
      backlit: '逆光',
      volumetric: '体积光',
      ambient: '环境光',
      dramatic: '戏剧化明暗',
      'high-key': '高调光影',
      'low-key': '低调光影',
      'glow-accent': '局部辉光强调',
    }),
    shapeLanguage: Object.freeze({
      geometric: '几何形',
      organic: '有机形',
      rounded: '圆润轮廓',
      angular: '锐角轮廓',
      symmetrical: '对称秩序',
      asymmetrical: '非对称秩序',
      'thin-line': '细线条',
      'bold-line': '粗线条',
      layered: '分层块面',
      minimal: '极简形状',
      ornate: '精细装饰形',
    }),
    ornamentDensity: Object.freeze({
      none: '无装饰',
      low: '低装饰密度',
      restrained: '克制装饰',
      medium: '中等装饰密度',
      high: '高装饰密度',
      'focal-only': '仅焦点装饰',
      'border-focused': '边缘装饰',
      'surface-patterned': '表面纹样',
    }),
    typographyMood: Object.freeze({
      modern: '现代字形气质',
      classical: '古典字形气质',
      formal: '正式字形气质',
      playful: '活泼字形气质',
      technical: '技术感字形气质',
      luxury: '高贵字形气质',
      'bold-display': '粗重展示字',
      compact: '紧凑排版',
      'high-legibility': '高可读性',
    }),
    finish: Object.freeze({
      'flat-vector': '精致扁平矢量完成度',
      'painted-2d': '精绘二维完成度',
      'stylized-3d': '风格化三维完成度',
      'realistic-3d': '写实三维完成度',
      'commercial-game-ui': '商业游戏界面完成度',
      cinematic: '电影感完成度',
      illustrative: '插画式完成度',
      'high-detail': '高细节完成度',
      clean: '干净利落的完成度',
      premium: '高级商业完成度',
    }),
  })
  const CONTENT_LOCK_LIST_LIMIT = 24
  const CONTENT_LOCK_NON_VISUAL_PATTERNS = Object.freeze([
    /(?:手机端|移动端|小屏幕|大屏幕|平板端|桌面端|网页端|目标视口|mobile|small[\s-]*screen|viewport)[^。；;，,\n]{0,32}(?:清晰可读|易读|可读性|可辨识|辨识度|适配|响应式|readab|legib)/i,
    /(?:清晰可读|易读|可读性|可辨识|辨识度|readab|legib)[^。；;，,\n]{0,24}(?:手机端|移动端|小屏幕|大屏幕|平板端|桌面端|网页端|目标视口|mobile|small[\s-]*screen|viewport)/i,
    /^(?:适配)?(?:竖屏|横屏|纵向|横向|portrait|landscape)(?:画布|构图|比例|输出)?(?:\s*[0-9０-９]+\s*[xX×*]\s*[0-9０-９]+)?$/i,
    /(?:输出|生成|成图|图片|画布|交付|目标)?\s*(?:尺寸|分辨率|宽高比|纵横比|像素规格|规格参数|aspect[\s-]*ratio|resolution)/i,
    /(?:整体|画面|界面)?\s*(?:高|强|低)?对比(?:度)?[^。；;，,\n]{0,20}(?:精致|高级|细腻|材质|质感|效果)/i,
    /(?:整体|画面|界面)?\s*(?:精致|高级|细腻)[^。；;，,\n]{0,16}(?:材质|质感|效果)/i,
    /(?:成熟|高级|高质量|精品|精致)?\s*(?:商业|商用|游戏)?\s*(?:成品|完成度|品质|质量|交付质量|commercial[\s-]*finish)/i,
  ])

  function text(value) {
    return String(value == null ? '' : value).trim()
  }

  function normalizedIntent(value) {
    return text(value).toLowerCase() === 'iteration' ? 'iteration' : 'redesign'
  }

  function normalizedReferenceRole(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
      ? value.role
      : value
    return text(source).toLowerCase().replace(/[\s-]+/g, '_') || 'reference'
  }

  function styleProfileReferences(value) {
    const styleRoles = new Set(['style', 'material', 'color', 'reference'])
    return (Array.isArray(value) ? value : [])
      .filter(Boolean)
      .filter((reference) => styleRoles.has(normalizedReferenceRole(reference)))
  }

  function compactFingerprint(value) {
    const source = String(value == null ? '' : value)
    let hash = 2166136261
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return `${source.length}:${(hash >>> 0).toString(16)}`
  }

  function semanticAnchors(value) {
    const source = stripLargeOutputDimensionPairs(value)
    const anchors = []
    const append = (candidate) => {
      const normalized = text(candidate).toLowerCase().replace(/\s+/g, '')
      if (normalized.length >= 2 && !anchors.includes(normalized)) anchors.push(normalized)
    }
    for (const match of source.matchAll(/[0-9０-９]+\s*[xX×*]\s*[0-9０-９]+/g)) append(match[0])
    for (const match of source.matchAll(/\b[A-Z][A-Z0-9_-]{2,}\b/g)) append(match[0])
    for (const match of source.matchAll(/([\u4e00-\u9fff]{2,8})主题/g)) append(match[1].slice(-2))
    return Object.freeze(anchors)
  }

  function preservesSemanticAnchors(sourcePrompt, directedPrompt) {
    const anchors = semanticAnchors(sourcePrompt)
    if (!anchors.length) return false
    const candidate = text(directedPrompt).toLowerCase().replace(/\s+/g, '')
    return anchors.every((anchor) => candidate.includes(anchor))
  }

  function emptyStyleProfile() {
    return Object.freeze(Object.fromEntries(STYLE_PROFILE_FIELDS.map((field) => [field.key, ''])))
  }

  function emptyContentLock(prompt = '') {
    return Object.freeze({
      schemaVersion: 1,
      source: 'user-prompt',
      sourceFingerprint: compactFingerprint(prompt),
      identityAnchors: Object.freeze([]),
      requiredElements: Object.freeze([]),
      exactTokens: Object.freeze([]),
      forbidSubstitution: true,
    })
  }

  function contentLockItem(value) {
    return text(
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value.text || value.value || value.label)
        : value,
    )
      .replace(/^[\s\-*•]+|[\s\-*•]+$/g, '')
      .replace(/^(?:(?:顶部|底部|中部|左侧|右侧|页脚|顶栏|底栏|主内容)(?:UI)?(?:区域|栏|面板)?\s*)?(?:保留|包含|显示|放置|提供|需要|必须有)\s*/i, '')
      .slice(0, 160)
  }

  function comparableContent(value) {
    return text(value).toLowerCase().replace(/[\s，,。；;：:、"'“”‘’（）()[\]{}<>《》\-_/]+/g, '')
  }

  function contentLockDimensionIsOutputSpec(value) {
    const numbers = text(value)
      .match(/[0-9０-９]+/g)
      ?.map((item) => Number(item.replace(/[０-９]/g, (digit) => String('０１２３４５６７８９'.indexOf(digit))))) || []
    return numbers.length >= 2 && numbers.some((number) => Number.isFinite(number) && number > 64)
  }

  function stripLargeOutputDimensionPairs(value) {
    return text(value)
      .replace(/[0-9０-９]+\s*[xX×*]\s*[0-9０-９]+/g, (match) => (
        contentLockDimensionIsOutputSpec(match) ? ' ' : match
      ))
      .replace(/\s+/g, ' ')
      .trim()
  }

  function explicitlyRequestsVisibleDevice(prompt, candidate) {
    const item = text(candidate)
    if (!/(?:手机商品|手机产品|手机实物|一部手机|实体手机|手机机身|设备本体|实体设备|实体机柜|台式机柜|街机机柜|一台(?:手机|设备|机柜|机器)|phone product|physical device)/i.test(item)) {
      return false
    }
    const source = text(prompt)
    if (!source) return true
    return source.split(/[。；;！？!?\n]+/).some((clause) => (
      comparableContent(clause).includes(comparableContent(item))
      && /(?:展示|呈现|显示|绘制|画面中|主体(?:为|是)|商品|产品|实物|道具|本体|实体|show|display|depict)/i.test(clause)
    ))
  }

  function isContentLockCandidate(candidate, prompt = '') {
    const item = contentLockItem(candidate)
    if (!item) return false
    if (explicitlyRequestsVisibleDevice(prompt, item)) return true
    if (CONTENT_LOCK_NON_VISUAL_PATTERNS.some((pattern) => pattern.test(item))) return false
    if (/[0-9０-９]+\s*[xX×*]\s*[0-9０-９]+/.test(item) && contentLockDimensionIsOutputSpec(item)) return false
    return true
  }

  function promptHasPositiveMention(prompt, candidate) {
    const source = text(prompt)
    const needle = text(candidate)
    if (!source || !needle) return true
    const lowerSource = source.toLowerCase()
    const lowerNeedle = needle.toLowerCase()
    let offset = 0
    let foundExact = false
    while (offset < lowerSource.length) {
      const index = lowerSource.indexOf(lowerNeedle, offset)
      if (index < 0) break
      foundExact = true
      const clauseStart = Math.max(
        lowerSource.lastIndexOf('。', index - 1),
        lowerSource.lastIndexOf('；', index - 1),
        lowerSource.lastIndexOf(';', index - 1),
        lowerSource.lastIndexOf('！', index - 1),
        lowerSource.lastIndexOf('!', index - 1),
        lowerSource.lastIndexOf('？', index - 1),
        lowerSource.lastIndexOf('?', index - 1),
        lowerSource.lastIndexOf('\n', index - 1),
      ) + 1
      const prefix = source.slice(clauseStart, index)
      const positiveReset = Math.max(
        prefix.lastIndexOf('而是'),
        prefix.lastIndexOf('但要'),
        prefix.lastIndexOf('但需'),
        prefix.lastIndexOf('仅保留'),
      )
      const activePrefix = positiveReset >= 0 ? prefix.slice(positiveReset + 2) : prefix
      if (!/(?:不(?:要|得|应|可|再)?|禁止|避免|去除|删除|移除|排除|拒绝|无需|非|never|without|exclude|avoid|remove|forbid|do not|don't)[^。；;！？!?\n]{0,64}$/i.test(activePrefix)) {
        return true
      }
      offset = index + Math.max(1, lowerNeedle.length)
    }
    if (foundExact) return false
    const comparableNeedle = comparableContent(needle)
    return source.split(/[。；;！？!?\n]+/).some((clause) => {
      if (!comparableContent(clause).includes(comparableNeedle)) return false
      return !/(?:不(?:要|得|应|可|再)?|禁止|避免|去除|删除|移除|排除|拒绝|无需|非|never|without|exclude|avoid|remove|forbid|do not|don't)/i.test(clause)
    })
  }

  function contentLockList(value, prompt = '') {
    const values = Array.isArray(value)
      ? value
      : (text(value) ? String(value).split(/[；;，,\n]+/) : [])
    const normalized = []
    const comparablePrompt = comparableContent(prompt)
    values.forEach((item) => {
      const candidate = contentLockItem(item)
      const anchored = !comparablePrompt
        || (
          comparablePrompt.includes(comparableContent(candidate))
          && promptHasPositiveMention(prompt, candidate)
        )
      if (
        candidate
        && anchored
        && isContentLockCandidate(candidate, prompt)
        && !normalized.includes(candidate)
        && normalized.length < CONTENT_LOCK_LIST_LIMIT
      ) {
        normalized.push(candidate)
      }
    })
    return Object.freeze(normalized)
  }

  function semanticallyContains(container, contained) {
    const outer = comparableContent(container)
    const inner = comparableContent(contained)
    return Boolean(outer && inner && outer.includes(inner))
  }

  function collapseSemanticDuplicates(value, limit = CONTENT_LOCK_LIST_LIMIT, preferSpecific = true) {
    const output = []
    const values = Array.isArray(value) ? value : []
    values.forEach((item) => {
      const candidate = contentLockItem(item)
      const comparableCandidate = comparableContent(candidate)
      if (!candidate || !comparableCandidate) return
      const exactIndex = output.findIndex((existing) => comparableContent(existing) === comparableCandidate)
      if (exactIndex >= 0) return
      if (!preferSpecific) {
        if (output.length < limit) output.push(candidate)
        return
      }
      const containingIndex = output.findIndex((existing) => semanticallyContains(existing, candidate))
      if (containingIndex >= 0) return
      const containedIndices = []
      output.forEach((existing, index) => {
        if (semanticallyContains(candidate, existing)) containedIndices.push(index)
      })
      if (containedIndices.length) {
        output[containedIndices[0]] = candidate
        for (let index = containedIndices.length - 1; index >= 1; index -= 1) {
          output.splice(containedIndices[index], 1)
        }
        return
      }
      if (output.length < limit) output.push(candidate)
    })
    return Object.freeze(output)
  }

  function jsonObject(value) {
    const source = typeof value === 'string'
      ? text(value)
      : text(value?.prompt || value?.rawOutput || value?.output)
    const start = source.indexOf('{')
    const end = source.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      const parsed = JSON.parse(source.slice(start, end + 1))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  function normalizeContentLock(value, prompt = '') {
    const parsed = jsonObject(value)
    const source = value && typeof value === 'object' && !Array.isArray(value)
      ? (
          value.contentIdentityLock
          || value.contentLock
          || parsed?.contentIdentityLock
          || parsed?.contentLock
          || value
        )
      : (parsed?.contentIdentityLock || parsed?.contentLock || {})
    return Object.freeze({
      schemaVersion: 1,
      source: 'user-prompt',
      sourceFingerprint: compactFingerprint(prompt),
      identityAnchors: collapseSemanticDuplicates(contentLockList(
        source?.identityAnchors || source?.subjects || source?.identity,
        prompt,
      ), 6),
      requiredElements: collapseSemanticDuplicates(contentLockList(
        source?.requiredElements || source?.mustInclude || source?.requiredControls,
        prompt,
      )),
      exactTokens: collapseSemanticDuplicates(
        contentLockList(source?.exactTokens || source?.labels, prompt),
        12,
        false,
      ),
      forbidSubstitution: true,
    })
  }

  function appendContentLockValue(list, value, limit = CONTENT_LOCK_LIST_LIMIT, prompt = '') {
    const candidate = contentLockItem(value)
    if (
      candidate
      && isContentLockCandidate(candidate, prompt)
      && !list.includes(candidate)
      && list.length < limit
    ) {
      list.push(candidate)
    }
  }

  function localContentLockFallback(prompt) {
    const source = stripLargeOutputDimensionPairs(prompt)
    const identityAnchors = []
    const requiredElements = []
    const exactTokens = []

    for (const match of source.matchAll(/([\u4e00-\u9fffA-Za-z0-9·_-]{2,20}主题)/g)) {
      const candidate = match[1].replace(/^(?:请|重新设计一个?|设计一个?|创建一个?|生成一个?)/, '')
      if (promptHasPositiveMention(source, candidate)) appendContentLockValue(identityAnchors, candidate, 6, source)
    }
    for (const match of source.matchAll(/(?:主体为|角色为|人物为|主角为|呈现)([\u4e00-\u9fffA-Za-z0-9·_-]{2,16}?)(?=手持|身穿|站立|坐|位于|的|，|,|。|；|;)/g)) {
      appendContentLockValue(identityAnchors, match[1], 6, source)
    }
    for (const match of source.matchAll(/([\u4e00-\u9fffA-Za-z0-9·_-]{2,20}(?:界面|页面|面板))/gi)) {
      const candidate = match[1].replace(/^(?:请|重新设计一个?|设计一个?|创建一个?|生成一个?)/, '')
      if (promptHasPositiveMention(source, candidate)) appendContentLockValue(identityAnchors, candidate, 6, source)
    }
    for (const match of source.matchAll(/[0-9０-９]+\s*[xX×*]\s*[0-9０-９]+[\u4e00-\u9fffA-Za-z0-9·_-]{0,16}/g)) {
      const numbers = match[0].match(/[0-9０-９]+/g) || []
      const asciiNumbers = numbers.map((item) => Number(item.replace(/[０-９]/g, (digit) => String('０１２３４５６７８９'.indexOf(digit)))))
      const hasSemanticSuffix = /[\u4e00-\u9fffA-Za-z]/.test(match[0].replace(/[xX×*]/g, ''))
      if (hasSemanticSuffix || asciiNumbers.every((value) => Number.isFinite(value) && value <= 64)) {
        appendContentLockValue(requiredElements, match[0], CONTENT_LOCK_LIST_LIMIT, source)
      }
    }
    for (const match of source.matchAll(/(?:包括|包含|显示|保留|必须有|必须包含|呈现)([^。；;\n]{2,140})/g)) {
      match[1].split(/(?:[、，,|｜/]+|以及|与|和|及)/).forEach((item) => (
        appendContentLockValue(requiredElements, item, CONTENT_LOCK_LIST_LIMIT, source)
      ))
    }
    for (const match of source.matchAll(/\b(?:[A-Z]{2,}|[A-Z][a-z][A-Za-z0-9_-]{1,15})\b/g)) {
      const prefix = source.slice(Math.max(0, match.index - 24), match.index)
      if (!['UI', 'LOGO'].includes(match[0].toUpperCase())
        && !/(?:不|禁止|避免|不得|无需|去除|删除)[^。；;\n]*$/i.test(prefix)) {
        appendContentLockValue(exactTokens, match[0], CONTENT_LOCK_LIST_LIMIT, source)
      }
    }
    for (const match of source.matchAll(/(?:符号(?:包括|包含|为|如)|symbols?\s*(?:include|including|are))([^。；;\n]{2,180})/gi)) {
      match[1]
        .split(/(?:[、，,|｜/]+|以及|与|和|及)/)
        .map(text)
        .forEach((item) => {
          const token = item
            .replace(/^字母/i, '')
            .replace(/(?:标志|符号|图标)$/i, '')
            .trim()
          if (/^(?:wild|scatter|bonus|[AKQJ]|10)$/i.test(token)) {
            appendContentLockValue(exactTokens, token.toUpperCase(), CONTENT_LOCK_LIST_LIMIT, source)
          }
        })
    }
    return Object.freeze({
      schemaVersion: 1,
      source: 'user-prompt',
      sourceFingerprint: compactFingerprint(source),
      identityAnchors: collapseSemanticDuplicates(identityAnchors, 6),
      requiredElements: collapseSemanticDuplicates(requiredElements),
      exactTokens: collapseSemanticDuplicates(exactTokens, 12, false),
      forbidSubstitution: true,
    })
  }

  function mergeContentLocks(prompt, ...values) {
    const semanticPrompt = stripLargeOutputDimensionPairs(prompt)
    const fallback = localContentLockFallback(semanticPrompt)
    const identityAnchors = [...fallback.identityAnchors]
    const requiredElements = [...fallback.requiredElements]
    const exactTokens = [...fallback.exactTokens]
    values.forEach((value) => {
      const lock = normalizeContentLock(value, semanticPrompt)
      lock.identityAnchors.forEach((item) => appendContentLockValue(identityAnchors, item, 6, semanticPrompt))
      lock.requiredElements.forEach((item) => appendContentLockValue(requiredElements, item, CONTENT_LOCK_LIST_LIMIT, semanticPrompt))
      lock.exactTokens.forEach((item) => appendContentLockValue(exactTokens, item, 12, semanticPrompt))
    })
    return Object.freeze({
      schemaVersion: 1,
      source: 'user-prompt',
      sourceFingerprint: compactFingerprint(prompt),
      identityAnchors: collapseSemanticDuplicates(identityAnchors, 6),
      requiredElements: collapseSemanticDuplicates(requiredElements),
      exactTokens: collapseSemanticDuplicates(exactTokens, 12, false),
      forbidSubstitution: true,
    })
  }

  function hasContentLock(value) {
    const lock = normalizeContentLock(value)
    return Boolean(lock.identityAnchors.length || lock.requiredElements.length || lock.exactTokens.length)
  }

  function contentLockPromptFromContract(value) {
    const lock = normalizeContentLock(value)
    const exactTokensCoveredAbove = new Set()
    const markCoveredExactTokens = (item) => {
      lock.exactTokens.forEach((token) => {
        if (semanticallyContains(item, token)) exactTokensCoveredAbove.add(comparableContent(token))
      })
      return item
    }
    const identityAnchors = lock.identityAnchors.map(markCoveredExactTokens)
    const requiredElements = lock.requiredElements.map(markCoveredExactTokens)
    const remainingExactTokens = lock.exactTokens.filter(
      (token) => !exactTokensCoveredAbove.has(comparableContent(token)),
    )
    const parts = [
      identityAnchors.length ? `Exact subject, theme and page identity: ${identityAnchors.join('; ')}` : '',
      requiredElements.length ? `Required visible elements and counts: ${requiredElements.join('; ')}` : '',
      remainingExactTokens.length ? `Required exact control or symbol tokens not already named above: ${remainingExactTokens.join('; ')}` : '',
    ].filter(Boolean)
    return parts.length
      ? `Dynamic content identity lock derived only from the user's target. Treat it literally and visibly: ${parts.join('. ')}. A repeated phrase across the user request, region declarations and this lock is one semantic requirement, never permission to create another copy. Preserve any exact token already embedded in a required element verbatim. Do not replace these with reference-image subjects, model-default archetypes or another theme, and never typeset this control instruction as UI copy.`
      : ''
  }

  function fullWidthNumber(value) {
    return Number(String(value || '').replace(/[０-９]/g, (digit) => String('０１２３４５６７８９'.indexOf(digit))))
  }

  function matrixCountFromText(value) {
    const source = text(value)
    for (const match of source.matchAll(/([0-9０-９]{1,3})\s*[xX×*]\s*([0-9０-９]{1,3})/g)) {
      const columns = fullWidthNumber(match[1])
      const rows = fullWidthNumber(match[2])
      if (
        Number.isInteger(columns)
        && Number.isInteger(rows)
        && columns > 0
        && rows > 0
        && columns <= 64
        && rows <= 64
      ) {
        return Object.freeze({
          columns,
          rows,
          total: columns * rows,
        })
      }
    }
    if (/(?:老虎机|数字转轴|转轴|reels?|slot(?:\s+machine)?|symbol\s+grid|符号网格)/i.test(source)) {
      const columnMatch = source.match(/([0-9０-９]{1,3})\s*(?:列|columns?)/i)
      const rowMatch = source.match(/([0-9０-９]{1,3})\s*(?:行|rows?)/i)
      const columns = columnMatch ? fullWidthNumber(columnMatch[1]) : 0
      const rows = rowMatch ? fullWidthNumber(rowMatch[1]) : 0
      if (Number.isInteger(columns) && columns > 0 && columns <= 64) {
        return Object.freeze({
          columns,
          rows: Number.isInteger(rows) && rows > 0 && rows <= 64 ? rows : 0,
          total: Number.isInteger(rows) && rows > 0 && rows <= 64 ? columns * rows : 0,
          columnsOnly: !(Number.isInteger(rows) && rows > 0 && rows <= 64),
        })
      }
      if (Number.isInteger(rows) && rows > 0 && rows <= 64) {
        return Object.freeze({
          columns: 0,
          rows,
          total: 0,
          rowsOnly: true,
        })
      }
    }
    return null
  }

  function explicitCountsFromText(value) {
    const source = text(value)
    const counts = []
    const append = (countValue, unitValue) => {
      const count = fullWidthNumber(countValue)
      const unit = text(unitValue).toLowerCase()
      if (!Number.isInteger(count) || count < 0 || count > 4096 || !unit) return
      const key = `${count}:${unit}`
      if (!counts.some((item) => item.key === key)) counts.push({ key, count, unit })
    }
    for (const match of source.matchAll(/([0-9０-９]{1,4})\s*(个(?:按钮|控件|符号|图标|卡牌|人物|角色|主体)?|项|格|行|列|枚|张|组)/g)) {
      append(match[1], match[2])
    }
    for (const match of source.matchAll(/\b([0-9]{1,4})\s*(buttons?|controls?|symbols?|icons?|cards?|items?|cells?|rows?|columns?|groups?)\b/gi)) {
      append(match[1], match[2])
    }
    return Object.freeze(counts.map(({ count, unit }) => Object.freeze({ count, unit })))
  }

  function referenceStructureRegions(structure) {
    if (Array.isArray(structure?.regions)) return structure.regions
    if (Array.isArray(structure?.blocks)) return structure.blocks
    return []
  }

  function finiteNumber(value) {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function normalizedRegionGeometry(region, structure) {
    const xNorm = finiteNumber(region?.xNorm)
    const yNorm = finiteNumber(region?.yNorm)
    const wNorm = finiteNumber(region?.wNorm)
    const hNorm = finiteNumber(region?.hNorm)
    if (
      [xNorm, yNorm, wNorm, hNorm].every((number) => number != null)
      && wNorm > 0
      && hNorm > 0
    ) {
      return Object.freeze({
        x: Math.max(0, Math.min(1, xNorm)),
        y: Math.max(0, Math.min(1, yNorm)),
        width: Math.max(0, Math.min(1, wNorm)),
        height: Math.max(0, Math.min(1, hNorm)),
      })
    }
    const canvasWidth = finiteNumber(structure?.canvas?.width ?? structure?.width)
    const canvasHeight = finiteNumber(structure?.canvas?.height ?? structure?.height)
    const x = finiteNumber(region?.x)
    const y = finiteNumber(region?.y)
    const width = finiteNumber(region?.width)
    const height = finiteNumber(region?.height)
    if (
      !canvasWidth
      || !canvasHeight
      || [x, y, width, height].some((number) => number == null)
      || width <= 0
      || height <= 0
    ) return null
    return Object.freeze({
      x: Math.max(0, Math.min(1, x / canvasWidth)),
      y: Math.max(0, Math.min(1, y / canvasHeight)),
      width: Math.max(0, Math.min(1, width / canvasWidth)),
      height: Math.max(0, Math.min(1, height / canvasHeight)),
    })
  }

  function referenceContentGroup(region, index, structure) {
    const name = text(region?.name || region?.title || region?.label)
    const role = text(region?.role || region?.kind || region?.type)
    const declaredContent = collapseSemanticDuplicates([
      region?.purpose || region?.description || region?.summary,
      region?.requirements || region?.requirement || region?.prompt,
    ].map(contentLockItem).filter(Boolean), 4)
    const countSource = [name, role, ...declaredContent].filter(Boolean).join('；')
    return Object.freeze({
      index: index + 1,
      id: text(region?.id) || `region_${index + 1}`,
      name,
      role,
      geometry: normalizedRegionGeometry(region, structure),
      declaredContent,
      matrix: matrixCountFromText(countSource),
      explicitCounts: explicitCountsFromText(countSource),
    })
  }

  function buildReferenceContentContract(prompt, structure, contentLock) {
    const groups = referenceStructureRegions(structure)
      .slice(0, REFERENCE_CONTENT_GROUP_LIMIT)
      .map((region, index) => referenceContentGroup(region, index, structure))
    const normalizedLock = normalizeContentLock(contentLock, prompt)
    return Object.freeze({
      schemaVersion: 1,
      source: 'reference-structure',
      sourceFingerprint: compactFingerprint(JSON.stringify({
        prompt: compactFingerprint(prompt),
        structure: structureFingerprint(structure || {}),
        content: normalizedLock,
      })),
      groupCount: groups.length,
      groups: Object.freeze(groups),
      preserveGroupOrder: true,
      preserveGroupGeometry: groups.some((group) => Boolean(group.geometry)),
      forbidCrossGroupDuplication: true,
    })
  }

  function percent(value) {
    return `${(Math.max(0, Math.min(1, Number(value) || 0)) * 100).toFixed(1)}%`
  }

  function referenceContentPromptFromContract(value) {
    const groups = Array.isArray(value?.groups) ? value.groups : []
    if (!groups.length) return ''
    const groupLabel = groups.length === 1 ? 'group' : 'groups'
    const groupRules = groups.map((group, index) => {
      const groupIndex = Number.isInteger(Number(group?.index)) ? Number(group.index) : index + 1
      const geometry = group?.geometry
        ? ` fixed normalized bounds x ${percent(group.geometry.x)}, y ${percent(group.geometry.y)}, width ${percent(group.geometry.width)}, height ${percent(group.geometry.height)}`
        : ''
      const matrix = group?.matrix
        ? (
            Number(group.matrix.columns) > 0 && Number(group.matrix.rows) > 0
              ? ` exact matrix ${Number(group.matrix.columns)} columns by ${Number(group.matrix.rows)} rows, total ${Number(group.matrix.total)} cells`
              : Number(group.matrix.columns) > 0
                ? ` exact ${Number(group.matrix.columns)} columns; row count remains reference-defined`
                : ` exact ${Number(group.matrix.rows)} rows; column count remains reference-defined`
          )
        : ''
      const explicitCounts = Array.isArray(group?.explicitCounts) && group.explicitCounts.length
        ? ` explicit totals ${group.explicitCounts.map((item) => `${Number(item.count)} ${text(item.unit)}`).join(', ')}`
        : ''
      return `Group ${groupIndex}:${geometry || ' preserve its reference-defined placement'};${matrix || ' preserve its reference-defined internal grouping'};${explicitCounts || ' preserve every explicitly declared total'}`
    })
    return [
      `Reference-derived content grouping contract: preserve exactly ${groups.length} ${groupLabel} in the supplied order and geometry.`,
      groupRules.join('. '),
      'Each group owns only the content already declared for that group; do not move, expand or duplicate it into another group.',
      'If the same identity is intentionally declared in multiple groups, preserve each group’s own declared representation, scale and total; a compact instance never authorizes an additional large instance.',
      'Repeated wording in the user request, region declaration or content lock describes the same instance and never increases its count.',
      'Do not draw group outlines, labels, coordinates or this contract as visible UI.',
    ].join(' ')
  }

  function styleProfileValue(value) {
    const normalized = text(value)
      .replace(/^[：:;,，；。\s]+|[：:;,，；。\s]+$/g, '')
      .slice(0, 180)
    return /^(?:未指定|无|不适用|n\/?a|null|none)$/i.test(normalized) ? '' : normalized
  }

  function normalizeStyleProfile(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
      ? (
          value.styleProfile
          || value.visualStyleProfile
          || value.profile
          || value
        )
      : {}
    const profile = {}
    STYLE_PROFILE_FIELDS.forEach((field) => {
      const sourceKey = field.sourceKeys.find((key) => Object.prototype.hasOwnProperty.call(source, key))
      profile[field.key] = sourceKey ? styleProfileValue(source[sourceKey]) : ''
    })
    return Object.freeze(profile)
  }

  function safeStyleTokens(value, fieldKey, limit = 4) {
    const allowed = SAFE_STYLE_ENUMS[fieldKey] || {}
    const source = Array.isArray(value)
      ? value
      : String(value == null ? '' : value).split(/[\s,，、;；|/]+/)
    const output = []
    source.forEach((item) => {
      const token = text(item).toLowerCase().replace(/[\s_]+/g, '-')
      const translated = allowed[token]
      if (translated && !output.includes(translated) && output.length < limit) output.push(translated)
    })
    return output.join('、')
  }

  function safePalette(value) {
    const source = Array.isArray(value) ? value.join(' ') : String(value == null ? '' : value)
    const colors = []
    for (const match of source.matchAll(/#[0-9a-f]{6}\b/gi)) {
      const color = match[0].toUpperCase()
      if (!colors.includes(color) && colors.length < 5) colors.push(color)
    }
    return colors.join('、')
  }

  function sanitizeStyleProfile(value) {
    const profile = normalizeStyleProfile(value)
    return Object.freeze({
      palette: safePalette(profile.palette),
      contrast: safeStyleTokens(profile.contrast, 'contrast', 3),
      material: safeStyleTokens(profile.material, 'material', 5),
      lighting: safeStyleTokens(profile.lighting, 'lighting', 4),
      shapeLanguage: safeStyleTokens(profile.shapeLanguage, 'shapeLanguage', 4),
      ornamentDensity: safeStyleTokens(profile.ornamentDensity, 'ornamentDensity', 2),
      typographyMood: safeStyleTokens(profile.typographyMood, 'typographyMood', 3),
      finish: safeStyleTokens(profile.finish, 'finish', 3),
    })
  }

  function hasStyleProfile(value) {
    return STYLE_PROFILE_FIELDS.some((field) => Boolean(text(value?.[field.key])))
  }

  function escapeExpression(value) {
    return String(value == null ? '' : value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function labeledStyleValue(source, aliases) {
    const orderedAliases = [...aliases].sort((left, right) => right.length - left.length)
    for (const alias of orderedAliases) {
      const expression = new RegExp(
        `(?:^|[\\n。！？；;])\\s*(?:整体|视觉|界面)?\\s*${escapeExpression(alias)}\\s*(?:为|采用|使用|强调|呈现|保持|偏向)?\\s*[：:]?\\s*([^\\n。！？；;]+)`,
        'i',
      )
      const match = String(source || '').match(expression)
      const value = styleProfileValue(match?.[1])
      if (value) return value
    }
    return ''
  }

  function parseStyleProfileJson(value) {
    const source = text(value)
    const start = source.indexOf('{')
    const end = source.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      const parsed = JSON.parse(source.slice(start, end + 1))
      const profile = normalizeStyleProfile(parsed)
      return hasStyleProfile(profile) ? profile : null
    } catch {
      return null
    }
  }

  function extractStyleProfile(value) {
    const direct = normalizeStyleProfile(value)
    if (hasStyleProfile(direct)) return direct
    const source = typeof value === 'string'
      ? value
      : text(value?.prompt || value?.visualStylePrompt || value?.rawOutput)
    const json = parseStyleProfileJson(source)
    if (json) return json
    const profile = {}
    STYLE_PROFILE_FIELDS.forEach((field) => {
      profile[field.key] = labeledStyleValue(source, field.aliases)
    })
    return Object.freeze(profile)
  }

  function visualStylePromptFromProfile(value) {
    const profile = normalizeStyleProfile(value)
    return STYLE_PROFILE_FIELDS
      .map((field) => {
        const item = styleProfileValue(profile[field.key])
        return item ? `${field.label}：${item}` : ''
      })
      .filter(Boolean)
      .join('；')
      .slice(0, 1200)
  }

  function extractVisualStylePrompt(value) {
    return visualStylePromptFromProfile(extractStyleProfile(value))
  }

  function styleProfileRequirements(value) {
    const requirements = text(value)
    if (!requirements) return STYLE_PROFILE_REQUIREMENT
    if (requirements.includes(STYLE_PROFILE_REQUIREMENT)) return requirements
    return `${STYLE_PROFILE_REQUIREMENT}\n${requirements}`
  }

  function referenceFingerprint(reference, index) {
    const dataUrl = text(reference?.dataUrl || reference?.imageUrl || reference?.url || reference?.src)
    return [
      index,
      text(reference?.id || reference?.sourceId || reference?.resourceId),
      text(reference?.role || reference?.referenceRole || reference?.kind),
      text(reference?.name || reference?.fileName),
      compactFingerprint(dataUrl),
    ].join('|')
  }

  function structureFingerprint(structure) {
    const regions = Array.isArray(structure?.regions)
      ? structure.regions
      : (Array.isArray(structure?.blocks) ? structure.blocks : [])
    return compactFingerprint(JSON.stringify({
      name: text(structure?.name || structure?.title),
      description: text(structure?.description || structure?.requirement),
      width: Number(structure?.width || structure?.canvas?.width) || 0,
      height: Number(structure?.height || structure?.canvas?.height) || 0,
      regions: regions.map((region) => ({
        id: text(region?.id),
        name: text(region?.name || region?.title),
        role: text(region?.role || region?.kind || region?.type),
        purpose: text(region?.purpose || region?.description),
        requirements: text(region?.requirements || region?.requirement),
        x: finiteNumber(region?.x),
        y: finiteNumber(region?.y),
        width: finiteNumber(region?.width),
        height: finiteNumber(region?.height),
        xNorm: finiteNumber(region?.xNorm),
        yNorm: finiteNumber(region?.yNorm),
        wNorm: finiteNumber(region?.wNorm),
        hNorm: finiteNumber(region?.hNorm),
      })),
    }))
  }

  function cacheKey(options) {
    const references = Array.isArray(options.references) ? options.references : []
    return [
      VERSION,
      compactFingerprint(options.prompt),
      compactFingerprint(options.negativePrompt),
      compactFingerprint(options.requirements),
      text(options.targetStyle).toLowerCase(),
      compactFingerprint(JSON.stringify(options.size || {})),
      structureFingerprint(options.structure || {}),
      references.map(referenceFingerprint).join('||'),
    ].join('::')
  }

  function abortError(reason) {
    const error = new Error(text(reason) || '本地 UI 设计总监请求已取消')
    error.name = 'AbortError'
    return error
  }

  function withAbort(task, signal) {
    if (!signal || typeof signal.addEventListener !== 'function') return Promise.resolve().then(task)
    if (signal.aborted) return Promise.reject(abortError(signal.reason))
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve(value)
      }
      const onAbort = () => finish(abortError(signal.reason))
      signal.addEventListener('abort', onAbort, { once: true })
      Promise.resolve().then(task).then(
        (value) => finish(null, value),
        (error) => finish(error),
      )
    })
  }

  function remember(key, value) {
    if (cache.has(key)) cache.delete(key)
    cache.set(key, value)
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
  }

  function fallbackResult(prompt, reason, detail = {}) {
    const contentIdentityLock = mergeContentLocks(prompt, detail.contentIdentityLock)
    const referenceContentContract = buildReferenceContentContract(
      prompt,
      detail.structure || {},
      contentIdentityLock,
    )
    return Object.freeze({
      prompt: text(prompt),
      styleProfile: emptyStyleProfile(),
      visualStylePrompt: '',
      contentIdentityLock,
      contentLockPrompt: contentLockPromptFromContract(contentIdentityLock),
      referenceContentContract,
      referenceContentPrompt: referenceContentPromptFromContract(referenceContentContract),
      negativePrompt: '',
      status: reason,
      used: false,
      cached: false,
      error: text(detail.error),
      version: VERSION,
    })
  }

  async function run(options = {}) {
    const prompt = text(options.prompt)
    const intent = normalizedIntent(options.intent)
    if (intent === 'iteration') return fallbackResult(prompt, 'skipped-iteration', { structure: options.structure })
    if (options.skip === true) return fallbackResult(prompt, 'skipped', { structure: options.structure })

    const references = styleProfileReferences(options.references)
    if (!references.length) return fallbackResult(prompt, 'skipped-no-reference', { structure: options.structure })

    const assistant = options.assistant || root?.NovaFlowUiDesignAssistantWorkflow
    if (typeof assistant?.run !== 'function') {
      return fallbackResult(prompt, 'unavailable', {
        error: '本地 UI 设计总监未就绪',
        structure: options.structure,
      })
    }

    const key = cacheKey({ ...options, references })
    const cached = cache.get(key)
    if (cached) return Object.freeze({ ...cached, cached: true })

    try {
      const result = await withAbort(() => assistant.run({
        provider: 'local',
        engine: 'local',
        action: 'combine',
        purpose: 'ui-design-style-profile',
        targetStyle: options.targetStyle || 'auto',
        prompt,
        negativePrompt: text(options.negativePrompt),
        requirements: styleProfileRequirements(options.requirements),
        references,
        structure: options.structure || {},
        size: options.size || {},
        electronAPI: options.electronAPI || root?.electronAPI,
        timeoutMs: options.timeoutMs,
      }), options.signal)
      const directedPrompt = text(result?.prompt)
      if (!directedPrompt) throw new Error('本地 UI 设计总监未返回有效要求')
      const styleProfile = sanitizeStyleProfile(extractStyleProfile(result))
      const visualStylePrompt = visualStylePromptFromProfile(styleProfile)
      const contentIdentityLock = mergeContentLocks(prompt, result)
      const contentLockPrompt = contentLockPromptFromContract(contentIdentityLock)
      const referenceContentContract = buildReferenceContentContract(
        prompt,
        options.structure || {},
        contentIdentityLock,
      )
      const referenceContentPrompt = referenceContentPromptFromContract(referenceContentContract)
      if (!visualStylePrompt) {
        const rejected = Object.freeze({
          prompt,
          styleProfile: emptyStyleProfile(),
          visualStylePrompt: '',
          contentIdentityLock,
          contentLockPrompt,
          referenceContentContract,
          referenceContentPrompt,
          negativePrompt: '',
          status: 'rejected-empty-style-profile',
          used: false,
          cached: false,
          error: 'Director output did not contain a valid theme-neutral style profile',
          version: VERSION,
        })
        remember(key, rejected)
        return rejected
      }
      const directed = Object.freeze({
        prompt,
        styleProfile,
        visualStylePrompt,
        contentIdentityLock,
        contentLockPrompt,
        referenceContentContract,
        referenceContentPrompt,
        negativePrompt: text(result?.negativePrompt),
        status: 'directed',
        used: true,
        cached: false,
        error: '',
        version: VERSION,
      })
      remember(key, directed)
      return directed
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      return fallbackResult(prompt, 'fallback', {
        error: error?.message || error,
        structure: options.structure,
      })
    }
  }

  function clearCache() {
    cache.clear()
  }

  return Object.freeze({
    VERSION,
    MAX_CACHE_ENTRIES,
    normalizedIntent,
    compactFingerprint,
    semanticAnchors,
    preservesSemanticAnchors,
    STYLE_PROFILE_FIELDS,
    STYLE_PROFILE_REQUIREMENT,
    CONTENT_LOCK_LIST_LIMIT,
    REFERENCE_CONTENT_GROUP_LIMIT,
    SAFE_STYLE_ENUMS,
    normalizeStyleProfile,
    sanitizeStyleProfile,
    extractStyleProfile,
    visualStylePromptFromProfile,
    extractVisualStylePrompt,
    emptyContentLock,
    isContentLockCandidate,
    normalizeContentLock,
    localContentLockFallback,
    mergeContentLocks,
    hasContentLock,
    contentLockPromptFromContract,
    collapseSemanticDuplicates,
    matrixCountFromText,
    explicitCountsFromText,
    buildReferenceContentContract,
    referenceContentPromptFromContract,
    styleProfileReferences,
    cacheKey,
    withAbort,
    run,
    clearCache,
  })
})
