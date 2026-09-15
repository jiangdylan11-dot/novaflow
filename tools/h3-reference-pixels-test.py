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
assert torch.all(complex_scene[0, 0, 0] == .5), 'complex background uses neutral alpha flattening'
no_layout = module.prepare(sprite, mask, 200, 200, False, video)
assert torch.equal(no_layout[0, 0, 0], torch.tensor([0., 1., 0.])), 'transparent RGB must be discarded even without layout fitting'
contaminated = sprite.clone()
contaminated[mask.bool()] = torch.tensor([1., .2, .1])
assert torch.equal(no_layout, module.prepare(contaminated, mask, 200, 200, False, video)), 'invisible RGB must never reach H3'
assert module.prepare(sprite, mask, 200, 200).shape == (1, 200, 200, 3)
motion = module.motion_only_flat_sprite(video)
assert torch.equal(motion[0, 0, 0], video[0, 0, 0])
assert torch.allclose(motion[0, 50:150, 60:140], video[0, 50:150, 60:140], atol=1e-6), 'uniform material must retain its color, not turn gray'
marked = video.clone()
marked[:, 70:80, 80:120] = .1
marked[:, 120:130, 80:120] = .1
smoothed = module.motion_only_flat_sprite(marked)
assert smoothed[0, 75, 100, 0] > marked[0, 75, 100, 0] + .2, 'old surface markings must be suppressed'
assert torch.equal(smoothed[:, 50:52, 60:140], marked[:, 50:52, 60:140]), 'original boundary must retain directional cues'
complex_video = torch.rand_like(video)
assert torch.equal(module.motion_only_flat_sprite(complex_video), complex_video)
two_sprites = video.clone()
two_sprites[:, 50:150, 60:140] = torch.tensor([0., 1., 0.])
two_sprites[:, 50:100, 20:70] = .7
two_sprites[:, 50:100, 130:180] = .7
assert torch.equal(module.motion_only_flat_sprite(two_sprites), two_sprites), 'do not erase other subjects'
spec = importlib.util.spec_from_file_location('h3_timing', root / 'particle-editor-desktop/prompt_assistant/h3_reference_vision.py')
timing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(timing)
frames = [{'label':'<Video 1>', 'timeSeconds':i*.75} for i in range(5)]
poses = []
for width in [80, 54, 8, 54, 80]:
    pose = torch.zeros(1, 200, 300, 3)
    pose[..., 1] = 1
    pose[:, 60:140, 150-width//2:150+width//2] = .7
    poses.append(pose)
assert '1.500s' in timing.disc_timing(frames, poses)['en']
assert 'green screen background' in timing.disc_timing(frames, poses)['video_en']
blue_poses = [pose[..., [0, 2, 1]] for pose in poses]
assert timing.flat_background_fact(poses[0]) == '平整的纯绿色背景'
assert timing.flat_background_fact(blue_poses[0]) == '平整的纯蓝色背景'
assert timing.flat_background_fact(torch.rand_like(poses[0])) is None
assert 'green' not in timing.disc_timing(frames, blue_poses)['en'], 'background prose must follow the actual pixels'
moving = [torch.roll(pose, i*10, dims=2) for i, pose in enumerate(poses)]
assert timing.disc_timing(frames, moving) is None, 'translation must not be described as stationary rotation'
assert timing.disc_timing(frames, [torch.rand_like(pose) for pose in poses]) is None
assert timing.disc_timing(frames, [poses[0]]*5) is None, 'a still image is not a measured rotation'
source_layout = torch.zeros(2, 200, 200, 3)
source_layout[..., 1] = 1
source_layout[0, 80:120, 100:140] = torch.tensor([0., 0., 1.])
source_layout[1, 80:120, 110:130] = torch.tensor([0., 0., 1.])
generated_layout = torch.zeros_like(source_layout)
generated_layout[..., 1] = .9
generated_layout[0, 40:120, 20:100] = torch.tensor([1., 0., 0.])
generated_layout[1, 40:120, 40:80] = torch.tensor([1., 0., 0.])
aligned = module.match_reference_layout(generated_layout, source_layout, 24, 24)
for i, expected_width in enumerate([40, 20]):
    _, (y0, x0, y1, x1) = module.sprite_bounds(aligned[i])
    assert abs(x1-x0-expected_width) <= 1 and abs((x0+x1)/2-120) <= 1
    assert abs((y0+y1)/2-100) <= 1
    assert aligned[i, 100, 120, 0] > .99 and aligned[i, 100, 120, 2] < .01, 'preserve generated red artwork; never restore blue source artwork'
    assert torch.equal(aligned[i, 0, 0], source_layout[i, 0, 0]), 'retain source background'
assert torch.equal(module.match_reference_layout(generated_layout, torch.rand_like(source_layout), 24, 24), generated_layout)
longer_output = torch.cat([generated_layout, generated_layout[:1]], dim=0)
assert torch.equal(module.match_reference_layout(longer_output, source_layout, 24, 24), longer_output), 'do not freeze a shorter source clip'
print('PASS: alpha, geometry, directional boundaries, measured timing and complex-scene fallback')
