export type Point = { x: number; y: number }

const loadImageFromDataUrl = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = dataUrl
  })

const rdp = (pts: Point[], epsilon: number): Point[] => {
  if (pts.length <= 2) return pts
  const sq = (n: number) => n * n
  const distPointToSegSq = (p: Point, a: Point, b: Point) => {
    const vx = b.x - a.x
    const vy = b.y - a.y
    const wx = p.x - a.x
    const wy = p.y - a.y
    const c1 = vx * wx + vy * wy
    if (c1 <= 0) return sq(p.x - a.x) + sq(p.y - a.y)
    const c2 = vx * vx + vy * vy
    if (c2 <= c1) return sq(p.x - b.x) + sq(p.y - b.y)
    const t = c1 / c2
    const px = a.x + t * vx
    const py = a.y + t * vy
    return sq(p.x - px) + sq(p.y - py)
  }

  const epsSq = epsilon * epsilon
  let maxD = -1
  let idx = -1
  const a = pts[0]
  const b = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distPointToSegSq(pts[i], a, b)
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD <= epsSq || idx < 0) return [a, b]
  const left: Point[] = rdp(pts.slice(0, idx + 1), epsilon)
  const right: Point[] = rdp(pts.slice(idx), epsilon)
  return [...left.slice(0, -1), ...right]
}

const chaikin = (pts: Point[], iterations: number) => {
  let cur = pts
  const it = Math.max(0, Math.min(6, Math.floor(iterations)))
  for (let k = 0; k < it; k++) {
    const out: Point[] = []
    for (let i = 0; i < cur.length; i++) {
      const p0 = cur[i]
      const p1 = cur[(i + 1) % cur.length]
      const q: Point = { x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y }
      const r: Point = { x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y }
      out.push(q, r)
    }
    cur = out
  }
  return cur
}

const isBoundaryPixel = (mask: Uint8Array, w: number, h: number, x: number, y: number) => {
  if (x < 0 || y < 0 || x >= w || y >= h) return false
  const idx = y * w + x
  if (mask[idx] === 0) return false
  const n = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0]
  ]
  for (const [dx, dy] of n) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true
    if (mask[ny * w + nx] === 0) return true
  }
  return false
}

const traceSingleContour = (mask: Uint8Array, w: number, h: number) => {
  let sx = -1
  let sy = -1
  for (let y = 0; y < h && sy < 0; y++) {
    for (let x = 0; x < w; x++) {
      if (isBoundaryPixel(mask, w, h, x, y)) {
        sx = x
        sy = y
        break
      }
    }
  }
  if (sx < 0 || sy < 0) return [] as Point[]

  const dirs = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0]
  ]
  const dirIndex = (dx: number, dy: number) => {
    for (let i = 0; i < dirs.length; i++) {
      if (dirs[i][0] === dx && dirs[i][1] === dy) return i
    }
    return 0
  }

  let cx = sx
  let cy = sy
  let px = sx - 1
  let py = sy
  const startBackX = px
  const startBackY = py
  const out: Point[] = [{ x: cx + 0.5, y: cy + 0.5 }]

  const maxSteps = w * h * 4
  for (let steps = 0; steps < maxSteps; steps++) {
    const backDx = px - cx
    const backDy = py - cy
    const startIdx = (dirIndex(backDx, backDy) + 1) % 8
    let found = false
    let nx = cx
    let ny = cy
    let nbx = px
    let nby = py
    for (let k = 0; k < 8; k++) {
      const idx = (startIdx + k) % 8
      const dx = dirs[idx][0]
      const dy = dirs[idx][1]
      const tx = cx + dx
      const ty = cy + dy
      if (isBoundaryPixel(mask, w, h, tx, ty)) {
        nx = tx
        ny = ty
        const prevIdx = (idx + 7) % 8
        nbx = cx + dirs[prevIdx][0]
        nby = cy + dirs[prevIdx][1]
        found = true
        break
      }
    }
    if (!found) break
    px = nbx
    py = nby
    cx = nx
    cy = ny
    out.push({ x: cx + 0.5, y: cy + 0.5 })
    if (cx === sx && cy === sy && px === startBackX && py === startBackY) break
  }
  return out
}

export const contourToNormalizedPoints = async (dataUrl: string, options: {
  alphaThreshold: number
  smoothIterations: number
  simplifyEpsilon: number
  targetSize: number
}) => {
  const img = await loadImageFromDataUrl(dataUrl)
  const w = Math.max(1, Math.floor(img.naturalWidth || img.width || 1))
  const h = Math.max(1, Math.floor(img.naturalHeight || img.height || 1))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 不可用')
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0)
  const imgData = ctx.getImageData(0, 0, w, h)
  const alpha = imgData.data

  const thr = Math.max(0, Math.min(255, Math.floor(options.alphaThreshold)))
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha[(y * w + x) * 4 + 3]
      mask[y * w + x] = a >= thr ? 1 : 0
    }
  }

  let pts = traceSingleContour(mask, w, h)
  if (pts.length < 3) return [] as Point[]

  const smoothIt = Math.max(0, Math.min(6, Math.floor(options.smoothIterations)))
  if (smoothIt > 0) pts = chaikin(pts, smoothIt)

  const eps = Math.max(0, options.simplifyEpsilon)
  if (eps > 0) pts = rdp(pts, eps)

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const bw = Math.max(1e-6, maxX - minX)
  const bh = Math.max(1e-6, maxY - minY)
  const target = Math.max(10, options.targetSize)
  const s = target / Math.max(bw, bh)

  return pts.map((p) => ({ x: (p.x - cx) * s, y: (p.y - cy) * s }))
}
