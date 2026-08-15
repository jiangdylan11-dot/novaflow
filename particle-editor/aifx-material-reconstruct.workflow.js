(function initNovaFlowAifxMaterialReconstructWorkflow(root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root && typeof root === 'object') root.NovaFlowAifxMaterialReconstructWorkflow = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAifxMaterialReconstructWorkflow() {
  'use strict'

  const VERSION = 'aifx-material-reconstruct-v3'
  const PIPELINE = 'qwen-image-edit-2511-multi-phase-material-morphology-v2'
  const ANCHOR_ROLES = Object.freeze(['peak', 'onset', 'decay', 'breakup', 'dissipation'])
  const POST_PEAK_ROLES = Object.freeze(new Set(['decay', 'breakup', 'dissipation']))
  const INITIAL_MATERIALS = Object.freeze(['fire', 'lightning', 'ice', 'poison'])
  const FINAL_SHAPE_AUTHORITY = 'ai-anchor-geometry'
  const MOTION_CONSTRAINT = 'template-center-occupancy-direction-lifecycle-envelope'
  const RETRY_SEED_STRIDE = 15485863
  const ANCHOR_SEED_OFFSETS = Object.freeze({
    peak: 0,
    onset: 32452843,
    decay: 49979687,
    breakup: 67867967,
    dissipation: 86028121,
  })
  const RETRYABLE_ANCHOR_CODES = Object.freeze(new Set([
    'AIFX_TEMPORAL_CONFORM_AI_ALPHA_EMPTY',
    'AIFX_TEMPORAL_CONFORM_ANCHOR_BOUNDARY_CLIPPED',
    'AIFX_TEMPORAL_CONFORM_EXPLICIT_ANCHOR_INCOMPATIBLE',
    'AIFX_TEMPORAL_CONFORM_EXPLICIT_ANCHOR_DUPLICATE',
    'AIFX_TEMPORAL_CONFORM_ANCHOR_INSUFFICIENT',
    'AIFX_TEMPORAL_CONFORM_PEAK_DOMINANCE_FAILED',
    'AIFX_ANCHOR_MATERIAL_UNREADABLE',
    'AIFX_ANCHOR_NOT_ISOLATED',
    'AIFX_MORPHOLOGY_DECAY_TOPOLOGY_UNRESOLVED',
    'AIFX_MORPHOLOGY_BREAKUP_TOPOLOGY_UNRESOLVED',
    'AIFX_MORPHOLOGY_DISSIPATION_TOPOLOGY_UNRESOLVED',
    'AIFX_SEQUENCE_TEMPLATE_STENCIL',
    'AIFX_SEQUENCE_LIFECYCLE_INCOHERENT',
    'AIFX_SEQUENCE_TEMPLATE_DIVERGED',
    'AIFX_SEQUENCE_DIRECTION_DIVERGED',
    'AIFX_SEQUENCE_POSE_EVOLUTION_DIVERGED',
    'AIFX_SEQUENCE_TAIL_FROZEN',
    'AIFX_SEQUENCE_POSITION_DRIFT',
    'AIFX_SEQUENCE_TEMPORAL_JITTER',
  ]))

  class AifxMaterialReconstructError extends Error {
    constructor(code, message, details) {
      super(String(message || code))
      this.name = 'AifxMaterialReconstructError'
      this.code = code
      this.details = details && typeof details === 'object' ? details : {}
      this.retryable = false
    }
  }

  function fail(code, message, details) {
    throw new AifxMaterialReconstructError(code, message, details)
  }

  function cleanText(value) {
    return String(value == null ? '' : value).trim()
  }

  function finiteNumber(value, fallback = 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value))
  }

  function createReadableGuidePlan(options = {}) {
    const role = cleanText(options.role).toLowerCase()
    if (!ANCHOR_ROLES.includes(role)) {
      fail('AIFX_MORPHOLOGY_GUIDE_INVALID', `Unsupported material guide role: ${role || '(empty)'}.`)
    }
    const width = Math.max(1, Math.round(finiteNumber(options.width, 1)))
    const height = Math.max(1, Math.round(finiteNumber(options.height, 1)))
    const rawBounds = options.bounds && typeof options.bounds === 'object' ? options.bounds : {}
    const x = clamp(finiteNumber(rawBounds.x), 0, width - 1)
    const y = clamp(finiteNumber(rawBounds.y), 0, height - 1)
    const boundsWidth = clamp(finiteNumber(rawBounds.width), 0, width - x)
    const boundsHeight = clamp(finiteNumber(rawBounds.height), 0, height - y)
    const visible = boundsWidth > 0 && boundsHeight > 0
    const baseScale = 0.72
    const isTail = role === 'breakup' || role === 'dissipation'
    if (!visible) {
      return Object.freeze({
        version: 'aifx-readable-guide-v1',
        role,
        visible: false,
        inputOnly: true,
        scale: baseScale,
        lumaGain: 1,
        readabilityApplied: false,
        templatePixelsUsed: false,
        finalOutputTransform: 'sequence-plan-uniform-affine',
      })
    }

    const centerX = x + boundsWidth * 0.5
    const centerY = y + boundsHeight * 0.5
    const marginX = width * 0.1
    const marginY = height * 0.1
    const safeScaleLimits = [
      centerX - x > 0 ? (centerX - marginX) / (centerX - x) : 4.5,
      x + boundsWidth - centerX > 0 ? (width - marginX - centerX) / (x + boundsWidth - centerX) : 4.5,
      centerY - y > 0 ? (centerY - marginY) / (centerY - y) : 4.5,
      y + boundsHeight - centerY > 0 ? (height - marginY - centerY) / (y + boundsHeight - centerY) : 4.5,
    ].filter((value) => Number.isFinite(value) && value > 0)
    const maximumSafeScale = clamp(Math.min(4.5, ...safeScaleLimits), baseScale, 4.5)
    const boundsAreaRatio = (boundsWidth * boundsHeight) / (width * height)
    const targetBoundsAreaRatio = role === 'breakup' ? 0.12 : role === 'dissipation' ? 0.08 : 0
    const requestedScale = targetBoundsAreaRatio > 0
      ? Math.sqrt(targetBoundsAreaRatio / Math.max(1 / (width * height), boundsAreaRatio))
      : baseScale
    const scale = isTail
      ? clamp(Math.max(baseScale, requestedScale), baseScale, maximumSafeScale)
      : baseScale
    const lumaP90 = clamp(finiteNumber(options.lumaP90), 0, 255)
    const targetLuma = isTail ? 196 : 168
    const lumaGain = lumaP90 > 0 ? clamp(targetLuma / lumaP90, 1, isTail ? 112 : 4) : 1
    return Object.freeze({
      version: 'aifx-readable-guide-v1',
      role,
      visible: true,
      inputOnly: true,
      centerX,
      centerY,
      boundsAreaRatio,
      targetBoundsAreaRatio,
      scale,
      maximumSafeScale,
      lumaP90,
      lumaGain,
      readabilityApplied: isTail && (scale > baseScale + 1e-6 || lumaGain > 1.05),
      templatePixelsUsed: false,
      finalOutputTransform: 'sequence-plan-uniform-affine',
    })
  }

  function normalizeSequencePlan(value) {
    if (!Array.isArray(value) || value.length < 2) {
      fail('AIFX_MORPHOLOGY_SEQUENCE_PLAN_INVALID', 'Material morphology reconstruction requires at least two chronological frames.')
    }
    return Object.freeze(value.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        fail('AIFX_MORPHOLOGY_SEQUENCE_PLAN_INVALID', `sequencePlan[${index}] must be an object.`)
      }
      const normalizedIndex = entry.index == null ? index : Number(entry.index)
      if (!Number.isInteger(normalizedIndex) || normalizedIndex !== index) {
        fail('AIFX_MORPHOLOGY_SEQUENCE_PLAN_INVALID', `sequencePlan[${index}] must keep chronological index ${index}.`)
      }
      return Object.freeze({
        ...entry,
        index,
        energy: finiteNumber(entry.energy),
        occupancy: finiteNumber(entry.occupancy),
        centerX: finiteNumber(entry.centerX, 0.5),
        centerY: finiteNumber(entry.centerY, 0.5),
        directionDeg: finiteNumber(entry.directionDeg),
      })
    }))
  }

  function plannedPeakIndexFor(sequencePlan) {
    const phasePeakIndex = sequencePlan.findIndex((entry) => cleanText(entry.phase).toLowerCase() === 'peak')
    if (phasePeakIndex >= 0) return phasePeakIndex
    return sequencePlan.reduce((bestIndex, entry, index) => {
      const best = sequencePlan[bestIndex]
      if (Number(entry.energy) !== Number(best.energy)) return Number(entry.energy) > Number(best.energy) ? index : bestIndex
      return Number(entry.occupancy) > Number(best.occupancy) ? index : bestIndex
    }, 0)
  }

  function selectAnchorSpecs(value) {
    const sequencePlan = normalizeSequencePlan(value)
    const axisDeltaDeg = (left, right) => {
      const raw = Math.abs((Number(left) || 0) - (Number(right) || 0)) % 180
      return Math.min(raw, 180 - raw)
    }
    const peakIndex = plannedPeakIndexFor(sequencePlan)
    const onsetIndex = sequencePlan.findIndex((entry, index) => index < peakIndex && entry.phase === 'onset')
    const decayCandidates = sequencePlan
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => (
        index > peakIndex
        && (entry.phase === 'follow-through' || entry.phase === 'decay')
        && Number(entry.energy) >= 0.12
      ))
    const decayCandidate = decayCandidates.length
      ? decayCandidates.reduce((best, candidate) => (
        Math.abs(Number(candidate.entry.energy) - 0.3) < Math.abs(Number(best.entry.energy) - 0.3) ? candidate : best
      ), decayCandidates[0])
      : null
    const tailCandidates = sequencePlan
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => (
        index > peakIndex
        && Number(entry.occupancy) > 0
        && (entry.phase === 'breakup' || entry.phase === 'dissipation')
      ))
    const dissipationCandidate = tailCandidates.at(-1)
    const breakupCandidate = tailCandidates
      .filter(({ index }) => index < Number(dissipationCandidate?.index))
      .map((candidate) => {
        const previous = sequencePlan[Math.max(peakIndex, candidate.index - 1)]
        const directionJump = axisDeltaDeg(candidate.entry.directionDeg, previous?.directionDeg) / 90
        const occupancyRatio = (Number(candidate.entry.occupancy) + 1e-6) / (Number(previous?.occupancy) + 1e-6)
        const occupancyJump = Math.min(1, Math.abs(Math.log2(occupancyRatio)) / 3)
        return { ...candidate, transitionScore: directionJump * 0.65 + occupancyJump * 0.35 }
      })
      .sort((left, right) => right.transitionScore - left.transitionScore || right.index - left.index)[0]
    if (
      tailCandidates.length >= 2
      && breakupCandidate
      && dissipationCandidate
      && breakupCandidate.index > peakIndex
      && dissipationCandidate.index > breakupCandidate.index
    ) {
      const prePeakSpan = onsetIndex >= 0 ? peakIndex - onsetIndex : 0
      const postPeakBodySpan = breakupCandidate.index - peakIndex
      const preferOnsetBodyAnchor = onsetIndex >= 0
        && (!decayCandidate || prePeakSpan >= postPeakBodySpan)
      const bodyAnchor = preferOnsetBodyAnchor
        ? Object.freeze({ role: 'onset', globalIndex: onsetIndex, plan: sequencePlan[onsetIndex] })
        : decayCandidate
          ? Object.freeze({
              role: 'decay',
              globalIndex: decayCandidate.index,
              plan: sequencePlan[decayCandidate.index],
            })
          : peakIndex > 0
            ? Object.freeze({ role: 'onset', globalIndex: onsetIndex >= 0 ? onsetIndex : 0, plan: sequencePlan[onsetIndex >= 0 ? onsetIndex : 0] })
            : null
      return Object.freeze([
        Object.freeze({ role: 'peak', globalIndex: peakIndex, plan: sequencePlan[peakIndex] }),
        ...(bodyAnchor ? [bodyAnchor] : []),
        Object.freeze({ role: 'breakup', globalIndex: breakupCandidate.index, plan: sequencePlan[breakupCandidate.index] }),
        Object.freeze({ role: 'dissipation', globalIndex: dissipationCandidate.index, plan: sequencePlan[dissipationCandidate.index] }),
      ])
    }
    const fallbackDecay = sequencePlan
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => index > peakIndex && entry.phase !== 'dissipation' && Number(entry.energy) >= 0.04)
      .at(-1)
    const decayIndex = decayCandidate?.index ?? fallbackDecay?.index ?? Math.min(sequencePlan.length - 1, peakIndex + 1)
    return Object.freeze([
      Object.freeze({ role: 'peak', globalIndex: peakIndex, plan: sequencePlan[peakIndex] }),
      ...(peakIndex > 0 ? [Object.freeze({ role: 'onset', globalIndex: onsetIndex >= 0 ? onsetIndex : 0, plan: sequencePlan[onsetIndex >= 0 ? onsetIndex : 0] })] : []),
      ...(decayIndex > peakIndex ? [Object.freeze({ role: 'decay', globalIndex: decayIndex, plan: sequencePlan[decayIndex] })] : []),
    ])
  }

  function createRetryPolicy(plan, options = {}) {
    if (!plan || plan.version !== VERSION || !Array.isArray(plan.anchors)) {
      fail('AIFX_MORPHOLOGY_PLAN_REQUIRED', 'A valid material morphology plan is required to create a retry policy.')
    }
    const maximumAnchorAttempts = Math.max(1, Math.min(3, Math.floor(finiteNumber(options.maximumAnchorAttempts, 3))))
    const boundedPostPeakRetryEnabled = plan.anchors.length >= 4
    const maximumRetryAnchorCalls = plan.anchors.filter((entry) => entry.role !== 'peak').length
    const maximumGeneratedAnchorCalls = boundedPostPeakRetryEnabled
      ? plan.anchors.length + (maximumAnchorAttempts - 1) * maximumRetryAnchorCalls
      : plan.anchors.length * maximumAnchorAttempts
    const initialSequenceSeed = Math.max(0, Math.floor(finiteNumber(options.initialSequenceSeed))) % 2147483647
    return Object.freeze({
      maximumAnchorAttempts,
      boundedPostPeakRetryEnabled,
      maximumRetryAnchorCalls,
      maximumGeneratedAnchorCalls,
      initialSequenceSeed,
      seedStride: RETRY_SEED_STRIDE,
      seedStrategy: 'reference-peak-with-deterministic-phase-offsets-and-bounded-post-peak-retry',
      anchorRoles: Object.freeze(plan.anchors.map((entry) => entry.role)),
      anchorTargets: Object.freeze(plan.anchors.map((entry) => Object.freeze({
        role: entry.role,
        globalIndex: entry.globalIndex,
      }))),
    })
  }

  function sequenceSeedForAttempt(policy, attempt) {
    const attemptNumber = Math.max(1, Math.floor(finiteNumber(attempt, 1)))
    return (policy.initialSequenceSeed + (attemptNumber - 1) * policy.seedStride) % 2147483647
  }

  function evaluateRetry(policy, options = {}) {
    const error = options.error
    const attempt = Math.max(1, Math.floor(finiteNumber(options.attempt, 1)))
    const failureCodes = Object.freeze([...new Set([
      cleanText(error?.code),
      ...(Array.isArray(error?.failures) ? error.failures.map((entry) => cleanText(entry?.code)) : []),
    ].filter(Boolean))])
    const boundedPostPeakRetry = policy.boundedPostPeakRetryEnabled
      && attempt < policy.maximumAnchorAttempts
      && failureCodes.some((code) => RETRYABLE_ANCHOR_CODES.has(code))
    const tailOnlyRetry = failureCodes.length > 0
      && failureCodes.every((code) => code === 'AIFX_SEQUENCE_TAIL_FROZEN')
    const primaryCode = cleanText(error?.code)
    const targetedGlobalIndex = Number(error?.details?.globalIndex)
    const targetedRole = Number.isInteger(targetedGlobalIndex)
      ? policy.anchorTargets.find((entry) => entry.globalIndex === targetedGlobalIndex)?.role || ''
      : ''
    const shouldRetry = targetedRole !== 'peak'
      && RETRYABLE_ANCHOR_CODES.has(primaryCode)
      && attempt < policy.maximumAnchorAttempts
      && (!policy.boundedPostPeakRetryEnabled || boundedPostPeakRetry)
    const stableRoleSet = new Set(tailOnlyRetry ? ['peak', 'onset', 'decay'] : ['peak'])
    if (targetedRole) stableRoleSet.delete(targetedRole)
    return Object.freeze({
      shouldRetry,
      failureCodes,
      boundedPostPeakRetry,
      tailOnlyRetry,
      targetedRole,
      retainedRoles: Object.freeze(policy.anchorRoles.filter((role) => stableRoleSet.has(role))),
    })
  }

  function shouldApplyIsolatedCoreCleanup(role) {
    const normalizedRole = cleanText(role).toLowerCase()
    return normalizedRole !== 'breakup' && normalizedRole !== 'dissipation'
  }

  function referenceModeForAnchor(role) {
    const normalizedRole = cleanText(role).toLowerCase()
    if (!ANCHOR_ROLES.includes(normalizedRole)) {
      fail('AIFX_MORPHOLOGY_ANCHOR_INVALID', `Unsupported material anchor role: ${normalizedRole || '(empty)'}.`)
    }
    return normalizedRole === 'peak'
      ? 'full-material-morphology-reference'
      : 'generated-peak-material-token'
  }

  function seedForAnchorRole(sequenceSeed, role) {
    const normalizedRole = cleanText(role).toLowerCase()
    if (!ANCHOR_ROLES.includes(normalizedRole)) {
      fail('AIFX_MORPHOLOGY_ANCHOR_INVALID', `Unsupported material anchor role: ${normalizedRole || '(empty)'}.`)
    }
    const normalizedSeed = Math.max(0, Math.floor(finiteNumber(sequenceSeed))) % 2147483647
    return (normalizedSeed + ANCHOR_SEED_OFFSETS[normalizedRole]) % 2147483647
  }

  function modelStyleStrengthForAnchor(role, styleStrength) {
    const normalizedRole = cleanText(role).toLowerCase()
    if (!ANCHOR_ROLES.includes(normalizedRole)) {
      fail('AIFX_MORPHOLOGY_ANCHOR_INVALID', `Unsupported material anchor role: ${normalizedRole || '(empty)'}.`)
    }
    const requested = clamp(finiteNumber(styleStrength) / 100, 0, 1)
    return normalizedRole === 'peak' ? requested : Math.min(requested, 0.39)
  }

  function controlProfileForAnchor(role, baseProfile = {}, attempt = 1) {
    const normalizedRole = cleanText(role).toLowerCase()
    if (!ANCHOR_ROLES.includes(normalizedRole)) {
      fail('AIFX_MORPHOLOGY_ANCHOR_INVALID', `Unsupported material anchor role: ${normalizedRole || '(empty)'}.`)
    }
    const peak = normalizedRole === 'peak'
    const tail = normalizedRole === 'breakup' || normalizedRole === 'dissipation'
    const baseStrength = clamp(finiteNumber(baseProfile.strength, 0.62), 0, 1)
    const baseEndPercent = clamp(finiteNumber(baseProfile.endPercent, 0.72), 0.01, 1)
    const attemptNumber = Math.max(1, Math.min(3, Math.floor(finiteNumber(attempt, 1))))
    const cooling = (attemptNumber - 1) * 0.06
    const tailStrength = Number((normalizedRole === 'breakup'
      ? clamp(Math.max(baseStrength, 0.82) - cooling, 0.5, 0.9)
      : clamp(Math.max(baseStrength - 0.12, 0.62) - cooling, 0.34, 0.68)).toFixed(4))
    const tailEndPercent = Number((normalizedRole === 'breakup'
      ? clamp(Math.max(baseEndPercent, 0.82) - cooling, 0.46, 0.88)
      : clamp(Math.max(baseEndPercent - 0.3, 0.52) - cooling, 0.28, 0.58)).toFixed(4))
    const decay = normalizedRole === 'decay'
    const strength = tail
      ? tailStrength
      : clamp(Math.max(baseStrength, peak ? 0.9 : decay ? 0.96 : 0.9), 0, 1)
    const endPercent = tail
      ? tailEndPercent
      : clamp(Math.max(baseEndPercent, peak ? 0.98 : decay ? 1 : 0.96), 0.01, 1)
    return Object.freeze({
      strength,
      endPercent,
      role: normalizedRole,
      attempt: attemptNumber,
      mode: peak
        ? 'motion-control-after-early-material-reference'
        : tail
          ? 'annealed-motion-envelope-with-text-owned-tail-topology'
          : 'motion-control-with-semantic-peak-material-identity',
    })
  }

  function evaluateAnchorIsolation(metrics = {}, role = 'peak') {
    const normalizedRole = cleanText(role).toLowerCase()
    if (!ANCHOR_ROLES.includes(normalizedRole)) {
      fail('AIFX_MORPHOLOGY_ANCHOR_INVALID', `Unsupported material anchor role: ${normalizedRole || '(empty)'}.`)
    }
    const tail = normalizedRole === 'breakup' || normalizedRole === 'dissipation'
    const thresholds = Object.freeze({
      activeRatioMax: tail ? 0.5 : 0.62,
      borderActiveRatioMax: tail ? 0.24 : 0.3,
      borderMeanLumaMax: tail ? 0.07 : 0.09,
      cornerMeanLumaMax: 0.055,
    })
    const normalized = Object.freeze({
      activeRatio: clamp(finiteNumber(metrics.activeRatio), 0, 1),
      borderActiveRatio: clamp(finiteNumber(metrics.borderActiveRatio), 0, 1),
      borderMeanLuma: clamp(finiteNumber(metrics.borderMeanLuma), 0, 1),
      cornerMeanLuma: clamp(finiteNumber(metrics.cornerMeanLuma), 0, 1),
    })
    const failureChecks = [
      ['activeRatio', thresholds.activeRatioMax],
      ['borderActiveRatio', thresholds.borderActiveRatioMax],
      ['borderMeanLuma', thresholds.borderMeanLumaMax],
      ['cornerMeanLuma', thresholds.cornerMeanLumaMax],
    ]
    const failures = Object.freeze(failureChecks
      .filter(([key, threshold]) => normalized[key] > threshold)
      .map(([key, threshold]) => Object.freeze({ key, actual: normalized[key], maximum: threshold })))
    return Object.freeze({
      passed: failures.length === 0,
      code: failures.length ? 'AIFX_ANCHOR_NOT_ISOLATED' : 'AIFX_ANCHOR_ISOLATED',
      role: normalizedRole,
      metrics: normalized,
      thresholds,
      failures,
    })
  }

  function topologyCleanupResult(frame, details = {}) {
    return Object.freeze({
      frame,
      cleanup: Object.freeze({
        applied: false,
        state: 'preserved',
        method: 'generated-anchor-topology-preserved',
        source: 'ai-generated-anchor-pixels',
        templatePixelsUsed: false,
        templateMaskUsed: false,
        ...details,
      }),
    })
  }

  function refinedTopologyFrame(frame, canvas, cleanup) {
    return Object.freeze({
      frame: Object.freeze({
        ...frame,
        width: canvas.width,
        height: canvas.height,
        canvas,
        dataUrl: canvas.toDataURL('image/png'),
      }),
      cleanup: Object.freeze({
        applied: true,
        state: 'refined',
        source: 'ai-generated-anchor-pixels',
        templatePixelsUsed: false,
        templateMaskUsed: false,
        ...cleanup,
      }),
    })
  }

  function analyzeGeneratedAlphaComponents(data, width, height, alphaThreshold) {
    const pixelCount = width * height
    const labels = new Int32Array(pixelCount)
    labels.fill(-1)
    const queue = new Int32Array(pixelCount)
    const components = []
    const alphaByteThreshold = Math.round(clamp(alphaThreshold, 0, 1) * 255)
    const neighbors = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1],
    ]
    let activePixels = 0
    for (let start = 0; start < pixelCount; start += 1) {
      if (data[start * 4 + 3] >= alphaByteThreshold) activePixels += 1
      if (labels[start] !== -1 || data[start * 4 + 3] < alphaByteThreshold) continue
      const id = components.length
      let head = 0
      let tail = 0
      let area = 0
      let sumX = 0
      let sumY = 0
      labels[start] = id
      queue[tail++] = start
      while (head < tail) {
        const index = queue[head++]
        const x = index % width
        const y = Math.floor(index / width)
        area += 1
        sumX += x
        sumY += y
        for (const [dx, dy] of neighbors) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const next = ny * width + nx
          if (labels[next] !== -1 || data[next * 4 + 3] < alphaByteThreshold) continue
          labels[next] = id
          queue[tail++] = next
        }
      }
      components.push(Object.freeze({
        id,
        area,
        centerX: sumX / Math.max(1, area),
        centerY: sumY / Math.max(1, area),
      }))
    }
    return Object.freeze({ labels, components: Object.freeze(components), activePixels, alphaThreshold })
  }

  function generatedAlphaMaskRecordFromData(data, width, height, alphaThreshold = 0.05) {
    const pixelCount = width * height
    const mask = new Uint8Array(pixelCount)
    const alphaByteThreshold = Math.round(clamp(alphaThreshold, 0, 1) * 255)
    let areaPixels = 0
    let sumX = 0
    let sumY = 0
    for (let index = 0; index < pixelCount; index += 1) {
      if (data[index * 4 + 3] < alphaByteThreshold) continue
      mask[index] = 1
      areaPixels += 1
      sumX += index % width
      sumY += Math.floor(index / width)
    }
    return Object.freeze({
      width,
      height,
      mask,
      areaPixels,
      centroid: areaPixels > 0
        ? Object.freeze({ x: sumX / areaPixels, y: sumY / areaPixels })
        : null,
    })
  }

  function generatedAlphaMaskRecordFromFrame(frame, alphaThreshold = 0.05) {
    const canvas = frame?.canvas
    if (!canvas?.getContext) return null
    const width = Math.max(1, Math.round(Number(frame.width || canvas.width) || 1))
    const height = Math.max(1, Math.round(Number(frame.height || canvas.height) || 1))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const image = context.getImageData(0, 0, width, height)
    return generatedAlphaMaskRecordFromData(image.data, width, height, alphaThreshold)
  }

  function selectedGeneratedComponentMask(labels, selectedIds, width, height) {
    const pixelCount = width * height
    const mask = new Uint8Array(pixelCount)
    let areaPixels = 0
    let sumX = 0
    let sumY = 0
    for (let index = 0; index < pixelCount; index += 1) {
      if (!selectedIds.has(labels[index])) continue
      mask[index] = 1
      areaPixels += 1
      sumX += index % width
      sumY += Math.floor(index / width)
    }
    return Object.freeze({
      width,
      height,
      mask,
      areaPixels,
      centroid: areaPixels > 0
        ? Object.freeze({ x: sumX / areaPixels, y: sumY / areaPixels })
        : null,
    })
  }

  function centroidAndUniformScaleGeneratedIou(reference, candidate) {
    if (
      !reference?.centroid
      || !candidate?.centroid
      || reference.width !== candidate.width
      || reference.height !== candidate.height
      || reference.areaPixels <= 0
      || candidate.areaPixels <= 0
    ) return 1
    const scale = Math.sqrt(reference.areaPixels / candidate.areaPixels)
    let intersection = 0
    let union = 0
    for (let y = 0; y < reference.height; y += 1) {
      const sourceY = Math.round(candidate.centroid.y + (y - reference.centroid.y) / scale)
      for (let x = 0; x < reference.width; x += 1) {
        const sourceX = Math.round(candidate.centroid.x + (x - reference.centroid.x) / scale)
        const left = reference.mask[y * reference.width + x]
        const right = sourceX >= 0
          && sourceX < candidate.width
          && sourceY >= 0
          && sourceY < candidate.height
          ? candidate.mask[sourceY * candidate.width + sourceX]
          : 0
        if (left && right) intersection += 1
        if (left || right) union += 1
      }
    }
    return union > 0 ? intersection / union : 1
  }

  function severGeneratedLightningHub(frame, dependencies = {}, options = {}) {
    const createCanvas = requiredFunction(dependencies, 'createCanvas')
    const phase = cleanText(options.phase) || 'decay'
    const failureCode = cleanText(options.failureCode) || 'AIFX_MORPHOLOGY_DECAY_TOPOLOGY_UNRESOLVED'
    const method = cleanText(options.method) || 'generated-lightning-decay-soft-hub-sever'
    const sourceCanvas = frame?.canvas
    if (!sourceCanvas?.getContext) {
      fail('AIFX_MORPHOLOGY_FRAME_INVALID', 'Generated lightning decay cleanup requires a decoded AI anchor canvas.')
    }
    const width = Math.max(1, Math.round(Number(frame.width || sourceCanvas.width) || 1))
    const height = Math.max(1, Math.round(Number(frame.height || sourceCanvas.height) || 1))
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.clearRect(0, 0, width, height)
    context.drawImage(sourceCanvas, 0, 0, width, height)
    const image = context.getImageData(0, 0, width, height)
    const pixelCount = width * height
    const integralWidth = width + 1
    const integral = new Float64Array((width + 1) * (height + 1))
    let beforeAlphaMass = 0
    let beforeActivePixels = 0
    let totalWeightedMass = 0
    let weightedX = 0
    let weightedY = 0
    let activeMinX = width
    let activeMinY = height
    let activeMaxX = -1
    let activeMaxY = -1
    for (let y = 0; y < height; y += 1) {
      let rowMass = 0
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        const alpha = image.data[offset + 3] / 255
        const luminance = (
          image.data[offset] * 0.2126
          + image.data[offset + 1] * 0.7152
          + image.data[offset + 2] * 0.0722
        ) / 255
        const weightedMass = alpha * (0.25 + luminance * 0.75)
        beforeAlphaMass += alpha
        if (alpha >= 0.04) {
          beforeActivePixels += 1
          activeMinX = Math.min(activeMinX, x)
          activeMinY = Math.min(activeMinY, y)
          activeMaxX = Math.max(activeMaxX, x)
          activeMaxY = Math.max(activeMaxY, y)
        }
        totalWeightedMass += weightedMass
        weightedX += x * weightedMass
        weightedY += y * weightedMass
        rowMass += weightedMass
        integral[(y + 1) * integralWidth + x + 1] = integral[y * integralWidth + x + 1] + rowMass
      }
    }
    if (beforeActivePixels < Math.max(48, Math.round(pixelCount * 0.0005)) || totalWeightedMass <= 1e-6) {
      fail(
        failureCode,
        `Generated lightning ${phase} is too sparse to reconstruct a readable dismantled body.`,
        { beforeActivePixels, templatePixelsUsed: false, templateMaskUsed: false },
      )
    }

    const minimumDimension = Math.min(width, height)
    const minimumPieceArea = Math.max(16, Math.round(pixelCount * 0.0002))
    const originalTopology = analyzeGeneratedAlphaComponents(image.data, width, height, 0.05)
    const originalMeaningfulPieces = originalTopology.components
      .filter((entry) => entry.area >= minimumPieceArea)
      .sort((left, right) => right.area - left.area || left.id - right.id)
    const originalMeaningfulPixels = originalMeaningfulPieces.reduce((sum, entry) => sum + entry.area, 0)
    const originalLargestFraction = (originalMeaningfulPieces[0]?.area || 0) / Math.max(1, originalMeaningfulPixels)
    const originalSecondFraction = (originalMeaningfulPieces[1]?.area || 0) / Math.max(1, originalMeaningfulPixels)
    if (
      originalMeaningfulPieces.length >= 2
      && originalLargestFraction <= 0.92
      && originalSecondFraction >= 0.04
    ) {
      return topologyCleanupResult(frame, {
        state: 'already-compliant',
        reason: `generated-${phase}-already-has-balanced-detached-topology`,
        componentCount: originalTopology.components.length,
        meaningfulComponentCount: originalMeaningfulPieces.length,
        largestComponentFraction: originalLargestFraction,
        secondComponentFraction: originalSecondFraction,
      })
    }
    const searchRadius = Math.max(3, Math.round(minimumDimension * 0.06))
    const scanStep = minimumDimension < 96 ? 2 : 4
    let hubX = -1
    let hubY = -1
    let hubScore = -1
    let hubWindowArea = 1
    for (let y = 0; y < height; y += scanStep) {
      for (let x = 0; x < width; x += scanStep) {
        const offset = (y * width + x) * 4
        if (image.data[offset + 3] < 51) continue
        const x0 = Math.max(0, x - searchRadius)
        const y0 = Math.max(0, y - searchRadius)
        const x1 = Math.min(width, x + searchRadius + 1)
        const y1 = Math.min(height, y + searchRadius + 1)
        const score = integral[y1 * integralWidth + x1]
          - integral[y0 * integralWidth + x1]
          - integral[y1 * integralWidth + x0]
          + integral[y0 * integralWidth + x0]
        if (score > hubScore) {
          hubScore = score
          hubX = x
          hubY = y
          hubWindowArea = Math.max(1, (x1 - x0) * (y1 - y0))
        }
      }
    }
    if (hubX < 0) {
      fail(
        failureCode,
        `Generated lightning ${phase} has no readable hub or detached topology.`,
        { templatePixelsUsed: false, templateMaskUsed: false },
      )
    }

    const innerRadius = Math.max(3, minimumDimension * clamp(finiteNumber(options.innerRadiusRatio, 0.12), 0.06, 0.24))
    const outerRadius = Math.max(
      innerRadius + 2,
      minimumDimension * clamp(finiteNumber(options.outerRadiusRatio, 0.22), 0.1, 0.34),
    )
    let afterAlphaMass = 0
    let afterActivePixels = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        const distance = Math.hypot(x - hubX, y - hubY)
        let retain = 1
        if (distance <= innerRadius) {
          retain = 0
        } else if (distance < outerRadius) {
          const linear = (distance - innerRadius) / (outerRadius - innerRadius)
          retain = linear * linear * (3 - 2 * linear)
        }
        if (retain < 1) {
          image.data[offset] = Math.round(image.data[offset] * retain)
          image.data[offset + 1] = Math.round(image.data[offset + 1] * retain)
          image.data[offset + 2] = Math.round(image.data[offset + 2] * retain)
          image.data[offset + 3] = Math.round(image.data[offset + 3] * retain)
        }
        const alpha = image.data[offset + 3] / 255
        afterAlphaMass += alpha
        if (alpha >= 0.04) afterActivePixels += 1
      }
    }
    let removedAlphaRatio = (beforeAlphaMass - afterAlphaMass) / Math.max(1e-6, beforeAlphaMass)
    let retainedActiveRatio = afterActivePixels / Math.max(1, beforeActivePixels)
    if (removedAlphaRatio < 0.07 || removedAlphaRatio > 0.55 || retainedActiveRatio < 0.25) {
      fail(
        failureCode,
        `Generated lightning ${phase} could not be safely separated into a dismantled topology.`,
        { removedAlphaRatio, retainedActiveRatio, templatePixelsUsed: false, templateMaskUsed: false },
      )
    }
    let separated = analyzeGeneratedAlphaComponents(image.data, width, height, 0.05)
    let meaningfulPieces = separated.components
      .filter((entry) => entry.area >= minimumPieceArea)
      .sort((left, right) => right.area - left.area || left.id - right.id)
    let meaningfulPixels = meaningfulPieces.reduce((sum, entry) => sum + entry.area, 0)
    let largestComponentFraction = (meaningfulPieces[0]?.area || 0) / Math.max(1, meaningfulPixels)
    let secondComponentFraction = (meaningfulPieces[1]?.area || 0) / Math.max(1, meaningfulPixels)
    let axisBandApplied = false
    let bandAxis = ''
    let bandCenterX = weightedX / Math.max(1e-8, totalWeightedMass)
    let bandCenterY = weightedY / Math.max(1e-8, totalWeightedMass)
    const topologyIsBalanced = () => (
      meaningfulPieces.length >= 2
      && largestComponentFraction <= 0.92
      && secondComponentFraction >= 0.04
    )
    if (!topologyIsBalanced()) {
      const activeWidth = Math.max(1, activeMaxX - activeMinX + 1)
      const activeHeight = Math.max(1, activeMaxY - activeMinY + 1)
      const primaryAxis = activeWidth >= activeHeight ? 'vertical' : 'horizontal'
      const bandCorePixels = Math.max(2, Math.round(minimumDimension * 0.012))
      const bandFeatherPixels = Math.max(1, Math.round(minimumDimension * 0.006))
      const severAlong = (axis) => {
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const distance = axis === 'vertical'
              ? Math.abs(x - bandCenterX)
              : Math.abs(y - bandCenterY)
            if (distance >= bandCorePixels + bandFeatherPixels) continue
            const offset = (y * width + x) * 4
            const retain = distance <= bandCorePixels
              ? 0
              : (distance - bandCorePixels) / bandFeatherPixels
            image.data[offset] = Math.round(image.data[offset] * retain)
            image.data[offset + 1] = Math.round(image.data[offset + 1] * retain)
            image.data[offset + 2] = Math.round(image.data[offset + 2] * retain)
            image.data[offset + 3] = Math.round(image.data[offset + 3] * retain)
          }
        }
      }
      severAlong(primaryAxis)
      if (options.crossBand === true) severAlong(primaryAxis === 'vertical' ? 'horizontal' : 'vertical')
      axisBandApplied = true
      bandAxis = options.crossBand === true ? 'cross' : primaryAxis
      afterAlphaMass = 0
      afterActivePixels = 0
      for (let offset = 0; offset < image.data.length; offset += 4) {
        const alpha = image.data[offset + 3] / 255
        afterAlphaMass += alpha
        if (alpha >= 0.04) afterActivePixels += 1
      }
      removedAlphaRatio = (beforeAlphaMass - afterAlphaMass) / Math.max(1e-6, beforeAlphaMass)
      retainedActiveRatio = afterActivePixels / Math.max(1, beforeActivePixels)
      separated = analyzeGeneratedAlphaComponents(image.data, width, height, 0.05)
      meaningfulPieces = separated.components
        .filter((entry) => entry.area >= minimumPieceArea)
        .sort((left, right) => right.area - left.area || left.id - right.id)
      meaningfulPixels = meaningfulPieces.reduce((sum, entry) => sum + entry.area, 0)
      largestComponentFraction = (meaningfulPieces[0]?.area || 0) / Math.max(1, meaningfulPixels)
      secondComponentFraction = (meaningfulPieces[1]?.area || 0) / Math.max(1, meaningfulPixels)
    }
    if (
      !topologyIsBalanced()
      || removedAlphaRatio > 0.6
      || retainedActiveRatio < 0.22
    ) {
      fail(
        failureCode,
        `Generated lightning ${phase} retained one dominant connected body after separation.`,
        {
          componentCount: separated.components.length,
          meaningfulComponentCount: meaningfulPieces.length,
          minimumPieceArea,
          largestComponentFraction,
          secondComponentFraction,
          axisBandApplied,
          bandAxis,
          removedAlphaRatio,
          retainedActiveRatio,
          templatePixelsUsed: false,
          templateMaskUsed: false,
        },
      )
    }
    context.putImageData(image, 0, 0)
    return refinedTopologyFrame(frame, canvas, {
      method,
      hub: Object.freeze({ x: hubX, y: hubY }),
      searchRadius,
      hubDensityRatio: (hubScore / hubWindowArea) / Math.max(1e-8, totalWeightedMass / pixelCount),
      innerRadius,
      outerRadius,
      removedAlphaRatio,
      retainedActiveRatio,
      componentCount: separated.components.length,
      meaningfulComponentCount: meaningfulPieces.length,
      largestComponentFraction,
      secondComponentFraction,
      axisBandApplied,
      bandAxis,
      bandCenterX,
      bandCenterY,
    })
  }

  function extractGeneratedLightningResidue(frame, dependencies = {}, options = {}) {
    const createCanvas = requiredFunction(dependencies, 'createCanvas')
    const phase = cleanText(options.phase) || 'dissipation'
    const failureCode = cleanText(options.failureCode) || 'AIFX_MORPHOLOGY_DISSIPATION_TOPOLOGY_UNRESOLVED'
    const selectionMethod = cleanText(options.selectionMethod) || 'generated-lightning-dissipation-residue-selection'
    const minimumResidueCount = Math.max(2, Math.min(12, Math.round(finiteNumber(options.minimumResidueCount, 5))))
    const maximumResidueCount = Math.max(
      minimumResidueCount,
      Math.min(16, Math.round(finiteNumber(options.maximumResidueCount, 12))),
    )
    const hubSeparated = severGeneratedLightningHub(frame, dependencies, {
      phase,
      failureCode,
      method: cleanText(options.hubMethod) || `generated-lightning-${phase}-soft-hub-sever`,
      innerRadiusRatio: finiteNumber(options.innerRadiusRatio, 0.22),
      outerRadiusRatio: finiteNumber(options.outerRadiusRatio, 0.3),
      crossBand: options.crossBand !== false,
    })
    const sourceFrame = hubSeparated.frame
    const sourceCanvas = sourceFrame?.canvas
    if (!sourceCanvas?.getContext) {
      fail('AIFX_MORPHOLOGY_FRAME_INVALID', 'Generated lightning dissipation cleanup requires a decoded AI anchor canvas.')
    }
    const width = Math.max(1, Math.round(Number(frame.width || sourceCanvas.width) || 1))
    const height = Math.max(1, Math.round(Number(frame.height || sourceCanvas.height) || 1))
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.clearRect(0, 0, width, height)
    context.drawImage(sourceCanvas, 0, 0, width, height)
    const image = context.getImageData(0, 0, width, height)
    const pixelCount = width * height
    const alphaThreshold = 0.05
    const analyzed = analyzeGeneratedAlphaComponents(image.data, width, height, alphaThreshold)
    const labels = analyzed.labels
    const components = analyzed.components
    const beforeActivePixels = analyzed.activePixels
    if (components.length < minimumResidueCount) {
      fail(
        failureCode,
        `Generated lightning ${phase} does not contain enough detached material pieces.`,
        { componentCount: components.length, templatePixelsUsed: false, templateMaskUsed: false },
      )
    }
    const main = components.reduce((best, entry) => entry.area > best.area ? entry : best, components[0])
    const totalComponentPixels = components.reduce((sum, entry) => sum + entry.area, 0)
    const mainFraction = main.area / Math.max(1, totalComponentPixels)
    const minimumResidueArea = Math.max(12, Math.round(pixelCount * 0.00004))
    const meaningfulComponents = components
      .filter((entry) => entry.area >= minimumResidueArea)
      .sort((left, right) => right.area - left.area || left.id - right.id)
    const allBalancedSelections = []
    const maximumPrefixSkip = Math.max(0, meaningfulComponents.length - minimumResidueCount)
    for (let skip = 0; skip <= maximumPrefixSkip; skip += 1) {
      const maximumCount = Math.min(maximumResidueCount, meaningfulComponents.length - skip)
      for (let count = maximumCount; count >= minimumResidueCount; count -= 1) {
        const selected = meaningfulComponents.slice(skip, skip + count)
        const selectedPixels = selected.reduce((sum, entry) => sum + entry.area, 0)
        const largestFraction = (selected[0]?.area || 0) / Math.max(1, selectedPixels)
        if (largestFraction <= 0.6) {
          allBalancedSelections.push(Object.freeze({ selected, skip, count, largestFraction, selectedPixels }))
        }
      }
    }
    let balancedSelection = allBalancedSelections[0] || null
    if (!balancedSelection) {
      fail(
        failureCode,
        `Generated lightning ${phase} does not contain a balanced generated-only residue selection.`,
        {
          componentCount: components.length,
          meaningfulResidueCount: meaningfulComponents.length,
          minimumResidueArea,
          mainFraction,
          templatePixelsUsed: false,
          templateMaskUsed: false,
        },
      )
    }
    const comparisonRecord = generatedAlphaMaskRecordFromFrame(options.comparisonFrame, alphaThreshold)
    const identityRecord = generatedAlphaMaskRecordFromFrame(options.identityFrame, alphaThreshold)
    const transitionTarget = clamp(finiteNumber(options.transitionTarget, 0.26), 0.05, 0.3)
    const minimumIdentityIou = clamp(finiteNumber(options.minimumIdentityIou, 0.24), 0.05, 0.9)
    const maximumScoredSelections = 64
    const scoringSelections = allBalancedSelections.length <= maximumScoredSelections
      ? allBalancedSelections
      : Array.from({ length: maximumScoredSelections }, (_, index) => (
          allBalancedSelections[Math.round(index * (allBalancedSelections.length - 1) / (maximumScoredSelections - 1))]
        ))
    let baselineTransitionIou = null
    let selectedTransitionIou = null
    let selectedIdentityIou = null
    let minimumComparisonCandidatePixels = 0
    if (
      comparisonRecord?.areaPixels > 0
      && comparisonRecord.width === width
      && comparisonRecord.height === height
    ) {
      minimumComparisonCandidatePixels = Math.max(24, Math.round(balancedSelection.selectedPixels * 0.7))
      const scoredSelections = []
      for (const selection of scoringSelections) {
        if (selection.selectedPixels < minimumComparisonCandidatePixels) continue
        const selectionIds = new Set(selection.selected.map((entry) => entry.id))
        const selectionRecord = selectedGeneratedComponentMask(labels, selectionIds, width, height)
        const transitionIou = centroidAndUniformScaleGeneratedIou(comparisonRecord, selectionRecord)
        const identityIou = identityRecord?.areaPixels > 0
          && identityRecord.width === width
          && identityRecord.height === height
          ? centroidAndUniformScaleGeneratedIou(identityRecord, selectionRecord)
          : null
        if (selection === allBalancedSelections[0]) baselineTransitionIou = transitionIou
        if (identityIou !== null && identityIou < minimumIdentityIou) continue
        scoredSelections.push(Object.freeze({ selection, transitionIou, identityIou }))
      }
      const targetSelections = scoredSelections.filter((entry) => entry.transitionIou <= transitionTarget)
      const rankedSelections = (targetSelections.length ? targetSelections : scoredSelections).sort((left, right) => (
        targetSelections.length
          ? right.selection.selectedPixels - left.selection.selectedPixels
            || left.transitionIou - right.transitionIou
          : left.transitionIou - right.transitionIou
            || right.selection.selectedPixels - left.selection.selectedPixels
      ) || left.selection.skip - right.selection.skip || right.selection.count - left.selection.count)
      const selected = rankedSelections[0] || null
      if (selected) {
        balancedSelection = selected.selection
        selectedTransitionIou = selected.transitionIou
        selectedIdentityIou = selected.identityIou
      }
    }
    const selectedResidues = balancedSelection.selected
    const discardedDominantResidues = meaningfulComponents.slice(0, balancedSelection.skip)
    const discardedDominantPixels = discardedDominantResidues.reduce((sum, entry) => sum + entry.area, 0)
    const dominantMain = discardedDominantResidues.some((entry) => entry.id === main.id)

    const selectedIds = new Set(selectedResidues.map((entry) => entry.id))
    const retained = new Uint8Array(pixelCount)
    for (let index = 0; index < pixelCount; index += 1) {
      if (selectedIds.has(labels[index])) retained[index] = 1
    }
    const coreRetained = retained.slice()
    const dilationPixels = Math.max(0, Math.min(2, Math.round(finiteNumber(options.dilationPixels, 2))))
    for (let index = 0; index < pixelCount; index += 1) {
      if (!coreRetained[index]) continue
      const x = index % width
      const y = Math.floor(index / width)
      for (let dy = -dilationPixels; dy <= dilationPixels; dy += 1) {
        for (let dx = -dilationPixels; dx <= dilationPixels; dx += 1) {
          if (dx * dx + dy * dy > dilationPixels * dilationPixels) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          retained[ny * width + nx] = 1
        }
      }
    }
    const alphaByteThreshold = Math.round(alphaThreshold * 255)
    let afterActivePixels = 0
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4
      if (!retained[index]) {
        image.data[offset] = 0
        image.data[offset + 1] = 0
        image.data[offset + 2] = 0
        image.data[offset + 3] = 0
      }
      if (image.data[offset + 3] >= alphaByteThreshold) afterActivePixels += 1
    }
    const retainedActiveRatio = afterActivePixels / Math.max(1, beforeActivePixels)
    const postSelection = analyzeGeneratedAlphaComponents(image.data, width, height, alphaThreshold)
    const readablePostResidues = postSelection.components.filter((entry) => entry.area >= minimumResidueArea)
    const largestPostResidue = readablePostResidues.reduce((largest, entry) => Math.max(largest, entry.area), 0)
    const readablePostPixels = readablePostResidues.reduce((sum, entry) => sum + entry.area, 0)
    const largestPostFraction = largestPostResidue / Math.max(1, readablePostPixels)
    if (
      afterActivePixels < 24
      || readablePostResidues.length < minimumResidueCount
      || readablePostResidues.length > maximumResidueCount
      || largestPostFraction > 0.6
    ) {
      fail(
        failureCode,
        `Generated lightning ${phase} selection did not preserve ${minimumResidueCount} to ${maximumResidueCount} balanced detached pieces.`,
        {
          componentCount: components.length,
          selectedResidueCount: selectedResidues.length,
          readablePostResidueCount: readablePostResidues.length,
          largestPostFraction,
          retainedActiveRatio,
          templatePixelsUsed: false,
          templateMaskUsed: false,
        },
      )
    }
    context.putImageData(image, 0, 0)
    return refinedTopologyFrame(sourceFrame, canvas, {
      method: selectionMethod,
      hubSever: hubSeparated.cleanup,
      phase,
      minimumResidueCount,
      maximumResidueCount,
      alphaThreshold,
      componentCountBefore: components.length,
      dominantMainRemoved: dominantMain,
      removedMainPixels: dominantMain ? main.area : 0,
      discardedDominantCount: discardedDominantResidues.length,
      discardedDominantIds: Object.freeze(discardedDominantResidues.map((entry) => entry.id)),
      discardedDominantPixels,
      mainFraction,
      dilationPixels,
      selectionSkip: balancedSelection.skip,
      selectedComponentIds: Object.freeze(selectedResidues.map((entry) => entry.id)),
      selectionCandidateCount: allBalancedSelections.length,
      scoredSelectionCount: scoringSelections.length,
      comparisonGeneratedOnly: selectedTransitionIou !== null,
      comparisonRole: selectedTransitionIou !== null ? cleanText(options.comparisonRole) || 'previous-generated-anchor' : '',
      baselineTransitionIou,
      selectedTransitionIou,
      comparisonIou: selectedTransitionIou,
      selectedIdentityIou,
      minimumIdentityIou: identityRecord?.areaPixels > 0 ? minimumIdentityIou : null,
      transitionTarget,
      minimumComparisonCandidatePixels,
      retainedPixelsComparedToBaseline: balancedSelection.selectedPixels / Math.max(1, allBalancedSelections[0].selectedPixels),
      selectedResidueCount: selectedResidues.length,
      readablePostResidueCount: readablePostResidues.length,
      largestPostFraction,
      retainedActiveRatio,
    })
  }

  function refineGeneratedAnchorTopology(frame, options = {}, dependencies = {}) {
    const role = cleanText(options.role).toLowerCase()
    const materialType = cleanText(options.materialType).toLowerCase()
    if (materialType !== 'lightning') {
      return topologyCleanupResult(frame, { reason: 'material-does-not-require-generated-topology-refinement' })
    }
    if (role === 'decay') return severGeneratedLightningHub(frame, dependencies)
    if (role === 'breakup') {
      return extractGeneratedLightningResidue(frame, dependencies, {
        phase: 'breakup',
        failureCode: 'AIFX_MORPHOLOGY_BREAKUP_TOPOLOGY_UNRESOLVED',
        selectionMethod: 'generated-lightning-breakup-fragment-selection',
        hubMethod: 'generated-lightning-breakup-soft-hub-sever',
        innerRadiusRatio: 0.14,
        outerRadiusRatio: 0.24,
        crossBand: true,
        minimumResidueCount: 4,
        maximumResidueCount: 10,
        dilationPixels: 0,
        comparisonFrame: options.comparisonFrame,
        comparisonRole: options.comparisonRole,
        identityFrame: options.identityFrame,
      })
    }
    if (role === 'dissipation') {
      return extractGeneratedLightningResidue(frame, dependencies, {
        dilationPixels: 0,
        comparisonFrame: options.comparisonFrame,
        comparisonRole: options.comparisonRole,
        identityFrame: options.identityFrame,
      })
    }
    return topologyCleanupResult(frame, { reason: 'anchor-role-preserves-generated-topology' })
  }

  function requiredFunction(dependencies, name) {
    const candidate = dependencies?.[name]
    if (typeof candidate !== 'function') {
      fail('AIFX_MORPHOLOGY_DEPENDENCY_MISSING', `Material morphology dependency ${name} is required.`)
    }
    return candidate
  }

  function analyzeRawAnchorIsolation(image, dependencies = {}) {
    const createCanvas = requiredFunction(dependencies, 'createCanvas')
    const width = Math.max(1, Math.round(Number(image?.naturalWidth || image?.width) || 1))
    const height = Math.max(1, Math.round(Number(image?.naturalHeight || image?.height) || 1))
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0, width, height)
    const data = context.getImageData(0, 0, width, height).data
    const borderWidth = Math.max(4, Math.round(Math.min(width, height) * 0.06))
    const cornerWidth = Math.max(6, Math.round(width * 0.15))
    const cornerHeight = Math.max(6, Math.round(height * 0.15))
    let activePixels = 0
    let borderPixels = 0
    let borderActivePixels = 0
    let borderLuminance = 0
    let cornerPixels = 0
    let cornerLuminance = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        const pixelLuminance = (
          data[offset] * 0.2126
          + data[offset + 1] * 0.7152
          + data[offset + 2] * 0.0722
        ) / 255
        if (pixelLuminance > 0.04) activePixels += 1
        const border = x < borderWidth || y < borderWidth || x >= width - borderWidth || y >= height - borderWidth
        if (border) {
          borderPixels += 1
          borderLuminance += pixelLuminance
          if (pixelLuminance > 0.04) borderActivePixels += 1
        }
        const corner = (x < cornerWidth || x >= width - cornerWidth)
          && (y < cornerHeight || y >= height - cornerHeight)
        if (corner) {
          cornerPixels += 1
          cornerLuminance += pixelLuminance
        }
      }
    }
    return Object.freeze({
      activeRatio: activePixels / Math.max(1, width * height),
      borderActiveRatio: borderActivePixels / Math.max(1, borderPixels),
      borderMeanLuma: borderLuminance / Math.max(1, borderPixels),
      cornerMeanLuma: cornerLuminance / Math.max(1, cornerPixels),
    })
  }

  async function prepareAnchorGuide(options = {}, dependencies = {}) {
    const templateResource = dependencies.templateResource
    if (
      !templateResource
      || typeof templateResource.createSpriteSheetPlan !== 'function'
      || typeof templateResource.packFrames !== 'function'
    ) {
      fail('AIFX_MORPHOLOGY_DEPENDENCY_MISSING', 'Material morphology template resource is required.')
    }
    const createCanvas = requiredFunction(dependencies, 'createCanvas')
    const assertSheetBudget = requiredFunction(dependencies, 'assertSheetBudget')
    const motionGuideFrame = options.motionGuideFrame
    const guideWidth = Math.max(1, Math.round(Number(motionGuideFrame?.width) || 1))
    const guideHeight = Math.max(1, Math.round(Number(motionGuideFrame?.height) || 1))
    const sourceCanvas = createCanvas(guideWidth, guideHeight)
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
    sourceContext.drawImage(motionGuideFrame?.canvas || motionGuideFrame?.image, 0, 0, guideWidth, guideHeight)
    const sourcePixels = sourceContext.getImageData(0, 0, guideWidth, guideHeight).data
    const lumaHistogram = new Uint32Array(256)
    let visiblePixelCount = 0
    let minimumX = guideWidth
    let minimumY = guideHeight
    let maximumX = -1
    let maximumY = -1
    for (let y = 0; y < guideHeight; y += 1) {
      for (let x = 0; x < guideWidth; x += 1) {
        const offset = (y * guideWidth + x) * 4
        const luma = Math.round(sourcePixels[offset] * 0.2126 + sourcePixels[offset + 1] * 0.7152 + sourcePixels[offset + 2] * 0.0722)
        if (luma <= 0) continue
        visiblePixelCount += 1
        lumaHistogram[luma] += 1
        minimumX = Math.min(minimumX, x)
        minimumY = Math.min(minimumY, y)
        maximumX = Math.max(maximumX, x)
        maximumY = Math.max(maximumY, y)
      }
    }
    let lumaP90 = 0
    if (visiblePixelCount > 0) {
      const percentileTarget = Math.ceil(visiblePixelCount * 0.9)
      let cumulative = 0
      for (let luma = 1; luma < lumaHistogram.length; luma += 1) {
        cumulative += lumaHistogram[luma]
        if (cumulative >= percentileTarget) {
          lumaP90 = luma
          break
        }
      }
    }
    const readability = createReadableGuidePlan({
      role: options.role,
      width: guideWidth,
      height: guideHeight,
      bounds: visiblePixelCount > 0
        ? { x: minimumX, y: minimumY, width: maximumX - minimumX + 1, height: maximumY - minimumY + 1 }
        : null,
      lumaP90,
    })
    const safeCanvas = createCanvas(guideWidth, guideHeight)
    const safeContext = safeCanvas.getContext('2d')
    safeContext.fillStyle = 'rgb(0,0,0)'
    safeContext.fillRect(0, 0, guideWidth, guideHeight)
    safeContext.imageSmoothingEnabled = true
    safeContext.imageSmoothingQuality = 'high'
    if (readability.readabilityApplied) {
      safeContext.save()
      safeContext.translate(readability.centerX, readability.centerY)
      safeContext.scale(readability.scale, readability.scale)
      safeContext.drawImage(sourceCanvas, -readability.centerX, -readability.centerY)
      safeContext.restore()
    } else {
      const safeWidth = Math.max(1, Math.round(guideWidth * readability.scale))
      const safeHeight = Math.max(1, Math.round(guideHeight * readability.scale))
      const safeX = Math.round((guideWidth - safeWidth) * 0.5)
      const safeY = Math.round((guideHeight - safeHeight) * 0.5)
      safeContext.drawImage(sourceCanvas, safeX, safeY, safeWidth, safeHeight)
    }
    if (readability.lumaGain > 1.001) {
      const normalizedPixels = safeContext.getImageData(0, 0, guideWidth, guideHeight)
      for (let offset = 0; offset < normalizedPixels.data.length; offset += 4) {
        normalizedPixels.data[offset] = Math.min(255, Math.round(normalizedPixels.data[offset] * readability.lumaGain))
        normalizedPixels.data[offset + 1] = Math.min(255, Math.round(normalizedPixels.data[offset + 1] * readability.lumaGain))
        normalizedPixels.data[offset + 2] = Math.min(255, Math.round(normalizedPixels.data[offset + 2] * readability.lumaGain))
      }
      safeContext.putImageData(normalizedPixels, 0, 0)
    }
    const localGuideFrame = {
      ...motionGuideFrame,
      index: 0,
      sequenceNumber: 0,
      name: 'frame_000.png',
      width: guideWidth,
      height: guideHeight,
      canvas: safeCanvas,
      image: safeCanvas,
    }
    const plan = templateResource.createSpriteSheetPlan([localGuideFrame], {
      columns: 1,
      gutter: 0,
      padding: 0,
      alignTo: 16,
      fps: options.fps,
      lifecycle: { mode: 'one-shot', startFrame: 0, endFrame: 0, peakFrame: 0 },
    })
    assertSheetBudget(plan.sheetSize)
    const packed = await templateResource.packFrames([localGuideFrame], { plan, background: 'black' })
    return Object.freeze({ ...packed, plan, readability })
  }

  function normalizeReference(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail('AIFX_MORPHOLOGY_REFERENCE_REQUIRED', 'A complete material reference image is required.')
    }
    const dataUrl = cleanText(value.dataUrl)
    if (!/^data:image\/(?:png|jpeg|jpg|webp)(?:;[^,]*)?,/i.test(dataUrl)) {
      fail('AIFX_MORPHOLOGY_REFERENCE_REQUIRED', 'The material reference must be an image data URL.')
    }
    return Object.freeze({
      name: cleanText(value.name || value.fileName) || 'aifx_full_material_reference.png',
      dataUrl,
      width: Math.max(1, Math.round(finiteNumber(value.width, 1))),
      height: Math.max(1, Math.round(finiteNumber(value.height, 1))),
      role: 'full-material-morphology-reference',
      fullReferenceImageSent: true,
      macroLayoutAvailableToModel: true,
    })
  }

  function normalizeAnchorSpec(value, sequencePlan) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail('AIFX_MORPHOLOGY_ANCHOR_INVALID', 'Every material anchor specification must be an object.')
    }
    const role = cleanText(value.role).toLowerCase()
    if (!ANCHOR_ROLES.includes(role)) {
      fail('AIFX_MORPHOLOGY_ANCHOR_INVALID', `Unsupported material anchor role: ${role || '(empty)'}.`)
    }
    const globalIndex = Number(value.globalIndex ?? value.plan?.index)
    if (!Number.isInteger(globalIndex) || globalIndex < 0 || globalIndex >= sequencePlan.length) {
      fail('AIFX_MORPHOLOGY_ANCHOR_INVALID', `The ${role} anchor has an invalid globalIndex.`, { globalIndex })
    }
    const plan = Object.freeze({
      ...sequencePlan[globalIndex],
      ...(value.plan && typeof value.plan === 'object' ? value.plan : {}),
      index: globalIndex,
      globalIndex,
      phase: role,
    })
    return Object.freeze({ role, globalIndex, plan })
  }

  function buildReferenceContract(options = {}) {
    const source = options.materialOnly && typeof options.materialOnly === 'object' ? options.materialOnly : {}
    const materialStatistics = cleanText(source.positivePrompt)
      .replace('Read image2 only as spatially scrambled local material statistics.', '')
      .trim()
    const positivePrompt = [
      materialStatistics,
      'Use the complete image2 reference to infer material-specific silhouette behavior, internal topology, layer hierarchy, edge breakup, glow structure, and particle language.',
      'Do not reuse the reference pose, direction, composition, or macro layout.',
      'Recompose those local material rules around the motion guide\'s coarse trajectory, turning gesture, supplied direction, occupied-area envelope, and lifecycle state.',
      'The target remains recognizable through shape, grayscale structure, and color hierarchy.',
    ].filter(Boolean).join(' ')
    const sourceTags = Array.isArray(source.styleTags) ? source.styleTags : []
    const styleTags = Object.freeze([
      ...sourceTags.filter((tag) => tag !== 'material-only reference'
        && tag !== 'local material statistics'
        && tag !== 'reference composition excluded'),
      'full material morphology reference',
      'material-specific silhouette reconstruction',
      'reference-derived local topology',
    ])
    return Object.freeze({
      positivePrompt,
      styleDescription: styleTags.join(', '),
      styleTags,
      styleReferenceRole: 'full-material-morphology-reference',
      referenceTopologyUsed: true,
      detectedPromptUsed: true,
    })
  }

  function createPlan(options = {}) {
    const sequencePlan = normalizeSequencePlan(options.sequencePlan)
    if (!Array.isArray(options.anchorSpecs) || options.anchorSpecs.length < 2 || options.anchorSpecs.length > 4) {
      fail('AIFX_MORPHOLOGY_ANCHOR_INVALID', 'Material morphology reconstruction requires two to four AI anchors.')
    }
    const roleMap = new Map()
    for (const rawSpec of options.anchorSpecs) {
      const spec = normalizeAnchorSpec(rawSpec, sequencePlan)
      if (roleMap.has(spec.role)) {
        fail('AIFX_MORPHOLOGY_ANCHOR_INVALID', `Material anchor role ${spec.role} may appear only once.`)
      }
      roleMap.set(spec.role, spec)
    }
    if (!roleMap.has('peak') || ![...roleMap.keys()].some((role) => POST_PEAK_ROLES.has(role))) {
      fail('AIFX_MORPHOLOGY_ANCHOR_INVALID', 'Material morphology reconstruction requires one peak and at least one post-peak AI anchor.')
    }
    const peakIndex = roleMap.get('peak').globalIndex
    if ([...roleMap.values()].some((spec) => POST_PEAK_ROLES.has(spec.role) && spec.globalIndex <= peakIndex)) {
      fail('AIFX_MORPHOLOGY_ANCHOR_INVALID', 'Every post-peak material anchor must occur after the peak frame.')
    }
    const anchors = Object.freeze(ANCHOR_ROLES.map((role) => roleMap.get(role)).filter(Boolean))
    const materialType = cleanText(options.materialType).toLowerCase() || 'energy'
    const reference = normalizeReference(options.reference)
    return Object.freeze({
      version: VERSION,
      pipeline: PIPELINE,
      sequencePlan,
      anchors,
      materialType,
      reference,
      modelProducesPhaseAnchors: true,
      identityConditioning: 'full-reference-peak-distillation-plus-macro-free-peak-material-token-for-nonpeak-anchors',
      finalShapeAuthority: FINAL_SHAPE_AUTHORITY,
      motionConstraint: MOTION_CONSTRAINT,
      templatePixelsUsed: false,
      templateMaskUsed: false,
      silentTemplateFallbackAllowed: false,
    })
  }

  function compileAnchorPrompt(plan, anchorSpec, options = {}, promptWorkflow) {
    if (!promptWorkflow || typeof promptWorkflow.compileLocalAnchor !== 'function') {
      fail('AIFX_MORPHOLOGY_PROMPT_WORKFLOW_MISSING', 'compileLocalAnchor is required for material morphology reconstruction.')
    }
    const referenceMode = cleanText(options.referenceMode) || referenceModeForAnchor(anchorSpec.role)
    const compiled = promptWorkflow.compileLocalAnchor({
      provider: cleanText(options.provider) || 'local',
      anchorRole: anchorSpec.role,
      anchorFrame: anchorSpec.plan,
      hasIdentityReference: false,
      styleStrength: options.styleStrength,
      materialPrompt: options.materialPrompt,
      promptSupplement: options.promptSupplement,
      styleDescription: options.styleDescription,
      materialType: plan.materialType,
      guideNormalization: options.guideNormalization,
      referenceMode,
    })
    return Object.freeze({
      ...compiled,
      referenceMode,
      modelStyleStrength: modelStyleStrengthForAnchor(anchorSpec.role, options.styleStrength),
    })
  }

  async function runAnchorPipeline(options = {}, dependencies = {}) {
    const templateResource = dependencies.templateResource
    const promptWorkflow = dependencies.promptWorkflow
    const generateWorkflow = dependencies.generateWorkflow
    const postprocessWorkflow = dependencies.postprocessWorkflow
    const temporalConform = dependencies.temporalConformWorkflow
    const qualityWorkflow = dependencies.qualityWorkflow
    const materialIdentity = dependencies.materialIdentityResource
    if (!promptWorkflow || typeof promptWorkflow.compileLocalAnchor !== 'function') {
      fail('AIFX_MORPHOLOGY_DEPENDENCY_MISSING', 'Material morphology prompt workflow is required.')
    }
    if (!generateWorkflow || typeof generateWorkflow.run !== 'function') {
      fail('AIFX_MORPHOLOGY_DEPENDENCY_MISSING', 'Material morphology generate workflow is required.')
    }
    if (
      !postprocessWorkflow
      || typeof postprocessWorkflow.validateGeneratedSheetGeometry !== 'function'
      || typeof postprocessWorkflow.postprocessGeneratedSheet !== 'function'
    ) {
      fail('AIFX_MORPHOLOGY_DEPENDENCY_MISSING', 'Material morphology postprocess workflow is required.')
    }
    if (!temporalConform || typeof temporalConform.analyzeAiAlphaGeometry !== 'function') {
      fail('AIFX_MORPHOLOGY_DEPENDENCY_MISSING', 'Material morphology temporal workflow is required.')
    }
    if (!qualityWorkflow || typeof qualityWorkflow.evaluate !== 'function') {
      fail('AIFX_MORPHOLOGY_DEPENDENCY_MISSING', 'Material morphology quality workflow is required.')
    }
    if (!materialIdentity || typeof materialIdentity.buildPeakMaterialToken !== 'function') {
      fail('AIFX_MORPHOLOGY_DEPENDENCY_MISSING', 'Material morphology identity resource is required.')
    }

    const createCanvas = requiredFunction(dependencies, 'createCanvas')
    const imageFromUrl = requiredFunction(dependencies, 'imageFromUrl')
    const dataUrlToFrame = requiredFunction(dependencies, 'dataUrlToFrame')
    const assertCurrent = requiredFunction(dependencies, 'assertCurrent')
    const assertSheetBudget = requiredFunction(dependencies, 'assertSheetBudget')
    const removeIsolatedCoreObjects = requiredFunction(dependencies, 'removeIsolatedCoreObjects')
    const fitClippedAnchorToSafeMargin = requiredFunction(dependencies, 'fitClippedAnchorToSafeMargin')
    const assertAnchorMaterialReadable = requiredFunction(dependencies, 'assertAnchorMaterialReadable')
    const validateFrame = requiredFunction(dependencies, 'validateFrame')
    const assertLifecycleAlphaQuality = requiredFunction(dependencies, 'assertLifecycleAlphaQuality')
    const canonicalFrameName = typeof dependencies.canonicalFrameName === 'function'
      ? dependencies.canonicalFrameName
      : (index) => `frame_${String(index).padStart(3, '0')}.png`
    const onStatus = typeof dependencies.onStatus === 'function' ? dependencies.onStatus : () => {}
    const onProgress = typeof dependencies.onProgress === 'function' ? dependencies.onProgress : () => {}
    const log = typeof dependencies.log === 'function'
      ? dependencies.log
      : (...args) => globalThis.console?.info?.(...args)
    const now = typeof dependencies.now === 'function' ? dependencies.now : Date.now

    const sequencePlan = normalizeSequencePlan(options.sequencePlan)
    const packed = options.packed
    if (!packed?.motionGuide?.frames || !Array.isArray(packed.motionGuide.frames)) {
      fail('AIFX_MORPHOLOGY_GUIDE_INVALID', 'Material morphology requires prepared motion-guide frames.')
    }
    const templateFrames = Array.isArray(options.templateFrames) ? options.templateFrames : []
    if (templateFrames.length !== sequencePlan.length) {
      fail('AIFX_MORPHOLOGY_SEQUENCE_PLAN_INVALID', 'Template frame count must match the material morphology sequence plan.')
    }
    const styleReference = options.styleReference
    const fullReferenceScale = Math.min(
      1,
      768 / Math.max(1, Number(styleReference?.width) || 1, Number(styleReference?.height) || 1),
    )
    const styleReferenceInput = {
      name: `aifx_full_material_reference_${now()}.png`,
      dataUrl: styleReference?.comfyDataUrl || styleReference?.dataUrl,
      width: Math.max(1, Math.round((Number(styleReference?.width) || 1) * fullReferenceScale)),
      height: Math.max(1, Math.round((Number(styleReference?.height) || 1) * fullReferenceScale)),
    }
    const materialType = cleanText(options.materialType).toLowerCase() || 'energy'
    const blackRemoval = options.blackRemoval || Object.freeze({
      threshold: materialType === 'lightning' ? 3 : 5,
      range: materialType === 'ice' ? 76 : 92,
      blurRadius: materialType === 'lightning' ? 0.75 : 1.25,
      glowRadius: materialType === 'lightning' ? 2.8 : 3.6,
    })
    const anchorSpecs = selectAnchorSpecs(sequencePlan)
    const morphologyPlan = createPlan({
      sequencePlan,
      anchorSpecs,
      materialType,
      reference: styleReferenceInput,
    })
    const modelAnchorSpecs = morphologyPlan.anchors
    const initialSequenceSeed = Math.max(
      0,
      Math.floor(finiteNumber(options.initialSequenceSeed, now() % 2147483647)),
    ) % 2147483647
    const retryPolicy = createRetryPolicy(morphologyPlan, {
      initialSequenceSeed,
      maximumAnchorAttempts: options.maximumAnchorAttempts,
    })
    const {
      boundedPostPeakRetryEnabled,
      maximumAnchorAttempts,
      maximumRetryAnchorCalls,
      maximumGeneratedAnchorCalls,
    } = retryPolicy
    const rejectedAnchorAttempts = []
    let anchorRuns = []
    let conformed = null
    let sequenceQuality = null
    let acceptedAnchorAttempt = 0
    let acceptedSequenceSeed = initialSequenceSeed
    let retainedStableAnchorRuns = []

    for (let anchorAttempt = 1; anchorAttempt <= maximumAnchorAttempts; anchorAttempt += 1) {
      const sequenceSeed = sequenceSeedForAttempt(retryPolicy, anchorAttempt)
      const attemptRuns = []
      const attemptPromptIds = []
      try {
        for (let anchorPosition = 0; anchorPosition < modelAnchorSpecs.length; anchorPosition += 1) {
          const anchorSpec = modelAnchorSpecs[anchorPosition]
          const globalIndex = anchorSpec.globalIndex
          const retainedRun = retainedStableAnchorRuns.find((entry) => entry.spec.role === anchorSpec.role)
          if (retainedRun) {
            attemptRuns.push(retainedRun)
            continue
          }
          const anchorSeed = seedForAnchorRole(sequenceSeed, anchorSpec.role)
          const referenceMode = referenceModeForAnchor(anchorSpec.role)
          const anchorControl = controlProfileForAnchor(anchorSpec.role, options.localControl, anchorAttempt)
          const peakIdentityRun = attemptRuns.find((entry) => entry.spec.role === 'peak')
          const anchorStyleReference = referenceMode === 'generated-peak-material-token'
            ? peakIdentityRun?.materialToken || null
            : styleReferenceInput
          if (!anchorStyleReference) {
            fail(
              'AIFX_MORPHOLOGY_PEAK_REQUIRED',
              `The ${anchorSpec.role} anchor requires an accepted generated peak material token.`,
            )
          }
          const guide = await prepareAnchorGuide({
            motionGuideFrame: packed.motionGuide.frames[globalIndex],
            fps: options.fps,
            role: anchorSpec.role,
          }, {
            templateResource,
            createCanvas,
            assertSheetBudget,
          })
          const anchorPrompt = compileAnchorPrompt(morphologyPlan, anchorSpec, {
            provider: options.provider,
            styleStrength: options.styleStrength,
            materialPrompt: options.materialPrompt,
            promptSupplement: options.promptSupplement,
            styleDescription: options.styleDescription,
            guideNormalization: guide.readability,
            referenceMode,
          }, promptWorkflow)
          onStatus('AI 特效生成中', `正在重构 ${anchorSpec.role} 材质形体（${anchorPosition + 1}/${modelAnchorSpecs.length}）。`)
          const candidate = await generateWorkflow.run({
            provider: options.provider,
            guide: {
              name: `aifx_${anchorSpec.role}_motion_guide.png`,
              dataUrl: guide.dataUrl,
              width: guide.plan.sheetSize.width,
              height: guide.plan.sheetSize.height,
            },
            styleReference: anchorStyleReference,
            prompt: options.materialPrompt,
            structurePrompt: anchorPrompt.structurePrompt,
            stylePrompt: anchorPrompt.stylePrompt,
            promptsPrecompiled: true,
            negativePrompt: anchorPrompt.negativePrompt,
            anchorRole: anchorSpec.role,
            anchorFrame: anchorPrompt.anchorFrame,
            materialReferenceMode: referenceMode,
            materialType,
            seed: anchorSeed,
            strength: anchorPrompt.modelStyleStrength,
            controlStrength: anchorControl.strength,
            controlEndPercent: anchorControl.endPercent,
            outputPrefix: `NovaFlow_VFX_Local_${now()}_${anchorSpec.role}_morphology`,
            signal: options.signal,
            onProgress(progress) {
              onProgress(Object.freeze({
                progress,
                anchorSpec,
                anchorPosition,
                anchorCount: modelAnchorSpecs.length,
              }))
            },
          })
          attemptPromptIds.push(candidate.promptId)
          assertCurrent()
          const generatedAnchorSheet = await imageFromUrl(candidate.dataUrl)
          const rawAnchorIsolation = evaluateAnchorIsolation(
            analyzeRawAnchorIsolation(generatedAnchorSheet, { createCanvas }),
            anchorSpec.role,
          )
          if (!rawAnchorIsolation.passed) {
            fail(
              rawAnchorIsolation.code,
              `The generated ${anchorSpec.role} anchor is not an isolated black-canvas material asset.`,
              { ...rawAnchorIsolation, globalIndex, anchorRole: anchorSpec.role },
            )
          }
          assertSheetBudget({
            width: generatedAnchorSheet.naturalWidth || generatedAnchorSheet.width,
            height: generatedAnchorSheet.naturalHeight || generatedAnchorSheet.height,
          })
          postprocessWorkflow.validateGeneratedSheetGeometry(generatedAnchorSheet, guide.plan)
          const postprocessed = await postprocessWorkflow.postprocessGeneratedSheet({
            plan: guide.plan,
            sheet: generatedAnchorSheet,
            materialType,
            blackRemoval,
          }, {
            templateResource,
            backgroundRemoval: dependencies.backgroundRemoval,
            rmbg: dependencies.rmbg,
          })
          if (postprocessed.status !== 'ready' || postprocessed.frames.length !== 1) {
            fail('AIFX_MORPHOLOGY_POSTPROCESS_FAILED', 'AI 特效材质形体锚点后处理未完成。')
          }
          const processedFrame = postprocessed.frames[0]
          const decodedRuntimeFrame = await dataUrlToFrame(
            processedFrame.dataUrl,
            `${anchorSpec.role}_${canonicalFrameName(globalIndex)}`,
            anchorPosition,
          )
          const peakGeneratedRun = attemptRuns.find((entry) => entry.spec.role === 'peak')
          const comparisonRun = anchorSpec.role === 'breakup'
            ? attemptRuns.find((entry) => entry.spec.role === 'decay') || peakGeneratedRun
            : anchorSpec.role === 'dissipation'
              ? attemptRuns.find((entry) => entry.spec.role === 'breakup')
              : null
          const topologyRefined = refineGeneratedAnchorTopology(decodedRuntimeFrame, {
            role: anchorSpec.role,
            materialType,
            comparisonFrame: comparisonRun?.runtimeFrame || null,
            comparisonRole: comparisonRun?.spec.role || '',
            identityFrame: peakGeneratedRun?.runtimeFrame || null,
          }, { createCanvas })
          const legacyCleanup = shouldApplyIsolatedCoreCleanup(anchorSpec.role)
            && !topologyRefined.cleanup.applied
            ? removeIsolatedCoreObjects(topologyRefined.frame, materialType)
            : null
          const cleanedAnchor = legacyCleanup
            ? Object.freeze({
                frame: legacyCleanup.frame,
                cleanup: legacyCleanup.cleanup || topologyRefined.cleanup,
              })
            : topologyRefined
          if (materialType === 'lightning' && (anchorSpec.role === 'decay' || anchorSpec.role === 'breakup' || anchorSpec.role === 'dissipation')) {
            log('[AIFX generated anchor topology refinement]', JSON.stringify({
              attempt: anchorAttempt,
              role: anchorSpec.role,
              cleanup: cleanedAnchor.cleanup,
            }))
          }
          const rawAnchorGeometry = temporalConform.analyzeAiAlphaGeometry(cleanedAnchor.frame)
          const safeAnchor = fitClippedAnchorToSafeMargin(cleanedAnchor.frame, rawAnchorGeometry)
          const materialDetail = assertAnchorMaterialReadable(safeAnchor.frame, materialType, anchorSpec.role)
          const materialToken = anchorSpec.role === 'peak'
            ? materialIdentity.buildPeakMaterialToken(safeAnchor.frame.canvas, {
                createCanvas,
                name: `aifx_peak_material_token_${sequenceSeed}.png`,
              })
            : null
          attemptRuns.push({
            spec: anchorSpec,
            prompt: anchorPrompt,
            candidate,
            guide,
            postprocessed,
            rawAnchorGeometry,
            contentCleanup: cleanedAnchor.cleanup,
            boundaryRepair: safeAnchor.repair,
            materialDetail,
            rawAnchorIsolation,
            anchorControl,
            referenceMode,
            materialToken,
            runtimeFrame: {
              ...safeAnchor.frame,
              index: anchorPosition,
              globalIndex,
              timelineIndex: globalIndex,
              anchorRole: anchorSpec.role,
              name: canonicalFrameName(globalIndex),
              pixelFormat: 'rgba8',
              alphaMode: 'straight',
              matteMethod: processedFrame.matteMethod,
              stats: processedFrame.stats || null,
            },
          })
        }
        const peakRun = attemptRuns.find((entry) => entry.spec.role === 'peak')
        if (!peakRun) {
          fail('AIFX_MORPHOLOGY_PEAK_REQUIRED', 'A generated AI peak anchor is required for material morphology reconstruction.')
        }
        assertCurrent()
        onStatus('自动成品处理中', '正在用 AI onset / peak / decay 材质形体锚点合成连续序列。')
        const attemptConformed = await reconstruct({
          plan: morphologyPlan,
          anchorRuns: attemptRuns,
          attempt: anchorAttempt,
        }, {
          temporalConform,
          createCanvas,
        })
        const attemptSequenceQuality = qualityWorkflow.evaluate({
          templateFrames,
          generatedFrames: attemptConformed.frames,
        })
        log('[AIFX anchor attempt quality]', JSON.stringify({
          attempt: anchorAttempt,
          sequenceSeed,
          quality: attemptSequenceQuality,
        }))
        if (!attemptSequenceQuality.passed) {
          const failure = attemptSequenceQuality.failures[0]
          const error = new Error(failure?.message || 'AI effect sequence failed temporal quality validation.')
          error.code = attemptSequenceQuality.code || 'AIFX_SEQUENCE_LIFECYCLE_INCOHERENT'
          error.failures = attemptSequenceQuality.failures
          error.diagnostics = attemptSequenceQuality.diagnostics
          throw error
        }
        anchorRuns = attemptRuns
        conformed = attemptConformed
        sequenceQuality = attemptSequenceQuality
        acceptedAnchorAttempt = anchorAttempt
        acceptedSequenceSeed = sequenceSeed
        break
      } catch (error) {
        const retryDecision = evaluateRetry(retryPolicy, {
          attempt: anchorAttempt,
          error,
        })
        rejectedAnchorAttempts.push(Object.freeze({
          attempt: anchorAttempt,
          sequenceSeed,
          code: cleanText(error?.code) || 'AIFX_ANCHOR_ATTEMPT_FAILED',
          message: cleanText(error?.message || error),
          promptIds: Object.freeze([...attemptPromptIds]),
        }))
        log('[AIFX anchor attempt rejected]', JSON.stringify({
          attempt: anchorAttempt,
          sequenceSeed,
          code: cleanText(error?.code) || 'AIFX_ANCHOR_ATTEMPT_FAILED',
          message: cleanText(error?.message || error),
          details: error?.details && typeof error.details === 'object' ? error.details : null,
          promptIds: attemptPromptIds,
        }))
        if (!retryDecision.shouldRetry) {
          error.rejectedAnchorAttempts = Object.freeze([...rejectedAnchorAttempts])
          throw error
        }
        retainedStableAnchorRuns = attemptRuns.filter((entry) => retryDecision.retainedRoles.includes(entry.spec.role))
        onStatus('AI 特效自动重试', `第 ${anchorAttempt} 组材质形体锚点未通过，正在更换序列种子重试。`)
      }
    }
    if (!conformed || !sequenceQuality || !anchorRuns.length) {
      fail('AIFX_ANCHOR_RETRY_EXHAUSTED', 'No coherent local AI anchor sequence was produced.')
    }

    const peakRun = anchorRuns.find((entry) => entry.spec.role === 'peak') || anchorRuns[0]
    const phaseAnchorsIdentityConditionedByPeak = anchorRuns.some((entry) => (
      entry.spec.role !== 'peak'
      && entry.candidate.peakMaterialTokenConditioning === true
      && entry.candidate.visualReferenceConnected === true
      && entry.candidate.visualReferenceEffective === true
      && Number(entry.candidate.visualReferenceEndPercent) > 0
    ))
    const runtimeFrames = conformed.frames.map((frame, index) => ({
      ...frame,
      index,
      fileName: frame.name || canonicalFrameName(index),
      matteMethod: peakRun.postprocessed.matteMethod || 'black-matte-remove-and-unmultiply',
    }))
    const temporalCorrection = conformed.temporalCorrection
    const structureTransfer = null
    const motionConstraint = conformed.motionConstraint
    const rawSequenceQuality = Object.freeze({
      skipped: false,
      evaluatedOnFinalConformedSequence: true,
      anchorCount: anchorRuns.length,
      acceptedAnchorAttempt,
      maximumAnchorAttempts,
      maximumGeneratedAnchorCalls,
      acceptedSequenceSeed,
      rejectedAnchorAttempts: Object.freeze(rejectedAnchorAttempts),
      identityStrategy: morphologyPlan.identityConditioning,
      finalShapeAuthority: conformed.finalShapeAuthority,
      templatePixelsUsed: false,
      promptIds: Object.freeze(anchorRuns.map((entry) => entry.candidate.promptId)),
    })
    const combinedAnchorPrompt = anchorRuns.map((entry) => `[${entry.spec.role}] ${entry.prompt.prompt}`).join('\n\n')
    const frameQuality = runtimeFrames.map((frame) => validateFrame(frame.canvas))
    assertLifecycleAlphaQuality(frameQuality, options.lifecycle, 'AIFX_FINAL')
    log('[AIFX sequence quality]', JSON.stringify(sequenceQuality))
    const controlGuidance = Object.freeze({
      enabled: options.provider === 'local',
      source: phaseAnchorsIdentityConditionedByPeak
        ? 'full-reference-peak-plus-macro-free-peak-material-token-and-phase-guides'
        : 'full-reference-peak-plus-phase-guides',
      guideType: modelAnchorSpecs.length >= 4
        ? 'four-ai-material-morphology-anchors'
        : 'adaptive-ai-material-morphology-anchors',
      strength: Math.max(...anchorRuns.map((entry) => entry.anchorControl.strength)),
      startPercent: 0,
      endPercent: Math.max(...anchorRuns.map((entry) => entry.anchorControl.endPercent)),
      perAnchor: Object.freeze(Object.fromEntries(anchorRuns.map((entry) => [entry.spec.role, entry.anchorControl]))),
    })
    const candidate = peakRun.candidate
    return Object.freeze({
      provider: options.provider,
      materialType,
      sequencePlan,
      styleReferenceInput: Object.freeze(styleReferenceInput),
      morphologyPlan,
      modelAnchorSpecs,
      retryPolicy,
      boundedPostPeakRetryEnabled,
      maximumAnchorAttempts,
      maximumRetryAnchorCalls,
      maximumGeneratedAnchorCalls,
      acceptedAnchorAttempt,
      acceptedSequenceSeed,
      rejectedAnchorAttempts: Object.freeze(rejectedAnchorAttempts),
      anchorRuns: Object.freeze(anchorRuns),
      conformed,
      runtimeFrames: Object.freeze(runtimeFrames),
      exportFrames: conformed.frames,
      temporalCorrection,
      structureTransfer,
      motionConstraint,
      rawSequenceQuality,
      candidate,
      postprocessed: peakRun.postprocessed,
      combinedAnchorPrompt,
      frameQuality: Object.freeze(frameQuality),
      sequenceQuality,
      controlGuidance,
      exportInput: Object.freeze({
        frames: conformed.frames,
        fps: options.fps,
        lifecycle: options.lifecycle,
        provider: options.provider,
        materialType,
        model: candidate.models?.unet || candidate.modelKey,
        prompt: combinedAnchorPrompt,
        sequencePlan,
        sequenceQuality,
        shapeSource: conformed.shapeSource,
        motionConstraint,
        temporalCorrection,
        structureTransfer,
        controlGuidance,
        atlas: { gutter: 2, padding: 2 },
      }),
    })
  }

  function buildPipelineResult(run, options = {}) {
    if (!run?.morphologyPlan || !Array.isArray(run.anchorRuns) || !run.anchorRuns.length) {
      fail('AIFX_MORPHOLOGY_RESULT_REQUIRED', 'A completed material morphology run is required.')
    }
    const finalProduct = options.finalProduct
    if (!finalProduct?.files?.atlas || !finalProduct?.files?.generationManifest) {
      fail('AIFX_MORPHOLOGY_RESULT_REQUIRED', 'The exported material morphology final product is required.')
    }
    const lifecycle = options.lifecycle || {}
    const autoPrompt = options.autoPrompt || {}
    const compiled = options.compiled || null
    const localControl = options.localControl || null
    const { anchorRuns, candidate, runtimeFrames, frameQuality, conformed, morphologyPlan } = run
    const candidateRecord = Object.freeze({
      ...candidate,
      kind: 'aifx-anchor-sequence-candidate',
      anchorCandidates: Object.freeze(anchorRuns.map((entry) => Object.freeze({
        role: entry.spec.role,
        globalIndex: entry.spec.globalIndex,
        referenceMode: entry.referenceMode,
        conditioningMode: entry.candidate.conditioningMode,
        visualReferenceConnected: entry.candidate.visualReferenceConnected,
        visualReferenceEffective: entry.candidate.visualReferenceEffective,
        visualReferenceEndPercent: entry.candidate.visualReferenceEndPercent,
        semanticMaterialConditioning: entry.candidate.semanticMaterialConditioning,
        control: entry.anchorControl,
        isolation: entry.rawAnchorIsolation,
        promptId: entry.candidate.promptId,
        seed: entry.candidate.seed,
        timing: entry.candidate.timing,
      }))),
      inferredEffectType: run.materialType,
      frames: runtimeFrames,
      previewFrame: runtimeFrames[lifecycle.peakFrame || 0]?.dataUrl || runtimeFrames[0]?.dataUrl || '',
      quality: frameQuality,
    })
    const lastGeneration = Object.freeze({
      candidate,
      postprocessed: run.postprocessed,
      compiled,
      materialType: run.materialType,
      frameQuality,
      rawSequenceQuality: run.rawSequenceQuality,
      sequenceQuality: run.sequenceQuality,
      temporalCorrection: run.temporalCorrection,
      structureTransfer: run.structureTransfer,
      anchorRuns,
    })
    const pipelineSummary = Object.freeze({
      pipeline: 'aifx-production-material-morphology-v2',
      provider: run.provider,
      materialType: run.materialType,
      seedStrategy: run.retryPolicy.seedStrategy,
      acceptedAnchorAttempt: run.acceptedAnchorAttempt,
      maximumAnchorAttempts: run.maximumAnchorAttempts,
      maximumGeneratedAnchorCalls: run.maximumGeneratedAnchorCalls,
      acceptedSequenceSeed: run.acceptedSequenceSeed,
      rejectedAnchorAttempts: run.rejectedAnchorAttempts,
      identityStrategy: morphologyPlan.identityConditioning,
      fullPeakIdentityImageSent: anchorRuns.some((entry) => entry.referenceMode === 'generated-peak-material-identity'),
      peakMaterialTokenImageSent: anchorRuns.some((entry) => entry.referenceMode === 'generated-peak-material-token'),
      fullMaterialReferenceImageSent: true,
      modelProducesFullSequence: false,
      modelProducesPhaseAnchors: true,
      sequenceSynthesizer: 'material-morphology-anchor-conform',
      phaseAnchorsDerivedFromPeak: false,
      phaseAnchorsIdentityConditionedByPeak: run.controlGuidance.source.includes('macro-free-peak-material-token'),
      phaseAnchorsSpatiallyConditionedByPeak: false,
      phaseAnchorsMacroSilhouetteConditionedByPeak: false,
      perTemplateFrameStructureUsed: false,
      intermediateDirectionTransformApplied: true,
      tailTopologyEvolutionApplied: Array.isArray(conformed.tailAnchorRoles)
        && conformed.tailAnchorRoles.some((role) => role === 'breakup' || role === 'dissipation'),
      templatePixelsUsed: false,
      silentTemplateFallbackAllowed: false,
      styleReferenceRole: autoPrompt.styleReferenceRole,
      referenceTopologyUsed: autoPrompt.referenceTopologyUsed,
      detectedPromptUsed: autoPrompt.detectedPromptUsed,
      materialReference: Object.freeze({
        role: morphologyPlan.reference.role,
        fullReferenceImageSent: morphologyPlan.reference.fullReferenceImageSent,
        macroLayoutAvailableToModel: morphologyPlan.reference.macroLayoutAvailableToModel,
        anchorReferenceModes: Object.freeze(Object.fromEntries(anchorRuns.map((entry) => [entry.spec.role, entry.referenceMode]))),
      }),
      frameCount: runtimeFrames.length,
      promptId: candidate.promptId,
      promptIds: Object.freeze(anchorRuns.map((entry) => entry.candidate.promptId)),
      anchorFrames: Object.freeze(anchorRuns.map((entry) => Object.freeze({
        role: entry.spec.role,
        globalIndex: entry.spec.globalIndex,
        referenceMode: entry.referenceMode,
        conditioningMode: entry.candidate.conditioningMode,
        visualReferenceConnected: entry.candidate.visualReferenceConnected,
        visualReferenceEffective: entry.candidate.visualReferenceEffective,
        visualReferenceEndPercent: entry.candidate.visualReferenceEndPercent,
        peakMaterialTokenConditioning: entry.candidate.peakMaterialTokenConditioning,
        materialReferenceMode: entry.candidate.materialReferenceMode,
        control: entry.anchorControl,
        isolation: entry.rawAnchorIsolation,
        promptId: entry.candidate.promptId,
        seed: entry.candidate.seed,
        timing: entry.candidate.timing,
      }))),
      modelKey: candidate.modelKey,
      promptHash: finalProduct.promptHash,
      atlas: finalProduct.files.atlas.name,
      pixelFormat: finalProduct.pixelFormat,
      alphaMode: finalProduct.alphaMode,
      matteMethod: run.postprocessed.matteMethod,
      shapeSource: conformed.shapeSource,
      motionConstraint: run.motionConstraint,
      temporalCorrection: run.temporalCorrection,
      structureTransfer: run.structureTransfer,
      localControl,
      sequencePlan: run.sequencePlan,
      sequenceQuality: run.sequenceQuality.diagnostics,
      warnings: Object.freeze(anchorRuns.flatMap((entry) => entry.candidate.warnings || [])),
      frameSize: Object.freeze({ width: runtimeFrames[0].width, height: runtimeFrames[0].height }),
      quality: Object.freeze(frameQuality.map((entry, index) => Object.freeze({
        index,
        alphaPixels: entry.alphaPixels,
        brightness: entry.brightness,
        coverageRatio: entry.coverageRatio,
      }))),
      outputs: Object.freeze({
        atlas: finalProduct.files.atlas.name,
        atlasMetadata: finalProduct.files.atlasMetadata.name,
        generationManifest: finalProduct.files.generationManifest.name,
        frameCount: finalProduct.files.frames.length,
      }),
      timing: Object.freeze({
        totalMs: anchorRuns.reduce((sum, entry) => sum + (Number(entry.candidate.timing?.totalMs) || 0), 0),
        anchors: Object.freeze(anchorRuns.map((entry) => Object.freeze({ role: entry.spec.role, ...entry.candidate.timing }))),
      }),
    })
    return Object.freeze({ candidateRecord, lastGeneration, pipelineSummary })
  }

  async function reconstruct(options = {}, dependencies = {}) {
    const plan = options.plan
    if (!plan || plan.version !== VERSION) {
      fail('AIFX_MORPHOLOGY_PLAN_REQUIRED', 'A valid material morphology plan is required.')
    }
    const runs = Array.isArray(options.anchorRuns) ? options.anchorRuns : []
    if (runs.length !== plan.anchors.length) {
      fail('AIFX_MORPHOLOGY_ANCHOR_RESULT_INVALID', 'Every planned material anchor must have one generated result.', {
        planned: plan.anchors.length,
        actual: runs.length,
      })
    }
    const runRoles = new Set(runs.map((entry) => cleanText(entry?.spec?.role).toLowerCase()))
    for (const spec of plan.anchors) {
      if (!runRoles.has(spec.role)) {
        fail('AIFX_MORPHOLOGY_ANCHOR_RESULT_INVALID', `Generated material anchor ${spec.role} is missing.`)
      }
    }
    const frames = runs.map((entry) => entry.runtimeFrame)
    if (frames.some((frame) => !frame?.dataUrl || !frame?.anchorRole)) {
      fail('AIFX_MORPHOLOGY_ANCHOR_RESULT_INVALID', 'Generated material anchors must be decoded RGBA frames with explicit roles.')
    }
    const temporalConform = dependencies.temporalConform
    if (!temporalConform || typeof temporalConform.conformFrames !== 'function') {
      fail('AIFX_MORPHOLOGY_TEMPORAL_WORKFLOW_MISSING', 'Temporal conform is required to synthesize the final anchor-driven sequence.')
    }
    const conformed = await temporalConform.conformFrames({
      trigger: 'anchor-sequence-generation',
      frames,
      sequencePlan: plan.sequencePlan,
      attempt: options.attempt,
      options: {
        ...(options.temporalOptions && typeof options.temporalOptions === 'object' ? options.temporalOptions : {}),
        directionAlignmentEnabled: true,
        anchorCompatibilityMinimum: 0.08,
      },
    }, {
      createCanvas: dependencies.createCanvas,
      canvasToDataUrl: dependencies.canvasToDataUrl,
    })
    if (conformed?.status !== 'ready' || conformed.templatePixelsUsed !== false || conformed.templateMaskUsed !== false) {
      fail('AIFX_MORPHOLOGY_OUTPUT_INVALID', 'Anchor-driven reconstruction did not produce a template-pixel-and-mask-free RGBA sequence.')
    }
    return Object.freeze({
      ...conformed,
      pipeline: PIPELINE,
      materialType: plan.materialType,
      finalShapeAuthority: FINAL_SHAPE_AUTHORITY,
      motionConstraint: MOTION_CONSTRAINT,
      referenceContract: Object.freeze({
        role: plan.reference.role,
        fullReferenceImageSent: true,
        macroLayoutAvailableToModel: true,
      }),
      modelProducesPhaseAnchors: true,
      tailAnchorRoles: Object.freeze(plan.anchors.filter((entry) => POST_PEAK_ROLES.has(entry.role)).map((entry) => entry.role)),
      silentTemplateFallbackAllowed: false,
    })
  }

  return Object.freeze({
    version: VERSION,
    pipeline: PIPELINE,
    anchorRoles: ANCHOR_ROLES,
    initialMaterials: INITIAL_MATERIALS,
    finalShapeAuthority: FINAL_SHAPE_AUTHORITY,
    motionConstraint: MOTION_CONSTRAINT,
    AifxMaterialReconstructError,
    buildReferenceContract,
    selectAnchorSpecs,
    createPlan,
    createRetryPolicy,
    sequenceSeedForAttempt,
    evaluateRetry,
    createReadableGuidePlan,
    shouldApplyIsolatedCoreCleanup,
    referenceModeForAnchor,
    seedForAnchorRole,
    modelStyleStrengthForAnchor,
    controlProfileForAnchor,
    evaluateAnchorIsolation,
    refineGeneratedAnchorTopology,
    compileAnchorPrompt,
    runAnchorPipeline,
    buildPipelineResult,
    reconstruct,
  })
})
