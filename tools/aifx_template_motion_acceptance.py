#!/usr/bin/env python3
"""Validate AI VFX sequences against a template's motion structure.

The checker intentionally uses alpha geometry rather than RGB similarity. It
allows material-specific edge rendering while requiring the generated sequence
to retain the template's lifecycle, trajectory, coarse support, orientation,
pose evolution, and tail restructuring.

Example:
    python tools/aifx_template_motion_acceptance.py \
      --template-dir particle-editor/templates/templates/vfx/slash_basic_builtin/source \
      --sequence fire=debug-output/.../fire/extracted/frames \
      --sequence lightning=debug-output/.../lightning/extracted/frames \
      --sequence ice=debug-output/.../ice-single-peak/extracted/frames \
      --output-dir debug-output/aifx-template-motion-acceptance
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path
from typing import Any, Iterable, Sequence

try:
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
except ImportError as error:  # pragma: no cover - dependency failure is explicit CLI output
    raise SystemExit(
        "This tool requires numpy and Pillow (PIL). "
        f"Missing dependency: {error}"
    ) from error


SCHEMA_VERSION = "novaflow-aifx-template-motion-acceptance-v1"
PNG_SUFFIX = ".png"
EPSILON = 1e-9


@dataclass(frozen=True)
class FrameData:
    path: Path
    name: str
    image: Image.Image
    alpha_u8: np.ndarray
    mask: np.ndarray

    @property
    def width(self) -> int:
        return int(self.alpha_u8.shape[1])

    @property
    def height(self) -> int:
        return int(self.alpha_u8.shape[0])


def natural_key(path: Path) -> list[Any]:
    return [int(token) if token.isdigit() else token.lower() for token in re.split(r"(\d+)", path.name)]


def finite_float(value: Any, fallback: float = 0.0) -> float:
    number = float(value)
    return number if math.isfinite(number) else fallback


def rounded(value: Any, digits: int = 6) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = finite_float(value)
        return round(number, digits)
    if isinstance(value, dict):
        return {str(key): rounded(item, digits) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [rounded(item, digits) for item in value]
    return value


def format_metric(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"{finite_float(value):.4f}"


def percentile(values: Sequence[float], amount: float) -> float | None:
    if not values:
        return None
    return float(np.percentile(np.asarray(values, dtype=np.float64), amount * 100.0))


def summarize(values: Iterable[float]) -> dict[str, Any]:
    finite = [finite_float(value) for value in values if math.isfinite(float(value))]
    if not finite:
        return {"values": [], "min": None, "max": None, "mean": None, "median": None, "p10": None, "p95": None}
    return {
        "values": finite,
        "min": min(finite),
        "max": max(finite),
        "mean": sum(finite) / len(finite),
        "median": percentile(finite, 0.5),
        "p10": percentile(finite, 0.1),
        "p95": percentile(finite, 0.95),
    }


def load_sequence(directory: Path, alpha_threshold: float) -> list[FrameData]:
    if not directory.is_dir():
        raise ValueError(f"Sequence directory does not exist: {directory}")
    paths = sorted(
        (path for path in directory.iterdir() if path.is_file() and path.suffix.lower() == PNG_SUFFIX),
        key=natural_key,
    )
    if not paths:
        raise ValueError(f"Sequence directory contains no PNG frames: {directory}")
    frames: list[FrameData] = []
    threshold_u8 = int(round(max(0.0, min(1.0, alpha_threshold)) * 255.0))
    for path in paths:
        with Image.open(path) as source:
            image = source.convert("RGBA").copy()
        alpha_u8 = np.asarray(image.getchannel("A"), dtype=np.uint8)
        frames.append(
            FrameData(
                path=path.resolve(),
                name=path.name,
                image=image,
                alpha_u8=alpha_u8,
                mask=alpha_u8 > threshold_u8,
            )
        )
    return frames


def validate_compatible(template: Sequence[FrameData], sequences: dict[str, Sequence[FrameData]]) -> None:
    template_size = (template[0].width, template[0].height)
    for index, frame in enumerate(template):
        if (frame.width, frame.height) != template_size:
            raise ValueError(
                f"Template frame {index} has size {frame.width}x{frame.height}; expected {template_size[0]}x{template_size[1]}"
            )
    for label, frames in sequences.items():
        if len(frames) != len(template):
            raise ValueError(
                f"Sequence {label!r} contains {len(frames)} frames; template contains {len(template)}"
            )
        for index, frame in enumerate(frames):
            if (frame.width, frame.height) != template_size:
                raise ValueError(
                    f"Sequence {label!r} frame {index} has size {frame.width}x{frame.height}; "
                    f"expected {template_size[0]}x{template_size[1]}"
                )


def area_ratio(mask: np.ndarray) -> float:
    return float(np.count_nonzero(mask) / max(1, mask.size))


def centroid(mask: np.ndarray) -> tuple[float, float] | None:
    ys, xs = np.nonzero(mask)
    if xs.size == 0:
        return None
    return float(xs.mean()), float(ys.mean())


def orientation(mask: np.ndarray) -> tuple[float, float] | None:
    ys, xs = np.nonzero(mask)
    if xs.size < 3:
        return None
    points = np.column_stack((xs.astype(np.float64), ys.astype(np.float64)))
    centered = points - points.mean(axis=0, keepdims=True)
    covariance = centered.T @ centered / max(1, points.shape[0])
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    major_index = int(np.argmax(eigenvalues))
    major = float(eigenvalues[major_index])
    minor = float(eigenvalues[1 - major_index])
    if major <= EPSILON:
        return None
    vector = eigenvectors[:, major_index]
    angle = math.atan2(float(vector[1]), float(vector[0]))
    confidence = max(0.0, min(1.0, 1.0 - minor / major))
    return angle, confidence


def orientation_error_degrees(left: tuple[float, float] | None, right: tuple[float, float] | None) -> float | None:
    if left is None or right is None or min(left[1], right[1]) < 0.1:
        return None
    delta = abs(left[0] - right[0]) % math.pi
    delta = min(delta, math.pi - delta)
    return math.degrees(delta)


def mask_iou(left: np.ndarray, right: np.ndarray) -> float:
    union = np.count_nonzero(left | right)
    if union == 0:
        return 1.0
    return float(np.count_nonzero(left & right) / union)


def translate_mask(mask: np.ndarray, dx: int, dy: int) -> np.ndarray:
    height, width = mask.shape
    output = np.zeros_like(mask, dtype=bool)
    source_x0 = max(0, -dx)
    source_x1 = min(width, width - dx)
    source_y0 = max(0, -dy)
    source_y1 = min(height, height - dy)
    if source_x1 <= source_x0 or source_y1 <= source_y0:
        return output
    target_x0 = source_x0 + dx
    target_x1 = source_x1 + dx
    target_y0 = source_y0 + dy
    target_y1 = source_y1 + dy
    output[target_y0:target_y1, target_x0:target_x1] = mask[source_y0:source_y1, source_x0:source_x1]
    return output


def centroid_compensated_iou(reference: np.ndarray, candidate: np.ndarray) -> float:
    reference_center = centroid(reference)
    candidate_center = centroid(candidate)
    if reference_center is None or candidate_center is None:
        return 1.0 if reference_center is candidate_center else 0.0
    dx = int(round(reference_center[0] - candidate_center[0]))
    dy = int(round(reference_center[1] - candidate_center[1]))
    return mask_iou(reference, translate_mask(candidate, dx, dy))


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask
    # A summed-area box dilation has the same square support as MaxFilter but
    # remains O(width * height) when large production frames need a generous
    # tolerance radius.
    padded = np.pad(mask.astype(np.uint8), ((radius, radius), (radius, radius)))
    integral = np.pad(padded, ((1, 0), (1, 0))).cumsum(axis=0, dtype=np.uint32).cumsum(axis=1, dtype=np.uint32)
    height, width = mask.shape
    kernel = radius * 2 + 1
    window_sum = (
        integral[kernel:kernel + height, kernel:kernel + width]
        - integral[:height, kernel:kernel + width]
        - integral[kernel:kernel + height, :width]
        + integral[:height, :width]
    )
    return window_sum > 0


def tolerant_support_f1(reference: np.ndarray, candidate: np.ndarray, radius: int) -> float:
    reference_count = int(np.count_nonzero(reference))
    candidate_count = int(np.count_nonzero(candidate))
    if reference_count == 0 and candidate_count == 0:
        return 1.0
    if reference_count == 0 or candidate_count == 0:
        return 0.0
    reference_support = dilate(reference, radius)
    candidate_support = dilate(candidate, radius)
    precision = np.count_nonzero(candidate & reference_support) / candidate_count
    recall = np.count_nonzero(reference & candidate_support) / reference_count
    if precision + recall <= EPSILON:
        return 0.0
    return float(2.0 * precision * recall / (precision + recall))


def pearson(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right) or len(left) < 2:
        return 0.0
    left_array = np.asarray(left, dtype=np.float64)
    right_array = np.asarray(right, dtype=np.float64)
    left_delta = left_array - left_array.mean()
    right_delta = right_array - right_array.mean()
    denominator = float(np.linalg.norm(left_delta) * np.linalg.norm(right_delta))
    return float(np.dot(left_delta, right_delta) / denominator) if denominator > EPSILON else 0.0


def normalized_curve_mae(left: Sequence[float], right: Sequence[float]) -> float:
    left_array = np.asarray(left, dtype=np.float64)
    right_array = np.asarray(right, dtype=np.float64)
    left_max = float(left_array.max(initial=0.0))
    right_max = float(right_array.max(initial=0.0))
    left_normalized = left_array / left_max if left_max > EPSILON else np.zeros_like(left_array)
    right_normalized = right_array / right_max if right_max > EPSILON else np.zeros_like(right_array)
    return float(np.mean(np.abs(left_normalized - right_normalized)))


def canonicalize_mask(mask: np.ndarray, size: int = 128, target_area_ratio: float = 0.18) -> np.ndarray:
    center = centroid(mask)
    visible = int(np.count_nonzero(mask))
    if center is None or visible == 0:
        return np.zeros((size, size), dtype=bool)
    target_area = size * size * target_area_ratio
    scale = math.sqrt(target_area / visible)
    center_out = (size - 1) * 0.5
    inverse_scale = 1.0 / max(scale, EPSILON)
    coefficients = (
        inverse_scale,
        0.0,
        center[0] - center_out * inverse_scale,
        0.0,
        inverse_scale,
        center[1] - center_out * inverse_scale,
    )
    source = Image.fromarray(np.where(mask, 255, 0).astype(np.uint8), mode="L")
    transformed = source.transform(
        (size, size),
        Image.Transform.AFFINE,
        coefficients,
        resample=Image.Resampling.NEAREST,
        fillcolor=0,
    )
    return np.asarray(transformed, dtype=np.uint8) > 0


def pose_delta_curve(canonical_masks: Sequence[np.ndarray]) -> list[float]:
    return [1.0 - mask_iou(canonical_masks[index], canonical_masks[index + 1]) for index in range(len(canonical_masks) - 1)]


def pose_evolution_retention(template_curve: Sequence[float], generated_curve: Sequence[float]) -> float:
    if len(template_curve) != len(generated_curve) or not template_curve:
        return 0.0
    template_total = float(sum(template_curve))
    generated_total = float(sum(generated_curve))
    if template_total <= EPSILON:
        return 1.0 if generated_total <= EPSILON else 0.0
    error = sum(abs(left - right) for left, right in zip(template_curve, generated_curve))
    return max(0.0, min(1.0, 1.0 - error / template_total))


def signed_change_score(
    previous_template: np.ndarray,
    next_template: np.ndarray,
    previous_generated: np.ndarray,
    next_generated: np.ndarray,
    radius: int,
) -> dict[str, float]:
    template_added = next_template & ~previous_template
    template_removed = previous_template & ~next_template
    generated_added = next_generated & ~previous_generated
    generated_removed = previous_generated & ~next_generated
    added_f1 = tolerant_support_f1(template_added, generated_added, radius)
    removed_f1 = tolerant_support_f1(template_removed, generated_removed, radius)
    template_added_count = int(np.count_nonzero(template_added))
    template_removed_count = int(np.count_nonzero(template_removed))
    weight_total = template_added_count + template_removed_count
    if weight_total > 0:
        combined = (
            added_f1 * template_added_count + removed_f1 * template_removed_count
        ) / weight_total
    else:
        combined = (added_f1 + removed_f1) * 0.5
    return {"added_f1": added_f1, "removed_f1": removed_f1, "combined": float(combined)}


def first_failure(failures: list[dict[str, Any]], code: str, message: str, metrics: dict[str, Any]) -> None:
    failures.append({"code": code, "message": message, "metrics": metrics})


def analyze_sequence(
    label: str,
    template: Sequence[FrameData],
    generated: Sequence[FrameData],
    thresholds: dict[str, float],
) -> dict[str, Any]:
    width = template[0].width
    height = template[0].height
    diagonal = math.hypot(width, height)
    support_radius = max(1, int(round(diagonal * thresholds["support_tolerance_ratio"])))
    template_areas = [area_ratio(frame.mask) for frame in template]
    generated_areas = [area_ratio(frame.mask) for frame in generated]
    maximum_template_area = max(template_areas)
    active_indices = [
        index
        for index, area in enumerate(template_areas)
        if area > 0 and area >= maximum_template_area * thresholds["active_area_ratio"]
    ]
    template_peak = int(np.argmax(np.asarray(template_areas)))
    generated_peak = int(np.argmax(np.asarray(generated_areas)))

    support_scores: list[float] = []
    centroid_errors: list[float] = []
    orientation_errors: list[float] = []
    compensated_ious: list[float] = []
    per_frame: list[dict[str, Any]] = []
    exact_mask_count = 0
    exact_alpha_count = 0

    for index, (template_frame, generated_frame) in enumerate(zip(template, generated)):
        template_center = centroid(template_frame.mask)
        generated_center = centroid(generated_frame.mask)
        if template_center is None or generated_center is None:
            centroid_error = 0.0 if template_center is generated_center else 1.0
        else:
            centroid_error = math.hypot(
                generated_center[0] - template_center[0],
                generated_center[1] - template_center[1],
            ) / max(diagonal, EPSILON)
        support_f1 = tolerant_support_f1(template_frame.mask, generated_frame.mask, support_radius)
        direction_error = orientation_error_degrees(
            orientation(template_frame.mask),
            orientation(generated_frame.mask),
        )
        compensated_iou = centroid_compensated_iou(template_frame.mask, generated_frame.mask)
        exact_mask = bool(np.array_equal(template_frame.mask, generated_frame.mask))
        exact_alpha = bool(np.array_equal(template_frame.alpha_u8, generated_frame.alpha_u8))
        exact_mask_count += int(exact_mask)
        exact_alpha_count += int(exact_alpha)
        if index in active_indices:
            support_scores.append(support_f1)
            centroid_errors.append(centroid_error)
            compensated_ious.append(compensated_iou)
            if direction_error is not None:
                orientation_errors.append(direction_error)
        per_frame.append(
            {
                "index": index,
                "template_name": template_frame.name,
                "generated_name": generated_frame.name,
                "template_area_ratio": template_areas[index],
                "generated_area_ratio": generated_areas[index],
                "centroid_error_diagonal_ratio": centroid_error,
                "tolerant_support_f1": support_f1,
                "orientation_error_degrees": direction_error,
                "centroid_compensated_iou": compensated_iou,
                "exact_mask": exact_mask,
                "exact_alpha": exact_alpha,
            }
        )

    canonical_template = [canonicalize_mask(frame.mask) for frame in template]
    canonical_generated = [canonicalize_mask(frame.mask) for frame in generated]
    template_pose_delta = pose_delta_curve(canonical_template)
    generated_pose_delta = pose_delta_curve(canonical_generated)
    pose_retention = pose_evolution_retention(template_pose_delta, generated_pose_delta)

    tail_transitions: list[dict[str, Any]] = []
    for index in range(template_peak, len(template) - 1):
        score = signed_change_score(
            canonical_template[index],
            canonical_template[index + 1],
            canonical_generated[index],
            canonical_generated[index + 1],
            radius=2,
        )
        tail_transitions.append({"from": index, "to": index + 1, **score})
    tail_summary = summarize([entry["combined"] for entry in tail_transitions])

    lifecycle = {
        "template_area_curve": template_areas,
        "generated_area_curve": generated_areas,
        "area_correlation": pearson(template_areas, generated_areas),
        "area_normalized_mae": normalized_curve_mae(template_areas, generated_areas),
        "template_peak_frame": template_peak,
        "generated_peak_frame": generated_peak,
        "peak_frame_delta": abs(template_peak - generated_peak),
    }
    support_summary = summarize(support_scores)
    centroid_summary = summarize(centroid_errors)
    orientation_summary = summarize(orientation_errors)
    compensated_iou_summary = summarize(compensated_ious)
    exact_mask_ratio = exact_mask_count / len(template)
    exact_alpha_ratio = exact_alpha_count / len(template)
    failures: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    if lifecycle["area_correlation"] < thresholds["area_correlation_min"]:
        first_failure(failures, "AREA_CORRELATION_LOW", "Generated lifecycle area curve does not match the template.", lifecycle)
    if lifecycle["area_normalized_mae"] > thresholds["area_nmae_max"]:
        first_failure(failures, "AREA_NMAE_HIGH", "Generated lifecycle area error exceeds the limit.", lifecycle)
    if lifecycle["peak_frame_delta"] > thresholds["peak_frame_delta_max"]:
        first_failure(failures, "PEAK_FRAME_SHIFTED", "Generated peak occurs at the wrong template phase.", lifecycle)
    if support_summary["median"] is None or support_summary["median"] < thresholds["support_f1_median_min"]:
        first_failure(failures, "TEMPLATE_SUPPORT_DIVERGED", "Generated frames do not occupy the template's tolerant structural support.", support_summary)
    if support_summary["p10"] is None or support_summary["p10"] < thresholds["support_f1_p10_min"]:
        first_failure(failures, "TEMPLATE_SUPPORT_WEAK_FRAME", "At least one active phase loses the template's coarse support.", support_summary)
    if centroid_summary["median"] is None or centroid_summary["median"] > thresholds["centroid_error_median_max"]:
        first_failure(failures, "CENTROID_TRAJECTORY_MEDIAN", "Generated centroid trajectory diverges from the template.", centroid_summary)
    if centroid_summary["p95"] is None or centroid_summary["p95"] > thresholds["centroid_error_p95_max"]:
        first_failure(failures, "CENTROID_TRAJECTORY_P95", "Generated centroid trajectory contains an excessive outlier.", centroid_summary)
    if orientation_summary["median"] is None:
        warnings.append({"code": "ORIENTATION_UNMEASURABLE", "message": "No sufficiently anisotropic active frames were available."})
    else:
        if orientation_summary["median"] > thresholds["orientation_error_median_max"]:
            first_failure(failures, "ORIENTATION_MEDIAN", "Generated effect orientation does not follow the template.", orientation_summary)
        if orientation_summary["p95"] > thresholds["orientation_error_p95_max"]:
            first_failure(failures, "ORIENTATION_P95", "Generated effect orientation contains an excessive phase error.", orientation_summary)
    if pose_retention < thresholds["pose_evolution_retention_min"]:
        first_failure(
            failures,
            "POSE_EVOLUTION_LOST",
            "After removing translation and uniform scale, the generated pose evolution no longer matches the template.",
            {"retention": pose_retention, "template_curve": template_pose_delta, "generated_curve": generated_pose_delta},
        )
    if tail_summary["median"] is None:
        warnings.append({"code": "TAIL_UNMEASURABLE", "message": "Template has no post-peak transition to evaluate."})
    elif tail_summary["median"] < thresholds["tail_restructure_min"]:
        first_failure(failures, "TAIL_RESTRUCTURE_LOST", "Tail addition/removal regions do not follow the template's breakup pattern.", tail_summary)
    if exact_mask_ratio >= thresholds["exact_stencil_ratio_max"] or exact_alpha_ratio >= thresholds["exact_stencil_ratio_max"]:
        first_failure(
            failures,
            "EXACT_TEMPLATE_STENCIL",
            "Generated sequence copies too many template alpha masks exactly.",
            {"exact_mask_ratio": exact_mask_ratio, "exact_alpha_ratio": exact_alpha_ratio},
        )
    translated_stencil = (
        compensated_iou_summary["median"] is not None
        and compensated_iou_summary["median"] >= thresholds["stencil_compensated_iou_min"]
        and lifecycle["area_correlation"] >= thresholds["stencil_area_correlation_min"]
        and lifecycle["area_normalized_mae"] <= thresholds["stencil_area_nmae_max"]
    )
    if translated_stencil:
        first_failure(
            failures,
            "COMPENSATED_TEMPLATE_STENCIL",
            "Generated sequence is a translated or alpha-remapped template stencil.",
            {
                "compensated_iou_median": compensated_iou_summary["median"],
                "area_correlation": lifecycle["area_correlation"],
                "area_normalized_mae": lifecycle["area_normalized_mae"],
            },
        )

    return {
        "label": label,
        "passed": not failures,
        "failures": failures,
        "warnings": warnings,
        "active_frame_indices": active_indices,
        "support_tolerance_pixels": support_radius,
        "lifecycle": lifecycle,
        "centroid_trajectory": centroid_summary,
        "tolerant_support_f1": support_summary,
        "orientation_error_degrees": orientation_summary,
        "centroid_compensated_template_iou": compensated_iou_summary,
        "pose_evolution": {
            "retention_ratio": pose_retention,
            "template_delta_curve": template_pose_delta,
            "generated_delta_curve": generated_pose_delta,
        },
        "tail_restructure": {"summary": tail_summary, "transitions": tail_transitions},
        "exact_stencil": {
            "exact_mask_frame_ratio": exact_mask_ratio,
            "exact_alpha_frame_ratio": exact_alpha_ratio,
            "translated_or_remapped_stencil": translated_stencil,
        },
        "per_frame": per_frame,
    }


def analyze_pairwise(
    labels: Sequence[str],
    sequences: dict[str, Sequence[FrameData]],
    template: Sequence[FrameData],
    thresholds: dict[str, float],
) -> list[dict[str, Any]]:
    layers = (
        ("outer", int(thresholds["pairwise_outer_alpha_u8"])),
        ("core", int(thresholds["pairwise_core_alpha_u8"])),
    )
    layer_context: dict[str, dict[str, Any]] = {}
    for layer_name, alpha_u8 in layers:
        template_masks = [frame.alpha_u8 >= alpha_u8 for frame in template]
        template_areas = [area_ratio(mask) for mask in template_masks]
        maximum_area = max(template_areas)
        active_indices = [
            index
            for index, area in enumerate(template_areas)
            if area > 0 and area >= maximum_area * thresholds["active_area_ratio"]
        ]
        if not active_indices:
            raise ValueError(
                f"Template has no active frames at pairwise alpha layer {layer_name} ({alpha_u8}/255)"
            )
        layer_context[layer_name] = {
            "alpha_u8": alpha_u8,
            "alpha_normalized": alpha_u8 / 255.0,
            "template_area_curve": template_areas,
            "active_frame_indices": active_indices,
        }

    results: list[dict[str, Any]] = []
    for left_label, right_label in combinations(labels, 2):
        left = sequences[left_label]
        right = sequences[right_label]
        failures: list[dict[str, Any]] = []
        layer_results: dict[str, dict[str, Any]] = {}
        for layer_name, alpha_u8 in layers:
            context = layer_context[layer_name]
            active_indices = context["active_frame_indices"]
            left_masks = [frame.alpha_u8 >= alpha_u8 for frame in left]
            right_masks = [frame.alpha_u8 >= alpha_u8 for frame in right]
            per_active_frame = []
            for index in active_indices:
                left_mask = left_masks[index]
                right_mask = right_masks[index]
                per_active_frame.append(
                    {
                        "index": index,
                        "centroid_compensated_iou": centroid_compensated_iou(left_mask, right_mask),
                        "exact_mask": bool(np.array_equal(left_mask, right_mask)),
                    }
                )
            active_ious = [entry["centroid_compensated_iou"] for entry in per_active_frame]
            exact_ratio = sum(int(entry["exact_mask"]) for entry in per_active_frame) / len(per_active_frame)
            active_mean = float(sum(active_ious) / len(active_ious))
            active_max = max(active_ious)
            metrics = {
                **context,
                "active_frame_count": len(active_indices),
                "per_active_frame": per_active_frame,
                "active_mean_centroid_compensated_iou": active_mean,
                "active_max_centroid_compensated_iou": active_max,
                "active_exact_mask_frame_ratio": exact_ratio,
            }
            layer_results[layer_name] = metrics
            if active_mean >= thresholds["pairwise_active_mean_iou_max"]:
                first_failure(
                    failures,
                    f"PAIRWISE_{layer_name.upper()}_ACTIVE_MEAN_DUPLICATE",
                    f"Material sequences share too much active-frame topology at alpha {alpha_u8}/255.",
                    metrics,
                )
            if active_max >= thresholds["pairwise_active_max_iou_max"]:
                first_failure(
                    failures,
                    f"PAIRWISE_{layer_name.upper()}_ACTIVE_MAX_DUPLICATE",
                    f"At least one active material frame is too similar at alpha {alpha_u8}/255.",
                    metrics,
                )
            if exact_ratio > thresholds["pairwise_exact_ratio_max"]:
                first_failure(
                    failures,
                    f"PAIRWISE_{layer_name.upper()}_EXACT_MASK_DUPLICATE",
                    f"Different materials contain exact duplicate active masks at alpha {alpha_u8}/255.",
                    metrics,
                )
        results.append(
            {
                "left": left_label,
                "right": right_label,
                "passed": not failures,
                "failures": failures,
                "layers": layer_results,
            }
        )
    return results


def composite_on_black(frame: FrameData) -> Image.Image:
    background = Image.new("RGBA", frame.image.size, (0, 0, 0, 255))
    return Image.alpha_composite(background, frame.image).convert("RGB")


def fit_image(image: Image.Image, width: int, height: int) -> Image.Image:
    copy = image.copy()
    copy.thumbnail((width, height), Image.Resampling.LANCZOS)
    return copy


def save_gif(frames: Sequence[FrameData], path: Path, fps: float) -> None:
    duration_ms = max(1, int(round(1000.0 / max(0.1, fps))))
    rendered = [fit_image(composite_on_black(frame), 640, 640) for frame in frames]
    rendered[0].save(
        path,
        save_all=True,
        append_images=rendered[1:],
        duration=duration_ms,
        loop=0,
        disposal=2,
        optimize=False,
    )


def default_font() -> ImageFont.ImageFont:
    return ImageFont.load_default()


def save_contact_sheet(
    template: Sequence[FrameData],
    labels: Sequence[str],
    sequences: dict[str, Sequence[FrameData]],
    path: Path,
) -> None:
    cell_width = 220
    cell_height = 126
    label_width = 100
    header_height = 24
    row_gap = 8
    rows: list[tuple[str, Sequence[FrameData]]] = [("template", template)] + [(label, sequences[label]) for label in labels]
    sheet_width = label_width + cell_width * len(template)
    sheet_height = header_height + len(rows) * (cell_height + row_gap)
    sheet = Image.new("RGB", (sheet_width, sheet_height), (18, 18, 18))
    draw = ImageDraw.Draw(sheet)
    font = default_font()
    for index in range(len(template)):
        draw.text((label_width + index * cell_width + 6, 6), f"F{index + 1}", fill=(210, 210, 210), font=font)
    for row_index, (label, frames) in enumerate(rows):
        y = header_height + row_index * (cell_height + row_gap)
        draw.text((8, y + 8), label, fill=(240, 240, 240), font=font)
        for frame_index, frame in enumerate(frames):
            preview = fit_image(composite_on_black(frame), cell_width - 8, cell_height - 8)
            x = label_width + frame_index * cell_width + (cell_width - preview.width) // 2
            image_y = y + (cell_height - preview.height) // 2
            sheet.paste(preview, (x, image_y))
    sheet.save(path)


def alpha_overlay_image(template_mask: np.ndarray, generated_mask: np.ndarray) -> Image.Image:
    height, width = template_mask.shape
    pixels = np.zeros((height, width, 3), dtype=np.uint8)
    pixels[..., 0] = np.where(template_mask, 255, 0).astype(np.uint8)
    pixels[..., 1] = np.where(generated_mask, 255, 0).astype(np.uint8)
    pixels[..., 2] = np.where(generated_mask, 255, 0).astype(np.uint8)
    return Image.fromarray(pixels, mode="RGB")


def save_alpha_overlay(
    template: Sequence[FrameData],
    generated: Sequence[FrameData],
    label: str,
    path: Path,
) -> None:
    cell_width = 220
    cell_height = 126
    header_height = 28
    sheet = Image.new("RGB", (cell_width * len(template), header_height + cell_height), (12, 12, 12))
    draw = ImageDraw.Draw(sheet)
    font = default_font()
    draw.text((6, 6), f"{label}: template=red, generated=cyan, overlap=white", fill=(230, 230, 230), font=font)
    for index, (template_frame, generated_frame) in enumerate(zip(template, generated)):
        overlay = fit_image(alpha_overlay_image(template_frame.mask, generated_frame.mask), cell_width - 8, cell_height - 8)
        x = index * cell_width + (cell_width - overlay.width) // 2
        y = header_height + (cell_height - overlay.height) // 2
        sheet.paste(overlay, (x, y))
    sheet.save(path)


def parse_sequence_spec(value: str) -> tuple[str, Path]:
    label, separator, directory = value.partition("=")
    label = label.strip()
    directory = directory.strip()
    if not separator or not label or not directory:
        raise argparse.ArgumentTypeError("--sequence must use label=frames_dir")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", label):
        raise argparse.ArgumentTypeError("sequence label may contain only letters, digits, underscore, and hyphen")
    return label, Path(directory)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template-dir", required=True, type=Path)
    parser.add_argument("--sequence", required=True, action="append", type=parse_sequence_spec, help="label=frames_dir; pass exactly three times")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--fps", type=float, default=12.0)
    parser.add_argument("--alpha-threshold", type=float, default=0.05)
    parser.add_argument("--active-area-ratio", type=float, default=0.20)
    parser.add_argument("--support-tolerance-ratio", type=float, default=0.025)
    parser.add_argument("--min-area-correlation", type=float, default=0.75)
    parser.add_argument("--max-area-nmae", type=float, default=0.28)
    parser.add_argument("--max-peak-frame-delta", type=float, default=1.0)
    parser.add_argument("--max-centroid-error-median", type=float, default=0.06)
    parser.add_argument("--max-centroid-error-p95", type=float, default=0.12)
    parser.add_argument("--min-support-f1-median", type=float, default=0.65)
    parser.add_argument("--min-support-f1-p10", type=float, default=0.45)
    parser.add_argument("--max-orientation-error-median", type=float, default=20.0)
    parser.add_argument("--max-orientation-error-p95", type=float, default=35.0)
    parser.add_argument("--min-pose-evolution-retention", type=float, default=0.55)
    parser.add_argument("--min-tail-restructure", type=float, default=0.35)
    parser.add_argument("--max-exact-stencil-ratio", type=float, default=0.80)
    parser.add_argument("--min-stencil-compensated-iou", type=float, default=0.985)
    parser.add_argument("--min-stencil-area-correlation", type=float, default=0.98)
    parser.add_argument("--max-stencil-area-nmae", type=float, default=0.03)
    parser.add_argument("--pairwise-outer-alpha-u8", type=int, default=13)
    parser.add_argument("--pairwise-core-alpha-u8", type=int, default=64)
    parser.add_argument("--max-pairwise-active-mean-iou", type=float, default=0.80)
    parser.add_argument("--max-pairwise-active-max-iou", type=float, default=0.88)
    parser.add_argument("--max-pairwise-exact-ratio", type=float, default=0.0)
    return parser


def thresholds_from_args(args: argparse.Namespace) -> dict[str, float]:
    return {
        "alpha_threshold": args.alpha_threshold,
        "active_area_ratio": args.active_area_ratio,
        "support_tolerance_ratio": args.support_tolerance_ratio,
        "area_correlation_min": args.min_area_correlation,
        "area_nmae_max": args.max_area_nmae,
        "peak_frame_delta_max": args.max_peak_frame_delta,
        "centroid_error_median_max": args.max_centroid_error_median,
        "centroid_error_p95_max": args.max_centroid_error_p95,
        "support_f1_median_min": args.min_support_f1_median,
        "support_f1_p10_min": args.min_support_f1_p10,
        "orientation_error_median_max": args.max_orientation_error_median,
        "orientation_error_p95_max": args.max_orientation_error_p95,
        "pose_evolution_retention_min": args.min_pose_evolution_retention,
        "tail_restructure_min": args.min_tail_restructure,
        "exact_stencil_ratio_max": args.max_exact_stencil_ratio,
        "stencil_compensated_iou_min": args.min_stencil_compensated_iou,
        "stencil_area_correlation_min": args.min_stencil_area_correlation,
        "stencil_area_nmae_max": args.max_stencil_area_nmae,
        "pairwise_outer_alpha_u8": args.pairwise_outer_alpha_u8,
        "pairwise_core_alpha_u8": args.pairwise_core_alpha_u8,
        "pairwise_active_mean_iou_max": args.max_pairwise_active_mean_iou,
        "pairwise_active_max_iou_max": args.max_pairwise_active_max_iou,
        "pairwise_exact_ratio_max": args.max_pairwise_exact_ratio,
    }


def validate_thresholds(thresholds: dict[str, float], fps: float) -> None:
    if fps <= 0:
        raise ValueError("--fps must be positive")
    unit_interval = [
        "alpha_threshold",
        "active_area_ratio",
        "support_tolerance_ratio",
        "area_nmae_max",
        "centroid_error_median_max",
        "centroid_error_p95_max",
        "support_f1_median_min",
        "support_f1_p10_min",
        "pose_evolution_retention_min",
        "tail_restructure_min",
        "exact_stencil_ratio_max",
        "stencil_compensated_iou_min",
        "stencil_area_correlation_min",
        "stencil_area_nmae_max",
        "pairwise_active_mean_iou_max",
        "pairwise_active_max_iou_max",
        "pairwise_exact_ratio_max",
    ]
    for key in unit_interval:
        if not 0.0 <= thresholds[key] <= 1.0:
            raise ValueError(f"Threshold {key} must be between 0 and 1; received {thresholds[key]}")
    if not -1.0 <= thresholds["area_correlation_min"] <= 1.0:
        raise ValueError("--min-area-correlation must be between -1 and 1")
    if thresholds["peak_frame_delta_max"] < 0:
        raise ValueError("--max-peak-frame-delta must be non-negative")
    if thresholds["orientation_error_median_max"] < 0 or thresholds["orientation_error_p95_max"] < 0:
        raise ValueError("orientation thresholds must be non-negative")
    for key in ("pairwise_outer_alpha_u8", "pairwise_core_alpha_u8"):
        value = thresholds[key]
        if not isinstance(value, int) or not 1 <= value <= 254:
            raise ValueError(f"Threshold {key} must be an integer between 1 and 254; received {value}")
    if thresholds["pairwise_outer_alpha_u8"] >= thresholds["pairwise_core_alpha_u8"]:
        raise ValueError("--pairwise-outer-alpha-u8 must be lower than --pairwise-core-alpha-u8")


def run(args: argparse.Namespace) -> int:
    if len(args.sequence) != 3:
        raise ValueError(f"Exactly three --sequence arguments are required; received {len(args.sequence)}")
    labels = [label for label, _directory in args.sequence]
    if len(set(labels)) != len(labels):
        raise ValueError("Every --sequence label must be unique")
    thresholds = thresholds_from_args(args)
    validate_thresholds(thresholds, args.fps)
    template = load_sequence(args.template_dir, thresholds["alpha_threshold"])
    sequences = {
        label: load_sequence(directory, thresholds["alpha_threshold"])
        for label, directory in args.sequence
    }
    validate_compatible(template, sequences)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    sequence_results = {
        label: analyze_sequence(label, template, sequences[label], thresholds)
        for label in labels
    }
    template_areas = [area_ratio(frame.mask) for frame in template]
    template_peak_index = int(np.argmax(np.asarray(template_areas)))
    pairwise_results = analyze_pairwise(labels, sequences, template, thresholds)
    passed = all(result["passed"] for result in sequence_results.values()) and all(
        result["passed"] for result in pairwise_results
    )

    save_contact_sheet(template, labels, sequences, args.output_dir / "frame-contact-sheet.png")
    save_gif(template, args.output_dir / "template.gif", args.fps)
    for label in labels:
        save_gif(sequences[label], args.output_dir / f"{label}.gif", args.fps)
        save_alpha_overlay(template, sequences[label], label, args.output_dir / f"{label}-alpha-overlay.png")

    report = {
        "schema_version": SCHEMA_VERSION,
        "passed": passed,
        "inputs": {
            "template_dir": str(args.template_dir.resolve()),
            "sequences": {label: str(directory.resolve()) for label, directory in args.sequence},
            "frame_count": len(template),
            "frame_size": {"width": template[0].width, "height": template[0].height},
            "fps": args.fps,
        },
        "thresholds": thresholds,
        "template": {
            "area_curve": template_areas,
            "peak_frame": template_peak_index,
            "frame_names": [frame.name for frame in template],
        },
        "sequences": sequence_results,
        "pairwise_material_shape": pairwise_results,
        "artifacts": {
            "contact_sheet": "frame-contact-sheet.png",
            "template_gif": "template.gif",
            "sequence_gifs": {label: f"{label}.gif" for label in labels},
            "alpha_overlays": {label: f"{label}-alpha-overlay.png" for label in labels},
        },
    }
    report_path = args.output_dir / "acceptance.json"
    report_path.write_text(json.dumps(rounded(report), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"AIFX template motion acceptance: {'PASS' if passed else 'FAIL'}")
    print(f"Report: {report_path.resolve()}")
    for label in labels:
        result = sequence_results[label]
        failure_codes = ",".join(item["code"] for item in result["failures"]) or "none"
        print(
            f"  {label}: {'PASS' if result['passed'] else 'FAIL'}; "
            f"support={format_metric(result['tolerant_support_f1']['median'])}; "
            f"pose={format_metric(result['pose_evolution']['retention_ratio'])}; "
            f"tail={format_metric(result['tail_restructure']['summary']['median'])}; "
            f"failures={failure_codes}"
        )
    for result in pairwise_results:
        failure_codes = ",".join(item["code"] for item in result["failures"]) or "none"
        outer = result["layers"]["outer"]
        core = result["layers"]["core"]
        print(
            f"  {result['left']} vs {result['right']}: {'PASS' if result['passed'] else 'FAIL'}; "
            f"outer({outer['alpha_u8']}/255 active n={outer['active_frame_count']}) "
            f"mean/max/exact={format_metric(outer['active_mean_centroid_compensated_iou'])}/"
            f"{format_metric(outer['active_max_centroid_compensated_iou'])}/"
            f"{format_metric(outer['active_exact_mask_frame_ratio'])}; "
            f"core({core['alpha_u8']}/255 active n={core['active_frame_count']}) "
            f"mean/max/exact={format_metric(core['active_mean_centroid_compensated_iou'])}/"
            f"{format_metric(core['active_max_centroid_compensated_iou'])}/"
            f"{format_metric(core['active_exact_mask_frame_ratio'])}; "
            f"failures={failure_codes}"
        )
    return 0 if passed else 2


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return run(args)
    except (OSError, ValueError) as error:
        print(f"AIFX template motion acceptance: ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
