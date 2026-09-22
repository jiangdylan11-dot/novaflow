// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowAiSequenceMiniMaxH3PromptWorkflow.
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
  __api["SNAPSHOT_VERSION"] = 4;
  __api["MINIMAX_H3_MODEL_ID"] = "minimax_h3_local";
  __api["H3_VISUAL_SCHEMA"] = "nf.h3.visual.v1";
  __api["MIN_DURATION_SECONDS"] = 1;
  __api["MAX_DURATION_SECONDS"] = 30;
  __api["MODE_ORDER"] = ["text_video","image_video","first_last","multi_reference"];
  __api["MODE_DEFINITIONS"] = {"text_video":{"value":"text_video","workflowMode":"t2v","protocolName":"T2VA","fieldOrder":["integrated_multimodal_description","overall_soundscape","non_diegetic_music"],"slots":[]},"image_video":{"value":"image_video","workflowMode":"i2v","protocolName":"I2VA","fieldOrder":["integrated_multimodal_description","overall_soundscape","non_diegetic_music"],"slots":[{"key":"first_frame","label":"首帧","kind":"image","fixedModelToken":"<Picture 1>","aliases":["@首帧","@参考图","@图片1"],"keyAliases":["first_frame","image","reference_image","referenceImage","start_image","startImage","i2v_image","ref_image"]}]},"first_last":{"value":"first_last","workflowMode":"fl2v","protocolName":"FL2VA","fieldOrder":["integrated_multimodal_description","overall_soundscape","non_diegetic_music"],"slots":[{"key":"first_frame","label":"首帧","kind":"image","fixedModelToken":"<Picture 1>","aliases":["@首帧","@参考图","@图片1"],"keyAliases":["first_frame","image","reference_image","referenceImage","start_image","startImage","i2v_image","ref_image"]},{"key":"last_frame","label":"尾帧","kind":"image","fixedModelToken":"<Picture 2>","aliases":["@尾帧","@结束帧","@图片2"],"keyAliases":["last_frame","end_image","endImage","last_image","lastImage"]}]},"multi_reference":{"value":"multi_reference","workflowMode":"r2v","protocolName":"Ref2VA","fieldOrder":["subject_definitions","summary","retention_analysis","detailed_description","overall_soundscape","non_diegetic_music"],"slots":[{"key":"multi_ref_image_1","label":"参考图1","kind":"image","fixedModelToken":"","aliases":["@参考图1","@图片1"],"keyAliases":["multi_ref_image_1"]},{"key":"multi_ref_image_2","label":"参考图2","kind":"image","fixedModelToken":"","aliases":["@参考图2","@图片2"],"keyAliases":["multi_ref_image_2"]},{"key":"multi_ref_image_3","label":"参考图3","kind":"image","fixedModelToken":"","aliases":["@参考图3","@图片3"],"keyAliases":["multi_ref_image_3"]},{"key":"multi_ref_image_4","label":"参考图4","kind":"image","fixedModelToken":"","aliases":["@参考图4","@图片4"],"keyAliases":["multi_ref_image_4"]},{"key":"multi_ref_video_1","label":"视频参考","kind":"video","fixedModelToken":"","aliases":["@视频参考","@视频1"],"keyAliases":["multi_ref_video_1"]},{"key":"multi_ref_audio_1","label":"声音参考","kind":"audio","fixedModelToken":"","aliases":["@声音参考","@音频1","@音频参考"],"keyAliases":["multi_ref_audio_1"]}]}};
  __api["BASE_FIELD_ORDER"] = ["integrated_multimodal_description","overall_soundscape","non_diegetic_music"];
  __api["REFERENCE_FIELD_ORDER"] = ["subject_definitions","summary","retention_analysis","detailed_description","overall_soundscape","non_diegetic_music"];
  __api["REFERENCE_RELATIONS"] = ["reference generation","keyframe completion","video editing","video continuation","audio reuse","audio reference"];
  __api["MULTI_REFERENCE_SLOTS"] = [{"key":"multi_ref_image_1","label":"参考图1","kind":"image","fixedModelToken":"","aliases":["@参考图1","@图片1"],"keyAliases":["multi_ref_image_1"]},{"key":"multi_ref_image_2","label":"参考图2","kind":"image","fixedModelToken":"","aliases":["@参考图2","@图片2"],"keyAliases":["multi_ref_image_2"]},{"key":"multi_ref_image_3","label":"参考图3","kind":"image","fixedModelToken":"","aliases":["@参考图3","@图片3"],"keyAliases":["multi_ref_image_3"]},{"key":"multi_ref_image_4","label":"参考图4","kind":"image","fixedModelToken":"","aliases":["@参考图4","@图片4"],"keyAliases":["multi_ref_image_4"]},{"key":"multi_ref_video_1","label":"视频参考","kind":"video","fixedModelToken":"","aliases":["@视频参考","@视频1"],"keyAliases":["multi_ref_video_1"]},{"key":"multi_ref_audio_1","label":"声音参考","kind":"audio","fixedModelToken":"","aliases":["@声音参考","@音频1","@音频参考"],"keyAliases":["multi_ref_audio_1"]}];
  __api["compileForGeneration"] = function () {
    throw new Error("NovaFlowAiSequenceMiniMaxH3PromptWorkflow.compileForGeneration runs on the compute node, not in the browser");
  };
  __api["normalizeContentPolicy"] = function normalizeContentPolicy(value) {
    const input = value && typeof value === 'object' ? value : {}
    const sensitiveVisualAnalysis = input.sensitiveVisualAnalysis === true
    const allSubjectsConfirmedAdult = input.allSubjectsConfirmedAdult === true
    return deepFreeze({ sensitiveVisualAnalysis, allSubjectsConfirmedAdult })
  };
  __api["containsExplicitMinorTerms"] = function containsExplicitMinorTerms(value) {
    const normalized = stringValue(value)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\byoung[- ]?adults?\b/giu, 'adult')
      .replace(/\u5e74\u8f7b(?:\u7684)?\u6210\u5e74(?:\u4eba|\u5973\u6027|\u7537\u6027|\u5973\u4eba|\u7537\u4eba)?/gu, '\u6210\u5e74\u4eba')
    return normalized ? EXPLICIT_MINOR_EXPRESSION.test(normalized) : false
  };
  __api["containsSensitiveContentTerms"] = function containsSensitiveContentTerms(value) {
    const normalized = stringValue(value)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/(?:\b(?:no|not|without)\b|(?:没有|不含|未见|无))(?:明显)?\s*(?:nudity|nude|naked|topless|sexual(?:\s+activity)?|explicit(?:\s+anatomy)?|裸体|裸露|性行为|生殖器|乳头|乳房)/giu, '')
    if (!normalized) return false
    return /(?:裸体|裸露|全裸|半裸|一丝不挂|性行为|性交|交合|性爱|性活动|口交|肛交|自慰|手淫|生殖器|性器官|阴茎|阴道|外阴|阴唇|阴蒂|肛门|乳头|乳房|精液|性体液|色情|情色|成人内容|性暗示|胸部暴露)|(?<![a-z0-9_])(?:nudity|nude|naked|topless|nsfw|porn(?:ographic|ography)?|sexual[_\s-]+(?:activity|act|fluid)|explicit[_\s-]+(?:activity|anatomy)|intercourse|oral\s+sex|anal\s+sex|masturbat(?:e|ion|ing)|genitals?|penis|vagina|vulva|anus|semen|bare\s+breasts?|exposed\s+breasts?)(?![a-z0-9_])/iu.test(normalized)
  };
  __api["normalizeModelId"] = function normalizeModelId(value) {
    const modelId = stringValue(value).trim()
    if (modelId !== MINIMAX_H3_MODEL_ID) {
      throw new Error(`Unsupported MiniMax H3 prompt model: ${modelId || '(empty)'}`)
    }
    return modelId
  };
  __api["normalizeMode"] = function normalizeMode(value) {
    const raw = stringValue(value).trim().toLowerCase()
    const compact = raw.replace(/[\s-]+/g, '_')
    const normalized = MODE_ALIAS[compact] || MODE_ALIAS[compact.replace(/_/g, '')]
    if (!normalized) throw new Error(`Unsupported MiniMax H3 prompt mode: ${raw || '(empty)'}`)
    return normalized
  };
  __api["getModeDefinition"] = function getModeDefinition(value) {
    return MODE_DEFINITIONS[normalizeMode(value)]
  };
  __api["getReferenceSchema"] = function getReferenceSchema(modeValue) {
    const definition = getModeDefinition(modeValue)
    return deepFreeze(definition.slots.map((slot) => ({
      slotKey: slot.key,
      displayLabel: slot.label,
      displayToken: slot.aliases[0],
      aliases: slot.aliases.slice(),
      kind: slot.kind,
      fixedModelToken: slot.fixedModelToken,
    })))
  };
  __api["createReferenceCatalog"] = function createReferenceCatalog(options) {
    const input = options && typeof options === 'object' ? options : {}
    const definition = getModeDefinition(input.mode)
    const bySlot = normalizeResources(definition, input.resources)
    const requireReady = input.requireReady !== false
    if (definition.value === 'text_video' && bySlot.size) {
      throw new Error('MiniMax H3 text_video does not accept reference resources')
    }
    if (requireReady && definition.value !== 'text_video') {
      if (definition.value === 'multi_reference' && bySlot.size === 0) {
        throw new Error('MiniMax H3 multi_reference requires at least one reference resource')
      }
      if (definition.value !== 'multi_reference') {
        definition.slots.forEach((slot) => {
          if (!bySlot.has(slot.key)) throw new Error(`${slot.label} has not been provided`)
        })
      }
    }

    const compactIndex = { image: 0, video: 0, audio: 0 }
    const references = []
    definition.slots.forEach((descriptor) => {
      const resource = bySlot.get(descriptor.key)
      if (!resource) return
      compactIndex[descriptor.kind] += 1
      references.push(Object.freeze({
        slotKey: descriptor.key,
        displayLabel: descriptor.label,
        displayToken: descriptor.aliases[0],
        aliases: descriptor.aliases,
        kind: descriptor.kind,
        modelToken: modelTokenFor(descriptor, compactIndex[descriptor.kind]),
        identity: resource.identity,
        sourceId: resource.sourceId,
        fileName: resource.fileName,
        mimeType: resource.mimeType,
      }))
    })

    const byModelToken = {}
    const byDisplayToken = {}
    const bySlotKey = {}
    references.forEach((reference) => {
      byModelToken[reference.modelToken] = reference.displayToken
      bySlotKey[reference.slotKey] = reference.modelToken
      reference.aliases.forEach((alias) => { byDisplayToken[alias] = reference.modelToken })
    })
    const signature = references.map((reference) => [
      reference.slotKey,
      reference.kind,
      reference.modelToken,
      reference.identity,
    ].join('\u001f')).join('\u001e')

    return deepFreeze({
      mode: definition.value,
      workflowMode: definition.workflowMode,
      protocolName: definition.protocolName,
      references,
      modelTokens: references.map((reference) => reference.modelToken),
      displayTokens: references.map((reference) => reference.displayToken),
      byModelToken,
      byDisplayToken,
      bySlotKey,
      signature,
    })
  };
  __api["toModelReferences"] = function toModelReferences(text, catalogValue) {
    const catalog = assertCatalog(catalogValue)
    const source = stringValue(text)
    assertNoUnavailableDisplayTokens(source, catalog)
    const compiled = replaceTokens(source, catalog.byDisplayToken)
    assertNoUnavailableModelTokens(compiled, catalog, { allowSubjects: catalog.mode === 'multi_reference' })
    return compiled
  };
  __api["toDisplayReferences"] = function toDisplayReferences(text, catalogValue) {
    const catalog = assertCatalog(catalogValue)
    const source = stringValue(text)
    assertNoUnavailableModelTokens(source, catalog, { allowSubjects: catalog.mode === 'multi_reference' })
    return replaceTokens(source, catalog.byModelToken)
  };
  __api["createPromptProtocol"] = function createPromptProtocol(options) {
    const input = options && typeof options === 'object' ? options : {}
    const definition = getModeDefinition(input.mode)
    const durationSeconds = normalizeDurationSeconds(input.durationSeconds)
    const contentPolicy = normalizeContentPolicy(input.contentPolicy)
    const catalog = createReferenceCatalog({
      mode: definition.value,
      resources: input.resources,
      requireReady: input.requireReady,
    })
    return deepFreeze({
      schemaVersion: SNAPSHOT_VERSION,
      mode: definition.value,
      workflowMode: definition.workflowMode,
      protocolName: definition.protocolName,
      durationSeconds,
      fieldOrder: definition.fieldOrder.slice(),
      alignment: alignmentRule(definition, durationSeconds),
      relations: definition.value === 'multi_reference' ? REFERENCE_RELATIONS.slice() : [],
      references: catalog,
      visualSchema: H3_VISUAL_SCHEMA,
      contentPolicy,
    })
  };
  __api["createPromptSnapshot"] = function createPromptSnapshot(options) {
    const input = options && typeof options === 'object' ? options : {}
    const modelId = normalizeModelId(input.modelId)
    const protocol = createPromptProtocol(input)
    const prompt = stringValue(input.prompt).trim()
    if (!prompt) throw new Error('MiniMax H3 source prompt cannot be empty')
    const payload = snapshotPayload(modelId, protocol.mode, protocol.durationSeconds, prompt, protocol.references, protocol.contentPolicy)
    return deepFreeze({
      schemaVersion: SNAPSHOT_VERSION,
      modelId,
      mode: protocol.mode,
      workflowMode: protocol.workflowMode,
      protocolName: protocol.protocolName,
      durationSeconds: protocol.durationSeconds,
      prompt,
      visualSchema: H3_VISUAL_SCHEMA,
      contentPolicy: protocol.contentPolicy,
      references: protocol.references.references.map((reference) => ({
        slotKey: reference.slotKey,
        displayLabel: reference.displayLabel,
        displayToken: reference.displayToken,
        aliases: reference.aliases.slice(),
        kind: reference.kind,
        modelToken: reference.modelToken,
        identity: reference.identity,
        sourceId: reference.sourceId,
        fileName: reference.fileName,
        mimeType: reference.mimeType,
      })),
      referenceSignature: protocol.references.signature,
      fingerprint: fingerprintText(payload),
    })
  };
  __api["snapshotFingerprint"] = function snapshotFingerprint(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.references)) {
      throw new TypeError('MiniMax H3 prompt snapshot is invalid')
    }
    return fingerprintText(snapshotPayload(
      normalizeModelId(snapshot.modelId),
      normalizeMode(snapshot.mode),
      normalizeDurationSeconds(snapshot.durationSeconds),
      stringValue(snapshot.prompt).trim(),
      { references: snapshot.references },
      normalizeContentPolicy(snapshot.contentPolicy),
    ))
  };
  __api["assertSnapshotIntegrity"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  __api["isPromptSnapshotStale"] = function isPromptSnapshotStale(snapshot, currentOptions) {
    try {
      assertSnapshotIntegrity(snapshot)
      const current = createPromptSnapshot(currentOptions)
      return current.fingerprint !== snapshot.fingerprint
    } catch (_error) {
      return true
    }
  };
  __api["assertPromptSnapshotFresh"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  __api["assertContextIntegrity"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  __api["isContextStale"] = function isContextStale(context, currentOptions) {
    try {
      assertContextIntegrity(context)
      return isPromptSnapshotStale(context.snapshot, currentOptions)
    } catch (_error) {
      return true
    }
  };
  __api["assertContextFresh"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  __api["validatePromptText"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  __api["prepareRequest"] = function () {
    throw new Error("NovaFlowAiSequenceMiniMaxH3PromptWorkflow.prepareRequest runs on the compute node, not in the browser");
  };
  __api["validateAndRestore"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  root["NovaFlowAiSequenceMiniMaxH3PromptWorkflow"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
