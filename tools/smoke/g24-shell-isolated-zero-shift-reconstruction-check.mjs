import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareFirstFrameTraces } from './first-frame-trace-compare.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const productionRendererEntry = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html')
const prototypeRoot = path.join(repoRoot, 'debug-output', 'shell-isolated-zero-shift-reconstruction-2026-05-17')

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

function createZeroShiftPrototype(sessionId) {
  const sessionDir = path.join(prototypeRoot, 'prototype', sessionId)
  mkdirSync(sessionDir, { recursive: true })
  const htmlPath = path.join(sessionDir, 'index.html')
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NovaFlow G24 Zero Shift Shell</title>
  <style>
    :root {
      --nf-primary-rail-width: 100px;
      --nf-secondary-width: 312px;
      --nf-gap: 11px;
      --nf-bg: #101820;
      --nf-rail: #121a23;
      --nf-panel: #17212b;
      --nf-panel-border: #273442;
      --nf-text: #eef5fb;
      --nf-muted: #9eb2c4;
    }
    * { box-sizing: border-box; }
    html,
    body,
    #root {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: var(--nf-bg);
    }
    body {
      color: var(--nf-text);
      font: 13px/1.4 "Segoe UI", Arial, sans-serif;
    }
    .nf-shell {
      display: grid;
      grid-template-columns: var(--nf-primary-rail-width) var(--nf-secondary-width) minmax(0, 1fr);
      gap: var(--nf-gap);
      width: 100%;
      height: 100%;
      min-width: 0;
      overflow: hidden;
      background: var(--nf-bg);
    }
    .nf-primary-rail {
      width: var(--nf-primary-rail-width);
      min-width: var(--nf-primary-rail-width);
      max-width: var(--nf-primary-rail-width);
      height: 100%;
      padding: 12px 8px;
      background: var(--nf-rail);
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow: hidden;
      flex: 0 0 var(--nf-primary-rail-width);
    }
    .nf-primary-entry {
      width: 100%;
      min-height: 40px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: var(--nf-muted);
      cursor: default;
      font: inherit;
    }
    .nf-primary-entry[data-current="true"] {
      color: var(--nf-text);
      background: #203040;
      border-color: #33485a;
    }
    .nf-left-shell {
      min-width: 0;
      height: 100%;
      padding: 12px 0;
      overflow: hidden;
      background: transparent;
    }
    .nf-secondary-stack {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow: hidden;
    }
    .nf-secondary-tabs {
      display: flex;
      gap: 8px;
      height: 34px;
      flex: 0 0 34px;
    }
    .nf-secondary-entry {
      flex: 1 1 0;
      min-width: 0;
      border: 1px solid var(--nf-panel-border);
      border-radius: 6px;
      background: #182532;
      color: var(--nf-muted);
      font: inherit;
    }
    .nf-panel {
      min-width: 0;
      width: 100%;
      max-width: 100%;
      flex: 1 1 auto;
      overflow: hidden;
      border: 1px solid var(--nf-panel-border);
      border-radius: 8px;
      background: var(--nf-panel);
    }
    .nf-panel-body {
      min-width: 0;
      max-width: 100%;
      width: 100%;
      height: 100%;
      padding: 12px;
      overflow: auto;
    }
    .nf-route-container {
      min-width: 0;
      height: 100%;
      padding: 12px 14px 12px 0;
      overflow: hidden;
      background: transparent;
    }
    .nf-workspace {
      width: 100%;
      height: 100%;
      min-width: 0;
      overflow: hidden;
      border: 1px solid #263342;
      border-radius: 8px;
      background: #0c1218;
      display: grid;
      grid-template-rows: 44px minmax(0, 1fr) 56px;
    }
    .nf-workspace-header,
    .nf-workspace-footer {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 14px;
      background: #121c26;
      border-bottom: 1px solid #263342;
    }
    .nf-workspace-footer {
      border-top: 1px solid #263342;
      border-bottom: 0;
      color: var(--nf-muted);
    }
    .nf-canvas {
      min-width: 0;
      overflow: hidden;
      display: grid;
      place-items: center;
      color: var(--nf-muted);
    }
    .nf-chip {
      border: 1px solid #2d4051;
      border-radius: 6px;
      padding: 4px 8px;
      background: #172333;
      color: var(--nf-muted);
    }
  </style>
</head>
<body class="nf-g24-zero-shift-shell nf-shell-ready nf-route-stable" data-current-route="effects" data-novaflow-isolated-shell="1">
  <div id="root">
    <main class="nf-shell" data-novaflow-source-shell="1">
      <nav class="nf-primary-rail" data-novaflow-primary-rail="1" aria-label="NovaFlow primary rail">
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="effects" aria-pressed="false" data-current="true" data-route="effects">effects</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="animation" aria-pressed="false" data-current="false" data-route="animation">animation</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="art" aria-pressed="false" data-current="false" data-route="art">art</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="tools" aria-pressed="false" data-current="false" data-route="tools">tools</button>
      </nav>
      <section class="nf-left-shell" data-novaflow-left-content-shell="1">
        <div class="nf-secondary-stack" data-novaflow-route-shell="1">
          <div class="nf-secondary-tabs" data-novaflow-secondary-tabs="1">
            <button class="nf-secondary-entry" data-novaflow-secondary-entry="1" aria-pressed="false">particle</button>
            <button class="nf-secondary-entry" data-novaflow-secondary-entry="1" aria-pressed="false">aifx</button>
          </div>
          <section class="nf-panel" data-novaflow-panel="1">
            <div class="nf-panel-body">
              <div class="nf-chip">G24 zero-shift source shell</div>
              <p data-shell-state-summary>effects workspace; shell=source-owned; zero-shift seed active</p>
              <p>No production runtime mutation.</p>
            </div>
          </section>
        </div>
      </section>
      <section class="nf-route-container" data-novaflow-route-container="1">
        <div class="nf-workspace" data-novaflow-workspace="1">
          <header class="nf-workspace-header">
            <strong data-route-title>effects workspace</strong>
            <span class="nf-chip" data-route-state>effects</span>
          </header>
          <div class="nf-canvas" data-route-canvas>effects source-owned isolated route container</div>
          <footer class="nf-workspace-footer">
            <span>rail width seeded before body parse</span>
            <span>route text changes without shell metric shifts</span>
          </footer>
        </div>
      </section>
    </main>
  </div>
  <script>
    (() => {
      const routeMap = {
        effects: { title: "effects workspace", secondary: ["particle", "aifx"], canvas: "effects source-owned isolated route container" },
        animation: { title: "animation workspace", secondary: ["ai sequence", "spine"], canvas: "animation source-owned isolated route container" },
        art: { title: "art workspace", secondary: ["ui", "split"], canvas: "art source-owned isolated route container" },
        tools: { title: "tools workspace", secondary: ["workspace", "export"], canvas: "tools source-owned isolated route container" }
      };
      const title = document.querySelector("[data-route-title]");
      const state = document.querySelector("[data-route-state]");
      const canvas = document.querySelector("[data-route-canvas]");
      const summary = document.querySelector("[data-shell-state-summary]");
      const secondary = Array.from(document.querySelectorAll("[data-novaflow-secondary-entry]"));
      const entries = Array.from(document.querySelectorAll("[data-novaflow-primary-entry]"));
      function setRoute(route) {
        const spec = routeMap[route] || routeMap.effects;
        document.body.dataset.currentRoute = route;
        if (title) title.textContent = spec.title;
        if (state) state.textContent = route;
        if (canvas) canvas.textContent = spec.canvas;
        if (summary) summary.textContent = route + " workspace; shell=source-owned; zero-shift seed active";
        entries.forEach((entry) => {
          entry.dataset.current = entry.dataset.route === route ? "true" : "false";
        });
        secondary.forEach((entry, index) => {
          entry.textContent = spec.secondary[index] || spec.secondary[0];
        });
      }
      entries.forEach((entry) => entry.addEventListener("click", () => setRoute(entry.dataset.route)));
      setRoute("effects");
    })();
  </script>
</body>
</html>
`
  writeFileSync(htmlPath, html, 'utf8')
  return htmlPath
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

function parseFirstFrameResult(stdout) {
  const match = String(stdout || '').match(/__NOVAFLOW_G3_FIRST_FRAME_RESULT__(.*)__END_NOVAFLOW_G3_FIRST_FRAME_RESULT__/s)
  assert(match, 'G24_FIRST_FRAME_RESULT_MISSING')
  return JSON.parse(match[1])
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
    '--zero-shift-seed',
    '1',
    '--timeout-ms',
    '90000'
  ], 'G24_FIRST_FRAME_RUNNER_FAILED')
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

function overflowDetected(result) {
  return receipts(result).some((receipt) => {
    const state = receipt.overflowState || {}
    return state.horizontalOverflow || state.panelOverflow
  })
}

function traceText(result, traceType) {
  const scoped = receipts(result).filter((receipt) => receipt.traceType === traceType)
  const last = scoped[scoped.length - 1] || null
  return last && last.routeState ? String(last.routeState.routeText || '') : ''
}

function routeStable(result) {
  return /effects/i.test(traceText(result, 'cold-start')) &&
    /animation/i.test(traceText(result, 'animation-route-trace')) &&
    /tools/i.test(traceText(result, 'tools-route-trace'))
}

function railWidthRange(result) {
  const widths = samples(result).map((sample) => Number(sample.railWidth || 0))
  return {
    min: Math.min(...widths),
    max: Math.max(...widths),
    values: [...new Set(widths)].sort((a, b) => a - b)
  }
}

function consoleErrorDelta(result, baseline = 0) {
  return Number(result.consoleErrorCount || 0) - baseline
}

function zeroShiftReceipt(result, repeatResult = null) {
  const receipt = {
    target: 'g24-zero-shift-isolated-shell',
    layoutShiftCount: layoutShiftCount(result),
    railShiftCount: railShiftCount(result),
    stableFrameTime: stableFrameTime(result),
    routeStable: routeStable(result),
    overflowDetected: overflowDetected(result),
    consoleErrorDelta: consoleErrorDelta(result),
    repeatedRunStable: null,
    railWidthRange: railWidthRange(result),
    zeroShift: false
  }
  receipt.zeroShift = receipt.layoutShiftCount === 0 &&
    receipt.railShiftCount === 0 &&
    receipt.routeStable === true &&
    receipt.overflowDetected === false &&
    receipt.consoleErrorDelta === 0
  if (repeatResult) {
    const repeat = zeroShiftReceipt(repeatResult)
    receipt.repeatedRunStable = repeat.zeroShift &&
      repeat.layoutShiftCount === receipt.layoutShiftCount &&
      repeat.railShiftCount === receipt.railShiftCount &&
      repeat.routeStable === receipt.routeStable &&
      repeat.overflowDetected === receipt.overflowDetected
  }
  return receipt
}

function validateRun(result, codePrefix) {
  assert(result.ok === true, `${codePrefix}_NOT_OK`, result)
  assert(result.protocol === 'file:', `${codePrefix}_NOT_FILE_PROTOCOL`, result)
  assert(result.consoleErrorCount === 0, `${codePrefix}_CONSOLE_ERRORS`, result.consoleErrors)
  assert(result.runtimeChainStable === true, `${codePrefix}_RUNTIME_CHAIN_UNSTABLE`, result)
  assert(receipts(result).length >= 8, `${codePrefix}_RECEIPTS_MISSING`, result)
  assert(samples(result).length >= 12, `${codePrefix}_SAMPLES_MISSING`, result)
}

try {
  mkdirSync(prototypeRoot, { recursive: true })
  const sessionBase = `g24-zero-shift-${Date.now()}`
  const isolatedRenderer = createZeroShiftPrototype(sessionBase)
  const productionBefore = hashRuntimeChain(productionRendererEntry)
  const isolatedOne = runFirstFrame(isolatedRenderer, `${sessionBase}-isolated-1`)
  const isolatedTwo = runFirstFrame(isolatedRenderer, `${sessionBase}-isolated-2`)
  const productionAfter = hashRuntimeChain(productionRendererEntry)

  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfter), 'G24_PRODUCTION_RUNTIME_CHAIN_CHANGED', {
    before: productionBefore,
    after: productionAfter
  })
  validateRun(isolatedOne, 'G24_ISOLATED_ONE')
  validateRun(isolatedTwo, 'G24_ISOLATED_TWO')

  const repeatComparison = compareFirstFrameTraces(isolatedOne, isolatedTwo)
  assert(repeatComparison.comparable === true, 'G24_REPEAT_NOT_COMPARABLE', repeatComparison)
  assert(repeatComparison.missingTraceTypes.length === 0, 'G24_REPEAT_TRACE_MISSING', repeatComparison)
  assert(repeatComparison.extraTraceTypes.length === 0, 'G24_REPEAT_TRACE_EXTRA', repeatComparison)

  const receipt = zeroShiftReceipt(isolatedOne, isolatedTwo)
  assert(receipt.layoutShiftCount === 0, 'G24_LAYOUT_SHIFT_NOT_ZERO', receipt)
  assert(receipt.railShiftCount === 0, 'G24_RAIL_SHIFT_NOT_ZERO', receipt)
  assert(receipt.repeatedRunStable === true, 'G24_REPEAT_NOT_STABLE', receipt)
  assert(receipt.routeStable === true, 'G24_ROUTE_NOT_STABLE', receipt)
  assert(receipt.overflowDetected === false, 'G24_OVERFLOW_DETECTED', receipt)
  assert(receipt.consoleErrorDelta === 0, 'G24_CONSOLE_ERROR_DELTA', receipt)
  assert(receipt.zeroShift === true, 'G24_ZERO_SHIFT_RECEIPT_FALSE', receipt)

  console.log(JSON.stringify({
    ok: true,
    code: 'G24_SHELL_ISOLATED_ZERO_SHIFT_RECONSTRUCTION_OK',
    sessionId: sessionBase,
    isolatedRenderer: path.relative(repoRoot, isolatedRenderer).replace(/\\/g, '/'),
    productionRuntimeStable: true,
    productionRuntimeFileCount: productionBefore.length,
    guardedIsolationBoundary: {
      productionRuntimeMutation: false,
      productionIndexMutation: false,
      rendererDistMutation: false,
      runtimeJsMutation: false,
      shellCutover: false,
      productionMigration: false
    },
    zeroShiftReceipt: receipt,
    repeatComparison,
    routeEvidence: {
      coldStartText: traceText(isolatedOne, 'cold-start').slice(0, 180),
      animationText: traceText(isolatedOne, 'animation-route-trace').slice(0, 180),
      toolsText: traceText(isolatedOne, 'tools-route-trace').slice(0, 180)
    }
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G24_SHELL_ISOLATED_ZERO_SHIFT_RECONSTRUCTION_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
