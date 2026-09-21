const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { loadSpine } = require('../../tools/qwen-rapid-migration-smoke.cjs')

const root = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const RUNTIME = 'particle-editor/spine-split-runtime.js'

function loadRuntime() {
  const s = loadSpine(RUNTIME)
  s.PRESETS = []
  return s
}

function blankAlpha(width, height) {
  return new Uint8ClampedArray(width * height)
}

function fillRect(alpha, width, x0, x1, y0, y1) {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) alpha[y * width + x] = 255
}

function maskStats(mask, width) {
  let count = 0
  let minX = Infinity
  let maxX = -Infinity
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue
    count += 1
    const x = i % width
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
  }
  return { count, minX, maxX }
}

test('one-click split keeps legs whole, splits only the feet, and exposes a default-off facial feature toggle', () => {
  const source = read(RUNTIME)
  assert.match(source, /includeFaceDetails:\s*false/, 'facial feature splitting must default to off')
  assert.match(source, /data-novaflow-split-face-details/, 'the split dialog must expose the facial feature toggle')
  assert.match(source, /resolve\(\{ mode, steps, faceDetails \}\)/, 'the split dialog returns only the facial toggle')
  assert.match(source, /typeof splitOptions\.faceDetails === 'boolean'\) state\.includeFaceDetails = splitOptions\.faceDetails/)
  assert.match(source, /if \('includeFaceDetails' in options\) state\.includeFaceDetails = !!options\.includeFaceDetails/)
  assert.doesNotMatch(source, /data-novaflow-split-legs/, 'no leg toggle in the dialog')
  assert.doesNotMatch(source, /splitSeeThroughLegwear|splitMaskAtKnee|seeThroughKneeHint|legSplitLooksLikeTwoLegs|state\.splitLegs/, 'automatic leg splitting must be gone')
  assert.match(source, /withFeet = await splitSeeThroughFeet\(clean\)[\s\S]{0,220}stacked = await mergeFaceDetailsIntoFace\(withFeet\)/)
  assert.match(source, /catch \(error\) \{\s*console\.warn\('\[NovaFlow\] automatic foot split skipped:'/, 'a foot-split failure must degrade to the plain See-through layers instead of failing the split')
  assert.match(source, /parts\.find\(\(part\) => rawId\(part\) === 'face'\) \|\| parts\.find\(\(part\) => rawId\(part\) === 'head'\)/, 'merge target must be matched by raw See-through id because normalizeId folds face into head')
  assert.match(source, /const faceId = rawId\(face\)/)
  assert.match(read('particle-editor/index.html'), /spine-split-runtime\.js\?v=\d{8}-[a-z0-9-]+/, 'the split Runtime must stay cache-busted (exact tag is owned by the provider contract test)')
})

test('facial feature ids cover See-through eye, brow, ear, nose and mouth layers but not accessories', () => {
  const s = loadRuntime()
  for (const id of ['eyebrow_l', 'eyebrow_r', 'eyewhite_l', 'irides_r', 'eyelash_l', 'ears_l', 'ears_r', 'nose', 'mouth', 'eyes', 'eyel', 'browr']) {
    assert.equal(s.facialFeatureId(id), true, id)
  }
  for (const id of ['eyewear', 'earwear', 'face', 'head', 'hair_front', 'legwear']) {
    assert.equal(s.facialFeatureId(id), false, id)
  }
})

test('side naming follows the See-through character perspective used by handwear-l/r', () => {
  const s = loadRuntime()
  assert.equal(s.seeThroughSideName('imageLeft'), 'right')
  assert.equal(s.seeThroughSideName('imageRight'), 'left')
})

test('two feet touching at the ankles are cut at the gap between them and every pixel lands in exactly one half', () => {
  const s = loadRuntime()
  const width = 120
  const height = 60
  const alpha = blankAlpha(width, height)
  fillRect(alpha, width, 30, 89, 10, 15)
  fillRect(alpha, width, 30, 54, 16, 50)
  fillRect(alpha, width, 65, 89, 16, 50)
  const split = s.splitAlphaLeftRight(alpha, width, height)
  assert.ok(split, 'two feet must produce a split')
  assert.ok(split.gapRatio > 0.7, `most rows should be cut at the gap (${split.gapRatio})`)
  const left = maskStats(split.imageLeft, width)
  const right = maskStats(split.imageRight, width)
  assert.ok(left.maxX < 60 && right.minX >= 60, 'halves must not cross the centre line')
  assert.equal(left.count + right.count, maskStats(alpha, width).count, 'every pixel must land in exactly one half')
})

test('facial layers are kept untouched when there is no face or head layer to merge into', async () => {
  const s = loadRuntime()
  s.SPINE_LAYER_ORDER = {}
  s.state = { includeFaceDetails: false }
  const parts = [
    { id: 'eyebrow_l', name: 'eyebrow_l', dataUrl: 'x', layer: 69 },
    { id: 'body', name: 'body', dataUrl: 'x', layer: 50 },
    { id: 'mouth', name: 'mouth', dataUrl: 'x', layer: 68 }
  ]
  const merged = await s.mergeFaceDetailsIntoFace(parts)
  assert.deepEqual(merged.map((part) => part.id).sort(), ['body', 'eyebrow_l', 'mouth'])
  assert.match(read(RUNTIME), /const drawOrder = \[\.\.\.normalizeSpineLayerOrder\(details\.filter\(isEar\)\), face, /, 'ears must be composited behind the face like See-through does')
})
