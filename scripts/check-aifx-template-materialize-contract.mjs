import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const workflowPath = 'particle-editor/aifx-template-materialize.workflow.js'
const workflowSource = readFileSync(workflowPath, 'utf8')
const sandbox = { module: { exports: {} }, console, Uint8Array, Uint8ClampedArray, Int32Array, Float32Array, Math, Set, Error, Object }
runInNewContext(workflowSource, sandbox, { filename: workflowPath })

const workflow = sandbox.module.exports
assert.equal(sandbox.NovaFlowAifxTemplateMaterializeWorkflow, workflow, 'browser and CommonJS APIs must be identical')
assert.equal(workflow.version, 'aifx-template-materialize-v1')
assert.deepEqual({ ...workflow.frameCountRange }, { minimum: 2, maximum: 96 })
assert.deepEqual(Array.from(workflow.supportedMaterials), ['fire', 'lightning', 'ice'])
assert.deepEqual({ ...workflow.outerAreaScales }, { fire: 1.15, lightning: 0.98, ice: 1.04 })
assert.equal(typeof workflow.materialize, 'function')
assert.equal(typeof workflow.analyzeTemplateFrame, 'function')

const width = 96
const height = 72
const lifecycle = [0.32, 0.68, 0.9, 1, 0.86, 0.7, 0.43, 0.2, 0.09]

function makeFrame(index) {
  const data = new Uint8ClampedArray(width * height * 4)
  const progress = index / 8
  const energy = lifecycle[index]
  const centerX = 72 - progress * 35
  const centerY = 19 + progress * 28 + Math.sin(progress * Math.PI) * 5
  const angle = -0.82 + progress * 0.88
  const axisX = Math.cos(angle)
  const axisY = Math.sin(angle)
  const normalX = -axisY
  const normalY = axisX
  const length = 12 + energy * 27
  const thickness = 3.5 + energy * 8
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x + 0.5 - centerX
      const dy = y + 0.5 - centerY
      const along = dx * axisX + dy * axisY
      const side = dx * normalX + dy * normalY
      const curve = Math.sin((along / Math.max(1, length) + 0.45) * Math.PI) * thickness * (0.3 + progress * 0.55)
      const ribbon = Math.abs(along) <= length && Math.abs(side - curve) <= thickness * (0.62 + 0.2 * Math.cos(along / length * Math.PI))
      const innerCut = index >= 1 && index <= 6 && along > -length * 0.35
        && Math.abs(side - curve + thickness * 0.38) <= thickness * 0.24
      const impactDx = x - (centerX - axisX * length * 0.72)
      const impactDy = y - (centerY - axisY * length * 0.72)
      const impact = index >= 2 && index <= 6
        && (Math.abs(impactDx) + Math.abs(impactDy) * 0.72) <= (5 + (index - 1) * 1.6)
      const shardA = index >= 4 && index <= 7
        && Math.hypot(x - (21 + index * 1.9), y - (50 - index * 1.7)) <= Math.max(1.4, 4.4 - index * 0.34)
      const shardB = index >= 5
        && Math.hypot(x - (13 + index * 2.3), y - (27 + index * 2.7)) <= Math.max(1.2, 3.8 - index * 0.27)
      const shardC = index >= 6
        && Math.hypot(x - (52 - index * 3.4), y - (15 + index * 4.7)) <= Math.max(1.1, 3.2 - index * 0.22)
      const active = (ribbon && !innerCut) || impact || shardA || shardB || shardC
      if (!active) continue
      const offset = (y * width + x) * 4
      const core = Math.max(0, 1 - Math.abs(side - curve) / Math.max(1, thickness))
      data[offset] = Math.round(70 + core * 175)
      data[offset + 1] = Math.round(150 + core * 105)
      data[offset + 2] = Math.round(28 + core * 100)
      data[offset + 3] = Math.round(150 + core * 105)
    }
  }
  return { width, height, data }
}

function makeMaterial() {
  const materialWidth = 48
  const materialHeight = 48
  const data = new Uint8ClampedArray(materialWidth * materialHeight * 4)
  for (let y = 0; y < materialHeight; y += 1) {
    for (let x = 0; x < materialWidth; x += 1) {
      const offset = (y * materialWidth + x) * 4
      const wave = 0.5 + Math.sin(x * 0.41 + y * 0.19) * 0.25 + Math.cos(y * 0.53 - x * 0.11) * 0.2
      data[offset] = Math.round(35 + wave * 210)
      data[offset + 1] = Math.round(80 + wave * 165)
      data[offset + 2] = Math.round(120 + wave * 135)
      data[offset + 3] = Math.round(120 + wave * 135)
    }
  }
  return { width: materialWidth, height: materialHeight, data }
}

function makeContrastingMaterial() {
  const materialWidth = 48
  const materialHeight = 48
  const data = new Uint8ClampedArray(materialWidth * materialHeight * 4)
  for (let y = 0; y < materialHeight; y += 1) {
    for (let x = 0; x < materialWidth; x += 1) {
      const offset = (y * materialWidth + x) * 4
      const brightCell = ((x >> 3) + (y >> 3)) % 2 === 0
      data[offset] = brightCell ? 252 : 9
      data[offset + 1] = brightCell ? 18 : 3
      data[offset + 2] = brightCell ? 4 : 2
      data[offset + 3] = brightCell ? 255 : 36
    }
  }
  return { width: materialWidth, height: materialHeight, data }
}

const templateFrames = Array.from({ length: 9 }, (_, index) => makeFrame(index))
const materialFrame = makeMaterial()
const common = { templateFrames, materialFrame, styleStrength: 82, contourVariation: 74, seed: 24681357 }
const results = Object.fromEntries(workflow.supportedMaterials.map((materialType) => [
  materialType,
  workflow.materialize({ ...common, materialType }),
]))

for (const [materialType, result] of Object.entries(results)) {
  assert.equal(result.frameCount, 9)
  assert.equal(result.frames.length, 9)
  assert.equal(result.structure.frameCount, 9)
  assert.equal(result.structure.materialType, materialType)
  assert.equal(result.structure.sourceMode, 'per-template-frame-structure-materialization')
  assert.equal(result.structure.samePeakAffineReuse, false)
  assert.equal(result.structure.uniformScaleOnly, false)
  assert.equal(result.structure.temporalNoise, 'canonical-coordinate-continuous-harmonic-noise-3d')
  assert.equal(result.structure.macroConstraint, 'soft-signed-distance-envelope')
  assert.equal(result.structure.outerAreaBudget, 'template-alpha-area-ranked-material-topology')
  assert.equal(result.structure.outerAreaScale, workflow.outerAreaScales[materialType])
  assert.deepEqual(Array.from(result.structure.frames, (frame) => frame.sourceFrameIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.ok(result.structure.minimumMacroIou >= 0.18,
    `${materialType} must retain a minimum macro overlap with every chronological template pose: ${result.structure.minimumMacroIou}`)
  assert.ok(result.structure.meanMacroIou >= 0.36,
    `${materialType} must retain the template action envelope: ${result.structure.meanMacroIou}`)
  assert.ok(result.structure.exactStencilFrameRatio <= 0.22,
    `${materialType} must not reproduce the template alpha stencil: ${result.structure.exactStencilFrameRatio}`)
  for (const frame of result.frames) {
    assert.equal(frame.width, width)
    assert.equal(frame.height, height)
    assert.equal(frame.data.length, width * height * 4)
    assert.equal(frame.pixelFormat, 'rgba8')
    assert.equal(frame.alphaMode, 'straight')
    assert.equal(frame.structure.outputOuterArea, frame.structure.targetOuterArea,
      `${materialType} outer alpha area must follow the template-derived budget`)
  }
}

function alphaMask(frame, threshold = 13) {
  const mask = new Uint8Array(frame.width * frame.height)
  for (let pixel = 0; pixel < mask.length; pixel += 1) mask[pixel] = frame.data[pixel * 4 + 3] >= threshold ? 1 : 0
  return mask
}

function masksEqual(left, right) {
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
  return true
}

function maskIou(left, right) {
  let intersection = 0
  let union = 0
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] && right[index]) intersection += 1
    if (left[index] || right[index]) union += 1
  }
  return union ? intersection / union : 1
}

const templateAreas = templateFrames.map((frame) => alphaMask(frame)
  .reduce((sum, value) => sum + value, 0))
const maximumTemplateArea = Math.max(...templateAreas)
const activeFrameIndices = templateAreas
  .map((area, index) => area >= maximumTemplateArea * 0.2 ? index : null)
  .filter((index) => index !== null)

for (const pair of [['fire', 'lightning'], ['fire', 'ice'], ['lightning', 'ice']]) {
  let exactFrames = 0
  for (let index = 0; index < 9; index += 1) {
    const left = alphaMask(results[pair[0]].frames[index])
    const right = alphaMask(results[pair[1]].frames[index])
    if (masksEqual(left, right)) exactFrames += 1
  }
  assert.equal(exactFrames, 0, `${pair.join('/')} must never share an exact material silhouette`)
  for (const alphaThreshold of [13, 64]) {
    const activeIous = activeFrameIndices.map((index) => maskIou(
      alphaMask(results[pair[0]].frames[index], alphaThreshold),
      alphaMask(results[pair[1]].frames[index], alphaThreshold),
    ))
    const meanIou = activeIous.reduce((sum, value) => sum + value, 0) / activeIous.length
    const maximumIou = Math.max(...activeIous)
    assert.ok(meanIou < 0.8,
      `${pair.join('/')} active silhouettes at alpha ${alphaThreshold} must differ in aggregate: ${meanIou}`)
    assert.ok(maximumIou < 0.88,
      `${pair.join('/')} active silhouettes at alpha ${alphaThreshold} must differ frame-by-frame: ${maximumIou}`)
  }
}

const repeated = workflow.materialize({ ...common, materialType: 'fire' })
for (let index = 0; index < 9; index += 1) {
  assert.deepEqual(Array.from(repeated.frames[index].data), Array.from(results.fire.frames[index].data),
    `same seed and inputs must be deterministic at frame ${index}`)
}
const reseeded = workflow.materialize({ ...common, materialType: 'fire', seed: common.seed + 1 })
assert.ok(reseeded.frames.some((frame, index) => !masksEqual(alphaMask(frame), alphaMask(results.fire.frames[index]))),
  'a different seed must alter high-frequency fire topology')
assert.deepEqual(
  Array.from(reseeded.structure.frames, (frame) => frame.outputOuterArea),
  Array.from(results.fire.structure.frames, (frame) => frame.outputOuterArea),
  'seed changes may alter topology but must not move the template-derived lifecycle area curve',
)

const contrastingMaterialResult = workflow.materialize({
  ...common,
  materialFrame: makeContrastingMaterial(),
  materialType: 'fire',
})
assert.deepEqual(
  Array.from(contrastingMaterialResult.structure.frames, (frame) => frame.outputOuterArea),
  Array.from(results.fire.structure.frames, (frame) => frame.outputOuterArea),
  'material brightness and alpha may change appearance but must not move the lifecycle area curve',
)
assert.ok(contrastingMaterialResult.frames.some((frame, frameIndex) => frame.data.some((value, byteIndex) =>
  byteIndex % 4 !== 3 && value !== results.fire.frames[frameIndex].data[byteIndex])),
'contrasting material references must still change rendered RGB appearance')

function maskBounds(mask) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (!mask[pixel]) continue
    const x = pixel % width
    const y = Math.floor(pixel / width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return maxX >= 0 ? { minX, minY, maxX, maxY } : null
}

function normalizedMask(frame, size = 40) {
  const source = alphaMask(frame)
  const bounds = maskBounds(source)
  const normalized = new Uint8Array(size * size)
  assert.ok(bounds, 'generated frame must not be empty')
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX + 1)
  const sourceHeight = Math.max(1, bounds.maxY - bounds.minY + 1)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(width - 1, bounds.minX + Math.floor((x + 0.5) / size * sourceWidth))
      const sourceY = Math.min(height - 1, bounds.minY + Math.floor((y + 0.5) / size * sourceHeight))
      normalized[y * size + x] = source[sourceY * width + sourceX]
    }
  }
  return normalized
}

for (const materialType of workflow.supportedMaterials) {
  const peak = normalizedMask(results[materialType].frames[3])
  const nonAffineIous = [0, 6, 8].map((index) => maskIou(peak, normalizedMask(results[materialType].frames[index])))
  assert.ok(nonAffineIous.filter((value) => value < 0.82).length >= 2,
    `${materialType} must follow frame-specific topology instead of uniformly scaling one peak: ${nonAffineIous.join(',')}`)
  const firstCenter = results[materialType].structure.frames[0].outputCentroid
  const middleCenter = results[materialType].structure.frames[4].outputCentroid
  const lastCenter = results[materialType].structure.frames[8].outputCentroid
  assert.ok(firstCenter && middleCenter && lastCenter)
  assert.ok(Math.hypot(firstCenter.x - lastCenter.x, firstCenter.y - lastCenter.y) >= 12,
    `${materialType} output must preserve the template's large pose trajectory`)
  assert.ok(Math.hypot(middleCenter.x - lastCenter.x, middleCenter.y - lastCenter.y) >= 5,
    `${materialType} breakup pose must not collapse into the peak pose`)
}

assert.throws(
  () => workflow.materialize({ ...common, materialType: 'water' }),
  (error) => error.code === workflow.ERROR_CODES.UNSUPPORTED_MATERIAL,
)
assert.throws(
  () => workflow.materialize({ ...common, templateFrames: templateFrames.slice(0, 1), materialType: 'fire' }),
  (error) => error.code === workflow.ERROR_CODES.INVALID_INPUT,
)
assert.throws(
  () => workflow.materialize({ ...common, templateFrames: Array.from({ length: 97 }, () => templateFrames[0]), materialType: 'fire' }),
  (error) => error.code === workflow.ERROR_CODES.INVALID_INPUT,
)

const fiveFrameTemplate = [0, 2, 4, 6, 8].map((index) => templateFrames[index])
const fiveFrameResult = workflow.materialize({
  ...common,
  templateFrames: fiveFrameTemplate,
  materialType: 'ice',
})
assert.equal(fiveFrameResult.frameCount, 5, 'exported frameCount must come from the uploaded template')
assert.equal(fiveFrameResult.frames.length, 5)
assert.equal(fiveFrameResult.structure.frameCount, 5)
assert.deepEqual(Array.from(fiveFrameResult.structure.frames, (frame) => frame.sourceFrameIndex), [0, 1, 2, 3, 4])
assert.ok(fiveFrameResult.frames.every((frame) => frame.data.length === width * height * 4))

assert.match(workflowSource, /per-template-frame-structure-materialization/)
assert.match(workflowSource, /soft-signed-distance-envelope/)
assert.match(workflowSource, /canonical-coordinate-continuous-harmonic-noise-3d/)
assert.match(workflowSource, /template-alpha-area-ranked-material-topology/)
assert.match(workflowSource, /component-fragments/)
assert.doesNotMatch(workflowSource, /Math\.random/)

console.log('aifx-template-materialize-contract: PASS')
