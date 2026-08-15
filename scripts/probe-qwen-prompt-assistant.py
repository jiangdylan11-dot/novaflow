"""Probe whether NovaFlow's installed Comfy Qwen image text encoder can generate text.

This is intentionally not wired into Electron or the renderer. It directly uses
the installed Runtime Python environment and Comfy internals to answer one
question: can the current qwen_2.5_vl_7b_fp8_scaled.safetensors produce readable
Chinese text for prompt optimization and image reverse prompting?
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


DEFAULT_RUNTIME_JSON = Path(r"C:\ProgramData\NovaFlow\AI-Runtime\runtime.json")
DEFAULT_COMFY_ROOT = Path(r"C:\ProgramData\NovaFlow\AI-Runtime\engine\ComfyUI")
DEFAULT_MODEL_PATH = Path(r"E:\BaiduNetdiskDownload\qwen_2.5_vl_7b_fp8_scaled.safetensors")
DEFAULT_MODEL_NAME = "qwen_2.5_vl_7b_fp8_scaled.safetensors"


def read_runtime_config(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def add_comfy_paths(comfy_root: Path) -> None:
    os.chdir(str(comfy_root))
    sys.path.insert(0, str(comfy_root))


def add_runtime_model_paths(runtime_config: dict, model_path: Path | None) -> None:
    import folder_paths

    models_path = runtime_config.get("modelsPath")
    if models_path:
        models_root = Path(models_path)
        folder_paths.add_model_folder_path("text_encoders", str(models_root / "text_encoders"))
        folder_paths.add_model_folder_path("embeddings", str(models_root / "embeddings"))

    if model_path is not None:
        folder_paths.add_model_folder_path("text_encoders", str(model_path.parent), is_default=True)


def force_qwen_lm_head() -> None:
    import comfy.text_encoders.llama as llama

    original_init = llama.Qwen25_7BVLI.__init__

    def patched_init(self, config_dict, dtype, device, operations):
        config_dict = dict(config_dict)
        config_dict["lm_head"] = True
        original_init(self, config_dict, dtype, device, operations)

    llama.Qwen25_7BVLI.__init__ = patched_init


def build_synthetic_image():
    import numpy as np
    import torch
    from PIL import Image, ImageDraw

    width, height = 384, 384
    image = Image.new("RGB", (width, height), (12, 24, 54))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        shade = int(30 + y * 0.28)
        draw.line([(0, y), (width, y)], fill=(8, 30 + shade // 4, min(120, shade)))
    draw.rounded_rectangle((74, 74, 310, 310), radius=24, fill=(220, 240, 255), outline=(80, 180, 255), width=3)
    draw.rounded_rectangle((112, 140, 272, 172), radius=9, fill=(238, 246, 255), outline=(126, 159, 194), width=2)
    draw.rounded_rectangle((112, 190, 272, 222), radius=9, fill=(238, 246, 255), outline=(126, 159, 194), width=2)
    draw.rounded_rectangle((132, 246, 252, 282), radius=18, fill=(40, 160, 255), outline=(140, 225, 255), width=2)
    draw.ellipse((164, 92, 220, 128), fill=(40, 160, 255), outline=(150, 230, 255), width=2)

    array = np.asarray(image).astype("float32") / 255.0
    return torch.from_numpy(array).unsqueeze(0)


def make_text_prompt(raw_prompt: str) -> str:
    return (
        "你是 NovaFlow 的提示词优化助手。请将用户输入改写成适合图像生成或图像编辑模型使用的中文自然语言提示词。"
        "不要翻译成英文，不要输出 SD 标签，不要输出 JSON。请补充主体、场景、风格、构图、光影、材质和必要约束条件。"
        "同时生成推荐负面提示词。正向提示词必须是中文自然语言描述。负向提示词必须是中文关键词列表，"
        "只允许用逗号分隔关键词，禁止写成“不要出现低质量画面”这类完整句子。"
        "必须严格围绕用户输入，不得改成其他主题。"
        "如果用户输入包含界面、登录、按钮、输入框、UI、卡片等元素，必须保留这些元素并扩写。"
        "\n示例：\n用户输入：未来科技风登录界面\n"
        "正向：设计一个未来科技风格的移动端登录界面，整体采用深蓝色渐变配色，使用玻璃拟态设计语言，登录卡片居中展示，按钮带有轻微发光效果，界面简洁高级，适合科技类产品。\n"
        "负向：低质量, 模糊, 布局混乱, 元素重叠, 错误文字, Logo, 水印\n"
        "\n现在处理：\n"
        f"用户输入：{raw_prompt}\n"
        "请严格输出两行，冒号后填写内容：\n正向：\n负向："
    )


def make_image_prompt() -> str:
    return (
        "你是 NovaFlow 的图片反推助手。请根据图片内容生成适合图像生成模型使用的中文自然语言提示词。"
        "不要输出英文，不要输出 SD 标签，不要输出 JSON，不要写成分析报告。"
        "请直接输出可用于生成图片的自然语言描述。"
    )


def generate_text(clip, prompt: str, *, images=None, max_length: int, seed: int) -> str:
    tokens = clip.tokenize(prompt, images=images or [], min_length=1)
    generated_ids = clip.generate(
        tokens,
        do_sample=False,
        max_length=max_length,
        temperature=0.0,
        top_k=0,
        top_p=1.0,
        min_p=0.0,
        repetition_penalty=1.0,
        seed=seed,
        presence_penalty=0.0,
    )
    return clip.decode(generated_ids).strip()


def load_qwen_clip(model_name: str, device: str):
    import nodes

    clip = nodes.CLIPLoader().load_clip(model_name, type="qwen_image", device=device)[0]
    ensure_qwen_stop_tokens(clip)
    return clip


def ensure_qwen_stop_tokens(clip) -> None:
    """Comfy's Qwen image encoder can generate, but this config omits stop tokens."""
    try:
        qwen_model = getattr(clip.cond_stage_model, "qwen25_7b")
        config = qwen_model.transformer.model.config
    except AttributeError:
        return
    if not hasattr(config, "stop_tokens"):
        config.stop_tokens = [151645, 151643]


def run_probe(args: argparse.Namespace) -> dict:
    runtime_config = read_runtime_config(args.runtime_json)
    comfy_root = args.comfy_root
    model_path = args.model_path if args.model_path.exists() else None
    model_name = model_path.name if model_path is not None else args.model_name

    if not comfy_root.exists():
        raise FileNotFoundError(f"ComfyUI root not found: {comfy_root}")

    add_comfy_paths(comfy_root)
    add_runtime_model_paths(runtime_config, model_path)

    import torch
    import folder_paths

    if args.force_lm_head:
        force_qwen_lm_head()

    result = {
        "runtime_json": str(args.runtime_json),
        "comfy_root": str(comfy_root),
        "model_name": model_name,
        "model_path": str(model_path) if model_path is not None else None,
        "python": sys.executable,
        "torch": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "force_lm_head": args.force_lm_head,
        "text_encoders_paths": folder_paths.get_folder_paths("text_encoders"),
        "text_output": None,
        "image_output": None,
        "errors": [],
    }

    start = time.time()
    clip = load_qwen_clip(model_name, args.device)
    result["load_seconds"] = round(time.time() - start, 2)

    start = time.time()
    result["text_output"] = generate_text(
        clip,
        make_text_prompt(args.raw_prompt),
        max_length=args.max_length,
        seed=args.seed,
    )
    result["text_seconds"] = round(time.time() - start, 2)

    if not args.skip_image:
        start = time.time()
        result["image_output"] = generate_text(
            clip,
            make_image_prompt(),
            images=[build_synthetic_image()],
            max_length=args.max_length,
            seed=args.seed,
        )
        result["image_seconds"] = round(time.time() - start, 2)

    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-json", type=Path, default=DEFAULT_RUNTIME_JSON)
    parser.add_argument("--comfy-root", type=Path, default=DEFAULT_COMFY_ROOT)
    parser.add_argument("--model-path", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument("--model-name", default=DEFAULT_MODEL_NAME)
    parser.add_argument("--raw-prompt", default="未来科技风登录界面")
    parser.add_argument("--max-length", type=int, default=96)
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--device", choices=["default", "cpu"], default="default")
    parser.add_argument("--skip-image", action="store_true")
    parser.add_argument("--force-lm-head", action="store_true")
    args = parser.parse_args()

    try:
        result = run_probe(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        error = {
            "error": str(exc),
            "traceback": traceback.format_exc(),
            "python": sys.executable,
        }
        print(json.dumps(error, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
