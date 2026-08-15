import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const sessionId = `g1-tools-bridge-${Date.now()}`

function assert(condition, code, details = {}) {
  if (!condition) {
    const error = new Error(code)
    error.code = code
    error.details = details
    throw error
  }
}

function parseSmokeResult(stdout) {
  const match = stdout.match(/__NOVAFLOW_SMOKE_RESULT__(.*)__END_NOVAFLOW_SMOKE_RESULT__/s)
  assert(match, 'SMOKE_RESULT_MISSING')
  return JSON.parse(match[1])
}

function hasReceiptFields(receipt) {
  const required = [
    'operationId',
    'timestamp',
    'mode',
    'tempPath',
    'hashBefore',
    'hashAfter',
    'overwriteAttempted',
    'success',
    'typedError'
  ]
  return required.every((field) => Object.prototype.hasOwnProperty.call(receipt, field))
}

function main() {
  const launcher = path.join('tools', 'smoke', 'packaged-tools-smoke-launcher.mjs')
  const run = spawnSync(process.execPath, [launcher, '--session', sessionId, '--timeout-ms', '60000'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  })

  if (run.stdout) process.stdout.write(run.stdout)
  if (run.stderr) process.stderr.write(run.stderr)

  assert(run.status === 0, 'PACKAGED_SMOKE_FAILED', { status: run.status })
  const result = parseSmokeResult(run.stdout || '')
  const g1 = result.g1 || {}

  assert(result.ok === true, 'SMOKE_RESULT_NOT_OK')
  assert(result.apiShape && result.apiShape.protocol === 'file:', 'PACKAGED_FILE_PROTOCOL_NOT_OPEN')
  assert(result.finalTelemetry && result.finalTelemetry.consoleErrorCount === 0, 'CONSOLE_ERRORS_PRESENT', result.finalTelemetry)

  assert(g1.tempSession && g1.tempSession.ok === true, 'TEMP_SESSION_MISSING')
  assert(g1.tempSession.capabilityToken === 'smoke-temp-only', 'TEMP_SESSION_CAPABILITY_MISMATCH')
  assert(g1.tempSession.overwriteAllowed === false, 'TEMP_SESSION_OVERWRITE_ALLOWED')
  assert(g1.tempSession.productionWriteAllowed === false, 'TEMP_SESSION_PRODUCTION_WRITE_ALLOWED')
  assert(g1.tempSession.rendererProvidedPathAllowed === false, 'TEMP_SESSION_RENDERER_PATH_ALLOWED')

  assert(g1.validateExport && g1.validateExport.ok === true, 'VALIDATE_EXPORT_FAILED', g1.validateExport)
  assert(g1.validateExport.code === 'EXPORT_VALIDATED', 'VALIDATE_EXPORT_CODE_MISMATCH', g1.validateExport)
  assert(g1.validateExport.data && g1.validateExport.data.overwriteAttempted === false, 'VALIDATE_EXPORT_OVERWRITE_ATTEMPTED')

  assert(g1.invalidCapability && g1.invalidCapability.ok === false, 'INVALID_CAPABILITY_NOT_BLOCKED')
  assert(g1.invalidCapability.code === 'INVALID_CAPABILITY', 'INVALID_CAPABILITY_CODE_MISMATCH', g1.invalidCapability)
  assert(g1.productionWrite && g1.productionWrite.ok === false, 'PRODUCTION_WRITE_NOT_REJECTED')
  assert(g1.productionWrite.code === 'PRODUCTION_WRITE_REJECTED', 'PRODUCTION_WRITE_CODE_MISMATCH', g1.productionWrite)
  assert(g1.invalidTempTarget && g1.invalidTempTarget.ok === false, 'INVALID_TEMP_TARGET_NOT_REJECTED')
  assert(g1.invalidTempTarget.code === 'INVALID_TEMP_TARGET', 'INVALID_TEMP_TARGET_CODE_MISMATCH', g1.invalidTempTarget)

  assert(result.tempExport && result.tempExport.ok === true, 'TEMP_EXPORT_FAILED', result.tempExport)
  assert(result.tempExport.receipt && hasReceiptFields(result.tempExport.receipt), 'TEMP_EXPORT_RECEIPT_FIELDS_MISSING', result.tempExport.receipt)
  assert(result.tempExport.receipt.operationId === 'packaged-smoke-temp-export', 'TEMP_EXPORT_OPERATION_ID_MISMATCH')
  assert(result.tempExport.receipt.mode === 'export', 'TEMP_EXPORT_MODE_MISMATCH')
  assert(result.tempExport.receipt.overwriteAttempted === false, 'TEMP_EXPORT_OVERWRITE_ATTEMPTED')
  assert(result.tempExport.receipt.success === true, 'TEMP_EXPORT_RECEIPT_NOT_SUCCESS')
  assert(result.tempExport.receipt.typedError === null, 'TEMP_EXPORT_TYPED_ERROR_PRESENT')
  assert(result.hashMatched === true, 'TEMP_EXPORT_HASH_MISMATCH')
  assert(result.outputPathInsideWhitelist === true, 'TEMP_EXPORT_OUTSIDE_WHITELIST')
  assert(Array.isArray(result.tmpLeftovers) && result.tmpLeftovers.length === 0, 'TMP_LEFTOVERS_PRESENT', result.tmpLeftovers)

  assert(g1.operationReceipt && g1.operationReceipt.ok === true, 'OPERATION_RECEIPT_NOT_FOUND', g1.operationReceipt)
  assert(g1.operationReceipt.data && hasReceiptFields(g1.operationReceipt.data), 'OPERATION_RECEIPT_FIELDS_MISSING', g1.operationReceipt)
  assert(g1.operationReceipt.data.operationId === 'packaged-smoke-temp-export', 'OPERATION_RECEIPT_ID_MISMATCH')
  assert(g1.missingReceipt && g1.missingReceipt.ok === false, 'MISSING_RECEIPT_NOT_TYPED_ERROR')
  assert(g1.missingReceipt.code === 'ATOMIC_RECEIPT_MISSING', 'MISSING_RECEIPT_CODE_MISMATCH', g1.missingReceipt)

  assert(result.rendererDir && result.rendererDir.ok === false, 'RENDERER_DIR_NOT_BLOCKED')
  assert(result.rendererDir.code === 'RENDERER_DIR_FORBIDDEN', 'RENDERER_DIR_CODE_MISMATCH', result.rendererDir)
  assert(result.overwrite && result.overwrite.ok === false, 'OVERWRITE_NOT_BLOCKED')
  assert(result.overwrite.code === 'OVERWRITE_BLOCKED', 'OVERWRITE_CODE_MISMATCH', result.overwrite)
  assert(result.legacy && result.legacy.ok === false && result.legacy.code === 'LEGACY_WRITE_BLOCKED', 'LEGACY_WRITE_NOT_BLOCKED', result.legacy)

  const summary = {
    ok: true,
    code: 'G1_TOOLS_BRIDGE_STAGED_IMPLEMENTATION_OK',
    sessionId,
    checks: {
      tempSession: true,
      validateExport: true,
      typedErrors: true,
      tempExportReceipt: true,
      operationReceipt: true,
      packagedSmoke: true,
      overwriteDisabled: true,
      legacyWriteBlocked: true,
      rendererPathBlocked: true
    },
    policy: {
      phase5OverwriteExecutionAllowed: false,
      productionLegacyWriteAllowed: false,
      userFileWriteAllowed: false,
      rendererProvidedOutputDirectoryAllowed: false
    }
  }

  console.log(JSON.stringify(summary, null, 2))
}

try {
  main()
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G1_TOOLS_BRIDGE_STAGED_IMPLEMENTATION_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
