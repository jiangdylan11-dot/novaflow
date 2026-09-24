// Renderer workflow modules the Web line will run.
//
// The browser sends {module, method, options}; this table says what that
// needs. It is an allow-list, so a module nobody vetted cannot be reached even
// though the worker has it loaded - and it is the one place to look when
// asking "which NovaFlow features work on the Web".
//
// Method names here are READ OFF the real modules, not guessed;
// tests/e2e/renderer-workflow.test.mjs fails if any of them stops existing.
//
// `label` is what a user sees. `runtime` picks the ComfyUI instance. `price`
// says how the cost is derived from the recorded options.

export const WORKFLOW_MODULES = Object.freeze({
  'novaflow-brand-runtime': {
    label: '绘图', modelId: 'qwen-image-2511', minVramMb: 16000,
    runtime: 'image', kind: 'image', price: 'image', positional: true,
    methods: ['buildArtGenerateRunWorkflow']
  },
  // Private builders used by the art tools have positional arguments, unlike
  // the exported workflow modules. Only these audited builders are callable.
  // buildSeeThroughSplitWorkflow is 一键拆图: the node runs See-through and
  // copies the layer files back by name (worker-core collectSeeThroughOutputs).
  // The builders whose first argument is the node catalogue (the page sends an
  // empty object) are listed in workflow-host CATALOGUE_FIRST and get this
  // node's catalogue when replayed.
  'spine-split-runtime': {
    label: '美工 · 补图 / 抠图 / 拆图 / 放大 / 扩图 / 迁移 / 角度 / 特效',
    modelId: 'qwen-image-2511',
    minVramMb: 16000,
    runtime: 'image', kind: 'image', price: 'image',
    positional: true,
    methods: [
      'defaultQwenInpaintWorkflow', 'defaultRemovalInpaintWorkflow', 'defaultRmbgWorkflow', 'samPointWorkflowFromPrompts',
      'buildSeeThroughSplitWorkflow', 'buildSeedVr2ImageUpscaleWorkflow', 'buildQwenImageOutpaintWorkflow',
      'buildImageAngleAdjustWorkflow', 'buildObjectTransferQwen21Workflow', 'buildQwenEditPlateWorkflow',
      'buildEffectExtractQwenWorkflow', 'buildEffectDeeffectQwenWorkflow'
    ]
  },
  // ---- 美工 -------------------------------------------------------------
  NovaFlowArtGenerateProviderWorkflow: {
    label: '绘图',
    modelId: 'qwen-image-2511',
    minVramMb: 16000,
    runtime: 'image',
    kind: 'image',
    price: 'image',
    methods: ['buildWorkflow', 'buildRunWorkflow']
  },
  NovaFlowArtGenerateIdeogramWorkflow: {
    label: '绘图 · Ideogram',
    modelId: 'ideogram-4',
    minVramMb: 16000,
    runtime: 'image',
    kind: 'image',
    price: 'image',
    methods: ['build', 'buildWorkflow']
  },

  // ---- UI 设计 ----------------------------------------------------------
  NovaFlowUiDesignLocalWorkflow: {
    label: 'UI 设计',
    modelId: 'qwen-image-2511',
    minVramMb: 16000,
    runtime: 'image',
    kind: 'image',
    price: 'image',
    methods: ['build', 'buildLocalUiWorkflow']
  },
  NovaFlowUiDesignLocalRefineWorkflow: {
    label: 'UI 设计 · 精修',
    modelId: 'qwen-image-2511',
    minVramMb: 16000,
    runtime: 'image',
    kind: 'image',
    price: 'image',
    methods: ['build']
  },

  // ---- AI 序列动画 ------------------------------------------------------
  NovaFlowAiSequenceMiniMaxH3Workflow: {
    label: 'AI 序列动画',
    modelId: 'minimax-h3',
    minVramMb: 15000,
    runtime: 'video',
    kind: 'video',
    price: 'video',
    methods: ['getWorkflowJson', 'buildWorkflow']
  },
  NovaFlowAiSequenceVideoMergeExportWorkflow: {
    label: 'AI 序列 · 合成导出',
    modelId: 'minimax-h3',
    minVramMb: 15000,
    runtime: 'video',
    kind: 'video',
    price: 'video',
    methods: ['createWorkflow']
  },

  // ---- AI 特效 ----------------------------------------------------------
  NovaFlowAifxRestyleWorkflow: {
    label: 'AI 特效',
    modelId: 'minimax-h3',
    minVramMb: 15000,
    runtime: 'video',
    kind: 'video',
    price: 'video',
    methods: ['buildWorkflow']
  },

  // ---- 拆图 / 抠图 ------------------------------------------------------
  NovaFlowSplitInpaintNsfwWorkflow: {
    label: '拆图 · 补全',
    modelId: 'qwen-image-2511',
    minVramMb: 16000,
    runtime: 'image',
    kind: 'image',
    price: 'image',
    methods: ['buildWorkflow']
  }
});

// Build-time file names must resolve to the same public API names accepted by
// the control plane. Private runtimes retain their file name.
export const WORKFLOW_SOURCE_MODULES = Object.freeze({
  'art-generate-provider.workflow': 'NovaFlowArtGenerateProviderWorkflow',
  'art-generate-ideogram.workflow': 'NovaFlowArtGenerateIdeogramWorkflow',
  'ui-design-local.workflow': 'NovaFlowUiDesignLocalWorkflow',
  'ui-design-local-refine.workflow': 'NovaFlowUiDesignLocalRefineWorkflow',
  'ai-sequence-minimax-h3.workflow': 'NovaFlowAiSequenceMiniMaxH3Workflow',
  'ai-sequence-video-merge-export.workflow': 'NovaFlowAiSequenceVideoMergeExportWorkflow',
  'aifx-restyle.workflow': 'NovaFlowAifxRestyleWorkflow',
  'split-inpaint-nsfw.workflow': 'NovaFlowSplitInpaintNsfwWorkflow'
});

export function workflowModule(name) {
  return Object.prototype.hasOwnProperty.call(WORKFLOW_MODULES, String(name || ''))
    ? WORKFLOW_MODULES[String(name)]
    : null;
}

export function isAllowedWorkflowCall(name, method) {
  const entry = workflowModule(name);
  if (!entry) return false;
  return entry.methods.includes(String(method || ''));
}

// The model a renderer run needs. A drawing or UI-design run that asks for Qwen-Image-2.1 records it
// in its run state (__args[8]); the node builds the 2.1 graph under exactly these conditions (see
// buildArtGenerateRunWorkflow), so such a run is queued for the 2.1 model and a node without it
// never claims it.
export function workflowModelId(name, options) {
  const entry = workflowModule(name);
  if (!entry) return null;
  const args = name === 'novaflow-brand-runtime' && Array.isArray(options?.__args) ? options.__args : null;
  if (args && args[0] === 'local') {
    const state = args[8] && typeof args[8] === 'object' ? args[8] : {};
    const profile = String(args[10]?.taskProfile || '');
    const ui = profile.toLowerCase() === 'ui-design' && state.localUiEngine === 'qwen-2.1';
    const draw = !/^ui-design/i.test(profile) && state.localDrawEngine === 'qwen-2.1';
    if (ui || draw) return 'qwen-image-2.1';
  }
  return entry.modelId;
}

export function workflowModuleNames() {
  return Object.keys(WORKFLOW_MODULES);
}

/**
 * Every method a browser may reach, across all modules. The redaction pass
 * force-hollows exactly these, so the PUBLIC entry point records the intent
 * and the private helpers below it are never entered - otherwise the recorded
 * intent would name a private function the worker cannot call.
 */
export function allWorkflowEntryMethods() {
  const names = new Set();
  for (const spec of Object.values(WORKFLOW_MODULES)) {
    for (const method of spec.methods) names.add(method);
  }
  return [...names];
}
