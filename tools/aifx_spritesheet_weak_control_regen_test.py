#!/usr/bin/env python3
"""Validate sprite-sheet weak-control regeneration for NovaFlow AIFX.

Experiment only. This script does not touch the product runtime, UI, export,
or Spine flow. It validates:

- AIFX_SPRITESHEET_WEAK_CONTROL_REGEN_TEST

The template RGB sheet is saved only for debug comparison. It is never used as
img2img input. The generation workflow uses a weak control sheet plus text
prompt, without inpaint, mask-only inpaint, VACE, IPAdapter, or per-frame runs.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw

from aifx_sequence_conditioned_regen_test import (
    REPO_ROOT,
    active_metrics,
    collect_output,
    pearson,
    queue_workflow,
    request_json,
    sorted_template_frames,
    upload_image,
    wait_for_prompt,
    write_json,
)
from aifx_spritesheet_inpaint_regen_test import (
    cell_isolation_score,
    cohesive_slash_report,
    contour_iou,
    cut_generated_sheet,
    lifecycle_pass,
    lightning_structure_score,
    resize_rgba_fit,
    rgba_on_black,
    thick_outline_score,
)


PIPELINE = "AIFX_SPRITESHEET_WEAK_CONTROL_REGEN_TEST"
DEFAULT_TEMPLATE_DIR = (
    REPO_ROOT
    / "particle-editor"
    / "aifx-v3"
    / "templates"
    / "vfx"
    / "slash_basic_builtin"
    / "source"
)
OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-spritesheet-weak-control-regen"
LOG_PATH = REPO_ROOT / "logs" / "debug.log"

POSITIVE_PROMPT = (
    "A game VFX sprite sheet of a blue-white lightning energy slash animation. "
    "This is one sequential sprite sheet animation, not separate icons. "
    "Each cell is one frame of the same continuous VFX animation. "
    "Follow the general curved slash trajectory and motion timing of the "
    "control sheet. Redraw the VFX as a lightning energy blade, not the "
    "original green slash. Generate branching electric arcs, jagged sharp "
    "edges, thin electric filaments, connected electric flow, blue-white glow, "
    "high contrast lightning structure. Each frame must contain a complete "
    "lightning slash shape. The animation lifecycle should progress from fade "
    "in, grow stronger, peak burst, fragment into electric sparks, then "
    "dissipate and fade out. Each sprite cell must be spatially isolated but "
    "temporally connected. No character, no scene, no object, clean VFX only."
)
NEGATIVE_PROMPT = (
    "green flame, original green slash, copied template shape, exact contour "
    "fill, thick outline, cartoon border, glowing rim, halo rim, horizontal "
    "bar, energy strip, flat band, rectangular glow, wide flat beam, random "
    "isolated spikes, center explosion, disconnected burst fragments, separate "
    "icons, unrelated frames, repeated same frame, no animation progression, "
    "smooth blob, water, smoke, slime, dirty texture, noisy skin, cross-cell "
    "stroke, connected frames, character, human, object, scene, text, logo"
)


@dataclass
class GroupConfig:
    group_name: str
    control_type: str
    control_weight: float
    union_control_type: str


@dataclass
class TestConfig:
    comfy_base: str = "http://127.0.0.1:8188"
    template_dir: str = str(DEFAULT_TEMPLATE_DIR)
    cell_width: int = 384
    cell_height: int = 192
    grid_cols: int = 3
    cell_gap: int = 32
    seed: int = 2026050199
    steps: int = 16
    cfg: float = 3.6
    denoise: float = 1.0
    sampler_name: str = "euler"
    scheduler: str = "simple"
    timeout: int = 3600
    checkpoint: str = "Qwen-Rapid-AIO-NSFW-v20.safetensors"
    controlnet_model: str = "Qwen-Image-InstantX-ControlNet-Union.safetensors"


GROUPS = [
    GroupConfig("group_a", "blurred_canny", 0.25, "canny/lineart/anime_lineart/mlsd"),
    GroupConfig("group_b", "blurred_canny", 0.35, "canny/lineart/anime_lineart/mlsd"),
    GroupConfig("group_c", "soft_lineart_alpha_gradient", 0.35, "hed/pidi/scribble/ted"),
    GroupConfig("group_d", "mixed_weak_control", 0.45, "hed/pidi/scribble/ted"),
]


def append_debug_log(summary: dict[str, Any]) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M")
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(
            f"\n[{stamp}]\n"
            f"- 问题：需要验证不依赖 inpaint 的 Qwen + sprite sheet + weak control 是否能完成特效语义重构。\n"
            f"- 原因：inpaint 路线容易在 mask-only、precise mask、coarse mask 之间摇摆，仍难稳定控制形态。\n"
            f"- 解决方案：pipeline={PIPELINE}; checkpoint={summary.get('checkpoint')}; "
            f"inpaint_used=false; img2img_used=false; template_rgb_used=false; "
            f"bestGroup={summary.get('bestGroup')}; overallStatus={summary.get('overallStatus')}; "
            f"output={summary.get('outputDir')}; failureReason={summary.get('failureReason')}.\n"
            f"- 影响范围：仅新增 tools 独立验证脚本和 debug-output 实验结果；不修改 AI 特效主入口、UI、旧 pipeline、导出或 Spine。\n"
        )


def node_options(info: dict[str, Any], node: str, field: str) -> list[str]:
    try:
        values = info[node]["input"]["required"][field][0]
    except Exception:
        return []
    return list(values) if isinstance(values, list) else []


def ensure_environment(config: TestConfig, out_dir: Path) -> tuple[bool, dict[str, Any]]:
    required_nodes = [
        "CheckpointLoaderSimple",
        "LoadImage",
        "TextEncodeQwenImageEditPlus",
        "TextEncodeQwenImageEdit",
        "ControlNetLoader",
        "SetUnionControlNetType",
        "ControlNetApplyAdvanced",
        "EmptyQwenImageLayeredLatentImage",
        "KSampler",
        "VAEDecode",
        "SaveImage",
    ]
    report: dict[str, Any] = {
        "pipeline": PIPELINE,
        "comfy_base": config.comfy_base,
        "workflowType": "Qwen Rapid checkpoint + weak ControlNet + empty Qwen latent, no inpaint",
        "requiredNodes": required_nodes,
        "missingNodes": [],
        "checkpoint": config.checkpoint,
        "controlNet": config.controlnet_model,
    }
    try:
        info = request_json("GET", f"{config.comfy_base}/object_info", timeout=30)
    except Exception as exc:
        report["environmentStatus"] = "unavailable"
        report["failureReason"] = f"ComfyUI API unavailable: {exc!r}"
        write_json(out_dir / "environment.json", report)
        return False, report

    report["missingNodes"] = [node for node in required_nodes if node not in info]
    checkpoints = node_options(info, "CheckpointLoaderSimple", "ckpt_name")
    controlnets = node_options(info, "ControlNetLoader", "control_net_name")
    union_types = []
    try:
        union_types = list(info["SetUnionControlNetType"]["input"]["required"]["type"][1]["options"])
    except Exception:
        union_types = []
    required_union_types = sorted({group.union_control_type for group in GROUPS})
    report["modelAvailable"] = {
        "checkpoint": config.checkpoint in checkpoints,
        "controlNet": config.controlnet_model in controlnets,
        "unionControlTypes": {name: name in union_types for name in required_union_types},
    }
    ok = (
        not report["missingNodes"]
        and report["modelAvailable"]["checkpoint"]
        and report["modelAvailable"]["controlNet"]
        and all(report["modelAvailable"]["unionControlTypes"].values())
    )
    report["environmentStatus"] = "ready" if ok else "unavailable"
    if not ok:
        report["failureReason"] = "Required Qwen Rapid / weak ControlNet nodes or models are missing."
    write_json(out_dir / "environment.json", report)
    return ok, report


def make_template_mask(rgba: Image.Image) -> Image.Image:
    arr = np.asarray(rgba.convert("RGBA"))
    alpha = arr[:, :, 3]
    gray = cv2.cvtColor(arr[:, :, :3], cv2.COLOR_RGB2GRAY)
    raw = np.maximum(alpha, gray)
    mask = (raw > 14).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    return Image.fromarray(mask, mode="L")


def weak_control_array(rgba: Image.Image, kind: str) -> np.ndarray:
    arr = np.asarray(rgba.convert("RGBA"))
    alpha = arr[:, :, 3]
    gray = cv2.cvtColor(arr[:, :, :3], cv2.COLOR_RGB2GRAY)
    base = np.maximum(alpha, gray)
    h, w = base.shape

    low = cv2.resize(base, (max(8, w // 9), max(8, h // 9)), interpolation=cv2.INTER_AREA)
    low = cv2.resize(low, (w, h), interpolation=cv2.INTER_CUBIC)
    low = cv2.GaussianBlur(low, (0, 0), 5.5)
    canny = cv2.Canny(low, 24, 82)
    canny = cv2.GaussianBlur(canny, (0, 0), 6.0)
    canny = np.clip(canny * 1.15, 0, 255).astype(np.uint8)

    soft_alpha = cv2.GaussianBlur(alpha, (0, 0), 9.0)
    alpha_grad = cv2.morphologyEx(
        (soft_alpha > 10).astype(np.uint8) * 255,
        cv2.MORPH_GRADIENT,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (27, 27)),
    )
    alpha_grad = cv2.GaussianBlur(alpha_grad, (0, 0), 8.0)

    soft_line = cv2.addWeighted(canny, 0.42, alpha_grad, 0.58, 0)
    soft_line = cv2.GaussianBlur(soft_line, (0, 0), 5.5)
    alpha_mass = np.clip(soft_alpha * 0.42, 0, 255).astype(np.uint8)
    mixed = np.maximum(soft_line, alpha_mass)
    mixed = cv2.GaussianBlur(mixed, (0, 0), 4.0)

    if kind == "blurred_canny":
        guide = canny
    elif kind == "soft_lineart_alpha_gradient":
        guide = soft_line
    elif kind == "mixed_weak_control":
        guide = mixed
    else:
        guide = mixed

    guide = cv2.resize(guide, (max(8, w // 2), max(8, h // 2)), interpolation=cv2.INTER_AREA)
    guide = cv2.resize(guide, (w, h), interpolation=cv2.INTER_CUBIC)
    guide = cv2.GaussianBlur(guide, (0, 0), 3.5)
    return np.clip(guide, 0, 255).astype(np.uint8)


def overlay_control(preview: Image.Image, control: Image.Image) -> Image.Image:
    base = np.asarray(preview.convert("RGB"), dtype=np.float32)
    guide = np.asarray(control.convert("L"), dtype=np.float32) / 255.0
    out = base * (1 - guide[..., None] * 0.52)
    out[:, :, 1] += guide * 150
    out[:, :, 2] += guide * 255
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), mode="RGB")


def prepare_group_sheet(config: TestConfig, group: GroupConfig, out_dir: Path) -> dict[str, Any]:
    frames = sorted_template_frames(Path(config.template_dir))
    rows = math.ceil(len(frames) / config.grid_cols)
    sheet_w = config.grid_cols * config.cell_width + (config.grid_cols + 1) * config.cell_gap
    sheet_h = rows * config.cell_height + (rows + 1) * config.cell_gap
    input_sheet = Image.new("RGB", (sheet_w, sheet_h), (0, 0, 0))
    weak_sheet = Image.new("RGB", (sheet_w, sheet_h), (0, 0, 0))
    overlay_sheet = Image.new("RGB", (sheet_w, sheet_h), (0, 0, 0))

    template_frames_dir = out_dir / "template_frames"
    template_masks_dir = out_dir / "template_masks"
    template_frames_dir.mkdir(parents=True, exist_ok=True)
    template_masks_dir.mkdir(parents=True, exist_ok=True)
    frame_rects: list[dict[str, int]] = []
    template_paths: list[str] = []
    mask_paths: list[str] = []

    for index, frame in enumerate(frames):
        rgba = resize_rgba_fit(frame, (config.cell_width, config.cell_height))
        preview = rgba_on_black(rgba)
        mask = make_template_mask(rgba)
        guide = Image.fromarray(weak_control_array(rgba, group.control_type), mode="L").convert("RGB")
        overlay = overlay_control(preview, guide)
        col = index % config.grid_cols
        row = index // config.grid_cols
        x = config.cell_gap + col * (config.cell_width + config.cell_gap)
        y = config.cell_gap + row * (config.cell_height + config.cell_gap)
        input_sheet.paste(preview, (x, y))
        weak_sheet.paste(guide, (x, y))
        overlay_sheet.paste(overlay, (x, y))

        preview_path = template_frames_dir / f"frame_{index:03d}.png"
        mask_path = template_masks_dir / f"frame_{index:03d}_mask.png"
        preview.save(preview_path)
        mask.save(mask_path)
        template_paths.append(str(preview_path))
        mask_paths.append(str(mask_path))
        frame_rects.append({"index": index, "x": x, "y": y, "width": config.cell_width, "height": config.cell_height})

    paths = {
        "input_sheet": out_dir / "input_sheet.png",
        "weak_control_sheet": out_dir / "weak_control_sheet.png",
        "weak_control_overlay": out_dir / "weak_control_overlay.png",
    }
    input_sheet.save(paths["input_sheet"])
    weak_sheet.save(paths["weak_control_sheet"])
    overlay_sheet.save(paths["weak_control_overlay"])
    write_json(out_dir / "frame_rects.json", frame_rects)
    meta = {
        "frameCount": len(frames),
        "cellWidth": config.cell_width,
        "cellHeight": config.cell_height,
        "cellGap": config.cell_gap,
        "gridCols": config.grid_cols,
        "gridRows": rows,
        "spriteSheetWidth": sheet_w,
        "spriteSheetHeight": sheet_h,
        "frameRects": frame_rects,
        "templateFramePaths": template_paths,
        "maskFramePaths": mask_paths,
        "paths": {key: str(path) for key, path in paths.items()},
    }
    write_json(out_dir / "sheet_meta.json", meta)
    return meta


def build_workflow(config: TestConfig, group: GroupConfig, control_name: str, prefix: str, width: int, height: int) -> dict[str, Any]:
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": config.checkpoint}},
        "2": {"class_type": "LoadImage", "inputs": {"image": control_name}},
        "3": {
            "class_type": "TextEncodeQwenImageEditPlus",
            "inputs": {
                "clip": ["1", 1],
                "vae": ["1", 2],
                "image1": ["2", 0],
                "prompt": POSITIVE_PROMPT,
            },
        },
        "4": {"class_type": "TextEncodeQwenImageEdit", "inputs": {"clip": ["1", 1], "prompt": NEGATIVE_PROMPT}},
        "5": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": config.controlnet_model}},
        "6": {"class_type": "SetUnionControlNetType", "inputs": {"control_net": ["5", 0], "type": group.union_control_type}},
        "7": {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": ["3", 0],
                "negative": ["4", 0],
                "control_net": ["6", 0],
                "image": ["2", 0],
                "vae": ["1", 2],
                "strength": group.control_weight,
                "start_percent": 0.0,
                "end_percent": 0.72,
            },
        },
        "8": {
            "class_type": "EmptyQwenImageLayeredLatentImage",
            "inputs": {"width": width, "height": height, "layers": 0, "batch_size": 1},
        },
        "9": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "seed": config.seed,
                "steps": config.steps,
                "cfg": config.cfg,
                "sampler_name": config.sampler_name,
                "scheduler": config.scheduler,
                "positive": ["7", 0],
                "negative": ["7", 1],
                "latent_image": ["8", 0],
                "denoise": config.denoise,
            },
        },
        "10": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["1", 2]}},
        "11": {"class_type": "SaveImage", "inputs": {"images": ["10", 0], "filename_prefix": prefix}},
    }


def make_cut_preview_grid(meta: dict[str, Any], generated_frames: list[str], out_path: Path) -> None:
    tiles: list[Image.Image] = []
    for index, generated in enumerate(generated_frames):
        template = Image.open(meta["templateFramePaths"][index]).convert("RGB")
        output = Image.open(generated).convert("RGB")
        tile = Image.new("RGB", (384, 118), (8, 10, 14))
        draw = ImageDraw.Draw(tile)
        for col, (label, image) in enumerate([("template", template), ("weak-control regen", output)]):
            image.thumbnail((180, 86), Image.Resampling.LANCZOS)
            x = col * 192
            tile.paste(image, (x + (192 - image.width) // 2, 28 + (86 - image.height) // 2))
            draw.text((x + 8, 8), label, fill=(240, 246, 255))
        tiles.append(tile)
    if not tiles:
        return
    canvas = Image.new("RGB", (384, 118 * len(tiles)), (8, 10, 14))
    for index, tile in enumerate(tiles):
        canvas.paste(tile, (0, index * 118))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)


def trajectory_follow_score(meta: dict[str, Any], generated_paths: list[str]) -> tuple[float, dict[str, Any]]:
    template_metrics = [active_metrics(Path(path)) for path in meta["templateFramePaths"]]
    output_metrics = [active_metrics(Path(path)) for path in generated_paths]
    if not template_metrics or not output_metrics or len(template_metrics) != len(output_metrics):
        return 0.0, {"failureReason": "metric length mismatch"}
    width = float(meta["cellWidth"])
    height = float(meta["cellHeight"])
    center_scores: list[float] = []
    bbox_scores: list[float] = []
    for template, output in zip(template_metrics, output_metrics):
        tx, ty = template["center"]
        ox, oy = output["center"]
        dist = math.sqrt(((tx - ox) / width) ** 2 + ((ty - oy) / height) ** 2)
        center_scores.append(max(0.0, 1.0 - dist * 2.2))
        tb = template["bboxArea"]
        ob = output["bboxArea"]
        denom = max(tb, ob, 1e-6)
        bbox_scores.append(max(0.0, 1.0 - abs(tb - ob) / denom))
    center_corr = max(
        0.0,
        (
            pearson([m["center"][0] for m in template_metrics], [m["center"][0] for m in output_metrics])
            + pearson([m["center"][1] for m in template_metrics], [m["center"][1] for m in output_metrics])
        )
        / 2,
    )
    score = float(np.mean(center_scores)) * 0.50 + float(np.mean(bbox_scores)) * 0.25 + center_corr * 0.25
    return max(0.0, min(1.0, score)), {
        "meanCenterScore": round(float(np.mean(center_scores)), 4),
        "meanBboxScore": round(float(np.mean(bbox_scores)), 4),
        "centerTrajectoryCorrelation": round(center_corr, 4),
    }


def horizontal_bar_score(generated_paths: list[str]) -> float:
    scores: list[float] = []
    for path in generated_paths:
        gray = cv2.cvtColor(np.asarray(Image.open(path).convert("RGB")), cv2.COLOR_RGB2GRAY)
        active = gray > 28
        if not np.any(active):
            scores.append(1.0)
            continue
        ys, xs = np.where(active)
        w = max(1, int(xs.max() - xs.min() + 1))
        h = max(1, int(ys.max() - ys.min() + 1))
        aspect = w / h
        row_energy = active.sum(axis=1)
        concentration = float(row_energy.max() / max(1, active.sum()))
        scores.append(max(0.0, min(1.0, (aspect - 2.8) / 5.0 + concentration * 0.8)))
    return float(np.mean(scores)) if scores else 1.0


def evaluate_result(meta: dict[str, Any], generated_sheet: Path, group_dir: Path) -> dict[str, Any]:
    cut_frames = cut_generated_sheet(generated_sheet, meta, group_dir)
    cut_preview_grid = group_dir / "cut_preview_grid.png"
    make_cut_preview_grid(meta, cut_frames, cut_preview_grid)
    isolation_pass, gutter_active = cell_isolation_score(generated_sheet, meta)
    independent_cell_score = max(0.0, min(1.0, 1.0 - gutter_active / 0.012))
    contour_score = contour_iou(cut_frames, meta["maskFramePaths"])
    outline_score = thick_outline_score(cut_frames, meta["maskFramePaths"])
    lightning_score = lightning_structure_score(cut_frames)
    cohesive = cohesive_slash_report(cut_frames)
    life_ok, life_report = lifecycle_pass(meta["templateFramePaths"], cut_frames)
    trajectory_score, trajectory_report = trajectory_follow_score(meta, cut_frames)
    bar_score = horizontal_bar_score(cut_frames)
    pass_status = (
        isolation_pass
        and life_ok
        and cohesive["continuous_slash_pass"]
        and lightning_score >= 0.22
        and trajectory_score >= 0.36
        and outline_score <= 0.62
        and contour_score <= 0.80
        and bar_score <= 0.55
    )
    reasons: list[str] = []
    if not isolation_pass:
        reasons.append(f"cell isolation failed: gutter={gutter_active:.4f}")
    if not life_ok:
        reasons.append("lifecycle mismatch")
    if not cohesive["continuous_slash_pass"]:
        reasons.append("result is scattered or not a continuous slash")
    if lightning_score < 0.22:
        reasons.append(f"weak lightning structure: {lightning_score:.3f}")
    if trajectory_score < 0.36:
        reasons.append(f"weak trajectory follow: {trajectory_score:.3f}")
    if outline_score > 0.62:
        reasons.append(f"thick outline likely: {outline_score:.3f}")
    if contour_score > 0.80:
        reasons.append(f"control contour too locked: {contour_score:.3f}")
    if bar_score > 0.55:
        reasons.append(f"horizontal energy bar likely: {bar_score:.3f}")
    overall = max(
        0.0,
        min(
            1.0,
            lightning_score * 0.25
            + trajectory_score * 0.25
            + float(cohesive["cohesive_slash_score"]) * 0.16
            - float(cohesive["scattered_fragment_score"]) * 0.10
            + (1.0 - min(contour_score, 1.0)) * 0.11
            + (1.0 - min(outline_score, 1.0)) * 0.09
            + (1.0 - min(bar_score, 1.0)) * 0.08
            + (0.07 if life_ok else 0.0)
            + (0.06 if isolation_pass else 0.0),
        ),
    )
    return {
        "generatedSheet": str(generated_sheet),
        "cutFrames": cut_frames,
        "cutPreviewGrid": str(cut_preview_grid),
        "cell_isolation_pass": isolation_pass,
        "cell_gutter_active_ratio": round(gutter_active, 6),
        "independent_cell_score": round(independent_cell_score, 4),
        "thick_outline_score": round(outline_score, 4),
        "contour_lock_score": round(contour_score, 4),
        "trajectory_follow_score": round(trajectory_score, 4),
        "trajectoryReport": trajectory_report,
        "lightning_structure_score": round(lightning_score, 4),
        "horizontal_bar_score": round(bar_score, 4),
        "cohesive_slash_score": cohesive["cohesive_slash_score"],
        "scattered_fragment_score": cohesive["scattered_fragment_score"],
        "continuous_slash_pass": cohesive["continuous_slash_pass"],
        "lifecycle_pass": life_ok,
        "lifecycleReport": life_report,
        "overall_score": round(overall, 4),
        "resultStatus": "pass" if pass_status else "fail",
        "failureReason": "; ".join(reasons),
    }


def run_group(config: TestConfig, group: GroupConfig, root: Path) -> dict[str, Any]:
    group_dir = root / group.group_name
    group_dir.mkdir(parents=True, exist_ok=True)
    meta = prepare_group_sheet(config, group, group_dir)
    control_upload = upload_image(config, Path(meta["paths"]["weak_control_sheet"]), f"{PIPELINE}_{root.name}_{group.group_name}_weak_control.png")
    workflow = build_workflow(config, group, control_upload, f"{PIPELINE}_{root.name}_{group.group_name}", meta["spriteSheetWidth"], meta["spriteSheetHeight"])
    write_json(group_dir / "workflow.json", workflow)
    started = time.time()
    result: dict[str, Any] = {
        "pipeline": PIPELINE,
        "groupName": group.group_name,
        "checkpoint": config.checkpoint,
        "workflowType": "Qwen Rapid empty latent + weak ControlNet, no inpaint",
        "inpaint_used": False,
        "img2img_used": False,
        "template_rgb_used": False,
        "controlType": group.control_type,
        "unionControlType": group.union_control_type,
        "controlWeight": group.control_weight,
        "seed": config.seed,
        "inputSheet": meta["paths"]["input_sheet"],
        "weakControlSheet": meta["paths"]["weak_control_sheet"],
        "weakControlOverlay": meta["paths"]["weak_control_overlay"],
        "frameRects": meta["frameRects"],
        "frameRectsCount": len(meta["frameRects"]),
        "frameCount": meta["frameCount"],
        "spriteSheetWidth": meta["spriteSheetWidth"],
        "spriteSheetHeight": meta["spriteSheetHeight"],
    }
    try:
        prompt_id = queue_workflow(config, workflow)
        history = wait_for_prompt(config, prompt_id)
        generated_sheet = group_dir / "generated_sheet.png"
        output_meta = collect_output(config, history, generated_sheet)
        result.update(
            {
                "promptId": prompt_id,
                "elapsedSeconds": round(time.time() - started, 2),
                "outputMeta": output_meta,
                **evaluate_result(meta, generated_sheet, group_dir),
            }
        )
    except Exception as exc:
        result.update({"resultStatus": "workflow_error", "failureReason": repr(exc), "elapsedSeconds": round(time.time() - started, 2)})
    write_json(group_dir / "summary.json", result)
    return result


def make_group_comparison_grid(results: list[dict[str, Any]], out_path: Path) -> None:
    tiles: list[Image.Image] = []
    for result in results:
        grid_path = result.get("cutPreviewGrid")
        if not grid_path or not Path(grid_path).exists():
            continue
        image = Image.open(grid_path).convert("RGB")
        image.thumbnail((440, 920), Image.Resampling.LANCZOS)
        tile = Image.new("RGB", (460, image.height + 34), (8, 10, 14))
        draw = ImageDraw.Draw(tile)
        label = (
            f"{result.get('groupName')} | {result.get('controlType')} | "
            f"w={result.get('controlWeight')} | {result.get('resultStatus')}"
        )
        draw.text((10, 8), label, fill=(240, 246, 255))
        tile.paste(image, ((460 - image.width) // 2, 30))
        tiles.append(tile)
    if not tiles:
        return
    cols = min(2, len(tiles))
    rows = math.ceil(len(tiles) / cols)
    cell_w = max(tile.width for tile in tiles)
    cell_h = max(tile.height for tile in tiles)
    canvas = Image.new("RGB", (cell_w * cols, cell_h * rows), (8, 10, 14))
    for index, tile in enumerate(tiles):
        x = (index % cols) * cell_w
        y = (index // cols) * cell_h
        canvas.paste(tile, (x, y))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)


def copy_best_outputs(best: dict[str, Any], out_dir: Path) -> None:
    for key, name in [
        ("inputSheet", "input_sheet.png"),
        ("weakControlSheet", "weak_control_sheet.png"),
        ("weakControlOverlay", "weak_control_overlay.png"),
        ("generatedSheet", "generated_sheet.png"),
        ("cutPreviewGrid", "best_result_grid.png"),
    ]:
        src = best.get(key)
        if src and Path(src).exists():
            shutil.copyfile(src, out_dir / name)
    if best.get("frameRects"):
        write_json(out_dir / "frame_rects.json", best["frameRects"])
    cut_frames = best.get("cutFrames") or []
    if cut_frames:
        target = out_dir / "cut_frames"
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True, exist_ok=True)
        for path in cut_frames:
            shutil.copyfile(path, target / Path(path).name)


def run_test(config: TestConfig) -> tuple[Path, dict[str, Any]]:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = OUTPUT_ROOT / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)
    summary: dict[str, Any] = {
        "pipeline": PIPELINE,
        "stage": "sprite sheet weak-control Qwen regeneration without inpaint",
        "outputDir": str(out_dir),
        "positivePrompt": POSITIVE_PROMPT,
        "negativePrompt": NEGATIVE_PROMPT,
        "config": asdict(config),
        "checkpoint": config.checkpoint,
        "inpaint_used": False,
        "img2img_used": False,
        "template_rgb_used": False,
        "workflowType": "Qwen Rapid empty latent + low-detail weak ControlNet, one full sprite sheet per group",
        "groups": [],
        "overallStatus": "unknown",
        "failureReason": "",
        "constraints": [
            "no product UI/runtime changes",
            "no inpaint",
            "no mask-only inpaint",
            "no template RGB img2img",
            "no VACE / lifecycle remix / SDXL / IPAdapter",
            "no per-frame generation",
        ],
    }
    env_ok, env_report = ensure_environment(config, out_dir)
    summary["environment"] = env_report
    if not env_ok:
        summary.update(
            {
                "overallStatus": "environment_unavailable",
                "failureReason": env_report.get("failureReason", "Environment unavailable"),
            }
        )
        write_json(out_dir / "summary.json", summary)
        append_debug_log(summary)
        return out_dir, summary

    group_results = [run_group(config, group, out_dir) for group in GROUPS]
    scored = [item for item in group_results if item.get("generatedSheet")]
    best = max(scored, key=lambda item: float(item.get("overall_score") or 0.0), default={})
    pass_results = [item for item in group_results if item.get("resultStatus") == "pass"]
    comparison_grid = out_dir / "comparison_grid.png"
    make_group_comparison_grid(group_results, comparison_grid)
    if best:
        copy_best_outputs(best, out_dir)
    summary.update(
        {
            "groups": group_results,
            "bestGroup": best.get("groupName", ""),
            "comparisonGrid": str(comparison_grid) if comparison_grid.exists() else "",
            "bestResultGrid": str(out_dir / "best_result_grid.png") if (out_dir / "best_result_grid.png").exists() else "",
            "overallStatus": "pass" if pass_results else ("partial" if scored else "fail"),
            "failureReason": "" if pass_results else "; ".join(item.get("failureReason", "") for item in group_results if item.get("failureReason")),
        }
    )
    write_json(out_dir / "summary.json", summary)
    append_debug_log(summary)
    return out_dir, summary


def parse_args() -> TestConfig:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-base", default="http://127.0.0.1:8188")
    parser.add_argument("--template-dir", default=str(DEFAULT_TEMPLATE_DIR))
    parser.add_argument("--cell-width", type=int, default=384)
    parser.add_argument("--cell-height", type=int, default=192)
    parser.add_argument("--grid-cols", type=int, default=3)
    parser.add_argument("--cell-gap", type=int, default=32)
    parser.add_argument("--seed", type=int, default=2026050199)
    parser.add_argument("--steps", type=int, default=16)
    parser.add_argument("--cfg", type=float, default=3.6)
    parser.add_argument("--timeout", type=int, default=3600)
    parser.add_argument("--checkpoint", default="Qwen-Rapid-AIO-NSFW-v20.safetensors")
    parser.add_argument("--controlnet-model", default="Qwen-Image-InstantX-ControlNet-Union.safetensors")
    args = parser.parse_args()
    return TestConfig(
        comfy_base=args.comfy_base,
        template_dir=args.template_dir,
        cell_width=args.cell_width,
        cell_height=args.cell_height,
        grid_cols=args.grid_cols,
        cell_gap=args.cell_gap,
        seed=args.seed,
        steps=args.steps,
        cfg=args.cfg,
        timeout=args.timeout,
        checkpoint=args.checkpoint,
        controlnet_model=args.controlnet_model,
    )


def main() -> int:
    config = parse_args()
    out_dir, summary = run_test(config)
    print(
        json.dumps(
            {
                "outputDir": str(out_dir),
                "pipeline": PIPELINE,
                "overallStatus": summary.get("overallStatus"),
                "bestGroup": summary.get("bestGroup"),
                "checkpoint": summary.get("checkpoint"),
                "comparisonGrid": summary.get("comparisonGrid"),
                "bestResultGrid": summary.get("bestResultGrid"),
                "failureReason": summary.get("failureReason"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
