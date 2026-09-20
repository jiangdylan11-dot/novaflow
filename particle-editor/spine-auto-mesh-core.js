/*
 * NovaFlow — 自动蒙皮 geometry core.
 *
 * Dependency-free ports of the primitives the auto-mesh needs: exact Euclidean
 * distance transform with a feature transform, Moore contour tracing,
 * Douglas-Peucker, separable Gaussian/Sobel, and an incremental Delaunay
 * triangulation that supports edge-flip repair (so relaxation does not pay for a
 * full rebuild each iteration).
 *
 * Deliberately no OpenCV.js — see the healing-tool removal.
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAutoMeshCore = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const INF = 1e20

  // ---------------------------------------------------------------- masks ---

  function alphaMask(rgba, w, h, thr) {
    const t = typeof thr === 'number' ? thr : 8
    const m = new Uint8Array(w * h)
    for (let i = 0, p = 3; i < w * h; i++, p += 4) m[i] = rgba[p] > t ? 1 : 0
    return m
  }

  /** Flood the background from the border; anything unreached is an interior hole. */
  function fillHoles(mask, w, h) {
    const seen = new Uint8Array(w * h)
    const stack = new Int32Array(w * h)
    let sp = 0
    const push = (i) => { if (!mask[i] && !seen[i]) { seen[i] = 1; stack[sp++] = i } }
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
    while (sp > 0) {
      const i = stack[--sp]
      const x = i % w, y = (i / w) | 0
      if (x > 0) push(i - 1)
      if (x < w - 1) push(i + 1)
      if (y > 0) push(i - w)
      if (y < h - 1) push(i + w)
    }
    const out = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) out[i] = (mask[i] || !seen[i]) ? 1 : 0
    return out
  }

  /** 4-connected labelling; keeps components at least `keepFrac` of the largest. */
  function largestComponents(mask, w, h, keepFrac) {
    const kf = typeof keepFrac === 'number' ? keepFrac : 0.02
    const lab = new Int32Array(w * h)
    const stack = new Int32Array(w * h)
    const sizes = [0]
    let cur = 0
    for (let s = 0; s < w * h; s++) {
      if (!mask[s] || lab[s]) continue
      cur++
      let sp = 0, n = 0
      stack[sp++] = s; lab[s] = cur
      while (sp > 0) {
        const i = stack[--sp]; n++
        const x = i % w, y = (i / w) | 0
        if (x > 0 && mask[i - 1] && !lab[i - 1]) { lab[i - 1] = cur; stack[sp++] = i - 1 }
        if (x < w - 1 && mask[i + 1] && !lab[i + 1]) { lab[i + 1] = cur; stack[sp++] = i + 1 }
        if (y > 0 && mask[i - w] && !lab[i - w]) { lab[i - w] = cur; stack[sp++] = i - w }
        if (y < h - 1 && mask[i + w] && !lab[i + w]) { lab[i + w] = cur; stack[sp++] = i + w }
      }
      sizes.push(n)
    }
    if (cur === 0) return { mask, count: 0 }
    let mx = 0
    for (let i = 1; i <= cur; i++) if (sizes[i] > mx) mx = sizes[i]
    const keep = new Uint8Array(cur + 1)
    let kept = 0
    for (let i = 1; i <= cur; i++) if (sizes[i] >= kf * mx) { keep[i] = 1; kept++ }
    const out = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) out[i] = keep[lab[i]] ? 1 : 0
    return { mask: out, count: kept }
  }

  // ------------------------------------------------- distance transform ---

  /** 1-D squared EDT (Felzenszwalb & Huttenlocher), tracking the argmin site. */
  function edt1d(f, idx, n, outD, outI) {
    const v = new Int32Array(n)
    const z = new Float64Array(n + 1)
    let k = 0
    v[0] = 0; z[0] = -INF; z[1] = INF
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k] && k > 0) {
        k--
        s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++
      const d = q - v[k]
      outD[q] = d * d + f[v[k]]
      outI[q] = idx[v[k]]
    }
  }

  /**
   * Distance from every foreground pixel to the nearest background pixel.
   * `feature` (optional) receives the index of that nearest background pixel,
   * which is what the medial and detail fields use to fill outside values.
   */
  function edt(mask, w, h, opts) {
    const invert = !!(opts && opts.invert)
    const wantFeature = !!(opts && opts.feature)
    if (opts && opts.borderBackground) {
      // pad one ring of background so a shape touching the image edge still
      // reports its true depth, then crop back
      const pw = w + 2, ph = h + 2
      const pm = new Uint8Array(pw * ph)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) pm[(y + 1) * pw + (x + 1)] = mask[y * w + x]
      }
      const sub = edt(pm, pw, ph, { invert, feature: wantFeature })
      const D = new Float64Array(w * h)
      const F = wantFeature ? new Int32Array(w * h) : null
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const si = (y + 1) * pw + (x + 1)
          D[y * w + x] = sub.dist[si]
          if (F) {
            const f = sub.feature[si]
            const fy = Math.min(h - 1, Math.max(0, ((f / pw) | 0) - 1))
            const fx = Math.min(w - 1, Math.max(0, (f % pw) - 1))
            F[y * w + x] = fy * w + fx
          }
        }
      }
      return { dist: D, feature: F }
    }
    const f = new Float64Array(Math.max(w, h))
    const idx = new Int32Array(Math.max(w, h))
    const D = new Float64Array(w * h)
    const F = wantFeature ? new Int32Array(w * h) : null
    const td = new Float64Array(Math.max(w, h))
    const ti = new Int32Array(Math.max(w, h))

    // columns
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const on = invert ? !mask[y * w + x] : !!mask[y * w + x]
        f[y] = on ? INF : 0
        idx[y] = y * w + x
      }
      edt1d(f, idx, h, td, ti)
      for (let y = 0; y < h; y++) { D[y * w + x] = td[y]; if (F) F[y * w + x] = ti[y] }
    }
    // rows
    const rowF = new Int32Array(w)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) { f[x] = D[y * w + x]; idx[x] = F ? F[y * w + x] : y * w + x; rowF[x] = idx[x] }
      edt1d(f, idx, w, td, ti)
      for (let x = 0; x < w; x++) { D[y * w + x] = Math.sqrt(td[x]); if (F) F[y * w + x] = ti[x] }
    }
    return F ? { dist: D, feature: F } : { dist: D, feature: null }
  }

  // -------------------------------------------------------- convolution ---

  function gaussianKernel(sigma) {
    const s = Math.max(sigma, 1e-3)
    const r = Math.max(1, Math.ceil(s * 3))
    const k = new Float64Array(2 * r + 1)
    let sum = 0
    for (let i = -r; i <= r; i++) {
      const v = Math.exp(-(i * i) / (2 * s * s))
      k[i + r] = v; sum += v
    }
    for (let i = 0; i < k.length; i++) k[i] /= sum
    return { k, r }
  }

  function convolveSeparable(src, w, h, kx, rx, ky, ry) {
    const tmp = new Float64Array(w * h)
    const out = new Float64Array(w * h)
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let x = 0; x < w; x++) {
        let acc = 0
        for (let i = -rx; i <= rx; i++) {
          let xx = x + i
          if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1
          acc += src[row + xx] * kx[i + rx]
        }
        tmp[row + x] = acc
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let acc = 0
        for (let i = -ry; i <= ry; i++) {
          let yy = y + i
          if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1
          acc += tmp[yy * w + x] * ky[i + ry]
        }
        out[y * w + x] = acc
      }
    }
    return out
  }

  function gaussianBlur(src, w, h, sigma) {
    const { k, r } = gaussianKernel(sigma)
    return convolveSeparable(src, w, h, k, r, k, r)
  }

  function sobel(src, w, h) {
    const gx = new Float64Array(w * h)
    const gy = new Float64Array(w * h)
    const at = (x, y) => {
      const xx = x < 0 ? 0 : (x >= w ? w - 1 : x)
      const yy = y < 0 ? 0 : (y >= h ? h - 1 : y)
      return src[yy * w + xx]
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        gx[i] = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
              - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
        gy[i] = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
              - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
      }
    }
    return { gx, gy }
  }

  function binaryErode(mask, w, h, iters) {
    let cur = mask
    for (let t = 0; t < iters; t++) {
      const out = new Uint8Array(w * h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x
          if (!cur[i]) continue
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue
          if (cur[i - 1] && cur[i + 1] && cur[i - w] && cur[i + w]) out[i] = 1
        }
      }
      cur = out
    }
    return cur
  }

  // ---------------------------------------------------- contour tracing ---

  const N8 = [[-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1]]

  /** Moore-neighbourhood tracing; returns closed pixel rings, longest first. */
  function traceContours(mask, w, h) {
    const pw = w + 2, ph = h + 2
    const pad = new Uint8Array(pw * ph)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pad[(y + 1) * pw + (x + 1)] = mask[y * w + x]
    const visited = new Uint8Array(pw * ph)
    const out = []
    const guardMax = 4 * pw * ph
    for (let y = 1; y <= h; y++) {
      for (let x = 1; x <= w; x++) {
        const i = y * pw + x
        if (!pad[i] || pad[i - 1]) continue
        if (visited[i]) continue
        const contour = []
        let cy = y, cx = x, bdir = 6, guard = 0
        for (;;) {
          contour.push(cx - 1, cy - 1)
          visited[cy * pw + cx] = 1
          let found = false
          for (let s = 0; s < 8; s++) {
            const d = (bdir + 1 + s) % 8
            const ny = cy + N8[d][0], nx = cx + N8[d][1]
            if (ny < 0 || nx < 0 || ny >= ph || nx >= pw) continue
            if (pad[ny * pw + nx]) { bdir = (d + 5) % 8; cy = ny; cx = nx; found = true; break }
          }
          guard++
          if (!found || guard > guardMax) break
          if (cy === y && cx === x) break
        }
        if (contour.length >= 16) out.push(Float64Array.from(contour))
      }
    }
    out.sort((a, b) => b.length - a.length)
    return out
  }

  // ------------------------------------------------------------ polyline ---

  /** Douglas-Peucker on a flat [x0,y0,x1,y1,...] array; `eps` is a pixel sagitta. */
  function dpSimplify(pts, eps) {
    const n = pts.length / 2
    if (n < 3) return pts.slice()
    const keep = new Uint8Array(n)
    keep[0] = 1; keep[n - 1] = 1
    const stack = [[0, n - 1]]
    while (stack.length) {
      const [i, j] = stack.pop()
      if (j <= i + 1) continue
      const ax = pts[2 * i], ay = pts[2 * i + 1]
      const bx = pts[2 * j], by = pts[2 * j + 1]
      const ex = bx - ax, ey = by - ay
      const L = Math.hypot(ex, ey)
      let best = -1, bestD = -1
      for (let k = i + 1; k < j; k++) {
        const px = pts[2 * k] - ax, py = pts[2 * k + 1] - ay
        const d = L < 1e-9 ? Math.hypot(px, py) : Math.abs(ex * py - ey * px) / L
        if (d > bestD) { bestD = d; best = k }
      }
      if (bestD > eps && best > 0) {
        keep[best] = 1
        stack.push([i, best], [best, j])
      }
    }
    const out = []
    for (let k = 0; k < n; k++) if (keep[k]) out.push(pts[2 * k], pts[2 * k + 1])
    return Float64Array.from(out)
  }

  // ----------------------------------------------------------- Delaunay ---

  function inCircle(ax, ay, bx, by, cx, cy, px, py) {
    const adx = ax - px, ady = ay - py
    const bdx = bx - px, bdy = by - py
    const cdx = cx - px, cdy = cy - py
    const ab = adx * bdy - bdx * ady
    const bc = bdx * cdy - cdx * bdy
    const ca = cdx * ady - adx * cdy
    const alift = adx * adx + ady * ady
    const blift = bdx * bdx + bdy * bdy
    const clift = cdx * cdx + cdy * cdy
    return alift * bc + blift * ca + clift * ab
  }

  function orient2d(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  }

  /**
   * Incremental Delaunay (Bowyer-Watson) over a flat coordinate array.
   * Keeps half-edge adjacency so `restore` can repair the triangulation with
   * edge flips after the relaxation moves points, instead of rebuilding.
   */
  function triangulate(coords) {
    const n = coords.length / 2
    if (n < 3) return { triangles: new Int32Array(0), halfedges: new Int32Array(0) }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < n; i++) {
      const x = coords[2 * i], y = coords[2 * i + 1]
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    const dx = maxX - minX, dy = maxY - minY
    const dmax = Math.max(dx, dy, 1)
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    // super triangle vertices appended after the real points
    const pts = new Float64Array(2 * (n + 3))
    pts.set(coords.subarray(0, 2 * n))
    pts[2 * n] = cx - 20 * dmax; pts[2 * n + 1] = cy - dmax
    pts[2 * n + 2] = cx; pts[2 * n + 3] = cy + 20 * dmax
    pts[2 * n + 4] = cx + 20 * dmax; pts[2 * n + 5] = cy - dmax

    let tri = [n, n + 1, n + 2]
    let half = [-1, -1, -1]

    const bad = []
    const polyEdge = []
    const polyHalf = []
    for (let p = 0; p < n; p++) {
      const px = pts[2 * p], py = pts[2 * p + 1]
      bad.length = 0
      for (let t = 0; t < tri.length; t += 3) {
        const a = tri[t], b = tri[t + 1], c = tri[t + 2]
        if (a < 0) continue
        let d = inCircle(pts[2 * a], pts[2 * a + 1], pts[2 * b], pts[2 * b + 1],
                         pts[2 * c], pts[2 * c + 1], px, py)
        if (orient2d(pts[2 * a], pts[2 * a + 1], pts[2 * b], pts[2 * b + 1], pts[2 * c], pts[2 * c + 1]) < 0) d = -d
        if (d > 0) bad.push(t)
      }
      if (!bad.length) continue
      const isBad = new Set(bad)
      polyEdge.length = 0; polyHalf.length = 0
      for (let bi = 0; bi < bad.length; bi++) {
        const t = bad[bi]
        for (let e = 0; e < 3; e++) {
          const opp = half[t + e]
          if (opp === -1 || !isBad.has(opp - (opp % 3))) {
            polyEdge.push(tri[t + e], tri[t + (e + 1) % 3])
            polyHalf.push(opp)
          }
        }
      }
      // remove bad triangles (mark then compact)
      for (const t of bad) { tri[t] = -1 }
      const newTri = []
      const newHalf = []
      const remap = new Int32Array(tri.length).fill(-1)
      for (let t = 0; t < tri.length; t += 3) {
        if (tri[t] === -1) continue
        remap[t] = newTri.length
        newTri.push(tri[t], tri[t + 1], tri[t + 2])
        newHalf.push(half[t], half[t + 1], half[t + 2])
      }
      for (let i = 0; i < newHalf.length; i++) {
        const o = newHalf[i]
        newHalf[i] = o === -1 ? -1 : remap[o - (o % 3)] + (o % 3)
      }
      for (let i = 0; i < polyHalf.length; i++) {
        const o = polyHalf[i]
        polyHalf[i] = o === -1 ? -1 : remap[o - (o % 3)] + (o % 3)
      }
      tri = newTri; half = newHalf
      // fan the cavity to the new point
      const start = tri.length
      for (let i = 0; i < polyEdge.length / 2; i++) {
        const a = polyEdge[2 * i], b = polyEdge[2 * i + 1]
        tri.push(a, b, p)
        half.push(polyHalf[i], -1, -1)
        const t = start + 3 * i
        if (polyHalf[i] !== -1) half[polyHalf[i]] = t
      }
      // stitch the fan's internal edges
      const m = polyEdge.length / 2
      for (let i = 0; i < m; i++) {
        const ti = start + 3 * i
        const ai = tri[ti], bi = tri[ti + 1]
        for (let j = 0; j < m; j++) {
          if (i === j) continue
          const tj = start + 3 * j
          const aj = tri[tj], bj = tri[tj + 1]
          if (bi === aj) { half[ti + 1] = tj + 2; half[tj + 2] = ti + 1 }
          if (ai === bj) { half[ti + 2] = tj + 1; half[tj + 1] = ti + 2 }
        }
      }
    }
    // drop triangles touching the super triangle
    const outT = []
    const idxMap = new Int32Array(tri.length).fill(-1)
    for (let t = 0; t < tri.length; t += 3) {
      if (tri[t] >= n || tri[t + 1] >= n || tri[t + 2] >= n) continue
      idxMap[t] = outT.length
      outT.push(tri[t], tri[t + 1], tri[t + 2])
    }
    const outH = new Int32Array(outT.length).fill(-1)
    for (let t = 0; t < tri.length; t += 3) {
      if (idxMap[t] === -1) continue
      for (let e = 0; e < 3; e++) {
        const o = half[t + e]
        if (o === -1) continue
        const ot = o - (o % 3)
        if (idxMap[ot] === -1) continue
        outH[idxMap[t] + e] = idxMap[ot] + (o % 3)
      }
    }
    return { triangles: Int32Array.from(outT), halfedges: outH }
  }

  /** Restore the Delaunay property by flipping edges after points have moved. */
  function restoreDelaunay(coords, triangles, halfedges, maxPasses) {
    const passes = maxPasses || 12
    for (let pass = 0; pass < passes; pass++) {
      let flips = 0
      for (let e = 0; e < triangles.length; e++) {
        const o = halfedges[e]
        if (o === -1) continue
        if (o < e) continue
        const t = e - (e % 3), ot = o - (o % 3)
        const a = triangles[t + (e % 3)]
        const b = triangles[t + ((e % 3) + 1) % 3]
        const c = triangles[t + ((e % 3) + 2) % 3]
        const d = triangles[ot + ((o % 3) + 2) % 3]
        let det = inCircle(coords[2 * a], coords[2 * a + 1], coords[2 * b], coords[2 * b + 1],
                           coords[2 * c], coords[2 * c + 1], coords[2 * d], coords[2 * d + 1])
        if (orient2d(coords[2 * a], coords[2 * a + 1], coords[2 * b], coords[2 * b + 1],
                     coords[2 * c], coords[2 * c + 1]) < 0) det = -det
        if (det <= 1e-12) continue
        // the flipped pair must stay convex, else the flip inverts a triangle
        if (orient2d(coords[2 * d], coords[2 * d + 1], coords[2 * c], coords[2 * c + 1],
                     coords[2 * a], coords[2 * a + 1]) <= 0) continue
        if (orient2d(coords[2 * c], coords[2 * c + 1], coords[2 * d], coords[2 * d + 1],
                     coords[2 * b], coords[2 * b + 1]) <= 0) continue
        flipEdge(triangles, halfedges, e, o)
        flips++
      }
      if (!flips) break
    }
    return { triangles, halfedges }
  }

  function flipEdge(tri, half, e, o) {
    const t = e - (e % 3), ot = o - (o % 3)
    const e0 = e % 3, o0 = o % 3
    const a = tri[t + e0], b = tri[t + (e0 + 1) % 3], c = tri[t + (e0 + 2) % 3]
    const d = tri[ot + (o0 + 2) % 3]
    const hA = half[t + (e0 + 1) % 3]
    const hB = half[t + (e0 + 2) % 3]
    const hC = half[ot + (o0 + 1) % 3]
    const hD = half[ot + (o0 + 2) % 3]
    tri[t] = c; tri[t + 1] = a; tri[t + 2] = d
    tri[ot] = d; tri[ot + 1] = b; tri[ot + 2] = c
    const setH = (i, v) => { half[i] = v; if (v !== -1) half[v] = i }
    setH(t, hB)
    setH(t + 1, hC)
    setH(t + 2, ot + 2)
    setH(ot, hD)
    setH(ot + 1, hA)
    half[ot + 2] = t + 2
  }

  return {
    INF,
    alphaMask,
    fillHoles,
    largestComponents,
    edt,
    gaussianBlur,
    gaussianKernel,
    convolveSeparable,
    sobel,
    binaryErode,
    traceContours,
    dpSimplify,
    triangulate,
    restoreDelaunay,
    orient2d,
    inCircle
  }
})
