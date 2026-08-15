from __future__ import annotations

import argparse
import json
import math
import time
import traceback
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests
from PIL import Image, ImageDraw, ImageFilter, ImageStat


PIPELINE_ID = "AIFX_SEQUENCE_STYLE_REDESIGN_PIPELINE"
COMFY = "http://127.0.0.1:8188"
SEED = 348713245
DENIOSE = 0.42
CONTROL_WEIGHT = 0.72
STYLE_WEIGHT = 1.35
TEMPLATE_DIR = Path("particle-editor/templates/vfx/slash_basic_builtin/source")
COMPLEX_REFERENCE = Path("particle-editor/debug-assets/cloud/cloud.png")
OUT_ROOT = Path("debug-output/aifx-sequence-style-validation")


@dataclass
class WorkflowSpec:
    name: str
    route: str
    workflow: dict[str, Any] | None
    checkpoint: str | None
    controlnet_model: str | None
    style_node: str | None
    ipadapter_model: str | None
    seed: int | None
    denoise: float | None
    control_weight: float | None
    style_weight: float | None
    status: str = "pending"
    failure_reason: str = ""


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def load_object_info() -> dict[str, Any]:
    response = requests.get(f"{COMFY}/object_info", timeout=30)
    response.raise_for_status()
    return response.json()


def node_exists(info: dict[str, Any], name: str) -> bool:
    return name in info


def model_options(info: dict[str, Any], node: str, field: str) -> list[str]:
    try:
        value = info[node]["input"]["required"][field][0]
        return list(value) if isinstance(value, list) else []
    except Exception:
        return []


def pick(options: list[str], preferred: list[str]) -> str | None:
    for item in preferred:
        if item in options:
            return item
    return options[0] if options else None


def prepare_sprite_sheet(out_dir: Path) -> dict[str, Any]:
    frame_paths = sorted(TEMPLATE_DIR.glob("*.png"))
    if not frame_paths:
        raise RuntimeError(f"No template frames found in {TEMPLATE_DIR}")

    frames = [Image.open(path).convert("RGBA") for path in frame_paths]
    width, height = frames[0].size
    cols = math.ceil(math.sqrt(len(frames)))
    rows = math.ceil(len(frames) / cols)
    sheet = Image.new("RGBA", (cols * width, rows * height), (0, 0, 0, 255))
    rects = []
    for index, frame in enumerate(frames):
        x = (index % cols) * width
        y = (index // cols) * height
        bg = Image.new("RGBA", frame.size, (0, 0, 0, 255))
        bg.alpha_composite(frame)
        sheet.paste(bg.convert("RGB"), (x, y))
        rects.append({"index": index, "x": x, "y": y, "width": width, "height": height})

    sheet_path = out_dir / "input_sprite_sheet.png"
    sheet.convert("RGB").save(sheet_path)
    meta = {
        "templateDir": str(TEMPLATE_DIR),
        "frameCount": len(frames),
        "frameWidth": width,
        "frameHeight": height,
        "spriteSheetWidth": sheet.width,
        "spriteSheetHeight": sheet.height,
        "frameRects": rects,
        "sheetPath": str(sheet_path),
    }
    (out_dir / "input_sprite_sheet_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), "utf-8")
    return meta


def make_solid_reference(out_dir: Path, name: str, color: tuple[int, int, int]) -> Path:
    image = Image.new("RGB", (256, 256), color)
    draw = ImageDraw.Draw(image, "RGBA")
    hot = tuple(min(255, int(c * 0.55 + 140)) for c in color)
    draw.ellipse((48, 48, 208, 208), fill=(*hot, 185))
    draw.line((24, 180, 86, 70, 146, 178, 232, 52), fill=(255, 255, 255, 155), width=16)
    draw.line((20, 60, 236, 210), fill=(*hot, 170), width=10)
    path = out_dir / f"reference_{name}.png"
    image.save(path)
    return path


def make_references(out_dir: Path) -> dict[str, Path]:
    refs = {
        "red": make_solid_reference(out_dir, "red", (235, 20, 16)),
        "blue": make_solid_reference(out_dir, "blue", (15, 90, 245)),
        "green": make_solid_reference(out_dir, "green", (20, 220, 75)),
    }
    complex_path = out_dir / "reference_complex.png"
    if COMPLEX_REFERENCE.exists():
        src = Image.open(COMPLEX_REFERENCE).convert("RGBA")
        bbox = src.getbbox()
        crop = src.crop(bbox) if bbox else src
        crop.thumbnail((512, 512), Image.Resampling.LANCZOS)
        bg = Image.new("RGBA", (512, 512), (10, 12, 18, 255))
        bg.alpha_composite(crop, ((512 - crop.width) // 2, (512 - crop.height) // 2))
        bg.convert("RGB").save(complex_path)
    else:
        image = Image.new("RGB", (512, 512), (5, 12, 30))
        draw = ImageDraw.Draw(image, "RGBA")
        for i in range(80):
            x = (i * 47) % 512
            y = (i * 83) % 512
            r = 12 + (i % 7) * 9
            color = (60 + (i * 13) % 160, 120 + (i * 19) % 120, 230, 140)
            draw.ellipse((x - r, y - r, x + r, y + r), fill=color)
        image = image.filter(ImageFilter.GaussianBlur(1.8))
        image.save(complex_path)
    refs["complex"] = complex_path
    return refs


def upload_image(path: Path, name: str) -> str:
    with path.open("rb") as handle:
        files = {"image": (name, handle, "image/png")}
        data = {"type": "input", "overwrite": "true"}
        response = requests.post(f"{COMFY}/upload/image", files=files, data=data, timeout=120)
    response.raise_for_status()
    payload = response.json()
    return payload.get("name") or name


def prompt(workflow: dict[str, Any]) -> str:
    payload = {"prompt": workflow, "client_id": str(uuid.uuid4())}
    response = requests.post(f"{COMFY}/prompt", json=payload, timeout=120)
    if response.status_code >= 400:
        raise RuntimeError(response.text)
    data = response.json()
    if "error" in data:
        raise RuntimeError(json.dumps(data, ensure_ascii=False))
    return data["prompt_id"]


def wait_history(prompt_id: str, timeout: int = 900) -> dict[str, Any]:
    start = time.time()
    while time.time() - start < timeout:
        response = requests.get(f"{COMFY}/history/{prompt_id}", timeout=30)
        response.raise_for_status()
        data = response.json()
        if prompt_id in data:
            return data[prompt_id]
        time.sleep(2)
    raise TimeoutError(f"ComfyUI prompt timed out: {prompt_id}")


def find_output_image(history: dict[str, Any]) -> dict[str, str]:
    outputs = history.get("outputs", {})
    for value in outputs.values():
        images = value.get("images") or []
        if images:
            return images[0]
    raise RuntimeError("No image output found in ComfyUI history")


def download_image(image_info: dict[str, str], dest: Path) -> None:
    query = urlencode(
        {
            "filename": image_info["filename"],
            "subfolder": image_info.get("subfolder", ""),
            "type": image_info.get("type", "output"),
        }
    )
    response = requests.get(f"{COMFY}/view?{query}", timeout=120)
    response.raise_for_status()
    dest.write_bytes(response.content)


def build_a2_workflow(
    sheet_name: str,
    style_name: str,
    out_prefix: str,
    checkpoint: str,
    controlnet: str,
    ipadapter: str,
    clip_vision: str,
) -> dict[str, Any]:
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": sheet_name}},
        "2": {"class_type": "LoadImage", "inputs": {"image": style_name}},
        "3": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["3", 1],
                "text": (
                    "sprite sheet style redesign, game VFX frames, same sprite sheet grid, same motion timing, "
                    "same slash composition, strong reference material, texture, glow, highlights, crisp VFX"
                ),
            },
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["3", 1],
                "text": "person, character, face, hand, object, scene, background, text, logo, random composition, flat color, poster",
            },
        },
        "6": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": controlnet}},
        "7": {"class_type": "SetUnionControlNetType", "inputs": {"control_net": ["6", 0], "type": "canny/lineart/anime_lineart/mlsd"}},
        "8": {"class_type": "CannyEdgePreprocessor", "inputs": {"image": ["1", 0], "low_threshold": 80, "high_threshold": 180, "resolution": 1024}},
        "9": {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": ["4", 0],
                "negative": ["5", 0],
                "control_net": ["7", 0],
                "image": ["8", 0],
                "strength": CONTROL_WEIGHT,
                "start_percent": 0,
                "end_percent": 0.82,
                "vae": ["3", 2],
            },
        },
        "10": {"class_type": "IPAdapterModelLoader", "inputs": {"ipadapter_file": ipadapter}},
        "11": {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": clip_vision}},
        "12": {
            "class_type": "IPAdapterAdvanced",
            "inputs": {
                "model": ["3", 0],
                "ipadapter": ["10", 0],
                "image": ["2", 0],
                "weight": STYLE_WEIGHT,
                "weight_type": "strong style transfer",
                "combine_embeds": "concat",
                "start_at": 0,
                "end_at": 1,
                "embeds_scaling": "K+V",
                "clip_vision": ["11", 0],
            },
        },
        "13": {"class_type": "VAEEncode", "inputs": {"pixels": ["1", 0], "vae": ["3", 2]}},
        "14": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["12", 0],
                "seed": SEED,
                "steps": 20,
                "cfg": 6.5,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "positive": ["9", 0],
                "negative": ["9", 1],
                "latent_image": ["13", 0],
                "denoise": DENIOSE,
            },
        },
        "15": {"class_type": "VAEDecode", "inputs": {"samples": ["14", 0], "vae": ["3", 2]}},
        "16": {"class_type": "SaveImage", "inputs": {"images": ["15", 0], "filename_prefix": out_prefix}},
    }


def build_a3_workflow(
    sheet_name: str,
    style_name: str,
    out_prefix: str,
    checkpoint: str,
    controlnet: str,
    ipadapter: str,
    clip_vision: str,
) -> dict[str, Any]:
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": sheet_name}},
        "2": {"class_type": "LoadImage", "inputs": {"image": style_name}},
        "3": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["3", 1],
                "text": (
                    "sequence-level VFX style redesign, keep the template sequence motion, frame order, silhouette evolution, "
                    "and dynamic rhythm. Redesign the material using the reference image: texture, highlights, glow, surface quality, "
                    "edge style, and contrast. Not recolor, not texture paste."
                ),
            },
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "clip": ["3", 1],
                "text": "person, character, face, body, object, weapon, scene, wall, floor, text, logo, border, unrelated structure, flat blob",
            },
        },
        "6": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": controlnet}},
        "7": {"class_type": "LineArtPreprocessor", "inputs": {"image": ["1", 0], "coarse": "disable", "resolution": 1024}},
        "8": {
            "class_type": "ControlNetApplyAdvanced",
            "inputs": {
                "positive": ["4", 0],
                "negative": ["5", 0],
                "control_net": ["6", 0],
                "image": ["7", 0],
                "strength": CONTROL_WEIGHT,
                "start_percent": 0,
                "end_percent": 0.86,
                "vae": ["3", 2],
            },
        },
        "9": {"class_type": "IPAdapterModelLoader", "inputs": {"ipadapter_file": ipadapter}},
        "10": {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": clip_vision}},
        "11": {
            "class_type": "IPAdapterPreciseStyleTransfer",
            "inputs": {
                "model": ["3", 0],
                "ipadapter": ["9", 0],
                "image": ["2", 0],
                "weight": STYLE_WEIGHT,
                "style_boost": 2.0,
                "combine_embeds": "concat",
                "start_at": 0,
                "end_at": 1,
                "embeds_scaling": "K+V",
                "clip_vision": ["10", 0],
            },
        },
        "12": {"class_type": "VAEEncode", "inputs": {"pixels": ["1", 0], "vae": ["3", 2]}},
        "13": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["11", 0],
                "seed": SEED,
                "steps": 22,
                "cfg": 7,
                "sampler_name": "dpmpp_2m",
                "scheduler": "karras",
                "positive": ["8", 0],
                "negative": ["8", 1],
                "latent_image": ["12", 0],
                "denoise": DENIOSE,
            },
        },
        "14": {"class_type": "VAEDecode", "inputs": {"samples": ["13", 0], "vae": ["3", 2]}},
        "15": {"class_type": "SaveImage", "inputs": {"images": ["14", 0], "filename_prefix": out_prefix}},
    }


def visible_stats(path: Path) -> dict[str, Any]:
    image = Image.open(path).convert("RGB")
    pixels = []
    for r, g, b in image.getdata():
        if max(r, g, b) > 24:
            pixels.append((r, g, b))
    if not pixels:
        return {"samples": 0, "r": 0, "g": 0, "b": 0, "dominant": "none", "detail": 0}
    count = len(pixels)
    r = round(sum(p[0] for p in pixels) / count)
    g = round(sum(p[1] for p in pixels) / count)
    b = round(sum(p[2] for p in pixels) / count)
    dominant = "red" if r >= g and r >= b else "green" if g >= r and g >= b else "blue"
    gray = Image.open(path).convert("L")
    detail = ImageStat.Stat(gray.filter(ImageFilter.FIND_EDGES)).mean[0] / 255
    return {"samples": count, "r": r, "g": g, "b": b, "dominant": dominant, "detail": round(detail, 4)}


def make_comparison(workflow_dir: Path, outputs: dict[str, Path], dest: Path) -> None:
    thumbs = []
    labels = []
    for name in ["red", "blue", "green", "complex"]:
        path = outputs.get(name)
        if path and path.exists():
            image = Image.open(path).convert("RGB")
        else:
            image = Image.new("RGB", (768, 384), (30, 30, 34))
            ImageDraw.Draw(image).text((24, 24), f"{name}: no output", fill=(255, 255, 255))
        image.thumbnail((640, 320), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (660, 370), (12, 14, 20))
        canvas.paste(image, ((660 - image.width) // 2, 28))
        draw = ImageDraw.Draw(canvas)
        draw.text((12, 8), name, fill=(230, 240, 255))
        thumbs.append(canvas)
        labels.append(name)
    grid = Image.new("RGB", (1320, 740), (8, 10, 16))
    for i, thumb in enumerate(thumbs):
        grid.paste(thumb, ((i % 2) * 660, (i // 2) * 370))
    grid.save(dest)


def run_workflow_for_refs(
    spec: WorkflowSpec,
    refs: dict[str, Path],
    sheet_path: Path,
    out_dir: Path,
    builder,
) -> WorkflowSpec:
    workflow_dir = out_dir / spec.name
    ensure_dir(workflow_dir)
    outputs: dict[str, Path] = {}
    stats: dict[str, Any] = {}
    errors: dict[str, str] = {}

    for ref_name, ref_path in refs.items():
        try:
            sheet_upload = upload_image(sheet_path, f"{spec.name}_sheet.png")
            ref_upload = upload_image(ref_path, f"{spec.name}_{ref_name}_ref.png")
            workflow = builder(sheet_upload, ref_upload, f"aifx_seq_validation/{spec.name}_{ref_name}", spec.checkpoint, spec.controlnet_model, spec.ipadapter_model, "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors")
            spec.workflow = workflow
            workflow_path = workflow_dir / f"workflow_{ref_name}.json"
            workflow_path.write_text(json.dumps(workflow, ensure_ascii=False, indent=2), "utf-8")
            prompt_id = prompt(workflow)
            history = wait_history(prompt_id)
            output_info = find_output_image(history)
            output_path = workflow_dir / f"output_{ref_name}.png"
            download_image(output_info, output_path)
            outputs[ref_name] = output_path
            stats[ref_name] = {
                "promptId": prompt_id,
                "outputInfo": output_info,
                "stats": visible_stats(output_path),
            }
        except Exception as exc:
            errors[ref_name] = f"{type(exc).__name__}: {exc}"
            (workflow_dir / f"error_{ref_name}.txt").write_text(traceback.format_exc(), "utf-8")

    comparison_path = workflow_dir / "comparison_4refs.png"
    make_comparison(workflow_dir, outputs, comparison_path)
    color_ok = all(stats.get(name, {}).get("stats", {}).get("dominant") == name for name in ["red", "blue", "green"])
    complex_detail = stats.get("complex", {}).get("stats", {}).get("detail", 0)
    no_errors = not errors
    if no_errors and color_ok and complex_detail >= 0.035:
        spec.status = "success"
        spec.failure_reason = ""
    else:
        spec.status = "failed"
        reasons = []
        if errors:
            reasons.append(f"ComfyUI errors for {', '.join(errors.keys())}")
        if not color_ok:
            reasons.append("red/blue/green references did not produce matching dominant colors")
        if complex_detail < 0.035:
            reasons.append("complex reference did not produce enough texture/detail signal")
        spec.failure_reason = "; ".join(reasons)
    report = {
        "pipeline": PIPELINE_ID,
        "workflow": spec.name,
        "route": spec.route,
        "status": spec.status,
        "failureReason": spec.failure_reason,
        "checkpoint": spec.checkpoint,
        "controlnetModel": spec.controlnet_model,
        "styleNode": spec.style_node,
        "ipadapterModel": spec.ipadapter_model,
        "seed": spec.seed,
        "denoise": spec.denoise,
        "controlNetWeight": spec.control_weight,
        "styleWeight": spec.style_weight,
        "outputs": {name: str(path) for name, path in outputs.items()},
        "stats": stats,
        "errors": errors,
        "comparison": str(comparison_path),
    }
    (workflow_dir / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), "utf-8")
    return spec


def append_debug_log(results: list[dict[str, Any]]) -> None:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = []
    for result in results:
        lines.append(
            "\n"
            f"[{timestamp}]\n"
            f"- 测试路线：{result['route']}\n"
            f"- workflow 名称：{result['workflow']}\n"
            f"- 结果判定：{result['status']}\n"
            f"- 失败原因：{result.get('failureReason') or '无'}\n"
        )
    with Path("logs/debug.log").open("a", encoding="utf-8") as handle:
        handle.write("".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=datetime.now().strftime("%Y%m%d-%H%M%S"))
    args = parser.parse_args()

    run_dir = OUT_ROOT / args.out
    ensure_dir(run_dir)
    info = load_object_info()
    (run_dir / "comfy_object_capability_summary.json").write_text(
        json.dumps(
            {
                "nodeCount": len(info),
                "hasReferenceOnly": node_exists(info, "ReferenceOnly"),
                "hasReferenceLatent": node_exists(info, "ReferenceLatent"),
                "hasAnimateDiff": node_exists(info, "ADE_LoadAnimateDiffModel"),
                "animateDiffModels": model_options(info, "ADE_LoadAnimateDiffModel", "model_name"),
                "checkpoints": model_options(info, "CheckpointLoaderSimple", "ckpt_name"),
                "controlnets": model_options(info, "ControlNetLoader", "control_net_name"),
                "ipadapters": model_options(info, "IPAdapterModelLoader", "ipadapter_file"),
                "clipVision": model_options(info, "CLIPVisionLoader", "clip_name"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        "utf-8",
    )

    sheet_meta = prepare_sprite_sheet(run_dir)
    refs = make_references(run_dir)
    sheet_path = Path(sheet_meta["sheetPath"])

    checkpoints = model_options(info, "CheckpointLoaderSimple", "ckpt_name")
    controlnets = model_options(info, "ControlNetLoader", "control_net_name")
    ipadapters = model_options(info, "IPAdapterModelLoader", "ipadapter_file")
    clip_vision = model_options(info, "CLIPVisionLoader", "clip_name")
    checkpoint = pick(checkpoints, ["动漫SD_v1.5.safetensors", "majicMIX realistic 麦橘写实_v7.safetensors"])
    ipadapter = pick(ipadapters, ["ip-adapter_sd15.safetensors"])
    clip = pick(clip_vision, ["CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors", "clip_vision_h.safetensors"])
    union_control = pick(controlnets, ["controlnet_union_promax.safetensors"])
    lineart_control = pick(controlnets, ["control_v11p_sd15_lineart_fp16.safetensors"])

    results: list[dict[str, Any]] = []

    a1 = {
        "pipeline": PIPELINE_ID,
        "route": "A",
        "workflow": "A1_img2img_controlnet_softedge_referenceonly",
        "status": "environment_unverifiable",
        "failureReason": "ReferenceOnly node is not available in current ComfyUI object_info; not faking this workflow.",
        "checkpoint": checkpoint,
        "controlnetModel": None,
        "styleNode": "ReferenceOnly",
        "ipadapterModel": None,
        "seed": SEED,
        "denoise": DENIOSE,
        "controlNetWeight": CONTROL_WEIGHT,
        "styleWeight": None,
        "spriteSheetWidth": sheet_meta["spriteSheetWidth"],
        "spriteSheetHeight": sheet_meta["spriteSheetHeight"],
        "frameCount": sheet_meta["frameCount"],
    }
    a1_dir = run_dir / a1["workflow"]
    ensure_dir(a1_dir)
    (a1_dir / "environment_unverifiable.json").write_text(json.dumps(a1, ensure_ascii=False, indent=2), "utf-8")
    results.append(a1)

    can_run_a2 = all([checkpoint, union_control, ipadapter, clip]) and all(
        node_exists(info, node)
        for node in ["CannyEdgePreprocessor", "SetUnionControlNetType", "ControlNetApplyAdvanced", "IPAdapterAdvanced"]
    )
    if can_run_a2:
        spec = WorkflowSpec(
            name="A2_img2img_controlnet_canny_ipadapter_style",
            route="A",
            workflow=None,
            checkpoint=checkpoint,
            controlnet_model=union_control,
            style_node="IPAdapterAdvanced strong style transfer",
            ipadapter_model=ipadapter,
            seed=SEED,
            denoise=DENIOSE,
            control_weight=CONTROL_WEIGHT,
            style_weight=STYLE_WEIGHT,
        )
        spec = run_workflow_for_refs(spec, refs, sheet_path, run_dir, build_a2_workflow)
        results.append(json.loads((run_dir / spec.name / "result.json").read_text("utf-8")))
    else:
        result = {
            "pipeline": PIPELINE_ID,
            "route": "A",
            "workflow": "A2_img2img_controlnet_canny_ipadapter_style",
            "status": "environment_unverifiable",
            "failureReason": "Required node/model missing for Canny + IPAdapter style route.",
            "checkpoint": checkpoint,
            "controlnetModel": union_control,
            "styleNode": "IPAdapterAdvanced strong style transfer",
            "ipadapterModel": ipadapter,
            "seed": SEED,
            "denoise": DENIOSE,
            "controlNetWeight": CONTROL_WEIGHT,
            "styleWeight": STYLE_WEIGHT,
        }
        d = run_dir / result["workflow"]
        ensure_dir(d)
        (d / "environment_unverifiable.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), "utf-8")
        results.append(result)

    can_run_a3 = all([checkpoint, lineart_control, ipadapter, clip]) and all(
        node_exists(info, node)
        for node in ["LineArtPreprocessor", "ControlNetApplyAdvanced", "IPAdapterPreciseStyleTransfer"]
    )
    if can_run_a3:
        spec = WorkflowSpec(
            name="A3_img2img_controlnet_lineart_ipadapter_prompt",
            route="A",
            workflow=None,
            checkpoint=checkpoint,
            controlnet_model=lineart_control,
            style_node="IPAdapterPreciseStyleTransfer + strong prompt",
            ipadapter_model=ipadapter,
            seed=SEED,
            denoise=DENIOSE,
            control_weight=CONTROL_WEIGHT,
            style_weight=STYLE_WEIGHT,
        )
        spec = run_workflow_for_refs(spec, refs, sheet_path, run_dir, build_a3_workflow)
        results.append(json.loads((run_dir / spec.name / "result.json").read_text("utf-8")))
    else:
        result = {
            "pipeline": PIPELINE_ID,
            "route": "A",
            "workflow": "A3_img2img_controlnet_lineart_ipadapter_prompt",
            "status": "environment_unverifiable",
            "failureReason": "Required node/model missing for Lineart + IPAdapter route.",
            "checkpoint": checkpoint,
            "controlnetModel": lineart_control,
            "styleNode": "IPAdapterPreciseStyleTransfer + strong prompt",
            "ipadapterModel": ipadapter,
            "seed": SEED,
            "denoise": DENIOSE,
            "controlNetWeight": CONTROL_WEIGHT,
            "styleWeight": STYLE_WEIGHT,
        }
        d = run_dir / result["workflow"]
        ensure_dir(d)
        (d / "environment_unverifiable.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), "utf-8")
        results.append(result)

    b_models = model_options(info, "ADE_LoadAnimateDiffModel", "model_name")
    b_result = {
        "pipeline": PIPELINE_ID,
        "route": "B",
        "workflow": "B_video_to_video_animatediff_temporal_style",
        "status": "environment_unverifiable" if not b_models else "not_run",
        "failureReason": "AnimateDiff temporal consistency node exists but model_name list is empty; no local temporal model available." if not b_models else "Video-to-video workflow was not run because this script only runs when a concrete local temporal model is selected.",
        "checkpoint": checkpoint,
        "controlnetModel": None,
        "styleNode": "AnimateDiff temporal consistency + reference style",
        "ipadapterModel": ipadapter,
        "seed": SEED,
        "denoise": DENIOSE,
        "controlNetWeight": None,
        "styleWeight": STYLE_WEIGHT,
        "availableAnimateDiffModels": b_models,
        "spriteSheetWidth": sheet_meta["spriteSheetWidth"],
        "spriteSheetHeight": sheet_meta["spriteSheetHeight"],
        "frameCount": sheet_meta["frameCount"],
    }
    b_dir = run_dir / b_result["workflow"]
    ensure_dir(b_dir)
    (b_dir / "environment_unverifiable.json").write_text(json.dumps(b_result, ensure_ascii=False, indent=2), "utf-8")
    results.append(b_result)

    summary = {
        "pipeline": PIPELINE_ID,
        "createdAt": datetime.now().isoformat(timespec="seconds"),
        "runDir": str(run_dir),
        "template": sheet_meta,
        "references": {name: str(path) for name, path in refs.items()},
        "results": results,
        "finalConclusion": "unknown",
    }
    successes = [item for item in results if item.get("status") == "success"]
    summary["finalConclusion"] = (
        "ComfyUI has a candidate sequence-level style redesign workflow." if successes else "Current environment cannot satisfy sequence-level style redesign with the requested A/B routes."
    )
    (run_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), "utf-8")
    append_debug_log(results)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
