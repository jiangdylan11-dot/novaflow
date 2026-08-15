#!/usr/bin/env python3
"""Validate Wan2.1 VACE video-to-video style redesign in ComfyUI.

This script is an experiment-only probe for:
template VFX PNG sequence -> black-background MP4 -> Wan2.1 VACE video-to-video
with red / blue / green / complex reference images.

It intentionally does not touch NovaFlow product UI/runtime code and does not
fallback to sprite sheets, local material transfer, or per-frame img2img.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from aifx_auto_prompt_builder import build_aifx_auto_prompt, run_prompt_builder_selftest


PIPELINE = "AIFX_VIDEO_TO_VIDEO_VACE_VALIDATION"
COMFY_BASE = "http://127.0.0.1:8188"
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEMPLATE_DIR = REPO_ROOT / "particle-editor" / "aifx-v3" / "templates" / "vfx" / "slash_basic" / "source"
OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-vace-video-validation"
LOG_PATH = REPO_ROOT / "logs" / "debug.log"


@dataclass
class ValidationConfig:
    comfy_base: str
    template_dir: str
    width: int = 512
    height: int = 512
    frame_count: int = 9
    fps: int = 12
    seed: int = 421337
    steps: int = 8
    cfg: float = 5.5
    denoise: float = 1.0
    vace_strength: float = 1.0
    sampler_name: str = "uni_pc"
    scheduler: str = "simple"
    diffusion_model: str = "wan2.1_vace_1.3B_fp16.safetensors"
    text_encoder: str = "umt5_xxl_fp8_e4m3fn_scaled.safetensors"
    vae: str = "wan_2.1_vae.safetensors"


def http_json(method: str, url: str, payload: dict[str, Any] | None = None, timeout: int = 30) -> Any:
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read()
    if not body:
        return None
    return json.loads(body.decode("utf-8"))


def get_json(url: str, timeout: int = 30) -> Any:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


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


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def ensure_environment(config: ValidationConfig, out_dir: Path) -> tuple[bool, dict[str, Any]]:
    report: dict[str, Any] = {
        "pipeline": PIPELINE,
        "comfy_base": config.comfy_base,
        "required_nodes": [
            "WanVaceToVideo",
            "UNETLoader",
            "CLIPLoader",
            "CLIPTextEncode",
            "VAELoader",
            "VHS_LoadVideoPath",
            "VHS_LoadImagePath",
            "KSampler",
            "VAEDecode",
            "SaveImage",
            "VHS_VideoCombine",
        ],
        "missing_nodes": [],
        "models": {},
        "environment_status": "unknown",
    }
    try:
        queue = get_json(f"{config.comfy_base}/queue", timeout=8)
        report["queue"] = queue
        object_info = get_json(f"{config.comfy_base}/object_info", timeout=20)
    except Exception as exc:
        report["environment_status"] = "unverifiable"
        report["failure_reason"] = f"ComfyUI API unavailable: {exc!r}"
        write_json(out_dir / "environment.json", report)
        return False, report

    missing = [node for node in report["required_nodes"] if node not in object_info]
    report["missing_nodes"] = missing

    def combo_values(node: str, field: str) -> list[str]:
        try:
            value = object_info[node]["input"]["required"][field][0]
            return list(value)
        except Exception:
            return []

    unets = combo_values("UNETLoader", "unet_name")
    clips = combo_values("CLIPLoader", "clip_name")
    vaes = combo_values("VAELoader", "vae_name")
    report["models"] = {
        "diffusion_model": config.diffusion_model,
        "diffusion_model_available": config.diffusion_model in unets,
        "text_encoder": config.text_encoder,
        "text_encoder_available": config.text_encoder in clips,
        "vae": config.vae,
        "vae_available": config.vae in vaes,
        "available_vace_models": [name for name in unets if "vace" in name.lower()],
        "available_wan_models": [name for name in unets if "wan" in name.lower()][:50],
    }

    ok = (
        not missing
        and report["models"]["diffusion_model_available"]
        and report["models"]["text_encoder_available"]
        and report["models"]["vae_available"]
    )
    report["environment_status"] = "ready" if ok else "unverifiable"
    if not ok:
        report["failure_reason"] = "当前环境不可验证 video-to-video 风格重绘"
    write_json(out_dir / "environment.json", report)
    return ok, report


def composite_on_black(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    rgba = image.convert("RGBA")
    rgba.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 255))
    x = (size[0] - rgba.width) // 2
    y = (size[1] - rgba.height) // 2
    black = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
    composited = Image.alpha_composite(black, rgba)
    canvas.alpha_composite(composited, (x, y))
    return canvas.convert("RGB")


def prepare_template_video(config: ValidationConfig, out_dir: Path) -> dict[str, Any]:
    template_dir = Path(config.template_dir)
    frames = sorted(template_dir.glob("*.png"))
    if len(frames) < config.frame_count:
        raise RuntimeError(f"Template sequence has {len(frames)} PNGs, need {config.frame_count}: {template_dir}")

    input_frames_dir = out_dir / "input_frames_black"
    input_frames_dir.mkdir(parents=True, exist_ok=True)
    rendered: list[Path] = []
    size = (config.width, config.height)
    for index, source in enumerate(frames[: config.frame_count]):
        rgb = composite_on_black(Image.open(source), size)
        target = input_frames_dir / f"frame_{index:03d}.png"
        rgb.save(target)
        rendered.append(target)

    video_path = out_dir / "template_black.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(video_path), fourcc, float(config.fps), size)
    if not writer.isOpened():
        raise RuntimeError("OpenCV VideoWriter failed to open MP4 output")
    for frame in rendered:
        arr = np.array(Image.open(frame).convert("RGB"))
        writer.write(cv2.cvtColor(arr, cv2.COLOR_RGB2BGR))
    writer.release()

    strip = Image.new("RGB", (config.width * config.frame_count, config.height), (0, 0, 0))
    for index, frame in enumerate(rendered):
        strip.paste(Image.open(frame).convert("RGB"), (index * config.width, 0))
    strip_path = out_dir / "template_black_strip.png"
    strip.save(strip_path)

    meta = {
        "template_dir": str(template_dir),
        "source_frame_count": len(frames),
        "used_frame_count": config.frame_count,
        "width": config.width,
        "height": config.height,
        "fps": config.fps,
        "video_path": str(video_path),
        "frame_dir": str(input_frames_dir),
        "strip_path": str(strip_path),
    }
    write_json(out_dir / "input_template_meta.json", meta)
    return meta


def make_reference_images(out_dir: Path, size: int = 512) -> dict[str, Path]:
    refs_dir = out_dir / "references"
    refs_dir.mkdir(parents=True, exist_ok=True)

    refs: dict[str, Image.Image] = {}
    for name, color in {
        "red": (255, 24, 12),
        "blue": (16, 100, 255),
        "green": (22, 235, 80),
    }.items():
        refs[name] = Image.new("RGB", (size, size), color)

    complex_img = Image.new("RGB", (size, size), (3, 4, 10))
    draw = ImageDraw.Draw(complex_img, "RGBA")
    rng = np.random.default_rng(20260501)
    for _ in range(52):
        x = int(rng.integers(40, size - 40))
        y = int(rng.integers(40, size - 40))
        rx = int(rng.integers(8, 42))
        color = tuple(int(v) for v in rng.choice(np.array([[255, 210, 68], [32, 220, 255], [116, 77, 255], [255, 84, 20]])))
        draw.ellipse((x - rx, y - rx, x + rx, y + rx), outline=(*color, 180), width=2)
    for _ in range(30):
        points = []
        x = int(rng.integers(0, size))
        y = int(rng.integers(0, size))
        for _ in range(5):
            x += int(rng.integers(-55, 56))
            y += int(rng.integers(-55, 56))
            points.append((max(0, min(size - 1, x)), max(0, min(size - 1, y))))
        draw.line(points, fill=(255, 210, 70, 170), width=int(rng.integers(1, 4)))
    refs["complex"] = complex_img.filter(ImageFilter.GaussianBlur(0.4))

    paths: dict[str, Path] = {}
    for name, image in refs.items():
        path = refs_dir / f"reference_{name}.png"
        image.save(path)
        paths[name] = path
    return paths


def build_prompt(ref_name: str) -> tuple[str, str]:
    positive = (
        "A stylized game VFX video on a pure black background. "
        "Use the input control video as the motion, direction, rhythm, and silhouette evolution. "
        "Use the reference image as the visual style source for material, color palette, glow behavior, "
        "texture, highlights, edge quality, particles, and energy feeling. "
        "Only VFX energy, no environment, no character, no object. "
        "Keep temporal consistency and smooth frame-to-frame motion."
    )
    negative = (
        "person, human, face, hand, body, character, anime character, girl, boy, weapon, object, "
        "scene, landscape, room, floor, wall, environment, text, logo, border, frame, camera view, "
        "random composition, flicker, jitter, unstable style"
    )
    return positive, negative


def build_workflow(
    config: ValidationConfig,
    video_path: Path,
    reference_path: Path,
    ref_name: str,
    prompt_record: dict[str, Any],
) -> dict[str, Any]:
    positive = prompt_record["positivePrompt"]
    negative = prompt_record["negativePrompt"]
    prefix = f"aifx_vace_validation/{ref_name}/{int(time.time())}"
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
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": positive}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": negative}},
        "6": {
            "class_type": "VHS_LoadVideoPath",
            "inputs": {
                "video": str(video_path),
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
            "class_type": "VHS_LoadImagePath",
            "inputs": {
                "image": str(reference_path),
                "custom_width": config.width,
                "custom_height": config.height,
            },
        },
        "8": {
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
                "reference_image": ["7", 0],
            },
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
                "positive": ["8", 0],
                "negative": ["8", 1],
                "latent_image": ["8", 2],
                "denoise": config.denoise,
            },
        },
        "10": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["3", 0]}},
        "11": {
            "class_type": "SaveImage",
            "inputs": {"images": ["10", 0], "filename_prefix": f"{prefix}/frame"},
        },
        "12": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["10", 0],
                "frame_rate": float(config.fps),
                "loop_count": 0,
                "filename_prefix": f"{prefix}/video",
                "format": "video/h264-mp4",
                "pingpong": False,
                "save_output": True,
            },
        },
    }


def queue_workflow(config: ValidationConfig, workflow: dict[str, Any]) -> str:
    client_id = str(uuid.uuid4())
    response = http_json(
        "POST",
        f"{config.comfy_base}/prompt",
        {"prompt": workflow, "client_id": client_id},
        timeout=60,
    )
    prompt_id = response.get("prompt_id")
    if not prompt_id:
        raise RuntimeError(f"ComfyUI did not return prompt_id: {response}")
    return str(prompt_id)


def wait_for_prompt(config: ValidationConfig, prompt_id: str, timeout_s: int = 1800) -> dict[str, Any]:
    started = time.time()
    last_status = ""
    while time.time() - started < timeout_s:
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


def download_comfy_file(config: ValidationConfig, item: dict[str, Any], target: Path) -> None:
    query = urllib.parse.urlencode(
        {
            "filename": item["filename"],
            "subfolder": item.get("subfolder", ""),
            "type": item.get("type", "output"),
        }
    )
    url = f"{config.comfy_base}/view?{query}"
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=120) as response:
        target.write_bytes(response.read())


def collect_outputs(config: ValidationConfig, history: dict[str, Any], ref_out: Path) -> dict[str, Any]:
    outputs = history.get("outputs", {})
    result: dict[str, Any] = {"frames": [], "videos": [], "raw_outputs": outputs}
    save_outputs = outputs.get("11", {})
    for index, image in enumerate(save_outputs.get("images", [])):
        target = ref_out / "frames" / f"frame_{index:03d}.png"
        download_comfy_file(config, image, target)
        result["frames"].append(str(target))

    video_outputs = outputs.get("12", {})
    for key in ("gifs", "videos", "images"):
        for index, item in enumerate(video_outputs.get(key, [])):
            ext = Path(item.get("filename", f"video_{index}.mp4")).suffix or ".mp4"
            target = ref_out / "videos" / f"output_{index}{ext}"
            download_comfy_file(config, item, target)
            result["videos"].append(str(target))
    return result


def dominant_color(path: Path) -> tuple[float, float, float]:
    arr = np.asarray(Image.open(path).convert("RGB").resize((128, 128), Image.Resampling.BILINEAR)).astype(np.float32)
    lum = arr.mean(axis=2)
    mask = lum > np.percentile(lum, 75)
    if not np.any(mask):
        mask = lum > 5
    if not np.any(mask):
        return (0.0, 0.0, 0.0)
    return tuple(float(v) for v in arr[mask].mean(axis=0))


def color_distance(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return float(math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3))))


def classify_rgb(color: tuple[float, float, float]) -> str:
    r, g, b = color
    if r >= g * 1.2 and r >= b * 1.2 and r >= 35:
        return "red"
    if g >= r * 1.2 and g >= b * 1.2 and g >= 35:
        return "green"
    if b >= r * 1.2 and b >= g * 1.2 and b >= 35:
        return "blue"
    return "ambiguous"


def color_spread(colors: list[tuple[float, float, float]]) -> float:
    if len(colors) < 2:
        return 0.0
    distances = []
    for i in range(len(colors)):
        for j in range(i + 1, len(colors)):
            distances.append(color_distance(colors[i], colors[j]))
    return max(distances) if distances else 0.0


def make_comparison(out_dir: Path, refs: dict[str, Path], results: dict[str, dict[str, Any]]) -> Path | None:
    thumbs: list[tuple[str, Image.Image]] = []
    for name, path in refs.items():
        ref_thumb = Image.open(path).convert("RGB").resize((192, 192), Image.Resampling.LANCZOS)
        thumbs.append((f"{name} ref", ref_thumb))
        frames = results.get(name, {}).get("frames") or []
        if frames:
            output_thumb = Image.open(frames[min(4, len(frames) - 1)]).convert("RGB").resize((192, 192), Image.Resampling.LANCZOS)
        else:
            output_thumb = Image.new("RGB", (192, 192), (20, 20, 20))
            ImageDraw.Draw(output_thumb).text((20, 86), "no output", fill=(255, 90, 90))
        thumbs.append((f"{name} output", output_thumb))
    if not thumbs:
        return None
    w = 192 * 2
    h = 228 * len(refs)
    canvas = Image.new("RGB", (w, h), (8, 10, 14))
    draw = ImageDraw.Draw(canvas)
    for row, name in enumerate(refs.keys()):
        ref_label, ref_img = thumbs[row * 2]
        out_label, out_img = thumbs[row * 2 + 1]
        y = row * 228
        canvas.paste(ref_img, (0, y + 28))
        canvas.paste(out_img, (192, y + 28))
        draw.text((8, y + 8), ref_label, fill=(220, 230, 255))
        draw.text((200, y + 8), out_label, fill=(220, 230, 255))
    path = out_dir / "comparison_refs_outputs.png"
    canvas.save(path)
    return path


def evaluate_results(
    refs: dict[str, Path],
    results: dict[str, dict[str, Any]],
    config: ValidationConfig,
    prompt_records: dict[str, dict[str, Any]],
    prompt_test_report: dict[str, Any],
) -> dict[str, Any]:
    evaluation: dict[str, Any] = {
        "pipeline": PIPELINE,
        "criteria": [
            "风格明显跟随参考图",
            "动作方向接近模板",
            "帧间不抖",
            "不出现人物/场景",
        ],
        "refs": {},
        "overall": "unknown",
    }
    passed = True
    output_colors_for_primary_refs: list[tuple[float, float, float]] = []
    primary_ref_classes: dict[str, str] = {}
    for name, ref_path in refs.items():
        result = results.get(name, {})
        frames = [Path(p) for p in result.get("frames", [])]
        ref_color = dominant_color(ref_path)
        if frames:
            out_color = dominant_color(frames[min(4, len(frames) - 1)])
            distance = color_distance(ref_color, out_color)
        else:
            out_color = (0.0, 0.0, 0.0)
            distance = 999.0
        ref_eval = {
            "output_frame_count": len(frames),
            "expected_frame_count": config.frame_count,
            "videos": result.get("videos", []),
            "reference_dominant_rgb": ref_color,
            "output_dominant_rgb": out_color,
            "output_color_class": classify_rgb(out_color),
            "color_distance": distance,
            "automated_result": "pass_basic_output" if len(frames) >= config.frame_count else "fail_no_full_sequence",
            "manual_review_needed": "材质/纹理/人物场景/抖动需要看 comparison 和视频人工确认",
        }
        if name in {"red", "blue", "green"}:
            expected_class = name
            actual_class = classify_rgb(out_color)
            primary_ref_classes[name] = actual_class
            output_colors_for_primary_refs.append(out_color)
            ref_eval["expected_color_class"] = expected_class
            ref_eval["color_consistency_pass"] = actual_class == expected_class
            if actual_class != expected_class:
                passed = False
        if len(frames) < config.frame_count:
            passed = False
        evaluation["refs"][name] = ref_eval
    spread = color_spread(output_colors_for_primary_refs)
    distinct_classes = {value for value in primary_ref_classes.values() if value != "ambiguous"}
    color_consistency_pass = (
        primary_ref_classes.get("red") == "red"
        and primary_ref_classes.get("blue") == "blue"
        and primary_ref_classes.get("green") == "green"
        and spread >= 80
        and len(distinct_classes) == 3
    )
    evaluation["color_consistency"] = {
        "required": True,
        "expected": {"red": "red", "blue": "blue", "green": "green"},
        "actual": primary_ref_classes,
        "max_pairwise_rgb_distance": spread,
        "pass": color_consistency_pass,
        "failure_conclusion": None if color_consistency_pass else "Wan2.1 VACE 在当前环境下风格控制失败",
    }
    if not color_consistency_pass:
        passed = False
    prompt_builder_correct = prompt_test_report.get("status") == "pass"
    vace_execution_failed = any(
        result.get("status") != "completed" or len(result.get("frames", [])) == 0
        for result in results.values()
    )
    vace_ignored_prompt_or_reference = (
        prompt_builder_correct
        and not vace_execution_failed
        and not color_consistency_pass
    )
    evaluation["prompt_builder_validation"] = {
        "status": prompt_test_report.get("status"),
        "checks": prompt_test_report.get("checks", {}),
        "per_reference": {
            name: {
                "inferredEffectType": record.get("inferredEffectType"),
                "confidence": record.get("confidence"),
                "styleTags": record.get("styleTags", []),
            }
            for name, record in prompt_records.items()
        },
    }
    evaluation["failure_breakdown"] = {
        "promptBuilderCorrect": prompt_builder_correct,
        "vaceExecutionFailed": vace_execution_failed,
        "vaceIgnoredPromptOrReference": vace_ignored_prompt_or_reference,
        "conclusion": (
            "prompt builder failed"
            if not prompt_builder_correct
            else "VACE execution failed"
            if vace_execution_failed
            else "VACE ignored prompt/reference"
            if vace_ignored_prompt_or_reference
            else "needs manual review"
        ),
    }
    evaluation["overall"] = "needs_manual_review" if passed else "failed"
    return evaluation


def run_validation(args: argparse.Namespace) -> int:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = OUTPUT_ROOT / stamp
    out_dir.mkdir(parents=True, exist_ok=True)
    config = ValidationConfig(comfy_base=args.comfy_base, template_dir=str(args.template_dir))
    write_json(out_dir / "config.json", asdict(config))

    env_ok, env_report = ensure_environment(config, out_dir)
    if not env_ok:
        summary = {
            "pipeline": PIPELINE,
            "status": "environment_unverifiable",
            "message": "当前环境不可验证 video-to-video 风格重绘",
            "environment": env_report,
        }
        write_json(out_dir / "summary.json", summary)
        append_debug_log(
            "VACE video-to-video 能力验证无法执行",
            summary["message"],
            f"已停止 sprite sheet/AnimateDiff/IPAdapter 验证，仅记录 {PIPELINE} 环境缺失。",
            "仅 debug-output 与 logs/debug.log；不影响 AI 特效入口/UI/runtime。",
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 2

    template_meta = prepare_template_video(config, out_dir)
    refs = make_reference_images(out_dir)
    prompt_test_report = run_prompt_builder_selftest(out_dir)
    results: dict[str, dict[str, Any]] = {}
    workflows: dict[str, str] = {}
    prompt_records: dict[str, dict[str, Any]] = {}

    for ref_name, reference_path in refs.items():
        ref_out = out_dir / "runs" / ref_name
        ref_out.mkdir(parents=True, exist_ok=True)
        prompt_record = build_aifx_auto_prompt(reference_path, template_video_info=template_meta)
        prompt_records[ref_name] = prompt_record
        write_json(ref_out / "prompt_builder.json", prompt_record)
        workflow = build_workflow(config, Path(template_meta["video_path"]), reference_path, ref_name, prompt_record)
        workflow_path = ref_out / "workflow.json"
        write_json(workflow_path, workflow)
        workflows[ref_name] = str(workflow_path)

        print(f"[run] pipeline={PIPELINE} ref={ref_name} seed={config.seed}", flush=True)
        try:
            prompt_id = queue_workflow(config, workflow)
            history = wait_for_prompt(config, prompt_id, timeout_s=args.timeout)
            write_json(ref_out / "history.json", history)
            status = history.get("status", {})
            if status.get("status_str") != "success" or not status.get("completed", False):
                results[ref_name] = {
                    "status": "failed",
                    "prompt_id": prompt_id,
                    "failure_reason": status,
                    "frames": [],
                    "videos": [],
                }
                continue
            collected = collect_outputs(config, history, ref_out)
            collected["status"] = "completed"
            collected["prompt_id"] = prompt_id
            results[ref_name] = collected
        except Exception as exc:
            results[ref_name] = {
                "status": "failed",
                "failure_reason": repr(exc),
                "frames": [],
                "videos": [],
            }
            write_json(ref_out / "error.json", results[ref_name])

    comparison = make_comparison(out_dir, refs, results)
    evaluation = evaluate_results(refs, results, config, prompt_records, prompt_test_report)
    summary = {
        "pipeline": PIPELINE,
        "status": evaluation["overall"],
        "comfyuiRunCount": len(refs),
        "workflow": {
            "checkpoint": config.diffusion_model,
            "style_node": "WanVaceToVideo reference_image",
            "video_to_video_node": "WanVaceToVideo",
            "seed": config.seed,
            "steps": config.steps,
            "cfg": config.cfg,
            "denoise": config.denoise,
            "vace_strength": config.vace_strength,
            "width": config.width,
            "height": config.height,
            "frame_count": config.frame_count,
            "fps": config.fps,
        },
        "template": template_meta,
        "references": {name: str(path) for name, path in refs.items()},
        "promptTestReport": prompt_test_report,
        "promptBuilder": prompt_records,
        "workflows": workflows,
        "results": results,
        "evaluation": evaluation,
        "comparison": str(comparison) if comparison else None,
    }
    write_json(out_dir / "summary.json", summary)

    append_debug_log(
        "切换到 Wan2.1 VACE video-to-video 能力验证",
        "sprite sheet + IPAdapter + AnimateDiff 路线已停止，当前只验证 VACE 是否能做序列级风格重绘。",
        f"执行 {PIPELINE}；checkpoint={config.diffusion_model}；refs=red/blue/green/complex；status={evaluation['overall']}。",
        "仅新增验证脚本、debug-output、logs/debug.log 与外部 ComfyUI 模型文件；不修改 AI 特效主入口和 UI。",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2)[:12000])
    print(f"\nSUMMARY={out_dir / 'summary.json'}")
    return 0 if evaluation["overall"] != "failed" else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-base", default=COMFY_BASE)
    parser.add_argument("--template-dir", type=Path, default=DEFAULT_TEMPLATE_DIR)
    parser.add_argument("--timeout", type=int, default=1800)
    args = parser.parse_args()
    try:
        return run_validation(args)
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        append_debug_log(
            "VACE video-to-video 能力验证异常中断",
            repr(exc),
            "没有回退到任何旧路线；保留异常信息供下一步定位。",
            "仅验证脚本和 debug 日志。",
        )
        raise


if __name__ == "__main__":
    raise SystemExit(main())
