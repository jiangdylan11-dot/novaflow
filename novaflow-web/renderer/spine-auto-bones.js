/*
 * NovaFlow — 自动骨架 skeleton generation.
 *
 * Builds a Spine bone hierarchy for a layered 2D character from nothing but the
 * layer images and their placement (a PhotoshopToSpine export). No template of
 * a human is assumed: every layer is reduced to its pruned medial axis (Zhang-
 * Suen thinning of the alpha silhouette, spurs shorter than the local radius
 * removed), the widest layer becomes the trunk, every other layer hangs off an
 * existing bone at the end of its axis that meets its parent, and the axis
 * branches become bone chains. Layer names are an optional hint (arm/leg/hair/
 * face and their pinyin) that changes how a chain is cut, which bone it prefers
 * to hang from and whether it gets an IK constraint; geometry decides the rest,
 * so a quadruped or a single-layer sprite goes through the same path.
 *
 * Reference logic (the artist's rigs this was measured against): a pelvis pivot
 * under root, a spine chain waist → chest → neck → head, hip / shoulder
 * connector bones to each limb, 2–3 bone limbs with IK, and FK chains along
 * every hair strand, ribbon and skirt strip, rooted where the strand meets the
 * body. Dependency free apart from NovaFlowAutoMeshCore (EDT, hole filling,
 * component filter, Douglas-Peucker).
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAutoBones = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const core = () => {
    const g = typeof globalThis !== 'undefined' ? globalThis : null
    const c = g && g.NovaFlowAutoMeshCore
    if (!c) throw new Error('NovaFlowAutoMeshCore must be loaded before spine-auto-bones')
    return c
  }

  const DEFAULTS = Object.freeze({
    workScale: 0.5,        // analysis resolution relative to the image (bones are coarse)
    workMax: 700,          // ...but never more than this many px on the character's long side
    alphaThreshold: 40,    // silhouette alpha
    keepFrac: 0.02,        // drop components smaller than this fraction of the largest
    smoothIters: 1,        // morphological close/open passes (work px) before thinning
    spurFactor: 1.1,       // prune a leaf branch shorter than spurFactor × radius at its junction
    spurMin: 5,            // ...or shorter than this (work px)
    holeMaxFrac: 0.04,     // enclosed holes up to this fraction of the layer are filled before thinning
    tipExtend: 0.9,        // extend leaf ends by this × EDT so chains reach the silhouette
    dpFrac: 0.35,          // Douglas-Peucker sagitta as a fraction of the branch radius
    strandBone: 1.5,       // strand bone length ≈ strandBone × local width
    limbBone: 3.0,         // limb: a straight run is cut into ≤ 2 bones of ≈ limbBone × local width
    extremityBone: 2.2,    // hands / feet
    boneMin: 14,           // px, in image units
    boneMax: 260,
    trunkSplit: [0.33, 0.83],      // waist→chest and chest→neck joints as fractions of hips → neck top
    connectorMin: 12,      // insert a hip/shoulder bone when the limb root is further than this from the trunk joint
    hairFlowCover: 0.5,    // hair flow lines must cover this share of the visible lock mask, else the medial axis
    hairlineMargin: 0.05,  // the scalp cap starts this far (× face height) above the face layer's top
    ik: true,
    names: true,           // use layer names as hints
    rigStyle: 'artist',    // 'artist': per-bone stretchy IK + hidden helper chains + pivots (the studio's rigs); 'simple': plain 2-bone IK
    helperScale: 1.12,     // helper chain length / limb length: longer, so the helper always bends the same way
    followMix: 0.6,        // the joint target follows the helper's knee at this mix
    sliders: true,         // face_turn / face_turn_back / body_up_turn / body_down_turn
    faceDetect: true       // eye / mouth controllers from the face image
  })

  // ------------------------------------------------------------ name hints ---

  // token → part. Tokens are the name split on non-letters (hair_back → hair, back;
  // fa7 → fa; toufa_1 → toufa). Chinese-pinyin conventions of the studio included.
  const PART_TOKENS = {
    body: ['body', 'torso', 'shenti', 'shangbanshen', 'shangshen', 'st', 'qugan', 'waist', 'yao', 'fuqu', 'abdomen', 'trunk'],
    head: ['head', 'tou', 'naodai'],
    face: ['face', 'faec', 'lian'],
    hair: ['hair', 'toufa', 'fa', 'faku', 'fasi', 'bianzi', 'liuhai', 'ponytail', 'bangs', 'mao', 'zongmao'],
    arm: ['arm', 'gebo', 'shoubi', 'bi', 'upperarm', 'forearm', 'xiaobi', 'dabi', 'shangbi', 'youxiaobi', 'youshagnbi', 'youshangbi', 'zuoshangbi', 'zuoxiaobi'],
    hand: ['hand', 'shou', 'shouzhi', 'finger', 'finge', 'zhi', 'shoubu', 'zuoshou', 'youshou', 'fist', 'quan'],
    leg: ['leg', 'tui', 'datui', 'xiaotui', 'thigh', 'shin', 'zuodatui', 'youdatui', 'zuoxiaotui', 'youxiaotui', 'tail', 'weiba'],
    foot: ['foot', 'feet', 'jiao', 'zuojiao', 'youjiao', 'xie', 'shoe', 'boot', 'xuezi'],
    cloth: ['skirt', 'qun', 'qunzi', 'qunbai', 'bu', 'dai', 'daizi', 'ribbon', 'piaodai', 'piao', 'cloak', 'pifeng', 'sleeve', 'xiuzi', 'xiu', 'yifu', 'cloth', 'scarf', 'weijin', 'sash', 'yaodai', 'shawl', 'lace', 'cape', 'strap', 'string', 'sui', 'tassel', 'liusu', 'wing', 'chibang', 'feather', 'yumao', 'ear', 'erduo'],
    accessory: ['fashi', 'fashj', 'toushi', 'yaoshi', 'ershi', 'earwear', 'earring', 'xianlian', 'zhuangshi', 'hua', 'flower', 'shanzi', 'fan', 'jewel', 'gem', 'crown', 'huangguan', 'tiara', 'necklace', 'bracelet', 'shouzhuo', 'ring', 'jiezhi', 'bow', 'ornament', 'deco', 'belt', 'buckle', 'badge', 'weapon', 'sword', 'jian', 'dao', 'staff', 'shield', 'dun', 'bag', 'bao'],
    bra: ['xiongzhao', 'bra', 'wenxiong', 'neiyi', 'bikini'],
    eye: ['eye', 'yan', 'yanjing', 'yanpi', 'yanbai', 'tongkong', 'pupil', 'eyelid', 'lid', 'iris', 'eyebrow', 'brow', 'meimao', 'mm', 'mei'],
    mouth: ['mouth', 'zui', 'zuiba', 'lip', 'chun', 'teeth', 'ya', 'tongue', 'shetou'],
    nose: ['nose', 'bizi'],
    breast: ['breast', 'mimi', 'xiongbu', 'boob', 'xiong', 'chest', 'ru', 'rufang']
  }
  const SIDE_TOKENS = { l: ['l', 'left', 'zuo'], r: ['r', 'right', 'you'] }
  const HEAD_PARTS = new Set(['head', 'face', 'eye', 'mouth', 'nose'])
  const TOKEN_PART = new Map()
  for (const part of Object.keys(PART_TOKENS)) for (const t of PART_TOKENS[part]) if (!TOKEN_PART.has(t)) TOKEN_PART.set(t, part)
  // compound tokens, e.g. "toufa1" → hair, "youxiaobi" → arm
  const PREFIX_RULES = [
    [/^(toufa|hair|fa\d*$|faku|liuhai)/, 'hair'], [/^(xiongzhao|wenxiong|neiyi)/, 'bra'], [/^(toushi|fashi|fashj|yaoshi|ershi|xianlian|zhuangshi)/, 'accessory'],
    [/^(shouzhi|finge|zuoshou|youshou|hand)/, 'hand'], [/^(datui|xiaotui|zuodatui|youdatui|zuoxiaotui|youxiaotui|tui|leg)/, 'leg'],
    [/^(gebo|shoubi|xiaobi|dabi|shangbi|zuoshangbi|youshangbi|youshagnbi|zuoxiaobi|youxiaobi|arm)/, 'arm'], [/^(jiao|zuojiao|youjiao|foot)/, 'foot'],
    [/^(yanpi|yanbai|tongkong|eye|yan)/, 'eye'], [/^(zui|mouth|lip)/, 'mouth'], [/^(zuomimi|youmimi|mimi|breast|xiongbu)/, 'breast'], [/^(qunzi|qunbai|qun|skirt|daizi|dai|piaodai|bu\d*$)/, 'cloth'],
    [/^(shangbanshen|body|torso|shenti)/, 'body'], [/^(face|faec|lian$)/, 'face'], [/^(tou$|head)/, 'head']
  ]
  const CN_RULES = [[/身|躯|胸|腰|腹/, 'body'], [/头发|发|辫/, 'hair'], [/头|脑/, 'head'], [/脸|面/, 'face'], [/手指|指/, 'hand'], [/手|臂|胳膊/, 'arm'], [/脚|足|鞋/, 'foot'], [/腿|尾/, 'leg'], [/裙|布|带|袖|飘|披|翅|羽|耳/, 'cloth'], [/眼|眉|瞳/, 'eye'], [/嘴|唇|口/, 'mouth'], [/饰|花|链|冠|扇|剑|刀/, 'accessory']]

  function nameHint(name) {
    const raw = String(name || '').toLowerCase()
    const tokens = raw.split(/[^a-z]+/).filter(Boolean)
    let part = null, side = null
    for (const t of tokens) {
      if (!part && TOKEN_PART.has(t)) part = TOKEN_PART.get(t)
      if (!side) { if (SIDE_TOKENS.l.includes(t)) side = 'l'; else if (SIDE_TOKENS.r.includes(t)) side = 'r' }
    }
    if (!part) for (const t of tokens) { for (const [re, p] of PREFIX_RULES) if (re.test(t)) { part = p; break } if (part) break }
    if (!part && /[一-鿿]/.test(raw)) {
      for (const [re, p] of CN_RULES) if (re.test(raw)) { part = p; break }
      if (/左/.test(raw)) side = 'l'; else if (/右/.test(raw)) side = 'r'
    }
    return { part, side }
  }
  // Structural priors by part: which parts a layer prefers to hang from, and which
  // parts must be placed before it (a forearm layer waits for the upper arm).
  const PREFERRED_PARENT = {
    hand: ['arm', 'hand'], foot: ['leg', 'foot'], arm: ['body', 'arm'], leg: ['body', 'leg'],
    hair: ['head', 'face'], eye: ['head', 'face'], mouth: ['head', 'face'], nose: ['head', 'face'], breast: ['body'], bra: ['body'],
    face: ['head', 'body'], head: ['body'], cloth: ['body', 'head', 'face', 'leg', 'arm'], accessory: []
  }
  const WAIT_FOR = {
    hand: ['arm'], foot: ['leg'], hair: ['head', 'face'], eye: ['head', 'face'], mouth: ['head', 'face'], nose: ['head', 'face'],
    cloth: ['arm', 'leg', 'head', 'face'], accessory: ['arm', 'leg', 'head', 'face', 'hair', 'cloth', 'hand', 'foot']
  }

  // ------------------------------------------------------- image analysis ---

  /** Max-pooled alpha mask at a working scale (thin strands survive). */
  function downMask(rgba, w, h, s, thr) {
    const ws = Math.max(1, Math.ceil(w * s)), hs = Math.max(1, Math.ceil(h * s))
    const m = new Uint8Array(ws * hs)
    for (let y = 0; y < h; y++) {
      const gy = Math.min(hs - 1, Math.floor(y * s))
      for (let x = 0; x < w; x++) {
        if (rgba[4 * (y * w + x) + 3] < thr) continue
        m[gy * ws + Math.min(ws - 1, Math.floor(x * s))] = 1
      }
    }
    return { mask: m, ws, hs }
  }

  function dilate(mask, w, h) {
    const out = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[yy * w + xx] = 1
      }
    }
    return out
  }
  function erode(mask, w, h) {
    const out = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      let ok = 1
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) { ok = 0; break }
      }
      out[y * w + x] = ok
    }
    return out
  }

  function crossingNumber(img, i, w) {
    const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1]
    const p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1]
    let A = 0
    if (!p2 && p3) A++; if (!p3 && p4) A++; if (!p4 && p5) A++; if (!p5 && p6) A++
    if (!p6 && p7) A++; if (!p7 && p8) A++; if (!p8 && p9) A++; if (!p9 && p2) A++
    return { A, B: p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9, p2, p4, p6, p8 }
  }

  /**
   * Fill enclosed holes no bigger than `maxFrac` of the mask (anti-aliasing gaps, eye
   * cut-outs); a big enclosed gap (between two legs whose feet touch) stays open, or the
   * legs would thin into one stem.
   */
  function fillSmallHoles(mask, w, h, maxFrac) {
    const C = core()
    const filled = C.fillHoles(mask, w, h)
    let area = 0
    for (let i = 0; i < w * h; i++) area += mask[i]
    const limit = Math.max(4, maxFrac * area)
    const lab = new Int32Array(w * h).fill(-1)
    const out = Uint8Array.from(mask)
    for (let i0 = 0; i0 < w * h; i0++) {
      if (lab[i0] >= 0 || !filled[i0] || mask[i0]) continue
      const comp = [i0]; lab[i0] = i0
      for (let k = 0; k < comp.length; k++) {
        const i = comp[k], x = i % w, y = (i / w) | 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const j = yy * w + xx
          if (lab[j] < 0 && filled[j] && !mask[j]) { lab[j] = i0; comp.push(j) }
        }
      }
      if (comp.length <= limit) for (const i of comp) out[i] = 1
    }
    return out
  }

  /** Zhang-Suen thinning; `mask` must have a background border. */
  function thin(mask, w, h) {
    const img = Uint8Array.from(mask)
    const del = []
    let changed = true
    while (changed) {
      changed = false
      for (let pass = 0; pass < 2; pass++) {
        del.length = 0
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x
            if (!img[i]) continue
            const { A, B, p2, p4, p6, p8 } = crossingNumber(img, i, w)
            if (B < 2 || B > 6 || A !== 1) continue
            if (pass === 0) { if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue }
            else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue
            del.push(i)
          }
        }
        if (del.length) { changed = true; for (const i of del) img[i] = 0 }
      }
    }
    // remove the staircase corners Zhang-Suen leaves so every path is 1 px wide
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (!img[i]) continue
        const n = img[i - w], e = img[i + 1], s = img[i + w], wv = img[i - 1]
        if ((n && e) || (e && s) || (s && wv) || (wv && n)) {
          const { A, B } = crossingNumber(img, i, w)
          if (A === 1 && B >= 2) img[i] = 0
        }
      }
    }
    return img
  }

  const N8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]

  /**
   * Skeleton pixels → graph {nodes:[{x,y,r,deg,edges}], edges:[{a,b,pts,len,rMean,rMin}]}.
   * Junction pixel clusters collapse into one node; loops without a node get one.
   */
  function graphFromSkeleton(sk, w, h, dist) {
    const deg = new Int8Array(w * h)
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!sk[i]) continue
      let d = 0
      for (const [dx, dy] of N8) if (sk[(y + dy) * w + x + dx]) d++
      deg[i] = d
    }
    const nodeOf = new Int32Array(w * h).fill(-1)
    const nodes = []
    const newNode = (px) => {
      let sx = 0, sy = 0, r = 0
      for (const j of px) { sx += j % w; sy += (j / w) | 0; r = Math.max(r, dist[j]) }
      const id = nodes.length
      for (const j of px) nodeOf[j] = id
      nodes.push({ x: sx / px.length, y: sy / px.length, r, pixels: px, deg: 0, edges: [] })
      return id
    }
    for (let i = 0; i < w * h; i++) {
      if (!sk[i] || deg[i] < 3 || nodeOf[i] >= 0) continue
      const px = []
      const stack = [i]; nodeOf[i] = -2
      while (stack.length) {
        const j = stack.pop(); px.push(j)
        const x = j % w, y = (j / w) | 0
        for (const [dx, dy] of N8) {
          const k = (y + dy) * w + x + dx
          if (sk[k] && deg[k] >= 3 && nodeOf[k] === -1) { nodeOf[k] = -2; stack.push(k) }
        }
      }
      newNode(px)
    }
    for (let i = 0; i < w * h; i++) if (sk[i] && deg[i] === 1 && nodeOf[i] < 0) newNode([i])
    for (let i = 0; i < w * h; i++) if (sk[i] && deg[i] === 0 && nodeOf[i] < 0) newNode([i])
    const edges = []
    const visited = new Uint8Array(w * h)
    const walk = (start, from) => {
      const pts = [from % w, (from / w) | 0]
      let prev = from, cur = start, len = 0, rSum = 0, rMin = Infinity, n = 0
      const startNode = nodeOf[from]
      for (let guard = 0; guard < w * h; guard++) {
        const x = cur % w, y = (cur / w) | 0
        len += Math.hypot(x - (prev % w), y - ((prev / w) | 0))
        pts.push(x, y)
        if (nodeOf[cur] >= 0) return { end: nodeOf[cur], pts, len, rMean: n ? rSum / n : dist[cur], rMin: Math.min(rMin, dist[cur]) }
        visited[cur] = 1
        rSum += dist[cur]; rMin = Math.min(rMin, dist[cur]); n++
        let next = -1
        for (let pass = 0; pass < 2 && next < 0; pass++) {   // 4-neighbours first: staircases walk straight
          for (let d = pass; d < 8; d += 2) {
            const k = (y + N8[d][1]) * w + x + N8[d][0]
            if (!sk[k] || k === prev) continue
            if (nodeOf[k] === startNode && len < 2.5) continue   // still touching the start cluster
            if (visited[k]) continue
            next = k; break
          }
        }
        if (next < 0) {
          const id = newNode([cur])
          return { end: id, pts, len, rMean: n ? rSum / n : dist[cur], rMin }
        }
        prev = cur; cur = next
      }
      return null
    }
    const addEdge = (a, b, pts, len, rMean, rMin) => {
      const e = { a, b, pts, len, rMean, rMin }
      edges.push(e)
      nodes[a].edges.push(edges.length - 1); nodes[b].edges.push(edges.length - 1)
      nodes[a].deg++; nodes[b].deg++
    }
    for (let id = 0; id < nodes.length; id++) {
      const nd = nodes[id]
      for (const j of nd.pixels) {
        const x = j % w, y = (j / w) | 0
        for (const [dx, dy] of N8) {
          const k = (y + dy) * w + x + dx
          if (!sk[k] || visited[k]) continue
          if (nodeOf[k] === id) continue
          if (nodeOf[k] >= 0) {
            if (nodeOf[k] > id && !edges.some((e) => (e.a === id && e.b === nodeOf[k]) || (e.b === id && e.a === nodeOf[k]))) addEdge(id, nodeOf[k], [x, y, k % w, (k / w) | 0], 1, dist[j], dist[j])
            continue
          }
          const r = walk(k, j)
          if (r) addEdge(id, r.end, r.pts, r.len, r.rMean, r.rMin)
        }
      }
    }
    for (let i = 0; i < w * h; i++) {   // loops with no node at all
      if (!sk[i] || visited[i] || nodeOf[i] >= 0) continue
      const id = newNode([i])
      const x = i % w, y = (i / w) | 0
      for (const [dx, dy] of N8) {
        const k = (y + dy) * w + x + dx
        if (!sk[k] || visited[k] || nodeOf[k] >= 0) continue
        const r = walk(k, i)
        if (r) addEdge(id, r.end, r.pts, r.len, r.rMean, r.rMin)
      }
    }
    return { nodes, edges }
  }

  function reversePts(p) { const o = []; for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i], p[i + 1]); return o }

  /** Remove spurs shorter than the local radius, merge through degree-2 nodes. */
  function pruneGraph(g, opts) {
    const nodes = g.nodes.map((n) => ({ x: n.x, y: n.y, r: n.r, pixels: n.pixels, raw: n.raw, ext: n.ext, edges: n.edges.slice() }))
    const edges = g.edges.map((e) => Object.assign({}, e))
    const alive = edges.map(() => true)
    const degOf = (n) => nodes[n].edges.filter((e) => alive[e]).length
    const other = (e, n) => (edges[e].a === n ? edges[e].b : edges[e].a)
    let changed = true
    let guard = 0
    while (changed && guard++ < 10000) {
      changed = false
      for (let n = 0; n < nodes.length; n++) {
        if (degOf(n) !== 1) continue
        const e = nodes[n].edges.find((k) => alive[k])
        const j = other(e, n)
        if (j === n || degOf(j) < 2) continue                   // an isolated segment: keep
        const limit = Math.max(opts.spurMin, opts.spurFactor * nodes[j].r)
        // a bump's axis is short AND thin at its end; the rounded end of the body itself
        // (a fish's head) is short only because the axis stops where the width does
        if (edges[e].len < limit) { alive[e] = false; changed = true }
      }
      for (let n = 0; n < nodes.length; n++) {
        if (degOf(n) !== 2) continue
        const [e1, e2] = nodes[n].edges.filter((k) => alive[k])
        if (e1 === e2) continue
        const a = other(e1, n), b = other(e2, n)
        if (a === n || b === n) continue
        const E1 = edges[e1], E2 = edges[e2]
        const p1 = E1.a === n ? reversePts(E1.pts) : E1.pts.slice()      // a → n
        const p2 = E2.a === n ? E2.pts.slice() : reversePts(E2.pts)      // n → b
        const len = E1.len + E2.len
        alive[e1] = false; alive[e2] = false
        const id = edges.length
        edges.push({ a, b, pts: p1.concat(p2.slice(2)), len, rMean: (E1.rMean * E1.len + E2.rMean * E2.len) / Math.max(1e-9, len), rMin: Math.min(E1.rMin, E2.rMin) })
        alive.push(true)
        nodes[a].edges.push(id); nodes[b].edges.push(id)
        changed = true
      }
    }
    const outNodes = nodes.map((n) => ({ x: n.x, y: n.y, r: n.r, pixels: n.pixels, raw: n.raw, ext: n.ext, deg: 0, edges: [] }))
    const outEdges = []
    edges.forEach((e, i) => {
      if (!alive[i]) return
      const id = outEdges.length
      outEdges.push(e)
      outNodes[e.a].edges.push(id); outNodes[e.b].edges.push(id); outNodes[e.a].deg++; outNodes[e.b].deg++
    })
    return { nodes: outNodes, edges: outEdges }
  }

  /** Extend every leaf end by tipExtend × EDT along its last direction. */
  function extendTips(g, dist, w, h, opts) {
    for (let n = 0; n < g.nodes.length; n++) {
      const nd = g.nodes[n]
      if (nd.deg !== 1) continue
      const e = g.edges[nd.edges[0]]
      const pts = e.a === n ? e.pts : reversePts(e.pts)
      const r = Math.max(2, nd.r)
      let k = 2, acc = 0
      for (; k < pts.length - 2 && acc < r; k += 2) acc += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1])
      const dx = pts[0] - pts[k], dy = pts[1] - pts[k + 1]
      const L = Math.hypot(dx, dy)
      if (L < 1e-6) continue
      const ix = Math.max(0, Math.min(w - 1, Math.round(pts[0]))), iy = Math.max(0, Math.min(h - 1, Math.round(pts[1])))
      // a leaf's radius is the local half-width near the tip, not the EDT at the
      // very end (which runs to ~0 where the axis reaches a flat cut)
      let rLocal = 0, acc2 = 0
      for (let j = 0; j < pts.length - 2 && acc2 <= Math.max(6, 1.5 * e.rMean); j += 2) {
        const jx = Math.max(0, Math.min(w - 1, Math.round(pts[j]))), jy = Math.max(0, Math.min(h - 1, Math.round(pts[j + 1])))
        rLocal = Math.max(rLocal, dist[jy * w + jx])
        if (j) acc2 += Math.hypot(pts[j] - pts[j - 2], pts[j + 1] - pts[j - 1])
      }
      nd.rTip = nd.r
      nd.r = Math.max(nd.r, rLocal)
      nd.raw = [pts[0], pts[1]]
      const ext = opts.tipExtend * dist[iy * w + ix]
      if (ext < 0.5) continue
      const nx = pts[0] + dx / L * ext, ny = pts[1] + dy / L * ext
      nd.x = nx; nd.y = ny; nd.ext = ext
      if (e.a === n) e.pts.unshift(nx, ny); else e.pts.push(nx, ny)
      e.len += ext
    }
  }

  /** Douglas-Peucker each branch, keep the radius per kept point. */
  function simplifyGraph(g, dist, w, h, opts) {
    const C = core()
    for (const e of g.edges) {
      const eps = Math.max(1.0, opts.dpFrac * e.rMean)
      e.poly = Array.from(C.dpSimplify(Float64Array.from(e.pts), eps))
      e.radii = []
      for (let i = 0; i < e.poly.length; i += 2) {
        const x = Math.max(0, Math.min(w - 1, Math.round(e.poly[i]))), y = Math.max(0, Math.min(h - 1, Math.round(e.poly[i + 1])))
        e.radii.push(dist[y * w + x])
      }
    }
  }

  /** EDT → thinning → graph → prune → tips → DP on a padded work mask; graph in image px. */
  function skeletonizeMask(m, pw, ph, s, o) {
    const C = core()
    const { dist } = C.edt(m, pw, ph, {})
    const sk = thin(m, pw, ph)
    let g = graphFromSkeleton(sk, pw, ph, dist)
    g = pruneGraph(g, o)
    extendTips(g, dist, pw, ph, o)
    simplifyGraph(g, dist, pw, ph, o)
    const toImg = (v) => (v - 1 + 0.5) / s
    const nodes = g.nodes.map((n) => ({ x: toImg(n.x), y: toImg(n.y), r: n.r / s, rTip: (n.rTip === undefined ? n.r : n.rTip) / s, deg: n.deg, edges: n.edges, raw: n.raw ? [toImg(n.raw[0]), toImg(n.raw[1])] : null, ext: (n.ext || 0) / s }))
    const edges = g.edges.map((e) => ({ a: e.a, b: e.b, len: e.len / s, rMean: e.rMean / s, rMin: e.rMin / s, poly: e.poly.map(toImg), radii: e.radii.map((r) => r / s) }))
    return { dist, sk, graph: { nodes, edges } }
  }

  /**
   * Analyse one layer image. Geometry comes back in IMAGE pixels (y down):
   * { w, h, scale, ws, hs, mask, dist, area, bbox, graph } where graph edges carry
   * `poly` (simplified polyline), `radii` and `len`, all in image px.
   */
  function analyzeLayer(rgba, w, h, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {})
    const C = core()
    let s = o.scale || Math.min(o.workScale, o.workMax / Math.max(w, h))
    {
      // a thin ribbon (a cord, a hair wisp ≈ 10 px wide) breaks into fragments at half
      // resolution: estimate the width from the alpha and keep thin layers at full size
      let cnt = 0, x0 = w, x1 = -1, y0 = h, y1 = -1
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rgba[4 * (y * w + x) + 3] >= o.alphaThreshold) { cnt++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
      const wEst = cnt / Math.max(1, Math.max(x1 - x0 + 1, y1 - y0 + 1))
      if (cnt && wEst < 20 && o.thinFullRes !== false) s = Math.max(s, Math.min(1, o.workMax / Math.max(w, h)))
    }
    const dm = downMask(rgba, w, h, s, o.alphaThreshold)
    const { ws, hs } = dm
    if (typeof o.exclude === 'function') {
      // drop cells hidden behind other layers (hair behind a face / body): the axis then
      // follows the visible strands round the sides instead of running across the face
      for (let y = 0; y < hs; y++) for (let x = 0; x < ws; x++) { if (dm.mask[y * ws + x] && o.exclude((x + 0.5) / s, (y + 0.5) / s)) dm.mask[y * ws + x] = 0 }
    }
    const pw = ws + 2, ph = hs + 2
    let m = new Uint8Array(pw * ph)
    for (let y = 0; y < hs; y++) for (let x = 0; x < ws; x++) m[(y + 1) * pw + x + 1] = dm.mask[y * ws + x]
    m = fillSmallHoles(m, pw, ph, o.holeMaxFrac)
    for (let i = 0; i < o.smoothIters; i++) { m = erode(dilate(m, pw, ph), pw, ph); m = dilate(erode(m, pw, ph), pw, ph) }
    m = fillSmallHoles(m, pw, ph, o.holeMaxFrac)
    const lc = C.largestComponents(m, pw, ph, o.keepFrac)
    m = lc.mask
    let area = 0, minX = pw, minY = ph, maxX = -1, maxY = -1
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) if (m[y * pw + x]) { area++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    if (!area) return null
    const { dist, sk, graph } = skeletonizeMask(m, pw, ph, s, o)
    const { nodes, edges } = graph
    const toImg = (v) => (v - 1 + 0.5) / s
    return {
      w, h, scale: s, ws: pw, hs: ph, mask: m, dist, skeleton: sk,
      area: area / (s * s), bbox: [toImg(minX) - 0.5 / s, toImg(minY) - 0.5 / s, toImg(maxX) + 0.5 / s, toImg(maxY) + 0.5 / s],
      graph: { nodes, edges }, components: lc.count
    }
  }

  // ------------------------------------------------------ face features ---

  /**
   * Eyes and mouth on a face / head layer, for the controller points of the studio's
   * rigs (upper and lower lid per eye, four points round the mouth, a "nose" point for
   * the face-turn handle). Skin is the colour of the layer's middle band; whatever is not
   * skin but enclosed by skin (holes of the skin blob) is a feature: the two biggest
   * side-by-side ones in the upper part are the eyes, the biggest / reddest one below
   * them the mouth. Eyebrows (wide, flat, above an eye) are skipped. Works on tilted
   * heads: the mouth is searched along the axis perpendicular to the eye line.
   * Returns {eyes:[{center,top,bottom,area}], mouth:{center,up,down,l,r}|null, nose, up, summary}
   * in IMAGE pixels (y down), or null when no eye is found.
   */
  function detectFace(rgba, w, h, opts) {
    const C = core()
    const thr = (opts && opts.alphaThreshold) || 40
    const n = w * h
    const alpha = new Uint8Array(n)
    let minX = w, maxX = -1, minY = h, maxY = -1, cnt = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (rgba[4 * i + 3] >= thr) { alpha[i] = 1; cnt++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y } }
    if (cnt < 64) return null
    const lum = new Float32Array(n), cr = new Float32Array(n), cg = new Float32Array(n), red = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      if (!alpha[i]) continue
      const r = rgba[4 * i], g = rgba[4 * i + 1], b = rgba[4 * i + 2], sum = Math.max(1, r + g + b)
      lum[i] = 0.3 * r + 0.59 * g + 0.11 * b; cr[i] = r / sum; cg[i] = g / sum; red[i] = Math.max(0, r - Math.max(g, b))
    }
    // skin colour: median chroma of a central band (nose / cheeks), robust to hair in the layer
    const bw = maxX - minX + 1, bh = maxY - minY + 1
    const samp = []
    for (let y = Math.round(minY + 0.5 * bh); y < minY + 0.72 * bh; y++) for (let x = Math.round(minX + 0.35 * bw); x < minX + 0.65 * bw; x++) { const i = y * w + x; if (alpha[i]) samp.push(i) }
    if (samp.length < 16) return null
    const med = (arr) => { const a = arr.slice().sort((p, q) => p - q); return a[a.length >> 1] }
    const skinCr = med(samp.map((i) => cr[i])), skinCg = med(samp.map((i) => cg[i])), skinL = med(samp.map((i) => lum[i]))
    const skinRed = med(samp.map((i) => red[i]))
    const skin = new Uint8Array(n), dark = new Uint8Array(n), feat = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      if (!alpha[i]) continue
      const dc = Math.hypot(cr[i] - skinCr, cg[i] - skinCg)
      if (dc < 0.055 && lum[i] > 0.42 * skinL && lum[i] < skinL * 1.45 + 30) skin[i] = 1
      if (lum[i] < 0.72 * skinL) dark[i] = 1
      if (!skin[i] || dark[i] || red[i] > skinRed + 30) feat[i] = 1
    }
    // the face = the biggest skin blob (holes closed), its box is the working frame
    let m = skin
    for (let k = 0; k < 2; k++) m = dilate(m, w, h)
    for (let k = 0; k < 2; k++) m = erode(m, w, h)
    const F = C.largestComponents(m, w, h, 0.5).mask
    let fArea = 0, fx0 = w, fx1 = -1, fy0 = h, fy1 = -1
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (F[y * w + x]) { fArea++; if (x < fx0) fx0 = x; if (x > fx1) fx1 = x; if (y < fy0) fy0 = y; if (y > fy1) fy1 = y }
    if (fArea < 64) return null
    const fw = fx1 - fx0 + 1, fh = fy1 - fy0 + 1
    const filled = C.fillHoles(F, w, h)
    // connected components of a mask, restricted to the filled face box, 4-connected
    const components = (mask) => {
      const lab = new Int32Array(n).fill(-1)
      const out = []
      for (let i0 = 0; i0 < n; i0++) {
        if (lab[i0] >= 0 || !mask[i0] || !filled[i0]) continue
        const id = out.length
        const stack = [i0]; lab[i0] = id
        let area = 0, sx = 0, sy = 0, sRed = 0, sDark = 0, bx0 = w, bx1 = -1, by0 = h, by1 = -1
        const px = []
        while (stack.length) {
          const i = stack.pop(); area++
          const x = i % w, y = (i / w) | 0
          sx += x; sy += y; px.push(i)
          if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y
          sRed += red[i]; sDark += Math.max(0, skinL - lum[i])
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const xx = x + dx, yy = y + dy
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
            const j = yy * w + xx
            if (lab[j] < 0 && mask[j] && filled[j]) { lab[j] = id; stack.push(j) }
          }
        }
        out.push({ id, area, cx: sx / area, cy: sy / area, red: sRed / area, dark: sDark / area, bx0, bx1, by0, by1, px })
      }
      return out
    }
    // eye interior: iris and white — clearly coloured or bright non-skin pixels (not the
    // beige of a shadow, not the dark of hair) touching the dark outline, in a box that
    // reaches further below the lash line than above it
    // eye interior: not skin, and either not dark or dark-but-coloured (a red or blue
    // iris is darker than skin yet saturated; a black outline or pupil is not)
    const sat = (i) => { const r = rgba[4 * i], g = rgba[4 * i + 1], b = rgba[4 * i + 2]; const mx = Math.max(r, g, b); return mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0 }
    const eyeInside = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (alpha[i] && !skin[i] && (!dark[i] || sat(i) > 0.35)) eyeInside[i] = 1
    const eyeBox = (b) => {
      const bwid = Math.max(6, b.bx1 - b.bx0 + 1)
      // the eye lies under its lash line: the box starts at the blob's middle, never above its top
      return [Math.max(0, Math.floor(b.bx0 - 0.15 * bwid)), Math.max(0, Math.floor(Math.max(b.by0, b.cy - 0.25 * bwid))), Math.min(w - 1, Math.ceil(b.bx1 + 0.15 * bwid)), Math.min(h - 1, Math.ceil(b.by1 + 0.8 * bwid))]
    }
    /** Biggest 4-connected patch of eye-interior pixels inside the blob's box. */
    const eyeCore = (b) => {
      const [x0, y0, x1, y1] = eyeBox(b)
      const seen = new Uint8Array(n)
      let best = [], bestScore = 0
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i0 = y * w + x
        if (seen[i0] || !eyeInside[i0] || !filled[i0]) continue
        const comp = []; const stack = [i0]; seen[i0] = 1
        while (stack.length) {
          const i = stack.pop(); comp.push(i)
          const cx = i % w, cy = (i / w) | 0
          for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const xx = cx + ddx, yy = cy + ddy
            if (xx < x0 || yy < y0 || xx > x1 || yy > y1) continue
            const j = yy * w + xx
            if (!seen[j] && eyeInside[j] && filled[j]) { seen[j] = 1; stack.push(j) }
          }
        }
        // an iris is coloured; a shadow or a strand of hair in the box is not
        let sSum = 0; for (const i of comp) sSum += sat(i)
        const score = comp.length * (1 + 3 * sSum / comp.length)
        if (score > bestScore) { bestScore = score; best = comp }
      }
      return best
    }
    const grow = (b) => eyeCore(b)
    const minArea = Math.max(6, 0.0008 * fArea), maxArea = 0.12 * fArea
    // eyes: dark blobs (lashes, pupil, outline) after a 1 px opening that cuts thin
    // shading lines; a flat dark blob above an eye is an eyebrow
    const darkOpen = dilate(erode(dark, w, h), w, h)
    const darkBlobs = components(darkOpen).filter((b) => b.area >= minArea && b.area <= maxArea)
    const upper = darkBlobs.filter((b) => b.cy < fy0 + 0.75 * fh)
    const aspect = (b) => (b.bx1 - b.bx0 + 1) / Math.max(1, b.by1 - b.by0 + 1)
    const isBrow = (b) => aspect(b) > 3.2 || upper.some((o) => o !== b && o.area > 0.8 * b.area && o.cy > b.cy && o.cy - b.cy < 0.3 * fh && Math.abs(o.cx - b.cx) < 0.25 * fw && aspect(b) > 1.8)
    let eyeCands = upper.filter((b) => !isBrow(b) && aspect(b) >= 0.45).sort((p, q) => q.area - p.area).slice(0, 8)
    // an eye shows an iris / white next to its dark outline; an eyebrow does not
    for (const b of eyeCands) b.inner = eyeCore(b).length
    if (eyeCands.filter((b) => b.inner >= 8).length >= 2) eyeCands = eyeCands.filter((b) => b.inner >= 8)
    if (opts && opts.debugFace) opts.debugFace({ fx0, fx1, fy0, fy1, cands: eyeCands.map((b) => ({ cx: Math.round(b.cx), cy: Math.round(b.cy), area: b.area, inner: b.inner, box: [b.bx0, b.by0, b.bx1, b.by1] })) })
    const faceCx = (fx0 + fx1) / 2
    const fm = opts && opts.featureMask
    const featFrac = (b) => { if (!fm || !b.px) return 0; let k = 0; for (const i of b.px) if (fm[i]) k++; return k / b.px.length }
    let pair = null, bestScore = 0
    for (let i = 0; i < eyeCands.length; i++) for (let j = i + 1; j < eyeCands.length; j++) {
      const A = eyeCands[i], B = eyeCands[j]
      const ddx = Math.abs(A.cx - B.cx), ddy = Math.abs(A.cy - B.cy)
      if (ddx < 0.2 * fw || ddx > 0.8 * fw || ddy > 0.28 * fh) continue
      const ratio = Math.min(A.area, B.area) / Math.max(A.area, B.area)
      // eyes drawn on their own layers: a half-hidden far eye may be a sliver of the near one
      const fA = featFrac(A), fB = featFrac(B), onFeatures = fA > 0.5 && fB > 0.5
      if (ratio < (onFeatures ? 0.03 : 0.2)) continue
      // two eyes sit either side of the face's middle
      const sym = Math.max(0, 1 - Math.abs((A.cx + B.cx) / 2 - faceCx) / (0.35 * fw))
      const score = (fm ? Math.sqrt(A.area * B.area) * (0.2 + 0.8 * Math.min(fA, fB)) : Math.min(A.area, B.area) * (0.5 + ratio)) * (0.3 + sym)
      if (score > bestScore) { bestScore = score; pair = [A, B] }
    }
    const eyes = pair ? pair.slice().sort((p, q) => p.cx - q.cx) : (eyeCands.length ? [eyeCands[0]] : [])
    if (!eyes.length) return null
    // face axis: along the eye line, "up" toward the image top
    let dxA = 1, dyA = 0
    if (eyes.length === 2) { dxA = eyes[1].cx - eyes[0].cx; dyA = eyes[1].cy - eyes[0].cy; const L = Math.hypot(dxA, dyA) || 1; dxA /= L; dyA /= L }
    let upx = dyA, upy = -dxA
    if (upy > 0) { upx = -upx; upy = -upy }
    // the whole eye (iris, white, lids) = feature pixels connected to the dark blob within
    // a box around it, so the lids come out where the eye really ends
    const extentOf = (px, cx, cy, vx, vy) => { let mx = -Infinity, mn = Infinity; for (const i of px) { const x = i % w, y = (i / w) | 0; const d = (x - cx) * vx + (y - cy) * vy; if (d > mx) mx = d; if (d < mn) mn = d } return [mn, mx] }
    const eyeOut = eyes.map((b) => {
      const core = eyeCore(b)
      if (core.length >= 8) {
        // the eye = the core (iris, white); the lids = the dark lash line just above it and
        // the dark rim just below, read only in the core's own columns (a brow is further up)
        let sx = 0, sy = 0; for (const i of core) { sx += i % w; sy += (i / w) | 0 }
        const cx = sx / core.length, cy = sy / core.length
        const [mnI, mxI] = extentOf(core, cx, cy, upx, upy)
        const [mnA, mxA] = extentOf(core, cx, cy, dxA, dyA)
        const coreH = Math.max(3, mxI - mnI)
        // the lash line is the dark band that starts right at the iris: walk outward row
        // by row along the eye axis and stop at the first gap (the skin between lashes and
        // eyebrow), so a brow drawn close above the eye is not taken for the upper lid
        const darkFrac = (along) => {
          let cnt = 0, dark_ = 0
          for (let across = mnA; across <= mxA; across += 1) {
            const x = Math.round(cx + dxA * across + upx * along), y = Math.round(cy + dyA * across + upy * along)
            if (x < 0 || y < 0 || x >= w || y >= h) continue
            const i = y * w + x
            if (!alpha[i]) continue
            cnt++; if (dark[i]) dark_++
          }
          return cnt ? dark_ / cnt : 0
        }
        let top = mxI, bottom = mnI, gap = 0
        for (let d = 1; d <= 0.6 * coreH + 2; d++) { if (darkFrac(mxI + d) >= 0.25) { top = mxI + d; gap = 0 } else if (++gap >= 2) break }
        gap = 0
        for (let d = 1; d <= 0.6 * coreH + 2; d++) { if (darkFrac(mnI - d) >= 0.25) { bottom = mnI - d; gap = 0 } else if (++gap >= 2) break }
        let cbx0 = w, cbx1 = -1, cby0 = h, cby1 = -1
        for (const i of core) { const x = i % w, y = (i / w) | 0; if (x < cbx0) cbx0 = x; if (x > cbx1) cbx1 = x; if (y < cby0) cby0 = y; if (y > cby1) cby1 = y }
        return { center: [cx, cy], top: [cx + upx * top, cy + upy * top], bottom: [cx + upx * bottom, cy + upy * bottom], area: core.length, blob: [b.cx, b.cy, b.bx0, b.by0, b.bx1, b.by1], box: eyeBox(b), coreBox: [cbx0, cby0, cbx1, cby1] }
      }
      const [mn, mx] = extentOf(b.px, b.cx, b.cy, upx, upy)
      return { center: [b.cx, b.cy], top: [b.cx + upx * mx, b.cy + upy * mx], bottom: [b.cx + upx * mn, b.cy + upy * mn], area: b.area }
    })
    // the eye line for the face axis runs through the cores, not the lash blobs
    if (eyeOut.length === 2) { dxA = eyeOut[1].center[0] - eyeOut[0].center[0]; dyA = eyeOut[1].center[1] - eyeOut[0].center[1]; const L = Math.hypot(dxA, dyA) || 1; dxA /= L; dyA /= L; upx = dyA; upy = -dxA; if (upy > 0) { upx = -upx; upy = -upy } }
    const midX = eyeOut.reduce((a, e) => a + e.center[0], 0) / eyeOut.length, midY = eyeOut.reduce((a, e) => a + e.center[1], 0) / eyeOut.length
    // mouth: a dark or red blob below the eyes along the axis, near the middle; the
    // biggest and reddest wins
    const mouthMask = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (alpha[i] && (dark[i] || red[i] > skinRed + 30)) mouthMask[i] = 1
    const mouthBlobs = components(mouthMask).filter((b) => b.area >= minArea && b.area <= maxArea)
    let mouth = null, mScore = 0
    for (const b of mouthBlobs) {
      const rx = b.cx - midX, ry = b.cy - midY
      const along = rx * upx + ry * upy, across = rx * dxA + ry * dyA
      if (along > -0.16 * fh || along < -0.75 * fh) continue
      if (Math.abs(across) > (eyes.length === 2 ? 0.45 * Math.abs(eyes[1].cx - eyes[0].cx) + 0.1 * fw : 0.3 * fw)) continue
      const score = b.area * (1 + 4 * b.red / 255 + b.dark / 255)
      if (score > mScore) { mScore = score; mouth = b }
    }
    let mouthOut = null
    if (mouth) {
      const [mnU, mxU] = extentOf(mouth.px, mouth.cx, mouth.cy, upx, upy), [mnA, mxA] = extentOf(mouth.px, mouth.cx, mouth.cy, dxA, dyA)
      mouthOut = { center: [mouth.cx, mouth.cy], up: [mouth.cx + upx * mxU, mouth.cy + upy * mxU], down: [mouth.cx + upx * mnU, mouth.cy + upy * mnU], l: [mouth.cx + dxA * mnA, mouth.cy + dyA * mnA], r: [mouth.cx + dxA * mxA, mouth.cy + dyA * mxA], area: mouth.area }
    }
    const nose = mouthOut ? [midX + (mouthOut.center[0] - midX) * 0.6, midY + (mouthOut.center[1] - midY) * 0.6] : [midX - upx * 0.25 * fh, midY - upy * 0.25 * fh]
    return {
      eyes: eyeOut, mouth: mouthOut, nose, up: [upx, upy], skin: [skinCr, skinCg, skinL], faceBox: [fx0, fy0, fx1, fy1], blobs: darkBlobs.length,
      debug: { dark: darkBlobs.map((b) => ({ cx: +b.cx.toFixed(0), cy: +b.cy.toFixed(0), area: b.area, aspect: +aspect(b).toFixed(2), brow: isBrow(b), upper: b.cy < fy0 + 0.66 * fh, enclosure: +(b.enclosure === undefined ? -1 : b.enclosure).toFixed(2) })) },
      summary: { eyes: eyeOut.map((e) => e.center.map((v) => +v.toFixed(1))), mouth: mouthOut ? mouthOut.center.map((v) => +v.toFixed(1)) : null, blobs: darkBlobs.length, faceBox: [fx0, fy0, fx1, fy1] }
    }
  }

  // ------------------------------------------------------- world assembly ---

  function worldOf(layer, px, py) {
    const p = layer.place
    return [p.x + px - layer.width / 2, p.y + layer.height / 2 - py]
  }
  /**
   * The face as the eye sees it: the head layer with the small layers lying inside it
   * (eyes, brows, lashes, mouth drawn as their own layers) composited on in draw order,
   * in the head layer pixel frame. Hair, body and anything reaching outside the head are
   * left out, so bangs do not cover the eyes. Layers are axis-aligned at 1:1 (flat export).
   */
  function faceComposite(head, layers) {
    const W = head.width, Hh = head.height
    const hb = head.analysis.bbox
    const [hx0, hy1] = worldOf(head, hb[0], hb[1]), [hx1, hy0] = worldOf(head, hb[2], hb[3])
    const parts = layers.filter((l) => {
      if (l === head) return true
      if (!l.rgba || !l.analysis || l.analysis.area > 0.15 * head.analysis.area) return false
      const b = l.analysis.bbox
      const [x0, y1] = worldOf(l, b[0], b[1]), [x1, y0] = worldOf(l, b[2], b[3])
      return x0 >= hx0 - 2 && x1 <= hx1 + 2 && y0 >= hy0 - 2 && y1 <= hy1 + 2
    }).sort((a, b) => a.drawIndex - b.drawIndex)
    if (parts.length === 1) return { rgba: head.rgba, w: W, h: Hh, parts: [head.name] }
    const out = new Float32Array(W * Hh * 4)
    const feat = new Uint8Array(W * Hh)
    for (const l of parts) {
      const ox = l.place.x - l.width / 2 - (head.place.x - W / 2), oy = (head.place.y + Hh / 2) - (l.place.y + l.height / 2)
      for (let y = 0; y < Hh; y++) {
        const ly = Math.round(y - oy); if (ly < 0 || ly >= l.height) continue
        for (let x = 0; x < W; x++) {
          const lx = Math.round(x - ox); if (lx < 0 || lx >= l.width) continue
          const si = 4 * (ly * l.width + lx), a = l.rgba[si + 3] / 255; if (a <= 0) continue
          const di = 4 * (y * W + x)
          for (let c = 0; c < 3; c++) out[di + c] = l.rgba[si + c] * a + out[di + c] * (1 - a)
          out[di + 3] = a + out[di + 3] * (1 - a)
          if (l !== head) { if (a > 0.5) feat[y * W + x] = 1 } else if (a > 0.5) feat[y * W + x] = 0
        }
      }
    }
    const rgba = new Uint8ClampedArray(W * Hh * 4)
    for (let i = 0; i < W * Hh; i++) { const a = out[4 * i + 3]; rgba[4 * i + 3] = Math.round(255 * a); if (a > 0) for (let c = 0; c < 3; c++) rgba[4 * i + c] = Math.round(out[4 * i + c] / a) }
    return { rgba, w: W, h: Hh, parts: parts.map((l) => l.name), feat }
  }
  /** EDT of the layer silhouette at a world point, 0 outside. */
  function depthAt(layer, wx, wy) {
    const a = layer.analysis
    const px = wx - layer.place.x + layer.width / 2, py = layer.place.y + layer.height / 2 - wy
    const x = Math.floor(px * a.scale) + 1, y = Math.floor(py * a.scale) + 1
    if (x < 0 || y < 0 || x >= a.ws || y >= a.hs) return 0
    return a.mask[y * a.ws + x] ? a.dist[y * a.ws + x] / a.scale : 0
  }
  /** Highest silhouette point (world y) of a layer within a world x range, or null. */
  function topWithin(layer, wx0, wx1) {
    const a = layer.analysis
    const s = a.scale
    let best = null
    for (let y = 0; y < a.hs; y++) {
      for (let x = 0; x < a.ws; x++) {
        if (!a.mask[y * a.ws + x]) continue
        const [wx, wy] = worldOf(layer, (x - 1 + 0.5) / s, (y - 1 + 0.5) / s)
        if (wx < wx0 || wx > wx1) continue
        if (best === null || wy > best) best = wy
      }
      if (best !== null) break   // rows go top → down, the first hit row is the top
    }
    return best
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
  }
  function polyLen(p) { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L }
  /** Arc-length fraction of the closest point of a polyline to (x, y). */
  function projectTOn(pl, x, y) {
    const L = polyLen(pl)
    let acc = 0, bestT = 0, bd = Infinity
    for (let i = 2; i < pl.length; i += 2) {
      const ax = pl[i - 2], ay = pl[i - 1], bx = pl[i], by = pl[i + 1]
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
      let u = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0
      u = Math.max(0, Math.min(1, u))
      const d = Math.hypot(x - (ax + u * dx), y - (ay + u * dy))
      if (d < bd) { bd = d; bestT = (acc + u * Math.sqrt(l2)) / Math.max(1e-9, L) }
      acc += Math.sqrt(l2)
    }
    return bestT
  }

  /**
   * The widest, longest path of a graph (max ∫ (r + 1) ds between two nodes): the
   * layer's trunk. With `from` given, the path starts there.
   */
  function trunkPath(graph, from) {
    const { nodes, edges } = graph
    if (!edges.length) return null
    const weight = (e) => e.len * (e.rMean + 1)
    const far = (start) => {
      const best = { node: start, w: 0, path: [] }
      const stack = [{ n: start, w: 0, path: [], seen: new Set([start]) }]
      let guard = 0
      while (stack.length && guard++ < 200000) {
        const cur = stack.pop()
        if (cur.w > best.w) { best.node = cur.n; best.w = cur.w; best.path = cur.path }
        for (const ei of nodes[cur.n].edges) {
          const e = edges[ei]
          const nx = e.a === cur.n ? e.b : e.a
          if (cur.seen.has(nx)) continue
          const seen = new Set(cur.seen); seen.add(nx)
          stack.push({ n: nx, w: cur.w + weight(e), path: cur.path.concat([ei]), seen })
        }
      }
      return best
    }
    if (from !== undefined && from !== null) { const f = far(from); return { start: from, end: f.node, edges: f.path } }
    let bestAll = null
    const leaves = nodes.map((n, i) => (n.deg === 1 ? i : -1)).filter((i) => i >= 0)
    const starts = leaves.length ? leaves : nodes.map((n, i) => i).filter((i) => nodes[i].deg > 0)
    for (const s of starts) { const f = far(s); if (!bestAll || f.w > bestAll.w) bestAll = Object.assign({ start: s }, f) }
    return bestAll ? { start: bestAll.start, end: bestAll.node, edges: bestAll.path } : null
  }
  /** Concatenate a node-to-node edge path into one oriented world polyline with radii. */
  function pathPolyline(layer, graph, start, edgeList) {
    let cur = start
    const poly = [], radii = []
    for (const ei of edgeList) {
      const e = graph.edges[ei]
      const fwd = e.a === cur
      const p = fwd ? e.poly : reversePts(e.poly)
      const r = fwd ? e.radii : e.radii.slice().reverse()
      for (let i = 0; i < p.length; i += 2) {
        if (poly.length && i === 0) continue
        const [wx, wy] = worldOf(layer, p[i], p[i + 1])
        poly.push(wx, wy); radii.push(r[i / 2])
      }
      cur = fwd ? e.b : e.a
    }
    if (!poly.length) { const [wx, wy] = worldOf(layer, graph.nodes[start].x, graph.nodes[start].y); poly.push(wx, wy); radii.push(graph.nodes[start].r) }
    return { poly, radii, end: cur }
  }
  /** Point at arc-length fraction t along a polyline. */
  function pointAt(poly, t) {
    const L = polyLen(poly)
    const target = Math.max(0, Math.min(1, t)) * L
    let acc = 0
    for (let i = 2; i < poly.length; i += 2) {
      const d = Math.hypot(poly[i] - poly[i - 2], poly[i + 1] - poly[i - 1])
      if (acc + d >= target - 1e-9 || i === poly.length - 2) {
        const u = d > 0 ? Math.max(0, Math.min(1, (target - acc) / d)) : 0
        return [poly[i - 2] + u * (poly[i] - poly[i - 2]), poly[i - 1] + u * (poly[i + 1] - poly[i - 1])]
      }
      acc += d
    }
    return [poly[0], poly[1]]
  }
  /** Sub-polyline between arc-length fractions [t0, t1]. */
  function slicePoly(poly, t0, t1) {
    const L = polyLen(poly)
    const a = t0 * L, b = t1 * L
    const out = []
    const p0 = pointAt(poly, t0); out.push(p0[0], p0[1])
    let acc = 0
    for (let i = 2; i < poly.length; i += 2) {
      const d = Math.hypot(poly[i] - poly[i - 2], poly[i + 1] - poly[i - 1])
      const s = acc + d
      if (s > a + 1e-9 && s < b - 1e-9) out.push(poly[i], poly[i + 1])
      acc = s
    }
    const p1 = pointAt(poly, t1); out.push(p1[0], p1[1])
    return out
  }
  /** Radius (EDT) at arc-length fraction t (linear between the polyline's samples). */
  function radiusAt(poly, radii, t) {
    const L = polyLen(poly)
    const target = Math.max(0, Math.min(1, t)) * L
    let acc = 0
    for (let i = 2; i < poly.length; i += 2) {
      const d = Math.hypot(poly[i] - poly[i - 2], poly[i + 1] - poly[i - 1])
      if (acc + d >= target - 1e-9 || i === poly.length - 2) {
        const u = d > 0 ? Math.max(0, Math.min(1, (target - acc) / d)) : 0
        return radii[i / 2 - 1] + u * (radii[i / 2] - radii[i / 2 - 1])
      }
      acc += d
    }
    return radii[0] || 0
  }

  /**
   * Cut a polyline into bones. Strands: uniform bones of ≈ strandBone × local width.
   * Limbs: the polyline is re-simplified with a coarse tolerance so only real bends
   * (elbow, knee, ankle) survive as corners, and each straight run becomes 1–2 bones
   * of ≈ limbBone × the run's width (a straight thigh+shin run splits at the knee).
   */
  function cutPolyline(poly, radii, role, o) {
    const C = core()
    const mean = radii.reduce((a, b) => a + b, 0) / Math.max(1, radii.length)
    let kept, keptR
    if (role === 'limb' || role === 'extremity' || role === 'segment') {
      const rMax = radii.reduce((a, b) => Math.max(a, b), 0)
      const eps = Math.max(10, 0.6 * rMax)
      let s = Array.from(C.dpSimplify(Float64Array.from(poly), eps))
      if (role === 'segment' && poly.length >= 6) {
        // the ankle / wrist: the sharpest turn in the last third of the run, at least
        // half a bone from the end, is a joint even when the tolerance dropped it
        const total = polyLen(poly)
        let acc = 0, best = -1, bestAng = 0.21   // ≥ 12°
        for (let i = 2; i < poly.length - 2; i += 2) {
          acc += Math.hypot(poly[i] - poly[i - 2], poly[i + 1] - poly[i - 1])
          if (acc < 0.65 * total) continue
          if (total - acc < 0.5 * o.boneMin) break
          const ax = poly[i] - poly[i - 2], ay = poly[i + 1] - poly[i - 1], bx = poly[i + 2] - poly[i], by = poly[i + 3] - poly[i + 1]
          const ang = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by))
          if (ang > bestAng) { bestAng = ang; best = i }
        }
        if (best >= 0 && !s.some((v, k) => k % 2 === 0 && Math.hypot(s[k] - poly[best], s[k + 1] - poly[best + 1]) < 1)) {
          // insert in order along the run
          let pos = 0, target = polyLen(poly.slice(0, best + 2))
          for (let k = 2; k < s.length; k += 2) { const dk = polyLen(poly.slice(0, 2 * nearestIdx(poly, s[k], s[k + 1]) + 2)); if (dk < target) pos = k; else break }
          s = s.slice(0, pos + 2).concat([poly[best], poly[best + 1]], s.slice(pos + 2))
        }
      }
      kept = s
      keptR = []
      for (let i = 0; i < s.length; i += 2) {
        // radius at the kept point: nearest original sample
        let bi = 0, bd = Infinity
        for (let j = 0; j < poly.length; j += 2) { const d = Math.hypot(poly[j] - s[i], poly[j + 1] - s[i + 1]); if (d < bd) { bd = d; bi = j / 2 } }
        keptR.push(radii[bi])
      }
    } else if (o.strandLen) {
      // a strand with a bone-length target: corners finer than a quarter of it are noise
      const eps = Math.max(2, 0.25 * o.strandLen)
      const sp = Array.from(C.dpSimplify(Float64Array.from(poly), eps))
      kept = sp
      keptR = []
      for (let i = 0; i < sp.length; i += 2) {
        let bi = 0, bd = Infinity
        for (let j = 0; j < poly.length; j += 2) { const d = Math.hypot(poly[j] - sp[i], poly[j + 1] - sp[i + 1]); if (d < bd) { bd = d; bi = j / 2 } }
        keptR.push(radii[bi])
      }
    } else {
      kept = poly.slice(); keptR = radii.slice()
    }
    // absorb corners closer than 0.6 × boneMin (half the strand length for a strand with
    // a target) to the previous kept corner
    const absorb = o.strandLen && !(role === 'limb' || role === 'extremity' || role === 'segment') ? 0.5 * o.strandLen : o.boneMin * 0.6
    const pts = [kept[0], kept[1]], pr = [keptR[0]]
    for (let i = 2; i < kept.length; i += 2) {
      const last = pts.length - 2
      const d = Math.hypot(kept[i] - pts[last], kept[i + 1] - pts[last + 1])
      const isLast = i === kept.length - 2
      if (d < absorb) {
        if (isLast && pts.length > 2) { pts[last] = kept[i]; pts[last + 1] = kept[i + 1] }
        else if (isLast) { pts.push(kept[i], kept[i + 1]); pr.push(keptR[i / 2]) }
        continue
      }
      pts.push(kept[i], kept[i + 1]); pr.push(keptR[i / 2])
    }
    const out = []
    for (let i = 0; i < pts.length - 2; i += 2) {
      const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3]
      const d = Math.hypot(bx - ax, by - ay)
      let n
      if (role === 'segment') {
        // a limb layer's straight run is one segment (a thigh, a shin): a straight layer
        // that has no continuation is bent at its middle afterwards
        n = 1
      } else if (role === 'limb' || role === 'extremity') {
        // width of the run: the larger end radius (the thigh, not the ankle)
        const width = 2 * Math.max(1, Math.max(pr[i / 2] || 0, pr[i / 2 + 1] || 0, 0.7 * mean))
        const target = (role === 'limb' ? o.limbBone : o.extremityBone) * width
        n = Math.max(1, Math.min(role === 'limb' ? 2 : 3, Math.round(d / Math.max(o.boneMin, target))))
      } else {
        const width = 2 * Math.max(1, mean)
        const maxLen = o.strandLen || Math.max(o.boneMin, Math.min(o.boneMax, o.strandBone * width))
        n = Math.max(1, Math.round(d / maxLen))
      }
      for (let k = 0; k < n; k++) out.push(ax + (bx - ax) * k / n, ay + (by - ay) * k / n)
    }
    out.push(pts[pts.length - 2], pts[pts.length - 1])
    return out
  }

  // bone record: { name, parent(index), ax, ay, bx, by, len, layer, role, kind }
  class Skeleton {
    constructor() { this.bones = []; this.index = new Map(); this.ik = []; this.tc = []; this.seq = 0 }
    addIk(c) { c.seq = this.seq++; this.ik.push(c); return c }
    addTc(c) { c.seq = this.seq++; this.tc.push(c); return c }
    add(name, parent, ax, ay, bx, by, meta) {
      let nm = name, k = 2
      while (this.index.has(nm)) nm = `${name}_${k++}`
      const b = Object.assign({ name: nm, parent, ax, ay, bx, by, len: Math.hypot(bx - ax, by - ay) }, meta || {})
      this.index.set(nm, this.bones.length)
      this.bones.push(b)
      return this.bones.length - 1
    }
    nearest(px, py, filter) {
      let best = -1, bd = Infinity
      for (let i = 0; i < this.bones.length; i++) {
        const b = this.bones[i]
        if (filter && !filter(b, i)) continue
        const d = segDist(px, py, b.ax, b.ay, b.bx, b.by)
        if (d < bd) { bd = d; best = i }
      }
      return { index: best, dist: bd }
    }
  }

  /** Index (vertex) of the polyline point nearest (x, y). */
  function nearestIdx(poly, x, y) { let bi = 0, bd = Infinity; for (let j = 0; j < poly.length; j += 2) { const d = Math.hypot(poly[j] - x, poly[j + 1] - y); if (d < bd) { bd = d; bi = j / 2 } } return bi }

  function chainAlong(sk, pts, parent, namer, meta) {
    let p = parent
    const ids = []
    for (let i = 0; i < pts.length - 2; i += 2) {
      if (Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]) < 1e-6) continue
      const id = sk.add(namer(), p, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], meta)
      ids.push(id); p = id
    }
    return ids
  }

  /** Every branch from `node` (except `fromEdge`) becomes a chain hanging off `parentBone`. */
  function growBranches(sk, layer, graph, node, fromEdge, parentBone, role, namer, meta, o, depth, seenEdges, dist) {
    dist = dist || 0
    const nd = graph.nodes[node]
    if (o.stubMin) {
      // a stub at a junction shorter than half a bone (a skeleton artefact where the strand
      // widens, the tip of a knot) is not a branch
      const cand = nd.edges.filter((ei) => ei !== fromEdge && !seenEdges.has(ei))
      if (cand.length > 1) for (const ei of cand) { if (subtreeInfo(graph, layer, node, ei, seenEdges).maxLen < o.stubMin) seenEdges.add(ei) }
    }
    if (o.branchKeep) {
      // a strand keeps its main run; side wisps shorter than branchKeep × the longest
      // continuation at this fork are part of the same lock and get no chain
      const cand = nd.edges.filter((ei) => ei !== fromEdge && !seenEdges.has(ei))
      if (cand.length > 1) {
        const info = cand.map((ei) => subtreeInfo(graph, layer, node, ei, seenEdges))
        let main = 0
        info.forEach((f, i) => { if (f.maxLen > info[main].maxLen) main = i })
        cand.forEach((ei, i) => { if (i !== main && info[i].maxLen < o.branchKeep * info[main].maxLen && info[i].rMean < 0.6 * info[main].rMean) seenEdges.add(ei) })
      }
    }
    for (const ei of nd.edges) {
      if (ei === fromEdge || seenEdges.has(ei)) continue
      seenEdges.add(ei)
      const e = graph.edges[ei]
      const fwd = e.a === node
      const p = fwd ? e.poly : reversePts(e.poly)
      const r = fwd ? e.radii : e.radii.slice().reverse()
      const poly = []
      for (let i = 0; i < p.length; i += 2) { const [wx, wy] = worldOf(layer, p[i], p[i + 1]); poly.push(wx, wy) }
      const far = fwd ? e.b : e.a
      if (polyLen(poly) < o.boneMin * 0.5) {
        if (graph.nodes[far].deg > 1 && depth < 12) growBranches(sk, layer, graph, far, ei, parentBone, role, namer, meta, o, depth + 1, seenEdges, dist + polyLen(poly))
        continue
      }
      // the bone length follows the whole chain this run belongs to (root → far tip)
      const beyond = graph.nodes[far].deg > 1 ? Math.max(0, ...graph.nodes[far].edges.filter((x) => x !== ei && !seenEdges.has(x)).map((x) => subtreeInfo(graph, layer, far, x, seenEdges).maxLen)) : 0
      const oE = o.strandLenOf ? Object.assign({}, o, { strandLen: o.strandLenOf(dist + polyLen(poly) + beyond, r.reduce((a, b) => a + b, 0) / Math.max(1, r.length)) }) : o
      {
        const pb = sk.bones[parentBone]
        if (pb && pb.kind === 'bone' && pb.layer === layer.name) { const g0 = Math.hypot(poly[0] - pb.bx, poly[1] - pb.by); if (g0 > 0.5 && g0 <= 40) { poly[0] = pb.bx; poly[1] = pb.by } }
      }
      const pts = cutPolyline(poly, r, role, oE)
      const ids = chainAlong(sk, pts, parentBone, namer, meta)
      const last = ids.length ? ids[ids.length - 1] : parentBone
      if (o.debug === layer.name) console.log(`[auto-bones] ${layer.name} grow node ${node} edge ${ei} → far ${far} (deg ${graph.nodes[far].deg}) polyLen ${polyLen(poly).toFixed(0)} parent ${sk.bones[parentBone].name} made ${ids.map((i) => sk.bones[i].name).join(',')}`)
      if (depth < 12) growBranches(sk, layer, graph, far, ei, last, role, namer, meta, o, depth + 1, seenEdges, dist + polyLen(poly))
    }
  }

  /**
   * The subtree of a layer graph that hangs off `node` through `edgeIdx`, never crossing
   * `blocked` edges: its reach (longest path from the node), its vertical extent and the
   * radius of its first edge. Used to judge what a fork on the trunk leads to.
   */
  function subtreeInfo(g, layer, node, edgeIdx, blocked) {
    const visited = new Set([edgeIdx])
    const e0 = g.edges[edgeIdx]
    let maxLen = 0, minY = Infinity, maxY = -Infinity, rSum = 0, lenSum = 0, tipSum = 0, tips = 0
    const stack = [{ n: e0.a === node ? e0.b : e0.a, len: e0.len, e: e0 }]
    rSum += e0.rMean * e0.len; lenSum += e0.len
    while (stack.length) {
      const { n, len, e: eIn } = stack.pop()
      if (len > maxLen) maxLen = len
      const [, wy] = worldOf(layer, g.nodes[n].x, g.nodes[n].y)
      if (wy < minY) minY = wy
      if (wy > maxY) maxY = wy
      let out = 0
      for (const ei of g.nodes[n].edges) {
        if (visited.has(ei) || blocked.has(ei)) continue
        visited.add(ei); out++
        const e = g.edges[ei]
        rSum += e.rMean * e.len; lenSum += e.len
        stack.push({ n: e.a === n ? e.b : e.a, len: len + e.len, e })
      }
      if (!out) { tipSum += eIn.rMin; tips++ }   // a leaf: how thin the branch ends
    }
    const rEnd = tips ? tipSum / tips : e0.rMin
    return { maxLen, minY, maxY, rFirst: e0.rMean, rMean: rSum / Math.max(1e-9, lenSum), rEnd, taper: rEnd / Math.max(1e-9, e0.rMean), edges: visited }
  }

  /** Centroids (world) of a layer's silhouette pieces that are at least a tenth of the largest. */
  function maskPieces(layer) {
    const a = layer.analysis
    const { ws: w, hs: h, scale: s } = a
    // a thin strap between two flowers must not glue them into one piece: erode a little
    let mask = a.mask
    const iters = Math.max(1, Math.round(0.35 * (layer.rMean || 4) * s))
    for (let k = 0; k < iters; k++) { const e = erode(mask, w, h); let n = 0; for (let i = 0; i < w * h; i++) n += e[i]; if (n < 20) break; mask = e }
    const lab = new Int32Array(w * h).fill(-1)
    const comps = []
    for (let i0 = 0; i0 < w * h; i0++) {
      if (lab[i0] >= 0 || !mask[i0]) continue
      const q = [i0]; lab[i0] = comps.length
      let n = 0, sx = 0, sy = 0
      for (let k = 0; k < q.length; k++) {
        const i = q[k]; n++; sx += i % w; sy += (i / w) | 0
        const x = i % w, y = (i / w) | 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const j = yy * w + xx
          if (lab[j] < 0 && mask[j]) { lab[j] = lab[i0]; q.push(j) }
        }
      }
      comps.push({ n, cx: sx / n, cy: sy / n })
    }
    const big = Math.max(...comps.map((c) => c.n))
    return comps.filter((c) => c.n >= 0.1 * big).map((c) => worldOf(layer, (c.cx - 1 + 0.5) / s, (c.cy - 1 + 0.5) / s))
  }

  /**
   * Split a layer graph's edge at the point nearest (wx, wy) (world px) when that point is
   * within maxDist: a new degree-2 node there, the edge becomes two. Returns {node, dist}
   * or null. Roots a limb where it meets the body when both axis ends are far from there
   * (a leg layer carrying the whole pelvis: its axis top is the pelvis blob's centre).
   */
  function splitGraphAt(layer, g, wx, wy, maxDist) {
    let best = null
    g.edges.forEach((e, ei) => {
      const p = e.poly
      for (let i = 2; i < p.length; i += 2) {
        const [ax, ay] = worldOf(layer, p[i - 2], p[i - 1]), [bx, by] = worldOf(layer, p[i], p[i + 1])
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
        let u = l2 > 0 ? ((wx - ax) * dx + (wy - ay) * dy) / l2 : 0
        u = Math.max(0, Math.min(1, u))
        const d = Math.hypot(wx - (ax + u * dx), wy - (ay + u * dy))
        if (d < (best ? best.dist : maxDist)) best = { ei, i: i / 2, u, dist: d }
      }
    })
    if (!best) return null
    const e = g.edges[best.ei], p = e.poly, r = e.radii
    const i = best.i, u = best.u
    const qx = p[2 * i - 2] + (p[2 * i] - p[2 * i - 2]) * u, qy = p[2 * i - 1] + (p[2 * i + 1] - p[2 * i - 1]) * u
    const qr = r[i - 1] + (r[i] - r[i - 1]) * u
    const polyA = p.slice(0, 2 * i).concat([qx, qy]), polyB = [qx, qy].concat(p.slice(2 * i))
    if (polyLen(polyA) < 3 || polyLen(polyB) < 3) return null   // at an end already
    const radA = r.slice(0, i).concat([qr]), radB = [qr].concat(r.slice(i))
    const node = g.nodes.length
    const newEdge = g.edges.length
    g.nodes.push({ x: qx, y: qy, r: qr, rTip: qr, deg: 2, edges: [best.ei, newEdge], raw: null, ext: 0 })
    const stat = (rad, pts) => ({ rMean: rad.reduce((a, b) => a + b, 0) / rad.length, rMin: Math.min(...rad), len: polyLen(pts) })
    const eB = Object.assign({}, e, { a: node, b: e.b, poly: polyB, radii: radB }, stat(radB, polyB))
    Object.assign(e, { b: node, poly: polyA, radii: radA }, stat(radA, polyA))
    const nb = g.nodes[eB.b]
    nb.edges = nb.edges.map((k) => (k === best.ei ? newEdge : k))
    g.edges.push(eB)
    return { node, dist: best.dist }
  }

  /**
   * Bone length along a strand (hair, cloth, a tail) of length L: the studio uses about
   * 2 + L/100 bones per chain (a 150-px ribbon gets 3, a 900-px skirt panel 11), never
   * shorter than 1.5 widths or 25 px.
   */
  function strandBoneLen(L, rMean, part) {
    if (part === 'hair') {
      // hair: short locks get 20–25 px bones, a long fall 60–85 px (≈ √(10 L))
      return Math.max(20, Math.min(90, Math.max(1.5 * 2 * (rMean || 0), Math.sqrt(10 * Math.max(0, L)))))
    }
    const n = Math.max(2, Math.round(2 + L / 100))
    return Math.max(25, Math.max(2 * (rMean || 0), L / n))
  }

  /**
   * A loop in a strand's axis (a cord hanging as a ring, a ribbon knot): two edges
   * between the same nodes, or an edge from a node to itself. The studio rigs such a
   * loop as one chain down its middle: the parallel pair becomes the chord between the
   * nodes, a self-loop a chain from the node to the loop's far point.
   */
  function collapseLoops(g) {
    const straight = (e, ax, ay, bx, by) => { e.poly = [ax, ay, bx, by]; e.len = Math.hypot(bx - ax, by - ay); e.radii = [e.rMean, e.rMean]; e.rMin = e.rMean }
    const dropped = new Set()
    for (let i = 0; i < g.edges.length; i++) {
      const e = g.edges[i]
      if (dropped.has(i)) continue
      if (e.a === e.b) {
        // self-loop: chain to the far point of the loop
        const n = g.nodes[e.a]; let far = 0, fd = -1
        for (let k = 0; k < e.poly.length; k += 2) { const d = Math.hypot(e.poly[k] - n.x, e.poly[k + 1] - n.y); if (d > fd) { fd = d; far = k } }
        const node = g.nodes.length
        g.nodes.push({ x: e.poly[far], y: e.poly[far + 1], r: e.rMean, rTip: e.rMean, deg: 1, edges: [i], raw: null, ext: 0 })
        n.edges = n.edges.filter((k, idx) => !(k === i && idx > n.edges.indexOf(i)))
        e.b = node
        straight(e, n.x, n.y, e.poly[far], e.poly[far + 1])
        continue
      }
      for (let j = i + 1; j < g.edges.length; j++) {
        const f = g.edges[j]
        if (dropped.has(j) || !((f.a === e.a && f.b === e.b) || (f.a === e.b && f.b === e.a))) continue
        dropped.add(j)
        const A = g.nodes[e.a], B = g.nodes[e.b]
        straight(e, A.x, A.y, B.x, B.y)
        e.rMean = (e.rMean + f.rMean) / 2
      }
    }
    if (dropped.size) {
      const remap = new Map(); const edges = []
      g.edges.forEach((e, i) => { if (!dropped.has(i)) { remap.set(i, edges.length); edges.push(e) } })
      g.edges = edges
      for (const n of g.nodes) { n.edges = n.edges.filter((k) => remap.has(k)).map((k) => remap.get(k)); n.deg = n.edges.length }
    }
  }

  /**
   * Chains along the DRAWN strands of a hair layer. The alpha silhouette merges a fringe
   * or a fall of hair into one blob whose medial axis is a single line, while the studio
   * fans several chains across it along the painted locks. The lock direction is in the
   * pixels: the structure tensor of the luminance gives the stroke orientation; evenly
   * spaced streamlines (Jobard–Lefer) traced along it, with the spacing tied to the local
   * width of the hair (one line down a thin lock, three across a broad fall), are the
   * chains. Returns [{ poly (layer px), radii }] or null when the texture does not carry
   * the layer (coverage of the visible mask under 40%).
   */
  function hairFlowLines(l, o, ctx) {
    ctx = ctx || {}
    const rgba = l.rgba, w = l.width, h = l.height
    if (!rgba || !l.analysis) return null
    const a = l.analysis
    const sF = Math.min(1, (o.workMax || 700) / Math.max(w, h))
    const fw = Math.max(2, Math.round(w * sF)), fh = Math.max(2, Math.round(h * sF)), n = fw * fh
    const thr = o.alphaThreshold || 40
    // visible cells: the analysis mask (with the hidden / scalp parts cut out) at the work scale
    const vis = new Uint8Array(n)
    const lum = new Float32Array(n)
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const px = Math.min(w - 1, Math.floor((x + 0.5) / sF)), py = Math.min(h - 1, Math.floor((y + 0.5) / sF))
      const i = py * w + px
      if (rgba[4 * i + 3] < thr) continue
      const mx = Math.min(a.ws - 1, Math.max(0, Math.round(px * a.scale) + 1)), my = Math.min(a.hs - 1, Math.max(0, Math.round(py * a.scale) + 1))
      if (!a.mask[my * a.ws + mx]) continue
      vis[y * fw + x] = 1
      lum[y * fw + x] = 0.3 * rgba[4 * i] + 0.59 * rgba[4 * i + 1] + 0.11 * rgba[4 * i + 2]
    }
    const gauss = (src, sigma) => {
      const r = Math.ceil(3 * sigma); const k = []; let sum = 0
      for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * sigma * sigma)); k.push(v); sum += v }
      for (let i = 0; i < k.length; i++) k[i] /= sum
      const tmp = new Float32Array(n), out = new Float32Array(n)
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) { let sv = 0; for (let i = -r; i <= r; i++) { const xx = Math.min(fw - 1, Math.max(0, x + i)); sv += src[y * fw + xx] * k[i + r] } tmp[y * fw + x] = sv }
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) { let sv = 0; for (let i = -r; i <= r; i++) { const yy = Math.min(fh - 1, Math.max(0, y + i)); sv += tmp[yy * fw + x] * k[i + r] } out[y * fw + x] = sv }
      return out
    }
    // local hair width from the analysis EDT (work scale) → flow scale
    const radAt = (x, y) => { const mx = Math.min(a.ws - 1, Math.max(0, Math.round(x / sF * a.scale) + 1)), my = Math.min(a.hs - 1, Math.max(0, Math.round(y / sF * a.scale) + 1)); return (a.dist[my * a.ws + mx] || 0) / a.scale * sF }
    const L = gauss(lum, 1.2)
    const gx = new Float32Array(n), gy = new Float32Array(n)
    // no gradient within 3 px of the mask edge: the alpha boundary would otherwise be the
    // strongest "stroke" and the lines would run along the outline (the hairline, the
    // lock tips) instead of along the painted strands
    const edgeR = 3 * sF
    for (let y = 1; y < fh - 1; y++) for (let x = 1; x < fw - 1; x++) { const i = y * fw + x; if (!vis[i] || radAt(x, y) < edgeR) continue; gx[i] = (L[i + 1] - L[i - 1]) / 2; gy[i] = (L[i + fw] - L[i - fw]) / 2 }
    const sigma = 6 * sF
    const Jxx = gauss(Float32Array.from(gx, (v) => v * v), sigma), Jyy = gauss(Float32Array.from(gy, (v) => v * v), sigma), Jxy = gauss(Float32Array.from(gx, (v, i) => v * gy[i]), sigma)
    const dirX = new Float32Array(n), dirY = new Float32Array(n), coh = new Float32Array(n)
    for (let i = 0; i < n; i++) { const A = Jxx[i], B = Jyy[i], C = Jxy[i]; const th = 0.5 * Math.atan2(2 * C, A - B); dirX[i] = -Math.sin(th); dirY[i] = Math.cos(th); coh[i] = (A + B) > 1e-6 ? Math.sqrt((A - B) * (A - B) + 4 * C * C) / (A + B) : 0 }
    const at = (arr, x, y) => arr[Math.min(fh - 1, Math.max(0, Math.round(y))) * fw + Math.min(fw - 1, Math.max(0, Math.round(x)))]
    // spacing: front hair is animated lock by lock (20–40 px apart), hair behind the head
    // in a few broad sweeps (the template's hair_back: 3 chains over a 250-px fall, i.e.
    // 0.6–1.2 face widths apart); within that band the local width decides
    // (front locks: 0.25–0.5 face widths — a.json's fringe chains are 12–50 px apart on an
    // 89-px face, 锦瑟's four fa3 chains ~70 px apart on a 148-px face)
    const fwid = ctx.faceW || 100
    const sepMin = (ctx.behind ? 0.8 * fwid : (ctx.faceW ? 0.25 * fwid : 20)) * sF, sepMax = (ctx.behind ? 1.5 * fwid : (ctx.faceW ? 0.5 * fwid : 40)) * sF
    const sepAt = (x, y) => Math.max(sepMin, Math.min(sepMax, 0.8 * radAt(x, y)))
    const minLen = (ctx.behind ? 1.0 * (ctx.faceH || 100) : 40) * sF
    const STEP = 3 * sF
    // two masks (Jobard–Lefer): a line STOPS within half a spacing of another (occ), a new
    // line may only START a full spacing away (occSeed) — one mask for both let lines start
    // at half the spacing, i.e. one lock got two parallel chains
    const occ = new Uint8Array(n), occSeed = new Uint8Array(n)
    const stampInto = (arr, pts, f) => { for (const [x, y] of pts) { const rad = Math.round(f * sepAt(x, y)); for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { if (dx * dx + dy * dy > rad * rad) continue; const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx >= 0 && yy >= 0 && xx < fw && yy < fh) arr[yy * fw + xx] = 1 } } }
    const stamp = (pts) => { stampInto(occ, pts, 0.5); stampInto(occSeed, pts, 1.0) }
    const trace = (sx, sy, sign) => {
      let x = sx, y = sy, px = sign * at(dirX, sx, sy), py = sign * at(dirY, sx, sy)
      if (Math.hypot(px, py) < 1e-6) return []
      const pts = []; let turn = 0
      for (let k = 0; k < 600; k++) {
        let dx = at(dirX, x, y), dy = at(dirY, x, y)
        if (dx * px + dy * py < 0) { dx = -dx; dy = -dy }
        if (at(coh, x, y) < 0.03) { dx = px; dy = py }
        const ang = Math.abs(Math.atan2(px * dy - py * dx, px * dx + py * dy))
        if (ang > 0.6) break
        turn += ang; if (turn > 2.6) break
        x += dx * STEP; y += dy * STEP; px = dx; py = dy
        if (x < 0 || y < 0 || x >= fw || y >= fh || !at(vis, x, y)) break
        if (k > 3 && at(occ, x, y)) break
        pts.push([x, y])
      }
      return pts
    }
    const GRID = Math.max(3, Math.round(6 * sF))
    const cands = []
    for (let y = GRID / 2; y < fh; y += GRID) for (let x = GRID / 2; x < fw; x += GRID) if (at(vis, x, y) && at(coh, x, y) > 0.08) cands.push([x, y, at(coh, x, y)])
    cands.sort((p, q) => q[2] - p[2])
    const lines = []
    const toW = ctx.worldOf ? (p) => ctx.worldOf(p[0] / sF, p[1] / sF) : null
    const inCap = toW && ctx.cap ? (p) => { const w = toW(p); return ctx.cap(w[0], w[1]) } : null
    for (const [sx, sy] of cands) {
      if (at(occSeed, sx, sy)) continue
      const fwd = trace(sx, sy, 1), back = trace(sx, sy, -1)
      let pts = back.reverse().concat([[sx, sy]], fwd)
      if (pts.length * STEP < minLen) continue
      {
        // smooth the trace over half a spacing: the tensor field wobbles between adjacent
        // strands and their highlights; the template's chains are smooth
        const hw = Math.max(2, Math.round(0.5 * sepAt(sx, sy) / STEP))
        pts = pts.map((q, i) => { let ax = 0, ay = 0, nn = 0; for (let j = Math.max(0, i - hw); j <= Math.min(pts.length - 1, i + hw); j++) { ax += pts[j][0]; ay += pts[j][1]; nn++ } return [ax / nn, ay / nn] })
      }
      if (toW && ctx.crown) {
        // the root is the end nearer the crown: hair hangs from the scalp
        const w0 = toW(pts[0]), w1 = toW(pts[pts.length - 1])
        if (Math.hypot(w1[0] - ctx.crown[0], w1[1] - ctx.crown[1]) < Math.hypot(w0[0] - ctx.crown[0], w0[1] - ctx.crown[1])) pts.reverse()
      }
      if (inCap) {
        // the scalp is rigid: the chain starts where the lock leaves the cap (the template's
        // front locks root at the hairline, its back sweeps at the crown) and ends where the
        // lock would re-enter it; what lies inside the cap stays free for other seeds
        let s0 = 0; while (s0 < pts.length && inCap(pts[s0])) s0++
        if (s0 >= pts.length) continue
        if (s0 > 0) s0--
        let e0 = s0 + 1; while (e0 < pts.length && !inCap(pts[e0])) e0++
        pts = pts.slice(s0, e0)
        if (pts.length * STEP < minLen) continue
      }
      if (!ctx.behind && toW) {
        // a front lock hangs: the line is kept up to the last point that still descends
        // at least a quarter of the way travelled from the root; the level tail (strands
        // combed over the crown toward a bun, the hairline itself) is scalp, not a lock —
        // the template's chain A runs along the hairline only as far as it drops
        const w0 = toW(pts[0])
        let keep = -1
        for (let i = 1; i < pts.length; i++) { const w1 = toW(pts[i]); if (w0[1] - w1[1] >= 0.25 * i * STEP / sF) keep = i }
        if (keep < 0 || (keep + 1) * STEP < minLen) { stampInto(occSeed, pts, 1.0); continue }
        if (keep < pts.length - 1) { stampInto(occSeed, pts.slice(keep + 1), 1.0); pts = pts.slice(0, keep + 1) }
      }
      lines.push(pts); stamp(pts)
    }
    if (!lines.length) return null
    // does the texture carry the layer? visible cells (outside the cap) within reach of a line
    let visN = 0, covN = 0
    for (let i = 0; i < n; i++) { if (!vis[i]) continue; if (inCap && inCap([i % fw, Math.floor(i / fw)])) continue; visN++; if (occ[i]) covN++ }
    if (o.debug) console.log(`[autobones] hair flow ${l.name}: ${lines.length} lines, cover ${(visN ? covN / visN : 0).toFixed(2)}${ctx.behind ? ' (behind)' : ''}`)
    // (dark, flat hair without visible strokes — 锦瑟's black locks — yields few lines:
    // then the medial axis is the better guide)
    if (visN === 0 || covN / visN < (o.hairFlowCover === undefined ? 0.5 : o.hairFlowCover)) return null
    return lines.map((pts) => {
      const poly = [], radii = []
      for (let i = 0; i < pts.length; i += 2) { poly.push(pts[i][0] / sF, pts[i][1] / sF); radii.push(radAt(pts[i][0], pts[i][1]) / sF) }
      if (pts.length % 2 === 0) { const q = pts[pts.length - 1]; poly.push(q[0] / sF, q[1] / sF); radii.push(radAt(q[0], q[1]) / sF) }
      return { poly, radii }
    })
  }

  /** Connected components of a layer graph: { nodes: Set, edges: Set, len, rMean }. */
  function graphComponents(g) {
    const seenE = new Set(), out = []
    for (let e0 = 0; e0 < g.edges.length; e0++) {
      if (seenE.has(e0)) continue
      const nodes = new Set(), edges = new Set()
      const stack = [g.edges[e0].a]
      while (stack.length) {
        const n = stack.pop()
        if (nodes.has(n)) continue
        nodes.add(n)
        for (const ei of g.nodes[n].edges) { if (edges.has(ei)) continue; edges.add(ei); seenE.add(ei); const e = g.edges[ei]; stack.push(e.a === n ? e.b : e.a) }
      }
      let len = 0, rw = 0
      for (const ei of edges) { len += g.edges[ei].len; rw += g.edges[ei].rMean * g.edges[ei].len }
      out.push({ nodes, edges, len, rMean: len > 0 ? rw / len : 0 })
    }
    return out
  }

  /** World centroid of the shared silhouette of two layers, or null. */
  function overlapCentroid(A, B) {
    const a = A.analysis, b = B.analysis
    const s = a.scale
    const ax0 = A.place.x - A.width / 2, ay1 = A.place.y + A.height / 2
    const bx0 = B.place.x - B.width / 2, by1 = B.place.y + B.height / 2
    const dx = Math.round((ax0 - bx0) * s), dy = Math.round((by1 - ay1) * s)
    let n = 0, sx = 0, sy = 0
    for (let y = 0; y < a.hs; y++) {
      const by = y + dy
      if (by < 0 || by >= b.hs) continue
      for (let x = 0; x < a.ws; x++) {
        if (!a.mask[y * a.ws + x]) continue
        const bx = x + dx
        if (bx < 0 || bx >= b.ws) continue
        if (b.mask[by * b.ws + bx]) { n++; sx += x; sy += y }
      }
    }
    if (!n) return null
    return worldOf(A, (sx / n - 1 + 0.5) / s, (sy / n - 1 + 0.5) / s)
  }

  /** Shared silhouette area (px²) of two layers whose analyses use one working scale. */
  function overlapArea(A, B) {
    const a = A.analysis, b = B.analysis
    const s = a.scale
    const ax0 = A.place.x - A.width / 2, ay1 = A.place.y + A.height / 2
    const bx0 = B.place.x - B.width / 2, by1 = B.place.y + B.height / 2
    const dx = Math.round((ax0 - bx0) * s), dy = Math.round((by1 - ay1) * s)
    let n = 0
    for (let y = 0; y < a.hs; y++) {
      const by = y + dy
      if (by < 0 || by >= b.hs) continue
      for (let x = 0; x < a.ws; x++) {
        if (!a.mask[y * a.ws + x]) continue
        const bx = x + dx
        if (bx < 0 || bx >= b.ws) continue
        if (b.mask[by * b.ws + bx]) n++
      }
    }
    return n / (s * s)
  }

  /**
   * layers: [{ name, width, height, rgba? | analysis?, place:{x,y}, drawIndex?, hintOverride? }]
   * Returns { bones:[world records], json:{bones,ik}, slotBone:{slot→bone}, attachment, plan }.
   */
  function buildSkeleton(layers, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {})
    const L = layers.filter((l) => l && (l.analysis || l.rgba)).map((l, i) => Object.assign({ drawIndex: i }, l))
    let maxDim = 1
    for (const l of L) maxDim = Math.max(maxDim, l.width, l.height)
    const scale = Math.min(o.workScale, o.workMax / maxDim)
    for (const l of L) {
      if (!l.analysis) l.analysis = analyzeLayer(l.rgba, l.width, l.height, Object.assign({}, o, { scale }))
      l.hint = o.names ? nameHint(l.name) : { part: null, side: null }
      if (l.hintOverride) l.hint = Object.assign({}, l.hint, l.hintOverride)
    }
    // No layer is named as a face or a head (exports with numbered layers: ls1..ls40): find
    // the face by looking. Candidates sit in the upper part of the figure and are neither the
    // big body pieces nor specks; the one where the detector finds a pair of eyes in a skin
    // blob wins, the higher one on a tie (a chest with two dark points is lower than the face).
    if (o.faceDetect && !L.some((l) => l.hint.part === 'head' || l.hint.part === 'face')) {
      const box = L.filter((l) => l.analysis).map((l) => { const b = l.analysis.bbox; return { l, top: l.place.y + l.height / 2 - b[1], bottom: l.place.y + l.height / 2 - b[3], area: l.analysis.area } })
      if (box.length) {
        const yTop = Math.max(...box.map((t) => t.top)), yBot = Math.min(...box.map((t) => t.bottom)), H = Math.max(1, yTop - yBot)
        const maxArea = Math.max(...box.map((t) => t.area))
        let best = null
        for (const t of box) {
          if (!t.l.rgba) continue
          const cy = (t.top + t.bottom) / 2
          if (cy < yTop - 0.45 * H || t.area > 0.4 * maxArea || t.area < 0.002 * maxArea) continue
          const img = faceComposite(t.l, L)
          const det = detectFace(img.rgba, img.w, img.h, Object.assign({}, o, { featureMask: img.feat || null }))
          if (!det || !det.eyes || !det.eyes.length) continue
          const score = 10 * det.eyes.length + (det.mouth ? 3 : 0) + 5 * (cy - yBot) / H
          if (!best || score > best.score) best = { l: t.l, det, score, img }
        }
        if (best) { best.l.hint = Object.assign({}, best.l.hint, { part: 'face', found: 'detected' }); best.l.faceDet = best.det; best.l.faceImg = best.img }
      }
    }
    // backdrops: nearly opaque over their whole box and covering half the picture or more
    let backdrops = []
    {
      const boxes = L.filter((l) => l.analysis).map((l) => { const b = l.analysis.bbox; const [x0, y1] = worldOf(l, b[0], b[1]), [x1, y0] = worldOf(l, b[2], b[3]); return { l, x0, x1, y0, y1, area: l.analysis.area, boxArea: Math.max(1, (x1 - x0) * (y1 - y0)) } })
      if (boxes.length > 2) {
        const X0 = Math.min(...boxes.map((b) => b.x0)), X1 = Math.max(...boxes.map((b) => b.x1)), Y0 = Math.min(...boxes.map((b) => b.y0)), Y1 = Math.max(...boxes.map((b) => b.y1))
        const all = Math.max(1, (X1 - X0) * (Y1 - Y0))
        const back = boxes.filter((b) => b.area / b.boxArea > 0.95 && b.boxArea > 0.5 * all).map((b) => b.l)
        if (back.length && back.length < L.length) {
          backdrops = back.map((l) => l.name)
          for (const l of back) L.splice(L.indexOf(l), 1)
        }
      }
    }
    const partOfLayer = new Map(L.map((l) => [l.name, l.hint.part]))
    // the face, found first: the head bone, the crown and the scalp cap all depend on it
    const headEarly = L.filter((l) => l.analysis && (l.hint.part === 'head' || l.hint.part === 'face')).sort((a, b) => (a.hint.part === 'head') === (b.hint.part === 'head') ? b.analysis.area - a.analysis.area : (a.hint.part === 'head' ? -1 : 1))[0] || null
    if (headEarly && headEarly.rgba && !headEarly.faceImg) headEarly.faceImg = faceComposite(headEarly, L)
    const faceDetEarly = headEarly && headEarly.faceDet !== undefined ? headEarly.faceDet : (o.faceDetect && headEarly && headEarly.faceImg ? detectFace(headEarly.faceImg.rgba, headEarly.faceImg.w, headEarly.faceImg.h, Object.assign({}, o, { featureMask: headEarly.faceImg.feat || null })) : null)
    if (headEarly) headEarly.faceDet = faceDetEarly
    const faceBoxEarly = faceDetEarly && faceDetEarly.faceBox && faceDetEarly.faceBox[3] - faceDetEarly.faceBox[1] >= 0.3 * (headEarly.analysis.bbox[3] - headEarly.analysis.bbox[1]) ? faceDetEarly.faceBox : (headEarly ? headEarly.analysis.bbox.slice() : null)
    // hair drawn BEHIND the face or the body is invisible where they cover it, and hair
    // on the scalp cap (buns, the crown above the hairline) moves with the head, not on
    // chains of its own: cut both out before thinning so the chains follow the strands
    // that hang free
    let cap = null
    {
      const solid = L.filter((l) => l.analysis && (l.hint.part === 'body' || l.hint.part === 'face' || l.hint.part === 'head'))
      cap = null
      if (headEarly && faceBoxEarly) {
        const fw = faceBoxEarly[2] - faceBoxEarly[0], fh = faceBoxEarly[3] - faceBoxEarly[1]
        const [cx] = worldOf(headEarly, (faceBoxEarly[0] + faceBoxEarly[2]) / 2, 0)
        // the hairline: the face layer's top (bangs cover the forehead, so the skin box
        // starts below them); a whole-head layer's top is its hair, which disables the cap
        const top = worldOf(headEarly, 0, headEarly.analysis.bbox[1])[1]
        cap = { cx, halfW: 1.5 * fw, yMin: o.hairCap === false ? Infinity : top + 0.1 * fh, margin: Math.max(6, (o.faceMargin || 0) * fw) }
      }
      for (const l of L) {
        if (!l.analysis || l.hint.part !== 'hair') continue
        const covering = solid.filter((c) => c.drawIndex > l.drawIndex)
        if (!covering.length && !(cap && headEarly && (l.drawIndex || 0) < (headEarly.drawIndex || 0))) continue
        const behindFace = headEarly && (l.drawIndex || 0) < (headEarly.drawIndex || 0)
        const hidden = (px, py) => {
          const [wx, wy] = worldOf(l, px, py)
          if (cap && behindFace && wy > cap.yMin && Math.abs(wx - cap.cx) < cap.halfW) return true
          for (const c of covering) {
            if (depthAt(c, wx, wy) > 0) return true
            const margin = cap && (c.hint.part === 'face' || c.hint.part === 'head') ? cap.margin : 6
            if (depthAt(c, wx + margin, wy) > 0 || depthAt(c, wx - margin, wy) > 0 || depthAt(c, wx, wy + margin) > 0 || depthAt(c, wx, wy - margin) > 0) return true
          }
          return false
        }
        const re = analyzeLayer(l.rgba, l.width, l.height, Object.assign({}, o, { scale, exclude: hidden }))
        if (re && re.graph.edges.length) { l.analysisFull = l.analysis; l.analysis = re }
      }
    }
    const layersOk = L.filter((l) => l.analysis && l.analysis.graph.edges.length)
    const plan = { layers: {}, scale, notes: [], backdrops }
    const sk = new Skeleton()
    const rootId = sk.add('root', -1, 0, 0, 0, 0, { kind: 'root', layer: null, role: 'root' })
    if (!layersOk.length) return finish(sk, L, plan)

    // ---- per-layer trunk, elongation, pairwise overlaps
    for (const l of layersOk) {
      const a = l.analysis
      const tp = trunkPath(a.graph)
      l.trunk = tp ? pathPolyline(l, a.graph, tp.start, tp.edges) : null
      l.trunkEdges = tp ? tp.edges : []
      l.trunkLen = l.trunk ? polyLen(l.trunk.poly) : 0
      l.rMean = l.trunk ? l.trunk.radii.reduce((s, r) => s + r, 0) / Math.max(1, l.trunk.radii.length) : 1
      l.elong = l.trunkLen / Math.max(1, 2 * l.rMean)
      l.leaves = a.graph.nodes.filter((n) => n.deg === 1).length
      l.overlap = new Map()
    }
    for (let i = 0; i < layersOk.length; i++) {
      for (let j = i + 1; j < layersOk.length; j++) {
        const A = layersOk[i], B = layersOk[j]
        const bxA = A.analysis.bbox, bxB = B.analysis.bbox
        const [ax0, ay0] = worldOf(A, bxA[0], bxA[3]), [ax1, ay1] = worldOf(A, bxA[2], bxA[1])
        const [bx0, by0] = worldOf(B, bxB[0], bxB[3]), [bx1, by1] = worldOf(B, bxB[2], bxB[1])
        if (ax1 < bx0 || bx1 < ax0 || ay1 < by0 || by1 < ay0) continue
        const ov = overlapArea(A, B)
        if (ov > 0) { A.overlap.set(B, ov); B.overlap.set(A, ov) }
      }
    }

    // ---- root layer: hinted body, else the layer with the most "support"
    let rootLayer = null
    const bodies = layersOk.filter((l) => l.hint.part === 'body')
    if (bodies.length && !(headEarly && faceBoxEarly)) rootLayer = bodies.reduce((a, b) => (b.analysis.area > a.analysis.area ? b : a))
    if (!rootLayer && headEarly && faceBoxEarly) {
      const fb = faceBoxEarly, fH = fb[3] - fb[1]
      const cx = (fb[0] + fb[2]) / 2
      // the body may run up behind the face to the jaw, never past the forehead; and it is not a
      // backdrop several faces wide
      const [, faceMidY] = worldOf(headEarly, cx, fb[1])
      const faceW = fb[2] - fb[0]
      const [chinX, chinY] = worldOf(headEarly, cx, fb[3])
      const probes = [[chinX, chinY - 0.35 * fH], [chinX, chinY - 0.8 * fH], [chinX, chinY - 1.4 * fH]]
      const minHits = 1
      let best = null, bestScore = 0
      // hinted bodies first; everything else only when none of them sits below the face
      const passes = (pool) => {
        let pick = null, sc = 0
        for (const l of pool) {
          if (l === headEarly || l.hint.part === 'hair' || l.hint.part === 'face' || l.hint.part === 'head') continue
          const top = worldOf(l, 0, l.analysis.bbox[1])[1]
          if (top > faceMidY) continue
          if (l.analysis.bbox[2] - l.analysis.bbox[0] > 4.5 * faceW) continue
          const hits = probes.filter(([x, y]) => depthAt(l, x, y) > 0).length
          if (hits < minHits) continue
          const score = l.analysis.area * (1 + hits)
          if (score > sc) { sc = score; pick = l }
        }
        return pick
      }
      best = bodies.length ? passes(bodies) : null
      if (best) { rootLayer = best; plan.rootWhy = 'hinted-below-face' }
      for (const l of (best ? [] : layersOk)) {
        if (l === headEarly || l.hint.part === 'hair' || l.hint.part === 'face' || l.hint.part === 'head') continue
        const top = worldOf(l, 0, l.analysis.bbox[1])[1]
        if (top > faceMidY) continue
        if (l.analysis.bbox[2] - l.analysis.bbox[0] > 4.5 * faceW) continue
        const hits = probes.filter(([x, y]) => depthAt(l, x, y) > 0).length
        if (hits < minHits) continue
        const score = l.analysis.area * (1 + hits)
        if (score > bestScore) { bestScore = score; best = l }
      }
      if (best && !rootLayer) { rootLayer = best; plan.rootWhy = 'below-face' }
      if (!rootLayer && bodies.length) rootLayer = bodies.reduce((a, b) => (b.analysis.area > a.analysis.area ? b : a))
    }
    if (!rootLayer) {
      let best = -Infinity
      for (const l of layersOk) {
        let touch = 0
        for (const ov of l.overlap.values()) touch += Math.sqrt(ov)
        const score = Math.sqrt(l.analysis.area) * (1 + touch / Math.sqrt(l.analysis.area)) / Math.max(1, Math.sqrt(l.elong) / 2)
        if (score > best) { best = score; rootLayer = l }
      }
    }
    plan.rootLayer = rootLayer.name
    const head = layersOk.filter((l) => l !== rootLayer && (l.hint.part === 'head' || l.hint.part === 'face')).sort((a, b) => (a.hint.part === 'head') === (b.hint.part === 'head') ? b.analysis.area - a.analysis.area : (a.hint.part === 'head' ? -1 : 1))[0] || null
    const faceDet = head ? (head.faceDet !== undefined ? head.faceDet : (o.faceDetect && head.rgba ? detectFace(head.rgba, head.width, head.height, o) : null)) : null
    // the face box (skin region, layer px): a whole-head layer's bbox includes hair buns and
    // pigtails, which are not the head
    const faceBox = faceDet && faceDet.faceBox && faceDet.faceBox[3] - faceDet.faceBox[1] >= 0.3 * (head.analysis.bbox[3] - head.analysis.bbox[1]) ? faceDet.faceBox : (head ? [head.analysis.bbox[0], head.analysis.bbox[1], head.analysis.bbox[2], head.analysis.bbox[3]] : null)
    const headCentre = head ? worldOf(head, (faceBox[0] + faceBox[2]) / 2, (faceBox[1] + faceBox[3]) / 2) : null

    // ---- trunk: the root layer's axis from the crotch to the neck top. With a head
    // layer, the top is the leaf nearest the head and the bottom the widest/longest
    // path from it; without one, the widest/longest path overall.
    let poly, radii
    let flipped = false   // does the oriented polyline start at tp.end?
    {
      const g = rootLayer.analysis.graph
      let tp = null
      if (headCentre) {
        let bestN = -1, bd = Infinity
        g.nodes.forEach((n, i) => { if (n.deg !== 1) return; const [wx, wy] = worldOf(rootLayer, n.x, n.y); const d = Math.hypot(wx - headCentre[0], wy - headCentre[1]); if (d < bd) { bd = d; bestN = i } })
        if (bestN >= 0) { tp = trunkPath(g, bestN); const pl = pathPolyline(rootLayer, g, tp.start, tp.edges); poly = reversePts(pl.poly); radii = pl.radii.slice().reverse(); flipped = true }
      }
      if (!poly) {
        tp = trunkPath(g)
        // a short, thin leaf branch at either end (a pectoral fin off a fish's body) is not
        // the trunk's end: drop it and let the trunk run on to the silhouette instead
        for (let pass = 0; pass < 2; pass++) {
          if (tp.edges.length < 2) break
          const atStart = pass === 0
          const ei = atStart ? tp.edges[0] : tp.edges[tp.edges.length - 1]
          const e = g.edges[ei]
          const leaf = atStart ? tp.start : tp.end
          const junction = e.a === leaf ? e.b : e.a
          const rJ = g.nodes[junction].r, rT = g.nodes[leaf].rTip !== undefined ? g.nodes[leaf].rTip : g.nodes[leaf].r
          if (g.nodes[junction].deg >= 3 && e.len < 1.5 * rJ && rT < 0.3 * rJ) {
            if (atStart) { tp = { start: junction, end: tp.end, edges: tp.edges.slice(1), extendStart: 0.9 * rJ } }
            else { tp = { start: tp.start, end: junction, edges: tp.edges.slice(0, -1), extendStart: tp.extendStart, extendEnd: 0.9 * rJ } }
          }
        }
        const pl = pathPolyline(rootLayer, g, tp.start, tp.edges)
        poly = pl.poly.slice(); radii = pl.radii.slice()
        const pushOut = (atStart, by) => {
          const n = poly.length
          const ax = atStart ? poly[2] : poly[n - 4], ay = atStart ? poly[3] : poly[n - 3]
          const bx = atStart ? poly[0] : poly[n - 2], by2 = atStart ? poly[1] : poly[n - 1]
          const d = Math.hypot(bx - ax, by2 - ay) || 1
          const ex = bx + (bx - ax) / d * by, ey = by2 + (by2 - ay) / d * by
          if (atStart) { poly.unshift(ex, ey); radii.unshift(radii[0]) } else { poly.push(ex, ey); radii.push(radii[radii.length - 1]) }
        }
        if (tp.extendStart && poly.length >= 4) pushOut(true, tp.extendStart)
        if (tp.extendEnd && poly.length >= 4) pushOut(false, tp.extendEnd)
        // bottom → top: the end nearer the head layer, else the higher end, is the top.
        // A horizontal body (a quadruped) is a tie: then the end carrying the thicker
        // attachment (neck + head) is the top and the thin one (tail) the bottom
        let d0 = headCentre ? Math.hypot(poly[0] - headCentre[0], poly[1] - headCentre[1]) : -poly[1]
        let d1 = headCentre ? Math.hypot(poly[poly.length - 2] - headCentre[0], poly[poly.length - 1] - headCentre[1]) : -poly[poly.length - 1]
        if (!headCentre && Math.abs(d0 - d1) < 0.15 * polyLen(poly)) {
          let gAll = Infinity, tAll = -Infinity
          for (const l of layersOk) { gAll = Math.min(gAll, worldOf(l, 0, l.analysis.bbox[3])[1]); tAll = Math.max(tAll, worldOf(l, 0, l.analysis.bbox[1])[1]) }
          let thick0 = 0, thick1 = 0
          for (const l of layersOk) {
            if (l === rootLayer || !l.overlap.has(rootLayer)) continue
            const standing = worldOf(l, 0, l.analysis.bbox[3])[1] <= gAll + 0.06 * Math.max(1, tAll - gAll) && l.elong >= 2.5
            if (standing) continue   // legs say nothing about which end is the head
            const c = overlapCentroid(l, rootLayer)
            if (!c) continue
            const t = projectTOn(poly, c[0], c[1])
            if (t < 0.3) thick0 = Math.max(thick0, l.rMean)
            else if (t > 0.7) thick1 = Math.max(thick1, l.rMean)
          }
          if (thick0 > 1.2 * thick1) { d0 = 0; d1 = 1 } else if (thick1 > 1.2 * thick0) { d0 = 1; d1 = 0 }
        }
        if (d0 < d1) { poly = reversePts(poly); radii = radii.slice().reverse(); flipped = true }
      }
      rootLayer.trunkEdges = tp.edges
      // the bottom end of a torso axis runs into a flat cut or a hip corner: keep the
      // raw axis end (the pelvis centre) instead of the tip extension
      const bottomNode = tp.start === undefined ? -1 : (flipped ? tp.end : tp.start)
      const bn = bottomNode >= 0 ? g.nodes[bottomNode] : null
      if (bn && bn.raw && bn.ext > 0.5 && poly.length >= 4) {
        const [rx, ry] = worldOf(rootLayer, bn.raw[0], bn.raw[1])
        // walk the polyline from the bottom until the raw point's arc length is passed
        let acc = 0, cut = 0
        const target = bn.ext
        while (cut < poly.length - 4) { const d = Math.hypot(poly[cut + 2] - poly[cut], poly[cut + 3] - poly[cut + 1]); if (acc + d >= target) break; acc += d; cut += 2 }
        poly = [rx, ry].concat(poly.slice(cut + 2)); radii = [radii[Math.min(radii.length - 1, cut / 2 + 1)]].concat(radii.slice(cut / 2 + 1))
      }
    }
    // no head layer: the trunk may include the head; look for the neck pinch in the
    // upper part and split the trunk there
    let neckT = 1
    if (!headCentre && poly.length >= 4) {
      const N = 40
      const prof = []
      for (let k = 0; k <= N; k++) prof.push(radiusAt(poly, radii, k / N))
      let best = -1, bestScore = 0
      for (let k = Math.round(N * 0.55); k <= N - 3; k++) {
        const above = Math.max(...prof.slice(k + 1)), below = Math.max(...prof.slice(Math.max(0, k - 8), k))
        const pinch = prof[k] / Math.max(1e-6, Math.min(above, below))
        if (pinch < 0.7 && above > 0.35 * below && (1 - pinch) > bestScore) { bestScore = 1 - pinch; best = k }
      }
      if (best > 0) neckT = best / N
    }
    rootLayer.trunkOriented = poly
    // ---- hip level. The root layer may run on into a leg (a body layer drawn with the
    // standing leg, or a single-layer character): the trunk stops where the legs attach,
    // taken from the leg layers' contact with the body when there are any, else from the
    // lowest fork of the axis that sends a long branch downward (the crotch).
    const projectT = (pl, x, y) => {
      const L = polyLen(pl)
      let acc = 0, bestT = 0, bd = Infinity
      for (let i = 2; i < pl.length; i += 2) {
        const ax = pl[i - 2], ay = pl[i - 1], bx = pl[i], by = pl[i + 1]
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
        let u = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0
        u = Math.max(0, Math.min(1, u))
        const d = Math.hypot(x - (ax + u * dx), y - (ay + u * dy))
        if (d < bd) { bd = d; bestT = (acc + u * Math.sqrt(l2)) / Math.max(1e-9, L) }
        acc += Math.sqrt(l2)
      }
      return bestT
    }
    let hipT = 0, hipWhy = 'axis-bottom'
    const g0 = rootLayer.analysis.graph
    const trunkNodeSet = new Set()
    for (const ei of rootLayer.trunkEdges) { trunkNodeSet.add(g0.edges[ei].a); trunkNodeSet.add(g0.edges[ei].b) }
    let gAll0 = Infinity, tAll0 = -Infinity
    for (const l of layersOk) { gAll0 = Math.min(gAll0, worldOf(l, 0, l.analysis.bbox[3])[1]); tAll0 = Math.max(tAll0, worldOf(l, 0, l.analysis.bbox[1])[1]) }
    const standsOnGround = (l) => worldOf(l, 0, l.analysis.bbox[3])[1] <= gAll0 + 0.06 * Math.max(1, tAll0 - gAll0) && l.elong >= 2.5
    const legLayers = layersOk.filter((l) => l !== rootLayer && l.overlap.has(rootLayer) && (l.hint.part === 'leg' || l.hint.part === 'foot' || (!l.hint.part && standsOnGround(l))))
    if (legLayers.length) {
      const ts = []
      for (const ll of legLayers) { const c = overlapCentroid(ll, rootLayer); if (c) ts.push(projectT(poly, c[0], c[1])) }
      if (ts.length) {
        // the hips are where the rearmost pair attaches (a quadruped's front legs attach at the chest)
        ts.sort((a, b) => a - b)
        const rear = ts.filter((t) => t <= ts[0] + 0.2)
        hipT = Math.min(0.45, rear[Math.floor(rear.length / 2)]); hipWhy = 'leg-layers'
      }
    } else {
      let bestY = Infinity, bestNode = -1
      const trunkSet0 = new Set(rootLayer.trunkEdges)
      const groundY0 = worldOf(rootLayer, 0, rootLayer.analysis.bbox[3])[1], heightRL = rootLayer.analysis.bbox[3] - rootLayer.analysis.bbox[1]
      for (const n of trunkNodeSet) {
        const nd = g0.nodes[n]
        if (nd.deg < 3) continue
        const [nx, ny] = worldOf(rootLayer, nd.x, nd.y)
        for (const ei of nd.edges) {
          if (trunkSet0.has(ei)) continue
          const info = subtreeInfo(g0, rootLayer, n, ei, trunkSet0)
          const isLeg = info.minY <= groundY0 + 0.06 * heightRL || (!(info.rMean < 0.3 * nd.r) && info.taper >= 0.5)
          if (info.maxLen >= 2.5 * nd.r && info.minY < ny - 1.5 * nd.r && isLeg && ny < bestY) { bestY = ny; bestNode = n }
        }
      }
      if (bestNode >= 0) { const nd = g0.nodes[bestNode]; const [nx, ny] = worldOf(rootLayer, nd.x, nd.y); hipT = Math.min(0.45, projectT(poly, nx, ny)); hipWhy = 'crotch-fork' }
    }
    const legPartOk = (t) => {
      if (!(t > 0)) return false
      const lp = slicePoly(poly, 0, t)
      const rr = []
      for (let k = 0; k <= 8; k++) rr.push(radiusAt(poly, radii, t * k / 8))
      return polyLen(lp) >= 2.5 * (rr.reduce((a, b) => a + b, 0) / rr.length)
    }
    if (hipT > 0 && !legPartOk(hipT)) { hipT = 0; hipWhy += ' (lower part too short to be a leg)' }
    if (hipT === 0 && poly.length >= 6) {
      // no leg layers told us where the hips are: a strong bend in the lower part of the
      // axis (a seated character, a bent leg drawn in the body layer) is the hip joint
      const L = polyLen(poly)
      let acc = 0, best = -1, bestAng = 0
      for (let i = 2; i < poly.length - 2; i += 2) {
        acc += Math.hypot(poly[i] - poly[i - 2], poly[i + 1] - poly[i - 1])
        const t = acc / Math.max(1e-9, L)
        if (t > 0.6) break
        const ax = poly[i] - poly[i - 2], ay = poly[i + 1] - poly[i - 1], bx = poly[i + 2] - poly[i], by = poly[i + 3] - poly[i + 1]
        const ang = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / Math.max(1e-9, Math.hypot(ax, ay) * Math.hypot(bx, by))))) * 180 / Math.PI
        if (ang >= 50 && ang > bestAng && acc >= 2 * radiusAt(poly, radii, t)) { bestAng = ang; best = t }
      }
      if (best > 0 && legPartOk(Math.min(0.45, best))) { hipT = Math.min(0.45, best); hipWhy = `axis-bend ${bestAng.toFixed(0)}°` }
    }
    const lowerPoly = hipT > 0 ? slicePoly(poly, 0, hipT) : null
    const lowerRadii = lowerPoly ? lowerPoly.map((v, i) => (i % 2 ? null : radiusAt(poly, radii, hipT * (polyLen(lowerPoly.slice(0, i + 2)) / Math.max(1e-9, polyLen(lowerPoly)))))).filter((v) => v !== null) : null
    plan.hips = { t: +hipT.toFixed(3), why: hipWhy, neckT: +neckT.toFixed(3) }
    const [hipsX, hipsY] = pointAt(poly, hipT)
    const hipsId = sk.add('hips', rootId, hipsX, hipsY, hipsX, hipsY, { kind: 'pivot', layer: rootLayer.name, role: 'trunk' })
    const trunkIds = []
    const cuts = [hipT, hipT + o.trunkSplit[0] * (neckT - hipT), hipT + o.trunkSplit[1] * (neckT - hipT), neckT]
    const names = ['waist', 'chest', 'neck']
    const artist = o.rigStyle === 'artist'
    let parent = hipsId
    let waistPivot = -1
    for (let i = 0; i < 3; i++) {
      const seg = slicePoly(poly, cuts[i], cuts[i + 1])
      if (artist && i === 0) {
        // the studio's spine: an abdomen bone stretched by IK from the hips to a waist
        // pivot that is a root-level handle following the hips half-way; the chest,
        // neck and head hang from that pivot, so do the shoulder pivots
        const ab = sk.add('abdomen', hipsId, seg[0], seg[1], seg[seg.length - 2], seg[seg.length - 1], { kind: 'bone', layer: rootLayer.name, role: 'trunk', ikDriven: true })
        waistPivot = sk.add('waist', rootId, seg[seg.length - 2], seg[seg.length - 1], seg[seg.length - 2], seg[seg.length - 1], { kind: 'pivot', layer: rootLayer.name, role: 'trunk' })
        sk.addIk({ name: 'abdomen_ik', bones: ['abdomen'], target: 'waist', compress: true, stretch: true, phase: 3 })
        sk.addTc({ name: 'waist_follow', bones: ['waist'], target: 'hips', rotateMix: 0, translateMix: 0.5, scaleMix: 0, shearMix: 0, phase: 0 })
        trunkIds.push(ab); parent = waistPivot
        continue
      }
      const id = sk.add(names[i], parent, seg[0], seg[1], seg[seg.length - 2], seg[seg.length - 1], { kind: 'bone', layer: rootLayer.name, role: 'trunk' })
      trunkIds.push(id); parent = id
    }
    // the shoulder line: the neck base, where the chest ends (the template's shoulder_r /
    // shoulder_l hang from the chest and run level from here to the arm pivots)
    const neckBase = pointAt(poly, cuts[2])
    const chestId = trunkIds.length >= 3 ? trunkIds[1] : trunkIds[trunkIds.length - 1]
    // ---- the studio's limb mechanism (see mechanize below): per limb a pivot, a joint
    // target and an end target as root-level handles, one stretchy single-bone IK per
    // bone, and a hidden 2-bone helper chain whose knee drags the joint target
    const endTargetOf = new Map()   // lower-bone id → end target id (hands / feet hang there)
    const limbs = []                // { pivot, t1, t2, part, side, x }
    const limbJobs = []             // limb layers awaiting their mechanism (built after placement)
    /**
     * Does the end of a limb run disappear under a layer drawn in front of the root layer
     * (the far thigh behind the near leg)? Tested at the end and a little beyond it along
     * the run's direction, since the axis stops just short of the occluding edge.
     */
    const endHidden = (poly, rEnd, own) => {
      own = own || rootLayer
      const n = poly.length
      if (n < 4) return false
      const ex = poly[n - 2], ey = poly[n - 1]
      let dx = ex - poly[n - 4], dy = ey - poly[n - 3]
      const d = Math.hypot(dx, dy) || 1
      dx /= d; dy /= d
      const reach = Math.max(6, rEnd || 0)
      for (const t of [0, 0.5, 1]) {
        const wx = ex + dx * reach * t, wy = ey + dy * reach * t
        if (layersOk.some((k) => k !== own && k !== rootLayer && (k.drawIndex || 0) > (own.drawIndex || 0) && depthAt(k, wx, wy) > 2)) return true
      }
      return false
    }
    const consumedLower = new Set() // chain roots taken as the lower bone of the layer above
    /**
     * The template's shoulder: the arm pivot (jian) sits ON the shoulder line, at the neck
     * base's height (a.json: jian1 y 410 / jian2 405 for a neck base at 411) — the arm layer
     * starts lower, under the body's shoulder, and a raised arm's axis leaves the trunk
     * higher up. The upper bone is extended along its own line to that height when the
     * meeting point lies within one upper-bone length (a hanging arm: 伽夜 122,410 vs the
     * template's 105,410); otherwise (a raised, nearly level arm) it is moved straight to
     * the line (锦瑟's raised arm: −291,418 vs −302,418). The connector ends where the bone
     * now starts.
     */
    function toShoulderLine(uId, connectorId) {
      if (!neckBase) return null
      const U = sk.bones[uId]
      const Y = neckBase[1]
      const ux = U.bx - U.ax, uy = U.by - U.ay
      // a root ABOVE the line by less than a third of the chest is a shrugged shoulder
      // (安安's chibi arms sit 16–34 px above the neck base, as the artist rigged them);
      // higher than that it is the axis fork on the neck, not a joint; a root BELOW the
      // line is the arm layer's cut edge under the body's shoulder
      const chestLen = chestId >= 0 ? sk.bones[chestId].len : 0
      if (U.ay > Y && U.ay - Y <= 0.3 * chestLen) return null
      let sx = U.ax, sy = Y
      if (Math.abs(uy) > 1e-6) { const t = (Y - U.ay) / uy; if (Math.abs(t) <= 1) sx = U.ax + ux * t }
      if (Math.hypot(sx - U.ax, sy - U.ay) < 2) return null
      const ox = U.ax, oy = U.ay
      U.ax = sx; U.ay = sy; U.len = Math.hypot(U.bx - sx, U.by - sy)
      if (connectorId >= 0) { const c = sk.bones[connectorId]; c.bx = sx; c.by = sy; c.len = Math.hypot(sx - c.ax, sy - c.ay) }
      return [ox, oy]
    }
    const childrenOf = (id) => { const out = []; for (let i = 0; i < sk.bones.length; i++) if (sk.bones[i].parent === id && sk.bones[i].kind === 'bone') out.push(i); return out }
    const descent = (id) => { let best = 0; for (const k of childrenOf(id)) best = Math.max(best, sk.bones[k].len + descent(k)); return best }
    function mechanize(uId, ctx) {
      const kids = childrenOf(uId)
      if (!kids.length) return null
      let lId = -1, best = -1
      if (ctx.lower >= 0) lId = ctx.lower
      else {
        // the layer's own next bone; else a limb / hand bone from another layer — never
        // a ribbon or a hair strand that happens to hang from the upper bone
        const own = kids.filter((k) => sk.bones[k].layer === sk.bones[uId].layer && sk.bones[k].role === 'limb')
        const limbLike = kids.filter((k) => sk.bones[k].role === 'limb' || sk.bones[k].role === 'extremity')
        const pool = own.length ? own : limbLike
        if (!pool.length) return null
        for (const k of pool) { const d = descent(k); if (d > best) { best = d; lId = k } }
      }
      if (o.rigStyle !== 'artist') { if (o.ik) addIk(sk, uId, lId, ctx.name); return null }
      const U = sk.bones[uId], Lb = sk.bones[lId]
      const isLeg = ctx.part === 'leg'
      let pivotParent = ctx.pivotParent
      while (pivotParent > 0 && sk.bones[pivotParent].ikDriven) pivotParent = sk.bones[pivotParent].parent
      const pivot = sk.add(`${ctx.name}_pivot`, pivotParent, U.ax, U.ay, U.ax, U.ay, { kind: 'pivot', layer: U.layer, role: 'mech' })
      U.parent = pivot
      // the template parents the arm targets to the shoulder pivot (arm1 / arm2 ← jian1),
      // so the whole arm shifts with the shoulder; the leg targets stay under root (feet planted)
      const tParent = isLeg ? rootId : pivot
      const t1 = sk.add(`${ctx.name}_${isLeg ? 'knee' : 'elbow'}`, tParent, U.bx, U.by, U.bx, U.by, { kind: 'ikTarget', layer: U.layer, role: 'ik' })
      const t2 = sk.add(`${ctx.name}_${isLeg ? 'ankle' : 'wrist'}`, tParent, Lb.bx, Lb.by, Lb.bx, Lb.by, { kind: 'ikTarget', layer: U.layer, role: 'ik' })
      // a shin hangs under the knee target (feet stay planted); a forearm stays under the
      // upper arm; whatever follows the lower bone (hand, foot, fingers) hangs under the end target
      if (isLeg) Lb.parent = t1
      for (const k of childrenOf(lId)) sk.bones[k].parent = t2
      endTargetOf.set(lId, t2)
      const ux = U.bx - U.ax, uy = U.by - U.ay, lx = Lb.bx - Lb.ax, ly = Lb.by - Lb.ay
      const cross = ux * ly - uy * lx
      // a bend under 25° is not a drawn joint: the knee bends toward the toes and the
      // elbow away from the fingers whatever the axis does (a calf bulge bends the axis)
      // (the angle itself, not its sine: a leg folded back 160° has a small sine too)
      const weak = Math.abs(Math.atan2(cross, ux * lx + uy * ly)) < 25 * Math.PI / 180
      const bend = weak && ctx.bendDefault ? ctx.bendDefault : (Math.abs(cross) < 1e-6 * Math.max(1e-6, U.len * Lb.len) ? (ctx.bendDefault || 1) : Math.sign(cross))
      const Px = U.ax, Py = U.ay, Tx = Lb.bx, Ty = Lb.by
      const dx = Tx - Px, dy = Ty - Py, d = Math.max(1e-6, Math.hypot(dx, dy))
      const k = Math.max(o.helperScale, 1.05 * d / Math.max(1e-6, U.len + Lb.len))
      const a = k * U.len, b = k * Lb.len
      const x = (d * d + a * a - b * b) / (2 * d), hh = Math.sqrt(Math.max(0, a * a - x * x))
      const ex = dx / d, ey = dy / d, nx = -ey, ny = ex
      // K on the real joint's side: the chain P→K→T turns with the sense `bend`, and a
      // positive turn puts K on the right of P→T (n is the left normal)
      const Kx = Px + ex * x - bend * nx * hh, Ky = Py + ey * x - bend * ny * hh
      const h1 = sk.add(`${ctx.name}_helper1`, pivot, Px, Py, Kx, Ky, { kind: 'helper', layer: U.layer, role: 'mech' })
      const h2 = sk.add(`${ctx.name}_helper2`, h1, Kx, Ky, Tx, Ty, { kind: 'helper', layer: U.layer, role: 'mech' })
      const nm = (i) => sk.bones[i].name
      sk.addIk({ name: `${ctx.name}_helper_ik`, bones: [nm(h1), nm(h2)], target: nm(t2), bendPositive: bend > 0, phase: 2 })
      sk.addTc({ name: `${ctx.name}_${isLeg ? 'knee' : 'elbow'}_follow`, bones: [nm(t1)], target: nm(h2), rotateMix: o.followMix, translateMix: o.followMix, scaleMix: o.followMix, shearMix: o.followMix, phase: 2 })
      sk.addIk({ name: `${ctx.name}_upper_ik`, bones: [nm(uId)], target: nm(t1), compress: true, stretch: true, phase: 2 })
      sk.addIk({ name: `${ctx.name}_lower_ik`, bones: [nm(lId)], target: nm(t2), compress: true, stretch: true, phase: 2 })
      if (ctx.connector >= 0) sk.addIk({ name: `${nm(ctx.connector)}_ik`, bones: [nm(ctx.connector)], target: nm(pivot), compress: true, stretch: true, phase: 1 })
      const rec = { pivot, t1, t2, part: ctx.part, side: ctx.side || null, x: Px, name: ctx.name, upper: uId, lower: lId, helpers: [h1, h2], connector: ctx.connector }
      limbs.push(rec)
      return rec
    }
    /**
     * A limb with one visible segment (its joint hidden under another layer, or a layer
     * that holds one segment and nothing continues it): one bone, one target, a
     * compress+stretch IK — the studio's thigh with the shin hidden.
     */
    function singleLimb(uId, ctx) {
      const U = sk.bones[uId]
      if (o.rigStyle !== 'artist') {
        if (!o.ik) return null
        const tId = sk.add(`${ctx.name}_ik`, 0, U.bx, U.by, U.bx, U.by, { kind: 'ikTarget', layer: U.layer, role: 'ik' })
        sk.addIk({ name: sk.bones[tId].name, bones: [U.name], target: sk.bones[tId].name, compress: true, stretch: true })
        return null
      }
      let pivotParent = ctx.pivotParent
      while (pivotParent > 0 && sk.bones[pivotParent].ikDriven) pivotParent = sk.bones[pivotParent].parent
      const pivot = sk.add(`${ctx.name}_pivot`, pivotParent, U.ax, U.ay, U.ax, U.ay, { kind: 'pivot', layer: U.layer, role: 'mech' })
      U.parent = pivot
      const t = sk.add(`${ctx.name}_${ctx.part === 'leg' ? 'knee' : 'elbow'}`, ctx.part === 'leg' ? rootId : pivot, U.bx, U.by, U.bx, U.by, { kind: 'ikTarget', layer: U.layer, role: 'ik' })
      for (const k of childrenOf(uId)) sk.bones[k].parent = t
      endTargetOf.set(uId, t)
      const nm = (i) => sk.bones[i].name
      sk.addIk({ name: `${ctx.name}_upper_ik`, bones: [nm(uId)], target: nm(t), compress: true, stretch: true, phase: 2 })
      if (ctx.connector >= 0) sk.addIk({ name: `${nm(ctx.connector)}_ik`, bones: [nm(ctx.connector)], target: nm(pivot), compress: true, stretch: true, phase: 1 })
      const rec = { pivot, t1: t, t2: t, part: ctx.part, side: ctx.side || null, x: U.ax, name: ctx.name, upper: uId, lower: -1, helpers: [], connector: ctx.connector }
      limbs.push(rec)
      return rec
    }
    /** Default bend for a straight limb: the knee goes toward the toes, the elbow away from the fingers. */
    function bendFromExtremity(uId, lId) {
      const kids = childrenOf(lId)
      if (!kids.length) return 0
      const U = sk.bones[uId], E = sk.bones[kids[0]]
      const c = (U.bx - U.ax) * (E.by - E.ay) - (U.by - U.ay) * (E.bx - E.ax)
      return Math.abs(c) < 1e-6 ? 1 : -Math.sign(c)
    }
    if (hipT > 0) {
      // the part of the axis beyond the hips: a leg drawn in the body layer (thick), or a
      // tail (thin) that just hangs as a strand
      const lp = reversePts(lowerPoly), lr = lowerRadii.slice().reverse()
      const hipR = radiusAt(poly, radii, hipT)
      const groundY1 = worldOf(rootLayer, 0, rootLayer.analysis.bbox[3])[1], heightRL1 = rootLayer.analysis.bbox[3] - rootLayer.analysis.bbox[1]
      const lowest = Math.min(...lp.filter((v, i) => i % 2 === 1))
      let thin = !(lowest <= groundY1 + 0.06 * heightRL1) && ((lr.reduce((a, b) => a + b, 0) / lr.length) < 0.45 * hipR || lr[lr.length - 1] / Math.max(1e-9, lr[0]) < 0.5)
      // a garment panel painted in the body layer hangs OVER a leg layer drawn behind
      // the body (a skirt panel over the standing leg): most of its axis lies on such a
      // layer. A leg of the body's own beside a separate leg overlaps it little
      let overLeg = 0
      { const steps = 12; for (let i = 0; i <= steps; i++) { const q = pointAt(lp, i / steps); if (layersOk.some((k) => k !== rootLayer && (k.hint.part === 'leg' || k.hint.part === 'foot') && (k.drawIndex || 0) < (rootLayer.drawIndex || 0) && depthAt(k, q[0], q[1]) > 0)) overLeg++ } overLeg /= steps + 1 }
      const legLayersAtHips = layersOk.filter((k) => k !== rootLayer && k.hint.part === 'leg' && k.overlap.has(rootLayer)).length
      const cloth = !thin && (overLeg > 0.6 || legLayersAtHips >= 2)
      if (cloth) thin = true
      const tag = cloth ? 'cloth' : (thin ? 'tail' : 'leg')
      const hidden = !thin && endHidden(lp, lr[lr.length - 1])
      if (o.debug) console.log(`[auto-bones] lower part of ${rootLayer.name}: ${tag}${hidden ? ' (end hidden)' : ''} overLeg ${overLeg.toFixed(2)} legLayersAtHips ${legLayersAtHips} len ${polyLen(lp).toFixed(0)} lowest ${lowest.toFixed(0)} ground ${groundY1.toFixed(0)} (+${(0.06 * heightRL1).toFixed(0)}) rMean ${(lr.reduce((a, b) => a + b, 0) / lr.length).toFixed(1)} hipR ${hipR.toFixed(1)} r0 ${lr[0].toFixed(1)} rEnd ${lr[lr.length - 1].toFixed(1)} radii ${lr.map((v) => v.toFixed(0)).join(',')}`)
      const oLower = thin ? Object.assign({}, o, { strandLen: strandBoneLen(polyLen(lp), lr.reduce((a, b) => a + b, 0) / lr.length) }) : o
      const pts = cutPolyline(lp, lr, thin ? 'strand' : (hidden ? 'segment' : 'limb'), oLower)
      let c = 0
      const ids = chainAlong(sk, pts, hipsId, () => `${rootLayer.name}_${tag}_${++c}`, { kind: 'bone', layer: rootLayer.name, role: thin ? 'trunkBranch' : 'limb' })
      if (!thin && ids.length === 1 && !hidden) {
        const b = sk.bones[ids[0]]
        const mx = (b.ax + b.bx) / 2, my = (b.ay + b.by) / 2, bx = b.bx, by = b.by
        b.bx = mx; b.by = my; b.len = Math.hypot(mx - b.ax, my - b.ay)
        ids.push(sk.add(`${rootLayer.name}_${tag}_${++c}`, ids[0], mx, my, bx, by, { kind: 'bone', layer: rootLayer.name, role: 'limb' }))
      }
      if (!thin && o.ik && ids.length >= 2) mechanize(ids[0], { part: 'leg', name: `${rootLayer.name}_leg`, pivotParent: hipsId, connector: -1, bendDefault: bendFromExtremity(ids[0], ids[1]) })
      else if (!thin && o.ik && ids.length === 1) singleLimb(ids[0], { part: 'leg', name: `${rootLayer.name}_leg`, pivotParent: hipsId, connector: -1 })
    } else {
      const seg = slicePoly(poly, 0, hipT)
      if (polyLen(seg) >= o.boneMin * 0.5) sk.add('pelvis', hipsId, hipsX, hipsY, seg[0], seg[1], { kind: 'bone', layer: rootLayer.name, role: 'trunk' })
    }
    const neckTop = pointAt(poly, neckT)
    let headId = -1
    if (headCentre) {
      // head axis: from the neck top toward the crown. The crown is the top of the
      // head layers (face / hair / head accessories) above the face; the direction
      // leans from the neck direction toward the face centre.
      const fx0 = headCentre[0] - (faceBox[2] - faceBox[0]) * 0.35, fx1 = headCentre[0] + (faceBox[2] - faceBox[0]) * 0.35
      const faceTop = worldOf(head, 0, faceBox[1])[1]
      const faceH = faceBox[3] - faceBox[1]
      let crownY = null
      for (const l of layersOk) {
        if (l === rootLayer) continue
        const p = l.hint.part
        if (!(p === 'head' || p === 'face' || p === 'hair')) continue
        const t = topWithin(l, fx0, fx1)
        // hair buns and pigtails far above the skull are not the crown
        if (t !== null && t <= faceTop + 0.5 * faceH && (crownY === null || t > crownY)) crownY = t
      }
      if (crownY === null || crownY < faceTop + 0.15 * faceH) crownY = faceTop + 0.3 * faceH
      const neckDir = (() => { const q = pointAt(poly, Math.max(0, neckT - 0.08)); const dx = neckTop[0] - q[0], dy = neckTop[1] - q[1]; const d = Math.hypot(dx, dy); return d > 1e-6 ? [dx / d, dy / d] : [0, 1] })()
      const toFace = [headCentre[0] - neckTop[0], headCentre[1] - neckTop[1]]
      const dF = Math.hypot(toFace[0], toFace[1])
      let ux = neckDir[0], uy = neckDir[1]
      if (dF > 0.25 * faceH && toFace[1] > 0) { ux = 0.5 * neckDir[0] + 0.5 * toFace[0] / dF; uy = 0.5 * neckDir[1] + 0.5 * toFace[1] / dF; const n = Math.hypot(ux, uy); ux /= n; uy /= n }
      if (uy <= 0.2) { ux = 0; uy = 1 }
      // the trunk top far from the chin: start the head at the chin, along the face's up axis
      let hx = neckTop[0], hy = neckTop[1]
      const chin = worldOf(head, (faceBox[0] + faceBox[2]) / 2, faceBox[3])
      const faceW = faceBox[2] - faceBox[0]
      if (chin[1] - neckTop[1] > 0.6 * faceH || Math.abs(chin[0] - neckTop[0]) > 0.5 * faceW) {
        const up = faceDet && faceDet.up ? [faceDet.up[0], -faceDet.up[1]] : [0, 1]
        const n = Math.hypot(up[0], up[1]) || 1
        ux = up[0] / n; uy = up[1] / n
        if (uy <= 0.2) { ux = 0; uy = 1 }
        hx = chin[0] - ux * 0.15 * faceH; hy = chin[1] - uy * 0.15 * faceH
        plan.notes.push('head starts at the chin: trunk top ' + Math.round(chin[1] - neckTop[1]) + ' px below it')
      }
      const len = Math.min(1.3 * faceH, Math.max(0.6 * faceH, (crownY - hy) / uy))
      headId = sk.add('head', trunkIds[2], hx, hy, hx + ux * len, hy + uy * len, { kind: 'bone', layer: head.name, role: 'trunk' })
      head.rootBone = headId; head.done = true
      plan.layers[head.name] = { role: 'head', part: head.hint.part, parent: rootLayer.name, parentBone: 'neck', bones: ['head'] }
    } else if (neckT < 1) {
      const seg = slicePoly(poly, neckT, 1)
      headId = sk.add('head', trunkIds[2], seg[0], seg[1], seg[seg.length - 2], seg[seg.length - 1], { kind: 'bone', layer: rootLayer.name, role: 'trunk' })
    }
    // ---- side branches of the root layer's axis: what hangs off a fork of the trunk is
    // judged as a whole subtree (two legs may share a short stem): long and thick → limbs,
    // long and thin → a tail / strand, short → a shoulder or hip stub. A limb subtree is
    // split into limb PATHS on the graph: sibling branches of comparable reach are sibling
    // limbs (two legs behind one stem), later forks are toes / fingers, the part of a path
    // that runs inside the body silhouette becomes a hip / shoulder connector and the limb
    // proper starts where it leaves the body (the studio's kua / jian pivots).
    {
      const g = rootLayer.analysis.graph
      const trunkEdgeSet = new Set(rootLayer.trunkEdges)
      const seen = new Set(rootLayer.trunkEdges)
      const midY = (hipsY + neckTop[1]) / 2
      const groundY = worldOf(rootLayer, 0, rootLayer.analysis.bbox[3])[1], heightR = rootLayer.analysis.bbox[3] - rootLayer.analysis.bbox[1]
      const other = (ei, n) => (g.edges[ei].a === n ? g.edges[ei].b : g.edges[ei].a)
      const edgeWorld = (ei, from) => {
        const e = g.edges[ei]
        const fwd = e.a === from
        const p = fwd ? e.poly : reversePts(e.poly)
        const r = fwd ? e.radii : e.radii.slice().reverse()
        const wp = []
        for (let i = 0; i < p.length; i += 2) { const [wx, wy] = worldOf(rootLayer, p[i], p[i + 1]); wp.push(wx, wy) }
        return { wp, r }
      }
      /** Limb paths from node n through edge ei: [{edges, end, extremities:[{node, edges}]}]. */
      const limbPaths = (n, ei) => {
        const paths = []
        const walk = (node, edge, prefix, prefixLen) => {
          let cur = node, e = edge
          const edges = prefix.slice()
          let len = prefixLen
          const extremities = []
          for (let guard = 0; guard < 200; guard++) {
            edges.push(e); len += g.edges[e].len
            const nx = other(e, cur)
            const outs = g.nodes[nx].edges.filter((x) => x !== e && !seen.has(x) && !trunkEdgeSet.has(x) && !edges.includes(x))
            if (!outs.length) { paths.push({ edges, end: nx, extremities }); return }
            if (outs.length === 1) { cur = nx; e = outs[0]; continue }
            const infos = outs.map((x) => ({ x, info: subtreeInfo(g, rootLayer, nx, x, new Set([...seen, ...edges])) }))
            const rNode = g.nodes[nx].r
            const big = infos.filter((q) => q.info.maxLen >= 2.5 * rNode && q.info.maxLen >= 0.5 * len)
            if (big.length >= 2) {
              // sibling limbs behind a shared stem: each continues the same prefix
              for (const q of big) walk(nx, q.x, edges, len)
              return
            }
            infos.sort((p, q) => q.info.maxLen - p.info.maxLen)
            extremities.push({ node: nx, edges: infos.slice(1).map((q) => q.x) })
            cur = nx; e = infos[0].x
          }
          paths.push({ edges, end: cur, extremities })
        }
        walk(n, ei, [], 0)
        return paths
      }
      for (const n of trunkNodeSet) {
        const nd = g.nodes[n]
        if (nd.deg < 3) continue
        const [nx, ny] = worldOf(rootLayer, nd.x, nd.y)
        const tN = projectT(poly, nx, ny)
        if (hipT > 0 && tN < hipT - 0.02) continue   // a fork on the leg / tail part
        const near = sk.nearest(nx, ny, (b) => b.role === 'trunk' && b.len > 0 && b.layer === rootLayer.name && !b.ikDriven)
        let k = 0
        for (const ei of nd.edges) {
          if (trunkEdgeSet.has(ei) || seen.has(ei)) continue
          const info = subtreeInfo(g, rootLayer, n, ei, seen)
          if (info.maxLen < Math.max(o.boneMin, 0.8 * nd.r)) { for (const x of info.edges) seen.add(x); continue }
          const e = g.edges[ei]
          const fwd = e.a === n
          const p = fwd ? e.poly : reversePts(e.poly)
          const side = p[p.length - 2] > p[0] ? 'l' : 'r'
          const long = info.maxLen >= 2.5 * nd.r
          const reachesGround = info.minY <= groundY + 0.06 * heightR
          // a limb keeps its thickness to the end (or stands on the ground); hair, a tail
          // or a ribbon is thin and tapers away
          const thin = !reachesGround && (info.rMean < 0.3 * nd.r || info.taper < 0.5)
          const downward = info.minY < ny - 1.5 * nd.r
          let role, tag
          if (long && !thin) { role = 'limb'; tag = (reachesGround || ny <= hipsY + 0.15 * (neckTop[1] - hipsY) || (downward && ny < midY)) ? 'leg' : 'arm' }
          else if (long && thin) { role = 'strand'; tag = 'strand' }
          else { role = 'strand'; tag = ny > midY ? 'shoulder' : 'hip' }
          const nm = `${tag}_${side}${k ? k + 1 : ''}`
          if (role !== 'limb') {
            let c = 0
            const namer = () => `${nm}${tag === 'strand' ? '_' + (++c) : (c++ ? '_' + c : '')}`
            const skip = new Set([...seen].filter((x) => x !== ei).concat(nd.edges.filter((x) => x !== ei)))
            growBranches(sk, rootLayer, g, n, -1, near.index, 'strand', namer, { kind: 'bone', layer: rootLayer.name, role: 'trunkBranch' }, o, 0, skip)
            for (const x of info.edges) seen.add(x)
            k++
            continue
          }
          const paths = limbPaths(n, ei)
          paths.forEach((P, pi) => {
            const pname = `${nm}${pi ? '_' + (pi + 1) : ''}`
            // world polyline of the path, oriented away from the trunk
            let wp = [], rr = [], cur = n
            for (const x of P.edges) { const ew = edgeWorld(x, cur); for (let i = 0; i < ew.wp.length; i += 2) { if (wp.length && i === 0) continue; wp.push(ew.wp[i], ew.wp[i + 1]); rr.push(ew.r[i / 2]) } cur = other(x, cur) }
            if (polyLen(wp) < o.boneMin) return
            // where does the path leave the body? sample along it
            const L = polyLen(wp)
            let exitT = 0
            const steps = Math.max(2, Math.ceil(L / 3))
            for (let sI = 1; sI <= steps; sI++) { const t = sI / steps; const q = pointAt(wp, t); if (depthAt(rootLayer, q[0], q[1]) <= 0) { exitT = (sI - 1) / steps; break }; if (sI === steps) exitT = 0 }
            if (exitT * L > 0.9 * L) exitT = 0
            let connectorId = -1
            let limbPoly = wp, limbR = rr
            const pivotParent = tag === 'leg' ? hipsId : (waistPivot >= 0 ? waistPivot : near.index)
            if (tag === 'arm' || exitT * L >= o.connectorMin) {
              const q = pointAt(wp, exitT)
              // an arm's shoulder bone runs from the neck base (the template's shoulder_l on
              // the raised arm), a leg's hip bone from where the path forks off the trunk
              connectorId = tag === 'leg'
                ? sk.add(`hip_${pname}`, hipsId, wp[0], wp[1], q[0], q[1], { kind: 'bone', layer: rootLayer.name, role: 'connector' })
                : sk.add(`shoulder_${pname}`, chestId >= 0 ? chestId : near.index, neckBase[0], neckBase[1], q[0], q[1], { kind: 'bone', layer: rootLayer.name, role: 'connector' })
              limbPoly = slicePoly(wp, exitT, 1)
              limbR = []
              for (let i = 0; i < limbPoly.length; i += 2) limbR.push(radiusAt(wp, rr, exitT + (1 - exitT) * (polyLen(limbPoly.slice(0, i + 2)) / Math.max(1e-9, polyLen(limbPoly)))))
            }
            let c = 0
            const namer = () => `${pname}_${++c}`
            // the run disappears under a layer in front (the far thigh behind the near leg):
            // what is visible is one segment, the joint beyond it cannot be placed
            const hidden = endHidden(limbPoly, limbR[limbR.length - 1])
            const pts = cutPolyline(limbPoly, limbR, hidden ? 'segment' : 'limb', o)
            const ids = chainAlong(sk, pts, connectorId >= 0 ? connectorId : near.index, namer, { kind: 'bone', layer: rootLayer.name, role: 'limb' })
            if (tag === 'arm' && o.rigStyle === 'artist' && ids.length) toShoulderLine(ids[0], connectorId)
            if (!ids.length) return
            if (ids.length === 1 && !hidden) {
              const b = sk.bones[ids[0]]
              const mx = (b.ax + b.bx) / 2, my = (b.ay + b.by) / 2, bx = b.bx, by = b.by
              b.bx = mx; b.by = my; b.len = Math.hypot(mx - b.ax, my - b.ay)
              ids.push(sk.add(namer(), ids[0], mx, my, bx, by, { kind: 'bone', layer: rootLayer.name, role: 'limb' }))
            }
            // toes / fingers: forks along the path, hung on the limb bone nearest the fork
            for (const ex of P.extremities) {
              const [fx, fy] = worldOf(rootLayer, g.nodes[ex.node].x, g.nodes[ex.node].y)
              let bestB = ids[ids.length - 1], bd = Infinity
              for (const id of ids) { const b = sk.bones[id]; const d = segDist(fx, fy, b.ax, b.ay, b.bx, b.by); if (d < bd) { bd = d; bestB = id } }
              let ec = 0
              const enamer = () => `${pname}_toe_${++ec}`
              const skip = new Set([...seen, ...P.edges].concat(g.nodes[ex.node].edges.filter((x) => !ex.edges.includes(x))))
              growBranches(sk, rootLayer, g, ex.node, -1, bestB, 'extremity', enamer, { kind: 'bone', layer: rootLayer.name, role: 'extremity' }, o, 0, skip)
            }
            if (ids.length === 1) singleLimb(ids[0], { part: tag, name: pname, side, pivotParent, connector: connectorId })
            else mechanize(ids[0], { part: tag, name: pname, side, pivotParent, connector: connectorId, bendDefault: bendFromExtremity(ids[0], ids[1]) })
          })
          for (const x of info.edges) seen.add(x)
          k++
        }
      }
    }
    rootLayer.rootBone = hipsId; rootLayer.done = true
    plan.layers[rootLayer.name] = { role: 'trunk', part: rootLayer.hint.part, parent: null, parentBone: 'root', bones: sk.bones.filter((b) => b.layer === rootLayer.name).map((b) => b.name) }
    const trunkRadius = rootLayer.rMean
    let groundAll = Infinity, topAll = -Infinity
    for (const l of layersOk) { groundAll = Math.min(groundAll, worldOf(l, 0, l.analysis.bbox[3])[1]); topAll = Math.max(topAll, worldOf(l, 0, l.analysis.bbox[1])[1]) }
    const heightAll = Math.max(1, topAll - groundAll)
    // a layer named hand / foot whose axis is longer than a third of the character is not
    // a hand: a sash held in it, a ribbon (伽夜's left_hand is a 950-px sash the template
    // hangs from the hip pivot)
    // (hands only: a long foot-named layer is a shin with its foot, which the leg takes as
    // its lower segment)
    for (const l of layersOk) {
      if (l.hint.part !== 'hand') continue
      const total = l.analysis.graph.edges.reduce((a, e) => a + e.len, 0)
      if (total > 0.45 * heightAll) { plan.notes.push(`${l.name}: named ${l.hint.part} but ${Math.round(total)} px of axis (> 0.45 × ${Math.round(heightAll)}): cloth`); l.hint = Object.assign({}, l.hint, { part: 'cloth', demotedFrom: l.hint.part }); partOfLayer.set(l.name, 'cloth') }
    }

    function roleOf(l) {
      const p = l.hint.part
      if (p === 'arm' || p === 'leg') return 'limb'
      if (p === 'hand' || p === 'foot') return 'extremity'
      if (p === 'hair' || p === 'cloth') return 'strand'
      // an ornament with hanging tassels is a chain; a bra (two flowers), a tiara or a
      // necklace is one controller per piece
      if (p === 'accessory') {
        const tassels = l.analysis.graph.edges.filter((e) => e.len >= 2.5 * 2 * Math.max(1, e.rMean)).length
        if (l.leaves >= 4 && tassels >= 3) return 'strand'
        // every piece a hanging strand (a pair of earrings): chains, one per piece
        const comps = graphComponents(l.analysis.graph)
        const hanging = comps.filter((c) => c.len >= 4 * o.boneMin)
        if (hanging.length && hanging.length <= 3 && hanging.every((c) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const n of c.nodes) { const [wx, wy] = worldOf(l, l.analysis.graph.nodes[n].x, l.analysis.graph.nodes[n].y); x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy) } return c.len >= 3 * 2 * Math.max(1, c.rMean) && (y1 - y0) >= 1.2 * (x1 - x0) })) return 'strand'
        return 'plate'
      }
      if (p === 'eye' || p === 'mouth' || p === 'nose' || p === 'face' || p === 'head' || p === 'breast' || p === 'bra') return 'plate'
      if (l.elong < 1.6) return 'plate'
      const width = 2 * l.rMean
      const thick = width > 0.55 * trunkRadius * 2
      const bottom = worldOf(l, 0, l.analysis.bbox[3])[1]
      // it stands on the ground and is about as thick as a leg: a leg. A splash or a ribbon end
      // lying by the feet is thin (洛神 shui-13/14 were rigged as legs with IK and tore when the
      // ankles moved)
      if (l.elong >= 2.5 && bottom <= groundAll + 0.06 * heightAll && width > 0.3 * trunkRadius * 2) return 'limb'
      return thick && l.elong < 9 && l.leaves <= 3 ? 'limb' : 'strand'
    }

    function placeLayer(l) {
      const g = l.analysis.graph
      const role = roleOf(l)
      const part = l.hint.part
      const isFaceFeature = part === 'eye' || part === 'mouth' || part === 'nose'
      const prefer = new Set(PREFERRED_PARENT[part] || [])
      const anchorPt = part === 'leg' || part === 'foot' ? [hipsX, hipsY] : (part === 'arm' ? neckBase : null)
      const realBone = (b) => b.kind === 'bone' || (b.kind === 'pivot' && b.role === 'trunk')
      const preferBone = (b) => realBone(b) && b.layer !== l.name && (prefer.has(partOfLayer.get(b.layer)) || (prefer.has('body') && b.layer === rootLayer.name))
      const cands = []
      for (let n = 0; n < g.nodes.length; n++) {
        const nd = g.nodes[n]
        if (nd.deg === 0) continue
        const [wx, wy] = worldOf(l, nd.x, nd.y)
        const R = 40 + 1.5 * nd.r
        // limbs measure their closeness to where they belong on the trunk: legs to the
        // hips pivot, arms to the neck base; everything else to the nearest trunk bone
        const dT = anchorPt ? Math.hypot(wx - anchorPt[0], wy - anchorPt[1]) : sk.nearest(wx, wy, (b) => b.role === 'trunk').dist
        const near = sk.nearest(wx, wy, (b) => realBone(b) && b.layer !== l.name)
        const nearPref = prefer.size ? sk.nearest(wx, wy, preferBone) : { index: -1, dist: Infinity }
        let depth = 0, prefDepth = 0, prefLayer = null, smallest = null
        const prefOrder = PREFERRED_PARENT[part] || []
        for (const k of l.overlap.keys()) {
          if (!k.done) continue
          const d = depthAt(k, wx, wy)
          if (d > depth) depth = d
          if (d > 0 && (!smallest || k.analysis.area < smallest.analysis.area)) smallest = k
          if (!prefer.has(k.hint.part) || d <= 2) continue
          // the preferred-parent list is ordered: a skirt strip touching a leg still hangs from the body
          const rank = prefOrder.indexOf(k.hint.part), prevRank = prefLayer ? prefOrder.indexOf(prefLayer.hint.part) : Infinity
          if (rank < prevRank || (rank === prevRank && d > prefDepth)) { prefDepth = d; prefLayer = k }
        }
        let pref = prefDepth
        if (nearPref.index >= 0 && nearPref.dist <= R) pref = Math.max(pref, (R - nearPref.dist) / R * Math.max(1, nd.r))
        const reach = anchorPt ? R + 2.5 * trunkRadius : R + trunkRadius
        const touching = depth > 0 || near.dist <= R || dT <= reach
        // a limb end lying on the face or head (a hand on the cheek, a fist at the temple)
        // is never where the limb hangs from, however close to the neck it is
        let onHead = false
        if ((role === 'limb' || role === 'extremity') && !(prefDepth > 0)) for (const k of l.overlap.keys()) { if (!k.done || !HEAD_PARTS.has(k.hint.part)) continue; if (depthAt(k, wx, wy) > 2) { onHead = true; break } }
        cands.push({ n, wx, wy, dT, near, nearPref, depth, prefDepth, pref, prefLayer, smallest, touching, touchTrunk: dT <= reach && !onHead, onHead, r: nd.r, deg: nd.deg, bridge: false })
      }
      if (!cands.length) { plan.layers[l.name] = { role: 'skipped' }; return }
      const hanging = role === 'strand' && (part === 'hair' || part === 'cloth' || part === 'accessory')
      cands.sort((A, B) => {
        if (hanging) {
          // hair, ribbons, skirt strips: the root is the highest end that touches something;
          // an ornament with tassels hangs from its thickest part instead
          const ta = A.touching ? 0 : 1, tb = B.touching ? 0 : 1
          if (ta !== tb) return ta - tb
          if (part === 'accessory') return B.r - A.r
          const pa = A.pref > 0 ? 0 : 1, pb = B.pref > 0 ? 0 : 1
          if (pa !== pb && Math.abs(A.wy - B.wy) < 0.5 * Math.max(A.r, B.r) + 25) return pa - pb
          return B.wy - A.wy
        }
        const ha = A.onHead ? 1 : 0, hb = B.onHead ? 1 : 0
        if (ha !== hb) return ha - hb
        const pa = A.pref > 0 ? 0 : 1, pb = B.pref > 0 ? 0 : 1
        if (pa !== pb) return pa - pb
        if (pa === 0) return anchorPt ? A.dT - B.dT : B.pref - A.pref
        const ta = A.touchTrunk ? 0 : 1, tb = B.touchTrunk ? 0 : 1
        if (ta !== tb) return ta - tb
        if (ta === 0) return A.dT - B.dT
        const ia = A.depth > 0 ? 0 : 1, ib = B.depth > 0 ? 0 : 1
        if (ia !== ib) return ia - ib
        if (ia === 0) return B.depth - A.depth
        return A.near.dist - B.near.dist
      })
      let rootC = cands[0]
      let continues = -1
      // A limb continuing another limb layer (a shin under a thigh, a forearm or a hand
      // under an upper arm): the joint is that layer's chain tip. The root is the end
      // nearest the tip and the chain hangs from the tip bone
      // (a second leg whose foot rests by the first one's is not a continuation: a
      // continuation never reaches the body, and it covers the joint it continues from)
      if (role === 'limb' || role === 'extremity') {
        let bestP = null, bestOv = 0
        const wantPart = role === 'limb' ? (part || null) : (part === 'hand' ? 'arm' : (part === 'foot' ? 'leg' : null))
        for (const [k, ov] of l.overlap) {
          if (!k.done || !(k.limbTip >= 0) || ov <= bestOv) continue
          const kp = k.hint.part || null
          if (wantPart === null ? !(kp === 'arm' || kp === 'leg' || kp === null) : kp !== wantPart) continue
          const tb = sk.bones[k.limbTip]
          if (!(depthAt(l, tb.bx, tb.by) > 0)) continue
          bestOv = ov; bestP = k
        }
        if (bestP) {
          const tb = sk.bones[bestP.limbTip]
          let bn = null, bd = Infinity
          for (const cd of cands) { const d = Math.hypot(cd.wx - tb.bx, cd.wy - tb.by); if (d < bd) { bd = d; bn = cd } }
          const attachesToTrunk = cands.some((cd) => cd !== bn && cd.touchTrunk && depthAt(rootLayer, cd.wx, cd.wy) > 2)
          if (bn && bd <= Math.max(2 * o.boneMin, 0.35 * tb.len) && !attachesToTrunk) { rootC = Object.assign({}, bn, { bridge: false, prefLayer: bestP, prefDepth: 1, pref: 1, onHead: false }); continues = bestP.limbTip }
        }
      }
      // A limb whose axis never enters the layer it hangs from (an arm whose shoulder is
      // hidden under a flower, a leg layer that carries the whole pelvis): bridge from the
      // centre of the overlap with that layer to the axis — to the nearest axis POINT when
      // that is much closer than the nearest end (the axis is split there), else to the end
      if (continues < 0 && (role === 'limb' || role === 'extremity') && !(rootC.prefDepth > 0) && prefer.size) {
        let bestP = null, bestOv = 0
        for (const [k, ov] of l.overlap) if (k.done && prefer.has(k.hint.part) && ov > bestOv) { bestOv = ov; bestP = k }
        if (bestP) {
          const c = overlapCentroid(l, bestP)
          if (c) {
            let bn = null, bd = Infinity
            for (const cd of cands) { const d = Math.hypot(cd.wx - c[0], cd.wy - c[1]); if (d < bd) { bd = d; bn = cd } }
            if (bn && bd > 2 * o.boneMin) {
              const q = splitGraphAt(l, g, c[0], c[1], 0.5 * bd)
              if (q) {
                const [wx, wy] = worldOf(l, g.nodes[q.node].x, g.nodes[q.node].y)
                bn = Object.assign({}, bn, { n: q.node, wx, wy, r: g.nodes[q.node].r, deg: 2, onHead: false, split: true }); bd = q.dist
              }
            }
            if (bn) rootC = Object.assign({}, bn, { bridge: bd > 2 * o.boneMin, bx: c[0], by: c[1], prefLayer: bestP, prefDepth: 1, pref: 1 })
          }
        }
      }
      const R = 40 + 1.5 * rootC.r
      if (o.debug && (o.debug === true || o.debug === l.name)) console.log(`[auto-bones] ${l.name} role ${role} part ${part || '-'} overlaps ${Array.from(l.overlap).map(([k, v]) => `${k.name}${k.done ? '' : '(pending)'}:${Math.round(v)}`).join(' ') || '-'}`)
      if (o.debug && (o.debug === true || o.debug === l.name)) for (const c of cands) console.log(`[auto-bones] ${l.name} cand n${c.n} (${c.wx.toFixed(0)},${c.wy.toFixed(0)}) r ${c.r.toFixed(0)} dT ${c.dT.toFixed(0)} near ${c.near.index >= 0 ? sk.bones[c.near.index].name : '-'}@${c.near.dist.toFixed(0)} pref ${c.pref.toFixed(1)} nearPref ${c.nearPref.index >= 0 ? sk.bones[c.nearPref.index].name : '-'}@${c.nearPref.dist === Infinity ? 'inf' : c.nearPref.dist.toFixed(0)} depth ${c.depth.toFixed(0)} smallest ${c.smallest ? c.smallest.name : '-'} touching ${c.touching} touchTrunk ${c.touchTrunk}${c.n === rootC.n ? '  <== root' + (rootC.bridge ? ' (bridged)' : '') : ''}`)
      if (role === 'limb' && rootC.bridge) rootC = Object.assign({}, rootC, { bridge: false })
      const rx = rootC.bridge ? rootC.bx : rootC.wx, ry = rootC.bridge ? rootC.by : rootC.wy
      const allowed = new Set(Array.from(l.overlap.keys()).filter((k) => k.done).map((k) => k.name))
      allowed.add(rootLayer.name); if (head) allowed.add(head.name)
      const notMine = (b) => realBone(b) && b.layer !== l.name
      let par = { index: -1, dist: Infinity }, why = ''
      if (continues >= 0) { par = { index: continues, dist: 0 }; why = 'continues-limb' }
      if (par.index < 0 && !part && role === 'strand') {
        // an unnamed wisp: on the head when it lies on the face / head layer, else on the
        // hair lock it overlaps most (the studio hangs stray wisps from the hair, not from
        // whatever limb happens to be under them)
        const ov = Array.from(l.overlap.entries()).filter(([k]) => k.done)
        if (headId >= 0 && ov.some(([k]) => k.hint.part === 'face' || k.hint.part === 'head')) { par = { index: headId, dist: 0 }; why = 'head' }
        else { let bestK = null, bestOv = 0; for (const [k, v] of ov) if (k.hint.part === 'hair' && v > bestOv) { bestOv = v; bestK = k }; if (bestK) { par = sk.nearest(rx, ry, (b) => notMine(b) && b.layer === bestK.name); why = 'hair-chain' } }
      }
      if (par.index < 0 && rootC.prefLayer) { par = sk.nearest(rx, ry, (b) => notMine(b) && b.layer === rootC.prefLayer.name && b.role !== 'connector'); why = 'inside-preferred' }
      if (par.index < 0 && (role === 'limb' || role === 'extremity') && prefer.size) {
        // a hinted limb always hangs from what it prefers: the nearest body bone for an arm
        par = sk.nearest(rx, ry, (b) => preferBone(b) && b.role !== 'connector'); why = 'preferred-part'
      }
      if (par.index < 0 && rootC.nearPref.index >= 0 && rootC.nearPref.dist <= R + (prefer.has('body') ? trunkRadius : 0)) { par = rootC.nearPref; why = 'preferred' }
      if (par.index < 0 && part === 'hair' && headId >= 0) { par = { index: headId, dist: 0 }; why = 'head' }
      // an earring, a tiara, a hair pin: on the head, whatever hair it sits in
      if (par.index < 0 && part === 'accessory' && headId >= 0) {
        const c0 = worldOf(l, (l.analysis.bbox[0] + l.analysis.bbox[2]) / 2, (l.analysis.bbox[1] + l.analysis.bbox[3]) / 2)
        const faceHt = faceBox[3] - faceBox[1]
        const nearFace = headCentre && Math.hypot(c0[0] - headCentre[0], c0[1] - headCentre[1]) < 1.6 * faceHt
        const onHead = nearFace || Array.from(l.overlap.keys()).some((k) => k.done && (k.hint.part === 'face' || k.hint.part === 'head')) || (cap && Math.abs(c0[0] - cap.cx) < cap.halfW && c0[1] > cap.yMin - 0.6 * faceHt)
        if (onHead) { par = { index: headId, dist: 0 }; why = 'head' }
      }
      if (par.index < 0 && rootC.smallest) { par = sk.nearest(rx, ry, (b) => notMine(b) && b.layer === rootC.smallest.name); why = 'smallest-containing' }
      if (par.index < 0 && part === 'accessory') {
        // anything else hangs from the layer it overlaps most
        let bestK = null, bestOv = 0; for (const [k, ov] of l.overlap) if (k.done && ov > bestOv) { bestOv = ov; bestK = k }
        if (bestK) { par = sk.nearest(rx, ry, (b) => notMine(b) && b.layer === bestK.name); why = 'most-overlap' }
      }
      if (par.index < 0 && rootC.touchTrunk) { par = sk.nearest(rx, ry, (b) => b.role === 'trunk' || (b.role === 'connector' && b.layer === rootLayer.name)); why = 'trunk' }
      if (par.index < 0) { par = sk.nearest(rx, ry, (b) => notMine(b) && (allowed.has(b.layer) || b.role === 'trunk')); why = 'nearest-overlapping' }
      if (par.index < 0) { par = sk.nearest(rx, ry, notMine); why = 'nearest' }
      if (par.index < 0) par = { index: rootId, dist: 0 }
      if (role === 'plate' && par.index >= 0 && sk.bones[par.index] && sk.bones[par.index].role === 'strand') {
        // held pieces belong to the hand: hand bones first, then the arm, then any rigid bone
        const lb = l.analysis.bbox
        const reach = Math.max(2 * R, 120, 0.5 * Math.hypot(lb[2] - lb[0], lb[3] - lb[1]))
        const ok = (b) => notMine(b) && b.kind === 'bone' && b.role !== 'strand' && b.role !== 'connector' && allowed.has(b.layer)
        // a hand need not overlap what it holds (drawn side by side): hands and arms by distance
        const rigid = (b) => notMine(b) && b.kind === 'bone' && b.role !== 'strand' && b.role !== 'connector'
        for (const pick of [(b) => rigid(b) && b.role === 'extremity' && partOfLayer.get(b.layer) !== 'foot', (b) => rigid(b) && b.role === 'limb' && partOfLayer.get(b.layer) === 'arm', ok]) {
          const alt = sk.nearest(rx, ry, pick)
          if (alt.index >= 0 && alt.dist <= reach) { par = alt; why = 'rigid-off-strand'; break }
        }
      }
      if (part === 'cloth' && role === 'strand' && continues < 0) {
        // a ribbon that starts where another ribbon's chain ends continues it
        let bestB = -1, bd = Infinity
        for (let i = 0; i < sk.bones.length; i++) { const b = sk.bones[i]; if (b.kind !== 'bone' || b.role !== 'strand' || b.layer === l.name || partOfLayer.get(b.layer) !== 'cloth') continue; const d = Math.hypot(b.bx - rx, b.by - ry); if (d < bd) { bd = d; bestB = i } }
        if (bestB >= 0 && bd <= Math.max(30, 0.5 * sk.bones[bestB].len)) { par = { index: bestB, dist: bd }; why = 'cloth-chain' }
      }
      if (part === 'hair' && role === 'strand' && headId >= 0 && (why === 'head' || why === 'preferred' || why === 'inside-preferred')) {
        // a lock that starts far from the head, off another lock's chain (a strand
        // branching from the long fall), hangs from that chain rather than from the head
        const hb = sk.bones[headId]
        if (segDist(rx, ry, hb.ax, hb.ay, hb.bx, hb.by) > 1.2 * hb.len) {
          const near = sk.nearest(rx, ry, (b) => realBone(b) && b.layer !== l.name && partOfLayer.get(b.layer) === 'hair')
          if (near.index >= 0 && near.dist <= Math.max(40, 3 * l.rMean)) { par = near; why = 'hair-chain' }
        }
      }
      let parentBone = par.index
      let snapTip = -1
      if (o.debug === l.name) console.log(`[auto-bones] ${l.name} parent ${sk.bones[parentBone].name} role ${sk.bones[parentBone].role} kind ${sk.bones[parentBone].kind} why ${why}`)
      if (parentBone >= 0 && sk.bones[parentBone].kind === 'bone' && sk.bones[parentBone].layer !== rootLayer.name && ((role === 'strand' && sk.bones[parentBone].role === 'strand') || (role === 'extremity' && continues < 0 && (sk.bones[parentBone].role === 'limb' || sk.bones[parentBone].role === 'extremity')))) {
        // a lock or a strip hung on another strand's chain continues from a bone END (the
        // studio's locks branch off the fall at a bone tip, never from mid-bone)
        const pl0 = sk.bones[parentBone].layer
        let best = -1, bd = Infinity
        for (let i = 0; i < sk.bones.length; i++) { const b = sk.bones[i]; if (b.kind !== 'bone' || b.layer !== pl0) continue; const d = Math.hypot(b.bx - rx, b.by - ry); if (d < bd) { bd = d; best = i } }
        if (best >= 0 && bd <= Math.max(40, 0.6 * sk.bones[best].len)) { parentBone = best; snapTip = best }
      }
      if (role === 'extremity' && parentBone >= 0) {
        // a cuff, a sleeve end, a boot shaft: the layer runs along the limb that carries
        // it instead of beyond the limb's end → it has no bones of its own
        const pl0 = sk.bones[parentBone].layer
        const pbase = pl0.replace(/[^A-Za-z0-9_\u4e00-\u9fff]+/g, '_')
        const corridor = sk.bones.map((b, i) => ((b.kind === 'bone' && b.layer === pl0 && b.role === 'limb') || b.name === `${pbase}_upper` || b.name === `shoulder_${pbase}` || b.name === `hip_${pbase}` ? i : -1)).filter((i) => i >= 0)
        const tp = corridor.length ? trunkPath(g) : null
        const pl = tp ? pathPolyline(l, g, tp.start, tp.edges) : null
        if (pl && polyLen(pl.poly) >= o.boneMin) {
          const NS = 12
          let inside = 0, overshoot = 0
          const tol = Math.max(20, 3 * l.rMean)
          for (let i = 0; i <= NS; i++) {
            const q = pointAt(pl.poly, i / NS)
            let along = false, beyond = Infinity
            for (const id of corridor) {
              const b = sk.bones[id]
              const dx = b.bx - b.ax, dy = b.by - b.ay, l2 = dx * dx + dy * dy
              if (l2 < 1) continue
              const t = ((q[0] - b.ax) * dx + (q[1] - b.ay) * dy) / l2
              const lat = Math.abs((q[0] - b.ax) * dy - (q[1] - b.ay) * dx) / Math.sqrt(l2)
              if (t >= -0.1 && t <= 1.1 && lat <= tol) along = true
              beyond = Math.min(beyond, Math.max(0, (t - 1) * Math.sqrt(l2)))
            }
            if (along) inside++
            overshoot = Math.max(overshoot, beyond === Infinity ? 0 : beyond)
          }
          if (inside / (NS + 1) >= 0.6 && overshoot <= 2 * l.rMean + 10) {
            const c = worldOf(l, (l.analysis.bbox[0] + l.analysis.bbox[2]) / 2, (l.analysis.bbox[1] + l.analysis.bbox[3]) / 2)
            let carrier = corridor[0], bd = Infinity
            for (const id of corridor) { const b = sk.bones[id]; const d = segDist(c[0], c[1], b.ax, b.ay, b.bx, b.by); if (d < bd) { bd = d; carrier = id } }
            l.rootBone = carrier
            l.done = true
            plan.layers[l.name] = { role: 'sleeve', part, parent: sk.bones[carrier].layer, parentBone: sk.bones[carrier].name, parentWhy: 'along-limb', root: [Math.round(rx), Math.round(ry)], rootWhy: 'along-limb', bones: [], elong: +l.elong.toFixed(2), width: +(2 * l.rMean).toFixed(1), leaves: l.leaves }
            return
          }
        }
      }
      const meta = { kind: 'bone', layer: l.name, role, side: l.hint.side }
      const base = l.name.replace(/[^A-Za-z0-9_\u4e00-\u9fff]+/g, '_')
      let counter = 0
      const namer = () => `${base}_${++counter}`
      const created = sk.bones.length
      if (role === 'plate') {
        const tp = trunkPath(g)
        const pl = tp ? pathPolyline(l, g, tp.start, tp.edges) : null
        let p = pl ? pl.poly : [rootC.wx, rootC.wy, rootC.wx, rootC.wy]
        const pb = sk.bones[parentBone]
        if (segDist(p[0], p[1], pb.ax, pb.ay, pb.bx, pb.by) > segDist(p[p.length - 2], p[p.length - 1], pb.ax, pb.ay, pb.bx, pb.by)) p = reversePts(p)
        const len = polyLen(p)
        const c = worldOf(l, (l.analysis.bbox[0] + l.analysis.bbox[2]) / 2, (l.analysis.bbox[1] + l.analysis.bbox[3]) / 2)
        if (isFaceFeature && headId >= 0) {
          parentBone = headId
          sk.add(base, parentBone, c[0], c[1], c[0], c[1], Object.assign({}, meta, { kind: 'controller' }))
        } else if (part === 'accessory') {
          const pieces = maskPieces(l)
          if (pieces.length <= 1) sk.add(base, parentBone, c[0], c[1], c[0], c[1], Object.assign({}, meta, { kind: 'controller' }))
          else pieces.forEach((q, i) => { const pp = sk.nearest(q[0], q[1], (b) => notMine(b) && (b.layer === sk.bones[parentBone].layer || b.role === 'trunk')); sk.add(`${base}_${i + 1}`, pp.index >= 0 ? pp.index : parentBone, q[0], q[1], q[0], q[1], Object.assign({}, meta, { kind: 'controller' })) })
        } else if (part === 'breast') {
          parentBone = sk.nearest(c[0], c[1], (b) => b.role === 'trunk' && b.len > 0 && b.layer === rootLayer.name).index
          if (parentBone < 0) parentBone = par.index
          sk.add(base, parentBone, c[0], c[1], c[0], c[1], Object.assign({}, meta, { kind: 'controller' }))
        } else if (part === 'bra') {
          // the template's bra: one controller per cup, both under the chest bone
          const chestIdx = sk.bones.findIndex((b) => b.name === 'chest' && b.role === 'trunk')
          parentBone = chestIdx >= 0 ? chestIdx : sk.nearest(c[0], c[1], (b) => b.role === 'trunk' && b.len > 0 && b.layer === rootLayer.name).index
          if (parentBone < 0) parentBone = par.index
          const pieces = maskPieces(l).sort((q, r) => r[0] - q[0]).slice(0, 2)
          if (pieces.length < 2) sk.add(base, parentBone, c[0], c[1], c[0], c[1], Object.assign({}, meta, { kind: 'controller', role: 'bra' }))
          else pieces.forEach((q, i) => sk.add(`${base}_${i + 1}`, parentBone, q[0], q[1], q[0], q[1], Object.assign({}, meta, { kind: 'controller', role: 'bra' })))
        } else if (len < o.boneMin) {
          sk.add(base, parentBone, c[0], c[1], c[0], c[1], Object.assign({}, meta, { kind: 'controller' }))
        } else {
          sk.add(base, parentBone, p[0], p[1], p[p.length - 2], p[p.length - 1], meta)
        }
      } else {
        // limbs hang from the nearest trunk joint through a connector (hip / shoulder)
        if (role === 'limb' && continues < 0 && sk.bones[parentBone].role !== 'connector' && (part === 'leg' || part === 'arm' || sk.bones[parentBone].layer === rootLayer.name)) {
          let bj = anchorPt ? anchorPt.slice() : null, bd = bj ? Math.hypot(bj[0] - rx, bj[1] - ry) : Infinity
          let atHips = part === 'leg'
          if (!bj) {
            // no name: the nearer of the hips and the neck base (a quadruped's front legs
            // hang from the chest, its hind legs from the hips)
            const dh = Math.hypot(hipsX - rx, hipsY - ry), dn = Math.hypot(neckBase[0] - rx, neckBase[1] - ry)
            if (dh <= dn) { bj = [hipsX, hipsY]; bd = dh; atHips = true } else { bj = neckBase.slice(); bd = dn }
          }
          if (bj && bd > o.connectorMin) {
            // hips carry the hip bones; the shoulders hang from the chest (never from the
            // IK-driven abdomen, never from the neck: they start where the chest ends)
            const jb = atHips ? { index: hipsId } : (chestId >= 0 ? { index: chestId } : sk.nearest(bj[0], bj[1], (b) => b.role === 'trunk' && b.layer === rootLayer.name && !b.ikDriven && b.kind !== 'pivot'))
            const tag = part === 'arm' ? 'shoulder' : (atHips ? 'hip' : 'shoulder')
            parentBone = sk.add(`${tag}_${base}`, jb.index, bj[0], bj[1], rx, ry, { kind: 'bone', layer: rootLayer.name, role: 'connector' })
          }
        }
        let chainParent = parentBone
        if (rootC.bridge) chainParent = sk.add(namer(), parentBone, rx, ry, rootC.wx, rootC.wy, meta)
        let flowDone = false
        if (role === 'strand' && part === 'hair' && o.hairFlow !== false) {
          // hair: chains along the painted locks (see hairFlowLines); the medial axis only
          // when the texture does not carry the layer
          const hb = headId >= 0 ? sk.bones[headId] : null
          const fwW = faceBox ? faceBox[2] - faceBox[0] : 0, fhW = faceBox ? faceBox[3] - faceBox[1] : 0
          // the scalp cap: above the hairline (the face layer's top plus a small margin)
          // and no wider than the face plus half a face each side
          let capFn = null
          if (head && faceBox) {
            const capY = worldOf(head, 0, faceBox[1])[1] + (o.hairlineMargin === undefined ? 0.05 : o.hairlineMargin) * fhW
            const fL = worldOf(head, faceBox[0], 0)[0] - 0.5 * fwW, fR = worldOf(head, faceBox[2], 0)[0] + 0.5 * fwW
            capFn = (wx, wy) => wy > capY && wx > fL && wx < fR
          }
          const behindHair = !!(head && (l.drawIndex || 0) < (head.drawIndex || 0))
          // a broad fall of hair behind the head moves in a few sweeps from the crown (the
          // template's hair_back: three chains over a 250-px fall), not lock by lock — its
          // inside is painted soft, the strokes are at the outline; bands of the mask, one
          // chain each, like a skirt's strips, one band per 0.9 face widths of the core
          if (behindHair && fwW > 0) {
            // the full silhouette: the sweeps start at the crown and run behind the face
            // (the template animates the hidden part too), minus the scalp cap
            const a = l.analysisFull || l.analysis, sc = a.scale
            const M = new Uint8Array(a.mask)
            if (capFn) for (let y = 0; y < a.hs; y++) for (let x = 0; x < a.ws; x++) { if (!M[y * a.ws + x]) continue; const [wx, wy] = worldOf(l, (x - 1 + 0.5) / sc, (y - 1 + 0.5) / sc); if (capFn(wx, wy)) M[y * a.ws + x] = 0 }
            const colN = new Float64Array(a.ws); let area = 0; const rowsSeen = new Set()
            for (let y = 0; y < a.hs; y++) for (let x = 0; x < a.ws; x++) if (M[y * a.ws + x]) { colN[x]++; area++; rowsSeen.add(y) }
            const bw = (a.bbox[2] - a.bbox[0]) * sc, bh = (a.bbox[3] - a.bbox[1]) * sc
            const fill = area / Math.max(1, bw * bh), rowW = area / Math.max(1, rowsSeen.size) / sc
            let acc = 0, x10 = -1, x90 = -1
            for (let x = 0; x < a.ws; x++) { acc += colN[x]; if (x10 < 0 && acc >= 0.1 * area) x10 = x; if (x90 < 0 && acc >= 0.9 * area) x90 = x }
            const coreW = (x90 - x10) / sc
            if (o.debug) console.log(`[autobones] hair behind ${l.name}: bbox ${Math.round(bw / sc)}×${Math.round(bh / sc)} fill ${fill.toFixed(2)} rowW ${rowW.toFixed(0)} core ${coreW.toFixed(0)} (face ${fwW})`)
            if (bh >= 0.9 * bw && fill >= 0.2 && rowW >= 1.2 * fwW) {
              const k = Math.max(2, Math.min(4, Math.round(coreW / (1.1 * fwW))))
              const sweeps = clothStrips(l, chainParent, namer, meta, { k, range: [x10, x90], analysis: a, mask: M, strandLenOf: (L) => Math.max(0.2 * fhW, Math.min(0.8 * fhW, 0.2 * L)) })
              if (sweeps) { flowDone = true; plan.layers[l.name] = Object.assign(plan.layers[l.name] || {}, { sweeps }) }
            }
          }
          if (behindHair && !flowDone && fwW > 0) {
            // a lock behind the head that is not a broad fall: ONE chain along its trunk
            // (the heaviest medial-axis path), as the template rigs its flying locks (fa2:
            // nine bones, one chain) — the flow tracer is for front hair, where the locks
            // are drawn one by one; here it broke the lock into pieces at its loops
            if (o.loops !== false) collapseLoops(g)
            const tp = trunkPath(g)
            if (tp) {
              const pl = pathPolyline(l, g, tp.start, tp.edges)
              let poly = pl.poly, radii = pl.radii
              const d0 = Math.hypot(poly[0] - rootC.wx, poly[1] - rootC.wy), d1 = Math.hypot(poly[poly.length - 2] - rootC.wx, poly[poly.length - 1] - rootC.wy)
              if (d1 < d0) { poly = reversePts(poly); radii = radii.slice().reverse() }
              const Lw = polyLen(poly)
              if (Lw >= o.boneMin) {
                const strandLen = Math.max(0.2 * fhW, Math.min(0.8 * fhW, 0.2 * Lw))
                const pts = cutPolyline(poly, radii, 'strand', Object.assign({}, o, { strandLen }))
                const ids = chainAlong(sk, pts, chainParent, namer, meta)
                if (ids.length) { flowDone = true; plan.layers[l.name] = Object.assign(plan.layers[l.name] || {}, { trunk: 1 }) }
              }
            }
          }
          const lines = flowDone ? null : hairFlowLines(l, o, { behind: behindHair, faceW: fwW, faceH: fhW, worldOf: (px, py) => worldOf(l, px, py), crown: hb ? [hb.bx, hb.by] : null, cap: capFn })
          if (lines && lines.length) {
            const made = []
            for (const ln of lines) {
              let poly = [], radii = ln.radii.slice()
              for (let i = 0; i < ln.poly.length; i += 2) { const [wx, wy] = worldOf(l, ln.poly[i], ln.poly[i + 1]); poly.push(wx, wy) }
              // the tracer rooted the line at the end nearer the crown; without a head bone
              // the higher end is the root
              if (!hb && poly[poly.length - 1] > poly[1]) { poly = reversePts(poly); radii = radii.reverse() }
              // parent: the head when the root is on it; else the nearest end of a chain
              // already made (this layer first, then other hair), else the layer's parent
              let par2 = parentBone
              const rx2 = poly[0], ry2 = poly[1]
              let tip = -1, td = Infinity
              for (const id of made) { const b = sk.bones[id]; const d = Math.hypot(b.bx - rx2, b.by - ry2); if (d < td) { td = d; tip = id } }
              if (tip >= 0 && td <= Math.max(30, 0.6 * sk.bones[tip].len)) par2 = tip
              else if (hb && segDist(rx2, ry2, hb.ax, hb.ay, hb.bx, hb.by) > 1.2 * hb.len) {
                const near = sk.nearest(rx2, ry2, (b) => realBone(b) && b.layer !== l.name && partOfLayer.get(b.layer) === 'hair')
                if (near.index >= 0 && near.dist <= Math.max(40, 3 * l.rMean)) par2 = near.index
              }
              const rM = radii.reduce((p, q) => p + q, 0) / Math.max(1, radii.length)
              // the template's hair bones: about a fifth of the lock (five-ish bones per lock),
              // never shorter than a fifth of the face nor longer than 0.6 of it (a.json: front
              // locks 20–40 px, back sweeps 70–110 px on a 111-px face)
              const Lw = polyLen(poly)
              // (front locks are animated finely — the template's longest fringe bone is 35 px
              // on a 111-px face; a fall behind the head moves in 70–110-px bones)
              const strandLen = fhW > 0 ? Math.max(0.2 * fhW, Math.min((behindHair ? 0.8 : 0.3) * fhW, 0.2 * Lw)) : strandBoneLen(Lw, rM, 'hair')
              const pts = cutPolyline(poly, radii, 'strand', Object.assign({}, o, { strandLen }))
              const ids = chainAlong(sk, pts, par2, namer, meta)
              if (ids.length && par2 === tip) { const b = sk.bones[ids[0]]; const tb = sk.bones[tip]; b.ax = tb.bx; b.ay = tb.by; b.len = Math.hypot(b.bx - b.ax, b.by - b.ay) }
              for (const id of ids) made.push(id)
            }
            // a lock traced in two pieces (the later line stopped short of the earlier one's
            // end, or was traced first): a chain root near another chain's bone tip
            // continues that chain whatever the order the lines came in
            for (const id of made) {
              const b = sk.bones[id]
              if (made.includes(b.parent)) continue
              let tip = -1, td = Infinity
              for (const k of made) { if (k === id) continue; const t = sk.bones[k]; const d = Math.hypot(t.bx - b.ax, t.by - b.ay); if (d < td) { td = d; tip = k } }
              if (tip < 0 || td > Math.max(30, 0.6 * sk.bones[tip].len)) continue
              let q = tip, loop = false
              while (q >= 0 && made.includes(q)) { if (q === id) { loop = true; break } q = sk.bones[q].parent }
              if (loop) continue
              const t = sk.bones[tip]
              b.parent = tip; b.ax = t.bx; b.ay = t.by; b.len = Math.hypot(b.bx - b.ax, b.by - b.ay)
            }
            if (made.length) { flowDone = true; plan.layers[l.name] = Object.assign(plan.layers[l.name] || {}, { flow: lines.length }) }
          }
        }
        // only a hanging cloth panel (named, taller than wide) is cut into strips; a
        // diagonal tail or neck keeps its axis
        // (a broad panel only — a long thin sash or ribbon (elongation > 16) is one chain
        // however it drapes; the template's skirt (7.9) and bu2 (13.6) are strips, its bu3 /
        // bu1 (22–23) and the sash are single chains)
        const strips = !flowDone && role === 'strand' && part === 'cloth' && l.elong <= 16 && (l.analysis.bbox[3] - l.analysis.bbox[1]) >= 0.8 * (l.analysis.bbox[2] - l.analysis.bbox[0]) ? clothStrips(l, chainParent, namer, meta) : 0
        if (strips) plan.layers[l.name] = Object.assign(plan.layers[l.name] || {}, { strips })
        const seen = new Set()
        if (role === 'limb' && g.nodes[rootC.n].deg >= 2) {
          // a limb rooted at a fork (a split axis point, the pelvis blob's centre): the
          // chain follows the longest branch; short side branches at the root are mass the
          // layer shares with the body, not limb parts
          const reach = g.nodes[rootC.n].edges.map((ei) => subtreeInfo(g, l, rootC.n, ei, new Set()).maxLen)
          const longest = Math.max(...reach)
          g.nodes[rootC.n].edges.forEach((ei, i) => { if (reach[i] < 0.5 * longest) seen.add(ei) })
        }
        let cutRole = role === 'limb' ? 'segment' : role
        if (role === 'extremity' && continues >= 0) {
          // the host's main chain: one bone → this layer's first run is its lower segment
          let n = 0, k = continues
          while (k >= 0 && sk.bones[k].layer === sk.bones[continues].layer && sk.bones[k].kind === 'bone') { n++; k = sk.bones[k].parent }
          if (n === 1) cutRole = 'segment'
        }
        if (role === 'strand' && o.loops !== false && !flowDone) collapseLoops(g)
        let oL = o
        if (role === 'strand') {
          // about seven bones along a strand, 30–130 px each: a thin ribbon is not cut
          // into 14-px pieces, a long one not into two
          // (side-wisp pruning stays available as branchKeep; off by default — measured on
          // 伽夜 / 锦瑟 it dropped real front locks and never reduced the long fall)
          const longest = Math.max(0, ...g.nodes[rootC.n].edges.map((ei) => subtreeInfo(g, l, rootC.n, ei, new Set()).maxLen))
          oL = Object.assign({}, o, { strandLenOf: (L, r) => strandBoneLen(L, r, part === 'accessory' ? 'hair' : part), branchKeep: o.branchKeep === undefined ? 0 : o.branchKeep, stubMin: 0.6 * strandBoneLen(longest, l.rMean, part === 'accessory' ? 'hair' : part) })
        }
        if (!strips && !flowDone) growBranches(sk, l, g, rootC.n, -1, chainParent, cutRole, namer, meta, oL, 0, seen)
        const snapTo = continues >= 0 ? continues : snapTip
        if (snapTo >= 0) {
          // the shin starts at the thigh's tip, the hand at the wrist, a branching lock at
          // the fall's bone end: no gap at the joint
          const tb = sk.bones[snapTo]
          const first = sk.bones.findIndex((b, i) => i >= created && b.layer === l.name && b.kind === 'bone' && b.parent === snapTo)
          if (first >= 0) { const b = sk.bones[first]; b.ax = tb.bx; b.ay = tb.by; b.len = Math.hypot(b.bx - b.ax, b.by - b.ay) }
        }
        if (!strips && !flowDone && role === 'strand') {
          // the other pieces of the layer (a second earring, separate locks) each hang
          // from their own highest node, on the same parent
          for (const comp of graphComponents(g)) {
            if ([...comp.edges].every((ei) => seen.has(ei))) continue
            if (comp.len < o.boneMin) { for (const ei of comp.edges) seen.add(ei); continue }
            let best = -1, bestY = -Infinity
            for (const n of comp.nodes) { const [, wy] = worldOf(l, g.nodes[n].x, g.nodes[n].y); if (wy > bestY) { bestY = wy; best = n } }
            // a piece starting where a chain of this layer ends continues that chain
            const [px, py] = worldOf(l, g.nodes[best].x, g.nodes[best].y)
            let pieceParent = parentBone, tipId = -1, td = Infinity
            for (let i = created; i < sk.bones.length; i++) { const b = sk.bones[i]; if (b.layer !== l.name || b.kind !== 'bone') continue; const d = Math.hypot(b.bx - px, b.by - py); if (d < td) { td = d; tipId = i } }
            if (o.debug === l.name) console.log(`[auto-bones] ${l.name} piece top (${px.toFixed(0)},${py.toFixed(0)}) len ${comp.len.toFixed(0)} nearest tip ${tipId >= 0 ? sk.bones[tipId].name : '-'} @ ${td.toFixed(0)} (limit ${tipId >= 0 ? Math.max(40, 0.6 * sk.bones[tipId].len).toFixed(0) : '-'})`)
            if (tipId >= 0 && td <= Math.max(40, 0.6 * sk.bones[tipId].len)) pieceParent = tipId
            const before = sk.bones.length
            growBranches(sk, l, g, best, -1, pieceParent, cutRole, namer, meta, oL, 0, seen)
            if (pieceParent === tipId && sk.bones.length > before) { const b = sk.bones[before]; const tb = sk.bones[tipId]; if (b.parent === tipId) { b.ax = tb.bx; b.ay = tb.by; b.len = Math.hypot(b.bx - b.ax, b.by - b.ay) } }
            for (const ei of comp.edges) seen.add(ei)
          }
        }
        if (role === 'limb') {
          // the mechanism is built after every layer is placed: a forearm / shin layer may
          // continue this one and then shares its IK pair
          const mine = sk.bones.map((b, i) => (i >= created && b.layer === l.name && b.kind === 'bone' ? i : -1)).filter((i) => i >= 0)
          if (mine.length) {
            let tip = mine[0]
            for (;;) { const ks = childrenOf(tip).filter((k) => sk.bones[k].layer === l.name); if (!ks.length) break; let best = ks[0], bd = -1; for (const k of ks) { const d = descent(k); if (d > bd) { bd = d; best = k } } tip = best }
            l.limbTip = tip
            limbJobs.push({ l, created, parentBone, rootC, part, base, namer, meta, continues })
          }
        } else if (role === 'extremity') {
          // a hand or foot hangs from the limb's end target when its parent is the lower bone
          const first = sk.bones.findIndex((b, i) => i >= created && b.layer === l.name)
          if (first >= 0 && endTargetOf.has(sk.bones[first].parent)) sk.bones[first].parent = endTargetOf.get(sk.bones[first].parent)
        } else if (role === 'strand' && sk.bones[parentBone].role === 'limb' && o.rigStyle === 'artist') {
          // a ribbon tied to an arm hangs by gravity: it does not inherit the arm's rotation
          const first = sk.bones.findIndex((b, i) => i >= created && b.layer === l.name)
          if (first >= 0) sk.bones[first].inherit = 'noRotationOrReflection'
        }
      }
      const first = sk.bones.findIndex((b, i) => i >= created && b.layer === l.name)
      l.rootBone = first >= 0 ? first : parentBone
      l.done = true
      plan.layers[l.name] = Object.assign({ role, part, parent: sk.bones[parentBone].layer, parentBone: sk.bones[parentBone].name, parentWhy: why, root: [Math.round(rx), Math.round(ry)], rootWhy: continues >= 0 ? 'continues-limb' : (rootC.bridge ? 'overlap-bridge' : (hanging ? 'highest-touching' : (rootC.pref > 0 ? 'preferred' : (rootC.touchTrunk ? 'touches-trunk' : (rootC.depth > 0 ? 'inside-treed' : 'nearest-bone'))))), bones: sk.bones.slice(created).map((b) => b.name), elong: +l.elong.toFixed(2), width: +(2 * l.rMean).toFixed(1), leaves: l.leaves }, plan.layers[l.name] && plan.layers[l.name].strips ? { strips: plan.layers[l.name].strips } : {}, plan.layers[l.name] && plan.layers[l.name].flow ? { flow: plan.layers[l.name].flow, rootWhy: 'flow' } : {}, plan.layers[l.name] && plan.layers[l.name].sweeps ? { sweeps: plan.layers[l.name].sweeps, rootWhy: 'sweeps' } : {}, plan.layers[l.name] && plan.layers[l.name].trunk ? { trunk: 1, rootWhy: 'trunk' } : {})
    }
    /** The mechanism of one limb layer, once every layer is placed. */
    function runLimbJob(job) {
      const { l, created, part, base, namer, meta, rootC, parentBone } = job
      const all = sk.bones.map((b, i) => (i >= created && b.layer === l.name && b.kind === 'bone' ? i : -1)).filter((i) => i >= 0)
      if (!all.length || consumedLower.has(all[0])) return
      // the main chain: from the first bone along the layer's own deepest children (a
      // stub at the root or a side branch is not a segment of the limb)
      const mine = [all[0]]
      for (;;) { const ks = childrenOf(mine[mine.length - 1]).filter((k) => sk.bones[k].layer === l.name); if (!ks.length) break; let best = ks[0], bd = -1; for (const k of ks) { const d = descent(k); if (d > bd) { bd = d; best = k } } mine.push(best) }
      let uId = mine[0]
      let connector = sk.bones[parentBone].role === 'connector' ? parentBone : -1
      if (part === 'arm' && o.rigStyle === 'artist' && connector >= 0 && !(job.continues >= 0)) { const moved = toShoulderLine(uId, connector); if (moved) { rootC.wx = sk.bones[uId].ax; rootC.wy = sk.bones[uId].ay; plan.layers[l.name] = Object.assign(plan.layers[l.name] || {}, { shoulder: [Math.round(moved[0]), Math.round(moved[1]), Math.round(rootC.wx), Math.round(rootC.wy)] }) } }
      const pivotParent = part === 'leg' ? hipsId : (part === 'arm' && waistPivot >= 0 ? waistPivot : (connector >= 0 ? sk.bones[connector].parent : parentBone))
      const mineLen = mine.reduce((a, i) => a + sk.bones[i].len, 0)
      const promote = o.ik && connector >= 0 && !(rootC.prefDepth > 0) && !rootC.bridge && sk.bones[connector].len >= 0.5 * mineLen
      let lower = -1, single = false
      const bendAtMiddle = (id) => {
        const b = sk.bones[id]
        const mx = (b.ax + b.bx) / 2, my = (b.ay + b.by) / 2
        const bx = b.bx, by = b.by
        b.bx = mx; b.by = my; b.len = Math.hypot(mx - b.ax, my - b.ay)
        const nb = sk.add(namer(), id, mx, my, bx, by, meta)
        // what hung from the lower half now hangs from the new lower bone
        for (const k of childrenOf(id)) { if (k === nb) continue; const c = sk.bones[k]; if (segDist(c.ax, c.ay, mx, my, bx, by) < segDist(c.ax, c.ay, b.ax, b.ay, mx, my)) c.parent = nb }
        return nb
      }
      if (mine.length === 1 && !promote) {
        // a single-bone limb layer: continued by another layer's bone at its tip (a forearm
        // under an upper arm, a shin under a thigh, a hand layer that holds the forearm)
        // that bone is the lower segment; otherwise the limb must bend at its middle
        const b = sk.bones[uId]
        for (const k of childrenOf(uId)) { const c = sk.bones[k]; if (c.layer !== l.name && (c.role === 'limb' || (c.role === 'extremity' && c.len >= 0.5 * b.len)) && (lower < 0 || c.len > sk.bones[lower].len)) lower = k }
        if (lower >= 0) consumedLower.add(lower)
        else if (endHidden([b.ax, b.ay, b.bx, b.by], l.rMean, l)) single = true
        else l.limbTip = bendAtMiddle(uId)
      } else if (mine.length >= 2 && !promote && sk.bones[mine[0]].len > 2.5 * sk.bones[mine[1]].len) {
        // a straight thigh+shin followed by the foot's corner: the long first run holds the
        // knee at its middle, the short run is the foot
        bendAtMiddle(uId)
      }
      // the chain again, now with the middle bend in it
      mine.length = 1
      for (;;) { const ks = childrenOf(mine[mine.length - 1]).filter((k) => sk.bones[k].layer === l.name); if (!ks.length) break; let best = ks[0], bd = -1; for (const k of ks) { const d = descent(k); if (d > bd) { bd = d; best = k } } mine.push(best) }
      if (mine.length >= 2 && !promote && lower < 0) {
        const U = sk.bones[mine[0]], Lb = sk.bones[mine[1]]
        const ux = U.bx - U.ax, uy = U.by - U.ay, lx = Lb.bx - Lb.ax, ly = Lb.by - Lb.ay
        const ang = Math.abs(Math.atan2(ux * ly - uy * lx, ux * lx + uy * ly))
        if (ang < 25 * Math.PI / 180) {
          // nearly straight: the joint goes to the middle of upper + lower, on the path
          const half = 0.5 * (U.len + Lb.len)
          let jx, jy
          if (half <= U.len) { const t = half / Math.max(1e-9, U.len); jx = U.ax + ux * t; jy = U.ay + uy * t }
          else { const t = (half - U.len) / Math.max(1e-9, Lb.len); jx = Lb.ax + lx * t; jy = Lb.ay + ly * t }
          U.bx = jx; U.by = jy; U.len = Math.hypot(jx - U.ax, jy - U.ay)
          Lb.ax = jx; Lb.ay = jy; Lb.len = Math.hypot(Lb.bx - jx, Lb.by - jy)
        }
      }
      if (!o.ik) return
      if (single) { singleLimb(uId, { part: part === 'leg' ? 'leg' : 'arm', name: base, side: l.hint.side, pivotParent, connector }); return }
      if (promote) {
        // the layer is a forearm / shin: the connector spans the upper segment (drawn in
        // the body layer or hidden). Keep a short stub to the shoulder / hip corner and
        // make the rest the upper bone of the IK pair; what the layer holds becomes the
        // lower bone, its remainder (the hand) hangs from the end target
        const cb = sk.bones[connector]
        const ds = Math.min(0.4 * cb.len, 1.5 * trunkRadius)
        const sx = cb.ax + (cb.bx - cb.ax) * ds / cb.len, sy = cb.ay + (cb.by - cb.ay) * ds / cb.len
        const upper = sk.add(`${base}_upper`, connector, sx, sy, cb.bx, cb.by, { kind: 'bone', layer: rootLayer.name, role: 'limb', side: l.hint.side })
        cb.bx = sx; cb.by = sy; cb.len = ds
        sk.bones[uId].parent = upper
        uId = upper
      }
      let lId = -1, bestD = -1
      for (const k of childrenOf(uId)) { const d = descent(k); if (d > bestD) { bestD = d; lId = k } }
      if (lower >= 0 && !promote) lId = lower
      mechanize(uId, { part: part === 'leg' ? 'leg' : 'arm', name: base, side: l.hint.side, pivotParent, connector, lower: promote ? -1 : lower, bendDefault: lId >= 0 ? bendFromExtremity(uId, lId) : 1 })
    }
    /**
     * A skirt or a wide cloth panel hangs as several parallel strips, one chain each,
     * rather than one axis with a fringe of branches. Strips are vertical bands of
     * ≈0.17 × character height (the studio's skirt is three of them); each band is
     * thinned on its own and its longest path becomes a chain from the top down.
     * Returns the number of strips made (0 = not a wide cloth, use the axis).
     */
    function clothStrips(l, parentBone, namer, meta, sw) {
      const a = sw && sw.analysis ? sw.analysis : l.analysis
      const M = sw && sw.mask ? sw.mask : a.mask
      const bw = a.bbox[2] - a.bbox[0]
      const stripW = 0.17 * heightAll
      const k = sw ? sw.k : Math.max(1, Math.min(4, Math.round(bw / stripW)))
      if (k < 2) return 0
      const { ws, hs, scale: sc } = a
      // sweeps (hair): bands over the core of the mask, the outer bands take the flying
      // strands beyond it
      const cellX0 = sw ? sw.range[0] : a.bbox[0] * sc + 1, cellX1 = sw ? sw.range[1] : a.bbox[2] * sc + 1
      let made = 0
      for (let i = 0; i < k; i++) {
        const x0 = cellX0 + (cellX1 - cellX0) * i / k, x1 = cellX0 + (cellX1 - cellX0) * (i + 1) / k
        const lo = sw && i === 0 ? 0 : Math.max(0, Math.floor(x0)), hi = sw && i === k - 1 ? ws : Math.min(ws, Math.ceil(x1))
        const band = new Uint8Array(ws * hs)
        let n = 0
        for (let y = 0; y < hs; y++) for (let x = lo; x < hi; x++) if (M[y * ws + x]) { band[y * ws + x] = 1; n++ }
        if (n < 20) continue
        const { graph } = skeletonizeMask(band, ws, hs, sc, o)
        if (!graph.edges.length) continue
        // a sweep of hair starts at the crown: the heaviest path from the band's topmost
        // node (a skirt strip keeps the heaviest path overall)
        let top = -1
        if (sw) for (let i = 0; i < graph.nodes.length; i++) { if (graph.nodes[i].deg > 0 && (top < 0 || graph.nodes[i].y < graph.nodes[top].y)) top = i }
        const tp = trunkPath(graph, top >= 0 ? top : undefined)
        const pl = pathPolyline(l, graph, tp.start, tp.edges)
        let poly = pl.poly, radii = pl.radii
        if (polyLen(poly) < o.boneMin) continue
        if (poly[1] < poly[poly.length - 1]) { poly = reversePts(poly); radii = radii.slice().reverse() }   // top first
        const pts = cutPolyline(poly, radii, 'strand', Object.assign({}, o, { strandLen: sw ? sw.strandLenOf(polyLen(poly)) : strandBoneLen(polyLen(poly), l.rMean) }))
        chainAlong(sk, pts, parentBone, namer, meta)
        made++
      }
      return made
    }
    function addIk(sk, b1, child, name) {
      const A = sk.bones[b1], B = sk.bones[child]
      const cross = (A.bx - A.ax) * (B.by - B.ay) - (A.by - A.ay) * (B.bx - B.ax)
      const tId = sk.add(`${name}_ik`, 0, B.bx, B.by, B.bx, B.by, { kind: 'ikTarget', layer: A.layer, role: 'ik' })
      sk.addIk({ name: sk.bones[tId].name, bones: [A.name, B.name], target: sk.bones[tId].name, bendPositive: cross >= 0 })
    }


    // ---- every other layer: biggest first among those touching the treed set, but a
    // layer waits for the parts it hangs from (a hand for its arm, hair for the head)
    const remaining = layersOk.filter((l) => !l.done)
    while (remaining.length) {
      remaining.sort((a, b) => b.analysis.area - a.analysis.area)
      const ready = (l) => {
        const waits = WAIT_FOR[l.hint.part] || []
        for (const k of remaining) if (k !== l && waits.includes(k.hint.part) && !(WAIT_FOR[k.hint.part] || []).includes(l.hint.part)) return false
        return true
      }
      let pick = remaining.find((l) => ready(l) && Array.from(l.overlap.keys()).some((k) => k.done))
      if (!pick) pick = remaining.find((l) => Array.from(l.overlap.keys()).some((k) => k.done))
      if (!pick) pick = remaining[0]
      remaining.splice(remaining.indexOf(pick), 1)
      placeLayer(pick)
    }
    // the pelvis is rigid: a leg whose root came from splitting its axis inside a pelvis
    // blob takes the height of the legs whose roots are their layer's own top
    {
      const legs = limbJobs.filter((j) => j.part === 'leg')
      const ref = legs.filter((j) => !j.rootC.split && !(j.rootC.bridge) && !(j.continues >= 0))
      const splitJobs = legs.filter((j) => j.rootC.split)
      if (ref.length && splitJobs.length) {
        const refY = ref.reduce((a, j) => a + sk.bones[sk.bones.findIndex((b, i) => i >= j.created && b.layer === j.l.name && b.kind === 'bone')].ay, 0) / ref.length
        for (const j of splitJobs) {
          const fi = sk.bones.findIndex((b, i) => i >= j.created && b.layer === j.l.name && b.kind === 'bone')
          if (fi < 0) continue
          const b = sk.bones[fi]
          const dy = b.by - b.ay
          if (Math.abs(dy) < 1e-6) continue
          const t = Math.max(-0.35, Math.min(0.5, (refY - b.ay) / dy))
          const nx = b.ax + (b.bx - b.ax) * t, ny = b.ay + dy * t
          // the connector ends where the leg now starts
          for (const c of sk.bones) if (c.role === 'connector' && Math.hypot(c.bx - b.ax, c.by - b.ay) < 1) { c.bx = nx; c.by = ny; c.len = Math.hypot(nx - c.ax, ny - c.ay) }
          b.ax = nx; b.ay = ny; b.len = Math.hypot(b.bx - nx, b.by - ny)
          if (j.rootC) { j.rootC.wx = nx; j.rootC.wy = ny }
        }
      }
    }
    for (const job of limbJobs) runLimbJob(job)
    // ---- feet, as the template rigs them: the foot bone (under the ankle target) has a
    // target of its own at the toes with a compress+stretch IK, and a toe piece hangs
    // from that target (foot_l → foot → bone10 in a.json)
    if (o.ik && o.rigStyle === 'artist') {
      for (const m of limbs) {
        if (m.part !== 'leg' || !(m.t2 >= 0) || m.t1 === m.t2) continue
        const lowerLayer = m.lower >= 0 ? sk.bones[m.lower].layer : null
        let foot = -1
        for (let i = 0; i < sk.bones.length; i++) { const b = sk.bones[i]; if (b.parent === m.t2 && b.kind === 'bone' && b.role !== 'strand' && (!lowerLayer || b.layer === lowerLayer)) { foot = i; break } }
        if (foot < 0) for (let i = 0; i < sk.bones.length; i++) { const b = sk.bones[i]; if (b.parent === m.t2 && b.kind === 'bone' && (b.role === 'limb' || b.role === 'extremity')) { foot = i; break } }
        if (foot < 0) continue
        const F = sk.bones[foot]
        // the template's foot is two bones: foot_l 92 px to the toe base, bone10 35 px of
        // toes (72 / 28). A foot that came out as one bone to the toe tip is cut there
        let toes = childrenOf(foot).find((k) => sk.bones[k].layer === F.layer && sk.bones[k].role !== 'strand')
        if (toes === undefined && F.len >= 2 * o.boneMin) {
          const jx = F.ax + (F.bx - F.ax) * 0.72, jy = F.ay + (F.by - F.ay) * 0.72
          const ex = F.bx, ey = F.by
          F.bx = jx; F.by = jy; F.len = Math.hypot(jx - F.ax, jy - F.ay)
          toes = sk.add(`${m.name}_toes`, foot, jx, jy, ex, ey, { kind: 'bone', layer: F.layer, role: F.role, side: F.side })
          for (const k of childrenOf(foot)) { if (k === toes) continue; const c = sk.bones[k]; if (segDist(c.ax, c.ay, jx, jy, ex, ey) < segDist(c.ax, c.ay, F.ax, F.ay, jx, jy)) c.parent = toes }
        }
        const t = sk.add(`${m.name}_foot`, rootId, F.bx, F.by, F.bx, F.by, { kind: 'ikTarget', layer: F.layer, role: 'ik' })
        for (const k of childrenOf(foot)) if (sk.bones[k].layer === F.layer && sk.bones[k].role !== 'strand') { sk.bones[k].parent = t; m.toes = k }
        sk.addIk({ name: `${m.name}_foot_ik`, bones: [F.name], target: sk.bones[t].name, compress: true, stretch: true, phase: 3 })
        m.foot = foot; m.footTarget = t
      }
    }
    // ---- the hips sit on the trunk axis at the height of the hip pivots (the studio's x):
    // the provisional hips were the leg layers' overlap centre, which is the middle of a
    // pelvis blob when a leg layer carries the pelvis and the middle of the thigh top when
    // it does not
    {
      const legPivots = limbs.filter((m) => m.part === 'leg' && m.pivot >= 0).map((m) => sk.bones[m.pivot])
      if (legPivots.length && poly && poly.length >= 4) {
        // the pelvis centre sits at the hip joints' height or a little above it (the
        // template: 0 px on 伽夜, ~40 on 锦瑟, ~25 on 安安): a tenth of the pivots' spacing
        const xs = legPivots.map((b) => b.ax), spacing = legPivots.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0
        const targetY = legPivots.reduce((a, b) => a + b.ay, 0) / legPivots.length + 0.1 * spacing
        let bestT = -1, bd = Infinity
        const tMin = Math.max(0, hipT - 0.1)
        for (let k = 0; k <= 200; k++) { const t = tMin + (1 - tMin) * k / 200; const q = pointAt(poly, t); const d = Math.abs(q[1] - targetY); if (d < bd) { bd = d; bestT = t } }
        let q = bestT >= 0 ? pointAt(poly, bestT) : null
        if (q && bestT <= tMin + 1e-9 && targetY < q[1] - 2) {
          // below the axis bottom: continue the first trunk segment downward (at most the
          // pivots' spacing)
          const q1 = pointAt(poly, Math.min(1, tMin + 0.15))
          const dx = q1[0] - q[0], dy = q1[1] - q[1]
          if (dy > 1e-6) { const k = Math.min(Math.max(0, (q[1] - targetY) / dy), Math.max(0, spacing) / Math.max(1e-6, dy)); q = [q[0] - dx * k, q[1] - dy * k]; bd = Math.abs(q[1] - targetY) }
        }
        const H = sk.bones[hipsId]
        if (o.debug) console.log(`[auto-bones] hips: pivots y ${legPivots.map((b) => b.ay.toFixed(0)).join(',')} target ${targetY.toFixed(0)} axis point ${q ? q.map((v) => v.toFixed(0)).join(',') : '-'} (dy ${bd.toFixed(0)}) old (${H.ax.toFixed(0)},${H.ay.toFixed(0)}) hipT ${hipT.toFixed(2)}`)
        if (q && bd < 60 && Math.hypot(q[0] - H.ax, q[1] - H.ay) > 2) {
          const ox = H.ax, oy = H.ay
          const moveStart = (b) => { b.ax = q[0]; b.ay = q[1]; b.len = Math.hypot(b.bx - b.ax, b.by - b.ay) }
          for (const b of sk.bones) {
            if (b === H) continue
            if (b.parent === hipsId && Math.hypot(b.ax - ox, b.ay - oy) < 1 && b.kind === 'bone') moveStart(b)
            else if (b.parent === hipsId && b.kind === 'pivot' && b.role === 'mech' && Math.hypot(b.ax - ox, b.ay - oy) < 1) { b.ax = b.bx = q[0]; b.ay = b.by = q[1] }
          }
          H.ax = H.bx = q[0]; H.ay = H.by = q[1]
          plan.hipsMoved = [Math.round(ox), Math.round(oy), Math.round(q[0]), Math.round(q[1])]
        }
      }
    }

    // ---- the studio's turn sliders, pivot couplings and face controllers
    if (o.rigStyle === 'artist') {
      let x0 = Infinity, x1 = -Infinity
      for (const l of layersOk) { x0 = Math.min(x0, worldOf(l, l.analysis.bbox[0], 0)[0]); x1 = Math.max(x1, worldOf(l, l.analysis.bbox[2], 0)[0]) }
      const cw = Math.max(1, x1 - x0)
      const nmOf = (i) => sk.bones[i].name
      let bodyUp = -1, bodyDown = -1, faceTurn = -1, faceTurnBack = -1
      if (o.sliders) {
        // whole-layer parallax handles outside the silhouette: one at chest height, one at the legs
        // the template (a.json): body_up_turn sits on the image's left beside the chest's
        // base, three trunk radii past the body's edge; body_down_turn beside the knees,
        // four radii out and a tenth of the thigh below the knee height
        const bodyLeft = worldOf(rootLayer, rootLayer.analysis.bbox[0], 0)[0]
        const chestB = sk.bones.find((b) => b.name === 'chest')
        const upY = chestB ? chestB.ay + 0.06 * chestB.len : pointAt(poly, hipT + 0.6 * (neckT - hipT))[1]
        const kneeYs = limbs.filter((m) => m.part === 'leg' && m.t1 >= 0 && m.t1 !== m.t2).map((m) => sk.bones[m.t1].ay)
        const kneesBelow = kneeYs.filter((y) => y < hipsY)
        const kneeY = (kneesBelow.length ? kneesBelow : kneeYs).length ? (kneesBelow.length ? kneesBelow : kneeYs).reduce((a, b) => a + b, 0) / (kneesBelow.length ? kneesBelow : kneeYs).length : hipsY - 0.35 * Math.max(1, hipsY - groundAll)
        const downY = kneeY - 0.1 * Math.max(0, hipsY - kneeY)
        bodyUp = sk.add('body_up_turn', rootId, bodyLeft - 3 * trunkRadius, upY, bodyLeft - 3 * trunkRadius, upY, { kind: 'slider', layer: rootLayer.name, role: 'slider' })
        bodyDown = sk.add('body_down_turn', rootId, bodyLeft - 4 * trunkRadius, downY, bodyLeft - 4 * trunkRadius, downY, { kind: 'slider', layer: rootLayer.name, role: 'slider' })
        if (headId >= 0) {
          const hb = sk.bones[headId]
          const fc = head ? worldOf(head, (head.analysis.bbox[0] + head.analysis.bbox[2]) / 2, (head.analysis.bbox[1] + head.analysis.bbox[3]) / 2) : [(hb.ax + hb.bx) / 2, (hb.ay + hb.by) / 2]
          faceTurn = sk.add('face_turn', headId, fc[0], fc[1], fc[0], fc[1], { kind: 'slider', layer: head ? head.name : rootLayer.name, role: 'slider' })
          // the back-face handle mirrors the face handle: the template puts it one face
          // width to the image's left of the nose, a little lower (face_turn (0,475) →
          // face_turn_back (-115,466) on a 103-px face)
          const fw = faceBox ? faceBox[2] - faceBox[0] : 0.6 * hb.len, fh = faceBox ? faceBox[3] - faceBox[1] : hb.len
          const bc = [fc[0] - 1.1 * fw, fc[1] - 0.08 * fh]
          faceTurnBack = sk.add('face_turn_back', headId, bc[0], bc[1], bc[0], bc[1], { kind: 'slider', layer: head ? head.name : rootLayer.name, role: 'slider' })
          sk.addTc({ name: 'face_turn_back_follow', bones: ['face_turn_back'], target: 'face_turn', rotateMix: 0, translateMix: -1, scaleMix: 0, shearMix: 0, phase: 4 })
          // hair chain roots carry an inert (mix 0) link to the face handle, keyed by the
          // animator — the template does it for the front locks AND the back sweeps (f1–f4)
          for (const l of layersOk) {
            if (l.hint.part !== 'hair' || !head) continue
            const roots = sk.bones.filter((b) => b.layer === l.name && b.kind === 'bone' && sk.bones[b.parent] && sk.bones[b.parent].layer !== l.name)
            for (const r of roots) sk.addTc({ name: `${r.name}_turn`, bones: [r.name], target: 'face_turn', rotateMix: 0, translateMix: 0, scaleMix: 0, shearMix: 0, phase: 4 })
          }
        }
        // breasts, as the template rigs them: the bra's two cups (bra_l / bra_r under the
        // chest) follow the up-turn handle at 0.1 / 0.2, and breast_l / breast_r sit on the
        // body a fifth of the chest above the cups, a little toward the axis, with an inert
        // link (all mixes 0) the animator keys; a breast layer's own controllers are the
        // breasts when there is no bra
        {
          const chestB = sk.bones.findIndex((b) => b.name === 'chest' && b.role === 'trunk')
          const bras = sk.bones.map((b, i) => (b.kind === 'controller' && b.role === 'bra' ? i : -1)).filter((i) => i >= 0).sort((p, q) => sk.bones[q].ax - sk.bones[p].ax)
          const breastLayer = sk.bones.map((b, i) => (b.kind === 'controller' && partOfLayer.get(b.layer) === 'breast' ? i : -1)).filter((i) => i >= 0)
          const breasts = breastLayer.slice()
          if (bras.length === 2 && chestB >= 0 && !breastLayer.length) {
            const C = sk.bones[chestB]
            const dx = (C.bx - C.ax) / Math.max(1e-6, C.len), dy = (C.by - C.ay) / Math.max(1e-6, C.len), nx = -dy, ny = dx
            bras.forEach((i, k) => {
              const b = sk.bones[i]
              const lat = (b.ax - C.ax) * nx + (b.ay - C.ay) * ny
              const px = b.ax + dx * 0.2 * C.len - Math.sign(lat) * nx * 0.05 * C.len, py = b.ay + dy * 0.2 * C.len - Math.sign(lat) * ny * 0.05 * C.len
              breasts.push(sk.add(k === 0 ? 'breast_r' : 'breast_l', chestB, px, py, px, py, { kind: 'controller', layer: rootLayer.name, role: 'breast' }))
            })
          }
          if (bodyUp >= 0) {
            for (const i of breasts) sk.addTc({ name: `${nmOf(i)}_turn`, bones: [nmOf(i)], target: 'body_up_turn', rotateMix: 0, translateMix: 0, scaleMix: 0, shearMix: 0, phase: 4 })
            bras.forEach((i, k) => sk.addTc({ name: `${nmOf(i)}_turn`, bones: [nmOf(i)], target: 'body_up_turn', rotateMix: 0, translateMix: k === 0 ? 0.2 : 0.1, scaleMix: 0, shearMix: 0, phase: 4 }))
          }
        }
      }
      // paired limbs: the pivot on the image's right takes the slider, the left one mirrors it
      for (const part of ['leg', 'arm']) {
        const ps = limbs.filter((m) => m.part === part).sort((a, b) => b.x - a.x)
        if (!ps.length) continue
        const right = ps[0]
        const slider = part === 'leg' ? bodyDown : bodyUp
        if (slider >= 0) sk.addTc({ name: `${nmOf(right.pivot)}_turn`, bones: [nmOf(right.pivot)], target: nmOf(slider), rotateMix: 0, translateMix: part === 'leg' ? 0.05 : 0.1, scaleMix: 0, shearMix: 0, phase: 0 })
        if (ps.length >= 2) sk.addTc({ name: `${nmOf(ps[1].pivot)}_couple`, bones: [nmOf(ps[1].pivot)], target: nmOf(right.pivot), rotateMix: 0, translateMix: -0.5, scaleMix: 0, shearMix: 0, phase: 1 })
      }
      // eyes and mouth from the face image
      if (faceDet && headId >= 0) {
        const det = faceDet
        plan.face = det ? det.summary : null
        if (det) {
          const add = (name, px, py) => { const [wx, wy] = worldOf(head, px, py); return sk.add(name, headId, wx, wy, wx, wy, { kind: 'controller', layer: head.name, role: 'face' }) }
          const eyeNames = det.eyes.length === 2 ? ['eyes_l', 'eyes_r'] : ['eyes']
          det.eyes.forEach((e, i) => {
            const up = add(`${eyeNames[i]}_up`, e.top[0], e.top[1]), down = add(`${eyeNames[i]}_down`, e.bottom[0], e.bottom[1])
            // the lower lid moves against the upper lid (a blink closes from both sides)
            sk.addTc({ name: `${nmOf(down)}_blink`, bones: [nmOf(down)], target: nmOf(up), rotateMix: 0, translateMix: -0.3, scaleMix: 0, shearMix: 0, phase: 4 })
            if (faceTurn >= 0) {
              sk.addTc({ name: `${nmOf(up)}_turn`, bones: [nmOf(up)], target: 'face_turn', rotateMix: 0, translateMix: 0, scaleMix: 0, shearMix: 0, phase: 4 })
              sk.addTc({ name: `${nmOf(down)}_turn`, bones: [nmOf(down)], target: 'face_turn', rotateMix: 0, translateMix: eyeNames[i] === 'eyes_r' ? 0.26 : 0.15, scaleMix: 0, shearMix: 0, phase: 4 })
            }
          })
          if (det.mouth) {
            const m = det.mouth
            const ids = { up: add('mouth_up', m.up[0], m.up[1]), down: add('mouth_down', m.down[0], m.down[1]), l: add('mouth_l', m.l[0], m.l[1]), r: add('mouth_r', m.r[0], m.r[1]) }
            if (faceTurn >= 0) for (const [k, mix] of [['up', 0.26], ['down', 0], ['l', 0.2], ['r', 0.36]]) sk.addTc({ name: `${nmOf(ids[k])}_turn`, bones: [nmOf(ids[k])], target: 'face_turn', rotateMix: 0, translateMix: mix, scaleMix: 0, shearMix: 0, phase: 4 })
          }
          if (faceTurn >= 0 && det.nose) {
            const [wx, wy] = worldOf(head, det.nose[0], det.nose[1]); const ft = sk.bones[faceTurn]; ft.ax = ft.bx = wx; ft.ay = ft.by = wy
            // the back-face handle follows the nose: one face width to the image's left, a little lower
            if (faceTurnBack >= 0 && faceBox) { const fw = faceBox[2] - faceBox[0], fh = faceBox[3] - faceBox[1]; const fb = sk.bones[faceTurnBack]; fb.ax = fb.bx = wx - 1.1 * fw; fb.ay = fb.by = wy - 0.08 * fh }
          }
        }
      }
    }
    if (o.templateNames !== false) { templateNames(sk, limbs, hipsId, rootId, plan, partOfLayer); templateConstraints(sk, partOfLayer) }
    for (const l of L) {
      if (l.done || l.rootBone !== undefined || (plan.backdrops || []).includes(l.name)) continue
      const bb = l.analysis ? l.analysis.bbox : [0, 0, l.width, l.height]
      const [cx, cy] = worldOf(l, (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)
      const par = sk.nearest(cx, cy, (b) => b.kind === 'bone')
      const nm = String(l.name).replace(/[^A-Za-z0-9_]/g, '_') + '_free'
      const id = sk.add(nm, par.index >= 0 ? par.index : rootId, cx, cy, cx, cy, { kind: 'bone', layer: l.name, role: 'plate' })
      l.rootBone = id; l.done = true
      plan.layers[l.name] = { role: 'plate', part: l.hint ? l.hint.part : null, parentBone: par.index >= 0 ? sk.bones[par.index].name : 'root', parentWhy: 'free-piece', bones: [nm] }
    }
    const done = finish(sk, L, plan)
    done.face = head ? { layer: head.name, det: faceDet, img: head.faceImg || null, place: head.place, width: head.width, height: head.height } : null
    return done
  }

  /**
   * The studio template's names (骨骼蒙版模板/a.json) on the structure we built: root → y →
   * x (hips) → hip_r / hip_l → kua1 / kua2 (hip pivots) → leg_r / lowerLeg_r / foot_r with
   * the knee and ankle targets leg1 / leg2 (leg3 / leg4 on the left) and the helper chain
   * kua3 / kua4 (kua5 / kua6); chest → shoulder_r / shoulder_l → jian1 / jian2 →
   * Upper_arm_r / forearm_r / hand_r with arm1 / arm2 (arm3 / arm4) and jian3 / jian4
   * (jian5 / jian6); breast_r / breast_l. Sides are IMAGE sides (world x), as in the
   * template (its Upper_arm_r deforms the layer called arm_l). A third limb of a kind keeps
   * its layer-based name. Hair, cloth and accessories keep their layer-based names — the
   * template numbers those.
   */
  function templateNames(sk, limbs, hipsId, rootId, plan, partOfLayer) {
    const ren = new Map()
    // names before any renaming (unique), so references resolve to the FINAL name in one step
    const origNames = sk.bones.map((b) => b.name)
    const taken = new Set(sk.bones.map((b) => b.name))
    const setName = (i, nm) => {
      if (!(i >= 0) || !sk.bones[i]) return
      const b = sk.bones[i]
      if (b.name === nm) return
      let use = nm, k = 2
      while (taken.has(use) && sk.bones.findIndex((x) => x.name === use) !== i) use = `${nm}_${k++}`
      taken.delete(b.name); taken.add(use)
      ren.set(b.name, use); b.name = use
    }
    // the hips: x under a root-level y at the same spot
    const H = sk.bones[hipsId]
    setName(hipsId, 'x')
    if (!sk.bones.some((b) => b.name === 'y')) {
      const yId = sk.add('y', rootId, H.ax, H.ay, H.ax, H.ay, { kind: 'pivot', layer: H.layer, role: 'trunk' })
      H.parent = yId
      taken.add('y')
    }
    const childBone = (id, sameLayer) => { for (let i = 0; i < sk.bones.length; i++) { const b = sk.bones[i]; if (b.parent === id && b.kind === 'bone' && (!sameLayer || b.layer === sameLayer)) return i } return -1 }
    for (const part of ['leg', 'arm']) {
      const recs = limbs.filter((m) => m.part === part && m.pivot >= 0).sort((a, b) => b.x - a.x)
      recs.forEach((m, i) => {
        if (i > 1) return
        const T = part === 'leg'
          ? { pivot: ['kua1', 'kua2'], helper: [['kua3', 'kua4'], ['kua5', 'kua6']], t: [['leg1', 'leg2'], ['leg3', 'leg4']], upper: ['leg_r', 'leg_l'], lower: ['lowerLeg_r', 'lowerLeg_l'], ext: ['foot_r', 'foot_l'], conn: ['hip_r', 'hip_l'] }
          : { pivot: ['jian1', 'jian2'], helper: [['jian3', 'jian4'], ['jian5', 'jian6']], t: [['arm1', 'arm2'], ['arm3', 'arm4']], upper: ['Upper_arm_r', 'Upper_arm_l'], lower: ['forearm_r', 'forearm_l'], ext: ['hand_r', 'hand_l'], conn: ['shoulder_r', 'shoulder_l'] }
        setName(m.pivot, T.pivot[i])
        if (m.connector >= 0) setName(m.connector, T.conn[i])
        if (m.upper >= 0) setName(m.upper, T.upper[i])
        if (m.lower >= 0) setName(m.lower, T.lower[i])
        if (m.helpers && m.helpers.length === 2) { setName(m.helpers[0], T.helper[i][0]); setName(m.helpers[1], T.helper[i][1]) }
        if (m.t1 >= 0) setName(m.t1, T.t[i][0])
        if (m.t2 >= 0 && m.t2 !== m.t1) setName(m.t2, T.t[i][1])
        // the foot / hand: what hangs from the end target (the lower bone's own chain first)
        const lowerLayer = m.lower >= 0 ? sk.bones[m.lower].layer : null
        let ext = m.foot >= 0 ? m.foot : -1
        if (ext < 0 && m.t2 >= 0) {
          // the hand is the longer branch at the wrist (hand + fingers, the template's
          // hand_r → bone19 → bone20); the short one is the thumb
          const desc = (id) => { let best = 0; for (let k = 0; k < sk.bones.length; k++) if (sk.bones[k].parent === id && sk.bones[k].kind === 'bone') best = Math.max(best, sk.bones[k].len + desc(k)); return best }
          // among the arm layer's own bones at the wrist first (another layer's chain that
          // hangs from the wrist — a held fan, a raised hand layer — keeps its own name)
          const cands = [], own = []
          for (let k = 0; k < sk.bones.length; k++) { const b = sk.bones[k]; if (b.parent !== m.t2 || b.kind !== 'bone' || b.role === 'strand') continue; cands.push(k); if (lowerLayer && b.layer === lowerLayer) own.push(k) }
          let bestD = -Infinity
          for (const k of (own.length ? own : cands)) { const d = sk.bones[k].len + desc(k); if (d > bestD) { bestD = d; ext = k } }
        }
        if (ext < 0 && m.t2 >= 0) ext = childBone(m.t2, lowerLayer)
        if (ext < 0 && m.t2 >= 0) ext = childBone(m.t2, null)
        if (ext >= 0 && sk.bones[ext].role !== 'strand') setName(ext, T.ext[i])
        // the template's toe target is 'foot' on the left foot; the right one is numbered
        if (part === 'leg' && m.footTarget >= 0) setName(m.footTarget, i === 1 ? 'foot' : 'foot2')
        if (part === 'leg' && m.toes >= 0) setName(m.toes, i === 0 ? 'toes_r' : 'toes_l')
      })
    }
    // breasts and the bra
    const breasts = sk.bones.map((b, i) => (b.kind === 'controller' && partOfLayer.get(b.layer) === 'breast' ? i : -1)).filter((i) => i >= 0).sort((a, b) => sk.bones[b].ax - sk.bones[a].ax)
    if (breasts.length === 2) { setName(breasts[0], 'breast_r'); setName(breasts[1], 'breast_l') }
    const bras = sk.bones.map((b, i) => (b.kind === 'controller' && b.role === 'bra' ? i : -1)).filter((i) => i >= 0).sort((a, b) => sk.bones[b].ax - sk.bones[a].ax)
    if (bras.length === 2) { setName(bras[0], 'bra_r'); setName(bras[1], 'bra_l') }
    else if (bras.length === 1) setName(bras[0], 'bra')
    // constraints, the plan and the name index follow the renaming
    if (ren.size) {
      const finalOf = new Map(origNames.map((o, i) => [o, sk.bones[i].name]))
      const map = (n) => (finalOf.has(n) ? finalOf.get(n) : n)
      for (const c of sk.ik) { c.bones = c.bones.map(map); c.target = map(c.target) }
      for (const c of sk.tc) { c.bones = c.bones.map(map); c.target = map(c.target) }
      for (const k of Object.keys(plan.layers)) { const pl = plan.layers[k]; if (pl.bones) pl.bones = pl.bones.map(map); if (pl.parentBone) pl.parentBone = map(pl.parentBone) }
      plan.renamed = Object.fromEntries(ren)
    }
    sk.index = new Map(sk.bones.map((b, i) => [b.name, i]))
  }

  /**
   * Constraint names and order as the template writes them: an IK is named after its
   * target (the helper chain's after the end target plus 'a', the abdomen's 'yao'); a
   * transform constraint after its target when it drives a target-shaped relation (the
   * knee follow 'kua4', the pivot couple 'kua1', the blink 'eyes_l_up'), after its bone
   * otherwise ('eyes_l_down', 'mouth_up'), with the fixed names 'x' (waist follow),
   * 'kua1_r' / 'jian1_r' (pivot turns), 'all' (face_turn_back), 'y1' / 'y2' (upper lids)
   * and 'f1'… (hair chains). The order is the template's sequence: waist, right shoulder
   * turn, right arm, shoulder couple, left arm, feet, shoulder IKs, hip turn, hip_r IK, hip
   * couple, hip_l IK, right leg, left leg, abdomen, face_turn_back, breasts, eyes, hair,
   * mouth — in particular a pivot couple runs BEFORE the left connector's IK reads the
   * pivot it moves.
   */
  function templateConstraints(sk, partOfLayer) {
    const index = new Map(sk.bones.map((b, i) => [b.name, i]))
    const partOf = (n) => { const i = index.get(n); return i === undefined ? null : partOfLayer.get(sk.bones[i].layer) }
    const CAT = { x: 0, jian1_r: 1, armR: 2, jian1: 3, armL: 4, foot: 5, shoulderIk: 6, kua1_r: 7, kua1Ik: 8, kua1: 9, kua2Ik: 10, legR: 11, legL: 12, yao: 13, all: 14, breast: 15, eyes: 16, hair: 17, mouth: 18, other: 19 }
    const used = { ik: new Set(), tc: new Set() }
    const unique = (set, name) => { let n = name, k = 2; while (set.has(n)) n = `${name}${k++}`; set.add(n); return n }
    for (const c of sk.ik) {
      let name
      if (c.bones.length === 1 && c.bones[0] === 'abdomen' && c.target === 'waist') name = 'yao'
      else if (c.bones.length >= 2) name = c.target + 'a'
      else name = c.target
      c.name = unique(used.ik, name)
      let cat = CAT.other
      if (c.name === 'yao') cat = CAT.yao
      else if (/^foot\d*$/.test(c.name)) cat = CAT.foot
      else if (c.name === 'jian1' || c.name === 'jian2') cat = CAT.shoulderIk
      else if (c.name === 'kua1') cat = CAT.kua1Ik
      else if (c.name === 'kua2') cat = CAT.kua2Ik
      else if (/^arm[12]a?$/.test(c.name)) cat = CAT.armR
      else if (/^arm[34]a?$/.test(c.name)) cat = CAT.armL
      else if (/^leg[12]a?$/.test(c.name)) cat = CAT.legR
      else if (/^leg[34]a?$/.test(c.name)) cat = CAT.legL
      c.phase = cat
    }
    let f = 0
    const eyeRank = { y1: 0, eyes_l_up: 1, eyes_l_down: 2, y2: 3, eyes_r_up: 4, eyes_r_down: 5 }
    const mouthRank = { mouth_down: 0, mouth_l: 1, mouth_r: 2, mouth_up: 3 }
    const breastRank = { breast_l: 0, breast_r: 1, bra_l: 2, bra_r: 3 }
    for (const c of sk.tc) {
      const b = c.bones[0], t = c.target
      let name = c.name, cat = CAT.other
      if (b === 'waist' && t === 'x') { name = 'x'; cat = CAT.x }
      else if (b === 'kua1' && t === 'body_down_turn') { name = 'kua1_r'; cat = CAT.kua1_r }
      else if (b === 'jian1' && t === 'body_up_turn') { name = 'jian1_r'; cat = CAT.jian1_r }
      else if (b === 'kua2' && t === 'kua1') { name = 'kua1'; cat = CAT.kua1 }
      else if (b === 'jian2' && t === 'jian1') { name = 'jian1'; cat = CAT.jian1 }
      else if (/^(kua|jian)\d$/.test(t) && /^(leg|arm)\d$/.test(b)) { name = t; cat = t === 'jian4' ? CAT.armR : (t === 'jian6' ? CAT.armL : (t === 'kua4' ? CAT.legR : (t === 'kua6' ? CAT.legL : CAT.other))) }
      else if (b === 'face_turn_back' && t === 'face_turn') { name = 'all'; cat = CAT.all }
      else if (b === 'eyes_l_up' && t === 'face_turn') { name = 'y1'; cat = CAT.eyes }
      else if (b === 'eyes_r_up' && t === 'face_turn') { name = 'y2'; cat = CAT.eyes }
      else if (/^eyes_[lr]_down$/.test(b) && /^eyes_[lr]_up$/.test(t)) { name = t; cat = CAT.eyes }
      else if (/^eyes_[lr]_down$/.test(b)) { name = b; cat = CAT.eyes }
      else if (/^mouth_(up|down|l|r)$/.test(b)) { name = b; cat = CAT.mouth }
      else if (/^(breast|bra)(_[lr])?$/.test(b)) { name = b; cat = CAT.breast }
      else if (t === 'face_turn' && partOf(b) === 'hair') { name = `f${++f}`; cat = CAT.hair }
      c.name = unique(used.tc, name)
      c.phase = cat
      if (cat === CAT.eyes && eyeRank[c.name] !== undefined) c.seq = eyeRank[c.name]
      else if (cat === CAT.mouth && mouthRank[c.name] !== undefined) c.seq = mouthRank[c.name]
      else if (cat === CAT.breast && breastRank[c.name] !== undefined) c.seq = breastRank[c.name]
    }
  }

  // --------------------------------------------------------- Spine output ---

  function finish(sk, L, plan) {
    // parents must precede children in the Spine file: re-order (stable) after the
    // re-parenting the limb mechanism does
    const order = []
    {
      const kidsOf = new Map()
      sk.bones.forEach((b, i) => { if (b.parent >= 0) { if (!kidsOf.has(b.parent)) kidsOf.set(b.parent, []); kidsOf.get(b.parent).push(i) } })
      // the trunk's root-level pivots (y, then waist) lead the file, targets and sliders follow
      for (const [pid, ks] of kidsOf) if (pid >= 0 && sk.bones[pid].kind === 'root') ks.sort((a, b) => { const ra = sk.bones[a].role === 'trunk' ? (sk.bones[a].name === 'y' ? 0 : 1) : 2, rb = sk.bones[b].role === 'trunk' ? (sk.bones[b].name === 'y' ? 0 : 1) : 2; return ra - rb || a - b })
      const stack = sk.bones.map((b, i) => (b.parent < 0 ? i : -1)).filter((i) => i >= 0).reverse()
      const seen = new Set()
      while (stack.length) { const i = stack.pop(); if (seen.has(i)) continue; seen.add(i); order.push(i); const ks = kidsOf.get(i) || []; for (let j = ks.length - 1; j >= 0; j--) stack.push(ks[j]) }
      sk.bones.forEach((b, i) => { if (!seen.has(i)) order.push(i) })
    }
    const remap = new Map(order.map((oldI, newI) => [oldI, newI]))
    const bones = order.map((i) => Object.assign({}, sk.bones[i], { parent: sk.bones[i].parent >= 0 ? remap.get(sk.bones[i].parent) : -1 }))
    for (const l of L) if (l.rootBone !== undefined && l.rootBone >= 0) l.rootBone = remap.get(l.rootBone)
    const world = bones.map((b) => ({ x: b.ax, y: b.ay, rot: b.len > 0 ? Math.atan2(b.by - b.ay, b.bx - b.ax) : null }))
    const rotOf = (i) => {   // a zero-length bone inherits its parent's rotation
      let k = i
      while (k >= 0 && world[k].rot === null) k = bones[k].parent
      return k >= 0 ? world[k].rot : 0
    }
    const rnd = (v) => Math.round(v * 100) / 100
    const json = []
    bones.forEach((b, i) => {
      const p = b.parent
      const wr = rotOf(i)
      const entry = { name: b.name }
      if (p >= 0) {
        entry.parent = bones[p].name
        const pr = rotOf(p)
        const dx = b.ax - world[p].x, dy = b.ay - world[p].y
        const c = Math.cos(-pr), s = Math.sin(-pr)
        const lx = rnd(dx * c - dy * s), ly = rnd(dx * s + dy * c)
        if (lx) entry.x = lx
        if (ly) entry.y = ly
        // a bone that does not inherit rotation ('noRotationOrReflection' / 'onlyTranslation')
        // keeps its own WORLD angle: the runtime reads its `rotation` as absolute, so the
        // relative angle would turn every ribbon by minus its parent's angle
        const absolute = b.inherit === 'noRotationOrReflection' || b.inherit === 'onlyTranslation'
        let rel = (absolute ? wr : wr - pr) * 180 / Math.PI
        while (rel > 180) rel -= 360
        while (rel < -180) rel += 360
        if (b.len > 0 && Math.abs(rel) > 1e-6) entry.rotation = rnd(rel)
      }
      if (b.len > 0) entry.length = rnd(b.len)
      if (b.inherit) entry.transform = b.inherit
      if (b.kind === 'ikTarget' || b.kind === 'pivot' || b.kind === 'helper') entry.color = 'ff3f00ff'
      else if (b.kind === 'controller' || b.kind === 'slider') entry.color = 'abe323ff'
      json.push(entry)
    })
    const byName = new Map(bones.map((b, i) => [b.name, i]))
    // constraints: sorted by phase (then creation), offsets from the setup pose
    const ranked = [...sk.ik.map((c) => ({ c, kind: 'ik', key: (c.phase || 0) * 100000 + (c.seq || 0) })), ...sk.tc.map((c) => ({ c, kind: 'tc', key: (c.phase || 0) * 100000 + (c.seq || 0) }))].sort((p, q) => p.key - q.key)
    const ik = [], tc = []
    ranked.forEach((r, k) => {
      const c = r.c
      if (r.kind === 'ik') {
        const e = { name: c.name, order: k, bones: c.bones, target: c.target }
        if (c.bendPositive === false) e.bendPositive = false
        if (c.compress) e.compress = true
        if (c.stretch) e.stretch = true
        if (c.mix !== undefined && c.mix !== 1) e.mix = c.mix
        ik.push(e)
      } else {
        const ti = byName.get(c.target), bi = byName.get(c.bones[0])
        const e = { name: c.name, order: k, bones: c.bones, target: c.target }
        if (ti !== undefined && bi !== undefined) {
          // offset = the bone's setup transform seen from the target: position in the
          // target's local frame, rotation difference in degrees
          const tr = rotOf(ti), br = rotOf(bi)
          const dx = world[bi].x - world[ti].x, dy = world[bi].y - world[ti].y
          const cs = Math.cos(-tr), sn = Math.sin(-tr)
          const ox = rnd(dx * cs - dy * sn), oy = rnd(dx * sn + dy * cs)
          let orot = (br - tr) * 180 / Math.PI
          while (orot > 180) orot -= 360
          while (orot < -180) orot += 360
          if (Math.abs(orot) > 1e-6) e.rotation = rnd(orot)
          if (ox) e.x = ox
          if (oy) e.y = oy
        }
        e.rotateMix = c.rotateMix; e.translateMix = c.translateMix; e.scaleMix = c.scaleMix; e.shearMix = c.shearMix
        tc.push(e)
      }
    })
    const slotBone = {}, attachment = {}
    for (const l of L) {
      const bi = l.rootBone !== undefined && l.rootBone >= 0 ? l.rootBone : 0
      slotBone[l.name] = bones[bi].name
      const wr = rotOf(bi)
      const dx = l.place.x - world[bi].x, dy = l.place.y - world[bi].y
      const c = Math.cos(-wr), s = Math.sin(-wr)
      attachment[l.name] = { x: rnd(dx * c - dy * s), y: rnd(dx * s + dy * c), rotation: rnd(-wr * 180 / Math.PI) }
    }
    return {
      bones: bones.map((b) => ({ name: b.name, parent: b.parent >= 0 ? bones[b.parent].name : null, ax: b.ax, ay: b.ay, bx: b.bx, by: b.by, len: b.len, layer: b.layer, role: b.role, kind: b.kind })),
      json: { bones: json, ik, transform: tc },
      slotBone, attachment, plan
    }
  }

  /**
   * Apply a built skeleton to a PhotoshopToSpine-style skeleton JSON: replaces the
   * bone list, adds the IK constraints, re-binds every slot to its layer bone and
   * moves the region attachments into that bone's local frame. Returns a new JSON.
   */
  function applyToSkeleton(skeletonJson, built) {
    const out = JSON.parse(JSON.stringify(skeletonJson))
    out.bones = built.json.bones
    if (built.json.ik.length) out.ik = built.json.ik; else delete out.ik
    if (built.json.transform && built.json.transform.length) out.transform = built.json.transform; else delete out.transform
    const skins = Array.isArray(out.skins) ? out.skins.map((s) => s.attachments) : Object.values(out.skins || {})
    for (const slot of out.slots || []) {
      const bone = built.slotBone[slot.name]
      if (!bone) continue
      slot.bone = bone
      for (const atts of skins) {
        const bySlot = atts && atts[slot.name]
        if (!bySlot) continue
        for (const an of Object.keys(bySlot)) {
          const att = bySlot[an]
          if (!att || (att.type && att.type !== 'region')) continue
          const t = built.attachment[slot.name] || built.attachment[an]
          if (!t) continue
          att.x = t.x; att.y = t.y
          if (Math.abs(t.rotation) > 1e-6) att.rotation = t.rotation; else delete att.rotation
        }
      }
    }
    return out
  }

  return {
    DEFAULTS,
    nameHint,
    analyzeLayer,
    detectFace,
    buildSkeleton,
    applyToSkeleton,
    _internals: { thin, graphFromSkeleton, pruneGraph, extendTips, simplifyGraph, trunkPath, cutPolyline, downMask, segDist, polyLen, pointAt, slicePoly, radiusAt }
  }
})
