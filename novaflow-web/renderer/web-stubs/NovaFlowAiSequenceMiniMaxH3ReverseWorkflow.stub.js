// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowAiSequenceMiniMaxH3ReverseWorkflow.
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
  __api["SNAPSHOT_VERSION"] = 3;
  __api["MINIMAX_H3_MODEL_ID"] = "minimax_h3_local";
  __api["H3_VISUAL_SCHEMA"] = "nf.h3.visual.v1";
  __api["MIN_DURATION_SECONDS"] = 1;
  __api["MAX_DURATION_SECONDS"] = 30;
  __api["CAPABILITIES"] = {"text_video":{"mode":"text_video","supportsOptimize":true,"supportsReverse":false,"reverseKind":"none","purpose":"","scenario":"","requiredSlots":[],"maxImages":0},"image_video":{"mode":"image_video","supportsOptimize":true,"supportsReverse":true,"reverseKind":"single_image_motion","purpose":"minimax-h3-i2v-reverse","scenario":"single_reference","requiredSlots":["first_frame"],"maxImages":1},"first_last":{"mode":"first_last","supportsOptimize":true,"supportsReverse":true,"reverseKind":"first_last_transition","purpose":"minimax-h3-fl2v-reverse","scenario":"video_frames","requiredSlots":["first_frame","last_frame"],"maxImages":2},"multi_reference":{"mode":"multi_reference","supportsOptimize":true,"supportsReverse":false,"reverseKind":"none","purpose":"","scenario":"","requiredSlots":[],"maxImages":0}};
  __api["normalizeContentPolicy"] = function normalizeContentPolicy(value) {
    if (promptWorkflow && typeof promptWorkflow.normalizeContentPolicy === 'function') {
      return promptWorkflow.normalizeContentPolicy(value)
    }
    const input = value && typeof value === 'object' ? value : {}
    const sensitiveVisualAnalysis = input.sensitiveVisualAnalysis === true
    const allSubjectsConfirmedAdult = input.allSubjectsConfirmedAdult === true
    return deepFreeze({ sensitiveVisualAnalysis, allSubjectsConfirmedAdult })
  };
  __api["containsDisallowedYoungOrMinorTerms"] = function containsDisallowedYoungOrMinorTerms(value) {
    const normalized = stringValue(value)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\byoung[- ]?adults?\b/giu, 'adult')
      .replace(/\u5e74\u8f7b(?:\u7684)?\u6210\u5e74(?:\u4eba|\u5973\u6027|\u7537\u6027|\u5973\u4eba|\u7537\u4eba)?/gu, '\u6210\u5e74\u4eba')
    if (!normalized) return false
    return /(?:\u672a\u6210\u5e74\u4eba?|\u672a\u6ee1\s*(?:18|\u5341\u516b)\s*\u5c81?|(?:18|\u5341\u516b)\s*\u5c81?\s*(?:\u4ee5\u4e0b|\u4ee5\u5185)|(?<![0-9])(?:1[0-7]|[0-9])\s*\u5c81(?![0-9])|\u513f\u7ae5|\u5b69\u7ae5|\u5c0f\u5b69|\u5e7c\u5973|\u5e7c\u7ae5|\u5e7c\u513f|\u5a74\u5e7c\u513f?|\u5a74\u513f|\u841d\u8389|\u6b63\u592a)|(?<![a-z0-9_])(?:underage|minors?|child(?:ren)?(?![-\s]?like\b)|juveniles?|loli|shota|under[-\s]*18|(?:1[0-7]|[0-9])[-\s]*years?[-\s]*old|(?:1[0-7]|[0-9])\s*y\s*\/?\s*o|aged?\s*(?:1[0-7]|[0-9]))(?![a-z0-9_])/iu.test(normalized)
  };
  __api["containsSensitiveContentTerms"] = function containsSensitiveContentTerms(value) {
    if (promptWorkflow && typeof promptWorkflow.containsSensitiveContentTerms === 'function') {
      return promptWorkflow.containsSensitiveContentTerms(value)
    }
    const normalized = stringValue(value)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/(?:\b(?:no|not|without)\b|(?:没有|不含|未见|无))(?:明显)?\s*(?:nudity|nude|naked|topless|sexual(?:\s+activity)?|explicit(?:\s+anatomy)?|裸体|裸露|性行为|生殖器|乳头|乳房)/giu, '')
    if (!normalized) return false
    return /(?:裸体|裸露|全裸|半裸|一丝不挂|性行为|性交|交合|性爱|性活动|生殖器|性器官|乳头|乳房|色情|情色|成人内容)|(?<![a-z0-9_])(?:nudity|nude|naked|topless|nsfw|porn(?:ographic|ography)?|sexual[_\s-]+(?:activity|act)|explicit[_\s-]+(?:activity|anatomy)|genitals?|penis|vagina|bare\s+breasts?)(?![a-z0-9_])/iu.test(normalized)
  };
  __api["getCapability"] = function getCapability(value) {
    return CAPABILITIES[normalizeMode(value)]
  };
  __api["createRequestSnapshot"] = function createRequestSnapshot(options) {
    const normalized = normalizeRequestState(options)
    const resources = normalized.resources.map((resource) => deepFreeze({
      key: resource.key,
      kind: resource.kind,
      identity: resource.identity,
      sourceId: resource.sourceId,
      dataFingerprint: resource.dataFingerprint,
    }))
    const values = {
      modelId: normalized.modelId,
      mode: normalized.selectedCapability.mode,
      durationSeconds: normalized.durationSeconds,
      prompt: normalized.prompt,
      requirements: normalized.requirements,
      contentPolicy: normalized.contentPolicy,
      resources,
    }
    return deepFreeze({
      schemaVersion: SNAPSHOT_VERSION,
      operation: 'reverse',
      ...values,
      fingerprint: `h3r${SNAPSHOT_VERSION}-${fingerprintText(snapshotPayload(values))}`,
    })
  };
  __api["snapshotFingerprint"] = function snapshotFingerprint(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.resources)) {
      throw new TypeError('MiniMax H3 reverse snapshot is invalid')
    }
    const values = {
      modelId: normalizeModelId(snapshot.modelId),
      mode: assertReverseCapability(snapshot.mode).mode,
      durationSeconds: normalizeDurationSeconds(snapshot.durationSeconds),
      prompt: stringValue(snapshot.prompt).trim(),
      requirements: stringValue(snapshot.requirements).trim(),
      contentPolicy: normalizeContentPolicy(snapshot.contentPolicy),
      resources: snapshot.resources.map((resource) => ({
        key: stringValue(resource.key).trim(),
        kind: stringValue(resource.kind).trim(),
        identity: stringValue(resource.identity).trim(),
        sourceId: stringValue(resource.sourceId).trim(),
        dataFingerprint: stringValue(resource.dataFingerprint).trim(),
      })),
    }
    return `h3r${SNAPSHOT_VERSION}-${fingerprintText(snapshotPayload(values))}`
  };
  __api["assertSnapshotIntegrity"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  __api["isRequestSnapshotStale"] = function isRequestSnapshotStale(snapshot, currentOptions) {
    try {
      assertSnapshotIntegrity(snapshot)
      return createRequestSnapshot(currentOptions).fingerprint !== snapshot.fingerprint
    } catch (_error) {
      return true
    }
  };
  __api["assertRequestSnapshotFresh"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  __api["assertContextIntegrity"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  __api["prepareRequest"] = function prepareRequest(options) {
    const normalized = normalizeRequestState(options)
    const selectedCapability = normalized.selectedCapability
    const outputLanguage = preferredOutputLanguage(normalized.prompt)
    const sourcePrompt = [normalized.prompt, reverseDirective(selectedCapability)].filter(Boolean).join('\n')
    const h3Resources = resourcesForPromptWorkflow(normalized.resources)
    const h3Prepared = requirePromptWorkflow().prepareRequest({
      promptFormat: 'legacy',
      modelId: normalized.modelId,
      mode: selectedCapability.mode,
      durationSeconds: normalized.durationSeconds,
      prompt: sourcePrompt,
      resources: h3Resources,
      contentPolicy: normalized.contentPolicy,
      requireReady: true,
    })
    const snapshot = createRequestSnapshot(options)
    const request = deepFreeze({
      purpose: selectedCapability.purpose,
      surface: 'animation',
      h3Mode: selectedCapability.mode,
      durationSeconds: normalized.durationSeconds,
      scenario: selectedCapability.scenario,
      sourceCount: normalized.resources.length,
      supportsNegativePrompt: false,
      negativePrompt: '',
      visualSchema: H3_VISUAL_SCHEMA,
      contentPolicy: normalized.contentPolicy,
      preferredOutputLanguage: outputLanguage,
      userPrompt: normalized.prompt,
      userRequirements: normalized.requirements,
      prompt: h3Prepared.prompt,
      currentPrompt: h3Prepared.prompt,
      requirements: [
        reverseContract(selectedCapability),
        h3Prepared.requirements,
        normalized.requirements ? `User requirements:\n${normalized.requirements}` : '',
      ].filter(Boolean).join('\n\n'),
      images: normalized.resources.map((resource) => ({
        name: resource.fileName,
        label: resource.label,
        role: resource.role,
        slotType: resource.role,
        dataUrl: resource.dataUrl,
      })),
    })
    const context = deepFreeze({
      schemaVersion: SNAPSHOT_VERSION,
      operation: 'reverse',
      modelId: normalized.modelId,
      mode: selectedCapability.mode,
      purpose: selectedCapability.purpose,
      durationSeconds: normalized.durationSeconds,
      sourcePrompt,
      snapshot,
      fingerprint: snapshot.fingerprint,
      visualSchema: H3_VISUAL_SCHEMA,
      contentPolicy: normalized.contentPolicy,
      h3Context: h3Prepared.context,
    })
    return deepFreeze({ capability: selectedCapability, request, context })
  };
  __api["prepareRefinement"] = function prepareRefinement(options) {
    const context = options.context
    assertContextIntegrity(context)
    if (!context.snapshot.requirements.trim()) return null
    const current = {
      modelId: context.modelId,
      mode: context.mode,
      durationSeconds: context.durationSeconds,
      prompt: stringValue(options.text).trim(),
      resources: resourcesForPromptWorkflow(context.snapshot.resources),
      contentPolicy: context.contentPolicy,
    }
    const prepared = requirePromptWorkflow().prepareRequest(current)
    return deepFreeze({
      prompt: prepared.prompt,
      requirements: prepared.requirements
        + '\n\n原始创作意图（仅保留未被最新补充要求修改的部分）：\n' + context.snapshot.prompt
        + '\n\n最新补充要求（优先于原提示词中的冲突设定；直接落实到描述与动作中，删除被替换的旧设定）：\n' + context.snapshot.requirements,
      h3Mode: context.mode,
      durationSeconds: context.durationSeconds,
      contentPolicy: context.contentPolicy,
      visualSchema: H3_VISUAL_SCHEMA,
      purpose: 'minimax-h3-prompt-enhance',
      surface: 'animation',
      supportsNegativePrompt: false,
      negativePrompt: '',
    })
  };
  __api["buildGuaranteedFallback"] = function buildGuaranteedFallback(options) {
    const input = options && typeof options === 'object' ? options : {}
    const context = input.context
    assertContextIntegrity(context)
    if (!input.current) throw new Error('MiniMax H3 reverse fallback current state is required')
    assertRequestSnapshotFresh(context.snapshot, input.current)
    const current = normalizeRequestState(input.current)
    const explicitPrompt = input.userPrompt === undefined ? current.prompt : stringValue(input.userPrompt).trim()
    if (explicitPrompt !== current.prompt) {
      throw new Error('MiniMax H3 reverse fallback userPrompt does not match the current snapshot')
    }
    throw new Error('MiniMax H3 reverse fallback requires a backend-validated visual fact payload; generic protocol fallback is not write-eligible')
  };
  __api["validateAndRestore"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  root["NovaFlowAiSequenceMiniMaxH3ReverseWorkflow"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
