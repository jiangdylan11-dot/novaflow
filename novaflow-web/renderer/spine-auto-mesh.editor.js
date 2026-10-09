/*
 * NovaFlow — 自动蒙皮 manual mesh editor.
 *
 * A self-contained modal rather than an overlay on the Spine preview: the
 * preview's camera transform lives inside the React bundle, so drawing on top of
 * it would mean guessing a matrix we cannot read. Here we own the viewport.
 *
 * Tools: move / add / delete a vertex, and draw a feature loop — the loop is the
 * practical answer to forms the detector cannot find on its own (a breast reads
 * as continuous with the chest in the pixels, so the artist rings it by hand).
 *
 * Every edit re-triangulates with the same Delaunay + mask-cull the generator
 * uses, so an edited mesh is exactly as well-formed as a generated one.
 */
(function (root, factory) {
  const api = factory()
  if (root && typeof root === 'object') root.NovaFlowAutoMeshEditor = api
  if (typeof module === 'object' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  /** input the editor takes back from the app while it is open, on window capture */
  const CLAIMED_INPUT = ['wheel', 'contextmenu', 'pointerdown', 'mousedown']

  const TOOLS = [
    { id: 'move', label: '移动', hint: '拖动顶点' },
    { id: 'add', label: '添加', hint: '点击空白处加点' },
    { id: 'delete', label: '删除', hint: '点击顶点删除' },
    { id: 'loop', label: '画环', hint: '按住画一圈：顶点均匀落在环上，并吸附到附近的结构边缘；两端离得远就是一条开放的线' }
  ]

  function core() {
    // globalThis, not window: the geometry half must stay testable outside a browser
    return (typeof globalThis !== 'undefined' && globalThis.NovaFlowAutoMeshCore) || null
  }

  // ------------------------------------------------------------ geometry ---

  function buildMask(imageData, threshold) {
    const C = core()
    const thr = typeof threshold === 'number' ? threshold : 8
    let mask = C.alphaMask(imageData.data, imageData.width, imageData.height, thr)
    mask = C.fillHoles(mask, imageData.width, imageData.height)
    return C.largestComponents(mask, imageData.width, imageData.height, 0.02).mask
  }

  function insideMask(mask, w, h, x, y) {
    const ix = Math.round(x), iy = Math.round(y)
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return false
    return !!mask[iy * w + ix]
  }

  /**
   * Re-triangulate a point set and re-derive the hull, keeping boundary vertices
   * first because that is the order a Spine mesh attachment expects.
   */
  function retriangulate(points, mask, w, h) {
    const C = core()
    if (points.length < 6) return null
    const coords = Float64Array.from(points)
    const { triangles } = C.triangulate(coords)
    if (!triangles.length) return null
    const kept = []
    const culled = []
    const areaOf = (a, b, c) => Math.abs((coords[2 * b] - coords[2 * a]) * (coords[2 * c + 1] - coords[2 * a + 1])
                                       - (coords[2 * b + 1] - coords[2 * a + 1]) * (coords[2 * c] - coords[2 * a])) / 2
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2]
      if (areaOf(a, b, c) < 1e-6) continue
      const cx = (coords[2 * a] + coords[2 * b] + coords[2 * c]) / 3
      const cy = (coords[2 * a + 1] + coords[2 * b + 1] + coords[2 * c + 1]) / 3
      if (!insideMask(mask, w, h, cx, cy)) { culled.push(a, b, c); continue }
      kept.push(a, b, c)
    }
    // A point placed right on the outline makes triangles whose centre falls just
    // outside it, so the cull above would throw away everything touching the point
    // and the point itself would vanish. Give any stranded vertex its biggest
    // triangle back -- the user put it there on purpose.
    const held = new Set(kept)
    for (let t = 0; t < culled.length; t += 3) {
      const tri = [culled[t], culled[t + 1], culled[t + 2]]
      if (tri.every((v) => held.has(v))) continue
      let best = -1, bestArea = 0
      for (let u = 0; u < culled.length; u += 3) {
        const cand = [culled[u], culled[u + 1], culled[u + 2]]
        if (!cand.some((v) => tri.includes(v) && !held.has(v))) continue
        const ar = areaOf(cand[0], cand[1], cand[2])
        if (ar > bestArea) { bestArea = ar; best = u }
      }
      if (best < 0) continue
      kept.push(culled[best], culled[best + 1], culled[best + 2])
      held.add(culled[best]); held.add(culled[best + 1]); held.add(culled[best + 2])
    }
    if (!kept.length) return null
    const onHull = new Set()

    // Trim rim slivers. The generator drops a thin triangle when all three of its
    // vertices came from the boundary ring; here the ring is gone, so instead we
    // iteratively drop thin triangles that touch the boundary. A thin triangle
    // with no boundary edge is interior — dropping that would punch a hole, so it
    // stays, and the loop lets it become trimmable once its neighbours go.
    let tris = kept
    for (let pass = 0; pass < 8; pass++) {
      const use = new Map()
      const fan = new Map()          // how many triangles each vertex still has
      for (let t = 0; t < tris.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const u = tris[t + e], v = tris[t + (e + 1) % 3]
          const key = u < v ? u + ':' + v : v + ':' + u
          use.set(key, (use.get(key) || 0) + 1)
          fan.set(u, (fan.get(u) || 0) + 1)
        }
      }
      const next = []
      let dropped = 0
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t], b = tris[t + 1], c = tris[t + 2]
        let onBoundary = 0
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
          if (use.get(u < v ? u + ':' + v : v + ':' + u) === 1) onBoundary++
        }
        // Never strand a vertex. A point placed on the boundary joins its two
        // neighbours as a pair of very thin triangles -- exactly what this trim
        // hunts -- so dropping them deleted the point the user had just added.
        const lastFor = fan.get(a) === 1 || fan.get(b) === 1 || fan.get(c) === 1
        if (onBoundary > 0 && !lastFor && triMinAngle(coords, a, b, c) < 9) {
          dropped++
          fan.set(a, fan.get(a) - 1); fan.set(b, fan.get(b) - 1); fan.set(c, fan.get(c) - 1)
          continue
        }
        next.push(a, b, c)
      }
      if (!dropped || !next.length) break
      tris = next
    }
    if (!tris.length) return null
    // `tris` starts out as the very same array as `kept`; clearing `kept` first
    // would empty both and wipe the mesh whenever the trim dropped nothing.
    if (tris !== kept) {
      kept.length = 0
      for (const v of tris) kept.push(v)
    }

    // a vertex is on the hull when it touches an edge used by only one triangle
    const edgeUse2 = new Map()
    for (let t = 0; t < kept.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const u = kept[t + e], v = kept[t + (e + 1) % 3]
        const key = u < v ? u + ':' + v : v + ':' + u
        edgeUse2.set(key, (edgeUse2.get(key) || 0) + 1)
      }
    }
    onHull.clear()
    for (const [key, n] of edgeUse2) {
      if (n !== 1) continue
      const parts = key.split(':')
      onHull.add(Number(parts[0])); onHull.add(Number(parts[1]))
    }

    const used = new Set(kept)
    const order = []
    for (const v of used) if (onHull.has(v)) order.push(v)
    for (const v of used) if (!onHull.has(v)) order.push(v)
    const remap = new Map()
    order.forEach((v, i) => remap.set(v, i))
    const V = new Float64Array(order.length * 2)
    order.forEach((v, i) => { V[2 * i] = coords[2 * v]; V[2 * i + 1] = coords[2 * v + 1] })
    const T = new Int32Array(kept.length)
    for (let i = 0; i < kept.length; i += 3) {
      const a = remap.get(kept[i]), b = remap.get(kept[i + 1]), c = remap.get(kept[i + 2])
      const o = (V[2 * b] - V[2 * a]) * (V[2 * c + 1] - V[2 * a + 1])
              - (V[2 * b + 1] - V[2 * a + 1]) * (V[2 * c] - V[2 * a])
      if (o < 0) { T[i] = a; T[i + 1] = c; T[i + 2] = b } else { T[i] = a; T[i + 1] = b; T[i + 2] = c }
    }
    let hull = 0
    for (const v of order) { if (onHull.has(v)) hull++; else break }
    return { vertices: V, triangles: T, hull }
  }

  function triMinAngle(coords, a, b, c) {
    const P = [[coords[2 * a], coords[2 * a + 1]], [coords[2 * b], coords[2 * b + 1]], [coords[2 * c], coords[2 * c + 1]]]
    let mn = Infinity
    for (let i = 0; i < 3; i++) {
      const p = P[i], q = P[(i + 1) % 3], r = P[(i + 2) % 3]
      const ux = q[0] - p[0], uy = q[1] - p[1], vx = r[0] - p[0], vy = r[1] - p[1]
      const nu = Math.hypot(ux, uy), nv = Math.hypot(vx, vy)
      if (nu < 1e-12 || nv < 1e-12) return 0
      const cc = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (nu * nv)))
      mn = Math.min(mn, Math.acos(cc) * 180 / Math.PI)
    }
    return mn
  }

  // ---------------------------------------------------------------- loop ---

  function mesher() {
    return (typeof globalThis !== 'undefined' && globalThis.NovaFlowAutoMesh) || null
  }

  /** Even arc-length resampling; a closed path gets its closing segment too. */
  function resampleEven(path, spacing, closed) {
    const n = path.length / 2
    if (n < 2) return Array.from(path)
    const segs = closed ? n : n - 1
    const seg = new Float64Array(segs)
    let total = 0
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n
      seg[i] = Math.hypot(path[2 * j] - path[2 * i], path[2 * j + 1] - path[2 * i + 1])
      total += seg[i]
    }
    if (total < 1e-9) return [path[0], path[1]]
    const count = Math.max(closed ? 3 : 1, Math.round(total / spacing))
    const step = total / count
    const out = []
    let i = 0, acc = 0
    const last = closed ? count - 1 : count
    for (let k = 0; k <= last; k++) {
      const t = Math.min(total, k * step)
      while (i < segs - 1 && acc + seg[i] < t) { acc += seg[i]; i++ }
      const j = (i + 1) % n
      const u = seg[i] > 1e-9 ? Math.min(1, (t - acc) / seg[i]) : 0
      out.push(path[2 * i] + (path[2 * j] - path[2 * i]) * u,
               path[2 * i + 1] + (path[2 * j + 1] - path[2 * i + 1]) * u)
    }
    return out
  }

  /** Box-smooth a path over an arc-length radius `r`; a closed path wraps, an open one keeps its ends. */
  function smoothPath(path, r, closed) {
    const dense = resampleEven(path, 1, closed)
    const n = dense.length / 2
    const k = Math.max(0, Math.round(r))
    if (n < 3 || !k) return dense
    const out = new Array(dense.length)
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) { out[2 * i] = dense[2 * i]; out[2 * i + 1] = dense[2 * i + 1]; continue }
      let sx = 0, sy = 0, c = 0
      for (let d = -k; d <= k; d++) {
        let j = i + d
        if (closed) j = ((j % n) + n) % n
        else if (j < 0 || j >= n) continue
        sx += dense[2 * j]; sy += dense[2 * j + 1]; c++
      }
      out[2 * i] = sx / c; out[2 * i + 1] = sy / c
    }
    return out
  }

  function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx)
    if (Math.abs(d) < 1e-12) return null
    const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d
    const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d
    if (t < 0 || t > 1 || u < 0 || u > 1) return null
    return [ax + (bx - ax) * t, ay + (by - ay) * t]
  }

  /**
   * A hand-drawn ring rarely ends where it began: it overshoots and crosses its own
   * start, or stops just short. Cut it at the crossing, or close the small gap; a
   * stroke that does neither is an open line and stays one.
   */
  function closeStroke(stroke, spacing) {
    const n = stroke.length / 2
    if (n < 3) return { path: Array.from(stroke), closed: false }
    let total = 0
    for (let i = 0; i + 1 < n; i++) total += Math.hypot(stroke[2 * i + 2] - stroke[2 * i], stroke[2 * i + 3] - stroke[2 * i + 1])
    const window = Math.max(3, Math.floor(n * 0.35))
    for (let i = n - 2; i >= Math.max(1, n - 1 - window); i--) {
      for (let j = 0; j < Math.min(window, i - 1); j++) {
        const hit = segmentsCross(stroke[2 * i], stroke[2 * i + 1], stroke[2 * i + 2], stroke[2 * i + 3],
                                  stroke[2 * j], stroke[2 * j + 1], stroke[2 * j + 2], stroke[2 * j + 3])
        if (!hit) continue
        const path = [hit[0], hit[1]]
        for (let k = j + 1; k <= i; k++) path.push(stroke[2 * k], stroke[2 * k + 1])
        return { path, closed: true }
      }
    }
    const gap = Math.hypot(stroke[2 * n - 2] - stroke[0], stroke[2 * n - 1] - stroke[1])
    if (gap < Math.max(1.5 * spacing, 0.12 * total)) return { path: Array.from(stroke), closed: true }
    return { path: Array.from(stroke), closed: false }
  }

  /**
   * Pull ring samples onto the strongest painted edge within `r` of where they were
   * drawn, along the local normal, keeping neighbouring offsets alike (a Viterbi pass
   * over discrete offsets). Where nothing is painted nearby a sample stays put, and
   * no sample ever leaves the shape.
   */
  function snapRing(points, closed, field, w, h, r) {
    const n = points.length / 2
    const K = Math.max(0, Math.round(r))
    if (!field || n < 3 || K < 1) return Array.from(points)
    const { mag, ref, mask } = field
    const nx = new Float64Array(n), ny = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const p = closed ? (i + n - 1) % n : Math.max(0, i - 1)
      const q = closed ? (i + 1) % n : Math.min(n - 1, i + 1)
      const tx = points[2 * q] - points[2 * p], ty = points[2 * q + 1] - points[2 * p + 1]
      const L = Math.hypot(tx, ty) || 1
      nx[i] = -ty / L; ny[i] = tx / L
    }
    const evidence = (i, k) => {
      const x = Math.round(points[2 * i] + k * nx[i]), y = Math.round(points[2 * i + 1] + k * ny[i])
      if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x]) return -1
      return mag[y * w + x] / ref
    }
    const states = 2 * K + 1
    const mu = 0.35, nu = 0.6       // cost of leaving the drawn line; cost of bending away from a neighbour
    // Each profile is scored against its own peak, so a strong edge is a sharp
    // maximum at the ridge rather than a plateau the prior would stop short of;
    // the stake scales with how strong that peak is, so a faint profile is not
    // worth leaving the drawn line for.
    const unary = new Float64Array(n * states)
    const row = new Float64Array(states)
    for (let i = 0; i < n; i++) {
      let peak = 0
      for (let k = -K; k <= K; k++) { row[k + K] = evidence(i, k); if (row[k + K] > peak) peak = row[k + K] }
      const stake = peak > 1 ? 1 : peak
      for (let k = -K; k <= K; k++) {
        const e = row[k + K]
        unary[i * states + k + K] = e < 0 ? 9 : -(peak > 1e-9 ? stake * e / peak : 0) + mu * Math.abs(k) / K
      }
    }
    // a closed ring is run twice around, so the seam does not get a free start
    const seq = closed ? 2 * n : n
    const cost = new Float64Array(seq * states)
    const from = new Int16Array(seq * states)
    for (let s = 0; s < states; s++) cost[s] = unary[s]
    for (let t = 1; t < seq; t++) {
      const i = t % n
      for (let s = 0; s < states; s++) {
        let best = Infinity, arg = s
        for (let p = 0; p < states; p++) {
          const c = cost[(t - 1) * states + p] + nu * Math.abs(s - p) / K
          if (c < best) { best = c; arg = p }
        }
        cost[t * states + s] = best + unary[i * states + s]
        from[t * states + s] = arg
      }
    }
    let s = 0, best = Infinity
    for (let k = 0; k < states; k++) {
      if (cost[(seq - 1) * states + k] < best) { best = cost[(seq - 1) * states + k]; s = k }
    }
    const off = new Int32Array(n)
    for (let t = seq - 1; t >= 0; t--) {
      if (t >= seq - n) off[t - (seq - n)] = s - K
      s = from[t * states + s]
    }
    const out = Array.from(points)
    for (let i = 0; i < n; i++) { out[2 * i] += off[i] * nx[i]; out[2 * i + 1] += off[i] * ny[i] }
    return out
  }

  function distToPolyline(px, py, poly, closed) {
    const n = poly.length / 2
    const segs = closed ? n : n - 1
    let best = Infinity
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n
      const ax = poly[2 * i], ay = poly[2 * i + 1]
      const ex = poly[2 * j] - ax, ey = poly[2 * j + 1] - ay
      const L2 = ex * ex + ey * ey
      let t = L2 < 1e-12 ? 0 : ((px - ax) * ex + (py - ay) * ey) / L2
      t = t < 0 ? 0 : (t > 1 ? 1 : t)
      const dx = ax + t * ex - px, dy = ay + t * ey - py
      const d = dx * dx + dy * dy
      if (d < best) best = d
    }
    return Math.sqrt(best)
  }

  /** The editor's edge evidence, from the generator's structure field when it is loaded. */
  function edgeField(rgba, w, h, mask) {
    const M = mesher()
    if (!M || !M._internals || typeof M._internals.structureField !== 'function') return null
    const F = M._internals.structureField(rgba, w, h, mask, 1.5)
    if (!(F.ref > 1e-6)) return null
    return { mag: F.mag, ref: F.ref, mask }
  }

  /** A freehand stroke, made into evenly spaced ring samples that sit on the painting. */
  function ringFromStroke(stroke, spacing, mask, w, h, field) {
    if (stroke.length < 6) return null
    const { path, closed } = closeStroke(stroke, spacing)
    const smooth = smoothPath(path, 0.3 * spacing, closed)
    const even = resampleEven(smooth, spacing, closed)
    if (even.length < (closed ? 6 : 4)) return null
    const ring = snapRing(even, closed, field, w, h, Math.min(0.35 * spacing, 12))
    return { ring, closed }
  }

  /**
   * Merge a ring into the point set. The interior vertices already inside the ring's
   * corridor go first -- left in place they would stand in for the ring samples and
   * the loop came out as a zigzag of whatever happened to be nearby -- then the ring
   * goes in evenly, yielding only to outline vertices it runs into. With the corridor
   * clear every ring segment is a Gabriel edge, so the Delaunay keeps it as an edge.
   */
  function applyLoop(pts, isHull, ring, closed, spacing, mask, w, h) {
    const next = []
    const corridor = 0.5 * spacing
    let removed = 0
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1]
      if (!isHull(x, y) && distToPolyline(x, y, ring, closed) < corridor) { removed++; continue }
      next.push(x, y)
    }
    let added = 0
    for (let i = 0; i < ring.length; i += 2) {
      const x = ring[i], y = ring[i + 1]
      if (!insideMask(mask, w, h, x, y)) continue
      let near = false
      for (let j = 0; j < next.length && !near; j += 2) {
        if (Math.hypot(next[j] - x, next[j + 1] - y) < 0.4 * spacing) near = true
      }
      if (near) continue
      next.push(x, y); added++
    }
    return { next, added, removed }
  }

  // ------------------------------------------------------------------ UI ---

  function el(tag, style, text) {
    const n = document.createElement(tag)
    if (style) Object.assign(n.style, style)
    if (text != null) n.textContent = text
    return n
  }

  /**
   * @param {ImageData} imageData  the layer's pixels
   * @param {{vertices:Float64Array,triangles:Int32Array,hull:number}} mesh
   * @param {{name?:string}} options
   * @returns {Promise<null|{vertices:Float64Array,triangles:Int32Array,hull:number}>}
   */
  function open(imageData, mesh, options) {
    const C = core()
    if (!C) return Promise.reject(new Error('自动蒙皮模块未加载'))
    const opts = options || {}
    const w = imageData.width, h = imageData.height

    return new Promise((resolve) => {
      const maskArr = buildMask(imageData, opts.alphaThreshold)
      // edge evidence for the loop tool; built off the critical path, once
      let field = null
      let fieldTried = false
      const ensureField = () => {
        if (!fieldTried) { fieldTried = true; try { field = edgeField(imageData.data, w, h, maskArr) } catch { field = null } }
        return field
      }
      /**
       * The only hard limit on a hand-placed vertex is the image itself: a uv outside
       * [0,1] samples past the region and renders garbage. Everything else is the
       * user's call -- in particular a boundary vertex has to be free to move OUTWARD,
       * since pushing the outline out to cover artwork the mesh clipped is the whole
       * point of editing it by hand. Snapping back inside the silhouette (which is
       * what this used to do) made edge vertices feel one-way.
       */
      const clampToImage = (x, y) => [
        Math.min(w, Math.max(0, x)),
        Math.min(h, Math.max(0, y)),
      ]
      let pts = Array.from(mesh.vertices)
      let current = { vertices: Float64Array.from(pts), triangles: mesh.triangles, hull: mesh.hull }
      const undoStack = []
      let tool = 'move'
      let dragIndex = -1
      let stroke = null
      let panning = false
      let panStart = null

      const overlay = el('div', {
        // the primary rail's host sits at 2147483610, so anything lower renders
        // *under* the app chrome instead of over it
        position: 'fixed', inset: '0', zIndex: '2147483640',
        background: 'rgba(8,8,10,0.92)', display: 'flex', flexDirection: 'column',
        fontFamily: 'inherit', userSelect: 'none'
      })
      overlay.setAttribute('data-novaflow-auto-mesh-editor', '1')

      // ---- top bar
      const bar = el('div', {
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '10px 14px', background: '#1d1d1f', flex: '0 0 auto'
      })
      const title = el('span', { fontSize: '13px', fontWeight: '600', color: 'rgba(255,255,255,0.9)', marginRight: '6px' },
        '编辑网格' + (opts.name ? ' · ' + opts.name : ''))
      bar.appendChild(title)

      const toolButtons = {}
      for (const t of TOOLS) {
        const b = el('button', {
          height: '28px', padding: '0 12px', borderRadius: '6px', border: '0',
          cursor: 'pointer', fontSize: '12px', fontWeight: '600'
        }, t.label)
        b.title = t.hint
        b.addEventListener('click', () => { tool = t.id; syncTools() })
        toolButtons[t.id] = b
        bar.appendChild(b)
      }
      // Density stays reachable while editing: leaving the modal just to change
      // it and coming back would throw away the edit in progress.
      if (typeof opts.rebuild === 'function') {
        const dWrap = el('div', { display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '10px' })
        dWrap.appendChild(el('span', { fontSize: '12px', color: 'rgba(255,255,255,0.55)' }, '密度'))
        const dIn = el('input')
        dIn.type = 'range'
        dIn.min = String(opts.minDensity || 2)
        dIn.max = String(opts.maxDensity || 40)
        dIn.step = '1'
        dIn.value = String(opts.density || 22)
        Object.assign(dIn.style, { width: '110px', accentColor: '#22c98a' })
        const dVal = el('span', { fontSize: '12px', color: '#22c98a', fontWeight: '600', width: '20px' },
          String(opts.density || 22))
        dIn.addEventListener('input', () => { dVal.textContent = dIn.value })
        dIn.addEventListener('change', () => {
          const rebuilt = opts.rebuild(Number(dIn.value))
          if (!rebuilt) return
          undoStack.push(pts.slice())
          pts = Array.from(rebuilt.vertices)
          current = { vertices: Float64Array.from(pts), triangles: rebuilt.triangles, hull: rebuilt.hull }
          draw()
        })
        dWrap.appendChild(dIn); dWrap.appendChild(dVal)
        bar.appendChild(dWrap)
      }

      const spacer = el('div', { flex: '1 1 auto' })
      bar.appendChild(spacer)

      const info = el('span', { fontSize: '12px', color: 'rgba(255,255,255,0.55)', marginRight: '10px' })
      bar.appendChild(info)

      const undoBtn = el('button', {
        height: '28px', padding: '0 12px', borderRadius: '6px', border: '0',
        background: '#3a3a3a', color: 'rgba(255,255,255,0.86)', cursor: 'pointer', fontSize: '12px'
      }, '撤销')
      const resetBtn = el('button', {
        height: '28px', padding: '0 12px', borderRadius: '6px', border: '0',
        background: '#3a3a3a', color: 'rgba(255,255,255,0.86)', cursor: 'pointer', fontSize: '12px'
      }, '重置')
      const cancelBtn = el('button', {
        height: '28px', padding: '0 14px', borderRadius: '6px', border: '0',
        background: '#3a3a3a', color: 'rgba(255,255,255,0.86)', cursor: 'pointer', fontSize: '12px'
      }, '取消')
      const okBtn = el('button', {
        height: '28px', padding: '0 16px', borderRadius: '6px', border: '0',
        background: '#1EA672', color: '#ffffff', cursor: 'pointer', fontSize: '12px', fontWeight: '600'
      }, '完成')
      bar.appendChild(undoBtn); bar.appendChild(resetBtn); bar.appendChild(cancelBtn); bar.appendChild(okBtn)
      overlay.appendChild(bar)

      // ---- canvas
      const stage = el('div', { flex: '1 1 auto', position: 'relative', overflow: 'hidden' })
      const canvas = el('canvas', { position: 'absolute', inset: '0', cursor: 'crosshair' })
      stage.appendChild(canvas)
      overlay.appendChild(stage)

      const tip = el('div', {
        padding: '8px 14px', background: '#161618', fontSize: '11px',
        color: 'rgba(255,255,255,0.45)', flex: '0 0 auto'
      }, '滚轮缩放 · 右键/中键拖动平移 · 顶点不能拖出图层范围')
      overlay.appendChild(tip)

      document.body.appendChild(overlay)

      // source image as a canvas we can draw scaled
      const src = document.createElement('canvas')
      src.width = w; src.height = h
      src.getContext('2d').putImageData(imageData, 0, 0)

      const view = { scale: 1, ox: 0, oy: 0 }
      const ctx = canvas.getContext('2d')

      function fit() {
        const r = stage.getBoundingClientRect()
        canvas.width = Math.max(1, Math.round(r.width))
        canvas.height = Math.max(1, Math.round(r.height))
        const s = Math.min(canvas.width / w, canvas.height / h) * 0.86
        view.scale = s
        view.ox = (canvas.width - w * s) / 2
        view.oy = (canvas.height - h * s) / 2
      }
      const toScreen = (x, y) => [x * view.scale + view.ox, y * view.scale + view.oy]
      const toImage = (x, y) => [(x - view.ox) / view.scale, (y - view.oy) / view.scale]

      function syncTools() {
        for (const t of TOOLS) {
          const b = toolButtons[t.id]
          b.style.background = tool === t.id ? '#1EA672' : '#3a3a3a'
          b.style.color = tool === t.id ? '#ffffff' : 'rgba(255,255,255,0.86)'
        }
        canvas.style.cursor = tool === 'move' ? 'default' : 'crosshair'
      }

      function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(src, view.ox, view.oy, w * view.scale, h * view.scale)
        const V = current.vertices, T = current.triangles
        ctx.lineWidth = 1
        ctx.strokeStyle = 'rgba(0,240,150,0.85)'
        ctx.beginPath()
        for (let t = 0; t < T.length; t += 3) {
          for (let e = 0; e < 3; e++) {
            const a = T[t + e], b = T[t + (e + 1) % 3]
            const [ax, ay] = toScreen(V[2 * a], V[2 * a + 1])
            const [bx, by] = toScreen(V[2 * b], V[2 * b + 1])
            ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
          }
        }
        ctx.stroke()
        for (let i = 0; i < V.length / 2; i++) {
          const [x, y] = toScreen(V[2 * i], V[2 * i + 1])
          ctx.beginPath()
          ctx.arc(x, y, i === dragIndex ? 5 : 3.2, 0, Math.PI * 2)
          ctx.fillStyle = i < current.hull ? '#ff5f5f' : '#8ccdff'
          ctx.fill()
        }
        if (stroke && stroke.length >= 4) {
          ctx.strokeStyle = '#ffd24a'
          ctx.lineWidth = 2
          ctx.beginPath()
          const [sx, sy] = toScreen(stroke[0], stroke[1])
          ctx.moveTo(sx, sy)
          for (let i = 1; i < stroke.length / 2; i++) {
            const [px, py] = toScreen(stroke[2 * i], stroke[2 * i + 1])
            ctx.lineTo(px, py)
          }
          ctx.stroke()
        }
        info.textContent = `${current.vertices.length / 2} 顶点 · ${current.triangles.length / 3} 三角形`
      }

      function commit(nextPts, label) {
        const rebuilt = retriangulate(nextPts, maskArr, w, h)
        if (!rebuilt) return false
        undoStack.push(pts.slice())
        if (undoStack.length > 60) undoStack.shift()
        pts = nextPts
        current = rebuilt
        draw()
        return true
      }

      function pickVertex(ix, iy) {
        const V = current.vertices
        const r = 10 / view.scale
        let best = -1, bestD = r * r
        for (let i = 0; i < V.length / 2; i++) {
          const dx = V[2 * i] - ix, dy = V[2 * i + 1] - iy
          const d = dx * dx + dy * dy
          if (d < bestD) { bestD = d; best = i }
        }
        return best
      }

      /** current.vertices is a reordered view of `pts`; map back by position. */
      function ptsIndexOf(vx, vy) {
        for (let i = 0; i < pts.length / 2; i++) {
          if (Math.abs(pts[2 * i] - vx) < 1e-6 && Math.abs(pts[2 * i + 1] - vy) < 1e-6) return i
        }
        return -1
      }

      // ---- interaction
      function zoomAt(clientX, clientY, deltaY) {
        const rect = canvas.getBoundingClientRect()
        const mx = clientX - rect.left, my = clientY - rect.top
        const [ix, iy] = toImage(mx, my)
        const f = deltaY < 0 ? 1.12 : 1 / 1.12
        view.scale = Math.max(0.05, Math.min(40, view.scale * f))
        view.ox = mx - ix * view.scale
        view.oy = my - iy * view.scale
        draw()
      }

      function beginPan(ev) {
        const rect = canvas.getBoundingClientRect()
        panning = true
        panStart = [ev.clientX - rect.left - view.ox, ev.clientY - rect.top - view.oy]
        if (typeof ev.pointerId === 'number') capture(ev.pointerId)
      }

      // Capturing is a convenience, not a precondition: it throws NotFoundError
      // for a pointer the browser no longer considers active, and letting that
      // escape would abort the edit the user just started.
      const capture = (id) => { try { canvas.setPointerCapture(id) } catch { /* not capturable */ } }

      // otherwise the browser menu eats the right-drag
      canvas.addEventListener('contextmenu', (ev) => ev.preventDefault())

      canvas.addEventListener('pointerdown', (ev) => {
        const rect = canvas.getBoundingClientRect()
        const mx = ev.clientX - rect.left, my = ev.clientY - rect.top
        // right button pans too: middle-drag alone is awkward on a trackpad.
        // Buttons 1 and 2 are claimed on window capture before the app can take
        // them; shift+left still arrives here.
        if (ev.button === 1 || ev.button === 2 || ev.shiftKey) { beginPan(ev); return }
        if (ev.button !== 0) return
        const [ix, iy] = toImage(mx, my)
        capture(ev.pointerId)
        if (tool === 'move') {
          dragIndex = pickVertex(ix, iy)
          draw()
        } else if (tool === 'add') {
          // a click meant for the outline lands a hair outside it as often as not,
          // and a point just outside is a legitimate thing to want
          const at = clampToImage(ix, iy)
          const next = pts.slice(); next.push(at[0], at[1])
          commit(next, 'add')
        } else if (tool === 'delete') {
          const vi = pickVertex(ix, iy)
          if (vi < 0) return
          const pi = ptsIndexOf(current.vertices[2 * vi], current.vertices[2 * vi + 1])
          if (pi < 0) return
          const next = pts.slice(); next.splice(2 * pi, 2)
          commit(next, 'delete')
        } else if (tool === 'loop') {
          stroke = [ix, iy]
        }
      })

      canvas.addEventListener('pointermove', (ev) => {
        const rect = canvas.getBoundingClientRect()
        const mx = ev.clientX - rect.left, my = ev.clientY - rect.top
        if (panning && panStart) {
          view.ox = mx - panStart[0]; view.oy = my - panStart[1]
          draw(); return
        }
        const [ix, iy] = toImage(mx, my)
        if (tool === 'move' && dragIndex >= 0) {
          const at = clampToImage(ix, iy)
          const V = current.vertices
          const pi = ptsIndexOf(V[2 * dragIndex], V[2 * dragIndex + 1])
          if (pi < 0) return
          pts[2 * pi] = at[0]; pts[2 * pi + 1] = at[1]
          V[2 * dragIndex] = at[0]; V[2 * dragIndex + 1] = at[1]
          draw()
        } else if (tool === 'loop' && stroke) {
          const lx = stroke[stroke.length - 2], ly = stroke[stroke.length - 1]
          if (Math.hypot(ix - lx, iy - ly) > 2 / view.scale) { stroke.push(ix, iy); draw() }
        }
      })

      canvas.addEventListener('pointerup', (ev) => {
        try { canvas.releasePointerCapture(ev.pointerId) } catch { /* not captured */ }
        if (panning) { panning = false; panStart = null; return }
        if (tool === 'move' && dragIndex >= 0) {
          // re-run the triangulation once, at the end of the drag
          const next = pts.slice()
          dragIndex = -1
          commit(next, 'move')
          return
        }
        if (tool === 'loop' && stroke) {
          const spacing = Math.max(3, estimateSpacing(current) * 0.9)
          const drawn = ringFromStroke(stroke, spacing, maskArr, w, h, ensureField())
          stroke = null
          if (!drawn) { draw(); return }
          // outline vertices are the silhouette; the ring yields to them, never the reverse
          const hull = new Set()
          for (let i = 0; i < current.hull; i++) hull.add(current.vertices[2 * i] + ',' + current.vertices[2 * i + 1])
          const isHull = (x, y) => hull.has(x + ',' + y)
          const merged = applyLoop(pts, isHull, drawn.ring, drawn.closed, spacing, maskArr, w, h)
          if (merged.added >= 2) commit(merged.next, 'loop'); else draw()
        }
      })

      function estimateSpacing(m) {
        const V = m.vertices, T = m.triangles
        if (!T.length) return 10
        let sum = 0, n = 0
        for (let t = 0; t < T.length; t += 3) {
          for (let e = 0; e < 3; e++) {
            const a = T[t + e], b = T[t + (e + 1) % 3]
            sum += Math.hypot(V[2 * a] - V[2 * b], V[2 * a + 1] - V[2 * b + 1]); n++
          }
        }
        return n ? sum / n : 10
      }

      const onKey = (ev) => {
        if (ev.key === 'Escape') { finish(null) }
        else if (ev.key === 'Enter') { finish(current) }
        else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { undo() }
        else if (ev.key === '1') { tool = 'move'; syncTools() }
        else if (ev.key === '2') { tool = 'add'; syncTools() }
        else if (ev.key === '3') { tool = 'delete'; syncTools() }
        else if (ev.key === '4') { tool = 'loop'; syncTools() }
      }

      function undo() {
        if (!undoStack.length) return
        pts = undoStack.pop()
        const rebuilt = retriangulate(pts, maskArr, w, h)
        if (rebuilt) current = rebuilt
        draw()
      }

      undoBtn.addEventListener('click', undo)
      resetBtn.addEventListener('click', () => {
        undoStack.push(pts.slice())
        pts = Array.from(mesh.vertices)
        current = { vertices: Float64Array.from(pts), triangles: mesh.triangles, hull: mesh.hull }
        draw()
      })
      cancelBtn.addEventListener('click', () => finish(null))
      okBtn.addEventListener('click', () => finish(current))

      let done = false
      function finish(result) {
        if (done) return
        done = true
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('resize', onResize)
        for (const type of CLAIMED_INPUT) window.removeEventListener(type, onClaimedInput, true)
        if (overlay.parentElement) overlay.parentElement.removeChild(overlay)
        resolve(result ? { vertices: result.vertices, triangles: result.triangles, hull: result.hull } : null)
      }

      const onResize = () => { fit(); draw() }
      /**
       * The app's preview zoom and camera pan sit on document-capture listeners that
       * decide by CURSOR POSITION rather than by target, so with this modal open on top
       * of the preview they still claim the wheel and the right-drag -- and then call
       * stopImmediatePropagation, which left the editor with nothing and scrolled the
       * board behind instead. Capture on window runs before any document listener, so
       * take what belongs to the editor here.
       */
      const onClaimedInput = (ev) => {
        if (done) return
        if (ev.type === 'wheel') {
          ev.preventDefault(); ev.stopImmediatePropagation()
          zoomAt(ev.clientX, ev.clientY, ev.deltaY)
          return
        }
        if (ev.type === 'contextmenu') { ev.preventDefault(); ev.stopImmediatePropagation(); return }
        if (ev.button === 1 || ev.button === 2) {
          ev.preventDefault(); ev.stopImmediatePropagation()
          if (ev.type === 'pointerdown') beginPan(ev)
        }
      }
      for (const type of CLAIMED_INPUT) {
        window.addEventListener(type, onClaimedInput, { capture: true, passive: false })
      }
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('resize', onResize)

      fit()
      syncTools()
      draw()
      setTimeout(ensureField, 0)
    })
  }

  return {
    open, retriangulate, TOOLS,
    _internals: { ringFromStroke, closeStroke, smoothPath, resampleEven, snapRing, applyLoop, distToPolyline }
  }
})
