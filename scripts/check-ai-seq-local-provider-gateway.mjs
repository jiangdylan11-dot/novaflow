#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function read(relPath) {
  return readFileSync(path.join(repoRoot, relPath), "utf8");
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) {
    throw new Error(`${label} missing: ${needle}`);
  }
}

function assertNotIncludes(text, needle, label) {
  if (text.includes(needle)) {
    throw new Error(`${label} must not include: ${needle}`);
  }
}

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) {
    throw new Error(`${label} missing pattern: ${pattern}`);
  }
}

function assertBefore(text, first, second, label) {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex) {
    throw new Error(`${label} expected ${first} before ${second}`);
  }
}

function assertCopiedPricingContract(helperRelPath, indexRelPath, label) {
  const helperPath = path.join(repoRoot, helperRelPath);
  if (!existsSync(helperPath)) return;
  const pricing = require(helperPath);
  if (!pricing || typeof pricing.estimateWorkflowCreditCost !== "function") {
    throw new Error(`${label} copied pricing helper must expose CommonJS estimateWorkflowCreditCost`);
  }
  const index = read(indexRelPath);
  assertBefore(index, "comfyui-workflow-credit-cost.js", "proxy-electron-api.js", `${label} helper/API script order`);
  assertBefore(index, "proxy-electron-api.js", "runtime-fetch-proxy.js", `${label} API/usage proxy script order`);
}

const providerSources = [
  ["particle-editor-desktop/client-auth-direct.js", "desktop direct auth"],
  ["particle-editor-desktop/admin-server/server.js", "local admin server"],
  ["supabase/functions/novaflow-backend/index.ts", "supabase backend"]
];

for (const [file, label] of providerSources) {
  const source = read(file);
  assertMatch(source, /PROVIDER_QUOTA_KEYS\s*=\s*\[\s*["']grok["']\s*\]/, `${label} provider quota keys`);
  assertNotIncludes(source, 'PROVIDER_QUOTA_KEYS = ["grok", "kling", "jimeng"]', `${label} legacy video quota keys`);
}

const clientAuth = read("particle-editor/novaflow-client-auth.js");
assertNotIncludes(clientAuth, '{ key: "kling"', "client auth kling quota");
assertNotIncludes(clientAuth, '{ key: "jimeng"', "client auth jimeng quota");
assertIncludes(clientAuth, "authorizeAiTask", "client auth local workflow authorization");
assertIncludes(clientAuth, "commitAiTaskUsage", "client auth local workflow usage commit");

const preload = read("particle-editor-desktop/preload.js");
assertIncludes(preload, "clientAuthAiTaskAuthorize", "preload authorize bridge");
assertNotIncludes(preload, "clientAuthAiTaskCommitUsage:", "preload renderer usage bridge");
assertIncludes(preload, 'ipcRenderer.invoke("client-auth-ai-task-commit-usage"', "preload private usage commit");
assertIncludes(preload, "KlingOmniProImageToVideoNode", "preload Kling Omni usage detection");

const main = read("particle-editor-desktop/main.js");
assertIncludes(main, '"/api/ai/tasks/usage"', "main client api allowlist usage route");
assertIncludes(main, '"client-auth-ai-task-authorize"', "main authorize ipc");
assertIncludes(main, '"client-auth-ai-task-commit-usage"', "main usage ipc");
assertIncludes(main, "injectComfyApiCredentialsIntoPromptBody", "main local ComfyUI provider credential injection");
assertIncludes(main, "NOVAFLOW_COMFYUI_API_KEY", "main local ComfyUI provider credential env");
assertIncludes(main, "api_key_comfy_org", "main ComfyUI API node hidden credential field");
assertIncludes(main, "KlingVideoNode", "main Kling provider credential detection");
assertIncludes(main, "KlingOmniProImageToVideoNode", "main Kling Omni provider credential detection");
assertIncludes(main, "ByteDance2ReferenceNode", "main Jimeng provider credential detection");

const adminGui = read("particle-editor-desktop/license-admin-gui/renderer.js");
assertNotIncludes(adminGui, '{ key: "kling"', "admin GUI kling quota option");
assertNotIncludes(adminGui, '{ key: "jimeng"', "admin GUI jimeng quota option");
assertNotIncludes(adminGui, "provider_quota_kling_<user_id>", "admin GUI kling fallback quota setting");
assertNotIncludes(adminGui, "provider_quota_jimeng_<user_id>", "admin GUI jimeng fallback quota setting");

const localAdminServer = read("particle-editor-desktop/admin-server/server.js");
assertIncludes(localAdminServer, "local_workflow_credit_authorize", "local admin server video credit authorization mode");
assertIncludes(localAdminServer, "local_workflow_credit_usage", "local admin server video credit usage mode");
assertNotIncludes(localAdminServer, "readProviderQuotaForUser(session.user.id, task.providerKey", "local admin server video provider quota read");
assertNotIncludes(localAdminServer, "recordAdminProviderCallUsage({\n    userId: session.user.id,\n    providerKey: task.providerKey", "local admin server video provider quota usage");

const supabaseBackend = read("supabase/functions/novaflow-backend/index.ts");
assertIncludes(supabaseBackend, "local_workflow_credit_authorize", "supabase video credit authorization mode");
assertIncludes(supabaseBackend, "local_workflow_credit_usage", "supabase video credit usage mode");
assertNotIncludes(supabaseBackend, "readProviderQuota(session.user, task.providerKey)", "supabase video provider quota read");
assertNotIncludes(supabaseBackend, "recordProviderUsage(session.user, task.providerKey", "supabase video provider quota usage");

const runtimeProxy = read("particle-editor/runtime-fetch-proxy.js");
assertIncludes(runtimeProxy, "new Set(['8188', '8000'])", "runtime proxy local ComfyUI port allowlist");
assertIncludes(runtimeProxy, "detectProviderWorkflow", "runtime proxy provider workflow detector");
assertIncludes(runtimeProxy, "KlingVideoNode", "runtime proxy kling workflow detector");
assertIncludes(runtimeProxy, "KlingOmniProImageToVideoNode", "runtime proxy Kling Omni workflow detector");
assertIncludes(runtimeProxy, "ByteDance2ReferenceNode", "runtime proxy jimeng workflow detector");
assertIncludes(runtimeProxy, "estimateWorkflowCreditCost", "runtime proxy shared workflow credit estimator");
assertIncludes(runtimeProxy, "estimatedCreditCost", "runtime proxy authorization credit cost");
assertIncludes(runtimeProxy, "creditCost", "runtime proxy usage credit cost");
assertIncludes(runtimeProxy, "authorizeAiTask", "runtime proxy authorization call");
assertIncludes(runtimeProxy, "commitAiTaskUsage", "runtime proxy usage commit call");
assertIncludes(runtimeProxy, "getHistoryPromptId", "runtime proxy history prompt id tracking");
assertIncludes(runtimeProxy, "history", "runtime proxy history completion tracking");

const workflowCreditCost = read("particle-editor/comfyui-workflow-credit-cost.js");
assertIncludes(workflowCreditCost, "module.exports = api", "workflow credit helper CommonJS export");
assertIncludes(workflowCreditCost, "estimateWorkflowCreditCost", "workflow credit helper shared estimator");
assertIncludes(main, 'ipcMain.handle("comfyui-workflow-credit-cost"', "main shared workflow credit pricing IPC");
assertIncludes(main, 'require(path.join(__dirname, "renderer", "comfyui-workflow-credit-cost.js"))', "main copied workflow credit helper");
assertIncludes(preload, 'ipcRenderer.invoke("comfyui-workflow-credit-cost"', "sandboxed preload workflow credit pricing IPC");
assertNotIncludes(preload, 'require("./renderer/comfyui-workflow-credit-cost.js")', "sandboxed preload local helper require");
assertNotIncludes(preload, "__novaflowProviderUsageOwner", "preload forged renderer usage ownership bypass");
assertIncludes(runtimeProxy, "if (window.location.protocol === 'file:') return", "packaged renderer defers usage ownership to preload");
assertBefore(
  read("particle-editor/index.html"),
  "comfyui-workflow-credit-cost.js",
  "runtime-fetch-proxy.js",
  "source renderer workflow credit helper order"
);
assertBefore(
  read("particle-editor/index.html"),
  "proxy-electron-api.js",
  "runtime-fetch-proxy.js",
  "source renderer API must exist before usage wrapper"
);

const syncRuntime = read("scripts/sync-runtime.mjs");
const checkRuntimeSync = read("scripts/check-runtime-sync.mjs");
const buildRenderer = read("particle-editor-desktop/scripts/build-renderer.mjs");
for (const [source, label] of [
  [syncRuntime, "runtime sync"],
  [checkRuntimeSync, "runtime sync checker"],
  [buildRenderer, "renderer build"]
]) {
  assertIncludes(source, "comfyui-workflow-credit-cost.js", `${label} workflow credit helper contract`);
}

assertCopiedPricingContract(
  "particle-editor-desktop/renderer/comfyui-workflow-credit-cost.js",
  "particle-editor-desktop/renderer/index.html",
  "desktop renderer"
);
assertCopiedPricingContract(
  "particle-editor-desktop/dist/win-unpacked/resources/app/renderer/comfyui-workflow-credit-cost.js",
  "particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html",
  "win-unpacked renderer"
);

const proxyApi = read("particle-editor/proxy-electron-api.js");
assertIncludes(proxyApi, "clientAuthAiTaskAuthorize", "web proxy authorize bridge");
assertIncludes(proxyApi, "clientAuthAiTaskCommitUsage", "web proxy usage bridge");

const previewRuntimeServer = read("tools/preview_runtime_server.py");
assertIncludes(previewRuntimeServer, "inject_comfy_api_credentials_into_prompt_body", "4783 preview local ComfyUI provider credential injection");
assertIncludes(previewRuntimeServer, "NOVAFLOW_COMFYUI_API_KEY", "4783 preview local ComfyUI provider credential env");
assertIncludes(previewRuntimeServer, "api_key_comfy_org", "4783 preview ComfyUI API node hidden credential field");
assertIncludes(previewRuntimeServer, "KlingVideoNode", "4783 preview Kling provider credential detection");
assertIncludes(previewRuntimeServer, "KlingOmniProImageToVideoNode", "4783 preview Kling Omni provider credential detection");
assertIncludes(previewRuntimeServer, "ByteDance2ReferenceNode", "4783 preview Jimeng provider credential detection");

console.log("check-ai-seq-local-provider-gateway: ok");
