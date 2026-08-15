#!/usr/bin/env python3
"""Run the AIFX_VIDEO_STYLE_LIFECYCLE_PIPELINE minimal productization check.

This tools-only pipeline keeps the successful validation architecture:

1. Run Wan VACE video-to-video candidates only as style sources.
2. Never use raw VACE frames as the final output.
3. Extract template lifecycle maps from the template PNG sequence.
4. Remix each VACE style source through the template lifecycle maps.
5. Save PNG sequences, curves, comparison grids, and summary.json.

It does not modify NovaFlow product UI/runtime code, does not use sprite sheet
style transfer, does not use IPAdapter fallback, and does not use local material
transfer as a fallback path.
"""

from __future__ import annotations

import argparse
import json
import math
import time
import traceback
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw

from aifx_green_slash_lightning_v2v_test import (
    DEFAULT_TEMPLATE_DIR,
    LOG_PATH,
    NEGATIVE_PROMPT,
    PROMPT,
    V2VConfig,
    build_workflow,
    collect_outputs,
    compute_lifecycle_curve,
    draw_curve_chart,
    evaluate_candidate,
    ensure_environment,
    make_strip,
    prepare_template_video,
    queue_workflow,
    wait_for_prompt,
    write_json,
)
from aifx_vace_style_template_lifecycle_test import (
    compose_remixed_frame,
    composite_rgba_on_black,
    extract_template_maps,
    rgba_to_black_preview,
    sorted_pngs,
    style_profile,
    write_mp4_from_frames,
)


PIPELINE = "AIFX_VIDEO_STYLE_LIFECYCLE_PIPELINE"
REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-video-style-lifecycle-pipeline"
TEXTURE_RANK = {"rough": 0, "medium": 1, "good": 2}


@dataclass
class PipelineConfig:
    comfy_base: str = "http://127.0.0.1:8188"
    template_dir: str = str(DEFAULT_TEMPLATE_DIR)
    width: int = 768
    height: int = 384
    fps: int = 12
    frame_count: int = 9
    seed: int = 2026050301
    candidate_count: int = 4
    diffusion_model: str = "wan2.1_vace_1.3B_fp16.safetensors"
    text_encoder: str = "umt5_xxl_fp8_e4m3fn_scaled.safetensors"
    vae: str = "wan_2.1_vae.safetensors"
    steps: int = 8
    cfg: float = 5.5
    denoise: float = 1.0
    vace_strength: float = 1.0
    sampler_name: str = "uni_pc"
    scheduler: str = "simple"
    timeout: int = 3600
    positive_prompt: str = PROMPT
    negative_prompt: str = NEGATIVE_PROMPT
    style_reference: str = ""
    inferred_effect_type: str = "energy"
    prompt_variants: list[dict[str, Any]] = field(default_factory=list)


def to_v2v_config(config: PipelineConfig) -> V2VConfig:
    return V2VConfig(
        comfy_base=config.comfy_base,
        template_dir=config.template_dir,
        width=config.width,
        height=config.height,
        fps=config.fps,
        frame_count=config.frame_count,
        seed=config.seed,
        candidate_count=config.candidate_count,
        diffusion_model=config.diffusion_model,
        text_encoder=config.text_encoder,
        vae=config.vae,
        steps=config.steps,
        cfg=config.cfg,
        denoise=config.denoise,
        vace_strength=config.vace_strength,
        sampler_name=config.sampler_name,
        scheduler=config.scheduler,
        timeout=config.timeout,
    )


def normalize_prompt_variants(config: PipelineConfig) -> list[dict[str, str]]:
    variants: list[dict[str, str]] = []
    for index, item in enumerate(config.prompt_variants or []):
        if not isinstance(item, dict):
            continue
        positive = str(item.get("positivePrompt") or item.get("positive_prompt") or "").strip()
        if not positive:
            continue
        negative = str(item.get("negativePrompt") or item.get("negative_prompt") or config.negative_prompt or NEGATIVE_PROMPT).strip()
        name = str(item.get("name") or item.get("promptVariantName") or f"variant_{index}").strip()
        inferred = str(item.get("inferredEffectType") or config.inferred_effect_type or "energy").strip()
        variants.append(
            {
                "name": name or f"variant_{index}",
                "positivePrompt": positive,
                "negativePrompt": negative,
                "inferredEffectType": inferred or "energy",
            }
        )
    if variants:
        return variants[: max(1, config.candidate_count)]
    return [
        {
            "name": "base-style-source",
            "positivePrompt": config.positive_prompt or PROMPT,
            "negativePrompt": config.negative_prompt or NEGATIVE_PROMPT,
            "inferredEffectType": config.inferred_effect_type or "energy",
        }
    ]


def prompt_variant_for_candidate(config: PipelineConfig, candidate_id: int) -> dict[str, str]:
    variants = normalize_prompt_variants(config)
    return variants[candidate_id % len(variants)]


def _dominant_rgb_and_hsv(image: np.ndarray) -> dict[str, float]:
    rgb = image.astype(np.float32)
    if rgb.ndim == 2:
        rgb = np.repeat(rgb[:, :, None], 3, axis=2)
    luminance_map = rgb[:, :, 0] * 0.2126 + rgb[:, :, 1] * 0.7152 + rgb[:, :, 2] * 0.0722
    saturation_map = (np.max(rgb, axis=2) - np.min(rgb, axis=2)) / np.maximum(1.0, np.max(rgb, axis=2))
    weights = 0.1 + (luminance_map / 255.0) * 0.8 + saturation_map * 0.35
    weights = weights / max(float(np.sum(weights)), 1.0)
    r = float(np.sum(rgb[:, :, 0] * weights))
    g = float(np.sum(rgb[:, :, 1] * weights))
    b = float(np.sum(rgb[:, :, 2] * weights))
    max_c = max(r, g, b) / 255.0
    min_c = min(r, g, b) / 255.0
    delta = max_c - min_c
    if delta <= 1e-6:
        hue = 0.0
    elif max_c == r / 255.0:
        hue = (60.0 * (((g / 255.0) - (b / 255.0)) / delta) + 360.0) % 360.0
    elif max_c == g / 255.0:
        hue = 60.0 * (((b / 255.0) - (r / 255.0)) / delta + 2.0)
    else:
        hue = 60.0 * (((r / 255.0) - (g / 255.0)) / delta + 4.0)
    saturation = 0.0 if max_c <= 1e-6 else delta / max_c
    return {"r": r, "g": g, "b": b, "hue": hue, "saturation": saturation, "brightness": max_c}


def _feature_from_paths(paths: list[Path], sample_count: int = 5) -> dict[str, Any]:
    usable = [path for path in paths if path and path.exists()]
    if not usable:
        return {
            "hue": 0.0,
            "saturation": 0.0,
            "brightness": 0.0,
            "edgeDensity": 0.0,
            "brightRatio": 0.0,
            "componentCount": 0.0,
        }
    if len(usable) > sample_count:
        indexes = np.linspace(0, len(usable) - 1, sample_count).round().astype(int)
        usable = [usable[int(index)] for index in indexes]
    hues: list[float] = []
    sats: list[float] = []
    values: list[float] = []
    edge_density: list[float] = []
    bright_ratio: list[float] = []
    component_counts: list[float] = []
    for path in usable:
        image = np.array(Image.open(path).convert("RGB"))
        color = _dominant_rgb_and_hsv(image)
        hues.append(float(color["hue"]))
        sats.append(float(color["saturation"]))
        values.append(float(color["brightness"]))
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(gray, 45, 130)
        edge_density.append(float(np.mean(edges > 0)))
        threshold = max(35, int(np.mean(gray) + np.std(gray) * 0.7))
        bright = (gray > threshold).astype(np.uint8)
        bright_ratio.append(float(np.mean(bright > 0)))
        count, _, stats, _ = cv2.connectedComponentsWithStats(bright, 8)
        min_area = max(2, int(gray.size * 0.00025))
        components = sum(1 for index in range(1, count) if stats[index, cv2.CC_STAT_AREA] >= min_area)
        component_counts.append(float(components))
    return {
        "hue": float(np.mean(hues)),
        "saturation": float(np.mean(sats)),
        "brightness": float(np.mean(values)),
        "edgeDensity": float(np.mean(edge_density)),
        "brightRatio": float(np.mean(bright_ratio)),
        "componentCount": float(np.mean(component_counts)),
    }


def _hue_similarity(a: float, b: float) -> float:
    delta = abs((a - b + 180.0) % 360.0 - 180.0)
    return max(0.0, 1.0 - delta / 180.0)


def evaluate_style_semantic_match(
    raw_style_frames: list[Path],
    reference_image: str,
    candidate: dict[str, Any],
) -> dict[str, Any]:
    raw_features = _feature_from_paths(raw_style_frames)
    reference_features = _feature_from_paths([Path(reference_image)]) if reference_image else {}
    prompt = f"{candidate.get('positivePrompt', '')} {candidate.get('promptVariantName', '')}".lower()
    tags = {
      "branching": any(token in prompt for token in ("branching", "jagged", "fork", "electric", "lightning")),
      "vortex": any(token in prompt for token in ("vortex", "spiral", "rotating", "circular", "swirling")),
      "burst": any(token in prompt for token in ("burst", "radial", "core")),
      "particles": any(token in prompt for token in ("particle", "spark", "fragment", "debris")),
    }
    color_score = _hue_similarity(raw_features["hue"], float(reference_features.get("hue", raw_features["hue"]))) if reference_features else 0.5
    edge_score = min(1.0, raw_features["edgeDensity"] / 0.055)
    particle_score = min(1.0, raw_features["componentCount"] / 7.0)
    burst_score = min(1.0, raw_features["brightRatio"] / 0.22)
    topology_scores: list[float] = []
    if tags["branching"]:
        topology_scores.append((edge_score * 0.7) + (particle_score * 0.3))
    if tags["vortex"]:
        topology_scores.append((edge_score * 0.45) + (burst_score * 0.35) + (raw_features["saturation"] * 0.2))
    if tags["burst"]:
        topology_scores.append((burst_score * 0.7) + (edge_score * 0.3))
    if tags["particles"]:
        topology_scores.append((particle_score * 0.75) + (edge_score * 0.25))
    topology_score = float(np.mean(topology_scores)) if topology_scores else (edge_score * 0.5 + burst_score * 0.25 + particle_score * 0.25)
    score = max(0.0, min(1.0, color_score * 0.35 + topology_score * 0.5 + raw_features["saturation"] * 0.15))
    reason = []
    if color_score < 0.45:
        reason.append("output hue is weakly aligned with reference")
    if topology_score < 0.4:
        reason.append("raw style source lacks requested structural topology")
    if not reason:
        reason.append("raw style source follows reference color/topology cues")
    return {
        "score": round(score, 3),
        "pass": bool(score >= 0.48),
        "variantTags": [name for name, enabled in tags.items() if enabled],
        "reason": "; ".join(reason),
        "referenceFeatures": {key: round(float(value), 3) for key, value in reference_features.items()} if reference_features else {},
        "rawStyleFeatures": {key: round(float(value), 3) for key, value in raw_features.items()},
    }


def assess_prompt_variant_effectiveness(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    features = [candidate.get("style_semantic_match", {}).get("rawStyleFeatures", {}) for candidate in candidates]
    features = [item for item in features if item]
    names = [str(candidate.get("promptVariantName") or "") for candidate in candidates]
    unique_names = len(set(name for name in names if name))
    if len(features) < 2 or unique_names < 2:
        return {"status": "not_enough_data", "message": "prompt variant effectiveness could not be measured"}
    distances: list[float] = []
    for left_index in range(len(features)):
        for right_index in range(left_index + 1, len(features)):
            left = features[left_index]
            right = features[right_index]
            hue_delta = abs((float(left.get("hue", 0)) - float(right.get("hue", 0)) + 180.0) % 360.0 - 180.0) / 180.0
            edge_delta = abs(float(left.get("edgeDensity", 0)) - float(right.get("edgeDensity", 0))) * 10.0
            component_delta = abs(float(left.get("componentCount", 0)) - float(right.get("componentCount", 0))) / 12.0
            bright_delta = abs(float(left.get("brightRatio", 0)) - float(right.get("brightRatio", 0))) * 2.5
            distances.append(min(1.0, hue_delta * 0.35 + edge_delta * 0.25 + component_delta * 0.25 + bright_delta * 0.15))
    average_distance = float(np.mean(distances)) if distances else 0.0
    ignored = average_distance < 0.075
    return {
        "status": "ignored" if ignored else "effective",
        "message": "VACE ignored prompt variants" if ignored else "prompt variants changed the raw style source",
        "averageFeatureDistance": round(average_distance, 4),
        "variantNames": names,
    }


def append_readable_debug_log(status: str, reason: str, detail: str, impact: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M")
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(
            f"\n[{stamp}]\n"
            f"- 问题：{status}\n"
            f"- 原因：{reason}\n"
            f"- 解决方案：{detail}\n"
            f"- 影响范围：{impact}\n"
        )


def normalize_frame_list(frame_paths: list[Path], target_count: int) -> list[Path]:
    usable = [path for path in frame_paths if path.exists()]
    if not usable:
        raise RuntimeError("No usable raw VACE style frames were produced.")
    if len(usable) >= target_count:
        return usable[:target_count]
    return (usable * math.ceil(target_count / len(usable)))[:target_count]


def prepare_template_assets(
    template_dir: Path,
    frame_count: int,
    out_dir: Path,
) -> dict[str, Any]:
    source_frames = sorted_pngs(template_dir)[:frame_count]
    if len(source_frames) < frame_count:
        raise RuntimeError(f"Template has {len(source_frames)} frames, need {frame_count}")

    preview_dir = out_dir / "template_black_frames"
    maps_root = out_dir / "template_lifecycle_maps"
    preview_dir.mkdir(parents=True, exist_ok=True)
    maps_root.mkdir(parents=True, exist_ok=True)

    preview_frames: list[Path] = []
    for index, frame in enumerate(source_frames):
        preview = composite_rgba_on_black(frame)
        target = preview_dir / f"frame_{index:03d}.png"
        preview.save(target)
        preview_frames.append(target)

    maps = [extract_template_maps(frame, index, maps_root) for index, frame in enumerate(source_frames)]
    lifecycle_curve = compute_lifecycle_curve(preview_frames)
    strip = make_strip(preview_frames, out_dir / "template_lifecycle_strip.png", label="template lifecycle")
    curve = draw_curve_chart(
        {
            "bbox": lifecycle_curve["normalized"]["bboxSize"],
            "contour": lifecycle_curve["normalized"]["contourComplexity"],
            "components": lifecycle_curve["normalized"]["componentCount"],
            "shape": lifecycle_curve["normalized"]["shapeEvolution"],
        },
        out_dir / "template_lifecycle_curves.png",
        "template lifecycle maps",
    )
    return {
        "sourceFrames": source_frames,
        "previewFrames": preview_frames,
        "maps": maps,
        "lifecycleCurve": lifecycle_curve,
        "strip": strip,
        "curveChart": curve,
    }


def run_raw_vace_candidate(
    config: V2VConfig,
    prompt_config: PipelineConfig,
    template_video: Path,
    out_dir: Path,
    timestamp: str,
    candidate_id: int,
) -> dict[str, Any]:
    seed = config.seed + candidate_id
    prompt_variant = prompt_variant_for_candidate(prompt_config, candidate_id)
    prefix = f"{PIPELINE}_{timestamp}/raw_candidate_{candidate_id}"
    workflow = build_workflow(config, template_video, seed, prefix)
    workflow["4"]["inputs"]["text"] = prompt_variant["positivePrompt"]
    workflow["5"]["inputs"]["text"] = prompt_variant["negativePrompt"]
    workflow_dir = out_dir / "workflows"
    workflow_dir.mkdir(parents=True, exist_ok=True)
    write_json(workflow_dir / f"candidate_{candidate_id}.json", workflow)
    if candidate_id == 0:
        write_json(out_dir / "workflow.json", workflow)

    print(
        f"[{PIPELINE}] raw style candidate={candidate_id} seed={seed} "
        f"promptVariant={prompt_variant['name']}",
        flush=True,
    )
    started = time.time()
    prompt_id = queue_workflow(config, workflow)
    history = wait_for_prompt(config, prompt_id)
    outputs = collect_outputs(config, history, out_dir / "raw_vace", candidate_id)
    raw_frames = [Path(path) for path in outputs["videoExtractedFrames"] or outputs["frames"]]
    raw_frames = normalize_frame_list(raw_frames, config.frame_count)
    return {
        "id": candidate_id,
        "seed": seed,
        "promptVariantName": prompt_variant["name"],
        "positivePrompt": prompt_variant["positivePrompt"],
        "negativePrompt": prompt_variant["negativePrompt"],
        "inferredEffectType": prompt_variant["inferredEffectType"],
        "promptId": prompt_id,
        "elapsedSeconds": round(time.time() - started, 2),
        "rawVideoPath": outputs.get("video"),
        "rawFrames": raw_frames,
        "workflow": str(workflow_dir / f"candidate_{candidate_id}.json"),
    }


def remix_candidate_with_template_lifecycle(
    candidate: dict[str, Any],
    template_assets: dict[str, Any],
    out_dir: Path,
    fps: int,
    style_reference: str,
) -> dict[str, Any]:
    candidate_id = int(candidate["id"])
    template_frames: list[Path] = template_assets["sourceFrames"]
    template_previews: list[Path] = template_assets["previewFrames"]
    template_maps: list[dict[str, Any]] = template_assets["maps"]
    template_curve: dict[str, Any] = template_assets["lifecycleCurve"]

    raw_frames = normalize_frame_list(list(candidate["rawFrames"]), len(template_frames))
    size = Image.open(template_frames[0]).convert("RGBA").size
    profile = style_profile(raw_frames, size)

    candidate_dir = out_dir / "candidates" / f"candidate_{candidate_id}"
    raw_style_dir = candidate_dir / "raw_vace_style_frames"
    result_rgba_dir = candidate_dir / "result_png_sequence"
    result_preview_dir = candidate_dir / "result_black_preview_frames"
    for directory in (raw_style_dir, result_rgba_dir, result_preview_dir):
        directory.mkdir(parents=True, exist_ok=True)

    raw_preview_paths: list[Path] = []
    result_rgba_paths: list[Path] = []
    result_preview_paths: list[Path] = []
    for frame_index, template_path in enumerate(template_frames):
        raw_preview = Image.open(raw_frames[frame_index]).convert("RGB").resize(size, Image.Resampling.LANCZOS)
        raw_preview_path = raw_style_dir / f"frame_{frame_index:03d}.png"
        raw_preview.save(raw_preview_path)
        raw_preview_paths.append(raw_preview_path)

        remixed = compose_remixed_frame(
            template_path,
            template_maps[frame_index],
            profile["styleFrames"][frame_index % len(profile["styleFrames"])],
            profile,
            frame_index,
        )
        rgba_path = result_rgba_dir / f"frame_{frame_index:03d}.png"
        remixed.save(rgba_path)
        result_rgba_paths.append(rgba_path)

        preview = rgba_to_black_preview(remixed)
        preview_path = result_preview_dir / f"frame_{frame_index:03d}.png"
        preview.save(preview_path)
        result_preview_paths.append(preview_path)

    raw_curve = compute_lifecycle_curve(raw_preview_paths)
    result_curve = compute_lifecycle_curve(result_preview_paths)
    metrics = evaluate_candidate(template_previews, result_preview_paths, template_curve)
    style_semantic_match = evaluate_style_semantic_match(raw_preview_paths, style_reference, candidate)
    metrics["style_semantic_match"] = style_semantic_match
    severe_artifacts = bool(metrics.get("hasArtifacts"))
    usable = bool(
        metrics.get("lifecycle_pass")
        and metrics.get("direction_pass")
        and TEXTURE_RANK.get(str(metrics.get("texture_quality")), 0) >= TEXTURE_RANK["medium"]
        and not severe_artifacts
    )

    raw_strip = make_strip(raw_preview_paths, candidate_dir / "raw_vace_style_strip.png", label=f"raw VACE {candidate_id}")
    result_strip = make_strip(result_preview_paths, candidate_dir / "lifecycle_remix_strip.png", label=f"remix {candidate_id}")
    curve_chart = draw_curve_chart(
        {
            "template": template_curve["normalized"]["shapeEvolution"],
            "raw VACE": raw_curve["normalized"]["shapeEvolution"],
            "remixed": result_curve["normalized"]["shapeEvolution"],
        },
        candidate_dir / "shape_lifecycle_curves.png",
        f"candidate {candidate_id} lifecycle curves",
    )
    result_video = write_mp4_from_frames(result_preview_paths, candidate_dir / "lifecycle_remix_preview.mp4", fps)
    write_json(
        candidate_dir / "candidate_summary.json",
        {
            "id": candidate_id,
            "seed": candidate["seed"],
            "promptVariantName": candidate.get("promptVariantName"),
            "positivePrompt": candidate.get("positivePrompt"),
            "negativePrompt": candidate.get("negativePrompt"),
            "inferredEffectType": candidate.get("inferredEffectType"),
            "style_semantic_match": style_semantic_match,
            "usable": usable,
            "rawVideoPath": candidate.get("rawVideoPath"),
            "rawFrameCount": len(raw_preview_paths),
            "resultFrameCount": len(result_rgba_paths),
            "metrics": metrics,
            "rawVaceLifecycleCurve": raw_curve,
            "remixedLifecycleCurve": result_curve,
            "outputs": {
                "rawVaceStyleStrip": str(raw_strip),
                "lifecycleRemixStrip": str(result_strip),
                "shapeLifecycleCurves": str(curve_chart),
                "resultVideo": str(result_video) if result_video else None,
                "resultPngSequence": [str(path) for path in result_rgba_paths],
                "resultPreviewFrames": [str(path) for path in result_preview_paths],
            },
        },
    )
    return {
        "id": candidate_id,
        "seed": candidate["seed"],
        "promptVariantName": candidate.get("promptVariantName"),
        "positivePrompt": candidate.get("positivePrompt"),
        "negativePrompt": candidate.get("negativePrompt"),
        "inferredEffectType": candidate.get("inferredEffectType"),
        "style_semantic_match": style_semantic_match,
        "promptId": candidate["promptId"],
        "elapsedSeconds": candidate["elapsedSeconds"],
        "usable": usable,
        "severeArtifacts": severe_artifacts,
        "rawVideoPath": candidate.get("rawVideoPath"),
        "rawFrames": [str(path) for path in raw_preview_paths],
        "resultPngSequence": [str(path) for path in result_rgba_paths],
        "resultPreviewFrames": [str(path) for path in result_preview_paths],
        "metrics": metrics,
        "rawVaceLifecycleCurve": raw_curve,
        "remixedLifecycleCurve": result_curve,
        "outputs": {
            "rawVaceStyleStrip": str(raw_strip),
            "lifecycleRemixStrip": str(result_strip),
            "shapeLifecycleCurves": str(curve_chart),
            "resultVideo": str(result_video) if result_video else None,
        },
    }


def make_pipeline_comparison_grid(
    template_strip: Path,
    candidates: list[dict[str, Any]],
    target: Path,
) -> Path:
    rows: list[tuple[str, Image.Image]] = [("template", Image.open(template_strip).convert("RGB"))]
    for candidate in candidates:
        rows.append((f"raw VACE {candidate['id']}", Image.open(candidate["outputs"]["rawVaceStyleStrip"]).convert("RGB")))
        rows.append((f"lifecycle remix {candidate['id']}", Image.open(candidate["outputs"]["lifecycleRemixStrip"]).convert("RGB")))

    label_w = 150
    width = label_w + max(image.width for _, image in rows)
    height = sum(image.height for _, image in rows)
    canvas = Image.new("RGB", (width, height), (8, 10, 14))
    draw = ImageDraw.Draw(canvas)
    y = 0
    for label, image in rows:
        draw.text((8, y + 8), label, fill=(255, 255, 255))
        canvas.paste(image, (label_w, y))
        y += image.height
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target)
    return target


def make_all_candidate_curve_chart(
    template_curve: dict[str, Any],
    candidates: list[dict[str, Any]],
    target: Path,
) -> Path:
    curves: dict[str, list[float]] = {"template": template_curve["normalized"]["shapeEvolution"]}
    for candidate in candidates:
        curves[f"remix {candidate['id']}"] = candidate["remixedLifecycleCurve"]["normalized"]["shapeEvolution"]
    return draw_curve_chart(curves, target, "AIFX video style lifecycle candidates")


def run_pipeline(config: PipelineConfig) -> tuple[Path, dict[str, Any]]:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = OUTPUT_ROOT / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)
    v2v_config = to_v2v_config(config)

    summary: dict[str, Any] = {
        "pipeline": PIPELINE,
        "status": "unknown",
        "resultStatus": "unknown",
        "template": str(Path(config.template_dir)),
        "referenceImage": config.style_reference,
        "inferredEffectType": config.inferred_effect_type,
        "prompt": config.positive_prompt or PROMPT,
        "negativePrompt": config.negative_prompt or NEGATIVE_PROMPT,
        "promptVariants": normalize_prompt_variants(config),
        "candidateCount": config.candidate_count,
        "seed": config.seed,
        "config": asdict(config),
        "principles": {
            "rawVaceFinalOutput": False,
            "vaceRole": "style source only",
            "templateLifecycleControls": [
                "alpha",
                "bbox",
                "edge",
                "particle",
                "component",
                "brightness",
                "dissipate",
            ],
            "fallbacks": [],
        },
        "candidates": [],
    }

    env_ok, env_report = ensure_environment(v2v_config, out_dir)
    summary["environment"] = env_report
    if not env_ok:
        summary["status"] = "fail"
        summary["resultStatus"] = "fail"
        summary["failureReason"] = env_report.get("failureReason", "ComfyUI VACE environment unavailable")
        write_json(out_dir / "summary.json", summary)
        append_readable_debug_log(
            "AIFX_VIDEO_STYLE_LIFECYCLE_PIPELINE 环境不可验证",
            summary["failureReason"],
            f"pipeline={PIPELINE}; 输出={out_dir}; 未回退 sprite sheet/IPAdapter/material transfer。",
            "仅 tools 验证链路；不影响 AI 特效主入口、UI、导出或 Spine。",
        )
        return out_dir, summary

    template_video_meta = prepare_template_video(v2v_config, out_dir)
    template_assets = prepare_template_assets(Path(config.template_dir), config.frame_count, out_dir)
    summary["templateVideoMeta"] = template_video_meta
    summary["templateLifecycle"] = {
        "strip": str(template_assets["strip"]),
        "curveChart": str(template_assets["curveChart"]),
        "curve": template_assets["lifecycleCurve"],
    }

    raw_candidates: list[dict[str, Any]] = []
    remixed_candidates: list[dict[str, Any]] = []
    for candidate_id in range(config.candidate_count):
        try:
            raw_candidate = run_raw_vace_candidate(
                v2v_config,
                config,
                Path(template_video_meta["templateVideo"]),
                out_dir,
                timestamp,
                candidate_id,
            )
            raw_candidates.append(raw_candidate)
            remixed = remix_candidate_with_template_lifecycle(
                raw_candidate,
                template_assets,
                out_dir,
                config.fps,
                config.style_reference,
            )
            remixed_candidates.append(remixed)
            summary["candidates"].append(remixed)
            write_json(out_dir / "summary.partial.json", summary)
        except Exception as exc:
            failed_variant = prompt_variant_for_candidate(config, candidate_id)
            failure = {
                "id": candidate_id,
                "seed": config.seed + candidate_id,
                "promptVariantName": failed_variant["name"],
                "positivePrompt": failed_variant["positivePrompt"],
                "negativePrompt": failed_variant["negativePrompt"],
                "inferredEffectType": failed_variant["inferredEffectType"],
                "style_semantic_match": {"score": 0.0, "pass": False, "reason": "candidate generation failed"},
                "usable": False,
                "failureReason": repr(exc),
                "traceback": traceback.format_exc(),
            }
            summary["candidates"].append(failure)
            write_json(out_dir / "summary.partial.json", summary)
            print(f"[{PIPELINE}] candidate {candidate_id} failed: {exc!r}", flush=True)

    usable = [candidate for candidate in remixed_candidates if candidate.get("usable")]
    comparison_grid = make_pipeline_comparison_grid(
        Path(template_assets["strip"]),
        remixed_candidates,
        out_dir / "comparison_grid.png",
    ) if remixed_candidates else None
    curve_grid = make_all_candidate_curve_chart(
        template_assets["lifecycleCurve"],
        remixed_candidates,
        out_dir / "all_candidate_lifecycle_curves.png",
    ) if remixed_candidates else None

    best = None
    if remixed_candidates:
        best = max(
            remixed_candidates,
            key=lambda item: (
                1 if item.get("usable") else 0,
                TEXTURE_RANK.get(str(item.get("metrics", {}).get("texture_quality")), 0),
                float(item.get("metrics", {}).get("shapeLifecycleMetrics", {}).get("shapeCurveCorrelation", 0.0)),
            ),
        )

    summary.update(
        {
            "rawVaceRunCount": len(raw_candidates),
            "lifecycleRemixCount": len(remixed_candidates),
            "promptVariantAssessment": assess_prompt_variant_effectiveness(remixed_candidates),
            "passCount": len(usable),
            "failCount": config.candidate_count - len(usable),
            "status": "pass" if usable else "fail",
            "resultStatus": "pass" if usable else "fail",
            "failureReason": "" if usable else "No candidate met lifecycle/direction/texture/artifact thresholds.",
            "bestCandidateId": best["id"] if best else None,
            "outputs": {
                "summary": str(out_dir / "summary.json"),
                "comparisonGrid": str(comparison_grid) if comparison_grid else None,
                "allCandidateLifecycleCurves": str(curve_grid) if curve_grid else None,
            },
        }
    )
    write_json(out_dir / "summary.json", summary)
    append_readable_debug_log(
        "AIFX_VIDEO_STYLE_LIFECYCLE_PIPELINE 最小产品化验证完成",
        "基于成功验证链路封装 4 seed 候选；raw VACE 只作为风格源，最终 PNG 序列由模板 lifecycle maps 重新合成。",
        (
            f"pipeline={PIPELINE}; rawVaceRunCount={len(raw_candidates)}; "
            f"lifecycleRemixCount={len(remixed_candidates)}; passCount={len(usable)}; "
            f"resultStatus={summary['resultStatus']}; 输出={out_dir}"
        ),
        "仅新增 tools 独立 pipeline 和 debug-output 结果；不改旧 AI 特效主入口、UI、导出或 Spine。",
    )
    return out_dir, summary


def parse_args() -> PipelineConfig:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-base", default="http://127.0.0.1:8188")
    parser.add_argument("--template-dir", default=str(DEFAULT_TEMPLATE_DIR))
    parser.add_argument("--seed", type=int, default=2026050301)
    parser.add_argument("--candidate-count", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=3600)
    parser.add_argument("--width", type=int, default=768)
    parser.add_argument("--height", type=int, default=384)
    parser.add_argument("--fps", type=int, default=12)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--cfg", type=float, default=5.5)
    parser.add_argument("--vace-strength", type=float, default=1.0)
    parser.add_argument("--frame-count", type=int, default=9)
    parser.add_argument("--positive-prompt", default=PROMPT)
    parser.add_argument("--negative-prompt", default=NEGATIVE_PROMPT)
    parser.add_argument("--style-reference", default="")
    parser.add_argument("--inferred-effect-type", default="energy")
    parser.add_argument("--prompt-variants-file", default="")
    args = parser.parse_args()
    prompt_variants: list[dict[str, Any]] = []
    if args.prompt_variants_file:
        variants_path = Path(args.prompt_variants_file)
        if variants_path.exists():
            payload = json.loads(variants_path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                payload = payload.get("promptVariants") or payload.get("variants") or []
            if isinstance(payload, list):
                prompt_variants = [item for item in payload if isinstance(item, dict)]
    return PipelineConfig(
        comfy_base=args.comfy_base,
        template_dir=args.template_dir,
        seed=args.seed,
        candidate_count=args.candidate_count,
        timeout=args.timeout,
        width=args.width,
        height=args.height,
        fps=args.fps,
        frame_count=args.frame_count,
        steps=args.steps,
        cfg=args.cfg,
        vace_strength=args.vace_strength,
        positive_prompt=args.positive_prompt,
        negative_prompt=args.negative_prompt,
        style_reference=args.style_reference,
        inferred_effect_type=args.inferred_effect_type,
        prompt_variants=prompt_variants,
    )


def main() -> int:
    out_dir, summary = run_pipeline(parse_args())
    print(
        json.dumps(
            {
                "outputDir": str(out_dir),
                "pipeline": PIPELINE,
                "resultStatus": summary.get("resultStatus"),
                "passCount": summary.get("passCount"),
                "bestCandidateId": summary.get("bestCandidateId"),
            },
            ensure_ascii=False,
        )
    )
    return 0 if summary.get("resultStatus") == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
