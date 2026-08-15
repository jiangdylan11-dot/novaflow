import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareFirstFrameTraces } from './first-frame-trace-compare.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const rendererEntry = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html')

const requiredReceiptFields = [
  'timestamp',
  'frameIndex',
  'railWidth',
  'bodyClasses',
  'overflowState',
  'routeState',
  'consoleErrorCount',
  'legacyShellDetected',
  'layoutShiftDetected'
]

const requiredLabels = [
  'pre-react-frame',
  'first-paint-frame',
  'post-runtime-frame',
  'stable-frame'
]

const requiredTraceTypes = [
  'cold-start',
  'route-switch-trace',
  'animation-route-trace',
  'tools-route-trace'
]

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase()
}

function assert(condition, code, details = {}) {
  if (!condition) {
    const error = new Error(code)
    error.code = code
    error.details = details
    throw error
  }
}

function parseResult(stdout) {
  const match = stdout.match(/__NOVAFLOW_G3_FIRST_FRAME_RESULT__(.*)__END_NOVAFLOW_G3_FIRST_FRAME_RESULT__/s)
  assert(match, 'G3_RESULT_MISSING')
  return JSON.parse(match[1])
}

function runHarness(index) {
  const sessionId = `g3-first-frame-check-${Date.now()}-${index}`
  const run = spawnSync(process.execPath, [
    path.join('tools', 'smoke', 'first-frame-harness-runner.mjs'),
    '--session',
    sessionId,
    '--timeout-ms',
    '90000'
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  })

  if (run.stderr) process.stderr.write(run.stderr)
  assert(run.status === 0, 'G3_RUNNER_FAILED', { status: run.status, stdout: run.stdout, stderr: run.stderr })
  return parseResult(run.stdout || '')
}

function validateReceipt(receipt) {
  for (const field of requiredReceiptFields) {
    assert(Object.prototype.hasOwnProperty.call(receipt, field), 'G3_RECEIPT_FIELD_MISSING', { field, receipt })
  }
  assert(typeof receipt.timestamp === 'number', 'G3_RECEIPT_TIMESTAMP_INVALID', receipt)
  assert(Number.isInteger(receipt.frameIndex), 'G3_RECEIPT_FRAME_INDEX_INVALID', receipt)
  assert(typeof receipt.railWidth === 'number', 'G3_RECEIPT_RAIL_WIDTH_INVALID', receipt)
  assert(receipt.overflowState && typeof receipt.overflowState === 'object', 'G3_RECEIPT_OVERFLOW_INVALID', receipt)
  assert(receipt.routeState && typeof receipt.routeState === 'object', 'G3_RECEIPT_ROUTE_INVALID', receipt)
  assert(receipt.consoleErrorCount === 0, 'G3_RECEIPT_CONSOLE_ERRORS', receipt)
  assert(typeof receipt.legacyShellDetected === 'boolean', 'G3_RECEIPT_LEGACY_FLAG_INVALID', receipt)
  assert(typeof receipt.layoutShiftDetected === 'boolean', 'G3_RECEIPT_LAYOUT_SHIFT_FLAG_INVALID', receipt)
}

function validateRun(result, rendererShaBefore, rendererShaAfter) {
  assert(result.ok === true, 'G3_RESULT_NOT_OK', result)
  assert(result.protocol === 'file:', 'G3_NOT_PACKAGED_FILE_PROTOCOL', { protocol: result.protocol })
  assert(result.consoleErrorCount === 0, 'G3_CONSOLE_ERRORS_PRESENT', result.consoleErrors)
  assert(result.runtimeChainStable === true, 'G3_RUNTIME_CHAIN_UNSTABLE', result)
  assert(rendererShaBefore === rendererShaAfter, 'G3_RENDERER_ENTRY_CHANGED', { rendererShaBefore, rendererShaAfter })
  assert(Array.isArray(result.runtimeChainBefore) && result.runtimeChainBefore.length >= 4, 'G3_RUNTIME_CHAIN_TOO_SMALL', result.runtimeChainBefore)
  assert(JSON.stringify(result.runtimeChainBefore) === JSON.stringify(result.runtimeChainAfter), 'G3_RUNTIME_CHAIN_HASH_CHANGED', {
    before: result.runtimeChainBefore,
    after: result.runtimeChainAfter
  })
  assert(result.trace && Array.isArray(result.trace.samples), 'G3_TRACE_MISSING', result.trace)
  assert(result.trace.samples.length >= 12, 'G3_TRACE_SAMPLE_COUNT_TOO_LOW', { count: result.trace.samples.length })

  const labels = new Set(result.trace.samples.map((sample) => sample.label))
  for (const label of requiredLabels) {
    assert(labels.has(label), 'G3_REQUIRED_FRAME_LABEL_MISSING', { label, labels: [...labels] })
  }

  assert(Array.isArray(result.measurementReceipts) && result.measurementReceipts.length >= 8, 'G3_RECEIPTS_MISSING', result.measurementReceipts)
  const traceTypes = new Set(result.measurementReceipts.map((receipt) => receipt.traceType))
  for (const type of requiredTraceTypes) {
    assert(traceTypes.has(type), 'G3_REQUIRED_TRACE_TYPE_MISSING', { type, traceTypes: [...traceTypes] })
  }
  for (const receipt of result.measurementReceipts) validateReceipt(receipt)

  assert(Array.isArray(result.screenshotSequence) && result.screenshotSequence.length >= 4, 'G3_SCREENSHOT_SEQUENCE_MISSING', result.screenshotSequence)
  for (const screenshot of result.screenshotSequence) {
    assert(typeof screenshot.sha256 === 'string' && screenshot.sha256.length === 64, 'G3_SCREENSHOT_HASH_INVALID', screenshot)
    assert(screenshot.bytes > 0, 'G3_SCREENSHOT_EMPTY', screenshot)
  }
  assert(Array.isArray(result.traceComparisons) && result.traceComparisons.length >= 2, 'G3_TRACE_COMPARISONS_MISSING', result.traceComparisons)
  for (const comparison of result.traceComparisons) {
    assert(comparison.comparable === true, 'G3_TRACE_COMPARISON_NOT_COMPARABLE', comparison)
  }
}

try {
  const rendererShaBaseline = sha256(rendererEntry)
  const results = []

  for (let index = 1; index <= 2; index += 1) {
    const before = sha256(rendererEntry)
    assert(before === rendererShaBaseline, 'G3_BASELINE_CHANGED_BEFORE_RUN', { rendererShaBaseline, before })
    const result = runHarness(index)
    const after = sha256(rendererEntry)
    validateRun(result, before, after)
    results.push(result)
  }

  const repeatedComparison = compareFirstFrameTraces(results[0], results[1])
  assert(repeatedComparison.comparable === true, 'G3_REPEATED_TRACE_NOT_COMPARABLE', repeatedComparison)
  assert(repeatedComparison.missingTraceTypes.length === 0, 'G3_REPEATED_TRACE_TYPE_MISSING', repeatedComparison)
  assert(repeatedComparison.extraTraceTypes.length === 0, 'G3_REPEATED_TRACE_TYPE_EXTRA', repeatedComparison)

  console.log(JSON.stringify({
    ok: true,
    code: 'G3_FIRST_FRAME_HARNESS_OK',
    repeatableRuns: results.length,
    rendererEntry: path.relative(repoRoot, rendererEntry).replace(/\\/g, '/'),
    rendererEntrySha256: rendererShaBaseline,
    comparison: repeatedComparison,
    results: results.map((result) => ({
      sessionId: result.sessionId,
      protocol: result.protocol,
      sampleCount: result.trace.samples.length,
      receiptCount: result.measurementReceipts.length,
      screenshotCount: result.screenshotSequence.length,
      consoleErrorCount: result.consoleErrorCount,
      runtimeChainStable: result.runtimeChainStable,
      runtimeChainFileCount: result.runtimeChainBefore.length
    }))
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G3_FIRST_FRAME_HARNESS_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
