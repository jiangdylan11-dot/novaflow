import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const resourcePath = 'particle-editor/aifx-provider.resource.js'
const toolPath = 'particle-editor/aifx-provider.tool.js'
const promptPath = 'particle-editor/aifx-prompt.workflow.js'

function loadUmdCommonJs(file, globalName, globals = {}) {
  const sandbox = {
    module: { exports: {} },
    console,
    ...globals,
  }
  runInNewContext(readFileSync(file, 'utf8'), sandbox, { filename: file })
  assert.equal(sandbox[globalName], sandbox.module.exports, `${file} must expose the same browser and CommonJS API`)
  return { api: sandbox.module.exports, sandbox }
}

const resourceLoad = loadUmdCommonJs(resourcePath, 'NovaFlowAifxProviderResource')
const resource = resourceLoad.api
const promptLoad = loadUmdCommonJs(promptPath, 'NovaFlowAifxPromptWorkflow', {
  NovaFlowAifxProviderResource: resource,
})
const promptWorkflow = promptLoad.api

function occurrenceCount(value, token) {
  return String(value).split(token).length - 1
}

assert.equal(resourceLoad.sandbox.NovaFlowAifxProviderResource, resource, 'resource must expose its browser global')
assert.equal(promptLoad.sandbox.NovaFlowAifxPromptWorkflow, promptWorkflow, 'prompt workflow must expose its browser global')
assert.equal(resource.version, 'aifx-provider-v1')
assert.equal(resource.AUTH_SURFACE, 'aifx')
assert.deepEqual(Array.from(resource.PROVIDER_OPTIONS, (entry) => entry.value), ['local', 'gpt', 'google'])
assert.equal(resource.capabilityFor('local').runnable, true)
assert.equal(resource.capabilityFor('local').status, 'available')
assert.equal(resource.capabilityFor('local').structurePolicy, 'layout-hard-motion-soft-silhouette-generative')
assert.equal(resource.capabilityFor('local').controlGuidance, 'neutral-grayscale-motion-guide')
assert.equal(resource.capabilityFor('gpt').runnable, false)
assert.equal(resource.capabilityFor('gpt').status, 'deferred')
assert.equal(resource.capabilityFor('google').runnable, false)
assert.equal(resource.capabilityFor('google').status, 'deferred')
assert.equal(resource.REFERENCE_ROLES.image1, 'template_sheet')
assert.equal(resource.REFERENCE_ROLES.image2, 'style_reference')

const stateA = resource.createState({ provider: 'local', styleStrength: 72 })
const stateB = resource.createState({ provider: 'gpt', styleStrength: 18 })
assert.notEqual(stateA, stateB, 'AIFX provider state must be instance-local')
assert.equal(stateA.provider, 'local')
assert.equal(stateB.provider, 'gpt')
resource.selectProvider(stateA, 'google')
assert.equal(stateA.provider, 'google')
assert.equal(stateB.provider, 'gpt', 'provider state must not leak between AIFX instances')
assert.throws(() => resource.assertRunnable('gpt'), (error) => error.code === 'AIFX_PROVIDER_DEFERRED')

const localStrength = resource.strengthContractFor('local', 72)
assert.equal(localStrength.mode, 'conditioning-mix')
assert.equal(localStrength.exact, false)
assert.equal(localStrength.verified, false)
assert.equal(localStrength.normalizedValue, 0.72)
assert.equal(localStrength.endpoints.minimum, 'structure_conditioning')
assert.equal(localStrength.endpoints.maximum, 'structure_plus_style_conditioning')
for (const [value, band] of [[0, 'weak'], [33, 'weak'], [34, 'balanced'], [66, 'balanced'], [67, 'strong'], [100, 'strong']]) {
  const contract = resource.strengthContractFor('gpt', value)
  assert.equal(contract.mode, 'prompt-band')
  assert.equal(contract.band, band)
  assert.equal(contract.exact, false)
}

const baseCompileOptions = {
  frameCount: 9,
  rows: 3,
  columns: 3,
  cellWidth: 256,
  cellHeight: 192,
  gutter: 32,
  canvasWidth: 848,
  canvasHeight: 672,
  padding: 8,
  trailingRight: 0,
  trailingBottom: 0,
  styleStrength: 72,
  materialPrompt: 'coherent blue-white lightning with branching plasma and a sharp luminous core',
  promptSupplement: 'AIFX_SENTINEL_CYAN_EMBER',
  styleDescription: 'cold electric arcs with restrained bloom',
}

const local = promptWorkflow.compile({ provider: 'local', ...baseCompileOptions })
const localAgain = promptWorkflow.compile({ provider: 'local', ...baseCompileOptions })
assert.deepEqual(local, localAgain, 'prompt compilation must be deterministic')
assert.equal(local.provider, 'local')
assert.equal(local.promptsPrecompiled, true)
assert.ok(local.structurePrompt)
assert.ok(local.stylePrompt)
assert.equal(local.prompt, `${local.structurePrompt}\n${local.stylePrompt}`)
const localModelFacingPrompts = `${local.structurePrompt}\n${local.stylePrompt}`
assert.equal(occurrenceCount(localModelFacingPrompts, 'CONTINUOUS SEQUENCE PLAN'), 1)
assert.equal(occurrenceCount(localModelFacingPrompts, 'MATERIAL-SPECIFIC OUTLINE EVOLUTION'), 1)
assert.equal(occurrenceCount(localModelFacingPrompts, 'AIFX_SENTINEL_CYAN_EMBER'), 1,
  'the user supplement must reach the local model exactly once')
assert.doesNotMatch(local.structurePrompt, /AIFX_SENTINEL_CYAN_EMBER/)
assert.match(local.stylePrompt, /AIFX_SENTINEL_CYAN_EMBER/)
assert.match(local.structurePrompt, /F1\u2192F9 CONTINUOUS SEQUENCE PLAN/)
assert.doesNotMatch(local.structurePrompt, /MATERIAL-SPECIFIC OUTLINE EVOLUTION/)
assert.match(local.stylePrompt, /MATERIAL-SPECIFIC OUTLINE EVOLUTION \(lightning\)/)
assert.doesNotMatch(local.stylePrompt, /CONTINUOUS SEQUENCE PLAN/)
assert.match(local.stylePrompt, /TEMPORAL MATERIAL ENVELOPE/)
assert.match(local.stylePrompt, /single strongest visual peak/)
assert.match(local.stylePrompt, /near-empty decay residues/)
assert.match(local.stylePrompt, /no poster background, no decorative spill/)
assert.equal(local.strength.mode, 'conditioning-mix')
assert.equal(local.strength.exact, false)
assert.equal(local.imageRoles.image1, 'template_sheet')
assert.equal(local.imageRoles.image2, 'style_reference')
assert.match(local.prompt, /image1 = template_sheet/)
assert.match(local.prompt, /image2 = style_reference/)
assert.match(local.prompt, /exactly 9 chronological animation frames/)
assert.match(local.prompt, /exactly 3 rows by 3 columns/)
assert.match(local.prompt, /row-major order: left-to-right, then top-to-bottom/)
assert.match(local.prompt, /ordered onset, growth, peak, follow-through, decay, breakup, and dissipation phases/)
assert.match(local.prompt, /fully isolated inside their own source cell/)
assert.match(local.prompt, /Every cell remains exactly 256 by 192 pixels/)
assert.match(local.prompt, /hard authority only for frame count, grid, frame order, and cell dimensions/)
assert.match(local.prompt, /Never copy image1 colors, subject identity, rendering, texture, or pixel-for-pixel silhouette/)
assert.match(local.prompt, /F1\u2192F9 CONTINUOUS SEQUENCE PLAN/)
assert.match(local.prompt, /F1: phase=onset/)
assert.match(local.prompt, /F5: phase=peak/)
assert.match(local.prompt, /F9: phase=decay/)
assert.match(local.prompt, /MATERIAL-SPECIFIC OUTLINE EVOLUTION \(lightning\)/)
assert.match(local.prompt, /sharp forks, re-branches, gaps, and short plasma offshoots/)
assert.match(local.prompt, /never as independent illustrations, gallery items, or design variants/)
assert.doesNotMatch(local.prompt, /silhouette envelope/)
assert.doesNotMatch(local.prompt, /occupied-area envelope/)
assert.doesNotMatch(local.prompt, /output canvas remains exactly/)
assert.doesNotMatch(local.prompt, /32-pixel gutter/)
assert.equal(local.geometry.canvasWidth, 848, 'legacy geometry metadata remains available without becoming a template hard lock')
assert.equal(local.geometry.gutter, 32)
assert.equal(local.sequencePlan.length, 9)
assert.equal(local.sequencePlan[0].phase, 'onset')
assert.equal(local.sequencePlan[4].phase, 'peak')
assert.equal(local.sequencePlan[8].phase, 'decay')
assert.equal(local.materialType, 'lightning')
assert.match(local.negativePrompt, /cross-cell contamination/)
assert.match(local.negativePrompt, /broken motion lifecycle/)
assert.match(local.negativePrompt, /gallery/)
assert.match(local.negativePrompt, /pixel-for-pixel template silhouette/)
assert.equal(local.systemPrompt, '')

const gpt = promptWorkflow.compile({ provider: 'gpt', ...baseCompileOptions })
assert.equal(gpt.strength.mode, 'prompt-band')
assert.equal(gpt.strength.band, 'strong')
assert.equal(gpt.negativePrompt, '', 'GPT must not receive a separate negative prompt')
assert.equal(gpt.systemPrompt, '')
assert.match(gpt.prompt, /HARD PROHIBITIONS:/)
assert.match(gpt.prompt, /do not add, remove, duplicate, merge, split, or reorder frames/)
assert.match(gpt.prompt, /do not copy image1 colors, subject identity, rendering, texture, or pixel-for-pixel silhouette/)
assert.match(gpt.prompt, /contact-sheet variants/)
assert.match(gpt.prompt, /Style-strength instruction \(strong\)/)
assert.equal(occurrenceCount(gpt.prompt, 'AIFX_SENTINEL_CYAN_EMBER'), 1)

const google = promptWorkflow.compile({ provider: 'google', ...baseCompileOptions, styleStrength: 48 })
assert.equal(google.strength.mode, 'prompt-band')
assert.equal(google.strength.band, 'balanced')
assert.equal(google.negativePrompt, '')
assert.match(google.systemPrompt, /production VFX spritesheet editor/)
assert.match(google.systemPrompt, /image1 = template_sheet/)
assert.match(google.systemPrompt, /image2 = style_reference/)
assert.match(google.systemPrompt, /HARD PROHIBITIONS:/)
assert.match(google.systemPrompt, /sequence plan as soft motion guidance/)
assert.equal(occurrenceCount(`${google.systemPrompt}\n${google.prompt}`, 'AIFX_SENTINEL_CYAN_EMBER'), 1)
assert.match(google.prompt, /Style-strength instruction \(balanced\)/)

const explicitSequencePlan = [
  { index: 0, phase: 'onset', energy: 0.08, centerX: 0.2, centerY: 0.45, directionDeg: 370, occupancy: 0.1 },
  { index: 1, phase: 'growth', energy: 0.55, centerX: 0.38, centerY: 0.46, directionDeg: 18, occupancy: 0.48 },
  { index: 2, phase: 'peak', energy: 1, centerX: 0.61, centerY: 0.48, directionDeg: 24, occupancy: 0.92 },
  { index: 3, phase: 'decay', energy: 0.14, centerX: 0.78, centerY: 0.5, directionDeg: 31, occupancy: 0.22 },
]
const fire = promptWorkflow.compile({
  provider: 'local', frameCount: 4, rows: 2, columns: 2, cellWidth: 128, cellHeight: 128,
  materialPrompt: 'red-orange fire with ember breakup', sequencePlan: explicitSequencePlan,
})
assert.equal(fire.materialType, 'fire')
assert.equal(fire.sequencePlan[0].directionDeg, 10)
assert.equal(fire.sequencePlan[2].centerX, 0.61)
assert.match(fire.prompt, /F1\u2192F4 CONTINUOUS SEQUENCE PLAN/)
assert.match(fire.prompt, /asymmetric flame tongues/)

const ice = promptWorkflow.compile({
  provider: 'local', frameCount: 4, rows: 2, columns: 2,
  materialPrompt: 'translucent ice crystal and snow material',
})
assert.equal(ice.materialType, 'ice')
assert.match(ice.prompt, /incomplete faceted wedges and irregular shard spikes/)
const customStyleLightning = promptWorkflow.compile({
  provider: 'local', frameCount: 4, rows: 2, columns: 2,
  stylePrompt: 'blue-white lightning with short plasma offshoots',
})
assert.equal(customStyleLightning.materialType, 'lightning')
assert.match(customStyleLightning.prompt, /sharp forks, re-branches, gaps/)

const aliasSequencePlan = promptWorkflow.normalizeSequencePlan([
  { phase: 'start' },
  { phase: 'build' },
  { phase: 'climax' },
  { phase: 'followThrough' },
  { phase: 'fade_out' },
  { phase: 'break-up' },
  { phase: 'end' },
], 7)
assert.deepEqual(
  Array.from(aliasSequencePlan, (frame) => frame.phase),
  ['onset', 'growth', 'peak', 'follow-through', 'decay', 'breakup', 'dissipation'],
)
assert.throws(
  () => promptWorkflow.compile({
    provider: 'local', frameCount: 4, rows: 2, columns: 2,
    sequencePlan: [
      { index: 0, phase: 'onset' },
      { index: 1, phase: 'peak' },
      { index: 2, phase: 'growth' },
      { index: 3, phase: 'decay' },
    ],
  }),
  /progress continuously/,
)

const partialGrid = promptWorkflow.compile({
  provider: 'local', frameCount: 10, rows: 3, columns: 4, gutter: 16, styleStrength: 50,
})
assert.equal(partialGrid.geometry.unusedCells, 2)
assert.match(partialGrid.prompt, /final 2 unused grid cells must remain background-only/)
assert.throws(
  () => promptWorkflow.compile({ provider: 'local', frameCount: 10, rows: 3, columns: 3 }),
  /exceeds grid capacity/,
)
assert.throws(
  () => promptWorkflow.compile({ provider: 'local', frameCount: 9, rows: 3, columns: 3, cellWidth: 256 }),
  /cellWidth and cellHeight/,
)

const peakAnchorFrame = {
  globalIndex: 4,
  phase: 'peak',
  energy: 1,
  centerX: 0.58,
  centerY: 0.47,
  directionDeg: 22,
  occupancy: 0.86,
}
const materialSource = promptWorkflow.compileLocalMaterialSource({
  provider: 'local',
  sourceFrame: peakAnchorFrame,
  materialType: 'fire',
  materialPrompt: 'orange flame with a white-hot core and ember breakup',
  promptSupplement: 'AIFX_SENTINEL_CYAN_EMBER',
  styleDescription: 'painted game VFX with crisp hot edges',
  styleStrength: 72,
})
assert.equal(materialSource.kind, 'aifx-local-material-source-prompt')
assert.equal(materialSource.anchorRole, 'peak')
assert.equal(materialSource.sourceRole, 'material-source')
assert.equal(materialSource.modelProducesSequence, false)
assert.equal(materialSource.downstreamSequenceAuthority, 'template-frame-structure')
assert.equal(materialSource.imageRoles.image1, 'current_phase_motion_guide')
assert.equal(materialSource.imageRoles.image2, 'style_reference')
assert.equal('image3' in materialSource.imageRoles, false)
assert.match(materialSource.prompt, /composition-neutral VFX material source/i)
assert.match(materialSource.prompt, /not the final animation frame/i)
assert.match(materialSource.prompt, /silhouette must not be copied/i)
assert.match(materialSource.prompt, /final animation geometry will be rebuilt separately from every source template frame/i)
assert.match(materialSource.prompt, /one material source image, not a sprite sheet and not an animation claim/i)
assert.match(materialSource.stylePrompt, /reusable local vocabulary needed for downstream fire contour reconstruction/i)
assert.equal(occurrenceCount(`${materialSource.structurePrompt}\n${materialSource.stylePrompt}`, 'AIFX_SENTINEL_CYAN_EMBER'), 1)
assert.doesNotMatch(materialSource.structurePrompt, /AIFX_SENTINEL_CYAN_EMBER/)
assert.match(materialSource.negativePrompt, /template silhouette copy/i)
assert.throws(
  () => promptWorkflow.compileLocalMaterialSource({ provider: 'gpt', sourceFrame: peakAnchorFrame }),
  /only supports the local provider/i,
)
const peakAnchor = promptWorkflow.compileLocalAnchor({
  provider: 'local',
  anchorRole: 'peak',
  anchorFrame: peakAnchorFrame,
  materialPrompt: 'blue-white lightning with a sharp emissive core',
  promptSupplement: 'AIFX_SENTINEL_CYAN_EMBER',
  styleStrength: 72,
})
const forbiddenPositiveEntities = /\b(?:person|human|actor|caster|victim|observer|face|head|body|hand|skin|hair|clothing|limb|character|girl|boy|portrait|weapon|sword|blade|saber|knife|scythe|object|subject|scene|environment|background|grid|tile|panel|poster|collage|logo|attack|impact|spell-casting|slash)\b/i
assert.equal(peakAnchor.kind, 'aifx-local-anchor-prompt')
assert.equal(peakAnchor.anchorRole, 'peak')
assert.equal(peakAnchor.anchorFrame.globalIndex, 4)
assert.equal(peakAnchor.imageRoles.image1, 'current_phase_motion_guide')
assert.equal(peakAnchor.imageRoles.image2, 'full-material-morphology-reference')
assert.equal('image3' in peakAnchor.imageRoles, false)
assert.equal(peakAnchor.hasIdentityReference, false)
assert.equal(peakAnchor.positiveWhitelistOnly, true)
assert.equal(peakAnchor.visualConditioningPolicy, 'early-material-reference-late-motion-synthesis')
assert.match(peakAnchor.structurePrompt, /exactly one isolated nonfigurative lightning material state on a pure black canvas/i)
assert.match(peakAnchor.structurePrompt, /Every visible mark belongs to the lightning material/i)
assert.match(peakAnchor.structurePrompt, /Use ControlNet for centroid, principal direction, coarse motion trajectory, turning direction, approximate outer extent, and safe margin/i)
assert.match(peakAnchor.structurePrompt, /instead of pixel-tracing its stroke/i)
assert.match(peakAnchor.structurePrompt, /strongest readable peak state/i)
assert.match(peakAnchor.stylePrompt, /Image1 is the complete material-morphology reference/i)
assert.match(peakAnchor.stylePrompt, /palette hierarchy, core construction, local topology/i)
assert.match(peakAnchor.stylePrompt, /Do not reuse the complete reference pose, direction, composition, or macro layout/i)
assert.equal(occurrenceCount(`${peakAnchor.structurePrompt}\n${peakAnchor.stylePrompt}`, 'AIFX_SENTINEL_CYAN_EMBER'), 1)
assert.doesNotMatch(peakAnchor.structurePrompt, /AIFX_SENTINEL_CYAN_EMBER/)
assert.match(peakAnchor.stylePrompt, /AIFX_SENTINEL_CYAN_EMBER/)
assert.doesNotMatch(peakAnchor.structurePrompt, forbiddenPositiveEntities)
assert.doesNotMatch(peakAnchor.stylePrompt, forbiddenPositiveEntities)
assert.match(peakAnchor.negativePrompt, /person, human, face, head, body, hand, character/i)
assert.match(peakAnchor.negativePrompt, /actor, caster, victim, target person, observer, attack scene, impact scene, action scene/i)
assert.match(peakAnchor.negativePrompt, /weapon, sword, blade, saber, knife, scythe, metallic object, solid prop/i)
assert.match(peakAnchor.negativePrompt, /centered icon, badge, crest, mirrored wings, angel wings, butterfly shape, snowflake emblem/i)

const onsetAnchor = promptWorkflow.compileLocalAnchor({
  provider: 'local',
  anchorRole: 'onset',
  anchorFrame: { ...peakAnchorFrame, globalIndex: 0, phase: 'onset', energy: 0.1, occupancy: 0.12 },
  identityReference: true,
  materialPrompt: 'blue-white lightning',
})
assert.equal(onsetAnchor.hasIdentityReference, true)
assert.match(onsetAnchor.structurePrompt, /incomplete emerging onset/i)
assert.match(onsetAnchor.structurePrompt, /early material topology readable at reduced energy/i)
assert.match(onsetAnchor.stylePrompt, /Image2 supplies the shared peak material identity/i)
assert.equal(onsetAnchor.imageRoles.image3, 'peak_identity_reference')
assert.doesNotMatch(onsetAnchor.structurePrompt, forbiddenPositiveEntities)
assert.doesNotMatch(onsetAnchor.stylePrompt, forbiddenPositiveEntities)

const decayAnchor = promptWorkflow.compileLocalAnchor({
  provider: 'local',
  anchorRole: 'decay',
  anchorFrame: { ...peakAnchorFrame, globalIndex: 8, phase: 'decay', energy: 0.2, occupancy: 0.24 },
  identityReference: true,
  materialPrompt: 'blue-white lightning',
})
assert.match(decayAnchor.structurePrompt, /compact isolated decay state/i)
assert.match(decayAnchor.structurePrompt, /crisp broken material traces and separated particles/i)
assert.match(decayAnchor.negativePrompt, /featureless glow blob, soft blurry blob, amorphous color smear, fog-like gradient/i)
assert.doesNotMatch(decayAnchor.structurePrompt, forbiddenPositiveEntities)
assert.throws(
  () => promptWorkflow.compileLocalAnchor({
    provider: 'local', anchorRole: 'peak', anchorFrame: peakAnchorFrame, identityReference: true,
  }),
  /peak anchor must not receive an identity reference/i,
)
const sharedSeedDecayAnchor = promptWorkflow.compileLocalAnchor({
  provider: 'local',
  anchorRole: 'decay',
  anchorFrame: { ...peakAnchorFrame, globalIndex: 8, phase: 'decay', energy: 0.2, occupancy: 0.24 },
  materialPrompt: 'blue-white lightning',
})
assert.equal(sharedSeedDecayAnchor.hasIdentityReference, false)
assert.match(sharedSeedDecayAnchor.stylePrompt, /Preserve the shared sequence identity/i)
assert.equal('image3' in sharedSeedDecayAnchor.imageRoles, false)

const breakupAnchor = promptWorkflow.compileLocalAnchor({
  provider: 'local',
  anchorRole: 'breakup',
  anchorFrame: { ...peakAnchorFrame, globalIndex: 7, phase: 'breakup', energy: 0.12, occupancy: 0.04 },
  materialPrompt: 'orange fire with separated tongues and embers',
  referenceMode: 'generated-peak-material-token',
})
const dissipationAnchor = promptWorkflow.compileLocalAnchor({
  provider: 'local',
  anchorRole: 'dissipation',
  anchorFrame: { ...peakAnchorFrame, globalIndex: 8, phase: 'dissipation', energy: 0.04, occupancy: 0.01 },
  materialPrompt: 'orange fire with sparse fading embers',
  referenceMode: 'generated-peak-material-token',
  guideNormalization: {
    version: 'aifx-readable-guide-v1',
    inputOnly: true,
    readabilityApplied: true,
    scale: 2.4,
    lumaGain: 98,
    templatePixelsUsed: false,
    finalOutputTransform: 'sequence-plan-uniform-affine',
  },
})
assert.match(breakupAnchor.structurePrompt, /one loose asymmetrical trail of clipped mid-branch filaments/i)
assert.match(breakupAnchor.structurePrompt, /none may become a familiar zigzag icon, glyph, or miniature copy/i)
assert.match(dissipationAnchor.structurePrompt, /almost-empty black canvas/i)
assert.match(dissipationAnchor.structurePrompt, /Keep the motion-anchor region empty black/i)
assert.match(breakupAnchor.stylePrompt, /compact material microtexture token extracted from the accepted peak/i)
assert.match(breakupAnchor.stylePrompt, /motion guide, lifecycle role, occupancy and direction determine the complete newly reconstructed phase silhouette/i)
assert.equal(breakupAnchor.imageRoles.image2, 'generated-peak-material-token')
assert.equal(breakupAnchor.referenceMode, 'generated-peak-material-token')
assert.equal(breakupAnchor.visualConditioningPolicy, 'parallel-early-peak-material-token-tail-topology-synthesis')
assert.match(dissipationAnchor.structurePrompt, /temporary uniform magnification and contrast normalization/i)
assert.match(dissipationAnchor.structurePrompt, /downstream uniform affine transform/i)
assert.equal(dissipationAnchor.guideNormalization.templatePixelsUsed, false)
assert.doesNotMatch(breakupAnchor.structurePrompt, forbiddenPositiveEntities)
assert.doesNotMatch(breakupAnchor.stylePrompt, forbiddenPositiveEntities)
assert.doesNotMatch(dissipationAnchor.structurePrompt, forbiddenPositiveEntities)
assert.doesNotMatch(dissipationAnchor.stylePrompt, forbiddenPositiveEntities)
assert.doesNotMatch(breakupAnchor.negativePrompt, /multiple effects/i)
assert.doesNotMatch(dissipationAnchor.negativePrompt, /multiple effects/i)
assert.match(peakAnchor.negativePrompt, /multiple effects/i)

const lightningTailToken = promptWorkflow.compileLocalAnchor({
  provider: 'local',
  anchorRole: 'dissipation',
  anchorFrame: { ...peakAnchorFrame, globalIndex: 8, phase: 'dissipation', energy: 0.04, occupancy: 0.01 },
  materialType: 'lightning',
  materialPrompt: 'blue-white electrical core. Use the complete image2 reference to infer material-specific silhouette behavior. Recompose those local material rules around the supplied direction. The target remains recognizable through shape.',
  styleDescription: 'blue-white core, full material morphology reference, material-specific silhouette reconstruction, reference-derived local topology',
  referenceMode: 'generated-peak-material-token',
})
assert.match(lightningTailToken.structurePrompt, /almost-empty black canvas/i)
assert.match(lightningTailToken.structurePrompt, /Keep the motion-anchor region empty black/i)
assert.doesNotMatch(lightningTailToken.prompt, /complete image2 reference/i)
assert.doesNotMatch(lightningTailToken.prompt, /main bolt follows the motion path/i)
assert.doesNotMatch(lightningTailToken.prompt, /full material morphology reference|material-specific silhouette reconstruction|reference-derived local topology/i)
assert.match(lightningTailToken.stylePrompt, /deliberately shuffled microtexture swatch/i)
assert.match(lightningTailToken.stylePrompt, /Never repeat, enlarge, trace, or reproduce its swatch boundary/i)
assert.match(lightningTailToken.negativePrompt, /continuous main bolt/i)
assert.match(lightningTailToken.negativePrompt, /connected branch network/i)
assert.match(lightningTailToken.negativePrompt, /repeated lightning-bolt icons/i)
assert.match(lightningTailToken.negativePrompt, /radial burst/i)
assert.match(lightningTailToken.negativePrompt, /tiled texture/i)

const sanitizedAnchor = promptWorkflow.compileLocalAnchor({
  provider: 'local',
  anchorRole: 'decay',
  anchorFrame: { ...peakAnchorFrame, globalIndex: 8, phase: 'decay' },
  materialPrompt: 'lightning slash attack scene with person holding sword',
  promptSupplement: 'cyan person holding sword against poster background',
  styleDescription: 'poster grid character portrait',
})
assert.doesNotMatch(sanitizedAnchor.structurePrompt, forbiddenPositiveEntities)
assert.doesNotMatch(sanitizedAnchor.stylePrompt, forbiddenPositiveEntities)
assert.match(sanitizedAnchor.stylePrompt, /User material supplement[\s\S]*?cyan/i)

const explicitIceWithElectricStyle = promptWorkflow.compileLocalAnchor({
  provider: 'local',
  anchorRole: 'decay',
  anchorFrame: { ...peakAnchorFrame, globalIndex: 8, phase: 'decay', energy: 0.2, occupancy: 0.24 },
  materialType: 'ice',
  materialPrompt: 'crystalline ice with blue-white electric glow and plasma-like highlights',
  styleDescription: 'electric glow, energy, cool highlights',
})
assert.equal(explicitIceWithElectricStyle.materialType, 'ice')
assert.match(explicitIceWithElectricStyle.prompt, /Material-shape evolution: Grow one open asymmetric directional fracture flow/i)
assert.match(explicitIceWithElectricStyle.prompt, /open asymmetric directional fracture flow/)
assert.match(explicitIceWithElectricStyle.prompt, /incomplete faceted wedges and irregular shard spikes/)
assert.doesNotMatch(explicitIceWithElectricStyle.stylePrompt, /\b(?:badge|crest|logo)\b|mirrored wings|snowflake icon|complete emblem/i)
assert.doesNotMatch(explicitIceWithElectricStyle.prompt, /narrow electrical discharge/i)
assert.throws(
  () => promptWorkflow.compileLocalAnchor({
    provider: 'local', anchorRole: 'onset', anchorFrame: peakAnchorFrame, identityReference: true,
  }),
  /anchorFrame\.phase must match anchorRole onset/i,
)
assert.throws(
  () => promptWorkflow.compileLocalAnchor({ provider: 'local', anchorRole: 'growth', anchorFrame: peakAnchorFrame }),
  /anchorRole must be one of/i,
)

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase()
    this.ownerDocument = ownerDocument
    this.attributes = new Map()
    this.children = []
    this.listeners = new Map()
    this.value = ''
    this.textContent = ''
    this.disabled = false
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (name === 'disabled') this.disabled = true
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  removeAttribute(name) {
    this.attributes.delete(name)
    if (name === 'disabled') this.disabled = false
  }

  appendChild(child) {
    this.children.push(child)
    return child
  }

  replaceChildren(...children) {
    this.children = children
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener)
  }

  dispatch(type) {
    this.listeners.get(type)?.({ currentTarget: this })
  }
}

const fakeDocument = {
  createElement(tagName) {
    return new FakeElement(tagName, fakeDocument)
  },
}
const authCalls = []
const auth = {
  mount(surface, slot) { authCalls.push(['mount', surface, slot]) },
  unmount(surface) { authCalls.push(['unmount', surface]) },
}
const toolLoad = loadUmdCommonJs(toolPath, 'NovaFlowAifxProviderTool', {
  NovaFlowAifxProviderResource: resource,
  NovaFlowClientAuth: auth,
})
const tool = toolLoad.api
assert.equal(toolLoad.sandbox.NovaFlowAifxProviderTool, tool, 'provider tool must expose its browser global')

const host = new FakeElement('div', fakeDocument)
let changedProvider = ''
const handle = tool.mount({ host, provider: 'local', onProviderChange(provider) { changedProvider = provider } })
assert.equal(tool.ownsSelect(handle.select), true)
assert.equal(handle.select.getAttribute('data-novaflow-aifx-provider'), '1')
assert.equal(handle.accountSlot.getAttribute('data-novaflow-aifx-account-slot'), '1')
assert.equal(handle.select.children.length, 3)
assert.equal(handle.select.children[0].disabled, false)
assert.equal(handle.select.children[1].disabled, true)
assert.equal(handle.select.children[2].disabled, true)
assert.equal(handle.select.children[1].getAttribute('data-novaflow-aifx-provider-status'), 'deferred')
assert.equal(authCalls[0][0], 'mount')
assert.equal(authCalls[0][1], 'aifx', 'AIFX must use its own auth surface')
handle.select.value = 'gpt'
handle.select.dispatch('change')
assert.equal(changedProvider, '', 'deferred providers must not become runnable through the control')
assert.equal(handle.select.value, 'local')
handle.unmount()
assert.deepEqual(authCalls.at(-1), ['unmount', 'aifx'])

const resourceSource = readFileSync('particle-editor/aifx-provider.resource.js', 'utf8')
const toolSource = readFileSync('particle-editor/aifx-provider.tool.js', 'utf8')
const promptSource = readFileSync('particle-editor/aifx-prompt.workflow.js', 'utf8')
for (const source of [resourceSource, toolSource, promptSource]) {
  assert.doesNotMatch(source, /IPAdapter/i, 'new AIFX contracts must not reuse the retired IPAdapter strength formula')
}
assert.doesNotMatch(toolSource, /data-novaflow-art-generate/, 'AIFX provider DOM ownership must remain independent')
assert.doesNotMatch(toolSource, /mount\(['"]art-generate['"]/, 'AIFX must not mount the Art Generate auth surface')

console.log('aifx-provider-prompt-contract: PASS')
