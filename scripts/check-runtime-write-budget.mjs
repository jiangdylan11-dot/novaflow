#!/usr/bin/env node
// Runtime DOM write budget check.
//
// The brand runtime patches the live DOM on every sync pass. When a writer is not
// idempotent its no-op writes still produce mutation records, those records wake the
// global MutationObserver, and the observer re-runs the sync - a self-feeding loop.
// This check drives the locked 4783 runtime through Chrome DevTools Protocol, counts
// the DOM writes and forced layout reads for a set of scenarios, and fails when a
// scenario exceeds its recorded budget.
//
//   node scripts/check-runtime-write-budget.mjs            verify against the snapshot
//   node scripts/check-runtime-write-budget.mjs --update   re-record the snapshot
//   node scripts/check-runtime-write-budget.mjs --json      machine-readable report
//
// Requires the 4783 preview runtime to be serving (npm run dev).

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const require = createRequire(path.join(repoRoot, "particle-editor-desktop", "package.json"));
const WebSocket = require("ws");

const RUNTIME_URL = "http://127.0.0.1:4783/";
const SNAPSHOT_PATH = path.join(repoRoot, "RUNTIME_WRITE_BUDGET.json");

const args = new Set(process.argv.slice(2));
const UPDATE = args.has("--update");
const JSON_OUT = args.has("--json");
// Budgets need headroom: the runtime schedules work on time windows, so two runs of the
// same build differ slightly. 15% over the recorded value catches real regressions
// without flaking on that jitter.
const TOLERANCE = 0.15;

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];

// Counting probe. Installed before any page script runs so nothing escapes it, but the
// counters are only read between an explicit reset and a scenario, so boot noise is
// never attributed to a scenario.
const PROBE = String.raw`(() => {
  const C = CSSStyleDeclaration.prototype, E = Element.prototype, D = Document.prototype;
  const W = { style:0, styleNoop:0, attr:0, attrNoop:0, gbcr:0, gcs:0, qsa:0, qsaNodes:0, byWriter:{} };
  window.__NFWriteBudget = W;
  const writer = () => {
    const stack = (new Error()).stack.split("\n");
    for (let i = 2; i < Math.min(stack.length, 10); i++) {
      const m = stack[i].match(/at\s+([A-Za-z0-9_$]+)\s/);
      if (m && !/^(nfSetStyleIfChanged|nfSetAttrIfChanged|setRawStylePropertyIfChanged|setStylePropertyIfChanged|setAttributeIfChanged|Object)$/.test(m[1])) return m[1];
    }
    return "anonymous";
  };
  const bump = (name) => { W.byWriter[name] = (W.byWriter[name] || 0) + 1; };
  const setProperty = C.setProperty;
  C.setProperty = function (prop, value, priority) {
    W.style++;
    try {
      if (this.getPropertyValue(prop) === String(value) && this.getPropertyPriority(prop) === (priority || "")) {
        W.styleNoop++; bump("style:" + writer());
      }
    } catch {}
    return setProperty.apply(this, arguments);
  };
  const setAttribute = E.setAttribute;
  E.setAttribute = function (name, value) {
    W.attr++;
    try {
      if (this.getAttribute(name) === String(value)) { W.attrNoop++; bump("attr:" + writer()); }
    } catch {}
    return setAttribute.apply(this, arguments);
  };
  const getBoundingClientRect = E.getBoundingClientRect;
  E.getBoundingClientRect = function () { W.gbcr++; return getBoundingClientRect.apply(this, arguments); };
  const getComputedStyle = window.getComputedStyle;
  window.getComputedStyle = function () { W.gcs++; return getComputedStyle.apply(this, arguments); };
  const elQuery = E.querySelectorAll, docQuery = D.querySelectorAll;
  E.querySelectorAll = function () { const r = elQuery.apply(this, arguments); W.qsa++; W.qsaNodes += r.length; return r; };
  D.querySelectorAll = function () { const r = docQuery.apply(this, arguments); W.qsa++; W.qsaNodes += r.length; return r; };

  window.__nfResetBudget = () => { for (const k of Object.keys(W)) { if (typeof W[k] === "number") W[k] = 0; } W.byWriter = {}; };
  window.__nfReadBudget = () => JSON.parse(JSON.stringify(W));
  window.__nfSection = () => (document.body ? (document.body.className.match(/novaflow-primary-target-(\w+)/) || [])[1] || null : null);
  // A real pointer sequence: the runtime gates the primary switch on pointerdown, not click.
  window.__nfSwitch = (label) => {
    const button = Array.from(document.querySelectorAll("[data-novaflow-primary-entry]"))
      .find((b) => b.getAttribute("data-novaflow-primary-label") === label);
    if (!button) throw new Error("primary entry not found: " + label);
    const rect = button.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, composed: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0, pointerId: 1, isPrimary: true };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      button.dispatchEvent(new Ctor(type, Object.assign({}, init, { buttons: type.endsWith("down") ? 1 : 0 })));
    }
    return true;
  };
})();`;

const SCENARIOS = [
  {
    name: "particle-idle-5s",
    title: "特效区空闲 5 秒",
    // Nobody is touching the app. Any write here is the runtime talking to itself.
    metrics: ["style", "styleNoop", "attr", "attrNoop", "gcs", "qsa"],
    async run(page) {
      await page.settle("particle");
      await page.eval("window.__nfResetBudget()");
      await page.sleep(5000);
    }
  },
  {
    name: "switch-particle-to-animation",
    title: "分区切换 特效 -> 动画",
    metrics: ["style", "styleNoop", "attr", "attrNoop", "gbcr", "gcs", "qsa", "qsaNodes"],
    async run(page) {
      await page.settle("particle");
      await page.eval("window.__nfResetBudget()");
      await page.eval("window.__nfSwitch('\u52a8\u753b')");
      await page.sleep(3000);
      const landed = await page.eval("window.__nfSection()");
      if (landed !== "animation") throw new Error("switch did not land on animation (got " + landed + ")");
    }
  },
  {
    name: "switch-animation-to-art",
    title: "分区切换 动画 -> 美工",
    metrics: ["style", "styleNoop", "attr", "attrNoop", "gbcr", "gcs", "qsa", "qsaNodes"],
    async run(page) {
      await page.settle("particle");
      await page.eval("window.__nfSwitch('\u52a8\u753b')");
      await page.sleep(3000);
      await page.eval("window.__nfResetBudget()");
      await page.eval("window.__nfSwitch('\u7f8e\u5de5')");
      await page.sleep(3000);
      const landed = await page.eval("window.__nfSection()");
      if (landed !== "art") throw new Error("switch did not land on art (got " + landed + ")");
    }
  }
];

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) if (fs.existsSync(candidate)) return candidate;
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForRuntime() {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(RUNTIME_URL, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {}
    await sleep(500);
  }
  return false;
}

async function launchChrome() {
  const bin = findChrome();
  if (!bin) throw new Error("Chrome/Edge not found; install one or add a path to CHROME_CANDIDATES");
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nf-write-budget-"));
  const child = spawn(bin, [
    "--headless=new",
    "--remote-debugging-port=" + port,
    "--user-data-dir=" + profile,
    "--window-size=1280,800",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "about:blank"
  ], { stdio: "ignore", detached: false });

  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch("http://127.0.0.1:" + port + "/json/version", { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        const info = await res.json();
        return { child, port, profile, wsUrl: info.webSocketDebuggerUrl };
      }
    } catch {}
    await sleep(250);
  }
  try { child.kill(); } catch {}
  throw new Error("Chrome did not expose a DevTools endpoint in time");
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    const pending = new Map();
    let nextId = 1;
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(msg.error.message)); else entry.resolve(msg.result);
      }
    });
    ws.on("error", reject);
    ws.on("open", () => resolve({
      send(method, params, sessionId) {
        const id = nextId++;
        return new Promise((ok, fail) => {
          pending.set(id, { resolve: ok, reject: fail });
          const frame = { id, method, params: params || {} };
          if (sessionId) frame.sessionId = sessionId;
          ws.send(JSON.stringify(frame));
          setTimeout(() => {
            if (pending.has(id)) { pending.delete(id); fail(new Error("CDP timeout: " + method)); }
          }, 60000);
        });
      },
      close() { try { ws.close(); } catch {} }
    }));
  });
}

async function openPage(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE }, sessionId);

  const page = {
    async eval(expression) {
      const res = await cdp.send("Runtime.evaluate", {
        expression, awaitPromise: true, returnByValue: true
      }, sessionId);
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception && res.exceptionDetails.exception.description
          ? res.exceptionDetails.exception.description
          : res.exceptionDetails.text);
      }
      return res.result ? res.result.value : undefined;
    },
    sleep,
    async reload() {
      await cdp.send("Page.navigate", { url: RUNTIME_URL }, sessionId);
      await sleep(1500);
      for (let i = 0; i < 80; i++) {
        const ready = await page
          .eval("!!(document.body && document.body.classList.contains('novaflow-brand-runtime-ready'))")
          .catch(() => false);
        if (ready) break;
        await sleep(250);
      }
      // Let the boot-time sync storm drain before any scenario resets the counters.
      await sleep(3500);
    },
    // Each scenario starts from a fresh load so earlier scenarios cannot warm state.
    async settle(expectSection) {
      await page.reload();
      const section = await page.eval("window.__nfSection()");
      if (expectSection && section !== expectSection) {
        throw new Error("runtime did not land on " + expectSection + " after load (got " + section + ")");
      }
    },
    read: () => page.eval("window.__nfReadBudget()"),
    close: () => cdp.send("Target.closeTarget", { targetId })
  };
  return page;
}

function loadSnapshot() {
  if (!fs.existsSync(SNAPSHOT_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8")); } catch { return null; }
}

async function main() {
  if (!(await waitForRuntime())) {
    console.error("FAIL runtime not serving at " + RUNTIME_URL + " - start it with: npm run dev");
    process.exit(2);
  }

  const chrome = await launchChrome();
  let cdp = null;
  let page = null;
  const results = [];
  try {
    cdp = await connect(chrome.wsUrl);
    page = await openPage(cdp);
    for (const scenario of SCENARIOS) {
      await scenario.run(page);
      const counts = await page.read();
      results.push({ name: scenario.name, title: scenario.title, metrics: scenario.metrics, counts });
    }
  } finally {
    if (page) { try { await page.close(); } catch {} }
    if (cdp) { try { cdp.close(); } catch {} }
    try { chrome.child.kill(); } catch {}
    try { fs.rmSync(chrome.profile, { recursive: true, force: true }); } catch {}
  }

  const measured = {};
  for (const r of results) {
    measured[r.name] = {};
    for (const m of r.metrics) measured[r.name][m] = r.counts[m] || 0;
  }

  if (UPDATE) {
    const snapshot = {
      note: "DOM write budgets for the locked 4783 runtime. Re-record with: node scripts/check-runtime-write-budget.mjs --update",
      tolerance: TOLERANCE,
      recordedAt: new Date().toISOString().slice(0, 10),
      scenarios: measured
    };
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2) + "\n");
    console.log("recorded budgets -> " + path.relative(repoRoot, SNAPSHOT_PATH));
    for (const r of results) {
      console.log("  " + r.title);
      for (const m of r.metrics) console.log("    " + m.padEnd(12) + " " + measured[r.name][m]);
    }
    return;
  }

  const snapshot = loadSnapshot();
  if (!snapshot) {
    console.error("FAIL no budget snapshot; record one with: node scripts/check-runtime-write-budget.mjs --update");
    process.exit(2);
  }

  const tolerance = typeof snapshot.tolerance === "number" ? snapshot.tolerance : TOLERANCE;
  const failures = [];
  const report = [];
  for (const r of results) {
    const budget = snapshot.scenarios ? snapshot.scenarios[r.name] : null;
    if (!budget) { failures.push(r.name + ": no recorded budget"); continue; }
    for (const m of r.metrics) {
      const actual = measured[r.name][m];
      const recorded = budget[m];
      if (typeof recorded !== "number") continue;
      const limit = Math.ceil(recorded * (1 + tolerance)) + 5;
      const ok = actual <= limit;
      report.push({ scenario: r.name, title: r.title, metric: m, actual, recorded, limit, ok });
      if (!ok) failures.push(r.title + " / " + m + ": " + actual + " > " + limit + " (recorded " + recorded + ")");
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: failures.length === 0, tolerance, report }, null, 2));
  } else {
    let current = null;
    for (const row of report) {
      if (row.title !== current) { current = row.title; console.log("\n" + current); }
      const mark = row.ok ? "ok  " : "FAIL";
      const delta = row.recorded
        ? (row.actual >= row.recorded ? "+" : "") + (((row.actual - row.recorded) / row.recorded) * 100).toFixed(1) + "%"
        : "-";
      console.log("  " + mark + " " + row.metric.padEnd(12) + String(row.actual).padStart(7)
        + "  budget " + String(row.limit).padStart(7) + "  (baseline " + row.recorded + ", " + delta + ")");
    }
  }

  if (failures.length) {
    console.error("\nFAIL " + failures.length + " metric(s) over budget:");
    for (const f of failures) console.error("  - " + f);
    console.error("\nIf this is an intended behaviour change, re-record with --update.");
    process.exit(1);
  }
  console.log("\nPASS all DOM write budgets met");
}

main().catch((err) => {
  console.error("FAIL " + ((err && (err.stack || err.message)) || err));
  process.exit(2);
});
