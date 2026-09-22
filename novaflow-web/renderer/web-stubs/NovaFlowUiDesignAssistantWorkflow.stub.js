// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowUiDesignAssistantWorkflow.
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
  __api["VERSION"] = "20260722-ui-design-assistant-workflow-6";
  __api["ANALYSIS_REFERENCE_LIMITS"] = {"grok":4,"local":3};
  __api["MAX_ANALYSIS_REFERENCES"] = 4;
  __api["REQUIREMENTS_TRANSPORT_LIMIT"] = 1950;
  __api["DEFAULT_TIMEOUT_MS"] = 120000;
  __api["LOCAL_TIMEOUT_MS"] = 300000;
  __api["UI_STYLE_PRESETS"] = [{"value":"auto","label":"智能匹配","instruction":"根据页面功能、现有结构、用户要求和参考图职责，自动选择统一且适合该游戏产品的视觉语言。"},{"value":"reference","label":"跟随参考图","instruction":"仅从职责为“风格”的参考图提取配色、材质、字体气质、线条、光影和装饰语言，不复制其布局、文字或功能。"},{"value":"eastern-fantasy","label":"东方幻想","instruction":"采用克制的东方幻想视觉语言，以古典纹样、玉石、鎏金、织物或宣纸质感建立精致层级，避免装饰压过信息。"},{"value":"anime-polished","label":"二次元精致","instruction":"采用高完成度二次元游戏 UI 语言，使用清晰色块、轻盈层次、细腻高光和统一描边，保证控件与文字易读。"},{"value":"sci-fi-future","label":"科幻未来","instruction":"采用科幻未来视觉语言，以冷色发光边缘、半透明层板、精密线框和适量全息反馈建立技术感，避免过度霓虹。"},{"value":"dark-epic","label":"暗黑史诗","instruction":"采用暗黑史诗视觉语言，以深色石材、旧金属、雕刻纹理、暗金强调和戏剧性明暗建立厚重感，同时保持操作清晰。"},{"value":"cartoon-casual","label":"卡通休闲","instruction":"采用轻松友好的卡通游戏 UI 语言，以明快配色、圆润轮廓、柔和阴影和明确反馈降低理解成本。"},{"value":"modern-minimal","label":"现代极简","instruction":"采用现代极简视觉语言，以克制配色、精细排版、清晰留白和轻量层级突出内容，避免空洞或网页模板感。"}];
  __api["normalizeProvider"] = function normalizeProvider(value) {
    const provider = text(value).toLowerCase()
    return provider === 'gpt' || provider === 'google' ? provider : 'local'
  };
  __api["normalizeEngine"] = function normalizeEngine(value) {
    return text(value).toLowerCase() === 'local' ? 'local' : 'grok'
  };
  __api["timeoutForEngine"] = function timeoutForEngine(engine, timeoutMs) {
    const configured = Number(timeoutMs)
    if (Number.isFinite(configured) && configured > 0) return Math.max(1, configured)
    return normalizeEngine(engine) === 'local' ? LOCAL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS
  };
  __api["analysisReferenceLimit"] = function analysisReferenceLimit(engine) {
    return ANALYSIS_REFERENCE_LIMITS[normalizeEngine(engine)]
  };
  __api["normalizeTargetStyle"] = function normalizeTargetStyle(value) {
    const style = text(value).toLowerCase().replace(/[\s_]+/g, '-')
    return UI_STYLE_PRESETS.some((item) => item.value === style) ? style : 'auto'
  };
  __api["targetStyleInstruction"] = function targetStyleInstruction(value) {
    const style = normalizeTargetStyle(value)
    return UI_STYLE_PRESETS.find((item) => item.value === style)?.instruction || ''
  };
  __api["targetStyleContractLine"] = function targetStyleContractLine(value, legacy = false) {
    const style = normalizeTargetStyle(value)
    if (style === 'auto') return ''
    const preset = UI_STYLE_PRESETS.find((item) => item.value === style)
    if (!preset) return ''
    const suffix = legacy ? '' : ' 后文视觉描述若与本条冲突，以本条为准。'
    return `视觉风格约束（不改变页面结构）：${preset.label}。${preset.instruction}${suffix}`
  };
  __api["stripTargetStyleContract"] = function stripTargetStyleContract(value) {
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
  };
  __api["applyTargetStyleContract"] = function applyTargetStyleContract(value, targetStyle) {
    const prompt = stripTargetStyleContract(value)
    const style = normalizeTargetStyle(targetStyle)
    if (!prompt || style === 'auto') return prompt
    const contract = targetStyleContractLine(style)
    return contract ? `${contract}\n${prompt}` : prompt
  };
  __api["normalizeReferenceRole"] = function normalizeReferenceRole(value) {
    const role = text(value).toLowerCase().replace(/[\s_]+/g, '-')
    if (['style', 'visual-style', '风格'].includes(role)) return 'style'
    if (['layout', 'ui-layout', '布局'].includes(role)) return 'layout'
    if (['color', 'palette', '配色'].includes(role)) return 'color'
    if (['material', 'texture', '材质'].includes(role)) return 'material'
    if (['content', 'asset', '内容', '素材'].includes(role)) return 'content'
    if (['character', '角色'].includes(role)) return 'character'
    if (['subject', 'identity', '主体'].includes(role)) return 'subject'
    return 'reference'
  };
  __api["referenceSnapshot"] = function referenceSnapshot(values, engine = 'local') {
    const source = Array.isArray(values) ? values : []
    const normalizedEngine = normalizeEngine(engine)
    const limit = analysisReferenceLimit(normalizedEngine)
    if (source.length > limit) {
      const label = normalizedEngine === 'local' ? '本地设计助手' : 'Grok 设计助手'
      throw new Error(`${label}一次最多分析 ${limit} 张参考图，请取消多余选择后再提交。`)
    }
    const references = source.map(normalizeReference).filter(Boolean)
    if (references.length !== source.length) throw new Error('参考图数据无效，设计助手只接受 PNG、JPEG 或 WebP 图片。')
    return Object.freeze(references)
  };
  __api["structureSnapshot"] = function structureSnapshot(value) {
    const source = value && typeof value === 'object' ? value : {}
    const regions = Array.isArray(source.regions)
      ? source.regions
      : Array.isArray(source.blocks)
        ? source.blocks
        : []
    return Object.freeze({
      name: compactText(source.name || source.title, 120),
      description: compactText(source.description || source.summary || source.requirement, 500),
      width: Math.max(0, Math.round(Number(source.width || source.canvas?.width) || 0)),
      height: Math.max(0, Math.round(Number(source.height || source.canvas?.height) || 0)),
      regions: Object.freeze(regions.slice(0, 48).map((region, index) => Object.freeze({
        name: compactText(region?.name || region?.title || region?.label, 80) || `区块${index + 1}`,
        role: compactText(region?.role || region?.kind || region?.type, 40) || 'region',
        purpose: compactText(region?.purpose || region?.description, 240),
        requirements: compactText(region?.requirements || region?.requirement, 240),
      }))),
    })
  };
  __api["inferPageScene"] = function inferPageScene(value) {
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
  };
  __api["buildRequirements"] = function buildRequirements(options, structure, references) {
    const size = options?.size && typeof options.size === 'object' ? options.size : {}
    const width = Math.max(0, Math.round(Number(size.width || structure.width) || 0))
    const height = Math.max(0, Math.round(Number(size.height || structure.height) || 0))
    const orientation = width && height ? (width > height ? '横屏' : width < height ? '竖屏' : '方形') : ''
    const regions = structure.regions.slice(0, 32)
    const regionSummary = budgetText(regions.map((region, index) => (
      `${index + 1}.${compactText(region.name, 36)}（${compactText(region.role, 24)}）`
    )).join('；'), 280)
    const regionDetails = budgetText(regions.map((region) => {
      const detail = [compactText(region.purpose, 70), compactText(region.requirements, 90)].filter(Boolean).join('；')
      return detail ? `${compactText(region.name, 36)}：${detail}` : ''
    }).filter(Boolean).join('；'), 300)
    const referenceSummary = budgetText(references.map((reference, index) => (
      `参考图${index + 1}（${reference.role}）：只提取该职责，不复制无关主体、文字、布局或界面内容`
    )).join('；'), 240)
    const targetStyle = normalizeTargetStyle(options?.targetStyle)
    const stylePreset = UI_STYLE_PRESETS.find((item) => item.value === targetStyle)
    const styleInstruction = targetStyleInstruction(targetStyle)
    const scene = inferPageScene(structure)
    const qualityProfileApi = root?.NovaFlowUiDesignQualityProfile
    const qualityProfile = typeof qualityProfileApi?.compile === 'function'
      ? qualityProfileApi.compile(options, structure)
      : null
    return [
      qualityProfile?.instruction || '',
      '你正在为 NovaFlow 的 UI 版块编写最终设计要求，不是普通绘画提示词。',
      actionInstruction(options?.action),
      '当前提示中任何 __NOVAFLOW_ 开头并以双下划线结尾的资源引用占位符都必须原样、原次数保留。',
      '执行优先级：用户补充要求、页面目标、页面结构和区块生成要求高于目标风格与参考图；发生冲突时必须服从前者。目标风格只控制配色、材质、字体气质、图形语言、光影和装饰，不得改变布局结构、增加功能或删除控件。',
      '输出应描述可直接生成成品 UI 的视觉结果，必须保持功能层级清晰、控件可读、间距和对齐一致。不要输出分析过程、多个方案、JSON、坐标、尺寸标注或编辑器操作说明。',
      width && height ? `最终输出尺寸：${width} × ${height}，${orientation}。` : '',
      text(options?.requirements) ? `用户补充要求：${budgetText(options.requirements, 400)}` : '',
      structure.name ? `页面：${budgetText(structure.name, 90)}。` : '',
      structure.description ? `页面目标：${budgetText(structure.description, 210)}` : '',
      `页面场景（自动识别，仅用于视觉语境）：${scene}。不得据此增加页面结构中未声明的功能。`,
      styleInstruction ? `目标风格（低优先级视觉约束）：${stylePreset?.label || '智能匹配'}。${styleInstruction}` : '',
      referenceSummary ? `参考职责：${referenceSummary}` : '',
      regionSummary ? `页面结构摘要：${regionSummary}` : '',
      regionDetails ? `区块生成要求：${regionDetails}` : '',
    ].filter(Boolean).join('\n').slice(0, REQUIREMENTS_TRANSPORT_LIMIT)
  };
  __api["prepareReferencesForEngine"] = async function prepareReferencesForEngine(references, engine) {
    if (normalizeEngine(engine) !== 'grok' || !references.length) return references
    const helper = root?.NovaFlowUiDesignAssistantImageHelper
    if (typeof helper?.normalizeReferencesForGrok !== 'function') return references
    const prepared = await helper.normalizeReferencesForGrok(references)
    if (!Array.isArray(prepared) || prepared.length !== references.length) {
      throw new Error('Grok 参考图预处理失败，请重新选择参考图。')
    }
    return referenceSnapshot(prepared, 'grok')
  };
  __api["protectText"] = function protectText(value) {
    const tool = root?.NovaFlowResourceMentionTool
    return typeof tool?.protectText === 'function' ? tool.protectText(value) : fallbackProtect(value)
  };
  __api["restoreText"] = function restoreText(value, protection) {
    const tool = root?.NovaFlowResourceMentionTool
    if (typeof tool?.restoreText === 'function') return tool.restoreText(value, protection)
    let restored = String(value == null ? '' : value)
    for (const item of protection?.tokens || []) {
      const count = restored.split(item.placeholder).length - 1
      if (count !== 1) return { ok: false, text: restored, reason: 'protected resource mention is missing or duplicated' }
    }
    for (const item of protection?.tokens || []) restored = restored.replace(item.placeholder, item.token)
    return { ok: true, text: restored }
  };
  __api["run"] = async function run(options = {}) {
    const provider = normalizeProvider(options.provider)
    const engine = normalizeEngine(options.engine)
    const rawReferences = await resolveValue(options.getReferences, options.references || [])
    const references = referenceSnapshot(rawReferences, engine)
    const targetStyle = normalizeTargetStyle(options?.targetStyle)
    if (targetStyle === 'reference' && !references.some((reference) => reference.role === 'style')) {
      throw new Error('“跟随参考图”需要至少选择一张职责为“风格”的参考图。')
    }
    const requestReferences = await prepareReferencesForEngine(references, engine)
    const rawStructure = await resolveValue(options.getStructureContext, options.structure || options.snapshot || {})
    const structure = structureSnapshot(rawStructure)
    const scene = inferPageScene(structure)
    const requirements = buildRequirements(options, structure, references)
    const qualityProfileApi = root?.NovaFlowUiDesignQualityProfile
    const qualityProfile = typeof qualityProfileApi?.compile === 'function'
      ? qualityProfileApi.compile(options, structure)
      : null
    const currentPrompt = stripTargetStyleContract(options.prompt)
    const currentNegative = String(options.negativePrompt == null ? '' : options.negativePrompt)
    const promptProtection = protectText(currentPrompt)
    const negativeProtection = protectText(currentNegative)
    const revision = typeof options.getRevision === 'function' ? options.getRevision() : options.revision
    const supportsNegativePrompt = provider === 'local'
    const requestedPurpose = text(options.purpose).toLowerCase().replace(/[\s_]+/g, '-')
    const purpose = requestedPurpose.startsWith('ui-design-')
      ? requestedPurpose
      : (references.length ? 'ui-design-reference' : (currentPrompt.trim() ? 'ui-design-optimize' : 'ui-design-create'))

    const call = engine === 'local' ? localApi(options, references) : grokApi(options, references)
    if (typeof call !== 'function') throw new Error(engine === 'local' ? '本地设计助手未就绪' : 'Grok 设计助手未就绪')

    let result
    if (engine === 'grok') {
      const sessionToken = text(await resolveValue(options.getSessionToken, options.sessionToken))
      if (!sessionToken) throw new Error('请先登录 NovaFlow 账号')
      result = await withTimeout(() => call({
        token: sessionToken,
        prompt: promptProtection.text,
        currentPrompt: promptProtection.text,
        negativePrompt: supportsNegativePrompt ? negativeProtection.text : '',
        supportsNegativePrompt,
        requirements,
        purpose,
        surface: 'ui-design',
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
        provider,
      }), options.timeoutMs, engine)
    }

    if (typeof options.getRevision === 'function' && options.getRevision() !== revision) {
      const error = new Error('设计要求已在助手处理期间发生变化，本次结果未覆盖当前内容')
      error.name = 'StaleResultError'
      throw error
    }

    const parsed = unwrapResult(result)
    const restoredPrompt = restoreText(parsed.prompt, promptProtection)
    if (!restoredPrompt.ok) throw new Error('参考图引用保护失败，已保留原设计要求')
    let restoredNegative = { ok: true, text: '' }
    if (supportsNegativePrompt && parsed.negativePrompt) {
      restoredNegative = restoreText(parsed.negativePrompt, negativeProtection)
      if (!restoredNegative.ok) throw new Error('负面要求中的参考图引用保护失败，已保留原内容')
    }

    const finalPrompt = applyTargetStyleContract(restoredPrompt.text, targetStyle)

    return Object.freeze({
      prompt: finalPrompt,
      negativePrompt: supportsNegativePrompt ? restoredNegative.text : '',
      hasNegativePrompt: supportsNegativePrompt && Boolean(restoredNegative.text),
      provider,
      engine,
      targetStyle,
      contentType: qualityProfile?.contentType || 'game-ui',
      contentPurpose: qualityProfile?.purpose || 'auto',
      qualityTendency: qualityProfile?.qualityTendency || 'commercial',
      purpose,
      referenceCount: references.length,
      references,
      structure,
      scene,
    })
  };
  __api["createSession"] = function createSession() {
    let token = 0
    return Object.freeze({
      cancel() { token += 1 },
      async run(options) {
        const requestToken = ++token
        const result = await run(options)
        if (requestToken !== token) {
          const error = new Error('设计助手请求已取消')
          error.name = 'AbortError'
          throw error
        }
        return result
      },
    })
  };
  root["NovaFlowUiDesignAssistantWorkflow"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
