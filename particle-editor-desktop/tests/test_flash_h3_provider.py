"""Provider metadata at both real H3 return paths, without native inference."""
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch


TESTS = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "flash_h3_provider_fixtures", TESTS / "minimax-h3-local-visual-contract.test.py"
)
FIXTURES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURES)
SERVICE = FIXTURES.SERVICE


class FlashH3ProviderTest(unittest.TestCase):
    def run_path(self, backend, *, visual):
        fixture = FIXTURES.H3LocalVisualContractTest()
        fixture.setUp()
        try:
            with patch.dict(os.environ, {"NOVAFLOW_PROMPT_ASSISTANT_BACKEND": backend}, clear=True), patch.object(SERVICE, "log_prompt_assistant_event"):
                assistant, compile_calls = fixture.assistant([FIXTURES.fl_h3_output()])
                if visual:
                    FIXTURES.FakeAdapter.outputs = [FIXTURES.contract_json(), FIXTURES.contract_json()]
                    result = assistant.reverse_image_prompt(fixture.request(
                        purpose="minimax-h3-fl2v-reverse",
                        currentPrompt="人物连续转身并保持身份",
                        requirements="duration 8 seconds",
                        images=[
                            {"dataUrl": "last-image", "role": "last_frame"},
                            {"dataUrl": "first-image", "role": "first_frame"},
                        ],
                    ))
                    self.assertEqual([call[1] for call in FIXTURES.FakeAdapter.calls], ["first-image", "last-image"])
                    self.assertEqual(compile_calls, [])
                    self.assertEqual(FIXTURES.FakeAdapter.unloads, 1)
                else:
                    result = assistant.reverse_minimax_h3_prompt(
                        "FL2VA",
                        [{"tensor": "first-image", "role": "first_frame"}, {"tensor": "last-image", "role": "last_frame"}],
                        "人物缓慢抬起视线", "duration 8 seconds", "zh-CN", {"enabled": False}, "",
                    )
                    self.assertEqual(FIXTURES.FakeAdapter.calls, [])
                    self.assertEqual(len(compile_calls), 1)
                return result
        finally:
            fixture.tearDown()

    def test_deterministic_two_frame_flash_metadata_preserves_exact_cpu_output(self):
        pe = self.run_path("pe", visual=True)
        flash = self.run_path("strata", visual=True)
        self.assertEqual(pe.pop("reverseProvider"), "qwen3_vl_abliterated_nf4+deterministic_h3")
        self.assertEqual(flash.pop("reverseProvider"), "strata+deterministic_h3")
        self.assertEqual(flash, pe)

    def test_generic_two_frame_flash_metadata_preserves_pe_schema_and_exact_output(self):
        pe = self.run_path("pe", visual=False)
        flash = self.run_path("strata", visual=False)
        self.assertNotIn("reverseProvider", pe)
        self.assertEqual(flash.pop("reverseProvider"), "strata+h3_generic")
        self.assertEqual(flash, pe)


if __name__ == "__main__":
    unittest.main()
