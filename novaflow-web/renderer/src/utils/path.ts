import type { PathPoint } from '../types'
import type { Point } from './contour'

export const pointsToPathPoints = (pts: Point[]) => pts.map((p) => ({ x: p.x, y: p.y } as PathPoint))

export const pathPointsToSvgPath = (pts: PathPoint[], closed: boolean) => {
  const points = (pts || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  if (points.length === 0) return ''
  const fmt = (n: number) => {
    const v = Math.round(n * 1000) / 1000
    return String(v)
  }
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1]
    const p1 = points[i]
    const out = p0.out
    const inn = p1.in
    const hasC = !!(out || inn)
    if (!hasC) {
      d += ` L ${fmt(p1.x)} ${fmt(p1.y)}`
      continue
    }
    const c1x = p0.x + (out?.x || 0)
    const c1y = p0.y + (out?.y || 0)
    const c2x = p1.x + (inn?.x || 0)
    const c2y = p1.y + (inn?.y || 0)
    d += ` C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p1.x)} ${fmt(p1.y)}`
  }
  if (closed && points.length > 1) {
    const p0 = points[points.length - 1]
    const p1 = points[0]
    const out = p0.out
    const inn = p1.in
    const hasC = !!(out || inn)
    if (!hasC) {
      d += ` Z`
    } else {
      const c1x = p0.x + (out?.x || 0)
      const c1y = p0.y + (out?.y || 0)
      const c2x = p1.x + (inn?.x || 0)
      const c2y = p1.y + (inn?.y || 0)
      d += ` C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p1.x)} ${fmt(p1.y)} Z`
    }
  }
  return d
}

export const wrapSvg = (d: string, size: number) => {
  const s = Math.max(10, Math.floor(size))
  const half = s / 2
  const vb = `${-half} ${-half} ${s} ${s}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><path d="${d}" fill="none" stroke="black" stroke-width="2"/></svg>`
}

