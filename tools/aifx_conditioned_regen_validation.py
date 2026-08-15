#!/usr/bin/env python3
"""Validate single-frame conditioned regeneration for NovaFlow AIFX.

This is an experiment-only probe for AIFX_CONDITIONED_REGEN_VALIDATION.
It does not touch the product runtime, UI, VACE, lifecycle remix, local
material mapping, sprite-sheet style transfer, or any export/Spine flow.
"""

from __future__ import annotations

import argparse
import json
import math
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import cv2
import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFont


PIPELINE = "AIFX_CONDITIONED_REGEN_VALIDATION"
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEMPLATE_DIR = (
    REPO_ROOT
    / "particle-editor"
    / "aifx-v3"
    / "templates"
    / "vfx"
    / "slash_basic_builtin"
    / "source"
)
OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-conditioned-regen"
LOG_PATH = REPO_ROOT / "logs" / "debug.log"

POSITIVE_PROMPT = (
    "A lightning energy slash VFX, branching electric arcs, jagged sharp edges, "
    "high-frequency lightning structure, blue-white energy, strong contrast, "
    "sharp bright electric core, forked lightning tendrils, electric sparks, "
    "clean black background, VFX only, no character, no scene, no object. "
    "Follow the provided canny/lineart structure as a loose slash composition, "
    "but redesign the fire slash into a new electric effect. Not fluid, not smooth, "
    "not soft, not a recolor, not a texture overlay."
)
NEGATIVE_PROMPT = (
    "person, human, face, hand, body, character, anime character, girl, boy, "
    "object, weapon, sword, scene, landscape, room, floor, wall, text, logo, "
    "frame, border, realistic background, photo, green energy, yellow fire, "
    "orange fire, flame, smoke scene, blurry blob, soft blob, flat color fill, "
    "single smooth arc, texture overlay, noisy texture"
)


@dataclass
class ValidationConfig:
    comfy_base: str = "http://127.0.0.1:8188"
    template_dir: str = str(DEFAULT_TEMPLATE_DIR)
    seed: int = 2026050117
    candidate_count: int = 4
    width: int = 768
    height: int = 384
    steps: int = 18
    cfg: float = 4.0
    denoise: float = 1.0
    controlnet_weight: float = 0.82
    sampler_name: str = "euler"
    scheduler: str = "simple"
    timeout: int = 1800
    qwen_model: str = "qwen_image_edit_2511_fp8mixed.safetensors"
    qwen_lora: str = "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-fp32.safetensors"
    qwen_clip: str = "qwen_2.5_vl_7b_fp8_scaled.safetensors"
    qwen_vae: str = "qwen_image_vae.safetensors"
    controlnet_model: str = "Qwen-Image-InstantX-ControlNet-Union.safetensors"
    controlnet_type: str = "canny/lineart/anime_lineart/mlsd"


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def append_debug_log(issue: str, reason: str, solution: str, impact: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M")
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(
            f"\n[{stamp}]\n"
            f"- 问题：{issue}\n"
            f"- 原因：{reason}\n"
            f"- 解决方案：{solution}\n"
            f"- 影响范围：{impact}\n"
        )


def request_json(method: str, url: str, **kwargs: Any) -> Any:
    response = requests.request(method, url, timeout=kwargs.pop("timeout", 30), **kwargs)
    response.raise_for_status()
    if not response.content:
        return None
    return response.json()


def load_object_info(config: ValidationConfig) -> dict[str, Any]:
    return request_json("GET", f"{config.comfy_base}/object_info", timeout=30)


def node_options(info: dict[str, Any], node: str, field: str) -> list[str]:
    try:
        values = info[node]["input"]["required"][field][0]
    except Exception:
        return []
    return list(values) if isinstance(values, list) else []


def ensure_environment(config: ValidationConfig, out_dir: Path) -> tuple[bool, dict[str, Any]]:
    required_nodes = [
        "UNETLoader",
        "LoraLoaderModelOnly",
        "CLIPLoader",
        "VAELoader",
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
        "modelPriority": ["Qwen-Image-Edit", "Flux Kontext", "other strong edit models"],
        "selectedRoute": "Qwen-Image-Edit + Qwen ControlNet single-frame latent generation",
        "requiredNodes": required_nodes,
        "missingNodes": [],
        "models": {
            "qwenModel": config.qwen_model,
            "qwenLora": config.qwen_lora,
            "qwenClip": config.qwen_clip,
            "qwenVae": config.qwen_vae,
            "controlNet": config.controlnet_model,
        },
        "environmentStatus": "unknown",
    }
    try:
        info = load_object_info(config)
    except Exception as exc:
        report["environmentStatus"] = "unavailable"
        report["failureReason"] = f"ComfyUI API unavailable: {exc!r}"
        write_json(out_dir / "environment.json", report)
        return False, report

    report["missingNodes"] = [node for node in required_nodes if node not in info]
    diffusion_models = node_options(info, "UNETLoader", "unet_name")
    loras = node_options(info, "LoraLoaderModelOnly", "lora_name")
    clips = node_options(info, "CLIPLoader", "clip_name")
    vaes = node_options(info, "VAELoader", "vae_name")
    controlnets = node_options(info, "ControlNetLoader", "control_net_name")
    report["available"] = {
        "diffusionModels": diffusion_models,
        "loras": loras,
        "clips": clips,
        "vaes": vaes,
        "controlnets": controlnets,
    }
    report["modelAvailable"] = {
        "qwenModel": config.qwen_model in diffusion_models,
        "qwenLora": config.qwen_lora in loras,
        "qwenClip": config.qwen_clip in clips,
        "qwenVae": config.qwen_vae in vaes,
        "controlNet": config.controlnet_model in controlnets,
    }
    ok = not report["missingNodes"] and all(report["modelAvailable"].values())
    report["environmentStatus"] = "ready" if ok else "unavailable"
    if not ok:
        report["failureReason"] = (
            "Required Qwen Image Edit / Qwen ControlNet nodes or models are missing. "
            "No fallback route was used."
        )
    write_json(out_dir / "environment.json", report)
    return ok, report


def sorted_template_frames(template_dir: Path) -> list[Path]:
    frames = sorted(template_dir.glob("*.png"))
    if not frames:
        raise RuntimeError(f"No PNG template frames found: {template_dir}")
    return frames


def rgba_on_black(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    black = Image.new("RGBA", image.size, (0, 0, 0, 255))
    black.alpha_composite(image)
    return black.convert("RGB")


def frame_score(path: Path) -> float:
    rgba = np.asarray(Image.open(path).convert("RGBA"))
    rgb = rgba[:, :, :3]
    alpha = rgba[:, :, 3].astype(np.float32) / 255.0
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    active = alpha > 0.04
    if not np.any(active):
        return 0.0
    area = float(active.mean())
    brightness = float((gray * alpha).sum() / max(active.sum(), 1))
    edges = cv2.Canny((np.maximum(gray, alpha) * 255).astype(np.uint8), 40, 120)
    edge_density = float((edges > 0).sum() / max(active.sum(), 1))
    return area * 0.55 + brightness * 0.35 + edge_density * 0.10


def select_peak_frame(frames: list[Path]) -> tuple[int, Path, list[float]]:
    scores = [frame_score(path) for path in frames]
    index = int(np.argmax(scores))
    return index, frames[index], scores


def resize_fit_on_black(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    source = image.convert("RGBA")
    source.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 255))
    canvas.alpha_composite(source, ((size[0] - source.width) // 2, (size[1] - source.height) // 2))
    return canvas.convert("RGB")


def save_structure_maps(peak_path: Path, out_dir: Path, size: tuple[int, int]) -> dict[str, str]:
    peak_rgba = Image.open(peak_path).convert("RGBA")
    source = resize_fit_on_black(peak_rgba, size)
    source_path = out_dir / "peak_frame_black.png"
    source.save(source_path)

    rgba_fit = Image.new("RGBA", size, (0, 0, 0, 0))
    temp = peak_rgba.copy()
    temp.thumbnail(size, Image.Resampling.LANCZOS)
    rgba_fit.alpha_composite(temp, ((size[0] - temp.width) // 2, (size[1] - temp.height) // 2))
    rgba_fit.save(out_dir / "peak_frame_rgba_fit.png")

    rgba = np.asarray(rgba_fit)
    rgb = rgba[:, :, :3]
    alpha = rgba[:, :, 3]
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    guide = np.maximum(gray, alpha)
    guide_blur = cv2.GaussianBlur(guide, (5, 5), 0)

    canny = cv2.Canny(guide_blur, 32, 96)
    canny = cv2.dilate(canny, np.ones((2, 2), np.uint8), iterations=1)
    canny_path = out_dir / "control_canny.png"
    Image.fromarray(canny, mode="L").convert("RGB").save(canny_path)

    alpha_soft = cv2.GaussianBlur(alpha, (0, 0), 3.0)
    alpha_soft = np.clip(alpha_soft * 1.25, 0, 255).astype(np.uint8)
    alpha_path = out_dir / "control_alpha_soft.png"
    Image.fromarray(alpha_soft, mode="L").convert("RGB").save(alpha_path)

    alpha_edges = cv2.morphologyEx((alpha > 10).astype(np.uint8) * 255, cv2.MORPH_GRADIENT, np.ones((5, 5), np.uint8))
    inner_edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 24, 90)
    lineart = np.maximum(canny, np.maximum(alpha_edges, inner_edges))
    lineart = cv2.GaussianBlur(lineart, (3, 3), 0)
    lineart = np.clip(lineart * 1.4, 0, 255).astype(np.uint8)
    lineart_path = out_dir / "control_lineart.png"
    Image.fromarray(lineart, mode="L").convert("RGB").save(lineart_path)

    return {
        "peakFrameBlack": str(source_path),
        "peakFrameRgbaFit": str(out_dir / "peak_frame_rgba_fit.png"),
        "canny": str(canny_path),
        "lineart": str(lineart_path),
        "alphaSoft": str(alpha_path),
    }


def make_lightning_reference(path: Path, size: tuple[int, int] = (512, 512)) -> None:
    image = Image.new("RGB", size, (0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    center = (size[0] // 2, size[1] // 2)
    draw.ellipse((center[0] - 34, center[1] - 34, center[0] + 34, center[1] + 34), fill=(210, 245, 255, 230))
    rng = np.random.default_rng(20260501)
    for strand in range(9):
        x = 42 + strand * 42 + int(rng.integers(-20, 20))
        y = int(rng.integers(70, size[1] - 70))
        points = []
        for step in range(7):
            x += int(rng.integers(20, 58))
            y += int(rng.integers(-46, 46))
            points.append((max(8, min(size[0] - 8, x)), max(8, min(size[1] - 8, y))))
        color = (120, 235, 255, 160)
        draw.line(points, fill=color, width=8, joint="curve")
        draw.line(points, fill=(245, 255, 255, 240), width=3)
        for px, py in points[1:-1:2]:
            branch = [(px, py), (px + int(rng.integers(-72, 72)), py + int(rng.integers(-78, 78)))]
            draw.line(branch, fill=(135, 225, 255, 145), width=4)
            draw.line(branch, fill=(255, 255, 255, 210), width=1)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def upload_image(config: ValidationConfig, path: Path, name: str) -> str:
    with path.open("rb") as handle:
        files = {"image": (name, handle, "image/png")}
        data = {"type": "input", "overwrite": "true"}
        response = requests.post(f"{config.comfy_base}/upload/image", files=files, data=data, timeout=120)
    response.raise_for_status()
    payload = response.json()
    return payload.get("name") or name


def build_qwen_control_workflow(
    config: ValidationConfig,
    control_image_name: str,
    reference_image_name: str,
    seed: int,
    filename_prefix: str,
) -> dict[str, Any]:
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": config.qwen_model, "weight_dtype": "fp8_e4m3fn"},
        },
        "2": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["1", 0],
                "lora_name": config.qwen_lora,
                "strength_model": 1.0,
            },
        },
        "3": {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": config.qwen_clip,
                "type": "qwen_image",
                "device": "default",
            },
        },
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": config.qwen_vae}},
        "5": {"class_type": "LoadImage", "inputs": {"image": control_image_name}},
        "6": {"class_type": "LoadImage", "inputs": {"image": reference_image_name}},
        "7": {
            "class_type": "TextEncodeQwenImageEditPlus",
            "inputs": {
                "clip": ["3", 0],
                "vae": ["4", 0],
                "image1": ["5", 0],
                "image2": ["6", 0],
                "prompt": POSITIVE_PROMPT,
            },
        },
        "8": {
            "class_type": "TextEncodeQwenImageEdit",
            "inputs": {
                "clip": ["3", 0],
                "prompt": NEGATIVE_PROMPT,
            },
        },
        "9": {
            "class_type": "ControlNetLoader",
            "inputs": {"control_net_name": config.controlnet_model},
        },
        "10": {
            "class_type": "SetUnionControlNetType",
            "inputs": {
                "control_net": ["9", 0],
                "type": config.controlnet_type,
            },
        },
        "11": {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": ["7", 0],
                "negative": ["8", 0],
                "control_net": ["10", 0],
                "image": ["5", 0],
                "vae": ["4", 0],
                "strength": config.controlnet_weight,
                "start_percent": 0.0,
                "end_percent": 0.86,
            },
        },
        "12": {
            "class_type": "EmptyQwenImageLayeredLatentImage",
            "inputs": {
                "width": config.width,
                "height": config.height,
                # Qwen ControlNet expects the base latent channel layout.
                # Extra edit layers produce a 4x hidden-state size mismatch
                # with the current Qwen-Image-InstantX-ControlNet-Union model.
                "layers": 0,
                "batch_size": 1,
            },
        },
        "13": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["2", 0],
                "seed": seed,
                "steps": config.steps,
                "cfg": config.cfg,
                "sampler_name": config.sampler_name,
                "scheduler": config.scheduler,
                "positive": ["11", 0],
                "negative": ["11", 1],
                "latent_image": ["12", 0],
                "denoise": config.denoise,
            },
        },
        "14": {"class_type": "VAEDecode", "inputs": {"samples": ["13", 0], "vae": ["4", 0]}},
        "15": {
            "class_type": "SaveImage",
            "inputs": {"images": ["14", 0], "filename_prefix": filename_prefix},
        },
    }


def queue_workflow(config: ValidationConfig, workflow: dict[str, Any]) -> str:
    payload = {"prompt": workflow, "client_id": str(uuid.uuid4())}
    response = requests.post(f"{config.comfy_base}/prompt", json=payload, timeout=120)
    if response.status_code >= 400:
        raise RuntimeError(response.text)
    data = response.json()
    if "error" in data:
        raise RuntimeError(json.dumps(data, ensure_ascii=False, indent=2))
    prompt_id = data.get("prompt_id")
    if not prompt_id:
        raise RuntimeError(f"No prompt_id returned: {data}")
    return str(prompt_id)


def wait_for_prompt(config: ValidationConfig, prompt_id: str) -> dict[str, Any]:
    start = time.time()
    last_status = ""
    while time.time() - start < config.timeout:
        history = request_json("GET", f"{config.comfy_base}/history/{prompt_id}", timeout=30)
        if prompt_id in history:
            item = history[prompt_id]
            status = item.get("status", {})
            if status.get("status_str") == "error":
                messages = status.get("messages", [])
                errors = [message[1] for message in messages if message and message[0] == "execution_error"]
                raise RuntimeError(json.dumps(errors[-1] if errors else status, ensure_ascii=False, indent=2))
            return item
        queue = request_json("GET", f"{config.comfy_base}/queue", timeout=30)
        status = json.dumps(queue, ensure_ascii=False)
        if status != last_status:
            print(f"[wait] prompt={prompt_id} queue={status[:500]}", flush=True)
            last_status = status
        time.sleep(4)
    raise TimeoutError(f"Timed out waiting for ComfyUI prompt: {prompt_id}")


def download_comfy_file(config: ValidationConfig, image_info: dict[str, str], target: Path) -> None:
    query = urlencode(
        {
            "filename": image_info["filename"],
            "subfolder": image_info.get("subfolder", ""),
            "type": image_info.get("type", "output"),
        }
    )
    response = requests.get(f"{config.comfy_base}/view?{query}", timeout=180)
    response.raise_for_status()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)


def collect_output(config: ValidationConfig, history: dict[str, Any], target: Path) -> dict[str, Any]:
    outputs = history.get("outputs", {})
    for node_id, value in outputs.items():
        images = value.get("images") or []
        if images:
            download_comfy_file(config, images[0], target)
            return {"node": node_id, "image": images[0], "localPath": str(target)}
    raise RuntimeError(f"No image output found in ComfyUI history: {outputs}")


def extract_metrics(image_path: Path, control_path: Path, template_peak_path: Path) -> dict[str, Any]:
    output = np.asarray(Image.open(image_path).convert("RGB"), dtype=np.uint8)
    control = np.asarray(Image.open(control_path).convert("RGB"), dtype=np.uint8)
    template = np.asarray(rgba_on_black(template_peak_path).resize((output.shape[1], output.shape[0]), Image.Resampling.LANCZOS), dtype=np.uint8)

    gray = cv2.cvtColor(output, cv2.COLOR_RGB2GRAY)
    active = gray > 20
    bright = gray > max(64, int(np.percentile(gray, 86)))
    sample_mask = bright if np.any(bright) else active
    if np.any(sample_mask):
        dominant = output[sample_mask].mean(axis=0)
    else:
        dominant = np.array([0.0, 0.0, 0.0])
    r, g, b = [float(v) for v in dominant]
    blue_white_score = float((b + g * 0.55 - r * 0.35) / 255.0)
    blue_white = bool(b > 82 and b >= r * 1.05 and g >= r * 0.75)

    edges = cv2.Canny(gray, 36, 120)
    active_count = int(max(active.sum(), 1))
    edge_density = float((edges > 0).sum() / active_count)

    # Count connected line fragments and approximate branchiness by endpoint ratio
    num_labels, labels = cv2.connectedComponents((edges > 0).astype(np.uint8), connectivity=8)
    component_count = int(max(0, num_labels - 1))
    edge_skeleton = (edges > 0).astype(np.uint8)
    kernel = np.ones((3, 3), np.uint8)
    neighbors = cv2.filter2D(edge_skeleton, -1, kernel) - edge_skeleton
    endpoints = int(((edge_skeleton > 0) & (neighbors == 1)).sum())
    branch_score = float((endpoints + min(component_count, 80) * 0.8) / max((edges > 0).sum(), 1))

    control_mask = cv2.cvtColor(control, cv2.COLOR_RGB2GRAY) > 18
    control_mask = cv2.dilate(control_mask.astype(np.uint8), np.ones((35, 35), np.uint8), iterations=1) > 0
    structure_overlap = float((active & control_mask).sum() / active_count)

    template_gray = cv2.cvtColor(template, cv2.COLOR_RGB2GRAY)
    template_edges = cv2.Canny(template_gray, 36, 120) > 0
    output_edges = edges > 0
    union = np.logical_or(template_edges, output_edges).sum()
    edge_iou = float(np.logical_and(template_edges, output_edges).sum() / max(union, 1))

    template_hsv = cv2.cvtColor(template, cv2.COLOR_RGB2HSV)
    output_hsv = cv2.cvtColor(output, cv2.COLOR_RGB2HSV)
    template_hue = float(np.mean(template_hsv[template_gray > 20, 0])) if np.any(template_gray > 20) else 0.0
    output_hue = float(np.mean(output_hsv[active, 0])) if np.any(active) else 0.0
    hue_shift = abs(output_hue - template_hue)

    green_dominant = bool(g > b * 1.15 and g > r * 1.2)
    flat_blob = bool(edge_density < 0.014 or active.mean() > 0.72)
    branch_like = bool(edge_density > 0.018 and (component_count >= 8 or branch_score > 0.02))
    structure_ok = bool(0.05 <= structure_overlap <= 0.92)
    not_template_recolor = bool(edge_iou < 0.42 and hue_shift > 14)
    lightning_like = bool(blue_white and branch_like and not green_dominant and not flat_blob)
    passed = bool(lightning_like and structure_ok and not_template_recolor)

    return {
        "dominantRgb": [round(r, 2), round(g, 2), round(b, 2)],
        "blueWhiteScore": round(blue_white_score, 4),
        "blueWhite": blue_white,
        "greenDominant": green_dominant,
        "edgeDensity": round(edge_density, 5),
        "edgeComponentCount": component_count,
        "edgeEndpointBranchScore": round(branch_score, 5),
        "structureOverlap": round(structure_overlap, 4),
        "templateOutputEdgeIoU": round(edge_iou, 4),
        "templateHue": round(template_hue, 2),
        "outputHue": round(output_hue, 2),
        "hueShift": round(hue_shift, 2),
        "flatBlob": flat_blob,
        "branchLike": branch_like,
        "structureOk": structure_ok,
        "notTemplateRecolor": not_template_recolor,
        "lightningLike": lightning_like,
        "passed": passed,
    }


def make_comparison_grid(
    template_path: Path,
    controls: dict[str, str],
    reference_path: Path,
    candidate_paths: list[Path],
    out_path: Path,
) -> None:
    tiles: list[tuple[str, Image.Image]] = [
        ("template peak", rgba_on_black(template_path)),
        ("canny", Image.open(controls["canny"]).convert("RGB")),
        ("lineart", Image.open(controls["lineart"]).convert("RGB")),
        ("alpha soft", Image.open(controls["alphaSoft"]).convert("RGB")),
        ("style ref", Image.open(reference_path).convert("RGB")),
    ]
    for idx, path in enumerate(candidate_paths):
        tiles.append((f"candidate {idx}", Image.open(path).convert("RGB")))

    tile_w, tile_h = 320, 180
    cols = 3
    rows = math.ceil(len(tiles) / cols)
    canvas = Image.new("RGB", (tile_w * cols, tile_h * rows), (8, 10, 14))
    draw = ImageDraw.Draw(canvas)
    for index, (label, image) in enumerate(tiles):
        thumb = image.copy()
        thumb.thumbnail((tile_w, tile_h - 24), Image.Resampling.LANCZOS)
        x = (index % cols) * tile_w
        y = (index // cols) * tile_h
        canvas.paste(thumb, (x + (tile_w - thumb.width) // 2, y + 22 + (tile_h - 24 - thumb.height) // 2))
        draw.rectangle((x, y, x + tile_w - 1, y + tile_h - 1), outline=(64, 92, 130), width=1)
        draw.text((x + 10, y + 6), label, fill=(245, 248, 255))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)


def run_validation(config: ValidationConfig) -> tuple[Path, dict[str, Any]]:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = OUTPUT_ROOT / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)

    summary: dict[str, Any] = {
        "pipeline": PIPELINE,
        "stage": "single-frame conditioned regeneration",
        "template": "built-in slash_basic_builtin peak frame",
        "forbiddenRoutes": [
            "img2img template pixel edit",
            "raw VACE",
            "lifecycle remix",
            "sprite sheet style transfer",
            "local material mapping",
        ],
        "positivePrompt": POSITIVE_PROMPT,
        "negativePrompt": NEGATIVE_PROMPT,
        "config": asdict(config),
        "resultStatus": "unknown",
        "failureReason": "",
        "candidates": [],
    }

    env_ok, env_report = ensure_environment(config, out_dir)
    summary["environment"] = env_report
    if not env_ok:
        summary["resultStatus"] = "environment_unavailable"
        summary["failureReason"] = env_report.get("failureReason", "Environment unavailable")
        write_json(out_dir / "summary.json", summary)
        append_debug_log(
            "AIFX_CONDITIONED_REGEN_VALIDATION 环境不可验证",
            summary["failureReason"],
            f"仅记录 environment.json / summary.json，未回退到旧 pipeline。输出目录：{out_dir}",
            "仅新增 tools 能力验证输出；不影响 AI 特效主入口、UI、导出或 Spine。",
        )
        return out_dir, summary

    frames = sorted_template_frames(Path(config.template_dir))
    peak_index, peak_path, scores = select_peak_frame(frames)
    controls = save_structure_maps(peak_path, out_dir, (config.width, config.height))
    reference_path = out_dir / "reference_lightning_aux.png"
    make_lightning_reference(reference_path)

    control_upload = upload_image(config, Path(controls["lineart"]), f"{PIPELINE}_{timestamp}_lineart.png")
    reference_upload = upload_image(config, reference_path, f"{PIPELINE}_{timestamp}_lightning_ref.png")

    summary["templateAnalysis"] = {
        "templateDir": str(config.template_dir),
        "frameCount": len(frames),
        "peakFrameIndex": peak_index,
        "peakFramePath": str(peak_path),
        "frameScores": [round(float(score), 6) for score in scores],
        "structureMaps": controls,
    }
    summary["referenceImage"] = str(reference_path)
    summary["uploads"] = {"control": control_upload, "reference": reference_upload}

    candidate_paths: list[Path] = []
    pass_count = 0
    workflow_jsons: dict[str, Any] = {}
    for candidate_id in range(config.candidate_count):
        seed = config.seed + candidate_id
        prefix = f"{PIPELINE}_{timestamp}_candidate_{candidate_id}"
        workflow = build_qwen_control_workflow(config, control_upload, reference_upload, seed, prefix)
        workflow_jsons[f"candidate_{candidate_id}"] = workflow
        if candidate_id == 0:
            write_json(out_dir / "workflow.json", workflow)
        write_json(out_dir / "workflows" / f"candidate_{candidate_id}.json", workflow)

        print(f"[run] candidate={candidate_id} seed={seed}", flush=True)
        started = time.time()
        candidate_summary: dict[str, Any] = {
            "id": candidate_id,
            "seed": seed,
            "workflowRoute": "Qwen Image Edit latent generation with Qwen ControlNet structure",
            "status": "unknown",
        }
        try:
            prompt_id = queue_workflow(config, workflow)
            history = wait_for_prompt(config, prompt_id)
            candidate_path = out_dir / "candidates" / f"candidate_{candidate_id}.png"
            output_meta = collect_output(config, history, candidate_path)
            metrics = extract_metrics(candidate_path, Path(controls["lineart"]), peak_path)
            candidate_paths.append(candidate_path)
            if metrics["passed"]:
                pass_count += 1
            candidate_summary.update(
                {
                    "status": "pass" if metrics["passed"] else "fail",
                    "promptId": prompt_id,
                    "elapsedSeconds": round(time.time() - started, 2),
                    "outputPath": str(candidate_path),
                    "outputMeta": output_meta,
                    "metrics": metrics,
                }
            )
        except Exception as exc:
            candidate_summary.update(
                {
                    "status": "error",
                    "elapsedSeconds": round(time.time() - started, 2),
                    "failureReason": repr(exc),
                }
            )
            print(f"[error] candidate={candidate_id} {exc!r}", flush=True)
        summary["candidates"].append(candidate_summary)
        write_json(out_dir / "summary.partial.json", summary)

    write_json(out_dir / "all_workflows.json", workflow_jsons)
    if candidate_paths:
        comparison_path = out_dir / "comparison_grid.png"
        make_comparison_grid(peak_path, controls, reference_path, candidate_paths, comparison_path)
        summary["comparisonGrid"] = str(comparison_path)

    summary["passCount"] = pass_count
    summary["failCount"] = config.candidate_count - pass_count
    if pass_count >= 1:
        summary["resultStatus"] = "pass"
    elif any(item.get("status") == "error" for item in summary["candidates"]):
        summary["resultStatus"] = "workflow_error"
        summary["failureReason"] = "All candidate workflows failed or none passed automated regeneration checks."
    else:
        summary["resultStatus"] = "fail"
        summary["failureReason"] = (
            "No candidate met the single-frame conditioned regeneration criteria: "
            "blue-white lightning, branching edge detail, structural guidance, and not a recolor."
        )
    write_json(out_dir / "summary.json", summary)
    append_debug_log(
        "AIFX_CONDITIONED_REGEN_VALIDATION 单帧条件生成验证",
        "当前 raw VACE/lifecycle remix 不再继续，需验证结构约束 + 强生成模型能否完成火刀峰值帧到雷电刀光的语义重构。",
        (
            f"pipeline={PIPELINE}；route=Qwen Image Edit + Qwen ControlNet；"
            f"candidateCount={config.candidate_count}；passCount={pass_count}；"
            f"resultStatus={summary['resultStatus']}；output={out_dir}"
        ),
        "仅新增 tools 验证脚本与 debug-output 实验结果；不修改 AI 特效主入口、UI、VACE、导出或 Spine。",
    )
    return out_dir, summary


def parse_args() -> ValidationConfig:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-base", default="http://127.0.0.1:8188")
    parser.add_argument("--template-dir", default=str(DEFAULT_TEMPLATE_DIR))
    parser.add_argument("--seed", type=int, default=2026050117)
    parser.add_argument("--candidate-count", type=int, default=4)
    parser.add_argument("--width", type=int, default=768)
    parser.add_argument("--height", type=int, default=384)
    parser.add_argument("--steps", type=int, default=18)
    parser.add_argument("--cfg", type=float, default=4.0)
    parser.add_argument("--controlnet-weight", type=float, default=0.82)
    parser.add_argument("--timeout", type=int, default=1800)
    args = parser.parse_args()
    return ValidationConfig(
        comfy_base=args.comfy_base,
        template_dir=args.template_dir,
        seed=args.seed,
        candidate_count=args.candidate_count,
        width=args.width,
        height=args.height,
        steps=args.steps,
        cfg=args.cfg,
        controlnet_weight=args.controlnet_weight,
        timeout=args.timeout,
    )


def main() -> int:
    config = parse_args()
    out_dir, summary = run_validation(config)
    print(
        json.dumps(
            {
                "outputDir": str(out_dir),
                "resultStatus": summary["resultStatus"],
                "passCount": summary.get("passCount", 0),
                "failureReason": summary.get("failureReason", ""),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if summary["resultStatus"] in {"pass", "fail", "workflow_error", "environment_unavailable"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
