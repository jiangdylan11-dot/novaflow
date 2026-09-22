// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowAiSequenceOutpaintWorkflow.
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
  __api["sourceFingerprint"] = function sourceFingerprint(source) {
    const id = String(source && source.id || '')
    const fileName = String(source && source.fileName || source && source.name || 'source.png')
    const width = Math.round(Number(source && source.width) || 0)
    const height = Math.round(Number(source && source.height) || 0)
    const lastModified = Math.round(Number(source && source.lastModified) || 0)
    return `${id}|${fileName}|${width}x${height}|${lastModified}|${dataUrlSignature(source && source.dataUrl)}`
  };
  __api["prepareStrictFrame"] = async function prepareStrictFrame(options = {}) {
    const source = options.source && typeof options.source === 'object' ? options.source : null
    if (!source) throw new TypeError('Strict-frame source is required')
    const frameMode = options.frameMode || (typeof globalThis !== 'undefined' && globalThis.NovaFlowAiSequenceFrameMode)
    if (!frameMode || typeof frameMode.computeOutpaintPlan !== 'function') {
      throw new TypeError('AI sequence frame-mode helper is unavailable')
    }
    const plan = frameMode.computeOutpaintPlan(
      { width: source.width, height: source.height },
      options.targetRatio,
      options.planOptions,
    )
    const fingerprint = sourceFingerprint(source)
    if (!plan.required) {
      return {
        ...source,
        derived: false,
        derivedFrom: '',
        sourceFingerprint: fingerprint,
        targetRatio: plan.targetRatio,
      }
    }
    if (!/^data:image\//i.test(String(source.dataUrl || ''))) {
      throw new TypeError('Strict-frame outpaint requires an image data URL')
    }
    if (typeof options.outpaint !== 'function') throw new TypeError('Strict-frame outpaint adapter is required')
    const result = await options.outpaint({
      dataUrl: source.dataUrl,
      fileName: String(source.fileName || source.name || 'source.png'),
      sourceSize: plan.sourceSize,
      targetSize: plan.targetSize,
      delta: plan.delta,
      targetRatio: plan.targetRatio,
    })
    if (result == null || result.canceled === true) {
      const error = new Error('AI sequence outpaint canceled')
      error.code = 'AI_SEQUENCE_OUTPAINT_CANCELED'
      throw error
    }
    const outputWidth = Math.round(Number(result && result.width) || 0)
    const outputHeight = Math.round(Number(result && result.height) || 0)
    if (outputWidth !== plan.targetSize.width || outputHeight !== plan.targetSize.height) {
      throw new Error(`Outpaint output size ${outputWidth}x${outputHeight} does not match ${plan.targetSize.width}x${plan.targetSize.height}`)
    }
    if (!/^data:image\//i.test(String(result && result.dataUrl || ''))) {
      throw new Error('Outpaint output is not an image data URL')
    }
    return {
      ...result,
      width: outputWidth,
      height: outputHeight,
      derived: true,
      derivedFrom: String(source.id || ''),
      sourceFingerprint: fingerprint,
      targetRatio: plan.targetRatio,
    }
  };
  root["NovaFlowAiSequenceOutpaintWorkflow"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
