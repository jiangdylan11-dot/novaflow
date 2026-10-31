"""Add the generic half-weight aliases used by ComfyUI's Qwen LoRA converter."""
from pathlib import Path
import sys


def patch(root):
    file = Path(root) / "comfy" / "lora.py"
    source = file.read_text(encoding="utf-8")
    start = source.index("    if isinstance(model, comfy.model_base.QwenImage):")
    end = source.index("\n    if isinstance(model,", start + 1)
    block = source[start:end]
    alias = '                    key_map["diffusion_model.{}".format(key_lora)] = to'
    if alias in block:
        print("Qwen 2.1 half-weight aliases already present")
        return
    anchor = '                    key_map["{}".format(key_lora)] = to'
    if block.count(anchor) != 1 or '".img_mlp.gate_up"' not in block:
        raise RuntimeError("Unknown Qwen 2.1 LoRA map; file left unchanged")
    replacement = block.replace(anchor, anchor + "\n" + alias)
    updated = source[:start] + replacement + source[end:]
    compile(updated, str(file), "exec")
    backup = file.with_suffix(".py.before-foart-qwen21-half-alias")
    if not backup.exists():
        backup.write_text(source, encoding="utf-8")
    file.write_text(updated, encoding="utf-8")
    print("Installed Qwen 2.1 half-weight aliases")


if __name__ == "__main__":
    patch(sys.argv[1])
