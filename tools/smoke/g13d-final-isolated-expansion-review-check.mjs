import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { assert, createCheckerRunner, createSmokePaths, toRepoRelative } from './lib/smoke-core.mjs'

const { repoRoot } = createSmokePaths(import.meta.url)
const outputRoot = path.join(repoRoot, 'debug-output', 'final-isolated-expansion-review-2026-05-17')
const runChecker = createCheckerRunner(repoRoot)

function maxLayoutShiftDelta(receipts) {
  if (!Array.isArray(receipts)) return null
  const values = receipts
    .map((receipt) => receipt.layoutShiftDelta)
    .filter((value) => typeof value === 'number')
  if (!values.length) return null
  return Math.max(...values)
}

try {
  const sessionId = `g13d-final-review-${Date.now()}`
  const sessionDir = path.join(outputRoot, sessionId)
  mkdirSync(sessionDir, { recursive: true })

  const shell = runChecker('g13a-shell-isolated-expansion-phase1-check.mjs', 'G13D_SHELL_EXPANSION_FAILED')
  const aifx = runChecker('g13b-aifx-isolated-expansion-phase1-check.mjs', 'G13D_AIFX_EXPANSION_FAILED')
  const tools = runChecker('g13c-tools-production-candidate-validation-check.mjs', 'G13D_TOOLS_CANDIDATE_FAILED')
  const protectedIsland = runChecker('g2-protected-island-harness-check.mjs', 'G13D_PROTECTED_HARNESS_FAILED')
  const firstFrame = runChecker('g3-first-frame-harness-check.mjs', 'G13D_FIRST_FRAME_HARNESS_FAILED')
  const shellCandidate = runChecker('g8-shell-production-candidate-validation-check.mjs', 'G13D_SHELL_CANDIDATE_FAILED')

  assert(shell.ok === true, 'G13D_SHELL_NOT_OK', shell)
  assert(aifx.ok === true, 'G13D_AIFX_NOT_OK', aifx)
  assert(tools.ok === true, 'G13D_TOOLS_NOT_OK', tools)
  assert(protectedIsland.ok === true, 'G13D_PROTECTED_NOT_OK', protectedIsland)
  assert(firstFrame.ok === true, 'G13D_FIRST_FRAME_NOT_OK', firstFrame)
  assert(shellCandidate.ok === true, 'G13D_SHELL_CANDIDATE_NOT_OK', shellCandidate)

  assert(tools.policy.phase5OverwriteExecutionAllowed === false, 'G13D_PHASE5_OVERWRITE_POLICY_TRUE', tools.policy)
  assert(tools.policy.productionLegacyWriteAllowed === false, 'G13D_PRODUCTION_LEGACY_POLICY_TRUE', tools.policy)
  assert(tools.policy.userFileWriteAllowed === false, 'G13D_USER_FILE_WRITE_POLICY_TRUE', tools.policy)

  const summary = {
    shellIsolatedStatus: {
      ok: true,
      code: shell.code,
      routeStable: shell.isolatedSummary.routeStable,
      consoleErrorCount: shell.isolatedSummary.consoleErrorCount,
      layoutShiftDelta: maxLayoutShiftDelta(shell.ownershipReceipts)
    },
    aifxIsolatedStatus: {
      ok: true,
      code: aifx.code,
      classification: aifx.classification,
      readiness: aifx.readiness,
      receiptCount: aifx.ownershipReceipts.length
    },
    toolsCandidateStatus: {
      ok: true,
      code: tools.code,
      classification: tools.classification,
      readiness: tools.readiness,
      policy: tools.policy
    },
    protectedIslandCompatibility: {
      ok: true,
      repeatableRuns: protectedIsland.repeatableRuns,
      consoleErrorMax: Math.max(...protectedIsland.results.map((result) => result.consoleErrorCount)),
      protectedHashesStable: protectedIsland.results.every((result) => result.protectedHashesStable === true)
    },
    firstFrameStatus: {
      ok: true,
      repeatableRuns: firstFrame.repeatableRuns,
      layoutShiftDetected: firstFrame.comparison.left.layoutShiftDetected || firstFrame.comparison.right.layoutShiftDetected,
      consoleErrorMax: Math.max(...firstFrame.results.map((result) => result.consoleErrorCount)),
      shellCandidateClassification: shellCandidate.validationReceipt.candidateClassification,
      layoutShiftMedian: shellCandidate.validationReceipt.layoutShiftMedian,
      layoutShiftWorst: shellCandidate.validationReceipt.layoutShiftWorst
    }
  }

  const blockers = [
    'production migration is still forbidden',
    'production shell remains runtime-owned',
    'production AIFX remains runtime-owned',
    'overwrite remains disabled',
    'first-frame layout shift remains measurable in baseline traces'
  ]

  const receipt = {
    sessionId,
    timestamp: new Date().toISOString(),
    classification: 'FINAL_ISOLATED_EXPANSION_REVIEW_COMPLETE',
    readiness: 'READY_FOR_GUARDED_PRODUCTION_CANDIDATE_PLAN',
    blockers,
    summary
  }
  const receiptPath = path.join(sessionDir, 'g13d-final-isolated-expansion-review-receipt.json')
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    code: 'G13D_FINAL_ISOLATED_EXPANSION_REVIEW_OK',
    sessionId,
    receiptPath: toRepoRelative(repoRoot, receiptPath),
    classification: receipt.classification,
    readiness: receipt.readiness,
    blockers,
    summary
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G13D_FINAL_ISOLATED_EXPANSION_REVIEW_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
