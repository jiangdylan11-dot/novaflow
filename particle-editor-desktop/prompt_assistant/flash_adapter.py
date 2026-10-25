"""CPU-only compatibility adapter for the externally owned local Flash session.

This module never loads weights, creates a CUDA context, or stops the engine.
The worker's workflow session verifies model identity and owns that lifecycle.
"""
from __future__ import annotations

import base64
from contextvars import ContextVar
import datetime
import hashlib
import io
import json
import math
import os
import re
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from .qwen3_vl_adapter import Qwen3VLProviderError


MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_IMAGE_BYTES = 24 * 1024 * 1024
MAX_IMAGE_TOTAL_BYTES = 48 * 1024 * 1024
MAX_TEXT_CHARS = 160000
MAX_IMAGES = 16
_BUSINESS_REQUEST_CALLS = ContextVar("novaflow_flash_business_request_calls", default=None)


def flash_backend_enabled() -> bool:
    return os.environ.get("NOVAFLOW_PROMPT_ASSISTANT_BACKEND", "").strip().lower() == "strata"


def begin_flash_request():
    """One stdin business request, including calls from separate adapter objects."""
    return _BUSINESS_REQUEST_CALLS.set([])


def end_flash_request(token):
    _BUSINESS_REQUEST_CALLS.reset(token)


def flash_request_summary(command=""):
    requests = list(_BUSINESS_REQUEST_CALLS.get() or [])
    return {"analysisBackend": "strata", "scope": "python-business-request",
            "command": str(command or "")[:80], "inferencePerformed": bool(requests),
            "requestCount": len(requests), "requestMs": round(sum(item["requestMs"] for item in requests), 3),
            "maxImageCount": max((item["imageCount"] for item in requests), default=0), "requests": requests}


def _numeric_usage(value, depth=0):
    if not isinstance(value, dict) or depth > 2:
        return None
    result = {}
    for key, item in value.items():
        if not isinstance(key, str) or len(key) > 80:
            continue
        if (type(item) is int or (type(item) is float and math.isfinite(item))) and item >= 0:
            result[key] = item
        elif isinstance(item, dict):
            nested = _numeric_usage(item, depth + 1)
            if nested:
                result[key] = nested
    return result or None


def _record_flash_call(trace, diagnostics):
    calls = _BUSINESS_REQUEST_CALLS.get()
    if calls is None or not diagnostics.get("httpAttempted"):
        return
    response = trace.get("response")
    native_id = response.get("id") if isinstance(response, dict) else None
    native_model = response.get("model") if isinstance(response, dict) else None
    choices = response.get("choices") if isinstance(response, dict) else None
    choice = choices[0] if isinstance(choices, list) and choices and isinstance(choices[0], dict) else {}
    calls.append({"requestId": native_id if isinstance(native_id, str) and len(native_id) <= 240 else trace["requestId"],
                  "model": native_model if isinstance(native_model, str) and len(native_model) <= 2000 else diagnostics["modelId"],
                  "usage": _numeric_usage(response.get("usage") if isinstance(response, dict) else None), "requestMs": diagnostics["requestMs"],
                  "finishReason": choice.get("finish_reason") if isinstance(choice.get("finish_reason"), str) else None,
                  "requestedTokenLimit": diagnostics["requestedTokenLimit"],
                  "generationTokenLimit": diagnostics["generationTokenLimit"],
                  "imageCount": diagnostics.get("imageCount", 0),
                  "status": "error" if diagnostics.get("errorCode") or diagnostics.get("traceWriteError") else "completed",
                  **({"errorCode": diagnostics["errorCode"]} if diagnostics.get("errorCode") else {})})


def _integer_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default)).strip()
    try:
        value = int(raw)
    except (ValueError, TypeError) as exc:
        raise Qwen3VLProviderError("strata-invalid-config", f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise Qwen3VLProviderError("strata-invalid-config", f"{name} outside {minimum}..{maximum}")
    return value


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Qwen3VLProviderError("strata-redirect-refused", "Local inference must not redirect")


class FlashAdapter:
    """Legacy Python business interfaces, native Flash messages and no fallback."""

    def __init__(self, model_path: str | Path = "", *, max_side=768, max_new_tokens=1200,
                 cache_path=None, event_sink=None, build_cache=None,
                 require_prequantized_cache=False, trim_transient_cuda_cache=False):
        # Legacy constructor arguments are deliberately accepted, not used to resize
        # images, quantize weights, or create a second model lifetime.
        self.model_path = Path(model_path)
        self.max_side = max_side
        self.max_new_tokens = int(max_new_tokens)
        self.event_sink = event_sink
        self.model = self.processor = None
        self.last_generation_diagnostics = {}
        self.last_load_diagnostics = {}
        base_url = os.environ.get("NOVAFLOW_FLASH_BASE_URL", "").strip()
        match = re.fullmatch(r"http://127\.0\.0\.1:(\d{1,5})/?", base_url)
        if not match or not 1 <= int(match[1]) <= 65535:
            raise Qwen3VLProviderError("strata-invalid-config", "Flash requires http://127.0.0.1:port")
        self.base_url = base_url.rstrip("/")
        self.model_id = os.environ.get("NOVAFLOW_FLASH_MODEL_ID", "").strip()
        if not self.model_id or len(self.model_id) > 2000 or any(ord(c) < 32 for c in self.model_id):
            raise Qwen3VLProviderError("strata-invalid-config", "Verified Flash model ID is required")
        self.timeout = _integer_env("NOVAFLOW_FLASH_TIMEOUT_SECONDS", 180, 1, 600)
        self.token_cap = _integer_env("NOVAFLOW_FLASH_MAX_TOKENS", 4096, 512, 8192)
        self.reasoning_budget = _integer_env("NOVAFLOW_FLASH_REASONING_BUDGET_TOKENS", 1024, 0, 4096)
        self.reasoning_effort = os.environ.get("NOVAFLOW_FLASH_REASONING_EFFORT", "low").strip().lower()
        if self.reasoning_effort not in {"none", "low", "medium", "high"}:
            raise Qwen3VLProviderError("strata-invalid-config", "Unsupported Flash reasoning effort")
        if self.reasoning_effort != "none" and self.token_cap < self.reasoning_budget + 512:
            raise Qwen3VLProviderError("strata-invalid-config", "Flash token cap leaves insufficient answer space")
        # Ignore system proxy configuration for loopback inference, and refuse
        # redirects so an endpoint cannot send reference images outside localhost.
        self._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        trace_dir = os.environ.get("NOVAFLOW_FLASH_TRACE_DIR", "").strip()
        self.trace_dir = Path(trace_dir) if trace_dir else None
        if self.trace_dir is not None and (not self.trace_dir.is_absolute() or trace_dir.startswith(("\\\\", "//"))):
            raise Qwen3VLProviderError("strata-invalid-config", "Flash trace directory must be an explicit local absolute path")

    def readiness(self):
        # Configuration readiness only. JS has already verified the live identity;
        # status must not start or probe a second model session from Python.
        return {"available": True, "code": "externally-managed", "detail": self.model_id,
                "modelSource": "strata", "cacheState": "not-required", "externallyManaged": True}

    def cache_readiness(self, runtime_versions=None):
        return self.readiness()

    def prepare_prequantized_cache(self):
        return {"ok": True, "modelSource": "strata", "cacheState": "not-required",
                "cacheHit": False, "loadMs": 0, "externallyManaged": True}

    @staticmethod
    def _native_text(value):
        text = str(value or "")
        # Legacy service templates have already been split into roles. These
        # placeholder tokens represent images now carried as native image_url.
        for token in ("<|vision_start|>", "<|image_pad|>", "<|vision_end|>"):
            text = text.replace(token, "")
        if any(token in text for token in ("<|im_start|>", "<|im_end|>", "<|endoftext|>")):
            raise Qwen3VLProviderError("strata-invalid-request", "Chat template must be split into native message roles")
        text = re.sub(r"^\s*(?:<think>\s*</think>|</think>|<think>)\s*", "", text)
        if len(text) > MAX_TEXT_CHARS:
            raise Qwen3VLProviderError("strata-invalid-request", "Flash instruction exceeds bounded text size")
        return text

    @staticmethod
    def _tensor_to_pil(image):
        try:
            import numpy as np
            from PIL import Image
            if isinstance(image, Image.Image):
                return image.copy()
            tensor = image
            if getattr(tensor, "ndim", 0) == 4:
                if int(tensor.shape[0]) != 1:
                    raise ValueError("Each image part must contain exactly one image")
                tensor = tensor[0]
            if hasattr(tensor, "detach"):
                tensor = tensor.detach().cpu().numpy()
            array = np.asarray(tensor)
            if array.ndim != 3 or array.shape[-1] not in (3, 4):
                raise ValueError(f"Unexpected image shape: {array.shape}")
            if np.issubdtype(array.dtype, np.floating):
                if not np.isfinite(array).all():
                    raise ValueError("Image contains non-finite values")
                array = (np.clip(array, 0, 1) * 255).round().astype(np.uint8)
            elif array.dtype != np.uint8:
                raise ValueError("Image must contain uint8 or normalized float pixels")
            return Image.fromarray(array)
        except Qwen3VLProviderError:
            raise
        except Exception as exc:
            raise Qwen3VLProviderError("image-conversion-failed", str(exc)) from exc

    @classmethod
    def _image_url(cls, image):
        picture = cls._tensor_to_pil(image)
        if picture.width < 1 or picture.height < 1 or picture.width * picture.height > 64 * 1024 * 1024:
            raise Qwen3VLProviderError("strata-invalid-request", "Image dimensions exceed local inference bounds")
        buffer = io.BytesIO()
        picture.save(buffer, format="PNG")
        data = buffer.getvalue()
        if len(data) > MAX_IMAGE_BYTES:
            raise Qwen3VLProviderError("strata-invalid-request", "Full reference image exceeds 24 MiB; not resized")
        evidence = {"sha256": hashlib.sha256(data).hexdigest(), "pixelSHA256": hashlib.sha256(picture.tobytes()).hexdigest(),
                    "mode": picture.mode, "width": picture.width, "height": picture.height,
                    "bytes": len(data), "encoding": "PNG", "resized": False}
        return "data:image/png;base64," + base64.b64encode(data).decode("ascii"), len(data), list(picture.size), evidence

    @staticmethod
    def _read_response(response, deadline):
        read1 = getattr(response, "read1", None)
        if not callable(read1):
            return response.read(MAX_RESPONSE_BYTES + 1)
        chunks = bytearray()
        while len(chunks) <= MAX_RESPONSE_BYTES:
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                raise TimeoutError("Flash response exceeded the request deadline")
            # HTTPResponse.read1 returns available bytes after at most one socket
            # read. Refresh its socket deadline to bound even a trickling reply.
            sock = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
            if sock is not None:
                sock.settimeout(remaining)
            chunk = read1(min(65536, MAX_RESPONSE_BYTES + 1 - len(chunks)))
            if not chunk:
                break
            chunks.extend(chunk)
        return bytes(chunks)

    def _write_trace(self, trace, diagnostics):
        if self.trace_dir is None:
            return
        target = self.trace_dir / trace["requestId"] / "trace.json"
        target.parent.mkdir(parents=True, exist_ok=False)
        trace["diagnostics"] = dict(diagnostics)
        target.write_text(json.dumps(trace, ensure_ascii=False, indent=2), encoding="utf-8")
        diagnostics["tracePath"] = str(target)

    def generate(self, prompt, image_tensor=None, **kwargs):
        return self.generate_parts(([image_tensor] if image_tensor is not None else []) + [str(prompt or "")], **kwargs)

    def generate_parts(self, parts, *, unload_after=True, system_text=None,
                       do_sample=False, temperature=0.8, top_p=0.9,
                       max_new_tokens=None, stop_strings=None, seed=None):
        self.last_generation_diagnostics = {}
        started = time.perf_counter()
        trace = {"schema": "nf.flash.python.native-trace.v1", "requestId": str(uuid.uuid4()),
                 "startedAtUTC": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                 "status": "error", "request": None, "response": None}
        requested = int(self.max_new_tokens if max_new_tokens is None else max_new_tokens)
        minimum = (self.reasoning_budget if self.reasoning_effort != "none" else 0) + 512
        effective = min(self.token_cap, max(128, minimum, requested))
        diagnostics = {"modelSource": "strata", "modelId": self.model_id,
                       "requestedTokenLimit": requested, "generationTokenLimit": effective,
                       "reasoningEffort": self.reasoning_effort, "reasoningBudgetTokens": self.reasoning_budget,
                       "externallyManaged": True, "retryCount": 0}
        self.last_generation_diagnostics = diagnostics
        try:
            content, trace_content, image_sizes, image_bytes = [], [], [], 0
            text_chars = 0
            for part in parts or []:
                if part is None:
                    continue
                if isinstance(part, str):
                    text = self._native_text(part)
                    text_chars += len(text)
                    if text:
                        content.append({"type": "text", "text": text})
                        trace_content.append({"type": "text", "text": text})
                else:
                    url, size, dimensions, evidence = self._image_url(part)
                    image_bytes += size
                    image_sizes.append(dimensions)
                    content.append({"type": "image_url", "image_url": {"url": url, "detail": "auto"}})
                    trace_content.append({"type": "image_url", "image": evidence, "detail": "auto"})
            system = self._native_text(system_text)
            if not content or text_chars + len(system) > MAX_TEXT_CHARS or len(image_sizes) > MAX_IMAGES or image_bytes > MAX_IMAGE_TOTAL_BYTES:
                raise Qwen3VLProviderError("strata-invalid-request", "Empty or oversized native inference request")
            messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": content}]
            sampled_temperature, sampled_top_p = float(temperature), float(top_p)
            if not math.isfinite(sampled_temperature) or not 0 <= sampled_temperature <= 2 or not math.isfinite(sampled_top_p) or not 0 < sampled_top_p <= 1:
                raise Qwen3VLProviderError("strata-invalid-request", "Invalid sampling parameters")
            body = {"model": self.model_id, "messages": messages, "stream": False,
                    "max_tokens": effective, "temperature": sampled_temperature if do_sample else 0,
                    "top_p": sampled_top_p if do_sample else 1,
                    "reasoning_effort": self.reasoning_effort, "reasoning_budget_tokens": self.reasoning_budget}
            if seed is not None:
                body["seed"] = int(seed)
            trace["request"] = {**body, "messages": ([{"role": "system", "content": system}] if system else [])
                                + [{"role": "user", "content": trace_content}], "endpoint": self.base_url + "/v1/chat/completions"}
            diagnostics.update(imageCount=len(image_sizes), imageSizes=image_sizes, imageBytes=image_bytes)
            request = urllib.request.Request(self.base_url + "/v1/chat/completions",
                                             data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                             headers={"Content-Type": "application/json"}, method="POST")
            remaining = started + self.timeout - time.perf_counter()
            if remaining <= 0:
                raise TimeoutError("Flash request exceeded its deadline before transport")
            diagnostics["httpAttempted"] = True
            with self._opener.open(request, timeout=remaining) as response:
                raw = self._read_response(response, started + self.timeout)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise Qwen3VLProviderError("strata-response-too-large", "Flash response exceeds 2 MiB")
            try:
                value = json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeError) as exc:
                raise Qwen3VLProviderError("strata-invalid-response", "Flash did not return UTF-8 JSON") from exc
            trace["response"] = value
            trace["responseBytes"] = len(raw)
            trace["responseSHA256"] = hashlib.sha256(raw).hexdigest()
            if not isinstance(value, dict) or value.get("error"):
                raise Qwen3VLProviderError("strata-inference-error", "Flash returned an inference error")
            if value.get("model") != self.model_id:
                raise Qwen3VLProviderError("strata-model-mismatch", "Response model differs from the verified session identity")
            choices = value.get("choices")
            if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
                raise Qwen3VLProviderError("strata-invalid-response", "Flash must return one completion")
            choice = choices[0]
            message = choice.get("message")
            finish = choice.get("finish_reason")
            usage = value.get("usage") if isinstance(value.get("usage"), dict) else {}
            completion_tokens = usage.get("completion_tokens")
            diagnostics.update(usage=usage, generatedTokens=completion_tokens if isinstance(completion_tokens, int) else None,
                               finishReason=finish, generationHitTokenLimit=finish in {"length", "max_tokens"})
            if diagnostics["generationHitTokenLimit"]:
                raise Qwen3VLProviderError("strata-token-limit", "Flash completion was truncated; no automatic retry")
            if finish != "stop" or not isinstance(message, dict) or message.get("tool_calls") or message.get("function_call"):
                raise Qwen3VLProviderError("strata-invalid-response", "Flash did not finish a plain text response")
            output = message.get("content")
            if not isinstance(output, str) or not output.strip():
                raise Qwen3VLProviderError("strata-empty-response", "Flash returned no answer content")
            output, stopped = self._strip_first_stop_string(output, stop_strings)
            diagnostics["generationStoppedByString"] = stopped
            trace["status"] = "completed"
            return output
        except Qwen3VLProviderError as exc:
            diagnostics["errorCode"] = exc.code
            trace["error"] = {"code": exc.code, "detail": exc.detail}
            raise
        except TimeoutError as exc:
            diagnostics["errorCode"] = "strata-timeout"
            trace["error"] = {"code": "strata-timeout", "detail": str(exc)}
            raise Qwen3VLProviderError("strata-timeout", str(exc)) from exc
        except (OSError, ValueError, TypeError, urllib.error.URLError) as exc:
            diagnostics["errorCode"] = "strata-inference-failed"
            trace["error"] = {"code": "strata-inference-failed", "detail": str(exc)}
            raise Qwen3VLProviderError("strata-inference-failed", str(exc)) from exc
        finally:
            diagnostics["requestMs"] = round((time.perf_counter() - started) * 1000, 3)
            trace["finishedAtUTC"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            try:
                self._write_trace(trace, diagnostics)
            except OSError as trace_error:
                diagnostics["traceWriteError"] = str(trace_error)
                if trace["status"] == "completed":
                    diagnostics["errorCode"] = "strata-trace-write-failed"
                    raise Qwen3VLProviderError("strata-trace-write-failed", str(trace_error)) from trace_error
            finally:
                _record_flash_call(trace, diagnostics)
                if unload_after:
                    self.unload()

    @staticmethod
    def _strip_first_stop_string(text, stop_strings):
        positions = [text.find(marker) for marker in dict.fromkeys(stop_strings or ()) if isinstance(marker, str) and marker and text.find(marker) >= 0]
        return (text[:min(positions)].rstrip(), True) if positions else (text.strip(), False)

    def generate_batch(self, prompts, *, system_text=None, max_new_tokens=None, unload_after=False, images=None):
        prompts = list(prompts)
        if images is not None and len(images) != len(prompts):
            raise Qwen3VLProviderError("strata-invalid-request", "Batch image count must match prompt count")
        outputs, per_request = [], []
        try:
            for index, prompt in enumerate(prompts):
                outputs.append(self.generate(prompt, images[index] if images is not None else None,
                                             system_text=system_text, max_new_tokens=max_new_tokens, unload_after=False))
                per_request.append(dict(self.last_generation_diagnostics))
            counts = [item.get("generatedTokens") for item in per_request]
            self.last_generation_diagnostics = {"modelSource": "strata", "modelId": self.model_id,
                "generatedTokens": sum(counts) if all(isinstance(c, int) for c in counts) else None, "generatedTokensEach": counts,
                "usageAvailable": all(isinstance(c, int) for c in counts), "generationHitTokenLimit": False,
                "requests": per_request, "externallyManaged": True, "retryCount": 0}
            return outputs
        finally:
            if unload_after:
                self.unload()

    def unload(self):
        # No HTTP unload/free, no torch import: only the outer JS session releases
        # its owned engine after the *whole* business workflow has completed.
        self.model = self.processor = None
