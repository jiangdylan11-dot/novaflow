// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowUiDesignLocalWorkflow.
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
  __api["VERSION"] = "20260729-local-ui-workflow-25";
  __api["UI_TASK_PROFILE"] = "ui-design";
  __api["REQUIRED_LAYOUT_GUIDE_ENCODING"] = "soft-ui-semantic-scaffold-v2";
  __api["REDESIGN_INTENT"] = "redesign";
  __api["ITERATION_INTENT"] = "iteration";
  __api["QUALITY_MODE"] = "quality";
  __api["PERFORMANCE_MODE"] = "performance";
  __api["QWEN_EDIT_MODEL_NAME"] = "<server-side>";
  __api["QWEN_EDIT_4STEP_LORA"] = "<server-side>";
  __api["ENHANCED_SAMPLING"] = {"editStrength":"enhanced","steps":4,"cfg":1,"samplerName":"euler","scheduler":"simple","denoise":1,"lightning":true};
  __api["FAITHFUL_SAMPLING"] = {"editStrength":"faithful","steps":4,"cfg":1,"samplerName":"euler","scheduler":"simple","denoise":1,"lightning":true};
  __api["RAPID_ENHANCED_SAMPLING"] = {"editStrength":"enhanced","steps":6,"cfg":1,"samplerName":"euler_ancestral","scheduler":"beta","denoise":1,"lightning":false};
  __api["RAPID_FAITHFUL_SAMPLING"] = {"editStrength":"faithful","steps":4,"cfg":1,"samplerName":"euler_ancestral","scheduler":"beta","denoise":1,"lightning":false};
  __api["REDESIGN_SAMPLING"] = {"editStrength":"ui-structure-draft","steps":4,"cfg":1,"samplerName":"euler","scheduler":"simple","denoise":1,"lightning":true};
  __api["QUALITY_REFERENCE_SAMPLING"] = {"editStrength":"ui-native-quality-structure-draft","steps":40,"cfg":4,"samplerName":"euler","scheduler":"simple","denoise":1,"lightning":false,"modelName":"<server-side>"};
  __api["AUTO_PRIMARY_MAX_WORKING_PIXELS"] = 589824;
  __api["validateUiLocalContract"] = function () {
    return { ok: true, valid: true, checkedOn: "compute-node" };
  };
  __api["resolveIntent"] = function resolveIntent(state = {}, referenceRoles = []) {
    const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {}
    const explicit = [
      source.uiRunIntent,
      source.uiGenerationIntent,
      source.generationIntent,
      source.runIntent,
      source.intent,
    ].map((item) => cleanText(item).toLowerCase()).find(Boolean)
    if (explicit === ITERATION_INTENT) return ITERATION_INTENT
    if (explicit === REDESIGN_INTENT) return REDESIGN_INTENT
    if (
      source.iteration === true
      || source.isIteration === true
      || Number(source.iterationReferenceCount) > 0
      || (
        Array.isArray(referenceRoles)
        && referenceRoles.some((item) => referenceRole(item) !== 'ui_layout' && referenceDeclaresIteration(item))
      )
    ) return ITERATION_INTENT
    return REDESIGN_INTENT
  };
  __api["resolveQualityMode"] = function resolveQualityMode(intent, state = {}, roles = []) {
    if (intent === ITERATION_INTENT || state?.nsfw === true) return PERFORMANCE_MODE
    const automaticPrimaryReference = roles.some((item) => (
      item.role === 'reference' && item.autoPrimary === true
    ))
    if (!automaticPrimaryReference) return PERFORMANCE_MODE
    const explicit = cleanText(state?.localUiQualityMode).toLowerCase()
    return explicit === PERFORMANCE_MODE ? PERFORMANCE_MODE : QUALITY_MODE
  };
  __api["compileAntiCopyPrompt"] = function compileAntiCopyPrompt(prompt, options = {}) {
    const source = cleanText(prompt)
    if (source.includes(REDESIGN_ANTI_COPY_PREFIX) || source.includes(ITERATION_ANTI_COPY_PREFIX)) return source
    const intent = resolveIntent(options.state, options.referenceRoles)
    const screenNative = intent !== ITERATION_INTENT
      && cleanText(options.carrierIntent).toLowerCase() !== 'hardware'
    if (options.textOnly === true && intent === REDESIGN_INTENT) {
      return [
        TEXT_ONLY_LAYOUT_CONTRACT,
        screenNative ? `${FULLSCREEN_DIGITAL_UI_CONTRACT}。` : '',
        source,
        screenNative ? FULLSCREEN_DIGITAL_UI_FINAL_OVERRIDE : '',
      ].filter(Boolean).join(' ')
    }
    const layoutGuide = normalizedReferenceRoles(options.referenceRoles)
      .find((item) => item.role === 'ui_layout')
    const layoutGuideImageNumber = layoutGuide ? layoutGuide.index + 1 : 1
    const constraint = intent === ITERATION_INTENT
      ? `${ITERATION_ANTI_COPY_PREFIX}图1是唯一修改底图；其余图像必须按已声明的参考职责真实参与修改。布局参考约束位置、比例、分组、层级和重复项数量；风格、配色与材质参考约束对应的视觉属性；角色、主体与内容参考约束其声明的身份和内容。用户明确要求用于解决冲突，禁止把未要求的Logo、文案或主题身份带入结果。`
      : `${REDESIGN_ANTI_COPY_PREFIX}图${layoutGuideImageNumber}仅是高斯柔性页面结构引导，只表达区域中心、相对占比、顺序、留白与重复项数量，不得输出结构框、底板、辅助线、坐标或标注。其余参考图必须按已声明职责真实参与合成：布局参考保留主要位置、比例、分组、层级、控件关系与重复项数量；风格、配色和材质参考保留对应视觉属性；角色、主体和内容参考保留其声明的身份与内容。用户明确要求用于解决冲突，禁止带入未要求的Logo、文案或主题身份，也不得把同一内容擅自扩展到其他区域。`
    const digitalCanvasConstraint = screenNative ? ` ${FULLSCREEN_DIGITAL_UI_CONTRACT}。` : ''
    const finalOverride = screenNative ? ` ${FULLSCREEN_DIGITAL_UI_FINAL_OVERRIDE}` : ''
    return source
      ? `${constraint}${digitalCanvasConstraint} ${source}${finalOverride}`
      : `${constraint}${digitalCanvasConstraint}${finalOverride}`
  };
  __api["routeLayoutReferenceToLatent"] = function () {
    throw new Error("NovaFlowUiDesignLocalWorkflow.routeLayoutReferenceToLatent runs on the compute node, not in the browser");
  };
  __api["routeSemanticGuideToLatent"] = function () {
    throw new Error("NovaFlowUiDesignLocalWorkflow.routeSemanticGuideToLatent runs on the compute node, not in the browser");
  };
  __api["buildLocalUiWorkflow"] = function (options) {
    return __record("NovaFlowUiDesignLocalWorkflow", "buildLocalUiWorkflow", options);
  };
  __api["build"] = function (options) {
    return __record("NovaFlowUiDesignLocalWorkflow", "build", options);
  };
  root["NovaFlowUiDesignLocalWorkflow"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
