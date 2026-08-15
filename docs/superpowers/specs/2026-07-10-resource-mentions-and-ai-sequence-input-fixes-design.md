# Resource Mentions And AI Sequence Input Fixes Design

## Status

Approved in conversation on 2026-07-10.

## Requirements

1. Clicking Smart AI, AI Optimize, or AI Reverse while the AI-sequence main preview is playing must pause playback and still execute the selected action exactly once.
2. Seedance 2.0 reference-image slots 1-4, video reference, and audio reference must each own their file picker and file-drop route.
3. Typing `@` in the Seedance positive prompt must show only occupied reference slots and insert an inline thumbnail chip at the caret.
4. Typing `@` in Art Generate img2img must show only its occupied three reference slots and insert the same style of inline thumbnail chip.
5. Local AI-sequence Wan A/B is out of scope.

## Root Causes

### Playback actions

Prompt action buttons do not currently synchronize the React-owned `previewTimelinePlaying` state before running. Directly calling `video.pause()` is insufficient because React can resume playback. The actual timeline toggle is driven by `pointerdown`, so a plain programmatic `click()` is not authoritative.

### Seedance six-slot drop

The React bundle already owns six distinct states and `data-ais-import` values. The Runtime document-capture compatibility layer still normalizes them to the historical labels `参考图`, `首帧`, and `尾帧`, so file drops and click proxies resolve to the wrong hidden input.

### Resource mentions

Native textareas cannot render thumbnail chips. Both Seedance and Art Generate also compress empty media slots before submission, so a visible slot number cannot be copied directly into the model prompt.

## Architecture

Create a focused `resource-mention.tool.js` module and scoped stylesheet. The module owns the contenteditable mirror, candidate menu, chip serialization, invalidation, keyboard behavior, and provider-specific prompt compilation. A second focused `ai-sequence-input-compat.tool.js` module owns the pure six-slot routing table, file-family checks, and playback event dispatch. Runtime code only registers or mounts these tools, supplies resource snapshots, and calls the compiler before workflow submission. This split keeps the source Runtime delta below the V2.5 300-line re-evaluation gate.

The backing prompt value uses readable stable aliases such as `@参考图2`, `@视频参考`, and `@声音参考`. The visible editor renders those aliases as atomic thumbnail chips. Prompt history can therefore retain readable text, while reloading the value rehydrates the chips.

## Public Interface

`window.NovaFlowResourceMentionTool` exposes:

```js
mountTextarea({ textarea, surface, getResources })
refreshSurface(surface)
compileText({ text, surface, resources })
protectText(text)
restoreText(text, protection)
```

Each resource snapshot has this shape:

```js
{
  key: "art_reference_2",
  label: "参考图2",
  kind: "image",
  previewUrl: "blob:...",
  fileName: "costume.png",
  occupied: true
}
```

## Compilation Rules

### Seedance

Occupied images are ordered by reference slot and compacted to `@Image 1..N`. Video and audio are independently compacted to `@Video 1` and `@Audio 1`.

### Art Generate img2img

Occupied `art_reference_1..3` slots are ordered and compacted to `图1..N`, matching the actual `TextEncodeQwenImageEditPlus.image1..image3` connections created by `syncArtWorkflowReferenceImages(...)`.

A token that points to an empty or unavailable slot is invalid. Generation must stop with an explicit message instead of silently rebinding the token.

## Interaction Rules

- Typing `@` opens a menu containing only occupied resources for the current surface.
- Clicking a candidate replaces the trigger text with an atomic chip at the caret.
- Image chips show a thumbnail and current model label; video/audio chips show a type icon and filename.
- Backspace, Delete, or the chip remove control removes only the mention, never the uploaded resource.
- Replacing a resource in the same slot refreshes every chip bound to that slot.
- Removing a referenced resource marks the chip invalid and blocks submission.
- Filling or clearing an earlier slot recomputes the visible model ordinal without changing the slot binding.
- Copying a chip produces its readable alias; pasting a readable alias rehydrates it when the slot is available.

## Prompt Assistant Rules

Prompt optimization must preserve mention aliases through protected placeholders. If a result drops or duplicates protected placeholders, it must not overwrite the current prompt. Reverse-prompt flows keep existing serialized aliases unless the user explicitly removes them.

## Scope And Compatibility

- Seedance reference mode: four images, one video, one audio.
- Art Generate img2img: three images, ordinary Edit-2511 and NSFW/Rapid templates.
- Art Generate txt2img: no mention candidates.
- AI-sequence local Wan A/B: no mention feature.
- Storyboard, skeleton animation, split editor, and other top-level entries are unchanged.

## Performance

The module reacts only to prompt input, slot refresh, surface mount, and submission. It must not add a global continuous MutationObserver. Blob/object URLs are read from existing resource state; the module does not create duplicate media URLs.

## Verification

- Static contracts prove the playback bridge, six exact slot mappings, tool API, both compilation dialects, invalid-token behavior, Runtime registration, and Smart AI preservation guard.
- Locked `4783` verifies Seedance and Art Generate DOM behavior, caret insertion, deletion, model-number updates, and action auto-pause.
- Live `8188/object_info` verifies `TextEncodeQwenImageEditPlus.image1..image3` availability.
- A captured `/prompt` payload verifies Seedance tokens and Qwen `图N` text match the actual media-node order.
