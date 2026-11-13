/*
 * 自动骨架 — figure pass.
 *
 * The skeleton builder reads one medial axis per layer, which is right when every limb is its
 * own picture (an artist's PS split). A split by clothing category (上衣 / 下装 / 鞋 each one
 * layer) or a character kept as one picture has both legs or both arms in a single layer: its
 * axis runs across the body and the bones follow it. Here the body joints found on the whole
 * picture (shoulder, elbow, wrist, hip, knee, ankle, toe) are turned into clean part layers —
 * one capsule per upper arm, forearm, hand, thigh, shin, foot and the torso — which the builder
 * rigs exactly as it rigs an artist's split; the real layers those parts lie in are skinned to
 * the part bones afterwards (built.figure.covered: layer → the parts it carries).
 *
 * Joints come in as [x, y, confidence] in WORLD coordinates (y up), in the 17-point body order
 * with optional toes: nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles (left
 * before right, the character's own left), then lToe, rToe when known.
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAutoPose = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const DEFAULTS = Object.freeze({
    minConf: 0.3,          // a joint below this is not used
    trunkConf: 0.4,        // shoulders and hips below this: not a figure (a wolf scored 0.15, the weakest human 0.45)
    coverFrac: 0.5,        // a layer with this share of its pixels on the figure is skinned to the figure
    partFrac: 0.12,        // ...and carries every part that it covers by this share of the part
    limbFrac: 0.35,        // a layer holding this share of parts of two different limbs is a category layer
    alpha: 40
  })
  const NEVER = new Set(['hair', 'face', 'head', 'eye', 'mouth', 'nose', 'accessory'])
  const IDX = { nose: 0, lEye: 1, rEye: 2, lEar: 3, rEar: 4, lShoulder: 5, rShoulder: 6, lElbow: 7, rElbow: 8, lWrist: 9, rWrist: 10, lHip: 11, rHip: 12, lKnee: 13, rKnee: 14, lAnkle: 15, rAnkle: 16, lToe: 17, rToe: 18 }

  function joints(kps, minConf) {
    const J = {}
    for (const k of Object.keys(IDX)) { const p = kps && kps[IDX[k]]; J[k] = p && p[2] >= minConf && isFinite(p[0]) && isFinite(p[1]) ? [p[0], p[1]] : null }
    return J
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

  /** A capsule chain (world points, one radius per point) as a layer the builder can read. */
  function capsuleLayer(name, pts, radii, hint) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    pts.forEach((p, i) => { const r = radii[i]; x0 = Math.min(x0, p[0] - r); x1 = Math.max(x1, p[0] + r); y0 = Math.min(y0, p[1] - r); y1 = Math.max(y1, p[1] + r) })
    x0 = Math.floor(x0) - 2; y0 = Math.floor(y0) - 2; x1 = Math.ceil(x1) + 2; y1 = Math.ceil(y1) + 2
    const w = Math.max(4, x1 - x0), h = Math.max(4, y1 - y0)
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s], b = pts[s + 1], ra = radii[s], rb = radii[s + 1]
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1
      const rm = Math.max(ra, rb)
      const bx0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - rm - x0)), bx1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0]) + rm - x0))
      const by0 = Math.max(0, Math.floor(y1 - Math.max(a[1], b[1]) - rm)), by1 = Math.min(h - 1, Math.ceil(y1 - Math.min(a[1], b[1]) + rm))
      for (let py = by0; py <= by1; py++) {
        const wy = y1 - py - 0.5
        for (let px = bx0; px <= bx1; px++) {
          const wx = x0 + px + 0.5
          const t = Math.max(0, Math.min(1, ((wx - a[0]) * dx + (wy - a[1]) * dy) / l2))
          const r = ra + (rb - ra) * t
          const ex = wx - a[0] - t * dx, ey = wy - a[1] - t * dy
          if (ex * ex + ey * ey <= r * r) { const q = (py * w + px) * 4; rgba[q] = rgba[q + 1] = rgba[q + 2] = 200; rgba[q + 3] = 255 }
        }
      }
    }
    return { name, att: name, width: w, height: h, rgba, place: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, hintOverride: hint, synthetic: true }
  }

  /** The share of a part's pixels that a layer covers, and of the layer's pixels on the part mask. */
  function alphaAt(l, wx, wy, thr) {
    const px = Math.floor(wx - l.place.x + l.width / 2), py = Math.floor(l.place.y + l.height / 2 - wy)
    if (px < 0 || py < 0 || px >= l.width || py >= l.height) return false
    return l.rgba[(py * l.width + px) * 4 + 3] > thr
  }

  /**
   * layers: the builder's layers ({ name, width, height, rgba, place }), back to front.
   * Returns null when the picture is not a figure the pass can use (no shoulders and hips, or
   * every limb already has a layer of its own), else { layers, covered, parts, joints }.
   */
  function figureLayers(layers, kps, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {})
    const AB = typeof globalThis !== 'undefined' ? globalThis.NovaFlowAutoBones : null
    const J = joints(kps, o.minConf)
    if (!J.lShoulder || !J.rShoulder || !J.lHip || !J.rHip) return null
    if ([5, 6, 11, 12].some((i) => !(kps[i][2] >= o.trunkConf))) return null
    const sh = mid(J.lShoulder, J.rShoulder), hp = mid(J.lHip, J.rHip)
    const torso = dist(sh, hp), shW = dist(J.lShoulder, J.rShoulder), hpW = dist(J.lHip, J.rHip)
    if (!(torso > 20) || sh[1] <= hp[1]) return null          // upside down or degenerate: not this pass
    const hintOf = (l) => (l.hintOverride && l.hintOverride.part) || (AB && AB.nameHint ? AB.nameHint(l.name).part : null)
    // ---- the parts
    const parts = []
    const rTorso = Math.max(0.24 * torso, 0.42 * Math.max(shW, hpW))
    const neckTop = J.nose ? lerp(sh, J.nose, 0.55) : [sh[0], sh[1] + 0.22 * torso]
    const up = [(sh[0] - hp[0]) / torso, (sh[1] - hp[1]) / torso]
    const crotch = [hp[0] - up[0] * 0.1 * torso, hp[1] - up[1] * 0.1 * torso]
    parts.push({ name: 'body', pts: [crotch, sh, neckTop], radii: [rTorso, rTorso, Math.max(6, 0.3 * rTorso)], hint: { part: 'body', side: null } })
    const limb = (side, kind) => {
      const S = side === 'l' ? 'l' : 'r'
      if (kind === 'arm') {
        const a = J[S + 'Shoulder'], b = J[S + 'Elbow'], c = J[S + 'Wrist']
        if (!a || !b) return
        const r = Math.max(5, 0.075 * torso)
        parts.push({ name: `arm_${side}`, pts: [a, b], radii: [r, 0.9 * r], hint: { part: 'arm', side }, figure: { root: a, tip: b } })
        if (!c) return
        parts.push({ name: `forearm_${side}`, pts: [b, c], radii: [0.9 * r, 0.75 * r], hint: { part: 'arm', side }, figure: { root: b, tip: c, after: `arm_${side}` } })
        const fl = dist(b, c) || 1, tip = [c[0] + (c[0] - b[0]) / fl * Math.max(12, 0.3 * torso * 0.9), c[1] + (c[1] - b[1]) / fl * Math.max(12, 0.3 * torso * 0.9)]
        parts.push({ name: `hand_${side}`, pts: [c, tip], radii: [0.8 * r, 0.8 * r], hint: { part: 'hand', side }, figure: { root: c, tip, after: `forearm_${side}` } })
      } else {
        const a = J[S + 'Hip'], b = J[S + 'Knee'], c = J[S + 'Ankle'], t = J[S + 'Toe']
        if (!a || !b) return
        const r = Math.max(6, 0.11 * torso)
        parts.push({ name: `leg_${side}`, pts: [a, b], radii: [r, 0.8 * r], hint: { part: 'leg', side }, figure: { root: a, tip: b } })
        if (!c) return
        parts.push({ name: `shin_${side}`, pts: [b, c], radii: [0.8 * r, 0.55 * r], hint: { part: 'leg', side }, figure: { root: b, tip: c, after: `leg_${side}` } })
        const sl = dist(b, c) || 1
        // without a toe point the foot runs on a little past the ankle, turned outward
        const tip = t && dist(t, c) > 0.08 * torso ? t : [c[0] + (side === 'l' ? 1 : -1) * 0.12 * torso * Math.sign((J.lHip[0] - J.rHip[0]) || 1), c[1] + (c[1] - b[1]) / sl * 0.12 * torso]
        parts.push({ name: `foot_${side}`, pts: [c, tip], radii: [0.55 * r, 0.5 * r], hint: { part: 'foot', side }, figure: { root: c, tip, after: `shin_${side}` } })
      }
    }
    limb('l', 'arm'); limb('r', 'arm'); limb('l', 'leg'); limb('r', 'leg')
    if (parts.length < 2) return null
    const partLayers = parts.map((p) => Object.assign(capsuleLayer(p.name, p.pts, p.radii, p.hint), p.figure ? { figure: p.figure } : {}))

    // ---- which real layers the figure lies in
    const covered = {}
    const kept = []
    const strong = new Set(), ownLimbs = new Set()
    const limbOf = (n) => n.replace(/^(forearm|hand)_/, 'arm_').replace(/^(shin|foot)_/, 'leg_')
    const areas = new Map()
    const areaOf = (p) => { if (!areas.has(p)) { let pa = 0; for (let i = 3; i < p.rgba.length; i += 4) if (p.rgba[i]) pa++; areas.set(p, pa) } return areas.get(p) }
    for (const l of layers) {
      if (l && l.rgba && hintOf(l) === 'hair') {
        // "hair" that hardly rises above the shoulders is a cape or a cloak: it hangs from the
        // body, not from the head (a knight's cloak labelled back hair swung from the helmet)
        let all = 0, above = 0
        const step = Math.max(1, Math.round(Math.max(l.width, l.height) / 300))
        for (let py = 0; py < l.height; py += step) for (let px = 0; px < l.width; px += step) {
          if (l.rgba[(py * l.width + px) * 4 + 3] <= o.alpha) continue
          all++; if (l.place.y + l.height / 2 - py > sh[1]) above++
        }
        if (all && above / all < 0.15) { kept.push(Object.assign({}, l, { hintOverride: Object.assign({}, l.hintOverride, { part: 'cloth', side: null }) })); continue }
      }
      if (!l || !l.rgba || NEVER.has(hintOf(l))) { kept.push(l); continue }
      let area = 0, on = 0
      const hit = new Array(partLayers.length).fill(0)
      const step = Math.max(1, Math.round(Math.max(l.width, l.height) / 400))
      for (let py = 0; py < l.height; py += step) {
        for (let px = 0; px < l.width; px += step) {
          if (l.rgba[(py * l.width + px) * 4 + 3] <= o.alpha) continue
          area++
          const wx = l.place.x + px + 0.5 - l.width / 2, wy = l.place.y + l.height / 2 - py - 0.5
          let any = false
          for (let k = 0; k < partLayers.length; k++) if (alphaAt(partLayers[k], wx, wy, 128)) { hit[k]++; any = true }
          if (any) on++
        }
      }
      if (!area) { kept.push(l); continue }
      const partsOn = []
      let held = null, heldShare = 0.15
      // a limb's own layer (an artist's split): most of the layer lies on that one limb and it
      // holds a good part of the limb
      {
        const g = {}, ga = {}
        partLayers.forEach((p, k) => { if (p.name === 'body') return; const limb = limbOf(p.name); g[limb] = (g[limb] || 0) + hit[k]; ga[limb] = (ga[limb] || 0) + areaOf(p) })
        // (one limb only: a layer that fits two is a pair of gloves over crossed arms, not a limb's own)
        const fits = Object.keys(g).filter((limb) => g[limb] >= 0.5 * area && g[limb] * step * step >= 0.25 * ga[limb])
        if (fits.length === 1) ownLimbs.add(fits[0])
      }
      partLayers.forEach((p, k) => {
        const share = hit[k] * step * step / Math.max(1, areaOf(p))
        if (/^hand_/.test(p.name) && share > heldShare) { heldShare = share; held = p.name }
        if (share >= o.partFrac) partsOn.push(p.name)
        if (share >= o.limbFrac && p.name !== 'body') strong.add(l.name + '|' + limbOf(p.name))
      })
      // on the figure: half of the layer lies on it, or it carries two whole parts (a coat with wide sleeves)
      if (partsOn.length && (on / area >= o.coverFrac || (partsOn.length >= 2 && on / area >= 0.3))) covered[l.name] = partsOn
      else kept.push(held ? Object.assign({}, l, { holdLayer: held }) : l)   // lying in a hand: held by it
    }
    if (!Object.keys(covered).length) return null
    // an artist's split has every limb in a layer of its own and needs no help: only when one
    // layer carries two different limbs (both legs, both arms, the whole character)
    const limbsOf = new Map()
    for (const k of strong) { const [ln, limb] = k.split('|'); if (!covered[ln]) continue; if (!limbsOf.has(ln)) limbsOf.set(ln, new Set()); limbsOf.get(ln).add(limb) }
    if (![...limbsOf.values()].some((v) => v.size >= 2)) return null
    if (ownLimbs.size >= 2) return null
    // ...or names them (gebo_1 / tui_5 / arm_l), category names (handwear, legwear) aside
    if (layers.filter((l) => l && ['arm', 'leg', 'hand', 'foot'].includes(hintOf(l)) && !/wear|tail|weiba/i.test(l.name || '')).length >= 2) return null
    // the parts go in at the back, the torso first: the layers that stay hang in front of them
    return { layers: partLayers.concat(kept.map((l) => (l && !l.synthetic ? Object.assign({}, l, { noLimb: true }) : l))), covered, parts: parts.map((p) => ({ name: p.name, pts: p.pts, radii: p.radii })), joints: J }
  }

  /**
   * After the builder ran on fig.layers: `built` gains figure = { covered: { layer: [bone names] } }
   * and every covered picture stays on the root (at the origin, unrotated), its mesh to be
   * weighted to the part bones.
   */
  function finishFigure(built, fig, layers) {
    const partNames = new Set(fig.parts.map((p) => p.name))
    const bonesOf = {}
    for (const b of built.bones) if (partNames.has(b.layer) && b.kind === 'bone') (bonesOf[b.layer] = bonesOf[b.layer] || []).push(b.name)
    const rootName = (built.bones[0] && built.bones[0].name) || 'root'
    const covered = {}
    built.slotBone = built.slotBone || {}
    built.attachment = built.attachment || {}
    for (const [layer, ps] of Object.entries(fig.covered)) {
      const l = layers.find((x) => x && x.name === layer)
      covered[layer] = ps.flatMap((p) => bonesOf[p] || [])
      built.slotBone[layer] = rootName
      built.attachment[layer] = { x: Math.round(l.place.x * 100) / 100, y: Math.round(l.place.y * 100) / 100, rotation: 0 }
    }
    for (const p of partNames) { delete built.slotBone[p]; delete built.attachment[p] }
    built.figure = { covered, joints: fig.joints, parts: fig.parts.map((p) => p.name) }
    return built
  }

  /** buildSkeleton with the figure pass (the plain builder when the picture is not such a figure). */
  function buildSkeleton(layers, kps, opts) {
    const AB = globalThis.NovaFlowAutoBones
    const fig = kps ? figureLayers(layers, kps, opts && opts.figure) : null
    if (!fig) return AB.buildSkeleton(layers, opts)
    return finishFigure(AB.buildSkeleton(fig.layers, opts), fig, layers)
  }

  // ------------------------------------------------------------ finding the joints ---
  // In the page: the layers are composited onto one picture, the figure is cropped to the
  // model's 192 × 256 input and the joints come back as 26 points (17 body + head, neck, hip,
  // big toes, small toes, heels). ONNX Runtime Web on the CPU (about half a second); the model
  // is downloaded once (in parts) and kept in Cache Storage like the matting one.
  const SCRIPT_URL = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || ''
  const MODEL = 'pose/model.bin', MODEL_VERSION = '1', IN_W = 192, IN_H = 256
  let session = null
  const vendorUrl = (file) => new URL('vendor/' + file, SCRIPT_URL || globalThis.location.href).href

  async function modelBytes() {
    const url = vendorUrl(MODEL), key = url + '?v=' + MODEL_VERSION
    let cache = null
    try { cache = await globalThis.caches.open('novaflow-models'); const hit = await cache.match(key); if (hit) return new Uint8Array(await hit.arrayBuffer()) } catch (_) { cache = null }
    let bytes
    const manifest = await globalThis.fetch(url + '.parts.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (manifest && Array.isArray(manifest.parts) && manifest.parts.length) {
      const parts = await Promise.all(manifest.parts.map(async (name) => { const r = await globalThis.fetch(new URL(name, url).href); if (!r.ok) throw new Error('pose model part ' + r.status); return new Uint8Array(await r.arrayBuffer()) }))
      const length = parts.reduce((n, q) => n + q.length, 0)
      if (manifest.bytes && length !== manifest.bytes) throw new Error('pose model incomplete')
      bytes = new Uint8Array(length); let off = 0
      for (const q of parts) { bytes.set(q, off); off += q.length }
    } else {
      const r = await globalThis.fetch(url)
      if (!r.ok) throw new Error('pose model ' + r.status)
      bytes = new Uint8Array(await r.arrayBuffer())
    }
    try { if (cache) await cache.put(key, new Response(bytes)) } catch (_) { /* the HTTP cache still has it */ }
    return bytes
  }
  function sessionFor() {
    if (!session) {
      session = (async () => {
        const ort = await import(vendorUrl('onnxruntime-web/ort.webgpu.min.mjs'))
        ort.env.wasm.wasmPaths = vendorUrl('onnxruntime-web/')
        ort.env.wasm.numThreads = 1
        ort.env.logLevel = 'error'
        const s = await ort.InferenceSession.create(await modelBytes(), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
        return { ort, s }
      })().catch((e) => { session = null; throw e })
    }
    return session
  }

  /**
   * The body joints of the character the layers make up, as figureLayers takes them (world
   * coordinates, y up), or null when the model cannot be had. A picture that is not a figure
   * comes back with low confidences and figureLayers declines it.
   */
  async function detect(layers) {
    const L = (layers || []).filter((l) => l && l.rgba && l.width > 0 && l.height > 0)
    if (!L.length || typeof document === 'undefined') return null
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const l of L) { x0 = Math.min(x0, l.place.x - l.width / 2); x1 = Math.max(x1, l.place.x + l.width / 2); y0 = Math.min(y0, l.place.y - l.height / 2); y1 = Math.max(y1, l.place.y + l.height / 2) }
    const W = Math.ceil(x1 - x0), H = Math.ceil(y1 - y0)
    if (!(W > 8 && H > 8)) return null
    const sc = Math.min(1, 1280 / Math.max(W, H))
    const cw = Math.max(1, Math.round(W * sc)), ch = Math.max(1, Math.round(H * sc))
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch
    const g = canvas.getContext('2d', { willReadFrequently: true })
    g.fillStyle = '#808080'; g.fillRect(0, 0, cw, ch)
    for (const l of L) {
      const bmp = await createImageBitmap(new ImageData(new Uint8ClampedArray(l.rgba.buffer, l.rgba.byteOffset, l.width * l.height * 4), l.width, l.height))
      g.drawImage(bmp, (l.place.x - l.width / 2 - x0) * sc, (y1 - l.place.y - l.height / 2) * sc, l.width * sc, l.height * sc)
      bmp.close()
    }
    // the figure's box: the opaque pixels of every layer (layers are often full-canvas pictures
    // with wide empty margins), a quarter larger, at the model's 3:4
    let tx0 = Infinity, ty0 = Infinity, tx1 = -Infinity, ty1 = -Infinity
    for (const l of L) {
      const step = Math.max(1, Math.round(Math.max(l.width, l.height) / 256))
      for (let py = 0; py < l.height; py += step) for (let px = 0; px < l.width; px += step) {
        if (l.rgba[(py * l.width + px) * 4 + 3] <= 40) continue
        const cx = (l.place.x - l.width / 2 + px - x0) * sc, cy = (y1 - l.place.y - l.height / 2 + py) * sc
        if (cx < tx0) tx0 = cx; if (cx > tx1) tx1 = cx; if (cy < ty0) ty0 = cy; if (cy > ty1) ty1 = cy
      }
    }
    if (!(tx1 > tx0 && ty1 > ty0)) return null
    const bw0 = (tx1 - tx0) * 1.25, bh0 = (ty1 - ty0) * 1.25
    const bw = bw0 / bh0 > IN_W / IN_H ? bw0 : bh0 * IN_W / IN_H, bh = bw0 / bh0 > IN_W / IN_H ? bw0 * IN_H / IN_W : bh0
    const crop = document.createElement('canvas'); crop.width = IN_W; crop.height = IN_H
    const cg = crop.getContext('2d', { willReadFrequently: true })
    cg.fillStyle = '#808080'; cg.fillRect(0, 0, IN_W, IN_H)
    const kx = IN_W / bw, ky = IN_H / bh, ox = IN_W / 2 - (tx0 + tx1) / 2 * kx, oy = IN_H / 2 - (ty0 + ty1) / 2 * ky
    cg.imageSmoothingQuality = 'high'
    cg.drawImage(canvas, ox, oy, cw * kx, ch * ky)
    const px = cg.getImageData(0, 0, IN_W, IN_H).data
    const n = IN_W * IN_H, data = new Float32Array(3 * n)
    const mean = [123.675, 116.28, 103.53], std = [58.395, 57.12, 57.375]
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) data[c * n + i] = (px[4 * i + c] - mean[c]) / std[c]
    const { ort, s } = await sessionFor()
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, IN_H, IN_W]) })
    const sx = out.simcc_x || out[s.outputNames[0]], sy = out.simcc_y || out[s.outputNames[1]]
    const K = sx.dims[1], nx = sx.dims[2], ny = sy.dims[2]
    const pts = []
    for (let k = 0; k < K; k++) {
      let bx = 0, vx = -Infinity, by = 0, vy = -Infinity
      for (let i = 0; i < nx; i++) { const v = sx.data[k * nx + i]; if (v > vx) { vx = v; bx = i } }
      for (let i = 0; i < ny; i++) { const v = sy.data[k * ny + i]; if (v > vy) { vy = v; by = i } }
      const cxp = (bx / (nx / IN_W) - ox) / kx, cyp = (by / (ny / IN_H) - oy) / ky
      pts.push([x0 + cxp / sc, y1 - cyp / sc, Math.min(vx, vy)])
    }
    // 17 body points, then the big toes (26-point order: 20 left, 21 right)
    return pts.slice(0, 17).concat(K >= 22 ? [pts[20], pts[21]] : [])
  }

  return { DEFAULTS, joints, capsuleLayer, figureLayers, finishFigure, buildSkeleton, detect }
})
