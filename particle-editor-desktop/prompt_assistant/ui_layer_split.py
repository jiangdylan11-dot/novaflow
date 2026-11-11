"""UI layer split: one screenshot + user-confirmed regions -> separate complete layers.

Input  : RGB picture, regions [{id, name, kind, box[x1,y1,x2,y2] on a 0..1000 scale, parentId?, text?}]
         kind: panel (plate / bar / board), object | icon | button (element), text, prop (character / scene object)
Output : {"width", "height", "layers": bottom-to-top [{id, name, group, x, y, width, height, png(bytes), text?}], "timing"}
         group: background | prop | panel | element | text

How (validated in work/ui-layer-split-lab, 2026-11):
  cut     SAM3 box prompt per region -> ViTMatte edge -> ORIGINAL pixels (foreground colour estimation on soft edges)
  fill    peel from the top: children are removed from their plate (LaMa) before the plate is captured
  scene   the whole UI is removed in one pass (FLUX Fill + removal LoRA); props are cut from that picture, so parts the
          UI covered are complete; the background is that picture with the props removed
  text    the image model redraws ONE text line on a flat key colour, the key is removed (clean lettering, original style)
The recognition is the caller's business: nothing here guesses regions, so the result follows what the user confirmed.
"""
import io
import json
import math
import mimetypes
import os
import sys
import time
import urllib.parse
import urllib.request
import uuid

import cv2
import numpy as np
from PIL import Image

REMOVE_PROMPT = ("Remove the selected object inside the white mask area and reconstruct the surrounding layer naturally. "
                 "Preserve all unmasked pixels, style, lighting, perspective, and texture.")
KEYS = {"green": ((0, 255, 0), "纯绿色（#00FF00）"), "magenta": ((255, 0, 255), "纯品红色（#FF00FF）")}
KEY_PROMPT = ("只保留图里的文字「%s」，文字的字形、大小、位置、颜色、渐变、描边和立体效果完全不变。"
              "把文字以外的所有东西（底板、边框、图标、背景）全部去掉，换成一整片均匀的%s平涂背景，不要阴影、不要发光、不要渐变、不要任何其他图案。")
KEY_PROMPT_ANY = ("只保留图里的文字，文字的字形、大小、位置、颜色、渐变、描边和立体效果完全不变。"
                  "把文字以外的所有东西（底板、边框、图标、背景）全部去掉，换成一整片均匀的%s平涂背景，不要阴影、不要发光、不要渐变、不要任何其他图案。")
TURBO_SIGMAS = "1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0"
ELEMENT_KINDS = ("object", "icon", "button", "element")


class SplitError(RuntimeError):
    pass


# ------------------------------------------------------------------ ComfyUI
class Comfy:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self._clip_l = None

    def _request(self, path, data=None, headers=None, timeout=180):
        req = urllib.request.Request(self.base + path, data=data, headers=headers or {}, method="POST" if data is not None else "GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()

    def upload(self, image, tag):
        buf = io.BytesIO()
        image.save(buf, "PNG")
        name = "uisplit_%s_%s.png" % (tag, uuid.uuid4().hex[:10])
        boundary = "----uisplit%s" % uuid.uuid4().hex
        body = io.BytesIO()
        body.write(("--%s\r\nContent-Disposition: form-data; name=\"image\"; filename=\"%s\"\r\nContent-Type: image/png\r\n\r\n" % (boundary, name)).encode())
        body.write(buf.getvalue())
        body.write(("\r\n--%s\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n--%s--\r\n" % (boundary, boundary)).encode())
        out = self._request("/upload/image", body.getvalue(), {"Content-Type": "multipart/form-data; boundary=%s" % boundary})
        return json.loads(out.decode("utf-8"))["name"]

    def queue(self, graph):
        out = json.loads(self._request("/prompt", json.dumps({"prompt": graph, "client_id": "uisplit_%s" % uuid.uuid4().hex[:8]}).encode(),
                                       {"Content-Type": "application/json"}).decode("utf-8"))
        if "prompt_id" not in out:
            raise SplitError("图像服务没有接受任务：%s" % json.dumps(out, ensure_ascii=False)[:600])
        return out["prompt_id"]

    def result(self, prompt_id, node, timeout=900):
        t0 = time.time()
        while time.time() - t0 < timeout:
            item = json.loads(self._request("/history/%s" % prompt_id).decode("utf-8")).get(prompt_id)
            if item:
                status = item.get("status") or {}
                if status.get("status_str") == "error":
                    raise SplitError("图像服务执行失败：%s" % json.dumps(status.get("messages", []), ensure_ascii=False)[:800])
                images = ((item.get("outputs") or {}).get(str(node)) or {}).get("images") or []
                if images:
                    im = images[0]
                    q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im.get("subfolder", ""), "type": im.get("type", "output")})
                    return Image.open(io.BytesIO(self._request("/view?" + q))).convert("RGB")
                if status.get("completed"):
                    raise SplitError("图像服务没有返回图片")
            time.sleep(0.25)
        raise SplitError("图像服务超时")

    def run(self, graph, node):
        return self.result(self.queue(graph), node)

    def clip_l(self):
        if self._clip_l is None:
            info = json.loads(self._request("/object_info/DualCLIPLoader").decode("utf-8"))["DualCLIPLoader"]["input"]["required"]
            names = [c for c in info["clip_name1"][0] if "clip_l" in c]
            if not names:
                raise SplitError("当前算力节点缺少去除物体所需的模型")
            self._clip_l = names[0]
        return self._clip_l

    # -- graphs (same as the production 去除物体 / 2.1 Turbo routes)
    def lama(self, rgb, mask):
        a, b = self.upload(Image.fromarray(rgb), "in"), self.upload(Image.fromarray(np.stack([mask.astype(np.uint8) * 255] * 3, -1)), "mask")
        g = {"1": {"class_type": "LoadImage", "inputs": {"image": a}}, "2": {"class_type": "LoadImage", "inputs": {"image": b}},
             "3": {"class_type": "ImageToMask", "inputs": {"image": ["2", 0], "channel": "red"}},
             "4": {"class_type": "AILab_LamaRemover", "inputs": {"images": ["1", 0], "masks": ["3", 0], "removal_strength": 250, "edge_smoothness": 4}},
             "15": {"class_type": "SaveImage", "inputs": {"images": ["4", 0], "filename_prefix": "uisplit_lama"}}}
        return _blend(rgb, np.asarray(self.run(g, 15)), mask)

    def remove(self, rgb, mask, seed):
        h, w = mask.shape
        ph, pw = (h + 15) // 16 * 16, (w + 15) // 16 * 16
        img = cv2.copyMakeBorder(rgb, 0, ph - h, 0, pw - w, cv2.BORDER_REFLECT_101)
        mk = cv2.copyMakeBorder(mask.astype(np.uint8) * 255, 0, ph - h, 0, pw - w, cv2.BORDER_CONSTANT, value=0)
        s = min(1.0, (1300000 / (ph * pw)) ** 0.5)
        if s < 1:
            img = cv2.resize(img, (int(pw * s) // 16 * 16, int(ph * s) // 16 * 16), interpolation=cv2.INTER_AREA)
            mk = cv2.resize(mk, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_NEAREST)
        a, b = self.upload(Image.fromarray(img), "in"), self.upload(Image.fromarray(np.stack([mk] * 3, -1)), "mask")
        g = {"1": {"class_type": "LoadImage", "inputs": {"image": a}}, "2": {"class_type": "LoadImage", "inputs": {"image": b}},
             "3": {"class_type": "ImageToMask", "inputs": {"image": ["2", 0], "channel": "red"}},
             "4": {"class_type": "UNETLoader", "inputs": {"unet_name": "fill-dev-OneReward-fp8.safetensors", "weight_dtype": "default"}},
             "5": {"class_type": "DualCLIPLoader", "inputs": {"clip_name1": self.clip_l(), "clip_name2": "t5xxl_fp8_e4m3fn.safetensors", "type": "flux", "device": "default"}},
             "6": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
             "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["5", 0], "text": REMOVE_PROMPT}},
             "8": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["7", 0], "guidance": 50}},
             "9": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["7", 0]}},
             "10": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["4", 0], "lora_name": "removal_timestep_alpha-2-1740.safetensors", "strength_model": 1}},
             "11": {"class_type": "DifferentialDiffusion", "inputs": {"model": ["10", 0]}},
             "12": {"class_type": "InpaintModelConditioning", "inputs": {"positive": ["8", 0], "negative": ["9", 0], "vae": ["6", 0], "pixels": ["1", 0], "mask": ["3", 0], "noise_mask": True}},
             "13": {"class_type": "KSampler", "inputs": {"model": ["11", 0], "positive": ["12", 0], "negative": ["12", 1], "latent_image": ["12", 2], "seed": seed, "steps": 25, "cfg": 1,
                                                         "sampler_name": "euler", "scheduler": "simple", "denoise": 1}},
             "14": {"class_type": "VAEDecode", "inputs": {"samples": ["13", 0], "vae": ["6", 0]}},
             "15": {"class_type": "SaveImage", "inputs": {"images": ["14", 0], "filename_prefix": "uisplit_rm"}}}
        gen = cv2.resize(np.asarray(self.run(g, 15)), (pw, ph), interpolation=cv2.INTER_CUBIC)[:h, :w]
        return _blend(rgb, gen, mask)

    def turbo_edit_graph(self, image_name, prompt, seed):
        return {"3": {"class_type": "UNETLoader", "inputs": {"unet_name": "Qwen-Image-2.1-Turbo-INT8-ConvRot-comfy.safetensors", "weight_dtype": "default"}},
                "4": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_8b_bf16_heretic.safetensors", "type": "qwen_image", "device": "default"}},
                "5": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}},
                "20": {"class_type": "LoadImage", "inputs": {"image": image_name}},
                "6": {"class_type": "TextEncodeQwenImage21", "inputs": {"clip": ["4", 0], "vae": ["5", 0], "prompt": prompt, "negative_prompt": "", "resolution": 0, "images.image_1": ["20", 0]}},
                "7": {"class_type": "QwenImage21Cache", "inputs": {"model": ["3", 0], "device": "cpu", "dtype": "default"}},
                "8": {"class_type": "BasicGuider", "inputs": {"model": ["7", 0], "conditioning": ["6", 0]}},
                "9": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
                "10": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
                "11": {"class_type": "ManualSigmas", "inputs": {"sigmas": TURBO_SIGMAS}},
                "12": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["9", 0], "guider": ["8", 0], "sampler": ["10", 0], "sigmas": ["11", 0], "latent_image": ["6", 2]}},
                "13": {"class_type": "VAEDecode", "inputs": {"samples": ["12", 0], "vae": ["5", 0]}},
                "14": {"class_type": "SaveImage", "inputs": {"images": ["13", 0], "filename_prefix": "uisplit_key"}}}


# ------------------------------------------------------------------ pixels
def _mor(m, op, r):
    return cv2.morphologyEx(m.astype(np.uint8), op, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))).astype(bool)


def _blend(rgb, gen, mask):
    if gen.shape[:2] != mask.shape:
        gen = cv2.resize(gen, (mask.shape[1], mask.shape[0]), interpolation=cv2.INTER_CUBIC)
    w = np.maximum(cv2.GaussianBlur(_mor(mask, cv2.MORPH_DILATE, 3).astype(np.float32), (0, 0), 1.5), mask.astype(np.float32))[..., None]
    return (rgb.astype(np.float32) * (1 - w) + gen.astype(np.float32) * w).clip(0, 255).astype(np.uint8)


def _fill_holes(m):
    n, lab, st, _ = cv2.connectedComponentsWithStats((~m).astype(np.uint8), 4)
    h, w = m.shape
    out = m.copy()
    for i in range(1, n):
        x, y, ww, hh, _a = st[i]
        if x > 0 and y > 0 and x + ww < w and y + hh < h:
            out[lab == i] = True
    return out


def _biggest(m):
    n, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
    return m if n <= 2 else lab == (1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA])))


def _bbox(m, pad, W, H):
    ys, xs = np.nonzero(m)
    return max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad), min(W, int(xs.max()) + 1 + pad), min(H, int(ys.max()) + 1 + pad)


def _rounded_box(box, W, H):
    x0, y0, x1, y1 = [int(v) for v in box]
    bw, bh = x1 - x0, y1 - y0
    r = int(min(bw, bh) * (0.5 if bw > 3 * bh else 0.06))
    rb = np.zeros((H, W), np.uint8)
    cv2.rectangle(rb, (x0 + r, y0), (x1 - r, y1), 1, -1)
    cv2.rectangle(rb, (x0, y0 + r), (x1, y1 - r), 1, -1)
    for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
        cv2.circle(rb, (cx, cy), r, 1, -1)
    return rb.astype(bool)


def _row_col_fill(m):
    rows, cols = np.zeros_like(m), np.zeros_like(m)
    ys, xs = np.nonzero(m)
    for y in np.unique(ys):
        r = np.nonzero(m[y])[0]
        rows[y, r[0]:r[-1] + 1] = True
    for x in np.unique(xs):
        c = np.nonzero(m[:, x])[0]
        cols[c[0]:c[-1] + 1, x] = True
    return rows | cols


def _clean_rgb(rgb, alpha):
    a = alpha.astype(np.float64) / 255
    if ((a > 0.02) & (a < 0.98)).sum() < 4:
        return rgb
    try:
        from pymatting import estimate_foreground_ml
        return (estimate_foreground_ml(rgb.astype(np.float64) / 255, a) * 255).clip(0, 255).astype(np.uint8)
    except Exception:
        return rgb


def _png(rgba):
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA" if rgba.shape[2] == 4 else "RGB").save(buf, "PNG")
    return buf.getvalue()


def key_out(img, key):
    """alpha + un-mixed colours of lettering drawn on a flat key colour (the real key is measured on the border)."""
    a = img.astype(np.float32)
    k = np.array(key, np.float32)
    border = np.concatenate([a[:3].reshape(-1, 3), a[-3:].reshape(-1, 3), a[:, :3].reshape(-1, 3), a[:, -3:].reshape(-1, 3)])
    near = border[np.linalg.norm(border - k, axis=1) < 120]
    bgc = np.median(near, axis=0) if len(near) > 20 else k
    alpha = np.clip((np.linalg.norm(a - bgc, axis=-1) - 28) / 70, 0, 1)
    al = alpha[..., None]
    fg = np.where(al > 0.04, (a - (1 - al) * bgc) / np.maximum(al, 0.04), a).clip(0, 255)
    soft = alpha < 0.98            # despill only where the key can still be mixed in
    if key[1] > key[0]:            # green key: green may not exceed the other channels by much
        fg[..., 1] = np.where(soft, np.minimum(fg[..., 1], np.maximum(fg[..., 0], fg[..., 2]) + 25), fg[..., 1])
    else:                          # magenta key: red and blue may not both exceed green by much
        lim = fg[..., 1] + 25
        both = soft & (fg[..., 0] > lim) & (fg[..., 2] > lim)
        fg[..., 0] = np.where(both, np.minimum(fg[..., 0], np.maximum(lim, fg[..., 0] - (fg[..., 2] - lim))), fg[..., 0])
        fg[..., 2] = np.where(both, lim, fg[..., 2])
    return fg, alpha, float(len(near)) / max(1, len(border))


# ------------------------------------------------------------------ models in this process
class Segmenter:
    """SAM3 (box prompts) + ViTMatte, loaded once."""

    def __init__(self, comfy_root, models_dir):
        rmbg = os.path.join(comfy_root, "custom_nodes", "ComfyUI-RMBG")
        ckpt = os.path.join(models_dir, "sam3", "sam3.pt")
        vit = os.path.join(models_dir, "vitmatte")
        for need, what in ((os.path.join(rmbg, "sam3"), "分割组件"), (ckpt, "分割模型"), (vit, "边缘细化模型")):
            if not os.path.exists(need):
                raise SplitError("当前算力节点缺少拆图所需的%s" % what)
        if rmbg not in sys.path:
            sys.path.insert(0, rmbg)
        import torch
        from sam3.model.sam3_image_processor import Sam3Processor
        from sam3.model_builder import build_sam3_image_model
        from transformers import VitMatteForImageMatting, VitMatteImageProcessor
        self.torch = torch
        model = build_sam3_image_model(bpe_path=os.path.join(rmbg, "sam3", "assets", "bpe_simple_vocab_16e6.txt.gz"), device="cuda", eval_mode=True,
                                       checkpoint_path=ckpt, load_from_HF=False, enable_segmentation=True, enable_inst_interactivity=False)
        self.proc = Sam3Processor(model, device="cuda")
        self.vit_proc = VitMatteImageProcessor.from_pretrained(vit)
        self.vit = VitMatteForImageMatting.from_pretrained(vit).cuda().eval()
        self.state = None
        self.size = None

    def close(self):
        self.proc = self.vit = self.state = None
        try:
            self.torch.cuda.empty_cache()
        except Exception:
            pass

    def set_image(self, rgb):
        with self.torch.autocast("cuda", dtype=self.torch.bfloat16):
            self.state = self.proc.set_image(Image.fromarray(rgb))
        self.size = rgb.shape[:2]

    def _masks(self, st):
        m = st.get("masks")
        if m is None or m.numel() == 0:
            return []
        m = m.float().cpu()
        if m.ndim == 4:
            m = m.squeeze(1)
        return [m[i].numpy() > 0.5 for i in range(m.shape[0])]

    def box(self, box, min_fill=0.12, pad=0.08):
        """the biggest mask that lives inside the box"""
        H, W = self.size
        x0, y0, x1, y1 = box
        with self.torch.autocast("cuda", dtype=self.torch.bfloat16):
            self.proc.reset_all_prompts(self.state)
            self.proc.set_confidence_threshold(0.05, self.state)
            cands = self._masks(self.proc.add_geometric_prompt([(x0 + x1) / 2 / W, (y0 + y1) / 2 / H, (x1 - x0) / W, (y1 - y0) / H], True, self.state))
        px, py = (x1 - x0) * pad + 3, (y1 - y0) * pad + 3
        rect = np.zeros((H, W), bool)
        rect[max(0, int(y0 - py)):int(y1 + py) + 1, max(0, int(x0 - px)):int(x1 + px) + 1] = True
        best, score = None, 0
        for c in cands:
            a = c.sum()
            if a < min_fill * (x1 - x0) * (y1 - y0) or a < 60:
                continue
            inside = (c & rect).sum() / a
            if inside >= 0.85 and a * inside > score:
                best, score = c & rect, a * inside
        return best

    def words(self, words, conf=0.3):
        out = []
        with self.torch.autocast("cuda", dtype=self.torch.bfloat16):
            for w in words:
                self.proc.reset_all_prompts(self.state)
                self.proc.set_confidence_threshold(conf, self.state)
                out += self._masks(self.proc.set_text_prompt(w, self.state))
        return out

    def matte(self, rgb, mask, erode=2, dilate=3, pad=24):
        H, W = mask.shape
        x0, y0, x1, y1 = _bbox(mask, pad, W, H)
        m = mask[y0:y1, x0:x1]
        fg = _mor(m, cv2.MORPH_ERODE, erode)
        unk = _mor(m, cv2.MORPH_DILATE, dilate) & ~fg
        tri = np.zeros(m.shape, np.uint8)
        tri[fg], tri[unk] = 255, 128
        crop = rgb[y0:y1, x0:x1]
        s = 1
        if max(crop.shape[:2]) < 384:      # tiny parts: enlarged so the edge band is more than a pixel or two
            s = min(4, int(math.ceil(384 / max(crop.shape[:2]))))
            crop = cv2.resize(crop, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
            tri = cv2.resize(tri, None, fx=s, fy=s, interpolation=cv2.INTER_NEAREST)
        with self.torch.no_grad():
            inp = self.vit_proc(images=Image.fromarray(crop), trimaps=Image.fromarray(tri), return_tensors="pt")
            out = self.vit(pixel_values=inp["pixel_values"].cuda()).alphas[0, 0, :crop.shape[0], :crop.shape[1]].float().cpu().numpy()
        if s > 1:
            out = cv2.resize(out, (m.shape[1], m.shape[0]), interpolation=cv2.INTER_AREA)
        full = np.zeros((H, W), np.uint8)
        full[y0:y1, x0:x1] = (np.where(fg, 1.0, np.where(unk, out, 0.0)) * 255).clip(0, 255).astype(np.uint8)
        return full


# ------------------------------------------------------------------ the split
def normalize_regions(regions, W, H):
    out, used = [], set()
    for i, r in enumerate(regions or []):
        box, kind = r.get("box"), str(r.get("kind") or "")
        if kind == "group" or not isinstance(box, (list, tuple)) or len(box) != 4:
            continue
        if kind not in ELEMENT_KINDS + ("panel", "text", "prop"):
            continue
        x0, y0, x1, y1 = [float(v) for v in box]
        px = [max(0.0, x0 * W / 1000), max(0.0, y0 * H / 1000), min(float(W), x1 * W / 1000), min(float(H), y1 * H / 1000)]
        if px[2] - px[0] < 4 or px[3] - px[1] < 4:
            continue
        rid = str(r.get("id") or "r%d" % (i + 1))
        if rid in used:
            continue
        used.add(rid)
        out.append({"id": rid, "name": str(r.get("name") or rid)[:120], "kind": "element" if kind in ELEMENT_KINDS else kind, "box": px,
                    "parent": str(r.get("parentId") or ""), "text": str(r.get("text") or "")[:200]})
    if not out:
        raise SplitError("没有可拆分的区域，请先识别或框选")
    return out


def split(image, regions, comfy_url, comfy_root, models_dir, seed=None, progress=None):
    """image: PIL image. Returns the layer package described at the top of this file."""
    rgb = np.asarray(image.convert("RGB"))
    H, W = rgb.shape[:2]
    R = normalize_regions(regions, W, H)
    seed = int(seed if seed is not None else time.time()) % 2 ** 31
    comfy = Comfy(comfy_url)
    T, t = {}, time.time()

    def step(key, label):
        nonlocal t
        T[key] = round(time.time() - t, 1)
        t = time.time()
        if progress:
            progress(label)

    if progress:
        progress("加载分割模型")
    seg = Segmenter(comfy_root, models_dir)
    try:
        seg.set_image(rgb)
        ui = [r for r in R if r["kind"] != "prop"]
        props = [r for r in R if r["kind"] == "prop"]
        # ---- masks of the UI regions
        for r in ui:
            x0, y0, x1, y1 = r["box"]
            area = (x1 - x0) * (y1 - y0)
            if r["kind"] == "text":
                m = np.zeros((H, W), bool)
                m[int(y0):int(math.ceil(y1)), int(x0):int(math.ceil(x1))] = True
                r["mask"], r["alpha"] = m, (m * 255).astype(np.uint8)
                continue
            m = seg.box(r["box"])
            if r["kind"] == "panel":
                if m is None or m.sum() < 0.5 * area:
                    m, r["boxed"] = _rounded_box(r["box"], W, H) if area < 0.2 * W * H else None, True
                    if m is None:           # a board with no outline of its own: it is part of the scene
                        m = np.zeros((H, W), bool)
                        m[int(y0):int(y1) + 1, int(x0):int(x1) + 1] = True
                else:
                    hull = np.zeros((H, W), np.uint8)
                    cv2.fillConvexPoly(hull, cv2.convexHull(cv2.findNonZero(m.astype(np.uint8))), 1)
                    if _fill_holes(m).sum() < 0.93 * hull.sum():
                        m = _rounded_box(r["box"], W, H)      # a torn outline on what is really a bar
            elif m is None:
                m = _rounded_box(r["box"], W, H)
                r["boxed"] = True
            else:
                m = _biggest(_mor(m, cv2.MORPH_CLOSE, 2))
            m = _fill_holes(m)
            r["mask"] = m
            r["alpha"] = seg.matte(rgb, m)
        # a large outline-less board stays in the scene: it is exported, but not removed from the background
        for r in ui:
            x0, y0, x1, y1 = r["box"]
            r["keep_in_scene"] = bool(r.get("boxed")) and r["kind"] == "panel" and (x1 - x0) * (y1 - y0) >= 0.2 * W * H
        step("cut", "抠出 %d 个区域" % len(ui))

        # ---- hierarchy: the confirmed parent when it really contains the child, else the smallest container
        ids = {r["id"]: i for i, r in enumerate(ui)}
        areas = [int(r["mask"].sum()) for r in ui]
        parent = []
        for i, r in enumerate(ui):
            p = ids.get(r["parent"], -1)
            if p == i or p < 0 or (ui[p]["mask"] & r["mask"]).sum() < 0.5 * areas[i]:
                p = -1
                for j in range(len(ui)):
                    if j != i and ui[j]["kind"] == "panel" and areas[j] > 1.3 * areas[i] and (ui[j]["mask"] & r["mask"]).sum() > 0.8 * areas[i] and (p < 0 or areas[j] < areas[p]):
                        p = j
            parent.append(p)
        depth, root = [], []
        for i in range(len(ui)):
            d, p, rt = 0, parent[i], i
            while p >= 0 and d < 6:
                d, rt, p = d + 1, p, parent[p]
            depth.append(d)
            root.append(rt)
        kids = {i: [j for j in range(len(ui)) if parent[j] == i] for i in range(len(ui))}
        # a child that sticks out over its plate's edge must not leave its outline in the plate
        for i, r in enumerate(ui):
            if not kids[i] or r["kind"] != "panel":
                continue
            ch = np.zeros((H, W), bool)
            for j in kids[i]:
                ch |= _mor(ui[j]["alpha"] > 8, cv2.MORPH_DILATE, 2)
            body = _row_col_fill(_mor(r["mask"] & ~ch, cv2.MORPH_OPEN, 2))
            if (r["mask"] & ~body).sum() > 50 and body.sum() > 0.5 * r["mask"].sum():
                r["mask"] &= body
                soft = (cv2.GaussianBlur(r["mask"].astype(np.float32), (0, 0), 0.8) * 255).astype(np.uint8)
                near = _mor(ch, cv2.MORPH_DILATE, 3)
                r["alpha"] = np.where(near, np.where(r["mask"], soft, 0), r["alpha"]).astype(np.uint8)
                r["alpha"][r["mask"] & ch] = 255
                r["alpha"][~_mor(r["mask"], cv2.MORPH_DILATE, 2)] = 0

        # ---- peel from the top
        cur = rgb.copy()
        maxd = max(depth) if depth else 0
        for d in range(maxd, -1, -1):
            level = [i for i in range(len(ui)) if depth[i] == d and (ui[i]["alpha"] > 8).any()]
            for i in level:
                x0, y0, x1, y1 = _bbox(ui[i]["alpha"] > 8, 2, W, H)
                ui[i]["crop"] = (x0, y0, cur[y0:y1, x0:x1].copy())
            if d == 0:
                break
            for rt in sorted(set(root[i] for i in level)):
                m = np.zeros((H, W), bool)
                for i in level:
                    if root[i] == rt:
                        m |= ui[i]["alpha"] > 8
                m = _mor(m, cv2.MORPH_DILATE, 3)
                x0, y0, x1, y1 = _bbox(ui[rt]["mask"] | m, 48, W, H)
                cur[y0:y1, x0:x1] = comfy.lama(cur[y0:y1, x0:x1], m[y0:y1, x0:x1])
        step("peel", "补全底板")

        # ---- the whole UI off the scene
        ui_all = np.zeros((H, W), bool)
        for r in ui:
            if not r["keep_in_scene"] and "crop" in r:
                ui_all |= r["alpha"] > 8
        noui = cur
        if ui_all.any():
            ui_all = _mor(ui_all, cv2.MORPH_DILATE, 10)        # glows and drop shadows go with the UI
            noui = comfy.remove(np.where(ui_all[..., None], cur, rgb), ui_all, seed)
        step("scene", "去掉界面，补出场景")

        # ---- props from the UI-free picture, then the background
        background = noui
        if props:
            seg.set_image(noui)
            for r in props:
                m = seg.box(r["box"], min_fill=0.15, pad=0.15)
                r["mask"] = _fill_holes(_biggest(m)) if m is not None else None
            live = [r for r in props if r["mask"] is not None]
            for wm in seg.words(("weapon", "staff", "sword")):       # what a character holds goes with it
                if wm.sum() < 150:
                    continue
                for r in live:
                    if (_mor(r["mask"], cv2.MORPH_DILATE, 8) & wm).sum() > 30 and wm.sum() < 0.8 * r["mask"].sum():
                        r["mask"] = r["mask"] | wm
                        break
            taken = np.zeros((H, W), bool)
            for r in sorted(live, key=lambda r: int(r["mask"].sum())):   # the smaller, nearer prop wins an overlap
                r["mask"] = r["mask"] & ~taken
                taken |= r["mask"]
            allp = np.zeros((H, W), bool)
            for r in live:
                if r["mask"].sum() < 60:
                    r["mask"] = None
                    continue
                r["alpha"] = seg.matte(noui, r["mask"], erode=2, dilate=4)
                x0, y0, x1, y1 = _bbox(r["alpha"] > 8, 2, W, H)
                r["crop"] = (x0, y0, noui[y0:y1, x0:x1].copy())
                allp |= r["alpha"] > 8
            if allp.any():
                background = comfy.remove(noui, _mor(allp, cv2.MORPH_DILATE, 5), seed + 1)
        step("props", "拆出人物和场景物")
    finally:
        seg.close()

    # ---- text layers: one key-colour generation per line, all queued together
    texts = [r for r in ui if r["kind"] == "text"]
    jobs = []
    for k, r in enumerate(texts):
        x0, y0, x1, y1 = r["box"]
        px, py = max(10, (x1 - x0) * 0.2), max(8, (y1 - y0) * 0.55)
        cb = [int(max(0, x0 - px)), int(max(0, y0 - py)), int(min(W, x1 + px)), int(min(H, y1 + py))]
        for o in texts:                      # pull the crop in where another text line would enter it
            if o is r:
                continue
            ob = o["box"]
            if ob[0] < cb[2] and ob[2] > cb[0] and ob[1] < cb[3] and ob[3] > cb[1]:
                if ob[3] <= y0 + 2:
                    cb[1] = max(cb[1], int(ob[3]) + 1)
                elif ob[1] >= y1 - 2:
                    cb[3] = min(cb[3], int(ob[1]) - 1)
                elif ob[2] <= x0 + 2:
                    cb[0] = max(cb[0], int(ob[2]) + 1)
                elif ob[0] >= x1 - 2:
                    cb[2] = min(cb[2], int(ob[0]) - 1)
        if cb[2] - cb[0] < 6 or cb[3] - cb[1] < 6:
            continue
        crop = Image.fromarray(rgb[cb[1]:cb[3], cb[0]:cb[2]])
        s = min(6.0, max(1.0, (512 * 512 / (crop.width * crop.height)) ** 0.5))
        size = (max(64, round(crop.width * s / 32) * 32), max(64, round(crop.height * s / 32) * 32))
        big = crop.resize(size, Image.LANCZOS)
        arr = np.asarray(big, np.float32)
        gx0, gy0 = int((x0 - cb[0]) * size[0] / crop.width), int((y0 - cb[1]) * size[1] / crop.height)
        gx1, gy1 = int((x1 - cb[0]) * size[0] / crop.width), int((y1 - cb[1]) * size[1] / crop.height)
        inner = arr[gy0:gy1, gx0:gx1].reshape(-1, 3)
        # the key colour furthest from what is inside the text box
        which = max(KEYS, key=lambda n: float(np.percentile(np.linalg.norm(inner - np.array(KEYS[n][0], np.float32), axis=1), 20)) if len(inner) else 0)
        prompt = (KEY_PROMPT % (r["text"], KEYS[which][1])) if r["text"] else (KEY_PROMPT_ANY % KEYS[which][1])
        jobs.append((r, cb, size, which, comfy.queue(comfy.turbo_edit_graph(comfy.upload(big, "txt"), prompt, seed + 100 + k))))
    for r, cb, size, which, pid in jobs:
        img = comfy.result(pid, 14).resize(size, Image.LANCZOS)
        fg, alpha, flat = key_out(np.asarray(img), KEYS[which][0])
        if flat < 0.7 or not 0.01 < float(alpha.mean()) < 0.7:
            continue                                   # the model did not draw a flat key: keep the cut-out fallback
        rgba = np.dstack([fg, alpha * 255]).astype(np.uint8)
        im = Image.fromarray(rgba, "RGBA").resize((cb[2] - cb[0], cb[3] - cb[1]), Image.LANCZOS)
        bb = im.getbbox()
        if bb:
            r["text_layer"] = (cb[0] + bb[0], cb[1] + bb[1], np.asarray(im.crop(bb)))
    T["text"] = round(time.time() - t, 1)
    if progress:
        progress("生成文字层")

    # ---- package, bottom to top
    layers = [{"id": "background", "name": "背景", "group": "background", "x": 0, "y": 0, "width": W, "height": H, "png": _png(background)}]

    def add(r, group, x0, y0, rgba):
        item = {"id": r["id"], "name": r["name"], "group": group, "x": int(x0), "y": int(y0), "width": int(rgba.shape[1]), "height": int(rgba.shape[0]), "png": _png(rgba)}
        if r.get("text"):
            item["text"] = r["text"]
        if r.get("parent"):
            item["parentId"] = r["parent"]
        layers.append(item)

    for r in sorted([r for r in props if r.get("mask") is not None], key=lambda r: -int(r["mask"].sum())):
        x0, y0, crop = r["crop"]
        a = r["alpha"][y0:y0 + crop.shape[0], x0:x0 + crop.shape[1]]
        add(r, "prop", x0, y0, np.dstack([_clean_rgb(crop, a), a]))
    order = sorted([i for i in range(len(ui)) if "crop" in ui[i] and ui[i]["kind"] != "text"], key=lambda i: (depth[i], -areas[i]))
    for i in order:
        r = ui[i]
        x0, y0, crop = r["crop"]
        a = r["alpha"][y0:y0 + crop.shape[0], x0:x0 + crop.shape[1]]
        add(r, "panel" if r["kind"] == "panel" else "element", x0, y0, np.dstack([_clean_rgb(crop, a), a]))
    for r in texts:
        if "text_layer" in r:
            x0, y0, rgba = r["text_layer"]
            add(r, "text", x0, y0, rgba)
        elif "crop" in r:                      # fallback: the box cut from the original
            x0, y0, crop = r["crop"]
            bx0, by0, bx1, by1 = [int(v) for v in r["box"]]
            add(r, "text", bx0, by0, np.dstack([rgb[by0:by1, bx0:bx1], np.full((by1 - by0, bx1 - bx0), 255, np.uint8)]))
    T["total"] = round(sum(T.values()), 1)
    return {"width": W, "height": H, "layers": layers, "timing": T, "seed": seed}


# ------------------------------------------------------------------ service entry
def split_request(payload, comfy_root, models_dir):
    """Called by prompt-assistant-service for purpose 'ui-layer-split'. Layers go back as PNG data URLs."""
    import base64
    images = payload.get("images") or []
    if len(images) != 1 or not str(images[0].get("dataUrl") or "").startswith("data:image/"):
        raise ValueError("拆图需要一张原图")
    comfy_url = str(payload.get("comfyUrl") or os.environ.get("NOVAFLOW_COMFY_URL") or "http://127.0.0.1:8188")
    image = Image.open(io.BytesIO(base64.b64decode(images[0]["dataUrl"].split(",", 1)[1])))
    result = split(image, payload.get("regions"), comfy_url, comfy_root, models_dir, seed=payload.get("seed"))
    for layer in result["layers"]:
        layer["dataUrl"] = "data:image/png;base64," + base64.b64encode(layer.pop("png")).decode("ascii")
    return {"visualSchema": "nf.ui.layers.v1", "maskProduced": True, **result}


if __name__ == "__main__":
    # python ui_layer_split.py <image> <regions.json> <out dir> [comfy url] [comfy root] [models dir]
    src, reg, out = sys.argv[1:4]
    url = sys.argv[4] if len(sys.argv) > 4 else "http://127.0.0.1:8188"
    croot = sys.argv[5] if len(sys.argv) > 5 else r"C:\ProgramData\Foart\AI-Runtime\engine\ComfyUI"
    mdir = sys.argv[6] if len(sys.argv) > 6 else r"E:\Foart\models"
    os.makedirs(out, exist_ok=True)
    res = split(Image.open(src), json.load(open(reg, encoding="utf-8")), url, croot, mdir, seed=20261111, progress=lambda s: print("..", s, flush=True))
    meta = []
    for z, layer in enumerate(res["layers"]):
        fn = "%02d_%s_%s.png" % (z, layer["group"], "".join(c if c.isalnum() else "_" for c in layer["id"])[:40])
        open(os.path.join(out, fn), "wb").write(layer.pop("png"))
        meta.append({**layer, "file": fn, "z": z})
    json.dump({"width": res["width"], "height": res["height"], "timing": res["timing"], "layers": meta}, open(os.path.join(out, "layers.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("TIMING", json.dumps(res["timing"]), "layers", len(meta), flush=True)
