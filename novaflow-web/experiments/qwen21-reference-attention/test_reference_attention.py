"""CPU-only tests against the installed native ComfyUI attention call contract."""

import os
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"

from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sys
import types
import time
import unittest

COMFY = Path(os.environ.get("NF_COMFY_ROOT", "C:/ProgramData/NovaFlow/AI-Runtime/engine/ComfyUI"))
sys.path.insert(0, str(COMFY))
import comfy.cli_args
comfy.cli_args.args.cpu = True
comfy.cli_args.args.disable_dynamic_vram = True
comfy.cli_args.args.use_pytorch_cross_attention = True

import torch
import comfy.model_management as management
import comfy.patcher_extension as extension
from comfy.ldm.modules.attention import AttentionTensorContainer, attention_pytorch
from comfy.ldm.qwen_image21.model import QwenImage21Transformer2DModel, ZeroCenteredRMSNorm
from comfy.model_base import QwenImage21

from reference_attention import (
    MIN_GAIN, WRAPPER_KEY, AttentionAudit, ReferenceAttentionOverride,
    ReferenceForwardWrapper, NovaFlowQwen21ReferenceAttentionExperimental,
    sequence_layout,
)

METRICS = {}


def inputs(text=10, batch=1):
    return (
        torch.randn(batch, 4, 2, 2), torch.tensor([0.4] * batch),
        torch.randn(batch, text, 8),
        [torch.randn(batch, 4, 2, 3), torch.randn(batch, 4, 1, 4)], [2, 7],
    )


def cpu_attention(q, k, v, heads, mask=None, **kwargs):
    return attention_pytorch(q, k, v, heads, mask=mask, **kwargs)


class FakePatcher:
    """Only the node's clone/options protocol; contains real native model classes."""
    def __init__(self, base, options=None):
        self.model = base
        self.model_options = options if options is not None else {"transformer_options": {}}

    def clone(self):
        return FakePatcher(self.model, extension.copy_nested_dicts(self.model_options))


def tiny_patcher():
    torch.manual_seed(9281)
    tiny = QwenImage21Transformer2DModel(
        in_channels=4, out_channels=4, num_layers=1, attention_head_dim=8,
        num_attention_heads=2, context_in_dim=8, mlp_ratio=2,
        axes_dims_rope=(2, 2, 4), fused_mlp=False,
        dtype=torch.float32, device="cpu", operations=torch.nn,
    )
    with torch.no_grad():
        for p in tiny.parameters():
            p.uniform_(-0.15, 0.15)
        for module in tiny.modules():
            if isinstance(module, ZeroCenteredRMSNorm):
                module.weight.zero_()
    base = QwenImage21.__new__(QwenImage21)
    torch.nn.Module.__init__(base)
    base.diffusion_model = tiny
    return FakePatcher(base)


class CpuCache:
    """Small CPU storage exercising native cached and uncached forward branches."""
    def __init__(self):
        self.values = {}
        self.puts = 0
        self.takes = 0

    def put(self, block, value):
        self.values[block] = value.clone()
        self.puts += 1

    def take(self, block, device, dtype, batch):
        self.takes += 1
        return self.values[block].to(device=device, dtype=dtype)

    def prefetch(self, *args):
        pass


class ReferenceAttentionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.previous_training = management.in_training
        management.in_training = True
        torch.set_num_threads(2)

    @classmethod
    def tearDownClass(cls):
        management.in_training = cls.previous_training

    def setUp(self):
        torch.manual_seed(42)

    def layout(self, text=10, batch=1):
        x, t, context, refs, slots = inputs(text=text, batch=batch)
        return sequence_layout(x, context, refs, slots)

    def test_native_cpu_has_not_initialized_cuda(self):
        self.assertEqual(str(management.get_torch_device()), "cpu")
        self.assertFalse(torch.cuda.is_initialized())

    def test_exact_interleaved_spans_and_fallback_slots(self):
        x, _, context, refs, slots = inputs()
        layout = sequence_layout(x, context, refs, slots)
        self.assertEqual([(s.start, s.end) for s in layout.references], [(2, 8), (13, 17)])
        self.assertEqual((layout.prefix_tokens, layout.target_tokens, layout.total_tokens), (20, 4, 24))
        appended = sequence_layout(x, context, refs, [])
        self.assertEqual([(s.start, s.end) for s in appended.references], [(10, 16), (16, 20)])
        repeated = sequence_layout(x, context, refs, [0, 0])
        self.assertEqual([(s.start, s.end) for s in repeated.references], [(0, 6), (6, 10)])

    def test_layout_matches_actual_native_build_sequence(self):
        patcher = tiny_patcher()
        x, _, context, refs, slots = inputs()
        with torch.inference_mode():
            hidden, _, segments = patcher.model.diffusion_model.build_sequence(x, context, refs, slots)
        layout = sequence_layout(x, context, refs, slots)
        image_segments = [(a, b) for a, b, mask in segments if mask is None]
        self.assertEqual(image_segments, [(2, 8), (13, 17), (20, 24)])
        self.assertEqual(hidden.shape[1], layout.total_tokens)

    def test_malformed_layouts_rejected(self):
        x, _, context, refs, slots = inputs()
        for bad_slots in ([7, 2], [2, 11], [-1, 2], [True, 2], [1.5, 2], [1, 2, 3]):
            with self.subTest(slots=bad_slots), self.assertRaises(ValueError):
                sequence_layout(x, context, refs, bad_slots)
        with self.assertRaises(ValueError):
            sequence_layout(x, context, [refs[0].unsqueeze(2), refs[1]], slots)
        with self.assertRaises(ValueError):
            sequence_layout(x, context.repeat(2, 1, 1), refs, slots)
        with self.assertRaises(ValueError):
            sequence_layout(x, context, [refs[0].repeat(2, 1, 1, 1), refs[1]], slots)

    def test_identity_returns_same_model_and_options(self):
        model = object()
        node = NovaFlowQwen21ReferenceAttentionExperimental()
        self.assertIs(node.patch(model, enabled=False)[0], model)
        self.assertIs(node.patch(model, enabled=True)[0], model)
        patcher = tiny_patcher()
        original_options = patcher.model_options
        self.assertIs(node.patch(patcher, enabled=True)[0], patcher)
        self.assertIs(patcher.model_options, original_options)
        self.assertEqual(patcher.model_options, {"transformer_options": {}})

    def test_invalid_gains_indices_architecture_and_stacking(self):
        patcher = tiny_patcher()
        node = NovaFlowQwen21ReferenceAttentionExperimental()
        for gain in (-1.0, float("nan"), float("inf"), True, 17):
            with self.subTest(gain=gain), self.assertRaises(ValueError):
                node.patch(patcher, True, style_reference_attention_gain=gain)
        for index in (-1, 0.3, True):
            with self.subTest(index=index), self.assertRaises(ValueError):
                node.patch(patcher, True, style_reference_index=index, style_reference_attention_gain=2)
        with self.assertRaises(ValueError):
            node.patch(patcher, True, 0, 0, 1, 2)
        with self.assertRaises(TypeError):
            node.patch(FakePatcher(types.SimpleNamespace(diffusion_model=object())), True, 0, 1, 1, 2)
        patched = node.patch(patcher, True, 0, 1, 1, 2)[0]
        with self.assertRaises(ValueError):
            node.patch(patched, True, 0, 1, 1, 2)

    def test_native_wrap_attn_consumes_override_and_expected_log_bias(self):
        layout = self.layout()
        audit = AttentionAudit()
        override = ReferenceAttentionOverride(layout, {0: 0.5, 1: 2.0}, audit=audit)
        q = torch.zeros(1, 4, 8)
        k = torch.zeros(1, 24, 8)
        v = torch.zeros(1, 24, 8)
        v[:, 2:8] = 1
        v[:, 13:17] = 4
        v[:, 20:] = 2
        # Zero logits allow exact weighted mass verification: 6*0.5 source
        # keys, 4*2 style keys, and 14 unaffected text/target keys.
        expected = (6 * 0.5 + 4 * 2 * 4 + 4 * 2) / (6 * 0.5 + 4 * 2 + 14)
        actual = attention_pytorch(q, k, v, 2, transformer_options={"optimized_attention_override": override})
        torch.testing.assert_close(actual, torch.full_like(actual, expected))
        self.assertEqual(audit.target_calls, 1)

    def test_reference_prefix_and_text_attention_are_exactly_unmodified(self):
        layout = self.layout()
        override = ReferenceAttentionOverride(layout, {0: 0, 1: 4})
        # A reference can have the SAME query count as target. Full key length
        # must also match before a gain is applied.
        for q_count, k_count in ((2, 2), (6, 8), (4, 17), (3, 20)):
            q, k, v = torch.randn(1, q_count, 8), torch.randn(1, k_count, 8), torch.randn(1, k_count, 8)
            mask = torch.ones(q_count, k_count, dtype=torch.bool)
            seen = []
            def capture(q1, k1, v1, h, mask=None, **kw):
                seen.append((q1 is q, k1 is k, v1 is v, mask is original_mask))
                return cpu_attention(q1, k1, v1, h, mask=mask, **kw)
            original_mask = mask
            actual = override(capture, q, k, v, 2, mask=mask)
            expected = cpu_attention(q, k, v, 2, mask=mask)
            torch.testing.assert_close(actual, expected, rtol=0, atol=0)
            self.assertEqual(seen, [(True, True, True, True)])
        self.assertEqual(override.audit.target_calls, 0)
        self.assertEqual(override.audit.prefix_calls, 4)

    def test_existing_boolean_and_float_masks_not_mutated(self):
        layout = self.layout()
        override = ReferenceAttentionOverride(layout, {0: 0.5, 1: 2})
        q, k, v = torch.randn(1, 4, 8), torch.randn(1, 24, 8), torch.randn(1, 24, 8)
        for shape in ((4, 24), (1, 4, 24), (1, 1, 4, 24)):
            for boolean in (True, False):
                mask = torch.ones(shape, dtype=torch.bool) if boolean else torch.zeros(shape)
                mask[..., 3] = False if boolean else -3
                original = mask.clone()
                actual = override(cpu_attention, q, k, v, 2, mask=mask)
                bias = torch.zeros(24)
                bias[2:8] = math.log(0.5)
                bias[13:17] = math.log(2)
                expected_mask = (torch.zeros(shape).masked_fill(~mask, float("-inf"))
                                 if boolean else mask) + bias
                expected = cpu_attention(q, k, v, 2, mask=expected_mask)
                torch.testing.assert_close(actual, expected)
                torch.testing.assert_close(mask, original)

    def test_zero_gain_is_finite_suppression_and_all_masked_is_safe(self):
        override = ReferenceAttentionOverride(self.layout(), {0: 0, 1: 0})
        q, k, v = torch.zeros(1, 4, 8), torch.zeros(1, 24, 8), torch.ones(1, 24, 8)
        masks = []
        def capture(q, k, v, h, mask=None, **kw):
            masks.append(mask)
            return cpu_attention(q, k, v, h, mask=mask, **kw)
        actual = override(capture, q, k, v, 2)
        self.assertTrue(torch.isfinite(actual).all())
        self.assertTrue(torch.isfinite(masks[0]).all())
        self.assertEqual(float(masks[0][0, 0, 2]), float(torch.tensor(math.log(MIN_GAIN))))
        masked = override(cpu_attention, q, k, v, 2, mask=torch.zeros(4, 24, dtype=torch.bool))
        self.assertTrue(torch.isfinite(masked).all())
        torch.testing.assert_close(masked, torch.zeros_like(masked))

    def test_existing_override_composes_in_native_call_order(self):
        layout = self.layout()
        observed = []
        def previous(native, q, k, v, heads, mask=None, **kw):
            observed.append(mask.clone() if mask is not None else None)
            return native(q, k, v, heads, mask=mask, **kw)
        override = ReferenceAttentionOverride(layout, {0: 1, 1: 2}, previous=previous)
        q, k, v = torch.randn(1, 4, 8), torch.randn(1, 24, 8), torch.randn(1, 24, 8)
        actual = attention_pytorch(q, k, v, 2, transformer_options={"optimized_attention_override": override})
        self.assertEqual(len(observed), 1)
        self.assertEqual(float(observed[0][0, 0, 13]), float(torch.tensor(math.log(2))))
        expected = cpu_attention(q, k, v, 2, mask=observed[0])
        torch.testing.assert_close(actual, expected)
        self.assertEqual(override.audit.delegated_override_calls, 1)

    def test_native_tensor_container_fallback_consumes_once(self):
        layout = self.layout()
        override = ReferenceAttentionOverride(layout, {0: 1, 1: 2})
        tensors = [torch.randn(1, n, 8) for n in (4, 24, 24)]
        containers = [AttentionTensorContainer(t) for t in tensors]
        actual = attention_pytorch(*containers, 2, transformer_options={"optimized_attention_override": override})
        expected = attention_pytorch(*tensors, 2, transformer_options={"optimized_attention_override": override})
        torch.testing.assert_close(actual, expected)
        self.assertTrue(all(c.tensor is None for c in containers))

    def test_skip_reshape_and_batched_cfg(self):
        layout = self.layout(batch=2)
        override = ReferenceAttentionOverride(layout, {0: 0.8, 1: 1.4})
        q, k, v = torch.randn(2, 2, 4, 4), torch.randn(2, 2, 24, 4), torch.randn(2, 2, 24, 4)
        actual = attention_pytorch(q, k, v, 2, skip_reshape=True,
                                   transformer_options={"optimized_attention_override": override})
        self.assertEqual(tuple(actual.shape), (2, 4, 8))
        self.assertTrue(torch.isfinite(actual).all())

    def test_bfloat16_mask_remains_finite(self):
        override = ReferenceAttentionOverride(self.layout(), {0: 0, 1: 1.5})
        q, k, v = [torch.randn(1, n, 8, dtype=torch.bfloat16) for n in (4, 24, 24)]
        actual = attention_pytorch(q, k, v, 2,
                                   transformer_options={"optimized_attention_override": override})
        self.assertEqual(actual.dtype, torch.bfloat16)
        self.assertTrue(torch.isfinite(actual).all())

    def test_each_forward_recalculates_cfg_context_and_keeps_input_options(self):
        wrapper = ReferenceForwardWrapper(0, 1, 0.8, 1.4)
        previous = lambda native, *args, **kw: native(*args, **kw)
        options = {"optimized_attention_override": previous, "sentinel": {"keep": True}}
        layouts = []
        def execute(x, t, c, refs, slots, opts, **kw):
            self.assertIsNot(opts, options)
            self.assertIs(opts["optimized_attention_override"].previous, previous)
            layouts.append(opts["optimized_attention_override"].layout)
            return x
        for text, batch in ((10, 1), (18, 2)):
            x, t, c, refs, slots = inputs(text=text, batch=batch)
            wrapper(execute, x, t, c, refs, slots, options)
        self.assertEqual([l.total_tokens for l in layouts], [24, 32])
        self.assertEqual([l.batch for l in layouts], [1, 2])
        self.assertIs(options["optimized_attention_override"], previous)
        self.assertEqual(wrapper.audit.forwards, 2)
        with self.assertRaises(ValueError):
            bad = ReferenceForwardWrapper(0, 2, 1, 2)
            x, t, c, refs, slots = inputs()
            bad(execute, x, t, c, refs, slots, options)

    def test_native_model_clone_registration_and_tiny_forward(self):
        patcher = tiny_patcher()
        tiny = patcher.model.diffusion_model
        node = NovaFlowQwen21ReferenceAttentionExperimental()
        patched = node.patch(patcher, True, 0, 1, 0.8, 1.6)[0]
        self.assertIsNot(patched, patcher)
        self.assertEqual(patcher.model_options, {"transformer_options": {}})
        options = patched.model_options["transformer_options"]
        self.assertNotIn("patches", options)
        self.assertNotIn("patches_replace", options)
        wrappers = extension.get_wrappers_with_key(extension.WrappersMP.DIFFUSION_MODEL, WRAPPER_KEY, options)
        self.assertEqual(len(wrappers), 1)
        x, t, context, refs, slots = inputs()
        with torch.inference_mode():
            original = tiny(x, t, context, refs, slots, {})
            identity = tiny(x, t, context, refs, slots,
                            node.patch(patcher, True)[0].model_options["transformer_options"])
            changed = tiny(x, t, context, refs, slots, options)
        torch.testing.assert_close(original, identity, rtol=0, atol=0)
        self.assertTrue(torch.isfinite(changed).all())
        self.assertGreater(float((changed - original).abs().max()), 1e-8)
        METRICS["tiny_max_absolute_change"] = float((changed - original).abs().max())
        METRICS["tiny_identity_max_error"] = float((identity - original).abs().max())
        self.assertEqual(wrappers[0].audit.forwards, 1)
        self.assertEqual(wrappers[0].audit.target_calls, 1)
        self.assertGreater(wrappers[0].audit.prefix_calls, 0)

    def test_native_different_cfg_condition_lengths_recompute_spans(self):
        patcher = tiny_patcher()
        patched = NovaFlowQwen21ReferenceAttentionExperimental().patch(
            patcher, True, 0, 1, 0.9, 1.4)[0]
        options = patched.model_options["transformer_options"]
        wrappers = extension.get_wrappers_with_key(extension.WrappersMP.DIFFUSION_MODEL, WRAPPER_KEY, options)
        with torch.inference_mode():
            for text, batch in ((10, 1), (18, 2)):
                x, t, context, refs, slots = inputs(text=text, batch=batch)
                actual = patcher.model.diffusion_model(x, t, context, refs, slots, options)
                self.assertEqual(tuple(actual.shape), (batch, 4, 2, 2))
                self.assertEqual(wrappers[0].audit.latest_layout["total_tokens"], text + 14)
                self.assertTrue(torch.isfinite(actual).all())
        self.assertEqual(wrappers[0].audit.forwards, 2)

    def test_native_prefix_cache_branch_survives_override_and_reads(self):
        patcher = tiny_patcher()
        tiny = patcher.model.diffusion_model
        node = NovaFlowQwen21ReferenceAttentionExperimental()
        patched = node.patch(patcher, True, 0, 1, 0.8, 1.6)[0]
        options = patched.model_options["transformer_options"]
        cache = CpuCache()
        selections = []
        def select(key, cache_bytes, device, opts):
            cached = bool(cache.values)
            selections.append(cached)
            return cache, cached
        tiny.select_prefix_cache = select  # Only this tiny CPU instance.
        tiny.prefix_cache_enabled = True
        x, t, context, refs, slots = inputs()
        with torch.inference_mode():
            first = tiny(x, t, context, refs, slots, options)
            second = tiny(x, t, context, refs, slots, options)
        self.assertEqual(selections, [False, True])
        self.assertEqual((cache.puts, cache.takes), (1, 2))
        METRICS["native_cache_branch_selections"] = selections
        METRICS["cpu_cache_puts"] = cache.puts
        METRICS["cpu_cache_takes"] = cache.takes
        METRICS["cached_forward_max_error"] = float((first - second).abs().max())
        torch.testing.assert_close(first, second, rtol=1e-5, atol=1e-7)
        wrappers = extension.get_wrappers_with_key(extension.WrappersMP.DIFFUSION_MODEL, WRAPPER_KEY, options)
        self.assertEqual(wrappers[0].audit.target_calls, 2)
        self.assertEqual(wrappers[0].audit.forwards, 2)


if __name__ == "__main__":
    started = time.perf_counter()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ReferenceAttentionTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    report = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "tests_run": result.testsRun,
        "failures": len(result.failures),
        "errors": len(result.errors),
        "passed": result.wasSuccessful(),
        "test_seconds": time.perf_counter() - started,
        "native_comfy_root": str(COMFY),
        "native_device": str(management.get_torch_device()),
        "cuda_initialized": torch.cuda.is_initialized(),
        "loaded_generation_model_weights": False,
        "image_quality_validated": False,
        **METRICS,
    }
    Path(__file__).with_name("cpu-test-results.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8")
    raise SystemExit(0 if result.wasSuccessful() else 1)
