const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { loadSpine } = require('../../tools/qwen-rapid-migration-smoke.cjs')

const root = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const RUNTIME = 'particle-editor/spine-split-runtime.js'

const FRAME = 12

function layer(x, y, width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), x, y, width, height }
}

function setAlpha(target, column, row, alpha) {
  target.data[(row * target.width + column) * 4 + 3] = alpha
}

function alphaAt(target, column, row) {
  return target.data[(row * target.width + column) * 4 + 3]
}

// What the canvas, the PSD and Spine all do with the stack: source-over, bottom layer first.
function coverage(layers) {
  const open = new Float64Array(FRAME * FRAME).fill(1)
  for (const item of layers) {
    for (let row = 0; row < item.height; row += 1) {
      for (let column = 0; column < item.width; column += 1) {
        open[(item.y + row) * FRAME + (item.x + column)] *= 1 - alphaAt(item, column, row) / 255
      }
    }
  }
  return Array.from(open, (value) => 1 - value)
}

test('one-click split seals the layer seams after the feet and the face are settled', () => {
  const source = read(RUNTIME)
  assert.match(source, /stacked = await mergeFaceDetailsIntoFace\(withFeet\)[\s\S]{0,220}return await sealSeeThroughLayerSeams\(stacked\)/, 'the seal must run on the final stack, after the foot split and the face merge')
  assert.match(source, /catch \(error\) \{\s*console\.warn\('\[NovaFlow\] layer seam seal skipped:'[\s\S]{0,80}return stacked/, 'a seal failure must degrade to the unsealed layers instead of failing the split')
  assert.match(source, /const changed = sealLayerStackSeams\(layers, size\.width, size\.height\)/)
  assert.match(source, /seamSeal: 'additive-to-over'/, 'a sealed layer must say so in its metadata')
})

test('a cut shared between two layers closes, and the figure keeps its soft outer edge', () => {
  const s = loadSpine(RUNTIME)
  // See-through hands over a leg and a foot that meet on one row, each carrying half of the coverage.
  const foot = layer(0, 6, FRAME, 6)
  const leg = layer(0, 0, FRAME, 7)
  for (let column = 2; column < 10; column += 1) {
    for (let row = 0; row < 6; row += 1) setAlpha(leg, column, row, 255)
    setAlpha(leg, column, 6, 128)
    setAlpha(foot, column, 0, 127)
    for (let row = 1; row < 5; row += 1) setAlpha(foot, column, row, 255)
    setAlpha(foot, column, 5, 96)
  }
  const before = coverage([foot, leg])
  assert.ok(before[6 * FRAME + 5] < 0.8, `the cut starts short of full coverage (${before[6 * FRAME + 5]})`)

  const changed = s.sealLayerStackSeams([foot, leg], FRAME, FRAME)
  const after = coverage([foot, leg])

  assert.equal(after[6 * FRAME + 5], 1, 'the cut row must end up fully covered so the canvas cannot show through it')
  assert.equal(alphaAt(leg, 5, 6), 128, 'the layer on top of the cut keeps its own alpha')
  assert.equal(alphaAt(foot, 5, 0), 255, 'the layer underneath carries the rest of the cut')
  assert.equal(changed[1], 0, 'nothing above the top layer, nothing to seal')
  assert.equal(alphaAt(foot, 5, 5), 96, 'the figure\'s outer edge has nothing over it and keeps its feather')
  assert.equal(after[11 * FRAME + 5], before[11 * FRAME + 5], 'so the silhouette renders exactly as before')
})

test('a soft edge lying over opaque material is left alone', () => {
  const s = loadSpine(RUNTIME)
  // An eyelash fading onto an opaque face: the stack already covers every pixel, nothing shows through,
  // and hardening the face under it would only cost the lash its edge once animation moves the two apart.
  const face = layer(0, 0, FRAME, FRAME)
  const lash = layer(3, 3, 6, 6)
  for (let row = 0; row < FRAME; row += 1) for (let column = 0; column < FRAME; column += 1) setAlpha(face, column, row, 255)
  for (let row = 0; row < 6; row += 1) for (let column = 0; column < 6; column += 1) setAlpha(lash, column, row, row === 0 || row === 5 ? 90 : 255)

  const changed = s.sealLayerStackSeams([face, lash], FRAME, FRAME)
  assert.deepEqual([...changed], [0, 0], 'no alpha may move where the stack is already opaque')
  assert.equal(alphaAt(face, 5, 3), 255)
  assert.equal(alphaAt(lash, 2, 0), 90, 'the lash keeps its feather')
})

test('a hole the layers never covered is left as a hole', () => {
  const s = loadSpine(RUNTIME)
  // The gap between two fan ribs is background the artist drew, not a seam. Only one layer borders it,
  // so there is no coverage to hand over and the seal must not paint it in.
  const fan = layer(0, 0, FRAME, FRAME)
  for (let row = 2; row < 10; row += 1) for (let column = 2; column < 10; column += 1) setAlpha(fan, column, row, column === 6 ? 0 : 255)

  assert.deepEqual([...s.sealLayerStackSeams([fan], FRAME, FRAME)], [0])
  assert.equal(alphaAt(fan, 6, 5), 0, 'the gap stays open')
  assert.equal(coverage([fan])[5 * FRAME + 6], 0)
})
