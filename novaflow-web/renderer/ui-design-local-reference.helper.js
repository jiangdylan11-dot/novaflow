(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignLocalReference = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const VERSION = '20260730-ui-design-local-reference-10'
  const PLAN_KIND = 'ui-local-reference-plan'
  const DUAL_PROXY_KIND = 'ui-local-reference-dual-proxy'
  const REDESIGN_MODE = 'redesign'
  const ITERATION_MODE = 'iteration'
  const GUIDANCE_TREATMENT = 'guidance'
  const COMPOSITION_GUIDANCE_TREATMENT = 'composition-guidance'
  const RAW_TREATMENT = 'raw'
  const BASE_TREATMENT = 'base'
  const LOW_FREQUENCY_PROXY_ENCODING = 'low-frequency-raster-v1'
  const COMPOSITION_PROXY_ENCODING = 'composition-proxy-raster-v2'
  const COMPOSITION_SEMANTIC_FUSION_ENCODING = 'composition-semantic-fusion-raster-v1'
  const MATERIAL_PROXY_ENCODING = 'material-proxy-raster-v2'
  const MATERIAL_PROXY_ALGORITHM = 'deterministic-microtile-scatter-v2'
  const IDENTITY_REDUCTION_POLICY = 'destroy-semantic-adjacency-preserve-surface-detail-v2'
  const PERIMETER_SCRUB_ENCODING = 'perimeter-identity-scrub-raster-v1'
  const PERIMETER_SCRUB_ALGORITHM = 'full-resolution-edge-pixelate-v1'
  const PERIMETER_SCRUB_TREATMENT = 'perimeter-scrubbed-primary'
  const PERIMETER_IDENTITY_REDUCTION_POLICY = 'scrub-common-perimeter-source-identity-preserve-interior-v1'
  const PERIMETER_SCRUB_DEFAULTS = Object.freeze({
    topRatio: 0.105,
    sideRatio: 0.055,
    bottomRatio: 0.06,
    pixelBlockRatio: 0.02,
    minPixelBlockSize: 12,
    maxPixelBlockSize: 24,
    sampleFilter: 'blur(0.65px)',
  })
  // References that carry composition, identity, content, texture or finish
  // need their original detail to remain useful to the edit model. Only an
  // explicitly palette-only reference is reduced to low-frequency guidance.
  const GUIDANCE_ROLES = new Set(['color'])
  const RAW_ROLES = new Set(['reference', 'layout', 'style', 'character', 'subject', 'content', 'material'])

  function text(value) {
    return String(value == null ? '' : value).trim()
  }

  function sourceFingerprint(value) {
    const source = text(value)
    let hash = 0x811c9dc5
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return `ui-ref-source-v1:${source.length}:${hash.toString(16).padStart(8, '0')}`
  }

  function proxyCacheKey(proxyEncoding, fingerprint, sampleMaxEdge, outputMaxEdge) {
    return [
      text(proxyEncoding) || LOW_FREQUENCY_PROXY_ENCODING,
      text(fingerprint),
      Math.max(1, positiveInteger(sampleMaxEdge)),
      Math.max(1, positiveInteger(outputMaxEdge)),
    ].join(':')
  }

  function materialProxyCacheKey(
    fingerprint,
    sampleMaxEdge,
    outputMaxEdge,
    microTileSize,
    offsetOpacity,
    softenFilter,
  ) {
    return [
      MATERIAL_PROXY_ENCODING,
      MATERIAL_PROXY_ALGORITHM,
      text(fingerprint),
      Math.max(1, positiveInteger(sampleMaxEdge)),
      Math.max(1, positiveInteger(outputMaxEdge)),
      Math.max(1, positiveInteger(microTileSize)),
      Number(offsetOpacity).toFixed(3),
      text(softenFilter) || 'none',
    ].join(':')
  }

  function perimeterScrubCacheKey(fingerprint, config = {}) {
    const parts = [
      PERIMETER_SCRUB_ENCODING,
      PERIMETER_SCRUB_ALGORITHM,
      text(fingerprint),
      Number(config.topRatio).toFixed(4),
      Number(config.sideRatio).toFixed(4),
      Number(config.bottomRatio).toFixed(4),
      Number(config.pixelBlockRatio).toFixed(4),
      Math.max(1, positiveInteger(config.pixelBlockSize)),
      text(config.sampleFilter) || 'none',
    ]
    const preserveRegionSignature = text(config.preserveRegionSignature)
    if (preserveRegionSignature) parts.push(preserveRegionSignature)
    return parts.join(':')
  }

  function normalizedPreserveBounds(value) {
    if (!value || typeof value !== 'object') return null
    const source = value.normalizedBounds
      || value.bounds
      || value.region
      || value.geometry
      || value.normalized
      || value
    if (!source || typeof source !== 'object') return null
    const x = Number(source.xNorm ?? source.leftNorm ?? source.x ?? source.left)
    const y = Number(source.yNorm ?? source.topNorm ?? source.y ?? source.top)
    const width = Number(source.wNorm ?? source.widthNorm ?? source.w ?? source.width)
    const height = Number(source.hNorm ?? source.heightNorm ?? source.h ?? source.height)
    if (![x, y, width, height].every(Number.isFinite)) return null
    if (x < 0 || y < 0 || x >= 1 || y >= 1 || width <= 0 || height <= 0) return null
    if (width > 1 || height > 1) return null
    const right = Math.min(1, x + width)
    const bottom = Math.min(1, y + height)
    if (right <= x || bottom <= y) return null
    return { x, y, width: right - x, height: bottom - y }
  }

  function pixelPreserveRegions(values, sourceWidth, sourceHeight) {
    if (!Array.isArray(values) || !values.length) return []
    const regions = []
    const seen = new Set()
    values.forEach((value) => {
      const bounds = normalizedPreserveBounds(value)
      if (!bounds) return
      const left = Math.max(0, Math.floor(bounds.x * sourceWidth))
      const top = Math.max(0, Math.floor(bounds.y * sourceHeight))
      const right = Math.min(sourceWidth, Math.ceil((bounds.x + bounds.width) * sourceWidth))
      const bottom = Math.min(sourceHeight, Math.ceil((bounds.y + bounds.height) * sourceHeight))
      if (right <= left || bottom <= top) return
      const signature = `${left},${top},${right - left},${bottom - top}`
      if (seen.has(signature)) return
      seen.add(signature)
      regions.push({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      })
    })
    return regions.sort((left, right) => (
      left.y - right.y
      || left.x - right.x
      || left.height - right.height
      || left.width - right.width
    ))
  }

  function subtractPreservedRegion(source, preserve) {
    const sourceRight = source.x + source.width
    const sourceBottom = source.y + source.height
    const preserveRight = preserve.x + preserve.width
    const preserveBottom = preserve.y + preserve.height
    const left = Math.max(source.x, preserve.x)
    const top = Math.max(source.y, preserve.y)
    const right = Math.min(sourceRight, preserveRight)
    const bottom = Math.min(sourceBottom, preserveBottom)
    if (left >= right || top >= bottom) return [source]
    return [
      { x: source.x, y: source.y, width: source.width, height: top - source.y },
      { x: source.x, y: bottom, width: source.width, height: sourceBottom - bottom },
      { x: source.x, y: top, width: left - source.x, height: bottom - top },
      { x: right, y: top, width: sourceRight - right, height: bottom - top },
    ].filter((region) => region.width > 0 && region.height > 0)
  }

  function fingerprintSeed(fingerprint) {
    const value = text(fingerprint)
    const suffix = value.slice(value.lastIndexOf(':') + 1)
    const parsed = Number.parseInt(suffix, 16)
    return (Number.isFinite(parsed) ? parsed : 0x811c9dc5) >>> 0
  }

  function seededRandom(seed) {
    let state = (Number(seed) || 0x811c9dc5) >>> 0
    return function random() {
      state = (state + 0x6d2b79f5) >>> 0
      let value = state
      value = Math.imul(value ^ (value >>> 15), value | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
  }

  function deterministicScatterOrder(count, columns, seed) {
    const total = Math.max(1, positiveInteger(count))
    const columnCount = Math.max(1, positiveInteger(columns))
    const random = seededRandom(seed)
    const available = Array.from({ length: total }, (_, index) => index)
    for (let index = available.length - 1; index > 0; index -= 1) {
      const replacement = Math.floor(random() * (index + 1))
      const current = available[index]
      available[index] = available[replacement]
      available[replacement] = current
    }
    const order = []
    const adjacent = (left, right) => {
      if (!Number.isInteger(left) || !Number.isInteger(right)) return false
      const leftColumn = left % columnCount
      const rightColumn = right % columnCount
      const leftRow = Math.floor(left / columnCount)
      const rightRow = Math.floor(right / columnCount)
      return Math.abs(leftColumn - rightColumn) + Math.abs(leftRow - rightRow) <= 1
    }
    while (available.length) {
      const targetIndex = order.length
      const previous = targetIndex > 0 ? order[targetIndex - 1] : -1
      const above = targetIndex >= columnCount ? order[targetIndex - columnCount] : -1
      let candidateIndex = available.findIndex((candidate) => (
        !adjacent(candidate, previous) && !adjacent(candidate, above)
      ))
      if (candidateIndex < 0) candidateIndex = 0
      order.push(available.splice(candidateIndex, 1)[0])
    }
    return order
  }

  function normalizeToken(value) {
    return text(value).toLowerCase().replace(/[\s_]+/g, '-')
  }

  function normalizeMode(value) {
    const mode = normalizeToken(value)
    if (['iteration', 'iterate', 'edit', 'refine', 'revision'].includes(mode)) return ITERATION_MODE
    return REDESIGN_MODE
  }

  function normalizeRole(value) {
    const role = normalizeToken(value)
    if (['base', 'iteration', 'iteration-base', 'edit-base'].includes(role)) return 'base'
    if (['style', 'visual-style'].includes(role)) return 'style'
    if (['character', 'role'].includes(role)) return 'character'
    if (['subject', 'identity'].includes(role)) return 'subject'
    if (['material', 'texture'].includes(role)) return 'material'
    if (['color', 'palette'].includes(role)) return 'color'
    if (['layout', 'ui-layout', 'ui_layout'].includes(role)) return 'layout'
    if (['content', 'asset'].includes(role)) return 'content'
    return 'reference'
  }

  function positiveInteger(value) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
  }

  function normalizeReference(value, index) {
    if (!value) return null
    if (typeof value === 'string') {
      const dataUrl = text(value)
      return dataUrl ? {
        index,
        name: `ui_reference_${index + 1}.png`,
        dataUrl,
        sourceFingerprint: sourceFingerprint(dataUrl),
        role: 'reference',
        sourceId: '',
        width: 0,
        height: 0,
      } : null
    }
    if (typeof value !== 'object') return null
    const dataUrl = text(value.dataUrl || value.imageUrl || value.url || value.src)
    if (!dataUrl) return null
    return {
      index,
      name: text(value.name || value.fileName || value.filename) || `ui_reference_${index + 1}.png`,
      dataUrl,
      sourceFingerprint: sourceFingerprint(dataUrl),
      role: normalizeRole(value.role || value.referenceRole || value.kind || value.type),
      sourceId: text(value.sourceId || value.resourceId || value.id),
      targetNodeId: text(value.targetNodeId || value.targetId),
      connectionKind: normalizeToken(value.connectionKind || value.edgeKind),
      width: positiveInteger(value.width ?? value.w),
      height: positiveInteger(value.height ?? value.h),
    }
  }

  function resolveArguments(input, options) {
    if (
      input
      && typeof input === 'object'
      && !Array.isArray(input)
      && Array.isArray(input.references)
    ) {
      return {
        references: input.references,
        options: { ...input, ...(options && typeof options === 'object' ? options : {}) },
      }
    }
    return {
      references: Array.isArray(input) ? input : [],
      options: options && typeof options === 'object' ? options : {},
    }
  }

  function explicitBaseReferenceIndex(references) {
    const reference = references.find((item) => item.role === 'base')
    return reference ? reference.index : -1
  }

  function defaultIterationBaseReferenceIndex(references) {
    const reference = references.find((item) => item.role === 'reference')
      || references.find((item) => item.role !== 'layout')
    return reference ? reference.index : -1
  }

  function resolveBaseIndex(references, mode, options) {
    const explicitIndex = explicitBaseReferenceIndex(references)
    if (explicitIndex >= 0) return explicitIndex
    if (mode !== ITERATION_MODE || references.length === 0) return -1
    if (Number.isInteger(options.baseIndex) && options.baseIndex >= 0) {
      const indexedReference = references.find((reference) => reference.index === options.baseIndex)
        || references[options.baseIndex]
      if (indexedReference) return indexedReference.index
    }
    return defaultIterationBaseReferenceIndex(references)
  }

  function treatmentFor(reference, baseIndex) {
    if (reference.index === baseIndex || reference.role === 'base') return BASE_TREATMENT
    if (RAW_ROLES.has(reference.role)) return RAW_TREATMENT
    if (GUIDANCE_ROLES.has(reference.role)) return GUIDANCE_TREATMENT
    return GUIDANCE_TREATMENT
  }

  function freezeEntries(entries) {
    return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })))
  }

  function createPlan(mode, entries, extra = {}) {
    const frozenEntries = freezeEntries(entries)
    const select = (treatment) => Object.freeze(
      frozenEntries.filter((entry) => entry.treatment === treatment),
    )
    return Object.freeze({
      kind: PLAN_KIND,
      version: VERSION,
      mode,
      entries: frozenEntries,
      base: select(BASE_TREATMENT),
      guidance: select(GUIDANCE_TREATMENT),
      raw: select(RAW_TREATMENT),
      transformed: extra.transformed === true,
    })
  }

  function buildReferencePlan(input = [], options = {}) {
    const resolved = resolveArguments(input, options)
    const mode = normalizeMode(resolved.options.mode || resolved.options.intent)
    const references = resolved.references
      .map((reference, index) => normalizeReference(reference, index))
      .filter(Boolean)
    const baseIndex = resolveBaseIndex(references, mode, resolved.options)
    const entries = references.map((reference) => ({
      ...reference,
      role: reference.role === 'base' ? 'reference' : reference.role,
      treatment: treatmentFor(reference, baseIndex),
    }))
    return createPlan(mode, entries)
  }

  function browserImage(dataUrl, options) {
    const ImageConstructor = options.Image || (root && root.Image)
    if (typeof ImageConstructor !== 'function') {
      throw new Error('Low-frequency reference proxy requires a browser Image implementation')
    }
    return new Promise((resolve, reject) => {
      const image = new ImageConstructor()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Failed to load reference image for low-frequency proxy'))
      image.src = dataUrl
    })
  }

  function createCanvas(width, height, options) {
    const documentApi = options.document || (root && root.document)
    if (!documentApi || typeof documentApi.createElement !== 'function') {
      throw new Error('Low-frequency reference proxy requires a browser canvas implementation')
    }
    const canvas = documentApi.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }

  async function createLowFrequencyProxy(entry, options = {}) {
    const currentDataUrl = text(entry?.dataUrl)
    if (!currentDataUrl) throw new Error('Low-frequency reference proxy requires a current source data URL')
    const currentSourceFingerprint = sourceFingerprint(currentDataUrl)
    const image = await browserImage(currentDataUrl, options)
    const sourceWidth = Math.max(1, positiveInteger(image.naturalWidth || image.width))
    const sourceHeight = Math.max(1, positiveInteger(image.naturalHeight || image.height))
    const sampleMaxEdge = Math.max(8, positiveInteger(options.sampleMaxEdge) || 24)
    const outputMaxEdge = Math.max(sampleMaxEdge, positiveInteger(options.outputMaxEdge) || 512)
    const monochrome = options.monochrome === true
    const proxyEncoding = text(options.proxyEncoding) || LOW_FREQUENCY_PROXY_ENCODING
    const proxyKind = text(options.proxyKind) || 'low-frequency'
    const identityReduced = options.identityReduced === true
    const sampleFilter = text(options.sampleFilter)
    const sourceMaxEdge = Math.max(sourceWidth, sourceHeight)
    const sampleScale = Math.min(1, sampleMaxEdge / sourceMaxEdge)
    const outputScale = Math.min(1, outputMaxEdge / sourceMaxEdge)
    const sampleWidth = Math.max(1, Math.round(sourceWidth * sampleScale))
    const sampleHeight = Math.max(1, Math.round(sourceHeight * sampleScale))
    const outputWidth = Math.max(1, Math.round(sourceWidth * outputScale))
    const outputHeight = Math.max(1, Math.round(sourceHeight * outputScale))
    const sampleCanvas = createCanvas(sampleWidth, sampleHeight, options)
    const sampleContext = sampleCanvas.getContext('2d')
    if (!sampleContext) throw new Error('Low-frequency reference proxy canvas is unavailable')
    sampleContext.imageSmoothingEnabled = true
    sampleContext.imageSmoothingQuality = 'high'
    if ('filter' in sampleContext) {
      sampleContext.filter = [
        monochrome ? 'grayscale(1)' : '',
        sampleFilter,
      ].filter(Boolean).join(' ') || 'none'
    }
    sampleContext.drawImage(image, 0, 0, sampleWidth, sampleHeight)
    const outputCanvas = createCanvas(outputWidth, outputHeight, options)
    const outputContext = outputCanvas.getContext('2d')
    if (!outputContext) throw new Error('Low-frequency reference proxy canvas is unavailable')
    outputContext.imageSmoothingEnabled = true
    outputContext.imageSmoothingQuality = 'high'
    outputContext.drawImage(sampleCanvas, 0, 0, outputWidth, outputHeight)
    return {
      dataUrl: outputCanvas.toDataURL('image/png'),
      width: outputWidth,
      height: outputHeight,
      proxyEncoding,
      proxyKind,
      sourceFingerprint: currentSourceFingerprint,
      proxyCacheKey: proxyCacheKey(proxyEncoding, currentSourceFingerprint, sampleMaxEdge, outputMaxEdge),
      sourceDataUrlLength: currentDataUrl.length,
      sourceWidth,
      sourceHeight,
      sampleWidth,
      sampleHeight,
      sampleMaxEdge,
      outputMaxEdge,
      monochrome,
      colorMode: monochrome ? 'monochrome' : 'color',
      frequencyBand: text(options.frequencyBand) || 'low',
      identityReduced,
      identityReductionPolicy: identityReduced ? IDENTITY_REDUCTION_POLICY : '',
    }
  }

  async function createCompositionProxy(entry, options = {}) {
    const result = await createLowFrequencyProxy(entry, {
      ...options,
      sampleMaxEdge: Math.max(32, positiveInteger(options.sampleMaxEdge) || 48),
      outputMaxEdge: Math.max(256, positiveInteger(options.outputMaxEdge) || 512),
      monochrome: false,
      sampleFilter: text(options.sampleFilter) || 'blur(0.8px) saturate(0.78)',
      proxyEncoding: COMPOSITION_PROXY_ENCODING,
      proxyKind: 'composition',
      frequencyBand: 'low',
      identityReduced: true,
    })
    const semanticGuideDataUrl = text(options.semanticGuideDataUrl)
    if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(semanticGuideDataUrl)) {
      return {
        ...result,
        proxyEncoding: COMPOSITION_PROXY_ENCODING,
      }
    }
    const baseImage = await browserImage(result.dataUrl, options)
    const semanticGuide = await browserImage(semanticGuideDataUrl, options)
    const fusedCanvas = createCanvas(result.width, result.height, options)
    const fusedContext = fusedCanvas.getContext('2d')
    if (!fusedContext) throw new Error('Composition semantic fusion canvas is unavailable')
    fusedContext.imageSmoothingEnabled = true
    fusedContext.imageSmoothingQuality = 'high'
    fusedContext.drawImage(baseImage, 0, 0, result.width, result.height)
    fusedContext.globalCompositeOperation = 'screen'
    fusedContext.globalAlpha = 0.28
    fusedContext.drawImage(semanticGuide, 0, 0, result.width, result.height)
    fusedContext.globalAlpha = 1
    fusedContext.globalCompositeOperation = 'source-over'
    return {
      ...result,
      dataUrl: fusedCanvas.toDataURL('image/png'),
      proxyEncoding: COMPOSITION_SEMANTIC_FUSION_ENCODING,
      proxyKind: 'composition-semantic-fusion',
      semanticGuideFused: true,
      semanticGuideEncoding: text(options.semanticGuideEncoding),
      semanticGuideFingerprint: sourceFingerprint(semanticGuideDataUrl),
      semanticGuideOpacity: 0.28,
      proxyCacheKey: `${result.proxyCacheKey}:${sourceFingerprint(semanticGuideDataUrl)}:screen-0.28`,
    }
  }

  async function createPerimeterIdentityScrub(entry, options = {}) {
    const currentDataUrl = text(entry?.dataUrl)
    if (!currentDataUrl) throw new Error('Perimeter identity scrub requires a current source data URL')
    const currentSourceFingerprint = sourceFingerprint(currentDataUrl)
    const image = await browserImage(currentDataUrl, options)
    const sourceWidth = Math.max(1, positiveInteger(image.naturalWidth || image.width))
    const sourceHeight = Math.max(1, positiveInteger(image.naturalHeight || image.height))
    const positiveRatio = (value, fallback, maximum = 0.45) => {
      const number = Number(value)
      return Number.isFinite(number) && number > 0
        ? Math.min(maximum, number)
        : fallback
    }
    const topRatio = positiveRatio(options.topRatio, PERIMETER_SCRUB_DEFAULTS.topRatio)
    const sideRatio = positiveRatio(options.sideRatio, PERIMETER_SCRUB_DEFAULTS.sideRatio)
    const bottomRatio = positiveRatio(options.bottomRatio, PERIMETER_SCRUB_DEFAULTS.bottomRatio)
    const pixelBlockRatio = positiveRatio(
      options.pixelBlockRatio,
      PERIMETER_SCRUB_DEFAULTS.pixelBlockRatio,
      1,
    )
    const minPixelBlockSize = Math.max(
      1,
      positiveInteger(options.minPixelBlockSize) || PERIMETER_SCRUB_DEFAULTS.minPixelBlockSize,
    )
    const maxPixelBlockSize = Math.max(
      minPixelBlockSize,
      positiveInteger(options.maxPixelBlockSize) || PERIMETER_SCRUB_DEFAULTS.maxPixelBlockSize,
    )
    const pixelBlockSize = Math.max(
      minPixelBlockSize,
      Math.min(
        maxPixelBlockSize,
        Math.round(Math.min(sourceWidth, sourceHeight) * pixelBlockRatio),
      ),
    )
    const sampleFilter = text(options.sampleFilter) || PERIMETER_SCRUB_DEFAULTS.sampleFilter
    const topPx = Math.max(1, Math.round(sourceHeight * topRatio))
    const bottomPx = Math.max(1, Math.round(sourceHeight * bottomRatio))
    const sidePx = Math.max(1, Math.round(sourceWidth * sideRatio))
    const middleHeight = Math.max(1, sourceHeight - topPx - bottomPx)
    const perimeterRegions = [
      { x: 0, y: 0, width: sourceWidth, height: topPx },
      { x: 0, y: sourceHeight - bottomPx, width: sourceWidth, height: bottomPx },
      { x: 0, y: topPx, width: sidePx, height: middleHeight },
      { x: sourceWidth - sidePx, y: topPx, width: sidePx, height: middleHeight },
    ]
    const preserveRegions = pixelPreserveRegions(options.preserveRegions, sourceWidth, sourceHeight)
    const regions = preserveRegions.reduce(
      (remaining, preserve) => remaining.flatMap((region) => subtractPreservedRegion(region, preserve)),
      perimeterRegions,
    )
    const preserveRegionSignature = preserveRegions.length
      ? `preserve=${preserveRegions.map((region) => [
        region.x,
        region.y,
        region.width,
        region.height,
      ].join(',')).join(';')}`
      : ''

    const outputCanvas = createCanvas(sourceWidth, sourceHeight, options)
    const outputContext = outputCanvas.getContext('2d')
    if (!outputContext) throw new Error('Perimeter identity scrub canvas is unavailable')
    outputContext.imageSmoothingEnabled = true
    outputContext.imageSmoothingQuality = 'high'
    if ('filter' in outputContext) outputContext.filter = 'none'
    outputContext.drawImage(image, 0, 0, sourceWidth, sourceHeight)

    for (const region of regions) {
      const sampleWidth = Math.max(1, Math.ceil(region.width / pixelBlockSize))
      const sampleHeight = Math.max(1, Math.ceil(region.height / pixelBlockSize))
      const sampleCanvas = createCanvas(sampleWidth, sampleHeight, options)
      const sampleContext = sampleCanvas.getContext('2d')
      if (!sampleContext) throw new Error('Perimeter identity scrub sample canvas is unavailable')
      sampleContext.imageSmoothingEnabled = true
      sampleContext.imageSmoothingQuality = 'high'
      if ('filter' in sampleContext) sampleContext.filter = sampleFilter
      sampleContext.drawImage(
        image,
        region.x,
        region.y,
        region.width,
        region.height,
        0,
        0,
        sampleWidth,
        sampleHeight,
      )
      outputContext.imageSmoothingEnabled = false
      if ('filter' in outputContext) outputContext.filter = 'none'
      outputContext.drawImage(
        sampleCanvas,
        0,
        0,
        sampleWidth,
        sampleHeight,
        region.x,
        region.y,
        region.width,
        region.height,
      )
    }

    const config = {
      topRatio,
      sideRatio,
      bottomRatio,
      pixelBlockRatio,
      pixelBlockSize,
      sampleFilter,
      preserveRegionSignature,
    }
    return {
      dataUrl: outputCanvas.toDataURL('image/png'),
      width: sourceWidth,
      height: sourceHeight,
      proxyEncoding: PERIMETER_SCRUB_ENCODING,
      proxyKind: 'identity-scrub',
      sourceFingerprint: currentSourceFingerprint,
      proxyCacheKey: perimeterScrubCacheKey(currentSourceFingerprint, config),
      sourceDataUrlLength: currentDataUrl.length,
      sourceWidth,
      sourceHeight,
      monochrome: false,
      colorMode: 'color',
      frequencyBand: 'full-interior',
      identityReduced: true,
      identityReductionScope: 'perimeter-only',
      identityReductionPolicy: PERIMETER_IDENTITY_REDUCTION_POLICY,
      perimeterScrubAlgorithm: PERIMETER_SCRUB_ALGORITHM,
      interiorPreserved: true,
      scrubTopRatio: topRatio,
      scrubSideRatio: sideRatio,
      scrubBottomRatio: bottomRatio,
      scrubTopPx: topPx,
      scrubSidePx: sidePx,
      scrubBottomPx: bottomPx,
      pixelBlockRatio,
      pixelBlockSize,
      scrubSampleFilter: sampleFilter,
      scrubRegionCount: regions.length,
      layoutAwarePreservation: preserveRegions.length > 0,
      preserveRegionCount: preserveRegions.length,
      preserveRegionSignature,
    }
  }

  async function createMaterialProxy(entry, options = {}) {
    const currentDataUrl = text(entry?.dataUrl)
    if (!currentDataUrl) throw new Error('Material reference proxy requires a current source data URL')
    const currentSourceFingerprint = sourceFingerprint(currentDataUrl)
    const image = await browserImage(currentDataUrl, options)
    const sourceWidth = Math.max(1, positiveInteger(image.naturalWidth || image.width))
    const sourceHeight = Math.max(1, positiveInteger(image.naturalHeight || image.height))
    const sampleMaxEdge = Math.max(96, positiveInteger(options.sampleMaxEdge) || 192)
    const outputMaxEdge = Math.max(256, positiveInteger(options.outputMaxEdge) || 512)
    const microTileSize = Math.max(6, positiveInteger(options.microTileSize) || 12)
    const offsetOpacityValue = Number(options.offsetOpacity)
    const offsetOpacity = Number.isFinite(offsetOpacityValue)
      ? Math.max(0.05, Math.min(0.3, offsetOpacityValue))
      : 0.14
    const sourceMaxEdge = Math.max(sourceWidth, sourceHeight)
    const sampleScale = Math.min(1, sampleMaxEdge / sourceMaxEdge)
    const outputScale = Math.min(1, outputMaxEdge / sourceMaxEdge)
    const sampleWidth = Math.max(1, Math.round(sourceWidth * sampleScale))
    const sampleHeight = Math.max(1, Math.round(sourceHeight * sampleScale))
    const outputWidth = Math.max(1, Math.round(sourceWidth * outputScale))
    const outputHeight = Math.max(1, Math.round(sourceHeight * outputScale))
    const sampleCanvas = createCanvas(sampleWidth, sampleHeight, options)
    const sampleContext = sampleCanvas.getContext('2d')
    if (!sampleContext) throw new Error('Material reference proxy canvas is unavailable')
    sampleContext.imageSmoothingEnabled = true
    sampleContext.imageSmoothingQuality = 'high'
    if ('filter' in sampleContext) {
      sampleContext.filter = text(options.sampleFilter) || 'blur(0.55px)'
    }
    sampleContext.drawImage(image, 0, 0, sampleWidth, sampleHeight)

    const tileColumns = Math.max(1, Math.ceil(sampleWidth / microTileSize))
    const tileRows = Math.max(1, Math.ceil(sampleHeight / microTileSize))
    const tileCount = tileColumns * tileRows
    const scatterSeed = fingerprintSeed(currentSourceFingerprint)
    const scatterOrder = deterministicScatterOrder(tileCount, tileColumns, scatterSeed)
    const fieldCanvas = createCanvas(outputWidth, outputHeight, options)
    const fieldContext = fieldCanvas.getContext('2d')
    if (!fieldContext) throw new Error('Material reference proxy canvas is unavailable')
    fieldContext.imageSmoothingEnabled = true
    fieldContext.imageSmoothingQuality = 'high'

    const drawScatterLayer = (opacity, offsetX, offsetY, orderOffset) => {
      fieldContext.globalAlpha = opacity
      for (let targetIndex = 0; targetIndex < tileCount; targetIndex += 1) {
        const sourceIndex = scatterOrder[(targetIndex + orderOffset) % tileCount]
        const sourceColumn = sourceIndex % tileColumns
        const sourceRow = Math.floor(sourceIndex / tileColumns)
        const targetColumn = targetIndex % tileColumns
        const targetRow = Math.floor(targetIndex / tileColumns)
        const sourceX = sourceColumn * microTileSize
        const sourceY = sourceRow * microTileSize
        const sourceTileWidth = Math.min(microTileSize, sampleWidth - sourceX)
        const sourceTileHeight = Math.min(microTileSize, sampleHeight - sourceY)
        const targetX0 = Math.round((targetColumn * outputWidth) / tileColumns)
        const targetY0 = Math.round((targetRow * outputHeight) / tileRows)
        const targetX1 = Math.round(((targetColumn + 1) * outputWidth) / tileColumns)
        const targetY1 = Math.round(((targetRow + 1) * outputHeight) / tileRows)
        fieldContext.drawImage(
          sampleCanvas,
          sourceX,
          sourceY,
          sourceTileWidth,
          sourceTileHeight,
          targetX0 + offsetX,
          targetY0 + offsetY,
          Math.max(1, targetX1 - targetX0),
          Math.max(1, targetY1 - targetY0),
        )
      }
    }

    drawScatterLayer(1, 0, 0, 0)
    const destinationTileWidth = outputWidth / tileColumns
    const destinationTileHeight = outputHeight / tileRows
    const offsetX = Math.max(1, Math.round(destinationTileWidth * 0.28))
    const offsetY = -Math.max(1, Math.round(destinationTileHeight * 0.22))
    drawScatterLayer(
      offsetOpacity,
      offsetX,
      offsetY,
      Math.max(1, (scatterSeed % Math.max(1, tileCount - 1))),
    )
    fieldContext.globalAlpha = 1

    const outputCanvas = createCanvas(outputWidth, outputHeight, options)
    const outputContext = outputCanvas.getContext('2d')
    if (!outputContext) throw new Error('Material reference proxy canvas is unavailable')
    outputContext.imageSmoothingEnabled = true
    outputContext.imageSmoothingQuality = 'high'
    const softenFilter = text(options.softenFilter) || 'blur(0.45px)'
    if ('filter' in outputContext) outputContext.filter = softenFilter
    outputContext.drawImage(fieldCanvas, 0, 0, outputWidth, outputHeight)
    const result = {
      dataUrl: outputCanvas.toDataURL('image/png'),
      width: outputWidth,
      height: outputHeight,
      proxyEncoding: MATERIAL_PROXY_ENCODING,
      proxyKind: 'material',
      sourceFingerprint: currentSourceFingerprint,
      proxyCacheKey: materialProxyCacheKey(
        currentSourceFingerprint,
        sampleMaxEdge,
        outputMaxEdge,
        microTileSize,
        offsetOpacity,
        softenFilter,
      ),
      sourceDataUrlLength: currentDataUrl.length,
      sourceWidth,
      sourceHeight,
      sampleWidth,
      sampleHeight,
      sampleMaxEdge,
      outputMaxEdge,
      monochrome: false,
      colorMode: 'color',
      frequencyBand: 'mid',
      identityReduced: true,
      identityReductionPolicy: IDENTITY_REDUCTION_POLICY,
      materialAlgorithm: MATERIAL_PROXY_ALGORITHM,
      microTileSize,
      tileColumns,
      tileRows,
      tileCount,
      scatterSeed,
      adjacencyBroken: true,
      offsetLayerOpacity: offsetOpacity,
      offsetLayerX: offsetX,
      offsetLayerY: offsetY,
      softenFilter,
    }
    return {
      ...result,
      proxyEncoding: MATERIAL_PROXY_ENCODING,
    }
  }

  async function createDualProxyPair(entry, options = {}) {
    const shared = {
      Image: options.Image,
      document: options.document,
    }
    const fingerprint = sourceFingerprint(entry?.dataUrl)
    const composition = await createCompositionProxy(entry, {
      ...shared,
      ...(options.composition && typeof options.composition === 'object' ? options.composition : {}),
    })
    const material = await createMaterialProxy(entry, {
      ...shared,
      ...(options.material && typeof options.material === 'object' ? options.material : {}),
    })
    if (composition.sourceFingerprint !== fingerprint || material.sourceFingerprint !== fingerprint) {
      throw new Error('Dual reference proxy source changed during materialization')
    }
    return Object.freeze({
      kind: DUAL_PROXY_KIND,
      version: VERSION,
      sourceFingerprint: fingerprint,
      proxyCacheKey: [
        DUAL_PROXY_KIND,
        VERSION,
        fingerprint,
        sourceFingerprint(composition.proxyCacheKey),
        sourceFingerprint(material.proxyCacheKey),
      ].join(':'),
      composition: Object.freeze({ ...composition }),
      material: Object.freeze({ ...material }),
    })
  }

  function normalizeTransformedReference(value, entry) {
    const result = typeof value === 'string' ? { dataUrl: value } : value
    if (!result || typeof result !== 'object') {
      throw new Error(`Guidance transformer returned no reference for index ${entry.index}`)
    }
    const dataUrl = text(result.dataUrl || result.imageUrl || result.url || result.src)
    if (!dataUrl) throw new Error(`Guidance transformer returned an empty image for index ${entry.index}`)
    const expectedSourceFingerprint = sourceFingerprint(entry.dataUrl)
    const declaredSourceFingerprint = text(result.sourceFingerprint)
    if (declaredSourceFingerprint && declaredSourceFingerprint !== expectedSourceFingerprint) {
      throw new Error(`Guidance transformer returned a stale proxy for index ${entry.index}`)
    }
    const proxyEncoding = text(result.proxyEncoding) || 'custom-transformer'
    return {
      ...entry,
      name: text(result.name || result.fileName || result.filename) || entry.name,
      dataUrl,
      width: positiveInteger(result.width) || entry.width,
      height: positiveInteger(result.height) || entry.height,
      proxyEncoding,
      sourceFingerprint: expectedSourceFingerprint,
      proxyCacheKey: text(result.proxyCacheKey)
        || proxyCacheKey(
          proxyEncoding,
          expectedSourceFingerprint,
          result.sampleMaxEdge,
          result.outputMaxEdge,
        ),
      proxyKind: text(result.proxyKind),
      sourceDataUrlLength: positiveInteger(result.sourceDataUrlLength) || text(entry.dataUrl).length,
      sourceWidth: positiveInteger(result.sourceWidth),
      sourceHeight: positiveInteger(result.sourceHeight),
      sampleWidth: positiveInteger(result.sampleWidth),
      sampleHeight: positiveInteger(result.sampleHeight),
      sampleMaxEdge: positiveInteger(result.sampleMaxEdge),
      outputMaxEdge: positiveInteger(result.outputMaxEdge),
      monochrome: result.monochrome === true,
      colorMode: text(result.colorMode),
      frequencyBand: text(result.frequencyBand),
      identityReduced: result.identityReduced === true,
      identityReductionPolicy: text(result.identityReductionPolicy),
      materialAlgorithm: text(result.materialAlgorithm),
      microTileSize: positiveInteger(result.microTileSize),
      tileColumns: positiveInteger(result.tileColumns),
      tileRows: positiveInteger(result.tileRows),
      tileCount: positiveInteger(result.tileCount),
      scatterSeed: positiveInteger(result.scatterSeed),
      adjacencyBroken: result.adjacencyBroken === true,
      offsetLayerOpacity: Number.isFinite(Number(result.offsetLayerOpacity))
        ? Number(result.offsetLayerOpacity)
        : 0,
      offsetLayerX: Number.isFinite(Number(result.offsetLayerX)) ? Number(result.offsetLayerX) : 0,
      offsetLayerY: Number.isFinite(Number(result.offsetLayerY)) ? Number(result.offsetLayerY) : 0,
      softenFilter: text(result.softenFilter),
      identityReductionScope: text(result.identityReductionScope),
      perimeterScrubAlgorithm: text(result.perimeterScrubAlgorithm),
      interiorPreserved: result.interiorPreserved === true,
      scrubTopRatio: Number.isFinite(Number(result.scrubTopRatio))
        ? Number(result.scrubTopRatio)
        : 0,
      scrubSideRatio: Number.isFinite(Number(result.scrubSideRatio))
        ? Number(result.scrubSideRatio)
        : 0,
      scrubBottomRatio: Number.isFinite(Number(result.scrubBottomRatio))
        ? Number(result.scrubBottomRatio)
        : 0,
      scrubTopPx: positiveInteger(result.scrubTopPx),
      scrubSidePx: positiveInteger(result.scrubSidePx),
      scrubBottomPx: positiveInteger(result.scrubBottomPx),
      pixelBlockRatio: Number.isFinite(Number(result.pixelBlockRatio))
        ? Number(result.pixelBlockRatio)
        : 0,
      pixelBlockSize: positiveInteger(result.pixelBlockSize),
      scrubSampleFilter: text(result.scrubSampleFilter),
      scrubRegionCount: positiveInteger(result.scrubRegionCount),
      layoutAwarePreservation: result.layoutAwarePreservation === true,
      preserveRegionCount: positiveInteger(result.preserveRegionCount),
      preserveRegionSignature: text(result.preserveRegionSignature),
      semanticGuideFused: result.semanticGuideFused === true,
      semanticGuideEncoding: text(result.semanticGuideEncoding),
      semanticGuideFingerprint: text(result.semanticGuideFingerprint),
      semanticGuideOpacity: Number.isFinite(Number(result.semanticGuideOpacity))
        ? Number(result.semanticGuideOpacity)
        : 0,
      transformed: true,
    }
  }

  async function materializeReferencePlan(input, options = {}) {
    const plan = input?.kind === PLAN_KIND && Array.isArray(input.entries)
      ? input
      : buildReferencePlan(input, options)
    const transformer = typeof options === 'function'
      ? options
      : (typeof options.transformer === 'function' ? options.transformer : createLowFrequencyProxy)
    const entries = []
    for (const entry of plan.entries) {
      if (entry.treatment !== GUIDANCE_TREATMENT) {
        entries.push({ ...entry, transformed: false })
        continue
      }
      const transformed = await transformer(entry, Object.freeze({
        mode: plan.mode,
        index: entry.index,
        treatment: entry.treatment,
        sourceFingerprint: sourceFingerprint(entry.dataUrl),
      }))
      entries.push(normalizeTransformedReference(transformed, entry))
    }
    return createPlan(plan.mode, entries, {
      transformed: entries.some((entry) => entry.transformed === true),
    })
  }

  async function materializeAutomaticPrimary(input, options = {}) {
    const plan = input && typeof input === 'object' ? input : null
    const references = Array.isArray(plan?.references)
      ? plan.references.map((reference) => ({ ...reference }))
      : []
    const referenceIndex = Number.isInteger(plan?.referenceIndex) ? plan.referenceIndex : -1
    if (plan?.applied !== true || referenceIndex < 0 || !references[referenceIndex]) return plan
    const entry = references[referenceIndex]
    const qualityScrub = text(options?.profile).toLowerCase() === 'quality'
    const treatment = qualityScrub
      ? PERIMETER_SCRUB_TREATMENT
      : COMPOSITION_GUIDANCE_TREATMENT
    const transformer = typeof options === 'function'
      ? options
      : (
        typeof options.transformer === 'function'
          ? options.transformer
          : (qualityScrub ? createPerimeterIdentityScrub : createCompositionProxy)
      )
    const context = qualityScrub
      ? {
        mode: REDESIGN_MODE,
        index: entry.index,
        treatment,
        purpose: 'automatic-primary-perimeter-identity-scrub',
        ...PERIMETER_SCRUB_DEFAULTS,
        ...(Array.isArray(options?.preserveRegions)
          ? { preserveRegions: options.preserveRegions }
          : {}),
        sourceFingerprint: sourceFingerprint(entry.dataUrl),
      }
      : {
        mode: REDESIGN_MODE,
        index: entry.index,
        treatment,
        purpose: 'automatic-primary-composition-proxy',
        sampleMaxEdge: 48,
        outputMaxEdge: 720,
        monochrome: false,
        sampleFilter: 'blur(0.8px) saturate(0.78)',
        ...(text(options?.layoutGuide?.dataUrl)
          ? {
              semanticGuideDataUrl: text(options.layoutGuide.dataUrl),
              semanticGuideEncoding: text(options.layoutGuide.visualEncoding),
            }
          : {}),
        sourceFingerprint: sourceFingerprint(entry.dataUrl),
      }
    const transformed = await transformer(entry, Object.freeze(context))
    references[referenceIndex] = {
      ...normalizeTransformedReference(transformed, entry),
      treatment,
      proxyEncoding: text(transformed?.proxyEncoding)
        || (qualityScrub ? PERIMETER_SCRUB_ENCODING : COMPOSITION_PROXY_ENCODING),
    }
    return Object.freeze({
      ...plan,
      references: Object.freeze(references.map((reference) => Object.freeze({ ...reference }))),
      treatment,
      proxyEncoding: references[referenceIndex].proxyEncoding,
      transformed: true,
    })
  }

  return Object.freeze({
    VERSION,
    PLAN_KIND,
    DUAL_PROXY_KIND,
    REDESIGN_MODE,
    ITERATION_MODE,
    GUIDANCE_TREATMENT,
    COMPOSITION_GUIDANCE_TREATMENT,
    RAW_TREATMENT,
    BASE_TREATMENT,
    LOW_FREQUENCY_PROXY_ENCODING,
    COMPOSITION_PROXY_ENCODING,
    COMPOSITION_SEMANTIC_FUSION_ENCODING,
    MATERIAL_PROXY_ENCODING,
    MATERIAL_PROXY_ALGORITHM,
    IDENTITY_REDUCTION_POLICY,
    PERIMETER_SCRUB_ENCODING,
    PERIMETER_SCRUB_ALGORITHM,
    PERIMETER_SCRUB_TREATMENT,
    PERIMETER_IDENTITY_REDUCTION_POLICY,
    PERIMETER_SCRUB_DEFAULTS,
    normalizeMode,
    normalizeRole,
    sourceFingerprint,
    buildReferencePlan,
    createLowFrequencyProxy,
    createCompositionProxy,
    createPerimeterIdentityScrub,
    createMaterialProxy,
    createDualProxyPair,
    materializeReferencePlan,
    materializeAutomaticPrimary,
  })
})
