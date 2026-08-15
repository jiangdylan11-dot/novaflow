import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')

const protectedFiles = [
  path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'spine-split-runtime.js'),
  path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'spine-official-runtime.js'),
  path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'ribbon-event-markers.js')
]

const requiredReceiptTypes = [
  'pointer-down-move-up',
  'drag-drop-import',
  'canvas-zoom',
  'canvas-pan',
  'layer-reorder-attempt',
  'split-editor-open-close-trace'
]

const requiredReceiptFields = [
  'interactionType',
  'beforeState',
  'afterState',
  'consoleErrorCount',
  'pointerCaptureResult',
  'dropAccepted',
  'dropRejected',
  'panDelta',
  'zoomDelta',
  'runtimeStability'
]

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase()
}

function protectedHashes() {
  return protectedFiles.map((file) => ({
    path: path.relative(repoRoot, file).replace(/\\/g, '/'),
    sha256: sha256(file)
  }))
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
  const match = stdout.match(/__NOVAFLOW_G2_PROTECTED_RESULT__(.*)__END_NOVAFLOW_G2_PROTECTED_RESULT__/s)
  assert(match, 'G2_RESULT_MISSING')
  return JSON.parse(match[1])
}

function runHarness(index) {
  const sessionId = `g2-protected-island-check-${Date.now()}-${index}`
  const run = spawnSync(process.execPath, [
    path.join('tools', 'smoke', 'protected-island-harness-runner.mjs'),
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
  assert(run.status === 0, 'G2_RUNNER_FAILED', { status: run.status, stdout: run.stdout, stderr: run.stderr })
  return parseResult(run.stdout || '')
}

function validateReceipt(receipt) {
  for (const field of requiredReceiptFields) {
    assert(Object.prototype.hasOwnProperty.call(receipt, field), 'G2_RECEIPT_FIELD_MISSING', { field, receipt })
  }
  assert(receipt.beforeState && receipt.beforeState.rootExists === true, 'G2_RECEIPT_BEFORE_STATE_INVALID', receipt)
  assert(receipt.afterState && receipt.afterState.rootExists === true, 'G2_RECEIPT_AFTER_STATE_INVALID', receipt)
  assert(receipt.consoleErrorCount === 0, 'G2_RECEIPT_CONSOLE_ERRORS', receipt)
  assert(receipt.runtimeStability === true, 'G2_RECEIPT_RUNTIME_UNSTABLE', receipt)
}

function validateRun(result, beforeHashes, afterHashes) {
  assert(result.ok === true, 'G2_RESULT_NOT_OK', result)
  assert(result.protocol === 'file:', 'G2_NOT_PACKAGED_FILE_PROTOCOL', { protocol: result.protocol })
  assert(result.consoleErrorCount === 0, 'G2_CONSOLE_ERRORS_PRESENT', result.consoleErrors)
  assert(result.protectedHashesStable === true, 'G2_RESULT_HASH_UNSTABLE', result)
  assert(JSON.stringify(beforeHashes) === JSON.stringify(afterHashes), 'G2_PROTECTED_FILES_CHANGED', { beforeHashes, afterHashes })
  assert(result.runtimeStability === true, 'G2_RUNTIME_UNSTABLE', result)
  assert(Array.isArray(result.fixtures) && result.fixtures.length >= 5, 'G2_FIXTURES_MISSING', result.fixtures)
  assert(Array.isArray(result.receipts), 'G2_RECEIPTS_NOT_ARRAY')

  for (const type of requiredReceiptTypes) {
    assert(result.receiptTypes.includes(type), 'G2_REQUIRED_RECEIPT_MISSING', { type, receiptTypes: result.receiptTypes })
  }
  for (const receipt of result.receipts) validateReceipt(receipt)
}

try {
  const baseline = protectedHashes()
  const results = []
  for (let index = 1; index <= 2; index += 1) {
    const before = protectedHashes()
    assert(JSON.stringify(baseline) === JSON.stringify(before), 'G2_BASELINE_CHANGED_BEFORE_RUN', { baseline, before })
    const result = runHarness(index)
    const after = protectedHashes()
    validateRun(result, before, after)
    results.push({
      sessionId: result.sessionId,
      receiptCount: result.receipts.length,
      receiptTypes: result.receiptTypes,
      consoleErrorCount: result.consoleErrorCount,
      protectedHashesStable: result.protectedHashesStable,
      runtimeStability: result.runtimeStability
    })
  }

  console.log(JSON.stringify({
    ok: true,
    code: 'G2_PROTECTED_ISLAND_HARNESS_OK',
    repeatableRuns: results.length,
    protectedFiles: baseline,
    results
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G2_PROTECTED_ISLAND_HARNESS_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
