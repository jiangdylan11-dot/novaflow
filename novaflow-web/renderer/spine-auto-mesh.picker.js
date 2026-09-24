/*
 * NovaFlow — 自动蒙皮 canvas layer picking.
 *
 * Hit-testing needs one thing per layer: the matrix that puts its image on the
 * screen. Invert it, look up that pixel's alpha in the layer's own bitmap, and
 * the topmost opaque layer is the one under the cursor. There are two ways to
 * get those matrices, because the preview has two renderers:
 *
 *  - Official Spine runtime (WebGL). Ask the skeleton: each attachment's
 *    placement composed with the camera. Exact, and nothing to intercept.
 *  - The app's 2D fallback. It draws each layer with a single `drawImage`, so
 *    wrapping that call hands the matrices over for free. Draws are paired with
 *    layers by walking the slot draw order and taking the next slot whose image
 *    is that size — several layers share the full-canvas size, so size alone is
 *    ambiguous but size plus order is not.
 *
 * Nothing here may take a 2D context on the preview canvas: that would deny it
 * WebGL for good and keep the official runtime from ever starting.
 */
(function () {
  'use strict'

  const TOGGLE_MARK = 'data-novaflow-auto-mesh-pick-toggle'
  const PREVIEW_MARK = 'data-novaflow-skeleton-preview-canvas'
  const OVERLAY_MARK = 'data-novaflow-auto-mesh-pick-overlay'
  /** one frame is a few dozen draws; anything past this means the loop stalled */
  const MAX_PENDING = 4096
  const LABEL_ON = '选择图层:开'
  const LABEL_OFF = '选择图层'

  const state = {
    enabled: false,
    canvas: null,
    overlay: null,
    hooked: false,
    pending: [],
    frame: [],
    hover: null,
    /** highlight asked for by the panel (list row hover), independent of picking */
    external: null,
    slots: null,
    /** signature of the skeleton `slots` was built from, so a reload invalidates it */
    sig: null,
    /** name -> pre-tinted silhouette, so painting a highlight is one drawImage */
    tint: new Map(),
    /** layers whose pixels are being decoded for a hover, so we ask only once */
    decoding: new Set(),
    box: { l: 0, t: 0, w: 0, h: 0, shown: false, at: 0 },
    /** signature of what is currently on the overlay, so idle frames cost nothing */
    painted: null,
    onHover: null,
    bound: false,
    busy: false
  }

  const panel = () => window.NovaFlowAutoMeshPanel || null

  // ------------------------------------------------------------ draw hook ---

  function slotOrder() {
    const src = window.__NOVA_SPINE_LAST_SOURCE
    if (!src || !src.skeleton || !src.skeleton.text) return null
    let skel
    try { skel = JSON.parse(src.skeleton.text) } catch { return null }
    const attOf = {}
    const visit = (atts) => {
      for (const slot of Object.keys(atts || {})) {
        for (const att of Object.keys(atts[slot] || {})) {
          const a = atts[slot][att]
          if (!attOf[slot]) attOf[slot] = []
          attOf[slot].push({ name: att, width: a.width, height: a.height })
        }
      }
    }
    if (Array.isArray(skel.skins)) for (const s of skel.skins) visit(s && s.attachments)
    else if (skel.skins) for (const k of Object.keys(skel.skins)) visit(skel.skins[k])
    const out = []
    for (const s of skel.slots || []) {
      const list = attOf[s.name] || []
      const chosen = list.find((x) => x.name === s.attachment) || list[0]
      if (chosen) out.push({ slot: s.name, name: chosen.name, width: chosen.width, height: chosen.height })
    }
    return out
  }

  /** Pair this frame's draws with layer names by (draw order, image size). */
  function matchFrame(draws) {
    const slots = state.slots || (state.slots = slotOrder())
    if (!slots || !slots.length) return []
    const used = new Uint8Array(slots.length)
    const out = []
    for (const d of draws) {
      let hit = -1
      for (let i = 0; i < slots.length; i++) {
        if (used[i]) continue
        if (Math.round(slots[i].width) === Math.round(d.w) && Math.round(slots[i].height) === Math.round(d.h)) { hit = i; break }
      }
      if (hit < 0) continue
      used[hit] = 1
      out.push({ name: slots[hit].name, m: d.m, w: d.w, h: d.h })
    }
    return out
  }

  /**
   * The skeleton the slot order was derived from. A project reload swaps region
   * attachments for meshes and can reorder slots, so the cached order has to go
   * with it -- keeping it was why picking pointed at the wrong layer after an
   * apply.
   */
  function sourceSignature() {
    const src = window.__NOVA_SPINE_LAST_SOURCE
    const text = src && src.skeleton && src.skeleton.text
    return typeof text === 'string' ? text.length + ':' + text.slice(0, 96) : null
  }

  function hookDraws() {
    if (state.hooked) return
    const proto = CanvasRenderingContext2D.prototype
    const original = proto.drawImage
    // Capture unconditionally: the panel can ask for a highlight at any moment
    // and the matrices have to already be in hand for the frame it asks about.
    proto.drawImage = function (img) {
      // Compare the CANVAS, never a context we fetched ourselves. Calling
      // getContext('2d') on the preview canvas permanently denies it WebGL, which
      // is what kept the official Spine player from ever starting.
      if (state.canvas && this.canvas === state.canvas) {
        const w = (img && (img.width || img.naturalWidth)) || 0
        const h = (img && (img.height || img.naturalHeight)) || 0
        if (w && h) {
          let t = null
          try { t = this.getTransform() } catch { t = null }
          if (t && state.pending.length < MAX_PENDING) {
            state.pending.push({ m: [t.a, t.b, t.c, t.d, t.e, t.f], w, h })
          }
        }
      }
      return original.apply(this, arguments)
    }
    proto.drawImage.__novaflowPickOriginal = original
    state.hooked = true
    const tick = () => {
      if (!state.canvas) {                       // not in 骨骼动画: do nothing at all
        if (state.pending.length) state.pending = []
        schedule()
        return
      }
      const sig = sourceSignature()
      if (sig !== state.sig) { state.sig = sig; state.slots = null; state.tint.clear() }
      const player = officialPlayer()
      if (player) {
        // WebGL preview: read the layout off the skeleton, nothing to intercept
        const built = frameFromPlayer(player)
        if (built) state.frame = built
        if (state.pending.length) state.pending = []
      } else if (state.pending.length) {
        state.frame = matchFrame(state.pending)
        state.pending = []
      }
      // Align and repaint every frame. Doing this on the one-second mount timer
      // left a highlight from the previous camera sitting over the preview after
      // any zoom or pan -- a large layer's silhouette reads as the preview having
      // gone blank.
      try { ensureOverlay(); paint() } catch { /* never break the loop */ }
      schedule()
    }
    // rAF alone is not enough: an occluded window never fires it, which stops the
    // loop for good and leaves the capture buffer growing without bound. Race it
    // against a timer, the same way the panel steps its own frames.
    //
    // The token is what makes the race safe. Each cycle arms two callbacks and
    // only the first to fire may run; the other must be discarded. A shared
    // boolean cannot express that -- the loser wakes up after the next cycle has
    // already re-armed the flag, sees it set, and runs a second tick that arms
    // two more callbacks. The loop then doubles every cycle, which is how this
    // leaked ~145 MB/s and took the renderer down with it.
    let tickToken = 0
    const schedule = () => {
      const token = ++tickToken
      const run = () => { if (token === tickToken) tick() }
      try { window.requestAnimationFrame(run) } catch { /* fall through to the timer */ }
      window.setTimeout(run, 40)
    }
    schedule()
  }

  // ------------------------------------------------- official player frame ---
  //
  // Once the project loads into the official Spine runtime the preview is WebGL,
  // so there are no drawImage calls to listen to. The same per-layer matrix can be
  // derived from the skeleton instead, which is both exact and independent of how
  // the preview happens to be rendered.

  /** Compose two canvas-convention affines: apply `inner` first, then `outer`. */
  function mul(outer, inner) {
    const [a, b, c, d, e, f] = outer
    const [A, B, C, D, E, F] = inner
    return [
      a * A + c * B, b * A + d * B,
      a * C + c * D, b * C + d * D,
      a * E + c * F + e, b * E + d * F + f,
    ]
  }

  /** World -> canvas pixels. The camera is orthographic, so three probes pin it down. */
  function worldToScreenAffine(camera, Vector3, width, height) {
    const at = (sx, sy) => {
      const v = camera.screenToWorld(new Vector3(sx, sy, 0), width, height)
      return [Number(v.x), Number(v.y)]
    }
    const o = at(0, 0), px = at(width, 0), py = at(0, height)
    if (![...o, ...px, ...py].every(Number.isFinite)) return null
    // screen -> world, then invert it
    const a = (px[0] - o[0]) / width, b = (px[1] - o[1]) / width
    const c = (py[0] - o[0]) / height, d = (py[1] - o[1]) / height
    const det = a * d - b * c
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
    const ia = d / det, ib = -b / det, ic = -c / det, id = a / det
    return [ia, ib, ic, id, -(ia * o[0] + ic * o[1]), -(ib * o[0] + id * o[1])]
  }

  /** Bone local space -> world. */
  function boneAffine(bone) {
    return [bone.a, bone.c, bone.b, bone.d, bone.worldX, bone.worldY]
  }

  /**
   * Image pixels (y down from the top) -> bone local space, for a region. This is
   * the same placement Spine bakes into `offset`, written out so it does not depend
   * on which corner the runtime stores first.
   */
  function regionImageAffine(att) {
    const rot = (Number(att.rotation) || 0) * Math.PI / 180
    const cos = Math.cos(rot), sin = Math.sin(rot)
    const sx = Number(att.scaleX) || 1, sy = Number(att.scaleY) || 1
    const w = Number(att.width) || 0, h = Number(att.height) || 0
    if (!(w > 0) || !(h > 0)) return null
    const a = sx * cos, b = sx * sin, c = sy * sin, d = -sy * cos
    const e = (Number(att.x) || 0) - (w / 2) * a - (h / 2) * c
    const f = (Number(att.y) || 0) - (w / 2) * b - (h / 2) * d
    return [a, b, c, d, e, f]
  }

  /** Image pixels -> world for a mesh, solved from three of its own vertices. */
  function meshImageToWorld(att, slot, world) {
    const uvs = att.regionUVs || att.uvs
    const w = Number(att.width) || 0, h = Number(att.height) || 0
    if (!uvs || !(w > 0) || !(h > 0) || world.length < 6) return null
    const n = Math.min(Math.floor(uvs.length / 2), Math.floor(world.length / 2))
    if (n < 3) return null
    const P = (i) => [uvs[2 * i] * w, uvs[2 * i + 1] * h]
    const Q = (i) => [world[2 * i], world[2 * i + 1]]
    const p0 = P(0)
    let i1 = -1, i2 = -1
    for (let i = 1; i < n && i2 < 0; i++) {
      const p = P(i)
      if (i1 < 0) { if (Math.hypot(p[0] - p0[0], p[1] - p0[1]) > 1e-3) i1 = i; continue }
      const p1 = P(i1)
      const cross = (p1[0] - p0[0]) * (p[1] - p0[1]) - (p1[1] - p0[1]) * (p[0] - p0[0])
      if (Math.abs(cross) > 1e-3) i2 = i
    }
    if (i1 < 0 || i2 < 0) return null
    const p1 = P(i1), p2 = P(i2), q0 = Q(0), q1 = Q(i1), q2 = Q(i2)
    const dx1 = p1[0] - p0[0], dy1 = p1[1] - p0[1]
    const dx2 = p2[0] - p0[0], dy2 = p2[1] - p0[1]
    const det = dx1 * dy2 - dy1 * dx2
    if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null
    const ux1 = q1[0] - q0[0], uy1 = q1[1] - q0[1]
    const ux2 = q2[0] - q0[0], uy2 = q2[1] - q0[1]
    const a = (ux1 * dy2 - ux2 * dy1) / det
    const c = (ux2 * dx1 - ux1 * dx2) / det
    const b = (uy1 * dy2 - uy2 * dy1) / det
    const d = (uy2 * dx1 - uy1 * dx2) / det
    return [a, b, c, d, q0[0] - a * p0[0] - c * p0[1], q0[1] - b * p0[0] - d * p0[1]]
  }

  function officialPlayer() {
    const proxy = window.__NovaFlowSkeletonTimelineOfficialProxy
    const player = proxy && proxy.player
    if (!player || !player.skeleton) return null
    const camera = player.renderer && player.renderer.camera
    if (!camera || typeof camera.screenToWorld !== 'function') return null
    return player
  }

  /** One entry per drawn attachment, in draw order, same shape the hit test wants. */
  function frameFromPlayer(player) {
    const canvas = state.canvas
    const camera = player.renderer.camera
    const Vector3 = (player.spine && player.spine.Vector3) || (player.webgl && player.webgl.Vector3)
    if (!canvas || !Vector3) return null
    const toScreen = worldToScreenAffine(camera, Vector3, canvas.width, canvas.height)
    if (!toScreen) return null
    const out = []
    const scratch = []
    for (const slot of player.skeleton.drawOrder || []) {
      const att = slot && slot.attachment
      if (!att || !slot.bone) continue
      const name = String(att.name || '')
      const w = Number(att.width) || 0, h = Number(att.height) || 0
      if (!name || !(w > 0) || !(h > 0)) continue
      let toWorld = null
      let mesh = null
      if (typeof att.regionUVs !== 'undefined' || att.triangles) {
        const count = Number(att.worldVerticesLength) || 0
        if (count < 6) continue
        scratch.length = count
        try { att.computeWorldVertices(slot, 0, count, scratch, 0, 2) } catch { continue }
        toWorld = meshImageToWorld(att, slot, scratch)
        // A mesh bends: once bones deform it, its world vertices are no affine image
        // of its uvs, and the one matrix above (fitted to three vertices) sheared a
        // bent leg and drew a finger as a streak. Carry the triangles in screen
        // space and draw / hit-test them one at a time, as the GPU does.
        const uvs = att.regionUVs || att.uvs
        const tris = att.triangles
        if (uvs && tris && tris.length) {
          const n = Math.min(count / 2, Math.floor(uvs.length / 2))
          const sv = new Float32Array(n * 2)
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (let i = 0; i < n; i++) {
            const x = scratch[2 * i], y = scratch[2 * i + 1]
            const sx = toScreen[0] * x + toScreen[2] * y + toScreen[4]
            const sy = toScreen[1] * x + toScreen[3] * y + toScreen[5]
            sv[2 * i] = sx; sv[2 * i + 1] = sy
            if (sx < minX) minX = sx
            if (sx > maxX) maxX = sx
            if (sy < minY) minY = sy
            if (sy > maxY) maxY = sy
          }
          mesh = { uvs, tris, sv, n, box: [minX, minY, maxX, maxY] }
        }
      } else {
        const local = regionImageAffine(att)
        if (local) toWorld = mul(boneAffine(slot.bone), local)
      }
      if (!toWorld && !mesh) continue
      // a mesh keeps a matrix only as a stand-in (label, box); the triangles are the truth
      const m = toWorld ? mul(toScreen, toWorld) : [1, 0, 0, 1, mesh.box[0], mesh.box[1]]
      out.push({ name, m, w, h, mesh })
    }
    return out
  }

  // ------------------------------------------------------------- hit test ---

  function inverse(m) {
    const [a, b, c, d, e, f] = m
    const det = a * d - b * c
    if (Math.abs(det) < 1e-12) return null
    return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
  }

  function applyInv(inv, x, y) {
    return [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]]
  }

  /** image px -> screen for one triangle, from its three image corners and screen corners */
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

  /** the image pixel under a screen point, through whichever triangle of the mesh holds it */
  function meshHit(d, sx, sy) {
    const { uvs, tris, sv, n, box } = d.mesh
    if (sx < box[0] || sx > box[2] || sy < box[1] || sy > box[3]) return null
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2]
      if (a >= n || b >= n || c >= n) continue
      const ax = sv[2 * a], ay = sv[2 * a + 1]
      const bx = sv[2 * b], by = sv[2 * b + 1]
      const cx = sv[2 * c], cy = sv[2 * c + 1]
      const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      if (Math.abs(det) < 1e-9) continue
      const wc = ((bx - ax) * (sy - ay) - (by - ay) * (sx - ax)) / det
      const wb = ((sx - ax) * (cy - ay) - (sy - ay) * (cx - ax)) / det
      const wa = 1 - wb - wc
      if (wa < -1e-4 || wb < -1e-4 || wc < -1e-4) continue
      const u = wa * uvs[2 * a] + wb * uvs[2 * b] + wc * uvs[2 * c]
      const v = wa * uvs[2 * a + 1] + wb * uvs[2 * b + 1] + wc * uvs[2 * c + 1]
      return [u * d.w, v * d.h]
    }
    return null
  }

  /** what the triangles look like this frame; any bend or move changes it */
  function meshSig(m) {
    const sv = m.sv, k = m.n * 2
    return m.box.map((v) => v.toFixed(1)).join(',') + '|' + sv[0].toFixed(1) + ',' + sv[1].toFixed(1)
      + ',' + sv[k - 2].toFixed(1) + ',' + sv[k - 1].toFixed(1) + ',' + sv[(k >> 1) & ~1].toFixed(1)
  }

  /**
   * The silhouette of a mesh, one textured triangle at a time, so a bent mesh
   * bends with it. Each triangle reads only its own patch of the tinted bitmap,
   * so the cost is the layer's area, not triangles times image.
   */
  function paintMesh(g, d, tinted) {
    const { uvs, tris, sv, n, box } = d.mesh
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2]
      if (a >= n || b >= n || c >= n) continue
      const ax = sv[2 * a], ay = sv[2 * a + 1]
      const bx = sv[2 * b], by = sv[2 * b + 1]
      const cx = sv[2 * c], cy = sv[2 * c + 1]
      g.beginPath()
      g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy)
      g.closePath()
      if (!tinted) { g.fillStyle = 'rgba(34,201,138,0.18)'; g.fill(); continue }
      const pax = uvs[2 * a] * d.w, pay = uvs[2 * a + 1] * d.h
      const pbx = uvs[2 * b] * d.w, pby = uvs[2 * b + 1] * d.h
      const pcx = uvs[2 * c] * d.w, pcy = uvs[2 * c + 1] * d.h
      const T = triAffine(pax, pay, pbx, pby, pcx, pcy, ax, ay, bx, by, cx, cy)
      if (!T) continue
      const x0 = Math.max(0, Math.floor(Math.min(pax, pbx, pcx)) - 1)
      const y0 = Math.max(0, Math.floor(Math.min(pay, pby, pcy)) - 1)
      const x1 = Math.min(d.w, Math.ceil(Math.max(pax, pbx, pcx)) + 1)
      const y1 = Math.min(d.h, Math.ceil(Math.max(pay, pby, pcy)) + 1)
      if (x1 <= x0 || y1 <= y0) continue
      g.save()
      g.clip()
      g.globalAlpha = 0.45
      g.setTransform(T[0], T[1], T[2], T[3], T[4], T[5])
      g.drawImage(tinted, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0)
      g.restore()
    }
    if (!tinted) {
      g.strokeStyle = 'rgba(34,201,138,0.95)'
      g.lineWidth = 2
      g.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1])
    }
    g.restore()
  }

  function alphaAt(name, px, py) {
    const p = panel()
    if (!p || !p._state) return 0
    const layer = p._state.layers.get(name)
    if (!layer || !layer.imageData) return -1      // not decoded yet
    const { imageData } = layer
    const ix = Math.round(px), iy = Math.round(py)
    if (ix < 0 || iy < 0 || ix >= imageData.width || iy >= imageData.height) return 0
    return imageData.data[(iy * imageData.width + ix) * 4 + 3]
  }

  /** Topmost layer whose own pixel under the cursor is opaque. */
  function pick(cx, cy) {
    const frame = state.frame
    for (let i = frame.length - 1; i >= 0; i--) {
      const d = frame[i]
      let px, py
      if (d.mesh) {
        const hit = meshHit(d, cx, cy)
        if (!hit) continue
        px = hit[0]; py = hit[1]
      } else {
        const inv = inverse(d.m)
        if (!inv) continue
        const p = applyInv(inv, cx, cy)
        px = p[0]; py = p[1]
        if (px < 0 || py < 0 || px >= d.w || py >= d.h) continue
      }
      const a = alphaAt(d.name, px, py)
      if (a === -1) return { name: d.name, draw: d, undecoded: true }
      if (a > 16) return { name: d.name, draw: d }
    }
    return null
  }

  // -------------------------------------------------------------- overlay ---

  /**
   * The overlay lives on document.body as a fixed element aligned to the canvas,
   * NOT inside the preview stage. The brand runtime scans that stage and adopts
   * any canvas it finds: it stamps data-novaflow-skeleton-preview-canvas on it
   * and forces position/inset, which both wrecks our hit-test coordinates and
   * makes findSkeletonPreviewCanvasForExport pick the empty overlay.
   */
  /**
   * `force` re-reads the canvas rect. Reading it is a forced synchronous layout
   * and the brand runtime dirties the DOM on its own timer, so doing it every
   * frame thrashes layout and slows the whole page down by an order of
   * magnitude. The rect only moves when the window does, so sample it rarely --
   * painting itself needs no layout, the matrix comes from the draw hook.
   */
  function ensureOverlay(force) {
    const canvas = state.canvas
    if (!canvas || !canvas.isConnected) return null
    let ov = state.overlay
    if (!ov || !ov.isConnected) ov = document.querySelector(`[${OVERLAY_MARK}="1"]`)
    if (!ov) {
      ov = document.createElement('canvas')
      ov.setAttribute(OVERLAY_MARK, '1')
      ov.setAttribute('data-novaflow-runtime-ignore', '1')
      Object.assign(ov.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '2147483000', background: 'transparent'
      })
      document.body.appendChild(ov)
    }
    state.overlay = ov
    const want = state.enabled || !!state.external
    const box = state.box
    const now = Date.now()
    if (!force && want === box.shown && now - box.at < 200) return ov
    box.at = now
    const r = canvas.getBoundingClientRect()
    const shown = want && r.width >= 4 && r.height >= 4
    if (ov.width !== canvas.width || ov.height !== canvas.height) {
      ov.width = canvas.width
      ov.height = canvas.height
      box.shown = !shown                       // force the style write below
    }
    // Only touch style when something actually moved: this runs every frame.
    if (shown !== box.shown) {
      ov.style.display = shown ? 'block' : 'none'
      box.shown = shown
      // wipe what was on it, so re-showing never flashes the previous highlight
      if (!shown && state.painted !== null) {
        const g = ov.getContext('2d')
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(0, 0, ov.width, ov.height)
        state.painted = null
      }
    }
    if (!shown) return ov
    if (r.left !== box.l) { ov.style.left = r.left + 'px'; box.l = r.left }
    if (r.top !== box.t) { ov.style.top = r.top + 'px'; box.t = r.top }
    if (r.width !== box.w) { ov.style.width = r.width + 'px'; box.w = r.width }
    if (r.height !== box.h) { ov.style.height = r.height + 'px'; box.h = r.height }
    return ov
  }

  /**
   * The overlay never takes pointer events. It sat on top of the preview with
   * `pointer-events: auto`, which is what swallowed the wheel and the right-drag
   * the preview's own camera needs. Picking listens on the document instead and
   * only claims the plain left click it actually consumes.
   */
  function toCanvasCoords(ev) {
    const canvas = state.canvas
    if (!canvas) return [-1, -1]
    const r = canvas.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return [-1, -1]
    return [(ev.clientX - r.left) * (canvas.width / r.width), (ev.clientY - r.top) * (canvas.height / r.height)]
  }

  /**
   * The event has to land on the preview canvas ITSELF, not merely inside its
   * rectangle. The brand runtime stretches that canvas across the whole preview
   * stage, so 显示骨骼 / 显示网格 / 预乘 / 自动适配 and the playbar all sit inside
   * its bounds -- a rectangle test swallowed every one of their clicks while
   * picking was on, which is why 预乘 could not be switched off. The overlay is
   * pointer-transparent, so a click over the artwork really does target the canvas.
   */
  function onPreviewCanvas(ev) {
    const canvas = state.canvas
    if (!canvas || !canvas.isConnected) return false
    return ev.target === canvas
  }

  function bindPointer() {
    if (state.bound) return
    state.bound = true
    document.addEventListener('mousemove', (ev) => {
      if (!state.enabled) return
      if (!onPreviewCanvas(ev)) { if (state.hover) { setHover(null) } return }
      onMove(ev)
    }, true)
    // the pointer can leave the window without a final move inside the canvas
    document.addEventListener('mouseleave', () => { if (state.hover) setHover(null) })
    document.addEventListener('click', (ev) => {
      if (!state.enabled || ev.button !== 0 || !onPreviewCanvas(ev)) return
      ev.preventDefault(); ev.stopPropagation()
      onClick(ev)
    }, true)
  }

  function setHover(hit) {
    const was = state.hover && state.hover.name
    state.hover = hit
    const now = hit && hit.name
    if (was !== now && typeof state.onHover === 'function') {
      try { state.onHover(now || null) } catch { /* the panel is not ours to break */ }
    }
  }

  /**
   * Pre-tinted silhouette for a layer, built once. A layer's pixels are only
   * decoded when it gets meshed, so ask for them the first time one is hovered --
   * otherwise the feedback is a bare rectangle and you cannot see the shape.
   */
  function tintedFor(name) {
    const cached = state.tint.get(name)
    if (cached !== undefined) return cached
    const p = panel()
    const layer = p && p._state ? p._state.layers.get(name) : null
    if (!layer || !layer.imageData) {
      if (p && typeof p.ensurePixels === 'function' && layer && layer.hasImage && !state.decoding.has(name)) {
        state.decoding.add(name)
        Promise.resolve(p.ensurePixels(name))
          .then(() => { state.painted = null })          // repaint now that the shape exists
          .catch(() => { /* leave the box fallback in place */ })
          .then(() => { state.decoding.delete(name) })
      }
      return null                                        // box fallback until it lands
    }
    const t = document.createElement('canvas')
    t.width = layer.imageData.width
    t.height = layer.imageData.height
    const g = t.getContext('2d')
    g.putImageData(layer.imageData, 0, 0)
    g.globalCompositeOperation = 'source-in'
    g.fillStyle = '#22c98a'
    g.fillRect(0, 0, t.width, t.height)
    state.tint.set(name, t)
    return t
  }

  function onMove(ev) {
    if (!state.enabled) return
    const [x, y] = toCanvasCoords(ev)
    setHover(pick(x, y))
  }

  async function onClick(ev) {
    if (!state.enabled || state.busy) return
    const [x, y] = toCanvasCoords(ev)
    const hit = pick(x, y)
    if (!hit) return
    const p = panel()
    if (!p) return
    state.busy = true
    try {
      // clicking a layer only ACTIVATES it (user decision 2026-09-21): it ticks the layer
      // in the panel and shows it in the draw order. Meshing and the editors are started
      // from their own buttons -- a click on the art must never open an editor.
      const layer = p._state.layers.get(hit.name)
      if (layer && !layer.selected) await p.setSelected(hit.name, true)
      if (typeof p.focusLayer === 'function') p.focusLayer(hit.name)
    } catch (err) {
      window.console && console.warn('[auto-mesh] pick select failed:', err && err.message)
    } finally {
      state.busy = false
      paint()
    }
  }

  function paint() {
    const ov = state.overlay
    if (!ov || !state.box.shown) return
    const g = ov.getContext('2d')
    const name = (state.hover && state.hover.name) || state.external
    if (!name) {
      if (state.painted !== null) {
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(0, 0, ov.width, ov.height)
        state.painted = null
      }
      return
    }
    // Always take the matrix from the frame just drawn. Reusing the one captured
    // when the pointer last moved is what left a stale silhouette behind after a
    // zoom or a pan.
    const d = state.frame.find((f) => f.name === name) || (state.hover && state.hover.draw)
    if (!d) {
      if (state.painted !== null) {
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(0, 0, ov.width, ov.height)
        state.painted = null
      }
      return
    }
    const p = panel()
    const layer = p && p._state ? p._state.layers.get(name) : null
    const sig = name + '|' + (d.mesh ? meshSig(d.mesh) : d.m.join(',')) + '|' + (layer && layer.mesh ? layer.mesh.vertices.length : -1)
    if (sig === state.painted) return                       // nothing moved; leave the pixels alone
    state.painted = sig
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, ov.width, ov.height)

    // Tint the layer's own pixels, so the feedback follows the artwork's shape
    // rather than a bounding box.
    const tinted = tintedFor(name)
    if (d.mesh) {
      paintMesh(g, d, tinted)
    } else {
    g.save()
    g.setTransform(d.m[0], d.m[1], d.m[2], d.m[3], d.m[4], d.m[5])
    if (tinted) {
      g.globalAlpha = 0.45
      // scale to the attachment box: a packed atlas is unpacked at import, so the
      // decoded bitmap and the attachment always agree
      g.drawImage(tinted, 0, 0, d.w, d.h)
    } else {
      // pixels are only decoded once a layer is meshed, so before that fall back
      // to washing its box -- hovering has to show something either way
      g.fillStyle = 'rgba(34,201,138,0.18)'
      g.fillRect(0, 0, d.w, d.h)
    }
    g.restore()
    // The box is only a placeholder for a layer still being decoded; once the
    // silhouette is up it says everything the box did and shows the shape too.
    if (!tinted) {
      g.save()
      g.setTransform(d.m[0], d.m[1], d.m[2], d.m[3], d.m[4], d.m[5])
      g.strokeStyle = 'rgba(34,201,138,0.95)'
      g.lineWidth = 2 / Math.max(Math.abs(d.m[0]), 1e-6)
      g.strokeRect(0, 0, d.w, d.h)
      g.restore()
    }
    }
    const label = name + (layer && layer.mesh ? ` · ${layer.mesh.vertices.length / 2}点` : ' · 未生成')
    g.font = '600 13px sans-serif'
    const tw = g.measureText(label).width
    // the label sits at the top-left of what is actually drawn
    const ox = d.mesh ? d.mesh.box[0] : d.m[4], oy = d.mesh ? d.mesh.box[1] : d.m[5]
    const lx = Math.min(Math.max(ox, 6), ov.width - tw - 14)
    const ly = Math.max(oy - 8, 18)
    g.fillStyle = 'rgba(8,20,16,0.85)'
    g.fillRect(lx - 5, ly - 14, tw + 10, 20)
    g.fillStyle = '#22c98a'
    g.fillText(label, lx, ly)
  }

  // --------------------------------------------------------------- toggle ---

  /**
   * ONLY the skeleton preview canvas, never "the biggest canvas on the page".
   * The loose lookup bound this overlay to the particle editor's canvas, whose
   * size the app rewrites constantly (300x150 <-> 1069x824 <-> 3821x1796); the
   * overlay chased it and reallocated a multi-megabyte backing store every
   * frame, leaking ~145 MB/s until the renderer was killed and the window went
   * black.
   */
  function findPreviewCanvas() {
    const marked = document.querySelector(`canvas[${PREVIEW_MARK}="1"]`)
    if (marked instanceof HTMLCanvasElement && !marked.hasAttribute(OVERLAY_MARK)) return marked
    // before the brand runtime stamps it, take a canvas inside the preview stage
    const stage = document.querySelector('[data-novaflow-skeleton-preview-stage="1"]')
    if (!stage) return null
    return Array.from(stage.querySelectorAll('canvas'))
      .find((c) => !c.hasAttribute(OVERLAY_MARK) && c.width > 40 && c.height > 40) || null
  }

  function findToolbarAnchor() {
    const buttons = Array.from(document.querySelectorAll('button'))
    return buttons.find((b) => (b.textContent || '').replace(/\s+/g, '') === '显示网格') || null
  }

  /**
   * Dress the toggle the way the preview's own top buttons are dressed. The green
   * comes from the brand runtime's CSS on
   * `[data-novaflow-skeleton-top-button-active="1"]` (rgb(30,166,114), !important),
   * so an inline colour of our own just loses to it. The runtime also re-derives
   * that attribute on a timer from `aria-pressed`, and would strip it back off if we
   * set it without saying we are pressed.
   */
  function dressToggle(btn) {
    if (!btn) return
    const on = state.enabled
    const label = on ? LABEL_ON : LABEL_OFF
    if (btn.textContent !== label) btn.textContent = label
    btn.style.removeProperty('background')
    btn.style.removeProperty('color')
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    btn.setAttribute('data-novaflow-skeleton-top-button', '1')
    if (on) btn.setAttribute('data-novaflow-skeleton-top-button-active', '1')
    else btn.removeAttribute('data-novaflow-skeleton-top-button-active')
  }

  function setEnabled(on) {
    state.enabled = !!on
    state.slots = null
    hookDraws(); bindPointer()
    if (!state.enabled) setHover(null)
    state.box.at = 0
    dressToggle(document.querySelector(`[${TOGGLE_MARK}="1"]`))
    ensureOverlay()
    paint()
  }

  /** Highlight a layer from outside (the panel's list hover). */
  function highlight(name) {
    const next = name ? String(name) : null
    if (next === state.external) return
    state.external = next
    hookDraws()
    ensureOverlay(true)
    paint()
  }

  function mount() {
    const anchor = findToolbarAnchor()
    const existing = document.querySelector(`[${TOGGLE_MARK}="1"]`)
    if (!anchor || !anchor.parentElement) {
      if (existing && existing.parentElement) existing.parentElement.removeChild(existing)
      if (state.overlay && state.overlay.parentElement) {
        state.overlay.parentElement.removeChild(state.overlay)
        state.overlay = null
      }
      state.enabled = false
      // let go of the preview canvas too, or the tick keeps working on a canvas
      // that belongs to whatever section is on screen now
      state.canvas = null
      state.frame = []
      state.pending = []
      state.box.shown = false
      state.painted = null
      return
    }
    const canvas = findPreviewCanvas()
    if (canvas !== state.canvas) {
      state.canvas = canvas
      state.slots = null
      state.tint.clear()
      state.frame = []
      state.pending = []
    }
    if (!existing) {
      const btn = anchor.cloneNode(true)
      btn.setAttribute(TOGGLE_MARK, '1')
      btn.title = '打开后可以在画布里直接指到图层,点击进入该层的网格编辑'
      dressToggle(btn)
      btn.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation()
        setEnabled(!state.enabled)
      })
      anchor.parentElement.insertBefore(btn, anchor.nextSibling)
    } else {
      dressToggle(existing)
    }
    ensureOverlay()
  }

  function mutationAddsElement(mutations) {
    for (const m of mutations) {
      if (m.type !== 'childList') continue
      for (const n of m.addedNodes) if (n && n.nodeType === 1) return true
      for (const n of m.removedNodes) if (n && n.nodeType === 1) return true
    }
    return false
  }

  function start() {
    let scheduled = false
    // Before the frame is painted, not on the next one: from a frame later
    // the toolbar showed without 选择图层 and then grew by it.
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => { scheduled = false; try { mount() } catch { /* keep going */ } })
    }
    mount()
    hookDraws()
    bindPointer()
    // element add/remove only — reacting to attribute churn here is what turned
    // the panel's observer into a livelock against the brand runtime
    const obs = new MutationObserver((m) => { if (mutationAddsElement(m)) schedule() })
    obs.observe(document.documentElement, { childList: true, subtree: true })
    window.setInterval(() => { try { mount() } catch { /* keep polling */ } }, 1000)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }

  window.NovaFlowAutoMeshPicker = {
    setEnabled,
    isEnabled: () => state.enabled,
    pick,
    highlight,
    /** the panel registers here to mirror canvas hover onto its list row */
    setHoverListener: (fn) => { state.onHover = typeof fn === 'function' ? fn : null },
    getFrame: () => state.frame.map((d) => ({ name: d.name, w: d.w, h: d.h, m: d.m.slice(), box: d.mesh ? d.mesh.box.slice() : null, triangles: d.mesh ? d.mesh.tris.length / 3 : 0 })),
    mount,
    _state: state
  }
})()
