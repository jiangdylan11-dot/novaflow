/*
 * NovaFlow — 自动蒙皮 weight editor (the manual half of 自动权重).
 *
 * Spine-style weight painting for one layer: pick a bone from the layer's list,
 * paint vertices with a soft round brush in one of three modes — 直接 sets the
 * bone's weight to the slider value, 叠加 adds to it, 平滑 blends each vertex
 * with its neighbours — while every row keeps summing to one. 饼图 draws every
 * vertex as a pie of its bones, 叠加 shades the selected bone's weight. 自动 asks
 * the caller to re-solve the layer for the current bone list, 平滑 and 修剪
 * clean the whole layer.
 *
 * The solver cannot know an eyelid from a lip corner or where a slide controller
 * should reach; this is where the artist finishes the last 5%.
 *
 * `open(imageData, mesh, options)` resolves to {boneIds, weights} or null.
 *   options.bones    every paintable skeleton bone: {index, name, ax, ay, bx, by} in IMAGE px
 *   options.boneIds  the layer's current bone set (skeleton bone indices)
 *   options.weights  Float64Array n×nb, row-major over boneIds, or null
 *   options.auto     (boneIds) => Float64Array n×nb | null  — re-solve callback
 *   options.name     layer name for the title
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAutoWeightsEditor = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const CLAIMED_INPUT = ['wheel', 'contextmenu', 'pointerdown', 'mousedown']
  const MODES = [
    { id: 'set', label: '直接', hint: '点选一个顶点,上下拖动调它在选中骨骼上的权重(权重滑条也作用于它)' },
    { id: 'add', label: '增加', hint: '笔刷:按住涂抹,逐渐增加选中骨骼的权重' },
    { id: 'sub', label: '减少', hint: '笔刷:按住涂抹,逐渐减少选中骨骼的权重' }
  ]
  const PALETTE = [
    '#4cc9f0', '#f72585', '#7b5cff', '#ff7f11', '#7ae582', '#ffd166', '#ef476f', '#06d6a0',
    '#c77dff', '#ff9e00', '#48bfe3', '#f9c74f', '#90be6d', '#f8961e', '#577590', '#e07a5f'
  ]
  const boneColor = (index) => PALETTE[Math.abs(index | 0) % PALETTE.length]

  // ------------------------------------------------------------ geometry ---

  /** Vertex → neighbouring vertices, from the triangle list. */
  function adjacency(n, T) {
    const adj = new Array(n)
    for (let i = 0; i < n; i++) adj[i] = new Set()
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t], b = T[t + 1], c = T[t + 2]
      adj[a].add(b); adj[a].add(c); adj[b].add(a); adj[b].add(c); adj[c].add(a); adj[c].add(b)
    }
    return adj.map((s) => Array.from(s))
  }

  /** Scale the other bones so the row sums to one around a fixed value for `sel`. */
  function rebalance(W, nb, i, sel) {
    const base = i * nb
    let v = Math.max(0, Math.min(1, W[base + sel]))
    let others = 0
    for (let j = 0; j < nb; j++) if (j !== sel) others += W[base + j]
    if (others <= 1e-12) {
      // nothing else holds this vertex: the selected bone must take it whole
      for (let j = 0; j < nb; j++) W[base + j] = 0
      W[base + sel] = 1
      return
    }
    const k = (1 - v) / others
    for (let j = 0; j < nb; j++) if (j !== sel) W[base + j] *= k
    W[base + sel] = v
  }

  function normalizeRow(W, nb, i) {
    const base = i * nb
    let s = 0
    for (let j = 0; j < nb; j++) { if (W[base + j] < 0) W[base + j] = 0; s += W[base + j] }
    if (s <= 1e-12) return false
    for (let j = 0; j < nb; j++) W[base + j] /= s
    return true
  }

  /** hits: [{i, f}] with f in (0,1]. 直接: move the bone's weight toward `target` by f. */
  function paintSet(W, nb, sel, hits, target) {
    for (const { i, f } of hits) {
      const base = i * nb
      W[base + sel] += (target - W[base + sel]) * f
      rebalance(W, nb, i, sel)
    }
  }

  /** 叠加: add `amount·f` to the bone's weight. */
  function paintAdd(W, nb, sel, hits, amount) {
    for (const { i, f } of hits) {
      const base = i * nb
      W[base + sel] = Math.min(1, W[base + sel] + amount * f)
      rebalance(W, nb, i, sel)
    }
  }

  /** 减少: take `amount·f` off the bone's weight (the others share what it gives up). */
  function paintSub(W, nb, sel, hits, amount) {
    for (const { i, f } of hits) {
      const base = i * nb
      W[base + sel] = Math.max(0, W[base + sel] - amount * f)
      rebalance(W, nb, i, sel)
    }
  }

  /** 平滑: blend each hit vertex toward the mean of its neighbours by f. */
  function paintSmooth(W, nb, adj, hits, strength) {
    const snapshot = Float64Array.from(W)
    for (const { i, f } of hits) {
      const nbrs = adj[i]
      if (!nbrs || !nbrs.length) continue
      const base = i * nb
      for (let j = 0; j < nb; j++) {
        let m = 0
        for (const k of nbrs) m += snapshot[k * nb + j]
        m /= nbrs.length
        W[base + j] += (m - W[base + j]) * f * strength
      }
      normalizeRow(W, nb, i)
    }
  }

  /** One umbrella pass over every vertex (the 平滑 button). */
  function smoothAll(W, n, nb, adj, lambda) {
    const out = Float64Array.from(W)
    for (let i = 0; i < n; i++) {
      const nbrs = adj[i]
      if (!nbrs || !nbrs.length) continue
      for (let j = 0; j < nb; j++) {
        let m = 0
        for (const k of nbrs) m += W[k * nb + j]
        out[i * nb + j] = W[i * nb + j] * (1 - lambda) + (m / nbrs.length) * lambda
      }
      normalizeRow(out, nb, i)
    }
    W.set(out)
  }

  /** Drop influences below `min`, keep the `maxInf` strongest, renormalise. */
  function prune(W, n, nb, min, maxInf) {
    for (let i = 0; i < n; i++) {
      const base = i * nb
      const order = []
      for (let j = 0; j < nb; j++) order.push(j)
      order.sort((a, b) => W[base + b] - W[base + a])
      for (let k = 0; k < nb; k++) {
        const j = order[k]
        if (k >= maxInf || W[base + j] < min) W[base + j] = 0
      }
      if (!normalizeRow(W, nb, i)) { W[base + order[0]] = 1 }
    }
  }

  /** Soft round brush: weight 1 at the centre falling to 0 at the radius. */
  function brushHits(V, n, x, y, r, strength) {
    const hits = []
    const r2 = r * r
    for (let i = 0; i < n; i++) {
      const dx = V[2 * i] - x, dy = V[2 * i + 1] - y
      const d2 = dx * dx + dy * dy
      if (d2 > r2) continue
      const u = 1 - d2 / r2
      hits.push({ i, f: Math.min(1, strength * (window.NovaFlowSoftBrush ? window.NovaFlowSoftBrush.strength(Math.sqrt(d2), 0, r) : u * u)) })
    }
    return hits
  }

  /** image px -> screen affine for one triangle, from its three image corners and screen corners */
  function triAffine(p0x, p0y, p1x, p1y, p2x, p2y, q0x, q0y, q1x, q1y, q2x, q2y) {
    const dx1 = p1x - p0x, dy1 = p1y - p0y, dx2 = p2x - p0x, dy2 = p2y - p0y
    const det = dx1 * dy2 - dy1 * dx2
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null
    const ux1 = q1x - q0x, uy1 = q1y - q0y, ux2 = q2x - q0x, uy2 = q2y - q0y
    const a = (ux1 * dy2 - ux2 * dy1) / det
    const c = (ux2 * dx1 - ux1 * dx2) / det
    const b = (uy1 * dy2 - uy2 * dy1) / det
    const d = (uy2 * dx1 - uy1 * dx2) / det
    return [a, b, c, d, q0x - a * p0x - c * p0y, q0y - b * p0x - d * p0y]
  }

  /** One bone on the canvas: halo + line + head, or a ringed crosshair when it has no length. */
  function drawBoneGlyph(ctx, ax, ay, bx, by, color, name, isSel, inSet) {
    const len = Math.hypot(bx - ax, by - ay)
    ctx.save()
    ctx.globalAlpha = inSet ? 1 : 0.55
    ctx.lineCap = 'round'
    if (len > 1) {
      ctx.lineWidth = (isSel ? 5 : 3) + 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
      ctx.lineWidth = isSel ? 5 : 3; ctx.strokeStyle = color
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
      ctx.beginPath(); ctx.arc(ax, ay, isSel ? 8 : 6, 0, Math.PI * 2)
      ctx.fillStyle = color; ctx.fill()
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke()
    } else {
      const r = isSel ? 10 : 8
      ctx.beginPath(); ctx.arc(ax, ay, r + 2, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill()
      ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2)
      ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.stroke()
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.95)'
      ctx.beginPath(); ctx.arc(ax, ay, r - 3, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(ax - r - 4, ay); ctx.lineTo(ax + r + 4, ay)
      ctx.moveTo(ax, ay - r - 4); ctx.lineTo(ax, ay + r + 4)
      ctx.stroke()
    }
    if (inSet || isSel) {
      ctx.font = (isSel ? '700 ' : '') + '11px sans-serif'
      const tw = ctx.measureText(name).width
      const lx = ax + (len > 1 ? 10 : 14), ly = ay - (len > 1 ? 10 : 12)
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(lx - 3, ly - 11, tw + 6, 15)
      ctx.fillStyle = isSel ? '#ffffff' : 'rgba(255,255,255,0.92)'
      ctx.fillText(name, lx, ly)
    }
    ctx.restore()
  }

  /** Column bookkeeping when the layer's bone list changes. */
  function addBoneColumn(W, n, nb) {
    const out = new Float64Array(n * (nb + 1))
    for (let i = 0; i < n; i++) for (let j = 0; j < nb; j++) out[i * (nb + 1) + j] = W[i * nb + j]
    return out
  }
  function removeBoneColumn(W, n, nb, col) {
    const out = new Float64Array(n * (nb - 1))
    for (let i = 0; i < n; i++) {
      let k = 0, best = -1
      for (let j = 0; j < nb; j++) {
        if (j === col) continue
        out[i * (nb - 1) + k] = W[i * nb + j]
        if (best < 0 || out[i * (nb - 1) + k] > out[i * (nb - 1) + best]) best = k
        k++
      }
      if (nb - 1 > 0 && !normalizeRow(out, nb - 1, i)) out[i * (nb - 1) + Math.max(0, best)] = 1
    }
    return out
  }

  // ------------------------------------------------------------------ UI ---

  function el(tag, style, text) {
    const node = document.createElement(tag)
    if (style) Object.assign(node.style, style)
    if (text !== undefined) node.textContent = text
    return node
  }
  function button(label, primary) {
    const b = el('button', {
      height: '28px', padding: '0 12px', borderRadius: '6px', border: '0', cursor: 'pointer',
      fontSize: '12px', fontWeight: primary ? '600' : '600', whiteSpace: 'nowrap',
      background: primary ? '#22c98a' : '#3a3a3a', color: primary ? '#062a18' : 'rgba(255,255,255,0.86)'
    }, label)
    return b
  }
  function colormap(v) {
    const c = Math.max(0, Math.min(1, v)) * 4, seg = Math.floor(c), f = c - seg
    const stops = [[30, 40, 200], [30, 200, 220], [60, 210, 60], [240, 220, 40], [230, 40, 30], [230, 40, 30]]
    const a = stops[seg], b = stops[seg + 1]
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`
  }

  function open(imageData, mesh, options) {
    const opts = options || {}
    const w = imageData.width, h = imageData.height
    const V = Float64Array.from(mesh.vertices)
    const T = Array.from(mesh.triangles)
    const n = V.length / 2
    const adj = adjacency(n, T)
    const allBones = Array.isArray(opts.bones) ? opts.bones.slice() : []
    const boneByIndex = new Map(allBones.map((b) => [b.index, b]))

    return new Promise((resolve) => {
      let boneIds = Array.isArray(opts.boneIds) ? opts.boneIds.slice() : []
      let nb = boneIds.length
      let W = opts.weights && opts.weights.length === n * nb ? Float64Array.from(opts.weights) : new Float64Array(n * nb)
      if (!opts.weights && nb) { for (let i = 0; i < n; i++) W[i * nb] = 1 }
      const initial = { boneIds: boneIds.slice(), W: Float64Array.from(W) }
      let sel = nb ? 0 : -1
      let mode = 'set'
      let strength = 1
      let radius = Math.max(4, (opts.brushRadius || estimateEdge() * 1.5))
      let showPie = true
      let showOverlay = false
      const undoStack = []
      let painting = false
      let lastStamp = null
      let hover = null
      let panning = false, panStart = null
      let pickV = -1, pickDrag = null      // 直接: the vertex being set and its drag start
      let drawFrame = 0
      // one redraw per frame: drawing every pie on every pointer move made painting stutter
      const requestDraw = () => {
        if (drawFrame) return
        drawFrame = window.requestAnimationFrame(() => { drawFrame = 0; if (!done) draw() })
      }
      // ---- animation preview: the layer posed by the running preview through the
      // weights being edited (linear blend skinning in the bind-pose bone frames),
      // so a stroke is seen deforming the picture at once instead of after 完成
      const live = opts.live && typeof opts.live.boneWorld === 'function' ? opts.live : null
      let animOn = false
      let posed = null                  // image-space positions of the posed vertices
      let poseWorld = null
      const localByBone = new Map()     // bone index -> every vertex in that bone's bind frame
      let tick = 0

      let meanEdge = 10
      function estimateEdge() {
        let s = 0, c = 0
        for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) {
          const a = T[t + e], b = T[t + (e + 1) % 3]
          s += Math.hypot(V[2 * a] - V[2 * b], V[2 * a + 1] - V[2 * b + 1]); c++
        }
        return c ? s / c : 10
      }

      const overlay = el('div', {
        position: 'fixed', inset: '0', zIndex: '2147483640',
        background: 'rgba(8,8,10,0.92)', display: 'flex', flexDirection: 'column',
        fontFamily: 'inherit', userSelect: 'none'
      })
      overlay.setAttribute('data-novaflow-auto-weights-editor', '1')
      // the brand runtime leaves this full-screen editor alone: every redraw's text / slider
      // change ran its modal scan and a page layout pass (painting got ~8 frames a second)
      overlay.setAttribute('data-novaflow-runtime-ignore', '1')

      // ---- top bar
      const bar = el('div', { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', background: '#1d1d1f', flex: '0 0 auto', flexWrap: 'wrap' })
      bar.appendChild(el('span', { fontSize: '13px', fontWeight: '600', color: 'rgba(255,255,255,0.9)', marginRight: '6px' }, '编辑权重' + (opts.name ? ' · ' + opts.name : '')))
      const modeButtons = {}
      for (const m of MODES) {
        const b = button(m.label)
        b.title = m.hint
        b.addEventListener('click', () => { mode = m.id; syncBar() })
        modeButtons[m.id] = b
        bar.appendChild(b)
      }
      const sliderWrap = (label, min, max, step, value, onInput) => {
        const wrap = el('div', { display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' })
        wrap.appendChild(el('span', { fontSize: '12px', color: 'rgba(255,255,255,0.55)' }, label))
        const input = el('input')
        input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value)
        Object.assign(input.style, { width: '110px', accentColor: '#22c98a' })
        const val = el('span', { fontSize: '12px', color: '#22c98a', fontWeight: '600', minWidth: '30px' }, String(value))
        input.addEventListener('input', () => { val.textContent = input.value; onInput(Number(input.value)) })
        wrap.appendChild(input); wrap.appendChild(val)
        return { wrap, input, val }
      }
      const strengthUi = sliderWrap('权重', 0, 1, 0.05, strength, (v) => {
        strength = v
        // 直接: the slider sets the picked vertex
        if (mode === 'set' && pickV >= 0 && sel >= 0) { pushUndo(); W[pickV * nb + sel] = v; rebalance(W, nb, pickV, sel); requestDraw() }
      })
      const radiusUi = sliderWrap('半径', 2, Math.max(20, Math.round(Math.min(w, h) / 3)), 1, Math.round(radius), (v) => { radius = v; draw() })
      bar.appendChild(strengthUi.wrap); bar.appendChild(radiusUi.wrap)

      const toggle = (label, on, onChange) => {
        const lab = el('label', { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'rgba(255,255,255,0.7)', marginLeft: '8px', cursor: 'pointer' })
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = on; cb.style.accentColor = '#22c98a'
        cb.addEventListener('change', () => { onChange(cb.checked); draw() })
        lab.appendChild(cb); lab.appendChild(document.createTextNode(label))
        return lab
      }
      bar.appendChild(toggle('饼图', showPie, (v) => { showPie = v }))
      bar.appendChild(toggle('叠加', showOverlay, (v) => { showOverlay = v }))

      const autoBtn = button('自动'); autoBtn.title = '按当前骨骼列表重新自动求解这一层的权重'
      const smoothBtn = button('平滑'); smoothBtn.title = '整层做一次平滑'
      autoBtn.style.marginLeft = '8px'
      bar.appendChild(autoBtn); bar.appendChild(smoothBtn)

      // ---- animation preview controls, only when a running preview is there to pose it
      let playBtn = null, timeUi = null
      if (live) {
        const animToggle = toggle('动画', animOn, (v) => { animOn = v; if (v) { pose(); loop() } else { posed = null } })
        animToggle.title = '用预览里正在播放的动画摆这一层,权重一改立刻看到变形'
        animToggle.style.marginLeft = '12px'
        bar.appendChild(animToggle)
        playBtn = button(live.playing() ? '⏸' : '▶')
        playBtn.title = '播放 / 暂停预览动画'
        playBtn.addEventListener('click', () => { if (live.playing()) live.pause(); else live.play(); syncAnim() })
        bar.appendChild(playBtn)
        timeUi = sliderWrap('时间', 0, Math.max(0.01, live.duration()), 0.01, 0, (v) => { live.setTime(v); if (!animOn) return; pose(); draw() })
        timeUi.wrap.style.marginLeft = '4px'
        bar.appendChild(timeUi.wrap)
      }
      function syncAnim() {
        if (!live) return
        playBtn.textContent = live.playing() ? '⏸' : '▶'
        if (document.activeElement !== timeUi.input) {
          const t = live.time()
          timeUi.input.value = String(t)
          timeUi.val.textContent = t.toFixed(2)
        }
      }
      function pose() {
        if (!live || !nb) { posed = null; return }
        if (!posed) { posed = new Float64Array(2 * n); poseWorld = new Float64Array(2 * n) }
        const mats = boneIds.map((id) => live.boneWorld(id))
        const locals = boneIds.map((id) => {
          let L = localByBone.get(id)
          if (!L) { L = live.localOf(id); localByBone.set(id, L) }
          return L
        })
        for (let i = 0; i < n; i++) {
          let x = 0, y = 0, sum = 0
          for (let j = 0; j < nb; j++) {
            const wgt = W[i * nb + j]
            if (wgt <= 0) continue
            const M = mats[j], L = locals[j]
            if (!M || !L) continue
            const lx = L[2 * i], ly = L[2 * i + 1]
            x += wgt * (M.a * lx + M.b * ly + M.worldX)
            y += wgt * (M.c * lx + M.d * ly + M.worldY)
            sum += wgt
          }
          if (sum > 1e-9) { x /= sum; y /= sum } else { x = live.world[2 * i]; y = live.world[2 * i + 1] }
          poseWorld[2 * i] = x; poseWorld[2 * i + 1] = y
          const p = live.toImage(x, y)
          posed[2 * i] = p[0]; posed[2 * i + 1] = p[1]
        }
      }
      // one frame per rAF, with a timer behind it; a token keeps the loser of that race from
      // running the same frame twice (that doubling is what once leaked a renderer to death)
      function loop() {
        const step = () => {
          if (done || !animOn) return
          const my = ++tick
          pose(); draw(); syncAnim()
          const run = () => { if (my === tick) step() }
          try { window.requestAnimationFrame(run) } catch { /* timer below */ }
          window.setTimeout(run, 40)
        }
        step()
      }
      /** the picture posed: each triangle carried from its bind position to its posed one */
      function drawPosedImage() {
        for (let t = 0; t + 2 < T.length; t += 3) {
          const a = T[t], b = T[t + 1], c = T[t + 2]
          const [ax, ay] = toScreen(posed[2 * a], posed[2 * a + 1])
          const [bx, by] = toScreen(posed[2 * b], posed[2 * b + 1])
          const [cx, cy] = toScreen(posed[2 * c], posed[2 * c + 1])
          const M = triAffine(V[2 * a], V[2 * a + 1], V[2 * b], V[2 * b + 1], V[2 * c], V[2 * c + 1], ax, ay, bx, by, cx, cy)
          if (!M) continue
          const x0 = Math.max(0, Math.floor(Math.min(V[2 * a], V[2 * b], V[2 * c])) - 1)
          const y0 = Math.max(0, Math.floor(Math.min(V[2 * a + 1], V[2 * b + 1], V[2 * c + 1])) - 1)
          const x1 = Math.min(w, Math.ceil(Math.max(V[2 * a], V[2 * b], V[2 * c])) + 1)
          const y1 = Math.min(h, Math.ceil(Math.max(V[2 * a + 1], V[2 * b + 1], V[2 * c + 1])) + 1)
          if (x1 <= x0 || y1 <= y0) continue
          ctx.save()
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy); ctx.closePath()
          ctx.clip()
          ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5])
          ctx.drawImage(src, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0)
          ctx.restore()
        }
      }
      overlay.__anim = () => ({ on: animOn, world: poseWorld ? Array.from(poseWorld) : null, posed: posed ? Array.from(posed) : null })

      bar.appendChild(el('div', { flex: '1 1 auto' }))
      const info = el('span', { fontSize: '12px', color: 'rgba(255,255,255,0.55)', marginRight: '10px' })
      bar.appendChild(info)
      const undoBtn = button('撤销'), resetBtn = button('重置'), cancelBtn = button('取消'), okBtn = button('完成', true)
      bar.appendChild(undoBtn); bar.appendChild(resetBtn); bar.appendChild(cancelBtn); bar.appendChild(okBtn)
      overlay.appendChild(bar)

      // ---- body: bone list + canvas
      const body = el('div', { flex: '1 1 auto', display: 'flex', minHeight: '0' })
      const side = el('div', { flex: '0 0 200px', background: '#161618', padding: '10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' })
      side.appendChild(el('div', { fontSize: '12px', color: 'rgba(255,255,255,0.55)', marginBottom: '4px' }, '骨骼'))
      const boneList = el('div', { display: 'flex', flexDirection: 'column', gap: '3px' })
      side.appendChild(boneList)
      const addSel = el('select', { marginTop: '8px', height: '26px', background: '#2a2a2a', color: 'rgba(255,255,255,0.85)', border: '0', borderRadius: '6px', fontSize: '12px', padding: '0 6px' })
      side.appendChild(addSel)
      body.appendChild(side)
      const stage = el('div', { flex: '1 1 auto', position: 'relative', overflow: 'hidden' })
      const canvas = el('canvas', { position: 'absolute', inset: '0', cursor: 'crosshair' })
      stage.appendChild(canvas)
      body.appendChild(stage)
      overlay.appendChild(body)
      overlay.appendChild(el('div', { padding: '8px 14px', background: '#161618', fontSize: '11px', color: 'rgba(255,255,255,0.45)', flex: '0 0 auto' },
        '直接:点选顶点上下拖动 · 增加/减少:左键涂抹 · 拖动左侧骨骼调整顺序 · 滚轮缩放 · 右键/中键平移 · 1/2/3 切换 · [ ] 调半径 · Ctrl+Z 撤销 · Enter 完成 · Esc 取消'))
      document.body.appendChild(overlay)

      const src = document.createElement('canvas')
      src.width = w; src.height = h
      src.getContext('2d').putImageData(imageData, 0, 0)
      const ctx = canvas.getContext('2d')
      const view = { scale: 1, ox: 0, oy: 0 }
      function fit() {
        const r = stage.getBoundingClientRect()
        canvas.width = Math.max(1, Math.round(r.width)); canvas.height = Math.max(1, Math.round(r.height))
        const s = Math.min(canvas.width / w, canvas.height / h) * 0.86
        view.scale = s; view.ox = (canvas.width - w * s) / 2; view.oy = (canvas.height - h * s) / 2
      }
      const toScreen = (x, y) => [x * view.scale + view.ox, y * view.scale + view.oy]
      const toImage = (x, y) => [(x - view.ox) / view.scale, (y - view.oy) / view.scale]

      function syncBar() {
        for (const m of MODES) {
          const b = modeButtons[m.id]
          b.style.background = mode === m.id ? '#22c98a' : '#3a3a3a'
          b.style.color = mode === m.id ? '#062a18' : 'rgba(255,255,255,0.86)'
        }
      }

      function renderBones() {
        boneList.innerHTML = ''
        boneIds.forEach((id, j) => {
          const b = boneByIndex.get(id)
          const row = el('div', {
            display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', borderRadius: '6px', cursor: 'pointer',
            background: j === sel ? 'rgba(34,201,138,0.18)' : 'transparent',
            border: j === sel ? '1px solid rgba(34,201,138,0.7)' : '1px solid transparent'
          })
          row.appendChild(el('span', { width: '12px', height: '12px', borderRadius: '3px', background: boneColor(id), flex: '0 0 auto' }))
          row.appendChild(el('span', { fontSize: '12px', color: 'rgba(255,255,255,0.85)', flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, b ? b.name : '#' + id))
          let total = 0
          for (let i = 0; i < n; i++) total += W[i * nb + j]
          row.appendChild(el('span', { fontSize: '11px', color: 'rgba(255,255,255,0.4)', flex: '0 0 auto' }, total.toFixed(0)))
          const rm = el('span', { fontSize: '12px', color: 'rgba(255,255,255,0.4)', flex: '0 0 auto', padding: '0 2px' }, '×')
          rm.title = '把这根骨从这一层去掉'
          // the app's one close / delete mark (theme 3.1a)
          rm.setAttribute('data-novaflow-x-glyph', '1'); rm.setAttribute('role', 'button')
          rm.addEventListener('click', (ev) => {
            ev.stopPropagation()
            if (nb <= 1) return
            pushUndo()
            W = removeBoneColumn(W, n, nb, j)
            boneIds.splice(j, 1); nb--
            if (sel >= nb) sel = nb - 1
            renderBones(); draw()
          })
          row.appendChild(rm)
          row.addEventListener('click', () => { sel = j; renderBones(); draw() })
          row.draggable = true
          row.addEventListener('dragstart', (ev) => { dragRow = j; try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(j)) } catch { /* no data */ } })
          row.addEventListener('dragover', (ev) => { if (dragRow < 0) return; ev.preventDefault(); row.style.boxShadow = 'inset 0 2px 0 0 #22c98a' })
          row.addEventListener('dragleave', () => { row.style.boxShadow = '' })
          row.addEventListener('drop', (ev) => { ev.preventDefault(); row.style.boxShadow = ''; const from = dragRow; dragRow = -1; if (from >= 0 && from !== j) moveBone(from, j) })
          row.addEventListener('dragend', () => { dragRow = -1 })
          row.addEventListener('mouseenter', () => { hover = id; draw() })
          row.addEventListener('mouseleave', () => { hover = null; draw() })
          boneList.appendChild(row)
        })
        addSel.innerHTML = ''
        const placeholder = el('option', null, '+ 添加骨骼…'); placeholder.value = ''
        addSel.appendChild(placeholder)
        const inSet = new Set(boneIds)
        for (const b of allBones) {
          if (inSet.has(b.index)) continue
          const o = el('option', null, b.name); o.value = String(b.index)
          addSel.appendChild(o)
        }
      }
      addSel.addEventListener('change', () => {
        const id = Number(addSel.value)
        if (!addSel.value || Number.isNaN(id) || boneIds.includes(id)) return
        pushUndo()
        W = addBoneColumn(W, n, nb)
        boneIds.push(id); nb++
        sel = nb - 1
        renderBones(); draw()
      })

      let dragRow = -1
      /** Put bone column `from` at position `to`; the weights move with their bone. */
      function moveBone(from, to) {
        pushUndo()
        const order = boneIds.map((_, k) => k)
        order.splice(to, 0, order.splice(from, 1)[0])
        const next = new Float64Array(n * nb)
        for (let i = 0; i < n; i++) for (let k = 0; k < nb; k++) next[i * nb + k] = W[i * nb + order[k]]
        W = next
        const selId = sel >= 0 ? boneIds[sel] : null
        boneIds = order.map((k) => boneIds[k])
        sel = selId === null ? sel : boneIds.indexOf(selId)
        renderBones(); draw()
      }
      function pushUndo() {
        undoStack.push({ boneIds: boneIds.slice(), W: Float64Array.from(W) })
        if (undoStack.length > 80) undoStack.shift()
      }
      function undo() {
        const prev = undoStack.pop()
        if (!prev) return
        boneIds = prev.boneIds; nb = boneIds.length; W = prev.W
        if (sel >= nb) sel = nb - 1
        renderBones(); draw()
      }

      function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingEnabled = true
        const P = animOn && posed ? posed : V
        if (P === posed) drawPosedImage()
        else ctx.drawImage(src, view.ox, view.oy, w * view.scale, h * view.scale)
        // mesh
        ctx.lineWidth = 1
        ctx.strokeStyle = 'rgba(0,240,150,0.35)'
        ctx.beginPath()
        for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) {
          const a = T[t + e], b = T[t + (e + 1) % 3]
          const [ax, ay] = toScreen(P[2 * a], P[2 * a + 1]); const [bx, by] = toScreen(P[2 * b], P[2 * b + 1])
          ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
        }
        ctx.stroke()
        // vertices
        const selId = sel >= 0 ? boneIds[sel] : -1
        const pr = Math.max(3.5, Math.min(9, 0.35 * meanEdge * view.scale))
        // batched: one fill per bone colour and one outline for all, not one per slice - a
        // few hundred pies of a dozen bones each was thousands of fills on every redraw
        const SX = new Float64Array(n), SY = new Float64Array(n)
        for (let i = 0; i < n; i++) { const q = toScreen(P[2 * i], P[2 * i + 1]); SX[i] = q[0]; SY[i] = q[1] }
        const TAU = Math.PI * 2
        if (showOverlay && sel >= 0) {
          for (let i = 0; i < n; i++) {
            ctx.beginPath(); ctx.arc(SX[i], SY[i], pr, 0, TAU)
            ctx.fillStyle = colormap(W[i * nb + sel]); ctx.fill()
          }
        } else if (showPie && nb) {
          const start = new Float64Array(n).fill(-Math.PI / 2)
          for (let j = 0; j < nb; j++) {
            ctx.beginPath()
            let any = false
            for (let i = 0; i < n; i++) {
              const v = W[i * nb + j]
              if (v <= 0.02) continue
              const a0 = start[i], a1 = a0 + v * TAU
              ctx.moveTo(SX[i], SY[i]); ctx.arc(SX[i], SY[i], pr, a0, a1); ctx.closePath()
              start[i] = a1; any = true
            }
            if (any) { ctx.fillStyle = boneColor(boneIds[j]); ctx.fill() }
          }
        } else {
          ctx.beginPath()
          for (let i = 0; i < n; i++) { ctx.moveTo(SX[i] + 2.5, SY[i]); ctx.arc(SX[i], SY[i], 2.5, 0, TAU) }
          ctx.fillStyle = '#8ccdff'; ctx.fill()
        }
        if ((showOverlay && sel >= 0) || (showPie && nb)) {
          ctx.beginPath()
          for (let i = 0; i < n; i++) { ctx.moveTo(SX[i] + pr, SY[i]); ctx.arc(SX[i], SY[i], pr, 0, TAU) }
          ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1; ctx.stroke()
        }
        // bones -- drawn so they read as bones, not as more vertices: a white halo
        // under every line and head, a ringed crosshair for a zero-length control
        // bone (the face is all of those), and the name on every bone in the set
        for (const b of allBones) {
          const inSet = boneIds.includes(b.index)
          const isSel = b.index === selId, isHover = b.index === hover
          if (!inSet && !isHover) continue
          // a posed layer shows its bones where the animation has them right now
          const at = (animOn && live && live.bonePose(b.index)) || b
          const [ax, ay] = toScreen(at.ax, at.ay); const [bx, by] = toScreen(at.bx, at.by)
          drawBoneGlyph(ctx, ax, ay, bx, by, boneColor(b.index), b.name, isSel, inSet)
        }
        if (mode === 'set' && pickV >= 0 && pickV < n) {
          const [x, y] = toScreen(P[2 * pickV], P[2 * pickV + 1])
          ctx.beginPath(); ctx.arc(x, y, pr + 4, 0, Math.PI * 2)
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke()
        }
        // brush
        if (lastPointer && mode !== 'set') {
          const [x, y] = toScreen(lastPointer[0], lastPointer[1])
          ctx.beginPath(); ctx.arc(x, y, radius * view.scale, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.stroke()
        }
        const selName = sel >= 0 && boneByIndex.get(boneIds[sel]) ? boneByIndex.get(boneIds[sel]).name : '—'
        const picked = mode === 'set' && pickV >= 0 && sel >= 0 ? ` · 顶点 ${pickV} = ${W[pickV * nb + sel].toFixed(2)}` : ''
        info.textContent = `${n} 顶点 · ${nb} 骨 · 选中 ${selName}${picked}`
      }
      let lastPointer = null

      function stamp(ix, iy, force) {
        if (sel < 0) return
        if (!force && lastStamp && Math.hypot(ix - lastStamp[0], iy - lastStamp[1]) < radius * 0.25) return
        lastStamp = [ix, iy]
        const hits = brushHits(animOn && posed ? posed : V, n, ix, iy, radius, 1)
        if (!hits.length) return
        if (mode === 'add') paintAdd(W, nb, sel, hits, strength * 0.15)
        else if (mode === 'sub') paintSub(W, nb, sel, hits, strength * 0.15)
      }

      function zoomAt(clientX, clientY, deltaY) {
        const rect = canvas.getBoundingClientRect()
        const mx = clientX - rect.left, my = clientY - rect.top
        const [ix, iy] = toImage(mx, my)
        const f = deltaY < 0 ? 1.12 : 1 / 1.12
        view.scale = Math.max(0.05, Math.min(40, view.scale * f))
        view.ox = mx - ix * view.scale; view.oy = my - iy * view.scale
        draw()
      }
      const capture = (id) => { try { canvas.setPointerCapture(id) } catch { /* not capturable */ } }
      function beginPan(ev) {
        const rect = canvas.getBoundingClientRect()
        panning = true
        panStart = [ev.clientX - rect.left - view.ox, ev.clientY - rect.top - view.oy]
        if (typeof ev.pointerId === 'number') capture(ev.pointerId)
      }
      canvas.addEventListener('contextmenu', (ev) => ev.preventDefault())
      canvas.addEventListener('pointerdown', (ev) => {
        if (ev.button === 1 || ev.button === 2 || ev.shiftKey) { beginPan(ev); return }
        if (ev.button !== 0) return
        const rect = canvas.getBoundingClientRect()
        const mx = ev.clientX - rect.left, my = ev.clientY - rect.top
        const [ix, iy] = toImage(mx, my)
        capture(ev.pointerId)
        if (mode === 'set') {
          const P = animOn && posed ? posed : V
          let best = -1, bestD = 14
          for (let i = 0; i < n; i++) { const [x, y] = toScreen(P[2 * i], P[2 * i + 1]); const d = Math.hypot(x - mx, y - my); if (d < bestD) { bestD = d; best = i } }
          pickV = best
          if (best >= 0 && sel >= 0) {
            pushUndo()
            pickDrag = { y: my, v: W[best * nb + sel] }
            strengthUi.input.value = String(Math.round(pickDrag.v * 100) / 100); strengthUi.val.textContent = strengthUi.input.value
          }
          draw()
          return
        }
        pushUndo()
        painting = true; lastStamp = null
        stamp(ix, iy, true); draw()
      })
      canvas.addEventListener('pointermove', (ev) => {
        const rect = canvas.getBoundingClientRect()
        const mx = ev.clientX - rect.left, my = ev.clientY - rect.top
        if (panning && panStart) { view.ox = mx - panStart[0]; view.oy = my - panStart[1]; draw(); return }
        const [ix, iy] = toImage(mx, my)
        if (pickDrag && pickV >= 0 && sel >= 0) {
          // up raises, down lowers: 150px from 0 to 1
          const v = Math.max(0, Math.min(1, pickDrag.v + (pickDrag.y - my) / 150))
          W[pickV * nb + sel] = v
          rebalance(W, nb, pickV, sel)
          strengthUi.input.value = String(Math.round(v * 100) / 100); strengthUi.val.textContent = strengthUi.input.value
          requestDraw()
          return
        }
        lastPointer = mode === 'set' ? null : [ix, iy]
        if (painting) stamp(ix, iy, false)
        requestDraw()
      })
      canvas.addEventListener('pointerleave', () => { lastPointer = null; draw() })
      canvas.addEventListener('pointerup', (ev) => {
        try { canvas.releasePointerCapture(ev.pointerId) } catch { /* not captured */ }
        if (panning) { panning = false; panStart = null; return }
        if (pickDrag) { pickDrag = null; renderBones(); draw(); return }
        if (painting) { painting = false; lastStamp = null; renderBones(); draw() }
      })

      autoBtn.addEventListener('click', async () => {
        if (typeof opts.auto !== 'function' || !nb) return
        autoBtn.disabled = true
        try {
          const solved = await opts.auto(boneIds.slice())
          if (solved && solved.length === n * nb) { pushUndo(); W = Float64Array.from(solved); renderBones(); draw() }
        } finally { autoBtn.disabled = false }
      })
      smoothBtn.addEventListener('click', () => { pushUndo(); smoothAll(W, n, nb, adj, 0.5); renderBones(); draw() })
      undoBtn.addEventListener('click', undo)
      resetBtn.addEventListener('click', () => { pushUndo(); boneIds = initial.boneIds.slice(); nb = boneIds.length; W = Float64Array.from(initial.W); sel = nb ? 0 : -1; renderBones(); draw() })
      cancelBtn.addEventListener('click', () => finish(null))
      okBtn.addEventListener('click', () => finish(true))

      const onKey = (ev) => {
        if (ev.key === 'Escape') finish(null)
        else if (ev.key === 'Enter') finish(true)
        else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') undo()
        else if (ev.key === '1') { mode = 'set'; syncBar() }
        else if (ev.key === '2') { mode = 'add'; syncBar() }
        else if (ev.key === '3') { mode = 'sub'; syncBar() }
        else if (ev.key === '[') { radius = Math.max(2, radius - 2); radiusUi.input.value = String(Math.round(radius)); radiusUi.val.textContent = radiusUi.input.value; draw() }
        else if (ev.key === ']') { radius += 2; radiusUi.input.value = String(Math.round(radius)); radiusUi.val.textContent = radiusUi.input.value; draw() }
      }
      let done = false
      function finish(ok) {
        if (done) return
        done = true
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('resize', onResize)
        for (const type of CLAIMED_INPUT) window.removeEventListener(type, onClaimedInput, true)
        animOn = false
        if (live) { try { live.restore() } catch { /* the preview may be gone */ } }
        if (overlay.parentElement) overlay.parentElement.removeChild(overlay)
        resolve(ok ? { boneIds: boneIds.slice(), weights: Float64Array.from(W) } : null)
      }
      const onResize = () => { fit(); draw() }
      // the app's preview zoom/pan listeners decide by cursor position; claim ours first
      const onClaimedInput = (ev) => {
        if (done) return
        if (ev.type === 'wheel') { ev.preventDefault(); ev.stopImmediatePropagation(); zoomAt(ev.clientX, ev.clientY, ev.deltaY); return }
        if (ev.type === 'contextmenu') { ev.preventDefault(); ev.stopImmediatePropagation(); return }
        if (ev.button === 1 || ev.button === 2) { ev.preventDefault(); ev.stopImmediatePropagation(); if (ev.type === 'pointerdown') beginPan(ev) }
      }
      for (const type of CLAIMED_INPUT) window.addEventListener(type, onClaimedInput, { capture: true, passive: false })
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('resize', onResize)

      meanEdge = estimateEdge()
      fit(); syncBar(); renderBones(); draw()
    })
  }

  return {
    open, MODES, PALETTE, boneColor,
    _internals: { adjacency, rebalance, normalizeRow, paintSet, paintAdd, paintSub, paintSmooth, smoothAll, prune, brushHits, addBoneColumn, removeBoneColumn }
  }
})
