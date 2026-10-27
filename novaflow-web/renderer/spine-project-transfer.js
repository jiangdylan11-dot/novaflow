/* Cross-project setup data. Animations stay with their original project. */
(function (root) {
  'use strict'
  const clone = (value) => JSON.parse(JSON.stringify(value))
  const unique = (taken, name) => { let out = name, n = 2; while (taken.has(out)) out = `${name}_${n++}`; taken.add(out); return out }
  const picture = (key, att) => !['boundingbox', 'clipping', 'path', 'point'].includes(att.type) ? att.path || att.name || key : null
  function collect(source, names, ops = root.NovaFlowSpineStructureOps) {
    const json = ops.prepare(source), selected = new Set()
    for (const name of names) {
      if (!json.bones.some((b) => b.name === name)) throw Error('找不到骨骼：' + name)
      for (const n of ops.branch(json, name)) selected.add(n)
    }
    if (!selected.size) throw Error('先选择要复制的骨骼')
    const selectedIndexes = new Set(json.bones.map((b, i) => selected.has(b.name) ? i : -1))
    const slots = json.slots.filter((slot) => {
      if (selected.has(slot.bone)) return true
      let weight = 0, total = 0
      for (const sk of json.skins) for (const att of Object.values(sk.attachments[slot.name] || {})) if (ops.isWeighted(att)) {
        for (let i = 0; i < att.vertices.length;) { const n = att.vertices[i++]; for (let k = 0; k < n; k++, i += 4) { total += att.vertices[i + 3]; if (selectedIndexes.has(att.vertices[i])) weight += att.vertices[i + 3] } }
      }
      return total > 0 && weight / total >= .5
    })
    const bones = new Set(selected), slotNames = new Set(slots.map((s) => s.name)), images = new Set()
    const dependency = (name) => { let b = json.bones.find((b) => b.name === name); while (b && !bones.has(b.name)) { bones.add(b.name); b = json.bones.find((p) => p.name === b.parent) } }
    for (const sk of json.skins) for (const [slot, map] of Object.entries(sk.attachments)) if (slotNames.has(slot)) for (const [key, att] of Object.entries(map)) {
      const path = picture(key, att); if (path) images.add(path)
      for (const index of ops.weightBones(att)) { if (!json.bones[index]) throw Error('网格权重引用了不存在的骨骼'); dependency(json.bones[index].name) }
    }
    for (const slot of slots) if (!bones.has(slot.bone)) dependency(slot.bone)
    return { json, bones, slots, images }
  }
  function transfer(source, target, names, options = {}) {
    const ops = root.NovaFlowSpineStructureOps
    const part = collect(source, names, ops), src = part.json, json = ops.prepare(target)
    const parent = options.parent || (json.bones.find((b) => !b.parent) || {}).name
    if (!json.bones.some((b) => b.name === parent)) throw Error('目标工程没有这根父骨骼')
    const takenBones = new Set(json.bones.map((b) => b.name)), takenSlots = new Set(json.slots.map((s) => s.name))
    const boneMap = new Map(), indexes = new Map(), slotMap = new Map(), imageMap = new Map()
    const ordered = src.bones.filter((b) => part.bones.has(b.name))
    for (const b of ordered) { boneMap.set(b.name, unique(takenBones, b.name)); indexes.set(src.bones.indexOf(b), json.bones.length + boneMap.size - 1) }
    for (const b of ordered) {
      const copy = clone(b); copy.name = boneMap.get(b.name); copy.parent = boneMap.get(b.parent) || parent
      if (!boneMap.has(b.parent) && options.sourceMatrices && options.sourceMatrices[b.name] && options.parentMatrix && (!b.transform || b.transform === 'normal')) Object.assign(copy, ops.localFromWorld(options.sourceMatrices[b.name], options.parentMatrix))
      json.bones.push(copy)
    }
    for (const s of part.slots) { const copy = clone(s); copy.name = unique(takenSlots, s.name); copy.bone = boneMap.get(s.bone); slotMap.set(s.name, copy.name); json.slots.push(copy) }
    const paths = new Set(options.imageNames || [])
    for (const sk of json.skins) for (const map of Object.values(sk.attachments)) for (const [key, att] of Object.entries(map)) { const p = picture(key, att); if (p) paths.add(p) }
    const lowerPaths = new Set([...paths].map((p) => p.toLowerCase()))
    for (const p of part.images) { let to = p, i = 2; while (lowerPaths.has(to.toLowerCase())) to = `${p}_${i++}`; lowerPaths.add(to.toLowerCase()); imageMap.set(p, to) }
    for (const skin of src.skins) {
      let dest = json.skins.find((s) => s.name === skin.name)
      if (!dest) { dest = { name: skin.name, attachments: {} }; json.skins.push(dest) }
      for (const [slot, map] of Object.entries(skin.attachments)) if (slotMap.has(slot)) {
        const copied = clone(map)
        for (const [key, att] of Object.entries(copied)) {
          const path = picture(key, att); if (path) att.path = imageMap.get(path)
          if (ops.isWeighted(att)) for (let i = 0; i < att.vertices.length;) { const n = att.vertices[i++]; for (let k = 0; k < n; k++, i += 4) { if (!indexes.has(att.vertices[i])) throw Error('不能丢弃网格权重的骨骼'); att.vertices[i] = indexes.get(att.vertices[i]) } }
          if (att.type === 'clipping' && att.end) att.end = slotMap.get(att.end) || [...slotMap.values()].at(-1)
        }
        dest.attachments[slotMap.get(slot)] = copied
      }
      if (skin.bones) dest.bones = [...new Set([...(dest.bones || []), ...skin.bones.filter((b) => boneMap.has(b)).map((b) => boneMap.get(b))])]
    }
    let skippedConstraints = 0
    const constraintNames = new Set(['ik', 'transform', 'path'].flatMap((kind) => (json[kind] || []).map((c) => c.name)))
    let order = Math.max(-1, ...['ik', 'transform', 'path'].flatMap((kind) => (json[kind] || []).map((c) => c.order || 0))) + 1
    const constraints = ['ik', 'transform', 'path'].flatMap((kind) => (src[kind] || []).map((c) => ({ kind, c }))).sort((a, b) => (a.c.order || 0) - (b.c.order || 0))
    for (const { kind, c } of constraints) {
      if (!(c.bones || []).some((b) => boneMap.has(b))) continue
      const targetMap = kind === 'path' ? slotMap : boneMap
      if (!(c.bones || []).every((b) => boneMap.has(b)) || !targetMap.has(c.target)) { skippedConstraints++; continue }
      const copy = clone(c); copy.name = unique(constraintNames, c.name); copy.bones = c.bones.map((b) => boneMap.get(b)); copy.target = targetMap.get(c.target); copy.order = order++
      json[kind] = json[kind] || []; json[kind].push(copy)
      for (const sk of src.skins) if ((sk[kind] || []).includes(c.name)) { const dest = json.skins.find((s) => s.name === sk.name); dest[kind] = [...(dest[kind] || []), copy.name] }
    }
    return { json: ops.tidy(json), bones: [...boneMap.values()], roots: names.map((n) => boneMap.get(n)), images: [...imageMap].map(([from, to]) => ({ from, to })), skippedConstraints }
  }
  root.NovaFlowSpineProjectTransfer = Object.freeze({ collect, transfer })
})(globalThis)
