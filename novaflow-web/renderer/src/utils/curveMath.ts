import type { Key1D } from '../types'

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export const hexToRgb = (hex: string) => {
  const h = String(hex || '').trim().replace('#', '')
  if (h.length !== 6) return { r: 255, g: 255, b: 255 }
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return { r: Number.isFinite(r) ? r : 255, g: Number.isFinite(g) ? g : 255, b: Number.isFinite(b) ? b : 255 }
}

export const toHex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
export const rgbToHex = (r: number, g: number, b: number) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const lerpHex = (a: string, b: string, t: number) => {
  const A = hexToRgb(a)
  const B = hexToRgb(b)
  return rgbToHex(lerp(A.r, B.r, t), lerp(A.g, B.g, t), lerp(A.b, B.b, t))
}

export const normalizeColorStops = (stops: any, fallback: string) => {
  const base = (Array.isArray(stops) ? stops : [])
    .map((s) => ({ t: clamp01(Number(s?.t ?? 0)), color: String(s?.color || fallback) }))
    .sort((a, b) => a.t - b.t)
  const first = base.find((s) => s.t <= 0 + 1e-6) || { t: 0, color: fallback }
  const last = base.find((s) => s.t >= 1 - 1e-6) || { t: 1, color: fallback }
  const mids = base.filter((s) => s.t > 1e-6 && s.t < 1 - 1e-6)
  return [{ t: 0, color: first.color }, ...mids, { t: 1, color: last.color }]
}

export const sampleColorStops = (stops: { t: number; color: string }[], t: number) => {
  const s = normalizeColorStops(stops, '#ffffff')
  const x = clamp01(t)
  let prev = s[0]
  for (let i = 1; i < s.length; i++) {
    const next = s[i]
    if (x <= next.t + 1e-9) {
      const span = Math.max(1e-9, next.t - prev.t)
      const lt = clamp01((x - prev.t) / span)
      return lerpHex(prev.color, next.color, lt)
    }
    prev = next
  }
  return s[s.length - 1].color
}

export const mergeStopsWithCurve = (prevStops: { t: number; color: string }[], curvePts: Key1D[], fallback: string) => {
  const prev = normalizeColorStops(prevStops, fallback)
  const sortedPts = (curvePts || [])
    .map((p) => ({ t: clamp01(Number(p?.t ?? 0)) }))
    .sort((a, b) => a.t - b.t)
  const ts = Array.from(new Set([0, ...sortedPts.map((p) => p.t), 1])).filter((t) => t >= 0 && t <= 1).sort((a, b) => a - b)
  const used = new Set<number>()
  const nextStops = ts.map((t) => {
    if (t <= 1e-6) return { t: 0, color: prev[0].color }
    if (t >= 1 - 1e-6) return { t: 1, color: prev[prev.length - 1].color }
    let bestIdx = -1
    let bestDist = Infinity
    for (let i = 1; i < prev.length - 1; i++) {
      if (used.has(i)) continue
      const d = Math.abs(prev[i].t - t)
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    if (bestIdx >= 0 && bestDist <= 0.06) {
      used.add(bestIdx)
      return { t, color: prev[bestIdx].color }
    }
    return { t, color: sampleColorStops(prev, t) }
  })
  return normalizeColorStops(nextStops, fallback)
}

export const normalizeKey1DCurve = (pts: Key1D[]) => {
  const clamped = (pts || []).map((p) => ({
    t: Math.max(0, Math.min(1, Number(p.t) || 0)),
    v: Math.max(0, Math.min(1, Number(p.v) || 0))
  }))
  const sorted = clamped.sort((a, b) => a.t - b.t)
  if (sorted.length === 0) return [{ t: 0, v: 1 }, { t: 1, v: 1 }]
  if (sorted.length === 1) return [{ t: 0, v: sorted[0].v }, { t: 1, v: sorted[0].v }]

  sorted[0] = { ...sorted[0], t: 0 }
  sorted[sorted.length - 1] = { ...sorted[sorted.length - 1], t: 1 }

  const eps = 1e-4
  const groups: { t: number; vs: number[] }[] = []
  for (const p of sorted) {
    const g = groups[groups.length - 1]
    if (!g || Math.abs(p.t - g.t) > eps) {
      groups.push({ t: p.t, vs: [p.v] })
    } else {
      g.vs.push(p.v)
    }
  }

  const out: Key1D[] = groups.map((g, idx) => {
    const t0 = g.t
    let v0 = g.vs[g.vs.length - 1]
    if (idx === 0) v0 = Math.min(...g.vs)
    if (idx === groups.length - 1) v0 = Math.max(...g.vs)
    return { t: t0, v: v0 }
  })

  if (out.length === 1) return [{ t: 0, v: out[0].v }, { t: 1, v: out[0].v }]
  out[0] = { ...out[0], t: 0 }
  out[out.length - 1] = { ...out[out.length - 1], t: 1 }
  return out
}

export const sampleKey1D = (curve: Key1D[] | undefined, t: number) => {
  const pts = (curve || []).map((p) => ({ t: Number(p.t) || 0, v: Number(p.v) || 0 })).sort((a, b) => a.t - b.t)
  if (pts.length === 0) return 1
  if (t <= pts[0].t) return pts[0].v
  if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (t >= a.t && t <= b.t) {
      const denom = b.t - a.t
      if (Math.abs(denom) < 1e-6) return b.v
      const r = (t - a.t) / denom
      return a.v + (b.v - a.v) * r
    }
  }
  return 1
}
