#!/usr/bin/env python3
"""Validate VACE style source remixed through template lifecycle maps.

Pipeline:
1. Use the latest AIFX_GREEN_SLASH_TO_LIGHTNING_V2V_TEST raw VACE output as a
   lightning style source.
2. Extract template lifecycle maps from the built-in green slash sequence.
3. Sample VACE color / glow / edge texture, then recompose every frame through
   the template alpha, edge, particle, component, brightness, and bbox lifecycle.

This is an experiment-only script. It does not run a new VACE prompt, does not
use sprite-sheet IPAdapter, does not use local simple recolor as the final
pipeline, and does not modify NovaFlow product UI/runtime code.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw

from aifx_green_slash_lightning_v2v_test import (
    DEFAULT_TEMPLATE_DIR,
    LOG_PATH,
    append_debug_log,
    compute_lifecycle_curve,
    draw_curve_chart,
    evaluate_candidate,
    make_strip,
    write_json,
)


PIPELINE = "AIFX_VACE_STYLE_WITH_TEMPLATE_LIFECYCLE_TEST"
REPO_ROOT = Path(__file__).resolve().parents[1]
V2V_OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-green-slash-lightning-v2v-test"
OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-vace-style-template-lifecycle-test"


@dataclass
class LifecycleRemixConfig:
    template_dir: str = str(DEFAULT_TEMPLATE_DIR)
    style_source_dir: str | None = None
    candidate_id: int | None = None
    fps: int = 12


def sorted_pngs(directory: Path) -> list[Path]:
    frames = sorted(directory.glob("*.png"))
    if not frames:
        raise RuntimeError(f"No PNG frames found in {directory}")
    return frames


def latest_v2v_summary() -> Path:
    summaries = sorted(V2V_OUTPUT_ROOT.glob("*/summary.json"), reverse=True)
    if not summaries:
        raise RuntimeError("No existing V2V summary found. Run AIFX_GREEN_SLASH_TO_LIGHTNING_V2V_TEST first.")
    return summaries[0]


def select_style_source(config: LifecycleRemixConfig) -> dict[str, Any]:
    if config.style_source_dir:
        source_dir = Path(config.style_source_dir)
        candidates = sorted_pngs(source_dir)
        return {
            "summary": None,
            "candidateId": config.candidate_id,
            "frames": candidates,
            "sourceDir": str(source_dir),
            "selectionReason": "explicit --style-source-dir",
        }

    summary_path = latest_v2v_summary()
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    candidates = summary.get("candidates", [])
    if not candidates:
        raise RuntimeError(f"V2V summary has no candidates: {summary_path}")

    if config.candidate_id is not None:
        selected = next((item for item in candidates if int(item.get("id", -1)) == config.candidate_id), None)
        if selected is None:
            raise RuntimeError(f"Candidate {config.candidate_id} not found in {summary_path}")
    else:
        def score(item: dict[str, Any]) -> float:
            metrics = item.get("metrics", {})
            shape = metrics.get("shapeLifecycleMetrics", {})
            return (
                (2.0 if metrics.get("texture_quality") == "good" else 1.0)
                + float(metrics.get("edgeDensity", 0.0))
                + max(0.0, float(shape.get("contourComplexityCorrelation", 0.0)))
                + max(0.0, float(shape.get("componentCountCorrelation", 0.0)))
            )

        selected = max(candidates, key=score)

    raw_frames = [Path(path) for path in selected.get("rawFrames") or selected.get("frames") or []]
    raw_frames = [path for path in raw_frames if path.exists()]
    if not raw_frames:
        raise RuntimeError(f"Selected VACE candidate has no usable raw frames: {summary_path}")
    return {
        "summary": str(summary_path),
        "candidateId": selected.get("id"),
        "frames": raw_frames,
        "sourceDir": str(raw_frames[0].parent),
        "selectionReason": "best texture/source metrics from latest V2V summary",
        "sourceResultStatus": summary.get("resultStatus"),
        "sourceFailureReason": summary.get("failureReason"),
    }


def composite_rgba_on_black(path: Path, target_size: tuple[int, int] | None = None) -> Image.Image:
    rgba = Image.open(path).convert("RGBA")
    if target_size and rgba.size != target_size:
        rgba = rgba.resize(target_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
    canvas.alpha_composite(rgba)
    return canvas.convert("RGB")


def ensure_size_rgb(path: Path, size: tuple[int, int]) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB").resize(size, Image.Resampling.LANCZOS)).astype(np.float32) / 255.0


def normalize_map(value: np.ndarray) -> np.ndarray:
    value = value.astype(np.float32)
    low = float(value.min())
    high = float(value.max())
    if high - low < 1e-6:
        return np.zeros_like(value, dtype=np.float32)
    return (value - low) / (high - low)


def blur_map(value: np.ndarray, sigma: float) -> np.ndarray:
    k = max(3, int(round(sigma * 4)) | 1)
    return cv2.GaussianBlur(value.astype(np.float32), (k, k), sigma)


def extract_template_maps(frame_path: Path, index: int, out_dir: Path) -> dict[str, Any]:
    rgba = np.asarray(Image.open(frame_path).convert("RGBA")).astype(np.float32)
    rgb = rgba[:, :, :3] / 255.0
    alpha = rgba[:, :, 3] / 255.0
    lum = (0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]) * alpha
    lum_norm = normalize_map(lum)
    alpha_soft = np.clip(blur_map(alpha, 1.25), 0, 1)

    alpha_u8 = (alpha > 0.035).astype(np.uint8) * 255
    lum_u8 = np.clip(lum_norm * 255, 0, 255).astype(np.uint8)
    edge = np.maximum(
        cv2.morphologyEx(alpha_u8, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)).astype(np.float32) / 255.0,
        cv2.Canny(lum_u8, 34, 118).astype(np.float32) / 255.0,
    )
    edge = np.clip(blur_map(edge, 0.9), 0, 1)

    components_total, labels, stats, _centroids = cv2.connectedComponentsWithStats(alpha_u8, 8)
    component_mask = np.zeros_like(alpha, dtype=np.float32)
    particle_mask = np.zeros_like(alpha, dtype=np.float32)
    h, w = alpha.shape
    small_threshold = max(8, int(w * h * 0.0035))
    for component_index in range(1, components_total):
        area = int(stats[component_index, cv2.CC_STAT_AREA])
        current = labels == component_index
        component_mask[current] = 1.0
        if area <= small_threshold:
            particle_mask[current] = 1.0
    particle_mask = np.clip(blur_map(particle_mask, 0.75), 0, 1)
    core_mask = np.clip(normalize_map(lum_norm) * alpha_soft, 0, 1)
    core_mask = np.power(core_mask, 1.65)

    maps_dir = out_dir / "lifecycle_maps" / f"frame_{index:03d}"
    maps_dir.mkdir(parents=True, exist_ok=True)
    for name, data in {
        "alphaMask": alpha,
        "brightnessMap": lum_norm,
        "edgeMask": edge,
        "componentMask": component_mask,
        "particleMask": particle_mask,
        "centerGlowMap": core_mask,
    }.items():
        Image.fromarray(np.clip(data * 255, 0, 255).astype(np.uint8), mode="L").save(maps_dir / f"{name}.png")

    return {
        "alphaMask": alpha,
        "alphaSoft": alpha_soft,
        "brightnessMap": lum_norm,
        "edgeMask": edge,
        "componentMask": component_mask,
        "particleMask": particle_mask,
        "centerGlowMap": core_mask,
        "mapDir": str(maps_dir),
    }


def style_profile(style_frames: list[Path], size: tuple[int, int]) -> dict[str, Any]:
    arrays = [ensure_size_rgb(path, size) for path in style_frames]
    pixels = np.concatenate([arr.reshape(-1, 3) for arr in arrays], axis=0)
    lum = pixels.mean(axis=1)
    active = lum > max(0.025, float(np.percentile(lum, 65)))
    bright = lum > max(0.08, float(np.percentile(lum, 90)))
    highlight = pixels[bright].mean(axis=0) if np.any(bright) else np.array([0.78, 0.94, 1.0], dtype=np.float32)
    mid = pixels[active].mean(axis=0) if np.any(active) else np.array([0.10, 0.55, 1.0], dtype=np.float32)
    shadow = pixels[lum < np.percentile(lum, 35)].mean(axis=0)
    glow = np.clip(mid * 1.4 + highlight * 0.35, 0, 1)
    return {
        "highlightColor": highlight.astype(np.float32),
        "midColor": mid.astype(np.float32),
        "shadowColor": shadow.astype(np.float32),
        "glowColor": glow.astype(np.float32),
        "styleFrames": arrays,
    }


def style_detail_maps(style_rgb: np.ndarray, frame_index: int) -> dict[str, np.ndarray]:
    lum = (0.299 * style_rgb[:, :, 0] + 0.587 * style_rgb[:, :, 1] + 0.114 * style_rgb[:, :, 2]).astype(np.float32)
    clean = style_rgb.copy()
    active = lum > 0.035
    if np.any(active):
        fill = style_rgb[active].mean(axis=0)
    else:
        fill = np.array([0.06, 0.36, 0.95], dtype=np.float32)
    clean[~active] = fill * 0.32
    blur = blur_map(lum, 2.2)
    highpass = normalize_map(np.maximum(lum - blur, 0))
    edge = cv2.Canny(np.clip(lum * 255, 0, 255).astype(np.uint8), 36, 126).astype(np.float32) / 255.0
    edge = np.clip(blur_map(edge, 0.65), 0, 1)
    shift_x = int(round(frame_index * 17))
    shift_y = int(round(frame_index * 7))
    return {
        "texture": np.roll(clean, shift=(shift_y, shift_x), axis=(0, 1)),
        "detail": np.roll(highpass, shift=(shift_y, shift_x), axis=(0, 1)),
        "edgeDetail": np.roll(edge, shift=(shift_y, shift_x), axis=(0, 1)),
        "luminance": np.roll(normalize_map(lum), shift=(shift_y, shift_x), axis=(0, 1)),
    }


def compose_remixed_frame(
    template_path: Path,
    maps: dict[str, Any],
    style_frame: np.ndarray,
    profile: dict[str, Any],
    index: int,
) -> Image.Image:
    rgba = np.asarray(Image.open(template_path).convert("RGBA")).astype(np.float32)
    h, w = rgba.shape[:2]
    if style_frame.shape[0] != h or style_frame.shape[1] != w:
        style_frame = cv2.resize(style_frame, (w, h), interpolation=cv2.INTER_CUBIC)
    detail = style_detail_maps(style_frame, index)
    alpha = maps["alphaMask"]
    alpha_soft = maps["alphaSoft"]
    brightness = maps["brightnessMap"]
    edge = maps["edgeMask"]
    particle = maps["particleMask"]
    core = maps["centerGlowMap"]
    component = maps["componentMask"]

    highlight = profile["highlightColor"].reshape(1, 1, 3)
    mid = profile["midColor"].reshape(1, 1, 3)
    glow = profile["glowColor"].reshape(1, 1, 3)
    shadow = profile["shadowColor"].reshape(1, 1, 3)
    texture = detail["texture"]
    texture_detail = detail["detail"][:, :, None]
    edge_detail = detail["edgeDetail"][:, :, None]
    style_lum = detail["luminance"][:, :, None]

    # Keep body connectivity under the template component mask, then layer VACE
    # detail on top. Without this base energy bed, high-frequency lightning
    # texture can fragment the active region and fail the template component
    # lifecycle even though the bbox/contour trend is correct.
    base_energy = (
        mid * component[:, :, None] * (0.16 + 0.48 * brightness[:, :, None])
        + highlight * core[:, :, None] * 0.24
    )
    shaped_texture = texture * (0.24 + 1.05 * brightness[:, :, None])
    electric_lines = highlight * edge_detail * (0.35 + 1.1 * alpha_soft[:, :, None])
    edge_glow = glow * edge[:, :, None] * (0.85 + 0.75 * style_lum)
    core_glow = highlight * core[:, :, None] * 1.35
    particle_sparks = highlight * particle[:, :, None] * (0.65 + 1.2 * texture_detail)
    dark_body = shadow * component[:, :, None] * (0.18 + 0.42 * (1.0 - brightness[:, :, None]))

    rgb = base_energy + shaped_texture + electric_lines + edge_glow + core_glow + particle_sparks + dark_body
    rgb *= (0.66 + 0.42 * texture_detail + 0.24 * style_lum)
    rgb = np.clip(rgb, 0, 1)

    final_alpha = np.clip(alpha * 0.92 + edge * 0.28 + particle * 0.45 + core * 0.18, 0, 1)
    rgb *= final_alpha[:, :, None]
    out = np.dstack([np.clip(rgb * 255, 0, 255), np.clip(final_alpha * 255, 0, 255)]).astype(np.uint8)
    return Image.fromarray(out, mode="RGBA")


def rgba_to_black_preview(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    canvas = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
    canvas.alpha_composite(rgba)
    return canvas.convert("RGB")


def write_mp4_from_frames(frame_paths: list[Path], target: Path, fps: int) -> Path | None:
    if not frame_paths:
        return None
    first = Image.open(frame_paths[0]).convert("RGB")
    writer = cv2.VideoWriter(str(target), cv2.VideoWriter_fourcc(*"mp4v"), float(fps), first.size)
    if not writer.isOpened():
        return None
    for frame_path in frame_paths:
        frame = np.asarray(Image.open(frame_path).convert("RGB"))
        writer.write(cv2.cvtColor(frame, cv2.COLOR_RGB2BGR))
    writer.release()
    return target


def make_three_way_comparison(template_frames: list[Path], raw_frames: list[Path], result_frames: list[Path], target: Path) -> Path:
    rows = [
        ("template", [composite_rgba_on_black(path) for path in template_frames]),
        ("raw VACE style source", [Image.open(path).convert("RGB") for path in raw_frames]),
        ("lifecycle-remixed result", [Image.open(path).convert("RGB") for path in result_frames]),
    ]
    thumb_w = 150
    row_h = 104
    label_w = 170
    width = label_w + thumb_w * max(len(row[1]) for row in rows)
    height = row_h * len(rows)
    canvas = Image.new("RGB", (width, height), (8, 10, 14))
    draw = ImageDraw.Draw(canvas)
    for row_index, (label, images) in enumerate(rows):
        y = row_index * row_h
        draw.text((8, y + 8), label, fill=(255, 255, 255))
        for index, image in enumerate(images):
            ratio = thumb_w / image.width
            thumb = image.resize((thumb_w, max(1, int(image.height * ratio))), Image.Resampling.LANCZOS)
            x = label_w + index * thumb_w
            canvas.paste(thumb, (x, y + 26))
            draw.text((x + 4, y + 6), str(index), fill=(180, 210, 255))
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target)
    return target


def run_experiment(config: LifecycleRemixConfig) -> tuple[Path, dict[str, Any]]:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = OUTPUT_ROOT / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)

    template_frames = sorted_pngs(Path(config.template_dir))
    style_source = select_style_source(config)
    style_frames = list(style_source["frames"])[: len(template_frames)]
    if len(style_frames) < len(template_frames):
        style_frames = (style_frames * math.ceil(len(template_frames) / max(len(style_frames), 1)))[: len(template_frames)]

    size = Image.open(template_frames[0]).convert("RGBA").size
    style = style_profile(style_frames, size)
    maps = [extract_template_maps(path, index, out_dir) for index, path in enumerate(template_frames)]

    template_previews_dir = out_dir / "template_black_frames"
    raw_previews_dir = out_dir / "raw_vace_style_frames"
    result_rgba_dir = out_dir / "result_rgba_frames"
    result_preview_dir = out_dir / "result_black_frames"
    for directory in (template_previews_dir, raw_previews_dir, result_rgba_dir, result_preview_dir):
        directory.mkdir(parents=True, exist_ok=True)

    template_preview_paths: list[Path] = []
    raw_preview_paths: list[Path] = []
    result_rgba_paths: list[Path] = []
    result_preview_paths: list[Path] = []
    for index, template_path in enumerate(template_frames):
        template_preview = composite_rgba_on_black(template_path)
        template_preview_path = template_previews_dir / f"frame_{index:03d}.png"
        template_preview.save(template_preview_path)
        template_preview_paths.append(template_preview_path)

        raw_preview = Image.open(style_frames[index]).convert("RGB").resize(size, Image.Resampling.LANCZOS)
        raw_preview_path = raw_previews_dir / f"frame_{index:03d}.png"
        raw_preview.save(raw_preview_path)
        raw_preview_paths.append(raw_preview_path)

        result = compose_remixed_frame(template_path, maps[index], style["styleFrames"][index % len(style["styleFrames"])], style, index)
        result_rgba_path = result_rgba_dir / f"frame_{index:03d}.png"
        result.save(result_rgba_path)
        result_rgba_paths.append(result_rgba_path)

        result_preview = rgba_to_black_preview(result)
        result_preview_path = result_preview_dir / f"frame_{index:03d}.png"
        result_preview.save(result_preview_path)
        result_preview_paths.append(result_preview_path)

    template_curve = compute_lifecycle_curve(template_preview_paths)
    raw_curve = compute_lifecycle_curve(raw_preview_paths)
    result_curve = compute_lifecycle_curve(result_preview_paths)
    metrics = evaluate_candidate(template_preview_paths, result_preview_paths, template_curve)

    template_strip = make_strip(template_preview_paths, out_dir / "template_strip.png", label="template")
    raw_strip = make_strip(raw_preview_paths, out_dir / "raw_vace_strip.png", label="raw VACE style source")
    result_strip = make_strip(result_preview_paths, out_dir / "lifecycle_remixed_strip.png", label="lifecycle-remixed result")
    comparison = make_three_way_comparison(template_frames, raw_preview_paths, result_preview_paths, out_dir / "comparison_grid.png")
    curve_chart = draw_curve_chart(
        {
            "template shape": template_curve["normalized"]["shapeEvolution"],
            "raw VACE shape": raw_curve["normalized"]["shapeEvolution"],
            "remixed shape": result_curve["normalized"]["shapeEvolution"],
        },
        out_dir / "shape_lifecycle_curves.png",
        "shape lifecycle curve comparison",
    )
    component_curve = draw_curve_chart(
        {
            "template bbox": template_curve["normalized"]["bboxSize"],
            "result bbox": result_curve["normalized"]["bboxSize"],
            "template contour": template_curve["normalized"]["contourComplexity"],
            "result contour": result_curve["normalized"]["contourComplexity"],
            "template components": template_curve["normalized"]["componentCount"],
            "result components": result_curve["normalized"]["componentCount"],
        },
        out_dir / "detailed_lifecycle_curves.png",
        "bbox / contour / component lifecycle curves",
    )
    output_video = write_mp4_from_frames(result_preview_paths, out_dir / "lifecycle_remixed_result.mp4", config.fps)

    result_status = "pass" if metrics["lifecycle_pass"] and metrics["direction_pass"] else "fail"
    failure_reason = "" if result_status == "pass" else metrics["failureReason"]
    summary = {
        "pipeline": PIPELINE,
        "template": "built-in green slash",
        "styleSource": {**style_source, "frames": [str(path) for path in style_frames]},
        "resultStatus": result_status,
        "failureReason": failure_reason,
        "lifecycle_pass": metrics["lifecycle_pass"],
        "direction_pass": metrics["direction_pass"],
        "texture_quality": metrics["texture_quality"],
        "metrics": metrics,
        "templateLifecycleCurve": template_curve,
        "rawVaceLifecycleCurve": raw_curve,
        "remixedLifecycleCurve": result_curve,
        "outputs": {
            "templateStrip": str(template_strip),
            "rawVaceStrip": str(raw_strip),
            "lifecycleRemixedStrip": str(result_strip),
            "comparisonGrid": str(comparison),
            "shapeLifecycleCurves": str(curve_chart),
            "detailedLifecycleCurves": str(component_curve),
            "resultVideo": str(output_video) if output_video else None,
            "resultRgbaFrames": [str(path) for path in result_rgba_paths],
            "resultPreviewFrames": [str(path) for path in result_preview_paths],
        },
        "note": (
            "Final output is not raw VACE frames. VACE only supplies sampled blue-white "
            "lightning color, glow, high-frequency edge texture, and highlight behavior. "
            "Template maps control alpha, bbox, particles/components, edges, expansion, "
            "fragmentation, trailing particles, and dissipation."
        ),
    }
    write_json(out_dir / "summary.json", summary)
    write_json(out_dir / "lifecycle_curves.json", {
        "template": template_curve,
        "rawVace": raw_curve,
        "remixed": result_curve,
    })

    append_debug_log(
        "AIFX_VACE_STYLE_WITH_TEMPLATE_LIFECYCLE_TEST 完成",
        "验证用 VACE 雷电素材提取风格，再由模板 lifecycle maps 强制控制形态生命周期。",
        f"pipeline={PIPELINE}；resultStatus={result_status}；输出={out_dir}",
        "仅新增 tools 实验脚本和 debug-output 结果；不改 AI 特效主入口、UI、导出或 Spine。",
    )
    return out_dir, summary


def parse_args() -> LifecycleRemixConfig:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template-dir", default=str(DEFAULT_TEMPLATE_DIR))
    parser.add_argument("--style-source-dir", default=None)
    parser.add_argument("--candidate-id", type=int, default=None)
    parser.add_argument("--fps", type=int, default=12)
    args = parser.parse_args()
    return LifecycleRemixConfig(
        template_dir=args.template_dir,
        style_source_dir=args.style_source_dir,
        candidate_id=args.candidate_id,
        fps=args.fps,
    )


def main() -> int:
    out_dir, summary = run_experiment(parse_args())
    print(json.dumps({"outputDir": str(out_dir), "resultStatus": summary["resultStatus"]}, ensure_ascii=False, indent=2))
    return 0 if summary["resultStatus"] in {"pass", "fail"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
