#!/usr/bin/env python3
"""Product bridge for AIFX_SPRITESHEET_CONDITIONED_REGEN_PIPELINE.

The renderer calls this through the 4783 preview runtime server. This script is
the only product path for AI effect generation: template frames are converted to
one control sprite sheet, Qwen Image Edit + Qwen ControlNet Union regenerates a
new sprite sheet, and the result is cut back into PNG sequences.

Template RGB is not used as img2img input. There is no VACE, material-transfer,
per-frame generation, SDXL/IPAdapter, or old sprite-style fallback here.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from aifx_sequence_conditioned_regen_test import (
    REPO_ROOT,
    active_metrics,
    collect_output,
    ensure_environment,
    evaluate_sequence,
    queue_workflow,
    sorted_template_frames,
    upload_image,
    wait_for_prompt,
    write_json,
)
from aifx_spritesheet_conditioned_regen_test import (
    SpriteSheetConfig,
    build_sprite_workflow,
    make_sheet_overview,
    prepare_sprite_sheet,
)


PIPELINE = "AIFX_SPRITESHEET_CONDITIONED_REGEN_PIPELINE"
OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-spritesheet-conditioned-regen-pipeline"
LOG_PATH = REPO_ROOT / "logs" / "debug.log"

DEFAULT_NEGATIVE = (
    "person, human, face, hand, body, character, anime character, girl, boy, "
    "object, weapon, sword, scene, landscape, room, floor, wall, text, logo, "
    "frame, border, realistic background, photo, camera view, UI, poster, "
    "flat color fill, single solid blob, pasted texture, random composition, "
    "inconsistent cells, different style each cell"
)

VARIANT_SPECS = [
    {
        "name": "structured",
        "text": "clear readable VFX structure, coherent slash flow, strong edge topology, balanced glow and internal detail",
    },
    {
        "name": "filament",
        "text": "thin filaments, branching details, sharp high-frequency edge pattern, layered internal streaks",
    },
    {
        "name": "burst_core",
        "text": "bright core burst, high contrast highlights, expanded energy body, visible impact peak",
    },
    {
        "name": "particle_trails",
        "text": "trailing particles, small sparks, dissipating fragments, textured edge breakup",
    },
]


@dataclass
class ProductConfig:
    comfy_base: str = "http://127.0.0.1:8188"
    template_dir: str = ""
    style_reference: str = ""
    inferred_effect_type: str = "energy"
    positive_prompt: str = ""
    negative_prompt: str = ""
    prompt_variants_file: str = ""
    candidate_count: int = 4
    fps: int = 12
    timeout: int = 3600
    seed: int = 2026050181
    max_cell_width: int = 384
    max_cell_height: int = 192
    grid_cols: int = 3
    steps: int = 14
    cfg: float = 3.4
    controlnet_weight: float = 0.58
    qwen_model: str = "qwen_image_edit_2511_fp8mixed.safetensors"
    qwen_lora: str = "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-fp32.safetensors"
    qwen_clip: str = "qwen_2.5_vl_7b_fp8_scaled.safetensors"
    qwen_vae: str = "qwen_image_vae.safetensors"
    controlnet_model: str = "Qwen-Image-InstantX-ControlNet-Union.safetensors"
    controlnet_type: str = "canny/lineart/anime_lineart/mlsd"


def append_debug_log(summary: dict[str, Any]) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M")
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(
            f"\n[{stamp}]\n"
            f"- 问题：AI 特效主生成需要接入已验证的 sprite sheet conditioned regeneration 主线，旧链路必须退出主流程。\n"
            f"- 原因：VACE、lifecycle remix、本地材质映射、逐帧 Qwen、SDXL/IPAdapter 和旧 sprite style transfer 都不能稳定实现语义重构。\n"
            f"- 解决方案：pipeline={PIPELINE}; candidateCount={summary.get('candidateCount')}; "
            f"bestIndex={summary.get('bestCandidateId')}; output={summary.get('outputDir')}; "
            f"frameCount={summary.get('frameCount')}; cell={summary.get('cellWidth')}x{summary.get('cellHeight')}; "
            f"spriteSheet={summary.get('spriteSheetWidth')}x{summary.get('spriteSheetHeight')}.\n"
            f"- 影响范围：仅 AI 特效生成后端桥接和 4783 runtime 调用；不影响 AI 动画、粒子特效、拆图、Spine 或旧验证脚本。\n"
        )


def align16(value: int) -> int:
    return max(16, int(math.ceil(max(1, value) / 16) * 16))


def compute_cell_size(template_dir: Path, max_w: int, max_h: int) -> tuple[int, int, int, int]:
    first = Image.open(sorted_template_frames(template_dir)[0]).convert("RGBA")
    original_w, original_h = first.size
    scale = min(1.0, max_w / max(original_w, 1), max_h / max(original_h, 1))
    cell_w = align16(round(original_w * scale))
    cell_h = align16(round(original_h * scale))
    return original_w, original_h, cell_w, cell_h


def load_prompt_variants(path: str) -> list[dict[str, Any]]:
    if not path:
        return []
    file_path = Path(path)
    if not file_path.exists():
        return []
    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
    except Exception:
        return []
    variants = data.get("promptVariants") if isinstance(data, dict) else data
    return variants if isinstance(variants, list) else []


def build_prompt_variants(config: ProductConfig) -> list[dict[str, str]]:
    provided = load_prompt_variants(config.prompt_variants_file)
    variants: list[dict[str, str]] = []
    effect = (config.inferred_effect_type or "energy").strip() or "energy"
    base = (config.positive_prompt or "").strip()
    if not base:
        base = (
            f"A {effect} game VFX effect following the control sheet motion, "
            "high contrast highlights, clear energy texture, strong glow, VFX only"
        )

    sheet_prefix = (
        "A game VFX sprite sheet. Each cell is one animation frame from the same effect sequence. "
        "Follow the motion and timing from the control sheet. Use the uploaded reference image only as visual style, "
        "material, texture, highlight and energy behavior guidance. Do not copy objects or composition from the reference. "
    )
    sheet_suffix = (
        "Clean black background, game-ready VFX sprite frames, no character, no human, no object, no scene, no text. "
        "The generated cells must form one coherent animation sequence."
    )

    for item in provided:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("promptVariantName") or f"variant_{len(variants)}").strip()
        text = str(item.get("positivePrompt") or item.get("prompt") or item.get("text") or "").strip()
        if text:
            variants.append({"name": name or f"variant_{len(variants)}", "positive": f"{sheet_prefix}{text}. {sheet_suffix}"})

    for spec in VARIANT_SPECS:
        variants.append(
            {
                "name": spec["name"],
                "positive": f"{sheet_prefix}{base}. Variant focus: {spec['text']}. {sheet_suffix}",
            }
        )

    deduped: list[dict[str, str]] = []
    seen = set()
    for item in variants:
        key = (item["name"], item["positive"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped[: max(1, config.candidate_count)]


def make_sprite_config(config: ProductConfig, cell_w: int, cell_h: int) -> SpriteSheetConfig:
    return SpriteSheetConfig(
        comfy_base=config.comfy_base,
        template_dir=config.template_dir,
        cell_width=cell_w,
        cell_height=cell_h,
        grid_cols=config.grid_cols,
        seed=config.seed,
        steps=config.steps,
        cfg=config.cfg,
        controlnet_weight=config.controlnet_weight,
        timeout=config.timeout,
        qwen_model=config.qwen_model,
        qwen_lora=config.qwen_lora,
        qwen_clip=config.qwen_clip,
        qwen_vae=config.qwen_vae,
        controlnet_model=config.controlnet_model,
        controlnet_type=config.controlnet_type,
    )


def extract_and_resize_frames(sheet_path: Path, meta: dict[str, Any], out_dir: Path, original_size: tuple[int, int]) -> list[str]:
    sheet = Image.open(sheet_path).convert("RGB")
    frames_dir = out_dir / "result_frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    frame_paths: list[str] = []
    for rect in meta["frameRects"]:
        crop = sheet.crop((rect["x"], rect["y"], rect["x"] + rect["width"], rect["y"] + rect["height"]))
        if crop.size != original_size:
            crop = crop.resize(original_size, Image.Resampling.LANCZOS)
        path = frames_dir / f"frame_{rect['index']:03d}.png"
        crop.save(path)
        frame_paths.append(str(path))
    return frame_paths


def make_candidate_grid(candidates: list[dict[str, Any]], out_path: Path) -> None:
    thumbs: list[Image.Image] = []
    labels: list[str] = []
    for candidate in candidates:
        frame_paths = [Path(path) for path in candidate.get("resultPngSequence") or []]
        if not frame_paths:
            continue
        frame = Image.open(frame_paths[min(len(frame_paths) // 2, len(frame_paths) - 1)]).convert("RGB")
        frame.thumbnail((256, 128), Image.Resampling.LANCZOS)
        thumbs.append(frame)
        labels.append(f"{candidate.get('id')} {candidate.get('promptVariantName')} score={candidate.get('score')}")
    if not thumbs:
        return
    cols = min(4, len(thumbs))
    rows = math.ceil(len(thumbs) / cols)
    tile_w, tile_h = 280, 168
    canvas = Image.new("RGB", (cols * tile_w, rows * tile_h), (8, 10, 14))
    draw = ImageDraw.Draw(canvas)
    for index, image in enumerate(thumbs):
        x = (index % cols) * tile_w
        y = (index // cols) * tile_h
        canvas.paste(image, (x + (tile_w - image.width) // 2, y + 28 + (128 - image.height) // 2))
        draw.text((x + 8, y + 8), labels[index][:48], fill=(235, 245, 255))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)


def score_candidate(report: dict[str, Any], frame_paths: list[str]) -> float:
    metrics = report.get("metrics") or {}
    area_corr = max(-1.0, min(1.0, float(metrics.get("areaCorrelation") or 0.0)))
    bbox_corr = max(-1.0, min(1.0, float(metrics.get("bboxCorrelation") or 0.0)))
    brightness_corr = max(-1.0, min(1.0, float(metrics.get("brightnessCorrelation") or 0.0)))
    edge_jump = max(0.0, float(metrics.get("edgeComponentJump") or 1.5))
    area_jump = max(0.0, float(metrics.get("outputAreaJump") or 1.0))
    center_distance = max(0.0, float(metrics.get("meanCenterDistance") or 1.0))
    lifecycle = ((area_corr + 1) / 2 * 0.35) + ((bbox_corr + 1) / 2 * 0.25) + ((brightness_corr + 1) / 2 * 0.15)
    stability = max(0.0, 1.0 - min(edge_jump / 1.5, 1.0)) * 0.10 + max(0.0, 1.0 - min(area_jump / 1.0, 1.0)) * 0.10
    direction = max(0.0, 1.0 - min(center_distance / 0.6, 1.0)) * 0.05
    content = 0.0
    if frame_paths:
        active = [active_metrics(Path(path)).get("activeArea", 0.0) for path in frame_paths]
        content = 0.10 if max(active or [0.0]) > 0.005 else 0.0
    return round(max(0.0, min(1.0, lifecycle + stability + direction + content)), 4)


def run_candidate(
    config: ProductConfig,
    sprite_config: SpriteSheetConfig,
    meta: dict[str, Any],
    variant: dict[str, str],
    candidate_id: int,
    original_size: tuple[int, int],
    out_dir: Path,
) -> dict[str, Any]:
    candidate_dir = out_dir / "candidates" / f"candidate_{candidate_id}"
    candidate_dir.mkdir(parents=True, exist_ok=True)
    seed = int(config.seed + candidate_id * 9973)
    control_upload = upload_image(sprite_config, Path(meta["paths"]["controlInputSheet"]), f"{PIPELINE}_{out_dir.name}_control_{candidate_id}.png")
    reference_upload = upload_image(sprite_config, Path(config.style_reference), f"{PIPELINE}_{out_dir.name}_reference_{candidate_id}.png")
    workflow = build_sprite_workflow(sprite_config, control_upload, reference_upload, f"{PIPELINE}_{out_dir.name}_candidate_{candidate_id}")
    workflow["7"]["inputs"]["prompt"] = variant["positive"]
    workflow["8"]["inputs"]["prompt"] = config.negative_prompt.strip() or DEFAULT_NEGATIVE
    workflow["13"]["inputs"]["seed"] = seed
    write_json(candidate_dir / "workflow.json", workflow)

    started = time.time()
    prompt_id = queue_workflow(sprite_config, workflow)
    history = wait_for_prompt(sprite_config, prompt_id)
    generated_sheet = candidate_dir / "generated_sprite_sheet.png"
    output_meta = collect_output(sprite_config, history, generated_sheet)
    generated_frames = extract_and_resize_frames(generated_sheet, meta, candidate_dir, original_size)
    template_metrics = [active_metrics(path) for path in sorted_template_frames(Path(config.template_dir))]
    output_metrics = [active_metrics(Path(path)) for path in generated_frames]
    report = evaluate_sequence(template_metrics, output_metrics)
    score = score_candidate(report, generated_frames)
    sheet_overview = candidate_dir / "sheet_overview.png"
    make_sheet_overview(meta, generated_sheet, sheet_overview)
    write_json(candidate_dir / "temporal_report.json", report)

    candidate = {
        "id": candidate_id,
        "seed": seed,
        "promptVariant": variant["name"],
        "promptVariantName": variant["name"],
        "positivePrompt": variant["positive"],
        "negativePrompt": config.negative_prompt.strip() or DEFAULT_NEGATIVE,
        "inferredEffectType": config.inferred_effect_type,
        "style_semantic_match": "not_scored_in_product_bridge",
        "score": score,
        "usable": bool(score >= 0.35 and len(generated_frames) == meta["frameCount"]),
        "outputPath": str(candidate_dir),
        "outputSpriteSheet": str(generated_sheet),
        "sheetOverview": str(sheet_overview),
        "resultPngSequence": generated_frames,
        "outputMeta": output_meta,
        "elapsedSeconds": round(time.time() - started, 2),
        "metrics": {
            "temporal_consistency_pass": report.get("temporal_consistency_pass"),
            "style_consistency_pass": report.get("style_consistency_pass"),
            "lifecycle_pass": report.get("lifecycle_pass"),
            "failureReason": report.get("failureReason", ""),
            **(report.get("metrics") or {}),
        },
    }
    write_json(candidate_dir / "candidate_summary.json", candidate)
    return candidate


def run_pipeline(config: ProductConfig) -> tuple[Path, dict[str, Any]]:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = OUTPUT_ROOT / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)
    original_w, original_h, cell_w, cell_h = compute_cell_size(
        Path(config.template_dir),
        config.max_cell_width,
        config.max_cell_height,
    )
    sprite_config = make_sprite_config(config, cell_w, cell_h)
    summary: dict[str, Any] = {
        "pipeline": PIPELINE,
        "outputDir": str(out_dir),
        "template": config.template_dir,
        "referenceImage": config.style_reference,
        "inferredEffectType": config.inferred_effect_type,
        "candidateCount": config.candidate_count,
        "config": asdict(config),
        "resultStatus": "unknown",
        "constraints": [
            "main generation path only",
            "template RGB is not used as img2img input",
            "template only creates one control sprite sheet",
            "Qwen generates each full sprite sheet in one run",
            "no VACE, lifecycle remix, material transfer, per-frame Qwen, SDXL/IPAdapter or old sprite style transfer fallback",
        ],
    }

    env_ok, env_report = ensure_environment(sprite_config, out_dir)
    env_report["pipeline"] = PIPELINE
    summary["environment"] = env_report
    if not env_ok:
        summary.update({"resultStatus": "environment_unavailable", "failureReason": env_report.get("failureReason")})
        write_json(out_dir / "summary.json", summary)
        append_debug_log(summary)
        return out_dir, summary

    meta = prepare_sprite_sheet(sprite_config, out_dir)
    variants = build_prompt_variants(config)
    candidates: list[dict[str, Any]] = []
    for candidate_id, variant in enumerate(variants[: config.candidate_count]):
        print(f"[candidate] {candidate_id + 1}/{config.candidate_count} variant={variant['name']}", flush=True)
        try:
            candidate = run_candidate(config, sprite_config, meta, variant, candidate_id, (original_w, original_h), out_dir)
        except Exception as exc:
            candidate = {
                "id": candidate_id,
                "seed": int(config.seed + candidate_id * 9973),
                "promptVariant": variant["name"],
                "promptVariantName": variant["name"],
                "positivePrompt": variant["positive"],
                "negativePrompt": config.negative_prompt.strip() or DEFAULT_NEGATIVE,
                "inferredEffectType": config.inferred_effect_type,
                "score": 0.0,
                "usable": False,
                "outputPath": str(out_dir / "candidates" / f"candidate_{candidate_id}"),
                "resultPngSequence": [],
                "failureReason": repr(exc),
                "metrics": {"failureReason": repr(exc)},
            }
            write_json(Path(candidate["outputPath"]) / "candidate_summary.json", candidate)
        candidates.append(candidate)

    best = max(candidates, key=lambda item: float(item.get("score") or 0.0), default=None)
    grid_path = out_dir / "candidate_grid.png"
    make_candidate_grid(candidates, grid_path)
    has_output = any(candidate.get("resultPngSequence") for candidate in candidates)
    summary.update(
        {
            "frameCount": meta.get("frameCount"),
            "frameRectsCount": len(meta.get("frameRects") or []),
            "originalWidth": original_w,
            "originalHeight": original_h,
            "cellWidth": cell_w,
            "cellHeight": cell_h,
            "spriteSheetWidth": meta.get("spriteSheetWidth"),
            "spriteSheetHeight": meta.get("spriteSheetHeight"),
            "spriteSheetMeta": meta,
            "comfyuiRunCount": len(candidates),
            "candidates": candidates,
            "bestCandidateId": best.get("id") if best else 0,
            "candidateGrid": str(grid_path),
            "resultStatus": "pass" if has_output else "fail",
            "failureReason": "" if has_output else "No candidate frames were generated",
        }
    )
    write_json(out_dir / "summary.json", summary)
    append_debug_log(summary)
    return out_dir, summary


def parse_args() -> ProductConfig:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-base", default="http://127.0.0.1:8188")
    parser.add_argument("--template-dir", required=True)
    parser.add_argument("--style-reference", required=True)
    parser.add_argument("--inferred-effect-type", default="energy")
    parser.add_argument("--positive-prompt", default="")
    parser.add_argument("--negative-prompt", default="")
    parser.add_argument("--prompt-variants-file", default="")
    parser.add_argument("--candidate-count", type=int, default=4)
    parser.add_argument("--fps", type=int, default=12)
    parser.add_argument("--timeout", type=int, default=3600)
    parser.add_argument("--seed", type=int, default=2026050181)
    parser.add_argument("--max-cell-width", type=int, default=384)
    parser.add_argument("--max-cell-height", type=int, default=192)
    parser.add_argument("--grid-cols", type=int, default=3)
    parser.add_argument("--steps", type=int, default=14)
    parser.add_argument("--cfg", type=float, default=3.4)
    parser.add_argument("--controlnet-weight", type=float, default=0.58)
    args = parser.parse_args()
    return ProductConfig(
        comfy_base=args.comfy_base,
        template_dir=args.template_dir,
        style_reference=args.style_reference,
        inferred_effect_type=args.inferred_effect_type,
        positive_prompt=args.positive_prompt,
        negative_prompt=args.negative_prompt,
        prompt_variants_file=args.prompt_variants_file,
        candidate_count=max(1, min(4, int(args.candidate_count))),
        fps=args.fps,
        timeout=args.timeout,
        seed=args.seed,
        max_cell_width=args.max_cell_width,
        max_cell_height=args.max_cell_height,
        grid_cols=args.grid_cols,
        steps=args.steps,
        cfg=args.cfg,
        controlnet_weight=args.controlnet_weight,
    )


def main() -> int:
    config = parse_args()
    out_dir, summary = run_pipeline(config)
    print(
        json.dumps(
            {
                "outputDir": str(out_dir),
                "resultStatus": summary.get("resultStatus"),
                "pipeline": PIPELINE,
                "candidateCount": summary.get("candidateCount"),
                "bestCandidateId": summary.get("bestCandidateId"),
                "failureReason": summary.get("failureReason", ""),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if summary.get("resultStatus") == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
