import type { ParticleSprite, ParticleSystemConfig } from '../types'
import { exportToSpine } from './SpineExporter'
import { getCanvas2DContext } from '../utils/canvas2d'

type ExportedImage = {
  fileName: string
  regionName: string
  dataUrl: string
  width: number
  height: number
}

function isSvgDataUrl(dataUrl: string) {
  const s = String(dataUrl || '')
  return s.startsWith('data:image/svg+xml')
}

async function rasterizeToPngDataUrl(dataUrl: string, width: number, height: number) {
  if (typeof (globalThis as any).document === 'undefined' || typeof (globalThis as any).Image !== 'function') return dataUrl
  if (!dataUrl || !isSvgDataUrl(dataUrl)) return dataUrl
  const w = Math.max(1, Math.round(width || 128))
  const h = Math.max(1, Math.round(height || 128))
  return new Promise<string>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = getCanvas2DContext(canvas)
        ctx.clearRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/png'))
      } catch (e: any) {
        reject(e)
      }
    }
    img.onerror = () => reject(new Error('SVG 光栅化失败'))
    img.src = dataUrl
  })
}

function makeSequenceFrameRegionName(sprite: ParticleSprite, frameIndex: number) {
  const base = (sprite.name || 'particle').trim() || 'particle'
  const idRaw = (sprite.id || '').trim()
  const id = idRaw ? idRaw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) : 'sp'
  const idx = String(Math.max(0, frameIndex)).padStart(4, '0')
  return `${base}_${id}_${idx}`
}

function makeSequenceAttachmentName(sprite: ParticleSprite) {
  const base = (sprite.name || 'particle').trim() || 'particle'
  const idRaw = (sprite.id || '').trim()
  const id = idRaw ? idRaw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) : 'sp'
  return `${base}_${id}_seq`
}

function sanitizeFileName(name: string) {
  const raw = (name || '').trim()
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    const code = raw.charCodeAt(i)
    if (code >= 0 && code <= 31) {
      out += '_'
      continue
    }
    if (ch === '<' || ch === '>' || ch === ':' || ch === '"' || ch === '/' || ch === '\\' || ch === '|' || ch === '?' || ch === '*') {
      out += '_'
      continue
    }
    out += ch
  }
  out = out.trim()
  return out.length ? out : 'particle'
}

async function loadImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  if (typeof (globalThis as any).Image === 'function') {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height })
      img.onerror = () => reject(new Error('贴图加载失败'))
      img.src = dataUrl
    })
  }

  const parseSvgSize = (svgText: string) => {
    const viewBox = svgText.match(/viewBox\s*=\s*['\"]([^'\"]+)['\"]/i)?.[1]
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map((x) => Number(x))
      if (parts.length >= 4 && parts.every((x) => Number.isFinite(x))) {
        const w = Math.abs(parts[2])
        const h = Math.abs(parts[3])
        if (w > 0 && h > 0) return { width: Math.round(w), height: Math.round(h) }
      }
    }
    const wAttr = svgText.match(/\bwidth\s*=\s*['\"]([^'\"]+)['\"]/i)?.[1]
    const hAttr = svgText.match(/\bheight\s*=\s*['\"]([^'\"]+)['\"]/i)?.[1]
    const toNum = (v?: string) => {
      if (!v) return NaN
      const m = String(v).match(/-?\d+(?:\.\d+)?/)
      return m ? Number(m[0]) : NaN
    }
    const w = toNum(wAttr)
    const h = toNum(hAttr)
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: Math.round(w), height: Math.round(h) }
    return { width: 128, height: 128 }
  }

  const parsePngSize = (buf: Uint8Array) => {
    if (buf.length < 24) throw new Error('PNG 数据不足')
    const sigOk = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    if (!sigOk) throw new Error('不是 PNG')
    const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19]
    const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23]
    return { width: Math.max(1, w >>> 0), height: Math.max(1, h >>> 0) }
  }

  const parseDataUrl = (url: string) => {
    const idx = url.indexOf(',')
    if (idx === -1) throw new Error('无效 dataUrl')
    const meta = url.slice(0, idx)
    const payload = url.slice(idx + 1)
    const mime = meta.split(':')[1]?.split(';')[0]?.trim().toLowerCase() || ''
    const isBase64 = /;base64/i.test(meta)
    return { mime, isBase64, payload }
  }

  try {
    const { mime, isBase64, payload } = parseDataUrl(dataUrl)
    if (mime.includes('svg')) {
      const text = isBase64
        ? Buffer.from(payload, 'base64').toString('utf8')
        : decodeURIComponent(payload)
      return parseSvgSize(text)
    }
    if (mime.includes('png')) {
      const buf = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'binary')
      return parsePngSize(buf)
    }
  } catch (e) {
    void e
  }

  return { width: 128, height: 128 }
}

function makeAtlas(images: ExportedImage[]) {
  const lines: string[] = []
  for (const img of images) {
    lines.push(img.fileName)
    lines.push(`size: ${img.width},${img.height}`)
    lines.push('format: RGBA8888')
    lines.push('filter: Linear,Linear')
    lines.push('repeat: none')
    lines.push(img.regionName)
    lines.push('  rotate: false')
    lines.push('  xy: 0, 0')
    lines.push(`  size: ${img.width}, ${img.height}`)
    lines.push(`  orig: ${img.width}, ${img.height}`)
    lines.push('  offset: 0, 0')
    lines.push('  index: -1')
    lines.push('')
  }
  return lines.join('\n')
}

async function createFallbackParticleDataUrl(size: number = 128) {
  if (typeof (globalThis as any).document === 'undefined') {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAgAB/6X2XQAAAABJRU5ErkJggg=='
  }
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = getCanvas2DContext(canvas)
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = 'rgba(255,255,255,1)'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size * 0.28, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2)
  ctx.fill()
  return canvas.toDataURL('image/png')
}

export async function exportSpinePackage(
  systems: ParticleSystemConfig[],
  version: string,
  opts?: { forceFullRate?: boolean; disablePooling?: boolean; explicitNativeSequenceAttachmentTimeline?: boolean }
) {
  const usedSprites: ParticleSprite[] = []
  for (const s of systems) {
    for (const sp of s.sprites || []) {
      if (sp) usedSprites.push(sp)
    }
  }

  const images: ExportedImage[] = []
  const usedNames = new Set<string>()
  const attachmentBases: Record<string, number> = {}

  if (usedSprites.length === 0) {
    const dataUrl = await createFallbackParticleDataUrl()
    const { width, height } = await loadImageSize(dataUrl)
    images.push({ fileName: 'particle.png', regionName: 'particle', dataUrl, width, height })
    attachmentBases['particle'] = Math.max(1, Math.round(Math.max(width, height)))
  } else {
    for (const sp of usedSprites) {
      if (sp.mode === 'sequence' && Array.isArray(sp.frames) && sp.frames.length > 0) {
        let seqBase = 0
        for (let i = 0; i < sp.frames.length; i++) {
          const frame = sp.frames[i]
          if (!frame?.dataUrl) continue
          const regionName = makeSequenceFrameRegionName(sp, i)
          if (usedNames.has(regionName)) continue
          usedNames.add(regionName)
          const fileName = `${sanitizeFileName(regionName)}.png`
          const { width, height } = await loadImageSize(frame.dataUrl)
          const dataUrl = await rasterizeToPngDataUrl(frame.dataUrl, width, height)
          images.push({ fileName, regionName, dataUrl, width, height })
          const base = Math.max(1, Math.round(Math.max(width, height)))
          attachmentBases[regionName] = base
          seqBase = Math.max(seqBase, base)
        }
        if (seqBase > 0) {
          attachmentBases[makeSequenceAttachmentName(sp)] = seqBase
        }
        continue
      }

      const regionName = sp.name || 'particle'
      if (usedNames.has(regionName)) continue
      usedNames.add(regionName)
      const fileName = `${sanitizeFileName(regionName)}.png`
      const { width, height } = await loadImageSize(sp.dataUrl)
      const dataUrl = await rasterizeToPngDataUrl(sp.dataUrl, width, height)
      images.push({ fileName, regionName, dataUrl, width, height })
      attachmentBases[regionName] = Math.max(1, Math.round(Math.max(width, height)))
    }
  }

  const json = exportToSpine(systems, version, {
    attachmentBases,
    forceFullRate: opts?.forceFullRate,
    disablePooling: opts?.disablePooling,
    explicitNativeSequenceAttachmentTimeline: opts?.explicitNativeSequenceAttachmentTimeline
  })
  const atlas = makeAtlas(images)
  return { json, atlas, images }
}
