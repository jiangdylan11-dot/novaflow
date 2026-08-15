(function initNovaFlowAifxTemplateMaterializeWorkflow(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAifxTemplateMaterializeWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAifxTemplateMaterializeWorkflow() {
  'use strict'

  const VERSION = 'aifx-template-materialize-v1'
  const MIN_FRAME_COUNT = 2
  const MAX_FRAME_COUNT = 96
  const SUPPORTED_MATERIALS = Object.freeze(['fire', 'lightning', 'ice'])
  const FEATURE_CHANNELS = Object.freeze([
    'low-frequency-soft-envelope',
    'signed-distance-envelope',
    'luminance-core',
    'boundary-edge',
    'component-fragments',
    'medial-ridge',
  ])
  const DEFAULTS = Object.freeze({
    styleStrength: 0.78,
    contourVariation: 0.68,
    seed: 1729,
    activeThreshold: 0.075,
  })
  const ERROR_CODES = Object.freeze({
    INVALID_INPUT: 'AIFX_TEMPLATE_MATERIALIZE_INVALID_INPUT',
    UNSUPPORTED_MATERIAL: 'AIFX_TEMPLATE_MATERIALIZE_UNSUPPORTED_MATERIAL',
    EMPTY_TEMPLATE: 'AIFX_TEMPLATE_MATERIALIZE_EMPTY_TEMPLATE',
    EMPTY_MATERIAL: 'AIFX_TEMPLATE_MATERIALIZE_EMPTY_MATERIAL',
  })
  const MATERIAL_DEFAULTS = Object.freeze({
    fire: Object.freeze({
      shadow: Object.freeze([145, 12, 0]),
      mid: Object.freeze([238, 48, 2]),
      glow: Object.freeze([255, 139, 12]),
      core: Object.freeze([255, 230, 96]),
      amplitude: 1.0,
    }),
    lightning: Object.freeze({
      shadow: Object.freeze([4, 18, 92]),
      mid: Object.freeze([12, 92, 242]),
      glow: Object.freeze([39, 209, 255]),
      core: Object.freeze([226, 252, 255]),
      amplitude: 0.82,
    }),
    ice: Object.freeze({
      shadow: Object.freeze([8, 47, 88]),
      mid: Object.freeze([46, 153, 212]),
      glow: Object.freeze([126, 229, 255]),
      core: Object.freeze([239, 253, 255]),
      amplitude: 0.72,
    }),
  })
  const OUTER_AREA_SCALE = Object.freeze({
    fire: 1.15,
    lightning: 0.98,
    ice: 1.04,
  })

  class AifxTemplateMaterializeError extends Error {
    constructor(code, message, details = {}) {
      super(message)
      this.name = 'AifxTemplateMaterializeError'
      this.code = code
      this.details = details
    }
  }

  function fail(code, message, details) {
    throw new AifxTemplateMaterializeError(code, message, details)
  }

  function clamp(value, minimum, maximum) {
    const number = Number(value)
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : minimum
  }

  function saturate(value) {
    return clamp(value, 0, 1)
  }

  function mix(left, right, amount) {
    return left + (right - left) * saturate(amount)
  }

  function smoothstep(edge0, edge1, value) {
    if (edge0 === edge1) return value >= edge1 ? 1 : 0
    const amount = saturate((value - edge0) / (edge1 - edge0))
    return amount * amount * (3 - 2 * amount)
  }

  function normalizeUnit(value, fallback) {
    const number = Number(value)
    if (!Number.isFinite(number)) return fallback
    return clamp(number > 1.5 ? number / 100 : number, 0, 1)
  }

  function seedInteger(value) {
    if (typeof value === 'string') {
      let hash = 2166136261
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
      }
      return hash >>> 0
    }
    const number = Number(value)
    return Number.isFinite(number) ? Math.round(number) >>> 0 : DEFAULTS.seed
  }

  function readImageData(value, label) {
    const candidate = value?.imageData || value?.canvas || value?.image || value
    if (!candidate) fail(ERROR_CODES.INVALID_INPUT, `${label} is missing RGBA image data.`)
    let imageData = null
    if (candidate.data && Number.isFinite(Number(candidate.width)) && Number.isFinite(Number(candidate.height))) {
      imageData = candidate
    } else if (typeof candidate.getContext === 'function') {
      const context = candidate.getContext('2d', { willReadFrequently: true })
      if (context && typeof context.getImageData === 'function') {
        imageData = context.getImageData(0, 0, candidate.width, candidate.height)
      }
    }
    const width = Math.round(Number(imageData?.width || candidate.width || 0))
    const height = Math.round(Number(imageData?.height || candidate.height || 0))
    if (!imageData?.data || width <= 0 || height <= 0 || imageData.data.length < width * height * 4) {
      fail(ERROR_CODES.INVALID_INPUT, `${label} must expose readable rgba8 pixels.`, { width, height })
    }
    return { width, height, data: imageData.data }
  }

  function readTemplateFrames(inputFrames) {
    if (!Array.isArray(inputFrames)
      || inputFrames.length < MIN_FRAME_COUNT
      || inputFrames.length > MAX_FRAME_COUNT) {
      fail(ERROR_CODES.INVALID_INPUT,
        `templateFrames must contain ${MIN_FRAME_COUNT} to ${MAX_FRAME_COUNT} chronological RGBA frames.`, {
        frameCount: Array.isArray(inputFrames) ? inputFrames.length : null,
        minimumFrameCount: MIN_FRAME_COUNT,
        maximumFrameCount: MAX_FRAME_COUNT,
      })
    }
    const frames = inputFrames.map((frame, index) => readImageData(frame, `templateFrames[${index}]`))
    const { width, height } = frames[0]
    for (let index = 1; index < frames.length; index += 1) {
      if (frames[index].width !== width || frames[index].height !== height) {
        fail(ERROR_CODES.INVALID_INPUT, 'Template frame dimensions must remain constant.', {
          index,
          expected: { width, height },
          actual: { width: frames[index].width, height: frames[index].height },
        })
      }
    }
    return frames
  }

  function hash3(x, y, z, seed) {
    let hash = seed ^ Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f)
    hash ^= hash >>> 16
    hash = Math.imul(hash, 0x7feb352d)
    hash ^= hash >>> 15
    hash = Math.imul(hash, 0x846ca68b)
    hash ^= hash >>> 16
    return (hash >>> 0) / 4294967295
  }

  function continuousNoise3(x, y, z, seed, detail = 0) {
    const phase = ((seed >>> 0) % 104729) * 0.000113 + detail * 3.731
    return saturate(
      0.5
      + Math.sin(x * 2.173 + y * 1.417 + z * 1.193 + phase) * 0.235
      + Math.sin(x * -4.371 + y * 3.127 - z * 1.891 + phase * 1.613) * 0.165
      + Math.cos(x * 7.113 - y * 5.237 + z * 2.611 - phase * 0.719) * 0.1,
    )
  }

  function boxBlurPass(source, width, height, radius) {
    if (radius <= 0) return new Float32Array(source)
    const horizontal = new Float32Array(source.length)
    const output = new Float32Array(source.length)
    const diameter = radius * 2 + 1
    for (let y = 0; y < height; y += 1) {
      const row = y * width
      let sum = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        sum += source[row + clamp(offset, 0, width - 1)]
      }
      for (let x = 0; x < width; x += 1) {
        horizontal[row + x] = sum / diameter
        sum += source[row + clamp(x + radius + 1, 0, width - 1)]
        sum -= source[row + clamp(x - radius, 0, width - 1)]
      }
    }
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        sum += horizontal[clamp(offset, 0, height - 1) * width + x]
      }
      for (let y = 0; y < height; y += 1) {
        output[y * width + x] = sum / diameter
        sum += horizontal[clamp(y + radius + 1, 0, height - 1) * width + x]
        sum -= horizontal[clamp(y - radius, 0, height - 1) * width + x]
      }
    }
    return output
  }

  function softBlur(source, width, height, radius) {
    const firstRadius = Math.max(1, Math.round(radius * 0.55))
    return boxBlurPass(boxBlurPass(source, width, height, firstRadius), width, height, firstRadius)
  }

  function extractSignal(image, activeThreshold) {
    const pixelCount = image.width * image.height
    let opaquePixels = 0
    let minimumAlpha = 1
    let maximumAlpha = 0
    for (let index = 0; index < pixelCount; index += 1) {
      const alpha = image.data[index * 4 + 3] / 255
      if (alpha >= 0.985) opaquePixels += 1
      minimumAlpha = Math.min(minimumAlpha, alpha)
      maximumAlpha = Math.max(maximumAlpha, alpha)
    }
    const hasUsefulAlpha = maximumAlpha - minimumAlpha > 0.08 && opaquePixels / Math.max(1, pixelCount) < 0.96
    const signal = new Float32Array(pixelCount)
    const luminance = new Float32Array(pixelCount)
    let maximumLuminance = 0
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4
      const alpha = image.data[offset + 3] / 255
      const lum = (image.data[offset] * 0.2126 + image.data[offset + 1] * 0.7152 + image.data[offset + 2] * 0.0722) / 255
      luminance[index] = lum
      maximumLuminance = Math.max(maximumLuminance, lum)
      signal[index] = hasUsefulAlpha
        ? Math.max(alpha, lum * alpha * 0.72)
        : smoothstep(activeThreshold * 0.35, Math.max(activeThreshold + 0.08, maximumLuminance), lum)
    }
    if (!hasUsefulAlpha && maximumLuminance > 0) {
      for (let index = 0; index < pixelCount; index += 1) {
        signal[index] = smoothstep(activeThreshold * 0.35, Math.max(activeThreshold + 0.04, maximumLuminance * 0.72), luminance[index])
      }
    }
    return { signal, luminance, hasUsefulAlpha, maximumLuminance }
  }

  function distanceTransform(mask, width, height, targetValue) {
    const diagonal = 1.41421356237
    const distance = new Float32Array(mask.length)
    for (let index = 0; index < mask.length; index += 1) distance[index] = mask[index] === targetValue ? 0 : 1e6
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x
        let value = distance[index]
        if (x > 0) value = Math.min(value, distance[index - 1] + 1)
        if (y > 0) value = Math.min(value, distance[index - width] + 1)
        if (x > 0 && y > 0) value = Math.min(value, distance[index - width - 1] + diagonal)
        if (x + 1 < width && y > 0) value = Math.min(value, distance[index - width + 1] + diagonal)
        distance[index] = value
      }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      for (let x = width - 1; x >= 0; x -= 1) {
        const index = y * width + x
        let value = distance[index]
        if (x + 1 < width) value = Math.min(value, distance[index + 1] + 1)
        if (y + 1 < height) value = Math.min(value, distance[index + width] + 1)
        if (x + 1 < width && y + 1 < height) value = Math.min(value, distance[index + width + 1] + diagonal)
        if (x > 0 && y + 1 < height) value = Math.min(value, distance[index + width - 1] + diagonal)
        distance[index] = value
      }
    }
    return distance
  }

  function connectedComponents(mask, width, height) {
    const labels = new Int32Array(mask.length)
    const queue = new Int32Array(mask.length)
    const components = []
    let label = 0
    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || labels[start]) continue
      label += 1
      let head = 0
      let tail = 0
      queue[tail++] = start
      labels[start] = label
      let area = 0
      let sumX = 0
      let sumY = 0
      let minX = width
      let minY = height
      let maxX = -1
      let maxY = -1
      while (head < tail) {
        const index = queue[head++]
        const x = index % width
        const y = Math.floor(index / width)
        area += 1
        sumX += x
        sumY += y
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
        for (let dy = -1; dy <= 1; dy += 1) {
          const nextY = y + dy
          if (nextY < 0 || nextY >= height) continue
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue
            const nextX = x + dx
            if (nextX < 0 || nextX >= width) continue
            const next = nextY * width + nextX
            if (!mask[next] || labels[next]) continue
            labels[next] = label
            queue[tail++] = next
          }
        }
      }
      components.push({
        label,
        area,
        centroid: { x: sumX / area, y: sumY / area },
        bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      })
    }
    components.sort((left, right) => right.area - left.area)
    const largestArea = components[0]?.area || 0
    const fragmentLabels = new Set(components
      .filter((component, index) => index > 0 && (component.area <= largestArea * 0.22 || component.area <= mask.length * 0.018))
      .map((component) => component.label))
    const fragmentMask = new Uint8Array(mask.length)
    for (let index = 0; index < labels.length; index += 1) {
      if (fragmentLabels.has(labels[index])) fragmentMask[index] = 1
    }
    return { labels, components, fragmentMask, fragmentCount: fragmentLabels.size }
  }

  function analyzeTemplateFrame(image, index, options = {}) {
    const activeThreshold = clamp(options.activeThreshold ?? DEFAULTS.activeThreshold, 0.01, 0.5)
    const { width, height } = image
    const pixelCount = width * height
    const extracted = extractSignal(image, activeThreshold)
    const radius = Math.max(2, Math.round(Math.min(width, height) * 0.025))
    const low = softBlur(extracted.signal, width, height, radius)
    const envelope = new Float32Array(pixelCount)
    const macroMask = new Uint8Array(pixelCount)
    const rawMask = new Uint8Array(pixelCount)
    const edge = new Float32Array(pixelCount)
    const core = new Float32Array(pixelCount)
    let activePixels = 0
    let outerActivePixels = 0
    let energy = 0
    let sumWeight = 0
    let sumX = 0
    let sumY = 0
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x
        const value = saturate(low[pixel] * 0.82 + extracted.signal[pixel] * 0.18)
        envelope[pixel] = value
        rawMask[pixel] = extracted.signal[pixel] >= activeThreshold ? 1 : 0
        macroMask[pixel] = value >= activeThreshold * 0.92 ? 1 : 0
        const left = low[y * width + Math.max(0, x - 1)]
        const right = low[y * width + Math.min(width - 1, x + 1)]
        const top = low[Math.max(0, y - 1) * width + x]
        const bottom = low[Math.min(height - 1, y + 1) * width + x]
        edge[pixel] = saturate(Math.hypot(right - left, bottom - top) * 3.2)
        core[pixel] = saturate(extracted.signal[pixel] * 0.6 + extracted.luminance[pixel] * 0.4)
        const sourceOuterActive = extracted.hasUsefulAlpha
          ? image.data[pixel * 4 + 3] >= 14
          : extracted.signal[pixel] >= 14 / 255
        if (sourceOuterActive) outerActivePixels += 1
        if (!rawMask[pixel]) continue
        activePixels += 1
        const weight = Math.max(0.025, extracted.signal[pixel])
        energy += extracted.signal[pixel]
        sumWeight += weight
        sumX += x * weight
        sumY += y * weight
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    if (!activePixels || !sumWeight) {
      fail(ERROR_CODES.EMPTY_TEMPLATE, `templateFrames[${index}] contains no usable effect pixels.`, { index })
    }
    const centroid = { x: sumX / sumWeight, y: sumY / sumWeight }
    let covarianceXX = 0
    let covarianceYY = 0
    let covarianceXY = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x
        if (!rawMask[pixel]) continue
        const weight = Math.max(0.025, extracted.signal[pixel])
        const dx = x - centroid.x
        const dy = y - centroid.y
        covarianceXX += dx * dx * weight
        covarianceYY += dy * dy * weight
        covarianceXY += dx * dy * weight
      }
    }
    covarianceXX /= sumWeight
    covarianceYY /= sumWeight
    covarianceXY /= sumWeight
    const angle = 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY)
    const discriminant = Math.sqrt(Math.max(0, (covarianceXX - covarianceYY) ** 2 + 4 * covarianceXY * covarianceXY))
    const eigenMajor = Math.max(1, (covarianceXX + covarianceYY + discriminant) * 0.5)
    const eigenMinor = Math.max(1, (covarianceXX + covarianceYY - discriminant) * 0.5)
    const distanceToInactive = distanceTransform(macroMask, width, height, 0)
    const distanceToActive = distanceTransform(macroMask, width, height, 1)
    const signedDistance = new Float32Array(pixelCount)
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      signedDistance[pixel] = macroMask[pixel] ? distanceToInactive[pixel] : -distanceToActive[pixel]
    }
    const componentAnalysis = connectedComponents(rawMask, width, height)
    const needsMedial = !options.materialType || options.materialType === 'lightning'
    const medialMask = new Uint8Array(pixelCount)
    const distanceToMedial = new Float32Array(pixelCount)
    distanceToMedial.fill(1e6)
    if (needsMedial) {
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const pixel = y * width + x
          const distance = distanceToInactive[pixel]
          if (!macroMask[pixel] || distance < 1.25) continue
          let lowerNeighbors = 0
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (!dx && !dy) continue
              if (distanceToInactive[(y + dy) * width + x + dx] <= distance + 0.08) lowerNeighbors += 1
            }
          }
          if (lowerNeighbors >= 7) medialMask[pixel] = 1
        }
      }
      if (!medialMask.some((value) => value)) {
        let bestPixel = 0
        for (let pixel = 1; pixel < pixelCount; pixel += 1) {
          if (distanceToInactive[pixel] > distanceToInactive[bestPixel]) bestPixel = pixel
        }
        medialMask[bestPixel] = 1
      }
      distanceToMedial.set(distanceTransform(medialMask, width, height, 1))
    }
    return {
      index,
      width,
      height,
      signal: extracted.signal,
      luminance: extracted.luminance,
      envelope,
      macroMask,
      rawMask,
      edge,
      core,
      signedDistance,
      distanceToInactive,
      distanceToMedial,
      fragmentMask: componentAnalysis.fragmentMask,
      components: componentAnalysis.components,
      fragmentCount: componentAnalysis.fragmentCount,
      centroid,
      axis: { x: Math.cos(angle), y: Math.sin(angle) },
      normal: { x: -Math.sin(angle), y: Math.cos(angle) },
      angle,
      lengthScale: Math.max(4, Math.sqrt(eigenMajor) * 2.8),
      widthScale: Math.max(3, Math.sqrt(eigenMinor) * 2.8),
      energy,
      activePixels,
      outerActivePixels,
      occupancy: activePixels / pixelCount,
      bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      hasUsefulAlpha: extracted.hasUsefulAlpha,
    }
  }

  function stabilizeAxes(analyses) {
    for (let index = 1; index < analyses.length; index += 1) {
      const previous = analyses[index - 1]
      const current = analyses[index]
      if (previous.axis.x * current.axis.x + previous.axis.y * current.axis.y >= 0) continue
      current.axis.x *= -1
      current.axis.y *= -1
      current.normal.x *= -1
      current.normal.y *= -1
      current.angle += Math.PI
    }
  }

  function buildMaterialProfile(materialImage, materialType) {
    const fallback = MATERIAL_DEFAULTS[materialType]
    const samples = []
    let sumR = 0
    let sumG = 0
    let sumB = 0
    let visible = 0
    for (let index = 0; index < materialImage.width * materialImage.height; index += 1) {
      const offset = index * 4
      const alpha = materialImage.data[offset + 3] / 255
      const lum = (materialImage.data[offset] + materialImage.data[offset + 1] + materialImage.data[offset + 2]) / 765
      if (alpha < 0.04 && lum < 0.035) continue
      const weight = Math.max(alpha, lum)
      const sample = [materialImage.data[offset], materialImage.data[offset + 1], materialImage.data[offset + 2], weight]
      samples.push(sample)
      sumR += sample[0] * weight
      sumG += sample[1] * weight
      sumB += sample[2] * weight
      visible += weight
    }
    if (!samples.length || !visible) fail(ERROR_CODES.EMPTY_MATERIAL, 'materialFrame contains no usable material pixels.')
    samples.sort((left, right) => (left[0] + left[1] + left[2]) - (right[0] + right[1] + right[2]))
    const quantile = (amount) => samples[Math.round((samples.length - 1) * amount)].slice(0, 3)
    return {
      image: materialImage,
      mean: [sumR / visible, sumG / visible, sumB / visible],
      dark: quantile(0.18),
      bright: quantile(0.88),
      fallback,
    }
  }

  function sampleMaterial(profile, u, v, frameProgress, seed) {
    const image = profile.image
    const wrap = (value) => ((value % 1) + 1) % 1
    const x = Math.min(image.width - 1, Math.floor(wrap(u + frameProgress * 0.041) * image.width))
    const y = Math.min(image.height - 1, Math.floor(wrap(v - frameProgress * 0.027) * image.height))
    const offset = (y * image.width + x) * 4
    const alpha = image.data[offset + 3] / 255
    const lum = (image.data[offset] + image.data[offset + 1] + image.data[offset + 2]) / 765
    const presence = Math.max(alpha, lum)
    const jitter = 0.9 + hash3(x, y, Math.round(frameProgress * 32), seed) * 0.2
    return {
      color: presence > 0.04
        ? [image.data[offset] * jitter, image.data[offset + 1] * jitter, image.data[offset + 2] * jitter]
        : profile.mean,
      presence,
      luminance: lum,
    }
  }

  function mixColor(left, right, amount) {
    return [mix(left[0], right[0], amount), mix(left[1], right[1], amount), mix(left[2], right[2], amount)]
  }

  function maskMetrics(templateMask, outputData, width, height, threshold = 0.05) {
    let templateArea = 0
    let outputArea = 0
    let intersection = 0
    let union = 0
    let exact = true
    let sumX = 0
    let sumY = 0
    for (let pixel = 0; pixel < templateMask.length; pixel += 1) {
      const template = templateMask[pixel] ? 1 : 0
      const output = outputData[pixel * 4 + 3] / 255 >= threshold ? 1 : 0
      templateArea += template
      outputArea += output
      if (template && output) intersection += 1
      if (template || output) union += 1
      if (template !== output) exact = false
      if (output) {
        sumX += pixel % width
        sumY += Math.floor(pixel / width)
      }
    }
    return {
      templateArea,
      outputArea,
      outputOccupancy: outputArea / Math.max(1, width * height),
      macroIou: union ? intersection / union : 1,
      exactMask: exact,
      centroid: outputArea ? { x: sumX / outputArea, y: sumY / outputArea } : null,
    }
  }

  function greatestCommonDivisor(left, right) {
    let a = Math.abs(Math.trunc(left))
    let b = Math.abs(Math.trunc(right))
    while (b) {
      const remainder = a % b
      a = b
      b = remainder
    }
    return a || 1
  }

  function calibrateOuterArea(frame, analysis, targetArea, seed) {
    const pixelCount = frame.width * frame.height
    const histogram = new Uint32Array(280)
    let candidateArea = 0
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const alpha = frame.data[pixel * 4 + 3]
      if (!alpha) continue
      const priority = alpha + Math.round(analysis.envelope[pixel] * 24)
      histogram[priority] += 1
      candidateArea += 1
    }
    if (!candidateArea) return { targetArea: 0, outputArea: 0, candidateArea: 0, cutoffPriority: 0 }

    const calibratedTarget = Math.max(1, Math.min(candidateArea, Math.round(targetArea)))
    let aboveCutoff = 0
    let cutoffPriority = 1
    for (let priority = histogram.length - 1; priority >= 1; priority -= 1) {
      if (aboveCutoff + histogram[priority] >= calibratedTarget) {
        cutoffPriority = priority
        break
      }
      aboveCutoff += histogram[priority]
    }
    const remainingAtCutoff = calibratedTarget - aboveCutoff
    const selectedAtCutoff = new Uint8Array(pixelCount)
    if (remainingAtCutoff >= histogram[cutoffPriority]) {
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const alpha = frame.data[pixel * 4 + 3]
        if (alpha && alpha + Math.round(analysis.envelope[pixel] * 24) === cutoffPriority) selectedAtCutoff[pixel] = 1
      }
    } else if (remainingAtCutoff > 0) {
      let stride = (seed ^ Math.imul(frame.index + 1, 0x9e3779b1)) >>> 0
      stride = Math.max(1, stride % pixelCount) | 1
      while (greatestCommonDivisor(stride, pixelCount) !== 1) {
        stride += 2
        if (stride >= pixelCount) stride = (stride % pixelCount) || 1
      }
      let pixel = Math.floor(hash3(frame.index, calibratedTarget, cutoffPriority, seed ^ 0x6c8e9cf5) * pixelCount)
      let selected = 0
      for (let visited = 0; visited < pixelCount && selected < remainingAtCutoff; visited += 1) {
        const alpha = frame.data[pixel * 4 + 3]
        const priority = alpha ? alpha + Math.round(analysis.envelope[pixel] * 24) : 0
        if (priority === cutoffPriority) {
          selectedAtCutoff[pixel] = 1
          selected += 1
        }
        pixel += stride
        if (pixel >= pixelCount) pixel -= pixelCount
      }
    }

    let outputArea = 0
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const offset = pixel * 4 + 3
      const alpha = frame.data[offset]
      const priority = alpha ? alpha + Math.round(analysis.envelope[pixel] * 24) : 0
      const selected = priority > cutoffPriority || (priority === cutoffPriority && selectedAtCutoff[pixel])
      if (selected) {
        frame.data[offset] = Math.max(14, alpha)
        outputArea += 1
      } else {
        frame.data[offset] = Math.min(12, alpha)
      }
    }
    return { targetArea: calibratedTarget, outputArea, candidateArea, cutoffPriority }
  }

  function materializeFrame(analysis, materialProfile, settings, energyMaximum, frameCount) {
    const { width, height } = analysis
    const output = new Uint8ClampedArray(width * height * 4)
    const progress = frameCount > 1 ? analysis.index / (frameCount - 1) : 0
    const material = MATERIAL_DEFAULTS[settings.materialType]
    const amplitude = (1.5 + Math.min(width, height) * 0.042 * settings.contourVariation) * material.amplitude
    const energy = saturate(analysis.energy / Math.max(1, energyMaximum))
    const globalAlpha = 0.38 + Math.sqrt(energy) * 0.62

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x
        const dx = x - analysis.centroid.x
        const dy = y - analysis.centroid.y
        const along = dx * analysis.axis.x + dy * analysis.axis.y
        const side = dx * analysis.normal.x + dy * analysis.normal.y
        const u = along / Math.max(4, analysis.lengthScale) + 0.5
        const v = side / Math.max(3, analysis.widthScale) + 0.5
        const coarse = continuousNoise3(u * 4.1, v * 4.1, progress * 0.24, settings.seed)
        const fine = continuousNoise3(u * 9.7 + 17.3, v * 8.9 - 5.1, progress * 0.36, settings.seed ^ 0xa53a9e11, 1)
        const edge = analysis.edge[pixel]
        const core = analysis.core[pixel]
        const signed = analysis.signedDistance[pixel]
        const fragment = analysis.fragmentMask[pixel] ? 1 : 0
        let shape = 0
        let materialDetail = 0
        let heat = 0
        let alphaSupport = 0

        if (settings.materialType === 'fire') {
          const fireAmplitude = amplitude * (0.35 + energy * 0.65)
          const flameCoarse = coarse
          const flameFine = fine
          const flowWarp = (flameCoarse - 0.5) * 0.9
            + (flameFine - 0.5) * 0.18
            + Math.sin((u * 1.3 + v * 0.4) * Math.PI) * 0.22
          const flowA = 1 - Math.abs(Math.sin((u * 3.2 - v * 0.45 + flowWarp - progress * 0.32) * Math.PI))
          const flowB = 1 - Math.abs(Math.sin((u * 11.4 + v * 1.3 + flameFine * 0.52 - progress * 0.27) * Math.PI))
          const flowRidge = saturate(smoothstep(0.36, 0.94, flowA) + smoothstep(0.92, 0.998, flowB) * 0.08)
          const directionalBias = saturate(0.6 - v + flameCoarse * 0.58)
          const displacement = fireAmplitude * ((flameCoarse - 0.46) * 1.42 + flowRidge * directionalBias * 1.05 + fragment * flowB * 0.5)
          const boundary = smoothstep(-0.92, 1.08, signed + displacement)
          const channelGate = signed > 1.2
            ? mix(0.18, 1, smoothstep(0.08, 0.55, flowA))
            : 1
          const outsideBand = smoothstep(-fireAmplitude * 3.05, -fireAmplitude * 0.28, signed)
            * (1 - smoothstep(-fireAmplitude * 0.22, 0.45, signed))
          const tongue = outsideBand * smoothstep(0.42, 0.9, flowRidge) * (0.34 + directionalBias * 0.66)
          const emberBand = smoothstep(-fireAmplitude * 4.15, -fireAmplitude * 1.45, signed)
            * (1 - smoothstep(-fireAmplitude * 1.12, -fireAmplitude * 0.56, signed))
          const emberGridU = u * 18
          const emberGridV = v * 15
          const emberCellX = Math.floor(emberGridU)
          const emberCellY = Math.floor(emberGridV)
          const emberLocalU = ((emberGridU % 1) + 1) % 1 - 0.5
          const emberLocalV = ((emberGridV % 1) + 1) % 1 - 0.5
          const emberCell = hash3(emberCellX, emberCellY, 0, settings.seed ^ 0x27d4eb2f)
          const emberDot = emberCell > 0.8
            ? 1 - smoothstep(0.12, 0.34, Math.hypot(emberLocalU, emberLocalV))
            : 0
          const ember = emberBand * Math.max(emberDot, smoothstep(0.76, 0.92, flameCoarse * 0.54 + flameFine * 0.46) * 0.3)
          shape = saturate(Math.max(boundary * channelGate, tongue, ember * (0.68 + fragment * 0.24)))
            * (0.55 + energy * 0.45)
          materialDetail = saturate(flowRidge * 0.62 + flameFine * 0.17 + tongue * 0.34 + ember * 0.28)
          heat = saturate(core * 0.24 + flowRidge * 0.62 + tongue * 0.2 + ember * 0.12)
          alphaSupport = smoothstep(0.13, 0.58, analysis.envelope[pixel])
            * (0.14 + energy * 0.1)
            * (0.95 + coarse * 0.05)
        } else if (settings.materialType === 'lightning') {
          const medialThickness = 0.8 + settings.styleStrength * 1.4 + energy * 0.7
          const medial = 1 - smoothstep(medialThickness, medialThickness + 2.8, analysis.distanceToMedial[pixel])
          const branchA = 1 - Math.abs(Math.sin((u * 6.8 + v * 2.4 + coarse * 3.2 - progress * 0.46) * Math.PI))
          const branchB = 1 - Math.abs(Math.sin((u * 4.5 - v * 6.9 + fine * 2.7 + progress * 0.38) * Math.PI))
          const branchPrimary = smoothstep(0.58, 0.92, branchA)
          const branchSecondary = smoothstep(0.66, 0.95, branchB) * smoothstep(0.4, 0.7, coarse)
          const branch = Math.max(branchPrimary, branchSecondary)
          const envelopeGate = smoothstep(-amplitude * 1.25, -amplitude * 0.15, signed)
          const interiorWeb = signed > 0 ? smoothstep(0.73, 0.95, 1 - Math.abs(fine * 2 - 1)) * 0.7 : 0
          const filament = Math.max(medial, branch * (0.82 + edge * 0.18), interiorWeb * 0.88)
          const glow = 1 - smoothstep(2.2 + settings.styleStrength * 1.7, 6.2 + settings.styleStrength * 2.2, analysis.distanceToMedial[pixel])
          shape = saturate(Math.max(filament, glow * 0.58) * envelopeGate)
          if (signed > amplitude * 1.35 && !fragment) shape *= 0.2
          const softEnvelopeSupport = smoothstep(0.07, 0.5, analysis.envelope[pixel])
          alphaSupport = softEnvelopeSupport * (0.054 + energy * 0.05) * (0.94 + coarse * 0.06)
          materialDetail = saturate(filament * 0.9 + branch * 0.38 + glow * 0.12)
          heat = saturate(Math.max(medial, branch * 0.96, interiorWeb * 1.12, core * 0.42))
        } else {
          const iceCoarse = coarse
          const cellX = Math.floor(u * 7.2)
          const cellY = Math.floor(v * 7.2)
          const cell = hash3(cellX, cellY, 0, settings.seed ^ 0x61c88647)
          const facetLineA = Math.abs(Math.sin((u * 6.1 + v * 2.9 + iceCoarse * 0.12) * Math.PI))
          const facetLineB = Math.abs(Math.sin((u * 2.75 - v * 7.4 + iceCoarse * 0.09) * Math.PI))
          const facetLineC = Math.abs(Math.sin((u * 8.65 - v * 4.35 + cell * 0.12) * Math.PI))
          const facetEdgeDistance = Math.min(facetLineA, facetLineB, facetLineC)
          const facetEdge = 1 - smoothstep(0.08, 0.28, facetEdgeDistance)
          const crack = smoothstep(0.035, 0.16 + settings.contourVariation * 0.045, facetEdgeDistance)
          const angle = Math.atan2(side, along)
          const angularStep = Math.sin(angle * 7 + Math.floor(u * 6) * 0.83 + cell * 1.4)
          const displacement = amplitude * ((cell - 0.5) * 1.48 + Math.sign(angularStep || 1) * 0.34 + (facetEdge - 0.5) * 0.28)
          const boundary = smoothstep(-0.7, 1.02, signed + displacement)
          const boundaryNotch = signed < amplitude * 1.1 && signed > -amplitude * 0.48
            && cell < 0.3 && facetEdge > 0.32
          const crystalVoid = signed > 1.1 && cell < 0.105 && facetEdgeDistance > 0.25
          const spikeBand = smoothstep(-amplitude * 3.05, -amplitude * 0.3, signed)
            * (1 - smoothstep(-amplitude * 0.22, 0.4, signed))
          const spikeRidge = 1 - Math.abs(Math.sin((u * 8.9 + v * 2.35 + cell * 0.63) * Math.PI))
          const spike = smoothstep(0.62, 0.95, spikeRidge) * spikeBand
          const facetedBody = boundary
            * (signed > 0.75 ? crack : 1)
            * (boundaryNotch || crystalVoid ? 0.02 : 1)
          shape = saturate(Math.max(facetedBody, spike * 0.92))
          materialDetail = saturate(facetEdge * 0.66 + iceCoarse * 0.17 + spike * 0.46)
          heat = saturate(core * 0.28 + facetEdge * 0.5 + spike * 0.42 + cell * 0.34)
          alphaSupport = smoothstep(0.11, 0.55, analysis.envelope[pixel])
            * (0.051 + energy * 0.041)
            * (0.95 + coarse * 0.05)
        }

        if (shape <= 0.008 && alphaSupport <= 0.008) continue
        const sampled = sampleMaterial(materialProfile, u * 1.41 + coarse * 0.17, v * 1.27 + fine * 0.13, progress, settings.seed)
        let color = mixColor(material.shadow, material.mid, saturate(shape * 0.72 + materialDetail * 0.32))
        color = mixColor(color, material.glow, saturate(heat * 0.62 + materialDetail * 0.2))
        color = mixColor(color, material.core, smoothstep(0.66, 1, heat))
        const sampleMix = settings.materialType === 'fire'
          ? settings.styleStrength * (0.08 + sampled.presence * 0.13)
          : settings.materialType === 'lightning'
            ? settings.styleStrength * (0.06 + sampled.presence * 0.12)
            : settings.styleStrength * (0.16 + sampled.presence * 0.22)
        color = mixColor(color, sampled.color, sampleMix)
        const textureGain = settings.materialType === 'lightning'
          ? 1.1 + fine * 0.22 + materialDetail * 0.2
          : 0.86 + fine * 0.22 + materialDetail * 0.15
        const lifecycleAlphaScale = settings.materialType === 'fire' ? 0.25 + energy * 0.75 : 1
        const alpha = saturate(Math.max(
          shape * globalAlpha * (0.76 + core * 0.18 + materialDetail * 0.18),
          alphaSupport,
        ) * lifecycleAlphaScale)
        const offset = pixel * 4
        output[offset] = clamp(Math.round(color[0] * textureGain), 0, 255)
        output[offset + 1] = clamp(Math.round(color[1] * textureGain), 0, 255)
        output[offset + 2] = clamp(Math.round(color[2] * textureGain), 0, 255)
        output[offset + 3] = clamp(Math.round(alpha * 255), 0, 255)
      }
    }
    const metrics = maskMetrics(analysis.rawMask, output, width, height)
    return {
      index: analysis.index,
      width,
      height,
      data: output,
      imageData: { width, height, data: output },
      pixelFormat: 'rgba8',
      alphaMode: 'straight',
      structure: {
        sourceFrameIndex: analysis.index,
        centroid: analysis.centroid,
        directionDeg: analysis.angle * 180 / Math.PI,
        bbox: analysis.bbox,
        occupancy: analysis.occupancy,
        energy,
        componentCount: analysis.components.length,
        fragmentCount: analysis.fragmentCount,
        macroIou: metrics.macroIou,
        exactMask: metrics.exactMask,
        outputOccupancy: metrics.outputOccupancy,
        outputCentroid: metrics.centroid,
      },
    }
  }

  function materialize(options = {}) {
    const materialType = String(options.materialType || '').trim().toLowerCase()
    if (!SUPPORTED_MATERIALS.includes(materialType)) {
      fail(ERROR_CODES.UNSUPPORTED_MATERIAL, `materialType must be one of: ${SUPPORTED_MATERIALS.join(', ')}.`, { materialType })
    }
    const templateFrames = readTemplateFrames(options.templateFrames)
    const materialFrame = readImageData(options.materialFrame || options.materialImage || options.aiMaterialFrame, 'materialFrame')
    const settings = Object.freeze({
      materialType,
      styleStrength: normalizeUnit(options.styleStrength, DEFAULTS.styleStrength),
      contourVariation: normalizeUnit(options.contourVariation, DEFAULTS.contourVariation),
      activeThreshold: clamp(options.activeThreshold ?? DEFAULTS.activeThreshold, 0.01, 0.5),
      seed: seedInteger(options.seed),
    })
    const analyses = templateFrames.map((frame, index) => analyzeTemplateFrame(frame, index, settings))
    stabilizeAxes(analyses)
    const energyMaximum = Math.max(1, ...analyses.map((analysis) => analysis.energy))
    const materialProfile = buildMaterialProfile(materialFrame, materialType)
    const frames = analyses.map((analysis) => materializeFrame(
      analysis,
      materialProfile,
      settings,
      energyMaximum,
      analyses.length,
    ))
    const outerAreaScale = OUTER_AREA_SCALE[materialType]
    frames.forEach((frame, index) => {
      const analysis = analyses[index]
      const calibration = calibrateOuterArea(
        frame,
        analysis,
        analysis.outerActivePixels * outerAreaScale,
        settings.seed ^ Math.imul(index + 1, 0x85ebca6b),
      )
      const metrics = maskMetrics(analysis.rawMask, frame.data, frame.width, frame.height)
      Object.assign(frame.structure, {
        macroIou: metrics.macroIou,
        exactMask: metrics.exactMask,
        outputOccupancy: metrics.outputOccupancy,
        outputCentroid: metrics.centroid,
        sourceOuterArea: analysis.outerActivePixels,
        targetOuterArea: calibration.targetArea,
        outputOuterArea: calibration.outputArea,
        candidateOuterArea: calibration.candidateArea,
        outerCutoffPriority: calibration.cutoffPriority,
      })
    })
    const exactStencilFrameRatio = frames.filter((frame) => frame.structure.exactMask).length / frames.length
    const macroOverlap = frames.map((frame) => frame.structure.macroIou)
    return Object.freeze({
      version: VERSION,
      frameCount: frames.length,
      frames: Object.freeze(frames),
      structure: Object.freeze({
        schemaVersion: VERSION,
        sourceMode: 'per-template-frame-structure-materialization',
        frameCount: frames.length,
        materialType,
        seed: settings.seed,
        styleStrength: settings.styleStrength,
        contourVariation: settings.contourVariation,
        featureChannels: FEATURE_CHANNELS,
        temporalNoise: 'canonical-coordinate-continuous-harmonic-noise-3d',
        macroConstraint: 'soft-signed-distance-envelope',
        outerAreaBudget: 'template-alpha-area-ranked-material-topology',
        outerAreaScale,
        highFrequencyTopology: `${materialType}-specific`,
        samePeakAffineReuse: false,
        uniformScaleOnly: false,
        exactStencilFrameRatio,
        minimumMacroIou: Math.min(...macroOverlap),
        meanMacroIou: macroOverlap.reduce((sum, value) => sum + value, 0) / macroOverlap.length,
        frames: Object.freeze(frames.map((frame) => Object.freeze({ ...frame.structure }))),
      }),
    })
  }

  return Object.freeze({
    version: VERSION,
    frameCountRange: Object.freeze({ minimum: MIN_FRAME_COUNT, maximum: MAX_FRAME_COUNT }),
    supportedMaterials: SUPPORTED_MATERIALS,
    outerAreaScales: OUTER_AREA_SCALE,
    featureChannels: FEATURE_CHANNELS,
    DEFAULTS,
    ERROR_CODES,
    AifxTemplateMaterializeError,
    analyzeTemplateFrame,
    materialize,
  })
})
