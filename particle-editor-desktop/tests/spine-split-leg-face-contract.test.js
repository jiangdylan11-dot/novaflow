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
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue
    count += 1
    const x = i % width
    const y = Math.floor(i / width)
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return { count, minX, maxX, minY, maxY }
}

test('one-click split wires automatic leg splitting and a default-off facial feature toggle', () => {
  const source = read(RUNTIME)
  assert.match(source, /includeFaceDetails:\s*false/, 'facial feature splitting must default to off')
  assert.match(source, /data-novaflow-split-face-details/, 'the split dialog must expose the facial feature toggle')
  assert.match(source, /resolve\(\{ mode, steps, faceDetails \}\)/, 'the split dialog returns only the facial toggle; leg splitting is automatic')
  assert.match(source, /splitLegs:\s*true,/, 'leg splitting stays on internally')
  assert.doesNotMatch(source, /data-novaflow-split-legs/, 'the dialog must not expose a leg toggle any more')
  assert.match(source, /if \(state\.splitLegs === false\) return list/, 'the internal switch still short-circuits the leg split')
  assert.match(source, /typeof splitOptions\.faceDetails === 'boolean'\) state\.includeFaceDetails = splitOptions\.faceDetails/)
  assert.match(source, /if \('includeFaceDetails' in options\) state\.includeFaceDetails = !!options\.includeFaceDetails/)
  assert.match(source, /withLegs = await splitSeeThroughLegs\(clean\)[\s\S]{0,200}return await mergeFaceDetailsIntoFace\(withLegs\)/)
  assert.match(source, /catch \(error\) \{\s*console\.warn\('\[NovaFlow\] automatic leg split skipped:'/, 'a leg-split failure must degrade to the plain See-through layers instead of failing the split')
  assert.match(source, /parts\.find\(\(part\) => rawId\(part\) === 'face'\) \|\| parts\.find\(\(part\) => rawId\(part\) === 'head'\)/, 'merge target must be matched by raw See-through id because normalizeId folds face into head')
  assert.match(source, /const faceId = rawId\(face\)/)
  assert.match(read('particle-editor/index.html'), /spine-split-runtime\.js\?v=20260915-split-leg-face-1/)
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

test('legwear with two legs joined at the hip splits into image-left and image-right halves', () => {
  const s = loadRuntime()
  const width = 120
  const height = 200
  const alpha = blankAlpha(width, height)
  fillRect(alpha, width, 30, 89, 20, 45)
  fillRect(alpha, width, 30, 54, 46, 180)
  fillRect(alpha, width, 65, 89, 46, 180)
  const split = s.splitAlphaLeftRight(alpha, width, height)
  assert.ok(split, 'two legs must produce a split')
  assert.ok(split.gapRatio > 0.7, `most rows should be cut at the gap between the legs (${split.gapRatio})`)
  assert.equal(s.legSplitLooksLikeTwoLegs(split), true)
  const left = maskStats(split.imageLeft, width)
  const right = maskStats(split.imageRight, width)
  assert.ok(left.maxX < 60 && right.minX >= 60, 'halves must not cross the centre line')
  assert.equal(left.count + right.count, maskStats(alpha, width).count, 'every pixel must land in exactly one half')
  assert.ok(Math.abs(left.count - right.count) <= 60, 'symmetric legs should split evenly')
})

test('a single visible leg is not split into halves', () => {
  const s = loadRuntime()
  const width = 120
  const height = 200
  const alpha = blankAlpha(width, height)
  fillRect(alpha, width, 40, 64, 20, 180)
  const split = s.splitAlphaLeftRight(alpha, width, height)
  assert.equal(s.legSplitLooksLikeTwoLegs(split), false)
})

test('knee split snaps to the narrowest row near the hint and overlaps thigh and shin slightly', () => {
  const s = loadRuntime()
  const width = 120
  const height = 200
  const mask = new Uint8Array(width * height)
  fillRect(mask, width, 30, 54, 20, 180)
  for (let y = 96; y <= 104; y += 1) for (let x = 30; x <= 54; x += 1) if (x < 34 || x > 50) mask[y * width + x] = 0
  const knee = s.splitMaskAtKnee(mask, width, height, 108)
  assert.ok(knee, 'knee split must succeed')
  assert.ok(knee.kneeY >= 104 && knee.kneeY <= 112, `knee should snap to the narrowing plus ~5% leg length for the joint line (${knee.kneeY})`)
  const thigh = maskStats(knee.thigh, width)
  const shin = maskStats(knee.shin, width)
  assert.equal(thigh.minY, 20)
  assert.equal(shin.maxY, 180)
  assert.ok(thigh.maxY > knee.kneeY && shin.minY < knee.kneeY, 'thigh and shin must overlap at the knee')
  assert.ok(thigh.maxY - shin.minY <= 12, 'overlap must stay small')
})

test('knee split falls back to a proportional cut when no narrowing exists', () => {
  const s = loadRuntime()
  const width = 120
  const height = 200
  const mask = new Uint8Array(width * height)
  fillRect(mask, width, 30, 54, 20, 180)
  const knee = s.splitMaskAtKnee(mask, width, height, null)
  assert.ok(knee)
  assert.ok(Math.abs(knee.kneeY - 104) <= 2, `default cut should sit near 52% of the leg (${knee.kneeY})`)
  assert.equal(s.splitMaskAtKnee(new Uint8Array(width * height), width, height, null), null)
})

test('knee hint uses head-to-sole proportions when head and footwear layers exist', () => {
  const s = loadRuntime()
  const parts = [
    { id: 'head', y: 0, height: 40, dataUrl: 'x' },
    { id: 'legwear', y: 90, height: 90, dataUrl: 'x' },
    { id: 'footwear', y: 180, height: 20, dataUrl: 'x' }
  ]
  const hint = s.seeThroughKneeHint(parts, { minY: 90, maxY: 179 })
  assert.ok(Math.abs(hint - 143) <= 1, `expected knee near 143, got ${hint}`)
  assert.equal(s.seeThroughKneeHint([{ id: 'legwear', y: 90, height: 90, dataUrl: 'x' }], { minY: 90, maxY: 179 }), null)
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

test('knee split refuses to fabricate a thigh or shin when the proportional knee lies outside the layer', () => {
  const s = loadRuntime()
  const width = 120
  const height = 200
  const mask = new Uint8Array(width * height)
  fillRect(mask, width, 30, 54, 20, 180)
  assert.equal(s.splitMaskAtKnee(mask, width, height, 25).belowKnee, true, 'knee above the layer => whole layer is shin')
  assert.equal(s.splitMaskAtKnee(mask, width, height, 176).aboveKnee, true, 'knee below the layer => whole layer is thigh')
  assert.ok(s.splitMaskAtKnee(mask, width, height, 100).thigh, 'knee inside the layer still splits')
})

test('a single wide leg without a midline valley is not split in halves, two touching legs with a valley are', () => {
  const s = loadRuntime()
  const width = 200
  const height = 200
  const wide = blankAlpha(width, height)
  fillRect(wide, width, 40, 139, 20, 180)
  const wideSplit = s.splitAlphaLeftRight(wide, width, height)
  assert.ok(wideSplit && wideSplit.aspect >= 0.45, 'wide blob has a large aspect')
  assert.equal(s.legSplitLooksLikeTwoLegs(wideSplit), false)
  const touching = blankAlpha(width, height)
  fillRect(touching, width, 40, 139, 20, 100)
  fillRect(touching, width, 40, 84, 101, 180)
  fillRect(touching, width, 95, 139, 101, 180)
  const touchingSplit = s.splitAlphaLeftRight(touching, width, height)
  assert.equal(s.legSplitLooksLikeTwoLegs(touchingSplit), true)
})
