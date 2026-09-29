from __future__ import annotations

import gc
import hashlib
import json
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Any, Callable


NF4_CACHE_SCHEMA = "nf.qwen3-vl.bnb-nf4-cache.v1"
NF4_CACHE_MANIFEST = "novaflow_nf4_cache.json"
NF4_CACHE_SUFFIX = "-novaflow-bnb-nf4-v1"
NF4_CACHE_LOCK_SUFFIX = ".build-lock"
NF4_CACHE_TMP_MARKER = ".build-tmp-"
NF4_CACHE_INVALID_MARKER = ".novaflow-cache-invalid.json"
NF4_CACHE_QUANTIZATION = {
    "method": "bitsandbytes",
    "bits": 4,
    "quantType": "nf4",
    "doubleQuant": True,
    "computeDtype": "float16",
}


class Qwen3VLProviderError(RuntimeError):
    def __init__(self, code: str, detail: str):
        self.code = str(code or "qwen3-vl-error")
        self.detail = str(detail or "")
        super().__init__(f"{self.code}: {self.detail}")


class Qwen3VLAbliteratedAdapter:
    """Task-scoped, local-only Qwen3-VL adapter with mandatory NF4 loading."""

    def __init__(
        self,
        model_path: str | Path,
        *,
        max_side: int = 768,
        max_new_tokens: int = 1200,
        cache_path: str | Path | None = None,
        event_sink: Callable[[str, dict[str, Any]], None] | None = None,
        build_cache: bool | None = None,
        require_prequantized_cache: bool = False,
        trim_transient_cuda_cache: bool = False,
    ):
        self.model_path = Path(model_path)
        self.max_side = max(256, min(1536, int(max_side)))
        self.max_new_tokens = max(128, min(2800, int(max_new_tokens)))
        configured_cache_path = str(
            cache_path
            or os.environ.get("NOVAFLOW_PROMPT_ASSISTANT_REVERSE_CACHE_PATH")
            or ""
        ).strip()
        self.cache_path = (
            Path(configured_cache_path)
            if configured_cache_path
            else self.model_path.parent
            / ".novaflow-cache"
            / f"{self.model_path.name}{NF4_CACHE_SUFFIX}"
        )
        cache_setting = str(
            os.environ.get("NOVAFLOW_PROMPT_ASSISTANT_REVERSE_BUILD_CACHE") or "1"
        ).strip().lower()
        self.build_cache = (
            cache_setting not in {"0", "false", "no", "off"}
            if build_cache is None
            else bool(build_cache)
        )
        self.event_sink = event_sink
        # The launcher sets this so a missing NF4 copy is reported (and built once) instead of the raw
        # folder being quantized again on every request.
        cache_required = str(
            os.environ.get("NOVAFLOW_PROMPT_ASSISTANT_REVERSE_REQUIRE_CACHE") or ""
        ).strip().lower() in {"1", "true", "yes", "on"}
        self.require_prequantized_cache = bool(require_prequantized_cache) or cache_required
        self.trim_transient_cuda_cache = bool(trim_transient_cuda_cache)
        self.model = None
        self.processor = None
        self.last_generation_diagnostics: dict[str, Any] = {}
        self.last_load_diagnostics: dict[str, Any] = {}

    def _emit_stage(self, stage: str, **fields: Any) -> None:
        sink = self.event_sink
        if not callable(sink):
            return
        safe_fields = {
            key: value
            for key, value in fields.items()
            if key in {
                "elapsedMs",
                "cacheBuildMs",
                "cacheHit",
                "cacheState",
                "cacheBytes",
                "errorCode",
                "modelSource",
                "cacheOnly",
                "runtimeVersionsDrift",
                "allocatedBytes",
                "reservedBeforeBytes",
                "reservedAfterBytes",
            }
            and isinstance(value, (str, int, float, bool))
        }
        try:
            sink(str(stage or "unknown")[:80], safe_fields)
        except Exception:
            pass

    def _trim_cuda_cache(self, torch, stage: str) -> None:
        if not self.trim_transient_cuda_cache or not torch.cuda.is_available():
            return
        # On Windows, unused allocator blocks can still consume the dedicated
        # GPU budget and push live NF4 weights into slow shared GPU memory.
        allocated = int(torch.cuda.memory_allocated())
        reserved = int(torch.cuda.memory_reserved())
        torch.cuda.empty_cache()
        self._emit_stage(stage, allocatedBytes=allocated, reservedBeforeBytes=reserved,
                         reservedAfterBytes=int(torch.cuda.memory_reserved()))

    @staticmethod
    def _weight_file_names(path: Path) -> list[str]:
        direct = path / "model.safetensors"
        if direct.is_file():
            return [direct.name]
        index_path = path / "model.safetensors.index.json"
        if not index_path.is_file():
            return []
        try:
            manifest = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            return []
        names = sorted({
            str(name or "").strip()
            for name in (manifest.get("weight_map") or {}).values()
            if str(name or "").strip()
        })
        return [
            name
            for name in names
            if Path(name).name == name and not Path(name).is_absolute()
        ]

    @classmethod
    def _model_readiness(cls, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {"available": False, "code": "model-missing", "detail": str(path)}
        if not path.is_dir():
            return {"available": False, "code": "model-not-directory", "detail": str(path)}
        required = ("config.json", "tokenizer_config.json")
        missing = [name for name in required if not (path / name).is_file()]
        if not (path / "preprocessor_config.json").is_file() and not (path / "processor_config.json").is_file():
            missing.append("preprocessor_config.json or processor_config.json")
        weight_names = cls._weight_file_names(path)
        if not weight_names or not all((path / name).is_file() for name in weight_names):
            missing.append("model safetensors")
        if missing:
            return {
                "available": False,
                "code": "model-incomplete",
                "detail": ", ".join(missing),
            }
        try:
            config = json.loads((path / "config.json").read_text(encoding="utf-8"))
        except Exception as exc:
            return {"available": False, "code": "config-invalid", "detail": str(exc)}
        architectures = config.get("architectures") if isinstance(config, dict) else []
        if "Qwen3VLForConditionalGeneration" not in (architectures or []):
            return {
                "available": False,
                "code": "architecture-unsupported",
                "detail": str(architectures or config.get("model_type") or "unknown"),
            }
        return {
            "available": True,
            "code": "ready",
            "detail": str(path),
            "weightFiles": weight_names,
        }

    def readiness(self) -> dict[str, Any]:
        """Usable when the raw folder is complete, or the NF4 cache alone is."""

        source = self._model_readiness(self.model_path)
        if source.get("available"):
            return source
        if self.cache_readiness().get("available"):
            return {
                "available": True,
                "code": "cache-only",
                "detail": str(self.cache_path),
                "cacheOnly": True,
            }
        return source

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def source_fingerprint(self) -> dict[str, Any]:
        readiness = self._model_readiness(self.model_path)
        if not readiness.get("available"):
            raise Qwen3VLProviderError(readiness["code"], readiness["detail"])
        weights = []
        for name in readiness.get("weightFiles") or []:
            stat = (self.model_path / name).stat()
            weights.append({
                "name": name,
                "size": int(stat.st_size),
                "mtimeNs": str(stat.st_mtime_ns),
            })
        index_path = self.model_path / "model.safetensors.index.json"
        return {
            "sourcePath": str(self.model_path.resolve()),
            "configSha256": self._sha256(self.model_path / "config.json"),
            "indexSha256": self._sha256(index_path) if index_path.is_file() else "",
            "weights": weights,
        }

    @staticmethod
    def _runtime_versions(torch, transformers_module, bitsandbytes_module) -> dict[str, str]:
        return {
            "torch": str(getattr(torch, "__version__", "unknown")),
            "transformers": str(getattr(transformers_module, "__version__", "unknown")),
            "bitsandbytes": str(getattr(bitsandbytes_module, "__version__", "unknown")),
        }

    def _expected_cache_manifest(self, runtime_versions: dict[str, str]) -> dict[str, Any]:
        return {
            "schema": NF4_CACHE_SCHEMA,
            "sourceFingerprint": self.source_fingerprint(),
            "runtimeVersions": dict(runtime_versions),
            "quantization": dict(NF4_CACHE_QUANTIZATION),
        }

    @staticmethod
    def _portable_fingerprint(fingerprint: Any) -> dict[str, Any]:
        # The folder path and file times change when the raw folder is copied
        # or moved; the content hashes and sizes identify the source.
        value = fingerprint if isinstance(fingerprint, dict) else {}
        return {
            "configSha256": value.get("configSha256"),
            "indexSha256": value.get("indexSha256"),
            "weights": [
                {"name": item.get("name"), "size": item.get("size")}
                for item in (value.get("weights") or [])
                if isinstance(item, dict)
            ],
        }

    @staticmethod
    def _cache_runtime_files_missing(path: Path) -> list[str]:
        """Tokenizer and chat template files the processor needs from the cache."""

        missing = []
        if not any((path / name).is_file() for name in ("tokenizer.json", "vocab.json")):
            missing.append("tokenizer.json")
        if not any((path / name).is_file() for name in ("chat_template.jinja", "chat_template.json")):
            missing.append("chat_template.jinja")
        return missing

    def _cache_target_safety(self) -> dict[str, Any]:
        source = self.model_path.resolve(strict=False)
        target = self.cache_path.resolve(strict=False)
        if source == target or source in target.parents or target in source.parents:
            return {
                "safe": False,
                "code": "cache-path-overlaps-source",
            }
        if target.exists():
            if not target.is_dir():
                return {"safe": False, "code": "cache-path-not-directory"}
            manifest_path = target / NF4_CACHE_MANIFEST
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                return {"safe": False, "code": "cache-path-unowned"}
            if manifest.get("schema") != NF4_CACHE_SCHEMA:
                return {"safe": False, "code": "cache-path-unowned"}
        return {"safe": True, "code": "cache-path-safe"}

    @classmethod
    def _cache_artifacts(cls, path: Path) -> dict[str, Any]:
        weight_files = []
        for name in cls._weight_file_names(path):
            stat = (path / name).stat()
            weight_files.append({"name": name, "size": int(stat.st_size)})
        metadata_files = []
        for name in (
            "config.json",
            "model.safetensors.index.json",
            "tokenizer_config.json",
            "preprocessor_config.json",
        ):
            candidate = path / name
            if not candidate.is_file():
                continue
            stat = candidate.stat()
            metadata_files.append({
                "name": name,
                "size": int(stat.st_size),
                "sha256": cls._sha256(candidate),
            })
        return {
            "weights": weight_files,
            "metadata": metadata_files,
        }

    def cache_readiness(self, runtime_versions: dict[str, str] | None = None) -> dict[str, Any]:
        """Check the NF4 cache; the raw folder is compared when present, never required.

        A cache built by other torch/transformers/bitsandbytes versions stays
        available with runtimeVersionsDrift; _load tries it before any fallback.
        """

        path = self.cache_path
        target_safety = self._cache_target_safety()
        if not target_safety.get("safe"):
            return {
                "available": False,
                "code": str(target_safety.get("code") or "cache-path-unsafe"),
                "detail": "unsafe cache target",
            }
        model_state = self._model_readiness(path)
        missing_files = (
            self._cache_runtime_files_missing(path)
            if model_state.get("available")
            else []
        )
        if not model_state.get("available") or missing_files:
            return {
                "available": False,
                "code": "cache-missing" if not path.exists() else "cache-incomplete",
                "detail": ", ".join(missing_files) or str(model_state.get("code") or "cache-invalid"),
            }
        manifest_path = path / NF4_CACHE_MANIFEST
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as exc:
            return {"available": False, "code": "cache-manifest-invalid", "detail": str(exc)}
        expected = {"schema": NF4_CACHE_SCHEMA, "quantization": NF4_CACHE_QUANTIZATION}
        for field in ("schema", "quantization"):
            if manifest.get(field) != expected[field]:
                return {
                    "available": False,
                    "code": f"cache-{field}-mismatch",
                    "detail": field,
                }
        cache_only = not self._model_readiness(self.model_path).get("available")
        if not cache_only and (
            self._portable_fingerprint(manifest.get("sourceFingerprint"))
            != self._portable_fingerprint(self.source_fingerprint())
        ):
            return {
                "available": False,
                "code": "cache-sourceFingerprint-mismatch",
                "detail": "sourceFingerprint",
            }
        if (path / NF4_CACHE_INVALID_MARKER).exists():
            return {
                "available": False,
                "code": "cache-marked-invalid",
                "detail": "previous prequantized load failed",
            }
        try:
            actual_artifacts = self._cache_artifacts(path)
        except Exception as exc:
            return {"available": False, "code": "cache-artifacts-invalid", "detail": str(exc)}
        if manifest.get("artifacts") != actual_artifacts:
            return {
                "available": False,
                "code": "cache-artifacts-mismatch",
                "detail": "artifacts",
            }
        try:
            config = json.loads((path / "config.json").read_text(encoding="utf-8"))
        except Exception as exc:
            return {"available": False, "code": "cache-config-invalid", "detail": str(exc)}
        quantization = config.get("quantization_config") if isinstance(config, dict) else None
        if not isinstance(quantization, dict) or str(quantization.get("quant_method") or "") != "bitsandbytes":
            return {
                "available": False,
                "code": "cache-not-prequantized",
                "detail": "quantization_config",
            }
        cache_bytes = sum(
            int((path / name).stat().st_size)
            for name in model_state.get("weightFiles") or []
        )
        return {
            "available": True,
            "code": "cache-ready",
            "detail": str(path),
            "cacheBytes": cache_bytes,
            "cacheOnly": cache_only,
            "runtimeVersionsDrift": (
                runtime_versions is not None
                and manifest.get("runtimeVersions") != dict(runtime_versions)
            ),
        }

    @staticmethod
    def _pid_alive(pid: int) -> bool:
        if pid <= 0:
            return False
        if os.name == "nt":
            # Signal 0 is CTRL_C_EVENT on Windows, not a POSIX liveness probe.
            # A zero-timeout wait only observes the process; it sends no signal.
            import ctypes
            from ctypes import wintypes

            if pid > 0xFFFFFFFF:
                return False
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel32.OpenProcess.restype = wintypes.HANDLE
            kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
            kernel32.WaitForSingleObject.restype = wintypes.DWORD
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel32.CloseHandle.restype = wintypes.BOOL
            handle = kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE only
            if not handle:
                # Only ERROR_INVALID_PARAMETER proves the PID no longer exists.
                # Keep a lock on access denial or an uncertain query failure.
                return ctypes.get_last_error() != 87
            try:
                return kernel32.WaitForSingleObject(handle, 0) != 0  # WAIT_OBJECT_0
            finally:
                kernel32.CloseHandle(handle)
        try:
            os.kill(pid, 0)
            return True
        except PermissionError:
            return True
        except OSError:
            return False

    def _acquire_cache_build_lock(self) -> Path | None:
        lock_path = self.cache_path.with_name(
            f"{self.cache_path.name}{NF4_CACHE_LOCK_SUFFIX}"
        )
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        for _attempt in range(2):
            try:
                lock_path.mkdir()
                (lock_path / "owner.json").write_text(
                    json.dumps({"pid": os.getpid(), "createdAt": time.time()}),
                    encoding="utf-8",
                )
                return lock_path
            except FileExistsError:
                try:
                    owner = json.loads(
                        (lock_path / "owner.json").read_text(encoding="utf-8")
                    )
                except Exception:
                    owner = {}
                owner_pid = int(owner.get("pid") or 0)
                created_at = float(owner.get("createdAt") or 0)
                stale = not self._pid_alive(owner_pid) or time.time() - created_at > 1800
                if not stale:
                    return None
                try:
                    shutil.rmtree(lock_path)
                except OSError:
                    return None
        return None

    def _cleanup_cache_build_artifacts(self) -> None:
        parent = self.cache_path.parent
        prefix = f".{self.cache_path.name}{NF4_CACHE_TMP_MARKER}"
        if not parent.is_dir():
            return
        for candidate in parent.iterdir():
            if candidate.is_dir() and candidate.name.startswith(prefix):
                try:
                    shutil.rmtree(candidate)
                except OSError:
                    pass

    def _promote_cache_directory(self, temp_path: Path) -> None:
        target_safety = self._cache_target_safety()
        if not target_safety.get("safe"):
            raise Qwen3VLProviderError(
                str(target_safety.get("code") or "cache-path-unsafe"),
                "refusing to replace an unsafe or unowned cache target",
            )
        stale_path = None
        if self.cache_path.exists():
            stale_path = self.cache_path.with_name(
                f".{self.cache_path.name}.stale-{uuid.uuid4().hex}"
            )
            os.replace(self.cache_path, stale_path)
        try:
            os.replace(temp_path, self.cache_path)
        except Exception:
            if stale_path is not None and stale_path.exists() and not self.cache_path.exists():
                os.replace(stale_path, self.cache_path)
            raise
        if stale_path is not None and stale_path.exists():
            try:
                shutil.rmtree(stale_path)
            except OSError:
                pass

    def _persist_prequantized_cache(
        self,
        runtime_versions: dict[str, str],
    ) -> dict[str, Any]:
        if not self.build_cache:
            return {"ok": False, "code": "cache-build-disabled"}
        target_safety = self._cache_target_safety()
        if not target_safety.get("safe"):
            return {
                "ok": False,
                "code": str(target_safety.get("code") or "cache-path-unsafe"),
            }
        lock_path = self._acquire_cache_build_lock()
        if lock_path is None:
            return {"ok": False, "code": "cache-build-locked"}
        started = time.perf_counter()
        temp_path = self.cache_path.parent / (
            f".{self.cache_path.name}{NF4_CACHE_TMP_MARKER}{os.getpid()}-{uuid.uuid4().hex}"
        )
        self._emit_stage("cache-build-start", cacheState="building", cacheHit=False)
        try:
            self._cleanup_cache_build_artifacts()
            temp_path.mkdir(parents=True, exist_ok=False)
            self.model.save_pretrained(
                str(temp_path),
                safe_serialization=True,
                max_shard_size="4GB",
            )
            self.processor.save_pretrained(str(temp_path))
            manifest = {
                **self._expected_cache_manifest(runtime_versions),
                "artifacts": self._cache_artifacts(temp_path),
                "createdAt": time.time(),
            }
            manifest_temp = temp_path / f"{NF4_CACHE_MANIFEST}.tmp"
            manifest_temp.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            os.replace(manifest_temp, temp_path / NF4_CACHE_MANIFEST)
            self._promote_cache_directory(temp_path)
            cache_state = self.cache_readiness(runtime_versions)
            if not cache_state.get("available"):
                raise RuntimeError(str(cache_state.get("code") or "cache-verify-failed"))
            elapsed_ms = round((time.perf_counter() - started) * 1000)
            result = {
                "ok": True,
                "code": "cache-built",
                "elapsedMs": elapsed_ms,
                "cacheBytes": int(cache_state.get("cacheBytes") or 0),
            }
            self._emit_stage(
                "cache-build-done",
                cacheState="ready",
                cacheHit=False,
                cacheBuildMs=elapsed_ms,
                cacheBytes=result["cacheBytes"],
            )
            return result
        except Exception as exc:
            try:
                if temp_path.exists():
                    shutil.rmtree(temp_path)
            except OSError:
                pass
            self._emit_stage(
                "cache-build-error",
                cacheState="unavailable",
                cacheHit=False,
                cacheBuildMs=round((time.perf_counter() - started) * 1000),
                errorCode=type(exc).__name__[:80],
            )
            return {"ok": False, "code": "cache-build-failed", "detail": str(exc)}
        finally:
            try:
                shutil.rmtree(lock_path)
            except OSError:
                pass

    def _load(self, *, allow_cache_rebuild: bool = False, skip_cache: bool = False) -> None:
        readiness = self.readiness()
        if not readiness["available"]:
            raise Qwen3VLProviderError(readiness["code"], readiness["detail"])
        load_started = time.perf_counter()
        self._emit_stage("model-load-start", cacheState="checking", cacheHit=False)
        try:
            import torch
            import bitsandbytes
            import transformers
            from transformers import AutoProcessor, BitsAndBytesConfig, Qwen3VLForConditionalGeneration
        except Exception as exc:
            raise Qwen3VLProviderError("dependency-unavailable", str(exc)) from exc
        if not torch.cuda.is_available():
            raise Qwen3VLProviderError("cuda-unavailable", "Qwen3-VL NF4 provider requires CUDA")
        runtime_versions = self._runtime_versions(torch, transformers, bitsandbytes)
        cache_state = self.cache_readiness(runtime_versions)
        cache_hit = bool(cache_state.get("available")) and not skip_cache
        if not cache_hit and self.require_prequantized_cache and not allow_cache_rebuild:
            cache_error_code = (
                "cache-preparation-required"
                if not self.cache_path.exists()
                else "cache-invalid-rebuild-required"
            )
            self._emit_stage(
                "model-load-error",
                elapsedMs=round((time.perf_counter() - load_started) * 1000),
                cacheHit=False,
                cacheState=str(cache_state.get("code") or "unavailable"),
                modelSource="none",
                errorCode=cache_error_code,
            )
            raise Qwen3VLProviderError(
                cache_error_code,
                str(cache_state.get("code") or "cache unavailable"),
            )
        source_ready = bool(self._model_readiness(self.model_path).get("available"))
        if not cache_hit and not source_ready:
            raise Qwen3VLProviderError(
                "cache-rebuild-requires-source",
                str(cache_state.get("code") or "cache unavailable"),
            )
        selected_model_path = self.cache_path if cache_hit else self.model_path
        model_source = "prequantized-cache" if cache_hit else "raw-source"
        try:
            load_options: dict[str, Any] = {}
            if not cache_hit:
                load_options["quantization_config"] = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_use_double_quant=True,
                )
            self.model = Qwen3VLForConditionalGeneration.from_pretrained(
                str(selected_model_path),
                local_files_only=True,
                trust_remote_code=False,
                use_safetensors=True,
                device_map="auto",
                dtype=torch.float16,
                attn_implementation="sdpa",
                **load_options,
            ).eval()
            self.processor = AutoProcessor.from_pretrained(
                str(selected_model_path),
                local_files_only=True,
                trust_remote_code=False,
            )
            self._trim_cuda_cache(torch, "model-load-cache-trim")
            load_ms = round((time.perf_counter() - load_started) * 1000)
            cache_build = {"ok": False, "code": "cache-hit"}
            if not cache_hit and allow_cache_rebuild:
                cache_build = self._persist_prequantized_cache(runtime_versions)
            self.last_load_diagnostics = {
                "loadMs": load_ms,
                "cacheHit": cache_hit,
                "cacheState": (
                    "ready"
                    if cache_hit or cache_build.get("ok")
                    else "raw-source"
                    if not allow_cache_rebuild
                    else str(cache_build.get("code") or cache_state.get("code") or "unavailable")
                ),
                "cacheBuildMs": int(cache_build.get("elapsedMs") or 0),
                "modelSource": model_source,
                "cacheOnly": not source_ready,
            }
            self._emit_stage(
                "model-load-done",
                elapsedMs=load_ms,
                cacheHit=cache_hit,
                cacheState=self.last_load_diagnostics["cacheState"],
                cacheBuildMs=self.last_load_diagnostics["cacheBuildMs"],
                modelSource=model_source,
                cacheOnly=not source_ready,
                runtimeVersionsDrift=bool(cache_hit and cache_state.get("runtimeVersionsDrift")),
            )
            if cache_hit:
                try:
                    (self.cache_path / NF4_CACHE_INVALID_MARKER).unlink(missing_ok=True)
                except OSError:
                    pass
        except Exception as exc:
            self.unload()
            resource_error = self._is_resource_error(exc)
            # Only a cache the raw folder can rebuild is marked invalid, and
            # never for memory pressure (CUDA OOM, modules dispatched on the CPU).
            if cache_hit and source_ready and not resource_error:
                try:
                    (self.cache_path / NF4_CACHE_INVALID_MARKER).write_text(
                        json.dumps({
                            "schema": NF4_CACHE_SCHEMA,
                            "createdAt": time.time(),
                            "errorCode": type(exc).__name__[:80],
                            "runtimeVersions": dict(runtime_versions),
                        }),
                        encoding="utf-8",
                    )
                except OSError:
                    pass
            self._emit_stage(
                "model-load-error",
                elapsedMs=round((time.perf_counter() - load_started) * 1000),
                cacheHit=cache_hit,
                cacheState=str(cache_state.get("code") or "unavailable"),
                modelSource=model_source,
                errorCode=type(exc).__name__[:80],
                cacheOnly=not source_ready,
            )
            if cache_hit and cache_state.get("runtimeVersionsDrift") and not resource_error:
                # The cache was built by other torch/transformers/bitsandbytes
                # versions and does not load here; only the raw folder can help.
                if not source_ready:
                    raise Qwen3VLProviderError("cache-incompatible-source-missing", str(exc)) from exc
                if self.require_prequantized_cache and not allow_cache_rebuild:
                    raise Qwen3VLProviderError("cache-invalid-rebuild-required", str(exc)) from exc
                return self._load(allow_cache_rebuild=allow_cache_rebuild, skip_cache=True)
            raise Qwen3VLProviderError("model-load-failed", str(exc)) from exc

    @staticmethod
    def _is_resource_error(exc: BaseException) -> bool:
        """GPU memory pressure says nothing about the cache files."""

        current: BaseException | None = exc
        for _depth in range(4):
            if current is None:
                break
            text = f"{type(current).__name__} {current}".lower()
            if "outofmemory" in text or "out of memory" in text or "dispatched on the cpu" in text:
                return True
            current = current.__cause__ or current.__context__
        return False

    def prepare_prequantized_cache(self) -> dict[str, Any]:
        """Build or validate the disk NF4 cache without running visual inference."""

        try:
            import torch
            import bitsandbytes
            import transformers
        except Exception as exc:
            raise Qwen3VLProviderError("dependency-unavailable", str(exc)) from exc
        runtime_versions = self._runtime_versions(torch, transformers, bitsandbytes)
        cache_state = self.cache_readiness(runtime_versions)
        if cache_state.get("available"):
            result = {
                "ok": True,
                "loadMs": 0,
                "cacheHit": True,
                "cacheState": "ready",
                "cacheBuildMs": 0,
                "modelSource": "prequantized-cache",
                "cacheOnly": bool(cache_state.get("cacheOnly")),
            }
            self.last_load_diagnostics = dict(result)
            self._emit_stage(
                "cache-prepare-ready",
                elapsedMs=0,
                cacheHit=True,
                cacheState="ready",
                cacheBytes=int(cache_state.get("cacheBytes") or 0),
                modelSource="prequantized-cache",
                cacheOnly=bool(cache_state.get("cacheOnly")),
                runtimeVersionsDrift=bool(cache_state.get("runtimeVersionsDrift")),
            )
            return result
        if not self._model_readiness(self.model_path).get("available"):
            raise Qwen3VLProviderError(
                "cache-rebuild-requires-source",
                str(cache_state.get("code") or "cache unavailable"),
            )
        try:
            self._load(allow_cache_rebuild=True)
            result = {"ok": True, **dict(self.last_load_diagnostics or {})}
            if result.get("cacheState") != "ready":
                raise Qwen3VLProviderError(
                    "cache-build-failed",
                    str(result.get("cacheState") or "cache unavailable"),
                )
            return result
        finally:
            self.unload()

    @staticmethod
    def _tensor_to_pil(image_tensor):
        try:
            import numpy as np
            from PIL import Image

            tensor = image_tensor
            if getattr(tensor, "ndim", 0) == 4:
                tensor = tensor[0]
            array = tensor.detach().cpu().clamp(0, 1).numpy()
            if array.ndim != 3 or array.shape[-1] not in (3, 4):
                raise ValueError(f"unexpected image tensor shape: {array.shape}")
            if array.shape[-1] == 4:
                array = array[..., :3]
            return Image.fromarray((array * 255).round().astype(np.uint8), mode="RGB")
        except Exception as exc:
            raise Qwen3VLProviderError("image-conversion-failed", str(exc)) from exc

    @staticmethod
    def _strip_first_stop_string(
        text: str,
        stop_strings: tuple[str, ...] | list[str] | None,
    ) -> tuple[str, bool]:
        normalized = tuple(dict.fromkeys(
            value.strip()
            for value in (stop_strings or ())
            if isinstance(value, str) and value.strip()
        ))
        positions = [
            position
            for marker in normalized
            if (position := str(text or "").find(marker)) >= 0
        ]
        if not positions:
            return str(text or "").strip(), False
        return str(text or "")[:min(positions)].rstrip(), True

    def generate(
        self,
        prompt: str,
        image_tensor,
        *,
        unload_after: bool = True,
        system_text: str | None = None,
        do_sample: bool = False,
        temperature: float = 0.8,
        top_p: float = 0.9,
        max_new_tokens: int | None = None,
        stop_strings: tuple[str, ...] | list[str] | None = None,
    ) -> str:
        parts = ([image_tensor] if image_tensor is not None else []) + [str(prompt or "")]
        return self.generate_parts(
            parts,
            unload_after=unload_after,
            system_text=system_text,
            do_sample=do_sample,
            temperature=temperature,
            top_p=top_p,
            max_new_tokens=max_new_tokens,
            stop_strings=stop_strings,
        )

    def generate_parts(
        self,
        parts,
        *,
        unload_after: bool = True,
        system_text: str | None = None,
        do_sample: bool = False,
        temperature: float = 0.8,
        top_p: float = 0.9,
        max_new_tokens: int | None = None,
        stop_strings: tuple[str, ...] | list[str] | None = None,
        seed: int | None = None,
    ) -> str:
        """One user turn made of text strings and image tensors, in order."""

        self.last_generation_diagnostics = {}
        try:
            if self.model is None or self.processor is None:
                self._load()
            import torch
            from PIL import Image

            content = []
            images = []
            for part in parts or []:
                if part is None:
                    continue
                if isinstance(part, str):
                    if part:
                        content.append({"type": "text", "text": part})
                    continue
                image = self._tensor_to_pil(part)
                if max(image.size) > self.max_side:
                    scale = self.max_side / max(image.size)
                    image = image.resize(
                        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                        Image.Resampling.LANCZOS,
                    )
                images.append(image)
                content.append({"type": "image", "image": image})
            if not any(item["type"] == "text" for item in content):
                content.append({"type": "text", "text": ""})
            messages = [
                {
                    "role": "system",
                    "content": [{
                        "type": "text",
                        "text": (
                            str(system_text).strip()
                            if str(system_text or "").strip()
                            else "你是 NovaFlow 的本地视觉事实提取器，只返回严格的版本化 JSON。"
                        ),
                    }],
                },
                {"role": "user", "content": content},
            ]
            text_prompt = self.processor.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
            inputs = self.processor(
                text=[text_prompt],
                **({"images": images} if images else {}),
                padding=True,
                return_tensors="pt",
            )
            try:
                input_device = next(self.model.parameters()).device
            except StopIteration:
                input_device = torch.device("cuda:0")
            model_inputs = {
                key: value.to(input_device) if torch.is_tensor(value) else value
                for key, value in inputs.items()
            }
            generation_token_limit = (
                self.max_new_tokens
                if max_new_tokens is None
                else max(128, min(2800, int(max_new_tokens)))
            )
            generation_kwargs = {
                "max_new_tokens": generation_token_limit,
                "do_sample": bool(do_sample),
                "repetition_penalty": 1.0,
                "use_cache": True,
            }
            normalized_stop_strings = tuple(dict.fromkeys(
                value.strip()
                for value in (stop_strings or ())
                if isinstance(value, str) and value.strip()
            ))
            if normalized_stop_strings:
                generation_kwargs.update({
                    "stop_strings": list(normalized_stop_strings),
                    "tokenizer": self.processor.tokenizer,
                })
            if do_sample:
                generation_kwargs.update({
                    "temperature": max(0.01, min(2.0, float(temperature))),
                    "top_p": max(0.01, min(1.0, float(top_p))),
                })
                if seed is not None:
                    torch.manual_seed(int(seed))
            self._trim_cuda_cache(torch, "prefill-cache-trim")
            generation_started = time.perf_counter()
            if self.trim_transient_cuda_cache:
                self._emit_stage("generation-start")
            with torch.inference_mode():
                generated = self.model.generate(
                    **model_inputs,
                    **generation_kwargs,
                )
            if self.trim_transient_cuda_cache:
                self._emit_stage("generation-done", elapsedMs=round((time.perf_counter() - generation_started) * 1000))
            input_length = model_inputs["input_ids"].shape[1]
            trimmed = generated[:, input_length:]
            generated_tokens = int(trimmed.shape[-1])
            self.last_generation_diagnostics = {
                "generatedTokens": generated_tokens,
                "generationTokenLimit": generation_token_limit,
                "generationHitTokenLimit": generated_tokens >= generation_token_limit,
            }
            text = self.processor.batch_decode(
                trimmed,
                skip_special_tokens=True,
                clean_up_tokenization_spaces=False,
            )[0].strip()
            if normalized_stop_strings:
                text, stopped_by_string = self._strip_first_stop_string(
                    text,
                    normalized_stop_strings,
                )
                self.last_generation_diagnostics["generationStoppedByString"] = (
                    stopped_by_string
                )
            if not text:
                raise Qwen3VLProviderError("empty-output", "Qwen3-VL returned no text")
            return text
        except Qwen3VLProviderError:
            raise
        except Exception as exc:
            raise Qwen3VLProviderError("inference-failed", str(exc)) from exc
        finally:
            if unload_after:
                self.unload()

    def generate_batch(
        self,
        prompts,
        *,
        system_text: str | None = None,
        max_new_tokens: int | None = None,
        unload_after: bool = False,
        images=None,
    ) -> list[str]:
        """Several user turns decoded together, greedy, each a text with at most one picture before it: a step for the
        batch costs far less than one step for each, so independent requests finish sooner."""

        self.last_generation_diagnostics = {}
        try:
            if self.model is None or self.processor is None:
                self._load()
            import torch
            from PIL import Image

            system = str(system_text).strip() if str(system_text or "").strip() else "你是 NovaFlow 的本地视觉事实提取器，只返回严格的版本化 JSON。"
            pictures = []
            for image in images or []:
                if image is not None:
                    picture = self._tensor_to_pil(image)
                    if max(picture.size) > self.max_side:
                        scale = self.max_side / max(picture.size)
                        picture = picture.resize((max(1, round(picture.width * scale)), max(1, round(picture.height * scale))), Image.Resampling.LANCZOS)
                    pictures.append(picture)
            texts = [
                self.processor.apply_chat_template(
                    [{"role": "system", "content": [{"type": "text", "text": system}]},
                     {"role": "user", "content": ([{"type": "image"}] if images and images[index] is not None else [])
                      + [{"type": "text", "text": str(prompt or "")}]}],
                    tokenize=False,
                    add_generation_prompt=True,
                )
                for index, prompt in enumerate(prompts)
            ]
            tokenizer = self.processor.tokenizer
            side = tokenizer.padding_side
            # Left padding keeps every answer right after its own prompt.
            tokenizer.padding_side = "left"
            try:
                inputs = self.processor(text=texts, **({"images": pictures} if pictures else {}), padding=True, return_tensors="pt")
            finally:
                tokenizer.padding_side = side
            try:
                device = next(self.model.parameters()).device
            except StopIteration:
                device = torch.device("cuda:0")
            inputs = {key: value.to(device) if torch.is_tensor(value) else value for key, value in inputs.items()}
            limit = self.max_new_tokens if max_new_tokens is None else max(128, min(2800, int(max_new_tokens)))
            pad = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id
            self._trim_cuda_cache(torch, "prefill-cache-trim")
            with torch.inference_mode():
                generated = self.model.generate(**inputs, max_new_tokens=limit, do_sample=False, repetition_penalty=1.0,
                                                use_cache=True, pad_token_id=pad)
            trimmed = generated[:, inputs["input_ids"].shape[1]:]
            counts = [int((row != pad).sum()) for row in trimmed]
            self.last_generation_diagnostics = {
                "generatedTokens": max(counts, default=0),
                "generatedTokensEach": counts,
                "generationTokenLimit": limit,
                "generationHitTokenLimit": any(count >= limit for count in counts),
            }
            return [text.strip() for text in self.processor.batch_decode(trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False)]
        except Qwen3VLProviderError:
            raise
        except Exception as exc:
            raise Qwen3VLProviderError("inference-failed", str(exc)) from exc
        finally:
            if unload_after:
                self.unload()

    def unload(self) -> None:
        self.model = None
        self.processor = None
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass


def _run_cache_builder_cli() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Build NovaFlow's task-scoped Qwen3-VL NF4 disk cache."
    )
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--cache-path", required=True)
    args = parser.parse_args()
    events: list[dict[str, Any]] = []

    def record(stage: str, fields: dict[str, Any]) -> None:
        payload = {"stage": stage, **fields}
        events.append(payload)
        print(json.dumps(payload, ensure_ascii=False), flush=True)

    adapter = Qwen3VLAbliteratedAdapter(
        args.model_path,
        cache_path=args.cache_path,
        event_sink=record,
        build_cache=True,
    )
    try:
        result = adapter.prepare_prequantized_cache()
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False), flush=True)
        return 0
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "errorCode": str(getattr(exc, "code", "cache-build-failed"))[:80],
            "message": str(exc)[:240],
            "lastStage": events[-1]["stage"] if events else "none",
        }, ensure_ascii=False), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(_run_cache_builder_cli())
