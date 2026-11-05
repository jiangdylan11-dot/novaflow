// Only the retired Rapid drawing/editing builders are blocked. Shared split
// and inpaint workflows may use the same checkpoint and remain unchanged.
export function assertSupportedDrawingGraph(intent, graph, task = null) {
  const draw = intent?.module === 'novaflow-brand-runtime' && intent?.method === 'buildArtGenerateRunWorkflow'
    || intent?.module === 'NovaFlowArtGenerateProviderWorkflow' && ['buildWorkflow','buildRunWorkflow'].includes(intent?.method)
    || intent?.module === 'NovaFlowSplitInpaintNsfwWorkflow' && intent?.method === 'buildWorkflow';
  if (draw && Object.values(graph || {}).some(node => node?.class_type === 'CheckpointLoaderSimple' &&
      /(?:^|[\\/])Qwen-Rapid-AIO-NSFW-v20\.safetensors$/i.test(String(node?.inputs?.ckpt_name || '')))) {
    throw Object.assign(new Error('旧版 Rapid 生图与编辑路线已退役，本次未执行。'),{errorCode:'retired-rapid-drawing'});
  }
}
