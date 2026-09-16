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

// A scenario either measures a steady state - report the median per-second delta, which a
// periodic burst cannot skew - or a one-off transition, where the total work is the point.
const SCENARIOS = [
  {
    name: "particle-idle-rate",
    title: "特效区空闲（每秒中位数）",
    // Nobody is touching the app. The rAF render loop keeps a steady floor of real writes,
    // but every no-op write here is the runtime talking to itself for nothing.
    metrics: ["style", "styleNoop", "attr", "attrNoop", "gbcr", "gcs", "qsa"],
    async run(page) {
      await page.settle("particle");
      return median(await page.sample(1000, 15));
    }
  },
  {
    name: "switch-particle-to-animation",
    // The runtime fires a full-sync burst roughly every 15s. It is additive noise that can
    // land inside the measured window, so run twice and keep the lower, burst-free run.
    repeat: 2,
    title: "分区切换 特效 -> 动画（总量）",
    metrics: ["style", "styleNoop", "attr", "attrNoop", "gbcr", "gcs", "qsa", "qsaNodes"],
    async run(page) {
      await page.settle("particle");
      await page.eval("window.__nfResetBudget()");
      await page.runUntilSettled("window.__nfSwitch('动画')");
      const landed = await page.eval("window.__nfSection()");
      if (landed !== "animation") throw new Error("switch did not land on animation (got " + landed + ")");
      return page.read();
    }
  },
  {
    name: "switch-animation-to-art",
    // The runtime fires a full-sync burst roughly every 15s. It is additive noise that can
    // land inside the measured window, so run twice and keep the lower, burst-free run.
    repeat: 2,
    title: "分区切换 动画 -> 美工（总量）",
    metrics: ["style", "styleNoop", "attr", "attrNoop", "gbcr", "gcs", "qsa", "qsaNodes"],
    async run(page) {
      await page.settle("particle");
      await page.runUntilSettled("window.__nfSwitch('动画')");
      await page.eval("window.__nfResetBudget()");
      await page.runUntilSettled("window.__nfSwitch('美工')");
      const landed = await page.eval("window.__nfSection()");
      if (landed !== "art") throw new Error("switch did not land on art (got " + landed + ")");
      return page.read();
    }
  }
];

// Median per key across samples. Immune to the periodic full-sync burst the runtime fires
// roughly every 15 seconds, which a mean would smear differently across every run.
// Keep the lowest value seen per metric. The periodic burst only ever adds work, so the
// lowest run is the one it missed.
function lowestPerKey(runs) {
  const out = {};
  for (const run of runs) {
    for (const k of Object.keys(run)) {
      if (typeof run[k] !== "number") continue;
      out[k] = out[k] === undefined ? run[k] : Math.min(out[k], run[k]);
    }
  }
  return out;
}

function median(deltas) {
  const out = {};
  const keys = new Set();
  for (const d of deltas) for (const k of Object.keys(d)) keys.add(k);
  for (const k of keys) {
    const values = deltas.map((d) => d[k] || 0).sort((x, y) => x - y);
    const mid = Math.floor(values.length / 2);
    out[k] = values.length % 2 ? values[mid] : Math.round((values[mid - 1] + values[mid]) / 2);
  }
  return out;
}

// child.kill() only reaps the launcher on Windows; the renderer and GPU processes survive,
// keep the profile directory locked, and steal CPU from whatever runs next.
async function killTree(child) {
  if (!child) return;
  const pid = child.pid;
  if (process.platform === "win32" && pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
  }
  try { child.kill("SIGKILL"); } catch {}
  // Give the OS a moment to release the profile files before anyone deletes them.
  await sleep(600);
}

async function removeDirWithRetry(dir) {
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return true; }
    catch { await sleep(400); }
  }
  return false;
}

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
  await killTree(child);
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
      // Wait for the boot storm to actually drain. A fixed sleep is not enough: under
      // machine load the tail of boot bleeds into the scenario and inflates every metric.
      await page.waitSettled({ maxMs: 30000 });
    },
    // Each scenario starts from a fresh load so earlier scenarios cannot warm state.
    async settle(expectSection) {
      await page.reload();
      const section = await page.eval("window.__nfSection()");
      if (expectSection && section !== expectSection) {
        throw new Error("runtime did not land on " + expectSection + " after load (got " + section + ")");
      }
    },
    // Sample the counters on a fixed cadence and return the per-interval deltas.
    async sample(intervalMs, count) {
      const deltas = [];
      let prev = await page.eval("window.__nfReadBudget()");
      for (let i = 0; i < count; i++) {
        await sleep(intervalMs);
        const now = await page.eval("window.__nfReadBudget()");
        const delta = {};
        for (const k of Object.keys(now)) if (typeof now[k] === "number") delta[k] = now[k] - prev[k];
        deltas.push(delta);
        prev = now;
      }
      return deltas;
    },
    // The runtime never goes quiet: a rAF render loop keeps a steady ~100 style writes/s
    // going forever. What does end is the boot storm, which runs thousands of writes/s for
    // a few seconds. So wait for the rate to fall back to that steady floor, not for zero.
    async waitSettled(opts) {
      const maxMs = (opts && opts.maxMs) || 30000;
      const floor = (opts && opts.floor) || 1500;
      const needed = 4;
      const began = Date.now();
      let calm = 0;
      let prev = await page.eval("window.__nfReadBudget()");
      while (Date.now() - began < maxMs) {
        await sleep(250);
        const now = await page.eval("window.__nfReadBudget()");
        // Watch every counter, not just style: the art section settles its writes long
        // before it stops measuring layout, and gating on style alone let gbcr drift.
        const busy = (now.style - prev.style) + (now.attr - prev.attr)
          + (now.gbcr - prev.gbcr) + (now.gcs - prev.gcs) + (now.qsa - prev.qsa);
        prev = now;
        calm = busy * 4 <= floor ? calm + 1 : 0;
        if (calm >= needed) return Date.now() - began;
      }
      return Date.now() - began;
    },
    // A section switch is a burst by nature. Run it, then wait for the rate to drop back to
    // the steady floor, so the measurement is the work it took to finish the switch rather
    // than whatever fitted inside an arbitrary window - the latter moves with machine load.
    async runUntilSettled(expression) {
      await page.eval(expression);
      await page.waitSettled();
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
      const began = Date.now();
      const runs = [];
      for (let attempt = 0; attempt < (scenario.repeat || 1); attempt++) runs.push(await scenario.run(page));
      const counts = runs.length === 1 ? runs[0] : lowestPerKey(runs);
      // Duration is diagnostic only, never budgeted. A scenario that suddenly takes much
      // longer usually means the machine was busy, not that the runtime regressed.
      results.push({ name: scenario.name, title: scenario.title, metrics: scenario.metrics, counts, ms: Date.now() - began });
    }
  } finally {
    if (page) { try { await page.close(); } catch {} }
    if (cdp) { try { cdp.close(); } catch {} }
    await killTree(chrome.child);
    await removeDirWithRetry(chrome.profile);
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
      console.log("  " + r.title + "   [" + (r.ms / 1000).toFixed(1) + "s]");
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
      if (row.title !== current) {
        current = row.title;
        const scenarioRow = results.find((x) => x.title === current);
        console.log("");
        console.log(current + (scenarioRow ? "   [" + (scenarioRow.ms / 1000).toFixed(1) + "s]" : ""));
      }
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
