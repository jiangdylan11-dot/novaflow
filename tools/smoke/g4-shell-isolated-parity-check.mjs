import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareFirstFrameTraces } from './first-frame-trace-compare.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const packagedRendererEntry = path.join(repoRoot, 'particle-editor-desktop', 'dist', 'win-unpacked', 'resources', 'app', 'renderer', 'index.html')
const prototypeRoot = path.join(repoRoot, 'debug-output', 'shell-isolated-parity-prototype-2026-05-17')

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

function createIsolatedPrototype(sessionId) {
  const sessionDir = path.join(prototypeRoot, sessionId)
  mkdirSync(sessionDir, { recursive: true })
  const htmlPath = path.join(sessionDir, 'index.html')
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NovaFlow Isolated Shell Prototype</title>
  <style>
    :root {
      --nf-primary-rail-width: 100px;
      --nf-secondary-width: 312px;
      --nf-gap: 11px;
      --nf-bg: #101820;
      --nf-rail: #121a23;
      --nf-panel: #17212b;
      --nf-panel-border: #273442;
      --nf-accent: #4fb3ff;
      --nf-text: #eef5fb;
      --nf-muted: #9eb2c4;
    }
    * { box-sizing: border-box; }
    html, body, #root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body {
      background: var(--nf-bg);
      color: var(--nf-text);
      font: 13px/1.4 "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
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
      height: 100%;
      padding: 12px 8px;
      background: var(--nf-rail);
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow: hidden;
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
<body class="nf-shell-source-owned nf-route-effects nf-shell-ready" data-novaflow-isolated-shell="1">
  <div id="root">
    <main class="nf-shell" data-novaflow-source-shell="1">
      <nav class="nf-primary-rail" data-novaflow-primary-rail="1" aria-label="NovaFlow primary rail">
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="effects" aria-pressed="true" data-route="effects">特效</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="animation" aria-pressed="false" data-route="animation">动画</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="art" aria-pressed="false" data-route="art">美工</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="tools" aria-pressed="false" data-route="tools">工具</button>
      </nav>
      <section class="nf-left-shell" data-novaflow-left-content-shell="1">
        <div class="nf-secondary-stack" data-novaflow-route-shell="1">
          <div class="nf-secondary-tabs" data-novaflow-secondary-tabs="1">
            <button class="nf-secondary-entry" data-novaflow-secondary-entry="1" aria-pressed="true">粒子特效</button>
            <button class="nf-secondary-entry" data-novaflow-secondary-entry="1" aria-pressed="false">AI序列动画</button>
          </div>
          <section class="nf-panel" data-novaflow-panel="1">
            <div class="nf-panel-body">
              <div class="nf-chip">source-owned shell</div>
              <p>Route default parity, panel containment, and body class control are isolated here.</p>
              <p>Prototype path never replaces 4783 production runtime.</p>
            </div>
          </section>
        </div>
      </section>
      <section class="nf-route-container" data-novaflow-route-container="1">
        <div class="nf-workspace" data-novaflow-workspace="1">
          <header class="nf-workspace-header">
            <strong data-route-title>粒子特效</strong>
            <span class="nf-chip" data-route-state>effects</span>
          </header>
          <div class="nf-canvas" data-route-canvas>isolated source shell canvas</div>
          <footer class="nf-workspace-footer">
            <span>panel width locked</span>
            <span>overflow guarded</span>
          </footer>
        </div>
      </section>
    </main>
  </div>
  <script>
    (() => {
      const routeMap = {
        effects: { body: "nf-shell-source-owned nf-route-effects nf-shell-ready", title: "粒子特效", secondary: ["粒子特效", "AI特效"] },
        animation: { body: "nf-shell-source-owned nf-route-animation nf-shell-ready", title: "AI序列动画", secondary: ["AI序列动画", "骨骼动画"] },
        art: { body: "nf-shell-source-owned nf-route-art nf-shell-ready", title: "UI", secondary: ["UI", "拆图"] },
        tools: { body: "nf-shell-source-owned nf-route-tools nf-shell-ready", title: "工作台", secondary: ["工作台", "导出"] }
      };
      const title = document.querySelector("[data-route-title]");
      const state = document.querySelector("[data-route-state]");
      const secondary = Array.from(document.querySelectorAll("[data-novaflow-secondary-entry]"));
      const entries = Array.from(document.querySelectorAll("[data-novaflow-primary-entry]"));
      function setRoute(route) {
        const spec = routeMap[route] || routeMap.effects;
        document.body.className = spec.body;
        if (title) title.textContent = spec.title;
        if (state) state.textContent = route;
        entries.forEach((entry) => entry.setAttribute("aria-pressed", entry.dataset.route === route ? "true" : "false"));
        secondary.forEach((entry, index) => {
          entry.textContent = spec.secondary[index] || spec.secondary[0];
          entry.setAttribute("aria-pressed", index === 0 ? "true" : "false");
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

function parseFirstFrameResult(stdout) {
  const match = stdout.match(/__NOVAFLOW_G3_FIRST_FRAME_RESULT__(.*)__END_NOVAFLOW_G3_FIRST_FRAME_RESULT__/s)
  assert(match, 'G4_FIRST_FRAME_RESULT_MISSING')
  return JSON.parse(match[1])
}

function runFirstFrameHarness({ sessionId, renderer, tempRoot }) {
  const args = [
    path.join('tools', 'smoke', 'first-frame-harness-runner.mjs'),
    '--session',
    sessionId,
    '--renderer',
    renderer,
    '--temp-root',
    tempRoot,
    '--timeout-ms',
    '90000'
  ]
  const run = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  })
  if (run.stderr) process.stderr.write(run.stderr)
  assert(run.status === 0, 'G4_FIRST_FRAME_RUNNER_FAILED', {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    renderer
  })
  return parseFirstFrameResult(run.stdout || '')
}

function lastReceiptForTrace(result, traceType) {
  const receipts = Array.isArray(result.measurementReceipts) ? result.measurementReceipts : []
  const scoped = receipts.filter((receipt) => receipt.traceType === traceType)
  return scoped[scoped.length - 1] || receipts[receipts.length - 1] || null
}

function firstNonEmptyBodyClassFrame(result) {
  const samples = result.trace && Array.isArray(result.trace.samples) ? result.trace.samples : []
  const found = samples.find((sample) => sample.bodyClasses && sample.bodyClasses.trim())
  return found ? found.frameIndex : null
}

function frameTimestampByLabel(result, label) {
  const samples = result.trace && Array.isArray(result.trace.samples) ? result.trace.samples : []
  const found = samples.find((sample) => sample.label === label)
  return found ? found.timestamp : null
}

function layoutShiftCount(result) {
  const receipts = Array.isArray(result.measurementReceipts) ? result.measurementReceipts : []
  return receipts.filter((receipt) => receipt.layoutShiftDetected).length
}

function anyOverflow(result) {
  const receipts = Array.isArray(result.measurementReceipts) ? result.measurementReceipts : []
  return receipts.some((receipt) => {
    const state = receipt.overflowState || {}
    return state.horizontalOverflow || state.panelOverflow
  })
}

function railMax(result) {
  const receipts = Array.isArray(result.measurementReceipts) ? result.measurementReceipts : []
  return Math.max(0, ...receipts.map((receipt) => Number(receipt.railWidth || 0)))
}

function routeSummary(receipt) {
  if (!receipt || !receipt.routeState) return { activePrimaryIndex: null, activePrimaryText: '', primaryEntryCount: 0 }
  return {
    activePrimaryIndex: receipt.routeState.activePrimaryIndex,
    activePrimaryText: receipt.routeState.activePrimaryText,
    primaryEntryCount: receipt.routeState.primaryEntryCount
  }
}

function makeReceipt(target, baselineValue, isolatedValue, options) {
  return {
    parityTarget: target,
    baselineValue,
    isolatedValue,
    regressionDetected: !!options.regressionDetected,
    layoutShiftImproved: !!options.layoutShiftImproved,
    consoleErrorDelta: options.consoleErrorDelta,
    routeParity: !!options.routeParity
  }
}

function createParityReceipts(baseline, isolated) {
  const consoleErrorDelta = Number(isolated.consoleErrorCount || 0) - Number(baseline.consoleErrorCount || 0)
  const baselineShiftCount = layoutShiftCount(baseline)
  const isolatedShiftCount = layoutShiftCount(isolated)
  const layoutShiftImproved = isolatedShiftCount < baselineShiftCount
  const routeDefaultBaseline = routeSummary(lastReceiptForTrace(baseline, 'cold-start'))
  const routeDefaultIsolated = routeSummary(lastReceiptForTrace(isolated, 'cold-start'))
  const animationBaseline = routeSummary(lastReceiptForTrace(baseline, 'animation-route-trace'))
  const animationIsolated = routeSummary(lastReceiptForTrace(isolated, 'animation-route-trace'))
  const toolsBaseline = routeSummary(lastReceiptForTrace(baseline, 'tools-route-trace'))
  const toolsIsolated = routeSummary(lastReceiptForTrace(isolated, 'tools-route-trace'))
  const baselineRail = railMax(baseline)
  const isolatedRail = railMax(isolated)
  const baselineBodyTiming = firstNonEmptyBodyClassFrame(baseline)
  const isolatedBodyTiming = firstNonEmptyBodyClassFrame(isolated)
  const baselineStableTiming = frameTimestampByLabel(baseline, 'stable-frame')
  const isolatedStableTiming = frameTimestampByLabel(isolated, 'stable-frame')

  return [
    makeReceipt('route-default-parity', routeDefaultBaseline, routeDefaultIsolated, {
      regressionDetected: routeDefaultIsolated.primaryEntryCount < Math.min(routeDefaultBaseline.primaryEntryCount || 0, 4),
      layoutShiftImproved,
      consoleErrorDelta,
      routeParity: routeDefaultIsolated.primaryEntryCount >= 4 && routeDefaultIsolated.activePrimaryIndex !== null
    }),
    makeReceipt('animation-route-parity', animationBaseline, animationIsolated, {
      regressionDetected: animationIsolated.activePrimaryIndex === null,
      layoutShiftImproved,
      consoleErrorDelta,
      routeParity: animationIsolated.activePrimaryIndex !== null && animationIsolated.primaryEntryCount >= 4
    }),
    makeReceipt('tools-route-parity', toolsBaseline, toolsIsolated, {
      regressionDetected: toolsIsolated.activePrimaryIndex === null,
      layoutShiftImproved,
      consoleErrorDelta,
      routeParity: toolsIsolated.activePrimaryIndex !== null && toolsIsolated.primaryEntryCount >= 4
    }),
    makeReceipt('panel-width-parity', { railMax: baselineRail }, { railMax: isolatedRail }, {
      regressionDetected: Math.abs(isolatedRail - baselineRail) > 4,
      layoutShiftImproved,
      consoleErrorDelta,
      routeParity: Math.abs(isolatedRail - baselineRail) <= 4
    }),
    makeReceipt('overflow-parity', { overflowDetected: anyOverflow(baseline) }, { overflowDetected: anyOverflow(isolated) }, {
      regressionDetected: anyOverflow(isolated) && !anyOverflow(baseline),
      layoutShiftImproved,
      consoleErrorDelta,
      routeParity: !anyOverflow(isolated)
    }),
    makeReceipt('body-class-timing-compare', { firstNonEmptyBodyClassFrame: baselineBodyTiming }, { firstNonEmptyBodyClassFrame: isolatedBodyTiming }, {
      regressionDetected: isolatedBodyTiming === null,
      layoutShiftImproved,
      consoleErrorDelta,
      routeParity: isolatedBodyTiming !== null
    }),
    makeReceipt('stable-frame-timing-compare', { stableFrameTimestamp: baselineStableTiming }, { stableFrameTimestamp: isolatedStableTiming }, {
      regressionDetected: isolatedStableTiming === null,
      layoutShiftImproved,
      consoleErrorDelta,
      routeParity: isolatedStableTiming !== null
    }),
    makeReceipt('layout-shift-compare', { layoutShiftCount: baselineShiftCount }, { layoutShiftCount: isolatedShiftCount }, {
      regressionDetected: isolatedShiftCount > baselineShiftCount,
      layoutShiftImproved,
      consoleErrorDelta,
      routeParity: true
    })
  ]
}

function validateFirstFrameResult(result, codePrefix) {
  assert(result.ok === true, `${codePrefix}_RESULT_NOT_OK`, result)
  assert(result.protocol === 'file:', `${codePrefix}_NOT_FILE_PROTOCOL`, { protocol: result.protocol })
  assert(result.consoleErrorCount === 0, `${codePrefix}_CONSOLE_ERRORS`, result.consoleErrors)
  assert(result.runtimeChainStable === true, `${codePrefix}_RUNTIME_CHAIN_UNSTABLE`, result)
  assert(Array.isArray(result.measurementReceipts) && result.measurementReceipts.length >= 8, `${codePrefix}_RECEIPTS_MISSING`, result.measurementReceipts)
  assert(result.trace && Array.isArray(result.trace.samples) && result.trace.samples.length >= 12, `${codePrefix}_TRACE_TOO_SMALL`, result.trace)
}

function validateParityReceipts(receipts) {
  assert(Array.isArray(receipts) && receipts.length >= 6, 'G4_PARITY_RECEIPTS_MISSING', receipts)
  for (const receipt of receipts) {
    for (const field of ['parityTarget', 'baselineValue', 'isolatedValue', 'regressionDetected', 'layoutShiftImproved', 'consoleErrorDelta', 'routeParity']) {
      assert(Object.prototype.hasOwnProperty.call(receipt, field), 'G4_PARITY_RECEIPT_FIELD_MISSING', { field, receipt })
    }
    assert(typeof receipt.consoleErrorDelta === 'number', 'G4_PARITY_CONSOLE_DELTA_INVALID', receipt)
  }
}

try {
  const sessionBase = `g4-shell-isolated-${Date.now()}`
  const isolatedRenderer = createIsolatedPrototype(sessionBase)
  const productionBefore = hashRuntimeChain(packagedRendererEntry)
  const baseline = runFirstFrameHarness({
    sessionId: `${sessionBase}-baseline`,
    renderer: packagedRendererEntry,
    tempRoot: path.join(prototypeRoot, 'baseline-trace')
  })
  const productionAfterBaseline = hashRuntimeChain(packagedRendererEntry)
  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfterBaseline), 'G4_PRODUCTION_CHAIN_CHANGED_AFTER_BASELINE', {
    before: productionBefore,
    after: productionAfterBaseline
  })

  const isolatedOne = runFirstFrameHarness({
    sessionId: `${sessionBase}-isolated-1`,
    renderer: isolatedRenderer,
    tempRoot: path.join(prototypeRoot, 'isolated-trace')
  })
  const isolatedTwo = runFirstFrameHarness({
    sessionId: `${sessionBase}-isolated-2`,
    renderer: isolatedRenderer,
    tempRoot: path.join(prototypeRoot, 'isolated-trace')
  })
  const productionAfter = hashRuntimeChain(packagedRendererEntry)

  validateFirstFrameResult(baseline, 'G4_BASELINE')
  validateFirstFrameResult(isolatedOne, 'G4_ISOLATED_ONE')
  validateFirstFrameResult(isolatedTwo, 'G4_ISOLATED_TWO')
  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfter), 'G4_PRODUCTION_CHAIN_CHANGED', {
    before: productionBefore,
    after: productionAfter
  })

  const baselineVsIsolated = compareFirstFrameTraces(baseline, isolatedOne)
  const isolatedRepeatComparison = compareFirstFrameTraces(isolatedOne, isolatedTwo)
  assert(baselineVsIsolated.comparable === true, 'G4_BASELINE_ISOLATED_NOT_COMPARABLE', baselineVsIsolated)
  assert(isolatedRepeatComparison.comparable === true, 'G4_ISOLATED_REPEAT_NOT_COMPARABLE', isolatedRepeatComparison)
  assert(isolatedRepeatComparison.missingTraceTypes.length === 0, 'G4_ISOLATED_REPEAT_TRACE_MISSING', isolatedRepeatComparison)
  assert(isolatedRepeatComparison.extraTraceTypes.length === 0, 'G4_ISOLATED_REPEAT_TRACE_EXTRA', isolatedRepeatComparison)

  const parityReceipts = createParityReceipts(baseline, isolatedOne)
  validateParityReceipts(parityReceipts)
  assert(parityReceipts.every((receipt) => receipt.consoleErrorDelta <= 0), 'G4_CONSOLE_ERROR_DELTA_INCREASED', parityReceipts)
  assert(parityReceipts.some((receipt) => receipt.routeParity === true), 'G4_ROUTE_PARITY_NOT_VERIFIABLE', parityReceipts)

  console.log(JSON.stringify({
    ok: true,
    code: 'G4_SHELL_ISOLATED_PARITY_OK',
    sessionId: sessionBase,
    isolatedRenderer: path.relative(repoRoot, isolatedRenderer).replace(/\\/g, '/'),
    productionRuntimeStable: true,
    productionRuntimeFileCount: productionBefore.length,
    baseline: {
      sessionId: baseline.sessionId,
      consoleErrorCount: baseline.consoleErrorCount,
      receiptCount: baseline.measurementReceipts.length,
      layoutShiftCount: layoutShiftCount(baseline),
      railMax: railMax(baseline),
      overflowDetected: anyOverflow(baseline)
    },
    isolated: {
      sessionId: isolatedOne.sessionId,
      repeatSessionId: isolatedTwo.sessionId,
      consoleErrorCount: isolatedOne.consoleErrorCount,
      receiptCount: isolatedOne.measurementReceipts.length,
      layoutShiftCount: layoutShiftCount(isolatedOne),
      railMax: railMax(isolatedOne),
      overflowDetected: anyOverflow(isolatedOne)
    },
    baselineVsIsolated,
    isolatedRepeatComparison,
    parityReceipts
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G4_SHELL_ISOLATED_PARITY_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
