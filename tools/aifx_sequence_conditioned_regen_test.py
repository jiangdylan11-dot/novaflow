#!/usr/bin/env python3
"""Validate sequence-level conditioned regeneration for NovaFlow AIFX.

Experiment-only script for AIFX_SEQUENCE_CONDITIONED_REGEN_TEST.
It keeps the product runtime untouched and does not use template RGB as
img2img input. Template frames only provide canny/lineart/alphaSoft structure
maps for ControlNet.
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
from PIL import Image, ImageDraw


PIPELINE = "AIFX_SEQUENCE_CONDITIONED_REGEN_TEST"
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
OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-sequence-conditioned-regen"
LOG_PATH = REPO_ROOT / "logs" / "debug.log"

POSITIVE_PROMPT = (
    "A blue-white lightning energy slash VFX frame, branching electric arcs, "
    "jagged sharp edges, high-frequency electric forks, bright electric core, "
    "electric sparks, strong glow, high contrast, clean black background, VFX only, "
    "no character, no human, no scene, no object. Follow the provided structure "
    "map as the slash composition for this animation frame, but regenerate it as "
    "a new lightning effect. Keep the same lightning style across all frames."
)
NEGATIVE_PROMPT = (
    "person, human, face, hand, body, character, anime character, girl, boy, "
    "object, weapon, sword, scene, landscape, room, floor, wall, text, logo, "
    "frame, border, realistic background, photo, green energy, yellow fire, "
    "orange fire, flame, smoke scene, blurry blob, soft blob, flat color fill, "
    "single smooth arc, texture overlay, noisy texture, different style each frame"
)


@dataclass
class SequenceConfig:
    comfy_base: str = "http://127.0.0.1:8188"
    template_dir: str = str(DEFAULT_TEMPLATE_DIR)
    width: int = 768
    height: int = 384
    seed: int = 2026050127
    steps: int = 10
    cfg: float = 3.2
    denoise: float = 1.0
    controlnet_weight: float = 0.58
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


def node_options(info: dict[str, Any], node: str, field: str) -> list[str]:
    try:
        values = info[node]["input"]["required"][field][0]
    except Exception:
        return []
    return list(values) if isinstance(values, list) else []


def ensure_environment(config: SequenceConfig, out_dir: Path) -> tuple[bool, dict[str, Any]]:
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
        "selectedRoute": "per-frame Qwen Image Edit latent generation with shared prompt/reference and ControlNet structure",
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
        info = request_json("GET", f"{config.comfy_base}/object_info", timeout=30)
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
        report["failureReason"] = "Required Qwen Image Edit / ControlNet nodes or models are missing."
    write_json(out_dir / "environment.json", report)
    return ok, report


def sorted_template_frames(template_dir: Path) -> list[Path]:
    frames = sorted(template_dir.glob("*.png"))
    if not frames:
        raise RuntimeError(f"No PNG frames found in template directory: {template_dir}")
    return frames


def resize_rgba_fit(path: Path, size: tuple[int, int]) -> Image.Image:
    source = Image.open(path).convert("RGBA")
    source.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.alpha_composite(source, ((size[0] - source.width) // 2, (size[1] - source.height) // 2))
    return canvas


def rgba_on_black(rgba: Image.Image) -> Image.Image:
    black = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
    black.alpha_composite(rgba)
    return black.convert("RGB")


def make_control_maps(frame_path: Path, frame_index: int, out_dir: Path, size: tuple[int, int]) -> dict[str, str]:
    control_dir = out_dir / "control_frames"
    template_dir = out_dir / "template_frames"
    control_dir.mkdir(parents=True, exist_ok=True)
    template_dir.mkdir(parents=True, exist_ok=True)

    rgba = resize_rgba_fit(frame_path, size)
    template_preview = rgba_on_black(rgba)
    template_preview_path = template_dir / f"frame_{frame_index:03d}.png"
    template_preview.save(template_preview_path)

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

    # Control input combines structural edges with soft alpha mass. It is not
    # template RGB and is not used as final alpha or hard mask.
    control_input = np.maximum(lineart, (alpha_soft * 0.42).astype(np.uint8))

    paths = {
        "templatePreview": str(template_preview_path),
        "canny": str(control_dir / f"frame_{frame_index:03d}_canny.png"),
        "lineart": str(control_dir / f"frame_{frame_index:03d}_lineart.png"),
        "alphaSoft": str(control_dir / f"frame_{frame_index:03d}_alpha_soft.png"),
        "controlInput": str(control_dir / f"frame_{frame_index:03d}_control_input.png"),
    }
    Image.fromarray(canny, mode="L").convert("RGB").save(paths["canny"])
    Image.fromarray(lineart, mode="L").convert("RGB").save(paths["lineart"])
    Image.fromarray(alpha_soft, mode="L").convert("RGB").save(paths["alphaSoft"])
    Image.fromarray(control_input, mode="L").convert("RGB").save(paths["controlInput"])
    return paths


def make_lightning_reference(path: Path, size: tuple[int, int] = (512, 512)) -> None:
    image = Image.new("RGB", size, (0, 0, 0))
    draw = ImageDraw.Draw(image, "RGBA")
    rng = np.random.default_rng(2026050127)
    for strand in range(11):
        points = []
        x = int(rng.integers(24, 110))
        y = int(rng.integers(80, size[1] - 80))
        for _ in range(8):
            x += int(rng.integers(35, 68))
            y += int(rng.integers(-58, 58))
            points.append((max(8, min(size[0] - 8, x)), max(8, min(size[1] - 8, y))))
        draw.line(points, fill=(80, 220, 255, 160), width=8, joint="curve")
        draw.line(points, fill=(245, 255, 255, 245), width=3)
        for px, py in points[2:-1:2]:
            branch = [(px, py), (px + int(rng.integers(-90, 90)), py + int(rng.integers(-86, 86)))]
            draw.line(branch, fill=(95, 210, 255, 150), width=4)
            draw.line(branch, fill=(245, 255, 255, 220), width=1)
    for _ in range(40):
        x = int(rng.integers(0, size[0]))
        y = int(rng.integers(0, size[1]))
        r = int(rng.integers(1, 4))
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(160, 240, 255, 150))
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path)


def upload_image(config: SequenceConfig, path: Path, name: str) -> str:
    with path.open("rb") as handle:
        files = {"image": (name, handle, "image/png")}
        data = {"type": "input", "overwrite": "true"}
        response = requests.post(f"{config.comfy_base}/upload/image", files=files, data=data, timeout=120)
    response.raise_for_status()
    return response.json().get("name") or name


def build_workflow(
    config: SequenceConfig,
    control_image_name: str,
    reference_image_name: str,
    seed: int,
    filename_prefix: str,
) -> dict[str, Any]:
    return {
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
        "8": {"class_type": "TextEncodeQwenImageEdit", "inputs": {"clip": ["3", 0], "prompt": NEGATIVE_PROMPT}},
        "9": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": config.controlnet_model}},
        "10": {
            "class_type": "SetUnionControlNetType",
            "inputs": {"control_net": ["9", 0], "type": config.controlnet_type},
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
                "end_percent": 0.82,
            },
        },
        "12": {
            "class_type": "EmptyQwenImageLayeredLatentImage",
            "inputs": {"width": config.width, "height": config.height, "layers": 0, "batch_size": 1},
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
        "15": {"class_type": "SaveImage", "inputs": {"images": ["14", 0], "filename_prefix": filename_prefix}},
    }


def queue_workflow(config: SequenceConfig, workflow: dict[str, Any]) -> str:
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


def wait_for_prompt(config: SequenceConfig, prompt_id: str) -> dict[str, Any]:
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
            print(f"[wait] prompt={prompt_id} queue={status[:420]}", flush=True)
            last_status = status
        time.sleep(4)
    raise TimeoutError(f"Timed out waiting for ComfyUI prompt: {prompt_id}")


def download_comfy_file(config: SequenceConfig, image_info: dict[str, str], target: Path) -> None:
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


def collect_output(config: SequenceConfig, history: dict[str, Any], target: Path) -> dict[str, Any]:
    for node_id, value in history.get("outputs", {}).items():
        images = value.get("images") or []
        if images:
            download_comfy_file(config, images[0], target)
            return {"node": node_id, "image": images[0], "localPath": str(target)}
    raise RuntimeError(f"No image output found in history: {history.get('outputs', {})}")


def active_metrics(path: Path) -> dict[str, Any]:
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    active = gray > 22
    if np.any(active):
        ys, xs = np.where(active)
        bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
        center = [float(xs.mean()), float(ys.mean())]
        active_rgb = rgb[active]
        dominant = active_rgb[np.argsort(np.linalg.norm(active_rgb, axis=1))[-max(1, min(1000, active_rgb.shape[0])) :]].mean(axis=0)
    else:
        bbox = [0, 0, 0, 0]
        center = [0.0, 0.0]
        dominant = np.array([0.0, 0.0, 0.0])
    edges = cv2.Canny(gray, 36, 120)
    components = cv2.connectedComponents((edges > 0).astype(np.uint8), connectivity=8)[0] - 1
    area = float(active.mean())
    bbox_area = float(max(0, bbox[2] - bbox[0] + 1) * max(0, bbox[3] - bbox[1] + 1) / (rgb.shape[0] * rgb.shape[1]))
    brightness_sum = float(gray.sum() / (255.0 * gray.size))
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    hue = float(np.mean(hsv[active, 0])) if np.any(active) else 0.0
    r, g, b = [float(v) for v in dominant]
    if np.any(active):
        active_rgb = rgb[active].astype(np.float32)
        ar = active_rgb[:, 0]
        ag = active_rgb[:, 1]
        ab = active_rgb[:, 2]
        blue_cyan = (
            ((ab > 95) & (ab >= ar * 1.02) & (ag >= ar * 0.62))
            | ((ab > 150) & (ag > 135) & (ar < 210))
            | ((ab > 185) & (ag > 185) & (ar > 180))
        )
        blue_cyan_ratio = float(np.mean(blue_cyan))
        green_fire = ((ag > ab * 1.18) & (ag > ar * 1.15)) | ((ar > ab * 1.2) & (ag > ab * 0.65))
        green_fire_ratio = float(np.mean(green_fire))
    else:
        blue_cyan_ratio = 0.0
        green_fire_ratio = 0.0
    return {
        "activeArea": area,
        "bboxArea": bbox_area,
        "brightnessSum": brightness_sum,
        "bbox": bbox,
        "center": [round(center[0], 2), round(center[1], 2)],
        "dominantRgb": [round(r, 2), round(g, 2), round(b, 2)],
        "hue": hue,
        "edgeDensity": float((edges > 0).sum() / max(active.sum(), 1)),
        "edgeComponents": int(max(components, 0)),
        "blueCyanPixelRatio": blue_cyan_ratio,
        "greenFirePixelRatio": green_fire_ratio,
        "blueWhite": bool(blue_cyan_ratio >= 0.10 and green_fire_ratio <= 0.45),
    }


def pearson(a: list[float], b: list[float]) -> float:
    if len(a) != len(b) or len(a) < 2:
        return 0.0
    aa = np.asarray(a, dtype=np.float64)
    bb = np.asarray(b, dtype=np.float64)
    if float(np.std(aa)) < 1e-8 or float(np.std(bb)) < 1e-8:
        return 0.0
    return float(np.corrcoef(aa, bb)[0, 1])


def normalized_jump(values: list[float]) -> float:
    arr = np.asarray(values, dtype=np.float64)
    if arr.size < 2:
        return 0.0
    denom = max(float(np.mean(arr)), 1e-6)
    return float(np.mean(np.abs(np.diff(arr))) / denom)


def evaluate_sequence(template_metrics: list[dict[str, Any]], output_metrics: list[dict[str, Any]]) -> dict[str, Any]:
    template_area = [m["activeArea"] for m in template_metrics]
    output_area = [m["activeArea"] for m in output_metrics]
    template_bbox = [m["bboxArea"] for m in template_metrics]
    output_bbox = [m["bboxArea"] for m in output_metrics]
    template_brightness = [m["brightnessSum"] for m in template_metrics]
    output_brightness = [m["brightnessSum"] for m in output_metrics]
    template_edges = [m["edgeDensity"] for m in template_metrics]
    output_edges = [m["edgeDensity"] for m in output_metrics]
    output_hues = [m["hue"] for m in output_metrics]
    output_blue_ratios = [m["blueCyanPixelRatio"] for m in output_metrics]
    blue_ratio = sum(1 for m in output_metrics if m["blueWhite"]) / max(len(output_metrics), 1)
    blue_pixel_mean = float(np.mean(output_blue_ratios)) if output_blue_ratios else 0.0
    hue_std = float(np.std(output_hues))
    edge_component_jump = normalized_jump([m["edgeComponents"] for m in output_metrics])
    output_area_jump = normalized_jump(output_area)
    diag = math.sqrt(768 * 768 + 384 * 384)
    if output_metrics:
        width = max(1, max(m["bbox"][2] for m in output_metrics) + 1)
        height = max(1, max(m["bbox"][3] for m in output_metrics) + 1)
        diag = math.sqrt(width * width + height * height)
    center_distances = [
        math.dist(t["center"], o["center"]) / max(diag, 1.0)
        for t, o in zip(template_metrics, output_metrics)
    ]
    mean_center_distance = float(np.mean(center_distances)) if center_distances else 1.0
    template_center_path = float(
        sum(math.dist(template_metrics[i - 1]["center"], template_metrics[i]["center"]) for i in range(1, len(template_metrics)))
    )
    output_center_path = float(
        sum(math.dist(output_metrics[i - 1]["center"], output_metrics[i]["center"]) for i in range(1, len(output_metrics)))
    )
    center_movement_ratio = output_center_path / max(template_center_path, 1.0)
    peak_index = int(np.argmax(output_area)) if output_area else -1
    template_peak_index = int(np.argmax(template_area)) if template_area else -1
    tail_dissipation_ratio = float(output_area[-1] / max(max(output_area), 1e-6)) if output_area else 1.0

    area_corr = pearson(template_area, output_area)
    bbox_corr = pearson(template_bbox, output_bbox)
    brightness_corr = pearson(template_brightness, output_brightness)
    edge_corr = pearson(template_edges, output_edges)

    style_consistency_pass = bool((blue_ratio >= 0.78 or blue_pixel_mean >= 0.22) and hue_std <= 35)
    structure_motion_pass = bool(mean_center_distance <= 0.34 and center_movement_ratio >= 0.28)
    lifecycle_pass = bool(
        area_corr >= 0.28
        and (bbox_corr >= 0.18 or brightness_corr >= 0.24)
        and tail_dissipation_ratio <= 0.68
        and abs(peak_index - template_peak_index) <= 3
        and structure_motion_pass
    )
    temporal_consistency_pass = bool(
        style_consistency_pass
        and edge_component_jump <= 1.15
        and output_area_jump <= 0.75
        and structure_motion_pass
    )

    failure_reasons: list[str] = []
    if not style_consistency_pass:
        failure_reasons.append(
            f"style inconsistency: blue_ratio={blue_ratio:.2f}, blue_pixel_mean={blue_pixel_mean:.2f}, hue_std={hue_std:.2f}"
        )
    if not lifecycle_pass:
        failure_reasons.append(
            f"lifecycle/structure mismatch: area_corr={area_corr:.3f}, bbox_corr={bbox_corr:.3f}, "
            f"brightness_corr={brightness_corr:.3f}, tail_ratio={tail_dissipation_ratio:.3f}, "
            f"center_distance={mean_center_distance:.3f}, center_movement_ratio={center_movement_ratio:.3f}"
        )
    if not temporal_consistency_pass:
        failure_reasons.append(
            f"temporal jitter/style drift: edge_component_jump={edge_component_jump:.3f}, output_area_jump={output_area_jump:.3f}"
        )
    if failure_reasons:
        failure_reasons.append("单帧重生成可行，但逐帧扩展不可直接产品化。")

    return {
        "temporal_consistency_pass": temporal_consistency_pass,
        "style_consistency_pass": style_consistency_pass,
        "lifecycle_pass": lifecycle_pass,
        "failureReason": " ".join(failure_reasons),
        "metrics": {
            "blueFrameRatio": round(blue_ratio, 4),
            "bluePixelMean": round(blue_pixel_mean, 4),
            "hueStd": round(hue_std, 4),
            "areaCorrelation": round(area_corr, 4),
            "bboxCorrelation": round(bbox_corr, 4),
            "brightnessCorrelation": round(brightness_corr, 4),
            "edgeDensityCorrelation": round(edge_corr, 4),
            "edgeComponentJump": round(edge_component_jump, 4),
            "outputAreaJump": round(output_area_jump, 4),
            "meanCenterDistance": round(mean_center_distance, 4),
            "centerMovementRatio": round(center_movement_ratio, 4),
            "tailDissipationRatio": round(tail_dissipation_ratio, 4),
            "templatePeakIndex": template_peak_index,
            "outputPeakIndex": peak_index,
            "structureMotionPass": structure_motion_pass,
        },
        "curves": {
            "templateActiveArea": [round(v, 6) for v in template_area],
            "outputActiveArea": [round(v, 6) for v in output_area],
            "templateBboxArea": [round(v, 6) for v in template_bbox],
            "outputBboxArea": [round(v, 6) for v in output_bbox],
            "templateBrightness": [round(v, 6) for v in template_brightness],
            "outputBrightness": [round(v, 6) for v in output_brightness],
            "outputHue": [round(v, 4) for v in output_hues],
        },
    }


def make_frame_comparison(template_path: Path, control_path: Path, generated_path: Path, out_path: Path) -> None:
    labels = [("template", template_path), ("control", control_path), ("generated", generated_path)]
    tile_w, tile_h = 256, 128
    canvas = Image.new("RGB", (tile_w * 3, tile_h + 24), (8, 10, 14))
    draw = ImageDraw.Draw(canvas)
    for index, (label, path) in enumerate(labels):
        img = Image.open(path).convert("RGB")
        img.thumbnail((tile_w, tile_h), Image.Resampling.LANCZOS)
        x = index * tile_w
        canvas.paste(img, (x + (tile_w - img.width) // 2, 24 + (tile_h - img.height) // 2))
        draw.text((x + 8, 6), label, fill=(245, 248, 255))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)


def make_comparison_grid(frame_comparisons: list[Path], out_path: Path) -> None:
    thumbs = [Image.open(path).convert("RGB") for path in frame_comparisons]
    if not thumbs:
        return
    cols = 1
    tile_w = max(img.width for img in thumbs)
    tile_h = max(img.height for img in thumbs)
    canvas = Image.new("RGB", (tile_w * cols, tile_h * len(thumbs)), (8, 10, 14))
    for i, img in enumerate(thumbs):
        canvas.paste(img, (0, i * tile_h))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)


def run_test(config: SequenceConfig) -> tuple[Path, dict[str, Any]]:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = OUTPUT_ROOT / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)
    summary: dict[str, Any] = {
        "pipeline": PIPELINE,
        "stage": "sequence conditioned regeneration",
        "positivePrompt": POSITIVE_PROMPT,
        "negativePrompt": NEGATIVE_PROMPT,
        "config": asdict(config),
        "constraints": [
            "template RGB is never used as img2img input",
            "template only provides canny/lineart/alphaSoft ControlNet structure",
            "no hard alpha mask or recolor postprocess",
            "no product UI/runtime changes",
        ],
        "frames": [],
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
                "resultStatus": "environment_unavailable",
                "failureReason": env_report.get("failureReason", "Environment unavailable"),
            }
        )
        write_json(out_dir / "summary.json", summary)
        return out_dir, summary

    frames = sorted_template_frames(Path(config.template_dir))
    reference_path = out_dir / "reference_lightning_aux.png"
    make_lightning_reference(reference_path)
    reference_upload = upload_image(config, reference_path, f"{PIPELINE}_{timestamp}_lightning_ref.png")
    summary["referenceImage"] = str(reference_path)
    summary["referenceUpload"] = reference_upload
    summary["frameCount"] = len(frames)

    generated_paths: list[Path] = []
    comparison_paths: list[Path] = []
    workflows: dict[str, Any] = {}
    template_metrics: list[dict[str, Any]] = []
    output_metrics: list[dict[str, Any]] = []

    for index, frame_path in enumerate(frames):
        print(f"[frame] {index + 1}/{len(frames)} {frame_path.name}", flush=True)
        controls = make_control_maps(frame_path, index, out_dir, (config.width, config.height))
        control_upload = upload_image(config, Path(controls["controlInput"]), f"{PIPELINE}_{timestamp}_frame_{index:03d}_control.png")
        seed = config.seed
        prefix = f"{PIPELINE}_{timestamp}_frame_{index:03d}"
        workflow = build_workflow(config, control_upload, reference_upload, seed, prefix)
        workflows[f"frame_{index:03d}"] = workflow
        if index == 0:
            write_json(out_dir / "workflow_frame_000.json", workflow)
        write_json(out_dir / "workflows" / f"frame_{index:03d}.json", workflow)

        frame_summary: dict[str, Any] = {
            "index": index,
            "templateFrame": str(frame_path),
            "controls": controls,
            "seed": seed,
            "controlUpload": control_upload,
        }
        started = time.time()
        try:
            prompt_id = queue_workflow(config, workflow)
            history = wait_for_prompt(config, prompt_id)
            generated_path = out_dir / "generated_frames" / f"frame_{index:03d}.png"
            output_meta = collect_output(config, history, generated_path)
            generated_paths.append(generated_path)

            template_metric = active_metrics(Path(controls["templatePreview"]))
            output_metric = active_metrics(generated_path)
            template_metrics.append(template_metric)
            output_metrics.append(output_metric)
            compare_path = out_dir / "frame_comparisons" / f"frame_{index:03d}.png"
            make_frame_comparison(Path(controls["templatePreview"]), Path(controls["controlInput"]), generated_path, compare_path)
            comparison_paths.append(compare_path)

            frame_summary.update(
                {
                    "status": "done",
                    "promptId": prompt_id,
                    "elapsedSeconds": round(time.time() - started, 2),
                    "generatedFrame": str(generated_path),
                    "outputMeta": output_meta,
                    "templateMetrics": template_metric,
                    "outputMetrics": output_metric,
                    "comparison": str(compare_path),
                }
            )
        except Exception as exc:
            frame_summary.update(
                {
                    "status": "error",
                    "elapsedSeconds": round(time.time() - started, 2),
                    "failureReason": repr(exc),
                }
            )
            print(f"[error] frame={index} {exc!r}", flush=True)
        summary["frames"].append(frame_summary)
        write_json(out_dir / "summary.partial.json", summary)

    write_json(out_dir / "all_workflows.json", workflows)
    if comparison_paths:
        comparison_grid = out_dir / "comparison_grid.png"
        make_comparison_grid(comparison_paths, comparison_grid)
        summary["comparisonGrid"] = str(comparison_grid)

    if len(output_metrics) == len(frames):
        report = evaluate_sequence(template_metrics, output_metrics)
    else:
        report = {
            "temporal_consistency_pass": False,
            "style_consistency_pass": False,
            "lifecycle_pass": False,
            "failureReason": "One or more frames failed to generate; 单帧重生成可行，但逐帧扩展不可直接产品化。",
            "metrics": {},
            "curves": {},
        }
    write_json(out_dir / "temporal_report.json", report)
    summary.update(
        {
            "temporal_consistency_pass": report["temporal_consistency_pass"],
            "style_consistency_pass": report["style_consistency_pass"],
            "lifecycle_pass": report["lifecycle_pass"],
            "failureReason": report["failureReason"],
            "temporalReport": str(out_dir / "temporal_report.json"),
            "generatedFramesDir": str(out_dir / "generated_frames"),
            "controlFramesDir": str(out_dir / "control_frames"),
        }
    )
    summary["resultStatus"] = (
        "pass"
        if summary["temporal_consistency_pass"] and summary["style_consistency_pass"] and summary["lifecycle_pass"]
        else "fail"
    )
    write_json(out_dir / "summary.json", summary)
    append_debug_log(
        "AIFX_SEQUENCE_CONDITIONED_REGEN_TEST 序列条件重生成验证",
        "单帧结构驱动重生成已成功，需要验证逐帧扩展后是否保持风格一致、生命周期和时间稳定。",
        (
            f"pipeline={PIPELINE}; frameCount={len(frames)}; "
            f"temporal_consistency_pass={summary['temporal_consistency_pass']}; "
            f"style_consistency_pass={summary['style_consistency_pass']}; "
            f"lifecycle_pass={summary['lifecycle_pass']}; resultStatus={summary['resultStatus']}; output={out_dir}"
        ),
        "仅新增 tools 独立验证和 debug-output 实验结果；不修改 AI 特效主入口、UI、旧 pipeline、导出或 Spine。",
    )
    return out_dir, summary


def parse_args() -> SequenceConfig:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-base", default="http://127.0.0.1:8188")
    parser.add_argument("--template-dir", default=str(DEFAULT_TEMPLATE_DIR))
    parser.add_argument("--width", type=int, default=768)
    parser.add_argument("--height", type=int, default=384)
    parser.add_argument("--seed", type=int, default=2026050127)
    parser.add_argument("--steps", type=int, default=10)
    parser.add_argument("--cfg", type=float, default=3.2)
    parser.add_argument("--controlnet-weight", type=float, default=0.58)
    parser.add_argument("--timeout", type=int, default=1800)
    args = parser.parse_args()
    return SequenceConfig(
        comfy_base=args.comfy_base,
        template_dir=args.template_dir,
        width=args.width,
        height=args.height,
        seed=args.seed,
        steps=args.steps,
        cfg=args.cfg,
        controlnet_weight=args.controlnet_weight,
        timeout=args.timeout,
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
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
