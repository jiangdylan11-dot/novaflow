# H3 INT8-only retirement

The low-VRAM switch and W4A8 checkpoint were removed at the user's request. All four H3 modes now use `Minimax_H3/10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors`. The INT8 model, shared text encoder, VAEs, user LoRA support, automatic SageAttention, and generation controls remain.

Saved requests with the old `beta5_fp8` profile ID resolve to INT8. On the first load, version-3 settings saved while W4A8 was selected carry their generation controls into INT8; persistence then removes the retired selection and settings. Older workflow graphs with the wrong checkpoint fail validation.

## Model deletion

The exact deleted path, file size, and measured free-space increase are in `deletion.json`. The file was 13,997,668,774 bytes (about 14.00 GB / 13.04 GiB). H3 had no running process when deletion occurred. The retained INT8 file was checked before deletion.

## Verification

- 17 focused tests passed, including saved-setting migration, stale requests, LoRAs, SageAttention, and all four H3 modes.
- The returned INT8 generation graphs for text, image, first/last-frame, and multi-reference inputs were identical to those before this change.
- Workflow and active UI bundle syntax checks passed. The active bundle contains no low-VRAM switch or W4A8 selection state.
- `sync:runtime` and `check:runtime` passed.
- Live H3 `/object_info/UNETLoader` confirmed W4A8 absent and INT8 present after deletion; see `runtime-postcheck.json`.
- `check:entry` remains NO-GO: the locked 4783 preview is unreachable, and the existing AI-effects takeover checks are incomplete. Direct 8188 responded. No generation or visual-quality benchmark was run.

## Delivery

Windows denied a direct write to the Program Files installation; its UI was not updated in place. Use the newly built `particle-editor-desktop/dist/NovaFlow Setup 2.3.214.exe` to update the installed application. Restarting the old installation alone does not install this change.

The installer build completed without changing the version. `package.json` records its size and SHA-256, plus matching source/renderer/packaged hashes for the workflow, active UI bundle, and HTML. The packaged bundle has no low-VRAM switch or retired profile state, and the packaged workflow has no deleted checkpoint path. `check:runtime` passed again after packaging.
