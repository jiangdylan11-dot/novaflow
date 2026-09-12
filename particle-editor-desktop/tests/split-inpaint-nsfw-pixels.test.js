const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const helperPath = path.resolve(__dirname, '../../particle-editor/split-inpaint-nsfw-pixels.helper.js')
let loadNonce = 0

async function loadHelper() {
  loadNonce += 1
  await import(`${pathToFileURL(helperPath).href}?test=${loadNonce}`)
  return globalThis.NovaFlowSplitInpaintNsfwPixels
}

function solidRgba(width, height, rgb, alpha = 255) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = rgb[0]
    pixels[i + 1] = rgb[1]
    pixels[i + 2] = rgb[2]
    pixels[i + 3] = alpha
  }
  return pixels
}

function setPixel(pixels, width, x, y, rgba) {
  const i = (y * width + x) * 4
  pixels.set(rgba, i)
}

function pixel(pixels, width, x, y) {
  const i = (y * width + x) * 4
  return Array.from(pixels.slice(i, i + 4))
}

function fillMaskRect(mask, width, left, top, right, bottom) {
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) setPixel(mask, width, x, y, [255, 255, 255, 255])
  }
}

function compositeRgb(rgba, background) {
  const amount = rgba[3] / 255
  return rgba.slice(0, 3).map((value, index) => Math.round(value * amount + background[index] * (1 - amount)))
}

function rgbDistance(a, b) {
  return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0)
}

test('completion joins truncated subjects without a colour step at the source cut', async () => {
  const api = await loadHelper()
  const width = 64, height = 96
  const original = solidRgba(width, height, [255, 255, 255])
  const guide = solidRgba(width, height, [0, 0, 0], 0)
  const generated = solidRgba(width, height, [0, 0, 0], 0)
  const mask = solidRgba(width, height, [0, 0, 0])
  fillMaskRect(mask, width, 0, 30, 63, 95)
  for (let y = 0; y < height; y += 1) {
    for (let x = 8; x < 56; x += 1) {
      if (x >= 28 && x < 36) continue
      setPixel(generated, width, x, y, [200, 155, 130, 255])
      if (y < 48) {
        setPixel(original, width, x, y, x < 28 ? [140, 95, 70, 255] : [245, 200, 175, 255])
        setPixel(guide, width, x, y, [140, 95, 70, 255])
      }
    }
  }
  const args = {width, height, generatedRgba:generated, originalRgba:original, maskRgba:mask,
    subjectGuideRgba:guide, ringWidth:32, falloffExponent:0.5, restoreAlpha:true}
  const before = api.blendSubjectJoinRgb(args).pixels
  const after = api.blendSubjectJoinRgb({...args, sourceEdgeFeather:16}).pixels
  for (const x of [18, 46]) {
    const jump = data => rgbDistance(pixel(data,width,x,46).slice(0,3), pixel(data,width,x,47).slice(0,3))
    assert.ok(jump(before) > 50, 'fixture must reproduce the binary source-guide seam')
    assert.ok(jump(after) <= 12, 'correction must continue smoothly across the source cut')
    assert.deepEqual(pixel(after,width,x,30),pixel(original,width,x,30), 'mask entrance matches source')
    assert.deepEqual(pixel(after,width,x,70),pixel(generated,width,x,70), 'distant generated content is preserved')
  }
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const p=(y*width+x)*4
    if(y<30) assert.deepEqual(pixel(after,width,x,y),pixel(generated,width,x,y), 'unselected pixels stay unchanged')
    assert.equal(after[p+3],generated[p+3], 'joining must not bridge transparent background or alter opaque alpha')
  }
  assert.throws(()=>api.blendSubjectJoinRgb({...args, sourceEdgeFeather:33}), /source edge feather/)
})

test('NSFW foreground de-matte removes white contamination without changing alpha or opaque white content', async () => {
  const api = await loadHelper()
  const source = new Uint8ClampedArray([
    218, 178, 168, 128,
    255, 255, 255, 255,
    255, 255, 255, 128,
    245, 235, 250, 128,
    250, 240, 230, 24,
    18, 17, 16, 24,
    0, 0, 0, 0,
  ])
  const snapshot = Array.from(source)
  const result = api.removeWhiteMatteRgb(source)

  assert.deepEqual(Array.from(source), snapshot, 'source pixels must not be mutated')
  assert.equal(result.changedPixels, 2)
  assert.deepEqual(Array.from(result.pixels.slice(0, 4)), [181, 102, 82, 128])
  assert.deepEqual(Array.from(result.pixels.slice(4, 8)), [255, 255, 255, 255])
  assert.deepEqual(Array.from(result.pixels.slice(8, 12)), [255, 255, 255, 128])
  assert.deepEqual(Array.from(result.pixels.slice(12, 16)), [235, 215, 245, 128])
  assert.deepEqual(Array.from(result.pixels.slice(16, 20)), [250, 240, 230, 24])
  assert.deepEqual(Array.from(result.pixels.slice(20, 24)), [18, 17, 16, 24])
  assert.deepEqual(Array.from(result.pixels.slice(24, 28)), [0, 0, 0, 0])
  for (let i = 3; i < source.length; i += 4) {
    assert.equal(result.pixels[i], source[i], `alpha byte ${i} must remain unchanged`)
  }
})

test('NSFW foreground de-matte respects the original hard user mask and preserves mask holes', async () => {
  const api = await loadHelper()
  const source = new Uint8ClampedArray([
    218, 178, 168, 128,
    218, 178, 168, 128,
    218, 178, 168, 128,
  ])
  const mask = new Uint8ClampedArray([
    255, 255, 255, 255,
    0, 0, 0, 255,
    255, 255, 255, 0,
  ])
  const result = api.removeWhiteMatteRgb(source, mask)

  assert.equal(result.changedPixels, 1)
  assert.deepEqual(Array.from(result.pixels.slice(0, 4)), [181, 102, 82, 128])
  assert.deepEqual(Array.from(result.pixels.slice(4, 8)), [218, 178, 168, 128])
  assert.deepEqual(Array.from(result.pixels.slice(8, 12)), [218, 178, 168, 128])
})

test('NSFW foreground de-matte rejects physically impossible white-matte inversions', async () => {
  const api = await loadHelper()
  const source = new Uint8ClampedArray([
    180, 180, 180, 48,
    200, 100, 200, 128,
  ])
  const result = api.removeWhiteMatteRgb(source)

  assert.equal(result.changedPixels, 0)
  assert.deepEqual(Array.from(result.pixels), Array.from(source))
})

test('NSFW subject join blends only the inner user-mask ring and preserves every alpha byte', async () => {
  const api = await loadHelper()
  const width = 7
  const height = 7
  const generated = solidRgba(width, height, [200, 220, 240], 200)
  const original = solidRgba(width, height, [100, 120, 140], 255)
  const mask = solidRgba(width, height, [0, 0, 0], 255)
  const guide = solidRgba(width, height, [11, 22, 33], 255)
  fillMaskRect(mask, width, 1, 1, 5, 5)
  const snapshots = [generated, original, mask, guide].map((value) => Array.from(value))
  const result = api.blendSubjectJoinRgb({
    generatedRgba: generated,
    originalRgba: original,
    maskRgba: mask,
    subjectGuideRgba: guide,
    width,
    height,
    ringWidth: 2,
  })

  assert.deepEqual(pixel(result.pixels, width, 1, 3), [133, 153, 173, 200])
  assert.deepEqual(pixel(result.pixels, width, 2, 3), [167, 187, 207, 200])
  assert.deepEqual(pixel(result.pixels, width, 3, 3), [200, 220, 240, 200])
  assert.deepEqual(pixel(result.pixels, width, 0, 3), [200, 220, 240, 200])
  assert.equal(result.joinPixels, 24)
  assert.equal(result.changedPixels, 24)
  for (let i = 3; i < result.pixels.length; i += 4) assert.equal(result.pixels[i], generated[i])
  for (let index = 0; index < snapshots.length; index += 1) {
    assert.deepEqual(Array.from([generated, original, mask, guide][index]), snapshots[index])
  }

  const originalComposite = pixel(original, width, 1, 3).slice(0, 3)
  for (const background of [[255, 255, 255], [0, 0, 0], [127, 127, 127]]) {
    const before = compositeRgb(pixel(generated, width, 1, 3), background)
    const after = compositeRgb(pixel(result.pixels, width, 1, 3), background)
    assert.ok(rgbDistance(after, originalComposite) < rgbDistance(before, originalComposite))
  }
})

test('NSFW subject join excludes the guide silhouette and still blends true white subject pixels', async () => {
  const api = await loadHelper()
  const width = 7
  const height = 7
  const generated = solidRgba(width, height, [30, 60, 90], 255)
  const original = solidRgba(width, height, [120, 150, 180], 255)
  const mask = solidRgba(width, height, [0, 0, 0], 255)
  const guide = solidRgba(width, height, [255, 255, 255], 0)
  fillMaskRect(mask, width, 1, 1, 5, 5)
  for (let y = 1; y <= 5; y += 1) {
    for (let x = 2; x <= 4; x += 1) setPixel(guide, width, x, y, [255, 255, 255, 255])
  }
  let result = api.blendSubjectJoinRgb({
    generatedRgba: generated,
    originalRgba: original,
    maskRgba: mask,
    subjectGuideRgba: guide,
    width,
    height,
    ringWidth: 2,
  })

  assert.deepEqual(pixel(result.pixels, width, 1, 3), [30, 60, 90, 255], 'background must not be color matched')
  assert.deepEqual(pixel(result.pixels, width, 2, 3), [30, 60, 90, 255], 'guide silhouette must not be color matched')
  assert.deepEqual(pixel(result.pixels, width, 3, 2), [60, 90, 120, 255], 'safe guide interior may blend')

  setPixel(original, width, 3, 2, [255, 255, 255, 255])
  result = api.blendSubjectJoinRgb({
    generatedRgba: generated,
    originalRgba: original,
    maskRgba: mask,
    subjectGuideRgba: guide,
    width,
    height,
    ringWidth: 2,
  })
  assert.deepEqual(pixel(result.pixels, width, 3, 2), [105, 125, 145, 255], 'white clothing is valid when the guide marks subject interior')
})

test('NSFW subject join supports four pixels, respects mask holes, and is a no-op without safe subject interior', async () => {
  const api = await loadHelper()
  const width = 11
  const height = 11
  const generated = solidRgba(width, height, [200, 200, 200], 128)
  const original = solidRgba(width, height, [100, 100, 100], 255)
  const mask = solidRgba(width, height, [0, 0, 0], 255)
  const guide = solidRgba(width, height, [0, 0, 0], 255)
  fillMaskRect(mask, width, 1, 1, 9, 9)
  const result = api.blendSubjectJoinRgb({
    generatedRgba: generated,
    originalRgba: original,
    maskRgba: mask,
    subjectGuideRgba: guide,
    width,
    height,
    ringWidth: 4,
  })

  assert.deepEqual(pixel(result.pixels, width, 1, 5), [120, 120, 120, 128])
  assert.deepEqual(pixel(result.pixels, width, 2, 5), [140, 140, 140, 128])
  assert.deepEqual(pixel(result.pixels, width, 3, 5), [160, 160, 160, 128])
  assert.deepEqual(pixel(result.pixels, width, 4, 5), [180, 180, 180, 128])
  assert.deepEqual(pixel(result.pixels, width, 5, 5), [200, 200, 200, 128])

  const maskWithHole = new Uint8ClampedArray(mask)
  setPixel(maskWithHole, width, 5, 5, [0, 0, 0, 255])
  const withHole = api.blendSubjectJoinRgb({
    generatedRgba: generated,
    originalRgba: original,
    maskRgba: maskWithHole,
    subjectGuideRgba: guide,
    width,
    height,
    ringWidth: 4,
  })
  assert.deepEqual(pixel(withHole.pixels, width, 5, 5), [200, 200, 200, 128])
  assert.deepEqual(pixel(withHole.pixels, width, 5, 4), [120, 120, 120, 128], 'an internal hole creates its own depth-one boundary')

  const guideWithHole = new Uint8ClampedArray(guide)
  setPixel(guideWithHole, width, 3, 5, [0, 0, 0, 0])
  const withGuideHole = api.blendSubjectJoinRgb({
    generatedRgba: generated,
    originalRgba: original,
    maskRgba: mask,
    subjectGuideRgba: guideWithHole,
    width,
    height,
    ringWidth: 4,
  })
  assert.deepEqual(pixel(withGuideHole.pixels, width, 3, 5), [200, 200, 200, 128])
  assert.deepEqual(pixel(withGuideHole.pixels, width, 4, 5), [200, 200, 200, 128], 'guide erosion excludes pixels adjacent to an internal alpha hole')

  const unsafeGuide = solidRgba(width, height, [0, 0, 0], 0)
  setPixel(unsafeGuide, width, 5, 5, [0, 0, 0, 255])
  const noOp = api.blendSubjectJoinRgb({
    generatedRgba: generated,
    originalRgba: original,
    maskRgba: mask,
    subjectGuideRgba: unsafeGuide,
    width,
    height,
    ringWidth: 4,
  })
  assert.equal(noOp.changedPixels, 0)
  assert.equal(noOp.joinPixels, 0)
  assert.deepEqual(Array.from(noOp.pixels), Array.from(generated))
})

test('NSFW completion subject join supports the thirty-two-pixel endpoint without changing depth thirty-three', async () => {
  const api = await loadHelper()
  const width = 67
  const height = 67
  const generated = solidRgba(width, height, [200, 200, 200], 254)
  const original = solidRgba(width, height, [100, 100, 100], 255)
  const mask = solidRgba(width, height, [0, 0, 0], 255)
  const guide = solidRgba(width, height, [0, 0, 0], 255)
  fillMaskRect(mask, width, 1, 1, 65, 65)
  const result = api.blendSubjectJoinRgb({
    generatedRgba: generated,
    originalRgba: original,
    maskRgba: mask,
    subjectGuideRgba: guide,
    width,
    height,
    ringWidth: 32,
  })

  assert.deepEqual(pixel(result.pixels, width, 1, 33), [103, 103, 103, 254])
  assert.deepEqual(pixel(result.pixels, width, 16, 33), [148, 148, 148, 254])
  assert.deepEqual(pixel(result.pixels, width, 32, 33), [197, 197, 197, 254])
  assert.deepEqual(pixel(result.pixels, width, 33, 33), [200, 200, 200, 254])
  assert.equal(result.joinPixels, 4224)
})

test('NSFW subject join depth uses eight-neighbor boundaries', async () => {
  const api = await loadHelper()
  const width = 5
  const height = 5
  const generated = solidRgba(width, height, [200, 200, 200], 255)
  const original = solidRgba(width, height, [100, 100, 100], 255)
  const mask = solidRgba(width, height, [0, 0, 0], 255)
  const guide = solidRgba(width, height, [0, 0, 0], 255)
  for (const [x, y] of [[2, 2], [2, 1], [2, 3], [1, 2], [3, 2]]) {
    setPixel(mask, width, x, y, [255, 255, 255, 255])
  }

  const result = api.blendSubjectJoinRgb({
    generatedRgba: generated,
    originalRgba: original,
    maskRgba: mask,
    subjectGuideRgba: guide,
    width,
    height,
    ringWidth: 2,
  })

  assert.deepEqual(pixel(result.pixels, width, 2, 2), [133, 133, 133, 255], 'diagonal background makes the center depth one')
  assert.equal(result.joinPixels, 5)
})

test('NSFW subject guide uses the alpha 127/128 boundary consistently', async () => {
  const api = await loadHelper()
  const width = 9
  const height = 9
  const generated = solidRgba(width, height, [200, 200, 200], 255)
  const original = solidRgba(width, height, [100, 100, 100], 255)
  const mask = solidRgba(width, height, [0, 0, 0], 255)
  fillMaskRect(mask, width, 1, 1, 7, 7)

  for (const [alpha, expectedJoinPixels] of [[127, 0], [128, 5]]) {
    const guide = solidRgba(width, height, [255, 255, 255], 0)
    for (let y = 1; y <= 7; y += 1) {
      for (let x = 1; x <= 7; x += 1) {
        if (Math.abs(x - 4) + Math.abs(y - 4) <= 3) setPixel(guide, width, x, y, [255, 255, 255, alpha])
      }
    }
    const result = api.blendSubjectJoinRgb({
      generatedRgba: generated,
      originalRgba: original,
      maskRgba: mask,
      subjectGuideRgba: guide,
      width,
      height,
      ringWidth: 4,
      guideAlphaThreshold: 128,
    })
    assert.equal(result.joinPixels, expectedJoinPixels, `guide alpha ${alpha}`)
  }
})

test('NSFW subject join restores missing alpha only inside the safe source-subject ring', async () => {
  const api = await loadHelper()
  const width = 7
  const height = 7
  const generated = solidRgba(width, height, [0, 0, 0], 0)
  const original = solidRgba(width, height, [100, 120, 140], 255)
  const mask = solidRgba(width, height, [0, 0, 0], 255)
  const guide = solidRgba(width, height, [255, 255, 255], 255)
  fillMaskRect(mask, width, 1, 1, 5, 5)
  setPixel(generated, width, 1, 1, [240, 240, 240, 255])
  setPixel(generated, width, 2, 2, [240, 240, 240, 200])
  setPixel(guide, width, 2, 2, [255, 255, 255, 128])
  const snapshots = [generated, original, mask, guide].map((value) => Array.from(value))

  const result = api.blendSubjectJoinRgb({
    generatedRgba: generated,
    originalRgba: original,
    maskRgba: mask,
    subjectGuideRgba: guide,
    width,
    height,
    ringWidth: 2,
    guideAlphaThreshold: 128,
    falloffExponent: 0.5,
    restoreAlpha: true,
  })

  assert.deepEqual(pixel(result.pixels, width, 1, 3), [100, 120, 140, 208], 'restored alpha must use original RGB instead of transparent black')
  assert.deepEqual(pixel(result.pixels, width, 2, 3), [100, 120, 140, 147], 'second join layer must remain neutral when composited over the original')
  assert.deepEqual(pixel(result.pixels, width, 3, 3), [0, 0, 0, 0], 'pixels deeper than the ring stay untouched')
  assert.deepEqual(pixel(result.pixels, width, 0, 3), [0, 0, 0, 0], 'mask exterior stays untouched')
  assert.equal(pixel(result.pixels, width, 1, 1)[3], 255, 'existing opaque alpha must never be lowered')
  assert.equal(pixel(result.pixels, width, 2, 2)[3], 200, 'guide alpha below generated alpha must never lower it')
  for (let i = 3; i < result.pixels.length; i += 4) {
    assert.ok(result.pixels[i] >= generated[i], `alpha byte ${i} must only stay equal or increase`)
  }
  for (let index = 0; index < snapshots.length; index += 1) {
    assert.deepEqual(Array.from([generated, original, mask, guide][index]), snapshots[index], `input ${index} must remain unchanged`)
  }
  assert.equal(result.joinPixels, 24)
  assert.equal(result.alphaRaisedPixels, 22)
  assert.equal(result.changedPixels, 24)
})

test('pixel helper rejects malformed RGBA input instead of silently corrupting a canvas', async () => {
  const api = await loadHelper()
  assert.throws(() => api.removeWhiteMatteRgb(null), /RGBA/i)
  assert.throws(() => api.removeWhiteMatteRgb([1, 2, 3]), /RGBA/i)
  assert.throws(() => api.removeWhiteMatteRgb('1234'), /RGBA/i)
  assert.doesNotThrow(() => api.removeWhiteMatteRgb([0, 0, 0, 255]))
  const sparse = new Array(4)
  sparse[3] = 255
  assert.throws(() => api.removeWhiteMatteRgb(sparse), /byte RGBA/i)
  assert.throws(() => api.removeWhiteMatteRgb([0, 0, 0, 256]), /byte RGBA/i)
  assert.throws(() => api.removeWhiteMatteRgb(new Float32Array([0, 0, 0, 0.5])), /byte RGBA/i)
  assert.throws(() => api.removeWhiteMatteRgb(new Uint8ClampedArray(8), new Uint8ClampedArray(4)), /matching RGBA mask/i)
  const valid = new Uint8ClampedArray(4 * 4 * 4)
  assert.throws(() => api.blendSubjectJoinRgb({
    generatedRgba: valid,
    originalRgba: valid,
    maskRgba: valid,
    subjectGuideRgba: valid,
    width: 0,
    height: 4,
    ringWidth: 2,
  }), /width.*height/i)
  assert.throws(() => api.blendSubjectJoinRgb({
    generatedRgba: valid,
    originalRgba: valid.slice(4),
    maskRgba: valid,
    subjectGuideRgba: valid,
    width: 4,
    height: 4,
    ringWidth: 2,
  }), /matching RGBA/i)
  for (const ringWidth of [1, 33, 2.5]) {
    assert.throws(() => api.blendSubjectJoinRgb({
      generatedRgba: valid,
      originalRgba: valid,
      maskRgba: valid,
      subjectGuideRgba: valid,
      width: 4,
      height: 4,
      ringWidth,
    }), /ringWidth/i)
  }
})

test('subject join confines its byte depth allocation to the expanded mask ROI', async () => {
  const api = await loadHelper()
  const width = 100
  const height = 80
  const generated = solidRgba(width, height, [200, 200, 200], 255)
  const original = solidRgba(width, height, [100, 100, 100], 255)
  const mask = solidRgba(width, height, [0, 0, 0], 255)
  const guide = solidRgba(width, height, [0, 0, 0], 255)
  fillMaskRect(mask, width, 40, 30, 49, 39)
  const NativeUint8Array = globalThis.Uint8Array
  const NativeInt32Array = globalThis.Int32Array
  const byteAllocations = []
  const intAllocations = []
  globalThis.Uint8Array = class TrackingUint8Array extends NativeUint8Array {
    constructor(...args) {
      super(...args)
      byteAllocations.push(this.length)
    }
  }
  globalThis.Int32Array = class TrackingInt32Array extends NativeInt32Array {
    constructor(...args) {
      super(...args)
      intAllocations.push(this.length)
    }
  }
  let result
  try {
    result = api.blendSubjectJoinRgb({
      generatedRgba: generated,
      originalRgba: original,
      maskRgba: mask,
      subjectGuideRgba: guide,
      width,
      height,
      ringWidth: 4,
    })
  } finally {
    globalThis.Uint8Array = NativeUint8Array
    globalThis.Int32Array = NativeInt32Array
  }

  assert.equal(result.pixels.length, width * height * 4)
  assert.deepEqual(byteAllocations, [12 * 12], 'the only byte work map must match the one-pixel-expanded ROI')
  assert.deepEqual(intAllocations, [], 'subject join must not allocate an Int32 frontier')
  assert.ok(byteAllocations.every((length) => length < width * height), 'no byte work map may cover the full canvas')

  const source = require('node:fs').readFileSync(helperPath, 'utf8')
  assert.doesNotMatch(source, /new Int32Array\((?:total|width \* height)\)/)
  assert.match(source, /new Int32Array\(roiWidth \* roiHeight\)/, 'completion propagation stays bounded to the mask ROI')
  assert.doesNotMatch(source, /const (?:maskValues|inside|guideVisible|guideInterior) = new Uint8Array\(total\)/)
})
