import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
require('../particle-editor/aifx-material-identity.resource.js')
const resource = globalThis.NovaFlowAifxMaterialIdentityResource

assert.ok(resource)
assert.equal(resource.version, 'novaflow-aifx-material-identity-v3')
assert.equal(typeof resource.createTilePermutation, 'function')
assert.equal(typeof resource.selectPeakMaterialPatch, 'function')
assert.equal(typeof resource.buildPeakMaterialToken, 'function')

const tilePermutation = resource.createTilePermutation(8)
assert.equal(tilePermutation.length, 64)
assert.equal(new Set(tilePermutation).size, 64)
for (let index = 0; index < tilePermutation.length; index += 1) {
  const right = index % 8 < 7 ? index + 1 : -1
  const down = index + 8 < tilePermutation.length ? index + 8 : -1
  for (const neighbor of [right, down].filter((value) => value >= 0)) {
    const sourceDelta = Math.abs(tilePermutation[index] - tilePermutation[neighbor])
    assert.notEqual(sourceDelta, 1, 'adjacent output tiles must not preserve a contiguous source contour')
    assert.notEqual(sourceDelta, 8, 'adjacent output tiles must not preserve a contiguous source contour')
  }
}

const width = 96
const height = 64
const pixels = new Uint8ClampedArray(width * height * 4)
for (let y = 16; y < 48; y += 1) {
  for (let x = 24; x < 72; x += 1) {
    if (Math.abs(y - (20 + (x - 24) * 0.45)) > 7) continue
    const offset = (y * width + x) * 4
    pixels[offset] = 20
    pixels[offset + 1] = 180 + ((x + y) % 60)
    pixels[offset + 2] = 255
    pixels[offset + 3] = 255
  }
}

const patch = resource.selectPeakMaterialPatch(pixels, width, height, { patchSize: 40 })
assert.equal(patch.size, 40)
assert.ok(patch.activeRatio >= 0.12)
assert.ok(patch.x < 72 && patch.x + patch.size > 24)
assert.ok(patch.y < 48 && patch.y + patch.size > 16)

class FakeCanvas {
  constructor(canvasWidth, canvasHeight) {
    this.width = canvasWidth
    this.height = canvasHeight
    this.source = null
  }

  getContext() {
    const canvas = this
    return {
      clearRect() {},
      fillRect() {},
      drawImage(image) { canvas.source = image },
      getImageData() {
        return { data: canvas.source?.data || new Uint8ClampedArray(canvas.width * canvas.height * 4) }
      },
      createRadialGradient() {
        return { addColorStop() {} }
      },
      set fillStyle(value) {},
      set globalCompositeOperation(value) {},
      set imageSmoothingEnabled(value) {},
      set imageSmoothingQuality(value) {},
    }
  }

  toDataURL() {
    return 'data:image/png;base64,VE9LRU4='
  }
}

const token = resource.buildPeakMaterialToken({ width, height, data: pixels }, {
  createCanvas: (canvasWidth, canvasHeight) => new FakeCanvas(canvasWidth, canvasHeight),
  name: 'contract_peak_material_token.png',
  patchSize: 40,
})
assert.equal(token.name, 'contract_peak_material_token.png')
assert.equal(token.role, 'generated-peak-material-token')
assert.equal(token.sourceRole, 'accepted-generated-peak')
assert.equal(token.width, 512)
assert.equal(token.height, 512)
assert.equal(token.tileGrid, 8)
assert.equal(token.tileCount, 64)
assert.equal(token.sourcePatchScrambled, true)
assert.equal(token.maximumCoherentSourceFraction, 1 / 64)
assert.equal(token.sourceSilhouetteBoundaryRetained, false)
assert.equal(token.genericTokenWindow, 'radial-feather')
assert.equal(token.materialExtent, 96)
assert.equal(token.pureBlackSafetyMargin, 208)
assert.equal(token.spatialSilhouetteRemoved, true)
assert.equal(token.macroLayoutRemoved, true)
assert.equal(token.fullPeakImageSent, false)
assert.equal(token.templatePixelsUsed, false)
assert.equal(token.conditioningOnly, true)
assert.match(token.dataUrl, /^data:image\/png;base64,/)
assert.throws(
  () => resource.selectPeakMaterialPatch(new Uint8ClampedArray(3), 8, 8),
  (error) => error?.code === 'AIFX_MATERIAL_IDENTITY_SOURCE_INVALID',
)

console.log('aifx-material-identity-contract: PASS')
