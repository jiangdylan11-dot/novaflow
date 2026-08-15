#!/usr/bin/env node
import { readFileSync } from "node:fs";
import vm from "node:vm";

const workflowCreditCostSource = readFileSync("particle-editor/comfyui-workflow-credit-cost.js", "utf8");
const runtimeFetchProxySource = readFileSync("particle-editor/runtime-fetch-proxy.js", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createSessionStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(String(key)) ? values.get(String(key)) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key))
  };
}

function payloadCost(payload) {
  const direct = payload?.estimatedCreditCost ?? payload?.creditCost ?? payload?.credit_cost;
  const nested = payload?.parameters?.estimatedCreditCost ?? payload?.parameters?.creditCost ?? payload?.parameters?.credit_cost;
  return Number(direct ?? nested ?? 0);
}

function assertCost(payload, expected, label) {
  const actual = payloadCost(payload);
  assert(Number.isFinite(actual) && actual > 0, `${label} credit cost missing`);
  assert(Math.abs(actual - expected) < 1e-9, `${label} credit cost expected ${expected}, got ${actual}`);
}

function createVmContext(window) {
  window.setTimeout = window.setTimeout || ((handler, delay, ...args) => {
    const timer = setTimeout(handler, delay, ...args);
    timer.unref?.();
    return timer;
  });
  window.clearTimeout = window.clearTimeout || clearTimeout;
  const context = {
    window,
    sessionStorage: createSessionStorage(),
    Response,
    Request,
    Headers,
    URL,
    URLSearchParams,
    Blob,
    FormData,
    ArrayBuffer,
    Uint8Array,
    TextDecoder,
    atob,
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(context);
  return context;
}

function installRuntimeFetchProxy(context, window) {
  vm.runInContext(workflowCreditCostSource, context);
  window.NovaFlowComfyWorkflowCreditCost = context.NovaFlowComfyWorkflowCreditCost;
  assert(
    typeof window.NovaFlowComfyWorkflowCreditCost?.estimateWorkflowCreditCost === "function",
    "shared ComfyUI workflow credit estimator did not load before runtime fetch proxy"
  );
  vm.runInContext(runtimeFetchProxySource, context);
}

async function runFlow({ caseKey, providerKey, nodeType, promptId, baseUrl, inputs, expectedCost }) {
  const authorizations = [];
  const commits = [];
  const nativeFetchCalls = [];
  const window = {
    location: {
      href: "http://127.0.0.1:4783/",
      protocol: "http:"
    },
    NovaFlowClientAuth: {
      createAuthorizationContext: () => ({
        authorizeAiTask: async (payload) => {
          authorizations.push(payload);
          return { ok: true, credits: { balance: 1000, required: payloadCost(payload), enough: true } };
        },
        commitAiTaskUsage: async (payload) => {
          commits.push(payload);
          return { ok: true, credits: { balance: 1000 - payloadCost(payload), deducted: payloadCost(payload) } };
        },
        release() {}
      })
    },
    fetch: async (url, init) => {
      nativeFetchCalls.push({ url: String(url), init });
      if (String(url).includes("/prompt")) {
        return new Response(JSON.stringify({ prompt_id: promptId }), { status: 200 });
      }
      if (String(url).includes(`/history/${promptId}`)) {
        return new Response(JSON.stringify({
          [promptId]: {
            status: { completed: true },
            outputs: { "9": { videos: [{ filename: "video.mp4", type: "output" }] } }
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    electronAPI: null
  };
  const label = caseKey || providerKey;

  const context = createVmContext(window);
  installRuntimeFetchProxy(context, window);

  const workflow = {
    client_id: `client-${label}`,
    prompt: {
      "2": {
        class_type: nodeType,
        inputs
      }
    }
  };
  const promptResponse = await window.fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workflow)
  });
  assert(promptResponse.ok, `${label} prompt response failed`);
  assert(authorizations.length === 1, `${label} authorization was not called once`);
  assert(authorizations[0].providerKey === providerKey, `${label} authorization provider mismatch`);
  assertCost(authorizations[0], expectedCost, `${label} authorization`);
  assert(authorizations[0].creditCost === Math.ceil(expectedCost), `${label} authorization rounded cost mismatch`);
  assert(authorizations[0].parameters?.pricingStatus === "known", `${label} authorization pricing must be known`);
  assert(nativeFetchCalls.length === 1, `${label} prompt did not reach local runtime`);

  const historyResponse = await window.fetch(`${baseUrl}/history/${promptId}`, { method: "GET" });
  assert(historyResponse.ok, `${label} history response failed`);
  assert(commits.length === 1, `${label} usage commit was not called once`);
  assert(commits[0].providerKey === providerKey, `${label} usage provider mismatch`);
  assert(commits[0].promptId === promptId, `${label} usage prompt id mismatch`);
  assertCost(commits[0], expectedCost, `${label} usage`);

  const repeatedHistoryResponse = await window.fetch(`${baseUrl}/history/${promptId}`, { method: "GET" });
  assert(repeatedHistoryResponse.ok, `${label} repeated history response failed`);
  assert(commits.length === 1, `${label} repeated history poll must stay at one usage commit`);
}

async function runCompletedHistoryWithoutOutputsDoesNotCommit() {
  const promptId = "kling-no-output-prompt";
  const commits = [];
  const window = {
    location: {
      href: "http://127.0.0.1:4783/",
      protocol: "http:"
    },
    NovaFlowClientAuth: {
      createAuthorizationContext: () => ({
        authorizeAiTask: async (payload) => ({
          ok: true,
          credits: { balance: 1000, required: payloadCost(payload), enough: true }
        }),
        commitAiTaskUsage: async (payload) => {
          commits.push(payload);
          return { ok: true };
        },
        release() {}
      })
    },
    fetch: async (url) => {
      if (String(url).includes("/prompt")) {
        return new Response(JSON.stringify({ prompt_id: promptId }), { status: 200 });
      }
      if (String(url).includes(`/history/${promptId}`)) {
        return new Response(JSON.stringify({
          [promptId]: {
            status: { completed: true, status_str: "success" },
            outputs: {}
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    electronAPI: null
  };

  const context = createVmContext(window);
  installRuntimeFetchProxy(context, window);

  const workflow = {
    client_id: "client-kling-no-output",
    prompt: {
      "2": {
        class_type: "KlingVideoNode",
        inputs: {
          prompt: "test",
          "model.resolution": "720p",
          "model.generate_audio": true,
          duration: 5
        }
      }
    }
  };

  const promptResponse = await window.fetch("http://127.0.0.1:8188/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workflow)
  });
  assert(promptResponse.ok, "no-output prompt response failed");

  const historyResponse = await window.fetch(`http://127.0.0.1:8188/history/${promptId}`, { method: "GET" });
  assert(historyResponse.ok, "no-output history response failed");
  assert(commits.length === 0, "completed history without media outputs must not commit credits");
}

async function runDesktopRendererOwnedFlow() {
  const promptId = "desktop-renderer-owned-prompt";
  const authorizations = [];
  const commits = [];
  const bridgeCalls = [];
  let nativeFetchCount = 0;
  const electronAPI = {
    runtimeRequestJson: async (payload) => {
      bridgeCalls.push(payload);
      const method = String(payload?.init?.method || "GET").toUpperCase();
      if (method === "POST" && /\/prompt\/?$/i.test(String(payload?.path || ""))) {
        return { ok: true, status: 200, data: { prompt_id: promptId } };
      }
      if (method === "GET" && String(payload?.path || "").includes(`/history/${promptId}`)) {
        return {
          ok: true,
          status: 200,
          data: {
            [promptId]: {
              status: { completed: true },
              outputs: { "9": { videos: [{ filename: "desktop-output.mp4", type: "output" }] } }
            }
          }
        };
      }
      return { ok: true, status: 200, data: {} };
    },
    runtimeRequestBinary: async () => ({ ok: false, status: 404 })
  };
  const window = {
    location: {
      href: "file:///D:/AI_APP/NovaFlow/particle-editor-desktop/renderer/index.html",
      protocol: "file:"
    },
    NovaFlowClientAuth: {
      authorizeAiTask: async (payload) => {
        authorizations.push(payload);
        return { ok: true, credits: { balance: 1000, required: payloadCost(payload), enough: true } };
      },
      commitAiTaskUsage: async (payload) => {
        commits.push(payload);
        return { ok: true, credits: { balance: 1000 - payloadCost(payload), deducted: payloadCost(payload) } };
      }
    },
    fetch: async () => {
      nativeFetchCount += 1;
      return new Response(JSON.stringify({ ok: false }), { status: 500 });
    },
    electronAPI
  };

  const context = createVmContext(window);
  installRuntimeFetchProxy(context, window);

  const workflow = {
    client_id: "client-desktop-renderer-owned",
    prompt: {
      "2": {
        class_type: "KlingVideoNode",
        inputs: {
          prompt: "test",
          "model.resolution": "720p",
          generate_audio: true,
          multi_shot: "1 storyboard",
          "multi_shot.storyboard_1_duration": 4
        }
      }
    }
  };
  const promptResponse = await window.fetch("http://127.0.0.1:8188/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(workflow)
  });
  assert(promptResponse.ok, "desktop renderer-owned prompt response failed");
  assert(authorizations.length === 0, "desktop renderer must defer authorization to sandboxed preload");

  const historyUrl = `http://127.0.0.1:8188/history/${promptId}`;
  const historyResponse = await window.fetch(historyUrl, { method: "GET" });
  assert(historyResponse.ok, "desktop renderer-owned history response failed");
  const repeatedHistoryResponse = await window.fetch(historyUrl, { method: "GET" });
  assert(repeatedHistoryResponse.ok, "desktop renderer-owned repeated history response failed");
  assert(commits.length === 0, "desktop renderer must defer usage commit to sandboxed preload");
  assert(nativeFetchCount === 0, "desktop file flow must stay on the electron runtime bridge");

  const postBridgeCall = bridgeCalls.find((payload) => String(payload?.init?.method || "GET").toUpperCase() === "POST");
  const getBridgeCalls = bridgeCalls.filter((payload) => String(payload?.init?.method || "GET").toUpperCase() === "GET");
  assert(postBridgeCall && !Object.keys(postBridgeCall).some((key) => key.startsWith("__novaflowProvider")), "desktop POST bridge payload must not carry a forgeable usage bypass");
  assert(getBridgeCalls.length === 2, "desktop repeated history polls must both reach the bridge");
  assert(getBridgeCalls.every((payload) => !Object.keys(payload).some((key) => key.startsWith("__novaflowProvider"))), "desktop GET bridge payloads must not carry a forgeable usage bypass");
}

async function runUnknownCloudPricingDoesNotBlock() {
  const promptId = "unknown-cloud-prompt";
  const authorizations = [];
  const commits = [];
  const bridgeCalls = [];
  const electronAPI = {
    runtimeRequestJson: async (payload) => {
      bridgeCalls.push(payload);
      const method = String(payload?.init?.method || "GET").toUpperCase();
      if (method === "POST") return { ok: true, status: 200, data: { prompt_id: promptId } };
      return {
        ok: true,
        status: 200,
        data: {
          [promptId]: {
            status: { completed: true },
            outputs: { "9": { videos: [{ filename: "cloud-output.mp4", type: "output" }] } }
          }
        }
      };
    },
    runtimeRequestBinary: async () => ({ ok: false, status: 404 })
  };
  const window = {
    location: {
      href: "http://127.0.0.1:4783/",
      protocol: "http:"
    },
    NovaFlowClientAuth: {
      createAuthorizationContext: () => ({
        authorizeAiTask: async (payload) => {
          authorizations.push(payload);
          return { ok: true, credits: { balance: 1000, required: 0, enough: true } };
        },
        commitAiTaskUsage: async (payload) => {
          commits.push(payload);
          return { ok: true, credits: { balance: 1000, deducted: 0 } };
        },
        release() {}
      })
    },
    fetch: async () => new Response(JSON.stringify({ ok: false }), { status: 500 }),
    electronAPI
  };

  const context = createVmContext(window);
  installRuntimeFetchProxy(context, window);

  const unknownWorkflow = {
    client_id: "client-unknown-cloud",
    prompt: {
      "1": { class_type: "UnknownComfyCloudNode", inputs: { prompt: "test" } }
    }
  };
  const promptResult = await window.electronAPI.runtimeRequestJson({
    baseUrl: "https://cloud.comfy.org",
    path: "/api/prompt",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(unknownWorkflow)
    }
  });
  assert(promptResult?.ok !== false, "unknown cloud pricing must not block prompt submission");
  assert(authorizations.length === 1, "unknown cloud prompt must authorize exactly once");
  assert(payloadCost(authorizations[0]) === 0, "unknown cloud prompt must not invent a credit cost");
  assert(authorizations[0].parameters?.pricingStatus === "pending_pricing", "unknown cloud prompt must be pending pricing");

  const historyPayload = {
    baseUrl: "https://cloud.comfy.org",
    path: `/api/history/${promptId}`,
    init: { method: "GET" }
  };
  const historyResult = await window.electronAPI.runtimeRequestJson(historyPayload);
  assert(historyResult?.ok !== false, "unknown cloud history must remain non-blocking");
  await window.electronAPI.runtimeRequestJson(historyPayload);
  assert(commits.length === 1, "unknown cloud repeated history poll must stay at one commit");
  assert(payloadCost(commits[0]) === 0, "unknown cloud commit must stay pending without invented cost");
  assert(commits[0].parameters?.pricingStatus === "pending_pricing", "unknown cloud commit must preserve pending pricing");
  assert(bridgeCalls.every((payload) => !Object.keys(payload).some((key) => key.startsWith("__novaflowProvider"))), "web bridge payloads must not carry a forgeable usage bypass");
}

await runFlow({
  caseKey: "kling",
  providerKey: "comfyui",
  nodeType: "KlingVideoNode",
  promptId: "kling-prompt-1",
  baseUrl: "http://127.0.0.1:8188",
  expectedCost: 106.344,
  inputs: {
    prompt: "test",
    "model.resolution": "720p",
    "model.generate_audio": true,
    multi_shot: "1 storyboard",
    "multi_shot.storyboard_1_duration": 4
  }
});
await runFlow({
  caseKey: "kling-omni",
  providerKey: "comfyui",
  nodeType: "KlingOmniProImageToVideoNode",
  promptId: "kling-omni-prompt-1",
  baseUrl: "http://127.0.0.1:8188",
  expectedCost: 212.688,
  inputs: {
    model_name: "kling-v3-omni",
    prompt: "test",
    aspect_ratio: "16:9",
    duration: 9,
    reference_images: "image.png",
    resolution: "720p",
    generate_audio: true
  }
});
await runFlow({
  caseKey: "jimeng",
  providerKey: "comfyui",
  nodeType: "ByteDance2ReferenceNode",
  promptId: "jimeng-prompt-1",
  baseUrl: "http://127.0.0.1:8000",
  expectedCost: 228.10788,
  inputs: {
    prompt: "test",
    "model.duration": 5,
    "model.resolution": "720p",
    model: "Seedance 2.0"
  }
});
await runFlow({
  caseKey: "seedance-strict-first-frame",
  providerKey: "comfyui",
  nodeType: "ByteDance2FirstLastFrameNode",
  promptId: "seedance-strict-first-frame-prompt-1",
  baseUrl: "http://127.0.0.1:8000",
  expectedCost: 721.496776,
  inputs: {
    model: "Seedance 2.0",
    first_frame: "first-frame.png",
    "model.prompt": "test",
    "model.duration": 7,
    "model.resolution": "1080p",
    "model.ratio": "16:9",
    "model.generate_audio": true,
    seed: 0,
    watermark: false
  }
});
await runFlow({
  caseKey: "kling-live-storyboard-15s",
  providerKey: "comfyui",
  nodeType: "KlingVideoNode",
  promptId: "kling-live-storyboard-15s-prompt",
  baseUrl: "http://127.0.0.1:8188",
  expectedCost: 398.79,
  inputs: {
    prompt: "test",
    "model.resolution": "720p",
    generate_audio: true,
    multi_shot: "1 storyboard",
    "multi_shot.storyboard_1_duration": 15
  }
});
await runFlow({
  caseKey: "kling-live-storyboard-10s",
  providerKey: "comfyui",
  nodeType: "KlingVideoNode",
  promptId: "kling-live-storyboard-10s-prompt",
  baseUrl: "http://127.0.0.1:8188",
  expectedCost: 265.86,
  inputs: {
    prompt: "test",
    "model.resolution": "720p",
    generate_audio: true,
    multi_shot: "1 storyboard",
    "multi_shot.storyboard_1_duration": 10
  }
});
await runCompletedHistoryWithoutOutputsDoesNotCommit();
await runDesktopRendererOwnedFlow();
await runUnknownCloudPricingDoesNotBlock();

console.log("check-ai-seq-local-provider-runtime-proxy-flow: ok");
