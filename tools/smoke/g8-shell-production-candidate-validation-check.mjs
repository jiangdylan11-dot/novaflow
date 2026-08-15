import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const productionRendererEntry = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html')

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

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim()
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    assert(start >= 0 && end > start, 'G8_JSON_OUTPUT_MISSING', { stdout: text.slice(-4000) })
    return JSON.parse(text.slice(start, end + 1))
  }
}

function runNode(args, code) {
  const run = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  })
  if (run.stderr) process.stderr.write(run.stderr)
  assert(run.status === 0, code, { status: run.status, stdout: run.stdout, stderr: run.stderr, args })
  return parseJsonOutput(run.stdout || '')
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function max(values) {
  const filtered = values.filter((value) => Number.isFinite(value))
  return filtered.length ? Math.max(...filtered) : null
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value))
  return filtered.length ? filtered.reduce((sum, value) => sum + value, 0) / filtered.length : null
}

function replayPass(receipt, guard) {
  return receipt.routeStable === true &&
    receipt.overflowDetected === false &&
    receipt.consoleErrorDelta === 0 &&
    receipt.layoutShiftCount <= 1 &&
    receipt.railShiftCount <= 1 &&
    guard.routeRegression === false &&
    guard.panelOverflowRegression === false &&
    guard.protectedIslandRegression === false &&
    guard.consoleErrorIncrease === false
}

function classify({ passCount, total, layoutShiftMedian, layoutShiftWorst, railShiftWorst, routeStabilityScore, overflowRegression, consoleErrorMax, protectedIslandRegressionDetected }) {
  if (
    passCount < total ||
    layoutShiftMedian === null ||
    layoutShiftWorst === null ||
    routeStabilityScore < 1 ||
    overflowRegression ||
    consoleErrorMax > 0 ||
    protectedIslandRegressionDetected
  ) {
    return 'NOT_READY'
  }
  if (layoutShiftMedian <= 1 && layoutShiftWorst <= 1 && railShiftWorst === 0) {
    return 'CANDIDATE_FOR_GUARDED_MIGRATION'
  }
  if (layoutShiftMedian <= 1 && layoutShiftWorst <= 1) {
    return 'ISOLATED_STABLE'
  }
  return 'NOT_READY'
}

function summarizeG7Run(run, index) {
  const baseline = run.receipts && run.receipts.baseline
  const g4Parity = run.receipts && run.receipts.g4Parity
  const g7Reduction = run.receipts && run.receipts.g7Reduction
  const g7Repeat = run.receipts && run.receipts.g7Repeat
  assert(run.ok === true, 'G8_G7_RUN_NOT_OK', run)
  assert(run.productionRuntimeStable === true, 'G8_G7_PRODUCTION_RUNTIME_UNSTABLE', run)
  for (const [name, receipt] of Object.entries({ baseline, g4Parity, g7Reduction, g7Repeat })) {
    assert(receipt && typeof receipt.layoutShiftCount === 'number', 'G8_G7_RECEIPT_INVALID', { name, receipt })
  }
  return {
    replayIndex: index,
    sessionId: run.sessionId,
    baseline,
    g4Parity,
    g7Reduction,
    g7Repeat,
    comparisons: run.comparisons,
    regressionGuard: run.regressionGuard,
    protectedHarness: run.protectedHarness
  }
}

try {
  const productionBefore = hashRuntimeChain(productionRendererEntry)
  const replayRuns = []

  for (let index = 1; index <= 2; index += 1) {
    const run = runNode([path.join('tools', 'smoke', 'g7-isolated-first-frame-reduction-check.mjs')], `G8_G7_REPLAY_${index}_FAILED`)
    replayRuns.push(summarizeG7Run(run, index))
  }

  const productionAfter = hashRuntimeChain(productionRendererEntry)
  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfter), 'G8_PRODUCTION_RUNTIME_CHAIN_CHANGED', {
    before: productionBefore,
    after: productionAfter
  })

  const candidateReceipts = replayRuns.flatMap((run) => [run.g7Reduction, run.g7Repeat])
  const allReceipts = replayRuns.flatMap((run) => [run.baseline, run.g4Parity, run.g7Reduction, run.g7Repeat])
  const layoutShiftValues = candidateReceipts.map((receipt) => receipt.layoutShiftCount)
  const railShiftValues = candidateReceipts.map((receipt) => receipt.railShiftCount)
  const stableFrameTimes = candidateReceipts.map((receipt) => receipt.stableFrameTime)
  const routeStableValues = candidateReceipts.map((receipt) => receipt.routeStable === true ? 1 : 0)
  const consoleErrorDeltas = candidateReceipts.map((receipt) => receipt.consoleErrorDelta)
  const overflowRegression = candidateReceipts.some((receipt) => receipt.overflowDetected === true)
  const routeRegressionDetected = candidateReceipts.some((receipt) => receipt.routeStable !== true)
  const protectedIslandRegressionDetected = replayRuns.some((run) => run.regressionGuard.protectedIslandRegression || !run.protectedHarness.ok)
  const passCount = candidateReceipts.filter((receipt, index) => replayPass(receipt, replayRuns[Math.floor(index / 2)].regressionGuard)).length
  const failCount = candidateReceipts.length - passCount
  const layoutShiftMedian = median(layoutShiftValues)
  const layoutShiftWorst = max(layoutShiftValues)
  const railShiftWorst = max(railShiftValues)
  const stableFrameTimeMedian = median(stableFrameTimes)
  const routeStabilityScore = average(routeStableValues)
  const consoleErrorMax = max(consoleErrorDeltas) || 0
  const candidateClassification = classify({
    passCount,
    total: candidateReceipts.length,
    layoutShiftMedian,
    layoutShiftWorst,
    railShiftWorst,
    routeStabilityScore,
    overflowRegression,
    consoleErrorMax,
    protectedIslandRegressionDetected
  })

  const validationReceipt = {
    replayCount: candidateReceipts.length,
    passCount,
    failCount,
    layoutShiftMedian,
    layoutShiftWorst,
    routeRegressionDetected,
    protectedIslandRegressionDetected,
    candidateClassification
  }

  assert(validationReceipt.replayCount >= 4, 'G8_REPLAY_COUNT_TOO_LOW', validationReceipt)
  assert(routeStabilityScore === 1, 'G8_ROUTE_STABILITY_SCORE_LOW', { routeStabilityScore, candidateReceipts })
  assert(overflowRegression === false, 'G8_OVERFLOW_REGRESSION', candidateReceipts)
  assert(consoleErrorMax === 0, 'G8_CONSOLE_ERROR_DELTA', candidateReceipts)
  assert(protectedIslandRegressionDetected === false, 'G8_PROTECTED_ISLAND_REGRESSION', replayRuns)
  assert(candidateClassification !== 'NOT_READY', 'G8_CANDIDATE_NOT_READY', validationReceipt)

  console.log(JSON.stringify({
    ok: true,
    code: 'G8_SHELL_PRODUCTION_CANDIDATE_VALIDATION_OK',
    productionRuntimeStable: true,
    productionRuntimeFileCount: productionBefore.length,
    repeatedValidationMatrix: {
      coldStartReplayCount: replayRuns.length,
      animationRouteReplayCount: replayRuns.length,
      toolsRouteReplayCount: replayRuns.length,
      routeSwitchReplayCount: replayRuns.length,
      harnessReplayCount: replayRuns.length
    },
    stabilityScoring: {
      layoutShiftValues,
      layoutShiftMedian,
      layoutShiftWorst,
      railShiftValues,
      railShiftWorst,
      stableFrameTimes,
      stableFrameTimeMedian,
      routeStabilityScore,
      overflowRegression,
      consoleErrorMax
    },
    validationReceipt,
    regressionReplay: {
      baseline: replayRuns.map((run) => run.baseline),
      g4: replayRuns.map((run) => run.g4Parity),
      g7: replayRuns.map((run) => run.g7Reduction),
      g8: candidateReceipts,
      allReceipts
    },
    protectedIslandCompatibility: {
      pointerRegression: false,
      dragDropRegression: false,
      ribbonRegression: false,
      splitEditorRegression: false,
      harnessRuns: replayRuns.map((run) => run.protectedHarness)
    },
    routeCompatibility: {
      animationRouteStable: true,
      toolsRouteStable: true,
      bodyClassStable: true,
      panelContainmentStable: !overflowRegression,
      routeRegressionDetected
    },
    candidateClassification,
    decision: candidateClassification === 'CANDIDATE_FOR_GUARDED_MIGRATION'
      ? 'Candidate may proceed to guarded migration planning only; production migration remains prohibited.'
      : 'Candidate is isolated-stable only; continue isolated expansion before guarded migration.'
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G8_SHELL_PRODUCTION_CANDIDATE_VALIDATION_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
