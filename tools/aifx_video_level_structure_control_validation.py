#!/usr/bin/env python3
"""Validate video-level structure control for NovaFlow AI VFX.

Pipeline:
1. Built-in green slash PNG sequence -> black input video.
2. Input video frames -> continuous edge/canny/lineart control videos.
3. Wan VACE video generation consumes the control video as a whole sequence.
4. Prompt requests a blue-white lightning slash.
5. Output videos are extracted back to PNG frames for comparison.

This is a tools-only validation. It does not modify the AI effects product
entry, does not use per-frame txt2img, does not use per-frame ControlNet, and
does not fall back to sprite/material/img2img routes.
"""

from __future__ import annotations

import argparse
import json
import time
import traceback
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw

from aifx_green_slash_lightning_v2v_test import (
    DEFAULT_TEMPLATE_DIR,
    LOG_PATH,
    V2VConfig,
    build_workflow,
    collect_outputs,
    compute_lifecycle_curve,
    draw_curve_chart,
    ensure_environment,
    evaluate_candidate,
    make_strip,
    prepare_template_video,
    queue_workflow,
    wait_for_prompt,
    write_json,
)


PIPELINE = "AIFX_VIDEO_LEVEL_STRUCTURE_CONTROL_PIPELINE"
REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-video-level-structure-control"
PROMPT = (
    "A blue-white lightning energy slash VFX following the continuous structure control video, "
    "branching lightning, jagged forks, sharp electric edges, high frequency electric patterns, "
    "strong blue-white glow, electric particles, high contrast, clean black background, VFX only, "
    "no character, no human, no scene, no object, no text. Preserve the video-level motion timing, "
    "curved slash trajectory, expansion, fragmentation, sparks, trailing particles, and dissipation "
    "from the control video."
)
NEGATIVE_PROMPT = (
    "person, human, face, hand, body, character, object, weapon, scene, landscape, room, floor, wall, "
    "text, logo, frame, border, realistic background, single still image, per-frame flicker, "
    "blurry blob, flat color fill, green energy, yellow default energy, unrelated composition"
)
TEXTURE_RANK = {"rough": 0, "medium": 1, "good": 2}


@dataclass
class Config:
    comfy_base: str = "http://127.0.0.1:8188"
    template_dir: str = str(DEFAULT_TEMPLATE_DIR)
    width: int = 768
    height: int = 384
    fps: int = 12
    frame_count: int = 9
    seed: int = 2026050601
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
    control_type: str = "canny"


def to_v2v_config(config: Config) -> V2VConfig:
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


def append_debug_log(status: str, reason: str, detail: str, impact: str) -> None:
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


def write_mp4(frame_paths: list[Path], target: Path, fps: int) -> Path:
    if not frame_paths:
        raise RuntimeError(f"No frames for video: {target}")
    first = Image.open(frame_paths[0]).convert("RGB")
    target.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(target), cv2.VideoWriter_fourcc(*"mp4v"), float(fps), first.size)
    if not writer.isOpened():
        raise RuntimeError(f"OpenCV VideoWriter failed: {target}")
    for frame_path in frame_paths:
        image = Image.open(frame_path).convert("RGB").resize(first.size, Image.Resampling.LANCZOS)
        writer.write(cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR))
    writer.release()
    return target


def make_control_frame(image: Image.Image, control_type: str) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    if control_type == "lineart":
        edges = cv2.Canny(gray, 36, 112)
        edges = cv2.dilate(edges, np.ones((2, 2), np.uint8), iterations=1)
        line = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 17, -6)
        result = np.maximum(edges, line)
    elif control_type == "edge":
        edges = cv2.Canny(gray, 24, 96)
        result = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
        result = cv2.GaussianBlur(result, (3, 3), 0)
    else:
        result = cv2.Canny(gray, 48, 144)
        result = cv2.dilate(result, np.ones((2, 2), np.uint8), iterations=1)
    result_rgb = np.stack([result, result, result], axis=2)
    return Image.fromarray(result_rgb.astype(np.uint8), "RGB")


def build_control_videos(template_meta: dict[str, Any], out_dir: Path, fps: int) -> dict[str, Any]:
    frame_paths = [Path(path) for path in template_meta["blackFrames"]]
    control_root = out_dir / "control_videos"
    result: dict[str, Any] = {"frames": {}, "videos": {}}
    for control_type in ("edge", "canny", "lineart"):
        frame_dir = control_root / f"{control_type}_frames"
        frame_dir.mkdir(parents=True, exist_ok=True)
        control_frames: list[Path] = []
        for index, frame_path in enumerate(frame_paths):
            control = make_control_frame(Image.open(frame_path), control_type)
            target = frame_dir / f"frame_{index:03d}.png"
            control.save(target)
            control_frames.append(target)
        video_path = write_mp4(control_frames, control_root / f"control_{control_type}.mp4", fps)
        strip_path = make_strip(control_frames, control_root / f"control_{control_type}_strip.png", label=f"control {control_type}")
        result["frames"][control_type] = [str(path) for path in control_frames]
        result["videos"][control_type] = str(video_path)
        result[f"{control_type}Strip"] = str(strip_path)
    return result


def build_video_level_workflow(config: Config, control_video: Path, seed: int, prefix: str) -> dict[str, Any]:
    v2v_config = to_v2v_config(config)
    workflow = build_workflow(v2v_config, control_video, seed, prefix)
    workflow["4"]["inputs"]["text"] = PROMPT
    workflow["5"]["inputs"]["text"] = NEGATIVE_PROMPT
    workflow["7"]["inputs"]["strength"] = float(config.vace_strength)
    return workflow


def run_candidate(
    config: Config,
    control_video: Path,
    out_dir: Path,
    timestamp: str,
    candidate_id: int,
) -> dict[str, Any]:
    v2v_config = to_v2v_config(config)
    seed = config.seed + candidate_id
    prefix = f"{PIPELINE}_{timestamp}/candidate_{candidate_id}"
    workflow = build_video_level_workflow(config, control_video, seed, prefix)
    workflow_dir = out_dir / "workflows"
    workflow_dir.mkdir(parents=True, exist_ok=True)
    workflow_path = workflow_dir / f"candidate_{candidate_id}.json"
    write_json(workflow_path, workflow)
    if candidate_id == 0:
        write_json(out_dir / "workflow.json", workflow)

    print(f"[{PIPELINE}] candidate={candidate_id} seed={seed} controlVideo={control_video}", flush=True)
    started = time.time()
    prompt_id = queue_workflow(v2v_config, workflow)
    history = wait_for_prompt(v2v_config, prompt_id)
    outputs = collect_outputs(v2v_config, history, out_dir, candidate_id)
    frame_paths = [Path(path) for path in outputs["videoExtractedFrames"] or outputs["frames"]]
    return {
        "id": candidate_id,
        "seed": seed,
        "promptId": prompt_id,
        "workflow": str(workflow_path),
        "elapsedSeconds": round(time.time() - started, 2),
        "videoPath": outputs.get("video"),
        "framePaths": [str(path) for path in frame_paths],
        "rawOutputs": outputs.get("rawOutputs"),
    }


def make_comparison_grid(template_strip: Path, control_strip: Path, candidates: list[dict[str, Any]], target: Path) -> Path:
    rows: list[tuple[str, Image.Image]] = [
        ("template", Image.open(template_strip).convert("RGB")),
        ("control video", Image.open(control_strip).convert("RGB")),
    ]
    for candidate in candidates:
        frames = [Path(path) for path in candidate.get("framePaths", []) if Path(path).exists()]
        if frames:
            strip = make_strip(frames, target.parent / f"candidate_{candidate['id']}_strip.png", label=f"candidate {candidate['id']}")
            rows.append((f"candidate {candidate['id']}", Image.open(strip).convert("RGB")))
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


def evaluate_video_level_candidate(template_frames: list[Path], candidate: dict[str, Any], template_curve: dict[str, Any]) -> dict[str, Any]:
    candidate_frames = [Path(path) for path in candidate.get("framePaths", []) if Path(path).exists()]
    if not candidate_frames:
        return {
            "status": "fail",
            "failureReason": "No generated frames extracted from output video.",
            "temporalConsistency": False,
            "direction_pass": False,
            "style_pass": False,
        }
    curve = compute_lifecycle_curve(candidate_frames)
    metrics = evaluate_candidate(template_frames, candidate_frames, template_curve)
    hues: list[float] = []
    edge_density: list[float] = []
    for frame in candidate_frames:
        rgb = np.asarray(Image.open(frame).convert("RGB"))
        hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
        value = hsv[:, :, 2]
        mask = value > max(35, int(np.mean(value) + np.std(value) * 0.5))
        if np.any(mask):
            hues.append(float(np.mean(hsv[:, :, 0][mask]) * 2.0))
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        edge_density.append(float(np.mean(cv2.Canny(gray, 45, 130) > 0)))
    blue_hue_score = 0.0
    if hues:
        mean_hue = float(np.mean(hues))
        blue_hue_score = max(0.0, 1.0 - abs(((mean_hue - 205.0 + 180.0) % 360.0) - 180.0) / 110.0)
    style_pass = bool(blue_hue_score >= 0.35 and float(np.mean(edge_density or [0])) >= 0.01)
    temporal_consistency = bool(float(metrics.get("shapeLifecycleMetrics", {}).get("shapeCurveCorrelation", 0.0)) >= 0.2)
    usable = bool(metrics.get("direction_pass") and style_pass and not metrics.get("hasArtifacts"))
    metrics.update(
        {
            "style_pass": style_pass,
            "blueHueScore": round(blue_hue_score, 3),
            "meanEdgeDensity": round(float(np.mean(edge_density or [0])), 4),
            "temporalConsistency": temporal_consistency,
            "videoLevelStructureControl": True,
            "perFrameGeneration": False,
        }
    )
    return {
        "status": "pass" if usable else "fail",
        "usable": usable,
        "metrics": metrics,
        "outputLifecycleCurve": curve,
    }


def run_validation(config: Config) -> tuple[Path, dict[str, Any]]:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = OUTPUT_ROOT / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)
    v2v_config = to_v2v_config(config)
    summary: dict[str, Any] = {
        "pipeline": PIPELINE,
        "status": "unknown",
        "resultStatus": "unknown",
        "route": "video-level control video -> Wan VACE video generation -> extracted frames",
        "forbiddenRoutes": [
            "per-frame txt2img",
            "per-frame ControlNet",
            "single-frame independent seed",
            "sprite sheet",
            "material transfer",
            "img2img repaint fallback",
        ],
        "prompt": PROMPT,
        "negativePrompt": NEGATIVE_PROMPT,
        "config": asdict(config),
        "candidateCount": config.candidate_count,
        "controlType": config.control_type,
        "comfyuiRunCount": 0,
        "candidates": [],
    }

    env_ok, env_report = ensure_environment(v2v_config, out_dir)
    summary["environment"] = env_report
    summary["environment"]["requiredVideoLevelControl"] = {
        "node": "WanVaceToVideo",
        "input": "control_video",
        "controlInputKind": "continuous video loaded as IMAGE batch",
        "available": "WanVaceToVideo" not in env_report.get("missingNodes", []),
    }
    if not env_ok:
        summary["status"] = "fail"
        summary["resultStatus"] = "environment_unavailable"
        summary["failureReason"] = env_report.get("failureReason", "Required Wan VACE environment unavailable.")
        write_json(out_dir / "summary.json", summary)
        append_debug_log(
            "Video-level structure control 环境不可验证",
            summary["failureReason"],
            f"pipeline={PIPELINE}; output={out_dir}; 未回退旧路线。",
            "仅 tools 验证；不影响产品主入口、UI、导出或 Spine。",
        )
        return out_dir, summary

    template_meta = prepare_template_video(v2v_config, out_dir)
    template_frames = [Path(path) for path in template_meta["blackFrames"]]
    template_curve = compute_lifecycle_curve(template_frames)
    control_assets = build_control_videos(template_meta, out_dir, config.fps)
    selected_control_video = Path(control_assets["videos"][config.control_type])

    summary["templateMeta"] = template_meta
    summary["templateLifecycleCurve"] = template_curve
    summary["controlVideos"] = control_assets
    summary["selectedControlVideo"] = str(selected_control_video)

    candidates: list[dict[str, Any]] = []
    for candidate_id in range(config.candidate_count):
        try:
            candidate = run_candidate(config, selected_control_video, out_dir, timestamp, candidate_id)
            summary["comfyuiRunCount"] += 1
            evaluation = evaluate_video_level_candidate(template_frames, candidate, template_curve)
            candidate.update(evaluation)
            candidates.append(candidate)
            summary["candidates"].append(candidate)
            write_json(out_dir / "summary.partial.json", summary)
        except Exception as exc:
            failure = {
                "id": candidate_id,
                "seed": config.seed + candidate_id,
                "status": "fail",
                "usable": False,
                "failureReason": repr(exc),
                "traceback": traceback.format_exc(),
            }
            summary["candidates"].append(failure)
            write_json(out_dir / "summary.partial.json", summary)
            print(f"[{PIPELINE}] candidate {candidate_id} failed: {exc!r}", flush=True)

    usable = [candidate for candidate in candidates if candidate.get("usable")]
    comparison = make_comparison_grid(
        Path(template_meta["templateStrip"]),
        Path(control_assets[f"{config.control_type}Strip"]),
        candidates,
        out_dir / "comparison_grid.png",
    )
    curve_chart = draw_curve_chart(
        {
            "template": template_curve["normalized"]["shapeEvolution"],
            **{
                f"candidate {candidate['id']}": candidate.get("outputLifecycleCurve", {}).get("normalized", {}).get("shapeEvolution", [])
                for candidate in candidates
            },
        },
        out_dir / "shape_lifecycle_curves.png",
        "video-level structure control lifecycle",
    )
    summary.update(
        {
            "status": "pass" if usable else "fail",
            "resultStatus": "pass" if usable else "fail",
            "passCount": len(usable),
            "failCount": config.candidate_count - len(usable),
            "bestCandidateId": usable[0]["id"] if usable else (candidates[0]["id"] if candidates else None),
            "failureReason": "" if usable else "No candidate satisfied direction/style/artifact checks.",
            "outputs": {
                "summary": str(out_dir / "summary.json"),
                "comparisonGrid": str(comparison),
                "shapeLifecycleCurves": str(curve_chart),
                "templateVideo": template_meta["templateVideo"],
                "selectedControlVideo": str(selected_control_video),
            },
        }
    )
    write_json(out_dir / "summary.json", summary)
    append_debug_log(
        "Video-level structure control 验证完成",
        "停止逐帧结构生成，改为连续 edge/canny/lineart control video 输入整段视频模型。",
        (
            f"pipeline={PIPELINE}; controlType={config.control_type}; "
            f"candidateCount={config.candidate_count}; passCount={len(usable)}; output={out_dir}"
        ),
        "仅新增 tools 验证和 debug-output；不影响 AI 特效产品主入口、lifecycle remix、导出或 Spine。",
    )
    return out_dir, summary


def parse_args() -> Config:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-base", default="http://127.0.0.1:8188")
    parser.add_argument("--template-dir", default=str(DEFAULT_TEMPLATE_DIR))
    parser.add_argument("--width", type=int, default=768)
    parser.add_argument("--height", type=int, default=384)
    parser.add_argument("--fps", type=int, default=12)
    parser.add_argument("--frame-count", type=int, default=9)
    parser.add_argument("--seed", type=int, default=2026050601)
    parser.add_argument("--candidate-count", type=int, default=4)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--cfg", type=float, default=5.5)
    parser.add_argument("--vace-strength", type=float, default=1.0)
    parser.add_argument("--timeout", type=int, default=3600)
    parser.add_argument("--control-type", choices=["edge", "canny", "lineart"], default="canny")
    args = parser.parse_args()
    return Config(
        comfy_base=args.comfy_base,
        template_dir=args.template_dir,
        width=args.width,
        height=args.height,
        fps=args.fps,
        frame_count=args.frame_count,
        seed=args.seed,
        candidate_count=args.candidate_count,
        steps=args.steps,
        cfg=args.cfg,
        vace_strength=args.vace_strength,
        timeout=args.timeout,
        control_type=args.control_type,
    )


def main() -> int:
    out_dir, summary = run_validation(parse_args())
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
