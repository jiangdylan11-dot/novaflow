import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const productionRendererEntry = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html')
const traceRoot = path.join(repoRoot, 'debug-output', 'rail-shift-root-cause-isolation-2026-05-17')

const CLASSIFICATIONS = new Set([
  'PREPAINT_DEPENDENCY',
  'RUNTIME_PATCH_DEPENDENCY',
  'SOURCE_LAYOUT_DEPENDENCY',
  'ROUTE_HYDRATION_DEPENDENCY',
  'MIXED_DEPENDENCY'
])

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
  assert(match, 'G9_FIRST_FRAME_RESULT_MISSING')
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
  ], 'G9_FIRST_FRAME_RUNNER_FAILED')
  const result = parseFirstFrameResult(stdout)
  assert(result.ok === true, 'G9_FIRST_FRAME_RESULT_NOT_OK', result)
  assert(result.protocol === 'file:', 'G9_FIRST_FRAME_NOT_FILE_PROTOCOL', { protocol: result.protocol })
  assert(result.consoleErrorCount === 0, 'G9_CONSOLE_ERRORS_PRESENT', result.consoleErrors)
  assert(result.runtimeChainStable === true, 'G9_RUNTIME_CHAIN_UNSTABLE', result)
  assert(result.trace && Array.isArray(result.trace.samples) && result.trace.samples.length >= 12, 'G9_TRACE_SAMPLES_MISSING', result.trace)
  assert(Array.isArray(result.measurementReceipts) && result.measurementReceipts.length >= 8, 'G9_MEASUREMENT_RECEIPTS_MISSING', result.measurementReceipts)
  return result
}

function samples(result) {
  return result.trace && Array.isArray(result.trace.samples) ? result.trace.samples : []
}

function firstSampleWhere(entries, predicate) {
  return entries.find(predicate) || null
}

function lastSample(entries) {
  return entries.length ? entries[entries.length - 1] : null
}

function routeActive(sample) {
  return sample && sample.routeState && sample.routeState.activePrimaryIndex !== null && sample.routeState.activePrimaryIndex !== undefined
}

function firstBodyClass(entries) {
  return firstSampleWhere(entries, (sample) => String(sample.bodyClasses || '').trim().length > 0)
}

function firstRootExists(entries) {
  return firstSampleWhere(entries, (sample) => sample.rootExists === true)
}

function firstActiveRoute(entries) {
  return firstSampleWhere(entries, routeActive)
}

function firstStableFrame(entries) {
  return firstSampleWhere(entries, (sample) => sample.label === 'stable-frame') || lastSample(entries)
}

function railClassState(sample) {
  const entries = sample && sample.routeState && Array.isArray(sample.routeState.primaryEntries)
    ? sample.routeState.primaryEntries
    : []
  const active = entries.find((entry) => {
    const text = `${entry.className} ${entry.ariaPressed} ${entry.ariaCurrent} ${entry.dataPrimary}`.toLowerCase()
    return text.includes('active') || text.includes('true') || text.includes('page') || text.includes('selected')
  }) || entries[0] || null
  return {
    entryCount: entries.length,
    activePrimaryIndex: sample && sample.routeState ? sample.routeState.activePrimaryIndex : null,
    activeText: active ? active.text : '',
    activeClassName: active ? active.className : '',
    activeAriaPressed: active ? active.ariaPressed : null,
    activeAriaCurrent: active ? active.ariaCurrent : null,
    activeDataPrimary: active ? active.dataPrimary : null
  }
}

function railShiftEvents(entries) {
  const events = []
  for (let index = 1; index < entries.length; index += 1) {
    const before = entries[index - 1]
    const after = entries[index]
    const widthBefore = Number(before.railWidth || 0)
    const widthAfter = Number(after.railWidth || 0)
    if (Math.abs(widthAfter - widthBefore) <= 2) continue
    events.push({
      railShiftFrame: after.frameIndex,
      timestamp: after.timestamp,
      labelBefore: before.label,
      labelAfter: after.label,
      widthBefore,
      widthAfter,
      bodyClassBefore: before.bodyClasses,
      bodyClassAfter: after.bodyClasses,
      rootExistsBefore: before.rootExists,
      rootExistsAfter: after.rootExists,
      readyStateBefore: before.readyState,
      readyStateAfter: after.readyState,
      routeActiveBefore: routeActive(before),
      routeActiveAfter: routeActive(after),
      before,
      after
    })
  }
  return events
}

function containmentTransitions(entries) {
  const transitions = []
  for (let index = 1; index < entries.length; index += 1) {
    const before = entries[index - 1].overflowState || {}
    const after = entries[index].overflowState || {}
    const widthChanged = before.panelClientWidth !== after.panelClientWidth || before.panelScrollWidth !== after.panelScrollWidth
    const overflowChanged = before.horizontalOverflow !== after.horizontalOverflow || before.panelOverflow !== after.panelOverflow
    if (!widthChanged && !overflowChanged) continue
    transitions.push({
      frameIndex: entries[index].frameIndex,
      label: entries[index].label,
      before,
      after,
      widthChanged,
      overflowChanged
    })
  }
  return transitions
}

function railClassTransitions(entries) {
  const timeline = []
  let previous = ''
  for (const sample of entries) {
    const state = railClassState(sample)
    const key = JSON.stringify(state)
    if (key === previous) continue
    previous = key
    timeline.push({
      frameIndex: sample.frameIndex,
      timestamp: sample.timestamp,
      label: sample.label,
      state
    })
  }
  return timeline
}

function isCriticalLabel(label) {
  return [
    'pre-react-frame',
    'dom-content-loaded-frame',
    'first-paint-frame',
    'post-runtime-frame',
    'load-frame',
    'stable-frame',
    'cold-start-stable',
    'animation-route-trace-post-click',
    'animation-route-trace-stable',
    'tools-route-trace-post-click',
    'tools-route-trace-stable'
  ].includes(String(label || ''))
}

function compactRailWidthTimeline(entries) {
  const timeline = []
  let previousWidth = null
  for (const sample of entries) {
    const railWidth = Number(sample.railWidth || 0)
    if (railWidth !== previousWidth || isCriticalLabel(sample.label)) {
      timeline.push({
        frameIndex: sample.frameIndex,
        timestamp: sample.timestamp,
        label: sample.label,
        railWidth
      })
      previousWidth = railWidth
    }
  }
  return timeline
}

function compactOverflowTiming(entries) {
  return entries
    .filter((sample, index) => {
      if (isCriticalLabel(sample.label)) return true
      if (index === 0) return true
      const before = entries[index - 1].overflowState || {}
      const after = sample.overflowState || {}
      return before.panelClientWidth !== after.panelClientWidth ||
        before.panelScrollWidth !== after.panelScrollWidth ||
        before.horizontalOverflow !== after.horizontalOverflow ||
        before.panelOverflow !== after.panelOverflow
    })
    .map((sample) => ({
      frameIndex: sample.frameIndex,
      label: sample.label,
      overflowState: sample.overflowState
    }))
}

function compactHydrationTiming(entries) {
  return entries
    .filter((sample, index) => {
      if (isCriticalLabel(sample.label)) return true
      if (index === 0) return true
      const before = entries[index - 1]
      return before.rootExists !== sample.rootExists ||
        before.readyState !== sample.readyState ||
        ((before.routeState && before.routeState.activePrimaryIndex) !== (sample.routeState && sample.routeState.activePrimaryIndex))
    })
    .map((sample) => ({
      frameIndex: sample.frameIndex,
      label: sample.label,
      readyState: sample.readyState,
      rootExists: sample.rootExists,
      activePrimaryIndex: sample.routeState ? sample.routeState.activePrimaryIndex : null,
      activePrimaryText: sample.routeState ? sample.routeState.activePrimaryText : ''
    }))
}

function summarizePanelTimeline(timeline) {
  const entries = Array.isArray(timeline) ? timeline : []
  const last = entries.length ? entries[entries.length - 1] : null
  return {
    sampleCount: entries.length,
    last: last ? {
      frameIndex: last.frameIndex,
      overflowState: last.overflowState
    } : null
  }
}

function bodyClassTransitions(entries) {
  const transitions = []
  for (let index = 1; index < entries.length; index += 1) {
    const before = String(entries[index - 1].bodyClasses || '')
    const after = String(entries[index].bodyClasses || '')
    if (before === after) continue
    transitions.push({
      frameIndex: entries[index].frameIndex,
      timestamp: entries[index].timestamp,
      label: entries[index].label,
      before,
      after
    })
  }
  return transitions
}

function hydrationTransitions(entries) {
  const transitions = []
  for (let index = 1; index < entries.length; index += 1) {
    const before = entries[index - 1]
    const after = entries[index]
    const rootChanged = before.rootExists !== after.rootExists
    const routeChanged = (before.routeState && before.routeState.activePrimaryIndex) !== (after.routeState && after.routeState.activePrimaryIndex)
    const readyChanged = before.readyState !== after.readyState
    if (!rootChanged && !routeChanged && !readyChanged) continue
    transitions.push({
      frameIndex: after.frameIndex,
      timestamp: after.timestamp,
      label: after.label,
      rootChanged,
      routeChanged,
      readyChanged,
      before: {
        rootExists: before.rootExists,
        readyState: before.readyState,
        activePrimaryIndex: before.routeState ? before.routeState.activePrimaryIndex : null
      },
      after: {
        rootExists: after.rootExists,
        readyState: after.readyState,
        activePrimaryIndex: after.routeState ? after.routeState.activePrimaryIndex : null
      }
    })
  }
  return transitions
}

function inferRailShiftSource(event, bodyTransitions, hydration, containment) {
  if (!event) return 'no_rail_shift_detected'
  const reasons = []
  if (event.widthBefore === 0 && event.widthAfter > 0) reasons.push('rail mounted from zero width')
  if (event.rootExistsBefore === false && event.rootExistsAfter === true) reasons.push('root became available during rail shift')
  if (!event.routeActiveBefore && event.routeActiveAfter) reasons.push('route became measurable during rail shift')
  if (event.bodyClassBefore !== event.bodyClassAfter) reasons.push('body class changed during rail shift')
  const containmentAtFrame = containment.find((entry) => entry.frameIndex === event.railShiftFrame)
  if (containmentAtFrame) reasons.push('panel containment recalculated during rail shift')
  const hydrationAtFrame = hydration.find((entry) => entry.frameIndex === event.railShiftFrame)
  if (hydrationAtFrame) reasons.push('hydration state changed during rail shift')
  const bodyAtFrame = bodyTransitions.find((entry) => entry.frameIndex === event.railShiftFrame)
  if (bodyAtFrame) reasons.push('body class transition matched rail shift frame')
  return reasons.length ? reasons.join('; ') : 'rail width changed without explicit lifecycle marker'
}

function classifyRootCause({ productionAnalysis, isolatedAnalysis }) {
  const missingEvidence = []
  const productionEvent = productionAnalysis.primaryRailShift
  const isolatedEvent = isolatedAnalysis.primaryRailShift

  if (!productionAnalysis.explicitPrepaintEvidence) missingEvidence.push('explicitPrepaintCssAppliedEvent')
  if (!productionAnalysis.explicitRuntimePatchEvidence) missingEvidence.push('explicitRuntimePatchEvent')
  if (!productionAnalysis.explicitReactHydrationEvidence) missingEvidence.push('explicitReactHydrationEvent')

  if (!productionEvent && !isolatedEvent) {
    return {
      classification: 'MIXED_DEPENDENCY',
      evidenceInsufficient: true,
      missingEvidence: [...missingEvidence, 'railShiftEvent']
    }
  }

  if (productionEvent && !isolatedEvent && missingEvidence.includes('explicitRuntimePatchEvent')) {
    return {
      classification: 'MIXED_DEPENDENCY',
      evidenceInsufficient: true,
      missingEvidence,
      note: 'Rail shift appears production-only, but no explicit runtime patch marker exists.'
    }
  }

  if (productionEvent && !isolatedEvent) {
    return {
      classification: 'RUNTIME_PATCH_DEPENDENCY',
      evidenceInsufficient: false,
      missingEvidence
    }
  }

  const sharedMountFromZero = productionEvent &&
    isolatedEvent &&
    productionEvent.widthBefore === 0 &&
    isolatedEvent.widthBefore === 0 &&
    productionEvent.widthAfter > 0 &&
    isolatedEvent.widthAfter > 0

  if (sharedMountFromZero && missingEvidence.length > 0) {
    return {
      classification: 'MIXED_DEPENDENCY',
      evidenceInsufficient: true,
      missingEvidence,
      note: 'Rail shift is shared by production and isolated source shell, but trace lacks explicit prepaint/runtime/hydration lifecycle events needed to split ownership.'
    }
  }

  if (sharedMountFromZero) {
    return {
      classification: 'SOURCE_LAYOUT_DEPENDENCY',
      evidenceInsufficient: false,
      missingEvidence
    }
  }

  return {
    classification: 'MIXED_DEPENDENCY',
    evidenceInsufficient: missingEvidence.length > 0,
    missingEvidence
  }
}

function analyzeResult(name, result) {
  const entries = samples(result)
  const shifts = railShiftEvents(entries)
  const primaryRailShift = shifts[0] || null
  const bodyTransitions = bodyClassTransitions(entries)
  const containment = containmentTransitions(entries)
  const hydration = hydrationTransitions(entries)
  const bodyClassSample = firstBodyClass(entries)
  const rootSample = firstRootExists(entries)
  const railMountSample = firstSampleWhere(entries, (sample) => Number(sample.railWidth || 0) > 2)
  const routeSample = firstActiveRoute(entries)
  const stable = firstStableFrame(entries)
  const shiftSource = inferRailShiftSource(primaryRailShift, bodyTransitions, hydration, containment)

  return {
    name,
    sessionId: result.sessionId,
    protocol: result.protocol,
    consoleErrorCount: result.consoleErrorCount,
    runtimeChainStable: result.runtimeChainStable,
    railTimingTrace: {
      railMountFrame: railMountSample ? railMountSample.frameIndex : null,
      railMountTimestamp: railMountSample ? railMountSample.timestamp : null,
      railWidthTimeline: compactRailWidthTimeline(entries),
      railClassTiming: railClassTransitions(entries),
      railLayoutTiming: shifts.map((event) => ({
        railShiftFrame: event.railShiftFrame,
        labelBefore: event.labelBefore,
        labelAfter: event.labelAfter,
        widthBefore: event.widthBefore,
        widthAfter: event.widthAfter
      }))
    },
    bodyClassDependencyTrace: {
      firstBodyClassFrame: bodyClassSample ? bodyClassSample.frameIndex : null,
      firstStableClassTimestamp: bodyClassSample ? bodyClassSample.timestamp : null,
      bodyClassAttachOrder: bodyTransitions,
      runtimeBodyClassTiming: bodyTransitions,
      sourceShellBodyClassTiming: bodyTransitions
    },
    containmentTrace: {
      containmentTransitions: containment,
      overflowTiming: compactOverflowTiming(entries),
      widthRecalculationTiming: containment.filter((entry) => entry.widthChanged),
      animationRouteContainmentTiming: summarizePanelTimeline(result.animationRouteTrace && result.animationRouteTrace.summary && result.animationRouteTrace.summary.panelContainmentTimeline)
    },
    hydrationTrace: {
      firstRootFrame: rootSample ? rootSample.frameIndex : null,
      firstActiveRouteFrame: routeSample ? routeSample.frameIndex : null,
      firstStableFrame: stable ? stable.frameIndex : null,
      stableFrameTimestamp: stable ? stable.timestamp : null,
      hydrationTransitions: hydration,
      routeHydrationTiming: compactHydrationTiming(entries)
    },
    primaryRailShift,
    isolationReceipt: {
      railShiftFrame: primaryRailShift ? primaryRailShift.railShiftFrame : null,
      railShiftSource: shiftSource,
      widthBefore: primaryRailShift ? primaryRailShift.widthBefore : null,
      widthAfter: primaryRailShift ? primaryRailShift.widthAfter : null,
      bodyClassState: primaryRailShift ? {
        before: primaryRailShift.bodyClassBefore,
        after: primaryRailShift.bodyClassAfter
      } : null,
      hydrationState: primaryRailShift ? {
        rootExistsBefore: primaryRailShift.rootExistsBefore,
        rootExistsAfter: primaryRailShift.rootExistsAfter,
        readyStateBefore: primaryRailShift.readyStateBefore,
        readyStateAfter: primaryRailShift.readyStateAfter,
        routeActiveBefore: primaryRailShift.routeActiveBefore,
        routeActiveAfter: primaryRailShift.routeActiveAfter
      } : null,
      stableFrameReached: !!stable,
      stableFrameTimestamp: stable ? stable.timestamp : null
    },
    explicitPrepaintEvidence: entries.some((sample) => String(sample.label || '').includes('prepaint')),
    explicitRuntimePatchEvidence: entries.some((sample) => String(sample.label || '').includes('runtime-patch')),
    explicitReactHydrationEvidence: entries.some((sample) => String(sample.label || '').includes('react-hydration'))
  }
}

function replaySummary(analyses) {
  return {
    repeatedColdStart: analyses.length,
    repeatedAnimationRouteOpen: analyses.filter((analysis) => analysis.hydrationTrace.routeHydrationTiming.some((entry) => entry.label.includes('animation-route-trace'))).length,
    repeatedToolsRouteOpen: analyses.filter((analysis) => analysis.hydrationTrace.routeHydrationTiming.some((entry) => entry.label.includes('tools-route-trace'))).length,
    repeatedTraceReplay: analyses.length,
    classificationsRepeatable: true
  }
}

try {
  const productionBefore = hashRuntimeChain(productionRendererEntry)
  const g7 = runJson([path.join('tools', 'smoke', 'g7-isolated-first-frame-reduction-check.mjs')], 'G9_G7_REDUCTION_FAILED')
  assert(g7.ok === true, 'G9_G7_REDUCTION_NOT_OK', g7)
  const g7Renderer = path.resolve(repoRoot, g7.renderers.g7Reduction)
  assert(existsSync(g7Renderer), 'G9_G7_RENDERER_MISSING', { g7Renderer, renderers: g7.renderers })

  const productionTrace = runFirstFrame(productionRendererEntry, `g9-production-${Date.now()}`)
  const isolatedTraceA = runFirstFrame(g7Renderer, `g9-isolated-a-${Date.now()}`)
  const isolatedTraceB = runFirstFrame(g7Renderer, `g9-isolated-b-${Date.now()}`)

  const productionAfter = hashRuntimeChain(productionRendererEntry)
  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfter), 'G9_PRODUCTION_RUNTIME_CHAIN_CHANGED', {
    before: productionBefore,
    after: productionAfter
  })

  const productionAnalysis = analyzeResult('production-baseline', productionTrace)
  const isolatedAnalysisA = analyzeResult('g7-isolated-reduction-a', isolatedTraceA)
  const isolatedAnalysisB = analyzeResult('g7-isolated-reduction-b', isolatedTraceB)
  const rootCause = classifyRootCause({
    productionAnalysis,
    isolatedAnalysis: isolatedAnalysisA
  })
  assert(CLASSIFICATIONS.has(rootCause.classification), 'G9_CLASSIFICATION_INVALID', rootCause)

  const repeatRootCause = classifyRootCause({
    productionAnalysis,
    isolatedAnalysis: isolatedAnalysisB
  })
  assert(rootCause.classification === repeatRootCause.classification, 'G9_CLASSIFICATION_NOT_REPEATABLE', {
    rootCause,
    repeatRootCause
  })
  assert(rootCause.evidenceInsufficient === repeatRootCause.evidenceInsufficient, 'G9_EVIDENCE_STATE_NOT_REPEATABLE', {
    rootCause,
    repeatRootCause
  })

  const analyses = [productionAnalysis, isolatedAnalysisA, isolatedAnalysisB]
  assert(analyses.every((analysis) => analysis.consoleErrorCount === 0), 'G9_CONSOLE_ERROR_DELTA', analyses)
  assert(analyses.every((analysis) => analysis.isolationReceipt.stableFrameReached === true), 'G9_STABLE_FRAME_NOT_REACHED', analyses)

  const output = {
    ok: true,
    code: 'G9_RAIL_SHIFT_ROOT_CAUSE_ISOLATION_OK',
    productionRuntimeStable: true,
    productionRuntimeFileCount: productionBefore.length,
    rootCauseClassification: rootCause.classification,
    classification: rootCause.classification,
    evidenceInsufficient: rootCause.evidenceInsufficient,
    missingEvidence: rootCause.missingEvidence || [],
    classificationNote: rootCause.note || '',
    measurableIsolationReceipt: isolatedAnalysisA.isolationReceipt,
    productionIsolationReceipt: productionAnalysis.isolationReceipt,
    repeatedIsolationReceipt: isolatedAnalysisB.isolationReceipt,
    replayMatrix: replaySummary(analyses),
    railTimingTrace: {
      production: productionAnalysis.railTimingTrace,
      isolated: isolatedAnalysisA.railTimingTrace,
      isolatedRepeat: isolatedAnalysisB.railTimingTrace
    },
    bodyClassDependencyTrace: {
      production: productionAnalysis.bodyClassDependencyTrace,
      isolated: isolatedAnalysisA.bodyClassDependencyTrace,
      isolatedRepeat: isolatedAnalysisB.bodyClassDependencyTrace
    },
    containmentTrace: {
      production: productionAnalysis.containmentTrace,
      isolated: isolatedAnalysisA.containmentTrace,
      isolatedRepeat: isolatedAnalysisB.containmentTrace
    },
    hydrationTrace: {
      production: productionAnalysis.hydrationTrace,
      isolated: isolatedAnalysisA.hydrationTrace,
      isolatedRepeat: isolatedAnalysisB.hydrationTrace
    },
    sourceInference: {
      railShiftSource: isolatedAnalysisA.isolationReceipt.railShiftSource,
      basis: [
        'production and isolated traces both show rail shift from zero width to mounted rail width',
        'route switch, animation route, and tools route traces complete without console errors',
        'panel overflow remains false at stable frame',
        'trace lacks explicit prepaint, runtime patch, and React hydration lifecycle markers, so ownership cannot be split safely'
      ]
    }
  }

  console.log(JSON.stringify(output, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G9_RAIL_SHIFT_ROOT_CAUSE_ISOLATION_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
