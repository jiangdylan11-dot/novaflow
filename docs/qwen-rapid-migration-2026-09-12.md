# Qwen Rapid migration

Scope: replace ordinary Qwen Image Edit 2511 in local image editing, UI generation/refinement, selection editing/completion, storyboard images, outpainting, object transfer, angle adjustment and AI effects. Ordinary local txt2img still uses Ideogram when its NSFW switch is off. Other model families (layered splitting, removal, video and shared encoders/VAEs) are unchanged.

## Implementation

- Existing Rapid image/UI/inpaint/storyboard routes now handle legacy ordinary settings. An old `nsfw: false` value cannot reintroduce an ordinary 2511 workflow through these production entry points.
- Outpainting, object transfer and angle adjustment load MODEL/CLIP/VAE from one `CheckpointLoaderSimple`. Ordinary Lightning, AuraFlow and CFGNorm wrappers are removed. Angle adjustment retains its separate multiple-angle LoRA.
- Those three native builders produce the same expanded graph as the Rapid comparison candidates (node IDs, random seeds and output prefixes excluded from comparison). Their production presets are six steps, CFG 1, Euler ancestral / beta.
- AIFX uses the same checkpoint and six-step preset while retaining ControlNet Union, conditioning averages, timestep windows, peak identity inputs and tail topology conditioning. Its model cache key now identifies Rapid.
- The Qwen LoRA catalog checks the actual Rapid base tensor shapes for both old and NSFW contexts and remains restricted to `E:\NovaFlow\models\loras\qwen`.
- UI builders also detect the actual Rapid checkpoint when called independently of the central bridge. Legacy synthetic UNET fixtures remain supported by the UI helper; they are not production model selections.
- Fixed-model editing surfaces show Rapid instead of exposing a switch that could select a removed base. Ordinary txt2img's NSFW switch retains its existing function.

## Evidence and limits

- 68 focused tests pass. They cover actual builders, reference wiring, checkpoint output ports, absent ordinary loaders, stale settings, LoRA validation, UI contracts and unchanged Ideogram/removal routing.
- `npm run check:aifx` passes. Its deliberately weak morphology fixtures emit their expected warning reports; that suite is not a blanket artistic-quality approval.
- Seventeen real ComfyUI prompts completed successfully. Histories and IDs are in `qwen-rapid-comparison-live-2026-09-12.json` and `qwen-rapid-acceptance-live-2026-09-12.json`.
- Initial rectangle-only transfer input produced poor placement for both models. A second test used the application's actual subject-silhouette guide and actual `objectTransferProtectedResultDataUrl` compositor. Rapid preserved the red chair in the selected location; ordinary 2511 shifted it blue. Both final outputs had zero changes outside the protected placement region.
- Outpaint output was checked after actual original-region restoration: 237,568 original pixels copied exactly, 24,576 edge pixels blended with the same 24 px feather used by the application.
- Angle outputs preserve the red chair and comparable requested camera direction. Model outputs are not pixel-identical.
- The first full-image small-chair inpaint prompt did not visibly add the chair. Actual local-crop fixtures subsequently confirmed roof recoloring and filling a gray roof gap. This does not establish universal prompt adherence.
- AIFX full-sheet and staged tail paths execute with ControlNet. The tail fixture produced a checkerboard background despite a black-background instruction; this remains a quality limitation, not a claim of final VFX/alpha or animation acceptance. The prior AIFX redesign need remains.
- Source, renderer and packaged runtime synchronization passes. Locked 4783 entry check: **Overall GO**; upstream 8188 also responds.

Visual comparison: [local comparison page](qwen-rapid-comparison/index.html).

## Release and retirement

- Installer: `particle-editor-desktop/dist/NovaFlow Setup 2.3.214.exe` (no version bump), 250,099,068 bytes.
- SHA256: `14F76201FB0E99058978A4A8452C57C82DFFF28AF7EA5415D75EF2D2C58B3670`.
- `qwen-rapid-install-manifest-2026-09-12.json` records hashes of the twelve installed modules/index/package files that must match the validated build before cleanup.
- `tools/install-rapid-and-retire-2511.ps1` performs the administrator installer launch and verifies those files before any model retirement. It refuses a busy runtime, unexpected model sizes, directories and reparse-point targets.
- Only the explicitly named ordinary BF16 and FP8 mixed base files are eligible for removal (61,394,794,377 bytes total). Rapid, LoRAs (including the angle LoRA with `2511` in its name), ControlNet and shared components remain.
- Installation/retirement completion is recorded separately in `qwen-rapid-retired-models-2026-09-12.json` when the operating-system installation succeeds. An installer launch alone is not proof of completion.

### Deployment outcome

The Windows administrator launch was canceled (`操作已被用户取消`). No installer process completed. The installed Program Files version still references ordinary 2511 and was not updated. Both named base weights were rechecked and remain at their original sizes; zero bytes were removed. Do not retry the administrator action without a new user request. Deployment status is recorded in `qwen-rapid-deployment-status-2026-09-12.json`.
