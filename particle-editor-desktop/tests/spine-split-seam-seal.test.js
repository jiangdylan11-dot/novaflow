const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { loadSpine } = require('../../tools/qwen-rapid-migration-smoke.cjs')

const root = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const RUNTIME = 'particle-editor/spine-split-runtime.js'

const FRAME = 16

function layer(x, y, width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), x, y, width, height }
}

function setPixel(target, column, row, r, g, b, a) {
  const p = (row * target.width + column) * 4
  target.data[p] = r
  target.data[p + 1] = g
  target.data[p + 2] = b
  target.data[p + 3] = a
}

function alphaAt(target, column, row) {
  return target.data[(row * target.width + column) * 4 + 3]
}

function redAt(target, column, row) {
  return target.data[(row * target.width + column) * 4]
}

function flatSource(r, g, b) {
  const data = new Uint8ClampedArray(FRAME * FRAME * 4)
  for (let i = 0; i < FRAME * FRAME; i += 1) data.set([r, g, b, 255], i * 4)
  return data
}

// What the canvas, the PSD and Spine all do with the stack: source-over, bottom layer first.
function composite(layers) {
  const open = new Float64Array(FRAME * FRAME).fill(1)
  const rgb = new Float64Array(FRAME * FRAME * 3)
  for (const item of layers) {
    for (let row = 0; row < item.height; row += 1) {
      for (let column = 0; column < item.width; column += 1) {
        const p = (row * item.width + column) * 4
        const a = item.data[p + 3] / 255
        const q = ((item.y + row) * FRAME + item.x + column) * 3
        open[(item.y + row) * FRAME + item.x + column] *= 1 - a
        for (let k = 0; k < 3; k += 1) rgb[q + k] = rgb[q + k] * (1 - a) + item.data[p + k] * a
      }
    }
  }
  return { cov: Array.from(open, (v) => 1 - v), rgb }
}

test('one-click split repairs the layer edges after the feet and the face are settled', () => {
  const source = read(RUNTIME)
  assert.match(source, /stacked = await mergeFaceDetailsIntoFace\(withFeet\)[\s\S]{0,220}return await repairSeeThroughLayerEdges\(stacked\)/, 'the repair must run on the final stack, after the foot split and the face merge')
  assert.match(source, /catch \(error\) \{\s*console\.warn\('\[NovaFlow\] layer seam seal skipped:'[\s\S]{0,80}return stacked/, 'a repair failure must degrade to the unrepaired layers instead of failing the split')
  assert.match(source, /const sealed = sealLayerStackSeams\(layers, size\.width, size\.height\)/)
  assert.match(source, /layerEdgeSourceRecolour\(layers, source, size\.width, size\.height/)
  assert.match(source, /edgeRecolour: 'source-surface'/, 'a repaired layer must say so in its metadata')
})

test('a cut shared between two layers closes, and the figure keeps its soft outer edge', () => {
  const s = loadSpine(RUNTIME)
  // See-through hands over a leg and a foot that meet on one row, each carrying half of the coverage.
  const foot = layer(0, 8, FRAME, 8)
  const leg = layer(0, 0, FRAME, 9)
  for (let column = 2; column < 12; column += 1) {
    for (let row = 0; row < 8; row += 1) setPixel(leg, column, row, 200, 180, 170, 255)
    setPixel(leg, column, 8, 200, 180, 170, 128)
    setPixel(foot, column, 0, 200, 180, 170, 127)
    for (let row = 1; row < 7; row += 1) setPixel(foot, column, row, 200, 180, 170, 255)
    setPixel(foot, column, 7, 200, 180, 170, 96)
  }
  const before = composite([foot, leg])
  assert.ok(before.cov[8 * FRAME + 5] < 0.8, `the cut starts short of full coverage (${before.cov[8 * FRAME + 5]})`)

  const changed = s.sealLayerStackSeams([foot, leg], FRAME, FRAME)
  const after = composite([foot, leg])

  assert.equal(after.cov[8 * FRAME + 5], 1, 'the cut row must end up fully covered so the canvas cannot show through it')
  assert.equal(alphaAt(leg, 5, 8), 128, 'the layer on top of the cut keeps its own alpha')
  assert.equal(alphaAt(foot, 5, 0), 255, 'the layer underneath carries the rest of the cut')
  assert.equal(changed[1], 0, 'nothing above the top layer, nothing to seal')
  assert.equal(alphaAt(foot, 5, 7), 96, 'the figure\'s outer edge has nothing over it and keeps its feather')
  assert.equal(after.cov[15 * FRAME + 5], before.cov[15 * FRAME + 5], 'so the silhouette renders exactly as before')
})

test('a soft edge lying over opaque material is left alone by the seal', () => {
  const s = loadSpine(RUNTIME)
  // An eyelash fading onto an opaque face: the stack already covers every pixel, nothing shows through,
  // and hardening the face under it would only cost the lash its edge once animation moves the two apart.
  const face = layer(0, 0, FRAME, FRAME)
  const lash = layer(4, 4, 8, 8)
  for (let row = 0; row < FRAME; row += 1) for (let column = 0; column < FRAME; column += 1) setPixel(face, column, row, 220, 200, 190, 255)
  for (let row = 0; row < 8; row += 1) for (let column = 0; column < 8; column += 1) setPixel(lash, column, row, 220, 200, 190, row === 0 || row === 7 ? 90 : 255)

  assert.deepEqual([...s.sealLayerStackSeams([face, lash], FRAME, FRAME)], [0, 0], 'no alpha may move where the stack is already opaque')
  assert.equal(alphaAt(lash, 3, 0), 90, 'the lash keeps its feather')
})

test('a hole the layers never covered is left as a hole', () => {
  const s = loadSpine(RUNTIME)
  // The gap between two fan ribs is background the artist drew, not a seam. Only one layer borders it,
  // so there is no coverage to hand over and the seal must not paint it in.
  const fan = layer(0, 0, FRAME, FRAME)
  for (let row = 2; row < 14; row += 1) for (let column = 2; column < 14; column += 1) setPixel(fan, column, row, 200, 200, 200, column === 8 ? 0 : 255)

  assert.deepEqual([...s.sealLayerStackSeams([fan], FRAME, FRAME)], [0])
  assert.equal(alphaAt(fan, 8, 5), 0, 'the gap stays open')
  assert.equal(composite([fan]).cov[5 * FRAME + 8], 0)
})

test('the dark rim See-through leaves on a layer edge is repainted from the source', () => {
  const s = loadSpine(RUNTIME)
  // A foot underneath, and a leg on top whose colour fades to black over its last three rows while it is
  // still opaque or nearly so. Source-over puts that darkening straight onto the clean foot: the grey arc
  // across the ankle. The foot below is already right, so only the leg's own rim may move.
  const foot = layer(0, 0, FRAME, FRAME)
  const leg = layer(2, 0, 12, 10)
  for (let row = 0; row < FRAME; row += 1) for (let column = 0; column < FRAME; column += 1) setPixel(foot, column, row, 224, 200, 195, 255)
  for (let row = 0; row < 10; row += 1) for (let column = 0; column < 12; column += 1) {
    const dark = row === 7 ? 150 : row === 8 ? 110 : row === 9 ? 100 : 224
    const alpha = row === 8 ? 240 : row === 9 ? 120 : 255
    setPixel(leg, column, row, dark, dark - 24, dark - 29, alpha)
  }
  const source = flatSource(224, 200, 195)
  const before = composite([foot, leg])
  assert.ok(before.rgb[(8 * FRAME + 6) * 3] < 150, `the rim starts dark (${before.rgb[(8 * FRAME + 6) * 3]})`)
  assert.equal(before.cov[8 * FRAME + 6], 1, 'and it is not a coverage gap - the stack is solid there')

  const changed = s.layerEdgeSourceRecolour([foot, leg], source, FRAME, FRAME, {})
  const after = composite([foot, leg])

  assert.equal(changed[0], 0, 'the foot is not the surface under the leg, so it is left as the model painted it')
  assert.ok(changed[1] > 0, 'the leg rim is repainted')
  for (const row of [7, 8, 9]) assert.ok(Math.abs(after.rgb[(row * FRAME + 6) * 3] - 224) <= 1, `row ${row} now matches the source (${after.rgb[(row * FRAME + 6) * 3]})`)
  assert.equal(redAt(leg, 4, 0), 224, 'the layer body was already right and stays right')
})

test('line art the artist drew stays dark, and a layer body away from its edge is never repainted', () => {
  const s = loadSpine(RUNTIME)
  const under = layer(0, 0, FRAME, FRAME)
  const over = layer(0, 0, FRAME, FRAME)
  for (let row = 0; row < FRAME; row += 1) for (let column = 0; column < FRAME; column += 1) {
    setPixel(under, column, row, 224, 200, 195, 255)
    setPixel(over, column, row, row === 6 ? 30 : 224, row === 6 ? 26 : 200, row === 6 ? 24 : 195, row === 15 ? 120 : 255)
  }
  // the source is dark on that row too: it is a drawn outline, not a rim the model burned in
  const source = flatSource(224, 200, 195)
  for (let column = 0; column < FRAME; column += 1) source.set([28, 24, 22, 255], (6 * FRAME + column) * 4)

  const changed = s.layerEdgeSourceRecolour([under, over], source, FRAME, FRAME, {})
  assert.equal(redAt(over, 5, 6), 30, 'the drawn outline keeps its colour')

  // row 6 is nine rows from the only soft edge (row 15), so reach cannot touch it either way
  assert.ok(changed[1] <= FRAME * 6, 'only the rows near the soft edge are eligible at all')
})

test('softEdgeReachMask marks the band around a layer\'s own soft edge and nothing else', () => {
  const s = loadSpine(RUNTIME)
  const strip = layer(0, 0, 12, 12)
  for (let row = 0; row < 12; row += 1) for (let column = 0; column < 12; column += 1) setPixel(strip, column, row, 200, 200, 200, row === 11 ? 120 : 255)
  const mask = s.softEdgeReachMask(strip.data, 12, 12, 2, 250)
  assert.equal(mask[11 * 12 + 5], 1, 'the soft row itself')
  assert.equal(mask[9 * 12 + 5], 1, 'two rows back into the opaque part')
  assert.equal(mask[8 * 12 + 5], 0, 'three rows back is out of reach')
  assert.equal(mask[0], 0, 'the far side of the layer is untouched')
  assert.deepEqual([...s.softEdgeReachMask(strip.data, 12, 12, 0, 250)].reduce((a, b) => a + b, 0), 12, 'reach 0 is the soft edge alone')
})
