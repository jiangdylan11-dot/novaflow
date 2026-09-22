(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceVideoMergeResourceBridge = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const RESOURCE_MIME = 'application/x-novaflow-ai-generated'
  const SUPPORTED_EXTENSIONS = Object.freeze(['mp4', 'webm'])
  const SUPPORTED_MIME_TYPES = Object.freeze(['video/mp4', 'video/webm'])
  const MAX_SHARED_ITEMS = 30

  function text(value) {
    return String(value == null ? '' : value).trim()
  }

  function extensionOf(value) {
    const match = text(value).toLowerCase().match(/\.([a-z0-9]+)$/)
    return match ? match[1] : ''
  }

  function isSupportedVideo(value) {
    const item = value && typeof value === 'object' ? value : {}
    const mimeType = text(item.mimeType || item.type).toLowerCase()
    const fileName = text(item.fileName || item.filename || item.name || item.localPath || item.path)
    return SUPPORTED_MIME_TYPES.includes(mimeType) || SUPPORTED_EXTENSIONS.includes(extensionOf(fileName))
  }

  function normalizeDescriptor(value, fallbackId) {
    const item = value && typeof value === 'object' ? value : {}
    const resourceId = text(item.resourceId || item.id || fallbackId)
    const file = item.file && typeof item.file === 'object' ? item.file : null
    const blob = item.blob && typeof item.blob === 'object' ? item.blob : null
    const localPath = text(item.localPath || item.filePath || item.path)
    const objectUrl = text(item.objectUrl || item.url)
    const mediaToken = text(item.mediaToken || item.token)
    const fileName = text(item.fileName || item.filename || item.name || file?.name || localPath.split(/[\\/]/).pop())
    const mimeType = text(item.mimeType || item.type || file?.type || blob?.type).toLowerCase()
    if (!resourceId) throw new Error('video_merge_resource_id_missing')
    if (!file && !blob && !localPath && !objectUrl) throw new Error('video_merge_resource_source_missing')
    const descriptor = {
      resourceId,
      fileName,
      mimeType,
      file,
      blob,
      localPath,
      objectUrl,
      mediaToken,
      ownedObjectUrl: item.ownedObjectUrl === true,
    }
    if (!isSupportedVideo(descriptor)) throw new Error('video_merge_unsupported_video')
    return Object.freeze(descriptor)
  }

  function getAssetBridge(config) {
    const direct = config && typeof config.assetBridge === 'object' ? config.assetBridge : null
    const bridge = direct || root?.NovaFlowAiSequenceAssetBridge
    if (!bridge || typeof bridge !== 'object') throw new Error('video_merge_asset_bridge_missing')
    return bridge
  }

  function dataTransferTypes(dataTransfer) {
    try { return Array.from(dataTransfer?.types || []).map(String) } catch (_) { return [] }
  }

  function hasNativeFiles(dataTransfer) {
    try {
      if (dataTransfer?.files?.length > 0) return true
    } catch (_) {}
    return dataTransferTypes(dataTransfer).includes('Files')
  }

  function readResourceId(dataTransfer) {
    if (!dataTransfer) return ''
    try {
      const explicitResourceId = text(
        dataTransfer.getData?.(RESOURCE_MIME) ||
        root?.__nf_ai_seq_drag_id
      )
      if (explicitResourceId) return explicitResourceId
      if (hasNativeFiles(dataTransfer)) return ''
      return text(dataTransfer.getData?.('text/plain') || dataTransfer.getData?.('Text'))
    } catch (_) {
      return text(root?.__nf_ai_seq_drag_id)
    }
  }

  function fileKey(file) {
    return [text(file?.name).toLowerCase(), Number(file?.size) || 0, Number(file?.lastModified) || 0].join('|')
  }

  function collectCandidateFile(file, state) {
    if (!file || state.videos.length >= MAX_SHARED_ITEMS) return
    const key = fileKey(file)
    if (!key || state.seen.has(key)) return
    state.seen.add(key)
    if (isSupportedVideo(file)) state.videos.push(file)
    else state.rejectedCount += 1
  }

  async function readEntry(entry, state) {
    if (!entry || state.videos.length >= MAX_SHARED_ITEMS) return
    if (entry.isFile) {
      await new Promise(function (resolve) {
        try {
          entry.file(function (file) {
            collectCandidateFile(file, state)
            resolve()
          }, resolve)
        } catch (_) { resolve() }
      })
      return
    }
    if (!entry.isDirectory) return
    const reader = entry.createReader?.()
    if (!reader) return
    while (state.videos.length < MAX_SHARED_ITEMS) {
      const entries = await new Promise(function (resolve) {
        try { reader.readEntries(function (items) { resolve(Array.from(items || [])) }, function () { resolve([]) }) }
        catch (_) { resolve([]) }
      })
      if (!entries.length) break
      for (const child of entries) {
        await readEntry(child, state)
        if (state.videos.length >= MAX_SHARED_ITEMS) break
      }
    }
  }

  async function extractDroppedVideos(dataTransfer) {
    const state = { videos: [], rejectedCount: 0, seen: new Set() }
    let inspectedEntries = false
    let items = []
    try { items = Array.from(dataTransfer?.items || []) } catch (_) {}
    for (const item of items) {
      if (item?.kind !== 'file' || state.videos.length >= MAX_SHARED_ITEMS) continue
      let entry = null
      try { entry = item.webkitGetAsEntry?.() || null } catch (_) {}
      if (entry) {
        inspectedEntries = true
        await readEntry(entry, state)
        continue
      }
      try {
        const file = item.getAsFile?.()
        collectCandidateFile(file, state)
      } catch (_) {}
    }
    if (!state.videos.length && !inspectedEntries) {
      let files = []
      try { files = Array.from(dataTransfer?.files || []) } catch (_) {}
      for (const file of files) {
        collectCandidateFile(file, state)
        if (state.videos.length >= MAX_SHARED_ITEMS) break
      }
    }
    return Object.freeze({
      videos: Object.freeze(state.videos.slice()),
      rejectedCount: state.rejectedCount,
    })
  }

  async function extractDroppedFiles(dataTransfer) {
    return (await extractDroppedVideos(dataTransfer)).videos
  }

  function planLayerAssignments(layers, descriptors, explicitLayerId) {
    const layerList = Array.from(layers || [])
    const descriptorList = Array.from(descriptors || [])
    const explicitId = text(explicitLayerId)
    const targets = explicitId
      ? layerList.filter(function (layer) { return text(layer?.id) === explicitId }).slice(0, 1)
      : layerList.filter(function (layer) { return !layer?.source })
    return Object.freeze(targets.slice(0, descriptorList.length).map(function (layer, index) {
      return Object.freeze({ layerId: text(layer?.id), descriptor: descriptorList[index] })
    }).filter(function (assignment) { return assignment.layerId && assignment.descriptor }))
  }

  function createAdapter(options) {
    const config = options && typeof options === 'object' ? options : {}

    async function resolveResource(resourceId) {
      const normalizedId = text(resourceId)
      if (!normalizedId) throw new Error('video_merge_resource_id_missing')
      const bridge = getAssetBridge(config)
      if (typeof bridge.resolveVideoResource !== 'function') throw new Error('video_merge_resource_resolver_missing')
      return normalizeDescriptor(await bridge.resolveVideoResource(normalizedId), normalizedId)
    }

    async function addLocalFiles(files) {
      const videos = Array.from(files || []).filter(isSupportedVideo).slice(0, MAX_SHARED_ITEMS)
      if (!videos.length) throw new Error('video_merge_no_supported_video')
      const bridge = getAssetBridge(config)
      if (typeof bridge.addLocalVideoFiles !== 'function') throw new Error('video_merge_resource_importer_missing')
      const added = await bridge.addLocalVideoFiles(videos, { sourceKind: 'video_merge_drop' })
      if (!Array.isArray(added) || !added.length) throw new Error('video_merge_resource_import_failed')
      return added.map(function (item) { return normalizeDescriptor(item, item?.resourceId || item?.id) })
    }

    async function publishExportedVideo(value) {
      const item = value && typeof value === 'object' ? value : {}
      const filePath = text(item.filePath || item.path || item.output?.filePath)
      if (!filePath) throw new Error('video_merge_output_path_missing')
      const bridge = getAssetBridge(config)
      if (typeof bridge.publishVideoResource !== 'function') throw new Error('video_merge_resource_publisher_missing')
      const published = await bridge.publishVideoResource({
        filePath,
        fileName: text(item.fileName || item.name || filePath.split(/[\\/]/).pop()),
        mimeType: text(item.mimeType || item.type),
      }, { sourceKind: 'video_merge_output' })
      return normalizeDescriptor(published, published?.resourceId || published?.id)
    }

    async function resolveDrop(dataTransfer) {
      const resourceId = readResourceId(dataTransfer)
      if (resourceId) {
        return Object.freeze({ kind: 'resource', descriptors: Object.freeze([await resolveResource(resourceId)]), rejectedCount: 0 })
      }
      const dropped = await extractDroppedVideos(dataTransfer)
      if (!dropped.videos.length) throw new Error(dropped.rejectedCount ? 'video_merge_unsupported_video' : 'video_merge_drop_empty')
      const descriptors = await addLocalFiles(dropped.videos)
      return Object.freeze({
        kind: 'files',
        descriptors: Object.freeze(descriptors),
        rejectedCount: dropped.rejectedCount,
      })
    }

    return Object.freeze({ resolveResource, addLocalFiles, publishExportedVideo, resolveDrop })
  }

  return Object.freeze({
    version: 1,
    RESOURCE_MIME,
    SUPPORTED_EXTENSIONS,
    SUPPORTED_MIME_TYPES,
    isSupportedVideo,
    readResourceId,
    extractDroppedFiles,
    extractDroppedVideos,
    normalizeDescriptor,
    planLayerAssignments,
    create: createAdapter,
    createAdapter,
  })
})
