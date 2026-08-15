import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { assert, createCheckerRunner, createSmokePaths, toRepoRelative } from './lib/smoke-core.mjs'
import { hashRuntimeChain } from './lib/runtime-chain.mjs'

const { repoRoot } = createSmokePaths(import.meta.url)
const productionRendererEntry = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html')
const outputRoot = path.join(repoRoot, 'debug-output', 'final-migration-readiness-review-2026-05-17')
const runChecker = createCheckerRunner(repoRoot)

const allowedFinalStatuses = new Set([
  'READY_FOR_MORE_ISOLATED_EXPANSION',
  'READY_FOR_GUARDED_PRODUCTION_CANDIDATE_REVIEW',
  'NOT_READY'
])

try {
  const sessionId = `g16-readiness-${Date.now()}`
  const sessionDir = path.join(outputRoot, sessionId)
  mkdirSync(sessionDir, { recursive: true })

  const runtimeBefore = hashRuntimeChain(repoRoot, productionRendererEntry)
  const validation = runChecker('g15-guarded-production-candidate-validation-check.mjs', 'G16_G15_VALIDATION_FAILED')
  const runtimeAfter = hashRuntimeChain(repoRoot, productionRendererEntry)

  assert(JSON.stringify(runtimeBefore) === JSON.stringify(runtimeAfter), 'G16_RUNTIME_CHAIN_CHANGED', {
    before: runtimeBefore,
    after: runtimeAfter
  })
  assert(validation.ok === true, 'G16_VALIDATION_NOT_OK', validation)
  assert(allowedFinalStatuses.has(validation.readiness), 'G16_INVALID_FINAL_STATUS', { readiness: validation.readiness })
  assert(validation.validationReceipt.productionRuntimeStable === true, 'G16_PRODUCTION_RUNTIME_NOT_STABLE', validation.validationReceipt)
  assert(validation.validationReceipt.noProductionRouteMutation === true, 'G16_PRODUCTION_ROUTE_MUTATION_FLAG', validation.validationReceipt)
  assert(validation.validationReceipt.noOverwriteEnablement === true, 'G16_OVERWRITE_ENABLEMENT_FLAG', validation.validationReceipt)
  assert(validation.validationReceipt.noRendererDistPromotion === true, 'G16_RENDERER_DIST_PROMOTION_FLAG', validation.validationReceipt)

  const finalStatus = validation.readiness
  const frozenAreas = [
    '4783 production runtime chain',
    'production index.html',
    'renderer/dist production chain',
    'novaflow-brand-runtime.js',
    'inline prepaint CSS',
    'aifx-repaint-runtime.js',
    'runtime-fetch-proxy.js',
    'proxy-electron-api.js',
    'protected islands',
    'overwrite and user-file writes'
  ]

  const receipt = {
    sessionId,
    timestamp: new Date().toISOString(),
    finalStatus,
    productionMigrationAllowed: false,
    approvalBoundaryReached: true,
    nextApprovalRequired: 'guarded production candidate review approval is required before any production-level mutation',
    blockers: validation.blockers,
    frozenAreas,
    validationReceipt: validation.validationReceipt
  }
  const receiptPath = path.join(sessionDir, 'g16-final-migration-readiness-review-receipt.json')
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    code: 'G16_FINAL_MIGRATION_READINESS_REVIEW_OK',
    sessionId,
    receiptPath: toRepoRelative(repoRoot, receiptPath),
    finalStatus,
    productionMigrationAllowed: false,
    approvalBoundaryReached: true,
    blockers: validation.blockers,
    frozenAreas,
    validationReceipt: validation.validationReceipt
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G16_FINAL_MIGRATION_READINESS_REVIEW_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
