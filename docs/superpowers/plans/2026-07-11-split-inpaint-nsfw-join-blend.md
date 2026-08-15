# Split Inpaint NSFW Join Blend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the pale join in Rapid NSFW local edit and smart completion without changing the proven model input or any non-NSFW route.

**Architecture:** Prepare a source-subject alpha guide through the standalone NSFW workflow module, then apply a mode-specific RGB join correction after generated-result RMBG. Local edit uses four pixels with linear falloff; smart completion scales from 16 to 32 pixels (`32px` at a `512px` crop) with a square-root falloff. Within the same safe join ring, generated alpha may only be raised toward the source-guide alpha so missing/semitransparent RMBG edge pixels cannot reveal the white source background. The pixel helper uses a bounded ROI distance transform rather than full-canvas queues. Keep the split Runtime limited to dependency injection, canvas conversion, route gating, and debug metadata.

**Tech Stack:** Browser JavaScript canvas Runtime, ComfyUI RMBG and Rapid AIO workflows, Node.js `node:test`, NovaFlow runtime sync/check scripts.

## Global Constraints

- The exact checkpoint remains `Qwen-Rapid-AIO-NSFW-v20.safetensors` with no fallback.
- Rapid model input, prompt, mask, V4 preprocessing, seed, sampler, and workflow graph remain unchanged.
- Only NSFW local edit and smart completion prepare and consume a source-subject guide.
- Normal edit, normal completion, and removal remain byte-for-byte isolated from the new dispatch.
- The join operation changes RGB only inside the original user mask and safe source-guide interior. Alpha may only be raised toward the guide inside that same safe ring; it is never lowered, and every mask-exterior byte remains unchanged.
- Source background-removal output is alpha guidance only and is never sent to Qwen.
- Runtime additions are glue and stay below 100 lines; business behavior belongs in the workflow/helper modules.
- Modify source Runtime only, then run `npm run sync:runtime`; never hand-edit renderer or win-unpacked Runtime mirrors.
- Append `logs/debug.log`, run all required checks, use `npm run auto-commit`, and finish clean.

---

### Task 1: Lock source-guide and join-blend behavior in RED tests

**Files:**

- Modify: `particle-editor-desktop/tests/split-inpaint-nsfw-workflow.test.js`
- Modify: `particle-editor-desktop/tests/split-inpaint-nsfw-pixels.test.js`
- Modify: `particle-editor-desktop/tests/split-inpaint-nsfw-runtime-contract.test.js`

**Interfaces:**

- Produces the required workflow APIs `prepareSourceGuide`, `assertPreparedSourceGuide`, and `resolveSubjectJoinPolicy`, plus pixel API `blendSubjectJoinRgb`.
- Fixes local edit at four pixels, smart completion at 16-32 pixels (`32px` at 512), and the source-guide alpha threshold at 128.

- [x] **Step 1: Add workflow RED tests**

Add tests that call `prepareSourceGuide` with transparent stats and assert the injected remover is not called, then call it with opaque stats and assert exactly one remover call. Reject missing/empty source data, missing remover for opaque input, and empty remover output.

- [x] **Step 2: Add pixel RED tests**

Create small RGBA fixtures that assert conservative join weights, one-pixel-eroded subject-guide gating, unchanged side/background pixels, unchanged mask exterior/holes, unchanged inputs, alpha-never-lowers behavior, and safe recovery of generated alpha holes. Add fixtures proving the resolved edit/completion policies and unchanged pixels beyond the completion ring.

- [x] **Step 3: Add Runtime RED contracts**

Assert the Rapid route prepares a source guide without replacing `qwenCrop.cropImage`, passes that guide to `mergeInpaintResult`, and calls the join helper only after `cleanRapidAioNsfwForeground`. Assert normal and removal slices contain no source-guide call.

- [x] **Step 4: Verify RED**

Run:

```powershell
node --test particle-editor-desktop/tests/split-inpaint-nsfw-workflow.test.js particle-editor-desktop/tests/split-inpaint-nsfw-pixels.test.js particle-editor-desktop/tests/split-inpaint-nsfw-runtime-contract.test.js
```

Expected: failures because `prepareSourceGuide`, `blendSubjectJoinRgb`, and Runtime guide dispatch do not exist.

### Task 2: Implement standalone workflow and pixel behavior

**Files:**

- Modify: `particle-editor/split-inpaint-nsfw.workflow.js`
- Modify: `particle-editor/split-inpaint-nsfw-pixels.helper.js`

**Interfaces:**

- `prepareSourceGuide({ sourceDataUrl, alphaStats, removeBackground }) -> Promise<{ dataUrl, backgroundRemoved }>`
- `blendSubjectJoinRgb({ generatedRgba, originalRgba, maskRgba, subjectGuideRgba, width, height, ringWidth, guideAlphaThreshold: 128, falloffExponent, restoreAlpha }) -> { pixels, changedPixels, joinPixels, alphaRaisedPixels }`

- [x] **Step 1: Implement `prepareSourceGuide`**

Analyze alpha at threshold 128. Reuse only a meaningful existing cutout with at least 16 visible pixels, at least one transparent pixel, and a non-rectangular visible shape within its own alpha bounding box (`bboxFillRatio <= 0.995`). This prevents a small valid subject from being rejected while ensuring an opaque white rectangle or transparent outer margin still runs background removal. Propagate errors and reject empty output.

- [x] **Step 2: Implement `blendSubjectJoinRgb`**

Find the mask bounding ROI, then build eight-neighbor/Chebyshev depth with a two-pass byte distance transform confined to that ROI. Erode `guideAlpha >= 128` by one pixel, then blend only pixels inside that safe guide interior and within `ringWidth` of the original user-mask edge. Use `pow((ringWidth - depth + 1) / (ringWidth + 1), falloffExponent)`, mask strength, and guide alpha as the RGB weight. Copy inputs. If Runtime cleared the RGB of a fully transparent generated pixel, restore from original RGB rather than transparent black. When `restoreAlpha` is enabled, alpha may only be raised toward guide alpha with the same weight; never lower alpha or change any mask-exterior pixel.

- [x] **Step 3: Verify GREEN**

Run focused workflow/pixel tests and `node --check` on both modules.

### Task 3: Add Rapid-only Runtime glue

**Files:**

- Modify: `particle-editor/spine-split-runtime.js`
- Modify: `particle-editor/index.html`
- Modify: `particle-editor-desktop/tests/split-inpaint-nsfw-runtime-contract.test.js`

**Interfaces:**

- `prepareRapidAioNsfwSourceGuide(sourceCropCanvas, joinPolicy)` returns a same-sized guide canvas plus preparation metadata.
- `blendRapidAioNsfwSubjectJoin(canvas, originalCrop, selectionMask, subjectGuide, joinPolicy)` mutates only the candidate canvas after helper success.

- [x] **Step 1: Prepare the guide under the Rapid route**

After model output returns and only inside the Rapid merge path, gather source-crop alpha stats, call the workflow module with `runRmbgCutout`, validate meaningful transparency, and keep `qwenCrop.cropImage` and every model input untouched.

- [x] **Step 2: Apply the join blend after generated RMBG cleanup**

In `mergeInpaintResult`, require the guide only for `rapid-aio-nsfw`, call `cleanRapidAioNsfwForeground`, resolve policy in the workflow module (`4px`, exponent `1` for edit; `16..32px`, exponent `0.5` for completion), then call the join helper before `fullCanvasWithLayerMask`. Pass normal/removal through existing code.

- [x] **Step 3: Add debug evidence and cache busting**

Record the source guide, join counts, and actual original-plus-generated composite preview. Increment the helper/workflow/Runtime cache query together in the source index; mirrors come only from sync.

- [x] **Step 4: Verify focused GREEN**

Run Runtime contracts and `node --check particle-editor/spine-split-runtime.js`.

### Task 4: Sync, live-validate, review, and commit

- [x] **Step 1: Sync and run automated gates**

```powershell
npm run sync:runtime
npm run check:runtime
npm run check:entry
node --test particle-editor-desktop/tests/*.test.js
node --check particle-editor/split-inpaint-nsfw.workflow.js
node --check particle-editor/split-inpaint-nsfw-pixels.helper.js
node --check particle-editor/spine-split-runtime.js
git diff --check
```

- [x] **Step 2: Run locked-4783 and captured-production-artifact acceptance**

Confirm the locked `4783` source/dist/served hashes and upstream health. Verify the exact checkpoint in the 28.43 GB model file, live `/object_info`, and successful real prompt history. Replay the captured failing Rapid/RMBG artifact through the final production helper and require `outsideMaskDiff=0`, no alpha lowering, original RGB for restored transparent-black pixels, and visual removal of the pale join. Browser automation does not support local file upload, so do not substitute a synthetic UI upload result for this evidence.

- [x] **Step 3: Review and record**

Run independent spec/quality review, fix all Critical/Important findings, append the required `logs/debug.log` entry, and rerun affected checks.

- [x] **Step 4: Auto-commit and prove clean**

```powershell
npm run auto-commit
git status --short
```

Expected: one `auto-save: YYYY-MM-DD HH:mm:ss` commit and no status entries.
