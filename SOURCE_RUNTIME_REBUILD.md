# NovaFlow Source Runtime Rebuild

## Current Formal Runtime

The formal 4783 runtime is still the locked renderer chain:

```text
tools/preview_runtime_server.py
-> particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html
-> assets/index-Bqc1waVn.js
-> runtime scripts
```

This branch does not replace or write the formal 4783 runtime.

## Recovery Runtime

This branch introduces an isolated source runtime workspace:

```text
experimental/source-runtime
```

Its source entry is:

```text
experimental/source-runtime/src/main.tsx
experimental/source-runtime/src/App.tsx
```

Its HTML entry loads:

```text
/src/main.tsx
```

It does not load:

```text
assets/index-Bqc1waVn.js
```

## Phase 2 Source Shell Boundary

The isolated source runtime now owns the outer visual shell:

```text
Source App
-> SourceShell
   -> source topbar
   -> source sidebar
   -> source workspace
   -> LegacyRuntimeMount
      -> LegacyRuntimeFrame
         -> iframe src="/legacy/index.html"
```

Legacy runtime content is iframe-only. The source parent document does not directly load:

```text
assets/index-Bqc1waVn.js
ai-sequence-state-machine-runtime.js
novaflow-brand-runtime.js
```

The legacy frame is served from the existing locked renderer snapshot under:

```text
particle-editor
```

through the isolated Vite middleware route:

```text
/legacy/*
```

This route is only for validation inside `experimental/source-runtime`.

## Phase 3 Source-Owned Feature

The isolated source runtime now includes the first source-owned feature:

```text
SourceShell
-> ColorReferencePicker
```

The feature lives only in:

```text
experimental/source-runtime/src/components/ColorReferencePicker.tsx
experimental/source-runtime/src/types/colorReference.ts
```

It owns its own local file input:

```text
input type="file" accept="image/*"
```

State stays inside the source app:

```text
ColorReference {
  file
  url
  name
  width
  height
  size
}
```

It does not write to the legacy iframe, does not send messages to legacy runtime, and does not repair formal 4783 `color_ref`.

## Build Chain

The isolated workspace uses Vite directly from the existing `particle-editor` dependency installation:

```text
cd experimental/source-runtime
npm run dev
npm run build
npm run preview
```

The build output is isolated to:

```text
experimental/source-runtime/dist
```

No output is synchronized to:

```text
particle-editor-desktop/dist/win-unpacked/resources/app/renderer
```

## Runtime Script Compatibility

Phase 1 validated top-level runtime startup compatibility. Phase 2 narrows the boundary:

```text
Runtime scripts are not loaded in the source parent document.
Runtime scripts are loaded only by the legacy iframe document.
```

This is only an iframe boundary check. It does not connect AI sequence functionality, migrate state machines, or restore the old EditorApp.

Phase 3 keeps the same boundary. The source-owned `ColorReferencePicker` does not communicate with the iframe.

## Phase 4 Source To Legacy Messaging

Phase 4 validates metadata-only messaging from Source Shell to a legacy bridge iframe:

```text
ColorReferencePicker
-> SourceShell
-> postMessage(metadata only)
-> LegacyRuntimeFrame iframe
-> public/legacy-bridge.html
-> nested iframe /legacy/index.html
```

Message types:

```text
SOURCE_COLOR_REF_SELECTED
SOURCE_COLOR_REF_CLEARED
```

Selected payload:

```text
name
size
width
height
mime
```

The source side does not send:

```text
File
Blob
objectURL
```

The bridge logs received messages for validation and keeps `data-forward-count="0"`. It does not forward messages to the nested legacy iframe and does not connect any legacy business behavior.

## Phase 5 Guarded Bridge Forwarding

Phase 5 adds a bridge-controlled forwarding path, but the committed default remains:

```text
const forwardToLegacy = false
```

Default behavior:

```text
SourceShell
-> legacy-bridge.html
-> log received metadata
-> forwarding disabled
```

When manually toggled to `true` for validation only, the bridge forwards metadata-only messages to the nested legacy iframe:

```text
SOURCE_COLOR_REF_SELECTED -> BRIDGE_COLOR_REF_SELECTED
SOURCE_COLOR_REF_CLEARED -> BRIDGE_COLOR_REF_CLEARED
```

Forwarded selected payload is restricted to:

```text
name
size
width
height
mime
```

The bridge does not forward:

```text
File
Blob
objectURL
url
dataUrl
```

Nested legacy receipt is validated only through the bridge-owned test listener and counters. No locked legacy bundle or business code is modified, and no legacy `color_ref` behavior is connected.

## Phase 6 Source Processing Tools Color Reference

The formal 4783 locked bundle `color_ref` path was audited and rejected as a clean fix target:

```text
DIV[data-ais-import="color_ref"]
no card-local input[type=file]
no label
hidden generation-panel input
real click does not open the file chooser
```

This branch therefore adds a source-owned processing tools panel:

```text
SourceShell
-> ProcessingToolsPanel
   -> ColorReferencePicker
-> LegacyRuntimeMount
   -> LegacyRuntimeFrame
```

The source processing tools panel lives only under:

```text
experimental/source-runtime/src/components/ProcessingToolsPanel.tsx
```

`ColorReferencePicker` now uses native label/input activation:

```text
label htmlFor
input type="file" accept="image/*"
```

It does not call `input.click()`, does not patch the locked bundle, and does not depend on runtime scripts. Selection still remains source-local except for metadata-only bridge messages. The bridge default remains:

```text
const forwardToLegacy = false
```

This phase is not a formal 4783 locked-bundle repair.

## Phase 7 Source Processing Tools Reference Image

The source processing tools panel now owns a second upload entry:

```text
SourceShell
-> ProcessingToolsPanel
   -> ReferenceImagePicker
   -> ColorReferencePicker
```

`ReferenceImagePicker` lives in:

```text
experimental/source-runtime/src/components/ReferenceImagePicker.tsx
```

It follows the same stable native upload rule:

```text
label htmlFor
input type="file" accept="image/*"
```

The reference image state is source-local. It does not patch the locked bundle, does not call `input.click()`, does not use runtime click proxy, and does not send `File`, `Blob`, object URLs, or reference-image business state to legacy. The legacy iframe remains display-only for old functionality.

## Phase 8 Source AI Sequence Preview Board

The source runtime now owns the first AI sequence preview structure:

```text
SourceShell
-> ProcessingToolsPanel
   -> ReferenceImagePicker
   -> ColorReferencePicker
-> source workbench
   -> AISequencePreviewArea
      -> AddBoardButton
      -> AISequenceBoard
      -> ai-seq-bottom-dock
   -> LegacyRuntimeMount
      -> LegacyRuntimeFrame
```

New source files:

```text
experimental/source-runtime/src/components/AISequencePreviewArea.tsx
experimental/source-runtime/src/components/AISequenceBoard.tsx
experimental/source-runtime/src/components/AddBoardButton.tsx
experimental/source-runtime/src/types/aiSequenceBoard.ts
```

`useAISequenceSourceState` owns only local board state:

```text
boards: AISequenceBoardModel[]
activeBoardId: string | null
```

`AddBoardButton` is a plain `button type="button"`. It is not an upload control, does not contain `input type="file"`, and does not open a file chooser. The default board remains:

```text
width: 512
height: 720
name: "画板 1"
```

`AISequencePreviewArea` separates the preview area from `ai-seq-bottom-dock`, so the board is centered inside the preview area and cannot extend behind the lower dock. This phase does not migrate generation, cutout, timeline, AI sequence state machine behavior, Comfy, particles, skeleton animation, ribbons, or split-image tooling.

## Phase 9 Source Generation Parameters

The source runtime now owns the base AI sequence generation parameter UI:

```text
SourceShell
-> source left panels
   -> ProcessingToolsPanel
   -> GenerationParametersPanel
-> source workbench
   -> AISequencePreviewArea
   -> LegacyRuntimeMount
```

New source files:

```text
experimental/source-runtime/src/components/GenerationParametersPanel.tsx
experimental/source-runtime/src/types/generationParameters.ts
```

`useAISequenceSourceState` owns only local generation parameter state:

```text
generationParameters {
  width
  height
  frames
  fps
  prompt
  negativePrompt
}
```

The panel uses native source-controlled inputs:

```text
input type="number"
textarea
```

Minimum values:

```text
width >= 64
height >= 64
frames >= 1
fps >= 1
```

Width and height changes update only the active Source board. If there is no active board, the parameter state changes but no board is created. Boards are created only through `AddBoardButton`. This phase does not connect Comfy, AI generation, prompt workflow, runtime state machine behavior, timeline, cutout, or legacy business state.

## Phase 10 Source Timeline Shell

The source runtime now owns the first timeline shell:

```text
SourceShell
-> timelineState
-> AISequencePreviewArea
   -> ai-seq-bottom-dock
      -> TimelinePanel
         -> TimelineTransport
         -> TimelineTrack
         -> TimelinePlayhead
```

New source files:

```text
experimental/source-runtime/src/components/TimelinePanel.tsx
experimental/source-runtime/src/components/TimelineTransport.tsx
experimental/source-runtime/src/components/TimelineTrack.tsx
experimental/source-runtime/src/components/TimelinePlayhead.tsx
experimental/source-runtime/src/types/timeline.ts
```

`useAISequenceSourceState` owns only local timeline state:

```text
timelineState {
  currentFrame
  totalFrames
  fps
  isPlaying
}
```

`totalFrames` and `fps` follow `generationParameters.frames` and `generationParameters.fps`. When frames changes, only the Source timeline frame cells and currentFrame clamp are updated. This does not mutate generation parameters and does not create boards.

Timeline behavior in this phase:

```text
previous/next frame -> update currentFrame only
click frame cell -> update currentFrame only
play button -> toggle isPlaying UI state only
```

This phase does not use `requestAnimationFrame`, timers, video playback, WEBM, AI workflow, Comfy, cutout, runtime state machine behavior, or legacy timeline state.

## Phase 11 Source AI Sequence State Hook

The source runtime now collects AI sequence Source state into one local hook:

```text
SourceShell
-> useAISequenceSourceState
   -> boards / activeBoardId
   -> generationParameters
   -> timelineState
   -> referenceImage
   -> colorReference
   -> imageSequenceFrames
```

New source file:

```text
experimental/source-runtime/src/hooks/useAISequenceSourceState.ts
```

`SourceShell` is now responsible for:

```text
layout
component mounting
metadata-only bridge test controls
legacy iframe ref
```

The hook owns:

```text
createBoard
updateBoard
removeBoard
setGenerationParameters
toggleTimelinePlaying
stepTimelineFrame
selectTimelineFrame
```

Behavior remains unchanged:

```text
width/height changes update only the active Source board
frames changes update timeline cells and clamp currentFrame only
play toggles isPlaying UI state only
uploads remain Source-local except existing metadata-only color reference bridge tests
```

This phase only reorganizes Source local state. It does not add playback, video, WEBM, AI workflow, Comfy, cutout, legacy business state, postMessage business sync, or formal 4783 renderer changes.

## Phase 12 Source Static Image Sequence Preview

The source runtime now supports static image sequence preview:

```text
ProcessingToolsPanel
-> ImageSequencePicker
-> useAISequenceSourceState.imageSequenceFrames
-> AISequencePreviewArea
-> AISequenceBoard
-> AISequenceFramePreview
```

New source files:

```text
experimental/source-runtime/src/components/ImageSequencePicker.tsx
experimental/source-runtime/src/components/AISequenceFramePreview.tsx
experimental/source-runtime/src/types/imageSequence.ts
```

`ImageSequencePicker` uses native source-owned upload controls:

```text
label htmlFor
input type="file" accept="image/*" multiple
```

It sorts selected images by filename, creates object URLs, reads dimensions, displays the frame count, and clears by revoking all sequence object URLs.

Timeline linkage:

```text
upload sequence -> generationParameters.frames = image count
upload sequence -> timelineState.totalFrames = image count
upload sequence -> currentFrame = 0
timeline currentFrame -> board displays imageSequenceFrames[currentFrame]
out-of-range currentFrame -> board displays the last available image
clear sequence -> revoke all object URLs, imageSequenceFrames = [], currentFrame = 0
```

Manual `frames` edits still only change the Source timeline frame range and currentFrame clamp. They do not delete, create, or pad `imageSequenceFrames`.

This phase does not add playback loops, video, WEBM, AI generation, Comfy, cutout, legacy business state, runtime state machine behavior, or formal 4783 renderer changes.

## Phase 13 Source Static Image Sequence Playback

The source runtime now supports local playback of the static image sequence:

```text
TimelineTransport play button
-> useAISequenceSourceState.isPlaying
-> requestAnimationFrame loop inside useAISequenceSourceState
-> timelineState.currentFrame
-> AISequenceFramePreview
```

Playback is restricted to Source state and Source image sequence frames:

```text
playable frames = min(generationParameters.frames, imageSequenceFrames.length)
frame duration = 1000 / fps
last playable frame -> frame 0
pause -> cancelAnimationFrame
unmount -> cancelAnimationFrame
```

Timeline behavior:

```text
click frame cell while playing -> jump immediately, then continue playback
previous/next frame -> still updates currentFrame manually
empty image sequence -> play UI can toggle, but no frames advance
fps changes -> affect later RAF intervals only
fps changes do not reset currentFrame or reload the sequence
```

This phase uses `requestAnimationFrame` only inside:

```text
experimental/source-runtime/src/hooks/useAISequenceSourceState.ts
```

It does not add video playback, WEBM playback, media elements, AI generation, Comfy, cutout, legacy playback, runtime state machine behavior, or formal 4783 renderer changes.

## Phase 14 Source AI Sequence Audit

The current Source AI sequence lane has been audited as a source-owned baseline, not a production replacement.

Audit artifact:

```text
logs/ai-sequence-source-audit.md
```

Completed Source modules:

```text
ReferenceImagePicker
ColorReferencePicker
ImageSequencePicker
useAISequenceSourceState
AISequencePreviewArea
AISequenceBoard
AISequenceFramePreview
GenerationParametersPanel
TimelinePanel
TimelineTransport
TimelineTrack
TimelinePlayhead
static image sequence playback
legacy iframe isolation
```

Current conclusion:

```text
The Source AI sequence lane cannot become the main AI sequence entry yet.
```

Blocking gaps:

```text
WEBM/video runtime
AI generation / Comfy workflow
cutout / chroma key / color correction
complete board session model
export/project integration
approved formal 4783 renderer promotion plan
```

This audit does not add new functionality and does not modify the formal 4783 runtime.

## Phase 15 Source AI Sequence Board Sessions

The source runtime now owns independent AI sequence board sessions:

```text
SourceShell
-> useAISequenceSourceState
   -> boards: AISequenceBoardSession[]
   -> activeBoard
   -> board-scoped generationParameters
   -> board-scoped timelineState
   -> board-scoped imageSequenceFrames
   -> board-scoped referenceImage
   -> board-scoped colorReference
```

New source files:

```text
experimental/source-runtime/src/types/aiSequenceBoardSession.ts
experimental/source-runtime/src/components/BoardSwitcher.tsx
```

Each board session owns:

```text
id
name
generationParameters
timelineState
imageSequenceFrames
referenceImage
colorReference
```

New board defaults:

```text
width: 512
height: 720
frames: 24
fps: 12
prompt: ""
negativePrompt: ""
currentFrame: 0
isPlaying: false
```

No board state:

```text
Processing upload controls are disabled.
Generation parameters are visible but disabled.
Timeline controls are disabled.
Preview shows only the add-board empty state.
No board is created automatically.
```

Board switching behavior:

```text
BoardSwitcher provides minimal tabs plus an add button.
Switching boards changes activeBoard only.
Reference image, color reference, image sequence, generation parameters, timeline state, and preview frame follow the active board.
Switching away from a playing board cancels RAF and stops that board's playback.
```

Object URL lifecycle:

```text
Deleting a board revokes that board's image sequence, reference image, and color reference URLs.
Clearing image sequence revokes only the active board's sequence URLs.
Switching boards does not revoke resources.
```

This phase does not add WEBM, video playback, AI workflow, Comfy, cutout, legacy business state, runtime state machine behavior, or formal 4783 renderer changes.

## Phase 16 Source WEBM / MP4 Video Preview

The source runtime now supports board-scoped video preview state:

```text
SourceShell
-> useAISequenceSourceState
   -> activeBoard.videoPreview
   -> setVideoPreview()
   -> clearVideoPreview()
```

New source files:

```text
experimental/source-runtime/src/types/videoPreview.ts
experimental/source-runtime/src/components/VideoPreviewPicker.tsx
experimental/source-runtime/src/components/AISequenceVideoPreview.tsx
```

Each board session now owns:

```text
videoPreview: VideoPreviewState | null
```

Video picker behavior:

```text
Uses native label htmlFor + input type=file.
Accepts video/webm and video/mp4.
Reads duration, videoWidth, and videoHeight from metadata.
Shows file name, resolution, duration, and size.
Clearing or replacing the video revokes the previous object URL.
Selecting a video does not clear or overwrite imageSequenceFrames.
```

Preview priority:

```text
videoPreview
> imageSequenceFrames[currentFrame]
> empty board
```

Timeline/video behavior:

```text
currentFrame / fps maps to video.currentTime.
Source Timeline play/pause toggles video.play() / video.pause().
video.play() failures are caught and logged; no autoplay workaround is used.
When a board has videoPreview, image sequence RAF playback does not also run.
```

Object URL lifecycle:

```text
Replacing videoPreview revokes only the old active board video URL.
Clearing videoPreview revokes only the active board video URL.
Deleting a board revokes that board's video URL along with its image/reference/color URLs.
Switching boards does not revoke resources.
```

This phase does not add AI workflow, Comfy, cutout, export, legacy business state, runtime state machine behavior, or formal 4783 renderer changes.

## Phase 19 Source Partial Replacement No-op Flag Bootstrap

Source partial replacement now has a default-off flag resolver inside the isolated Source runtime path.

Implementation:

```text
Added experimental/source-runtime/src/featureFlags/sourcePartialReplacementFlags.ts.
All flags default to false.
Split flags only become effective when SOURCE_PARTIAL_REPLACEMENT is true.
Effective flags are computed as uploadsEnabled / previewEnabled / boardSessionEnabled / generationPanelEnabled.
The resolver can read a packaged-safe window config, dev localStorage values, and dev query params.
Malformed, missing, or unavailable flag sources fall back to the all-false legacy-safe default.
main.tsx only computes and exposes the flag resolution for inspection.
```

Runtime boundary:

```text
No Source island is mounted.
No legacy DOM is hidden or disabled.
No 4783 locked renderer files were modified.
No novaflow-brand-runtime.js patch was made.
No Comfy, AI generation, cutout, export, production media lifecycle, or packaged promotion path was connected.
```

Validation:

```text
node --check experimental/source-runtime/tools/verify-source-runtime.mjs: passed
node experimental/source-runtime/tools/verify-source-runtime.mjs: SOURCE_RUNTIME_BASELINE_OK
Static checks verify default false flags, effective split gating by master flag, main.tsx bootstrap exposure, and absence of Source island / runtime-ignore mount behavior.
```

## Phase 20 Source Partial Replacement Empty Island Mount

Source partial replacement now has a default-off empty island mount/unmount boundary.

Implementation:

```text
Added experimental/source-runtime/src/partialReplacement/sourceIslandManager.ts.
mountSourceIsland creates #novaflow-source-island-root only when SOURCE_PARTIAL_REPLACEMENT is true.
The empty island is marked data-novaflow-source-island="phase1".
The empty island is marked data-novaflow-runtime-ignore="1".
The empty island is marked data-novaflow-source-owner="source-runtime".
The only island child is data-novaflow-source-island-placeholder="1".
unmountSourceIsland removes only the Source-owned island root and tolerates repeated calls.
Cleanup callbacks are reserved for future objectURL, file input, board session, and event listener cleanup.
```

Runtime boundary:

```text
Default flags do not mount the island.
The island does not contain upload, preview, board session, generation panel, Comfy, generation, cutout, export, or legacy bridge UI.
No legacy DOM is hidden or replaced.
No 4783 locked renderer files were modified.
No novaflow-brand-runtime.js patch was made.
No packaged promotion was made.
```

Validation:

```text
node --check experimental/source-runtime/tools/verify-source-runtime.mjs: passed
node experimental/source-runtime/tools/verify-source-runtime.mjs: SOURCE_RUNTIME_BASELINE_OK
npm --prefix experimental/source-runtime run build: passed
git diff --check: passed
Source dev DOM smoke:
- default URL: #novaflow-source-island-root absent
- ?SOURCE_PARTIAL_REPLACEMENT=1: #novaflow-source-island-root present with runtime ignore and phase1 markers
- query removed: #novaflow-source-island-root absent after refresh
```

## Phase 21 Source Island Upload Surfaces Gate

Source partial replacement can now mount the completed Source upload surfaces inside the runtime-ignore island, but only when both master and upload split flags are enabled.

Implementation:

```text
Added SourceUploadSurfacesIsland.
The island composes the existing Source upload controls through ProcessingToolsPanel.
The island uses the existing useAISequenceSourceState instance from SourceShell through a Source island React root.
The island only mounts when SOURCE_PARTIAL_REPLACEMENT=true and SOURCE_UPLOAD_SURFACES=true.
SOURCE_PARTIAL_REPLACEMENT=true without SOURCE_UPLOAD_SURFACES=true still mounts only the empty placeholder island.
Default flags still mount no island.
ColorReferencePicker now accepts an optional input id prefix so the island does not duplicate the default Source panel color_ref input id.
The island React root uses an identifierPrefix so useId-based upload inputs do not duplicate ids across roots.
```

Runtime boundary:

```text
No legacy DOM is hidden or disabled.
No upload, preview, board session, or generation panel legacy replacement is performed.
No Comfy, AI generation, cutout, export, production media lifecycle, or packaged promotion path was connected.
No postMessage bridge is used by the upload island.
No novaflow-brand-runtime.js or 4783 locked renderer file was modified.
```

Validation:

```text
node --check experimental/source-runtime/tools/verify-source-runtime.mjs: passed
node experimental/source-runtime/tools/verify-source-runtime.mjs: SOURCE_RUNTIME_BASELINE_OK
npm --prefix experimental/source-runtime run build: passed
git diff --check: passed
Source dev DOM/file chooser smoke:
- default URL: #novaflow-source-island-root absent
- ?SOURCE_PARTIAL_REPLACEMENT=1: island present with placeholder only and no island upload controls
- ?SOURCE_PARTIAL_REPLACEMENT=1&SOURCE_UPLOAD_SURFACES=1: island upload controls present inside data-novaflow-runtime-ignore="1"
- island color_ref label triggered Page.fileChooserOpened
- board A/B color_ref upload isolation remained scoped to the active Source board
- legacy iframe remained visible
- query removed: #novaflow-source-island-root absent after refresh
```

## Next Decision

This branch remains an isolated source-driven baseline. It now contains source-owned reference image and color reference upload controls, independent board sessions, static image sequence upload/preview/playback, WEBM/MP4 video preview, the first source-owned AI sequence preview board shell, base generation parameter state/UI, the first source-owned timeline shell, a local AI sequence Source state hook, a default-off Source partial replacement flag bootstrap, an empty Source island mount/unmount boundary, and a default-off gated upload island, but generation execution, cutout, full AI sequence UI migration, export, and formal renderer promotion still require separate approval.

## Phase 17 Replacement Readiness Audit

The source runtime has been audited for formal AI sequence entry replacement readiness.

Classification:

```text
可直接替换: no
可部分替换: yes, only for Source-owned upload / preview / board session / local timeline surface
不可替换: yes for full formal AI sequence entry today
```

Recommendation:

```text
Do not directly replace the formal 4783 AI sequence entry yet.
Continue parallel Source + Legacy.
Prepare any future partial replacement behind explicit route ownership, parity, packaged smoke, and rollback gates.
```

Blocking gaps:

```text
AI generation / Comfy workflow
cutout / chroma key / color correction
sourceMedia / processedMedia / editing draft production session chain
WEBM/video export
project export integration
formal renderer promotion and rollback plan
packaged file:// validation
```

Report:

```text
logs/ai-sequence-source-replacement-readiness.md
```

This phase does not add features, replace formal entry, modify formal 4783 dist, patch locked bundle, or modify runtime scripts.

## Phase 18 Source Color Reference Upload

Source color_ref is now implemented inside the isolated Source runtime path.

Implementation:

```text
ColorReferencePicker uses native label htmlFor + input type=file.
The fixed input id is scoped by active Source board id.
Accepted files: PNG / JPG / JPEG / WEBP.
Uploaded files render a local object URL preview and file name.
Clear removes only the active board color_ref and revokes its object URL.
No board selected leaves the upload input disabled and does not create a board.
```

State boundary:

```text
colorReference belongs to AISequenceBoardSession.
Creating a board initializes colorReference to null.
Switching boards displays each board's own colorReference.
Removing a board revokes that board's colorReference object URL.
Reference / image sequence / video upload state remains separate.
```

Runtime boundary:

```text
No formal 4783 locked bundle files were modified.
No novaflow-brand-runtime.js patch was made.
No legacy postMessage, Comfy workflow, generation, cutout, export, or runtime state-machine path was connected.
```

Validation:

```text
node experimental/source-runtime/tools/verify-source-runtime.mjs: SOURCE_RUNTIME_BASELINE_OK
npm --prefix experimental/source-runtime run build: passed
Chrome CDP Source dev upload smoke: Page.fileChooserOpened mode=selectSingle, board A/B color_ref isolation passed.
```

## Phase 19 4783 Source Upload Island Bootstrap Bridge

The formal 4783 locked renderer now has a default-off bridge loader for the Source upload island path.

Boundary:

```text
The bridge is loaded only when SOURCE_PARTIAL_REPLACEMENT=1 and SOURCE_UPLOAD_SURFACES=1.
Default 4783 does not create #novaflow-source-island-root and does not load the bridge script.
The bridge script is a separate renderer-side runtime support file:
particle-editor-desktop/dist/win-unpacked/resources/app/renderer/novaflow-source-upload-island-bridge.js
The main locked bundle assets are unchanged.
```

Implementation:

```text
novaflow-brand-runtime.js acts only as a flag bootstrap loader.
The bridge creates #novaflow-source-island-root inside the AI Sequence upload area after the animation route is active.
The island is marked data-novaflow-source-island="phase1", data-novaflow-runtime-ignore="1", and data-novaflow-source-owner="source-runtime".
Because the Source Vite dist is a full app artifact rather than an embeddable React island bundle, this phase uses a temporary native color_ref bridge surface.
The native surface uses label htmlFor + input type=file accept=image/png,image/jpeg,image/webp, local preview, file name, and clear.
```

Runtime boundary:

```text
No legacy upload logic was deleted.
No legacy DOM is hidden by default or when the bridge is enabled.
No input.click, proxy input, document click capture, postMessage, Comfy workflow, generation, cutout, export, or packaged renderer promotion path was added.
```

Validation:

```text
Default 4783: #novaflow-source-island-root absent and bridge global absent.
4783 with flags + Animation route: source island present, input[type=file] count=1, input is inside data-novaflow-runtime-ignore, accept includes png/jpeg/webp.
Chrome CDP elementFromPoint on the color_ref label hits the Source island label.
Chrome CDP label click triggered Page.fileChooserOpened mode=selectSingle.
Island contains no legacy proxy picker and no overlay.
Rollback by removing flags: #novaflow-source-island-root absent.
npm run check:entry: active surface sync restored after hash snapshot update; Comfy 8000 remains an external timeout.
```
