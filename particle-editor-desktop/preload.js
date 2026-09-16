const { contextBridge, ipcRenderer, webUtils } = require("electron");
const { randomUUID } = require("node:crypto");
const wsModule = require("ws");
const NodeWebSocket = wsModule?.WebSocket || wsModule;

const droppedFilePaths = new WeakMap();
const NOVAFLOW_EXPORT_PICK_SAVE_CANCELED_CHANNEL = "novaflow-export-pick-save-file-canceled";

function getFileSystemPath(file) {
  try {
    const direct = webUtils?.getPathForFile?.(file);
    if (typeof direct === "string" && direct) return direct;
  } catch {}
  try {
    const remembered = droppedFilePaths.get(file);
    if (typeof remembered === "string" && remembered) return remembered;
  } catch {}
  try {
    return typeof file?.path === "string" ? file.path : "";
  } catch {
    return "";
  }
}

async function exportPickSaveFile(payload) {
  const result = await ipcRenderer.invoke("export-pick-save-file", payload);
  if (result?.canceled && result?.restore) {
    try {
      window.postMessage({
        type: NOVAFLOW_EXPORT_PICK_SAVE_CANCELED_CHANNEL,
        payload: result.restore
      }, "*");
    } catch {}
  }
  return result;
}

function onExportPickSaveFileCanceled(handler) {
  if (typeof handler !== "function") return () => {};
  const listener = (_event, payload) => {
    try { handler(payload); } catch {}
  };
  ipcRenderer.on(NOVAFLOW_EXPORT_PICK_SAVE_CANCELED_CHANNEL, listener);
  return () => {
    try { ipcRenderer.removeListener(NOVAFLOW_EXPORT_PICK_SAVE_CANCELED_CHANNEL, listener); } catch {}
  };
}

const COMFYUI_PROVIDER_KEY = "comfyui";
const COMFYUI_USAGE_BASE_HOSTS = new Set(["cloud.comfy.org"]);
let artGenerateProviderWorkflowApi = null;

function loadArtGenerateProviderWorkflowApi() {
  if (artGenerateProviderWorkflowApi && typeof artGenerateProviderWorkflowApi.createPriceObserver === "function") {
    return artGenerateProviderWorkflowApi;
  }
  try {
    artGenerateProviderWorkflowApi = require("./renderer/art-generate-provider.workflow.js");
  } catch {
    artGenerateProviderWorkflowApi = null;
  }
  return artGenerateProviderWorkflowApi;
}

const COMFYUI_PROVIDER_NODE_TYPE_FALLBACK = Object.freeze([
  "KlingVideoNode",
  "KlingFirstLastFrameNode",
  "KlingOmniProImageToVideoNode",
  "ByteDance2ReferenceNode",
  "ByteDance2FirstLastFrameNode",
  "OpenAIGPTImage1",
  "OpenAIGPTImageNodeV2",
  "GeminiImageNode",
  "GeminiImage2Node"
]);
const COMFYUI_PROVIDER_NODE_TYPES = new Set(COMFYUI_PROVIDER_NODE_TYPE_FALLBACK);
const COMFYUI_IMAGE_PROVIDER_NODE_TYPES = new Set([
  "OpenAIGPTImage1",
  "OpenAIGPTImageNodeV2",
  "GeminiImageNode",
  "GeminiImage2Node"
]);

let clientAuthSessionToken = "";
const runtimeProviderPromptMeta = new Map();
const runtimeProviderUsageCommits = new Set();
const RUNTIME_PROVIDER_PROMPT_META_TTL_MS = 45 * 60 * 1000;
const RUNTIME_PROVIDER_HISTORY_POLL_MS = 900;

function deleteRuntimeProviderPromptMeta(promptId) {
  const id = String(promptId || "").trim();
  const meta = runtimeProviderPromptMeta.get(id);
  if (meta?.cleanupTimer) clearTimeout(meta.cleanupTimer);
  try { meta?.priceObserver?.close?.(); } catch {}
  if (meta) meta.authorizationToken = "";
  runtimeProviderPromptMeta.delete(id);
}

function rememberRuntimeProviderPromptMeta(promptId, meta) {
  const id = String(promptId || "").trim();
  if (!id || !meta) return;
  deleteRuntimeProviderPromptMeta(id);
  const record = { ...meta };
  record.cleanupTimer = setTimeout(() => deleteRuntimeProviderPromptMeta(id), RUNTIME_PROVIDER_PROMPT_META_TTL_MS);
  record.cleanupTimer?.unref?.();
  runtimeProviderPromptMeta.set(id, record);
}

function notifyRuntimeProviderUsageSettlement(promptId, settlement) {
  try {
    const hasStructuredDetails = settlement && typeof settlement === "object" && [
      "settlement",
      "credits",
      "providerBudget",
      "pricing"
    ].some((key) => Object.prototype.hasOwnProperty.call(settlement, key));
    const details = hasStructuredDetails ? settlement : { settlement: settlement || null };
    window.postMessage({
      type: "novaflow-provider-usage-settled",
      payload: { ...details, promptId: String(promptId || "") }
    }, "*");
  } catch {}
}

function waitRuntimeProviderHistoryPoll(delayMs = RUNTIME_PROVIDER_HISTORY_POLL_MS) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(RUNTIME_PROVIDER_HISTORY_POLL_MS, Number(delayMs) || 0));
    timer?.unref?.();
  });
}

function rememberClientAuthSession(result, payload) {
  const token = String(result?.session?.token || payload?.token || "").trim();
  if (token && result?.ok !== false) clientAuthSessionToken = token;
  if ([401, 403].includes(Number(result?.httpStatus || result?.status || 0))) clientAuthSessionToken = "";
  return result;
}

function clearClientAuthSession() {
  clientAuthSessionToken = "";
}

function runtimePayloadUrl(payload) {
  try {
    const baseUrl = String(payload?.baseUrl || "http://127.0.0.1").replace(/\/$/, "");
    const path = String(payload?.path || "/");
    return new URL(path.startsWith("/") ? path : `/${path}`, `${baseUrl}/`);
  } catch {
    return null;
  }
}

function runtimePayloadMethod(payload) {
  return String(payload?.init?.method || "GET").toUpperCase();
}

function isComfyUiUsageBaseUrl(baseUrl) {
  try {
    const url = new URL(String(baseUrl || ""));
    const host = String(url.hostname || "").toLowerCase();
    if (!host || host === "127.0.0.1" || host === "localhost") return false;
    return COMFYUI_USAGE_BASE_HOSTS.has(host);
  } catch {
    return false;
  }
}

function isLoopbackRuntimeBaseUrl(baseUrl) {
  try {
    const url = new URL(String(baseUrl || ""));
    const host = String(url.hostname || "").toLowerCase();
    return url.protocol === "http:" && !url.username && !url.password && (
      host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]"
    );
  } catch {
    return false;
  }
}

async function resolveTrustedRuntimeBaseUrl() {
  try {
    const status = await ipcRenderer.invoke("runtime-get-status", { probe: false });
    const baseUrl = String(status?.baseUrl || "").trim().replace(/\/+$/, "");
    return isLoopbackRuntimeBaseUrl(baseUrl) ? baseUrl : "";
  } catch {
    return "";
  }
}

function isRuntimePromptPath(url) {
  const pathname = String(url?.pathname || "").replace(/\/+$/, "");
  return pathname === "/prompt" || pathname === "/api/prompt";
}

function isRuntimeHistoryPath(url) {
  return /\/(?:api\/)?history\//i.test(String(url?.pathname || ""));
}

function runtimeHistoryPromptId(url) {
  const match = String(url?.pathname || "").match(/\/(?:api\/)?history\/([^/?#]+)/i);
  try {
    return match ? decodeURIComponent(match[1]) : "";
  } catch {
    return match ? String(match[1] || "") : "";
  }
}

function parseWorkflowBody(body) {
  try {
    const parsed = JSON.parse(String(body || ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function workflowNodes(workflow) {
  return workflow && typeof workflow === "object" && workflow.prompt && typeof workflow.prompt === "object"
    ? workflow.prompt
    : workflow;
}

function findComfyProviderNodes(workflow) {
  const nodes = workflowNodes(workflow);
  if (!nodes || typeof nodes !== "object") return [];
  const matches = [];
  for (const [nodeId, node] of Object.entries(nodes)) {
    const type = String(node?.class_type || node?.classType || node?.type || "");
    if (COMFYUI_PROVIDER_NODE_TYPES.has(type)) matches.push({ nodeId: String(nodeId), node, type });
  }
  return matches;
}

function findComfyProviderNodeType(workflow) {
  return findComfyProviderNodes(workflow)[0]?.type || "";
}

async function detectRuntimeComfyUiUsage(payload) {
  const url = runtimePayloadUrl(payload);
  if (!url || runtimePayloadMethod(payload) !== "POST" || !isRuntimePromptPath(url)) return null;
  const body = String(payload?.init?.body || "");
  const workflow = parseWorkflowBody(body);
  if (!workflow) return null;
  const providerNodes = findComfyProviderNodes(workflow);
  const providerNodeType = providerNodes[0]?.type || "";
  const providerModelKey = String(providerNodes[0]?.node?.inputs?.model || providerNodeType || "comfyui-cloud").trim().toLowerCase();
  const cloudBase = isComfyUiUsageBaseUrl(payload?.baseUrl || url.origin);
  if (!providerNodeType && !cloudBase) return null;
  let pricing = null;
  try {
    const result = await ipcRenderer.invoke("comfyui-workflow-credit-cost", {
      workflow,
      allowCloudPrompt: cloudBase
    });
    pricing = result?.ok && result?.pricing && typeof result.pricing === "object" ? result.pricing : null;
  } catch {
    pricing = null;
  }
  const fallback = pricing || {
    providerKey: COMFYUI_PROVIDER_KEY,
    modelKey: providerModelKey,
    taskType: COMFYUI_IMAGE_PROVIDER_NODE_TYPES.has(providerNodeType) ? "local_workflow_image" : "local_workflow_video",
    workflowNodeType: providerNodeType || "comfyui_cloud_prompt",
    known: false,
    estimatedCreditCost: 0,
    creditCost: 0,
    pricingStatus: "pending_pricing",
    pricingSource: "unknown"
  };
  return {
    ...fallback,
    providerNodeIds: providerNodes.map((item) => item.nodeId),
    workflowNodeType: fallback.workflowNodeType || providerNodeType || "comfyui_cloud_prompt"
  };
}

function historyHasMediaOutput(value) {
  const seen = new WeakSet();
  const visit = (item) => {
    if (!item) return false;
    if (typeof item === "string") return /\.(mp4|webm|mov|m4v|avi|gif|png|jpe?g|webp)$/i.test(item);
    if (typeof item !== "object") return false;
    if (seen.has(item)) return false;
    seen.add(item);
    const name = item.filename || item.file_name || item.fileName || item.name || item.path || item.fullpath;
    if (name && /\.(mp4|webm|mov|m4v|avi|gif|png|jpe?g|webp)$/i.test(String(name))) return true;
    if (Array.isArray(item)) return item.some(visit);
    return Object.values(item).some(visit);
  };
  return visit(value);
}

function historyHasCompletedOutput(data, promptId) {
  const entry = data && typeof data === "object" && data[promptId] && typeof data[promptId] === "object"
    ? data[promptId]
    : data;
  if (!entry || typeof entry !== "object") return false;
  return historyHasMediaOutput(entry.outputs && typeof entry.outputs === "object" ? entry.outputs : entry);
}

function historyIsTerminalFailure(data, promptId) {
  const entry = data && typeof data === "object" && data[promptId] && typeof data[promptId] === "object"
    ? data[promptId]
    : data;
  if (!entry || typeof entry !== "object") return false;
  const status = String(entry.status?.status_str || entry.status?.status || entry.status_str || "").toLowerCase();
  return /(?:error|failed|cancelled|canceled)/.test(status);
}

function createPreloadOwnedPromptPayload(payload) {
  const body = parseWorkflowBody(payload?.init?.body);
  if (!body) return null;
  const clientId = `novaflow_preload_${randomUUID()}`;
  body.client_id = clientId;
  return {
    clientId,
    payload: {
      ...payload,
      init: {
        ...(payload?.init || {}),
        body: JSON.stringify(body)
      }
    }
  };
}

function createRuntimeProviderPriceObserver(meta, payload, clientId) {
  const api = loadArtGenerateProviderWorkflowApi();
  if (!api || typeof api.createPriceObserver !== "function") return null;
  if (!Array.isArray(meta?.providerNodeIds) || meta.providerNodeIds.length === 0) return null;
  try {
    return api.createPriceObserver({
      runtimeBaseUrl: payload?.baseUrl,
      clientId,
      providerNodeIds: meta.providerNodeIds,
      requirePromptOwnership: true,
      WebSocket: NodeWebSocket,
      connectTimeoutMs: 5000
    });
  } catch {
    return null;
  }
}

async function authorizeRuntimeProviderUsage(meta, authorizationToken) {
  const token = String(authorizationToken || "").trim();
  if (!token) {
    return { ok: false, status: 401, error: "请先登录账号后再使用 ComfyUI 云端积分" };
  }
  return await ipcRenderer.invoke("client-auth-ai-task-authorize", {
    token,
    providerKey: meta.providerKey,
    provider: meta.providerKey,
    modelKey: meta.modelKey,
    taskType: meta.taskType,
    estimatedCreditCost: meta.estimatedCreditCost || 0,
    creditCost: meta.creditCost || 0,
    parameters: {
      runtime: "comfyui",
      workflowNodeType: meta.workflowNodeType,
      estimatedCreditCost: meta.estimatedCreditCost || 0,
      creditCost: meta.creditCost || 0,
      pricingStatus: meta.pricingStatus || "pending_pricing",
      pricingSource: meta.pricingSource || "unknown",
      source: "preload-runtime-request-json"
    }
  });
}

async function commitRuntimeProviderUsage(promptId, data) {
  const id = String(promptId || "").trim();
  if (!id || runtimeProviderUsageCommits.has(id)) return null;
  const meta = runtimeProviderPromptMeta.get(id);
  const authorizationToken = String(meta?.authorizationToken || "").trim();
  if (!meta || meta.pendingUsageRecorded || !authorizationToken) return null;
  if (!historyHasCompletedOutput(data, id)) {
    if (historyIsTerminalFailure(data, id)) {
      deleteRuntimeProviderPromptMeta(id);
      const settlement = { ok: true, pending: false, settled: false, status: "not_charged" };
      notifyRuntimeProviderUsageSettlement(id, settlement);
      return settlement;
    }
    return null;
  }
  runtimeProviderUsageCommits.add(id);
  try {
    const observedPrice = meta.priceObserver && typeof meta.priceObserver.waitForExactPrice === "function"
      ? await meta.priceObserver.waitForExactPrice(1800)
      : null;
    const observedCredits = Number(observedPrice?.credits || 0);
    const hasObservedPrice = observedPrice?.exact === true &&
      observedPrice?.source === "comfy_api_exact_price_v1" &&
      /^(?:0|[1-9]\d{0,13})\.\d{6}$/.test(String(observedPrice?.amountText || "")) &&
      Number.isFinite(observedCredits) && observedCredits > 0;
    const exactImageTask = meta.taskType === "local_workflow_image";
    const estimatedCreditCost = hasObservedPrice ? observedCredits : Number(meta.estimatedCreditCost || 0);
    const creditCost = hasObservedPrice ? observedCredits : (exactImageTask ? 0 : Number(meta.creditCost || 0));
    const pricingStatus = hasObservedPrice ? "known" : (exactImageTask ? "pending_pricing" : (meta.pricingStatus || "pending_pricing"));
    const pricingSource = hasObservedPrice ? "comfy_api_exact_price_v1" : (meta.pricingSource || "unknown");
    const result = await ipcRenderer.invoke("client-auth-ai-task-commit-usage", {
      token: authorizationToken,
      providerKey: meta.providerKey,
      provider: meta.providerKey,
      modelKey: meta.modelKey,
      taskType: meta.taskType,
      promptId: id,
      usageKey: `comfyui:${id}`,
      estimatedCreditCost,
      creditCost,
      ...(hasObservedPrice ? { chargeAmount: observedPrice.amountText } : {}),
      pricingSource,
      parameters: {
        runtime: "comfyui",
        workflowNodeType: meta.workflowNodeType || "",
        estimatedCreditCost,
        creditCost,
        pricingStatus,
        pricingSource,
        source: hasObservedPrice ? "preload-runtime-price-event" : "preload-runtime-history"
      }
    });
    if (result && result.ok !== false) {
      const pendingPricing = pricingStatus === "pending_pricing" || !(creditCost > 0);
      meta.pendingUsageRecorded = pendingPricing;
      deleteRuntimeProviderPromptMeta(id);
    } else {
      meta.commitRetryCount = Number(meta.commitRetryCount || 0) + 1;
    }
    const settlementOk = Boolean(result && result.ok !== false);
    const settlement = {
      ok: settlementOk,
      pending: !settlementOk || pricingStatus === "pending_pricing" || !(creditCost > 0),
      settled: Boolean(settlementOk && creditCost > 0),
      status: settlementOk ? (result?.settlement?.status || (creditCost > 0 ? "settled" : "pending_pricing")) : "error"
    };
    if (settlement.ok) {
      notifyRuntimeProviderUsageSettlement(id, {
        settlement: result?.settlement || settlement,
        credits: result?.credits || result?.settlement?.credits || null,
        providerBudget: result?.providerBudget || result?.provider_budget || result?.settlement?.provider_budget || null,
        pricing: result?.pricing || {
          estimatedCreditCost,
          creditCost,
          status: pricingStatus,
          source: pricingSource
        },
        outcome: settlement
      });
    }
    return settlement;
  } catch {
    if (meta) meta.commitRetryCount = Number(meta.commitRetryCount || 0) + 1;
    return { ok: false, pending: true, settled: false, status: "error" };
  } finally {
    runtimeProviderUsageCommits.delete(id);
  }
}

async function monitorRuntimeProviderUsage(promptId) {
  const id = String(promptId || "").trim();
  while (id && runtimeProviderPromptMeta.has(id)) {
    const meta = runtimeProviderPromptMeta.get(id);
    if (!meta) return;
    try {
      const result = await ipcRenderer.invoke("runtime-request-json", {
        baseUrl: meta.runtimeBaseUrl,
        path: `${meta.historyPathPrefix || "/history/"}${encodeURIComponent(id)}`,
        init: { method: "GET", cache: "no-store" }
      });
      const data = result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "data")
        ? result.data
        : result;
      if (result && result.ok !== false) {
        const settlement = await commitRuntimeProviderUsage(id, data);
        if (settlement?.ok) return;
      }
    } catch {}
    if (!runtimeProviderPromptMeta.has(id)) return;
    const currentMeta = runtimeProviderPromptMeta.get(id);
    const retryCount = Math.max(0, Number(currentMeta?.commitRetryCount || 0));
    const retryDelay = retryCount > 0
      ? Math.min(30000, RUNTIME_PROVIDER_HISTORY_POLL_MS * (2 ** Math.min(retryCount, 6)))
      : RUNTIME_PROVIDER_HISTORY_POLL_MS;
    await waitRuntimeProviderHistoryPoll(retryDelay);
  }
}

function startRuntimeProviderUsageMonitor(promptId) {
  const id = String(promptId || "").trim();
  const meta = runtimeProviderPromptMeta.get(id);
  if (!meta || meta.monitorStarted) return;
  meta.monitorStarted = true;
  void monitorRuntimeProviderUsage(id);
}

function cleanupRuntimeProviderPromptMeta() {
  for (const promptId of Array.from(runtimeProviderPromptMeta.keys())) deleteRuntimeProviderPromptMeta(promptId);
}

async function runtimeRequestJsonWithUsage(payload) {
  const url = runtimePayloadUrl(payload);
  const method = runtimePayloadMethod(payload);
  const meta = await detectRuntimeComfyUiUsage(payload);
  const authorizationToken = meta ? String(clientAuthSessionToken || "").trim() : "";
  let requestPayload = payload;
  let priceObserver = null;
  if (meta) {
    const auth = await authorizeRuntimeProviderUsage(meta, authorizationToken);
    if (!auth || auth.ok === false) {
      return {
        ok: false,
        blocked: true,
        status: Number(auth?.httpStatus || auth?.status || 403) || 403,
        error: String(auth?.error || "ComfyUI usage authorization failed"),
        result: auth || null
      };
    }
    if (meta.taskType === "local_workflow_image" && Array.isArray(meta.providerNodeIds) && meta.providerNodeIds.length > 0) {
      const trustedRuntimeBaseUrl = await resolveTrustedRuntimeBaseUrl();
      if (!trustedRuntimeBaseUrl) {
        return {
          ok: false,
          blocked: true,
          status: 403,
          error: "GPT/Google image workflows require a trusted local NovaFlow Runtime"
        };
      }
      const ownedPrompt = createPreloadOwnedPromptPayload(payload);
      if (!ownedPrompt) {
        return { ok: false, blocked: true, status: 400, error: "ComfyUI prompt payload is invalid" };
      }
      requestPayload = { ...ownedPrompt.payload, baseUrl: trustedRuntimeBaseUrl };
      priceObserver = createRuntimeProviderPriceObserver(meta, requestPayload, ownedPrompt.clientId);
      const priceChannelReady = priceObserver ? await priceObserver.ready : false;
      if (!priceChannelReady) {
        try { priceObserver?.close?.(); } catch {}
        return {
          ok: false,
          blocked: true,
          status: 503,
          error: "NovaFlow could not establish the trusted provider Price channel"
        };
      }
    }
  }
  let result;
  try {
    result = await ipcRenderer.invoke("runtime-request-json", requestPayload);
  } catch (error) {
    try { priceObserver?.close?.(); } catch {}
    throw error;
  }
  const data = result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "data") ? result.data : result;
  if (meta && result && result.ok !== false) {
    const promptId = String(data?.prompt_id || data?.data?.prompt_id || "").trim();
    if (promptId) {
      priceObserver?.bindPrompt?.(promptId);
      rememberRuntimeProviderPromptMeta(promptId, {
        ...meta,
        promptId,
        authorizedAt: Date.now(),
        authorizationToken,
        priceObserver,
        runtimeBaseUrl: String(requestPayload?.baseUrl || payload?.baseUrl || "").replace(/\/+$/, ""),
        historyPathPrefix: String(url?.pathname || "").startsWith("/api/") ? "/api/history/" : "/history/"
      });
      startRuntimeProviderUsageMonitor(promptId);
      priceObserver = null;
    }
  }
  try { priceObserver?.close?.(); } catch {}
  if (url && method === "GET" && isRuntimeHistoryPath(url) && result && result.ok !== false) {
    const usageSettlement = await commitRuntimeProviderUsage(runtimeHistoryPromptId(url), data);
    if (usageSettlement && result && typeof result === "object") return { ...result, usageSettlement };
  }
  return result;
}

try { window.addEventListener?.("beforeunload", cleanupRuntimeProviderPromptMeta, { once: true }); } catch {}

contextBridge.exposeInMainWorld("appInfo", {
  platform: process.platform
});

contextBridge.exposeInMainWorld("__NFElectronProfile", {
  snapshot: () => ipcRenderer.invoke("electron-profile-snapshot"),
  reset: () => ipcRenderer.invoke("electron-profile-reset")
});

function getDragEventPointElement(event) {
  try {
    const atPoint = document.elementFromPoint(event.clientX, event.clientY);
    if (atPoint) return atPoint;
  } catch {}
  try {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const candidate = path.find((node) => node && typeof node.closest === "function");
    if (candidate) return candidate;
  } catch {}
  try {
    return event.target && typeof event.target.closest === "function" ? event.target : null;
  } catch {
    return null;
  }
}

function getUploadDropzoneFromEvent(event) {
  const el = getDragEventPointElement(event);
  try {
    return el && el.closest
      ? el.closest('[data-ais-import], [data-nf-upload-dropzone="1"], .nf-upload-dropzone')
      : null;
  } catch {
    return null;
  }
}

function isSourceOwnedBottomUploadSlot(slot) {
  if (!slot) return false;
  try {
    if (slot.getAttribute("data-ais-import") === "color_ref") return false;
    return Boolean(
      slot.closest('[data-novaflow-source-layout="1"]') &&
      slot.closest('[data-novaflow-ai-bottom-workspace="1"]') &&
      slot.closest('[data-novaflow-ai-reference-column="1"]')
    );
  } catch {
    return false;
  }
}

function findSourceOwnedBottomUploadSlotAtPoint(event) {
  const direct = getUploadDropzoneFromEvent(event);
  if (isSourceOwnedBottomUploadSlot(direct)) return direct;
  const x = Number(event && event.clientX);
  const y = Number(event && event.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  try {
    const candidates = Array.from(document.querySelectorAll([
      '[data-novaflow-ai-bottom-workspace="1"][data-novaflow-source-layout="1"] [data-novaflow-ai-reference-column="1"] [data-ais-import]',
      '[data-novaflow-ai-bottom-workspace="1"] [data-novaflow-ai-reference-column="1"][data-novaflow-source-layout="1"] [data-ais-import]',
      '[data-novaflow-ai-bottom-workspace="1"] [data-novaflow-ai-reference-column="1"] [data-ais-import][data-novaflow-source-layout="1"]'
    ].join(",")));
    return candidates.find((slot) => {
      if (!isSourceOwnedBottomUploadSlot(slot)) return false;
      const rect = slot.getBoundingClientRect();
      return rect.width > 4 &&
        rect.height > 4 &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom;
    }) || null;
  } catch {
    return null;
  }
}

function isArtGenerateReferenceSlot(slot) {
  try {
    return Boolean(
      slot &&
      typeof slot.matches === "function" &&
      slot.matches('[data-ais-import^="art_reference_"]') &&
      typeof slot.closest === "function" &&
      slot.closest("#novaflow-art-generate-workspace")
    );
  } catch {
    return false;
  }
}

function getDirectArtGenerateReferenceSlotFromEvent(event) {
  try {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (!node || typeof node.closest !== "function") continue;
      const slot = node.closest('[data-ais-import^="art_reference_"]');
      if (isArtGenerateReferenceSlot(slot)) return slot;
    }
  } catch {}
  try {
    const slot = event.target && typeof event.target.closest === "function"
      ? event.target.closest('[data-ais-import^="art_reference_"]')
      : null;
    return isArtGenerateReferenceSlot(slot) ? slot : null;
  } catch {
    return null;
  }
}

function findArtGenerateReferenceSlotAtPoint(event) {
  const x = Number(event && event.clientX);
  const y = Number(event && event.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  try {
    const atPoint = document.elementFromPoint(x, y);
    const direct = atPoint && typeof atPoint.closest === "function"
      ? atPoint.closest('[data-ais-import^="art_reference_"]')
      : null;
    if (isArtGenerateReferenceSlot(direct)) return direct;
    return Array.from(document.querySelectorAll('#novaflow-art-generate-workspace [data-ais-import^="art_reference_"]')).find((slot) => {
      if (!isArtGenerateReferenceSlot(slot)) return false;
      const rect = slot.getBoundingClientRect();
      return rect.width > 4 &&
        rect.height > 4 &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom;
    }) || null;
  } catch {
    return null;
  }
}

function forwardDropEventToArtGenerateReferenceSlot(slot, dataTransfer) {
  if (!slot) return;
  try {
    let forwardedDrop;
    try {
      forwardedDrop = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer
      });
    } catch {
      forwardedDrop = new Event("drop", { bubbles: true, cancelable: true });
    }
    if (!forwardedDrop.dataTransfer) {
      try {
        Object.defineProperty(forwardedDrop, "dataTransfer", {
          configurable: true,
          enumerable: true,
          value: dataTransfer
        });
      } catch {}
    }
    slot.dispatchEvent(forwardedDrop);
  } catch {}
}

document.addEventListener("dragover", (e) => {
  try {
    const dt = e.dataTransfer;
    const isFiles = (() => {
      try {
        if (dt && dt.files && dt.files.length > 0) return true;
        const types = Array.from((dt && dt.types) || []);
        return types.includes("Files");
      } catch {
        return false;
      }
    })();
    if (!isFiles) return;
    if (
      getDirectArtGenerateReferenceSlotFromEvent(e) ||
      findArtGenerateReferenceSlotAtPoint(e) ||
      findSourceOwnedBottomUploadSlotAtPoint(e)
    ) {
      try { dt.dropEffect = "copy"; } catch {}
    }
    e.preventDefault();
  } catch {}
}, true);

document.addEventListener("drop", (e) => {
  try {
    const dt = e.dataTransfer;
    const files = Array.from((dt && dt.files) || []);
    if (!files.length) return;
    const directArtReferenceSlot = getDirectArtGenerateReferenceSlotFromEvent(e);
    if (directArtReferenceSlot) return;
    const artReferenceSlot = findArtGenerateReferenceSlotAtPoint(e);
    if (artReferenceSlot) {
      e.preventDefault();
      e.stopPropagation();
      try { e.stopImmediatePropagation(); } catch {}
      forwardDropEventToArtGenerateReferenceSlot(artReferenceSlot, dt);
      return;
    }
    const sourceOwnedSlot = findSourceOwnedBottomUploadSlotAtPoint(e);
    if (sourceOwnedSlot) {
      const directSlot = getUploadDropzoneFromEvent(e);
      if (isSourceOwnedBottomUploadSlot(directSlot)) return;
      e.preventDefault();
      e.stopPropagation();
      try { e.stopImmediatePropagation(); } catch {}
      try {
        let forwardedDrop;
        try {
          forwardedDrop = new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt
          });
        } catch {
          forwardedDrop = new Event("drop", { bubbles: true, cancelable: true });
        }
        if (!forwardedDrop.dataTransfer) {
          try {
            Object.defineProperty(forwardedDrop, "dataTransfer", {
              configurable: true,
              enumerable: true,
              value: dt
            });
          } catch {}
        }
        sourceOwnedSlot.dispatchEvent(forwardedDrop);
      } catch {}
      return;
    }
    e.preventDefault();

    const el = getDragEventPointElement(e);
    const targetHint = (() => {
      try {
        if (el && el.closest && el.closest("[data-ais-generated-dock]")) return "dock";
        if (el && el.closest && el.closest('[data-ais-import], [data-nf-upload-dropzone="1"], .nf-upload-dropzone')) return "import";
        if (el && el.closest && el.closest("[data-ais-canvas]")) return "canvas";
      } catch {}
      return "other";
    })();

    const createdAt = Date.now();
    const items = files.map((f, i) => {
      let objectUrl = "";
      try { objectUrl = URL.createObjectURL(f); } catch {}
      const filePath = getFileSystemPath(f);
      if (filePath) {
        try { droppedFilePaths.set(f, filePath); } catch {}
      }
      return {
        id: `local-${createdAt}-${i}-${Math.random().toString(16).slice(2)}`,
        createdAt,
        filename: String(f && f.name ? f.name : `file_${i}`),
        mimeType: String(f && f.type ? f.type : ""),
        size: Number(f && f.size ? f.size : 0) || 0,
        lastModified: Number(f && f.lastModified ? f.lastModified : 0) || 0,
        path: filePath,
        objectUrl
      };
    }).filter((x) => x && x.objectUrl);
    ipcRenderer.send("renderer-files-dropped", { kind: "system_files", targetHint, items, x: e.clientX, y: e.clientY });
  } catch {}
}, true);

contextBridge.exposeInMainWorld("electronAPI", {
  saveSpinePackage: (payload) => ipcRenderer.invoke("save-spine-package", payload),
  saveSplitPackage: (payload) => ipcRenderer.invoke("save-split-package", payload),
  saveSplitTempPackage: (payload) => ipcRenderer.invoke("save-split-temp-package", payload),
  saveSplitDebugImages: (payload) => ipcRenderer.invoke("save-split-debug-images", payload),
  saveSplitPsd: (payload) => ipcRenderer.invoke("save-split-psd", payload),
  openSpineProject: () => ipcRenderer.invoke("open-spine-project"),
  openSpineJson: () => ipcRenderer.invoke("open-spine-json"),
  openSpineAtlas: () => ipcRenderer.invoke("open-spine-atlas"),
  openSpineImage: () => ipcRenderer.invoke("open-spine-image"),
  openSequenceFolder: () => ipcRenderer.invoke("open-sequence-folder"),
  pickDirectory: () => ipcRenderer.invoke("pick-directory"),
  exportPickSaveFile,
  onExportPickSaveFileCanceled,
  exportCreateTempDir: (payload) => ipcRenderer.invoke("export-create-temp-dir", payload),
  exportCleanupDir: (payload) => ipcRenderer.invoke("export-cleanup-dir", payload),
  cutoutRawStart: payload => ipcRenderer.invoke("cutout-raw-start",payload),
  cutoutRawWrite: payload => ipcRenderer.invoke("cutout-raw-write",payload),
  cutoutRawAbort: payload => ipcRenderer.invoke("cutout-raw-abort",payload),
  exportEncodeFramesToVideo: (payload) => ipcRenderer.invoke("export-encode-frames-to-video", payload),
  exportEncodeVideoToVideo: (payload) => ipcRenderer.invoke("export-encode-video-to-video", payload),
  videoCompositorOpenSession: (payload) => ipcRenderer.invoke("video-compositor-session-open", payload),
  videoCompositorRegisterSource: (payload) => ipcRenderer.invoke("video-compositor-source-register", payload),
  videoCompositorReleaseSource: (payload) => ipcRenderer.invoke("video-compositor-source-release", payload),
  videoCompositorPutMask: (payload) => ipcRenderer.invoke("video-compositor-mask-put", payload),
  videoCompositorExport: (payload) => ipcRenderer.invoke("video-compositor-export-start", payload),
  videoCompositorCancel: (payload) => ipcRenderer.invoke("video-compositor-export-cancel", payload),
  videoCompositorCloseSession: (payload) => ipcRenderer.invoke("video-compositor-session-close", payload),
  videoResourceMediaRegister: (payload) => ipcRenderer.invoke("video-resource-media-register", payload),
  videoResourceMediaRelease: (payload) => ipcRenderer.invoke("video-resource-media-release", payload),
  onVideoCompositorProgress: (cb) => {
    const fn = typeof cb === "function" ? cb : null;
    if (!fn) return () => void 0;
    const handler = (_evt, data) => { try { fn(data); } catch {} };
    ipcRenderer.on("video-compositor-export-progress", handler);
    return () => {
      try { ipcRenderer.removeListener("video-compositor-export-progress", handler); } catch {}
    };
  },
  cutoutTraceAppend: (payload) => ipcRenderer.invoke("cutout-trace-append", payload),
  writeBinaryFile: (payload) => ipcRenderer.invoke("write-binary-file", payload),
  compressPngLossless: (payload) => ipcRenderer.invoke("compress-png-lossless", payload),
  compressPngStrong: (payload) => ipcRenderer.invoke("compress-png-strong", payload),
  compressSpineAtlasSafe: (payload) => ipcRenderer.invoke("compress-spine-atlas-safe", payload),
  convertSpineAtlasWebp: (payload) => ipcRenderer.invoke("convert-spine-atlas-webp", payload),
  saveSpineAtlasWebpOutput: (payload) => ipcRenderer.invoke("save-spine-atlas-webp-output", payload),
  overwriteSpineAtlasWebpOutput: (payload) => ipcRenderer.invoke("overwrite-spine-atlas-webp-output", payload),
  getPathForFile: (file) => getFileSystemPath(file),
  saveTextFile: (payload) => ipcRenderer.invoke("save-text-file", payload),
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowToggleMaximize: () => ipcRenderer.invoke("window-toggle-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowSetMinSize: (payload) => ipcRenderer.invoke("window-set-min-size", payload),
  windowEnsureMinSize: (payload) => ipcRenderer.invoke("window-ensure-min-size", payload),
  windowGetPosition: () => ipcRenderer.invoke("window-get-position"),
  windowCaptureContentFrame: () => ipcRenderer.invoke("window-capture-content-frame"),
  windowSetPosition: (payload) => ipcRenderer.invoke("window-set-position", payload),
  getSystemMousePosition: () => ipcRenderer.invoke("system-mouse-position"),
  loadUserData: (key) => ipcRenderer.invoke("user-data-read", key),
  saveUserData: (payload) => ipcRenderer.invoke("user-data-write", payload),
  licenseGetState: () => ipcRenderer.invoke("license-get-state"),
  licenseGetMachineId: () => ipcRenderer.invoke("license-get-machine-id"),
  licenseImportFile: () => ipcRenderer.invoke("license-import-file"),
  licenseImportText: (payload) => ipcRenderer.invoke("license-import-text", payload),
  licenseRemove: () => ipcRenderer.invoke("license-remove"),
  licenseOpenMain: () => ipcRenderer.invoke("license-open-main"),
  clientAuthStatus: () => ipcRenderer.invoke("client-auth-status"),
  clientAuthRegister: (payload) => ipcRenderer.invoke("client-auth-register", payload),
  clientAuthLogin: async (payload) => rememberClientAuthSession(await ipcRenderer.invoke("client-auth-login", payload), payload),
  clientAuthVerify: (payload) => ipcRenderer.invoke("client-auth-verify", payload),
  clientAuthDevLogin: (payload) => ipcRenderer.invoke("client-auth-dev-login", payload),
  clientAuthMe: async (payload) => rememberClientAuthSession(await ipcRenderer.invoke("client-auth-me", payload), payload),
  clientAuthBootstrap: async (payload) => rememberClientAuthSession(await ipcRenderer.invoke("client-auth-bootstrap", payload), payload),
  clientAuthLogout: async (payload) => {
    clearClientAuthSession();
    return await ipcRenderer.invoke("client-auth-logout", payload);
  },
  clientAuthCreditsCheck: async (payload) => rememberClientAuthSession(await ipcRenderer.invoke("client-auth-credits-check", payload), payload),
  clientAuthAiTaskAuthorize: (payload) => ipcRenderer.invoke("client-auth-ai-task-authorize", payload),
  smartAiPromptOptimize: (payload) => ipcRenderer.invoke("smart-ai-prompt-optimize", payload),
  smartAiImageReverse: (payload) => ipcRenderer.invoke("smart-ai-image-reverse", {
    ...(payload && typeof payload === "object" ? payload : {}),
    token: String(clientAuthSessionToken || payload?.token || payload?.sessionToken || payload?.accessToken || "").trim()
  }),
  smartAiStoryboardUnifiedNineShots: (payload) => ipcRenderer.invoke("smart-ai-storyboard-unified-nine-shots", {
    ...(payload && typeof payload === "object" ? payload : {}),
    token: String(clientAuthSessionToken || "").trim()
  }),
  getUserDataPath: () => ipcRenderer.invoke("get-user-data-path"),
  openUserDataFolder: () => ipcRenderer.invoke("open-user-data-folder"),
  templatesResetToBundled: () => ipcRenderer.invoke("templates-reset-to-bundled"),
  getAppVersion: () => ipcRenderer.invoke("app-get-version"),
  getAppInfo: () => ipcRenderer.invoke("app-get-info"),
  runtimeGetStatus: (payload) => ipcRenderer.invoke("runtime-get-status", payload),
  runtimeEnsureStarted: (payload) => ipcRenderer.invoke("runtime-ensure-started", payload),
  runtimeRestart: (payload) => ipcRenderer.invoke("runtime-restart", payload),
  runtimeStop: (payload) => ipcRenderer.invoke("runtime-stop", payload),
  minimaxH3RuntimeGetStatus: (payload) => ipcRenderer.invoke("minimax-h3-runtime-get-status", payload),
  minimaxH3RuntimeEnsureStarted: (payload) => ipcRenderer.invoke("minimax-h3-runtime-ensure-started", payload),
  minimaxH3RuntimeStop: (payload) => ipcRenderer.invoke("minimax-h3-runtime-stop", payload),
  minimaxH3OutputPublish: (payload) => ipcRenderer.invoke("minimax-h3-output-publish", payload),
  minimaxH3OutputList: () => ipcRenderer.invoke("minimax-h3-output-list"),
  qwenLoraCatalog: (payload) => ipcRenderer.invoke("qwen-lora-catalog", payload),
  minimaxH3LoraCatalog: (payload) => ipcRenderer.invoke("minimax-h3-lora-catalog", payload),
  minimaxH3LoraValidate: (payload) => ipcRenderer.invoke("minimax-h3-lora-validate", payload),
  runtimeGetSystemStats: (payload) => ipcRenderer.invoke("runtime-get-system-stats", payload),
  runtimeDiagnosticsSnapshot: (payload) => ipcRenderer.invoke("runtime-diagnostics-snapshot", payload),
  runtimeFreeMemory: (payload) => ipcRenderer.invoke("runtime-free-memory", payload),
  runtimeRequestJson: (payload) => runtimeRequestJsonWithUsage(payload),
  runtimeProviderUsageSettlement: "preload-price-v1",
  runtimeRequestBinary: (payload) => ipcRenderer.invoke("runtime-request-binary", payload),
  runtimeUploadImage: (payload) => ipcRenderer.invoke("runtime-upload-image", payload),
  promptAssistantGetStatus: () => ipcRenderer.invoke("prompt-assistant-get-status"),
  promptAssistantOptimizePrompt: (payload) => ipcRenderer.invoke("prompt-assistant-optimize-prompt", payload),
  promptAssistantStoryboardStoryDirections: (payload) => ipcRenderer.invoke("prompt-assistant-storyboard-story-directions", payload),
  promptAssistantStoryboardVisualEventChain: (payload) => ipcRenderer.invoke("prompt-assistant-storyboard-visual-event-chain", payload),
  promptAssistantStoryboardFinalShotPrompts: (payload) => ipcRenderer.invoke("prompt-assistant-storyboard-final-shot-prompts", payload),
  promptAssistantStoryboardUnifiedNineShots: (payload) => ipcRenderer.invoke("prompt-assistant-storyboard-unified-nine-shots", payload),
  promptAssistantStoryboardDirectorPlan: (payload) => ipcRenderer.invoke("prompt-assistant-storyboard-director-plan", payload),
  promptAssistantReverseImagePrompt: (payload) => ipcRenderer.invoke("prompt-assistant-reverse-image-prompt", payload),
  runtimeOpenAssetsFolder: () => ipcRenderer.invoke("runtime-open-assets-folder"),
  runtimeOpenOutputFolder: () => ipcRenderer.invoke("runtime-open-output-folder"),
  runtimeOpenLogsFolder: () => ipcRenderer.invoke("runtime-open-logs-folder"),
  runtimeOpenInstallFolder: () => ipcRenderer.invoke("runtime-open-install-folder"),
  repairSeeThroughEnv: (payload) => ipcRenderer.invoke("repair-seethrough-env", payload),
  aiSeqFixHeadTailColor: (payload) => ipcRenderer.invoke("ai-seq-fix-head-tail-color", payload),
  aiSeqTrimVideoTailFrame: (payload) => ipcRenderer.invoke("ai-seq-trim-video-tail-frame", payload),
  aiSeqProbeVideoMeta: (payload) => ipcRenderer.invoke("ai-seq-probe-video-meta", payload),
  aiSeqCacheTempFile: (payload) => ipcRenderer.invoke("ai-seq-cache-temp-file", payload),
  aiSeqCacheCopyFromPath: (payload) => ipcRenderer.invoke("ai-seq-cache-copy-from-path", payload),
  aiSeqCacheReserveOutput: (payload) => ipcRenderer.invoke("ai-seq-cache-reserve-output", payload),
  aiSeqCacheReleaseOutput: (payload) => ipcRenderer.invoke("ai-seq-cache-release-output", payload),
  aiSeqReadTempFile: (payload) => ipcRenderer.invoke("ai-seq-read-temp-file", payload),
  onAiSeqFixHeadTailColorProgress: (cb) => {
    const fn = typeof cb === "function" ? cb : null;
    if (!fn) return () => void 0;
    const handler = (_evt, data) => { try { fn(data); } catch {} };
    ipcRenderer.on("ai-seq-fix-head-tail-color-progress", handler);
    return () => {
      try { ipcRenderer.removeListener("ai-seq-fix-head-tail-color-progress", handler); } catch {}
    };
  },
  aiSeqRembgBatch: (payload) => ipcRenderer.invoke("ai-seq-rembg-batch", payload),
  onAiSeqRembgMaskChunk: cb => {
    if(typeof cb!=="function")return()=>{};
    const handler=(_evt,data)=>cb(data);ipcRenderer.on("ai-seq-rembg-mask-chunk",handler);
    return()=>ipcRenderer.removeListener("ai-seq-rembg-mask-chunk",handler);
  },
  onAiSeqRembgBatchProgress: (cb) => {
    const fn = typeof cb === "function" ? cb : null;
    if (!fn) return () => void 0;
    const handler = (_evt, data) => { try { fn(data); } catch {} };
    ipcRenderer.on("ai-seq-rembg-batch-progress", handler);
    return () => {
      try { ipcRenderer.removeListener("ai-seq-rembg-batch-progress", handler); } catch {}
    };
  },
  onRuntimeStatusChanged: (cb) => {
    const fn = typeof cb === "function" ? cb : null;
    if (!fn) return () => void 0;
    const handler = (_evt, data) => { try { fn(data); } catch {} };
    ipcRenderer.on("runtime-status-changed", handler);
    return () => {
      try { ipcRenderer.removeListener("runtime-status-changed", handler); } catch {}
    };
  },
  onFilesDropped: (cb) => {
    const fn = typeof cb === "function" ? cb : null;
    if (!fn) return () => void 0;
    const handler = (_evt, data) => { try { fn(data); } catch {} };
    ipcRenderer.on("renderer-files-dropped", handler);
    return () => {
      try { ipcRenderer.removeListener("renderer-files-dropped", handler); } catch {}
    };
  },
  openExternal: (url) => ipcRenderer.invoke("open-external", { url }),
  isElevated: () => ipcRenderer.invoke("is-elevated"),
  logClientError: (payload) => ipcRenderer.invoke("log-client-error", payload)
});
