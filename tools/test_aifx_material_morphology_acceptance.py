#!/usr/bin/env python3
"""Synthetic regression tests for aifx_material_morphology_acceptance.py."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError as dependency_error:  # optional offline acceptance dependencies
    raise unittest.SkipTest(
        f"optional morphology acceptance dependencies are unavailable: {dependency_error}"
    ) from dependency_error

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import aifx_material_morphology_acceptance as acceptance  # noqa: E402
except SystemExit as dependency_error:  # cv2 is checked by the acceptance module
    if "requires numpy, Pillow" not in str(dependency_error):
        raise
    raise unittest.SkipTest(str(dependency_error)) from dependency_error


def write_frame(directory: Path, index: int, mask: np.ndarray, color: tuple[int, int, int]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    rgba = np.zeros((*mask.shape, 4), dtype=np.uint8)
    rgba[mask, :3] = color
    rgba[mask, 3] = 255
    Image.fromarray(rgba, mode="RGBA").save(directory / f"frame_{index:03d}.png")


def base_mask(width: int = 64, height: int = 64) -> np.ndarray:
    mask = np.zeros((height, width), dtype=bool)
    mask[22:42, 9:55] = True
    return mask


def reconstructed_mask(width: int = 64, height: int = 64) -> np.ndarray:
    mask = base_mask(width, height)
    mask[22:28, 9:18] = False
    mask[36:42, 46:55] = False
    mask[27:33, 25:31] = False
    mask[17:22, 18:26] = True
    mask[42:47, 36:44] = True
    mask[19:22, 43:49] = True
    return mask


def thin_lightning_masks(width: int = 64, height: int = 64) -> tuple[np.ndarray, np.ndarray]:
    straight = np.zeros((height, width), dtype=bool)
    straight[32, 1:63] = True
    branched = np.zeros((height, width), dtype=bool)
    branched[32, 26:38] = True
    for offset in range(26):
        branched[32 - offset // 3, 26 - offset] = True
        branched[32 + offset // 3, 37 + offset] = True
    return straight, branched


class MaterialMorphologyAcceptanceTests(unittest.TestCase):
    def load(self, directory: Path) -> list[acceptance.FrameData]:
        return acceptance.load_sequence(directory, 0.05, 0.05, "auto")

    def test_shape_proxies_separate_recolor_from_reconstruction(self) -> None:
        source = base_mask()
        recolor = source.copy()
        reconstructed = reconstructed_mask()

        source_canonical = acceptance.canonicalize_mask(source)
        recolor_canonical = acceptance.canonicalize_mask(recolor)
        reconstructed_canonical = acceptance.canonicalize_mask(reconstructed)
        recolor_change = 1.0 - acceptance.mask_iou(source_canonical, recolor_canonical)
        reconstructed_change = 1.0 - acceptance.mask_iou(source_canonical, reconstructed_canonical)
        topology_change = acceptance.topology_delta(
            acceptance.topology_features(source),
            acceptance.topology_features(reconstructed),
        )["score"]

        self.assertEqual(recolor_change, 0.0)
        self.assertGreater(reconstructed_change, 0.10)
        self.assertGreater(topology_change, 0.0)
        self.assertGreater(acceptance.topology_features(reconstructed)["hole_count"], 0)

    def test_canonicalization_preserves_full_span_thin_lightning_geometry(self) -> None:
        straight, branched = thin_lightning_masks()
        matrix = acceptance.canonical_matrix(straight)
        self.assertIsNotNone(matrix)
        projected_left = matrix @ np.asarray([1.0, 32.0, 1.0])
        projected_right = matrix @ np.asarray([62.0, 32.0, 1.0])
        self.assertGreaterEqual(float(projected_left[0]), 2.0)
        self.assertLessEqual(float(projected_right[0]), 125.0)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            straight_dir = root / "straight"
            branched_dir = root / "branched"
            write_frame(straight_dir, 0, straight, (140, 220, 255))
            write_frame(branched_dir, 0, branched, (140, 220, 255))
            pairwise = acceptance.analyze_pairwise_isomorphism(
                ["straight", "branched"],
                {"straight": self.load(straight_dir), "branched": self.load(branched_dir)},
                [0],
                {
                    "pairwise_mask_iou_alert_min": 0.88,
                    "pairwise_boundary_f1_alert_min": 0.90,
                    "pairwise_topology_similarity_alert_min": 0.90,
                    "pairwise_exact_mask_ratio_alert_min": 0.25,
                },
            )
            self.assertEqual(pairwise[0]["status"], "clear")
            self.assertLess(pairwise[0]["canonical_mask_iou"]["median"], 0.50)
            self.assertLess(pairwise[0]["boundary_similarity"]["median"], 0.70)

    def test_contract_detects_frame_count_and_size_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_dir = root / "source"
            candidate_dir = root / "candidate"
            write_frame(source_dir, 0, base_mask(), (255, 120, 20))
            write_frame(source_dir, 1, base_mask(), (255, 120, 20))
            write_frame(candidate_dir, 0, base_mask(48, 48), (80, 180, 255))
            contract = acceptance.inspect_candidate_contract(
                self.load(source_dir), self.load(candidate_dir), require_alpha=True
            )
            codes = {failure["code"] for failure in contract["failures"]}
            self.assertFalse(contract["passed"])
            self.assertIn("FRAME_COUNT_MISMATCH", codes)
            self.assertIn("FRAME_SIZE_MISMATCH", codes)

    def test_rgb_png_cannot_satisfy_required_alpha_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "rgb"
            directory.mkdir(parents=True)
            rgb = np.zeros((64, 64, 3), dtype=np.uint8)
            rgb[base_mask()] = (255, 160, 40)
            Image.fromarray(rgb, mode="RGB").save(directory / "frame_000.png")
            frames = acceptance.load_sequence(directory, 0.05, 0.05, "alpha")
            contract = acceptance.inspect_source_contract(frames, require_alpha=True)
            self.assertFalse(frames[0].has_alpha_channel)
            self.assertEqual(frames[0].mask_source, "alpha_unavailable")
            self.assertFalse(contract["passed"])
            self.assertIn("SOURCE_ALPHA_REQUIRED", {failure["code"] for failure in contract["failures"]})

    def test_contract_rejects_missing_middle_frame_even_when_count_matches(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_dir = root / "source"
            candidate_dir = root / "candidate"
            for index in range(3):
                write_frame(source_dir, index, base_mask(), (255, 120, 20))
            for index in (0, 2, 3):
                write_frame(candidate_dir, index, base_mask(), (80, 180, 255))
            contract = acceptance.inspect_candidate_contract(
                self.load(source_dir), self.load(candidate_dir), require_alpha=True
            )
            index_failures = [
                failure for failure in contract["failures"] if failure["code"] == "FRAME_INDEX_MISMATCH"
            ]
            self.assertFalse(contract["passed"])
            self.assertEqual(contract["compatible_frame_indices"], [0])
            self.assertEqual([failure["frame"] for failure in index_failures], [1, 2])

    def test_report_flags_recolor_and_cross_material_isomorphism(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_dir = root / "source"
            fire_dir = root / "fire"
            ice_dir = root / "ice"
            output_dir = root / "report"
            for index in range(3):
                mask = base_mask()
                write_frame(source_dir, index, mask, (255, 128, 24))
                write_frame(fire_dir, index, mask, (255, 235, 110))
                write_frame(ice_dir, index, mask, (90, 190, 255))

            args = acceptance.build_parser().parse_args(
                [
                    "--source-dir",
                    str(source_dir),
                    "--sequence",
                    f"fire={fire_dir}",
                    "--sequence",
                    f"ice={ice_dir}",
                    "--output-dir",
                    str(output_dir),
                    "--require-alpha",
                ]
            )
            exit_code = acceptance.run(args)
            report = json.loads((output_dir / "acceptance.json").read_text(encoding="utf-8"))
            coordinator_key = json.loads(
                (output_dir / "grayscale-review-coordinator-key.json").read_text(encoding="utf-8")
            )

            self.assertEqual(exit_code, 2)
            self.assertEqual(report["schema_version"], "novaflow-aifx-material-morphology-acceptance-v2")
            self.assertEqual(report["final_acceptance"], "pending_manual_grayscale_blind_test")
            self.assertFalse(report["sequences"]["fire"]["morphology_reconstruction_proxy"]["evidence_present"])
            warning_codes = {item["code"] for item in report["sequences"]["fire"]["warnings"]}
            self.assertIn("MORPHOLOGY_RECONSTRUCTION_PROXY_WEAK", warning_codes)
            self.assertEqual(report["cross_material_isomorphism"][0]["status"], "alert")
            self.assertEqual(
                report["cross_material_isomorphism"][0]["alert_code"],
                "POTENTIAL_CROSS_MATERIAL_ISOMORPHISM",
            )
            self.assertEqual(report["sequences"]["fire"]["grayscale_feature_report"]["gate"], "report_only")
            self.assertTrue((output_dir / "grayscale-review-sheet.png").is_file())
            self.assertTrue(report["manual_grayscale_blind_test_gate"]["review_sheet_anonymized"])
            self.assertEqual(
                report["artifacts"]["grayscale_review_coordinator_key"],
                "grayscale-review-coordinator-key.json",
            )
            self.assertEqual(
                {row["sequence_label"] for row in coordinator_key["rows"]},
                {"source", "fire", "ice"},
            )
            self.assertEqual([row["row_id"] for row in coordinator_key["rows"]], ["A", "B", "C"])
            source_frames = self.load(source_dir)
            sequences = {"fire": self.load(fire_dir), "ice": self.load(ice_dir)}
            first_rows, first_key = acceptance.build_blind_review_rows(
                source_frames, ["fire", "ice"], sequences
            )
            second_rows, second_key = acceptance.build_blind_review_rows(
                source_frames, ["fire", "ice"], sequences
            )
            self.assertEqual([row_id for row_id, _frames in first_rows], ["A", "B", "C"])
            self.assertEqual(first_key, second_key)
            self.assertEqual(
                [row_id for row_id, _frames in first_rows],
                [row_id for row_id, _frames in second_rows],
            )


if __name__ == "__main__":
    unittest.main()
