#!/usr/bin/env python3
"""Run the AIFX_GREEN_SLASH_TO_LIGHTNING_TEST ComfyUI experiment.

This is an experiment-only probe. It does not modify NovaFlow product runtime
code, UI, exports, Spine integration, sprite-sheet style transfer, VACE, or any
local material-transfer fallback.
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


PIPELINE = "AIFX_GREEN_SLASH_TO_LIGHTNING_TEST"
PROMPT = (
    "A blue-white lightning energy slash VFX, sharp electric arcs, strong glow, "
    "high contrast, electric particles, clean black background, following the "
    "curved slash structure of the template, VFX only, no character, no human, "
    "no scene, no object, no text."
)
NEGATIVE_PROMPT = (
    "person, human, face, hand, body, character, object, weapon, scene, "
    "landscape, room, floor, wall, text, logo, frame, border, realistic "
    "background, smoke scene, blurry blob, flat color fill."
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
OUTPUT_ROOT = REPO_ROOT / "debug-output" / "aifx-green-slash-lightning-test"
LOG_PATH = REPO_ROOT / "logs" / "debug.log"


@dataclass
class ExperimentConfig:
    comfy_base: str = "http://127.0.0.1:8188"
    template_dir: str = str(DEFAULT_TEMPLATE_DIR)
    checkpoint: str = "动漫SD_v1.5.safetensors"
    controlnet_model: str = "control_v11p_sd15_lineart_fp16.safetensors"
    controlnet_type: str = "lineart-from-template-canny"
    controlnet_weight: float = 0.84
    seed: int = 2026050101
    candidate_count: int = 4
    steps: int = 28
    cfg: float = 8.0
    denoise: float = 1.0
    sampler_name: str = "dpmpp_2m"
    scheduler: str = "karras"
    cell_width: int = 256
    cell_height: int = 128
    grid_cols: int = 3
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


def ensure_environment(config: ExperimentConfig, out_dir: Path) -> tuple[bool, dict[str, Any]]:
    report: dict[str, Any] = {
        "pipeline": PIPELINE,
        "comfy_base": config.comfy_base,
        "required_nodes": [
            "CheckpointLoaderSimple",
            "CLIPTextEncode",
            "ControlNetLoader",
            "ControlNetApplyAdvanced",
            "VHS_LoadImagePath",
            "EmptyLatentImage",
            "KSampler",
            "VAEDecode",
            "SaveImage",
        ],
        "missing_nodes": [],
        "checkpoint": config.checkpoint,
        "controlnetModel": config.controlnet_model,
        "environmentStatus": "unknown",
    }
    try:
        object_info = get_json(f"{config.comfy_base}/object_info", timeout=20)
    except Exception as exc:
        report["environmentStatus"] = "unavailable"
        report["failureReason"] = f"ComfyUI API unavailable: {exc!r}"
        write_json(out_dir / "environment.json", report)
        return False, report

    report["missing_nodes"] = [node for node in report["required_nodes"] if node not in object_info]

    def combo_values(node: str, field: str) -> list[str]:
        try:
            return list(object_info[node]["input"]["required"][field][0])
        except Exception:
            return []

    checkpoints = combo_values("CheckpointLoaderSimple", "ckpt_name")
    controlnets = combo_values("ControlNetLoader", "control_net_name")
    report["checkpointAvailable"] = config.checkpoint in checkpoints
    report["controlnetAvailable"] = config.controlnet_model in controlnets
    report["availableControlNets"] = controlnets
    report["availableCheckpoints"] = checkpoints

    ok = (
        not report["missing_nodes"]
        and report["checkpointAvailable"]
        and report["controlnetAvailable"]
    )
    report["environmentStatus"] = "ready" if ok else "unavailable"
    if not ok:
        report["failureReason"] = "Required ComfyUI nodes or models are missing for ControlNet latent generation."
    write_json(out_dir / "environment.json", report)
    return ok, report


def sorted_pngs(template_dir: Path) -> list[Path]:
    frames = sorted(template_dir.glob("*.png"))
    if not frames:
        raise RuntimeError(f"No PNG frames found in template directory: {template_dir}")
    return frames


def fit_rgba_to_cell(source: Path, cell_size: tuple[int, int]) -> Image.Image:
    src = Image.open(source).convert("RGBA")
    src.thumbnail(cell_size, Image.Resampling.LANCZOS)
    cell = Image.new("RGBA", cell_size, (0, 0, 0, 0))
    x = (cell_size[0] - src.width) // 2
    y = (cell_size[1] - src.height) // 2
    cell.alpha_composite(src, (x, y))
    return cell


def make_structure_from_cell(cell: Image.Image) -> Image.Image:
    rgba = np.asarray(cell.convert("RGBA"))
    rgb = rgba[:, :, :3].astype(np.uint8)
    alpha = rgba[:, :, 3].astype(np.uint8)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    alpha_blur = cv2.GaussianBlur(alpha, (3, 3), 0)
    gray_blur = cv2.GaussianBlur(gray, (3, 3), 0)
    source = np.maximum(gray_blur, alpha_blur)

    edges = cv2.Canny(source, 32, 96)
    kernel = np.ones((2, 2), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=1)

    alpha_mask = (alpha_blur > 10).astype(np.uint8) * 255
    outline = cv2.morphologyEx(alpha_mask, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    lineart = np.maximum(edges, outline)
    lineart = cv2.GaussianBlur(lineart, (3, 3), 0)
    lineart = np.clip(lineart * 1.35, 0, 255).astype(np.uint8)
    return Image.fromarray(lineart, mode="L").convert("RGB")


def prepare_template_assets(config: ExperimentConfig, out_dir: Path) -> dict[str, Any]:
    template_dir = Path(config.template_dir)
    frames = sorted_pngs(template_dir)
    first = Image.open(frames[0]).convert("RGBA")
    original_size = first.size
    grid_cols = config.grid_cols
    grid_rows = math.ceil(len(frames) / grid_cols)
    cell_size = (config.cell_width, config.cell_height)
    sheet_size = (config.cell_width * grid_cols, config.cell_height * grid_rows)

    transparent_sheet = Image.new("RGBA", sheet_size, (0, 0, 0, 0))
    black_preview = Image.new("RGB", sheet_size, (0, 0, 0))
    structure_sheet = Image.new("RGB", sheet_size, (0, 0, 0))
    frame_rects: list[dict[str, int]] = []
    structure_frames = out_dir / "structure_frames"
    template_frames = out_dir / "template_preview_frames"
    structure_frames.mkdir(parents=True, exist_ok=True)
    template_frames.mkdir(parents=True, exist_ok=True)

    for index, frame in enumerate(frames):
        col = index % grid_cols
        row = index // grid_cols
        x = col * config.cell_width
        y = row * config.cell_height
        cell = fit_rgba_to_cell(frame, cell_size)
        transparent_sheet.alpha_composite(cell, (x, y))
        black_cell = Image.new("RGBA", cell_size, (0, 0, 0, 255))
        black_cell.alpha_composite(cell)
        black_preview.paste(black_cell.convert("RGB"), (x, y))

        structure = make_structure_from_cell(cell)
        structure_sheet.paste(structure, (x, y))
        structure.save(structure_frames / f"frame_{index:03d}.png")
        black_cell.convert("RGB").save(template_frames / f"frame_{index:03d}.png")
        frame_rects.append({"index": index, "x": x, "y": y, "width": config.cell_width, "height": config.cell_height})

    transparent_path = out_dir / "template_rgba_sprite_sheet.png"
    preview_path = out_dir / "template_green_slash_preview_sheet.png"
    structure_path = out_dir / "control_structure_lineart_sheet.png"
    transparent_sheet.save(transparent_path)
    black_preview.save(preview_path)
    structure_sheet.save(structure_path)

    metadata = {
        "templateDir": str(template_dir),
        "templateName": "built-in green slash",
        "frameCount": len(frames),
        "originalWidth": original_size[0],
        "originalHeight": original_size[1],
        "cellWidth": config.cell_width,
        "cellHeight": config.cell_height,
        "gridCols": grid_cols,
        "gridRows": grid_rows,
        "spriteSheetWidth": sheet_size[0],
        "spriteSheetHeight": sheet_size[1],
        "frameRects": frame_rects,
        "templatePreviewSheet": str(preview_path),
        "templateRgbaSpriteSheet": str(transparent_path),
        "structureSheet": str(structure_path),
    }
    write_json(out_dir / "template_structure_meta.json", metadata)
    return metadata


def build_workflow(
    config: ExperimentConfig,
    structure_sheet: Path,
    seed: int,
    filename_prefix: str,
) -> dict[str, Any]:
    width = config.cell_width * config.grid_cols
    height = config.cell_height * math.ceil(len(sorted_pngs(Path(config.template_dir))) / config.grid_cols)
    return {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": config.checkpoint},
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["1", 1], "text": PROMPT},
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {"clip": ["1", 1], "text": NEGATIVE_PROMPT},
        },
        "4": {
            "class_type": "ControlNetLoader",
            "inputs": {"control_net_name": config.controlnet_model},
        },
        "5": {
            "class_type": "VHS_LoadImagePath",
            "inputs": {
                "image": str(structure_sheet).replace("\\", "/"),
                "custom_width": width,
                "custom_height": height,
            },
        },
        "6": {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": ["2", 0],
                "negative": ["3", 0],
                "control_net": ["4", 0],
                "image": ["5", 0],
                "strength": config.controlnet_weight,
                "start_percent": 0.0,
                "end_percent": 0.88,
            },
        },
        "7": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
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
                "positive": ["6", 0],
                "negative": ["6", 1],
                "latent_image": ["7", 0],
                "denoise": config.denoise,
            },
        },
        "9": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["8", 0], "vae": ["1", 2]},
        },
        "10": {
            "class_type": "SaveImage",
            "inputs": {"images": ["9", 0], "filename_prefix": filename_prefix},
        },
    }


def queue_workflow(config: ExperimentConfig, workflow: dict[str, Any]) -> str:
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


def wait_for_prompt(config: ExperimentConfig, prompt_id: str) -> dict[str, Any]:
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
        time.sleep(4)
    raise TimeoutError(f"Timed out waiting for ComfyUI prompt {prompt_id}")


def download_comfy_file(config: ExperimentConfig, item: dict[str, Any], target: Path) -> None:
    query = urllib.parse.urlencode(
        {
            "filename": item["filename"],
            "subfolder": item.get("subfolder", ""),
            "type": item.get("type", "output"),
        }
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(f"{config.comfy_base}/view?{query}", timeout=120) as response:
        target.write_bytes(response.read())


def collect_sheet_output(config: ExperimentConfig, history: dict[str, Any], target: Path) -> dict[str, Any]:
    save_outputs = history.get("outputs", {}).get("10", {})
    images = save_outputs.get("images", [])
    if not images:
        raise RuntimeError(f"ComfyUI SaveImage node produced no images: {history.get('outputs', {})}")
    download_comfy_file(config, images[0], target)
    return {"comfyOutput": images[0], "localPath": str(target)}


def cut_candidate_frames(
    sheet_path: Path,
    meta: dict[str, Any],
    out_dir: Path,
    candidate_id: int,
) -> list[str]:
    sheet = Image.open(sheet_path).convert("RGB")
    frames_out = out_dir / "frames" / f"candidate_{candidate_id}"
    frames_out.mkdir(parents=True, exist_ok=True)
    result: list[str] = []
    original_size = (int(meta["originalWidth"]), int(meta["originalHeight"]))
    for rect in meta["frameRects"]:
        crop = sheet.crop((rect["x"], rect["y"], rect["x"] + rect["width"], rect["y"] + rect["height"]))
        target = frames_out / f"frame_{rect['index']:03d}.png"
        crop.resize(original_size, Image.Resampling.LANCZOS).save(target)
        result.append(str(target))
    return result


def mask_from_image(path: Path) -> np.ndarray:
    arr = np.asarray(Image.open(path).convert("RGB")).astype(np.uint8)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    return gray > 20


def analyze_candidate(candidate_path: Path, structure_path: Path, frame_count: int, grid_cols: int) -> dict[str, Any]:
    arr = np.asarray(Image.open(candidate_path).convert("RGB")).astype(np.uint8)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    active = gray > 24
    bright = gray > max(50, int(np.percentile(gray, 82)))

    if np.any(bright):
        dominant = arr[bright].mean(axis=0)
    elif np.any(active):
        dominant = arr[active].mean(axis=0)
    else:
        dominant = np.array([0.0, 0.0, 0.0])

    r, g, b = [float(v) for v in dominant]
    green_dominant = bool(g > b * 1.2 and g > r * 1.25 and g > 50)
    blue_white = bool(b > 70 and not green_dominant and (b >= r * 1.05 or g >= r * 1.1))

    canny = cv2.Canny(gray, 40, 120)
    active_count = int(active.sum())
    edge_density = float((canny > 0).sum() / max(active_count, 1))
    active_fraction = float(active.mean())

    structure = mask_from_image(structure_path)
    dilated_structure = cv2.dilate(structure.astype(np.uint8), np.ones((21, 21), np.uint8), iterations=1) > 0
    overlap_ratio = float((active & dilated_structure).sum() / max(active_count, 1))

    height, width = gray.shape
    rows = math.ceil(frame_count / grid_cols)
    cell_w = width // grid_cols
    cell_h = height // rows
    cell_active: list[float] = []
    for i in range(frame_count):
        x = (i % grid_cols) * cell_w
        y = (i // grid_cols) * cell_h
        cell = active[y : y + cell_h, x : x + cell_w]
        cell_active.append(float(cell.mean()))
    active_cells = int(sum(1 for value in cell_active if value > 0.01))

    # Lightning VFX can legitimately have a large blue glow footprint. Treat it
    # as a flat blob only when it fills most of the sheet or lacks edge detail.
    flat_blob = bool(active_fraction > 0.78 or edge_density < 0.012)
    structure_ok = bool(overlap_ratio > 0.12 and active_cells >= max(3, frame_count // 3))
    lightning_like = bool(blue_white and edge_density >= 0.018 and not flat_blob)
    passed = bool(lightning_like and structure_ok)

    return {
        "dominantRgb": [round(r, 2), round(g, 2), round(b, 2)],
        "blueWhiteColor": blue_white,
        "greenDominant": green_dominant,
        "edgeDensity": round(edge_density, 4),
        "activeFraction": round(active_fraction, 4),
        "structureOverlapRatio": round(overlap_ratio, 4),
        "activeCells": active_cells,
        "flatBlob": flat_blob,
        "structureOk": structure_ok,
        "lightningLike": lightning_like,
        "passed": passed,
    }


def make_comparison_grid(candidate_paths: list[Path], out_path: Path) -> None:
    if not candidate_paths:
        return
    thumbs = [Image.open(path).convert("RGB") for path in candidate_paths]
    max_w = max(img.width for img in thumbs)
    max_h = max(img.height for img in thumbs)
    cols = 2
    rows = math.ceil(len(thumbs) / cols)
    canvas = Image.new("RGB", (max_w * cols, max_h * rows), (8, 10, 14))
    draw = ImageDraw.Draw(canvas)
    for index, img in enumerate(thumbs):
        x = (index % cols) * max_w
        y = (index // cols) * max_h
        canvas.paste(img, (x, y))
        draw.rectangle((x, y, x + max_w - 1, y + max_h - 1), outline=(80, 120, 180), width=2)
        draw.text((x + 12, y + 10), f"candidate {index}", fill=(255, 255, 255))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)


def run_experiment(config: ExperimentConfig) -> tuple[Path, dict[str, Any]]:
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = OUTPUT_ROOT / timestamp
    out_dir.mkdir(parents=True, exist_ok=True)

    summary: dict[str, Any] = {
        "pipeline": PIPELINE,
        "template": "built-in green slash",
        "prompt": PROMPT,
        "negativePrompt": NEGATIVE_PROMPT,
        "controlNetType": config.controlnet_type,
        "controlNetWeight": config.controlnet_weight,
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
            "AIFX_GREEN_SLASH_TO_LIGHTNING_TEST 环境不可用",
            summary["failureReason"],
            f"已写入 {out_dir / 'summary.json'}，未回退到其他 pipeline。",
            "仅 tools 实验输出；不影响产品主流程。",
        )
        return out_dir, summary

    template_meta = prepare_template_assets(config, out_dir)
    summary["templateMeta"] = template_meta
    structure_path = Path(template_meta["structureSheet"])

    workflows: dict[str, Any] = {}
    candidate_paths: list[Path] = []
    pass_count = 0
    for candidate_id in range(config.candidate_count):
        seed = config.seed + candidate_id
        prefix = f"{PIPELINE}_{timestamp}_candidate_{candidate_id}"
        workflow = build_workflow(config, structure_path, seed, prefix)
        workflows[f"candidate_{candidate_id}"] = workflow
        if candidate_id == 0:
            write_json(out_dir / "workflow.json", workflow)
        write_json(out_dir / "workflows" / f"candidate_{candidate_id}.json", workflow)

        print(f"[run] candidate={candidate_id} seed={seed}", flush=True)
        started = time.time()
        prompt_id = queue_workflow(config, workflow)
        history = wait_for_prompt(config, prompt_id)
        sheet_path = out_dir / "candidates" / f"candidate_{candidate_id}.png"
        output_meta = collect_sheet_output(config, history, sheet_path)
        cut_frames = cut_candidate_frames(sheet_path, template_meta, out_dir, candidate_id)
        metrics = analyze_candidate(sheet_path, structure_path, template_meta["frameCount"], config.grid_cols)
        if metrics["passed"]:
            pass_count += 1
        candidate_paths.append(sheet_path)
        summary["candidates"].append(
            {
                "id": candidate_id,
                "seed": seed,
                "promptId": prompt_id,
                "elapsedSeconds": round(time.time() - started, 2),
                "sheetPath": str(sheet_path),
                "frames": cut_frames,
                "outputMeta": output_meta,
                "metrics": metrics,
            }
        )
        write_json(out_dir / "summary.partial.json", summary)

    write_json(out_dir / "all_workflows.json", workflows)
    comparison_path = out_dir / "comparison_candidates.png"
    make_comparison_grid(candidate_paths, comparison_path)
    summary["comparisonGrid"] = str(comparison_path)
    summary["passCount"] = pass_count
    summary["failCount"] = config.candidate_count - pass_count
    if pass_count >= 1:
        summary["resultStatus"] = "pass"
        summary["failureReason"] = ""
    else:
        summary["resultStatus"] = "fail"
        summary["failureReason"] = (
            "No candidate satisfied the automated lightning-slash checks: blue-white color, "
            "sharp edge detail, and structure overlap."
        )

    write_json(out_dir / "summary.json", summary)
    append_debug_log(
        "AIFX_GREEN_SLASH_TO_LIGHTNING_TEST 最小实验完成",
        "验证绿刀模板仅作结构约束，latent + ControlNet 是否能生成雷系刀光候选。",
        (
            f"pipeline={PIPELINE}；candidateCount={config.candidate_count}；"
            f"passCount={pass_count}；resultStatus={summary['resultStatus']}；输出={out_dir}"
        ),
        "仅新增 tools 实验脚本和 debug-output 结果；不改 AI 特效主入口、UI、导出或 Spine。",
    )
    return out_dir, summary


def parse_args() -> ExperimentConfig:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-base", default="http://127.0.0.1:8188")
    parser.add_argument("--template-dir", default=str(DEFAULT_TEMPLATE_DIR))
    parser.add_argument("--checkpoint", default="动漫SD_v1.5.safetensors")
    parser.add_argument("--controlnet-model", default="control_v11p_sd15_lineart_fp16.safetensors")
    parser.add_argument("--controlnet-weight", type=float, default=0.84)
    parser.add_argument("--seed", type=int, default=2026050101)
    parser.add_argument("--candidate-count", type=int, default=4)
    parser.add_argument("--steps", type=int, default=28)
    parser.add_argument("--cfg", type=float, default=8.0)
    parser.add_argument("--timeout", type=int, default=3600)
    args = parser.parse_args()
    return ExperimentConfig(
        comfy_base=args.comfy_base,
        template_dir=args.template_dir,
        checkpoint=args.checkpoint,
        controlnet_model=args.controlnet_model,
        controlnet_weight=args.controlnet_weight,
        seed=args.seed,
        candidate_count=args.candidate_count,
        steps=args.steps,
        cfg=args.cfg,
        timeout=args.timeout,
    )


def main() -> int:
    config = parse_args()
    out_dir, summary = run_experiment(config)
    print(json.dumps({"outputDir": str(out_dir), "resultStatus": summary["resultStatus"]}, ensure_ascii=False, indent=2))
    return 0 if summary["resultStatus"] in {"pass", "fail"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
