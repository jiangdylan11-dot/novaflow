// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowComfyWorkflowCreditCost.
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
  __api["PROVIDER_KEY"] = "comfyui";
  __api["SUPPORTED_NODE_TYPES"] = ["KlingVideoNode","KlingFirstLastFrameNode","KlingOmniProImageToVideoNode","ByteDance2ReferenceNode","ByteDance2FirstLastFrameNode","OpenAIGPTImage1","OpenAIGPTImageNodeV2","GeminiImageNode","GeminiImage2Node"];
  __api["estimateWorkflowCreditCost"] = function estimateWorkflowCreditCost(workflow, options = {}) {
    const providerNodes = findProviderWorkflowNodes(workflow)
    const providerNode = providerNodes[0] || null
    if (!providerNode && !options.allowCloudPrompt) return null

    const node = providerNode?.node || null
    const nodeType = providerNode?.nodeType || 'comfyui_cloud_prompt'
    const inputs = node?.inputs && typeof node.inputs === 'object' ? node.inputs : {}
    if (IMAGE_NODE_TYPE_SET.has(nodeType)) {
      const selectedModel = String(inputs.model || nodeType).trim().toLowerCase()
      return {
        providerKey: PROVIDER_KEY,
        modelKey: selectedModel || nodeType.toLowerCase(),
        taskType: 'local_workflow_image',
        workflowNodeType: nodeType,
        known: false,
        estimatedCreditCost: 0,
        creditCost: 0,
        pricingStatus: 'pending_pricing',
        pricingSource: 'unknown',
      }
    }
    const explicit = providerNodes.length > 1 ? 0 : (readExplicitCreditCost(inputs) || readExplicitCreditCost(workflow))
    let estimatedCreditCost = explicit
    let pricingSource = explicit > 0 ? 'workflow_explicit' : 'unknown'

    if (providerNodes.length === 1 && estimatedCreditCost <= 0 && nodeType === 'KlingOmniProImageToVideoNode') {
      estimatedCreditCost = estimateKlingOmniCreditCost(inputs)
      if (estimatedCreditCost > 0) pricingSource = 'kling_omni_static_v1'
    } else if (providerNodes.length === 1 && estimatedCreditCost <= 0 && (nodeType === 'KlingVideoNode' || nodeType === 'KlingFirstLastFrameNode')) {
      estimatedCreditCost = estimateKlingCreditCost(inputs)
      if (estimatedCreditCost > 0) pricingSource = 'kling_static_v1'
    } else if (providerNodes.length === 1 && estimatedCreditCost <= 0 && (nodeType === 'ByteDance2ReferenceNode' || nodeType === 'ByteDance2FirstLastFrameNode')) {
      estimatedCreditCost = estimateJimengCreditCost(inputs, nodeType)
      if (estimatedCreditCost > 0) pricingSource = 'jimeng_static_v1'
    }

    const known = Number.isFinite(estimatedCreditCost) && estimatedCreditCost > 0
    const normalizedEstimate = known ? estimatedCreditCost : 0
    return {
      providerKey: PROVIDER_KEY,
      modelKey: providerNode ? nodeType.toLowerCase() : 'comfyui-cloud',
      taskType: 'local_workflow_video',
      workflowNodeType: nodeType,
      known,
      estimatedCreditCost: normalizedEstimate,
      creditCost: known ? Math.ceil(normalizedEstimate) : 0,
      pricingStatus: known ? 'known' : 'pending_pricing',
      pricingSource,
    }
  };
  root["NovaFlowComfyWorkflowCreditCost"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
