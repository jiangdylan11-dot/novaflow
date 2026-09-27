import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
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
        # save_pretrained writes the fast tokenizer and the chat template.
        write_json(path / "tokenizer.json", {"model": {"type": "BPE"}})
        (path / "chat_template.jinja").write_text("{{ messages }}", encoding="utf-8")
    write_json(path / "config.json", config)
    write_json(path / "tokenizer_config.json", {"tokenizer_class": "Qwen2Tokenizer"})
    write_json(path / "preprocessor_config.json", {"processor_class": "Qwen3VLProcessor"})
    (path / "model.safetensors").write_bytes(b"test-weights")


def fake_runtime(from_pretrained, *, torch_version="test-torch"):
    """torch/transformers/bitsandbytes stand-ins so _load runs without a GPU."""

    torch = types.ModuleType("torch")
    torch.__version__ = torch_version
    torch.float16 = "float16"
    torch.cuda = SimpleNamespace(
        is_available=lambda: True,
        empty_cache=lambda: None,
        memory_allocated=lambda: 0,
        memory_reserved=lambda: 0,
    )
    bitsandbytes = types.ModuleType("bitsandbytes")
    bitsandbytes.__version__ = RUNTIME_VERSIONS["bitsandbytes"]
    transformers = types.ModuleType("transformers")
    transformers.__version__ = RUNTIME_VERSIONS["transformers"]
    transformers.BitsAndBytesConfig = lambda **options: options
    transformers.Qwen3VLForConditionalGeneration = SimpleNamespace(from_pretrained=from_pretrained)
    transformers.AutoProcessor = SimpleNamespace(from_pretrained=lambda *args, **kwargs: object())
    return patch.dict(sys.modules, {
        "torch": torch,
        "bitsandbytes": bitsandbytes,
        "transformers": transformers,
    })


class RecordingLoader:
    """from_pretrained stand-in: fails for the paths in `failures`, loads the rest."""

    def __init__(self, failures=None):
        self.failures = dict(failures or {})
        self.paths = []

    def __call__(self, path, **_options):
        self.paths.append(Path(path))
        error = self.failures.get(Path(path))
        if error is not None:
            raise error
        return SimpleNamespace(eval=lambda: SimpleNamespace())


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

    def make_source_and_cache(self, root: Path, **options):
        source = root / "models" / "source"
        cache = root / "cache" / "source-nf4"
        make_model(source)
        adapter = Qwen3VLAbliteratedAdapter(source, cache_path=cache, **options)
        self.make_ready_cache(adapter)
        return source, cache, adapter

    def test_cache_alone_is_ready_when_raw_folder_is_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            source, cache, adapter = self.make_source_and_cache(Path(temp))
            shutil.rmtree(source)
            manifest_before = (cache / NF4_CACHE_MANIFEST).read_bytes()

            state = adapter.readiness()
            self.assertTrue(state["available"])
            self.assertEqual(state["code"], "cache-only")
            cache_state = adapter.cache_readiness(RUNTIME_VERSIONS)
            self.assertTrue(cache_state["available"])
            self.assertTrue(cache_state["cacheOnly"])
            self.assertFalse(cache_state["runtimeVersionsDrift"])
            # Readiness checks never write into the cache or beside it.
            self.assertEqual((cache / NF4_CACHE_MANIFEST).read_bytes(), manifest_before)
            self.assertEqual([path.name for path in cache.parent.iterdir()], [cache.name])

    def test_cache_only_rejects_a_broken_cache_without_raising(self):
        def drop_quantization(cache: Path) -> None:
            write_json(cache / "config.json", {"architectures": ["Qwen3VLForConditionalGeneration"]})
            manifest = json.loads((cache / NF4_CACHE_MANIFEST).read_text(encoding="utf-8"))
            manifest["artifacts"] = Qwen3VLAbliteratedAdapter._cache_artifacts(cache)
            write_json(cache / NF4_CACHE_MANIFEST, manifest)

        breakages = (
            ("cache-marked-invalid", lambda cache: write_json(cache / NF4_CACHE_INVALID_MARKER, {"schema": NF4_CACHE_SCHEMA})),
            ("cache-incomplete", lambda cache: (cache / "tokenizer.json").unlink()),
            ("cache-incomplete", lambda cache: (cache / "chat_template.jinja").unlink()),
            ("cache-incomplete", lambda cache: (cache / "model.safetensors").unlink()),
            ("cache-artifacts-mismatch", lambda cache: (cache / "model.safetensors").write_bytes(b"cut")),
            ("cache-not-prequantized", drop_quantization),
        )
        for expected, breakage in breakages:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as temp:
                source, cache, adapter = self.make_source_and_cache(Path(temp))
                shutil.rmtree(source)
                breakage(cache)

                state = adapter.readiness()
                self.assertFalse(state["available"])
                self.assertEqual(state["code"], "model-missing")
                self.assertEqual(adapter.cache_readiness(RUNTIME_VERSIONS)["code"], expected)

    def test_moved_or_copied_raw_folder_keeps_the_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, cache, _adapter = self.make_source_and_cache(root)
            moved = root / "elsewhere" / "copied-source"
            shutil.copytree(source, moved)
            shutil.rmtree(source)
            os.utime(moved / "model.safetensors", ns=(1, 1))

            state = Qwen3VLAbliteratedAdapter(moved, cache_path=cache).cache_readiness(RUNTIME_VERSIONS)
            self.assertTrue(state["available"])
            self.assertFalse(state["cacheOnly"])

            (moved / "model.safetensors").write_bytes(b"other-weights!")
            changed = Qwen3VLAbliteratedAdapter(moved, cache_path=cache).cache_readiness(RUNTIME_VERSIONS)
            self.assertFalse(changed["available"])
            self.assertEqual(changed["code"], "cache-sourceFingerprint-mismatch")

    def test_runtime_version_drift_keeps_the_cache_available(self):
        with tempfile.TemporaryDirectory() as temp:
            _source, _cache, adapter = self.make_source_and_cache(Path(temp))
            state = adapter.cache_readiness({**RUNTIME_VERSIONS, "torch": "other-torch"})
            self.assertTrue(state["available"])
            self.assertTrue(state["runtimeVersionsDrift"])

    def test_prepare_accepts_the_cache_alone_and_needs_raw_to_rebuild(self):
        with tempfile.TemporaryDirectory() as temp:
            source, cache, adapter = self.make_source_and_cache(Path(temp))
            shutil.rmtree(source)
            loader = RecordingLoader()
            with fake_runtime(loader):
                result = adapter.prepare_prequantized_cache()
            self.assertTrue(result["ok"])
            self.assertTrue(result["cacheOnly"])
            self.assertEqual(loader.paths, [])

            (cache / "model.safetensors").write_bytes(b"cut")
            with fake_runtime(loader), self.assertRaises(Qwen3VLProviderError) as raised:
                adapter.prepare_prequantized_cache()
            self.assertEqual(raised.exception.code, "cache-rebuild-requires-source")
            self.assertEqual(loader.paths, [])

    def test_cache_is_marked_invalid_only_when_raw_can_rebuild_it(self):
        cases = (
            ("raw present, broken cache", True, ValueError("bad tensor"), True),
            ("raw present, CUDA OOM", True, RuntimeError("CUDA out of memory. Tried to allocate 2 GiB"), False),
            ("raw present, CPU dispatch", True, ValueError("Some modules are dispatched on the CPU or the disk."), False),
            ("cache only, broken cache", False, ValueError("bad tensor"), False),
        )
        for label, keep_raw, error, marked in cases:
            with self.subTest(label), tempfile.TemporaryDirectory() as temp:
                source, cache, adapter = self.make_source_and_cache(Path(temp))
                if not keep_raw:
                    shutil.rmtree(source)
                loader = RecordingLoader({cache: error})
                with fake_runtime(loader), self.assertRaises(Qwen3VLProviderError) as raised:
                    adapter._load()
                self.assertEqual(raised.exception.code, "model-load-failed")
                self.assertEqual(loader.paths, [cache])
                self.assertEqual((cache / NF4_CACHE_INVALID_MARKER).exists(), marked)

    def test_drifted_cache_is_tried_before_raw_or_a_clear_error(self):
        def run(*, keep_raw=True, cache_fails=True, **options):
            temp = tempfile.TemporaryDirectory()
            self.addCleanup(temp.cleanup)
            source, cache, adapter = self.make_source_and_cache(Path(temp.name), **options)
            if not keep_raw:
                shutil.rmtree(source)
            loader = RecordingLoader({cache: ValueError("incompatible")} if cache_fails else {})
            with fake_runtime(loader, torch_version="other-torch"):
                try:
                    adapter._load()
                    code = ""
                except Qwen3VLProviderError as exc:
                    code = exc.code
            return source, cache, adapter, loader, code

        source, cache, adapter, loader, code = run(cache_fails=False)
        self.assertEqual((code, loader.paths), ("", [cache]))
        self.assertEqual(adapter.last_load_diagnostics["modelSource"], "prequantized-cache")
        self.assertFalse((cache / NF4_CACHE_INVALID_MARKER).exists())

        source, cache, adapter, loader, code = run()
        self.assertEqual((code, loader.paths), ("", [cache, source]))
        self.assertEqual(adapter.last_load_diagnostics["modelSource"], "raw-source")
        self.assertTrue((cache / NF4_CACHE_INVALID_MARKER).exists())

        source, cache, adapter, loader, code = run(require_prequantized_cache=True)
        self.assertEqual((code, loader.paths), ("cache-invalid-rebuild-required", [cache]))

        source, cache, adapter, loader, code = run(keep_raw=False)
        self.assertEqual((code, loader.paths), ("cache-incompatible-source-missing", [cache]))
        self.assertFalse((cache / NF4_CACHE_INVALID_MARKER).exists())


if __name__ == "__main__":
    unittest.main()
