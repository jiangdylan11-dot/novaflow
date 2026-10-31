"""Foart's three legacy SAM sockets, backed by Meta's segment_anything package.

Only installed checkpoints are offered; no downloads or pip installs at runtime.
The IMAGE/MASK outputs preserve the existing WAS SAM workflow contract.
"""
import ast
from pathlib import Path

import numpy as np
import torch
import folder_paths
import comfy.model_management as mm


CHECKPOINTS = {
    "ViT-B": ("vit_b", "sam_vit_b_01ec64.pth"),
    "ViT-L": ("vit_l", "sam_vit_l_0b3195.pth"),
    "ViT-H": ("vit_h", "sam_vit_h_4b8939.pth"),
}


def checkpoint(size):
    filename = CHECKPOINTS[size][1]
    roots = list(folder_paths.get_folder_paths("sam"))
    roots.append(str(Path(folder_paths.models_dir) / "sam"))
    return next((Path(root) / filename for root in roots if (Path(root) / filename).is_file()), None)


class SamLoader:
    @classmethod
    def INPUT_TYPES(cls):
        installed = [size for size in CHECKPOINTS if checkpoint(size)]
        return {"required": {"model_size": (installed or ["ViT-B"],)}}

    RETURN_TYPES = ("SAM_MODEL",)
    FUNCTION = "load"
    CATEGORY = "Foart/Masking"

    def load(self, model_size):
        from segment_anything import sam_model_registry
        source = checkpoint(model_size)
        if source is None:
            raise FileNotFoundError(f"SAM checkpoint missing: models/sam/{CHECKPOINTS[model_size][1]}")
        return (sam_model_registry[CHECKPOINTS[model_size][0]](checkpoint=str(source)).eval(),)


class SamParameters:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"points": ("STRING", {"default": "[128, 128]; [0, 0]"}),
                             "labels": ("STRING", {"default": "[1, 0]"})}}

    RETURN_TYPES = ("SAM_PARAMETERS",)
    FUNCTION = "parse"
    CATEGORY = "Foart/Masking"

    def parse(self, points, labels):
        coords = np.asarray([ast.literal_eval(p.strip()) for p in points.split(";") if p.strip()], dtype=np.float32)
        tags = np.asarray(ast.literal_eval(labels), dtype=np.int64)
        if coords.ndim != 2 or coords.shape[1] != 2 or tags.shape != (len(coords),):
            raise ValueError("SAM requires one label for each [x, y] point")
        if not np.isfinite(coords).all() or not np.isin(tags, [0, 1]).all() or not np.any(tags == 1):
            raise ValueError("SAM requires finite coordinates, labels 0/1 and a positive point")
        return ({"points": coords, "labels": tags},)


class SamImageMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"sam_model": ("SAM_MODEL",), "sam_parameters": ("SAM_PARAMETERS",), "image": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE", "MASK")
    FUNCTION = "segment"
    CATEGORY = "Foart/Masking"

    @torch.inference_mode()
    def segment(self, sam_model, sam_parameters, image):
        from segment_anything import SamPredictor
        mm.throw_exception_if_processing_interrupted()
        device = mm.get_torch_device()
        mm.free_memory(mm.module_size(sam_model) + 1024 ** 3, device)
        masks = []
        try:
            sam_model.to(device=device)
            predictor = SamPredictor(sam_model)
            for frame in image:
                mm.throw_exception_if_processing_interrupted()
                pixels = (frame[..., :3].detach().cpu().numpy().clip(0, 1) * 255).astype(np.uint8)
                predictor.set_image(pixels)
                mask, _, _ = predictor.predict(point_coords=sam_parameters["points"],
                                                point_labels=sam_parameters["labels"], multimask_output=False)
                masks.append(torch.from_numpy(mask[0].astype(np.float32)))
        finally:
            sam_model.to(device="cpu")
        result = torch.stack(masks)
        return (result.unsqueeze(-1).repeat(1, 1, 1, 3), result)


NODE_CLASS_MAPPINGS = {"SAM Model Loader": SamLoader, "SAM Parameters": SamParameters, "SAM Image Mask": SamImageMask}
