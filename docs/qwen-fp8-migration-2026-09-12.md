# Qwen Edit 2511 FP8 migration

Normal local image editing and local UI generation/refinement now use `qwen_image_edit_2511_fp8mixed.safetensors`. The native LoRA catalog reads the actual base header from `E:\NovaFlow\models\unet` and continues checking all adapter pairs, including quantized-base weight shapes. Existing Rapid AIO NSFW routes are unchanged.

Removed the BF16 base fallback from outpainting, object transfer, ordinary storyboard generation and local AI effects model selection. Angle adjustment and Edit V5 already required FP8 mixed. The separate Lightning LoRA containing `bf16` in its filename is still required and is intentionally retained; it is not the retired 40.86 GB base model.

No remaining runtime source references target `qwen_image_edit_2511_bf16.safetensors`. Renderer cache revisions were updated for the Art runtime, UI builder, image editing tools and AI effects builder. Sampling presets, reference conditioning and output processing retain their existing behavior.

## Verification

- 66 focused tests passed for Art routing, UI generation and refinement, catalog validation against an FP8 tensor fixture, LoRA chaining and unchanged Rapid routes.
- `check-aifx-local-generate-contract.mjs`: PASS.
- Locked 4783 served the migrated Art workflow; its source contains FP8 mixed and no retired BF16 base reference.
- Real neutral 512 x 512 fixture runs use the actual Art template and UI builder. The Art run retains its preset and loads HQL at 0.35 plus the existing Lightning adapter. The UI run uses the 40-step quality preset without Lightning. Primitive/switch controls are resolved and unreachable nodes are removed before submission, as in production graph preparation. These are execution/visual-integrity checks, not an A/B quality benchmark against BF16.
- Live evidence: `qwen-fp8-migration-live-2026-09-12.json`.

The BF16 base file remains on disk during rollout so the already-running desktop session can continue using its previously loaded workflow. Direct installed-module rollout was denied by Windows filesystem permissions. All six installed files were rechecked and remain identical to their original backup hashes. The migrated installer must be installed with administrator authorization before the desktop app switches models; restarting the old installation alone does not apply this change. No model weights, user projects or running generation jobs are deleted by this migration.


## Results and rollout

- Art + HQL 0.35 + Lightning: prompt `027e5161-1524-4058-b3a8-2e1cc5f2bd61`, success, 4 steps, 46.2 s.
- UI quality: prompt `bc9707f5-2c97-4a6b-aa19-902cbe9d3a93`, success, 40 steps, 432.1 s. Both histories confirm FP8 mixed with `weight_dtype=default`. These timings are for a 512 x 512 fixture on this machine and are not a BF16 speed comparison.
- Both returned PNGs were inspected: complete images with the expected blue header, gold circle and teal button; no black/invalid output. Quality parity with BF16 has not been benchmarked.
- Post-build `check:runtime`: PASS. `check:entry`: Overall GO, including 4783 and 8188 health.
- Installer: `particle-editor-desktop/dist/NovaFlow Setup 2.3.214.exe`, 249,830,561 bytes, unsigned.
- SHA256: `F66A5B891D05E7530DB6B1DE93C77CC55A41A7DEBE1336AEB10150678086AFF4`.
- Original installed modules backed up to `.tmp-qwen-fp8-installed-backup-20260912`, with a hash manifest. Installation is pending administrator authorization. The 40.86 GB BF16 base remains available for the existing installed version.
