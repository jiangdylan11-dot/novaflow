const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const mainSource = fs.readFileSync(path.join(root, "particle-editor-desktop", "main.js"), "utf8");
const requestStart = mainSource.indexOf("async function requestPromptAssistant");
const requestEnd = mainSource.indexOf("async function probeNovaFlowRuntime", requestStart);
assert.ok(requestStart >= 0 && requestEnd > requestStart, "requestPromptAssistant must remain independently testable");
const requestSource = mainSource.slice(requestStart, requestEnd).trim();

assert.match(requestSource, /const leaseRequired = command !== "status"/);
assert.match(requestSource, /errorCode: "prompt-assistant-busy"/);
assert.match(requestSource, /promptAssistantRequestLease = requestLease[\s\S]*?await options\.beforeEnsure\(\)/,
  "a non-status request must acquire its lease before the first preflight await");
assert.match(requestSource, /await stopPromptAssistantServiceWithVerifiedResult\(\)[\s\S]*?promptAssistantRequestLease = null/,
  "verified cleanup must finish before the request lease is released");

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

async function flushAsyncWork() {
  await new Promise(setImmediate);
}

(async () => {
  const pending = new Map();
  const preflightGate = deferred();
  const ensureGate = deferred();
  const cleanupGate = deferred();
  const writes = [];
  let ensureCalls = 0;
  let cleanupCalls = 0;

  const processStub = {
    pid: 4242,
    stdin: {
      write(line) {
        const request = JSON.parse(line);
        writes.push(request);
        const entry = pending.get(request.id);
        assert.ok(entry, "stdin writes must target a registered request");
        pending.delete(request.id);
        clearTimeout(entry.timer);
        entry.resolve({ prompt: `result-${request.id}` });
      }
    }
  };

  const context = vm.createContext({
    getPromptAssistantConfig: () => ({ serviceExists: true, modelExists: true, enabled: true }),
    isPromptAssistantStaticImageReverseRequest: () => false,
    isPromptAssistantMiniMaxH3ReverseRequest: () => false,
    ensurePromptAssistantProcess: async () => {
      ensureCalls += 1;
      if (ensureCalls === 1) return await ensureGate.promise;
      return processStub;
    },
    promptAssistantNextRequestId: 1,
    promptAssistantPending: pending,
    promptAssistantBusy: false,
    promptAssistantRequestLease: null,
    promptAssistantNextLeaseId: 1,
    promptAssistantLastError: "",
    promptAssistantLastWarning: "",
    appendLogLine: () => {},
    stopPromptAssistantServiceSync: () => {},
    stopPromptAssistantServiceWithVerifiedResult: async () => {
      cleanupCalls += 1;
      if (cleanupCalls === 1) return await cleanupGate.promise;
      return "stopped";
    },
    promptAssistantFailureMetadata: () => ({}),
    setTimeout,
    clearTimeout
  });
  const requestPromptAssistant = vm.runInContext(`(${requestSource})`, context);

  const firstPromise = requestPromptAssistant("optimizePrompt", { prompt: "first" }, 120_000, {
    beforeEnsure: async () => await preflightGate.promise,
    verifiedCleanup: true
  });
  assert.equal(context.promptAssistantBusy, true);
  assert.equal(context.promptAssistantRequestLease?.command, "optimizePrompt");

  const preflightConcurrent = await requestPromptAssistant("reverseImagePrompt", { prompt: "second" }, 120_000, {
    verifiedCleanup: true
  });
  assert.equal(preflightConcurrent.ok, false);
  assert.equal(preflightConcurrent.errorCode, "prompt-assistant-busy");
  assert.equal(preflightConcurrent.failureCategory, "resource_busy");
  assert.equal(preflightConcurrent.retryable, true);
  assert.equal(ensureCalls, 0, "the rejected request must not start a second cold-start ensure");
  assert.equal(writes.length, 0);

  preflightGate.resolve({ ok: true, timeoutMs: 100_000 });
  await flushAsyncWork();
  assert.equal(ensureCalls, 1);

  const coldStartConcurrent = await requestPromptAssistant("optimizePrompt", { prompt: "third" }, 120_000, {
    verifiedCleanup: true
  });
  assert.equal(coldStartConcurrent.errorCode, "prompt-assistant-busy");
  assert.equal(ensureCalls, 1, "cold-start concurrency must not double-spawn the child");
  assert.equal(writes.length, 0, "cold-start concurrency must not double-write stdin");

  ensureGate.resolve(processStub);
  await flushAsyncWork();
  assert.equal(writes.length, 1);
  assert.equal(cleanupCalls, 1);

  const cleanupConcurrent = await requestPromptAssistant("reverseImagePrompt", { prompt: "fourth" }, 120_000, {
    verifiedCleanup: true
  });
  assert.equal(cleanupConcurrent.errorCode, "prompt-assistant-busy");
  assert.equal(writes.length, 1, "the lease must remain held throughout verified cleanup");

  cleanupGate.resolve("stopped");
  const firstResult = await firstPromise;
  assert.equal(firstResult.ok, true);
  assert.equal(context.promptAssistantRequestLease, null);
  assert.equal(context.promptAssistantBusy, false);

  const afterCleanup = await requestPromptAssistant("reverseImagePrompt", { prompt: "fifth" }, 120_000, {
    verifiedCleanup: true
  });
  assert.equal(afterCleanup.ok, true);
  assert.equal(ensureCalls, 2);
  assert.equal(writes.length, 2, "the next request may write only after the prior cleanup releases its lease");
  assert.equal(cleanupCalls, 2);
  assert.equal(context.promptAssistantRequestLease, null);
  assert.equal(context.promptAssistantBusy, false);

  console.log("prompt-assistant-request-lease-contract: passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
