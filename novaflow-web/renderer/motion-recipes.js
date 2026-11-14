/*
 * Foart — motion recipes (小桃 动作合成).
 *
 * One call writes a complete, editable Spine 3.8 animation for a rig the app built (自动架设
 * names: y/x hips, waist/chest/neck/head trunk, root-level IK targets) or any other rig:
 *   synthesize(json, { motion, name, duration?, intensity?, facing?, targets?, loop? })
 * Primary motion = a few eased keys on the trunk / hips / IK targets (what an animator keys);
 * secondary motion (hair, cloth, ribbons, tails: every unnamed bone chain) = a damped spring per
 * bone driven by its parent's real acceleration, evaluated through the Spine runtime itself so
 * IK and transform constraints are honoured, then baked every 2 frames. Loops run the spring for
 * three cycles and keep the last one, so the wrap is seamless.
 * UI motions give every target layer its own bone at the picture's centre (one undo step) and key
 * scale / translate / rotate / slot colour with a stagger by draw order.
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowMotionRecipes = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const FPS = 30
  const clone = (v) => JSON.parse(JSON.stringify(v))
  const r2 = (v) => Math.round(v * 100) / 100
  const t3 = (v) => Math.round(v * 10000) / 10000
  const EASE = { io: [0.25, 0, 0.75, 1], o: [0.15, 0.6, 0.35, 1], i: [0.6, 0, 0.85, 0.4], lin: null, step: 'stepped', back: [0.3, 0, 0.2, 1] }

  // ---------------------------------------------------------------- catalogue --
  const MOTIONS = {
    idle: { kind: 'character', duration: 2, loop: true, label: '待机' },
    breathe: { kind: 'character', duration: 3, loop: true, label: '呼吸' },
    attack: { kind: 'character', duration: 1.1, loop: false, label: '攻击' },
    heavy_attack: { kind: 'character', duration: 1.6, loop: false, label: '蓄力重击' },
    cast: { kind: 'character', duration: 1.6, loop: false, label: '施法' },
    hit: { kind: 'character', duration: 0.6, loop: false, label: '受击' },
    die: { kind: 'character', duration: 1.4, loop: false, label: '死亡' },
    win: { kind: 'character', duration: 1.4, loop: true, label: '胜利欢呼' },
    jump: { kind: 'character', duration: 1, loop: false, label: '跳跃' },
    float: { kind: 'character', duration: 3, loop: true, label: '漂浮' },
    walk: { kind: 'character', duration: 1, loop: true, label: '走路(原地)' },
    ui_pop: { kind: 'ui', duration: 1, loop: false, label: '入场弹出' },
    ui_breathe: { kind: 'ui', duration: 1.6, loop: true, label: '呼吸缩放' },
    ui_float: { kind: 'ui', duration: 2.4, loop: true, label: '上下浮动' },
    ui_shake: { kind: 'ui', duration: 0.6, loop: false, label: '抖动' },
    ui_flash: { kind: 'ui', duration: 1.2, loop: true, label: '闪光' },
    ui_swing: { kind: 'ui', duration: 2, loop: true, label: '摇摆' },
    ui_spin: { kind: 'ui', duration: 3, loop: true, label: '旋转' },
    ui_press: { kind: 'ui', duration: 0.4, loop: false, label: '按下回弹' },
    ui_bigwin: { kind: 'ui', duration: 2.4, loop: false, label: '大奖入场' },
    ui_win: { kind: 'symbol', duration: 1, loop: false, label: '符号中奖' },
    ui_land: { kind: 'symbol', duration: 0.5, loop: false, label: '落地回弹' }
  }

  // ------------------------------------------------------------------- rig map --
  const TEMPLATE_LIMB = /^(kua\d+|jian\d+|leg\d*|leg_[lr]|lowerLeg_[lr]|foot\d*|foot_[lr]|toes_[lr]|arm\d+a?|Upper_arm_[lr]|forearm_[lr]|hand_[lr]|hip_[lr](_\d+)?|shoulder_[lr]|body_(up|down)_turn|face_turn(_back)?|eyes?_.*|mouth_.*|breast_[lr]|bra(_[lr])?|y\d*|x\d*|abdomen|neck_\d+)$/
  const TRUNK = ['y', 'x', 'waist', 'chest', 'neck', 'head']
  const STIFF = /(object|weapon|sword|blade|staff|spear|shield|gun|axe|bow|wand|handwear|glove|hand|arm|leg|foot|wing|horn|armor|armour)/i
  const SOFT = /(hair|bang|braid|tail|ribbon|cape|cloak|skirt|scarf|tassel|sleeve|bottomwear|dress|ear|strap|flag|feather|fur)/i

  function rigMap(json) {
    const bones = json.bones, by = new Map(bones.map((b, i) => [b.name, { ...b, i }]))
    const kids = new Map(); for (const b of bones) { const p = b.parent || ''; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(b.name) }
    const ikTargets = new Set((json.ik || []).map((c) => c.target)), ikBones = new Set((json.ik || []).flatMap((c) => c.bones))
    const tcBones = new Set((json.transform || []).flatMap((c) => c.bones)), tcTargets = new Set((json.transform || []).map((c) => c.target))
    const has = (n) => by.has(n)
    const trunk = TRUNK.filter(has)
    const templ = trunk.length >= 3
    // secondary chains: bones that carry pictures but no named role
    const secondary = []
    for (const b of bones) {
      if (!b.parent || trunk.includes(b.name) || ikTargets.has(b.name) || ikBones.has(b.name) || tcTargets.has(b.name)) continue
      if (templ && TEMPLATE_LIMB.test(b.name)) continue
      if (!(b.length > 0)) continue
      secondary.push(b.name)
    }
    const secSet = new Set(secondary)
    const depth = new Map()
    for (const n of secondary) { let d = 0, p = by.get(n).parent; while (p && secSet.has(p)) { d++; p = by.get(p).parent } depth.set(n, d) }
    // hips: the template's y; otherwise the root child with the largest subtree
    const size = (n) => 1 + (kids.get(n) || []).reduce((s, c) => s + size(c), 0)
    const rootName = (bones.find((b) => !b.parent) || bones[0]).name
    let hips = has('y') ? 'y' : has('x') ? 'x' : null
    if (!hips) { const cs = (kids.get(rootName) || []).filter((c) => !ikTargets.has(c)); hips = cs.sort((a, b) => size(b) - size(a))[0] || rootName }
    const chest = has('chest') ? 'chest' : null, neck = has('neck') ? 'neck' : null, head = has('head') ? 'head' : null
    const armTargets = ['arm2', 'arm4', 'arm1', 'arm3'].filter((n) => has(n) && ikTargets.has(n) || has(n) && by.get(n).parent === rootName)
    // (a toe target that rides on its ankle target moves with it: only the free ones are moved)
    const legTargets = [...ikTargets].filter((n) => /^(leg\d|foot\d*)$/.test(n) && !ikTargets.has(by.get(n).parent))
    const base = { by, kids, trunk, templ, secondary, depth, hips, chest, neck, head, root: rootName, armTargets, legTargets, ikTargets, tcBones }
    if (!templ) { const g = structuralRig(json, base, size); if (g) return g }
    return base
  }

  /**
   * A rig with any bone names (an artist's own: bone12, idle43 …), read by structure: the hub is
   * where the dominant branch from root first fans out (the pelvis / body bone an animator bobs);
   * the trunk climbs from the hub through the child whose branch reaches highest, until that
   * branch is a plain chain (hair); IK targets are arms when their chain hangs from the trunk
   * above the hub and legs otherwise; what hangs from an IK limb moves with it (a weapon in the
   * hand); every other bone chain is cloth / hair for the springs.
   */
  function structuralRig(json, base, size) {
    const W = setupWorld(json); if (!W) return null
    const { by, kids, ikTargets } = base
    const ch = (n) => kids.get(n) || []
    const top = new Map(), low = new Map()
    const ext = (n) => { const w = W.get(n); const r = (w.rot * Math.PI) / 180; let hi = Math.max(w.y, w.y + Math.sin(r) * (w.len || 0)), lo = Math.min(w.y, w.y + Math.sin(r) * (w.len || 0)); for (const c of ch(n)) { const e = ext(c); hi = Math.max(hi, e[0]); lo = Math.min(lo, e[1]) } top.set(n, hi); low.set(n, lo); return [hi, lo] }
    ext(base.root)
    const H = Math.max(60, top.get(base.root) - low.get(base.root)), floor = low.get(base.root)
    const ikBones = new Set((json.ik || []).flatMap((c) => c.bones))
    const body = (n) => !ikTargets.has(n)
    // the hub
    let hub = base.root
    for (let guard = 0; guard < 12; guard++) {
      const cs = ch(hub).filter(body).sort((a, b) => size(b) - size(a))
      if (!cs.length) break
      const total = cs.reduce((s, c) => s + size(c), 0)
      const fan = cs.filter((c) => size(c) >= 2).length
      if (fan >= 3 && hub !== base.root) break
      if (size(cs[0]) < total * 0.5 && hub !== base.root) break
      hub = cs[0]
    }
    {
      const roots = (json.ik || []).map((c) => c.bones[0]).filter((n) => by.has(n))
      if (roots.length >= 2) {
        const chain = (n) => { const out = []; let p = by.get(n).parent; while (p) { out.push(p); p = by.get(p).parent } return out }
        let common = chain(roots[0])
        for (const r of roots.slice(1)) { const set = new Set(chain(r)); common = common.filter((n) => set.has(n)) }
        if (common.length && common[0] !== base.root && size(common[0]) >= 6) hub = common[0]
      }
    }
    if (hub === base.root || size(hub) < 6) return null
    // the trunk: climb while the best child still fans out (a head carries hair chains, a chain is hair itself)
    const isChain = (n) => { let c = n; for (;;) { const k = ch(c); if (k.length > 1) return false; if (!k.length) return true; c = k[0] } }
    const trunkPath = []
    let cur = hub
    for (let guard = 0; guard < 6; guard++) {
      const cs = ch(cur).filter((c) => body(c) && !ikBones.has(c) && top.get(c) > W.get(cur).y + H * 0.03)
      const up = cs.filter((c) => !isChain(c) || size(c) <= 2).sort((a, b) => top.get(b) - top.get(a) || size(b) - size(a))[0]
      if (!up || isChain(up) && trunkPath.length >= 1) break
      trunkPath.push(up); cur = up
    }
    const chest = trunkPath[0] || null, head = trunkPath.length > 1 ? trunkPath[trunkPath.length - 1] : null, neck = trunkPath.length > 2 ? trunkPath[trunkPath.length - 2] : null
    const under = (n, anc) => { let p = n; while (p) { if (p === anc) return true; p = by.get(p).parent } return false }
    // limbs by IK
    const armTargets = [], legTargets = [], limbBones = new Set()
    for (const c of json.ik || []) {
      for (const b of c.bones) limbBones.add(b)
      const first = c.bones[0]
      if (!W.get(c.target) || under(c.target, hub) && ikBones.has(by.get(c.target).parent) || ikTargets.has(by.get(c.target).parent)) continue
      const arm = chest && under(first, chest)
      const list = arm ? armTargets : legTargets
      if (!list.includes(c.target)) list.push(c.target)
    }
    // lead arm first: the one reaching furthest from the trunk
    const hx = W.get(hub).x
    armTargets.sort((a, b) => Math.abs(W.get(b).x - hx) - Math.abs(W.get(a).x - hx))
    const fixed = new Set([hub, ...trunkPath, base.root])
    for (const lb of limbBones) { let p = by.get(lb).parent; while (p && !fixed.has(p)) { limbBones.add(p); p = by.get(p).parent } }
    { let p = by.get(hub).parent; while (p) { fixed.add(p); p = by.get(p).parent } }
    const secondary = []
    for (const b of json.bones) {
      const n = b.name
      if (fixed.has(n) || ikTargets.has(n) || limbBones.has(n) || !(b.length > 0) || !under(n, hub)) continue
      let onLimb = false, p = b.parent
      while (p && p !== hub) { if (limbBones.has(p)) { onLimb = true; break } p = by.get(p).parent }
      if (onLimb) continue
      // an FK limb (no IK): a chain from the hub or chest that reaches the floor or is thick-boned is left alone
      let rootOf = n; while (by.get(rootOf).parent && !fixed.has(by.get(rootOf).parent)) rootOf = by.get(rootOf).parent
      if (low.get(rootOf) < floor + H * 0.12 && by.get(rootOf).parent === hub && !isChain(rootOf)) continue
      secondary.push(n)
    }
    const secSet = new Set(secondary), depth = new Map()
    for (const n of secondary) { let d = 0, p = by.get(n).parent; while (p && secSet.has(p)) { d++; p = by.get(p).parent } depth.set(n, d) }
    let weapon = null
    if (armTargets.length) {
      const c = (json.ik || []).find((k) => k.target === armTargets[0])
      const end = c && c.bones[c.bones.length - 1]
      let best = 0
      if (end) for (const b of json.bones) { if (b.name !== end && under(b.name, end) && !ikTargets.has(b.name) && (b.length || 0) > Math.max(best, H * 0.12)) { best = b.length; weapon = b.name } }
    }
    return Object.assign({}, base, { structural: true, hips: hub, chest, neck, head, trunk: [hub, ...trunkPath], armTargets, legTargets, secondary, depth, height: H, weapon })
  }

  // --------------------------------------------------------------- key helpers --
  function tracks(anim, bone) { anim.bones = anim.bones || {}; return (anim.bones[bone] = anim.bones[bone] || {}) }
  function curveOf(e) { const c = EASE[e || 'io']; if (c === undefined || c === null) return {}; if (c === 'stepped') return { curve: 'stepped' }; return { curve: c[0], c2: c[1], c3: c[2], c4: c[3] } }
  // keys: [[time, value(s), ease], ...] — ease belongs to the segment that STARTS at the key
  function keyRotate(anim, bone, keys) { tracks(anim, bone).rotate = keys.map(([t, a, e]) => ({ time: t3(t), angle: r2(a), ...curveOf(e) })) }
  function keyTranslate(anim, bone, keys) { tracks(anim, bone).translate = keys.map(([t, v, e]) => ({ time: t3(t), x: r2(v[0]), y: r2(v[1]), ...curveOf(e) })) }
  function keyScale(anim, bone, keys) { tracks(anim, bone).scale = keys.map(([t, v, e]) => ({ time: t3(t), x: r2(v[0]), y: r2(v[1]), ...curveOf(e) })) }
  function keyColor(anim, slot, keys) { anim.slots = anim.slots || {}; anim.slots[slot] = anim.slots[slot] || {}; anim.slots[slot].color = keys.map(([t, c, e]) => ({ time: t3(t), color: c, ...curveOf(e) })) }
  // a phase-shifted sine for a loop, sampled at the extremes + crossings (eased), wrapping cleanly
  function sineKeys(T, amp, phase, base = 0, cycles = 1) {
    const out = [], n = 4 * cycles
    for (let k = 0; k <= n; k++) {
      let t = ((k / n) * T + phase * T) % T
      out.push([t, base + amp * Math.sin((2 * Math.PI * cycles * (t / T)) - 2 * Math.PI * cycles * phase)])
    }
    // keys at the extremes of the shifted wave, sorted, plus exact 0 and T
    const ext = []
    for (let k = 0; k < 2 * cycles; k++) ext.push(((phase + (k + 0.5) / (2 * cycles)) % 1) * T)
    const f = (t) => base + amp * Math.sin(2 * Math.PI * cycles * (t / T - phase))
    const ts = [0, ...ext.filter((t) => t > 1e-4 && t < T - 1e-4), T].sort((a, b) => a - b)
    return ts.map((t) => [t, f(t), 'io'])
  }

  // ------------------------------------------------------------ runtime probe --
  function runtime() { const g = typeof globalThis !== 'undefined' ? globalThis : {}; return g.spine || (g.parent && g.parent.spine) || null }
  function makeSkeleton(json, animName) {
    const spine = runtime(); if (!spine) return null
    const j = clone(json)
    j.slots = []; j.skins = [{ name: 'default', attachments: {} }]; delete j.path; j.events = j.events || {}
    const anims = {}; if (animName && j.animations && j.animations[animName]) { const a = j.animations[animName]; anims[animName] = { bones: a.bones || {}, ik: a.ik || {}, transform: a.transform || {} } }
    j.animations = anims
    const loader = { newRegionAttachment: () => null, newMeshAttachment: () => null, newBoundingBoxAttachment: () => null, newPathAttachment: () => null, newPointAttachment: () => null, newClippingAttachment: () => null }
    const data = new spine.SkeletonJson(loader).readSkeletonData(j)
    const sk = new spine.Skeleton(data); sk.setToSetupPose(); sk.updateWorldTransform()
    return { spine, sk, anim: animName ? data.findAnimation(animName) : null }
  }
  function setupWorld(json) {
    const s = makeSkeleton(json); if (!s) return null
    const w = new Map(); for (const b of s.sk.bones) w.set(b.data.name, { x: b.worldX, y: b.worldY, rot: b.getWorldRotationX(), len: b.data.length, sx: b.getWorldScaleX() })
    return w
  }

  // ----------------------------------------------------- secondary (springs) --
  function bakeSprings(json, animName, rig, opts) {
    if (opts.springs === false || opts.springs === 0) return 0
    const s = makeSkeleton(json, animName); if (!s || !rig.secondary.length) return 0
    const { spine, sk, anim } = s
    const T = anim.duration || opts.duration, loop = opts.loop
    const dt = 1 / FPS, sub = 4, cycles = loop ? 3 : 1
    const total = Math.round(T * FPS) + (loop ? 0 : Math.round(0.5 * FPS))
    const order = sk.bones.filter((b) => rig.secondary.includes(b.data.name))
    const st = new Map(order.map((b) => {
      const L = Math.max(8, b.data.length), nm = b.data.name, d = rig.depth.get(nm) || 0
      const stiff = STIFF.test(nm) && !SOFT.test(nm)
      const f = stiff ? 4.5 : Math.max(0.9, Math.min(3.2, 2.4 * Math.sqrt(45 / L))) * (1 - 0.06 * Math.min(d, 6))
      const pSoft = rig.secondary.includes(b.parent && b.parent.data.name) && !(STIFF.test(b.parent.data.name) && !SOFT.test(b.parent.data.name))
      return [nm, { th: 0, w: 0, hist: [], L, d, stiff, keep: stiff && !rig.secondary.includes(b.parent && b.parent.data.name) ? 0.8 : stiff && pSoft ? 0.9 : 0, pr0: b.parent ? b.parent.getWorldRotationX() : 0, om: 2 * Math.PI * f, z: stiff ? 0.7 : 0.32, gain: (stiff ? 0.15 : 0.3) * (opts.springGain || 1), lim: stiff ? 6 : Math.max(6, 20 / (1 + 0.35 * d)), out: [] }]
    }))
    const wind = opts.wind || 0
    const frames = cycles * Math.round(T * FPS) + (loop ? 0 : Math.round(0.5 * FPS))
    const last = loop ? (cycles - 1) * Math.round(T * FPS) : 0
    for (let k = 0; k <= frames; k++) {
      const t = loop ? (k % Math.round(T * FPS)) / FPS : Math.min(k / FPS, T)
      sk.setToSetupPose()
      anim.apply(sk, t, t, false, null, 1, spine.MixBlend.setup, spine.MixDirection.mixIn)
      sk.updateWorldTransform()
      for (const b of order) {
        const S = st.get(b.data.name)
        let keepDeg = 0
        if (S.keep && b.parent) { let dr = b.parent.getWorldRotationX() - S.pr0; dr = ((dr + 540) % 360) - 180; keepDeg = -dr * S.keep }
        S.keepDeg = keepDeg
        b.rotation += S.th * 180 / Math.PI + keepDeg
        b.updateWorldTransform()
        // update this bone's descendants after its change (children come later in the order list
        // when they are secondary; non-secondary children are recomputed below)
        const p = b.parent
        S.hist.push({ x: b.worldX, y: b.worldY, pr: p ? p.getWorldRotationX() * Math.PI / 180 : 0, r: b.getWorldRotationX() * Math.PI / 180 })
        if (S.hist.length > 3) S.hist.shift()
        if (S.hist.length === 3) {
          const [a0, a1, a2] = S.hist
          const ax = (a2.x - 2 * a1.x + a0.x) / (dt * dt), ay = (a2.y - 2 * a1.y + a0.y) / (dt * dt)
          let dp = (a2.pr - 2 * a1.pr + a0.pr); dp = Math.atan2(Math.sin(dp), Math.cos(dp)); const alpha = dp / (dt * dt)
          const nx = -Math.sin(a2.r), ny = Math.cos(a2.r)
          const lever = S.L * 0.5
          let drive = -(ax * nx + ay * ny) / lever * S.gain - alpha * S.gain * 0.9
          if (wind) drive += wind * S.om * S.om * Math.sin(2 * Math.PI * (t / T) - S.d * 0.55) * (0.6 + 0.4 * Math.min(S.d, 4) / 4)
          const h = dt / sub
          for (let i = 0; i < sub; i++) {
            const acc = drive - S.om * S.om * S.th - 2 * S.z * S.om * S.w
            S.w += acc * h; S.th += S.w * h
          }
          const lim = S.lim * Math.PI / 180
          if (S.th > lim) { S.th = lim; S.w = Math.min(S.w, 0) } else if (S.th < -lim) { S.th = -lim; S.w = Math.max(S.w, 0) }
        }
        if (k >= last) S.out.push(S.th * 180 / Math.PI + (S.keepDeg || 0))
      }
      // non-secondary descendants of secondary bones follow (e.g. a picture bone under a strand)
      sk.updateWorldTransform()
    }
    const a = json.animations[animName]
    let n = 0
    for (const [name, S] of st) {
      const vals = S.out
      if (!vals.length) continue
      const peak = Math.max(...vals.map(Math.abs)); if (peak < 0.25) continue
      const keys = []
      const step = 2
      const count = loop ? Math.round(T * FPS) : vals.length - 1
      for (let f = 0; f <= count; f += step) keys.push([f / FPS, vals[Math.min(f, vals.length - 1)], 'lin'])
      if (loop) keys[keys.length - 1] = [T, keys[0][1], 'lin']
      else if ((count % step) !== 0) keys.push([count / FPS, vals[count], 'lin'])
      // add onto any rotate track the recipe already wrote for this bone
      const tr = tracks(a, name)
      if (tr.rotate && tr.rotate.length) {
        const base = sampleTrack(tr.rotate)
        tr.rotate = keys.map(([t, v]) => ({ time: t3(t), angle: r2(v + base(t)) }))
      } else tr.rotate = keys.map(([t, v]) => ({ time: t3(t), angle: r2(v) }))
      n++
    }
    return n
  }
  function sampleTrack(keys) {
    return (t) => {
      if (t <= keys[0].time) return keys[0].angle
      for (let i = 0; i < keys.length - 1; i++) { const a = keys[i], b = keys[i + 1]; if (t <= b.time) { const u = (t - a.time) / Math.max(1e-6, b.time - a.time); return a.angle + (b.angle - a.angle) * u } }
      return keys[keys.length - 1].angle
    }
  }

  // ------------------------------------------------------- character recipes --
  function characterRecipe(json, rig, motion, o) {
    const W = setupWorld(json)
    const a = {}
    const T = o.duration, I = o.intensity
    // scale of the figure: hips height above the lowest bone / the head
    const hw = W && W.get(rig.hips), hd = W && rig.head && W.get(rig.head)
    let H = 400
    if (W) { let lo = Infinity, hi = -Infinity; for (const v of W.values()) { lo = Math.min(lo, v.y); hi = Math.max(hi, v.y) } H = Math.max(120, hi - lo) }
    const F = o.facing || 1
    // rotation that tips a bone's end toward +x·F: sign depends on the bone's world direction
    const lean = (bone, deg) => { const w = W && W.get(bone); const s = w ? (Math.sin(w.rot * Math.PI / 180) >= 0 ? -1 : 1) : -1; return s * deg * F }
    const trunkRot = (keysFor) => { for (const [bone, mul] of [[rig.chest, 1], [rig.neck, 0.5], [rig.head, 0.6]]) if (bone) keyRotate(a, bone, keysFor(mul, bone)) }
    const hips = rig.hips
    // the template's waist hangs from root and follows the hips at the constraint's translate mix:
    // a whole-body move carries the rest, or the abdomen IK stretches (×1.6 measured)
    const follow = (() => { const w = rig.by.get('waist'); if (!w || w.parent !== rig.root || hips === 'waist') return 0
      const tc = (json.transform || []).find((c) => c.bones.includes('waist') && (c.target === 'x' || c.target === hips)); return 1 })()
    const bob = (keys, waistShare = 1) => { keyTranslate(a, hips, keys); if (follow) keyTranslate(a, 'waist', keys.map(([t, v, e]) => [t, [v[0] * follow * waistShare, v[1] * follow * waistShare], e])) }
    const arms = rig.armTargets
    let wind = 0
    switch (motion) {
      case 'idle':
      case 'breathe': {
        const d = H * (rig.structural ? 0.02 : 0.012) * I * (motion === 'breathe' ? 0.7 : 1)
        if (motion === 'idle' && rig.templ && rig.by.has('x') && hips === 'y') {
          // the studio's idle (measured on its own rigs): hips sway on x while the waist half-follows,
          // chest counters the sway, neck and head counter the chest a beat late, the body-turn
          // helper swings against the hips
          const A = H * 0.026 * I
          bob([[0, [0, d * 0.5], 'io'], [T / 4, [0, 0], 'io'], [3 * T / 4, [0, d], 'io'], [T, [0, d * 0.5]]])
          keyTranslate(a, 'x', [[0, [-A * 0.5, 0], 'io'], [T / 2, [A, 0], 'io'], [T, [-A * 0.5, 0]]])
          if (rig.chest) keyRotate(a, rig.chest, [[0, 0, 'io'], [T / 2, lean(rig.chest, -5 * I * F), 'io'], [T, 0]])
          if (rig.neck) keyRotate(a, rig.neck, [[0, 0, 'io'], [T / 2, lean(rig.neck, 5.5 * I * F), 'io'], [T, 0]])
          if (rig.head) { const h0 = lean(rig.head, 2.5 * I * F), h1 = lean(rig.head, 9 * I * F); keyRotate(a, rig.head, [[0, h0, 'io'], [T / 6, 0, 'io'], [T * 2 / 3, h1, 'io'], [T, h0]]) }
          if (rig.by.has('body_up_turn')) keyTranslate(a, 'body_up_turn', [[0, [0, 0], 'io'], [T / 2, [-H * 0.08 * I, 0], 'io'], [T, [0, 0]]])
          arms.forEach((n, i) => keyTranslate(a, n, [[0, [0, 0], 'io'], [T / 2, [H * 0.005 * I, H * (i === 0 ? 0.025 : 0.004) * I], 'io'], [T, [0, 0]]]))
          wind = 0.05 * I
          break
        }
        if (!rig.templ) { o.bodyByMass = true; break }
        bob([[0, [0, 0], 'io'], [T / 2, [0, -d], 'io'], [T, [0, 0]]])
        trunkRot((m, b) => sineKeys(T, lean(b, 1.6 * I * m), b === rig.chest ? 0 : 0.08 * m))
        if (rig.chest) keyScale(a, rig.chest, [[0, [1, 1], 'io'], [T / 2, [1 + 0.012 * I, 1 + 0.012 * I], 'io'], [T, [1, 1]]])
        arms.forEach((n, i) => keyTranslate(a, n, [[0, [0, 0], 'io'], [T / 2, [H * 0.006 * I * (i % 2 ? 1 : -1), -d * 0.8], 'io'], [T, [0, 0]]]))
        if (!rig.templ && rig.trunk.length < 2) {
          // a plain rig (one picture, a creature, a prop): breathe the trunk root by scale
          keyScale(a, hips, [[0, [1, 1], 'io'], [T / 2, [1 + 0.015 * I, 1 - 0.01 * I], 'io'], [T, [1, 1]]])
        }
        wind = (rig.structural ? 0.05 : 0.018) * I
        break
      }
      case 'float': {
        bob(sineKeys(T, H * 0.025 * I, 0))
        if (rig.chest) keyRotate(a, rig.chest, sineKeys(T, 2 * I, 0.25))
        wind = 0.025 * I
        break
      }
      case 'attack':
      case 'heavy_attack': {
        const heavy = motion === 'heavy_attack'
        const tA = T * (heavy ? 0.45 : 0.3), tS = tA + T * (heavy ? 0.1 : 0.12), tH = tS + T * 0.15
        const back = H * 0.03 * I, fwd = H * (heavy ? 0.08 : 0.05) * I, crouch = H * (heavy ? 0.05 : 0.03) * I
        bob([[0, [0, 0], 'io'], [tA, [-back * F, -crouch], 'i'], [tS, [fwd * F, -crouch * 0.6], 'o'], [tH, [fwd * F * 0.9, -crouch * 0.5], 'io'], [T, [0, 0]]])
        trunkRot((m, b) => [[0, 0, 'io'], [tA, lean(b, -12 * I * m), 'i'], [tS, lean(b, 20 * I * m), 'o'], [tH, lean(b, 16 * I * m), 'io'], [T, 0]])
        arms.forEach((n, i) => { const lead = i === 0 ? 1 : 0.3, tM = tA + (tS - tA) * 0.45
          keyTranslate(a, n, [[0, [0, 0], 'io'], [tA, [-H * 0.12 * I * F * lead, H * 0.16 * I * lead], 'i'], [tM, [H * 0.08 * I * F * lead, H * 0.2 * I * lead], 'lin'], [tS, [H * 0.26 * I * F * lead, -H * 0.06 * I * lead], 'o'], [tH, [H * 0.23 * I * F * lead, -H * 0.08 * I * lead], 'io'], [T, [0, 0]]]) })
        if (rig.weapon) keyRotate(a, rig.weapon, [[0, 0, 'io'], [tA, 35 * I * F, 'i'], [tS, -70 * I * F, 'o'], [tH, -62 * I * F, 'io'], [T, 0]])
        const front = frontFoot(rig, W, F)
        for (const ft of front) keyTranslate(a, ft, [[0, [0, 0], 'io'], [tA, [0, 0], 'o'], [tS, [fwd * F * 0.9, 0], 'io'], [tH, [fwd * F * 0.9, 0], 'io'], [T, [0, 0]]])
        o.events = [{ name: 'hit', time: tS }]
        break
      }
      case 'cast': {
        const tU = T * 0.35, tR = T * 0.55, tH = T * 0.75
        bob([[0, [0, 0], 'io'], [tU, [0, -H * 0.02 * I], 'io'], [tR, [0, H * 0.02 * I], 'o'], [tH, [0, H * 0.015 * I], 'io'], [T, [0, 0]]])
        trunkRot((m, b) => [[0, 0, 'io'], [tU, lean(b, 4 * I * m), 'io'], [tR, lean(b, -8 * I * m), 'o'], [tH, lean(b, -7 * I * m), 'io'], [T, 0]])
        arms.forEach((n, i) => keyTranslate(a, n, [[0, [0, 0], 'io'], [tU, [H * 0.03 * (i % 2 ? -1 : 1), H * 0.05 * I], 'io'], [tR, [H * 0.06 * (i % 2 ? -1 : 1), H * 0.22 * I], 'o'], [tH, [H * 0.06 * (i % 2 ? -1 : 1), H * 0.2 * I], 'io'], [T, [0, 0]]]))
        o.flash = { time: tR, color: 'fff2b0ff' }
        o.events = [{ name: 'cast', time: tR }]
        break
      }
      case 'hit': {
        const tI = T * 0.12, tB = T * 0.45
        bob([[0, [0, 0], 'o'], [tI, [-H * 0.05 * I * F, -H * 0.01 * I], 'io'], [tB, [-H * 0.02 * I * F, 0], 'io'], [T, [0, 0]]])
        trunkRot((m, b) => [[0, 0, 'o'], [tI, lean(b, -14 * I * m), 'io'], [tB, lean(b, 3 * I * m), 'io'], [T, 0]])
        o.flash = { time: 0, color: 'ff6060ff', hold: tI, out: tB }
        break
      }
      case 'die': {
        const tH = T * 0.15, tF = T * 0.6, tE = T * 0.85
        bob([[0, [0, 0], 'o'], [tH, [-H * 0.03 * F, -H * 0.03], 'i'], [tF, [-H * 0.02 * F, -H * 0.06], 'o'], [T, [-H * 0.02 * F, -H * 0.06]]])
        keyRotate(a, rig.root, [[0, 0, 'o'], [tH, 0, 'i'], [tF, 78 * F, 'o'], [tE, 72 * F, 'io'], [T, 74 * F]])
        trunkRot((m, b) => [[0, 0, 'o'], [tH, lean(b, -18 * m), 'i'], [tF, lean(b, -6 * m), 'io'], [T, lean(b, -4 * m)]])
        o.fade = { from: tE, to: T + 0.0001, keepEnd: true }
        o.flash = { time: 0, color: 'ff6060ff', hold: tH * 0.6, out: tH * 2 }
        break
      }
      case 'win': {
        const tC = T * 0.18, tU = T * 0.42, tL = T * 0.7
        const up = H * 0.12 * I
        bob([[0, [0, 0], 'i'], [tC, [0, -H * 0.03], 'o'], [tU, [0, 0], 'i'], [tL, [0, -H * 0.03], 'io'], [T, [0, 0]]])
        keyTranslate(a, rig.root, [[0, [0, 0], 'step'], [tC, [0, 0], 'o'], [tU, [0, up], 'i'], [tL, [0, 0], 'step'], [T, [0, 0]]])
        if (rig.chest) keyScale(a, rig.chest, [[0, [1, 1], 'i'], [tC, [1.03, 0.96], 'o'], [tU, [0.98, 1.03], 'i'], [tL, [1.03, 0.96], 'io'], [T, [1, 1]]])
        trunkRot((m, b) => [[0, 0, 'io'], [tU, lean(b, -4 * m), 'io'], [T, 0]])
        arms.forEach((n, i) => keyTranslate(a, n, [[0, [0, 0], 'i'], [tC, [0, -H * 0.02], 'o'], [tU, [H * 0.05 * (i % 2 ? -1 : 1), H * 0.25 * I], 'i'], [tL, [0, H * 0.05], 'io'], [T, [0, 0]]]))
        break
      }
      case 'jump': {
        const tC = T * 0.2, tU = T * 0.5, tL = T * 0.75
        bob([[0, [0, 0], 'io'], [tC, [0, -H * 0.05], 'o'], [tU, [0, 0], 'i'], [tL, [0, -H * 0.05], 'io'], [T, [0, 0]]])
        keyTranslate(a, rig.root, [[0, [0, 0], 'step'], [tC, [0, 0], 'o'], [tU, [0, H * 0.25 * I], 'i'], [tL, [0, 0], 'step'], [T, [0, 0]]])
        if (rig.chest) keyScale(a, rig.chest, [[0, [1, 1], 'io'], [tC, [1.04, 0.94], 'o'], [tU, [0.97, 1.04], 'i'], [tL, [1.05, 0.93], 'io'], [T, [1, 1]]])
        break
      }
      case 'walk': {
        bob([[0, [0, 0], 'io'], [T / 4, [0, H * 0.015], 'io'], [T / 2, [0, 0], 'io'], [3 * T / 4, [0, H * 0.015], 'io'], [T, [0, 0]]])
        trunkRot((m, b) => sineKeys(T, lean(b, 3 * m), 0.1))
        rig.legTargets.slice(0, 2).forEach((n, i) => keyTranslate(a, n, [[0, [H * 0.08 * (i ? 1 : -1), 0], 'io'], [T / 4, [0, i ? 0 : H * 0.05], 'io'], [T / 2, [H * 0.08 * (i ? -1 : 1), 0], 'io'], [3 * T / 4, [0, i ? H * 0.05 : 0], 'io'], [T, [H * 0.08 * (i ? 1 : -1), 0]]]))
        arms.slice(0, 2).forEach((n, i) => keyTranslate(a, n, sineKeys(T, 0, 0).map(([t]) => [t, [H * 0.05 * Math.sin(2 * Math.PI * t / T) * (i ? -1 : 1), 0], 'io'])))
        wind = 0.02
        break
      }
    }
    return { anim: a, wind }
  }

  function frontFoot(rig, W, F) {
    // every root-level leg target on the facing side of the hips (knee, ankle and toe targets of that leg)
    const hx = W && W.get(rig.hips) ? W.get(rig.hips).x : 0
    const feet = rig.structural ? rig.legTargets.filter((n) => W && W.get(n)) : [...rig.ikTargets].filter((n) => W && W.get(n) && rig.by.get(n).parent === rig.root && /^(legd|footd*)$/.test(n))
    const front = feet.filter((n) => (W.get(n).x - hx) * F > 0)
    return front.length ? front : feet.sort((a, b) => (W.get(b).x - W.get(a).x) * F).slice(0, 1)
  }

  // --------------------------------------------------------------- UI recipes --
  function slotCenters(json) {
    const out = new Map(), skin = (json.skins || [])[0], atts = skin ? (skin.attachments || {}) : {}
    const W = setupWorld(json)
    for (const s of json.slots || []) {
      const a = atts[s.name] && atts[s.name][s.attachment || Object.keys(atts[s.name] || {})[0]]
      if (!a) continue
      let x = 0, y = 0, w = 0, h = 0
      if (!a.type || a.type === 'region') { x = a.x || 0; y = a.y || 0; w = a.width || 0; h = a.height || 0 }
      else if (a.type === 'mesh' && a.vertices && a.vertices.length === (a.uvs || []).length) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (let i = 0; i < a.vertices.length; i += 2) { x0 = Math.min(x0, a.vertices[i]); x1 = Math.max(x1, a.vertices[i]); y0 = Math.min(y0, a.vertices[i + 1]); y1 = Math.max(y1, a.vertices[i + 1]) }
        x = (x0 + x1) / 2; y = (y0 + y1) / 2; w = x1 - x0; h = y1 - y0
      } else continue
      const bw = W && W.get(s.bone)
      out.set(s.name, { x: (bw ? bw.x : 0) + x, y: (bw ? bw.y : 0) + y, w, h, bone: s.bone, att: a })
    }
    return out
  }
  /** Give each target slot its own bone at the picture's centre (pictures keep their place). */
  function ensureLayerBones(json, slots) {
    const centers = slotCenters(json), made = []
    const rootName = (json.bones.find((b) => !b.parent) || json.bones[0]).name
    const taken = new Set(json.bones.map((b) => b.name))
    for (const name of slots) {
      const s = json.slots.find((x) => x.name === name), c = centers.get(name)
      if (!s || !c) continue
      const owners = json.slots.filter((x) => x.bone === s.bone).length
      if (s.bone !== rootName && owners === 1) continue
      const b = json.bones.find((x) => x.name === s.bone)
      if (b && (b.rotation || b.scaleX && b.scaleX !== 1 || b.scaleY && b.scaleY !== 1 || b.parent)) continue
      let bn = name; let k = 2; while (taken.has(bn)) bn = name + '_' + k++
      taken.add(bn)
      const bx = Math.round(c.x * 100) / 100, by = Math.round(c.y * 100) / 100
      json.bones.push({ name: bn, parent: rootName, x: bx, y: by })
      for (const sk of json.skins) {
        const m = sk.attachments && sk.attachments[name]; if (!m) continue
        for (const att of Object.values(m)) {
          if (!att.type || att.type === 'region') { att.x = r2((att.x || 0) - bx + (b ? b.x || 0 : 0)); att.y = r2((att.y || 0) - by + (b ? b.y || 0 : 0)) }
          else if (att.type === 'mesh' && att.vertices.length === att.uvs.length) for (let i = 0; i < att.vertices.length; i += 2) { att.vertices[i] = r2(att.vertices[i] - bx); att.vertices[i + 1] = r2(att.vertices[i + 1] - by) }
        }
      }
      s.bone = bn
      made.push(bn)
    }
    return { made, centers }
  }
  function resolveTargets(spec, all) {
    const list = Array.isArray(spec) ? spec : typeof spec === 'string' && spec ? spec.split('|') : []
    if (!list.length) return all.slice()
    const out = []
    for (const p of list) {
      const re = new RegExp('^' + String(p).split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')
      for (const n of all) if ((n === p || re.test(n)) && !out.includes(n)) out.push(n)
    }
    return out
  }
  /**
   * A rigged symbol / icon (slot-game symbols, badges, buttons built from several bones), the way
   * the studio's own win / fall clips are keyed: the whole piece squashes then pops from its hub
   * bone, the parts hanging from the hub bounce a beat later (overlap), additive glow layers swell.
   */
  function symbolRecipe(json, rig, motion, o) {
    const a = {}, T = o.duration, I = o.intensity
    const { by, kids } = rig
    const ch = (n) => kids.get(n) || []
    const size = (n) => 1 + ch(n).reduce((t, c) => t + size(c), 0)
    let hub = rig.root
    for (let g = 0; g < 8; g++) { const cs = ch(hub).filter((c) => !rig.ikTargets.has(c)); if (cs.length !== 1) break; hub = cs[0] }
    if (hub === rig.root) { const cs = ch(hub).slice().sort((x, y) => size(y) - size(x)); if (cs.length && size(cs[0]) >= (json.bones.length - 1) * 0.6) hub = cs[0] }
    const centers = slotCenters(json)
    let lo = Infinity, hi = -Infinity; for (const c of centers.values()) { lo = Math.min(lo, c.y - c.h / 2); hi = Math.max(hi, c.y + c.h / 2) }
    const Hh = isFinite(hi - lo) && hi > lo ? hi - lo : 200
    // additive layers (flares, glows) and the bones that carry only them
    const glowSlots = (json.slots || []).filter((sl) => sl.blend === 'additive' || sl.blend === 'screen')
    const glowBones = new Set(glowSlots.map((sl) => sl.bone).filter((b) => !(json.slots || []).some((x) => x.bone === b && !(x.blend === 'additive' || x.blend === 'screen'))))
    const parts = ch(hub).filter((c) => !rig.ikTargets.has(c) && !glowBones.has(c) && !rig.secondary.includes(c))
    if (motion === 'ui_win') {
      const k = 1 + 0.2 * I
      keyScale(a, hub, [[0, [1, 1], 'o'], [T * 0.1, [0.9, 0.9], 'o'], [T * 0.2, [k, k], 'io'], [T, [1, 1]]])
      parts.forEach((p, i) => { const d = Math.min(0.12, 0.03 * i), u = Hh * 0.06 * I * (i % 2 ? 0.8 : 1)
        keyTranslate(a, p, [[0, [0, 0], 'o'], [T * 0.1 + d, [0, u], 'io'], [T * 0.27 + d, [0, -u * 0.4], 'io'], [T * 0.5 + d, [0, -u * 0.15], 'io'], [T * 0.73 + d, [0, -u * 0.35], 'io'], [T, [0, 0]]]) })
      for (const g of glowBones) keyScale(a, g, [[0, [1, 1], 'o'], [T * 0.2, [1.3, 1.3], 'io'], [T * 0.6, [1.1, 1.1], 'io'], [T, [1, 1]]])
      for (const sl of glowSlots) { const base = (sl.color || 'ffffffff').slice(0, 6); keyColor(a, sl.name, [[0, base + '00', 'o'], [T * 0.2, base + 'ff', 'io'], [T * 0.75, base + 'cc', 'io'], [T, base + '00']]) }
    } else {
      const dY = Hh * 0.05 * I
      keyTranslate(a, hub, [[0, [0, 0], 'o'], [T * 0.34, [0, -dY], 'io'], [T, [0, 0]]])
      keyScale(a, hub, [[0, [1, 1], 'o'], [T * 0.34, [1.04, 0.94], 'io'], [T * 0.7, [0.99, 1.02], 'io'], [T, [1, 1]]])
      parts.forEach((p, i) => { const d = Math.min(0.1, 0.03 * (i + 1))
        keyTranslate(a, p, [[0, [0, 0], 'o'], [T * 0.34 + d, [0, -dY * 0.6], 'io'], [Math.min(T, T * 0.75 + d), [0, dY * 0.15], 'io'], [T, [0, 0]]]) })
    }
    return { anim: a, hub, parts: parts.length, glows: glowSlots.length }
  }
  function refAnimation(json, selfName) {
    const names = Object.keys(json.animations || {}).filter((n) => n !== selfName)
    return names.find((n) => /^idle$/i.test(n)) || names.find((n) => /idle|stand|daiji|待机/i.test(n)) || null
  }
  /** What each slot shows in the base pose (the idle's first frame, else setup): shown?, its rgb. */
  function baseVisible(json, selfName) {
    const ref = refAnimation(json, selfName), R = ref ? json.animations[ref] : null, out = new Map()
    const first = (keys) => (keys && keys.length && !(keys[0].time > 0.0001) ? keys[0] : null)
    for (const sl of json.slots || []) {
      const tr = (R && R.slots && R.slots[sl.name]) || {}
      const fa = first(tr.attachment), fc = first(tr.color)
      const att = fa ? fa.name : sl.attachment, color = (fc && fc.color) || sl.color || 'ffffffff'
      out.set(sl.name, { shown: !!att && !/00$/.test(color), rgb: color.slice(0, 6), alpha: color.slice(6, 8) || 'ff' })
    }
    return out
  }
  function groupBones(json, vis, rootName) {
    const kids = new Map(); for (const b of json.bones) { const p = b.parent || ''; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(b.name) }
    const own = new Map(); json.slots.forEach((sl, i) => { const v = vis.get(sl.name); if (v && !v.shown) return; if (!own.has(sl.bone)) own.set(sl.bone, []); own.get(sl.bone).push([sl.name, i]) })
    const memo = new Map()
    const under = (b) => { if (memo.has(b)) return memo.get(b); let r = (own.get(b) || []).slice(); for (const c of kids.get(b) || []) r = r.concat(under(c)); memo.set(b, r); return r }
    let level = [rootName]
    for (let depth = 0; depth < 4 && level.length < 4; depth++) {
      const next = []
      for (const b of level) {
        const cs = (kids.get(b) || []).filter((c) => under(c).length)
        if (!(own.get(b) || []).length && cs.length && level.length + cs.length - 1 <= 14) next.push(...cs); else next.push(b)
      }
      if (next.length === level.length && next.every((b, i) => b === level[i])) break
      level = next
    }
    const items = level.filter((b) => b !== rootName && under(b).length).map((b) => ({ bone: b, slots: under(b).map((x) => x[0]), z: Math.min(...under(b).map((x) => x[1])) }))
    items.sort((p, q) => p.z - q.z)
    return items.length ? items : null
  }
  function uiRecipe(json, motion, o) {
    const all = (json.slots || []).map((s) => s.name)
    const targets = resolveTargets(o.targets, all)
    const rootName = (json.bones.find((b) => !b.parent) || json.bones[0]).name
    const vis = baseVisible(json)
    // a rigged piece (a popup, a banner built on bones): its bone groups enter, not single pictures
    const rigged = json.slots.filter((sl) => sl.bone !== rootName).length > json.slots.length * 0.6
    const groups = rigged && !(o.targets && o.targets.length) ? groupBones(json, vis, rootName) : null
    const { made } = ensureLayerBones(json, groups ? [] : targets)
    const items = groups || targets.map((sl) => ({ bone: null, slots: [sl] }))
    const boneOf = new Map(json.slots.map((s) => [s.name, s.bone]))
    const centers = slotCenters(json)
    const a = {}, T = o.duration, I = o.intensity
    const n = items.length
    const stagger = o.stagger != null ? o.stagger : (n > 1 ? Math.min(groups ? 0.14 : 0.08, (T * 0.4) / n) : 0)
    let H = 200; for (const c of centers.values()) H = Math.max(H, c.h)
    const seen = new Set()
    items.forEach((it, i) => {
      const slot = it.slots[0]
      const bone = it.bone || boneOf.get(slot); if (!bone || seen.has(bone)) return; seen.add(bone)
      // colour keys keep each picture's own tint and leave layers the base pose hides alone
      const paint = (an, _s, keys) => { for (const sn of it.slots) { const v = vis.get(sn); if (v && !v.shown) continue; const rgb = v ? v.rgb : 'ffffff', al = v ? v.alpha : 'ff'; keyColor(an, sn, keys.map(([t, c, e]) => [t, rgb + (c.slice(6) === 'ff' ? al : c.slice(6)), e])) } }
      const d = stagger * i, c = centers.get(slot) || { h: 100, w: 100 }
      // the backmost group of a rigged piece is its backdrop: it only fades in
      if (groups && i === 0 && n > 1 && (motion === 'ui_pop' || motion === 'ui_bigwin')) { paint(a, slot, [[0, 'ffffff00', 'o'], [0.25, 'ffffffff']]); return }
      switch (motion) {
        case 'ui_pop': {
          const t1 = d + 0.18, t2 = t1 + 0.12, t3 = t2 + 0.12
          keyScale(a, bone, [[0, [0, 0], 'step'], ...(d > 0 ? [[d, [0, 0], 'o']] : [[0, [0, 0], 'o']]).slice(d > 0 ? 0 : 1), [t1, [1.18 * I + (1 - I), 1.18 * I + (1 - I)], 'io'], [t2, [0.94, 0.94], 'io'], [t3, [1, 1]]].filter((k, j, arr) => j === 0 || k[0] > arr[j - 1][0]))
          paint(a, slot, [[0, 'ffffff00', d > 0 ? 'step' : 'o'], ...(d > 0 ? [[d, 'ffffff00', 'o']] : []), [d + 0.12, 'ffffffff']])
          break
        }
        case 'ui_breathe': {
          const s = 1 + 0.05 * I
          keyScale(a, bone, [[0, [1, 1], 'io'], [T / 2, [s, s], 'io'], [T, [1, 1]]])
          break
        }
        case 'ui_float': {
          const amp = Math.max(4, c.h * 0.05) * I
          keyTranslate(a, bone, sineKeys(T, amp, i * 0.13).map(([t, v, e]) => [t, [0, v], e]))
          break
        }
        case 'ui_shake': {
          const ks = []; const N = 8
          for (let k = 0; k <= N; k++) { const t = d + (T * 0.8) * k / N; const fall = 1 - k / N; ks.push([t, (k % 2 ? 1 : -1) * 6 * I * fall * (k === 0 || k === N ? 0 : 1), 'io']) }
          if (d > 0) ks.unshift([0, 0, 'step'])
          keyRotate(a, bone, ks)
          keyTranslate(a, bone, ks.map(([t, v, e]) => [t, [v * c.w * 0.004, 0], e]))
          break
        }
        case 'ui_flash': {
          const t0 = (d % T)
          paint(a, slot, [[0, 'ffffffff', 'step'], ...(t0 > 0 ? [[t0, 'ffffffff', 'o']] : []), [t0 + 0.12, 'fffff0ff', 'io'], [t0 + 0.45, 'ffffffff', 'step'], [T, 'ffffffff']].filter((k, j, arr) => j === 0 || k[0] > arr[j - 1][0]))
          // brighten via scale pop + colour (additive light comes from a 扫光 layer the planner adds separately)
          keyScale(a, bone, [[0, [1, 1], 'step'], ...(t0 > 0 ? [[t0, [1, 1], 'o']] : []), [t0 + 0.12, [1.06, 1.06], 'io'], [t0 + 0.45, [1, 1], 'step'], [T, [1, 1]]].filter((k, j, arr) => j === 0 || k[0] > arr[j - 1][0]))
          break
        }
        case 'ui_swing': {
          keyRotate(a, bone, sineKeys(T, 6 * I, i * 0.1))
          break
        }
        case 'ui_spin': {
          keyRotate(a, bone, [[0, 0, 'lin'], [T / 3, -120, 'lin'], [2 * T / 3, -240, 'lin'], [T, -360]])
          break
        }
        case 'ui_press': {
          keyScale(a, bone, [[0, [1, 1], 'o'], [0.08, [0.9, 0.9], 'io'], [0.22, [1.05, 1.05], 'io'], [T, [1, 1]]])
          break
        }
        case 'ui_bigwin': {
          const t1 = d + 0.25, t2 = t1 + 0.15, t3 = t2 + 0.15
          keyScale(a, bone, [[0, [0, 0], d > 0 ? 'step' : 'o'], ...(d > 0 ? [[d, [0, 0], 'o']] : []), [t1, [1.35, 1.35], 'io'], [t2, [0.9, 0.9], 'io'], [t3, [1.04, 1.04], 'io'], [t3 + 0.5, [1, 1], 'io'], [t3 + 1, [1.04, 1.04], 'io'], [T, [1, 1]]].filter((k, j, arr) => j === 0 || k[0] > arr[j - 1][0]))
          keyRotate(a, bone, [[0, -8, d > 0 ? 'step' : 'o'], ...(d > 0 ? [[d, -8, 'o']] : []), [t1, 3, 'io'], [t2, 0]].filter((k, j, arr) => j === 0 || k[0] > arr[j - 1][0]))
          paint(a, slot, [[0, 'ffffff00', d > 0 ? 'step' : 'o'], ...(d > 0 ? [[d, 'ffffff00', 'o']] : []), [d + 0.1, 'ffffffff']])
          break
        }
      }
    })
    return { anim: a, made }
  }

  // ---------------------------------------------------------------- flashes --
  function slotFlash(json, a, f, rigBones) {
    const slots = (json.slots || []).map((s) => s.name)
    a.slots = a.slots || {}
    for (const s of slots) {
      const own = a.slots[s] || {}, setup = json.slots.find((x) => x.name === s)
      const base = (own.color && own.color[0] && own.color[0].color) || setup.color || 'ffffffff'
      // a slot the base pose keeps empty or invisible (an effect layer waiting for its cue) stays that way
      const shown = own.attachment && own.attachment[0] ? own.attachment[0].name : setup.attachment
      if (!shown || /00$/.test(base) || (setup.blend && setup.blend !== 'normal')) continue
      const keys = []
      if (f.time > 0) keys.push({ time: 0, color: base })
      keys.push({ time: t3(f.time), color: f.color, ...(f.hold ? { curve: 'stepped' } : {}) })
      if (f.hold) keys.push({ time: t3(f.time + f.hold), color: f.color })
      keys.push({ time: t3(f.out || f.time + 0.3), color: base })
      a.slots[s] = a.slots[s] || {}; a.slots[s].color = keys
    }
  }
  /**
   * A rig that already has animations keeps its look in them, not in the setup pose: which picture
   * each slot shows, hidden effect layers, the stance the idle starts from. A new motion starts from
   * the idle's first frame: its slot keys are copied, its bone values become the base the recipe's
   * keys are added onto.
   */
  function basePose(json, a, selfName) {
    const names = Object.keys(json.animations || {}).filter((n) => n !== selfName)
    const ref = names.find((n) => /^idle$/i.test(n)) || names.find((n) => /idle|stand|daiji|待机/i.test(n)) || null
    if (!ref) return null
    const R = json.animations[ref]
    const first = (keys) => (keys && keys.length && !(keys[0].time > 0.0001) ? keys[0] : null)
    const bare = (k) => { const c = Object.assign({}, k); delete c.curve; delete c.c2; delete c.c3; delete c.c4; delete c.nf4; delete c.time; return c }
    for (const [slot, tr] of Object.entries(R.slots || {})) for (const kind of ['attachment', 'color', 'twoColor']) {
      const f = first(tr[kind]); if (!f) continue
      a.slots = a.slots || {}; const mine = (a.slots[slot] = a.slots[slot] || {})
      if (!mine[kind]) mine[kind] = [Object.assign({ time: 0 }, bare(f))]
    }
    for (const [bone, tr] of Object.entries(R.bones || {})) for (const kind of ['rotate', 'translate', 'scale', 'shear']) {
      const f = first(tr[kind]); if (!f) continue
      const mine = tracks(a, bone)
      if (kind === 'rotate') { const v = f.angle || 0; if (!v) continue; if (mine.rotate) for (const k of mine.rotate) k.angle = r2((k.angle || 0) + v); else mine.rotate = [{ time: 0, angle: v }] }
      else if (kind === 'scale') { const x = f.x == null ? 1 : f.x, y = f.y == null ? 1 : f.y; if (x === 1 && y === 1) continue; if (mine.scale) for (const k of mine.scale) { k.x = r2((k.x == null ? 1 : k.x) * x); k.y = r2((k.y == null ? 1 : k.y) * y) } else mine.scale = [{ time: 0, x, y }] }
      else { const x = f.x || 0, y = f.y || 0; if (!x && !y) continue; if (mine[kind]) for (const k of mine[kind]) { k.x = r2((k.x || 0) + x); k.y = r2((k.y || 0) + y) } else mine[kind] = [{ time: 0, x, y }] }
    }
    for (const kind of ['drawOrder', 'draworder']) { const f = first(R[kind]); if (f && !a[kind]) a[kind] = [Object.assign({ time: 0 }, bare(f))] }
    return ref
  }
  function slotFade(json, a, f) {
    a.slots = a.slots || {}
    for (const s of json.slots || []) {
      const tr = (a.slots[s.name] = a.slots[s.name] || {})
      const prev = tr.color || [{ time: 0, color: s.color || 'ffffffff' }]
      const base = (s.color || 'ffffffff').slice(0, 6)
      tr.color = [...prev.filter((k) => k.time < f.from), { time: t3(f.from), color: base + 'ff' }, { time: t3(f.to), color: base + '00' }]
    }
  }

  // ---------------------------------------------------------------- entry ----
  function synthesize(source, opts) {
    const o = Object.assign({}, opts || {})
    const def = MOTIONS[o.motion]
    if (!def) throw new Error('未知动作：' + o.motion)
    const json = clone(source)
    json.animations = json.animations || {}
    let name = String(o.name || def.label).trim() || o.motion
    const into = o.merge && json.animations[name] ? json.animations[name] : null
    if (!into && json.animations[name] && !o.replace) { let k = 2; while (json.animations[name + '_' + k]) k++; name = name + '_' + k }
    o.duration = Math.max(0.2, Math.min(20, Number(o.duration) || def.duration))
    o.intensity = Math.max(0.2, Math.min(3, Number(o.intensity) || 1))
    o.loop = o.loop != null ? !!o.loop : def.loop
    const report = { motion: o.motion, name, duration: o.duration, loop: o.loop }
    if (def.kind === 'symbol') {
      const rig = rigMap(json)
      const r = symbolRecipe(json, rig, o.motion, o)
      json.animations[name] = r.anim
      report.basePose = basePose(json, json.animations[name], name)
      report.springs = bakeSprings(json, name, rig, { duration: o.duration, loop: false, wind: 0, springGain: o.intensity, springs: o.springs })
      report.hub = r.hub; report.parts = r.parts; report.glows = r.glows
      padEnd(json.animations[name], o.duration)
    } else if (def.kind === 'ui') {
      const r = uiRecipe(json, o.motion, o)
      if (o.delay) shiftAnim(r.anim, Number(o.delay) || 0)
      report.basePose = basePose(json, r.anim, name)
      json.animations[name] = into ? mergeAnim(into, r.anim) : r.anim
      report.bones = r.made.length; report.targets = Object.keys(r.anim.bones || {}).length
    } else {
      const rig = rigMap(json)
      if (!o.facing) o.facing = guessFacing(json, rig)
      const r = characterRecipe(json, rig, o.motion, o)
      json.animations[name] = r.anim
      if (!Object.keys(r.anim.bones || {}).length) {
        // nothing named to move (no rig yet): move the whole picture from the root
        keyTranslate(r.anim, rig.root, [[0, [0, 0], 'io'], [o.duration / 2, [0, 8 * o.intensity], 'io'], [o.duration, [0, 0]]])
      }
      report.basePose = basePose(json, json.animations[name], name)
      if (o.motion === 'idle' || o.motion === 'breathe' || o.motion === 'float') {
        const fig = figureHeight(json)
        if (o.bodyByMass) report.body = bodySway(json, json.animations[name], o.duration, { intensity: o.intensity * (o.motion === 'breathe' ? 0.6 : 1), height: fig })
        report.waves = chainWaves(json, json.animations[name], o.duration, { intensity: o.intensity * (o.motion === 'breathe' ? 0.6 : 1), skip: rig.templ ? rig.trunk : [], height: fig }); o.springs = false
      }
      report.springs = bakeSprings(json, name, rig, { duration: o.duration, loop: o.loop, wind: r.wind, springGain: o.intensity, springs: o.springs })
      if (o.flash) slotFlash(json, json.animations[name], o.flash)
      if (o.fade) slotFade(json, json.animations[name], o.fade)
      if (o.events && o.events.length) {
        json.events = json.events || {}
        for (const e of o.events) if (!json.events[e.name]) json.events[e.name] = {}
        json.animations[name].events = o.events.map((e) => ({ time: t3(e.time), name: e.name }))
      }
      report.rig = { template: rig.templ, trunk: rig.trunk, hips: rig.hips, arms: rig.armTargets.length, secondary: rig.secondary.length, facing: o.facing }
      // a non-looping action ends exactly where it started unless it is a fall
      if (!o.loop && o.motion !== 'die') padEnd(json.animations[name], o.duration)
    }
    report.keys = countKeys(json.animations[name])
    return { json, name, report }
  }
  function shiftAnim(a, d) {
    for (const g of [a.bones || {}, a.slots || {}]) for (const tr of Object.values(g)) for (const [k, keys] of Object.entries(tr)) {
      const first = keys[0]
      const moved = keys.map((x) => ({ ...x, time: t3(x.time + d) }))
      tr[k] = d > 0 && first ? [{ ...first, time: 0, curve: 'stepped', c2: undefined, c3: undefined, c4: undefined }, ...moved] : moved
    }
  }
  function mergeAnim(base, add) {
    for (const g of ['bones', 'slots']) { if (!add[g]) continue; base[g] = base[g] || {}; for (const [n, tr] of Object.entries(add[g])) base[g][n] = Object.assign(base[g][n] || {}, tr) }
    return base
  }
  function padEnd(a, T) {
    for (const tr of Object.values(a.bones || {})) for (const keys of Object.values(tr)) {
      const last = keys[keys.length - 1]; if (last && last.time < T - 1e-4) keys.push({ ...last, time: t3(T), curve: undefined, c2: undefined, c3: undefined, c4: undefined })
    }
  }
  function countKeys(a) { let n = 0; for (const g of [a.bones || {}, a.slots || {}]) for (const tr of Object.values(g)) for (const keys of Object.values(tr)) n += keys.length; return n }
  function guessFacing(json, rig) {
    // eyes / face pictures to the right of the head bone = facing right; default right
    const W = setupWorld(json); if (!W || !rig.head) return 1
    const h = W.get(rig.head)
    const c = slotCenters(json)
    let sx = 0, n = 0
    for (const [name, v] of c) if (/eye|iris|irides|nose|mouth|face/i.test(name)) { sx += v.x - h.x; n++ }
    if (!n) return 1
    const off = sx / n
    return Math.abs(off) < 6 ? 1 : (off > 0 ? 1 : -1)
  }

  /**
   * 美工 layers (back → front, x/y = top-left in the picture, width/height, dataUrl) → a
   * PhotoshopToSpine-style Spine 3.8 project the skeleton editor's loadSource() takes: one slot +
   * region per layer on root, origin at the picture's bottom centre, one atlas page per picture.
   */
  function projectFromLayers(layers, size, opts) {
    const list = (layers || []).filter((l) => l && l.dataUrl && l.width > 0 && l.height > 0)
    if (!list.length) throw new Error('没有可用的图层')
    const W = Math.round((size && size.width) || Math.max(...list.map((l) => (l.x || 0) + l.width)))
    const H = Math.round((size && size.height) || Math.max(...list.map((l) => (l.y || 0) + l.height)))
    const taken = new Set(), slots = [], atts = {}, atlas = [], images = []
    for (const l of list) {
      let name = String(l.name || l.id || 'layer').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'layer'
      const base = name; let k = 2
      while (taken.has(name.toLowerCase())) name = base + '_' + k++
      taken.add(name.toLowerCase())
      const w = Math.round(l.width), h = Math.round(l.height)
      const cx = (l.x || 0) + w / 2 - W / 2, cy = H - ((l.y || 0) + h / 2)
      slots.push({ name, bone: 'root', attachment: name })
      atts[name] = { [name]: { x: r2(cx), y: r2(cy), width: w, height: h } }
      atlas.push('', name + '.png', `size: ${w},${h}`, 'format: RGBA8888', 'filter: Linear,Linear', 'repeat: none',
        name, '  rotate: false', '  xy: 0, 0', `  size: ${w}, ${h}`, `  orig: ${w}, ${h}`, '  offset: 0, 0', '  index: -1')
      images.push({ fileName: name + '.png', dataUrl: l.dataUrl })
    }
    const stem = String((opts && opts.name) || 'foart_layers').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\s]+/g, '_') || 'foart_layers'
    const skel = { skeleton: { hash: '', spine: '3.8.99', x: -W / 2, y: 0, width: W, height: H, images: './images/' },
      bones: [{ name: 'root' }], slots, skins: [{ name: 'default', attachments: atts }], animations: {} }
    return { skeleton: { fileName: stem + '.json', text: JSON.stringify(skel) }, atlas: { fileName: stem + '.atlas', text: atlas.join('\n') + '\n' }, images }
  }

  /**
   * Hair, ribbons, tassels, skirts in an idle, the way the studio keys them (measured on its 立绘
   * idles: ~145 of ~190 bones wave; half-range 7° at a chain's root growing to 16° by the fourth
   * link; each link lags its parent by about a tenth of the cycle): every bone chain that carries
   * no IK gets a sine wave travelling root → tip. Few eased keys per bone, so it stays editable.
   */
  function chainWaves(json, a, T, opts) {
    const o = opts || {}, I = o.intensity || 1
    const by = new Map(json.bones.map((b) => [b.name, b])), kids = new Map()
    for (const b of json.bones) { const p = b.parent || ''; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(b.name) }
    const ch = (n) => kids.get(n) || []
    const locked = new Set()
    for (const c of [...(json.ik || []), ...(json.transform || []), ...(json.path || [])]) { for (const n of [...(c.bones || []), c.target]) { let p = n; while (p && by.has(p) && !locked.has(p)) { locked.add(p); p = by.get(p).parent } } }
    const skip = new Set(o.skip || [])
    const free = (n) => !locked.has(n) && !skip.has(n) && by.get(n).parent && (by.get(n).length || 0) > 0 && ch(n).length <= 2
    const chainLen = (n) => 1 + Math.max(0, ...ch(n).filter(free).map(chainLen))
    let chains = 0, bones = 0
    const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) } return ((h >>> 0) % 1000) / 1000 }
    const reach = (n) => (by.get(n).length || 0) + Math.max(0, ...ch(n).filter(free).map(reach))
    const H = o.height || 1000
    const lay = (n, d, phase, sign, cap, deep) => {
      const root = Math.max(7, 0.55 * cap)
      const amp = (root + (cap - root) * Math.min(1, d / Math.max(2, deep * 0.6))) * I * sign
      const tr = tracks(a, n), keys = sineKeys(T, amp, phase % 1)
      if (tr.rotate && tr.rotate.length === 1) { const base = tr.rotate[0].angle || 0; tr.rotate = keys.map(([t, v, e]) => ({ time: t3(t), angle: r2(v + base), ...curveOf(e) })) }
      else if (!tr.rotate) keyRotate(a, n, keys)
      else return
      bones++
      for (const c of ch(n)) if (free(c)) lay(c, d + 1, phase + 0.09, sign, cap, deep)
    }
    for (const b of json.bones) {
      const n = b.name
      if (!free(n) || free(b.parent) && by.get(b.parent).parent) continue
      if (chainLen(n) < 2) continue
      chains++
      const h = hash(n)
      // measured on the studio's template idle (骨骼蒙版模板): the swing goes with how long the BONES
      // are, not the chain — a skirt panel on 130 px bones stays within 7–9°, a sleeve on 85 px
      // bones reaches 15°, a ribbon on 55 px bones 18°, a string of beads on 28 px bones 29°.
      // (Long chains were given up to 29° before: a whole skirt flew out sideways.)
      const cap = Math.max(8, Math.min(30, 31 - 230 * (reach(n) / chainLen(n)) / H))
      lay(n, 0, h, h > 0.5 ? 1 : -1, cap, chainLen(n))
    }
    return { chains, bones }
  }
  function figureHeight(json) {
    const W = setupWorld(json)
    if (!W) return (json.skeleton && json.skeleton.height) || 1000
    let lo = Infinity, hi = -Infinity
    for (const v of W.values()) { const r = (v.rot * Math.PI) / 180, y2 = v.y + Math.sin(r) * (v.len || 0); lo = Math.min(lo, v.y, y2); hi = Math.max(hi, v.y, y2) }
    return Math.max(60, hi - lo)
  }
  function bodySway(json, a, T, opts) {
    const o = opts || {}, I = o.intensity || 1, H = o.height || 1000
    const by = new Map(json.bones.map((b) => [b.name, b])), kids = new Map()
    for (const b of json.bones) { const p = b.parent || ''; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(b.name) }
    const size = (n) => 1 + (kids.get(n) || []).reduce((t, c) => t + size(c), 0)
    const total = json.bones.length
    // the deepest bone that still carries 40 % of the rig: the body an animator grabs
    let body = null, cur = (json.bones.find((b) => !b.parent) || json.bones[0]).name
    for (let g = 0; g < 12; g++) { const next = (kids.get(cur) || []).filter((c) => size(c) >= total * 0.4).sort((p, q) => size(q) - size(p))[0]; if (!next) break; cur = next; body = cur }
    if (!body) return null
    const tr = tracks(a, body); if (tr.translate && tr.translate.length > 1) return null
    const base = tr.translate && tr.translate[0] ? [tr.translate[0].x || 0, tr.translate[0].y || 0] : [0, 0]
    // feet that follow the body (no IK target outside it) would slide: only breathe then
    const inside = (n) => { let p = n; while (p) { if (p === body) return true; p = by.get(p) && by.get(p).parent } return false }
    const planted = (json.ik || []).some((c) => !inside(c.target))
    const PM = parentMatrix(json), m = (PM && PM.get(body)) || { a: 1, b: 0, c: 0, d: 1 }, det = m.a * m.d - m.b * m.c || 1
    const loc = (wx, wy) => [base[0] + (m.d * wx - m.b * wy) / det, base[1] + (-m.c * wx + m.a * wy) / det]
    const ax = H * 0.012 * I * (planted ? 1 : 0.3), ay = H * 0.008 * I * (planted ? 1 : 0.5)
    keyTranslate(a, body, [[0, loc(-ax * 0.5, ay * 0.5), 'io'], [T / 4, loc(0, 0), 'io'], [T / 2, loc(ax, ay * 0.5), 'io'], [3 * T / 4, loc(ax * 0.3, ay), 'io'], [T, loc(-ax * 0.5, ay * 0.5)]])
    return { bone: body, planted }
  }
  function parentMatrix(json) {
    const m = makeSkeleton(json); if (!m) return null
    const out = new Map()
    for (const b of m.sk.bones) { const p = b.parent; out.set(b.data.name, p ? { a: p.a, b: p.b, c: p.c, d: p.d } : { a: 1, b: 0, c: 0, d: 1 }) }
    return out
  }
  const firstKey = (keys) => (keys && keys.length && !(keys[0].time > 0.0001) ? keys[0] : null)
  const curveCopy = (k) => { const c = {}; for (const f of ['curve', 'c2', 'c3', 'c4']) if (k[f] !== undefined) c[f] = k[f]; return c }
  /**
   * Lift an animation off its rig: per role (hub, trunk bones by position along the trunk, arm and
   * leg IK targets by where they sit, the weapon), the keys as deltas from the rig's idle first
   * frame; translations in world axes divided by the figure's height. Cloth chains are left out —
   * the target rig's own chains follow through the springs.
   */
  function extractClip(json, animName) {
    const A = json.animations[animName]; if (!A) throw new Error('没有这个动画：' + animName)
    const rig = rigMap(json); if (!rig.structural && !rig.templ) throw new Error('这个工程的骨架认不出身体结构')
    const W = setupWorld(json), PM = parentMatrix(json)
    const ref = refAnimation(json, animName), R = ref ? json.animations[ref] : null
    const H = rig.height || (() => { let lo = Infinity, hi = -Infinity; for (const v of W.values()) { lo = Math.min(lo, v.y); hi = Math.max(hi, v.y) } return Math.max(60, hi - lo) })()
    const hx = W.get(rig.hips).x, hy = W.get(rig.hips).y
    const lift = (bone) => {
      const tr = (A.bones || {})[bone]; if (!tr) return null
      const base = (R && R.bones && R.bones[bone]) || {}, m = PM.get(bone), out = {}
      if (tr.rotate && tr.rotate.length > 1) { const b0 = (firstKey(base.rotate) || {}).angle || 0; out.rotate = tr.rotate.map((k) => ({ time: k.time || 0, angle: (k.angle || 0) - b0, ...curveCopy(k) })) }
      if (tr.translate && tr.translate.length > 1) { const f = firstKey(base.translate) || {}, bx = f.x || 0, by0 = f.y || 0
        out.translate = tr.translate.map((k) => { const dx = (k.x || 0) - bx, dy = (k.y || 0) - by0; return { time: k.time || 0, x: (m.a * dx + m.b * dy) / H, y: (m.c * dx + m.d * dy) / H, ...curveCopy(k) } }) }
      if (tr.scale && tr.scale.length > 1) { const f = firstKey(base.scale) || {}, bx = f.x == null ? 1 : f.x, by0 = f.y == null ? 1 : f.y; out.scale = tr.scale.map((k) => ({ time: k.time || 0, x: (k.x == null ? 1 : k.x) / (bx || 1), y: (k.y == null ? 1 : k.y) / (by0 || 1), ...curveCopy(k) })) }
      return Object.keys(out).length ? out : null
    }
    const at = (n) => ({ px: (W.get(n).x - hx) / H, py: (W.get(n).y - hy) / H })
    const trunk = rig.trunk.filter((n) => n !== rig.hips)
    let dur = 0; const scan = (o) => { if (Array.isArray(o)) { for (const k of o) if (k && typeof k.time === 'number') dur = Math.max(dur, k.time) } else if (o && typeof o === 'object') for (const v of Object.values(o)) scan(v) }; scan(A.bones || {})
    const clip = { source: animName, duration: dur, hub: lift(rig.hips), trunk: trunk.map((n, i) => ({ u: trunk.length > 1 ? i / (trunk.length - 1) : 0, tracks: lift(n) })).filter((x) => x.tracks),
      arms: rig.armTargets.map((n) => ({ ...at(n), tracks: lift(n) })).filter((x) => x.tracks), legs: rig.legTargets.map((n) => ({ ...at(n), tracks: lift(n) })).filter((x) => x.tracks),
      weapon: rig.weapon ? lift(rig.weapon) : null, events: (A.events || []).map((e) => ({ time: e.time || 0, name: e.name })) }
    clip.moving = (clip.hub ? 1 : 0) + clip.trunk.length + clip.arms.length + clip.legs.length
    return clip
  }
  function applyClip(source, clip, opts) {
    const o = Object.assign({}, opts || {}), json = clone(source)
    json.animations = json.animations || {}
    let name = String(o.name || clip.source || '动作').trim(); if (json.animations[name]) { let k = 2; while (json.animations[name + '_' + k]) k++; name = name + '_' + k }
    const rig = rigMap(json); if (!rig.structural && !rig.templ) throw new Error('这个工程的骨架认不出身体结构')
    const W = setupWorld(json), PM = parentMatrix(json)
    const H = rig.height || (() => { let lo = Infinity, hi = -Infinity; for (const v of W.values()) { lo = Math.min(lo, v.y); hi = Math.max(hi, v.y) } return Math.max(60, hi - lo) })()
    const I = Math.max(0.2, Math.min(3, Number(o.intensity) || 1)), a = {}
    const lay = (bone, tr) => {
      if (!bone || !tr) return
      const m = PM.get(bone), det = m.a * m.d - m.b * m.c || 1, mine = tracks(a, bone)
      if (tr.rotate) mine.rotate = tr.rotate.map((k) => ({ time: t3(k.time), angle: r2(k.angle * I), ...curveCopy(k) }))
      if (tr.translate) mine.translate = tr.translate.map((k) => { const wx = k.x * H * I, wy = k.y * H * I; return { time: t3(k.time), x: r2((m.d * wx - m.b * wy) / det), y: r2((-m.c * wx + m.a * wy) / det), ...curveCopy(k) } })
      if (tr.scale) mine.scale = tr.scale.map((k) => ({ time: t3(k.time), x: r2(1 + (k.x - 1) * I), y: r2(1 + (k.y - 1) * I), ...curveCopy(k) }))
    }
    lay(rig.hips, clip.hub)
    const trunk = rig.trunk.filter((n) => n !== rig.hips)
    const usedT = new Set()
    for (const t of clip.trunk) { if (!trunk.length) break; let best = 0, bd = Infinity; trunk.forEach((n, i) => { const u = trunk.length > 1 ? i / (trunk.length - 1) : 0, d = Math.abs(u - t.u); if (d < bd && !usedT.has(i)) { bd = d; best = i } }); if (usedT.has(best)) continue; usedT.add(best); lay(trunk[best], t.tracks) }
    const hx = W.get(rig.hips).x, hy = W.get(rig.hips).y
    const match = (list, targets) => { const used = new Set(); for (const it of list) { let best = null, bd = Infinity; for (const n of targets) { if (used.has(n)) continue; const d = Math.hypot((W.get(n).x - hx) / H - it.px, (W.get(n).y - hy) / H - it.py); if (d < bd) { bd = d; best = n } } if (best) { used.add(best); lay(best, it.tracks) } } }
    match(clip.arms, rig.armTargets); match(clip.legs, rig.legTargets)
    if (clip.weapon && rig.weapon) lay(rig.weapon, clip.weapon)
    json.animations[name] = a
    const report = { clip: clip.source, name, duration: clip.duration, laid: Object.keys(a.bones || {}).length }
    report.basePose = basePose(json, a, name)
    report.springs = bakeSprings(json, name, rig, { duration: clip.duration, loop: !!o.loop, wind: 0, springGain: 1, springs: o.springs })
    if (clip.events.length) { json.events = json.events || {}; for (const e of clip.events) if (!json.events[e.name]) json.events[e.name] = {}; a.events = clip.events.map((e) => ({ time: t3(e.time), name: e.name })) }
    return { json, name, report }
  }


  // ------------------------------------------------------------- effects ---
  // Built-in effects (fx-library/<id>/fx.json: bones, slots, attachments naming pictures, one animation)
  // laid into an animation of the open project: where, how big and under which layer come from what
  // that animation shows.

  /** World matrices of the setup pose (plain FK; constraints do not matter for a bounding box). */
  function setupMatrices(json) {
    const W = new Map()
    for (const b of json.bones) {
      const p = b.parent ? W.get(b.parent) : null
      const r = ((b.rotation || 0) * Math.PI) / 180, sx = b.scaleX == null ? 1 : b.scaleX, sy = b.scaleY == null ? 1 : b.scaleY
      const la = Math.cos(r) * sx, lb = -Math.sin(r) * sy, lc = Math.sin(r) * sx, ld = Math.cos(r) * sy
      if (!p) W.set(b.name, { a: la, b: lb, c: lc, d: ld, x: b.x || 0, y: b.y || 0 })
      else W.set(b.name, { a: p.a * la + p.b * lc, b: p.a * lb + p.b * ld, c: p.c * la + p.d * lc, d: p.c * lb + p.d * ld, x: p.a * (b.x || 0) + p.b * (b.y || 0) + p.x, y: p.c * (b.x || 0) + p.d * (b.y || 0) + p.y })
    }
    return W
  }
  /**
   * The box of what an animation shows (regions, plain and weighted meshes; additive layers and a
   * full-screen backdrop are not the subject), its centre, and the draw-order index just under it.
   * targets: slot names or patterns with * to look only at those.
   */
  function subjectBox(json, animName, targets) {
    const A = (json.animations || {})[animName] || {}, W = setupMatrices(json)
    const skin = (json.skins || []).find((k) => k.name === 'default') || (json.skins || [])[0] || { attachments: {} }
    const first = (k) => (k && k.length && !(k[0].time > 0.0001) ? k[0] : null)
    const want = targets && targets.length ? new Set(resolveTargets(targets, json.slots.map((x) => x.name))) : null
    const boxes = []
    json.slots.forEach((sl, index) => {
      if (want && !want.has(sl.name)) return
      if (sl.blend && sl.blend !== 'normal') return
      const tr = (A.slots || {})[sl.name] || {}
      const fa = first(tr.attachment), fc = first(tr.color)
      const attName = fa ? fa.name : sl.attachment, color = (fc && fc.color) || sl.color || 'ffffffff'
      const everOpaque = !tr.color || tr.color.some((k) => !/00$/.test(k.color || 'ff'))
      if (!attName || (!everOpaque && /00$/.test(color))) return
      const a = (skin.attachments[sl.name] || {})[attName]; if (!a) return
      const m = W.get(sl.bone); if (!m) return
      const pts = []
      if (!a.type || a.type === 'region') {
        const w = ((a.width || 0) * (a.scaleX == null ? 1 : a.scaleX)) / 2, h = ((a.height || 0) * (a.scaleY == null ? 1 : a.scaleY)) / 2, r = ((a.rotation || 0) * Math.PI) / 180
        for (const [px, py] of [[-w, -h], [w, -h], [w, h], [-w, h]]) { const lx = (a.x || 0) + px * Math.cos(r) - py * Math.sin(r), ly = (a.y || 0) + px * Math.sin(r) + py * Math.cos(r); pts.push([m.a * lx + m.b * ly + m.x, m.c * lx + m.d * ly + m.y]) }
      } else if ((a.type === 'mesh' || a.type === 'linkedmesh') && a.vertices && a.uvs) {
        const v = a.vertices
        if (v.length === a.uvs.length) for (let i = 0; i < v.length; i += 2) pts.push([m.a * v[i] + m.b * v[i + 1] + m.x, m.c * v[i] + m.d * v[i + 1] + m.y])
        else { let i = 0; while (i < v.length) { const nb = v[i++]; let wx = 0, wy = 0; for (let k = 0; k < nb; k++) { const bm = W.get((json.bones[v[i]] || {}).name) || m, px = v[i + 1], py = v[i + 2], w = v[i + 3]; wx += (bm.a * px + bm.b * py + bm.x) * w; wy += (bm.c * px + bm.d * py + bm.y) * w; i += 4 } pts.push([wx, wy]) } }
      } else return
      if (!pts.length) return
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
      boxes.push({ index, x0, y0, x1, y1, area: (x1 - x0) * (y1 - y0) })
    })
    if (!boxes.length) return null
    const all = boxes.reduce((t, b) => ({ x0: Math.min(t.x0, b.x0), y0: Math.min(t.y0, b.y0), x1: Math.max(t.x1, b.x1), y1: Math.max(t.y1, b.y1) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
    const total = (all.x1 - all.x0) * (all.y1 - all.y0)
    const subject = boxes.filter((b) => !(b.area > total * 0.6 && boxes.length > 3))
    const use = subject.length ? subject : boxes
    const box = use.reduce((t, b) => ({ x0: Math.min(t.x0, b.x0), y0: Math.min(t.y0, b.y0), x1: Math.max(t.x1, b.x1), y1: Math.max(t.y1, b.y1), under: Math.min(t.under, b.index) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, under: Infinity })
    return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, w: box.x1 - box.x0, h: box.y1 - box.y0, under: box.under, slots: use.length }
  }
  function animationLength(a) {
    let d = 0
    const scan = (v) => { if (Array.isArray(v)) { for (const k of v) if (k && typeof k.time === 'number') d = Math.max(d, k.time) } else if (v && typeof v === 'object') for (const x of Object.values(v)) scan(x) }
    scan(a || {})
    return d
  }
  /**
   * Lay one library effect into an animation: its bones hang from a holder at the chosen point, its
   * slots are empty outside its time span, a looping effect repeats to the animation's end.
   * opts: { anim, time, x, y, scale, under (draw-order index | null), flip, rotation, tag }
   */
  function mergeEffect(source, fx, opts) {
    const o = opts || {}, json = clone(source)
    const A = json.animations && json.animations[o.anim]; if (!A) throw new Error('没有这个动画：' + o.anim)
    A.slots = A.slots || {}; A.bones = A.bones || {}
    const rootName = (json.bones.find((b) => !b.parent) || json.bones[0]).name
    const taken = new Set(json.bones.map((b) => b.name).concat(json.slots.map((x) => x.name)))
    let tag = (o.tag || 'fx_' + fx.id) + '_', n = 1
    while ([...taken].some((nm) => nm.startsWith(tag + n + '_'))) n++
    tag = tag + n + '_'
    // the holder in root space: the point and scale are given in world units
    const RW = setupMatrices(json).get(rootName), det = RW.a * RW.d - RW.b * RW.c || 1
    const wx = (o.x || 0) - RW.x, wy = (o.y || 0) - RW.y
    const rootScale = Math.sqrt(Math.abs(det)) || 1, s = (o.scale || 1) / rootScale
    const holder = tag + 'root'
    json.bones.push({ name: holder, parent: rootName, x: r2((RW.d * wx - RW.b * wy) / det), y: r2((-RW.c * wx + RW.a * wy) / det), rotation: o.rotation || 0, scaleX: r2(s * (o.stretch || 1) * (o.flip ? -1 : 1) * (det < 0 ? -1 : 1)), scaleY: r2(s) })
    const bn = (name) => tag + name
    for (const b of fx.bones) json.bones.push(Object.assign({}, b, { name: bn(b.name), parent: b.parent === 'root' ? holder : bn(b.parent) }))
    // an effect that holds (a darkened backdrop) stays to the end; settled, it is simply there from the first frame
    const stays = !!fx.hold, settled = stays && !!o.settled
    const t0 = settled ? 0 : Math.max(0, o.time || 0), D = fx.duration || animationLength(fx.animation) || 1
    const len = animationLength(A)
    // a looping effect fills the animation exactly: a whole number of loops, stretched or squeezed a little to fit
    // natural (an effect of an entrance set) never lengthens the animation: it is cut where the animation ends
    const total = (fx.loop && len - t0 > 0.3) || (o.natural && len > t0) ? len : Math.max(len, t0 + D)
    // natural: a loop running inside a one-shot animation keeps its own pace and is simply cut at the end
    const reps = fx.loop ? Math.max(1, o.natural ? Math.ceil((total - t0) / D - 1e-6) : Math.round((total - t0) / D)) : 1
    const ks = fx.loop && !o.natural ? (total - t0) / (reps * D) : 1
    const end = fx.loop || stays ? total : Math.min(t0 + D, o.natural ? total : Infinity)
    const skin = json.skins.find((k) => k.name === 'default') || json.skins[0]
    // alpha: the whole effect turned down (a set lays several lights over one another)
    const dimA = (c) => (o.alpha == null || o.alpha === 1 || !c ? c : c.slice(0, 6) + Math.max(0, Math.min(255, Math.round(parseInt(c.slice(6, 8) || 'ff', 16) * o.alpha))).toString(16).padStart(2, '0'))
    const shift = (keys, extra) => { if (settled) return [Object.assign({}, keys[keys.length - 1], { time: 0 })]; const out = []; for (let k = 0; k < reps; k++) for (const key of keys) { const t = t0 + ((key.time || 0) + k * D) * ks; if (t > end + 1e-6) continue; if (k > 0 && !(key.time > 0)) continue; out.push(Object.assign({}, key, extra, { time: t3(t) })) } return out }
    const added = []
    for (const sl of fx.slots) {
      const name = tag + sl.name, copy = Object.assign({}, sl, { name, bone: bn(sl.bone) })
      if (o.alpha != null && o.alpha !== 1) copy.color = dimA(copy.color || 'ffffffff')
      const setupAtt = copy.attachment || null; delete copy.attachment
      added.push(copy)
      if (fx.attachments[sl.name]) skin.attachments[name] = clone(fx.attachments[sl.name])
      const tr = (fx.animation.slots || {})[sl.name] || {}, mine = (A.slots[name] = {})
      const att = tr.attachment ? shift(tr.attachment) : []
      const keys = []
      if (t0 > 0) keys.push({ time: 0, name: null })
      if (setupAtt && !(att.length && att[0].time <= t0 + 1e-6)) keys.push({ time: t3(t0), name: setupAtt })
      keys.push(...att)
      if (!stays && !(o.natural && end >= total - 1e-6) && (!fx.loop || end < total - 1e-6)) keys.push({ time: t3(end + 0.0334), name: null })
      mine.attachment = keys.filter((k, i, arr) => i === 0 || k.time > arr[i - 1].time + 1e-6)
      if (tr.color) mine.color = (t0 > 0 && !settled ? [Object.assign({}, tr.color[0], { time: 0, curve: 'stepped' })] : []).concat(shift(tr.color)).map((k) => (k.color ? Object.assign({}, k, { color: dimA(k.color) }) : k))
    }
    for (const [b, tr] of Object.entries(fx.animation.bones || {})) {
      const mine = (A.bones[bn(b)] = {})
      for (const [kind, keys] of Object.entries(tr)) mine[kind] = (t0 > 0 && !settled ? [Object.assign({}, keys[0], { time: 0, curve: 'stepped' })] : []).concat(shift(keys))
    }
    if (o.under != null && o.under >= 0 && o.under < json.slots.length) json.slots.splice(o.under, 0, ...added); else json.slots.push(...added)
    return { json, holder, slots: added.map((x) => x.name), time: t0, end: t3(end), repeats: reps }
  }

  /**
   * The swing of an animation, read from what moves on screen. tracks: one Float32Array [x0,y0,x1,y1,…]
   * per traced picture corner / mesh vertex, one pair per frame. Returns the frame of fastest motion,
   * the span around it, and the path of the point that travels farthest in that span (the weapon tip
   * in an attack): start, middle, end, the chord's angle and which side the arc bulges to.
   */
  function swingFromTracks(tracks, frames, fps, centre) {
    if (!tracks || !tracks.length || frames < 3) return null
    const F = frames, energy = new Float32Array(F)
    // a track may cover only part of the animation (NaN where its picture is not shown)
    const step = (t, f) => { const d = Math.hypot(t[f * 2 + 2] - t[f * 2], t[f * 2 + 3] - t[f * 2 + 1]); return d === d ? d : 0 }
    for (let f = 0; f < F - 1; f++) {
      const sp = []
      for (const t of tracks) if (t[f * 2] === t[f * 2]) sp.push(step(t, f))
      if (!sp.length) continue
      sp.sort((a, b) => b - a)
      const n = Math.max(1, Math.round(sp.length * 0.15)); let e = 0
      for (let i = 0; i < n; i++) e += sp[i]
      energy[f] = e / n
    }
    const sm = new Float32Array(F)
    for (let f = 0; f < F; f++) sm[f] = (energy[Math.max(0, f - 1)] + 2 * energy[f] + energy[Math.min(F - 1, f + 1)]) / 4
    let peak = 0
    for (let f = 1; f < F; f++) if (sm[f] > sm[peak]) peak = f
    if (!(sm[peak] > 0)) return null
    let a = peak, b = peak + 1
    while (a > 0 && peak - a < 6 && sm[a - 1] > sm[peak] * 0.4) a--
    while (b < F - 1 && b - peak < 6 && sm[b] > sm[peak] * 0.4) b++
    if (b - a < 2) { a = Math.max(0, a - 1); b = Math.min(F - 1, b + 1) }
    let best = null, far = 0
    // among the points that travel far, the one that ends farthest out from the body is the striking end
    // (a staff turning in the hand moves both ends; the blow lands where it reaches out)
    const paths = tracks.map((t) => { let d = 0; for (let f = a; f < b; f++) d += step(t, f); return d })
    for (const d of paths) if (d > far) far = d
    let score = -1
    tracks.forEach((t, i) => {
      if (!(paths[i] >= far * 0.6) || !(far > 0)) return
      let e = b; while (e > a && t[e * 2] !== t[e * 2]) e--
      const out = centre ? Math.hypot(t[e * 2] - centre[0], t[e * 2 + 1] - centre[1]) : 0, s = centre ? out * (0.5 + 0.5 * paths[i] / far) : paths[i]
      if (s > score) { score = s; best = t }
    })
    if (best) far = paths[tracks.indexOf(best)]
    if (!best || !(far > 0)) return null
    while (a < b && best[a * 2] !== best[a * 2]) a++
    while (b > a && best[b * 2] !== best[b * 2]) b--
    if (b - a < 1) return null
    const at = (f) => [best[f * 2], best[f * 2 + 1]], S = at(a), E = at(b)
    // the point of the path farthest from the chord tells the bulge
    let M = at(Math.round((a + b) / 2)), off = 0
    const cx = E[0] - S[0], cy = E[1] - S[1], cl = Math.hypot(cx, cy) || 1
    for (let f = a + 1; f < b; f++) { const p = at(f), d = (cx * (p[1] - S[1]) - cy * (p[0] - S[0])) / cl; if (Math.abs(d) > Math.abs(off)) { off = d; M = p } }
    return { frame: peak, from: a, to: b, time: t3(Math.max(0, a - 1) / fps), peakTime: t3(peak / fps), start: S, end: E, mid: M, chord: Math.hypot(cx, cy), path: far,
      angle: (Math.atan2(cy, cx) * 180) / Math.PI, bulge: Math.abs(off) < cl * 0.04 ? 0 : off > 0 ? 1 : -1, speed: sm[peak] }
  }
  /** Where a library arc (drawn top-left to bottom-right, bulging to the right of its travel) goes for a swing. */
  const ARC = { angle: -43, bulge: -1, chord: 0.73 }
  function placeArc(swing, span, seqScale) {
    const flip = swing.bulge !== 0 && swing.bulge !== ARC.bulge
    const native = flip ? 180 - ARC.angle : ARC.angle
    let rot = swing.angle - native; while (rot > 180) rot -= 360; while (rot < -180) rot += 360
    const reach = Math.max(swing.chord, Math.min(swing.path * 0.8, swing.chord * 1.3))
    return { x: (swing.start[0] + swing.end[0]) * 0.25 + swing.mid[0] * 0.5, y: (swing.start[1] + swing.end[1]) * 0.25 + swing.mid[1] * 0.5, rotation: r2(rot), flip, scale: (reach * 1.7) / (ARC.chord * span * (seqScale || 1)) }
  }
  /** The mean drift of everything on screen over the first frames: which way a hit throws the body. */
  function driftFromTracks(tracks, frames, n) {
    if (!tracks || !tracks.length) return [0, 0]
    const f = Math.max(1, Math.min(frames - 1, n)); let x = 0, y = 0
    let cnt = 0
    for (const t of tracks) { const dx = t[f * 2] - t[0], dy = t[f * 2 + 1] - t[1]; if (dx === dx && dy === dy) { x += dx; y += dy; cnt++ } }
    return cnt ? [x / cnt, y / cnt] : [0, 0]
  }
  // Tones: the hue an effect is turned to. An effect's own hue is in the library index.
  const TONES = { fire: 12, gold: 45, green: 125, ice: 200, purple: 280 }
  /** The tone that suits a subject, from its hue histogram (36 bins of 10°, weighted by saturation). null: no clear colour. */
  function toneFromHues(bins, total) {
    let sum = 0; for (const v of bins) sum += v
    if (!(sum > 0) || (total > 0 && sum / total < 0.06)) return null
    let best = null, bw = 0
    for (const [tone, hue] of Object.entries(TONES)) { let w = 0; for (let i = 0; i < 36; i++) { let d = Math.abs(i * 10 + 5 - hue); if (d > 180) d = 360 - d; if (d <= 35) w += bins[i] * (1 - d / 70) } if (w > bw) { bw = w; best = tone } }
    return bw / sum > 0.3 ? best : null
  }
  /** Turn the hue of straight-alpha RGBA pixels by deg, in place; whites and greys stay as they are. */
  function shiftHue(px, deg) {
    const d = ((deg % 360) + 360) % 360; if (!d) return px
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn
      if (c < 0.02) continue
      let h = mx === r ? ((g - b) / c + 6) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4
      h = (h * 60 + d) % 360
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1)), k = Math.floor(h / 60)
      const [r1, g1, b1] = k === 0 ? [c, x, 0] : k === 1 ? [x, c, 0] : k === 2 ? [0, c, x] : k === 3 ? [0, x, c] : k === 4 ? [x, 0, c] : [c, 0, x]
      px[i] = Math.round((r1 + mn) * 255); px[i + 1] = Math.round((g1 + mn) * 255); px[i + 2] = Math.round((b1 + mn) * 255)
    }
    return px
  }
  /** A copy of a library effect whose pictures carry a suffix (a toned set lives beside the plain one). */
  function renameEffectPictures(fx, suffix) {
    const out = clone(fx), nm = (n) => (n ? n + suffix : n)
    out.pictures = fx.pictures.map(nm)
    for (const sl of out.slots) if (sl.attachment) sl.attachment = nm(sl.attachment)
    out.attachments = {}
    for (const [slot, m] of Object.entries(fx.attachments)) { out.attachments[slot] = {}; for (const [n, a] of Object.entries(m)) out.attachments[slot][nm(n)] = Object.assign({}, a, { path: nm(a.path || n) }) }
    for (const tr of Object.values(out.animation.slots || {})) if (tr.attachment) tr.attachment = tr.attachment.map((k) => Object.assign({}, k, { name: nm(k.name) }))
    return out
  }

  /** When an effect of this kind belongs in the animation: at the start, or on the strike (the 'hit' event, else 40 %). */
  function effectTime(json, animName, when) {
    const A = (json.animations || {})[animName] || {}
    if (when !== 'strike') return 0
    const e = (A.events || []).find((x) => /hit|attack|strike|打击|命中/i.test(x.name || ''))
    return e ? e.time || 0 : t3(animationLength(A) * 0.4)
  }

  return { MOTIONS, synthesize, resolveTargets, extractClip, applyClip, subjectBox, mergeEffect, effectTime, animationLength, swingFromTracks, placeArc, driftFromTracks, TONES, toneFromHues, shiftHue, renameEffectPictures, rigMap, ensureLayerBones, slotCenters, projectFromLayers, _internals: { sineKeys, bakeSprings, setupWorld, basePose, chainWaves } }
})
