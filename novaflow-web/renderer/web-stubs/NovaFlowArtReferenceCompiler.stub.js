// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowArtReferenceCompiler.
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
  __api["version"] = "20260721-reference-compiler-1";
  __api["imageRoles"] = {};
  __api["compile"] = function (options) {
    return __record("NovaFlowArtReferenceCompiler", "compile", options);
  };
  __api["clearCache"] = () => CACHE.clear();
  root["NovaFlowArtReferenceCompiler"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
