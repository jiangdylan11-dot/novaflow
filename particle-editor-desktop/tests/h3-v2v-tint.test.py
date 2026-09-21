"""The init is painted in the target colour, not left grey.

A denoise low enough to follow the source's evolution is not enough freedom for
the sampler to put a palette back: measured on a looping fountain, venom came
out at 0.077 saturation against its source's 0.644 at denoise 0.55. Handing the
init the preset's own accent instead reads 0.569 at the same denoise, so the
colour comes from the init and denoise is free to buy following alone.
"""
import importlib.util
import sys
import types
import unittest
from pathlib import Path

import torch

# The node runs inside ComfyUI; nothing here touches those two modules, so a
# stub is enough to import the file outside the runtime.
for _name in ('comfy', 'comfy.nested_tensor', 'comfy.utils'):
    _module = sys.modules.setdefault(_name, types.ModuleType(_name))
    if '.' in _name:
        setattr(sys.modules['comfy'], _name.split('.')[1], _module)

spec = importlib.util.spec_from_file_location(
    'h3_v2v_nodes', Path(__file__).resolve().parents[1] / 'main/h3-v2v-nodes.py')
nodes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nodes)


def grey(value):
    frames = torch.full((1, 2, 2, 3), float(value))
    luma = frames[..., :1].clone()
    return frames, luma


class HexTest(unittest.TestCase):
    def test_reads_the_shapes_a_preset_accent_comes_in(self):
        self.assertEqual(nodes._hex_rgb('#ff0000'), [1.0, 0.0, 0.0])
        self.assertEqual(nodes._hex_rgb('ff0000'), [1.0, 0.0, 0.0])
        self.assertEqual(nodes._hex_rgb('#f00'), [1.0, 0.0, 0.0])

    def test_anything_else_leaves_the_init_grey(self):
        for text in ('', None, '#', 'rgb(1,2,3)', '#12345', '#zzzzzz'):
            self.assertIsNone(nodes._hex_rgb(text), text)


class TintTest(unittest.TestCase):
    def test_the_body_takes_the_colour(self):
        frames, luma = grey(0.5)
        out = nodes._apply_tint(frames, luma, [1.0, 0.0, 0.0], 1.0)
        self.assertAlmostEqual(float(out[..., 0].mean()), 0.5, places=5)
        # Green and blue keep only the white wash, so the pixel reads red.
        self.assertLess(float(out[..., 1].mean()), float(out[..., 0].mean()))
        self.assertAlmostEqual(float(out[..., 1].mean()), float(out[..., 2].mean()), places=6)

    def test_a_hot_core_stays_white(self):
        frames, luma = grey(1.0)
        out = nodes._apply_tint(frames, luma, [0.56, 0.48, 1.0], 1.0)
        self.assertTrue(torch.allclose(out, torch.ones_like(out), atol=1e-6))

    def test_black_stays_black(self):
        frames, luma = grey(0.0)
        out = nodes._apply_tint(frames, luma, [1.0, 0.35, 0.12], 1.0)
        self.assertTrue(torch.allclose(out, torch.zeros_like(out), atol=1e-6))

    def test_strength_blends_back_towards_grey(self):
        frames, luma = grey(0.5)
        full = nodes._apply_tint(frames, luma, [1.0, 0.0, 0.0], 1.0)
        half = nodes._apply_tint(frames, luma, [1.0, 0.0, 0.0], 0.5)
        none = nodes._apply_tint(frames, luma, [1.0, 0.0, 0.0], 0.0)
        self.assertTrue(torch.allclose(none, frames, atol=1e-6))
        self.assertTrue(torch.allclose(half, (frames + full) / 2, atol=1e-6))

    def test_the_default_signature_still_leaves_the_init_grey(self):
        # Every graph built before the tint existed has to keep working.
        parameters = nodes.NovaFlowH3VideoToVideoLatent.INPUT_TYPES()['optional']
        self.assertEqual(parameters['tint'][1]['default'], '')
        self.assertEqual(parameters['tint_strength'][1]['default'], 1.0)


if __name__ == '__main__':
    unittest.main()
