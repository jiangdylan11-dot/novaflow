"""Pixel preparation for H3 reference assets; no generated subject replacement."""
import torch
import torch.nn.functional as F
import numpy as np
from scipy.ndimage import label, gaussian_filter, distance_transform_edt


def single_component(foreground):
    components, _ = label(foreground.cpu().numpy())
    sizes = np.bincount(components.ravel())[1:]
    return len(sizes) > 0 and sizes.max() / sizes.sum() >= .98


def resize(image, height, width):
    return F.interpolate(image.movedim(-1, 1), (height, width), mode="bilinear", align_corners=False).movedim(1, -1)


def prepare(image, mask, width, height, preserve_video_layout=False, reference_video=None):
    image = image[:1]
    h, w = image.shape[1:3]
    alpha = None
    if mask is not None and tuple(mask.shape[-2:]) == (h, w):
        alpha = (1 - mask[:1]).clamp(0, 1).unsqueeze(-1)
    # LoadImage exposes hidden RGB under transparent pixels. H3 accepts RGB
    # only, so flatten alpha before any resizing, including fallback paths.
    color = image.new_tensor([.5, .5, .5])
    flat_frame = None
    if reference_video is not None:
        frame = resize(reference_video[:1], height, width)[0]
        border = torch.cat((frame[0], frame[-1], frame[:, 0], frame[:, -1]))
        candidate = border.median(dim=0).values
        if float(((border - candidate).abs().amax(-1) < .06).float().mean()) >= .99:
            color, flat_frame = candidate, frame
    flattened = image if alpha is None else image * alpha + color * (1 - alpha)
    # The H3 encoder only downsizes references. Small sprites otherwise become
    # a handful of visual tokens, overwhelmed by a complete reference video.
    scale = max(1.0, (width * height / (w * h)) ** .5)
    result = resize(flattened, max(32, round(h * scale)), max(32, round(w * scale)))
    if not preserve_video_layout or reference_video is None or mask is None:
        return result
    if tuple(mask.shape[-2:]) != (h, w) or float(mask.max()) < .5 or float(mask.min()) > .5:
        return result
    # Only flat-background sprite videos are eligible. Never guess a mask for
    # people, scenery, textured backgrounds or subjects touching the frame.
    if flat_frame is None:
        return result
    frame = flat_frame
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
        # Suppress surface markings while retaining low-frequency lighting and
        # a narrow original boundary. A uniform gray silhouette cannot tell
        # which side is the coin's rim, so it can reverse a rotation.
        mask = foreground.cpu().numpy()
        pixels = frame.cpu().numpy()
        top, bottom = max(0, y0-20), min(frame.shape[0], y1+20)
        left, right = max(0, x0-20), min(frame.shape[1], x1+20)
        m = mask[top:bottom, left:right]
        rgb = pixels[top:bottom, left:right]
        size = min(y1-y0, x1-x0)
        sigma = max(3, size * .17)
        weights = gaussian_filter(m.astype(np.float32), sigma)
        smooth = gaussian_filter(rgb * m[..., None], (sigma, sigma, 0)) / np.maximum(weights[..., None], 1e-6)
        blend = np.clip((distance_transform_edt(m)-2) / max(2, size*.04), 0, 1)[..., None]
        prepared = rgb * (1-blend) + smooth * blend
        result[index, top:bottom, left:right] = torch.from_numpy(prepared).to(device=images.device, dtype=images.dtype)
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


def sprite_bounds(frame):
    border = torch.cat((frame[0], frame[-1], frame[:, 0], frame[:, -1]))
    color = border.median(dim=0).values
    if float(((border-color).abs().amax(-1) < .06).float().mean()) < .99:
        return None
    foreground = (frame-color).abs().amax(-1) > .12
    coords = foreground.nonzero()
    if not len(coords) or float(foreground.float().mean()) > .6 or not single_component(foreground):
        return None
    y0, x0 = coords.amin(0).tolist()
    y1, x1 = (coords.amax(0)+1).tolist()
    if x0 < 3 or y0 < 3 or x1 > frame.shape[1]-3 or y1 > frame.shape[0]-3:
        return None
    return color, (y0, x0, y1, x1)


def match_reference_layout(images, reference_video, fps, source_fps):
    """Uniform scale and source-center alignment for isolated flat sprites.

    Generated artwork and its changing silhouette remain model outputs. Never
    stretch each pose to a source silhouette or align ambiguous/complex scenes.
    """
    if fps <= 0 or source_fps <= 0 or (len(images)-1)/fps > (len(reference_video)-1)/source_fps + .5/fps:
        return images
    indices = [min(len(reference_video)-1, round(i*source_fps/fps)) for i in range(len(images))]
    sources = [sprite_bounds(reference_video[i]) for i in indices]
    generated = [sprite_bounds(frame) for frame in images]
    if any(item is None for item in sources+generated):
        return images
    height, width = images.shape[1:3]
    sh, sw = reference_video.shape[1:3]
    _, (sy0, sx0, sy1, sx1) = sources[0]
    _, (gy0, gx0, gy1, gx1) = generated[0]
    # Both opening silhouettes must be broadside before fitting one constant
    # scale. An edge-on opening cannot determine physical size reliably.
    if not (.8 < (sx1-sx0)/(sy1-sy0) < 1.2 and .8 < (gx1-gx0)/(gy1-gy0) < 1.2):
        return images
    scale = min((sx1-sx0)*width/sw/(gx1-gx0), (sy1-sy0)*height/sh/(gy1-gy0))
    if not .25 <= scale <= 4:
        return images
    result = torch.empty_like(images)
    for index, (frame, source, output) in enumerate(zip(images, sources, generated)):
        source_color, (sy0, sx0, sy1, sx1) = source
        output_color, (y0, x0, y1, x1) = output
        top, left, bottom, right = y0-3, x0-3, y1+3, x1+3
        crop = frame[None, top:bottom, left:right]
        alpha = ((crop-output_color).abs().amax(-1, keepdim=True)-.03).div(.09).clamp(0, 1)
        premultiplied = (crop-output_color*(1-alpha)).clamp(0, 1)
        rh, rw = max(1, round((bottom-top)*scale)), max(1, round((right-left)*scale))
        dest_y = round((sy0+sy1)*height/sh/2-rh/2)
        dest_x = round((sx0+sx1)*width/sw/2-rw/2)
        if dest_y < 0 or dest_x < 0 or dest_y+rh > height or dest_x+rw > width:
            return images
        result[index] = source_color
        rgb, matte = resize(premultiplied, rh, rw)[0], resize(alpha, rh, rw)[0]
        result[index, dest_y:dest_y+rh, dest_x:dest_x+rw] = rgb+source_color*(1-matte)
    return result.clamp(0, 1)


class NovaFlowH3MatchReferenceLayout:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "reference_video": ("IMAGE",),
                             "fps": ("FLOAT", {"default": 24}), "source_fps": ("FLOAT", {"default": 24})}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "run"
    CATEGORY = "NovaFlow/H3"

    def run(self, **kwargs):
        return (match_reference_layout(**kwargs),)


NODE_CLASS_MAPPINGS = {"NovaFlowH3PrepareReferenceImage": NovaFlowH3PrepareReferenceImage,
                       "NovaFlowH3PrepareMotionReference": NovaFlowH3PrepareMotionReference,
                       "NovaFlowH3MatchReferenceLayout": NovaFlowH3MatchReferenceLayout}
