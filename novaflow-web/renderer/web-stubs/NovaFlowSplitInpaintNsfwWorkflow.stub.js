// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowSplitInpaintNsfwWorkflow.
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
  __api["CHECKPOINT_NAME"] = "<server-side>";
  __api["normalizeMode"] = function normalizeMode(mode) {
    const normalized = String(mode || '').trim().toLowerCase()
    if (normalized !== 'edit' && normalized !== 'completion') {
      throw new Error('NSFW inpaint workflow mode must be edit or completion')
    }
    return normalized
  };
  __api["assertRuntimeSupport"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  __api["assertPreparedSourceGuide"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  __api["resolveSubjectJoinPolicy"] = function resolveSubjectJoinPolicy(mode, shortEdge) {
    const normalizedMode = normalizeMode(mode)
    const edge = Number(shortEdge)
    if (!Number.isFinite(edge) || edge <= 0) {
      throw new Error('shortEdge must be a positive number for the NSFW subject join policy')
    }
    return {
      ringWidth: normalizedMode === 'completion'
        ? Math.round(Math.max(16, Math.min(32, edge * 0.0625)))
        : 4,
      guideAlphaThreshold: GUIDE_ALPHA_THRESHOLD,
      falloffExponent: normalizedMode === 'completion' ? 0.5 : 1,
      sourceEdgeFeather: normalizedMode === 'completion' ? Math.round(Math.max(8, Math.min(24, edge * 0.03125))) : 0,
      restoreAlpha: true,
    }
  };
  __api["prepareSourceGuide"] = async function prepareSourceGuide(options) {
    const request = options && typeof options === 'object' ? options : {}
    const sourceDataUrl = requiredText(request, 'sourceDataUrl')
    const analysis = analyzeSourceGuideAlpha(request.alphaStats)
    if (analysis.visible < 16) {
      throw new Error('NSFW source guide must contain at least 16 visible pixels')
    }
    if (analysis.hasSubjectSilhouette) {
      return { dataUrl: sourceDataUrl, backgroundRemoved: false }
    }
    if (typeof request.removeBackground !== 'function') {
      throw new Error('removeBackground is required when the NSFW source guide has no valid subject silhouette')
    }
    const dataUrl = String(await request.removeBackground(sourceDataUrl) || '').trim()
    if (!dataUrl) throw new Error('NSFW source guide background removal returned no image')
    return { dataUrl, backgroundRemoved: true }
  };
  __api["buildWorkflow"] = function (options) {
    return __record("NovaFlowSplitInpaintNsfwWorkflow", "buildWorkflow", options);
  };
  root["NovaFlowSplitInpaintNsfwWorkflow"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
