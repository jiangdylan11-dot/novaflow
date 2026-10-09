"""Export the 视频抠图 model for the browser (no compute node online).

BiRefNet_lite (MIT, ZhengPeng7/BiRefNet_lite - the folder the compute nodes use, models/RMBG/BiRefNet_lite)
becomes renderer/vendor/matting/model.bin (fp16 ONNX; a neutral name, the site names no model), which the site serves in parts and
novaflow-web-capabilities.js runs with ONNX Runtime Web on WebGPU. A ~90 MB binary, so it is not
in git; run this once on the build machine (the build warns when it is missing):

  <python with torch, torchvision, safetensors, onnx, onnxruntime> tools/export-browser-matting-model.py <BiRefNet_lite folder> [frame.png ...]

torchvision's deform_conv2d has no ONNX Runtime Web kernel, so it is replaced by an equivalent made
of GridSample (bilinear, zero padding) and MatMul; the replacement is compared with the original on
the given frames, and the exported fp32 and fp16 graphs with PyTorch, before anything is written.
"""
import sys, os, types, importlib.util, json, time

LICENSE = """BiRefNet_lite weights and model code: https://huggingface.co/ZhengPeng7/BiRefNet_lite
(https://github.com/ZhengPeng7/BiRefNet), exported to ONNX by NovaFlow.

MIT License

Copyright (c) 2024 ZhengPeng

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""
import numpy as np
import torch, torch.nn.functional as F
import torchvision.transforms as T
from PIL import Image

folder, frames = sys.argv[1], sys.argv[2:]
out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'renderer', 'vendor', 'matting')
os.makedirs(out_dir, exist_ok=True)
if not frames:
    raise SystemExit('give one or more frame PNGs to check the export against PyTorch')

package = types.ModuleType("nf_birefnet"); package.__path__ = [folder]; sys.modules["nf_birefnet"] = package
def load(name):
    spec = importlib.util.spec_from_file_location("nf_birefnet." + name, os.path.join(folder, name + ".py"))
    module = importlib.util.module_from_spec(spec); sys.modules[spec.name] = module; spec.loader.exec_module(module); return module
config = load("BiRefNet_config")
birefnet = load("birefnet")
import safetensors.torch
model = birefnet.BiRefNet(config.BiRefNetConfig())
model.load_state_dict(safetensors.torch.load_file(os.path.join(folder, "model.safetensors")))
model = model.float().eval()

def deform_conv2d_grid(input, offset, weight, bias=None, stride=(1, 1), padding=(0, 0), dilation=(1, 1), mask=None):
    n, c, h, w = input.shape
    co, _, kh, kw = weight.shape
    sh, sw = (stride, stride) if isinstance(stride, int) else stride
    ph, pw = (padding, padding) if isinstance(padding, int) else padding
    dh, dw = (dilation, dilation) if isinstance(dilation, int) else dilation
    ho, wo = offset.shape[2], offset.shape[3]
    k = kh * kw
    ys = torch.arange(ho, dtype=input.dtype).view(1, 1, ho, 1) * sh - ph
    xs = torch.arange(wo, dtype=input.dtype).view(1, 1, 1, wo) * sw - pw
    ky = (torch.arange(kh, dtype=input.dtype) * dh).repeat_interleave(kw).view(1, k, 1, 1)
    kx = (torch.arange(kw, dtype=input.dtype) * dw).repeat(kh).view(1, k, 1, 1)
    off = offset.view(n, k, 2, ho, wo)
    py = ys + ky + off[:, :, 0]                      # n,k,ho,wo
    px = xs + kx + off[:, :, 1]
    gy = py * (2.0 / max(h - 1, 1)) - 1.0            # align_corners=True: pixel centres at -1..1
    gx = px * (2.0 / max(w - 1, 1)) - 1.0
    grid = torch.stack([gx, gy], dim=-1).view(n, k * ho, wo, 2)
    sampled = F.grid_sample(input, grid, mode="bilinear", padding_mode="zeros", align_corners=True)  # n,c,k*ho,wo
    sampled = sampled.view(n, c, k, ho, wo)
    if mask is not None:
        sampled = sampled * mask.view(n, 1, k, ho, wo)
    cols = sampled.reshape(n, c * k, ho * wo)
    out = torch.matmul(weight.reshape(co, c * k), cols).view(n, co, ho, wo)
    if bias is not None:
        out = out + bias.view(1, co, 1, 1)
    return out

TRANSFORM = T.Compose([T.Resize((1024, 1024)), T.ToTensor(), T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
inputs = torch.stack([TRANSFORM(Image.open(p).convert("RGB")) for p in frames])

class Wrapped(torch.nn.Module):
    def __init__(self, m): super().__init__(); self.m = m
    def forward(self, x): return self.m(x)[-1].sigmoid()

with torch.inference_mode():
    reference = torch.cat([Wrapped(model)(inputs[i:i + 1]) for i in range(len(inputs))])
original = birefnet.deform_conv2d
birefnet.deform_conv2d = deform_conv2d_grid
with torch.inference_mode():
    replaced = torch.cat([Wrapped(model)(inputs[i:i + 1]) for i in range(len(inputs))])
diff = (reference - replaced).abs()
print(json.dumps({"replacement_max_abs": float(diff.max()), "replacement_mean_abs": float(diff.mean())}))

import tempfile
work = tempfile.mkdtemp()
path = os.path.join(work, "model.onnx")
t = time.time()
torch.onnx.export(Wrapped(model), inputs[:1], path, input_names=["input"], output_names=["mask"], opset_version=17, do_constant_folding=True, dynamo=False)
print(json.dumps({"exported": path, "mb": round(os.path.getsize(path) / 1e6, 1), "seconds": round(time.time() - t, 1)}))

import onnxruntime as ort
session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
outs = [session.run(None, {"input": inputs[i:i + 1].numpy()})[0] for i in range(len(inputs))]
onnx_out = np.concatenate(outs)
d = np.abs(onnx_out - reference.numpy())
print(json.dumps({"onnx_vs_torch_max_abs": float(d.max()), "onnx_vs_torch_mean_abs": float(d.mean()), "over_2_of_255": int((d * 255 > 2).sum()), "pixels": int(d.size)}))

assert d.max() * 255 < 1, "fp32 export differs from PyTorch"
import onnx
from onnxruntime.transformers.float16 import convert_float_to_float16
half = convert_float_to_float16(onnx.load(path), keep_io_types=True)
half_path = os.path.join(out_dir, "model.bin")
onnx.save(half, half_path)
session16 = ort.InferenceSession(half_path, providers=["CPUExecutionProvider"])
d16 = np.abs(np.concatenate([session16.run(None, {"input": inputs[i:i + 1].numpy()})[0] for i in range(len(inputs))]) - reference.numpy()) * 255
print(json.dumps({"fp16": half_path, "mb": round(os.path.getsize(half_path) / 1e6, 1), "fp16_vs_torch_max_255": round(float(d16.max()), 2), "fp16_vs_torch_mean_255": round(float(d16.mean()), 4)}))
if d16.max() > 16:
    os.remove(half_path)
    raise SystemExit("fp16 export drifts too far from PyTorch")
with open(os.path.join(out_dir, "LICENSE"), "w", encoding="utf-8") as f:
    f.write(LICENSE)
del session, session16
import shutil
shutil.rmtree(work, ignore_errors=True)
