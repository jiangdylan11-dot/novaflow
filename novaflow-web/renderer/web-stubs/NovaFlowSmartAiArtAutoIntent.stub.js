// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowSmartAiArtAutoIntent.
// UI helpers are kept verbatim; every graph builder is replaced by a
// recorder, so this file contains no ComfyUI topology (asserted by
// tools/generate-workflow-stubs.mjs --check and by the protocol suite).
(function (root) {
  const __record = (module, method, options) => {
    const intent = { __novaflowWorkflowIntent: true, module, method, options };
    try { (root.NovaFlowWebRuntime && root.NovaFlowWebRuntime.recordWorkflowIntent || (() => {}))(intent); } catch (_) {}
    return intent;
  };
  const __api = {};
  __api["version"] = "20260811-art-auto-intent-1";
  __api["providerStorageKey"] = "novaflow.smart-ai.art.provider.v1";
  __api["derive"] = function derive(options) {
    const source = options || {};
    const imageCount = Math.max(0, Math.min(3, Math.round(Number(source.imageCount) || 0)));
    const userIntent = clean(source.userIntent);
    const referencePlan = deriveReferenceRoles({
      imageCount,
      userIntent,
      roleOverrides: source.roleOverrides
    });
    const hasReferences = imageCount > 0;
    const inferredStyle = inferStyle(userIntent, imageCount);
    return Object.freeze({
      version: VERSION,
      userIntent,
      imageCount,
      hasReferences,
      route: imageCount === 0 ? "optimize" : imageCount === 1 ? "static_reverse" : "role_reference",
      purpose: imageCount === 0
        ? (source.hadInitialPrompt ? "optimize" : "create")
        : imageCount === 1 ? "static-image-reverse" : "roleReference",
      generationMode: hasReferences ? "img2img" : "txt2img",
      task: inferTask(userIntent, imageCount),
      style: inferredStyle === "original" && referencePlan.roles.includes("style") ? "reference" : inferredStyle,
      preserveLevel: inferPreserveLevel(userIntent),
      backgroundMode: inferBackgroundMode(userIntent),
      roles: Object.freeze(referencePlan.roles.slice()),
      unresolvedRoleIndices: Object.freeze(referencePlan.unresolvedIndices.slice()),
      roleConfidence: referencePlan.confidence,
      canSubmit: hasReferences || Boolean(userIntent) || Boolean(source.hadInitialPrompt)
    });
  };
  __api["deriveReferenceRoles"] = function deriveReferenceRoles(options) {
    const source = options || {};
    const count = Math.max(0, Math.min(3, Math.round(Number(source.imageCount) || 0)));
    if (!count) return { roles: [], unresolvedIndices: [], confidence: "high" };
    const overrides = normalizeRoleOverrides(source.roleOverrides, count);
    const roles = Array.from({ length: count }, () => "composition");
    const unresolvedIndices = [];
    roles[0] = "subject";
    for (let index = 1; index < count; index += 1) {
      const explicitRole = roleFromExplicitImageInstruction(source.userIntent, index + 1);
      if (overrides[index]) {
        roles[index] = overrides[index];
      } else if (explicitRole) {
        roles[index] = explicitRole;
      } else {
        roles[index] = DEFAULT_SECONDARY_ROLES[index - 1] || "composition";
        unresolvedIndices.push(index);
      }
    }
    return {
      roles,
      unresolvedIndices,
      confidence: unresolvedIndices.length ? "low" : "high"
    };
  };
  __api["normalizeProvider"] = function normalizeProvider(value) {
    const provider = clean(value).toLowerCase();
    return PROVIDERS.has(provider) ? provider : "";
  };
  __api["readProviderPreference"] = function readProviderPreference(storage) {
    try {
      return normalizeProvider(storage?.getItem?.(PROVIDER_STORAGE_KEY));
    } catch {
      return "";
    }
  };
  __api["writeProviderPreference"] = function writeProviderPreference(storage, value) {
    const provider = normalizeProvider(value);
    if (!provider) return false;
    try {
      storage?.setItem?.(PROVIDER_STORAGE_KEY, provider);
      return true;
    } catch {
      return false;
    }
  };
  root["NovaFlowSmartAiArtAutoIntent"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
