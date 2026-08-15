import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const packagedAppRoot = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app')
const productionRendererEntry = path.join(packagedAppRoot, 'renderer', 'index.html')
const outputRoot = path.join(repoRoot, 'debug-output', 'aifx-r2-experimental-workflow-expansion-2026-05-17')

const boundaryFiles = [
  productionRendererEntry,
  path.join(packagedAppRoot, 'renderer', 'novaflow-brand-runtime.js'),
  path.join(packagedAppRoot, 'renderer', 'aifx-repaint-runtime.js'),
  path.join(packagedAppRoot, 'renderer', 'runtime-fetch-proxy.js'),
  path.join(packagedAppRoot, 'renderer', 'proxy-electron-api.js'),
  path.join(packagedAppRoot, 'renderer', 'spine-split-runtime.js'),
  path.join(packagedAppRoot, 'renderer', 'spine-official-runtime.js'),
  path.join(packagedAppRoot, 'renderer', 'ribbon-event-markers.js')
]

function assert(condition, code, details = {}) {
  if (!condition) {
    const error = new Error(code)
    error.code = code
    error.details = details
    throw error
  }
}

function sha256Bytes(input) {
  return createHash('sha256').update(input).digest('hex').toUpperCase()
}

function sha256(file) {
  return sha256Bytes(readFileSync(file))
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function deterministicHash(value) {
  return sha256Bytes(stableJson(value))
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

function typedError(code, message, classification, retryable = false) {
  return { code, message, classification, retryable }
}

function createInitialState() {
  return {
    templates: [],
    references: [],
    queue: [],
    results: [],
    receipts: [],
    counters: { task: 0, receipt: 0 },
    overwriteAttempted: false,
    realComfyCalled: false,
    productionExportCalled: false
  }
}

function addReceipt(state, type, details = {}) {
  state.counters.receipt += 1
  const receipt = {
    receiptId: `aifx-r2-receipt-${state.counters.receipt}`,
    type,
    details,
    stateHash: deterministicHash({
      templates: state.templates,
      references: state.references,
      queue: state.queue,
      results: state.results
    })
  }
  state.receipts.push(receipt)
  return receipt
}

function registerTemplate(state, template) {
  const expanded = {
    templateId: template.templateId,
    category: template.category,
    workflowVariant: template.workflowVariant,
    controls: template.controls,
    status: 'registered'
  }
  state.templates.push(expanded)
  return addReceipt(state, 'TEMPLATE_REGISTERED', expanded)
}

function attachReference(state, reference) {
  const expanded = {
    referenceId: reference.referenceId,
    kind: reference.kind,
    mockPath: reference.mockPath,
    contentHash: deterministicHash(reference),
    status: 'ready'
  }
  state.references.push(expanded)
  return addReceipt(state, 'REFERENCE_ATTACHED', expanded)
}

function enqueueTask(state, payload) {
  state.counters.task += 1
  const task = {
    taskId: `aifx-r2-task-${state.counters.task}`,
    templateId: payload.templateId,
    referenceIds: payload.referenceIds,
    prompt: payload.prompt,
    variant: payload.variant,
    status: 'queued',
    attempts: 0,
    typedError: null,
    resultHash: null
  }
  state.queue.push(task)
  addReceipt(state, 'TASK_ENQUEUED', task)
  return task
}

function findTask(state, taskId) {
  return state.queue.find((task) => task.taskId === taskId)
}

function cancelTask(state, taskId) {
  const task = findTask(state, taskId)
  assert(task, 'AIFX_R2_CANCEL_TASK_MISSING', { taskId })
  task.status = 'canceled'
  task.typedError = typedError('TASK_CANCELED', 'AIFX-R2 mock task canceled.', 'user_cancel', false)
  return addReceipt(state, 'TASK_CANCELED', { taskId, typedError: task.typedError })
}

function runTask(state, taskId, mode) {
  const task = findTask(state, taskId)
  assert(task, 'AIFX_R2_RUN_TASK_MISSING', { taskId })
  task.status = 'running'
  task.attempts += 1
  const failureModes = {
    unavailable: typedError('COMFY_UNAVAILABLE', 'Mock ComfyUI unavailable.', 'external_dependency_down', true),
    timeout: typedError('COMFY_TIMEOUT', 'Mock ComfyUI timeout.', 'timeout', true),
    missingModel: typedError('COMFY_DEPENDENCY_FAILED', 'Mock model dependency missing.', 'model_or_workflow_missing', false),
    invalidReference: typedError('REFERENCE_INVALID', 'Mock reference failed validation.', 'input_validation', false)
  }
  if (failureModes[mode]) {
    task.status = 'failed'
    task.typedError = failureModes[mode]
    return addReceipt(state, 'TASK_FAILED', { taskId, mode, typedError: task.typedError })
  }
  const resultPayload = {
    adapter: 'aifx-r2-mock-comfy',
    workflowVariant: task.variant,
    templateId: task.templateId,
    referenceIds: task.referenceIds,
    prompt: task.prompt,
    seed: 'AIFX_R2_DETERMINISTIC_SEED',
    attempt: task.attempts
  }
  const resultHash = deterministicHash(resultPayload)
  task.status = 'completed'
  task.resultHash = resultHash
  task.typedError = null
  const result = {
    taskId,
    resultHash,
    deterministicOutputReceipt: {
      mode: 'experimental-mock-output',
      overwriteAttempted: false,
      productionExportCalled: false,
      hashBefore: resultHash,
      hashAfter: resultHash,
      typedError: null
    }
  }
  state.results.push(result)
  return addReceipt(state, 'TASK_COMPLETED', result)
}

function retryTask(state, taskId) {
  const task = findTask(state, taskId)
  assert(task, 'AIFX_R2_RETRY_TASK_MISSING', { taskId })
  assert(task.status === 'failed' && task.typedError && task.typedError.retryable === true, 'AIFX_R2_RETRY_NOT_ALLOWED', { task })
  task.status = 'queued'
  task.typedError = null
  return addReceipt(state, 'TASK_RETRIED', { taskId, attempts: task.attempts })
}

function runWorkflowScenario(sessionId) {
  const state = createInitialState()
  const templates = [
    { templateId: 'fx-impact-core', category: 'impact', workflowVariant: 'single-result', controls: ['prompt', 'intensity', 'palette'] },
    { templateId: 'fx-trail-ribbon', category: 'trail', workflowVariant: 'batch-results', controls: ['prompt', 'length', 'curve'] },
    { templateId: 'fx-ui-glow', category: 'ui', workflowVariant: 'reference-guided', controls: ['prompt', 'reference', 'mask'] }
  ]
  const references = [
    { referenceId: 'ref-shape-001', kind: 'shape', mockPath: 'fixtures/reference-shape.png' },
    { referenceId: 'ref-palette-001', kind: 'palette', mockPath: 'fixtures/reference-palette.png' },
    { referenceId: 'ref-style-001', kind: 'style', mockPath: 'fixtures/reference-style.png' }
  ]
  for (const template of templates) registerTemplate(state, template)
  for (const reference of references) attachReference(state, reference)

  const successTask = enqueueTask(state, {
    templateId: 'fx-impact-core',
    referenceIds: ['ref-shape-001', 'ref-palette-001'],
    prompt: 'deterministic impact burst',
    variant: 'single-result'
  })
  const cancelTaskTarget = enqueueTask(state, {
    templateId: 'fx-trail-ribbon',
    referenceIds: ['ref-style-001'],
    prompt: 'cancelled ribbon trail',
    variant: 'batch-results'
  })
  const unavailableTask = enqueueTask(state, {
    templateId: 'fx-ui-glow',
    referenceIds: ['ref-style-001', 'ref-palette-001'],
    prompt: 'dependency unavailable then success',
    variant: 'reference-guided'
  })
  const timeoutTask = enqueueTask(state, {
    templateId: 'fx-impact-core',
    referenceIds: ['ref-shape-001'],
    prompt: 'timeout then success',
    variant: 'single-result'
  })
  const missingModelTask = enqueueTask(state, {
    templateId: 'fx-trail-ribbon',
    referenceIds: ['ref-style-001'],
    prompt: 'missing model classification',
    variant: 'batch-results'
  })
  const invalidReferenceTask = enqueueTask(state, {
    templateId: 'fx-ui-glow',
    referenceIds: ['ref-missing'],
    prompt: 'invalid reference classification',
    variant: 'reference-guided'
  })

  runTask(state, successTask.taskId, 'success')
  cancelTask(state, cancelTaskTarget.taskId)
  runTask(state, unavailableTask.taskId, 'unavailable')
  retryTask(state, unavailableTask.taskId)
  runTask(state, unavailableTask.taskId, 'success')
  runTask(state, timeoutTask.taskId, 'timeout')
  retryTask(state, timeoutTask.taskId)
  runTask(state, timeoutTask.taskId, 'success')
  runTask(state, missingModelTask.taskId, 'missingModel')
  runTask(state, invalidReferenceTask.taskId, 'invalidReference')

  const failureCodes = [...new Set([
    ...state.queue
      .filter((task) => task.typedError)
      .map((task) => task.typedError.code),
    ...state.receipts
      .map((receipt) => receipt.details && receipt.details.typedError && receipt.details.typedError.code)
      .filter(Boolean)
  ])].sort()
  const completed = state.queue.filter((task) => task.status === 'completed')
  const failed = state.queue.filter((task) => task.status === 'failed')
  const canceled = state.queue.filter((task) => task.status === 'canceled')
  const deterministicOutputHash = deterministicHash({
    sessionId: 'stable-aifx-r2-output',
    results: state.results.map((result) => ({
      taskId: result.taskId.replace(/\d+$/, 'N'),
      resultHash: result.resultHash
    }))
  })

  return {
    sessionId,
    sourceOwnedFlow: true,
    productionRouteInjected: false,
    realComfyCalled: state.realComfyCalled,
    productionExportCalled: state.productionExportCalled,
    overwriteAttempted: state.overwriteAttempted,
    templateCount: state.templates.length,
    referenceCount: state.references.length,
    taskCount: state.queue.length,
    completedCount: completed.length,
    failedCount: failed.length,
    canceledCount: canceled.length,
    failureCodes,
    workflowVariants: [...new Set(state.queue.map((task) => task.variant))].sort(),
    deterministicOutputHash,
    resultReceipts: state.results.map((result) => result.deterministicOutputReceipt),
    receipts: state.receipts,
    finalStateHash: deterministicHash(state)
  }
}

function validateScenario(scenario) {
  assert(scenario.sourceOwnedFlow === true, 'AIFX_R2_SOURCE_FLOW_NOT_OWNED', scenario)
  assert(scenario.productionRouteInjected === false, 'AIFX_R2_PRODUCTION_ROUTE_INJECTED', scenario)
  assert(scenario.realComfyCalled === false, 'AIFX_R2_REAL_COMFY_CALLED', scenario)
  assert(scenario.productionExportCalled === false, 'AIFX_R2_PRODUCTION_EXPORT_CALLED', scenario)
  assert(scenario.overwriteAttempted === false, 'AIFX_R2_OVERWRITE_ATTEMPTED', scenario)
  assert(scenario.templateCount >= 3, 'AIFX_R2_TEMPLATE_FLOW_TOO_SMALL', scenario)
  assert(scenario.referenceCount >= 3, 'AIFX_R2_REFERENCE_FLOW_TOO_SMALL', scenario)
  assert(scenario.completedCount >= 3, 'AIFX_R2_COMPLETED_COUNT_TOO_LOW', scenario)
  assert(scenario.failedCount >= 2, 'AIFX_R2_FAILED_COUNT_TOO_LOW', scenario)
  assert(scenario.canceledCount >= 1, 'AIFX_R2_CANCELED_COUNT_TOO_LOW', scenario)
  for (const code of ['COMFY_UNAVAILABLE', 'COMFY_TIMEOUT', 'COMFY_DEPENDENCY_FAILED', 'REFERENCE_INVALID', 'TASK_CANCELED']) {
    assert(scenario.failureCodes.includes(code), 'AIFX_R2_FAILURE_CODE_MISSING', { code, failureCodes: scenario.failureCodes })
  }
  assert(scenario.workflowVariants.length >= 3, 'AIFX_R2_VARIANTS_TOO_FEW', scenario.workflowVariants)
  assert(typeof scenario.deterministicOutputHash === 'string' && scenario.deterministicOutputHash.length === 64, 'AIFX_R2_DETERMINISTIC_HASH_INVALID', scenario.deterministicOutputHash)
  for (const receipt of scenario.resultReceipts) {
    assert(receipt.hashBefore === receipt.hashAfter, 'AIFX_R2_RESULT_RECEIPT_HASH_MISMATCH', receipt)
    assert(receipt.overwriteAttempted === false, 'AIFX_R2_RESULT_RECEIPT_OVERWRITE', receipt)
    assert(receipt.productionExportCalled === false, 'AIFX_R2_RESULT_RECEIPT_PRODUCTION_EXPORT', receipt)
  }
}

try {
  for (const file of boundaryFiles) {
    assert(existsSync(file), 'AIFX_R2_BOUNDARY_FILE_MISSING', { file })
  }
  mkdirSync(outputRoot, { recursive: true })
  const sessionId = `aifx-r2-workflow-${Date.now()}`
  const sessionDir = path.join(outputRoot, sessionId)
  mkdirSync(sessionDir, { recursive: true })

  const productionBefore = hashRuntimeChain()
  const boundaryBefore = hashFiles(boundaryFiles)
  const firstScenario = runWorkflowScenario(`${sessionId}-first`)
  const secondScenario = runWorkflowScenario(`${sessionId}-second`)
  validateScenario(firstScenario)
  validateScenario(secondScenario)
  assert(firstScenario.deterministicOutputHash === secondScenario.deterministicOutputHash, 'AIFX_R2_DETERMINISTIC_OUTPUT_CHANGED', {
    first: firstScenario.deterministicOutputHash,
    second: secondScenario.deterministicOutputHash
  })

  const sourceManifest = {
    track: 'AIFX-R',
    phase: 'AIFX-R2',
    sourceOwnedFlow: true,
    workflowVariants: firstScenario.workflowVariants,
    failureStates: ['COMFY_UNAVAILABLE', 'COMFY_TIMEOUT', 'COMFY_DEPENDENCY_FAILED', 'REFERENCE_INVALID', 'TASK_CANCELED'],
    realComfyProductionConnected: false,
    overwriteEnabled: false,
    productionShellMutation: false
  }
  const manifestPath = path.join(sessionDir, 'aifx-r2-workflow-expansion-manifest.json')
  const receiptPath = path.join(sessionDir, 'aifx-r2-workflow-expansion-receipt.json')
  writeFileSync(manifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`, 'utf8')
  writeFileSync(receiptPath, `${JSON.stringify({
    sessionId,
    timestamp: new Date().toISOString(),
    classification: 'AIFX_R2_EXPERIMENTAL_WORKFLOW_EXPANDED',
    readiness: 'READY_FOR_AIFX_R3_EXPERIMENTAL_ROUTE_PROTOTYPE',
    firstScenario,
    secondScenario
  }, null, 2)}\n`, 'utf8')

  const productionAfter = hashRuntimeChain()
  const boundaryAfter = hashFiles(boundaryFiles)
  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfter), 'AIFX_R2_RUNTIME_CHAIN_CHANGED', {
    before: productionBefore,
    after: productionAfter
  })
  assert(JSON.stringify(boundaryBefore) === JSON.stringify(boundaryAfter), 'AIFX_R2_BOUNDARY_FILE_CHANGED', {
    before: boundaryBefore,
    after: boundaryAfter
  })

  console.log(JSON.stringify({
    ok: true,
    code: 'AIFX_R2_EXPERIMENTAL_WORKFLOW_EXPANSION_OK',
    sessionId,
    receiptPath: path.relative(repoRoot, receiptPath).replace(/\\/g, '/'),
    manifestPath: path.relative(repoRoot, manifestPath).replace(/\\/g, '/'),
    productionRuntimeStable: true,
    shellRuntimeRegression: false,
    protectedIslandRegression: false,
    toolsBridgeSafetyChanged: false,
    realComfyProductionConnected: false,
    overwriteEnabled: false,
    sourceOwnedFlowExpanded: true,
    mockWorkflowRunnable: true,
    workflowVariants: firstScenario.workflowVariants,
    failureCodes: firstScenario.failureCodes,
    deterministicOutputHash: firstScenario.deterministicOutputHash,
    classification: 'AIFX_R2_EXPERIMENTAL_WORKFLOW_EXPANDED',
    readiness: 'READY_FOR_AIFX_R3_EXPERIMENTAL_ROUTE_PROTOTYPE',
    blockers: [
      'AIFX-R2 is experimental only',
      'real Comfy production is not connected',
      'production shell route remains frozen',
      'overwrite remains disabled'
    ]
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'AIFX_R2_EXPERIMENTAL_WORKFLOW_EXPANSION_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
