"""Pixel preparation for H3 reference assets; no generated subject replacement."""
import torch
import torch.nn.functional as F
import numpy as np
from scipy.ndimage import label


def single_component(foreground):
    components, _ = label(foreground.cpu().numpy())
    sizes = np.bincount(components.ravel())[1:]
    return len(sizes) > 0 and sizes.max() / sizes.sum() >= .98


def resize(image, height, width):
    return F.interpolate(image.movedim(-1, 1), (height, width), mode="bilinear", align_corners=False).movedim(1, -1)


def prepare(image, mask, width, height, preserve_video_layout=False, reference_video=None):
    image = image[:1]
    h, w = image.shape[1:3]
    # The H3 encoder only downsizes references. Small sprites otherwise become
    # a handful of visual tokens, overwhelmed by a complete reference video.
    scale = max(1.0, (width * height / (w * h)) ** .5)
    result = resize(image, max(32, round(h * scale)), max(32, round(w * scale)))
    if not preserve_video_layout or reference_video is None or mask is None:
        return result
    if tuple(mask.shape[-2:]) != (h, w) or float(mask.max()) < .5 or float(mask.min()) > .5:
        return result
    frame = resize(reference_video[:1], height, width)[0]
    border = torch.cat((frame[0], frame[-1], frame[:, 0], frame[:, -1]))
    color = border.median(dim=0).values
    # Only flat-background sprite videos are eligible. Never guess a mask for
    # people, scenery, textured backgrounds or subjects touching the frame.
    if float(((border - color).abs().amax(-1) < .06).float().mean()) < .99:
        return result
    foreground = (frame - color).abs().amax(-1) > .12
    coords = foreground.nonzero()
    if not len(coords) or float(foreground.float().mean()) > .6:
        return result
    if not single_component(foreground):
        return result
    y0, x0 = coords.amin(0).tolist()
    y1, x1 = (coords.amax(0) + 1).tolist()
    if x0 < 2 or y0 < 2 or x1 > width-2 or y1 > height-2:
        return result
    if float(foreground[y0:y1, x0:x1].float().mean()) < .25:
        return result
    alpha = (1 - mask[:1]).clamp(0, 1).unsqueeze(-1)
    occupied = (alpha[0, :, :, 0] > .01).nonzero()
    if not len(occupied):
        return result
    sy0, sx0 = occupied.amin(0).tolist()
    sy1, sx1 = (occupied.amax(0) + 1).tolist()
    factor = min((x1-x0)/(sx1-sx0), (y1-y0)/(sy1-sy0))
    th, tw = max(1, round((sy1-sy0)*factor)), max(1, round((sx1-sx0)*factor))
    # Resize premultiplied pixels to avoid dark transparent-edge halos.
    a = resize(alpha[:, sy0:sy1, sx0:sx1], th, tw)
    rgb = resize((image * alpha)[:, sy0:sy1, sx0:sx1], th, tw)
    canvas = color.reshape(1, 1, 1, 3).expand(1, height, width, 3).clone()
    top, left = (y0+y1-th)//2, (x0+x1-tw)//2
    canvas[:, top:top+th, left:left+tw] = rgb + color * (1-a)
    return canvas


class NovaFlowH3PrepareReferenceImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",), "mask": ("MASK",),
                "width": ("INT", {"default": 640, "min": 32, "max": 4096}),
                "height": ("INT", {"default": 640, "min": 32, "max": 4096}),
                "preserve_video_layout": ("BOOLEAN", {"default": False})},
                "optional": {"reference_video": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "run"
    CATEGORY = "NovaFlow/H3"

    def run(self, **kwargs):
        return (prepare(**kwargs),)


def motion_only_flat_sprite(images):
    """Suppress source texture only when every frame has a flat background.

    Preserve the measured moving silhouette and original background. For
    complex videos return the untouched reference, letting H3 handle the edit.
    """
    result = images.clone()
    for index, frame in enumerate(images):
        border = torch.cat((frame[0], frame[-1], frame[:, 0], frame[:, -1]))
        color = border.median(dim=0).values
        if float(((border-color).abs().amax(-1) < .06).float().mean()) < .99:
            return images
        foreground = (frame-color).abs().amax(-1) > .12
        coordinates = foreground.nonzero()
        if not len(coordinates) or float(foreground.float().mean()) > .6:
            return images
        if not single_component(foreground):
            return images
        y0, x0 = coordinates.amin(0).tolist()
        y1, x1 = (coordinates.amax(0)+1).tolist()
        if x0 < 2 or y0 < 2 or x1 > frame.shape[1]-2 or y1 > frame.shape[0]-2:
            return images
        if float(foreground[y0:y1, x0:x1].float().mean()) < .25:
            return images
        # A neutral shape carries motion and geometry without the old logo,
        # face or material. No source identity pixels enter this guide.
        result[index][foreground] = .5
    return result


class NovaFlowH3PrepareMotionReference:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "run"
    CATEGORY = "NovaFlow/H3"

    def run(self, images):
        return (motion_only_flat_sprite(images),)


NODE_CLASS_MAPPINGS = {"NovaFlowH3PrepareReferenceImage": NovaFlowH3PrepareReferenceImage,
                       "NovaFlowH3PrepareMotionReference": NovaFlowH3PrepareMotionReference}
