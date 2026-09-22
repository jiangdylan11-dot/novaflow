// GENERATED COPY - do not edit here.
// Source: packages/shared/src/workflow-modules.mjs
// Regenerate with: npm run sync:edge
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
  'spine-split-runtime': {
    label: '美工 · 补图 / 智能抠图',
    modelId: 'qwen-image-2511',
    minVramMb: 16000,
    runtime: 'image', kind: 'image', price: 'image',
    positional: true,
    methods: ['defaultQwenInpaintWorkflow', 'defaultRmbgWorkflow']
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
