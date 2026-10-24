"""Experimental native Qwen Image 2.1 reference-key attention gains.

No model weights, trained style projector, global monkey patch, or prompt rewrite.
This is a reference-block weighting experiment, not a disentangled style adapter.
"""

from dataclasses import asdict, dataclass, field
import json
import logging
import math
import numbers

import torch


WRAPPER_KEY = "novaflow_qwen21_reference_attention_experiment_v1"
MIN_GAIN = 1e-6  # Zero means finite strong suppression, not removing a reference.


@dataclass(frozen=True)
class ReferenceSpan:
    start: int
    end: int


@dataclass(frozen=True)
class SequenceLayout:
    references: tuple[ReferenceSpan, ...]
    target_tokens: int
    prefix_tokens: int
    total_tokens: int
    batch: int


@dataclass
class AttentionAudit:
    forwards: int = 0
    target_calls: int = 0
    prefix_calls: int = 0
    delegated_override_calls: int = 0
    latest_layout: dict = field(default_factory=dict)


def _index(value, name):
    if isinstance(value, bool) or not isinstance(value, numbers.Integral) or value < 0:
        raise ValueError(f"{name} must be a nonnegative integer (zero based)")
    return int(value)


def _gain(value, name):
    if isinstance(value, bool) or not isinstance(value, numbers.Real):
        raise ValueError(f"{name} must be a finite nonnegative number")
    value = float(value)
    if not math.isfinite(value) or value < 0 or value > 16:
        raise ValueError(f"{name} must be finite and between 0 and 16")
    return value


def sequence_layout(x, context, ref_latents, image_slots):
    """Mirror the native build_sequence ordering without materializing embeddings."""
    if not isinstance(x, torch.Tensor) or x.ndim != 4:
        raise ValueError("Native 2.1 target must be a 4D tensor")
    if not isinstance(context, torch.Tensor) or context.ndim != 3:
        raise ValueError("Native 2.1 context must be a 3D tensor")
    if context.shape[0] != x.shape[0] or min(x.shape) <= 0 or context.shape[1] <= 0:
        raise ValueError("Target/context batch or dimensions do not match")
    refs = list(ref_latents or [])
    slots = list(image_slots or [])
    text_tokens = int(context.shape[1])
    if len(slots) > len(refs):
        raise ValueError("More image_slots than reference images")
    # The native model appends missing image slots at the end of text.
    slots = (slots + [text_tokens] * len(refs))[:len(refs)]
    slots = [_index(slot, "image_slots item") for slot in slots]
    if any(slot > text_tokens for slot in slots) or slots != sorted(slots):
        raise ValueError("image_slots must be ordered within the actual context")
    spans = []
    previous_reference_tokens = 0
    for index, (ref, slot) in enumerate(zip(refs, slots)):
        if not isinstance(ref, torch.Tensor) or ref.ndim != 4:
            raise ValueError(f"Reference {index} must use the native 4D latent contract")
        if ref.shape[:2] != x.shape[:2] or min(ref.shape) <= 0:
            raise ValueError(f"Reference {index} batch/channels do not match the target")
        count = int(ref.shape[-2] * ref.shape[-1])
        start = slot + previous_reference_tokens
        spans.append(ReferenceSpan(start, start + count))
        previous_reference_tokens += count
    prefix = text_tokens + previous_reference_tokens
    target = int(x.shape[-2] * x.shape[-1])
    return SequenceLayout(tuple(spans), target, prefix, prefix + target, int(x.shape[0]))


class ReferenceAttentionOverride:
    """Compose with the existing native optimized_attention_override contract."""

    def __init__(self, layout, gains, previous=None, audit=None):
        if previous is not None and not callable(previous):
            raise TypeError("Existing optimized_attention_override must be callable")
        self.layout = layout
        self.gains = dict(gains)
        self.previous = previous
        self.audit = audit if audit is not None else AttentionAudit()

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
            self.audit.target_calls += 1
            if q.shape[0] != self.layout.batch or k.shape[0] != self.layout.batch:
                raise ValueError("Attention batch differs from this conditional forward")
            # Broadcast key-only bias, O(K) storage. Native target queries attend
            # the full prefix whether it was computed now or read from cache.
            bias = q.new_zeros((1, 1, k_tokens))
            for index, gain in self.gains.items():
                span = self.layout.references[index]
                bias[..., span.start:span.end] = math.log(max(MIN_GAIN, gain))
            if mask is None:
                mask = bias
            else:
                if mask.shape[-1] != k_tokens:
                    raise ValueError("Attention mask key length does not match the sequence")
                if mask.dtype == torch.bool:
                    mask = torch.zeros_like(mask, dtype=q.dtype, device=q.device).masked_fill(
                        ~mask.to(q.device), float("-inf"))
                else:
                    mask = mask.to(device=q.device, dtype=q.dtype)
                mask = mask + bias
        else:
            # Prefix text and reference self-attention receive exactly the
            # original Q/K/V and mask; no prefix cached values are modified.
            self.audit.prefix_calls += 1
        if self.previous is not None:
            self.audit.delegated_override_calls += 1
            return self.previous(native_attention, q, k, v, heads, mask=mask, **kwargs)
        return native_attention(q, k, v, heads, mask=mask, **kwargs)


class ReferenceForwardWrapper:
    def __init__(self, source_index, style_index, source_gain, style_gain, audit_log=False):
        self.source_index = source_index
        self.style_index = style_index
        self.source_gain = source_gain
        self.style_gain = style_gain
        self.audit_log = bool(audit_log)
        self.audit = AttentionAudit()

    def __call__(self, executor, x, timestep, context, ref_latents=None,
                 image_slots=None, transformer_options=None, **kwargs):
        layout = sequence_layout(x, context, ref_latents, image_slots)
        for name, index in (("source", self.source_index), ("style", self.style_index)):
            if index >= len(layout.references):
                raise ValueError(f"{name} reference index {index} is outside {len(layout.references)} images")
        options = dict(transformer_options or {})
        previous = options.get("optimized_attention_override")
        options["optimized_attention_override"] = ReferenceAttentionOverride(
            layout,
            {self.source_index: self.source_gain, self.style_index: self.style_gain},
            previous=previous, audit=self.audit,
        )
        self.audit.forwards += 1
        self.audit.latest_layout = asdict(layout)
        before_target = self.audit.target_calls
        before_prefix = self.audit.prefix_calls
        result = executor(x, timestep, context, ref_latents, image_slots, options, **kwargs)
        if self.audit_log:
            logging.info("Qwen21ReferenceAttention audit=%s", json.dumps({
                **asdict(self.audit),
                "target_calls_this_forward": self.audit.target_calls - before_target,
                "prefix_calls_this_forward": self.audit.prefix_calls - before_prefix,
                "source_reference_index": self.source_index,
                "style_reference_index": self.style_index,
                "source_reference_attention_gain": self.source_gain,
                "style_reference_attention_gain": self.style_gain,
            }, separators=(",", ":")))
        return result


class NovaFlowQwen21ReferenceAttentionExperimental:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "enabled": ("BOOLEAN", {"default": False}),
            "source_reference_index": ("INT", {"default": 0, "min": 0, "max": 15}),
            "style_reference_index": ("INT", {"default": 1, "min": 0, "max": 15}),
            "source_reference_attention_gain": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.05}),
            "style_reference_attention_gain": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.05}),
            "audit_log": ("BOOLEAN", {"default": False}),
        }}

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = "NovaFlow/experimental/qwen21"

    def patch(self, model, enabled=False, source_reference_index=0, style_reference_index=1,
              source_reference_attention_gain=1.0, style_reference_attention_gain=1.0,
              audit_log=False):
        if not enabled:
            return (model,)
        source_gain = _gain(source_reference_attention_gain, "source_reference_attention_gain")
        style_gain = _gain(style_reference_attention_gain, "style_reference_attention_gain")
        if source_gain == 1.0 and style_gain == 1.0:
            return (model,)
        source_index = _index(source_reference_index, "source_reference_index")
        style_index = _index(style_reference_index, "style_reference_index")
        if source_index == style_index:
            raise ValueError("Source and style reference indices must differ")
        # Lazy native imports: standalone CPU tests can inspect pure helpers
        # without loading a model or requiring ComfyUI at module import time.
        from comfy.model_base import QwenImage21
        from comfy.ldm.qwen_image21.model import QwenImage21Transformer2DModel
        import comfy.patcher_extension as extension
        if (type(model.model) is not QwenImage21 or
                type(model.model.diffusion_model) is not QwenImage21Transformer2DModel):
            raise TypeError("This experiment supports only native QwenImage21 and its native transformer")
        cloned = model.clone()
        options = extension.copy_nested_dicts(cloned.model_options)
        transformer_options = options.setdefault("transformer_options", {})
        existing = extension.get_wrappers_with_key(
            extension.WrappersMP.DIFFUSION_MODEL, WRAPPER_KEY, transformer_options)
        if existing:
            raise ValueError("Do not stack this experimental reference-gain node")
        wrapper = ReferenceForwardWrapper(source_index, style_index, source_gain, style_gain, audit_log)
        extension.add_wrapper_with_key(extension.WrappersMP.DIFFUSION_MODEL,
                                       WRAPPER_KEY, wrapper, transformer_options)
        cloned.model_options = options
        return (cloned,)


NODE_CLASS_MAPPINGS = {
    "NovaFlowQwen21ReferenceAttentionExperimental": NovaFlowQwen21ReferenceAttentionExperimental,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "NovaFlowQwen21ReferenceAttentionExperimental": "Qwen 2.1 Reference Attention Gain (Experimental)",
}
