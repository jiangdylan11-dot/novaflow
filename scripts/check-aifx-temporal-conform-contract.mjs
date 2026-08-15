import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
require('../particle-editor/aifx-temporal-conform.workflow.js')
const workflow = globalThis.NovaFlowAifxTemporalConformWorkflow

assert.ok(workflow)
assert.equal(workflow.version, 'novaflow-aifx-temporal-conform-v1')
assert.equal(typeof workflow.analyzeAiAlphaGeometry, 'function')
assert.equal(typeof workflow.canConformQualityFailure, 'function')
assert.equal(typeof workflow.conformFrames, 'function')
assert.equal(workflow.DEFAULT_OPTIONS.minimumScale, 0.08)
assert.equal(workflow.DEFAULT_OPTIONS.maximumScale, 2.4)
assert.equal(workflow.DEFAULT_OPTIONS.explicitOccupancyRelativeTolerance, 0.02)
assert.equal(workflow.DEFAULT_OPTIONS.explicitPeakDominanceRatio, 0.96)
assert.equal(workflow.DEFAULT_OPTIONS.anchorDuplicateMaximum, 0.92)
assert.equal(workflow.DEFAULT_OPTIONS.anchorAppearanceDuplicateMinimum, 0.94)
assert.equal(workflow.DEFAULT_OPTIONS.preserveThresholdSupport, false)
assert.equal(workflow.DEFAULT_OPTIONS.directionAlignmentEnabled, false)
assert.equal(workflow.DEFAULT_OPTIONS.directionAnisotropyMinimum, 0.08)
assert.equal(workflow.DEFAULT_OPTIONS.maximumDirectionRotationDeg, 90)
assert.equal(workflow.EXPLICIT_TOPOLOGY_WEIGHT_POWER, 2)
assert.equal(workflow.EXPLICIT_TAIL_TOPOLOGY_WEIGHT_POWER, 3)
assert.equal(workflow.EXPLICIT_DECAY_TO_BREAKUP_TOPOLOGY_WEIGHT_POWER, 5)
assert.equal(workflow.EXPLICIT_PEAK_TO_DECAY_EASING_EXPONENT, 1.65)
const sharpened6535 = workflow.sharpenExplicitAnchorBlend([
  { anchor: 'decay', weight: 0.65 },
  { anchor: 'breakup', weight: 0.35 },
])
assert.ok(Math.abs(sharpened6535.reduce((sum, entry) => sum + entry.weight, 0) - 1) <= 1e-12)
assert.ok(sharpened6535[1].weight > 0.2 && sharpened6535[1].weight < 0.25, 'body topology retains visible between-anchor evolution')
const tailSharpened6535 = workflow.sharpenExplicitAnchorBlend([
  { anchor: 'decay', weight: 0.65 },
  { anchor: 'breakup', weight: 0.35 },
], workflow.EXPLICIT_TAIL_TOPOLOGY_WEIGHT_POWER)
assert.ok(tailSharpened6535[1].weight > 0.12 && tailSharpened6535[1].weight < 0.16)
const decayToBreakupSharpened6535 = workflow.sharpenExplicitAnchorBlend([
  { anchor: 'decay', weight: 0.65 },
  { anchor: 'breakup', weight: 0.35 },
], workflow.EXPLICIT_DECAY_TO_BREAKUP_TOPOLOGY_WEIGHT_POWER)
assert.ok(decayToBreakupSharpened6535[1].weight > 0.04 && decayToBreakupSharpened6535[1].weight < 0.05)
assert.equal(workflow.sharpenExplicitAnchorBlend([{ anchor: 'peak', weight: 1 }])[0].weight, 1)

class FakeCanvas {
  constructor(width, height) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }

  getContext() {
    const canvas = this
    return {
      createImageData(width, height) {
        return { width, height, data: new Uint8ClampedArray(width * height * 4) }
      },
      getImageData(x, y, width, height) {
        assert.equal(x, 0)
        assert.equal(y, 0)
        assert.equal(width, canvas.width)
        assert.equal(height, canvas.height)
        return { width, height, data: new Uint8ClampedArray(canvas.data) }
      },
      putImageData(imageData, x, y) {
        assert.equal(x, 0)
        assert.equal(y, 0)
        assert.equal(imageData.width, canvas.width)
        assert.equal(imageData.height, canvas.height)
        canvas.data.set(imageData.data)
      },
    }
  }

  toDataURL() {
    return `data:image/png;base64,${Buffer.from(this.data.subarray(0, 96)).toString('base64')}`
  }
}

const WIDTH = 64
const HEIGHT = 64

function setPixel(canvas, x, y, color) {
  if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) return
  const offset = (y * canvas.width + x) * 4
  canvas.data[offset] = color[0]
  canvas.data[offset + 1] = color[1]
  canvas.data[offset + 2] = color[2]
  canvas.data[offset + 3] = color[3]
}

function fillRect(canvas, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) setPixel(canvas, column, row, color)
  }
}

function drawL(canvas, centerX, centerY, color) {
  fillRect(canvas, centerX - 5, centerY - 8, 5, 16, color)
  fillRect(canvas, centerX - 5, centerY + 4, 14, 4, color)
}

function drawIncompatible(canvas, index, color) {
  if (index % 3 === 0) {
    fillRect(canvas, 6 + index * 2, 17, 3, 22, color)
    return
  }
  if (index % 3 === 1) {
    fillRect(canvas, 10 + index, 21, 10, 10, color)
    return
  }
  for (let step = 0; step < 18; step += 1) {
    setPixel(canvas, 8 + step, 45 - step, color)
    setPixel(canvas, 8 + step, 46 - step, color)
  }
}

const anchorSpecs = new Map([
  [2, { center: [21, 28], color: [255, 54, 30, 220] }],
  [4, { center: [33, 31], color: [30, 255, 70, 255] }],
  [6, { center: [44, 35], color: [35, 90, 255, 230] }],
])

const frames = Array.from({ length: 9 }, (_, index) => {
  const canvas = new FakeCanvas(WIDTH, HEIGHT)
  const anchor = anchorSpecs.get(index)
  if (anchor) drawL(canvas, anchor.center[0], anchor.center[1], anchor.color)
  else drawIncompatible(canvas, index, [160 + index * 4, 70, 210 - index * 5, 255])
  return {
    index,
    name: `frame_${String(index).padStart(3, '0')}.png`,
    width: WIDTH,
    height: HEIGHT,
    canvas,
    pixelFormat: 'rgba8',
    alphaMode: 'straight',
    shapeSource: 'ai-generated-frame-matte',
  }
})

const sequencePlan = [
  { index: 0, phase: 'onset', energy: 0.1, centerX: 0.2, centerY: 0.25, occupancy: 0.004 },
  { index: 1, phase: 'growth', energy: 0.58, centerX: 0.35, centerY: 0.4, occupancy: 0.035 },
  { index: 2, phase: 'peak', energy: 1, centerX: 0.48, centerY: 0.49, occupancy: 0.08 },
  { index: 3, phase: 'follow-through', energy: 0.8, centerX: 0.56, centerY: 0.51, occupancy: 0.06 },
  { index: 4, phase: 'decay', energy: 0.5, centerX: 0.63, centerY: 0.53, occupancy: 0.035 },
  { index: 5, phase: 'decay', energy: 0.36, centerX: 0.68, centerY: 0.55, occupancy: 0.026 },
  { index: 6, phase: 'breakup', energy: 0.22, centerX: 0.72, centerY: 0.57, occupancy: 0.016 },
  { index: 7, phase: 'breakup', energy: 0.12, centerX: 0.76, centerY: 0.58, occupancy: 0.007 },
  { index: 8, phase: 'dissipation', energy: 0.03, centerX: 0.8, centerY: 0.6, occupancy: 0.00018 },
]

const eligibleQuality = {
  passed: false,
  code: 'AIFX_SEQUENCE_LIFECYCLE_INCOHERENT',
  failures: [{ code: 'AIFX_SEQUENCE_LIFECYCLE_INCOHERENT' }],
}
assert.equal(workflow.canConformQualityFailure(eligibleQuality), true)
assert.equal(workflow.canConformQualityFailure({ passed: true, failures: [] }), false)
assert.equal(workflow.canConformQualityFailure({
  passed: false,
  failures: [{ code: 'AIFX_SEQUENCE_TEMPLATE_STENCIL' }, { code: 'AIFX_SEQUENCE_POSITION_DRIFT' }],
}), false)

const request = {
  frames,
  sequencePlan,
  quality: eligibleQuality,
  attempt: 3,
  trigger: 'third-sheet-quality-failure',
}
Object.defineProperty(request, 'legacyTemplateDiagnostic', {
  enumerable: true,
  get() {
    throw new Error('temporal conform must not inspect unrelated template diagnostics')
  },
})

const result = await workflow.conformFrames(request, {
  createCanvas(width, height) {
    return new FakeCanvas(width, height)
  },
  canvasToDataUrl(canvas) {
    return canvas.toDataURL('image/png')
  },
})

assert.equal(result.status, 'ready')
assert.equal(result.frameCount, 9)
assert.equal(result.width, WIDTH)
assert.equal(result.height, HEIGHT)
assert.equal(result.pixelFormat, 'rgba8')
assert.equal(result.alphaMode, 'straight')
assert.equal(result.shapeSource, 'ai-generated-frame-matte')
assert.equal(result.motionConstraint, 'template-plan-only')
assert.equal(result.templatePixelsUsed, false)
assert.equal(result.preservesFrameOrder, true)
assert.equal(result.preservesFrameDimensions, true)
assert.equal(result.temporalCorrection.attempt, 3)
assert.equal(result.temporalCorrection.templatePixelsUsed, false)
assert.equal(result.temporalCorrection.templateMaskUsed, false)
assert.equal(result.templateMaskUsed, false)
assert.equal(result.temporalCorrection.nonUniformDeformationUsed, false)
assert.equal(result.temporalCorrection.thresholdSupportPreserved, false)
assert.equal(result.temporalCorrection.rotationUsed, false)
assert.equal(result.temporalCorrection.anchorCount, 3)
assert.equal(result.temporalCorrection.adjacentBlendUsed, true)
assert.equal(result.temporalCorrection.plannedPeakIndex, 2)
assert.equal(result.temporalCorrection.generatedPeakIndex, 4, 'generated peak must come from AI alpha area/mass, not the plan peak cell')
assert.deepEqual(
  result.temporalCorrection.anchors.map((entry) => [entry.role, entry.sourceIndex, entry.outputIndex]),
  [['onset', 2, 0], ['peak', 4, 2], ['decay', 6, 4]],
)
assert.ok(result.temporalCorrection.anchors.every((entry) => entry.compatibilityToPeak >= 0.24))
assert.ok(result.temporalCorrection.anchors.every((entry) => entry.boundaryClipped === false))

for (let index = 0; index < result.frames.length; index += 1) {
  const frame = result.frames[index]
  const trace = frame.temporalConform
  assert.equal(frame.index, index)
  assert.equal(frame.name, frames[index].name)
  assert.equal(frame.width, WIDTH)
  assert.equal(frame.height, HEIGHT)
  assert.equal(frame.pixelFormat, 'rgba8')
  assert.equal(frame.alphaMode, 'straight')
  assert.match(frame.dataUrl, /^data:image\/png;base64,/)
  assert.deepEqual(frame.sourceIndices, trace.sourceIndices)
  assert.equal(frame.scale, trace.scale)
  assert.equal(frame.dx, trace.dx)
  assert.equal(frame.dy, trace.dy)
  assert.equal(frame.alphaGain, trace.alphaGain)
  assert.ok(trace.scale >= 0.08 && trace.scale <= 2.4)
  assert.ok(trace.alphaGain >= 0 && trace.alphaGain <= 1)
  assert.ok(trace.sourceIndices.length >= 1 && trace.sourceIndices.length <= 2)
  assert.equal(trace.blend.length, trace.sourceIndices.length)
  assert.ok(Math.abs(trace.blend.reduce((sum, entry) => sum + entry.weight, 0) - 1) <= 1e-5)
  assert.equal('scaleX' in trace, false)
  assert.equal('scaleY' in trace, false)
  assert.equal('rotation' in trace, false)

  const geometry = workflow.analyzeAiAlphaGeometry(frame)
  const target = sequencePlan[index]
  const pixelRatio = 1 / (WIDTH * HEIGHT)
  const allowedOccupancyError = Math.max(pixelRatio * 2.5, target.occupancy * 0.16)
  assert.ok(
    Math.abs(geometry.areaRatio - target.occupancy) <= allowedOccupancyError,
    `frame ${index} occupancy ${geometry.areaRatio} must approach ${target.occupancy}`,
  )
  if (geometry.visiblePixels > 0) {
    const targetX = target.centerX * (WIDTH - 1)
    const targetY = target.centerY * (HEIGHT - 1)
    assert.ok(Math.hypot(geometry.centroid.x - targetX, geometry.centroid.y - targetY) <= 1.5)
  }
}

assert.deepEqual(result.frames[2].sourceIndices, [4], 'planned peak output must use the generated AI peak anchor directly')
assert.deepEqual(result.frames[1].sourceIndices, [2, 4], 'pre-peak frames must blend adjacent onset and peak AI anchors')
assert.deepEqual(result.frames[3].sourceIndices, [4, 6], 'follow-through frames must blend adjacent peak and decay AI anchors')
assert.deepEqual(result.frames[8].sourceIndices, [6], 'late dissipation must retain the compatible decay AI anchor identity')
assert.ok(result.frames[8].scale >= 0.08 && result.frames[8].scale <= 0.2, 'last frame must be allowed to become nearly invisible')
assert.ok(workflow.analyzeAiAlphaGeometry(result.frames[8]).visiblePixels <= 2)

const blendedPixels = result.frames[1].canvas.data
let foundRedGreenBlend = false
for (let index = 0; index < blendedPixels.length; index += 4) {
  if (blendedPixels[index + 3] > 20 && blendedPixels[index] > 20 && blendedPixels[index + 1] > 20) {
    foundRedGreenBlend = true
    break
  }
}
assert.equal(foundRedGreenBlend, true, 'anchor crossfade must blend AI RGBA in premultiplied-alpha space')

const peakSourceGeometry = workflow.analyzeAiAlphaGeometry(frames[4])
const peakOutputGeometry = workflow.analyzeAiAlphaGeometry(result.frames[2])
const sourceAspect = peakSourceGeometry.bbox.width / peakSourceGeometry.bbox.height
const outputAspect = peakOutputGeometry.bbox.width / peakOutputGeometry.bbox.height
assert.ok(Math.abs(sourceAspect - outputAspect) <= 0.16, 'uniform scale must preserve AI contour aspect ratio')

const explicitTwoCandidates = [
  { ...frames[4], index: 401, globalIndex: 9004, anchorRole: 'peak', name: 'explicit_peak.png' },
  { ...frames[6], index: 601, globalIndex: 9006, anchorRole: 'decay', name: 'explicit_decay.png' },
]
const explicitTwo = await workflow.conformFrames({
  frames: explicitTwoCandidates,
  sequencePlan,
  trigger: 'anchor-sequence-generation',
}, {
  createCanvas: (width, height) => new FakeCanvas(width, height),
  canvasToDataUrl: (canvas) => canvas.toDataURL('image/png'),
})
assert.equal(explicitTwo.frameCount, 9, 'two explicit candidates must still generate every sequencePlan output frame')
assert.equal(explicitTwo.temporalCorrection.anchorInputMode, 'explicit-candidates')
assert.equal(explicitTwo.temporalCorrection.anchorCount, 2)
assert.equal(explicitTwo.temporalCorrection.thresholdSupportPreserved, true)
assert.ok(explicitTwo.frames.every((frame) => frame.temporalConform.thresholdSupportPreserved === true))
assert.equal(explicitTwo.temporalCorrection.generatedPeakCandidateIndex, 0)
assert.equal(explicitTwo.temporalCorrection.generatedPeakSourceIndex, 401)
assert.equal(explicitTwo.temporalCorrection.generatedPeakGlobalIndex, 9004)
assert.deepEqual(
  explicitTwo.temporalCorrection.anchors.map((entry) => [entry.role, entry.candidateIndex, entry.sourceIndex, entry.globalIndex]),
  [['peak', 0, 401, 9004], ['decay', 1, 601, 9006]],
)
assert.deepEqual(explicitTwo.frames[0].candidateIndices, [0], 'missing onset must reuse the explicit peak candidate')
assert.deepEqual(explicitTwo.frames[0].sourceIndices, [401])
assert.deepEqual(explicitTwo.frames[0].globalIndices, [9004])
assert.deepEqual(explicitTwo.frames[3].candidateIndices, [0, 1])
assert.deepEqual(explicitTwo.frames[3].sourceIndices, [401, 601])
assert.deepEqual(explicitTwo.frames[3].globalIndices, [9004, 9006])
assert.deepEqual(
  explicitTwo.frames[3].temporalConform.blend.map((entry) => [
    entry.candidateIndex,
    entry.sourceIndex,
    entry.globalIndex,
    entry.anchorRole,
  ]),
  [[0, 401, 9004, 'peak'], [1, 601, 9006, 'decay']],
)
assert.equal(explicitTwo.frames[8].name, 'frame_008.png')

const lowAlphaPeakCanvas = new FakeCanvas(WIDTH, HEIGHT)
const lowAlphaDecayCanvas = new FakeCanvas(WIDTH, HEIGHT)
drawL(lowAlphaPeakCanvas, 32, 32, [120, 220, 255, 255])
drawL(lowAlphaDecayCanvas, 32, 32, [120, 220, 255, 16])
const lowEnergyExplicit = await workflow.conformFrames({
  frames: [
    { index: 0, globalIndex: 0, timelineIndex: 0, anchorRole: 'peak', width: WIDTH, height: HEIGHT, canvas: lowAlphaPeakCanvas },
    { index: 1, globalIndex: 1, timelineIndex: 1, anchorRole: 'decay', width: WIDTH, height: HEIGHT, canvas: lowAlphaDecayCanvas },
  ],
  sequencePlan: [
    { index: 0, phase: 'peak', energy: 1, centerX: 0.5, centerY: 0.5, occupancy: 0.03 },
    { index: 1, phase: 'decay', energy: 0.04, centerX: 0.5, centerY: 0.5, occupancy: 0.01 },
  ],
  trigger: 'anchor-sequence-generation',
  options: { anchorCompatibilityMinimum: 0.08 },
}, {
  createCanvas: (width, height) => new FakeCanvas(width, height),
  canvasToDataUrl: (canvas) => canvas.toDataURL('image/png'),
})
let maximumLowEnergyAlpha = 0
for (let offset = 3; offset < lowEnergyExplicit.frames[1].canvas.data.length; offset += 4) {
  maximumLowEnergyAlpha = Math.max(maximumLowEnergyAlpha, lowEnergyExplicit.frames[1].canvas.data[offset])
}
assert.ok(maximumLowEnergyAlpha >= 13, 'explicit low-energy AI support at alpha 0.05 must survive the lifecycle envelope')
assert.equal(lowEnergyExplicit.frames[1].temporalConform.thresholdSupportPreserved, true)

const terminalEnergySequencePlan = sequencePlan.map((entry, index) => ({
  ...entry,
  ...(index === 2 ? { energy: 0.8 } : {}),
  ...(index === 8 ? { energy: 1 } : {}),
}))
const terminalEnergyExplicit = await workflow.conformFrames({
  frames: explicitTwoCandidates,
  sequencePlan: terminalEnergySequencePlan,
  trigger: 'anchor-sequence-generation',
}, {
  createCanvas: (width, height) => new FakeCanvas(width, height),
  canvasToDataUrl: (canvas) => canvas.toDataURL('image/png'),
})
assert.equal(
  terminalEnergyExplicit.temporalCorrection.plannedPeakIndex,
  2,
  'an explicit peak phase must remain authoritative when terminal energy is numerically higher',
)

const explicitThreeCandidates = [
  { ...frames[6], index: 62, globalIndex: 1006, timelineIndex: 6, anchorRole: 'decay' },
  { ...frames[2], index: 22, globalIndex: 1002, timelineIndex: 0, anchorRole: 'onset' },
  { ...frames[4], index: 42, globalIndex: 1004, timelineIndex: 2, anchorRole: 'peak' },
]
const explicitThree = await workflow.conformFrames({
  frames: explicitThreeCandidates,
  sequencePlan,
  trigger: 'anchor-sequence-generation',
}, {
  createCanvas: (width, height) => new FakeCanvas(width, height),
  canvasToDataUrl: (canvas) => canvas.toDataURL('image/png'),
})
assert.equal(explicitThree.frameCount, sequencePlan.length)
assert.deepEqual(
  explicitThree.temporalCorrection.anchors.map((entry) => [entry.role, entry.candidateIndex, entry.sourceIndex, entry.globalIndex]),
  [['onset', 1, 22, 1002], ['peak', 2, 42, 1004], ['decay', 0, 62, 1006]],
  'explicit anchor roles must override candidate array order',
)
assert.deepEqual(
  explicitThree.temporalCorrection.anchors.map((entry) => [entry.role, entry.timelineIndex, entry.outputIndex]),
  [['onset', 0, 0], ['peak', 2, 2], ['decay', 6, 6]],
  'explicit anchors must land on their selected timeline positions rather than the first generic decay phase',
)

const duplicateDecayCandidates = [
  { ...frames[4], index: 42, globalIndex: 1004, timelineIndex: 2, anchorRole: 'peak' },
  { ...frames[4], index: 62, globalIndex: 1006, timelineIndex: 6, anchorRole: 'decay' },
]
await assert.rejects(
  workflow.conformFrames({
    frames: duplicateDecayCandidates,
    sequencePlan,
    trigger: 'anchor-sequence-generation',
  }, {
    createCanvas: (width, height) => new FakeCanvas(width, height),
    canvasToDataUrl: (canvas) => canvas.toDataURL('image/png'),
  }),
  (error) => error?.code === 'AIFX_TEMPORAL_CONFORM_EXPLICIT_ANCHOR_DUPLICATE',
)
assert.deepEqual(explicitThree.frames[1].candidateIndices, [1, 2])
assert.deepEqual(explicitThree.frames[1].globalIndices, [1002, 1004])

const dissipationCanvas = new FakeCanvas(WIDTH, HEIGHT)
drawL(dissipationCanvas, 39, 34, [255, 170, 40, 225])
const explicitFourCandidates = [
  {
    index: 84,
    globalIndex: 1008,
    timelineIndex: 8,
    anchorRole: 'dissipation',
    width: WIDTH,
    height: HEIGHT,
    canvas: dissipationCanvas,
    pixelFormat: 'rgba8',
    alphaMode: 'straight',
  },
  { ...frames[4], index: 42, globalIndex: 1004, timelineIndex: 2, anchorRole: 'peak' },
  { ...frames[2], index: 22, globalIndex: 1002, timelineIndex: 0, anchorRole: 'onset' },
  { ...frames[6], index: 72, globalIndex: 1007, timelineIndex: 7, anchorRole: 'breakup' },
]
const explicitFour = await workflow.conformFrames({
  frames: explicitFourCandidates,
  sequencePlan,
  trigger: 'anchor-sequence-generation',
  options: { anchorCompatibilityMinimum: 0.08 },
}, {
  createCanvas: (width, height) => new FakeCanvas(width, height),
  canvasToDataUrl: (canvas) => canvas.toDataURL('image/png'),
})
assert.equal(explicitFour.temporalCorrection.anchorCount, 4)
assert.equal(explicitFour.temporalCorrection.topologyWeightSharpened, true)
assert.equal(explicitFour.temporalCorrection.topologyWeightPower, 2)
assert.equal(explicitFour.temporalCorrection.tailTopologyWeightPower, 3)
assert.equal(explicitFour.temporalCorrection.decayToBreakupTopologyWeightPower, 5)
assert.equal(explicitFour.temporalCorrection.peakToDecayEasingExponent, 1.65)
assert.deepEqual(
  explicitFour.temporalCorrection.anchors.map((entry) => [entry.role, entry.timelineIndex, entry.outputIndex]),
  [['onset', 0, 0], ['peak', 2, 2], ['breakup', 7, 7], ['dissipation', 8, 8]],
  'four independent AI lifecycle anchors must remain in chronological timeline order',
)
assert.deepEqual(explicitFour.frames[7].sourceIndices, [72], 'breakup output must use its own AI topology')
assert.deepEqual(explicitFour.frames[8].sourceIndices, [84], 'dissipation output must use its own AI topology')
const earlyBreakupBlend = explicitFour.frames[3].temporalConform.blend
const lateBreakupBlend = explicitFour.frames[6].temporalConform.blend
assert.deepEqual(earlyBreakupBlend.map((entry) => entry.anchorRole), ['peak', 'breakup'])
assert.ok(earlyBreakupBlend[1].weight < 0.5, 'early pre-breakup output must keep the dominant peak topology')
assert.ok(
  lateBreakupBlend[1].weight > 0.9 && lateBreakupBlend[0].weight > 0.05,
  'late pre-breakup output must expose the breakup topology without becoming a hard switch',
)

const explicitBodyFourCandidates = [
  { ...frames[4], index: 42, globalIndex: 2004, timelineIndex: 2, anchorRole: 'peak' },
  { ...frames[6], index: 62, globalIndex: 2006, timelineIndex: 5, anchorRole: 'decay' },
  { ...frames[2], index: 72, globalIndex: 2007, timelineIndex: 7, anchorRole: 'breakup' },
  {
    index: 84,
    globalIndex: 2008,
    timelineIndex: 8,
    anchorRole: 'dissipation',
    width: WIDTH,
    height: HEIGHT,
    canvas: dissipationCanvas,
    pixelFormat: 'rgba8',
    alphaMode: 'straight',
  },
]
const explicitBodyFour = await workflow.conformFrames({
  frames: explicitBodyFourCandidates,
  sequencePlan,
  trigger: 'anchor-sequence-generation',
  options: { anchorCompatibilityMinimum: 0.08 },
}, {
  createCanvas: (width, height) => new FakeCanvas(width, height),
  canvasToDataUrl: (canvas) => canvas.toDataURL('image/png'),
})
assert.deepEqual(
  explicitBodyFour.frames[3].temporalConform.blend.map((entry) => entry.anchorRole),
  ['peak', 'decay'],
)
assert.ok(
  explicitBodyFour.frames[3].temporalConform.blend[1].weight > 0.4,
  'peak-to-decay topology must evolve early enough to retain body pose change',
)
assert.deepEqual(
  explicitBodyFour.frames[5].temporalConform.blend.map((entry) => [entry.anchorRole, entry.weight]),
  [['decay', 1]],
  'the decay anchor must remain exact at its selected timeline frame',
)
assert.deepEqual(
  explicitBodyFour.frames[6].temporalConform.blend.map((entry) => entry.anchorRole),
  ['decay', 'breakup'],
)
assert.ok(
  explicitBodyFour.frames[6].temporalConform.blend[0].weight > explicitBodyFour.frames[6].temporalConform.blend[1].weight
    && explicitBodyFour.frames[6].temporalConform.blend[1].weight > 0.04
    && explicitBodyFour.frames[6].temporalConform.blend[1].weight < 0.05,
  'the decay-to-breakup bridge must remain continuous but keep the next topology below the outer visibility threshold',
)
assert.deepEqual(
  explicitBodyFour.frames[7].temporalConform.blend.map((entry) => [entry.anchorRole, entry.weight]),
  [['breakup', 1]],
  'the breakup anchor must remain exact at its selected timeline frame',
)
assert.deepEqual(
  explicitBodyFour.frames[8].temporalConform.blend.map((entry) => [entry.anchorRole, entry.weight]),
  [['dissipation', 1]],
  'the dissipation anchor must remain exact at its selected timeline frame',
)
const m27LikePlan = sequencePlan.map((entry, index) => ({
  ...entry,
  phase: index === 0 ? 'onset'
    : index === 1 ? 'peak'
      : index < 4 ? 'follow-through'
        : index < 6 ? 'decay'
          : index < 8 ? 'breakup'
            : 'dissipation',
  energy: [0.34, 1, 0.93, 0.8, 0.5, 0.3, 0.16, 0.08, 0.03][index],
  occupancy: [0.03, 0.08, 0.07, 0.065, 0.05, 0.035, 0.016, 0.007, 0.00018][index],
}))
const m27LikeCandidates = [
  { ...frames[4], index: 41, globalIndex: 3001, timelineIndex: 1, anchorRole: 'peak' },
  { ...frames[6], index: 65, globalIndex: 3005, timelineIndex: 5, anchorRole: 'decay' },
  { ...frames[2], index: 76, globalIndex: 3006, timelineIndex: 6, anchorRole: 'breakup' },
  {
    index: 88,
    globalIndex: 3008,
    timelineIndex: 8,
    anchorRole: 'dissipation',
    width: WIDTH,
    height: HEIGHT,
    canvas: dissipationCanvas,
    pixelFormat: 'rgba8',
    alphaMode: 'straight',
  },
]
const m27Like = await workflow.conformFrames({
  frames: m27LikeCandidates,
  sequencePlan: m27LikePlan,
  trigger: 'anchor-sequence-generation',
  options: { anchorCompatibilityMinimum: 0.08 },
}, {
  createCanvas: (width, height) => new FakeCanvas(width, height),
  canvasToDataUrl: (canvas) => canvas.toDataURL('image/png'),
})
const m27DecayWeights = [2, 3, 4].map((index) => m27Like.frames[index].temporalConform.blend[1].weight)
const expectedM27Frame2Base = 1 - Math.pow(1 - 0.25, workflow.EXPLICIT_PEAK_TO_DECAY_EASING_EXPONENT)
const expectedM27Frame2DecayWeight = expectedM27Frame2Base ** 2
  / (expectedM27Frame2Base ** 2 + (1 - expectedM27Frame2Base) ** 2)
assert.ok(Math.abs(m27DecayWeights[0] - expectedM27Frame2DecayWeight) <= 0.00001)
assert.ok(m27DecayWeights[0] > 0.26 && m27DecayWeights[0] < 0.28)
assert.ok(
  m27DecayWeights[0] < m27DecayWeights[1] && m27DecayWeights[1] < m27DecayWeights[2],
  'm27-like peak-to-decay topology weights must advance monotonically through frames 2, 3, and 4',
)
let previousDecayToBreakupAmount = -Infinity
for (let sample = 0; sample <= 1000; sample += 1) {
  const rawAmount = sample / 1000
  const easedAmount = rawAmount - 0.6 * rawAmount * (1 - rawAmount)
  assert.ok(easedAmount >= previousDecayToBreakupAmount - 1e-12, 'decay-to-breakup easing must be monotone')
  previousDecayToBreakupAmount = easedAmount
}
assert.equal(0 - 0.6 * 0 * (1 - 0), 0)
assert.equal(1 - 0.6 * 1 * (1 - 1), 1)

const nearTieSequencePlan = sequencePlan.map((entry, index) => ({
  ...entry,
  ...(index === 1 ? { phase: 'peak', energy: 1, occupancy: 0.08 } : {}),
  ...(index === 2 ? { phase: 'follow-through', energy: 0.98, occupancy: 0.078 } : {}),
  ...(index === 3 ? { phase: 'follow-through', energy: 0.96, occupancy: 0.0798 } : {}),
}))
const nearTieExplicitCandidates = explicitThreeCandidates.map((entry) => ({
  ...entry,
  ...(entry.anchorRole === 'peak' ? { timelineIndex: 1 } : {}),
}))
const peakDominantExplicit = await workflow.conformFrames({
  frames: nearTieExplicitCandidates,
  sequencePlan: nearTieSequencePlan,
  trigger: 'anchor-sequence-generation',
}, {
  createCanvas: (width, height) => new FakeCanvas(width, height),
  canvasToDataUrl: (canvas) => canvas.toDataURL('image/png'),
})
const peakDominantAreas = peakDominantExplicit.frames.map((frame) => (
  workflow.analyzeAiAlphaGeometry(frame).areaRatio
))
assert.equal(
  peakDominantAreas.indexOf(Math.max(...peakDominantAreas)),
  1,
  'explicit anchor conform must keep real-style F2 peak above a nearly tied F4 non-peak frame',
)
assert.equal(peakDominantExplicit.frames[3].temporalConform.requestedTargetOccupancy, 0.0798)
assert.ok(peakDominantExplicit.frames[3].temporalConform.targetOccupancy <= 0.08 * 0.96)
assert.equal(peakDominantExplicit.temporalCorrection.converged, true)
assert.ok(peakDominantExplicit.temporalCorrection.peakDominance.margin > 0)

await assert.rejects(
  () => workflow.conformFrames({
    frames: [
      { ...frames[2], anchorRole: 'onset' },
      { ...frames[6], anchorRole: 'decay' },
    ],
    sequencePlan,
    trigger: 'anchor-sequence-generation',
  }, { createCanvas: (width, height) => new FakeCanvas(width, height) }),
  (error) => error?.code === 'AIFX_TEMPORAL_CONFORM_EXPLICIT_PEAK_REQUIRED',
)

await assert.rejects(
  () => workflow.conformFrames({
    frames: explicitTwoCandidates,
    sequencePlan,
  }, { createCanvas: (width, height) => new FakeCanvas(width, height) }),
  (error) => error?.code === 'AIFX_TEMPORAL_CONFORM_QUALITY_REQUIRED',
  'quality-less generation must be limited to trigger=anchor-sequence-generation',
)

await assert.rejects(
  () => workflow.conformFrames({
    frames: frames.slice(0, 2),
    sequencePlan,
    quality: eligibleQuality,
  }, { createCanvas: (width, height) => new FakeCanvas(width, height) }),
  (error) => error?.code === 'AIFX_TEMPORAL_CONFORM_FRAME_PLAN_MISMATCH',
  'legacy fallback without explicit roles must retain one source cell per output frame',
)

const forbiddenRequest = { frames, sequencePlan, quality: eligibleQuality }
Object.defineProperty(forbiddenRequest, 'templateFrames', {
  enumerable: true,
  get() {
    throw new Error('forbidden template getter must never be read')
  },
})
await assert.rejects(
  () => workflow.conformFrames(forbiddenRequest, { createCanvas: (width, height) => new FakeCanvas(width, height) }),
  (error) => error?.code === 'AIFX_TEMPORAL_CONFORM_TEMPLATE_INPUT_FORBIDDEN',
)

await assert.rejects(
  () => workflow.conformFrames({
    frames,
    sequencePlan,
    quality: { passed: false, failures: [{ code: 'AIFX_SEQUENCE_TEMPLATE_STENCIL' }] },
  }, { createCanvas: (width, height) => new FakeCanvas(width, height) }),
  (error) => error?.code === 'AIFX_TEMPORAL_CONFORM_FAILURE_NOT_ELIGIBLE',
)

await assert.rejects(
  () => workflow.conformFrames({
    frames,
    sequencePlan,
    temporalCorrection: result.temporalCorrection,
  }, { createCanvas: (width, height) => new FakeCanvas(width, height) }),
  (error) => error?.code === 'AIFX_TEMPORAL_CONFORM_ALREADY_APPLIED',
)

const clippedFrames = Array.from({ length: 3 }, (_, index) => {
  const canvas = new FakeCanvas(WIDTH, HEIGHT)
  if (index === 1) fillRect(canvas, WIDTH - 20, 20, 20, 20, [255, 190, 60, 255])
  else fillRect(canvas, 20 + index * 10, 28, 3, 3, [100, 220, 255, 255])
  return {
    index,
    name: `clipped_${index}.png`,
    width: WIDTH,
    height: HEIGHT,
    canvas,
    pixelFormat: 'rgba8',
    alphaMode: 'straight',
  }
})
assert.equal(workflow.analyzeAiAlphaGeometry(clippedFrames[1]).boundaryClipped, true)
await assert.rejects(
  () => workflow.conformFrames({
    frames: clippedFrames,
    sequencePlan: [
      { index: 0, phase: 'onset', energy: 0.1, centerX: 0.3, centerY: 0.5, occupancy: 0.01 },
      { index: 1, phase: 'peak', energy: 1, centerX: 0.5, centerY: 0.5, occupancy: 0.2 },
      { index: 2, phase: 'decay', energy: 0.1, centerX: 0.7, centerY: 0.5, occupancy: 0.01 },
    ],
    quality: eligibleQuality,
    attempt: 3,
  }, { createCanvas: (width, height) => new FakeCanvas(width, height) }),
  (error) => error?.code === 'AIFX_TEMPORAL_CONFORM_ANCHOR_BOUNDARY_CLIPPED',
  'a raw peak that can only reach target occupancy by exposing a clipped cell edge must fail closed',
)

const directionalFrames = Array.from({ length: 3 }, (_, index) => {
  const canvas = new FakeCanvas(WIDTH, HEIGHT)
  fillRect(canvas, 17, 29, 29, 6, [80 + index * 40, 210, 255, 255])
  fillRect(canvas, 39, 25, 7, 4, [80 + index * 40, 210, 255, 255])
  return {
    index,
    name: `direction_${index}.png`,
    width: WIDTH,
    height: HEIGHT,
    canvas,
    pixelFormat: 'rgba8',
    alphaMode: 'straight',
  }
})
const directionalSourceGeometry = workflow.analyzeAiAlphaGeometry(directionalFrames[0])
const directionalPlan = directionalFrames.map((_, index) => ({
  index,
  phase: index === 0 ? 'onset' : index === 1 ? 'peak' : 'decay',
  energy: 1,
  centerX: 0.5,
  centerY: 0.5,
  directionDeg: 45,
  occupancy: directionalSourceGeometry.areaRatio,
}))
const directionalResult = await workflow.conformFrames({
  frames: directionalFrames,
  sequencePlan: directionalPlan,
  trigger: 'anchor-sequence-generation',
  options: { directionAlignmentEnabled: true },
}, {
  createCanvas: (width, height) => new FakeCanvas(width, height),
  canvasToDataUrl: (canvas) => canvas.toDataURL('image/png'),
})
assert.equal(directionalResult.temporalCorrection.rotationUsed, true)
for (const [index, frame] of directionalResult.frames.entries()) {
  const geometry = workflow.analyzeAiAlphaGeometry(frame)
  let residual = Math.abs(45 - geometry.principalAngleDeg) % 180
  if (residual > 90) residual = 180 - residual
  const relativeOccupancyError = Math.abs(geometry.areaRatio - directionalPlan[index].occupancy)
    / directionalPlan[index].occupancy
  const targetX = directionalPlan[index].centerX * (WIDTH - 1)
  const targetY = directionalPlan[index].centerY * (HEIGHT - 1)
  assert.ok(residual <= 5, `direction frame ${index} residual ${residual} must be <= 5 degrees`)
  assert.ok(relativeOccupancyError <= 0.08, `direction frame ${index} occupancy error ${relativeOccupancyError} must be <= 8%`)
  assert.ok(Math.hypot(geometry.centroid.x - targetX, geometry.centroid.y - targetY) <= 1)
  assert.equal(frame.temporalConform.rotationUsed, true)
  assert.ok(frame.temporalConform.residualDirectionDeg <= 5)
}

console.log('aifx-temporal-conform-contract: PASS')
