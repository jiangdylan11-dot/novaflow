"""CPU geometry, alpha-edge and scene fallback checks for H3 references."""
import importlib.util
from pathlib import Path
import torch

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('h3_pixels', root / 'particle-editor-desktop/main/h3-reference-nodes.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

sprite = torch.zeros(1, 40, 40, 3)
sprite[:, 5:35, 10:30, 0] = 1
mask = torch.ones(1, 40, 40)
mask[:, 5:35, 10:30] = 0
video = torch.zeros(1, 200, 200, 3)
video[..., 1] = 1
video[:, 50:150, 60:140] = .7
result = module.prepare(sprite, mask, 200, 200, True, video)
assert result.shape == (1, 200, 200, 3)
assert torch.equal(result[0, 0, 0], torch.tensor([0., 1., 0.]))
assert result[0, 100, 100, 0] > .99
assert result[0, 100, 100, 1] < .01
assert float(result.sum(-1).min()) > .99, 'transparent interpolation must not add dark fringes'
opaque = module.prepare(sprite, torch.zeros_like(mask), 200, 200, True, video)
assert opaque[0, 0, 0].sum() == 0, 'opaque image must not be recomposed'
torch.manual_seed(1)
complex_scene = module.prepare(sprite, mask, 200, 200, True, torch.rand_like(video))
assert torch.equal(complex_scene, opaque), 'complex background must use ordinary resizing'
no_layout = module.prepare(sprite, mask, 200, 200, False, video)
assert torch.equal(no_layout, opaque), 'motion reference alone must preserve image layout'
assert module.prepare(sprite, mask, 200, 200).shape == (1, 200, 200, 3)
motion = module.motion_only_flat_sprite(video)
assert torch.equal(motion[0, 0, 0], video[0, 0, 0])
assert torch.all(motion[0, 50:150, 60:140] == .5)
complex_video = torch.rand_like(video)
assert torch.equal(module.motion_only_flat_sprite(complex_video), complex_video)
two_sprites = video.clone()
two_sprites[:, 50:150, 60:140] = torch.tensor([0., 1., 0.])
two_sprites[:, 50:100, 20:70] = .7
two_sprites[:, 50:100, 130:180] = .7
assert torch.equal(module.motion_only_flat_sprite(two_sprites), two_sprites), 'do not erase other subjects'
print('PASS: small images, video layout, alpha edges, opaque images and complex-scene fallback')
