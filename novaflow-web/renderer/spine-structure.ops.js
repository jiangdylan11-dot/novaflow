/*
 * NovaFlow — 骨骼结构编辑（测试线）.
 *
 * Pure operations on a Spine 3.8 skeleton JSON object (the shape the 动画 section
 * keeps after `normalizeToSpine38`). Every op takes the parsed skeleton, works on
 * a deep copy and returns `{ json, ... }`, so the caller can keep the old object
 * for undo and simply reload the new one.
 *
 * Index rules that keep weighted meshes valid:
 * - new bones are always APPENDED (weighted vertices store bone indices, so
 *   inserting would silently rebind every mesh after the insertion point);
 * - a bone delete remaps every remaining weighted vertex and refuses when a mesh
 *   that survives still holds weight on a deleted bone.
 *
 * Ops that move an attachment between bones (re-hang a slot, move an attachment
 * to another slot) need the setup-pose world matrices of the bones involved; the
 * caller passes them as `{ a, b, c, d, worldX, worldY }` read from the runtime.
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowSpineStructureOps = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const CONSTRAINT_KINDS = ['ik', 'transform', 'path']
  /**
   * Skin placeholders nobody has filled yet. Spine JSON cannot hold an empty
   * placeholder (its own export drops them), so they wait here and the export
   * strips this key; a filled placeholder is just a key in the skins.
   */
  const EMPTY_PLACEHOLDERS = 'nfPlaceholders'
  const emptyPlaceholders = (json, slot) => ((json[EMPTY_PLACEHOLDERS] || {})[slot] || [])
  function setEmptyPlaceholders(json, slot, list) {
    json[EMPTY_PLACEHOLDERS] = json[EMPTY_PLACEHOLDERS] || {}
    json[EMPTY_PLACEHOLDERS][slot] = list
  }

  const clone = (v) => JSON.parse(JSON.stringify(v))
  const fail = (msg) => { throw new Error(msg) }
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
  const round = (v) => Math.round(v * 100) / 100

  /** Deep copy + normalise the containers every op relies on. */
  function prepare(json) {
    if (!json || typeof json !== 'object') fail('骨架数据为空')
    const out = clone(json)
    out.bones = Array.isArray(out.bones) ? out.bones : []
    out.slots = Array.isArray(out.slots) ? out.slots : []
    for (const k of CONSTRAINT_KINDS) out[k] = Array.isArray(out[k]) ? out[k] : []
    if (out.skins && !Array.isArray(out.skins) && typeof out.skins === 'object') {
      out.skins = Object.keys(out.skins).map((name) => ({ name, attachments: out.skins[name] }))
    }
    out.skins = Array.isArray(out.skins) ? out.skins : []
    if (!out.skins.some((s) => s && s.name === 'default')) out.skins.unshift({ name: 'default', attachments: {} })
    for (const s of out.skins) s.attachments = s.attachments || {}
    out.animations = out.animations && typeof out.animations === 'object' ? out.animations : {}
    return out
  }

  /** Drop the empty arrays `prepare` added so the export stays close to the input. */
  /** Lab-only: images left out of the export, [skin, slot, name] (stripped by `exportable`). */
  const NO_EXPORT = 'nfNoExport'

  function tidy(json) {
    for (const k of CONSTRAINT_KINDS) if (Array.isArray(json[k]) && !json[k].length) delete json[k]
    if (json.events && typeof json.events === 'object' && !Object.keys(json.events).length) delete json.events
    if (Array.isArray(json[NO_EXPORT])) {
      json[NO_EXPORT] = json[NO_EXPORT].filter(([sk, sl, n]) => { const skin = json.skins.find((x) => x.name === sk); return skin && skin.attachments[sl] && skin.attachments[sl][n] })
      if (!json[NO_EXPORT].length) delete json[NO_EXPORT]
    }
    for (const s of json.skins) {
      for (const k of ['bones', ...CONSTRAINT_KINDS]) if (Array.isArray(s[k]) && !s[k].length) delete s[k]
    }
    const ph = json[EMPTY_PLACEHOLDERS]
    if (ph) {
      for (const slot of Object.keys(ph)) {
        // a placeholder some skin has filled lives in the skins themselves
        ph[slot] = [...new Set(ph[slot] || [])].filter((n) => findSlot(json, slot)
          && !json.skins.some((sk) => sk.name !== 'default' && sk.attachments[slot] && sk.attachments[slot][n]))
        if (!ph[slot].length) delete ph[slot]
      }
      if (!Object.keys(ph).length) delete json[EMPTY_PLACEHOLDERS]
    }
    return json
  }

  const findBone = (json, name) => json.bones.find((b) => b.name === name) || null
  const findSlot = (json, name) => json.slots.find((s) => s.name === name) || null
  const findSkin = (json, name) => json.skins.find((s) => s.name === name) || null
  const boneIndex = (json, name) => json.bones.findIndex((b) => b.name === name)
  const findConstraint = (json, kind, name) => (json[kind] || []).find((c) => c.name === name) || null

  function requireBone(json, name) { return findBone(json, name) || fail(`找不到骨骼：${name}`) }
  function requireSlot(json, name) { return findSlot(json, name) || fail(`找不到插槽：${name}`) }
  function requireSkin(json, name) { return findSkin(json, name) || fail(`找不到皮肤：${name}`) }

  function constraintNames(json) {
    const set = new Set()
    for (const k of CONSTRAINT_KINDS) for (const c of json[k] || []) set.add(c.name)
    return set
  }

  /**
   * Spine-style copy names: `hand` → `hand2`, `leg1` → `leg2` (or the next free
   * number). `plain` returns `base` itself while it is still free.
   */
  function uniqueName(taken, base, plain = false) {
    if (plain && !taken.has(base)) return base
    const m = /^(.*?)(\d+)$/.exec(base)
    const stem = m ? m[1] : base
    let i = m ? Number(m[2]) + 1 : 2
    while (taken.has(stem + i)) i++
    return stem + i
  }

  function nextOrder(json) {
    let max = -1
    for (const k of CONSTRAINT_KINDS) for (const c of json[k] || []) max = Math.max(max, num(c.order, 0))
    return max + 1
  }

  function children(json, name) { return json.bones.filter((b) => b.parent === name).map((b) => b.name) }

  /** The bone and every descendant, in skeleton (parent-first) order. */
  function branch(json, name) {
    const set = new Set([name])
    for (const b of json.bones) if (b.parent && set.has(b.parent)) set.add(b.name)
    return json.bones.filter((b) => set.has(b.name)).map((b) => b.name)
  }

  function isDescendant(json, name, ancestor) {
    let b = findBone(json, name)
    while (b && b.parent) {
      if (b.parent === ancestor) return true
      b = findBone(json, b.parent)
    }
    return false
  }

  // ---------------------------------------------------------------- vertices

  function vertexCount(att) {
    if (Array.isArray(att.uvs)) return att.uvs.length / 2
    if (Number.isFinite(Number(att.vertexCount))) return Number(att.vertexCount)
    return 0
  }

  function isWeighted(att) {
    if (!att || !Array.isArray(att.vertices)) return false
    const n = vertexCount(att)
    return n > 0 && att.vertices.length !== n * 2
  }

  /** Visit each bone index of a weighted vertex list; `fn` returns the new index. */
  function mapWeights(vertices, fn) {
    let i = 0
    while (i < vertices.length) {
      const n = vertices[i++]
      for (let k = 0; k < n; k++, i += 4) vertices[i] = fn(vertices[i])
    }
  }

  function weightBones(att) {
    const set = new Set()
    if (isWeighted(att)) mapWeights(att.vertices, (b) => { set.add(b); return b })
    return set
  }

  function forEachAttachment(json, fn) {
    for (const skin of json.skins) {
      for (const slot of Object.keys(skin.attachments)) {
        const map = skin.attachments[slot]
        for (const name of Object.keys(map || {})) fn(map[name], { skin, slot, name })
      }
    }
  }

  // ---------------------------------------------------------------- matrices

  const angleOf = (m) => Math.atan2(m.c, m.a) * 180 / Math.PI

  function toWorld(m, x, y) { return [m.a * x + m.b * y + m.worldX, m.c * x + m.d * y + m.worldY] }

  function toLocal(m, wx, wy) {
    const det = m.a * m.d - m.b * m.c
    if (!det) return [0, 0]
    const x = wx - m.worldX
    const y = wy - m.worldY
    return [(m.d * x - m.b * y) / det, (m.a * y - m.c * x) / det]
  }

  /** Keep an attachment where it is on screen while it moves from bone `from` to bone `to`. */
  function rebaseAttachment(att, from, to) {
    if (!att || !from || !to || isWeighted(att)) return
    const type = att.type || 'region'
    const move = (x, y) => { const w = toWorld(from, x, y); return toLocal(to, w[0], w[1]) }
    if (type === 'region' || type === 'point') {
      const p = move(num(att.x, 0), num(att.y, 0))
      att.x = round(p[0])
      att.y = round(p[1])
      att.rotation = round(num(att.rotation, 0) + angleOf(from) - angleOf(to))
      if (type === 'region') {
        const sx = Math.hypot(from.a, from.c) / (Math.hypot(to.a, to.c) || 1)
        const sy = Math.hypot(from.b, from.d) / (Math.hypot(to.b, to.d) || 1)
        if (Math.abs(sx - 1) > 1e-4) att.scaleX = round(num(att.scaleX, 1) * sx * 1000) / 1000
        if (Math.abs(sy - 1) > 1e-4) att.scaleY = round(num(att.scaleY, 1) * sy * 1000) / 1000
      }
      return
    }
    if (Array.isArray(att.vertices)) {
      for (let i = 0; i + 1 < att.vertices.length; i += 2) {
        const p = move(att.vertices[i], att.vertices[i + 1])
        att.vertices[i] = round(p[0])
        att.vertices[i + 1] = round(p[1])
      }
    }
  }

  // ---------------------------------------------------------------- bones

  function addBone(input, opts) {
    const json = prepare(input)
    const o = opts || {}
    const name = String(o.name || '').trim() || fail('骨骼名称不能为空')
    if (findBone(json, name)) fail(`骨骼已存在：${name}`)
    const parent = o.parent ? requireBone(json, o.parent).name : (json.bones[0] && json.bones[0].name)
    if (!parent && json.bones.length) fail('需要父骨骼')
    const bone = { name }
    if (parent) bone.parent = parent
    for (const k of ['length', 'x', 'y', 'rotation']) if (num(o[k], 0)) bone[k] = round(num(o[k], 0))
    json.bones.push(bone)
    return { json: tidy(json), bone: name }
  }

  const BONE_PROPS = ['length', 'x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY']

  function setBoneProps(input, name, props) {
    const json = prepare(input)
    const bone = requireBone(json, name)
    for (const k of BONE_PROPS) {
      if (props[k] === undefined) continue
      const v = num(props[k], NaN)
      if (!Number.isFinite(v)) fail(`${k} 不是数字`)
      const def = k.startsWith('scale') ? 1 : 0
      if (v === def) delete bone[k]
      else bone[k] = round(v * 1000) / 1000
    }
    if (props.transform !== undefined) {
      if (!props.transform || props.transform === 'normal') delete bone.transform
      else bone.transform = props.transform
    }
    if (props.color !== undefined) {
      if (props.color) bone.color = props.color
      else delete bone.color
    }
    return { json: tidy(json) }
  }

  /**
   * Copy a bone (optionally with its whole branch, its slots + attachments, the
   * constraints that drive it and every animation key) next to the original.
   */
  function duplicateBone(input, name, opts) {
    const json = prepare(input)
    const o = { children: true, slots: true, constraints: true, animation: true, ...(opts || {}) }
    const src = requireBone(json, name)
    if (!src.parent) fail('根骨骼不能复制')
    const names = o.children ? branch(json, name) : [name]
    const set = new Set(names)

    const takenBones = new Set(json.bones.map((b) => b.name))
    const boneMap = new Map()
    for (const n of names) {
      const copyName = uniqueName(takenBones, n)
      takenBones.add(copyName)
      boneMap.set(n, copyName)
    }
    const indexMap = new Map()
    for (const n of names) {
      const copy = clone(findBone(json, n))
      copy.name = boneMap.get(n)
      if (copy.parent && boneMap.has(copy.parent)) copy.parent = boneMap.get(copy.parent)
      indexMap.set(boneIndex(json, n), json.bones.length)
      json.bones.push(copy)
    }

    // an IK target outside the branch gets its own copy (same parent, its keys
    // too), so the copied limb can be posed on its own; a target above the branch
    // and transform/path targets (usually shared controllers) stay shared
    if (o.constraints) {
      for (const c of json.ik.slice()) {
        const inside = (c.bones || []).filter((b) => set.has(b))
        if (!inside.length || (c.bones.length === 2 && inside.length === 1 && inside[0] === c.bones[0])) continue
        if (boneMap.has(c.target) || isDescendant(json, name, c.target)) continue
        const t = findBone(json, c.target)
        if (!t || !t.parent) continue
        const copy = clone(t)
        copy.name = uniqueName(takenBones, t.name)
        takenBones.add(copy.name)
        boneMap.set(t.name, copy.name)
        indexMap.set(boneIndex(json, t.name), json.bones.length)
        json.bones.push(copy)
      }
    }

    // slots: the ones on the copied bones, plus slots whose mesh weights sit
    // mostly on them (a Photoshop rig hangs every slot on root and binds the
    // image by weights, so copying an arm must bring the arm mesh along). Copies
    // go in one block right above the last original, stacking like the original.
    const slotMap = new Map()
    if (o.slots) {
      const takenSlots = new Set(json.slots.map((s) => s.name))
      const setIdx = new Set(names.map((n) => boneIndex(json, n)))
      const share = (slot) => {
        let inside = 0
        let total = 0
        for (const skin of json.skins) {
          for (const att of Object.values(skin.attachments[slot] || {})) {
            if (!isWeighted(att)) continue
            let i = 0
            const v = att.vertices
            while (i < v.length) {
              const n = v[i++]
              for (let k = 0; k < n; k++, i += 4) {
                total += v[i + 3]
                if (setIdx.has(v[i])) inside += v[i + 3]
              }
            }
          }
        }
        return total ? inside / total : 0
      }
      const originals = json.slots.filter((s) => set.has(s.bone) || share(s.name) >= 0.5)
      if (originals.length) {
        const copies = originals.map((s) => {
          const copy = clone(s)
          copy.name = uniqueName(takenSlots, s.name)
          takenSlots.add(copy.name)
          if (boneMap.has(s.bone)) copy.bone = boneMap.get(s.bone)
          slotMap.set(s.name, copy.name)
          return copy
        })
        const last = json.slots.lastIndexOf(originals[originals.length - 1])
        json.slots.splice(last + 1, 0, ...copies)
        for (const skin of json.skins) {
          for (const [from, to] of slotMap) {
            if (!skin.attachments[from]) continue
            const atts = clone(skin.attachments[from])
            for (const key of Object.keys(atts)) {
              const att = atts[key]
              if (isWeighted(att)) mapWeights(att.vertices, (b) => (indexMap.has(b) ? indexMap.get(b) : b))
              if (att && att.type === 'clipping' && slotMap.has(att.end)) att.end = slotMap.get(att.end)
            }
            skin.attachments[to] = atts
          }
        }
        for (const [from, to] of slotMap) if (emptyPlaceholders(json, from).length) setEmptyPlaceholders(json, to, emptyPlaceholders(json, from).slice())
      }
    }

    // constraints that drive any copied bone come along for the copies; the
    // target follows when it was copied too, otherwise the copy shares it. Each
    // copy is solved right after its original so chains that rely on order (a
    // transform moving an IK target before the IK runs) behave the same.
    const constraintMap = []
    if (o.constraints) {
      const taken = constraintNames(json)
      const all = []
      for (const kind of CONSTRAINT_KINDS) for (const c of json[kind]) all.push({ kind, c })
      all.sort((x, y) => num(x.c.order, 0) - num(y.c.order, 0))
      const sequence = []
      for (const { kind, c } of all) {
        sequence.push(c)
        let bones = (c.bones || []).filter((b) => boneMap.has(b))
        if (!bones.length) continue
        // two-bone IK: copying only the child gives a one-bone IK on the copy;
        // copying only the parent (no children) cannot keep the chain, skip it
        if (kind === 'ik' && bones.length === 1 && c.bones.length === 2 && bones[0] === c.bones[0]) continue
        const copy = clone(c)
        copy.name = uniqueName(taken, c.name)
        taken.add(copy.name)
        copy.bones = bones.map((b) => boneMap.get(b))
        if (kind === 'path') { if (slotMap.has(c.target)) copy.target = slotMap.get(c.target) }
        else if (boneMap.has(c.target)) copy.target = boneMap.get(c.target)
        json[kind].push(copy)
        sequence.push(copy)
        constraintMap.push({ kind, from: c.name, to: copy.name })
      }
      if (constraintMap.length) sequence.forEach((c, i) => { c.order = i })
    }

    // skin-scoped bones / constraints stay in the same skins
    for (const skin of json.skins) {
      if (Array.isArray(skin.bones)) for (const [from, to] of boneMap) if (skin.bones.includes(from)) skin.bones.push(to)
      for (const { kind, from, to } of constraintMap) {
        if (Array.isArray(skin[kind]) && skin[kind].includes(from)) skin[kind].push(to)
      }
    }

    if (o.animation) {
      for (const anim of Object.values(json.animations)) {
        if (anim.bones) for (const [from, to] of boneMap) if (anim.bones[from]) anim.bones[to] = clone(anim.bones[from])
        if (anim.slots) for (const [from, to] of slotMap) if (anim.slots[from]) anim.slots[to] = clone(anim.slots[from])
        if (anim.deform) {
          for (const skinKeys of Object.values(anim.deform)) {
            for (const [from, to] of slotMap) if (skinKeys[from]) skinKeys[to] = clone(skinKeys[from])
          }
        }
        for (const { kind, from, to } of constraintMap) {
          if (anim[kind] && anim[kind][from]) anim[kind][to] = clone(anim[kind][from])
        }
      }
    }

    return {
      json: tidy(json),
      bone: boneMap.get(name),
      bones: [...boneMap.values()],
      slots: [...slotMap.values()],
      constraints: constraintMap.map((c) => c.to),
    }
  }

  function renameBone(input, name, next) {
    const json = prepare(input)
    const to = String(next || '').trim() || fail('名称不能为空')
    const bone = requireBone(json, name)
    if (to === name) return { json: tidy(json) }
    if (findBone(json, to)) fail(`骨骼已存在：${to}`)
    bone.name = to
    for (const b of json.bones) if (b.parent === name) b.parent = to
    for (const s of json.slots) if (s.bone === name) s.bone = to
    for (const kind of CONSTRAINT_KINDS) {
      for (const c of json[kind]) {
        c.bones = (c.bones || []).map((b) => (b === name ? to : b))
        if (kind !== 'path' && c.target === name) c.target = to
      }
    }
    for (const skin of json.skins) if (Array.isArray(skin.bones)) skin.bones = skin.bones.map((b) => (b === name ? to : b))
    for (const anim of Object.values(json.animations)) {
      if (anim.bones && anim.bones[name]) { anim.bones[to] = anim.bones[name]; delete anim.bones[name] }
    }
    return { json: tidy(json), bone: to }
  }

  /** Delete a bone with its branch, the slots on it and every constraint touching it. */
  function deleteBone(input, name) {
    const json = prepare(input)
    const bone = requireBone(json, name)
    if (!bone.parent) fail('根骨骼不能删除')
    const gone = new Set(branch(json, name))
    const goneSlots = new Set(json.slots.filter((s) => gone.has(s.bone)).map((s) => s.name))
    const goneIdx = new Set([...gone].map((n) => boneIndex(json, n)))

    forEachAttachment(json, (att, at) => {
      if (goneSlots.has(at.slot)) return
      for (const b of weightBones(att)) {
        if (goneIdx.has(b)) fail(`插槽「${at.slot}」的网格「${at.name}」有权重在要删除的骨骼上，先改权重`)
      }
    })

    const remap = new Map()
    let n = 0
    json.bones.forEach((b, i) => { if (!gone.has(b.name)) remap.set(i, n++) })
    json.bones = json.bones.filter((b) => !gone.has(b.name))
    json.slots = json.slots.filter((s) => !goneSlots.has(s.name))

    const goneConstraints = []
    for (const kind of CONSTRAINT_KINDS) {
      json[kind] = json[kind].filter((c) => {
        const hit = (c.bones || []).some((b) => gone.has(b))
          || (kind === 'path' ? goneSlots.has(c.target) : gone.has(c.target))
        if (hit) goneConstraints.push({ kind, name: c.name })
        return !hit
      })
    }
    for (const skin of json.skins) {
      for (const s of goneSlots) delete skin.attachments[s]
      if (Array.isArray(skin.bones)) skin.bones = skin.bones.filter((b) => !gone.has(b))
      for (const { kind, name: c } of goneConstraints) if (Array.isArray(skin[kind])) skin[kind] = skin[kind].filter((x) => x !== c)
    }
    forEachAttachment(json, (att) => {
      if (isWeighted(att)) mapWeights(att.vertices, (b) => remap.get(b))
      if (att && att.type === 'clipping' && goneSlots.has(att.end)) delete att.end
    })
    for (const anim of Object.values(json.animations)) {
      if (anim.bones) for (const b of gone) delete anim.bones[b]
      if (anim.slots) for (const s of goneSlots) delete anim.slots[s]
      if (anim.deform) for (const skinKeys of Object.values(anim.deform)) for (const s of goneSlots) delete skinKeys[s]
      for (const { kind, name: c } of goneConstraints) if (anim[kind]) delete anim[kind][c]
      if (Array.isArray(anim.drawOrder)) {
        for (const key of anim.drawOrder) if (key.offsets) key.offsets = key.offsets.filter((o) => !goneSlots.has(o.slot))
      }
    }
    return { json: tidy(json), bones: [...gone], slots: [...goneSlots], constraints: goneConstraints.map((c) => c.name) }
  }

  /** Local transform (normal inheritance) that gives world matrix `W` under parent world matrix `P`. */
  function localFromWorld(W, P) {
    const det = P.a * P.d - P.b * P.c
    if (!det) fail('父骨骼缩放为 0')
    const la = (P.d * W.a - P.b * W.c) / det
    const lb = (P.d * W.b - P.b * W.d) / det
    const lc = (P.a * W.c - P.c * W.a) / det
    const ld = (P.a * W.d - P.c * W.b) / det
    const [x, y] = toLocal(P, W.worldX, W.worldY)
    const deg = 180 / Math.PI
    const rotation = Math.atan2(lc, la) * deg
    let scaleY = Math.hypot(lb, ld)
    let shearY = Math.atan2(ld, lb) * deg - rotation - 90
    if (la * ld - lb * lc < 0) { scaleY = -scaleY; shearY -= 180 }
    shearY = ((shearY % 360) + 540) % 360 - 180
    return { x, y, rotation, scaleX: Math.hypot(la, lc), scaleY, shearX: 0, shearY: Math.abs(shearY) < 1e-3 ? 0 : shearY }
  }

  /** World matrix of local `props` under parent world matrix `P` (normal inheritance, Spine 3.8). */
  function worldFromLocal(P, props) {
    const r = Math.PI / 180
    const rot = num(props.rotation, 0), sx = num(props.scaleX, 1), sy = num(props.scaleY, 1)
    const la = Math.cos((rot + num(props.shearX, 0)) * r) * sx
    const lb = Math.cos((rot + 90 + num(props.shearY, 0)) * r) * sy
    const lc = Math.sin((rot + num(props.shearX, 0)) * r) * sx
    const ld = Math.sin((rot + 90 + num(props.shearY, 0)) * r) * sy
    const [wx, wy] = toWorld(P, num(props.x, 0), num(props.y, 0))
    return { a: P.a * la + P.b * lc, b: P.a * lb + P.b * ld, c: P.c * la + P.d * lc, d: P.c * lb + P.d * ld, worldX: wx, worldY: wy }
  }

  function writeLocal(bone, props) {
    for (const k of BONE_PROPS) {
      if (props[k] === undefined) continue
      const def = k.startsWith('scale') ? 1 : 0
      const v = Math.round(props[k] * 1000) / 1000
      if (Math.abs(v - def) < 1e-3) delete bone[k]
      else bone[k] = k === 'x' || k === 'y' || k === 'rotation' ? round(v) : v
    }
  }

  /**
   * Spine's bone compensation: give each named bone the local transform that
   * keeps world matrix `worlds[name]` under the (new) parent matrix
   * `parents[name]`. Used after a parent moved so its children stay put.
   */
  function keepWorld(input, worlds, parents) {
    const json = prepare(input)
    for (const name of Object.keys(worlds)) {
      const bone = requireBone(json, name)
      if (!parents[name]) continue
      const keepLength = bone.length
      writeLocal(bone, localFromWorld(worlds[name], parents[name]))
      if (keepLength !== undefined) bone.length = keepLength
    }
    return { json: tidy(json) }
  }

  /**
   * Spine "Set Parent": hang a bone (with its branch) under another bone and keep
   * its setup-pose world transform. `matrices` holds the setup world matrix of
   * the bone and the new parent. A parent that sits later in the bone list moves
   * the branch after it, so weighted vertices are remapped.
   */
  function reparentBone(input, name, parent, matrices) {
    const json = prepare(input)
    const bone = requireBone(json, name)
    requireBone(json, parent)
    if (!bone.parent) fail('根骨骼不能换父级')
    if (parent === bone.parent) return { json: tidy(json) }
    const moving = branch(json, name)
    if (moving.includes(parent)) fail('不能挂到自己的子骨骼下')
    const W = matrices && matrices[name]
    const P = matrices && matrices[parent]
    if (W && P) writeLocal(bone, localFromWorld(W, P))
    bone.parent = parent
    const pIdx = boneIndex(json, parent)
    const bIdx = boneIndex(json, name)
    if (pIdx > bIdx) {
      const set = new Set(moving)
      const old = json.bones.slice()
      const rest = old.filter((b) => !set.has(b.name))
      const at = rest.findIndex((b) => b.name === parent)
      const next = [...rest.slice(0, at + 1), ...old.filter((b) => set.has(b.name)), ...rest.slice(at + 1)]
      const remap = new Map(old.map((b, i) => [i, next.indexOf(b)]))
      json.bones = next
      forEachAttachment(json, (att) => { if (isWeighted(att)) mapWeights(att.vertices, (b) => remap.get(b)) })
    }
    return { json: tidy(json) }
  }

  // ---------------------------------------------------------------- slots

  /** Spine "New Slot": an empty slot on a bone, drawn on top of everything. */
  function addSlot(input, bone, name) {
    const json = prepare(input)
    requireBone(json, bone)
    const taken = new Set(json.slots.map((s) => s.name))
    const n = String(name || '').trim() ? String(name).trim() : uniqueName(taken, `${bone}_slot`, true)
    if (taken.has(n)) fail(`插槽已存在：${n}`)
    json.slots.push({ name: n, bone })
    return { json: tidy(json), slot: n }
  }

  // ---------------------------------------------------------------- 剪裁 (Spine's clipping)
  //
  // A clipping attachment is a polygon in its slot (unweighted vertices in the slot bone's space,
  // or weighted ones). It clips every slot drawn after its own slot up to and including `end`
  // (no end = to the top of the draw order); where it sits is its slot's place in the draw order.

  const CLIP_COLOR = 'ce3a3aff'

  /** A new clipping in `slot` (default skin), shown by the slot like any new attachment in Spine. */
  function createClipping(input, slot, opts) {
    const json = prepare(input)
    const s = requireSlot(json, slot)
    const o = opts || {}
    const skin = requireSkin(json, 'default')
    const taken = new Set()
    for (const sk of json.skins) for (const k of Object.keys(sk.attachments[slot] || {})) taken.add(k)
    const n = uniqueName(taken, String(o.name || 'clipping').trim() || 'clipping', true)
    const att = { type: 'clipping', vertexCount: 0, vertices: [] }
    if (Array.isArray(o.vertices) && o.vertices.length >= 6) { att.vertexCount = o.vertices.length / 2; att.vertices = o.vertices.map((x) => Math.round(x * 1000) / 1000) }
    if (o.end) { requireSlot(json, o.end); att.end = o.end }
    skin.attachments[slot] = skin.attachments[slot] || {}
    skin.attachments[slot][n] = att
    s.attachment = n
    return { json: tidy(json), attachment: n }
  }

  /**
   * A clipping's polygon (`vertices`: flat x, y in the slot bone's space; a new count drops its
   * deform keys), its 结束插槽 (`end`, '' = to the top) and its colour.
   */
  function setClipping(input, skinName, slot, name, props) {
    const json = prepare(input)
    const skin = requireSkin(json, skinName)
    const att = (skin.attachments[slot] || {})[name]
    if (!att || att.type !== 'clipping') fail(`不是剪裁：${name}`)
    const p = props || {}
    if (p.vertices !== undefined) {
      const v = Array.from(p.vertices, (x) => Math.round(Number(x) * 1000) / 1000)
      if (v.length % 2 || v.some((x) => !Number.isFinite(x))) fail('剪裁顶点不对')
      const same = att.vertices && att.vertices.length === v.length && (Number(att.vertexCount) || 0) * 2 === v.length
      att.vertexCount = v.length / 2
      att.vertices = v
      if (!same) {
        for (const a of Object.values(json.animations)) {
          const d = a.deform && a.deform[skinName] && a.deform[skinName][slot]
          if (d && d[name]) delete d[name]
        }
      }
    }
    if (p.end !== undefined) {
      if (p.end) { requireSlot(json, p.end); att.end = p.end } else delete att.end
    }
    if (p.color !== undefined) {
      const c = String(p.color || '').toLowerCase()
      if (c && c !== CLIP_COLOR) att.color = c
      else delete att.color
    }
    return { json: tidy(json) }
  }

  /** Copy a slot (attachments in every skin, keys) directly above the original. */
  function duplicateSlot(input, name, opts) {
    const json = prepare(input)
    const o = { animation: true, ...(opts || {}) }
    const src = requireSlot(json, name)
    const copy = clone(src)
    copy.name = uniqueName(new Set(json.slots.map((s) => s.name)), name)
    json.slots.splice(json.slots.indexOf(src) + 1, 0, copy)
    for (const skin of json.skins) {
      if (skin.attachments[name]) skin.attachments[copy.name] = clone(skin.attachments[name])
    }
    if (emptyPlaceholders(json, name).length) setEmptyPlaceholders(json, copy.name, emptyPlaceholders(json, name).slice())
    if (o.animation) {
      for (const anim of Object.values(json.animations)) {
        if (anim.slots && anim.slots[name]) anim.slots[copy.name] = clone(anim.slots[name])
        if (anim.deform) for (const skinKeys of Object.values(anim.deform)) if (skinKeys[name]) skinKeys[copy.name] = clone(skinKeys[name])
      }
    }
    return { json: tidy(json), slot: copy.name }
  }

  function renameSlot(input, name, next) {
    const json = prepare(input)
    const to = String(next || '').trim() || fail('名称不能为空')
    const slot = requireSlot(json, name)
    if (to === name) return { json: tidy(json) }
    if (findSlot(json, to)) fail(`插槽已存在：${to}`)
    slot.name = to
    for (const skin of json.skins) {
      if (skin.attachments[name]) { skin.attachments[to] = skin.attachments[name]; delete skin.attachments[name] }
    }
    forEachAttachment(json, (att) => { if (att && att.type === 'clipping' && att.end === name) att.end = to })
    if (emptyPlaceholders(json, name).length) { setEmptyPlaceholders(json, to, emptyPlaceholders(json, name)); delete json[EMPTY_PLACEHOLDERS][name] }
    for (const c of json.path) if (c.target === name) c.target = to
    for (const anim of Object.values(json.animations)) {
      if (anim.slots && anim.slots[name]) { anim.slots[to] = anim.slots[name]; delete anim.slots[name] }
      if (anim.deform) {
        for (const skinKeys of Object.values(anim.deform)) {
          if (skinKeys[name]) { skinKeys[to] = skinKeys[name]; delete skinKeys[name] }
        }
      }
      if (Array.isArray(anim.drawOrder)) {
        for (const key of anim.drawOrder) for (const off of key.offsets || []) if (off.slot === name) off.slot = to
      }
    }
    return { json: tidy(json), slot: to }
  }

  function deleteSlot(input, name) {
    const json = prepare(input)
    requireSlot(json, name)
    if (json.path.some((c) => c.target === name)) fail('有路径约束用着这个插槽')
    json.slots = json.slots.filter((s) => s.name !== name)
    for (const skin of json.skins) delete skin.attachments[name]
    if (json[EMPTY_PLACEHOLDERS]) delete json[EMPTY_PLACEHOLDERS][name]
    forEachAttachment(json, (att) => { if (att && att.type === 'clipping' && att.end === name) delete att.end })
    for (const anim of Object.values(json.animations)) {
      if (anim.slots) delete anim.slots[name]
      if (anim.deform) for (const skinKeys of Object.values(anim.deform)) delete skinKeys[name]
      if (Array.isArray(anim.drawOrder)) {
        for (const key of anim.drawOrder) if (key.offsets) key.offsets = key.offsets.filter((o) => o.slot !== name)
      }
    }
    return { json: tidy(json) }
  }

  const HEX = /^[0-9a-fA-F]{8}$/

  /**
   * Setup-pose slot settings. `bone` re-hangs the slot; pass `matrices`
   * ({ boneName: {a,b,c,d,worldX,worldY} }) so unweighted attachments stay put.
   */
  function setSlotProps(input, name, props, matrices) {
    const json = prepare(input)
    const slot = requireSlot(json, name)
    if (props.attachment !== undefined) {
      if (props.attachment) slot.attachment = String(props.attachment)
      else delete slot.attachment
    }
    if (props.color !== undefined) {
      const c = String(props.color || '').replace('#', '')
      if (!c || c.toLowerCase() === 'ffffffff') delete slot.color
      else if (HEX.test(c)) slot.color = c.toLowerCase()
      else fail('颜色格式应为 RRGGBBAA')
    }
    if (props.dark !== undefined) {
      const c = String(props.dark || '').replace('#', '')
      if (!c) delete slot.dark
      else if (/^[0-9a-fA-F]{6}$/.test(c)) slot.dark = c.toLowerCase()
      else fail('暗色格式应为 RRGGBB')
    }
    if (props.blend !== undefined) {
      if (!props.blend || props.blend === 'normal') delete slot.blend
      else if (['additive', 'multiply', 'screen'].includes(props.blend)) slot.blend = props.blend
      else fail(`未知混合模式：${props.blend}`)
    }
    if (props.bone !== undefined && props.bone !== slot.bone) {
      requireBone(json, props.bone)
      const from = matrices && matrices[slot.bone]
      const to = matrices && matrices[props.bone]
      for (const skin of json.skins) {
        const map = skin.attachments[name] || {}
        for (const key of Object.keys(map)) rebaseAttachment(map[key], from, to)
      }
      slot.bone = props.bone
    }
    return { json: tidy(json) }
  }

  /** Move a slot in the setup draw order: `to` is the new index (0 = drawn first / bottom). */
  function moveSlot(input, name, to) {
    const json = prepare(input)
    const slot = requireSlot(json, name)
    const from = json.slots.indexOf(slot)
    const target = Math.max(0, Math.min(json.slots.length - 1, Math.round(num(to, from))))
    const order = json.slots.map((x) => x.name)
    order.splice(from, 1)
    order.splice(target, 0, name)
    return { ...reorderSlots(json, order), index: target }
  }

  // ---------------------------------------------------------------- draw order
  //
  // Spine 3.8 keeps a draw-order key as offsets from the setup order:
  // { time, offsets: [{ slot, offset }] } in setup order; no offsets = the setup order.

  /** A key's offsets → the full order (slot names, bottom first), as the 3.8 reader builds it. */
  function decodeDrawOrder(setup, offsets) {
    const n = setup.length
    const order = new Array(n).fill(-1)
    const unchanged = []
    let orig = 0
    for (const o of offsets || []) {
      const idx = setup.indexOf(o.slot)
      if (idx < 0) continue
      while (orig !== idx) unchanged.push(orig++)
      order[orig + num(o.offset, 0)] = orig++
    }
    while (orig < n) unchanged.push(orig++)
    for (let i = n - 1; i >= 0; i--) if (order[i] === -1) order[i] = unchanged.pop()
    return order.map((i) => setup[i])
  }

  /** A full order → the offsets of the slots that moved (all of them if that is what it takes). */
  function encodeDrawOrder(setup, order) {
    const moved = setup.map((name, i) => ({ slot: name, offset: order.indexOf(name) - i })).filter((o) => o.offset)
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
    if (same(decodeDrawOrder(setup, moved), order)) return moved
    return setup.map((name, i) => ({ slot: name, offset: order.indexOf(name) - i }))
  }

  /**
   * The setup draw order as `order` (slot names, bottom first). Draw-order keys are offsets
   * from the setup order, so every key is rewritten to keep showing the same order.
   */
  function reorderSlots(input, order) {
    const json = prepare(input)
    const before = json.slots.map((x) => x.name)
    if (order.length !== before.length || order.some((n) => !before.includes(n))) fail('绘制顺序要包含全部插槽')
    for (const a of Object.values(json.animations)) {
      if (!Array.isArray(a.drawOrder)) continue
      for (const k of a.drawOrder) {
        const full = decodeDrawOrder(before, k.offsets)
        const off = encodeDrawOrder(order, full)
        if (off.length) k.offsets = off
        else delete k.offsets
      }
    }
    json.slots = order.map((n) => json.slots.find((x) => x.name === n))
    return { json: tidy(json) }
  }

  /** Spine's draw-order key: the slots drawn in `order` (bottom first) from `time` on. */
  function keyDrawOrder(input, anim, time, order) {
    const json = prepare(input)
    const a = animationOf(json, anim)
    const setup = json.slots.map((x) => x.name)
    if (order.length !== setup.length || order.some((n) => !setup.includes(n))) fail('绘制顺序要包含全部插槽')
    const off = encodeDrawOrder(setup, order)
    a.drawOrder = Array.isArray(a.drawOrder) ? a.drawOrder : []
    upsertKey(a.drawOrder, time, off.length ? { offsets: off } : {})
    const i = a.drawOrder.findIndex((k) => sameTime(k.time, keyTime(time)))
    if (i >= 0 && !off.length) delete a.drawOrder[i].offsets
    return { json: tidy(json) }
  }

  /**
   * Spine's image compensation: a bone moved from world matrix `from` to `to`;
   * the unweighted attachments of the named slots are moved back so they stay
   * where they were on screen.
   */
  function compensateImages(input, slots, from, to) {
    const json = prepare(input)
    for (const skin of json.skins) {
      for (const slot of slots) {
        for (const att of Object.values(skin.attachments[slot] || {})) rebaseAttachment(att, from, to)
      }
    }
    return { json: tidy(json) }
  }

  // ---------------------------------------------------------------- attachments

  function attachmentsOf(json, skin, slot) {
    const s = requireSkin(json, skin)
    return s.attachments[slot] || null
  }

  /** Add a region attachment (an image the atlas holds as `path`) to a slot in a skin. */
  function addRegionAttachment(input, skin, slot, opts) {
    const json = prepare(input)
    const s = requireSkin(json, skin)
    const sl = requireSlot(json, slot)
    const o = opts || {}
    const taken = new Set()
    for (const sk of json.skins) for (const k of Object.keys(sk.attachments[slot] || {})) taken.add(k)
    const name = uniqueName(taken, String(o.name || o.path || '').trim() || fail('需要图片名'), true)
    const att = { width: Math.round(num(o.width, 1)), height: Math.round(num(o.height, 1)) }
    if (o.path && o.path !== name) att.path = o.path
    if (num(o.x, 0)) att.x = round(num(o.x, 0))
    if (num(o.y, 0)) att.y = round(num(o.y, 0))
    if (num(o.rotation, 0)) att.rotation = round(num(o.rotation, 0))
    s.attachments[slot] = s.attachments[slot] || {}
    s.attachments[slot][name] = att
    if (o.show !== false) sl.attachment = name
    return { json: tidy(json), attachment: name }
  }

  const ATT_PROPS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'width', 'height']

  function setAttachmentProps(input, skin, slot, name, props) {
    const json = prepare(input)
    const map = attachmentsOf(json, skin, slot) || fail('这个皮肤里没有该插槽的附件')
    const att = map[name] || fail(`找不到附件：${name}`)
    for (const k of ATT_PROPS) {
      if (props[k] === undefined) continue
      const v = num(props[k], NaN)
      if (!Number.isFinite(v)) fail(`${k} 不是数字`)
      att[k] = round(v * 1000) / 1000
    }
    if (props.path !== undefined) {
      if (props.path && props.path !== name) att.path = props.path
      else delete att.path
    }
    return { json: tidy(json) }
  }

  /**
   * Rename an attachment key in every skin (the key is the placeholder the slot
   * and the attachment keys refer to). The image stays: `path` keeps the old name.
   */
  function renameAttachment(input, slot, name, next) {
    const json = prepare(input)
    const to = String(next || '').trim() || fail('名称不能为空')
    if (to === name) return { json: tidy(json) }
    let found = false
    for (const skin of json.skins) {
      const map = skin.attachments[slot]
      if (!map || !map[name]) continue
      if (map[to]) fail(`皮肤「${skin.name}」里已有附件：${to}`)
      const att = map[name]
      const type = att.type || 'region'
      if ((type === 'region' || type === 'mesh' || type === 'linkedmesh') && !att.path) att.path = name
      map[to] = att
      delete map[name]
      found = true
    }
    const empties = emptyPlaceholders(json, slot)
    if (empties.includes(name)) {
      if (empties.includes(to)) fail(`占位符已存在：${to}`)
      setEmptyPlaceholders(json, slot, empties.map((n) => (n === name ? to : n)))
      found = true
    }
    if (!found) fail(`找不到附件：${name}`)
    forEachAttachment(json, (att, at) => {
      if (at.slot === slot && att && att.type === 'linkedmesh' && att.parent === name) att.parent = to
    })
    const s = findSlot(json, slot)
    if (s && s.attachment === name) s.attachment = to
    if (Array.isArray(json[NO_EXPORT])) for (const e of json[NO_EXPORT]) if (e[1] === slot && e[2] === name) e[2] = to
    for (const anim of Object.values(json.animations)) {
      const keys = anim.slots && anim.slots[slot] && anim.slots[slot].attachment
      if (Array.isArray(keys)) for (const k of keys) if (k.name === name) k.name = to
      if (anim.deform) {
        for (const skinKeys of Object.values(anim.deform)) {
          if (skinKeys[slot] && skinKeys[slot][name]) { skinKeys[slot][to] = skinKeys[slot][name]; delete skinKeys[slot][name] }
        }
      }
    }
    return { json: tidy(json), attachment: to }
  }

  function deleteAttachment(input, skin, slot, name, opts) {
    const json = prepare(input)
    const keep = !!(opts && opts.keepPlaceholder)
    const s = requireSkin(json, skin)
    const map = s.attachments[slot]
    if (!map || !map[name]) fail(`找不到附件：${name}`)
    for (const sk of json.skins) {
      for (const [k, att] of Object.entries(sk.attachments[slot] || {})) {
        if (att && att.type === 'linkedmesh' && att.parent === name && (att.skin || 'default') === skin && !(sk.name === skin && k === name)) {
          fail(`皮肤「${sk.name}」的「${k}」链接着它，先删那个`)
        }
      }
    }
    delete map[name]
    if (!Object.keys(map).length) delete s.attachments[slot]
    const stillSomewhere = json.skins.some((sk) => sk.attachments[slot] && sk.attachments[slot][name])
    const sl = findSlot(json, slot)
    if (keep && !json.skins.some((sk) => sk.name !== 'default' && sk.attachments[slot] && sk.attachments[slot][name])) {
      setEmptyPlaceholders(json, slot, [...emptyPlaceholders(json, slot), name])
    }
    if (!keep && !stillSomewhere && sl && sl.attachment === name) delete sl.attachment
    for (const anim of Object.values(json.animations)) {
      if (anim.deform && anim.deform[skin] && anim.deform[skin][slot]) {
        delete anim.deform[skin][slot][name]
        if (!Object.keys(anim.deform[skin][slot]).length) delete anim.deform[skin][slot]
      }
    }
    return { json: tidy(json) }
  }

  /**
   * Copy (or move) an attachment from one slot to another inside a skin. The
   * target slot's bone may differ: pass `matrices` so it stays in place.
   */
  function transferAttachment(input, skin, fromSlot, name, toSlot, opts, matrices) {
    const json = prepare(input)
    const o = { move: false, show: true, ...(opts || {}) }
    const s = requireSkin(json, skin)
    const from = requireSlot(json, fromSlot)
    const to = requireSlot(json, toSlot)
    if (fromSlot === toSlot) fail('同一个插槽')
    const att = s.attachments[fromSlot] && s.attachments[fromSlot][name]
    if (!att) fail(`找不到附件：${name}`)
    if (att.type === 'linkedmesh') fail('链接网格不能单独搬到别的插槽')
    const copy = clone(att)
    const type = copy.type || 'region'
    if ((type === 'region' || type === 'mesh') && !copy.path) copy.path = name
    if (from.bone !== to.bone) {
      if (isWeighted(copy)) {
        // weights are absolute bone indices, the slot bone does not matter
      } else rebaseAttachment(copy, matrices && matrices[from.bone], matrices && matrices[to.bone])
    }
    s.attachments[toSlot] = s.attachments[toSlot] || {}
    const key = uniqueName(new Set(Object.keys(s.attachments[toSlot])), name, true)
    s.attachments[toSlot][key] = copy
    if (o.show) to.attachment = key
    let json2 = json
    if (o.move) json2 = prepare(deleteAttachment(json, skin, fromSlot, name).json)
    return { json: tidy(json2), attachment: key }
  }

  // ---------------------------------------------------------------- skin placeholders
  //
  // Spine's skin placeholder: a name under a slot (the key in skin.attachments)
  // that each skin fills with its own attachment. The slot (and attachment keys)
  // point at the placeholder; the active skin decides what is drawn.

  function isPlaceholder(json, slot, name) {
    return emptyPlaceholders(json, slot).includes(name)
      || json.skins.some((s) => s.name !== 'default' && s.attachments[slot] && s.attachments[slot][name])
  }

  /** Placeholders of a slot with what each skin holds: [{ name, skins: { skinName: attachment } }]. */
  function placeholderList(input, slot) {
    // read only, and asked once per slot while the tree is drawn: no copy of the project
    const json = input && Array.isArray(input.skins) ? input : prepare(input)
    const names = new Set(emptyPlaceholders(json, slot))
    for (const s of json.skins) if (s.name !== 'default') for (const k of Object.keys(s.attachments[slot] || {})) names.add(k)
    return [...names].map((name) => {
      const skins = {}
      for (const s of json.skins) if (s.attachments[slot] && s.attachments[slot][name]) skins[s.name] = s.attachments[slot][name]
      return { name, skins }
    })
  }

  function addPlaceholder(input, slot, name) {
    const json = prepare(input)
    requireSlot(json, slot)
    const taken = new Set(emptyPlaceholders(json, slot))
    for (const s of json.skins) for (const k of Object.keys(s.attachments[slot] || {})) taken.add(k)
    const n = String(name || '').trim() ? String(name).trim() : uniqueName(taken, slot, true)
    if (taken.has(n)) fail(`插槽里已有：${n}`)
    setEmptyPlaceholders(json, slot, [...emptyPlaceholders(json, slot), n])
    return { json: tidy(json), placeholder: n }
  }

  /**
   * Put an image into a placeholder for one skin. When another skin already
   * holds a mesh there, this skin gets a linked mesh of it (same shape, weights
   * and deform keys, its own image) — Spine's way; a region keeps the other
   * skin's placement. `image` = { path, width, height[, x, y, rotation] }.
   */
  function fillPlaceholder(input, skin, slot, name, image) {
    const json = prepare(input)
    const s = requireSkin(json, skin)
    requireSlot(json, slot)
    if (!isPlaceholder(json, slot, name) && !json.skins.some((x) => x.attachments[slot] && x.attachments[slot][name])) fail(`找不到占位符：${name}`)
    const o = image || {}
    const path = String(o.path || '').trim() || fail('需要图片')
    const size = { width: Math.round(num(o.width, 1)), height: Math.round(num(o.height, 1)) }
    const own = s.attachments[slot] && s.attachments[slot][name]
    let att
    if (own && (own.type === 'mesh' || own.type === 'linkedmesh')) {
      att = own
      att.path = path
      Object.assign(att, size)
    } else {
      // the template: a mesh anywhere wins (so skins share one mesh), then a region
      let tpl = null
      for (const x of json.skins) {
        if (x.name === skin) continue
        const a = x.attachments[slot] && x.attachments[slot][name]
        if (!a) continue
        if (a.type === 'mesh') { tpl = { skin: x.name, att: a }; break }
        if (!tpl) tpl = { skin: x.name, att: a }
      }
      if (tpl && tpl.att.type === 'mesh') {
        att = { type: 'linkedmesh', parent: name, path, ...size }
        if (tpl.skin !== 'default') att.skin = tpl.skin
      } else if (tpl && tpl.att.type === 'linkedmesh') {
        att = { ...clone(tpl.att), path, ...size }
      } else if (tpl && (tpl.att.type || 'region') === 'region') {
        att = { ...clone(tpl.att), path, ...size }
      } else if (own && (own.type || 'region') === 'region') {
        att = { ...own, path, ...size }
      } else {
        att = { path, ...size }
        for (const k of ['x', 'y', 'rotation']) if (num(o[k], 0)) att[k] = round(num(o[k], 0))
      }
    }
    s.attachments[slot] = s.attachments[slot] || {}
    s.attachments[slot][name] = att
    return { json: tidy(json) }
  }

  /** Take a placeholder's content out of one skin; the placeholder itself stays. */
  function clearPlaceholder(input, skin, slot, name) {
    return deleteAttachment(input, skin, slot, name, { keepPlaceholder: true })
  }

  /**
   * Turn a default-skin attachment into a skin placeholder: every other skin
   * gets it (the first skin that has nothing there takes the original, the rest
   * link to it when it is a mesh), and default no longer draws it. Each skin can
   * then swap its own image in.
   */
  function convertToPlaceholder(input, slot, name) {
    const json = prepare(input)
    const def = findSkin(json, 'default')
    const att = def.attachments[slot] && def.attachments[slot][name]
    if (!att) fail(`default 皮肤里没有：${name}`)
    if (att.type === 'linkedmesh') fail('链接网格要从它的原网格转')
    const others = json.skins.filter((x) => x.name !== 'default')
    if (!others.length) fail('先新建皮肤')
    const owner = others.find((x) => !(x.attachments[slot] && x.attachments[slot][name]))
    const linkedToDefault = []
    forEachAttachment(json, (a, at) => {
      if (at.slot === slot && a && a.type === 'linkedmesh' && a.parent === name && !a.skin) linkedToDefault.push(a)
    })
    if (!owner && linkedToDefault.length) fail('每个皮肤都已有自己的，而且有链接网格用着 default 这份')
    if (owner) {
      owner.attachments[slot] = owner.attachments[slot] || {}
      owner.attachments[slot][name] = att
      for (const a of linkedToDefault) a.skin = owner.name
      for (const x of others) {
        if (x === owner || (x.attachments[slot] && x.attachments[slot][name])) continue
        x.attachments[slot] = x.attachments[slot] || {}
        x.attachments[slot][name] = att.type === 'mesh'
          ? { type: 'linkedmesh', parent: name, skin: owner.name, path: att.path || name, width: att.width, height: att.height }
          : clone(att)
      }
      for (const anim of Object.values(json.animations)) {
        const d = anim.deform && anim.deform.default && anim.deform.default[slot] && anim.deform.default[slot][name]
        if (!d) continue
        anim.deform[owner.name] = anim.deform[owner.name] || {}
        anim.deform[owner.name][slot] = anim.deform[owner.name][slot] || {}
        if (!anim.deform[owner.name][slot][name]) anim.deform[owner.name][slot][name] = d
        delete anim.deform.default[slot][name]
        if (!Object.keys(anim.deform.default[slot]).length) delete anim.deform.default[slot]
      }
    }
    delete def.attachments[slot][name]
    if (!Object.keys(def.attachments[slot]).length) delete def.attachments[slot]
    return { json: tidy(json), owner: owner ? owner.name : null }
  }

  /** Remove a placeholder from every skin. */
  function deletePlaceholder(input, slot, name) {
    const json = prepare(input)
    requireSlot(json, slot)
    if (!isPlaceholder(json, slot, name)) fail(`找不到占位符：${name}`)
    forEachAttachment(json, (a, at) => {
      if (at.slot === slot && at.name !== name && a && a.type === 'linkedmesh' && a.parent === name) fail(`「${at.name}」链接着它`)
    })
    for (const s of json.skins) {
      if (s.attachments[slot]) {
        delete s.attachments[slot][name]
        if (!Object.keys(s.attachments[slot]).length) delete s.attachments[slot]
      }
    }
    setEmptyPlaceholders(json, slot, emptyPlaceholders(json, slot).filter((n) => n !== name))
    const sl = findSlot(json, slot)
    if (sl.attachment === name) delete sl.attachment
    for (const anim of Object.values(json.animations)) {
      if (anim.deform) for (const skinKeys of Object.values(anim.deform)) if (skinKeys[slot]) delete skinKeys[slot][name]
    }
    return { json: tidy(json) }
  }

  /** The JSON a Spine runtime gets: the lab-only empty placeholders removed. */
  function exportable(input) {
    const json = clone(input)
    delete json[EMPTY_PLACEHOLDERS]
    // Spine's 导出 unticked: the image (and linked meshes drawing from it) stays out of the export
    const drop = Array.isArray(json[NO_EXPORT]) ? json[NO_EXPORT] : []
    delete json[NO_EXPORT]
    const gone = (skin, slot, name) => drop.some(([a, b, c]) => a === skin && b === slot && c === name)
    for (const skin of json.skins || []) {
      for (const [slot, map] of Object.entries(skin.attachments || {})) {
        for (const [name, att] of Object.entries(map)) {
          const linkedGone = att.type === 'linkedmesh' && gone(att.skin || 'default', slot, att.parent)
          if (!gone(skin.name, slot, name) && !linkedGone) continue
          delete map[name]
          for (const a of Object.values(json.animations || {})) {
            const d = a.deform && a.deform[skin.name] && a.deform[skin.name][slot]
            if (d) delete d[name]
            if (skin.name === 'default') for (const k of (a.slots && a.slots[slot] && a.slots[slot].attachment) || []) if (k.name === name) k.name = null
          }
          if (skin.name === 'default') for (const sl of json.slots || []) if (sl.name === slot && sl.attachment === name) delete sl.attachment
        }
        if (!Object.keys(map).length) delete skin.attachments[slot]
      }
    }
    return json
  }

  /** What the editor's runtime reads: the lab-only fields go, every image stays (导出 only affects the export). */
  function editorData(input) {
    const json = clone(input)
    delete json[EMPTY_PLACEHOLDERS]
    delete json[NO_EXPORT]
    return json
  }

  /** Spine's 导出 on an image: false keeps it in the editor but out of the export. */
  function setAttachmentExport(input, skin, slot, name, on) {
    const json = prepare(input)
    const map = attachmentsOf(json, skin, slot) || fail('这个皮肤里没有该插槽的附件')
    if (!map[name]) fail(`找不到附件：${name}`)
    const list = (Array.isArray(json[NO_EXPORT]) ? json[NO_EXPORT] : []).filter(([a, b, c]) => !(a === skin && b === slot && c === name))
    if (!on) list.push([skin, slot, name])
    json[NO_EXPORT] = list
    return { json: tidy(json) }
  }

  function isExported(json, skin, slot, name) {
    return !(Array.isArray(json[NO_EXPORT]) && json[NO_EXPORT].some(([a, b, c]) => a === skin && b === slot && c === name))
  }

  // ---------------------------------------------------------------- keys

  function animationOf(json, anim) {
    return json.animations[anim] || fail(`找不到动画：${anim}`)
  }

  function upsertKey(list, time, value) {
    // Spine writes key times with 4 decimals
    const t = Math.round(num(time, 0) * 10000) / 10000
    const i = list.findIndex((k) => Math.abs(num(k.time, 0) - t) < 1e-4)
    const key = t ? { time: t, ...value } : { ...value }
    if (i >= 0) {
      const curve = list[i].curve
      list[i] = key
      if (curve !== undefined) list[i].curve = curve
    } else {
      list.push(key)
      list.sort((a, b) => num(a.time, 0) - num(b.time, 0))
    }
  }

  function removeKey(list, time) {
    const t = num(time, 0)
    const i = list.findIndex((k) => Math.abs(num(k.time, 0) - t) < 1e-4)
    if (i >= 0) list.splice(i, 1)
    return i >= 0
  }

  /**
   * Key a bone at `time` from absolute local values (what the user posed):
   * rotation → rotate, x/y → translate, scaleX/scaleY → scale, shearX/shearY →
   * shear. Spine 3.8 stores rotate/translate/shear as offsets from the setup
   * pose and scale as a factor of it.
   */
  function keyBone(input, anim, name, time, local) {
    const json = prepare(input)
    const b = requireBone(json, name)
    const a = animationOf(json, anim)
    const v = local || {}
    const setup = (k, d) => num(b[k], d)
    const r3 = (x) => Math.round(x * 1000) / 1000
    a.bones = a.bones || {}
    const tl = (a.bones[name] = a.bones[name] || {})
    const put = (kind, value) => { tl[kind] = tl[kind] || []; upsertKey(tl[kind], time, value) }
    if (v.rotation !== undefined) put('rotate', { angle: r3(num(v.rotation, 0) - setup('rotation', 0)) })
    if (v.x !== undefined || v.y !== undefined) {
      put('translate', { x: r3(num(v.x, setup('x', 0)) - setup('x', 0)), y: r3(num(v.y, setup('y', 0)) - setup('y', 0)) })
    }
    if (v.scaleX !== undefined || v.scaleY !== undefined) {
      const f = (k) => { const s0 = setup(k, 1); return s0 ? r3(num(v[k], s0) / s0) : 1 }
      put('scale', { x: f('scaleX'), y: f('scaleY') })
    }
    if (v.shearX !== undefined || v.shearY !== undefined) {
      put('shear', { x: r3(num(v.shearX, setup('shearX', 0)) - setup('shearX', 0)), y: r3(num(v.shearY, setup('shearY', 0)) - setup('shearY', 0)) })
    }
    return { json: tidy(json) }
  }

  /** Key times of a bone in an animation: { rotate: [t], translate: [t], scale: [t], shear: [t] }. */
  function boneKeys(json, anim, name) {
    const a = json && json.animations && json.animations[anim]
    const tl = (a && a.bones && a.bones[name]) || {}
    const out = {}
    for (const k of ['rotate', 'translate', 'scale', 'shear']) out[k] = (Array.isArray(tl[k]) ? tl[k] : []).map((x) => num(x.time, 0))
    return out
  }

  /**
   * Key a mesh deform (Spine's 网格变形 in animate mode). `offsets` are the
   * Spine 3.8 deform values: per vertex x/y for an unweighted mesh, per bone
   * influence x/y for a weighted one, all relative to the setup mesh. Stored the
   * way Spine exports them: zeros trimmed into `offset`, an all-zero key has no
   * vertices.
   */
  function keyDeform(input, anim, skin, slot, attachment, time, offsets) {
    const json = prepare(input)
    requireSkin(json, skin)
    requireSlot(json, slot)
    const a = animationOf(json, anim)
    const v = Array.from(offsets || [], (x) => Math.round(num(x, 0) * 1000) / 1000)
    let first = v.findIndex((x) => Math.abs(x) > 1e-4)
    const key = {}
    if (first >= 0) {
      let last = v.length - 1
      while (last > first && Math.abs(v[last]) <= 1e-4) last--
      if (first) key.offset = first
      key.vertices = v.slice(first, last + 1)
    }
    a.deform = a.deform || {}
    a.deform[skin] = a.deform[skin] || {}
    a.deform[skin][slot] = a.deform[skin][slot] || {}
    const list = (a.deform[skin][slot][attachment] = a.deform[skin][slot][attachment] || [])
    upsertKey(list, time, key)
    // upsertKey merged into an old key: an all-zero key must drop old vertices
    const i = list.findIndex((k) => Math.abs(num(k.time, 0) - (Math.round(num(time, 0) * 10000) / 10000)) < 1e-4)
    if (i >= 0 && first < 0) { delete list[i].vertices; delete list[i].offset }
    return { json: tidy(json) }
  }

  /**
   * Setup mode: move a mesh's vertices for good (Spine: transform mesh vertices in setup mode).
   * `offsets` use the deform layout (per vertex x/y, or per bone influence x/y for a weighted
   * mesh) and are added to the mesh's own vertices; the UVs stay, so the image follows the
   * shape. A linked mesh edits the mesh it links to. Deform keys stay offsets from this shape.
   */
  function moveMeshVertices(input, skin, slot, name, offsets) {
    const json = prepare(input)
    let map = attachmentsOf(json, skin, slot) || fail('这个皮肤里没有该插槽的附件')
    let att = map[name] || fail(`找不到附件：${name}`)
    if (att.type === 'linkedmesh') {
      const owner = att.skin || 'default'
      map = attachmentsOf(json, owner, slot) || fail('找不到链接的网格')
      att = map[att.parent] || fail(`找不到链接的网格：${att.parent}`)
    }
    if (att.type !== 'mesh' && att.type !== 'clipping') fail('只有网格和剪裁能移动顶点')
    const off = Array.from(offsets || [], (x) => num(x, 0))
    const r3 = (v) => Math.round(v * 1000) / 1000
    const v = att.vertices
    if (isWeighted(att)) {
      let f = 0
      for (let i = 0; i < v.length;) {
        const n = v[i++]
        for (let k = 0; k < n; k++, f++, i += 4) {
          if (off[f * 2]) v[i + 1] = r3(v[i + 1] + off[f * 2])
          if (off[f * 2 + 1]) v[i + 2] = r3(v[i + 2] + off[f * 2 + 1])
        }
      }
    } else {
      for (let i = 0; i < v.length; i++) if (off[i]) v[i] = r3(v[i] + off[i])
    }
    return { json: tidy(json) }
  }

  /** The mesh a mesh / linked mesh draws its shape from: { map, att, skin, name }. */
  function meshOwner(json, skin, slot, name) {
    let map = attachmentsOf(json, skin, slot) || fail('这个皮肤里没有该插槽的附件')
    let att = map[name] || fail(`找不到附件：${name}`)
    if (att.type === 'linkedmesh') {
      skin = att.skin || 'default'
      name = att.parent
      map = attachmentsOf(json, skin, slot) || fail('找不到链接的网格')
      att = map[name] || fail(`找不到链接的网格：${name}`)
    }
    return { map, att, skin, name }
  }

  /** Per vertex: how many bone influences it has (1 for an unweighted mesh). */
  function influenceCounts(att) {
    const n = att.uvs.length / 2
    if (!isWeighted(att)) return new Array(n).fill(1)
    const out = []
    let i = 0
    for (let k = 0; k < n; k++) { const c = att.vertices[i]; out.push(c); i += 1 + c * 4 }
    return out
  }

  /**
   * Spine's 编辑网格 result: new uvs / vertices / triangles / hull for a mesh (a linked mesh edits
   * the mesh it links to). `remap[i]` = the old index of new vertex i, or -1 for a new vertex:
   * deform keys keep the offsets of kept vertices and start new ones at zero.
   */
  function setMesh(input, skin, slot, name, mesh, remap) {
    const json = prepare(input)
    const o = meshOwner(json, skin, slot, name)
    if (o.att.type !== 'mesh') fail('只有网格能编辑顶点')
    const oldCounts = influenceCounts(o.att)
    o.att.uvs = Array.from(mesh.uvs)
    o.att.vertices = Array.from(mesh.vertices)
    o.att.triangles = Array.from(mesh.triangles)
    o.att.hull = mesh.hull
    // Spine's nonessential edges (hull + the user's), when the editor sends them
    if (Array.isArray(mesh.edges) && mesh.edges.length) o.att.edges = Array.from(mesh.edges)
    else delete o.att.edges
    const newCounts = influenceCounts(o.att)
    const map = remap || newCounts.map((_, i) => (i < oldCounts.length ? i : -1))
    const oldStart = []
    let acc = 0
    for (const c of oldCounts) { oldStart.push(acc); acc += c * 2 }
    const oldLen = acc
    for (const a of Object.values(json.animations)) {
      const list = a.deform && a.deform[o.skin] && a.deform[o.skin][slot] && a.deform[o.skin][slot][o.name]
      if (!Array.isArray(list)) continue
      for (const k of list) {
        const full = new Array(oldLen).fill(0)
        if (Array.isArray(k.vertices)) k.vertices.forEach((v, i) => { full[num(k.offset, 0) + i] = num(v, 0) })
        const out = []
        newCounts.forEach((c, i) => {
          const from = map[i]
          if (from >= 0 && from < oldCounts.length && oldCounts[from] === c) for (let j = 0; j < c * 2; j++) out.push(full[oldStart[from] + j])
          else for (let j = 0; j < c * 2; j++) out.push(0)
        })
        let first = out.findIndex((v) => Math.abs(v) > 1e-4)
        delete k.offset
        delete k.vertices
        if (first >= 0) {
          let last = out.length - 1
          while (last > first && Math.abs(out[last]) <= 1e-4) last--
          if (first) k.offset = first
          k.vertices = out.slice(first, last + 1)
        }
      }
    }
    return { json: tidy(json), skin: o.skin, name: o.name }
  }

  /** Spine's region → mesh: the image's rectangle as a four-vertex mesh in the same place. */
  function regionToMesh(input, skin, slot, name) {
    const json = prepare(input)
    const map = attachmentsOf(json, skin, slot) || fail('这个皮肤里没有该插槽的附件')
    const att = map[name] || fail(`找不到附件：${name}`)
    if ((att.type || 'region') !== 'region') fail('只有普通图片能转成网格')
    const w = num(att.width, 1), h = num(att.height, 1)
    const sx = num(att.scaleX, 1), sy = num(att.scaleY, 1)
    const rad = num(att.rotation, 0) * Math.PI / 180
    const cs = Math.cos(rad), sn = Math.sin(rad)
    const corners = [[0, 0], [w, 0], [w, h], [0, h]]
    const vertices = []
    for (const [pu, pv] of corners) {
      const lx = (pu - w / 2) * sx, ly = (h / 2 - pv) * sy
      vertices.push(round((num(att.x, 0) + lx * cs - ly * sn) * 1000) / 1000, round((num(att.y, 0) + lx * sn + ly * cs) * 1000) / 1000)
    }
    const mesh = { type: 'mesh', path: att.path || name, uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3], vertices, hull: 4, width: w, height: h }
    if (att.color) mesh.color = att.color
    map[name] = mesh
    return { json: tidy(json) }
  }

  /** Key which attachment a slot shows at `time` (`name` null = hide). */
  function keyAttachment(input, anim, slot, time, name) {
    const json = prepare(input)
    requireSlot(json, slot)
    const a = animationOf(json, anim)
    a.slots = a.slots || {}
    a.slots[slot] = a.slots[slot] || {}
    a.slots[slot].attachment = a.slots[slot].attachment || []
    upsertKey(a.slots[slot].attachment, time, { name: name || null })
    return { json: tidy(json) }
  }

  function keyColor(input, anim, slot, time, color) {
    const json = prepare(input)
    requireSlot(json, slot)
    const c = String(color || '').replace('#', '')
    if (!HEX.test(c)) fail('颜色格式应为 RRGGBBAA')
    const a = animationOf(json, anim)
    a.slots = a.slots || {}
    a.slots[slot] = a.slots[slot] || {}
    a.slots[slot].color = a.slots[slot].color || []
    upsertKey(a.slots[slot].color, time, { color: c.toLowerCase() })
    return { json: tidy(json) }
  }

  /** Remove one key; `path` = ['slots', slot, 'attachment'] / ['ik', name] / … */
  function removeKeyAt(input, anim, path, time) {
    const json = prepare(input)
    const a = animationOf(json, anim)
    let node = a
    for (const p of path.slice(0, -1)) { node = node && node[p] }
    const leaf = path[path.length - 1]
    const list = node && node[leaf]
    if (!Array.isArray(list) || !removeKey(list, time)) fail('这个时间没有关键帧')
    if (!list.length) delete node[leaf]
    return { json: tidy(json) }
  }

  function slotKeys(json, anim, slot) {
    const a = json.animations && json.animations[anim]
    const s = a && a.slots && a.slots[slot]
    return {
      attachment: (s && Array.isArray(s.attachment) ? s.attachment : []).map((k) => ({ time: num(k.time, 0), name: k.name == null ? null : k.name })),
      color: (s && Array.isArray(s.color) ? s.color : []).map((k) => ({ time: num(k.time, 0), color: k.color })),
    }
  }

  // ---------------------------------------------------------------- dopesheet (key editing)
  //
  // A key track is addressed by a path into the animation:
  //   ['bones', bone, 'rotate'|'translate'|'scale'|'shear'], ['slots', slot, 'attachment'|'color'],
  //   ['ik', name], ['transform', name], ['deform', skin, slot, attachment], ['drawOrder'].
  // A key is { path, time }; times are seconds.

  const sameTime = (a, b) => Math.abs(num(a, 0) - num(b, 0)) < 1e-4
  const keyTime = (t) => Math.max(0, Math.round(num(t, 0) * 10000) / 10000)

  function trackList(a, path) {
    if (path[0] === 'events') {
      const l = (Array.isArray(a.events) ? a.events : []).filter((k) => k.name === path[1])
      return l.length ? l : null
    }
    let node = a
    for (const p of path.slice(0, -1)) { node = node && node[p] }
    const v = node && node[path[path.length - 1]]
    return Array.isArray(v) ? v : null
  }

  function setTrack(a, path, list) {
    if (path[0] === 'events') {
      for (const k of list) k.name = path[1]
      const all = [...(Array.isArray(a.events) ? a.events : []).filter((k) => k.name !== path[1]), ...list].sort((x, y) => num(x.time, 0) - num(y.time, 0))
      if (all.length) a.events = all
      else delete a.events
      return
    }
    let node = a
    for (const p of path.slice(0, -1)) { node[p] = node[p] || {}; node = node[p] }
    const leaf = path[path.length - 1]
    if (list.length) node[leaf] = list
    else {
      delete node[leaf]
      // drop the containers the track left empty
      for (let i = path.length - 1; i > 0; i--) {
        let parent = a
        for (const p of path.slice(0, i - 1)) parent = parent[p]
        const key = path[i - 1]
        if (parent[key] && typeof parent[key] === 'object' && !Array.isArray(parent[key]) && !Object.keys(parent[key]).length) delete parent[key]
        else break
      }
    }
  }

  /** Every key track of an animation: [{ path, times }]. */
  function keyTracks(json, anim) {
    const a = json && json.animations && json.animations[anim]
    if (!a) return []
    const out = []
    const push = (path, list) => { if (Array.isArray(list) && list.length) out.push({ path, times: list.map((k) => num(k.time, 0)) }) }
    for (const [bone, tl] of Object.entries(a.bones || {})) for (const k of ['rotate', 'translate', 'scale', 'shear']) push(['bones', bone, k], tl[k])
    for (const [slot, tl] of Object.entries(a.slots || {})) for (const k of ['attachment', 'color', 'twoColor']) push(['slots', slot, k], tl[k])
    for (const kind of ['ik', 'transform', 'path']) for (const [name, list] of Object.entries(a[kind] || {})) {
      if (Array.isArray(list)) push([kind, name], list)
      else for (const [k, l] of Object.entries(list || {})) push([kind, name, k], l)
    }
    for (const [skin, slots] of Object.entries(a.deform || {})) for (const [slot, atts] of Object.entries(slots || {})) for (const [att, list] of Object.entries(atts || {})) push(['deform', skin, slot, att], list)
    push(['drawOrder'], a.drawOrder)
    if (Array.isArray(a.events)) for (const n of new Set(a.events.map((k) => k.name))) push(['events', n], a.events.filter((k) => k.name === n))
    return out
  }

  function groupKeys(keys) {
    const by = new Map()
    for (const k of keys || []) {
      const id = JSON.stringify(k.path)
      if (!by.has(id)) by.set(id, { path: k.path, times: [] })
      by.get(id).times.push(num(k.time, 0))
    }
    return [...by.values()]
  }

  /** The animation's loop length: its last key over every track (Spine: frame 0 to the highest keyed frame). */
  function animationEnd(a) {
    let end = 0
    const scan = (list) => { if (Array.isArray(list)) for (const k of list) end = Math.max(end, num(k.time, 0)) }
    for (const tl of Object.values(a.bones || {})) for (const l of Object.values(tl)) scan(l)
    for (const tl of Object.values(a.slots || {})) for (const l of Object.values(tl)) scan(l)
    for (const kind of ['ik', 'transform', 'path']) for (const v of Object.values(a[kind] || {})) { if (Array.isArray(v)) scan(v); else for (const l of Object.values(v || {})) scan(l) }
    for (const sk of Object.values(a.deform || {})) for (const sl of Object.values(sk || {})) for (const l of Object.values(sl || {})) scan(l)
    scan(a.drawOrder)
    scan(a.events)
    return end
  }

  const NUMERIC_KEY_FIELDS = ['angle', 'x', 'y', 'mix', 'softness', 'rotateMix', 'translateMix', 'scaleMix', 'shearMix', 'position', 'spacing']

  /** A key's value between two keys (linear; colours per channel, vertices per entry, others held). */
  function lerpKey(k0, k1, f) {
    const out = {}
    for (const [key, v] of Object.entries(k0)) {
      if (key === 'time' || key === 'curve' || key === 'c2' || key === 'c3' || key === 'c4') continue
      const w = k1[key]
      if (NUMERIC_KEY_FIELDS.includes(key) && typeof v === 'number') out[key] = Math.round((v + (num(w, v) - v) * f) * 1000) / 1000
      else if ((key === 'color' || key === 'light' || key === 'dark') && typeof v === 'string' && typeof w === 'string' && v.length === w.length) {
        let hex = ''
        for (let i = 0; i < v.length; i += 2) {
          const a0 = parseInt(v.slice(i, i + 2), 16), a1 = parseInt(w.slice(i, i + 2), 16)
          hex += Math.round(a0 + (a1 - a0) * f).toString(16).padStart(2, '0')
        }
        out[key] = hex
      } else out[key] = clone(v)
    }
    if (Array.isArray(k0.vertices) || Array.isArray(k1.vertices)) {
      const full = (k) => { const arr = []; const o = num(k.offset, 0); (k.vertices || []).forEach((x, i) => { arr[o + i] = x }); return arr }
      const a0 = full(k0), a1 = full(k1)
      const n = Math.max(a0.length, a1.length)
      const vs = []
      for (let i = 0; i < n; i++) vs.push(Math.round((num(a0[i], 0) + (num(a1[i], 0) - num(a0[i], 0)) * f) * 1000) / 1000)
      delete out.offset
      if (vs.some((x) => Math.abs(x) > 1e-4)) out.vertices = vs
      else delete out.vertices
    }
    return out
  }

  /**
   * Move keys by `dt` seconds (Spine: drag keys in the dopesheet). A moved key
   * that lands on a key that stayed replaces it. Options:
   *   shift  — Spine's 移位: the keys after the moved ones move with them;
   *   offset — Spine's 偏移 for loops: keys wrap inside 0..end, and the track gets
   *            keys at 0 and at the end with the value at the seam.
   */
  function moveKeys(input, anim, keys, dt, opts) {
    const o = opts || {}
    const json = prepare(input)
    const a = animationOf(json, anim)
    const end = animationEnd(a)
    const moved = []
    for (const g of groupKeys(keys)) {
      const list = trackList(a, g.path)
      if (!list) continue
      const last = Math.max(...g.times)
      let going = list.filter((k) => g.times.some((t) => sameTime(k.time, t)) || (o.shift && num(k.time, 0) > last + 1e-4))
      if (o.offset && end > 0) {
        // a loop: the key at the end is the key at 0 again, so it is dropped and rebuilt
        const hasStart = list.some((k) => sameTime(k.time, 0))
        let ring = list.filter((k) => !(hasStart && sameTime(k.time, end)))
        going = going.filter((k) => ring.includes(k))
        for (const k of going) {
          let t = (num(k.time, 0) + dt) % end
          if (t < 0) t += end
          if (end - t < 1e-4) t = 0
          k.time = keyTime(t)
          moved.push({ path: g.path, time: k.time })
        }
        ring = [...ring.filter((k) => !going.includes(k) && !going.some((m) => sameTime(m.time, k.time))), ...going]
          .sort((x, y) => num(x.time, 0) - num(y.time, 0))
        if (ring.length) {
          // the value at the seam: the key at 0, or between the last key and the first one round the loop
          let seam = ring.find((k) => sameTime(k.time, 0))
          if (!seam) {
            const lastK = ring[ring.length - 1], firstK = ring[0]
            const span = end - num(lastK.time, 0) + num(firstK.time, 0)
            seam = lerpKey(lastK, firstK, span > 1e-6 ? (end - num(lastK.time, 0)) / span : 0)
            ring.unshift({ ...seam })
          }
          const atEnd = { ...clone(seam), time: keyTime(end) }
          for (const ck of ['curve', 'c2', 'c3', 'c4']) delete atEnd[ck]
          ring.push(atEnd)
          for (const k of ring) if (sameTime(k.time, 0)) delete k.time
        }
        setTrack(a, g.path, ring)
        continue
      }
      for (const k of going) {
        const t = keyTime(num(k.time, 0) + dt)
        if (t) k.time = t
        else delete k.time
        moved.push({ path: g.path, time: t })
      }
      const staying = list.filter((k) => !going.includes(k) && !going.some((m) => sameTime(m.time, k.time)))
      setTrack(a, g.path, [...staying, ...going].sort((x, y) => num(x.time, 0) - num(y.time, 0)))
    }
    return { json: tidy(json), keys: moved }
  }

  /**
   * Spine's scale keys: the picked keys stretched about `pivot` (seconds) by `factor`, each
   * landing on a frame (`opts.snap`, seconds) - the dopesheet's drag on an end of the selection.
   * Picked keys that land on one frame merge (the later wins); unpicked keys there give way.
   */
  function scaleKeys(input, anim, keys, pivot, factor, opts) {
    const o = opts || {}, snap = o.snap > 0 ? o.snap : 0
    const json = prepare(input)
    const a = animationOf(json, anim)
    const moved = []
    for (const g of groupKeys(keys)) {
      const list = trackList(a, g.path)
      if (!list) continue
      const going = list.filter((k) => g.times.some((t) => sameTime(k.time, t)))
      const placed = new Map()
      for (const k of going) {
        let t = pivot + (num(k.time, 0) - pivot) * factor
        if (snap) t = Math.round(t / snap) * snap
        t = keyTime(t)
        const nk = { ...k }
        if (t) nk.time = t; else delete nk.time
        placed.set(t.toFixed(4), nk)
      }
      const out = [...placed.values()]
      const staying = list.filter((k) => !going.includes(k) && !out.some((m) => sameTime(m.time, k.time)))
      setTrack(a, g.path, [...staying, ...out].sort((x, y) => num(x.time, 0) - num(y.time, 0)))
      for (const k of out) moved.push({ path: g.path, time: num(k.time, 0) })
    }
    return { json: tidy(json), keys: moved }
  }

  /**
   * Spine's 调整: change every selected key of a bone by the same amount instead of keying
   * the frame. `deltas` = { boneName: { rotation, x, y, scaleX, scaleY, shearX, shearY } }
   * in local terms (scale as a difference of local scale).
   */
  function adjustKeys(input, anim, keys, deltas) {
    const json = prepare(input)
    const a = animationOf(json, anim)
    let n = 0
    for (const g of groupKeys(keys)) {
      if (g.path[0] !== 'bones') continue
      const d = deltas[g.path[1]]
      if (!d) continue
      const bone = findBone(json, g.path[1])
      const list = trackList(a, g.path)
      if (!list || !bone) continue
      const kind = g.path[2]
      for (const k of list) {
        if (!g.times.some((t) => sameTime(k.time, t))) continue
        const r3 = (v) => Math.round(v * 1000) / 1000
        if (kind === 'rotate' && d.rotation) { k.angle = r3(num(k.angle, 0) + d.rotation); n++ }
        if (kind === 'translate' && (d.x || d.y)) { k.x = r3(num(k.x, 0) + num(d.x, 0)); k.y = r3(num(k.y, 0) + num(d.y, 0)); n++ }
        if (kind === 'scale' && (d.scaleX || d.scaleY)) {
          const sx0 = num(bone.scaleX, 1) || 1, sy0 = num(bone.scaleY, 1) || 1
          k.x = r3(num(k.x, 1) + num(d.scaleX, 0) / sx0); k.y = r3(num(k.y, 1) + num(d.scaleY, 0) / sy0); n++
        }
        if (kind === 'shear' && (d.shearX || d.shearY)) { k.x = r3(num(k.x, 0) + num(d.shearX, 0)); k.y = r3(num(k.y, 0) + num(d.shearY, 0)); n++ }
      }
    }
    return { json: tidy(json), adjusted: n }
  }

  function deleteKeys(input, anim, keys) {
    const json = prepare(input)
    const a = animationOf(json, anim)
    let n = 0
    for (const g of groupKeys(keys)) {
      const list = trackList(a, g.path)
      if (!list) continue
      const kept = list.filter((k) => !g.times.some((t) => sameTime(k.time, t)))
      n += list.length - kept.length
      setTrack(a, g.path, kept)
    }
    return { json: tidy(json), deleted: n }
  }

  /** Copy keys: values relative to the earliest copied key (Spine: Ctrl+C in the dopesheet). */
  function copyKeys(json, anim, keys) {
    const a = json && json.animations && json.animations[anim]
    if (!a) return []
    const clip = []
    for (const g of groupKeys(keys)) {
      const list = trackList(a, g.path) || []
      for (const k of list) if (g.times.some((t) => sameTime(k.time, t))) clip.push({ path: g.path, time: num(k.time, 0), key: clone(k) })
    }
    const t0 = Math.min(...clip.map((c) => c.time))
    return clip.map((c) => { const key = c.key; delete key.time; return { path: c.path, offset: c.time - t0, key } })
  }

  /** Paste a clip at `time` (Spine: Ctrl+V pastes at the timeline position); same tracks. */
  function pasteKeys(input, anim, clip, time) {
    const json = prepare(input)
    const a = animationOf(json, anim)
    const out = []
    for (const c of clip || []) {
      const list = trackList(a, c.path) || []
      const t = keyTime(num(time, 0) + num(c.offset, 0))
      const key = clone(c.key)
      upsertKey(list, t, key)
      // upsertKey keeps an old curve; a pasted key brings its own
      const i = list.findIndex((k) => sameTime(k.time, t))
      if (i >= 0) {
        for (const ck of ['curve', 'c2', 'c3', 'c4']) delete list[i][ck]
        for (const ck of ['curve', 'c2', 'c3', 'c4']) if (key[ck] !== undefined) list[i][ck] = key[ck]
      }
      setTrack(a, c.path, list)
      out.push({ path: c.path, time: t })
    }
    return { json: tidy(json), keys: out }
  }

  /** Interpolation from a key to the next: 'linear', 'stepped' or 'ease' (Spine's bezier presets). */
  function setKeyCurve(input, anim, keys, kind) {
    const json = prepare(input)
    const a = animationOf(json, anim)
    for (const g of groupKeys(keys)) {
      if (g.path[0] === 'events') continue // events fire, they have no curve
      const list = trackList(a, g.path)
      if (!list) continue
      for (const k of list) {
        if (!g.times.some((t) => sameTime(k.time, t))) continue
        for (const ck of ['curve', 'c2', 'c3', 'c4']) delete k[ck]
        if (kind === 'stepped') k.curve = 'stepped'
        else if (kind === 'ease') { k.curve = 0.25; k.c2 = 0; k.c3 = 0.75; k.c4 = 1 }
      }
    }
    return { json: tidy(json) }
  }

  /**
   * Spine 3.8 key curve: a bezier from the key to the next one in normalised
   * space, handles (cx1, cy1) and (cx2, cy2); stored as curve / c2 / c3 / c4.
   */
  function setKeyBezier(input, anim, keys, c) {
    const json = prepare(input)
    const a = animationOf(json, anim)
    const r4 = (v) => Math.round(v * 10000) / 10000
    const [c1, c2, c3, c4] = [Math.min(1, Math.max(0, num(c[0], 0))), num(c[1], 0), Math.min(1, Math.max(0, num(c[2], 1))), num(c[3], 1)]
    const linear = Math.abs(c1) < 1e-4 && Math.abs(c2) < 1e-4 && Math.abs(c3 - 1) < 1e-4 && Math.abs(c4 - 1) < 1e-4
    for (const g of groupKeys(keys)) {
      if (g.path[0] === 'events') continue // events fire, they have no curve
      const list = trackList(a, g.path)
      if (!list) continue
      for (const k of list) {
        if (!g.times.some((t) => sameTime(k.time, t))) continue
        for (const ck of ['curve', 'c2', 'c3', 'c4']) delete k[ck]
        if (!linear) { k.curve = r4(c1); k.c2 = r4(c2); k.c3 = r4(c3); k.c4 = r4(c4) }
      }
    }
    return { json: tidy(json) }
  }

  /** { kind: 'linear' | 'stepped' | 'bezier', c: [cx1, cy1, cx2, cy2] } of a key. */
  function keyBezier(json, anim, key) {
    const a = json && json.animations && json.animations[anim]
    const list = a && trackList(a, key.path)
    const k = list && list.find((x) => sameTime(x.time, key.time))
    if (!k || k.curve === undefined) return { kind: 'linear', c: [0, 0, 1, 1] }
    if (k.curve === 'stepped') return { kind: 'stepped', c: [0, 0, 1, 1] }
    return { kind: 'bezier', c: [num(k.curve, 0), num(k.c2, 0), num(k.c3, 1), num(k.c4, 1)] }
  }

  /** The time of the key after `key` on its track (the curve runs from one to the other), or null. */
  function nextKeyTime(json, anim, key) {
    const a = json && json.animations && json.animations[anim]
    const list = a && trackList(a, key.path)
    if (!list) return null
    const later = list.map((k) => num(k.time, 0)).filter((t) => t > num(key.time, 0) + 1e-4).sort((x, y) => x - y)
    return later.length ? later[0] : null
  }

  function keyCurve(json, anim, key) {
    const a = json && json.animations && json.animations[anim]
    const list = a && trackList(a, key.path)
    const k = list && list.find((x) => sameTime(x.time, key.time))
    if (!k || k.curve === undefined) return 'linear'
    return k.curve === 'stepped' ? 'stepped' : 'ease'
  }

  // ---------------------------------------------------------------- skins

  function createSkin(input, name, opts) {
    const json = prepare(input)
    const n = String(name || '').trim() || fail('皮肤名称不能为空')
    if (findSkin(json, n)) fail(`皮肤已存在：${n}`)
    const o = opts || {}
    const skin = { name: n, attachments: {} }
    if (o.copyFrom) {
      const src = requireSkin(json, o.copyFrom)
      skin.attachments = clone(src.attachments)
      for (const k of ['bones', ...CONSTRAINT_KINDS]) if (Array.isArray(src[k])) skin[k] = src[k].slice()
      // linked meshes that pointed into the source skin now point into the copy
      for (const slot of Object.keys(skin.attachments)) {
        for (const att of Object.values(skin.attachments[slot])) {
          if (att && att.type === 'linkedmesh' && att.skin === o.copyFrom) att.skin = n
        }
      }
      for (const anim of Object.values(json.animations)) {
        if (anim.deform && anim.deform[o.copyFrom]) anim.deform[n] = clone(anim.deform[o.copyFrom])
      }
    }
    json.skins.push(skin)
    return { json: tidy(json), skin: n }
  }

  function renameSkin(input, name, next) {
    const json = prepare(input)
    const to = String(next || '').trim() || fail('名称不能为空')
    if (name === 'default') fail('default 皮肤不能改名')
    const skin = requireSkin(json, name)
    if (to === name) return { json: tidy(json) }
    if (findSkin(json, to)) fail(`皮肤已存在：${to}`)
    skin.name = to
    forEachAttachment(json, (att) => { if (att && att.type === 'linkedmesh' && att.skin === name) att.skin = to })
    for (const anim of Object.values(json.animations)) {
      if (anim.deform && anim.deform[name]) { anim.deform[to] = anim.deform[name]; delete anim.deform[name] }
    }
    return { json: tidy(json), skin: to }
  }

  function deleteSkin(input, name) {
    const json = prepare(input)
    if (name === 'default') fail('default 皮肤不能删除')
    requireSkin(json, name)
    let linked = null
    forEachAttachment(json, (att, at) => {
      if (at.skin.name !== name && att && att.type === 'linkedmesh' && att.skin === name) linked = at
    })
    if (linked) fail(`皮肤「${linked.skin.name}」的「${linked.name}」链接着这个皮肤`)
    json.skins = json.skins.filter((s) => s.name !== name)
    for (const anim of Object.values(json.animations)) if (anim.deform) delete anim.deform[name]
    return { json: tidy(json) }
  }

  /** Copy one slot's attachment into another skin (same slot, same key). */
  function copyAttachmentToSkin(input, fromSkin, slot, name, toSkin) {
    const json = prepare(input)
    const src = requireSkin(json, fromSkin)
    const dst = requireSkin(json, toSkin)
    if (fromSkin === toSkin) fail('同一个皮肤')
    const att = src.attachments[slot] && src.attachments[slot][name]
    if (!att) fail(`找不到附件：${name}`)
    let copy
    if (att.type === 'mesh') {
      // Spine's way: a linked mesh shares the shape, weights and deform keys of
      // the original and may draw another image
      copy = { type: 'linkedmesh', parent: name, path: att.path || name }
      if (fromSkin !== 'default') copy.skin = fromSkin
      for (const k of ['width', 'height', 'color']) if (att[k] !== undefined) copy[k] = att[k]
    } else {
      copy = clone(att)
      if (copy.type === 'linkedmesh' && !copy.skin && fromSkin !== 'default') copy.skin = fromSkin
    }
    dst.attachments[slot] = dst.attachments[slot] || {}
    dst.attachments[slot][name] = copy
    return { json: tidy(json) }
  }

  /**
   * Spine's attachment 复制, in the same slot and skin, named like Spine (`arm` -> `arm2`).
   * A mesh copies two ways: an independent mesh with its own vertices (opts.animation also
   * copies its deform keys), or with opts.linked a linked mesh that uses the original's
   * vertices and deform keys and may draw another image. A linked copy of a linked mesh
   * links to the same source mesh.
   */
  function duplicateAttachment(input, skin, slot, name, opts) {
    const o = opts || {}
    const json = prepare(input)
    const map = attachmentsOf(json, skin, slot) || fail('这个皮肤里没有该插槽的附件')
    const att = map[name] || fail(`找不到附件：${name}`)
    const type = att.type || 'region'
    const taken = new Set()
    for (const sk of json.skins) for (const k of Object.keys(sk.attachments[slot] || {})) taken.add(k)
    const next = uniqueName(taken, name)
    let copy
    if (o.linked) {
      if (type !== 'mesh' && type !== 'linkedmesh') fail('只有网格能做链接网格')
      const parent = type === 'linkedmesh' ? att.parent : name
      const parentSkin = type === 'linkedmesh' ? att.skin || 'default' : skin
      copy = { type: 'linkedmesh', parent, path: att.path || name }
      if (parentSkin !== 'default') copy.skin = parentSkin
      for (const k of ['width', 'height', 'color']) if (att[k] !== undefined) copy[k] = att[k]
    } else {
      copy = clone(att)
      // the copy keeps drawing the same image under its new name
      if (type !== 'boundingbox' && type !== 'path' && type !== 'point' && type !== 'clipping' && !copy.path) copy.path = name
    }
    map[next] = copy
    let keys = 0
    if (!o.linked && o.animation && type === 'mesh') {
      for (const a of Object.values(json.animations || {})) {
        const d = a.deform && a.deform[skin] && a.deform[skin][slot]
        if (d && Array.isArray(d[name]) && d[name].length) { d[next] = clone(d[name]); keys += d[name].length }
      }
    }
    return { json: tidy(json), attachment: next, keys }
  }

  /** Whether a mesh has deform keys in any animation (its 复制 asks about them, like Spine). */
  function hasDeformKeys(json, skin, slot, name) {
    for (const a of Object.values(json.animations || {})) {
      const d = a.deform && a.deform[skin] && a.deform[skin][slot]
      if (d && Array.isArray(d[name]) && d[name].length) return true
    }
    return false
  }

  // ---------------------------------------------------------------- events (Spine 3.8)
  //
  // The skeleton lists its events with their values ("events": { name: { int, float, string,
  // audio, volume, balance } }, defaults left out); an animation keys them in "events":
  // [{ time, name }] (a key may carry its own values; ours use the event's).

  const EVENT_DEFAULTS = { int: 0, float: 0, string: '', audio: '', volume: 1, balance: 0 }

  function createEvent(input, name) {
    const json = prepare(input)
    json.events = json.events && typeof json.events === 'object' ? json.events : {}
    const n = uniqueName(new Set(Object.keys(json.events)), String(name || '').trim() || 'event', true)
    json.events[n] = {}
    return { json: tidy(json), event: n }
  }

  function setEventProps(input, name, props) {
    const json = prepare(input)
    const e = (json.events || {})[name] || fail(`找不到事件：${name}`)
    for (const k of Object.keys(EVENT_DEFAULTS)) {
      if (props[k] === undefined) continue
      let v = props[k]
      if (k === 'int') v = Math.round(num(v, 0))
      else if (k === 'string' || k === 'audio') v = String(v == null ? '' : v)
      else { v = num(v, NaN); if (!Number.isFinite(v)) fail(`${k} 不是数字`) }
      if (v === EVENT_DEFAULTS[k]) delete e[k]
      else e[k] = v
    }
    if (!e.audio) { delete e.volume; delete e.balance }
    return { json: tidy(json) }
  }

  function renameEvent(input, name, next) {
    const json = prepare(input)
    const to = String(next || '').trim() || fail('名称不能为空')
    const events = json.events || {}
    if (!events[name]) fail(`找不到事件：${name}`)
    if (to === name) return { json: tidy(json), event: name }
    if (events[to]) fail(`已有事件：${to}`)
    json.events = Object.fromEntries(Object.entries(events).map(([k, v]) => [k === name ? to : k, v]))
    for (const a of Object.values(json.animations)) for (const k of Array.isArray(a.events) ? a.events : []) if (k.name === name) k.name = to
    return { json: tidy(json), event: to }
  }

  /** Delete an event and its keys in every animation. */
  function deleteEvent(input, name) {
    const json = prepare(input)
    if (!(json.events || {})[name]) fail(`找不到事件：${name}`)
    delete json.events[name]
    let keys = 0
    for (const a of Object.values(json.animations)) {
      if (!Array.isArray(a.events)) continue
      const kept = a.events.filter((k) => k.name !== name)
      keys += a.events.length - kept.length
      if (kept.length) a.events = kept
      else delete a.events
    }
    return { json: tidy(json), keys }
  }

  /** Spine's event key: the event fires at `time` with its values. */
  function keyEvent(input, anim, name, time) {
    const json = prepare(input)
    if (!(json.events || {})[name]) fail(`找不到事件：${name}`)
    const a = animationOf(json, anim)
    const t = keyTime(time)
    const list = Array.isArray(a.events) ? a.events : []
    if (!list.some((k) => k.name === name && sameTime(k.time, t))) {
      list.push(t ? { time: t, name } : { name })
      list.sort((x, y) => num(x.time, 0) - num(y.time, 0))
    }
    a.events = list
    return { json: tidy(json) }
  }

  /** Bones / constraints that only exist while a skin is active (Spine 3.8 "skin required"). */
  function setSkinMembership(input, skinName, kind, name, on) {
    const json = prepare(input)
    const skin = requireSkin(json, skinName)
    if (kind === 'bones') requireBone(json, name)
    else if (!findConstraint(json, kind, name)) fail(`找不到约束：${name}`)
    const list = Array.isArray(skin[kind]) ? skin[kind] : []
    const has = list.includes(name)
    if (on && !has) list.push(name)
    if (!on && has) list.splice(list.indexOf(name), 1)
    skin[kind] = list
    const used = json.skins.some((s) => Array.isArray(s[kind]) && s[kind].includes(name))
    const item = kind === 'bones' ? findBone(json, name) : findConstraint(json, kind, name)
    if (used) item.skin = true
    else delete item.skin
    return { json: tidy(json) }
  }

  // ---------------------------------------------------------------- constraints

  function checkTargetCycle(json, bones, target) {
    for (const b of bones) {
      if (b === target) fail('目标骨骼不能是被约束的骨骼')
      if (isDescendant(json, target, b)) fail(`目标「${target}」是「${b}」的子骨骼，会循环`)
    }
  }

  /**
   * IK with one bone, or two where the second is a child of the first.
   * `target` may be omitted together with `targetAt` ({x,y} in the parent's
   * local space of the new target, usually root) to create a target bone.
   */
  function createIk(input, opts) {
    const json = prepare(input)
    const o = opts || {}
    const bones = (o.bones || []).map((b) => requireBone(json, b).name)
    if (bones.length < 1 || bones.length > 2) fail('IK 需要 1 或 2 根骨骼')
    if (bones.length === 2 && findBone(json, bones[1]).parent !== bones[0]) fail('第二根骨骼必须是第一根的子骨骼')
    const takenC = constraintNames(json)
    const name = o.name ? String(o.name).trim() : uniqueName(takenC, `${bones[bones.length - 1]}_ik`, true)
    if (takenC.has(name)) fail(`约束名已存在：${name}`)
    let target = o.target
    let createdTarget = null
    if (!target) {
      const parent = o.targetParent || json.bones[0].name
      requireBone(json, parent)
      target = uniqueName(new Set(json.bones.map((b) => b.name)), `${bones[bones.length - 1]}_target`, true)
      const at = o.targetAt || { x: 0, y: 0 }
      const tb = { name: target, parent }
      if (round(num(at.x, 0))) tb.x = round(num(at.x, 0))
      if (round(num(at.y, 0))) tb.y = round(num(at.y, 0))
      json.bones.push(tb)
      createdTarget = target
    }
    requireBone(json, target)
    checkTargetCycle(json, bones, target)
    const c = { name, order: nextOrder(json), bones, target }
    if (num(o.mix, 1) !== 1) c.mix = num(o.mix, 1)
    if (num(o.softness, 0)) c.softness = num(o.softness, 0)
    if (o.bendPositive === false) c.bendPositive = false
    if (o.compress) c.compress = true
    if (o.stretch) c.stretch = true
    if (o.uniform) c.uniform = true
    json.ik.push(c)
    return { json: tidy(json), constraint: name, target, createdTarget }
  }

  const TRANSFORM_DEFAULTS = {
    rotation: 0, x: 0, y: 0, scaleX: 0, scaleY: 0, shearY: 0,
    rotateMix: 1, translateMix: 1, scaleMix: 1, shearMix: 1, local: false, relative: false,
  }

  function createTransform(input, opts) {
    const json = prepare(input)
    const o = opts || {}
    const bones = [...new Set((o.bones || []).map((b) => requireBone(json, b).name))]
    if (!bones.length) fail('至少选一根被约束的骨骼')
    const target = requireBone(json, o.target || fail('需要目标骨骼')).name
    checkTargetCycle(json, bones, target)
    const takenC = constraintNames(json)
    const name = o.name ? String(o.name).trim() : uniqueName(takenC, `${bones[0]}_transform`, true)
    if (takenC.has(name)) fail(`约束名已存在：${name}`)
    const c = { name, order: nextOrder(json), bones, target }
    for (const [k, d] of Object.entries(TRANSFORM_DEFAULTS)) {
      if (o[k] === undefined) continue
      const v = typeof d === 'boolean' ? !!o[k] : num(o[k], d)
      if (v !== d) c[k] = v
    }
    json.transform.push(c)
    return { json: tidy(json), constraint: name }
  }

  /**
   * Offsets that keep `bone` where it is when a world (non-local, absolute)
   * transform constraint to `target` is switched on — Spine 3.8
   * applyAbsoluteWorld solved for the offsets. Both are setup world matrices.
   */
  function transformOffsets(bone, target) {
    const deg = 180 / Math.PI
    const norm = (v) => ((v % 360) + 540) % 360 - 180
    const [x, y] = toLocal(target, bone.worldX, bone.worldY)
    const rot = norm((Math.atan2(bone.c, bone.a) - Math.atan2(target.c, target.a)) * deg)
    const shear = norm(((Math.atan2(bone.d, bone.b) - Math.atan2(bone.c, bone.a))
      - (Math.atan2(target.d, target.b) - Math.atan2(target.c, target.a))) * deg)
    const r3 = (v) => Math.round(v * 1000) / 1000
    return {
      rotation: r3(rot),
      x: round(x),
      y: round(y),
      scaleX: r3(Math.hypot(bone.a, bone.c) - Math.hypot(target.a, target.c)),
      scaleY: r3(Math.hypot(bone.b, bone.d) - Math.hypot(target.b, target.d)),
      shearY: r3(shear),
    }
  }

  const IK_PROPS = { mix: 1, softness: 0, bendPositive: true, compress: false, stretch: false, uniform: false }

  function setConstraintProps(input, kind, name, props) {
    const json = prepare(input)
    if (kind !== 'ik' && kind !== 'transform') fail('只支持 IK 和变换约束')
    const c = findConstraint(json, kind, name) || fail(`找不到约束：${name}`)
    const defs = kind === 'ik' ? IK_PROPS : TRANSFORM_DEFAULTS
    for (const [k, d] of Object.entries(defs)) {
      if (props[k] === undefined) continue
      const v = typeof d === 'boolean' ? !!props[k] : num(props[k], NaN)
      if (typeof d !== 'boolean' && !Number.isFinite(v)) fail(`${k} 不是数字`)
      if (v === d) delete c[k]
      else c[k] = v
    }
    if (props.target !== undefined && props.target !== c.target) {
      requireBone(json, props.target)
      checkTargetCycle(json, c.bones, props.target)
      c.target = props.target
    }
    if (props.bones !== undefined) {
      const bones = [...new Set(props.bones.map((b) => requireBone(json, b).name))]
      if (!bones.length) fail('至少选一根被约束的骨骼')
      if (kind === 'ik') {
        if (bones.length > 2) fail('IK 需要 1 或 2 根骨骼')
        if (bones.length === 2 && findBone(json, bones[1]).parent !== bones[0]) fail('第二根骨骼必须是第一根的子骨骼')
      }
      checkTargetCycle(json, bones, c.target)
      c.bones = bones
    }
    if (props.order !== undefined) {
      // move to a position in the shared constraint order, renumbering the rest
      const all = []
      for (const k of CONSTRAINT_KINDS) for (const x of json[k]) all.push(x)
      all.sort((a, b) => num(a.order, 0) - num(b.order, 0))
      all.splice(all.indexOf(c), 1)
      all.splice(Math.max(0, Math.min(all.length, Math.round(num(props.order, 0)))), 0, c)
      all.forEach((x, i) => { x.order = i })
    }
    return { json: tidy(json) }
  }

  function renameConstraint(input, kind, name, next) {
    const json = prepare(input)
    const to = String(next || '').trim() || fail('名称不能为空')
    const c = findConstraint(json, kind, name) || fail(`找不到约束：${name}`)
    if (to === name) return { json: tidy(json) }
    if (constraintNames(json).has(to)) fail(`约束名已存在：${to}`)
    c.name = to
    for (const skin of json.skins) if (Array.isArray(skin[kind])) skin[kind] = skin[kind].map((x) => (x === name ? to : x))
    for (const anim of Object.values(json.animations)) {
      if (anim[kind] && anim[kind][name]) { anim[kind][to] = anim[kind][name]; delete anim[kind][name] }
    }
    return { json: tidy(json), constraint: to }
  }

  function deleteConstraint(input, kind, name) {
    const json = prepare(input)
    if (!findConstraint(json, kind, name)) fail(`找不到约束：${name}`)
    json[kind] = json[kind].filter((c) => c.name !== name)
    for (const skin of json.skins) if (Array.isArray(skin[kind])) skin[kind] = skin[kind].filter((x) => x !== name)
    for (const anim of Object.values(json.animations)) if (anim[kind]) delete anim[kind][name]
    return { json: tidy(json) }
  }

  /**
   * One-click solve order. A constraint must run after every constraint that
   * moves (directly or through a parent) its target or an ancestor of the bones
   * it drives: e.g. a transform that carries an IK target runs before that IK, an
   * IK on the shoulder before the IK on the forearm. Two constraints driving the
   * same bone keep their current relative order (the later one wins, so that is
   * the user's call), and so does everything unrelated. Cycles cannot be solved;
   * they keep their current order and are reported.
   */
  function autoOrderConstraints(input) {
    const json = prepare(input)
    const parent = new Map(json.bones.map((b) => [b.name, b.parent || null]))
    const ancestors = (b) => {
      const out = []
      let x = parent.get(b)
      while (x) { out.push(x); x = parent.get(x) }
      return out
    }
    const slotBone = new Map(json.slots.map((x) => [x.name, x.bone]))
    const all = []
    for (const kind of CONSTRAINT_KINDS) for (const c of json[kind]) all.push({ kind, c })
    all.sort((a, b) => num(a.c.order, 0) - num(b.c.order, 0))
    const writes = all.map((x) => new Set((x.c.bones || []).flatMap((b) => branch(json, b))))
    const owns = all.map((x) => new Set(x.c.bones || []))
    const reads = all.map((x) => {
      const targets = []
      if (x.kind === 'path') {
        targets.push(slotBone.get(x.c.target))
        // a weighted path is placed by its weight bones, not by the slot bone
        for (const skin of json.skins) {
          for (const att of Object.values(skin.attachments[x.c.target] || {})) {
            for (const i of weightBones(att)) if (json.bones[i]) targets.push(json.bones[i].name)
          }
        }
      } else targets.push(x.c.target)
      const set = new Set()
      for (const t of targets) if (t) { set.add(t); for (const a of ancestors(t)) set.add(a) }
      for (const b of x.c.bones || []) for (const a of ancestors(b)) set.add(a)
      for (const b of owns[all.indexOf(x)] || []) set.delete(b)
      return set
    })
    const n = all.length
    const before = all.map(() => new Set())
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        let dep = false
        for (const b of reads[i]) if (writes[j].has(b)) { dep = true; break }
        // same bone driven twice: keep the current order between the two
        if (!dep && j < i) for (const b of owns[i]) if (owns[j].has(b)) { dep = true; break }
        if (dep) before[i].add(j)
      }
    }
    const placed = []
    const done = new Set()
    const cycles = []
    while (placed.length < n) {
      let pick = -1
      for (let i = 0; i < n; i++) {
        if (done.has(i)) continue
        if ([...before[i]].every((j) => done.has(j))) { pick = i; break }
      }
      if (pick < 0) {
        pick = [...Array(n).keys()].find((i) => !done.has(i))
        cycles.push(all[pick].c.name)
      }
      done.add(pick)
      placed.push(pick)
    }
    let changed = 0
    placed.forEach((i, pos) => {
      if (i !== pos) changed++
      all[i].c.order = pos
    })
    return { json: tidy(json), changed, cycles, order: placed.map((i) => all[i].c.name) }
  }

  /** Key a constraint's mixes at `time` (IK: mix/softness/bendPositive; transform: the four mixes). */
  function keyConstraint(input, anim, kind, name, time, values) {
    const json = prepare(input)
    const c = findConstraint(json, kind, name) || fail(`找不到约束：${name}`)
    const a = animationOf(json, anim)
    a[kind] = a[kind] || {}
    a[kind][name] = a[kind][name] || []
    const v = values || {}
    const key = {}
    if (kind === 'ik') {
      const mix = num(v.mix, num(c.mix, 1))
      if (mix !== 1) key.mix = mix
      const soft = num(v.softness, num(c.softness, 0))
      if (soft) key.softness = soft
      const bend = v.bendPositive !== undefined ? !!v.bendPositive : c.bendPositive !== false
      if (!bend) key.bendPositive = false
      // 3.8 keys compress / stretch too (uniform is setup only)
      if (v.compress !== undefined ? !!v.compress : !!c.compress) key.compress = true
      if (v.stretch !== undefined ? !!v.stretch : !!c.stretch) key.stretch = true
    } else if (kind === 'transform') {
      for (const k of ['rotateMix', 'translateMix', 'scaleMix', 'shearMix']) {
        const m = num(v[k], num(c[k], 1))
        if (m !== 1) key[k] = m
      }
    } else fail('只支持 IK 和变换约束')
    upsertKey(a[kind][name], time, key)
    return { json: tidy(json) }
  }

  // ---------------------------------------------------------------- animations

  function createAnimation(input, name) {
    const json = prepare(input)
    const taken = new Set(Object.keys(json.animations))
    const n = String(name || '').trim() || uniqueName(taken, 'animation', true)
    if (taken.has(n)) fail(`动画已存在：${n}`)
    json.animations[n] = {}
    return { json: tidy(json), animation: n }
  }

  function renameAnimation(input, name, next) {
    const json = prepare(input)
    const to = String(next || '').trim() || fail('名称不能为空')
    animationOf(json, name)
    if (to === name) return { json: tidy(json), animation: to }
    if (json.animations[to]) fail(`动画已存在：${to}`)
    // keep the key order of the object (= list order in the tree)
    const out = {}
    for (const [k, v] of Object.entries(json.animations)) out[k === name ? to : k] = v
    json.animations = out
    return { json: tidy(json), animation: to }
  }

  function deleteAnimation(input, name) {
    const json = prepare(input)
    animationOf(json, name)
    delete json.animations[name]
    return { json: tidy(json) }
  }

  function duplicateAnimation(input, name) {
    const json = prepare(input)
    const src = animationOf(json, name)
    const n = uniqueName(new Set(Object.keys(json.animations)), name)
    json.animations[n] = clone(src)
    return { json: tidy(json), animation: n }
  }

  // ---------------------------------------------------------------- summary

  /** Plain overview the UI lists from. */
  function describe(input) {
    const json = prepare(input)
    const constraints = []
    for (const kind of CONSTRAINT_KINDS) {
      for (const c of json[kind]) constraints.push({ kind, name: c.name, order: num(c.order, 0), bones: (c.bones || []).slice(), target: c.target })
    }
    constraints.sort((a, b) => a.order - b.order)
    return {
      bones: json.bones.map((b) => ({ name: b.name, parent: b.parent || null })),
      slots: json.slots.map((s) => ({ name: s.name, bone: s.bone, attachment: s.attachment || null })),
      skins: json.skins.map((s) => s.name),
      animations: Object.keys(json.animations),
      constraints,
    }
  }

  return {
    // bones
    addBone, setBoneProps, duplicateBone, renameBone, deleteBone, reparentBone, keepWorld, localFromWorld, worldFromLocal, branch, children,
    // animations
    createAnimation, renameAnimation, deleteAnimation, duplicateAnimation,
    // slots + attachments
    addSlot, duplicateSlot, renameSlot, compensateImages, deleteSlot, setSlotProps, moveSlot,
    addRegionAttachment, setAttachmentProps, renameAttachment, deleteAttachment, transferAttachment,
    // keys
    keyAttachment, keyColor, keyConstraint, keyBone, keyDeform, moveMeshVertices, setMesh, regionToMesh, boneKeys, removeKeyAt, slotKeys,
    reorderSlots, keyDrawOrder, decodeDrawOrder, encodeDrawOrder, createClipping, setClipping,
    // dopesheet
    keyTracks, moveKeys, scaleKeys, adjustKeys, deleteKeys, copyKeys, pasteKeys, setKeyCurve, keyCurve, setKeyBezier, keyBezier, nextKeyTime,
    // skins
    createSkin, renameSkin, deleteSkin, copyAttachmentToSkin, duplicateAttachment, hasDeformKeys,
    createEvent, setEventProps, renameEvent, deleteEvent, keyEvent, setSkinMembership,
    // skin placeholders
    isPlaceholder, placeholderList, addPlaceholder, fillPlaceholder, clearPlaceholder, convertToPlaceholder, deletePlaceholder, exportable,
    // constraints
    createIk, createTransform, transformOffsets, autoOrderConstraints, setConstraintProps, renameConstraint, deleteConstraint,
    // helpers
    describe, prepare, tidy, isWeighted, weightBones, toLocal, toWorld, rebaseAttachment, setAttachmentExport, isExported, editorData,
  }
})
