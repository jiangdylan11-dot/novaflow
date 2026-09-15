"""NovaFlow helper node for the See-through split (美工 → 一键拆图).

See-through always generates the face and its features (eyes, brows, nose, mouth, ears) as separate
layers, so the "face" layer never contains the features. When the user does not want the features split
this node re-runs See-through's head-crop pass with the head-group tag list where the "face" slot is
replaced by "head": the model then paints the complete head (face + features + ears, without hair and
without headwear) as ONE layer at head-crop resolution. The layer is written in the same outer-frame
coordinates and JSON shape as the plugin's own layers so the renderer can ingest it like any other layer.

Installed by the desktop app into the runtime's custom_nodes folder (runtime.json customNodesPath); the
See-through plugin itself is left untouched.
"""
import json
import os

import numpy as np
import torch
from PIL import Image

import folder_paths
import comfy.model_management as mm

NOVAFLOW_SEETHROUGH_HEAD_NODE_VERSION = "1"
HEAD_GROUP_TAGS = ["headwear", "head", "irides", "eyebrow", "eyewhite", "eyelash", "eyewear", "ears", "earwear", "nose", "mouth"]
HEAD_GROUP_INDEX = 1


def _crop_head(img, xywh):
    x, y, w, h = xywh
    ih, iw = img.shape[:2]
    x1, y1, x2, y2 = x, y, x + w, y + h
    if w < iw // 2:
        px = min(iw - x - w, x, w // 5)
        x1 = min(max(x - px, 0), iw)
        x2 = min(max(x + w + px, 0), iw)
    if h < ih // 2:
        py = min(ih - y - h, y, h // 5)
        y2 = min(max(y + h + py, 0), ih)
        y1 = min(max(y - py, 0), ih)
    return img[y1:y2, x1:x2], (x1, y1, x2, y2)


def _write_json(path, payload):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


class NovaFlowSeeThroughHeadLayer:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "layers": ("SEETHROUGH_LAYERS",),
                "layerdiff_model": ("SEETHROUGH_LAYERDIFF_MODEL",),
                "seed": ("INT", {"default": 42, "min": 0, "max": 2**32 - 1}),
                "resolution": ("INT", {"default": 1024, "min": 512, "max": 2048, "step": 64}),
                "num_inference_steps": ("INT", {"default": 30, "min": 1, "max": 100}),
                "filename_prefix": ("STRING", {"default": "novaflow_head"}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("head_json",)
    FUNCTION = "run"
    CATEGORY = "NovaFlow/SeeThrough"
    OUTPUT_NODE = True

    def run(self, image, layers, layerdiff_model, seed=42, resolution=1024, num_inference_steps=30, filename_prefix="novaflow_head"):
        import cv2
        from utils.cv import center_square_pad_resize, smart_resize  # on sys.path once the See-through plugin is loaded

        out_dir = folder_paths.get_output_directory()
        safe_prefix = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in str(filename_prefix)) or "novaflow_head"
        json_name = "%s_head.json" % safe_prefix
        json_path = os.path.join(out_dir, json_name)

        def fail(reason):
            _write_json(json_path, {"ok": False, "reason": reason, "version": NOVAFLOW_SEETHROUGH_HEAD_NODE_VERSION})
            print("[NovaFlow] See-through head layer skipped: %s" % reason, flush=True)
            return (json_name,)

        head_img = layers.layer_dict.get("head")
        if head_img is None:
            return fail("no_head_layer")
        nz = cv2.findNonZero((head_img[..., -1] > 15).astype(np.uint8))
        if nz is None:
            return fail("empty_head_layer")

        pipeline = layerdiff_model
        device = mm.get_torch_device()
        offload = torch.device("cpu")

        img_np = (image[0].cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
        if img_np.shape[-1] == 3:
            img_np = np.concatenate([img_np, np.full((*img_np.shape[:2], 1), 255, dtype=np.uint8)], axis=-1)
        input_img = img_np.copy()

        # Same head crop geometry as SeeThrough_GenerateLayers (v3 head pass).
        scale = layers.scale
        pad_pos = layers.pad_pos
        hx0, hy0, hw, hh = cv2.boundingRect(nz)
        hx = int(hx0 * scale) - pad_pos[0]
        hy = int(hy0 * scale) - pad_pos[1]
        input_head, (hx1, hy1, hx2, hy2) = _crop_head(input_img, [hx, hy, int(hw * scale), int(hh * scale)])
        if input_head.size == 0:
            return fail("empty_head_crop")
        frame_x1 = int(hx1 / scale + pad_pos[0] / scale)
        frame_y1 = int(hy1 / scale + pad_pos[1] / scale)
        ih, iw = input_head.shape[:2]
        input_head_sq, head_pad_size, head_pad_pos = center_square_pad_resize(input_head, resolution, return_pad_info=True)

        pipeline.text_encoder.to(device)
        pipeline.text_encoder_2.to(device)
        embeds, pooled = pipeline.encode_cropped_prompt_77tokens(HEAD_GROUP_TAGS)
        pipeline.text_encoder.to(offload)
        pipeline.text_encoder_2.to(offload)
        pipeline.unet.to(device)
        pipeline.vae.to(device)
        pipeline.trans_vae.to(device)
        mm.soft_empty_cache()
        try:
            rng = torch.Generator(device=device).manual_seed(seed)
            out = pipeline(strength=1.0, num_inference_steps=num_inference_steps, batch_size=1, generator=rng, guidance_scale=1.0,
                           prompt_embeds=embeds, pooled_prompt_embeds=pooled, fullpage=input_head_sq, group_index=HEAD_GROUP_INDEX)
        finally:
            pipeline.unet.to(offload)
            pipeline.vae.to(offload)
            pipeline.trans_vae.to(offload)
            mm.soft_empty_cache()

        head_rst = None
        for rst, tag in zip(out.images, HEAD_GROUP_TAGS):
            if tag == "head":
                head_rst = np.asarray(rst).astype(np.uint8)
        if head_rst is None:
            return fail("no_head_output")

        # Map the crop result back into the outer frame exactly like the plugin does for its head-pass layers.
        coords = np.array([head_pad_pos[1], head_pad_pos[1] + ih, head_pad_pos[0], head_pad_pos[0] + iw])
        py1, py2, px1, px2 = (coords / scale).astype(np.int64)
        scale_size = (int(head_pad_size[0] / scale), int(head_pad_size[1] / scale))
        rst = smart_resize(head_rst, scale_size)[py1:py2, px1:px2]
        frame = np.zeros((resolution, resolution, 4), dtype=np.uint8)
        h = min(rst.shape[0], resolution - frame_y1)
        w = min(rst.shape[1], resolution - frame_x1)
        if h <= 0 or w <= 0:
            return fail("head_outside_frame")
        frame[frame_y1:frame_y1 + h, frame_x1:frame_x1 + w] = rst[:h, :w]

        mask = frame[..., -1] > 10
        if not np.any(mask):
            return fail("empty_head_result")
        ys, xs = np.where(mask)
        left, top, right, bottom = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
        png_name = "%s_head.png" % safe_prefix
        Image.fromarray(frame[top:bottom, left:right]).save(os.path.join(out_dir, png_name))
        payload = {
            "ok": True,
            "version": NOVAFLOW_SEETHROUGH_HEAD_NODE_VERSION,
            "width": int(resolution),
            "height": int(resolution),
            "layer": {"name": "head", "filename": png_name, "left": left, "top": top, "right": right, "bottom": bottom},
            "head_box": [int(hx1), int(hy1), int(hx2), int(hy2)],
        }
        _write_json(json_path, payload)
        print("[NovaFlow] See-through head layer saved: %s (%dx%d)" % (png_name, right - left, bottom - top), flush=True)
        return (json_name,)


NODE_CLASS_MAPPINGS = {"NovaFlowSeeThroughHeadLayer": NovaFlowSeeThroughHeadLayer}
NODE_DISPLAY_NAME_MAPPINGS = {"NovaFlowSeeThroughHeadLayer": "NovaFlow SeeThrough Head Layer"}
