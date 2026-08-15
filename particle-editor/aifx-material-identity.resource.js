(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAifxMaterialIdentityResource = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAifxMaterialIdentityResource(root) {
  'use strict'

  const VERSION = 'novaflow-aifx-material-identity-v3'
  const TOKEN_TILE_GRID = 8
  const TOKEN_FRAGMENT_SIZE = 128
  const TOKEN_MATERIAL_EXTENT = 96

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value))
  }

  function luminance(red, green, blue) {
    return (Number(red) * 0.2126 + Number(green) * 0.7152 + Number(blue) * 0.0722) / 255
  }

  function typedError(code, message) {
    const error = new Error(String(message || code))
    error.name = 'AifxMaterialIdentityError'
    error.code = code
    error.retryable = false
    return error
  }

  function defaultCreateCanvas(width, height) {
    const documentRef = root?.document
    if (!documentRef?.createElement) {
      throw typedError('AIFX_MATERIAL_IDENTITY_CANVAS_UNAVAILABLE', 'A canvas factory is required for peak material identity preprocessing.')
    }
    const canvas = documentRef.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }

  function createTilePermutation(tileGrid = TOKEN_TILE_GRID) {
    const grid = Math.max(2, Math.round(Number(tileGrid) || TOKEN_TILE_GRID))
    const tileCount = grid * grid
    let step = Math.max(3, Math.floor(tileCount * 0.58) | 1)
    const greatestCommonDivisor = (left, right) => {
      let a = Math.abs(left)
      let b = Math.abs(right)
      while (b) [a, b] = [b, a % b]
      return a
    }
    while (greatestCommonDivisor(step, tileCount) !== 1) step += 2
    const offset = Math.max(1, Math.floor(tileCount * 0.27)) % tileCount
    return Object.freeze(Array.from({ length: tileCount }, (_, index) => (index * step + offset) % tileCount))
  }

  function selectPeakMaterialPatch(sourceData, sourceWidth, sourceHeight, options = {}) {
    if (!sourceData?.length || sourceData.length < sourceWidth * sourceHeight * 4) {
      throw typedError('AIFX_MATERIAL_IDENTITY_SOURCE_INVALID', 'Accepted peak RGBA pixels are required to select a material token.')
    }
    const minimumDimension = Math.max(1, Math.min(sourceWidth, sourceHeight))
    const patchSize = clamp(
      Math.round(Number(options.patchSize) || minimumDimension * 0.2),
      Math.min(40, minimumDimension),
      Math.min(112, minimumDimension),
    )
    const stride = Math.max(4, Math.floor(patchSize / 4))
    const sampleStep = Math.max(1, Math.floor(patchSize / 14))
    let best = null
    for (let y = 0; y <= sourceHeight - patchSize; y += stride) {
      for (let x = 0; x <= sourceWidth - patchSize; x += stride) {
        let active = 0
        let midTone = 0
        let clippedWhite = 0
        let saturationTotal = 0
        let edgeTotal = 0
        let samples = 0
        for (let patchY = 0; patchY < patchSize; patchY += sampleStep) {
          for (let patchX = 0; patchX < patchSize; patchX += sampleStep) {
            const sampleX = x + patchX
            const sampleY = y + patchY
            const offset = (sampleY * sourceWidth + sampleX) * 4
            const alpha = sourceData[offset + 3] / 255
            const lum = luminance(sourceData[offset], sourceData[offset + 1], sourceData[offset + 2]) * alpha
            if (alpha > 0.08 && lum > 0.035) active += 1
            if (alpha > 0.08 && lum >= 0.08 && lum <= 0.88) midTone += 1
            if (alpha > 0.08 && lum > 0.94) clippedWhite += 1
            saturationTotal += (Math.max(sourceData[offset], sourceData[offset + 1], sourceData[offset + 2])
              - Math.min(sourceData[offset], sourceData[offset + 1], sourceData[offset + 2])) / 255 * alpha
            const rightX = Math.min(sourceWidth - 1, sampleX + sampleStep)
            const downY = Math.min(sourceHeight - 1, sampleY + sampleStep)
            const right = (sampleY * sourceWidth + rightX) * 4
            const down = (downY * sourceWidth + sampleX) * 4
            edgeTotal += (
              Math.abs(sourceData[offset] - sourceData[right])
              + Math.abs(sourceData[offset + 1] - sourceData[right + 1])
              + Math.abs(sourceData[offset + 2] - sourceData[right + 2])
              + Math.abs(sourceData[offset] - sourceData[down])
              + Math.abs(sourceData[offset + 1] - sourceData[down + 1])
              + Math.abs(sourceData[offset + 2] - sourceData[down + 2])
            ) / (255 * 6)
            samples += 1
          }
        }
        const activeRatio = active / Math.max(1, samples)
        if (activeRatio < 0.12) continue
        const score = activeRatio * 0.22
          + (midTone / Math.max(1, samples)) * 0.28
          + (edgeTotal / Math.max(1, samples)) * 0.3
          + (saturationTotal / Math.max(1, samples)) * 0.2
          - (clippedWhite / Math.max(1, samples)) * 0.5
          - Math.abs(activeRatio - 0.48) * 0.12
        if (!best || score > best.score) {
          best = { x, y, size: patchSize, score, activeRatio }
        }
      }
    }
    if (best) return Object.freeze(best)
    return Object.freeze({
      x: Math.max(0, Math.floor((sourceWidth - patchSize) / 2)),
      y: Math.max(0, Math.floor((sourceHeight - patchSize) / 2)),
      size: patchSize,
      score: 0,
      activeRatio: 0,
    })
  }

  function buildPeakMaterialToken(acceptedPeakImage, options = {}) {
    const sourceWidth = Math.max(1, Math.round(Number(acceptedPeakImage?.naturalWidth || acceptedPeakImage?.width) || 0))
    const sourceHeight = Math.max(1, Math.round(Number(acceptedPeakImage?.naturalHeight || acceptedPeakImage?.height) || 0))
    if (sourceWidth < 8 || sourceHeight < 8) {
      throw typedError('AIFX_MATERIAL_IDENTITY_SOURCE_INVALID', 'Accepted peak image dimensions are invalid.')
    }
    const createCanvas = typeof options.createCanvas === 'function' ? options.createCanvas : defaultCreateCanvas
    const sourceCanvas = createCanvas(sourceWidth, sourceHeight)
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
    sourceContext.clearRect(0, 0, sourceWidth, sourceHeight)
    sourceContext.drawImage(acceptedPeakImage, 0, 0, sourceWidth, sourceHeight)
    const sourcePixels = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight)
    const patch = selectPeakMaterialPatch(sourcePixels.data, sourceWidth, sourceHeight, options)

    const fragmentSize = TOKEN_FRAGMENT_SIZE
    const tileGrid = TOKEN_TILE_GRID
    const tileCount = tileGrid * tileGrid
    const tilePermutation = createTilePermutation(tileGrid)
    const fragment = createCanvas(fragmentSize, fragmentSize)
    const fragmentContext = fragment.getContext('2d')
    fragmentContext.fillStyle = '#000000'
    fragmentContext.fillRect(0, 0, fragmentSize, fragmentSize)
    fragmentContext.imageSmoothingEnabled = true
    fragmentContext.imageSmoothingQuality = 'high'
    const sourceTileSize = patch.size / tileGrid
    const destinationTileSize = fragmentSize / tileGrid
    for (let destinationIndex = 0; destinationIndex < tileCount; destinationIndex += 1) {
      const sourceIndex = tilePermutation[destinationIndex]
      const sourceColumn = sourceIndex % tileGrid
      const sourceRow = Math.floor(sourceIndex / tileGrid)
      const destinationColumn = destinationIndex % tileGrid
      const destinationRow = Math.floor(destinationIndex / tileGrid)
      fragmentContext.drawImage(
        sourceCanvas,
        patch.x + sourceColumn * sourceTileSize,
        patch.y + sourceRow * sourceTileSize,
        sourceTileSize,
        sourceTileSize,
        destinationColumn * destinationTileSize,
        destinationRow * destinationTileSize,
        destinationTileSize,
        destinationTileSize,
      )
    }
    fragmentContext.globalCompositeOperation = 'destination-in'
    const feather = fragmentContext.createRadialGradient(
      fragmentSize * 0.5,
      fragmentSize * 0.5,
      fragmentSize * 0.16,
      fragmentSize * 0.5,
      fragmentSize * 0.5,
      fragmentSize * 0.49,
    )
    feather.addColorStop(0, 'rgba(0,0,0,1)')
    feather.addColorStop(0.58, 'rgba(0,0,0,0.96)')
    feather.addColorStop(0.82, 'rgba(0,0,0,0.54)')
    feather.addColorStop(1, 'rgba(0,0,0,0)')
    fragmentContext.fillStyle = feather
    fragmentContext.fillRect(0, 0, fragmentSize, fragmentSize)
    fragmentContext.globalCompositeOperation = 'source-over'

    const tokenSize = 512
    const materialExtent = TOKEN_MATERIAL_EXTENT
    const token = createCanvas(tokenSize, tokenSize)
    const tokenContext = token.getContext('2d')
    tokenContext.fillStyle = '#000000'
    tokenContext.fillRect(0, 0, tokenSize, tokenSize)
    tokenContext.globalCompositeOperation = 'screen'
    tokenContext.drawImage(
      fragment,
      (tokenSize - materialExtent) * 0.5,
      (tokenSize - materialExtent) * 0.5,
      materialExtent,
      materialExtent,
    )
    tokenContext.globalCompositeOperation = 'source-over'

    return Object.freeze({
      version: VERSION,
      name: String(options.name || 'aifx_peak_material_microtexture_token.png'),
      dataUrl: token.toDataURL('image/png'),
      width: tokenSize,
      height: tokenSize,
      role: 'generated-peak-material-token',
      sourceRole: 'accepted-generated-peak',
      patch,
      tileGrid,
      tileCount,
      sourcePatchScrambled: true,
      maximumCoherentSourceFraction: 1 / tileCount,
      sourceSilhouetteBoundaryRetained: false,
      genericTokenWindow: 'radial-feather',
      materialExtent,
      pureBlackSafetyMargin: (tokenSize - materialExtent) * 0.5,
      spatialSilhouetteRemoved: true,
      macroLayoutRemoved: true,
      fullPeakImageSent: false,
      templatePixelsUsed: false,
      conditioningOnly: true,
    })
  }

  return Object.freeze({
    version: VERSION,
    createTilePermutation,
    selectPeakMaterialPatch,
    buildPeakMaterialToken,
  })
})
