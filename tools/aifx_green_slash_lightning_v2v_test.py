#!/usr/bin/env python3
"""Run the AIFX_GREEN_SLASH_TO_LIGHTNING_V2V_TEST experiment.

Experiment-only:
- reads the built-in green slash PNG sequence
- composites it into a black-background MP4
- runs Wan2.1 VACE video-to-video with a fixed lightning slash prompt
- outputs 4 candidate videos, extracted PNG frames, a comparison grid, and summary.json

This script does not touch NovaFlow product UI/runtime code and does not use
sprite-sheet generation, local material mapping, or per-frame img2img.
"""

from __future__ import annotations

import argparse
import json
import math
import time
import uuid
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw


PIPELINE = "AIFX_GREEN_SLASH_TO_LIGHTNING_V2V_TEST"
PROMPT = (
    "A blue-white lightning energy slash VFX following the motion of the input video, "
    "sharp electric arcs, strong glow, electric particles, high contrast, clean black "
    "background, VFX only, no character, no scene, no object. "
    "Follow the input animation lifecycle, fade in, grow stronger, expand, dissipate, "
    "fade out, preserve timing and energy envelope of the input video. "
    "Preserve the shape evolution of the input VFX animation, not just fade opacity. "
    "Follow the expansion, deformation, fragmentation, sparks, trailing particles, "
    "and dissipation pattern of the input animation."
)
NEGATIVE_PROMPT = (
    "person, human, face, hand, body, character, object, weapon, scene, landscape, "
    "room, floor, wall, text, logo, frame, border, realistic background, smoke scene, "
    "blurry blob, flat color fill."
)

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
OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-green-slash-lightning-v2v-test"
LOG_PATH = REPO_ROOT / "logs" / "debug.log"


@dataclass
class V2VConfig:
    comfy_base: str = "http://127.0.0.1:8188"
    template_dir: str = str(DEFAULT_TEMPLATE_DIR)
    width: int = 768
    height: int = 384
    fps: int = 12
    frame_count: int = 9
    seed: int = 2026050201
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


def http_json(method: str, url: str, payload: dict[str, Any] | None = None, timeout: int = 30) -> Any:
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read()
    if not body:
        return None
    return json.loads(body.decode("utf-8"))


def get_json(url: str, timeout: int = 30) -> Any:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def append_debug_log(status: str, reason: str, detail: str, impact: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M")
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(
            f"\n[{stamp}]\n"
            f"- 问题：{status}\n"
            f"- 原因：{reason}\n"
            f"- 解决方案：{detail}\n"
            f"- 影响范围：{impact}\n"
        )


def ensure_environment(config: V2VConfig, out_dir: Path) -> tuple[bool, dict[str, Any]]:
    report: dict[str, Any] = {
        "pipeline": PIPELINE,
        "comfyBase": config.comfy_base,
        "requiredNodes": [
            "WanVaceToVideo",
            "UNETLoader",
            "CLIPLoader",
            "CLIPTextEncode",
            "VAELoader",
            "VHS_LoadVideoPath",
            "KSampler",
            "VAEDecode",
            "SaveImage",
            "VHS_VideoCombine",
        ],
        "missingNodes": [],
        "models": {
            "diffusionModel": config.diffusion_model,
            "textEncoder": config.text_encoder,
            "vae": config.vae,
        },
        "environmentStatus": "unknown",
    }
    try:
        object_info = get_json(f"{config.comfy_base}/object_info", timeout=20)
    except Exception as exc:
        report["environmentStatus"] = "unavailable"
        report["failureReason"] = f"ComfyUI API unavailable: {exc!r}"
        write_json(out_dir / "environment.json", report)
        return False, report

    report["missingNodes"] = [node for node in report["requiredNodes"] if node not in object_info]

    def combo_values(node: str, field: str) -> list[str]:
        try:
            return list(object_info[node]["input"]["required"][field][0])
        except Exception:
            return []

    unets = combo_values("UNETLoader", "unet_name")
    clips = combo_values("CLIPLoader", "clip_name")
    vaes = combo_values("VAELoader", "vae_name")
    report["models"].update(
        {
            "diffusionModelAvailable": config.diffusion_model in unets,
            "textEncoderAvailable": config.text_encoder in clips,
            "vaeAvailable": config.vae in vaes,
            "availableVaceModels": [name for name in unets if "vace" in name.lower()],
            "availableWanModels": [name for name in unets if "wan" in name.lower()],
        }
    )
    ok = (
        not report["missingNodes"]
        and report["models"]["diffusionModelAvailable"]
        and report["models"]["textEncoderAvailable"]
        and report["models"]["vaeAvailable"]
    )
    report["environmentStatus"] = "ready" if ok else "unavailable"
    if not ok:
        report["failureReason"] = "Required Wan VACE video-to-video nodes or models are missing."
    write_json(out_dir / "environment.json", report)
    return ok, report


def sorted_pngs(template_dir: Path) -> list[Path]:
    frames = sorted(template_dir.glob("*.png"))
    if not frames:
        raise RuntimeError(f"No PNG frames found in template directory: {template_dir}")
    return frames


def composite_on_black_fit(path: Path, size: tuple[int, int]) -> Image.Image:
    source = Image.open(path).convert("RGBA")
    source.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 255))
    x = (size[0] - source.width) // 2
    y = (size[1] - source.height) // 2
    black_cell = Image.new("RGBA", source.size, (0, 0, 0, 255))
    black_cell.alpha_composite(source)
    canvas.alpha_composite(black_cell, (x, y))
    return canvas.convert("RGB")


def prepare_template_video(config: V2VConfig, out_dir: Path) -> dict[str, Any]:
    frames = sorted_pngs(Path(config.template_dir))
    used = frames[: config.frame_count]
    if len(used) < config.frame_count:
        raise RuntimeError(f"Template sequence has {len(frames)} frames, need {config.frame_count}")

    size = (config.width, config.height)
    black_frames_dir = out_dir / "input_black_frames"
    black_frames_dir.mkdir(parents=True, exist_ok=True)
    rendered: list[Path] = []
    for index, frame in enumerate(used):
        image = composite_on_black_fit(frame, size)
        target = black_frames_dir / f"frame_{index:03d}.png"
        image.save(target)
        rendered.append(target)

    video_path = out_dir / "template_green_slash_black.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(video_path), fourcc, float(config.fps), size)
    if not writer.isOpened():
        raise RuntimeError("OpenCV VideoWriter failed to create template MP4")
    for frame in rendered:
        arr = np.asarray(Image.open(frame).convert("RGB"))
        writer.write(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR))
    writer.release()

    strip = make_strip(rendered, out_dir / "template_green_slash_strip.png", label="template")
    meta = {
        "template": "built-in green slash",
        "templateDir": str(Path(config.template_dir)),
        "sourceFrameCount": len(frames),
        "frameCount": len(rendered),
        "fps": config.fps,
        "width": config.width,
        "height": config.height,
        "blackFrameDir": str(black_frames_dir),
        "blackFrames": [str(path) for path in rendered],
        "templateVideo": str(video_path),
        "templateStrip": str(strip),
    }
    write_json(out_dir / "template_video_meta.json", meta)
    return meta


def build_workflow(config: V2VConfig, video_path: Path, seed: int, filename_prefix: str) -> dict[str, Any]:
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": config.diffusion_model, "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": config.text_encoder, "type": "wan", "device": "default"},
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": config.vae}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": PROMPT}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": NEGATIVE_PROMPT}},
        "6": {
            "class_type": "VHS_LoadVideoPath",
            "inputs": {
                "video": str(video_path).replace("\\", "/"),
                "force_rate": float(config.fps),
                "custom_width": config.width,
                "custom_height": config.height,
                "frame_load_cap": config.frame_count,
                "skip_first_frames": 0,
                "select_every_nth": 1,
                "format": "Wan",
            },
        },
        "7": {
            "class_type": "WanVaceToVideo",
            "inputs": {
                "positive": ["4", 0],
                "negative": ["5", 0],
                "vae": ["3", 0],
                "width": config.width,
                "height": config.height,
                "length": config.frame_count,
                "batch_size": 1,
                "strength": config.vace_strength,
                "control_video": ["6", 0],
            },
        },
        "8": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0],
                "seed": seed,
                "steps": config.steps,
                "cfg": config.cfg,
                "sampler_name": config.sampler_name,
                "scheduler": config.scheduler,
                "positive": ["7", 0],
                "negative": ["7", 1],
                "latent_image": ["7", 2],
                "denoise": config.denoise,
            },
        },
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "10": {
            "class_type": "SaveImage",
            "inputs": {"images": ["9", 0], "filename_prefix": f"{filename_prefix}/frames/frame"},
        },
        "11": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["9", 0],
                "frame_rate": float(config.fps),
                "loop_count": 0,
                "filename_prefix": f"{filename_prefix}/video",
                "format": "video/h264-mp4",
                "pingpong": False,
                "save_output": True,
            },
        },
    }


def queue_workflow(config: V2VConfig, workflow: dict[str, Any]) -> str:
    response = http_json(
        "POST",
        f"{config.comfy_base}/prompt",
        {"prompt": workflow, "client_id": str(uuid.uuid4())},
        timeout=60,
    )
    prompt_id = response.get("prompt_id")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI did not return prompt_id: {response}")
    return str(prompt_id)


def wait_for_prompt(config: V2VConfig, prompt_id: str) -> dict[str, Any]:
    started = time.time()
    last_status = ""
    while time.time() - started < config.timeout:
        history = get_json(f"{config.comfy_base}/history/{prompt_id}", timeout=20)
        if prompt_id in history:
            return history[prompt_id]
        queue = get_json(f"{config.comfy_base}/queue", timeout=20)
        status = json.dumps(queue, ensure_ascii=False)
        if status != last_status:
            print(f"[wait] prompt={prompt_id} queue={status[:500]}", flush=True)
            last_status = status
        time.sleep(5)
    raise TimeoutError(f"Timed out waiting for ComfyUI prompt {prompt_id}")


def download_comfy_file(config: V2VConfig, item: dict[str, Any], target: Path) -> None:
    query = urllib.parse.urlencode(
        {
            "filename": item["filename"],
            "subfolder": item.get("subfolder", ""),
            "type": item.get("type", "output"),
        }
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(f"{config.comfy_base}/view?{query}", timeout=180) as response:
        target.write_bytes(response.read())


def collect_outputs(
    config: V2VConfig,
    history: dict[str, Any],
    out_dir: Path,
    candidate_id: int,
) -> dict[str, Any]:
    outputs = history.get("outputs", {})
    result: dict[str, Any] = {
        "rawOutputs": outputs,
        "frames": [],
        "video": None,
        "videoExtractedFrames": [],
    }
    frame_dir = out_dir / "frames" / f"candidate_{candidate_id}"
    for index, image in enumerate(outputs.get("10", {}).get("images", [])):
        target = frame_dir / f"frame_{index:03d}.png"
        download_comfy_file(config, image, target)
        result["frames"].append(str(target))

    video_dir = out_dir / "candidates"
    for key in ("gifs", "videos", "images"):
        for index, item in enumerate(outputs.get("11", {}).get(key, [])):
            suffix = Path(item.get("filename", f"candidate_{candidate_id}.mp4")).suffix or ".mp4"
            target = video_dir / f"candidate_{candidate_id}{suffix}"
            download_comfy_file(config, item, target)
            result["video"] = str(target)

    if result["video"]:
        extracted = extract_video_frames(Path(result["video"]), out_dir / "frames_from_video" / f"candidate_{candidate_id}")
        result["videoExtractedFrames"] = [str(path) for path in extracted]
    return result


def extract_video_frames(video_path: Path, target_dir: Path) -> list[Path]:
    target_dir.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(video_path))
    result: list[Path] = []
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        target = target_dir / f"frame_{index:03d}.png"
        cv2.imwrite(str(target), frame)
        result.append(target)
        index += 1
    capture.release()
    return result


def make_strip(frame_paths: list[Path], target: Path, label: str | None = None, thumb_width: int = 160) -> Path:
    if not frame_paths:
        raise RuntimeError("Cannot create strip without frames")
    images = [Image.open(path).convert("RGB") for path in frame_paths]
    thumbs: list[Image.Image] = []
    for image in images:
        ratio = thumb_width / image.width
        thumb = image.resize((thumb_width, max(1, int(image.height * ratio))), Image.Resampling.LANCZOS)
        thumbs.append(thumb)
    label_h = 24 if label else 0
    width = sum(img.width for img in thumbs)
    height = max(img.height for img in thumbs) + label_h
    canvas = Image.new("RGB", (width, height), (8, 10, 14))
    draw = ImageDraw.Draw(canvas)
    if label:
        draw.text((8, 5), label, fill=(255, 255, 255))
    x = 0
    for image in thumbs:
        canvas.paste(image, (x, label_h))
        x += image.width
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target)
    return target


def active_mask(path: Path) -> np.ndarray:
    arr = np.asarray(Image.open(path).convert("RGB")).astype(np.uint8)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    return gray > 22


def center_of_mask(mask: np.ndarray) -> tuple[float, float] | None:
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    return (float(xs.mean()), float(ys.mean()))


def frame_lifecycle_stats(path: Path, index: int, total: int) -> dict[str, Any]:
    arr = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    gray = cv2.cvtColor(arr.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    mask = gray > 18
    h, w = gray.shape
    mask_pixels = int(mask.sum())
    area = float(mask_pixels / max(w * h, 1))
    brightness = float(gray[mask].sum() / (255.0 * max(w * h, 1))) if np.any(mask) else 0.0
    center = center_of_mask(mask)
    if np.any(mask):
        ys, xs = np.where(mask)
        bbox_w = int(xs.max() - xs.min() + 1)
        bbox_h = int(ys.max() - ys.min() + 1)
        bbox_size = float((bbox_w * bbox_h) / max(w * h, 1))
        bbox = {"x": int(xs.min()), "y": int(ys.min()), "width": bbox_w, "height": bbox_h}
        mask_u8 = (mask.astype(np.uint8) * 255)
        contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        edge_map = cv2.Canny(gray.astype(np.uint8), 36, 112)
        edge_length = float((edge_map > 0).sum() / max(w * h, 1))
        perimeter = float(sum(cv2.arcLength(contour, True) for contour in contours))
        contour_complexity = float(perimeter / max(math.sqrt(mask_pixels), 1.0))
        component_total, _labels, component_stats, _centroids = cv2.connectedComponentsWithStats(mask_u8, 8)
        min_component_area = max(6, int(w * h * 0.00003))
        component_count = int(
            sum(
                1
                for component_index in range(1, component_total)
                if int(component_stats[component_index, cv2.CC_STAT_AREA]) >= min_component_area
            )
        )
        coords = np.column_stack((xs.astype(np.float32), ys.astype(np.float32)))
        if len(coords) >= 2:
            cov = np.cov(coords, rowvar=False)
            values, vectors = np.linalg.eigh(cov)
            principal = vectors[:, int(np.argmax(values))]
            principal_angle = float(math.degrees(math.atan2(float(principal[1]), float(principal[0]))))
        else:
            principal_angle = 0.0
    else:
        bbox_size = 0.0
        bbox = {"x": 0, "y": 0, "width": 0, "height": 0}
        edge_length = 0.0
        contour_complexity = 0.0
        component_count = 0
        principal_angle = 0.0
    return {
        "frameIndex": index,
        "normalizedFrameIndex": round(index / max(total - 1, 1), 4),
        "alphaArea": area,
        "brightnessSum": brightness,
        "bboxSize": bbox_size,
        "bboxWidth": bbox["width"] / max(w, 1),
        "bboxHeight": bbox["height"] / max(h, 1),
        "contourComplexity": contour_complexity,
        "edgeLength": edge_length,
        "componentCount": component_count,
        "center": None if center is None else {"x": center[0] / max(w, 1), "y": center[1] / max(h, 1)},
        "principalDirectionAngle": principal_angle,
        "bbox": bbox,
    }


def normalize_values(values: list[float]) -> list[float]:
    if not values:
        return []
    low = min(values)
    high = max(values)
    if high - low < 1e-8:
        return [0.0 for _ in values]
    return [(value - low) / (high - low) for value in values]


def compute_lifecycle_curve(frame_paths: list[Path]) -> dict[str, Any]:
    stats = [frame_lifecycle_stats(path, index, len(frame_paths)) for index, path in enumerate(frame_paths)]
    raw_metrics = {
        "alphaArea": [float(item["alphaArea"]) for item in stats],
        "brightnessSum": [float(item["brightnessSum"]) for item in stats],
        "bboxSize": [float(item["bboxSize"]) for item in stats],
        "bboxWidth": [float(item["bboxWidth"]) for item in stats],
        "bboxHeight": [float(item["bboxHeight"]) for item in stats],
        "contourComplexity": [float(item["contourComplexity"]) for item in stats],
        "edgeLength": [float(item["edgeLength"]) for item in stats],
        "componentCount": [float(item["componentCount"]) for item in stats],
        "principalDirectionAngle": [float(item["principalDirectionAngle"]) for item in stats],
    }
    centroid_steps: list[float] = []
    previous_center: dict[str, float] | None = None
    for item in stats:
        center = item["center"]
        if previous_center is None or center is None:
            centroid_steps.append(0.0)
        else:
            centroid_steps.append(float(math.dist((previous_center["x"], previous_center["y"]), (center["x"], center["y"]))))
        previous_center = center if center is not None else previous_center
    raw_metrics["centroidMovement"] = centroid_steps

    normalized_metrics = {name: normalize_values(values) for name, values in raw_metrics.items() if name != "principalDirectionAngle"}
    combined = [
        0.20 * normalized_metrics["alphaArea"][index]
        + 0.30 * normalized_metrics["brightnessSum"][index]
        + 0.18 * normalized_metrics["bboxSize"][index]
        + 0.12 * normalized_metrics["contourComplexity"][index]
        + 0.10 * normalized_metrics["edgeLength"][index]
        + 0.10 * normalized_metrics["componentCount"][index]
        for index in range(len(stats))
    ]
    shape_combined = [
        0.30 * normalized_metrics["bboxSize"][index]
        + 0.25 * normalized_metrics["contourComplexity"][index]
        + 0.20 * normalized_metrics["edgeLength"][index]
        + 0.15 * normalized_metrics["componentCount"][index]
        + 0.10 * normalized_metrics["centroidMovement"][index]
        for index in range(len(stats))
    ]
    for index, item in enumerate(stats):
        item["normalized"] = {
            **{name: round(values[index], 4) for name, values in normalized_metrics.items()},
            "combinedIntensity": round(combined[index], 4),
            "shapeEvolution": round(shape_combined[index], 4),
        }
    return {
        "frames": stats,
        "raw": raw_metrics,
        "normalized": {
            **normalized_metrics,
            "combinedIntensity": combined,
            "shapeEvolution": shape_combined,
        },
        "dynamicRange": {
            **{
                name: (float(max(values) - min(values)) if values else 0.0)
                for name, values in raw_metrics.items()
                if name != "principalDirectionAngle"
            },
            "combinedIntensity": float(max(combined) - min(combined)) if combined else 0.0,
            "shapeEvolution": float(max(shape_combined) - min(shape_combined)) if shape_combined else 0.0,
        },
    }


def curve_correlation(a: list[float], b: list[float]) -> float:
    if len(a) < 2 or len(b) < 2:
        return 0.0
    n = min(len(a), len(b))
    aa = np.asarray(a[:n], dtype=np.float32)
    bb = np.asarray(b[:n], dtype=np.float32)
    if float(np.std(aa)) < 1e-6 or float(np.std(bb)) < 1e-6:
        return 0.0
    return float(np.corrcoef(aa, bb)[0, 1])


def angle_diff_degrees(a: float, b: float) -> float:
    return abs((a - b + 90.0) % 180.0 - 90.0)


def vector_angle(vector: tuple[float, float]) -> float | None:
    if abs(vector[0]) < 1e-6 and abs(vector[1]) < 1e-6:
        return None
    return float(math.degrees(math.atan2(vector[1], vector[0])))


def centroid_path_summary(curve: dict[str, Any]) -> dict[str, Any]:
    centers = [frame["center"] for frame in curve["frames"] if frame.get("center")]
    if len(centers) < 2:
        return {"angle": None, "distance": 0.0, "vector": {"x": 0.0, "y": 0.0}}
    first = centers[0]
    last = centers[-1]
    vector_xy = (float(last["x"] - first["x"]), float(last["y"] - first["y"]))
    distance = float(math.dist((first["x"], first["y"]), (last["x"], last["y"])))
    return {
        "angle": vector_angle(vector_xy),
        "distance": distance,
        "vector": {"x": vector_xy[0], "y": vector_xy[1]},
    }


def principal_angle_similarity(template_curve: dict[str, Any], output_curve: dict[str, Any]) -> dict[str, Any]:
    template_angles = template_curve["raw"].get("principalDirectionAngle", [])
    output_angles = output_curve["raw"].get("principalDirectionAngle", [])
    count = min(len(template_angles), len(output_angles))
    if count == 0:
        return {"meanAngleDiff": 180.0, "anglePass": False}
    diffs = [angle_diff_degrees(float(template_angles[i]), float(output_angles[i])) for i in range(count)]
    mean_diff = float(np.mean(diffs))
    return {"meanAngleDiff": round(mean_diff, 4), "anglePass": mean_diff <= 55.0}


def shape_lifecycle_pass(template_curve: dict[str, Any], output_curve: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    template_shape = template_curve["normalized"]["shapeEvolution"]
    output_shape = output_curve["normalized"]["shapeEvolution"]
    shape_corr = curve_correlation(template_shape, output_shape)
    bbox_corr = curve_correlation(template_curve["normalized"]["bboxSize"], output_curve["normalized"]["bboxSize"])
    bbox_width_corr = curve_correlation(template_curve["normalized"]["bboxWidth"], output_curve["normalized"]["bboxWidth"])
    bbox_height_corr = curve_correlation(template_curve["normalized"]["bboxHeight"], output_curve["normalized"]["bboxHeight"])
    contour_corr = curve_correlation(
        template_curve["normalized"]["contourComplexity"],
        output_curve["normalized"]["contourComplexity"],
    )
    edge_corr = curve_correlation(template_curve["normalized"]["edgeLength"], output_curve["normalized"]["edgeLength"])
    component_corr = curve_correlation(
        template_curve["normalized"]["componentCount"],
        output_curve["normalized"]["componentCount"],
    )
    centroid_template = centroid_path_summary(template_curve)
    centroid_output = centroid_path_summary(output_curve)
    if centroid_template["angle"] is None or centroid_output["angle"] is None:
        centroid_angle_diff = 180.0
        centroid_direction_pass = False
    else:
        centroid_angle_diff = angle_diff_degrees(float(centroid_template["angle"]), float(centroid_output["angle"]))
        min_distance = max(0.035, float(centroid_template["distance"]) * 0.18)
        centroid_direction_pass = bool(centroid_angle_diff <= 65.0 and float(centroid_output["distance"]) >= min_distance)
    principal = principal_angle_similarity(template_curve, output_curve)
    output_shape_range = float(output_curve["dynamicRange"]["shapeEvolution"])
    output_bbox_range = float(output_curve["dynamicRange"]["bboxSize"])
    output_contour_range = float(output_curve["dynamicRange"]["contourComplexity"])
    output_component_range = float(output_curve["dynamicRange"]["componentCount"])
    template_intensity = template_curve["normalized"]["combinedIntensity"]
    output_intensity = output_curve["normalized"]["combinedIntensity"]
    intensity_corr = curve_correlation(template_intensity, output_intensity)
    output_brightness_range = float(output_curve["dynamicRange"]["brightnessSum"])
    output_alpha_range = float(output_curve["dynamicRange"]["alphaArea"])
    only_opacity_fade = bool(
        intensity_corr >= 0.55
        and (shape_corr < 0.35 or output_shape_range < 0.18)
        and output_brightness_range > output_bbox_range * 1.4
    )
    peak_index = int(np.argmax(output_shape)) if output_shape else -1
    template_peak = int(np.argmax(template_shape)) if template_shape else -1
    peak_close = peak_index >= 0 and template_peak >= 0 and abs(peak_index - template_peak) <= 2
    bbox_pass = bool(bbox_corr >= 0.35 or (bbox_width_corr >= 0.35 and bbox_height_corr >= 0.25))
    contour_pass = bool(contour_corr >= 0.25 and output_contour_range >= 0.8)
    component_pass = bool(component_corr >= 0.20 and output_component_range >= 1.0)
    shape_pass = bool(
        shape_corr >= 0.35
        and output_shape_range >= 0.22
        and bbox_pass
        and contour_pass
        and component_pass
        and centroid_direction_pass
        and peak_close
        and not only_opacity_fade
    )
    return shape_pass, {
        "shapeCurveCorrelation": round(shape_corr, 4),
        "bboxSizeCorrelation": round(bbox_corr, 4),
        "bboxWidthCorrelation": round(bbox_width_corr, 4),
        "bboxHeightCorrelation": round(bbox_height_corr, 4),
        "contourComplexityCorrelation": round(contour_corr, 4),
        "edgeLengthCorrelation": round(edge_corr, 4),
        "componentCountCorrelation": round(component_corr, 4),
        "intensityCorrelation": round(intensity_corr, 4),
        "outputShapeRange": round(output_shape_range, 4),
        "outputBBoxRange": round(output_bbox_range, 4),
        "outputContourRange": round(output_contour_range, 4),
        "outputComponentRange": round(output_component_range, 4),
        "outputBrightnessRange": round(output_brightness_range, 4),
        "outputAlphaAreaRange": round(output_alpha_range, 4),
        "templatePeakFrame": template_peak,
        "outputPeakFrame": peak_index,
        "peakClose": peak_close,
        "bbox_pass": bbox_pass,
        "contour_pass": contour_pass,
        "component_pass": component_pass,
        "centroid_template": centroid_template,
        "centroid_output": centroid_output,
        "centroidAngleDiff": round(centroid_angle_diff, 4),
        "centroid_direction_pass": centroid_direction_pass,
        "principalDirection": principal,
        "onlyOpacityFade": only_opacity_fade,
        "shapeLifecyclePass": shape_pass,
    }


def apply_lifecycle_envelope(
    frame_paths: list[Path],
    template_curve: dict[str, Any],
    target_dir: Path,
    candidate_id: int,
) -> list[Path]:
    target_dir.mkdir(parents=True, exist_ok=True)
    template_intensity = template_curve["normalized"]["combinedIntensity"]
    if not template_intensity:
        return frame_paths
    result: list[Path] = []
    for index, frame_path in enumerate(frame_paths):
        image = Image.open(frame_path).convert("RGB")
        arr = np.asarray(image).astype(np.float32)
        target = template_intensity[min(index, len(template_intensity) - 1)]
        # Keep a tiny floor so the first/last frames can still show residual sparks,
        # while the middle frames keep the V2V lightning texture and glow.
        factor = 0.08 + 1.18 * float(target)
        arr = np.clip(arr * factor, 0, 255).astype(np.uint8)
        out = target_dir / f"frame_{index:03d}.png"
        Image.fromarray(arr, mode="RGB").save(out)
        result.append(out)
    return result


def write_video_from_frames(frame_paths: list[Path], target: Path, fps: int) -> Path | None:
    if not frame_paths:
        return None
    first = Image.open(frame_paths[0]).convert("RGB")
    size = first.size
    target.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(target), cv2.VideoWriter_fourcc(*"mp4v"), float(fps), size)
    if not writer.isOpened():
        return None
    for frame_path in frame_paths:
        arr = np.asarray(Image.open(frame_path).convert("RGB"))
        writer.write(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR))
    writer.release()
    return target


def draw_curve_chart(
    curves: dict[str, list[float]],
    target: Path,
    title: str,
    size: tuple[int, int] = (900, 320),
) -> Path:
    width, height = size
    margin_l, margin_t, margin_r, margin_b = 58, 40, 24, 42
    plot_w = width - margin_l - margin_r
    plot_h = height - margin_t - margin_b
    canvas = Image.new("RGB", size, (10, 14, 20))
    draw = ImageDraw.Draw(canvas)
    draw.text((margin_l, 12), title, fill=(255, 255, 255))
    draw.rectangle((margin_l, margin_t, margin_l + plot_w, margin_t + plot_h), outline=(80, 95, 120))
    for step in range(1, 4):
        y = margin_t + plot_h - int(plot_h * step / 4)
        draw.line((margin_l, y, margin_l + plot_w, y), fill=(28, 35, 48))
    palette = [(90, 210, 255), (255, 210, 70), (130, 255, 130), (255, 120, 180), (180, 150, 255)]
    for idx, (name, values) in enumerate(curves.items()):
        if not values:
            continue
        points: list[tuple[int, int]] = []
        for i, value in enumerate(values):
            x = margin_l + int(plot_w * i / max(len(values) - 1, 1))
            y = margin_t + plot_h - int(plot_h * max(0.0, min(1.0, value)))
            points.append((x, y))
        color = palette[idx % len(palette)]
        if len(points) > 1:
            draw.line(points, fill=color, width=3)
        for x, y in points:
            draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=color)
        draw.text((margin_l + 10 + idx * 160, height - 26), name, fill=color)
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target)
    return target


def draw_per_frame_lifecycle_comparison(
    template_frames: list[Path],
    candidate_frames: list[Path],
    target: Path,
    label: str,
    thumb_width: int = 150,
) -> Path:
    rows = [
        ("template", template_frames),
        (label, candidate_frames),
    ]
    thumbs_by_row: list[tuple[str, list[Image.Image]]] = []
    for row_label, frames in rows:
        thumbs: list[Image.Image] = []
        for frame in frames:
            image = Image.open(frame).convert("RGB")
            ratio = thumb_width / image.width
            thumbs.append(image.resize((thumb_width, max(1, int(image.height * ratio))), Image.Resampling.LANCZOS))
        thumbs_by_row.append((row_label, thumbs))
    label_w = 92
    row_h = max((thumb.height for _, thumbs in thumbs_by_row for thumb in thumbs), default=80) + 28
    width = label_w + thumb_width * max((len(thumbs) for _, thumbs in thumbs_by_row), default=1)
    height = row_h * len(rows)
    canvas = Image.new("RGB", (width, height), (8, 10, 14))
    draw = ImageDraw.Draw(canvas)
    for row_index, (row_label, thumbs) in enumerate(thumbs_by_row):
        y = row_index * row_h
        draw.text((8, y + 8), row_label, fill=(255, 255, 255))
        for index, thumb in enumerate(thumbs):
            x = label_w + index * thumb_width
            canvas.paste(thumb, (x, y + 24))
            draw.text((x + 4, y + 4), str(index), fill=(180, 210, 255))
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target)
    return target


def dominant_bright_rgb(paths: list[Path]) -> tuple[float, float, float]:
    samples: list[np.ndarray] = []
    for path in paths:
        arr = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
        gray = arr.mean(axis=2)
        threshold = max(35.0, float(np.percentile(gray, 82)))
        mask = gray > threshold
        if np.any(mask):
            samples.append(arr[mask])
    if not samples:
        return (0.0, 0.0, 0.0)
    merged = np.concatenate(samples, axis=0)
    color = merged.mean(axis=0)
    return (float(color[0]), float(color[1]), float(color[2]))


def evaluate_candidate(
    template_frames: list[Path],
    candidate_frames: list[Path],
    template_curve: dict[str, Any],
) -> dict[str, Any]:
    frame_count = min(len(template_frames), len(candidate_frames))
    if frame_count == 0:
        return {
            "lifecycle_pass": False,
            "direction_pass": False,
            "texture_quality": "rough",
            "colorConsistency": False,
            "motionDeviation": 1.0,
            "temporalStability": 0.0,
            "hasArtifacts": True,
            "passed": False,
            "failureReason": "No candidate frames were produced.",
        }

    template_centers: list[tuple[float, float]] = []
    candidate_centers: list[tuple[float, float]] = []
    area_values: list[float] = []
    center_jumps: list[float] = []
    active_fractions: list[float] = []
    edge_densities: list[float] = []

    first_image = Image.open(candidate_frames[0]).convert("RGB")
    diag = math.sqrt(first_image.width**2 + first_image.height**2)
    for index in range(frame_count):
        t_mask = active_mask(template_frames[index])
        candidate_arr = np.asarray(Image.open(candidate_frames[index]).convert("RGB")).astype(np.uint8)
        candidate_gray = cv2.cvtColor(candidate_arr, cv2.COLOR_RGB2GRAY)
        c_mask = candidate_gray > 22
        t_center = center_of_mask(t_mask)
        c_center = center_of_mask(c_mask)
        if t_center and c_center:
            template_centers.append(t_center)
            candidate_centers.append(c_center)
            active_fractions.append(float(c_mask.mean()))
            if len(candidate_centers) > 1:
                prev = candidate_centers[-2]
                center_jumps.append(math.dist(prev, c_center) / max(diag, 1.0))
        area_values.append(float(c_mask.mean()))
        if np.any(c_mask):
            edge_densities.append(float((cv2.Canny(candidate_gray, 38, 120) > 0).sum() / max(c_mask.sum(), 1)))

    if template_centers and candidate_centers:
        deviations = [
            math.dist(template_centers[i], candidate_centers[i]) / max(diag, 1.0)
            for i in range(min(len(template_centers), len(candidate_centers)))
        ]
        motion_deviation = float(sum(deviations) / len(deviations))
    else:
        motion_deviation = 1.0

    if len(area_values) > 1:
        area_std = float(np.std(area_values))
        jump_mean = float(np.mean(center_jumps)) if center_jumps else 0.0
        temporal_stability = max(0.0, min(1.0, 1.0 - area_std * 7.5 - jump_mean * 2.5))
    else:
        temporal_stability = 0.0

    r, g, b = dominant_bright_rgb(candidate_frames[:frame_count])
    green_dominant = bool(g > b * 1.18 and g > r * 1.2 and g > 45)
    color_consistency = bool(b > 70 and not green_dominant and (b >= r * 1.03 or g >= r * 1.08))
    has_artifacts = bool(max(active_fractions or [0.0]) > 0.88)
    direction_pass = motion_deviation < 0.36
    stability_ok = temporal_stability >= 0.28
    output_curve = compute_lifecycle_curve(candidate_frames[:frame_count])
    lifecycle_ok, lifecycle_metrics = shape_lifecycle_pass(template_curve, output_curve)
    edge_density = float(np.mean(edge_densities)) if edge_densities else 0.0
    if color_consistency and edge_density >= 0.055:
        texture_quality = "good"
    elif color_consistency and edge_density >= 0.025:
        texture_quality = "medium"
    else:
        texture_quality = "rough"
    passed = bool(lifecycle_ok and direction_pass and color_consistency and not has_artifacts)
    failure_reasons = []
    if not lifecycle_ok:
        if lifecycle_metrics["onlyOpacityFade"]:
            failure_reasons.append("only opacity/intensity changed; shape evolution did not follow template")
        else:
            failed_parts = [
                name
                for name in ("bbox_pass", "contour_pass", "component_pass", "centroid_direction_pass", "peakClose")
                if not lifecycle_metrics.get(name)
            ]
            failure_reasons.append("shape lifecycle failed: " + ", ".join(failed_parts))
    if not color_consistency:
        failure_reasons.append("not blue-white lightning color")
    if not direction_pass:
        failure_reasons.append(f"motion deviation too high: {motion_deviation:.3f}")
    stability_warning = "" if stability_ok else f"temporal stability low: {temporal_stability:.3f}"
    if has_artifacts:
        failure_reasons.append("active area suggests scene/background artifact")

    return {
        "lifecycle_pass": lifecycle_ok,
        "direction_pass": direction_pass,
        "texture_quality": texture_quality,
        "shapeLifecycleMetrics": lifecycle_metrics,
        "outputLifecycleCurve": output_curve,
        "dominantRgb": [round(r, 2), round(g, 2), round(b, 2)],
        "colorConsistency": color_consistency,
        "greenDominant": green_dominant,
        "edgeDensity": round(edge_density, 4),
        "motionDeviation": round(motion_deviation, 4),
        "temporalStability": round(temporal_stability, 4),
        "hasArtifacts": has_artifacts,
        "motionOk": direction_pass,
        "stabilityOk": stability_ok,
        "stabilityWarning": stability_warning,
        "passed": passed,
        "failureReason": "; ".join(failure_reasons),
    }


def make_comparison_grid(
    template_strip: Path,
    candidate_frame_sets: list[list[Path]],
    out_path: Path,
) -> Path:
    rows: list[Image.Image] = [Image.open(template_strip).convert("RGB")]
    for index, frames in enumerate(candidate_frame_sets):
        if frames:
            strip_path = out_path.parent / "strips" / f"candidate_{index}_strip.png"
            rows.append(Image.open(make_strip(frames, strip_path, label=f"candidate {index}")).convert("RGB"))

    width = max(row.width for row in rows)
    height = sum(row.height for row in rows)
    canvas = Image.new("RGB", (width, height), (8, 10, 14))
    y = 0
    for row in rows:
        canvas.paste(row, (0, y))
        y += row.height
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)
    return out_path


def run_experiment(config: V2VConfig) -> tuple[Path, dict[str, Any]]:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = OUTPUT_ROOT / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)

    summary: dict[str, Any] = {
        "pipeline": PIPELINE,
        "template": "built-in green slash",
        "prompt": PROMPT,
        "negativePrompt": NEGATIVE_PROMPT,
        "modelRoute": "Wan2.1 VACE video-to-video",
        "seed": config.seed,
        "candidateCount": config.candidate_count,
        "resultStatus": "unknown",
        "failureReason": "",
        "config": asdict(config),
        "candidates": [],
    }

    env_ok, env_report = ensure_environment(config, out_dir)
    summary["environment"] = env_report
    if not env_ok:
        summary["resultStatus"] = "fail"
        summary["failureReason"] = env_report.get("failureReason", "Environment unavailable")
        write_json(out_dir / "summary.json", summary)
        append_debug_log(
            "AIFX_GREEN_SLASH_TO_LIGHTNING_V2V_TEST 环境不可用",
            summary["failureReason"],
            f"已写入 {out_dir / 'summary.json'}；未回退到 sprite sheet、本地材质映射或逐帧 img2img。",
            "仅 tools 实验输出；不影响产品主流程。",
        )
        return out_dir, summary

    template_meta = prepare_template_video(config, out_dir)
    summary["templateVideo"] = template_meta["templateVideo"]
    summary["templateMeta"] = template_meta
    template_frames = [Path(path) for path in template_meta["blackFrames"]]
    template_curve = compute_lifecycle_curve(template_frames)
    summary["templateLifecycleCurve"] = template_curve
    write_json(out_dir / "template_intensity_curve.json", template_curve)
    template_curve_chart = draw_curve_chart(
        {"template": template_curve["normalized"]["combinedIntensity"]},
        out_dir / "template_intensity_curve.png",
        "template intensity curve",
    )
    template_shape_chart = draw_curve_chart(
        {
            "bbox": template_curve["normalized"]["bboxSize"],
            "contour": template_curve["normalized"]["contourComplexity"],
            "components": template_curve["normalized"]["componentCount"],
            "shape": template_curve["normalized"]["shapeEvolution"],
        },
        out_dir / "template_shape_evolution_curve.png",
        "template shape evolution curve",
    )
    summary["templateIntensityCurveChart"] = str(template_curve_chart)
    summary["templateShapeEvolutionCurveChart"] = str(template_shape_chart)
    summary["videoToVideoLifecycleControl"] = {
        "wanVaceStrengthScheduleAvailable": False,
        "temporalSmoothingControlAvailable": False,
        "note": (
            "Current WanVaceToVideo node exposes no per-frame strength schedule or "
            "temporal smoothing parameter. This shape lifecycle validation uses raw "
            "V2V frames only and does not apply opacity/brightness envelope correction."
        ),
    }
    workflows: dict[str, Any] = {}
    candidate_frame_sets: list[list[Path]] = []
    all_curve_values: dict[str, list[float]] = {"template shape": template_curve["normalized"]["shapeEvolution"]}
    pass_count = 0

    for candidate_id in range(config.candidate_count):
        seed = config.seed + candidate_id
        prefix = f"{PIPELINE}_{timestamp}/candidate_{candidate_id}"
        workflow = build_workflow(config, Path(template_meta["templateVideo"]), seed, prefix)
        workflows[f"candidate_{candidate_id}"] = workflow
        if candidate_id == 0:
            write_json(out_dir / "workflow.json", workflow)
        write_json(out_dir / "workflows" / f"candidate_{candidate_id}.json", workflow)

        print(f"[run] candidate={candidate_id} seed={seed}", flush=True)
        started = time.time()
        prompt_id = queue_workflow(config, workflow)
        history = wait_for_prompt(config, prompt_id)
        outputs = collect_outputs(config, history, out_dir, candidate_id)
        raw_frame_paths = [Path(path) for path in outputs["videoExtractedFrames"] or outputs["frames"]]
        raw_curve = compute_lifecycle_curve(raw_frame_paths)
        candidate_frame_sets.append(raw_frame_paths)
        metrics = evaluate_candidate(template_frames, raw_frame_paths, template_curve)
        all_curve_values[f"candidate {candidate_id}"] = raw_curve["normalized"]["shapeEvolution"]
        candidate_curve_chart = draw_curve_chart(
            {
                "template bbox": template_curve["normalized"]["bboxSize"],
                "output bbox": raw_curve["normalized"]["bboxSize"],
                "template contour": template_curve["normalized"]["contourComplexity"],
                "output contour": raw_curve["normalized"]["contourComplexity"],
                "template components": template_curve["normalized"]["componentCount"],
                "output components": raw_curve["normalized"]["componentCount"],
            },
            out_dir / "curves" / f"candidate_{candidate_id}_shape_evolution_curve.png",
            f"candidate {candidate_id} shape evolution curve",
        )
        frame_compare = draw_per_frame_lifecycle_comparison(
            template_frames,
            raw_frame_paths,
            out_dir / "frame_comparisons" / f"candidate_{candidate_id}_frames.png",
            f"candidate {candidate_id}",
        )
        write_json(
            out_dir / "curves" / f"candidate_{candidate_id}_lifecycle.json",
            {"rawV2V": raw_curve},
        )
        if metrics["passed"]:
            pass_count += 1
        summary["candidates"].append(
            {
                "id": candidate_id,
                "seed": seed,
                "promptId": prompt_id,
                "elapsedSeconds": round(time.time() - started, 2),
                "rawVideoPath": outputs.get("video"),
                "lifecycleVideoPath": None,
                "rawFrameCount": len(raw_frame_paths),
                "frameCount": len(raw_frame_paths),
                "rawFrames": [str(path) for path in raw_frame_paths],
                "frames": [str(path) for path in raw_frame_paths],
                "intensityCurveChart": str(candidate_curve_chart),
                "frameComparison": str(frame_compare),
                "metrics": metrics,
            }
        )
        write_json(out_dir / "summary.partial.json", summary)

    write_json(out_dir / "all_workflows.json", workflows)
    comparison = make_comparison_grid(Path(template_meta["templateStrip"]), candidate_frame_sets, out_dir / "comparison_grid.png")
    all_curves_chart = draw_curve_chart(all_curve_values, out_dir / "output_shape_evolution_curves.png", "template vs output shape evolution curves")
    summary["comparisonGrid"] = str(comparison)
    summary["outputShapeEvolutionCurvesChart"] = str(all_curves_chart)
    summary["passCount"] = pass_count
    summary["failCount"] = config.candidate_count - pass_count
    summary["lifecycle_pass"] = any(candidate["metrics"]["lifecycle_pass"] for candidate in summary["candidates"])
    summary["shape_lifecycle_pass"] = summary["lifecycle_pass"]
    summary["direction_pass"] = any(candidate["metrics"]["direction_pass"] for candidate in summary["candidates"])
    texture_rank = {"rough": 0, "medium": 1, "good": 2}
    best_texture = max(
        (candidate["metrics"]["texture_quality"] for candidate in summary["candidates"]),
        key=lambda value: texture_rank.get(value, 0),
        default="rough",
    )
    summary["texture_quality"] = best_texture
    if pass_count >= 1:
        summary["resultStatus"] = "pass"
        summary["failureReason"] = ""
    else:
        summary["resultStatus"] = "fail"
        summary["failureReason"] = (
            "No raw V2V candidate preserved template shape evolution. Current VACE V2V cannot "
            "satisfy the template lifecycle requirement in this environment without external "
            "shape-lifecycle control."
        )

    write_json(out_dir / "summary.json", summary)
    append_debug_log(
        "AIFX_GREEN_SLASH_TO_LIGHTNING_V2V_TEST 形态生命周期验证完成",
        "验证 raw VACE video-to-video 是否能继承模板的 bbox、轮廓复杂度、碎片组件、中心运动和主方向形态演变。",
        (
            f"pipeline={PIPELINE}；candidateCount={config.candidate_count}；"
            f"passCount={pass_count}；resultStatus={summary['resultStatus']}；输出={out_dir}"
        ),
        "仅新增 tools 实验脚本和 debug-output 结果；不改 AI 特效主入口、UI、导出或 Spine。",
    )
    return out_dir, summary


def parse_args() -> V2VConfig:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-base", default="http://127.0.0.1:8188")
    parser.add_argument("--template-dir", default=str(DEFAULT_TEMPLATE_DIR))
    parser.add_argument("--seed", type=int, default=2026050201)
    parser.add_argument("--candidate-count", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=3600)
    parser.add_argument("--width", type=int, default=768)
    parser.add_argument("--height", type=int, default=384)
    parser.add_argument("--fps", type=int, default=12)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--cfg", type=float, default=5.5)
    parser.add_argument("--vace-strength", type=float, default=1.0)
    args = parser.parse_args()
    return V2VConfig(
        comfy_base=args.comfy_base,
        template_dir=args.template_dir,
        seed=args.seed,
        candidate_count=args.candidate_count,
        timeout=args.timeout,
        width=args.width,
        height=args.height,
        fps=args.fps,
        steps=args.steps,
        cfg=args.cfg,
        vace_strength=args.vace_strength,
    )


def main() -> int:
    config = parse_args()
    out_dir, summary = run_experiment(config)
    print(json.dumps({"outputDir": str(out_dir), "resultStatus": summary["resultStatus"]}, ensure_ascii=False, indent=2))
    return 0 if summary["resultStatus"] in {"pass", "fail"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
