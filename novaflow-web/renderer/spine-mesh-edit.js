/*
 * NovaFlow skeleton lab — Spine's 编辑网格 on a mesh attachment, in place.
 *
 * The editor works on one model: every vertex has its place on the image (u, v in image
 * pixels, v down like Spine's uvs), its place in the world in the setup pose (x, y) and its
 * bone weights (null for an unweighted mesh, which hangs on the slot's bone). Adding,
 * deleting, moving, resetting, tracing or generating vertices only changes that model;
 * `toAttachment` turns it back into Spine 3.8 mesh data (uvs / vertices / triangles / hull).
 *
 * Triangulation is Delaunay in image space (the production auto-mesh core), with the
 * triangles outside the hull dropped. The hull is the first `hull` vertices, in order.
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowMeshEdit = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const fail = (msg) => { throw new Error(msg) }

  // ------------------------------------------------------------------ model <-> Spine data

  /** Bone weights of each vertex from Spine 3.8 weighted vertices ([n, bone, x, y, w, ...]). */
  function weightsOf(vertices, n) {
    const out = []
    let i = 0
    for (let k = 0; k < n; k++) {
      const c = vertices[i++]
      const w = []
      for (let j = 0; j < c; j++, i += 4) w.push([vertices[i], vertices[i + 3]])
      out.push(w)
    }
    return out
  }

  /**
   * A model from mesh JSON and the mesh's world vertices in the setup pose.
   * `size` = { width, height } of the image (the attachment's, or the region's original).
   */
  function fromAttachment(att, world, size) {
    const uvs = att.uvs || fail('网格没有 uvs')
    const n = uvs.length / 2
    const W = Number(size && size.width) || Number(att.width) || 1
    const H = Number(size && size.height) || Number(att.height) || 1
    const weighted = att.vertices.length > uvs.length
    const w = weighted ? weightsOf(att.vertices, n) : null
    const points = []
    for (let i = 0; i < n; i++) points.push({ u: uvs[i * 2] * W, v: uvs[i * 2 + 1] * H, x: world[i * 2], y: world[i * 2 + 1], w: w ? w[i] : null, src: i })
    const hull = Number(att.hull) || n
    // Spine's edges: pairs of vertex index × 2; the hull's own edges are implied, the rest are the user's
    const edges = []
    const E = att.edges || []
    for (let i = 0; i + 1 < E.length; i += 2) {
      const a = E[i] / 2, b = E[i + 1] / 2
      if (!Number.isInteger(a) || !Number.isInteger(b) || a === b || a >= n || b >= n) continue
      if (a < hull && b < hull && (Math.abs(a - b) === 1 || Math.abs(a - b) === hull - 1)) continue
      if (!edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) edges.push([a, b])
    }
    return { width: W, height: H, hull, points, tris: Array.from(att.triangles || []), weighted, edges }
  }

  const inv = (m, x, y) => {
    const det = m.a * m.d - m.b * m.c || 1
    const dx = x - m.worldX, dy = y - m.worldY
    return [(m.d * dx - m.b * dy) / det, (m.a * dy - m.c * dx) / det]
  }
  const r6 = (v) => Math.round(v * 1e6) / 1e6
  const r3 = (v) => Math.round(v * 1000) / 1000

  /**
   * Spine 3.8 mesh data from a model. `mats[i]` = setup world matrix of skeleton bone i
   * ({a, b, c, d, worldX, worldY}); `slotBone` = the slot's bone index (unweighted meshes).
   */
  function toAttachment(model, mats, slotBone) {
    const uvs = [], vertices = []
    for (const p of model.points) {
      uvs.push(r6(p.u / model.width), r6(p.v / model.height))
      if (model.weighted) {
        vertices.push(p.w.length)
        for (const [b, wt] of p.w) { const l = inv(mats[b], p.x, p.y); vertices.push(b, r3(l[0]), r3(l[1]), r6(wt)) }
      } else {
        const l = inv(mats[slotBone], p.x, p.y)
        vertices.push(r3(l[0]), r3(l[1]))
      }
    }
    // Spine writes the hull's edges, then the user's (vertex index × 2)
    const edges = []
    for (let i = 0; i < model.hull; i++) edges.push(i * 2, ((i + 1) % model.hull) * 2)
    for (const [a, b] of model.edges || []) edges.push(a * 2, b * 2)
    return { uvs, vertices, triangles: model.tris.slice(), hull: model.hull, edges }
  }

  // ------------------------------------------------------------------ geometry

  function pointInPoly(px, py, poly) {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j]
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }

  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
    return Math.hypot(px - ax - t * dx, py - ay - t * dy)
  }

  function onPoly(px, py, poly, eps) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      if (segDist(px, py, a[0], a[1], b[0], b[1]) <= eps) return true
    }
    return false
  }

  const hullUV = (m) => m.points.slice(0, m.hull).map((p) => [p.u, p.v])
  const hullXY = (m) => m.points.slice(0, m.hull).map((p) => [p.x, p.y])

  /**
   * Delaunay with the edges in `constraints` forced in (edge flips, Sloan's method), so a
   * concave outline keeps its own edges: a triangle never spans the gap between two fingers
   * and the inside never loses one. Returns triangles as [a, b, c] arrays.
   */
  function constrainedDelaunay(coords, constraints, core) {
    const { triangles } = core.triangulate(coords)
    const X = (i) => coords[2 * i], Y = (i) => coords[2 * i + 1]
    const orient = (a, b, c) => (X(b) - X(a)) * (Y(c) - Y(a)) - (Y(b) - Y(a)) * (X(c) - X(a))
    const tris = []
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2]
      tris.push(orient(a, b, c) < 0 ? [a, c, b] : [a, b, c])
    }
    const K = coords.length / 2 + 1
    const key = (u, v) => u * K + v
    const em = new Map()
    tris.forEach((t, i) => { for (let e = 0; e < 3; e++) em.set(key(t[e], t[(e + 1) % 3]), i) })
    const third = (t, u, v) => t.find((x) => x !== u && x !== v)
    const crosses = (a, b, c, d) => {
      if (a === c || a === d || b === c || b === d) return false
      const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b)
      return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))
    }
    for (const [a, b] of constraints) {
      if (a === b || em.has(key(a, b)) || em.has(key(b, a))) continue
      const queue = []
      for (const k of em.keys()) {
        const u = Math.floor(k / K), v = k % K
        if (u < v || !em.has(key(v, u))) { if (crosses(a, b, u, v)) queue.push([u, v]) }
      }
      let guard = queue.length * 20 + 50
      while (queue.length && guard-- > 0) {
        const [u, v] = queue.shift()
        const t1 = em.get(key(u, v)), t2 = em.get(key(v, u))
        if (t1 == null || t2 == null) continue
        const p = third(tris[t1], u, v), q = third(tris[t2], v, u)
        const ou = orient(p, q, u), ov = orient(p, q, v)
        // only a convex pair can be flipped; try the edge again after the others moved
        if (!((ou > 0 && ov < 0) || (ou < 0 && ov > 0))) { queue.push([u, v]); continue }
        tris[t1] = [p, u, q]; tris[t2] = [q, v, p]
        em.delete(key(u, v)); em.delete(key(v, u))
        em.set(key(p, u), t1); em.set(key(u, q), t1); em.set(key(q, p), t1)
        em.set(key(q, v), t2); em.set(key(v, p), t2); em.set(key(p, q), t2)
        if (crosses(a, b, p, q)) queue.push([p, q])
      }
    }
    return tris
  }

  /** Triangles of the model: Delaunay in image space, the outline's edges kept, nothing outside it. */
  function triangulate(model, core) {
    const pts = model.points
    if (pts.length < 3) return []
    const coords = Float64Array.from(pts.flatMap((p) => [p.u, p.v]))
    const H = Math.min(model.hull, pts.length)
    const cons = []
    for (let i = 0; i < H; i++) cons.push([i, (i + 1) % H])
    for (const [a, b] of model.edges || []) if (a < pts.length && b < pts.length) cons.push([a, b])
    const tris = constrainedDelaunay(coords, cons, core)
    const poly = hullUV(model)
    const out = []
    for (const [a, b, c] of tris) {
      const A = pts[a], B = pts[b], C = pts[c]
      const area = (B.u - A.u) * (C.v - A.v) - (B.v - A.v) * (C.u - A.u)
      if (Math.abs(area) < 1e-9) continue
      if (!pointInPoly((A.u + B.u + C.u) / 3, (A.v + B.v + C.v) / 3, poly)) continue
      out.push(a, b, c)
    }
    return out
  }

  function bary(px, py, ax, ay, bx, by, cx, cy) {
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (!den) return null
    const l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den
    const l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den
    return [l0, l1, 1 - l0 - l1]
  }

  /** Weights mixed by barycentric amounts (negatives clamped), merged per bone, small ones dropped. */
  function blendWeights(ws, ls) {
    const cl = ls.map((l) => Math.max(0, l))
    const sum = cl.reduce((a, b) => a + b, 0) || 1
    const by = new Map()
    ws.forEach((w, i) => { for (const [b, wt] of w) by.set(b, (by.get(b) || 0) + wt * cl[i] / sum) })
    let list = [...by.entries()].filter(([, wt]) => wt >= 0.01)
    if (!list.length) list = [[ws[0][0][0], 1]]
    const tot = list.reduce((a, [, wt]) => a + wt, 0)
    return list.map(([b, wt]) => [b, wt / tot])
  }

  /**
   * What the mesh has at a point, from the triangle it falls in (or, outside the mesh, the
   * nearest triangle extended): `from` = 'world' (x, y -> u, v) or 'uv' (u, v -> x, y).
   */
  function sampleAt(model, px, py, from) {
    const pts = model.points, T = model.tris
    const key = from === 'uv' ? ['u', 'v'] : ['x', 'y']
    let best = null, bestD = Infinity
    for (let t = 0; t < T.length; t += 3) {
      const A = pts[T[t]], B = pts[T[t + 1]], C = pts[T[t + 2]]
      const l = bary(px, py, A[key[0]], A[key[1]], B[key[0]], B[key[1]], C[key[0]], C[key[1]])
      if (!l) continue
      const out = Math.max(0, -l[0], -l[1], -l[2])
      if (out === 0) { best = { tri: t, l, inside: true }; break }
      const cx = (A[key[0]] + B[key[0]] + C[key[0]]) / 3, cy = (A[key[1]] + B[key[1]] + C[key[1]]) / 3
      const d = Math.hypot(px - cx, py - cy)
      if (d < bestD) { bestD = d; best = { tri: t, l, inside: false } }
    }
    if (!best) {
      // no triangles: the nearest vertex
      let k = 0, d0 = Infinity
      pts.forEach((p, i) => { const d = Math.hypot(p[key[0]] - px, p[key[1]] - py); if (d < d0) { d0 = d; k = i } })
      const p = pts[k] || { u: 0, v: 0, x: 0, y: 0, w: null }
      return { u: from === 'uv' ? px : p.u, v: from === 'uv' ? py : p.v, x: from === 'uv' ? p.x : px, y: from === 'uv' ? p.y : py, w: p.w && p.w.slice(), inside: false }
    }
    const ids = [T[best.tri], T[best.tri + 1], T[best.tri + 2]].map((i) => pts[i])
    const mix = (k) => ids[0][k] * best.l[0] + ids[1][k] * best.l[1] + ids[2][k] * best.l[2]
    return {
      u: from === 'uv' ? px : mix('u'), v: from === 'uv' ? py : mix('v'),
      x: from === 'uv' ? mix('x') : px, y: from === 'uv' ? mix('y') : py,
      w: model.weighted ? blendWeights(ids.map((p) => p.w), best.l) : null,
      inside: best.inside,
    }
  }

  const clampUV = (m, p) => { p.u = Math.max(0, Math.min(m.width, p.u)); p.v = Math.max(0, Math.min(m.height, p.v)); return p }
  const copy = (m) => ({ ...m, points: m.points.map((p) => ({ ...p, w: p.w && p.w.map((x) => x.slice()) })), tris: m.tris.slice(), edges: (m.edges || []).map((e) => e.slice()) })

  // ------------------------------------------------------------------ edits (all return a new model)

  /** 创建: a vertex where the pointer is; inside the hull an inner vertex, outside it the hull grows. */
  function addPoint(model, x, y, core) {
    const m = copy(model)
    const s = sampleAt(model, x, y, 'world')
    const p = clampUV(m, { u: s.u, v: s.v, x, y, w: s.w, src: -1 })
    if (pointInPoly(x, y, hullXY(model))) m.points.push(p)
    else {
      // into the hull, after the nearest hull edge
      const H = hullXY(model)
      let e = 0, d0 = Infinity
      for (let i = 0; i < H.length; i++) {
        const a = H[i], b = H[(i + 1) % H.length]
        const d = segDist(x, y, a[0], a[1], b[0], b[1])
        if (d < d0) { d0 = d; e = i }
      }
      m.points.splice(e + 1, 0, p)
      m.hull++
      m.edges = m.edges.map(([a, b]) => [a > e ? a + 1 : a, b > e ? b + 1 : b])
    }
    m.tris = triangulate(m, core)
    return m
  }

  /**
   * 创建 → drag from a vertex to a vertex (Spine): an edge the triangles must keep, so the mesh
   * bends along it. It has to stay inside the outline and cross no other edge.
   */
  function addEdge(model, a, b, core) {
    if (a === b) fail('同一个顶点')
    const P = model.points, H = model.hull
    if (!P[a] || !P[b]) fail('没有这个顶点')
    if (a < H && b < H && (Math.abs(a - b) === 1 || Math.abs(a - b) === H - 1)) return model
    if ((model.edges || []).some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return model
    const A = P[a], B = P[b]
    const poly = hullUV(model)
    const eps = Math.max(model.width, model.height) * 1e-4
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const u = A.u + (B.u - A.u) * t, v = A.v + (B.v - A.v) * t
      if (!pointInPoly(u, v, poly) && !onPoly(u, v, poly, eps)) fail('边要在外圈里面')
    }
    const o = (p, q, r) => (q.u - p.u) * (r.v - p.v) - (q.v - p.v) * (r.u - p.u)
    const cross = (p, q, r, s0) => { const d1 = o(p, q, r), d2 = o(p, q, s0), d3 = o(r, s0, p), d4 = o(r, s0, q); return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)) }
    const segs = []
    for (let i = 0; i < H; i++) segs.push([i, (i + 1) % H])
    for (const e of model.edges || []) segs.push(e)
    for (const [c, d] of segs) {
      if (c === a || c === b || d === a || d === b) continue
      if (cross(A, B, P[c], P[d])) fail('边不能和别的边交叉')
    }
    const m = copy(model)
    m.edges.push([a, b])
    m.tris = triangulate(m, core)
    return m
  }

  /** 删除 on an edge: the edge goes, its vertices stay. */
  function removeEdge(model, k, core) {
    const m = copy(model)
    m.edges.splice(k, 1)
    m.tris = triangulate(m, core)
    return m
  }

  /** 删除: the hull keeps at least three vertices. */
  function removePoints(model, idxs, core) {
    const drop = new Set(idxs)
    const keptHull = model.points.slice(0, model.hull).filter((_, i) => !drop.has(i)).length
    if (keptHull < 3) fail('外圈至少要留 3 个顶点')
    const m = copy(model)
    const map = []
    let k = 0
    model.points.forEach((_, i) => { map[i] = drop.has(i) ? -1 : k++ })
    m.edges = m.edges.map(([a, b]) => [map[a], map[b]]).filter(([a, b]) => a >= 0 && b >= 0)
    m.points = m.points.filter((_, i) => !drop.has(i))
    m.hull = keptHull
    m.tris = triangulate(m, core)
    return m
  }

  /**
   * 修改: move vertices by a world delta. With `deform` the image goes with them (Spine's 变形);
   * without it they slide over the image, which stays where it is.
   */
  function movePoints(model, idxs, dx, dy, deform, core) {
    const m = copy(model)
    for (const i of idxs) {
      const p = m.points[i]
      p.x += dx; p.y += dy
      if (!deform) {
        const s = sampleAt(model, p.x, p.y, 'world')
        p.u = s.u; p.v = s.v
        clampUV(m, p)
      }
    }
    if (!deform) m.tris = triangulate(m, core)
    return m
  }

  /** New vertices at image positions (the hull first), placed in the world through the current mesh. */
  function rebuild(model, hullUVs, innerUVs, core) {
    const m = copy(model)
    const at = ([u, v]) => { const s = sampleAt(model, u, v, 'uv'); return clampUV(m, { u, v, x: s.x, y: s.y, w: s.w, src: -1 }) }
    m.points = [...hullUVs.map(at), ...(innerUVs || []).map(at)]
    m.hull = hullUVs.length
    m.edges = []
    m.tris = triangulate(m, core)
    return m
  }

  /** 重置: the image's rectangle, four vertices. */
  function reset(model, core) {
    const W = model.width, H = model.height
    return rebuild(model, [[0, 0], [W, 0], [W, H], [0, H]], [], core)
  }

  /** 新建: a hull through world points clicked in order. */
  function newHull(model, worldPts, core) {
    if (worldPts.length < 3) fail('外圈至少要 3 个点')
    const uv = worldPts.map(([x, y]) => { const s = sampleAt(model, x, y, 'world'); return [s.u, s.v] })
    return rebuild(model, uv, [], core)
  }

  const TRACE_DEFAULTS = Object.freeze({ detail: 60, concavity: 50, refine: 50, threshold: 8, padding: 0 })

  const polyArea = (P) => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return a / 2 }

  function convexHull(P) {
    const pts = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const lo = [], hi = []
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p) }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p) }
    return lo.slice(0, -1).concat(hi.slice(0, -1))
  }

  /**
   * Spine's 描绘 (Trace): the outline of the image's opaque pixels, as image points.
   *   detail     0-100  how closely the outline follows the edge (more = more vertices)
   *   concavity  0-100  how far it goes into dents and gaps (0 = the convex hull)
   *   refine     0-100  how much the edges are pushed out to cover the pixels a straight edge cuts
   *   threshold  0-255  alpha at or under which a pixel counts as empty
   *   padding    px     the outline stands this far off the art
   * Pieces that do not touch are joined into one outline (a mesh has one hull).
   */
  function traceOutline(rgba, W, H, core, opts) {
    const o = { ...TRACE_DEFAULTS, ...(opts || {}) }
    let mask = core.alphaMask(rgba, W, H, Math.max(0, Math.min(254, Math.round(o.threshold))))
    mask = core.fillHoles(mask, W, H)
    let count = core.largestComponents(mask, W, H, 0.002)
    mask = count.mask
    if (!count.count) fail('这张图没有不透明的地方（降低 Alpha 阈值试试）')
    const N = W * H
    const grow = (m, r) => {
      if (r < 0.5) return m
      const away = core.edt(m, W, H, { invert: true }).dist
      const out = new Uint8Array(N)
      for (let i = 0; i < N; i++) out[i] = m[i] || away[i] <= r ? 1 : 0
      return out
    }
    const shrink = (m, r) => {
      if (r < 0.5) return m
      const d = core.edt(m, W, H).dist
      const out = new Uint8Array(N)
      for (let i = 0; i < N; i++) out[i] = m[i] && d[i] > r ? 1 : 0
      return out
    }
    const size = Math.max(W, H)
    // 凹度: dents and gaps narrower than this are bridged
    const close = Math.pow(1 - Math.max(0, Math.min(100, o.concavity)) / 100, 2) * size * 0.08
    let m = close >= 1 ? core.fillHoles(shrink(grow(mask, close), close), W, H) : mask
    // separate pieces: bridge just enough to make one
    for (let r = Math.max(2, close * 1.5); core.largestComponents(m, W, H, 0).count > 1 && r < size; r *= 1.6) {
      m = core.fillHoles(shrink(grow(mask, r), r), W, H)
    }
    if (core.largestComponents(m, W, H, 0).count > 1) m = core.largestComponents(m, W, H, 1).mask
    // 填充
    m = grow(m, Math.max(0, Number(o.padding) || 0))
    const rings = core.traceContours(m, W, H)
    if (!rings.length) fail('轮廓太小')
    let ring = []
    for (let i = 0; i < rings[0].length; i += 2) ring.push([rings[0][i] + 0.5, rings[0][i + 1] + 0.5])
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop()
    if (polyArea(ring) < 0) ring.reverse()
    if (o.concavity <= 0) return convexHull(ring)
    // 细节: the simplification tolerance (0 → a tenth of the image, 100 → a third of a pixel at 1000 px)
    const eps = o.eps != null ? Math.max(0.35, o.eps) : Math.max(0.35, size * 0.1 * Math.pow(0.03, Math.max(0, Math.min(100, o.detail)) / 100))
    // keep the contour index of each kept point, so the edges know the pixels they cut
    const flat = []
    for (const [x, y] of ring) flat.push(x, y)
    flat.push(ring[0][0], ring[0][1])
    const simp = core.dpSimplify(flat, eps)
    const keep = []
    for (let i = 0, k = 0; i < simp.length / 2 && k < ring.length; i++) {
      while (k < ring.length && (ring[k][0] !== simp[2 * i] || ring[k][1] !== simp[2 * i + 1])) k++
      if (k < ring.length && keep[keep.length - 1] !== k) keep.push(k)
    }
    if (keep.length < 3) fail('轮廓太小（提高细节试试）')
    let P = keep.map((k) => ring[k].slice())
    // 精致度: push every edge out by the farthest contour pixel it cuts off
    const f = Math.max(0, Math.min(100, o.refine)) / 100
    if (f > 0) {
      const n = keep.length
      const dev = new Float64Array(n), nx = new Float64Array(n), ny = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        const A = P[i], B = P[(i + 1) % n]
        const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1
        // with the ring's area positive the outside is on the left of each edge
        nx[i] = -(B[1] - A[1]) / L; ny[i] = (B[0] - A[0]) / L
        let d = 0
        for (let k = keep[i]; k !== keep[(i + 1) % n]; k = (k + 1) % ring.length) {
          const q = ring[k]
          d = Math.max(d, (q[0] - A[0]) * nx[i] + (q[1] - A[1]) * ny[i])
        }
        dev[i] = (d + 0.5) * f
      }
      P = P.map((V, i) => {
        const j = (i - 1 + n) % n
        // where the two pushed edges meet; nearly straight corners just add the pushes
        const den = nx[j] * ny[i] - ny[j] * nx[i]
        if (Math.abs(den) < 0.15) return [V[0] + (nx[j] * dev[j] + nx[i] * dev[i]) / 2 * 2 / (1 + (nx[j] * nx[i] + ny[j] * ny[i])), V[1] + (ny[j] * dev[j] + ny[i] * dev[i]) / (1 + (nx[j] * nx[i] + ny[j] * ny[i]))]
        const tx = (dev[j] * ny[i] - dev[i] * ny[j]) / den, ty = (nx[j] * dev[i] - nx[i] * dev[j]) / den
        const lim = 3 * Math.max(dev[i], dev[j]) + 0.5
        const len = Math.hypot(tx, ty)
        return len > lim ? [V[0] + tx / len * lim, V[1] + ty / len * lim] : [V[0] + tx, V[1] + ty]
      })
    }
    return P.map(([x, y]) => [Math.max(0, Math.min(W, x)), Math.max(0, Math.min(H, y))])
  }

  /** 描绘 → 确定: the hull becomes the traced outline (inner vertices go, like Spine). */
  function trace(model, rgba, core, opts) {
    const W = Math.round(model.width), H = Math.round(model.height)
    const pts = traceOutline(rgba, W, H, core, opts)
    if (pts.length < 3) fail('轮廓太小')
    return rebuild(model, pts, [], core)
  }

  /**
   * 生成 (Spine's Generate): inner vertices spread evenly inside the hull. Every click goes a
   * step denser than what is there (about twice the inner vertices), clear of the vertices
   * already placed, so clicking again keeps adding.
   */
  function generate(model, core, opts) {
    const poly = hullUV(model)
    const area = Math.abs(polyArea(poly))
    if (area < 4) fail('外圈太小')
    const inner0 = model.points.length - model.hull
    const want = Math.max(inner0 * 2, inner0 + 8)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [u, v] of poly) { x0 = Math.min(x0, u); y0 = Math.min(y0, v); x1 = Math.max(x1, u); y1 = Math.max(y1, v) }
    const existing = model.points.map((p) => [p.u, p.v])
    // a hex cell holds step² · √3 / 2
    let step = (opts && opts.step) || Math.sqrt(area / (want + model.hull / 2) / 0.866)
    const near = (u, v, list, d) => list.some((p) => (p[0] - u) ** 2 + (p[1] - v) ** 2 < d * d)
    let inner = []
    for (let tries = 0; tries < 8; tries++) {
      inner = []
      for (let row = 0, v = y0 + step / 2; v < y1; v += step * 0.866, row++) {
        for (let u = x0 + (row % 2 ? step / 2 : step / 4); u < x1; u += step) {
          if (!pointInPoly(u, v, poly)) continue
          let edge = Infinity
          for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; edge = Math.min(edge, segDist(u, v, a[0], a[1], b[0], b[1])) }
          if (edge < step * 0.4 || near(u, v, existing, step * 0.55) || near(u, v, inner, step * 0.55)) continue
          inner.push([u, v])
        }
      }
      if (inner.length >= Math.max(3, (want - inner0) * 0.4) || step < 2.5) break
      step *= 0.8
    }
    if (!inner.length) fail('已经是最密了')
    const m = copy(model)
    for (const [u, v] of inner) { const s = sampleAt(model, u, v, 'uv'); m.points.push({ u, v, x: s.x, y: s.y, w: s.w, src: -1 }) }
    m.tris = triangulate(m, core)
    return m
  }

  /**
   * 自动蒙皮: a generated mesh ({ vertices in image px, triangles, hull }, boundary first)
   * placed in the world through the current mesh.
   */
  function fromImageMesh(model, mesh) {
    const m = copy(model)
    const v = mesh.vertices
    m.points = []
    for (let i = 0; i < v.length / 2; i++) {
      const s = sampleAt(model, v[i * 2], v[i * 2 + 1], 'uv')
      m.points.push(clampUV(m, { u: v[i * 2], v: v[i * 2 + 1], x: s.x, y: s.y, w: s.w, src: -1 }))
    }
    m.hull = mesh.hull
    m.tris = Array.from(mesh.triangles)
    m.edges = []
    return m
  }

  // ------------------------------------------------------------------ weights (编辑权重)
  //
  // A vertex's weights are [[bone, weight], ...] summing to one. Painting one bone moves
  // weight to or from it; the other bones of the vertex share the rest in their old ratio.

  /** An unweighted mesh as a weighted one: every vertex fully on the slot's bone. */
  function toWeighted(model, slotBone) {
    if (model.weighted) return model
    const m = copy(model)
    m.weighted = true
    for (const p of m.points) p.w = [[slotBone, 1]]
    return m
  }

  /** Set one bone's weight on a vertex; the others keep their ratio and fill the rest. */
  function setWeight(w, bone, value) {
    const v = Math.max(0, Math.min(1, value))
    const others = w.filter(([b]) => b !== bone)
    const rest = others.reduce((a, [, x]) => a + x, 0)
    // nothing else on the vertex: it stays fully on this bone (weight has nowhere to go)
    if (!others.length) return [[bone, 1]]
    const out = rest > 1e-9 ? others.map(([b, x]) => [b, x / rest * (1 - v)]) : others.map(([b]) => [b, (1 - v) / others.length])
    if (v > 1e-4) out.push([bone, v])
    return out.filter(([, x]) => x > 1e-4)
  }

  /**
   * Brush on weights: `hits` = [[vertex, falloff 0..1]]. mode 'add' / 'sub' moves `amount`
   * toward 1 / 0 (scaled by falloff), 'set' moves toward `amount` itself. A bone the vertex
   * does not have yet joins it when weight is added.
   */
  function paintWeights(model, hits, bone, mode, amount) {
    const m = copy(model)
    for (const [i, f] of hits) {
      const p = m.points[i]
      const has = p.w.some(([b]) => b === bone)
      const cur = has ? p.w.find(([b]) => b === bone)[1] : 0
      const target = mode === 'add' ? 1 : mode === 'sub' ? 0 : amount
      const k = mode === 'set' ? f : Math.min(1, amount * f)
      const next = cur + (target - cur) * k
      if (Math.abs(next - cur) < 1e-5) continue
      p.w = setWeight(has ? p.w : [...p.w, [bone, 0]], bone, next)
    }
    return m
  }

  /** 平滑: every weight halfway to the mean of its neighbours (by the triangles). */
  function smoothWeights(model, idxs) {
    const n = model.points.length
    const adj = Array.from({ length: n }, () => new Set())
    const T = model.tris
    for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t + e], b = T[t + (e + 1) % 3]; adj[a].add(b); adj[b].add(a) }
    const m = copy(model)
    for (const i of idxs || model.points.map((_, k) => k)) {
      if (!adj[i].size) continue
      const acc = new Map()
      for (const [b, x] of model.points[i].w) acc.set(b, (acc.get(b) || 0) + x * 0.5)
      for (const j of adj[i]) for (const [b, x] of model.points[j].w) acc.set(b, (acc.get(b) || 0) + x * 0.5 / adj[i].size)
      const list = [...acc.entries()].filter(([, x]) => x > 1e-4)
      const tot = list.reduce((a, [, x]) => a + x, 0) || 1
      m.points[i].w = list.map(([b, x]) => [b, x / tot])
    }
    return m
  }

  /** 修剪: influences under `min` go, the rest share their weight (only `idxs` when given). */
  function pruneWeights(model, min, idxs) {
    const m = copy(model)
    const only = idxs ? new Set(idxs) : null
    for (const [i, p] of m.points.entries()) {
      if (only && !only.has(i)) continue
      const keep = p.w.filter(([, x]) => x >= min)
      const list = keep.length ? keep : [p.w.reduce((a, b) => (b[1] > a[1] ? b : a))]
      const tot = list.reduce((a, [, x]) => a + x, 0) || 1
      p.w = list.map(([b, x]) => [b, x / tot])
    }
    return m
  }

  /**
   * 删除 a bone from the binding: its weight goes to the other bones of each vertex; a
   * vertex that had only this bone moves fully onto `fallback`.
   */
  function removeBone(model, bone, fallback) {
    const m = copy(model)
    for (const p of m.points) {
      if (!p.w.some(([b]) => b === bone)) continue
      const others = p.w.filter(([b]) => b !== bone)
      const tot = others.reduce((x, [, w]) => x + w, 0)
      p.w = tot > 1e-9 ? others.map(([b, w]) => [b, w / tot]) : [[typeof fallback === 'function' ? fallback(p) : fallback, 1]]
    }
    return m
  }

  /**
   * The bones of a weighted mesh in list order. Spine's 权重 list is kept as the order every
   * vertex lists its bones in; a file whose vertices disagree falls back to first appearance.
   */
  function boneOrder(model) {
    const first = new Map(), after = new Map()
    for (const p of model.points) {
      const bs = (p.w || []).map(([b]) => b)
      for (const b of bs) if (!first.has(b)) { first.set(b, first.size); after.set(b, new Set()) }
      for (let i = 1; i < bs.length; i++) after.get(bs[i - 1]).add(bs[i])
    }
    const indeg = new Map([...first.keys()].map((b) => [b, 0]))
    for (const set of after.values()) for (const b of set) indeg.set(b, indeg.get(b) + 1)
    const out = [], ready = [...indeg].filter(([, d]) => !d).map(([b]) => b)
    while (ready.length) {
      ready.sort((a, b) => first.get(a) - first.get(b))
      const b = ready.shift()
      out.push(b)
      for (const c of after.get(b)) { indeg.set(c, indeg.get(c) - 1); if (!indeg.get(c)) ready.push(c) }
    }
    return out.length === first.size ? out : [...first.keys()]
  }

  /** Every vertex lists its bones in `order` (bones not in it go last). */
  function orderInfluences(model, order) {
    const rank = new Map(order.map((b, i) => [b, i]))
    const r = (b) => (rank.has(b) ? rank.get(b) : 1e6 + b)
    const m = copy(model)
    for (const p of m.points) if (p.w) p.w.sort((a, b) => r(a[0]) - r(b[0]))
    return m
  }

  /** 直接: one bone's weight on the picked vertices moved by `delta`, or set to `value` (0..1). */
  function nudgeWeights(model, idxs, bone, delta, value) {
    const m = copy(model)
    for (const i of idxs) {
      const p = m.points[i]
      if (!p) continue
      const has = p.w.some(([b]) => b === bone)
      const cur = has ? p.w.find(([b]) => b === bone)[1] : 0
      const next = value != null ? value : cur + delta
      if (Math.abs(next - cur) < 1e-6) continue
      p.w = setWeight(has ? p.w : [...p.w, [bone, 0]], bone, next)
    }
    return m
  }

  /** The mean weight of `bone` over the vertices `idxs` (null when none of them has it). */
  function meanWeight(model, idxs, bone) {
    let sum = 0, n = 0, any = false
    for (const i of idxs) {
      const p = model.points[i]
      if (!p) continue
      const e = p.w.find(([b]) => b === bone)
      if (e) any = true
      sum += e ? e[1] : 0; n++
    }
    return any && n ? sum / n : null
  }

  /** How many vertices each bone moves: Map(bone → count). */
  function boneCounts(model) {
    const out = new Map()
    for (const p of model.points) for (const [b, w] of p.w || []) if (w > 1e-4) out.set(b, (out.get(b) || 0) + 1)
    return out
  }

  /** Each new vertex's source vertex (or -1): what keeps the deform keys of kept vertices. */
  const remapOf = (model) => model.points.map((p) => p.src)

  return { fromAttachment, toAttachment, triangulate, sampleAt, addPoint, removePoints, movePoints, reset, newHull, trace, generate, remapOf, pointInPoly,
    fromImageMesh, toWeighted, setWeight, paintWeights, smoothWeights, pruneWeights, removeBone, boneCounts,
    traceOutline, TRACE_DEFAULTS, constrainedDelaunay, boneOrder, orderInfluences, nudgeWeights, meanWeight, addEdge, removeEdge }
})
