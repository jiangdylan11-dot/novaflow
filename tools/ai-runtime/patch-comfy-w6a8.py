"""Let ComfyUI 0.37 load w6a8_int8 layers (the Beta7 video line).

Upstream ComfyUI 0.44 added the format as a second grouped INT8 layout: the
same AsymW4A8Int8Layout and kernels with 6-bit codes. comfy-kitchen 0.2.41
carries the kernels; this adds the two ComfyUI loader branches and the quant
entry. Idempotent: a patched file is left as it is.
"""
from pathlib import Path
import sys

OLD_BRANCH = 'elif module.quant_format == "asym_w4a8_int8":'
NEW_BRANCH = 'elif module.quant_format in ("asym_w4a8_int8", "w6a8_int8"):'
DISABLED = 'disabled.add("asym_w4a8_int8")'


def newline(text):
    return "\r\n" if "\r\n" in text else "\n"


def write(file, source, updated):
    compile(updated, str(file), "exec")
    backup = file.with_suffix(".py.before-foart-w6a8")
    if not backup.exists():
        backup.write_bytes(source.encode("utf-8"))
    file.write_bytes(updated.encode("utf-8"))


def patch_ops(root):
    file = Path(root) / "comfy" / "ops.py"
    source = file.read_bytes().decode("utf-8")
    if NEW_BRANCH in source:
        return "ops.py already patched"
    if source.count(OLD_BRANCH) != 2 or source.count(DISABLED) != 1:
        raise RuntimeError("Unknown ComfyUI ops.py; file left unchanged")
    updated = source.replace(OLD_BRANCH, NEW_BRANCH)
    at = updated.index(DISABLED)
    indent = updated[updated.rfind("\n", 0, at) + 1:at]
    updated = updated.replace(DISABLED, DISABLED + newline(source) + indent + 'disabled.add("w6a8_int8")')
    write(file, source, updated)
    return "ops.py patched"


def patch_quant(root):
    file = Path(root) / "comfy" / "quant_ops.py"
    source = file.read_bytes().decode("utf-8")
    if 'QUANT_ALGOS["w6a8_int8"]' in source:
        return "quant_ops.py already patched"
    nl = newline(source)
    anchor = nl.join(['QUANT_ALGOS["asym_w4a8_int8"] = {', '    "storage_t": torch.int8,', '    "parameters": {"weight_scale"},',
                      '    "comfy_tensor_layout": "AsymW4A8Int8Layout",', '    "quantize_input": False,', '}', ''])
    if source.count(anchor) != 1:
        raise RuntimeError("Unknown ComfyUI quant_ops.py; file left unchanged")
    entry = nl.join(['', '# 6-bit uniform codes in the same layout and kernels (comfy-kitchen >= 0.2.41).',
                     'QUANT_ALGOS["w6a8_int8"] = {', '    "storage_t": torch.int8,', '    "parameters": {"weight_scale"},',
                     '    "comfy_tensor_layout": "AsymW4A8Int8Layout",', '    "quantize_input": False,', '}', ''])
    write(file, source, source.replace(anchor, anchor + entry))
    return "quant_ops.py patched"


if __name__ == "__main__":
    comfy_root = sys.argv[1]
    print(patch_ops(comfy_root))
    print(patch_quant(comfy_root))
