const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const source = fs.readFileSync(path.resolve(__dirname, "../preload.js"), "utf8");
  const exposed = {};
  const calls = [];
  const observerCalls = [];
  const promptId = "image-price-owner-prompt";
  const failedPromptId = "image-price-failed-prompt";
  const retryPromptId = "image-price-retry-prompt";
  const delayedOutputPromptId = "image-price-delayed-output-prompt";
  const legacyOnlyPromptId = "image-price-legacy-only-prompt";
  let promptRequestCount = 0;
  let commitFailuresRemaining = 0;
  const historyCalls = new Map();
  const postedMessages = [];
  let legacyWaitCalls = 0;
  const contextBridge = {
    exposeInMainWorld(name, value) { exposed[name] = value; },
  };
  const ipcRenderer = {
    async invoke(channel, payload) {
      calls.push({ channel, payload });
      if (channel === "client-auth-login") {
        return { ok: true, session: { token: `${payload.account}-token` } };
      }
      if (channel === "comfyui-workflow-credit-cost") {
        return {
          ok: true,
          pricing: {
            providerKey: "comfyui",
            modelKey: "gemini-3-pro-image-preview",
            taskType: "local_workflow_image",
            workflowNodeType: "GeminiImage2Node",
            known: true,
            estimatedCreditCost: 1.5,
            creditCost: 2,
            pricingStatus: "known",
            pricingSource: "price_badge_v1",
          },
        };
      }
      if (channel === "client-auth-ai-task-authorize") return { ok: true };
      if (channel === "runtime-get-status") return { ok: true, baseUrl: "http://127.0.0.1:8188" };
      if (channel === "client-auth-ai-task-commit-usage") {
        if (commitFailuresRemaining > 0) {
          commitFailuresRemaining -= 1;
          return { ok: false, error: "temporary backend failure" };
        }
        const charge = Number(payload.chargeAmount ?? payload.creditCost ?? 0);
        const settlementStatus = charge > 0 ? "settled" : "pending_pricing";
        return {
          ok: true,
          settlement: {
            status: settlementStatus,
            charge_amount: charge || null,
            charge_amount_text: charge > 0 ? `${charge.toFixed(6)}` : null,
            credits: charge > 0 ? { deducted: charge, deducted_text: charge.toFixed(6), balance: 3599, balance_text: "3599.000000" } : null,
            provider_budget: charge > 0 ? { deducted: charge, deducted_text: charge.toFixed(6), balance: 8240, balance_text: "8240.000000" } : null,
          },
          credits: charge > 0 ? { deducted: charge, deducted_text: charge.toFixed(6), balance: 3599, balance_text: "3599.000000" } : null,
          providerBudget: charge > 0 ? { deducted: charge, deducted_text: charge.toFixed(6), balance: 8240, balance_text: "8240.000000" } : null,
          pricing: { status: settlementStatus, estimatedCreditCost: Number(payload.estimatedCreditCost || 0) },
        };
      }
      if (channel === "runtime-request-json") {
        const method = String(payload?.init?.method || "GET").toUpperCase();
        if (method === "POST") {
          promptRequestCount += 1;
          const promptIds = [promptId, failedPromptId, retryPromptId, delayedOutputPromptId, legacyOnlyPromptId];
          return {
            ok: true,
            data: {
              prompt_id: promptIds[promptRequestCount - 1] || legacyOnlyPromptId,
            },
          };
        }
        if (String(payload?.path || "").includes(failedPromptId)) {
          return {
            ok: true,
            data: { [failedPromptId]: { status: { completed: true, status_str: "error" }, outputs: {} } },
          };
        }
        const requestedPromptId = decodeURIComponent(String(payload?.path || "").split("/").pop() || promptId);
        const historyCount = Number(historyCalls.get(requestedPromptId) || 0) + 1;
        historyCalls.set(requestedPromptId, historyCount);
        if (requestedPromptId === delayedOutputPromptId && historyCount === 1) {
          return {
            ok: true,
            data: { [requestedPromptId]: { status: { completed: true, status_str: "success" }, outputs: {} } },
          };
        }
        return {
          ok: true,
          data: {
            [requestedPromptId]: { outputs: { "9": { images: [{ filename: "provider-output.png" }] } } },
          },
        };
      }
      return { ok: true };
    },
    on() {},
    removeListener() {},
    send() {},
  };
  const electron = { contextBridge, ipcRenderer, webUtils: { getPathForFile: () => "" } };
  const document = { addEventListener() {}, elementFromPoint: () => null, querySelectorAll: () => [] };
  const window = { postMessage(message) { postedMessages.push(message); } };
  const loadPreload = new Function("require", "process", "document", "window", source);
  loadPreload((name) => {
    if (name === "electron") return electron;
    if (name === "node:crypto") return { randomUUID: () => "owned-client-id" };
    if (name === "ws") return { WebSocket: class FakeNodeWebSocket {} };
    if (name === "./renderer/art-generate-provider.workflow.js") {
      return {
        createPriceObserver(options) {
          const state = { options, promptId: "", closed: false, observerIndex: observerCalls.length };
          observerCalls.push(state);
          return {
            ready: Promise.resolve(true),
            bindPrompt(value) { state.promptId = String(value || ""); },
            waitForCredits: async () => {
              legacyWaitCalls += 1;
              return 99.9;
            },
            waitForExactPrice: async () => state.observerIndex === 4 ? null : ({
              amountText: "4.270000",
              credits: 4.27,
              exact: true,
              source: "comfy_api_exact_price_v1",
            }),
            close() { state.closed = true; },
          };
        },
      };
    }
    throw new Error(`unexpected preload require: ${name}`);
  }, { platform: "win32" }, document, window);

  const api = exposed.electronAPI;
  assert.equal(
    Object.prototype.hasOwnProperty.call(api, "clientAuthAiTaskCommitUsage"),
    false,
    "desktop renderer must not receive the generic usage-commit bridge"
  );
  assert.equal(api.runtimeCommitProviderUsageActual, undefined, "renderer must not be able to submit a settlement amount");
  assert.equal(api.runtimeProviderUsageSettlement, "preload-price-v1");
  await api.clientAuthLogin({ account: "owner-a", password: "not-sent" });
  const promptResult = await api.runtimeRequestJson({
    baseUrl: "http://localhost:9999",
    path: "/prompt",
    init: {
      method: "POST",
      body: JSON.stringify({
        prompt: {
          "run_a_1": {
            class_type: "GeminiImage2Node",
            inputs: { model: "gemini-3-pro-image-preview", prompt: "test" },
          },
        },
      }),
    },
  });
  assert.equal(promptResult.ok, true);
  const submittedPrompt = calls.find((call) => call.channel === "runtime-request-json" && call.payload?.path === "/prompt");
  assert.equal(JSON.parse(submittedPrompt.payload.init.body).client_id, "novaflow_preload_owned-client-id", "preload must replace renderer client ownership");
  assert.equal(submittedPrompt.payload.baseUrl, "http://127.0.0.1:8188", "the trusted runtime status must override an attacker-controlled loopback port");
  assert.equal(observerCalls[0].options.runtimeBaseUrl, "http://127.0.0.1:8188");
  assert.deepEqual(observerCalls[0].options.providerNodeIds, ["run_a_1"]);
  assert.equal(observerCalls[0].options.requirePromptOwnership, true);
  assert.equal(observerCalls[0].promptId, promptId);
  await api.clientAuthLogin({ account: "owner-b", password: "not-sent" });
  await new Promise((resolve) => setImmediate(resolve));

  const commits = calls.filter((call) => call.channel === "client-auth-ai-task-commit-usage").map((call) => call.payload);
  assert.equal(commits.length, 1, "isolated history settlement should commit the observed Price exactly once");
  const [settled] = commits;
  assert.equal(settled.token, "owner-a-token", "exact Price settlement must remain bound to the submitting account");
  assert.equal(settled.usageKey, `comfyui:${promptId}`);
  assert.equal(settled.taskType, "local_workflow_image");
  assert.equal(settled.modelKey, "gemini-3-pro-image-preview");
  assert.equal(settled.estimatedCreditCost, 4.27);
  assert.equal(settled.creditCost, 4.27);
  assert.equal(settled.chargeAmount, "4.270000");
  assert.equal(settled.parameters.pricingStatus, "known");
  assert.equal(settled.parameters.pricingSource, "comfy_api_exact_price_v1");
  assert.equal(legacyWaitCalls, 0, "legacy human Price frames must not be consumed for settlement");
  assert.equal(observerCalls[0].closed, true, "normal settlement must close the isolated Price observer");
  const settlementMessage = postedMessages.find((message) => message?.type === "novaflow-provider-usage-settled" && message?.payload?.promptId === promptId);
  assert.ok(settlementMessage, "preload should forward a prompt-scoped settlement message");
  assert.equal(settlementMessage.payload.settlement.charge_amount, 4.27);
  assert.equal(settlementMessage.payload.credits.deducted, 4.27);
  assert.equal(settlementMessage.payload.providerBudget.deducted, 4.27);
  assert.equal(settlementMessage.payload.pricing.estimatedCreditCost, 4.27);

  await api.runtimeRequestJson({
    baseUrl: "http://127.0.0.1:8188",
    path: "/prompt",
    init: {
      method: "POST",
      body: JSON.stringify({
        prompt: {
          "run_b_1": {
            class_type: "GeminiImage2Node",
            inputs: { model: "gemini-3-pro-image-preview", prompt: "will fail" },
          },
        },
      }),
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((call) => call.channel === "client-auth-ai-task-commit-usage").length, 1, "failed or cancelled workflows must never deduct credits");
  assert.equal(observerCalls[1].closed, true, "terminal failure must release the isolated Price observer");

  commitFailuresRemaining = 1;
  await api.runtimeRequestJson({
    baseUrl: "http://127.0.0.1:8188",
    path: "/prompt",
    init: {
      method: "POST",
      body: JSON.stringify({
        prompt: {
          "run_c_1": {
            class_type: "GeminiImage2Node",
            inputs: { model: "gemini-3-pro-image-preview", prompt: "retry settlement" },
          },
        },
      }),
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observerCalls[2].closed, false, "transient commit failure must retain the prompt observer for retry");
  const retried = await api.runtimeRequestJson({
    baseUrl: "http://127.0.0.1:8188",
    path: `/history/${retryPromptId}`,
    init: { method: "GET" },
  });
  assert.equal(retried.usageSettlement?.ok, true);
  assert.equal(observerCalls[2].closed, true);

  const commitCountBeforeDelayedOutput = calls.filter((call) => call.channel === "client-auth-ai-task-commit-usage").length;
  await api.runtimeRequestJson({
    baseUrl: "http://127.0.0.1:8188",
    path: "/prompt",
    init: {
      method: "POST",
      body: JSON.stringify({
        prompt: {
          "run_d_1": {
            class_type: "GeminiImage2Node",
            inputs: { model: "gemini-3-pro-image-preview", prompt: "delayed output" },
          },
        },
      }),
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observerCalls[3].closed, false, "completed status without media must retain the settlement owner");
  assert.equal(calls.filter((call) => call.channel === "client-auth-ai-task-commit-usage").length, commitCountBeforeDelayedOutput);
  await api.runtimeRequestJson({
    baseUrl: "http://127.0.0.1:8188",
    path: `/history/${delayedOutputPromptId}`,
    init: { method: "GET" },
  });
  assert.equal(observerCalls[3].closed, true, "the later media-bearing history result should settle and release the owner");

  await api.runtimeRequestJson({
    baseUrl: "http://127.0.0.1:8188",
    path: "/prompt",
    init: {
      method: "POST",
      body: JSON.stringify({
        prompt: {
          "run_e_1": {
            class_type: "GeminiImage2Node",
            inputs: { model: "gemini-3-pro-image-preview", prompt: "legacy price only" },
          },
        },
      }),
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const legacyCommit = calls
    .filter((call) => call.channel === "client-auth-ai-task-commit-usage")
    .map((call) => call.payload)
    .find((payload) => payload.promptId === legacyOnlyPromptId);
  assert.ok(legacyCommit, "a completed old-Runtime job should be recorded as pending pricing");
  assert.equal(legacyCommit.creditCost, 0);
  assert.equal(legacyCommit.estimatedCreditCost, 1.5, "the estimate may be retained for reconciliation but not charged");
  assert.equal(legacyCommit.parameters.pricingStatus, "pending_pricing");
  assert.notEqual(legacyCommit.parameters.pricingSource, "comfy_api_exact_price_v1");
  assert.equal(legacyWaitCalls, 0, "legacy Price compatibility API must remain display-only");
}

main().then(() => {
  console.log("preload ComfyUI image exact-price settlement tests passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
