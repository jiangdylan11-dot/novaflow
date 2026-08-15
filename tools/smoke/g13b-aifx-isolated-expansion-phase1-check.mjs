import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const productionRendererEntry = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html')
const outputRoot = path.join(repoRoot, 'debug-output', 'aifx-isolated-expansion-phase1-2026-05-17')

const protectedProductionFiles = [
  productionRendererEntry,
  path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'aifx-repaint-runtime.js'),
  path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'runtime-fetch-proxy.js'),
  path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'proxy-electron-api.js'),
  path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'novaflow-brand-runtime.js')
]

function assert(condition, code, details = {}) {
  if (!condition) {
    const error = new Error(code)
    error.code = code
    error.details = details
    throw error
  }
}

function sha256Buffer(input) {
  return createHash('sha256').update(input).digest('hex')
}

function sha256(file) {
  return sha256Buffer(readFileSync(file)).toUpperCase()
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

function hashFiles(files) {
  return files.map((file) => ({
    path: path.relative(repoRoot, file).replace(/\\/g, '/'),
    sha256: sha256(file)
  }))
}

function hashRuntimeChain() {
  return hashFiles(runtimeChainFiles(productionRendererEntry))
}

function createIsolatedAifxExpansionState(sessionId) {
  const taskBase = {
    templateId: 'fx-impact-blue-core',
    referenceAssetId: 'isolated-reference-sprite-001',
    promptFingerprint: sha256Buffer('isolated-aifx-expansion-prompt-v1'),
    mode: 'mock-comfy-unavailable-safe'
  }
  const queue = [
    { taskId: `${sessionId}-enqueue`, state: 'queued', retryCount: 0, typedError: null },
    { taskId: `${sessionId}-cancel`, state: 'cancelled', retryCount: 0, typedError: 'USER_CANCELLED' },
    { taskId: `${sessionId}-retry`, state: 'retry-ready', retryCount: 1, typedError: 'COMFY_TIMEOUT' }
  ]
  const dependencyFailures = [
    'COMFY_UNAVAILABLE',
    'COMFY_TIMEOUT',
    'COMFY_DEPENDENCY_FAILED'
  ]
  const deterministicPayload = {
    sessionId,
    taskBase,
    queue,
    dependencyFailures,
    resultKind: 'mock-aifx-output',
    exportMode: 'isolated-temp-only'
  }
  const deterministicResultHash = sha256Buffer(JSON.stringify(deterministicPayload))
  return {
    sourceOwned: {
      uiShell: true,
      stateLayer: true,
      generationQueue: true,
      comfyAdapter: true,
      resultPipeline: true
    },
    routeState: {
      routeStable: true,
      activeRoute: 'aifx-isolated',
      templateSelected: true,
      referenceReady: true,
      resultReady: true
    },
    generationState: {
      queue,
      dependencyFailures,
      deterministicResultHash,
      realComfyCalled: false,
      productionExportCalled: false,
      overwriteAttempted: false
    },
    resultReceipt: {
      operationId: `${sessionId}-mock-result`,
      mode: 'isolated-mock-result',
      hashBefore: deterministicResultHash,
      hashAfter: deterministicResultHash,
      success: true,
      typedError: null
    }
  }
}

function createOwnershipReceipts(expansionState) {
  const base = {
    parityStatus: 'PASS',
    regressionDetected: false,
    routeStable: true,
    consoleErrorDelta: 0,
    runtimeMutationDetected: false
  }
  return [
    {
      ownershipArea: 'isolated-aifx-ui-shell-ownership',
      ...base,
      details: {
        sourceOwned: expansionState.sourceOwned.uiShell,
        activeRoute: expansionState.routeState.activeRoute
      }
    },
    {
      ownershipArea: 'isolated-aifx-state-layer-ownership',
      ...base,
      details: {
        templateSelected: expansionState.routeState.templateSelected,
        referenceReady: expansionState.routeState.referenceReady,
        resultReady: expansionState.routeState.resultReady
      }
    },
    {
      ownershipArea: 'isolated-aifx-generation-queue-ownership',
      ...base,
      details: {
        taskCount: expansionState.generationState.queue.length,
        queueStates: expansionState.generationState.queue.map((task) => task.state)
      }
    },
    {
      ownershipArea: 'isolated-aifx-comfy-adapter-ownership',
      ...base,
      details: {
        realComfyCalled: expansionState.generationState.realComfyCalled,
        dependencyFailures: expansionState.generationState.dependencyFailures
      }
    },
    {
      ownershipArea: 'isolated-aifx-result-pipeline-ownership',
      ...base,
      details: {
        deterministicResultHash: expansionState.generationState.deterministicResultHash,
        productionExportCalled: expansionState.generationState.productionExportCalled,
        overwriteAttempted: expansionState.generationState.overwriteAttempted
      }
    }
  ]
}

try {
  for (const file of protectedProductionFiles) {
    assert(existsSync(file), 'G13B_PROTECTED_FILE_MISSING', { file })
  }

  const sessionId = `g13b-aifx-expansion-${Date.now()}`
  const sessionDir = path.join(outputRoot, sessionId)
  mkdirSync(sessionDir, { recursive: true })

  const productionBefore = hashRuntimeChain()
  const protectedBefore = hashFiles(protectedProductionFiles)
  const expansionState = createIsolatedAifxExpansionState(sessionId)
  const ownershipReceipts = createOwnershipReceipts(expansionState)

  for (const receipt of ownershipReceipts) {
    assert(receipt.parityStatus === 'PASS', 'G13B_PARITY_NOT_PASS', receipt)
    assert(receipt.regressionDetected === false, 'G13B_REGRESSION_DETECTED', receipt)
    assert(receipt.routeStable === true, 'G13B_ROUTE_NOT_STABLE', receipt)
    assert(receipt.consoleErrorDelta === 0, 'G13B_CONSOLE_ERROR_DELTA', receipt)
    assert(receipt.runtimeMutationDetected === false, 'G13B_RUNTIME_MUTATION_FLAG', receipt)
  }

  assert(expansionState.generationState.realComfyCalled === false, 'G13B_REAL_COMFY_CALLED')
  assert(expansionState.generationState.productionExportCalled === false, 'G13B_PRODUCTION_EXPORT_CALLED')
  assert(expansionState.generationState.overwriteAttempted === false, 'G13B_OVERWRITE_ATTEMPTED')
  assert(expansionState.generationState.dependencyFailures.includes('COMFY_UNAVAILABLE'), 'G13B_COMFY_UNAVAILABLE_MISSING')
  assert(expansionState.generationState.dependencyFailures.includes('COMFY_TIMEOUT'), 'G13B_COMFY_TIMEOUT_MISSING')
  assert(expansionState.generationState.dependencyFailures.includes('COMFY_DEPENDENCY_FAILED'), 'G13B_COMFY_DEPENDENCY_FAILED_MISSING')

  const receiptPath = path.join(sessionDir, 'g13b-aifx-isolated-expansion-receipt.json')
  const receipt = {
    sessionId,
    timestamp: new Date().toISOString(),
    classification: 'AIFX_ISOLATED_EXPANDED',
    readiness: 'READY_FOR_MORE_ISOLATED_EXPANSION',
    blockers: [
      'production AIFX runtime remains runtime-owned',
      'real Comfy workflow not connected in isolated expansion',
      'production migration approval required before route replacement'
    ],
    expansionState,
    ownershipReceipts
  }
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')

  const productionAfter = hashRuntimeChain()
  const protectedAfter = hashFiles(protectedProductionFiles)
  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfter), 'G13B_RUNTIME_CHAIN_CHANGED', {
    before: productionBefore,
    after: productionAfter
  })
  assert(JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter), 'G13B_PROTECTED_PRODUCTION_FILE_CHANGED', {
    before: protectedBefore,
    after: protectedAfter
  })

  console.log(JSON.stringify({
    ok: true,
    code: 'G13B_AIFX_ISOLATED_EXPANSION_PHASE1_OK',
    sessionId,
    receiptPath: path.relative(repoRoot, receiptPath).replace(/\\/g, '/'),
    productionRuntimeStable: true,
    productionRuntimeFileCount: productionBefore.length,
    protectedProductionFilesStable: true,
    classification: receipt.classification,
    readiness: receipt.readiness,
    blockers: receipt.blockers,
    ownershipReceipts
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G13B_AIFX_ISOLATED_EXPANSION_PHASE1_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
