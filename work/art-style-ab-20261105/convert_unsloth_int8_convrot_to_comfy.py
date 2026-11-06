"""Unsloth/torchao per-row INT8 ConvRot export -> ComfyUI int8_tensorwise(+convrot) safetensors, lossless.

The file's int8 weights are Hadamard-rotated in groups of 256 with one scale per row; ComfyUI's
int8_tensorwise layout takes exactly that when the layer config says convrot=true, groupsize 256
(verified: un-rotated weights match the BF16 gguf to 0.9 % relative, better than plain per-row int8).
Only key names and metadata change; no re-quantisation.
Run with the runtime python:  C:/ProgramData/Foart/AI-Runtime/engine/python/python.exe convert_unsloth_int8_convrot_to_comfy.py SRC DST
"""
import json
import sys

import torch
from safetensors import safe_open
from safetensors.torch import save_file

src, dst = sys.argv[1], sys.argv[2]
out, layers = {}, {}
with safe_open(src, "pt", device="cpu") as f:
    keys = list(f.keys())
    for k in keys:
        if k.endswith("._weight_qdata"):
            layer = k[: -len("._weight_qdata")]
            q = f.get_tensor(k)
            scale = f.get_tensor(layer + "._weight_scale").float()
            zp = f.get_tensor(layer + "._weight_zero_point")
            assert q.dtype == torch.int8 and scale.shape == (q.shape[0], 1), (layer, q.dtype, scale.shape)
            assert int(zp.abs().max()) == 0, (layer, "asymmetric zero point not supported")
            out[layer + ".weight"] = q.contiguous()
            out[layer + ".weight_scale"] = scale.contiguous()
            layers[layer] = {"format": "int8_tensorwise", "convrot": True, "convrot_groupsize": 256}
        elif k.endswith("._weight_scale") or k.endswith("._weight_zero_point"):
            continue
        else:
            out[k] = f.get_tensor(k)
print("quantised layers", len(layers), "other tensors", len(out) - 2 * len(layers))
save_file(out, dst, metadata={"_quantization_metadata": json.dumps({"layers": layers}), "format": "pt"})
print("written", dst)
