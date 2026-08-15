# Resource Mentions And AI Sequence Input Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix AI-sequence playback/drop behavior and add inline resource-mention chips to Seedance and Art Generate img2img.

**Architecture:** A new resource-mention tool owns rich prompt editing and dialect compilation. `novaflow-brand-runtime.js` remains a dispatcher/compatibility layer that supplies resource snapshots and invokes the compiler before submission.

**Tech Stack:** Browser JavaScript, DOM/contenteditable, Electron Runtime compatibility code, ComfyUI workflow JSON, Node.js static contract scripts, locked `4783` browser verification.

## Global Constraints

- Stability > compatibility > performance > maintainability > new functionality.
- Do not modify frozen bundle or renderer/dist Runtime copies directly.
- Runtime additions must stay glue code and target approximately 100 lines; move business logic into the new tool.
- Do not change Storyboard, skeleton animation, split editor, or local AI-sequence Wan A/B.
- Preserve the existing document-capture drop mechanism and fix its slot identity mapping.
- Write a failing contract before each production behavior.
- Use the project-mandated final `npm run auto-commit`; do not create intermediate manual commits.
- Append `logs/debug.log`, run Runtime sync/checks, and finish with a clean working tree.

---

### Task 1: Add Failing Behavior Contracts

**Files:**
- Create: `scripts/check-ai-seq-prompt-action-autopause-contract.mjs`
- Create: `scripts/check-ai-seq-six-slot-drop-contract.mjs`
- Create: `scripts/check-resource-mention-contract.mjs`
- Create: `scripts/check-art-generate-resource-mention-contract.mjs`

**Interfaces:**
- Consumes: source Runtime, active bundle, index HTML, Smart AI source, and the future mention tool.
- Produces: focused RED evidence for all requested behavior.

- [ ] **Step 1: Write the playback contract**

Assert the Runtime contains a focused prompt-action click-capture bridge, requires a playing main preview, identifies the `title="暂停"` timeline button, dispatches pointer/mouse events, and does not prevent the original prompt action.

- [ ] **Step 2: Write the six-slot contract**

Assert the exact mapping exists:

```js
const kinds = [
  "ref_image",
  "jimeng_image2_ref",
  "jimeng_image3_ref",
  "jimeng_image4_ref",
  "jimeng_video_ref",
  "jimeng_audio_ref"
];
```

The contract must also require kind-based proxy owners and input `accept` validation.

- [ ] **Step 3: Write the mention-tool contract**

Load `resource-mention.tool.js` in a VM and assert:

```js
compileText({
  text: "让@参考图3中的人物移动",
  surface: "seedance",
  resources: seedanceResources
}).text === "让@Image 2中的人物移动";
```

Also assert invalid empty-slot tokens, video/audio compilation, Art Generate `图N` compilation, and readable-token protection/restore.

- [ ] **Step 4: Verify RED**

Run all four new scripts. Each must fail because the production bridges/tool do not exist yet, not because of syntax or fixture errors.

### Task 2: Implement Playback And Six-Slot Compatibility Bridges

**Files:**
- Create: `particle-editor/ai-sequence-input-compat.tool.js`
- Modify: `particle-editor/novaflow-brand-runtime.js`
- Modify: `particle-editor/index.html`
- Test: `scripts/check-ai-seq-prompt-action-autopause-contract.mjs`
- Test: `scripts/check-ai-seq-six-slot-drop-contract.mjs`

**Interfaces:**
- Produces: `pauseAiSequenceMainPreviewForPromptAction()` and exact raw-kind input resolution.
- Consumes: existing `getAiSequenceMainPreviewVideo()`, source-owned slot helpers, and the timeline playback button.

- [ ] **Step 1: Add the authoritative pause bridge**

Implement the pointer dispatch and six-slot routing in `ai-sequence-input-compat.tool.js`; keep only the document lifecycle binding and existing Runtime callbacks in `novaflow-brand-runtime.js`. Scope the click-capture handler to enabled `[data-novaflow-prompt-action-button="1"]` controls inside the AI-sequence workspace. When the main video is playing, find the visible enabled timeline button with `title="暂停"`, dispatch `pointerdown`, `mousedown`, `pointerup`, `mouseup`, and `click`, and allow the original click to continue.

- [ ] **Step 2: Add raw-kind slot metadata**

Map each source-owned slot to its own `data-ais-import` value. Use that raw value for native-input resolution and click-proxy ownership instead of normalized Chinese labels.

- [ ] **Step 3: Validate file types**

Before assigning `input.files`, reject files that do not match the target input's image/video/audio accept family.

- [ ] **Step 4: Verify GREEN**

Run both focused contracts and the existing `check-ai-seq-jimeng-r2v-4k.mjs` and `check-ai-seq-video-audio-contract.mjs` scripts.

### Task 3: Implement The Shared Resource Mention Tool

**Files:**
- Create: `particle-editor/resource-mention.tool.js`
- Create: `particle-editor/resource-mention.tool.css`
- Modify: `particle-editor/index.html`
- Test: `scripts/check-resource-mention-contract.mjs`

**Interfaces:**
- Produces: `window.NovaFlowResourceMentionTool` with `mountTextarea`, `refreshSurface`, `compileText`, `protectText`, and `restoreText`.
- Consumes: callbacks returning resource snapshots and a native textarea backing value.

- [ ] **Step 1: Implement the pure compiler first**

For Seedance, compact occupied image slots separately from video/audio slots. For Art Generate, compact occupied art reference slots. Return:

```js
{
  text: compiledText,
  mentions: [{ key, label, modelLabel }],
  invalidTokens: []
}
```

- [ ] **Step 2: Implement token protection**

Replace readable aliases with opaque placeholders before prompt optimization, retain an ordered token map, restore the aliases afterwards, and reject results with missing or duplicated placeholders.

- [ ] **Step 3: Implement the contenteditable mirror**

Create a scoped editor beside the backing textarea, render user text with `textContent`, render chips as `contenteditable="false"`, serialize edits back through the native textarea setter, and listen to backing `input/change` events for external writes.

- [ ] **Step 4: Implement candidate interaction**

Detect a caret-local `@` trigger, show only occupied resources, support click/ArrowUp/ArrowDown/Enter/Escape, replace the trigger with a chip, and keep the caret after the inserted chip.

- [ ] **Step 5: Implement invalidation and refresh**

`refreshSurface(surface)` must refresh preview/labels for replaced resources and apply an invalid style when a referenced slot is empty.

- [ ] **Step 6: Verify GREEN**

Run `node scripts/check-resource-mention-contract.mjs` and `node --check particle-editor/resource-mention.tool.js`.

### Task 4: Register The Seedance Adapter

**Files:**
- Modify: `particle-editor/novaflow-brand-runtime.js`
- Modify: `particle-editor/index.html`
- Test: `scripts/check-resource-mention-contract.mjs`

**Interfaces:**
- Consumes: the six `data-ais-import` slots and the positive Seedance textarea.
- Produces: occupied Seedance resource snapshots and compiled prompt text before `NFAiSeqPatchCloudWorkflowV2` uses it.

- [ ] **Step 1: Mount the editor**

Register only when the active route is Seedance reference mode. Snapshot four image slots plus video/audio slots from the current source-owned DOM.

- [ ] **Step 2: Compile before submission**

Call the mention compiler on the positive prompt before the Seedance workflow receives `model.prompt`. If `invalidTokens.length > 0`, stop generation and show a specific missing-resource error.

- [ ] **Step 3: Refresh after slot changes**

Reuse existing source-owned refresh scheduling to call `refreshSurface("seedance")`; do not add a global observer.

- [ ] **Step 4: Verify GREEN**

Run the mention, Jimeng R2V, frame-mode, and Prompt Action contracts.

### Task 5: Register The Art Generate Adapter And Prompt Protection

**Files:**
- Modify: `particle-editor/novaflow-brand-runtime.js`
- Modify: `particle-editor/novaflow-smart-ai.js`
- Test: `scripts/check-art-generate-resource-mention-contract.mjs`
- Test: `scripts/check-smart-ai-contract.mjs`

**Interfaces:**
- Consumes: `ART_GENERATE_STATE.references`, the Runtime-created positive textarea, and `syncArtWorkflowReferenceImages(...)` ordering.
- Produces: Art Generate resource snapshots, `图N` compiled prompt text, and protected Smart AI writes.

- [ ] **Step 1: Mount after prompt rendering**

After `renderArtGeneratePromptBox("prompt", ...)` creates the textarea, mount surface `art-generate`. The snapshot keys are `art_reference_1..3`.

- [ ] **Step 2: Compile once per run**

Compute the compiled prompt from the same filtered reference order used by `runArtGenerate()`, pass that text into positive Qwen/easy-prompt nodes, and leave `ART_GENERATE_STATE.prompt` serialized for history and editing.

- [ ] **Step 3: Preserve aliases through Prompt Optimize**

Protect aliases before both Art Generate and generic Smart AI optimization requests. Restore and validate before dispatching the native textarea update. A validation failure must leave the existing prompt untouched.

- [ ] **Step 4: Verify GREEN**

Run the Art mention contract, Smart AI contracts, and a VM workflow assertion covering ordinary and NSFW img2img templates with three references.

### Task 6: Publish, Verify, Review, And Archive

**Files:**
- Modify: `logs/debug.log`
- Modify: `scripts/sync-runtime.mjs`
- Modify: `scripts/check-runtime-sync.mjs`
- Generated by sync: `particle-editor-desktop/renderer/**`
- Generated by sync: `particle-editor-desktop/dist/win-unpacked/resources/app/**`

**Interfaces:**
- Produces: synchronized locked Runtime assets, live verification evidence, an independent code review, and one final auto-save commit.

- [ ] **Step 1: Append the debug record**

Record the playback-state gap, old three-label drop resolver, missing structured mention layer, implemented bridge/tool/adapters, and the two-entry impact scope.

- [ ] **Step 2: Run static and Runtime verification**

Run:

```powershell
npm run sync:runtime
npm run check:runtime
npm run check:entry
node --check particle-editor/novaflow-brand-runtime.js
node --check particle-editor/novaflow-smart-ai.js
node --check particle-editor/resource-mention.tool.js
node scripts/check-ai-seq-prompt-action-autopause-contract.mjs
node scripts/check-ai-seq-six-slot-drop-contract.mjs
node scripts/check-resource-mention-contract.mjs
node scripts/check-art-generate-resource-mention-contract.mjs
node scripts/check-ai-seq-jimeng-r2v-4k.mjs
node scripts/check-ai-seq-video-audio-contract.mjs
node scripts/check-smart-ai-contract.mjs
git diff --check
```

Expected: every command exits 0 and `check:entry` reports `Overall: GO`.

- [ ] **Step 3: Verify locked `4783` and live `8188`**

Exercise Seedance and Art Generate img2img with occupied, sparse, replaced, and removed references. Capture the actual `/prompt` workflow and verify prompt numbering matches `model.reference_*` or `image1..image3` connections. Verify Prompt Actions pause an actively playing main preview without suppressing the action.

- [ ] **Step 4: Request independent review**

Give a reviewer the approved design, focused diff, and verification results. Fix all Critical or Important findings and rerun their covering tests.

- [ ] **Step 5: Archive**

Run:

```powershell
npm run auto-commit
git status --short
```

Expected: an `auto-save: YYYY-MM-DD HH:mm:ss` commit and empty final status.
