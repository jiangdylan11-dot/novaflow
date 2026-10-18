/*
 * Spine 4.x JSON <-> 3.8 JSON, for the 骨骼动画 editor (it edits 3.8 data).
 *
 * toSpine38(json) turns a 4.0 / 4.1 / 4.2 skeleton into 3.8 data the editor and its 3.8
 * runtime understand; fromSpine38(json) turns it back into the version it came in, so an
 * imported 4.x project is exported as 4.x. What 3.8 has no place for rides along untouched:
 *   - whole parts (4.2 physics, 4.1 sequences and their timelines, 4.2 inherit timelines) in
 *     the top-level `nfSpine4` stash;
 *   - per key, the original 4.x curve / values next to the 3.8 ones they became (`nf4`). A key
 *     the editor did not change goes back exactly as it came; a changed one is converted.
 *
 * Format notes (from the 4.0 runtime's reader):
 *   curves     3.8: curve = c1 (number) + c2 c3 c4, normalised, one curve for the whole key;
 *              4.0: curve = [cx1, cy1, cx2, cy2] per value channel, in absolute time / value.
 *   rotate     3.8 { angle } -> 4.0 { value }; path position / spacing { position } -> { value }.
 *   colours    3.8 color / twoColor -> 4.0 rgba / rgb / alpha / rgba2 / rgb2.
 *   mixes      3.8 rotateMix translateMix scaleMix shearMix -> 4.0 mixRotate mixX mixY mixScaleX
 *              mixScaleY mixShearY (constraints and their timelines).
 *   4.1        deform keys live under animation.attachments[skin][slot][att].deform; region /
 *              mesh attachments may carry a sequence.
 *   4.2        bones say `inherit` instead of `transform`; physics constraints.
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowSpineVersion = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  const STASH = 'nfSpine4'
  const KEEP = 'nf4'
  const clone = (v) => JSON.parse(JSON.stringify(v))
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
  const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k)

  function versionOf(json) { return String((json && json.skeleton && json.skeleton.spine) || '') }
  function majorMinor(v) { const m = /^(\d+)\.(\d+)/.exec(String(v || '')); return m ? [Number(m[1]), Number(m[2])] : null }
  function is4(json) { const m = majorMinor(versionOf(json)); return !!(m && m[0] >= 4) }

  // ---------------------------------------------------------------- curves

  /**
   * One 4.x key's curve -> the 3.8 c1..c4 of its liveliest channel. `vals` / `next` are the
   * channel values at this key and the next; channels that do not move say nothing about it.
   */
  function curve38(k4, t1, t2, vals, next) {
    const c = k4.curve
    if (c === 'stepped') return { curve: 'stepped' }
    if (!Array.isArray(c) || !c.length) return null
    const dt = t2 - t1
    if (!(dt > 0)) return null
    let best = -1, span = 0
    for (let i = 0; i < vals.length && i * 4 + 3 < c.length; i++) {
      const d = Math.abs(num(next[i], 0) - num(vals[i], 0))
      if (d > span) { span = d; best = i }
    }
    const ch = best >= 0 ? best : 0
    const o = ch * 4
    const v1 = num(vals[ch], 0), v2 = num(next[ch], 0), dv = v2 - v1
    const nx = (x) => Math.min(1, Math.max(0, (num(c[o + x], t1) - t1) / dt))
    const ny = (y) => (Math.abs(dv) > 1e-9 ? (num(c[o + y], v1) - v1) / dv : null)
    const c1 = nx(0), c3 = nx(2)
    let c2 = ny(1), c4 = ny(3)
    // a channel that stays put: keep the timing shape on the diagonal
    if (c2 == null) c2 = c1
    if (c4 == null) c4 = c3
    const r = (v) => Math.round(v * 1e6) / 1e6
    return { curve: r(c1), c2: r(c2), c3: r(c3), c4: r(c4) }
  }

  /** A 3.8 key's c1..c4 -> the 4.x per-channel curve array. */
  function curve4(k38, t1, t2, vals, next) {
    if (k38.curve === 'stepped') return 'stepped'
    if (!has(k38, 'curve')) return null
    const c1 = num(k38.curve, 0), c2 = num(k38.c2, 0), c3 = num(k38.c3, 1), c4 = num(k38.c4, 1)
    const out = []
    const r = (v) => Math.round(v * 1e6) / 1e6
    for (let i = 0; i < vals.length; i++) {
      const v1 = num(vals[i], 0), v2 = num(next[i], 0)
      out.push(r(t1 + c1 * (t2 - t1)), r(v1 + c2 * (v2 - v1)), r(t1 + c3 * (t2 - t1)), r(v1 + c4 * (v2 - v1)))
    }
    return out
  }

  const curveFields = (k) => (k.curve === 'stepped' ? { curve: 'stepped' } : has(k, 'curve') ? { curve: k.curve, c2: k.c2, c3: k.c3, c4: k.c4 } : {})
  const sameCurve = (a, b) => JSON.stringify(curveFields(a)) === JSON.stringify(curveFields(b))

  /**
   * Convert one timeline (array of keys). `read4(k)` / `read38(k)` give the channel values,
   * `body38(k4)` / `body4(k38)` the key fields other than time and curve.
   */
  function keys4to38(list, spec) {
    if (!Array.isArray(list)) return list
    return list.map((k, i) => {
      const nextK = list[i + 1]
      const t1 = num(k.time, 0)
      const out = { ...(has(k, 'time') ? { time: k.time } : {}), ...spec.body38(k) }
      if (nextK) {
        const cv = curve38(k, t1, num(nextK.time, 0), spec.unit ? [0] : spec.read4(k), spec.unit ? [1] : spec.read4(nextK))
        if (cv) Object.assign(out, cv)
      }
      // the original key, to go back unchanged when the editor leaves this one alone
      out[KEEP] = { k4: clone(k), k38: { ...out } }
      return out
    })
  }

  function keys38to4(list, spec) {
    if (!Array.isArray(list)) return list
    return list.map((k, i) => {
      const kept = k[KEEP]
      const plain = { ...k }
      delete plain[KEEP]
      if (kept && JSON.stringify(plain) === JSON.stringify(kept.k38)) {
        // untouched since the import, except maybe the curve's neighbours: check the next key too
        const nextK = list[i + 1]
        const nextSame = !nextK || (nextK[KEEP] && JSON.stringify(stripKeep(nextK)) === JSON.stringify(nextK[KEEP].k38))
        if (nextSame) return clone(kept.k4)
      }
      const nextK = list[i + 1]
      const out = { ...(has(plain, 'time') ? { time: plain.time } : {}), ...spec.body4(plain) }
      if (nextK) {
        const cv = curve4(plain, num(plain.time, 0), num(nextK.time, 0), spec.unit ? [0] : spec.read38(plain), spec.unit ? [1] : spec.read38(stripKeep(nextK)))
        if (cv) out.curve = cv
      }
      return out
    })
  }
  const stripKeep = (k) => { const c = { ...k }; delete c[KEEP]; return c }

  // ---------------------------------------------------------------- timeline specs

  const copyExcept = (k, drop) => { const o = {}; for (const [n, v] of Object.entries(k)) if (n !== 'time' && n !== 'curve' && n !== 'c2' && n !== 'c3' && n !== 'c4' && n !== KEEP && n !== 'nfCurves' && !drop.includes(n)) o[n] = v; return o }

  const ROTATE = {
    read4: (k) => [num(k.value, 0)], read38: (k) => [num(k.angle, 0)],
    body38: (k) => { const o = copyExcept(k, ['value']); if (has(k, 'value')) o.angle = k.value; return o },
    body4: (k) => { const o = copyExcept(k, ['angle']); if (has(k, 'angle')) o.value = k.angle; return o },
  }
  const XY = (d) => ({
    read4: (k) => [num(k.x, d), num(k.y, d)], read38: (k) => [num(k.x, d), num(k.y, d)],
    body38: (k) => copyExcept(k, []), body4: (k) => copyExcept(k, []),
  })
  const IK = {
    read4: (k) => [num(k.mix, 1), num(k.softness, 0)], read38: (k) => [num(k.mix, 1), num(k.softness, 0)],
    body38: (k) => copyExcept(k, []), body4: (k) => copyExcept(k, []),
  }
  const TRANSFORM = {
    read4: (k) => [num(k.mixRotate, 1), num(k.mixX, 1), num(k.mixY, num(k.mixX, 1)), num(k.mixScaleX, 1), num(k.mixScaleY, num(k.mixScaleX, 1)), num(k.mixShearY, 1)],
    read38: (k) => { const t = num(k.translateMix, 1), s = num(k.scaleMix, 1); return [num(k.rotateMix, 1), t, t, s, s, num(k.shearMix, 1)] },
    body38: (k) => {
      const o = copyExcept(k, ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'])
      if (has(k, 'mixRotate')) o.rotateMix = k.mixRotate
      if (has(k, 'mixX')) o.translateMix = k.mixX
      if (has(k, 'mixScaleX')) o.scaleMix = k.mixScaleX
      if (has(k, 'mixShearY')) o.shearMix = k.mixShearY
      return o
    },
    body4: (k) => {
      const o = copyExcept(k, ['rotateMix', 'translateMix', 'scaleMix', 'shearMix'])
      if (has(k, 'rotateMix')) o.mixRotate = k.rotateMix
      if (has(k, 'translateMix')) { o.mixX = k.translateMix; o.mixY = k.translateMix }
      if (has(k, 'scaleMix')) { o.mixScaleX = k.scaleMix; o.mixScaleY = k.scaleMix }
      if (has(k, 'shearMix')) o.mixShearY = k.shearMix
      return o
    },
  }
  const PATH_MIX = {
    read4: (k) => [num(k.mixRotate, 1), num(k.mixX, 1), num(k.mixY, num(k.mixX, 1))],
    read38: (k) => { const t = num(k.translateMix, 1); return [num(k.rotateMix, 1), t, t] },
    body38: (k) => { const o = copyExcept(k, ['mixRotate', 'mixX', 'mixY']); if (has(k, 'mixRotate')) o.rotateMix = k.mixRotate; if (has(k, 'mixX')) o.translateMix = k.mixX; return o },
    body4: (k) => { const o = copyExcept(k, ['rotateMix', 'translateMix']); if (has(k, 'rotateMix')) o.mixRotate = k.rotateMix; if (has(k, 'translateMix')) { o.mixX = k.translateMix; o.mixY = k.translateMix } return o },
  }
  const PATH_VALUE = (name) => ({
    read4: (k) => [num(k.value, 0)], read38: (k) => [num(k[name], 0)],
    body38: (k) => { const o = copyExcept(k, ['value']); if (has(k, 'value')) o[name] = k.value; return o },
    body4: (k) => { const o = copyExcept(k, [name]); if (has(k, name)) o.value = k[name]; return o },
  })
  // deform: one channel running 0 -> 1 between keys (the vertices blend by it)
  const DEFORM = {
    unit: true,
    body38: (k) => copyExcept(k, []), body4: (k) => copyExcept(k, []),
  }

  // colour keys: hex strings, channels r g b a (light) + r g b (dark)
  const hexCh = (hex, n) => { const s = String(hex || 'ffffffff').padEnd(8, 'f'); const out = []; for (let i = 0; i < n; i++) out.push(parseInt(s.slice(i * 2, i * 2 + 2), 16) / 255); return out }
  const COLOR = (keyName, n) => ({
    read4: (k) => hexCh(k[keyName], n), read38: (k) => hexCh(k[keyName], n),
    body38: (k) => copyExcept(k, []), body4: (k) => copyExcept(k, []),
  })
  const TWO = {
    read4: (k) => [...hexCh(k.light, 4), ...hexCh(k.dark, 3)], read38: (k) => [...hexCh(k.light, 4), ...hexCh(k.dark, 3)],
    body38: (k) => copyExcept(k, []), body4: (k) => copyExcept(k, []),
  }

  // ---------------------------------------------------------------- split / merged channels

  /** 4.x x / y split timelines (translatex ...) -> one 3.8 xy timeline sampled at every key. */
  function mergeXY(xs, ys, d) {
    const at = (list, t) => {
      if (!list || !list.length) return d
      if (t <= num(list[0].time, 0)) return num(list[0].value, d)
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i], b = list[i + 1], ta = num(a.time, 0), tb = num(b.time, 0)
        if (t <= tb) {
          if (a.curve === 'stepped') return num(a.value, d)
          const u = tb > ta ? (t - ta) / (tb - ta) : 0
          return num(a.value, d) + (num(b.value, d) - num(a.value, d)) * u
        }
      }
      return num(list[list.length - 1].value, d)
    }
    const times = [...new Set([...(xs || []), ...(ys || [])].map((k) => num(k.time, 0)))].sort((a, b) => a - b)
    return times.map((t) => ({ ...(t ? { time: t } : {}), x: at(xs, t), y: at(ys, t) }))
  }

  // ---------------------------------------------------------------- 4.x -> 3.8

  const VERSIONS = { '3.8': '3.8.99', '4.0': '4.0.64', '4.1': '4.1.24', '4.2': '4.2.19' }
  const TARGETS = Object.keys(VERSIONS)
  const short = (v) => { const m = majorMinor(v); return m ? `${m[0]}.${m[1]}` : '' }

  /** 3.7 and older wrote a key's curve as [c1, c2, c3, c4]; 3.8 spreads it over curve / c2 / c3 / c4. */
  function upgradeOld3(json) {
    const walk = (v) => {
      if (Array.isArray(v)) { for (const k of v) if (k && typeof k === 'object') { if (Array.isArray(k.curve) && k.curve.length === 4) { const [c1, c2, c3, c4] = k.curve; k.curve = c1; if (c2) k.c2 = c2; else delete k.c2; if (c3 !== 1) k.c3 = c3; else delete k.c3; if (c4 !== 1) k.c4 = c4; else delete k.c4 } walk(k) } }
      else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x)
    }
    walk(json.animations || {})
    if (json.skins && !Array.isArray(json.skins)) json.skins = Object.entries(json.skins).map(([name, attachments]) => ({ name, attachments }))
    json.skeleton = { ...(json.skeleton || {}), spine: '3.8.99' }
    return json
  }

  function toSpine38(input) {
    const json = clone(input)
    const version = versionOf(json)
    if (!is4(json)) {
      const m = majorMinor(version)
      // 3.7 and older open as 3.8 (same data, the curves spread out); a file with no version is taken as 3.8
      return m && m[0] === 3 && m[1] < 8 ? upgradeOld3(json) : json
    }
    const mm = majorMinor(version)
    const stash = { version, physics: null, sequences: {}, attachmentTimelines: {}, animationExtras: {}, constraints: {}, bones: {} }
    json.skeleton = { ...(json.skeleton || {}), spine: '3.8.99' }

    // bones: 4.2 inherit -> transform
    for (const b of json.bones || []) {
      if (has(b, 'inherit')) { stash.bones[b.name] = { inherit: b.inherit }; b.transform = b.inherit; delete b.inherit }
    }
    // constraints
    for (const c of json.transform || []) {
      stash.constraints['transform:' + c.name] = pick(c, ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'])
      if (has(c, 'mixRotate')) c.rotateMix = c.mixRotate
      if (has(c, 'mixX')) c.translateMix = c.mixX
      if (has(c, 'mixScaleX')) c.scaleMix = c.mixScaleX
      if (has(c, 'mixShearY')) c.shearMix = c.mixShearY
      for (const k of ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY']) delete c[k]
    }
    for (const c of json.path || []) {
      stash.constraints['path:' + c.name] = pick(c, ['mixRotate', 'mixX', 'mixY', 'spacingMode'])
      if (has(c, 'mixRotate')) c.rotateMix = c.mixRotate
      if (has(c, 'mixX')) c.translateMix = c.mixX
      for (const k of ['mixRotate', 'mixX', 'mixY']) delete c[k]
      if (c.spacingMode === 'proportional') c.spacingMode = 'percent'
    }
    if (has(json, 'physics')) { stash.physics = json.physics; delete json.physics }

    // skins: 4.1 sequences -> the first frame's picture
    const skins = Array.isArray(json.skins) ? json.skins : Object.entries(json.skins || {}).map(([name, attachments]) => ({ name, attachments }))
    json.skins = skins
    for (const skin of skins) {
      for (const [slot, map] of Object.entries(skin.attachments || {})) {
        for (const [name, att] of Object.entries(map || {})) {
          if (!att || !att.sequence) continue
          const seq = att.sequence
          const base = att.path || name
          stash.sequences[`${skin.name}/${slot}/${name}`] = { sequence: seq, path: has(att, 'path') ? att.path : undefined, basePath: base }
          const idx = num(seq.start, 1) + num(seq.setup, 0)
          att.path = base + String(idx).padStart(num(seq.digits, 0), '0')
          delete att.sequence
        }
      }
    }

    // animations
    for (const [an, a] of Object.entries(json.animations || {})) {
      const extras = {}
      for (const [bone, tl] of Object.entries(a.bones || {})) {
        const next = {}
        for (const [kind, list] of Object.entries(tl || {})) {
          if (kind === 'rotate') next.rotate = keys4to38(list, ROTATE)
          else if (kind === 'translate') next.translate = keys4to38(list, XY(0))
          else if (kind === 'scale') next.scale = keys4to38(list, XY(1))
          else if (kind === 'shear') next.shear = keys4to38(list, XY(0))
          else if (kind === 'inherit') { (extras.inherit = extras.inherit || {})[bone] = list }
        }
        // split channels (Spine 4: translatex / translatey ...) sampled into one xy timeline
        for (const [base, d] of [['translate', 0], ['scale', 1], ['shear', 0]]) {
          const xs = tl[base + 'x'], ys = tl[base + 'y']
          if (!xs && !ys) continue
          ;(extras.split = extras.split || {})[`${bone}/${base}`] = { x: xs || null, y: ys || null }
          if (!next[base]) next[base] = mergeXY(xs, ys, d)
        }
        a.bones[bone] = next
      }
      for (const [slot, tl] of Object.entries(a.slots || {})) {
        const next = {}
        const setup = (json.slots || []).find((s) => s.name === slot) || {}
        const setupColor = String(setup.color || 'ffffffff')
        for (const [kind, list] of Object.entries(tl || {})) {
          if (kind === 'attachment') next.attachment = list
          else if (kind === 'rgba') next.color = keys4to38(list, COLOR('color', 4))
          else if (kind === 'rgba2') next.twoColor = keys4to38(list, TWO)
          else if (kind === 'rgb2') next.twoColor = keys4to38(list.map((k) => ({ ...k, light: String(k.light || 'ffffff').slice(0, 6) + 'ff' })), TWO)
        }
        // rgb and alpha apart: one 3.8 colour timeline over both
        if ((tl.rgb || tl.alpha) && !next.color) {
          ;(extras.split = extras.split || {})[`slot:${slot}`] = { rgb: tl.rgb || null, alpha: tl.alpha || null }
          const times = [...new Set([...(tl.rgb || []), ...(tl.alpha || [])].map((k) => num(k.time, 0)))].sort((x, y) => x - y)
          const rgbAt = (t) => { let c = setupColor.slice(0, 6); for (const k of tl.rgb || []) if (num(k.time, 0) <= t) c = String(k.color || c).slice(0, 6); return c }
          const aAt = (t) => { const l = tl.alpha || []; if (!l.length) return parseInt(setupColor.slice(6, 8) || 'ff', 16) / 255; let v = num(l[0].value, 1); for (let i = 0; i < l.length; i++) if (num(l[i].time, 0) <= t) { const b = l[i + 1]; v = num(l[i].value, 1); if (b && num(b.time, 0) > t && l[i].curve !== 'stepped') { const u = (t - num(l[i].time, 0)) / (num(b.time, 0) - num(l[i].time, 0)); v += (num(b.value, 1) - v) * u } } return v }
          next.color = times.map((t) => ({ ...(t ? { time: t } : {}), color: rgbAt(t) + Math.round(Math.max(0, Math.min(1, aAt(t))) * 255).toString(16).padStart(2, '0') }))
        }
        a.slots[slot] = next
      }
      for (const [name, list] of Object.entries(a.ik || {})) a.ik[name] = keys4to38(list, IK)
      for (const [name, list] of Object.entries(a.transform || {})) a.transform[name] = keys4to38(list, TRANSFORM)
      for (const [name, tl] of Object.entries(a.path || {})) {
        const next = {}
        for (const [kind, list] of Object.entries(tl || {})) {
          if (kind === 'mix') next.mix = keys4to38(list, PATH_MIX)
          else if (kind === 'position' || kind === 'spacing') next[kind] = keys4to38(list, PATH_VALUE(kind))
        }
        a.path[name] = next
      }
      // 4.0 deform; 4.1+ attachment timelines (deform + sequence)
      const deformOut = {}
      const addDeform = (skin, slot, att, list) => { ((deformOut[skin] = deformOut[skin] || {})[slot] = deformOut[skin][slot] || {})[att] = keys4to38(list, DEFORM) }
      for (const [skin, slots] of Object.entries(a.deform || {})) for (const [slot, atts] of Object.entries(slots || {})) for (const [att, list] of Object.entries(atts || {})) addDeform(skin, slot, att, list)
      if (a.attachments) {
        for (const [skin, slots] of Object.entries(a.attachments)) for (const [slot, atts] of Object.entries(slots || {})) for (const [att, tls] of Object.entries(atts || {})) {
          if (tls && tls.deform) addDeform(skin, slot, att, tls.deform)
          if (tls && tls.sequence) (stash.attachmentTimelines[an] = stash.attachmentTimelines[an] || []).push({ skin, slot, att, sequence: tls.sequence })
        }
        delete a.attachments
      }
      if (Object.keys(deformOut).length) a.deform = deformOut
      else delete a.deform
      if (a.physics) { extras.physics = a.physics; delete a.physics }
      if (Object.keys(extras).length) stash.animationExtras[an] = extras
    }
    json[STASH] = stash
    if (mm && mm[0] === 4 && mm[1] === 0) { /* 4.0: nothing else */ }
    return json
  }

  const pick = (o, keys) => { const r = {}; for (const k of keys) if (has(o, k)) r[k] = o[k]; return r }

  // ---------------------------------------------------------------- 3.8 -> 4.x

  /**
   * 3.8 data out as `target` ('3.8' | '4.0' | '4.1' | '4.2'; none = the version the file came
   * in as, 3.8 for a native 3.8 file). A 4.x key the editor did not touch goes back exactly;
   * everything else is converted.
   */
  function fromSpine38(input, targetVersion) {
    const expanded = globalThis.NovaFlowMotionAnimation?.expandAxisCurves(input) || input
    const axisCurves = expanded !== input
    const json = clone(expanded)
    const stash = json[STASH] || null
    delete json[STASH]
    const own = stash ? stash.version : '3.8.99'
    const target = short(targetVersion || own) || '3.8'
    if (!VERSIONS[target]) throw new Error(`不支持导出为 Spine ${target}`)
    if (target === '3.8') { json.skeleton = { ...(json.skeleton || {}), spine: short(own) === '3.8' && own ? own : '3.8.99' }; stripKeeps(json); return axisCurves ? (globalThis.NovaFlowSpineExportOptimizer?.optimize(json).project || json) : json }
    const mm = majorMinor(target)
    const at41 = mm[0] > 4 || (mm[0] === 4 && mm[1] >= 1)
    const at42 = mm[0] > 4 || (mm[0] === 4 && mm[1] >= 2)
    json.skeleton = { ...(json.skeleton || {}), spine: short(own) === target ? own : VERSIONS[target] }
    const S = stash || { constraints: {}, sequences: {}, attachmentTimelines: {}, animationExtras: {}, physics: null }

    for (const b of json.bones || []) {
      if (at42 && has(b, 'transform')) { b.inherit = b.transform; delete b.transform }
    }
    for (const c of json.transform || []) {
      const was = S.constraints['transform:' + c.name] || {}
      const r = num(c.rotateMix, 1), t = num(c.translateMix, 1), s = num(c.scaleMix, 1), sh = num(c.shearMix, 1)
      const same = num(was.mixRotate, 1) === r && num(was.mixX, 1) === t && num(was.mixScaleX, 1) === s && num(was.mixShearY, 1) === sh
      for (const k of ['rotateMix', 'translateMix', 'scaleMix', 'shearMix']) delete c[k]
      if (same) Object.assign(c, was)
      else {
        if (r !== 1) c.mixRotate = r
        if (t !== 1) { c.mixX = t; c.mixY = t }
        if (s !== 1) { c.mixScaleX = s; c.mixScaleY = s }
        if (sh !== 1) c.mixShearY = sh
      }
    }
    for (const c of json.path || []) {
      const was = S.constraints['path:' + c.name] || {}
      const r = num(c.rotateMix, 1), t = num(c.translateMix, 1)
      const same = num(was.mixRotate, 1) === r && num(was.mixX, 1) === t
      delete c.rotateMix; delete c.translateMix
      if (same) { for (const k of ['mixRotate', 'mixX', 'mixY']) if (has(was, k)) c[k] = was[k] }
      else { if (r !== 1) c.mixRotate = r; if (t !== 1) { c.mixX = t; c.mixY = t } }
      if (was.spacingMode === 'proportional' && c.spacingMode === 'percent') c.spacingMode = 'proportional'
    }
    if (at42 && S.physics) json.physics = S.physics

    for (const skin of json.skins || []) {
      for (const [slot, map] of Object.entries(skin.attachments || {})) {
        for (const [name, att] of Object.entries(map || {})) {
          const seq = S.sequences[`${skin.name}/${slot}/${name}`]
          if (!seq || !att || !at41) continue
          att.sequence = seq.sequence
          if (seq.path === undefined) delete att.path
          else att.path = seq.path
        }
      }
    }

    for (const [an, a] of Object.entries(json.animations || {})) {
      const extras = S.animationExtras[an] || {}
      const split = extras.split || {}
      for (const [bone, tl] of Object.entries(a.bones || {})) {
        const next = {}
        for (const [kind, list] of Object.entries(tl || {})) {
          if (kind === 'rotate') next.rotate = keys38to4(list, ROTATE)
          else if (kind === 'translate' || kind === 'scale' || kind === 'shear') {
            const sp = split[`${bone}/${kind}`]
            // a split timeline the editor left alone goes back split
            if (sp && Array.isArray(list) && JSON.stringify(list.map(stripKeep)) === JSON.stringify(mergeXY(sp.x, sp.y, kind === 'scale' ? 1 : 0))) {
              if (sp.x) next[kind + 'x'] = sp.x
              if (sp.y) next[kind + 'y'] = sp.y
            } else next[kind] = keys38to4(list, XY(kind === 'scale' ? 1 : 0))
          }
        }
        if (extras.inherit && extras.inherit[bone]) next.inherit = extras.inherit[bone]
        a.bones[bone] = next
      }
      if (extras.inherit) for (const [bone, list] of Object.entries(extras.inherit)) if (!a.bones || !a.bones[bone]) ((a.bones = a.bones || {})[bone] = {}).inherit = list
      for (const [slot, tl] of Object.entries(a.slots || {})) {
        const next = {}
        for (const [kind, list] of Object.entries(tl || {})) {
          if (kind === 'attachment') next.attachment = list
          else if (kind === 'color') {
            const sp = split[`slot:${slot}`]
            if (sp && Array.isArray(list) && !list.some((k) => k[KEEP])) {
              // the merged rgb + alpha, untouched (its keys never carried originals): put them back apart
              if (sp.rgb) next.rgb = sp.rgb
              if (sp.alpha) next.alpha = sp.alpha
            } else next.rgba = keys38to4(list, COLOR('color', 4))
          } else if (kind === 'twoColor') next.rgba2 = keys38to4(list, TWO)
        }
        a.slots[slot] = next
      }
      for (const [name, list] of Object.entries(a.ik || {})) a.ik[name] = keys38to4(list, IK)
      for (const [name, list] of Object.entries(a.transform || {})) a.transform[name] = keys38to4(list, TRANSFORM)
      for (const [name, tl] of Object.entries(a.path || {})) {
        const next = {}
        for (const [kind, list] of Object.entries(tl || {})) {
          if (kind === 'mix') next.mix = keys38to4(list, PATH_MIX)
          else if (kind === 'position' || kind === 'spacing') next[kind] = keys38to4(list, PATH_VALUE(kind))
        }
        a.path[name] = next
      }
      if (a.deform) {
        const conv = {}
        for (const [skin, slots] of Object.entries(a.deform)) for (const [slot, atts] of Object.entries(slots || {})) for (const [att, list] of Object.entries(atts || {})) ((conv[skin] = conv[skin] || {})[slot] = conv[skin][slot] || {})[att] = keys38to4(list, DEFORM)
        if (at41) {
          delete a.deform
          a.attachments = a.attachments || {}
          for (const [skin, slots] of Object.entries(conv)) for (const [slot, atts] of Object.entries(slots)) for (const [att, list] of Object.entries(atts)) (((a.attachments[skin] = a.attachments[skin] || {})[slot] = a.attachments[skin][slot] || {})[att] = a.attachments[skin][slot][att] || {}).deform = list
        } else a.deform = conv
      }
      for (const t of (at41 && S.attachmentTimelines[an]) || []) {
        a.attachments = a.attachments || {}
        ;(((a.attachments[t.skin] = a.attachments[t.skin] || {})[t.slot] = a.attachments[t.skin][t.slot] || {})[t.att] = a.attachments[t.skin][t.slot][t.att] || {}).sequence = t.sequence
      }
      if (at42 && extras.physics) a.physics = extras.physics
    }
    stripKeeps(json)
    return axisCurves ? (globalThis.NovaFlowSpineExportOptimizer?.optimize(json).project || json) : json
  }

  /** The editor's own 3.8 data never keeps the 4.x originals once it leaves for a 3.8 file. */
  function stripKeeps(json) {
    for (const a of Object.values(json.animations || {})) {
      const walk = (v) => {
        if (Array.isArray(v)) { for (const k of v) if (k && typeof k === 'object') { delete k[KEEP]; walk(k) } }
        else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x)
      }
      walk(a)
    }
    return json
  }

  // ---------------------------------------------------------------- atlas text

  /**
   * Any Spine atlas (3.x positional page lines, or 4.x `key: value` lines with bounds / offsets /
   * pma / scale) as the 3.8 layout the 3.8 runtime reads. Returns { text, pma }.
   */
  function atlasToSpine38(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
    const pages = []
    let page = null, region = null, pma = false
    const entry = (line) => {
      const i = line.indexOf(':')
      if (i < 0) return null
      return { key: line.slice(0, i).trim().toLowerCase(), vals: line.slice(i + 1).split(',').map((v) => v.trim()) }
    }
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) { page = null; region = null; continue }
      const e = entry(line)
      if (!page) { page = { name: line, width: 0, height: 0, format: 'RGBA8888', filter: 'Linear,Linear', repeat: 'none', regions: [] }; pages.push(page); region = null; continue }
      if (!e) { region = { name: line, rotate: 'false', x: 0, y: 0, width: 0, height: 0, ox: 0, oy: 0, ow: null, oh: null, index: -1 }; page.regions.push(region); continue }
      const v = e.vals
      if (!region) {
        if (e.key === 'size') { page.width = Number(v[0]) || 0; page.height = Number(v[1]) || 0 }
        else if (e.key === 'format') page.format = v[0] || 'RGBA8888'
        else if (e.key === 'filter') page.filter = (v[0] || 'Linear') + ',' + (v[1] || v[0] || 'Linear')
        else if (e.key === 'repeat') page.repeat = v[0] || 'none'
        else if (e.key === 'pma') { page.pma = v[0] === 'true'; pma = pma || page.pma }
        // scale and anything else: not part of the 3.8 layout
      } else {
        if (e.key === 'rotate') region.rotate = v[0] === 'true' ? 'true' : v[0] === 'false' ? 'false' : String(Number(v[0]) || 0) === '0' ? 'false' : String(Number(v[0]) === 90 ? 'true' : Number(v[0]))
        else if (e.key === 'xy') { region.x = Number(v[0]) || 0; region.y = Number(v[1]) || 0 }
        else if (e.key === 'size') { region.width = Number(v[0]) || 0; region.height = Number(v[1]) || 0 }
        else if (e.key === 'bounds') { region.x = Number(v[0]) || 0; region.y = Number(v[1]) || 0; region.width = Number(v[2]) || 0; region.height = Number(v[3]) || 0 }
        else if (e.key === 'offset') { region.ox = Number(v[0]) || 0; region.oy = Number(v[1]) || 0 }
        else if (e.key === 'orig') { region.ow = Number(v[0]) || 0; region.oh = Number(v[1]) || 0 }
        else if (e.key === 'offsets') { region.ox = Number(v[0]) || 0; region.oy = Number(v[1]) || 0; region.ow = Number(v[2]) || 0; region.oh = Number(v[3]) || 0 }
        else if (e.key === 'index') region.index = Number(v[0]) || -1
        else if (e.key === 'split' || e.key === 'pad') region[e.key] = v.join(', ')
      }
    }
    const out = []
    for (const p of pages) {
      out.push(p.name, `size: ${p.width},${p.height}`, `format: ${p.format}`, `filter: ${p.filter}`, `repeat: ${p.repeat}`)
      for (const r of p.regions) {
        out.push(r.name, `  rotate: ${r.rotate}`, `  xy: ${r.x}, ${r.y}`, `  size: ${r.width}, ${r.height}`)
        if (r.split) out.push(`  split: ${r.split}`)
        if (r.pad) out.push(`  pad: ${r.pad}`)
        out.push(`  orig: ${r.ow == null ? r.width : r.ow}, ${r.oh == null ? r.height : r.oh}`, `  offset: ${r.ox}, ${r.oy}`, `  index: ${r.index}`)
      }
      out.push('')
    }
    return { text: out.join('\n'), pma, pages: pages.length }
  }

  return { STASH, KEEP, VERSIONS, TARGETS, versionOf, is4, short, toSpine38, fromSpine38, stripKeeps, curve38, curve4, atlasToSpine38 }
})
