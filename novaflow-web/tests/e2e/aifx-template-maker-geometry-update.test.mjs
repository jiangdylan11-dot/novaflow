// Offline regressions for canvas changes; no browser, model, server or image fixture is needed.
// node --test novaflow-web/tests/e2e/aifx-template-maker-geometry-update.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import test from 'node:test'

const renderer = new URL('../../renderer/', import.meta.url)
const sandbox = createContext({ console })
for (const name of ['sweep-light.core.js', 'aifx-template-maker.core.js', 'aifx-template-maker.fx.js']) {
  runInContext(readFileSync(new URL(name, renderer), 'utf8'), sandbox, { filename: name })
}
const FX = sandbox.NovaFlowFxMaker
const ui = readFileSync(new URL('aifx-template-maker.ui.js', renderer), 'utf8')
const copy = (value) => JSON.parse(JSON.stringify(value))
const close = (actual, expected, label, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} != ${expected}`)
const points = (p) => p.outlines.flatMap((outline) => outline.points)
const snapshot = (p) => {
  const size = FX.canvasSize(p)
  return { ...size, basePlacement: FX.basePlacement(p, size) }
}
const local = (point, rect) => ({ x: (point.x - rect.x) / rect.w, y: (point.y - rect.y) / rect.h })
const bounds = (p) => {
  const xs = points(p).map((q) => q.x), ys = points(p).map((q) => q.y)
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

// A non-square picture with a hole and a separate piece catches position, scale and hole loss.
function picture() {
  const w = 160, h = 96, data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ring = x >= 20 && x < 130 && y >= 12 && y < 84 && !(x >= 50 && x < 95 && y >= 30 && y < 60)
    const separate = x >= 138 && x < 153 && y >= 12 && y < 27
    if (!ring && !separate) continue
    const i = (y * w + x) * 4
    data[i] = 170; data[i + 1] = 85; data[i + 2] = 40; data[i + 3] = 255
  }
  return { w, h, data }
}

function tracedProject() {
  const base = picture(), p = FX.defaultProject()
  p.base = { w: base.w, h: base.h, scale: 0.7, dx: 13, dy: -7, opacity: 1 }
  p.shape.kind = 'trace'; p.outerOnly = false; p.corner = 0; p.offset = 0
  p.outlines = FX.traceImage(base.data, base.w, base.h, FX.basePlacement(p), 640, 640, 0.9, false)
  assert.equal(p.outlines.filter((o) => o.hole).length, 1, 'fixture retains its hole')
  assert.equal(p.outlines.filter((o) => !o.hole).length, 2, 'fixture retains the separate piece')
  p.start = { x: p.outlines[0].points[0].x + 3, y: p.outlines[0].points[0].y - 4 }
  return { p, base }
}

function assertSameLocalPoints(p, old, before, message) {
  const from = before.basePlacement, to = FX.basePlacement(p)
  assert.equal(p.outlines.length, old.outlines.length, `${message}: outline count`)
  p.outlines.forEach((outline, i) => {
    assert.equal(outline.hole, old.outlines[i].hole, `${message}: hole flag`)
    assert.equal(outline.points.length, old.outlines[i].points.length, `${message}: edited points survive`)
    outline.points.forEach((q, j) => {
      const want = local(old.outlines[i].points[j], from), got = local(q, to)
      close(got.x, want.x, `${message}: point ${i}/${j} u`)
      close(got.y, want.y, `${message}: point ${i}/${j} v`)
      assert.equal(q.s, old.outlines[i].points[j].s, `${message}: smoothing flag`)
    })
  })
  const want = local(old.start, from), got = local(p.start, to)
  close(got.x, want.x, `${message}: start u`)
  close(got.y, want.y, `${message}: start v`)
}

test('preset and custom size UI take an old base rectangle snapshot and use the shared reframe helper', () => {
  assert.equal(typeof FX.reframeProject, 'function')
  assert.match(ui, /const canvasSnapshot\s*=\s*\(\)\s*=>\s*\{[^\n]*basePlacement:\s*FX\(\)\.basePlacement\(S\.project,\s*s\)/)
  const setCanvas = ui.slice(ui.indexOf('    function setCanvas('), ui.indexOf('    function keepOutlineIn('))
  assert.match(setCanvas, /const before\s*=\s*canvasSnapshot\(\)/)
  assert.match(setCanvas, /keepOutlineIn\(before\)/)
  assert.match(ui, /const apply\s*=\s*\(\)\s*=>\s*\{\s*const before\s*=\s*canvasSnapshot\(\);\s*p\.canvas\.w\s*=/, 'typed width/height must capture the old placement before mutation')
  const keep = ui.slice(ui.indexOf('    function keepOutlineIn('), ui.indexOf('// ---------------------------------------------------------------- 左侧效果'))
  assert.match(keep, /FX\(\)\.reframeProject\(S\.project,\s*before,\s*size\(\)\)/)
})

test('a canvas change preserves edited outline, hole and start coordinates relative to the picture', () => {
  const { p } = tracedProject()
  // A user edit must be mapped, not replaced by a fresh trace.
  p.outlines[0].points[0].x += 9; p.outlines[0].points[0].s = 1
  p.corner = 6; p.offset = -8
  const old = copy(p), before = snapshot(p)
  p.canvas = { preset: 'base' }
  FX.reframeProject(p, before)
  assertSameLocalPoints(p, old, before, '1:1 to picture aspect')
  const scale = FX.basePlacement(p).w / before.basePlacement.w
  close(p.corner, old.corner * scale, 'rounding follows the same uniform scale')
  close(p.offset, old.offset * scale, 'inset follows the same uniform scale')
  assert.deepEqual(copy(p.params), old.params, 'effect settings are preserved')
  assert.equal(p.effect, old.effect)
})

test('repeated picture-aspect and custom-canvas switches return every edited point without drift', () => {
  const { p } = tracedProject()
  p.corner = 4; p.offset = 7
  const original = copy(p)
  for (let pass = 0; pass < 4; pass++) {
    for (const canvas of [{ preset: 'base' }, { preset: 'custom', w: 512, h: 320 }, { preset: 'custom', w: 256, h: 960 }, { preset: '1:1' }]) {
      const before = snapshot(p)
      p.canvas = canvas
      FX.reframeProject(p, before)
    }
  }
  points(p).forEach((q, i) => {
    close(q.x, points(original)[i].x, `round trip point ${i} x`)
    close(q.y, points(original)[i].y, `round trip point ${i} y`)
  })
  close(p.start.x, original.start.x, 'round trip start x')
  close(p.start.y, original.start.y, 'round trip start y')
  close(p.corner, original.corner, 'round trip corner')
  close(p.offset, original.offset, 'round trip offset')
})

test('a padding change uses the saved placement when base scale has already been recalculated', () => {
  const { p } = tracedProject()
  p.canvas = { preset: 'exact', w: 224, h: 160 }
  p.base.dx = 0; p.base.dy = 0
  p.base.scale = 1 / Math.min(224 / p.base.w, 160 / p.base.h)
  const base = picture()
  p.outlines = FX.traceImage(base.data, base.w, base.h, FX.basePlacement(p), 224, 160, 0.9, false)
  p.start = { ...p.outlines[0].points[0] }
  const old = copy(p), before = snapshot(p)
  p.canvas = { preset: 'exact', w: 352, h: 288 }
  p.base.scale = 1 / Math.min(352 / p.base.w, 288 / p.base.h)
  FX.reframeProject(p, before)
  assertSameLocalPoints(p, old, before, 'padding update')
  points(p).forEach((q, i) => {
    close(q.x, points(old)[i].x + 64, `pad point ${i} x`)
    close(q.y, points(old)[i].y + 64, `pad point ${i} y`)
  })
})

test('callers may explicitly pass the old rectangle when changing base scale and canvas together', () => {
  const { p } = tracedProject(), before = FX.canvasSize(p), from = FX.basePlacement(p)
  const old = copy(p)
  p.canvas = { preset: 'custom', w: 384, h: 704 }
  p.base.scale = 0.9
  FX.reframeProject(p, before, FX.canvasSize(p), from)
  assertSameLocalPoints(p, old, { ...before, basePlacement: from }, 'explicit previous placement')
})

test('without a picture, a canvas change retains centering and the established oversized-shape fit', () => {
  const p = FX.defaultProject()
  p.outlines = [{ points: FX.shapeOutline('rect', { x: 200, y: 200, w: 240, h: 240 }), hole: false }]
  p.start = { x: 320, y: 200 }
  let before = snapshot(p)
  p.canvas = { preset: 'custom', w: 896, h: 384 }
  FX.reframeProject(p, before)
  assert.deepEqual(bounds(p), { x: 328, y: 72, w: 240, h: 240 })
  close(p.start.x, 448, 'no-base start centers horizontally')
  close(p.start.y, 72, 'no-base start centers vertically')

  p.outlines = [{ points: FX.shapeOutline('rect', { x: 208, y: -48, w: 480, h: 480 }), hole: false }]
  p.start = { x: 448, y: -48 }
  before = snapshot(p)
  p.canvas = { preset: 'custom', w: 128, h: 384 }
  FX.reframeProject(p, before)
  const b = bounds(p)
  close(b.w, 128 * 0.85, 'oversized shape fits the narrow canvas')
  close(b.h, b.w, 'fit remains uniform')
  close(b.x + b.w / 2, 64, 'fit centers horizontally')
  close(b.y + b.h / 2, 192, 'fit centers vertically')
  close(p.start.x, 64, 'fit maps the start too')
  close(p.start.y, b.y, 'fit keeps the start on the upper edge')
})

function intersectionOverUnion(a, b) {
  let intersection = 0, union = 0
  for (let i = 0; i < a.length; i++) { if (a[i] || b[i]) union++; if (a[i] && b[i]) intersection++ }
  assert.ok(union > 100, 'fixture must occupy enough rendered pixels')
  return intersection / union
}

test('after reframing, real geometry and the first image-effect frame still cover the placed picture pixels', () => {
  const { p, base } = tracedProject(), cache = {}
  p.effect = 'smokeout'; p.params = FX.effectDefaults(p.effect)
  p.lifecycle = 'once'; p.sliceAlpha = true
  // Populate the worker-style cache before the size changes as well.
  FX.prepare(p, 0.5, base, cache)
  for (const canvas of [{ preset: 'base' }, { preset: 'custom', w: 256, h: 896 }, { preset: '1:1' }]) {
    const before = snapshot(p)
    p.canvas = canvas
    FX.reframeProject(p, before)
    const ctx = FX.prepare(p, 0.5, base, cache), frame = FX.renderFrame(ctx, 0)
    const source = Array.from(ctx.geo.img.A, (a) => a >= 0.5)
    const geometry = Array.from(ctx.geo.cov, (a) => a >= 0.5)
    const output = Array.from(source, (_, i) => frame[i * 4 + 3] >= 128)
    const shapeIoU = intersectionOverUnion(source, geometry), frameIoU = intersectionOverUnion(source, output)
    assert.ok(shapeIoU > 0.94, `${canvas.preset} ${FX.canvasSize(p).w}x${FX.canvasSize(p).h}: geometry/picture IoU ${shapeIoU}`)
    assert.ok(frameIoU > 0.94, `${canvas.preset}: rendered frame/picture IoU ${frameIoU}`)
  }
})
