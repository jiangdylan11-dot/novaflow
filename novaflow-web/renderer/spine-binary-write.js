/**
 * Spine binary (.skel) writers: the mirror image of the runtimes' SkeletonBinary readers, fed
 * with the JSON of the same version (3.8 as the editor holds it; 3.7 / 4.0 / 4.1 / 4.2 as
 * spine-version-convert.js produces it).
 *
 *   NovaFlowSpineBinary.write(json, version, { nonessential: true }) -> Uint8Array
 *   NovaFlowSpineBinary.write37(json, opts)      Spine 3.7.94 (inline strings, no skin requirements)
 *   NovaFlowSpineBinary.write38(json, opts)      Spine 3.8  (vendor/spine/spine-webgl-3.8.js)
 *   NovaFlowSpineBinary.write4(json, '4.1', opts) Spine 4.0 / 4.1 / 4.2 (spine-core 4.x)
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
  const SPACING_MODES = ['length', 'fixed', 'percent', 'proportional']
  const ROTATE_MODES = ['tangent', 'chain', 'chainScale']
  const ATTACHMENT_TYPES = { region: 0, boundingbox: 1, mesh: 2, linkedmesh: 3, path: 4, point: 5, clipping: 6 }
  const CURVE_LINEAR = 0, CURVE_STEPPED = 1, CURVE_BEZIER = 2
  /** enum names as the JSON carries them ('normal' / 'Normal' / 'onlyTranslation' …) -> index */
  const enumIndex = (list, value, fallback) => { const s = String(value == null ? '' : value); const k = s ? s[0].toLowerCase() + s.slice(1) : ''; const i = list.indexOf(k); return i < 0 ? fallback : i }

  /** A growable big-endian byte sink with the runtime's number encodings. */
  function Output() {
    let buf = new Uint8Array(1 << 16), view = new DataView(buf.buffer), n = 0
    const need = (k) => { if (n + k > buf.length) { let size = buf.length * 2; while (size < n + k) size *= 2; const next = new Uint8Array(size); next.set(buf); buf = next; view = new DataView(buf.buffer) } }
    const o = {
      byte(v) { need(1); view.setInt8(n, (v | 0) << 24 >> 24); n += 1 },
      ubyte(v) { need(1); view.setUint8(n, Math.max(0, Math.min(255, Math.round(num(v, 0))))); n += 1 },
      bool(v) { o.byte(v ? 1 : 0) },
      short(v) { need(2); view.setInt16(n, v); n += 2 },
      int32(v) { need(4); view.setInt32(n, v | 0); n += 4 },
      float(v) { need(4); view.setFloat32(n, num(v, 0)); n += 4 },
      // the runtime's varint: 7 bits a byte, high bit = more; zig-zag unless optimizePositive
      int(value, optimizePositive) {
        let v = value | 0
        if (!optimizePositive) v = (v << 1) ^ (v >> 31)
        v >>>= 0
        while (v > 0x7f) { o.byte((v & 0x7f) | 0x80); v >>>= 7 }
        o.byte(v)
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
  /** the colour's bytes (two hex digits each), `count` of them, 255 where the string is short */
  const colorBytes = (hex, count, fallback) => { const h = /^[0-9a-f]{6,8}$/i.test(hex || '') ? String(hex) : fallback; const out = []; for (let i = 0; i < count; i++) out.push(h.length >= i * 2 + 2 ? parseInt(h.slice(i * 2, i * 2 + 2), 16) : 255); return out }

  /** skins as the readers list them: default first (only when it has attachments), then the rest */
  function skinOrder(json, keepEmptyDefault = false) {
    const skinsIn = Array.isArray(json.skins) ? json.skins : Object.entries(json.skins || {}).map(([name, attachments]) => ({ name, attachments }))
    const defaultSkin = skinsIn.find((s) => s.name === 'default') || null
    const otherSkins = skinsIn.filter((s) => s !== defaultSkin)
    const defaultHasSlots = !!(defaultSkin && (Object.keys(defaultSkin.attachments || {}).length || (keepEmptyDefault && (json.slots || []).length)))
    const skinList = [...(defaultHasSlots ? [defaultSkin] : []), ...otherSkins]
    return { defaultSkin, otherSkins, defaultHasSlots, skinList, skinListIndex: new Map(skinList.map((s, i) => [s.name, i])) }
  }
  const attName = (key, a) => (a && a.name && a.name !== key ? a.name : null)

  // ======================================================================================= 3.7 / 3.8
  const write37 = (input, options) => write3(input, options, true)
  const write38 = (input, options) => write3(input, options, false)
  function write3(input, options, old) {
    const json = input || fail('没有工程')
    const nonessential = !options || options.nonessential !== false
    const out = Output()
    const bones = json.bones || [], slots = json.slots || []
    const boneIndex = new Map(bones.map((b, i) => [b.name, i]))
    const slotIndex = new Map(slots.map((s, i) => [s.name, i]))
    const ik = json.ik || [], transform = json.transform || [], path = json.path || []
    const ikIndex = new Map(ik.map((c, i) => [c.name, i])), trIndex = new Map(transform.map((c, i) => [c.name, i])), pathIndex = new Map(path.map((c, i) => [c.name, i]))
    const { defaultSkin, otherSkins, defaultHasSlots, skinList, skinListIndex } = skinOrder(json, old)
    const events = Object.entries(json.events || {})
    const eventIndex = new Map(events.map(([name], i) => [name, i]))
    const animations = Object.entries(json.animations || {})

    // ---- the string table: everything the reader takes through readStringRef
    const strings = [], stringAt = new Map()
    const ref = (s) => { if (s == null) return 0; const k = String(s); if (!stringAt.has(k)) { stringAt.set(k, strings.length + 1); strings.push(k) } return stringAt.get(k) }
    // 3.7 writes strings inline; 3.8 replaces these with string-table indices.
    const writeRef = (s) => { if (old) out.string(s); else out.int(ref(s), true) }
    for (const s of slots) if (s.attachment) ref(s.attachment)
    for (const sk of otherSkins) ref(sk.name)
    for (const sk of skinList) for (const atts of Object.values(sk.attachments || {})) for (const [key, a] of Object.entries(atts || {})) {
      ref(key); const nm = attName(key, a); if (nm) ref(nm)
      const t = a.type || 'region'
      if ((t === 'region' || t === 'mesh' || t === 'linkedmesh') && a.path && a.path !== (nm || key)) ref(a.path)
      if (t === 'linkedmesh') { if (a.skin) ref(a.skin); ref(a.parent) }
    }
    for (const [name] of events) ref(name)
    for (const [, an] of animations) {
      for (const tl of Object.values(an.slots || {})) for (const k of tl.attachment || []) if (k.name != null) ref(k.name)
      for (const sk of Object.values(an.deform || {})) for (const sl of Object.values(sk || {})) for (const name of Object.keys(sl || {})) ref(name)
    }

    // ---- header
    const sk0 = json.skeleton || {}
    out.string(sk0.hash || '')
    out.string(old ? '3.7.94' : '3.8.99')
    if (!old) { out.float(sk0.x); out.float(sk0.y) }
    out.float(sk0.width); out.float(sk0.height)
    out.bool(nonessential)
    if (nonessential) { out.float(num(sk0.fps, 30)); out.string(sk0.images || ''); out.string(sk0.audio || '') }
    if (!old) { out.int(strings.length, true); for (const s of strings) out.string(s) }

    // ---- bones (parents before children; the first bone is the root)
    out.int(bones.length, true)
    bones.forEach((b, i) => {
      out.string(b.name)
      if (i > 0) { const p = boneIndex.get(b.parent); if (p == null || p >= i) fail(`骨骼 ${b.name} 的父级要排在它前面`); out.int(p, true) }
      out.float(b.rotation); out.float(b.x); out.float(b.y); out.float(num(b.scaleX, 1)); out.float(num(b.scaleY, 1))
      out.float(b.shearX); out.float(b.shearY); out.float(b.length)
      out.int(enumIndex(TRANSFORM_MODES, b.transform, 0), true)
      if (!old) out.bool(!!b.skin)
      if (nonessential) out.int32(rgba8888(b.color, '9b9b9bff'))
    })
    // ---- slots
    out.int(slots.length, true)
    for (const s of slots) {
      out.string(s.name)
      out.int(boneIndex.has(s.bone) ? boneIndex.get(s.bone) : fail(`插槽 ${s.name} 的骨骼 ${s.bone} 不存在`), true)
      out.int32(rgba8888(s.color))
      out.int32(s.dark ? rgb888(s.dark) : -1)
      writeRef(s.attachment || null)
      out.int(enumIndex(BLEND_MODES, s.blend, 0), true)
    }
    // ---- constraints (order: absent = 0, as the JSON reader has it)
    out.int(ik.length, true)
    ik.forEach((c) => {
      out.string(c.name); out.int(num(c.order, 0), true); if (!old) out.bool(!!c.skin)
      out.int((c.bones || []).length, true); for (const b of c.bones || []) out.int(boneIndex.get(b), true)
      out.int(boneIndex.get(c.target), true)
      out.float(num(c.mix, 1)); if (!old) out.float(c.softness)
      out.byte(c.bendPositive === false ? -1 : 1)
      out.bool(!!c.compress); out.bool(!!c.stretch); out.bool(!!c.uniform)
    })
    out.int(transform.length, true)
    transform.forEach((c) => {
      out.string(c.name); out.int(num(c.order, 0), true); if (!old) out.bool(!!c.skin)
      out.int((c.bones || []).length, true); for (const b of c.bones || []) out.int(boneIndex.get(b), true)
      out.int(boneIndex.get(c.target), true)
      out.bool(!!c.local); out.bool(!!c.relative)
      out.float(c.rotation); out.float(c.x); out.float(c.y); out.float(c.scaleX); out.float(c.scaleY); out.float(c.shearY)
      out.float(num(c.rotateMix, 1)); out.float(num(c.translateMix, 1)); out.float(num(c.scaleMix, 1)); out.float(num(c.shearMix, 1))
    })
    out.int(path.length, true)
    path.forEach((c) => {
      out.string(c.name); out.int(num(c.order, 0), true); if (!old) out.bool(!!c.skin)
      out.int((c.bones || []).length, true); for (const b of c.bones || []) out.int(boneIndex.get(b), true)
      out.int(slotIndex.get(c.target), true)
      out.int(enumIndex(POSITION_MODES, c.positionMode, 1), true)
      out.int(enumIndex(SPACING_MODES, c.spacingMode, 0), true)
      out.int(enumIndex(ROTATE_MODES, c.rotateMode, 0), true)
      out.float(c.rotation); out.float(c.position); out.float(c.spacing)
      out.float(num(c.rotateMix, 1)); out.float(num(c.translateMix, 1))
    })

    // ---- skins
    const writeVertices = (a, vertexCount) => {
      const v = a.vertices || []
      const weighted = v.length !== vertexCount * 2
      out.bool(weighted)
      if (!weighted) { for (let i = 0; i < vertexCount * 2; i++) out.float(v[i]); return }
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
      writeRef(nm)
      const t = a.type || 'region'
      if (!(t in ATTACHMENT_TYPES)) fail(`不认识的附件类型：${t}`)
      out.byte(ATTACHMENT_TYPES[t])
      const name = nm || key
      if (t === 'region') {
        writeRef(a.path && a.path !== name ? a.path : null)
        out.float(a.rotation); out.float(a.x); out.float(a.y); out.float(num(a.scaleX, 1)); out.float(num(a.scaleY, 1))
        out.float(a.width); out.float(a.height); out.int32(rgba8888(a.color))
      } else if (t === 'boundingbox') {
        const n = num(a.vertexCount, (a.vertices || []).length / 2)
        out.int(n, true); writeVertices(a, n); if (nonessential) out.int32(rgba8888(a.color, '60f000ff'))
      } else if (t === 'mesh') {
        writeRef(a.path && a.path !== name ? a.path : null)
        out.int32(rgba8888(a.color))
        const n = (a.uvs || []).length / 2
        out.int(n, true)
        for (let i = 0; i < n * 2; i++) out.float(a.uvs[i])
        writeShorts(a.triangles)
        writeVertices(a, n)
        out.int(num(a.hull, 0), true)
        if (nonessential) { writeShorts(a.edges); out.float(a.width); out.float(a.height) }
      } else if (t === 'linkedmesh') {
        writeRef(a.path && a.path !== name ? a.path : null)
        out.int32(rgba8888(a.color))
        writeRef(a.skin || null); writeRef(a.parent)
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
      // 3.7 interprets zero slots as a null skin; an empty slot preserves a named empty skin.
      if (old && !entries.length && slots.length) entries.push([slots[0].name, {}])
      out.int(entries.length, true)
      for (const [slot, atts] of entries) {
        out.int(slotIndex.get(slot), true)
        const list = Object.entries(atts || {})
        out.int(list.length, true)
        for (const [key, a] of list) { writeRef(key); writeAttachment(key, a) }
      }
    }
    if (defaultHasSlots) writeSkinSlots(defaultSkin); else out.int(0, true)
    out.int(otherSkins.length, true)
    for (const sk of otherSkins) {
      writeRef(sk.name)
      if (!old) {
        out.int((sk.bones || []).length, true); for (const b of sk.bones || []) out.int(boneIndex.get(b), true)
        const cons = (names, index) => { const l = (names || []).filter((n) => index.has(n)); out.int(l.length, true); for (const n of l) out.int(index.get(n), true) }
        cons(sk.ik, ikIndex); cons(sk.transform, trIndex); cons(sk.path, pathIndex)
      }
      writeSkinSlots(sk)
    }

    // ---- events
    out.int(events.length, true)
    for (const [name, e] of events) {
      writeRef(name)
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
          if (kind === 'attachment') { out.byte(0); out.int(list.length, true); for (const k of list) { out.float(k.time); writeRef(k.name == null ? null : k.name) } }
          else if (kind === 'color') { out.byte(1); frames(list, (k) => { out.float(k.time); out.int32(rgba8888(k.color)) }) }
          else { out.byte(2); frames(list, (k) => { out.float(k.time); out.int32(rgba8888(k.light)); out.int32(rgb888(k.dark || 'ffffff')) }) }
        }
      }
      // bones
      const boneTl = Object.entries(an.bones || {}).filter(([b]) => boneIndex.has(b))
      out.int(boneTl.length, true)
      for (const [bone, tl] of boneTl) {
        out.int(boneIndex.get(bone), true)
        const kinds = [['rotate', 0, tl.rotate], ['translate', 1, tl.translate], ['scale', 2, tl.scale], ['shear', 3, tl.shear]].filter(([, , l]) => Array.isArray(l) && l.length)
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
      for (const [c, list] of ikTl) { out.int(ikIndex.get(c), true); frames(list || [], (k) => { out.float(k.time); out.float(num(k.mix, 1)); if (!old) out.float(k.softness); out.byte(k.bendPositive === false ? -1 : 1); out.bool(!!k.compress); out.bool(!!k.stretch) }) }
      const trTl = Object.entries(an.transform || {}).filter(([c]) => trIndex.has(c))
      out.int(trTl.length, true)
      for (const [c, list] of trTl) { out.int(trIndex.get(c), true); frames(list || [], (k) => { out.float(k.time); out.float(num(k.rotateMix, 1)); out.float(num(k.translateMix, 1)); out.float(num(k.scaleMix, 1)); out.float(num(k.shearMix, 1)) }) }
      const pathTl = Object.entries((old ? an.paths || an.path : an.path) || {}).filter(([c]) => pathIndex.has(c))
      out.int(pathTl.length, true)
      for (const [c, tl] of pathTl) {
        out.int(pathIndex.get(c), true)
        const kinds = [['position', 0, tl.position], ['spacing', 1, tl.spacing], ['mix', 2, tl.mix]].filter(([, , l]) => Array.isArray(l) && l.length)
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
            writeRef(attKey)
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
        // a key without volume / balance plays at 1 / 0 (as the JSON readers take it), not at the event's own
        if (data.audio != null) { out.float(num(e.volume, 1)); out.float(num(e.balance, 0)) }
      }
    }
    return out.bytes()
  }

  // ======================================================================================= 4.x
  /**
   * Spine 4.0 / 4.1 / 4.2 binary from the JSON of that version. 4.1 adds sequences, 4.2 adds
   * `inherit`, physics constraints, flag bytes on constraints and attachments, and skin / event
   * names outside the string table (spine-core 4.x SkeletonBinary).
   */
  function write4(input, version, options) {
    const json = input || fail('没有工程')
    const m = /^(\d+)\.(\d+)/.exec(String(version || '')) || fail(`不认识的 Spine 版本：${version}`)
    if (m[1] !== '4' || Number(m[2]) > 2) fail(`不支持写 Spine ${version} 的二进制`)
    const minor = Number(m[2]), at41 = minor >= 1, at42 = minor >= 2
    const nonessential = !options || options.nonessential !== false
    const out = Output()
    const bones = json.bones || [], slots = json.slots || []
    const boneIndex = new Map(bones.map((b, i) => [b.name, i]))
    const slotIndex = new Map(slots.map((s, i) => [s.name, i]))
    const ik = json.ik || [], transform = json.transform || [], path = json.path || [], physics = at42 ? (json.physics || []) : []
    const ikIndex = new Map(ik.map((c, i) => [c.name, i])), trIndex = new Map(transform.map((c, i) => [c.name, i])), pathIndex = new Map(path.map((c, i) => [c.name, i])), phIndex = new Map(physics.map((c, i) => [c.name, i]))
    const { defaultSkin, otherSkins, defaultHasSlots, skinList, skinListIndex } = skinOrder(json)
    const events = Object.entries(json.events || {})
    const eventIndex = new Map(events.map(([name], i) => [name, i]))
    const animations = Object.entries(json.animations || {})
    /** 4.0 keeps deform timelines under `deform`; 4.1+ under `attachments` (deform + sequence) */
    const attachmentTimelines = (an) => {
      const outMap = {}
      const add = (skin, slot, att, kind, list) => { if (!Array.isArray(list) || !list.length) return; (((outMap[skin] = outMap[skin] || {})[slot] = outMap[skin][slot] || {})[att] = outMap[skin][slot][att] || {})[kind] = list }
      for (const [skin, bySlot] of Object.entries(an.deform || {})) for (const [slot, byAtt] of Object.entries(bySlot || {})) for (const [att, list] of Object.entries(byAtt || {})) add(skin, slot, att, 'deform', list)
      for (const [skin, bySlot] of Object.entries(an.attachments || {})) for (const [slot, byAtt] of Object.entries(bySlot || {})) for (const [att, tls] of Object.entries(byAtt || {})) { add(skin, slot, att, 'deform', tls && tls.deform); if (at41) add(skin, slot, att, 'sequence', tls && tls.sequence) }
      return outMap
    }

    // ---- the string table (readStringRef): attachments, slot attachments, timeline attachment
    // names; skin and event names too before 4.2
    const strings = [], stringAt = new Map()
    const ref = (s) => { if (s == null) return 0; const k = String(s); if (!stringAt.has(k)) { stringAt.set(k, strings.length + 1); strings.push(k) } return stringAt.get(k) }
    for (const s of slots) if (s.attachment) ref(s.attachment)
    if (!at42) for (const sk of otherSkins) ref(sk.name)
    for (const sk of skinList) for (const atts of Object.values(sk.attachments || {})) for (const [key, a] of Object.entries(atts || {})) {
      ref(key); const nm = attName(key, a); if (nm) ref(nm)
      const t = a.type || 'region'
      if ((t === 'region' || t === 'mesh' || t === 'linkedmesh') && a.path && a.path !== (nm || key)) ref(a.path)
      if (t === 'linkedmesh') { if (!at42 && a.skin) ref(a.skin); ref(a.parent) }
    }
    if (!at42) for (const [name] of events) ref(name)
    for (const [, an] of animations) {
      for (const tl of Object.values(an.slots || {})) for (const k of tl.attachment || []) if (k.name != null) ref(k.name)
      for (const bySlot of Object.values(attachmentTimelines(an))) for (const byAtt of Object.values(bySlot)) for (const att of Object.keys(byAtt)) ref(att)
    }

    // ---- header
    const sk0 = json.skeleton || {}
    // Spine 4 JSON carries the hash as base64 of the 8-byte value the binary holds
    const hashBytes = (() => {
      try {
        const s = String(sk0.hash || '').replace(/=+$/, '')
        if (!/^[A-Za-z0-9+/]{11}$/.test(s)) return null
        const bin = typeof atob === 'function' ? atob(s + '=') : Buffer.from(s + '=', 'base64').toString('binary')
        return bin.length === 8 ? Array.from(bin, (c) => c.charCodeAt(0)) : null
      } catch { return null }
    })()
    if (hashBytes) { out.int32((hashBytes[0] << 24) | (hashBytes[1] << 16) | (hashBytes[2] << 8) | hashBytes[3]); out.int32((hashBytes[4] << 24) | (hashBytes[5] << 16) | (hashBytes[6] << 8) | hashBytes[7]) }
    else { out.int32(0); out.int32(0) }
    out.string(/^4\.\d/.test(String(sk0.spine || '')) ? String(sk0.spine) : `4.${minor}.0`)
    out.float(sk0.x); out.float(sk0.y); out.float(sk0.width); out.float(sk0.height)
    if (at42) out.float(num(sk0.referenceScale, 100))
    out.bool(nonessential)
    if (nonessential) { out.float(num(sk0.fps, 30)); out.string(sk0.images || ''); out.string(sk0.audio || '') }
    out.int(strings.length, true)
    for (const s of strings) out.string(s)

    // ---- bones
    out.int(bones.length, true)
    bones.forEach((b, i) => {
      out.string(b.name)
      if (i > 0) { const p = boneIndex.get(b.parent); if (p == null || p >= i) fail(`骨骼 ${b.name} 的父级要排在它前面`); out.int(p, true) }
      out.float(b.rotation); out.float(b.x); out.float(b.y); out.float(num(b.scaleX, 1)); out.float(num(b.scaleY, 1))
      out.float(b.shearX); out.float(b.shearY); out.float(b.length)
      const mode = enumIndex(TRANSFORM_MODES, b.inherit != null ? b.inherit : b.transform, 0)
      if (at42) out.byte(mode); else out.int(mode, true)
      out.bool(!!b.skin)
      if (nonessential) {
        out.int32(rgba8888(b.color, '9b9b9bff'))
        if (at42) { out.string(b.icon == null ? null : String(b.icon)); out.bool(b.visible !== false) }
      }
    })
    // ---- slots
    out.int(slots.length, true)
    for (const s of slots) {
      out.string(s.name)
      out.int(boneIndex.has(s.bone) ? boneIndex.get(s.bone) : fail(`插槽 ${s.name} 的骨骼 ${s.bone} 不存在`), true)
      out.int32(rgba8888(s.color))
      out.int32(s.dark ? rgb888(s.dark) : -1)
      out.int(ref(s.attachment || null), true)
      out.int(enumIndex(BLEND_MODES, s.blend, 0), true)
      if (at42 && nonessential) out.bool(s.visible !== false)
    }
    // ---- constraints
    const boneList = (c) => { out.int((c.bones || []).length, true); for (const b of c.bones || []) out.int(boneIndex.has(b) ? boneIndex.get(b) : fail(`约束 ${c.name} 的骨骼 ${b} 不存在`), true) }
    out.int(ik.length, true)
    for (const c of ik) {
      out.string(c.name); out.int(num(c.order, 0), true)
      if (!at42) out.bool(!!c.skin)
      boneList(c)
      out.int(boneIndex.get(c.target), true)
      const mix = num(c.mix, 1), softness = num(c.softness, 0)
      if (!at42) {
        out.float(mix); out.float(softness)
        out.byte(c.bendPositive === false ? -1 : 1)
        out.bool(!!c.compress); out.bool(!!c.stretch); out.bool(!!c.uniform)
      } else {
        // 4.2: one flag byte; mix 0 = no bits, 1 = bit 32, else bits 32|64 + the value
        let f = (c.skin ? 1 : 0) | (c.bendPositive === false ? 0 : 2) | (c.compress ? 4 : 0) | (c.stretch ? 8 : 0) | (c.uniform ? 16 : 0)
        if (mix !== 0) { f |= 32; if (mix !== 1) f |= 64 }
        if (softness !== 0) f |= 128
        out.byte(f); if (f & 64) out.float(mix); if (f & 128) out.float(softness)
      }
    }
    out.int(transform.length, true)
    for (const c of transform) {
      out.string(c.name); out.int(num(c.order, 0), true)
      if (!at42) out.bool(!!c.skin)
      boneList(c)
      out.int(boneIndex.get(c.target), true)
      const mixX = num(c.mixX, 1), mixScaleX = num(c.mixScaleX, 1)
      const vals = [c.rotation, c.x, c.y, c.scaleX, c.scaleY, c.shearY, num(c.mixRotate, 1), mixX, num(c.mixY, mixX), mixScaleX, num(c.mixScaleY, mixScaleX), num(c.mixShearY, 1)]
      if (!at42) { out.bool(!!c.local); out.bool(!!c.relative); for (const v of vals) out.float(v) }
      else {
        // 4.2: every offset / mix is written behind its flag bit
        out.byte((c.skin ? 1 : 0) | (c.local ? 2 : 0) | (c.relative ? 4 : 0) | 8 | 16 | 32 | 64 | 128)
        for (let i = 0; i < 5; i++) out.float(vals[i])
        out.byte(1 | 2 | 4 | 8 | 16 | 32 | 64)
        for (let i = 5; i < 12; i++) out.float(vals[i])
      }
    }
    out.int(path.length, true)
    for (const c of path) {
      out.string(c.name); out.int(num(c.order, 0), true); out.bool(!!c.skin)
      boneList(c)
      out.int(slotIndex.has(c.target) ? slotIndex.get(c.target) : fail(`路径约束 ${c.name} 的插槽 ${c.target} 不存在`), true)
      const pm = enumIndex(POSITION_MODES, c.positionMode, 1), sm = enumIndex(SPACING_MODES, c.spacingMode, 0), rm = enumIndex(ROTATE_MODES, c.rotateMode, 0)
      if (!at42) { out.int(pm, true); out.int(sm, true); out.int(rm, true); out.float(c.rotation) }
      else { out.byte(pm | (sm << 1) | (rm << 3) | 128); out.float(c.rotation) }
      out.float(c.position); out.float(c.spacing)
      const mixX = num(c.mixX, 1)
      out.float(num(c.mixRotate, 1)); out.float(mixX); out.float(num(c.mixY, mixX))
    }
    if (at42) {
      out.int(physics.length, true)
      for (const c of physics) {
        out.string(c.name); out.int(num(c.order, 0), true)
        out.int(boneIndex.has(c.bone) ? boneIndex.get(c.bone) : fail(`物理约束 ${c.name} 的骨骼 ${c.bone} 不存在`), true)
        out.byte((c.skin ? 1 : 0) | 2 | 4 | 8 | 16 | 32 | 64 | 128)
        out.float(c.x); out.float(c.y); out.float(c.rotate); out.float(c.scaleX); out.float(c.shearX)
        out.float(num(c.limit, 5000))
        out.ubyte(num(c.fps, 60))
        out.float(num(c.inertia, 1)); out.float(num(c.strength, 100)); out.float(num(c.damping, 1))
        out.float(1 / (num(c.mass, 1) || 1))
        out.float(c.wind); out.float(c.gravity)
        out.byte((c.inertiaGlobal ? 1 : 0) | (c.strengthGlobal ? 2 : 0) | (c.dampingGlobal ? 4 : 0) | (c.massGlobal ? 8 : 0) | (c.windGlobal ? 16 : 0) | (c.gravityGlobal ? 32 : 0) | (c.mixGlobal ? 64 : 0) | 128)
        out.float(num(c.mix, 1))
      }
    }

    // ---- skins
    const vertexCountOf = (a) => num(a.vertexCount, (a.vertices || []).length / 2)
    const isWeighted = (a, n) => (a.vertices || []).length !== n * 2
    const writeVertexData = (a, n) => {
      const v = a.vertices || []
      if (!isWeighted(a, n)) { for (let i = 0; i < n * 2; i++) out.float(v[i]); return }
      let k = 0
      for (let i = 0; i < n; i++) {
        const cnt = v[k++] | 0
        out.int(cnt, true)
        for (let j = 0; j < cnt; j++) { out.int(v[k++] | 0, true); out.float(v[k++]); out.float(v[k++]); out.float(v[k++]) }
      }
    }
    // 4.0 / 4.1: weighted flag then the data (the count was written by the caller); 4.2: the count then the data (weighted is a flag bit)
    const writeVertices = (a, n) => { if (at42) { out.int(n, true); writeVertexData(a, n) } else { out.bool(isWeighted(a, n)); writeVertexData(a, n) } }
    const writeShorts = (arr) => { const a = arr || []; out.int(a.length, true); for (const x of a) out.short(x) }
    const writeSequence = (seq) => { out.int(num(seq.count, 0), true); out.int(num(seq.start, 1), true); out.int(num(seq.digits, 0), true); out.int(num(seq.setup, 0), true) }
    const hasColor = (a) => a.color != null && String(a.color).toLowerCase() !== 'ffffffff'
    const writeAttachment = (key, a) => {
      const nm = attName(key, a)
      const t = a.type || 'region'
      if (!(t in ATTACHMENT_TYPES)) fail(`不认识的附件类型：${t}`)
      const type = ATTACHMENT_TYPES[t]
      const name = nm || key
      const pathRef = a.path && a.path !== name ? a.path : null
      const seq = at41 && a.sequence && typeof a.sequence === 'object' ? a.sequence : null
      if (!at42) {
        out.int(ref(nm), true)
        out.byte(type)
        if (t === 'region') {
          out.int(ref(pathRef), true)
          out.float(a.rotation); out.float(a.x); out.float(a.y); out.float(num(a.scaleX, 1)); out.float(num(a.scaleY, 1))
          out.float(a.width); out.float(a.height); out.int32(rgba8888(a.color))
          if (at41) { out.bool(!!seq); if (seq) writeSequence(seq) }
        } else if (t === 'boundingbox') {
          const n = vertexCountOf(a)
          out.int(n, true); writeVertices(a, n); if (nonessential) out.int32(rgba8888(a.color, '60f000ff'))
        } else if (t === 'mesh') {
          out.int(ref(pathRef), true)
          out.int32(rgba8888(a.color))
          const n = (a.uvs || []).length / 2
          out.int(n, true)
          for (let i = 0; i < n * 2; i++) out.float(a.uvs[i])
          writeShorts(a.triangles)
          writeVertices(a, n)
          out.int(num(a.hull, 0), true)
          if (at41) { out.bool(!!seq); if (seq) writeSequence(seq) }
          if (nonessential) { writeShorts(a.edges); out.float(a.width); out.float(a.height) }
        } else if (t === 'linkedmesh') {
          out.int(ref(pathRef), true)
          out.int32(rgba8888(a.color))
          out.int(ref(a.skin || null), true); out.int(ref(a.parent), true)
          // 4.0 JSON calls the flag `deform`, 4.1+ `timelines`
          out.bool(at41 ? a.timelines !== false : a.deform !== false)
          if (at41) { out.bool(!!seq); if (seq) writeSequence(seq) }
          if (nonessential) { out.float(a.width); out.float(a.height) }
        } else if (t === 'path') {
          out.bool(!!a.closed); out.bool(a.constantSpeed !== false)
          const n = vertexCountOf(a)
          out.int(n, true); writeVertices(a, n)
          for (let i = 0; i < n / 3; i++) out.float((a.lengths || [])[i])
          if (nonessential) out.int32(rgba8888(a.color, 'ff7f00ff'))
        } else if (t === 'point') {
          out.float(a.rotation); out.float(a.x); out.float(a.y)
          if (nonessential) out.int32(rgba8888(a.color, 'f1f100ff'))
        } else if (t === 'clipping') {
          out.int(slotIndex.has(a.end) ? slotIndex.get(a.end) : fail(`剪裁 ${name} 的结束插槽 ${a.end} 不存在`), true)
          const n = vertexCountOf(a)
          out.int(n, true); writeVertices(a, n)
          if (nonessential) out.int32(rgba8888(a.color, 'ce3a3aff'))
        }
        return
      }
      // 4.2: a flag byte carries the type, the optional name and the per-type options
      let f = type | (nm ? 8 : 0)
      if (t === 'region') {
        const rot = num(a.rotation, 0)
        f |= (pathRef ? 16 : 0) | (hasColor(a) ? 32 : 0) | (seq ? 64 : 0) | (rot !== 0 ? 128 : 0)
        out.byte(f); if (nm) out.int(ref(nm), true)
        if (pathRef) out.int(ref(pathRef), true)
        if (hasColor(a)) out.int32(rgba8888(a.color))
        if (seq) writeSequence(seq)
        if (rot !== 0) out.float(rot)
        out.float(a.x); out.float(a.y); out.float(num(a.scaleX, 1)); out.float(num(a.scaleY, 1)); out.float(a.width); out.float(a.height)
      } else if (t === 'boundingbox') {
        const n = vertexCountOf(a)
        f |= isWeighted(a, n) ? 16 : 0
        out.byte(f); if (nm) out.int(ref(nm), true)
        writeVertices(a, n); if (nonessential) out.int32(rgba8888(a.color, '60f000ff'))
      } else if (t === 'mesh') {
        const n = (a.uvs || []).length / 2, hull = num(a.hull, 0), tris = a.triangles || []
        // the 4.2 reader derives the triangle count from the vertex and hull counts
        if (tris.length !== (n * 2 - hull - 2) * 3) fail(`网格 ${name} 的三角形数（${tris.length / 3}）和顶点/外壳数不符，写不成 4.2 二进制`)
        f |= (pathRef ? 16 : 0) | (hasColor(a) ? 32 : 0) | (seq ? 64 : 0) | (isWeighted(a, n) ? 128 : 0)
        out.byte(f); if (nm) out.int(ref(nm), true)
        if (pathRef) out.int(ref(pathRef), true)
        if (hasColor(a)) out.int32(rgba8888(a.color))
        if (seq) writeSequence(seq)
        out.int(hull, true)
        writeVertices(a, n)
        for (let i = 0; i < n * 2; i++) out.float(a.uvs[i])
        for (const x of tris) out.int(x | 0, true)
        if (nonessential) { const e = a.edges || []; out.int(e.length, true); for (const x of e) out.int(x | 0, true); out.float(a.width); out.float(a.height) }
      } else if (t === 'linkedmesh') {
        f |= (pathRef ? 16 : 0) | (hasColor(a) ? 32 : 0) | (seq ? 64 : 0) | (a.timelines !== false ? 128 : 0)
        out.byte(f); if (nm) out.int(ref(nm), true)
        if (pathRef) out.int(ref(pathRef), true)
        if (hasColor(a)) out.int32(rgba8888(a.color))
        if (seq) writeSequence(seq)
        const skinIdx = a.skin ? skinListIndex.get(a.skin) : (defaultHasSlots ? 0 : null)
        if (skinIdx == null) fail(`链接网格 ${name} 的皮肤 ${a.skin || 'default'} 不存在`)
        out.int(skinIdx, true); out.int(ref(a.parent), true)
        if (nonessential) { out.float(a.width); out.float(a.height) }
      } else if (t === 'path') {
        const n = vertexCountOf(a)
        f |= (a.closed ? 16 : 0) | (a.constantSpeed !== false ? 32 : 0) | (isWeighted(a, n) ? 64 : 0)
        out.byte(f); if (nm) out.int(ref(nm), true)
        writeVertices(a, n)
        for (let i = 0; i < n / 3; i++) out.float((a.lengths || [])[i])
        if (nonessential) out.int32(rgba8888(a.color, 'ff7f00ff'))
      } else if (t === 'point') {
        out.byte(f); if (nm) out.int(ref(nm), true)
        out.float(a.rotation); out.float(a.x); out.float(a.y)
        if (nonessential) out.int32(rgba8888(a.color, 'f1f100ff'))
      } else if (t === 'clipping') {
        const n = vertexCountOf(a)
        f |= isWeighted(a, n) ? 16 : 0
        out.byte(f); if (nm) out.int(ref(nm), true)
        out.int(slotIndex.has(a.end) ? slotIndex.get(a.end) : fail(`剪裁 ${name} 的结束插槽 ${a.end} 不存在`), true)
        writeVertices(a, n)
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
      if (at42) { out.string(sk.name); if (nonessential) out.int32(rgba8888(sk.color, 'fe9e4fff')) }
      else out.int(ref(sk.name), true)
      out.int((sk.bones || []).length, true); for (const b of sk.bones || []) out.int(boneIndex.get(b), true)
      const cons = (names, index) => { const l = (names || []).filter((n) => index.has(n)); out.int(l.length, true); for (const n of l) out.int(index.get(n), true) }
      cons(sk.ik, ikIndex); cons(sk.transform, trIndex); cons(sk.path, pathIndex)
      if (at42) cons(sk.physics, phIndex)
      writeSkinSlots(sk)
    }

    // ---- events
    out.int(events.length, true)
    for (const [name, e] of events) {
      if (at42) out.string(name); else out.int(ref(name), true)
      out.int(num(e.int, 0), false); out.float(e.float); out.string(e.string == null ? '' : String(e.string))
      out.string(e.audio == null ? null : String(e.audio))
      if (e.audio != null) { out.float(num(e.volume, 1)); out.float(num(e.balance, 0)) }
    }

    // ---- animations
    /** a key's curve to the next key: 'stepped' | [cx1, cy1, cx2, cy2] × K components | none */
    const hasBezier = (k, K) => Array.isArray(k.curve) && k.curve.length >= K * 4
    const bezierCount = (list, K) => list.slice(0, -1).filter((k) => hasBezier(k, K)).length * K
    const writeBeziers = (k, K) => { for (let c = 0; c < K; c++) for (let j = 0; j < 4; j++) out.float(k.curve[c * 4 + j]) }
    const curveByte = (k, K) => { if (k.curve === 'stepped') out.byte(CURVE_STEPPED); else if (hasBezier(k, K)) { out.byte(CURVE_BEZIER); writeBeziers(k, K) } else out.byte(CURVE_LINEAR) }
    /** frames as readTimeline1/2 and the colour readers take them: a key, then the previous key's curve */
    const keyed = (list, K, writeKey) => { out.int(list.length, true); out.int(bezierCount(list, K), true); list.forEach((k, i) => { writeKey(k); if (i > 0) curveByte(list[i - 1], K) }) }
    const timelineCount = (an) => {
      let n = 0
      const count = (group) => { for (const tl of Object.values(group || {})) for (const l of Object.values(tl || {})) if (Array.isArray(l) && l.length) n++ }
      count(an.slots); count(an.bones); count(an.path); if (at42) count(an.physics)
      for (const l of Object.values(an.ik || {})) if (Array.isArray(l) && l.length) n++
      for (const l of Object.values(an.transform || {})) if (Array.isArray(l) && l.length) n++
      for (const bySlot of Object.values(attachmentTimelines(an))) for (const byAtt of Object.values(bySlot)) for (const tls of Object.values(byAtt)) n += Object.keys(tls).length
      if (Array.isArray(an.drawOrder) && an.drawOrder.length) n++
      if (Array.isArray(an.events) && an.events.length) n++
      return n
    }
    out.int(animations.length, true)
    for (const [name, an] of animations) {
      out.string(name)
      out.int(timelineCount(an), true)
      // slots
      const slotTl = Object.entries(an.slots || {}).filter(([s]) => slotIndex.has(s))
      out.int(slotTl.length, true)
      for (const [slot, tl] of slotTl) {
        out.int(slotIndex.get(slot), true)
        const kinds = [['attachment', 0], ['rgba', 1], ['rgb', 2], ['rgba2', 3], ['rgb2', 4], ['alpha', 5]].filter(([k]) => Array.isArray(tl[k]) && tl[k].length)
        out.int(kinds.length, true)
        for (const [kind, type] of kinds) {
          const list = tl[kind]
          out.byte(type)
          if (kind === 'attachment') { out.int(list.length, true); for (const k of list) { out.float(k.time); out.int(ref(k.name == null ? null : k.name), true) } }
          else if (kind === 'rgba') keyed(list, 4, (k) => { out.float(k.time); for (const b of colorBytes(k.color, 4, 'ffffffff')) out.ubyte(b) })
          else if (kind === 'rgb') keyed(list, 3, (k) => { out.float(k.time); for (const b of colorBytes(k.color, 3, 'ffffff')) out.ubyte(b) })
          else if (kind === 'rgba2') keyed(list, 7, (k) => { out.float(k.time); for (const b of colorBytes(k.light, 4, 'ffffffff')) out.ubyte(b); for (const b of colorBytes(k.dark, 3, 'ffffff')) out.ubyte(b) })
          else if (kind === 'rgb2') keyed(list, 6, (k) => { out.float(k.time); for (const b of colorBytes(k.light, 3, 'ffffff')) out.ubyte(b); for (const b of colorBytes(k.dark, 3, 'ffffff')) out.ubyte(b) })
          else keyed(list, 1, (k) => { out.float(k.time); out.ubyte(Math.round(num(k.value, 1) * 255)) })
        }
      }
      // bones
      const BONE_KINDS = [['rotate', 0, 1, 0], ['translate', 1, 2, 0], ['translatex', 2, 1, 0], ['translatey', 3, 1, 0], ['scale', 4, 2, 1], ['scalex', 5, 1, 1], ['scaley', 6, 1, 1], ['shear', 7, 2, 0], ['shearx', 8, 1, 0], ['sheary', 9, 1, 0], ...(at42 ? [['inherit', 10, 0, 0]] : [])]
      const boneTl = Object.entries(an.bones || {}).filter(([b]) => boneIndex.has(b))
      out.int(boneTl.length, true)
      for (const [bone, tl] of boneTl) {
        out.int(boneIndex.get(bone), true)
        const kinds = BONE_KINDS.filter(([k]) => Array.isArray(tl[k]) && tl[k].length)
        out.int(kinds.length, true)
        for (const [kind, type, K, d] of kinds) {
          const list = tl[kind]
          out.byte(type)
          if (kind === 'inherit') { out.int(list.length, true); for (const k of list) { out.float(k.time); out.byte(enumIndex(TRANSFORM_MODES, k.inherit, 0)) } }
          else if (K === 1) keyed(list, 1, (k) => { out.float(k.time); out.float(num(k.value, d)) })
          else keyed(list, 2, (k) => { out.float(k.time); out.float(num(k.x, d)); out.float(num(k.y, d)) })
        }
      }
      // ik
      const ikTl = Object.entries(an.ik || {}).filter(([c]) => ikIndex.has(c) && Array.isArray(an.ik[c]) && an.ik[c].length)
      out.int(ikTl.length, true)
      for (const [c, list] of ikTl) {
        out.int(ikIndex.get(c), true)
        out.int(list.length, true); out.int(bezierCount(list, 2), true)
        list.forEach((k, i) => {
          const mix = num(k.mix, 1), softness = num(k.softness, 0), bend = k.bendPositive !== false
          if (!at42) {
            // time, mix, softness, [the previous key's curve], bend, compress, stretch
            out.float(k.time); out.float(mix); out.float(softness)
            if (i > 0) curveByte(list[i - 1], 2)
            out.byte(bend ? 1 : -1); out.bool(!!k.compress); out.bool(!!k.stretch)
          } else {
            let f = (mix !== 0 ? 1 : 0) | (mix !== 0 && mix !== 1 ? 2 : 0) | (softness !== 0 ? 4 : 0) | (bend ? 8 : 0) | (k.compress ? 16 : 0) | (k.stretch ? 32 : 0)
            const prev = i > 0 ? list[i - 1] : null
            if (prev && prev.curve === 'stepped') f |= 64; else if (prev && hasBezier(prev, 2)) f |= 128
            out.byte(f); out.float(k.time)
            if (f & 2) out.float(mix); if (f & 4) out.float(softness)
            if (f & 128) writeBeziers(prev, 2)
          }
        })
      }
      // transform
      const trTl = Object.entries(an.transform || {}).filter(([c]) => trIndex.has(c) && Array.isArray(an.transform[c]) && an.transform[c].length)
      out.int(trTl.length, true)
      for (const [c, list] of trTl) {
        out.int(trIndex.get(c), true)
        keyed(list, 6, (k) => { const mixX = num(k.mixX, 1), mixScaleX = num(k.mixScaleX, 1); out.float(k.time); out.float(num(k.mixRotate, 1)); out.float(mixX); out.float(num(k.mixY, mixX)); out.float(mixScaleX); out.float(num(k.mixScaleY, mixScaleX)); out.float(num(k.mixShearY, 1)) })
      }
      // path
      const pathTl = Object.entries(an.path || {}).filter(([c]) => pathIndex.has(c))
      out.int(pathTl.length, true)
      for (const [c, tl] of pathTl) {
        out.int(pathIndex.get(c), true)
        const kinds = [['position', 0], ['spacing', 1], ['mix', 2]].filter(([k]) => Array.isArray(tl[k]) && tl[k].length)
        out.int(kinds.length, true)
        for (const [kind, type] of kinds) {
          out.byte(type)
          if (kind === 'mix') keyed(tl[kind], 3, (k) => { const mixX = num(k.mixX, 1); out.float(k.time); out.float(num(k.mixRotate, 1)); out.float(mixX); out.float(num(k.mixY, mixX)) })
          else keyed(tl[kind], 1, (k) => { out.float(k.time); out.float(num(k.value, 0)) })
        }
      }
      // physics (4.2)
      if (at42) {
        const phTl = Object.entries(an.physics || {}).filter(([c]) => phIndex.has(c))
        out.int(phTl.length, true)
        for (const [c, tl] of phTl) {
          out.int(phIndex.get(c) + 1, true) // the reader subtracts one
          const kinds = [['inertia', 0], ['strength', 1], ['damping', 2], ['mass', 4], ['wind', 5], ['gravity', 6], ['mix', 7], ['reset', 8]].filter(([k]) => Array.isArray(tl[k]) && tl[k].length)
          out.int(kinds.length, true)
          for (const [kind, type] of kinds) {
            out.byte(type)
            if (kind === 'reset') { out.int(tl[kind].length, true); for (const k of tl[kind]) out.float(k.time) }
            else keyed(tl[kind], 1, (k) => { out.float(k.time); out.float(num(k.value, 0)) })
          }
        }
      }
      // deform / sequence
      const attTl = Object.entries(attachmentTimelines(an)).filter(([s]) => skinListIndex.has(s))
      out.int(attTl.length, true)
      for (const [skinName, bySlot] of attTl) {
        out.int(skinListIndex.get(skinName), true)
        const slotsD = Object.entries(bySlot).filter(([s]) => slotIndex.has(s))
        out.int(slotsD.length, true)
        for (const [slot, byAtt] of slotsD) {
          out.int(slotIndex.get(slot), true)
          const atts = Object.entries(byAtt).flatMap(([att, tls]) => Object.entries(tls).map(([kind, list]) => [att, kind, list]))
          out.int(atts.length, true)
          for (const [att, kind, list] of atts) {
            out.int(ref(att), true)
            if (at41) out.byte(kind === 'sequence' ? 1 : 0)
            out.int(list.length, true)
            if (kind === 'sequence') {
              let lastDelay = 0
              for (const k of list) {
                const delay = k.delay == null ? lastDelay : num(k.delay, 0)
                out.float(k.time); out.int32((enumIndex(['hold', 'once', 'loop', 'pingpong', 'onceReverse', 'loopReverse', 'pingpongReverse'], k.mode, 0) & 0xf) | (num(k.index, 0) << 4)); out.float(delay)
                lastDelay = delay
              }
              continue
            }
            // deform: the first time, then each frame's vertices followed by the next time and this frame's curve
            out.int(bezierCount(list, 1), true)
            out.float(list[0].time)
            list.forEach((k, i) => {
              const v = k.vertices || []
              out.int(v.length, true)
              if (v.length) { out.int(num(k.offset, 0), true); for (const x of v) out.float(x) }
              if (i < list.length - 1) { out.float(list[i + 1].time); curveByte(k, 1) }
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
        const own = e.string != null && String(e.string) !== String(data.string == null ? '' : data.string)
        if (at42) out.string(own ? String(e.string) : null)
        else { out.bool(own); if (own) out.string(String(e.string)) }
        // a key without volume / balance plays at 1 / 0 (as the JSON readers take it), not at the event's own
        if (data.audio != null) { out.float(num(e.volume, 1)); out.float(num(e.balance, 0)) }
      }
    }
    return out.bytes()
  }

  /** The binary of the JSON's version: '3.7', '3.8', '4.0', '4.1', '4.2' (or `skeleton.spine`). */
  function write(json, version, options) {
    const v = String(version || (json && json.skeleton && json.skeleton.spine) || '3.8')
    const m = /^(\d+)\.(\d+)/.exec(v) || fail(`不认识的 Spine 版本：${v}`)
    if (m[1] === '3' && m[2] === '7') return write37(json, options)
    if (m[1] === '3' && m[2] === '8') return write38(json, options)
    if (m[1] === '4') return write4(json, `${m[1]}.${m[2]}`, options)
    return fail(`不支持写 Spine ${v} 的二进制`)
  }

  return { write, write37, write38, write4 }
})
