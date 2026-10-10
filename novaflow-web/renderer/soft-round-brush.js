(function (root) {
  'use strict'
  const canvasStrokes = new WeakMap()
  // Quintic falloff has no slope discontinuity at either end of the feather.
  function falloff(t) {
    t = Math.max(0, Math.min(1, t))
    return t * t * t * (t * (t * 6 - 15) + 10)
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
  function stampFor(doc, radius, feather, white) {
    const key = radius.toFixed(2) + '|' + feather.toFixed(2) + '|' + (white ? 1 : 0)
    let stamp = stampCache.get(key)
    if (stamp) return stamp
    if (stampCache.size > 32) stampCache.clear()
    const outer = radius + feather
    const size = Math.ceil(outer * 2) + 2, half = size / 2
    const canvas = doc.createElement('canvas')
    canvas.width = size; canvas.height = size
    const g = canvas.getContext('2d'), pixels = g.createImageData(size, size)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const s = strength(Math.hypot(x + 0.5 - half, y + 0.5 - half), radius, outer)
      // The feather builds up at 16% a dab, as before. The core takes full strength: at 16%
      // a dab, 8-bit canvas maths stalls a few levels short of fully erased, so going over it
      // again never cleared the faint shadow.
      const alpha = feather > 0 ? (s >= 0.999 ? 1 : s * 0.16) : s
      const offset = (y * size + x) * 4
      pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = white ? 255 : 0
      pixels.data[offset + 3] = Math.round(alpha * 255)
    }
    g.putImageData(pixels, 0, 0)
    stamp = { canvas, half }
    stampCache.set(key, stamp)
    return stamp
  }
  function paintStamp(ctx, x, y, radius, feather, white) {
    const stamp = stampFor(ctx.canvas.ownerDocument || document, radius, feather, white)
    ctx.save(); ctx.filter = 'none'; ctx.drawImage(stamp.canvas, x - stamp.half, y - stamp.half); ctx.restore()
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
  const api = { falloff, strength, paintCanvas, sampleStroke }
  root.NovaFlowSoftBrush = api
  if (typeof module === 'object' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
