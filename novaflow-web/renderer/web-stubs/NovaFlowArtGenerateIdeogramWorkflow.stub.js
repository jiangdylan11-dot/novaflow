// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowArtGenerateIdeogramWorkflow.
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
  __api["VERSION"] = "20260813-ideogram4-instant-1";
  __api["MODEL_KEY"] = "ideogram4-instant";
  __api["UNET_NAME"] = "<server-side>";
  __api["CLIP_NAME"] = "<server-side>";
  __api["VAE_NAME"] = "<server-side>";
  __api["DEFAULT_WIDTH"] = 720;
  __api["DEFAULT_HEIGHT"] = 1280;
  __api["DEFAULT_SEED"] = 402421902939803;
  __api["PROMPT_NODE_ID"] = "167";
  __api["OUTPUT_NODE_ID"] = "241";
  __api["REQUIRED_NODE_TYPES"] = ["<server-side>","ModelSamplingAuraFlow","<server-side>","ConditioningZeroOut","<server-side>","<server-side>","<server-side>","<server-side>","<server-side>","EmptyFlux2LatentImage"];
  __api["REQUIRED_MODELS"] = {"unet":"<server-side>","clip":"<server-side>","vae":"<server-side>"};
  __api["extractBackground"] = function extractBackground(value) {
    const prompt = String(value == null ? '' : value).trim()
    const labelled = prompt.match(BACKGROUND_LABEL_RE)
    if (labelled && labelled[1].trim()) return labelled[1].trim().slice(0, 160)
    // Free-form prompts: keep the scene clauses, but not ones that also describe the subject,
    // or the character would be painted a second time as part of the background.
    const clauses = prompt.split(/[。；;\n]+/).map((clause) => clause.trim())
      .filter((clause) => clause && BACKGROUND_WORD_RE.test(clause) && !SUBJECT_WORD_RE.test(clause))
    if (clauses.length) return clauses.join('，').slice(0, 160)
    // Nothing scene-like to quote: the whole description is a better background than an empty
    // field or a generic phrase (no duplicated figure showed up on any tested seed).
    return prompt
  };
  __api["compileStructuredPrompt"] = function compileStructuredPrompt(value) {
    const prompt = normalizePrompt(value)
    return JSON.stringify({
      high_level_description: prompt,
      compositional_deconstruction: {
        background: extractBackground(prompt),
        elements: [],
      },
    })
  };
  __api["clone"] = function cloneWorkflow() {
    return cloneValue(WORKFLOW_TEMPLATE)
  };
  __api["cloneWorkflow"] = function cloneWorkflow() {
    return cloneValue(WORKFLOW_TEMPLATE)
  };
  __api["build"] = function (options) {
    return __record("NovaFlowArtGenerateIdeogramWorkflow", "build", options);
  };
  __api["buildWorkflow"] = function (options) {
    return __record("NovaFlowArtGenerateIdeogramWorkflow", "buildWorkflow", options);
  };
  root["NovaFlowArtGenerateIdeogramWorkflow"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
