/**
 * Spine 3.8 binary (.skel) writer: the mirror image of the runtime's SkeletonBinary reader
 * (vendor/spine/spine-webgl-3.8.js), fed with 3.8 JSON as the editor holds it.
 *
 *   NovaFlowSpineBinary.write38(json, { nonessential: true }) -> Uint8Array
 *
 * Strings referenced through the string table (readStringRef) are collected first; floats are
 * big-endian; ints are the runtime's varints (zig-zag when they may be negative).
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowSpineBinary = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
  const fail = (m) => { throw new Error(m) }

  const TRANSFORM_MODES = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection']
  const BLEND_MODES = ['normal', 'additive', 'multiply', 'screen']
  const POSITION_MODES = ['fixed', 'percent']
  const SPACING_MODES = ['length', 'fixed', 'percent']
  const ROTATE_MODES = ['tangent', 'chain', 'chainScale']
  const ATTACHMENT_TYPES = { region: 0, boundingbox: 1, mesh: 2, linkedmesh: 3, path: 4, point: 5, clipping: 6 }
  const BONE_ROTATE = 0, BONE_TRANSLATE = 1, BONE_SCALE = 2, BONE_SHEAR = 3
  const SLOT_ATTACHMENT = 0, SLOT_COLOR = 1, SLOT_TWO_COLOR = 2
  const PATH_POSITION = 0, PATH_SPACING = 1, PATH_MIX = 2
  const CURVE_LINEAR = 0, CURVE_STEPPED = 1, CURVE_BEZIER = 2

  /** A growable big-endian byte sink with the runtime's number encodings. */
  function Output() {
    let buf = new Uint8Array(1 << 16), view = new DataView(buf.buffer), n = 0
    const need = (k) => { if (n + k > buf.length) { let size = buf.length * 2; while (size < n + k) size *= 2; const next = new Uint8Array(size); next.set(buf); buf = next; view = new DataView(buf.buffer) } }
    const o = {
      byte(v) { need(1); view.setInt8(n, v); n += 1 },
      bool(v) { o.byte(v ? 1 : 0) },
      short(v) { need(2); view.setInt16(n, v); n += 2 },
      int32(v) { need(4); view.setInt32(n, v | 0); n += 4 },
      float(v) { need(4); view.setFloat32(n, num(v, 0)); n += 4 },
      // the runtime's varint: 7 bits a byte, high bit = more; zig-zag unless optimizePositive
      int(value, optimizePositive) {
        let v = value | 0
        if (!optimizePositive) v = (v << 1) ^ (v >> 31)
        v >>>= 0
        while (v > 0x7f) { o.byte(((v & 0x7f) | 0x80) << 24 >> 24); v >>>= 7 }
        o.byte(v << 24 >> 24)
      },
      // null -> 0, "" -> 1, else byte count + 1 then UTF-8
      string(s) {
        if (s == null) { o.int(0, true); return }
        if (s === '') { o.int(1, true); return }
        const bytes = utf8(String(s))
        o.int(bytes.length + 1, true)
        need(bytes.length); buf.set(bytes, n); n += bytes.length
      },
      bytes() { return buf.slice(0, n) },
    }
    return o
  }
  const utf8 = (s) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, 'utf8')))

  /** 'rrggbbaa' -> int32 as the runtime's rgba8888ToColor reads it (255 alpha when missing). */
  const rgba8888 = (hex, fallback = 'ffffffff') => {
    const h = /^[0-9a-f]{6,8}$/i.test(hex || '') ? String(hex) : fallback
    const s = h.length === 6 ? h + 'ff' : h
    return parseInt(s, 16) | 0
  }
  const rgb888 = (hex) => parseInt(String(hex).slice(0, 6), 16) | 0

  function write38(input, options) {
    const json = input || fail('没有工程')
    const nonessential = !options || options.nonessential !== false
    const out = Output()
    const bones = json.bones || [], slots = json.slots || []
    const boneIndex = new Map(bones.map((b, i) => [b.name, i]))
    const slotIndex = new Map(slots.map((s, i) => [s.name, i]))
    const ik = json.ik || [], transform = json.transform || [], path = json.path || []
    const ikIndex = new Map(ik.map((c, i) => [c.name, i])), trIndex = new Map(transform.map((c, i) => [c.name, i])), pathIndex = new Map(path.map((c, i) => [c.name, i]))
    const skinsIn = Array.isArray(json.skins) ? json.skins : Object.entries(json.skins || {}).map(([name, attachments]) => ({ name, attachments }))
    const defaultSkin = skinsIn.find((s) => s.name === 'default') || null
    const otherSkins = skinsIn.filter((s) => s !== defaultSkin)
    const defaultHasSlots = !!(defaultSkin && Object.keys(defaultSkin.attachments || {}).length)
    // the skins as the reader lists them: default first (only when it has attachments), then the rest
    const skinList = [...(defaultHasSlots ? [defaultSkin] : []), ...otherSkins]
    const skinListIndex = new Map(skinList.map((s, i) => [s.name, i]))
    const events = Object.entries(json.events || {})
    const eventIndex = new Map(events.map(([name], i) => [name, i]))
    const animations = Object.entries(json.animations || {})

    // ---- the string table: everything the reader takes through readStringRef
    const strings = [], stringAt = new Map()
    const ref = (s) => { if (s == null) return 0; const k = String(s); if (!stringAt.has(k)) { stringAt.set(k, strings.length + 1); strings.push(k) } return stringAt.get(k) }
    for (const s of slots) if (s.attachment) ref(s.attachment)
    for (const sk of otherSkins) ref(sk.name)
    const attName = (key, a) => (a && a.name && a.name !== key ? a.name : null)
    for (const sk of skinList) for (const [slot, atts] of Object.entries(sk.attachments || {})) for (const [key, a] of Object.entries(atts || {})) {
      ref(key); const nm = attName(key, a); if (nm) ref(nm)
      const t = a.type || 'region'
      if ((t === 'region' || t === 'mesh' || t === 'linkedmesh') && a.path && a.path !== (nm || key)) ref(a.path)
      if (t === 'linkedmesh') { if (a.skin) ref(a.skin); ref(a.parent) }
      void slot
    }
    for (const [name] of events) ref(name)
    for (const [, an] of animations) {
      for (const tl of Object.values(an.slots || {})) for (const k of tl.attachment || []) if (k.name != null) ref(k.name)
      for (const sk of Object.values(an.deform || {})) for (const sl of Object.values(sk || {})) for (const name of Object.keys(sl || {})) ref(name)
    }

    // ---- header
    const sk0 = json.skeleton || {}
    out.string(sk0.hash || '')
    out.string('3.8.99')
    out.float(sk0.x); out.float(sk0.y); out.float(sk0.width); out.float(sk0.height)
    out.bool(nonessential)
    if (nonessential) { out.float(num(sk0.fps, 30)); out.string(sk0.images || ''); out.string(sk0.audio || '') }
    out.int(strings.length, true)
    for (const s of strings) out.string(s)

    // ---- bones (parents before children; the first bone is the root)
    out.int(bones.length, true)
    bones.forEach((b, i) => {
      out.string(b.name)
      if (i > 0) { const p = boneIndex.get(b.parent); if (p == null || p >= i) fail(`骨骼 ${b.name} 的父级要排在它前面`); out.int(p, true) }
      out.float(b.rotation); out.float(b.x); out.float(b.y); out.float(num(b.scaleX, 1)); out.float(num(b.scaleY, 1))
      out.float(b.shearX); out.float(b.shearY); out.float(b.length)
      out.int(Math.max(0, TRANSFORM_MODES.indexOf(b.transform || 'normal')), true)
      out.bool(!!b.skin)
      if (nonessential) out.int32(rgba8888(b.color, '9b9b9bff'))
    })
    // ---- slots
    out.int(slots.length, true)
    for (const s of slots) {
      out.string(s.name)
      out.int(boneIndex.has(s.bone) ? boneIndex.get(s.bone) : fail(`插槽 ${s.name} 的骨骼 ${s.bone} 不存在`), true)
      out.int32(rgba8888(s.color))
      out.int32(s.dark ? rgb888(s.dark) : -1)
      out.int(ref(s.attachment || null), true)
      out.int(Math.max(0, BLEND_MODES.indexOf(s.blend || 'normal')), true)
    }
    // ---- constraints
    out.int(ik.length, true)
    ik.forEach((c) => {
      out.string(c.name); out.int(num(c.order, 0), true); out.bool(!!c.skin)
      out.int((c.bones || []).length, true); for (const b of c.bones || []) out.int(boneIndex.get(b), true)
      out.int(boneIndex.get(c.target), true)
      out.float(num(c.mix, 1)); out.float(c.softness)
      out.byte(c.bendPositive === false ? -1 : 1)
      out.bool(!!c.compress); out.bool(!!c.stretch); out.bool(!!c.uniform)
    })
    out.int(transform.length, true)
    transform.forEach((c) => {
      out.string(c.name); out.int(num(c.order, 0), true); out.bool(!!c.skin)
      out.int((c.bones || []).length, true); for (const b of c.bones || []) out.int(boneIndex.get(b), true)
      out.int(boneIndex.get(c.target), true)
      out.bool(!!c.local); out.bool(!!c.relative)
      out.float(c.rotation); out.float(c.x); out.float(c.y); out.float(c.scaleX); out.float(c.scaleY); out.float(c.shearY)
      out.float(num(c.rotateMix, 1)); out.float(num(c.translateMix, 1)); out.float(num(c.scaleMix, 1)); out.float(num(c.shearMix, 1))
    })
    out.int(path.length, true)
    path.forEach((c) => {
      out.string(c.name); out.int(num(c.order, 0), true); out.bool(!!c.skin)
      out.int((c.bones || []).length, true); for (const b of c.bones || []) out.int(boneIndex.get(b), true)
      out.int(slotIndex.get(c.target), true)
      out.int(Math.max(0, POSITION_MODES.indexOf(c.positionMode || 'percent')), true)
      out.int(Math.max(0, SPACING_MODES.indexOf(c.spacingMode || 'length')), true)
      out.int(Math.max(0, ROTATE_MODES.indexOf(c.rotateMode || 'tangent')), true)
      out.float(c.rotation); out.float(c.position); out.float(c.spacing)
      out.float(num(c.rotateMix, 1)); out.float(num(c.translateMix, 1))
    })

    // ---- skins
    const writeVertices = (a, vertexCount) => {
      const v = a.vertices || []
      const weighted = v.length !== vertexCount * 2
      out.bool(weighted)
      if (!weighted) { for (let i = 0; i < vertexCount * 2; i++) out.float(v[i]) ; return }
      let k = 0
      for (let i = 0; i < vertexCount; i++) {
        const cnt = v[k++] | 0
        out.int(cnt, true)
        for (let j = 0; j < cnt; j++) { out.int(v[k++] | 0, true); out.float(v[k++]); out.float(v[k++]); out.float(v[k++]) }
      }
    }
    const writeShorts = (arr) => { const a = arr || []; out.int(a.length, true); for (const x of a) out.short(x) }
    const writeAttachment = (key, a) => {
      const nm = attName(key, a)
      out.int(ref(nm), true)
      const t = a.type || 'region'
      if (!(t in ATTACHMENT_TYPES)) fail(`不认识的附件类型：${t}`)
      out.byte(ATTACHMENT_TYPES[t])
      const name = nm || key
      if (t === 'region') {
        out.int(ref(a.path && a.path !== name ? a.path : null), true)
        out.float(a.rotation); out.float(a.x); out.float(a.y); out.float(num(a.scaleX, 1)); out.float(num(a.scaleY, 1))
        out.float(a.width); out.float(a.height); out.int32(rgba8888(a.color))
      } else if (t === 'boundingbox') {
        const n = num(a.vertexCount, (a.vertices || []).length / 2)
        out.int(n, true); writeVertices(a, n); if (nonessential) out.int32(rgba8888(a.color, '60f000ff'))
      } else if (t === 'mesh') {
        out.int(ref(a.path && a.path !== name ? a.path : null), true)
        out.int32(rgba8888(a.color))
        const n = (a.uvs || []).length / 2
        out.int(n, true)
        for (let i = 0; i < n * 2; i++) out.float(a.uvs[i])
        writeShorts(a.triangles)
        writeVertices(a, n)
        out.int(num(a.hull, 0), true)
        if (nonessential) { writeShorts(a.edges); out.float(a.width); out.float(a.height) }
      } else if (t === 'linkedmesh') {
        out.int(ref(a.path && a.path !== name ? a.path : null), true)
        out.int32(rgba8888(a.color))
        out.int(ref(a.skin || null), true); out.int(ref(a.parent), true)
        out.bool(a.deform !== false)
        if (nonessential) { out.float(a.width); out.float(a.height) }
      } else if (t === 'path') {
        out.bool(!!a.closed); out.bool(a.constantSpeed !== false)
        const n = num(a.vertexCount, (a.vertices || []).length / 2)
        out.int(n, true); writeVertices(a, n)
        for (let i = 0; i < n / 3; i++) out.float((a.lengths || [])[i])
        if (nonessential) out.int32(rgba8888(a.color, 'ff7f00ff'))
      } else if (t === 'point') {
        out.float(a.rotation); out.float(a.x); out.float(a.y)
        if (nonessential) out.int32(rgba8888(a.color, 'f1f100ff'))
      } else if (t === 'clipping') {
        out.int(slotIndex.has(a.end) ? slotIndex.get(a.end) : fail(`剪裁 ${name} 的结束插槽 ${a.end} 不存在`), true)
        const n = num(a.vertexCount, (a.vertices || []).length / 2)
        out.int(n, true); writeVertices(a, n)
        if (nonessential) out.int32(rgba8888(a.color, 'ce3a3aff'))
      }
    }
    const writeSkinSlots = (sk) => {
      const entries = Object.entries(sk.attachments || {}).filter(([slot]) => slotIndex.has(slot))
      out.int(entries.length, true)
      for (const [slot, atts] of entries) {
        out.int(slotIndex.get(slot), true)
        const list = Object.entries(atts || {})
        out.int(list.length, true)
        for (const [key, a] of list) { out.int(ref(key), true); writeAttachment(key, a) }
      }
    }
    if (defaultHasSlots) writeSkinSlots(defaultSkin); else out.int(0, true)
    out.int(otherSkins.length, true)
    for (const sk of otherSkins) {
      out.int(ref(sk.name), true)
      out.int((sk.bones || []).length, true); for (const b of sk.bones || []) out.int(boneIndex.get(b), true)
      const cons = (names, index) => { const l = (names || []).filter((n) => index.has(n)); out.int(l.length, true); for (const n of l) out.int(index.get(n), true) }
      cons(sk.ik, ikIndex); cons(sk.transform, trIndex); cons(sk.path, pathIndex)
      writeSkinSlots(sk)
    }

    // ---- events
    out.int(events.length, true)
    for (const [name, e] of events) {
      out.int(ref(name), true)
      // the string defaults to '' (as the JSON reader has it), the audio path to none
      out.int(num(e.int, 0), false); out.float(e.float); out.string(e.string == null ? '' : String(e.string))
      out.string(e.audio == null ? null : String(e.audio))
      if (e.audio != null) { out.float(num(e.volume, 1)); out.float(num(e.balance, 0)) }
    }

    // ---- animations
    const writeCurve = (k) => {
      if (k.curve === 'stepped') out.byte(CURVE_STEPPED)
      else if (typeof k.curve === 'number') { out.byte(CURVE_BEZIER); out.float(k.curve); out.float(num(k.c2, 0)); out.float(num(k.c3, 1)); out.float(num(k.c4, 1)) }
      else if (Array.isArray(k.curve) && k.curve.length >= 4) { out.byte(CURVE_BEZIER); for (let i = 0; i < 4; i++) out.float(k.curve[i]) }
      else out.byte(CURVE_LINEAR)
    }
    const frames = (list, each) => { out.int(list.length, true); list.forEach((k, i) => { each(k); if (i < list.length - 1) writeCurve(k) }) }
    out.int(animations.length, true)
    for (const [name, an] of animations) {
      out.string(name)
      // slots
      const slotTl = Object.entries(an.slots || {}).filter(([s]) => slotIndex.has(s))
      out.int(slotTl.length, true)
      for (const [slot, tl] of slotTl) {
        out.int(slotIndex.get(slot), true)
        const kinds = [['attachment', tl.attachment], ['color', tl.color], ['twoColor', tl.twoColor]].filter(([, l]) => Array.isArray(l) && l.length)
        out.int(kinds.length, true)
        for (const [kind, list] of kinds) {
          if (kind === 'attachment') { out.byte(SLOT_ATTACHMENT); out.int(list.length, true); for (const k of list) { out.float(k.time); out.int(ref(k.name == null ? null : k.name), true) } }
          else if (kind === 'color') { out.byte(SLOT_COLOR); frames(list, (k) => { out.float(k.time); out.int32(rgba8888(k.color)) }) }
          else { out.byte(SLOT_TWO_COLOR); frames(list, (k) => { out.float(k.time); out.int32(rgba8888(k.light)); out.int32(rgb888(k.dark || 'ffffff')) }) }
        }
      }
      // bones
      const boneTl = Object.entries(an.bones || {}).filter(([b]) => boneIndex.has(b))
      out.int(boneTl.length, true)
      for (const [bone, tl] of boneTl) {
        out.int(boneIndex.get(bone), true)
        const kinds = [['rotate', BONE_ROTATE, tl.rotate], ['translate', BONE_TRANSLATE, tl.translate], ['scale', BONE_SCALE, tl.scale], ['shear', BONE_SHEAR, tl.shear]].filter(([, , l]) => Array.isArray(l) && l.length)
        out.int(kinds.length, true)
        for (const [kind, type, list] of kinds) {
          out.byte(type)
          if (kind === 'rotate') frames(list, (k) => { out.float(k.time); out.float(num(k.angle != null ? k.angle : k.value, 0)) })
          else { const d = kind === 'scale' ? 1 : 0; frames(list, (k) => { out.float(k.time); out.float(num(k.x, d)); out.float(num(k.y, d)) }) }
        }
      }
      // ik / transform / path constraints
      const ikTl = Object.entries(an.ik || {}).filter(([c]) => ikIndex.has(c))
      out.int(ikTl.length, true)
      for (const [c, list] of ikTl) { out.int(ikIndex.get(c), true); frames(list || [], (k) => { out.float(k.time); out.float(num(k.mix, 1)); out.float(k.softness); out.byte(k.bendPositive === false ? -1 : 1); out.bool(!!k.compress); out.bool(!!k.stretch) }) }
      const trTl = Object.entries(an.transform || {}).filter(([c]) => trIndex.has(c))
      out.int(trTl.length, true)
      for (const [c, list] of trTl) { out.int(trIndex.get(c), true); frames(list || [], (k) => { out.float(k.time); out.float(num(k.rotateMix, 1)); out.float(num(k.translateMix, 1)); out.float(num(k.scaleMix, 1)); out.float(num(k.shearMix, 1)) }) }
      const pathTl = Object.entries(an.path || {}).filter(([c]) => pathIndex.has(c))
      out.int(pathTl.length, true)
      for (const [c, tl] of pathTl) {
        out.int(pathIndex.get(c), true)
        const kinds = [['position', PATH_POSITION, tl.position], ['spacing', PATH_SPACING, tl.spacing], ['mix', PATH_MIX, tl.mix]].filter(([, , l]) => Array.isArray(l) && l.length)
        out.int(kinds.length, true)
        for (const [kind, type, list] of kinds) {
          out.byte(type)
          if (kind === 'mix') frames(list, (k) => { out.float(k.time); out.float(num(k.rotateMix, 1)); out.float(num(k.translateMix, 1)) })
          else frames(list, (k) => { out.float(k.time); out.float(num(k[kind], 0)) })
        }
      }
      // deform
      const deformSkins = Object.entries(an.deform || {}).filter(([s]) => skinListIndex.has(s))
      out.int(deformSkins.length, true)
      for (const [skinName, bySlot] of deformSkins) {
        out.int(skinListIndex.get(skinName), true)
        const slotsD = Object.entries(bySlot || {}).filter(([s]) => slotIndex.has(s))
        out.int(slotsD.length, true)
        for (const [slot, byAtt] of slotsD) {
          out.int(slotIndex.get(slot), true)
          const atts = Object.entries(byAtt || {})
          out.int(atts.length, true)
          for (const [attKey, list] of atts) {
            out.int(ref(attKey), true)
            frames(list || [], (k) => {
              out.float(k.time)
              const v = k.vertices || []
              out.int(v.length, true)
              if (v.length) { out.int(num(k.offset, 0), true); for (const x of v) out.float(x) }
            })
          }
        }
      }
      // draw order
      const dro = Array.isArray(an.drawOrder) ? an.drawOrder : (Array.isArray(an.draworder) ? an.draworder : [])
      out.int(dro.length, true)
      for (const k of dro) {
        out.float(k.time)
        const offs = (k.offsets || []).filter((o) => slotIndex.has(o.slot)).sort((a, b) => slotIndex.get(a.slot) - slotIndex.get(b.slot))
        out.int(offs.length, true)
        for (const o of offs) { out.int(slotIndex.get(o.slot), true); out.int(num(o.offset, 0), true) }
      }
      // events
      const evs = (Array.isArray(an.events) ? an.events : []).filter((e) => eventIndex.has(e.name))
      out.int(evs.length, true)
      for (const e of evs) {
        const [, data] = events[eventIndex.get(e.name)]
        out.float(e.time); out.int(eventIndex.get(e.name), true)
        out.int(num(e.int, num(data.int, 0)), false); out.float(num(e.float, num(data.float, 0)))
        const hasString = e.string != null && String(e.string) !== String(data.string == null ? '' : data.string)
        out.bool(hasString); if (hasString) out.string(String(e.string))
        if (data.audio != null) { out.float(num(e.volume, num(data.volume, 1))); out.float(num(e.balance, num(data.balance, 0))) }
      }
    }
    return out.bytes()
  }

  return { write38 }
})
