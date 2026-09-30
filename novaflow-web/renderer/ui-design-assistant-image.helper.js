(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowUiDesignAssistantImageHelper = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const VERSION = '20260722-ui-design-assistant-image-helper-1'
  const MAX_SIDE = 1536
  const TARGET_BLOB_BYTES = 1.5 * 1024 * 1024
  // The admin vision endpoint accepts 10 MiB of JSON. Six MiB of binary images
  // leaves room for base64 expansion, prompts and metadata, regardless of count.
  const TOTAL_BLOB_BYTES = 6 * 1024 * 1024
  const MIN_QUALITY = 0.58
  const OUTPUT_MIME = 'image/jpeg'

  function text(value) {
    return String(value == null ? '' : value).trim()
  }

  function scaledSize(width, height, maxSide) {
    const safeWidth = Math.max(1, Math.round(Number(width) || 1))
    const safeHeight = Math.max(1, Math.round(Number(height) || 1))
    const scale = Math.min(1, Math.max(1, Number(maxSide) || MAX_SIDE) / Math.max(safeWidth, safeHeight))
    return { width: Math.max(1, Math.round(safeWidth * scale)), height: Math.max(1, Math.round(safeHeight * scale)) }
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('参考图压缩失败'))
      }, mime, quality)
    })
  }

  function dataUrlFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const Reader = root?.FileReader
      if (typeof Reader !== 'function') {
        reject(new Error('当前环境不支持参考图编码'))
        return
      }
      const reader = new Reader()
      reader.onload = () => resolve(text(reader.result))
      reader.onerror = () => reject(reader.error || new Error('参考图编码失败'))
      reader.readAsDataURL(blob)
    })
  }

  async function loadDrawable(blob) {
    if (typeof root?.createImageBitmap === 'function') {
      const bitmap = await root.createImageBitmap(blob)
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() }
    }
    const ImageCtor = root?.Image
    const URLApi = root?.URL
    if (typeof ImageCtor !== 'function' || typeof URLApi?.createObjectURL !== 'function') {
      throw new Error('当前环境不支持参考图解码')
    }
    const objectUrl = URLApi.createObjectURL(blob)
    try {
      const image = new ImageCtor()
      image.decoding = 'async'
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('参考图解码超时')), 15000)
        image.onload = () => { clearTimeout(timer); resolve() }
        image.onerror = () => { clearTimeout(timer); reject(new Error('参考图解码失败')) }
        image.src = objectUrl
      })
      return {
        image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        release: () => URLApi.revokeObjectURL(objectUrl),
      }
    } catch (error) {
      URLApi.revokeObjectURL(objectUrl)
      throw error
    }
  }

  function drawToCanvas(image, width, height) {
    const documentRef = root?.document
    if (!documentRef?.createElement) throw new Error('当前环境不支持参考图画布')
    const canvas = documentRef.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width))
    canvas.height = Math.max(1, Math.round(height))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('参考图画布不可用')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  async function normalizeDataUrlForGrok(value, targetBytes = TARGET_BLOB_BYTES) {
    const dataUrl = text(value)
    if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(dataUrl)) {
      throw new Error('AI 助手只接受 PNG、JPEG 或 WebP 参考图')
    }
    if (typeof root?.fetch !== 'function') throw new Error('当前环境不支持参考图读取')
    const response = await root.fetch(dataUrl)
    const blob = await response.blob()
    const drawable = await loadDrawable(blob)
    try {
      const initialSize = scaledSize(drawable.width, drawable.height, MAX_SIDE)
      if (blob.size <= targetBytes && Math.max(drawable.width, drawable.height) <= MAX_SIDE) return dataUrl

      let size = initialSize
      let quality = 0.86
      let canvas = drawToCanvas(drawable.image, size.width, size.height)
      let bestBlob = null
      for (let index = 0; index < 9; index += 1) {
        const nextBlob = await canvasToBlob(canvas, OUTPUT_MIME, quality)
        if (!bestBlob || nextBlob.size < bestBlob.size) bestBlob = nextBlob
        if (nextBlob.size <= targetBytes) return await dataUrlFromBlob(nextBlob)
        if (quality > MIN_QUALITY) {
          quality = Math.max(MIN_QUALITY, quality - 0.12)
          continue
        }
        const nextMaxSide = Math.max(640, Math.round(Math.max(canvas.width, canvas.height) * 0.82))
        size = scaledSize(drawable.width, drawable.height, nextMaxSide)
        canvas = drawToCanvas(drawable.image, size.width, size.height)
        quality = 0.82
      }
      if (!bestBlob || bestBlob.size > targetBytes) throw new Error('参考图总大小超过分析接口容量，请缩小图片后重试；本次未丢弃图片。')
      return await dataUrlFromBlob(bestBlob)
    } finally {
      drawable.release?.()
    }
  }

  async function normalizeReferencesForGrok(values) {
    const references = Array.isArray(values) ? values : []
    const normalized = []
    const targetBytes = Math.min(TARGET_BLOB_BYTES, Math.floor(TOTAL_BLOB_BYTES / Math.max(1, references.length)))
    for (const reference of references) {
      const dataUrl = await normalizeDataUrlForGrok(reference?.dataUrl || reference?.imageUrl, targetBytes)
      normalized.push({ ...reference, dataUrl, imageUrl: dataUrl })
    }
    return normalized
  }

  return Object.freeze({
    VERSION,
    MAX_SIDE,
    TARGET_BLOB_BYTES,
    TOTAL_BLOB_BYTES,
    normalizeDataUrlForGrok,
    normalizeReferencesForGrok,
  })
})
