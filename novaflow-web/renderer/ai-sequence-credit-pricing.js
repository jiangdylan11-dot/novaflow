(function (global) {
  "use strict";

  const START_LABEL = "生成";
  const CREDITS_PER_USD = 211;
  const KLING_MAX_TOTAL_SECONDS = 15;
  const DEFAULT_RUNTIME_BASE_URL = "http://127.0.0.1:8188";
  const NODE_DEFINITION_RETRY_DELAYS_MS = [250, 750, 1500, 3000, 6000, 12000, 24000];
  const BUTTON_SELECTOR = '[data-novaflow-ai-generate-button="1"]';
  const LABEL_UPDATED_EVENT = "novaflow:ai-sequence-credit-label-updated";
  const compiledExpressions = new Map();
  const nodeDefinitionRequests = new Map();
  const labelCache = new Map();
  const labelRequests = new Map();
  const retryAttempts = new Map();
  const retryTimers = new Map();
  let latestSignature = "";

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeWidgetValue(value, declaredType) {
    if (value === undefined || value === null) return null;
    const type = String(declaredType || "").toUpperCase();
    if (type === "INT" || type === "FLOAT") return finiteNumber(value);
    if (type === "BOOLEAN") {
      if (typeof value === "boolean") return value;
      const text = String(value).trim().toLowerCase();
      if (text === "true") return true;
      if (text === "false") return false;
      return null;
    }
    if (type === "COMBO") {
      if (typeof value === "number" || typeof value === "boolean") return value;
    }
    return String(value).trim().toLowerCase();
  }

  function getNodeType(snapshot) {
    const sharedResolver = global.NovaFlowAiSequenceFrameMode?.resolveNodeType;
    if (typeof sharedResolver === "function") return sharedResolver(snapshot);
    if (!snapshot || String(snapshot.mode || "") !== "cloud") return "";
    const provider = String(snapshot.provider || "").trim().toLowerCase();
    const firstLast = String(snapshot.genType || "") === "first_last";
    const strictFirstFrame = firstLast || snapshot.params?.strictFirstFrame === true;
    if (provider === "kling") {
      if (firstLast) return "KlingFirstLastFrameNode";
      return strictFirstFrame ? "KlingVideoNode" : "KlingOmniProImageToVideoNode";
    }
    if (provider === "jimeng") return strictFirstFrame ? "ByteDance2FirstLastFrameNode" : "ByteDance2ReferenceNode";
    return "";
  }

  function clampInteger(value, fallback, min, max) {
    const number = Math.round(Number(value));
    const normalized = Number.isFinite(number) ? number : fallback;
    return Math.max(min, Math.min(max, normalized));
  }

  function getEffectiveKlingStoryboardDurations(params, storyboardCount) {
    const durations = [];
    let total = 0;
    for (let index = 1; index <= storyboardCount; index += 1) {
      const requested = clampInteger(params[`storyboard${index}Duration`], 4, 1, KLING_MAX_TOTAL_SECONDS);
      const remainingShots = storyboardCount - index;
      const remainingBudget = KLING_MAX_TOTAL_SECONDS - total;
      const effective = Math.max(1, Math.min(requested, remainingBudget - remainingShots));
      durations.push(effective);
      total += effective;
    }
    return durations;
  }

  function buildRawWidgetValues(snapshot) {
    const params = snapshot && snapshot.params && typeof snapshot.params === "object"
      ? snapshot.params
      : {};
    const provider = String(snapshot && snapshot.provider || "").trim().toLowerCase();
    const values = {};

    if (provider === "kling") {
      const storyboardCount = Math.max(1, Math.min(6, Math.round(Number(params.storyboardCount) || 1)));
      const storyboardDurations = getEffectiveKlingStoryboardDurations(params, storyboardCount);
      const resolution = params.resolution || "720p";
      const route = global.NovaFlowAiSequenceFrameMode?.resolveRoute?.(snapshot || {});
      values["model.resolution"] = resolution;
      values.resolution = resolution;
      values.model_name = route?.modelName || "kling-v3-omni";
      values.generate_audio = params.generateAudio !== false;
      values.multi_shot = `${storyboardCount} storyboard${storyboardCount > 1 ? "s" : ""}`;
      values["multi_shot.duration"] = Number(params.duration) || 4;
      values.duration = getNodeType(snapshot) === "KlingOmniProImageToVideoNode"
        ? storyboardDurations.reduce((total, duration) => total + duration, 0)
        : Number(params.duration) || 5;
      for (let index = 1; index <= 6; index += 1) {
        values[`multi_shot.storyboard_${index}_duration`] = index <= storyboardCount
          ? storyboardDurations[index - 1]
          : 0;
      }
      return values;
    }

    values.model = params.model || "Seedance 2.0";
    values["model.resolution"] = params.resolution || "720p";
    values["model.duration"] = Math.max(4, Math.min(15, Math.round(Number(params.duration) || 7)));
    return values;
  }

  function buildPricingContext(snapshot, priceBadge) {
    const dependencies = priceBadge && priceBadge.depends_on || {};
    const rawWidgets = buildRawWidgetValues(snapshot || {});
    const widgets = {};
    for (const dependency of dependencies.widgets || []) {
      widgets[dependency.name] = normalizeWidgetValue(rawWidgets[dependency.name], dependency.type);
    }

    const inputs = {};
    for (const inputName of dependencies.inputs || []) {
      inputs[inputName] = { connected: false };
    }

    const inputGroups = {};
    for (const groupName of dependencies.input_groups || []) {
      inputGroups[groupName] = groupName === "model.reference_videos"
        ? Math.max(0, Math.round(Number(snapshot && snapshot.referenceVideoCount) || 0))
        : 0;
    }
    return { widgets, inputs, inputGroups };
  }

  function getJsonataFactory() {
    return typeof global.jsonata === "function" ? global.jsonata : null;
  }

  async function evaluatePriceBadge(priceBadge, context) {
    if (!priceBadge || !priceBadge.expr || String(priceBadge.engine || "jsonata") !== "jsonata") return null;
    const factory = getJsonataFactory();
    if (!factory) return null;
    const expressionText = String(priceBadge.expr);
    let expression = compiledExpressions.get(expressionText);
    if (!expression) {
      expression = factory(expressionText);
      compiledExpressions.set(expressionText, expression);
    }
    return expression.evaluate(context);
  }

  function formatCreditsValue(usd) {
    const value = finiteNumber(usd);
    if (value === null) return "";
    const rawCredits = value * CREDITS_PER_USD;
    const rounded = Math.round(rawCredits * 10) / 10;
    const showDecimal = Math.abs(rounded - Math.round(rounded)) > 1e-9;
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: showDecimal ? 1 : 0,
    }).format(rawCredits);
  }

  function formatPricingResult(result) {
    if (!result || typeof result !== "object") return "";
    const format = result.format && typeof result.format === "object" ? result.format : {};
    const prefix = format.approximate ? "~" : "";
    if (result.type === "usd") {
      const value = formatCreditsValue(result.usd);
      return value ? `${prefix}${value}` : "";
    }
    if (result.type === "range_usd") {
      const min = formatCreditsValue(result.min_usd);
      const max = formatCreditsValue(result.max_usd);
      if (!min || !max) return "";
      return `${prefix}${min === max ? min : `${min}-${max}`}`;
    }
    if (result.type === "list_usd" && Array.isArray(result.usd)) {
      const values = result.usd.map(formatCreditsValue).filter(Boolean);
      return values.length ? `${prefix}${values.join(format.separator || "/")}` : "";
    }
    if (result.type === "text") return String(result.text || "").trim();
    if (!("type" in result) && "usd" in result) return formatCreditsValue(result.usd);
    return "";
  }

  function formatButtonLabel(result) {
    const value = formatPricingResult(result);
    return value ? `${START_LABEL} · ${value}分` : START_LABEL;
  }

  async function evaluateButtonLabel(snapshot, priceBadge) {
    if (!getNodeType(snapshot)) return START_LABEL;
    const context = buildPricingContext(snapshot, priceBadge);
    const result = await evaluatePriceBadge(priceBadge, context);
    return formatButtonLabel(result);
  }

  function getRuntimeBaseUrl() {
    try {
      const stored = global.localStorage && global.localStorage.getItem("comfyui_last_connected_url");
      const value = String(stored || DEFAULT_RUNTIME_BASE_URL).trim();
      return value.replace(/\/+$/, "") || DEFAULT_RUNTIME_BASE_URL;
    } catch {
      return DEFAULT_RUNTIME_BASE_URL;
    }
  }

  async function loadNodeDefinition(nodeType) {
    const baseUrl = getRuntimeBaseUrl();
    const cacheKey = `${baseUrl}|${nodeType}`;
    if (nodeDefinitionRequests.has(cacheKey)) return nodeDefinitionRequests.get(cacheKey);

    const request = (async () => {
      if (typeof global.fetch !== "function") return null;
      const response = await global.fetch(`${baseUrl}/object_info/${encodeURIComponent(nodeType)}`, {
        method: "GET",
      });
      if (!response || !response.ok) return null;
      const payload = await response.json();
      return payload && (payload[nodeType] || payload.data && payload.data[nodeType]) || null;
    })().catch(() => null);

    nodeDefinitionRequests.set(cacheKey, request);
    const nodeDefinition = await request;
    if (!nodeDefinition || !nodeDefinition.price_badge) nodeDefinitionRequests.delete(cacheKey);
    return nodeDefinition;
  }

  function stableSerialize(value) {
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function snapshotSignature(snapshot) {
    return stableSerialize({
      mode: snapshot && snapshot.mode,
      provider: snapshot && snapshot.provider,
      genType: snapshot && snapshot.genType,
      referenceVideoCount: snapshot && snapshot.referenceVideoCount,
      params: snapshot && snapshot.params || {},
    });
  }

  function trimLabelCache() {
    while (labelCache.size > 64) labelCache.delete(labelCache.keys().next().value);
  }

  function applyResolvedLabel(signature, label) {
    if (latestSignature !== signature) return;
    let changed = false;
    try {
      const button = global.document && global.document.querySelector(BUTTON_SELECTOR);
      if (button && button.isConnected !== false && button.textContent !== label) {
        button.textContent = label;
        changed = true;
      }
    } catch {}
    if (!changed || typeof global.dispatchEvent !== "function" || typeof global.Event !== "function") return;
    try {
      global.dispatchEvent(new global.Event(LABEL_UPDATED_EVENT));
    } catch {}
  }

  function clearRetryState(signature) {
    const timer = retryTimers.get(signature);
    if (timer !== undefined) global.clearTimeout(timer);
    retryTimers.delete(signature);
    retryAttempts.delete(signature);
  }

  function clearAllRetryState() {
    for (const timer of retryTimers.values()) global.clearTimeout(timer);
    retryTimers.clear();
    retryAttempts.clear();
  }

  function reset() {
    latestSignature = "";
    clearAllRetryState();
  }

  function scheduleNodeDefinitionRetry(signature, snapshot, nodeType) {
    if (latestSignature !== signature || labelCache.has(signature) || retryTimers.has(signature)) return;
    const attempt = retryAttempts.get(signature) || 0;
    if (attempt >= NODE_DEFINITION_RETRY_DELAYS_MS.length) return;
    retryAttempts.set(signature, attempt + 1);
    const timer = global.setTimeout(() => {
      retryTimers.delete(signature);
      if (latestSignature !== signature || labelCache.has(signature)) return;
      startLabelRequest(snapshot, nodeType, signature);
    }, NODE_DEFINITION_RETRY_DELAYS_MS[attempt]);
    retryTimers.set(signature, timer);
  }

  function startLabelRequest(snapshot, nodeType, signature) {
    if (labelRequests.has(signature)) return;
    const request = (async () => {
      const nodeDefinition = await loadNodeDefinition(nodeType);
      if (!nodeDefinition || !nodeDefinition.price_badge) {
        applyResolvedLabel(signature, START_LABEL);
        scheduleNodeDefinitionRetry(signature, snapshot, nodeType);
        return START_LABEL;
      }
      clearRetryState(signature);
      const label = await evaluateButtonLabel(snapshot, nodeDefinition.price_badge);
      labelCache.set(signature, label);
      trimLabelCache();
      applyResolvedLabel(signature, label);
      return label;
    })().catch(() => {
      scheduleNodeDefinitionRetry(signature, snapshot, nodeType);
      return START_LABEL;
    }).finally(() => labelRequests.delete(signature));
    labelRequests.set(signature, request);
  }

  function getButtonLabel(snapshot) {
    const nodeType = getNodeType(snapshot);
    if (!nodeType) {
      reset();
      return START_LABEL;
    }

    const signature = snapshotSignature(snapshot);
    if (latestSignature && latestSignature !== signature) clearAllRetryState();
    latestSignature = signature;
    if (labelCache.has(signature)) return labelCache.get(signature);
    startLabelRequest(snapshot, nodeType, signature);
    return START_LABEL;
  }

  global.NovaFlowAiSequenceCreditPricing = Object.freeze({
    getNodeType,
    buildPricingContext,
    evaluatePriceBadge,
    formatPricingResult,
    formatButtonLabel,
    evaluateButtonLabel,
    getButtonLabel,
    reset,
  });
})(typeof window !== "undefined" ? window : globalThis);
