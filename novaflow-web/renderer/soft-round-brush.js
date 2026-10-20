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
  // Feather the distance to the whole path, then blend once against the pixels at
  // pointerdown. Overlapping samples in one stroke must not multiply opacity.
  function paintCoverageSegment(stroke, x0, y0, x1, y1) {
    const outer = stroke.radius + stroke.feather, outerSquared = outer * outer
    const left = Math.max(0, Math.floor(Math.min(x0, x1) - outer))
    const top = Math.max(0, Math.floor(Math.min(y0, y1) - outer))
    const right = Math.min(stroke.width, Math.ceil(Math.max(x0, x1) + outer + 1))
    const bottom = Math.min(stroke.height, Math.ceil(Math.max(y0, y1) + outer + 1))
    if (right <= left || bottom <= top) return null
    const dx = x1 - x0, dy = y1 - y0, lengthSquared = dx * dx + dy * dy
    const size = stroke.tileSize, channels = stroke.channels || 1
    let changed = false
    for (let ty = Math.floor(top / size); ty <= Math.floor((bottom - 1) / size); ty++) {
      for (let tx = Math.floor(left / size); tx <= Math.floor((right - 1) / size); tx++) {
        const key = `${tx}:${ty}`
        let tile = stroke.tiles.get(key)
        if (!tile) {
          const bounds = { x: tx * size, y: ty * size, width: Math.min(size, stroke.width - tx * size), height: Math.min(size, stroke.height - ty * size) }
          const image = stroke.read(bounds), data = image.data || image
          tile = { ...bounds, image, data, before: data.slice(), alpha: new Uint8Array(bounds.width * bounds.height) }
          stroke.tiles.set(key, tile)
        }
        let dirty = false
        const maxY = Math.min(bottom, tile.y + tile.height), maxX = Math.min(right, tile.x + tile.width)
        for (let y = Math.max(top, tile.y); y < maxY; y++) for (let x = Math.max(left, tile.x); x < maxX; x++) {
          const px = x + 0.5 - x0, py = y + 0.5 - y0
          const t = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0
          const ex = px - t * dx, ey = py - t * dy, squared = ex * ex + ey * ey
          if (squared > outerSquared) continue
          const amount = alphaByte(strength(Math.sqrt(squared), stroke.radius, outer) * (stroke.opacity ?? 1))
          const index = (y - tile.y) * tile.width + x - tile.x
          if (amount <= tile.alpha[index]) continue
          tile.alpha[index] = amount
          const a = amount / 255, offset = index * channels, before = tile.before, data = tile.data
          if (channels === 1) {
            const next = Math.round(stroke.restore ? before[offset] + (255 - before[offset]) * a : before[offset] * (1 - a))
            dirty = dirty || data[offset] !== next
            data[offset] = next
          } else if (stroke.composite === 'destination-out') {
            const next = Math.round(before[offset + 3] * (1 - a))
            dirty = dirty || data[offset + 3] !== next
            data[offset + 3] = next
          } else {
            const oldAlpha = before[offset + 3] / 255, nextAlpha = a + oldAlpha * (1 - a)
            const colour = stroke.white ? 255 : 0
            for (let c = 0; c < 3; c++) {
              const next = nextAlpha ? Math.round((colour * a + before[offset + c] * oldAlpha * (1 - a)) / nextAlpha) : 0
              dirty = dirty || data[offset + c] !== next
              data[offset + c] = next
            }
            const next = Math.round(nextAlpha * 255)
            dirty = dirty || data[offset + 3] !== next
            data[offset + 3] = next
          }
        }
        if (dirty) { stroke.write(tile); changed = true }
      }
    }
    return changed ? { left, top, right, bottom } : null
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
