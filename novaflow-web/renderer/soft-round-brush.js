(function (root) {
  'use strict'
  const canvasStrokes = new WeakMap()
  // A single smooth ramp across the whole feather, with no straight middle section
  // or piecewise shoulders. Its slope is zero at both the solid core and the outside.
  function falloff(t) {
    t = Math.max(0, Math.min(1, t))
    return t * t * (3 - 2 * t)
  }
  function alphaByte(value) {
    // A nonzero feather must not quantise to a wide fully empty band in an 8-bit mask.
    return value > 0 ? Math.max(1, Math.round(Math.min(1, value) * 255)) : 0
  }
  function strength(distance, inner, outer) {
    if (distance <= inner) return 1
    if (distance >= outer) return 0
    return falloff((outer - distance) / (outer - inner))
  }
  function sampleStroke(state, x0, y0, x1, y1, radius) {
    const spacing = Math.max(0.5, radius * 0.08)
    const points = []
    if (!state.started) { points.push({x:x0,y:y0}); state.started=true; state.remaining=spacing }
    const dx=x1-x0, dy=y1-y0, distance=Math.hypot(dx,dy)
    let travel=state.remaining
    while (travel <= distance + 1e-9) {
      const t=distance ? travel/distance : 0
      points.push({x:x0+dx*t,y:y0+dy*t}); travel+=spacing
    }
    state.remaining=travel-distance
    return points
  }
  function paintStamp(ctx, x, y, radius, feather, white) {
    return paintCoverageSegment(createCanvasStroke(ctx, radius, feather, white), x, y, x, y)
  }
  function createCoverageStroke(options) {
    return { ...options, tiles: options.tiles || new Map(), tileSize: options.tileSize || 64 }
  }
  function coverageTile(stroke, tx, ty) {
    const size = stroke.tileSize, key = `${tx}:${ty}`
    let tile = stroke.tiles.get(key)
    if (!tile) {
      const bounds = { x: tx * size, y: ty * size, width: Math.min(size, stroke.width - tx * size), height: Math.min(size, stroke.height - ty * size) }
      const image = stroke.read(bounds), data = image.data || image
      tile = { ...bounds, image, data, before: data.slice(), alpha: new Uint8Array(bounds.width * bounds.height), applied: new Uint8Array(bounds.width * bounds.height) }
      stroke.tiles.set(key, tile)
    }
    return tile
  }
  function blendPixel(stroke, tile, index, amount) {
    const channels = stroke.channels || 1, a = amount / 255, offset = index * channels, before = tile.before, data = tile.data
    let dirty = false
    if (channels === 1) {
      const next = Math.round(stroke.restore ? before[offset] + (255 - before[offset]) * a : before[offset] * (1 - a))
      dirty = data[offset] !== next; data[offset] = next
    } else if (stroke.composite === 'destination-out') {
      const next = Math.round(before[offset + 3] * (1 - a))
      dirty = data[offset + 3] !== next; data[offset + 3] = next
    } else {
      const oldAlpha = before[offset + 3] / 255, nextAlpha = a + oldAlpha * (1 - a), colour = stroke.white ? 255 : 0
      for (let c = 0; c < 3; c++) {
        const next = nextAlpha ? Math.round((colour * a + before[offset + c] * oldAlpha * (1 - a)) / nextAlpha) : 0
        dirty = dirty || data[offset + c] !== next; data[offset + c] = next
      }
      const next = Math.round(nextAlpha * 255)
      dirty = dirty || data[offset + 3] !== next; data[offset + 3] = next
    }
    return dirty
  }
  // The middle contour is the union of swept disks. Convolving that ONE shape
  // with a compact circular kernel gives smooth concave joins, unlike taking the
  // maximum of per-segment feather ramps (which leaves radial bisector creases).
  // Both disk radii add up to core + feather, so the feather stays in pixel units.
  function featherShape(stroke, x0, y0, x1, y1) {
    let shape = stroke.shape
    if (!shape) {
      const scale = Math.max(1, stroke.feather / 32), radius = stroke.feather / (2 * scale), kernel = []
      let area = 0
      for (let y = -Math.ceil(radius); y <= Math.ceil(radius); y++) {
        const half = Math.floor(Math.sqrt(Math.max(0, radius * radius - y * y)))
        if (Math.abs(y) > radius) continue
        kernel.push({ y, half }); area += half * 2 + 1
      }
      shape = stroke.shape = { scale, radius, kernel, area, cells: new Map() }
    }
    const { scale, radius, cells, kernel, area } = shape, cellTileSize = 32
    const cell = (x, y, value) => {
      const tx = Math.floor(x / cellTileSize), ty = Math.floor(y / cellTileSize), key = `${tx}:${ty}`
      let tile = cells.get(key)
      if (!tile && value > 0) { tile = new Float32Array(cellTileSize * cellTileSize); cells.set(key, tile) }
      if (!tile) return 0
      const i = (y - ty * cellTileSize) * cellTileSize + x - tx * cellTileSize, old = tile[i]
      if (value > old) tile[i] = value
      return old
    }
    const mid = (stroke.radius + stroke.feather / 2) / scale
    x0 /= scale; y0 /= scale; x1 /= scale; y1 /= scale
    const dx = x1 - x0, dy = y1 - y0, ll = dx * dx + dy * dy, halo = Math.ceil(radius) + 2
    const gx0 = Math.max(-halo, Math.floor(Math.min(x0, x1) - mid - 1)), gy0 = Math.max(-halo, Math.floor(Math.min(y0, y1) - mid - 1))
    const gx1 = Math.min(Math.ceil(stroke.width / scale) + halo, Math.ceil(Math.max(x0, x1) + mid + 1)), gy1 = Math.min(Math.ceil(stroke.height / scale) + halo, Math.ceil(Math.max(y0, y1) + mid + 1))
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let y = gy0; y < gy1; y++) for (let x = gx0; x < gx1; x++) {
      const px = x + 0.5 - x0, py = y + 0.5 - y0, t = ll ? Math.max(0, Math.min(1, (px * dx + py * dy) / ll)) : 0
      const value = Math.fround(Math.max(0, Math.min(1, mid + 0.5 - Math.hypot(px - t * dx, py - t * dy))))
      if (value <= cell(x, y)) continue
      cell(x, y, value); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
    if (!Number.isFinite(minX)) return null
    const bx0 = Math.max(-2, minX - halo), by0 = Math.max(-2, minY - halo)
    const bx1 = Math.min(Math.ceil(stroke.width / scale) + 1, maxX + halo), by1 = Math.min(Math.ceil(stroke.height / scale) + 1, maxY + halo)
    const width = bx1 - bx0 + 1, height = by1 - by0 + 1, pad = Math.ceil(radius)
    const pw = width + pad * 2 + 1, ph = height + pad * 2, prefix = new Float64Array(pw * ph)
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw - 1; x++) prefix[y * pw + x + 1] = prefix[y * pw + x] + cell(bx0 - pad + x, by0 - pad + y)
    const filtered = new Float32Array(width * height)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0
      for (const row of kernel) { const i = (y + pad + row.y) * pw + x + pad; sum += prefix[i + row.half + 1] - prefix[i - row.half] }
      filtered[y * width + x] = sum / area
    }
    // Keep a complete interpolation cell around the output. Clamping at a dirty
    // rectangle edge would retain a small, direction-dependent opacity overshoot.
    const left = Math.max(0, Math.ceil((bx0 + 1.5) * scale - 0.5)), top = Math.max(0, Math.ceil((by0 + 1.5) * scale - 0.5))
    const right = Math.min(stroke.width, Math.ceil((bx1 - 0.5) * scale - 0.5)), bottom = Math.min(stroke.height, Math.ceil((by1 - 0.5) * scale - 0.5))
    let changed = false
    for (let ty = Math.floor(top / stroke.tileSize); ty <= Math.floor((bottom - 1) / stroke.tileSize); ty++) for (let tx = Math.floor(left / stroke.tileSize); tx <= Math.floor((right - 1) / stroke.tileSize); tx++) {
      const tile = coverageTile(stroke, tx, ty)
      let dirty = false
      for (let y = Math.max(top, tile.y); y < Math.min(bottom, tile.y + tile.height); y++) for (let x = Math.max(left, tile.x); x < Math.min(right, tile.x + tile.width); x++) {
        const i = (y - tile.y) * tile.width + x - tile.x, raw = tile.alpha[i]
        if (!raw) continue
        const gx = Math.max(0, Math.min(width - 1.000001, (x + 0.5) / scale - 0.5 - bx0)), gy = Math.max(0, Math.min(height - 1.000001, (y + 0.5) / scale - 0.5 - by0))
        const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, j = iy * width + ix
        const value = (filtered[j] * (1 - fx) + filtered[j + 1] * fx) * (1 - fy) + (filtered[j + width] * (1 - fx) + filtered[j + width + 1] * fx) * fy
        const amount = alphaByte((raw === 255 ? 1 : Math.max(1 / 255, Math.min(254 / 255, value))) * (stroke.opacity ?? 1))
        if (amount <= tile.applied[i]) continue
        tile.applied[i] = amount
        if (blendPixel(stroke, tile, i, amount)) dirty = true
      }
      if (dirty) { stroke.write(tile); changed = true }
    }
    return changed ? {left, top, right, bottom} : null
  }
  // Build coverage against the pointerdown snapshot, so retracing is idempotent.
  function paintCoverageSegment(stroke, x0, y0, x1, y1) {
    const outer = stroke.radius + stroke.feather, outerSquared = outer * outer
    const left = Math.max(0, Math.floor(Math.min(x0, x1) - outer))
    const top = Math.max(0, Math.floor(Math.min(y0, y1) - outer))
    const right = Math.min(stroke.width, Math.ceil(Math.max(x0, x1) + outer + 1))
    const bottom = Math.min(stroke.height, Math.ceil(Math.max(y0, y1) + outer + 1))
    if (right <= left || bottom <= top) return null
    const dx = x1 - x0, dy = y1 - y0, lengthSquared = dx * dx + dy * dy
    const size = stroke.tileSize, smooth = stroke.feather > 2
    let changed = false
    for (let ty = Math.floor(top / size); ty <= Math.floor((bottom - 1) / size); ty++) {
      for (let tx = Math.floor(left / size); tx <= Math.floor((right - 1) / size); tx++) {
        const tile = coverageTile(stroke, tx, ty)
        let dirty = false
        const maxY = Math.min(bottom, tile.y + tile.height), maxX = Math.min(right, tile.x + tile.width)
        for (let y = Math.max(top, tile.y); y < maxY; y++) for (let x = Math.max(left, tile.x); x < maxX; x++) {
          const px = x + 0.5 - x0, py = y + 0.5 - y0
          const t = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0
          const ex = px - t * dx, ey = py - t * dy, squared = ex * ex + ey * ey
          if (squared > outerSquared) continue
          const distance = Math.sqrt(squared)
          const amount = smooth
            ? distance <= stroke.radius ? 255 : distance >= outer ? 0 : Math.max(1, Math.min(254, alphaByte(strength(distance, stroke.radius, outer))))
            : alphaByte(strength(distance, stroke.radius, outer) * (stroke.opacity ?? 1))
          const index = (y - tile.y) * tile.width + x - tile.x
          if (amount <= tile.alpha[index]) continue
          tile.alpha[index] = amount
          if (!smooth && blendPixel(stroke, tile, index, amount)) dirty = true
        }
        if (dirty) { stroke.write(tile); changed = true }
      }
    }
    return smooth ? featherShape(stroke, x0, y0, x1, y1) : changed ? { left, top, right, bottom } : null
  }
  function createCanvasStroke(ctx, radius, feather, white) {
    return createCoverageStroke({
      width: ctx.canvas.width, height: ctx.canvas.height, radius, feather, white,
      channels: 4, composite: ctx.globalCompositeOperation, opacity: ctx.globalAlpha,
      read: b => ctx.getImageData(b.x, b.y, b.width, b.height),
      write: tile => ctx.putImageData(tile.image, tile.x, tile.y)
    })
  }
  function paintCanvas(ctx,x0,y0,x1,y1,radius,feather,white,strokeId) {
    let state=canvasStrokes.get(ctx)
    const key=[ctx.canvas.width,ctx.canvas.height,radius,feather,white,ctx.globalCompositeOperation,ctx.globalAlpha,strokeId ?? ''].join('|')
    if (!state || state.key!==key || (strokeId == null && (Math.hypot(x0-state.x,y0-state.y)>0.01 || (x0===x1&&y0===y1)))) {
      state={key, raster:createCanvasStroke(ctx,radius,feather,white)}; canvasStrokes.set(ctx,state)
    }
    const bounds = paintCoverageSegment(state.raster,x0,y0,x1,y1)
    state.x=x1; state.y=y1
    return bounds
  }
  const api = { falloff, strength, alphaByte, paintStamp, paintCanvas, sampleStroke, createCoverageStroke, createCanvasStroke, paintCoverageSegment }
  root.NovaFlowSoftBrush = api
  if (typeof module === 'object' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
