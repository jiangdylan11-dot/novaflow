(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceMiniMaxH3Resource = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const MODEL_ID = 'minimax_h3_local'

  const MODE_ORDER = Object.freeze([
    'text_video',
    'image_video',
    'first_last',
    'multi_reference',
  ])

  function mode(value, label, inputLayout) {
    return Object.freeze({
      value,
      label,
      inputLayout,
      supportsNegativePrompt: false,
    })
  }

  const MODE_CAPABILITIES = Object.freeze({
    text_video: mode('text_video', '\u6587\u751f\u89c6\u9891', 'none'),
    image_video: mode('image_video', '\u56fe\u751f\u89c6\u9891', 'single_image'),
    first_last: mode('first_last', '\u9996\u5c3e\u5e27\u89c6\u9891', 'first_last'),
    multi_reference: mode('multi_reference', '\u591a\u53c2\u89c6\u9891', 'multi_reference'),
  })

  const MODE_OPTIONS = Object.freeze(MODE_ORDER.map((value) => MODE_CAPABILITIES[value]))

  const ACCEPT_BY_KIND = Object.freeze({
    image: 'image/*',
    video: 'video/*',
    audio: 'audio/*',
  })

  function slot(key, label, kind, modelToken, aliases) {
    return Object.freeze({
      key,
      label,
      kind,
      accept: ACCEPT_BY_KIND[kind],
      modelToken,
      aliases: Object.freeze(aliases.slice()),
    })
  }

  const MULTI_REFERENCE_SLOTS = Object.freeze([
    slot('multi_ref_image_1', '\u53c2\u8003\u56fe1', 'image', '<Picture 1>', ['@\u53c2\u8003\u56fe1', '@\u56fe\u72471']),
    slot('multi_ref_image_2', '\u53c2\u8003\u56fe2', 'image', '<Picture 2>', ['@\u53c2\u8003\u56fe2', '@\u56fe\u72472']),
    slot('multi_ref_image_3', '\u53c2\u8003\u56fe3', 'image', '<Picture 3>', ['@\u53c2\u8003\u56fe3', '@\u56fe\u72473']),
    slot('multi_ref_image_4', '\u53c2\u8003\u56fe4', 'image', '<Picture 4>', ['@\u53c2\u8003\u56fe4', '@\u56fe\u72474']),
    slot('multi_ref_video_1', '\u89c6\u9891\u53c2\u8003', 'video', '<Video 1>', ['@\u89c6\u9891\u53c2\u8003', '@\u89c6\u98911']),
    slot('multi_ref_audio_1', '\u58f0\u97f3\u53c2\u8003', 'audio', '<Audio 1>', ['@\u58f0\u97f3\u53c2\u8003', '@\u97f3\u98911', '@\u97f3\u9891\u53c2\u8003']),
  ])

  const SLOT_BY_KEY = new Map(MULTI_REFERENCE_SLOTS.map((entry) => [entry.key, entry]))

  const EXTENSIONS_BY_KIND = Object.freeze({
    image: Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'jfif']),
    video: Object.freeze(['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv']),
    audio: Object.freeze(['wav', 'mp3', 'm4a', 'aac', 'ogg', 'flac', 'opus']),
  })

  function stringValue(value) {
    return value == null ? '' : String(value)
  }

  function normalizeKind(value) {
    const kind = stringValue(value).trim().toLowerCase()
    return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : ''
  }

  function getModeCapability(value) {
    return MODE_CAPABILITIES[stringValue(value).trim().toLowerCase()] || null
  }

  function assertMode(value) {
    const capability = getModeCapability(value)
    if (!capability) throw new Error(`Unsupported MiniMax H3 mode: ${stringValue(value).trim() || '(empty)'}`)
    return capability
  }

  function getSlot(value) {
    return SLOT_BY_KEY.get(stringValue(value).trim()) || null
  }

  function extensionKind(name) {
    const match = stringValue(name).trim().toLowerCase().match(/\.([a-z0-9]+)$/)
    if (!match) return ''
    const extension = match[1]
    return Object.keys(EXTENSIONS_BY_KIND).find((kind) => EXTENSIONS_BY_KIND[kind].includes(extension)) || ''
  }

  function mimeKind(value) {
    const mime = stringValue(value).trim().toLowerCase()
    if (mime.startsWith('image/')) return 'image'
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('audio/')) return 'audio'
    return ''
  }

  function dataUrlKind(value) {
    const match = stringValue(value).trim().match(/^data:(image|video|audio)\//i)
    return match ? match[1].toLowerCase() : ''
  }

  function resourceFile(resource) {
    return resource && typeof resource === 'object' && resource.file && typeof resource.file === 'object'
      ? resource.file
      : null
  }

  function resourceFileName(resource) {
    const file = resourceFile(resource)
    return stringValue(resource?.fileName || resource?.name || file?.name).trim()
  }

  function resourceMimeType(resource) {
    const file = resourceFile(resource)
    return stringValue(resource?.mimeType || resource?.type || file?.type).trim().toLowerCase()
  }

  function detectedResourceKinds(resource) {
    if (!resource || typeof resource !== 'object') return Object.freeze([])
    const kinds = [
      mimeKind(resourceMimeType(resource)),
      extensionKind(resourceFileName(resource)),
      dataUrlKind(resource.dataUrl || resource.objectUrl || resource.previewUrl),
      normalizeKind(resource.kind),
    ].filter(Boolean)
    return Object.freeze(Array.from(new Set(kinds)))
  }

  function fileMatchesSlot(resource, slotKey) {
    const descriptor = getSlot(slotKey)
    if (!descriptor || !resource || typeof resource !== 'object') return false
    const kinds = detectedResourceKinds(resource)
    return kinds.length > 0 && kinds.every((kind) => kind === descriptor.kind)
  }

  function assertFileMatchesSlot(resource, slotKey) {
    const descriptor = getSlot(slotKey)
    if (!descriptor) throw new Error(`Unknown MiniMax H3 resource slot: ${stringValue(slotKey) || '(empty)'}`)
    if (!fileMatchesSlot(resource, descriptor.key)) {
      const name = resourceFileName(resource) || '\u672a\u547d\u540d\u8d44\u6e90'
      throw new TypeError(`${descriptor.label}\u4ec5\u63a5\u53d7 ${descriptor.accept}\uff1a${name}`)
    }
    return true
  }

  function resourceIsOccupied(resource) {
    if (!resource || typeof resource !== 'object') return false
    if (typeof resource.occupied === 'boolean') return resource.occupied
    return Boolean(
      resource.file ||
      resource.sourceId ||
      resource.resourceId ||
      resource.id ||
      resource.fileName ||
      resource.name ||
      resource.dataUrl ||
      resource.objectUrl ||
      resource.localPath,
    )
  }

  function resourceIdentity(resource, key) {
    const file = resourceFile(resource)
    const explicit = stringValue(resource?.sourceId || resource?.resourceId || resource?.id).trim()
    if (explicit) return explicit
    const fileName = resourceFileName(resource)
    const size = Number(resource?.size ?? file?.size)
    const lastModified = Number(resource?.lastModified ?? file?.lastModified)
    const mime = resourceMimeType(resource)
    if (!fileName && !mime && !Number.isFinite(size) && !Number.isFinite(lastModified)) return ''
    return [
      key,
      fileName,
      mime,
      Number.isFinite(size) ? size : '',
      Number.isFinite(lastModified) ? lastModified : '',
    ].join(':')
  }

  function resourceEntries(resources) {
    if (resources == null) return []
    if (Array.isArray(resources)) return resources.slice()
    if (typeof resources !== 'object') throw new TypeError('MiniMax H3 resources must be an array or keyed object')
    return Object.entries(resources).map(([key, value]) => {
      if (!value || typeof value !== 'object') return { key, occupied: false }
      return { ...value, key: value.key || key }
    })
  }

  function emptySnapshotEntry(descriptor) {
    return Object.freeze({
      key: descriptor.key,
      label: descriptor.label,
      kind: descriptor.kind,
      accept: descriptor.accept,
      modelToken: descriptor.modelToken,
      aliases: descriptor.aliases,
      occupied: false,
      sourceId: '',
      identity: '',
      fileName: '',
      mimeType: '',
    })
  }

  function createResourceSnapshot(resources) {
    const byKey = new Map()
    resourceEntries(resources).forEach((resource) => {
      if (!resource || typeof resource !== 'object') throw new TypeError('MiniMax H3 resource entry must be an object')
      const key = stringValue(resource.key || resource.slotKey).trim()
      const descriptor = getSlot(key)
      if (!descriptor) throw new Error(`Unknown MiniMax H3 resource slot: ${key || '(empty)'}`)
      if (byKey.has(key)) throw new Error(`Duplicate MiniMax H3 resource slot: ${key}`)
      byKey.set(key, resource)
    })

    return Object.freeze(MULTI_REFERENCE_SLOTS.map((descriptor) => {
      const resource = byKey.get(descriptor.key)
      if (!resource || !resourceIsOccupied(resource)) return emptySnapshotEntry(descriptor)
      assertFileMatchesSlot(resource, descriptor.key)
      const sourceId = stringValue(resource.sourceId || resource.resourceId || resource.id).trim()
      const identity = resourceIdentity(resource, descriptor.key)
      if (!identity) throw new Error(`${descriptor.label}\u7f3a\u5c11\u7a33\u5b9a\u8d44\u6e90\u6807\u8bc6`)
      return Object.freeze({
        key: descriptor.key,
        label: descriptor.label,
        kind: descriptor.kind,
        accept: descriptor.accept,
        modelToken: descriptor.modelToken,
        aliases: descriptor.aliases,
        occupied: true,
        sourceId,
        identity,
        fileName: resourceFileName(resource),
        mimeType: resourceMimeType(resource),
      })
    }))
  }

  function validateResourceSnapshot(resources, options = {}) {
    const capability = assertMode(options.mode || 'multi_reference')
    const snapshot = createResourceSnapshot(resources)
    const occupied = snapshot.filter((entry) => entry.occupied)
    if (capability.inputLayout === 'multi_reference' && options.requireAny !== false && occupied.length === 0) {
      throw new Error('\u591a\u53c2\u89c6\u9891\u81f3\u5c11\u9700\u8981\u4e00\u4e2a\u53c2\u8003\u8d44\u6e90')
    }
    if (capability.inputLayout !== 'multi_reference' && options.rejectInactiveResources === true && occupied.length > 0) {
      throw new Error(`${capability.label}\u4e0d\u5e94\u63d0\u4ea4\u591a\u53c2\u8d44\u6e90`)
    }
    const requiredKeys = Array.isArray(options.requiredKeys) ? options.requiredKeys : []
    requiredKeys.forEach((key) => {
      const descriptor = getSlot(key)
      if (!descriptor) throw new Error(`Unknown MiniMax H3 resource slot: ${stringValue(key) || '(empty)'}`)
      if (!snapshot.find((entry) => entry.key === descriptor.key)?.occupied) {
        throw new Error(`${descriptor.label}\u672a\u63d0\u4f9b`)
      }
    })
    return snapshot
  }

  function assertStableResourceSnapshot(expectedResources, currentResources, options = {}) {
    const expected = createResourceSnapshot(expectedResources)
    const current = createResourceSnapshot(currentResources)
    const keys = Array.isArray(options.keys) && options.keys.length
      ? options.keys.map((key) => {
          const descriptor = getSlot(key)
          if (!descriptor) throw new Error(`Unknown MiniMax H3 resource slot: ${stringValue(key) || '(empty)'}`)
          return descriptor.key
        })
      : MULTI_REFERENCE_SLOTS.map((entry) => entry.key)
    keys.forEach((key) => {
      const before = expected.find((entry) => entry.key === key)
      const after = current.find((entry) => entry.key === key)
      if (before.occupied !== after.occupied || before.identity !== after.identity || before.kind !== after.kind) {
        throw new Error(`${before.label}\u8d44\u6e90\u5feb\u7167\u5df2\u53d8\u66f4\uff0c\u8bf7\u91cd\u65b0\u786e\u8ba4`)
      }
    })
    return true
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  const ALIAS_TO_SLOT = new Map()
  MULTI_REFERENCE_SLOTS.forEach((descriptor) => {
    descriptor.aliases.forEach((alias) => ALIAS_TO_SLOT.set(alias, descriptor))
  })
  const MENTION_EXPRESSION = new RegExp(
    Array.from(ALIAS_TO_SLOT.keys())
      .sort((left, right) => right.length - left.length)
      .map((alias) => escapeRegExp(alias) + (/[0-9]$/.test(alias) ? '(?![0-9])' : ''))
      .join('|'),
    'g',
  )

  function compactOccupiedModelTokens(snapshot) {
    const nextIndex = { image: 0, video: 0, audio: 0 }
    return Object.freeze(snapshot.map((entry) => {
      if (!entry.occupied || !Object.hasOwn(nextIndex, entry.kind)) return entry
      nextIndex[entry.kind] += 1
      const prefix = entry.kind === 'image' ? 'Picture' : entry.kind === 'video' ? 'Video' : 'Audio'
      const modelToken = `<${prefix} ${nextIndex[entry.kind]}>`
      if (modelToken === entry.modelToken) return entry
      return Object.freeze({
        ...entry,
        slotModelToken: entry.modelToken,
        modelToken,
      })
    }))
  }

  function compileMentions(text, resources) {
    const sourceText = stringValue(text)
    const snapshot = compactOccupiedModelTokens(
      validateResourceSnapshot(resources, { mode: 'multi_reference', requireAny: false }),
    )
    const byKey = new Map(snapshot.map((entry) => [entry.key, entry]))
    const invalidTokens = []
    const invalidSet = new Set()
    const mentions = []
    const compiledText = sourceText.replace(MENTION_EXPRESSION, (alias) => {
      const descriptor = ALIAS_TO_SLOT.get(alias)
      const resource = descriptor ? byKey.get(descriptor.key) : null
      if (!descriptor || !resource?.occupied) {
        if (!invalidSet.has(alias)) {
          invalidSet.add(alias)
          invalidTokens.push(alias)
        }
        return alias
      }
      mentions.push(Object.freeze({
        key: descriptor.key,
        alias,
        modelToken: resource.modelToken,
        sourceId: resource.sourceId,
        identity: resource.identity,
      }))
      return resource.modelToken
    })
    return Object.freeze({
      text: compiledText,
      mentions: Object.freeze(mentions),
      invalidTokens: Object.freeze(invalidTokens),
      snapshot,
    })
  }

  const REFERENCE_MEDIA_POLICY = Object.freeze({
    maxImages: 4,
    maxVideos: 1,
    maxAudios: 1,
    requiredVideoFps: 24,
    videoFpsTolerance: 0.05,
    minimumDurationSec: 2,
    maximumDurationSec: 15,
    maximumTypeDurationSec: 15,
    durationToleranceSec: 0.0005,
    minimumVideoFrames: 5,
  })

  function policyList(value, label, maximum) {
    if (value == null) return []
    if (!Array.isArray(value)) throw new TypeError(label + ' must be an array')
    const entries = value.filter((entry) => entry != null)
    if (entries.length > maximum) {
      throw new RangeError(`MiniMax H3 ${label} supports at most ${maximum} item(s)`)
    }
    return entries
  }

  function policyDuration(entry, label) {
    const duration = Number(entry?.durationSec)
    if (
      !Number.isFinite(duration) ||
      duration < REFERENCE_MEDIA_POLICY.minimumDurationSec ||
      duration > REFERENCE_MEDIA_POLICY.maximumDurationSec
    ) {
      throw new RangeError(
        `MiniMax H3 ${label} duration must be ${REFERENCE_MEDIA_POLICY.minimumDurationSec}-${REFERENCE_MEDIA_POLICY.maximumDurationSec} seconds`,
      )
    }
    return duration
  }

  function validateReferenceMediaPolicy(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('MiniMax H3 reference media policy options must be an object')
    }
    const images = policyList(options.images, 'reference images', REFERENCE_MEDIA_POLICY.maxImages)
    const videos = policyList(options.videos, 'reference videos', REFERENCE_MEDIA_POLICY.maxVideos)
    const audios = policyList(options.audios, 'reference audios', REFERENCE_MEDIA_POLICY.maxAudios)

    let videoDurationSec = 0
    for (const video of videos) {
      const fps = Number(video?.fps)
      if (
        !Number.isFinite(fps) ||
        Math.abs(fps - REFERENCE_MEDIA_POLICY.requiredVideoFps) > REFERENCE_MEDIA_POLICY.videoFpsTolerance
      ) {
        throw new RangeError('MiniMax H3 reference video must be 24 FPS')
      }
      const framesValue = video?.frames
      if (framesValue != null && framesValue !== '') {
        const frames = Number(framesValue)
        if (!Number.isFinite(frames) || frames < REFERENCE_MEDIA_POLICY.minimumVideoFrames) {
          throw new RangeError('MiniMax H3 reference video must contain at least five frames')
        }
      }
      videoDurationSec += policyDuration(video, 'reference video')
    }

    let audioDurationSec = 0
    for (const audio of audios) audioDurationSec += policyDuration(audio, 'reference audio')
    if (
      videoDurationSec > REFERENCE_MEDIA_POLICY.maximumTypeDurationSec + REFERENCE_MEDIA_POLICY.durationToleranceSec
    ) {
      throw new RangeError('MiniMax H3 total reference video duration exceeds 15 seconds')
    }
    if (
      audioDurationSec > REFERENCE_MEDIA_POLICY.maximumTypeDurationSec + REFERENCE_MEDIA_POLICY.durationToleranceSec
    ) {
      throw new RangeError('MiniMax H3 total reference audio duration exceeds 15 seconds')
    }

    return Object.freeze({
      imageCount: images.length,
      videoCount: videos.length,
      audioCount: audios.length,
      videoDurationSec,
      audioDurationSec,
    })
  }

  const MODEL = Object.freeze({
    id: MODEL_ID,
    label: '本地模型',
    modeOrder: MODE_ORDER,
  })

  return Object.freeze({
    modelId: MODEL_ID,
    MODEL_ID,
    MODEL,
    modeOrder: MODE_ORDER,
    MODE_ORDER,
    modeOptions: MODE_OPTIONS,
    MODE_OPTIONS,
    modeCapabilities: MODE_CAPABILITIES,
    MODE_CAPABILITIES,
    multiReferenceSlots: MULTI_REFERENCE_SLOTS,
    MULTI_REFERENCE_SLOTS,
    getModeCapability,
    assertMode,
    getSlot,
    detectedResourceKinds,
    fileMatchesSlot,
    assertFileMatchesSlot,
    createResourceSnapshot,
    validateResourceSnapshot,
    assertStableResourceSnapshot,
    compileMentions,
    REFERENCE_MEDIA_POLICY,
    validateReferenceMediaPolicy,
  })
})
