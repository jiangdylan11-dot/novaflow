(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignGenerateWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const VERSION = '20260730-ui-design-generate-workflow-7'
  const MODE = 'img2img'
  // The signal of the run in progress (one UI run at a time): a runtime call it is waiting on ends
  // the moment 任务中止 is pressed instead of when the call returns.
  let RUN_SIGNAL = null
  const LOCAL_REDESIGN_MODE = MODE
  const UI_TASK_PROFILE = 'ui-design'
  const FILLED_REGIONS_VISUAL_ENCODING = 'filled-regions-only'
  const SOFT_LAYOUT_GUIDE_ENCODING = 'soft-occupancy-heatmap-v1'
  const SOFT_UI_SEMANTIC_SCAFFOLD_ENCODING = 'soft-ui-semantic-scaffold-v2'
  const LOCAL_REDESIGN_MODEL_PROMPT_MAX_CHARS = 1800
  const LOCAL_PROMPT_LOCK_MAX_CHARS = 480
  // A local compute node whose ComfyUI carries Qwen-Image-2.1 takes every connected reference in one
  // pass, instead of 2511's three slots: up to 10, the model card's limit (the encoder node has 16
  // inputs, but the model supports 10).
  const LOCAL_UI_ENGINE_QWEN21 = 'qwen-2.1'
  const QWEN21_UI_PROMPT_MAX_CHARS = 4000
  const DIGITAL_UI_CANVAS_CONTRACT = [
    'Render one screen-native software interface as the image itself, viewed straight-on and edge-to-edge.',
    'The image boundary is exactly the viewport boundary, and every visible element belongs to the same flat digital interface.',
    'Use one continuous art-directed background reaching all four image edges, then compose only the sections, controls, repeated elements and content required by the user, semantic structure or applicable reference roles as shallow 2D HUD layers on one orthographic screen plane.',
    'Keep a uniform front-facing UI depth and make every interactive element read as an on-screen software control embedded inside the viewport.',
  ]
  const DIGITAL_REEL_UI_CONTRACT = [
    'This is a polished full-screen digital reward-symbol game interface, never a physical cabinet or device.',
    'Treat the user request, role-declared reference images and semantic page structure as the only source of section positions, content groups, repeated-item arrangements, controls and counts.',
    'Do not add a standard slot template, an extra control strip, cabinet controls, decorative characters or duplicate subjects unless the applicable reference role or the user explicitly requires them.',
  ]
  const DIGITAL_UI_CANVAS_NEGATIVE_PROMPT = [
    'physical hardware',
    'device body',
    'arcade cabinet',
    'slot cabinet',
    'monitor bezel',
    'phone mockup',
    'product shot',
    'room',
    'table',
    'screen inside a scene',
    'device perspective',
    'joystick hardware',
  ].join(', ')
  const LOCAL_REFERENCE_UI_NEGATIVE_PROMPT = [
    '实体设备',
    '街机机柜',
    '老虎机机身',
    '手机框',
    '产品展示照',
  ].join('，')
  const LOCAL_TXT2IMG_SCREEN_OPENING = [
    ...DIGITAL_UI_CANVAS_CONTRACT,
  ].join(' ')
  const LOCAL_TXT2IMG_QUALITY_CLOSING = [
    'Use a coherent production-ready commercial game UI design system with clear hierarchy, readable controls, consistent assets, crisp material detail, controlled lighting and uniform shallow interface depth.',
  ].join(' ')
  const LOCAL_TXT2IMG_SCREEN_CLOSING = [
    'Output only the finished full-canvas interface.',
  ].join(' ')
  const GOOGLE_UI_SYSTEM_PROMPT = [
    'You are an expert UI generation engine. Always output exactly one finished UI artwork.',
    'For this UI-design task, image 1 is a non-visual soft spatial occupancy guide, never source artwork.',
    'Read only region centers, relative coverage, ordering and whitespace from image 1.',
    'The presence of a region does not imply a card, frame, panel, halo, border, container or background band.',
    'Never reproduce, sharpen, trace, outline, materialize, color-match or decorate any guide boundary or zone.',
    'Use every other reference image only for the role stated in the user prompt.',
  ].join(' ')
  const referenceLimits = Object.freeze({
    local: Object.freeze({
      provider: 'local',
      totalReferenceLimit: 3,
      externalReferenceLimit: 2,
      reservedLayoutReferences: 1,
      negativePrompt: true,
    }),
    // The user's negative prompt is real on 2.1: a filled one switches the graph to cfg 2.5.
    localQwen21: Object.freeze({
      provider: 'local',
      engine: LOCAL_UI_ENGINE_QWEN21,
      totalReferenceLimit: 10,
      externalReferenceLimit: 10,
      reservedLayoutReferences: 0,
      negativePrompt: true,
    }),
    gpt: Object.freeze({
      provider: 'gpt',
      totalReferenceLimit: 16,
      externalReferenceLimit: 15,
      reservedLayoutReferences: 1,
      negativePrompt: false,
    }),
    google: Object.freeze({
      provider: 'google',
      totalReferenceLimit: 14,
      externalReferenceLimit: 13,
      reservedLayoutReferences: 1,
      negativePrompt: false,
    }),
  })
  const MAX_EXTERNAL_REFERENCES = referenceLimits.local.externalReferenceLimit
  const CONNECT_TIMEOUT_MS = 8000
  const WORKFLOW_TIMEOUT_MS = 20000
  const PROMPT_TIMEOUT_MS = 30000
  const HISTORY_TIMEOUT_MS = 20000
  const DOWNLOAD_TIMEOUT_MS = 30000
  const DEFAULT_MAX_WAIT_MS = 45 * 60 * 1000
  const DEFAULT_POLL_INTERVAL_MS = 1200

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  function positivelyRequestsHardwareCarrier(value) {
    const source = cleanText(value)
    if (!source) return false
    const hardwarePattern = /(?:实体(?:老虎机|机台|机柜|设备|终端)|台式老虎机|(?:老虎机|街机|游戏机)(?:机台|机柜|外观)|(?:手机|平板|显示器|终端|设备)(?:样机|商品|产品|产品图|实物|外观|机身)|(?:一部|一台)(?:手机|平板|显示器|终端|设备)|产品级硬件外观|physical\s+(?:device|cabinet|machine)|(?:phone|tablet|device|hardware|arcade|slot)\s+(?:mockup|cabinet|body|product\s+shot))/ig
    const clauses = source.split(/[。；;！？!?\n]+/)
    return clauses.some((clause) => {
      hardwarePattern.lastIndex = 0
      let match
      while ((match = hardwarePattern.exec(clause))) {
        const prefix = clause.slice(0, match.index)
        if (!/(?:不(?:要|得|应|可|再)?|禁止|避免|去除|删除|移除|排除|无需|非|never|without|exclude|avoid|remove|forbid|do not|don't)[^。；;！？!?\n]{0,48}$/i.test(prefix)) {
          return true
        }
      }
      return false
    })
  }

  function resolveUiOutputCarrier(...values) {
    return values.some((value) => positivelyRequestsHardwareCarrier(value)) ? 'hardware' : 'screen'
  }

  function replaceDeliveryDimensions(value) {
    return String(value == null ? '' : value).replace(
      /(?:竖屏|横屏|方形)?\s*([0-9０-９]{2,5})\s*[xX×*]\s*([0-9０-９]{2,5})(?:\s*(?:px|像素))?/g,
      (match, rawWidth, rawHeight) => {
        const toNumber = (item) => Number(String(item).replace(/[０-９]/g, (digit) => String('０１２３４５６７８９'.indexOf(digit))))
        return Math.max(toNumber(rawWidth), toNumber(rawHeight)) >= 128 ? '' : match
      },
    )
  }

  function normalizeScreenNativeUiText(value, carrierIntent = 'screen') {
    const source = cleanText(value)
    if (!source || cleanText(carrierIntent).toLowerCase() === 'hardware') return source
    return cleanText(
      replaceDeliveryDimensions(source)
        .replace(/(?:手机端|移动端|手机界面|移动界面)(?=\s*(?:清晰可读|易读|可读|适配|显示|体验)?)/g, '目标视口')
        .replace(/小屏幕数字界面(?=\s*(?:清晰可读|易读|可读|适配|显示|体验)?)/g, '目标视口')
        .replace(/\b(?:mobile|phone)\s+(?:ui|interface|app|screen)\b/gi, 'screen-native digital interface')
        .replace(/老虎机(?:游戏)?主界面/g, '全屏数字转轴游戏主界面')
        .replace(/老虎机(?:游戏)?界面/g, '全屏数字转轴游戏界面')
        .replace(/老虎机转轴/g, '数字转轴符号网格')
        .replace(/老虎机/g, '数字转轴游戏')
        .replace(/\bslot\s+machine\s+(?:ui|interface)\b/gi, 'flat full-screen reel-game UI')
        .replace(/\bslot\s+machine\b/gi, 'flat full-screen reel game')
        .replace(/[，,]{2,}/g, '，')
        .replace(/^[，,；;：:\s]+|[，,；;：:\s]+$/g, ''),
    )
  }

  function isDigitalReelUi(...values) {
    return values.some((value) => /(?:老虎机|数字转轴|slot(?:\s+machine)?|spin|reel|wild|scatter|jackpot)/i.test(cleanText(value)))
  }

  function trustedStateContentLock(state = {}) {
    const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {}
    const sourcePrompt = cleanText(source.localUiContentLockSourcePrompt)
    const rawLock = source.localUiContentLock
    const director = localDirectorApi()
    if (
      !sourcePrompt
      || !rawLock
      || typeof rawLock !== 'object'
      || Array.isArray(rawLock)
      || typeof director?.compactFingerprint !== 'function'
      || typeof director?.normalizeContentLock !== 'function'
      || typeof director?.hasContentLock !== 'function'
    ) return null
    const expectedFingerprint = director.compactFingerprint(sourcePrompt)
    if (cleanText(rawLock.sourceFingerprint) !== expectedFingerprint) return null
    const normalized = director.normalizeContentLock(rawLock, sourcePrompt)
    return director.hasContentLock(normalized) ? normalized : null
  }

  function trustedStateContentLockPrompt(state = {}) {
    const director = localDirectorApi()
    const lock = trustedStateContentLock(state)
    return lock && typeof director?.contentLockPromptFromContract === 'function'
      ? cleanText(director.contentLockPromptFromContract(lock))
      : ''
  }

  function finiteNumber(value) {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function positiveInteger(value, fallback) {
    const number = finiteNumber(value)
    return number != null && number > 0 ? Math.max(1, Math.round(number)) : fallback
  }

  function normalizeProvider(value) {
    const models = root && root.NovaFlowArtGenerateModels
    if (models && typeof models.normalizeProvider === 'function') return models.normalizeProvider(value)
    const provider = cleanText(value).toLowerCase()
    return provider === 'gpt' || provider === 'google' ? provider : 'local'
  }

  // Local UI design runs on Qwen-Image-2.1 everywhere, on the local assistant and on the shared
  // pool alike: one layout (ten references, a real negative prompt). A node without 2.1 fails the
  // run with a clear error rather than drawing a smaller layout.
  function localQwen21Available() {
    return true
  }

  async function refreshLocalQwen21Available() {
    return true
  }

  function providerCapability(provider, options = {}) {
    const normalized = normalizeProvider(provider)
    if (normalized !== 'local') return referenceLimits[normalized]
    const qwen21 = typeof options.qwen21 === 'boolean' ? options.qwen21 : localQwen21Available()
    return qwen21 ? referenceLimits.localQwen21 : referenceLimits.local
  }

  function providerTitle(provider) {
    const normalized = normalizeProvider(provider)
    if (normalized === 'gpt') return 'GPT'
    if (normalized === 'google') return 'Google'
    return '本地模型'
  }

  function normalizeReferenceRole(value) {
    const role = cleanText(value).toLowerCase().replace(/[\s_]+/g, '-')
    if (/^(style|visual-style|风格)$/.test(role)) return 'style'
    if (/^(character|role|角色)$/.test(role)) return 'character'
    if (/^(subject|identity|主体)$/.test(role)) return 'subject'
    if (/^(material|texture|材质)$/.test(role)) return 'material'
    if (/^(color|palette|配色|色彩)$/.test(role)) return 'color'
    if (/^(layout|ui-layout|ui_layout|布局)$/.test(role)) return 'layout'
    if (/^(content|asset|素材|内容)$/.test(role)) return 'content'
    return 'reference'
  }

  function normalizeReference(value, fallbackName) {
    if (!value) return null
    if (typeof value === 'string') {
      const dataUrl = value.trim()
      return dataUrl ? { name: fallbackName, dataUrl, role: 'reference' } : null
    }
    if (typeof value !== 'object') return null
    const dataUrl = cleanText(value.dataUrl || value.imageUrl || value.url || value.src)
    if (!dataUrl) return null
    return {
      name: cleanText(value.name || value.fileName || value.filename) || fallbackName,
      dataUrl,
      role: normalizeReferenceRole(value.role || value.referenceRole || value.kind || value.type),
      treatment: cleanText(value.treatment),
      sourceId: cleanText(value.sourceId || value.resourceId || value.id),
      ...(value.uiLayoutId ? { uiLayoutId: cleanText(value.uiLayoutId) } : {}),
      ...(value.uiStructure ? { uiStructure: value.uiStructure } : {}),
      targetNodeId: cleanText(value.targetNodeId || value.targetId),
      connectionKind: cleanText(value.connectionKind || value.edgeKind),
      width: positiveInteger(value.width ?? value.w, 0),
      height: positiveInteger(value.height ?? value.h, 0),
    }
  }

  function externalReferences(refs) {
    return (Array.isArray(refs) ? refs : [])
      .map((item, index) => normalizeReference(item, `ui_reference_${index + 1}.png`))
      .filter(Boolean)
  }

  function externalReferenceSnapshot(refs) {
    return Object.freeze(externalReferences(refs).map((reference) => Object.freeze({ ...reference })))
  }

  function localPrimaryReferencePlan(refs, canvas = {}, intent = '') {
    const references = (Array.isArray(refs) ? refs : []).map((reference) => ({ ...reference }))
    const none = (strategy = 'none') => Object.freeze({
      references: Object.freeze(references),
      applied: false,
      strategy,
      referenceIndex: -1,
      name: '',
      sourceId: '',
    })
    if (cleanText(intent).toLowerCase() !== 'redesign') return none('not-redesign')
    const explicitIndex = references.findIndex((reference) => normalizeReferenceRole(reference.role) === 'layout')
    if (explicitIndex >= 0) {
      return Object.freeze({
        references: Object.freeze(references),
        applied: false,
        strategy: 'explicit-layout',
        referenceIndex: explicitIndex,
        name: cleanText(references[explicitIndex].name),
        sourceId: cleanText(references[explicitIndex].sourceId),
      })
    }
    const candidates = references
      .map((reference, index) => ({ reference, index }))
      .filter(({ reference }) => normalizeReferenceRole(reference.role) === 'reference')
    if (!candidates.length) return none('no-general-reference')

    const primary = candidates[0]
    references[primary.index] = {
      ...primary.reference,
      autoPrimary: true,
      roleSource: 'auto-general-reference',
    }
    return Object.freeze({
      references: Object.freeze(references),
      applied: true,
      strategy: 'connection-order',
      referenceIndex: primary.index,
      name: cleanText(primary.reference.name),
      sourceId: cleanText(primary.reference.sourceId),
    })
  }

  function localReferenceSynthesisSelection(refs, primaryReferencePlan = null, intent = '') {
    const references = (Array.isArray(refs) ? refs : []).map((reference) => ({ ...reference }))
    const redesignWithAutomaticPrimary = cleanText(intent).toLowerCase() === 'redesign'
      && primaryReferencePlan?.applied === true
    if (!redesignWithAutomaticPrimary) {
      return Object.freeze({
        references: Object.freeze(references),
        analysisOnlyReferences: Object.freeze([]),
        analysisOnlyReferenceIndexes: Object.freeze([]),
        applied: false,
        strategy: 'all-role-bearing-references',
      })
    }
    const synthesisReferences = []
    const analysisOnlyReferences = []
    references.forEach((reference, fallbackIndex) => {
      const isSupportingGeneralReference = normalizeReferenceRole(reference.role) === 'reference'
        && reference.autoPrimary !== true
      if (isSupportingGeneralReference) {
        analysisOnlyReferences.push(reference)
      } else {
        synthesisReferences.push(reference)
      }
    })
    synthesisReferences.sort((left, right) => (
      Number(right?.autoPrimary === true) - Number(left?.autoPrimary === true)
    ))
    return Object.freeze({
      references: Object.freeze(synthesisReferences),
      analysisOnlyReferences: Object.freeze(analysisOnlyReferences),
      analysisOnlyReferenceIndexes: Object.freeze(analysisOnlyReferences.map((reference) => (
        Number.isInteger(reference.index) && reference.index >= 0
          ? reference.index
          : references.indexOf(reference)
      ))),
      applied: analysisOnlyReferences.length > 0,
      strategy: analysisOnlyReferences.length > 0
        ? 'primary-raw-supporting-general-director-only'
        : 'single-general-primary',
    })
  }

  async function promoteSupportingMaterialReference(primaryReferencePlan, referenceWorkflow, options = {}) {
    const plan = primaryReferencePlan && typeof primaryReferencePlan === 'object'
      ? primaryReferencePlan
      : null
    const references = Array.isArray(plan?.references)
      ? plan.references.map((reference) => ({ ...reference }))
      : []
    if (plan?.applied !== true || references.length < 2) return plan
    const supportingIndex = references.findIndex((reference, index) => (
      index !== plan.referenceIndex
      && normalizeReferenceRole(reference.role) === 'reference'
      && reference.autoPrimary !== true
    ))
    if (supportingIndex < 0) return plan
    const transformer = typeof options.transformer === 'function'
      ? options.transformer
      : referenceWorkflow?.createMaterialProxy
    if (typeof transformer !== 'function') return plan
    const entry = references[supportingIndex]
    const transformed = await transformer(entry, Object.freeze({
      mode: 'redesign',
      index: Number.isInteger(entry.index) ? entry.index : supportingIndex,
      treatment: 'guidance',
      purpose: 'automatic-supporting-material-proxy',
      sampleMaxEdge: 192,
      outputMaxEdge: 720,
      sourceFingerprint: cleanText(entry.sourceFingerprint),
    }))
    const dataUrl = cleanText(transformed?.dataUrl || transformed?.imageUrl || transformed?.url || transformed?.src)
    if (!dataUrl) throw new Error('本地 UI 材质参考代理生成失败')
    references[supportingIndex] = Object.freeze({
      ...entry,
      name: cleanText(transformed?.name || transformed?.fileName || entry.name),
      dataUrl,
      width: positiveInteger(transformed?.width, entry.width),
      height: positiveInteger(transformed?.height, entry.height),
      role: 'material',
      treatment: 'guidance',
      roleSource: 'auto-supporting-material-proxy',
      proxyEncoding: cleanText(transformed?.proxyEncoding) || 'material-proxy-raster-v2',
      proxyKind: cleanText(transformed?.proxyKind) || 'material',
      frequencyBand: cleanText(transformed?.frequencyBand) || 'mid',
      identityReduced: transformed?.identityReduced !== false,
      sourceFingerprint: cleanText(transformed?.sourceFingerprint || entry.sourceFingerprint),
      proxyCacheKey: cleanText(transformed?.proxyCacheKey),
      transformed: true,
    })
    return Object.freeze({
      ...plan,
      references: Object.freeze(references.map((reference) => Object.freeze({ ...reference }))),
      supportingMaterialReferenceIndex: supportingIndex,
      supportingMaterialProxyEncoding: references[supportingIndex].proxyEncoding,
    })
  }

  function sourceAlignedModelImageNumbers(sourceRefs, modelRefs, modelImageNumbers) {
    const sources = Array.isArray(sourceRefs) ? sourceRefs : []
    const models = Array.isArray(modelRefs) ? modelRefs : []
    const imageNumbers = Array.isArray(modelImageNumbers) ? modelImageNumbers : []
    if (sources === models || (sources.length === models.length && models.every((reference, index) => reference === sources[index]))) {
      return Object.freeze(sources.map((reference, index) => positiveInteger(imageNumbers[index], 0)))
    }
    const mapped = new Map()
    models.forEach((reference, modelIndex) => {
      const sourceIndex = Number.isInteger(reference?.index) && reference.index >= 0
        ? reference.index
        : sources.findIndex((source) => (
            (cleanText(reference?.sourceId) && cleanText(source?.sourceId) === cleanText(reference.sourceId))
            || (
              cleanText(source?.name) === cleanText(reference?.name)
              && cleanText(source?.dataUrl) === cleanText(reference?.dataUrl)
            )
          ))
      if (sourceIndex >= 0) mapped.set(sourceIndex, positiveInteger(imageNumbers[modelIndex], 0))
    })
    return Object.freeze(sources.map((reference, index) => positiveInteger(mapped.get(index), 0)))
  }

  function synthesisReferencePlan(options = {}) {
    const provider = normalizeProvider(options.provider)
    const intent = cleanText(options.intent).toLowerCase()
    const layoutGuide = options.layoutGuide || null
    const modelRefs = Array.isArray(options.modelRefs) ? options.modelRefs : []
    const primaryReferencePlan = options.primaryReferencePlan || null
    const guideLast = provider === 'local'
      && intent === 'redesign'
      && primaryReferencePlan?.applied === true
      && modelRefs.length > 0
    const references = guideLast
      ? [...modelRefs, layoutGuide]
      : [layoutGuide, ...modelRefs]
    const externalModelImageNumbers = modelRefs.map((reference, index) => (
      guideLast ? index + 1 : index + 2
    ))
    const layoutGuideIndex = guideLast ? modelRefs.length : 0
    const automaticPrimaryIndex = modelRefs.findIndex((reference) => reference?.autoPrimary === true)
    const declaredPrimaryIndex = primaryReferencePlan?.referenceIndex >= 0
      ? modelRefs.findIndex((reference, index) => (
          (Number.isInteger(reference?.index) && reference.index === primaryReferencePlan.referenceIndex)
          || (
            !Number.isInteger(reference?.index)
            && index === primaryReferencePlan.referenceIndex
          )
        ))
      : -1
    const primaryModelReferenceIndex = automaticPrimaryIndex >= 0
      ? automaticPrimaryIndex
      : declaredPrimaryIndex
    const primaryModelImageNumber = primaryModelReferenceIndex >= 0
      ? positiveInteger(externalModelImageNumbers[primaryModelReferenceIndex], 0)
      : 0
    return Object.freeze({
      references: Object.freeze(references),
      externalModelImageNumbers: Object.freeze(externalModelImageNumbers),
      layoutGuideIndex,
      layoutGuideImageNumber: layoutGuideIndex + 1,
      primaryModelReferenceIndex,
      primaryModelImageNumber,
      guideLast,
    })
  }

  function compileUiMentions(value, refs, options = {}) {
    const sourceText = String(value == null ? '' : value)
    const references = Array.isArray(refs) ? refs : []
    const analysisOnly = options.analysisOnly === true
    const analysisOnlyReferenceIndexes = new Set(
      (Array.isArray(options.analysisOnlyReferenceIndexes) ? options.analysisOnlyReferenceIndexes : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0),
    )
    const analysisOnlyReplacement = cleanText(options.analysisOnlyReplacement)
    const invalidTokens = []
    const invalidSet = new Set()
    const mentions = []
    const analysisOnlyMentions = []
    const text = sourceText.replace(/@参考图([1-9][0-9]*)/g, (token, rawIndex) => {
      const referenceIndex = Number(rawIndex) - 1
      const reference = references[referenceIndex]
      if (!reference) {
        if (!invalidSet.has(token)) {
          invalidSet.add(token)
          invalidTokens.push(token)
        }
        return token
      }
      if (analysisOnly || analysisOnlyReferenceIndexes.has(referenceIndex)) {
        analysisOnlyMentions.push(Object.freeze({
          token,
          referenceIndex,
          sourceId: cleanText(reference.sourceId),
        }))
        if (analysisOnly) {
          return analysisOnlyReplacement || `所选参考图${referenceIndex + 1}的视觉方向`
        }
        return analysisOnlyReplacement || '辅助参考图分析得到的构图、材质与商业完成度约束'
      }
      const mappedImageNumber = Array.isArray(options.modelImageNumbers)
        ? positiveInteger(options.modelImageNumbers[referenceIndex], 0)
        : 0
      const modelImageNumber = mappedImageNumber || referenceIndex + 2
      // Qwen-Image-2.1 names its references <imageN>; the 2511 and cloud prompts say 图N.
      const modelLabel = options.imageToken === 'angle' ? `<image${modelImageNumber}>` : `图${modelImageNumber}`
      mentions.push(Object.freeze({
        token,
        referenceIndex,
        modelImageNumber,
        modelLabel,
        sourceId: cleanText(reference.sourceId),
      }))
      return modelLabel
    })
    return Object.freeze({
      text,
      mentions: Object.freeze(mentions),
      analysisOnlyMentions: Object.freeze(analysisOnlyMentions),
      invalidTokens: Object.freeze(invalidTokens),
    })
  }

  function assertValidUiMentions(compiled) {
    const invalidTokens = Array.isArray(compiled?.invalidTokens) ? compiled.invalidTokens : []
    if (!invalidTokens.length) return compiled
    throw new Error(`以下参考图引用无效或未连接：${invalidTokens.join('、')}。请重新选择 @参考图。`)
  }

  function assertStableUiMentionBindings(value, refs, bindings) {
    const sourceText = String(value == null ? '' : value)
    const references = Array.isArray(refs) ? refs : []
    const stored = bindings && typeof bindings === 'object' && !Array.isArray(bindings) ? bindings : {}
    const changed = []
    const seen = new Set()
    const expression = /@参考图([1-9][0-9]*)/g
    let match
    while ((match = expression.exec(sourceText))) {
      const token = match[0]
      if (seen.has(token)) continue
      seen.add(token)
      const reference = references[Number(match[1]) - 1]
      const expectedSourceId = cleanText(stored[token])
      const currentSourceId = cleanText(reference?.sourceId)
      if (!expectedSourceId || !currentSourceId || expectedSourceId !== currentSourceId) changed.push(token)
    }
    if (changed.length) {
      throw new Error(`${changed.join('、')} 原绑定已变化，请删除该引用后，通过 @ 菜单重新选择参考图。`)
    }
    return true
  }

  function validateExternalReferenceCount(provider, refs, capability = providerCapability(provider)) {
    if (refs.length <= capability.externalReferenceLimit) return capability
    throw new Error(
      `${providerTitle(provider)} 最多支持 ${capability.externalReferenceLimit} 张外部参考图` +
      (capability.reservedLayoutReferences ? `（另保留 ${capability.reservedLayoutReferences} 张页面结构控制图）` : '') +
      `，当前已连接 ${refs.length} 张`,
    )
  }

  function layoutGuideApi() {
    return root && root.NovaFlowUiDesignLayoutGuide
  }

  function localWorkflowApi() {
    return root && root.NovaFlowUiDesignLocalWorkflow
  }

  function localReferenceApi() {
    return root && root.NovaFlowUiDesignLocalReference
  }

  function localDirectorApi() {
    return root && root.NovaFlowUiDesignLocalDirectorWorkflow
  }

  function legacyGuideName(project, options) {
    const candidates = [
      options?.layoutGuide,
      project?.layoutGuide,
      options?.skeleton,
      options?.skeletonReference,
      project?.skeleton,
      project?.skeletonReference,
    ]
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue
      const name = cleanText(candidate.name || candidate.fileName || candidate.filename)
      if (name) return /\.png$/i.test(name) ? name : `${name}.png`
    }
    return 'ui_layout_guide.png'
  }

  function fallbackSemanticLayout(project, state) {
    const canvas = projectCanvas(project)
    if (!canvas.width) canvas.width = positiveInteger(state?.width, 1920)
    if (!canvas.height) canvas.height = positiveInteger(state?.height, 1080)
    return {
      schemaVersion: 1,
      kind: 'ui-layout-semantic',
      name: cleanText(project?.name || project?.title || project?.projectName),
      description: cleanText(project?.description || project?.brief || project?.summary),
      requirement: cleanText(project?.requirement || project?.requirements || project?.generateRequirement || project?.prompt),
      canvas,
      regions: projectBlocks(project).map((block, index) => ({
        id: cleanText(block.id) || `region_${index + 1}`,
        name: cleanText(block.name || block.title || block.label) || `区块 ${index + 1}`,
        role: cleanText(block.role || block.kind || block.type) || 'region',
        purpose: cleanText(block.purpose || block.description || block.summary),
        requirements: cleanText(block.requirements || block.requirement || block.prompt),
      })),
    }
  }

  function resolveSemanticLayout(project, options, state) {
    const helper = layoutGuideApi()
    const source = options?.semanticLayout && typeof options.semanticLayout === 'object'
      ? options.semanticLayout
      : project
    if (typeof helper?.compileSemanticLayout === 'function') {
      return helper.compileSemanticLayout(source, {
        width: positiveInteger(state?.width, projectCanvas(project).width || 1920),
        height: positiveInteger(state?.height, projectCanvas(project).height || 1080),
      })
    }
    return fallbackSemanticLayout(project, state)
  }

  function cleanGuideCandidate(value, visualEncoding = '') {
    if (!value || typeof value !== 'object') return null
    const helper = layoutGuideApi()
    const helperAccepted = typeof helper?.isCleanLayoutGuide === 'function' && helper.isCleanLayoutGuide(value)
    if (!helperAccepted && (
      value.kind !== 'ui-layout-guide'
      || value.role !== 'ui_layout'
      || value.clean !== true
      || value.editorSnapshot !== false
    )) return null
    const expectedEncoding = cleanText(visualEncoding)
    if (expectedEncoding && cleanText(value.visualEncoding) !== expectedEncoding) return null
    return /^data:image\/png;base64,/i.test(cleanText(value.dataUrl)) ? value : null
  }

  function resolveCleanLayoutGuide(project, options, state, semanticLayout, visualEncoding = '') {
    const expectedEncoding = cleanText(visualEncoding)
    const supplied = cleanGuideCandidate(options?.layoutGuide, expectedEncoding)
      || cleanGuideCandidate(project?.layoutGuide, expectedEncoding)
    if (supplied) {
      return {
        ...supplied,
        name: cleanText(supplied.name) || legacyGuideName(project, options),
        width: positiveInteger(supplied.width, semanticLayout.canvas.width),
        height: positiveInteger(supplied.height, semanticLayout.canvas.height),
      }
    }
    const helper = layoutGuideApi()
    if (typeof helper?.createCleanLayoutGuide === 'function') {
      const guideOptions = {
        name: legacyGuideName(project, options),
        width: semanticLayout.canvas.width,
        height: semanticLayout.canvas.height,
      }
      if (expectedEncoding) guideOptions.visualEncoding = expectedEncoding
      if (expectedEncoding === SOFT_UI_SEMANTIC_SCAFFOLD_ENCODING) {
        guideOptions.semanticSubgrid = true
        guideOptions.semanticText = cleanText(
          options?.prompt
          || state?.prompt
          || project?.requirement
          || project?.requirements,
        )
      }
      const guide = helper.createCleanLayoutGuide(semanticLayout, guideOptions)
      if (expectedEncoding && cleanText(guide?.visualEncoding) !== expectedEncoding) {
        throw new Error(`UI layout guide helper did not produce ${expectedEncoding}`)
      }
      return guide
    }
    if (expectedEncoding) {
      throw new Error(`UI layout guide helper is required to produce ${expectedEncoding}`)
    }
    throw new Error('UI 布局图生成组件未就绪，请先生成有效布局参考图片；本次未提交生成')
  }

  function projectCanvas(project) {
    const source = project?.canvas || project?.artboard || project?.size || project?.document || {}
    return {
      width: positiveInteger(source.width ?? source.w ?? project?.width, 0),
      height: positiveInteger(source.height ?? source.h ?? project?.height, 0),
    }
  }

  function projectBlocks(project) {
    const graphNodes = Array.isArray(project?.graph?.nodes) ? project.graph.nodes : []
    const graphBlocks = []
    for (const node of graphNodes) {
      if (!node || typeof node !== 'object') continue
      const type = cleanText(node.type || node.kind || node.nodeType).toLowerCase().replace(/[\s_]+/g, '-')
      if (!['layout', 'ui-layout', 'layout-node', 'structure'].includes(type)) continue
      const source = node.data?.blocks || node.data?.layout?.blocks || node.layout?.blocks || node.blocks
      if (Array.isArray(source)) graphBlocks.push(...source)
    }
    if (Number(project?.graph?.schemaVersion) >= 2 && graphBlocks.length) {
      return graphBlocks.filter((item) => item && typeof item === 'object')
    }
    const candidates = project?.blocks || project?.layout?.blocks || project?.structure?.blocks || project?.geometry?.blocks
    if (Array.isArray(candidates)) return candidates.filter((item) => item && typeof item === 'object')
    return graphBlocks.filter((item) => item && typeof item === 'object')
  }

  function canvasOrientation(canvas) {
    if (!(canvas?.width > 0) || !(canvas?.height > 0)) return ''
    const ratio = canvas.width / Math.max(1, canvas.height)
    if (ratio > 1.2) return '横向全屏游戏界面'
    if (ratio < 0.83) return '竖向全屏游戏界面'
    return '方形游戏界面'
  }

  function semanticRoleInstruction(value) {
    const role = cleanText(value).toLowerCase().replace(/[\s_]+/g, '-')
    const labels = {
      navigation: '承载主要导航功能',
      nav: '承载主要导航功能',
      header: '承载顶部信息与导航功能',
      hero: '承载核心视觉与主题信息',
      content: '承载主要内容',
      action: '承载主要操作',
      cta: '承载主要操作',
      footer: '承载底部辅助功能',
      toolbar: '承载工具操作',
      panel: '承载对应功能内容',
    }
    return labels[role] || ''
  }

  function referenceInstruction(reference, imageNumber, options = {}) {
    if (cleanText(reference?.treatment).toLowerCase() === 'base') {
      return `图${imageNumber}（唯一修改底图）：保留用户未要求改变的界面内容、主体身份与整体连续性，只执行补充要求指定的修改；不得把其他参考图的主题、文字、Logo、角色或布局覆盖到底图。`
    }
    const role = normalizeReferenceRole(reference?.role)
    if (role === 'reference' && reference?.autoPrimary === true) {
      const layoutGuideImageNumber = positiveInteger(options.layoutGuideImageNumber, 1)
      return `Image ${imageNumber} is the primary composite visual reference and the binding visual base for this redesign. Preserve its screen composition, major section proportions, information hierarchy, spacing rhythm, asset density, repeated-item relationships and commercial finish inside the semantic region contract. The user's explicit target owns theme, subject identity, required copy, controls and counts, so replace conflicting reference content without discarding the reference's layout value. Image ${layoutGuideImageNumber} supplies only high-level region envelopes and must never override or become visible artwork inside this primary composition.`
    }
    if (role === 'layout') {
      return `Image ${imageNumber} is the binding layout reference. Preserve its major section positions, relative proportions, content grouping, repeated-item counts, information hierarchy and control placement unless the user's explicit requirement changes one of them. Replace its theme identity, characters, logos and copy only where required by the user; do not reduce it to a vague style cue.`
    }
    if (role === 'reference') {
      return `Image ${imageNumber} is a supporting composite visual reference. It must materially influence composition balance, content grouping, spacing rhythm, asset density, repeated-item relationships, materials and commercial finish within the user's declared content and semantic page structure. Never replace the user's theme or subject identity, never add undeclared sections or counts, and defer only to a specialized reference that explicitly owns the same visual attribute.`
    }
    const titles = {
      style: '风格参考',
      character: '角色参考',
      subject: '主体参考',
      material: '材质参考',
      color: '配色参考',
      layout: '辅助布局参考',
      content: '内容素材参考',
      reference: '视觉参考',
    }
    const labels = {
      style: '仅提取视觉风格、质感和设计语言，不复制其布局',
      character: '仅保持角色身份与外观特征，不复制其背景和布局',
      subject: '仅保持主体身份与核心设计，不复制其布局',
      material: '仅参考材质与纹理表现，不复制其构图',
      color: '仅参考色彩关系与明暗层级，不复制其构图',
      layout: '仅作为辅助布局参考，最终以页面区块语义为准',
      content: '仅作为界面内容素材来源，不得覆盖页面结构',
      reference: '仅作为指定视觉参考，不得覆盖页面结构',
    }
    return `图${imageNumber}（${titles[role] || titles.reference}）：${labels[role] || labels.reference}。`
  }

  function compilePromptFromReferences(project = {}, references = [], semanticInput = null, options = {}) {
    const rawDescription = cleanText(project.description || project.brief || project.summary)
    const style = cleanText(project.style || project.visualStyle || project.stylePrompt)
    const rawRequirement = cleanText(project.requirement || project.requirements || project.generateRequirement || project.prompt)
    const canvas = projectCanvas(project)
    const semantic = semanticInput && typeof semanticInput === 'object' ? semanticInput : null
    const blocks = Array.isArray(semantic?.regions) ? semantic.regions : projectBlocks(project)
    const carrierIntent = cleanText(options.carrierIntent).toLowerCase() === 'hardware'
      ? 'hardware'
      : resolveUiOutputCarrier(
          options.userPrompt,
          rawDescription,
          rawRequirement,
          semantic?.description,
          semantic?.requirement,
          ...blocks.flatMap((block) => [block?.purpose, block?.description, block?.requirements, block?.requirement, block?.prompt]),
        )
    const description = normalizeScreenNativeUiText(rawDescription, carrierIntent)
    const requirement = normalizeScreenNativeUiText(rawRequirement, carrierIntent)
    const digitalReelUi = carrierIntent === 'screen' && isDigitalReelUi(
      options.userPrompt,
      rawDescription,
      rawRequirement,
      semantic?.description,
      semantic?.requirement,
      ...blocks.flatMap((block) => [block?.purpose, block?.description, block?.requirements, block?.requirement, block?.prompt]),
    )
    const softLayout = ['local', 'google'].includes(normalizeProvider(options.provider))
      && cleanText(options.layoutGuideEncoding) === SOFT_LAYOUT_GUIDE_ENCODING
    const semanticScaffold = normalizeProvider(options.provider) === 'local'
      && cleanText(options.layoutGuideEncoding) === SOFT_UI_SEMANTIC_SCAFFOLD_ENCODING
    const textSemanticLayout = semanticScaffold && options.textOnlyLayout === true
    const enforceDigitalCanvas = carrierIntent === 'screen'
    const layoutGuideImageNumber = positiveInteger(options.layoutGuideImageNumber, 1)
    const referenceImageNumbers = Array.isArray(options.referenceImageNumbers)
      ? options.referenceImageNumbers
      : []
    const lines = ['Create one complete, polished, review-ready UI design following the requested product and style.']
    if (enforceDigitalCanvas) lines.push(...DIGITAL_UI_CANVAS_CONTRACT)
    if (digitalReelUi) lines.push(...DIGITAL_REEL_UI_CONTRACT)
    if (options.hasLayout === false) {
      lines.push('Arrange the UI from the user requirements and any explicitly designated layout reference. No generated layout guide is supplied.')
    } else if (textSemanticLayout) {
      lines.push(
        'There is no visual layout reference in this synthesis pass. Build the interface directly from the semantic region requirements below.',
        'Treat region order, relative coverage, required item counts and functional groups as a layout contract, while inventing all finished shapes, materials and styling.',
        'Never render semantic descriptions, guide marks, annotation boxes, editor chrome or structural rectangles as visible content.',
      )
    } else if (semanticScaffold) {
      lines.push(
        `Image ${layoutGuideImageNumber} is a soft, theme-neutral semantic UI scaffold, not source artwork. Its blurred abstract marks communicate required functional groups, relative positions, item counts, ordering and whitespace.`,
        'Read elongated soft marks only as text or information occupancy, round soft marks only as action or focal occupancy, and repeated soft centers only as required repeated-item count. Invent all finished shapes, materials and styling from the written requirements.',
        'Never trace, sharpen, outline, color-match, decorate or materialize any scaffold mark. A mark never implies a card, frame, panel, halo, border, container or background band.',
      )
    } else if (softLayout) {
      lines.push(
        `Image ${layoutGuideImageNumber} is a soft, low-frequency spatial occupancy guide. It communicates only region centers, relative coverage, ordering and whitespace; it is not visible UI artwork.`,
        `Read only the centers, relative coverage, ordering and whitespace of the soft zones in image ${layoutGuideImageNumber}. Never trace, sharpen, outline, color-match or materialize their contours.`,
        'The presence of a region does not imply a card, frame, panel, halo, border, container or background band.',
      )
    } else {
      lines.push(
        `Image ${layoutGuideImageNumber} is a clean geometry guide. It communicates only region placement, hierarchy and whitespace; it contains no copy, borders, ports or editor controls to reproduce.`,
        `Follow the relative layout in image ${layoutGuideImageNumber}, but turn every guide shape into finished visual content instead of drawing annotation rectangles.`,
      )
    }

    const effectiveDescription = description || cleanText(semantic?.description)
    const effectiveRequirement = requirement || cleanText(semantic?.requirement)
    const effectiveCanvas = semantic?.canvas && typeof semantic.canvas === 'object' ? semantic.canvas : canvas
    const orientation = canvasOrientation(effectiveCanvas)
    if (orientation) lines.push(`采用${orientation}构图。`)
    if (effectiveDescription) lines.push(`整体视觉围绕${effectiveDescription}展开，但不要直接排印这段说明。`)
    if (effectiveRequirement) lines.push(`设计时满足${effectiveRequirement}，不得把这句话作为界面文案。`)

    if (blocks.length) {
      lines.push('Use the following ideas only to choose visual content. Never quote, list or typeset their wording.')
      blocks.forEach((block) => {
        const purpose = normalizeScreenNativeUiText(block.purpose || block.description, carrierIntent)
          || semanticRoleInstruction(block.role)
          || '按照布局结构完成对应界面内容'
        const blockRequirement = normalizeScreenNativeUiText(
          block.requirements || block.requirement || block.prompt,
          carrierIntent,
        )
        const requirementText = blockRequirement ? `，同时满足${blockRequirement}` : ''
        lines.push(textSemanticLayout
          ? `A required region serves ${purpose}${requirementText}. Preserve its functional group, relative order and required item count, but design every final shape, material and ornament from scratch.`
          : semanticScaffold
          ? `一个区域用于${purpose}${requirementText}；只从图${layoutGuideImageNumber}读取功能组、相对位置、数量、顺序和留白；必须重新设计所有最终形状、材质和装饰，不得实体化任何柔性标记。`
          : softLayout
          ? `一个区域用于${purpose}${requirementText}；只参考图${layoutGuideImageNumber}中的区域中心、相对覆盖、顺序和留白；区域存在不代表卡片、边框、面板、光圈、容器或背景色带。`
          : `一个区域用于${purpose}${requirementText}；其位置、尺度和留白只以图${layoutGuideImageNumber}为准。`)
      })
    }
    if (style) lines.push(`整体采用${style}的视觉风格，但不要把风格描述作为文字。`)

    references.forEach((reference, index) => lines.push(referenceInstruction(
      reference,
      positiveInteger(referenceImageNumbers[index], 0) || index + 2,
      { layoutGuideImageNumber },
    )))

    lines.push('Keep one coherent design system with clear hierarchy and readable controls. Output only the finished UI artwork. Never render prompt wording, metadata, resolution values, dimensions, percentages, coordinates, region descriptions, guide shapes, annotation boxes, connection lines, ports, selections or editor guides.')
    // The shared img2img promptLine node treats every non-empty line as a
    // separate batch item. Preserve section boundaries without multiplying
    // a single UI design request into several generated images.
    return lines.join('； ')
  }

  function compilePrompt(project = {}, refs = [], semanticInput = null, options = {}) {
    return compilePromptFromReferences(project, externalReferences(refs), semanticInput, options)
  }

  function localTxt2ImgTarget(value, carrierIntent = 'screen') {
    const source = normalizeScreenNativeUiText(
      cleanText(value).replace(/@参考图\d+/gi, ''),
      carrierIntent,
    )
    if (!source) return ''
    const parts = source.split(/([。！？!?；;]+)/)
    const kept = []
    for (let index = 0; index < parts.length; index += 2) {
      let clause = cleanText(parts[index])
      const punctuation = cleanText(parts[index + 1])
      if (!clause) continue
      if (/(?:参考|参照).*(?:图|图片|成品)/.test(clause)) {
        const designMatch = clause.match(/(?:重新设计|设计|生成|创建|制作)/)
        if (designMatch && Number.isFinite(designMatch.index)) {
          clause = clause.slice(designMatch.index)
        } else if (/(?:只提供|仅提供|仅用于|只用于|不复制|不要复制|不得复制|禁止复制|避免复制|照搬|复刻|提取|取材)/.test(clause)) {
          continue
        }
      }
      if (clause) kept.push(`${clause}${punctuation}`)
    }
    return cleanText(kept.join(' ')) || cleanText(source)
  }

  function compileLocalTxt2ImgPrompt(options = {}) {
    const project = options.project && typeof options.project === 'object' ? options.project : {}
    const semantic = options.semantic && typeof options.semantic === 'object' ? options.semantic : {}
    const canvas = semantic.canvas && typeof semantic.canvas === 'object'
      ? semantic.canvas
      : projectCanvas(project)
    const width = positiveInteger(canvas.width, 1080)
    const height = positiveInteger(canvas.height, 1920)
    const orientation = width > height
      ? 'Landscape full-screen composition.'
      : width < height
        ? 'Portrait full-screen composition.'
        : 'Square full-screen composition.'
    const rawUserPrompt = options.userPrompt
      || project.requirement
      || project.requirements
      || project.generateRequirement
      || project.prompt
    const rawFallbackDescription = project.description
      || project.brief
      || project.summary
      || semantic.description
    const regions = Array.isArray(semantic.regions) ? semantic.regions : projectBlocks(project)
    const carrierIntent = cleanText(options.carrierIntent).toLowerCase() === 'hardware'
      ? 'hardware'
      : resolveUiOutputCarrier(
          rawUserPrompt,
          rawFallbackDescription,
          semantic.requirement,
          ...regions.flatMap((region) => [region?.purpose, region?.description, region?.requirements, region?.requirement, region?.prompt]),
        )
    const userTarget = localTxt2ImgTarget(
      rawUserPrompt,
      carrierIntent,
    )
    const fallbackDescription = localTxt2ImgTarget(
      rawFallbackDescription,
      carrierIntent,
    )
    const regionContracts = regions.map((region, index) => {
      const purpose = normalizeScreenNativeUiText(region?.purpose || region?.description, carrierIntent)
        || semanticRoleInstruction(region?.role)
        || '完成对应界面功能'
      const requirement = normalizeScreenNativeUiText(
        region?.requirements || region?.requirement || region?.prompt,
        carrierIntent,
      )
      return `Region ${index + 1}: ${purpose}${requirement ? `; ${requirement}` : ''}.`
    })
    const visualStyle = cleanText(options.visualStyle)
      || cleanText(project.style || project.visualStyle || project.stylePrompt)
    const contentLock = normalizeScreenNativeUiText(options.contentLockPrompt, carrierIntent)
    const digitalReelUi = carrierIntent === 'screen' && isDigitalReelUi(
      rawUserPrompt,
      rawFallbackDescription,
      semantic.requirement,
      ...regions.flatMap((region) => [region?.purpose, region?.description, region?.requirements, region?.requirement, region?.prompt]),
    )
    return cleanText([
      carrierIntent === 'screen' ? LOCAL_TXT2IMG_SCREEN_OPENING : '',
      digitalReelUi ? DIGITAL_REEL_UI_CONTRACT.join(' ') : '',
      orientation,
      userTarget ? `User target: ${userTarget}` : '',
      !userTarget && fallbackDescription ? `Page target: ${fallbackDescription}` : '',
      regionContracts.length
        ? `Required screen regions in the structure-defined order: ${regionContracts.join(' ')}`
        : '',
      visualStyle ? `Visual art direction: ${visualStyle}` : '',
      contentLock,
      LOCAL_TXT2IMG_QUALITY_CLOSING,
      carrierIntent === 'screen' ? LOCAL_TXT2IMG_SCREEN_CLOSING : '',
    ].filter(Boolean).join(' '))
  }

  function compactLocalModelText(value, maxChars) {
    const source = cleanText(value).replace(/\s+/g, ' ')
    const limit = Math.max(16, Math.floor(Number(maxChars) || 0))
    if (!source || source.length <= limit) return source
    const segments = source.match(/[^，,、；;。！？.!?]+[，,、；;。！？.!?]*/g) || [source]
    const headBudget = Math.max(8, Math.floor(limit * 0.7))
    const head = []
    const tail = []
    let headLength = 0
    let tailLength = 0
    let firstTailIndex = segments.length
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      if (headLength + segment.length > headBudget && head.length) break
      if (segment.length > limit && !head.length) break
      head.push(segment)
      headLength += segment.length
    }
    for (let index = segments.length - 1; index >= head.length; index -= 1) {
      const segment = segments[index]
      const separatorLength = head.length && !tail.length ? 1 : 0
      if (headLength + tailLength + separatorLength + segment.length > limit) break
      tail.unshift(segment)
      tailLength += segment.length
      firstTailIndex = index
    }
    if (head.length || tail.length) {
      const separator = head.length && tail.length && firstTailIndex > head.length ? '；' : ''
      return `${head.join('')}${separator}${tail.join('')}`.trim()
    }
    const prefix = source.slice(0, limit)
    const boundary = Math.max(
      prefix.lastIndexOf('；'),
      prefix.lastIndexOf('，'),
      prefix.lastIndexOf('、'),
      prefix.lastIndexOf('。'),
      prefix.lastIndexOf(' '),
    )
    return source.slice(0, boundary > 0 ? boundary + 1 : limit).trim()
  }

  function compactLocalRegionLines(lines, maxChars) {
    const entries = (Array.isArray(lines) ? lines : [])
      .map((line, index) => {
        const source = cleanText(line)
        if (!source) return null
        const equalsIndex = source.indexOf('=')
        return {
          prefix: equalsIndex >= 0 ? source.slice(0, equalsIndex + 1) : `R${index + 1}=`,
          body: equalsIndex >= 0 ? source.slice(equalsIndex + 1) : source,
        }
      })
      .filter(Boolean)
    if (!entries.length) return ''

    const limit = Math.max(16, Math.floor(Number(maxChars) || 0))
    const separator = '；'
    const prefixLength = entries.reduce((total, entry) => total + entry.prefix.length, 0)
      + separator.length * Math.max(0, entries.length - 1)
    const prefixes = prefixLength <= limit
      ? entries.map((entry) => entry.prefix)
      : entries.map((entry, index) => `R${index + 1}=`)
    const fixedLength = prefixes.reduce((total, prefix) => total + prefix.length, 0)
      + separator.length * Math.max(0, entries.length - 1)
    const bodyBudget = Math.max(0, limit - fixedLength)
    const baseBudget = Math.floor(bodyBudget / entries.length)
    let remainder = bodyBudget % entries.length
    return entries.map((entry, index) => {
      const budget = baseBudget + (remainder > 0 ? 1 : 0)
      if (remainder > 0) remainder -= 1
      if (!budget) return prefixes[index]
      const body = entry.body.length <= budget
        ? entry.body
        : (
            budget >= 16
              ? compactLocalModelText(entry.body, budget)
              : entry.body.slice(0, budget).trim()
          )
      return `${prefixes[index]}${body}`
    }).join(separator)
  }

  function addLocalPromptAtom(atoms, value, maxLength = 120) {
    const atom = cleanText(value)
      .replace(/^[|、，,；;：:\s]+|[|、，,；;：:\s]+$/g, '')
    if (!atom || atom.length > maxLength) return
    const normalized = atom.toLowerCase()
    if (atoms.some((item) => item.toLowerCase() === normalized)) return
    atoms.push(atom)
  }

  function localPromptAtomIsStructural(value) {
    const atom = cleanText(value)
    if (!atom) return false
    if (/^\d+\s*[×xX*]\s*\d+$/.test(atom)) return true
    if (/^\d+\s*(?:个|名|位|列|行|格|枚|项|buttons?|controls?|icons?|symbols?|items?)$/i.test(atom)) {
      return true
    }
    if (/^\d+\s*(?:个|名|位|枚|项|buttons?|controls?|icons?|symbols?|items?)\s*\S+/i.test(atom)) {
      return true
    }
    const hasStructuralCount = /\d+\s*(?:个|名|位|列|行|格|枚|项|buttons?|controls?|icons?|symbols?|items?)/i.test(atom)
      || /\d+\s*[×xX*]\s*\d+/.test(atom)
    if (!hasStructuralCount) return false
    return /(?:区域|布局|结构|转轴|网格|矩阵|数量|严格|总共|共|恰好|不得|必须)/i.test(atom)
  }

  function localPromptClauseIsVisibleToken(value) {
    const atom = cleanText(value)
    if (!atom || localPromptAtomIsStructural(atom)) return false
    if (/(?:区域|布局|结构|显示|采用|包含|包括|内含|整体|主题|可读性)/i.test(atom)) return false
    if (/^(?:UI|HUD)$/i.test(atom)) return false
    if (/(?:¥|￥|\$)\s*\d+(?:\.\d+)?/.test(atom)) return true
    if (/^[A-Z][A-Z0-9_-]{0,15}$/i.test(atom)) return true
    if (/^(?:WILD|SCATTER|BONUS|WIN|SPIN|AUTO|TURBO|MENU|RECHARGE)$/i.test(atom)) return true
    if (/^(?:返回|返回按钮|后退|后退按钮|自动|极速|快速|充值|菜单|旋转|旋转按钮|开始|开始按钮|声音|音效|帮助|规则|赔付表)$/i.test(atom)) {
      return true
    }
    return atom.length <= 16
      && /(?:按钮|控件|图标|入口|菜单|buttons?|controls?|icons?|entry)$/i.test(atom)
      && !/^(?:操作|功能|全部)?(?:按钮|控件|图标|buttons?|controls?|icons?)$/i.test(atom)
  }

  function compileLocalPromptProtectionLock(options = {}) {
    const atoms = []
    const contentIdentityLock = options.contentIdentityLock
      && typeof options.contentIdentityLock === 'object'
      ? options.contentIdentityLock
      : {}

    const regions = Array.isArray(options.regions) ? options.regions : []
    const regionSources = regions.flatMap((region) => [
        region?.purpose,
        region?.description,
        region?.requirements,
        region?.requirement,
        region?.prompt,
      ]).map(cleanText).filter(Boolean)
    const userSource = cleanText(options.userPrompt)
    const sources = [...regionSources, userSource].filter(Boolean)
    const atomBearingClause = /\b(?:buttons?|controls?|icons?|symbols?|tokens?|reels?|rows?|columns?|exactly|total|balance|credits?|bets?|wagers?|win|spin|menu|auto|autoplay|turbo|recharge)\b|按钮|控件|图标|符号|转轴|列|行|格|恰好|总共|余额|投注|旋转|菜单|自动|充值|极速|WILD|SCATTER|WIN/i
    ;(Array.isArray(contentIdentityLock.exactTokens)
      ? contentIdentityLock.exactTokens
      : []
    ).forEach((item) => {
      if (!localPromptAtomIsStructural(item) && !/^(?:UI|HUD)$/i.test(cleanText(item))) {
        addLocalPromptAtom(atoms, item)
      }
    })
    sources.forEach((source) => {
      for (const match of source.matchAll(/(?:余额|投注(?:金额)?|赢取|WIN)\s*[:：]?\s*(?:¥|￥|\$)\s*\d+(?:\.\d+)?/gi)) {
        addLocalPromptAtom(atoms, match[0].replace(/\s+/g, ''))
      }
      for (const match of source.matchAll(/(?:¥|￥|\$)\s*\d+(?:\.\d+)?/g)) addLocalPromptAtom(atoms, match[0])
      for (const match of source.matchAll(/\b[A-Z][A-Z0-9_-]{1,15}\b/g)) {
        if (!/^(?:UI|HUD)$/i.test(match[0])) addLocalPromptAtom(atoms, match[0])
      }
      for (const match of source.matchAll(/(?:符号(?:包括|包含|为|如)|symbols?\s*(?:include|including|are))([^。；;\n]{2,180})/gi)) {
        match[1]
          .split(/(?:[、，,|｜/]+|以及|和|及|与)/)
          .map(cleanText)
          .forEach((item) => {
            const token = item
              .replace(/^字母/i, '')
              .replace(/(?:标志|符号|图标)$/i, '')
              .trim()
            if (/^(?:wild|scatter|bonus|[AKQJ]|10)$/i.test(token)) {
              addLocalPromptAtom(atoms, token.toUpperCase())
            }
          })
      }
    })
    ;[userSource, ...regionSources].filter(Boolean).forEach((source) => {
      source
        .split(/[，,；;。.!?\r\n]+/)
        .map(cleanText)
        .filter((clause) => clause && atomBearingClause.test(clause))
        .forEach((clause) => {
          clause
            .split(/(?:[、|｜/]+|以及|和|及|与)/)
            .map(cleanText)
            .filter((piece) => (
              piece
              && atomBearingClause.test(piece)
              && localPromptClauseIsVisibleToken(piece)
            ))
            .forEach((piece) => addLocalPromptAtom(atoms, piece, 48))
        })
    })
    ;[
      contentIdentityLock.requiredElements,
      contentIdentityLock.identityAnchors,
    ].forEach((items) => {
      ;(Array.isArray(items) ? items : []).forEach((item) => {
        if (localPromptClauseIsVisibleToken(item)) addLocalPromptAtom(atoms, item)
      })
    })
    const kept = []
    let length = 0
    atoms.forEach((atom) => {
      const nextLength = length + (kept.length ? 3 : 0) + atom.length
      if (nextLength > LOCAL_PROMPT_LOCK_MAX_CHARS) return
      kept.push(atom)
      length = nextLength
    })
    return kept.length ? `MUST PRESERVE EXACTLY: ${kept.join(' | ')}` : ''
  }

  function localModelTextContains(container, candidate) {
    const normalize = (value) => cleanText(value)
      .toLowerCase()
      .replace(/[\s，。；、,:：;.!！?？()[\]{}【】《》"'“”‘’_-]+/g, '')
    const parent = normalize(container)
    const child = normalize(candidate)
    return Boolean(parent && child && (parent.includes(child) || child.includes(parent)))
  }

  function localRegionBand(region, canvas = {}, index = 0, total = 1) {
    const canvasHeight = finiteNumber(canvas?.height)
    const yNorm = finiteNumber(region?.yNorm)
    const hNorm = finiteNumber(region?.hNorm)
    const y = yNorm != null
      ? yNorm
      : (
          canvasHeight > 0 && finiteNumber(region?.y) != null
            ? finiteNumber(region.y) / canvasHeight
            : null
        )
    const height = hNorm != null
      ? hNorm
      : (
          canvasHeight > 0 && finiteNumber(region?.height) != null
            ? finiteNumber(region.height) / canvasHeight
            : null
        )
    const center = y != null
      ? Math.max(0, Math.min(1, y + Math.max(0, height || 0) / 2))
      : (Math.max(0, Number(index)) + 0.5) / Math.max(1, Number(total) || 1)
    if (center < 0.18) return '顶部'
    if (center < 0.4) return '上部'
    if (center < 0.68) return '中部'
    if (center < 0.86) return '下部'
    return '底部'
  }

  function localFooterGroupingRule(userPrompt, regions = []) {
    const footerSources = (Array.isArray(regions) ? regions : [])
      .filter((region) => {
        const role = cleanText(region?.role || region?.kind || region?.type).toLowerCase()
        const name = cleanText(region?.name || region?.title || region?.label)
        return /footer|bottom|底部/.test(`${role} ${name}`)
      })
      .flatMap((region) => [
        region?.purpose,
        region?.description,
        region?.requirements,
        region?.requirement,
        region?.prompt,
      ])
    const source = [userPrompt, ...footerSources].map(cleanText).filter(Boolean).join('；')
    const hasAmounts = /\b(?:balance|credits?|bets?|wagers?|win)\b|余额|投注|金额|赢取/i.test(source)
    const hasActions = /\b(?:auto|autoplay|turbo|recharge|menu|spin)\b|自动|极速|充值|菜单|旋转/i.test(source)
    if (!hasAmounts || !hasActions) return ''
    return '底栏严格分两行：第一行逐项完整显示全部金额信息，第二行逐项完整显示全部操作按钮；不得合并、省略、替换或挤出画布'
  }

  function localPromptStructureRule(value) {
    const source = cleanText(value)
    if (!source) return ''
    let columns = 0
    let rows = 0
    const rowsThenColumns = source.match(/([2-6])\s*(?:行|rows?)\s*(?:[xX×*]|by)\s*([2-6])\s*(?:列|columns?)/i)
    const columnsThenRows = source.match(/([2-6])\s*(?:列|columns?)\s*(?:[xX×*]|by)\s*([2-6])\s*(?:行|rows?)/i)
    const compactGrid = source.match(/\b([2-6])\s*[×xX*]\s*([2-6])\b/)
    if (rowsThenColumns) {
      rows = Number(rowsThenColumns[1])
      columns = Number(rowsThenColumns[2])
    } else if (columnsThenRows) {
      columns = Number(columnsThenRows[1])
      rows = Number(columnsThenRows[2])
    } else if (compactGrid) {
      columns = Number(compactGrid[1])
      rows = Number(compactGrid[2])
    } else if (/(?:老虎机|数字转轴|转轴|reels?|slot(?:\s+machine)?|symbol\s+grid|符号网格)/i.test(source)) {
      const columnsOnly = source.match(/([2-6])\s*(?:列|columns?)/i)
      const rowsOnly = source.match(/([2-6])\s*(?:行|rows?)/i)
      columns = Number(columnsOnly?.[1]) || 0
      rows = Number(rowsOnly?.[1]) || 0
    }
    if (!columns && !rows) return ''
    const matrix = columns && rows
      ? `核心重复区严格${columns}列×${rows}行，共${columns * rows}格`
      : columns
        ? `核心重复区严格${columns}列，不猜测或增加列数`
        : `核心重复区严格${rows}行，不猜测或增加行数`
    return `${matrix}；这些行列、格数和数量只约束布局，不得作为可见数字、字母、图标或文案`
  }

  function conciseLocalReferenceInstruction(reference, imageNumber) {
    const role = normalizeReferenceRole(reference?.role)
    if (cleanText(reference?.proxyEncoding) === 'perimeter-identity-scrub-raster-v1') {
      return `图${imageNumber}为“内部高保真、外围去身份”的主构图参考：内部保留区块几何、层级、间距、密度与商业完成度；顶部、两侧和底部的像素化边带仅是占位，不是可见画面。严禁复制、还原或猜测边带中的源Logo、标题、系统状态栏、边缘数字、赔付线数字、侧栏文字、水印或源主题身份；外围全部改为TARGET内容`
    }
    if (cleanText(reference?.proxyEncoding) === 'material-proxy-raster-v2') {
      return `图${imageNumber}是去身份中频材质场；只采纳局部金属高光、玉石纹理、织物颗粒、粗糙度、色温与商业精修密度；不表达布局、人物、文字、Logo、图标或主题对象`
    }
    if (cleanText(reference?.proxyEncoding) === 'material-proxy-raster-v1') {
      return `图${imageNumber}是16px极低频去身份彩色材质代理，只约束整体配色关系、材质冷暖、明暗层级与商业质感；其中残留的形状、文字、人物、Logo、图标和主题对象全部是噪声，禁止复制`
    }
    if (reference?.autoPrimary === true) {
      if (cleanText(reference?.proxyEncoding) === 'composition-semantic-fusion-raster-v1') {
        return `图${imageNumber}是去身份低频构图与柔性语义中心融合代理；保留色彩层级、区域比例、分组、间距和重复项中心数量；亮斑必须替换为TARGET内容；图中残留身份与源主题均为噪声，禁止复制`
      }
      if (cleanText(reference?.proxyEncoding) === 'composition-proxy-raster-v2') {
        return `图${imageNumber}是去身份低频构图代理；只保留色彩层级、区块比例、分组、间距和密度；残留人物、文字、Logo、图标与源主题均为噪声，必须替换为TARGET内容`
      }
      return `图${imageNumber}是主合成底图，仅保留构图、区块比例、分组、间距、重复项关系与商业完成度；冲突的主题、主体、文案、控件和数量全部服从TARGET`
    }
    const roleRules = {
      layout: '绑定布局，只保留区块位置、比例、分组、层级、控件关系与重复项数量',
      style: '仅提供风格、材质、线条、光影与装饰语言',
      character: '仅提供已声明角色的身份和外观特征',
      subject: '仅提供已声明主体的身份与核心设计',
      material: '仅提供材质、纹理与表面表现',
      color: '仅提供配色关系与明暗层级',
      content: '仅提供已声明的界面内容素材',
      reference: '仅辅助构图平衡、密度、材质与商业完成度',
    }
    return `图${imageNumber}${roleRules[role] || roleRules.reference}；不得覆盖TARGET或增加未声明区域与数量`
  }

  function localVisualStyleFromPrompt(value) {
    const clauses = cleanText(value)
      .split(/[，,；;。.!?\r\n]+/)
      .map(cleanText)
      .filter(Boolean)
    const styleClauses = clauses.filter((clause) => (
      /\b(?:style|palette|color|material|texture|lighting|contrast|finish|commercial|cinematic|render|polish)\b|风格|配色|色彩|材质|纹理|质感|光影|照明|对比度|高对比|精细|精致|商业级|成品|渲染/i.test(clause)
    ))
    return compactLocalModelText(styleClauses.join('；'), 100)
  }

  function conciseLocalReferenceContentContract(value) {
    const groups = Array.isArray(value?.groups) ? value.groups : []
    if (!groups.length) return ''
    const geometryRule = (geometry) => {
      const source = geometry && typeof geometry === 'object' ? geometry : {}
      const x = finiteNumber(source.xNorm ?? source.x ?? source.leftNorm ?? source.left)
      const y = finiteNumber(source.yNorm ?? source.y ?? source.topNorm ?? source.top)
      const width = finiteNumber(source.wNorm ?? source.widthNorm ?? source.width)
      const height = finiteNumber(source.hNorm ?? source.heightNorm ?? source.height)
      if ([x, y, width, height].some((item) => item == null)) return ''
      if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.0001 || y + height > 1.0001) return ''
      const percent = (item) => Math.round(Math.max(0, Math.min(1, item)) * 100)
      return `范围x${percent(x)}-${percent(x + width)}%,y${percent(y)}-${percent(y + height)}%，内容不得越界或侵占相邻区`
    }
    const rules = groups.slice(0, 8).map((group, index) => {
      const label = `R${index + 1}`
      const matrix = group?.matrix && typeof group.matrix === 'object' ? group.matrix : null
      const columns = positiveInteger(matrix?.columns, 0)
      const rows = positiveInteger(matrix?.rows, 0)
      const totals = Array.isArray(group?.explicitCounts)
        ? group.explicitCounts
            .slice(0, 4)
            .map((item) => `${positiveInteger(item?.count, 0)}${cleanText(item?.unit)}`)
            .filter((item) => !item.startsWith('0'))
        : []
      const fixedGeometry = geometryRule(group?.geometry)
      const placementRule = fixedGeometry || (group?.geometry ? '位置与占比服从结构引导' : '保持参考分组位置')
      const matrixRule = columns && rows
        ? `严格${columns}列×${rows}行，共${columns * rows}格`
        : columns
          ? `严格${columns}列，不猜测或增加列数`
          : rows
            ? `严格${rows}行，不猜测或增加行数`
            : ''
      return `${label}:${[placementRule, matrixRule, totals.length ? `显式数量${totals.join('、')}` : ''].filter(Boolean).join('，')}`
    })
    return `严格分组共${groups.length}区并保持顺序；${rules.join('；')}；同一要求的重复文字不增加实例；不得绘制分组框、坐标或本控制语句`
  }

  function assembleLocalRedesignPromptSections(sections = []) {
    const prepared = sections
      .filter((section) => cleanText(section?.value))
      .map((section) => {
        const sourceValue = cleanText(section.value)
        const compactor = typeof section.compactor === 'function'
          ? section.compactor
          : compactLocalModelText
        return {
          key: cleanText(section.key).toLowerCase(),
          label: cleanText(section.label),
          sourceValue,
          compactor,
          value: section.preserve === true
            ? sourceValue
            : compactor(sourceValue, section.maxChars),
          minChars: Math.max(16, Math.floor(Number(section.minChars) || 16)),
          preserve: section.preserve === true,
        }
      })
    const render = () => prepared
      .map((section) => `${section.label}${section.value}`)
      .join(' ')
      .trim()
    const shrinkOrder = ['style', 'layout', 'reference', 'fix', 'target']
    let prompt = render()
    for (const key of shrinkOrder) {
      if (prompt.length <= LOCAL_REDESIGN_MODEL_PROMPT_MAX_CHARS) break
      const section = prepared.find((item) => item.key === key && item.preserve !== true)
      if (!section || section.value.length <= section.minChars) continue
      const overflow = prompt.length - LOCAL_REDESIGN_MODEL_PROMPT_MAX_CHARS
      const nextLimit = Math.max(section.minChars, section.value.length - overflow)
      section.value = section.compactor(section.sourceValue, nextLimit)
      prompt = render()
    }
    return prompt
  }

  function compileLocalRedesignModelPrompt(options = {}) {
    const project = options.project && typeof options.project === 'object' ? options.project : {}
    const semantic = options.semantic && typeof options.semantic === 'object' ? options.semantic : {}
    const canvas = semantic.canvas && typeof semantic.canvas === 'object'
      ? semantic.canvas
      : projectCanvas(project)
    const carrierIntent = cleanText(options.carrierIntent).toLowerCase() === 'hardware'
      ? 'hardware'
      : 'screen'
    const target = compactLocalModelText(
      localTxt2ImgTarget(
        options.userPrompt
          || project.requirement
          || project.requirements
          || project.generateRequirement
          || project.prompt
          || project.description
          || semantic.description,
        carrierIntent,
      ),
      380,
    )
    const regions = Array.isArray(semantic.regions) ? semantic.regions : projectBlocks(project)
    const protectionLock = normalizeScreenNativeUiText(
      compileLocalPromptProtectionLock({
        userPrompt: options.userPrompt,
        regions,
        contentIdentityLock: options.contentIdentityLock,
      }),
      carrierIntent,
    )
    const perRegionBudget = Math.max(48, Math.floor(460 / Math.max(1, regions.length)))
    const regionLines = regions.map((region, index) => {
      const purpose = normalizeScreenNativeUiText(
        region?.purpose || region?.description || semanticRoleInstruction(region?.role),
        carrierIntent,
      )
      const requirement = normalizeScreenNativeUiText(
        region?.requirements || region?.requirement || region?.prompt,
        carrierIntent,
      )
      const clause = [
        purpose,
        requirement && !localModelTextContains(purpose, requirement) ? requirement : '',
      ].filter(Boolean).join('；')
      return `R${index + 1}${localRegionBand(region, canvas, index, regions.length)}=${compactLocalModelText(clause || '完成该功能区', perRegionBudget)}`
    })
    const footerGroupingRule = localFooterGroupingRule(options.userPrompt, regions)
    const promptStructureRule = localPromptStructureRule(options.userPrompt)
    const referenceContentRule = conciseLocalReferenceContentContract(options.referenceContentContract)
    const references = Array.isArray(options.references) ? options.references : []
    const referenceImageNumbers = Array.isArray(options.referenceImageNumbers)
      ? options.referenceImageNumbers
      : []
    const referenceRules = references.map((reference, index) => conciseLocalReferenceInstruction(
      reference,
      positiveInteger(referenceImageNumbers[index], index + 1),
    ))
    const layoutGuideImageNumber = positiveInteger(options.layoutGuideImageNumber, references.length + 1)
    referenceRules.push(
      `图${layoutGuideImageNumber}仅表达功能区顺序、相对占比、留白与重复项数量，不得绘制引导形状、边框或标注`,
    )
    const hasRepeatedMatrix = Array.isArray(options.referenceContentContract?.groups)
      && options.referenceContentContract.groups.some((group) => {
        const matrix = group?.matrix && typeof group.matrix === 'object' ? group.matrix : null
        return positiveInteger(matrix?.columns, 0) > 1 || positiveInteger(matrix?.rows, 0) > 1
      })
    if (hasRepeatedMatrix) {
      referenceRules.push(
        '重复项柔性亮斑仅标记内容中心，必须替换为TARGET内容；禁止实体化为同形圆形或椭圆形光圈、卡片、按钮',
      )
    }
    const requestedVisualStyle = localVisualStyleFromPrompt(options.userPrompt)
    const supplementalVisualStyle = cleanText(
      options.visualStyle
      || project.style
      || project.visualStyle
      || project.stylePrompt,
    )
    const visualStyle = compactLocalModelText(
      [
        requestedVisualStyle,
        supplementalVisualStyle,
      ]
        .filter((item, index, all) => item && all.indexOf(item) === index)
        .join('；'),
      100,
    )
    const qualityCorrection = compactLocalModelText(options.qualityCorrectionPrompt, 160)
    const carrierRule = carrierIntent === 'hardware'
      ? '输出用户明确要求的实体设备或硬件载体，保持正视完整产品构图'
      : '整张画布本身就是唯一的全屏数字游戏界面；所有区域均为同一正视屏幕平面内的二维软件HUD；禁止实体老虎机、街机机柜、设备外壳、厚重机器边框、手机框、系统状态栏、产品展示照或硬件按钮'
    const outputRule = carrierIntent === 'hardware'
      ? '只输出一张完整成品图，只含已声明区域、主体与数量'
      : '只输出一张正视、边到边、背景延伸四边的原生数字UI；顶部与底部功能区必须完整留在画布内；只含已声明区域、主体与数量，无编辑器元素、设备外壳、机柜、手机框、额外人物或额外功能条'
    return assembleLocalRedesignPromptSections([
      { key: 'target', label: '[TARGET]', value: target, maxChars: 380, minChars: 120 },
      { key: 'carrier', label: '[CARRIER]', value: carrierRule, preserve: true },
      {
        key: 'structure',
        label: '[STRUCTURE]',
        value: [referenceContentRule, promptStructureRule, footerGroupingRule].filter(Boolean).join('；'),
        preserve: true,
      },
      { key: 'lock', label: '[LOCK]', value: protectionLock, preserve: true },
      { key: 'fix', label: '[FIX]', value: qualityCorrection, maxChars: 160, minChars: 48 },
      {
        key: 'layout',
        label: '[LAYOUT]',
        value: regionLines.join('；'),
        maxChars: 270,
        minChars: 120,
        compactor: (_value, maxChars) => compactLocalRegionLines(regionLines, maxChars),
      },
      {
        key: 'reference',
        label: '[REFERENCE]',
        value: referenceRules.join('；'),
        maxChars: 360,
        minChars: 140,
      },
      { key: 'style', label: '[STYLE]', value: visualStyle, maxChars: 100, minChars: 48 },
      { key: 'output', label: '[OUTPUT]', value: outputRule, preserve: true },
    ]).replace(/\r?\n/g, ' ')
  }

  // What each declared reference role asks of Qwen-Image-2.1. The images reach it as they are
  // (no anti-copy proxies), so the role wording is what separates "take the look" from
  // "put this asset in the screen".
  const QWEN21_UI_REFERENCE_RULES = Object.freeze({
    layout: 'binding layout reference: preserve its major region anchors, gameplay grouping, counts and control functions; redesign theme artwork and component construction as requested, without treating its old borders, corner decorations, supports or silhouettes as fixed unless the user explicitly keeps them.',
    style: 'style reference: take its palette, materials, lighting, ornament and frame language and typography feel; do not copy its layout, characters, logo or text.',
    character: 'character reference: show this character with the same identity, face, hair, outfit and colors.',
    subject: 'content reference: include this subject with the same identity and key details.',
    content: 'finished asset: reproduce it faithfully (same silhouette, colors and details) as a part of the screen.',
    material: 'material reference: take only its surface material and texture.',
    color: 'palette reference (a low-detail proxy): take only its colors.',
  })

  function qwen21UiReferenceRule(reference) {
    if (cleanText(reference?.treatment) === 'base') {
      return 'the current design. Keep everything the request does not mention unchanged: layout, text, colors, assets and style.'
    }
    const role = normalizeReferenceRole(reference?.role)
    // A plain reference is often a finished slice too; the request says where it goes.
    return QWEN21_UI_REFERENCE_RULES[role]
      || 'reference image: use it as the request describes; if it is a finished game asset (symbol, button, frame, background), reproduce it faithfully.'
  }

  // The resource name is the only per-image hint the model gets besides the request, so it goes
  // in front of the rule ("<image3> SCATTER符号: ...").
  function qwen21UiReferenceLabel(reference) {
    // The current design's rule already says what it is; its file name is only noise.
    if (cleanText(reference?.treatment) === 'base') return ''
    const label = cleanText(reference?.name)
      .replace(/\.(?:png|jpe?g|webp|gif|bmp)$/i, '')
      .replace(/^ui_(?:q21_|reference_)\d+_?/i, '')
      .replace(/[_\s]+/g, ' ')
      .trim()
    return label.length > 40 ? label.slice(0, 40) : label
  }

  function qwen21RegionBox(region, canvas) {
    const width = finiteNumber(canvas?.width)
    const height = finiteNumber(canvas?.height)
    const norm = (key, pixelKey, extent) => finiteNumber(region?.[key])
      ?? (extent > 0 && finiteNumber(region?.[pixelKey]) != null ? finiteNumber(region[pixelKey]) / extent : null)
    return {
      top: norm('yNorm', 'y', height),
      height: norm('hNorm', 'height', height),
      left: norm('xNorm', 'x', width),
      width: norm('wNorm', 'width', width),
    }
  }

  // No guide image reaches 2.1, so the text carries the whole layout: vertical band and, for regions
  // that share a row, the horizontal one too.
  function qwen21RegionSpan(region, canvas) {
    const box = qwen21RegionBox(region, canvas)
    if (box.top == null || box.height == null) return ''
    const percent = (value) => Math.round(Math.max(0, Math.min(1, value)) * 100)
    const vertical = `${percent(box.top)}-${percent(box.top + box.height)}% from the top`
    return box.left != null && box.width != null && box.width < 0.9
      ? `${vertical}, ${percent(box.left)}-${percent(box.left + box.width)}% from the left`
      : vertical
  }

  function compileQwen21UiPrompt(options = {}) {
    const project = options.project && typeof options.project === 'object' ? options.project : {}
    const semantic = options.semantic && typeof options.semantic === 'object' ? options.semantic : {}
    const canvas = semantic.canvas && typeof semantic.canvas === 'object' ? semantic.canvas : projectCanvas(project)
    const width = positiveInteger(canvas.width, 0)
    const height = positiveInteger(canvas.height, 0)
    const orientation = width > height ? 'landscape' : (width < height ? 'portrait' : 'square')
    const carrierIntent = cleanText(options.carrierIntent).toLowerCase() === 'hardware' ? 'hardware' : 'screen'
    const iteration = cleanText(options.intent).toLowerCase() === 'iteration'
    const userPrompt = cleanText(options.userPrompt)
    const target = userPrompt
      || cleanText(project.requirement || project.requirements || project.generateRequirement || project.prompt)
      || cleanText(project.description || semantic.description)
    const references = Array.isArray(options.references) ? options.references : []
    const imageNumbers = Array.isArray(options.referenceImageNumbers) ? options.referenceImageNumbers : []
    const guideNumber = positiveInteger(options.layoutGuideImageNumber, 0)
    const referenceLines = references.flatMap((reference, index) => {
      const imageNumber = positiveInteger(imageNumbers[index], index + 1)
      if (imageNumber === guideNumber) return []
      const label = qwen21UiReferenceLabel(reference)
      return [`<image${imageNumber}>${label ? ` ${label}` : ''}: ${qwen21UiReferenceRule(reference)}`]
    })
    if (guideNumber) {
      referenceLines.push(`<image${guideNumber}>: binding layout guide, not artwork. Use it for major functional region anchors, grouping, order and repeat counts. Its boxes do not lock finished component contours, construction, supports or decorations. Never draw gray blobs, boxes, outlines or guide marks.`)
    }
    const regions = (Array.isArray(semantic.regions) ? semantic.regions : projectBlocks(project))
      .map((region, index) => ({ region, index, box: qwen21RegionBox(region, canvas) }))
      .sort((a, b) => (a.box.top == null || b.box.top == null
        ? a.index - b.index
        : (a.box.top - b.box.top) || ((a.box.left ?? 0) - (b.box.left ?? 0)) || (a.index - b.index)))
      .map((item) => item.region)
    const regionLines = regions.map((region, index) => {
      const purpose = normalizeScreenNativeUiText(region?.purpose || region?.description || semanticRoleInstruction(region?.role), carrierIntent)
      const requirement = normalizeScreenNativeUiText(region?.requirements || region?.requirement || region?.prompt, carrierIntent)
      const clause = [purpose, requirement && !localModelTextContains(purpose, requirement) ? requirement : ''].filter(Boolean).join('；')
      const span = qwen21RegionSpan(region, canvas)
      const name = cleanText(region?.name || region?.title || region?.label)
      const label = name && !localModelTextContains(clause, name) ? `${name}：` : ''
      // Position and name stay whole when the prompt has to shrink; only the description is cut.
      return { prefix: `- ${span || localRegionBand(region, canvas, index, regions.length)}: ${label}`, clause: clause || '完成该功能区' }
    })
    // The region lines already carry positions and counts; the 2511 reference-content contract and
    // content-lock paragraphs repeat the request (with raw @参考图 tokens) and only lengthen it.
    const structureRules = [
      localPromptStructureRule(userPrompt),
      localFooterGroupingRule(userPrompt, regions),
    ].map(cleanText).filter(Boolean)
    const lock = normalizeScreenNativeUiText(compileLocalPromptProtectionLock({
      userPrompt,
      regions,
      contentIdentityLock: options.contentIdentityLock,
    }), carrierIntent)
    const opening = iteration
      ? `Edit <image1>, the current UI design, into its next version at ${width}x${height}. Keep it one finished, opaque, edge-to-edge ${orientation} screen.`
      : carrierIntent === 'hardware'
        ? `Render the requested physical device as one finished, front-facing ${width}x${height} product image.`
        : `Design one finished, opaque, edge-to-edge ${width}x${height} ${orientation} UI screen. The whole image is the screen itself, viewed straight-on.`
    // The closing lines carry what to keep and what never to draw, so they are sized first and never
    // cut; the request, image roles and regions shrink to fit.
    const tail = [
      structureRules.length ? `Structure rules: ${compactLocalModelText(structureRules.join('；'), 500)}` : '',
      lock ? `Must keep: ${compactLocalModelText(lock, 500)}` : '',
      carrierIntent === 'hardware'
        ? 'Do not show: annotations, guide marks, editor grid, watermark.'
        : 'Do not show: device frame, phone mockup, arcade or slot cabinet, room, product shot, annotations, guide marks, editor grid, watermark.',
    ].filter(Boolean).join('\n')
    const head = (targetChars, referenceChars, regionChars) => [
      opening,
      target ? `${iteration ? 'Change only this' : 'Content (highest priority)'}: ${compactLocalModelText(target, targetChars)}` : '',
      referenceLines.length ? ['Images:', ...referenceLines.map((line) => compactLocalModelText(line, referenceChars))].join('\n') : '',
      regionLines.length ? ['Screen structure, top to bottom:', ...regionLines.map((line) => line.prefix + compactLocalModelText(line.clause, regionChars))].join('\n') : '',
    ].filter(Boolean).join('\n')
    if (options.strictRequirements) {
      const complete = head(100000, 100000, 100000) + '\n' + tail
      if (complete.length > QWEN21_UI_PROMPT_MAX_CHARS) throw new Error('当前模型的 UI 指令过长，请精简需求或模块说明；本次未截断生成。')
      return complete
    }
    const room = QWEN21_UI_PROMPT_MAX_CHARS - tail.length - 1
    let body = head(1200, 400, 400)
    for (const [targetChars, referenceChars, regionChars] of [[1200, 400, 90], [800, 160, 90], [500, 120, 70], [300, 90, 50]]) {
      if (body.length <= room) break
      body = head(targetChars, referenceChars, regionChars)
    }
    if (body.length > room) body = body.slice(0, Math.max(0, room))
    return `${body}\n${tail}`
  }

  // The 2.1 graph scales each reference to a pixel budget for its role, so it needs real sizes;
  // a connected resource does not always carry them.
  function measureDataUrl(dataUrl) {
    const ImageCtor = root && root.Image
    if (typeof ImageCtor !== 'function' || !cleanText(dataUrl)) return Promise.resolve({ width: 0, height: 0 })
    return new Promise((resolve) => {
      const image = new ImageCtor()
      image.onload = () => resolve({
        width: positiveInteger(image.naturalWidth || image.width, 0),
        height: positiveInteger(image.naturalHeight || image.height, 0),
      })
      image.onerror = () => resolve({ width: 0, height: 0 })
      image.src = dataUrl
    })
  }

  // A transparent slice hands the model whatever colour its clear pixels store: in the tests every
  // symbol came out on a coloured block. On neutral grey the same slices read as cut-out assets.
  // Without a canvas (tests, workers) the image goes as it is.
  async function flattenOnNeutralGray(dataUrl) {
    const documentRef = root && root.document
    const ImageCtor = root && root.Image
    if (!/^data:image\/(?:png|webp);/i.test(cleanText(dataUrl))) return dataUrl
    if (typeof documentRef?.createElement !== 'function' || typeof ImageCtor !== 'function') return dataUrl
    try {
      const image = await new Promise((resolve, reject) => {
        const item = new ImageCtor()
        item.onload = () => resolve(item)
        item.onerror = () => reject(new Error('reference image did not load'))
        item.src = dataUrl
      })
      const canvas = documentRef.createElement('canvas')
      canvas.width = positiveInteger(image.naturalWidth || image.width, 1)
      canvas.height = positiveInteger(image.naturalHeight || image.height, 1)
      const context = canvas.getContext('2d')
      context.fillStyle = '#808080'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)
      return canvas.toDataURL('image/png')
    } catch {
      return dataUrl
    }
  }

  function mergeDistinctPromptParts(first, second) {
    const left = cleanText(first)
    const right = cleanText(second)
    if (!left) return right
    if (!right || left === right || left.includes(right)) return left
    if (right.includes(left)) return right
    return `${left}, ${right}`
  }

  function abortError(reason) {
    const error = new Error(cleanText(reason) || 'UI generation cancelled')
    error.name = 'AbortError'
    return error
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError(signal.reason)
  }

  function wait(ms, signal) {
    throwIfAborted(signal)
    const delay = Math.max(0, Number(ms) || 0)
    if (delay === 0) return Promise.resolve()
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve()
      }
      const timer = setTimeout(() => finish(), delay)
      const onAbort = () => {
        clearTimeout(timer)
        finish(abortError(signal?.reason))
      }
      if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  function emitProgress(callback, phase, label, progress, detail = {}) {
    if (typeof callback !== 'function') return
    try {
      callback(Object.freeze({
        phase,
        label,
        progress: Math.max(0, Math.min(1, Number(progress) || 0)),
        ...detail,
      }))
    } catch {
      // Progress presentation must never interrupt generation.
    }
  }

  function executionBridge(options) {
    const bridge = options?.bridge || (root && root.NovaFlowArtGenerateExecutionBridge)
    const required = [
      'detectBaseUrl',
      'requestJson',
      'fetchBlob',
      'uploadDataUrl',
      'buildRunWorkflow',
      'validateWorkflowNodes',
      'extractFiles',
      'historyErrorMessage',
      'readQueueState',
      'withTimeout',
      'blobToDataUrl',
    ]
    const missing = required.filter((name) => typeof bridge?.[name] !== 'function')
    if (missing.length) throw new Error(`NovaFlow UI generation bridge is incomplete: ${missing.join(', ')}`)
    return bridge
  }

  async function bridgeTimeout(bridge, task, timeoutMs, message) {
    const signal = RUN_SIGNAL
    const pending = Promise.resolve(bridge.withTimeout(task, timeoutMs, message))
    if (!signal || typeof signal.addEventListener !== 'function') return await pending
    throwIfAborted(signal)
    return await new Promise((resolve, reject) => {
      const onAbort = () => reject(abortError(signal.reason))
      signal.addEventListener('abort', onAbort, { once: true })
      pending.then(resolve, reject).finally(() => signal.removeEventListener?.('abort', onAbort))
    })
  }

  function workflowSettings(state, provider, mode = MODE) {
    const models = root && root.NovaFlowArtGenerateModels
    return typeof models?.workflowSettings === 'function'
      ? models.workflowSettings(state, provider, mode)
      : {}
  }

  async function buildRunWorkflow(bridge, options) {
    return await bridge.buildRunWorkflow({ ...options, mode: cleanText(options?.mode) || MODE })
  }

  function responseData(response) {
    return response && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'data')
      ? response.data
      : response
  }

  function uploadedName(value, fallback) {
    if (typeof value === 'string') return cleanText(value) || fallback
    return cleanText(value?.name || value?.filename || value?.fileName) || fallback
  }

  function historyItem(response, promptId) {
    const data = responseData(response)
    return data && typeof data === 'object' && data[promptId] ? data[promptId] : data
  }

  function resultFileUrl(file) {
    const query = new URLSearchParams()
    query.set('filename', cleanText(file?.filename || file?.name))
    if (cleanText(file?.subfolder)) query.set('subfolder', cleanText(file.subfolder))
    query.set('type', cleanText(file?.type) || 'output')
    return `/view?${query.toString()}`
  }

  async function run(options = {}) {
    const bridge = executionBridge(options)
    const state = options.state && typeof options.state === 'object' ? options.state : {}
    state.mode = MODE
    const provider = normalizeProvider(options.provider || state.provider)
    state.provider = provider
    const signal = options.signal || null
    const onProgress = options.onProgress || options.progress
    const project = options.project && typeof options.project === 'object' ? options.project : {}
    // The exact same ordered snapshot drives @ mentions, prompt numbering,
    // upload order and workflow reference metadata.
    const externalRefs = externalReferenceSnapshot(options.refs || options.references)
    const semanticLayout = resolveSemanticLayout(project, options, state)
    const requestedLayoutGuideEncoding = provider === 'local'
      ? SOFT_UI_SEMANTIC_SCAFFOLD_ENCODING
      : provider === 'google'
        ? SOFT_LAYOUT_GUIDE_ENCODING
        : ''
    const hasRegions = Array.isArray(semanticLayout.regions) && semanticLayout.regions.length > 0
    const layoutGuide = hasRegions
      ? resolveCleanLayoutGuide(project, options, state, semanticLayout, requestedLayoutGuideEncoding)
      : cleanGuideCandidate(options.layoutGuide) || cleanGuideCandidate(project.layoutGuide) || { source: 'none', visualEncoding: '' }
    const hasLayout = Boolean(cleanGuideCandidate(layoutGuide))
    if (hasRegions && !hasLayout) throw new Error('自建布局必须先生成有效布局参考图片，本次未提交生成')
    const layoutValidator = root?.NovaFlowUiDesignPromptPipeline?.requireLayoutReferences
    if (typeof layoutValidator !== 'function') throw new Error('UI 布局校验组件未就绪，本次未提交生成')
    const guideReference = hasLayout ? { ...layoutGuide, role: 'layout', uiLayoutId: 'ui-generation-guide' } : null
    // Keep already connected guides in their original slot so @ references
    // retain their meaning. Refresh that slot with the actual current guide.
    const connectedGuideIndex = hasLayout ? externalRefs.findIndex(ref => ref.uiLayoutId || (ref.role === 'layout' && ref.dataUrl === layoutGuide.dataUrl)) : -1
    const candidates = connectedGuideIndex >= 0 ? externalRefs.map((ref, index) => index === connectedGuideIndex
      ? { ...ref, ...guideReference, sourceId: ref.sourceId, name: ref.name } : ref) : externalRefs
    const validatedRefs = layoutValidator([...candidates, ...(guideReference && connectedGuideIndex < 0 ? [guideReference] : [])])
    const refs = Object.freeze(guideReference && connectedGuideIndex < 0 ? validatedRefs.filter(ref => ref !== guideReference) : validatedRefs)
    // Asked on every run: the assistant may point at another ComfyUI than when the page loaded.
    const qwen21 = provider === 'local' && await refreshLocalQwen21Available()
    const runCapability = providerCapability(provider, { qwen21 })
    // A connected cloud guide occupies the already reserved layout slot, not
    // an external asset slot. Keep the full ordered refs for mentions/upload;
    // the final synthesis reference count still enforces the total capacity.
    const externalCapacityRefs = runCapability.reservedLayoutReferences > 0 && connectedGuideIndex >= 0
      ? refs.filter((_, index) => index !== connectedGuideIndex)
      : refs
    const capability = validateExternalReferenceCount(provider, externalCapacityRefs, runCapability)
    if (qwen21) state.localUiEngine = LOCAL_UI_ENGINE_QWEN21
    else delete state.localUiEngine
    const originalUserPrompt = cleanText(options.prompt)
    const carrierIntent = resolveUiOutputCarrier(
      originalUserPrompt,
      project.description,
      project.brief,
      project.summary,
      project.requirement,
      project.requirements,
      project.generateRequirement,
      project.prompt,
      semanticLayout.description,
      semanticLayout.requirement,
      ...(Array.isArray(semanticLayout.regions)
        ? semanticLayout.regions.flatMap((region) => [
            region?.purpose,
            region?.description,
            region?.requirements,
            region?.requirement,
            region?.prompt,
          ])
        : []),
    )
    const modelUserPrompt = normalizeScreenNativeUiText(originalUserPrompt, carrierIntent)
    const layoutGuideEncoding = cleanText(layoutGuide.visualEncoding)
      || requestedLayoutGuideEncoding
      || FILLED_REGIONS_VISUAL_ENCODING
    let localIntent = ''
    let localReferencePlan = null
    let primaryReferencePlan = null
    let localSynthesisSelection = null
    let modelRefs = refs
    let directorResult = null
    if (provider === 'local') {
      const localWorkflow = localWorkflowApi()
      const referenceWorkflow = localReferenceApi()
      if (qwen21) {
        // Qwen-Image-2.1 gets every connected reference as it is: no automatic primary, material
        // proxy or three-slot selection. Palette-only colour references keep their low-frequency
        // proxy, and the director's deterministic fallback still supplies the content lock.
        if (typeof localWorkflow?.resolveIntent !== 'function' || typeof referenceWorkflow?.buildReferencePlan !== 'function'
          || typeof referenceWorkflow?.materializeReferencePlan !== 'function') {
          throw new Error('本地 UI 专用参考图工作流尚未就绪')
        }
        localIntent = localWorkflow.resolveIntent(state, refs)
        localReferencePlan = referenceWorkflow.buildReferencePlan(refs, {
          mode: localIntent,
          baseIndex: localIntent === 'iteration' && Number(state.iterationReferenceCount) > 0 ? 0 : undefined,
        })
        throwIfAborted(signal)
        localReferencePlan = await referenceWorkflow.materializeReferencePlan(localReferencePlan, {
          transformer: options.localReferenceTransformer,
        })
        throwIfAborted(signal)
        modelRefs = localReferencePlan.entries
        const director = localDirectorApi()
        directorResult = typeof director?.run === 'function'
          ? await director.run({
              intent: localIntent,
              prompt: options.prompt,
              negativePrompt: options.negativePrompt ?? state.negativePrompt,
              references: refs,
              structure: semanticLayout,
              size: semanticLayout.canvas,
              targetStyle: state.targetStyle,
              electronAPI: options.electronAPI || root?.electronAPI,
              skip: true,
              signal,
            })
          : null
        throwIfAborted(signal)
      } else {
      if (typeof localWorkflow?.resolveIntent !== 'function' || typeof referenceWorkflow?.buildReferencePlan !== 'function'
        || typeof referenceWorkflow?.materializeReferencePlan !== 'function') {
        throw new Error('本地 UI 专用参考图工作流尚未就绪')
      }
      localIntent = localWorkflow.resolveIntent(state, refs)
      const planOptions = {
        mode: localIntent,
        baseIndex: localIntent === 'iteration' && Number(state.iterationReferenceCount) > 0 ? 0 : undefined,
      }
      localReferencePlan = referenceWorkflow.buildReferencePlan(refs, planOptions)
      throwIfAborted(signal)
      localReferencePlan = await referenceWorkflow.materializeReferencePlan(localReferencePlan, {
        transformer: options.localReferenceTransformer,
      })
      throwIfAborted(signal)
      // Reference roles must have real synthesis value. Layout, style,
      // character, subject, content and material references stay full fidelity;
      // palette-only color guidance may use a low-frequency proxy. If the user
      // supplied only general references, choose one deterministic primary
      // visual base without changing its connection order or content identity.
      primaryReferencePlan = localPrimaryReferencePlan(
        localReferencePlan.entries,
        semanticLayout.canvas,
        localIntent,
      )
      if (
        primaryReferencePlan?.applied === true
        && typeof referenceWorkflow.materializeAutomaticPrimary === 'function'
      ) {
        primaryReferencePlan = await referenceWorkflow.materializeAutomaticPrimary(
          primaryReferencePlan,
          {
            transformer: options.localReferenceTransformer,
            layoutGuide,
          },
        )
        throwIfAborted(signal)
      }
      primaryReferencePlan = await promoteSupportingMaterialReference(
        primaryReferencePlan,
        referenceWorkflow,
        { transformer: options.localMaterialReferenceTransformer },
      )
      throwIfAborted(signal)
      localSynthesisSelection = localReferenceSynthesisSelection(
        primaryReferencePlan.references,
        primaryReferencePlan,
        localIntent,
      )
      modelRefs = localSynthesisSelection.references
      const director = localDirectorApi()
      emitProgress(onProgress, 'director', '本地 UI 设计总监正在理解参考图', 0.02, { intent: localIntent })
      const directorRequirements = [
        project.requirement,
        project.requirements,
        project.generateRequirement,
        semanticLayout.requirement,
      ].map(cleanText).filter(Boolean).join('； ')
      directorResult = typeof director?.run === 'function'
        ? await director.run({
            intent: localIntent,
            prompt: options.prompt,
            negativePrompt: options.negativePrompt ?? state.negativePrompt,
            references: refs,
            structure: semanticLayout,
            size: semanticLayout.canvas,
            targetStyle: state.targetStyle,
            requirements: directorRequirements,
            electronAPI: options.electronAPI || root?.electronAPI,
            timeoutMs: options.directorTimeoutMs,
            skip: options.skipDirector === true,
            signal,
          })
        : {
            prompt: cleanText(options.prompt),
            negativePrompt: '',
            status: 'unavailable',
            used: false,
            cached: false,
            error: '本地 UI 设计总监未就绪',
          }
      throwIfAborted(signal)
      }
    }
    const referenceGuidedRedesign = provider === 'local'
      && localIntent === 'redesign'
      && !qwen21
    const executionMode = MODE
    state.mode = executionMode
    const connectedModelGuideIndex = connectedGuideIndex >= 0 ? modelRefs.findIndex(ref => ref.uiLayoutId
      || ref.index === connectedGuideIndex
      || (refs[connectedGuideIndex]?.sourceId && ref.sourceId === refs[connectedGuideIndex].sourceId)
      || (ref.role === 'layout' && ref.dataUrl === layoutGuide.dataUrl)) : -1
    const synthesisPlan = !hasLayout || connectedModelGuideIndex >= 0
      ? Object.freeze({
          references: Object.freeze([...modelRefs]),
          externalModelImageNumbers: Object.freeze(modelRefs.map((_, index) => index + 1)),
          layoutGuideIndex: connectedModelGuideIndex,
          layoutGuideImageNumber: connectedModelGuideIndex + 1,
          primaryModelReferenceIndex: -1,
          primaryModelImageNumber: 0,
          guideLast: false,
        })
      : synthesisReferencePlan({
          provider,
          intent: localIntent,
          layoutGuide,
          modelRefs,
          primaryReferencePlan,
        })
    const sourceModelImageNumbers = sourceAlignedModelImageNumbers(
      refs,
      modelRefs,
      synthesisPlan.externalModelImageNumbers,
    )
    const references = synthesisPlan.references
    if (references.length > capability.totalReferenceLimit) throw new Error(`当前模型最多支持 ${capability.totalReferenceLimit} 张参考图（包含布局图），当前共有 ${references.length} 张，请先移除多余图片；本次未提交生成`)
    const referenceRoles = references.map((reference, index) => ({
      index,
      role: index === synthesisPlan.layoutGuideIndex
        ? 'ui_layout'
        : normalizeReferenceRole(reference.role),
      name: reference.name,
      sourceId: cleanText(reference.sourceId),
      targetNodeId: cleanText(reference.targetNodeId),
      autoPrimary: reference.autoPrimary === true,
      roleSource: cleanText(reference.roleSource),
      treatment: index === synthesisPlan.layoutGuideIndex
        ? 'layout-guide'
        : cleanText(reference.treatment),
      proxyEncoding: index === synthesisPlan.layoutGuideIndex
        ? layoutGuideEncoding
        : cleanText(reference.proxyEncoding),
    }))
    const compiled = referenceGuidedRedesign || qwen21
      ? ''
      : compilePromptFromReferences(project, modelRefs, semanticLayout, {
          provider,
          localIntent,
          carrierIntent,
          userPrompt: originalUserPrompt,
          layoutGuideEncoding,
          textOnlyLayout: false,
          hasLayout,
          layoutGuideImageNumber: synthesisPlan.layoutGuideImageNumber,
          referenceImageNumbers: synthesisPlan.externalModelImageNumbers,
        })
    const stateContentIdentityLock = trustedStateContentLock(state)
    const stateContentLockPrompt = trustedStateContentLockPrompt(state)
    const directorVisualStyle = provider === 'local' && localIntent === 'redesign' && directorResult?.used === true
      ? cleanText(directorResult.visualStylePrompt)
      : ''
    const directorContentLockPrompt = provider === 'local' && localIntent === 'redesign'
      ? (stateContentLockPrompt || cleanText(directorResult?.contentLockPrompt))
      : ''
    const modelContentLockPrompt = normalizeScreenNativeUiText(directorContentLockPrompt, carrierIntent)
    const modelReferenceContentPrompt = provider === 'local' && localIntent === 'redesign'
      ? cleanText(directorResult?.referenceContentPrompt)
      : ''
    const directedUserPrompt = modelUserPrompt
      ? [
          directorVisualStyle
            ? `参考图视觉提炼（低优先级，仅约束配色、材质、线条、光影与装饰，不得改变主题、结构、功能或内容）：${directorVisualStyle}`
            : '',
          `用户原始要求（最高优先级，必须完整执行）：${modelUserPrompt}`,
          modelContentLockPrompt,
          modelReferenceContentPrompt,
        ].filter(Boolean).join('\n')
      : (provider === 'local' && directorResult?.used === true
          ? [
              normalizeScreenNativeUiText(directorResult.prompt, carrierIntent),
              modelContentLockPrompt,
              modelReferenceContentPrompt,
            ].filter(Boolean).join('\n')
          : '')
    const conciseRedesignMentionSource = qwen21
      ? modelUserPrompt
      : referenceGuidedRedesign
      ? (
          modelUserPrompt
          || normalizeScreenNativeUiText(directorResult?.prompt, carrierIntent)
          || normalizeScreenNativeUiText(project.description || semanticLayout.description, carrierIntent)
        )
      : directedUserPrompt
    const compiledMentions = assertValidUiMentions(compileUiMentions(conciseRedesignMentionSource, refs, {
      analysisOnlyReferenceIndexes: localSynthesisSelection?.analysisOnlyReferenceIndexes,
      modelImageNumbers: sourceModelImageNumbers,
      imageToken: qwen21 ? 'angle' : '',
    }))
    assertStableUiMentionBindings(options.prompt, refs, state.promptMentionBindings)
    const supplementalPrompt = cleanText(compiledMentions.text)
    const nativeEditPrompt = qwen21 && state.uiNativeEditPrompt === true
    const basePrompt = nativeEditPrompt ? String(options.prompt || '').trim() : qwen21
      ? compileQwen21UiPrompt({
          strictRequirements: true,
          project,
          semantic: semanticLayout,
          intent: localIntent,
          userPrompt: supplementalPrompt,
          references: modelRefs,
          referenceImageNumbers: synthesisPlan.externalModelImageNumbers,
          layoutGuideImageNumber: synthesisPlan.layoutGuideImageNumber,
          carrierIntent,
          contentIdentityLock: stateContentIdentityLock || directorResult?.contentIdentityLock || null,
        })
      : referenceGuidedRedesign
      ? compileLocalRedesignModelPrompt({
          project,
          semantic: semanticLayout,
          userPrompt: supplementalPrompt,
          references: modelRefs,
          referenceImageNumbers: synthesisPlan.externalModelImageNumbers,
          layoutGuideImageNumber: synthesisPlan.layoutGuideImageNumber,
          visualStyle: directorVisualStyle,
          carrierIntent,
          qualityCorrectionPrompt: options.qualityCorrectionPrompt,
          contentIdentityLock: stateContentIdentityLock || directorResult?.contentIdentityLock || null,
          referenceContentContract: directorResult?.referenceContentContract || null,
        })
      : (supplementalPrompt ? `${compiled}； 补充要求：${supplementalPrompt}` : compiled)
    const requestedNegativePrompt = cleanText(options.negativePrompt ?? state.negativePrompt)
    const prompt = provider === 'local'
      ? (
          referenceGuidedRedesign || qwen21
            ? basePrompt
            : localWorkflowApi().compileAntiCopyPrompt(basePrompt, {
                state,
                referenceRoles,
                textOnly: false,
                carrierIntent,
              })
        )
      : basePrompt
    const directedNegativePrompt = cleanText(directorResult?.negativePrompt)
    const digitalCanvasNegativePrompt = provider === 'local'
      && localIntent === 'redesign'
      ? (
          referenceGuidedRedesign
            ? LOCAL_REFERENCE_UI_NEGATIVE_PROMPT
            : DIGITAL_UI_CANVAS_NEGATIVE_PROMPT
        )
      : ''
    const negativePrompt = qwen21
      ? requestedNegativePrompt
      : capability.negativePrompt
      ? mergeDistinctPromptParts(
          mergeDistinctPromptParts(requestedNegativePrompt, directedNegativePrompt),
          digitalCanvasNegativePrompt,
        )
      : ''
    const clientId = cleanText(options.clientId) || `novaflow_ui_design_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const outputPrefix = cleanText(options.outputPrefix) || `NovaFlow_UI_${provider}_${Date.now()}`
    const maxWaitMs = Math.max(1, Number(options.maxWaitMs) || DEFAULT_MAX_WAIT_MS)
    const pollIntervalMs = Math.max(0, Number.isFinite(Number(options.pollIntervalMs)) ? Number(options.pollIntervalMs) : DEFAULT_POLL_INTERVAL_MS)
    let authorizationContext = null

    throwIfAborted(signal)
    if (provider !== 'local') {
      if (root?.electronAPI?.runtimeProviderUsageSettlement !== 'preload-price-v1') {
        throw new Error('GPT/Google 生成请在 NovaFlow 桌面端使用')
      }
      authorizationContext = root?.NovaFlowClientAuth?.createAuthorizationContext?.() || null
      if (!authorizationContext) throw new Error('请先登录 NovaFlow 账号')
    }

    emitProgress(onProgress, 'start', '准备生成 UI', 0, { provider, mode: executionMode })
    let runtimeBaseUrl = ''
    RUN_SIGNAL = signal
    try {
      throwIfAborted(signal)
      emitProgress(onProgress, 'connect', '正在连接 NovaFlow AI Runtime', 0.04)
      const baseUrl = await bridgeTimeout(
        bridge,
        () => bridge.detectBaseUrl(),
        CONNECT_TIMEOUT_MS,
        '连接 NovaFlow AI Runtime 超时',
      )
      throwIfAborted(signal)
      if (!cleanText(baseUrl)) throw new Error('NovaFlow AI Runtime 未连接')
      runtimeBaseUrl = baseUrl

      const uploadDataUrls = qwen21
        ? await Promise.all(references.map((reference) => flattenOnNeutralGray(reference.dataUrl)))
        : null
      throwIfAborted(signal)
      const uploadedNames = []
      for (let index = 0; index < references.length; index += 1) {
        const reference = references[index]
        const externalReferenceIndex = modelRefs.indexOf(reference)
        const label = index === synthesisPlan.layoutGuideIndex
          ? '正在上传干净布局控制图'
          : `正在上传参考图${externalReferenceIndex + 1}`
        emitProgress(onProgress, 'upload', label, 0.08 + (index / Math.max(1, references.length)) * 0.12, {
          referenceIndex: index,
          referenceRole: reference.role || 'reference',
        })
        const uploadName = qwen21 ? `ui_q21_${String(index + 1).padStart(2, '0')}.png` : reference.name
        const upload = await bridge.uploadDataUrl(baseUrl, uploadName, uploadDataUrls ? uploadDataUrls[index] : reference.dataUrl)
        throwIfAborted(signal)
        uploadedNames.push(uploadedName(upload, uploadName))
      }
      const measuredSizes = qwen21
        ? await Promise.all(uploadDataUrls.map((dataUrl) => measureDataUrl(dataUrl)))
        : null
      throwIfAborted(signal)

      emitProgress(onProgress, 'build', '正在构建 UI 生成工作流', 0.23)
      const workflowRun = await buildRunWorkflow(bridge, {
        provider,
        mode: executionMode,
        maxReferences: capability.totalReferenceLimit,
        uploadedNames,
        outputPrefix,
        prompt,
        clientId,
        state,
        project,
        settings: workflowSettings(state, provider, executionMode),
        negativePrompt,
        taskProfile: UI_TASK_PROFILE,
        layoutGuideEncoding,
        systemPrompt: provider === 'google' ? (hasLayout ? GOOGLE_UI_SYSTEM_PROMPT : 'Create one finished UI design. Follow the user requirements and the assigned roles of all supplied images. No generated layout guide is supplied.') : '',
        semanticLayout,
        layoutGuide: {
          kind: layoutGuide.kind,
          role: layoutGuide.role,
          source: layoutGuide.source,
          clean: layoutGuide.clean,
          width: layoutGuide.width,
          height: layoutGuide.height,
          visualEncoding: layoutGuideEncoding,
        },
        referenceRoles,
        referenceSizes: references.map((reference, index) => (
          measuredSizes && measuredSizes[index].width > 0
            ? measuredSizes[index]
            : { width: positiveInteger(reference.width, 0), height: positiveInteger(reference.height, 0) }
        )),
        promptMentions: compiledMentions.mentions,
        state,
      })
      const workflow = workflowRun?.workflow
      if (!workflow || typeof workflow !== 'object') throw new Error('UI 生成工作流构建失败')

      emitProgress(onProgress, 'validate', '正在检查 UI 生成工作流', 0.26)
      await bridgeTimeout(
        bridge,
        () => bridge.validateWorkflowNodes(baseUrl, workflow),
        WORKFLOW_TIMEOUT_MS,
        '检查 UI 生成工作流超时',
      )
      throwIfAborted(signal)

      emitProgress(onProgress, 'submit', '正在下发 UI 生成任务', 0.3)
      const sent = await bridgeTimeout(
        bridge,
        () => bridge.requestJson(baseUrl, '/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, prompt: workflow }),
        }),
        PROMPT_TIMEOUT_MS,
        '下发 UI 生成任务超时',
      )
      throwIfAborted(signal)
      const sentData = responseData(sent)
      const promptId = cleanText(sentData?.prompt_id || sentData?.data?.prompt_id)
      if (!sent || sent.ok === false || !promptId) {
        throw new Error(cleanText(sent?.error || sent?.raw) || 'NovaFlow AI Runtime 未返回 prompt_id')
      }

      const startedAt = Date.now()
      let files = []
      let emptyQueueHits = 0
      while (Date.now() - startedAt < maxWaitMs) {
        throwIfAborted(signal)
        const history = await bridgeTimeout(
          bridge,
          () => bridge.requestJson(baseUrl, `/history/${encodeURIComponent(promptId)}`, { method: 'GET' }),
          HISTORY_TIMEOUT_MS,
          '读取 UI 生成结果超时',
        )
        throwIfAborted(signal)
        const item = historyItem(history, promptId)
        const historyError = cleanText(bridge.historyErrorMessage(item))
        if (historyError) throw new Error(historyError)
        files = (bridge.extractFiles(item) || []).filter(Boolean)
        if (files.length) break

        const queue = await bridge.readQueueState(baseUrl)
        throwIfAborted(signal)
        emptyQueueHits = queue?.empty ? emptyQueueHits + 1 : 0
        if (emptyQueueHits >= 4 && Date.now() - startedAt >= 10000) {
          throw new Error('UI 生成队列已结束，但 Runtime 未返回输出图片')
        }
        const elapsed = Date.now() - startedAt
        emitProgress(onProgress, 'running', 'UI 生成中', Math.min(0.94, 0.35 + elapsed / 180000), {
          promptId,
          queueRemaining: Math.max(0, Number(queue?.pending) || 0),
        })
        await wait(pollIntervalMs, signal)
      }
      throwIfAborted(signal)
      if (!files.length) throw new Error('UI 生成超时，未找到输出图片')

      const file = files[0]
      let blob = null
      emitProgress(onProgress, 'download', '正在载入 UI 设计结果', 0.96, { promptId })
      for (const outputFile of files) {
        const outputBlob = await bridgeTimeout(
          bridge,
          () => bridge.fetchBlob(baseUrl, resultFileUrl(outputFile)),
          DOWNLOAD_TIMEOUT_MS,
          '下载 UI 设计结果超时',
        )
        throwIfAborted(signal)
        if (!outputBlob) throw new Error('UI 设计结果下载失败')
        if (!blob) blob = outputBlob
      }
      const imageUrl = await bridge.blobToDataUrl(blob)
      throwIfAborted(signal)
      if (!cleanText(imageUrl)) throw new Error('UI 设计结果读取失败')

      const result = {
        id: `ui_design_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
        kind: 'ui-design',
        source: 'ui-design-generate',
        mode: executionMode,
        provider,
        promptId,
        generationPrompt: prompt,
        name: cleanText(file?.filename || file?.name) || `${outputPrefix}.png`,
        imageUrl,
        dataUrl: imageUrl,
        createdAt: new Date().toISOString(),
        workflow: cleanText(workflowRun?.modelKey) || provider,
        referenceCount: references.length,
        externalReferenceCount: refs.length,
        synthesisReferenceCount: references.length,
        analysisOnlyReferenceCount: localSynthesisSelection?.analysisOnlyReferences?.length || 0,
        analysisOnlyMentions: compiledMentions.analysisOnlyMentions,
        referenceRoles: referenceRoles.map((reference) => reference.role),
        semanticLayoutVersion: positiveInteger(semanticLayout.schemaVersion, 1),
        layoutGuideSource: cleanText(layoutGuide.source) || 'semantic-layout-compiler',
        layoutGuideEncoding,
        localIntent,
        referenceGuidedRedesign,
        localReferenceTreatments: localReferencePlan
          ? localReferencePlan.entries.map((reference) => cleanText(reference.treatment))
          : [],
        localReferenceProxyEncodings: localReferencePlan
          ? (localReferencePlan.transformed
              ? localReferencePlan.entries.map((reference) => cleanText(reference.proxyEncoding))
              : [])
          : [],
        localPrimaryReference: primaryReferencePlan
          ? {
              applied: primaryReferencePlan.applied === true,
              strategy: cleanText(primaryReferencePlan.strategy),
              referenceIndex: primaryReferencePlan.referenceIndex,
              modelImageNumber: synthesisPlan.primaryModelImageNumber,
              name: cleanText(primaryReferencePlan.name),
              sourceId: cleanText(primaryReferencePlan.sourceId),
              ...(cleanText(primaryReferencePlan.treatment)
                ? { treatment: cleanText(primaryReferencePlan.treatment) }
                : {}),
              ...(cleanText(primaryReferencePlan.proxyEncoding)
                ? { proxyEncoding: cleanText(primaryReferencePlan.proxyEncoding) }
                : {}),
            }
          : null,
        localSynthesisReferenceOrder: provider === 'local'
          ? {
              guideLast: synthesisPlan.guideLast === true,
              layoutGuideImageNumber: synthesisPlan.layoutGuideImageNumber,
              externalModelImageNumbers: [...sourceModelImageNumbers],
            }
          : null,
        localDirector: directorResult
          ? {
              status: cleanText(directorResult.status),
              used: directorResult.used === true,
              cached: directorResult.cached === true,
              error: cleanText(directorResult.error),
              styleProfile: directorResult.styleProfile || null,
              contentIdentityLock: directorResult.contentIdentityLock || null,
              contentLockPrompt: cleanText(directorResult.contentLockPrompt),
              referenceContentContract: directorResult.referenceContentContract || null,
              referenceContentPrompt: cleanText(directorResult.referenceContentPrompt),
            }
          : null,
        localContentIdentityLock: stateContentIdentityLock || directorResult?.contentIdentityLock || null,
        localContentLockPrompt: stateContentLockPrompt || cleanText(directorResult?.contentLockPrompt),
        localReferenceContentContract: directorResult?.referenceContentContract || null,
        localReferenceContentPrompt: cleanText(directorResult?.referenceContentPrompt),
        localWorkflow: workflowRun?.uiLocal || null,
        localEngine: qwen21 ? LOCAL_UI_ENGINE_QWEN21 : '',
      }
      emitProgress(onProgress, 'complete', 'UI 设计生成完成', 1, { promptId, result })
      return result
    } catch (error) {
      const cancelled = error?.name === 'AbortError' || signal?.aborted
      if (cancelled && runtimeBaseUrl) {
        Promise.resolve().then(() => bridge.requestJson(runtimeBaseUrl, '/interrupt', { method: 'POST' })).catch(() => {})
      }
      const finalError = cancelled && error?.name !== 'AbortError' ? abortError(signal?.reason) : error
      emitProgress(onProgress, cancelled ? 'cancelled' : 'error', cancelled ? '任务已中止' : cleanText(finalError?.message || finalError), 0, { error: finalError })
      throw finalError
    } finally {
      if (RUN_SIGNAL === signal) RUN_SIGNAL = null
      try {
        authorizationContext?.release?.()
      } catch {
        // Releasing the shared account lock is best-effort during teardown.
      }
    }
  }

  return Object.freeze({
    VERSION,
    MODE,
    LOCAL_REDESIGN_MODE,
    LOCAL_REDESIGN_MODEL_PROMPT_MAX_CHARS,
    UI_TASK_PROFILE,
    trustedStateContentLock,
    trustedStateContentLockPrompt,
    MAX_EXTERNAL_REFERENCES,
    referenceLimits,
    LOCAL_UI_ENGINE_QWEN21,
    providerCapability,
    compileQwen21UiPrompt,
    normalizeReferenceRole,
    externalReferences,
    externalReferenceSnapshot,
    localPrimaryReferencePlan,
    localReferenceSynthesisSelection,
    promoteSupportingMaterialReference,
    sourceAlignedModelImageNumbers,
    synthesisReferencePlan,
    compileUiMentions,
    assertStableUiMentionBindings,
    resolveSemanticLayout,
    resolveCleanLayoutGuide,
    positivelyRequestsHardwareCarrier,
    resolveUiOutputCarrier,
    normalizeScreenNativeUiText,
    isDigitalReelUi,
    localTxt2ImgTarget,
    compileLocalTxt2ImgPrompt,
    compileLocalPromptProtectionLock,
    compileLocalRedesignModelPrompt,
    compilePrompt,
    run,
  })
})
