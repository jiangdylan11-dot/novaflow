"""Isolated layer-window extension of our native Qwen 2.1 K-frequency QA.

No learned weights, global patch or prefix mutation. Layer numbers describe
where the operation runs, not independently verified artistic semantics.
"""

from dataclasses import asdict, dataclass, field
import json
import logging

import torch

try:
    from .layout import index_value, sequence_layout
    from .frequency_core import (
        AXES, HEAD_DIM, FrequencyAudit, StyleKeyFrequencyOverride,
        finite_number, frequency_scale_vector, native_sigma_gate,
    )
except ImportError:  # Independent CPU test entry point.
    from layout import index_value, sequence_layout
    from frequency_core import (
        AXES, HEAD_DIM, FrequencyAudit, StyleKeyFrequencyOverride,
        finite_number, frequency_scale_vector, native_sigma_gate,
    )


WRAPPER_KEY = "novaflow_qwen21_style_key_layer_window_experiment_v2"
OLD_FREQUENCY_WRAPPER_KEY = "novaflow_qwen21_style_key_frequency_experiment_v1"


def layer_window(start, end, num_layers=None):
    """Inclusive bounds; validate actual model length once it is available."""
    start = index_value(start, "layer_start")
    end = index_value(end, "layer_end")
    if start > end:
        raise ValueError("layer_start must not exceed inclusive layer_end")
    if num_layers is not None:
        num_layers = index_value(num_layers, "actual layer count")
        if num_layers < 1 or end >= num_layers:
            raise ValueError("Layer window is outside the actual model layer count")
    return start, end


def actual_layer(kwargs, num_layers):
    """Read this attention call, never a stale forward-entry block_index."""
    options = kwargs.get("transformer_options")
    if not isinstance(options, dict) or "block_index" not in options:
        raise ValueError("Layer-window attention requires actual transformer_options.block_index")
    layer = index_value(options["block_index"], "actual block_index")
    if layer >= num_layers:
        raise ValueError("Actual block_index is outside the model layer count")
    if "total_blocks" in options and (
        index_value(options["total_blocks"], "actual total_blocks") != num_layers
    ):
        raise ValueError("Actual total_blocks differs from the inspected model")
    return layer


@dataclass
class LayerWindowAudit(FrequencyAudit):
    selected_target_by_layer: dict = field(default_factory=dict)
    bypassed_target_by_layer: dict = field(default_factory=dict)
    prefix_by_layer: dict = field(default_factory=dict)


def _count(mapping, layer):
    mapping[layer] = mapping.get(layer, 0) + 1


class LayerWindowOverride(StyleKeyFrequencyOverride):
    def __init__(self, layout, style_index, cpu_vector, layer_start=24,
                 layer_end=31, num_layers=32, previous=None, audit=None):
        self.layer_start, self.layer_end = layer_window(layer_start, layer_end, num_layers)
        self.num_layers = num_layers
        super().__init__(layout, style_index, cpu_vector, previous,
                         audit if audit is not None else LayerWindowAudit())
        if style_index < 0 or style_index >= len(layout.references):
            raise ValueError("Style reference index is outside actual references")

    def __call__(self, native_attention, q, k, v, heads, mask=None, **kwargs):
        layer = actual_layer(kwargs, self.num_layers)
        skip_reshape = bool(kwargs.get("skip_reshape", False))
        rank = 4 if skip_reshape else 3
        if any(not isinstance(t, torch.Tensor) or t.ndim != rank for t in (q, k, v)):
            raise ValueError("Unexpected native attention Q/K/V layout")
        q_tokens = int(q.shape[-2] if skip_reshape else q.shape[1])
        k_tokens = int(k.shape[-2] if skip_reshape else k.shape[1])
        target = q_tokens == self.layout.target_tokens and k_tokens == self.layout.total_tokens
        if target and self.layer_start <= layer <= self.layer_end:
            _count(self.audit.selected_target_by_layer, layer)
            return super().__call__(native_attention, q, k, v, heads, mask=mask, **kwargs)

        # No tensor/mask clone, cast or multiply on prefix/unselected layers.
        if target:
            _count(self.audit.bypassed_target_by_layer, layer)
        else:
            self.audit.prefix_calls += 1
            _count(self.audit.prefix_by_layer, layer)
        if self.previous is not None:
            self.audit.previous_override_calls += 1
            return self.previous(native_attention, q, k, v, heads, mask=mask, **kwargs)
        return native_attention(q, k, v, heads, mask=mask, **kwargs)


class LayerWindowForward:
    def __init__(self, style_index, high_scale, low_scale, beta,
                 layer_start, layer_end, num_layers, audit_log=False,
                 cap_amplification=False, active_sigma_min=0.0):
        self.style_index = index_value(style_index, "style_reference_index")
        self.layer_start, self.layer_end = layer_window(layer_start, layer_end, num_layers)
        self.num_layers = num_layers
        self.high_scale, self.low_scale, self.beta = high_scale, low_scale, beta
        self.cap_amplification = cap_amplification
        self.active_sigma_min = finite_number(active_sigma_min, "active_sigma_min", 0.0, 1.0)
        self.cpu_vector = frequency_scale_vector(high_scale, low_scale, beta, cap_amplification)
        self.audit_log = bool(audit_log)
        self.audit = LayerWindowAudit()
        self.preferred_backend_check = None

    def __call__(self, executor, x, timestep, context, ref_latents=None,
                 image_slots=None, transformer_options=None, **kwargs):
        if not isinstance(x, torch.Tensor) or x.ndim != 4:
            raise ValueError("Native layer-window experiment requires a 4D target")
        sigma, active = native_sigma_gate(timestep, int(x.shape[0]), self.active_sigma_min)
        self.audit.forwards += 1
        if active:
            layout = sequence_layout(x, context, ref_latents, image_slots)
            if self.style_index >= len(layout.references):
                raise ValueError("Style reference index is outside actual references")
            options = dict(transformer_options or {})
            options["optimized_attention_override"] = LayerWindowOverride(
                layout, self.style_index, self.cpu_vector,
                self.layer_start, self.layer_end, self.num_layers,
                previous=options.get("optimized_attention_override"), audit=self.audit)
            self.audit.active_forwards += 1
            self.audit.latest_layout = asdict(layout)
        else:
            options = transformer_options
            self.audit.bypassed_forwards += 1
            self.audit.latest_layout = {}
        before = self.audit.key_copies
        before_layers = dict(self.audit.selected_target_by_layer)
        result = executor(x, timestep, context, ref_latents, image_slots, options, **kwargs)
        selected_now = {i: n - before_layers.get(i, 0)
                        for i, n in self.audit.selected_target_by_layer.items()
                        if n != before_layers.get(i, 0)}
        if active and selected_now != {
                i: 1 for i in range(self.layer_start, self.layer_end + 1)}:
            raise ValueError("Selected native layer window was not reached exactly once per target forward")
        if self.audit_log:
            logging.info("Qwen21StyleKeyLayerWindow audit=%s", json.dumps({
                **asdict(self.audit), "key_copies_this_forward": self.audit.key_copies - before,
                "selected_target_this_forward": selected_now,
                "layer_start": self.layer_start, "layer_end": self.layer_end,
                "actual_num_layers": self.num_layers, "style_reference_index": self.style_index,
                "high_scale": self.high_scale, "low_scale": self.low_scale,
                "beta": self.beta, "cap_amplification": self.cap_amplification,
                "active_sigma_min": self.active_sigma_min, "actual_sigma": sigma,
                "active": active, "axes": AXES, "axis0_scale": 1.0,
                "preferred_backend_check": self.preferred_backend_check,
            }, separators=(",", ":")))
        return result


class NovaFlowQwen21StyleKeyLayerWindowExperimental:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "enabled": ("BOOLEAN", {"default": False}),
            "style_reference_index": ("INT", {"default": 1, "min": 0, "max": 15}),
            "high_scale": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 4.0, "step": 0.05}),
            "low_scale": ("FLOAT", {"default": 1.5, "min": 0.0, "max": 4.0, "step": 0.05}),
            "beta": ("FLOAT", {"default": 2.0, "min": 0.01, "max": 16.0, "step": 0.1}),
            "layer_start": ("INT", {"default": 24, "min": 0, "max": 31}),
            "layer_end": ("INT", {"default": 31, "min": 0, "max": 31}),
            "audit_log": ("BOOLEAN", {"default": False}),
        }, "optional": {
            "cap_amplification": ("BOOLEAN", {"default": False}),
            "active_sigma_min": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01}),
        }}

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = "NovaFlow/experimental/qwen21"

    def patch(self, model, enabled=False, style_reference_index=1,
              high_scale=0.5, low_scale=1.5, beta=2.0,
              layer_start=24, layer_end=31, audit_log=False,
              cap_amplification=False, active_sigma_min=0.0):
        if not enabled:
            return (model,)
        vector = frequency_scale_vector(high_scale, low_scale, beta, cap_amplification)
        layer_start, layer_end = layer_window(layer_start, layer_end)
        style_index = index_value(style_reference_index, "style_reference_index")
        threshold = finite_number(active_sigma_min, "active_sigma_min", 0.0, 1.0)
        # No model attribute access or native Comfy import for actual identity.
        if bool(torch.all(vector == 1.0)):
            return (model,)

        from comfy.model_base import QwenImage21
        from comfy.ldm.qwen_image21.model import QwenImage21Transformer2DModel
        import comfy.patcher_extension as extension
        if (type(model.model) is not QwenImage21 or
                type(model.model.diffusion_model) is not QwenImage21Transformer2DModel):
            raise TypeError("Only native QwenImage21 and its native transformer are supported")
        dm = model.model.diffusion_model
        num_layers = len(dm.transformer_blocks)
        layer_window(layer_start, layer_end, num_layers)
        if tuple(dm.pe_embedder.axes_dim) != AXES:
            raise ValueError("Native RoPE axes (16,56,56) are required")
        for block in dm.transformer_blocks:
            if block.attn.to_k.out_features != block.attn.heads * HEAD_DIM:
                raise ValueError("Native 128-dimensional attention heads are required")
        functions = [block.attn.comfy_attention.function for block in dm.transformer_blocks]
        check = {"required": True, "checked_layers": num_layers,
                 "non_null_count": sum(fn is not None for fn in functions)}
        if audit_log:
            logging.info("Qwen21StyleKeyLayerWindow preferred_backend_check=%s", json.dumps(check))
        if check["non_null_count"]:
            raise ValueError("Layer-window QA requires all native preferred attention functions to be None")
        options = extension.copy_nested_dicts(model.model_options)
        transformer_options = options.setdefault("transformer_options", {})
        for key in (WRAPPER_KEY, OLD_FREQUENCY_WRAPPER_KEY):
            if extension.get_wrappers_with_key(extension.WrappersMP.DIFFUSION_MODEL, key, transformer_options):
                raise ValueError("Do not stack old/new frequency-key experimental wrappers")
        previous = transformer_options.get("optimized_attention_override")
        if previous is not None and not callable(previous):
            raise TypeError("Existing optimized_attention_override must be callable")
        wrapper = LayerWindowForward(style_index, high_scale, low_scale, beta,
                                     layer_start, layer_end, num_layers, audit_log,
                                     cap_amplification, threshold)
        wrapper.preferred_backend_check = check
        extension.add_wrapper_with_key(extension.WrappersMP.DIFFUSION_MODEL,
                                       WRAPPER_KEY, wrapper, transformer_options)
        cloned = model.clone()
        cloned.model_options = options
        return (cloned,)


NODE_CLASS_MAPPINGS = {
    "NovaFlowQwen21StyleKeyLayerWindowExperimental": NovaFlowQwen21StyleKeyLayerWindowExperimental,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "NovaFlowQwen21StyleKeyLayerWindowExperimental": "Qwen 2.1 Style Key Layer Window (Experimental)",
}
