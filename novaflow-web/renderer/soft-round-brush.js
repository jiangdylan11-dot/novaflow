(function (root) {
  'use strict'
  const canvasStrokes = new WeakMap()
  // Use the entire feather width: a radial 100% -> 0% ramp. Eased curves flatten
  // near zero, making a broad outer ring look untouched well before the cursor edge.
  function falloff(t) {
    return Math.max(0, Math.min(1, t))
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
  // One stamp per brush size, built once: rebuilding the soft circle pixel by pixel for every
  // dab (a few dozen per mouse move) made painting lag.
  const stampCache = new Map()
  let cachedStampPixels = 0
  function stampFor(doc, radius, feather, white) {
    const key = radius.toFixed(2) + '|' + feather.toFixed(2) + '|' + (white ? 1 : 0)
    let stamp = stampCache.get(key)
    if (stamp) return stamp
    const outer = radius + feather
    // Zooming out can turn a modest screen brush into thousands of source pixels.
    // Bound the stamp raster and scale it when drawing instead of allocating a huge canvas.
    const resolution = Math.min(1, 512 / Math.max(1, outer))
    // Keep the centre on a pixel centre so a dab at x.5/y.5 is not blurred by
    // a second half-pixel drawImage interpolation (especially visible on tiny brushes).
    const size = Math.ceil(outer * resolution) * 2 + 3, half = size / 2 / resolution
    if (stampCache.size >= 32 || cachedStampPixels + size * size > 8 * 1024 * 1024) {
      stampCache.clear(); cachedStampPixels = 0
    }
    const canvas = doc.createElement('canvas')
    canvas.width = size; canvas.height = size
    const g = canvas.getContext('2d'), pixels = g.createImageData(size, size)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const s = strength(Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / resolution, radius, outer)
      // Use the same continuous strength in the core and the feather. Switching from
      // full strength to 16% at their join cut a visible hard edge into every soft stroke.
      const alpha = s
      const offset = (y * size + x) * 4
      pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = white ? 255 : 0
      pixels.data[offset + 3] = Math.round(alpha * 255)
    }
    g.putImageData(pixels, 0, 0)
    stamp = { canvas, half }
    stampCache.set(key, stamp)
    cachedStampPixels += size * size
    return stamp
  }
  function paintStamp(ctx, x, y, radius, feather, white) {
    const stamp = stampFor(ctx.canvas.ownerDocument || document, radius, feather, white)
    ctx.save(); ctx.filter = 'none'; ctx.drawImage(stamp.canvas, x - stamp.half, y - stamp.half, stamp.half * 2, stamp.half * 2); ctx.restore()
  }
  function paintCanvas(ctx,x0,y0,x1,y1,radius,feather,white) {
    let state=canvasStrokes.get(ctx)
    const key=[ctx.canvas.width,ctx.canvas.height,radius,feather,white,ctx.globalCompositeOperation].join('|')
    if (!state || state.key!==key || Math.hypot(x0-state.x,y0-state.y)>0.01 || (x0===x1&&y0===y1)) {
      state={key}; canvasStrokes.set(ctx,state)
    }
    for (const point of sampleStroke(state,x0,y0,x1,y1,radius+feather)) paintStamp(ctx,point.x,point.y,radius,feather,white)
    state.x=x1; state.y=y1
  }
  const api = { falloff, strength, paintStamp, paintCanvas, sampleStroke }
  root.NovaFlowSoftBrush = api
  if (typeof module === 'object' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
