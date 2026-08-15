const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const smartAiSource = fs.readFileSync(path.join(root, "particle-editor", "novaflow-smart-ai.js"), "utf8");
const mainSource = fs.readFileSync(path.join(root, "particle-editor-desktop", "main.js"), "utf8");
const serviceSource = fs.readFileSync(path.join(root, "particle-editor-desktop", "prompt-assistant-service.py"), "utf8");
const previewPath = path.join(root, "tools", "preview_runtime_server.py");
const previewSource = fs.readFileSync(previewPath, "utf8");

assert.match(
  smartAiSource,
  /!useGrok\s*&&\s*isOptimizeRequest\s*&&\s*!roleAwareReferences\s*&&\s*supportsNegativePrompt\s*&&\s*\(!parsed\.hasNegativePrompt\s*\|\|\s*!String\(nextNegativePrompt/,
  "plain local optimization must require a negative prompt without rejecting role-aware image results"
);
assert.match(smartAiSource, /本地模型未返回反向提示词，请重试/);
const optimizeHandler = mainSource.match(/ipcMain\.handle\("prompt-assistant-optimize-prompt"[\s\S]*?\n\}\);\r?\n/)?.[0] || "";
function extractNamedFunction(source, name) {
  const marker = `function ${name}(`;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${name} must exist`);
  const start = source.slice(Math.max(0, markerIndex - 6), markerIndex) === "async " ? markerIndex - 6 : markerIndex;
  const bodyStart = source.indexOf("{", source.indexOf(")", markerIndex) + 1);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} is incomplete`);
}
const prepareResourceHandoffSource = extractNamedFunction(mainSource, "prepareOrdinaryArtPromptPatchResourceHandoff");
const inspectRuntimeQueueSource = extractNamedFunction(mainSource, "inspectNovaFlowRuntimeQueue");
assert.match(prepareResourceHandoffSource, /queueState\.state === "busy"[\s\S]*?runtime-generation-busy/);
assert.match(prepareResourceHandoffSource, /requestNovaFlowRuntimeFreeMemory[\s\S]*?verifiedQueueState = await inspectNovaFlowRuntimeQueue/);
const bridgedOptimizePayloads = [];
const bridgedOptimizeTimeouts = [];
const resourceHandoffCalls = [];
const promptAssistantStopResults = [];
let nextStopResult = "stopped";
let nextResourceHandoff = {
  ok: true,
  state: "runtime-memory-released",
  runtimeAvailable: true,
  released: true,
  running: 0,
  pending: 0
};
const verifiedStopStub = async () => {
  promptAssistantStopResults.push(nextStopResult);
  return nextStopResult;
};
let desktopOptimizeHandler = null;
vm.runInNewContext(optimizeHandler, {
  ipcMain: {
    handle(_channel, handler) {
      desktopOptimizeHandler = handler;
    }
  },
  normalizePromptAssistantProvider: () => "local",
  isOrdinaryLocalArtPromptPatchRequest: ({ provider, surface, purpose, currentPrompt }) => (
    provider === "local"
      && String(purpose || "").toLowerCase() === "optimize"
      && Boolean(String(currentPrompt || "").trim())
      && ["", "art", "drawing", "image"].includes(String(surface || "").toLowerCase())
  ),
  promptAssistantOptimizeRequirementsLimit: () => 2000,
  prepareOrdinaryArtPromptPatchResourceHandoff: async () => {
    resourceHandoffCalls.push("prepare");
    return nextResourceHandoff;
  },
  traceOrdinaryArtPromptPatchStage() {},
  requestPromptAssistant: async (_command, payload, timeoutMs, options = {}) => {
    let effectiveTimeoutMs = timeoutMs;
    if (typeof options.beforeEnsure === "function") {
      const preflight = await options.beforeEnsure();
      if (preflight?.ok === false) return preflight.response;
      if (Number.isFinite(Number(preflight?.timeoutMs))) {
        effectiveTimeoutMs = Number(preflight.timeoutMs);
      }
    }
    bridgedOptimizePayloads.push(payload);
    bridgedOptimizeTimeouts.push(effectiveTimeoutMs);
    if (options.verifiedCleanup === true) {
      const stopResult = await verifiedStopStub();
      if (stopResult === "stop-timeout" || stopResult === "stop-error") {
        return {
          ok: false,
          errorCode: stopResult === "stop-timeout"
            ? "prompt-assistant-stop-timeout"
            : "prompt-assistant-stop-failed"
        };
      }
    }
    return { ok: true, data: {} };
  },
  stopPromptAssistantServiceWithVerifiedResult: verifiedStopStub,
  appendLogLine() {}
});
assert.equal(typeof desktopOptimizeHandler, "function");
assert.match(
  optimizeHandler,
  /"prompt-assistant-optimize-result"[\s\S]*?positiveChars:[\s\S]*?negativeChars:/,
  "local prompt optimization should log output lengths without prompt bodies"
);
const diagnosticMarker = optimizeHandler.indexOf('"prompt-assistant-optimize-result"');
assert.notEqual(diagnosticMarker, -1);
const diagnosticBlock = optimizeHandler.slice(diagnosticMarker, diagnosticMarker + 700);
assert.doesNotMatch(diagnosticBlock, /\bprompt\s*,|\bnegativePrompt\s*,|\brequirements\s*,|\bcurrentPrompt\s*,/);

const previewProbe = spawnSync("python", ["-B", "-c", String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("preview_runtime_server", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
build = module._prompt_assistant_optimize_payload
print(json.dumps([
    build({"supportsNegativePrompt": False})["supportsNegativePrompt"],
    build({"supportsNegativePrompt": True})["supportsNegativePrompt"],
    build({})["supportsNegativePrompt"],
    build({"nsfw": True})["nsfw"],
    build({"nsfw": False})["nsfw"],
    build({})["nsfw"],
]))
`, previewPath], { encoding: "utf8" });
assert.equal(previewProbe.status, 0, previewProbe.stderr || previewProbe.stdout);
assert.deepEqual(JSON.parse(previewProbe.stdout.trim()), [false, true, true, true, false, false]);
assert.match(previewSource, /optimize_timeout = 300[\s\S]*?remaining_seconds = 300 - \(time\.monotonic\(\) - optimize_started\) - 18\.5/,
  "Preview must keep the ordinary Art edit handoff, inference, and cleanup inside one 300-second budget");
assert.match(
  serviceSource,
  /negative_prompt\s*=\s*build_targeted_negative_prompt\([\s\S]*?if not negative_prompt:[\s\S]*?raise ValueError\("模型未返回可用的负向关键词"\)/,
  "the local service must guarantee a non-empty targeted negative prompt"
);
const reverseHandler = serviceSource.match(/def reverse_image_prompt\(self, payload: dict\)[\s\S]*?\n\s*def data_url_to_tensor/)?.[0] || "";
assert.match(
  reverseHandler,
  /negative_prompt\s*=\s*build_targeted_negative_prompt\(negative_source, description\)/,
  "local image analysis must derive a targeted negative prompt without a second model generation"
);
assert.match(reverseHandler, /"negativePrompt": negative_prompt/);
assert.match(
  reverseHandler,
  /requirements_preserve_visible_text\(requirements\)[\s\S]*?remove_negative_prompt_keywords\(negative_prompt, \{"logo"\}\)/,
  "structured image reverse must not negate a visible or explicitly preserved logo"
);

(async () => {
  const inspectWithFailure = async (failure) => {
    const inspect = vm.runInNewContext(`(${inspectRuntimeQueueSource})`, {
      sanitizeRuntimeBaseUrl: (value) => value,
      AbortController,
      setTimeout,
      clearTimeout,
      fetch: async () => { throw failure; }
    });
    return await inspect("http://127.0.0.1:8188", 1000);
  };
  const refusedError = new TypeError("fetch failed", { cause: Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" }) });
  const refusedInspection = await inspectWithFailure(refusedError);
  assert.equal(refusedInspection.state, "no-listener");
  assert.equal(refusedInspection.noListener, true);
  const timeoutError = Object.assign(new Error("request timed out"), { name: "AbortError" });
  const timeoutInspection = await inspectWithFailure(timeoutError);
  assert.equal(timeoutInspection.state, "indeterminate");
  assert.equal(timeoutInspection.noListener, false);
  const resetError = new TypeError("fetch failed", { cause: Object.assign(new Error("socket reset"), { code: "ECONNRESET" }) });
  assert.equal((await inspectWithFailure(resetError)).state, "indeterminate");

  const runHandoffCase = async (queueStates, runtimeProcessAlive = false) => {
    const inspections = Array.from(queueStates);
    const freeCalls = [];
    const handoff = vm.runInNewContext(`(${prepareResourceHandoffSource})`, {
      readNovaFlowRuntimeConfig: () => ({ baseUrl: "http://127.0.0.1:8188" }),
      sanitizeRuntimeBaseUrl: (value) => value,
      NOVAFLOW_AI_RUNTIME_DEFAULT_PORT: 8188,
      readNovaFlowRuntimePid: () => runtimeProcessAlive ? 1234 : 0,
      isProcessAlive: () => runtimeProcessAlive,
      inspectNovaFlowRuntimeQueue: async () => inspections.shift(),
      requestNovaFlowRuntimeFreeMemory: async (baseUrl) => {
        freeCalls.push(baseUrl);
        return { ok: true };
      }
    });
    return { result: await handoff(), freeCalls };
  };
  const busyHandoff = await runHandoffCase([
    { ok: true, available: true, state: "busy", running: 1, pending: 2 }
  ]);
  assert.equal(busyHandoff.result.errorCode, "runtime-generation-busy");
  assert.deepEqual(busyHandoff.freeCalls, [], "busy queue must never call Runtime /free");
  const idleHandoff = await runHandoffCase([
    { ok: true, available: true, state: "idle", running: 0, pending: 0 },
    { ok: true, available: true, state: "idle", running: 0, pending: 0 }
  ]);
  assert.equal(idleHandoff.result.state, "runtime-memory-released");
  assert.deepEqual(idleHandoff.freeCalls, ["http://127.0.0.1:8188"]);
  const offlineHandoff = await runHandoffCase([
    { ok: false, available: false, state: "no-listener", noListener: true, error: "connection refused" }
  ]);
  assert.equal(offlineHandoff.result.state, "runtime-unavailable-independent");
  assert.deepEqual(offlineHandoff.freeCalls, []);
  const timeoutHandoff = await runHandoffCase([
    { ok: false, available: false, state: "indeterminate", error: "timeout" }
  ]);
  assert.equal(timeoutHandoff.result.errorCode, "runtime-queue-indeterminate");
  assert.deepEqual(timeoutHandoff.freeCalls, [], "timeout must fail closed before Runtime /free or Prompt Assistant load");
  const aliveRefusedHandoff = await runHandoffCase([
    { ok: false, available: false, state: "no-listener", noListener: true, error: "connection refused" }
  ], true);
  assert.equal(aliveRefusedHandoff.result.errorCode, "runtime-queue-indeterminate");
  const racedHandoff = await runHandoffCase([
    { ok: true, available: true, state: "idle", running: 0, pending: 0 },
    { ok: true, available: true, state: "busy", running: 0, pending: 1 }
  ]);
  assert.equal(racedHandoff.result.errorCode, "runtime-post-release-queue-not-idle");
  assert.equal(racedHandoff.freeCalls.length, 1);

  await desktopOptimizeHandler(null, { prompt: "base", supportsNegativePrompt: false, nsfw: true });
  await desktopOptimizeHandler(null, { prompt: "base", supportsNegativePrompt: true, nsfw: false });
  await desktopOptimizeHandler(null, { prompt: "base" });
  await desktopOptimizeHandler(null, { prompt: "base", currentPrompt: "base", purpose: "optimize", supportsNegativePrompt: false, nsfw: true });
  await desktopOptimizeHandler(null, { prompt: "base", currentPrompt: "base", purpose: "optimize", surface: "animation", nsfw: true });
  assert.deepEqual(
    bridgedOptimizePayloads.map((payload) => payload.supportsNegativePrompt),
    [false, true, true, false, true],
    "Desktop must preserve explicit false/true and default omitted capability to true"
  );
  assert.deepEqual(
    bridgedOptimizePayloads.map((payload) => payload.nsfw),
    [true, false, false, true, true],
    "Desktop must preserve explicit NSFW true/false and default omitted state to false"
  );
  assert.deepEqual(bridgedOptimizeTimeouts.slice(0, 3), [300000, 300000, 300000]);
  assert.ok(
    bridgedOptimizeTimeouts[3] > 270000 && bridgedOptimizeTimeouts[3] <= 281500,
    "ordinary Art edit inference must use only the remainder of the shared 300-second budget"
  );
  assert.equal(bridgedOptimizeTimeouts[4], 300000);
  assert.deepEqual(resourceHandoffCalls, ["prepare"], "only ordinary local Art edit must hand off Runtime memory");

  const requestCountBeforeBusy = bridgedOptimizePayloads.length;
  nextResourceHandoff = {
    ok: false,
    state: "runtime-generation-busy",
    runtimeAvailable: true,
    released: false,
    running: 1,
    pending: 2,
    errorCode: "runtime-generation-busy",
    error: "busy"
  };
  const busyResult = await desktopOptimizeHandler(null, {
    prompt: "base",
    currentPrompt: "base",
    purpose: "optimize",
    surface: "art",
    provider: "local",
    supportsNegativePrompt: false
  });
  assert.equal(busyResult.ok, false);
  assert.equal(busyResult.errorCode, "runtime-generation-busy");
  assert.equal(bridgedOptimizePayloads.length, requestCountBeforeBusy, "busy Runtime must reject before Prompt Assistant starts");
  assert.deepEqual(resourceHandoffCalls, ["prepare", "prepare"]);
  assert.equal(promptAssistantStopResults.length, 5, "every started optimize inference must wait for verified cleanup");

  nextResourceHandoff = {
    ok: true,
    state: "runtime-unavailable-independent",
    runtimeAvailable: false,
    released: false
  };
  nextStopResult = "stop-timeout";
  const stopTimeoutResult = await desktopOptimizeHandler(null, {
    prompt: "base",
    currentPrompt: "base",
    purpose: "optimize",
    surface: "art",
    provider: "local",
    supportsNegativePrompt: false
  });
  assert.equal(stopTimeoutResult.ok, false);
  assert.equal(stopTimeoutResult.errorCode, "prompt-assistant-stop-timeout");
  assert.equal(promptAssistantStopResults.at(-1), "stop-timeout");
  console.log("prompt-assistant-local-negative-contract: passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
