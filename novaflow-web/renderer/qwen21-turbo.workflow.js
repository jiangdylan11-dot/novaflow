(function (root) {
  'use strict'
  // Comfy-Org's Qwen 2.1 Turbo template ships this exact eight-step grid.
  // A plain eight-step `simple` schedule is a different experiment.
  const SIGMAS = '1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0'
  function apply(workflow, options) {
    // Shared editing tools keep the publisher's CFG 1. Drawing can opt in to
    // explicit guidance without replacing the dedicated eight-step schedule.
    const cfg = options?.cfg == null ? 1 : Number(options.cfg)
    if (!Number.isFinite(cfg) || cfg < 1 || cfg > 10) throw new Error('Turbo CFG 必须在 1 到 10 之间')
    for (const [id, node] of Object.entries(workflow)) {
      if (node?.class_type !== 'KSampler') continue
      const input = node.inputs
      if (Number(input.denoise) !== 1) throw new Error('Turbo 线路仅支持完整的八步采样，未套用普通版调度')
      let prefix = 'nf_turbo_' + id
      while (workflow[prefix + '_sigmas'] || workflow[prefix + '_sampler']) prefix += '_'
      workflow[prefix + '_sigmas'] = { class_type: 'ManualSigmas', inputs: { sigmas: SIGMAS } }
      workflow[prefix + '_sampler'] = { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } }
      workflow[id] = { class_type: 'SamplerCustom', inputs: {
        model: input.model, add_noise: true, noise_seed: input.seed, cfg,
        positive: input.positive, negative: input.negative, latent_image: input.latent_image,
        sampler: [prefix + '_sampler', 0], sigmas: [prefix + '_sigmas', 0],
      } }
    }
    return workflow
  }
  root.NovaFlowQwen21Turbo = Object.freeze({ apply, SIGMAS })
})(typeof globalThis !== 'undefined' ? globalThis : this)
