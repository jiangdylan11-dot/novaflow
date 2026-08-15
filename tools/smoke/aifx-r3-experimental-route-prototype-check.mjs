import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { request } from 'node:http'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const packagedAppRoot = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app')
const productionRendererEntry = path.join(packagedAppRoot, 'renderer', 'index.html')
const outputRoot = path.join(repoRoot, 'debug-output', 'aifx-r3-experimental-route-prototype-2026-05-17')
const electronCmd = process.platform === 'win32'
  ? path.join(repoRoot, 'particle-editor-desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(repoRoot, 'particle-editor-desktop', 'node_modules', '.bin', 'electron')
const g5App = path.join(__dirname, 'g5-aifx-isolated-source-app.cjs')

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

function probeLocalComfy(timeoutMs = 1200) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const req = request({
      host: '127.0.0.1',
      port: 8000,
      path: '/system_stats',
      method: 'GET',
      timeout: timeoutMs
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
        if (body.length > 1200) body = body.slice(0, 1200)
      })
      res.on('end', () => {
        resolve({
          checked: true,
          available: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
          mode: 'optional-local-probe',
          gracefulFailureAllowed: true,
          bodyPreview: body.slice(0, 200)
        })
      })
    })
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
    })
    req.on('error', (error) => {
      resolve({
        checked: true,
        available: false,
        statusCode: null,
        durationMs: Date.now() - startedAt,
        mode: 'optional-local-probe',
        gracefulFailureAllowed: true,
        typedError: {
          code: error && error.message === 'timeout' ? 'COMFY_PROBE_TIMEOUT' : 'COMFY_PROBE_UNAVAILABLE',
          message: error && error.message ? error.message : 'Local Comfy probe unavailable.',
          classification: 'external_dependency'
        }
      })
    })
    req.end()
  })
}

function createExperimentalRoute(sessionId, comfyProbe) {
  const sourceDir = path.join(outputRoot, 'source', sessionId)
  mkdirSync(sourceDir, { recursive: true })
  const htmlPath = path.join(sourceDir, 'index.html')
  const manifestPath = path.join(sourceDir, 'aifx-r3-route-prototype-manifest.json')
  const manifest = {
    track: 'AIFX-R',
    phase: 'AIFX-R3',
    sourceOwnedRoute: true,
    routeCompleteness: 'experimental-incomplete',
    productionRouteInjected: false,
    realComfyProductionConnected: false,
    optionalLocalComfyProbe: comfyProbe,
    overwriteEnabled: false
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NovaFlow AIFX-R3 Experimental Route</title>
  <style>
    :root {
      --rail: 100px;
      --panel: 328px;
      --gap: 11px;
      --bg: #0d151d;
      --rail-bg: #101a24;
      --panel-bg: #162332;
      --surface: #0b1219;
      --surface-2: #121f2c;
      --border: #2a4052;
      --text: #eef7ff;
      --muted: #9fb4c6;
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
    button {
      min-height: 34px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #172536;
      color: var(--muted);
      font: inherit;
    }
    button[aria-pressed="true"] {
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
      grid-template-rows: 48px minmax(0, 1fr) 58px;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--surface);
    }
    header, footer {
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
      grid-template-columns: 1.1fr 0.9fr;
      grid-template-rows: 1fr 1fr;
      gap: 10px;
      padding: 12px;
      overflow: hidden;
    }
    .card {
      min-width: 0;
      min-height: 0;
      border: 1px solid #283d50;
      border-radius: 8px;
      padding: 12px;
      overflow: hidden;
      background: #111c27;
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
<body class="aifx-r3-experimental-route nf-shell-ready" data-aifx-route="isolated" data-aifx-r3-route-state="prototype">
  <div id="root">
    <main class="shell" data-aifx-r3-shell="1">
      <nav class="rail" data-novaflow-primary-rail="1">
        <button data-novaflow-primary-entry="1" aria-pressed="true">AIFX</button>
        <button data-novaflow-primary-entry="1" aria-pressed="false">Queue</button>
        <button data-novaflow-primary-entry="1" aria-pressed="false">Probe</button>
        <button data-novaflow-primary-entry="1" aria-pressed="false">Result</button>
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
        <section class="workspace" data-aifx-r3-route="1" data-aifx-isolated-route="1">
          <header>
            <strong>AIFX-R3 route prototype</strong>
            <span class="chip" data-comfy-state>comfy:probe</span>
            <span class="chip" data-queue-state>queue:idle</span>
          </header>
          <div class="grid">
            <article class="card"><h2>Template Flow</h2><div data-template-detail>none</div></article>
            <article class="card"><h2>Reference Flow</h2><div data-reference-detail>none</div></article>
            <article class="card"><h2>Queue</h2><div data-queue-detail>idle</div></article>
            <article class="card"><h2>Result</h2><div data-result-detail>empty</div></article>
          </div>
          <footer>
            <span>semi-real workflow shell</span>
            <span>local Comfy probe graceful fail</span>
            <span>no production mutation</span>
          </footer>
        </section>
      </section>
    </main>
  </div>
  <script>
    (() => {
      const fixedSeed = "AIFX_R3_ROUTE_PROTOTYPE_SEED_V1";
      const comfyProbe = ${JSON.stringify(comfyProbe)};
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
          templateState: { selectedTemplateId: null, status: "none", workflow: "semi-real" },
          referenceState: { referenceName: null, referenceHash: null, status: "none" },
          comfyAvailabilityState: comfyProbe.available
            ? { status: "available", classification: "optional_local_probe", typedError: null }
            : { status: "unavailable", classification: "graceful_probe_failure", typedError: typedError(comfyProbe.typedError && comfyProbe.typedError.code || "COMFY_PROBE_UNAVAILABLE", "Optional local Comfy probe unavailable.", "external_dependency") },
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
        return receipt("AIFX_R3_ROUTE_RESET", { comfyProbe });
      }
      function selectTemplate(templateId) {
        state.templateState = { selectedTemplateId: templateId, status: "selected", workflow: "semi-real-route-prototype" };
        return receipt("AIFX_R3_TEMPLATE_SELECTED", state.templateState);
      }
      function setReference(reference) {
        state.referenceState = {
          referenceName: reference && reference.name || "reference-r3.png",
          referenceHash: reference && reference.sha256 || null,
          status: "ready"
        };
        return receipt("AIFX_R3_REFERENCE_READY", state.referenceState);
      }
      function enqueueGeneration(payload) {
        state.taskCounter += 1;
        const task = {
          taskId: "aifx-r3-task-" + state.taskCounter,
          prompt: payload && payload.prompt || "",
          templateId: state.templateState.selectedTemplateId,
          referenceHash: state.referenceState.referenceHash,
          status: "queued",
          attempts: 0,
          typedError: null,
          result: null,
          semiRealWorkflow: true
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
        task.typedError = typedError("TASK_CANCELED", "AIFX-R3 route task canceled.", "user_cancel");
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
        if (!comfyProbe.available && mode === "semi-real") {
          state.comfyAvailabilityState = { status: "unavailable", classification: "graceful_probe_failure", typedError: typedError("COMFY_PROBE_UNAVAILABLE", "Optional local Comfy probe unavailable; using deterministic mock fallback.", "external_dependency") };
        } else {
          state.comfyAvailabilityState = { status: "available", classification: comfyProbe.available ? "optional_local_probe" : "mock", typedError: null };
        }
        const payload = {
          adapter: comfyProbe.available ? "aifx-r3-local-probe-adapter" : "aifx-r3-mock-fallback-adapter",
          seed: fixedSeed,
          prompt: task.prompt,
          templateId: task.templateId,
          referenceHash: task.referenceHash,
          workflowVersion: "experimental-r3",
          comfyProbeAvailable: comfyProbe.available
        };
        const resultHash = await sha256(JSON.stringify(payload));
        task.status = "completed";
        task.result = { hash: resultHash, payload };
        task.typedError = null;
        state.resultState = { status: "ready", taskId: task.taskId, resultHash, deterministicSeed: fixedSeed };
        queueCounts();
        return { type: "TASK_COMPLETED", taskId: task.taskId, queueState: clone(state.queueState), comfyAvailabilityState: clone(state.comfyAvailabilityState), result: clone(task.result) };
      }
      window.__NOVAFLOW_AIFX_R3_ROUTE__ = {
        track: "AIFX-R",
        phase: "AIFX-R3",
        experimental: true,
        productionRouteInjected: false,
        shellRuntimeMutationAllowed: false,
        protectedIslandMutationAllowed: false,
        overwriteAllowed: false,
        comfyProbe
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
  assert(match, 'AIFX_R3_RESULT_MISSING')
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
  assert(run.status === 0, 'AIFX_R3_ELECTRON_SCENARIO_FAILED', { status: run.status, stdout: run.stdout, stderr: run.stderr })
  return parseG5Result(run.stdout || '')
}

function validateScenario(result, tempRoot) {
  assert(result.ok === true, 'AIFX_R3_SCENARIO_NOT_OK', result)
  assert(result.protocol === 'file:', 'AIFX_R3_NOT_FILE_PROTOCOL', { protocol: result.protocol })
  assert(result.consoleErrorCount === 0, 'AIFX_R3_CONSOLE_ERRORS', result.consoleErrors)
  assert(result.productionRuntimeStable === true, 'AIFX_R3_RUNTIME_CHAIN_UNSTABLE', result)
  assert(result.runtimeMutationDetected === false, 'AIFX_R3_RUNTIME_MUTATION_DETECTED', result)
  assert(result.aifxResult && result.aifxResult.routeStabilityReceipt && result.aifxResult.routeStabilityReceipt.routeStable === true, 'AIFX_R3_ROUTE_NOT_STABLE', result.aifxResult)
  for (const code of ['COMFY_UNAVAILABLE', 'COMFY_TIMEOUT', 'COMFY_DEPENDENCY_FAILED']) {
    assert(result.failureCodes.includes(code), 'AIFX_R3_FAILURE_CLASSIFICATION_MISSING', { code, failureCodes: result.failureCodes })
  }
  assert(typeof result.deterministicResultHash === 'string' && result.deterministicResultHash.length === 64, 'AIFX_R3_DETERMINISTIC_HASH_INVALID', result.deterministicResultHash)
  assert(result.aifxResult.exportReceipt && result.aifxResult.exportReceipt.ok === true, 'AIFX_R3_EXPORT_RECEIPT_INVALID', result.aifxResult.exportReceipt)
  assert(result.aifxResult.exportReceipt.tmpLeftoverCount === 0, 'AIFX_R3_TMP_LEFTOVERS', result.aifxResult.exportReceipt)
  const exportPath = path.join(repoRoot, result.aifxResult.exportReceipt.tempPath)
  assert(existsSync(exportPath), 'AIFX_R3_EXPORT_FILE_MISSING', result.aifxResult.exportReceipt)
  assert(isInside(tempRoot, exportPath), 'AIFX_R3_EXPORT_OUTSIDE_DEBUG_OUTPUT', { tempRoot, exportPath })
  assert(result.smokeTelemetry.realWriteCount === 1, 'AIFX_R3_REAL_WRITE_COUNT_UNEXPECTED', result.smokeTelemetry)
  assert(result.smokeTelemetry.blockedLegacyWriteCount === 0, 'AIFX_R3_LEGACY_WRITE_CALLED', result.smokeTelemetry)
}

try {
  for (const [name, file] of Object.entries({ electronCmd, g5App, productionRendererEntry })) {
    assert(existsSync(file), 'AIFX_R3_REQUIRED_FILE_MISSING', { name, file })
  }
  for (const file of boundaryFiles) {
    assert(existsSync(file), 'AIFX_R3_BOUNDARY_FILE_MISSING', { file })
  }

  mkdirSync(outputRoot, { recursive: true })
  const sessionId = `aifx-r3-route-${Date.now()}`
  const productionBefore = hashRuntimeChain()
  const boundaryBefore = hashFiles(boundaryFiles)
  const comfyProbe = await probeLocalComfy()
  const route = createExperimentalRoute(sessionId, comfyProbe)
  const first = runElectronScenario(`${sessionId}-run-1`, route.htmlPath)
  const second = runElectronScenario(`${sessionId}-run-2`, route.htmlPath)
  validateScenario(first, outputRoot)
  validateScenario(second, outputRoot)
  assert(first.deterministicResultHash === second.deterministicResultHash, 'AIFX_R3_DETERMINISTIC_RESULT_NOT_STABLE', {
    first: first.deterministicResultHash,
    second: second.deterministicResultHash
  })

  const productionAfter = hashRuntimeChain()
  const boundaryAfter = hashFiles(boundaryFiles)
  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfter), 'AIFX_R3_RUNTIME_CHAIN_CHANGED', {
    before: productionBefore,
    after: productionAfter
  })
  assert(JSON.stringify(boundaryBefore) === JSON.stringify(boundaryAfter), 'AIFX_R3_BOUNDARY_FILE_CHANGED', {
    before: boundaryBefore,
    after: boundaryAfter
  })

  const prototypeReceipt = {
    sessionId,
    timestamp: new Date().toISOString(),
    track: 'AIFX-R',
    phase: 'AIFX-R3',
    classification: 'AIFX_R3_EXPERIMENTAL_ROUTE_PROTOTYPE_READY',
    readiness: 'READY_FOR_AIFX_R4_EXPERIMENTAL_UI_ITERATION',
    sourceRoute: path.relative(repoRoot, route.htmlPath).replace(/\\/g, '/'),
    manifestPath: path.relative(repoRoot, route.manifestPath).replace(/\\/g, '/'),
    shellRuntimeRegression: false,
    protectedIslandRegression: false,
    toolsBridgeSafetyChanged: false,
    experimentalRouteRunnable: true,
    semiRealWorkflowRunnable: true,
    semiRealWorkflowMode: comfyProbe.available ? 'optional-local-comfy-probe' : 'mock-fallback-graceful-fail',
    comfyProbe,
    deterministicResultHash: first.deterministicResultHash,
    deterministicExportHash: first.aifxResult.exportReceipt.deterministicOutputHash,
    blockers: [
      'AIFX-R3 is experimental only',
      'production shell route remains frozen',
      'real Comfy production workflow is not connected',
      'overwrite remains disabled'
    ]
  }
  const receiptPath = path.join(outputRoot, `${sessionId}-receipt.json`)
  writeFileSync(receiptPath, `${JSON.stringify(prototypeReceipt, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    code: 'AIFX_R3_EXPERIMENTAL_ROUTE_PROTOTYPE_OK',
    sessionId,
    receiptPath: path.relative(repoRoot, receiptPath).replace(/\\/g, '/'),
    sourceRoute: prototypeReceipt.sourceRoute,
    manifestPath: prototypeReceipt.manifestPath,
    productionRuntimeStable: true,
    shellRuntimeRegression: false,
    protectedIslandRegression: false,
    toolsBridgeSafetyChanged: false,
    experimentalRouteRunnable: true,
    semiRealWorkflowRunnable: true,
    semiRealWorkflowMode: prototypeReceipt.semiRealWorkflowMode,
    comfyProbe,
    deterministicResultHash: prototypeReceipt.deterministicResultHash,
    deterministicExportHash: prototypeReceipt.deterministicExportHash,
    realComfyProductionConnected: false,
    overwriteEnabled: false,
    classification: prototypeReceipt.classification,
    readiness: prototypeReceipt.readiness,
    blockers: prototypeReceipt.blockers
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'AIFX_R3_EXPERIMENTAL_ROUTE_PROTOTYPE_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
