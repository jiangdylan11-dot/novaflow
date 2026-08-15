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
const prototypeRoot = path.join(repoRoot, 'debug-output', 'isolated-first-frame-regression-reduction-2026-05-17')

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

function baseShellCss(extra = '') {
  return `
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
    ${extra}
  `
}

function createShellPrototype({ sessionId, kind }) {
  const sessionDir = path.join(prototypeRoot, kind, sessionId)
  mkdirSync(sessionDir, { recursive: true })
  const htmlPath = path.join(sessionDir, 'index.html')
  const isReduction = kind === 'g7-reduction'
  const bodyClass = isReduction
    ? 'nf-shell-source-owned nf-shell-ready nf-route-stable'
    : 'nf-shell-source-owned nf-route-effects nf-shell-ready'
  const extraCss = isReduction
    ? `
    body[data-current-route="effects"] [data-route-title]::after { content: " effects route open"; }
    body[data-current-route="animation"] [data-route-title]::after { content: " animation route open"; }
    body[data-current-route="tools"] [data-route-title]::after { content: " tools route open"; }
    .nf-primary-entry[data-current="true"] {
      color: var(--nf-text);
      background: #203040;
      border-color: #33485a;
    }
    `
    : ''
  const routeScript = isReduction
    ? `
    (() => {
      const routeMap = {
        effects: { title: "effects", secondary: ["particle", "aifx"] },
        animation: { title: "animation", secondary: ["ai-sequence", "spine"] },
        art: { title: "art", secondary: ["ui", "split"] },
        tools: { title: "tools", secondary: ["workspace", "export"] }
      };
      const title = document.querySelector("[data-route-title]");
      const state = document.querySelector("[data-route-state]");
      const secondary = Array.from(document.querySelectorAll("[data-novaflow-secondary-entry]"));
      const entries = Array.from(document.querySelectorAll("[data-novaflow-primary-entry]"));
      function setRoute(route) {
        const spec = routeMap[route] || routeMap.effects;
        document.body.dataset.currentRoute = route;
        if (title) title.textContent = spec.title;
        if (state) state.textContent = route;
        entries.forEach((entry) => entry.dataset.current = entry.dataset.route === route ? "true" : "false");
        secondary.forEach((entry, index) => {
          entry.textContent = spec.secondary[index] || spec.secondary[0];
        });
      }
      entries.forEach((entry) => entry.addEventListener("click", () => setRoute(entry.dataset.route)));
      setRoute("effects");
    })();
    `
    : `
    (() => {
      const routeMap = {
        effects: { body: "nf-shell-source-owned nf-route-effects nf-shell-ready", title: "effects", secondary: ["particle", "aifx"] },
        animation: { body: "nf-shell-source-owned nf-route-animation nf-shell-ready", title: "animation", secondary: ["ai-sequence", "spine"] },
        art: { body: "nf-shell-source-owned nf-route-art nf-shell-ready", title: "art", secondary: ["ui", "split"] },
        tools: { body: "nf-shell-source-owned nf-route-tools nf-shell-ready", title: "tools", secondary: ["workspace", "export"] }
      };
      const title = document.querySelector("[data-route-title]");
      const state = document.querySelector("[data-route-state]");
      const secondary = Array.from(document.querySelectorAll("[data-novaflow-secondary-entry]"));
      const entries = Array.from(document.querySelectorAll("[data-novaflow-primary-entry]"));
      function setRoute(route) {
        const spec = routeMap[route] || routeMap.effects;
        document.body.className = spec.body;
        document.body.dataset.currentRoute = route;
        if (title) title.textContent = spec.title + " route open";
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
    `
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NovaFlow ${isReduction ? 'G7 Reduction' : 'G4 Parity'} Shell Prototype</title>
  <style id="${isReduction ? 'g7-isolated-prepaint' : 'g4-isolated-style'}">${baseShellCss(extraCss)}</style>
</head>
<body class="${bodyClass}" data-current-route="effects" data-novaflow-isolated-shell="1" data-g7-reduction="${isReduction ? '1' : '0'}">
  <div id="root">
    <main class="nf-shell" data-novaflow-source-shell="1">
      <nav class="nf-primary-rail" data-novaflow-primary-rail="1" aria-label="NovaFlow primary rail">
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="effects" aria-pressed="${isReduction ? 'false' : 'true'}" data-current="true" data-route="effects">effects</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="animation" aria-pressed="${isReduction ? 'false' : 'false'}" data-current="false" data-route="animation">animation</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="art" aria-pressed="false" data-current="false" data-route="art">art</button>
        <button class="nf-primary-entry" data-novaflow-primary-entry="1" data-novaflow-primary-label="tools" aria-pressed="false" data-current="false" data-route="tools">tools</button>
      </nav>
      <section class="nf-left-shell" data-novaflow-left-content-shell="1">
        <div class="nf-secondary-stack" data-novaflow-route-shell="1">
          <div class="nf-secondary-tabs" data-novaflow-secondary-tabs="1">
            <button class="nf-secondary-entry" data-novaflow-secondary-entry="1" aria-pressed="true">particle</button>
            <button class="nf-secondary-entry" data-novaflow-secondary-entry="1" aria-pressed="false">aifx</button>
          </div>
          <section class="nf-panel" data-novaflow-panel="1">
            <div class="nf-panel-body">
              <div class="nf-chip">${isReduction ? 'G7 timing reduction shell' : 'G4 parity shell'}</div>
              <p>Source-owned shell timing experiment in isolated lane.</p>
              <p>No production runtime mutation.</p>
            </div>
          </section>
        </div>
      </section>
      <section class="nf-route-container" data-novaflow-route-container="1">
        <div class="nf-workspace" data-novaflow-workspace="1">
          <header class="nf-workspace-header">
            <strong data-route-title>effects${isReduction ? '' : ' route open'}</strong>
            <span class="nf-chip" data-route-state>effects</span>
          </header>
          <div class="nf-canvas" data-route-canvas>isolated first-frame ${isReduction ? 'reduction' : 'parity'} canvas</div>
          <footer class="nf-workspace-footer">
            <span>rail width locked</span>
            <span>panel overflow guarded</span>
          </footer>
        </div>
      </section>
    </main>
  </div>
  <script>${routeScript}</script>
</body>
</html>
`
  writeFileSync(htmlPath, html, 'utf8')
  return htmlPath
}

function parseFirstFrameResult(stdout) {
  const match = stdout.match(/__NOVAFLOW_G3_FIRST_FRAME_RESULT__(.*)__END_NOVAFLOW_G3_FIRST_FRAME_RESULT__/s)
  assert(match, 'G7_FIRST_FRAME_RESULT_MISSING')
  return JSON.parse(match[1])
}

function parseJsonOutput(stdout) {
  const trimmed = String(stdout || '').trim()
  const start = trimmed.lastIndexOf('\n{')
  return JSON.parse(start >= 0 ? trimmed.slice(start + 1) : trimmed)
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
  ], 'G7_FIRST_FRAME_RUNNER_FAILED')
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
  const receiptFor = (traceType) => {
    const scoped = receipts(result).filter((receipt) => receipt.traceType === traceType)
    return scoped[scoped.length - 1] || null
  }
  const coldReceipt = receiptFor('cold-start')
  const animationReceipt = receiptFor('animation-route-trace')
  const toolsReceipt = receiptFor('tools-route-trace')
  const cold = traceText(result, 'cold-start')
  const animation = traceText(result, 'animation-route-trace')
  const tools = traceText(result, 'tools-route-trace')
  const coldOk = !!coldReceipt && (
    (coldReceipt.routeState && coldReceipt.routeState.activePrimaryIndex !== null) ||
    /effects|特效/i.test(cold)
  )
  const animationOk = !!animationReceipt && (
    (animationReceipt.routeState && animationReceipt.routeState.activePrimaryIndex === 1) ||
    /animation|动画/i.test(animation)
  )
  const toolsOk = !!toolsReceipt && (
    (toolsReceipt.routeState && toolsReceipt.routeState.activePrimaryIndex === 3) ||
    /tools|工具/i.test(tools)
  )
  return coldOk && animationOk && toolsOk
}

function reductionReceipt(label, result, baselineResult) {
  return {
    target: label,
    layoutShiftCount: layoutShiftCount(result),
    stableFrameTime: stableFrameTime(result),
    railShiftCount: railShiftCount(result),
    overflowDetected: overflowDetected(result),
    routeStable: routeStable(result),
    consoleErrorDelta: Number(result.consoleErrorCount || 0) - Number(baselineResult.consoleErrorCount || 0)
  }
}

function validateFirstFrameResult(result, codePrefix) {
  assert(result.ok === true, `${codePrefix}_NOT_OK`, result)
  assert(result.protocol === 'file:', `${codePrefix}_NOT_FILE_PROTOCOL`, { protocol: result.protocol })
  assert(result.consoleErrorCount === 0, `${codePrefix}_CONSOLE_ERRORS`, result.consoleErrors)
  assert(result.runtimeChainStable === true, `${codePrefix}_RUNTIME_CHAIN_UNSTABLE`, result)
  assert(receipts(result).length >= 8, `${codePrefix}_RECEIPTS_MISSING`, result.measurementReceipts)
  assert(samples(result).length >= 12, `${codePrefix}_SAMPLES_MISSING`, result.trace)
}

function validateReceipt(receipt) {
  for (const field of ['layoutShiftCount', 'stableFrameTime', 'railShiftCount', 'overflowDetected', 'routeStable', 'consoleErrorDelta']) {
    assert(Object.prototype.hasOwnProperty.call(receipt, field), 'G7_REDUCTION_RECEIPT_FIELD_MISSING', { field, receipt })
  }
  assert(receipt.consoleErrorDelta === 0, 'G7_CONSOLE_ERROR_DELTA', receipt)
  assert(receipt.routeStable === true, 'G7_ROUTE_NOT_STABLE', receipt)
  assert(receipt.overflowDetected === false, 'G7_OVERFLOW_REGRESSION', receipt)
}

try {
  const sessionBase = `g7-isolated-reduction-${Date.now()}`
  mkdirSync(prototypeRoot, { recursive: true })
  const productionBefore = hashRuntimeChain(productionRendererEntry)
  const g4Renderer = createShellPrototype({ sessionId: `${sessionBase}-g4`, kind: 'g4-parity' })
  const g7Renderer = createShellPrototype({ sessionId: `${sessionBase}-g7`, kind: 'g7-reduction' })

  const baseline = runFirstFrame(productionRendererEntry, `${sessionBase}-baseline`)
  const g4Parity = runFirstFrame(g4Renderer, `${sessionBase}-g4-parity`)
  const g7First = runFirstFrame(g7Renderer, `${sessionBase}-g7-first`)
  const g7Second = runFirstFrame(g7Renderer, `${sessionBase}-g7-second`)

  validateFirstFrameResult(baseline, 'G7_BASELINE')
  validateFirstFrameResult(g4Parity, 'G7_G4_PARITY')
  validateFirstFrameResult(g7First, 'G7_FIRST')
  validateFirstFrameResult(g7Second, 'G7_SECOND')

  const productionAfter = hashRuntimeChain(productionRendererEntry)
  assert(JSON.stringify(productionBefore) === JSON.stringify(productionAfter), 'G7_PRODUCTION_RUNTIME_CHAIN_CHANGED', {
    before: productionBefore,
    after: productionAfter
  })

  const baselineReceipt = reductionReceipt('baseline', baseline, baseline)
  const g4Receipt = reductionReceipt('g4-parity-prototype', g4Parity, baseline)
  const g7Receipt = reductionReceipt('g7-reduction-experiment', g7First, baseline)
  const g7RepeatReceipt = reductionReceipt('g7-reduction-repeat', g7Second, baseline)
  for (const receipt of [baselineReceipt, g4Receipt, g7Receipt, g7RepeatReceipt]) validateReceipt(receipt)

  const protectedHarness = parseJsonOutput(runNode([
    path.join('tools', 'smoke', 'g2-protected-island-harness-check.mjs')
  ], 'G7_PROTECTED_HARNESS_FAILED'))
  assert(protectedHarness.ok === true, 'G7_PROTECTED_HARNESS_NOT_OK', protectedHarness)

  const baselineVsG4 = compareFirstFrameTraces(baseline, g4Parity)
  const g4VsG7 = compareFirstFrameTraces(g4Parity, g7First)
  const g7Repeat = compareFirstFrameTraces(g7First, g7Second)
  assert(g7Repeat.comparable === true, 'G7_REPEAT_NOT_COMPARABLE', g7Repeat)
  assert(g7Repeat.missingTraceTypes.length === 0, 'G7_REPEAT_TRACE_MISSING', g7Repeat)
  assert(g7Repeat.extraTraceTypes.length === 0, 'G7_REPEAT_TRACE_EXTRA', g7Repeat)

  console.log(JSON.stringify({
    ok: true,
    code: 'G7_ISOLATED_FIRST_FRAME_REDUCTION_OK',
    sessionId: sessionBase,
    productionRuntimeStable: true,
    productionRuntimeFileCount: productionBefore.length,
    renderers: {
      baseline: path.relative(repoRoot, productionRendererEntry).replace(/\\/g, '/'),
      g4Parity: path.relative(repoRoot, g4Renderer).replace(/\\/g, '/'),
      g7Reduction: path.relative(repoRoot, g7Renderer).replace(/\\/g, '/')
    },
    receipts: {
      baseline: baselineReceipt,
      g4Parity: g4Receipt,
      g7Reduction: g7Receipt,
      g7Repeat: g7RepeatReceipt
    },
    comparisons: {
      baselineVsG4,
      g4VsG7,
      g7Repeat,
      layoutShiftImprovedVsG4: g7Receipt.layoutShiftCount < g4Receipt.layoutShiftCount,
      layoutShiftImprovedVsBaseline: g7Receipt.layoutShiftCount < baselineReceipt.layoutShiftCount,
      railShiftImprovedVsG4: g7Receipt.railShiftCount < g4Receipt.railShiftCount
    },
    regressionGuard: {
      routeRegression: !g7Receipt.routeStable,
      panelOverflowRegression: g7Receipt.overflowDetected,
      protectedIslandRegression: protectedHarness.ok !== true,
      consoleErrorIncrease: g7Receipt.consoleErrorDelta > 0
    },
    protectedHarness: {
      ok: protectedHarness.ok,
      repeatableRuns: protectedHarness.repeatableRuns
    }
  }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || 'G7_ISOLATED_FIRST_FRAME_REDUCTION_FAILED',
    message: error.message,
    details: error.details || {}
  }, null, 2))
  process.exit(1)
}
