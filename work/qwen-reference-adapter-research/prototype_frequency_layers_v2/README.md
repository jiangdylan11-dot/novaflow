# Qwen 2.1 style K frequency, inclusive layer window

Isolated self-authored research package. No installation into NovaFlow or the maintained ComfyUI, no trained weights, no global monkey patch. CPU protocol tests do not establish visual quality, style/content separation, GPU compatibility, latency or VRAM.

Only `NovaFlowQwen21StyleKeyLayerWindowExperimental` is registered by `__init__.py`. The old frequency node/source remains untouched. `frequency_core.py` and `layout.py` are self-contained copies of our own earlier helper code; `ORIGIN.json` records source hashes. See `NOTICE.md` and `LICENSE` for attribution and scope.

## Contract

- MODEL in/out, function `patch`; disabled returns the identical input object. All-one spatial scales (including a cap that makes them all one) also return the identical model before Comfy imports or model attribute access.
- Required inputs: `model`, `enabled=false`, `style_reference_index=1`, `high_scale=.5`, `low_scale=1.5`, `beta=2`, `layer_start=24`, `layer_end=31`, `audit_log=false`. Layer bounds are **inclusive, zero based**. Optional inherited controls: `cap_amplification=false`, `active_sigma_min=0` (all actual sigmas).
- Keep source/style order, prompt, negative, encoder, VAE, resolution, sampling sigmas and steps unchanged. Insert only on the isolated QA MODEL path after cache/model preparation and before the sampler. Index 1 means the actual second native VAE reference, not a prose image label.
- Exact native QwenImage21 classes only; head dimension128 and axes [16,56,56]. The model's actual number of blocks is inspected. Default24–31 covers the last8 of the current32-layer model. Small random CPU models explicitly use their own valid windows; that is not a claim that their layers have the same learned semantics.
- Every attention callback reads **its current** `kwargs['transformer_options']['block_index']`. Missing, None, boolean, noninteger, negative and out-of-range indices fail. If `total_blocks` is supplied, it must match the inspected count. No inference from call order or a stale forward-entry layer value.
- All actual layers must have `preferred_attention.function is None`. Native override dispatch discards the preferred backend before calling the override, so this guard applies even at sigma cutoff0 and to unselected layers. No preferred function is executed or overwritten by preflight.
- Old/new frequency-wrapper stacking is rejected. Existing ordinary callable `optimized_attention_override` is composed once. It receives the same native function, kwargs, Q, V and mask, plus changed K only in selected target calls. An arbitrary previous override that ignores or replaces its input can defeat this experiment; no universal plugin compatibility claim is made.

## Exact operation and cache

For target queries attending the full prefix+target key sequence, only selected layers clone K and scale the actual style-reference spatial channels with the inherited pair vector. Axis0's first16 channels, Q, other references/text/target K, V and mask are unchanged. The two channels of each spatial RoPE pair receive equal scale. This changes post-RoPE K amplitude, not image pixels or RoPE angles.

Prefix calls and unselected target layers pass the original Q/K/V/mask objects to the previous override or native function; they allocate no modified K. An active native forward must reach each selected target layer exactly once, otherwise it fails explicitly rather than reporting a silent no-op. `audit_log` records per-forward layer counts, copied-K count, actual sigma, spans and backend guard.

The package does not add `attn1_patch`, `post_input`, `single_block` or block replacement hooks. Native prefix-cache eligibility remains intact; cached K/V are not mutated. A sigma-inactive forward uses the original `transformer_options` object without installing a new override. CPU cached/uncached comparisons exercise native branches; real GPU cache residency and speed still require a separate root-owned test.

Layer restriction reduces the number of full K copies, not necessarily peak allocation or total wall time. It does not prove last layers control texture, preserve color or avoid donor-content copying. The prior all-layer frequency/color trade-off remains an unresolved quality risk.

## CPU check

From the repository root:

```powershell
& C:/ProgramData/NovaFlow/AI-Runtime/engine/python/python.exe work/qwen-reference-adapter-research/prototype_frequency_layers_v2/test_frequency_layers.py
```

The script sets CUDA invisible before Torch import, forces installed Comfy CPU mode, creates only small random native models, and writes `cpu-test-results.json`. It covers real32-layer default-window traversal, three-layer native prefix-cache branches, the same actual-index dictionary changing across calls, invalid metadata, exact identity/bypass, original cache immutability, BF16/flat/reshaped tensors, previous overrides, preferred-backend guard and duplicate wrapper rejection. The old source hashes must remain unchanged. No generation model, image encoder or VAE weights are loaded.
