#!/usr/bin/env python3
"""Validate coarse-mask sprite sheet regeneration for NovaFlow AIFX.

Experiment only. This script does not touch the product runtime, UI, export,
or Spine flow. It validates:

- AIFX_SPRITESHEET_COARSE_MASK_REGEN_TEST

The main image input is a black sheet with the coarse mask area cleared. The
template RGB is not used as img2img input. The template only provides a coarse
soft mask and a weak, low-detail structure guide.
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
    black_out_mask_area,
    cell_isolation_score,
    cohesive_slash_report,
    contour_iou,
    cut_generated_sheet,
    lifecycle_pass,
    lightning_structure_score,
    make_cut_preview_grid,
    resize_rgba_fit,
    rgba_on_black,
    thick_outline_score,
)


PIPELINE = "AIFX_SPRITESHEET_COARSE_MASK_REGEN_TEST"
DEFAULT_TEMPLATE_DIR = (
    REPO_ROOT
    / "particle-editor"
    / "aifx-v3"
    / "templates"
    / "vfx"
    / "slash_basic_builtin"
    / "source"
)
OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-spritesheet-coarse-mask-regen"
LOG_PATH = REPO_ROOT / "logs" / "debug.log"

POSITIVE_PROMPT = (
    "A game VFX sprite sheet of a blue-white lightning energy slash animation. "
    "Each cell is one animation frame. Repaint the masked VFX region as a "
    "continuous lightning blade trail. Follow the curved slash trajectory and "
    "motion timing of the template. Generate branching electric arcs, jagged "
    "sharp edges, thin electric filaments, connected energy flow, blue-white "
    "glow, high contrast electric structure. Each frame must contain a complete "
    "lightning slash shape. One continuous lightning blade per frame, connected "
    "arc structure, no broken or cut-off energy segments. The energy must form "
    "a coherent arc, not a straight band. The lightning must follow the curved "
    "slash, not become a straight beam. Complete means a complete curved slash "
    "inside the template trajectory, not a full-screen logo or centered beam. "
    "Keep the start point, end point, arc curvature, scale, and timing from the "
    "template cell. Keep the effect compact inside the coarse mask and preserve "
    "empty black background outside the slash. Do not fill the whole mask area "
    "or the whole sprite cell. Each frame is a full VFX frame, not a cropped "
    "fragment. Early and late lifecycle frames should be small curved fade-in "
    "or fade-out slash fragments, never straight capsules or horizontal beams. "
    "Do not generate partial strips or horizontal bars. Avoid flat horizontal "
    "energy bars. Each sprite cell must be isolated. "
    "No cross-cell strokes. No character, no scene, no object, clean VFX only."
)
NEGATIVE_PROMPT = (
    "green flame, original green slash, copied template shape, exact contour "
    "fill, thick outline, cartoon border, glowing rim, halo rim, random isolated "
    "spikes, center explosion, disconnected burst fragments, smooth blob, "
    "water, smoke, slime, dirty texture, noisy skin, cross-cell stroke, "
    "connected frames, horizontal bar, energy strip, flat band, cut-off shape, "
    "partial fragment, incomplete VFX, cropped lightning, rectangular glow, "
    "wide flat beam, straight beam, straight capsule, capsule shape, pill shape, "
    "full mask fill, whole cell fill, full-screen logo, centered beam, off-path "
    "slash, off-trajectory lightning, oversized generic lightning, blue-white "
    "rectangle, character, human, object, scene, text, logo"
)


@dataclass
class GroupConfig:
    name: str
    erode_px: int
    dilate_px: int
    blur_px: int
    control_weight: float
    control_type: str = "hed/pidi/scribble/ted"
    structure_kind: str = "weak_edge"
    pipeline: str = PIPELINE


@dataclass
class TestConfig:
    comfy_base: str = "http://127.0.0.1:8188"
    template_dir: str = str(DEFAULT_TEMPLATE_DIR)
    cell_width: int = 384
    cell_height: int = 192
    grid_cols: int = 3
    cell_gap: int = 32
    seed: int = 2026050197
    steps: int = 16
    cfg: float = 3.6
    denoise: float = 1.0
    sampler_name: str = "euler"
    scheduler: str = "simple"
    timeout: int = 3600
    checkpoint: str = "Qwen-Rapid-AIO-NSFW-v20.safetensors"
    controlnet_model: str = "Qwen-Image-InstantX-ControlNet-Union.safetensors"


GROUPS = [
    GroupConfig("group_a", erode_px=4, dilate_px=20, blur_px=10, control_weight=0.25),
    GroupConfig("group_b", erode_px=6, dilate_px=28, blur_px=14, control_weight=0.35),
    GroupConfig("group_c", erode_px=8, dilate_px=36, blur_px=18, control_weight=0.45),
]
def append_debug_log(summary: dict[str, Any]) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M")
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(
            f"\n[{stamp}]\n"
            f"- 问题：coarse mask + 弱结构已验证可行，但生成仍可能出现横向白蓝块、能量条感和不完整帧。\n"
            f"- 原因：prompt 只强调 lightning arcs，没有明确要求每格必须是完整弧形刀光构图，模型会画局部能量片段。\n"
            f"- 解决方案：pipeline={PIPELINE}; checkpoint={summary.get('checkpoint')}; "
            f"bestGroup={summary.get('bestGroup')}; resultStatus={summary.get('resultStatus')}; "
            f"output={summary.get('outputDir')}; "
            f"failureReason={summary.get('failureReason')}.\n"
            f"- 影响范围：仅新增 tools 独立验证脚本和 debug-output；不修改 AI 特效主入口、UI、产品 pipeline、导出或 Spine。\n"
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
        "ImageToMask",
        "TextEncodeQwenImageEditPlus",
        "TextEncodeQwenImageEdit",
        "ControlNetLoader",
        "SetUnionControlNetType",
        "ControlNetApplyAdvanced",
        "InpaintModelConditioning",
        "KSampler",
        "VAEDecode",
        "SaveImage",
    ]
    report: dict[str, Any] = {
        "pipeline": PIPELINE,
        "comfy_base": config.comfy_base,
        "workflowType": "Qwen Rapid checkpoint + masked inpaint + low-weight weak structure ControlNet",
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
    report["modelAvailable"] = {
        "checkpoint": config.checkpoint in checkpoints,
        "controlNet": config.controlnet_model in controlnets,
        "weakStructureType": "hed/pidi/scribble/ted" in union_types,
    }
    ok = not report["missingNodes"] and all(report["modelAvailable"].values())
    report["environmentStatus"] = "ready" if ok else "unavailable"
    if not ok:
        report["failureReason"] = "Required Qwen inpaint / ControlNet nodes or models are missing."
    write_json(out_dir / "environment.json", report)
    return ok, report


def clean_binary_mask(mask: np.ndarray, min_area: int = 64) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), connectivity=8)
    cleaned = np.zeros_like(mask, dtype=np.uint8)
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area >= min_area:
            cleaned[labels == label] = 255
    return cleaned


def make_coarse_mask(rgba: Image.Image, group: GroupConfig) -> tuple[Image.Image, dict[str, Any]]:
    arr = np.asarray(rgba.convert("RGBA"))
    alpha = arr[:, :, 3]
    gray = cv2.cvtColor(arr[:, :, :3], cv2.COLOR_RGB2GRAY)
    raw = np.maximum(alpha, gray)
    mask = (raw > 12).astype(np.uint8) * 255
    mask = clean_binary_mask(mask, min_area=96)
    before_area = float(np.mean(mask > 0))
    before_components = max(0, cv2.connectedComponents((mask > 0).astype(np.uint8), connectivity=8)[0] - 1)
    if group.erode_px > 0:
        k = group.erode_px * 2 + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        mask = cv2.erode(mask, kernel, iterations=1)
    mask = clean_binary_mask(mask, min_area=128)
    if group.dilate_px > 0:
        k = group.dilate_px * 2 + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
        mask = cv2.dilate(mask, kernel, iterations=1)
    if group.blur_px > 0:
        mask = cv2.GaussianBlur(mask, (0, 0), group.blur_px)
    active_ratio = float(np.mean(mask > 8))
    components_after = max(0, cv2.connectedComponents((mask > 8).astype(np.uint8), connectivity=8)[0] - 1)
    return Image.fromarray(mask, mode="L"), {
        "erodePx": group.erode_px,
        "dilatePx": group.dilate_px,
        "blurPx": group.blur_px,
        "activeRatioBefore": round(before_area, 6),
        "activeRatioAfter": round(active_ratio, 6),
        "componentCountBefore": int(before_components),
        "componentCountAfter": int(components_after),
        "maskTooLarge": bool(active_ratio > 0.82),
    }


def make_weak_structure(rgba: Image.Image, mask: Image.Image, kind: str) -> Image.Image:
    mask_arr = np.asarray(mask.convert("L"), dtype=np.uint8)
    arr = np.asarray(rgba.convert("RGBA"))
    alpha = arr[:, :, 3]
    gray = cv2.cvtColor(arr[:, :, :3], cv2.COLOR_RGB2GRAY)
    base = np.maximum(alpha, gray)
    small = cv2.resize(base, (max(8, base.shape[1] // 8), max(8, base.shape[0] // 8)), interpolation=cv2.INTER_AREA)
    low = cv2.resize(small, (base.shape[1], base.shape[0]), interpolation=cv2.INTER_CUBIC)
    edges = cv2.Canny(low, 28, 88)
    edges = cv2.GaussianBlur(edges, (0, 0), 5)
    grad = cv2.morphologyEx((mask_arr > 18).astype(np.uint8) * 255, cv2.MORPH_GRADIENT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)))
    guide = np.maximum(edges, (grad * 0.45).astype(np.uint8))
    guide = cv2.GaussianBlur(guide, (0, 0), 7)
    return Image.fromarray(cv2.cvtColor(guide, cv2.COLOR_GRAY2RGB), mode="RGB")


def mask_overlay(preview: Image.Image, mask: Image.Image) -> Image.Image:
    base = np.asarray(preview.convert("RGB"), dtype=np.float32)
    m = np.asarray(mask.convert("L"), dtype=np.float32) / 255.0
    overlay = base.copy()
    overlay[:, :, 0] = overlay[:, :, 0] * (1 - m * 0.55) + 255 * m * 0.55
    overlay[:, :, 1] = overlay[:, :, 1] * (1 - m * 0.18) + 210 * m * 0.18
    overlay[:, :, 2] = overlay[:, :, 2] * (1 - m * 0.05) + 80 * m * 0.05
    return Image.fromarray(np.clip(overlay, 0, 255).astype(np.uint8), mode="RGB")


def prepare_sheet(config: TestConfig, group: GroupConfig, out_dir: Path) -> dict[str, Any]:
    frames = sorted_template_frames(Path(config.template_dir))
    rows = math.ceil(len(frames) / config.grid_cols)
    sheet_w = config.grid_cols * config.cell_width + (config.grid_cols + 1) * config.cell_gap
    sheet_h = rows * config.cell_height + (rows + 1) * config.cell_gap
    input_sheet = Image.new("RGB", (sheet_w, sheet_h), (0, 0, 0))
    mask_sheet = Image.new("L", (sheet_w, sheet_h), 0)
    overlay_sheet = Image.new("RGB", (sheet_w, sheet_h), (0, 0, 0))
    inpaint_sheet = Image.new("RGB", (sheet_w, sheet_h), (0, 0, 0))
    weak_sheet = Image.new("RGB", (sheet_w, sheet_h), (0, 0, 0))

    template_frames_dir = out_dir / "template_frames"
    template_frames_dir.mkdir(parents=True, exist_ok=True)
    frame_rects: list[dict[str, int]] = []
    template_paths: list[str] = []
    mask_paths: list[str] = []
    mask_stats: list[dict[str, Any]] = []

    for index, frame in enumerate(frames):
        rgba = resize_rgba_fit(frame, (config.cell_width, config.cell_height))
        preview = rgba_on_black(rgba)
        mask, stats = make_coarse_mask(rgba, group)
        inpaint_input = black_out_mask_area(Image.new("RGB", rgba.size, (0, 0, 0)), mask)
        weak = make_weak_structure(rgba, mask, group.structure_kind)
        overlay = mask_overlay(preview, mask)
        col = index % config.grid_cols
        row = index // config.grid_cols
        x = config.cell_gap + col * (config.cell_width + config.cell_gap)
        y = config.cell_gap + row * (config.cell_height + config.cell_gap)
        input_sheet.paste(preview, (x, y))
        mask_sheet.paste(mask, (x, y))
        overlay_sheet.paste(overlay, (x, y))
        inpaint_sheet.paste(inpaint_input, (x, y))
        weak_sheet.paste(weak, (x, y))

        preview_path = template_frames_dir / f"frame_{index:03d}.png"
        mask_path = template_frames_dir / f"frame_{index:03d}_mask.png"
        preview.save(preview_path)
        mask.save(mask_path)
        template_paths.append(str(preview_path))
        mask_paths.append(str(mask_path))
        mask_stats.append({"index": index, **stats})
        frame_rects.append({"index": index, "x": x, "y": y, "width": config.cell_width, "height": config.cell_height})

    paths = {
        "input_sheet": out_dir / "input_sheet.png",
        "mask_sheet": out_dir / "mask_sheet.png",
        "mask_overlay": out_dir / "mask_overlay.png",
        "inpaint_input_sheet": out_dir / "inpaint_input_sheet.png",
        "weak_structure_sheet": out_dir / "weak_structure_sheet.png",
    }
    input_sheet.save(paths["input_sheet"])
    mask_sheet.convert("RGB").save(paths["mask_sheet"])
    overlay_sheet.save(paths["mask_overlay"])
    inpaint_sheet.save(paths["inpaint_input_sheet"])
    weak_sheet.save(paths["weak_structure_sheet"])
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
        "maskStats": mask_stats,
        "paths": {key: str(path) for key, path in paths.items()},
    }
    write_json(out_dir / "sheet_meta.json", meta)
    return meta


def build_workflow(config: TestConfig, group: GroupConfig, inpaint_name: str, mask_name: str, control_name: str, prefix: str) -> dict[str, Any]:
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": config.checkpoint}},
        "2": {"class_type": "LoadImage", "inputs": {"image": inpaint_name}},
        "3": {"class_type": "LoadImage", "inputs": {"image": mask_name}},
        "4": {"class_type": "ImageToMask", "inputs": {"image": ["3", 0], "channel": "red"}},
        "5": {"class_type": "LoadImage", "inputs": {"image": control_name}},
        "6": {
            "class_type": "TextEncodeQwenImageEditPlus",
            "inputs": {
                "clip": ["1", 1],
                "vae": ["1", 2],
                "image1": ["2", 0],
                "image2": ["5", 0],
                "prompt": POSITIVE_PROMPT,
            },
        },
        "7": {"class_type": "TextEncodeQwenImageEdit", "inputs": {"clip": ["1", 1], "prompt": NEGATIVE_PROMPT}},
        "8": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": config.controlnet_model}},
        "9": {"class_type": "SetUnionControlNetType", "inputs": {"control_net": ["8", 0], "type": group.control_type}},
        "10": {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": ["6", 0],
                "negative": ["7", 0],
                "control_net": ["9", 0],
                "image": ["5", 0],
                "vae": ["1", 2],
                "strength": group.control_weight,
                "start_percent": 0.0,
                "end_percent": 0.65,
            },
        },
        "11": {
            "class_type": "InpaintModelConditioning",
            "inputs": {
                "positive": ["10", 0],
                "negative": ["10", 1],
                "vae": ["1", 2],
                "pixels": ["2", 0],
                "mask": ["4", 0],
                "noise_mask": True,
            },
        },
        "12": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "seed": config.seed,
                "steps": config.steps,
                "cfg": config.cfg,
                "sampler_name": config.sampler_name,
                "scheduler": config.scheduler,
                "positive": ["11", 0],
                "negative": ["11", 1],
                "latent_image": ["11", 2],
                "denoise": config.denoise,
            },
        },
        "13": {"class_type": "VAEDecode", "inputs": {"samples": ["12", 0], "vae": ["1", 2]}},
        "14": {"class_type": "SaveImage", "inputs": {"images": ["13", 0], "filename_prefix": prefix}},
    }


def trajectory_follow_score(template_paths: list[str], generated_paths: list[str]) -> tuple[float, dict[str, Any]]:
    template_metrics = [active_metrics(Path(path)) for path in template_paths]
    output_metrics = [active_metrics(Path(path)) for path in generated_paths]
    if not template_metrics or not output_metrics or len(template_metrics) != len(output_metrics):
        return 0.0, {"failureReason": "metric length mismatch"}
    width = 384.0
    height = 192.0
    center_scores: list[float] = []
    bbox_scores: list[float] = []
    for t, o in zip(template_metrics, output_metrics):
        tx, ty = t["center"]
        ox, oy = o["center"]
        dist = math.sqrt(((tx - ox) / width) ** 2 + ((ty - oy) / height) ** 2)
        center_scores.append(max(0.0, 1.0 - dist * 2.2))
        tb = t["bboxArea"]
        ob = o["bboxArea"]
        denom = max(tb, ob, 1e-6)
        bbox_scores.append(max(0.0, 1.0 - abs(tb - ob) / denom))
    t_x = [m["center"][0] for m in template_metrics]
    o_x = [m["center"][0] for m in output_metrics]
    t_y = [m["center"][1] for m in template_metrics]
    o_y = [m["center"][1] for m in output_metrics]
    center_corr = max(0.0, (pearson(t_x, o_x) + pearson(t_y, o_y)) / 2)
    score = float(np.mean(center_scores)) * 0.50 + float(np.mean(bbox_scores)) * 0.25 + center_corr * 0.25
    return max(0.0, min(1.0, score)), {
        "meanCenterScore": round(float(np.mean(center_scores)), 4),
        "meanBboxScore": round(float(np.mean(bbox_scores)), 4),
        "centerTrajectoryCorrelation": round(center_corr, 4),
    }


def evaluate_result(meta: dict[str, Any], generated_sheet: Path, group_dir: Path) -> dict[str, Any]:
    cut_frames = cut_generated_sheet(generated_sheet, meta, group_dir)
    cut_preview_grid = group_dir / "cut_preview_grid.png"
    make_cut_preview_grid(meta, cut_frames, cut_preview_grid)
    isolation_pass, gutter_active = cell_isolation_score(generated_sheet, meta)
    contour_score = contour_iou(cut_frames, meta["maskFramePaths"])
    outline_score = thick_outline_score(cut_frames, meta["maskFramePaths"])
    lightning_score = lightning_structure_score(cut_frames)
    cohesive = cohesive_slash_report(cut_frames)
    life_ok, life_report = lifecycle_pass(meta["templateFramePaths"], cut_frames)
    trajectory_score, trajectory_report = trajectory_follow_score(meta["templateFramePaths"], cut_frames)
    mask_too_large = any(item.get("maskTooLarge") for item in meta["maskStats"])
    pass_status = (
        isolation_pass
        and life_ok
        and cohesive["continuous_slash_pass"]
        and lightning_score >= 0.22
        and trajectory_score >= 0.38
        and outline_score <= 0.60
        and contour_score <= 0.82
        and not mask_too_large
    )
    reasons: list[str] = []
    if not isolation_pass:
        reasons.append(f"cell isolation failed: gutter={gutter_active:.4f}")
    if not life_ok:
        reasons.append("lifecycle mismatch")
    if not cohesive["continuous_slash_pass"]:
        reasons.append("result is scattered, not continuous slash")
    if lightning_score < 0.22:
        reasons.append(f"weak lightning structure: {lightning_score:.3f}")
    if trajectory_score < 0.38:
        reasons.append(f"weak trajectory follow: {trajectory_score:.3f}")
    if outline_score > 0.60:
        reasons.append(f"thick outline likely: {outline_score:.3f}")
    if contour_score > 0.82:
        reasons.append(f"contour too locked: {contour_score:.3f}")
    if mask_too_large:
        reasons.append("coarse mask expanded into too large a cell area")
    overall = max(
        0.0,
        min(
            1.0,
            lightning_score * 0.26
            + trajectory_score * 0.24
            + float(cohesive["cohesive_slash_score"]) * 0.18
            - float(cohesive["scattered_fragment_score"]) * 0.10
            + (1.0 - min(contour_score, 1.0)) * 0.12
            + (1.0 - min(outline_score, 1.0)) * 0.10
            + (0.10 if life_ok else 0.0)
            + (0.06 if isolation_pass else 0.0),
        ),
    )
    return {
        "generatedSheet": str(generated_sheet),
        "cutFrames": cut_frames,
        "cutPreviewGrid": str(cut_preview_grid),
        "cell_isolation_pass": isolation_pass,
        "cell_gutter_active_ratio": round(gutter_active, 6),
        "thick_outline_score": round(outline_score, 4),
        "contour_lock_score": round(contour_score, 4),
        "trajectory_follow_score": round(trajectory_score, 4),
        "trajectoryReport": trajectory_report,
        "lightning_structure_score": round(lightning_score, 4),
        "cohesive_slash_score": cohesive["cohesive_slash_score"],
        "scattered_fragment_score": cohesive["scattered_fragment_score"],
        "continuous_slash_pass": cohesive["continuous_slash_pass"],
        "lifecycle_pass": life_ok,
        "lifecycleReport": life_report,
        "maskTooLarge": mask_too_large,
        "overall_score": round(overall, 4),
        "resultStatus": "pass" if pass_status else "fail",
        "failureReason": "; ".join(reasons),
    }


def run_group(config: TestConfig, group: GroupConfig, root: Path) -> dict[str, Any]:
    group_dir = root / group.name
    group_dir.mkdir(parents=True, exist_ok=True)
    meta = prepare_sheet(config, group, group_dir)
    inpaint_upload = upload_image(config, Path(meta["paths"]["inpaint_input_sheet"]), f"{PIPELINE}_{root.name}_{group.name}_inpaint.png")
    mask_upload = upload_image(config, Path(meta["paths"]["mask_sheet"]), f"{PIPELINE}_{root.name}_{group.name}_mask.png")
    control_upload = upload_image(config, Path(meta["paths"]["weak_structure_sheet"]), f"{PIPELINE}_{root.name}_{group.name}_weak_structure.png")
    workflow = build_workflow(config, group, inpaint_upload, mask_upload, control_upload, f"{group.pipeline}_{root.name}_{group.name}")
    write_json(group_dir / "workflow.json", workflow)
    started = time.time()
    result: dict[str, Any] = {
        "pipeline": group.pipeline,
        "group": group.name,
        "checkpoint": config.checkpoint,
        "workflowType": "Qwen Rapid masked inpaint with low-weight weak structure ControlNet",
        "mask_erode_px": group.erode_px,
        "mask_dilate_px": group.dilate_px,
        "mask_blur_px": group.blur_px,
        "controlWeight": group.control_weight,
        "controlType": group.control_type,
        "seed": config.seed,
        "inputSheet": meta["paths"]["input_sheet"],
        "maskSheet": meta["paths"]["mask_sheet"],
        "maskOverlay": meta["paths"]["mask_overlay"],
        "inpaintInputSheet": meta["paths"]["inpaint_input_sheet"],
        "weakStructureSheet": meta["paths"]["weak_structure_sheet"],
        "frameRects": meta["frameRects"],
        "frameRectsCount": len(meta["frameRects"]),
        "frameCount": meta["frameCount"],
        "spriteSheetWidth": meta["spriteSheetWidth"],
        "spriteSheetHeight": meta["spriteSheetHeight"],
        "maskStats": meta["maskStats"],
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
    write_json(group_dir / "group_summary.json", result)
    return result


def copy_best_outputs(best: dict[str, Any], out_dir: Path) -> None:
    for key, name in [
        ("inputSheet", "input_sheet.png"),
        ("maskSheet", "mask_sheet.png"),
        ("maskOverlay", "mask_overlay.png"),
        ("inpaintInputSheet", "inpaint_input_sheet.png"),
        ("weakStructureSheet", "weak_structure_sheet.png"),
        ("generatedSheet", "generated_sheet.png"),
        ("cutPreviewGrid", "cut_preview_grid.png"),
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
        "stage": "coarse mask + weak structure + Qwen Rapid inpaint",
        "outputDir": str(out_dir),
        "positivePrompt": POSITIVE_PROMPT,
        "negativePrompt": NEGATIVE_PROMPT,
        "config": asdict(config),
        "checkpoint": config.checkpoint,
        "workflowType": "masked Qwen inpaint with weak ControlNet, one full sprite sheet per run",
        "resultStatus": "unknown",
        "failureReason": "",
        "constraints": [
            "no product UI/runtime changes",
            "no per-frame generation",
            "template RGB is not used as img2img main input",
            "mask is connected to InpaintModelConditioning",
            "weak structure is low-detail and low-weight",
            "no fallback to material/VACE/IPAdapter/ControlNet-only",
        ],
    }
    env_ok, env_report = ensure_environment(config, out_dir)
    summary["environment"] = env_report
    if not env_ok:
        summary.update(
            {
                "resultStatus": "environment_unavailable",
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

    if best:
        copy_best_outputs(best, out_dir)
    result_status = "pass" if pass_results else ("partial" if scored else "fail")
    summary.update(
        {
            "resultStatus": result_status,
            "bestGroup": best.get("group", ""),
            "mask_erode_px": best.get("mask_erode_px"),
            "mask_dilate_px": best.get("mask_dilate_px"),
            "mask_blur_px": best.get("mask_blur_px"),
            "controlWeight": best.get("controlWeight"),
            "seed": config.seed,
            "thick_outline_score": best.get("thick_outline_score"),
            "contour_lock_score": best.get("contour_lock_score"),
            "trajectory_follow_score": best.get("trajectory_follow_score"),
            "lightning_structure_score": best.get("lightning_structure_score"),
            "cell_isolation_pass": bool(best.get("cell_isolation_pass")),
            "lifecycle_pass": bool(best.get("lifecycle_pass")),
            "continuous_slash_pass": bool(best.get("continuous_slash_pass")),
            "generatedSheet": best.get("generatedSheet", ""),
            "cutPreviewGrid": best.get("cutPreviewGrid", ""),
            "groupResults": group_results,
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
    parser.add_argument("--seed", type=int, default=2026050197)
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
                "resultStatus": summary.get("resultStatus"),
                "bestGroup": summary.get("bestGroup"),
                "checkpoint": summary.get("checkpoint"),
                "cutPreviewGrid": summary.get("cutPreviewGrid"),
                "generatedSheet": summary.get("generatedSheet"),
                "failureReason": summary.get("failureReason"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
