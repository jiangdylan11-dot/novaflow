#!/usr/bin/env python3
"""Offline morphology acceptance for reference-guided 2D VFX sequences.

This tool does not classify fire, lightning, ice, poison, or any other material.
It measures production-contract compatibility and geometry/grayscale proxies that
help reviewers distinguish a real morphology change from a recolor or shared
stencil. Final material identity remains a required human grayscale blind test.

Example:
    python tools/aifx_material_morphology_acceptance.py \
      --source-dir debug-output/source/frames \
      --sequence fire=debug-output/fire/frames \
      --sequence lightning=debug-output/lightning/frames \
      --sequence ice=debug-output/ice/frames \
      --sequence poison=debug-output/poison/frames \
      --output-dir debug-output/aifx-material-morphology-acceptance

Exit codes:
    0: automated proxy gates are clear; human grayscale review is still pending
    1: invocation, dependency, or input error
    2: automated failure or warning that requires review
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path
from typing import Any, Iterable, Sequence

try:
    import cv2
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
except ImportError as error:  # pragma: no cover - dependency failure is explicit CLI output
    raise SystemExit(
        "This tool requires numpy, Pillow (PIL), and opencv-python (cv2). "
        f"Missing dependency: {error}"
    ) from error


SCHEMA_VERSION = "novaflow-aifx-material-morphology-acceptance-v2"
BLIND_KEY_SCHEMA_VERSION = "novaflow-aifx-material-morphology-blind-key-v1"
EPSILON = 1e-9
PNG_SUFFIX = ".png"
CANONICAL_FRAME_PATTERN = re.compile(r"^frame_(\d{3,})\.png$", re.IGNORECASE)
GRAY_FEATURE_KEYS = (
    "mean_luminance",
    "luminance_std",
    "p10_p90_contrast",
    "entropy_16",
    "interior_gradient_mean",
    "interior_edge_density",
    "bright_fraction",
)


@dataclass(frozen=True)
class FrameData:
    path: Path
    name: str
    image: Image.Image
    rgba: np.ndarray
    gray: np.ndarray
    alpha: np.ndarray
    mask: np.ndarray
    mask_source: str
    has_alpha_channel: bool

    @property
    def width(self) -> int:
        return int(self.rgba.shape[1])

    @property
    def height(self) -> int:
        return int(self.rgba.shape[0])


def natural_key(path: Path) -> list[Any]:
    return [int(token) if token.isdigit() else token.lower() for token in re.split(r"(\d+)", path.name)]


def canonical_frame_index(name: str) -> int | None:
    match = CANONICAL_FRAME_PATTERN.fullmatch(str(name))
    return int(match.group(1)) if match else None


def rounded(value: Any, digits: int = 6) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return round(number, digits) if math.isfinite(number) else None
    if isinstance(value, dict):
        return {str(key): rounded(item, digits) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [rounded(item, digits) for item in value]
    return value


def summarize(values: Iterable[float | None]) -> dict[str, float | int | None]:
    finite = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    if not finite:
        return {"count": 0, "min": None, "max": None, "mean": None, "median": None, "p10": None, "p90": None}
    array = np.asarray(finite, dtype=np.float64)
    return {
        "count": len(finite),
        "min": float(array.min()),
        "max": float(array.max()),
        "mean": float(array.mean()),
        "median": float(np.percentile(array, 50)),
        "p10": float(np.percentile(array, 10)),
        "p90": float(np.percentile(array, 90)),
    }


def parse_sequence_spec(value: str) -> tuple[str, Path]:
    label, separator, directory = value.partition("=")
    label = label.strip()
    directory = directory.strip()
    if not separator or not label or not directory:
        raise argparse.ArgumentTypeError("--sequence must use label=frames_dir")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", label):
        raise argparse.ArgumentTypeError("sequence label may contain only letters, digits, underscore, and hyphen")
    return label, Path(directory)


def load_sequence(
    directory: Path,
    alpha_threshold: float,
    luma_threshold: float,
    mask_mode: str,
) -> list[FrameData]:
    if not directory.is_dir():
        raise ValueError(f"Sequence directory does not exist: {directory}")
    paths = sorted(
        (path for path in directory.iterdir() if path.is_file() and path.suffix.lower() == PNG_SUFFIX),
        key=natural_key,
    )
    if not paths:
        raise ValueError(f"Sequence directory contains no PNG frames: {directory}")

    alpha_u8 = int(round(alpha_threshold * 255.0))
    luma_u8 = int(round(luma_threshold * 255.0))
    frames: list[FrameData] = []
    for path in paths:
        with Image.open(path) as source:
            has_alpha = "A" in source.getbands() or "transparency" in source.info
            image = source.convert("RGBA").copy()
        rgba = np.asarray(image, dtype=np.uint8)
        alpha = rgba[..., 3]
        gray = cv2.cvtColor(rgba[..., :3], cv2.COLOR_RGB2GRAY)
        useful_alpha = has_alpha and bool(np.any(alpha <= alpha_u8)) and bool(np.any(alpha > alpha_u8))
        if mask_mode == "alpha" and not useful_alpha:
            mask = (alpha > alpha_u8) if has_alpha else np.zeros_like(alpha, dtype=bool)
            source_name = "alpha_unusable" if has_alpha else "alpha_unavailable"
        elif mask_mode == "alpha" or (mask_mode == "auto" and useful_alpha):
            mask = alpha > alpha_u8
            source_name = "alpha"
        else:
            mask = gray > luma_u8
            source_name = "luminance" if mask_mode == "luma" else "luminance_fallback"
        frames.append(
            FrameData(
                path=path.resolve(),
                name=path.name,
                image=image,
                rgba=rgba,
                gray=gray,
                alpha=alpha,
                mask=mask.astype(bool),
                mask_source=source_name,
                has_alpha_channel=has_alpha,
            )
        )
    return frames


def area_ratio(mask: np.ndarray) -> float:
    return float(np.count_nonzero(mask) / max(1, mask.size))


def centroid(mask: np.ndarray) -> tuple[float, float] | None:
    ys, xs = np.nonzero(mask)
    if xs.size == 0:
        return None
    return float(xs.mean()), float(ys.mean())


def mask_iou(left: np.ndarray, right: np.ndarray) -> float:
    union = int(np.count_nonzero(left | right))
    return 1.0 if union == 0 else float(np.count_nonzero(left & right) / union)


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask.astype(bool)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    return cv2.dilate(mask.astype(np.uint8), kernel, iterations=1) > 0


def erode(mask: np.ndarray, radius: int = 1) -> np.ndarray:
    if radius <= 0:
        return mask.astype(bool)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    return cv2.erode(mask.astype(np.uint8), kernel, iterations=1) > 0


def boundary(mask: np.ndarray) -> np.ndarray:
    return mask & ~erode(mask, 1)


def tolerant_f1(left: np.ndarray, right: np.ndarray, radius: int) -> float:
    left_count = int(np.count_nonzero(left))
    right_count = int(np.count_nonzero(right))
    if left_count == 0 and right_count == 0:
        return 1.0
    if left_count == 0 or right_count == 0:
        return 0.0
    left_support = dilate(left, radius)
    right_support = dilate(right, radius)
    precision = float(np.count_nonzero(right & left_support) / right_count)
    recall = float(np.count_nonzero(left & right_support) / left_count)
    return 0.0 if precision + recall <= EPSILON else 2.0 * precision * recall / (precision + recall)


def coarse_mask(mask: np.ndarray, grid_size: int, occupancy: float) -> np.ndarray:
    reduced = cv2.resize(mask.astype(np.float32), (grid_size, grid_size), interpolation=cv2.INTER_AREA)
    coarse = reduced >= occupancy
    return dilate(coarse, 1)


def canonical_matrix(mask: np.ndarray, size: int = 128, target_area_ratio: float = 0.18) -> np.ndarray | None:
    center = centroid(mask)
    visible = int(np.count_nonzero(mask))
    if center is None or visible == 0:
        return None
    ys, xs = np.nonzero(mask)
    area_scale = math.sqrt((size * size * target_area_ratio) / visible)
    margin = max(2.0, float(size) * 0.04)
    output_center = (size - 1) * 0.5
    available_extent = max(1.0, output_center - margin)
    source_extent = max(
        center[0] - (float(xs.min()) - 0.5),
        (float(xs.max()) + 0.5) - center[0],
        center[1] - (float(ys.min()) - 0.5),
        (float(ys.max()) + 0.5) - center[1],
        EPSILON,
    )
    bbox_fit_scale = available_extent / source_extent
    scale = min(area_scale, bbox_fit_scale)
    return np.asarray(
        [
            [scale, 0.0, output_center - scale * center[0]],
            [0.0, scale, output_center - scale * center[1]],
        ],
        dtype=np.float32,
    )


def canonicalize_mask(mask: np.ndarray, size: int = 128) -> np.ndarray:
    matrix = canonical_matrix(mask, size=size)
    if matrix is None:
        return np.zeros((size, size), dtype=bool)
    transformed = cv2.warpAffine(
        mask.astype(np.uint8),
        matrix,
        (size, size),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    return transformed > 0


def topology_features(mask: np.ndarray) -> dict[str, float | int]:
    foreground = mask.astype(np.uint8)
    active = int(np.count_nonzero(foreground))
    if active == 0:
        return {
            "component_count": 0,
            "hole_count": 0,
            "hole_area_ratio": 0.0,
            "largest_component_ratio": 0.0,
            "component_entropy": 0.0,
            "boundary_density": 0.0,
        }
    minimum_area = max(2, int(round(active * 0.002)))
    count, _labels, stats, _centers = cv2.connectedComponentsWithStats(foreground, connectivity=8)
    component_areas = [
        int(stats[index, cv2.CC_STAT_AREA])
        for index in range(1, count)
        if int(stats[index, cv2.CC_STAT_AREA]) >= minimum_area
    ]
    if not component_areas:
        component_areas = [active]
    probabilities = np.asarray(component_areas, dtype=np.float64)
    probabilities /= max(float(probabilities.sum()), EPSILON)
    if len(component_areas) > 1:
        entropy = float(-np.sum(probabilities * np.log2(probabilities + EPSILON)) / math.log2(len(component_areas)))
    else:
        entropy = 0.0

    inverse = (~mask).astype(np.uint8)
    bg_count, _bg_labels, bg_stats, _bg_centers = cv2.connectedComponentsWithStats(inverse, connectivity=8)
    height, width = mask.shape
    hole_areas: list[int] = []
    for index in range(1, bg_count):
        x = int(bg_stats[index, cv2.CC_STAT_LEFT])
        y = int(bg_stats[index, cv2.CC_STAT_TOP])
        w = int(bg_stats[index, cv2.CC_STAT_WIDTH])
        h = int(bg_stats[index, cv2.CC_STAT_HEIGHT])
        area = int(bg_stats[index, cv2.CC_STAT_AREA])
        touches_border = x == 0 or y == 0 or x + w >= width or y + h >= height
        if not touches_border and area >= minimum_area:
            hole_areas.append(area)
    hole_area = sum(hole_areas)
    return {
        "component_count": len(component_areas),
        "hole_count": len(hole_areas),
        "hole_area_ratio": float(hole_area / max(active + hole_area, 1)),
        "largest_component_ratio": float(max(component_areas) / active),
        "component_entropy": entropy,
        "boundary_density": float(np.count_nonzero(boundary(mask)) / active),
    }


def normalized_count_delta(left: int, right: int) -> float:
    return float(abs(left - right) / max(1, left, right))


def topology_delta(left: dict[str, Any], right: dict[str, Any]) -> dict[str, float]:
    parts = {
        "component_count_delta": normalized_count_delta(int(left["component_count"]), int(right["component_count"])),
        "hole_count_delta": normalized_count_delta(int(left["hole_count"]), int(right["hole_count"])),
        "hole_area_ratio_delta": abs(float(left["hole_area_ratio"]) - float(right["hole_area_ratio"])),
        "largest_component_ratio_delta": abs(float(left["largest_component_ratio"]) - float(right["largest_component_ratio"])),
        "component_entropy_delta": abs(float(left["component_entropy"]) - float(right["component_entropy"])),
        "boundary_density_delta": min(1.0, abs(float(left["boundary_density"]) - float(right["boundary_density"]))),
    }
    parts["score"] = float(sum(parts.values()) / len(parts))
    return parts


def grayscale_features(frame: FrameData) -> dict[str, float]:
    mask = frame.mask
    values = frame.gray[mask].astype(np.float32) / 255.0
    if values.size == 0:
        return {key: 0.0 for key in GRAY_FEATURE_KEYS}
    histogram, _edges = np.histogram(values, bins=16, range=(0.0, 1.0))
    probabilities = histogram.astype(np.float64) / max(int(histogram.sum()), 1)
    nonzero = probabilities > 0
    entropy = float(-np.sum(probabilities[nonzero] * np.log2(probabilities[nonzero])) / math.log2(16))
    gray_f = frame.gray.astype(np.float32) / 255.0
    dx = cv2.Sobel(gray_f, cv2.CV_32F, 1, 0, ksize=3)
    dy = cv2.Sobel(gray_f, cv2.CV_32F, 0, 1, ksize=3)
    gradient = np.sqrt(dx * dx + dy * dy) / math.sqrt(32.0)
    interior = erode(mask, 1)
    if not np.any(interior):
        interior = mask
    interior_gradient = gradient[interior]
    p10, p90 = np.percentile(values, (10, 90))
    return {
        "mean_luminance": float(values.mean()),
        "luminance_std": float(values.std()),
        "p10_p90_contrast": float(p90 - p10),
        "entropy_16": entropy,
        "interior_gradient_mean": float(interior_gradient.mean()) if interior_gradient.size else 0.0,
        "interior_edge_density": float(np.mean(interior_gradient >= 0.08)) if interior_gradient.size else 0.0,
        "bright_fraction": float(np.mean(values >= 0.75)),
    }


def grayscale_feature_delta(left: dict[str, float], right: dict[str, float]) -> dict[str, float]:
    delta = {key: abs(float(left[key]) - float(right[key])) for key in GRAY_FEATURE_KEYS}
    delta["mean_absolute_feature_delta"] = float(sum(delta.values()) / len(delta))
    return delta


def canonical_gray(frame: FrameData, size: int = 96) -> tuple[np.ndarray, np.ndarray]:
    matrix = canonical_matrix(frame.mask, size=size)
    if matrix is None:
        return np.zeros((size, size), dtype=np.float32), np.zeros((size, size), dtype=bool)
    gray = cv2.warpAffine(
        frame.gray.astype(np.float32) / 255.0,
        matrix,
        (size, size),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    mask = cv2.warpAffine(
        frame.mask.astype(np.uint8),
        matrix,
        (size, size),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    ) > 0
    return gray, mask


def grayscale_structure_correlation(left: FrameData, right: FrameData) -> float | None:
    left_gray, left_mask = canonical_gray(left)
    right_gray, right_mask = canonical_gray(right)
    sample = left_mask | right_mask
    if int(np.count_nonzero(sample)) < 8:
        return None
    left_values = left_gray[sample].astype(np.float64)
    right_values = right_gray[sample].astype(np.float64)
    left_values -= left_values.mean()
    right_values -= right_values.mean()
    denominator = float(np.linalg.norm(left_values) * np.linalg.norm(right_values))
    if denominator <= EPSILON:
        return 1.0 if float(np.mean(np.abs(left_gray[sample] - right_gray[sample]))) < 1e-4 else 0.0
    return float(np.dot(left_values, right_values) / denominator)


def border_occupancy(mask: np.ndarray) -> float:
    if mask.size == 0:
        return 0.0
    border = np.concatenate((mask[0], mask[-1], mask[:, 0], mask[:, -1]))
    return float(np.mean(border))


def inspect_source_contract(frames: Sequence[FrameData], require_alpha: bool) -> dict[str, Any]:
    expected_size = (frames[0].width, frames[0].height)
    failures: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    for index, frame in enumerate(frames):
        actual_frame_index = canonical_frame_index(frame.name)
        if actual_frame_index != index:
            failures.append(
                {
                    "code": "SOURCE_FRAME_INDEX_MISMATCH",
                    "frame": index,
                    "name": frame.name,
                    "actual_index": actual_frame_index,
                    "expected_index": index,
                    "expected_name": f"frame_{index:03d}.png",
                }
            )
        if (frame.width, frame.height) != expected_size:
            failures.append(
                {
                    "code": "SOURCE_FRAME_SIZE_MISMATCH",
                    "frame": index,
                    "actual": [frame.width, frame.height],
                    "expected": list(expected_size),
                }
            )
        if require_alpha and frame.mask_source != "alpha":
            failures.append({"code": "SOURCE_ALPHA_REQUIRED", "frame": index, "name": frame.name})
        elif frame.mask_source == "luminance_fallback":
            warnings.append({"code": "SOURCE_OPAQUE_LUMINANCE_FALLBACK", "frame": index, "name": frame.name})
        if border_occupancy(frame.mask) > 0.60:
            warnings.append({"code": "SOURCE_FOREGROUND_TOUCHES_MOST_BORDER", "frame": index, "name": frame.name})
    return {
        "passed": not failures,
        "frame_count": len(frames),
        "expected_frame_size": {"width": expected_size[0], "height": expected_size[1]},
        "frame_names": [frame.name for frame in frames],
        "mask_sources": [frame.mask_source for frame in frames],
        "failures": failures,
        "warnings": warnings,
    }


def inspect_candidate_contract(
    source: Sequence[FrameData],
    candidate: Sequence[FrameData],
    require_alpha: bool,
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    if len(candidate) != len(source):
        failures.append(
            {
                "code": "FRAME_COUNT_MISMATCH",
                "actual": len(candidate),
                "expected": len(source),
            }
        )
    compatible_indices: list[int] = []
    for index in range(min(len(source), len(candidate))):
        actual_frame_index = canonical_frame_index(candidate[index].name)
        identity_matches = actual_frame_index == index
        if not identity_matches:
            failures.append(
                {
                    "code": "FRAME_INDEX_MISMATCH",
                    "frame": index,
                    "name": candidate[index].name,
                    "actual_index": actual_frame_index,
                    "expected_index": index,
                    "expected_name": f"frame_{index:03d}.png",
                }
            )
        expected = (source[index].width, source[index].height)
        actual = (candidate[index].width, candidate[index].height)
        size_matches = actual == expected
        if not size_matches:
            failures.append(
                {
                    "code": "FRAME_SIZE_MISMATCH",
                    "frame": index,
                    "actual": list(actual),
                    "expected": list(expected),
                }
            )
        if not identity_matches or not size_matches:
            continue
        compatible_indices.append(index)
        frame = candidate[index]
        if require_alpha and frame.mask_source != "alpha":
            failures.append({"code": "ALPHA_REQUIRED", "frame": index, "name": frame.name})
        elif frame.mask_source == "luminance_fallback":
            warnings.append({"code": "OPAQUE_LUMINANCE_FALLBACK", "frame": index, "name": frame.name})
        if border_occupancy(frame.mask) > 0.60:
            warnings.append({"code": "FOREGROUND_TOUCHES_MOST_BORDER", "frame": index, "name": frame.name})
    return {
        "passed": not failures,
        "frame_count": len(candidate),
        "frame_names": [frame.name for frame in candidate],
        "mask_sources": [frame.mask_source for frame in candidate],
        "compatible_frame_indices": compatible_indices,
        "failures": failures,
        "warnings": warnings,
    }


def analyze_candidate(
    label: str,
    source: Sequence[FrameData],
    candidate: Sequence[FrameData],
    active_indices: Sequence[int],
    thresholds: dict[str, float | int],
    require_alpha: bool,
) -> dict[str, Any]:
    contract = inspect_candidate_contract(source, candidate, require_alpha)
    compatible = set(contract["compatible_frame_indices"])
    analyzed = [index for index in active_indices if index in compatible]
    per_frame: list[dict[str, Any]] = []
    for index in analyzed:
        source_frame = source[index]
        candidate_frame = candidate[index]
        source_area = int(np.count_nonzero(source_frame.mask))
        candidate_area = int(np.count_nonzero(candidate_frame.mask))
        area_scale = float(candidate_area / source_area) if source_area else None
        source_center = centroid(source_frame.mask)
        candidate_center = centroid(candidate_frame.mask)
        diagonal = math.hypot(source_frame.width, source_frame.height)
        if source_center is None or candidate_center is None:
            centroid_error = 0.0 if source_center is candidate_center else 1.0
        else:
            centroid_error = math.hypot(
                source_center[0] - candidate_center[0], source_center[1] - candidate_center[1]
            ) / max(diagonal, EPSILON)

        source_coarse = coarse_mask(
            source_frame.mask,
            int(thresholds["coarse_grid_size"]),
            float(thresholds["coarse_cell_occupancy"]),
        )
        candidate_coarse = coarse_mask(
            candidate_frame.mask,
            int(thresholds["coarse_grid_size"]),
            float(thresholds["coarse_cell_occupancy"]),
        )
        coarse_iou = mask_iou(source_coarse, candidate_coarse)
        source_canonical = canonicalize_mask(source_frame.mask)
        candidate_canonical = canonicalize_mask(candidate_frame.mask)
        canonical_iou = mask_iou(source_canonical, candidate_canonical)
        boundary_tolerance = max(
            1,
            int(round(128 * float(thresholds["fine_boundary_tolerance_ratio"]))),
        )
        boundary_f1 = tolerant_f1(boundary(source_canonical), boundary(candidate_canonical), boundary_tolerance)
        source_topology = topology_features(source_frame.mask)
        candidate_topology = topology_features(candidate_frame.mask)
        topology_change = topology_delta(source_topology, candidate_topology)
        source_gray = grayscale_features(source_frame)
        candidate_gray = grayscale_features(candidate_frame)
        gray_delta = grayscale_feature_delta(source_gray, candidate_gray)
        coarse_frame_pass = bool(
            coarse_iou >= float(thresholds["coarse_iou_frame_min"])
            and centroid_error <= float(thresholds["centroid_error_frame_max"])
            and area_scale is not None
            and float(thresholds["area_scale_min"]) <= area_scale <= float(thresholds["area_scale_max"])
        )
        per_frame.append(
            {
                "index": index,
                "source_name": source_frame.name,
                "candidate_name": candidate_frame.name,
                "coarse": {
                    "envelope_iou": coarse_iou,
                    "centroid_error_diagonal_ratio": centroid_error,
                    "area_scale": area_scale,
                    "frame_proxy_passed": coarse_frame_pass,
                },
                "morphology": {
                    "canonical_mask_iou": canonical_iou,
                    "canonical_mask_change": 1.0 - canonical_iou,
                    "boundary_tolerant_f1": boundary_f1,
                    "boundary_change": 1.0 - boundary_f1,
                    "source_topology": source_topology,
                    "candidate_topology": candidate_topology,
                    "topology_change": topology_change,
                },
                "grayscale_report_only": {
                    "source": source_gray,
                    "candidate": candidate_gray,
                    "absolute_feature_delta": gray_delta,
                    "canonical_structure_correlation": grayscale_structure_correlation(source_frame, candidate_frame),
                },
            }
        )

    coarse_iou = summarize(item["coarse"]["envelope_iou"] for item in per_frame)
    centroid_error = summarize(item["coarse"]["centroid_error_diagonal_ratio"] for item in per_frame)
    area_scale = summarize(item["coarse"]["area_scale"] for item in per_frame)
    coarse_pass_fraction = (
        float(np.mean([item["coarse"]["frame_proxy_passed"] for item in per_frame])) if per_frame else 0.0
    )
    fine_mask_change = summarize(item["morphology"]["canonical_mask_change"] for item in per_frame)
    boundary_change = summarize(item["morphology"]["boundary_change"] for item in per_frame)
    topology_change = summarize(item["morphology"]["topology_change"]["score"] for item in per_frame)
    gray_feature_delta = summarize(
        item["grayscale_report_only"]["absolute_feature_delta"]["mean_absolute_feature_delta"]
        for item in per_frame
    )
    gray_structure_correlation = summarize(
        item["grayscale_report_only"]["canonical_structure_correlation"] for item in per_frame
    )

    coarse_passed = bool(
        per_frame
        and coarse_iou["median"] is not None
        and float(coarse_iou["median"]) >= float(thresholds["coarse_iou_median_min"])
        and coarse_iou["p10"] is not None
        and float(coarse_iou["p10"]) >= float(thresholds["coarse_iou_p10_min"])
        and centroid_error["median"] is not None
        and float(centroid_error["median"]) <= float(thresholds["centroid_error_median_max"])
        and coarse_pass_fraction >= float(thresholds["coarse_pass_fraction_min"])
    )
    morphology_evidence = bool(
        per_frame
        and (
            (
                fine_mask_change["median"] is not None
                and boundary_change["median"] is not None
                and float(fine_mask_change["median"]) >= float(thresholds["fine_mask_change_median_min"])
                and float(boundary_change["median"]) >= float(thresholds["boundary_change_median_min"])
            )
            or (
                topology_change["median"] is not None
                and float(topology_change["median"]) >= float(thresholds["topology_change_median_min"])
            )
        )
    )
    failures: list[dict[str, Any]] = list(contract["failures"])
    warnings: list[dict[str, Any]] = list(contract["warnings"])
    if not analyzed:
        failures.append({"code": "NO_COMPATIBLE_ACTIVE_FRAMES", "message": "No active source frames could be compared."})
    elif not coarse_passed:
        failures.append(
            {
                "code": "COARSE_ENVELOPE_DIVERGED",
                "message": "Candidate no longer preserves the source sequence's coarse spatial contract.",
            }
        )
    if analyzed and not morphology_evidence:
        warnings.append(
            {
                "code": "MORPHOLOGY_RECONSTRUCTION_PROXY_WEAK",
                "message": "Fine boundary/internal-topology change is too weak to rule out recolor or shared-stencil behavior.",
            }
        )
    automated_status = "fail" if failures else "warning" if warnings else "pass"
    return {
        "label": label,
        "automated_status": automated_status,
        "contract": contract,
        "active_frame_indices": list(active_indices),
        "analyzed_frame_indices": analyzed,
        "coarse_envelope": {
            "passed": coarse_passed,
            "envelope_iou": coarse_iou,
            "centroid_error_diagonal_ratio": centroid_error,
            "area_scale": area_scale,
            "frame_pass_fraction": coarse_pass_fraction,
        },
        "morphology_reconstruction_proxy": {
            "evidence_present": morphology_evidence,
            "canonical_mask_change": fine_mask_change,
            "boundary_change": boundary_change,
            "internal_topology_change": topology_change,
            "interpretation": (
                "Proxy evidence only. Passing does not prove the requested material identity; "
                "warning means recolor/shared-stencil behavior has not been ruled out."
            ),
        },
        "grayscale_feature_report": {
            "gate": "report_only",
            "mean_absolute_feature_delta": gray_feature_delta,
            "canonical_structure_correlation": gray_structure_correlation,
            "feature_definitions": {
                "mean_luminance": "Mean grayscale luminance inside the detected foreground.",
                "luminance_std": "Luminance spread inside the foreground.",
                "p10_p90_contrast": "Difference between foreground luminance percentiles 90 and 10.",
                "entropy_16": "Normalized 16-bin grayscale entropy.",
                "interior_gradient_mean": "Mean Sobel gradient away from the alpha boundary.",
                "interior_edge_density": "Fraction of interior pixels above the gradient proxy threshold.",
                "bright_fraction": "Fraction of foreground pixels with luminance at least 0.75.",
            },
        },
        "failures": failures,
        "warnings": warnings,
        "per_frame": per_frame,
    }


def analyze_pairwise_isomorphism(
    labels: Sequence[str],
    sequences: dict[str, Sequence[FrameData]],
    active_indices: Sequence[int],
    thresholds: dict[str, float | int],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for left_label, right_label in combinations(labels, 2):
        left = sequences[left_label]
        right = sequences[right_label]
        comparable = [
            index
            for index in active_indices
            if index < len(left)
            and index < len(right)
            and (left[index].width, left[index].height) == (right[index].width, right[index].height)
        ]
        per_frame: list[dict[str, Any]] = []
        for index in comparable:
            left_mask = canonicalize_mask(left[index].mask)
            right_mask = canonicalize_mask(right[index].mask)
            canonical_iou = mask_iou(left_mask, right_mask)
            boundary_f1 = tolerant_f1(boundary(left_mask), boundary(right_mask), 1)
            left_topology = topology_features(left[index].mask)
            right_topology = topology_features(right[index].mask)
            topology_change = topology_delta(left_topology, right_topology)["score"]
            per_frame.append(
                {
                    "index": index,
                    "canonical_mask_iou": canonical_iou,
                    "boundary_tolerant_f1": boundary_f1,
                    "topology_similarity": 1.0 - topology_change,
                    "exact_mask": bool(np.array_equal(left[index].mask, right[index].mask)),
                    "grayscale_structure_correlation_report_only": grayscale_structure_correlation(left[index], right[index]),
                }
            )
        mask_similarity = summarize(item["canonical_mask_iou"] for item in per_frame)
        boundary_similarity = summarize(item["boundary_tolerant_f1"] for item in per_frame)
        topology_similarity = summarize(item["topology_similarity"] for item in per_frame)
        gray_similarity = summarize(item["grayscale_structure_correlation_report_only"] for item in per_frame)
        exact_ratio = float(np.mean([item["exact_mask"] for item in per_frame])) if per_frame else 0.0
        isomorphism_signals = {
            "canonical_mask_similarity_high": bool(
                mask_similarity["median"] is not None
                and float(mask_similarity["median"]) >= float(thresholds["pairwise_mask_iou_alert_min"])
            ),
            "boundary_similarity_high": bool(
                boundary_similarity["median"] is not None
                and float(boundary_similarity["median"]) >= float(thresholds["pairwise_boundary_f1_alert_min"])
            ),
            "topology_similarity_high": bool(
                topology_similarity["median"] is not None
                and float(topology_similarity["median"])
                >= float(thresholds["pairwise_topology_similarity_alert_min"])
            ),
        }
        signal_count = sum(int(value) for value in isomorphism_signals.values())
        alert = bool(
            per_frame
            and (
                exact_ratio >= float(thresholds["pairwise_exact_mask_ratio_alert_min"])
                or signal_count >= 2
            )
        )
        results.append(
            {
                "left": left_label,
                "right": right_label,
                "status": "alert" if alert else "clear" if per_frame else "unavailable",
                "alert_code": "POTENTIAL_CROSS_MATERIAL_ISOMORPHISM" if alert else None,
                "interpretation": (
                    "Alert indicates shared geometric topology, not a subjective judgment about material quality."
                ),
                "comparable_frame_indices": comparable,
                "canonical_mask_iou": mask_similarity,
                "boundary_similarity": boundary_similarity,
                "topology_similarity": topology_similarity,
                "exact_mask_frame_ratio": exact_ratio,
                "isomorphism_signals": isomorphism_signals,
                "isomorphism_signal_count": signal_count,
                "grayscale_structure_correlation_report_only": gray_similarity,
                "per_frame": per_frame,
            }
        )
    return results


def source_report(frames: Sequence[FrameData], active_indices: Sequence[int]) -> dict[str, Any]:
    return {
        "active_frame_indices": list(active_indices),
        "area_curve": [area_ratio(frame.mask) for frame in frames],
        "per_frame": [
            {
                "index": index,
                "name": frame.name,
                "mask_source": frame.mask_source,
                "area_ratio": area_ratio(frame.mask),
                "topology": topology_features(frame.mask),
                "grayscale_features_report_only": grayscale_features(frame),
            }
            for index, frame in enumerate(frames)
        ],
    }


def composite_gray(frame: FrameData) -> Image.Image:
    foreground = frame.image.copy()
    background = Image.new("RGBA", foreground.size, (0, 0, 0, 255))
    return Image.alpha_composite(background, foreground).convert("L").convert("RGB")


def anonymous_row_id(index: int) -> str:
    value = index + 1
    output = ""
    while value > 0:
        value, remainder = divmod(value - 1, 26)
        output = chr(ord("A") + remainder) + output
    return output


def build_blind_review_rows(
    source: Sequence[FrameData],
    labels: Sequence[str],
    sequences: dict[str, Sequence[FrameData]],
) -> tuple[list[tuple[str, Sequence[FrameData]]], dict[str, Any]]:
    entries: list[tuple[str, str, Sequence[FrameData]]] = [("source", "source", source)] + [
        ("candidate", label, sequences[label]) for label in labels
    ]
    context = hashlib.sha256()
    context.update(BLIND_KEY_SCHEMA_VERSION.encode("utf-8"))
    for kind, label, frames in sorted(entries, key=lambda entry: (entry[0], entry[1])):
        context.update(f"\0{kind}\0{label}\0{len(frames)}".encode("utf-8"))
        for frame in frames:
            context.update(f"\0{frame.name}\0{frame.width}x{frame.height}\0".encode("utf-8"))
            context.update(frame.rgba.tobytes(order="C"))
    shuffle_digest = context.hexdigest()
    ordered = sorted(
        entries,
        key=lambda entry: hashlib.sha256(
            f"{shuffle_digest}\0{entry[0]}\0{entry[1]}".encode("utf-8")
        ).digest(),
    )
    rows: list[tuple[str, Sequence[FrameData]]] = []
    coordinator_rows: list[dict[str, str]] = []
    for index, (kind, label, frames) in enumerate(ordered):
        row_id = anonymous_row_id(index)
        rows.append((row_id, frames))
        coordinator_rows.append({"row_id": row_id, "kind": kind, "sequence_label": label})
    return rows, {
        "schema_version": BLIND_KEY_SCHEMA_VERSION,
        "shuffle": "stable-sha256-content-v1",
        "shuffle_digest": shuffle_digest,
        "rows": coordinator_rows,
    }


def save_grayscale_review_sheet(
    source: Sequence[FrameData],
    labels: Sequence[str],
    sequences: dict[str, Sequence[FrameData]],
    path: Path,
) -> dict[str, Any]:
    cell_width = 132
    cell_height = 96
    label_width = 100
    header_height = 22
    rows, coordinator_key = build_blind_review_rows(source, labels, sequences)
    column_count = max(len(frames) for _label, frames in rows)
    sheet = Image.new(
        "RGB",
        (label_width + cell_width * column_count, header_height + cell_height * len(rows)),
        (14, 14, 14),
    )
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index in range(column_count):
        draw.text((label_width + index * cell_width + 4, 5), f"F{index + 1}", fill=(205, 205, 205), font=font)
    for row_index, (label, frames) in enumerate(rows):
        y = header_height + row_index * cell_height
        draw.text((6, y + 8), label, fill=(235, 235, 235), font=font)
        for frame_index, frame in enumerate(frames):
            preview = composite_gray(frame)
            preview.thumbnail((cell_width - 8, cell_height - 8), Image.Resampling.LANCZOS)
            x = label_width + frame_index * cell_width + (cell_width - preview.width) // 2
            image_y = y + (cell_height - preview.height) // 2
            sheet.paste(preview, (x, image_y))
    sheet.save(path)
    return coordinator_key


def thresholds_from_args(args: argparse.Namespace) -> dict[str, float | int]:
    return {
        "alpha_threshold": args.alpha_threshold,
        "luma_threshold": args.luma_threshold,
        "active_area_ratio": args.active_area_ratio,
        "coarse_grid_size": args.coarse_grid_size,
        "coarse_cell_occupancy": args.coarse_cell_occupancy,
        "coarse_iou_frame_min": args.coarse_iou_frame_min,
        "coarse_iou_median_min": args.coarse_iou_median_min,
        "coarse_iou_p10_min": args.coarse_iou_p10_min,
        "centroid_error_frame_max": args.centroid_error_frame_max,
        "centroid_error_median_max": args.centroid_error_median_max,
        "area_scale_min": args.area_scale_min,
        "area_scale_max": args.area_scale_max,
        "coarse_pass_fraction_min": args.coarse_pass_fraction_min,
        "fine_boundary_tolerance_ratio": args.fine_boundary_tolerance_ratio,
        "fine_mask_change_median_min": args.fine_mask_change_median_min,
        "boundary_change_median_min": args.boundary_change_median_min,
        "topology_change_median_min": args.topology_change_median_min,
        "pairwise_mask_iou_alert_min": args.pairwise_mask_iou_alert_min,
        "pairwise_boundary_f1_alert_min": args.pairwise_boundary_f1_alert_min,
        "pairwise_topology_similarity_alert_min": args.pairwise_topology_similarity_alert_min,
        "pairwise_exact_mask_ratio_alert_min": args.pairwise_exact_mask_ratio_alert_min,
    }


def validate_thresholds(thresholds: dict[str, float | int]) -> None:
    for key, value in thresholds.items():
        if key == "coarse_grid_size":
            if int(value) < 8:
                raise ValueError("--coarse-grid-size must be at least 8")
            continue
        if key in {"area_scale_min", "area_scale_max"}:
            if not 0.0 <= float(value) <= 4.0:
                raise ValueError(f"Threshold {key} must be between 0 and 4; received {value}")
            continue
        if not 0.0 <= float(value) <= 1.0:
            raise ValueError(f"Threshold {key} must be between 0 and 1; received {value}")
    if float(thresholds["area_scale_min"]) > float(thresholds["area_scale_max"]):
        raise ValueError("--area-scale-min must not exceed --area-scale-max")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, type=Path, help="PNG frames that define structure and timing")
    parser.add_argument(
        "--sequence",
        required=True,
        action="append",
        type=parse_sequence_spec,
        help="label=frames_dir; repeat for each claimed target material",
    )
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--mask-mode", choices=("auto", "alpha", "luma"), default="auto")
    parser.add_argument("--require-alpha", action="store_true")
    parser.add_argument("--alpha-threshold", type=float, default=0.05)
    parser.add_argument("--luma-threshold", type=float, default=0.05)
    parser.add_argument("--active-area-ratio", type=float, default=0.20)
    parser.add_argument("--coarse-grid-size", type=int, default=32)
    parser.add_argument("--coarse-cell-occupancy", type=float, default=0.05)
    parser.add_argument("--coarse-iou-frame-min", type=float, default=0.45)
    parser.add_argument("--coarse-iou-median-min", type=float, default=0.65)
    parser.add_argument("--coarse-iou-p10-min", type=float, default=0.45)
    parser.add_argument("--centroid-error-frame-max", type=float, default=0.10)
    parser.add_argument("--centroid-error-median-max", type=float, default=0.05)
    parser.add_argument("--area-scale-min", type=float, default=0.75)
    parser.add_argument("--area-scale-max", type=float, default=1.35)
    parser.add_argument("--coarse-pass-fraction-min", type=float, default=0.80)
    parser.add_argument("--fine-boundary-tolerance-ratio", type=float, default=0.012)
    parser.add_argument("--fine-mask-change-median-min", type=float, default=0.15)
    parser.add_argument("--boundary-change-median-min", type=float, default=0.15)
    parser.add_argument("--topology-change-median-min", type=float, default=0.20)
    parser.add_argument("--pairwise-mask-iou-alert-min", type=float, default=0.88)
    parser.add_argument("--pairwise-boundary-f1-alert-min", type=float, default=0.90)
    parser.add_argument("--pairwise-topology-similarity-alert-min", type=float, default=0.90)
    parser.add_argument("--pairwise-exact-mask-ratio-alert-min", type=float, default=0.25)
    return parser


def run(args: argparse.Namespace) -> int:
    labels = [label for label, _directory in args.sequence]
    if len(set(labels)) != len(labels):
        raise ValueError("Every --sequence label must be unique")
    input_directories = {args.source_dir.resolve()} | {directory.resolve() for _label, directory in args.sequence}
    if args.output_dir.resolve() in input_directories:
        raise ValueError("--output-dir must not be the same directory as a source or candidate frame sequence")
    thresholds = thresholds_from_args(args)
    validate_thresholds(thresholds)
    source = load_sequence(
        args.source_dir,
        float(thresholds["alpha_threshold"]),
        float(thresholds["luma_threshold"]),
        args.mask_mode,
    )
    sequences = {
        label: load_sequence(
            directory,
            float(thresholds["alpha_threshold"]),
            float(thresholds["luma_threshold"]),
            args.mask_mode,
        )
        for label, directory in args.sequence
    }
    source_areas = [area_ratio(frame.mask) for frame in source]
    peak_area = max(source_areas)
    if peak_area <= 0:
        raise ValueError("Source sequence contains no detected foreground pixels")
    active_indices = [
        index
        for index, area in enumerate(source_areas)
        if area > 0 and area >= peak_area * float(thresholds["active_area_ratio"])
    ]
    source_contract = inspect_source_contract(source, args.require_alpha)
    sequence_results = {
        label: analyze_candidate(
            label,
            source,
            sequences[label],
            active_indices,
            thresholds,
            args.require_alpha,
        )
        for label in labels
    }
    pairwise = analyze_pairwise_isomorphism(labels, sequences, active_indices, thresholds)
    has_failure = not source_contract["passed"] or any(
        result["automated_status"] == "fail" for result in sequence_results.values()
    )
    has_warning = bool(source_contract["warnings"]) or any(
        result["automated_status"] == "warning" for result in sequence_results.values()
    ) or any(result["status"] == "alert" for result in pairwise)
    automated_status = "fail" if has_failure else "warning" if has_warning else "pass"

    args.output_dir.mkdir(parents=True, exist_ok=True)
    review_sheet_name = "grayscale-review-sheet.png"
    coordinator_key_name = "grayscale-review-coordinator-key.json"
    coordinator_key = save_grayscale_review_sheet(source, labels, sequences, args.output_dir / review_sheet_name)
    (args.output_dir / coordinator_key_name).write_text(
        json.dumps(coordinator_key, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    report = {
        "schema_version": SCHEMA_VERSION,
        "automated_status": automated_status,
        "final_acceptance": "pending_manual_grayscale_blind_test",
        "scope": {
            "automated": [
                "sequence frame-count/size/alpha contract",
                "coarse envelope preservation",
                "canonical fine-mask and boundary change",
                "connected-component/hole topology change",
                "cross-label geometric isomorphism alerts",
                "grayscale feature proxies",
            ],
            "not_automated": [
                "material identity",
                "art direction quality",
                "fire/lightning/ice/poison recognition",
                "source-material residue",
            ],
        },
        "inputs": {
            "source_dir": str(args.source_dir.resolve()),
            "sequences": {label: str(directory.resolve()) for label, directory in args.sequence},
            "mask_mode": args.mask_mode,
            "require_alpha": bool(args.require_alpha),
        },
        "thresholds": thresholds,
        "source_contract": source_contract,
        "source_report": source_report(source, active_indices),
        "sequences": sequence_results,
        "cross_material_isomorphism": pairwise,
        "manual_grayscale_blind_test_gate": {
            "required": True,
            "status": "pending",
            "review_sheet_anonymized": True,
            "coordinator_key_artifact": coordinator_key_name,
            "reason": (
                "Geometry and grayscale proxies cannot determine whether an image actually reads as the requested material."
            ),
            "recommended_protocol": [
                "Composite every frame on the same neutral background and remove hue/saturation.",
                "Give reviewers only the anonymized sheet; the coordinator retains the separate row key.",
                "Do not reveal filenames, material labels, or the row key until scoring is complete.",
                "Ask reviewers to identify the material and flag visible source-material residue.",
                "Recommended human gate: target recognition at least 75 percent and source-material dominance at most 20 percent.",
                "Review the sequence in motion; a static review cannot clear frame-to-frame identity drift or loop seams.",
            ],
        },
        "artifacts": {
            "grayscale_review_sheet": review_sheet_name,
            "grayscale_review_coordinator_key": coordinator_key_name,
        },
    }
    report_path = args.output_dir / "acceptance.json"
    report_path.write_text(json.dumps(rounded(report), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"AIFX material morphology acceptance: {automated_status.upper()}")
    print("Final material acceptance: PENDING MANUAL GRAYSCALE BLIND TEST")
    print(f"Report: {report_path.resolve()}")
    for label in labels:
        result = sequence_results[label]
        warning_codes = ",".join(item["code"] for item in result["warnings"]) or "none"
        failure_codes = ",".join(item["code"] for item in result["failures"]) or "none"
        print(
            f"  {label}: {result['automated_status'].upper()}; "
            f"coarse={result['coarse_envelope']['envelope_iou']['median']}; "
            f"fine-change={result['morphology_reconstruction_proxy']['canonical_mask_change']['median']}; "
            f"topology-change={result['morphology_reconstruction_proxy']['internal_topology_change']['median']}; "
            f"failures={failure_codes}; warnings={warning_codes}"
        )
    for pair in pairwise:
        if pair["status"] == "alert":
            print(f"  ALERT {pair['left']} vs {pair['right']}: {pair['alert_code']}")
    return 0 if automated_status == "pass" else 2


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return run(args)
    except (OSError, ValueError, cv2.error) as error:
        print(f"AIFX material morphology acceptance: ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
