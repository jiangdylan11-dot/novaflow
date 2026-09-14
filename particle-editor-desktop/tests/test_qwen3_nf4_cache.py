import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


DESKTOP_ROOT = Path(__file__).resolve().parents[1]
if str(DESKTOP_ROOT) not in os.sys.path:
    os.sys.path.insert(0, str(DESKTOP_ROOT))

from prompt_assistant.qwen3_vl_adapter import (  # noqa: E402
    NF4_CACHE_INVALID_MARKER,
    NF4_CACHE_MANIFEST,
    NF4_CACHE_SCHEMA,
    Qwen3VLAbliteratedAdapter,
    Qwen3VLProviderError,
)


RUNTIME_VERSIONS = {
    "torch": "test-torch",
    "transformers": "test-transformers",
    "bitsandbytes": "test-bnb",
}


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


def make_model(path: Path, *, quantized: bool = False) -> None:
    path.mkdir(parents=True, exist_ok=True)
    config = {"architectures": ["Qwen3VLForConditionalGeneration"]}
    if quantized:
        config["quantization_config"] = {"quant_method": "bitsandbytes"}
    write_json(path / "config.json", config)
    write_json(path / "tokenizer_config.json", {"tokenizer_class": "Qwen2Tokenizer"})
    write_json(path / "preprocessor_config.json", {"processor_class": "Qwen3VLProcessor"})
    (path / "model.safetensors").write_bytes(b"test-weights")


def make_saved_prequantized_cache(path: Path) -> None:
    make_model(path, quantized=True)
    (path / "preprocessor_config.json").unlink()
    write_json(path / "processor_config.json", {"processor_class": "Qwen3VLProcessor"})


class Qwen3NF4CacheTests(unittest.TestCase):
    def setUp(self):
        if os.name == "nt":
            # A regression must fail the test, never signal the shared console.
            kill_guard = patch("os.kill", side_effect=AssertionError("Windows PID probes must not send signals"))
            kill_guard.start()
            self.addCleanup(kill_guard.stop)

    @unittest.skipUnless(os.name == "nt", "Windows process query")
    def test_windows_pid_probe_queries_state_and_closes_handle(self):
        api = Mock()
        api.OpenProcess.return_value = 123
        with patch("ctypes.WinDLL", return_value=api):
            for wait_result, expected in ((258, True), (0, False), (0xFFFFFFFF, True)):
                with self.subTest(wait_result=wait_result):
                    api.reset_mock()
                    api.WaitForSingleObject.return_value = wait_result
                    self.assertIs(Qwen3VLAbliteratedAdapter._pid_alive(42), expected)
                    api.OpenProcess.assert_called_once_with(0x00100000, False, 42)
                    api.WaitForSingleObject.assert_called_once_with(123, 0)
                    api.CloseHandle.assert_called_once_with(123)

    @unittest.skipUnless(os.name == "nt", "Windows process query")
    def test_windows_pid_probe_preserves_lock_when_query_is_uncertain(self):
        api = Mock()
        api.OpenProcess.return_value = None
        with patch("ctypes.WinDLL", return_value=api):
            for error, expected in ((87, False), (5, True), (8, True)):
                with self.subTest(error=error), patch("ctypes.get_last_error", return_value=error):
                    self.assertIs(Qwen3VLAbliteratedAdapter._pid_alive(42), expected)
            api.WaitForSingleObject.assert_not_called()
            api.CloseHandle.assert_not_called()

    @unittest.skipUnless(os.name == "nt", "Windows process query")
    def test_windows_pid_probe_observes_child_without_interrupting_it(self):
        child_code = "import sys; print('ready', flush=True); sys.stdin.read(1); sys.exit(259)"
        with subprocess.Popen(
            [os.sys.executable, "-c", child_code], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        ) as child:
            try:
                self.assertEqual(child.stdout.readline().strip(), "ready")
                self.assertTrue(Qwen3VLAbliteratedAdapter._pid_alive(child.pid))
                self.assertIsNone(child.poll())
            finally:
                child.communicate(input="x", timeout=10)
            self.assertEqual(child.returncode, 259)
            # Exit code 259 must not be mistaken for STILL_ACTIVE.
            self.assertFalse(Qwen3VLAbliteratedAdapter._pid_alive(child.pid))

    def make_ready_cache(self, adapter: Qwen3VLAbliteratedAdapter) -> None:
        make_model(adapter.cache_path, quantized=True)
        manifest = {
            **adapter._expected_cache_manifest(RUNTIME_VERSIONS),
            "artifacts": adapter._cache_artifacts(adapter.cache_path),
            "createdAt": 1,
        }
        write_json(adapter.cache_path / NF4_CACHE_MANIFEST, manifest)

    def test_cache_readiness_checks_source_and_cache_artifacts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            cache = root / "cache"
            make_model(source)
            adapter = Qwen3VLAbliteratedAdapter(source, cache_path=cache)
            self.make_ready_cache(adapter)

            ready = adapter.cache_readiness(RUNTIME_VERSIONS)
            self.assertTrue(ready["available"])
            self.assertEqual(ready["code"], "cache-ready")

            (cache / "model.safetensors").write_bytes(b"cut")
            truncated = adapter.cache_readiness(RUNTIME_VERSIONS)
            self.assertFalse(truncated["available"])
            self.assertEqual(truncated["code"], "cache-artifacts-mismatch")

    def test_cache_readiness_accepts_saved_processor_config(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            cache = root / "cache"
            make_model(source)
            adapter = Qwen3VLAbliteratedAdapter(source, cache_path=cache)
            make_saved_prequantized_cache(cache)
            manifest = {
                **adapter._expected_cache_manifest(RUNTIME_VERSIONS),
                "artifacts": adapter._cache_artifacts(adapter.cache_path),
                "createdAt": 1,
            }
            write_json(cache / NF4_CACHE_MANIFEST, manifest)

            ready = adapter.cache_readiness(RUNTIME_VERSIONS)
            self.assertTrue(ready["available"])
            self.assertEqual(ready["code"], "cache-ready")

    def test_cache_invalid_marker_forces_explicit_rebuild(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            cache = root / "cache"
            make_model(source)
            adapter = Qwen3VLAbliteratedAdapter(source, cache_path=cache)
            self.make_ready_cache(adapter)
            write_json(cache / NF4_CACHE_INVALID_MARKER, {"schema": NF4_CACHE_SCHEMA})

            state = adapter.cache_readiness(RUNTIME_VERSIONS)
            self.assertFalse(state["available"])
            self.assertEqual(state["code"], "cache-marked-invalid")

    def test_cache_target_cannot_overlap_source(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            make_model(source)
            for cache in (source, source / "nested", source.parent):
                adapter = Qwen3VLAbliteratedAdapter(source, cache_path=cache)
                state = adapter.cache_readiness(RUNTIME_VERSIONS)
                self.assertFalse(state["available"])
                self.assertEqual(state["code"], "cache-path-overlaps-source")

    def test_unowned_existing_cache_is_never_replaced(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            cache = root / "occupied"
            make_model(source)
            cache.mkdir()
            sentinel = cache / "keep.txt"
            sentinel.write_text("user-data", encoding="utf-8")
            adapter = Qwen3VLAbliteratedAdapter(source, cache_path=cache)
            temp_cache = root / "candidate"
            make_model(temp_cache, quantized=True)

            with self.assertRaises(Qwen3VLProviderError) as raised:
                adapter._promote_cache_directory(temp_cache)
            self.assertEqual(raised.exception.code, "cache-path-unowned")
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "user-data")
            self.assertTrue(temp_cache.exists())

    def test_active_build_lock_is_not_stolen_but_stale_lock_is_recovered(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            cache = root / "cache"
            make_model(source)
            adapter = Qwen3VLAbliteratedAdapter(source, cache_path=cache)
            lock = cache.with_name(f"{cache.name}.build-lock")
            lock.mkdir(parents=True)
            write_json(lock / "owner.json", {"pid": os.getpid(), "createdAt": 1e20})
            self.assertIsNone(adapter._acquire_cache_build_lock())

            write_json(lock / "owner.json", {"pid": 2147483000, "createdAt": 0})
            acquired = adapter._acquire_cache_build_lock()
            self.assertEqual(acquired, lock)
            self.assertTrue((lock / "owner.json").is_file())


if __name__ == "__main__":
    unittest.main()
