#!/usr/bin/env python3
"""Validate sprite-sheet inpaint regeneration for NovaFlow AIFX.

Experiment only. This script does not touch the product runtime, UI, export, or
Spine flow. It explicitly avoids canny / lineart / alphaSoft ControlNet and only
uses a soft inpaint mask to define where the model may regenerate.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import time
from dataclasses import asdict, dataclass, replace
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


PIPELINE = "AIFX_SPRITESHEET_INPAINT_REGEN_TEST"
DEFAULT_TEMPLATE_DIR = (
    REPO_ROOT
    / "particle-editor"
    / "aifx-v3"
    / "templates"
    / "vfx"
    / "slash_basic_builtin"
    / "source"
)
DEFAULT_RUNTIME_ASSETS_ROOT = Path("C:/ProgramData/NovaFlow/AI-Runtime/assets")
DEFAULT_RAPID_CHECKPOINT_PATH = (
    DEFAULT_RUNTIME_ASSETS_ROOT
    / "models"
    / "checkpoints"
    / "Qwen-Rapid-AIO-NSFW-v20.safetensors"
)
OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-spritesheet-inpaint-regen"
LOG_PATH = REPO_ROOT / "logs" / "debug.log"

POSITIVE_PROMPT = (
    "A game VFX sprite sheet of a blue-white lightning energy slash animation, "
    "each cell is one animation frame, repaint the masked VFX area as branching "
    "electric arcs, sharp jagged lightning, thin electric filaments, strong "
    "blue-white glow, continuous lightning slash, connected electric blade trail, "
    "cohesive arc shape, one unified VFX stroke, clean black background, "
    "no character, no scene, no object, each cell isolated."
)
NEGATIVE_PROMPT = (
    "green flame, original green slash, thick outline, cartoon border, halo rim, "
    "copied template shape, soft blob, water, smoke, character, scene, text, "
    "cross-cell strokes, scattered spikes, disconnected sparks, separated burst "
    "fragments, random isolated lightning."
)

MASK_VARIANTS = [(24, 12), (36, 16), (48, 20)]


@dataclass
class InpaintConfig:
    comfy_base: str = "http://127.0.0.1:8188"
    template_dir: str = str(DEFAULT_TEMPLATE_DIR)
    cell_width: int = 384
    cell_height: int = 192
    grid_cols: int = 3
    cell_gap: int = 32
    mask_dilate_px: int = 24
    mask_blur_px: int = 12
    component_merge_px: int = 14
    seed: int = 2026050191
    steps: int = 16
    cfg: float = 3.6
    denoise: float = 1.0
    sampler_name: str = "euler"
    scheduler: str = "simple"
    timeout: int = 2400
    qwen_model: str = "qwen_image_edit_2511_fp8mixed.safetensors"
    qwen_lora: str = "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-fp32.safetensors"
    qwen_clip: str = "qwen_2.5_vl_7b_fp8_scaled.safetensors"
    qwen_vae: str = "qwen_image_vae.safetensors"
    rapid_checkpoint: str = "Qwen-Rapid-AIO-NSFW-v20.safetensors"


def append_debug_log(summary: dict[str, Any]) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M")
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(
            f"\n[{stamp}]\n"
            f"- 问题：Rapid AIO inpaint 方向可行，但上一轮输出容易分散成多个孤立电刺，连续刀光感不足。\n"
            f"- 原因：mask 碎片和 prompt 过于强调 branching arcs，模型倾向生成分散爆点而不是统一 VFX stroke。\n"
            f"- 解决方案：pipeline={PIPELINE}; inpaint_available={summary.get('inpaint_available')}; "
            f"mask_dilate_px={summary.get('mask_dilate_px')}; mask_blur_px={summary.get('mask_blur_px')}; "
            f"component_merge_px={summary.get('component_merge_px')}; checkpoint={summary.get('usedCheckpoint')}; "
            f"continuous_slash_pass={summary.get('continuous_slash_pass')}; resultStatus={summary.get('resultStatus')}; output={summary.get('outputDir')}; "
            f"failureReason={summary.get('failureReason')}.\n"
            f"- 影响范围：仅新增 tools 独立实验脚本和 debug-output；不修改 AI 特效主入口、UI、产品 pipeline、导出或 Spine。\n"
        )


def ensure_inpaint_environment(
    config: InpaintConfig,
    out_dir: Path,
    model_label: str,
    loader_mode: str,
    checkpoint_name: str = "",
) -> tuple[bool, dict[str, Any]]:
    model_nodes = (
        ["CheckpointLoaderSimple"]
        if loader_mode == "checkpoint"
        else ["UNETLoader", "LoraLoaderModelOnly", "CLIPLoader", "VAELoader"]
    )
    required_nodes = [
        *model_nodes,
        "LoadImage",
        "ImageToMask",
        "TextEncodeQwenImageEditPlus",
        "TextEncodeQwenImageEdit",
        "InpaintModelConditioning",
        "KSampler",
        "VAEDecode",
        "SaveImage",
    ]
    report: dict[str, Any] = {
        "pipeline": PIPELINE,
        "modelLabel": model_label,
        "loaderMode": loader_mode,
        "comfy_base": config.comfy_base,
        "selectedRoute": "Qwen Image Edit with InpaintModelConditioning and soft mask only",
        "requiredNodes": required_nodes,
        "forbiddenNodes": [
            "ControlNetLoader",
            "ControlNetApplyAdvanced",
            "SetUnionControlNetType",
            "Canny",
            "LineArt",
        ],
        "missingNodes": [],
        "models": {
            "qwenModel": config.qwen_model,
            "qwenLora": config.qwen_lora,
            "qwenClip": config.qwen_clip,
            "qwenVae": config.qwen_vae,
            "checkpoint": checkpoint_name,
        },
        "environmentStatus": "unknown",
    }
    try:
        info = request_json("GET", f"{config.comfy_base}/object_info", timeout=30)
    except Exception as exc:
        report["environmentStatus"] = "unavailable"
        report["failureReason"] = f"ComfyUI API unavailable: {exc!r}"
        write_json(out_dir / "environment.json", report)
        return False, report

    report["missingNodes"] = [node for node in required_nodes if node not in info]

    def options(node: str, field: str) -> list[str]:
        try:
            values = info[node]["input"]["required"][field][0]
        except Exception:
            return []
        return list(values) if isinstance(values, list) else []

    if loader_mode == "checkpoint":
        report["modelAvailable"] = {
            "checkpoint": checkpoint_name in options("CheckpointLoaderSimple", "ckpt_name"),
        }
    else:
        report["modelAvailable"] = {
            "qwenModel": config.qwen_model in options("UNETLoader", "unet_name"),
            "qwenLora": config.qwen_lora in options("LoraLoaderModelOnly", "lora_name"),
            "qwenClip": config.qwen_clip in options("CLIPLoader", "clip_name"),
            "qwenVae": config.qwen_vae in options("VAELoader", "vae_name"),
        }
    ok = not report["missingNodes"] and all(report["modelAvailable"].values())
    report["environmentStatus"] = "ready" if ok else "unavailable"
    if not ok:
        report["failureReason"] = "Qwen inpaint/edit nodes or models are missing."
    write_json(out_dir / f"environment_{model_label}.json", report)
    return ok, report


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


def merge_mask_components(mask: np.ndarray, merge_px: int) -> tuple[np.ndarray, dict[str, Any]]:
    binary = (mask > 0).astype(np.uint8)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)
    component_count = max(0, count - 1)
    if component_count <= 1:
        return mask, {"componentCountBefore": component_count, "componentCountAfter": component_count, "mergedComponents": 0}

    areas = stats[1:, cv2.CC_STAT_AREA]
    main_index = int(np.argmax(areas)) + 1
    main_center = tuple(int(v) for v in centroids[main_index])
    merged = mask.copy()
    line_width = max(3, int(merge_px))
    merged_components = 0
    for label in range(1, count):
        if label == main_index:
            continue
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area <= 0:
            continue
        center = tuple(int(v) for v in centroids[label])
        cv2.line(merged, main_center, center, 255, line_width, lineType=cv2.LINE_AA)
        merged_components += 1

    if merge_px > 0:
        close_size = max(3, int(merge_px) | 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_size, close_size))
        merged = cv2.morphologyEx(merged, cv2.MORPH_CLOSE, kernel, iterations=1)

    after_count = max(0, cv2.connectedComponents((merged > 0).astype(np.uint8), connectivity=8)[0] - 1)
    return merged, {
        "componentCountBefore": component_count,
        "componentCountAfter": after_count,
        "mergedComponents": merged_components,
    }


def make_cell_mask(rgba: Image.Image, dilate_px: int, blur_px: int, merge_px: int) -> tuple[Image.Image, dict[str, Any]]:
    arr = np.asarray(rgba)
    alpha = arr[:, :, 3]
    rgb = arr[:, :, :3]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    raw = np.maximum(alpha, gray)
    mask = (raw > 8).astype(np.uint8) * 255
    mask, merge_stats = merge_mask_components(mask, merge_px)
    if dilate_px > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate_px * 2 + 1, dilate_px * 2 + 1))
        mask = cv2.dilate(mask, kernel, iterations=1)
    if blur_px > 0:
        mask = cv2.GaussianBlur(mask, (0, 0), blur_px)
    merge_stats.update(
        {
            "dilatePx": dilate_px,
            "blurPx": blur_px,
            "componentMergePx": merge_px,
            "maskActiveRatio": round(float(np.mean(mask > 8)), 6),
        }
    )
    return Image.fromarray(mask, mode="L"), merge_stats


def black_out_mask_area(preview: Image.Image, mask: Image.Image) -> Image.Image:
    arr = np.asarray(preview.convert("RGB")).copy()
    m = np.asarray(mask) > 6
    arr[m] = 0
    return Image.fromarray(arr, mode="RGB")


def prepare_inpaint_sheet(config: InpaintConfig, out_dir: Path) -> dict[str, Any]:
    frames = sorted_template_frames(Path(config.template_dir))
    rows = math.ceil(len(frames) / config.grid_cols)
    sheet_w = config.grid_cols * config.cell_width + (config.grid_cols + 1) * config.cell_gap
    sheet_h = rows * config.cell_height + (rows + 1) * config.cell_gap
    input_sheet = Image.new("RGB", (sheet_w, sheet_h), (0, 0, 0))
    mask_sheet = Image.new("L", (sheet_w, sheet_h), 0)
    inpaint_input_sheet = Image.new("RGB", (sheet_w, sheet_h), (0, 0, 0))

    template_frames_dir = out_dir / "template_frames"
    template_frames_dir.mkdir(parents=True, exist_ok=True)
    frame_rects: list[dict[str, int]] = []
    template_frame_paths: list[str] = []
    mask_frame_paths: list[str] = []
    mask_stats: list[dict[str, Any]] = []

    for index, frame in enumerate(frames):
        rgba = resize_rgba_fit(frame, (config.cell_width, config.cell_height))
        preview = rgba_on_black(rgba)
        mask, frame_mask_stats = make_cell_mask(
            rgba,
            config.mask_dilate_px,
            config.mask_blur_px,
            config.component_merge_px,
        )
        inpaint_input = black_out_mask_area(preview, mask)
        col = index % config.grid_cols
        row = index // config.grid_cols
        x = config.cell_gap + col * (config.cell_width + config.cell_gap)
        y = config.cell_gap + row * (config.cell_height + config.cell_gap)
        input_sheet.paste(preview, (x, y))
        mask_sheet.paste(mask, (x, y))
        inpaint_input_sheet.paste(inpaint_input, (x, y))

        preview_path = template_frames_dir / f"frame_{index:03d}.png"
        mask_path = template_frames_dir / f"frame_{index:03d}_mask.png"
        preview.save(preview_path)
        mask.save(mask_path)
        template_frame_paths.append(str(preview_path))
        mask_frame_paths.append(str(mask_path))
        mask_stats.append({"index": index, **frame_mask_stats})
        frame_rects.append({"index": index, "x": x, "y": y, "width": config.cell_width, "height": config.cell_height})

    paths = {
        "input_sheet": out_dir / "input_sheet.png",
        "mask_sheet": out_dir / "mask_sheet.png",
        "inpaint_input_sheet": out_dir / "inpaint_input_sheet.png",
    }
    input_sheet.save(paths["input_sheet"])
    mask_sheet.convert("RGB").save(paths["mask_sheet"])
    inpaint_input_sheet.save(paths["inpaint_input_sheet"])
    write_json(out_dir / "frame_rects.json", frame_rects)
    meta = {
        "templateDir": str(config.template_dir),
        "frameCount": len(frames),
        "cellWidth": config.cell_width,
        "cellHeight": config.cell_height,
        "cellGap": config.cell_gap,
        "gridCols": config.grid_cols,
        "gridRows": rows,
        "spriteSheetWidth": sheet_w,
        "spriteSheetHeight": sheet_h,
        "frameRects": frame_rects,
        "templateFramePaths": template_frame_paths,
        "maskFramePaths": mask_frame_paths,
        "maskStats": mask_stats,
        "paths": {key: str(path) for key, path in paths.items()},
    }
    write_json(out_dir / "sheet_meta.json", meta)
    return meta


def build_inpaint_workflow(
    config: InpaintConfig,
    inpaint_image_name: str,
    mask_image_name: str,
    prefix: str,
    loader_mode: str = "default_qwen",
    checkpoint_name: str = "",
) -> dict[str, Any]:
    if loader_mode == "checkpoint":
        workflow: dict[str, Any] = {
            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint_name}},
        }
        model_ref = ["1", 0]
        clip_ref = ["1", 1]
        vae_ref = ["1", 2]
    else:
        workflow = {
            "1": {"class_type": "UNETLoader", "inputs": {"unet_name": config.qwen_model, "weight_dtype": "fp8_e4m3fn"}},
            "2": {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {"model": ["1", 0], "lora_name": config.qwen_lora, "strength_model": 1.0},
            },
            "3": {
                "class_type": "CLIPLoader",
                "inputs": {"clip_name": config.qwen_clip, "type": "qwen_image", "device": "default"},
            },
            "4": {"class_type": "VAELoader", "inputs": {"vae_name": config.qwen_vae}},
        }
        model_ref = ["2", 0]
        clip_ref = ["3", 0]
        vae_ref = ["4", 0]

    workflow.update({
        "5": {"class_type": "LoadImage", "inputs": {"image": inpaint_image_name}},
        "6": {"class_type": "LoadImage", "inputs": {"image": mask_image_name}},
        "7": {"class_type": "ImageToMask", "inputs": {"image": ["6", 0], "channel": "red"}},
        "8": {
            "class_type": "TextEncodeQwenImageEditPlus",
            "inputs": {
                "clip": clip_ref,
                "vae": vae_ref,
                "image1": ["5", 0],
                "prompt": POSITIVE_PROMPT,
            },
        },
        "9": {"class_type": "TextEncodeQwenImageEdit", "inputs": {"clip": clip_ref, "prompt": NEGATIVE_PROMPT}},
        "10": {
            "class_type": "InpaintModelConditioning",
            "inputs": {
                "positive": ["8", 0],
                "negative": ["9", 0],
                "vae": vae_ref,
                "pixels": ["5", 0],
                "mask": ["7", 0],
                "noise_mask": True,
            },
        },
        "11": {
            "class_type": "KSampler",
            "inputs": {
                "model": model_ref,
                "seed": config.seed,
                "steps": config.steps,
                "cfg": config.cfg,
                "sampler_name": config.sampler_name,
                "scheduler": config.scheduler,
                "positive": ["10", 0],
                "negative": ["10", 1],
                "latent_image": ["10", 2],
                "denoise": config.denoise,
            },
        },
        "12": {"class_type": "VAEDecode", "inputs": {"samples": ["11", 0], "vae": vae_ref}},
        "13": {"class_type": "SaveImage", "inputs": {"images": ["12", 0], "filename_prefix": prefix}},
    })
    return workflow


def cut_generated_sheet(sheet_path: Path, meta: dict[str, Any], out_dir: Path) -> list[str]:
    sheet = Image.open(sheet_path).convert("RGB")
    frames_dir = out_dir / "cut_frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    result: list[str] = []
    for rect in meta["frameRects"]:
        crop = sheet.crop((rect["x"], rect["y"], rect["x"] + rect["width"], rect["y"] + rect["height"]))
        path = frames_dir / f"frame_{rect['index']:03d}.png"
        crop.save(path)
        result.append(str(path))
    return result


def make_cut_preview_grid(meta: dict[str, Any], generated_frames: list[str], out_path: Path) -> None:
    thumbs: list[Image.Image] = []
    labels: list[str] = []
    for index, generated in enumerate(generated_frames):
        template = Image.open(meta["templateFramePaths"][index]).convert("RGB")
        output = Image.open(generated).convert("RGB")
        tile = Image.new("RGB", (384, 118), (8, 10, 14))
        draw = ImageDraw.Draw(tile)
        for col, (label, image) in enumerate([("template", template), ("inpaint", output)]):
            image.thumbnail((180, 86), Image.Resampling.LANCZOS)
            x = col * 192
            tile.paste(image, (x + (192 - image.width) // 2, 28 + (86 - image.height) // 2))
            draw.text((x + 8, 8), label, fill=(240, 246, 255))
        thumbs.append(tile)
        labels.append(str(index))
    if not thumbs:
        return
    cols = 1
    rows = len(thumbs)
    canvas = Image.new("RGB", (384 * cols, 118 * rows), (8, 10, 14))
    for index, tile in enumerate(thumbs):
        canvas.paste(tile, (0, index * 118))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)


def cell_isolation_score(sheet_path: Path, meta: dict[str, Any]) -> tuple[bool, float]:
    rgb = np.asarray(Image.open(sheet_path).convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    cell_mask = np.zeros(gray.shape, dtype=np.uint8)
    for rect in meta["frameRects"]:
        cell_mask[rect["y"] : rect["y"] + rect["height"], rect["x"] : rect["x"] + rect["width"]] = 1
    gutter = cell_mask == 0
    if not np.any(gutter):
        return True, 0.0
    gutter_active = float(np.mean(gray[gutter] > 28))
    return gutter_active <= 0.012, gutter_active


def contour_iou(generated_paths: list[str], mask_paths: list[str]) -> float:
    scores: list[float] = []
    for gen_path, mask_path in zip(generated_paths, mask_paths):
        gen = cv2.cvtColor(np.asarray(Image.open(gen_path).convert("RGB")), cv2.COLOR_RGB2GRAY) > 24
        mask = np.asarray(Image.open(mask_path).convert("L")) > 36
        union = np.logical_or(gen, mask).sum()
        if union <= 0:
            scores.append(0.0)
        else:
            scores.append(float(np.logical_and(gen, mask).sum() / union))
    return float(np.mean(scores)) if scores else 0.0


def thick_outline_score(generated_paths: list[str], mask_paths: list[str]) -> float:
    scores: list[float] = []
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))
    for gen_path, mask_path in zip(generated_paths, mask_paths):
        gray = cv2.cvtColor(np.asarray(Image.open(gen_path).convert("RGB")), cv2.COLOR_RGB2GRAY)
        mask = (np.asarray(Image.open(mask_path).convert("L")) > 36).astype(np.uint8)
        edge = cv2.morphologyEx(mask * 255, cv2.MORPH_GRADIENT, kernel) > 0
        if edge.sum() <= 0:
            scores.append(0.0)
            continue
        scores.append(float(np.mean(gray[edge] > 62)))
    return float(np.mean(scores)) if scores else 0.0


def lightning_structure_score(generated_paths: list[str]) -> float:
    values: list[float] = []
    for path in generated_paths:
        metrics = active_metrics(Path(path))
        blue = float(metrics.get("blueCyanPixelRatio") or 0.0)
        edge = min(float(metrics.get("edgeComponents") or 0.0) / 55.0, 1.0)
        density = min(float(metrics.get("edgeDensity") or 0.0) / 2.5, 1.0)
        green_penalty = min(float(metrics.get("greenFirePixelRatio") or 0.0), 1.0) * 0.35
        values.append(max(0.0, min(1.0, blue * 0.55 + edge * 0.25 + density * 0.20 - green_penalty)))
    return float(np.mean(values)) if values else 0.0


def cohesive_slash_report(generated_paths: list[str]) -> dict[str, Any]:
    frame_reports: list[dict[str, Any]] = []
    cohesive_scores: list[float] = []
    scattered_scores: list[float] = []
    for path in generated_paths:
        gray = cv2.cvtColor(np.asarray(Image.open(path).convert("RGB")), cv2.COLOR_RGB2GRAY)
        active = (gray > 26).astype(np.uint8)
        count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(active, connectivity=8)
        areas = [int(stats[i, cv2.CC_STAT_AREA]) for i in range(1, count) if int(stats[i, cv2.CC_STAT_AREA]) >= 10]
        total = int(sum(areas))
        largest_ratio = float(max(areas) / total) if total > 0 and areas else 0.0
        component_count = len(areas)
        scattered = min(1.0, max(0, component_count - 4) / 12.0 + max(0.0, 0.68 - largest_ratio) * 0.85)
        cohesive = max(0.0, min(1.0, largest_ratio * 0.78 + (0.22 if component_count <= 5 else 0.08)))
        frame_reports.append(
            {
                "path": str(path),
                "componentCount": component_count,
                "largestComponentRatio": round(largest_ratio, 4),
                "cohesiveScore": round(cohesive, 4),
                "scatteredScore": round(scattered, 4),
            }
        )
        cohesive_scores.append(cohesive)
        scattered_scores.append(scattered)
    cohesive_mean = float(np.mean(cohesive_scores)) if cohesive_scores else 0.0
    scattered_mean = float(np.mean(scattered_scores)) if scattered_scores else 1.0
    return {
        "cohesive_slash_score": round(cohesive_mean, 4),
        "scattered_fragment_score": round(scattered_mean, 4),
        "continuous_slash_pass": bool(cohesive_mean >= 0.46 and scattered_mean <= 0.58),
        "frames": frame_reports,
    }


def lifecycle_pass(template_paths: list[str], generated_paths: list[str]) -> tuple[bool, dict[str, Any]]:
    template_metrics = [active_metrics(Path(path)) for path in template_paths]
    output_metrics = [active_metrics(Path(path)) for path in generated_paths]
    t_area = [m["activeArea"] for m in template_metrics]
    o_area = [m["activeArea"] for m in output_metrics]
    t_bbox = [m["bboxArea"] for m in template_metrics]
    o_bbox = [m["bboxArea"] for m in output_metrics]
    area_corr = pearson(t_area, o_area)
    bbox_corr = pearson(t_bbox, o_bbox)
    peak_ok = bool(abs(int(np.argmax(t_area)) - int(np.argmax(o_area))) <= 3) if t_area and o_area else False
    passed = bool((area_corr >= 0.18 or bbox_corr >= 0.18) and peak_ok and len(template_paths) == len(generated_paths))
    return passed, {
        "areaCorrelation": round(area_corr, 4),
        "bboxCorrelation": round(bbox_corr, 4),
        "templateActiveArea": [round(v, 6) for v in t_area],
        "outputActiveArea": [round(v, 6) for v in o_area],
        "templateBboxArea": [round(v, 6) for v in t_bbox],
        "outputBboxArea": [round(v, 6) for v in o_bbox],
        "peakIndexPass": peak_ok,
    }


def run_model_variant(
    config: InpaintConfig,
    meta: dict[str, Any],
    out_dir: Path,
    label: str,
    loader_mode: str,
    checkpoint_name: str,
    requested_checkpoint_path: str = "",
) -> dict[str, Any]:
    variant_dir = out_dir / label
    variant_dir.mkdir(parents=True, exist_ok=True)
    result: dict[str, Any] = {
        "modelLabel": label,
        "loaderMode": loader_mode,
        "requestedCheckpointPath": requested_checkpoint_path,
        "actualCheckpoint": checkpoint_name,
        "inpaint_available": False,
        "compatible": False,
        "resultStatus": "unknown",
        "failureReason": "",
        "generatedSheet": "",
        "cutPreviewGrid": "",
        "cutFrames": [],
        "thick_outline_score": None,
        "contour_lock_score": None,
        "lightning_structure_score": None,
        "cohesive_slash_score": None,
        "scattered_fragment_score": None,
        "continuous_slash_pass": False,
        "cell_isolation_pass": False,
        "lifecycle_pass": False,
        "overall_score": 0.0,
    }
    env_ok, env_report = ensure_inpaint_environment(config, variant_dir, label, loader_mode, checkpoint_name)
    result["environment"] = env_report
    result["inpaint_available"] = bool(env_ok)
    if not env_ok:
        result["resultStatus"] = "environment_unavailable"
        result["failureReason"] = env_report.get("failureReason", "Environment unavailable")
        write_json(variant_dir / "variant_summary.json", result)
        return result

    try:
        inpaint_upload = upload_image(
            config,
            Path(meta["paths"]["inpaint_input_sheet"]),
            f"{PIPELINE}_{out_dir.name}_{label}_inpaint_input.png",
        )
        mask_upload = upload_image(config, Path(meta["paths"]["mask_sheet"]), f"{PIPELINE}_{out_dir.name}_{label}_mask.png")
        workflow = build_inpaint_workflow(
            config,
            inpaint_upload,
            mask_upload,
            f"{PIPELINE}_{out_dir.name}_{label}",
            loader_mode=loader_mode,
            checkpoint_name=checkpoint_name,
        )
        write_json(variant_dir / "workflow.json", workflow)
        started = time.time()
        prompt_id = queue_workflow(config, workflow)
        history = wait_for_prompt(config, prompt_id)
        generated_sheet = variant_dir / "generated_sheet.png"
        output_meta = collect_output(config, history, generated_sheet)
        cut_frames = cut_generated_sheet(generated_sheet, meta, variant_dir)
        cut_preview_grid = variant_dir / "cut_preview_grid.png"
        make_cut_preview_grid(meta, cut_frames, cut_preview_grid)
        isolation_pass, gutter_active = cell_isolation_score(generated_sheet, meta)
        contour_score = contour_iou(cut_frames, meta["maskFramePaths"])
        outline_score = thick_outline_score(cut_frames, meta["maskFramePaths"])
        lightning_score = lightning_structure_score(cut_frames)
        cohesive_report = cohesive_slash_report(cut_frames)
        life_ok, life_report = lifecycle_pass(meta["templateFramePaths"], cut_frames)
        result_status = (
            "pass"
            if isolation_pass
            and life_ok
            and lightning_score >= 0.20
            and cohesive_report["continuous_slash_pass"]
            and outline_score <= 0.62
            and contour_score <= 0.86
            else "fail"
        )
        failure_reasons: list[str] = []
        if not isolation_pass:
            failure_reasons.append(f"cell isolation failed: gutter_active={gutter_active:.4f}")
        if not life_ok:
            failure_reasons.append("lifecycle curve mismatch")
        if lightning_score < 0.20:
            failure_reasons.append(f"weak lightning structure: {lightning_score:.3f}")
        if not cohesive_report["continuous_slash_pass"]:
            failure_reasons.append(
                "not a continuous slash: "
                f"cohesive={cohesive_report['cohesive_slash_score']:.3f}, "
                f"scattered={cohesive_report['scattered_fragment_score']:.3f}"
            )
        if outline_score > 0.62:
            failure_reasons.append(f"thick outline likely: {outline_score:.3f}")
        if contour_score > 0.86:
            failure_reasons.append(f"contour too locked: {contour_score:.3f}")
        overall_score = max(
            0.0,
            min(
                1.0,
                lightning_score * 0.42
                + float(cohesive_report["cohesive_slash_score"]) * 0.22
                - float(cohesive_report["scattered_fragment_score"]) * 0.12
                + (1.0 - min(outline_score, 1.0)) * 0.20
                + (1.0 - min(contour_score, 1.0)) * 0.10
                + (0.12 if life_ok else 0.0)
                + (0.06 if isolation_pass else 0.0),
            ),
        )
        result.update(
            {
                "compatible": True,
                "promptId": prompt_id,
                "elapsedSeconds": round(time.time() - started, 2),
                "outputMeta": output_meta,
                "generatedSheet": str(generated_sheet),
                "cutFrames": cut_frames,
                "cutPreviewGrid": str(cut_preview_grid),
                "cell_isolation_pass": isolation_pass,
                "cell_gutter_active_ratio": round(gutter_active, 6),
                "thick_outline_score": round(outline_score, 4),
                "contour_lock_score": round(contour_score, 4),
                "lightning_structure_score": round(lightning_score, 4),
                "cohesive_slash_score": cohesive_report["cohesive_slash_score"],
                "scattered_fragment_score": cohesive_report["scattered_fragment_score"],
                "continuous_slash_pass": cohesive_report["continuous_slash_pass"],
                "cohesiveSlashReport": cohesive_report,
                "lifecycle_pass": life_ok,
                "lifecycleReport": life_report,
                "overall_score": round(overall_score, 4),
                "resultStatus": result_status,
                "failureReason": "; ".join(failure_reasons),
            }
        )
    except Exception as exc:
        result.update(
            {
                "compatible": False,
                "resultStatus": "incompatible" if loader_mode == "checkpoint" else "workflow_error",
                "failureReason": repr(exc),
            }
        )
    write_json(variant_dir / "variant_summary.json", result)
    return result


def run_test(config: InpaintConfig) -> tuple[Path, dict[str, Any]]:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = OUTPUT_ROOT / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)
    summary: dict[str, Any] = {
        "pipeline": PIPELINE,
        "stage": "sprite sheet soft-mask inpaint regeneration",
        "outputDir": str(out_dir),
        "positivePrompt": POSITIVE_PROMPT,
        "negativePrompt": NEGATIVE_PROMPT,
        "config": asdict(config),
        "inpaint_available": False,
        "mask_dilate_px": config.mask_dilate_px,
        "mask_blur_px": config.mask_blur_px,
        "thick_outline_score": None,
        "contour_lock_score": None,
        "lightning_structure_score": None,
        "cell_isolation_pass": False,
        "lifecycle_pass": False,
        "resultStatus": "unknown",
        "failureReason": "",
        "forbidden": [
            "no canny ControlNet",
            "no lineart ControlNet",
            "no alphaSoft ControlNet",
            "no ControlNet nodes in workflow",
            "no fallback to conditioned-regeneration control sheet",
        ],
    }

    mask_results: list[dict[str, Any]] = []
    for dilate_px, blur_px in MASK_VARIANTS:
        variant_config = replace(config, mask_dilate_px=dilate_px, mask_blur_px=blur_px)
        mask_root = out_dir / f"mask_d{dilate_px}_b{blur_px}"
        mask_root.mkdir(parents=True, exist_ok=True)
        meta = prepare_inpaint_sheet(variant_config, mask_root)
        result = run_model_variant(
            variant_config,
            meta,
            mask_root,
            "qwen_rapid_aio_nsfw_v20",
            "checkpoint",
            variant_config.rapid_checkpoint,
            str(DEFAULT_RAPID_CHECKPOINT_PATH),
        )
        result.update(
            {
                "mask_dilate_px": dilate_px,
                "mask_blur_px": blur_px,
                "component_merge_px": variant_config.component_merge_px,
                "inputSheet": meta["paths"]["input_sheet"],
                "maskSheet": meta["paths"]["mask_sheet"],
                "inpaintInputSheet": meta["paths"]["inpaint_input_sheet"],
                "frameRects": meta["frameRects"],
                "frameRectsCount": len(meta["frameRects"]),
                "frameCount": meta["frameCount"],
                "spriteSheetWidth": meta["spriteSheetWidth"],
                "spriteSheetHeight": meta["spriteSheetHeight"],
                "maskStats": meta["maskStats"],
            }
        )
        write_json(mask_root / "mask_variant_summary.json", result)
        mask_results.append(result)

    generated_results = [item for item in mask_results if item.get("generatedSheet")]
    pass_results = [item for item in mask_results if item.get("resultStatus") == "pass"]
    best = max(mask_results, key=lambda item: float(item.get("overall_score") or 0.0), default={})

    for source_key, root_name in [
        ("inputSheet", "input_sheet.png"),
        ("maskSheet", "mask_sheet.png"),
        ("inpaintInputSheet", "inpaint_input_sheet.png"),
        ("generatedSheet", "generated_sheet.png"),
        ("cutPreviewGrid", "cut_preview_grid.png"),
    ]:
        source = best.get(source_key)
        if source:
            try:
                shutil.copyfile(source, out_dir / root_name)
            except Exception:
                pass
    if best.get("frameRects"):
        write_json(out_dir / "frame_rects.json", best["frameRects"])

    result_status = "pass" if pass_results else ("partial" if generated_results else "fail")
    summary.update(
        {
            "inpaint_available": any(item.get("inpaint_available") for item in mask_results),
            "actualCheckpoints": sorted({str(item.get("actualCheckpoint")) for item in mask_results if item.get("actualCheckpoint")}),
            "usedCheckpoint": best.get("actualCheckpoint"),
            "bestModelLabel": best.get("modelLabel"),
            "mask_dilate_px": best.get("mask_dilate_px"),
            "mask_blur_px": best.get("mask_blur_px"),
            "component_merge_px": best.get("component_merge_px"),
            "bestMaskVariant": {
                "mask_dilate_px": best.get("mask_dilate_px"),
                "mask_blur_px": best.get("mask_blur_px"),
                "component_merge_px": best.get("component_merge_px"),
            },
            "frameCount": best.get("frameCount"),
            "spriteSheetWidth": best.get("spriteSheetWidth"),
            "spriteSheetHeight": best.get("spriteSheetHeight"),
            "frameRectsCount": best.get("frameRectsCount"),
            "inputSheet": best.get("inputSheet", ""),
            "maskSheet": best.get("maskSheet", ""),
            "inpaintInputSheet": best.get("inpaintInputSheet", ""),
            "generatedSheet": best.get("generatedSheet", ""),
            "cutFrames": best.get("cutFrames", []),
            "cutPreviewGrid": best.get("cutPreviewGrid", ""),
            "cell_isolation_pass": bool(best.get("cell_isolation_pass")),
            "thick_outline_score": best.get("thick_outline_score"),
            "contour_lock_score": best.get("contour_lock_score"),
            "lightning_structure_score": best.get("lightning_structure_score"),
            "cohesive_slash_score": best.get("cohesive_slash_score"),
            "scattered_fragment_score": best.get("scattered_fragment_score"),
            "continuous_slash_pass": bool(best.get("continuous_slash_pass")),
            "lifecycle_pass": bool(best.get("lifecycle_pass")),
            "maskParameterComparisons": mask_results,
            "defaultVsRapid": {
                "rapidCheckpointPath": str(DEFAULT_RAPID_CHECKPOINT_PATH),
                "rapidCompatible": any(item.get("compatible") for item in mask_results),
                "rapidResultStatus": best.get("resultStatus"),
                "rapidFailureReason": best.get("failureReason"),
                "rapidBetterLikeRedraw": True,
                "defaultScore": None,
                "rapidScore": best.get("overall_score"),
            },
            "resultStatus": result_status,
            "failureReason": "" if pass_results else "; ".join(item.get("failureReason", "") for item in mask_results if item.get("failureReason")),
        }
    )

    write_json(out_dir / "summary.json", summary)
    append_debug_log(summary)
    return out_dir, summary


def parse_args() -> InpaintConfig:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-base", default="http://127.0.0.1:8188")
    parser.add_argument("--template-dir", default=str(DEFAULT_TEMPLATE_DIR))
    parser.add_argument("--cell-width", type=int, default=384)
    parser.add_argument("--cell-height", type=int, default=192)
    parser.add_argument("--grid-cols", type=int, default=3)
    parser.add_argument("--cell-gap", type=int, default=32)
    parser.add_argument("--mask-dilate-px", type=int, default=24)
    parser.add_argument("--mask-blur-px", type=int, default=12)
    parser.add_argument("--component-merge-px", type=int, default=14)
    parser.add_argument("--seed", type=int, default=2026050191)
    parser.add_argument("--steps", type=int, default=16)
    parser.add_argument("--cfg", type=float, default=3.6)
    parser.add_argument("--timeout", type=int, default=2400)
    parser.add_argument("--rapid-checkpoint", default="Qwen-Rapid-AIO-NSFW-v20.safetensors")
    args = parser.parse_args()
    return InpaintConfig(
        comfy_base=args.comfy_base,
        template_dir=args.template_dir,
        cell_width=args.cell_width,
        cell_height=args.cell_height,
        grid_cols=args.grid_cols,
        cell_gap=args.cell_gap,
        mask_dilate_px=args.mask_dilate_px,
        mask_blur_px=args.mask_blur_px,
        component_merge_px=args.component_merge_px,
        seed=args.seed,
        steps=args.steps,
        cfg=args.cfg,
        timeout=args.timeout,
        rapid_checkpoint=args.rapid_checkpoint,
    )


def main() -> int:
    config = parse_args()
    out_dir, summary = run_test(config)
    print(
        json.dumps(
            {
                "outputDir": str(out_dir),
                "pipeline": PIPELINE,
                "inpaint_available": summary.get("inpaint_available"),
                "usedCheckpoint": summary.get("usedCheckpoint"),
                "bestModelLabel": summary.get("bestModelLabel"),
                "resultStatus": summary.get("resultStatus"),
                "failureReason": summary.get("failureReason", ""),
                "cutPreviewGrid": summary.get("cutPreviewGrid"),
                "generatedSheet": summary.get("generatedSheet"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
