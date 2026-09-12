# GPT Image 2.5 local upgrade — 2026-09-11

NovaFlow's GPT image generation now selects `gpt-image-2.5-flare` for text-to-image and `gpt-image-2.5-sunburst` for image editing. Existing quality, size, reference limits, authentication and settlement paths remain in place. The renderer asset revision was updated to invalidate the old script cache.

## Comfy compatibility and installation

Comfy's official support was merged in [PR 16190](https://github.com/Comfy-Org/ComfyUI/pull/16190) and released in v0.35.0. This machine runs the customized Comfy 0.24.1 Runtime, so only the relevant GPT node additions were backported. The rest of the engine was retained.

- Installed node: `C:\ProgramData\NovaFlow\AI-Runtime\engine\ComfyUI\comfy_api_nodes\nodes_openai.py`
- Node SHA256: `6DFB69FD157B01477E43D658225D6EAE28A27CADCD0E2A9B002A0D0E80172EAF`
- The existing `comfy-partner-price-v1` patch was applied to a staging copy first. Its precise credit marker was also installed in `comfy_api_nodes/util/client.py` (SHA256 `F3C6B6D373E7C66563A253DEBFB2649E6540C07620437F9E9734728FFA2CECBC`).
- Original node and client files are backed up in `C:\ProgramData\NovaFlow\AI-Runtime\backups\gpt-image-25-20260911`.
- Reproducible, hash-guarded node backport: `tools/ai-runtime/patch-gpt-image-25.py`. It only writes a separate staged destination; it does not overwrite a live Runtime.
- GPT 2.5 prices use the reported text/image token split at the [official rates](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst). Missing or inconsistent usage does not produce a fabricated actual price.

This is a local installed-Runtime and current renderer upgrade. No new Windows installer or Runtime installer was built. A renderer-only release to another machine requires a compatible GPT 2.5 Runtime; an old engine will reject these model names. The existing Runtime packaging manifest remains hash-guarded for its older node revision, so a future Runtime release must explicitly integrate and audit this backport rather than bypassing that guard.

## Verification

- Authenticated Comfy proxy calls: Flare generated an image; Sunburst edited that image successfully.
- Live node discovery lists both 2.5 models plus the existing 2/1.5/1 options.
- The packaged workflow builder produced a linked Flare generation → Sunburst edit workflow. Prompt `409cf547-7e4f-48ed-b89a-30bbe9191fb9` completed successfully in approximately 26.1 seconds.
- Both images were saved and visually inspected. The requested blue-to-orange edit was present.
- Two exact cost events were observed: 1.26 and 3.00 Comfy credits. This verifies Runtime cost reporting; user-account settlement was covered by the existing contract tests, not a paid desktop user session.
- Provider workflow, pricing helper, credit-cost, image-provider and preload exact-settlement tests passed.
- `sync:runtime` and `check:runtime` passed.
- `check:entry` returned NO-GO: 4783 was unreachable, and the checker also reported incomplete AI-effects takeover integration. Direct 8188 health passed. Automatic approval review rejected starting the preview service with only `blocked by policy` as the reason; no page-level success is claimed.
- The first linked verification request was interrupted by a Runtime restart; its history and outputs were absent before the successful retry.

Local evidence: `tmp/gpt-image-25-verification/runtime-result.json`, `workflow.json`, `check-runtime.log`, and `check-entry.log`. No credentials are stored in these evidence files.
