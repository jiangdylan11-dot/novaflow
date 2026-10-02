(function (root) {
  'use strict'
  const scratchCanvases = new WeakMap()
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
  function paintCanvas(ctx, x0, y0, x1, y1, radius, feather, white) {
    const inner = Math.max(0, radius - feather), outer = radius + feather
    const left = Math.max(0, Math.floor(Math.min(x0, x1) - outer - 1))
    const top = Math.max(0, Math.floor(Math.min(y0, y1) - outer - 1))
    const width = Math.min(ctx.canvas.width, Math.ceil(Math.max(x0, x1) + outer + 1)) - left
    const height = Math.min(ctx.canvas.height, Math.ceil(Math.max(y0, y1) + outer + 1)) - top
    if (width <= 0 || height <= 0) return
    let canvas = scratchCanvases.get(ctx)
    if (!canvas) {
      canvas = ctx.canvas.ownerDocument.createElement('canvas')
      scratchCanvases.set(ctx, canvas)
    }
    canvas.width = width; canvas.height = height
    const stamp = canvas.getContext('2d'), pixels = stamp.createImageData(width, height)
    const dx = x1 - x0, dy = y1 - y0, lengthSquared = dx * dx + dy * dy
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const px = left + x + 0.5 - x0, py = top + y + 0.5 - y0
      const projection = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0
      const alpha = strength(Math.hypot(px - projection * dx, py - projection * dy), inner, outer)
      const offset = (y * width + x) * 4
      pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = white ? 255 : 0
      pixels.data[offset + 3] = Math.round(alpha * 255)
    }
    stamp.putImageData(pixels, 0, 0)
    ctx.save(); ctx.filter = 'none'; ctx.drawImage(canvas, left, top); ctx.restore()
  }
  const api = { falloff, strength, paintCanvas }
  root.NovaFlowSoftBrush = api
  if (typeof module === 'object' && module.exports) module.exports = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
