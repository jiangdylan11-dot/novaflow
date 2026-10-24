"""Isolated Qwen 2.1 style-reference K-channel frequency modulation experiment.

Motivated by Untwisting RoPE, Eq. 9/10 (arXiv:2602.05013). This is an
unvalidated port of its key-scaling idea, not a full reproduction or adapter.
"""

from dataclasses import asdict, dataclass, field
import json
import logging
import math
import numbers

import torch

try:
    from .layout import index_value, sequence_layout
except ImportError:  # Standalone CPU test entry in this directory.
    from layout import index_value, sequence_layout


WRAPPER_KEY = "novaflow_qwen21_style_key_frequency_experiment_v1"
AXES = (16, 56, 56)
HEAD_DIM = 128


def finite_number(value, name, minimum, maximum, inclusive_minimum=True):
    if isinstance(value, bool) or not isinstance(value, numbers.Real):
        raise ValueError(f"{name} must be a finite number")
    value = float(value)
    valid_min = value >= minimum if inclusive_minimum else value > minimum
    if not math.isfinite(value) or not valid_min or value > maximum:
        raise ValueError(f"{name} is outside the supported finite range")
    return value


def frequency_scale_vector(high_scale, low_scale, beta, cap_amplification=False):
    """CPU vector: axis 0 untouched; each x/y complex pair shares its scale."""
    if not isinstance(cap_amplification, bool):
        raise ValueError("cap_amplification must be a boolean")
    high = finite_number(high_scale, "high_scale", 0.0, 8.0)
    low = finite_number(low_scale, "low_scale", 0.0, 8.0)
    exponent = finite_number(beta, "beta", 0.0, 100.0, inclusive_minimum=False)
    vector = torch.ones(HEAD_DIM, dtype=torch.float32, device="cpu")
    offset = AXES[0]
    for axis_dim in AXES[1:]:
        normalized_pair = torch.linspace(0.0, 1.0, axis_dim // 2, dtype=torch.float32)
        pair_scales = high + (low - high) * normalized_pair.pow(exponent)
        if cap_amplification:
            pair_scales = pair_scales.clamp_max(1.0)
        vector[offset:offset + axis_dim] = pair_scales.repeat_interleave(2)
        offset += axis_dim
    return vector


def native_sigma_gate(timestep, batch, active_sigma_min):
    """Read native sigma, rejecting mixed-timestep batches instead of guessing."""
    threshold = finite_number(active_sigma_min, "active_sigma_min", 0.0, 1.0)
    if (not isinstance(timestep, torch.Tensor) or
            not timestep.is_floating_point()):
        raise ValueError("Native sigma must be a floating scalar or 1D tensor")
    batch = index_value(batch, "batch")
    if batch <= 0:
        raise ValueError("Native sigma requires a positive actual batch size")
    sigma = timestep.detach()
    if sigma.ndim == 0:
        sigma = sigma.reshape(1)
    if sigma.ndim != 1 or sigma.numel() not in (1, batch):
        raise ValueError("Native sigma must be scalar or match the actual batch")
    # This tiny audit/decision transfer preserves input dtype. In particular,
    # float32(.90) compares with float32(.90), rather than a float64 threshold.
    values = sigma.to(device="cpu")
    if not bool(torch.isfinite(values).all()) or bool(((values < 0) | (values > 1)).any()):
        raise ValueError("Expected finite native sigma in [0,1], not timestep*1000")
    if not bool((values == values[0]).all()):
        raise ValueError("This QA frequency schedule rejects mixed-sigma batches")
    actual_sigma = float(values[0])
    active = bool(values[0] >= values.new_tensor(threshold))
    return actual_sigma, active


@dataclass
class FrequencyAudit:
    forwards: int = 0
    active_forwards: int = 0
    bypassed_forwards: int = 0
    target_calls: int = 0
    prefix_calls: int = 0
    key_copies: int = 0
    previous_override_calls: int = 0
    latest_layout: dict = field(default_factory=dict)


class StyleKeyFrequencyOverride:
    def __init__(self, layout, style_index, cpu_vector, previous=None, audit=None):
        if previous is not None and not callable(previous):
            raise TypeError("Existing optimized_attention_override must be callable")
        self.layout = layout
        self.style_index = style_index
        self.cpu_vector = cpu_vector
        self.previous = previous
        self.audit = audit if audit is not None else FrequencyAudit()
        self._device_vectors = {}  # Lives only for this one conditional forward.

    def __call__(self, native_attention, q, k, v, heads, mask=None, **kwargs):
        skip_reshape = bool(kwargs.get("skip_reshape", False))
        wanted_rank = 4 if skip_reshape else 3
        if any(t.ndim != wanted_rank for t in (q, k, v)):
            raise ValueError("Unexpected native attention Q/K/V layout")
        q_tokens = int(q.shape[-2] if skip_reshape else q.shape[1])
        k_tokens = int(k.shape[-2] if skip_reshape else k.shape[1])
        target_call = (q_tokens == self.layout.target_tokens and
                       k_tokens == self.layout.total_tokens)
        if target_call:
            if q.shape[0] != self.layout.batch or k.shape[0] != self.layout.batch:
                raise ValueError("Attention batch differs from this conditional forward")
            head_count = index_value(heads, "heads")
            if head_count <= 0:
                raise ValueError("Attention needs a positive head count")
            if skip_reshape:
                valid = k.shape[1] == head_count and k.shape[-1] == HEAD_DIM
            else:
                valid = k.shape[-1] == head_count * HEAD_DIM
            if not valid:
                raise ValueError("Only native 128-dimension Qwen 2.1 heads are supported")
            key = (k.device, k.dtype)
            scale = self._device_vectors.get(key)
            if scale is None:
                scale = self.cpu_vector.to(device=k.device, dtype=k.dtype)
                self._device_vectors[key] = scale
            span = self.layout.references[self.style_index]
            # Never mutate input/cached K. The one additional full K allocation
            # is an explicit memory cost of this conservative isolated port.
            changed_k = k.clone()
            if skip_reshape:
                style_keys = changed_k[:, :, span.start:span.end, :]
            else:
                style_keys = changed_k[:, span.start:span.end, :].reshape(
                    k.shape[0], span.end - span.start, head_count, HEAD_DIM)
            # Axis 0 is not even multiplied by 1, so its original bits remain.
            style_keys[..., AXES[0]:] *= scale[AXES[0]:]
            k = changed_k
            self.audit.target_calls += 1
            self.audit.key_copies += 1
        else:
            self.audit.prefix_calls += 1
        if self.previous is not None:
            self.audit.previous_override_calls += 1
            return self.previous(native_attention, q, k, v, heads, mask=mask, **kwargs)
        return native_attention(q, k, v, heads, mask=mask, **kwargs)


class StyleKeyFrequencyForward:
    def __init__(self, style_index, high_scale, low_scale, beta, audit_log=False,
                 cap_amplification=False, active_sigma_min=0.0):
        self.style_index = style_index
        self.high_scale = high_scale
        self.low_scale = low_scale
        self.beta = beta
        self.cap_amplification = cap_amplification
        self.active_sigma_min = finite_number(active_sigma_min, "active_sigma_min", 0.0, 1.0)
        self.cpu_vector = frequency_scale_vector(high_scale, low_scale, beta,
                                                  cap_amplification=cap_amplification)
        self.audit_log = bool(audit_log)
        self.audit = FrequencyAudit()
        self.preferred_backend_check = None  # Filled by the native MODEL node.

    def __call__(self, executor, x, timestep, context, ref_latents=None,
                 image_slots=None, transformer_options=None, **kwargs):
        if not isinstance(x, torch.Tensor) or x.ndim != 4:
            raise ValueError("Native frequency schedule requires a 4D target tensor")
        actual_sigma, active = native_sigma_gate(timestep, int(x.shape[0]), self.active_sigma_min)
        if active:
            layout = sequence_layout(x, context, ref_latents, image_slots)
            if self.style_index >= len(layout.references):
                raise ValueError(f"Style reference index {self.style_index} is outside {len(layout.references)} images")
            options = dict(transformer_options or {})
            previous = options.get("optimized_attention_override")
            options["optimized_attention_override"] = StyleKeyFrequencyOverride(
                layout, self.style_index, self.cpu_vector, previous, self.audit)
            self.audit.latest_layout = asdict(layout)
            self.audit.active_forwards += 1
        else:
            # Exact drop-through: preserve the original options object and any
            # prior override/backend; no frequency override or options clone.
            options = transformer_options
            self.audit.latest_layout = {}
            self.audit.bypassed_forwards += 1
        self.audit.forwards += 1
        before_target, before_prefix = self.audit.target_calls, self.audit.prefix_calls
        result = executor(x, timestep, context, ref_latents, image_slots, options, **kwargs)
        if self.audit_log:
            logging.info("Qwen21StyleKeyFrequency audit=%s", json.dumps({
                **asdict(self.audit),
                "target_calls_this_forward": self.audit.target_calls - before_target,
                "prefix_calls_this_forward": self.audit.prefix_calls - before_prefix,
                "style_reference_index": self.style_index,
                "high_scale": self.high_scale,
                "low_scale": self.low_scale,
                "beta": self.beta,
                "cap_amplification": self.cap_amplification,
                "active_sigma_min": self.active_sigma_min,
                "actual_sigma": actual_sigma,
                "active": active,
                "sigma_comparison": "input dtype; all batch rows must match",
                "preferred_backend_check": self.preferred_backend_check,
                "axes": AXES,
                "axis0_scale": 1.0,
            }, separators=(",", ":")))
        return result


class NovaFlowQwen21StyleKeyFrequencyExperimental:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "enabled": ("BOOLEAN", {"default": False}),
            "style_reference_index": ("INT", {"default": 1, "min": 0, "max": 15}),
            "high_scale": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 4.0, "step": 0.05}),
            "low_scale": ("FLOAT", {"default": 1.5, "min": 0.0, "max": 4.0, "step": 0.05}),
            "beta": ("FLOAT", {"default": 2.0, "min": 0.01, "max": 16.0, "step": 0.1}),
            "audit_log": ("BOOLEAN", {"default": False}),
        }, "optional": {
            "cap_amplification": ("BOOLEAN", {"default": False}),
            "active_sigma_min": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01}),
        }}

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = "NovaFlow/experimental/qwen21"

    def patch(self, model, enabled=False, style_reference_index=1, high_scale=0.5,
              low_scale=1.5, beta=2.0, audit_log=False, cap_amplification=False,
              active_sigma_min=0.0):
        if not enabled:
            return (model,)
        # Validate finite parameters without loading or touching model weights.
        vector = frequency_scale_vector(high_scale, low_scale, beta,
                                        cap_amplification=cap_amplification)
        threshold = finite_number(active_sigma_min, "active_sigma_min", 0.0, 1.0)
        identity = bool(torch.all(vector == 1.0))
        if identity and threshold == 0:
            return (model,)
        style_index = index_value(style_reference_index, "style_reference_index")
        from comfy.model_base import QwenImage21
        from comfy.ldm.qwen_image21.model import QwenImage21Transformer2DModel
        import comfy.patcher_extension as extension
        if (type(model.model) is not QwenImage21 or
                type(model.model.diffusion_model) is not QwenImage21Transformer2DModel):
            raise TypeError("Only native QwenImage21 and its native transformer are supported")
        dm = model.model.diffusion_model
        if tuple(dm.pe_embedder.axes_dim) != AXES:
            raise ValueError("This experiment requires native Qwen 2.1 RoPE axes (16,56,56)")
        for block in dm.transformer_blocks:
            attention = block.attn
            if attention.to_k.out_features != attention.heads * HEAD_DIM:
                raise ValueError("This experiment requires 128-dimension attention heads")
        preferred_check = {"required": threshold > 0, "checked_layers": 0,
                           "non_null_count": None}
        if threshold > 0:
            # Active override dispatch can bypass a layer's preferred backend;
            # inactive drop-through restores it. Reject that confound for this
            # timing-only QA without executing or replacing any backend.
            functions = [block.attn.comfy_attention.function for block in dm.transformer_blocks]
            preferred_check.update(checked_layers=len(functions),
                                   non_null_count=sum(fn is not None for fn in functions))
        if audit_log:
            logging.info("Qwen21StyleKeyFrequency preferred_backend_check=%s",
                         json.dumps(preferred_check, separators=(",", ":")))
        if threshold > 0 and preferred_check["non_null_count"]:
            raise ValueError("Sigma-gated frequency QA requires all native preferred attention functions to be None")
        if identity:
            return (model,)
        cloned = model.clone()
        options = extension.copy_nested_dicts(cloned.model_options)
        transformer_options = options.setdefault("transformer_options", {})
        if extension.get_wrappers_with_key(extension.WrappersMP.DIFFUSION_MODEL,
                                           WRAPPER_KEY, transformer_options):
            raise ValueError("Do not stack this experimental frequency-key node")
        wrapper = StyleKeyFrequencyForward(style_index, float(high_scale), float(low_scale),
                                          float(beta), audit_log,
                                          cap_amplification=cap_amplification,
                                          active_sigma_min=threshold)
        wrapper.preferred_backend_check = preferred_check
        extension.add_wrapper_with_key(extension.WrappersMP.DIFFUSION_MODEL,
                                       WRAPPER_KEY, wrapper, transformer_options)
        cloned.model_options = options
        return (cloned,)


NODE_CLASS_MAPPINGS = {
    "NovaFlowQwen21StyleKeyFrequencyExperimental": NovaFlowQwen21StyleKeyFrequencyExperimental,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "NovaFlowQwen21StyleKeyFrequencyExperimental": "Qwen 2.1 Style Key Frequency (Experimental)",
}
