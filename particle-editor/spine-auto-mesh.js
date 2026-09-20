/*
 * NovaFlow — 自动蒙皮 mesh builder.
 *
 * Port of the validated prototype: curvature-adaptive boundary, edge loops at
 * constant fractions of local thickness, detail-driven vertex density and a
 * detail-weighted CVT relaxation, then sliver repair.
 *
 * Triangles, not quads: at matched vertex counts the structured quad grid only
 * won on plain tubes and lost on the torso and face, because a grid must run
 * whole rows and cannot concentrate vertices on a local form.
 *
 * Input is raw RGBA; output is {vertices, triangles, hull} in image pixels with
 * the boundary vertices first, which is the order a Spine mesh attachment wants.
 */
(function (root, factory) {
  const api = factory(
    (typeof module === 'object' && module.exports)
      ? require('./spine-auto-mesh-core.js')
      : (root && root.NovaFlowAutoMeshCore)
  )
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAutoMesh = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict'

  const C = core || (typeof globalThis !== 'undefined' && globalThis.NovaFlowAutoMeshCore)

  const DEFAULTS = Object.freeze({
    density: 22,          // edge length = silhouette diagonal / density
    minEdge: 6,
    maxEdge: 90,
    loops: 2,             // edge loops between the outline and the medial axis
    margin: 0.42,
    dedupRatio: 0.40,
    lloydIters: 8,
    relax: 0.65,
    cornerDeg: 42,
    minRingGap: 0.45,
    detailGain: 3.0,
    rMinRatio: 0.40,
    sagittaRatio: 0.030,  // boundary deviation budget, in pixels not edge-fractions
    minSpaceRatio: 0.10,
    alphaThreshold: 8,
    keepFrac: 0.02,
    weldRatio: 0.22,   // relaxation can push two vertices together; weld before output
    // Grow the silhouette a little before tracing it. A hair tendril a couple of
    // pixels wide cannot be represented by a 35px edge, so a boundary that hugs
    // the alpha exactly visibly clips it; enclosing the shape instead costs only
    // transparent pixels and keeps the artwork inside the mesh.
    // Dilation used to be a fraction of the edge length (0.16), which on a normal
    // layer is 3px or more -- enough to round every concavity, so armpits and waists
    // came out bridged by a straight chord and the boundary sat up to 7px outside the
    // artwork. What it was really buying is the ~1px rim that the contour, the
    // simplification tolerance and the sliver trim each nibble off. So buy exactly
    // that: a fixed pixel, which cannot bridge anything wider than two.
    growRatio: 0,
    growPx: 1,
    // Structural lines of the painting (creases, limb edges, seams) become vertex
    // chains the triangulation keeps as edges, so the mesh bends along the form
    // instead of across it. The detail field alone only made vertices *denser* there.
    curves: true,
    curveSpacing: 0.85,    // vertex spacing along a line, in edge lengths
    curveSigma: 0.09,      // blur before the gradient, in edge lengths (never under 1px)
    curveMargin: 0.45,     // lines closer than this to the silhouette belong to the rim ring
    curveHigh: 0.60,       // hysteresis: a line must peak above this quantile of ridge strength...
    curveFloor: 0.20,      // ...and above this fraction of the layer's strong-edge reference,
    curveLowRatio: 0.4,    // ...and may run on while above this fraction of the high threshold
    curveMinLen: 1.5,      // shortest line worth a chain, in edge lengths
    curveBudget: 2.0       // at most this many curve vertices per uniform-lattice vertex
  })

  // -------------------------------------------------------------- helpers ---

  function makeRng(seed) {
    let s = seed >>> 0 || 1
    return () => {
      s ^= s << 13; s >>>= 0
      s ^= s >> 17
      s ^= s << 5; s >>>= 0
      return s / 4294967296
    }
  }

  function bbox(mask, w, h) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
    return { minX, minY, maxX, maxY, empty: minX === Infinity }
  }

  function polyArea(pts) {
    let a = 0
    const n = pts.length / 2
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      a += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1]
    }
    return Math.abs(a) / 2
  }

  /** Split segments longer than `h`, then drop points closer than `minSpace`. */
  function resampleRing(simplified, h, minSpace) {
    const n = simplified.length / 2
    if (n < 3) return null
    const pts = []
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const px = simplified[2 * i], py = simplified[2 * i + 1]
      const qx = simplified[2 * j], qy = simplified[2 * j + 1]
      pts.push(px, py)
      const L = Math.hypot(qx - px, qy - py)
      const k = Math.floor(L / h)
      for (let s = 1; s <= k; s++) {
        const t = s / (k + 1)
        pts.push(px + (qx - px) * t, py + (qy - py) * t)
      }
    }
    const keep = [pts[0], pts[1]]
    for (let i = 1; i < pts.length / 2; i++) {
      const x = pts[2 * i], y = pts[2 * i + 1]
      const lx = keep[keep.length - 2], ly = keep[keep.length - 1]
      if (Math.hypot(x - lx, y - ly) >= minSpace) keep.push(x, y)
    }
    if (keep.length >= 8 && Math.hypot(keep[0] - keep[keep.length - 2], keep[1] - keep[keep.length - 1]) < minSpace) {
      keep.length -= 2
    }
    return keep.length >= 6 ? Float64Array.from(keep) : null
  }

  /** Rings of a mask's contours with a pixel-sagitta budget (curvature-adaptive). */
  function maskRings(mask, w, h, edge, opts) {
    const o = opts || {}
    const sag = typeof o.sagitta === 'number' ? Math.max(o.sagitta, 0.35) : 0.18 * edge
    const minSpace = (typeof o.minRatio === 'number' ? o.minRatio : 0.32) * edge
    const minAreaPx = typeof o.minAreaPx === 'number' ? o.minAreaPx : null
    const areaRatio = typeof o.areaRatio === 'number' ? o.areaRatio : 0.02
    const phase = o.phase || 0
    const contours = C.traceContours(mask, w, h)
    const rings = []
    const polys = []
    let areaBig = null
    for (const c of contours) {
      if (c.length < 16) continue
      const s = C.dpSimplify(c, sag)
      if (s.length < 6) continue
      const a = polyArea(s)
      if (areaBig === null) areaBig = a
      if (minAreaPx !== null ? a < minAreaPx : a < areaRatio * areaBig) continue
      let ring = resampleRing(s, edge, minSpace)
      if (!ring) continue
      if (phase > 0) ring = shiftRing(ring, edge, phase)
      if (!ring || ring.length < 6) continue
      rings.push(ring)
      polys.push(C.dpSimplify(c, 0.10 * edge))
    }
    return { rings, polys }
  }

  /** Walk a closed ring and re-emit points offset by `phase*edge`, so adjacent loops stagger. */
  function shiftRing(ring, edge, phase) {
    const n = ring.length / 2
    const seg = new Float64Array(n)
    let total = 0
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      seg[i] = Math.hypot(ring[2 * j] - ring[2 * i], ring[2 * j + 1] - ring[2 * i + 1])
      total += seg[i]
    }
    if (total < 1e-6) return ring
    const out = []
    let t = phase * edge
    while (t < total) {
      let acc = 0, i = 0
      while (i < n - 1 && acc + seg[i] < t) { acc += seg[i]; i++ }
      const u = seg[i] > 1e-9 ? (t - acc) / seg[i] : 0
      const j = (i + 1) % n
      out.push(ring[2 * i] + (ring[2 * j] - ring[2 * i]) * u,
               ring[2 * i + 1] + (ring[2 * j + 1] - ring[2 * i + 1]) * u)
      t += edge
    }
    return out.length >= 6 ? Float64Array.from(out) : ring
  }

  /** rho = D / thickness at the nearest medial point: loop count stays constant along a limb. */
  function rhoField(mask, w, h, D, blur) {
    const Ds = C.gaussianBlur(D, w, h, blur)
    const ridge = new Uint8Array(w * h)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (!mask[i] || Ds[i] <= 0.9) continue
        let mx = -Infinity
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue
            const v = Ds[i + dy * w + dx]
            if (v > mx) mx = v
          }
        }
        if (Ds[i] >= mx - 0.75) ridge[i] = 1
      }
    }
    let any = false
    for (let i = 0; i < w * h; i++) if (ridge[i]) { any = true; break }
    if (!any) return null
    // nearest ridge site for every pixel, via the feature transform
    const ft = C.edt(ridge, w, h, { invert: true, feature: true })
    const rho = new Float64Array(w * h)
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) continue
      const site = ft.feature[i]
      const dl = Math.max(Ds[site], 1e-6)
      let v = Ds[i] / dl
      if (v > 1) v = 1
      rho[i] = v
    }
    return rho
  }

  /** Multi-scale gradient energy: high where the painting carries form information. */
  function detailField(rgba, w, h, mask, edge) {
    // The field is blurred at scale ~edge, so computing it at full resolution is
    // wasted work; drop to a grid where edge is a handful of pixels and expand back.
    const s = Math.max(1, Math.floor(edge / 7))
    const sw = Math.max(4, Math.floor(w / s)), sh = Math.max(4, Math.floor(h / s))
    const se = edge / s
    const lum = new Float64Array(sw * sh)
    const smask = new Uint8Array(sw * sh)
    for (let y = 0; y < sh; y++) {
      const sy = Math.min(h - 1, y * s)
      for (let x = 0; x < sw; x++) {
        const sx = Math.min(w - 1, x * s)
        const src = sy * w + sx
        const p = src * 4
        const a = rgba[p + 3] / 255
        lum[y * sw + x] = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]) * a
        smask[y * sw + x] = mask[src]
      }
    }
    let any = false
    for (let i = 0; i < sw * sh; i++) if (smask[i]) { any = true; break }
    if (!any) return new Float64Array(w * h)

    // push interior values outward so the silhouette edge is not read as detail
    const ft = C.edt(smask, sw, sh, { invert: true, feature: true })
    const filled = new Float64Array(sw * sh)
    for (let i = 0; i < sw * sh; i++) filled[i] = smask[i] ? lum[i] : lum[ft.feature[i]]

    const scales = [0.25, 0.6, 1.4]
    const acc = new Float64Array(sw * sh)
    const tmp = []
    for (const k of scales) {
      const sg = Math.max(1.0, k * se)
      const g = C.gaussianBlur(filled, sw, sh, sg)
      const { gx, gy } = C.sobel(g, sw, sh)
      tmp.length = 0
      const mag = new Float64Array(sw * sh)
      for (let i = 0; i < sw * sh; i++) {
        mag[i] = Math.hypot(gx[i], gy[i])
        if (smask[i]) tmp.push(mag[i])
      }
      if (!tmp.length) continue
      tmp.sort((a, b) => a - b)
      const ref = tmp[Math.min(tmp.length - 1, Math.floor(0.97 * tmp.length))]
      if (ref <= 1e-6) continue
      for (let i = 0; i < sw * sh; i++) {
        let v = mag[i] / ref
        if (v > 1) v = 1
        acc[i] += v
      }
    }
    for (let i = 0; i < sw * sh; i++) acc[i] /= scales.length
    const sm = C.gaussianBlur(acc, sw, sh, Math.max(1.0, 0.35 * se))
    const vals = []
    for (let i = 0; i < sw * sh; i++) if (smask[i]) vals.push(sm[i])
    vals.sort((a, b) => a - b)
    const ref = vals.length ? vals[Math.min(vals.length - 1, Math.floor(0.97 * vals.length))] : 0
    const small = new Float64Array(sw * sh)
    if (ref > 1e-6) {
      for (let i = 0; i < sw * sh; i++) {
        if (!smask[i]) continue
        let v = sm[i] / ref
        if (v > 1) v = 1
        small[i] = Math.pow(v, 0.75)
      }
    }
    if (s === 1 && sw === w && sh === h) return small
    const out = new Float64Array(w * h)
    for (let y = 0; y < h; y++) {
      const yy = Math.min(sh - 1, (y / s) | 0)
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue
        out[y * w + x] = small[yy * sw + Math.min(sw - 1, (x / s) | 0)]
      }
    }
    return out
  }

  /** Dart throwing whose rejection radius shrinks where the detail field is high. */
  function dartVariable(mask, w, h, D, radius, seeds, margin, edge, rng) {
    const cell = Math.max(2, radius.reduce ? 2 : 2)
    let rMin = Infinity
    for (let i = 0; i < w * h; i++) if (mask[i] && radius[i] < rMin) rMin = radius[i]
    const cellSize = Math.max(rMin, 2)
    const grid = new Map()
    const key = (gx, gy) => gx * 73856093 ^ gy * 19349663
    const put = (x, y) => {
      const gx = Math.floor(x / cellSize), gy = Math.floor(y / cellSize)
      const k = key(gx, gy)
      let arr = grid.get(k)
      if (!arr) { arr = []; grid.set(k, arr) }
      arr.push(x, y)
    }
    for (let i = 0; i < seeds.length; i += 2) put(seeds[i], seeds[i + 1])

    const cand = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (mask[i] && D[i] > margin * edge) cand.push(i)
      }
    }
    // smallest radius (highest detail) first, with a little jitter for ties
    cand.sort((a, b) => (radius[a] + rng() * 1e-3) - (radius[b] + rng() * 1e-3))
    const acc = []
    for (const i of cand) {
      const x = i % w, y = (i / w) | 0
      const r = radius[i]
      const gx = Math.floor(x / cellSize), gy = Math.floor(y / cellSize)
      const rad = Math.ceil(r / cellSize)
      let ok = true
      for (let jy = gy - rad; jy <= gy + rad && ok; jy++) {
        for (let jx = gx - rad; jx <= gx + rad && ok; jx++) {
          const arr = grid.get(key(jx, jy))
          if (!arr) continue
          for (let t = 0; t < arr.length; t += 2) {
            const ddx = arr[t] - x, ddy = arr[t + 1] - y
            if (ddx * ddx + ddy * ddy < r * r) { ok = false; break }
          }
        }
      }
      if (ok) { acc.push(x, y); put(x, y) }
    }
    return Float64Array.from(acc)
  }

  function globalDedup(groups, minDist) {
    const cellSize = Math.max(minDist, 1e-6)
    const grid = new Map()
    const key = (gx, gy) => gx * 73856093 ^ gy * 19349663
    const out = []
    const sizes = []
    for (const g of groups) {
      const before = out.length / 2
      for (let i = 0; i < g.length; i += 2) {
        const x = g[i], y = g[i + 1]
        const gx = Math.floor(x / cellSize), gy = Math.floor(y / cellSize)
        let ok = true
        for (let jy = gy - 1; jy <= gy + 1 && ok; jy++) {
          for (let jx = gx - 1; jx <= gx + 1 && ok; jx++) {
            const arr = grid.get(key(jx, jy))
            if (!arr) continue
            for (let t = 0; t < arr.length; t += 2) {
              const ddx = arr[t] - x, ddy = arr[t + 1] - y
              if (ddx * ddx + ddy * ddy < minDist * minDist) { ok = false; break }
            }
          }
        }
        if (ok) {
          out.push(x, y)
          const k = key(gx, gy)
          let arr = grid.get(k)
          if (!arr) { arr = []; grid.set(k, arr) }
          arr.push(x, y)
        }
      }
      sizes.push(out.length / 2 - before)
    }
    return { coords: Float64Array.from(out), sizes }
  }

  function cornerFlags(ring, angDeg) {
    const n = ring.length / 2
    const f = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const p = ((i - 1) + n) % n, q = (i + 1) % n
      const ux = ring[2 * i] - ring[2 * p], uy = ring[2 * i + 1] - ring[2 * p + 1]
      const vx = ring[2 * q] - ring[2 * i], vy = ring[2 * q + 1] - ring[2 * i + 1]
      const nu = Math.hypot(ux, uy), nv = Math.hypot(vx, vy)
      if (nu < 1e-9 || nv < 1e-9) continue
      let c = (ux * vx + uy * vy) / (nu * nv)
      c = c < -1 ? -1 : (c > 1 ? 1 : c)
      if ((Math.acos(c) * 180) / Math.PI > angDeg) f[i] = 1
    }
    return f
  }

  function projectPolyline(px, py, poly, open) {
    const n = poly.length / 2
    let bestD = Infinity, bx = px, by = py
    const segs = open ? n - 1 : n
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n
      const ax = poly[2 * i], ay = poly[2 * i + 1]
      const ex = poly[2 * j] - ax, ey = poly[2 * j + 1] - ay
      const L2 = ex * ex + ey * ey
      let t = L2 < 1e-12 ? 0 : ((px - ax) * ex + (py - ay) * ey) / L2
      t = t < 0 ? 0 : (t > 1 ? 1 : t)
      const cx = ax + t * ex, cy = ay + t * ey
      const d = (cx - px) * (cx - px) + (cy - py) * (cy - py)
      if (d < bestD) { bestD = d; bx = cx; by = cy }
    }
    return [bx, by]
  }

  function triMinAngle(coords, a, b, c) {
    const ax = coords[2 * a], ay = coords[2 * a + 1]
    const bx = coords[2 * b], by = coords[2 * b + 1]
    const cx = coords[2 * c], cy = coords[2 * c + 1]
    const L = [Math.hypot(bx - cx, by - cy), Math.hypot(ax - cx, ay - cy), Math.hypot(ax - bx, ay - by)]
    let mn = Infinity
    const P = [[ax, ay], [bx, by], [cx, cy]]
    for (let i = 0; i < 3; i++) {
      const p = P[i], q = P[(i + 1) % 3], r = P[(i + 2) % 3]
      const ux = q[0] - p[0], uy = q[1] - p[1]
      const vx = r[0] - p[0], vy = r[1] - p[1]
      const nu = Math.hypot(ux, uy), nv = Math.hypot(vx, vy)
      if (nu < 1e-12 || nv < 1e-12) return 0
      let cc = (ux * vx + uy * vy) / (nu * nv)
      cc = cc < -1 ? -1 : (cc > 1 ? 1 : cc)
      const ang = (Math.acos(cc) * 180) / Math.PI
      if (ang < mn) mn = ang
    }
    return mn === Infinity ? 0 : mn
  }

  function insideMask(coords, tri, t, mask, w, h) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2]
    const cx = (coords[2 * a] + coords[2 * b] + coords[2 * c]) / 3
    const cy = (coords[2 * a + 1] + coords[2 * b + 1] + coords[2 * c + 1]) / 3
    const ix = Math.round(cx), iy = Math.round(cy)
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return false
    return !!mask[iy * w + ix]
  }

  /** Resample an open polyline: keep both ends, split long segments, drop near-duplicates. */
  function resampleOpen(simplified, h, minSpace) {
    const n = simplified.length / 2
    if (n < 2) return null
    const pts = []
    for (let i = 0; i < n - 1; i++) {
      const px = simplified[2 * i], py = simplified[2 * i + 1]
      const qx = simplified[2 * i + 2], qy = simplified[2 * i + 3]
      pts.push(px, py)
      const L = Math.hypot(qx - px, qy - py)
      const k = Math.floor(L / h)
      for (let s = 1; s <= k; s++) {
        const t = s / (k + 1)
        pts.push(px + (qx - px) * t, py + (qy - py) * t)
      }
    }
    pts.push(simplified[2 * n - 2], simplified[2 * n - 1])
    const m = pts.length / 2
    const keep = [pts[0], pts[1]]
    for (let i = 1; i < m - 1; i++) {
      const x = pts[2 * i], y = pts[2 * i + 1]
      const lx = keep[keep.length - 2], ly = keep[keep.length - 1]
      if (Math.hypot(x - lx, y - ly) >= minSpace) keep.push(x, y)
    }
    // the far end is a real feature of the line; it wins over whatever it crowds
    const ex = pts[2 * m - 2], ey = pts[2 * m - 1]
    if (keep.length >= 4 && Math.hypot(ex - keep[keep.length - 2], ey - keep[keep.length - 1]) < minSpace) {
      keep[keep.length - 2] = ex; keep[keep.length - 1] = ey
    } else keep.push(ex, ey)
    return keep.length >= 4 ? Float64Array.from(keep) : null
  }

  /** Corners of an open polyline; both ends count, so they hold their ground. */
  function cornerFlagsOpen(pts, angDeg) {
    const n = pts.length / 2
    const f = new Uint8Array(n)
    if (n < 2) return f
    f[0] = 1; f[n - 1] = 1
    for (let i = 1; i < n - 1; i++) {
      const ux = pts[2 * i] - pts[2 * i - 2], uy = pts[2 * i + 1] - pts[2 * i - 1]
      const vx = pts[2 * i + 2] - pts[2 * i], vy = pts[2 * i + 3] - pts[2 * i + 1]
      const nu = Math.hypot(ux, uy), nv = Math.hypot(vx, vy)
      if (nu < 1e-9 || nv < 1e-9) continue
      let c = (ux * vx + uy * vy) / (nu * nv)
      c = c < -1 ? -1 : (c > 1 ? 1 : c)
      if ((Math.acos(c) * 180) / Math.PI > angDeg) f[i] = 1
    }
    return f
  }

  function rasterPolyline(pts, closed, out, w, h) {
    const n = pts.length / 2
    const segs = closed ? n : n - 1
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n
      const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * j], by = pts[2 * j + 1]
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)))
      for (let k = 0; k <= steps; k++) {
        const x = Math.round(ax + (bx - ax) * k / steps), y = Math.round(ay + (by - ay) * k / steps)
        if (x >= 0 && y >= 0 && x < w && y < h) out[y * w + x] = 1
      }
    }
  }

  /**
   * Gradient of the painting at a fixed pixel scale, with the silhouette's own edge
   * removed: interior colour is pushed outward first, so the alpha border reads as
   * flat and only painted transitions register. `ref` is the 97th percentile of the
   * magnitude inside the mask -- "a strong edge on this layer" -- for normalising.
   */
  function structureField(rgba, w, h, mask, sigma) {
    const lum = new Float64Array(w * h)
    for (let i = 0; i < w * h; i++) {
      const p = 4 * i
      lum[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]
    }
    const ft = C.edt(mask, w, h, { invert: true, feature: true })
    const filled = new Float64Array(w * h)
    for (let i = 0; i < w * h; i++) filled[i] = mask[i] ? lum[i] : lum[ft.feature[i]]
    const g = C.gaussianBlur(filled, w, h, sigma)
    const { gx, gy } = C.sobel(g, w, h)
    const mag = new Float64Array(w * h)
    const vals = []
    for (let i = 0; i < w * h; i++) {
      mag[i] = Math.hypot(gx[i], gy[i])
      if (mask[i]) vals.push(mag[i])
    }
    vals.sort((a, b) => a - b)
    const ref = vals.length ? vals[Math.min(vals.length - 1, Math.floor(0.97 * vals.length))] : 0
    return { mag, gx, gy, ref }
  }

  /** Link a thin edge map into pixel chains; a chain ends at a free end or a junction. */
  function linkChains(E, w, h) {
    const visited = new Uint8Array(w * h)
    const degree = (i) => {
      const x = i % w, y = (i / w) | 0
      let d = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          if (E[ny * w + nx]) d++
        }
      }
      return d
    }
    // the next unvisited pixel; a 4-neighbour beats a diagonal one (staircase
    // corners offer both), and two of a kind means a junction, where the chain ends
    const step = (i) => {
      const x = i % w, y = (i / w) | 0
      let four = -1, fours = 0, diag = -1, diags = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (!E[j] || visited[j]) continue
          if (dx && dy) { diag = j; diags++ } else { four = j; fours++ }
        }
      }
      if (fours === 1) return four
      if (!fours && diags === 1) return diag
      return -1
    }
    const follow = (from) => {
      const out = []
      let cur = from
      for (;;) {
        const nx = step(cur)
        if (nx < 0) break
        visited[nx] = 1
        out.push(nx)
        cur = nx
      }
      return out
    }
    const walk = (start) => {
      visited[start] = 1
      const fwd = follow(start)
      const bwd = follow(start)
      const seq = bwd.reverse().concat([start], fwd)
      const pts = []
      for (const i of seq) pts.push(i % w, (i / w) | 0)
      const n = seq.length
      const closed = n >= 16 && Math.abs(pts[0] - pts[2 * n - 2]) <= 1 && Math.abs(pts[1] - pts[2 * n - 1]) <= 1
      return { pts, closed }
    }
    const chains = []
    const ends = []
    for (let i = 0; i < w * h; i++) if (E[i] && degree(i) <= 1) ends.push(i)
    for (const i of ends) if (!visited[i]) chains.push(walk(i))
    for (let i = 0; i < w * h; i++) if (E[i] && !visited[i]) chains.push(walk(i))
    return chains
  }

  /**
   * Structural lines of the painting -- creases, limb edges, garment seams -- as
   * polylines. Canny-style: gradient ridges by non-maximum suppression, kept by
   * hysteresis, linked into chains, simplified on the outline's own sagitta budget
   * and resampled at `spacing`. Lines hugging the silhouette are left out (the rim
   * ring already has them), and a budget keeps texture from swamping the mesh.
   */
  function featureCurves(rgba, w, h, artMask, D, edge, sag, spacing, opt) {
    const s = Math.max(1, Math.floor(edge / 16))
    const sw = Math.max(4, Math.floor(w / s)), sh = Math.max(4, Math.floor(h / s))
    let px = rgba, smask = artMask, sD = D
    if (s > 1) {
      px = new Uint8ClampedArray(sw * sh * 4); smask = new Uint8Array(sw * sh); sD = new Float64Array(sw * sh)
      for (let y = 0; y < sh; y++) {
        const sy = Math.min(h - 1, y * s)
        for (let x = 0; x < sw; x++) {
          const sx = Math.min(w - 1, x * s)
          const src = sy * w + sx, dst = y * sw + x
          px[4 * dst] = rgba[4 * src]; px[4 * dst + 1] = rgba[4 * src + 1]
          px[4 * dst + 2] = rgba[4 * src + 2]; px[4 * dst + 3] = rgba[4 * src + 3]
          smask[dst] = artMask[src]; sD[dst] = D[src] / s
        }
      }
    }
    const F = structureField(px, sw, sh, smask, Math.max(1.0, opt.curveSigma * edge / s))
    if (!(F.ref > 1e-6)) return []
    const { mag, gx, gy } = F
    const rim = opt.curveMargin * edge / s
    const ridge = new Uint8Array(sw * sh)
    const rv = []
    for (let y = 1; y < sh - 1; y++) {
      for (let x = 1; x < sw - 1; x++) {
        const i = y * sw + x
        if (!smask[i] || sD[i] < rim) continue
        const m = mag[i]
        if (m < 0.05 * F.ref) continue
        const ax = Math.abs(gx[i]), ay = Math.abs(gy[i])
        let n1, n2
        if (ax >= 2.414 * ay) { n1 = i - 1; n2 = i + 1 }
        else if (ay >= 2.414 * ax) { n1 = i - sw; n2 = i + sw }
        else if ((gx[i] > 0) === (gy[i] > 0)) { n1 = i - sw - 1; n2 = i + sw + 1 }
        else { n1 = i - sw + 1; n2 = i + sw - 1 }
        if (m < mag[n1] || m < mag[n2]) continue
        ridge[i] = 1; rv.push(m)
      }
    }
    if (rv.length < 8) return []
    rv.sort((a, b) => a - b)
    const hi = Math.max(rv[Math.floor(opt.curveHigh * (rv.length - 1))], opt.curveFloor * F.ref)
    const lo = hi * opt.curveLowRatio
    const E = new Uint8Array(sw * sh)
    const stack = []
    for (let i = 0; i < sw * sh; i++) if (ridge[i] && mag[i] >= hi) { E[i] = 1; stack.push(i) }
    while (stack.length) {
      const i = stack.pop()
      const x = i % sw, y = (i / sw) | 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue
          const j = ny * sw + nx
          if (E[j] || !ridge[j] || mag[j] < lo) continue
          E[j] = 1; stack.push(j)
        }
      }
    }
    const chains = linkChains(E, sw, sh)
    if (typeof opt.curveDebug === 'function') opt.curveDebug({ ridge, E, chains, mag, ref: F.ref, hi, lo, s, sw, sh })
    const out = []
    for (const ch of chains) {
      const n = ch.pts.length / 2
      if (n < 3) continue
      const full = new Float64Array(n * 2)
      let len = 0, strength = 0
      for (let i = 0; i < n; i++) {
        full[2 * i] = ch.pts[2 * i] * s + (s - 1) / 2
        full[2 * i + 1] = ch.pts[2 * i + 1] * s + (s - 1) / 2
        strength += mag[ch.pts[2 * i + 1] * sw + ch.pts[2 * i]]
        if (i) len += Math.hypot(full[2 * i] - full[2 * i - 2], full[2 * i + 1] - full[2 * i - 1])
      }
      if (ch.closed) len += Math.hypot(full[0] - full[2 * n - 2], full[1] - full[2 * n - 1])
      if (len < opt.curveMinLen * edge) continue
      const simp = C.dpSimplify(full, sag)
      const minSpace = opt.minSpaceRatio * edge
      const pts = ch.closed ? resampleRing(simp, spacing, minSpace) : resampleOpen(simp, spacing, minSpace)
      if (!pts) continue
      out.push({ pts, poly: C.dpSimplify(full, 0.10 * edge), closed: ch.closed, weight: (strength / n / F.ref) * len })
    }
    out.sort((a, b) => b.weight - a.weight)
    let area = 0
    for (let i = 0; i < w * h; i++) if (artMask[i]) area++
    let budget = opt.curveBudget * area / (0.866 * edge * edge)
    const kept = []
    // A drawn crease is a dark line, and a line has two gradient ridges, one per
    // side. Two chains closer together than the mesh can resolve are one feature:
    // the stronger has already been taken, the other is dropped.
    const shadowed = (c) => {
      const n = c.pts.length / 2
      let near = 0
      for (let i = 0; i < n; i++) {
        const x = c.pts[2 * i], y = c.pts[2 * i + 1]
        for (const k of kept) {
          const p = projectPolyline(x, y, k.poly, !k.closed)
          if (Math.hypot(p[0] - x, p[1] - y) < 0.6 * spacing) { near++; break }
        }
      }
      return near > 0.5 * n
    }
    for (const c of out) {
      const n = c.pts.length / 2
      if (n > budget || shadowed(c)) continue
      budget -= n
      kept.push(c)
    }
    return kept
  }

  // ----------------------------------------------------------------- main ---

  function buildMesh(rgba, w, h, options) {
    const opt = Object.assign({}, DEFAULTS, options || {})
    let mask = C.alphaMask(rgba, w, h, opt.alphaThreshold)
    mask = C.fillHoles(mask, w, h)
    const lc = C.largestComponents(mask, w, h, opt.keepFrac)
    mask = lc.mask
    const bb = bbox(mask, w, h)
    if (bb.empty) return null
    const diag = Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY)
    const edge = Math.min(Math.max(diag / opt.density, opt.minEdge), opt.maxEdge)

    // the detail field must read the real artwork, so grow only the mesh domain
    const artMask = mask
    const grow = Math.max(0, opt.growRatio * edge, Number(opt.growPx) || 0)
    if (grow >= 0.5) {
      const away = C.edt(mask, w, h, { invert: true }).dist
      const grown = new Uint8Array(w * h)
      for (let i = 0; i < w * h; i++) grown[i] = (mask[i] || away[i] <= grow) ? 1 : 0
      mask = grown
    }
    const D = C.edt(mask, w, h, { borderBackground: true }).dist
    const rho = rhoField(mask, w, h, D, Math.max(0.8, edge * 0.10))
    const detail = detailField(rgba, w, h, artMask, edge)
    const radius = new Float64Array(w * h)
    const rMax = edge, rMin = Math.max(2, edge * opt.rMinRatio)
    const dens = new Float64Array(w * h)
    for (let i = 0; i < w * h; i++) {
      radius[i] = rMax - (rMax - rMin) * detail[i]
      dens[i] = mask[i] ? Math.pow(1 + opt.detailGain * detail[i], 2) : 1e-6
    }

    const sag = Math.max(0.8, opt.sagittaRatio * edge)
    const groups = []
    const polys = []
    const polyOpen = []
    const kinds = []

    const outer = maskRings(mask, w, h, edge, { sagitta: sag, minRatio: opt.minSpaceRatio })
    for (let i = 0; i < outer.rings.length; i++) {
      groups.push(outer.rings[i]); polys.push(outer.polys[i]); polyOpen.push(false); kinds.push('b')
    }
    const boundaryGroupCount = outer.rings.length
    if (!boundaryGroupCount) return null

    // The painting's own lines go in ahead of the generic loops: where the two
    // compete for the same ground, the crease the artist painted wins.
    const curveSpacing = Math.max(opt.minEdge * 0.6, opt.curveSpacing * edge)
    const curves = opt.curves ? featureCurves(rgba, w, h, artMask, D, edge, sag, curveSpacing, opt) : []
    let curveDist = null
    if (curves.length) {
      const cm = new Uint8Array(w * h)
      for (const c of curves) rasterPolyline(c.pts, c.closed, cm, w, h)
      curveDist = C.edt(cm, w, h, { invert: true }).dist
      for (const c of curves) { groups.push(c.pts); polys.push(c.poly); polyOpen.push(!c.closed); kinds.push('d') }
    }
    const offCurve = (ring) => {
      if (!curveDist) return ring
      const keep = []
      for (let i = 0; i < ring.length; i += 2) {
        const x = Math.round(ring[i]), y = Math.round(ring[i + 1])
        if (x >= 0 && y >= 0 && x < w && y < h && curveDist[y * w + x] < 0.5 * curveSpacing) continue
        keep.push(ring[i], ring[i + 1])
      }
      return keep.length >= 2 ? Float64Array.from(keep) : null
    }

    if (rho) {
      const thickAt = (m) => {
        let sum = 0, n = 0
        for (let i = 0; i < w * h; i++) if (m[i]) { sum += D[i]; n++ }
        return n ? sum / n : 0
      }
      for (let k = 1; k <= opt.loops; k++) {
        const lv = k / (opt.loops + 1)
        const sub = new Uint8Array(w * h)
        let cnt = 0
        for (let i = 0; i < w * h; i++) if (rho[i] > lv) { sub[i] = 1; cnt++ }
        if (cnt < 4) continue
        if (thickAt(sub) / (opt.loops + 1) < opt.minRingGap * edge) continue
        const r = maskRings(sub, w, h, edge, {
          sagitta: sag, minRatio: opt.minSpaceRatio,
          phase: k % 2 ? 0.5 : 0, minAreaPx: 0.30 * edge * edge
        })
        for (let i = 0; i < r.rings.length; i++) {
          const rg = offCurve(r.rings[i])
          if (rg) { groups.push(rg); polys.push(r.polys[i]); polyOpen.push(false); kinds.push('r') }
        }
      }
      const spine = new Uint8Array(w * h)
      let sc = 0
      for (let i = 0; i < w * h; i++) if (rho[i] > 0.86) { spine[i] = 1; sc++ }
      if (sc >= 4) {
        const r = maskRings(spine, w, h, edge, { sagitta: sag, minRatio: opt.minSpaceRatio, minAreaPx: 0 })
        for (let i = 0; i < r.rings.length; i++) {
          const rg = offCurve(r.rings[i])
          if (rg) { groups.push(rg); polys.push(r.polys[i]); polyOpen.push(false); kinds.push('r') }
        }
      }
    }

    const dd = globalDedup(groups, opt.dedupRatio * edge)
    const ringCoords = dd.coords
    const nRing = ringCoords.length / 2
    let nb = 0
    for (let i = 0; i < boundaryGroupCount; i++) nb += dd.sizes[i]

    const pin = new Uint8Array(nRing)
    const ownerPoly = new Int32Array(nRing).fill(-1)
    const ownerKind = new Array(nRing).fill('f')
    {
      let off = 0
      for (let gi = 0; gi < dd.sizes.length; gi++) {
        const cnt = dd.sizes[gi]
        if (!cnt) continue
        const slice = ringCoords.subarray(2 * off, 2 * (off + cnt))
        if (kinds[gi] === 'b' && cnt >= 3) {
          const cf = cornerFlags(slice, opt.cornerDeg)
          for (let i = 0; i < cnt; i++) pin[off + i] = cf[i]
        } else if (kinds[gi] === 'd' && cnt >= 2) {
          const cf = polyOpen[gi] ? cornerFlagsOpen(slice, opt.cornerDeg) : cornerFlags(slice, opt.cornerDeg)
          for (let i = 0; i < cnt; i++) pin[off + i] = cf[i]
        }
        for (let i = 0; i < cnt; i++) { ownerPoly[off + i] = gi; ownerKind[off + i] = kinds[gi] }
        off += cnt
      }
    }

    const rng = makeRng(13)
    if (curveDist) {
      // keep the fill out of each line's Gabriel corridor, so its segments survive as edges
      const cr = 0.71 * curveSpacing
      for (let i = 0; i < w * h; i++) if (mask[i] && curveDist[i] < cr && radius[i] < cr) radius[i] = cr
    }
    const fill = dartVariable(mask, w, h, D, radius, ringCoords, opt.margin, edge, rng)
    const coords = new Float64Array(ringCoords.length + fill.length)
    coords.set(ringCoords); coords.set(fill, ringCoords.length)
    const nPts = coords.length / 2
    if (nPts < 3) return null

    let { triangles, halfedges } = C.triangulate(coords)
    if (!triangles.length) return null

    // detail-weighted CVT: uniform relaxation would erase the density variation
    const inside = new Uint8Array(triangles.length / 3)
    const markInside = () => {
      for (let t = 0, k = 0; t < triangles.length; t += 3, k++) inside[k] = insideMask(coords, triangles, t, mask, w, h) ? 1 : 0
    }
    markInside()
    const num = new Float64Array(nPts * 2)
    const den = new Float64Array(nPts)
    for (let it = 0; it < opt.lloydIters; it++) {
      num.fill(0); den.fill(0)
      for (let t = 0, k = 0; t < triangles.length; t += 3, k++) {
        if (!inside[k]) continue
        const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2]
        const ax = coords[2 * a], ay = coords[2 * a + 1]
        const bx = coords[2 * b], by = coords[2 * b + 1]
        const cx = coords[2 * c], cy = coords[2 * c + 1]
        const area = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2
        if (area < 1e-12) continue
        const gx = (ax + bx + cx) / 3, gy = (ay + by + cy) / 3
        const ix = Math.round(gx), iy = Math.round(gy)
        const dsv = (ix >= 0 && iy >= 0 && ix < w && iy < h) ? dens[iy * w + ix] : 1
        const wgt = area * dsv
        for (const v of [a, b, c]) {
          num[2 * v] += gx * wgt; num[2 * v + 1] += gy * wgt; den[v] += wgt
        }
      }
      let moved = 0
      for (let v = 0; v < nPts; v++) {
        if (v < nRing && pin[v]) continue
        if (den[v] <= 1e-12) continue
        const tx = num[2 * v] / den[v], ty = num[2 * v + 1] / den[v]
        let nx = coords[2 * v] + opt.relax * (tx - coords[2 * v])
        let ny = coords[2 * v + 1] + opt.relax * (ty - coords[2 * v + 1])
        if (v < nRing && ownerKind[v] !== 'f') {
          const poly = polys[ownerPoly[v]]
          if (!poly || poly.length < 6) continue
          const p = projectPolyline(nx, ny, poly, polyOpen[ownerPoly[v]])
          nx = p[0]; ny = p[1]
        }
        const ix = Math.round(nx), iy = Math.round(ny)
        if (ix < 0 || iy < 0 || ix >= w || iy >= h || !mask[iy * w + ix]) continue
        coords[2 * v] = nx; coords[2 * v + 1] = ny
        moved++
      }
      if (!moved) break
      C.restoreDelaunay(coords, triangles, halfedges)
      markInside()
    }

    // targeted repair: move only the interior vertices sitting on poor triangles
    for (let pass = 0; pass < 4; pass++) {
      const badVert = new Uint8Array(nPts)
      let anyBad = false
      for (let t = 0, k = 0; t < triangles.length; t += 3, k++) {
        if (!inside[k]) continue
        if (triMinAngle(coords, triangles[t], triangles[t + 1], triangles[t + 2]) >= 18) continue
        for (let e = 0; e < 3; e++) { const v = triangles[t + e]; if (v >= nb) { badVert[v] = 1; anyBad = true } }
      }
      if (!anyBad) break
      const nbrSum = new Float64Array(nPts * 2)
      const nbrCnt = new Int32Array(nPts)
      for (let t = 0; t < triangles.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const v = triangles[t + e]
          if (!badVert[v]) continue
          for (let o = 1; o <= 2; o++) {
            const u = triangles[t + ((e + o) % 3)]
            nbrSum[2 * v] += coords[2 * u]; nbrSum[2 * v + 1] += coords[2 * u + 1]; nbrCnt[v]++
          }
        }
      }
      let moved = 0
      for (let v = 0; v < nPts; v++) {
        if (!badVert[v] || nbrCnt[v] < 3) continue
        if (v < nRing && pin[v]) continue
        const tx = nbrSum[2 * v] / nbrCnt[v], ty = nbrSum[2 * v + 1] / nbrCnt[v]
        // ring vertices are interior, so let them move off their loop here --
        // constraining them is what left slivers the relaxation could not clear
        const nx = coords[2 * v] + 0.5 * (tx - coords[2 * v])
        const ny = coords[2 * v + 1] + 0.5 * (ty - coords[2 * v + 1])
        const ix = Math.round(nx), iy = Math.round(ny)
        if (ix < 0 || iy < 0 || ix >= w || iy >= h || !mask[iy * w + ix]) continue
        coords[2 * v] = nx; coords[2 * v + 1] = ny; moved++
      }
      if (!moved) break
      C.restoreDelaunay(coords, triangles, halfedges)
      markInside()
    }

    // Relaxation can drive two vertices onto each other, which survives as a
    // sliver no amount of smoothing clears. Weld them, lowest index winning so
    // the boundary-first ordering is preserved.
    {
      const weld = opt.weldRatio * edge
      if (weld > 0) {
        const cellSize = Math.max(weld, 1e-6)
        const grid = new Map()
        const key = (gx, gy) => gx * 73856093 ^ gy * 19349663
        const alias = new Int32Array(nPts)
        for (let v = 0; v < nPts; v++) alias[v] = v
        for (let v = 0; v < nPts; v++) {
          const x = coords[2 * v], y = coords[2 * v + 1]
          const gx = Math.floor(x / cellSize), gy = Math.floor(y / cellSize)
          let hit = -1
          for (let jy = gy - 1; jy <= gy + 1 && hit < 0; jy++) {
            for (let jx = gx - 1; jx <= gx + 1 && hit < 0; jx++) {
              const arr = grid.get(key(jx, jy))
              if (!arr) continue
              for (const u of arr) {
                const dx = coords[2 * u] - x, dy = coords[2 * u + 1] - y
                if (dx * dx + dy * dy < weld * weld) { hit = u; break }
              }
            }
          }
          if (hit >= 0) { alias[v] = alias[hit]; continue }
          const k = key(gx, gy)
          let arr = grid.get(k)
          if (!arr) { arr = []; grid.set(k, arr) }
          arr.push(v)
        }
        for (let i = 0; i < triangles.length; i++) triangles[i] = alias[triangles[i]]
      }
    }

    // keep inside triangles
    let kept = []
    for (let t = 0, k = 0; t < triangles.length; t += 3, k++) {
      if (!inside[k]) continue
      const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2]
      if (a === b || b === c || a === c) continue
      const area = Math.abs((coords[2 * b] - coords[2 * a]) * (coords[2 * c + 1] - coords[2 * a + 1])
                          - (coords[2 * b + 1] - coords[2 * a + 1]) * (coords[2 * c] - coords[2 * a])) / 2
      if (area < 1e-4 * edge * edge) continue
      kept.push(a, b, c)
    }
    if (!kept.length) return null

    // Trim rim slivers: iteratively drop thin triangles that touch the boundary.
    // A thin triangle with no boundary edge is interior -- dropping that would
    // punch a hole. And a boundary sliver that still carries artwork has to stay:
    // dropping those is what used to clip the silhouette, which the old fix papered
    // over by dilating the whole mask -- and an isotropic dilation fills concavities,
    // so armpits and waists came out bridged by a straight chord.
    const coversArt = (a, b, c) => {
      const ax = coords[2 * a], ay = coords[2 * a + 1]
      const bx = coords[2 * b], by = coords[2 * b + 1]
      const cx = coords[2 * c], cy = coords[2 * c + 1]
      const gx = (ax + bx + cx) / 3, gy = (ay + by + cy) / 3
      const probes = [[gx, gy]]
      const mids = [[(ax + bx) / 2, (ay + by) / 2], [(bx + cx) / 2, (by + cy) / 2], [(cx + ax) / 2, (cy + ay) / 2]]
      for (const m of mids) probes.push([m[0] + (gx - m[0]) * 0.25, m[1] + (gy - m[1]) * 0.25])
      for (const pt of probes) {
        const px = Math.round(pt[0]), py = Math.round(pt[1])
        if (px < 0 || py < 0 || px >= w || py >= h) continue
        if (artMask[py * w + px]) return true
      }
      return false
    }
    for (let pass = 0; pass < 8; pass++) {
      const use = new Map()
      for (let t = 0; t < kept.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const u = kept[t + e], v = kept[t + (e + 1) % 3]
          const key = u < v ? u + ':' + v : v + ':' + u
          use.set(key, (use.get(key) || 0) + 1)
        }
      }
      const next = []
      let dropped = 0
      for (let t = 0; t < kept.length; t += 3) {
        const a = kept[t], b = kept[t + 1], c = kept[t + 2]
        let onBoundary = 0
        const pairs = [[a, b], [b, c], [c, a]]
        for (const pr of pairs) {
          const u = pr[0], v = pr[1]
          if (use.get(u < v ? u + ':' + v : v + ':' + u) === 1) onBoundary++
        }
        if (onBoundary > 0) {
          const ang = triMinAngle(coords, a, b, c)
          // a degenerate sliver carries no usable area and wrecks the weight solve,
          // so it goes whatever it overlaps; a merely thin one is spared when it is
          // still holding artwork, which is what keeps the silhouette from clipping
          if (ang < 3 || (ang < 9 && !coversArt(a, b, c))) { dropped++; continue }
        }
        next.push(a, b, c)
      }
      if (!dropped || !next.length) break
      kept = next
    }
    if (!kept.length) return null

    // compact, preserving boundary-first ordering
    const used = new Int32Array(nPts).fill(-1)
    for (const v of kept) used[v] = 1
    let outN = 0
    for (let v = 0; v < nPts; v++) if (used[v] === 1) used[v] = outN++
    const V = new Float64Array(outN * 2)
    for (let v = 0; v < nPts; v++) {
      if (used[v] < 0) continue
      V[2 * used[v]] = coords[2 * v]
      V[2 * used[v] + 1] = coords[2 * v + 1]
    }
    let hull = 0
    for (let v = 0; v < nb; v++) if (used[v] >= 0) hull++

    const T = new Int32Array(kept.length)
    for (let i = 0; i < kept.length; i += 3) {
      const a = used[kept[i]], b = used[kept[i + 1]], c = used[kept[i + 2]]
      // normalise to counter-clockwise
      const o = (V[2 * b] - V[2 * a]) * (V[2 * c + 1] - V[2 * a + 1])
              - (V[2 * b + 1] - V[2 * a + 1]) * (V[2 * c] - V[2 * a])
      if (o < 0) { T[i] = a; T[i + 1] = c; T[i + 2] = b }
      else { T[i] = a; T[i + 1] = b; T[i + 2] = c }
    }
    return { vertices: V, triangles: T, hull, edge, width: w, height: h, curves: curves.map((c) => c.pts) }
  }

  return { buildMesh, DEFAULTS, _internals: { rhoField, detailField, maskRings, globalDedup, projectPolyline, triMinAngle, structureField, featureCurves, linkChains, resampleOpen } }
})
