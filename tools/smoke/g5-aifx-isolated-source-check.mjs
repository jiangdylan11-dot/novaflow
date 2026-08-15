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
const prototypeRoot = path.join(repoRoot, 'debug-output', 'aifx-isolated-source-prototype-2026-05-17')
const electronCmd = process.platform === 'win32'
  ? path.join(repoRoot, 'particle-editor-desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(repoRoot, 'particle-editor-desktop', 'node_modules', '.bin', 'electron')
const g5App = path.join(__dirname, 'g5-aifx-isolated-source-app.cjs')

const requiredParityFields = [
  'queueState',
  'comfyAvailabilityState',
  'templateState',
  'referenceState',
  'resultState',
  'routeStable',
  'consoleErrorDelta',
  'runtimeMutationDetected'
]

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

function isInside(parent, child) {
  const parentReal = realpathSync(parent)
  const childReal = existsSync(child) ? realpathSync(child) : realpathSync(path.dirname(child))
  const rel = path.relative(parentReal, childReal)
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

function createAifxPrototype(sessionId) {
  const sessionDir = path.join(prototypeRoot, sessionId)
  mkdirSync(sessionDir, { recursive: true })
  const htmlPath = path.join(sessionDir, 'index.html')
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NovaFlow AIFX Isolated Source Prototype</title>
  <style>
    :root {
      --rail-width: 100px;
      --panel-width: 312px;
      --gap: 11px;
      --bg: #0f1720;
      --rail: #111b25;
      --panel: #172331;
      --surface: #0c131b;
      --border: #2b3c4d;
      --accent: #57b8ff;
      --text: #edf6ff;
      --muted: #9db1c4;
      --ok: #6dd49f;
      --warn: #f0bd68;
      --bad: #e66f7b;
    }
    * { box-sizing: border-box; }
    html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body {
      background: var(--bg);
      color: var(--text);
      font: 13px/1.4 "Segoe UI", Arial, sans-serif;
    }
    .nf-shell {
      width: 100%;
      height: 100%;
      display: grid;
      grid-template-columns: var(--rail-width) var(--panel-width) minmax(0, 1fr);
      gap: var(--gap);
      min-width: 0;
      overflow: hidden;
    }
    .nf-primary-rail {
      width: var(--rail-width);
      min-width: var(--rail-width);
      height: 100%;
      padding: 12px 8px;
      background: var(--rail);
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow: hidden;
    }
    .nf-primary-entry {
      min-height: 40px;
      width: 100%;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      font: inherit;
      cursor: default;
    }
    .nf-primary-entry[aria-pressed="true"] {
      background: #203040;
      border-color: #33485a;
      color: var(--text);
    }
    .nf-left-shell {
      min-width: 0;
      height: 100%;
      padding: 12px 0;
      overflow: hidden;
    }
    .nf-secondary-tabs {
      display: flex;
      height: 34px;
      gap: 8px;
      margin-bottom: 8px;
    }
    .nf-secondary-entry {
      flex: 1 1 0;
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #182532;
      color: var(--muted);
      font: inherit;
    }
    .nf-secondary-entry[aria-pressed="true"] {
      color: var(--text);
      background: #24384a;
    }
    .nf-panel {
      height: calc(100% - 42px);
      min-width: 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
    }
    .nf-panel-body {
      width: 100%;
      max-width: 100%;
      height: 100%;
      min-width: 0;
      overflow: auto;
      padding: 12px;
    }
    .nf-route-container {
      min-width: 0;
      height: 100%;
      padding: 12px 14px 12px 0;
      overflow: hidden;
    }
    .aifx-route {
      width: 100%;
      height: 100%;
      min-width: 0;
      display: grid;
      grid-template-rows: 44px minmax(0, 1fr) 58px;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--surface);
    }
    .aifx-header, .aifx-footer {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 14px;
      background: #121d28;
      border-bottom: 1px solid var(--border);
    }
    .aifx-footer {
      border-top: 1px solid var(--border);
      border-bottom: 0;
      color: var(--muted);
    }
    .aifx-grid {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr 1fr;
      gap: 10px;
      padding: 12px;
      overflow: hidden;
    }
    .aifx-card {
      min-width: 0;
      min-height: 0;
      border: 1px solid #25384a;
      border-radius: 8px;
      background: #111a24;
      padding: 12px;
      overflow: hidden;
    }
    .aifx-card h2 {
      margin: 0 0 8px;
      font-size: 13px;
      font-weight: 650;
    }
    .aifx-chip {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 8px;
      border: 1px solid #31495c;
      border-radius: 6px;
      color: var(--muted);
      background: #172638;
    }
    .aifx-status-ok { color: var(--ok); }
    .aifx-status-warn { color: var(--warn); }
    .aifx-status-bad { color: var(--bad); }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 12px;
    }
  </style>
</head>
<body class="nf-shell-source-owned nf-route-aifx nf-shell-ready" data-aifx-route="isolated">
  <div id="root">
    <main class="nf-shell" data-novaflow-source-shell="1">
      <nav class="nf-primary-rail" data-novaflow-primary-rail="1">
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" aria-pressed="true" data-route="effects">AIFX</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" aria-pressed="false" data-route="animation">Queue</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" aria-pressed="false" data-route="art">Result</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" aria-pressed="false" data-route="tools">Export</button>
      </nav>
      <section class="nf-left-shell" data-novaflow-left-content-shell="1">
        <div class="nf-secondary-tabs">
          <button class="nf-secondary-entry" data-novaflow-secondary-entry="1" aria-pressed="true">Template</button>
          <button class="nf-secondary-entry" data-novaflow-secondary-entry="1" aria-pressed="false">Reference</button>
        </div>
        <section class="nf-panel" data-novaflow-panel="1">
          <div class="nf-panel-body">
            <div class="aifx-chip" data-template-state>template:none</div>
            <div class="aifx-chip" data-reference-state>reference:none</div>
            <pre data-state-dump>{}</pre>
          </div>
        </section>
      </section>
      <section class="nf-route-container">
        <section class="aifx-route" data-aifx-isolated-route="1">
          <header class="aifx-header">
            <strong>Source-owned AIFX isolated prototype</strong>
            <span class="aifx-chip" data-comfy-state>comfy:unknown</span>
            <span class="aifx-chip" data-queue-state>queue:idle</span>
          </header>
          <div class="aifx-grid">
            <article class="aifx-card">
              <h2>Template</h2>
              <div data-template-detail>none</div>
            </article>
            <article class="aifx-card">
              <h2>Reference</h2>
              <div data-reference-detail>none</div>
            </article>
            <article class="aifx-card">
              <h2>Queue</h2>
              <div data-queue-detail>idle</div>
            </article>
            <article class="aifx-card">
              <h2>Result</h2>
              <div data-result-detail>empty</div>
            </article>
          </div>
          <footer class="aifx-footer">
            <span>mock adapter only</span>
            <span>no production route injection</span>
          </footer>
        </section>
      </section>
    </main>
  </div>
  <script>
    (() => {
      const fixedSeed = "G5_AIFX_FIXED_SEED_V1";
      const initial = () => ({
        templateState: { selectedTemplateId: null, status: "none" },
        referenceState: { referenceName: null, referenceHash: null, status: "none" },
        comfyAvailabilityState: { status: "unknown", classification: "not_checked", typedError: null },
        queueState: { status: "idle", pending: 0, running: 0, completed: 0, failed: 0, canceled: 0, tasks: [] },
        resultState: { status: "empty", taskId: null, resultHash: null, deterministicSeed: fixedSeed },
        receipts: [],
        taskCounter: 0
      });
      let state = initial();
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const encoder = new TextEncoder();
      async function sha256(text) {
        const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
        return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
      }
      function typedError(code, message, classification) {
        return { code, message, classification };
      }
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
        const entry = { type, timestamp: performance.now(), details: clone(details || {}), state: getState() };
        state.receipts.push(entry);
        render();
        return clone(entry);
      }
      function reset() {
        state = initial();
        render();
        return receipt("STATE_RESET", {});
      }
      function selectTemplate(templateId) {
        state.templateState = { selectedTemplateId: templateId, status: "selected" };
        return receipt("TEMPLATE_SELECTED", { templateId });
      }
      function setReference(reference) {
        state.referenceState = {
          referenceName: reference && reference.name || "reference-mock.png",
          referenceHash: reference && reference.sha256 || null,
          status: "ready"
        };
        return receipt("REFERENCE_READY", state.referenceState);
      }
      function enqueueGeneration(payload) {
        state.taskCounter += 1;
        const task = {
          taskId: "g5-task-" + state.taskCounter,
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
        task.typedError = typedError("TASK_CANCELED", "Task canceled in isolated source prototype.", "user_cancel");
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
        if (mode === "unavailable") {
          state.comfyAvailabilityState = { status: "unavailable", classification: "external_dependency_down", typedError: typedError("COMFY_UNAVAILABLE", "Mock ComfyUI is unavailable.", "external_dependency") };
          task.status = "failed";
          task.typedError = clone(state.comfyAvailabilityState.typedError);
          queueCounts();
          return { type: "TASK_FAILED", taskId: task.taskId, queueState: clone(state.queueState), comfyAvailabilityState: clone(state.comfyAvailabilityState), typedError: clone(task.typedError) };
        }
        if (mode === "timeout") {
          state.comfyAvailabilityState = { status: "timeout", classification: "timeout", typedError: typedError("COMFY_TIMEOUT", "Mock ComfyUI timed out.", "timeout") };
          task.status = "failed";
          task.typedError = clone(state.comfyAvailabilityState.typedError);
          queueCounts();
          return { type: "TASK_FAILED", taskId: task.taskId, queueState: clone(state.queueState), comfyAvailabilityState: clone(state.comfyAvailabilityState), typedError: clone(task.typedError) };
        }
        if (mode === "dependency-failure") {
          state.comfyAvailabilityState = { status: "dependency_failure", classification: "model_or_workflow_missing", typedError: typedError("COMFY_DEPENDENCY_FAILED", "Mock model or workflow dependency missing.", "dependency_failure") };
          task.status = "failed";
          task.typedError = clone(state.comfyAvailabilityState.typedError);
          queueCounts();
          return { type: "TASK_FAILED", taskId: task.taskId, queueState: clone(state.queueState), comfyAvailabilityState: clone(state.comfyAvailabilityState), typedError: clone(task.typedError) };
        }
        state.comfyAvailabilityState = { status: "available", classification: "mock", typedError: null };
        const resultPayload = {
          adapter: "mock-comfy",
          seed: fixedSeed,
          templateId: task.templateId,
          referenceHash: task.referenceHash,
          prompt: task.prompt
        };
        const resultHash = await sha256(JSON.stringify(resultPayload));
        task.status = "completed";
        task.result = { hash: resultHash, payload: resultPayload };
        state.resultState = { status: "ready", taskId: task.taskId, resultHash, deterministicSeed: fixedSeed };
        queueCounts();
        return { type: "TASK_COMPLETED", taskId: task.taskId, queueState: clone(state.queueState), comfyAvailabilityState: clone(state.comfyAvailabilityState), result: clone(task.result) };
      }
      function getState() {
        return {
          templateState: clone(state.templateState),
          referenceState: clone(state.referenceState),
          comfyAvailabilityState: clone(state.comfyAvailabilityState),
          queueState: clone(state.queueState),
          resultState: clone(state.resultState),
          receipts: clone(state.receipts)
        };
      }
      const entries = Array.from(document.querySelectorAll("[data-novaflow-primary-entry]"));
      entries.forEach((entry) => entry.addEventListener("click", () => {
        entries.forEach((node) => node.setAttribute("aria-pressed", node === entry ? "true" : "false"));
        document.body.dataset.aifxRoute = "isolated";
      }));
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
  return htmlPath
}

function parseJsonOutput(stdout) {
  const trimmed = String(stdout || '').trim()
  const start = trimmed.lastIndexOf('\n{')
  const jsonText = start >= 0 ? trimmed.slice(start + 1) : trimmed
  return JSON.parse(jsonText)
}

function parseG5Result(stdout) {
  const match = stdout.match(/__NOVAFLOW_G5_AIFX_RESULT__(.*)__END_NOVAFLOW_G5_AIFX_RESULT__/s)
  assert(match, 'G5_RESULT_MISSING')
  return JSON.parse(match[1])
}

function parseFirstFrameResult(stdout) {
  const match = stdout.match(/__NOVAFLOW_G3_FIRST_FRAME_RESULT__(.*)__END_NOVAFLOW_G3_FIRST_FRAME_RESULT__/s)
  assert(match, 'G5_FIRST_FRAME_RESULT_MISSING')
  return JSON.parse(match[1])
}

function runNode(args, code) {
  const run = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  })
  if (run.stderr) process.stderr.write(run.stderr)
  assert(run.status === 0, code, { status: run.status, stdout: run.stdout, stderr: run.stderr, args })
  return run.stdout || ''
}

function runG5App(sessionId, renderer) {
  const exportRoot = path.join(prototypeRoot, 'exports', sessionId)
  mkdirSync(exportRoot, { recursive: true })
  const run = spawnSync(electronCmd, [g5App], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      NOVAFLOW_G5_AIFX_HARNESS: '1',
      NOVAFLOW_TOOLS_SMOKE: '1',
      NOVAFLOW_DISABLE_LEGACY_WRITE: '1',
      NOVAFLOW_SMOKE_REPO_ROOT: repoRoot,
      NOVAFLOW_G5_AIFX_TEMP_ROOT: prototypeRoot,
      NOVAFLOW_G5_AIFX_PROFILE: path.join(prototypeRoot, 'smoke-profile', sessionId),
      NOVAFLOW_G5_AIFX_EXPORT_ROOT: exportRoot,
      NOVAFLOW_G5_AIFX_RENDERER_ENTRY: renderer,
      NOVAFLOW_G5_AIFX_SESSION: sessionId,
      NOVAFLOW_PACKAGED_APP_ROOT: packagedAppRoot
    }
  })
  if (run.stderr) process.stderr.write(run.stderr)
  assert(run.status === 0, 'G5_APP_FAILED', { status: run.status, stdout: run.stdout, stderr: run.stderr })
  return parseG5Result(run.stdout || '')
}

function runFirstFrame(renderer, sessionId) {
  const stdout = runNode([
    path.join('tools', 'smoke', 'first-frame-harness-runner.mjs'),
    '--session',
    sessionId,
    '--renderer',
    renderer,
    '--temp-root',
    path.join(prototypeRoot, 'first-frame-trace'),
    '--timeout-ms',
    '90000'
  ], 'G5_FIRST_FRAME_RUNNER_FAILED')
  return parseFirstFrameResult(stdout)
}

function validateParityReceipts(receipts) {
  assert(Array.isArray(receipts) && receipts.length >= 5, 'G5_PARITY_RECEIPTS_MISSING', receipts)
  for (const receipt of receipts) {
    for (const field of requiredParityFields) {
      assert(Object.prototype.hasOwnProperty.call(receipt, field), 'G5_PARITY_RECEIPT_FIELD_MISSING', { field, receipt })
    }
    assert(receipt.routeStable === true, 'G5_ROUTE_NOT_STABLE', receipt)
    assert(receipt.consoleErrorDelta === 0, 'G5_CONSOLE_ERROR_DELTA', receipt)
    assert(receipt.runtimeMutationDetected === false, 'G5_RUNTIME_MUTATION_DETECTED', receipt)
  }
}

function validateG5Run(result, expectedTempRoot) {
  assert(result.ok === true, 'G5_RESULT_NOT_OK', result)
  assert(result.protocol === 'file:', 'G5_NOT_FILE_PROTOCOL', { protocol: result.protocol })
  assert(result.consoleErrorCount === 0, 'G5_CONSOLE_ERRORS', result.consoleErrors)
  assert(result.productionRuntimeStable === true, 'G5_PRODUCTION_RUNTIME_UNSTABLE', result)
  assert(result.runtimeMutationDetected === false, 'G5_RUNTIME_MUTATION_FLAG', result)
  assert(Array.isArray(result.failureCodes), 'G5_FAILURE_CODES_MISSING', result.failureCodes)
  for (const code of ['COMFY_UNAVAILABLE', 'COMFY_TIMEOUT', 'COMFY_DEPENDENCY_FAILED']) {
    assert(result.failureCodes.includes(code), 'G5_REQUIRED_FAILURE_CODE_MISSING', { code, failureCodes: result.failureCodes })
  }
  assert(typeof result.deterministicResultHash === 'string' && result.deterministicResultHash.length === 64, 'G5_RESULT_HASH_INVALID', result.deterministicResultHash)
  assert(result.aifxResult && result.aifxResult.exportReceipt && result.aifxResult.exportReceipt.ok === true, 'G5_EXPORT_RECEIPT_INVALID', result.aifxResult)
  assert(result.aifxResult.exportReceipt.hashBefore === result.aifxResult.exportReceipt.hashAfter, 'G5_EXPORT_HASH_MISMATCH', result.aifxResult.exportReceipt)
  assert(result.aifxResult.exportReceipt.tmpLeftoverCount === 0, 'G5_TMP_LEFTOVERS', result.aifxResult.exportReceipt)
  const exportPath = path.join(repoRoot, result.aifxResult.exportReceipt.tempPath)
  assert(existsSync(exportPath), 'G5_EXPORT_FILE_MISSING', result.aifxResult.exportReceipt)
  assert(isInside(expectedTempRoot, exportPath), 'G5_EXPORT_OUTSIDE_TEMP_ROOT', { expectedTempRoot, exportPath })
  assert(result.smokeTelemetry.realWriteCount === 1, 'G5_REAL_WRITE_COUNT_INVALID', result.smokeTelemetry)
  assert(result.aifxResult.routeStabilityReceipt && result.aifxResult.routeStabilityReceipt.routeStable === true, 'G5_ROUTE_STABILITY_RECEIPT_INVALID', result.aifxResult.routeStabilityReceipt)
  validateParityReceipts(result.parityReceipts)
}

function validateFirstFrameIntegration(result) {
  assert(result.ok === true, 'G5_FIRST_FRAME_NOT_OK', result)
  assert(result.protocol === 'file:', 'G5_FIRST_FRAME_NOT_FILE', result)
  assert(result.consoleErrorCount === 0, 'G5_FIRST_FRAME_CONSOLE_ERRORS', result.consoleErrors)
  assert(Array.isArray(result.measurementReceipts) && result.measurementReceipts.length >= 8, 'G5_FIRST_FRAME_RECEIPTS_MISSING', result.measurementReceipts)
  assert(result.trace && Array.isArray(result.trace.samples) && result.trace.samples.length >= 12, 'G5_FIRST_FRAME_TRACE_MISSING', result.trace)
}

try {
  for (const [name, file] of Object.entries({ electronCmd, g5App, productionRendererEntry })) {
    assert(existsSync(file), 'G5_REQUIRED_FILE_MISSING', { name, file })
  }

  const sessionBase = `g5-aifx-isolated-${Date.now()}`
  mkdirSync(prototypeRoot, { recursive: true })
  const isolatedRenderer = createAifxPrototype(sessionBase)
  const productionBefore = hashRuntimeChain(productionRendererEntry)

  const firstRun = runG5App(`${sessionBase}-run-1`, isolatedRenderer)
  const secondRun = runG5App(`${sessionBase}-run-2`, isolatedRenderer)
  validateG5Run(firstRun, prototypeRoot)
  validateG5Run(secondRun, prototypeRoot)
  assert(firstRun.deterministicResultHash === secondRun.deterministicResultHash, 'G5_DETERMINISTIC_HASH_CHANGED', {
    first: firstRun.deterministicResultHash,
    second: secondRun.deterministicResultHash
  })
  assert(firstRun.aifxResult.exportReceipt.deterministicOutputHash === secondRun.aifxResult.exportReceipt.deterministicOutputHash, 'G5_EXPORT_HASH_CHANGED', {
    first: firstRun.aifxResult.exportReceipt.deterministicOutputHash,
    second: secondRun.aifxResult.exportReceipt.deterministicOutputHash
  })

  const smokeVerifier = parseJsonOutput(runNode([path.join('tools', 'smoke', 'verify-tools-smoke-contract.mjs')], 'G5_SMOKE_VERIFIER_FAILED'))
  assert(smokeVerifier.ok === true, 'G5_SMOKE_VERIFIER_NOT_OK', smokeVerifier)

  const protectedHarness = parseJsonOutput(runNode([path.join('tools', 'smoke', 'g2-protected-island-harness-check.mjs')], 'G5_PROTECTED_HARNESS_FAILED'))
  assert(protectedHarness.ok === true, 'G5_PROTECTED_HARNESS_NOT_OK', protectedHarness)

  const firstFrameIntegration = runFirstFrame(isolatedRenderer, `${sessionBase}-first-frame`)
  validateFirstFrameIntegration(firstFrameIntegration)

  const productionAfter = hashRuntimeChain(productionRendererEntry)
  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfter), 'G5_PRODUCTION_RUNTIME_CHAIN_CHANGED', {
    before: productionBefore,
    after: productionAfter
  })

  console.log(JSON.stringify({
    ok: true,
    code: 'G5_AIFX_ISOLATED_SOURCE_OK',
    sessionId: sessionBase,
    isolatedRenderer: path.relative(repoRoot, isolatedRenderer).replace(/\\/g, '/'),
    productionRuntimeStable: true,
    productionRuntimeFileCount: productionBefore.length,
    repeatableRuns: 2,
    deterministicResultHash: firstRun.deterministicResultHash,
    deterministicExportHash: firstRun.aifxResult.exportReceipt.deterministicOutputHash,
    firstRun: {
      consoleErrorCount: firstRun.consoleErrorCount,
      routeStable: firstRun.aifxResult.routeStabilityReceipt.routeStable,
      failureCodes: firstRun.failureCodes,
      realWriteCount: firstRun.smokeTelemetry.realWriteCount,
      exportPath: firstRun.aifxResult.exportReceipt.tempPath
    },
    secondRun: {
      consoleErrorCount: secondRun.consoleErrorCount,
      routeStable: secondRun.aifxResult.routeStabilityReceipt.routeStable,
      failureCodes: secondRun.failureCodes,
      realWriteCount: secondRun.smokeTelemetry.realWriteCount,
      exportPath: secondRun.aifxResult.exportReceipt.tempPath
    },
    integration: {
      smokeVerifierOk: smokeVerifier.ok === true,
      protectedHarnessOk: protectedHarness.ok === true,
      firstFrameOk: firstFrameIntegration.ok === true,
      firstFrameReceiptCount: firstFrameIntegration.measurementReceipts.length,
      firstFrameConsoleErrorCount: firstFrameIntegration.consoleErrorCount
    },
    parityReceipts: firstRun.parityReceipts
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G5_AIFX_ISOLATED_SOURCE_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
