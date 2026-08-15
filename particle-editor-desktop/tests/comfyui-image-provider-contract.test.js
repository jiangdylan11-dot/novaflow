const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
require(path.join(root, "particle-editor", "comfyui-workflow-credit-cost.js"));
const pricing = globalThis.NovaFlowComfyWorkflowCreditCost;
assert.ok(pricing && Array.isArray(pricing.SUPPORTED_NODE_TYPES), "shared pricing registry must load");

const main = read("particle-editor-desktop/main.js");
const preload = read("particle-editor-desktop/preload.js");
const previewProxy = read("tools/preview_runtime_server.py");
const runtimeFetchProxy = read("particle-editor/runtime-fetch-proxy.js");
const rendererIndex = read("particle-editor/index.html");

assert.match(preload, /RUNTIME_PROVIDER_PROMPT_META_TTL_MS/, "preload prompt-owner contexts must have a bounded lifetime");
assert.match(preload, /meta\.authorizationToken\s*=\s*["']{2}/, "preload must clear bearer tokens before deleting prompt metadata");
assert.match(preload, /clearTimeout\(meta\.cleanupTimer\)/, "preload must cancel prompt-owner cleanup timers on normal settlement");

const imageProviderNodeTypes = [
  "OpenAIGPTImage1",
  "OpenAIGPTImageNodeV2",
  "GeminiImageNode",
  "GeminiImage2Node",
];

function frozenStringArray(source, name) {
  const match = source.match(new RegExp(`const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)\\s*;?`));
  assert.ok(match, `${name} must be an immutable fallback array`);
  return Array.from(match[1].matchAll(/["']([^"']+)["']/g), (item) => item[1]);
}

function assertSetUsesSharedHelper(source, name) {
  const match = source.match(new RegExp(`const ${name} = new Set\\(([\\s\\S]{0,320}?)\\);`));
  assert.ok(match, `${name} must construct a Set`);
  assert.match(match[1], /loadComfyWorkflowCreditCostApi\(\)/);
  assert.match(match[1], /SUPPORTED_NODE_TYPES/);
}

for (const nodeType of imageProviderNodeTypes) {
  assert.ok(pricing.SUPPORTED_NODE_TYPES.includes(nodeType), `shared registry must include ${nodeType}`);
}

assertSetUsesSharedHelper(main, "COMFY_API_PROVIDER_NODE_TYPES");
assert.match(preload, /const COMFYUI_PROVIDER_NODE_TYPES = new Set\(COMFYUI_PROVIDER_NODE_TYPE_FALLBACK\)/, "preload must keep pricing in main while retaining the complete detection allowlist");

assert.deepEqual(
  frozenStringArray(main, "COMFY_API_PROVIDER_NODE_TYPE_FALLBACK"),
  pricing.SUPPORTED_NODE_TYPES,
  "main fallback must remain complete when the shared helper cannot load",
);
assert.match(previewProxy, /PREVIEW_PAID_IMAGE_PROVIDER_ENV\s*=\s*["']NOVAFLOW_PREVIEW_ALLOW_PAID_IMAGE_PROVIDER["']/);
assert.ok(
  previewProxy.indexOf("preview_paid_image_provider_block_reason(self.path") < previewProxy.indexOf("inject_comfy_api_credentials_into_prompt_body(self.path"),
  "preview server must block unbilled paid image prompts before credential injection",
);

const previewGuardProbe = spawnSync("python", ["-c", String.raw`
import importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location("preview_runtime_server", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
body = json.dumps({"prompt": {"provider": {"class_type": "OpenAIGPTImageNodeV2", "inputs": {}}}}).encode("utf-8")
assert module.preview_paid_image_provider_block_reason("/__runtime_proxy/prompt", "POST", body) == "preview_paid_image_provider_requires_desktop"
assert module.preview_paid_image_provider_block_reason("/__runtime_proxy/history/1", "GET", body) == ""
os.environ[module.PREVIEW_PAID_IMAGE_PROVIDER_ENV] = "1"
assert module.preview_paid_image_provider_block_reason("/__runtime_proxy/prompt", "POST", body) == ""
`, path.join(root, "tools", "preview_runtime_server.py")], { encoding: "utf8" });
assert.equal(previewGuardProbe.status, 0, previewGuardProbe.stderr || previewGuardProbe.stdout);
assert.deepEqual(
  frozenStringArray(preload, "COMFYUI_PROVIDER_NODE_TYPE_FALLBACK"),
  pricing.SUPPORTED_NODE_TYPES,
  "preload fallback must remain complete when the shared helper cannot load",
);
assert.deepEqual(
  frozenStringArray(runtimeFetchProxy, "PROVIDER_WORKFLOW_NODE_TYPE_FALLBACK"),
  pricing.SUPPORTED_NODE_TYPES,
  "browser Runtime proxy fallback must remain complete when the shared helper cannot load",
);
assert.match(
  runtimeFetchProxy,
  /taskType:\s*IMAGE_PROVIDER_WORKFLOW_NODE_TYPES\.has\(nodeType\)\s*\?\s*['"]local_workflow_image['"]\s*:\s*['"]local_workflow_video['"]/,
  "browser Runtime proxy fallback must preserve the image task type",
);
assert.match(runtimeFetchProxy, /createAuthorizationContext\(\)/, "browser Runtime authorization must capture an opaque account context");
assert.match(
  runtimeFetchProxy,
  /meta\.authorizationContext[\s\S]{0,240}commitAiTaskUsage/,
  "browser Runtime history settlement must use the prompt-bound account context",
);
assert.match(runtimeFetchProxy, /authorizationContext\?\.release\?\.\(\)/, "browser Runtime must release prompt account contexts");
assert.match(runtimeFetchProxy, /PROVIDER_PROMPT_CONTEXT_TTL_MS/, "browser prompt contexts must have a bounded lifetime");
assert.match(runtimeFetchProxy, /providerPromptAuthorizationContextTimers/, "browser prompt contexts must own cleanup timers");
assert.match(
  rendererIndex,
  /comfyui-workflow-credit-cost\.js\?v=20260711-art-dropdown-2/,
  "renderer must cache-bust the updated provider registry on the locked browser surface",
);

const pythonRegistryMatch = previewProxy.match(/COMFY_API_PROVIDER_NODE_TYPES\s*=\s*\{([\s\S]*?)\n\}/);
assert.ok(pythonRegistryMatch, "preview proxy must declare the provider-node allowlist");
const pythonProviderNodeTypes = Array.from(
  pythonRegistryMatch[1].matchAll(/["']([^"']+)["']/g),
  (item) => item[1],
);
assert.deepEqual(
  pythonProviderNodeTypes.slice().sort(),
  pricing.SUPPORTED_NODE_TYPES.slice().sort(),
  "preview proxy provider-node allowlist must mirror the shared registry",
);

async function verifyPreloadFallbackTaskType() {
  const ipcRenderer = {
    async invoke(channel) {
      if (channel === "comfyui-workflow-credit-cost") return { ok: false, pricing: null };
      return { ok: true };
    },
    on() {},
    removeListener() {},
  };
  const sandbox = {
    require(id) {
      if (id === "electron") {
        return {
          contextBridge: { exposeInMainWorld() {} },
          ipcRenderer,
          webUtils: {},
        };
      }
      if (id === "node:crypto") return { randomUUID: () => "fallback-test" };
      if (id === "ws") return { WebSocket: class FakeWebSocket {} };
      if (id === "./renderer/comfyui-workflow-credit-cost.js") throw new Error("helper unavailable");
      throw new Error(`unexpected require: ${id}`);
    },
    process: { platform: "win32" },
    document: {
      addEventListener() {},
      querySelectorAll() { return []; },
      elementFromPoint() { return null; },
    },
    URL,
    console,
    setTimeout,
    clearTimeout,
    WeakMap,
    Map,
    Set,
    Promise,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${preload}\n;globalThis.__detectRuntimeComfyUiUsage = detectRuntimeComfyUiUsage;`, sandbox, {
    filename: "preload-fallback-test.js",
  });
  const fallback = await sandbox.__detectRuntimeComfyUiUsage({
    baseUrl: "http://127.0.0.1:8188",
    path: "/prompt",
    init: {
      method: "POST",
      body: JSON.stringify({
        prompt: {
          "1": { class_type: "GeminiImageNode", inputs: { model: "gemini-2.5-flash-image", prompt: "test" } },
        },
      }),
    },
  });
  assert.equal(fallback.taskType, "local_workflow_image", "helper-unavailable image fallback must retain the image task type");
  assert.equal(fallback.modelKey, "gemini-2.5-flash-image", "helper-unavailable fallback must retain the actual model key");
  assert.equal(fallback.creditCost, 0);
  assert.equal(fallback.pricingStatus, "pending_pricing");
}

verifyPreloadFallbackTaskType().then(() => {
  console.log("ComfyUI image provider contract tests passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
