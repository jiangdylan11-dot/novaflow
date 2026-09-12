# Art Generate Qwen LoRA support

The left model panel uses the video section interaction: one 添加兼容 LoRA dropdown immediately adds a compact filename card, a strength label (default 1.00), a 0–2 slider, and a red × remove button. There are no blank entries, enable checkboxes, per-card dropdowns, numeric fields, or permanent refresh buttons. Duplicate additions are omitted from the dropdown. The catalog refreshes when changing provider/mode/NSFW context; an unsuccessful load offers a retry.

The native Electron IPC and locked-preview bridge share `main/qwen-lora-catalog.js`. The catalog only accepts Runtime-registered paths rooted at the exact `E:\NovaFlow\models\loras\qwen` directory, including child folders. It excludes traversal, junction escape, managed acceleration adapters, corrupt/partial safetensors, unsupported tensors, missing pairs, and mismatched dimensions. Both A/B and down/up plus scalar alpha conventions are checked against the actual Edit-2511 or Rapid v20 base header using Runtime's Qwen key mappings. Training metadata labels are not used as compatibility evidence. All 16 files currently in the requested folder pass both base-model structure checks; structural compatibility does not establish visual quality.

Selections survive supported mode changes when still compatible; a successful refreshed catalog removes unavailable/incompatible entries. Unsupported providers hide and do not apply selections. Before submission the same disk/header check is repeated, in addition to checking Runtime availability.

Selected adapters are inserted immediately after the Qwen model loader. Only its MODEL output is rewired; CLIP/VAE ports and existing sampling/Lightning nodes retain their behavior. Duplicate selections and invalid weights are rejected. Before submission, the workflow is checked against the current Runtime file list; missing files produce an error instead of a silent fallback. Controls are disabled while generation runs.

Implementation: `particle-editor/art-generate-lora.js`, integrated in `novaflow-brand-runtime.js`, registered in index/build/sync/check manifests. The generic expanded-panel slider layout skips only the owned LoRA subtree, preserving the containing panel width normalization. Existing unrelated worktree changes were retained.

## Validation

- 45 focused tests passed, including real workflow templates, MODEL connection rewiring, original CLIP/VAE inputs, existing accelerator preservation, unsupported providers, missing files, duplicate/invalid entries, dropdown-add/slider synchronization, and running-state controls.
- Actual locked 4783 browser interactions verified adding, selecting, changing weight, multiple entries, duplicate-option removal, removing, and retaining/hiding selections across routes.
- Final 1280 x 720 browser inspection after mode switches: LoRA panel width 218 px, no horizontal overflow, filename, strength slider, and remove button match the video cards. Mode switches retain a 218 px panel, zero horizontal scroll, and no clipping.
- The earlier workflow acceptance run completed these three real submissions on 8188. This UI/catalog revision retains the same insertion chain; it was verified with the focused contracts and live UI/catalog checks, without repeating these generation runs:

| Route | Adapter / weight | Prompt ID | Result |
| --- | --- | --- | --- |
| NSFW text-to-image / Rapid AIO v20 | HQL0.2 / 0.35 | `187a4aa6-d467-434d-ba9c-5b8abfc2c138` | success |
| NSFW image-to-image / Rapid AIO v20 | Qwen4Play2512_v2 / 0.35 | `524fb3f9-df85-4adb-9c61-8bbb3722e0fb` | success |
| Standard image-to-image / Edit-2511 BF16 | HLora_v0.1 / 0.35, existing Lightning retained | `16204e88-5e9f-40fc-975d-ab33b6872131` | success |

Compact history evidence is in `art-lora-live-2026-09-12.json`. These smoke tests verify loading and execution; they are not a visual-quality comparison of the adapters. The additional adapters were structurally checked against both actual base files, without individual visual-quality trials.

Windows packaging uses the existing 2.3.214 version without a version bump. No installer was applied to Program Files as part of this change.

Final revised package: `particle-editor-desktop/dist/NovaFlow Setup 2.3.214.exe`, 249,834,562 bytes, ProductVersion 2.3.214. Build succeeded; signing was skipped because no signing identity was configured.
SHA256: `316EA7D73695D31E36586CA471348D73DA599F6D253B63525EB128B5C9443FD1`.
Post-package `check:runtime`: PASS. `check:entry`: Overall GO, including locked 4783 health and direct 8188. Live 4783 catalog: 16 items, zero paths outside qwen.
