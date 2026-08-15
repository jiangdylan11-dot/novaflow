import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const productionRendererEntry = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html')
const outputRoot = path.join(repoRoot, 'debug-output', 'tools-production-candidate-validation-2026-05-17')

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

function runNode(args, code) {
  const run = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  })
  if (run.stdout) process.stdout.write(run.stdout)
  if (run.stderr) process.stderr.write(run.stderr)
  assert(run.status === 0, code, { status: run.status, stdout: run.stdout, stderr: run.stderr })
  return run.stdout || ''
}

try {
  assert(existsSync(productionRendererEntry), 'G13C_PRODUCTION_ENTRY_MISSING', { productionRendererEntry })
  const sessionId = `g13c-tools-candidate-${Date.now()}`
  const sessionDir = path.join(outputRoot, sessionId)
  mkdirSync(sessionDir, { recursive: true })

  const runtimeBefore = hashRuntimeChain()
  const g1 = parseJsonOutput(runNode([path.join('tools', 'smoke', 'g1-tools-bridge-staged-implementation-check.mjs')], 'G13C_G1_CHECK_FAILED'))
  assert(g1.ok === true, 'G13C_G1_NOT_OK', g1)
  assert(g1.checks && g1.checks.tempExportReceipt === true, 'G13C_TEMP_EXPORT_RECEIPT_NOT_VALIDATED', g1)
  assert(g1.checks.overwriteDisabled === true, 'G13C_OVERWRITE_NOT_DISABLED', g1)
  assert(g1.checks.legacyWriteBlocked === true, 'G13C_LEGACY_WRITE_NOT_BLOCKED', g1)
  assert(g1.checks.rendererPathBlocked === true, 'G13C_RENDERER_PATH_NOT_BLOCKED', g1)
  assert(g1.policy && g1.policy.phase5OverwriteExecutionAllowed === false, 'G13C_PHASE5_OVERWRITE_POLICY_TRUE', g1.policy)
  assert(g1.policy.productionLegacyWriteAllowed === false, 'G13C_PRODUCTION_LEGACY_WRITE_POLICY_TRUE', g1.policy)
  assert(g1.policy.userFileWriteAllowed === false, 'G13C_USER_FILE_WRITE_POLICY_TRUE', g1.policy)
  assert(g1.policy.rendererProvidedOutputDirectoryAllowed === false, 'G13C_RENDERER_DIR_POLICY_TRUE', g1.policy)

  const runtimeAfter = hashRuntimeChain()
  assert(JSON.stringify(runtimeBefore) === JSON.stringify(runtimeAfter), 'G13C_RUNTIME_CHAIN_CHANGED', {
    before: runtimeBefore,
    after: runtimeAfter
  })

  const receipt = {
    sessionId,
    timestamp: new Date().toISOString(),
    classification: 'TOOLS_TEMP_ONLY_PRODUCTION_CANDIDATE_VALIDATED',
    readiness: 'READY_FOR_GUARDED_PRODUCTION_CANDIDATE_REVIEW',
    blockers: [
      'production bridge integration is not executed',
      'overwrite remains disabled',
      'user-file write approval is still forbidden'
    ],
    policy: {
      phase5OverwriteExecutionAllowed: false,
      productionLegacyWriteAllowed: false,
      userFileWriteAllowed: false,
      rendererProvidedOutputDirectoryAllowed: false
    },
    validatedChecks: g1.checks
  }
  const receiptPath = path.join(sessionDir, 'g13c-tools-production-candidate-validation-receipt.json')
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    code: 'G13C_TOOLS_PRODUCTION_CANDIDATE_VALIDATION_OK',
    sessionId,
    receiptPath: path.relative(repoRoot, receiptPath).replace(/\\/g, '/'),
    productionRuntimeStable: true,
    classification: receipt.classification,
    readiness: receipt.readiness,
    blockers: receipt.blockers,
    policy: receipt.policy,
    validatedChecks: receipt.validatedChecks
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G13C_TOOLS_PRODUCTION_CANDIDATE_VALIDATION_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
