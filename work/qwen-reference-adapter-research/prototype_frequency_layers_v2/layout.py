"""Native Qwen 2.1 sequence geometry, reused from our first isolated prototype."""

from dataclasses import dataclass
import numbers

import torch


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


def index_value(value, name):
    if isinstance(value, bool) or not isinstance(value, numbers.Integral) or value < 0:
        raise ValueError(f"{name} must be a nonnegative integer (zero based)")
    return int(value)


def sequence_layout(x, context, ref_latents, image_slots):
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
    slots = (slots + [text_tokens] * len(refs))[:len(refs)]
    slots = [index_value(slot, "image_slots item") for slot in slots]
    if any(slot > text_tokens for slot in slots) or slots != sorted(slots):
        raise ValueError("image_slots must be ordered within the actual context")
    spans, previous_reference_tokens = [], 0
    for index, (ref, slot) in enumerate(zip(refs, slots)):
        if not isinstance(ref, torch.Tensor) or ref.ndim != 4:
            raise ValueError(f"Reference {index} must use native 4D latents")
        if ref.shape[:2] != x.shape[:2] or min(ref.shape) <= 0:
            raise ValueError(f"Reference {index} batch/channels do not match the target")
        count = int(ref.shape[-2] * ref.shape[-1])
        start = slot + previous_reference_tokens
        spans.append(ReferenceSpan(start, start + count))
        previous_reference_tokens += count
    prefix = text_tokens + previous_reference_tokens
    target = int(x.shape[-2] * x.shape[-1])
    return SequenceLayout(tuple(spans), target, prefix, prefix + target, int(x.shape[0]))
