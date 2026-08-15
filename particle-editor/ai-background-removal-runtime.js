(function () {
  'use strict'

  const API_NAME = 'NovaFlowBackgroundRemoval'
  const VERSION = '20260428-black-rgb-vfx-1'

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)
  }

  function gaussianBlurFloatMap(source, width, height, radius) {
    const resolvedRadius = clamp(Number(radius) || 0, 0, 8)
    const total = width * height
    if (!resolvedRadius || total <= 0) return new Float32Array(source)
    const kernelRadius = Math.max(1, Math.ceil(resolvedRadius * 2))
    const sigma = Math.max(0.45, resolvedRadius * 0.72)
    const kernel = []
    let kernelSum = 0
    for (let i = -kernelRadius; i <= kernelRadius; i += 1) {
      const weight = Math.exp(-(i * i) / (2 * sigma * sigma))
      kernel.push(weight)
      kernelSum += weight
    }
    for (let i = 0; i < kernel.length; i += 1) kernel[i] /= kernelSum

    const temp = new Float32Array(total)
    const out = new Float32Array(total)
    for (let y = 0; y < height; y += 1) {
      const row = y * width
      for (let x = 0; x < width; x += 1) {
        let sum = 0
        for (let k = -kernelRadius; k <= kernelRadius; k += 1) {
          sum += (source[row + clamp(x + k, 0, width - 1)] || 0) * kernel[k + kernelRadius]
        }
        temp[row + x] = sum
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0
        for (let k = -kernelRadius; k <= kernelRadius; k += 1) {
          sum += (temp[clamp(y + k, 0, height - 1) * width + x] || 0) * kernel[k + kernelRadius]
        }
        out[y * width + x] = sum
      }
    }
    return out
  }

  function readAlphaStats(imageData) {
    const data = imageData && imageData.data
    const total = data ? data.length / 4 : 0
    let active = 0
    let mid = 0
    let hard = 0
    let blackHalo = 0
    let core = 0
    for (let offset = 0; data && offset < data.length; offset += 4) {
      const alpha = (data[offset + 3] || 0) / 255
      if (alpha <= 0.02) continue
      active += 1
      if (alpha > 0.1 && alpha < 0.92) mid += 1
      if (alpha >= 0.97 || alpha <= 0.04) hard += 1
      const maxRgb = Math.max(data[offset] || 0, data[offset + 1] || 0, data[offset + 2] || 0)
      const lum = ((data[offset] || 0) * 0.2126 + (data[offset + 1] || 0) * 0.7152 + (data[offset + 2] || 0) * 0.0722)
      if (alpha > 0.08 && alpha < 0.74 && maxRgb < 18 && lum < 16) blackHalo += 1
      if (alpha > 0.82 && maxRgb > 110) core += 1
    }
    const safeActive = Math.max(active, 1)
    return {
      active,
      activeCoverage: total ? active / total : 0,
      midAlphaRatio: mid / safeActive,
      hardAlphaRatio: hard / safeActive,
      blackHaloRatio: blackHalo / safeActive,
      coreCoverage: total ? core / total : 0,
    }
  }

  function removeMatteFromImageData(imageData, mode) {
    if (!imageData || !imageData.data) return { imageData, stats: readAlphaStats(imageData) }
    const edgeMode = mode === 'removeWhite' ? 'removeWhite' : 'removeBlack'
    const data = imageData.data
    for (let offset = 0; offset < data.length; offset += 4) {
      const alpha = data[offset + 3] || 0
      if (alpha < 4) {
        data[offset + 3] = 0
        continue
      }
      if (alpha <= 0 || alpha >= 255) continue
      const alphaRatio = alpha / 255
      for (let c = 0; c < 3; c += 1) {
        const value = data[offset + c] || 0
        const fixed = edgeMode === 'removeWhite'
          ? (value - 255 * (1 - alphaRatio)) / alphaRatio
          : value / alphaRatio
        data[offset + c] = clamp(Math.round(fixed), 0, 255)
      }
    }
    return { imageData, stats: readAlphaStats(imageData) }
  }

  function removeBlackBackgroundFromImageData(imageData, options) {
    if (!imageData || !imageData.data) return { imageData, stats: readAlphaStats(imageData) }
    const width = Math.max(1, Math.round(imageData.width || 1))
    const height = Math.max(1, Math.round(imageData.height || Math.max(1, imageData.data.length / 4 / width)))
    const threshold = clamp(Number(options && options.threshold) || 5, 0, 64)
    const range = clamp(Number(options && options.range) || 92, 12, 180)
    const blurRadius = clamp(Number(options && options.blurRadius) || 1.25, 0.25, 4)
    const glowRadius = clamp(Number(options && options.glowRadius) || 3.6, 1, 8)
    const total = width * height
    const alphaMap = new Float32Array(total)
    const glowMap = new Float32Array(total)
    const signalMap = new Float32Array(total)
    const data = imageData.data

    for (let pixel = 0, offset = 0; pixel < total && offset < data.length; pixel += 1, offset += 4) {
      const red = data[offset] || 0
      const green = data[offset + 1] || 0
      const blue = data[offset + 2] || 0
      const maxRgb = Math.max(red, green, blue)
      const minRgb = Math.min(red, green, blue)
      const chroma = maxRgb - minRgb
      const lum = red * 0.2126 + green * 0.7152 + blue * 0.0722
      const signal = Math.max(maxRgb, lum * 1.05 + chroma * 0.28, maxRgb * 0.82 + chroma * 0.52)
      let alpha = smoothstep(threshold, threshold + range, signal)
      if (maxRgb < 3 && chroma < 3) alpha = 0
      if (maxRgb > 215 && lum > 170) alpha = Math.max(alpha, 0.96)
      alphaMap[pixel] = Math.pow(alpha, 0.82)
      glowMap[pixel] = smoothstep(threshold + 4, threshold + range * 1.4, signal) * smoothstep(3, 255, maxRgb)
      signalMap[pixel] = signal
    }

    const softAlpha = gaussianBlurFloatMap(alphaMap, width, height, blurRadius)
    const glowAlpha = gaussianBlurFloatMap(glowMap, width, height, glowRadius)

    for (let pixel = 0, offset = 0; pixel < total && offset < data.length; pixel += 1, offset += 4) {
      const signal = signalMap[pixel] || 0
      const colorPresence = smoothstep(threshold, threshold + range * 0.7, signal)
      let alpha = Math.max(alphaMap[pixel] * 0.78, softAlpha[pixel] * 0.95)
      alpha = clamp((alpha + glowAlpha[pixel] * 0.08) * clamp(colorPresence * 1.18, 0, 1), 0, 1)
      if (signal <= threshold + 0.5 || alpha <= 0.006) {
        data[offset] = 0
        data[offset + 1] = 0
        data[offset + 2] = 0
        data[offset + 3] = 0
        continue
      }

      const divisor = clamp(alpha, 0.14, 1)
      data[offset] = clamp(Math.round((data[offset] || 0) / divisor), 0, 255)
      data[offset + 1] = clamp(Math.round((data[offset + 1] || 0) / divisor), 0, 255)
      data[offset + 2] = clamp(Math.round((data[offset + 2] || 0) / divisor), 0, 255)
      data[offset + 3] = clamp(Math.round(alpha * 255), 0, 255)
    }

    return { imageData, stats: readAlphaStats(imageData) }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Image load failed'))
      image.src = src
    })
  }

  async function removeBlackBackgroundDataUrl(dataUrl, options) {
    const image = await loadImage(dataUrl)
    const width = Math.max(1, image.naturalWidth || image.width || 1)
    const height = Math.max(1, image.naturalHeight || image.height || 1)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.fillStyle = 'rgb(0,0,0)'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)
    const result = removeBlackBackgroundFromImageData(imageData, options)
    ctx.putImageData(result.imageData || imageData, 0, 0)
    return { dataUrl: canvas.toDataURL('image/png'), stats: result.stats || readAlphaStats(imageData) }
  }

  async function unmultBlackBackgroundDataUrl(dataUrl) {
    const image = await loadImage(dataUrl)
    const width = Math.max(1, image.naturalWidth || image.width || 1)
    const height = Math.max(1, image.naturalHeight || image.height || 1)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.fillStyle = 'rgb(0,0,0)'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data
    for (let offset = 0; offset < data.length; offset += 4) {
      const sourceAlpha = (data[offset + 3] || 0) / 255
      const matteAlpha = Math.max(data[offset] || 0, data[offset + 1] || 0, data[offset + 2] || 0) / 255
      if (sourceAlpha <= 0 || matteAlpha <= 0) {
        data[offset] = 0
        data[offset + 1] = 0
        data[offset + 2] = 0
        data[offset + 3] = 0
        continue
      }
      data[offset] = clamp(Math.round(data[offset] / matteAlpha), 0, 255)
      data[offset + 1] = clamp(Math.round(data[offset + 1] / matteAlpha), 0, 255)
      data[offset + 2] = clamp(Math.round(data[offset + 2] / matteAlpha), 0, 255)
      data[offset + 3] = clamp(Math.round(sourceAlpha * matteAlpha * 255), 0, 255)
    }
    ctx.putImageData(imageData, 0, 0)
    return { dataUrl: canvas.toDataURL('image/png'), stats: readAlphaStats(imageData) }
  }

  window[API_NAME] = {
    version: VERSION,
    removeMatteFromImageData,
    removeBlackBackgroundFromImageData,
    removeBlackBackgroundDataUrl,
    unmultBlackBackgroundDataUrl,
    readAlphaStats,
  }
})()
