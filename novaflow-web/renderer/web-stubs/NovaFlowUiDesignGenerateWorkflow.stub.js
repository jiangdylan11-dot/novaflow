// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowUiDesignGenerateWorkflow.
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
  __api["VERSION"] = "20260730-ui-design-generate-workflow-7";
  __api["MODE"] = "img2img";
  __api["LOCAL_REDESIGN_MODE"] = "img2img";
  __api["LOCAL_REDESIGN_MODEL_PROMPT_MAX_CHARS"] = 1800;
  __api["LOCAL_REFINEMENT_MODEL_PROMPT_MAX_CHARS"] = 1800;
  __api["UI_TASK_PROFILE"] = "ui-design";
  __api["UI_REFINE_TASK_PROFILE"] = "ui-design-refine";
  __api["REFINEMENT_BASE_ENCODING"] = "ui-candidate-base-v1";
  __api["REPAIR_MASK_ENCODING"] = "semantic-repair-mask-v1";
  __api["CONTROLLED_STRUCTURE_REFINEMENT_CONTRACT"] = ["Image 1 is the only visual base and already establishes one screen-native full-screen digital interface.","Preserve every correct theme, subject, region order and control group from Image 1. Reconstruct only the missing or incorrect regions, item counts and controls explicitly required below.","Keep all repaired regions and controls as screen-native software graphics on the same flat orthographic viewport.","The image boundary remains the interface viewport boundary, with every visible element integrated into the existing digital screen composition.","The written user target and quality correction below are a literal content identity lock: every named subject, stated identity attribute, required item, required count and required control must visibly match. Never substitute a generic archetype for a named subject.","Keep the same edge-to-edge screen composition while closing the missing functional structure. Output only the finished interface pixels."];
  __api["POLISH_REFINEMENT_CONTRACT"] = ["Image 1 is the current finished UI candidate and the only visual base for this refinement pass.","Preserve its requested theme, subjects, page regions, control positions, item counts and functional meaning unless the correction requirements explicitly say otherwise.","Improve only the identified hierarchy, material coherence, lighting coherence, asset consistency, readability and commercial completeness problems. Do not redesign unrelated content."];
  __api["MAX_EXTERNAL_REFERENCES"] = 2;
  __api["referenceLimits"] = {"local":{"provider":"local","totalReferenceLimit":3,"externalReferenceLimit":2,"reservedLayoutReferences":1,"negativePrompt":true},"gpt":{"provider":"gpt","totalReferenceLimit":16,"externalReferenceLimit":15,"reservedLayoutReferences":1,"negativePrompt":false},"google":{"provider":"google","totalReferenceLimit":14,"externalReferenceLimit":13,"reservedLayoutReferences":1,"negativePrompt":false}};
  __api["trustedStateContentLock"] = function trustedStateContentLock(state = {}) {
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
  };
  __api["trustedStateContentLockPrompt"] = function trustedStateContentLockPrompt(state = {}) {
    const director = localDirectorApi()
    const lock = trustedStateContentLock(state)
    return lock && typeof director?.contentLockPromptFromContract === 'function'
      ? cleanText(director.contentLockPromptFromContract(lock))
      : ''
  };
  __api["providerCapability"] = function providerCapability(provider) {
    return referenceLimits[normalizeProvider(provider)]
  };
  __api["normalizeReferenceRole"] = function normalizeReferenceRole(value) {
    const role = cleanText(value).toLowerCase().replace(/[\s_]+/g, '-')
    if (/^(style|visual-style|风格)$/.test(role)) return 'style'
    if (/^(character|role|角色)$/.test(role)) return 'character'
    if (/^(subject|identity|主体)$/.test(role)) return 'subject'
    if (/^(material|texture|材质)$/.test(role)) return 'material'
    if (/^(color|palette|配色|色彩)$/.test(role)) return 'color'
    if (/^(layout|ui-layout|ui_layout|布局)$/.test(role)) return 'layout'
    if (/^(content|asset|素材|内容)$/.test(role)) return 'content'
    return 'reference'
  };
  __api["externalReferences"] = function externalReferences(refs) {
    return (Array.isArray(refs) ? refs : [])
      .map((item, index) => normalizeReference(item, `ui_reference_${index + 1}.png`))
      .filter(Boolean)
  };
  __api["externalReferenceSnapshot"] = function externalReferenceSnapshot(refs) {
    return Object.freeze(externalReferences(refs).map((reference) => Object.freeze({ ...reference })))
  };
  __api["localPrimaryReferencePlan"] = function localPrimaryReferencePlan(refs, canvas = {}, intent = '') {
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
  };
  __api["localReferenceSynthesisSelection"] = function localReferenceSynthesisSelection(refs, primaryReferencePlan = null, intent = '') {
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
  };
  __api["promoteSupportingMaterialReference"] = async function promoteSupportingMaterialReference(primaryReferencePlan, referenceWorkflow, options = {}) {
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
  };
  __api["sourceAlignedModelImageNumbers"] = function sourceAlignedModelImageNumbers(sourceRefs, modelRefs, modelImageNumbers) {
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
  };
  __api["synthesisReferencePlan"] = function synthesisReferencePlan(options = {}) {
    const provider = normalizeProvider(options.provider)
    const intent = cleanText(options.intent).toLowerCase()
    const refinementCandidate = options.refinementCandidate || null
    const layoutGuide = options.layoutGuide || null
    const modelRefs = Array.isArray(options.modelRefs) ? options.modelRefs : []
    const primaryReferencePlan = options.primaryReferencePlan || null
    if (refinementCandidate) {
      return Object.freeze({
        references: Object.freeze([refinementCandidate]),
        externalModelImageNumbers: Object.freeze([]),
        layoutGuideIndex: 0,
        layoutGuideImageNumber: 1,
        primaryModelImageNumber: 0,
        guideLast: false,
      })
    }

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
  };
  __api["compileUiMentions"] = function compileUiMentions(value, refs, options = {}) {
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
      mentions.push(Object.freeze({
        token,
        referenceIndex,
        modelImageNumber,
        modelLabel: `图${modelImageNumber}`,
        sourceId: cleanText(reference.sourceId),
      }))
      return `图${modelImageNumber}`
    })
    return Object.freeze({
      text,
      mentions: Object.freeze(mentions),
      analysisOnlyMentions: Object.freeze(analysisOnlyMentions),
      invalidTokens: Object.freeze(invalidTokens),
    })
  };
  __api["assertStableUiMentionBindings"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  __api["resolveSemanticLayout"] = function resolveSemanticLayout(project, options, state) {
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
  };
  __api["resolveCleanLayoutGuide"] = function resolveCleanLayoutGuide(project, options, state, semanticLayout, visualEncoding = '') {
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
    return {
      schemaVersion: 1,
      kind: 'ui-layout-guide',
      role: 'ui_layout',
      source: 'semantic-only-safe-fallback',
      clean: true,
      editorSnapshot: false,
      name: legacyGuideName(project, options),
      dataUrl: SAFE_FALLBACK_GUIDE_DATA_URL,
      width: semanticLayout.canvas.width,
      height: semanticLayout.canvas.height,
      visualEncoding: FILLED_REGIONS_VISUAL_ENCODING,
      semantic: semanticLayout,
    }
  };
  __api["normalizeRefinementCandidate"] = function normalizeRefinementCandidate(value) {
    if (!value || typeof value !== 'object') return null
    const dataUrl = cleanText(value.dataUrl || value.imageUrl || value.url || value.src)
    if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(dataUrl)) {
      throw new TypeError('Local UI refinement requires a PNG, JPEG or WebP candidate data URL')
    }
    return Object.freeze({
      id: cleanText(value.id || value.resultId),
      name: uploadedName(value, 'ui_design_first_pass.png'),
      role: 'ui_base',
      treatment: 'base',
      dataUrl,
      width: positiveInteger(value.width, 0),
      height: positiveInteger(value.height, 0),
    })
  };
  __api["localRefinementContract"] = function localRefinementContract(state = {}) {
    return cleanText(state.localUiRefinePreset).toLowerCase().replace(/[\s_]+/g, '-') === 'enhanced-redraw'
      ? CONTROLLED_STRUCTURE_REFINEMENT_CONTRACT
      : POLISH_REFINEMENT_CONTRACT
  };
  __api["compileLocalRefinementPrompt"] = function compileLocalRefinementPrompt(basePrompt, state = {}, options = {}) {
    const carrierIntent = cleanText(options.carrierIntent).toLowerCase() === 'hardware' ? 'hardware' : 'screen'
    const repairTokens = [...new Set(
      (Array.isArray(options.repairTokens) ? options.repairTokens : [])
        .map((item) => cleanText(item).toLowerCase())
        .filter((item) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(item)),
    )]
    const maskedTargets = repairTokens.length
      ? `[MASKED TARGETS] ${repairTokens.join(', ')}; every listed UI item must be visibly present, distinct and legible inside the editable mask; preserve all unmasked pixels`
      : ''
    const qualityCorrection = compactLocalModelText(
      normalizeScreenNativeUiText(options.qualityCorrectionPrompt, carrierIntent),
      280,
    )
    const enhancedRedraw = cleanText(state.localUiRefinePreset)
      .toLowerCase()
      .replace(/[\s_]+/g, '-') === 'enhanced-redraw'
    const contract = localRefinementContract(state)
      .filter((item, index) => !enhancedRedraw || index !== 3)
      .join('； ')
    const contentLock = compactLocalModelText(
      normalizeScreenNativeUiText(trustedStateContentLockPrompt(state), carrierIntent),
      420,
    )
    const fixedParts = [
      maskedTargets,
      qualityCorrection ? `[FIX - HIGHEST PRIORITY] ${qualityCorrection}` : '',
      contract,
      contentLock,
    ].filter(Boolean)
    const fixedText = fixedParts.join('； ')
    const separatorBudget = fixedText ? 2 : 0
    const baseBudget = Math.max(
      160,
      LOCAL_REFINEMENT_MODEL_PROMPT_MAX_CHARS - fixedText.length - separatorBudget,
    )
    const compactBase = compactLocalModelText(
      normalizeScreenNativeUiText(basePrompt, carrierIntent),
      baseBudget,
    )
    const prompt = [...fixedParts, compactBase].filter(Boolean).join('； ')
    return prompt.length <= LOCAL_REFINEMENT_MODEL_PROMPT_MAX_CHARS
      ? prompt
      : compactLocalModelText(prompt, LOCAL_REFINEMENT_MODEL_PROMPT_MAX_CHARS)
  };
  __api["positivelyRequestsHardwareCarrier"] = function positivelyRequestsHardwareCarrier(value) {
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
  };
  __api["resolveUiOutputCarrier"] = function resolveUiOutputCarrier(...values) {
    return values.some((value) => positivelyRequestsHardwareCarrier(value)) ? 'hardware' : 'screen'
  };
  __api["normalizeScreenNativeUiText"] = function normalizeScreenNativeUiText(value, carrierIntent = 'screen') {
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
  };
  __api["isDigitalReelUi"] = function isDigitalReelUi(...values) {
    return values.some((value) => /(?:老虎机|数字转轴|slot(?:\s+machine)?|spin|reel|wild|scatter|jackpot)/i.test(cleanText(value)))
  };
  __api["localTxt2ImgTarget"] = function localTxt2ImgTarget(value, carrierIntent = 'screen') {
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
  };
  __api["compileLocalTxt2ImgPrompt"] = function compileLocalTxt2ImgPrompt(options = {}) {
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
  };
  __api["compileLocalPromptProtectionLock"] = function compileLocalPromptProtectionLock(options = {}) {
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
  };
  __api["compileLocalRedesignModelPrompt"] = function compileLocalRedesignModelPrompt(options = {}) {
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
  };
  __api["compilePrompt"] = function compilePrompt(project = {}, refs = [], semanticInput = null, options = {}) {
    return compilePromptFromReferences(project, externalReferences(refs), semanticInput, options)
  };
  __api["run"] = async function run(options = {}) {
    const bridge = executionBridge(options)
    const state = options.state && typeof options.state === 'object' ? options.state : {}
    state.mode = MODE
    const provider = normalizeProvider(options.provider || state.provider)
    state.provider = provider
    const refinementCandidate = options.refinementCandidate
      ? normalizeRefinementCandidate(options.refinementCandidate)
      : null
    const repairMask = refinementCandidate ? normalizeRepairMask(options.repairMask) : null
    if (refinementCandidate && provider !== 'local') {
      throw new Error('UI candidate refinement is available only for the Local provider')
    }
    if (repairMask) state.localUiRepairMaskEncoding = repairMask.visualEncoding
    const signal = options.signal || null
    const onProgress = options.onProgress || options.progress
    const project = options.project && typeof options.project === 'object' ? options.project : {}
    // The exact same ordered snapshot drives @ mentions, prompt numbering,
    // upload order and workflow reference metadata.
    const refs = externalReferenceSnapshot(options.refs || options.references)
    const capability = validateExternalReferenceCount(provider, refs)
    const semanticLayout = resolveSemanticLayout(project, options, state)
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
    const requestedLayoutGuideEncoding = provider === 'local'
      ? SOFT_UI_SEMANTIC_SCAFFOLD_ENCODING
      : provider === 'google'
        ? SOFT_LAYOUT_GUIDE_ENCODING
        : ''
    const layoutGuide = resolveCleanLayoutGuide(project, options, state, semanticLayout, requestedLayoutGuideEncoding)
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
      if (refinementCandidate) {
        localIntent = 'refinement'
        modelRefs = []
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
      && !refinementCandidate
    const executionMode = MODE
    state.mode = executionMode
    const synthesisPlan = synthesisReferencePlan({
      provider,
      intent: localIntent,
      refinementCandidate,
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
    const referenceRoles = references.map((reference, index) => ({
      index,
      role: refinementCandidate && index === 0
        ? 'ui_base'
        : index === synthesisPlan.layoutGuideIndex
          ? 'ui_layout'
        : normalizeReferenceRole(reference.role),
      name: reference.name,
      sourceId: cleanText(reference.sourceId),
      targetNodeId: cleanText(reference.targetNodeId),
      autoPrimary: reference.autoPrimary === true,
      roleSource: cleanText(reference.roleSource),
      treatment: refinementCandidate && index === 0
        ? 'base'
        : index === synthesisPlan.layoutGuideIndex
          ? 'layout-guide'
        : cleanText(reference.treatment),
      proxyEncoding: refinementCandidate && index === 0
        ? REFINEMENT_BASE_ENCODING
        : index === synthesisPlan.layoutGuideIndex
          ? layoutGuideEncoding
        : cleanText(reference.proxyEncoding),
    }))
    const compiled = referenceGuidedRedesign
      ? ''
      : compilePromptFromReferences(project, modelRefs, semanticLayout, {
          provider,
          localIntent,
          carrierIntent,
          userPrompt: originalUserPrompt,
          layoutGuideEncoding: refinementCandidate ? REFINEMENT_BASE_ENCODING : layoutGuideEncoding,
          refinementBase: Boolean(refinementCandidate),
          refinementContractOwned: provider === 'local' && Boolean(refinementCandidate),
          textOnlyLayout: false,
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
    const conciseRedesignMentionSource = referenceGuidedRedesign
      ? (
          modelUserPrompt
          || normalizeScreenNativeUiText(directorResult?.prompt, carrierIntent)
          || normalizeScreenNativeUiText(project.description || semanticLayout.description, carrierIntent)
        )
      : directedUserPrompt
    const compiledMentions = assertValidUiMentions(compileUiMentions(conciseRedesignMentionSource, refs, {
      analysisOnly: provider === 'local' && localIntent === 'refinement',
      analysisOnlyReferenceIndexes: localSynthesisSelection?.analysisOnlyReferenceIndexes,
      analysisOnlyReplacement: refinementCandidate
        ? '当前候选成品中已经建立的原始视觉方向'
        : '',
      modelImageNumbers: sourceModelImageNumbers,
    }))
    assertStableUiMentionBindings(options.prompt, refs, state.promptMentionBindings)
    const supplementalPrompt = cleanText(compiledMentions.text)
    const basePrompt = referenceGuidedRedesign
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
          refinementCandidate
            ? compileLocalRefinementPrompt(basePrompt, state, {
                carrierIntent,
                qualityCorrectionPrompt: options.qualityCorrectionPrompt,
                repairTokens: repairMask?.selectedTokens,
              })
            : (
                referenceGuidedRedesign
                  ? basePrompt
                  : localWorkflowApi().compileAntiCopyPrompt(basePrompt, {
                      state,
                      referenceRoles,
                      textOnly: false,
                      carrierIntent,
                    })
              )
        )
      : basePrompt
    const directedNegativePrompt = cleanText(directorResult?.negativePrompt)
    const digitalCanvasNegativePrompt = provider === 'local'
      && ['redesign', 'refinement'].includes(localIntent)
      ? (
          referenceGuidedRedesign || refinementCandidate
            ? LOCAL_REFERENCE_UI_NEGATIVE_PROMPT
            : DIGITAL_UI_CANVAS_NEGATIVE_PROMPT
        )
      : ''
    const negativePrompt = capability.negativePrompt
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

      const uploadedNames = []
      for (let index = 0; index < references.length; index += 1) {
        const reference = references[index]
        const externalReferenceIndex = modelRefs.indexOf(reference)
        const label = refinementCandidate && index === 0
          ? '正在上传当前 UI 候选图'
          : index === synthesisPlan.layoutGuideIndex
            ? '正在上传干净布局控制图'
            : `正在上传参考图${externalReferenceIndex + 1}`
        emitProgress(onProgress, 'upload', label, 0.08 + (index / Math.max(1, references.length)) * 0.12, {
          referenceIndex: index,
          referenceRole: reference.role || 'reference',
        })
        const upload = await bridge.uploadDataUrl(baseUrl, reference.name, reference.dataUrl)
        throwIfAborted(signal)
        uploadedNames.push(uploadedName(upload, reference.name))
      }
      if (repairMask) {
        emitProgress(onProgress, 'upload', '正在上传语义局部修复蒙版', 0.21, {
          referenceRole: 'repair_mask',
        })
        const upload = await bridge.uploadDataUrl(baseUrl, repairMask.name, repairMask.dataUrl)
        throwIfAborted(signal)
        uploadedNames.push(uploadedName(upload, repairMask.name))
      }

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
        taskProfile: refinementCandidate ? UI_REFINE_TASK_PROFILE : UI_TASK_PROFILE,
        layoutGuideEncoding: refinementCandidate ? REFINEMENT_BASE_ENCODING : layoutGuideEncoding,
        systemPrompt: provider === 'google' ? GOOGLE_UI_SYSTEM_PROMPT : '',
        semanticLayout,
        layoutGuide: refinementCandidate
          ? {
              kind: 'ui-design-candidate-base',
              role: 'ui_base',
              source: 'quality-refinement',
              clean: true,
              width: refinementCandidate.width || semanticLayout.canvas.width,
              height: refinementCandidate.height || semanticLayout.canvas.height,
              visualEncoding: REFINEMENT_BASE_ENCODING,
            }
          : {
              kind: layoutGuide.kind,
              role: layoutGuide.role,
              source: layoutGuide.source,
              clean: layoutGuide.clean,
              width: layoutGuide.width,
              height: layoutGuide.height,
              visualEncoding: layoutGuideEncoding,
            },
        referenceRoles,
        referenceSizes: references.map((reference) => ({
          width: positiveInteger(reference.width, 0),
          height: positiveInteger(reference.height, 0),
        })),
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
        analysisOnlyReferenceCount: provider === 'local' && localIntent === 'refinement'
          ? refs.length
          : (localSynthesisSelection?.analysisOnlyReferences?.length || 0),
        analysisOnlyMentions: compiledMentions.analysisOnlyMentions,
        referenceRoles: referenceRoles.map((reference) => reference.role),
        semanticLayoutVersion: positiveInteger(semanticLayout.schemaVersion, 1),
        layoutGuideSource: refinementCandidate
          ? 'quality-refinement'
          : (cleanText(layoutGuide.source) || 'semantic-layout-compiler'),
        layoutGuideEncoding: refinementCandidate ? REFINEMENT_BASE_ENCODING : layoutGuideEncoding,
        ...(repairMask
          ? {
              repairMaskEncoding: repairMask.visualEncoding,
              repairMaskSelectedTokens: [...repairMask.selectedTokens],
            }
          : {}),
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
        localRefinement: workflowRun?.uiRefine || null,
      }
      emitProgress(onProgress, 'complete', 'UI 设计生成完成', 1, { promptId, result })
      return result
    } catch (error) {
      const cancelled = error?.name === 'AbortError' || signal?.aborted
      const finalError = cancelled && error?.name !== 'AbortError' ? abortError(signal?.reason) : error
      emitProgress(onProgress, cancelled ? 'cancelled' : 'error', cancelled ? '已取消 UI 生成' : cleanText(finalError?.message || finalError), 0, { error: finalError })
      throw finalError
    } finally {
      try {
        authorizationContext?.release?.()
      } catch {
        // Releasing the shared account lock is best-effort during teardown.
      }
    }
  };
  root["NovaFlowUiDesignGenerateWorkflow"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
