import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = path.join(root, 'particle-editor', 'aifx-material-reconstruct.workflow.js')
const workflowSource = readFileSync(workflowPath, 'utf8')
const sandbox = { module: { exports: {} }, console, Object, Error, Map, Set, Number, Math, String, Array, RegExp }
runInNewContext(workflowSource, sandbox, { filename: workflowPath })
const workflow = sandbox.module.exports
const qualityPath = path.join(root, 'particle-editor', 'aifx-sequence-quality.workflow.js')
const qualitySandbox = { module: { exports: {} }, console }
runInNewContext(readFileSync(qualityPath, 'utf8'), qualitySandbox, { filename: qualityPath })
const sequenceQuality = qualitySandbox.module.exports

assert.equal(workflow.version, 'aifx-material-reconstruct-v3')
assert.equal(sandbox.NovaFlowAifxMaterialReconstructWorkflow, workflow)
assert.equal(workflow.pipeline, 'qwen-image-edit-2511-multi-phase-material-morphology-v2')
assert.deepEqual([...workflow.anchorRoles], ['peak', 'onset', 'decay', 'breakup', 'dissipation'])
assert.deepEqual([...workflow.initialMaterials], ['fire', 'lightning', 'ice', 'poison'])
assert.equal(workflow.finalShapeAuthority, 'ai-anchor-geometry')
assert.equal(workflow.motionConstraint, 'template-center-occupancy-direction-lifecycle-envelope')
assert.equal('qualityThresholds' in workflow, false, 'the morphology workflow must not relax the shared sequence-quality gate')
assert.doesNotMatch(
  workflowSource,
  /applyTopologyBreakup|randomAlpha|Math\.random|crypto\.getRandomValues/,
  'tail evolution must come from real AI breakup/dissipation anchors, not random alpha deletion',
)
assert.match(workflowSource, /log\('\[AIFX anchor attempt rejected\]', JSON\.stringify\(\{/)

class PixelCanvas {
  constructor(width, height) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }

  getContext() {
    const canvas = this
    return {
      clearRect() {
        canvas.data.fill(0)
      },
      drawImage(source) {
        canvas.data.set(source.data)
      },
      getImageData() {
        return { data: new Uint8ClampedArray(canvas.data) }
      },
      putImageData(image) {
        canvas.data.set(image.data)
      },
    }
  }

  toDataURL() {
    return 'data:image/png;base64,fixture'
  }
}

const paintRect = (canvas, x0, y0, x1, y1, rgba = [90, 210, 255, 255]) => {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const offset = (y * canvas.width + x) * 4
      canvas.data[offset] = rgba[0]
      canvas.data[offset + 1] = rgba[1]
      canvas.data[offset + 2] = rgba[2]
      canvas.data[offset + 3] = rgba[3]
    }
  }
}

const paintLine = (canvas, x0, y0, x1, y1, thickness = 3) => {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(x0 + (x1 - x0) * (step / steps))
    const y = Math.round(y0 + (y1 - y0) * (step / steps))
    const half = Math.floor(thickness / 2)
    paintRect(canvas, x - half, y - half, x + half, y + half)
  }
}

const decayCanvas = new PixelCanvas(96, 96)
paintRect(decayCanvas, 42, 42, 53, 53, [210, 245, 255, 255])
paintRect(decayCanvas, 8, 46, 41, 50)
paintRect(decayCanvas, 54, 46, 87, 50)
paintRect(decayCanvas, 46, 8, 50, 41)
paintRect(decayCanvas, 46, 54, 50, 87)
const refinedDecay = workflow.refineGeneratedAnchorTopology({
  width: 96,
  height: 96,
  canvas: decayCanvas,
  dataUrl: decayCanvas.toDataURL(),
}, {
  role: 'decay',
  materialType: 'lightning',
}, {
  createCanvas: (width, height) => new PixelCanvas(width, height),
})
assert.equal(refinedDecay.cleanup.applied, true)
assert.equal(refinedDecay.cleanup.method, 'generated-lightning-decay-soft-hub-sever')
assert.equal(refinedDecay.cleanup.source, 'ai-generated-anchor-pixels')
assert.equal(refinedDecay.cleanup.templatePixelsUsed, false)
assert.equal(refinedDecay.cleanup.templateMaskUsed, false)
assert.equal(refinedDecay.frame.canvas.data[(48 * 96 + 48) * 4 + 3], 0, 'decay must sever its generated dense hub')
assert.equal(refinedDecay.frame.canvas.data[(48 * 96 + 10) * 4 + 3], 255, 'decay must retain generated outer branches')

const dissipationCanvas = new PixelCanvas(96, 96)
paintRect(dissipationCanvas, 34, 34, 61, 61, [210, 245, 255, 255])
paintRect(dissipationCanvas, 7, 10, 14, 17)
paintRect(dissipationCanvas, 76, 12, 83, 19)
paintRect(dissipationCanvas, 70, 76, 77, 83)
paintRect(dissipationCanvas, 8, 74, 15, 81)
paintRect(dissipationCanvas, 44, 7, 51, 14)
const refinedDissipation = workflow.refineGeneratedAnchorTopology({
  width: 96,
  height: 96,
  canvas: dissipationCanvas,
  dataUrl: dissipationCanvas.toDataURL(),
}, {
  role: 'dissipation',
  materialType: 'lightning',
}, {
  createCanvas: (width, height) => new PixelCanvas(width, height),
})
assert.equal(refinedDissipation.cleanup.applied, true)
assert.equal(refinedDissipation.cleanup.state, 'refined')
assert.equal(refinedDissipation.cleanup.method, 'generated-lightning-dissipation-residue-selection')
assert.equal(refinedDissipation.cleanup.source, 'ai-generated-anchor-pixels')
assert.equal(refinedDissipation.cleanup.templatePixelsUsed, false)
assert.equal(refinedDissipation.cleanup.templateMaskUsed, false)
assert.equal(refinedDissipation.cleanup.dilationPixels, 0)
assert.equal(refinedDissipation.frame.canvas.data[(48 * 96 + 48) * 4 + 3], 0, 'dissipation must reject the generated dominant body')
assert.equal(refinedDissipation.frame.canvas.data[(12 * 96 + 9) * 4 + 3], 255, 'dissipation must retain detached generated residue')

const connectedStarburstCanvas = new PixelCanvas(128, 128)
for (const [x, y] of [[8, 64], [120, 64], [64, 8], [64, 120], [16, 16], [112, 16], [16, 112], [112, 112]]) {
  paintLine(connectedStarburstCanvas, 64, 64, x, y, 3)
}
paintRect(connectedStarburstCanvas, 58, 58, 70, 70, [210, 245, 255, 255])
const refinedConnectedStarburst = workflow.refineGeneratedAnchorTopology({
  width: 128,
  height: 128,
  canvas: connectedStarburstCanvas,
}, {
  role: 'dissipation',
  materialType: 'lightning',
}, {
  createCanvas: (width, height) => new PixelCanvas(width, height),
})
assert.equal(refinedConnectedStarburst.cleanup.applied, true)
assert.equal(refinedConnectedStarburst.cleanup.hubSever.applied, true)
assert.ok(refinedConnectedStarburst.cleanup.selectedResidueCount >= 5)
assert.ok(refinedConnectedStarburst.cleanup.readablePostResidueCount >= 5)

const refinedBreakupStarburst = workflow.refineGeneratedAnchorTopology({
  width: 128,
  height: 128,
  canvas: connectedStarburstCanvas,
}, {
  role: 'breakup',
  materialType: 'lightning',
}, {
  createCanvas: (width, height) => new PixelCanvas(width, height),
})
assert.equal(refinedBreakupStarburst.cleanup.applied, true)
assert.equal(refinedBreakupStarburst.cleanup.method, 'generated-lightning-breakup-fragment-selection')
assert.ok(refinedBreakupStarburst.cleanup.selectedResidueCount >= 4)
assert.ok(refinedBreakupStarburst.cleanup.selectedResidueCount <= 10)
assert.ok(refinedBreakupStarburst.cleanup.readablePostResidueCount >= 4)
assert.ok(refinedBreakupStarburst.cleanup.readablePostResidueCount <= 10)
assert.equal(refinedBreakupStarburst.cleanup.templatePixelsUsed, false)
assert.equal(refinedBreakupStarburst.cleanup.templateMaskUsed, false)

const balancedFiveResidueCanvas = new PixelCanvas(128, 128)
paintRect(balancedFiveResidueCanvas, 8, 8, 27, 27)
paintRect(balancedFiveResidueCanvas, 72, 8, 84, 19)
paintRect(balancedFiveResidueCanvas, 104, 8, 116, 19)
paintRect(balancedFiveResidueCanvas, 72, 96, 84, 107)
paintRect(balancedFiveResidueCanvas, 104, 96, 116, 107)
const preservedBalancedFiveResidues = workflow.refineGeneratedAnchorTopology({
  width: 128,
  height: 128,
  canvas: balancedFiveResidueCanvas,
}, {
  role: 'dissipation',
  materialType: 'lightning',
}, {
  createCanvas: (width, height) => new PixelCanvas(width, height),
})
assert.equal(preservedBalancedFiveResidues.cleanup.dominantMainRemoved, false)
assert.equal(preservedBalancedFiveResidues.cleanup.selectedResidueCount, 5)
assert.equal(preservedBalancedFiveResidues.cleanup.readablePostResidueCount, 5)
assert.equal(preservedBalancedFiveResidues.cleanup.dilationPixels, 0)
assert.ok(preservedBalancedFiveResidues.cleanup.largestPostFraction <= 0.6)

const breakupComparisonCanvas = new PixelCanvas(128, 128)
const crossSelectedDissipationCanvas = new PixelCanvas(128, 128)
for (const x of [8, 31, 54, 77, 100]) {
  paintRect(breakupComparisonCanvas, x, 25, x + 11, 36)
  paintRect(crossSelectedDissipationCanvas, x, 25, x + 11, 36)
}
for (const y of [48, 64, 80, 96, 112]) {
  paintRect(breakupComparisonCanvas, 58, y, 65, y + 7)
  paintRect(crossSelectedDissipationCanvas, 58, y, 65, y + 7)
}
const crossSelectedDissipation = workflow.refineGeneratedAnchorTopology({
  width: 128,
  height: 128,
  canvas: crossSelectedDissipationCanvas,
}, {
  role: 'dissipation',
  materialType: 'lightning',
  comparisonFrame: {
    width: 128,
    height: 128,
    canvas: breakupComparisonCanvas,
  },
  comparisonRole: 'breakup',
}, {
  createCanvas: (width, height) => new PixelCanvas(width, height),
})
assert.equal(crossSelectedDissipation.cleanup.comparisonGeneratedOnly, true)
assert.equal(crossSelectedDissipation.cleanup.comparisonRole, 'breakup')
assert.ok(crossSelectedDissipation.cleanup.selectionCandidateCount > 1)
assert.ok(
  crossSelectedDissipation.cleanup.selectionSkip > 0
    || crossSelectedDissipation.cleanup.selectedResidueCount < 10,
  `cross-anchor selector must reject at least one duplicated generated component: ${JSON.stringify(crossSelectedDissipation.cleanup)}`,
)
assert.ok(crossSelectedDissipation.cleanup.selectedTransitionIou < crossSelectedDissipation.cleanup.baselineTransitionIou)
assert.ok(crossSelectedDissipation.cleanup.retainedPixelsComparedToBaseline >= 0.7)
assert.ok(Math.abs(
  sequenceQuality.measureGeneratedTransitionIou(
    { canvas: breakupComparisonCanvas },
    { canvas: crossSelectedDissipation.frame.canvas },
  ) - crossSelectedDissipation.cleanup.selectedTransitionIou,
) <= 1e-12, 'generated-only residue selection must use the exact public tail-gate transition metric')
assert.equal(crossSelectedDissipation.cleanup.templatePixelsUsed, false)
assert.equal(crossSelectedDissipation.cleanup.templateMaskUsed, false)
assert.ok(crossSelectedDissipation.cleanup.retainedActiveRatio < 1)

const multipleDominantBreakupCanvas = new PixelCanvas(256, 256)
paintRect(multipleDominantBreakupCanvas, 8, 8, 82, 67)
paintRect(multipleDominantBreakupCanvas, 100, 8, 159, 37)
paintRect(multipleDominantBreakupCanvas, 185, 8, 224, 32)
for (let index = 0; index < 26; index += 1) {
  const column = index % 7
  const row = Math.floor(index / 7)
  const x = 10 + column * 34
  const y = 92 + row * 36
  paintRect(multipleDominantBreakupCanvas, x, y, x + 7, y + 7)
}
paintRect(multipleDominantBreakupCanvas, 83, 26, 99, 27, [90, 210, 255, 16])
const refinedMultipleDominantBreakup = workflow.refineGeneratedAnchorTopology({
  width: 256,
  height: 256,
  canvas: multipleDominantBreakupCanvas,
}, {
  role: 'breakup',
  materialType: 'lightning',
}, {
  createCanvas: (width, height) => new PixelCanvas(width, height),
})
assert.equal(refinedMultipleDominantBreakup.cleanup.source, 'ai-generated-anchor-pixels')
assert.equal(refinedMultipleDominantBreakup.cleanup.templatePixelsUsed, false)
assert.equal(refinedMultipleDominantBreakup.cleanup.templateMaskUsed, false)
assert.equal(refinedMultipleDominantBreakup.cleanup.dilationPixels, 0)
assert.ok(refinedMultipleDominantBreakup.cleanup.discardedDominantCount >= 2)
assert.ok(refinedMultipleDominantBreakup.cleanup.selectedResidueCount >= 4)
assert.ok(refinedMultipleDominantBreakup.cleanup.selectedResidueCount <= 10)
assert.equal(
  refinedMultipleDominantBreakup.cleanup.selectedResidueCount,
  refinedMultipleDominantBreakup.cleanup.readablePostResidueCount,
)
assert.ok(refinedMultipleDominantBreakup.cleanup.largestPostFraction <= 0.6)
assert.equal(refinedMultipleDominantBreakup.frame.canvas.data[(12 * 256 + 12) * 4 + 3], 0)
assert.equal(refinedMultipleDominantBreakup.frame.canvas.data[(94 * 256 + 12) * 4 + 3], 255)

const preservedFire = workflow.refineGeneratedAnchorTopology({ canvas: decayCanvas }, {
  role: 'decay',
  materialType: 'fire',
})
assert.equal(preservedFire.cleanup.applied, false)
assert.equal(preservedFire.cleanup.templatePixelsUsed, false)
assert.equal(preservedFire.cleanup.templateMaskUsed, false)
assert.throws(
  () => workflow.refineGeneratedAnchorTopology({
    width: 96,
    height: 96,
    canvas: new PixelCanvas(96, 96),
  }, {
    role: 'decay',
    materialType: 'lightning',
  }, {
    createCanvas: (width, height) => new PixelCanvas(width, height),
  }),
  (error) => error?.code === 'AIFX_MORPHOLOGY_DECAY_TOPOLOGY_UNRESOLVED'
    && error?.details?.templatePixelsUsed === false
    && error?.details?.templateMaskUsed === false,
)
const unresolvedDissipationCanvas = new PixelCanvas(96, 96)
paintRect(unresolvedDissipationCanvas, 30, 30, 65, 65)
assert.throws(
  () => workflow.refineGeneratedAnchorTopology({
    width: 96,
    height: 96,
    canvas: unresolvedDissipationCanvas,
  }, {
    role: 'dissipation',
    materialType: 'lightning',
  }, {
    createCanvas: (width, height) => new PixelCanvas(width, height),
  }),
  (error) => error?.code === 'AIFX_MORPHOLOGY_DISSIPATION_TOPOLOGY_UNRESOLVED'
    && error?.details?.templatePixelsUsed === false
    && error?.details?.templateMaskUsed === false,
)
const broadConnectedCanvas = new PixelCanvas(512, 512)
paintRect(broadConnectedCanvas, 56, 56, 455, 455, [110, 220, 255, 255])
const refinedBroadConnected = workflow.refineGeneratedAnchorTopology({
    width: 512,
    height: 512,
    canvas: broadConnectedCanvas,
  }, {
    role: 'decay',
    materialType: 'lightning',
  }, {
    createCanvas: (width, height) => new PixelCanvas(width, height),
  })
assert.equal(refinedBroadConnected.cleanup.applied, true)
assert.equal(refinedBroadConnected.cleanup.axisBandApplied, true)
assert.ok(refinedBroadConnected.cleanup.meaningfulComponentCount >= 2)
assert.equal(refinedBroadConnected.frame.canvas.data[(256 * 512 + 256) * 4 + 3], 0)
const referenceContract = workflow.buildReferenceContract({
  materialOnly: {
    positivePrompt: 'fire material. Read image2 only as spatially scrambled local material statistics.',
    styleTags: ['fire material', 'material-only reference', 'local material statistics'],
  },
})
assert.match(referenceContract.positivePrompt, /complete image2 reference/)
assert.doesNotMatch(referenceContract.positivePrompt, /spatially scrambled/)
assert.equal(referenceContract.referenceTopologyUsed, true)
assert.equal(referenceContract.styleReferenceRole, 'full-material-morphology-reference')

const sequencePlan = Array.from({ length: 9 }, (_, index) => ({
  index,
  phase: ['onset', 'growth', 'peak', 'follow-through', 'decay', 'decay', 'decay', 'breakup', 'dissipation'][index],
  energy: [0.12, 0.55, 1, 0.78, 0.52, 0.34, 0.2, 0.1, 0.04][index],
  occupancy: [0.06, 0.2, 0.38, 0.31, 0.24, 0.18, 0.12, 0.07, 0.02][index],
  centerX: 0.45 + index * 0.02,
  centerY: 0.5,
  directionDeg: 12,
}))
const anchorSpecs = [
  { role: 'peak', globalIndex: 2, plan: sequencePlan[2] },
  { role: 'onset', globalIndex: 0, plan: sequencePlan[0] },
  { role: 'breakup', globalIndex: 7, plan: sequencePlan[7] },
  { role: 'dissipation', globalIndex: 8, plan: sequencePlan[8] },
]
const reference = {
  name: 'material-reference.png',
  dataUrl: 'data:image/png;base64,AA==',
  width: 512,
  height: 512,
}
const plan = workflow.createPlan({ sequencePlan, anchorSpecs, materialType: 'lightning', reference })

const selectedAnchorSpecs = workflow.selectAnchorSpecs(sequencePlan)
assert.deepEqual(
  Array.from(selectedAnchorSpecs, (entry) => [entry.role, entry.globalIndex]),
  [['peak', 2], ['decay', 5], ['breakup', 7], ['dissipation', 8]],
  'the workflow must own deterministic peak/body-decay/breakup/dissipation anchor selection',
)
const terminalEnergySpecs = workflow.selectAnchorSpecs(sequencePlan.map((entry, index) => ({
  ...entry,
  ...(index === 2 ? { energy: 0.8 } : {}),
  ...(index === 8 ? { energy: 1 } : {}),
})))
assert.equal(terminalEnergySpecs[0].globalIndex, 2, 'the declared peak phase must outrank a higher-energy terminal frame')
const fallbackPeakSpecs = workflow.selectAnchorSpecs(sequencePlan.map((entry, index) => ({
  ...entry,
  ...(index === 2 ? { phase: 'growth', energy: 0.7 } : {}),
  ...(index === 4 ? { energy: 0.9, occupancy: 0.2 } : {}),
  ...(index === 5 ? { energy: 0.9, occupancy: 0.3 } : {}),
})))
assert.equal(fallbackPeakSpecs[0].globalIndex, 5, 'energy then occupancy must select a peak only when no peak phase exists')

assert.deepEqual(Array.from(plan.anchors, (entry) => entry.role), ['peak', 'onset', 'breakup', 'dissipation'])
assert.equal(plan.reference.role, 'full-material-morphology-reference')
assert.equal(plan.reference.fullReferenceImageSent, true)
assert.equal(plan.reference.macroLayoutAvailableToModel, true)
assert.equal(plan.finalShapeAuthority, 'ai-anchor-geometry')
assert.equal(plan.identityConditioning, 'full-reference-peak-distillation-plus-macro-free-peak-material-token-for-nonpeak-anchors')
assert.equal(plan.templatePixelsUsed, false)
assert.equal(plan.silentTemplateFallbackAllowed, false)

const retryPolicy = workflow.createRetryPolicy(plan, {
  initialSequenceSeed: 101,
  maximumAnchorAttempts: 3,
})
assert.equal(retryPolicy.maximumAnchorAttempts, 3)
assert.equal(retryPolicy.boundedPostPeakRetryEnabled, true)
assert.equal(retryPolicy.maximumRetryAnchorCalls, 3)
assert.equal(retryPolicy.maximumGeneratedAnchorCalls, 10)
assert.equal(retryPolicy.seedStrategy, 'reference-peak-with-deterministic-phase-offsets-and-bounded-post-peak-retry')
assert.equal(workflow.sequenceSeedForAttempt(retryPolicy, 1), 101)
assert.equal(workflow.sequenceSeedForAttempt(retryPolicy, 2), 15485964)
assert.equal(workflow.sequenceSeedForAttempt(retryPolicy, 3), 30971827)
assert.equal(workflow.seedForAnchorRole(101, 'peak'), 101)
assert.equal(workflow.seedForAnchorRole(101, 'onset'), 32452944)
assert.equal(workflow.seedForAnchorRole(101, 'decay'), 49979788)
assert.equal(workflow.seedForAnchorRole(101, 'breakup'), 67868068)
assert.equal(workflow.seedForAnchorRole(101, 'dissipation'), 86028222)

const selectedPlan = workflow.createPlan({
  sequencePlan,
  anchorSpecs: selectedAnchorSpecs,
  materialType: 'lightning',
  reference,
})
const selectedRetryPolicy = workflow.createRetryPolicy(selectedPlan, { initialSequenceSeed: 11 })
assert.equal(selectedRetryPolicy.maximumRetryAnchorCalls, 3)
assert.equal(selectedRetryPolicy.maximumGeneratedAnchorCalls, 10)

const retainedRolePlan = workflow.createPlan({
  sequencePlan,
  anchorSpecs: [
    anchorSpecs[0],
    anchorSpecs[1],
    { role: 'decay', globalIndex: 5, plan: sequencePlan[5] },
    anchorSpecs[3],
  ],
  materialType: 'lightning',
  reference,
})
const retainedRolePolicy = workflow.createRetryPolicy(retainedRolePlan, { initialSequenceSeed: 23 })
const tailRetry = workflow.evaluateRetry(retainedRolePolicy, {
  attempt: 1,
  error: { code: 'AIFX_SEQUENCE_TAIL_FROZEN', failures: [{ code: 'AIFX_SEQUENCE_TAIL_FROZEN' }] },
})
assert.equal(tailRetry.shouldRetry, true)
assert.equal(tailRetry.tailOnlyRetry, true)
assert.deepEqual([...tailRetry.retainedRoles], ['peak', 'onset', 'decay'])
const broadRetry = workflow.evaluateRetry(retainedRolePolicy, {
  attempt: 1,
  error: {
    code: 'AIFX_SEQUENCE_TEMPLATE_DIVERGED',
    failures: [{ code: 'AIFX_SEQUENCE_TEMPLATE_DIVERGED' }, { code: 'AIFX_SEQUENCE_TAIL_FROZEN' }],
  },
})
assert.equal(broadRetry.shouldRetry, true)
assert.equal(broadRetry.tailOnlyRetry, false)
assert.deepEqual([...broadRetry.retainedRoles], ['peak'])
const unresolvedTopologyRetry = workflow.evaluateRetry(retainedRolePolicy, {
  attempt: 1,
  error: { code: 'AIFX_MORPHOLOGY_DISSIPATION_TOPOLOGY_UNRESOLVED' },
})
assert.equal(unresolvedTopologyRetry.shouldRetry, true)
assert.deepEqual([...unresolvedTopologyRetry.retainedRoles], ['peak'])
assert.equal(workflow.evaluateRetry(retainedRolePolicy, {
  attempt: 1,
  error: { code: 'AIFX_MORPHOLOGY_BREAKUP_TOPOLOGY_UNRESOLVED' },
}).shouldRetry, true)
const targetedOnsetRetry = workflow.evaluateRetry(retainedRolePolicy, {
  attempt: 1,
  error: {
    code: 'AIFX_TEMPORAL_CONFORM_EXPLICIT_ANCHOR_DUPLICATE',
    details: { globalIndex: 0 },
  },
})
assert.equal(targetedOnsetRetry.shouldRetry, true)
assert.equal(targetedOnsetRetry.targetedRole, 'onset')
assert.deepEqual([...targetedOnsetRetry.retainedRoles], ['peak'])
const targetedPeakRetry = workflow.evaluateRetry(retainedRolePolicy, {
  attempt: 1,
  error: {
    code: 'AIFX_TEMPORAL_CONFORM_ANCHOR_BOUNDARY_CLIPPED',
    details: { globalIndex: 2 },
  },
})
assert.equal(targetedPeakRetry.targetedRole, 'peak')
assert.equal(targetedPeakRetry.shouldRetry, false, 'a specifically invalid peak must fail closed instead of reusing it')
assert.equal(workflow.evaluateRetry(retainedRolePolicy, {
  attempt: 1,
  error: { code: 'AIFX_UNKNOWN_FAILURE' },
}).shouldRetry, false)
assert.equal(workflow.evaluateRetry(retainedRolePolicy, {
  attempt: 3,
  error: { code: 'AIFX_SEQUENCE_TEMPLATE_DIVERGED' },
}).shouldRetry, false)
assert.equal(workflow.shouldApplyIsolatedCoreCleanup('peak'), true)
assert.equal(workflow.shouldApplyIsolatedCoreCleanup('decay'), true)
assert.equal(workflow.shouldApplyIsolatedCoreCleanup('breakup'), false)
assert.equal(workflow.shouldApplyIsolatedCoreCleanup('dissipation'), false)
assert.equal(workflow.referenceModeForAnchor('peak'), 'full-material-morphology-reference')
assert.equal(workflow.referenceModeForAnchor('onset'), 'generated-peak-material-token')
assert.equal(workflow.referenceModeForAnchor('decay'), 'generated-peak-material-token')
assert.equal(workflow.referenceModeForAnchor('breakup'), 'generated-peak-material-token')
assert.equal(workflow.referenceModeForAnchor('dissipation'), 'generated-peak-material-token')
assert.equal(workflow.modelStyleStrengthForAnchor('peak', 86), 0.86)
assert.equal(workflow.modelStyleStrengthForAnchor('decay', 86), 0.39)
assert.equal(workflow.modelStyleStrengthForAnchor('breakup', 22), 0.22)
assert.deepEqual(
  { ...workflow.controlProfileForAnchor('peak', { strength: 0.69, endPercent: 0.78 }) },
  { strength: 0.9, endPercent: 0.98, role: 'peak', attempt: 1, mode: 'motion-control-after-early-material-reference' },
)
assert.deepEqual(
  { ...workflow.controlProfileForAnchor('dissipation', { strength: 0.69, endPercent: 0.78 }) },
  { strength: 0.62, endPercent: 0.52, role: 'dissipation', attempt: 1, mode: 'annealed-motion-envelope-with-text-owned-tail-topology' },
)
assert.deepEqual(
  { ...workflow.controlProfileForAnchor('decay', { strength: 0.69, endPercent: 0.78 }) },
  { strength: 0.96, endPercent: 1, role: 'decay', attempt: 1, mode: 'motion-control-with-semantic-peak-material-identity' },
)
assert.deepEqual(
  [1, 2, 3].map((attempt) => ({ ...workflow.controlProfileForAnchor('breakup', { strength: 0.72, endPercent: 0.8 }, attempt) })),
  [
    { strength: 0.82, endPercent: 0.82, role: 'breakup', attempt: 1, mode: 'annealed-motion-envelope-with-text-owned-tail-topology' },
    { strength: 0.76, endPercent: 0.76, role: 'breakup', attempt: 2, mode: 'annealed-motion-envelope-with-text-owned-tail-topology' },
    { strength: 0.7, endPercent: 0.7, role: 'breakup', attempt: 3, mode: 'annealed-motion-envelope-with-text-owned-tail-topology' },
  ],
)
assert.deepEqual(
  [1, 2, 3].map((attempt) => ({ ...workflow.controlProfileForAnchor('dissipation', { strength: 0.72, endPercent: 0.8 }, attempt) })),
  [
    { strength: 0.62, endPercent: 0.52, role: 'dissipation', attempt: 1, mode: 'annealed-motion-envelope-with-text-owned-tail-topology' },
    { strength: 0.56, endPercent: 0.46, role: 'dissipation', attempt: 2, mode: 'annealed-motion-envelope-with-text-owned-tail-topology' },
    { strength: 0.5, endPercent: 0.4, role: 'dissipation', attempt: 3, mode: 'annealed-motion-envelope-with-text-owned-tail-topology' },
  ],
)
const isolatedAnchor = workflow.evaluateAnchorIsolation({
  activeRatio: 0.22,
  borderActiveRatio: 0.08,
  borderMeanLuma: 0.02,
  cornerMeanLuma: 0.01,
}, 'peak')
assert.equal(isolatedAnchor.passed, true)
const sceneLikeAnchor = workflow.evaluateAnchorIsolation({
  activeRatio: 0.78,
  borderActiveRatio: 0.72,
  borderMeanLuma: 0.31,
  cornerMeanLuma: 0.24,
}, 'breakup')
assert.equal(sceneLikeAnchor.passed, false)
assert.equal(sceneLikeAnchor.code, 'AIFX_ANCHOR_NOT_ISOLATED')
const dimBlueFullCanvasAnchor = workflow.evaluateAnchorIsolation({
  activeRatio: 0.8894,
  borderActiveRatio: 0.6787,
  borderMeanLuma: 0.1154,
  cornerMeanLuma: 0.0664,
}, 'breakup')
assert.equal(dimBlueFullCanvasAnchor.passed, false)
assert.equal(
  Array.from(dimBlueFullCanvasAnchor.failures, (failure) => failure.key).sort().join(','),
  'activeRatio,borderActiveRatio,borderMeanLuma,cornerMeanLuma',
)

const peakGuidePlan = workflow.createReadableGuidePlan({
  role: 'peak',
  width: 752,
  height: 384,
  bounds: { x: 100, y: 80, width: 500, height: 210 },
  lumaP90: 210,
})
assert.equal(peakGuidePlan.scale, 0.72)
assert.equal(peakGuidePlan.readabilityApplied, false)
assert.equal(peakGuidePlan.templatePixelsUsed, false)
const tailGuidePlan = workflow.createReadableGuidePlan({
  role: 'dissipation',
  width: 752,
  height: 384,
  bounds: { x: 230, y: 200, width: 95, height: 55 },
  lumaP90: 14,
})
assert.ok(tailGuidePlan.scale > peakGuidePlan.scale, 'a tiny tail guide must be uniformly magnified for model readability')
assert.ok(tailGuidePlan.lumaGain > 1, 'a near-black tail guide must receive input-only contrast normalization')
assert.equal(tailGuidePlan.readabilityApplied, true)
assert.equal(tailGuidePlan.inputOnly, true)
assert.equal(tailGuidePlan.finalOutputTransform, 'sequence-plan-uniform-affine')
assert.equal(tailGuidePlan.templatePixelsUsed, false)
const twoLumaTailGuidePlan = workflow.createReadableGuidePlan({
  role: 'dissipation',
  width: 752,
  height: 384,
  bounds: { x: 230, y: 200, width: 95, height: 55 },
  lumaP90: 2,
})
assert.equal(twoLumaTailGuidePlan.visible, true)
assert.equal(twoLumaTailGuidePlan.lumaGain, 98)
assert.equal(twoLumaTailGuidePlan.readabilityApplied, true)
assert.equal(twoLumaTailGuidePlan.templatePixelsUsed, false)

const peakFrame = {
  name: 'frame_002.png',
  dataUrl: 'data:image/png;base64,AA==',
  width: 64,
  height: 64,
  anchorRole: 'peak',
}
const completedRuns = [{ spec: plan.anchors[0], runtimeFrame: peakFrame }]

const promptCalls = []
const promptWorkflow = {
  compileLocalAnchor(options) {
    promptCalls.push(options)
    return Object.freeze({ kind: 'aifx-local-anchor-prompt', ...options })
  },
}
const compiledPeakPrompt = workflow.compileAnchorPrompt(plan, plan.anchors[0], {
  provider: 'local',
  completedRuns: [],
  styleStrength: 86,
  materialPrompt: 'branching lightning',
  promptSupplement: 'cyan ember breakup',
}, promptWorkflow)
workflow.compileAnchorPrompt(plan, plan.anchors[1], {
  provider: 'local',
  completedRuns,
  styleStrength: 86,
  materialPrompt: 'branching lightning',
  promptSupplement: 'cyan ember breakup',
}, promptWorkflow)
assert.equal(promptCalls[0].anchorRole, 'peak')
assert.equal(promptCalls[0].hasIdentityReference, false)
assert.equal(promptCalls[1].anchorRole, 'onset')
assert.equal(promptCalls[1].hasIdentityReference, false)
assert.equal(promptCalls[1].materialType, 'lightning')
assert.equal(promptCalls[0].promptSupplement, 'cyan ember breakup')
assert.equal(promptCalls[1].promptSupplement, 'cyan ember breakup')
assert.equal(compiledPeakPrompt.referenceMode, 'full-material-morphology-reference')
assert.equal(compiledPeakPrompt.modelStyleStrength, 0.86)

const anchorRuns = plan.anchors.map((spec) => ({
  spec,
  runtimeFrame: {
    name: `frame_${String(spec.globalIndex).padStart(3, '0')}.png`,
    dataUrl: 'data:image/png;base64,AA==',
    width: 64,
    height: 64,
    anchorRole: spec.role,
  },
}))
let conformInput = null
const temporalCorrection = Object.freeze({ schemaVersion: 'fixture-temporal-v1', anchors: [] })
const result = await workflow.reconstruct({ plan, anchorRuns, attempt: 2 }, {
  temporalConform: {
    async conformFrames(input) {
      conformInput = input
      return {
        status: 'ready',
        frames: anchorRuns.map((entry, index) => ({ ...entry.runtimeFrame, index })),
        temporalCorrection,
        templatePixelsUsed: false,
        templateMaskUsed: false,
        shapeSource: 'ai-generated-frame-matte',
        motionConstraint: 'template-plan-only',
      }
    },
  },
})

assert.equal(conformInput.trigger, 'anchor-sequence-generation')
assert.equal(conformInput.attempt, 2)
assert.equal(conformInput.frames.length, 4)
assert.equal(conformInput.sequencePlan.length, 9)
assert.equal(conformInput.options.directionAlignmentEnabled, true)
assert.equal(conformInput.options.anchorCompatibilityMinimum, 0.08)
assert.equal(result.pipeline, workflow.pipeline)
assert.equal(result.finalShapeAuthority, 'ai-anchor-geometry')
assert.equal(result.templatePixelsUsed, false)
assert.equal(result.templateMaskUsed, false)
assert.equal(result.referenceContract.fullReferenceImageSent, true)
assert.equal(result.silentTemplateFallbackAllowed, false)
assert.equal(result.motionConstraint, 'template-center-occupancy-direction-lifecycle-envelope')
assert.equal(result.temporalCorrection, temporalCorrection)
assert.deepEqual([...result.tailAnchorRoles], ['breakup', 'dissipation'])

await assert.rejects(
  () => workflow.reconstruct({ plan, anchorRuns, attempt: 2 }, {
    temporalConform: {
      async conformFrames() {
        return {
          status: 'ready',
          frames: anchorRuns.map((entry, index) => ({ ...entry.runtimeFrame, index })),
          temporalCorrection,
          templatePixelsUsed: false,
          templateMaskUsed: true,
        }
      },
    },
  }),
  (error) => error?.code === 'AIFX_MORPHOLOGY_OUTPUT_INVALID',
)

assert.throws(
  () => workflow.createPlan({ sequencePlan, anchorSpecs: anchorSpecs.slice(0, 1), materialType: 'fire', reference }),
  (error) => error.code === 'AIFX_MORPHOLOGY_ANCHOR_INVALID',
)
const twoAnchorPlan = workflow.createPlan({
  sequencePlan,
  anchorSpecs: [anchorSpecs[0], anchorSpecs[3]],
  materialType: 'fire',
  reference,
})
assert.deepEqual(Array.from(twoAnchorPlan.anchors, (entry) => entry.role), ['peak', 'dissipation'])

console.log('aifx-material-reconstruct-contract: PASS')
