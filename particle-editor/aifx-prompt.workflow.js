(function (root, factory) {
  const api = factory(root)
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAifxPromptWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict'

  const VERSION = 'aifx-spritesheet-prompt-v4'
  const IMAGE_ROLES = Object.freeze({
    image1: 'template_sheet',
    image2: 'style_reference',
  })
  const LOCAL_ANCHOR_IMAGE_ROLES = Object.freeze({
    image1: 'current_phase_motion_guide',
    image2: 'full_material_morphology_reference',
    image3: 'peak_identity_reference',
  })
  const LOCAL_ANCHOR_BASE_IMAGE_ROLES = Object.freeze({
    image1: LOCAL_ANCHOR_IMAGE_ROLES.image1,
    image2: LOCAL_ANCHOR_IMAGE_ROLES.image2,
  })
  const LOCAL_MATERIAL_SOURCE_IMAGE_ROLES = Object.freeze({
    image1: 'current_phase_motion_guide',
    image2: 'style_reference',
  })
  const LOCAL_ANCHOR_ROLES = Object.freeze(['peak', 'onset', 'decay', 'breakup', 'dissipation'])

  const SEQUENCE_PHASES = Object.freeze(['onset', 'growth', 'peak', 'follow-through', 'decay', 'breakup', 'dissipation'])
  const MATERIAL_SHAPE_EVOLUTION = Object.freeze({
    fire: 'Let the outer shape breathe as asymmetric flame tongues: edges lick outward, taper, split into embers, trail with the motion path, and contract into drifting sparks during decay.',
    lightning: 'Let the outer shape become a narrow electrical discharge: the main bolt follows the motion path while sharp forks, re-branches, gaps, and short plasma offshoots appear and vanish coherently.',
    ice: 'Grow one open asymmetric directional fracture flow: incomplete faceted wedges and irregular shard spikes expand from the motion anchor, fracture around the peak, then separate into angular chips and cold dust during decay.',
    poison: 'Rebuild the outer shape as viscous toxic matter: irregular blobs, holes, sticky tendrils, bubbles, drops, and splashes stretch along the motion path and separate during decay.',
    default: 'Regenerate a material-specific outer shape that expands, contracts, breaks up, and dissipates coherently around the supplied motion anchors instead of tracing the template pixels.',
  })
  const TAIL_MATERIAL_SHAPE_EVOLUTION = Object.freeze({
    lightning: Object.freeze({
      decay: 'Bend the electrical flow into one narrow asymmetric directional remnant with 2 to 4 unequal local forks and detached trailing sparks. Avoid a shared central hub, radial starburst, symmetric explosion, or edge-to-edge branch network.',
      breakup: 'Leave one loose asymmetrical trail of clipped mid-branch filaments. Every fragment must differ in length, bend, and branch count; negative gaps must be wider than the fragments, and no fragment may read as a familiar zigzag bolt icon, glyph, or miniature copy.',
      dissipation: 'Leave an almost-empty black canvas with only sparse short fading filaments and a few unequal dots, offset from one another along the motion axis. Keep the motion-anchor region empty black; no luminous node, common hub, central core, radial origin, complete symbol, or connected branch network may remain.',
    }),
  })

  const PROHIBITIONS = Object.freeze([
    'do not add, remove, duplicate, merge, split, or reorder frames',
    'do not change the row count, column count, frame-to-cell mapping, cell dimensions, or row-major order',
    'do not allow pixels, glow, particles, branches, trails, or connected shapes to cross a cell boundary or enter a gutter',
    'do not copy the composition, subject identity, pose, layout, text, logo, watermark, border, or background from image2',
    'do not copy image1 colors, subject identity, rendering, texture, or pixel-for-pixel silhouette',
    'do not turn the spritesheet into a gallery, material swatch board, contact-sheet variants, poster, collage, storyboard, UI, labeled contact sheet, or single-frame illustration',
    'do not freeze, shuffle, reverse, restart, or replace the chronological motion lifecycle from image1',
    'do not introduce camera movement, viewpoint changes, inconsistent scale, temporal flicker, or unrelated objects',
  ])

  const LOCAL_NEGATIVE_PROMPT = [
    'cross-cell contamination',
    'content in gutters',
    'merged cells',
    'connected shapes across cells',
    'changed grid',
    'changed cell size',
    'missing frame',
    'extra frame',
    'duplicate frame',
    'reordered frames',
    'static duplicate frames',
    'broken motion lifecycle',
    'temporal flicker',
    'camera movement',
    'perspective change',
    'poster',
    'collage',
    'gallery',
    'variant sheet',
    'independent design options',
    'storyboard labels',
    'contact sheet labels',
    'UI',
    'text',
    'logo',
    'watermark',
    'border',
    'copied style-reference subject',
    'copied template colors',
    'copied template subject',
    'pixel-for-pixel template silhouette',
    'identical silhouette across materials',
    'unrelated objects',
  ].join(', ')
  const LOCAL_ANCHOR_NEGATIVE_PROMPT = [
    'multiple effects',
    'multiple panels',
    'sprite sheet',
    'grid',
    'gallery',
    'contact sheet',
    'variant sheet',
    'border',
    'frame label',
    'text',
    'logo',
    'watermark',
    'poster',
    'collage',
    'scene',
    'environment',
    'decorative background',
    'person',
    'human',
    'face',
    'head',
    'body',
    'hand',
    'character',
    'girl',
    'boy',
    'portrait',
    'silhouette of a person',
    'actor',
    'caster',
    'victim',
    'target person',
    'observer',
    'attack scene',
    'impact scene',
    'action scene',
    'recognizable subject',
    'weapon',
    'sword',
    'blade',
    'saber',
    'knife',
    'scythe',
    'metallic object',
    'solid prop',
    'projectile object',
    'emblem object',
    'centered icon',
    'badge',
    'crest',
    'mirrored wings',
    'angel wings',
    'butterfly shape',
    'snowflake emblem',
    'bilaterally symmetric emblem',
    'radial emblem',
    'featureless glow blob',
    'soft blurry blob',
    'amorphous color smear',
    'fog-like gradient',
    'material detail lost',
    'content touching the image edge',
    'cropped effect',
    'cropped glow',
    'unrelated object',
  ].join(', ')

  function resourceApi() {
    return root && root.NovaFlowAifxProviderResource
  }

  function normalizeProvider(value) {
    const resource = resourceApi()
    if (typeof resource?.normalizeProvider === 'function') return resource.normalizeProvider(value)
    const provider = String(value || '').trim().toLowerCase()
    return provider === 'gpt' || provider === 'google' ? provider : 'local'
  }

  function normalizeStrength(value) {
    const resource = resourceApi()
    if (typeof resource?.normalizeStyleStrength === 'function') return resource.normalizeStyleStrength(value)
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 50
    return Math.max(0, Math.min(100, Math.round(parsed)))
  }

  function fallbackStrengthContract(provider, value) {
    const requestedPercent = normalizeStrength(value)
    if (provider === 'local') {
      return Object.freeze({
        mode: 'conditioning-mix',
        requestedPercent,
        normalizedValue: requestedPercent / 100,
        exact: false,
        verified: false,
      })
    }
    const band = requestedPercent <= 33 ? 'weak' : requestedPercent <= 66 ? 'balanced' : 'strong'
    const promptDirective = band === 'weak'
      ? 'Use image2 as a restrained material cue while keeping the hard layout and soft motion plan; the outline may change subtly but must not trace image1 pixel-for-pixel.'
      : band === 'balanced'
        ? 'Apply a clear material and outline transformation from image2 while keeping frame count, grid, order, cell dimensions, motion anchors, and lifecycle coherent.'
        : 'Apply image2 material language and material-specific silhouette strongly while never breaking frame count, grid, order, cell dimensions, motion path, or lifecycle.'
    return Object.freeze({ mode: 'prompt-band', requestedPercent, band, promptDirective, exact: false, verified: false })
  }

  function strengthContractFor(provider, value) {
    const resource = resourceApi()
    if (typeof resource?.strengthContractFor === 'function') return resource.strengthContractFor(provider, value)
    return fallbackStrengthContract(provider, value)
  }

  function positiveInteger(value, name) {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1) throw new TypeError(`${name} must be a positive integer`)
    return parsed
  }

  function nonNegativeInteger(value, name, fallback) {
    if (value == null || value === '') return fallback
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 0) throw new TypeError(`${name} must be a non-negative integer`)
    return parsed
  }

  function normalizeInline(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  }

  const PROMPT_SUPPLEMENT_MAX_LENGTH = 400
  const POSITIVE_ENTITY_NOISE = /\b(?:person|human|actor|caster|victim|observer|face|head|body|hand|skin|hair|clothing|limbs?|character|girl|boy|portrait|weapon|sword|blade|saber|knife|scythe|object|subject|scene|environment|background|grid|tiles?|panels?|poster|collage|logo|text|ui|attack|impact|action|spell-casting|slash)\b/gi

  function materialPromptSupplement(value) {
    return normalizeInline(value)
      .slice(0, PROMPT_SUPPLEMENT_MAX_LENGTH)
      .replace(POSITIVE_ENTITY_NOISE, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  function promptSupplementLine(value) {
    const supplement = materialPromptSupplement(value)
    return supplement
      ? `User material supplement (style and material details only; layout, motion and lifecycle locks remain authoritative): ${supplement}`
      : ''
  }

  function tokenSafeMaterialBrief(value) {
    return normalizeInline(value)
      .replace(/Use the complete image2 reference[^.]*\.\s*/gi, '')
      .replace(/Recompose those local material rules[^.]*\.\s*/gi, '')
      .replace(/The target remains recognizable[^.]*\.\s*/gi, '')
      .trim()
  }

  function tokenSafeStyleDescription(value) {
    return normalizeInline(value)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry) => !/full material morphology reference|material-specific silhouette reconstruction|reference-derived local topology/i.test(entry))
      .join(', ')
  }

  function materialShapeEvolutionForAnchor(materialType, anchorRole) {
    return TAIL_MATERIAL_SHAPE_EVOLUTION[materialType]?.[anchorRole]
      || MATERIAL_SHAPE_EVOLUTION[materialType]
      || MATERIAL_SHAPE_EVOLUTION.default
  }

  function clamp01(value, fallback) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(0, Math.min(1, parsed))
  }

  function normalizeDirectionDeg(value, fallback = 0) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    const normalized = ((parsed + 180) % 360 + 360) % 360 - 180
    return Object.is(normalized, -0) ? 0 : normalized
  }

  function defaultSequencePlan(frameCount) {
    const count = positiveInteger(frameCount, 'frameCount')
    const peakIndex = count <= 1
      ? 0
      : count === 2
        ? 1
        : count === 3
          ? 1
          : Math.max(2, Math.min(count - 2, Math.round((count - 1) * 0.45)))
    return Object.freeze(Array.from({ length: count }, (_, index) => {
      const phase = index === 0 && peakIndex > 0
        ? 'onset'
        : index < peakIndex
          ? 'growth'
          : index === peakIndex
            ? 'peak'
            : 'decay'
      const energy = phase === 'onset'
        ? 0.12
        : phase === 'growth'
          ? 0.2 + 0.68 * (index / Math.max(1, peakIndex))
          : phase === 'peak'
            ? 1
            : 0.08 + 0.74 * (1 - (index - peakIndex) / Math.max(1, count - 1 - peakIndex))
      return Object.freeze({
        index,
        phase,
        energy: Number(clamp01(energy, 0).toFixed(4)),
        centerX: 0.5,
        centerY: 0.5,
        directionDeg: 0,
        occupancy: Number(clamp01(0.08 + energy * 0.78, 0.5).toFixed(4)),
      })
    }))
  }

  function normalizePhase(value, fallback) {
    const normalized = normalizeInline(value)
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/-{2,}/g, '-')
    const aliases = {
      start: 'onset',
      birth: 'onset',
      appear: 'onset',
      build: 'growth',
      rise: 'growth',
      expand: 'growth',
      climax: 'peak',
      hold: 'follow-through',
      travel: 'follow-through',
      release: 'follow-through',
      tail: 'follow-through',
      fade: 'decay',
      'fade-out': 'decay',
      fragment: 'breakup',
      fragmentation: 'breakup',
      'break-up': 'breakup',
      dissipate: 'dissipation',
      dissipating: 'dissipation',
      end: 'dissipation',
    }
    const phase = aliases[normalized] || normalized || fallback
    if (!SEQUENCE_PHASES.includes(phase)) throw new TypeError(`Unsupported AIFX sequence phase: ${phase}`)
    return phase
  }

  function normalizeSequencePlan(value, frameCount) {
    const defaults = defaultSequencePlan(frameCount)
    if (value == null || (Array.isArray(value) && value.length === 0)) return defaults
    if (!Array.isArray(value)) throw new TypeError('sequencePlan must be an array')
    if (value.length !== frameCount) throw new RangeError(`sequencePlan must contain exactly ${frameCount} frames`)
    const byIndex = new Map()
    value.forEach((entry, position) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new TypeError(`sequencePlan[${position}] must be an object`)
      }
      const index = entry.index == null ? position : Number(entry.index)
      if (!Number.isInteger(index) || index < 0 || index >= frameCount) {
        throw new RangeError(`sequencePlan[${position}].index must be between 0 and ${frameCount - 1}`)
      }
      if (byIndex.has(index)) throw new RangeError(`sequencePlan contains duplicate index ${index}`)
      const fallback = defaults[index]
      byIndex.set(index, Object.freeze({
        index,
        phase: normalizePhase(entry.phase, fallback.phase),
        energy: Number(clamp01(entry.energy, fallback.energy).toFixed(4)),
        centerX: Number(clamp01(entry.centerX, fallback.centerX).toFixed(4)),
        centerY: Number(clamp01(entry.centerY, fallback.centerY).toFixed(4)),
        directionDeg: Number(normalizeDirectionDeg(entry.directionDeg, fallback.directionDeg).toFixed(3)),
        occupancy: Number(clamp01(entry.occupancy, fallback.occupancy).toFixed(4)),
      }))
    })
    const plan = Object.freeze(defaults.map((_, index) => byIndex.get(index)))
    const phaseRanks = new Map(SEQUENCE_PHASES.map((phase, index) => [phase, index]))
    for (let index = 1; index < plan.length; index += 1) {
      if (phaseRanks.get(plan[index].phase) < phaseRanks.get(plan[index - 1].phase)) {
        throw new RangeError('sequencePlan phases must progress continuously from onset through growth, peak, follow-through, decay, breakup, and dissipation')
      }
    }
    return plan
  }

  function sequencePlanLines(sequencePlan) {
    const lastFrame = sequencePlan.length
    return [
      `F1\u2192F${lastFrame} CONTINUOUS SEQUENCE PLAN (soft motion guidance, never a pixel mask):`,
      ...sequencePlan.map((frame) => (
        `F${frame.index + 1}: phase=${frame.phase}; energy=${frame.energy.toFixed(4)}; motionAnchor=(${frame.centerX.toFixed(4)},${frame.centerY.toFixed(4)}); directionDeg=${frame.directionDeg.toFixed(3)}; occupancy=${frame.occupancy.toFixed(4)}.`
      )),
      'Use these normalized anchors, directions, occupancy envelopes, and energy values to preserve motion continuity; regenerate the material silhouette around them instead of tracing image1 pixels.',
    ]
  }

  function materialTypeFor(options) {
    const explicit = normalizeInline(options.materialType || options.inferredEffectType).toLowerCase()
    if (explicit && explicit !== 'default' && Object.prototype.hasOwnProperty.call(MATERIAL_SHAPE_EVOLUTION, explicit)) {
      return explicit
    }
    const source = [explicit, options.materialPrompt, options.prompt, options.stylePrompt, options.styleDescription].map(normalizeInline).join(' ').toLowerCase()
    const candidates = [
      ['fire', /\b(?:fire|flame|burn|ember|blaze)\b|\u706b\u7130|\u706b/],
      ['lightning', /\b(?:lightning|electric|electricity|thunder|plasma|bolt)\b|\u96f7\u7535|\u96f7/],
      ['ice', /\b(?:ice|snow|frost|frozen|crystal|crystalline)\b|\u51b0\u96ea|\u51b0/],
    ]
    return candidates.find(([, pattern]) => pattern.test(source))?.[0] || explicit || 'default'
  }

  function normalizeLocalAnchorRole(value) {
    const role = normalizeInline(value).toLowerCase()
    if (!LOCAL_ANCHOR_ROLES.includes(role)) {
      throw new TypeError(`anchorRole must be one of: ${LOCAL_ANCHOR_ROLES.join(', ')}`)
    }
    return role
  }

  function normalizeLocalAnchorFrame(value, anchorRole) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('anchorFrame must be an object')
    }
    const rawIndex = value.globalIndex ?? value.index
    const globalIndex = Number(rawIndex)
    if (!Number.isInteger(globalIndex) || globalIndex < 0) {
      throw new TypeError('anchorFrame.globalIndex must be a non-negative integer')
    }
    const phase = normalizePhase(value.phase, anchorRole)
    if (phase !== anchorRole) {
      throw new TypeError(`anchorFrame.phase must match anchorRole ${anchorRole}`)
    }
    const defaultEnergy = anchorRole === 'peak'
      ? 1
      : anchorRole === 'onset'
        ? 0.12
        : anchorRole === 'decay'
          ? 0.25
          : anchorRole === 'breakup'
            ? 0.1
            : 0.03
    const defaultOccupancy = anchorRole === 'peak'
      ? 0.85
      : anchorRole === 'onset'
        ? 0.12
        : anchorRole === 'decay'
          ? 0.28
          : anchorRole === 'breakup'
            ? 0.1
            : 0.025
    return Object.freeze({
      index: globalIndex,
      globalIndex,
      phase,
      energy: Number(clamp01(value.energy, defaultEnergy).toFixed(4)),
      centerX: Number(clamp01(value.centerX, 0.5).toFixed(4)),
      centerY: Number(clamp01(value.centerY, 0.5).toFixed(4)),
      directionDeg: Number(normalizeDirectionDeg(value.directionDeg, 0).toFixed(3)),
      occupancy: Number(clamp01(value.occupancy, defaultOccupancy).toFixed(4)),
    })
  }

  function localAnchorIdentityProvided(options) {
    if (options.hasIdentityReference === true) return true
    if (options.identityReference != null && options.identityReference !== false) return true
    return Boolean(normalizeInline(options.identityImageName))
  }

  function compileLocalMaterialSource(options = {}) {
    const provider = normalizeProvider(options.provider)
    if (provider !== 'local') throw new TypeError('compileLocalMaterialSource only supports the local provider')
    const sourceFrame = normalizeLocalAnchorFrame({
      ...(options.sourceFrame || options.anchorFrame || {}),
      phase: 'peak',
    }, 'peak')
    const strength = strengthContractFor('local', options.styleStrength)
    const materialType = materialTypeFor(options)
    const materialPrompt = normalizeInline(options.materialPrompt || options.prompt)
    const styleDescription = normalizeInline(options.styleDescription)
    const supplementLine = promptSupplementLine(options.promptSupplement)
    const structurePrompt = [
      'Create exactly one isolated composition-neutral VFX material source on a plain black background.',
      'IMAGE 1 SOURCE-SCAFFOLD CONTRACT:',
      'image1 is only a loose visibility and safe-margin scaffold for this one material sample; it is not the final animation frame and its silhouette must not be copied.',
      'Do not invent a finished attack pose, icon, emblem, creature, weapon, scene, or chronological frame sequence.',
      'Keep one broad readable material flow inside the inner canvas with black safety margins so its color hierarchy, core, edge breakup, texture and particles can be sampled downstream.',
      'The final animation geometry will be rebuilt separately from every source template frame.',
      'Return one material source image, not a sprite sheet and not an animation claim.',
    ].join('\n')
    const stylePrompt = [
      'Create one non-figurative game-VFX material source on black.',
      'image2 is a deliberately spatially scrambled material swatch. Read only its local palette, lighting, surface texture, glow falloff, particles, fracture language and edge rendering.',
      'Do not copy image2 composition, subject, pose, identity, outline or layout.',
      `Material family: ${materialType}.`,
      materialPrompt ? `Target material direction: ${materialPrompt}` : 'Use the local material language of image2.',
      ...(styleDescription ? [`Style-reference interpretation: ${styleDescription}`] : []),
      ...(supplementLine ? [supplementLine] : []),
      `Provide the reusable local vocabulary needed for downstream ${materialType} contour reconstruction: ${MATERIAL_SHAPE_EVOLUTION[materialType] || MATERIAL_SHAPE_EVOLUTION.default}`,
      'Prioritize crisp reusable material detail over a memorable standalone silhouette.',
      'Return exactly one isolated material source image on black.',
    ].join('\n')
    const negativePrompt = [
      LOCAL_ANCHOR_NEGATIVE_PROMPT,
      'final animation pose',
      'template silhouette copy',
      'chronological sequence claim',
      'nine frame animation',
      'sprite sheet',
    ].join(', ')
    return Object.freeze({
      version: VERSION,
      provider: 'local',
      kind: 'aifx-local-material-source-prompt',
      prompt: `${structurePrompt}\n${stylePrompt}`,
      structurePrompt,
      stylePrompt,
      promptsPrecompiled: true,
      negativePrompt,
      systemPrompt: '',
      imageRoles: LOCAL_MATERIAL_SOURCE_IMAGE_ROLES,
      anchorRole: 'peak',
      anchorFrame: sourceFrame,
      sourceRole: 'material-source',
      modelProducesSequence: false,
      downstreamSequenceAuthority: 'template-frame-structure',
      hasIdentityReference: false,
      materialType,
      strength,
    })
  }

  function compileLocalAnchor(options = {}) {
    const provider = normalizeProvider(options.provider)
    if (provider !== 'local') throw new TypeError('compileLocalAnchor only supports the local provider')
    const anchorRole = normalizeLocalAnchorRole(options.anchorRole)
    const anchorFrame = normalizeLocalAnchorFrame(options.anchorFrame, anchorRole)
    const hasIdentityReference = localAnchorIdentityProvided(options)
    if (anchorRole === 'peak' && hasIdentityReference) {
      throw new TypeError('peak anchor must not receive an identity reference')
    }

    const strength = strengthContractFor('local', options.styleStrength)
    const materialType = materialTypeFor(options)
    const whitelistText = (value) => normalizeInline(value)
      .replace(POSITIVE_ENTITY_NOISE, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    const rawMaterialPrompt = whitelistText(options.materialPrompt || options.prompt)
    const rawStyleDescription = whitelistText(options.styleDescription)
    const supplementLine = promptSupplementLine(options.promptSupplement)
    const guideNormalization = options.guideNormalization && typeof options.guideNormalization === 'object'
      ? Object.freeze({ ...options.guideNormalization })
      : null
    const readableGuideInput = Boolean(guideNormalization?.readabilityApplied && guideNormalization?.inputOnly)
    const requestedReferenceMode = normalizeInline(options.referenceMode)
    const referenceMode = requestedReferenceMode === 'generated-peak-material-token'
      ? 'generated-peak-material-token'
      : requestedReferenceMode === 'semantic-peak-material-identity'
        ? 'semantic-peak-material-identity'
      : requestedReferenceMode === 'generated-peak-material-identity'
        ? 'generated-peak-material-identity'
        : 'full-material-morphology-reference'
    const usesPeakIdentity = referenceMode === 'generated-peak-material-identity'
    const usesSemanticPeakIdentity = referenceMode === 'semantic-peak-material-identity'
    const usesPeakMaterialToken = referenceMode === 'generated-peak-material-token'
    const materialPrompt = usesPeakMaterialToken ? tokenSafeMaterialBrief(rawMaterialPrompt) : rawMaterialPrompt
    const styleDescription = usesPeakMaterialToken ? tokenSafeStyleDescription(rawStyleDescription) : rawStyleDescription
    const frameLabel = `F${anchorFrame.globalIndex + 1}`
    const frameContract = `${frameLabel}: role=${anchorRole}; phase=${anchorFrame.phase}; energy=${anchorFrame.energy.toFixed(4)}; motionAnchor=(${anchorFrame.centerX.toFixed(4)},${anchorFrame.centerY.toFixed(4)}); directionDeg=${anchorFrame.directionDeg.toFixed(3)}; occupancy=${anchorFrame.occupancy.toFixed(4)}.`

    const phaseLines = anchorRole === 'onset'
      ? [
          'Form an incomplete emerging onset with narrow restrained extent and crisp local material edges.',
          'Keep the early material topology readable at reduced energy.',
        ]
      : anchorRole === 'decay'
        ? [
            'Form one compact isolated decay state with visibly lower occupied area and energy than the peak.',
            'Reconfigure the contour and internal branch map into crisp broken material traces and separated particles.',
            ...(materialType === 'lightning' ? [
              'Build one narrow asymmetric bent discharge remnant aligned to the motion direction, with 2 to 4 unequal local forks and detached trailing sparks.',
              'Do not build a radial starburst, shared central hub, symmetric explosion, or edge-to-edge branch network.',
            ] : []),
            'Keep a wide pure-black safety margin on every side; never enlarge the effect into an edge-to-edge network or a full-canvas texture.',
          ]
        : anchorRole === 'breakup'
          ? [
              'Render one breakup state, not several complete effects: leave one loose asymmetrical trail of clipped mid-branch filaments along the supplied path.',
              'Every fragment must differ in length, bend, and branch count, terminate locally, and stay separated by negative gaps wider than the fragments; none may become a familiar zigzag icon, glyph, or miniature copy.',
            ]
          : anchorRole === 'dissipation'
            ? [
                'Render only the last sparse residue of one event on an almost-empty black canvas: short fading filaments and a few unequal dots, offset from one another along the motion axis.',
                'Keep the motion-anchor region empty black. No luminous node, common hub, central core, radial origin, complete symbol, or scaled copy may remain, and total occupied extent must be much smaller than breakup.',
              ]
            : [
                'Form the strongest readable peak state with a clear reusable material identity and coherent core hierarchy.',
              ]

    const structurePrompt = [
      `Render exactly one isolated nonfigurative ${materialType} material state on a pure black canvas.`,
      `Every visible mark belongs to the ${materialType} material, its core, local glow, edge breakup, and coherent particles.`,
      'Use ControlNet for centroid, principal direction, coarse motion trajectory, turning direction, approximate outer extent, and safe margin.',
      'Reinterpret that coarse gesture as the target material instead of pixel-tracing its stroke; do not inherit its connected-component topology, colors, or texture, because lifecycle text owns gaps and component count.',
      frameContract,
      ...(readableGuideInput ? [
        'The ControlNet guide has temporary uniform magnification and contrast normalization for conditioning readability.',
        'Render its complete gesture at the readable conditioning scale; final output occupancy and anchor are restored by one downstream uniform affine transform.',
      ] : []),
      ...phaseLines,
      materialPrompt ? `Material brief: ${materialPrompt}` : `Material family: ${materialType}.`,
      `Material-shape evolution: ${materialShapeEvolutionForAnchor(materialType, anchorRole)}`,
      ...(styleDescription ? [`Reference-derived material vocabulary: ${styleDescription}`] : []),
      'Keep the complete material state and its local glow inside the canvas with a clear black safety margin.',
    ].join('\n')

    const stylePrompt = [
      usesPeakMaterialToken
        ? 'Image1 is one compact material microtexture token extracted from the accepted peak after its macro silhouette was removed.'
        : usesSemanticPeakIdentity
        ? 'The accepted peak has already distilled the complete reference into one shared material identity.'
        : usesPeakIdentity
          ? 'Image1 is the isolated generated peak material identity distilled from the complete reference.'
          : 'Image1 is the complete material-morphology reference.',
      ...(usesPeakIdentity ? [
        'Use its palette hierarchy, core logic, local topology, edge rendering, glow falloff, texture and particle scale as identity only.',
        'Transfer only those identity properties while the supplied motion guide and lifecycle prompt exclusively determine one newly reconstructed tail silhouette.',
      ] : []),
      ...(usesPeakMaterialToken ? [
        `Use Image1 only for local ${materialType} palette hierarchy, emissive-core construction, edge rendering, glow falloff, texture and particle scale.`,
        'Image1 is a deliberately shuffled microtexture swatch, not an effect composition or a surrounding field.',
        'Never repeat, enlarge, trace, or reproduce its swatch boundary.',
        'Let the current motion guide, lifecycle role, occupancy and direction determine the complete newly reconstructed phase silhouette.',
      ] : usesSemanticPeakIdentity ? [
        `Carry the reference-derived ${materialType} palette hierarchy, core construction, local topology language, layer hierarchy, edge breakup, glow falloff, texture and particle rhythm through this semantic identity contract.`,
        'Let the current motion guide, lifecycle role, occupancy and direction determine a newly reconstructed phase silhouette.',
      ] : [
        `Use Image1 to establish ${materialType} palette hierarchy, core construction, local topology, layer hierarchy, edge breakup, glow falloff, and particle rhythm.`,
        'Do not reuse the complete reference pose, direction, composition, or macro layout; the current motion guide owns the coarse trajectory and turning gesture.',
      ]),
      `Recompose those local material rules into the current ${anchorRole} lifecycle state during the later motion-synthesis stage.`,
      anchorRole === 'peak'
        ? 'Establish the sequence peak identity through a strong readable material core and characteristic local topology.'
        : 'Preserve the shared sequence identity through its palette hierarchy, core logic, surface texture, particle scale, and edge rendering.',
      ...(hasIdentityReference ? [
        'Image2 supplies the shared peak material identity for this lifecycle state.',
      ] : []),
      materialPrompt ? `Material brief: ${materialPrompt}` : `Material family: ${materialType}.`,
      ...(styleDescription ? [`Reference-derived material vocabulary: ${styleDescription}`] : []),
      ...(supplementLine ? [supplementLine] : []),
    ].join('\n')
    const negativeTerms = LOCAL_ANCHOR_NEGATIVE_PROMPT.split(', ')
      .filter((term) => (anchorRole === 'breakup' || anchorRole === 'dissipation') ? term !== 'multiple effects' : true)
    if (materialType === 'lightning' && (anchorRole === 'breakup' || anchorRole === 'dissipation')) {
      negativeTerms.push(
        'continuous main bolt',
        'unbroken lightning trunk',
        'connected branch network',
        'single spanning arc',
        'repeated complete motifs',
        'duplicate mini-effects',
        'row of icons',
        'evenly spaced copies',
        'symbol stamps',
        'repeated lightning-bolt icons',
        'complete bolt symbols',
        'radial burst',
        'starburst',
        'central explosion',
        'shared central hub',
        'symmetric spoke pattern',
      )
    }
    if (materialType === 'lightning' && anchorRole === 'decay') {
      negativeTerms.push(
        'radial burst',
        'starburst',
        'central explosion',
        'shared central hub',
        'symmetric spoke pattern',
        'edge-to-edge branch network',
      )
    }
    if (usesPeakMaterialToken) {
      negativeTerms.push(
        'tiled texture',
        'repeated texture',
        'full-frame texture',
        'colored background',
        'blue background',
        'edge-to-edge effect',
        'oversized close-up',
        'copied swatch boundary',
      )
    }

    return Object.freeze({
      version: VERSION,
      provider: 'local',
      kind: 'aifx-local-anchor-prompt',
      prompt: `${structurePrompt}\n${stylePrompt}`,
      structurePrompt,
      stylePrompt,
      promptsPrecompiled: true,
      negativePrompt: negativeTerms.join(', '),
      systemPrompt: '',
      imageRoles: Object.freeze({
        image1: LOCAL_ANCHOR_IMAGE_ROLES.image1,
        ...(!usesSemanticPeakIdentity ? { image2: referenceMode } : {}),
        ...(hasIdentityReference ? { image3: LOCAL_ANCHOR_IMAGE_ROLES.image3 } : {}),
      }),
      anchorRole,
      anchorFrame,
      guideNormalization,
      referenceMode,
      visualConditioningPolicy: usesPeakMaterialToken
        ? anchorRole === 'breakup' || anchorRole === 'dissipation'
          ? 'parallel-early-peak-material-token-tail-topology-synthesis'
          : 'early-peak-material-token-phase-topology-synthesis'
        : usesSemanticPeakIdentity
          ? 'semantic-material-identity-plus-motion-control'
          : 'early-material-reference-late-motion-synthesis',
      positiveWhitelistOnly: true,
      hasIdentityReference,
      materialType,
      strength,
    })
  }

  function normalizeGeometry(options) {
    const frameCount = positiveInteger(options.frameCount, 'frameCount')
    const rows = positiveInteger(options.rows, 'rows')
    const columns = positiveInteger(options.columns, 'columns')
    const capacity = rows * columns
    if (frameCount > capacity) throw new RangeError(`frameCount ${frameCount} exceeds grid capacity ${capacity}`)
    const cellWidth = nonNegativeInteger(options.cellWidth, 'cellWidth', 0)
    const cellHeight = nonNegativeInteger(options.cellHeight, 'cellHeight', 0)
    if ((cellWidth === 0) !== (cellHeight === 0)) throw new TypeError('cellWidth and cellHeight must either both be set or both be omitted')
    const gutter = nonNegativeInteger(options.gutter, 'gutter', 0)
    const canvasWidth = nonNegativeInteger(options.canvasWidth, 'canvasWidth', 0)
    const canvasHeight = nonNegativeInteger(options.canvasHeight, 'canvasHeight', 0)
    if ((canvasWidth === 0) !== (canvasHeight === 0)) throw new TypeError('canvasWidth and canvasHeight must either both be set or both be omitted')
    const padding = nonNegativeInteger(options.padding, 'padding', 0)
    const trailingRight = nonNegativeInteger(options.trailingRight, 'trailingRight', 0)
    const trailingBottom = nonNegativeInteger(options.trailingBottom, 'trailingBottom', 0)
    return Object.freeze({
      frameCount,
      rows,
      columns,
      capacity,
      unusedCells: capacity - frameCount,
      order: 'row-major',
      cellWidth,
      cellHeight,
      gutter,
      canvasWidth,
      canvasHeight,
      padding,
      trailingRight,
      trailingBottom,
    })
  }

  function geometryLines(geometry) {
    const lines = [
      `Output exactly one spritesheet containing exactly ${geometry.frameCount} chronological animation frames.`,
      `The fixed grid is exactly ${geometry.rows} rows by ${geometry.columns} columns with row-major order: left-to-right, then top-to-bottom.`,
      `Cells 1 through ${geometry.frameCount} map one-to-one to source frames 1 through ${geometry.frameCount}.`,
    ]
    if (geometry.cellWidth > 0) lines.push(`Every cell remains exactly ${geometry.cellWidth} by ${geometry.cellHeight} pixels.`)
    if (geometry.unusedCells > 0) {
      lines.push(`The final ${geometry.unusedCells} unused grid cells must remain background-only and contain no effect content.`)
    }
    return lines
  }

  function roleLines() {
    return [
      'image1 = template_sheet: hard authority only for frame count, grid, frame order, and cell dimensions; use its normalized motion anchors, path, direction, occupancy trend, and lifecycle only as soft temporal guidance.',
      'Never copy image1 colors, subject identity, rendering, texture, or pixel-for-pixel silhouette; each material must regenerate its own changing outer shape.',
      'image2 = style_reference with a MATERIAL-ONLY role: use only its material chemistry, color hierarchy, lighting response, surface texture, glow falloff, particle finish, and edge rendering.',
      'Never import image2 subject, outer shape, outline, composition, layout, location, direction, symmetry, pose, action, or motion pattern; image1 and the lifecycle plan are the only geometry and animation authorities.',
    ]
  }

  function lifecycleLines(sequencePlan) {
    return [
      'Treat all cells as consecutive F1 through Fn frames of one coherent effect animation, never as independent illustrations, gallery items, or design variants.',
      'Follow the ordered onset, growth, peak, follow-through, decay, breakup, and dissipation phases present in the plan below.',
      'Keep motion anchors and travel direction coherent while allowing each material to expand, contract, fork, spike, fragment, and dissipate with its own silhouette.',
      'The template occupancy values are soft scale envelopes, not alpha masks or pixel boundaries.',
      ...sequencePlanLines(sequencePlan),
    ]
  }

  function localTemporalMaterialLines(sequencePlan) {
    const peak = sequencePlan.reduce((best, frame) => (frame.energy > best.energy ? frame : best), sequencePlan[0])
    const fadeStart = sequencePlan.find((frame) => frame.index > peak.index && frame.energy <= peak.energy * 0.8)
      || sequencePlan[Math.min(sequencePlan.length - 1, peak.index + 1)]
    const envelope = sequencePlan
      .map((frame) => `F${frame.index + 1} ${frame.phase} E${Math.round(frame.energy * 100)} O${Math.round(frame.occupancy * 100)}`)
      .join(' -> ')
    const finalFrame = sequencePlan[sequencePlan.length - 1]
    const penultimateFrame = sequencePlan[Math.max(0, sequencePlan.length - 2)]
    return [
      'TEMPORAL MATERIAL ENVELOPE (hard for animation timing, not a silhouette mask):',
      envelope,
      `F${peak.index + 1} is the single strongest visual peak; never create a second peak later in the sheet.`,
      `From F${fadeStart.index + 1} onward, evolve the same body with visibly decreasing occupied area and energy.`,
      `F${penultimateFrame.index + 1} and F${finalFrame.index + 1} must be near-empty decay residues, never another complete effect.`,
      'Each cell must visibly derive from the immediately previous cell; do not reset the subject, camera, action, or topology between frames.',
      'Keep all generated pixels inside their assigned cells. Gutters and the area outside the grid stay plain black: no poster background, no decorative spill, no cross-cell flames or particles.',
    ]
  }

  function materialLines(options, strength, materialType) {
    const materialPrompt = normalizeInline(options.materialPrompt || options.prompt)
    const styleDescription = normalizeInline(options.styleDescription)
    const supplementLine = promptSupplementLine(options.promptSupplement)
    const lines = [
      materialPrompt
        ? `Regenerate the visible effect as: ${materialPrompt}`
        : 'Regenerate the visible effect using the material and rendering language of image2.',
      "Preserve image2's dominant, midtone, shadow, and highlight color proportions; do not collapse the effect into only its brightest hue.",
      'Use image2-specific surface texture instead of a generic glossy or metallic coating unless image2 itself clearly shows that material.',
      `MATERIAL-SPECIFIC OUTLINE EVOLUTION (${materialType}): ${MATERIAL_SHAPE_EVOLUTION[materialType] || MATERIAL_SHAPE_EVOLUTION.default}`,
      'Do not retain image1 as a recolored cutout; the outer alpha silhouette must visibly evolve with the target material while following the sequence motion plan.',
    ]
    if (styleDescription) lines.push(`Style-reference interpretation: ${styleDescription}`)
    if (supplementLine) lines.push(supplementLine)
    if (strength.mode === 'prompt-band') lines.push(`Style-strength instruction (${strength.band}): ${strength.promptDirective}`)
    return lines
  }

  function hardLockBlock(geometry, sequencePlan) {
    return [
      'IMAGE ROLE CONTRACT:',
      ...roleLines(),
      'OUTPUT LAYOUT HARD LOCK:',
      ...geometryLines(geometry),
      'MOTION AND LIFECYCLE GUIDE:',
      ...lifecycleLines(sequencePlan),
      'CELL ISOLATION LOCK:',
      'All effect pixels, glow, particles, branches, debris, trails, and connected components must remain fully isolated inside their own source cell.',
    ]
  }

  function localStructureBlock(geometry, sequencePlan) {
    return [
      'IMAGE 1 STRUCTURE CONTRACT:',
      'image1 = template_sheet: hard authority only for frame count, grid, frame order, and cell dimensions; use its normalized motion anchors, path, direction, occupancy trend, and lifecycle only as soft temporal guidance.',
      'Never copy image1 colors, subject identity, rendering, texture, or pixel-for-pixel silhouette; each material must regenerate its own changing outer shape.',
      'OUTPUT LAYOUT HARD LOCK:',
      ...geometryLines(geometry),
      'MOTION AND LIFECYCLE GUIDE:',
      ...lifecycleLines(sequencePlan),
      'CELL ISOLATION LOCK:',
      'All effect pixels, glow, particles, branches, debris, trails, and connected components must remain fully isolated inside their own source cell.',
    ]
  }

  function compileLocal(options, geometry, strength, sequencePlan, materialType) {
    const structurePrompt = [
      'Create one production VFX spritesheet using hard layout constraints and a soft sequential motion plan.',
      ...localStructureBlock(geometry, sequencePlan),
      'Return structural conditioning for exactly one chronological spritesheet; do not invent independent variants.',
    ].join('\n')
    const stylePrompt = [
      'Materially regenerate the same chronological image1 spritesheet using image2 as the style reference.',
      'IMAGE ROLE CONTRACT:',
      ...roleLines(),
      ...localTemporalMaterialLines(sequencePlan),
      'MATERIAL REGENERATION:',
      ...materialLines(options, strength, materialType),
      'Return only the spritesheet image. Preserve the original sheet background so downstream alpha extraction remains deterministic.',
    ].join('\n')
    const prompt = [structurePrompt, stylePrompt].join('\n')
    return {
      prompt,
      structurePrompt,
      stylePrompt,
      promptsPrecompiled: true,
      negativePrompt: LOCAL_NEGATIVE_PROMPT,
      systemPrompt: '',
    }
  }

  function compileGpt(options, geometry, strength, sequencePlan, materialType) {
    const prompt = [
      'Edit image1 into one production VFX spritesheet. image1 and image2 have fixed, non-interchangeable roles.',
      ...hardLockBlock(geometry, sequencePlan),
      'MATERIAL REGENERATION:',
      ...materialLines(options, strength, materialType),
      'HARD PROHIBITIONS:',
      ...PROHIBITIONS.map((item) => `- ${item}`),
      'Return only the spritesheet image. Preserve the original sheet background for deterministic downstream alpha extraction.',
    ].join('\n')
    return { prompt, negativePrompt: '', systemPrompt: '' }
  }

  function compileGoogle(options, geometry, strength, sequencePlan, materialType) {
    const systemPrompt = [
      'You are a production VFX spritesheet editor. Obey output layout as a hard constraint and the sequence plan as soft motion guidance.',
      ...hardLockBlock(geometry, sequencePlan),
      'HARD PROHIBITIONS:',
      ...PROHIBITIONS.map((item) => `- ${item}`),
      'Return exactly one spritesheet image and no explanatory text.',
    ].join('\n')
    const prompt = [
      'Materially regenerate the image1 effect sequence while obeying frame, grid, order, cell-dimension, motion-plan, and cell-isolation contracts.',
      ...materialLines(options, strength, materialType),
      'Preserve the original sheet background for deterministic downstream alpha extraction.',
    ].join('\n')
    return { prompt, negativePrompt: '', systemPrompt }
  }

  function freezeResult(value) {
    return Object.freeze({
      ...value,
      imageRoles: IMAGE_ROLES,
      geometry: value.geometry,
      sequencePlan: value.sequencePlan,
      materialType: value.materialType,
      strength: value.strength,
      prohibitions: PROHIBITIONS,
    })
  }

  function compile(options = {}) {
    const provider = normalizeProvider(options.provider)
    const geometry = normalizeGeometry(options)
    const sequencePlan = normalizeSequencePlan(options.sequencePlan, geometry.frameCount)
    const materialType = materialTypeFor(options)
    const strength = strengthContractFor(provider, options.styleStrength)
    const compiled = provider === 'gpt'
      ? compileGpt(options, geometry, strength, sequencePlan, materialType)
      : provider === 'google'
        ? compileGoogle(options, geometry, strength, sequencePlan, materialType)
        : compileLocal(options, geometry, strength, sequencePlan, materialType)
    return freezeResult({
      version: VERSION,
      provider,
      ...compiled,
      geometry,
      sequencePlan,
      materialType,
      strength,
    })
  }

  return Object.freeze({
    version: VERSION,
    IMAGE_ROLES,
    LOCAL_ANCHOR_IMAGE_ROLES,
    LOCAL_ANCHOR_ROLES,
    PROHIBITIONS,
    LOCAL_NEGATIVE_PROMPT,
    LOCAL_ANCHOR_NEGATIVE_PROMPT,
    SEQUENCE_PHASES,
    MATERIAL_SHAPE_EVOLUTION,
    normalizeGeometry,
    defaultSequencePlan,
    normalizeSequencePlan,
    normalizeLocalAnchorRole,
    normalizeLocalAnchorFrame,
    compileLocalMaterialSource,
    compileLocalAnchor,
    compile,
  })
})
