/*
 * NovaFlow — 自动蒙皮 skeleton write-back.
 *
 * Converts region attachments in a Spine skeleton JSON into mesh attachments
 * driven by the auto-mesh, leaving everything else untouched.
 *
 * Coordinate contract (verified against a hand-made rig): a mesh attachment's
 * `uvs` are [0,1] over the ORIGINAL untrimmed image with v measured from the
 * TOP, and a region at (x,y) with (width,height) places image pixel (px,py) at
 *     vx = x + px - width / 2
 *     vy = y + height / 2 - py
 * Getting v upside-down is the easy mistake here and it silently mirrors layers.
 */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAutoMeshAttach = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  /** Boundary edge list Spine's editor expects: consecutive hull vertices, ×2 indices. */
  function hullEdges(hull) {
    const edges = []
    if (hull < 2) return edges
    for (let i = 0; i < hull; i++) {
      const j = (i + 1) % hull
      edges.push(i * 2, j * 2)
    }
    return edges
  }

  /**
   * Build a Spine mesh attachment from an auto-mesh result.
   * `region` is the existing region attachment ({x, y, width, height}).
   * `mesh` is {vertices, triangles, hull} in image pixels.
   */
  /**
   * Regions of a Spine atlas keyed by name -- the 3.8 `xy/size/orig/offset/rotate`
   * form and the 4.x `bounds/offsets` form. `offTop` is measured from the TOP of
   * the original image; the file stores the offset from the bottom, which is how
   * Spine positions a trimmed region inside its untrimmed `orig` box.
   */
  function parseAtlas(text) {
    const regions = new Map()
    if (!text) return regions
    let page = null
    let cur = null
    const flush = () => {
      if (cur && cur.name && cur.w > 0 && cur.h > 0) {
        if (!(cur.origW > 0) || !(cur.origH > 0)) { cur.origW = cur.w; cur.origH = cur.h }
        cur.offTop = cur.origH - cur.offY - cur.h
        regions.set(cur.name, cur)
      }
      cur = null
    }
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim()
      if (!line) { flush(); page = null; continue }          // a blank line starts the next page
      if (page === null) { page = line; continue }           // the page's image file
      const colon = line.indexOf(':')
      if (colon < 0) {
        flush()
        cur = { name: line, page, rotate: false, x: 0, y: 0, w: 0, h: 0, origW: 0, origH: 0, offX: 0, offY: 0, offTop: 0 }
        continue
      }
      if (!cur) continue                                     // page header: size / format / filter / repeat / pma
      const key = line.slice(0, colon).trim()
      const v = line.slice(colon + 1).split(',').map((t) => t.trim())
      const n = v.map(Number)
      if (key === 'rotate') cur.rotate = v[0] === 'true' || n[0] === 90
      else if (key === 'xy') { cur.x = n[0]; cur.y = n[1] }
      else if (key === 'size') { cur.w = n[0]; cur.h = n[1] }
      else if (key === 'orig') { cur.origW = n[0]; cur.origH = n[1] }
      else if (key === 'offset') { cur.offX = n[0]; cur.offY = n[1] }
      else if (key === 'bounds') { cur.x = n[0]; cur.y = n[1]; cur.w = n[2]; cur.h = n[3] }
      else if (key === 'offsets') { cur.offX = n[0]; cur.offY = n[1]; cur.origW = n[2]; cur.origH = n[3] }
    }
    flush()
    return regions
  }

  function meshAttachment(region, mesh, imageWidth, imageHeight) {
    const rw = Number(region && region.width) || imageWidth
    const rh = Number(region && region.height) || imageHeight
    const rx = Number(region && region.x) || 0
    const ry = Number(region && region.y) || 0
    // the attachment box need not be the image's size; Spine stretches the image to it
    const kx = rw / imageWidth, ky = rh / imageHeight
    // a region hung on a rotated bone carries the counter-rotation (and any scale);
    // a mesh has neither, so bake them in the way Spine's RegionAttachment applies them
    const rot = (Number(region && region.rotation) || 0) * Math.PI / 180
    const cos = Math.cos(rot), sin = Math.sin(rot)
    const sx = region && region.scaleX !== undefined ? Number(region.scaleX) : 1
    const sy = region && region.scaleY !== undefined ? Number(region.scaleY) : 1
    const V = mesh.vertices
    const n = V.length / 2
    const uvs = new Array(n * 2)
    const vertices = new Array(n * 2)
    for (let i = 0; i < n; i++) {
      const px = V[2 * i], py = V[2 * i + 1]
      uvs[2 * i] = px / imageWidth
      uvs[2 * i + 1] = py / imageHeight          // v from the top
      const qx = (px * kx - rw / 2) * sx, qy = (rh / 2 - py * ky) * sy
      vertices[2 * i] = rx + qx * cos - qy * sin
      vertices[2 * i + 1] = ry + qx * sin + qy * cos
    }
    const round = (v) => Math.round(v * 1e5) / 1e5
    const out = {
      type: 'mesh',
      uvs: uvs.map(round),
      triangles: Array.from(mesh.triangles),
      vertices: vertices.map(round),
      hull: mesh.hull,
      edges: hullEdges(mesh.hull),
      width: rw,
      height: rh
    }
    // the runtime finds the atlas region by path when there is one
    if (region && region.path) out.path = region.path
    return out
  }

  /** Attachment names a layer image could be serving, most specific first. */
  function imageKey(fileName) {
    return String(fileName || '').replace(/\.[^.]+$/, '').toLowerCase()
  }

  /**
   * Replace region attachments with auto-generated meshes.
   *
   * `buildFor(attachmentName, slotName)` must return {vertices, triangles, hull,
   * width, height} or null to leave the attachment alone.
   * Returns {skeleton, converted, skipped}.
   */
  function applyMeshes(skeleton, buildFor) {
    const out = JSON.parse(JSON.stringify(skeleton))
    const skins = out.skins
    const converted = []
    const skipped = []

    const visitSkin = (attachments) => {
      for (const slotName of Object.keys(attachments || {})) {
        const bySlot = attachments[slotName]
        for (const attName of Object.keys(bySlot || {})) {
          const att = bySlot[attName]
          if (!att || typeof att !== 'object') continue
          const type = att.type || 'region'
          if (type !== 'region') { skipped.push({ name: attName, reason: type }); continue }
          let built = null
          try {
            built = buildFor(attName, slotName, att)
          } catch (err) {
            skipped.push({ name: attName, reason: 'error: ' + (err && err.message ? err.message : String(err)) })
            continue
          }
          if (!built) { skipped.push({ name: attName, reason: 'no-mesh' }); continue }
          bySlot[attName] = meshAttachment(att, built, built.width, built.height)
          converted.push(attName)
        }
      }
    }

    if (Array.isArray(skins)) {
      for (const skin of skins) visitSkin(skin && skin.attachments)
    } else if (skins && typeof skins === 'object') {
      for (const skinName of Object.keys(skins)) visitSkin(skins[skinName])
    }
    return { skeleton: out, converted, skipped }
  }

  /**
   * Move every trimmed region so its artwork stays exactly where it was.
   * `trims` maps a lower-cased image name to {x0, y0, width, height, origW, origH}.
   *
   * x/y is the region centre in bone space with y up, so the centre moves by how
   * far the crop's centre sits from the original image's centre: right is +x and
   * further down the image is -y. A rotated or scaled region is left alone,
   * because its offset would have to be rotated with it.
   */
  function retargetTrimmed(skeleton, trims) {
    let moved = 0
    const visit = (attachments) => {
      for (const slotName of Object.keys(attachments || {})) {
        const bySlot = attachments[slotName]
        for (const key of Object.keys(bySlot || {})) {
          const att = bySlot[key]
          if (!att || typeof att !== 'object') continue
          const type = att.type || 'region'
          // the crop is keyed by the image the attachment draws, which is its path
          // when it has one (several attachments may share one image)
          const trim = trims.get(String(att.path || att.name || key).toLowerCase())
          if (!trim) continue
          if (type === 'mesh' && Array.isArray(att.uvs)) {
            // a mesh keeps its vertices; only its uvs are relative to the image, so
            // they move with the crop and the declared image size follows
            const uvs = att.uvs
            for (let i = 0; i + 1 < uvs.length; i += 2) {
              uvs[i] = (uvs[i] * trim.origW - trim.x0) / trim.width
              uvs[i + 1] = (uvs[i + 1] * trim.origH - trim.y0) / trim.height
            }
            att.width = trim.width
            att.height = trim.height
            moved++
            continue
          }
          if (type !== 'region') continue
          if (Number(att.rotation)) continue
          if (att.scaleX !== undefined && Number(att.scaleX) !== 1) continue
          if (att.scaleY !== undefined && Number(att.scaleY) !== 1) continue
          const dx = (trim.x0 + trim.width / 2) - trim.origW / 2
          const dy = (trim.y0 + trim.height / 2) - trim.origH / 2
          att.x = (Number(att.x) || 0) + dx
          att.y = (Number(att.y) || 0) - dy
          att.width = trim.width
          att.height = trim.height
          moved++
        }
      }
    }
    const skins = skeleton && skeleton.skins
    if (Array.isArray(skins)) for (const skin of skins) visit(skin && skin.attachments)
    else if (skins && typeof skins === 'object') for (const k of Object.keys(skins)) visit(skins[k])
    return moved
  }

  /** Undo: turn generated meshes back into plain regions. */
  function stripMeshes(skeleton) {
    const out = JSON.parse(JSON.stringify(skeleton))
    const visitSkin = (attachments) => {
      for (const slotName of Object.keys(attachments || {})) {
        const bySlot = attachments[slotName]
        for (const attName of Object.keys(bySlot || {})) {
          const att = bySlot[attName]
          if (!att || att.type !== 'mesh' || !Array.isArray(att.vertices)) continue
          // a weighted mesh is hand-authored data; never clobber it
          if (att.vertices.length !== (att.uvs || []).length) continue
          bySlot[attName] = { x: att.x || 0, y: att.y || 0, width: att.width, height: att.height }
        }
      }
    }
    const skins = out.skins
    if (Array.isArray(skins)) for (const s of skins) visitSkin(s && s.attachments)
    else if (skins) for (const k of Object.keys(skins)) visitSkin(skins[k])
    return out
  }


  /**
   * Build an atlas for a PhotoshopToSpine export, which ships a skeleton JSON and
   * a folder of per-layer PNGs but no .atlas at all. Each image becomes its own
   * single-region page, which is what the layers already are — so the project
   * loads directly instead of forcing a round trip through Spine to get an atlas.
   *
   * `images` is [{fileName, width, height}].
   */
  function synthesizeAtlas(images) {
    const lines = []
    for (const img of images || []) {
      const file = String(img.fileName || '')
      const name = String(img.name || file.replace(/\.[^.]+$/, ''))
      const w = Math.max(1, Math.round(Number(img.width) || 0))
      const h = Math.max(1, Math.round(Number(img.height) || 0))
      if (!name || !w || !h) continue
      if (lines.length) lines.push('')
      lines.push(file)
      lines.push(`size: ${w},${h}`)
      lines.push('format: RGBA8888')
      lines.push('filter: Linear,Linear')
      lines.push('repeat: none')
      lines.push(name)
      lines.push('  rotate: false')
      lines.push('  xy: 0, 0')
      lines.push(`  size: ${w}, ${h}`)
      lines.push(`  orig: ${w}, ${h}`)
      lines.push('  offset: 0, 0')
      lines.push('  index: -1')
    }
    return lines.join(String.fromCharCode(10))
  }

  /** A cropped/resized replacement keeps the old artwork's frame inside its transparent canvas. */
  function replacementFrame(oldPixels, width, height, pixels, newWidth, newHeight) {
    if (width === newWidth && height === newHeight) return null
    const bounds = (rgba, w, h) => {
      let x = w, y = h, right = 0, bottom = 0
      for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
        if (rgba[(py * w + px) * 4 + 3] <= 8) continue
        x = Math.min(x, px); y = Math.min(y, py); right = Math.max(right, px + 1); bottom = Math.max(bottom, py + 1)
      }
      return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
    }
    const old = bounds(oldPixels, width, height), source = bounds(pixels, newWidth, newHeight)
    if (!old || !source) return null
    // A full-canvas image (or a uniformly resized canvas with the same margins) already maps correctly.
    const sides = (b, w, h) => [b.x / w, b.y / h, (b.x + b.width) / w, (b.y + b.height) / h]
    const before = sides(old, width, height), after = sides(source, newWidth, newHeight)
    if (old.x <= 1 && old.y <= 1 && width - old.x - old.width <= 1 && height - old.y - old.height <= 1) return null
    if (before.every((v, i) => Math.abs(v - after[i]) <= Math.max(1 / width, 1 / height, 1 / newWidth, 1 / newHeight))) return null
    const scale = Math.min(old.width / source.width, old.height / source.height)
    const dw = source.width * scale, dh = source.height * scale
    return { width, height, source, destination: { x: old.x + (old.width - dw) / 2, y: old.y + (old.height - dh) / 2, width: dw, height: dh } }
  }

  /**
   * Make a PhotoshopToSpine export something the official Spine 3.8 runtime will
   * load. This exporter writes no `skeleton.spine` and uses the pre-3.8 object form
   * of `skins`; without a version the app skips the official player entirely, and
   * with one it loads and then dies on `Skin not found: default`. Falling back to
   * the app's own 2D preview costs the camera -- no wheel zoom, no right-drag pan --
   * and that preview also stops drawing after any reload.
   */
  function normalizeToSpine38(skeleton) {
    if (!skeleton || typeof skeleton !== 'object') return false
    let changed = false
    const header = skeleton.skeleton && typeof skeleton.skeleton === 'object' ? skeleton.skeleton : {}
    if (!String(header.spine || '').trim()) {
      skeleton.skeleton = { ...header, spine: '3.8.75' }
      changed = true
    }
    const skins = skeleton.skins
    if (skins && !Array.isArray(skins) && typeof skins === 'object') {
      skeleton.skins = Object.keys(skins).map((name) => ({ name, attachments: skins[name] }))
      changed = true
    }
    return changed
  }

  /** True when a skeleton JSON looks like a PhotoshopToSpine export. */
  function looksLikePhotoshopExport(skeleton) {
    if (!skeleton || typeof skeleton !== 'object') return false
    if (skeleton.PhotoshopToSpine) return true
    const bones = Array.isArray(skeleton.bones) ? skeleton.bones : []
    const onlyRoot = bones.length === 1 && bones[0] && bones[0].name === 'root'
    return onlyRoot && !!skeleton.skins
  }

  return { applyMeshes, meshAttachment, normalizeToSpine38, parseAtlas, retargetTrimmed, stripMeshes, hullEdges, imageKey, synthesizeAtlas, replacementFrame, looksLikePhotoshopExport }
})
