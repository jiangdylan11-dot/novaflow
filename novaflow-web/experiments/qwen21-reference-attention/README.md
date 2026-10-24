# Native Qwen 2.1 reference attention gain experiment

This is an isolated self-authored QA node. It is not registered, provisioned, or installed in the maintained ComfyUI or NovaFlow route. This directory is not an application runtime entry. No third-party candidate node implementation is copied. It contains no learned adapter weights and is not a promise of style/identity separation.

## Native contract

- Input and output: MODEL. A non-identity enabled call clones the patcher's options; model weights are shared normally.
- Native classes only: exactly `comfy.model_base.QwenImage21` and `comfy.ldm.qwen_image21.model.QwenImage21Transformer2DModel`.
- Keep the existing GGUF BF16 loader, BF16 Qwen3VL encoder, native 2.1 VAE and `TextEncodeQwenImage21` unchanged.
- Source and style indices are zero based; defaults 0 and 1. They refer to actual native reference order, not prompt text labels.
- Honest parameters: `source_reference_attention_gain` and `style_reference_attention_gain`. They change the attention weight of complete reference key blocks. They do not isolate style from the donor's person, garment, composition or background.
- `enabled=False` or both gains exactly 1 returns the identical input MODEL with no clone, wrapper, bias or cache effect.
- Gains must be finite, nonnegative and at most 16 (UI at most 4). Gain 0 is clamped to 1e-6 before log; it strongly suppresses that key block without infinite gain-induced logits. It does not delete the reference from text encoding or earlier reference interactions.

## Operation

A scoped `DIFFUSION_MODEL` wrapper derives reference spans for every actual conditional forward from x, context, reference shapes and `image_slots`. Missing slots use the same native end-of-text fallback. Slots outside context, unordered slots, unexpected dimensions, mismatched batches/channels, missing indexed references and stacking this same node fail explicitly.

The wrapper composes `optimized_attention_override`. It adds `log(gain)` only for target-image queries attending the full key sequence. Prefix text and reference attention passes receive unchanged tensor/mask objects, even if their query count coincidentally equals the target count. Existing boolean/float masks are merged without in-place edits. A previous callable attention override is retained and receives the augmented mask through the real native call contract. Overrides that intentionally ignore masks can still defeat a mask-based control; no compatibility promise is made for arbitrary third-party overrides.

No global monkey patch, Q/K/V mutation, block replacement, additional image encoding, prompt rewrite or extra diffusion pass is introduced. No `attn1_patch`, post_input or single_block hook is registered. Native prefix cache eligibility therefore remains unchanged. Cached target-only queries still use full prefix+target K/V, so their gain spans remain the same as the initial target call.

The native selected attention backend receives an additive floating mask. The mask stores O(K) values and broadcasts over target queries. A backend may use a different masked-attention kernel, lose its fastest unmasked path, or reject this mask. The installed BF16 GGUF runtime has been checked below; arbitrary backends are not covered. Prefix-cache preservation alone does not prove equal speed. The native tensor-container fallback is supported, but its special container-only backend path is not preserved when an ordinary callable override is installed, matching native fallback behavior.

The native attention dispatcher removes `preferred_attention` before entering an override. A checkpoint that depends on a specialized preferred backend therefore needs a new compatibility and timing audit. Other plugins that modify the token sequence can also invalidate the expected shapes and leave a call without gains. The isolated graph below has neither sequence-changing hooks nor a known checkpoint-specific preferred backend; arbitrary plugin combinations are not supported.

`audit_log=True` logs each forward's reference spans, target/prefix call counts and gains as `Qwen21ReferenceAttention audit={...}`. A cache-enabled run should normally show prefix computation on its initial uncached call and no prefix attention on cache reads. Separate positive/negative conditions can each require their own first cached prefix.

## CPU verification

Run with the bundled Python (the script hides CUDA before importing Torch, forces native Comfy to CPU, and restores its process-local training flag):

```powershell
& C:/ProgramData/NovaFlow/AI-Runtime/engine/python/python.exe D:/AI_APP/NovaFlow-Web/novaflow-web/experiments/qwen21-reference-attention/test_reference_attention.py
```

`NF_COMFY_ROOT` can select another native Comfy source root. The tests import the actual installed native `wrap_attn`, `attention_pytorch`, `WrapperExecutor` and Qwen 2.1 transformer implementation. A one-layer tiny transformer is constructed with small random CPU tensors; no generation model weights, image model or text encoder is loaded.

Coverage includes native build_sequence span equivalence, no-op identity, finite zero gains, existing masks, existing override composition, tensor container consumption, different CFG context lengths and batches, actual tiny native target-output changes, and both native prefix-cache forward branches. A tiny CPU cache object stores actual K/V from the first call and returns them to the native second cached call. This exercises native cache branch control flow without allocating a real model cache. These are functional CPU proofs, not image quality, GPU cache storage, GPU kernel or speed proofs.

Actual result summary is written to `cpu-test-results.json`.

## Isolated GPU QA, only if the root agent schedules it

Load only this prototype folder as a custom-node folder in an independent QA Comfy server. Do not copy it to the maintained runtime. Insert the node after the normal model/cache stage and before the existing sampler. Preserve the four previously accepted style baselines, original output sizes, positive/negative conditions, seed and sampling parameters. Change only reference attention gains per comparison. Start with small changes; high gains can import donor content or damage aesthetics.

Normal stays 25 steps and Turbo stays its dedicated 8-step/CFG1 schedule. Do not change CFG, source/style resolution, analyzer, prompt and gains together. Review hair drawing, facial design, palette, materials, original identity/expression, source composition and donor-content leakage. A visually pretty image alone does not establish reference-specific style transfer. Keep the prototype out of the formal route until these checks pass.

## Recorded local verification, 2026-10-24

The committed source is byte-identical to the isolated prototype used for these checks. The node was loaded only by an owned QA ComfyUI on port 8192, with the existing native BF16 GGUF loader, BF16 Qwen3VL encoder and native 2.1 VAE. Existing services and application routes were not restarted or replaced. Private inputs, generated images and logs remain in the ignored work directory.

- CPU: 18 tests passed against the actual installed native attention and tiny random transformer. Identity maximum error was zero; a non-identity gain changed the target numerically; CPU cache put/read branches both passed without CUDA initialization.
- Real model compatibility: task `b16da9ea-1533-4bc2-9a7c-c6391349a4ed`, 1280x960, CFG3, two steps, source gain1/style gain1.15, completed in 50.612 seconds. Both positive/negative initial forwards computed prefix attention; both second-step forwards had zero prefix-attention calls and 32 target calls. This is compatibility and cache evidence, not a quality sample.
- Full sample: task `e4241ebe-90ca-4c89-a9a0-395af6e769d6`, normal BF16 GGUF/25 steps, source gain1/style gain1.15, completed in 119.688 seconds. It reused the accepted CG case's original references, seed, complete positive/negative and reference budgets. The model was warm; this is not a cold end-to-end timing comparison.
- Stronger full sample: task `c1b60b1a-d052-4290-b7e5-f114a5bd30b6`, the same normal BF16 GGUF/25-step graph with only style gain changed to 2.0, completed in 134.610 seconds. This is another warm run, not a controlled speed benchmark.
- Both full samples retained the earlier completion level, but the visible style change was small. An independent visual review of gain2 versus the unmodified control found no clear improvement in reference drawing technique, shadow colors or light separation. No broad reference-transfer quality claim or production promotion follows from these samples. The four accepted style baselines remain the regression targets.

These experiments isolate attention weighting from AI prompt generation. The historical accepted prompt is a control, not a new 30B analysis output. No result here demonstrates that 30B outperforms PE.
