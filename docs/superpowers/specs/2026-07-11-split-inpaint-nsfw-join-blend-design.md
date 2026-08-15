# Split Inpaint NSFW Join Blend Design

## Status

Implemented and independently verified on 2026-07-12 after the direct pre-background-removal input design failed controlled Rapid AIO tests.

## Requirement

When the default-off NSFW switch is enabled, local edit and smart completion must continue using `Qwen-Rapid-AIO-NSFW-v20.safetensors`, but the generated patch must join the existing subject without a pale or white seam. Normal edit, normal completion, and removal must remain unchanged.

## Rejected Input Design

Directly feeding a background-removed source into Rapid AIO is not safe:

- Prompt `273a950b-9f52-4b36-be8e-c72376543006` generated a checkerboard instead of legs.
- Prompt `2e95eba3-eb77-4f3a-8835-26391183b56f` removed the checkerboard wording but produced structural drift, cropped feet, and strong halos.
- The V4 input builders flatten the model input to opaque RGB, ComfyUI `LoadImage` converts the image input to RGB, and `TextEncodeQwenImageEditPlus` consumes RGB channels. Source alpha therefore does not reach the model as transparency conditioning.

The existing Rapid model input, prompt, mask, sampler, seed behavior, and workflow graph must not change.

## Architecture

Use source background removal only to obtain a subject-alpha guide. Never feed that guide or its RGB into Qwen. After the existing generated-result RMBG and white-matte cleanup, correct generated RGB and raise missing generated alpha only in the safe inner overlap where the user selection intersects the existing source subject.

Business decisions remain outside the Runtime:

- `split-inpaint-nsfw.workflow.js` decides whether existing source alpha is usable or an injected background-removal operation is required.
- `split-inpaint-nsfw-pixels.helper.js` performs a pure, testable RGBA join blend.
- `spine-split-runtime.js` only gathers canvases, dispatches the workflow/helper calls, propagates errors, and records debug evidence.

## Data Flow

1. Keep the existing original source crop and V4 model input unchanged.
2. For Rapid NSFW only, inspect the unchanged source-crop alpha after model output returns.
3. At alpha threshold `128`, reuse the source only when it has at least 16 visible pixels, transparent pixels, and a non-rectangular alpha silhouette (`visible / alphaBBoxArea <= 0.995`). A transparent margin around an opaque rectangular image is not a cutout. Otherwise run the existing RMBG workflow and use only its alpha as the subject guide.
4. Run the existing Rapid AIO workflow without prompt, image, mask, or sampler changes.
5. Run the existing generated-result RMBG and `removeWhiteMatteRgb` cleanup.
6. Erode the source guide by one pixel so its silhouette/background can never drive matching. Inside both the original user mask and this safe subject interior, blend generated RGB toward original RGB. When Runtime has cleared RGB for a fully transparent generated pixel (`alpha <= 1`), use original RGB as the restoration base instead of interpolating from transparent black. When generated RMBG left missing or semi-transparent pixels, raise alpha toward the guide alpha; never lower alpha.
7. Use a four-pixel linear ring for local edit. Smart completion scales from 16 to 32 pixels (`32px` at `512px`) and uses a `0.5` falloff exponent because the captured Rapid failure extends roughly 31 pixels into the mask.
8. Preserve every byte outside the user mask and safe source-subject ring. Preserve all alpha outside that ring and never lower alpha inside it.
9. Compute mask depth with a mask-bounding ROI and capped two-pass eight-neighbor distance transform, then continue through the existing generated-layer and original-mask merge.

## Interfaces

`NovaFlowSplitInpaintNsfwWorkflow.prepareSourceGuide(options)` consumes:

- `sourceDataUrl: string`
- `alphaStats: { alphaThreshold: 128, total, visible, transparent, bboxWidth, bboxHeight }`
- `removeBackground(dataUrl): Promise<string>` when the existing source alpha cannot be reused as a valid subject silhouette

It returns `{ dataUrl, backgroundRemoved }` and never silently falls back after removal failure. `assertPreparedSourceGuide(alphaStats)` validates the final guide. `resolveSubjectJoinPolicy(mode, shortEdge)` owns ring width, threshold, falloff, and safe alpha restoration.

`NovaFlowSplitInpaintNsfwPixels.blendSubjectJoinRgb(options)` consumes generated, original, selection-mask, and subject-guide RGBA arrays, width/height, `ringWidth` (`2..32`), `guideAlphaThreshold`, `falloffExponent`, and `restoreAlpha`. It uses an ROI distance transform and returns a copied RGBA array plus changed/join/alpha-raised counts.

## Error Handling

- Missing workflow/helper APIs: fail with a refresh-required error.
- Source guide without a reusable subject silhouette and unavailable or failed RMBG: stop the edit and preserve retry state.
- Invalid or non-transparent RMBG guide: stop; never use the opaque source as a fake guide.
- Invalid or mismatched RGBA buffers: throw before changing a canvas.
- No qualifying subject join: return the generated pixels unchanged.
- Alpha is raised only toward the validated guide in the safe ring; it is never lowered and never restored from the opaque source image itself.

## Compatibility

- Only `route.workflow === 'rapid-aio-nsfw'` prepares or consumes a subject guide.
- OFF edit/completion keep their existing workflows and post-processing.
- Removal never prepares or consumes a subject guide.
- The source layer, source RGB, source alpha, user mask, model input, and all input arrays are never mutated. The returned generated alpha may only increase in the Rapid safe join ring.
- No cache, persisted state, provider fallback, or new Runtime model dependency is added.

## Verification

- TDD unit tests cover the four-pixel edit policy and thirty-two-pixel completion endpoint, eight-neighbor mask depth, ROI-bounded work allocation, source-subject gating, outer-background skip, internal mask/guide holes, threshold `127/128`, alpha-only-raises restoration, input immutability, malformed buffers, and white/black/checkerboard compositing.
- Workflow tests cover irregular transparent-source reuse, opaque and transparent-margin rectangle RMBG dispatch, small white-subject acceptance, exact mode policy, and fail-closed errors.
- Runtime contracts cover route isolation, unchanged V4 model input, guide preparation before merge, and helper invocation after generated-result cleanup.
- The captured real Rapid completion artifacts must pass the production helper with `outsideMaskDiff=0`, no alpha lowering, and a visibly removed pale join. Locked `4783` local edit and completion remain the final desktop acceptance surface.
