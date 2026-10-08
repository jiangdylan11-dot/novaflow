/*
 * NovaFlow — 自动蒙皮 skinning weights.
 *
 * Bone-heat diffusion on the planar triangulation (Blender's "automatic
 * weights", reduced to 2D). For every bone j solve
 *
 *     (L + M·H) w_j = M·H·p_j
 *
 * where L is the cotangent Laplacian of the mesh, M the lumped vertex areas,
 * H_i = numclosest_i · c / d_i² the heat source strength (d_i = distance from
 * vertex i to the nearest *visible* bone) and p_ij = 1/numclosest_i when bone j
 * is one of the nearest bones of vertex i, else 0. Because L·1 = 0 the per-bone
 * solutions sum to one before any clipping, and the diffusion happens along the
 * mesh — so a hand two pixels from the hip still belongs to the arm, because the
 * heat has to travel down the arm to reach it.
 *
 * Dependency free; solved with Jacobi-preconditioned conjugate gradients, which
 * converges in a few dozen iterations on these meshes. No sparse factorisation.
 *
 * Input geometry is any planar triangulation ({vertices: [x,y,...], triangles})
 * in world space; bones are world-space segments {ax, ay, bx, by}. Output rows
 * sum to one, are pruned to `maxInfluences` bones and dropped below `prune`.
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAutoWeights = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const DEFAULTS = Object.freeze({
    heat: 1.0,           // c in H = numclosest·c/d²
    closestEps: 1.0001,  // bones within this factor of the nearest count as "closest"
    minDist: 1e-4,       // clamp on d before squaring
    prune: 1e-3,         // drop influences below this after normalisation
    maxInfluences: 4,    // keep the strongest N bones per vertex
    tol: 1e-7,           // PCG stop: largest Jacobi-scaled residual, in weight units
    maxIter: 4000
  })

  // ------------------------------------------------------------- geometry ---

  /** Cotangent Laplacian (PSD, L·1 = 0) as CSR plus lumped mass (area/3). */
  function cotLaplacian(V, T) {
    const n = V.length / 2
    const rows = new Array(n)
    for (let i = 0; i < n; i++) rows[i] = new Map()
    const mass = new Float64Array(n)
    const add = (a, b, w) => {
      const ra = rows[a]
      ra.set(b, (ra.get(b) || 0) - w)
      ra.set(a, (ra.get(a) || 0) + w)
      const rb = rows[b]
      rb.set(a, (rb.get(a) || 0) - w)
      rb.set(b, (rb.get(b) || 0) + w)
    }
    for (let t = 0; t < T.length; t += 3) {
      const i = T[t], j = T[t + 1], k = T[t + 2]
      const px = V[2 * i], py = V[2 * i + 1]
      const qx = V[2 * j], qy = V[2 * j + 1]
      const rx = V[2 * k], ry = V[2 * k + 1]
      const area = 0.5 * Math.abs((qx - px) * (ry - py) - (qy - py) * (rx - px))
      if (area < 1e-12) continue
      mass[i] += area / 3; mass[j] += area / 3; mass[k] += area / 3
      // cot at a vertex = dot of its two edges / (2·area)
      const cotI = ((qx - px) * (rx - px) + (qy - py) * (ry - py)) / (2 * area)
      const cotJ = ((px - qx) * (rx - qx) + (py - qy) * (ry - qy)) / (2 * area)
      const cotK = ((px - rx) * (qx - rx) + (py - ry) * (qy - ry)) / (2 * area)
      add(i, j, 0.5 * cotK)
      add(j, k, 0.5 * cotI)
      add(k, i, 0.5 * cotJ)
    }
    let nnz = 0
    for (let i = 0; i < n; i++) nnz += rows[i].size
    const ptr = new Int32Array(n + 1)
    const col = new Int32Array(nnz)
    const val = new Float64Array(nnz)
    let p = 0
    for (let i = 0; i < n; i++) {
      ptr[i] = p
      for (const [c, v] of rows[i]) { col[p] = c; val[p] = v; p++ }
    }
    ptr[n] = p
    return { n, ptr, col, val, mass }
  }

  /** Edges used by exactly one triangle, as a flat [a,b,a,b,...] list. */
  function boundaryEdges(T) {
    const count = new Map()
    for (let t = 0; t < T.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = T[t + e], b = T[t + (e + 1) % 3]
        const key = a < b ? a * 1048576 + b : b * 1048576 + a
        count.set(key, (count.get(key) || 0) + 1)
      }
    }
    const out = []
    for (const [key, c] of count) {
      if (c !== 1) continue
      out.push(Math.floor(key / 1048576), key % 1048576)
    }
    return Int32Array.from(out)
  }

  /** Distance from p to segment ab and the closest point on it. */
  function segPoint(px, py, ax, ay, bx, by, out) {
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    let t = 0
    if (l2 > 1e-12) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    const cx = ax + t * dx, cy = ay + t * dy
    if (out) { out.cx = cx; out.cy = cy; out.t = t }
    return Math.hypot(px - cx, py - cy)
  }

  /** Proper crossing of open segments p→q and a→b (touching endpoints do not count). */
  function crosses(px, py, qx, qy, ax, ay, bx, by) {
    const d1x = qx - px, d1y = qy - py
    const d2x = bx - ax, d2y = by - ay
    const den = d1x * d2y - d1y * d2x
    if (Math.abs(den) < 1e-12) return false
    const dx = ax - px, dy = ay - py
    const s = (dx * d2y - dy * d2x) / den
    const t = (dx * d1y - dy * d1x) / den
    const eps = 1e-7
    return s > eps && s < 1 - eps && t > eps && t < 1 - eps
  }

  /** True when the straight line from vertex i to (cx,cy) leaves the mesh through its boundary. */
  function occluded(V, i, cx, cy, bedges) {
    const px = V[2 * i], py = V[2 * i + 1]
    if (Math.hypot(cx - px, cy - py) < 1e-9) return false
    for (let e = 0; e < bedges.length; e += 2) {
      const a = bedges[e], b = bedges[e + 1]
      if (a === i || b === i) continue
      if (crosses(px, py, cx, cy, V[2 * a], V[2 * a + 1], V[2 * b], V[2 * b + 1])) return true
    }
    return false
  }

  /** Even-odd test of a point against the boundary edge list. */
  function insideBoundary(V, bedges, x, y) {
    let inside = false
    for (let e = 0; e < bedges.length; e += 2) {
      const ax = V[2 * bedges[e]], ay = V[2 * bedges[e] + 1]
      const bx = V[2 * bedges[e + 1]], by = V[2 * bedges[e + 1] + 1]
      if ((ay > y) !== (by > y)) {
        const xint = (bx - ax) * (y - ay) / ((by - ay) || 1e-12) + ax
        if (x < xint) inside = !inside
      }
    }
    return inside
  }

  // --------------------------------------------------------------- solver ---

  function spmv(A, x, y) {
    const { n, ptr, col, val } = A
    for (let i = 0; i < n; i++) {
      let s = 0
      for (let p = ptr[i]; p < ptr[i + 1]; p++) s += val[p] * x[col[p]]
      y[i] = s
    }
  }

  /** Jacobi-preconditioned CG for (L + diag(extra)) x = b. Returns iterations. */
  function pcg(L, extra, b, x, tol, maxIter) {
    const n = L.n
    const diag = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      let d = extra[i]
      for (let p = L.ptr[i]; p < L.ptr[i + 1]; p++) if (L.col[p] === i) d += L.val[p]
      diag[i] = d > 1e-300 ? 1 / d : 1
    }
    const r = new Float64Array(n), z = new Float64Array(n), q = new Float64Array(n), pv = new Float64Array(n)
    spmv(L, x, q)
    let bn = 0
    for (let i = 0; i < n; i++) { r[i] = b[i] - q[i] - extra[i] * x[i]; bn += b[i] * b[i] }
    if (bn < 1e-300) { x.fill(0); return 0 }
    // Convergence is judged on the Jacobi-scaled residual, i.e. in weight units.
    // A vertex sitting on a bone has H ~ 1/minDist², so the raw residual norm is
    // dominated by those pinned rows and a relative test on it would declare
    // victory after one step while every free vertex is still unsolved.
    let rz = 0
    for (let i = 0; i < n; i++) { z[i] = r[i] * diag[i]; pv[i] = z[i]; rz += r[i] * z[i] }
    let it = 0
    for (; it < maxIter; it++) {
      spmv(L, pv, q)
      let pq = 0
      for (let i = 0; i < n; i++) { q[i] += extra[i] * pv[i]; pq += pv[i] * q[i] }
      if (!(pq > 0)) break
      const alpha = rz / pq
      let rmax = 0
      for (let i = 0; i < n; i++) { x[i] += alpha * pv[i]; r[i] -= alpha * q[i]; const s = Math.abs(r[i] * diag[i]); if (s > rmax) rmax = s }
      if (rmax <= tol) { it++; break }
      let rzNew = 0
      for (let i = 0; i < n; i++) { z[i] = r[i] * diag[i]; rzNew += r[i] * z[i] }
      const beta = rzNew / rz
      rz = rzNew
      for (let i = 0; i < n; i++) pv[i] = z[i] + beta * pv[i]
    }
    return it
  }

  /**
   * Feature gate from the artwork: blurred Sobel magnitude of the luminance, 0..1
   * (normalised by its 95th percentile inside the alpha). A controller may only pin
   * vertices that sit on a drawn feature — an eyelid, a lip line — not the plain
   * skin around it. Returns a Float32Array w×h; sample it at vertex pixels.
   */
  function featureGate(rgba, w, h, sigma) {
    const s = sigma === undefined ? 3 : sigma
    const lum = new Float32Array(w * h), inside = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) {
      const a = rgba[4 * i + 3] / 255
      inside[i] = a > 0.5 ? 1 : 0
      lum[i] = (0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2]) * a
    }
    const mag = new Float32Array(w * h)
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!inside[i]) continue
      const gx = -lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1] + lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1]
      const gy = -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1]
      mag[i] = Math.hypot(gx, gy)
    }
    const k = Math.ceil(3 * s), ker = []
    let ks = 0
    for (let d = -k; d <= k; d++) { const v = Math.exp(-d * d / (2 * s * s)); ker.push(v); ks += v }
    for (let j = 0; j < ker.length; j++) ker[j] /= ks
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let acc = 0; for (let d = -k; d <= k; d++) { const xx = Math.min(w - 1, Math.max(0, x + d)); acc += mag[y * w + xx] * ker[d + k] } tmp[y * w + x] = acc }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let acc = 0; for (let d = -k; d <= k; d++) { const yy = Math.min(h - 1, Math.max(0, y + d)); acc += tmp[yy * w + x] * ker[d + k] } out[y * w + x] = acc }
    const vals = []
    for (let i = 0; i < w * h; i++) if (inside[i] && out[i] > 0) vals.push(out[i])
    vals.sort((a, b) => a - b)
    const p95 = vals.length ? vals[Math.floor(vals.length * 0.95)] : 1
    for (let i = 0; i < w * h; i++) out[i] = p95 > 0 ? Math.min(1, out[i] / p95) : 0
    return out
  }

  /** Sample a w×h field at pixel coordinates (nearest), 0 outside. */
  function sampleField(field, w, h, px, py) {
    const x = Math.round(px), y = Math.round(py)
    return x >= 0 && y >= 0 && x < w && y < h ? field[y * w + x] : 0
  }

  /** Clip, keep the strongest bones, drop tiny influences, renormalise rows. */
  function normalizePrune(W, n, nb, prune, maxInf) {
    for (let i = 0; i < n; i++) {
      const base = i * nb
      let best = 0
      for (let j = 0; j < nb; j++) {
        if (W[base + j] < 0) W[base + j] = 0
        if (W[base + j] > W[base + best]) best = j
      }
      if (maxInf && nb > maxInf) {
        const order = []
        for (let j = 0; j < nb; j++) order.push(j)
        order.sort((a, b) => W[base + b] - W[base + a])
        for (let k = maxInf; k < nb; k++) W[base + order[k]] = 0
      }
      let s = 0
      for (let j = 0; j < nb; j++) s += W[base + j]
      if (s > 0) for (let j = 0; j < nb; j++) if (W[base + j] / s < prune) W[base + j] = 0
      s = 0
      for (let j = 0; j < nb; j++) s += W[base + j]
      if (s <= 1e-12) {
        // nothing reached this vertex: give it to whichever bone was strongest before pruning
        for (let j = 0; j < nb; j++) W[base + j] = 0
        W[base + best] = 1
      } else {
        for (let j = 0; j < nb; j++) W[base + j] /= s
      }
    }
    return W
  }

  /**
   * Bone-heat weights.
   * V: [x,y,...] world; T: triangle indices; bones: [{ax,ay,bx,by}].
   * Returns {weights: Float64Array(n*nb) row-major, iterations, nearest: Int32Array(n)}.
   */
  function heatWeights(V, T, bones, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {})
    const n = V.length / 2, nb = bones.length
    const weights = new Float64Array(n * nb)
    const nearest = new Int32Array(n)
    if (!n || !nb) return { weights, iterations: 0, nearest }
    if (nb === 1) { weights.fill(1); return { weights, iterations: 0, nearest } }
    const L = cotLaplacian(V, T)
    const bedges = boundaryEdges(T)
    const D = new Float64Array(n * nb)
    const tmp = { cx: 0, cy: 0, t: 0 }
    const minD = new Float64Array(n).fill(Infinity)
    const minDraw = new Float64Array(n).fill(Infinity)
    for (let i = 0; i < n; i++) {
      const px = V[2 * i], py = V[2 * i + 1]
      for (let j = 0; j < nb; j++) {
        const b = bones[j]
        const d = segPoint(px, py, b.ax, b.ay, b.bx, b.by, tmp)
        if (d < minDraw[i]) minDraw[i] = d
        const vis = o.visibility === false ? true : !occluded(V, i, tmp.cx, tmp.cy, bedges)
        D[i * nb + j] = vis ? d : Infinity
        if (vis && d < minD[i]) minD[i] = d
      }
    }
    // Zero-length bones are controllers (an eye, a breast point, a face slide), not
    // limbs. When the layer also has real bones the artist never lets a controller
    // own a vertex outright — face points peak at 0.4–0.6, breast points at 0.8, the
    // head or chest bone keeps the rest — because a controller translating 25 px
    // with full ownership tears the feature off the face. So where a controller is
    // the nearest bone, the heat source is split: `pointPeak` to the controller and
    // the remainder to the nearest real bone. A layer with only controllers (a bra
    // on two breast points, a flower on one point) keeps the plain Voronoi split.
    const isPoint = bones.map((b) => Math.hypot(b.bx - b.ax, b.by - b.ay) < 1e-6)
    const nSeg = isPoint.filter((p) => !p).length
    const peak = o.pointPeak === undefined ? 0.6 : o.pointPeak
    const split = nSeg > 0 && nSeg < nb && peak < 1
    // A controller only reaches its own feature. The artist's eyelid points cover a
    // patch ~15 px across on a 155 px face, the breast points ~70 px on a 500 px body:
    // both about 0.12 of the layer diagonal. Left to the Voronoi split alone, an eye
    // point owned half the face (93 of 269 vertices) and the cheek moved with the lid.
    // Inside the radius the vertex is pinned hard (relative to its Laplacian row, so
    // the patch is a plateau, not a bump); outside it the controller does not exist.
    let radius = Infinity, layerDiag = 0
    if (split) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let i = 0; i < n; i++) { const x = V[2 * i], y = V[2 * i + 1]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
      layerDiag = Math.hypot(maxX - minX, maxY - minY)
      radius = o.pointRadiusPx !== undefined ? o.pointRadiusPx : (o.pointRadius === undefined ? 0.12 : o.pointRadius) * layerDiag
    }
    // pointPin > 0 pins the patch as a plateau relative to the Laplacian row; 0 (default)
    // keeps the soft heat falloff, which the artist's lip and cheek controllers have
    const pinRatio = o.pointPin === undefined ? 0 : o.pointPin
    const Ldiag = new Float64Array(n)
    for (let i = 0; i < n; i++) for (let p = L.ptr[i]; p < L.ptr[i + 1]; p++) if (L.col[p] === i) Ldiag[i] = L.val[p]
    const pinned = new Uint8Array(n)
    const pinOf = new Float64Array(n)
    const H = new Float64Array(n)
    const share = new Float64Array(n * nb)
    for (let i = 0; i < n; i++) {
      let md = minD[i]
      if (!Number.isFinite(md)) {
        // sees no bone at all (a hole or a sliver): fall back to raw distance
        md = minDraw[i]
        for (let j = 0; j < nb; j++) {
          const b = bones[j]
          D[i * nb + j] = segPoint(V[2 * i], V[2 * i + 1], b.ax, b.ay, b.bx, b.by, tmp)
        }
      }
      let best = 0
      for (let j = 1; j < nb; j++) if (D[i * nb + j] < D[i * nb + best]) best = j
      nearest[i] = best
      let count = 0
      if (!split) {
        for (let j = 0; j < nb; j++) if (D[i * nb + j] <= md * o.closestEps + 1e-9) count++
        for (let j = 0; j < nb; j++) if (D[i * nb + j] <= md * o.closestEps + 1e-9) share[i * nb + j] = 1 / count
      } else {
        let mdSeg = Infinity, mdPt = Infinity
        for (let j = 0; j < nb; j++) { const d = D[i * nb + j]; if (isPoint[j]) { if (d < mdPt) mdPt = d } else if (d < mdSeg) mdSeg = d }
        let cSeg = 0, cPt = 0
        for (let j = 0; j < nb; j++) {
          const d = D[i * nb + j]
          if (isPoint[j]) { if (d <= mdPt * o.closestEps + 1e-9) cPt++ } else if (d <= mdSeg * o.closestEps + 1e-9) cSeg++
        }
        // optional feature gate: a controller only pins vertices on a drawn feature
        const gated = o.gate ? o.gate[i] >= (o.gateMin === undefined ? 0.6 : o.gateMin) : true
        // per-controller presets ride on the bone object: an eyelid is a compact,
        // strong, rigid patch (the lid slides over the eye), a lip corner a wide, faint,
        // soft one — the artist uses opposite styles and geometry cannot tell them apart
        let jn = -1
        for (let j = 0; j < nb; j++) if (isPoint[j] && D[i * nb + j] <= mdPt + 1e-9) { jn = j; break }
        const pb = jn >= 0 ? bones[jn] : null
        const rHere = pb && pb.radiusPx !== undefined ? pb.radiusPx : (pb && pb.radiusFrac !== undefined ? pb.radiusFrac * layerDiag : radius)
        const peakHere = pb && pb.peak !== undefined ? pb.peak : peak
        const pointNearer = mdPt < mdSeg && mdPt <= rHere && gated
        for (let j = 0; j < nb; j++) {
          const d = D[i * nb + j]
          if (isPoint[j]) { if (pointNearer && d <= mdPt * o.closestEps + 1e-9) share[i * nb + j] = peakHere / cPt }
          else if (d <= mdSeg * o.closestEps + 1e-9) share[i * nb + j] = (pointNearer ? 1 - peakHere : 1) / cSeg
        }
        count = pointNearer ? cPt + cSeg : cSeg
        md = pointNearer ? mdPt : mdSeg
        if (pointNearer) { pinned[i] = 1; pinOf[i] = pb && pb.pin !== undefined ? pb.pin : pinRatio }
      }
      const d = Math.max(md, o.minDist)
      H[i] = count * o.heat / (d * d)
    }
    const extra = new Float64Array(n)
    for (let i = 0; i < n; i++) extra[i] = pinned[i] && pinOf[i] > 0 ? Math.max(L.mass[i] * H[i], pinOf[i] * Ldiag[i]) : L.mass[i] * H[i]
    const rhs = new Float64Array(n), x = new Float64Array(n)
    let iterations = 0
    for (let j = 0; j < nb; j++) {
      let any = false
      for (let i = 0; i < n; i++) {
        const p = share[i * nb + j]
        rhs[i] = extra[i] * p
        if (p) any = true
      }
      if (!any) continue
      x.fill(0)
      iterations = Math.max(iterations, pcg(L, extra, rhs, x, o.tol, o.maxIter))
      for (let i = 0; i < n; i++) weights[i * nb + j] = x[i]
    }
    if (o.smooth > 0) smoothWeights(weights, n, nb, L, o.smooth, o.smoothLambda === undefined ? 0.5 : o.smoothLambda)
    normalizePrune(weights, n, nb, o.prune, o.maxInfluences)
    return { weights, iterations, nearest }
  }

  /** Umbrella smoothing of the weight rows over the mesh graph (a soft brush pass). */
  function smoothWeights(W, n, nb, L, iters, lambda) {
    const tmp = new Float64Array(n * nb)
    for (let k = 0; k < iters; k++) {
      for (let i = 0; i < n; i++) {
        let deg = 0
        for (let j = 0; j < nb; j++) tmp[i * nb + j] = 0
        for (let p = L.ptr[i]; p < L.ptr[i + 1]; p++) {
          const c = L.col[p]
          if (c === i) continue
          deg++
          for (let j = 0; j < nb; j++) tmp[i * nb + j] += W[c * nb + j]
        }
        if (!deg) { for (let j = 0; j < nb; j++) tmp[i * nb + j] = W[i * nb + j]; continue }
        for (let j = 0; j < nb; j++) tmp[i * nb + j] = (1 - lambda) * W[i * nb + j] + lambda * tmp[i * nb + j] / deg
      }
      W.set(tmp)
    }
  }

  // ------------------------------------------------------ bone selection ---

  const SELECT_DEFAULTS = Object.freeze({
    nearFrac: 0.0,    // bones closer than this × diagonal count even when outside
    minFrac: 0.85,    // fraction of a bone's samples that must fall inside the silhouette
    maxBones: 32,
    samples: 9
  })

  /**
   * Choose which of `segs` should drive a layer: bones that run inside its
   * silhouette (or, with nearFrac, close by). Returns indices into segs, best first.
   */
  function selectBones(V, T, segs, opts) {
    const o = Object.assign({}, SELECT_DEFAULTS, opts || {})
    const n = V.length / 2
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let i = 0; i < n; i++) {
      const x = V[2 * i], y = V[2 * i + 1]
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
    const diag = Math.hypot(maxX - minX, maxY - minY)
    const tau = o.nearFrac * diag
    const bedges = boundaryEdges(T)
    const tmp = { cx: 0, cy: 0, t: 0 }
    const nearestOf = (b) => {
      let dmin = Infinity
      for (let i = 0; i < n; i++) {
        const d = segPoint(V[2 * i], V[2 * i + 1], b.ax, b.ay, b.bx, b.by, tmp)
        if (d < dmin) dmin = d
      }
      return dmin
    }
    const cand = []
    for (let s = 0; s < segs.length; s++) {
      const b = segs[s]
      if (!b || b.skip) continue
      const len = Math.hypot(b.bx - b.ax, b.by - b.ay)
      const bMinX = Math.min(b.ax, b.bx) - tau, bMaxX = Math.max(b.ax, b.bx) + tau
      const bMinY = Math.min(b.ay, b.by) - tau, bMaxY = Math.max(b.ay, b.by) + tau
      if (bMaxX < minX || bMinX > maxX || bMaxY < minY || bMinY > maxY) continue
      const ns = len > 1e-6 ? Math.max(2, Math.min(o.samples, Math.floor(len / Math.max(tau, 1e-6)) + 2)) : 1
      let inside = 0
      for (let k = 0; k < ns; k++) {
        const u = ns > 1 ? k / (ns - 1) : 0
        if (insideBoundary(V, bedges, b.ax + u * (b.bx - b.ax), b.ay + u * (b.by - b.ay))) inside++
      }
      const frac = inside / ns
      const dmin = nearestOf(b)
      if (frac >= o.minFrac || dmin < tau) {
        cand.push({ index: s, score: frac * 2 + Math.max(0, 1 - dmin / Math.max(tau, 1e-6)), dmin, frac })
      }
    }
    cand.sort((a, b) => (b.score - a.score) || (a.dmin - b.dmin))
    let out = cand.slice(0, o.maxBones).map((c) => c.index)
    if (!out.length) {
      // nothing runs inside: take the two nearest bones so the layer still moves
      const d = []
      for (let s = 0; s < segs.length; s++) if (segs[s] && !segs[s].skip) d.push({ s, dmin: nearestOf(segs[s]) })
      d.sort((a, b) => a.dmin - b.dmin)
      out = d.slice(0, 2).map((x) => x.s)
    }
    return out
  }

  // ------------------------------------------- exclusive layer assignment ---

  const ASSIGN_DEFAULTS = Object.freeze({
    minFrac: 0.85,    // a bone must run this far inside a layer to be a candidate for it
    samples: 9,
    chainVote: true,  // a single-child chain of bones goes to one layer, voted by length
    anchors: 'both'   // 'points': a layer owning controllers gets their parent when it needs it; true: chain heads bring their parent; 'both': both
  })

  function distToBoundary(V, bedges, x, y) {
    let d = Infinity
    for (let e = 0; e < bedges.length; e += 2) {
      const a = bedges[e], b = bedges[e + 1]
      const dd = segPoint(x, y, V[2 * a], V[2 * a + 1], V[2 * b], V[2 * b + 1])
      if (dd < d) d = dd
    }
    return d
  }

  /**
   * Decide which layer each bone belongs to, exclusively. In a 2D rig layers
   * overlap, so "the bone runs inside this silhouette" admits every bone of every
   * layer stacked behind or in front; the discriminating signal is how *tightly*
   * the silhouette wraps the bone (mean distance to the boundary along it — a
   * hair chain hugs its strand, the torso is loose around it), with the topmost
   * drawn layer breaking ties. Bones in a single-child chain then vote as one.
   *
   * layers: [{name, vertices, triangles, drawIndex}] in world space.
   * segs: bone segments (skip: true excludes a bone). parents: parent index per bone.
   * Returns {layers: Map(name → [boneIndex]), pick: Int32Array(bone → layer idx or -1)}.
   */
  function assignBones(layers, segs, parents, opts) {
    const o = Object.assign({}, ASSIGN_DEFAULTS, opts || {})
    const prepared = layers.map((L, idx) => {
      const V = L.vertices, T = L.triangles, be = boundaryEdges(T)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (let i = 0; i < V.length; i += 2) {
        if (V[i] < minX) minX = V[i]; if (V[i] > maxX) maxX = V[i]
        if (V[i + 1] < minY) minY = V[i + 1]; if (V[i + 1] > maxY) maxY = V[i + 1]
      }
      let area = 0
      for (let t = 0; t < T.length; t += 3) {
        const a = T[t], b = T[t + 1], c = T[t + 2]
        area += 0.5 * Math.abs((V[2 * b] - V[2 * a]) * (V[2 * c + 1] - V[2 * a + 1]) - (V[2 * b + 1] - V[2 * a + 1]) * (V[2 * c] - V[2 * a]))
      }
      return { name: L.name, V, be, draw: L.drawIndex !== undefined ? L.drawIndex : idx, minX, minY, maxX, maxY, area }
    })
    const nb = segs.length
    const pick = new Int32Array(nb).fill(-1)
    const fits = new Array(nb)
    const ns = Math.max(1, o.samples)
    for (let s = 0; s < nb; s++) {
      const b = segs[s]
      if (!b || b.skip) continue
      const isPointBone = Math.hypot(b.bx - b.ax, b.by - b.ay) < 1e-6
      let best = -1, bestEdt = Infinity, bestDraw = -1
      const cand = []
      for (let li = 0; li < prepared.length; li++) {
        const L = prepared[li]
        if (Math.max(b.ax, b.bx) < L.minX || Math.min(b.ax, b.bx) > L.maxX || Math.max(b.ay, b.by) < L.minY || Math.min(b.ay, b.by) > L.maxY) continue
        let inside = 0, edt = 0
        for (let k = 0; k < ns; k++) {
          const u = ns > 1 ? k / (ns - 1) : 0
          const x = b.ax + u * (b.bx - b.ax), y = b.ay + u * (b.by - b.ay)
          if (insideBoundary(L.V, L.be, x, y)) { inside++; edt += distToBoundary(L.V, L.be, x, y) }
        }
        if (inside / ns < o.minFrac) continue
        edt /= inside
        const frac = inside / ns
        cand.push({ li, edt, frac })
        let key
        if (isPointBone) {
          // a controller is placed on the feature it controls: the smallest layer
          // containing it (the face for an eye point, the flower for its point)
          key = L.area
        } else {
          // A bone that runs entirely inside a layer belongs to it before one it only
          // pokes into (the thigh bone: 100% inside the leg, 89% inside the cloth strip
          // lying on the thigh — the strip wraps it tighter but it is the leg's bone).
          // And a bone running along a layer's edge is not that layer's bone (a bang
          // 2 px inside the face outline belongs to the hair in front, not the face).
          key = o.fullFirst === false ? edt : (frac >= (o.fullFrac === undefined ? 0.999 : o.fullFrac) ? edt : edt + 1e6)
          if (edt < (o.edgeMin === undefined ? 4 : o.edgeMin)) key += 5e5
        }
        if (key < bestEdt - 1e-9 || (Math.abs(key - bestEdt) <= 1e-9 && L.draw > bestDraw)) { best = li; bestEdt = key; bestDraw = L.draw }
      }
      pick[s] = best
      fits[s] = cand
    }
    const children = []
    for (let s = 0; s < nb; s++) children.push([])
    for (let s = 0; s < nb; s++) { const p = parents[s]; if (p >= 0 && p < nb) children[p].push(s) }
    const chainHeads = []
    if (o.chainVote) {
      const visited = new Uint8Array(nb)
      for (let s = 0; s < nb; s++) {
        if (visited[s]) continue
        const p = parents[s]
        if (p >= 0 && children[p].length === 1 && !visited[p]) continue   // reached from its head
        const chain = [s]
        let cur = s
        while (children[cur].length === 1) { cur = children[cur][0]; chain.push(cur) }
        for (const x of chain) visited[x] = 1
        const votes = new Map()
        for (const x of chain) {
          const l = pick[x]
          if (l < 0) continue
          const len = Math.max(1, Math.hypot(segs[x].bx - segs[x].ax, segs[x].by - segs[x].ay))
          votes.set(l, (votes.get(l) || 0) + len)
        }
        let bestL = -1, bestV = 0
        for (const [l, v] of votes) if (v > bestV) { bestV = v; bestL = l }
        if (bestL >= 0) {
          for (const x of chain) if (!(segs[x] && segs[x].skip)) pick[x] = bestL
          chainHeads.push({ head: s, layer: bestL })
        }
      }
    }
    const out = new Map(prepared.map((L) => [L.name, []]))
    for (let s = 0; s < nb; s++) if (pick[s] >= 0) out.get(prepared[pick[s]].name).push(s)
    if (o.shareTol > 0) {
      // a bone that two layers wrap almost equally tightly (a hip bone under both the
      // torso and the thigh) is shared instead of forced to one of them
      for (let s = 0; s < nb; s++) {
        if (pick[s] < 0) continue
        const f = fits[s]
        if (!f) continue
        let best = Infinity
        for (const c of f) if (c.edt < best) best = c.edt
        for (const c of f) {
          if (c.li === pick[s] || c.edt > best * (1 + o.shareTol)) continue
          const list = out.get(prepared[c.li].name)
          if (!list.includes(s)) list.push(s)
        }
      }
    }
    if (o.anchors === true || o.anchors === 'both') {
      // the bone a chain hangs from moves the chain's root: the hip for a leg or a
      // skirt strip, the shoulder for an arm
      for (const { head, layer } of chainHeads) {
        const p = parents[head]
        if (p < 0 || !segs[p] || segs[p].skip) continue
        const list = out.get(prepared[layer].name)
        if (!list.includes(p)) list.push(p)
      }
    }
    if (o.anchors === 'points' || o.anchors === 'both') {
      // A zero-length controller (an eye, a breast point) cannot carry an area by
      // itself; the bone it hangs from is what really moves that part of the layer.
      // But only when the layer really needs it: enough of the layer must lie
      // nearer to that parent bone than to any bone the layer already owns (the
      // face is mostly head, not eye points; a bra is all breast points).
      const tmp = { cx: 0, cy: 0, t: 0 }
      const need = o.anchorCover === undefined ? 0.4 : o.anchorCover
      for (const [name, list] of out) {
        const li = prepared.findIndex((L) => L.name === name)
        const L = prepared[li]
        for (const s of list.slice()) {
          const b = segs[s]
          if (Math.hypot(b.bx - b.ax, b.by - b.ay) > 1e-6) continue
          const p = parents[s]
          if (p < 0 || !segs[p] || segs[p].skip || list.includes(p)) continue
          const pb = segs[p]
          let inside = 0
          for (let k = 0; k < ns; k++) {
            const u = ns > 1 ? k / (ns - 1) : 0
            if (insideBoundary(L.V, L.be, pb.ax + u * (pb.bx - pb.ax), pb.ay + u * (pb.by - pb.ay))) inside++
          }
          if (inside / ns < (o.anchorFrac === undefined ? 0.3 : o.anchorFrac)) continue
          const nV = L.V.length / 2
          let nearerToParent = 0
          for (let i = 0; i < nV; i++) {
            const x = L.V[2 * i], y = L.V[2 * i + 1]
            const dp = segPoint(x, y, pb.ax, pb.ay, pb.bx, pb.by, tmp)
            let dOwn = Infinity
            for (const t of list) { const ob = segs[t]; const d = segPoint(x, y, ob.ax, ob.ay, ob.bx, ob.by, tmp); if (d < dOwn) dOwn = d }
            if (dp < dOwn) nearerToParent++
          }
          if (o.debug) console.log(`[anchors] ${name}: parent ${p} of point ${s} reaches ${(inside / ns).toFixed(2)}, nearer for ${(nearerToParent / nV).toFixed(2)} of vertices`)
          if (nearerToParent / nV >= need) list.push(p)
        }
      }
    }
    // A layer no bone runs through (a hair pin, a flower, a necklace) hangs off the
    // nearest *carrier* bone: among the bones nearby, prefer one at least as long
    // as the median bone, so a pin follows the head rather than the hair strand it
    // happens to touch.
    if (o.fallback !== false) {
      const lens = []
      for (let s = 0; s < nb; s++) { const b = segs[s]; if (!b || b.skip) continue; const l = Math.hypot(b.bx - b.ax, b.by - b.ay); if (l > 1e-6) lens.push(l) }
      lens.sort((a, c) => a - c)
      const median = lens.length ? lens[Math.floor(lens.length / 2)] : 0
      const minLen = o.fallbackMinLen !== undefined ? o.fallbackMinLen : median
      for (const [name, list] of out) {
        if (list.length) continue
        const L = prepared.find((x) => x.name === name)
        const cands = []
        for (let s = 0; s < nb; s++) {
          const b = segs[s]
          if (!b || b.skip) continue
          let dmin = Infinity
          for (let i = 0; i < L.V.length; i += 2) { const d = segPoint(L.V[i], L.V[i + 1], b.ax, b.ay, b.bx, b.by); if (d < dmin) dmin = d }
          cands.push({ s, dmin, len: Math.hypot(b.bx - b.ax, b.by - b.ay) })
        }
        if (!cands.length) continue
        // A layer is usually empty because it is one piece of something drawn in
        // two layers (a ribbon cut in half, a necklace over the collar) and the
        // exclusive vote handed the whole chain to the other piece. So the bones
        // that run *through* this layer come first, most-inside first, and only
        // then the ones merely touching it. Not "longest touching bone": a ribbon
        // end also touches the arm swinging past it, and following that arm tore
        // the ribbon off (IoU 0.95 -> 0.09). Not "nearest touching bone" either: a
        // hair strand lying along the ribbon is nearer than the ribbon chain itself.
        const diag = Math.hypot(L.maxX - L.minX, L.maxY - L.minY)
        const reach = Math.max(3, (o.contactFrac === undefined ? 0.02 : o.contactFrac) * diag)
        for (const c of cands) {
          const b = segs[c.s]
          let inside = 0
          for (let k = 0; k < ns; k++) {
            const u = ns > 1 ? k / (ns - 1) : 0
            if (insideBoundary(L.V, L.be, b.ax + u * (b.bx - b.ax), b.ay + u * (b.by - b.ay))) inside++
          }
          c.frac = inside / ns
        }
        const through = cands.filter((c) => c.frac > 0 || c.dmin <= reach)
        if (through.length && o.fallback !== 'major') {
          // ...and a bone linked (parent/child) to one already taken beats a stranger
          // with the same fraction: the next ribbon bone, not the hair strand lying
          // along the ribbon. Past the first two, only linked bones may follow —
          // "half inside" was enough to drag a hair bone into a flower (hua1 0.70 → 0.46).
          const maxN = o.fallbackMax || 3
          const linked = (s) => list.some((t) => parents[s] === t || parents[t] === s)
          const remaining = through.slice()
          while (list.length < maxN && remaining.length) {
            remaining.sort((a, c) => (c.frac - a.frac) || ((linked(c.s) ? 1 : 0) - (linked(a.s) ? 1 : 0)) || (a.dmin - c.dmin))
            const c = remaining.shift()
            if (list.length >= 2 && !linked(c.s)) break
            list.push(c.s)
          }
          continue
        }
        cands.sort((a, c) => a.dmin - c.dmin)
        // ...otherwise the nearest carrier bone
        const major = o.fallback === 'nearest' ? null : cands.find((c) => c.len >= minLen && c.dmin <= (o.fallbackReach === undefined ? 4 : o.fallbackReach) * cands[0].dmin + 24)
        list.push(major ? major.s : cands[0].s)
      }
    }
    // Hub sharing: a bone that several chains hang from (a hip under the leg and the
    // skirt strips, the chest under the arms and the neck) is what the artist shares
    // across the layers it runs through with small anchoring weights. Such a hub is
    // added to every layer it lies entirely inside and where it is the nearest bone
    // for at least `hubFrac` of the vertices. Ordinary chain bones stay exclusive.
    // Off by default: on the reference rig it gave the body its hips (+0.010) but
    // handed the arm hub to a ribbon lying over the arm (daizi3 0.977 → 0.756).
    if (o.shareHubs) {
      const childCount = new Int32Array(nb)
      for (let s = 0; s < nb; s++) if (parents[s] >= 0 && parents[s] < nb) childCount[parents[s]]++
      const tmp = { cx: 0, cy: 0, t: 0 }
      const need = o.hubFrac === undefined ? 0.1 : o.hubFrac
      for (let li = 0; li < prepared.length; li++) {
        const L = prepared[li]
        const list = out.get(L.name)
        if (!list.length) continue
        const nV = L.V.length / 2
        for (let s = 0; s < nb; s++) {
          const b = segs[s]
          if (!b || b.skip || list.includes(s) || childCount[s] < 2 || Math.hypot(b.bx - b.ax, b.by - b.ay) < 1e-6) continue
          const f = fits[s]
          const here = f && f.find((c) => c.li === li)
          if (!here || here.frac < 0.999) continue
          let nearer = 0
          for (let i = 0; i < nV; i++) {
            const x = L.V[2 * i], y = L.V[2 * i + 1]
            const ds = segPoint(x, y, b.ax, b.ay, b.bx, b.by, tmp)
            let dOwn = Infinity
            for (const t of list) { const ob = segs[t]; const d = segPoint(x, y, ob.ax, ob.ay, ob.bx, ob.by, tmp); if (d < dOwn) dOwn = d }
            if (ds < dOwn) nearer++
          }
          if (nearer / nV >= need) list.push(s)
        }
      }
    }
    // Coverage: when part of a layer lies far from every bone it owns while another
    // layer's bone runs right through that part, the layer gets that bone too — but
    // only if the two layers wrap the bone about equally (a near tie), so a hair
    // strand lying on the chest never drives the chest.
    if (o.cover > 0) {
      const tmp = { cx: 0, cy: 0, t: 0 }
      const tie = o.coverTie === undefined ? 2 : o.coverTie
      const need = o.coverFrac === undefined ? 0.15 : o.coverFrac
      for (let li = 0; li < prepared.length; li++) {
        const L = prepared[li]
        const list = out.get(L.name)
        if (!list.length) continue
        const cand = []
        for (let s = 0; s < nb; s++) {
          if (pick[s] < 0 || pick[s] === li || list.includes(s)) continue
          const f = fits[s]
          if (!f) continue
          const here = f.find((c) => c.li === li)
          if (!here) continue
          const own = f.find((c) => c.li === pick[s])
          if (own && here.edt > tie * own.edt) continue
          cand.push(s)
        }
        if (!cand.length) continue
        const nV = L.V.length / 2
        const count = new Map()
        for (let i = 0; i < nV; i++) {
          const x = L.V[2 * i], y = L.V[2 * i + 1]
          let dA = Infinity
          for (const t of list) { const b = segs[t]; const d = segPoint(x, y, b.ax, b.ay, b.bx, b.by, tmp); if (d < dA) dA = d }
          let bestS = -1, bestD = Infinity
          for (const s of cand) { const b = segs[s]; const d = segPoint(x, y, b.ax, b.ay, b.bx, b.by, tmp); if (d < bestD) { bestD = d; bestS = s } }
          if (bestS >= 0 && bestD * (1 + o.cover) < dA) count.set(bestS, (count.get(bestS) || 0) + 1)
        }
        for (const [s, c] of count) if (c >= need * nV) list.push(s)
      }
    }
    return { layers: out, pick }
  }

  /**
   * Bones that are the rig's mechanism rather than its body, which never carry
   * weights (measured on the artist rig: 26 unweighted bones, all of these kinds):
   *  - root and every IK target (they drive, they are not drawn)
   *  - zero-length bones WITH children: structural pivots (x, y, kua1, yao, jian1...).
   *    Zero-length LEAF bones are feature controllers (an eye, a breast point) and do get weights.
   *  - an IK chain of which any member is a transform-constraint target: a helper
   *    chain whose pose is copied onto the visible bones.
   * Takes the skeleton JSON; returns a Set of bone indices.
   */
  function mechanismBones(skeletonJson, opts) {
    const bones = Array.isArray(skeletonJson && skeletonJson.bones) ? skeletonJson.bones : []
    const index = new Map(bones.map((b, i) => [b.name, i]))
    const children = new Int32Array(bones.length)
    bones.forEach((b) => { if (b.parent !== undefined && index.has(b.parent)) children[index.get(b.parent)]++ })
    const skip = new Set()
    if (bones.length) skip.add(0)
    // Optional name hint. A "slide" controller (face_turn, body_up_turn...) is a
    // zero-length point the artist paints as a faint UNIFORM weight over whole layers
    // for a parallax turn; geometrically it looks exactly like an eye controller, and
    // auto-weighting it produces a wrong local blob instead. Left to the user to paint.
    const pat = opts && opts.skipNames
    if (pat) bones.forEach((b, i) => { if (pat.test(b.name) && !(Number(b.length) > 0)) skip.add(i) })
    const tcTargets = new Set()
    for (const c of skeletonJson.transform || []) if (index.has(c.target)) tcTargets.add(index.get(c.target))
    for (const c of skeletonJson.ik || []) {
      if (index.has(c.target)) skip.add(index.get(c.target))
      const members = (c.bones || []).map((n) => index.get(n)).filter((i) => i !== undefined)
      if (members.some((i) => tcTargets.has(i))) for (const i of members) skip.add(i)
    }
    bones.forEach((b, i) => { if (!(Number(b.length) > 0) && children[i] > 0) skip.add(i) })
    return skip
  }

  /**
   * Parent index per bone, but following the rig's LOGICAL structure: in a Spine
   * limb the shin is a child of the thigh's IK target and the foot a child of the
   * shin's IK target (so the foot stays planted), not of the shin itself. For chain
   * voting and chain anchors, a child of an IK target counts as a child of the
   * last bone of the chain that target drives — thigh → shin → foot becomes one
   * chain again, and the hip that drives the leg IK becomes the leg chain's parent.
   */
  function logicalParents(skeletonJson) {
    const bones = Array.isArray(skeletonJson && skeletonJson.bones) ? skeletonJson.bones : []
    const index = new Map(bones.map((b, i) => [b.name, i]))
    const parents = new Int32Array(bones.length)
    bones.forEach((b, i) => { parents[i] = b.parent !== undefined && index.has(b.parent) ? index.get(b.parent) : -1 })
    const lastOfTarget = new Map()
    for (const c of skeletonJson.ik || []) {
      const members = (c.bones || []).map((n) => index.get(n)).filter((i) => i !== undefined)
      if (!members.length || !index.has(c.target)) continue
      const t = index.get(c.target)
      // a helper chain (see mechanismBones) must not adopt anything: prefer a plain chain
      const last = members[members.length - 1]
      if (!lastOfTarget.has(t) || members.length === 1) lastOfTarget.set(t, last)
    }
    for (let i = 0; i < bones.length; i++) {
      const p = parents[i]
      if (p >= 0 && lastOfTarget.has(p) && lastOfTarget.get(p) !== i) parents[i] = lastOfTarget.get(p)
    }
    return parents
  }

  // ------------------------------------------------------- Spine binding ---

  /** Bone world matrix {a,b,c,d,worldX,worldY} → inverse. */
  function invertBone(m) {
    const det = m.a * m.d - m.b * m.c
    const inv = Math.abs(det) > 1e-12 ? 1 / det : 0
    return { ia: m.d * inv, ib: -m.b * inv, ic: -m.c * inv, id: m.a * inv, wx: m.worldX, wy: m.worldY }
  }

  /** Segment for a bone from its world transform: origin to tip (a point when length is 0). */
  function boneSegment(m) {
    const len = Number(m.length) || 0
    return { ax: m.worldX, ay: m.worldY, bx: m.worldX + m.a * len, by: m.worldY + m.c * len }
  }

  /**
   * Encode weighted Spine `vertices`: [n, boneIndex, localX, localY, weight, ...].
   * worldV: [x,y,...]; weights: row-major n×nb; boneIds: skeleton bone indices for
   * each column; mats: bone world transforms by skeleton index.
   */
  function weightedVertices(worldV, weights, boneIds, mats) {
    const n = worldV.length / 2, nb = boneIds.length
    const inv = boneIds.map((id) => invertBone(mats[id]))
    const rnd = (v) => Math.round(v * 1e5) / 1e5
    const out = []
    for (let i = 0; i < n; i++) {
      const x = worldV[2 * i], y = worldV[2 * i + 1]
      const entries = []
      for (let j = 0; j < nb; j++) {
        const w = weights[i * nb + j]
        if (w <= 0) continue
        const m = inv[j]
        const dx = x - m.wx, dy = y - m.wy
        entries.push(boneIds[j], rnd(m.ia * dx + m.ib * dy), rnd(m.ic * dx + m.id * dy), rnd(w))
      }
      out.push(entries.length / 4)
      for (const e of entries) out.push(e)
    }
    return out
  }

  // ------------------------------------------------ skeleton-level helpers ---

  /**
   * Setup-pose world transforms straight from the JSON (bone tree only, 'normal'
   * transform mode, no constraints). The fallback when the preview's own runtime
   * is out of reach; when an IK or transform constraint acts at setup pose the
   * runtime's matrices are the ones to bind against (see matricesFromRuntime).
   */
  function setupPoseMatrices(skeletonJson) {
    const bones = Array.isArray(skeletonJson && skeletonJson.bones) ? skeletonJson.bones : []
    const index = new Map(bones.map((b, i) => [b.name, i]))
    const mats = new Array(bones.length)
    const rad = Math.PI / 180
    bones.forEach((b, i) => {
      const x = Number(b.x) || 0, y = Number(b.y) || 0, rot = Number(b.rotation) || 0
      const sx = b.scaleX === undefined ? 1 : Number(b.scaleX), sy = b.scaleY === undefined ? 1 : Number(b.scaleY)
      const shx = Number(b.shearX) || 0, shy = Number(b.shearY) || 0
      const ra = (rot + shx) * rad, rb = (rot + 90 + shy) * rad
      const la = Math.cos(ra) * sx, lb = Math.cos(rb) * sy, lc = Math.sin(ra) * sx, ld = Math.sin(rb) * sy
      const p = b.parent !== undefined && index.has(b.parent) ? mats[index.get(b.parent)] : null
      if (!p) { mats[i] = { name: b.name, a: la, b: lb, c: lc, d: ld, worldX: x, worldY: y, length: Number(b.length) || 0 }; return }
      mats[i] = {
        name: b.name,
        a: p.a * la + p.b * lc, b: p.a * lb + p.b * ld,
        c: p.c * la + p.d * lc, d: p.c * lb + p.d * ld,
        worldX: p.a * x + p.b * y + p.worldX, worldY: p.c * x + p.d * y + p.worldY,
        length: Number(b.length) || 0
      }
    })
    return mats
  }

  /**
   * Setup-pose world transforms through a Spine runtime namespace (the vendored
   * spine-webgl's `spine`), constraints included. Attachments are stubbed: no
   * textures are needed to pose a skeleton.
   */
  function matricesFromRuntime(spine, skeletonJson) {
    const region = (name) => ({ name, u: 0, v: 0, u2: 1, v2: 1, rotate: false, degrees: 0, width: 1, height: 1, originalWidth: 1, originalHeight: 1, offsetX: 0, offsetY: 0, x: 0, y: 0, renderObject: null, texture: null })
    const loader = {
      newRegionAttachment: (skin, name, path) => { const a = new spine.RegionAttachment(name); a.region = region(path); return a },
      newMeshAttachment: (skin, name, path) => { const a = new spine.MeshAttachment(name); a.region = region(path); return a },
      newBoundingBoxAttachment: (skin, name) => new spine.BoundingBoxAttachment(name),
      newPathAttachment: (skin, name) => new spine.PathAttachment(name),
      newPointAttachment: (skin, name) => new spine.PointAttachment(name),
      newClippingAttachment: (skin, name) => new spine.ClippingAttachment(name)
    }
    let data
    try {
      data = new spine.SkeletonJson(loader).readSkeletonData(skeletonJson)
    } catch (error) {
      // a Photoshop export is stamped 3.8.75, which the reader refuses; the preview
      // retries it as 3.8.99 (spine-official-runtime), so bind against the same thing
      const version = String((skeletonJson && skeletonJson.skeleton && skeletonJson.skeleton.spine) || '').trim()
      if (version !== '3.8.75' || !String((error && error.message) || error).includes('Unsupported skeleton data')) throw error
      const compat = Object.assign({}, skeletonJson, { skeleton: Object.assign({}, skeletonJson.skeleton, { spine: '3.8.99' }) })
      data = new spine.SkeletonJson(loader).readSkeletonData(compat)
    }
    const skeleton = new spine.Skeleton(data)
    skeleton.setToSetupPose()
    skeleton.updateWorldTransform()
    return skeleton.bones.map((b) => ({ name: b.data.name, a: b.a, b: b.b, c: b.c, d: b.d, worldX: b.worldX, worldY: b.worldY, length: b.data.length }))
  }

  /** World positions of a mesh attachment's vertices: unweighted ones through the slot's bone, weighted ones through their bones. */
  function attachmentWorld(att, mats, slotBoneIndex) {
    const n = att.uvs.length / 2
    const out = new Float64Array(2 * n)
    if (att.vertices.length === att.uvs.length) {
      const m = (slotBoneIndex !== undefined && mats[slotBoneIndex]) || { a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0 }
      for (let i = 0; i < n; i++) {
        const x = att.vertices[2 * i], y = att.vertices[2 * i + 1]
        out[2 * i] = m.a * x + m.b * y + m.worldX
        out[2 * i + 1] = m.c * x + m.d * y + m.worldY
      }
      return out
    }
    const inf = decodeWeighted(att.vertices, n)
    for (let i = 0; i < n; i++) for (const e of inf[i]) {
      const m = mats[e.bone]
      if (!m) continue
      out[2 * i] += (m.a * e.x + m.b * e.y + m.worldX) * e.w
      out[2 * i + 1] += (m.c * e.x + m.d * e.y + m.worldY) * e.w
    }
    return out
  }

  /** An existing weighted attachment's weights as {boneIds, weights (n×nb row-major)}; null when unweighted. */
  function weightsOfAttachment(att) {
    if (!att || att.type !== 'mesh' || att.vertices.length === att.uvs.length) return null
    const n = att.uvs.length / 2
    const inf = decodeWeighted(att.vertices, n)
    const boneIds = Array.from(new Set(inf.flatMap((v) => v.map((e) => e.bone)))).sort((a, b) => a - b)
    const col = new Map(boneIds.map((id, j) => [id, j]))
    const nb = boneIds.length
    const weights = new Float64Array(n * nb)
    for (let i = 0; i < n; i++) {
      let s = 0
      for (const e of inf[i]) { weights[i * nb + col.get(e.bone)] += e.w; s += e.w }
      if (s > 0) for (let j = 0; j < nb; j++) weights[i * nb + j] /= s
    }
    return { boneIds, weights }
  }

  /**
   * Write weights into a skeleton's mesh attachments. `provide(attName, slotName,
   * att, world)` returns {boneIds, weights} for the attachments to bind, null to
   * leave one alone. Works on meshes just converted from regions (unweighted,
   * local to the slot bone) and on meshes that already carry weights.
   */
  function applyWeights(skeletonJson, provide, mats) {
    const out = JSON.parse(JSON.stringify(skeletonJson))
    const boneIndex = new Map((out.bones || []).map((b, i) => [b.name, i]))
    const slotBone = new Map((out.slots || []).map((s) => [s.name, boneIndex.get(s.bone)]))
    const written = []
    const visit = (attachments) => {
      for (const slotName of Object.keys(attachments || {})) {
        const bySlot = attachments[slotName]
        for (const attName of Object.keys(bySlot || {})) {
          const att = bySlot[attName]
          if (!att || att.type !== 'mesh' || !Array.isArray(att.uvs)) continue
          const world = attachmentWorld(att, mats, slotBone.get(slotName))
          let res = null
          try { res = provide(attName, slotName, att, world) } catch { res = null }
          if (!res || !res.boneIds || !res.boneIds.length) continue
          att.vertices = weightedVertices(world, res.weights, res.boneIds, mats)
          written.push(attName)
        }
      }
    }
    const skins = out.skins
    if (Array.isArray(skins)) for (const s of skins) visit(s && s.attachments)
    else if (skins && typeof skins === 'object') for (const k of Object.keys(skins)) visit(skins[k])
    return { skeleton: out, written }
  }

  /** Decode weighted Spine `vertices` into per-vertex [{bone, x, y, w}]. */
  function decodeWeighted(vertices, n) {
    const out = []
    let p = 0
    for (let i = 0; i < n; i++) {
      const cnt = vertices[p++]
      const inf = []
      for (let k = 0; k < cnt; k++) { inf.push({ bone: vertices[p], x: vertices[p + 1], y: vertices[p + 2], w: vertices[p + 3] }); p += 4 }
      out.push(inf)
    }
    return out
  }

  return {
    DEFAULTS, SELECT_DEFAULTS, ASSIGN_DEFAULTS,
    cotLaplacian, boundaryEdges, segPoint, crosses, occluded, insideBoundary, distToBoundary, pcg,
    heatWeights, normalizePrune, selectBones, assignBones, mechanismBones, logicalParents,
    featureGate, sampleField,
    setupPoseMatrices, matricesFromRuntime, attachmentWorld, weightsOfAttachment, applyWeights,
    invertBone, boneSegment, weightedVertices, decodeWeighted
  }
})
