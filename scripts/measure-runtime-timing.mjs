#!/usr/bin/env node
// Wall-clock timing for the locked 4783 runtime.
//
// The write budget check counts DOM operations, which is a proxy for cost. This one asks the
// engine directly: Chromium's Performance domain reports how long it actually spent in script,
// style recalculation and layout, and how many of each it ran. Use it to answer "did that
// change make anything faster", which an operation count cannot answer on its own.
//
//   node scripts/measure-runtime-timing.mjs             measure and print
//   node scripts/measure-runtime-timing.mjs --json      machine-readable
//   node scripts/measure-runtime-timing.mjs --label X   tag the run (e.g. baseline / fixed)
//
// Requires the 4783 preview runtime to be serving (npm run dev).

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const require = createRequire(path.join(repoRoot, "particle-editor-desktop", "package.json"));
const WebSocket = require("ws");

const RUNTIME_URL = "http://127.0.0.1:4783/";
const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const LABEL = (() => { const i = args.indexOf("--label"); return i >= 0 ? args[i + 1] : "run"; })();
const REPEATS = (() => { const i = args.indexOf("--repeats"); return i >= 0 ? Number(args[i + 1]) : 3; })();

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome"
];

// Engine-side timers, in seconds of CPU spent, plus how many passes ran.
const TIMERS = ["ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskDuration"];
const COUNTERS = ["LayoutCount", "RecalcStyleCount"];

const SWITCH = `(label) => {
  const button = Array.from(document.querySelectorAll("[data-novaflow-primary-entry]"))
    .find((b) => b.getAttribute("data-novaflow-primary-label") === label);
  const rect = button.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, composed: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0, pointerId: 1, isPrimary: true };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    button.dispatchEvent(new Ctor(type, Object.assign({}, init, { buttons: type.endsWith("down") ? 1 : 0 })));
  }
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
}

async function killTree(child) {
  if (!child) return;
  if (process.platform === "win32" && child.pid) {
    await new Promise((res) => { const k = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); k.on("exit", res); k.on("error", res); });
  }
  try { child.kill("SIGKILL"); } catch {}
  await sleep(600);
}

async function main() {
  const bin = CHROME_CANDIDATES.find((c) => fs.existsSync(c));
  if (!bin) throw new Error("Chrome not found");
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nf-timing-"));
  const child = spawn(bin, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--window-size=1280,800", "--no-first-run", "--disable-extensions",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows", "about:blank"
  ], { stdio: "ignore" });

  let wsUrl = null;
  for (let i = 0; i < 80 && !wsUrl; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl; } catch {}
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) { await killTree(child); throw new Error("no devtools endpoint"); }

  const pending = new Map();
  let nextId = 1;
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
  await new Promise((r) => ws.on("open", r));
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const e = pending.get(m.id); pending.delete(m.id); m.error ? e.rej(new Error(m.error.message)) : e.res(m.result); }
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error("timeout " + method)); } }, 60000);
  });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Performance.enable", {}, sessionId);

  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const metrics = async () => {
    const { metrics: list } = await send("Performance.getMetrics", {}, sessionId);
    const out = {};
    for (const m of list) if (TIMERS.includes(m.name) || COUNTERS.includes(m.name)) out[m.name] = m.value;
    return out;
  };
  const delta = (a, b) => {
    const out = {};
    for (const k of Object.keys(b)) out[k] = TIMERS.includes(k) ? +((b[k] - a[k]) * 1000).toFixed(1) : b[k] - a[k];
    return out;
  };
  const section = () => ev(`document.body ? (document.body.className.match(/novaflow-primary-target-(\\w+)/)||[])[1] : null`);

  const load = async () => {
    await send("Page.navigate", { url: RUNTIME_URL }, sessionId);
    await sleep(1500);
    for (let i = 0; i < 80; i++) {
      const ready = await ev(`!!(document.body && document.body.classList.contains('novaflow-brand-runtime-ready'))`).catch(() => false);
      if (ready) break;
      await sleep(250);
    }
    await sleep(6000); // let the boot storm finish
  };

  const samples = { boot: [], idle: [], toAnimation: [], toArt: [] };

  for (let rep = 0; rep < REPEATS; rep++) {
    // Boot: navigate and measure everything up to a settled first paint.
    const beforeBoot = await metrics();
    const bootStart = Date.now();
    await load();
    samples.boot.push({ ...delta(beforeBoot, await metrics()), wallMs: Date.now() - bootStart });

    // Idle: the app is doing nothing the user asked for.
    await ev(`window.__nfSwitchFn = ${SWITCH}; 1`);
    const beforeIdle = await metrics();
    await sleep(15000);
    samples.idle.push({ ...delta(beforeIdle, await metrics()), wallMs: 15000 });

    // Switch to animation, then to art. Wall time is measured to a settled DOM.
    for (const [key, label, expect] of [["toAnimation", "动画", "animation"], ["toArt", "美工", "art"]]) {
      const before = await metrics();
      const started = Date.now();
      await ev(`window.__nfSwitchFn(${JSON.stringify(label)})`);
      // Wait until the DOM stops changing, which is when the switch is visually done.
      await ev(`new Promise((resolve) => {
        let quiet = 0;
        const observer = new MutationObserver(() => { quiet = 0; });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        const timer = setInterval(() => {
          quiet += 1;
          if (quiet >= 6) { clearInterval(timer); observer.disconnect(); resolve(1); }
        }, 100);
        setTimeout(() => { clearInterval(timer); observer.disconnect(); resolve(0); }, 12000);
      })`);
      const wallMs = Date.now() - started - 600; // subtract the quiet-confirmation window
      const landed = await section();
      if (landed !== expect) throw new Error(`switch to ${expect} failed (got ${landed})`);
      samples[key].push({ ...delta(before, await metrics()), wallMs });
    }
  }

  ws.close();
  await killTree(child);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}

  const median = (values) => {
    const v = [...values].sort((a, b) => a - b);
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : +((v[mid - 1] + v[mid]) / 2).toFixed(1);
  };
  const summarise = (list) => {
    const out = {};
    for (const k of Object.keys(list[0])) out[k] = median(list.map((s) => s[k]));
    return out;
  };
  const result = { label: LABEL, repeats: REPEATS, scenarios: {} };
  for (const [k, list] of Object.entries(samples)) result.scenarios[k] = summarise(list);

  if (JSON_OUT) { console.log(JSON.stringify(result, null, 2)); return; }
  const TITLES = { boot: "启动到首帧稳定", idle: "空闲 15 秒", toAnimation: "切换 特效 -> 动画", toArt: "切换 动画 -> 美工" };
  console.log(`\n=== ${LABEL} (median of ${REPEATS}) ===`);
  console.log("场景".padEnd(22) + "墙钟ms".padStart(9) + "脚本ms".padStart(9) + "样式重算ms".padStart(12) + "布局ms".padStart(9) + "样式次".padStart(9) + "布局次".padStart(9));
  for (const [k, v] of Object.entries(result.scenarios)) {
    console.log(
      TITLES[k].padEnd(20) +
      String(v.wallMs).padStart(9) +
      String(v.ScriptDuration).padStart(9) +
      String(v.RecalcStyleDuration).padStart(12) +
      String(v.LayoutDuration).padStart(9) +
      String(v.RecalcStyleCount).padStart(9) +
      String(v.LayoutCount).padStart(9)
    );
  }
}

main().catch((e) => { console.error("FAIL " + (e?.stack || e)); process.exit(1); });
