# Split Removal RGB Composite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `去除物体` consume the correct Removal RGB output without a second RMBG pass while preserving the current replacement-layer and source-hide behavior.

**Architecture:** Keep the existing Removal V4 workflow and dispatch unchanged. Replace only the post-processing body of `mergeRemovalInpaintResult()` with the already-present `compositeRemovalRgbResult()` path, then build the same replacement layer. Add a focused source contract before production changes, sync from the authoritative Runtime, and validate on locked `4783`.

**Tech Stack:** Browser JavaScript Canvas Runtime, ComfyUI Removal V4, Node.js source contracts, NovaFlow runtime sync/check scripts, PowerShell on Windows.

## Global Constraints

- Modify only the `repair` / Removal result post-processing path.
- Keep `resolveInpaintWorkflowRoute('repair')`, Removal V4 workflow nodes, models, prompt, seed, sampler, and mask polarity unchanged.
- Keep `replacementForPartId: part.id`, source hiding, active-layer selection, preview refresh, split-set sync, and temporary cache behavior unchanged.
- `mergeRemovalInpaintResult()` must not call `runRmbgCutout()` or `qwenRgbWithRmbgAlpha()`.
- `mergeInpaintResult()` for Completion/Edit must retain its current generated-foreground behavior.
- Reuse `compositeRemovalRgbResult()` and its current hard-mask gate plus `8px` feather; do not retune edges in this fix.
- Modify source Runtime only; renderer and win-unpacked Runtime mirrors come only from `npm run sync:runtime`.
- Append `logs/debug.log`, run required checks, use one final `npm run auto-commit`, and finish with a clean working tree.
- Subagents must not commit; the root agent owns the mandatory final auto-commit.

---

### Task 1: Lock the Removal post-processing contract in RED

**Files:**

- Create: `scripts/check-split-removal-result-contract.mjs`
- Modify: `package.json:14-18`

**Interfaces:**

- Produces the command `npm run check:split-removal`.
- Reads `particle-editor/spine-split-runtime.js` without changing runtime state.

- [ ] **Step 1: Add the source contract**

Create a Node ESM script that reads the authoritative Runtime, slices `mergeRemovalInpaintResult()` through the following `executeInpaintTool()` declaration, and asserts:

```js
assert.match(removalBody, /compositeRemovalRgbResult\s*\(/)
assert.doesNotMatch(removalBody, /runRmbgCutout\s*\(/)
assert.doesNotMatch(removalBody, /qwenRgbWithRmbgAlpha\s*\(/)
assert.match(removalBody, /replacementForPartId\s*:\s*part\.id/)
assert.match(removalBody, /clearedPixels\s*:\s*0/)
```

Also slice `mergeInpaintResult()` through `compositeRemovalRgbResult()` and assert it still contains `runRmbgCutout(resultCropCanvas.toDataURL('image/png'))`, proving the contract is route-specific. Assert the RGB helper keeps the hard-mask exterior `continue`, reads `result.data[ci]`, and writes alpha through `Math.max(originalAlpha, ...)`.

- [ ] **Step 2: Add the package command**

Add exactly:

```json
"check:split-removal": "node scripts/check-split-removal-result-contract.mjs"
```

- [ ] **Step 3: Verify RED**

Run:

```powershell
npm run check:split-removal
```

Expected: FAIL because the current Removal body does not call `compositeRemovalRgbResult()` and still calls `runRmbgCutout()`.

### Task 2: Restore direct RGB replacement composition

**Files:**

- Modify: `particle-editor/spine-split-runtime.js:29037-29096`
- Modify: `logs/debug.log`

**Interfaces:**

- Consumes `compositeRemovalRgbResult(layerOriginalCanvas, resultCropCanvas, crop.cropMask, crop.cropBox)`.
- Produces the existing replacement part with `replacementForPartId: part.id`, `clearedPixels: 0`, and RGB-composite statistics.

- [ ] **Step 1: Replace the Removal-only RMBG block**

After decoding `resultCropCanvas`, call:

```js
const finalCanvas = compositeRemovalRgbResult(layerOriginalCanvas, resultCropCanvas, crop.cropMask, crop.cropBox)
const removalStats = finalCanvas.__removalCompositeStats || {}
const changedOutsideMask = countUnmaskedPixelChanges(layerOriginalCanvas, finalCanvas, fullMaskCanvas, 8)
```

Build the same `*_removal` replacement layer from `finalCanvas`. Return `replacementForPartId: part.id`, set `replacedPixels` and `compositedPixels` from `removalStats.compositedPixels || 0`, set `featherPixels` from `removalStats.featherPixels || 0`, and set `clearedPixels: 0`.

- [ ] **Step 2: Update debug evidence**

Record `04_removal_result_crop`, `05_removal_rgb_used`, `06_removal_soft_merge_mask`, and `07_replacement_layer_preview`. Set debug metadata to:

```js
postprocess: 'removal-rgb-mask-composite-no-rmbg'
```

- [ ] **Step 3: Append the mandatory Debug Log entry**

Append one timestamped entry stating that the Removal RGB was correct, the second RMBG converted background pixels to transparent alpha, direct RGB mask composition is restored, and the scope is only `去除物体` result post-processing.

- [ ] **Step 4: Verify GREEN before sync**

Run:

```powershell
npm run check:split-removal
node --check particle-editor/spine-split-runtime.js
git diff --check
```

Expected: all pass.

### Task 3: Sync and validate the locked runtime surface

**Files:**

- Generated: `particle-editor-desktop/renderer/spine-split-runtime.js`
- Generated: `particle-editor-desktop/dist/win-unpacked/resources/app/renderer/spine-split-runtime.js`

**Interfaces:**

- Consumes the source Runtime from Task 2.
- Produces identical source/renderer/dist/served Runtime bytes.

- [ ] **Step 1: Sync source Runtime**

Run:

```powershell
npm run sync:runtime
```

- [ ] **Step 2: Run automated gates**

Run:

```powershell
npm run check:split-removal
npm run check:runtime
npm run check:entry
node --check particle-editor/spine-split-runtime.js
git diff --check
```

Expected: all pass and source/renderer/dist/served `spine-split-runtime.js` hashes match.

- [ ] **Step 3: Run focused locked-4783 acceptance**

Use one local Removal run on the same class of input and verify:

- the masked object is replaced by generated background;
- the result contains no transparent/black hole in the mask;
- the source layer is hidden only after the replacement layer commits;
- `/history` shows the Removal prompt but no immediately-following RMBG prompt for that result;
- Completion/Edit code paths remain unchanged.

### Task 4: Review, final verification, and archive

**Files:**

- Review every file changed since baseline commit `aac56ec1`.

**Interfaces:**

- Produces a reviewed, committed, clean NovaFlow checkout.

- [ ] **Step 1: Run independent spec and quality review**

Require separate verdicts for spec compliance and code quality. Fix every Critical or Important issue, then rerun the focused contract and syntax check.

- [ ] **Step 2: Run final mandatory checks**

```powershell
npm run check:split-removal
npm run check:runtime
npm run check:entry
npm run phase0:check
node --check particle-editor/spine-split-runtime.js
git diff --check
```

- [ ] **Step 3: Auto-commit and prove clean**

```powershell
npm run auto-commit
git status
```

Expected: one `auto-save: YYYY-MM-DD HH:mm:ss` commit and `nothing to commit, working tree clean`.

