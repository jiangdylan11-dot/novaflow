"""CPU-only native transport and legacy business routing contracts."""
from __future__ import annotations

import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from prompt_assistant.flash_adapter import (
    FlashAdapter, _NoRedirect, MAX_RESPONSE_BYTES, begin_flash_request, end_flash_request, flash_request_summary,
)
from prompt_assistant.qwen3_vl_adapter import Qwen3VLProviderError

SPEC = importlib.util.spec_from_file_location("flash_test_service", ROOT / "prompt-assistant-service.py")
SERVICE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVICE)

ENV = {"NOVAFLOW_PROMPT_ASSISTANT_BACKEND": "strata",
       "NOVAFLOW_FLASH_BASE_URL": "http://127.0.0.1:8198",
       "NOVAFLOW_FLASH_MODEL_ID": "verified-flash-model"}


def completion(content="native answer", *, finish="stop", model=ENV["NOVAFLOW_FLASH_MODEL_ID"], usage=True):
    value = {"model": model, "choices": [{"finish_reason": finish, "message": {"role": "assistant", "content": content}}]}
    if usage:
        value["usage"] = {"prompt_tokens": 123, "completion_tokens": 45, "total_tokens": 168}
    return value


class Response:
    def __init__(self, value):
        self.body = value if isinstance(value, bytes) else json.dumps(value).encode()
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass
    def read(self, limit):
        return self.body[:limit]


class FlashAdapterTest(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, ENV, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def adapter(self, *answers, **kwargs):
        adapter = FlashAdapter("ignored-legacy-model", **kwargs)
        adapter._opener = Mock()
        adapter._opener.open.side_effect = [Response(answer) if not isinstance(answer, Exception) else answer for answer in (answers or (completion(),))]
        return adapter

    def body(self, adapter, call=0):
        return json.loads(adapter._opener.open.call_args_list[call].args[0].data)

    def test_native_roles_complete_image_order_and_pixels(self):
        adapter = self.adapter()
        image = Image.new("RGBA", (1231, 719), (80, 120, 160, 200))
        self.assertEqual(adapter.generate_parts(["source", image, "style", image, "do this"], system_text="business schema", max_new_tokens=180), "native answer")
        body = self.body(adapter)
        self.assertEqual(body["messages"][0], {"role": "system", "content": "business schema"})
        content = body["messages"][1]["content"]
        self.assertEqual([item["type"] for item in content], ["text", "image_url", "text", "image_url", "text"])
        restored = Image.open(io.BytesIO(base64.b64decode(content[1]["image_url"]["url"].split(",")[1])))
        self.assertEqual(restored.size, image.size)
        self.assertEqual(restored.tobytes(), image.tobytes())
        self.assertNotIn("<|im_start|>", json.dumps(body))
        self.assertEqual(body["max_tokens"], 1536)
        self.assertEqual(body["reasoning_budget_tokens"], 1024)
        self.assertEqual(adapter.last_generation_diagnostics["usage"]["completion_tokens"], 45)
        self.assertEqual(adapter.last_generation_diagnostics["requestedTokenLimit"], 180)

    def test_tensor_like_float_pixels_preserve_dimensions(self):
        array = np.array([[[[0.0, 0.5, 1.0], [1.0, 0.0, 0.5]]]], dtype=np.float32)
        picture = FlashAdapter._tensor_to_pil(array)
        self.assertEqual(picture.size, (2, 1))
        self.assertEqual(picture.getpixel((0, 0)), (0, 128, 255))
        with self.assertRaises(Qwen3VLProviderError):
            FlashAdapter._tensor_to_pil(np.zeros((2, 8, 8, 3)))

    def test_localhost_config_rejects_aliases_external_paths_credentials(self):
        for url in ("https://127.0.0.1:8198", "http://localhost:8198", "http://127.1:8198", "http://127.0.0.1:0", "http://127.0.0.1:99999", "http://evil:8198", "http://127.0.0.1:8198/v1", "http://a@127.0.0.1:8198", "http://127.0.0.1:8198/?a=b"):
            with self.subTest(url=url), patch.dict(os.environ, {"NOVAFLOW_FLASH_BASE_URL": url}), self.assertRaises(Qwen3VLProviderError):
                FlashAdapter()
        with patch.dict(os.environ, {"NOVAFLOW_FLASH_MODEL_ID": ""}), self.assertRaises(Qwen3VLProviderError):
            FlashAdapter()

    def test_redirect_cannot_exfiltrate_images(self):
        with self.assertRaisesRegex(Qwen3VLProviderError, "strata-redirect-refused"):
            _NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com")

    def test_errors_never_retry_and_keep_real_truncation_diagnostics(self):
        cases = [(completion(finish="length"), "strata-token-limit"),
                 (completion(model="wrong"), "strata-model-mismatch"),
                 (completion(content=""), "strata-empty-response"),
                 (b"not JSON", "strata-invalid-response"),
                 (b"x" * (MAX_RESPONSE_BYTES + 1), "strata-response-too-large"),
                 (TimeoutError("timeout"), "strata-timeout")]
        for answer, code in cases:
            with self.subTest(code=code):
                adapter = self.adapter(answer)
                with self.assertRaises(Qwen3VLProviderError) as raised:
                    adapter.generate("test", None)
                self.assertEqual(raised.exception.code, code)
                self.assertEqual(adapter._opener.open.call_count, 1)
                if code == "strata-token-limit":
                    self.assertTrue(adapter.last_generation_diagnostics["generationHitTokenLimit"])
                    self.assertEqual(adapter.last_generation_diagnostics["generatedTokens"], 45)

    def test_refusal_tools_and_missing_finish_are_not_plain_completion(self):
        for value in (completion(finish=None), completion(finish="tool_calls")):
            adapter = self.adapter(value)
            with self.assertRaisesRegex(Qwen3VLProviderError, "strata-invalid-response"):
                adapter.generate("test")

    def test_unknown_usage_is_not_fabricated(self):
        adapter = self.adapter(completion(usage=False))
        adapter.generate("test")
        self.assertIsNone(adapter.last_generation_diagnostics["generatedTokens"])
        self.assertEqual(adapter.last_generation_diagnostics["usage"], {})

    def test_budget_bounded_sampling_and_seed(self):
        adapter = self.adapter()
        adapter.generate_parts(["test"], max_new_tokens=100000, seed=42, do_sample=True, temperature=.4, top_p=.95)
        body = self.body(adapter)
        self.assertEqual(body["max_tokens"], 4096)
        self.assertEqual((body["temperature"], body["top_p"], body["seed"]), (.4, .95, 42))
        with patch.dict(os.environ, {"NOVAFLOW_FLASH_MAX_TOKENS": "1024"}), self.assertRaises(Qwen3VLProviderError):
            FlashAdapter()

    def test_batch_sequential_once_no_replay_and_usage_each(self):
        adapter = self.adapter(completion("first"), completion("second"))
        self.assertEqual(adapter.generate_batch(["a", "b"]), ["first", "second"])
        self.assertEqual(adapter.last_generation_diagnostics["generatedTokensEach"], [45, 45])
        adapter = self.adapter(completion("first"), completion(finish="length"))
        with self.assertRaisesRegex(Qwen3VLProviderError, "strata-token-limit"):
            adapter.generate_batch(["a", "b", "never reached"])
        self.assertEqual(adapter._opener.open.call_count, 2)

    def test_unload_readiness_and_cache_are_cpu_only(self):
        adapter = self.adapter()
        adapter.generate("test", unload_after=False)
        adapter.unload()
        self.assertEqual(adapter._opener.open.call_count, 1)
        self.assertTrue(adapter.readiness()["externallyManaged"])
        self.assertEqual(adapter.prepare_prequantized_cache()["cacheState"], "not-required")
        self.assertEqual(adapter._opener.open.call_count, 1)

    def test_old_control_tokens_removed_or_fail_before_transport(self):
        adapter = self.adapter()
        adapter.generate_parts(["<think>\n<|vision_start|><|image_pad|><|vision_end|>actual task"])
        self.assertEqual(self.body(adapter)["messages"][-1]["content"][0]["text"], "actual task")
        with self.assertRaises(Qwen3VLProviderError):
            adapter.generate("<|im_start|>user\nnot split")
        self.assertEqual(adapter._opener.open.call_count, 1)

    def test_service_all_factories_and_explicit_old_provider_stay_flash(self):
        assistant = SERVICE.PromptAssistant()
        assistant.read_runtime_config = lambda: {"promptAssistantReverseModelPath": "old-pe", "promptAssistantH3ModelPath": "old-30b"}
        with patch.object(SERVICE, "ComfyPEAdapter", side_effect=AssertionError("PE fallback")):
            self.assertIsInstance(assistant.qwen3_adapter(), FlashAdapter)
            self.assertEqual(assistant.reverse_provider_preference({"reverseModelProvider": "qwen2.5-vl"}), "strata")
            self.assertEqual(assistant.status_payload()["modelPath"], ENV["NOVAFLOW_FLASH_MODEL_ID"])
            self.assertEqual(assistant.prepare_reverse_cache()["modelSource"], "strata")
            def inspect_h3(*args):
                self.assertIsInstance(assistant._h3_reference_adapter, FlashAdapter)
                return {}
            assistant._optimize_h3_reference = inspect_h3
            self.assertEqual(assistant.optimize_h3_reference("source", "requirements", 4)["localProvider"], "strata")

    def test_service_chatml_split_and_h3_generation_native(self):
        assistant = SERVICE.PromptAssistant()
        adapter = self.adapter(completion("business JSON"), completion("H3 JSON"))
        assistant._qwen3_adapter = adapter
        template = "<|im_start|>system\nkeep schema<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n<think>"
        self.assertEqual(assistant.generate("task", llama_template=template), "business JSON")
        self.assertEqual(self.body(adapter)["messages"][0]["content"], "keep schema")
        self.assertEqual(assistant.last_generate_profile["provider"], "strata")
        assistant._h3_reference_adapter = adapter
        self.assertEqual(assistant.generate("task", llama_template=template, trace_label="minimaxH3ReferenceText"), "H3 JSON")
        self.assertEqual(assistant.last_generate_profile["inferenceDiagnostics"]["modelSource"], "strata")

    def test_service_failed_batch_does_not_fall_back(self):
        assistant = SERVICE.PromptAssistant()
        assistant._qwen3_adapter = Mock()
        assistant._qwen3_adapter.generate_batch.side_effect = Qwen3VLProviderError("strata-token-limit", "test")
        assistant.generate = Mock(side_effect=AssertionError("implicit replay"))
        with self.assertRaises(Qwen3VLProviderError):
            assistant.generate_many(["first", "second"])
        assistant.generate.assert_not_called()

    def test_service_visual_provider_failure_does_not_enter_generic_fallback(self):
        assistant = SERVICE.PromptAssistant()
        adapter = Mock()
        adapter.readiness.return_value = {"available": True}
        adapter.generate.side_effect = Qwen3VLProviderError("strata-timeout", "test")
        assistant.generate = Mock(side_effect=AssertionError("generic fallback"))
        with patch.object(SERVICE, "Qwen3VLAbliteratedAdapter", return_value=adapter), self.assertRaises(Qwen3VLProviderError):
            assistant.reverse_plain_static_image({"visualSchema": "nf.visual.v1"}, Image.new("RGB", (16, 16)), "")
        self.assertEqual(adapter.generate.call_count, 1)
        assistant.generate.assert_not_called()

    def test_explicit_trace_keeps_native_response_without_image_base64(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"NOVAFLOW_FLASH_TRACE_DIR": directory}):
            native = completion("complete native JSON")
            native["choices"][0]["message"]["reasoning_content"] = "native reasoning"
            adapter = self.adapter(native, completion(finish="length"))
            image = Image.new("RGB", (319, 123), (20, 80, 120))
            adapter.generate("visual business protocol", image, system_text="schema")
            first = json.loads(Path(adapter.last_generation_diagnostics["tracePath"]).read_text(encoding="utf-8"))
            self.assertEqual(first["status"], "completed")
            self.assertEqual(first["response"], native)
            evidence = first["request"]["messages"][-1]["content"][0]["image"]
            self.assertEqual((evidence["width"], evidence["height"]), image.size)
            self.assertEqual(len(evidence["sha256"]), 64)
            self.assertNotIn("base64,", json.dumps(first))
            with self.assertRaises(Qwen3VLProviderError):
                adapter.generate("truncated")
            second = json.loads(Path(adapter.last_generation_diagnostics["tracePath"]).read_text(encoding="utf-8"))
            self.assertEqual(second["status"], "error")
            self.assertEqual(second["error"]["code"], "strata-token-limit")
            self.assertEqual(second["response"]["choices"][0]["finish_reason"], "length")
            self.assertNotEqual(first["requestId"], second["requestId"])

    def test_trace_requires_explicit_absolute_local_path(self):
        for directory in ("relative/work", "//host/share"):
            with patch.dict(os.environ, {"NOVAFLOW_FLASH_TRACE_DIR": directory}), self.assertRaises(Qwen3VLProviderError):
                FlashAdapter()

    def test_trickling_reader_rechecks_overall_deadline(self):
        response = Mock()
        response.read1.return_value = b"x"
        with patch("prompt_assistant.flash_adapter.time.perf_counter", side_effect=[1, 2, 4]), self.assertRaises(TimeoutError):
            FlashAdapter._read_response(response, 3)
        self.assertEqual(response.read1.call_count, 2)

    def test_business_ledger_aggregates_separate_adapters_and_resets_for_cpu_status(self):
        first, second = completion("private native text"), completion("other private native text")
        first["id"], second["id"] = "native-a", "native-b"
        first["usage"]["completion_tokens_details"] = {"reasoning_tokens": 12}
        first["usage"]["not_usage"] = "must not leak free text"
        one, two = self.adapter(first), self.adapter(second)
        def workflow(payload):
            one.generate("private user instruction")
            two.generate("private visual task", Image.new("RGB", (13, 17)))
            return {"positivePrompt": "business result", "negativePrompt": ""}
        cpu = Mock()
        cpu.optimize_prompt.side_effect = workflow
        cpu.status_payload.return_value = {"enabled": True}
        with patch.object(SERVICE, "assistant", cpu):
            result = SERVICE.handle_request({"command": "optimizePrompt"})
            self.assertEqual(result["positivePrompt"], "business result")
            summary = result["localInference"]
            self.assertTrue(summary["inferencePerformed"])
            self.assertEqual(summary["requestCount"], 2)
            self.assertEqual(summary["maxImageCount"], 1)
            self.assertEqual([row["requestId"] for row in summary["requests"]], ["native-a", "native-b"])
            self.assertEqual(summary["requestMs"], round(sum(row["requestMs"] for row in summary["requests"]), 3))
            self.assertGreater(summary["requestMs"], 0)
            self.assertEqual(summary["requests"][0]["usage"]["completion_tokens_details"]["reasoning_tokens"], 12)
            self.assertNotIn("not_usage", summary["requests"][0]["usage"])
            self.assertNotIn("private", json.dumps(summary))
            self.assertNotIn("base64", json.dumps(summary))
            status = SERVICE.handle_request({"command": "status"})["localInference"]
            self.assertFalse(status["inferencePerformed"])
            self.assertEqual((status["requestCount"], status["requestMs"], status["requests"]), (0, 0, []))
        self.assertEqual(flash_request_summary()["requestCount"], 0)

    def test_failed_native_request_and_later_cpu_rejection_keep_actual_call_ledger(self):
        first, second = self.adapter(completion()), self.adapter(completion(finish="length"))
        def fail_native(payload):
            first.generate("first")
            second.generate("second")
        cpu = Mock()
        cpu.optimize_prompt.side_effect = fail_native
        with patch.object(SERVICE, "assistant", cpu), self.assertRaises(Qwen3VLProviderError) as raised:
            SERVICE.handle_request({"command": "optimizePrompt"})
        summary = raised.exception.diagnostics["localInference"]
        self.assertEqual(summary["requestCount"], 2)
        self.assertEqual([row["status"] for row in summary["requests"]], ["completed", "error"])
        self.assertEqual(summary["requests"][1]["finishReason"], "length")
        self.assertEqual(summary["requests"][1]["errorCode"], "strata-token-limit")
        self.assertEqual((first._opener.open.call_count, second._opener.open.call_count), (1, 1))
        self.assertEqual(flash_request_summary()["requestCount"], 0)
        adapter = self.adapter()
        def fail_cpu(payload):
            adapter.generate("successful inference before validation")
            raise ValueError("business contract failure")
        cpu.optimize_prompt.side_effect = fail_cpu
        with patch.object(SERVICE, "assistant", cpu), self.assertRaisesRegex(ValueError, "business contract failure") as rejected:
            SERVICE.handle_request({"command": "optimizePrompt"})
        self.assertEqual(rejected.exception.diagnostics["localInference"]["requestCount"], 1)

    def test_invalid_input_is_not_counted_as_a_native_http_attempt(self):
        token = begin_flash_request()
        try:
            adapter = self.adapter()
            with self.assertRaises(Qwen3VLProviderError):
                adapter.generate("<|im_start|>not native")
            self.assertFalse(flash_request_summary()["inferencePerformed"])
            adapter._opener.open.assert_not_called()
        finally:
            end_flash_request(token)


if __name__ == "__main__":
    unittest.main()
