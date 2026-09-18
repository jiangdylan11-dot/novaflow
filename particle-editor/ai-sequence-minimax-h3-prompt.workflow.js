(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceMiniMaxH3PromptWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const SNAPSHOT_VERSION = 4
  const MINIMAX_H3_MODEL_ID = 'minimax_h3_local'
  const H3_VISUAL_SCHEMA = 'nf.h3.visual.v1'
  const MIN_DURATION_SECONDS = 1
  const MAX_DURATION_SECONDS = 30

  const BASE_FIELD_ORDER = Object.freeze([
    'integrated_multimodal_description',
    'overall_soundscape',
    'non_diegetic_music',
  ])

  const REFERENCE_FIELD_ORDER = Object.freeze([
    'subject_definitions',
    'summary',
    'retention_analysis',
    'detailed_description',
    'overall_soundscape',
    'non_diegetic_music',
  ])

  const REFERENCE_RELATIONS = Object.freeze([
    'reference generation',
    'keyframe completion',
    'video editing',
    'video continuation',
    'audio reuse',
    'audio reference',
  ])

  function freezeArray(values) {
    return Object.freeze(values.slice())
  }

  function referenceSlot(key, label, kind, fixedModelToken, aliases, keyAliases) {
    return Object.freeze({
      key,
      label,
      kind,
      fixedModelToken,
      aliases: freezeArray(aliases),
      keyAliases: freezeArray([key].concat(keyAliases || [])),
    })
  }

  const FIRST_FRAME_SLOT = referenceSlot(
    'first_frame',
    '\u9996\u5e27',
    'image',
    '<Picture 1>',
    ['@\u9996\u5e27', '@\u53c2\u8003\u56fe', '@\u56fe\u72471'],
    ['image', 'reference_image', 'referenceImage', 'start_image', 'startImage', 'i2v_image', 'ref_image'],
  )

  const LAST_FRAME_SLOT = referenceSlot(
    'last_frame',
    '\u5c3e\u5e27',
    'image',
    '<Picture 2>',
    ['@\u5c3e\u5e27', '@\u7ed3\u675f\u5e27', '@\u56fe\u72472'],
    ['end_image', 'endImage', 'last_image', 'lastImage'],
  )

  const MULTI_REFERENCE_SLOTS = Object.freeze([
    referenceSlot('multi_ref_image_1', '\u53c2\u8003\u56fe1', 'image', '', ['@\u53c2\u8003\u56fe1', '@\u56fe\u72471']),
    referenceSlot('multi_ref_image_2', '\u53c2\u8003\u56fe2', 'image', '', ['@\u53c2\u8003\u56fe2', '@\u56fe\u72472']),
    referenceSlot('multi_ref_image_3', '\u53c2\u8003\u56fe3', 'image', '', ['@\u53c2\u8003\u56fe3', '@\u56fe\u72473']),
    referenceSlot('multi_ref_image_4', '\u53c2\u8003\u56fe4', 'image', '', ['@\u53c2\u8003\u56fe4', '@\u56fe\u72474']),
    referenceSlot('multi_ref_video_1', '\u89c6\u9891\u53c2\u8003', 'video', '', ['@\u89c6\u9891\u53c2\u8003', '@\u89c6\u98911']),
    referenceSlot('multi_ref_audio_1', '\u58f0\u97f3\u53c2\u8003', 'audio', '', ['@\u58f0\u97f3\u53c2\u8003', '@\u97f3\u98911', '@\u97f3\u9891\u53c2\u8003']),
  ])

  function mode(value, workflowMode, protocolName, fieldOrder, slots) {
    return Object.freeze({
      value,
      workflowMode,
      protocolName,
      fieldOrder,
      slots,
    })
  }

  const MODE_DEFINITIONS = Object.freeze({
    text_video: mode('text_video', 't2v', 'T2VA', BASE_FIELD_ORDER, Object.freeze([])),
    image_video: mode('image_video', 'i2v', 'I2VA', BASE_FIELD_ORDER, Object.freeze([FIRST_FRAME_SLOT])),
    first_last: mode('first_last', 'fl2v', 'FL2VA', BASE_FIELD_ORDER, Object.freeze([FIRST_FRAME_SLOT, LAST_FRAME_SLOT])),
    multi_reference: mode('multi_reference', 'r2v', 'Ref2VA', REFERENCE_FIELD_ORDER, MULTI_REFERENCE_SLOTS),
  })

  const MODE_ORDER = Object.freeze(Object.keys(MODE_DEFINITIONS))

  const MODE_ALIAS = Object.freeze({
    text_video: 'text_video',
    textvideo: 'text_video',
    t2v: 'text_video',
    image_video: 'image_video',
    imagevideo: 'image_video',
    i2v: 'image_video',
    first_last: 'first_last',
    firstlast: 'first_last',
    first_last_video: 'first_last',
    fl2v: 'first_last',
    multi_reference: 'multi_reference',
    multireference: 'multi_reference',
    reference_video: 'multi_reference',
    r2v: 'multi_reference',
  })

  const TOP_LEVEL_FIELD_HEADER_EXPRESSION = /^([a-z][a-z0-9_]*):(?!\/\/)[ \t]*(.*)$/gm
  const PLAIN_NEGATIVE_FIELD_EXPRESSION = /^(negative(?:[_ -]?prompt)?|avoid(?:ance)?|\u8d1f\u5411\u63d0\u793a\u8bcd|\u8d1f\u9762\u63d0\u793a\u8bcd|\u53cd\u5411\u63d0\u793a\u8bcd|\u5426\u5b9a\u63d0\u793a\u8bcd|\u8d1f\u5411\u8bcd|\u8d1f\u9762\u8bcd)[ \t]*[:\uff1a]/i
  const MARKDOWN_NEGATIVE_FIELD_EXPRESSION = /^(?:#{1,6}[ \t]+|[-+*>][ \t]+|(?:\*\*|__))[ \t]*(?:\*\*|__)?[ \t]*(negative(?:[_ -]?prompt)?|avoid(?:ance)?|\u8d1f\u5411\u63d0\u793a\u8bcd|\u8d1f\u9762\u63d0\u793a\u8bcd|\u53cd\u5411\u63d0\u793a\u8bcd|\u5426\u5b9a\u63d0\u793a\u8bcd|\u8d1f\u5411\u8bcd|\u8d1f\u9762\u8bcd)(?=[ \t]*(?:\*\*|__)?[ \t]*(?:[:\uff1a]|$))/i
  const MARKDOWN_TOP_LEVEL_FIELD_EXPRESSION = /^(?:#{1,6}[ \t]+|[-+*>][ \t]+|(?:\*\*|__))[ \t]*(?:\*\*|__)?[ \t]*([a-z][a-z0-9_]*)[ \t]*(?:\*\*|__)?[ \t]*[:\uff1a]/i
  const MODEL_REFERENCE_EXPRESSION = /<(Picture|Video|Audio|Subject) ([1-9][0-9]*)>/g
  const MEDIA_REFERENCE_EXPRESSION = /<(Picture|Video|Audio) ([1-9][0-9]*)>/g
  const UI_REFERENCE_ALIAS_EXPRESSION = /@(?:\u9996\u5e27|\u5c3e\u5e27|\u7ed3\u675f\u5e27|\u53c2\u8003\u56fe(?:[1-4])?|\u56fe\u7247[1-4]|\u89c6\u9891\u53c2\u8003|\u89c6\u98911|\u58f0\u97f3\u53c2\u8003|\u97f3\u9891\u53c2\u8003|\u97f3\u98911)(?:\s*\((?:image|video|audio)\))?/iu
  const CAMERA_DIRECTION_EXPRESSION = /(?:\u8fd0\u955c|\u955c\u5934(?:\u4fdd\u6301|\u56fa\u5b9a|\u9759\u6b62|\u7a33\u5b9a|\u7f13\u6162|\u8f7b\u5fae|\u5e73\u7a33|\u8ddf\u968f|\u63a8\u8fdb|\u62c9\u8fdc|\u6447\u6444|\u79fb\u52a8|\u73af\u7ed5|\u4e0a\u5347|\u4e0b\u964d|\u53d8\u7126|\u5207\u6362)|(?:\u56fa\u5b9a|\u9759\u6b62|\u624b\u6301|\u8ddf\u968f|\u63a8\u8fdb|\u62c9\u8fdc|\u6447\u6444|\u73af\u7ed5|\u5347\u964d|\u53d8\u7126|\u63a8\u8f68)[^\u3002\n]{0,10}\u955c\u5934)|\bcamera\b[^.\n]{0,100}\b(?:preserved|unchanged|matches|holds|remains|stays|static|locked|moves|pushes|pulls|pans|tilts|tracks|orbits|dollies|cranes|follows)\b|\b(?:static camera|fixed camera|locked[- ]off camera|handheld camera|camera (?:movement|motion)|dolly|tracking shot|push[- ]in|pull[- ]out)\b/iu
  const ACTION_PROGRESSION_EXPRESSION = /(?:\u5f00\u59cb|\u968f\u540e|\u63a5\u7740|\u9010\u6e10|\u6301\u7eed|\u8fc7\u7a0b|\u8f6c\u8eab|\u79fb\u52a8|\u62ac\u8d77|\u653e\u4e0b|\u5b8c\u6210|\u6700\u7ec8|\u8fc7\u6e21|\u52a8\u4f5c|\u53cd\u590d|\u6765\u56de|\u5f80\u590d|\u4e0d\u65ad|\u5faa\u73af|\u8282\u594f|\u9891\u7387|\u52a0\u5feb|\u52a0\u901f|\u653e\u6162|\u51cf\u901f|\u63a8\u8fdb|\u8fdb\u51fa|\u8d77\u4f0f|\u6446\u52a8|\u6643\u52a8|\u62bd\u52a8|\u6bcf\u6b21)|\b(?:begin(?:s)?|then|next|gradually|progress(?:es|ion)?|continues?|turns?|moves?|raises?|lowers?|completes?|finally|resolves?|transition|motion|action|repeat\w*|repetition|rhythm\w*|cycl\w*|thrust\w*|accelerat\w*|decelerat\w*|oscillat\w*|pulse\w*|rotat\w*|return\w*|spins?)\b/iu
  const EXPLICIT_MINOR_EXPRESSION = /(?:\u672a\u6210\u5e74\u4eba?|\u672a\u6ee1\s*(?:18|\u5341\u516b)\s*\u5c81?|(?:18|\u5341\u516b)\s*\u5c81?\s*(?:\u4ee5\u4e0b|\u4ee5\u5185)|(?<![0-9])(?:1[0-7]|[0-9])\s*\u5c81(?![0-9])|\u513f\u7ae5|\u5b69\u7ae5|\u5c0f\u5b69|\u5e7c\u5973|\u5e7c\u7ae5|\u5e7c\u513f|\u5a74\u5e7c\u513f?|\u5a74\u513f|\u841d\u8389|\u6b63\u592a)|(?<![a-z0-9_])(?:underage|minors?|child(?:ren)?(?![-\s]?like\b)|juveniles?|loli|shota|under[-\s]*18|(?:1[0-7]|[0-9])[-\s]*years?[-\s]*old|(?:1[0-7]|[0-9])\s*y\s*\/?\s*o|aged?\s*(?:1[0-7]|[0-9]))(?![a-z0-9_])/iu

  function stringValue(value) {
    return value == null ? '' : String(value)
  }

  function containsExplicitMinorTerms(value) {
    const normalized = stringValue(value)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\byoung[- ]?adults?\b/giu, 'adult')
      .replace(/\u5e74\u8f7b(?:\u7684)?\u6210\u5e74(?:\u4eba|\u5973\u6027|\u7537\u6027|\u5973\u4eba|\u7537\u4eba)?/gu, '\u6210\u5e74\u4eba')
    return normalized ? EXPLICIT_MINOR_EXPRESSION.test(normalized) : false
  }

  function containsSensitiveContentTerms(value) {
    const normalized = stringValue(value)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/(?:\b(?:no|not|without)\b|(?:没有|不含|未见|无))(?:明显)?\s*(?:nudity|nude|naked|topless|sexual(?:\s+activity)?|explicit(?:\s+anatomy)?|裸体|裸露|性行为|生殖器|乳头|乳房)/giu, '')
    if (!normalized) return false
    return /(?:裸体|裸露|全裸|半裸|一丝不挂|性行为|性交|交合|性爱|性活动|口交|肛交|自慰|手淫|生殖器|性器官|阴茎|阴道|外阴|阴唇|阴蒂|肛门|乳头|乳房|精液|性体液|色情|情色|成人内容|性暗示|胸部暴露)|(?<![a-z0-9_])(?:nudity|nude|naked|topless|nsfw|porn(?:ographic|ography)?|sexual[_\s-]+(?:activity|act|fluid)|explicit[_\s-]+(?:activity|anatomy)|intercourse|oral\s+sex|anal\s+sex|masturbat(?:e|ion|ing)|genitals?|penis|vagina|vulva|anus|semen|bare\s+breasts?|exposed\s+breasts?)(?![a-z0-9_])/iu.test(normalized)
  }

  function escapeRegExp(value) {
    return stringValue(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function deepFreeze(value, seen) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || Object.isFrozen(value)) return value
    const visited = seen || new Set()
    if (visited.has(value)) return value
    visited.add(value)
    Object.keys(value).forEach((key) => deepFreeze(value[key], visited))
    return Object.freeze(value)
  }

  function normalizeMode(value) {
    const raw = stringValue(value).trim().toLowerCase()
    const compact = raw.replace(/[\s-]+/g, '_')
    const normalized = MODE_ALIAS[compact] || MODE_ALIAS[compact.replace(/_/g, '')]
    if (!normalized) throw new Error(`Unsupported MiniMax H3 prompt mode: ${raw || '(empty)'}`)
    return normalized
  }

  function normalizeModelId(value) {
    const modelId = stringValue(value).trim()
    if (modelId !== MINIMAX_H3_MODEL_ID) {
      throw new Error(`Unsupported MiniMax H3 prompt model: ${modelId || '(empty)'}`)
    }
    return modelId
  }

  function getModeDefinition(value) {
    return MODE_DEFINITIONS[normalizeMode(value)]
  }

  function normalizeContentPolicy(value) {
    const input = value && typeof value === 'object' ? value : {}
    const sensitiveVisualAnalysis = input.sensitiveVisualAnalysis === true
    const allSubjectsConfirmedAdult = input.allSubjectsConfirmedAdult === true
    return deepFreeze({ sensitiveVisualAnalysis, allSubjectsConfirmedAdult })
  }

  function normalizeDurationSeconds(value) {
    const duration = Number(value)
    if (!Number.isFinite(duration)) throw new TypeError('MiniMax H3 durationSeconds must be a finite number')
    if (duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS) {
      throw new RangeError(`MiniMax H3 durationSeconds must be between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS}`)
    }
    return Math.round(duration * 1000) / 1000
  }

  function resourceEntries(resources) {
    if (resources == null) return []
    if (Array.isArray(resources)) return resources.map((entry) => entry)
    if (typeof resources !== 'object') throw new TypeError('MiniMax H3 prompt resources must be an array or keyed object')
    return Object.entries(resources).map(([key, value]) => {
      if (!value || typeof value !== 'object') return { key, occupied: false }
      return Object.assign({}, value, { key: value.key || value.slotKey || key })
    })
  }

  function resourceIsOccupied(resource) {
    if (!resource || typeof resource !== 'object') return false
    if (typeof resource.occupied === 'boolean') return resource.occupied
    return Boolean(
      resource.file ||
      resource.sourceId ||
      resource.resourceId ||
      resource.id ||
      resource.identity ||
      resource.fileName ||
      resource.name ||
      resource.dataUrl ||
      resource.objectUrl ||
      resource.localPath,
    )
  }

  function resourceFile(resource) {
    return resource && typeof resource.file === 'object' ? resource.file : null
  }

  function resourceFileName(resource) {
    const file = resourceFile(resource)
    return stringValue(resource?.fileName || resource?.name || file?.name).trim()
  }

  function resourceMimeType(resource) {
    const file = resourceFile(resource)
    return stringValue(resource?.mimeType || resource?.type || file?.type).trim().toLowerCase()
  }

  function detectedKind(resource) {
    const explicit = stringValue(resource?.kind).trim().toLowerCase()
    if (explicit === 'image' || explicit === 'video' || explicit === 'audio') return explicit
    const mime = resourceMimeType(resource)
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('audio/')) return 'audio'
    const name = resourceFileName(resource).toLowerCase()
    if (/\.(png|jpe?g|webp|gif|bmp|tiff?|jfif)$/.test(name)) return 'image'
    if (/\.(mp4|webm|mov|m4v|avi|mkv)$/.test(name)) return 'video'
    if (/\.(wav|mp3|m4a|aac|ogg|flac|opus)$/.test(name)) return 'audio'
    return ''
  }

  function resourceIdentity(resource, slotKey) {
    // The editor DOM and generation state use different internal IDs. Both
    // must bind a translation to the actual same media, not those UI IDs.
    const mediaUrl = stringValue(resource?.previewUrl || resource?.objectUrl || resource?.dataUrl).trim()
    if (mediaUrl) return 'media:' + fingerprintText(mediaUrl)
    const explicit = stringValue(
      resource?.identity || resource?.sourceId || resource?.resourceId || resource?.id,
    ).trim()
    if (explicit) return explicit
    const file = resourceFile(resource)
    const fileName = resourceFileName(resource)
    const mimeType = resourceMimeType(resource)
    const size = Number(resource?.size ?? file?.size)
    const lastModified = Number(resource?.lastModified ?? file?.lastModified)
    if (!fileName && !mimeType && !Number.isFinite(size) && !Number.isFinite(lastModified)) return ''
    return [
      slotKey,
      fileName,
      mimeType,
      Number.isFinite(size) ? size : '',
      Number.isFinite(lastModified) ? lastModified : '',
    ].join(':')
  }

  function slotForKey(definition, key) {
    const normalized = stringValue(key).trim()
    return definition.slots.find((slot) => slot.keyAliases.includes(normalized)) || null
  }

  function normalizeResources(definition, resources) {
    const entries = resourceEntries(resources)
    const bySlot = new Map()
    entries.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') throw new TypeError('MiniMax H3 prompt resource entry must be an object')
      if (!resourceIsOccupied(entry)) return
      let descriptor = slotForKey(definition, entry.key || entry.slotKey)
      if (!descriptor && definition.value !== 'multi_reference' && !stringValue(entry.key || entry.slotKey).trim()) {
        descriptor = definition.slots[index] || null
      }
      if (!descriptor) {
        throw new Error(`Resource is not valid for MiniMax H3 ${definition.value}: ${stringValue(entry.key || entry.slotKey) || '(unkeyed)'}`)
      }
      if (bySlot.has(descriptor.key)) throw new Error(`Duplicate MiniMax H3 prompt resource slot: ${descriptor.key}`)
      const kind = detectedKind(entry)
      if (kind && kind !== descriptor.kind) {
        throw new TypeError(`${descriptor.label} requires ${descriptor.kind}, received ${kind}`)
      }
      const identity = resourceIdentity(entry, descriptor.key)
      if (!identity) throw new Error(`${descriptor.label} is missing a stable resource identity`)
      bySlot.set(descriptor.key, {
        descriptor,
        identity,
        sourceId: stringValue(entry.sourceId || entry.resourceId || entry.id).trim(),
        fileName: resourceFileName(entry),
        mimeType: resourceMimeType(entry),
      })
    })
    return bySlot
  }

  function modelTokenFor(descriptor, compactIndex) {
    if (descriptor.fixedModelToken) return descriptor.fixedModelToken
    const prefix = descriptor.kind === 'image' ? 'Picture' : descriptor.kind === 'video' ? 'Video' : 'Audio'
    return `<${prefix} ${compactIndex}>`
  }

  function createReferenceCatalog(options) {
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
  }

  function getReferenceSchema(modeValue) {
    const definition = getModeDefinition(modeValue)
    return deepFreeze(definition.slots.map((slot) => ({
      slotKey: slot.key,
      displayLabel: slot.label,
      displayToken: slot.aliases[0],
      aliases: slot.aliases.slice(),
      kind: slot.kind,
      fixedModelToken: slot.fixedModelToken,
    })))
  }

  function assertCatalog(catalog) {
    if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.references)) {
      throw new TypeError('MiniMax H3 reference catalog is required')
    }
    return catalog
  }

  function replaceTokens(text, replacements) {
    const keys = Object.keys(replacements).sort((left, right) => right.length - left.length)
    if (!keys.length) return stringValue(text)
    const expression = new RegExp(keys.map((key) => escapeRegExp(key) + (/\d$/.test(key) ? '(?!\\d)' : '')).join('|'), 'g')
    return stringValue(text).replace(expression, (token) => replacements[token])
  }

  function assertNoUnavailableDisplayTokens(text, catalog) {
    const schema = getReferenceSchema(catalog.mode)
    const available = new Set(Object.keys(catalog.byDisplayToken))
    schema.forEach((entry) => {
      entry.aliases.forEach((alias) => {
        const expression = new RegExp(escapeRegExp(alias) + (/\d$/.test(alias) ? '(?!\\d)' : ''))
        if (!available.has(alias) && expression.test(text)) {
          throw new Error(`Reference ${alias} is not available in the captured MiniMax H3 resources`)
        }
      })
    })
  }

  function assertNoUnavailableModelTokens(text, catalog, options) {
    const allowSubjects = Boolean(options?.allowSubjects)
    const speakers = new Set(Array.from(stringValue(text).matchAll(/<Subject ([1-9][0-9]*)>\s*=\s*[（(]S\1[）)]/g), match => match[1]))
    const available = new Set(catalog.modelTokens)
    const matches = stringValue(text).matchAll(MODEL_REFERENCE_EXPRESSION)
    for (const match of matches) {
      const token = match[0]
      if (match[1] === 'Subject' && (allowSubjects || speakers.has(match[2]))) continue
      if (!available.has(token)) throw new Error(`Reference ${token} is not available in the captured MiniMax H3 resources`)
    }
  }

  function toModelReferences(text, catalogValue) {
    const catalog = assertCatalog(catalogValue)
    const source = stringValue(text)
    assertNoUnavailableDisplayTokens(source, catalog)
    const compiled = replaceTokens(source, catalog.byDisplayToken)
    assertNoUnavailableModelTokens(compiled, catalog, { allowSubjects: catalog.mode === 'multi_reference' })
    return compiled
  }

  function toDisplayReferences(text, catalogValue) {
    const catalog = assertCatalog(catalogValue)
    const source = stringValue(text)
    assertNoUnavailableModelTokens(source, catalog, { allowSubjects: catalog.mode === 'multi_reference' })
    return replaceTokens(source, catalog.byModelToken)
  }

  function alignmentRule(definition, durationSeconds) {
    if (definition.value === 'image_video') {
      return Object.freeze({
        required: true,
        description: 'The first non-empty line must align <Picture 1> from [Shot 1] to 0.00 seconds.',
        template: '\u53c2\u8003\u56fe\u7247\u4e0e\u76ee\u6807\u89c6\u9891\u5bf9\u9f50\uff1a<Picture 1>\uff08\u6765\u81ea [Shot 1]\uff09= 0.00 \u79d2',
      })
    }
    if (definition.value === 'first_last') {
      return Object.freeze({
        required: true,
        description: `The first non-empty line must align <Picture 1> from [Shot 1] to 0.00 seconds and <Picture 2> from the final shot to ${durationSeconds.toFixed(2)} seconds.`,
        template: `\u53c2\u8003\u56fe\u7247\u4e0e\u76ee\u6807\u89c6\u9891\u5bf9\u9f50\uff1a<Picture 1>\uff08\u6765\u81ea [Shot 1]\uff09= 0.00 \u79d2\uff1b<Picture 2>\uff08\u6765\u81ea [Shot N]\uff09= ${durationSeconds.toFixed(2)} \u79d2`,
      })
    }
    return Object.freeze({ required: false, description: '', template: '' })
  }

  function createPromptProtocol(options) {
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
    return `h3p${SNAPSHOT_VERSION}-${(left >>> 0).toString(16).padStart(8, '0')}-${(right >>> 0).toString(16).padStart(8, '0')}`
  }

  function snapshotPayload(modelId, modeValue, durationSeconds, prompt, catalog, contentPolicy) {
    return JSON.stringify({
      schemaVersion: SNAPSHOT_VERSION,
      modelId,
      mode: modeValue,
      durationSeconds,
      prompt,
      contentPolicy,
      references: catalog.references.map((reference) => ({
        slotKey: reference.slotKey,
        kind: reference.kind,
        modelToken: reference.modelToken,
        identity: reference.identity,
      })),
    })
  }

  function createPromptSnapshot(options) {
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
  }

  function resourcesFromSnapshot(snapshot) {
    return snapshot.references.map((reference) => ({
      key: reference.slotKey,
      occupied: true,
      kind: reference.kind,
      identity: reference.identity,
      sourceId: reference.sourceId,
      fileName: reference.fileName,
      mimeType: reference.mimeType,
    }))
  }

  function snapshotFingerprint(snapshot) {
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
  }

  function assertSnapshotIntegrity(snapshot) {
    if (Number(snapshot?.schemaVersion) !== SNAPSHOT_VERSION) {
      throw new Error('MiniMax H3 prompt snapshot version is unsupported')
    }
    const actual = snapshotFingerprint(snapshot)
    if (actual !== snapshot.fingerprint) throw new Error('MiniMax H3 prompt snapshot fingerprint is invalid')
    return true
  }

  function isPromptSnapshotStale(snapshot, currentOptions) {
    try {
      assertSnapshotIntegrity(snapshot)
      const current = createPromptSnapshot(currentOptions)
      return current.fingerprint !== snapshot.fingerprint
    } catch (_error) {
      return true
    }
  }

  function assertPromptSnapshotFresh(snapshot, currentOptions) {
    if (isPromptSnapshotStale(snapshot, currentOptions)) {
      throw new Error('MiniMax H3 prompt snapshot is stale; discard the response and request enhancement again')
    }
    return true
  }

  function buildLegacyInstructions(protocol, compiledPrompt) {
    const references = protocol.references.references.length
      ? protocol.references.references.map((reference) => `${reference.modelToken} = captured ${reference.kind} slot ${reference.slotKey}`).join('; ')
      : '(none)'
    const lines = [
      'You are a MiniMax H3 video-prompt optimizer and compiler. Improve the narrative itself, then preserve the required H3 format.',
      'Replace vague motion adjectives with observable action, direction, amplitude, rhythm and a clear ending. Keep details concise and achievable within the selected duration; do not add unrelated events, camera moves, effects or appearance details.',
      'Preserve explicit user constraints and reference roles. Stable framing and root position allow requested local body motion; complete stillness remains stillness. For requested loops, describe a smooth return to the initial pose and movement phase without overriding explicit endpoint anchors.',
      'Do not merely repeat the source under field names or append generic quality words. Tighten already detailed prompts without forcing extra motion. Keep a constant green screen unchanged when requested; no visual effects does not mean silence.',
      `Protocol: ${protocol.protocolName}; duration: ${protocol.durationSeconds.toFixed(2)} seconds.`,
      `Output fields in this exact order: ${protocol.fieldOrder.join(' -> ')}.`,
      'Separate the alignment line and core fields with blank lines. Use short paragraphs for the opening, action progression, and ending; describe each visual fact once and omit internal validation commentary.',
      'Use [Shot 1] without a timestamp. Every later shot must use [Shot N] At MM:SS.mmm, with strictly increasing times not beyond the requested duration.',
      `Available resource labels: ${references}. Never invent a resource label.`,
      'Describe a continuous, physically achievable action from its initial state through intermediate progression to its final state; do not stop at a static image caption.',
      'For every shot, state the camera behavior explicitly, including movement type or locked position, direction, amplitude, and speed.',
      'Keep character identity, anatomy, wardrobe/material state, composition, lighting, and environment continuous unless the source prompt explicitly changes them.',
      'overall_soundscape is only diegetic sound: one short paragraph of ambience, physical-action sounds, and non-verbal sounds. Keep dialogue, singing, and diegetic music in the visual timeline, without repeating them here. Use N/A only for explicitly requested complete silence. non_diegetic_music is only off-screen score; use N/A when none is intended.',
    ]
    if (protocol.alignment.required) {
      lines.push(protocol.alignment.description)
      if (protocol.mode === 'first_last') lines.push('FL2VA defaults to one continuous shot unless multiple shots are explicitly requested. Do not add a cut at the final-frame time. Describe common appearance once, then connect the meaningful endpoint differences through observable motion.')
      lines.push(protocol.mode === 'image_video'
        ? '<Picture 1> is independently bound only as the exact opening frame at 0.00 seconds; infer later motion without rewriting its visible opening facts.'
        : '<Picture 1> and <Picture 2> are independent exact endpoint bindings. Preserve each endpoint at its own time and infer only the supported transition between them; never blend or swap their roles.')
    }
    if (protocol.mode === 'multi_reference') {
      lines.push(`summary must begin with the actual task types in brackets: ${REFERENCE_RELATIONS.join(', ')}. Use one short paragraph; image appearance guidance is not automatically keyframe completion and video motion guidance is not automatically video continuation.`)
      lines.push('Define every <Subject N> in subject_definitions before using it, starting at <Subject 1> without gaps.')
      lines.push('Define reusable appearance or style as <Subject N>, citing its <Picture N> source inside the definition. Use standalone picture entries only for frame or composition anchors. Never copy internal inventory wording or captured slot names into the final prompt.')
      lines.push('Put each independently tracked reference definition and retention entry on its own line. Visual retention markers are fully_preserved, partially_preserved, attribute_transfer, weak_reference; audio markers are fully_copy, partially_copy, reference, weak_reference. Keep the labels and their roles stable.')
      lines.push('Begin detailed_description with the overall style before [Shot 1]. Describe playback in short paragraphs, maintaining necessary subject details at first appearance without repeating complete definitions or retention lists.')
      lines.push('Available uploads are optional sources. Use only assets relevant to the requested edit; an unused uploaded picture must not change the source subject. For each used reference, state which identity, appearance, motion, timing, or sound properties are retained and which are not transferred.')
      lines.push('Keep each resource role independent: an image does not become an audio cue, a video does not overwrite subject identity, and audio does not imply unseen visual events.')
    }
    if (protocol.contentPolicy.sensitiveVisualAnalysis) {
      lines.push('Fact-faithful analysis is enabled. Preserve sensitive facts explicitly present in the source prompt or supported by the references accurately and neutrally, without euphemistic omission, invented clothing, or invented activity.')
      lines.push('Do not guess or require an adult classification. Fail closed only when explicit minor or underage evidence coexists with sensitive content.')
    }
    lines.push('Return only the optimized prompt in the required protocol format. Do not use Markdown fences or add commentary.')
    lines.push('Source prompt:')
    lines.push(compiledPrompt)
    return lines.join('\n')
  }

  function buildInstructions(protocol, compiledPrompt) {
    if (protocol.mode === 'multi_reference') {
      return buildLegacyInstructions(protocol, compiledPrompt).replace('Source prompt:', globalThis.NovaFlowH3PromptFormat.referenceInstruction + '\nH3 response format: bilingual-v1\nSource prompt:')
    }
    const references = protocol.references.references.length
      ? protocol.references.references.map((reference) => `${reference.modelToken} = captured ${reference.kind} slot ${reference.slotKey}`).join('; ')
      : '(none)'
    const lines = [
      globalThis.NovaFlowH3PromptFormat.instruction,
      globalThis.NovaFlowH3PromptFormat.formatInstruction,
      `Protocol: ${protocol.protocolName}; duration: ${protocol.durationSeconds.toFixed(2)} seconds.`,
      `Available resource labels: ${references}. Never invent a resource label.`,
      ...(protocol.contentPolicy.sensitiveVisualAnalysis ? ['Fact-faithful analysis is enabled. Preserve only user-supported facts; do not guess age or add appearance.'] : []),
      'Source prompt:', compiledPrompt,
    ]
    return lines.join('\n')
  }

  function prepareRequest(options) {
    const input = options && typeof options === 'object' ? options : {}
    const modelId = normalizeModelId(input.modelId)
    const protocol = createPromptProtocol({
      mode: input.mode,
      durationSeconds: input.durationSeconds,
      resources: input.resources,
      contentPolicy: input.contentPolicy,
      requireReady: true,
    })
    const sourcePrompt = stringValue(input.prompt).trim()
    if (!sourcePrompt) throw new Error('MiniMax H3 source prompt cannot be empty')
    const compiledPrompt = globalThis.NovaFlowH3PromptFormat.fromReferenceDisplay(toModelReferences(sourcePrompt, protocol.references))
    const snapshot = createPromptSnapshot({
      modelId,
      mode: protocol.mode,
      durationSeconds: protocol.durationSeconds,
      prompt: sourcePrompt,
      resources: input.resources,
      contentPolicy: protocol.contentPolicy,
      requireReady: true,
    })
    const context = deepFreeze({
      schemaVersion: SNAPSHOT_VERSION,
      modelId,
      mode: protocol.mode,
      durationSeconds: protocol.durationSeconds,
      sourcePrompt,
      compiledPrompt,
      snapshot,
      fingerprint: snapshot.fingerprint,
      resources: snapshot.references.map((reference) => Object.assign({}, reference)),
      visualSchema: H3_VISUAL_SCHEMA,
      contentPolicy: protocol.contentPolicy,
    })
    const requirements = input.promptFormat === 'legacy' ? buildLegacyInstructions(protocol, compiledPrompt) : buildInstructions(protocol, compiledPrompt)
    return deepFreeze({
      requirements,
      text: requirements,
      prompt: compiledPrompt,
      protocol,
      context,
    })
  }

  function catalogFromContext(context) {
    assertContextIntegrity(context)
    return createReferenceCatalog({
      mode: context.mode,
      resources: resourcesFromSnapshot(context.snapshot),
      requireReady: true,
    })
  }

  function assertContextIntegrity(context) {
    if (!context || typeof context !== 'object' || !context.snapshot) {
      throw new TypeError('MiniMax H3 prompt response context is required')
    }
    assertSnapshotIntegrity(context.snapshot)
    if (context.fingerprint !== context.snapshot.fingerprint) {
      throw new Error('MiniMax H3 prompt response context fingerprint is invalid')
    }
    if (
      normalizeModelId(context.modelId) !== context.snapshot.modelId ||
      normalizeMode(context.mode) !== context.snapshot.mode ||
      normalizeDurationSeconds(context.durationSeconds) !== context.snapshot.durationSeconds ||
      stringValue(context.sourcePrompt).trim() !== context.snapshot.prompt
      || context.visualSchema !== H3_VISUAL_SCHEMA
      || JSON.stringify(normalizeContentPolicy(context.contentPolicy)) !== JSON.stringify(normalizeContentPolicy(context.snapshot.contentPolicy))
    ) {
      throw new Error('MiniMax H3 prompt response context does not match its snapshot')
    }
    return true
  }

  function isContextStale(context, currentOptions) {
    try {
      assertContextIntegrity(context)
      return isPromptSnapshotStale(context.snapshot, currentOptions)
    } catch (_error) {
      return true
    }
  }

  function assertContextFresh(context, currentOptions) {
    assertContextIntegrity(context)
    return assertPromptSnapshotFresh(context.snapshot, currentOptions)
  }

  function stripResponseFence(value) {
    const text = stringValue(value).trim()
    const match = text.match(/^```(?:text|plaintext)?\s*\n([\s\S]*?)\n```$/i)
    return (match ? match[1] : text).trim()
  }

  function parseFieldSections(text, fieldOrder) {
    for (const line of stringValue(text).split(/\r?\n/)) {
      const negative = line.match(PLAIN_NEGATIVE_FIELD_EXPRESSION) || line.match(MARKDOWN_NEGATIVE_FIELD_EXPRESSION)
      const markdown = line.match(MARKDOWN_TOP_LEVEL_FIELD_EXPRESSION)
      const forbiddenName = negative?.[1] || markdown?.[1] || ''
      if (forbiddenName) {
        throw new Error(`Unexpected MiniMax H3 top-level field: ${forbiddenName}`)
      }
    }
    const matches = []
    TOP_LEVEL_FIELD_HEADER_EXPRESSION.lastIndex = 0
    let match
    while ((match = TOP_LEVEL_FIELD_HEADER_EXPRESSION.exec(text))) {
      matches.push({
        name: match[1],
        headerIndex: match.index,
        contentIndex: TOP_LEVEL_FIELD_HEADER_EXPRESSION.lastIndex - match[2].length,
        inline: match[2],
      })
    }
    const unexpected = matches.find((entry) => !fieldOrder.includes(entry.name))
    if (unexpected) {
      throw new Error(`Unexpected MiniMax H3 top-level field: ${unexpected.name}`)
    }
    const names = matches.map((entry) => entry.name)
    if (names.length !== fieldOrder.length || names.some((name, index) => name !== fieldOrder[index])) {
      throw new Error(`MiniMax H3 fields must appear exactly in this order: ${fieldOrder.join(', ')}`)
    }
    const sections = {}
    matches.forEach((entry, index) => {
      const end = index + 1 < matches.length ? matches[index + 1].headerIndex : text.length
      const content = text.slice(entry.contentIndex, end).trim()
      if (!content) throw new Error(`MiniMax H3 field ${entry.name} cannot be empty`)
      sections[entry.name] = Object.freeze({
        name: entry.name,
        headerIndex: entry.headerIndex,
        content,
      })
    })
    return Object.freeze(sections)
  }

  function parseShotTimeline(narrative, durationSeconds) {
    const rawTags = Array.from(stringValue(narrative).matchAll(/\[Shot[^\]]*\]/g))
    if (!rawTags.length) throw new Error('MiniMax H3 prompt must contain [Shot 1]')
    const shots = []
    rawTags.forEach((tagMatch, index) => {
      const tag = tagMatch[0]
      const exact = tag.match(/^\[Shot ([1-9][0-9]*)\]$/)
      if (!exact) throw new Error(`Malformed MiniMax H3 shot tag: ${tag}`)
      const number = Number(exact[1])
      if (number !== index + 1) throw new Error('MiniMax H3 shot numbers must be contiguous and start at [Shot 1]')
      const tail = narrative.slice(tagMatch.index + tag.length)
      const timestamp = tail.match(/^ At ([0-9]{2}):([0-5][0-9])\.([0-9]{3})(?=$|[\s,，:：;；.。!?！？])/)
      if (number === 1 && timestamp) throw new Error('[Shot 1] must not contain a timestamp')
      if (number > 1 && !timestamp) throw new Error(`[Shot ${number}] must contain an At MM:SS.mmm timestamp`)
      let seconds = 0
      let timestampText = ''
      if (timestamp) {
        seconds = Number(timestamp[1]) * 60 + Number(timestamp[2]) + Number(timestamp[3]) / 1000
        timestampText = `${timestamp[1]}:${timestamp[2]}.${timestamp[3]}`
        const previous = shots[shots.length - 1]
        if (seconds <= previous.seconds) throw new Error('MiniMax H3 shot timestamps must be strictly increasing')
        if (seconds > durationSeconds + 0.0005) throw new Error('MiniMax H3 shot timestamp exceeds the selected duration')
      }
      shots.push(Object.freeze({ number, seconds, timestamp: timestampText }))
    })
    return Object.freeze(shots)
  }

  function validateAlignment(text, protocol, shots) {
    const firstLine = stringValue(text).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ''
    const alignedSeconds = Array.from(firstLine.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*(?:\u79d2|s(?:ec(?:onds?)?)?\b)/gi))
      .map((entry) => Number(entry[1]))
      .filter(Number.isFinite)
    const hasAlignedSecond = (expected) => alignedSeconds.some((value) => Math.abs(value - expected) <= 0.0005)
    if (protocol.mode === 'text_video' && !firstLine.startsWith('integrated_multimodal_description:')) {
      throw new Error('MiniMax H3 T2VA output must begin with integrated_multimodal_description')
    }
    if (protocol.mode === 'multi_reference' && !firstLine.startsWith('subject_definitions:')) {
      throw new Error('MiniMax H3 Ref2VA output must begin with subject_definitions')
    }
    if (protocol.mode === 'image_video') {
      if (
        !firstLine.includes('<Picture 1>') ||
        !firstLine.includes('[Shot 1]') ||
        !hasAlignedSecond(0)
      ) {
        throw new Error('MiniMax H3 I2VA output must begin with the 0.00-second <Picture 1> / [Shot 1] alignment')
      }
    }
    if (protocol.mode === 'first_last') {
      const lastShot = shots[shots.length - 1]
      if (
        !firstLine.includes('<Picture 1>') ||
        !firstLine.includes('<Picture 2>') ||
        !firstLine.includes('[Shot 1]') ||
        !firstLine.includes(`[Shot ${lastShot.number}]`) ||
        !hasAlignedSecond(0) ||
        !hasAlignedSecond(protocol.durationSeconds)
      ) {
        throw new Error('MiniMax H3 FL2VA output must begin with first/last frame alignment at 0.00 seconds and the selected duration')
      }
    }
  }

  function validateSubjectDefinitions(sections, modeValue) {
    const fullText = Object.values(sections).map((section) => section.content).join('\n')
    const subjectTokens = Array.from(fullText.matchAll(/<Subject ([1-9][0-9]*)>/g))
    if (modeValue !== 'multi_reference') {
      if (subjectTokens.length) throw new Error('MiniMax H3 base modes do not accept <Subject N> labels')
      return Object.freeze([])
    }
    const definitions = Array.from(sections.subject_definitions.content.matchAll(/^<Subject ([1-9][0-9]*)>\s*[:=\-]?\s*\S.*$/gm))
    const numbers = definitions.map((entry) => Number(entry[1]))
    if (new Set(numbers).size !== numbers.length) throw new Error('MiniMax H3 subject definitions must not be duplicated')
    numbers.forEach((number, index) => {
      if (number !== index + 1) throw new Error('MiniMax H3 subject definitions must start at <Subject 1> without gaps')
    })
    const defined = new Set(numbers)
    for (const match of fullText.matchAll(/<Subject ([1-9][0-9]*)>/g)) {
      if (!defined.has(Number(match[1]))) throw new Error(`${match[0]} is used without a subject_definitions entry`)
    }
    return Object.freeze(numbers)
  }

  function completeMissingSubjectDefinitions(text, fieldOrder, modeValue) {
    if (modeValue !== 'multi_reference') return text
    const value = stringValue(text)
    const sections = parseFieldSections(value, fieldOrder)
    const subjectSection = sections.subject_definitions
    if (!subjectSection) return value
    const usedNumbers = Array.from(value.matchAll(/<Subject ([1-9][0-9]*)>/g))
      .map((entry) => Number(entry[1]))
      .filter(Number.isFinite)
    if (!usedNumbers.length) return value
    const defined = new Set(Array.from(subjectSection.content.matchAll(/^<Subject ([1-9][0-9]*)>\s*[:=\-]?\s*\S.*$/gm))
      .map((entry) => Number(entry[1]))
      .filter(Number.isFinite))
    const maxNumber = Math.max(...usedNumbers, ...Array.from(defined))
    const missing = []
    for (let number = 1; number <= maxNumber; number += 1) {
      if (!defined.has(number)) missing.push(number)
    }
    if (!missing.length) return value
    const chinese = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(value)
    const additions = missing.map((number) => (
      chinese
        ? `<Subject ${number}>: 由本提示词正文中的主体描述定义。`
        : `<Subject ${number}>: subject described by the generated prompt narrative.`
    ))
    TOP_LEVEL_FIELD_HEADER_EXPRESSION.lastIndex = 0
    const matches = Array.from(value.matchAll(TOP_LEVEL_FIELD_HEADER_EXPRESSION))
    const subjectIndex = matches.findIndex((entry) => entry[1] === 'subject_definitions')
    if (subjectIndex < 0) return value
    const insertAt = subjectIndex + 1 < matches.length ? matches[subjectIndex + 1].index : value.length
    return `${value.slice(0, insertAt).trimEnd()}\n${additions.join('\n')}\n${value.slice(insertAt).replace(/^\s*/, '')}`.trim()
  }

  function validateReferenceUsage(text, protocol) {
    const available = new Set(protocol.references.modelTokens)
    const usedMedia = []
    const seen = new Set()
    for (const match of stringValue(text).matchAll(MEDIA_REFERENCE_EXPRESSION)) {
      const token = match[0]
      if (!available.has(token)) throw new Error(`MiniMax H3 output uses unavailable reference ${token}`)
      if (!seen.has(token)) {
        seen.add(token)
        usedMedia.push(token)
      }
    }
    if (protocol.mode !== 'multi_reference') protocol.references.modelTokens.forEach((token) => {
      if (!seen.has(token)) throw new Error(`MiniMax H3 output does not use captured reference ${token}`)
    })
    return Object.freeze(usedMedia)
  }

  function validateReferenceSummary(sections, protocol) {
    if (protocol.mode !== 'multi_reference') return Object.freeze([])
    const summary = sections.summary.content
    const match = summary.match(/^\[([^\]]+)\]\s*\S/)
    if (!match) return inferReferenceRelations(summary, protocol)
    const relations = match[1].split(/\s*(?:\+|,|\uFF0C|\/)\s*/).filter(Boolean)
    if (!relations.length || relations.some((relation) => !REFERENCE_RELATIONS.includes(relation))) {
      throw new Error(`Unsupported MiniMax H3 reference relation: ${match[1]}`)
    }
    return Object.freeze(relations)
  }

  function inferReferenceRelations(summary, protocol) {
    const references = protocol.references.references
    const hasKind = (kind) => references.some((reference) => reference.kind === kind)
    const text = stringValue(summary)
    const relations = []
    const add = (relation) => {
      if (REFERENCE_RELATIONS.includes(relation) && !relations.includes(relation)) relations.push(relation)
    }
    add('reference generation')
    if (hasKind('audio') && /(?:<Audio\s+[1-9][0-9]*>|audio|sound|voice|dialogue|\u58f0\u97f3|\u97f3\u9891|\u97f3\u6548|\u97f3\u8272|\u5bf9\u767d|\u8bed\u97f3)/i.test(text)) {
      add('audio reference')
    }
    if (hasKind('video') && /(?:continu(?:e|ation)|extend.*video|续写|续接|延续原视频|视频续)/i.test(text)) {
      add('video continuation')
    }
    if (hasKind('image') && /(?:first frame|last frame|keyframe|frame anchor|首帧|尾帧|关键帧)/i.test(text)) {
      add('keyframe completion')
    }
    return Object.freeze(relations)
  }

  function formatPromptLayout(text, sections, fieldOrder) {
    const formatNarrative = (content) => {
      // Only insert paragraph breaks outside quoted text and verbatim dialogue.
      const protectedRanges = Array.from(content.matchAll(/<d>[\s\S]*?<\/d>|"(?:\\.|[^"\\])*"|“[^”]*”/gu),
        (match) => [match.index, match.index + match[0].length])
      const boundaries = new Set([0, content.length])
      for (const part of new Intl.Segmenter('zh', { granularity: 'sentence' }).segment(content)) {
        boundaries.add(part.index + part.segment.length)
      }
      for (const match of content.matchAll(/\[Shot [1-9][0-9]*\]|\n[ \t]*\n/gu)) boundaries.add(match.index)
      const offsets = Array.from(boundaries).filter((offset) =>
        !protectedRanges.some(([start, end]) => offset > start && offset < end)).sort((a, b) => a - b)
      const paragraphs = []
      let paragraph = ''
      for (let index = 1; index < offsets.length; index += 1) {
        const raw = content.slice(offsets[index - 1], offsets[index])
        const chunk = raw.trim()
        if (!chunk) continue
        if (paragraph && (paragraph.length + chunk.length > 220 || /^\s*\[Shot /u.test(raw) || /^\n[ \t]*\n/u.test(raw))) {
          paragraphs.push(paragraph)
          paragraph = ''
        }
        paragraph += (paragraph ? ' ' : '') + chunk
        if (/\n[ \t]*\n\s*$/u.test(raw)) {
          paragraphs.push(paragraph)
          paragraph = ''
        }
      }
      if (paragraph) paragraphs.push(paragraph)
      return paragraphs.join('\n\n')
    }
    const prefix = text.slice(0, sections[fieldOrder[0]].headerIndex).trim()
    return [prefix, ...fieldOrder.map((field) => {
      let content = sections[field].content
      const narrative = field === 'integrated_multimodal_description' || field === 'detailed_description'
      const firstShot = content.indexOf('[Shot 1]')
      if (field === 'integrated_multimodal_description' && firstShot > 0) {
        content = `[Shot 1] ${content.slice(0, firstShot).trim()}\n\n${content.slice(firstShot + '[Shot 1]'.length).trim()}`
      }
      const multiline = field === 'subject_definitions' || field === 'retention_analysis'
      return `${field}:${multiline ? '\n' : ' '}${narrative ? formatNarrative(content) : content}`
    })].filter(Boolean).join('\n\n').replace(/\[\s+Shot\s+([1-9]\d*)\]/g, '[Shot $1]')
  }

  function validatePromptText(text, options) {
    let value = stripResponseFence(text)
    if (!value) throw new Error('MiniMax H3 enhanced prompt is empty')
    const protocol = createPromptProtocol(options)
    if (UI_REFERENCE_ALIAS_EXPRESSION.test(value)) {
      // In 多参视频 the editor text round-trips through display aliases
      // (@参考图1); a translated or provider result may echo one for a bound
      // resource. Bind it to the protocol token instead of failing. Other modes
      // keep the strict contract, and an alias without an upload stays an error.
      if (protocol.mode === 'multi_reference') {
        const byDisplayToken = protocol.references.byDisplayToken || {}
        value = value.replace(new RegExp(UI_REFERENCE_ALIAS_EXPRESSION.source, 'giu'), (match) => {
          const alias = match.replace(/\s*\((?:image|video|audio)\)$/i, '')
          return byDisplayToken[alias] || match
        })
      }
      const remaining = UI_REFERENCE_ALIAS_EXPRESSION.exec(value)
      if (remaining) throw new Error(`MiniMax H3 model output must use protocol references, not UI aliases (${remaining[0]})`)
    }
    if (protocol.mode === 'multi_reference') {
      value = globalThis.NovaFlowH3PromptFormat.validateReference(value, {
        mode: protocol.mode, durationSeconds: protocol.durationSeconds,
        requirements: 'Available resource labels: ' + protocol.references.references.map(r => r.modelToken).join('; '),
      })
    }
    if (/^【任务定位】/.test(value)) {
      const formatted = globalThis.NovaFlowH3PromptFormat.validateFormat(value, {
        mode: protocol.mode, durationSeconds: protocol.durationSeconds,
        requirements: 'Available resource labels: ' + protocol.references.references.map(r => r.modelToken).join('; '),
      })
      if (protocol.contentPolicy.sensitiveVisualAnalysis && containsExplicitMinorTerms(formatted) && containsSensitiveContentTerms(formatted)) {
        throw new Error('MiniMax H3 sensitive visual output is blocked because explicit minor evidence coexists with sensitive content')
      }
      return deepFreeze({ valid: true, text: formatted, mode: protocol.mode,
        protocolName: protocol.protocolName, durationSeconds: protocol.durationSeconds,
        fieldOrder: globalThis.NovaFlowH3PromptFormat.sectionNames.slice(),
        usedReferences: protocol.references.references.map(r => r.modelToken).filter(token => value.includes(token)), shots: [], subjects: [], relations: [],
      })
    }
    value = value.replace(new RegExp(`^([ \\t]*)(${protocol.fieldOrder.join('|')})[ \\t]*$`, 'gm'), '$1$2:')
    value = completeMissingSubjectDefinitions(value, protocol.fieldOrder, protocol.mode)
    const sections = parseFieldSections(value, protocol.fieldOrder)
    const narrative = protocol.mode === 'multi_reference'
      ? sections.detailed_description.content
      : sections.integrated_multimodal_description.content
    const shots = parseShotTimeline(narrative, protocol.durationSeconds)
    validateAlignment(value, protocol, shots)
    const usedReferences = validateReferenceUsage(value, protocol)
    const subjects = validateSubjectDefinitions(sections, protocol.mode)
    const relations = validateReferenceSummary(sections, protocol)
    if (protocol.contentPolicy.sensitiveVisualAnalysis
      && containsExplicitMinorTerms(value)
      && containsSensitiveContentTerms(value)) {
      throw new Error('MiniMax H3 sensitive visual output is blocked because explicit minor evidence coexists with sensitive content')
    }
    const hasIdleOrStillMotion = /呼吸|起伏|待机|(?:全程|保持|完全|持续)(?:静止|不动)|\b(?:breath\w*|idle|remain\w* still|completely still)\b/iu.test(narrative)
    const sourceVideoEdit = protocol.mode === 'multi_reference' && relations.includes('video editing') && /<Video [1-9]\d*>/.test(value)
    const hasSourceMotion = sourceVideoEdit && /(?:保留|按照|沿用|跟随|保持|遵循)[^。\n]{0,60}(?:轨迹|速度|运动|动作)|\b(?:follow\w*|match\w*|retain\w*|preserv\w*)\b[^.\n]{0,80}\b(?:trajector(?:y|ies)|movements?|motion|direction|phase)\b/iu.test(narrative)
    const sourceCameraBindings = sourceVideoEdit
      ? (sections.retention_analysis?.content || '').split('\n').filter(line => /^<Video [1-9]\d*>[^\n]*:\s*(?:fully_preserved|partially_preserved)\b/.test(line)).join('\n')
      : ''
    const hasSourceCamera = sourceVideoEdit && (
      /(?:保留|沿用|跟随|保持)[^。\n]{0,35}(?:原|源|参考|相同)[^。\n]{0,20}(?:镜头|相机|摄像机|机位)|(?:镜头|相机|摄像机|机位)[^。\n]{0,35}(?:沿用|跟随|保留)[^。\n]{0,20}(?:原|源|参考)/u.test(narrative)
      || /(?:保留|沿用|保持)[^。\n]{0,80}(?:镜头|相机|摄像机|机位)|(?:镜头|相机|摄像机|机位)[^。\n]{0,80}(?:保留|沿用|保持)|\b(?:keep|retain\w*|preserv\w*|maintain\w*)\b[^.\n]{0,80}\bcamera\b|\bcamera\b[^.\n]{0,80}\b(?:retain\w*|preserv\w*|maintain\w*|unchanged)\b/iu.test(sourceCameraBindings)
    )
    if (!ACTION_PROGRESSION_EXPRESSION.test(narrative) && !hasIdleOrStillMotion && !hasSourceMotion && !sourceVideoEdit) {
      throw new Error('MiniMax H3 narrative must describe action progression, not only a static image caption')
    }
    // An edit inherits the source camera unless the edit asks to change it.
    // Requiring users/models to restate that implicit choice rejected valid
    // wardrobe, color and style edits with otherwise complete video bindings.
    if (!CAMERA_DIRECTION_EXPRESSION.test(narrative) && !hasSourceCamera && !sourceVideoEdit) {
      throw new Error('MiniMax H3 narrative must state an explicit camera movement or locked-camera choice')
    }
    return deepFreeze({
      valid: true,
      text: formatPromptLayout(value, protocol.mode === 'multi_reference' && !/^\[/.test(sections.summary.content)
        ? Object.assign({}, sections, { summary: Object.assign({}, sections.summary, { content: `[${relations.join(' + ')}] ${sections.summary.content}` }) })
        : sections, protocol.fieldOrder),
      mode: protocol.mode,
      protocolName: protocol.protocolName,
      durationSeconds: protocol.durationSeconds,
      fieldOrder: protocol.fieldOrder.slice(),
      shots,
      usedReferences,
      subjects,
      relations,
    })
  }

  const referenceTranslations = new Map()
  function validateAndRestore(options) {
    const input = options && typeof options === 'object' ? options : {}
    const context = input.context
    assertContextIntegrity(context)
    if (input.current && isContextStale(context, input.current)) {
      throw new Error('MiniMax H3 prompt response is stale; discard it and request enhancement again')
    }
    const catalog = catalogFromContext(context)
    let pair = context.mode === 'multi_reference' ? globalThis.NovaFlowH3PromptFormat.referenceResult(input.text) : null
    const serialized = value => typeof value === 'string' ? value : JSON.stringify(value)
    const validationOptions = {
      mode: context.mode,
      durationSeconds: context.durationSeconds,
      resources: resourcesFromSnapshot(context.snapshot),
      contentPolicy: context.contentPolicy,
      requireReady: true,
    }
    if (pair) pair = globalThis.NovaFlowH3PromptFormat.referenceResult(globalThis.NovaFlowH3PromptFormat.validateReferenceResult(input.text, {requirements:'Available resource labels: ' + catalog.references.map(r=>r.modelToken).join('; '), durationSeconds:context.durationSeconds, currentPrompt:input.current?.prompt || ''}))
    const validation = validatePromptText(pair ? serialized(pair.modelPrompt) : input.text, validationOptions)
    const displayed = pair ? validatePromptText(serialized(pair.displayPrompt), validationOptions) : validation
    const restoredText = context.mode === 'multi_reference'
      ? globalThis.NovaFlowH3PromptFormat.toReferenceDisplay(toDisplayReferences(displayed.text, catalog))
      : validation.text
    if (pair && input.current) {
      const key = createPromptSnapshot({...input.current,prompt:restoredText}).fingerprint
      const compiled = {modelPrompt:validation.text,displayPrompt:displayed.text,...(pair.editPolicy ? {editPolicy:pair.editPolicy} : {})}
      referenceTranslations.set(key, compiled)
      referenceTranslations.set(createPromptSnapshot(input.current).fingerprint, compiled)
      while (referenceTranslations.size > 40) referenceTranslations.delete(referenceTranslations.keys().next().value)
    }
    return deepFreeze({
      text: restoredText,
      modelText: validation.text,
      referenceEditPolicy: pair?.editPolicy || null,
      validation,
      fingerprint: context.fingerprint,
    })
  }

  async function compileForGeneration(options, optimize) {
    const current = { ...options, modelId: MINIMAX_H3_MODEL_ID, mode: 'multi_reference' }
    const prepared = prepareRequest(current)
    if (globalThis.NovaFlowH3PromptFormat.referenceResult(prepared.prompt)) return validateAndRestore({text:prepared.prompt,context:prepared.context,current})
    const cached = referenceTranslations.get(createPromptSnapshot(current).fingerprint)
    if (cached) return validateAndRestore({text:JSON.stringify(cached),context:prepared.context,current})
    if (/^subject_definitions\s*:/.test(prepared.prompt) && !/(?:^|\n)summary:\s*\[[^\]]*\bvideo editing\b/.test(prepared.prompt) && !/[\u3400-\u9fff]/.test(prepared.prompt.replace(/<d>[\s\S]*?<\/d>/g,''))) {
      return validateAndRestore({ text: prepared.prompt, context: prepared.context, current })
    }
    if (typeof optimize !== 'function') throw new Error('多参提示词编译服务不可用')
    const text = await optimize({
      prompt: prepared.prompt, requirements: prepared.requirements,
      h3Mode: 'multi_reference', durationSeconds: current.durationSeconds,
      purpose: 'minimax-h3-prompt-enhance', surface: 'animation',
      visualSchema: H3_VISUAL_SCHEMA, contentPolicy: prepared.context.contentPolicy,
      supportsNegativePrompt: false,
    })
    return validateAndRestore({ text, context: prepared.context, current })
  }

  const API = {
    compileForGeneration,
    SNAPSHOT_VERSION,
    MINIMAX_H3_MODEL_ID,
    H3_VISUAL_SCHEMA,
    MIN_DURATION_SECONDS,
    MAX_DURATION_SECONDS,
    MODE_ORDER,
    MODE_DEFINITIONS,
    BASE_FIELD_ORDER,
    REFERENCE_FIELD_ORDER,
    REFERENCE_RELATIONS,
    normalizeContentPolicy,
    containsExplicitMinorTerms,
    containsSensitiveContentTerms,
    MULTI_REFERENCE_SLOTS,
    normalizeModelId,
    normalizeMode,
    getModeDefinition,
    getReferenceSchema,
    createReferenceCatalog,
    toModelReferences,
    toDisplayReferences,
    createPromptProtocol,
    createPromptSnapshot,
    snapshotFingerprint,
    assertSnapshotIntegrity,
    isPromptSnapshotStale,
    assertPromptSnapshotFresh,
    assertContextIntegrity,
    isContextStale,
    assertContextFresh,
    validatePromptText,
    prepareRequest,
    validateAndRestore,
  }

  return deepFreeze(API)
})
