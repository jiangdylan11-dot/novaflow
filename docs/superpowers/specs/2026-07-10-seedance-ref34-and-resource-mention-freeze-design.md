# Seedance Reference 3/4 And Resource Mention Freeze Design

## Status

Approved in conversation on 2026-07-10. Written review is pending before implementation.

## Goal

Fix two confirmed regressions without changing unrelated AI-sequence routing:

1. Seedance 2.0 reference-image slots 3 and 4 must accept file selection and internal resource drag/drop, update only the targeted slot, and participate in generation in the declared reference order.
2. Clicking an uploaded image in the `@` resource menu must insert one thumbnail chip without freezing the renderer or starting a Runtime mutation-refresh loop.

## Confirmed Root Causes

### Seedance reference images 3 and 4

The active renderer bundle creates the image 3/4 states, setters, input refs, drop handlers, and cards. The `Hs()` producer return object exports image 2, video, and audio state, but omits these four properties:

- `aiSeqJimengImage3Ref`
- `setAiSeqJimengImage3Ref`
- `aiSeqJimengImage4Ref`
- `setAiSeqJimengImage4Ref`

The consuming component destructures those missing properties. File events reach the correct hidden inputs, but their `onChange` handlers call undefined setters; the local `try/catch` logs the error and leaves the cards unchanged. The six-slot compatibility mapping and hidden-input indexes are not the failure point.

### Image mention freeze

The resource mention menu and persistent image chip create real `<img>` nodes. AI-sequence Runtime currently treats any added or removed subtree containing `img`, `video`, or `canvas` as an upload DOM mutation, even when the node belongs to the prompt editor. That classification schedules early layout and repeated bottom-state refreshes. Each refresh calls `refreshSurface("seedance")`, which currently clears and rebuilds the mention editor, recreating the same `<img>` and feeding the observer again.

## Considered Approaches

### A. Module isolation plus idempotent rendering — selected

- Mark the mention editor, candidate menu, and error portal with `data-novaflow-runtime-ignore="1"`.
- Give each controller a render signature derived from prompt text and the fields that affect visible/resource binding state.
- When the signature is unchanged, preserve existing editor, chip, and image nodes and only refresh positioning/selection work that remains necessary.
- Add the four missing image 3/4 producer properties to `Hs()`.

This fixes the ownership boundary in the resource module and avoids changing legacy upload classification for every AI-sequence surface.

### B. Narrow the global upload MutationObserver classifier — rejected for this patch

This would address the broad classifier centrally, but it changes a legacy Runtime path used by all upload cards. Correctly classifying removed media nodes also requires careful mutation-target handling. The regression risk is higher than the scoped module fix.

### C. Idempotent rendering only — rejected

This reduces repeated DOM replacement but leaves mention media incorrectly classified as upload mutations. It masks the coupling instead of establishing an ownership boundary.

## Architecture And Responsibilities

### Resource mention module

`particle-editor/resource-mention.tool.js` remains the owner of editor, menu, chip, and error DOM. It will:

- identify those roots as Runtime-ignored UI;
- compute a stable render signature from the backing prompt and normalized descriptors;
- avoid `clearElement()` and media-node recreation when the signature is unchanged;
- continue using the existing backing textarea, React input event, selection, compilation, and submission guard contracts.

No global observer, new state manager, or new public API is introduced.

### Seedance renderer state contract

`particle-editor/assets/index-BbIa-2NM.js` is the authoritative renderer asset mirrored by `npm run sync:runtime`. The `Hs()` return object will export image 3/4 state and setters exactly as its consumer already expects. Input ordering, raw-kind mapping, workflow node mapping, credit logic, and provider behavior remain unchanged.

### Runtime

`particle-editor/novaflow-brand-runtime.js` receives no new business logic and no mutation-classifier rewrite. Existing `refreshSurface("seedance")` calls remain compatible because unchanged refreshes become idempotent inside the resource module.

## Render Signature

The signature must include every value that changes the visible chip or its binding:

- backing textarea value;
- surface;
- descriptor key and alias;
- kind and occupied state;
- model label and file name;
- preview URL;
- invalid/available state used by rendering.

The signature is recorded only after a successful render. A changed signature performs the existing full editor render. An unchanged signature must not replace chip or image nodes.

## Error Handling

- Existing invalid-reference submission behavior remains unchanged.
- Image 3/4 setter failures must no longer occur once the producer contract is complete.
- Resource mention refreshes must not swallow a required render: any relevant signature change forces rebuilding.
- No fallback may silently route reference image 3 or 4 into reference image 1.

## Scope

### In scope

- Seedance 2.0 image-reference slots 3 and 4.
- Seedance image/video/audio reference drag regression checks.
- Seedance image mention candidate click and chip refresh stability.
- Art Generate img2img mention regression checks because it shares the mention module.
- Cache key update, mirrored renderer synchronization, debug log, and automated contracts.

### Out of scope

- Refactoring the global Runtime MutationObserver.
- Reordering hidden file inputs or changing `ai-sequence-input-compat.tool.js` indexes.
- Rewriting internal resource drag payloads or the legacy raw-kind fallback unless live acceptance still proves a separate failure after the producer fix.
- Storyboard, skeleton animation, export, local Wan A/B, pricing, or workflow-node changes.

## Verification

### Automated contracts

1. A failing producer/consumer contract must prove image 3/4 state and setter keys are absent before the fix and present after it.
2. A resource mention DOM-stability contract must verify Runtime-ignore markers are applied to all mention roots.
3. Repeating an unchanged refresh must preserve editor, chip, and image node identity and produce no child-list churn from the mention tool.
4. Existing resource mention compilation, prompt protection, six-slot routing, Smart AI auto-pause, Runtime sync, and entry checks must remain green.

### Locked 4783 acceptance

1. Select and internally drag an image into reference image 3, then image 4; each target card alone must show the selected media and reference image 1 must remain unchanged.
2. Drag supported resources into video and audio reference cards and verify each target independently.
3. Upload an image, type `@`, click its image candidate, and verify one chip appears, typing remains responsive, and no renderer error or growing mutation-refresh counter remains.
4. Call `refreshSurface("seedance")` repeatedly and verify the existing chip/image DOM nodes remain stable.
5. Verify Art Generate img2img can still insert mentions for its three occupied reference slots.
6. Verify prompt-assistant actions still pause an actively playing AI-sequence preview and execute once.

## Delivery Rules

- Modify authoritative source files only, then run `npm run sync:runtime`.
- Run targeted checks, `npm run check:runtime`, `npm run check:entry`, syntax checks, and `git diff --check`.
- Append the required entry to `logs/debug.log`.
- Finish with `npm run auto-commit`, `git status`, and a clean working tree.
