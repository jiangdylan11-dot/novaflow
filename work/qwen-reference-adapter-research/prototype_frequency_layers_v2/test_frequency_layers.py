"""CPU-only native interfaces and small random models; no trained weights."""
import os
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"

from datetime import datetime, timezone
import builtins
import hashlib
import json
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch

COMFY = Path(os.environ.get("NF_COMFY_ROOT", "C:/ProgramData/NovaFlow/AI-Runtime/engine/ComfyUI"))
sys.path.insert(0, str(COMFY))
import comfy.cli_args
comfy.cli_args.args.cpu = True
comfy.cli_args.args.disable_dynamic_vram = True
comfy.cli_args.args.use_pytorch_cross_attention = True
import torch
import comfy.model_management as management
import comfy.patcher_extension as extension
from comfy.ldm.modules.attention import attention_pytorch
from comfy.ldm.qwen_image21.model import QwenImage21Transformer2DModel, ZeroCenteredRMSNorm
from comfy.model_base import QwenImage21

from layout import sequence_layout
from frequency_core import AXES, HEAD_DIM, frequency_scale_vector
from reference_frequency_layers import (
    WRAPPER_KEY, OLD_FREQUENCY_WRAPPER_KEY, LayerWindowOverride, LayerWindowForward,
    NovaFlowQwen21StyleKeyLayerWindowExperimental, layer_window,
)

METRICS = {}


def inputs(text=10, batch=1):
    return (torch.randn(batch, 4, 2, 2), torch.tensor([0.4] * batch),
            torch.randn(batch, text, 8),
            [torch.randn(batch, 4, 2, 3), torch.randn(batch, 4, 1, 4)],
            [2, text - 3])


class FakePatcher:
    def __init__(self, base, options=None):
        self.model = base
        self.model_options = {"transformer_options": {}} if options is None else options

    def clone(self):
        return FakePatcher(self.model, extension.copy_nested_dicts(self.model_options))


def tiny_patcher(layers=3):
    torch.manual_seed(9281)
    tiny = QwenImage21Transformer2DModel(
        in_channels=4, out_channels=4, num_layers=layers, attention_head_dim=HEAD_DIM,
        num_attention_heads=1, context_in_dim=8, mlp_ratio=2, axes_dims_rope=AXES,
        fused_mlp=False, dtype=torch.float32, device="cpu", operations=torch.nn)
    with torch.no_grad():
        for p in tiny.parameters():
            p.uniform_(-0.08, 0.08)
        for module in tiny.modules():
            if isinstance(module, ZeroCenteredRMSNorm):
                module.weight.zero_()
    base = QwenImage21.__new__(QwenImage21)
    torch.nn.Module.__init__(base)
    base.diffusion_model = tiny
    return FakePatcher(base)


class CpuCache:
    def __init__(self):
        self.values = {}
        self.puts = self.takes = 0

    def put(self, index, value):
        self.values[index] = value.clone()
        self.puts += 1

    def take(self, index, device, dtype, batch):
        self.takes += 1
        return self.values[index].to(device=device, dtype=dtype)

    def prefetch(self, *args):
        pass


class LayerWindowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old_training = management.in_training
        management.in_training = True
        torch.set_num_threads(2)

    @classmethod
    def tearDownClass(cls):
        management.in_training = cls.old_training

    def setUp(self):
        torch.manual_seed(42)

    def override(self, previous=None, start=24, end=31, layers=32, text=10, batch=1):
        x, _, c, refs, slots = inputs(text, batch)
        return LayerWindowOverride(sequence_layout(x, c, refs, slots), 1,
            frequency_scale_vector(.5, 1.5, 2), start, end, layers, previous)

    def tensors(self, batch=1, heads=2, dtype=torch.float32):
        return [torch.randn(batch, n, heads * HEAD_DIM, dtype=dtype) for n in (4, 24, 24)]

    def opts(self, layer, layers=32):
        return {"transformer_options": {"block_index": layer, "total_blocks": layers}}

    def test_cpu_only_and_schema(self):
        self.assertEqual(str(management.get_torch_device()), "cpu")
        self.assertFalse(torch.cuda.is_initialized())
        node = NovaFlowQwen21StyleKeyLayerWindowExperimental
        schema = node.INPUT_TYPES()
        self.assertEqual(schema["required"]["layer_start"][1]["default"], 24)
        self.assertEqual(schema["required"]["layer_end"][1]["default"], 31)
        self.assertFalse(schema["required"]["enabled"][1]["default"])
        self.assertEqual(schema["optional"]["active_sigma_min"][1]["default"], 0)
        self.assertEqual(node.RETURN_TYPES, ("MODEL",))

    def test_disabled_and_identity_before_import_or_model_access(self):
        class NoAccess:
            def __getattribute__(self, name):
                raise AssertionError("No model attribute may be accessed")
        model = NoAccess()
        native_import = builtins.__import__
        def checked_import(name, *a, **kw):
            if name.startswith("comfy"):
                raise AssertionError("No native import for disabled/identity")
            return native_import(name, *a, **kw)
        node = NovaFlowQwen21StyleKeyLayerWindowExperimental()
        with patch("builtins.__import__", checked_import):
            self.assertIs(node.patch(model, enabled=False)[0], model)
            self.assertIs(node.patch(model, True, high_scale=1, low_scale=1)[0], model)
            self.assertIs(node.patch(model, True, high_scale=1, low_scale=1, active_sigma_min=.9)[0], model)

    def test_only_last_eight_of_32_actual_call_indices_select(self):
        override = self.override()
        q, k, v = self.tensors()
        mask = torch.zeros(4, 24)
        selected = []
        # Deliberately mutate one shared native options dictionary each call.
        options = {"block_index": 0, "total_blocks": 32}
        for i in range(32):
            options["block_index"] = i
            def capture(q1, k1, v1, heads, mask=None, **kw):
                self.assertIs(q1, q); self.assertIs(v1, v); self.assertIs(mask, original_mask)
                self.assertIs(kw["transformer_options"], options)
                if k1 is not k:
                    selected.append(i)
                return q1
            original_mask = mask
            override(capture, q, k, v, 2, mask=mask, transformer_options=options)
        self.assertEqual(selected, list(range(24, 32)))
        self.assertEqual(override.audit.key_copies, 8)
        self.assertEqual(sorted(override.audit.bypassed_target_by_layer), list(range(24)))
        METRICS["selected_32_layer_indices"] = selected
        METRICS["copies_per_32_target_calls"] = override.audit.key_copies

    def test_missing_or_invalid_actual_index_rejects(self):
        override = self.override()
        q, k, v = self.tensors()
        bad = [None, {}, {"block_index": None}, {"block_index": True},
               {"block_index": -1}, {"block_index": 32}, {"block_index": 1.0},
               {"block_index": torch.tensor(24)}, {"block_index": 24, "total_blocks": 31}]
        for options in bad:
            with self.subTest(options=options), self.assertRaises(ValueError):
                override(lambda *a, **kw: q, q, k, v, 2, transformer_options=options)
        with self.assertRaises(ValueError):
            override(lambda *a, **kw: q, q, k, v, 2)
        self.assertEqual(override.audit.key_copies, 0)

    def test_prefix_and_unselected_layer_preserve_objects_and_mask(self):
        override = self.override()
        for layer, nq, nk in ((0, 4, 24), (23, 4, 24), (24, 2, 2),
                              (31, 4, 17), (31, 3, 20)):
            q, k, v = [torch.randn(1, n, 256) for n in (nq, nk, nk)]
            mask = torch.ones(nq, nk, dtype=torch.bool)
            def capture(q1, k1, v1, heads, mask=None, **kw):
                self.assertIs(q1, q); self.assertIs(k1, k); self.assertIs(v1, v)
                self.assertIs(mask, saved_mask)
                return q1
            saved_mask = mask
            self.assertIs(override(capture, q, k, v, 2, mask=mask, **self.opts(layer)), q)
        self.assertEqual(override.audit.key_copies, 0)
        self.assertEqual(override.audit.prefix_calls, 3)

    def test_selected_style_only_spatial_pairs_change_and_original_cache_stays_clean(self):
        override = self.override(batch=2)
        q, k, v = self.tensors(batch=2, dtype=torch.bfloat16)
        saved = [t.clone() for t in (q, k, v)]
        mask = torch.zeros(4, 24)
        observed = []
        def capture(q1, k1, v1, heads, mask=None, **kw):
            observed.append((q1, k1, v1, mask)); return k1
        out = override(capture, q, k, v, 2, mask=mask, **self.opts(24))
        q1, changed, v1, m1 = observed[0]
        self.assertIs(q1, q); self.assertIs(v1, v); self.assertIs(m1, mask)
        expected = k.clone().reshape(2, 24, 2, 128)
        span = override.layout.references[1]
        expected[:, span.start:span.end, :, 16:] *= override.cpu_vector[16:].to(k.dtype)
        torch.testing.assert_close(out, expected.flatten(2), rtol=0, atol=0)
        for current, before in zip((q, k, v), saved):
            torch.testing.assert_close(current, before, rtol=0, atol=0)
        torch.testing.assert_close(changed.reshape(2, 24, 2, 128)[:, span.start:span.end, :, :16],
                                   k.reshape(2, 24, 2, 128)[:, span.start:span.end, :, :16], rtol=0, atol=0)

    def test_native_attention_flat_and_reshaped_layouts(self):
        for reshaped in (False, True):
            q, k, v = self.tensors()
            if reshaped:
                q, k, v = [t.reshape(1, t.shape[1], 2, 128).transpose(1, 2) for t in (q, k, v)]
            override = self.override()
            options = {"optimized_attention_override": override, "block_index": 24, "total_blocks": 32}
            actual = attention_pytorch(q, k, v, 2, skip_reshape=reshaped, transformer_options=options)
            expected_k = k.clone()
            if reshaped:
                expected_k[:, :, 13:17, 16:] *= override.cpu_vector[16:]
            else:
                expected_k = expected_k.reshape(1, 24, 2, 128)
                expected_k[:, 13:17, :, 16:] *= override.cpu_vector[16:]
                expected_k = expected_k.flatten(2)
            expected = attention_pytorch(q, expected_k, v, 2, skip_reshape=reshaped)
            torch.testing.assert_close(actual, expected)

    def test_previous_override_composes_once_and_preserves_kwargs(self):
        calls = []
        def previous(native, q, k, v, heads, mask=None, **kw):
            calls.append((q, k, v, mask, kw)); return native(q, k, v, heads, mask=mask, **kw)
        override = self.override(previous)
        for layer, nq, nk in ((0, 4, 24), (24, 4, 24), (24, 2, 2)):
            q, k, v = [torch.randn(1, n, 256) for n in (nq, nk, nk)]
            mask = torch.ones(nq, nk, dtype=torch.bool)
            override(lambda *a, **kw: q, q, k, v, 2, mask=mask,
                     _inside_attn_wrapper=True, **self.opts(layer))
            q1, k1, v1, m1, kw = calls[-1]
            self.assertIs(q1, q); self.assertIs(v1, v); self.assertIs(m1, mask)
            self.assertTrue(kw["_inside_attn_wrapper"])
            self.assertEqual(k1 is k, layer == 0 or nq != 4)
        self.assertEqual(len(calls), 3)
        self.assertEqual(override.audit.previous_override_calls, 3)

    def test_layer_bounds_and_bad_scalars(self):
        for start, end in ((-1, 1), (True, 31), (24, 23), (0.0, 31), (0, None)):
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                layer_window(start, end, 32)
        with self.assertRaises(ValueError):
            layer_window(24, 32, 32)
        node = NovaFlowQwen21StyleKeyLayerWindowExperimental()
        for kwargs in ({"high_scale": float("nan")}, {"low_scale": -1}, {"beta": 0},
                       {"style_reference_index": True}, {"active_sigma_min": 2}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                node.patch(object(), True, **kwargs)

    def test_patch_clones_options_only_and_guards_all_preferred_backends(self):
        node = NovaFlowQwen21StyleKeyLayerWindowExperimental()
        patcher = tiny_patcher()
        original = patcher.model_options
        changed = node.patch(patcher, True, layer_start=2, layer_end=2)[0]
        self.assertIsNot(changed, patcher); self.assertIs(changed.model, patcher.model)
        self.assertIs(patcher.model_options, original)
        self.assertEqual(original, {"transformer_options": {}})
        wrapper = extension.get_wrappers_with_key(extension.WrappersMP.DIFFUSION_MODEL, WRAPPER_KEY,
                                                  changed.model_options["transformer_options"])[0]
        self.assertEqual(wrapper.preferred_backend_check, {"required": True, "checked_layers": 3, "non_null_count": 0})
        # Guard an UNSELECTED layer too, without ever calling that function.
        called = []
        fn = lambda *a, **kw: called.append(True)
        patcher.model.diffusion_model.transformer_blocks[0].attn.comfy_attention.function = fn
        with self.assertRaisesRegex(ValueError, "preferred attention"):
            node.patch(patcher, True, layer_start=2, layer_end=2)
        self.assertEqual(called, [])
        self.assertIs(patcher.model.diffusion_model.transformer_blocks[0].attn.comfy_attention.function, fn)

    def test_old_new_and_duplicate_frequency_wrappers_reject(self):
        node = NovaFlowQwen21StyleKeyLayerWindowExperimental()
        patcher = tiny_patcher()
        changed = node.patch(patcher, True, layer_start=2, layer_end=2)[0]
        with self.assertRaisesRegex(ValueError, "stack"):
            node.patch(changed, True, layer_start=2, layer_end=2)
        options = {"transformer_options": {}}
        extension.add_wrapper_with_key(extension.WrappersMP.DIFFUSION_MODEL,
            OLD_FREQUENCY_WRAPPER_KEY, lambda *a, **kw: None, options["transformer_options"])
        with self.assertRaisesRegex(ValueError, "stack"):
            node.patch(FakePatcher(patcher.model, options), True, layer_start=2, layer_end=2)

    def test_native_three_layers_cached_and_uncached_prefix_and_window(self):
        patcher = tiny_patcher()
        tiny = patcher.model.diffusion_model
        node = NovaFlowQwen21StyleKeyLayerWindowExperimental()
        options = node.patch(patcher, True, layer_start=2, layer_end=2)[0].model_options["transformer_options"]
        wrapper = extension.get_wrappers_with_key(extension.WrappersMP.DIFFUSION_MODEL, WRAPPER_KEY, options)[0]
        data = inputs()
        with torch.inference_mode():
            off = tiny(*data, {})
            uncached = tiny(*data, options)
        self.assertGreater(float((uncached - off).abs().max()), 1e-8)
        cache, selections = CpuCache(), []
        def select(key, size, device, config):
            hit = bool(cache.values); selections.append(hit); return cache, hit
        tiny.select_prefix_cache = select
        tiny.prefix_cache_enabled = True
        with torch.inference_mode():
            first = tiny(*data, options)
            saved = {i: value.clone() for i, value in cache.values.items()}
            second = tiny(*data, options)
            third = tiny(*data, {})
        self.assertEqual(selections, [False, True, True])
        self.assertEqual((cache.puts, cache.takes), (3, 9))
        self.assertEqual(sorted(wrapper.audit.selected_target_by_layer), [2])
        self.assertEqual(sorted(wrapper.audit.bypassed_target_by_layer), [0, 1])
        torch.testing.assert_close(first, uncached, rtol=1e-5, atol=1e-7)
        torch.testing.assert_close(first, second, rtol=1e-5, atol=1e-7)
        torch.testing.assert_close(third, off, rtol=1e-5, atol=1e-7)
        for i in saved:
            torch.testing.assert_close(cache.values[i], saved[i], rtol=0, atol=0)
        METRICS["native_tiny_layers"] = 3
        METRICS["native_tiny_selected_layers"] = sorted(wrapper.audit.selected_target_by_layer)
        METRICS["cache_selections"] = selections
        METRICS["cached_prefix_max_change"] = max(float((cache.values[i] - saved[i]).abs().max()) for i in saved)
        METRICS["cached_vs_uncached_max_error"] = float((first - uncached).abs().max())
        METRICS["cached_repeat_max_error"] = float((first - second).abs().max())
        METRICS["native_nonidentity_max_change"] = float((uncached - off).abs().max())

    def test_dynamic_context_and_batch_geometry(self):
        patcher = tiny_patcher()
        options = NovaFlowQwen21StyleKeyLayerWindowExperimental().patch(
            patcher, True, layer_start=2, layer_end=2)[0].model_options["transformer_options"]
        with torch.inference_mode():
            for text, batch in ((10, 1), (18, 2)):
                out = patcher.model.diffusion_model(*inputs(text, batch), options)
                self.assertEqual(tuple(out.shape), (batch, 4, 2, 2))
                self.assertTrue(torch.isfinite(out).all())

    def test_actual_32_layer_native_uses_default_24_to_31_window(self):
        patcher = tiny_patcher(layers=32)
        options = NovaFlowQwen21StyleKeyLayerWindowExperimental().patch(
            patcher, True)[0].model_options["transformer_options"]
        wrapper = extension.get_wrappers_with_key(extension.WrappersMP.DIFFUSION_MODEL,
                                                  WRAPPER_KEY, options)[0]
        with torch.inference_mode():
            result = patcher.model.diffusion_model(*inputs(), options)
        self.assertTrue(torch.isfinite(result).all())
        self.assertEqual(wrapper.audit.selected_target_by_layer, {i: 1 for i in range(24, 32)})
        self.assertEqual(wrapper.audit.bypassed_target_by_layer, {i: 1 for i in range(24)})
        self.assertEqual(wrapper.audit.key_copies, 8)
        self.assertEqual(wrapper.preferred_backend_check["checked_layers"], 32)
        METRICS["actual_native_random_32_layer_window"] = wrapper.audit.selected_target_by_layer

    def test_active_wrapper_rejects_unreached_selected_window(self):
        wrapper = LayerWindowForward(1, .5, 1.5, 2, 24, 31, 32)
        with self.assertRaisesRegex(ValueError, "not reached"):
            wrapper(lambda x, *a, **kw: x, *inputs(), {})

    def test_sigma_inactive_preserves_exact_options_and_vector_legacy(self):
        original = {"optimized_attention_override": lambda *a, **kw: None, "custom": object()}
        wrapper = LayerWindowForward(1, .5, 1.5, 2, 24, 31, 32, active_sigma_min=.9)
        data = list(inputs()); data[1] = torch.tensor([.8])
        calls = []
        def executor(x, t, c, refs, slots, options, **kw):
            calls.append(options); return x
        wrapper(executor, *data, original)
        self.assertIs(calls[0], original)
        self.assertEqual(wrapper.audit.key_copies, 0)
        self.assertEqual(hashlib.sha256(frequency_scale_vector(.5, 1.5, 2).numpy().tobytes()).hexdigest(),
                         "6d9c5a313e747d113057e763dc78c2aa4e25646b0707b5e1f90513f325fca665")


if __name__ == "__main__":
    start = time.perf_counter()
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(LayerWindowTests))
    folder = Path(__file__).parent
    origin = json.loads((folder / "ORIGIN.json").read_text(encoding="utf-8"))
    unchanged = all(hashlib.sha256(Path(p).read_bytes()).hexdigest() == h for p, h in origin["sources"].items())
    report = {"timestamp_utc": datetime.now(timezone.utc).isoformat(), "tests_run": result.testsRun,
              "failures": len(result.failures), "errors": len(result.errors), "passed": result.wasSuccessful() and unchanged,
              "test_seconds": time.perf_counter() - start, "native_comfy_root": str(COMFY),
              "native_device": str(management.get_torch_device()), "cuda_initialized": torch.cuda.is_initialized(),
              "loaded_generation_model_weights": False, "image_quality_validated": False,
              "old_frequency_sources_unchanged": unchanged, "input_types": NovaFlowQwen21StyleKeyLayerWindowExperimental.INPUT_TYPES(),
              **METRICS}
    (folder / "cpu-test-results.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    raise SystemExit(0 if report["passed"] else 1)
