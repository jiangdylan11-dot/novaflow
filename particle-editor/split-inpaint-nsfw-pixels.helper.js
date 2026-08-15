(function (root, factory) {
  const api = factory()
  root.NovaFlowSplitInpaintNsfwPixels = api
  if (typeof module === 'object' && module && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function rgbaView(value) {
    const byteView = value instanceof Uint8Array || value instanceof Uint8ClampedArray
    let byteArray = Array.isArray(value)
    if (byteArray) {
      for (let index = 0; index < value.length; index += 1) {
        const item = value[index]
        if (
          !Object.prototype.hasOwnProperty.call(value, index)
          || !Number.isInteger(item)
          || item < 0
          || item > 255
        ) {
          byteArray = false
          break
        }
      }
    }
    if ((!byteView && !byteArray) || typeof value.length !== 'number' || value.length % 4 !== 0) {
      throw new Error('NSFW pixel helper requires complete byte RGBA pixels')
    }
    return value
  }

  function rgbaCopy(value) {
    return new Uint8ClampedArray(rgbaView(value))
  }

  function pixelCount(width, height) {
    const w = Number(width)
    const h = Number(height)
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
      throw new Error('NSFW pixel helper requires positive integer width and height')
    }
    return w * h
  }

  function matchingRgba(value, expectedLength) {
    const view = rgbaView(value)
    if (view.length !== expectedLength) throw new Error('NSFW pixel helper requires matching RGBA pixels')
    return view
  }

  function effectiveMaskValue(data, offset) {
    return Math.round(Math.max(data[offset], data[offset + 1], data[offset + 2]) * data[offset + 3] / 255)
  }

  function maskBounds(mask, width, height) {
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (effectiveMaskValue(mask, (y * width + x) * 4) <= 8) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    if (maxX < minX || maxY < minY) return null
    return {
      left: Math.max(0, minX - 1),
      top: Math.max(0, minY - 1),
      right: Math.min(width - 1, maxX + 1),
      bottom: Math.min(height - 1, maxY + 1),
    }
  }

  function safeGuideInterior(guide, width, height, x, y, alphaThreshold) {
    if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) return false
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if (guide[((y + oy) * width + x + ox) * 4 + 3] < alphaThreshold) return false
      }
    }
    return true
  }

  function removeWhiteMatteRgb(sourceRgba, maskRgba) {
    const pixels = rgbaCopy(sourceRgba)
    const mask = maskRgba == null ? null : rgbaView(maskRgba)
    if (mask && mask.length !== pixels.length) throw new Error('NSFW pixel helper requires matching RGBA mask pixels')
    let changedPixels = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (mask) {
        const maskValue = Math.round(Math.max(mask[i], mask[i + 1], mask[i + 2]) * mask[i + 3] / 255)
        if (maskValue <= 8) continue
      }
      const alpha = pixels[i + 3]
      if (alpha < 48 || alpha >= 250) continue
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      const luminance = (r + g + b) / 3
      const saturation = Math.max(r, g, b) - Math.min(r, g, b)
      if (luminance < 156 || saturation > 126) continue
      const amount = Math.max(0.01, alpha / 255)
      const whiteMatte = 255 * (1 - amount)
      if (Math.min(r, g, b) + 1 < whiteMatte) continue
      const nextR = Math.max(0, Math.min(255, (r - whiteMatte) / amount))
      const nextG = Math.max(0, Math.min(255, (g - whiteMatte) / amount))
      const nextB = Math.max(0, Math.min(255, (b - whiteMatte) / amount))
      const nextLuminance = (nextR + nextG + nextB) / 3
      const nextSaturation = Math.max(nextR, nextG, nextB) - Math.min(nextR, nextG, nextB)
      if (nextLuminance > 238 && nextSaturation < 28) continue
      const roundedR = Math.round(nextR)
      const roundedG = Math.round(nextG)
      const roundedB = Math.round(nextB)
      if (roundedR === r && roundedG === g && roundedB === b) continue
      pixels[i] = roundedR
      pixels[i + 1] = roundedG
      pixels[i + 2] = roundedB
      changedPixels += 1
    }
    return { pixels, changedPixels }
  }

  function blendSubjectJoinRgb(options) {
    const request = options && typeof options === 'object' ? options : {}
    const total = pixelCount(request.width, request.height)
    const width = Number(request.width)
    const height = Number(request.height)
    const expectedLength = total * 4
    const generated = matchingRgba(request.generatedRgba, expectedLength)
    const original = matchingRgba(request.originalRgba, expectedLength)
    const mask = matchingRgba(request.maskRgba, expectedLength)
    const guide = matchingRgba(request.subjectGuideRgba, expectedLength)
    const ringWidth = request.ringWidth == null ? 4 : Number(request.ringWidth)
    if (!Number.isInteger(ringWidth) || ringWidth < 2 || ringWidth > 32) {
      throw new Error('NSFW subject join ringWidth must be an integer from 2 to 32')
    }
    const guideAlphaThreshold = request.guideAlphaThreshold == null ? 128 : Number(request.guideAlphaThreshold)
    if (!Number.isFinite(guideAlphaThreshold) || guideAlphaThreshold < 1 || guideAlphaThreshold > 255) {
      throw new Error('NSFW subject join guideAlphaThreshold must be between 1 and 255')
    }
    const falloffExponent = request.falloffExponent == null ? 1 : Number(request.falloffExponent)
    if (!Number.isFinite(falloffExponent) || falloffExponent < 0.25 || falloffExponent > 2) {
      throw new Error('NSFW subject join falloffExponent must be between 0.25 and 2')
    }
    const restoreAlpha = request.restoreAlpha === true
    const pixels = new Uint8ClampedArray(generated)
    const bounds = maskBounds(mask, width, height)
    if (!bounds) return { pixels, changedPixels: 0, joinPixels: 0, alphaRaisedPixels: 0 }
    const roiWidth = bounds.right - bounds.left + 1
    const roiHeight = bounds.bottom - bounds.top + 1
    const far = ringWidth + 1
    const depth = new Uint8Array(roiWidth * roiHeight)
    for (let ry = 0; ry < roiHeight; ry += 1) {
      const y = bounds.top + ry
      for (let rx = 0; rx < roiWidth; rx += 1) {
        const x = bounds.left + rx
        if (effectiveMaskValue(mask, (y * width + x) * 4) <= 8) continue
        depth[ry * roiWidth + rx] = x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 1 : far
      }
    }
    for (let ry = 0; ry < roiHeight; ry += 1) {
      for (let rx = 0; rx < roiWidth; rx += 1) {
        const p = ry * roiWidth + rx
        let best = depth[p]
        if (!best) continue
        if (rx > 0) best = Math.min(best, depth[p - 1] + 1)
        if (ry > 0) {
          const north = p - roiWidth
          best = Math.min(best, depth[north] + 1)
          if (rx > 0) best = Math.min(best, depth[north - 1] + 1)
          if (rx + 1 < roiWidth) best = Math.min(best, depth[north + 1] + 1)
        }
        depth[p] = Math.min(far, best)
      }
    }
    for (let ry = roiHeight - 1; ry >= 0; ry -= 1) {
      for (let rx = roiWidth - 1; rx >= 0; rx -= 1) {
        const p = ry * roiWidth + rx
        let best = depth[p]
        if (!best) continue
        if (rx + 1 < roiWidth) best = Math.min(best, depth[p + 1] + 1)
        if (ry + 1 < roiHeight) {
          const south = p + roiWidth
          best = Math.min(best, depth[south] + 1)
          if (rx > 0) best = Math.min(best, depth[south - 1] + 1)
          if (rx + 1 < roiWidth) best = Math.min(best, depth[south + 1] + 1)
        }
        depth[p] = Math.min(far, best)
      }
    }
    let changedPixels = 0
    let joinPixels = 0
    let alphaRaisedPixels = 0
    for (let ry = 0; ry < roiHeight; ry += 1) {
      const y = bounds.top + ry
      for (let rx = 0; rx < roiWidth; rx += 1) {
        const x = bounds.left + rx
        const layer = depth[ry * roiWidth + rx]
        if (!layer || layer > ringWidth || !safeGuideInterior(guide, width, height, x, y, guideAlphaThreshold)) continue
        const i = (y * width + x) * 4
        if (generated[i + 3] <= 8 && !restoreAlpha) continue
        const maskValue = effectiveMaskValue(mask, i)
        const ringWeight = Math.pow((ringWidth - layer + 1) / (ringWidth + 1), falloffExponent)
        const weight = ringWeight * (maskValue / 255) * (guide[i + 3] / 255)
        if (weight <= 0) continue
        joinPixels += 1
        let changed = false
        const sourceAlpha = generated[i + 3]
        const transparentRgbWasCleared = restoreAlpha && sourceAlpha <= 1
        for (let channel = 0; channel < 3; channel += 1) {
          const generatedChannel = transparentRgbWasCleared ? original[i + channel] : generated[i + channel]
          const next = Math.round(generatedChannel * (1 - weight) + original[i + channel] * weight)
          if (next !== pixels[i + channel]) changed = true
          pixels[i + channel] = next
        }
        if (restoreAlpha) {
          const targetAlpha = Math.max(sourceAlpha, guide[i + 3])
          const nextAlpha = Math.round(sourceAlpha + (targetAlpha - sourceAlpha) * weight)
          if (nextAlpha > sourceAlpha) {
            pixels[i + 3] = nextAlpha
            alphaRaisedPixels += 1
            changed = true
          }
        }
        if (changed) changedPixels += 1
      }
    }
    return { pixels, changedPixels, joinPixels, alphaRaisedPixels }
  }

  return Object.freeze({
    removeWhiteMatteRgb,
    blendSubjectJoinRgb,
  })
})
