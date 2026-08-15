import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const workflowPath = 'particle-editor/aifx-sequence-quality.workflow.js'
const workflowSource = readFileSync(workflowPath, 'utf8')
const sandbox = { module: { exports: {} }, console }
runInNewContext(workflowSource, sandbox, { filename: workflowPath })

const quality = sandbox.module.exports
assert.equal(sandbox.NovaFlowAifxSequenceQualityWorkflow, quality, 'sequence quality workflow must expose the same browser and CommonJS API')
assert.equal(quality.version, 'aifx-sequence-quality-v3')
assert.equal(typeof quality.evaluate, 'function')
assert.equal(typeof quality.assertQuality, 'function')
assert.equal(typeof quality.measureGeneratedTransitionIou, 'function')
assert.deepEqual(Array.from(quality.DEFAULT_THRESHOLDS.maskThresholds), [0.05, 0.25], 'quality metrics must inspect both visible and solid alpha silhouettes')
assert.equal(quality.DEFAULT_THRESHOLDS.outerAreaCorrelationMin, 0.75)
assert.equal(quality.DEFAULT_THRESHOLDS.outerAreaNormalizedMaeMax, 0.28)
assert.equal(quality.DEFAULT_THRESHOLDS.outerTemplateIouMedianMin, 0.45)
assert.equal(quality.DEFAULT_THRESHOLDS.supportToleranceRatio, 0.03)
assert.equal(quality.DEFAULT_THRESHOLDS.supportF1MedianMin, 0.72)
assert.equal(quality.DEFAULT_THRESHOLDS.supportF1Min, 0.6)
assert.equal(quality.DEFAULT_THRESHOLDS.supportDilatedIouMedianMin, 0.55)
assert.equal(quality.DEFAULT_THRESHOLDS.directionErrorP90MaxDeg, 30)
assert.equal(quality.DEFAULT_THRESHOLDS.directionEndpointMeanMaxDeg, 30)
assert.equal(quality.DEFAULT_THRESHOLDS.poseEvolutionRetentionMin, 0.6)
assert.equal(quality.DEFAULT_THRESHOLDS.poseEvolutionRetentionMax, 1.8)
assert.equal(quality.DEFAULT_THRESHOLDS.poseEvolutionCorrelationMin, 0.35)
assert.equal(quality.DEFAULT_THRESHOLDS.tailTemplateReconfigurationIouMax, 0.2)
assert.equal(quality.DEFAULT_THRESHOLDS.tailGeneratedIouMax, 0.3)
assert.equal(quality.DEFAULT_THRESHOLDS.tailChangeRetentionMin, 0.65)
assert.equal(quality.DEFAULT_THRESHOLDS.outerCentroidDriftMedianMax, 0.06)
assert.equal(quality.DEFAULT_THRESHOLDS.outerCentroidDriftP95Max, 0.12)
assert.equal(quality.DEFAULT_THRESHOLDS.coreAreaCorrelationMin, 0.6)
assert.equal(quality.DEFAULT_THRESHOLDS.coreAreaNormalizedMaeMax, 0.35)
assert.equal(quality.DEFAULT_THRESHOLDS.coreTemplateIouMedianMin, 0.35)
assert.equal(quality.DEFAULT_THRESHOLDS.bodyAdjacentCompensatedIouMedianMin, 0.48)
assert.equal(quality.DEFAULT_THRESHOLDS.bodyAdjacentCompensatedIouMin, 0.32)
assert.equal(quality.DEFAULT_THRESHOLDS.centroidResidualVelocityP95Max, 0.08)
assert.equal(quality.DEFAULT_THRESHOLDS.centroidResidualAccelerationP95Max, 0.14)

const width = 72
const height = 72
const radii = [5, 9, 13, 16, 18, 16, 13, 9, 5]

function frameParameters(index) {
  return {
    centerX: 24 + index * 2,
    centerY: 35 + Math.sin(index * 0.55) * 1.5,
    radius: radii[index],
  }
}

function canvasFrame(predicate) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const sample = predicate(x + 0.5, y + 0.5)
      const alpha = sample === true ? 255 : Math.max(0, Math.min(255, Math.round(Number(sample) || 0)))
      if (!alpha) continue
      data[offset] = 120
      data[offset + 1] = 210
      data[offset + 2] = 255
      data[offset + 3] = alpha
    }
  }
  const imageData = { width, height, data }
  return {
    canvas: {
      width,
      height,
      getContext(type) {
        assert.equal(type, '2d')
        return { getImageData: () => imageData }
      },
    },
  }
}

function ellipseFrame(parameters, options = {}) {
  const centerX = parameters.centerX + (options.shiftX || 0)
  const centerY = parameters.centerY + (options.shiftY || 0)
  const radius = parameters.radius
  const phase = options.phase || 0
  const ripple = options.ripple || 0
  const alpha = options.alpha ?? true
  return canvasFrame((x, y) => {
    const normalizedX = (x - centerX) / (radius * 1.35)
    const normalizedY = (y - centerY) / (radius * 0.68)
    const angle = Math.atan2(normalizedY, normalizedX)
    const radialDistance = Math.hypot(normalizedX, normalizedY)
    const boundary = 1 + ripple * Math.sin(angle * 3 + phase)
    return radialDistance <= boundary ? alpha : 0
  })
}

const templateFrames = radii.map((_, index) => ellipseFrame(frameParameters(index)))
const smoothMaterialFrames = radii.map((_, index) => ellipseFrame(frameParameters(index), {
  ripple: 0.115,
  phase: index * 0.2,
}))

const positive = quality.evaluate({ templateFrames, generatedFrames: smoothMaterialFrames })
assert.equal(positive.passed, true, `smooth material deformation must pass: ${JSON.stringify(positive.failures)}`)
assert.equal(positive.code, null)
assert.equal(positive.diagnostics.perThreshold.length, 2)
const positiveOuter = positive.diagnostics.hardOuterGate
assert.equal(positiveOuter.alphaThreshold, 0.05)
assert.ok(positiveOuter.templateIou.median >= quality.DEFAULT_THRESHOLDS.outerTemplateIouMedianMin)
assert.ok(positiveOuter.areaCorrelation >= quality.DEFAULT_THRESHOLDS.outerAreaCorrelationMin)
assert.ok(positiveOuter.areaNormalizedMae <= quality.DEFAULT_THRESHOLDS.outerAreaNormalizedMaeMax)
assert.ok(positiveOuter.peakFrameDelta <= quality.DEFAULT_THRESHOLDS.outerPeakFrameDeltaMax)
assert.ok(positiveOuter.centroidDrift.median <= quality.DEFAULT_THRESHOLDS.outerCentroidDriftMedianMax)
assert.ok(positiveOuter.centroidDrift.p95 <= quality.DEFAULT_THRESHOLDS.outerCentroidDriftP95Max)
assert.ok(positiveOuter.bodyAdjacentCompensatedIou.median >= quality.DEFAULT_THRESHOLDS.bodyAdjacentCompensatedIouMedianMin)

function forkedMaterialFrame(parameters) {
  const centerX = parameters.centerX
  const centerY = parameters.centerY
  const radius = parameters.radius
  return canvasFrame((x, y) => {
    const normalizedX = (x - centerX) / Math.max(1, radius * 1.3)
    const normalizedY = (y - centerY) / Math.max(1, radius * 0.72)
    if (Math.abs(normalizedX) > 1 || Math.abs(normalizedY) > 1) return 0
    const trunk = Math.abs(normalizedY - normalizedX * 0.34) <= 0.105
    const upperFork = normalizedX > -0.15 && Math.abs(normalizedY + normalizedX * 0.52 - 0.08) <= 0.075
    const lowerFork = normalizedX < 0.3 && Math.abs(normalizedY + normalizedX * 0.7 + 0.13) <= 0.065
    return trunk || upperFork || lowerFork
  })
}

const distinctMaterialFrames = radii.map((_, index) => forkedMaterialFrame(frameParameters(index)))
const distinctMaterial = quality.evaluate({ templateFrames, generatedFrames: distinctMaterialFrames })
assert.equal(distinctMaterial.passed, true,
  `a coherent material-specific outline must not be forced back into the template contour: ${JSON.stringify(distinctMaterial.failures)}`)
assert.equal(distinctMaterial.diagnostics.outerTemplatePassed, false,
  'low template IoU must remain diagnostic because the material outline is expected to change')
assert.ok(distinctMaterial.warnings.some((warning) => warning.code === 'AIFX_SEQUENCE_TEMPLATE_OVERLAP_LOW'))

function morphingRibbonFrame(parameters, index, options = {}) {
  const centerX = parameters.centerX + (options.shiftX || 0)
  const centerY = parameters.centerY + (options.shiftY || 0)
  const radius = parameters.radius
  const phase = options.staticPhase ?? index * 0.72 + (options.phaseOffset || 0)
  const rotation = options.rotation || 0
  const amplitude = 0.25 * (options.amplitudeScale || 1)
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  return canvasFrame((x, y) => {
    const dx = x - centerX
    const dy = y - centerY
    const localX = dx * cosine + dy * sine
    const localY = -dx * sine + dy * cosine
    const normalizedX = localX / Math.max(1, radius * 1.35)
    const normalizedY = localY / Math.max(1, radius * 0.68)
    const angle = Math.atan2(normalizedY, normalizedX)
    const radialDistance = Math.hypot(normalizedX, normalizedY)
    const boundary = 1 + amplitude * Math.sin(angle * 3 + phase) + 0.055 * Math.sin(angle * 5 - phase * 0.45)
    return radialDistance <= boundary
  })
}

const evolvingTemplateFrames = radii.map((_, index) => morphingRibbonFrame(frameParameters(index), index))
const evolvingMaterialFrames = radii.map((_, index) => morphingRibbonFrame(frameParameters(index), index, {
  phaseOffset: 0.16,
  amplitudeScale: 1.08,
}))
const evolvingMaterial = quality.evaluate({ templateFrames: evolvingTemplateFrames, generatedFrames: evolvingMaterialFrames })
assert.equal(evolvingMaterial.passed, true,
  `a per-frame material redraw that retains the template pose curve must pass: ${JSON.stringify(evolvingMaterial.failures)}`)
assert.equal(evolvingMaterial.diagnostics.semanticAction.poseEvolution.active, true)
assert.ok(evolvingMaterial.diagnostics.semanticAction.support.f1.median >= quality.DEFAULT_THRESHOLDS.supportF1MedianMin)
assert.ok(evolvingMaterial.diagnostics.semanticAction.direction.p90ErrorDeg <= quality.DEFAULT_THRESHOLDS.directionErrorP90MaxDeg)
assert.ok(evolvingMaterial.diagnostics.semanticAction.poseEvolution.retentionRatio >= quality.DEFAULT_THRESHOLDS.poseEvolutionRetentionMin)
assert.ok(evolvingMaterial.diagnostics.semanticAction.poseEvolution.correlation >= quality.DEFAULT_THRESHOLDS.poseEvolutionCorrelationMin)

const frozenPeakFrames = radii.map((_, index) => morphingRibbonFrame(frameParameters(index), index, {
  staticPhase: 0.23,
  amplitudeScale: 1.04,
}))
const frozenPeak = quality.evaluate({ templateFrames: evolvingTemplateFrames, generatedFrames: frozenPeakFrames })
assert.equal(frozenPeak.passed, false, 'one peak shape translated/scaled through the lifecycle must fail')
assert.ok(
  frozenPeak.failures.some((failure) => failure.code === quality.ERROR_CODES.POSE_EVOLUTION_DIVERGED),
  `single-peak scaling must expose pose-evolution loss: ${JSON.stringify(frozenPeak.failures)}`,
)
assert.ok(frozenPeak.diagnostics.semanticAction.poseEvolution.retentionRatio < quality.DEFAULT_THRESHOLDS.poseEvolutionRetentionMin)

const orthogonalFrames = radii.map((_, index) => morphingRibbonFrame(frameParameters(index), index, {
  phaseOffset: 0.16,
  rotation: Math.PI / 2,
}))
const orthogonal = quality.evaluate({ templateFrames: evolvingTemplateFrames, generatedFrames: orthogonalFrames })
assert.equal(orthogonal.passed, false, 'a perpendicular material sequence must not pass on area and centroid alone')
assert.ok(
  orthogonal.failures.some((failure) => failure.code === quality.ERROR_CODES.TEMPLATE_DIVERGED),
  `perpendicular support must hard-fail: ${JSON.stringify(orthogonal.failures)}`,
)
assert.ok(
  orthogonal.failures.some((failure) => failure.code === quality.ERROR_CODES.DIRECTION_DIVERGED),
  `perpendicular direction must hard-fail: ${JSON.stringify(orthogonal.failures)}`,
)

const tailRadii = [5, 9, 13, 16, 18, 16, 13, 6, 4]
function tailParameters(index) {
  return { ...frameParameters(index), radius: tailRadii[index] }
}

function tailBarFrame(parameters, angle) {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return canvasFrame((x, y) => {
    const dx = x - parameters.centerX
    const dy = y - parameters.centerY
    const localX = dx * cosine + dy * sine
    const localY = -dx * sine + dy * cosine
    return Math.abs(localX) <= parameters.radius * 1.45 && Math.abs(localY) <= Math.max(1, parameters.radius * 0.28)
  })
}

const tailTemplateFrames = tailRadii.map((_, index) => index < 6
  ? morphingRibbonFrame(tailParameters(index), index)
  : tailBarFrame(tailParameters(index), [0, Math.PI / 3, -Math.PI / 3][index - 6]))
const frozenTailFrames = tailRadii.map((_, index) => index < 6
  ? morphingRibbonFrame(tailParameters(index), index, { phaseOffset: 0.16, amplitudeScale: 1.08 })
  : tailBarFrame(tailParameters(index), 0))
const frozenTail = quality.evaluate({ templateFrames: tailTemplateFrames, generatedFrames: frozenTailFrames })
assert.equal(frozenTail.passed, false, 'uniformly shrinking one decay shape must fail a reconfiguring template tail')
assert.ok(
  frozenTail.failures.some((failure) => failure.code === quality.ERROR_CODES.TAIL_FROZEN),
  `frozen tail must expose breakup/dissipation diagnostics: ${JSON.stringify(frozenTail.failures)}`,
)
assert.equal(frozenTail.diagnostics.semanticAction.tailReconfiguration.active, true)
assert.ok(frozenTail.diagnostics.semanticAction.tailReconfiguration.changeRetentionRatio < quality.DEFAULT_THRESHOLDS.tailChangeRetentionMin)
assert.ok(
  quality.measureGeneratedTransitionIou(frozenTailFrames[6], frozenTailFrames[7]) > 0.3,
  'the public generated-transition metric must use the same centroid/scale-compensated IoU as the tail gate',
)

function detachedTailBarFrame(parameters, angle) {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return canvasFrame((x, y) => {
    const dx = x - parameters.centerX
    const dy = y - parameters.centerY
    const localX = dx * cosine + dy * sine
    const localY = -dx * sine + dy * cosine
    const branchOffset = parameters.radius * 0.68
    const branchHalfWidth = Math.max(1, parameters.radius * 0.17)
    const detachedBranch = Math.abs(localX) <= parameters.radius * 1.08
      && Math.min(Math.abs(localY - branchOffset), Math.abs(localY + branchOffset)) <= branchHalfWidth
    return detachedBranch
  })
}

const detachedTailFrames = tailRadii.map((_, index) => index < 6
  ? morphingRibbonFrame(tailParameters(index), index, { phaseOffset: 0.16, amplitudeScale: 1.08 })
  : detachedTailBarFrame(tailParameters(index), [0, Math.PI / 3, -Math.PI / 3][index - 6]))
const detachedTail = quality.evaluate({ templateFrames: tailTemplateFrames, generatedFrames: detachedTailFrames })
assert.equal(detachedTail.diagnostics.semanticAction.tailReconfiguration.active, true)
assert.deepEqual(
  Array.from(detachedTail.diagnostics.semanticAction.support.excludedTailFrameIndices),
  [6],
  'the active breakup frame must leave the body-support domain once the dedicated tail gate is active',
)
assert.ok(detachedTail.diagnostics.semanticAction.support.allActiveF1.min < quality.DEFAULT_THRESHOLDS.supportF1Min)
assert.ok(detachedTail.diagnostics.semanticAction.support.f1.min >= quality.DEFAULT_THRESHOLDS.supportF1Min)
assert.ok(
  !detachedTail.failures.some((failure) => failure.code === quality.ERROR_CODES.TEMPLATE_DIVERGED),
  `detached tail topology must not fight the body-support gate: ${JSON.stringify(detachedTail.failures)}`,
)
assert.ok(
  !detachedTail.failures.some((failure) => failure.code === quality.ERROR_CODES.TAIL_FROZEN),
  `independently reconfigured tail frames must satisfy the dedicated tail gate: ${JSON.stringify(detachedTail.failures)}`,
)
assert.ok(
  orthogonal.failures.some((failure) => failure.code === quality.ERROR_CODES.TEMPLATE_DIVERGED),
  'a divergent active body must still fail the unchanged support threshold',
)

function weakLightningCoreFrame(parameters, index) {
  const centerX = parameters.centerX
  const centerY = parameters.centerY
  const radius = parameters.radius
  return canvasFrame((x, y) => {
    const normalizedX = (x - centerX) / (radius * 1.35)
    const normalizedY = (y - centerY) / (radius * 0.68)
    const angle = Math.atan2(normalizedY, normalizedX)
    const outer = Math.hypot(normalizedX, normalizedY) <= 1 + 0.115 * Math.sin(angle * 3 + index * 0.2)
    if (!outer) return 0
    const core = Math.hypot((x - centerX) / 2.4, (y - centerY) / 1.4) <= 1
    return core ? 255 : 48
  })
}

const weakLightningCoreFrames = radii.map((_, index) => weakLightningCoreFrame(frameParameters(index), index))
const weakLightningCore = quality.evaluate({ templateFrames, generatedFrames: weakLightningCoreFrames })
assert.equal(weakLightningCore.passed, true, `a valid outer lightning envelope must not be killed by a weak solid core: ${JSON.stringify(weakLightningCore.failures)}`)
assert.equal(weakLightningCore.diagnostics.hardOuterGate.alphaThreshold, 0.05)
assert.equal(weakLightningCore.diagnostics.coreAuxiliary.metrics.alphaThreshold, 0.25)
assert.equal(weakLightningCore.diagnostics.coreAuxiliary.passed, false, 'solid-core failure must remain auxiliary when the outer sequence is valid')
assert.ok(weakLightningCore.warnings.length > 0, 'weak solid-core diagnostics must be returned as warnings')

const copiedTemplate = quality.evaluate({ templateFrames, generatedFrames: templateFrames })
assert.equal(copiedTemplate.passed, false)
assert.equal(copiedTemplate.code, quality.ERROR_CODES.TEMPLATE_STENCIL)
assert.equal(copiedTemplate.diagnostics.exactAlphaFrameRatio, 1)
assert.throws(
  () => quality.assertQuality({ templateFrames, generatedFrames: templateFrames }),
  (error) => error.code === 'AIFX_SEQUENCE_TEMPLATE_STENCIL' && error.diagnostics.exactAlphaFrameRatio === 1,
  'pixel-for-pixel template alpha reproduction must hard-fail with diagnostics',
)

const alphaRemappedTemplateFrames = radii.map((_, index) => {
  const parameters = frameParameters(index)
  return ellipseFrame(parameters, { alpha: 48 })
})
const alphaRemappedTemplate = quality.evaluate({ templateFrames, generatedFrames: alphaRemappedTemplateFrames })
assert.equal(alphaRemappedTemplate.passed, false)
assert.equal(alphaRemappedTemplate.code, quality.ERROR_CODES.TEMPLATE_STENCIL, 'an exact mask at either alpha threshold must hard-fail even when alpha bytes differ')
assert.equal(alphaRemappedTemplate.diagnostics.exactAlphaFrameRatio, 0)
assert.equal(alphaRemappedTemplate.diagnostics.maximumExactMaskRatio, 1)

const translatedTemplateFrames = radii.map((_, index) => ellipseFrame(frameParameters(index), { shiftX: 6, shiftY: -4 }))
const translatedTemplate = quality.evaluate({ templateFrames, generatedFrames: translatedTemplateFrames })
assert.equal(translatedTemplate.passed, false, 'translation must not count as a material-specific silhouette')
assert.ok(
  translatedTemplate.failures.some((failure) => failure.code === quality.ERROR_CODES.TEMPLATE_STENCIL),
  `translation cheat must be detected after centroid compensation: ${JSON.stringify(translatedTemplate.failures)}`,
)

const jitterOffsets = [
  [0, 0], [7, -5], [-6, 6], [8, 5], [-7, -6], [6, 7], [-8, 4], [7, -7], [-6, 5],
]
const jitterFrames = radii.map((_, index) => ellipseFrame(frameParameters(index), {
  shiftX: jitterOffsets[index][0],
  shiftY: jitterOffsets[index][1],
  ripple: 0.16,
  phase: index * 2.35,
}))
const jitter = quality.evaluate({ templateFrames, generatedFrames: jitterFrames })
assert.equal(jitter.passed, false, 'random per-frame deformation must fail')
assert.ok(
  jitter.failures.some((failure) => failure.code === quality.ERROR_CODES.TEMPORAL_JITTER),
  `random deformation must expose temporal jitter diagnostics: ${JSON.stringify(jitter.failures)}`,
)

const flatParameters = frameParameters(4)
const flatGridFrames = radii.map(() => ellipseFrame(flatParameters, { ripple: 0.11, phase: 0.8 }))
const flatGrid = quality.evaluate({ templateFrames, generatedFrames: flatGridFrames })
assert.equal(flatGrid.passed, false)
assert.equal(flatGrid.code, quality.ERROR_CODES.LIFECYCLE_INCOHERENT, `flat nine-cell lifecycle must be the primary failure: ${JSON.stringify(flatGrid.failures)}`)
assert.ok(flatGrid.diagnostics.hardOuterGate.areaCorrelation < quality.DEFAULT_THRESHOLDS.outerAreaCorrelationMin)
assert.ok(flatGrid.diagnostics.hardOuterGate.peakFrameDelta > quality.DEFAULT_THRESHOLDS.outerPeakFrameDeltaMax)
assert.throws(
  () => quality.assertQuality({ templateFrames, generatedFrames: flatGridFrames }),
  (error) => error.code === 'AIFX_SEQUENCE_LIFECYCLE_INCOHERENT' && error.diagnostics.hardOuterGate.peakFrameDelta > 1,
)

assert.match(workflowSource, /AIFX_SEQUENCE_TEMPLATE_STENCIL/)
assert.match(workflowSource, /AIFX_SEQUENCE_LIFECYCLE_INCOHERENT/)
assert.match(workflowSource, /AIFX_SEQUENCE_DIRECTION_DIVERGED/)
assert.match(workflowSource, /AIFX_SEQUENCE_POSE_EVOLUTION_DIVERGED/)
assert.match(workflowSource, /AIFX_SEQUENCE_TAIL_FROZEN/)
assert.match(workflowSource, /bodyAdjacentCompensatedIou/)
assert.match(workflowSource, /tolerantSupport/)
assert.match(workflowSource, /supportDilatedIouMedianMin/)
assert.match(workflowSource, /principalAngleErrorDegrees/)
assert.match(workflowSource, /centroidAndUniformScaleCompensatedIou/)
assert.match(workflowSource, /tailReconfiguration/)
assert.match(workflowSource, /areaCorrelation/)
assert.match(workflowSource, /centroidDrift/)
assert.match(workflowSource, /outer\.areaCorrelation < thresholds\.outerAreaCorrelationMin/)
assert.match(workflowSource, /maximumExactMaskRatio >= thresholds\.stencilExactFrameRatioMin/)
assert.doesNotMatch(workflowSource, /minimumAreaCorrelation < thresholds\.areaCorrelationMin/)

console.log('aifx-sequence-quality-contract: PASS')
