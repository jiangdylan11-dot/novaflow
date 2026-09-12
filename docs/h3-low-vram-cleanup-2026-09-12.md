# H3 beta5 low-VRAM control and original-model cleanup

## Behavior

- Removed the H3 version selector and classic profile from the active workflow.
- Standard mode uses beta5 TURBO INT8. The new `低显存` switch follows the random-seed switch; enabling it selects beta5 TURBO W4A8.
- Existing pre-migration model selection resets once to INT8/off (`uiVersion: 3`). Later switch choices persist.
- Switching changes only the checkpoint selection, preserving resolution, duration, FPS, steps, prompts, and references.
- Default sampling remains 4 steps. SageAttention remains automatic. No separate Turbo LoRA is loaded.
- Both models retain text-to-video, image-to-video, first/last-frame, and multi-reference routes.

## Actual cleanup

The H3 queue was empty before deletion. The following original-only weights were deleted from `E:\NovaFlow\models`:

| File | Bytes |
| --- | ---: |
| diffusion_models/Minimax_H3/minimax_h3_fl2va_pruned_int8_convrot.safetensors | 20,970,379,616 |
| diffusion_models/Minimax_H3/minimax_h3_ref2va_pruned_int8_convrot.safetensors | 20,970,379,616 |
| loras/minimax_h3/minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors | 1,956,171,984 |

Total: 43,896,931,216 bytes, about 43.9 GB (40.9 GiB). Exact paths are in `h3-original-deletion-manifest-2026-09-12.json`. All three files were confirmed absent after deletion.

The two beta5 TURBO checkpoints remain. Shared H3 core nodes, `AI-Runtime-H3/custom_nodes/novaflow_h3_attention`, text encoder, audio/video VAEs, and six user LoRAs remain. No classic-only node directory was found; deleting the shared nodes would break beta5. Earlier non-TURBO beta5 files were outside this original-profile cleanup scope and were retained.

## Validation and delivery

- 23 focused workflow/profile/surface/switch tests passed. Two unrelated broad surface/cache assertions were excluded; this is not a claim that the entire repository suite passed.
- JavaScript syntax checks passed.
- `sync:runtime` and `check:runtime` passed.
- Live H3 port 8189 `/object_info` lists both beta5 checkpoints, `NovaFlowH3SageAttention`, and `MiniMaxH3ReferenceToVideo`; the two deleted original checkpoints no longer appear.
- `check:entry` returned NO-GO because the locked port 4783 preview was unreachable. Direct port 8188 probe succeeded. No browser visual acceptance or generation benchmark is claimed.
- No video generation was submitted, following the user's instruction to test personally.
- Installer build uses isolated `particle-editor-desktop/dist/h3-low-vram-update`, retaining version 2.3.214. The formal Program Files installation must be updated with the resulting installer; source/mirror changes do not update an already running installed application.
- Build completed. Final installer: `particle-editor-desktop/dist/NovaFlow Setup 2.3.214.exe` (249,825,343 bytes). Packaged H3 workflow, UI bundle, HTML, and IME resource hashes match the source exactly; the old selector and original checkpoint paths are absent from the active packaged workflow/UI.
