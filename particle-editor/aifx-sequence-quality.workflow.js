(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAifxSequenceQualityWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const VERSION = 'aifx-sequence-quality-v3'
  const ERROR_CODES = Object.freeze({
    INVALID_INPUT: 'AIFX_SEQUENCE_INVALID_INPUT',
    TEMPLATE_STENCIL: 'AIFX_SEQUENCE_TEMPLATE_STENCIL',
    LIFECYCLE_INCOHERENT: 'AIFX_SEQUENCE_LIFECYCLE_INCOHERENT',
    TEMPLATE_DIVERGED: 'AIFX_SEQUENCE_TEMPLATE_DIVERGED',
    DIRECTION_DIVERGED: 'AIFX_SEQUENCE_DIRECTION_DIVERGED',
    POSE_EVOLUTION_DIVERGED: 'AIFX_SEQUENCE_POSE_EVOLUTION_DIVERGED',
    TAIL_FROZEN: 'AIFX_SEQUENCE_TAIL_FROZEN',
    POSITION_DRIFT: 'AIFX_SEQUENCE_POSITION_DRIFT',
    TEMPORAL_JITTER: 'AIFX_SEQUENCE_TEMPORAL_JITTER',
  })
  const DEFAULT_THRESHOLDS = Object.freeze({
    maskThresholds: Object.freeze([0.05, 0.25]),
    outerMaskThreshold: 0.05,
    coreMaskThreshold: 0.25,
    activeAreaRatio: 0.2,
    bodyAreaRatio: 0.6,
    stencilExactFrameRatioMin: 0.8,
    stencilCompensatedIouMin: 0.985,
    stencilAreaCorrelationMin: 0.98,
    stencilAreaNormalizedMaeMax: 0.03,
    outerTemplateIouMedianMin: 0.45,
    supportToleranceRatio: 0.03,
    supportF1MedianMin: 0.72,
    supportF1Min: 0.6,
    supportDilatedIouMedianMin: 0.55,
    directionActiveAreaRatio: 0.01,
    directionAnisotropyMin: 0.08,
    directionMinimumFrameCount: 3,
    directionErrorP90MaxDeg: 30,
    directionEndpointMeanMaxDeg: 30,
    directionEndpointFrameCount: 2,
    poseVariationActivationMin: 0.08,
    poseEvolutionRetentionMin: 0.6,
    poseEvolutionRetentionMax: 1.8,
    poseEvolutionCorrelationMin: 0.35,
    tailAreaRatioMax: 0.32,
    tailMinimumFrameCount: 3,
    tailTemplateReconfigurationIouMax: 0.2,
    tailGeneratedIouMax: 0.3,
    tailAllowedIouExcess: 0.2,
    tailChangeRetentionMin: 0.65,
    outerAreaCorrelationMin: 0.75,
    outerAreaNormalizedMaeMax: 0.28,
    outerPeakFrameDeltaMax: 1,
    outerCentroidDriftMedianMax: 0.06,
    outerCentroidDriftP95Max: 0.12,
    coreTemplateIouMedianMin: 0.35,
    coreAreaCorrelationMin: 0.6,
    coreAreaNormalizedMaeMax: 0.35,
    bodyAdjacentCompensatedIouMedianMin: 0.48,
    bodyAdjacentCompensatedIouMin: 0.32,
    centroidResidualVelocityP95Max: 0.08,
    centroidResidualAccelerationP95Max: 0.14,
  })

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value))
  }

  function finiteNumber(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  function percentile(values, amount) {
    if (!values.length) return null
    const sorted = values.slice().sort((left, right) => left - right)
    const position = clamp(amount, 0, 1) * (sorted.length - 1)
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    if (lower === upper) return sorted[lower]
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
  }

  function summarize(values) {
    const finite = values.filter(Number.isFinite)
    if (!finite.length) return { values: [], min: null, max: null, mean: null, median: null, p95: null }
    return {
      values: finite,
      min: Math.min(...finite),
      max: Math.max(...finite),
      mean: finite.reduce((sum, value) => sum + value, 0) / finite.length,
      median: percentile(finite, 0.5),
      p95: percentile(finite, 0.95),
    }
  }

  function pearsonCorrelation(left, right) {
    if (left.length !== right.length || left.length < 2) return 0
    const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
    const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length
    let covariance = 0
    let leftVariance = 0
    let rightVariance = 0
    for (let index = 0; index < left.length; index += 1) {
      const leftDelta = left[index] - leftMean
      const rightDelta = right[index] - rightMean
      covariance += leftDelta * rightDelta
      leftVariance += leftDelta * leftDelta
      rightVariance += rightDelta * rightDelta
    }
    const denominator = Math.sqrt(leftVariance * rightVariance)
    return denominator > 1e-12 ? clamp(covariance / denominator, -1, 1) : 0
  }

  function normalizeCurve(values) {
    const maximum = Math.max(0, ...values)
    return maximum > 0 ? values.map((value) => value / maximum) : values.map(() => 0)
  }

  function normalizedCurveMae(left, right) {
    const normalizedLeft = normalizeCurve(left)
    const normalizedRight = normalizeCurve(right)
    if (!normalizedLeft.length || normalizedLeft.length !== normalizedRight.length) return 1
    return normalizedLeft.reduce((sum, value, index) => sum + Math.abs(value - normalizedRight[index]), 0) / normalizedLeft.length
  }

  function peakIndex(values) {
    if (!values.length) return -1
    let bestIndex = 0
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] > values[bestIndex]) bestIndex = index
    }
    return bestIndex
  }

  function invalidInput(message, details = {}) {
    const error = new Error(message)
    error.code = ERROR_CODES.INVALID_INPUT
    error.details = details
    throw error
  }

  function readFrameImageData(frame, index, label) {
    const candidate = frame?.imageData || frame?.canvas || frame
    if (!candidate) invalidInput(`${label}[${index}] is missing a canvas or imageData`)
    let imageData = null
    if (candidate.data && Number.isFinite(candidate.width) && Number.isFinite(candidate.height)) {
      imageData = candidate
    } else if (typeof candidate.getContext === 'function') {
      const context = candidate.getContext('2d', { willReadFrequently: true })
      if (!context || typeof context.getImageData !== 'function') invalidInput(`${label}[${index}] does not expose a readable 2D canvas`)
      imageData = context.getImageData(0, 0, candidate.width, candidate.height)
    }
    const width = Math.round(finiteNumber(imageData?.width, candidate.width))
    const height = Math.round(finiteNumber(imageData?.height, candidate.height))
    if (!imageData?.data || width <= 0 || height <= 0 || imageData.data.length < width * height * 4) {
      invalidInput(`${label}[${index}] has invalid RGBA image data`, { width, height })
    }
    return { width, height, data: imageData.data }
  }

  function readSequenceFrames(frames, label) {
    if (!Array.isArray(frames) || frames.length < 2) invalidInput(`${label} must contain at least two frames`)
    const images = frames.map((frame, index) => readFrameImageData(frame, index, label))
    const width = images[0].width
    const height = images[0].height
    for (let index = 1; index < images.length; index += 1) {
      if (images[index].width !== width || images[index].height !== height) {
        invalidInput(`${label} frame dimensions must remain constant`, { index, expected: { width, height }, actual: images[index] })
      }
    }
    return images
  }

  function buildMaskRecord(image, threshold) {
    const pixelCount = image.width * image.height
    const mask = new Uint8Array(pixelCount)
    let areaPixels = 0
    let sumX = 0
    let sumY = 0
    let sumXX = 0
    let sumYY = 0
    let sumXY = 0
    for (let index = 0; index < pixelCount; index += 1) {
      if (image.data[index * 4 + 3] / 255 < threshold) continue
      const x = index % image.width
      const y = Math.floor(index / image.width)
      mask[index] = 1
      areaPixels += 1
      sumX += x
      sumY += y
      sumXX += x * x
      sumYY += y * y
      sumXY += x * y
    }
    const centroid = areaPixels ? { x: sumX / areaPixels, y: sumY / areaPixels } : null
    const covarianceXX = areaPixels ? Math.max(0, sumXX / areaPixels - centroid.x * centroid.x) : 0
    const covarianceYY = areaPixels ? Math.max(0, sumYY / areaPixels - centroid.y * centroid.y) : 0
    const covarianceXY = areaPixels ? sumXY / areaPixels - centroid.x * centroid.y : 0
    const principalAngle = areaPixels
      ? 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY)
      : null
    const covarianceTrace = covarianceXX + covarianceYY
    const covarianceSpread = Math.sqrt(Math.max(0, (covarianceXX - covarianceYY) ** 2 + 4 * covarianceXY ** 2))
    const majorVariance = Math.max(0, (covarianceTrace + covarianceSpread) * 0.5)
    const minorVariance = Math.max(0, (covarianceTrace - covarianceSpread) * 0.5)
    return {
      width: image.width,
      height: image.height,
      mask,
      areaPixels,
      areaRatio: areaPixels / Math.max(1, pixelCount),
      centroid,
      principalAngle,
      anisotropy: majorVariance > 1e-9 ? clamp((majorVariance - minorVariance) / majorVariance, 0, 1) : 0,
    }
  }

  function maskIou(left, right) {
    let intersection = 0
    let union = 0
    for (let index = 0; index < left.mask.length; index += 1) {
      const leftValue = left.mask[index]
      const rightValue = right.mask[index]
      if (leftValue && rightValue) intersection += 1
      if (leftValue || rightValue) union += 1
    }
    return union ? intersection / union : 1
  }

  function masksEqual(left, right) {
    if (left.mask.length !== right.mask.length) return false
    for (let index = 0; index < left.mask.length; index += 1) {
      if (left.mask[index] !== right.mask[index]) return false
    }
    return true
  }

  function alphaChannelsEqual(left, right) {
    const pixelCount = left.width * left.height
    for (let index = 0; index < pixelCount; index += 1) {
      if (left.data[index * 4 + 3] !== right.data[index * 4 + 3]) return false
    }
    return true
  }

  function shiftMask(record, shiftX, shiftY) {
    const output = new Uint8Array(record.mask.length)
    const roundedX = Math.round(shiftX)
    const roundedY = Math.round(shiftY)
    for (let y = 0; y < record.height; y += 1) {
      const targetY = y + roundedY
      if (targetY < 0 || targetY >= record.height) continue
      for (let x = 0; x < record.width; x += 1) {
        if (!record.mask[y * record.width + x]) continue
        const targetX = x + roundedX
        if (targetX < 0 || targetX >= record.width) continue
        output[targetY * record.width + targetX] = 1
      }
    }
    return { ...record, mask: output }
  }

  function centroidCompensatedIou(reference, candidate) {
    if (!reference.centroid || !candidate.centroid) return 0
    const shifted = shiftMask(candidate, reference.centroid.x - candidate.centroid.x, reference.centroid.y - candidate.centroid.y)
    return maskIou(reference, shifted)
  }

  function centroidAndUniformScaleCompensatedIou(reference, candidate) {
    if (!reference.centroid || !candidate.centroid || reference.areaPixels <= 0 || candidate.areaPixels <= 0) return 0
    const scale = Math.sqrt(reference.areaPixels / candidate.areaPixels)
    const output = new Uint8Array(candidate.mask.length)
    for (let y = 0; y < reference.height; y += 1) {
      const sourceY = Math.round(candidate.centroid.y + (y - reference.centroid.y) / scale)
      if (sourceY < 0 || sourceY >= candidate.height) continue
      for (let x = 0; x < reference.width; x += 1) {
        const sourceX = Math.round(candidate.centroid.x + (x - reference.centroid.x) / scale)
        if (sourceX < 0 || sourceX >= candidate.width) continue
        output[y * reference.width + x] = candidate.mask[sourceY * candidate.width + sourceX]
      }
    }
    return maskIou(reference, { ...candidate, mask: output })
  }

  function measureGeneratedTransitionIou(leftFrame, rightFrame, options = {}) {
    const alphaThreshold = clamp(finiteNumber(options.alphaThreshold, 0.05), 0.001, 0.999)
    const leftImage = readFrameImageData(leftFrame, 0, 'leftFrame')
    const rightImage = readFrameImageData(rightFrame, 0, 'rightFrame')
    if (leftImage.width !== rightImage.width || leftImage.height !== rightImage.height) {
      invalidInput('Generated transition frames must keep identical dimensions', {
        left: { width: leftImage.width, height: leftImage.height },
        right: { width: rightImage.width, height: rightImage.height },
      })
    }
    return centroidAndUniformScaleCompensatedIou(
      buildMaskRecord(leftImage, alphaThreshold),
      buildMaskRecord(rightImage, alphaThreshold),
    )
  }

  function dilateMask(record, radius) {
    const safeRadius = Math.max(0, Math.round(radius))
    if (!safeRadius) return record.mask
    const horizontal = new Uint8Array(record.mask.length)
    const output = new Uint8Array(record.mask.length)
    for (let y = 0; y < record.height; y += 1) {
      let active = 0
      for (let sampleX = 0; sampleX <= Math.min(record.width - 1, safeRadius); sampleX += 1) {
        active += record.mask[y * record.width + sampleX]
      }
      for (let x = 0; x < record.width; x += 1) {
        horizontal[y * record.width + x] = active > 0 ? 1 : 0
        const leaving = x - safeRadius
        const entering = x + safeRadius + 1
        if (leaving >= 0) active -= record.mask[y * record.width + leaving]
        if (entering < record.width) active += record.mask[y * record.width + entering]
      }
    }
    for (let x = 0; x < record.width; x += 1) {
      let active = 0
      for (let sampleY = 0; sampleY <= Math.min(record.height - 1, safeRadius); sampleY += 1) {
        active += horizontal[sampleY * record.width + x]
      }
      for (let y = 0; y < record.height; y += 1) {
        output[y * record.width + x] = active > 0 ? 1 : 0
        const leaving = y - safeRadius
        const entering = y + safeRadius + 1
        if (leaving >= 0) active -= horizontal[leaving * record.width + x]
        if (entering < record.height) active += horizontal[entering * record.width + x]
      }
    }
    return output
  }

  function tolerantSupport(reference, candidate, radius) {
    const dilatedReference = dilateMask(reference, radius)
    const dilatedCandidate = dilateMask(candidate, radius)
    let candidateSupported = 0
    let referenceSupported = 0
    let dilatedIntersection = 0
    let dilatedUnion = 0
    for (let index = 0; index < reference.mask.length; index += 1) {
      if (candidate.mask[index] && dilatedReference[index]) candidateSupported += 1
      if (reference.mask[index] && dilatedCandidate[index]) referenceSupported += 1
      if (dilatedReference[index] && dilatedCandidate[index]) dilatedIntersection += 1
      if (dilatedReference[index] || dilatedCandidate[index]) dilatedUnion += 1
    }
    const precision = candidate.areaPixels > 0 ? candidateSupported / candidate.areaPixels : reference.areaPixels > 0 ? 0 : 1
    const recall = reference.areaPixels > 0 ? referenceSupported / reference.areaPixels : candidate.areaPixels > 0 ? 0 : 1
    return {
      precision,
      recall,
      f1: precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0,
      dilatedIou: dilatedUnion > 0 ? dilatedIntersection / dilatedUnion : 1,
    }
  }

  function principalAngleErrorDegrees(reference, candidate, minimumAnisotropy) {
    if (!Number.isFinite(reference.principalAngle) || reference.anisotropy < minimumAnisotropy) return null
    if (!Number.isFinite(candidate.principalAngle) || candidate.anisotropy < minimumAnisotropy) return 90
    const raw = Math.abs((candidate.principalAngle - reference.principalAngle) * 180 / Math.PI) % 180
    return Math.min(raw, 180 - raw)
  }

  function mean(values) {
    const finite = values.filter(Number.isFinite)
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null
  }

  function analyzeDirectionFidelity(template, generated, maximumTemplateArea, thresholds) {
    const frameMetrics = []
    for (let index = 0; index < template.length; index += 1) {
      if (template[index].areaRatio < maximumTemplateArea * thresholds.directionActiveAreaRatio) continue
      const errorDeg = principalAngleErrorDegrees(template[index], generated[index], thresholds.directionAnisotropyMin)
      if (!Number.isFinite(errorDeg)) continue
      frameMetrics.push({
        index,
        templateAngleDeg: template[index].principalAngle * 180 / Math.PI,
        generatedAngleDeg: Number.isFinite(generated[index].principalAngle) ? generated[index].principalAngle * 180 / Math.PI : null,
        templateAnisotropy: template[index].anisotropy,
        generatedAnisotropy: generated[index].anisotropy,
        errorDeg,
      })
    }
    const errors = frameMetrics.map((entry) => entry.errorDeg)
    const endpointCount = Math.max(1, Math.round(thresholds.directionEndpointFrameCount))
    const endpointEntries = frameMetrics.length <= endpointCount * 2
      ? frameMetrics
      : [...frameMetrics.slice(0, endpointCount), ...frameMetrics.slice(-endpointCount)]
    return {
      frameMetrics,
      error: summarize(errors),
      p90ErrorDeg: percentile(errors, 0.9),
      endpointMeanErrorDeg: mean(endpointEntries.map((entry) => entry.errorDeg)),
      endpointIndices: endpointEntries.map((entry) => entry.index),
    }
  }

  function analyzePoseEvolution(template, generated, bodyFrameIndices, templatePeakFrame, thresholds) {
    const frameIndices = bodyFrameIndices.filter((index) => index !== templatePeakFrame)
    const templateVariation = frameIndices.map((index) => 1 - centroidAndUniformScaleCompensatedIou(template[templatePeakFrame], template[index]))
    const generatedVariation = frameIndices.map((index) => 1 - centroidAndUniformScaleCompensatedIou(generated[templatePeakFrame], generated[index]))
    const templateMean = mean(templateVariation) ?? 0
    const generatedMean = mean(generatedVariation) ?? 0
    const active = frameIndices.length >= 2 && templateMean >= thresholds.poseVariationActivationMin
    return {
      active,
      frameIndices,
      templateVariation,
      generatedVariation,
      templateMean,
      generatedMean,
      retentionRatio: templateMean > 1e-9 ? generatedMean / templateMean : 1,
      correlation: frameIndices.length >= 2 ? pearsonCorrelation(templateVariation, generatedVariation) : 1,
    }
  }

  function analyzeTailReconfiguration(template, generated, templateAreas, templatePeakFrame, maximumTemplateArea, thresholds) {
    const frameIndices = template
      .map((frame, index) => ({ index, area: templateAreas[index] }))
      .filter((entry) => entry.index > templatePeakFrame
        && entry.area > 0
        && entry.area <= maximumTemplateArea * thresholds.tailAreaRatioMax)
      .map((entry) => entry.index)
    const templateAdjacentIous = []
    const generatedAdjacentIous = []
    for (let cursor = 1; cursor < frameIndices.length; cursor += 1) {
      const previous = frameIndices[cursor - 1]
      const current = frameIndices[cursor]
      if (current !== previous + 1) continue
      templateAdjacentIous.push(centroidAndUniformScaleCompensatedIou(template[previous], template[current]))
      generatedAdjacentIous.push(centroidAndUniformScaleCompensatedIou(generated[previous], generated[current]))
    }
    const templateMeanIou = mean(templateAdjacentIous)
    const generatedMeanIou = mean(generatedAdjacentIous)
    const active = frameIndices.length >= thresholds.tailMinimumFrameCount
      && Number.isFinite(templateMeanIou)
      && templateMeanIou <= thresholds.tailTemplateReconfigurationIouMax
    const templateChange = Number.isFinite(templateMeanIou) ? 1 - templateMeanIou : 0
    const generatedChange = Number.isFinite(generatedMeanIou) ? 1 - generatedMeanIou : 0
    return {
      active,
      frameIndices,
      templateAdjacentIous,
      generatedAdjacentIous,
      templateMeanIou,
      generatedMeanIou,
      maximumAllowedGeneratedIou: Number.isFinite(templateMeanIou)
        ? Math.max(thresholds.tailGeneratedIouMax, templateMeanIou + thresholds.tailAllowedIouExcess)
        : thresholds.tailGeneratedIouMax,
      changeRetentionRatio: templateChange > 1e-9 ? generatedChange / templateChange : 1,
    }
  }

  function distance(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y)
  }

  function resolveThresholds(overrides = {}) {
    const maskThresholds = Array.isArray(overrides.maskThresholds) && overrides.maskThresholds.length >= 2
      ? overrides.maskThresholds.map((value) => clamp(finiteNumber(value, 0), 0.001, 0.999)).slice(0, 2)
      : Array.from(DEFAULT_THRESHOLDS.maskThresholds)
    return {
      ...DEFAULT_THRESHOLDS,
      ...overrides,
      maskThresholds,
    }
  }

  function analyzeAtThreshold(templateImages, generatedImages, alphaThreshold, thresholds) {
    const template = templateImages.map((image) => buildMaskRecord(image, alphaThreshold))
    const generated = generatedImages.map((image) => buildMaskRecord(image, alphaThreshold))
    const templateAreas = template.map((frame) => frame.areaRatio)
    const generatedAreas = generated.map((frame) => frame.areaRatio)
    const maximumTemplateArea = Math.max(...templateAreas)
    const activeFrameIndices = template
      .map((frame, index) => ({ index, area: frame.areaRatio }))
      .filter((entry) => entry.area >= maximumTemplateArea * thresholds.activeAreaRatio && entry.area > 0)
      .map((entry) => entry.index)
    const bodyFrameIndices = template
      .map((frame, index) => ({ index, area: frame.areaRatio }))
      .filter((entry) => entry.area >= maximumTemplateArea * thresholds.bodyAreaRatio && entry.area > 0)
      .map((entry) => entry.index)
    const activeSet = new Set(activeFrameIndices)
    const bodySet = new Set(bodyFrameIndices)
    const templateIous = []
    const compensatedTemplateIous = []
    const supportFrameMetrics = []
    const centroidDrifts = []
    let exactMaskFrames = 0
    const canvasDiagonal = Math.hypot(templateImages[0].width, templateImages[0].height)
    const supportTolerancePx = Math.max(1, Math.ceil(Math.min(templateImages[0].width, templateImages[0].height) * thresholds.supportToleranceRatio))

    for (const index of activeFrameIndices) {
      templateIous.push(maskIou(template[index], generated[index]))
      compensatedTemplateIous.push(centroidCompensatedIou(template[index], generated[index]))
      const support = tolerantSupport(template[index], generated[index], supportTolerancePx)
      supportFrameMetrics.push(Object.freeze({ index, ...support }))
      if (masksEqual(template[index], generated[index])) exactMaskFrames += 1
      if (template[index].centroid && generated[index].centroid) {
        centroidDrifts.push(distance(template[index].centroid, generated[index].centroid) / canvasDiagonal)
      } else {
        centroidDrifts.push(1)
      }
    }

    const adjacentCompensatedIous = []
    const residualVelocity = []
    const residualAcceleration = []
    const residuals = template.map((frame, index) => {
      if (!frame.centroid || !generated[index].centroid) return null
      return {
        x: generated[index].centroid.x - frame.centroid.x,
        y: generated[index].centroid.y - frame.centroid.y,
      }
    })
    for (let index = 0; index < generated.length - 1; index += 1) {
      if (!bodySet.has(index) || !bodySet.has(index + 1)) continue
      adjacentCompensatedIous.push(centroidCompensatedIou(generated[index], generated[index + 1]))
      if (residuals[index] && residuals[index + 1]) {
        residualVelocity.push(distance(residuals[index + 1], residuals[index]) / canvasDiagonal)
      }
    }
    for (let index = 1; index < generated.length - 1; index += 1) {
      if (!bodySet.has(index - 1) || !bodySet.has(index) || !bodySet.has(index + 1)) continue
      if (!residuals[index - 1] || !residuals[index] || !residuals[index + 1]) continue
      const acceleration = {
        x: residuals[index + 1].x - residuals[index].x * 2 + residuals[index - 1].x,
        y: residuals[index + 1].y - residuals[index].y * 2 + residuals[index - 1].y,
      }
      residualAcceleration.push(Math.hypot(acceleration.x, acceleration.y) / canvasDiagonal)
    }

    const areaCorrelation = pearsonCorrelation(templateAreas, generatedAreas)
    const areaNormalizedMae = normalizedCurveMae(templateAreas, generatedAreas)
    const templatePeakFrame = peakIndex(templateAreas)
    const generatedPeakFrame = peakIndex(generatedAreas)
    const directionFidelity = analyzeDirectionFidelity(template, generated, maximumTemplateArea, thresholds)
    const poseEvolution = analyzePoseEvolution(template, generated, bodyFrameIndices, templatePeakFrame, thresholds)
    const tailReconfiguration = analyzeTailReconfiguration(
      template,
      generated,
      templateAreas,
      templatePeakFrame,
      maximumTemplateArea,
      thresholds,
    )
    const tailFrameSet = new Set(tailReconfiguration.active ? tailReconfiguration.frameIndices : [])
    const constrainedSupportFrames = supportFrameMetrics.filter((entry) => !tailFrameSet.has(entry.index))
    const supportFrames = constrainedSupportFrames.length ? constrainedSupportFrames : supportFrameMetrics
    const semanticSupport = {
      tolerancePx: supportTolerancePx,
      constrainedFrameIndices: supportFrames.map((entry) => entry.index),
      excludedTailFrameIndices: supportFrameMetrics
        .filter((entry) => tailFrameSet.has(entry.index))
        .map((entry) => entry.index),
      frameMetrics: supportFrameMetrics,
      f1: summarize(supportFrames.map((entry) => entry.f1)),
      dilatedIou: summarize(supportFrames.map((entry) => entry.dilatedIou)),
      allActiveF1: summarize(supportFrameMetrics.map((entry) => entry.f1)),
      allActiveDilatedIou: summarize(supportFrameMetrics.map((entry) => entry.dilatedIou)),
    }
    return {
      alphaThreshold,
      activeFrameIndices,
      bodyFrameIndices,
      templateAreaCurve: templateAreas,
      generatedAreaCurve: generatedAreas,
      templateIou: summarize(templateIous),
      compensatedTemplateIou: summarize(compensatedTemplateIous),
      semanticSupport,
      directionFidelity,
      poseEvolution,
      tailReconfiguration,
      exactMaskFrameRatio: exactMaskFrames / Math.max(1, activeFrameIndices.length),
      areaCorrelation,
      areaNormalizedMae,
      templatePeakFrame,
      generatedPeakFrame,
      peakFrameDelta: Math.abs(templatePeakFrame - generatedPeakFrame),
      centroidDrift: summarize(centroidDrifts),
      bodyAdjacentCompensatedIou: summarize(adjacentCompensatedIous),
      centroidResidualVelocity: summarize(residualVelocity),
      centroidResidualAcceleration: summarize(residualAcceleration),
      activeFrameCount: activeSet.size,
    }
  }

  function evaluate(options = {}) {
    const thresholds = resolveThresholds(options.thresholds)
    const templateImages = readSequenceFrames(options.templateFrames, 'templateFrames')
    const generatedImages = readSequenceFrames(options.generatedFrames, 'generatedFrames')
    if (templateImages.length !== generatedImages.length) {
      invalidInput('templateFrames and generatedFrames must have the same frame count', {
        templateFrameCount: templateImages.length,
        generatedFrameCount: generatedImages.length,
      })
    }
    for (let index = 0; index < templateImages.length; index += 1) {
      if (templateImages[index].width !== generatedImages[index].width || templateImages[index].height !== generatedImages[index].height) {
        invalidInput('template and generated frame dimensions must match', { index })
      }
    }

    const perThreshold = thresholds.maskThresholds.map((alphaThreshold) =>
      analyzeAtThreshold(templateImages, generatedImages, alphaThreshold, thresholds))
    const closestThreshold = (target) => perThreshold.reduce((best, entry) => (
      Math.abs(entry.alphaThreshold - target) < Math.abs(best.alphaThreshold - target) ? entry : best
    ), perThreshold[0])
    const outer = closestThreshold(thresholds.outerMaskThreshold)
    const core = closestThreshold(thresholds.coreMaskThreshold)
    const activeFrameIndices = outer.activeFrameIndices
    const exactAlphaFrames = activeFrameIndices.filter((index) => alphaChannelsEqual(templateImages[index], generatedImages[index])).length
    const exactAlphaFrameRatio = exactAlphaFrames / Math.max(1, activeFrameIndices.length)
    const minimumExactMaskRatio = Math.min(...perThreshold.map((entry) => entry.exactMaskFrameRatio))
    const maximumExactMaskRatio = Math.max(...perThreshold.map((entry) => entry.exactMaskFrameRatio))
    const minimumCompensatedTemplateIou = Math.min(...perThreshold.map((entry) => entry.compensatedTemplateIou.median ?? 0))
    const minimumAreaCorrelation = Math.min(...perThreshold.map((entry) => entry.areaCorrelation))
    const maximumAreaNormalizedMae = Math.max(...perThreshold.map((entry) => entry.areaNormalizedMae))
    const failures = []
    const warnings = []
    const addFailure = (code, message, metrics) => failures.push({ code, message, metrics })
    const addWarning = (code, message, metrics) => warnings.push({ code, message, metrics })

    const translatedOrExactStencil = exactAlphaFrameRatio >= thresholds.stencilExactFrameRatioMin
      || maximumExactMaskRatio >= thresholds.stencilExactFrameRatioMin
      || (minimumCompensatedTemplateIou >= thresholds.stencilCompensatedIouMin
        && minimumAreaCorrelation >= thresholds.stencilAreaCorrelationMin
        && maximumAreaNormalizedMae <= thresholds.stencilAreaNormalizedMaeMax)
    if (translatedOrExactStencil) {
      addFailure(ERROR_CODES.TEMPLATE_STENCIL, 'Generated sequence reproduces the template silhouette instead of creating a material-specific shape.', {
        exactAlphaFrameRatio,
        minimumExactMaskRatio,
        maximumExactMaskRatio,
        minimumCompensatedTemplateIou,
      })
    }

    if (outer.areaCorrelation < thresholds.outerAreaCorrelationMin
      || outer.areaNormalizedMae > thresholds.outerAreaNormalizedMaeMax
      || outer.peakFrameDelta > thresholds.outerPeakFrameDeltaMax) {
      addFailure(ERROR_CODES.LIFECYCLE_INCOHERENT, 'Generated silhouette area does not preserve the template lifecycle.', {
        alphaThreshold: outer.alphaThreshold,
        areaCorrelation: outer.areaCorrelation,
        areaNormalizedMae: outer.areaNormalizedMae,
        peakFrameDelta: outer.peakFrameDelta,
      })
    }

    const outerTemplatePassed = (outer.templateIou.median ?? 0) >= thresholds.outerTemplateIouMedianMin
    if (!outerTemplatePassed) {
      addWarning('AIFX_SEQUENCE_TEMPLATE_OVERLAP_LOW', 'Material-specific silhouette differs from the source template; lifecycle, trajectory, and temporal continuity remain authoritative.', {
        alphaThreshold: outer.alphaThreshold,
        templateIouMedian: outer.templateIou.median,
      })
    }

    if ((outer.semanticSupport.f1.median ?? 0) < thresholds.supportF1MedianMin
      || (outer.semanticSupport.f1.min ?? 0) < thresholds.supportF1Min
      || (outer.semanticSupport.dilatedIou.median ?? 0) < thresholds.supportDilatedIouMedianMin) {
      addFailure(ERROR_CODES.TEMPLATE_DIVERGED, 'Generated material leaves the tolerant per-frame support region of the source action.', {
        alphaThreshold: outer.alphaThreshold,
        tolerancePx: outer.semanticSupport.tolerancePx,
        supportF1Median: outer.semanticSupport.f1.median,
        supportF1Min: outer.semanticSupport.f1.min,
        supportDilatedIouMedian: outer.semanticSupport.dilatedIou.median,
      })
    }

    if (outer.directionFidelity.frameMetrics.length >= thresholds.directionMinimumFrameCount
      && ((outer.directionFidelity.p90ErrorDeg ?? 90) > thresholds.directionErrorP90MaxDeg
        || (outer.directionFidelity.endpointMeanErrorDeg ?? 90) > thresholds.directionEndpointMeanMaxDeg)) {
      addFailure(ERROR_CODES.DIRECTION_DIVERGED, 'Generated frames do not preserve the template main-direction curve.', {
        alphaThreshold: outer.alphaThreshold,
        p90ErrorDeg: outer.directionFidelity.p90ErrorDeg,
        endpointMeanErrorDeg: outer.directionFidelity.endpointMeanErrorDeg,
        endpointIndices: outer.directionFidelity.endpointIndices,
      })
    }

    if ((outer.centroidDrift.median ?? 1) > thresholds.outerCentroidDriftMedianMax
      || (outer.centroidDrift.p95 ?? 1) > thresholds.outerCentroidDriftP95Max) {
      addFailure(ERROR_CODES.POSITION_DRIFT, 'Generated sequence moves away from the template trajectory.', {
        alphaThreshold: outer.alphaThreshold,
        centroidDriftMedian: outer.centroidDrift.median,
        centroidDriftP95: outer.centroidDrift.p95,
      })
    }

    if ((outer.bodyAdjacentCompensatedIou.median ?? 0) < thresholds.bodyAdjacentCompensatedIouMedianMin
      || (outer.bodyAdjacentCompensatedIou.min ?? 0) < thresholds.bodyAdjacentCompensatedIouMin
      || (outer.centroidResidualVelocity.p95 ?? 0) > thresholds.centroidResidualVelocityP95Max
      || (outer.centroidResidualAcceleration.p95 ?? 0) > thresholds.centroidResidualAccelerationP95Max) {
      addFailure(ERROR_CODES.TEMPORAL_JITTER, 'Generated material silhouette is not temporally coherent through the body phase.', {
        alphaThreshold: outer.alphaThreshold,
        bodyAdjacentMedian: outer.bodyAdjacentCompensatedIou.median,
        bodyAdjacentMin: outer.bodyAdjacentCompensatedIou.min,
        centroidResidualVelocityP95: outer.centroidResidualVelocity.p95,
        centroidResidualAccelerationP95: outer.centroidResidualAcceleration.p95,
      })
    }

    if (outer.poseEvolution.active
      && (outer.poseEvolution.retentionRatio < thresholds.poseEvolutionRetentionMin
        || outer.poseEvolution.retentionRatio > thresholds.poseEvolutionRetentionMax
        || outer.poseEvolution.correlation < thresholds.poseEvolutionCorrelationMin)) {
      addFailure(ERROR_CODES.POSE_EVOLUTION_DIVERGED, 'Generated frames do not retain the template pose-evolution amplitude and timing after centroid/scale compensation.', {
        alphaThreshold: outer.alphaThreshold,
        frameIndices: outer.poseEvolution.frameIndices,
        templateMean: outer.poseEvolution.templateMean,
        generatedMean: outer.poseEvolution.generatedMean,
        retentionRatio: outer.poseEvolution.retentionRatio,
        correlation: outer.poseEvolution.correlation,
      })
    }

    if (outer.tailReconfiguration.active
      && ((outer.tailReconfiguration.generatedMeanIou ?? 1) > outer.tailReconfiguration.maximumAllowedGeneratedIou
        || outer.tailReconfiguration.changeRetentionRatio < thresholds.tailChangeRetentionMin)) {
      addFailure(ERROR_CODES.TAIL_FROZEN, 'Generated breakup/dissipation reuses a frozen tail shape instead of following the template reconfiguration.', {
        alphaThreshold: outer.alphaThreshold,
        frameIndices: outer.tailReconfiguration.frameIndices,
        templateMeanIou: outer.tailReconfiguration.templateMeanIou,
        generatedMeanIou: outer.tailReconfiguration.generatedMeanIou,
        maximumAllowedGeneratedIou: outer.tailReconfiguration.maximumAllowedGeneratedIou,
        changeRetentionRatio: outer.tailReconfiguration.changeRetentionRatio,
      })
    }

    const coreLifecyclePassed = core.areaCorrelation >= thresholds.coreAreaCorrelationMin
      && core.areaNormalizedMae <= thresholds.coreAreaNormalizedMaeMax
    const coreTemplatePassed = (core.templateIou.median ?? 0) >= thresholds.coreTemplateIouMedianMin
    if (!coreLifecyclePassed) {
      addWarning('AIFX_SEQUENCE_CORE_LIFECYCLE_WEAK', 'Solid-core animation is weaker than the preferred lifecycle target; the valid outer envelope remains authoritative.', {
        alphaThreshold: core.alphaThreshold,
        areaCorrelation: core.areaCorrelation,
        areaNormalizedMae: core.areaNormalizedMae,
      })
    }
    if (!coreTemplatePassed) {
      addWarning('AIFX_SEQUENCE_CORE_TEMPLATE_WEAK', 'Solid-core overlap is below the preferred target; the valid outer envelope remains authoritative.', {
        alphaThreshold: core.alphaThreshold,
        templateIouMedian: core.templateIou.median,
      })
    }

    const maximumPeakFrameDelta = Math.max(...perThreshold.map((entry) => entry.peakFrameDelta))
    const minimumTemplateIouMedian = Math.min(...perThreshold.map((entry) => entry.templateIou.median ?? 0))
    const maximumCentroidDriftMedian = Math.max(...perThreshold.map((entry) => entry.centroidDrift.median ?? 1))
    const maximumCentroidDriftP95 = Math.max(...perThreshold.map((entry) => entry.centroidDrift.p95 ?? 1))
    const minimumBodyAdjacentMedian = Math.min(...perThreshold.map((entry) => entry.bodyAdjacentCompensatedIou.median ?? 0))
    const minimumBodyAdjacentIou = Math.min(...perThreshold.map((entry) => entry.bodyAdjacentCompensatedIou.min ?? 0))
    const maximumResidualVelocityP95 = Math.max(...perThreshold.map((entry) => entry.centroidResidualVelocity.p95 ?? 0))
    const maximumResidualAccelerationP95 = Math.max(...perThreshold.map((entry) => entry.centroidResidualAcceleration.p95 ?? 0))
    const minimumSupportF1Median = Math.min(...perThreshold.map((entry) => entry.semanticSupport.f1.median ?? 0))
    const minimumSupportF1 = Math.min(...perThreshold.map((entry) => entry.semanticSupport.f1.min ?? 0))
    const minimumSupportDilatedIouMedian = Math.min(...perThreshold.map((entry) => entry.semanticSupport.dilatedIou.median ?? 0))
    const maximumDirectionErrorP90Deg = Math.max(...perThreshold.map((entry) => entry.directionFidelity.p90ErrorDeg ?? 0))
    const maximumDirectionEndpointMeanErrorDeg = Math.max(...perThreshold.map((entry) => entry.directionFidelity.endpointMeanErrorDeg ?? 0))
    const activePoseEvolution = perThreshold.filter((entry) => entry.poseEvolution.active)
    const minimumPoseEvolutionRetention = activePoseEvolution.length
      ? Math.min(...activePoseEvolution.map((entry) => entry.poseEvolution.retentionRatio))
      : 1
    const minimumPoseEvolutionCorrelation = activePoseEvolution.length
      ? Math.min(...activePoseEvolution.map((entry) => entry.poseEvolution.correlation))
      : 1
    const activeTailReconfiguration = perThreshold.filter((entry) => entry.tailReconfiguration.active)
    const minimumTailChangeRetention = activeTailReconfiguration.length
      ? Math.min(...activeTailReconfiguration.map((entry) => entry.tailReconfiguration.changeRetentionRatio))
      : 1
    const maximumGeneratedTailIou = activeTailReconfiguration.length
      ? Math.max(...activeTailReconfiguration.map((entry) => entry.tailReconfiguration.generatedMeanIou ?? 1))
      : 0

    const diagnostics = {
      version: VERSION,
      frameCount: templateImages.length,
      width: templateImages[0].width,
      height: templateImages[0].height,
      thresholds,
      exactAlphaFrameRatio,
      minimumExactMaskRatio,
      maximumExactMaskRatio,
      minimumCompensatedTemplateIou,
      minimumAreaCorrelation,
      maximumAreaNormalizedMae,
      maximumPeakFrameDelta,
      minimumTemplateIouMedian,
      maximumCentroidDriftMedian,
      maximumCentroidDriftP95,
      minimumBodyAdjacentMedian,
      minimumBodyAdjacentIou,
      maximumResidualVelocityP95,
      maximumResidualAccelerationP95,
      minimumSupportF1Median,
      minimumSupportF1,
      minimumSupportDilatedIouMedian,
      maximumDirectionErrorP90Deg,
      maximumDirectionEndpointMeanErrorDeg,
      minimumPoseEvolutionRetention,
      minimumPoseEvolutionCorrelation,
      minimumTailChangeRetention,
      maximumGeneratedTailIou,
      semanticAction: {
        support: outer.semanticSupport,
        direction: outer.directionFidelity,
        poseEvolution: outer.poseEvolution,
        tailReconfiguration: outer.tailReconfiguration,
      },
      hardOuterGate: outer,
      outerTemplatePassed,
      coreAuxiliary: {
        passed: coreLifecyclePassed && coreTemplatePassed,
        lifecyclePassed: coreLifecyclePassed,
        templatePassed: coreTemplatePassed,
        metrics: core,
      },
      perThreshold,
    }
    return {
      version: VERSION,
      passed: failures.length === 0,
      code: failures[0]?.code || null,
      failures,
      warnings,
      diagnostics,
    }
  }

  function assertQuality(options = {}) {
    const result = evaluate(options)
    if (result.passed) return result
    const error = new Error(result.failures[0].message)
    error.code = result.code
    error.failures = result.failures
    error.diagnostics = result.diagnostics
    throw error
  }

  return Object.freeze({
    version: VERSION,
    ERROR_CODES,
    DEFAULT_THRESHOLDS,
    measureGeneratedTransitionIou,
    evaluate,
    assertQuality,
  })
})
