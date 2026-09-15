"""Experimental Wan attention-output style statistics from a fixed source image.

This adapts the feature-statistics idea, not the SD StyleAligned Q/K/V hook:
Wan calls attn1_patch after attention and supplies a dictionary. No weights,
module forwards, final pixels, or denoise values are replaced.
"""
import torch
from contextlib import contextmanager
from types import MethodType


def feature_stats(x):
    variance, mean = torch.var_mean(x.float(), dim=1, correction=0, keepdim=True)
    return mean.detach(), variance.add(1e-5).sqrt().detach()


def match_stats(x, reference, strength):
    mean, std = feature_stats(x)
    reference_mean, reference_std = reference
    ratio = (reference_std / std).clamp(.25, 4)
    aligned = (x.float() - mean) * ratio + reference_mean
    return torch.lerp(x.float(), aligned, strength).to(x.dtype)


class SourceStyleReference:
    def __init__(self, model, source, strength=.6, max_sigma=.55, seed=9122026):
        if not 0 <= strength <= 1 or not 0 < max_sigma <= 1:
            raise ValueError('Invalid reference strength or sigma range')
        if source.ndim != 5 or source.shape[0] != 1 or source.shape[2] != 1:
            raise ValueError('Reference wash requires one image in Wan latent format')
        self.strength = strength
        self.max_sigma = max_sigma
        self.source = model.model.process_latent_in(source.detach().cpu())
        generator = torch.Generator(device='cpu').manual_seed(seed)
        self.noise = torch.randn(self.source.shape, generator=generator)
        self.sampling = model.get_model_object('model_sampling')
        self.telemetry = {'referencePasses': 0, 'targetPasses': 0, 'styledAttentionCalls': 0,
                          'maxStatisticsBlocks': 0}

    def attention(self, args):
        x = args['x']
        options = args['transformer_options']
        context = options.get('novaflow_wash_reference')
        if not context:
            return x
        block = options['block_index']
        if context['capture']:
            context['statistics'][block] = feature_stats(x)
            return x
        if block not in context['statistics']:
            raise RuntimeError(f'No source style statistics for Wan block {block}')
        self.telemetry['styledAttentionCalls'] += 1
        return match_stats(x, context['statistics'][block], self.strength)

    def wrap(self, model_function, args):
        x, sigma = args['input'], args['timestep']
        c = args['c']
        self.telemetry['targetPasses'] += 1
        if self.strength == 0 or float(sigma.max()) > self.max_sigma:
            return model_function(x, sigma, **c)
        if x.shape[1:] != self.source.shape[1:]:
            raise ValueError('Source reference and sampled image latent sizes must match')
        if c.get('control') is not None:
            raise ValueError('Prototype does not support ControlNet batching')
        source = self.source.to(device=x.device, dtype=x.dtype).expand(x.shape[0], -1, -1, -1, -1)
        noise = self.noise.to(device=x.device, dtype=x.dtype).expand_as(source)
        reference_input = self.sampling.noise_scaling(sigma, noise, source)
        statistics = {}

        def conditioning(capture):
            copied = dict(c)
            copied['transformer_options'] = dict(c.get('transformer_options', {}))
            copied['transformer_options']['novaflow_wash_reference'] = {
                'capture': capture, 'statistics': statistics}
            return copied

        try:
            # Sequential passes preserve the runtime's existing CFG batching and
            # avoid doubling activation memory on a 16 GB GPU.
            model_function(reference_input, sigma, **conditioning(True))
            self.telemetry['referencePasses'] += 1
            self.telemetry['maxStatisticsBlocks'] = max(self.telemetry['maxStatisticsBlocks'], len(statistics))
            if not statistics:
                raise RuntimeError('Wan attention patch was not called; refusing a silent no-op')
            return model_function(x, sigma, **conditioning(False))
        finally:
            statistics.clear()


def attach_source_style(model, latent, strength=.6, max_sigma=.55, seed=9122026):
    if model.model_options.get('model_function_wrapper'):
        raise ValueError('Existing model wrapper cannot be silently overwritten')
    reference = SourceStyleReference(model, latent['samples'], strength, max_sigma, seed)
    patched = model.clone()
    patched.set_model_attn1_patch(reference.attention)
    patched.set_model_unet_function_wrapper(reference.wrap)
    return patched, reference


class SharedKVReference(SourceStyleReference):
    """Isolated worker experiment; temporarily replaces only instance methods.

    Original modules/weights/names remain intact. CPU storage bounds retained
    GPU memory. This is not a production node and must run in its own process.
    """
    def shared_attention(self, module, x, freqs, options, original):
        context = options.get('novaflow_wash_reference')
        if context is None:
            return original(x, freqs, transformer_options=options)
        from comfy.ldm.wan.model import apply_rope1, optimized_attention
        b, s = x.shape[:2]
        n, d = module.num_heads, module.head_dim
        q = apply_rope1(module.norm_q(module.q(x)).view(b, s, n, d), freqs)
        k = apply_rope1(module.norm_k(module.k(x)).view(b, s, n, d), freqs)
        q_flat, k_flat = q.reshape(b, s, n*d), k.reshape(b, s, n*d)
        v = module.v(x).reshape(b, s, n*d)
        block = options['block_index']
        ordinary = optimized_attention(q_flat, k_flat, v, heads=n, transformer_options=options)
        if context['capture']:
            context['statistics'][block] = {
                'q': tuple(t.cpu() for t in feature_stats(q_flat)),
                'k': k_flat.detach().cpu(), 'v': v.detach().cpu()}
            output = ordinary
        else:
            reference = context['statistics'][block]
            q_aligned = match_stats(q_flat, tuple(t.to(q.device) for t in reference['q']), self.strength)
            shared = optimized_attention(
                q_aligned, torch.cat((reference['k'].to(k_flat), k_flat), dim=1),
                torch.cat((reference['v'].to(v), v), dim=1), heads=n, transformer_options=options)
            output = torch.lerp(ordinary, shared, self.strength)
            self.telemetry['styledAttentionCalls'] += 1
        for patch in options.get('patches', {}).get('attn1_patch', []):
            output = patch({'x': output, 'q': q, 'k': k, 'transformer_options': options})
        return module.o(output)

    @contextmanager
    def installed(self, model):
        from comfy.ldm.wan.model import WanSelfAttention
        modules = [block.self_attn for block in model.model.diffusion_model.blocks]
        if any(type(module) is not WanSelfAttention for module in modules):
            raise ValueError('Experimental shared KV requires the inspected Wan self-attention implementation')
        originals = []
        try:
            for module in modules:
                old = module.forward
                had_instance_forward = 'forward' in module.__dict__
                originals.append((module, old, had_instance_forward))
                def forward(attention_module, x, freqs, transformer_options=None, original=old):
                    return self.shared_attention(attention_module, x, freqs, transformer_options or {}, original)
                module.forward = MethodType(forward, module)
            yield
        finally:
            for module, old, had_instance_forward in originals:
                if had_instance_forward:
                    module.forward = old
                else:
                    del module.forward


def attach_shared_kv(model, latent, strength=.6, max_sigma=1, seed=9122026):
    if model.model_options.get('model_function_wrapper'):
        raise ValueError('Existing model wrapper cannot be silently overwritten')
    reference = SharedKVReference(model, latent['samples'], strength, max_sigma, seed)
    patched = model.clone()
    patched.set_model_unet_function_wrapper(reference.wrap)
    return patched, reference
