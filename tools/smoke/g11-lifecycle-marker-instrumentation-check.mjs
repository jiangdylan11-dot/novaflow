import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const productionRendererEntry = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html')
const traceRoot = path.join(repoRoot, 'debug-output', 'lifecycle-marker-instrumentation-2026-05-17')

const markerNames = [
  'explicitPrepaintCssAppliedEvent',
  'explicitRuntimePatchEvent',
  'explicitReactHydrationEvent',
  'explicitRailMountEvent',
  'explicitBodyClassAppliedEvent',
  'explicitStableFrameEvent'
]

function assert(condition, code, details = {}) {
  if (!condition) {
    const error = new Error(code)
    error.code = code
    error.details = details
    throw error
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase()
}

function localAssetPath(entry, ref) {
  const clean = String(ref || '').split('?')[0].split('#')[0]
  if (!clean || clean.startsWith('http:') || clean.startsWith('https:') || clean.startsWith('//')) return null
  if (!clean.startsWith('./')) return null
  return path.resolve(path.dirname(entry), clean.slice(2))
}

function runtimeChainFiles(entry) {
  const html = readFileSync(entry, 'utf8')
  const files = new Map([[entry, true]])
  const attrPattern = /\b(?:src|href)=["']([^"']+)["']/g
  let match
  while ((match = attrPattern.exec(html))) {
    const resolved = localAssetPath(entry, match[1])
    if (!resolved) continue
    if (!/\.(js|css|ico)$/i.test(resolved)) continue
    if (existsSync(resolved)) files.set(resolved, true)
  }
  return Array.from(files.keys()).sort()
}

function hashRuntimeChain(entry) {
  return runtimeChainFiles(entry).map((file) => ({
    path: path.relative(repoRoot, file).replace(/\\/g, '/'),
    sha256: sha256(file)
  }))
}

function parseJsonOutput(stdout, code) {
  const text = String(stdout || '').trim()
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    assert(start >= 0 && end > start, code, { stdout: text.slice(-4000) })
    return JSON.parse(text.slice(start, end + 1))
  }
}

function parseFirstFrameResult(stdout) {
  const match = String(stdout || '').match(/__NOVAFLOW_G3_FIRST_FRAME_RESULT__(.*)__END_NOVAFLOW_G3_FIRST_FRAME_RESULT__/s)
  assert(match, 'G11_FIRST_FRAME_RESULT_MISSING')
  return JSON.parse(match[1])
}

function runNode(args, code) {
  const run = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  })
  if (run.stderr) process.stderr.write(run.stderr)
  assert(run.status === 0, code, { status: run.status, stdout: run.stdout, stderr: run.stderr, args })
  return run.stdout || ''
}

function runJson(args, code) {
  return parseJsonOutput(runNode(args, code), `${code}_JSON_MISSING`)
}

function runFirstFrame(renderer, sessionId) {
  const stdout = runNode([
    path.join('tools', 'smoke', 'first-frame-harness-runner.mjs'),
    '--session',
    sessionId,
    '--renderer',
    renderer,
    '--temp-root',
    traceRoot,
    '--timeout-ms',
    '90000'
  ], 'G11_FIRST_FRAME_RUNNER_FAILED')
  const result = parseFirstFrameResult(stdout)
  assert(result.ok === true, 'G11_FIRST_FRAME_RESULT_NOT_OK', result)
  assert(result.protocol === 'file:', 'G11_NOT_FILE_PROTOCOL', { protocol: result.protocol })
  assert(result.consoleErrorCount === 0, 'G11_CONSOLE_ERRORS_PRESENT', result.consoleErrors)
  assert(result.runtimeChainStable === true, 'G11_RUNTIME_CHAIN_UNSTABLE', result)
  assert(result.trace && Array.isArray(result.trace.samples) && result.trace.samples.length >= 12, 'G11_TRACE_SAMPLES_MISSING', result.trace)
  return result
}

function samples(result) {
  return result.trace && Array.isArray(result.trace.samples) ? result.trace.samples : []
}

function routeStateFor(sample) {
  const route = sample && sample.routeState ? sample.routeState : {}
  return {
    activePrimaryIndex: route.activePrimaryIndex ?? null,
    activePrimaryText: route.activePrimaryText || '',
    primaryEntryCount: route.primaryEntryCount || 0
  }
}

function bodyClassStateFor(sample, beforeSample = null) {
  return {
    before: beforeSample ? String(beforeSample.bodyClasses || '') : undefined,
    after: sample ? String(sample.bodyClasses || '') : undefined,
    current: sample ? String(sample.bodyClasses || '') : ''
  }
}

function receipt(markerName, sample, {
  available = true,
  sourceConfidence = 'observed',
  sourceEvidence = [],
  reason = '',
  beforeSample = null
} = {}) {
  return {
    markerName,
    available,
    timestamp: available && sample ? sample.timestamp : null,
    frameIndex: available && sample ? sample.frameIndex : null,
    railWidth: available && sample ? Number(sample.railWidth || 0) : null,
    bodyClassState: available && sample ? bodyClassStateFor(sample, beforeSample) : null,
    routeState: available && sample ? routeStateFor(sample) : null,
    sourceConfidence,
    sourceEvidence,
    reason
  }
}

function unavailable(markerName, reason, evidence = []) {
  return receipt(markerName, null, {
    available: false,
    sourceConfidence: 'unavailable',
    sourceEvidence: evidence,
    reason
  })
}

function firstSampleWhere(entries, predicate) {
  return entries.find(predicate) || null
}

function firstSampleIndexWhere(entries, predicate) {
  return entries.findIndex(predicate)
}

function previousSample(entries, index) {
  return index > 0 ? entries[index - 1] : null
}

function routeIsAvailable(sample) {
  return sample &&
    sample.rootExists === true &&
    sample.routeState &&
    Number(sample.routeState.primaryEntryCount || 0) > 0 &&
    sample.routeState.activePrimaryIndex !== null &&
    sample.routeState.activePrimaryIndex !== undefined
}

function collectRailShift(entries) {
  for (let index = 1; index < entries.length; index += 1) {
    const before = entries[index - 1]
    const after = entries[index]
    const widthBefore = Number(before.railWidth || 0)
    const widthAfter = Number(after.railWidth || 0)
    if (Math.abs(widthAfter - widthBefore) <= 2) continue
    return {
      railShiftFrame: after.frameIndex,
      railShiftWidthBefore: widthBefore,
      railShiftWidthAfter: widthAfter,
      before,
      after
    }
  }
  return {
    railShiftFrame: null,
    railShiftWidthBefore: null,
    railShiftWidthAfter: null,
    before: null,
    after: null
  }
}

function collectMarkers(target, result) {
  const entries = samples(result)
  const railShift = collectRailShift(entries)
  const railMountIndex = firstSampleIndexWhere(entries, (sample) => Number(sample.railWidth || 0) > 2)
  const railMount = railMountIndex >= 0 ? entries[railMountIndex] : null
  const bodyClassIndex = firstSampleIndexWhere(entries, (sample) => String(sample.bodyClasses || '').trim().length > 0)
  const bodyClassSample = bodyClassIndex >= 0 ? entries[bodyClassIndex] : null
  const hydrationIndex = firstSampleIndexWhere(entries, routeIsAvailable)
  const hydrationSample = hydrationIndex >= 0 ? entries[hydrationIndex] : null
  const stableSample = firstSampleWhere(entries, (sample) => sample.label === 'stable-frame')
  const markerReceipts = []

  markerReceipts.push(unavailable(
    'explicitPrepaintCssAppliedEvent',
    'No non-invasive computed-style or stylesheet-applied event is exposed by the current harness trace. The checker will not infer CSS application from file presence.',
    [
      'first-frame samples include pre-react-frame but no stylesheet application marker',
      'production index and CSS are read-only in G-11'
    ]
  ))

  markerReceipts.push(unavailable(
    'explicitRuntimePatchEvent',
    target === 'production'
      ? 'Runtime-owned body class and rail mutations are observable, but exact novaflow-brand-runtime.js patch execution is not attributable without modifying production runtime.'
      : 'The isolated renderer is source-owned and has no production runtime patch execution marker.',
    [
      'DOM mutation timing is available',
      'no explicit runtime-patch event is emitted non-invasively'
    ]
  ))

  if (hydrationSample) {
    markerReceipts.push(receipt('explicitReactHydrationEvent', hydrationSample, {
      sourceConfidence: 'observed',
      sourceEvidence: [
        '#root exists',
        'primary route entries are measurable',
        'active route state is measurable'
      ],
      reason: 'Observed via DOM node arrival and route state availability.',
      beforeSample: previousSample(entries, hydrationIndex)
    }))
  } else {
    markerReceipts.push(unavailable(
      'explicitReactHydrationEvent',
      'No frame contains both #root availability and measurable active route state.',
      ['rootExists/routeState samples did not converge']
    ))
  }

  if (railMount) {
    markerReceipts.push(receipt('explicitRailMountEvent', railMount, {
      sourceConfidence: 'observed',
      sourceEvidence: [
        `railWidth became ${Number(railMount.railWidth || 0)}`,
        'rail entry selector became measurable'
      ],
      reason: 'Observed as first non-zero rail width.',
      beforeSample: previousSample(entries, railMountIndex)
    }))
  } else {
    markerReceipts.push(unavailable(
      'explicitRailMountEvent',
      'No frame with non-zero rail width was observed.',
      ['railWidth remained zero']
    ))
  }

  if (bodyClassSample) {
    markerReceipts.push(receipt('explicitBodyClassAppliedEvent', bodyClassSample, {
      sourceConfidence: 'observed',
      sourceEvidence: [
        'document.body.className changed from empty to non-empty',
        `bodyClasses=${JSON.stringify(bodyClassSample.bodyClasses || '')}`
      ],
      reason: 'Observed through body class transition snapshot.',
      beforeSample: previousSample(entries, bodyClassIndex)
    }))
  } else {
    markerReceipts.push(unavailable(
      'explicitBodyClassAppliedEvent',
      'No non-empty body class state was observed.',
      ['body class timeline stayed empty']
    ))
  }

  if (stableSample) {
    markerReceipts.push(receipt('explicitStableFrameEvent', stableSample, {
      sourceConfidence: 'observed',
      sourceEvidence: [
        'stable-frame sample emitted by first-frame harness',
        'rail, body class, route state, and containment are sampled at the stable frame'
      ],
      reason: 'Observed via stable-frame harness sample.',
      beforeSample: previousSample(entries, entries.indexOf(stableSample))
    }))
  } else {
    markerReceipts.push(unavailable(
      'explicitStableFrameEvent',
      'No stable-frame sample was emitted.',
      ['stable-frame label missing']
    ))
  }

  for (const markerName of markerNames) {
    assert(markerReceipts.some((entry) => entry.markerName === markerName), 'G11_MARKER_RECEIPT_MISSING', { target, markerName })
  }

  return {
    target,
    sessionId: result.sessionId,
    consoleErrorCount: result.consoleErrorCount,
    railShift,
    markerReceipts
  }
}

function availableMarkers(markers) {
  return markers.filter((marker) => marker.available)
}

function markerDistance(marker, railShiftFrame) {
  if (!marker.available || marker.frameIndex === null || railShiftFrame === null) return Infinity
  return Math.abs(marker.frameIndex - railShiftFrame)
}

function railShiftCorrelation(collected) {
  const railShiftFrame = collected.railShift.railShiftFrame
  const available = availableMarkers(collected.markerReceipts)
  const before = available
    .filter((marker) => marker.frameIndex < railShiftFrame)
    .sort((left, right) => right.frameIndex - left.frameIndex)[0] || null
  const sameFrame = available
    .filter((marker) => marker.frameIndex === railShiftFrame)
    .sort((left, right) => markerNames.indexOf(left.markerName) - markerNames.indexOf(right.markerName))
  const after = available
    .filter((marker) => marker.frameIndex > railShiftFrame)
    .sort((left, right) => left.frameIndex - right.frameIndex)[0] || null

  return {
    target: collected.target,
    railShiftFrame,
    railShiftWidthBefore: collected.railShift.railShiftWidthBefore,
    railShiftWidthAfter: collected.railShift.railShiftWidthAfter,
    nearestMarkerBeforeRailShift: before ? compactMarker(before) : null,
    nearestMarkersSameFrame: sameFrame.map(compactMarker),
    nearestMarkerAfterRailShift: after ? compactMarker(after) : null,
    closestMarkerDistance: available.reduce((min, marker) => Math.min(min, markerDistance(marker, railShiftFrame)), Infinity)
  }
}

function compactMarker(marker) {
  return {
    markerName: marker.markerName,
    frameIndex: marker.frameIndex,
    timestamp: marker.timestamp,
    railWidth: marker.railWidth,
    sourceConfidence: marker.sourceConfidence
  }
}

function classifyFromMarkers(productionMarkers, isolatedMarkers) {
  const allMarkers = [...productionMarkers.markerReceipts, ...isolatedMarkers.markerReceipts]
  const unavailableMarkers = allMarkers
    .filter((marker) => !marker.available)
    .map((marker) => marker.markerName)
  const missingEvidence = Array.from(new Set(unavailableMarkers))
  const productionCorrelation = railShiftCorrelation(productionMarkers)
  const isolatedCorrelation = railShiftCorrelation(isolatedMarkers)
  const productionSame = productionCorrelation.nearestMarkersSameFrame.map((marker) => marker.markerName)
  const isolatedSame = isolatedCorrelation.nearestMarkersSameFrame.map((marker) => marker.markerName)
  const decisiveEvidence = [
    {
      target: 'production',
      railShiftFrame: productionCorrelation.railShiftFrame,
      sameFrameMarkers: productionSame
    },
    {
      target: 'isolated',
      railShiftFrame: isolatedCorrelation.railShiftFrame,
      sameFrameMarkers: isolatedSame
    }
  ]

  if (missingEvidence.length > 0) {
    return {
      classification: 'MIXED_DEPENDENCY',
      evidenceInsufficient: true,
      decisiveEvidence,
      missingEvidence,
      reason: 'At least one decisive lifecycle marker is unavailable; classification cannot be upgraded safely.'
    }
  }

  const isolatedHydrationAligned = isolatedSame.includes('explicitReactHydrationEvent') &&
    isolatedSame.includes('explicitRailMountEvent')
  const productionHydrationAligned = productionSame.includes('explicitReactHydrationEvent') &&
    productionSame.includes('explicitRailMountEvent')
  const bodyAligned = productionSame.includes('explicitBodyClassAppliedEvent') ||
    isolatedSame.includes('explicitBodyClassAppliedEvent')

  if (productionHydrationAligned && isolatedHydrationAligned) {
    return {
      classification: 'ROUTE_HYDRATION_DEPENDENCY',
      evidenceInsufficient: false,
      decisiveEvidence,
      missingEvidence: [],
      reason: 'Hydration and rail mount align in both production and isolated traces.'
    }
  }

  if (bodyAligned && isolatedSame.includes('explicitRailMountEvent')) {
    return {
      classification: 'SOURCE_LAYOUT_DEPENDENCY',
      evidenceInsufficient: false,
      decisiveEvidence,
      missingEvidence: [],
      reason: 'Body/source shell layout marker aligns with isolated rail mount.'
    }
  }

  return {
    classification: 'MIXED_DEPENDENCY',
    evidenceInsufficient: true,
    decisiveEvidence,
    missingEvidence: [],
    reason: 'Available markers do not identify one decisive owner.'
  }
}

function validateMarkerReceipt(marker) {
  for (const field of ['markerName', 'available', 'timestamp', 'frameIndex', 'railWidth', 'bodyClassState', 'routeState', 'sourceConfidence', 'sourceEvidence', 'reason']) {
    assert(Object.prototype.hasOwnProperty.call(marker, field), 'G11_MARKER_FIELD_MISSING', { field, marker })
  }
  assert(markerNames.includes(marker.markerName), 'G11_MARKER_NAME_INVALID', marker)
  assert(typeof marker.available === 'boolean', 'G11_MARKER_AVAILABLE_INVALID', marker)
  assert(['observed', 'inferred', 'unavailable'].includes(marker.sourceConfidence), 'G11_SOURCE_CONFIDENCE_INVALID', marker)
  assert(Array.isArray(marker.sourceEvidence), 'G11_SOURCE_EVIDENCE_INVALID', marker)
  if (marker.available) {
    assert(typeof marker.timestamp === 'number', 'G11_MARKER_TIMESTAMP_REQUIRED', marker)
    assert(Number.isInteger(marker.frameIndex), 'G11_MARKER_FRAME_REQUIRED', marker)
    assert(typeof marker.railWidth === 'number', 'G11_MARKER_RAIL_WIDTH_REQUIRED', marker)
    assert(marker.bodyClassState && typeof marker.bodyClassState === 'object', 'G11_MARKER_BODY_STATE_REQUIRED', marker)
    assert(marker.routeState && typeof marker.routeState === 'object', 'G11_MARKER_ROUTE_STATE_REQUIRED', marker)
  } else {
    assert(marker.sourceConfidence === 'unavailable', 'G11_UNAVAILABLE_CONFIDENCE_REQUIRED', marker)
    assert(typeof marker.reason === 'string' && marker.reason.length > 0, 'G11_UNAVAILABLE_REASON_REQUIRED', marker)
  }
}

try {
  mkdirSync(traceRoot, { recursive: true })
  const sessionId = `g11-lifecycle-marker-${Date.now()}`
  const productionBefore = hashRuntimeChain(productionRendererEntry)
  const g7 = runJson([path.join('tools', 'smoke', 'g7-isolated-first-frame-reduction-check.mjs')], 'G11_G7_REDUCTION_FAILED')
  assert(g7.ok === true, 'G11_G7_REDUCTION_NOT_OK', g7)
  const g7Renderer = path.resolve(repoRoot, g7.renderers.g7Reduction)
  assert(existsSync(g7Renderer), 'G11_G7_RENDERER_MISSING', { g7Renderer, renderers: g7.renderers })

  const productionTrace = runFirstFrame(productionRendererEntry, `${sessionId}-production`)
  const isolatedTrace = runFirstFrame(g7Renderer, `${sessionId}-isolated`)
  const productionAfter = hashRuntimeChain(productionRendererEntry)
  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfter), 'G11_PRODUCTION_RUNTIME_CHAIN_CHANGED', {
    before: productionBefore,
    after: productionAfter
  })

  const productionMarkers = collectMarkers('production', productionTrace)
  const isolatedMarkers = collectMarkers('isolated', isolatedTrace)
  for (const marker of [...productionMarkers.markerReceipts, ...isolatedMarkers.markerReceipts]) validateMarkerReceipt(marker)

  const productionCorrelation = railShiftCorrelation(productionMarkers)
  const isolatedCorrelation = railShiftCorrelation(isolatedMarkers)
  const classificationUpdate = classifyFromMarkers(productionMarkers, isolatedMarkers)
  assert(classificationUpdate.classification === 'MIXED_DEPENDENCY' || classificationUpdate.evidenceInsufficient === false, 'G11_FORCED_CLASSIFICATION_UPGRADE', classificationUpdate)
  assert(productionTrace.consoleErrorCount === 0 && isolatedTrace.consoleErrorCount === 0, 'G11_CONSOLE_ERROR_DELTA', {
    production: productionTrace.consoleErrorCount,
    isolated: isolatedTrace.consoleErrorCount
  })

  const output = {
    ok: true,
    code: 'G11_LIFECYCLE_MARKER_INSTRUMENTATION_OK',
    sessionId,
    productionRuntimeStable: true,
    productionRuntimeFileCount: productionBefore.length,
    markerCollectionMode: 'non-invasive first-frame harness trace',
    production: {
      sessionId: productionMarkers.sessionId,
      consoleErrorCount: productionMarkers.consoleErrorCount,
      markerReceipts: productionMarkers.markerReceipts,
      railShiftCorrelation: productionCorrelation
    },
    isolated: {
      sessionId: isolatedMarkers.sessionId,
      consoleErrorCount: isolatedMarkers.consoleErrorCount,
      markerReceipts: isolatedMarkers.markerReceipts,
      railShiftCorrelation: isolatedCorrelation
    },
    classificationUpdate,
    unavailableMarkers: classificationUpdate.missingEvidence,
    noRailFixPerformed: true,
    noProductionMutation: true
  }

  const receiptPath = path.join(traceRoot, `${sessionId}-receipt.json`)
  writeFileSync(receiptPath, JSON.stringify(output, null, 2), 'utf8')
  console.log(JSON.stringify({
    ...output,
    receiptPath: path.relative(repoRoot, receiptPath).replace(/\\/g, '/')
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G11_LIFECYCLE_MARKER_INSTRUMENTATION_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
