import { getCanvas2DContext } from './canvas2d'

const loadImageFromDataUrl = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = dataUrl
  })

const clamp255 = (n: number) => Math.max(0, Math.min(255, n))

const boxBlur = (src: Uint8ClampedArray, w: number, h: number) => {
  const dst = new Uint8ClampedArray(src.length)
  const idx = (x: number, y: number) => (y * w + x) * 4
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let c = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const o = idx(nx, ny)
          r += src[o]
          g += src[o + 1]
          b += src[o + 2]
          a += src[o + 3]
          c++
        }
      }
      const o = idx(x, y)
      dst[o] = r / c
      dst[o + 1] = g / c
      dst[o + 2] = b / c
      dst[o + 3] = a / c
    }
  }
  return dst
}

export const enhanceImageDataUrl = async (dataUrl: string, options: {
  scale: number
  denoise: number
  sharpen: number
}) => {
  const img = await loadImageFromDataUrl(dataUrl)
  const inW = Math.max(1, Math.floor(img.naturalWidth || img.width || 1))
  const inH = Math.max(1, Math.floor(img.naturalHeight || img.height || 1))
  const scale = Math.max(1, Math.min(8, Number(options.scale) || 1))
  const outW = Math.max(1, Math.floor(inW * scale))
  const outH = Math.max(1, Math.floor(inH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ;(ctx as any).imageSmoothingEnabled = true
  ;(ctx as any).imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, outW, outH)
  ctx.drawImage(img, 0, 0, outW, outH)

  const denoise = Math.max(0, Math.min(1, Number(options.denoise) || 0))
  const sharpen = Math.max(0, Math.min(1, Number(options.sharpen) || 0))
  if (denoise <= 1e-6 && sharpen <= 1e-6) return canvas.toDataURL('image/png')

  const imgData = ctx.getImageData(0, 0, outW, outH)
  let src = imgData.data

  let blurred = src
  const blurPasses = denoise <= 1e-6 ? 0 : denoise < 0.35 ? 1 : denoise < 0.75 ? 2 : 3
  for (let i = 0; i < blurPasses; i++) {
    blurred = boxBlur(blurred, outW, outH)
  }

  if (sharpen > 1e-6) {
    const amount = 0.6 + 1.4 * sharpen
    const out = new Uint8ClampedArray(src.length)
    for (let i = 0; i < src.length; i += 4) {
      out[i] = clamp255(src[i] + amount * (src[i] - blurred[i]))
      out[i + 1] = clamp255(src[i + 1] + amount * (src[i + 1] - blurred[i + 1]))
      out[i + 2] = clamp255(src[i + 2] + amount * (src[i + 2] - blurred[i + 2]))
      out[i + 3] = src[i + 3]
    }
    src = out
  } else if (blurPasses > 0) {
    src = blurred
  }

  imgData.data.set(src)
  ctx.putImageData(imgData, 0, 0)
  return canvas.toDataURL('image/png')
}

export const resizeImageDataUrl = async (dataUrl: string, options: {
  maxSide: number
}) => {
  const img = await loadImageFromDataUrl(dataUrl)
  const inW = Math.max(1, Math.floor(img.naturalWidth || img.width || 1))
  const inH = Math.max(1, Math.floor(img.naturalHeight || img.height || 1))
  const maxSide = Math.max(1, Math.floor(Number(options.maxSide) || 0))
  if (!Number.isFinite(maxSide) || maxSide <= 0) return dataUrl
  const inMax = Math.max(inW, inH)
  if (inMax <= maxSide) return dataUrl
  const scale = maxSide / Math.max(1, inMax)
  const outW = Math.max(1, Math.round(inW * scale))
  const outH = Math.max(1, Math.round(inH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = getCanvas2DContext(canvas)
  ;(ctx as any).imageSmoothingEnabled = true
  ;(ctx as any).imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, outW, outH)
  ctx.drawImage(img, 0, 0, outW, outH)
  return canvas.toDataURL('image/png')
}
