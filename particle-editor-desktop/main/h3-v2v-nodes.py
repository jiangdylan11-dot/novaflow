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


def _trim_to_grid(n):
    """H3's frame grid is 17k+5; a reference clip is trimmed down onto it."""
    while n % 17 != 5:
        n -= 1
    return n


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
                'desaturate': ('FLOAT', {
                    'default': 1.0, 'min': 0.0, 'max': 1.0, 'step': 0.01,
                    'tooltip': 'Drain the source hue before encoding. Colour is the lowest-frequency '
                               'content in a latent and survives even a high denoise, so a colour '
                               'init hands the restyle the source palette; at 1.0 the palette comes '
                               'from the prompt alone.'}),
            },
        }

    RETURN_TYPES = ('LATENT', 'INT')
    RETURN_NAMES = ('latent', 'length')
    FUNCTION = 'encode'
    CATEGORY = 'NovaFlow/H3'
    DESCRIPTION = ('Encode footage into a MiniMax H3 AV latent for video-to-video. '
                   'Feed it to SamplerCustomAdvanced in place of the empty latent and set '
                   "BasicScheduler's denoise below 1.")

    def encode(self, vae, images, width=0, height=0, desaturate=1.0):
        n = int(images.shape[0])
        if n < 5:
            raise ValueError('MiniMax H3 needs at least 5 source frames (~0.2s at 24 fps)')
        n = _trim_to_grid(n)
        frames = images[:n]

        h, w = int(frames.shape[1]), int(frames.shape[2])
        cw = int(width) or max(CANVAS_MULTIPLE, round(w / CANVAS_MULTIPLE) * CANVAS_MULTIPLE)
        ch = int(height) or max(CANVAS_MULTIPLE, round(h / CANVAS_MULTIPLE) * CANVAS_MULTIPLE)
        if (cw, ch) != (w, h):
            frames = _resize(frames, cw, ch)
        if desaturate > 0.0:
            luma = (frames[..., 0] * 0.2126 + frames[..., 1] * 0.7152
                    + frames[..., 2] * 0.0722).unsqueeze(-1)
            frames = frames * (1.0 - desaturate) + luma * desaturate

        video = vae.encode(frames)
        # The audio stream has no source here. Zeros are what the empty-latent
        # node uses, so the model sees the same "nothing yet" it is used to.
        audio_t = int(round(n / FPS * AUDIO_LATENT_FPS))
        audio = torch.zeros([video.shape[0], 32, 2, audio_t],
                            dtype=video.dtype, device=video.device)
        return ({'samples': comfy.nested_tensor.NestedTensor((video, audio))}, n)


NODE_CLASS_MAPPINGS = {'NovaFlowH3VideoToVideoLatent': NovaFlowH3VideoToVideoLatent}
NODE_DISPLAY_NAME_MAPPINGS = {'NovaFlowH3VideoToVideoLatent': 'H3 视频转视频 潜变量'}
