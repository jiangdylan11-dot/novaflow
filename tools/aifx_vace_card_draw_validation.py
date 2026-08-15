#!/usr/bin/env python3
"""Validate VACE multi-candidate "card draw" generation.

Experiment-only. This script does not modify NovaFlow product UI/runtime code
and does not fallback to sprite sheets, material transfer, or per-frame img2img.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw

from aifx_auto_prompt_builder import build_aifx_auto_prompt
from aifx_vace_video_validation import (
    COMFY_BASE,
    DEFAULT_TEMPLATE_DIR,
    LOG_PATH,
    ValidationConfig,
    build_workflow,
    collect_outputs,
    dominant_color,
    ensure_environment,
    prepare_template_video,
    queue_workflow,
    wait_for_prompt,
    write_json,
)


PIPELINE = "AIFX_VIDEO_TO_VIDEO_CARD_DRAW_VALIDATION"
OUTPUT_ROOT = Path(__file__).resolve().parents[1] / "debug-output" / "aifx-vace-card-draw"


def append_card_log(candidate_count: int, pass_count: int, fail_count: int, conclusion: str, summary_path: Path) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M")
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(
            f"\n[{stamp}]\n"
            f"- 阶段：VACE_CARD_DRAW_VALIDATION\n"
            f"- candidateCount：{candidate_count}\n"
            f"- passCount：{pass_count}\n"
            f"- failCount：{fail_count}\n"
            f"- 结论：{conclusion}；summary={summary_path}\n"
        )


def make_default_reference(out_dir: Path, kind: str = "blue", size: int = 512) -> Path:
    refs_dir = out_dir / "reference"
    refs_dir.mkdir(parents=True, exist_ok=True)
    palettes = {
        "red": ((255, 36, 10), (255, 160, 32), (160, 16, 8)),
        "blue": ((18, 115, 255), (115, 235, 255), (20, 92, 220)),
        "green": ((20, 230, 80), (160, 255, 140), (18, 170, 70)),
        "complex": ((255, 210, 72), (40, 220, 255), (92, 40, 190)),
    }
    base, hot, dark = palettes.get(kind, palettes["blue"])
    image = Image.new("RGB", (size, size), base if kind != "complex" else dark)
    draw = ImageDraw.Draw(image, "RGBA")
    cx, cy = size // 2, size // 2
    for i in range(22):
        angle = i / 22 * math.tau
        length = 140 + (i % 4) * 32
        ex = cx + math.cos(angle) * length
        ey = cy + math.sin(angle) * length
        draw.line((cx, cy, ex, ey), fill=(*hot, 120), width=2 + i % 3)
    for radius, alpha, color in [(190, 55, hot), (105, 88, hot), (44, 215, hot), (17, 255, (255, 255, 255))]:
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(*color, alpha))
    if kind == "complex":
        rng = np.random.default_rng(20260501)
        for _ in range(42):
            x = int(rng.integers(30, size - 30))
            y = int(rng.integers(30, size - 30))
            r = int(rng.integers(6, 34))
            color = tuple(int(v) for v in rng.choice(np.array([base, hot, (255, 84, 20), (116, 77, 255)])))
            draw.ellipse((x - r, y - r, x + r, y + r), outline=(*color, 190), width=2)
    path = refs_dir / f"reference_{kind}.png"
    image.save(path)
    return path


def read_frames(frame_paths: list[Path]) -> list[np.ndarray]:
    frames = []
    for path in frame_paths:
        arr = np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)
        frames.append(arr)
    return frames


def extract_motion_features(frames: list[np.ndarray]) -> dict[str, Any]:
    centers: list[tuple[float, float]] = []
    areas: list[float] = []
    boxes: list[tuple[int, int, int, int] | None] = []
    for frame in frames:
        gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
        threshold = max(0.08, float(np.percentile(gray, 88)) * 0.65)
        mask = gray > threshold
        if not np.any(mask):
            centers.append((frame.shape[1] / 2.0, frame.shape[0] / 2.0))
            areas.append(0.0)
            boxes.append(None)
            continue
        ys, xs = np.nonzero(mask)
        weights = gray[ys, xs] + 0.01
        cx = float((xs * weights).sum() / weights.sum())
        cy = float((ys * weights).sum() / weights.sum())
        centers.append((cx, cy))
        areas.append(float(mask.mean()))
        boxes.append((int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())))
    return {"centers": centers, "areas": areas, "boxes": boxes}


def resample_centers(centers: list[tuple[float, float]], count: int) -> np.ndarray:
    arr = np.asarray(centers, dtype=np.float32)
    if len(arr) == count:
        return arr
    if len(arr) == 0:
        return np.zeros((count, 2), dtype=np.float32)
    src = np.linspace(0.0, 1.0, len(arr))
    dst = np.linspace(0.0, 1.0, count)
    x = np.interp(dst, src, arr[:, 0])
    y = np.interp(dst, src, arr[:, 1])
    return np.stack([x, y], axis=1).astype(np.float32)


def motion_deviation_score(template_frames: list[np.ndarray], candidate_frames: list[np.ndarray]) -> float:
    count = min(max(len(template_frames), 1), max(len(candidate_frames), 1), 16)
    tmpl = resample_centers(extract_motion_features(template_frames)["centers"], count)
    cand = resample_centers(extract_motion_features(candidate_frames)["centers"], count)
    h, w = template_frames[0].shape[:2]
    diag = math.sqrt(w * w + h * h)
    return float(np.linalg.norm(tmpl - cand, axis=1).mean() / diag)


def temporal_stability_score(candidate_frames: list[np.ndarray]) -> float:
    if len(candidate_frames) < 3:
        return 0.0
    gray = [cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0 for frame in candidate_frames]
    diffs = [float(np.mean(np.abs(gray[i + 1] - gray[i]))) for i in range(len(gray) - 1)]
    diff_mean = float(np.mean(diffs)) + 1e-6
    diff_cv = float(np.std(diffs) / diff_mean)
    centers = np.asarray(extract_motion_features(candidate_frames)["centers"], dtype=np.float32)
    jumps = np.linalg.norm(np.diff(centers, axis=0), axis=1)
    h, w = candidate_frames[0].shape[:2]
    jump_cv = float(np.std(jumps) / (np.mean(jumps) + 1e-6)) if len(jumps) else 1.0
    raw = 1.0 - min(1.0, diff_cv * 0.55 + jump_cv * 0.25)
    return float(max(0.0, min(1.0, raw)))


def classify_color_for_effect(effect_type: str) -> set[str]:
    if effect_type == "fire":
        return {"red"}
    if effect_type in {"water", "ice", "lightning"}:
        return {"blue"}
    if effect_type == "poison":
        return {"green"}
    if effect_type in {"dark", "smoke"}:
        return {"ambiguous", "blue"}
    return {"red", "blue", "green", "ambiguous"}


def classify_rgb(color: tuple[float, float, float]) -> str:
    r, g, b = color
    if r >= g * 1.2 and r >= b * 1.2 and r >= 35:
        return "red"
    if g >= r * 1.2 and g >= b * 1.2 and g >= 35:
        return "green"
    if b >= r * 1.2 and b >= g * 1.2 and b >= 35:
        return "blue"
    return "ambiguous"


def artifact_heuristic(candidate_frames: list[np.ndarray]) -> tuple[bool, dict[str, Any]]:
    if not candidate_frames:
        return True, {"reason": "no_frames"}
    coverage = []
    corner_light = []
    for frame in candidate_frames:
        gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
        mask = gray > 0.12
        coverage.append(float(mask.mean()))
        h, w = gray.shape
        corner = np.concatenate(
            [
                gray[: h // 8, : w // 8].ravel(),
                gray[: h // 8, -w // 8 :].ravel(),
                gray[-h // 8 :, : w // 8].ravel(),
                gray[-h // 8 :, -w // 8 :].ravel(),
            ]
        )
        corner_light.append(float(corner.mean()))
    max_coverage = max(coverage)
    avg_corner_light = float(np.mean(corner_light))
    has_artifacts = max_coverage > 0.58 or avg_corner_light > 0.18
    return has_artifacts, {
        "maxBrightCoverage": max_coverage,
        "averageCornerLight": avg_corner_light,
        "heuristic": "large bright coverage or lit corners suggests scene/object/background pollution",
    }


def candidate_strip(candidate_frames: list[np.ndarray], target: Path, max_frames: int = 8) -> None:
    if not candidate_frames:
        return
    frames = candidate_frames[:max_frames]
    thumbs = [Image.fromarray(frame).resize((160, 160), Image.Resampling.LANCZOS) for frame in frames]
    canvas = Image.new("RGB", (160 * len(thumbs), 160), (0, 0, 0))
    for index, thumb in enumerate(thumbs):
        canvas.paste(thumb, (index * 160, 0))
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target)


def make_comparison_grid(out_dir: Path, candidate_infos: list[dict[str, Any]]) -> Path | None:
    thumbs: list[Image.Image] = []
    labels: list[str] = []
    for info in candidate_infos:
        frames = [Path(p) for p in info.get("frames", [])]
        if not frames:
            continue
        frame = Image.open(frames[min(4, len(frames) - 1)]).convert("RGB").resize((220, 220), Image.Resampling.LANCZOS)
        thumbs.append(frame)
        labels.append(f"id {info['id']} seed {info['seed']} {info['status']}")
    if not thumbs:
        return None
    cols = 2
    rows = math.ceil(len(thumbs) / cols)
    canvas = Image.new("RGB", (cols * 220, rows * 252), (8, 10, 14))
    draw = ImageDraw.Draw(canvas)
    for index, thumb in enumerate(thumbs):
        x = (index % cols) * 220
        y = (index // cols) * 252
        canvas.paste(thumb, (x, y + 24))
        draw.text((x + 6, y + 6), labels[index], fill=(230, 238, 255))
    path = out_dir / "comparison_grid.png"
    canvas.save(path)
    return path


def frame_feature(path: Path) -> np.ndarray:
    image = Image.open(path).convert("RGB").resize((64, 64), Image.Resampling.BILINEAR)
    arr = np.asarray(image, dtype=np.float32) / 255.0
    color_mean = arr.reshape(-1, 3).mean(axis=0)
    color_std = arr.reshape(-1, 3).std(axis=0)
    gray = cv2.cvtColor((arr * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    hist = cv2.calcHist([gray], [0], None, [8], [0, 256]).flatten()
    hist = hist / (hist.sum() + 1e-6)
    return np.concatenate([color_mean, color_std, hist]).astype(np.float32)


def candidate_diversity(results: list[dict[str, Any]]) -> dict[str, Any]:
    features: list[np.ndarray] = []
    ids: list[int] = []
    for info in results:
        frames = [Path(path) for path in info.get("frames", [])]
        if not frames:
            continue
        features.append(frame_feature(frames[min(4, len(frames) - 1)]))
        ids.append(int(info["id"]))
    pairs: list[dict[str, Any]] = []
    for i in range(len(features)):
        for j in range(i + 1, len(features)):
            distance = float(np.linalg.norm(features[i] - features[j]))
            pairs.append({"a": ids[i], "b": ids[j], "distance": distance})
    mean_distance = float(np.mean([item["distance"] for item in pairs])) if pairs else 0.0
    return {
        "meanPairwiseFeatureDistance": mean_distance,
        "pairs": pairs,
        "hasMeaningfulVariation": mean_distance >= 0.12,
        "note": "Feature distance uses mid-frame color mean/std and grayscale histogram; visual review still required.",
    }


def copy_candidate_outputs(collected: dict[str, Any], out_dir: Path, candidate_id: int) -> tuple[list[str], list[str]]:
    frames_dir = out_dir / "frames" / f"candidate_{candidate_id}"
    frames_dir.mkdir(parents=True, exist_ok=True)
    copied_frames: list[str] = []
    for index, frame in enumerate(collected.get("frames", [])):
        src = Path(frame)
        dst = frames_dir / f"frame_{index:03d}.png"
        shutil.copy2(src, dst)
        copied_frames.append(str(dst))

    candidates_dir = out_dir / "candidates"
    candidates_dir.mkdir(parents=True, exist_ok=True)
    copied_videos: list[str] = []
    for index, video in enumerate(collected.get("videos", [])):
        src = Path(video)
        suffix = src.suffix or ".mp4"
        dst = candidates_dir / f"candidate_{candidate_id}{suffix}" if index == 0 else candidates_dir / f"candidate_{candidate_id}_{index}{suffix}"
        shutil.copy2(src, dst)
        copied_videos.append(str(dst))
    return copied_frames, copied_videos


def evaluate_candidate(
    candidate_id: int,
    seed: int,
    frames: list[Path],
    videos: list[str],
    template_frames: list[np.ndarray],
    effect_type: str,
) -> dict[str, Any]:
    candidate_frames = read_frames(frames)
    color = dominant_color(frames[min(4, len(frames) - 1)]) if frames else (0.0, 0.0, 0.0)
    color_class = classify_rgb(color)
    color_consistency = color_class in classify_color_for_effect(effect_type)
    motion_deviation = motion_deviation_score(template_frames, candidate_frames) if candidate_frames else 1.0
    temporal_stability = temporal_stability_score(candidate_frames)
    has_artifacts, artifact_detail = artifact_heuristic(candidate_frames)
    usable = color_consistency and temporal_stability >= 0.45 and motion_deviation <= 0.38 and not has_artifacts
    return {
        "id": candidate_id,
        "seed": seed,
        "status": "pass" if usable else "fail",
        "colorConsistency": color_consistency,
        "outputColorClass": color_class,
        "outputDominantRgb": color,
        "hasArtifacts": has_artifacts,
        "artifactDetail": artifact_detail,
        "motionDeviation": motion_deviation,
        "temporalStability": temporal_stability,
        "frames": [str(path) for path in frames],
        "videos": videos,
    }


def run_validation(args: argparse.Namespace) -> int:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = OUTPUT_ROOT / stamp
    out_dir.mkdir(parents=True, exist_ok=True)

    config = ValidationConfig(
        comfy_base=args.comfy_base,
        template_dir=str(args.template_dir),
        seed=args.base_seed,
    )
    write_json(out_dir / "config.json", asdict(config) | {"candidateCount": args.candidate_count})

    env_ok, env_report = ensure_environment(config, out_dir)
    if not env_ok:
        summary = {
            "pipeline": PIPELINE,
            "overall": "fail",
            "reason": "environment_unverifiable",
            "environment": env_report,
        }
        write_json(out_dir / "summary.json", summary)
        append_card_log(args.candidate_count, 0, args.candidate_count, "environment_unverifiable", out_dir / "summary.json")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 2

    if args.template_video:
        template_video = Path(args.template_video)
        template_meta = {
            "video_path": str(template_video),
            "used_frame_count": config.frame_count,
            "width": config.width,
            "height": config.height,
            "fps": config.fps,
            "source": "provided",
        }
        template_frames_dir = out_dir / "input_frames_black"
        template_frames_dir.mkdir(parents=True, exist_ok=True)
        cap = cv2.VideoCapture(str(template_video))
        index = 0
        while index < config.frame_count:
            ok, frame = cap.read()
            if not ok:
                break
            frame = cv2.resize(frame, (config.width, config.height), interpolation=cv2.INTER_AREA)
            Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)).save(template_frames_dir / f"frame_{index:03d}.png")
            index += 1
        cap.release()
        template_meta["frame_dir"] = str(template_frames_dir)
    else:
        template_meta = prepare_template_video(config, out_dir)
        template_video = Path(template_meta["video_path"])

    if args.reference_image:
        reference_image = Path(args.reference_image)
    else:
        reference_image = make_default_reference(out_dir, args.reference_kind)

    prompt_record = build_aifx_auto_prompt(reference_image, template_video_info=template_meta)
    write_json(out_dir / "auto_prompt.json", prompt_record)

    template_frame_paths = sorted(Path(template_meta["frame_dir"]).glob("*.png"))[: config.frame_count]
    template_frames = read_frames(template_frame_paths)
    results: list[dict[str, Any]] = []

    for candidate_id in range(args.candidate_count):
        seed = args.base_seed + candidate_id
        candidate_config = ValidationConfig(
            comfy_base=args.comfy_base,
            template_dir=str(args.template_dir),
            seed=seed,
            width=config.width,
            height=config.height,
            frame_count=config.frame_count,
            fps=config.fps,
            steps=config.steps,
            cfg=config.cfg,
            denoise=config.denoise,
            vace_strength=config.vace_strength,
            sampler_name=config.sampler_name,
            scheduler=config.scheduler,
            diffusion_model=config.diffusion_model,
            text_encoder=config.text_encoder,
            vae=config.vae,
        )
        run_dir = out_dir / "runs" / f"candidate_{candidate_id}"
        run_dir.mkdir(parents=True, exist_ok=True)
        workflow = build_workflow(
            candidate_config,
            template_video,
            reference_image,
            f"card_draw_candidate_{candidate_id}",
            prompt_record,
        )
        workflow["11"]["inputs"]["filename_prefix"] = f"aifx_vace_card_draw/{stamp}/candidate_{candidate_id}/frame"
        workflow["12"]["inputs"]["filename_prefix"] = f"aifx_vace_card_draw/{stamp}/candidate_{candidate_id}/video"
        write_json(run_dir / "workflow.json", workflow)

        print(f"[run] pipeline={PIPELINE} candidate={candidate_id} seed={seed}", flush=True)
        try:
            prompt_id = queue_workflow(candidate_config, workflow)
            history = wait_for_prompt(candidate_config, prompt_id, timeout_s=args.timeout)
            write_json(run_dir / "history.json", history)
            status = history.get("status", {})
            if status.get("status_str") != "success" or not status.get("completed", False):
                results.append(
                    {
                        "id": candidate_id,
                        "seed": seed,
                        "status": "fail",
                        "colorConsistency": False,
                        "hasArtifacts": True,
                        "motionDeviation": 1.0,
                        "temporalStability": 0.0,
                        "failureReason": status,
                        "frames": [],
                        "videos": [],
                    }
                )
                continue
            collected = collect_outputs(candidate_config, history, run_dir)
            frames, videos = copy_candidate_outputs(collected, out_dir, candidate_id)
            candidate_strip(read_frames([Path(p) for p in frames]), out_dir / "strips" / f"candidate_{candidate_id}.png")
            results.append(
                evaluate_candidate(
                    candidate_id,
                    seed,
                    [Path(p) for p in frames],
                    videos,
                    template_frames,
                    prompt_record["inferredEffectType"],
                )
            )
        except Exception as exc:
            results.append(
                {
                    "id": candidate_id,
                    "seed": seed,
                    "status": "fail",
                    "colorConsistency": False,
                    "hasArtifacts": True,
                    "motionDeviation": 1.0,
                    "temporalStability": 0.0,
                    "failureReason": repr(exc),
                    "frames": [],
                    "videos": [],
                }
            )
            write_json(run_dir / "error.json", results[-1])

    pass_count = sum(1 for item in results if item["status"] == "pass")
    fail_count = len(results) - pass_count
    overall = "pass" if pass_count >= 2 else "partial" if pass_count == 1 else "fail"
    comparison_grid = make_comparison_grid(out_dir, results)
    diversity = candidate_diversity(results)
    summary = {
        "pipeline": PIPELINE,
        "templateVideo": str(template_video),
        "referenceImage": str(reference_image),
        "inferredEffectType": prompt_record["inferredEffectType"],
        "prompt": prompt_record["positivePrompt"],
        "negativePrompt": prompt_record["negativePrompt"],
        "autoPrompt": prompt_record,
        "candidateCount": args.candidate_count,
        "baseSeed": args.base_seed,
        "results": results,
        "candidateDiversity": diversity,
        "overall": overall,
        "comparisonGrid": str(comparison_grid) if comparison_grid else None,
        "thresholds": {
            "temporalStabilityMin": 0.45,
            "motionDeviationMax": 0.38,
            "passCandidatesForOverallPass": 2,
        },
    }
    write_json(out_dir / "summary.json", summary)
    append_card_log(args.candidate_count, pass_count, fail_count, overall, out_dir / "summary.json")
    print(json.dumps(summary, ensure_ascii=False, indent=2)[:12000])
    print(f"\nSUMMARY={out_dir / 'summary.json'}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-base", default=COMFY_BASE)
    parser.add_argument("--template-dir", type=Path, default=DEFAULT_TEMPLATE_DIR)
    parser.add_argument("--template-video", type=Path)
    parser.add_argument("--reference-image", type=Path)
    parser.add_argument("--reference-kind", choices=["red", "blue", "green", "complex"], default="blue")
    parser.add_argument("--candidate-count", type=int, default=4)
    parser.add_argument("--base-seed", type=int, default=730001)
    parser.add_argument("--timeout", type=int, default=3600)
    args = parser.parse_args()
    if args.candidate_count < 1 or args.candidate_count > 8:
        raise SystemExit("--candidate-count must be 1..8")
    return run_validation(args)


if __name__ == "__main__":
    raise SystemExit(main())
