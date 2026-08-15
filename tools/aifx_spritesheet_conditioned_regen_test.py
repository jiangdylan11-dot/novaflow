#!/usr/bin/env python3
"""Validate sprite-sheet conditioned regeneration for NovaFlow AIFX.

Experiment-only script for AIFX_SPRITESHEET_CONDITIONED_REGEN_TEST.
It uses Qwen Image Edit + Qwen ControlNet Union once on a full control sheet,
then cuts the generated sprite sheet back into frames. Template RGB is saved
for comparison only and is never used as img2img input.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw

from aifx_sequence_conditioned_regen_test import (
    LOG_PATH,
    REPO_ROOT,
    active_metrics,
    append_debug_log,
    build_workflow,
    collect_output,
    ensure_environment,
    evaluate_sequence,
    make_lightning_reference,
    request_json,
    sorted_template_frames,
    upload_image,
    wait_for_prompt,
    write_json,
)
from aifx_sequence_conditioned_regen_test import queue_workflow as queue_comfy_workflow


PIPELINE = "AIFX_SPRITESHEET_CONDITIONED_REGEN_TEST"
DEFAULT_TEMPLATE_DIR = (
    REPO_ROOT
    / "particle-editor"
    / "aifx-v3"
    / "templates"
    / "vfx"
    / "slash_basic_builtin"
    / "source"
)
OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-spritesheet-conditioned-regen"

SPRITESHEET_PROMPT = (
    "A game VFX sprite sheet of a blue-white lightning energy slash animation, "
    "each cell is one animation frame, following the motion and timing of the "
    "control sheet, branching electric arcs, jagged sharp edges, thin lightning "
    "filaments, strong glow, clean VFX sprite, no character, no scene, no object."
)
SPRITESHEET_NEGATIVE_PROMPT = (
    "person, human, face, hand, body, character, anime character, object, weapon, "
    "scene, landscape, room, floor, wall, text, logo, frame, border, realistic "
    "background, green energy, yellow fire, orange fire, flame recolor, flat color "
    "blob, texture overlay, pasted texture, inconsistent cells, random image"
)


@dataclass
class SpriteSheetConfig:
    comfy_base: str = "http://127.0.0.1:8188"
    template_dir: str = str(DEFAULT_TEMPLATE_DIR)
    cell_width: int = 384
    cell_height: int = 192
    grid_cols: int = 3
    seed: int = 2026050137
    steps: int = 14
    cfg: float = 3.4
    denoise: float = 1.0
    controlnet_weight: float = 0.58
    sampler_name: str = "euler"
    scheduler: str = "simple"
    timeout: int = 2400
    qwen_model: str = "qwen_image_edit_2511_fp8mixed.safetensors"
    qwen_lora: str = "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-fp32.safetensors"
    qwen_clip: str = "qwen_2.5_vl_7b_fp8_scaled.safetensors"
    qwen_vae: str = "qwen_image_vae.safetensors"
    controlnet_model: str = "Qwen-Image-InstantX-ControlNet-Union.safetensors"
    controlnet_type: str = "canny/lineart/anime_lineart/mlsd"
    sequence_summary: str = ""


def to_sequence_config(config: SpriteSheetConfig) -> Any:
    # build_workflow/ensure_environment only need these fields.
    return config


def resize_rgba_fit(path: Path, size: tuple[int, int]) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    image.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.alpha_composite(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))
    return canvas


def rgba_on_black(rgba: Image.Image) -> Image.Image:
    black = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
    black.alpha_composite(rgba)
    return black.convert("RGB")


def frame_control_arrays(rgba: Image.Image) -> dict[str, np.ndarray]:
    arr = np.asarray(rgba)
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    guide = np.maximum(gray, alpha)
    guide_blur = cv2.GaussianBlur(guide, (5, 5), 0)
    canny = cv2.Canny(guide_blur, 30, 92)
    canny = cv2.dilate(canny, np.ones((2, 2), np.uint8), iterations=1)
    alpha_edges = cv2.morphologyEx((alpha > 10).astype(np.uint8) * 255, cv2.MORPH_GRADIENT, np.ones((5, 5), np.uint8))
    inner_edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 22, 88)
    lineart = np.maximum(canny, np.maximum(alpha_edges, inner_edges))
    lineart = cv2.GaussianBlur(lineart, (3, 3), 0)
    lineart = np.clip(lineart * 1.35, 0, 255).astype(np.uint8)
    alpha_soft = cv2.GaussianBlur(alpha, (0, 0), 3.0)
    alpha_soft = np.clip(alpha_soft * 1.2, 0, 255).astype(np.uint8)
    control_input = np.maximum(lineart, (alpha_soft * 0.42).astype(np.uint8))
    return {"canny": canny, "lineart": lineart, "alphaSoft": alpha_soft, "controlInput": control_input}


def prepare_sprite_sheet(config: SpriteSheetConfig, out_dir: Path) -> dict[str, Any]:
    frames = sorted_template_frames(Path(config.template_dir))
    rows = math.ceil(len(frames) / config.grid_cols)
    sheet_size = (config.cell_width * config.grid_cols, config.cell_height * rows)
    template_sheet = Image.new("RGB", sheet_size, (0, 0, 0))
    canny_sheet = Image.new("RGB", sheet_size, (0, 0, 0))
    lineart_sheet = Image.new("RGB", sheet_size, (0, 0, 0))
    alpha_sheet = Image.new("RGB", sheet_size, (0, 0, 0))
    control_sheet = Image.new("RGB", sheet_size, (0, 0, 0))

    template_frames_dir = out_dir / "template_frames"
    template_frames_dir.mkdir(parents=True, exist_ok=True)
    rects: list[dict[str, int]] = []
    template_frame_paths: list[str] = []
    for index, frame in enumerate(frames):
        rgba = resize_rgba_fit(frame, (config.cell_width, config.cell_height))
        preview = rgba_on_black(rgba)
        controls = frame_control_arrays(rgba)
        x = (index % config.grid_cols) * config.cell_width
        y = (index // config.grid_cols) * config.cell_height
        template_sheet.paste(preview, (x, y))
        canny_sheet.paste(Image.fromarray(controls["canny"], mode="L").convert("RGB"), (x, y))
        lineart_sheet.paste(Image.fromarray(controls["lineart"], mode="L").convert("RGB"), (x, y))
        alpha_sheet.paste(Image.fromarray(controls["alphaSoft"], mode="L").convert("RGB"), (x, y))
        control_sheet.paste(Image.fromarray(controls["controlInput"], mode="L").convert("RGB"), (x, y))
        preview_path = template_frames_dir / f"frame_{index:03d}.png"
        preview.save(preview_path)
        template_frame_paths.append(str(preview_path))
        rects.append({"index": index, "x": x, "y": y, "width": config.cell_width, "height": config.cell_height})

    paths = {
        "templateSheet": out_dir / "template_preview_sheet.png",
        "cannySheet": out_dir / "control_canny_sheet.png",
        "lineartSheet": out_dir / "control_lineart_sheet.png",
        "alphaSoftSheet": out_dir / "control_alpha_soft_sheet.png",
        "controlInputSheet": out_dir / "control_input_sheet.png",
    }
    template_sheet.save(paths["templateSheet"])
    canny_sheet.save(paths["cannySheet"])
    lineart_sheet.save(paths["lineartSheet"])
    alpha_sheet.save(paths["alphaSoftSheet"])
    control_sheet.save(paths["controlInputSheet"])

    meta = {
        "templateDir": str(config.template_dir),
        "frameCount": len(frames),
        "cellWidth": config.cell_width,
        "cellHeight": config.cell_height,
        "gridCols": config.grid_cols,
        "gridRows": rows,
        "spriteSheetWidth": sheet_size[0],
        "spriteSheetHeight": sheet_size[1],
        "frameRects": rects,
        "templateFramePaths": template_frame_paths,
        "paths": {key: str(path) for key, path in paths.items()},
    }
    write_json(out_dir / "sprite_sheet_meta.json", meta)
    return meta


def build_sprite_workflow(config: SpriteSheetConfig, control_name: str, reference_name: str, prefix: str) -> dict[str, Any]:
    # Reuse the sequence workflow builder with the sprite sheet dimensions.
    proxy = to_sequence_config(config)
    proxy.width = config.cell_width * config.grid_cols
    proxy.height = config.cell_height * math.ceil(len(sorted_template_frames(Path(config.template_dir))) / config.grid_cols)
    workflow = build_workflow(proxy, control_name, reference_name, config.seed, prefix)
    workflow["7"]["inputs"]["prompt"] = SPRITESHEET_PROMPT
    workflow["8"]["inputs"]["prompt"] = SPRITESHEET_NEGATIVE_PROMPT
    return workflow


def cut_generated_sheet(sheet_path: Path, meta: dict[str, Any], out_dir: Path) -> list[str]:
    sheet = Image.open(sheet_path).convert("RGB")
    frames_dir = out_dir / "generated_frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    result: list[str] = []
    for rect in meta["frameRects"]:
        crop = sheet.crop((rect["x"], rect["y"], rect["x"] + rect["width"], rect["y"] + rect["height"]))
        path = frames_dir / f"frame_{rect['index']:03d}.png"
        crop.save(path)
        result.append(str(path))
    return result


def make_frame_comparison(template_path: Path, generated_path: Path, out_path: Path) -> None:
    tile_w, tile_h = 256, 128
    canvas = Image.new("RGB", (tile_w * 2, tile_h + 24), (8, 10, 14))
    draw = ImageDraw.Draw(canvas)
    for index, (label, path) in enumerate([("template", template_path), ("sheet generated", generated_path)]):
        img = Image.open(path).convert("RGB")
        img.thumbnail((tile_w, tile_h), Image.Resampling.LANCZOS)
        x = index * tile_w
        canvas.paste(img, (x + (tile_w - img.width) // 2, 24 + (tile_h - img.height) // 2))
        draw.text((x + 8, 6), label, fill=(245, 248, 255))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)


def make_comparison_grid(meta: dict[str, Any], generated_frames: list[str], out_dir: Path) -> str:
    comparison_dir = out_dir / "frame_comparisons"
    comparison_paths: list[Path] = []
    for index, generated in enumerate(generated_frames):
        compare_path = comparison_dir / f"frame_{index:03d}.png"
        make_frame_comparison(Path(meta["templateFramePaths"][index]), Path(generated), compare_path)
        comparison_paths.append(compare_path)

    thumbs = [Image.open(path).convert("RGB") for path in comparison_paths]
    tile_w = max(img.width for img in thumbs)
    tile_h = max(img.height for img in thumbs)
    canvas = Image.new("RGB", (tile_w, tile_h * len(thumbs)), (8, 10, 14))
    for index, img in enumerate(thumbs):
        canvas.paste(img, (0, index * tile_h))
    grid_path = out_dir / "comparison_grid.png"
    canvas.save(grid_path)
    return str(grid_path)


def make_sheet_overview(meta: dict[str, Any], generated_sheet: Path, out_path: Path) -> None:
    tiles = [
        ("template sheet", Path(meta["paths"]["templateSheet"])),
        ("control sheet", Path(meta["paths"]["controlInputSheet"])),
        ("generated sheet", generated_sheet),
    ]
    images = [Image.open(path).convert("RGB") for _, path in tiles]
    max_w = max(img.width for img in images)
    max_h = max(img.height for img in images)
    canvas = Image.new("RGB", (max_w, max_h * 3 + 72), (8, 10, 14))
    draw = ImageDraw.Draw(canvas)
    y = 0
    for (label, _), image in zip(tiles, images):
        canvas.paste(image, ((max_w - image.width) // 2, y + 24))
        draw.text((10, y + 6), label, fill=(245, 248, 255))
        y += max_h + 24
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)


def compare_with_sequence(sequence_summary_path: str, sprite_report: dict[str, Any]) -> dict[str, Any] | None:
    if not sequence_summary_path:
        return None
    path = Path(sequence_summary_path)
    if not path.exists():
        return {"status": "missing_sequence_summary", "path": sequence_summary_path}
    sequence_summary = json.loads(path.read_text(encoding="utf-8"))
    sequence_report_path = sequence_summary.get("temporalReport")
    sequence_report = {}
    if sequence_report_path and Path(sequence_report_path).exists():
        sequence_report = json.loads(Path(sequence_report_path).read_text(encoding="utf-8"))
    seq_metrics = sequence_report.get("metrics", {})
    sprite_metrics = sprite_report.get("metrics", {})
    sequence_temporal = bool(sequence_summary.get("temporal_consistency_pass"))
    sprite_temporal = bool(sprite_report.get("temporal_consistency_pass"))
    metric_better = (
        sprite_metrics.get("outputAreaJump", 999) <= seq_metrics.get("outputAreaJump", -1)
        and sprite_metrics.get("edgeComponentJump", 999) <= seq_metrics.get("edgeComponentJump", -1)
    ) if seq_metrics and sprite_metrics else None
    return {
        "status": "compared",
        "sequenceSummary": str(path),
        "sequenceResultStatus": sequence_summary.get("resultStatus"),
        "sequenceTemporalConsistency": sequence_temporal,
        "spriteTemporalConsistency": sprite_temporal,
        "sequenceOutputAreaJump": seq_metrics.get("outputAreaJump"),
        "spriteOutputAreaJump": sprite_metrics.get("outputAreaJump"),
        "sequenceEdgeComponentJump": seq_metrics.get("edgeComponentJump"),
        "spriteEdgeComponentJump": sprite_metrics.get("edgeComponentJump"),
        "spriteMoreStableByPass": bool(sprite_temporal and not sequence_temporal),
        "spriteMoreStableByJitterMetrics": metric_better,
        "spriteMoreStable": bool((sprite_temporal and not sequence_temporal) or metric_better),
    }


def run_test(config: SpriteSheetConfig) -> tuple[Path, dict[str, Any]]:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = OUTPUT_ROOT / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)
    summary: dict[str, Any] = {
        "pipeline": PIPELINE,
        "stage": "sprite sheet conditioned regeneration",
        "positivePrompt": SPRITESHEET_PROMPT,
        "negativePrompt": SPRITESHEET_NEGATIVE_PROMPT,
        "config": asdict(config),
        "constraints": [
            "Qwen generates one full sprite sheet in a single ComfyUI run",
            "template RGB is not used as img2img input",
            "only control sheet is used as structure constraint",
            "generated sheet is cut back by original frame rects",
        ],
        "resultStatus": "unknown",
    }
    env_ok, env_report = ensure_environment(config, out_dir)
    summary["environment"] = env_report
    if not env_ok:
        summary.update(
            {
                "temporal_consistency_pass": False,
                "style_consistency_pass": False,
                "lifecycle_pass": False,
                "failureReason": env_report.get("failureReason", "Environment unavailable"),
                "resultStatus": "environment_unavailable",
            }
        )
        write_json(out_dir / "summary.json", summary)
        return out_dir, summary

    meta = prepare_sprite_sheet(config, out_dir)
    reference_path = out_dir / "reference_lightning_aux.png"
    make_lightning_reference(reference_path)
    control_upload = upload_image(config, Path(meta["paths"]["controlInputSheet"]), f"{PIPELINE}_{timestamp}_control_sheet.png")
    reference_upload = upload_image(config, reference_path, f"{PIPELINE}_{timestamp}_lightning_ref.png")
    workflow = build_sprite_workflow(config, control_upload, reference_upload, f"{PIPELINE}_{timestamp}_sheet")
    write_json(out_dir / "workflow.json", workflow)

    started = time.time()
    prompt_id = queue_comfy_workflow(config, workflow)
    history = wait_for_prompt(config, prompt_id)
    generated_sheet = out_dir / "generated_sprite_sheet.png"
    output_meta = collect_output(config, history, generated_sheet)
    generated_frames = cut_generated_sheet(generated_sheet, meta, out_dir)
    sheet_overview = out_dir / "sheet_overview.png"
    make_sheet_overview(meta, generated_sheet, sheet_overview)
    comparison_grid = make_comparison_grid(meta, generated_frames, out_dir)

    template_metrics = [active_metrics(Path(path)) for path in meta["templateFramePaths"]]
    output_metrics = [active_metrics(Path(path)) for path in generated_frames]
    report = evaluate_sequence(template_metrics, output_metrics)
    relative = compare_with_sequence(config.sequence_summary, report)
    if relative:
        report["relativeToSequence"] = relative
    write_json(out_dir / "temporal_report.json", report)

    summary.update(
        {
            "promptId": prompt_id,
            "elapsedSeconds": round(time.time() - started, 2),
            "spriteSheetMeta": meta,
            "controlUpload": control_upload,
            "referenceUpload": reference_upload,
            "referenceImage": str(reference_path),
            "generatedSpriteSheet": str(generated_sheet),
            "generatedFrames": generated_frames,
            "outputMeta": output_meta,
            "comparisonGrid": comparison_grid,
            "sheetOverview": str(sheet_overview),
            "temporalReport": str(out_dir / "temporal_report.json"),
            "temporal_consistency_pass": report["temporal_consistency_pass"],
            "style_consistency_pass": report["style_consistency_pass"],
            "lifecycle_pass": report["lifecycle_pass"],
            "failureReason": report["failureReason"],
        }
    )
    summary["resultStatus"] = (
        "pass"
        if summary["temporal_consistency_pass"] and summary["style_consistency_pass"] and summary["lifecycle_pass"]
        else "fail"
    )
    if relative:
        summary["relativeToSequence"] = relative
    write_json(out_dir / "summary.json", summary)
    append_debug_log(
        "AIFX_SPRITESHEET_CONDITIONED_REGEN_TEST 对照验证",
        "逐帧 Qwen 条件重生成可能产生时间抖动，需要验证整张 sprite sheet 一次性生成是否更稳定。",
        (
            f"pipeline={PIPELINE}; frameCount={meta['frameCount']}; "
            f"temporal_consistency_pass={summary['temporal_consistency_pass']}; "
            f"style_consistency_pass={summary['style_consistency_pass']}; "
            f"lifecycle_pass={summary['lifecycle_pass']}; resultStatus={summary['resultStatus']}; output={out_dir}"
        ),
        "仅新增 tools 独立验证和 debug-output 实验结果；不修改 AI 特效主入口、UI、旧 pipeline、导出或 Spine。",
    )
    return out_dir, summary


def parse_args() -> SpriteSheetConfig:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-base", default="http://127.0.0.1:8188")
    parser.add_argument("--template-dir", default=str(DEFAULT_TEMPLATE_DIR))
    parser.add_argument("--cell-width", type=int, default=384)
    parser.add_argument("--cell-height", type=int, default=192)
    parser.add_argument("--grid-cols", type=int, default=3)
    parser.add_argument("--seed", type=int, default=2026050137)
    parser.add_argument("--steps", type=int, default=14)
    parser.add_argument("--cfg", type=float, default=3.4)
    parser.add_argument("--controlnet-weight", type=float, default=0.58)
    parser.add_argument("--timeout", type=int, default=2400)
    parser.add_argument("--sequence-summary", default="")
    args = parser.parse_args()
    return SpriteSheetConfig(
        comfy_base=args.comfy_base,
        template_dir=args.template_dir,
        cell_width=args.cell_width,
        cell_height=args.cell_height,
        grid_cols=args.grid_cols,
        seed=args.seed,
        steps=args.steps,
        cfg=args.cfg,
        controlnet_weight=args.controlnet_weight,
        timeout=args.timeout,
        sequence_summary=args.sequence_summary,
    )


def main() -> int:
    config = parse_args()
    out_dir, summary = run_test(config)
    print(
        json.dumps(
            {
                "outputDir": str(out_dir),
                "resultStatus": summary.get("resultStatus"),
                "temporal_consistency_pass": summary.get("temporal_consistency_pass"),
                "style_consistency_pass": summary.get("style_consistency_pass"),
                "lifecycle_pass": summary.get("lifecycle_pass"),
                "failureReason": summary.get("failureReason", ""),
                "relativeToSequence": summary.get("relativeToSequence"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
