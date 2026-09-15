(function (root, factory) {
  const promptWorkflow = typeof module === 'object' && module.exports
    ? require('./ai-sequence-minimax-h3-prompt.workflow.js')
    : root && root.NovaFlowAiSequenceMiniMaxH3PromptWorkflow
  const api = factory(promptWorkflow)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceMiniMaxH3ReverseWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (promptWorkflow) {
  'use strict'

  const SNAPSHOT_VERSION = 3
  const MINIMAX_H3_MODEL_ID = 'minimax_h3_local'
  const H3_VISUAL_SCHEMA = 'nf.h3.visual.v1'
  const MIN_DURATION_SECONDS = 1
  const MAX_DURATION_SECONDS = 30
  const IMAGE_DATA_URL_EXPRESSION = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i

  function capability(mode, supportsReverse, reverseKind, purpose, scenario, requiredSlots) {
    return Object.freeze({
      mode,
      supportsOptimize: true,
      supportsReverse,
      reverseKind,
      purpose,
      scenario,
      requiredSlots: Object.freeze(requiredSlots.slice()),
      maxImages: requiredSlots.length,
    })
  }

  const CAPABILITIES = Object.freeze({
    text_video: capability('text_video', false, 'none', '', '', []),
    image_video: capability(
      'image_video',
      true,
      'single_image_motion',
      'minimax-h3-i2v-reverse',
      'single_reference',
      ['first_frame'],
    ),
    first_last: capability(
      'first_last',
      true,
      'first_last_transition',
      'minimax-h3-fl2v-reverse',
      'video_frames',
      ['first_frame', 'last_frame'],
    ),
    multi_reference: capability('multi_reference', false, 'none', '', '', []),
  })

  const SLOT_DEFINITIONS = Object.freeze({
    first_frame: Object.freeze({ key: 'first_frame', label: '\u9996\u5e27', role: 'first_frame' }),
    last_frame: Object.freeze({ key: 'last_frame', label: '\u5c3e\u5e27', role: 'last_frame' }),
  })

  function deepFreeze(value, seen) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
    const visited = seen || new Set()
    if (visited.has(value)) return value
    visited.add(value)
    Object.keys(value).forEach((key) => deepFreeze(value[key], visited))
    return Object.freeze(value)
  }

  function stringValue(value) {
    return value == null ? '' : String(value)
  }

  function normalizeMode(value) {
    const raw = stringValue(value).trim().toLowerCase()
    const compact = raw.replace(/[\s-]+/g, '_')
    const aliases = {
      text_video: 'text_video',
      textvideo: 'text_video',
      t2v: 'text_video',
      image_video: 'image_video',
      imagevideo: 'image_video',
      i2v: 'image_video',
      first_last: 'first_last',
      firstlast: 'first_last',
      fl2v: 'first_last',
      multi_reference: 'multi_reference',
      multireference: 'multi_reference',
      r2v: 'multi_reference',
    }
    const normalized = aliases[compact] || aliases[compact.replace(/_/g, '')]
    if (!normalized) throw new Error(`Unsupported MiniMax H3 reverse mode: ${raw || '(empty)'}`)
    return normalized
  }

  function normalizeModelId(value) {
    const modelId = stringValue(value).trim()
    if (modelId !== MINIMAX_H3_MODEL_ID) {
      throw new Error(`Unsupported MiniMax H3 reverse model: ${modelId || '(empty)'}`)
    }
    return modelId
  }

  function normalizeDurationSeconds(value) {
    const durationSeconds = Number(value)
    if (!Number.isFinite(durationSeconds)) throw new TypeError('MiniMax H3 reverse durationSeconds must be a finite number')
    if (durationSeconds < MIN_DURATION_SECONDS || durationSeconds > MAX_DURATION_SECONDS) {
      throw new RangeError(`MiniMax H3 reverse durationSeconds must be between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS}`)
    }
    return Math.round(durationSeconds * 1000) / 1000
  }

  function normalizeContentPolicy(value) {
    if (promptWorkflow && typeof promptWorkflow.normalizeContentPolicy === 'function') {
      return promptWorkflow.normalizeContentPolicy(value)
    }
    const input = value && typeof value === 'object' ? value : {}
    const sensitiveVisualAnalysis = input.sensitiveVisualAnalysis === true
    const allSubjectsConfirmedAdult = input.allSubjectsConfirmedAdult === true
    return deepFreeze({ sensitiveVisualAnalysis, allSubjectsConfirmedAdult })
  }

  function containsSensitiveContentTerms(value) {
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
  }

  function containsDisallowedYoungOrMinorTerms(value) {
    const normalized = stringValue(value)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\byoung[- ]?adults?\b/giu, 'adult')
      .replace(/\u5e74\u8f7b(?:\u7684)?\u6210\u5e74(?:\u4eba|\u5973\u6027|\u7537\u6027|\u5973\u4eba|\u7537\u4eba)?/gu, '\u6210\u5e74\u4eba')
    if (!normalized) return false
    return /(?:\u672a\u6210\u5e74\u4eba?|\u672a\u6ee1\s*(?:18|\u5341\u516b)\s*\u5c81?|(?:18|\u5341\u516b)\s*\u5c81?\s*(?:\u4ee5\u4e0b|\u4ee5\u5185)|(?<![0-9])(?:1[0-7]|[0-9])\s*\u5c81(?![0-9])|\u513f\u7ae5|\u5b69\u7ae5|\u5c0f\u5b69|\u5e7c\u5973|\u5e7c\u7ae5|\u5e7c\u513f|\u5a74\u5e7c\u513f?|\u5a74\u513f|\u841d\u8389|\u6b63\u592a)|(?<![a-z0-9_])(?:underage|minors?|child(?:ren)?(?![-\s]?like\b)|juveniles?|loli|shota|under[-\s]*18|(?:1[0-7]|[0-9])[-\s]*years?[-\s]*old|(?:1[0-7]|[0-9])\s*y\s*\/?\s*o|aged?\s*(?:1[0-7]|[0-9]))(?![a-z0-9_])/iu.test(normalized)
  }

  function getCapability(value) {
    return CAPABILITIES[normalizeMode(value)]
  }

  function assertReverseCapability(value) {
    const selected = getCapability(value)
    if (!selected.supportsReverse) {
      throw new Error(`MiniMax H3 ${selected.mode} supports prompt optimization only`)
    }
    return selected
  }

  function resourceEntries(resources) {
    if (Array.isArray(resources)) return resources.slice()
    if (!resources || typeof resources !== 'object') {
      throw new TypeError('MiniMax H3 reverse resources must be an array or keyed object')
    }
    return Object.entries(resources).map(([key, value]) => {
      if (!value || typeof value !== 'object') return { key, occupied: false }
      return Object.assign({}, value, { key: value.key || value.slotKey || key })
    })
  }

  function resourceIsOccupied(resource) {
    if (!resource || typeof resource !== 'object') return false
    if (typeof resource.occupied === 'boolean') return resource.occupied
    return Boolean(resource.dataUrl || resource.identity || resource.sourceId || resource.resourceId || resource.id)
  }

  function normalizeFileName(value, fallback) {
    const parts = stringValue(value).trim().replace(/\\/g, '/').split('/')
    const name = stringValue(parts[parts.length - 1]).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 180)
    return name || fallback
  }

  function fingerprintText(value) {
    let left = 0x811c9dc5
    let right = 0x9e3779b9
    const text = stringValue(value)
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index)
      left ^= code
      left = Math.imul(left, 0x01000193)
      right ^= code + index
      right = Math.imul(right, 0x85ebca6b)
    }
    return `${(left >>> 0).toString(16).padStart(8, '0')}-${(right >>> 0).toString(16).padStart(8, '0')}`
  }

  function normalizeImageResource(resource, descriptor) {
    if (!resource || typeof resource !== 'object') throw new Error(`${descriptor.label} has not been provided`)
    if (!resourceIsOccupied(resource)) throw new Error(`${descriptor.label} has not been provided`)
    if (stringValue(resource.kind).trim().toLowerCase() !== 'image') {
      throw new TypeError(`${descriptor.label} requires an image resource`)
    }
    const identity = stringValue(resource.identity).trim()
    const sourceId = stringValue(resource.sourceId || resource.resourceId || resource.id).trim()
    if (!identity && !sourceId) throw new Error(`${descriptor.label} is missing a stable resource identity`)
    if (identity && sourceId && identity !== sourceId) {
      throw new Error(`${descriptor.label} identity and sourceId do not match`)
    }
    const stableIdentity = identity || sourceId
    const dataUrl = stringValue(resource.dataUrl).trim()
    const dataMatch = dataUrl.match(IMAGE_DATA_URL_EXPRESSION)
    if (!dataMatch) throw new TypeError(`${descriptor.label} requires a base64 image dataUrl`)
    const mimeType = dataMatch[1].toLowerCase()
    const declaredMime = stringValue(resource.mimeType).trim().toLowerCase()
    if (declaredMime && !declaredMime.startsWith('image/')) {
      throw new TypeError(`${descriptor.label} requires an image MIME type`)
    }
    const extension = mimeType === 'image/jpeg' ? 'jpg' : (mimeType.split('/')[1] || 'png').replace(/[^a-z0-9]/g, '') || 'png'
    const fileName = normalizeFileName(resource.fileName || resource.name, `${descriptor.key}.${extension}`)
    return deepFreeze({
      key: descriptor.key,
      label: descriptor.label,
      role: descriptor.role,
      kind: 'image',
      identity: stableIdentity,
      sourceId: stableIdentity,
      fileName,
      mimeType,
      dataUrl,
      dataFingerprint: fingerprintText(dataUrl),
    })
  }

  function normalizeResources(resources, selectedCapability) {
    const entries = resourceEntries(resources)
    const allowed = new Set(selectedCapability.requiredSlots)
    const byKey = new Map()
    entries.forEach((entry) => {
      if (!entry || typeof entry !== 'object') throw new TypeError('MiniMax H3 reverse resource entry must be an object')
      const key = stringValue(entry.key || entry.slotKey).trim()
      if (!allowed.has(key)) throw new Error(`Resource is not valid for MiniMax H3 ${selectedCapability.mode}: ${key || '(unkeyed)'}`)
      if (byKey.has(key)) throw new Error(`Duplicate MiniMax H3 reverse resource slot: ${key}`)
      byKey.set(key, entry)
    })
    const normalized = selectedCapability.requiredSlots.map((key) => {
      const descriptor = SLOT_DEFINITIONS[key]
      return normalizeImageResource(byKey.get(key), descriptor)
    })
    if (normalized.length !== selectedCapability.maxImages) {
      throw new Error(`MiniMax H3 ${selectedCapability.mode} requires exactly ${selectedCapability.maxImages} image(s)`)
    }
    return Object.freeze(normalized)
  }

  function snapshotPayload(values) {
    return JSON.stringify({
      schemaVersion: SNAPSHOT_VERSION,
      operation: 'reverse',
      modelId: values.modelId,
      mode: values.mode,
      durationSeconds: values.durationSeconds,
      prompt: values.prompt,
      requirements: values.requirements,
      visualSchema: H3_VISUAL_SCHEMA,
      contentPolicy: values.contentPolicy,
      resources: values.resources.map((resource) => ({
        key: resource.key,
        kind: resource.kind,
        identity: resource.identity,
        sourceId: resource.sourceId,
        dataFingerprint: resource.dataFingerprint,
      })),
    })
  }

  function normalizeRequestState(options) {
    const input = options && typeof options === 'object' ? options : {}
    const modelId = normalizeModelId(input.modelId)
    const selectedCapability = assertReverseCapability(input.mode)
    const durationSeconds = normalizeDurationSeconds(input.durationSeconds)
    const prompt = stringValue(input.prompt).trim()
    const requirements = stringValue(input.requirements).trim()
    const contentPolicy = normalizeContentPolicy(input.contentPolicy)
    const userIntent = `${prompt}\n${requirements}`
    if (contentPolicy.sensitiveVisualAnalysis
      && containsDisallowedYoungOrMinorTerms(userIntent)
      && containsSensitiveContentTerms(userIntent)) {
      throw new Error('MiniMax H3 sensitive visual analysis is blocked because explicit minor evidence coexists with sensitive content')
    }
    const resources = normalizeResources(input.resources, selectedCapability)
    return { modelId, selectedCapability, durationSeconds, prompt, requirements, contentPolicy, resources }
  }

  function createRequestSnapshot(options) {
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
  }

  function snapshotFingerprint(snapshot) {
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
  }

  function assertSnapshotIntegrity(snapshot) {
    if (Number(snapshot?.schemaVersion) !== SNAPSHOT_VERSION || snapshot?.operation !== 'reverse') {
      throw new Error('MiniMax H3 reverse snapshot version is unsupported')
    }
    if (snapshotFingerprint(snapshot) !== snapshot.fingerprint) {
      throw new Error('MiniMax H3 reverse snapshot fingerprint is invalid')
    }
    return true
  }

  function isRequestSnapshotStale(snapshot, currentOptions) {
    try {
      assertSnapshotIntegrity(snapshot)
      return createRequestSnapshot(currentOptions).fingerprint !== snapshot.fingerprint
    } catch (_error) {
      return true
    }
  }

  function assertRequestSnapshotFresh(snapshot, currentOptions) {
    if (isRequestSnapshotStale(snapshot, currentOptions)) {
      throw new Error('MiniMax H3 reverse snapshot is stale; discard the response and request reverse again')
    }
    return true
  }

  function requirePromptWorkflow() {
    if (!promptWorkflow || typeof promptWorkflow.prepareRequest !== 'function' || typeof promptWorkflow.validateAndRestore !== 'function') {
      throw new Error('MiniMax H3 prompt workflow is unavailable')
    }
    return promptWorkflow
  }

  function reverseDirective(selectedCapability) {
    if (selectedCapability.mode === 'image_video') {
      return 'Use <Picture 1> as the exact opening frame. Infer a natural, achievable continuous action and one coherent camera movement from its visible facts.'
    }
    return 'Use <Picture 1> as the exact opening frame and <Picture 2> as the exact ending frame. Infer only a natural, achievable transition supported by their visible differences.'
  }

  function preferredOutputLanguage(userPrompt) {
    const prompt = stringValue(userPrompt).trim()
    if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(prompt)) return 'zh-CN'
    if (/[A-Za-z]/.test(prompt)) return 'en'
    return 'zh-CN'
  }

  function reverseContract(selectedCapability) {
    if (selectedCapability.mode === 'image_video') {
      return 'Analyze the bound first-frame image, then return the complete MiniMax H3 I2VA protocol requested below. Do not return an image-analysis report or a generic WAN prompt.'
    }
    return 'Analyze the bound first and last frames in that exact order, then return the complete MiniMax H3 FL2VA protocol requested below. Do not invent unsupported identity, scene, or endpoint changes.'
  }

  function resourcesForPromptWorkflow(resources) {
    return resources.map((resource) => ({
      key: resource.key,
      occupied: true,
      kind: resource.kind,
      identity: resource.identity,
      sourceId: resource.sourceId,
      fileName: resource.fileName,
      mimeType: resource.mimeType,
    }))
  }

  function prepareRequest(options) {
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
  }

  function assertContextIntegrity(context) {
    if (!context || typeof context !== 'object' || context.operation !== 'reverse') {
      throw new TypeError('MiniMax H3 reverse context is invalid')
    }
    assertSnapshotIntegrity(context.snapshot)
    if (context.fingerprint !== context.snapshot.fingerprint) {
      throw new Error('MiniMax H3 reverse context fingerprint is invalid')
    }
    if (normalizeModelId(context.modelId) !== context.snapshot.modelId || normalizeMode(context.mode) !== context.snapshot.mode) {
      throw new Error('MiniMax H3 reverse context does not match its snapshot')
    }
    if (stringValue(context.purpose).trim() !== getCapability(context.mode).purpose) {
      throw new Error('MiniMax H3 reverse context purpose is invalid')
    }
    if (
      context.visualSchema !== H3_VISUAL_SCHEMA
      || JSON.stringify(normalizeContentPolicy(context.contentPolicy)) !== JSON.stringify(normalizeContentPolicy(context.snapshot.contentPolicy))
    ) {
      throw new Error('MiniMax H3 reverse content policy does not match its snapshot')
    }
    return true
  }

  function buildGuaranteedFallback(options) {
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
  }

  function validateAndRestore(options) {
    const input = options && typeof options === 'object' ? options : {}
    const context = input.context
    assertContextIntegrity(context)
    if (!input.current) throw new Error('MiniMax H3 reverse current state is required')
    assertRequestSnapshotFresh(context.snapshot, input.current)
    const current = normalizeRequestState(input.current)
    const restored = requirePromptWorkflow().validateAndRestore({
      text: stringValue(input.text),
      context: context.h3Context,
      current: {
        modelId: current.modelId,
        mode: current.selectedCapability.mode,
        durationSeconds: current.durationSeconds,
        prompt: context.sourcePrompt,
        resources: resourcesForPromptWorkflow(current.resources),
        contentPolicy: current.contentPolicy,
      },
    })
    return deepFreeze({
      ...restored,
      operation: 'reverse',
      purpose: context.purpose,
      mode: context.mode,
      fingerprint: context.fingerprint,
    })
  }

  return deepFreeze({
    SNAPSHOT_VERSION,
    MINIMAX_H3_MODEL_ID,
    H3_VISUAL_SCHEMA,
    MIN_DURATION_SECONDS,
    MAX_DURATION_SECONDS,
    CAPABILITIES,
    normalizeContentPolicy,
    containsDisallowedYoungOrMinorTerms,
    containsSensitiveContentTerms,
    getCapability,
    createRequestSnapshot,
    snapshotFingerprint,
    assertSnapshotIntegrity,
    isRequestSnapshotStale,
    assertRequestSnapshotFresh,
    assertContextIntegrity,
    prepareRequest,
    buildGuaranteedFallback,
    validateAndRestore,
  })
})
