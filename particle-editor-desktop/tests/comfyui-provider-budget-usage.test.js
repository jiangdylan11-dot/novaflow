const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const server = read("particle-editor-desktop/admin-server/server.js");
const adminData = read("particle-editor-desktop/license-admin-gui/admin-data.js");
const runtimeProxy = read("particle-editor/runtime-fetch-proxy.js");
const preload = read("particle-editor-desktop/preload.js");
const main = read("particle-editor-desktop/main.js");
const edgeBackend = read("supabase/functions/novaflow-backend/index.ts");
const adminRenderer = read("particle-editor-desktop/license-admin-gui/renderer.js");
const adminHtml = read("particle-editor-desktop/license-admin-gui/index.html");

assert(
  /const LOCAL_WORKFLOW_PROVIDER_KEYS = new Set\(\["comfyui"\]\);/.test(server),
  "local workflow credit usage should be scoped to ComfyUI only"
);
assert(
  server.includes("settleAdminComfyUsage") && !server.includes("const usage = await deductLocalWorkflowCredits("),
  "gateway should settle user credits and the ComfyUI manual balance through one transaction"
);
assert(
  !server.includes("local workflow usage can only be committed for kling or jimeng"),
  "usage endpoint should no longer describe kling/jimeng as the only local workflow providers"
);
assert(
  adminData.includes("async function settleAdminComfyUsage(") &&
    adminData.includes("settleAdminComfyUsage,"),
  "admin data layer should expose the transactional ComfyUI usage settlement RPC"
);
assert(
  runtimeProxy.includes("const COMFYUI_PROVIDER_KEY = 'comfyui'") &&
    runtimeProxy.includes("function wrapRuntimeRequestJsonForProviderUsage(") &&
    runtimeProxy.includes("isComfyUiUsageBaseUrl"),
  "runtime proxy should authorize and commit ComfyUI usage around electron runtime requests"
);
assert(
  preload.includes("let clientAuthSessionToken") &&
    preload.includes("async function runtimeRequestJsonWithUsage(") &&
    preload.includes("authorizeRuntimeProviderUsage") &&
    preload.includes("commitRuntimeProviderUsage") &&
    !preload.includes("__novaflowProviderUsageOwner"),
  "sandboxed preload should own every packaged Electron runtime usage request"
);
assert(
  main.includes('ipcMain.handle("comfyui-workflow-credit-cost"') &&
    preload.includes('ipcRenderer.invoke("comfyui-workflow-credit-cost"') &&
    !preload.includes('require("./renderer/comfyui-workflow-credit-cost.js")'),
  "sandboxed preload should price through the main-process shared helper"
);
assert(
  runtimeProxy.includes("if (window.location.protocol === 'file:') return") &&
    edgeBackend.includes('const LOCAL_WORKFLOW_PROVIDER_KEYS = new Set(["comfyui"])') &&
    edgeBackend.includes('rpc("settle_comfy_usage"'),
  "renderer, local backend, and Edge backend should share one ComfyUI settlement contract"
);
assert(
  adminRenderer.includes('if (["dashboard", "ai-services"].includes(name))') &&
    adminRenderer.includes("loadAdminData()"),
  "opening Dashboard or AI Services should refresh the latest settled balances"
);
assert(
  adminRenderer.includes("ComfyUI 手动总余额") &&
    adminHtml.includes("ComfyUI 手动总余额") &&
    adminHtml.includes("生成成功后会按用户实际消耗自动减少"),
  "admin UI should explain that the manual ComfyUI balance decreases after successful usage"
);

console.log("comfyui provider budget usage tests passed");
