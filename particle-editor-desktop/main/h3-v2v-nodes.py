"""Build a MiniMax H3 AV latent from existing footage, so r2v/t2v can run as v2v.

ComfyUI ships only EmptyMiniMaxH3LatentAV, so every H3 generation starts from
pure noise and the source clip can only enter as reference conditioning - which
is re-injected at every step and never denoised, and therefore pins the source's
silhouette no matter what the prompt says.

Seeding the sampler with the encoded source instead makes the constraint decay:
BasicScheduler's `denoise` decides how much of the source survives, and the
model is free to rebuild the outline out of whatever material the prompt asks
for. Shapes follow comfy_extras/nodes_minimax_h3.py exactly - video
[B,24,T,H/16,W/16] paired with audio [B,32,2,T40] in a NestedTensor.
"""
import torch

import comfy.nested_tensor
import comfy.utils

FPS = 24
AUDIO_LATENT_FPS = 40
CANVAS_MULTIPLE = 32


def _grid_below(n):
    while n % 17 != 5:
        n -= 1
    return n


def _nearest_grid(n):
    """H3 only accepts 17k+5 frames: 5, 22, 39, 56...

    This used to walk DOWN to the grid, which is fine for a clip that is
    already on it (every built-in template is 39) and ruinous for anything
    else: a 0.7s clip resamples to 17 frames at 24fps and 17 walks all the way
    down to 5, so the artist got the first fifth of a second of their effect
    and nothing after it. Rounding to the NEAREST grid point and resampling
    the whole clip into it keeps every frame of the motion; the caller sets
    the output fps so the result still plays for as long as the source did.
    """
    low = max(5, _grid_below(n))
    high = low + 17
    return low if (n - low) <= (high - n) else high


def _resample_time(images, count):
    """Pick `count` frames evenly across the whole clip, first to last."""
    have = int(images.shape[0])
    if have == count:
        return images
    if count == 1:
        return images[:1]
    index = torch.arange(count, device=images.device, dtype=torch.float64)
    index = (index * (have - 1) / (count - 1)).round().long().clamp(0, have - 1)
    return images.index_select(0, index)


def _hex_rgb(text):
    text = str(text or '').strip().lstrip('#')
    if len(text) == 3:
        text = ''.join(ch * 2 for ch in text)
    if len(text) != 6:
        return None
    try:
        return [int(text[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    except ValueError:
        return None


def _apply_tint(frames, luma, rgb, strength):
    """Paint a desaturated init in the target colour.

    Tint the body, keep the core white: at luma 1 every channel is already 1,
    so a hot core stays hot and only the mid-tones take the colour. Painting
    flat instead flattens the element into one plane of paint.
    """
    colour = torch.tensor(rgb, dtype=frames.dtype, device=frames.device)
    wash = luma * luma
    tinted = luma * (colour + (1.0 - colour) * wash)
    strength = float(strength)
    return frames * (1.0 - strength) + tinted * strength


def _resize(image, width, height):
    samples = image[..., :3].movedim(-1, 1)
    samples = comfy.utils.common_upscale(samples, width, height, "lanczos", "disabled")
    return samples.movedim(1, -1)


class NovaFlowH3VideoToVideoLatent:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'vae': ('VAE',),
                'images': ('IMAGE', {'tooltip': 'Source frames at 24 fps.'}),
            },
            'optional': {
                'width': ('INT', {'default': 0, 'min': 0, 'max': 16384, 'step': CANVAS_MULTIPLE,
                                  'tooltip': '0 keeps the source size, rounded to a multiple of 32.'}),
                'height': ('INT', {'default': 0, 'min': 0, 'max': 16384, 'step': CANVAS_MULTIPLE}),
                'length': ('INT', {'default': 0, 'min': 0, 'max': 241,
                                   'tooltip': 'Frames to encode; 0 rounds the clip to the nearest '
                                              '17k+5 (5, 22, 39...). The whole clip is resampled '
                                              'into whatever this is, so no motion is lost.'}),
                'desaturate': ('FLOAT', {
                    'default': 1.0, 'min': 0.0, 'max': 1.0, 'step': 0.01,
                    'tooltip': 'Drain the source hue before encoding. Colour is the lowest-frequency '
                               'content in a latent and survives even a high denoise, so a colour '
                               'init hands the restyle the source palette; at 1.0 the palette comes '
                               'from the prompt alone.'}),
                'tint': ('STRING', {
                    'default': '', 'multiline': False,
                    'tooltip': 'Hex colour to paint the desaturated init with, e.g. #8f7bff. '
                               'Colour survives a denoise that material detail does not, so '
                               'handing the init the TARGET palette is what lets the sampler run '
                               'at a low denoise - following the source closely - without the '
                               'result draining to grey. Empty leaves the init grey.'}),
                'tint_strength': ('FLOAT', {
                    'default': 1.0, 'min': 0.0, 'max': 1.0, 'step': 0.01,
                    'tooltip': 'How far towards the tint the init is pushed.'}),
            },
        }

    RETURN_TYPES = ('LATENT', 'INT')
    RETURN_NAMES = ('latent', 'length')
    FUNCTION = 'encode'
    CATEGORY = 'NovaFlow/H3'
    DESCRIPTION = ('Encode footage into a MiniMax H3 AV latent for video-to-video. '
                   'Feed it to SamplerCustomAdvanced in place of the empty latent and set '
                   "BasicScheduler's denoise below 1.")

    def encode(self, vae, images, width=0, height=0, length=0, desaturate=1.0,
               tint='', tint_strength=1.0):
        have = int(images.shape[0])
        if have < 5:
            raise ValueError('MiniMax H3 needs at least 5 source frames (~0.2s at 24 fps)')
        n = int(length) if int(length) > 0 else _nearest_grid(have)
        if n % 17 != 5:
            n = _nearest_grid(n)
        n = max(5, n)
        frames = _resample_time(images, n)

        h, w = int(frames.shape[1]), int(frames.shape[2])
        cw = int(width) or max(CANVAS_MULTIPLE, round(w / CANVAS_MULTIPLE) * CANVAS_MULTIPLE)
        ch = int(height) or max(CANVAS_MULTIPLE, round(h / CANVAS_MULTIPLE) * CANVAS_MULTIPLE)
        if (cw, ch) != (w, h):
            frames = _resize(frames, cw, ch)
        if desaturate > 0.0:
            luma = (frames[..., 0] * 0.2126 + frames[..., 1] * 0.7152
                    + frames[..., 2] * 0.0722).unsqueeze(-1)
            frames = frames * (1.0 - desaturate) + luma * desaturate
            rgb = _hex_rgb(tint) if float(tint_strength) > 0.0 else None
            if rgb is not None:
                frames = _apply_tint(frames, luma, rgb, tint_strength)

        video = vae.encode(frames)
        # The audio stream has no source here. Zeros are what the empty-latent
        # node uses, so the model sees the same "nothing yet" it is used to.
        audio_t = int(round(n / FPS * AUDIO_LATENT_FPS))
        audio = torch.zeros([video.shape[0], 32, 2, audio_t],
                            dtype=video.dtype, device=video.device)
        return ({'samples': comfy.nested_tensor.NestedTensor((video, audio))}, n)


NODE_CLASS_MAPPINGS = {'NovaFlowH3VideoToVideoLatent': NovaFlowH3VideoToVideoLatent}
NODE_DISPLAY_NAME_MAPPINGS = {'NovaFlowH3VideoToVideoLatent': 'H3 视频转视频 潜变量'}
