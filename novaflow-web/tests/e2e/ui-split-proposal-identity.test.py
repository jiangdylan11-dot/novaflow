"""UI split identity metadata from completed calls; no model or service I/O."""
import copy
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "particle-editor-desktop"))
from prompt_assistant.ui_split_proposal import SCHEMA, propose


VALID = {"schema": SCHEMA, "style": "painted", "regions": [
    {"id": "r1", "name": "icon", "kind": "object", "box": [10, 20, 200, 300]}]}


class AssistantStub:
    def __init__(self, profile=None, adapter=None, output=None):
        self.profile_after_generate = profile
        self.last_generate_profile = {"modelId": "stale-model", "provider": "stale-provider"}
        self._qwen3_adapter = adapter
        self.output = json.dumps(VALID if output is None else output)
        self.calls = []

    def generate(self, prompt, **kwargs):
        self.calls.append((prompt, kwargs))
        self.last_generate_profile = self.profile_after_generate
        return self.output

    def qwen3_adapter(self):
        raise AssertionError("Identity must not construct or load an adapter")

    def reverse_model_path(self):
        raise AssertionError("Identity must not read another model configuration")


class UISplitIdentityTests(unittest.TestCase):
    def run_proposal(self, assistant, context=None):
        result = propose(assistant, ["CPU_IMAGE_STUB"], context)
        self.assertEqual(len(assistant.calls), 1)
        self.assertEqual(assistant.calls[0][1]["images"], ["CPU_IMAGE_STUB"])
        self.assertEqual(result["visualSchema"], SCHEMA)
        self.assertIs(result["maskProduced"], False)
        return result

    def test_flash_uses_completed_diagnostics_over_legacy_adapter_path(self):
        assistant = AssistantStub(
            {"provider": "strata", "inferenceDiagnostics": {
                "modelId": "swift-1.5-qwen38-iq2-xs", "modelSource": "strata"}},
            SimpleNamespace(model_path=Path("models/Qwen3-VL-8B-Instruct")))
        result = self.run_proposal(assistant)
        self.assertEqual((result["model"], result["provider"]),
                         ("swift-1.5-qwen38-iq2-xs", "strata"))
        self.assertEqual(result["proposal"], {**VALID, "regions": [
            {**VALID["regions"][0], "uncertain": False}]})
        self.assertEqual(result["scope"], "whole")

    def test_explicit_legacy_identity_is_preserved(self):
        assistant = AssistantStub({"provider": "qwen3-vl-instruct", "modelId": "qwen3-vl-instruct"})
        result = self.run_proposal(assistant)
        self.assertEqual((result["model"], result["provider"]),
                         ("qwen3-vl-instruct", "qwen3-vl-instruct"))

    def test_existing_legacy_model_path_is_read_without_loading(self):
        path = Path("models/Qwen3-VL-8B-Instruct")
        assistant = AssistantStub({"provider": "qwen3-vl-instruct"}, SimpleNamespace(model_path=path))
        result = self.run_proposal(assistant)
        self.assertEqual(result["model"], str(path))
        self.assertEqual(result["provider"], "qwen3-vl-instruct")

    def test_existing_flash_model_id_and_diagnostics_source(self):
        assistant = AssistantStub({"inferenceDiagnostics": {"modelSource": "strata"}},
                                  SimpleNamespace(model_id="actual-flash-id", model_path=Path(".")))
        result = self.run_proposal(assistant)
        self.assertEqual((result["model"], result["provider"]), ("actual-flash-id", "strata"))

    def test_unknown_identity_never_invents_flash_or_legacy(self):
        for profile, adapter in ((None, None), ({}, SimpleNamespace(model_path=Path("."))),
                                 ({"inferenceDiagnostics": []}, SimpleNamespace(model_path=None)),
                                 ({"provider": "strata"}, None)):
            with self.subTest(profile=profile, adapter=adapter):
                result = self.run_proposal(AssistantStub(profile, adapter))
                self.assertIsNone(result["model"])
                self.assertEqual(result["provider"], "strata" if profile == {"provider": "strata"} else None)

    def test_child_request_contract_is_unchanged(self):
        assistant = AssistantStub()
        result = self.run_proposal(assistant, {"uiSplitScope": "children", "uiSplitGroupName": "toolbar"})
        self.assertEqual(result["scope"], "children")
        self.assertEqual(assistant.calls[0][1]["max_length"], 4096)
        self.assertEqual(assistant.calls[0][1]["trace_label"], "uiSplitChildren")
        self.assertFalse(assistant.calls[0][1]["do_sample"])

    def test_schema_and_invalid_boxes_still_fail_validation(self):
        cases = [{**VALID, "schema": "other"}]
        for box in ([True, 20, 200, 300], [-1, 20, 200, 300], [10, 20, 1001, 300],
                    [200, 20, 10, 300], [10, 20, float("nan"), 300], [10, 20, 200]):
            invalid = copy.deepcopy(VALID)
            invalid["regions"][0]["box"] = box
            cases.append(invalid)
        duplicate = copy.deepcopy(VALID)
        duplicate["regions"].append(copy.deepcopy(duplicate["regions"][0]))
        cases.append(duplicate)
        for output in cases:
            with self.subTest(output=output):
                result = self.run_proposal(AssistantStub(output=output))
                self.assertIsNone(result["proposal"])
                self.assertTrue(result["validationError"])

    def test_only_one_image_allowed_before_inference(self):
        assistant = AssistantStub()
        for images in ([], ["a", "b"]):
            with self.assertRaisesRegex(ValueError, "一张原图"):
                propose(assistant, images)
        self.assertEqual(assistant.calls, [])


if __name__ == "__main__":
    unittest.main()
