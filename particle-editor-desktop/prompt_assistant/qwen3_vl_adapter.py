from __future__ import annotations

import gc
import json
from pathlib import Path
from typing import Any


class Qwen3VLProviderError(RuntimeError):
    def __init__(self, code: str, detail: str):
        self.code = str(code or "qwen3-vl-error")
        self.detail = str(detail or "")
        super().__init__(f"{self.code}: {self.detail}")


class Qwen3VLAbliteratedAdapter:
    """Task-scoped, local-only Qwen3-VL adapter with mandatory NF4 loading."""

    def __init__(self, model_path: str | Path, *, max_side: int = 768, max_new_tokens: int = 1200):
        self.model_path = Path(model_path)
        self.max_side = max(256, min(1536, int(max_side)))
        self.max_new_tokens = max(128, min(2800, int(max_new_tokens)))
        self.model = None
        self.processor = None
        self.last_generation_diagnostics: dict[str, Any] = {}

    def readiness(self) -> dict[str, Any]:
        path = self.model_path
        if not path.exists():
            return {"available": False, "code": "model-missing", "detail": str(path)}
        if not path.is_dir():
            return {"available": False, "code": "model-not-directory", "detail": str(path)}
        required = ("config.json", "tokenizer_config.json", "preprocessor_config.json")
        missing = [name for name in required if not (path / name).is_file()]
        has_weights = (path / "model.safetensors").is_file()
        index_path = path / "model.safetensors.index.json"
        if not has_weights and index_path.is_file():
            try:
                manifest = json.loads(index_path.read_text(encoding="utf-8"))
                shard_names = {
                    str(name or "").strip()
                    for name in (manifest.get("weight_map") or {}).values()
                    if str(name or "").strip()
                }
                has_weights = bool(shard_names) and all(
                    (path / name).is_file() for name in shard_names
                )
            except Exception:
                has_weights = False
        if not has_weights:
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
        return {"available": True, "code": "ready", "detail": str(path)}

    def _load(self) -> None:
        readiness = self.readiness()
        if not readiness["available"]:
            raise Qwen3VLProviderError(readiness["code"], readiness["detail"])
        try:
            import torch
            from transformers import AutoProcessor, BitsAndBytesConfig, Qwen3VLForConditionalGeneration
        except Exception as exc:
            raise Qwen3VLProviderError("dependency-unavailable", str(exc)) from exc
        if not torch.cuda.is_available():
            raise Qwen3VLProviderError("cuda-unavailable", "Qwen3-VL NF4 provider requires CUDA")
        try:
            quantization = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
            )
            self.model = Qwen3VLForConditionalGeneration.from_pretrained(
                str(self.model_path),
                local_files_only=True,
                trust_remote_code=False,
                use_safetensors=True,
                device_map="auto",
                quantization_config=quantization,
                dtype=torch.float16,
                attn_implementation="sdpa",
            ).eval()
            self.processor = AutoProcessor.from_pretrained(
                str(self.model_path),
                local_files_only=True,
                trust_remote_code=False,
            )
        except Exception as exc:
            self.unload()
            raise Qwen3VLProviderError("model-load-failed", str(exc)) from exc

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
        self.last_generation_diagnostics = {}
        try:
            if self.model is None or self.processor is None:
                self._load()
            import torch
            from PIL import Image

            image = self._tensor_to_pil(image_tensor)
            if max(image.size) > self.max_side:
                scale = self.max_side / max(image.size)
                image = image.resize(
                    (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                    Image.Resampling.LANCZOS,
                )
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
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "image": image},
                        {"type": "text", "text": str(prompt or "")},
                    ],
                },
            ]
            text_prompt = self.processor.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
            inputs = self.processor(
                text=[text_prompt],
                images=[image],
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
            with torch.inference_mode():
                generated = self.model.generate(
                    **model_inputs,
                    **generation_kwargs,
                )
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
