const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const source = fs.readFileSync(path.resolve(__dirname, "../preload.js"), "utf8");
  const exposed = {};
  const calls = [];
  const promptId = "preload-owner-prompt";
  const contextBridge = {
    exposeInMainWorld(name, value) {
      exposed[name] = value;
    }
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
            modelKey: "klingvideonode",
            taskType: "local_workflow_video",
            workflowNodeType: "KlingVideoNode",
            known: true,
            estimatedCreditCost: 398.79,
            creditCost: 399,
            pricingStatus: "known",
            pricingSource: "kling_static_v1"
          }
        };
      }
      if (channel === "client-auth-ai-task-authorize") return { ok: true };
      if (channel === "client-auth-ai-task-commit-usage") {
        return { ok: true, settlement: { status: "settled", idempotent: false } };
      }
      if (channel === "runtime-request-json") {
        const method = String(payload?.init?.method || "GET").toUpperCase();
        if (method === "POST") return { ok: true, data: { prompt_id: promptId } };
        return {
          ok: true,
          data: {
            [promptId]: {
              outputs: { "9": { videos: [{ filename: "preload-output.mp4" }] } }
            }
          }
        };
      }
      return { ok: true };
    },
    on() {},
    removeListener() {},
    send() {}
  };
  const electron = {
    contextBridge,
    ipcRenderer,
    webUtils: { getPathForFile: () => "" }
  };
  const document = {
    addEventListener() {},
    elementFromPoint: () => null,
    querySelectorAll: () => []
  };
  const window = { postMessage() {} };
  const loadPreload = new Function("require", "process", "document", "window", source);
  loadPreload((name) => {
    if (name === "electron") return electron;
    if (name === "node:crypto") return { randomUUID: () => "owner-test" };
    if (name === "ws") return { WebSocket: class FakeNodeWebSocket {} };
    throw new Error(`unexpected preload require: ${name}`);
  }, { platform: "win32" }, document, window);

  const api = exposed.electronAPI;
  assert.ok(api && typeof api.runtimeRequestJson === "function");
  await api.clientAuthLogin({ account: "owner-a", password: "not-sent" });

  const workflow = {
    prompt: {
      "2": {
        class_type: "KlingVideoNode",
        inputs: {
          "model.resolution": "720p",
          generate_audio: true,
          multi_shot: "1 storyboard",
          "multi_shot.storyboard_1_duration": 15
        }
      }
    }
  };
  const forgedOwnerFlag = { __novaflowProviderUsageOwner: "renderer" };
  const promptResult = await api.runtimeRequestJson({
    ...forgedOwnerFlag,
    baseUrl: "http://127.0.0.1:8188",
    path: "/prompt",
    init: { method: "POST", body: JSON.stringify(workflow) }
  });
  assert.equal(promptResult.ok, true);
  await api.clientAuthLogin({ account: "owner-b", password: "not-sent" });

  const historyPayload = {
    ...forgedOwnerFlag,
    baseUrl: "http://127.0.0.1:8188",
    path: `/history/${promptId}`,
    init: { method: "GET" }
  };
  await api.runtimeRequestJson(historyPayload);
  await api.runtimeRequestJson(historyPayload);

  const count = (channel) => calls.filter((call) => call.channel === channel).length;
  assert.equal(count("comfyui-workflow-credit-cost"), 1, "preload should price the prompt through main exactly once");
  assert.equal(count("client-auth-ai-task-authorize"), 1, "forged renderer flag must not bypass preload authorization");
  assert.equal(count("client-auth-ai-task-commit-usage"), 1, "repeated history should commit once");
  assert.equal(count("runtime-request-json"), 4, "preload-owned history monitoring must run even when renderer polling is absent");

  const authorization = calls.find((call) => call.channel === "client-auth-ai-task-authorize").payload;
  const commit = calls.find((call) => call.channel === "client-auth-ai-task-commit-usage").payload;
  assert.equal(authorization.estimatedCreditCost, 398.79);
  assert.equal(authorization.creditCost, 399);
  assert.equal(authorization.token, "owner-a-token", "authorization should snapshot the submitting account");
  assert.equal(commit.usageKey, `comfyui:${promptId}`);
  assert.equal(commit.creditCost, 399);
  assert.equal(commit.token, "owner-a-token", "history settlement must use the prompt's authorization account");

  console.log("preload ComfyUI usage owner tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
