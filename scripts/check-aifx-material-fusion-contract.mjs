import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')
const runtimeSource = read('particle-editor/aifx-repaint-runtime.js')
const promptSource = read('particle-editor/aifx-prompt.workflow.js')
const materialReconstructSource = read('particle-editor/aifx-material-reconstruct.workflow.js')
const materializeSource = read('particle-editor/aifx-template-materialize.workflow.js')
const exportSource = read('particle-editor/aifx-export.workflow.js')

const sourceBlock = (source, startMarker, endMarker, label) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `${label} source block must remain discoverable`)
  return source.slice(start, end)
}

const selectorSource = sourceBlock(
  materialReconstructSource,
  'function plannedPeakIndexFor',
  '\n  function createRetryPolicy',
  'material morphology anchor selector',
)
const guideSource = sourceBlock(
  materialReconstructSource,
  'async function prepareAnchorGuide',
  '\n  function normalizeReference',
  'single material-source guide',
)
const anchorPipeline = sourceBlock(
  materialReconstructSource,
  'async function runAnchorPipeline',
  '\n  function buildPipelineResult',
  'material morphology anchor pipeline',
)
const resultContract = sourceBlock(
  materialReconstructSource,
  'function buildPipelineResult',
  '\n  async function reconstruct',
  'material morphology result contract',
)
const materializeBridge = sourceBlock(
  runtimeSource,
  'const materializeAifxTemplateSequence',
  '\n  const prepareAifxTemplateSheet',
  'template materialization bridge',
)
const productionBridge = sourceBlock(
  runtimeSource,
  'const runAifxProductionPipeline',
  '\n  const runAifxSpritesheetConditionedRegenPipelineSequence',
  'Local production pipeline',
)

// The model-facing Local path prefers four real AI morphology anchors, with a 2-3 anchor fallback.
for (const role of ['peak', 'onset', 'breakup', 'dissipation']) assert.match(selectorSource, new RegExp(`role: '${role}'`))
assert.match(materialReconstructSource, /function plannedPeakIndexFor\(sequencePlan\)[\s\S]*?phasePeakIndex >= 0/)
assert.match(selectorSource, /const peakIndex = plannedPeakIndexFor\(sequencePlan\)/)
assert.match(selectorSource, /const prePeakSpan = onsetIndex >= 0 \? peakIndex - onsetIndex : 0/)
assert.match(selectorSource, /const postPeakBodySpan = breakupCandidate\.index - peakIndex/)
assert.match(selectorSource, /entry\.phase === 'follow-through' \|\| entry\.phase === 'decay'/)
assert.match(selectorSource, /const preferOnsetBodyAnchor = onsetIndex >= 0[\s\S]*?prePeakSpan >= postPeakBodySpan/)
assert.match(selectorSource, /const bodyAnchor = preferOnsetBodyAnchor[\s\S]*?role: 'decay'/)
assert.match(guideSource, /createSpriteSheetPlan\(\[localGuideFrame\], \{/)
assert.match(guideSource, /columns: 1,/)
assert.match(guideSource, /lifecycle: \{ mode: 'one-shot', startFrame: 0, endFrame: 0, peakFrame: 0 \}/)
assert.match(anchorPipeline, /const anchorSpecs = selectAnchorSpecs\(sequencePlan\)/)
assert.match(anchorPipeline, /const morphologyPlan = createPlan\(\{/)
assert.match(anchorPipeline, /const modelAnchorSpecs = morphologyPlan\.anchors/)
assert.match(anchorPipeline, /const retryPolicy = createRetryPolicy\(morphologyPlan, \{/)
assert.match(anchorPipeline, /const sequenceSeed = sequenceSeedForAttempt\(retryPolicy, anchorAttempt\)/)
assert.match(anchorPipeline, /const retryDecision = evaluateRetry\(retryPolicy, \{/)
assert.match(anchorPipeline, /retryDecision\.retainedRoles\.includes\(entry\.spec\.role\)/)
assert.match(anchorPipeline, /attemptPromptIds\.push\(candidate\.promptId\)/)
assert.match(anchorPipeline, /promptIds: Object\.freeze\(\[\.\.\.attemptPromptIds\]\)/)
assert.doesNotMatch(runtimeSource, /plannedAifxPeakIndexFor|selectAifxAnchorFrames|retryableAnchorCodes|tailOnlyRetry/)
assert.equal(
  (anchorPipeline.match(/generateWorkflow\.run\(\{/g) || []).length,
  1,
  'the formal source must contain one shared model invocation site for all phase anchors',
)
assert.match(anchorPipeline, /const anchorPrompt = compileAnchorPrompt\(/)
assert.doesNotMatch(anchorPipeline, /identityReferenceFor\(/)
assert.doesNotMatch(anchorPipeline, /identityReference:/)
assert.match(anchorPipeline, /outputPrefix: `NovaFlow_VFX_Local_\$\{now\(\)\}_\$\{anchorSpec\.role\}_morphology`/)
assert.match(anchorPipeline, /postprocessed\.frames\.length !== 1/)
assert.match(anchorPipeline, /const peakRun = attemptRuns\.find\(\(entry\) => entry\.spec\.role === 'peak'\)/)
assert.match(materialReconstructSource, /function shouldApplyIsolatedCoreCleanup\(role\)[\s\S]*?normalizedRole !== 'breakup' && normalizedRole !== 'dissipation'/)
assert.match(anchorPipeline, /refineGeneratedAnchorTopology\(decodedRuntimeFrame, \{[\s\S]*?role: anchorSpec\.role,[\s\S]*?materialType,[\s\S]*?\}, \{ createCanvas \}\)/)
assert.match(anchorPipeline, /shouldApplyIsolatedCoreCleanup\(anchorSpec\.role\)[\s\S]*?removeIsolatedCoreObjects\(topologyRefined\.frame, materialType\)/)
assert.match(materialReconstructSource, /source: 'ai-generated-anchor-pixels'[\s\S]*?templatePixelsUsed: false,[\s\S]*?templateMaskUsed: false/)
assert.doesNotMatch(anchorPipeline, /prompt:\s*compiled\.prompt/, 'the legacy sequence-sheet prompt must not be sent to the model')
assert.match(materialReconstructSource, /directionAlignmentEnabled: true/)
assert.match(promptSource, /Every visible mark belongs to the \$\{materialType\} material/)
assert.match(promptSource, /Image1 is one compact material microtexture token extracted from the accepted peak after its macro silhouette was removed/)
assert.doesNotMatch(promptSource, /Image1 is a sparse aperiodic black-canvas material-vocabulary field derived from the complete reference/)
assert.match(promptSource, /positiveWhitelistOnly: true/)
assert.match(promptSource, /const POSITIVE_ENTITY_NOISE =/)
assert.match(runtimeSource, /lightning: Object\.freeze\(\{ strength: 0\.72, endPercent: 0\.8 \}\)/)
assert.doesNotMatch(
  materialReconstructSource,
  /qualityThresholds|applyTopologyBreakup|randomAlpha|Math\.random|crypto\.getRandomValues/,
  'material reconstruction must use strict shared quality and real AI tail anchors, not threshold or alpha-mask tricks',
)

// The old materializer remains available only as a recoverable legacy module.
assert.match(materializeBridge, /templateFrames: snapshot\.templateFrames,/)
assert.match(materializeBridge, /materialFrame: peakFrame,/)
assert.match(materializeBridge, /shapeSource: 'template-frame-structure-materialization'/)
assert.match(materializeBridge, /motionConstraint: 'template-frame-structure-grammar'/)
assert.doesNotMatch(anchorPipeline, /materializeAifxTemplateSequence\(/, 'formal production must not rebuild final geometry from template pixels')
assert.doesNotMatch(anchorPipeline, /templateMaterialize|NovaFlowAifxTemplateMaterializeWorkflow/, 'formal production must not access the legacy template materializer')
assert.doesNotMatch(anchorPipeline, /renderLockedMaterialTransfer\(|enforceAifxTemplateAlpha\(/, 'formal production must not re-enter mask-locked rendering')
assert.match(anchorPipeline, /const attemptConformed = await reconstruct\(\{/)
assert.match(anchorPipeline, /generatedFrames: attemptConformed\.frames,/)
assert.match(anchorPipeline, /const temporalCorrection = conformed\.temporalCorrection/)
assert.match(anchorPipeline, /const structureTransfer = null/)
assert.match(anchorPipeline, /shapeSource: conformed\.shapeSource/)
assert.match(resultContract, /pipeline: 'aifx-production-material-morphology-v2'/)
assert.match(resultContract, /seedStrategy: run\.retryPolicy\.seedStrategy/)
assert.match(resultContract, /identityStrategy: morphologyPlan\.identityConditioning/)
assert.match(resultContract, /modelProducesFullSequence: false/)
assert.match(resultContract, /sequenceSynthesizer: 'material-morphology-anchor-conform'/)
assert.match(resultContract, /phaseAnchorsDerivedFromPeak: false/)
assert.match(resultContract, /phaseAnchorsIdentityConditionedByPeak: run\.controlGuidance\.source\.includes\('macro-free-peak-material-token'\)/)
assert.match(anchorPipeline, /entry\.candidate\.peakMaterialTokenConditioning === true[\s\S]*?entry\.candidate\.visualReferenceConnected === true[\s\S]*?entry\.candidate\.visualReferenceEffective === true[\s\S]*?Number\(entry\.candidate\.visualReferenceEndPercent\) > 0/)
assert.match(resultContract, /perTemplateFrameStructureUsed: false/)
assert.match(resultContract, /intermediateDirectionTransformApplied: true/)
assert.match(resultContract, /tailTopologyEvolutionApplied:/)
assert.match(resultContract, /fullMaterialReferenceImageSent: true/)
assert.match(resultContract, /templatePixelsUsed: false/)
assert.match(resultContract, /silentTemplateFallbackAllowed: false/)
assert.match(resultContract, /frameCount: runtimeFrames\.length/)
assert.match(resultContract, /promptIds: Object\.freeze\(anchorRuns\.map\(\(entry\) => entry\.candidate\.promptId\)\)/)
assert.match(
  anchorPipeline,
  /const attemptSequenceQuality = qualityWorkflow\.evaluate\(\{\s*templateFrames,\s*generatedFrames: attemptConformed\.frames,\s*\}\)/,
  'the strict shared quality gate must receive no workflow-specific threshold override',
)
assert.doesNotMatch(anchorPipeline, /qualityThresholds|thresholds\s*:/)

assert.match(productionBridge, /window\.__AIFX_LAST_TEMPORAL_CORRECTION__ = temporalCorrection/)
assert.match(productionBridge, /window\.__AIFX_LAST_TEMPLATE_MATERIALIZATION__ = null/)
assert.match(productionBridge, /modules\.materialReconstruct\.runAnchorPipeline\(\{/)
assert.match(productionBridge, /modules\.materialReconstruct\.buildPipelineResult\(morphology, \{/)
assert.doesNotMatch(productionBridge, /generateWorkflow\.run|postprocessGeneratedSheet|createRetryPolicy|evaluateRetry/, 'Runtime must only dispatch the morphology workflow')
assert.doesNotMatch(anchorPipeline, /derivedPromptId|fakePromptId|syntheticPromptId/i, 'prompt traceability must contain only real model prompt ids')
assert.match(exportSource, /temporalCorrection and structureTransfer are mutually exclusive sequence synthesis modes/)

const promptModule = { exports: {} }
vm.runInNewContext(
  promptSource,
  { module: promptModule, exports: promptModule.exports, globalThis: {} },
  { filename: 'aifx-prompt.workflow.js' },
)
const compiledPeak = promptModule.exports.compileLocalAnchor({
  provider: 'local',
  anchorRole: 'peak',
  anchorFrame: { globalIndex: 4, phase: 'peak', energy: 1, occupancy: 0.32 },
  styleStrength: 86,
  materialType: 'fire',
  materialPrompt: 'red-orange flame material with ember breakup',
})
assert.equal(compiledPeak.kind, 'aifx-local-anchor-prompt')
assert.equal(compiledPeak.anchorRole, 'peak')
assert.equal(compiledPeak.hasIdentityReference, false)
assert.equal(compiledPeak.imageRoles.image2, 'full-material-morphology-reference')
assert.match(compiledPeak.stylePrompt, /Image1 is the complete material-morphology reference\./)
assert.match(
  compiledPeak.structurePrompt,
  /Use ControlNet for centroid, principal direction, coarse motion trajectory, turning direction, approximate outer extent, and safe margin/,
)
const compiledDecay = promptModule.exports.compileLocalAnchor({
  provider: 'local',
  anchorRole: 'decay',
  anchorFrame: { globalIndex: 7, phase: 'decay', energy: 0.28, occupancy: 0.12 },
  referenceMode: 'generated-peak-material-token',
  styleStrength: 86,
  materialType: 'fire',
})
assert.equal(compiledDecay.hasIdentityReference, false)
const compiledBreakup = promptModule.exports.compileLocalAnchor({
  provider: 'local',
  anchorRole: 'breakup',
  anchorFrame: { globalIndex: 7, phase: 'breakup', energy: 0.1, occupancy: 0.07 },
  referenceMode: 'generated-peak-material-token',
  styleStrength: 86,
  materialType: 'fire',
})
assert.equal(compiledBreakup.hasIdentityReference, false)
assert.match(compiledBreakup.prompt, /Render one breakup state, not several complete effects/)
assert.match(compiledBreakup.prompt, /one loose asymmetrical trail of clipped mid-branch filaments/)
const compiledDissipation = promptModule.exports.compileLocalAnchor({
  provider: 'local',
  anchorRole: 'dissipation',
  anchorFrame: { globalIndex: 8, phase: 'dissipation', energy: 0.04, occupancy: 0.02 },
  referenceMode: 'generated-peak-material-token',
  styleStrength: 86,
  materialType: 'fire',
})
assert.equal(compiledDissipation.hasIdentityReference, false)
assert.match(compiledDissipation.prompt, /almost-empty black canvas/)
assert.match(compiledDissipation.prompt, /Keep the motion-anchor region empty black/)
for (const compiledTail of [compiledDecay, compiledBreakup, compiledDissipation]) {
  assert.equal(compiledTail.referenceMode, 'generated-peak-material-token')
  assert.equal(compiledTail.imageRoles.image2, 'generated-peak-material-token')
  assert.equal(Object.hasOwn(compiledTail.imageRoles, 'image3'), false)
}
assert.throws(
  () => promptModule.exports.compileLocalAnchor({ provider: 'gpt', anchorRole: 'peak', anchorFrame: { globalIndex: 0, phase: 'peak' } }),
  /only supports the local provider/,
)

const materializeModule = { exports: {} }
vm.runInNewContext(
  materializeSource,
  {
    module: materializeModule,
    exports: materializeModule.exports,
    globalThis: {},
    Uint8ClampedArray,
    Float32Array,
    Int32Array,
  },
  { filename: 'aifx-template-materialize.workflow.js' },
)

const makeTemplateFrame = (index) => {
  const width = 32
  const height = 24
  const data = new Uint8ClampedArray(width * height * 4)
  const lifecycle = [0.38, 0.58, 0.78, 0.94, 1, 0.88, 0.7, 0.5, 0.3][index]
  const centerX = 6.5 + index * 2.1
  const centerY = 13 - index * 0.42
  const radiusX = 3.2 + lifecycle * 8.5
  const radiusY = 1.5 + lifecycle * 3.1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bend = Math.sin((x + index * 1.7) * 0.34) * (0.5 + lifecycle)
      const normalizedX = (x - centerX) / radiusX
      const normalizedY = (y - centerY - bend) / radiusY
      const distance = Math.hypot(normalizedX, normalizedY)
      if (distance > 1) continue
      const offset = (y * width + x) * 4
      const alpha = Math.round(255 * Math.min(1, (1 - distance) * 4.5))
      data[offset] = 210
      data[offset + 1] = 235
      data[offset + 2] = 255
      data[offset + 3] = alpha
    }
  }
  return { index, width, height, data }
}

const makeMaterialSource = () => {
  const width = 32
  const height = 24
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const wave = 12 + Math.sin(x * 0.43) * 3
      const distance = Math.abs(y - wave)
      if (distance > 7) continue
      const offset = (y * width + x) * 4
      const heat = 1 - distance / 7
      data[offset] = 210 + Math.round(45 * heat)
      data[offset + 1] = 28 + Math.round(170 * heat)
      data[offset + 2] = Math.round(28 * heat)
      data[offset + 3] = Math.round(255 * Math.min(1, heat * 1.8))
    }
  }
  return { width, height, data }
}

const templateFrames = Array.from({ length: 9 }, (_, index) => makeTemplateFrame(index))
const materialFrame = makeMaterialSource()
const materialized = materializeModule.exports.materialize({
  templateFrames,
  materialFrame,
  materialType: 'fire',
  styleStrength: 0.86,
  contourVariation: 0.68,
  seed: 1729,
})

assert.equal(materialized.frameCount, 9, 'one material source plus nine template frames must produce exactly nine final frames')
assert.equal(materialized.frames.length, 9)
assert.equal(materialized.structure.sourceMode, 'per-template-frame-structure-materialization')
assert.equal(materialized.structure.frameCount, 9)
assert.equal(materialized.structure.materialType, 'fire')
assert.equal(materialized.structure.highFrequencyTopology, 'fire-specific')
assert.equal(materialized.structure.macroConstraint, 'soft-signed-distance-envelope')
assert.equal(materialized.structure.outerAreaBudget, 'template-alpha-area-ranked-material-topology')
assert.equal(materialized.structure.samePeakAffineReuse, false)
assert.equal(materialized.structure.uniformScaleOnly, false)
assert.equal(materialized.structure.frames.length, 9)
assert.deepEqual(
  Array.from(materialized.structure.frames, (frame) => frame.sourceFrameIndex),
  [0, 1, 2, 3, 4, 5, 6, 7, 8],
  'every output frame must trace to the corresponding chronological template frame',
)
assert.ok(
  new Set(Array.from(materialized.structure.frames, (frame) => frame.sourceOuterArea)).size > 1,
  'the fixture must prove that per-frame template lifecycle geometry is preserved',
)
assert.ok(materialized.frames.every((frame) => (
  frame.width === 32
  && frame.height === 24
  && frame.data.length === 32 * 24 * 4
)), 'all nine outputs must be complete RGBA frames')
assert.throws(
  () => materializeModule.exports.materialize({
    templateFrames,
    materialFrames: [materialFrame],
    materialType: 'fire',
  }),
  (error) => error?.code === 'AIFX_TEMPLATE_MATERIALIZE_INVALID_INPUT' && /materialFrame/.test(error.message),
  'the v4 materializer must reject an AI-generated fake material sequence input',
)

console.log('aifx-material-fusion-contract: PASS')
