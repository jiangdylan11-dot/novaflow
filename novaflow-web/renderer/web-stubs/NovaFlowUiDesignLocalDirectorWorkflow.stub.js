// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowUiDesignLocalDirectorWorkflow.
// UI helpers are kept verbatim; every graph builder is replaced by a
// recorder, so this file contains no ComfyUI topology (asserted by
// tools/generate-workflow-stubs.mjs --check and by the protocol suite).
(function (root) {
  const __record = (module, method, options) => {
    const intent = { __novaflowWorkflowIntent: true, module, method, options };
    try { (root.NovaFlowWebRuntime && root.NovaFlowWebRuntime.recordWorkflowIntent || (() => {}))(intent); } catch (_) {}
    return intent;
  };
  const __api = {};
  __api["VERSION"] = "20260724-ui-design-local-director-7";
  __api["MAX_CACHE_ENTRIES"] = 12;
  __api["STYLE_PROFILE_FIELDS"] = [{"key":"palette","label":"配色","sourceKeys":["palette","colorPalette","colors"],"aliases":["配色","色彩体系","色彩关系","主色调","色盘","palette","color palette"]},{"key":"contrast","label":"对比","sourceKeys":["contrast","valueContrast","contrastHierarchy"],"aliases":["对比","对比关系","明暗对比","层级对比","contrast"]},{"key":"material","label":"材质","sourceKeys":["material","materials","texture"],"aliases":["材质","材质体系","表面质感","texture","material"]},{"key":"lighting","label":"光影","sourceKeys":["lighting","light","illumination"],"aliases":["光影","灯光","照明","lighting","light"]},{"key":"shapeLanguage","label":"形状语言","sourceKeys":["shapeLanguage","shape","lineLanguage","graphicLanguage"],"aliases":["形状语言","造型语言","图形语言","线条语言","shape language"]},{"key":"ornamentDensity","label":"装饰密度","sourceKeys":["ornamentDensity","ornament","decorationDensity"],"aliases":["装饰密度","装饰语言","纹样密度","ornament density"]},{"key":"typographyMood","label":"字体气质","sourceKeys":["typographyMood","typography","typeMood"],"aliases":["字体气质","字形气质","排版气质","typography mood","typography"]},{"key":"finish","label":"渲染完成度","sourceKeys":["finish","renderFinish","commercialFinish"],"aliases":["渲染完成度","商业完成度","画面完成度","render finish","finish"]}];
  __api["STYLE_PROFILE_REQUIREMENT"] = "styleProfile必须严格使用安全枚举和十六进制色值，不得输出自由文本；不得写入主题、人物、物体、界面功能、布局、文字或Logo。contentIdentityLock只能使用用户目标中真实出现的原文短语，不得从参考图提取或推测内容。";
  __api["CONTENT_LOCK_LIST_LIMIT"] = 24;
  __api["REFERENCE_CONTENT_GROUP_LIMIT"] = 24;
  __api["SAFE_STYLE_ENUMS"] = {"contrast":{"low":"低对比","medium":"中等对比","high":"高对比","focal-emphasis":"焦点高对比","layered-values":"分层明暗对比"},"material":{"matte":"哑光表面","glossy":"亮面表面","polished-metal":"抛光金属","gilded-metal":"鎏金金属","stone":"石材","jade-like":"玉石质感","glass":"玻璃","ceramic":"陶瓷","wood":"木材","woven-fabric":"织物","paper":"纸张","leather":"皮革","translucent":"半透明材质","emissive":"自发光材质","painted":"绘制表面"},"lighting":{"flat":"均匀平光","soft-diffuse":"柔和漫射光","directional":"方向性主光","rim-accent":"克制轮廓光","backlit":"逆光","volumetric":"体积光","ambient":"环境光","dramatic":"戏剧化明暗","high-key":"高调光影","low-key":"低调光影","glow-accent":"局部辉光强调"},"shapeLanguage":{"geometric":"几何形","organic":"有机形","rounded":"圆润轮廓","angular":"锐角轮廓","symmetrical":"对称秩序","asymmetrical":"非对称秩序","thin-line":"细线条","bold-line":"粗线条","layered":"分层块面","minimal":"极简形状","ornate":"精细装饰形"},"ornamentDensity":{"none":"无装饰","low":"低装饰密度","restrained":"克制装饰","medium":"中等装饰密度","high":"高装饰密度","focal-only":"仅焦点装饰","border-focused":"边缘装饰","surface-patterned":"表面纹样"},"typographyMood":{"modern":"现代字形气质","classical":"古典字形气质","formal":"正式字形气质","playful":"活泼字形气质","technical":"技术感字形气质","luxury":"高贵字形气质","bold-display":"粗重展示字","compact":"紧凑排版","high-legibility":"高可读性"},"finish":{"flat-vector":"精致扁平矢量完成度","painted-2d":"精绘二维完成度","stylized-3d":"风格化三维完成度","realistic-3d":"写实三维完成度","commercial-game-ui":"商业游戏界面完成度","cinematic":"电影感完成度","illustrative":"插画式完成度","high-detail":"高细节完成度","clean":"干净利落的完成度","premium":"高级商业完成度"}};
  __api["normalizedIntent"] = function normalizedIntent(value) {
    return text(value).toLowerCase() === 'iteration' ? 'iteration' : 'redesign'
  };
  __api["compactFingerprint"] = function compactFingerprint(value) {
    const source = String(value == null ? '' : value)
    let hash = 2166136261
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return `${source.length}:${(hash >>> 0).toString(16)}`
  };
  __api["semanticAnchors"] = function semanticAnchors(value) {
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
  };
  __api["preservesSemanticAnchors"] = function preservesSemanticAnchors(sourcePrompt, directedPrompt) {
    const anchors = semanticAnchors(sourcePrompt)
    if (!anchors.length) return false
    const candidate = text(directedPrompt).toLowerCase().replace(/\s+/g, '')
    return anchors.every((anchor) => candidate.includes(anchor))
  };
  __api["normalizeStyleProfile"] = function normalizeStyleProfile(value) {
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
  };
  __api["sanitizeStyleProfile"] = function sanitizeStyleProfile(value) {
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
  };
  __api["extractStyleProfile"] = function extractStyleProfile(value) {
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
  };
  __api["visualStylePromptFromProfile"] = function visualStylePromptFromProfile(value) {
    const profile = normalizeStyleProfile(value)
    return STYLE_PROFILE_FIELDS
      .map((field) => {
        const item = styleProfileValue(profile[field.key])
        return item ? `${field.label}：${item}` : ''
      })
      .filter(Boolean)
      .join('；')
      .slice(0, 1200)
  };
  __api["extractVisualStylePrompt"] = function extractVisualStylePrompt(value) {
    return visualStylePromptFromProfile(extractStyleProfile(value))
  };
  __api["emptyContentLock"] = function emptyContentLock(prompt = '') {
    return Object.freeze({
      schemaVersion: 1,
      source: 'user-prompt',
      sourceFingerprint: compactFingerprint(prompt),
      identityAnchors: Object.freeze([]),
      requiredElements: Object.freeze([]),
      exactTokens: Object.freeze([]),
      forbidSubstitution: true,
    })
  };
  __api["isContentLockCandidate"] = function isContentLockCandidate(candidate, prompt = '') {
    const item = contentLockItem(candidate)
    if (!item) return false
    if (explicitlyRequestsVisibleDevice(prompt, item)) return true
    if (CONTENT_LOCK_NON_VISUAL_PATTERNS.some((pattern) => pattern.test(item))) return false
    if (/[0-9０-９]+\s*[xX×*]\s*[0-9０-９]+/.test(item) && contentLockDimensionIsOutputSpec(item)) return false
    return true
  };
  __api["normalizeContentLock"] = function normalizeContentLock(value, prompt = '') {
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
  };
  __api["localContentLockFallback"] = function localContentLockFallback(prompt) {
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
  };
  __api["mergeContentLocks"] = function mergeContentLocks(prompt, ...values) {
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
  };
  __api["hasContentLock"] = function hasContentLock(value) {
    const lock = normalizeContentLock(value)
    return Boolean(lock.identityAnchors.length || lock.requiredElements.length || lock.exactTokens.length)
  };
  __api["contentLockPromptFromContract"] = function contentLockPromptFromContract(value) {
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
  };
  __api["collapseSemanticDuplicates"] = function collapseSemanticDuplicates(value, limit = CONTENT_LOCK_LIST_LIMIT, preferSpecific = true) {
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
  };
  __api["matrixCountFromText"] = function matrixCountFromText(value) {
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
  };
  __api["explicitCountsFromText"] = function explicitCountsFromText(value) {
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
  };
  __api["buildReferenceContentContract"] = function buildReferenceContentContract(prompt, structure, contentLock) {
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
  };
  __api["referenceContentPromptFromContract"] = function referenceContentPromptFromContract(value) {
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
  };
  __api["styleProfileReferences"] = function styleProfileReferences(value) {
    const styleRoles = new Set(['style', 'material', 'color', 'reference'])
    return (Array.isArray(value) ? value : [])
      .filter(Boolean)
      .filter((reference) => styleRoles.has(normalizedReferenceRole(reference)))
  };
  __api["cacheKey"] = function cacheKey(options) {
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
  };
  __api["withAbort"] = function withAbort(task, signal) {
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
  };
  __api["run"] = async function run(options = {}) {
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
  };
  __api["clearCache"] = function clearCache() {
    cache.clear()
  };
  root["NovaFlowUiDesignLocalDirectorWorkflow"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
