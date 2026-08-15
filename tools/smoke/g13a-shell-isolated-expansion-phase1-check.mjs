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
const prototypeRoot = path.join(repoRoot, 'debug-output', 'shell-isolated-expansion-phase1-2026-05-17')

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

function createExpansionPrototype(sessionId) {
  const sessionDir = path.join(prototypeRoot, 'prototype', sessionId)
  mkdirSync(sessionDir, { recursive: true })
  const htmlPath = path.join(sessionDir, 'index.html')
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NovaFlow G13A Shell Isolated Expansion</title>
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
    html, body, #root {
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
    .nf-primary-entry[aria-pressed="true"] {
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
    .nf-secondary-entry[aria-pressed="true"] {
      background: #24384a;
      color: var(--nf-text);
      border-color: #3d5a72;
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
<body class="nf-source-shell-owned nf-body-owned nf-shell-ready nf-route-stable" data-current-route="effects" data-novaflow-isolated-shell="1" data-ownership-body-class="source">
  <div id="root">
    <main class="nf-shell" data-novaflow-source-shell="1" data-ownership-shell-state="source">
      <nav class="nf-primary-rail" data-novaflow-primary-rail="1" aria-label="NovaFlow primary rail">
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="effects" aria-pressed="true" data-route="effects">effects</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="animation" aria-pressed="false" data-route="animation">animation</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="art" aria-pressed="false" data-route="art">art</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="tools" aria-pressed="false" data-route="tools">tools</button>
      </nav>
      <section class="nf-left-shell" data-novaflow-left-content-shell="1">
        <div class="nf-secondary-stack" data-novaflow-route-shell="1">
          <div class="nf-secondary-tabs" data-novaflow-secondary-tabs="1">
            <button class="nf-secondary-entry" data-novaflow-secondary-entry="1" aria-pressed="true">particle</button>
            <button class="nf-secondary-entry" data-novaflow-secondary-entry="1" aria-pressed="false">aifx</button>
          </div>
          <section class="nf-panel" data-novaflow-panel="1" data-ownership-panel-containment="source">
            <div class="nf-panel-body">
              <div class="nf-chip">source-owned panel containment</div>
              <p>G13A expands isolated shell ownership without production migration.</p>
              <p data-shell-state-summary>route=effects; panel=contained; body=source-owned</p>
            </div>
          </section>
        </div>
      </section>
      <section class="nf-route-container" data-novaflow-route-container="1" data-ownership-route-container="source" data-route-container-state="effects">
        <div class="nf-workspace" data-novaflow-workspace="1">
          <header class="nf-workspace-header">
            <strong data-route-title>effects workspace</strong>
            <span class="nf-chip" data-route-state>effects</span>
          </header>
          <div class="nf-canvas" data-route-canvas>source-owned isolated route container</div>
          <footer class="nf-workspace-footer">
            <span>body class owned by source</span>
            <span>shell state owned by source</span>
          </footer>
        </div>
      </section>
    </main>
  </div>
  <script>
    (() => {
      const routeMap = {
        effects: { title: "effects workspace", secondary: ["particle", "aifx"] },
        animation: { title: "animation workspace", secondary: ["ai sequence", "spine"] },
        art: { title: "art workspace", secondary: ["ui", "split"] },
        tools: { title: "tools workspace", secondary: ["workspace", "export"] }
      };
      const title = document.querySelector("[data-route-title]");
      const state = document.querySelector("[data-route-state]");
      const summary = document.querySelector("[data-shell-state-summary]");
      const container = document.querySelector("[data-novaflow-route-container]");
      const secondary = Array.from(document.querySelectorAll("[data-novaflow-secondary-entry]"));
      const entries = Array.from(document.querySelectorAll("[data-novaflow-primary-entry]"));
      const shellState = {
        bodyClassOwner: "source",
        routeContainerOwner: "source",
        panelContainmentOwner: "source",
        shellStateOwner: "source",
        currentRoute: "effects"
      };
      function setRoute(route) {
        const spec = routeMap[route] || routeMap.effects;
        shellState.currentRoute = route;
        document.body.dataset.currentRoute = route;
        if (container) container.dataset.routeContainerState = route;
        if (title) title.textContent = spec.title;
        if (state) state.textContent = route;
        if (summary) summary.textContent = "route=" + route + "; panel=contained; body=source-owned";
        entries.forEach((entry) => entry.setAttribute("aria-pressed", entry.dataset.route === route ? "true" : "false"));
        secondary.forEach((entry, index) => {
          entry.textContent = spec.secondary[index] || spec.secondary[0];
          entry.setAttribute("aria-pressed", index === 0 ? "true" : "false");
        });
        window.__NOVAFLOW_G13A_SHELL_STATE__ = { ...shellState };
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

function parseFirstFrameResult(stdout) {
  const match = String(stdout || '').match(/__NOVAFLOW_G3_FIRST_FRAME_RESULT__(.*)__END_NOVAFLOW_G3_FIRST_FRAME_RESULT__/s)
  assert(match, 'G13A_FIRST_FRAME_RESULT_MISSING')
  return JSON.parse(match[1])
}

function runFirstFrame(renderer, sessionId) {
  const run = spawnSync(process.execPath, [
    path.join('tools', 'smoke', 'first-frame-harness-runner.mjs'),
    '--session',
    sessionId,
    '--renderer',
    renderer,
    '--temp-root',
    path.join(prototypeRoot, 'first-frame-trace'),
    '--timeout-ms',
    '90000'
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  })
  if (run.stderr) process.stderr.write(run.stderr)
  assert(run.status === 0, 'G13A_FIRST_FRAME_RUNNER_FAILED', {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    renderer
  })
  const result = parseFirstFrameResult(run.stdout || '')
  assert(result.ok === true, 'G13A_FIRST_FRAME_NOT_OK', result)
  assert(result.protocol === 'file:', 'G13A_NOT_FILE_PROTOCOL', { protocol: result.protocol })
  assert(result.consoleErrorCount === 0, 'G13A_CONSOLE_ERRORS', result.consoleErrors)
  assert(result.runtimeChainStable === true, 'G13A_RUNTIME_CHAIN_UNSTABLE', result)
  assert(Array.isArray(result.measurementReceipts) && result.measurementReceipts.length >= 8, 'G13A_RECEIPTS_MISSING', result.measurementReceipts)
  return result
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

function overflowDetected(result) {
  return receipts(result).some((receipt) => {
    const state = receipt.overflowState || {}
    return state.horizontalOverflow || state.panelOverflow
  })
}

function lastReceiptForTrace(result, traceType) {
  const scoped = receipts(result).filter((receipt) => receipt.traceType === traceType)
  return scoped[scoped.length - 1] || null
}

function routeIndexFor(result, traceType) {
  const receipt = lastReceiptForTrace(result, traceType)
  return receipt && receipt.routeState ? receipt.routeState.activePrimaryIndex : null
}

function routeTextFor(result, traceType) {
  const receipt = lastReceiptForTrace(result, traceType)
  return receipt && receipt.routeState ? String(receipt.routeState.routeText || '') : ''
}

function routeStable(result) {
  return routeIndexFor(result, 'cold-start') !== null &&
    routeIndexFor(result, 'animation-route-trace') === 1 &&
    routeIndexFor(result, 'tools-route-trace') === 3
}

function bodyClassStable(result) {
  const entries = samples(result)
  const nonEmpty = entries.filter((sample) => String(sample.bodyClasses || '').trim())
  if (!nonEmpty.length) return false
  const first = nonEmpty[0].bodyClasses
  return nonEmpty.every((sample) => sample.bodyClasses === first)
}

function routeTracePresent(result, traceType) {
  return receipts(result).some((receipt) => receipt.traceType === traceType)
}

function replayValidation(result) {
  return {
    coldStart: routeTracePresent(result, 'cold-start'),
    routeSwitch: routeTracePresent(result, 'route-switch-trace'),
    animationOpen: routeTracePresent(result, 'animation-route-trace') && routeIndexFor(result, 'animation-route-trace') === 1,
    toolsOpen: routeTracePresent(result, 'tools-route-trace') && routeIndexFor(result, 'tools-route-trace') === 3
  }
}

function ownershipReceipt({ ownershipArea, parityStatus, regressionDetected, layoutShiftDelta, routeStable, consoleErrorDelta, details = {} }) {
  return {
    ownershipArea,
    parityStatus,
    regressionDetected,
    layoutShiftDelta,
    routeStable,
    consoleErrorDelta,
    details
  }
}

function createOwnershipReceipts(baseline, isolated) {
  const layoutShiftDelta = layoutShiftCount(isolated) - layoutShiftCount(baseline)
  const consoleErrorDelta = Number(isolated.consoleErrorCount || 0) - Number(baseline.consoleErrorCount || 0)
  const stableRoute = routeStable(isolated)
  const noOverflow = !overflowDetected(isolated)
  const bodyStable = bodyClassStable(isolated)
  const animationOk = routeIndexFor(isolated, 'animation-route-trace') === 1
  const toolsOk = routeIndexFor(isolated, 'tools-route-trace') === 3

  return [
    ownershipReceipt({
      ownershipArea: 'isolated-route-container-ownership',
      parityStatus: animationOk && toolsOk ? 'PASS' : 'PARTIAL',
      regressionDetected: !(animationOk && toolsOk),
      layoutShiftDelta,
      routeStable: stableRoute,
      consoleErrorDelta,
      details: {
        animationRouteIndex: routeIndexFor(isolated, 'animation-route-trace'),
        toolsRouteIndex: routeIndexFor(isolated, 'tools-route-trace'),
        animationRouteTextSample: routeTextFor(isolated, 'animation-route-trace').slice(0, 120),
        toolsRouteTextSample: routeTextFor(isolated, 'tools-route-trace').slice(0, 120)
      }
    }),
    ownershipReceipt({
      ownershipArea: 'isolated-panel-containment-ownership',
      parityStatus: noOverflow ? 'PASS' : 'FAIL',
      regressionDetected: !noOverflow,
      layoutShiftDelta,
      routeStable: stableRoute,
      consoleErrorDelta,
      details: {
        overflowDetected: overflowDetected(isolated),
        baselineOverflowDetected: overflowDetected(baseline)
      }
    }),
    ownershipReceipt({
      ownershipArea: 'isolated-body-class-ownership',
      parityStatus: bodyStable ? 'PASS' : 'PARTIAL',
      regressionDetected: !bodyStable,
      layoutShiftDelta,
      routeStable: stableRoute,
      consoleErrorDelta,
      details: {
        bodyClassStable: bodyStable,
        firstNonEmptyBodyClass: (samples(isolated).find((sample) => String(sample.bodyClasses || '').trim()) || {}).bodyClasses || ''
      }
    }),
    ownershipReceipt({
      ownershipArea: 'isolated-shell-state-ownership',
      parityStatus: stableRoute && noOverflow ? 'PASS' : 'PARTIAL',
      regressionDetected: !(stableRoute && noOverflow),
      layoutShiftDelta,
      routeStable: stableRoute,
      consoleErrorDelta,
      details: {
        replayValidation: replayValidation(isolated),
        layoutShiftCount: layoutShiftCount(isolated),
        baselineLayoutShiftCount: layoutShiftCount(baseline)
      }
    })
  ]
}

function validateOwnershipReceipts(entries) {
  assert(Array.isArray(entries) && entries.length === 4, 'G13A_OWNERSHIP_RECEIPT_COUNT_INVALID', entries)
  for (const entry of entries) {
    for (const field of ['ownershipArea', 'parityStatus', 'regressionDetected', 'layoutShiftDelta', 'routeStable', 'consoleErrorDelta']) {
      assert(Object.prototype.hasOwnProperty.call(entry, field), 'G13A_OWNERSHIP_RECEIPT_FIELD_MISSING', { field, entry })
    }
    assert(['PASS', 'PARTIAL', 'FAIL'].includes(entry.parityStatus), 'G13A_PARITY_STATUS_INVALID', entry)
    assert(typeof entry.regressionDetected === 'boolean', 'G13A_REGRESSION_FLAG_INVALID', entry)
    assert(typeof entry.layoutShiftDelta === 'number', 'G13A_LAYOUT_SHIFT_DELTA_INVALID', entry)
    assert(typeof entry.routeStable === 'boolean', 'G13A_ROUTE_STABLE_INVALID', entry)
    assert(typeof entry.consoleErrorDelta === 'number', 'G13A_CONSOLE_ERROR_DELTA_INVALID', entry)
  }
}

try {
  mkdirSync(prototypeRoot, { recursive: true })
  const sessionBase = `g13a-shell-expansion-${Date.now()}`
  const isolatedRenderer = createExpansionPrototype(sessionBase)
  const productionBefore = hashRuntimeChain(productionRendererEntry)
  const baseline = runFirstFrame(productionRendererEntry, `${sessionBase}-baseline`)
  const isolatedOne = runFirstFrame(isolatedRenderer, `${sessionBase}-isolated-1`)
  const isolatedTwo = runFirstFrame(isolatedRenderer, `${sessionBase}-isolated-2`)
  const productionAfter = hashRuntimeChain(productionRendererEntry)

  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfter), 'G13A_PRODUCTION_RUNTIME_CHAIN_CHANGED', {
    before: productionBefore,
    after: productionAfter
  })

  const isolatedRepeatComparison = compareFirstFrameTraces(isolatedOne, isolatedTwo)
  assert(isolatedRepeatComparison.comparable === true, 'G13A_ISOLATED_REPEAT_NOT_COMPARABLE', isolatedRepeatComparison)
  assert(isolatedRepeatComparison.missingTraceTypes.length === 0, 'G13A_ISOLATED_REPEAT_TRACE_MISSING', isolatedRepeatComparison)
  assert(isolatedRepeatComparison.extraTraceTypes.length === 0, 'G13A_ISOLATED_REPEAT_TRACE_EXTRA', isolatedRepeatComparison)

  const ownershipReceipts = createOwnershipReceipts(baseline, isolatedOne)
  validateOwnershipReceipts(ownershipReceipts)
  assert(ownershipReceipts.every((entry) => entry.consoleErrorDelta <= 0), 'G13A_CONSOLE_ERROR_DELTA_INCREASED', ownershipReceipts)
  assert(ownershipReceipts.some((entry) => entry.parityStatus === 'PASS'), 'G13A_NO_PASSING_OWNERSHIP_AREA', ownershipReceipts)
  assert(routeStable(isolatedOne), 'G13A_ROUTE_STABILITY_FAILED', {
    replayValidation: replayValidation(isolatedOne),
    ownershipReceipts
  })
  assert(!overflowDetected(isolatedOne), 'G13A_PANEL_OVERFLOW_REGRESSION', ownershipReceipts)

  const output = {
    ok: true,
    code: 'G13A_SHELL_ISOLATED_EXPANSION_PHASE1_OK',
    sessionId: sessionBase,
    isolatedRenderer: path.relative(repoRoot, isolatedRenderer).replace(/\\/g, '/'),
    productionRuntimeStable: true,
    productionRuntimeFileCount: productionBefore.length,
    guardedIsolationBoundary: {
      productionRuntimeMutation: false,
      rendererDistMutation: false,
      shellCutover: false,
      runtimeReplacement: false,
      railFixPerformed: false
    },
    isolatedReplayValidation: {
      firstRun: replayValidation(isolatedOne),
      secondRun: replayValidation(isolatedTwo),
      repeatComparable: isolatedRepeatComparison.comparable,
      missingTraceTypes: isolatedRepeatComparison.missingTraceTypes,
      extraTraceTypes: isolatedRepeatComparison.extraTraceTypes
    },
    baselineSummary: {
      sessionId: baseline.sessionId,
      layoutShiftCount: layoutShiftCount(baseline),
      overflowDetected: overflowDetected(baseline),
      consoleErrorCount: baseline.consoleErrorCount
    },
    isolatedSummary: {
      sessionId: isolatedOne.sessionId,
      repeatSessionId: isolatedTwo.sessionId,
      layoutShiftCount: layoutShiftCount(isolatedOne),
      repeatLayoutShiftCount: layoutShiftCount(isolatedTwo),
      overflowDetected: overflowDetected(isolatedOne),
      bodyClassStable: bodyClassStable(isolatedOne),
      routeStable: routeStable(isolatedOne),
      consoleErrorCount: isolatedOne.consoleErrorCount
    },
    ownershipReceipts
  }

  console.log(JSON.stringify(output, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G13A_SHELL_ISOLATED_EXPANSION_PHASE1_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
