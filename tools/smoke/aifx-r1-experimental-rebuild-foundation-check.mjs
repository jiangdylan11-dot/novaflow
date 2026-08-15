import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const packagedAppRoot = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app')
const productionRendererEntry = path.join(packagedAppRoot, 'renderer', 'index.html')
const outputRoot = path.join(repoRoot, 'debug-output', 'aifx-r1-experimental-rebuild-foundation-2026-05-17')
const electronCmd = process.platform === 'win32'
  ? path.join(repoRoot, 'particle-editor-desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(repoRoot, 'particle-editor-desktop', 'node_modules', '.bin', 'electron')
const g5App = path.join(__dirname, 'g5-aifx-isolated-source-app.cjs')

const protectedBoundaryFiles = [
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

function sha256Bytes(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex').toUpperCase()
}

function sha256(file) {
  return sha256Bytes(readFileSync(file))
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

function isInside(parent, child) {
  const parentReal = realpathSync(parent)
  const childReal = existsSync(child) ? realpathSync(child) : realpathSync(path.dirname(child))
  const rel = path.relative(parentReal, childReal)
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

function createExperimentalRoute(sessionId) {
  const sourceDir = path.join(outputRoot, 'source', sessionId)
  mkdirSync(sourceDir, { recursive: true })
  const htmlPath = path.join(sourceDir, 'index.html')
  const manifestPath = path.join(sourceDir, 'aifx-r1-foundation-manifest.json')
  const manifest = {
    track: 'AIFX-R',
    phase: 'AIFX-R1',
    status: 'experimental',
    sourceOwned: true,
    productionRouteInjected: false,
    realComfyConnected: false,
    overwriteEnabled: false,
    mockWorkflow: {
      templateReferenceResultFlow: true,
      queue: true,
      comfyAdapter: 'mock',
      deterministicGeneration: true
    }
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NovaFlow AIFX-R1 Experimental Rebuild</title>
  <style>
    :root {
      --rail: 100px;
      --panel: 320px;
      --gap: 11px;
      --bg: #0e151d;
      --rail-bg: #111b25;
      --panel-bg: #162231;
      --surface: #0b1219;
      --surface-2: #121d29;
      --border: #2a3e50;
      --text: #eef6ff;
      --muted: #9eb2c4;
      --accent: #5dc7ff;
      --ok: #73d99f;
      --warn: #f2c266;
      --bad: #e9787e;
    }
    * { box-sizing: border-box; }
    html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body {
      background: var(--bg);
      color: var(--text);
      font: 13px/1.4 "Segoe UI", Arial, sans-serif;
    }
    .shell {
      width: 100%;
      height: 100%;
      display: grid;
      grid-template-columns: var(--rail) var(--panel) minmax(0, 1fr);
      gap: var(--gap);
      min-width: 0;
      overflow: hidden;
    }
    .rail {
      width: var(--rail);
      min-width: var(--rail);
      height: 100%;
      padding: 12px 8px;
      background: var(--rail-bg);
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow: hidden;
    }
    .rail button,
    .tabs button {
      min-height: 38px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #172536;
      color: var(--muted);
      font: inherit;
    }
    .rail button[aria-pressed="true"],
    .tabs button[aria-pressed="true"] {
      background: #23394c;
      color: var(--text);
      border-color: #41617c;
    }
    .side {
      min-width: 0;
      height: 100%;
      padding: 12px 0;
      overflow: hidden;
    }
    .tabs {
      display: flex;
      height: 34px;
      gap: 8px;
      margin-bottom: 8px;
    }
    .tabs button {
      flex: 1 1 0;
      min-width: 0;
      min-height: 34px;
    }
    .panel {
      height: calc(100% - 42px);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--panel-bg);
    }
    .panel-body {
      width: 100%;
      height: 100%;
      min-width: 0;
      overflow: auto;
      padding: 12px;
    }
    .route {
      min-width: 0;
      height: 100%;
      padding: 12px 14px 12px 0;
      overflow: hidden;
    }
    .workspace {
      width: 100%;
      height: 100%;
      display: grid;
      grid-template-rows: 46px minmax(0, 1fr) 58px;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--surface);
    }
    header,
    footer {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 14px;
      background: var(--surface-2);
      border-bottom: 1px solid var(--border);
    }
    footer {
      border-top: 1px solid var(--border);
      border-bottom: 0;
      color: var(--muted);
    }
    .grid {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-rows: repeat(2, minmax(0, 1fr));
      gap: 10px;
      padding: 12px;
      overflow: hidden;
    }
    .card {
      min-width: 0;
      min-height: 0;
      border: 1px solid #283b4e;
      border-radius: 8px;
      padding: 12px;
      overflow: hidden;
      background: #111b26;
    }
    .card h2 { margin: 0 0 8px; font-size: 13px; }
    .chip {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 8px;
      border: 1px solid #31495c;
      border-radius: 6px;
      color: var(--muted);
      background: #172638;
    }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    .bad { color: var(--bad); }
    pre { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); font-size: 12px; }
  </style>
</head>
<body class="aifx-r1-experimental-shell nf-shell-ready" data-aifx-route="isolated" data-aifx-r1-route-state="experimental">
  <div id="root">
    <main class="shell" data-aifx-r1-shell="1">
      <nav class="rail" data-novaflow-primary-rail="1">
        <button data-novaflow-primary-entry="1" aria-pressed="true">AIFX</button>
        <button data-novaflow-primary-entry="1" aria-pressed="false">Queue</button>
        <button data-novaflow-primary-entry="1" aria-pressed="false">Result</button>
        <button data-novaflow-primary-entry="1" aria-pressed="false">Export</button>
      </nav>
      <aside class="side">
        <div class="tabs">
          <button data-novaflow-secondary-entry="1" aria-pressed="true">Template</button>
          <button data-novaflow-secondary-entry="1" aria-pressed="false">Reference</button>
        </div>
        <section class="panel" data-novaflow-panel="1">
          <div class="panel-body">
            <span class="chip" data-template-state>template:none</span>
            <span class="chip" data-reference-state>reference:none</span>
            <pre data-state-dump>{}</pre>
          </div>
        </section>
      </aside>
      <section class="route">
        <section class="workspace" data-aifx-r1-route="1" data-aifx-isolated-route="1">
          <header>
            <strong>AIFX-R1 experimental rebuild</strong>
            <span class="chip" data-comfy-state>comfy:mock</span>
            <span class="chip" data-queue-state>queue:idle</span>
          </header>
          <div class="grid">
            <article class="card"><h2>Template</h2><div data-template-detail>none</div></article>
            <article class="card"><h2>Reference</h2><div data-reference-detail>none</div></article>
            <article class="card"><h2>Queue</h2><div data-queue-detail>idle</div></article>
            <article class="card"><h2>Result</h2><div data-result-detail>empty</div></article>
          </div>
          <footer>
            <span>mock workflow</span>
            <span>deterministic generation</span>
            <span>no production route injection</span>
          </footer>
        </section>
      </section>
    </main>
  </div>
  <script>
    (() => {
      const fixedSeed = "AIFX_R1_FOUNDATION_SEED_V1";
      const encoder = new TextEncoder();
      const clone = (value) => JSON.parse(JSON.stringify(value));
      async function sha256(text) {
        const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
        return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
      }
      function typedError(code, message, classification) {
        return { code, message, classification };
      }
      function initial() {
        return {
          templateState: { selectedTemplateId: null, status: "none" },
          referenceState: { referenceName: null, referenceHash: null, status: "none" },
          comfyAvailabilityState: { status: "mock", classification: "not_checked", typedError: null },
          queueState: { status: "idle", pending: 0, running: 0, completed: 0, failed: 0, canceled: 0, tasks: [] },
          resultState: { status: "empty", taskId: null, resultHash: null, deterministicSeed: fixedSeed },
          receipts: [],
          taskCounter: 0
        };
      }
      let state = initial();
      function queueCounts() {
        const counts = { pending: 0, running: 0, completed: 0, failed: 0, canceled: 0 };
        for (const task of state.queueState.tasks) {
          if (task.status === "queued") counts.pending += 1;
          else if (task.status === "running") counts.running += 1;
          else if (task.status === "completed") counts.completed += 1;
          else if (task.status === "failed") counts.failed += 1;
          else if (task.status === "canceled") counts.canceled += 1;
        }
        state.queueState = { ...state.queueState, ...counts, status: counts.running ? "running" : counts.pending ? "queued" : "idle" };
      }
      function getState() {
        queueCounts();
        return {
          templateState: clone(state.templateState),
          referenceState: clone(state.referenceState),
          comfyAvailabilityState: clone(state.comfyAvailabilityState),
          queueState: clone(state.queueState),
          resultState: clone(state.resultState),
          receipts: clone(state.receipts)
        };
      }
      function render() {
        queueCounts();
        const set = (selector, value) => {
          const node = document.querySelector(selector);
          if (node) node.textContent = value;
        };
        set("[data-template-state]", "template:" + (state.templateState.selectedTemplateId || "none"));
        set("[data-reference-state]", "reference:" + (state.referenceState.referenceName || "none"));
        set("[data-comfy-state]", "comfy:" + state.comfyAvailabilityState.status);
        set("[data-queue-state]", "queue:" + state.queueState.status);
        set("[data-template-detail]", JSON.stringify(state.templateState));
        set("[data-reference-detail]", JSON.stringify(state.referenceState));
        set("[data-queue-detail]", JSON.stringify(state.queueState));
        set("[data-result-detail]", JSON.stringify(state.resultState));
        set("[data-state-dump]", JSON.stringify(getState(), null, 2));
      }
      function receipt(type, details) {
        const entry = { type, timestamp: performance.now(), details: clone(details || {}) };
        state.receipts.push(entry);
        render();
        return clone(entry);
      }
      function reset() {
        state = initial();
        render();
        return receipt("AIFX_R1_STATE_RESET", {});
      }
      function selectTemplate(templateId) {
        state.templateState = { selectedTemplateId: templateId, status: "selected" };
        return receipt("AIFX_R1_TEMPLATE_SELECTED", state.templateState);
      }
      function setReference(reference) {
        state.referenceState = {
          referenceName: reference && reference.name || "reference-r1.png",
          referenceHash: reference && reference.sha256 || null,
          status: "ready"
        };
        return receipt("AIFX_R1_REFERENCE_READY", state.referenceState);
      }
      function enqueueGeneration(payload) {
        state.taskCounter += 1;
        const task = {
          taskId: "aifx-r1-task-" + state.taskCounter,
          prompt: payload && payload.prompt || "",
          templateId: state.templateState.selectedTemplateId,
          referenceHash: state.referenceState.referenceHash,
          status: "queued",
          attempts: 0,
          typedError: null,
          result: null
        };
        state.queueState.tasks.push(task);
        queueCounts();
        return { type: "TASK_ENQUEUED", taskId: task.taskId, queueState: clone(state.queueState) };
      }
      function findTask(taskId) {
        return state.queueState.tasks.find((task) => task.taskId === taskId) || null;
      }
      function nextRunnableTask() {
        return state.queueState.tasks.find((task) => task.status === "queued" || task.status === "running") || null;
      }
      function cancelTask(taskId) {
        const task = findTask(taskId);
        if (!task || task.status === "completed") return { type: "TASK_CANCEL_REJECTED", taskId, queueState: clone(state.queueState) };
        task.status = "canceled";
        task.typedError = typedError("TASK_CANCELED", "AIFX-R1 task canceled.", "user_cancel");
        queueCounts();
        return { type: "TASK_CANCELED", taskId, queueState: clone(state.queueState), typedError: clone(task.typedError) };
      }
      function retryTask(taskId) {
        const task = findTask(taskId);
        if (!task || task.status !== "failed") return { type: "TASK_RETRY_REJECTED", taskId, queueState: clone(state.queueState) };
        task.status = "queued";
        task.typedError = null;
        task.result = null;
        queueCounts();
        return { type: "TASK_RETRIED", taskId, queueState: clone(state.queueState) };
      }
      async function runNextTask(mode) {
        const task = nextRunnableTask();
        if (!task) return { type: "TASK_NONE", queueState: clone(state.queueState) };
        task.status = "running";
        task.attempts += 1;
        queueCounts();
        const failures = {
          unavailable: ["unavailable", "external_dependency_down", "COMFY_UNAVAILABLE", "Mock ComfyUI unavailable."],
          timeout: ["timeout", "timeout", "COMFY_TIMEOUT", "Mock ComfyUI timeout."],
          "dependency-failure": ["dependency_failure", "model_or_workflow_missing", "COMFY_DEPENDENCY_FAILED", "Mock model or workflow missing."]
        };
        if (failures[mode]) {
          const [status, classification, code, message] = failures[mode];
          state.comfyAvailabilityState = { status, classification, typedError: typedError(code, message, classification) };
          task.status = "failed";
          task.typedError = clone(state.comfyAvailabilityState.typedError);
          queueCounts();
          return { type: "TASK_FAILED", taskId: task.taskId, queueState: clone(state.queueState), comfyAvailabilityState: clone(state.comfyAvailabilityState), typedError: clone(task.typedError) };
        }
        state.comfyAvailabilityState = { status: "available", classification: "mock", typedError: null };
        const payload = {
          adapter: "aifx-r1-mock-comfy",
          seed: fixedSeed,
          prompt: task.prompt,
          templateId: task.templateId,
          referenceHash: task.referenceHash,
          workflowVersion: "experimental-r1"
        };
        const resultHash = await sha256(JSON.stringify(payload));
        task.status = "completed";
        task.result = { hash: resultHash, payload };
        state.resultState = { status: "ready", taskId: task.taskId, resultHash, deterministicSeed: fixedSeed };
        queueCounts();
        return { type: "TASK_COMPLETED", taskId: task.taskId, queueState: clone(state.queueState), comfyAvailabilityState: clone(state.comfyAvailabilityState), result: clone(task.result) };
      }
      window.__NOVAFLOW_AIFX_R1_FOUNDATION__ = {
        track: "AIFX-R",
        phase: "AIFX-R1",
        experimental: true,
        productionRouteInjected: false,
        shellRuntimeMutationAllowed: false,
        protectedIslandMutationAllowed: false,
        overwriteAllowed: false
      };
      window.__NOVAFLOW_AIFX_PROTOTYPE__ = {
        reset,
        selectTemplate,
        setReference,
        enqueueGeneration,
        cancelTask,
        retryTask,
        runNextTask,
        getState
      };
      render();
    })();
  </script>
</body>
</html>
`

  writeFileSync(htmlPath, html, 'utf8')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { htmlPath, manifestPath, manifest }
}

function parseG5Result(stdout) {
  const match = String(stdout || '').match(/__NOVAFLOW_G5_AIFX_RESULT__(.*)__END_NOVAFLOW_G5_AIFX_RESULT__/s)
  assert(match, 'AIFX_R1_RESULT_MISSING')
  return JSON.parse(match[1])
}

function runElectronScenario(sessionId, renderer) {
  const exportRoot = path.join(outputRoot, 'exports', sessionId)
  mkdirSync(exportRoot, { recursive: true })
  const run = spawnSync(electronCmd, [g5App], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      NOVAFLOW_G5_AIFX_HARNESS: '1',
      NOVAFLOW_TOOLS_SMOKE: '1',
      NOVAFLOW_DISABLE_LEGACY_WRITE: '1',
      NOVAFLOW_SMOKE_REPO_ROOT: repoRoot,
      NOVAFLOW_G5_AIFX_TEMP_ROOT: outputRoot,
      NOVAFLOW_G5_AIFX_PROFILE: path.join(outputRoot, 'smoke-profile', sessionId),
      NOVAFLOW_G5_AIFX_EXPORT_ROOT: exportRoot,
      NOVAFLOW_G5_AIFX_RENDERER_ENTRY: renderer,
      NOVAFLOW_G5_AIFX_SESSION: sessionId,
      NOVAFLOW_PACKAGED_APP_ROOT: packagedAppRoot
    }
  })
  if (run.stderr) process.stderr.write(run.stderr)
  assert(run.status === 0, 'AIFX_R1_ELECTRON_SCENARIO_FAILED', { status: run.status, stdout: run.stdout, stderr: run.stderr })
  return parseG5Result(run.stdout || '')
}

function validateScenario(result, tempRoot) {
  assert(result.ok === true, 'AIFX_R1_SCENARIO_NOT_OK', result)
  assert(result.protocol === 'file:', 'AIFX_R1_NOT_FILE_PROTOCOL', { protocol: result.protocol })
  assert(result.consoleErrorCount === 0, 'AIFX_R1_CONSOLE_ERRORS', result.consoleErrors)
  assert(result.productionRuntimeStable === true, 'AIFX_R1_RUNTIME_CHAIN_UNSTABLE', result)
  assert(result.runtimeMutationDetected === false, 'AIFX_R1_RUNTIME_MUTATION_DETECTED', result)
  assert(result.aifxResult && result.aifxResult.routeStabilityReceipt && result.aifxResult.routeStabilityReceipt.routeStable === true, 'AIFX_R1_ROUTE_NOT_STABLE', result.aifxResult)
  for (const code of ['COMFY_UNAVAILABLE', 'COMFY_TIMEOUT', 'COMFY_DEPENDENCY_FAILED']) {
    assert(result.failureCodes.includes(code), 'AIFX_R1_FAILURE_CLASSIFICATION_MISSING', { code, failureCodes: result.failureCodes })
  }
  assert(typeof result.deterministicResultHash === 'string' && result.deterministicResultHash.length === 64, 'AIFX_R1_DETERMINISTIC_HASH_INVALID', result.deterministicResultHash)
  assert(result.aifxResult.exportReceipt && result.aifxResult.exportReceipt.ok === true, 'AIFX_R1_EXPORT_RECEIPT_INVALID', result.aifxResult.exportReceipt)
  assert(result.aifxResult.exportReceipt.hashBefore === result.aifxResult.exportReceipt.hashAfter, 'AIFX_R1_EXPORT_HASH_MISMATCH', result.aifxResult.exportReceipt)
  assert(result.aifxResult.exportReceipt.tmpLeftoverCount === 0, 'AIFX_R1_TMP_LEFTOVERS', result.aifxResult.exportReceipt)
  const exportPath = path.join(repoRoot, result.aifxResult.exportReceipt.tempPath)
  assert(existsSync(exportPath), 'AIFX_R1_EXPORT_FILE_MISSING', result.aifxResult.exportReceipt)
  assert(isInside(tempRoot, exportPath), 'AIFX_R1_EXPORT_OUTSIDE_DEBUG_OUTPUT', { tempRoot, exportPath })
  assert(result.smokeTelemetry.realWriteCount === 1, 'AIFX_R1_REAL_WRITE_COUNT_UNEXPECTED', result.smokeTelemetry)
  assert(result.smokeTelemetry.blockedLegacyWriteCount === 0, 'AIFX_R1_LEGACY_WRITE_CALLED', result.smokeTelemetry)
}

try {
  for (const [name, file] of Object.entries({ electronCmd, g5App, productionRendererEntry })) {
    assert(existsSync(file), 'AIFX_R1_REQUIRED_FILE_MISSING', { name, file })
  }
  for (const file of protectedBoundaryFiles) {
    assert(existsSync(file), 'AIFX_R1_BOUNDARY_FILE_MISSING', { file })
  }

  mkdirSync(outputRoot, { recursive: true })
  const sessionId = `aifx-r1-foundation-${Date.now()}`
  const productionBefore = hashRuntimeChain()
  const boundaryBefore = hashFiles(protectedBoundaryFiles)
  const route = createExperimentalRoute(sessionId)
  const first = runElectronScenario(`${sessionId}-run-1`, route.htmlPath)
  const second = runElectronScenario(`${sessionId}-run-2`, route.htmlPath)
  validateScenario(first, outputRoot)
  validateScenario(second, outputRoot)
  assert(first.deterministicResultHash === second.deterministicResultHash, 'AIFX_R1_DETERMINISTIC_RESULT_NOT_STABLE', {
    first: first.deterministicResultHash,
    second: second.deterministicResultHash
  })
  assert(first.aifxResult.exportReceipt.deterministicOutputHash === second.aifxResult.exportReceipt.deterministicOutputHash, 'AIFX_R1_DETERMINISTIC_EXPORT_NOT_STABLE', {
    first: first.aifxResult.exportReceipt.deterministicOutputHash,
    second: second.aifxResult.exportReceipt.deterministicOutputHash
  })

  const productionAfter = hashRuntimeChain()
  const boundaryAfter = hashFiles(protectedBoundaryFiles)
  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfter), 'AIFX_R1_RUNTIME_CHAIN_CHANGED', {
    before: productionBefore,
    after: productionAfter
  })
  assert(JSON.stringify(boundaryBefore) === JSON.stringify(boundaryAfter), 'AIFX_R1_BOUNDARY_FILE_CHANGED', {
    before: boundaryBefore,
    after: boundaryAfter
  })

  const foundationReceipt = {
    sessionId,
    timestamp: new Date().toISOString(),
    track: 'AIFX-R',
    phase: 'AIFX-R1',
    classification: 'EXPERIMENTAL_REBUILD_FOUNDATION_READY',
    readiness: 'READY_FOR_AIFX_R2_EXPERIMENTAL_EXPANSION',
    productionRuntimeStable: true,
    protectedIslandBoundaryStable: true,
    shellRuntimeRegression: false,
    protectedIslandRegression: false,
    toolsBridgeSafetyChanged: false,
    experimentalRouteRunnable: true,
    mockWorkflowRunnable: true,
    deterministicMockGeneration: true,
    deterministicResultHash: first.deterministicResultHash,
    deterministicExportHash: first.aifxResult.exportReceipt.deterministicOutputHash,
    sourceRoute: path.relative(repoRoot, route.htmlPath).replace(/\\/g, '/'),
    manifestPath: path.relative(repoRoot, route.manifestPath).replace(/\\/g, '/'),
    blockers: [
      'AIFX-R remains experimental and is not a production route migration',
      'real Comfy workflow is not connected',
      'shell/runtime and protected island boundaries remain frozen',
      'overwrite remains disabled'
    ]
  }
  const receiptPath = path.join(outputRoot, `${sessionId}-receipt.json`)
  writeFileSync(receiptPath, `${JSON.stringify(foundationReceipt, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    code: 'AIFX_R1_EXPERIMENTAL_REBUILD_FOUNDATION_OK',
    sessionId,
    receiptPath: path.relative(repoRoot, receiptPath).replace(/\\/g, '/'),
    sourceRoute: foundationReceipt.sourceRoute,
    manifestPath: foundationReceipt.manifestPath,
    productionRuntimeStable: true,
    protectedIslandBoundaryStable: true,
    experimentalRouteRunnable: true,
    mockWorkflowRunnable: true,
    deterministicMockGeneration: true,
    deterministicResultHash: foundationReceipt.deterministicResultHash,
    deterministicExportHash: foundationReceipt.deterministicExportHash,
    shellRuntimeRegression: false,
    protectedIslandRegression: false,
    toolsBridgeSafetyChanged: false,
    classification: foundationReceipt.classification,
    readiness: foundationReceipt.readiness,
    blockers: foundationReceipt.blockers,
    firstRun: {
      consoleErrorCount: first.consoleErrorCount,
      routeStable: first.aifxResult.routeStabilityReceipt.routeStable,
      failureCodes: first.failureCodes,
      realWriteCount: first.smokeTelemetry.realWriteCount,
      exportPath: first.aifxResult.exportReceipt.tempPath
    },
    secondRun: {
      consoleErrorCount: second.consoleErrorCount,
      routeStable: second.aifxResult.routeStabilityReceipt.routeStable,
      failureCodes: second.failureCodes,
      realWriteCount: second.smokeTelemetry.realWriteCount,
      exportPath: second.aifxResult.exportReceipt.tempPath
    }
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'AIFX_R1_EXPERIMENTAL_REBUILD_FOUNDATION_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
