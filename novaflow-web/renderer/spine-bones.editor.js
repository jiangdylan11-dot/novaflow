/*
 * NovaFlow — 骨骼架设 (bone rigging) editor for the 骨骼动画 section.
 *
 * Spine's setup-mode bone tools over the preview canvas: select, move a joint,
 * rotate, create (click-drag, named like Spine: bone, bone2, …), delete, rename and
 * re-parent, with undo. The automatic skeleton (spine-auto-bones) is a starting
 * point; this is where its mistakes are corrected by hand.
 *
 * Every edit is a set of JOINT moves. A joint is any bone endpoint (origin or
 * tip); dragging one moves every endpoint that coincides with it — the parent's
 * tip, the child's origin, the IK target and the pivot sitting on the same point —
 * and a bone is re-derived from its two endpoints (x/y from the origin, rotation
 * and length from the tip). Endpoints that did not move keep their WORLD position:
 * children are compensated through their local transforms and every attachment is
 * re-expressed in its bone's new frame, so the artwork never moves while the rig
 * is edited (Spine's "compensate" for images and children, always on).
 *
 * The auto rig's mechanisms (a zero-length pivot, joint / end targets and a hidden
 * two-bone helper chain per limb, see spine-auto-bones `mechanize`) are parsed
 * back from the constraints and rebuilt after every edit, so moving a knee keeps
 * the helper chain, its bend and the follow offsets consistent. Bones that belong
 * to a mechanism are shown but not editable: they follow the joints.
 *
 * World transforms are the plain FK tree (Spine 3.8 `updateWorldTransform`, all
 * inherit modes); constraints are not applied to the display. For the auto rig the
 * constraints are neutral at the setup pose, so the drawn bones match the runtime.
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowBonesEditor = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const DEG = 180 / Math.PI, RAD = Math.PI / 180
  const ACCENT = '#22c98a'
  /**
   * One palette for every place bones are drawn (编辑骨骼 on or off), by role:
   * plain deform bones blue, bones a constraint drives violet, controls (IK / transform
   * targets, pivots, zero-length handles) amber, the auto rig's hidden helper chains dim.
   */
  const ROLE_COLORS = {
    bone: { line: '#8fd3ff', hover: '#ffffff', fill: '#4aa8e0', fillAlpha: 0.55, label: '#fff' },
    driven: { line: '#c79bff', hover: '#e6d4ff', fill: '#7d5cc6', fillAlpha: 0.5, label: '#e6d4ff' },
    control: { line: '#ffb454', hover: '#ffe0a8', fill: '#ff9a3c', fillAlpha: 0.45, label: '#ffc58a' },
    helper: { line: '#ff9a3c', hover: '#ffc58a', fill: '#ff9a3c', fillAlpha: 0.3, label: '#ffc58a' }
  }
  const TOOLS = [
    { id: 'move', label: '移动', key: 'v', hint: '拖动移动骨骼。普通骨:拖关节点=改关节位置(骨骼重算,画面不动),拖骨身=平移整根骨。控制骨(IK/约束目标、零长度骨、枢轴):拖=摆姿势,子骨和图片跟着走、约束联动,拖骨尖=转动。按住 Alt 拖普通骨也是摆姿势;按住 Shift 拖控制骨则改它所在的关节。P=指定父骨(再点一根骨),Shift+P=挂到 root,也可以在右侧骨骼树里拖一根骨到另一根上。任何工具下点一下骨骼都能选中它' },
    { id: 'rotate', label: '旋转', key: 'r', hint: '拖动旋转选中的骨骼(绕它的起点)。控制骨或按住 Alt:摆姿势,子骨/图片跟着转、约束联动(零长度的枢轴也能转);普通骨:改骨架,骨尖上的关节跟着转、画面不动' },
    { id: 'scale', label: '缩放', key: 's', hint: '拖动缩放选中的骨骼(沿它自己的两个轴;按住 Shift 等比)。子骨和这根骨上的图片跟着缩放,和 Spine 的缩放一样' },
    { id: 'create', label: '新建', key: 'n', hint: '按下确定起点、拖到终点松开;新骨挂在选中骨骼下(没有就挂 root);单击得到一根零长度的控制骨' }
  ]

  // ------------------------------------------------------------ bone tree ---

  const bonesOf = (skel) => (skel && Array.isArray(skel.bones) ? skel.bones : [])
  const num = (v, d) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v))
  const rnd = (v) => Math.round(v * 100) / 100

  function localOf(b) {
    return {
      x: num(b.x, 0), y: num(b.y, 0), rotation: num(b.rotation, 0),
      scaleX: num(b.scaleX, 1), scaleY: num(b.scaleY, 1), shearX: num(b.shearX, 0), shearY: num(b.shearY, 0),
      length: num(b.length, 0), mode: b.transform || b.inherit || 'normal'
    }
  }

  /** Spine 3.8 Bone.updateWorldTransformWith, skeleton scale 1. */
  function worldMatrix(parent, L) {
    const { x, y, rotation, scaleX, scaleY, shearX, shearY } = L
    if (!parent) {
      const ry = rotation + 90 + shearY
      return {
        a: Math.cos((rotation + shearX) * RAD) * scaleX, b: Math.cos(ry * RAD) * scaleY,
        c: Math.sin((rotation + shearX) * RAD) * scaleX, d: Math.sin(ry * RAD) * scaleY,
        worldX: x, worldY: y
      }
    }
    let pa = parent.a, pb = parent.b, pc = parent.c, pd = parent.d
    const worldX = pa * x + pb * y + parent.worldX, worldY = pc * x + pd * y + parent.worldY
    let a, b, c, d
    const mode = L.mode
    if (mode === 'onlyTranslation') {
      const ry = rotation + 90 + shearY
      a = Math.cos((rotation + shearX) * RAD) * scaleX; b = Math.cos(ry * RAD) * scaleY
      c = Math.sin((rotation + shearX) * RAD) * scaleX; d = Math.sin(ry * RAD) * scaleY
    } else if (mode === 'noRotationOrReflection') {
      let s = pa * pa + pc * pc, prx
      if (s > 0.0001) {
        s = Math.abs(pa * pd - pb * pc) / s
        pb = pc * s; pd = pa * s
        prx = Math.atan2(pc, pa) * DEG
      } else { pa = 0; pc = 0; prx = 90 - Math.atan2(pd, pb) * DEG }
      const rx = (rotation + shearX - prx) * RAD, ry = (rotation + shearY - prx + 90) * RAD
      const la = Math.cos(rx) * scaleX, lb = Math.cos(ry) * scaleY, lc = Math.sin(rx) * scaleX, ld = Math.sin(ry) * scaleY
      a = pa * la - pb * lc; b = pa * lb - pb * ld; c = pc * la + pd * lc; d = pc * lb + pd * ld
    } else if (mode === 'noScale' || mode === 'noScaleOrReflection') {
      const cos = Math.cos(rotation * RAD), sin = Math.sin(rotation * RAD)
      let za = pa * cos + pb * sin, zc = pc * cos + pd * sin
      let s = Math.sqrt(za * za + zc * zc)
      if (s > 0.00001) s = 1 / s
      za *= s; zc *= s
      s = Math.sqrt(za * za + zc * zc)
      if (mode === 'noScale' && (pa * pd - pb * pc < 0)) s = -s
      const r = Math.PI / 2 + Math.atan2(zc, za)
      const zb = Math.cos(r) * s, zd = Math.sin(r) * s
      const la = Math.cos(shearX * RAD) * scaleX, lb = Math.cos((90 + shearY) * RAD) * scaleY
      const lc = Math.sin(shearX * RAD) * scaleX, ld = Math.sin((90 + shearY) * RAD) * scaleY
      a = za * la + zb * lc; b = za * lb + zb * ld; c = zc * la + zd * lc; d = zc * lb + zd * ld
    } else {
      const ry = rotation + 90 + shearY
      const la = Math.cos((rotation + shearX) * RAD) * scaleX, lb = Math.cos(ry * RAD) * scaleY
      const lc = Math.sin((rotation + shearX) * RAD) * scaleX, ld = Math.sin(ry * RAD) * scaleY
      a = pa * la + pb * lc; b = pa * lb + pb * ld; c = pc * la + pd * lc; d = pc * lb + pd * ld
    }
    return { a, b, c, d, worldX, worldY }
  }

  /** World transforms of every bone (FK, no constraints), in array order. */
  function worldTransforms(skel) {
    const bones = bonesOf(skel)
    const index = new Map(bones.map((b, i) => [b.name, i]))
    const W = new Array(bones.length)
    const solve = (i, guard) => {
      if (W[i]) return W[i]
      const b = bones[i]
      const p = b.parent !== undefined && b.parent !== null && index.has(b.parent) ? index.get(b.parent) : -1
      const pm = p >= 0 && p !== i && (guard || 0) < bones.length ? solve(p, (guard || 0) + 1) : null
      const L = localOf(b)
      const m = worldMatrix(pm, L)
      m.length = L.length; m.name = b.name; m.parent = p
      W[i] = m
      return m
    }
    for (let i = 0; i < bones.length; i++) solve(i, 0)
    return W
  }

  const tipOf = (m) => [m.worldX + m.a * m.length, m.worldY + m.c * m.length]

  function invert2(m) {
    const det = m.a * m.d - m.b * m.c
    const id = Math.abs(det) < 1e-12 ? 0 : 1 / det
    return { ia: m.d * id, ib: -m.b * id, ic: -m.c * id, id: m.a * id }
  }
  /** World point → parent-local point (identity parent when null). */
  function toLocalPoint(parent, wx, wy) {
    if (!parent) return [wx, wy]
    const inv = invert2(parent)
    const dx = wx - parent.worldX, dy = wy - parent.worldY
    return [inv.ia * dx + inv.ib * dy, inv.ic * dx + inv.id * dy]
  }
  /** World direction → parent-local direction (linear part only). */
  function toLocalDir(parent, dx, dy) {
    if (!parent) return [dx, dy]
    const inv = invert2(parent)
    return [inv.ia * dx + inv.ib * dy, inv.ic * dx + inv.id * dy]
  }
  const worldRot = (m) => Math.atan2(m.c, m.a) * DEG
  function wrap180(v) { while (v > 180) v -= 360; while (v < -180) v += 360; return v }

  /**
   * Spine 3.8 Bone.updateAppliedTransform: the local transform that reproduces
   * `m` under `parent`. Exact for the normal inherit mode; other modes keep the
   * rotation they had (their world rotation does not follow the parent).
   */
  function localFromWorld(parent, m, L) {
    if (!parent) return { x: m.worldX, y: m.worldY, rotation: L.rotation, scaleX: L.scaleX, scaleY: L.scaleY, shearX: L.shearX, shearY: L.shearY }
    const [x, y] = toLocalPoint(parent, m.worldX, m.worldY)
    if (L.mode !== 'normal') {
      let rotation = L.rotation
      if (L.mode === 'noScale' || L.mode === 'noScaleOrReflection') rotation = wrap180(worldRot(m) - worldRot(parent))
      return { x, y, rotation, scaleX: L.scaleX, scaleY: L.scaleY, shearX: L.shearX, shearY: L.shearY }
    }
    const pa = parent.a, pb = parent.b, pc = parent.c, pd = parent.d
    const det = pa * pd - pb * pc
    const pid = Math.abs(det) < 1e-12 ? 0 : 1 / det
    const ia = pid * pd, id = pid * pa, ib = pid * pb, ic = pid * pc
    const ra = ia * m.a - ib * m.c, rb = ia * m.b - ib * m.d, rc = id * m.c - ic * m.a, rd = id * m.d - ic * m.b
    let scaleX = Math.sqrt(ra * ra + rc * rc), scaleY, shearY, rotation
    if (scaleX > 0.0001) {
      const d2 = ra * rd - rb * rc
      scaleY = d2 / scaleX
      shearY = Math.atan2(ra * rb + rc * rd, d2) * DEG
      rotation = Math.atan2(rc, ra) * DEG
    } else {
      scaleX = 0; scaleY = Math.sqrt(rb * rb + rd * rd); shearY = 0; rotation = 90 - Math.atan2(rd, rb) * DEG
    }
    return { x, y, rotation: wrap180(rotation), scaleX, scaleY, shearX: 0, shearY: wrap180(shearY) }
  }

  function writeLocal(b, L) {
    const set = (k, v, dflt) => { if (Math.abs(v - dflt) < 1e-9) delete b[k]; else b[k] = rnd(v) }
    set('x', L.x, 0); set('y', L.y, 0); set('rotation', L.rotation, 0)
    set('scaleX', L.scaleX, 1); set('scaleY', L.scaleY, 1); set('shearX', L.shearX, 0); set('shearY', L.shearY, 0)
  }

  const clone = (o) => JSON.parse(JSON.stringify(o))
  /**
   * The cheap copy every drag step uses: bones, constraints and slots (what edits change)
   * are copied, skins / animations / events (300 KB on a real rig) are SHARED. Whoever
   * mutates an attachment forks the skins first (`forkAttachments`), so the shared copies
   * in the undo history never see the change. A full `clone` is kept for the rare
   * structural edits (add / delete / rename / re-parent).
   */
  const cloneRig = (skel) => {
    if (!skel || typeof skel !== 'object') return skel
    const out = Object.assign({}, skel)
    for (const k of ['bones', 'ik', 'transform', 'path', 'slots']) if (Array.isArray(skel[k])) out[k] = clone(skel[k])
    return out
  }
  /** Give `skel` its own attachment objects (shallow) with their own `vertices` arrays; uvs / triangles stay shared. */
  function forkAttachments(skel) {
    const forkAtt = (att) => { if (!att || typeof att !== 'object') return att; const a = Object.assign({}, att); if (Array.isArray(att.vertices)) a.vertices = att.vertices.slice(); return a }
    const forkMap = (attachments) => { const m = {}; for (const slot of Object.keys(attachments || {})) { const sl = {}; for (const name of Object.keys(attachments[slot] || {})) sl[name] = forkAtt(attachments[slot][name]); m[slot] = sl } return m }
    if (Array.isArray(skel.skins)) skel.skins = skel.skins.map((sk) => (sk && typeof sk === 'object' ? Object.assign({}, sk, { attachments: forkMap(sk.attachments) }) : sk))
    else if (skel.skins && typeof skel.skins === 'object') { const o = {}; for (const k of Object.keys(skel.skins)) o[k] = forkMap(skel.skins[k]); skel.skins = o }
    return skel
  }

  // ---------------------------------------------------------------- edits ---

  /** Every skin's attachments as [{slot, name, att}]. */
  function attachmentList(skel) {
    const out = []
    const visit = (attachments) => {
      for (const slot of Object.keys(attachments || {})) for (const name of Object.keys(attachments[slot] || {})) {
        const att = attachments[slot][name]
        if (att && typeof att === 'object') out.push({ slot, name, att })
      }
    }
    if (Array.isArray(skel.skins)) for (const s of skel.skins) visit(s && s.attachments)
    else if (skel.skins) for (const k of Object.keys(skel.skins)) visit(skel.skins[k])
    return out
  }

  /** inv(W1) · W0: how a point expressed in the old frame moves to the new one. */
  function deltaTransform(W0, W1) {
    const inv = invert2(W1)
    const a = inv.ia * W0.a + inv.ib * W0.c, b = inv.ia * W0.b + inv.ib * W0.d
    const c = inv.ic * W0.a + inv.id * W0.c, d = inv.ic * W0.b + inv.id * W0.d
    const dx = W0.worldX - W1.worldX, dy = W0.worldY - W1.worldY
    return { a, b, c, d, tx: inv.ia * dx + inv.ib * dy, ty: inv.ic * dx + inv.id * dy }
  }
  const applyDelta = (D, x, y) => [D.a * x + D.b * y + D.tx, D.c * x + D.d * y + D.ty]

  /**
   * Re-express every attachment whose bone's world frame changed, so the artwork
   * stays where it is. Weighted vertices are re-expressed per bone.
   */
  function compensateAttachments(skel, W0, W1, changed) {
    if (!changed || !changed.size) return
    forkAttachments(skel)
    const bones = bonesOf(skel)
    const index = new Map(bones.map((b, i) => [b.name, i]))
    const slotBone = new Map((skel.slots || []).map((s) => [s.name, index.get(s.bone)]))
    const deltas = new Map()
    const deltaFor = (i) => { if (!deltas.has(i)) deltas.set(i, deltaTransform(W0[i], W1[i])); return deltas.get(i) }
    for (const { slot, att } of attachmentList(skel)) {
      const type = att.type || 'region'
      const bi = slotBone.get(slot)
      const vertices = Array.isArray(att.vertices) ? att.vertices : null
      const nVerts = type === 'mesh' ? (att.uvs ? att.uvs.length / 2 : 0) : (num(att.vertexCount, 0))
      const weighted = vertices && nVerts > 0 && vertices.length !== nVerts * 2
      if (weighted) {
        // [count, boneIndex, x, y, weight, ...] per vertex
        const v = vertices
        let k = 0
        for (let i = 0; i < nVerts && k < v.length; i++) {
          const cnt = v[k++]
          for (let j = 0; j < cnt; j++, k += 4) {
            const b = v[k]
            if (!changed.has(b)) continue
            const D = deltaFor(b)
            const [x, y] = applyDelta(D, v[k + 1], v[k + 2])
            v[k + 1] = rnd(x); v[k + 2] = rnd(y)
          }
        }
        continue
      }
      if (bi === undefined || !changed.has(bi)) continue
      const D = deltaFor(bi)
      if (type === 'region' || type === 'point') {
        const [x, y] = applyDelta(D, num(att.x, 0), num(att.y, 0))
        att.x = rnd(x); att.y = rnd(y)
        const rot = wrap180(num(att.rotation, 0) + Math.atan2(D.c, D.a) * DEG)
        if (Math.abs(rot) < 1e-9) delete att.rotation; else att.rotation = rnd(rot)
      } else if (vertices && (type === 'mesh' || type === 'boundingbox' || type === 'path' || type === 'clipping')) {
        for (let i = 0; i + 1 < vertices.length; i += 2) {
          const [x, y] = applyDelta(D, vertices[i], vertices[i + 1])
          vertices[i] = rnd(x); vertices[i + 1] = rnd(y)
        }
      }
    }
  }

  /**
   * Set new world endpoints for some bones and keep everything else in place.
   * `targets`: Map<boneIndex, {origin?: [x, y], tip?: [x, y]}>.
   * Returns {skeleton, changed(Set of bone indices whose world frame changed), W0, W1}.
   */
  function setEndpoints(skel, targets) {
    const out = cloneRig(skel)
    const bones = bonesOf(out)
    const index = new Map(bones.map((b, i) => [b.name, i]))
    const W0 = worldTransforms(out)
    const W1 = new Array(bones.length)
    const changed = new Set()
    const order = topoOrder(bones, index)
    for (const i of order) {
      const b = bones[i]
      const p = W0[i].parent
      const pm = p >= 0 ? W1[p] : null
      const t = targets.get(i)
      const parentChanged = p >= 0 && changed.has(p)
      if (!t && !parentChanged) { W1[i] = W0[i]; continue }
      const L = localOf(b)
      if (t) {
        const o0 = [W0[i].worldX, W0[i].worldY], tip0 = tipOf(W0[i])
        const o1 = t.origin || o0, tip1 = t.tip || tip0
        const [lx, ly] = toLocalPoint(pm, o1[0], o1[1])
        L.x = lx; L.y = ly
        const dx = tip1[0] - o1[0], dy = tip1[1] - o1[1]
        const dist = Math.hypot(dx, dy)
        if (dist > 1e-6 && (L.length > 0 || t.tip)) {
          let dl
          if (L.mode === 'onlyTranslation' || L.mode === 'noRotationOrReflection') dl = [dx, dy]
          else if (L.mode === 'noScale' || L.mode === 'noScaleOrReflection') { const pr = pm ? worldRot(pm) * RAD : 0; dl = [Math.cos(-pr) * dx - Math.sin(-pr) * dy, Math.sin(-pr) * dx + Math.cos(-pr) * dy] }
          else dl = toLocalDir(pm, dx, dy)
          L.rotation = wrap180(Math.atan2(dl[1], dl[0]) * DEG - L.shearX)
          const m = worldMatrix(pm, L)
          const sx = Math.hypot(m.a, m.c)
          L.length = sx > 1e-9 ? dist / sx : dist
        } else if (dist <= 1e-6) {
          L.length = 0
        }
        writeLocal(b, L)
        if (L.length > 1e-6) b.length = rnd(L.length); else delete b.length
        const m = worldMatrix(pm, L)
        m.length = L.length; m.name = b.name; m.parent = p
        W1[i] = m
        const same = Math.abs(m.worldX - W0[i].worldX) < 1e-6 && Math.abs(m.worldY - W0[i].worldY) < 1e-6 && Math.abs(m.a - W0[i].a) < 1e-9 && Math.abs(m.c - W0[i].c) < 1e-9 && Math.abs(m.b - W0[i].b) < 1e-9 && Math.abs(m.d - W0[i].d) < 1e-9
        if (!same) changed.add(i)
      } else {
        // the parent moved: keep this bone's world frame
        const NL = localFromWorld(pm, W0[i], L)
        L.x = NL.x; L.y = NL.y; L.rotation = NL.rotation; L.scaleX = NL.scaleX; L.scaleY = NL.scaleY; L.shearX = NL.shearX; L.shearY = NL.shearY
        writeLocal(b, L)
        const m = Object.assign({}, W0[i])   // by construction its world is unchanged
        W1[i] = m
      }
    }
    compensateAttachments(out, W0, W1, changed)
    return { skeleton: out, changed, W0, W1 }
  }

  /** Parents before children, keeping the array order otherwise. */
  function topoOrder(bones, index) {
    const out = [], seen = new Set()
    const visit = (i, depth) => {
      if (seen.has(i) || depth > bones.length) return
      const b = bones[i]
      const p = b.parent !== undefined && b.parent !== null && index.has(b.parent) ? index.get(b.parent) : -1
      if (p >= 0 && p !== i) visit(p, depth + 1)
      seen.add(i); out.push(i)
    }
    for (let i = 0; i < bones.length; i++) visit(i, 0)
    return out
  }

  /** Every endpoint within `tol` world units of (x, y): [{index, end: 'origin'|'tip'}]. */
  function endpointsAt(W, x, y, tol) {
    const out = []
    for (let i = 0; i < W.length; i++) {
      const m = W[i]
      if (Math.hypot(m.worldX - x, m.worldY - y) <= tol) out.push({ index: i, end: 'origin' })
      if (m.length > 0) { const t = tipOf(m); if (Math.hypot(t[0] - x, t[1] - y) <= tol) out.push({ index: i, end: 'tip' }) }
    }
    return out
  }

  function addTarget(targets, index, end, pt) {
    const t = targets.get(index) || {}
    t[end] = [pt[0], pt[1]]
    targets.set(index, t)
  }

  /** Move the joint at `from` (every coincident endpoint) to `to`. */
  function moveJoint(skel, from, to, opts) {
    const o = opts || {}
    const W = o.W || worldTransforms(skel)
    const tol = o.tol === undefined ? 1.5 : o.tol
    const targets = new Map()
    for (const e of endpointsAt(W, from[0], from[1], tol)) { if (o.frozen && o.frozen.has(e.index)) continue; addTarget(targets, e.index, e.end, to) }
    if (!targets.size) return { skeleton: skel, changed: new Set() }
    return setEndpoints(skel, targets)
  }

  /** Translate one bone (both endpoints) and whatever coincides with them. */
  function translateBone(skel, index, dx, dy, opts) {
    const o = opts || {}
    const W = o.W || worldTransforms(skel)
    const tol = o.tol === undefined ? 1.5 : o.tol
    const m = W[index]
    const targets = new Map()
    const o0 = [m.worldX, m.worldY], t0 = tipOf(m)
    for (const e of endpointsAt(W, o0[0], o0[1], tol)) addTarget(targets, e.index, e.end, [o0[0] + dx, o0[1] + dy])
    if (m.length > 0) for (const e of endpointsAt(W, t0[0], t0[1], tol)) addTarget(targets, e.index, e.end, [t0[0] + dx, t0[1] + dy])
    addTarget(targets, index, 'origin', [o0[0] + dx, o0[1] + dy])
    if (m.length > 0) addTarget(targets, index, 'tip', [t0[0] + dx, t0[1] + dy])
    // the whole branch goes with it, as Spine's translate: a child kept in place had its
    // origin dragged along (when it sat on this tip) and its tip left behind, so the chain
    // stretched and broke - or stayed behind entirely when its origin was a little off
    const inBranch = (i) => { for (let p = W[i].parent, n = 0; p >= 0 && n <= W.length; p = W[p].parent, n++) if (p === index) return true; return false }
    for (let i = 0; i < W.length; i++) {
      if (i === index || !inBranch(i)) continue
      const d = W[i]
      addTarget(targets, i, 'origin', [d.worldX + dx, d.worldY + dy])
      if (d.length > 0) { const t = tipOf(d); addTarget(targets, i, 'tip', [t[0] + dx, t[1] + dy]) }
    }
    if (o.frozen) for (const k of o.frozen) if (k !== index) targets.delete(k)
    return setEndpoints(skel, targets)
  }

  /**
   * Move one CONTROL bone (an IK target, a limb pivot) on its own: only its local x/y
   * change, nothing is compensated and no mechanism is rebuilt — the runtime's
   * constraints then pull the chain after it, which is what the display shows.
   */
  function poseMove(skel, index, dx, dy) {
    const out = cloneRig(skel)
    const W = worldTransforms(out)
    const m = W[index]
    if (!m) return null
    const b = out.bones[index]
    const L = localOf(b)
    const pm = m.parent >= 0 ? W[m.parent] : null
    const [lx, ly] = toLocalPoint(pm, m.worldX + dx, m.worldY + dy)
    L.x = lx; L.y = ly
    writeLocal(b, L)
    return { skeleton: out, changed: new Set([index]) }
  }

  /**
   * Pose rotation: turn one bone about its origin by `deltaDeg` in WORLD terms — its
   * children and images follow, nothing is compensated, and the runtime's constraints
   * do the rest (Spine's setup mode). Works for zero-length bones, which is what the
   * pivots and turn controls are.
   */
  function poseRotate(skel, index, deltaDeg) {
    const out = cloneRig(skel); const W = worldTransforms(out); const m = W[index]; if (!m) return null
    const b = out.bones[index]; const L = localOf(b); const pm = m.parent >= 0 ? W[m.parent] : null
    if (L.mode === 'noRotationOrReflection' || L.mode === 'onlyTranslation') L.rotation = wrap180(L.rotation + deltaDeg)
    else {
      const r = deltaDeg * RAD, cs = Math.cos(r), sn = Math.sin(r)
      // the world frame turned by delta; the local rotation that produces it accounts
      // for a reflected or sheared parent (adding delta locally would turn the wrong way)
      const m2 = { a: cs * m.a - sn * m.c, b: cs * m.b - sn * m.d, c: sn * m.a + cs * m.c, d: sn * m.b + cs * m.d, worldX: m.worldX, worldY: m.worldY }
      L.rotation = localFromWorld(pm, m2, L).rotation
    }
    writeLocal(b, L)
    return { skeleton: out, changed: new Set([index]) }
  }

  /** Bones a constraint DRIVES (an IK / transform / path constraint lists them in `bones`). */
  function constrainedOf(skel) {
    const bones = bonesOf(skel)
    const byName = new Map(bones.map((b, i) => [b.name, i]))
    const out = new Set()
    for (const key of ['ik', 'transform', 'path']) {
      for (const c of (Array.isArray(skel[key]) ? skel[key] : [])) {
        for (const n of (Array.isArray(c && c.bones) ? c.bones : [])) { const i = byName.get(n); if (i !== undefined) out.add(i) }
      }
    }
    return out
  }

  /**
   * Pose scale: multiply the bone's own scale, the way Spine's scale tool does — its
   * children and the images on it scale with it, nothing is compensated.
   */
  function poseScale(skel, index, mulX, mulY) {
    const out = cloneRig(skel)
    const b = out.bones[index]
    if (!b) return null
    const L = localOf(b)
    const sx = clampScale(L.scaleX * (Number.isFinite(mulX) ? mulX : 1))
    const sy = clampScale(L.scaleY * (Number.isFinite(mulY) ? mulY : 1))
    if (Math.abs(sx - L.scaleX) < 1e-6 && Math.abs(sy - L.scaleY) < 1e-6) return null
    L.scaleX = sx; L.scaleY = sy
    writeLocal(b, L)
    return { skeleton: out, changed: new Set([index]) }
  }
  const clampScale = (v) => {
    if (!Number.isFinite(v)) return 1
    const s = Math.max(-100, Math.min(100, v))
    return Math.abs(s) < 0.01 ? (s < 0 ? -0.01 : 0.01) : s
  }

  /**
   * Which bones are CONTROLS — dragged, they pose (children and images follow, the
   * constraints act) instead of editing the rig: every IK / transform constraint
   * target, every zero-length bone (pivots, turn and expression points, the master
   * controls — a zero-length bone is never a limb), and the mechanisms' own targets
   * and pivots.
   */
  function controlsOf(skel, mechs) {
    const bones = bonesOf(skel)
    const out = new Set()
    const byName = new Map(bones.map((b, i) => [b.name, i]))
    bones.forEach((b, i) => { if (!(Number(b.length) > 0)) out.add(i) })
    for (const key of ['ik', 'transform']) for (const c of (Array.isArray(skel[key]) ? skel[key] : [])) { const t = byName.get(c && c.target); if (t !== undefined) out.add(t) }
    for (const m of mechs || []) for (const k of ['t1', 't2', 'pivot']) if (m[k] >= 0) out.add(m[k])
    return out
  }

  /** Rotate one bone about its origin by `deg`; whatever sits on its tip follows. */
  function rotateBone(skel, index, deg, opts) {
    const o = opts || {}
    const W = o.W || worldTransforms(skel)
    const tol = o.tol === undefined ? 1.5 : o.tol
    const m = W[index]
    if (!(m.length > 0)) return { skeleton: skel, changed: new Set() }
    const t0 = tipOf(m)
    const r = deg * RAD, cs = Math.cos(r), sn = Math.sin(r)
    const vx = t0[0] - m.worldX, vy = t0[1] - m.worldY
    const t1 = [m.worldX + vx * cs - vy * sn, m.worldY + vx * sn + vy * cs]
    const targets = new Map()
    for (const e of endpointsAt(W, t0[0], t0[1], tol)) { if (o.frozen && o.frozen.has(e.index) && e.index !== index) continue; addTarget(targets, e.index, e.end, t1) }
    addTarget(targets, index, 'tip', t1)
    return setEndpoints(skel, targets)
  }

  /**
   * Put the slots in `order` (draw order: first is drawn first, i.e. at the bottom).
   * Names that are not in the skeleton are ignored, slots the caller left out keep their
   * relative order at the end. Attachments, constraints and animations all address slots
   * by NAME, so nothing else has to move with them.
   */
  function setSlotOrder(skel, order) {
    const slots = Array.isArray(skel.slots) ? skel.slots : []
    if (!slots.length || !Array.isArray(order) || !order.length) return null
    const bySlot = new Map(slots.map((s) => [s.name, s]))
    const out = cloneRig(skel)
    const seen = new Set()
    const next = []
    for (const name of order) {
      const slot = bySlot.get(name)
      if (!slot || seen.has(name)) continue
      seen.add(name)
      next.push(slot)
    }
    for (const s of slots) if (!seen.has(s.name)) next.push(s)
    if (next.length !== slots.length) return null
    const same = next.every((s, i) => s.name === slots[i].name)
    if (same) return null
    out.slots = next.map((s) => bySlot.get(s.name))
    return { skeleton: out, changed: new Set() }
  }

  /** Spine's naming: bone, bone2, bone3, … (first free). */
  function nextName(skel, base) {
    const names = new Set(bonesOf(skel).map((b) => b.name))
    const stem = base || 'bone'
    if (!names.has(stem)) return stem
    for (let k = 2; ; k++) if (!names.has(stem + k)) return stem + k
  }

  /**
   * Add a bone under `parentIndex` (root when < 0) with world endpoints. It is INSERTED
   * right after the parent's own subtree, not appended at the end: that is where Spine
   * shows it, it keeps the "parent before child" order the runtime needs, and a drawn
   * chain reads as a chain. Weighted vertices address bones by index, so everything at
   * or after the insertion point is renumbered.
   */
  function addBone(skel, spec) {
    const out = clone(skel)
    const bones = bonesOf(out)
    if (!Array.isArray(out.bones)) out.bones = bones
    const name = spec.name && !bones.some((b) => b.name === spec.name) ? String(spec.name) : nextName(out, spec.name)
    const parent = spec.parentIndex >= 0 && bones[spec.parentIndex] ? bones[spec.parentIndex].name : (bones.length ? bones[0].name : undefined)
    const entry = { name }
    if (parent !== undefined && parent !== name) entry.parent = parent
    if (spec.color) entry.color = spec.color
    const index = insertAfterSubtree(out, bones, entry, parent)
    const targets = new Map()
    const origin = spec.origin || [0, 0]
    const tip = spec.tip && Math.hypot(spec.tip[0] - origin[0], spec.tip[1] - origin[1]) >= (spec.minLength === undefined ? 3 : spec.minLength) ? spec.tip : null
    targets.set(index, tip ? { origin, tip } : { origin })
    const res = setEndpoints(out, targets)
    return { skeleton: res.skeleton, index, name }
  }

  /** Put `entry` straight after everything that hangs off `parentName`; returns its index. */
  function insertAfterSubtree(skel, bones, entry, parentName) {
    const index = new Map(bones.map((b, i) => [b.name, i]))
    const pi = parentName !== undefined && index.has(parentName) ? index.get(parentName) : -1
    if (pi < 0) { bones.push(entry); return bones.length - 1 }
    const inSubtree = (i) => {
      let b = bones[i], guard = 0
      while (b && guard++ < bones.length) {
        if (b === bones[pi]) return true
        b = b.parent !== undefined && index.has(b.parent) ? bones[index.get(b.parent)] : null
      }
      return false
    }
    let at = pi + 1
    for (let i = pi + 1; i < bones.length; i++) if (inSubtree(i)) at = i + 1
    bones.splice(at, 0, entry)
    // renumber the weighted vertices: everything from the insertion point moved up one
    const map = []
    for (let i = 0; i < bones.length - 1; i++) map[i] = i < at ? i : i + 1
    reindexWeighted(skel, map, null, null, null)
    return at
  }

  /** Update every reference to a bone name (parents, slots, constraints). */
  function renameRefs(skel, oldName, newName) {
    for (const b of bonesOf(skel)) if (b.parent === oldName) b.parent = newName
    for (const s of skel.slots || []) if (s.bone === oldName) s.bone = newName
    for (const key of ['ik', 'transform', 'path']) {
      for (const c of skel[key] || []) {
        if (Array.isArray(c.bones)) c.bones = c.bones.map((n) => (n === oldName ? newName : n))
        if (c.target === oldName) c.target = newName
      }
    }
  }

  function renameBone(skel, index, newName) {
    const name = String(newName || '').trim()
    const bones = bonesOf(skel)
    if (!name || !bones[index]) return null
    if (bones.some((b, i) => i !== index && b.name === name)) return null
    const out = clone(skel)
    const old = out.bones[index].name
    out.bones[index].name = name
    renameRefs(out, old, name)
    return out
  }

  /** Re-number weighted vertices after bones were removed / reordered: map old index → new index (−1 = gone → `fallback`). */
  function reindexWeighted(skel, map, fallback, W0, W1) {
    for (const { att } of attachmentList(skel)) {
      const type = att.type || 'region'
      const vertices = Array.isArray(att.vertices) ? att.vertices : null
      const nVerts = type === 'mesh' ? (att.uvs ? att.uvs.length / 2 : 0) : num(att.vertexCount, 0)
      if (!vertices || !(nVerts > 0) || vertices.length === nVerts * 2) continue
      let k = 0
      for (let i = 0; i < nVerts && k < vertices.length; i++) {
        const cnt = vertices[k++]
        for (let j = 0; j < cnt; j++, k += 4) {
          const old = vertices[k]
          let nu = map[old]
          if (nu === undefined || nu < 0) {
            // the bone is gone: hand the influence to its parent, in the parent's frame
            if (fallback && fallback.has(old)) {
              const f = fallback.get(old)
              const D = deltaTransform(W0[old], W0[f.oldParent])
              const [x, y] = applyDelta(D, vertices[k + 1], vertices[k + 2])
              vertices[k + 1] = rnd(x); vertices[k + 2] = rnd(y)
              nu = map[f.oldParent]
            }
            if (nu === undefined || nu < 0) nu = 0
          }
          vertices[k] = nu
        }
      }
    }
  }

  /**
   * Delete a bone: its children move up to its parent (world kept), slots bound to
   * it re-bind to the parent (artwork kept), constraints that name it are dropped.
   */
  function deleteBone(skel, index) {
    const bones = bonesOf(skel)
    const b = bones[index]
    if (!b || index === 0) return null
    const out = clone(skel)
    const W0 = worldTransforms(out)
    const parentIdx = W0[index].parent
    const parentName = parentIdx >= 0 ? out.bones[parentIdx].name : undefined
    const name = b.name
    // children: keep world under the new parent
    const pm = parentIdx >= 0 ? W0[parentIdx] : null
    out.bones.forEach((c, i) => {
      if (c.parent !== name) return
      const L = localOf(c)
      const NL = localFromWorld(pm, W0[i], L)
      Object.assign(L, NL)
      writeLocal(c, L)
      if (parentName === undefined) delete c.parent; else c.parent = parentName
    })
    // slots: re-bind, attachments re-expressed in the parent's frame
    const D = pm ? deltaTransform(W0[index], pm) : deltaTransform(W0[index], { a: 1, b: 0, c: 0, d: 1, worldX: 0, worldY: 0 })
    for (const s of out.slots || []) {
      if (s.bone !== name) continue
      s.bone = parentName
      for (const { slot, att } of attachmentList(out)) {
        if (slot !== s.name) continue
        const type = att.type || 'region'
        const vertices = Array.isArray(att.vertices) ? att.vertices : null
        const nVerts = type === 'mesh' ? (att.uvs ? att.uvs.length / 2 : 0) : num(att.vertexCount, 0)
        if (vertices && nVerts > 0 && vertices.length !== nVerts * 2) continue   // weighted: handled below
        if (type === 'region' || type === 'point') {
          const [x, y] = applyDelta(D, num(att.x, 0), num(att.y, 0))
          att.x = rnd(x); att.y = rnd(y)
          const rot = wrap180(num(att.rotation, 0) + Math.atan2(D.c, D.a) * DEG)
          if (Math.abs(rot) < 1e-9) delete att.rotation; else att.rotation = rnd(rot)
        } else if (vertices) {
          for (let i = 0; i + 1 < vertices.length; i += 2) { const [x, y] = applyDelta(D, vertices[i], vertices[i + 1]); vertices[i] = rnd(x); vertices[i + 1] = rnd(y) }
        }
      }
    }
    // constraints naming it go
    for (const key of ['ik', 'transform', 'path']) {
      if (!Array.isArray(out[key])) continue
      out[key] = out[key].filter((c) => c.target !== name && !(Array.isArray(c.bones) && c.bones.includes(name)))
      if (!out[key].length) delete out[key]
    }
    // weighted vertices: indices shift, the deleted bone's influence goes to the parent
    const map = out.bones.map((_, i) => (i < index ? i : (i === index ? -1 : i - 1)))
    const fallback = new Map([[index, { oldParent: Math.max(0, parentIdx) }]])
    reindexWeighted(out, map, fallback, W0, W0)
    out.bones.splice(index, 1)
    return out
  }

  /** Re-parent a bone (world kept). Refuses a descendant or itself. */
  function reparentBone(skel, index, newParentIndex) {
    const bones = bonesOf(skel)
    if (!bones[index] || index === 0) return null
    const W0 = worldTransforms(skel)
    // no cycles
    for (let p = newParentIndex; p >= 0; p = W0[p].parent) if (p === index) return null
    const out = clone(skel)
    const b = out.bones[index]
    const L = localOf(b)
    const pm = newParentIndex >= 0 ? W0[newParentIndex] : null
    Object.assign(L, localFromWorld(pm, W0[index], L))
    writeLocal(b, L)
    if (newParentIndex >= 0) b.parent = out.bones[newParentIndex].name; else delete b.parent
    // keep parents before children: move the subtree right after the new parent
    const index2 = new Map(out.bones.map((x, i) => [x.name, i]))
    const order = topoOrder(out.bones, index2)
    if (order.some((v, i) => v !== i)) {
      const map = new Array(out.bones.length)
      order.forEach((old, nu) => { map[old] = nu })
      reindexWeighted(out, map, null, W0, W0)
      out.bones = order.map((i) => out.bones[i])
    }
    return out
  }

  // ---------------------------------------------------------- mechanisms ---

  /**
   * The auto rig's limb mechanism, read back from the constraints: a helper IK on
   * two bones [h1, h2] targeting the end target t2; a single-bone IK on `lower`
   * targeting t2; a transform constraint moving t1 after h2; a single-bone IK on
   * `upper` targeting t1; the pivot is upper's parent.
   */
  function parseMechanisms(skel) {
    const bones = bonesOf(skel)
    const index = new Map(bones.map((b, i) => [b.name, i]))
    const iks = skel.ik || [], tcs = skel.transform || []
    const singleIk = new Map()   // target name -> ik on one bone
    for (const c of iks) if (Array.isArray(c.bones) && c.bones.length === 1 && index.has(c.bones[0])) singleIk.set(c.target, c)
    const out = []
    for (const c of iks) {
      if (!Array.isArray(c.bones) || c.bones.length !== 2) continue
      const [h1n, h2n] = c.bones
      if (!index.has(h1n) || !index.has(h2n) || !index.has(c.target)) continue
      const lowerIk = singleIk.get(c.target)
      if (!lowerIk) continue
      const follow = tcs.find((t) => t.target === h2n && Array.isArray(t.bones) && t.bones.length === 1 && index.has(t.bones[0]))
      if (!follow) continue
      const t1n = follow.bones[0]
      const upperIk = singleIk.get(t1n)
      if (!upperIk) continue
      const upper = index.get(upperIk.bones[0]), lower = index.get(lowerIk.bones[0])
      const pivot = bones[upper].parent !== undefined && index.has(bones[upper].parent) ? index.get(bones[upper].parent) : -1
      const connIk = pivot >= 0 ? iks.find((k) => Array.isArray(k.bones) && k.bones.length === 1 && k.target === bones[pivot].name) : null
      out.push({
        upper, lower, t1: index.get(t1n), t2: index.get(c.target), h1: index.get(h1n), h2: index.get(h2n), pivot,
        connector: connIk && index.has(connIk.bones[0]) ? index.get(connIk.bones[0]) : -1,
        helperIk: c, follow, name: c.name
      })
    }
    return out
  }

  /** Bones a mechanism derives from the joints (not editable by hand). */
  function mechanismOwned(skel, mechs) {
    const owned = new Set()
    for (const m of mechs || parseMechanisms(skel)) for (const k of ['t1', 't2', 'h1', 'h2', 'pivot']) if (m[k] >= 0) owned.add(m[k])
    return owned
  }

  /**
   * After the joints moved: targets and pivot onto the joints, the helper chain
   * from the pivot through a knee on the bend side to the end target (the same
   * construction as spine-auto-bones `mechanize`), bendPositive and the follow
   * offsets from the new setup pose.
   */
  function rebuildMechanisms(skel, opts) {
    const o = Object.assign({ helperScale: 1.12 }, opts || {})
    const mechs = parseMechanisms(skel)
    if (!mechs.length) return skel
    let cur = skel
    for (const m of mechs) {
      const W = worldTransforms(cur)
      const U = W[m.upper], Lb = W[m.lower]
      if (!U || !Lb) continue
      const P = [U.worldX, U.worldY], J = tipOf(U), T = tipOf(Lb)
      const ux = J[0] - P[0], uy = J[1] - P[1], lx = T[0] - J[0], ly = T[1] - J[1]
      const cross = ux * ly - uy * lx
      const dx = T[0] - P[0], dy = T[1] - P[1], d = Math.max(1e-6, Math.hypot(dx, dy))
      // the knee stays on the side it was built on (the generator chose it from the
      // drawn bend or, for a straight limb, from anatomy): K = P + e·x − bend·n·hh with n
      // the left normal, so a knee on the right of P→T means bend > 0
      const Kold = W[m.h1] && W[m.h1].length > 0 ? tipOf(W[m.h1]) : null
      const sideOld = Kold ? dx * (Kold[1] - P[1]) - dy * (Kold[0] - P[0]) : 0
      let bend = Math.abs(sideOld) > 1e-6 ? -Math.sign(sideOld) : (Math.abs(cross) > 1e-6 * Math.max(1e-6, U.length * Lb.length) ? Math.sign(cross) : (m.helperIk.bendPositive === false ? -1 : 1))
      const k = Math.max(o.helperScale, 1.05 * d / Math.max(1e-6, U.length + Lb.length))
      const a = k * U.length, b = k * Lb.length
      const x = (d * d + a * a - b * b) / (2 * d), hh = Math.sqrt(Math.max(0, a * a - x * x))
      const ex = dx / d, ey = dy / d, nx = -ey, ny = ex
      const K = [P[0] + ex * x - bend * nx * hh, P[1] + ey * x - bend * ny * hh]
      const targets = new Map()
      targets.set(m.h1, { origin: P, tip: K })
      targets.set(m.h2, { origin: K, tip: T })
      targets.set(m.t1, { origin: J })
      targets.set(m.t2, { origin: T })
      if (m.pivot >= 0) targets.set(m.pivot, { origin: P })
      const res = setEndpoints(cur, targets)
      cur = res.skeleton
      const ik = (cur.ik || []).find((c) => c.name === m.helperIk.name)
      if (ik) { if (bend > 0) delete ik.bendPositive; else ik.bendPositive = false }
      // follow offsets: t1 seen from h2 (position in h2's frame, rotation difference)
      const W2 = worldTransforms(cur)
      const tc = (cur.transform || []).find((c) => c.name === m.follow.name)
      if (tc) {
        const [ox, oy] = toLocalPoint(W2[m.h2], W2[m.t1].worldX, W2[m.t1].worldY)
        const orot = wrap180(worldRot(W2[m.t1]) - worldRot(W2[m.h2]))
        if (Math.abs(ox) > 1e-6) tc.x = rnd(ox); else delete tc.x
        if (Math.abs(oy) > 1e-6) tc.y = rnd(oy); else delete tc.y
        if (Math.abs(orot) > 1e-6) tc.rotation = rnd(orot); else delete tc.rotation
      }
    }
    return cur
  }

  // ------------------------------------------------------------- hit test ---

  function segDist(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay
    const l2 = vx * vx + vy * vy
    let t = l2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(px - (ax + vx * t), py - (ay + vy * t))
  }

  /**
   * What is under a screen point: a joint (origin / tip) first, then a bone shaft.
   * `editable(i)` filters out the mechanism's own bones.
   */
  function hitTest(W, sx, sy, toScreen, tol, editable, prefer) {
    const ok = (i) => (typeof editable === 'function' ? editable(i) : true)
    const pref = (i) => (typeof prefer === 'function' ? !!prefer(i) : false)
    let best = null
    for (let i = 0; i < W.length; i++) {
      if (!ok(i)) continue
      const m = W[i]
      const o = toScreen(m.worldX, m.worldY)
      const d0 = Math.hypot(o[0] - sx, o[1] - sy)
      // coincident origins: a preferred bone (the caller's controls) beats a plain one, so
      // the pivot parked on a joint is picked over the limb starting there; among equals
      // the later bone wins — children come after parents in Spine's order, and the deeper
      // control (x on y) is the finer one, as with overlapping bones in Spine itself
      if (d0 <= tol) {
        const near = !!best && best.end === 'origin' && d0 <= best.dist + 0.5
        if (!best || d0 < best.dist - 0.5 || (best.end === 'tip' && d0 <= best.dist) || (near && (pref(i) || !pref(best.index)))) best = { index: i, end: 'origin', dist: d0 }
      }
      if (m.length > 0) {
        const t = tipOf(m)
        const q = toScreen(t[0], t[1])
        const d1 = Math.hypot(q[0] - sx, q[1] - sy)
        if (d1 <= tol && (!best || d1 < best.dist)) best = { index: i, end: 'tip', dist: d1 }
      }
    }
    if (best) return best
    for (let i = 0; i < W.length; i++) {
      if (!ok(i)) continue
      const m = W[i]
      if (!(m.length > 0)) continue
      const o = toScreen(m.worldX, m.worldY), t = tipOf(m), q = toScreen(t[0], t[1])
      const d = segDist(sx, sy, o[0], o[1], q[0], q[1])
      if (d <= tol && (!best || d < best.dist)) best = { index: i, end: 'shaft', dist: d }
    }
    return best
  }

  // -------------------------------------------------------------- drawing ---

  const HALO = 'rgba(34,201,138,0.42)'
  function drawBone(ctx, ox, oy, tx, ty, style) {
    const len = Math.hypot(tx - ox, ty - oy)
    const col = style.color, alpha = style.alpha === undefined ? 1 : style.alpha
    ctx.save()
    ctx.globalAlpha = alpha
    if (len < 1) {
      // a zero-length bone: ring + crosshair
      const r = style.selected ? 6 : 4
      if (style.halo) { ctx.beginPath(); ctx.arc(ox, oy, r + 4, 0, Math.PI * 2); ctx.strokeStyle = HALO; ctx.lineWidth = 6; ctx.stroke() }
      ctx.beginPath(); ctx.arc(ox, oy, r + 1.5, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 3; ctx.stroke()
      ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke()
      ctx.beginPath(); ctx.moveTo(ox - r - 3, oy); ctx.lineTo(ox + r + 3, oy); ctx.moveTo(ox, oy - r - 3); ctx.lineTo(ox, oy + r + 3); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke()
      ctx.restore()
      return
    }
    const nx = -(ty - oy) / len, ny = (tx - ox) / len
    // slimmer than Spine's wedge: at 221 bones a fat triangle hides the art
    const half = Math.max(1.6, Math.min(4, len * 0.055))
    ctx.beginPath()
    ctx.moveTo(ox + nx * half, oy + ny * half)
    ctx.lineTo(tx, ty)
    ctx.lineTo(ox - nx * half, oy - ny * half)
    ctx.closePath()
    if (style.halo) { ctx.lineJoin = 'round'; ctx.lineWidth = style.selected ? 9 : 7; ctx.strokeStyle = HALO; ctx.stroke() }
    ctx.fillStyle = style.fill || col
    ctx.globalAlpha = alpha * (style.fillAlpha === undefined ? 0.55 : style.fillAlpha)
    ctx.fill()
    ctx.globalAlpha = alpha
    ctx.lineWidth = style.selected ? 1.6 : 1
    ctx.strokeStyle = style.selected ? '#ffffff' : 'rgba(0,0,0,0.7)'
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.strokeStyle = col
    ctx.stroke()
    // origin
    ctx.beginPath(); ctx.arc(ox, oy, style.selected ? 4.5 : 3.2, 0, Math.PI * 2)
    ctx.fillStyle = '#111'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.stroke()
    // tip
    ctx.beginPath(); ctx.arc(tx, ty, style.selected ? 3.2 : 2.2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill()
    ctx.restore()
  }

  function drawLabel(ctx, x, y, text, color) {
    ctx.save()
    ctx.font = '11px sans-serif'
    const w = ctx.measureText(text).width + 8
    ctx.fillStyle = 'rgba(0,0,0,0.72)'
    ctx.fillRect(x + 6, y - 16, w, 15)
    ctx.fillStyle = color || '#fff'
    ctx.fillText(text, x + 10, y - 5)
    ctx.restore()
  }

  // ----------------------------------------------------------- controller ---

  /**
   * The interactive half. `host` provides:
   *   getCanvas()       the preview canvas (or null)
   *   getToScreen()     world → canvas px affine [a,b,c,d,e,f] (x' = a·x + c·y + e, y' = b·x + d·y + f) or null
   *   getSkeleton()     current skeleton JSON (the working copy is taken from it on load())
   *   isMechanism(i)    optional: bone index → true for mechanism bones (drawn dim, not editable)
   *   onSelect(i)       selection changed (−1 = none)
   *   onChange()        the working copy changed (edit / undo / load)
   */
  function createController(host) {
    const OVERLAY_MARK = 'data-novaflow-bones-editor-overlay'
    const st = {
      enabled: false, preview: false, tool: 'move', skel: null, W: [], WF: [], mechs: [], owned: new Set(), derived: new Set(), controls: new Set(), constrained: new Set(),
      selected: -1, picked: new Set(), hover: null, drag: null, undo: [], redo: [], dirty: false, cleanDepth: 0,
      overlay: null, box: { l: -1, t: -1, w: -1, h: -1, shown: false }, showNames: false, timer: 0, raf: 0, viewSig: '', pickParent: false, bound: false, pickBound: false, pickStart: null
    }
    const emit = (fn, ...a) => { try { if (typeof host[fn] === 'function') host[fn](...a) } catch { /* the host is not ours to break */ } }

    function recompute() {
      // WF: the plain FK tree the edits are derived from
      st.WF = st.skel ? worldTransforms(st.skel) : []
      st.mechs = st.skel ? parseMechanisms(st.skel) : []
      // a mechanism's helper chain is DERIVED (rebuilt from the joints, never touched by
      // hand); its targets and pivot are CONTROLS: dragged on their own they pose the
      // chain through the runtime's constraints (Spine's setup mode), and a joint edit
      // puts them back on the joints
      const derived = new Set(), mechControls = new Set()
      for (const m of st.mechs) {
        for (const k of ['h1', 'h2']) if (m[k] >= 0) derived.add(m[k])
        for (const k of ['t1', 't2', 'pivot']) if (m[k] >= 0) mechControls.add(m[k])
      }
      st.derived = derived
      st.controls = st.skel ? new Set([...controlsOf(st.skel, st.mechs)].filter((i) => !derived.has(i))) : new Set()
      st.constrained = st.skel ? constrainedOf(st.skel) : new Set()
      st.owned = new Set([...derived, ...mechControls])
      // W: what is DRAWN — the pose the runtime shows (constraints applied) when the host
      // can pose the working copy through it; the FK tree otherwise
      let W = null
      // while the rig is only being LOOKED at (显示骨骼 without 编辑骨骼) the preview plays,
      // so the bones must be drawn where the runtime actually has them this frame
      if (st.preview && st.skel && typeof host.liveWorld === 'function') {
        try {
          const live = host.liveWorld()
          if (live && live.size) {
            const bones = bonesOf(st.skel)
            st.W = bones.map((b, i) => {
              const m = live.get(b.name)
              return m ? { a: m.a, b: m.b, c: m.c, d: m.d, worldX: m.worldX, worldY: m.worldY, length: st.WF[i].length, name: b.name, parent: st.WF[i].parent } : st.WF[i]
            })
            return
          }
        } catch { /* the preview may be mid-rebuild */ }
      }
      if (st.skel && typeof host.poseWorld === 'function') {
        try {
          const P = host.poseWorld(st.skel)
          if (P && P.length === st.WF.length) W = P.map((m, i) => ({ a: m.a, b: m.b, c: m.c, d: m.d, worldX: m.worldX, worldY: m.worldY, length: st.WF[i].length, name: st.WF[i].name, parent: st.WF[i].parent }))
        } catch { W = null }
      }
      st.W = W || st.WF
    }
    const isMech = (i) => st.owned.has(i) || (typeof host.isMechanism === 'function' && host.isMechanism(i, st.skel))
    const editable = (i) => !st.derived.has(i)
    const isControl = (i) => st.controls.has(i)
    /** helper chain / control / constraint-driven / plain — one colour each, everywhere. */
    const roleOf = (i) => (st.derived.has(i) ? 'helper' : (st.controls.has(i) ? 'control' : (isMech(i) ? 'helper' : (st.constrained.has(i) ? 'driven' : 'bone'))))
    /** A point picked off the POSED skeleton, expressed in the same place of the setup pose. */
    function toSetupFrame(pt, parentIndex) {
      const dm = st.W[parentIndex], fm = st.WF[parentIndex]
      if (!pt || !dm || !fm || dm === fm) return pt
      const [lx, ly] = toLocalPoint(dm, pt[0], pt[1])
      return [fm.a * lx + fm.b * ly + fm.worldX, fm.c * lx + fm.d * ly + fm.worldY]
    }

    function load(skel, keepHistory) {
      st.skel = skel ? clone(skel) : null
      if (!keepHistory) { st.undo = []; st.redo = [] }
      // the clean state is a position in the history: undoing back to it reads clean again
      st.cleanDepth = st.undo.length; st.dirty = false
      if (st.selected >= (st.skel ? st.skel.bones.length : 0)) st.selected = -1
      recompute(); draw(); emit('onChange')
    }
    function commit(next, opts) {
      if (!next) return
      if (!(opts && opts.noUndo)) {
        if (st.undo.length < st.cleanDepth) st.cleanDepth = -1 // branching off below the clean state loses it
        st.undo.push(cloneRig(st.skel)); st.redo = []
        if (st.undo.length > 100) { st.undo.shift(); st.cleanDepth = st.cleanDepth > 0 ? st.cleanDepth - 1 : -1 }
      } else st.cleanDepth = -1
      st.skel = next
      st.dirty = st.undo.length !== st.cleanDepth
      recompute(); draw(); emit('onChange')
    }
    function finishEdit(next) {
      // mechanisms follow the joints
      commit(rebuildMechanisms(next))
    }

    // ---- overlay
    /**
     * The preview canvas rect, read at most once per ~200 ms: every draw and every pointer
     * event needs it, and a fresh getBoundingClientRect after the panel wrote to the DOM
     * forces a synchronous relayout of the whole shell (measured 7-9 ms per read on a real
     * project). The canvas element itself only moves on a resize / section change.
     */
    const invalidateRect = () => { st.rectCache = null }
    function canvasRect() {
      const c = host.getCanvas()
      if (!c || !c.isConnected) { st.rectCache = null; return null }
      const now = performance.now()
      if (st.rectCache && st.rectCache.el === c && now - st.rectCache.t < 200) return st.rectCache.rect
      const rect = c.getBoundingClientRect()
      st.rectCache = { el: c, rect, t: now }
      return rect
    }
    function ensureOverlay() {
      const canvas = host.getCanvas()
      let ov = st.overlay
      if (!ov || !ov.isConnected) ov = document.querySelector(`canvas[${OVERLAY_MARK}="1"]`)
      if (!ov) {
        ov = document.createElement('canvas')
        ov.setAttribute(OVERLAY_MARK, '1')
        ov.setAttribute('data-novaflow-runtime-ignore', '1')
        Object.assign(ov.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483100', background: 'transparent', display: 'none' })
        document.body.appendChild(ov)
      }
      st.overlay = ov
      const r = canvasRect()
      const shown = !!((st.enabled || st.preview) && !st.hidden && r && r.width >= 4 && r.height >= 4)
      if (shown && (ov.width !== canvas.width || ov.height !== canvas.height)) { ov.width = canvas.width; ov.height = canvas.height }
      if (shown !== st.box.shown) { ov.style.display = shown ? 'block' : 'none'; st.box.shown = shown }
      if (!shown) return ov
      if (r.left !== st.box.l) { ov.style.left = r.left + 'px'; st.box.l = r.left }
      if (r.top !== st.box.t) { ov.style.top = r.top + 'px'; st.box.t = r.top }
      if (r.width !== st.box.w) { ov.style.width = r.width + 'px'; st.box.w = r.width }
      if (r.height !== st.box.h) { ov.style.height = r.height + 'px'; st.box.h = r.height }
      return ov
    }

    const toScreenFn = () => {
      const A = host.getToScreen()
      if (!A) return null
      return (x, y) => [A[0] * x + A[2] * y + A[4], A[1] * x + A[3] * y + A[5]]
    }
    const toWorldFn = () => {
      const A = host.getToScreen()
      if (!A) return null
      const det = A[0] * A[3] - A[1] * A[2]
      if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
      const ia = A[3] / det, ib = -A[1] / det, ic = -A[2] / det, id = A[0] / det
      return (sx, sy) => { const dx = sx - A[4], dy = sy - A[5]; return [ia * dx + ic * dy, ib * dx + id * dy] }
    }
    /** world units per screen pixel, for tolerances */
    const worldPerPx = () => { const A = host.getToScreen(); return A ? 1 / Math.max(1e-9, Math.hypot(A[0], A[1])) : 1 }

    function draw() {
      const ov = ensureOverlay()
      if (!ov || !st.box.shown) return
      const g = ov.getContext('2d')
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.clearRect(0, 0, ov.width, ov.height)
      const toS = toScreenFn()
      if (!toS || !st.skel) return
      if (st.tool === 'scale' && st.selected >= 0) {
        const m = st.W[st.selected]
        if (m) {
          const o = toS(m.worldX, m.worldY)
          const len = Math.max(18, m.length > 0 ? Math.hypot(...toS(...tipOf(m)).map((v, i) => v - o[i])) : 30)
          const ax = toS(m.worldX + m.a * len * 0.6, m.worldY + m.c * len * 0.6)
          const ay = toS(m.worldX + m.b * len * 0.6, m.worldY + m.d * len * 0.6)
          g.strokeStyle = ACCENT; g.lineWidth = 1.4
          for (const p of [ax, ay]) { g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(p[0], p[1]); g.stroke(); g.beginPath(); g.arc(p[0], p[1], 3.5, 0, Math.PI * 2); g.fillStyle = ACCENT; g.fill() }
        }
      }
      if (st.tool === 'create' && st.selected >= 0 && !st.drag) {
        // the next bone hangs on this one: mark its tip so the chain is predictable
        const m = st.W[st.selected]
        if (m) {
          const t = tipOf(m), c = toS(t[0], t[1])
          g.beginPath(); g.arc(c[0], c[1], 7, 0, Math.PI * 2)
          g.strokeStyle = ACCENT; g.lineWidth = 1.6; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([])
        }
      }
      if (st.pickParent && st.selected >= 0) {
        const m = st.W[st.selected]
        if (m) {
          const c = toS(m.worldX, m.worldY)
          g.beginPath(); g.arc(c[0], c[1], 13, 0, Math.PI * 2)
          g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([])
        }
      }
      const W = st.W
      // mechanism bones first (dim), then deform bones, selected last
      const order = W.map((_, i) => i).sort((p, q) => (st.owned.has(p) ? 0 : 1) - (st.owned.has(q) ? 0 : 1))
      for (const i of order) {
        if (i === st.selected) continue
        const m = W[i]
        const o = toS(m.worldX, m.worldY), t = m.length > 0 ? toS(...tipOf(m)) : o
        const hov = st.hover && st.hover.index === i
        const role = roleOf(i)
        const c = ROLE_COLORS[role]
        drawBone(g, o[0], o[1], t[0], t[1], { color: hov ? c.hover : c.line, fill: c.fill, alpha: role === 'helper' ? 0.5 : 1, fillAlpha: c.fillAlpha })
        if (st.showNames || hov) drawLabel(g, o[0], o[1], m.name, c.label)
      }
      // multi-selection: every picked bone glows in the accent colour and carries its name;
      // the one being edited is the same with a white edge and bigger joints
      for (const i of st.picked) {
        if (i === st.selected || !W[i]) continue
        const m = W[i]
        const o = toS(m.worldX, m.worldY), t = m.length > 0 ? toS(...tipOf(m)) : o
        drawBone(g, o[0], o[1], t[0], t[1], { color: ACCENT, fill: ACCENT, fillAlpha: 0.7, halo: true })
        drawLabel(g, o[0], o[1], m.name, ACCENT)
      }
      if (st.selected >= 0 && W[st.selected]) {
        const m = W[st.selected]
        const o = toS(m.worldX, m.worldY), t = m.length > 0 ? toS(...tipOf(m)) : o
        drawBone(g, o[0], o[1], t[0], t[1], { color: ACCENT, fill: ACCENT, selected: true, halo: true, fillAlpha: 0.85 })
        drawLabel(g, o[0], o[1], m.name, ACCENT)
        if (st.tool === 'rotate' && m.length > 0) {
          g.save(); g.setLineDash([3, 3]); g.strokeStyle = 'rgba(34,201,138,0.5)'
          g.beginPath(); g.arc(o[0], o[1], Math.hypot(t[0] - o[0], t[1] - o[1]), 0, Math.PI * 2); g.stroke(); g.restore()
        }
      }
      if (st.drag && st.drag.kind === 'create' && st.drag.cur) {
        const o = toS(...st.drag.origin), t = toS(...st.drag.cur)
        drawBone(g, o[0], o[1], t[0], t[1], { color: '#ffe066', fill: '#ffe066', selected: true })
      }
    }

    // ---- pointer
    const canvasPx = (ev) => {
      const canvas = host.getCanvas(); const r = canvasRect()
      if (!canvas || !r || r.width <= 0 || r.height <= 0) return null
      return [(ev.clientX - r.left) * (canvas.width / r.width), (ev.clientY - r.top) * (canvas.height / r.height)]
    }
    const onCanvas = (ev) => { const c = host.getCanvas(); return !!c && ev.target === c }
    const capture = (ev) => { const c = host.getCanvas(); try { if (c && typeof ev.pointerId === 'number') c.setPointerCapture(ev.pointerId) } catch { /* not capturable */ } }
    const release = (ev) => { const c = host.getCanvas(); try { if (c && typeof ev.pointerId === 'number') c.releasePointerCapture(ev.pointerId) } catch { /* not captured */ } }

    function onPointerDown(ev) {
      if (!st.enabled || ev.button !== 0 || !onCanvas(ev) || !st.skel) return
      const s = canvasPx(ev), toS = toScreenFn(), toW = toWorldFn()
      if (!s || !toS || !toW) return
      ev.preventDefault(); ev.stopImmediatePropagation()
      capture(ev)
      const w = toW(s[0], s[1])
      const tol = 9 * worldPerPx()
      if (st.pickParent) {
        // P armed the pick: this click names the new parent of the selected bone
        const hit = hitTest(st.W, s[0], s[1], toS, 9, editable, isControl)
        setPickParent(false)
        if (hit && hit.index !== st.selected) reparentSelected(hit.index)
        return
      }
      if (st.tool === 'scale') {
        const pick = hitTest(st.W, s[0], s[1], toS, 9, editable, isControl)
        if (pick && pick.index !== st.selected) select(pick.index, { additive: !!(ev.ctrlKey || ev.metaKey) })
        if (st.selected < 0) return
        const m = st.W[st.selected]
        const local = toLocalPoint(m, w[0], w[1])
        st.drag = { kind: 'scale', base: clone(st.skel), index: st.selected, m, from: local, start: s, moved: false }
        return
      }
      if (st.tool === 'create') {
        // start on a joint when there is one under the pointer, so chains connect
        let origin = w
        const hit = hitTest(st.W, s[0], s[1], toS, 9, editable, isControl)
        if (hit && hit.end !== 'shaft') { const m = st.W[hit.index]; origin = hit.end === 'tip' ? tipOf(m) : [m.worldX, m.worldY] }
        st.drag = { kind: 'create', origin, cur: null, start: s }
        draw()
        return
      }
      if (st.tool === 'rotate') {
        // clicking another bone picks it up, whatever the tool is (Spine does the same)
        const pick = hitTest(st.W, s[0], s[1], toS, 9, editable, isControl)
        if (pick && pick.index !== st.selected) select(pick.index, { additive: !!(ev.ctrlKey || ev.metaKey) })
        if (st.selected < 0) return
        // a control (or any bone with Alt) turns as a POSE: children and images follow, the
        // constraints act; a deform bone turns as a rig edit about its origin (the art stays)
        const pose = !ev.shiftKey && (ev.altKey || st.controls.has(st.selected))
        if (pose) { const m = st.W[st.selected]; st.drag = { kind: 'poseRotate', base: cloneRig(st.skel), index: st.selected, o: [m.worldX, m.worldY], a0: Math.atan2(w[1] - m.worldY, w[0] - m.worldX), start: s, moved: false }; return }
        if (!(st.WF[st.selected].length > 0)) { const hit = hitTest(st.W, s[0], s[1], toS, 9, editable, isControl); if (hit) select(hit.index); return }
        const m = st.WF[st.selected]
        st.drag = { kind: 'rotate', base: cloneRig(st.skel), index: st.selected, a0: Math.atan2(w[1] - m.worldY, w[0] - m.worldX), start: s, moved: false }
        return
      }
      // a control (constraint target, zero-length bone, pivot) moves on its own and the
      // constraints pose the chain (Spine's setup mode) — with Alt any bone does; with Shift
      // held the joint under it is edited instead: every endpoint on it moves and the rig
      // is re-derived from the FK tree, the art stays
      const rigEdit = !!ev.shiftKey
      const poseAny = !rigEdit && !!ev.altKey
      const hit = hitTest(st.W, s[0], s[1], toS, 9, rigEdit ? (i) => editable(i) && !st.controls.has(i) : editable, rigEdit ? null : isControl)
      if (!hit) { select(-1); return }
      if (ev.ctrlKey || ev.metaKey) { select(hit.index, { additive: true }); return }
      select(hit.index)
      if (!rigEdit && (poseAny || st.controls.has(hit.index))) {
        // grabbing the tip of a bone with length swings it (pose rotation); anywhere else moves it
        if (hit.end === 'tip' && st.WF[hit.index].length > 0) { const m = st.W[hit.index]; st.drag = { kind: 'poseRotate', base: cloneRig(st.skel), index: hit.index, o: [m.worldX, m.worldY], a0: Math.atan2(w[1] - m.worldY, w[0] - m.worldX), start: s, moved: false }; return }
        st.drag = { kind: 'pose', base: cloneRig(st.skel), index: hit.index, w0: w, start: s, moved: false }
        return
      }
      const m = st.WF[hit.index]
      if (hit.end === 'shaft') st.drag = { kind: 'translate', base: cloneRig(st.skel), index: hit.index, w0: w, start: s, moved: false }
      else st.drag = { kind: 'joint', base: cloneRig(st.skel), from: hit.end === 'tip' ? tipOf(m) : [m.worldX, m.worldY], w0: w, start: s, moved: false, tol }
    }
    function onPointerMove(ev) {
      if (!st.enabled) return
      const s = canvasPx(ev), toS = toScreenFn(), toW = toWorldFn()
      if (!s || !toS || !toW) return
      if (st.drag) {
        ev.preventDefault(); ev.stopImmediatePropagation()
        const w = toW(s[0], s[1])
        const d = st.drag
        if (Math.hypot(s[0] - d.start[0], s[1] - d.start[1]) >= 2) d.moved = true
        if (d.kind === 'create') { d.cur = w; draw(); return }
        if (!d.moved) return
        let res = null
        if (d.kind === 'pose') { res = poseMove(d.base, d.index, w[0] - d.w0[0], w[1] - d.w0[1]); if (res) { st.skel = res.skeleton; recompute(); draw() } return }
        if (d.kind === 'scale') {
          const local = toLocalPoint(d.m, w[0], w[1])
          const uniform = ev.shiftKey
          const ratio = (a, b0) => (Math.abs(b0) < 1e-3 ? 1 : a / b0)
          let mx = ratio(local[0], d.from[0]), my = ratio(local[1], d.from[1])
          if (uniform) { const k = Math.abs(d.from[0]) > Math.abs(d.from[1]) ? mx : my; mx = k; my = k }
          res = poseScale(d.base, d.index, mx, my)
          if (res) { st.skel = res.skeleton; recompute(); draw() }
          return
        }
        if (d.kind === 'poseRotate') { const a1 = Math.atan2(w[1] - d.o[1], w[0] - d.o[0]); res = poseRotate(d.base, d.index, wrap180((a1 - d.a0) * DEG)); if (res) { st.skel = res.skeleton; recompute(); draw() } return }
        if (d.kind === 'joint') res = moveJoint(d.base, d.from, [d.from[0] + w[0] - d.w0[0], d.from[1] + w[1] - d.w0[1]], { tol: d.tol, frozen: st.derived })
        else if (d.kind === 'translate') res = translateBone(d.base, d.index, w[0] - d.w0[0], w[1] - d.w0[1], { frozen: st.derived })
        else if (d.kind === 'rotate') { const m = worldTransforms(d.base)[d.index]; const a1 = Math.atan2(w[1] - m.worldY, w[0] - m.worldX); res = rotateBone(d.base, d.index, wrap180((a1 - d.a0) * DEG), { frozen: st.derived }) }
        if (res) { st.skel = rebuildMechanisms(res.skeleton); recompute(); draw() }
        return
      }
      if (!onCanvas(ev)) { if (st.hover) { st.hover = null; draw() } return }
      const hit = hitTest(st.W, s[0], s[1], toS, 9, editable, isControl)
      const was = st.hover && st.hover.index, now = hit && hit.index
      st.hover = hit
      if (was !== now) draw()
    }
    function onPointerUp(ev) {
      if (!st.enabled || !st.drag) return
      const d = st.drag
      st.drag = null
      release(ev)
      ev.preventDefault(); ev.stopImmediatePropagation()
      if (d.kind === 'create') {
        const toW = toWorldFn(), s = canvasPx(ev)
        const cur = d.cur || (toW && s ? toW(s[0], s[1]) : d.origin)
        // the new bone continues from whatever is selected (an empty selection means the
        // root), and the next one continues from it: drawing a chain needs no clicks in
        // between. The drawn points are where the POSED bones are, so they are read in the
        // parent's posed frame and written in its setup frame — the bone lands under the
        // pointer even when the parent is driven by a constraint.
        const parentIndex = st.selected >= 0 ? st.selected : 0
        const res = addBone(st.skel, { parentIndex, origin: toSetupFrame(d.origin, parentIndex), tip: toSetupFrame(cur, parentIndex), minLength: 3 * worldPerPx() })
        commit(res.skeleton)
        select(res.index)
        emit('onCreate', res.index)
        return
      }
      if (!d.moved) { draw(); return }
      // the drag already produced the state; record it as one undo step from the base
      const next = st.skel
      st.skel = d.base
      if (d.kind === 'pose' || d.kind === 'poseRotate' || d.kind === 'scale') commit(next)   // a pose is not a rig edit: no rebuild
      else finishEdit(next)
    }
    function onClick(ev) {
      if (!st.enabled || ev.button !== 0 || !onCanvas(ev)) return
      ev.preventDefault(); ev.stopImmediatePropagation()
    }
    function onKey(ev) {
      if (!st.enabled) return
      const t = ev.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const k = ev.key.toLowerCase()
      if ((ev.ctrlKey || ev.metaKey) && k === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return }
      if ((ev.ctrlKey || ev.metaKey) && k === 'y') { ev.preventDefault(); redo(); return }
      if (ev.key === 'Delete' || ev.key === 'Backspace') { if (st.selected >= 0) { ev.preventDefault(); deleteSelected() } return }
      if (ev.key === 'Escape') { if (st.pickParent) { setPickParent(false); return } select(-1); return }
      if (k === 'p' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        // Spine's shortcut: P then click the new parent, Shift+P hangs the bone on the root
        ev.preventDefault()
        if (st.selected < 0) return
        if (ev.shiftKey) { setPickParent(false); reparentSelected(0) } else setPickParent(!st.pickParent)
        return
      }
      for (const tool of TOOLS) if (k === tool.key) { setTool(tool.id); return }
    }
    function bind() {
      if (st.bound) return
      st.bound = true
      window.addEventListener('resize', invalidateRect)
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('pointermove', onPointerMove, true)
      document.addEventListener('pointerup', onPointerUp, true)
      document.addEventListener('click', onClick, true)
      window.addEventListener('keydown', onKey, true)
    }
    function unbind() {
      if (!st.bound) return
      st.bound = false
      window.removeEventListener('resize', invalidateRect)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKey, true)
    }

    // ---- public
    function select(i, opts) {
      const next = i >= 0 && st.skel && st.skel.bones[i] ? i : -1
      const additive = !!(opts && opts.additive)
      if (next === st.selected && !additive) { draw(); return }
      st.selected = next
      draw(); emit('onSelect', next, { additive })
    }
    function setTool(id) { if (TOOLS.some((t) => t.id === id)) { st.tool = id; draw(); emit('onTool', id) } }
    /** What the overlay's geometry depends on: the camera and the preview canvas box. */
    function viewSignature() {
      const A = host.getToScreen(), r = canvasRect()
      if (!A || !r) return ''
      return A.map((v) => Math.round(v * 1e4)).join(',') + '|' + [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(',')
    }
    /**
     * The bones are drawn on our own canvas, so they only move when we redraw: on a 250 ms
     * timer they visibly trailed the artwork while the preview was zoomed or panned. A frame
     * loop redraws as soon as the camera or the canvas box changes (the check is a few
     * multiplications; the draw itself is ~0.3 ms and only runs when something moved).
     */
    function frameLoop() {
      if (!st.enabled && !st.preview) { st.raf = 0; return }
      st.raf = window.requestAnimationFrame(frameLoop)
      const sig = viewSignature()
      if (st.preview) { recompute(); draw(); st.viewSig = sig; return }   // the animation moves every frame
      if (sig !== st.viewSig) { st.viewSig = sig; draw() }
    }
    /**
     * While the bones are only being LOOKED at they are still clickable: a click that did
     * not drag selects the bone under it (and nothing else — no editing, and the pan /
     * zoom the app does with the same pointer is left alone, which is why nothing here
     * calls preventDefault).
     */
    function bindPreviewPick() {
      if (st.pickBound) return
      st.pickBound = true
      document.addEventListener('pointerdown', onPreviewDown, true)
      document.addEventListener('pointerup', onPreviewUp, true)
    }
    function onPreviewDown(ev) {
      if (!st.preview || st.enabled || ev.button !== 0 || !onCanvas(ev)) { st.pickStart = null; return }
      st.pickStart = canvasPx(ev)
    }
    function onPreviewUp(ev) {
      const start = st.pickStart
      st.pickStart = null
      if (!st.preview || st.enabled || !start) return
      const s = canvasPx(ev), toS = toScreenFn()
      if (!s || !toS || Math.hypot(s[0] - start[0], s[1] - start[1]) > 4) return
      const hit = hitTest(st.W, s[0], s[1], toS, 10, editable, isControl)
      if (hit) select(hit.index, { additive: !!(ev.ctrlKey || ev.metaKey) })
    }
    /** Draw only (显示骨骼 without 编辑骨骼): the same picture, no input, no freeze. */
    function setPreview(on) {
      const next = !!on && !st.enabled
      if (next === st.preview) { if (!next) { ensureOverlay(); draw() } return }
      st.preview = next
      st.pickStart = null
      if (next) { bindPreviewPick(); if (!st.raf) st.raf = window.requestAnimationFrame(frameLoop) }
      else if (!st.enabled && st.raf) { window.cancelAnimationFrame(st.raf); st.raf = 0 }
      recompute(); ensureOverlay(); draw()
    }
    /** 显示骨骼 off while editing: the rig stays editable, it is just not drawn. */
    function setHidden(on) {
      if (!!on === !!st.hidden) return
      st.hidden = !!on
      ensureOverlay(); draw()
    }
    function setEnabled(on) {
      st.enabled = !!on
      if (st.enabled) {
        st.preview = false
        bind()
        if (!st.timer) st.timer = window.setInterval(() => { try { if (typeof host.onFrame === 'function') host.onFrame() } catch { /* the host is not ours to break */ } }, 250)
        if (!st.raf) st.raf = window.requestAnimationFrame(frameLoop)
      } else {
        unbind(); st.drag = null; st.hover = null; setPickParent(false)
        if (st.timer) { window.clearInterval(st.timer); st.timer = 0 }
        if (st.raf && !st.preview) { window.cancelAnimationFrame(st.raf); st.raf = 0 }
      }
      recompute(); ensureOverlay(); draw()
    }
    function undo() { const prev = st.undo.pop(); if (!prev) return; st.redo.push(cloneRig(st.skel)); st.skel = prev; st.dirty = st.undo.length !== st.cleanDepth; recompute(); draw(); emit('onChange') }
    function redo() { const next = st.redo.pop(); if (!next) return; st.undo.push(cloneRig(st.skel)); st.skel = next; st.dirty = st.undo.length !== st.cleanDepth; recompute(); draw(); emit('onChange') }
    function deleteSelected() {
      if (st.selected < 0 || st.owned.has(st.selected)) return false
      const next = deleteBone(st.skel, st.selected)
      if (!next) return false
      const sel = st.selected
      st.selected = -1
      commit(rebuildMechanisms(next))
      emit('onSelect', -1)
      return sel >= 0
    }
    function renameSelected(name) {
      if (st.selected < 0) return false
      const next = renameBone(st.skel, st.selected, name)
      if (!next) return false
      commit(next)
      return true
    }
    function setPickParent(on) {
      const next = !!on && st.selected >= 0
      if (next === st.pickParent) return
      st.pickParent = next
      emit('onPickParent', next)
      draw()
    }
    /** Re-parent by NAME — what a drag in the project's bone tree gives us. */
    function reparentNamed(childName, parentName) {
      if (!st.skel) return false
      const bones = bonesOf(st.skel)
      const ci = bones.findIndex((b) => b.name === childName)
      if (ci < 0) return false
      const pi = parentName === null || parentName === undefined ? -1 : bones.findIndex((b) => b.name === parentName)
      if (parentName !== null && parentName !== undefined && pi < 0) return false
      select(ci)
      return reparentSelected(pi)
    }
    /** Draw order, as one undo step (the art moves, nothing else does). */
    function setSlotOrderNamed(order) {
      if (!st.skel) return false
      const res = setSlotOrder(st.skel, order)
      if (!res) return false
      commit(res.skeleton)
      return true
    }
    function reparentSelected(parentIndex) {
      if (st.selected < 0) return false
      const name = st.skel.bones[st.selected].name
      const next = reparentBone(st.skel, st.selected, parentIndex)
      if (!next) return false
      commit(next)
      select(next.bones.findIndex((b) => b.name === name))
      return true
    }
    /** Set the selected bone's rotation / length in world terms (the panel's fields). */
    function setSelectedPose(patch) {
      if (st.selected < 0) return false
      const m = st.WF[st.selected]
      // 移动: the number is the bone's world origin, and typing one does what dragging does —
      // a control poses, anything else takes its joint (and its art) along
      if (patch.x !== undefined || patch.y !== undefined) {
        const dx = patch.x === undefined ? 0 : Number(patch.x) - m.worldX
        const dy = patch.y === undefined ? 0 : Number(patch.y) - m.worldY
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false
        if (!dx && !dy) return true
        if (st.controls.has(st.selected)) {
          const res = poseMove(st.skel, st.selected, dx, dy)
          if (!res) return false
          commit(res.skeleton)
          return true
        }
        finishEdit(translateBone(st.skel, st.selected, dx, dy, { W: st.WF, frozen: st.derived }).skeleton)
        return true
      }
      // 缩放: the number is the bone's own scale, so reach it with the factor poseScale wants
      if (patch.scaleX !== undefined || patch.scaleY !== undefined) {
        const b = st.skel.bones[st.selected]
        const cur = localOf(b)
        const want = (v, now) => {
          if (v === undefined) return 1
          const target = clampScale(Number(v))
          if (!Number.isFinite(target) || Math.abs(now) < 1e-6) return 1
          return target / now
        }
        const res = poseScale(st.skel, st.selected, want(patch.scaleX, cur.scaleX), want(patch.scaleY, cur.scaleY))
        if (!res) return false
        commit(res.skeleton)
        return true
      }
      if (st.controls.has(st.selected) || !(m.length > 0)) {
        // a control's angle is a pose: turn it in place, children and constraints follow
        if (patch.rotation === undefined) return false
        const res = poseRotate(st.skel, st.selected, wrap180(Number(patch.rotation) - worldRot(m)))
        if (!res) return false
        commit(res.skeleton)
        return true
      }
      const targets = new Map()
      const rot = patch.rotation === undefined ? worldRot(m) : Number(patch.rotation)
      const len = patch.length === undefined ? m.length : Math.max(0, Number(patch.length))
      const o = [m.worldX, m.worldY]
      const tip = [o[0] + Math.cos(rot * RAD) * len, o[1] + Math.sin(rot * RAD) * len]
      const t0 = tipOf(m)
      for (const e of endpointsAt(st.WF, t0[0], t0[1], 1.5)) if (e.index !== st.selected && !st.derived.has(e.index)) addTarget(targets, e.index, e.end, tip)
      targets.set(st.selected, { origin: o, tip })
      finishEdit(setEndpoints(st.skel, targets).skeleton)
      return true
    }
    function dispose() { setEnabled(false); if (st.overlay && st.overlay.parentElement) st.overlay.parentElement.removeChild(st.overlay); st.overlay = null }

    return {
      load, setEnabled, setPreview, setHidden, setTool, select, undo, redo, deleteSelected, renameSelected, reparentSelected, reparentNamed, setSelectedPose, draw, dispose,
      setSlotOrder: setSlotOrderNamed,
      setPickParent, isPickingParent: () => st.pickParent,
      /** Bones highlighted alongside the selected one (a multi-selection). */
      setPicked: (names) => {
        const list = st.skel ? bonesOf(st.skel) : []
        const want = new Set()
        for (const n of names || []) { const i = list.findIndex((b) => b.name === n); if (i >= 0) want.add(i) }
        st.picked = want
        draw()
      },
      setShowNames: (v) => { st.showNames = !!v; draw() },
      getSkeleton: () => (st.skel ? cloneRig(st.skel) : null),
      /** The live bone list, read-only — for panels that only need names / parents / lengths. */
      peekBones: () => (st.skel ? bonesOf(st.skel) : []),
      /** The live working copy, read-only — for panels that also need slots / skins / constraints. */
      peek: () => st.skel,
      /** 'bone' | 'driven' | 'control' | 'helper' — the colour the canvas draws it with. */
      roleOf: (i) => roleOf(i),
      getWorld: () => st.WF,
      getDisplayWorld: () => st.W,
      isOwned: (i) => st.owned.has(i),
      isControl: (i) => st.controls.has(i),
      getState: () => ({ enabled: st.enabled, preview: st.preview, tool: st.tool, selected: st.selected, dirty: st.dirty, canUndo: st.undo.length > 0, canRedo: st.redo.length > 0, bones: st.skel ? st.skel.bones.length : 0, mechanisms: st.mechs.length }),
      markClean: () => { st.cleanDepth = st.undo.length; st.dirty = false },
      _st: st
    }
  }

  return {
    TOOLS, ACCENT,
    worldTransforms, worldMatrix, localFromWorld, tipOf, endpointsAt, setEndpoints, moveJoint, translateBone, rotateBone,
    addBone, deleteBone, renameBone, reparentBone, setSlotOrder, poseScale, nextName, parseMechanisms, mechanismOwned, rebuildMechanisms, hitTest, poseMove, poseRotate, controlsOf, constrainedOf, cloneRig, forkAttachments,
    ROLE_COLORS,
    compensateAttachments, attachmentList, createController,
    _internals: { toLocalPoint, deltaTransform, topoOrder, reindexWeighted, segDist, wrap180 }
  }
})
