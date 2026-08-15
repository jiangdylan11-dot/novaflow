const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const runtimePath = path.join(root, "particle-editor", "novaflow-brand-runtime.js");
const source = fs.readFileSync(runtimePath, "utf8");

function extractNamedFunction(input, name) {
  const asyncStart = input.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : input.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const signatureEnd = input.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `${name} should have a body`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(start, index + 1);
    }
  }
  throw new Error(`${name} body is incomplete`);
}

function createRecoveryHarness() {
  let now = 1000;
  const context = vm.createContext({
    Date: { now: () => now },
    updateTopbarAiRuntimeStatus: () => {},
  });
  vm.runInContext(`
    const TOPBAR_AI_RUNTIME_DISCONNECTED_GRACE_MS = 30000;
    const TOPBAR_AI_RUNTIME_ENSURE_TIMEOUT_MS = 120000;
    const TOPBAR_AI_RUNTIME_ENSURE_BACKOFF_MS = [30000, 60000, 120000, 300000];
    let topbarAiRuntimeEnsurePromise = null;
    let topbarAiRuntimeDisconnectedSince = 0;
    let topbarAiRuntimeEnsureFailureCount = 0;
    let topbarAiRuntimeNextEnsureAt = 0;
    ${extractNamedFunction(source, "isTopbarAiRuntimeConnected")}
    ${extractNamedFunction(source, "topbarAiRuntimeStatusPresentation")}
    ${extractNamedFunction(source, "noteTopbarAiRuntimeStatus")}
    ${extractNamedFunction(source, "topbarAiRuntimeEnsureBackoffMs")}
    ${extractNamedFunction(source, "maybeEnsureTopbarAiRuntimeStarted")}
    this.maybeEnsure = maybeEnsureTopbarAiRuntimeStarted;
    this.presentation = topbarAiRuntimeStatusPresentation;
    this.recoverySnapshot = () => ({
      disconnectedSince: topbarAiRuntimeDisconnectedSince,
      failureCount: topbarAiRuntimeEnsureFailureCount,
      nextEnsureAt: topbarAiRuntimeNextEnsureAt,
      inFlight: !!topbarAiRuntimeEnsurePromise,
    });
  `, context);
  return {
    context,
    setNow(value) { now = value; },
  };
}

test("topbar exposes connected, starting, and disconnected presentation states", () => {
  const { context } = createRecoveryHarness();
  assert.equal(context.presentation({ status: "running", running: true }).label, "AI \u5df2\u8fde\u63a5");
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.presentation({ status: "starting", running: false }))),
    { phase: "starting", label: "AI \u542f\u52a8\u4e2d", color: "rgba(250, 204, 21, 0.95)" },
  );
  assert.equal(context.presentation({ status: "stopped", running: false }).label, "AI \u672a\u8fde\u63a5");
});

test("topbar recovery waits for grace, uses one in-flight ensure, and backs off retries", async () => {
  const { context, setNow } = createRecoveryHarness();
  const stopped = { ok: false, installed: true, status: "stopped", running: false, connected: false };
  let ensureCalls = 0;
  let resolveEnsure;
  const api = {
    runtimeEnsureStarted: () => {
      ensureCalls += 1;
      return new Promise((resolve) => { resolveEnsure = resolve; });
    },
  };

  await context.maybeEnsure(stopped, api, 1000);
  setNow(30999);
  await context.maybeEnsure(stopped, api, 30999);
  assert.equal(ensureCalls, 0, "disconnect grace must suppress early starts");

  setNow(31000);
  const first = context.maybeEnsure(stopped, api, 31000);
  const duplicate = context.maybeEnsure(stopped, api, 31000);
  assert.equal(ensureCalls, 1, "concurrent refreshes must share one ensure request");
  assert.equal(context.recoverySnapshot().inFlight, true);
  resolveEnsure(stopped);
  await Promise.all([first, duplicate]);
  assert.equal(context.recoverySnapshot().failureCount, 1);
  assert.equal(context.recoverySnapshot().nextEnsureAt, 61000);

  setNow(60999);
  await context.maybeEnsure(stopped, api, 60999);
  assert.equal(ensureCalls, 1, "retry backoff must suppress the next 15-second poll");
});

test("topbar recovery never ensures while Runtime reports starting or missing", async () => {
  const { context } = createRecoveryHarness();
  let ensureCalls = 0;
  const api = { runtimeEnsureStarted: async () => { ensureCalls += 1; return { status: "running" }; } };
  await context.maybeEnsure({ installed: true, status: "starting" }, api, 90000);
  await context.maybeEnsure({ installed: false, status: "missing" }, api, 190000);
  assert.equal(ensureCalls, 0);
});

test("topbar refresh invokes the guarded recovery path after every status probe", () => {
  const refreshSource = extractNamedFunction(source, "refreshTopbarAiRuntimeStatus");
  const updateSource = extractNamedFunction(source, "updateTopbarAiRuntimeStatus");
  assert.match(refreshSource, /runtimeGetStatus\(\{ probe: true,/);
  assert.match(refreshSource, /await maybeEnsureTopbarAiRuntimeStarted\(nextStatus, api\)/);
  assert.match(refreshSource, /await maybeEnsureTopbarAiRuntimeStarted\(failed, api\)/);
  assert.match(updateSource, /data-novaflow-topbar-ai-runtime-phase/);
  assert.match(source, /TOPBAR_AI_RUNTIME_ENSURE_BACKOFF_MS = \[30000, 60000, 120000, 300000\]/);
});
