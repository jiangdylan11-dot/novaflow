// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowUiDesignLocalRefineWorkflow.
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
  __api["VERSION"] = "20260729-ui-local-refine-workflow-7";
  __api["TASK_PROFILE"] = "ui-design-refine";
  __api["POLISH_PRESET"] = "polish";
  __api["ENHANCED_REDRAW_PRESET"] = "enhanced-redraw";
  __api["MIN_DENOISE"] = 0.05;
  __api["MAX_DENOISE"] = 1;
  __api["REPAIR_MASK_ENCODING"] = "semantic-repair-mask-v1";
  __api["PRESETS"] = {"polish":{"name":"polish","steps":20,"cfg":4,"samplerName":"euler","scheduler":"simple","denoise":0.35,"lightning":false},"enhanced-redraw":{"name":"enhanced-redraw","steps":40,"cfg":4,"samplerName":"euler","scheduler":"simple","denoise":0.55,"lightning":false}};
  __api["RAPID_PRESETS"] = {"polish":{"name":"polish","steps":6,"cfg":1,"samplerName":"euler_ancestral","scheduler":"beta","denoise":0.35,"lightning":false},"enhanced-redraw":{"name":"enhanced-redraw","steps":6,"cfg":1,"samplerName":"euler_ancestral","scheduler":"beta","denoise":0.58,"lightning":false}};
  __api["normalizePreset"] = function normalizePreset(value) {
    const key = text(value).toLowerCase().replace(/[\s_]+/g, '-')
    if (['enhanced', 'redraw', 'enhanced-redraw'].includes(key)) return ENHANCED_REDRAW_PRESET
    return POLISH_PRESET
  };
  __api["resolveDenoise"] = function resolveDenoise(value, preset) {
    return clamp(finiteNumber(value, preset.denoise), MIN_DENOISE, MAX_DENOISE)
  };
  __api["build"] = function (options) {
    return __record("NovaFlowUiDesignLocalRefineWorkflow", "build", options);
  };
  root["NovaFlowUiDesignLocalRefineWorkflow"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
