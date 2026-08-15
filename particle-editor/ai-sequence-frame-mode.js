(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAiSequenceFrameMode = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const DEFAULT_DIMENSION_STEP = 8
  const DEFAULT_MAX_LONG_EDGE = 4096
  const DEFAULT_MAX_PIXELS = 4096 * 4096

  function positiveInteger(value, label) {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed) || parsed <= 0) throw new TypeError(`${label} must be a positive integer`)
    return parsed
  }

  function truthy(value) {
    if (value === true || value === 1) return true
    return ['true', '1', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
  }

  function normalizeProvider(value) {
    return String(value || '').trim().toLowerCase() === 'jimeng' ? 'jimeng' : 'kling'
  }

  function normalizeGenType(value) {
    return String(value || '').trim() === 'first_last' ? 'first_last' : 'image_video'
  }

  function isStrictFirstFrame(snapshot) {
    const genType = normalizeGenType(snapshot && snapshot.genType)
    if (genType === 'first_last') return true
    const params = snapshot && snapshot.params && typeof snapshot.params === 'object' ? snapshot.params : {}
    return truthy(params.strictFirstFrame ?? snapshot?.strictFirstFrame)
  }

  function resolveRoute(snapshot) {
    if (!snapshot || String(snapshot.mode || '') !== 'cloud') {
      return Object.freeze({
        provider: '',
        genType: '',
        strictFirstFrame: false,
        nodeType: '',
        modelName: '',
      })
    }
    const provider = normalizeProvider(snapshot.provider)
    const genType = normalizeGenType(snapshot.genType)
    const strictFirstFrame = isStrictFirstFrame(snapshot)
    if (provider === 'kling') {
      if (genType === 'first_last') {
        return Object.freeze({ provider, genType, strictFirstFrame, nodeType: 'KlingFirstLastFrameNode', modelName: 'kling-v3' })
      }
      return Object.freeze({
        provider,
        genType,
        strictFirstFrame,
        nodeType: strictFirstFrame ? 'KlingVideoNode' : 'KlingOmniProImageToVideoNode',
        modelName: strictFirstFrame ? 'kling-v3' : 'kling-v3-omni',
      })
    }
    return Object.freeze({
      provider,
      genType,
      strictFirstFrame,
      nodeType: strictFirstFrame ? 'ByteDance2FirstLastFrameNode' : 'ByteDance2ReferenceNode',
      modelName: String(snapshot?.params?.model || 'Seedance 2.0'),
    })
  }

  function resolveNodeType(snapshot) {
    return resolveRoute(snapshot).nodeType
  }

  function greatestCommonDivisor(left, right) {
    let a = Math.abs(positiveInteger(left, 'ratio width'))
    let b = Math.abs(positiveInteger(right, 'ratio height'))
    while (b) [a, b] = [b, a % b]
    return a
  }

  function leastCommonMultiple(left, right) {
    return Math.abs(left * right) / greatestCommonDivisor(left, right)
  }

  function parseAspectRatio(value) {
    const text = String(value || '').trim().toLowerCase()
    if (!text || text === 'adaptive' || text === 'original') return null
    const match = /^(\d+)\s*:\s*(\d+)$/.exec(text)
    if (!match) throw new TypeError(`Unsupported aspect ratio: ${value}`)
    const width = positiveInteger(match[1], 'ratio width')
    const height = positiveInteger(match[2], 'ratio height')
    const divisor = greatestCommonDivisor(width, height)
    return {
      width: width / divisor,
      height: height / divisor,
      value: `${width / divisor}:${height / divisor}`,
    }
  }

  function normalizeSize(size) {
    return {
      width: positiveInteger(size && size.width, 'image width'),
      height: positiveInteger(size && size.height, 'image height'),
    }
  }

  function imageMatchesAspectRatio(size, ratioValue) {
    const sourceSize = normalizeSize(size)
    const ratio = parseAspectRatio(ratioValue)
    if (!ratio) return true
    return sourceSize.width * ratio.height === sourceSize.height * ratio.width
  }

  function computeOutpaintPlan(size, ratioValue, options = {}) {
    const sourceSize = normalizeSize(size)
    const ratio = parseAspectRatio(ratioValue)
    const targetRatio = ratio ? ratio.value : String(ratioValue || 'adaptive').trim().toLowerCase() || 'adaptive'
    const emptyDelta = { top: 0, bottom: 0, left: 0, right: 0 }
    if (!ratio || imageMatchesAspectRatio(sourceSize, targetRatio)) {
      return {
        required: false,
        sourceSize,
        targetSize: { ...sourceSize },
        delta: emptyDelta,
        targetRatio,
      }
    }

    const dimensionStep = positiveInteger(options.dimensionStep || DEFAULT_DIMENSION_STEP, 'dimension step')
    const maxLongEdge = positiveInteger(options.maxLongEdge || DEFAULT_MAX_LONG_EDGE, 'maximum long edge')
    const maxPixels = positiveInteger(options.maxPixels || DEFAULT_MAX_PIXELS, 'maximum pixels')
    const widthUnit = dimensionStep / greatestCommonDivisor(ratio.width, dimensionStep)
    const heightUnit = dimensionStep / greatestCommonDivisor(ratio.height, dimensionStep)
    const ratioScaleStep = leastCommonMultiple(widthUnit, heightUnit)
    const minimumScale = Math.max(sourceSize.width / ratio.width, sourceSize.height / ratio.height)
    const scale = Math.ceil(minimumScale / ratioScaleStep) * ratioScaleStep
    const targetSize = {
      width: ratio.width * scale,
      height: ratio.height * scale,
    }
    if (targetSize.width > maxLongEdge || targetSize.height > maxLongEdge || targetSize.width * targetSize.height > maxPixels) {
      throw new RangeError(`Outpaint target exceeds maximum ${maxLongEdge}px edge or ${maxPixels} pixels`)
    }
    const widthDelta = targetSize.width - sourceSize.width
    const heightDelta = targetSize.height - sourceSize.height
    const delta = {
      top: Math.floor(heightDelta / 2),
      bottom: Math.ceil(heightDelta / 2),
      left: Math.floor(widthDelta / 2),
      right: Math.ceil(widthDelta / 2),
    }
    return {
      required: true,
      sourceSize,
      targetSize,
      delta,
      targetRatio,
    }
  }

  return Object.freeze({
    resolveRoute,
    resolveNodeType,
    isStrictFirstFrame,
    parseAspectRatio,
    imageMatchesAspectRatio,
    computeOutpaintPlan,
  })
})
