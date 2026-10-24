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


