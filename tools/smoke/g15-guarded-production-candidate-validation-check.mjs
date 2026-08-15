import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const productionRendererEntry = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html')
const outputRoot = path.join(repoRoot, 'debug-output', 'guarded-production-candidate-validation-2026-05-17')

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
    if (!resolved || !/\.(js|css|ico)$/i.test(resolved)) continue
    if (existsSync(resolved)) files.set(resolved, true)
  }
  return Array.from(files.keys()).sort()
}

function hashRuntimeChain() {
  return runtimeChainFiles(productionRendererEntry).map((file) => ({
    path: path.relative(repoRoot, file).replace(/\\/g, '/'),
    sha256: sha256(file)
  }))
}

function parseJsonOutput(stdout) {
  const trimmed = String(stdout || '').trim()
  const start = trimmed.lastIndexOf('\n{')
  const jsonText = start >= 0 ? trimmed.slice(start + 1) : trimmed
  return JSON.parse(jsonText)
}

function runChecker(script, code) {
  const run = spawnSync(process.execPath, [path.join('tools', 'smoke', script)], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 64
  })
  if (run.status !== 0) {
    if (run.stdout) process.stdout.write(run.stdout)
    if (run.stderr) process.stderr.write(run.stderr)
  }
  assert(run.status === 0, code, { status: run.status, stdout: run.stdout, stderr: run.stderr })
  return parseJsonOutput(run.stdout || '')
}

try {
  const sessionId = `g15-guarded-candidate-${Date.now()}`
  const sessionDir = path.join(outputRoot, sessionId)
  mkdirSync(sessionDir, { recursive: true })

  const runtimeBefore = hashRuntimeChain()
  const review = runChecker('g13d-final-isolated-expansion-review-check.mjs', 'G15_G13D_REVIEW_FAILED')
  const runtimeAfter = hashRuntimeChain()

  assert(JSON.stringify(runtimeBefore) === JSON.stringify(runtimeAfter), 'G15_RUNTIME_CHAIN_CHANGED', {
    before: runtimeBefore,
    after: runtimeAfter
  })
  assert(review.ok === true, 'G15_REVIEW_NOT_OK', review)
  assert(review.summary.shellIsolatedStatus.ok === true, 'G15_SHELL_STATUS_NOT_OK', review.summary.shellIsolatedStatus)
  assert(review.summary.aifxIsolatedStatus.ok === true, 'G15_AIFX_STATUS_NOT_OK', review.summary.aifxIsolatedStatus)
  assert(review.summary.toolsCandidateStatus.ok === true, 'G15_TOOLS_STATUS_NOT_OK', review.summary.toolsCandidateStatus)
  assert(review.summary.protectedIslandCompatibility.ok === true, 'G15_PROTECTED_STATUS_NOT_OK', review.summary.protectedIslandCompatibility)
  assert(review.summary.firstFrameStatus.ok === true, 'G15_FIRST_FRAME_STATUS_NOT_OK', review.summary.firstFrameStatus)
  assert(review.summary.protectedIslandCompatibility.consoleErrorMax === 0, 'G15_PROTECTED_CONSOLE_ERRORS', review.summary.protectedIslandCompatibility)
  assert(review.summary.firstFrameStatus.consoleErrorMax === 0, 'G15_FIRST_FRAME_CONSOLE_ERRORS', review.summary.firstFrameStatus)
  assert(review.summary.toolsCandidateStatus.policy.phase5OverwriteExecutionAllowed === false, 'G15_OVERWRITE_POLICY_TRUE')
  assert(review.summary.toolsCandidateStatus.policy.productionLegacyWriteAllowed === false, 'G15_LEGACY_WRITE_POLICY_TRUE')
  assert(review.summary.toolsCandidateStatus.policy.userFileWriteAllowed === false, 'G15_USER_FILE_WRITE_POLICY_TRUE')

  const validationReceipt = {
    replaySource: review.code,
    shellCandidate: review.summary.firstFrameStatus.shellCandidateClassification,
    toolsCandidate: review.summary.toolsCandidateStatus.classification,
    aifxCandidate: review.summary.aifxIsolatedStatus.classification,
    protectedIslandCompatible: review.summary.protectedIslandCompatibility.protectedHashesStable,
    firstFrameLayoutShiftKnown: review.summary.firstFrameStatus.layoutShiftDetected,
    productionRuntimeStable: true,
    noProductionRouteMutation: true,
    noOverwriteEnablement: true,
    noRendererDistPromotion: true
  }

  const blockers = [
    'production migration approval required',
    'baseline first-frame layout shift remains a known blocker',
    'production shell is still runtime-owned',
    'production AIFX is still runtime-owned',
    'overwrite remains disabled'
  ]

  const receipt = {
    sessionId,
    timestamp: new Date().toISOString(),
    classification: 'READY_FOR_GUARDED_PRODUCTION_CANDIDATE_REVIEW',
    readiness: 'READY_FOR_GUARDED_PRODUCTION_CANDIDATE_REVIEW',
    blockers,
    validationReceipt
  }
  const receiptPath = path.join(sessionDir, 'g15-guarded-production-candidate-validation-receipt.json')
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    code: 'G15_GUARDED_PRODUCTION_CANDIDATE_VALIDATION_OK',
    sessionId,
    receiptPath: path.relative(repoRoot, receiptPath).replace(/\\/g, '/'),
    classification: receipt.classification,
    readiness: receipt.readiness,
    blockers,
    validationReceipt
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G15_GUARDED_PRODUCTION_CANDIDATE_VALIDATION_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
