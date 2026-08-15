import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const productionRendererEntry = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html')
const rehearsalRoot = path.join(repoRoot, 'debug-output', 'shell-cutover-rehearsal-2026-05-17')

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
  assert(match, 'G32_FIRST_FRAME_RESULT_MISSING')
  return JSON.parse(match[1])
}

function runNode(args, code) {
  const run = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024
  })
  if (run.stderr) process.stderr.write(run.stderr)
  assert(run.status === 0, code, { status: run.status, stdout: run.stdout, stderr: run.stderr, args })
  return run.stdout || ''
}

function runJsonChecker(script, code) {
  return parseJsonOutput(runNode([path.join('tools', 'smoke', script)], code), `${code}_JSON_MISSING`)
}

function runFirstFrame(renderer, sessionId) {
  const stdout = runNode([
    path.join('tools', 'smoke', 'first-frame-harness-runner.mjs'),
    '--session',
    sessionId,
    '--renderer',
    renderer,
    '--temp-root',
    path.join(rehearsalRoot, 'first-frame-trace'),
    '--zero-shift-seed',
    '1',
    '--timeout-ms',
    '90000'
  ], 'G32_FIRST_FRAME_RUNNER_FAILED')
  return parseFirstFrameResult(stdout)
}

function receipts(result) {
  return Array.isArray(result.measurementReceipts) ? result.measurementReceipts : []
}

function samples(result) {
  return result.trace && Array.isArray(result.trace.samples) ? result.trace.samples : []
}

function layoutShiftCount(result) {
  return receipts(result).filter((receipt) => receipt.layoutShiftDetected).length
}

function railShiftCount(result) {
  const entries = samples(result)
  let count = 0
  for (let index = 1; index < entries.length; index += 1) {
    if (Math.abs(Number(entries[index].railWidth || 0) - Number(entries[index - 1].railWidth || 0)) > 2) count += 1
  }
  return count
}

function stableFrameTime(result) {
  const found = samples(result).find((sample) => sample.label === 'stable-frame')
  return found ? found.timestamp : null
}

function traceTypes(result) {
  return [...new Set(receipts(result).map((receipt) => receipt.traceType).filter(Boolean))].sort()
}

function traceText(result, traceType) {
  const scoped = receipts(result).filter((receipt) => receipt.traceType === traceType)
  const last = scoped[scoped.length - 1] || null
  return last && last.routeState ? String(last.routeState.routeText || '') : ''
}

function overflowDetected(result) {
  return receipts(result).some((receipt) => {
    const state = receipt.overflowState || {}
    return state.horizontalOverflow || state.panelOverflow
  })
}

function routeReplayStable(result) {
  const types = traceTypes(result)
  return types.includes('cold-start') &&
    types.includes('route-switch-trace') &&
    types.includes('animation-route-trace') &&
    types.includes('tools-route-trace') &&
    /effects/i.test(traceText(result, 'cold-start')) &&
    /animation/i.test(traceText(result, 'animation-route-trace')) &&
    /tools/i.test(traceText(result, 'tools-route-trace'))
}

function replayReceipt(result, label) {
  return {
    label,
    protocol: result.protocol,
    consoleErrorCount: Number(result.consoleErrorCount || 0),
    consoleErrorDelta: Number(result.consoleErrorCount || 0),
    runtimeChainStable: result.runtimeChainStable === true,
    receiptCount: receipts(result).length,
    sampleCount: samples(result).length,
    traceTypes: traceTypes(result),
    layoutShiftCount: layoutShiftCount(result),
    railShiftCount: railShiftCount(result),
    stableFrameTime: stableFrameTime(result),
    overflowDetected: overflowDetected(result),
    routeReplayStable: routeReplayStable(result)
  }
}

function validateReplay(receipt, code) {
  assert(receipt.protocol === 'file:', `${code}_NOT_FILE_PROTOCOL`, receipt)
  assert(receipt.consoleErrorDelta === 0, `${code}_CONSOLE_ERROR_DELTA`, receipt)
  assert(receipt.runtimeChainStable === true, `${code}_RUNTIME_CHAIN_UNSTABLE`, receipt)
  assert(receipt.receiptCount >= 8, `${code}_RECEIPTS_MISSING`, receipt)
  assert(receipt.sampleCount >= 12, `${code}_SAMPLES_MISSING`, receipt)
  assert(receipt.routeReplayStable === true, `${code}_ROUTE_REPLAY_UNSTABLE`, receipt)
  assert(receipt.overflowDetected === false, `${code}_OVERFLOW_DETECTED`, receipt)
}

function copyCandidate(sourceRenderer, sessionDir) {
  const candidateDir = path.join(sessionDir, 'candidate')
  mkdirSync(candidateDir, { recursive: true })
  const candidate = path.join(candidateDir, 'index.html')
  copyFileSync(sourceRenderer, candidate)
  return candidate
}

function rehearseRollback(candidate, sessionDir) {
  const rollbackDir = path.join(sessionDir, 'rollback')
  mkdirSync(rollbackDir, { recursive: true })
  const baseline = path.join(rollbackDir, 'baseline-index.html')
  const working = path.join(rollbackDir, 'working-index.html')
  copyFileSync(candidate, baseline)
  copyFileSync(candidate, working)

  const baselineHash = sha256(baseline)
  const original = readFileSync(working, 'utf8')
  writeFileSync(working, original.replace('</body>', '<!-- G32 rehearsal mutation only -->\n</body>'), 'utf8')
  const mutatedHash = sha256(working)
  assert(mutatedHash !== baselineHash, 'G32_ROLLBACK_MUTATION_DID_NOT_CHANGE_HASH', { baselineHash, mutatedHash })

  copyFileSync(baseline, working)
  const restoredHash = sha256(working)
  assert(restoredHash === baselineHash, 'G32_ROLLBACK_HASH_MISMATCH', { baselineHash, restoredHash })

  const rollbackReplay = runFirstFrame(working, `${path.basename(sessionDir)}-rollback-replay`)
  const rollbackReplayReceipt = replayReceipt(rollbackReplay, 'rollback-replay')
  validateReplay(rollbackReplayReceipt, 'G32_ROLLBACK_REPLAY')

  return {
    baselinePath: path.relative(repoRoot, baseline).replace(/\\/g, '/'),
    workingPath: path.relative(repoRoot, working).replace(/\\/g, '/'),
    baselineHash,
    mutatedHash,
    restoredHash,
    rollbackVerified: restoredHash === baselineHash,
    rollbackReplayReceipt
  }
}

try {
  mkdirSync(rehearsalRoot, { recursive: true })
  const sessionId = `g32-shell-cutover-rehearsal-${Date.now()}`
  const sessionDir = path.join(rehearsalRoot, sessionId)
  mkdirSync(sessionDir, { recursive: true })

  const productionBefore = hashRuntimeChain(productionRendererEntry)
  const zeroShift = runJsonChecker('g24-shell-isolated-zero-shift-reconstruction-check.mjs', 'G32_G24_ZERO_SHIFT_FAILED')
  assert(zeroShift.ok === true, 'G32_G24_ZERO_SHIFT_NOT_OK', zeroShift)
  assert(zeroShift.zeroShiftReceipt && zeroShift.zeroShiftReceipt.zeroShift === true, 'G32_G24_ZERO_SHIFT_RECEIPT_FALSE', zeroShift.zeroShiftReceipt)

  const isolatedRenderer = path.join(repoRoot, zeroShift.isolatedRenderer)
  assert(existsSync(isolatedRenderer), 'G32_ISOLATED_RENDERER_MISSING', { isolatedRenderer })
  const candidate = copyCandidate(isolatedRenderer, sessionDir)
  const candidateHash = sha256(candidate)

  const firstReplay = runFirstFrame(candidate, `${sessionId}-replay-1`)
  const secondReplay = runFirstFrame(candidate, `${sessionId}-replay-2`)
  const firstReplayReceipt = replayReceipt(firstReplay, 'shell-cutover-replay-1')
  const secondReplayReceipt = replayReceipt(secondReplay, 'shell-cutover-replay-2')
  validateReplay(firstReplayReceipt, 'G32_REPLAY_ONE')
  validateReplay(secondReplayReceipt, 'G32_REPLAY_TWO')

  const protectedReplay = runJsonChecker('g2-protected-island-harness-check.mjs', 'G32_PROTECTED_REPLAY_FAILED')
  assert(protectedReplay.ok === true, 'G32_PROTECTED_REPLAY_NOT_OK', protectedReplay)
  assert(protectedReplay.repeatableRuns >= 2, 'G32_PROTECTED_REPLAY_NOT_REPEATABLE', protectedReplay)

  const rollback = rehearseRollback(candidate, sessionDir)
  const productionAfter = hashRuntimeChain(productionRendererEntry)
  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfter), 'G32_PRODUCTION_RUNTIME_CHAIN_CHANGED', {
    before: productionBefore,
    after: productionAfter
  })

  const replayMatrix = {
    coldStartReplay: firstReplayReceipt.traceTypes.includes('cold-start') && secondReplayReceipt.traceTypes.includes('cold-start'),
    routeSwitchReplay: firstReplayReceipt.traceTypes.includes('route-switch-trace') && secondReplayReceipt.traceTypes.includes('route-switch-trace'),
    animationReplay: firstReplayReceipt.traceTypes.includes('animation-route-trace') && secondReplayReceipt.traceTypes.includes('animation-route-trace'),
    toolsReplay: firstReplayReceipt.traceTypes.includes('tools-route-trace') && secondReplayReceipt.traceTypes.includes('tools-route-trace'),
    protectedIslandReplay: protectedReplay.ok === true,
    rollbackReplay: rollback.rollbackVerified === true && rollback.rollbackReplayReceipt.routeReplayStable === true
  }
  const goConditions = {
    rehearsalReplayStable: firstReplayReceipt.routeReplayStable && secondReplayReceipt.routeReplayStable,
    rollbackReplayStable: rollback.rollbackVerified && rollback.rollbackReplayReceipt.routeReplayStable,
    protectedIslandReplayStable: protectedReplay.ok === true && protectedReplay.repeatableRuns >= 2,
    routeReplayStable: firstReplayReceipt.routeReplayStable && secondReplayReceipt.routeReplayStable && rollback.rollbackReplayReceipt.routeReplayStable,
    consoleErrorDelta: Math.max(firstReplayReceipt.consoleErrorDelta, secondReplayReceipt.consoleErrorDelta, rollback.rollbackReplayReceipt.consoleErrorDelta)
  }

  for (const [key, value] of Object.entries(replayMatrix)) {
    assert(value === true, 'G32_REPLAY_MATRIX_NOT_STABLE', { key, replayMatrix })
  }
  assert(goConditions.rehearsalReplayStable === true, 'G32_REHEARSAL_REPLAY_UNSTABLE', goConditions)
  assert(goConditions.rollbackReplayStable === true, 'G32_ROLLBACK_REPLAY_UNSTABLE', goConditions)
  assert(goConditions.protectedIslandReplayStable === true, 'G32_PROTECTED_REPLAY_UNSTABLE', goConditions)
  assert(goConditions.routeReplayStable === true, 'G32_ROUTE_REPLAY_UNSTABLE', goConditions)
  assert(goConditions.consoleErrorDelta === 0, 'G32_CONSOLE_ERROR_DELTA', goConditions)

  console.log(JSON.stringify({
    ok: true,
    code: 'G32_SHELL_CUTOVER_REHEARSAL_OK',
    sessionId,
    candidateRenderer: path.relative(repoRoot, candidate).replace(/\\/g, '/'),
    candidateHash,
    productionRuntimeStable: true,
    productionRuntimeFileCount: productionBefore.length,
    shellCutoverExecuted: false,
    productionMutationDetected: false,
    replayMatrix,
    goConditions,
    rehearsalReceipts: [
      firstReplayReceipt,
      secondReplayReceipt,
      rollback.rollbackReplayReceipt
    ],
    protectedIslandReplay: {
      ok: protectedReplay.ok,
      repeatableRuns: protectedReplay.repeatableRuns,
      protectedFileCount: Array.isArray(protectedReplay.protectedFiles) ? protectedReplay.protectedFiles.length : 0
    },
    rollbackReceipt: rollback
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G32_SHELL_CUTOVER_REHEARSAL_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}

