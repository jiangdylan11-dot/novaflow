"""Non-24fps references must preserve elapsed time, not reinterpret frame count."""
import importlib.util
import unittest
from pathlib import Path

import torch

spec = importlib.util.spec_from_file_location('h3_reference_nodes', Path(__file__).resolve().parents[1] / 'main/h3-reference-nodes.py')
nodes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nodes)


class ReferenceTimingTest(unittest.TestCase):
    def test_particles_crossing_border_do_not_disable_background_for_whole_clip(self):
        source = torch.zeros(3, 80, 80, 3)
        source[..., 1] = 1
        output = torch.zeros_like(source) + torch.tensor([0., .2, .6])
        source[1, :8, :8] = 1
        output[1, :8, :8] = 1
        result = nodes.restore_flat_reference_background(output, source)
        self.assertTrue(torch.equal(result[:, 40, 40], source[:, 40, 40]))
        self.assertTrue(torch.equal(result[1, :8, :8], output[1, :8, :8]))
        # A changed camera/background is not a stable flat-color video.
        source[1, ..., 1] = .5
        self.assertIs(nodes.restore_flat_reference_background(output, source), output)

    def test_a_flat_background_alone_cannot_authorize_erasing_a_person(self):
        video = torch.zeros(7, 128, 128, 3)
        video[..., 1] = 1
        video[:, 30:100, 35:93] = .7
        self.assertIs(nodes.NovaFlowH3PrepareMotionReference().run(video)[0], video)
        yy, xx = torch.meshgrid(torch.arange(128), torch.arange(128), indexing='ij')
        for i, aspect in enumerate((1, .7, .3, .12, .3, .7, 1)):
            video[i] = torch.tensor([0., 1., 0.])
            ellipse = ((xx - 64) / (25 * aspect)) ** 2 + ((yy - 64) / 25) ** 2 <= 1
            video[i][ellipse] = .7
        self.assertTrue(nodes.is_rotating_disc(video))

    def test_background_restoration_preserves_opaque_particles_and_bypasses_scenery(self):
        source = torch.zeros(2, 80, 80, 3)
        source[..., 1] = 1
        output = torch.zeros_like(source) + torch.tensor([0., .2, .6])
        for y, x in ((20, 20), (40, 50), (60, 30)):
            output[:, y:y+4, x:x+4] = torch.tensor([1., .7, .1])
        output[:, 25, 25] += .05
        result = nodes.restore_flat_reference_background(output, source)
        self.assertTrue(torch.equal(result[:, 0, 0], source[:, 0, 0]))
        self.assertTrue(torch.equal(result[:, 20:24, 20:24], output[:, 20:24, 20:24]))
        self.assertGreater(float((result[:, 25, 25] - source[:, 25, 25]).abs().max()), .01)
        self.assertIs(nodes.restore_flat_reference_background(output, torch.rand_like(source)), output)

    def test_native_24fps_keeps_the_exact_tensor(self):
        frames = torch.rand(73, 2, 3, 3)
        self.assertIs(nodes.reference_frames_24fps(frames, 24), frames)

    def test_markers_follow_elapsed_time_at_different_rates(self):
        for rate in (12, 25, 30, 60, 29.97):
            with self.subTest(rate=rate):
                # Pixel values encode the source timestamp independently of
                # the conversion's sampling algorithm.
                frames = torch.arange(round(3 * rate), dtype=torch.float64).reshape(-1, 1, 1, 1) / rate
                actual = nodes.reference_frames_24fps(frames, rate).flatten()
                expected_times = torch.arange(len(actual), dtype=torch.float64) / 24
                self.assertLessEqual(float((actual - expected_times).abs().max()), .5 / rate + 1e-8)
                self.assertLess(abs(len(actual) / 24 - len(frames) / rate), 1 / 24 + 1 / rate)
                self.assertTrue(bool((actual.diff() >= 0).all()))

    def test_unknown_timing_is_rejected_instead_of_silently_speeding_up(self):
        for rate in (0, -1, float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                nodes.reference_frames_24fps(torch.zeros(24, 1, 1, 3), rate)

    def test_16fps_export_keeps_source_time_instead_of_playing_every_frame_slower(self):
        frames = torch.arange(73, dtype=torch.float64).reshape(-1, 1, 1, 1) / 24
        actual = nodes.NovaFlowH3OutputVideoFrames().run(frames, 16)[0].flatten()
        self.assertEqual(len(actual), 49)
        self.assertEqual(float(actual[-1]), 3)
        expected = torch.arange(49, dtype=torch.float64) / 16
        self.assertLessEqual(float((actual - expected).abs().max()), 1 / 48 + 1e-8)


if __name__ == '__main__':
    unittest.main()
