# NovaFlow Refactor Baseline Phase 0

## Baseline

- Date: 2026-06-29
- Branch: `rebuild/source-driven-runtime`
- HEAD: `da526b8e auto-save: 2026-06-29 18:24:18`
- Purpose: establish a stable refactor baseline before Phase 1 helper extraction.
- Scope: documentation and read-only checks only.

Phase 0 does not split Runtime files, does not change UI behavior, does not change Comfy workflow JSON, does not change Storyboard V5, and does not change Prompt Assistant.

## Formal Runtime Entry Chain

The accepted validation entry remains:

```text
http://127.0.0.1:4783/
```

The local AI Runtime endpoint remains:

```text
http://127.0.0.1:8188/
```

The formal renderer entry is:

```text
particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html
```

The active script/style loading order in the formal renderer index is:

```text
runtime-fetch-proxy.js
proxy-electron-api.js
runtime-detect-stabilizer.js
spine-official-runtime.js
ai-background-removal-runtime.js
aifx-repaint-runtime.js
spine-split-runtime.js
novaflow-brand-runtime.js
ribbon-event-markers.js
assets/index-g5_V6IX0.css
assets/index-Bqc1waVn.js
```

Runtime mirror relationship:

```text
particle-editor/*.js
-> particle-editor-desktop/renderer/*.js
-> particle-editor-desktop/dist/win-unpacked/resources/app/renderer/*.js
```

Current guardrails:

```powershell
npm run sync:runtime
npm run check:runtime
npm run check:entry
```

`sync:runtime` is the mirror writer. `check:runtime` verifies source, renderer, and win-unpacked runtime mirror consistency. `check:entry` verifies the locked 4783 entry when 4783 is already running.

## Core Runtime File Sizes

| File | Lines |
|---|---:|
| `particle-editor/novaflow-brand-runtime.js` | 64,716 |
| `particle-editor/spine-split-runtime.js` | 41,147 |
| `particle-editor/aifx-repaint-runtime.js` | 4,976 |
| `particle-editor-desktop/main.js` | 6,648 |
| `particle-editor-desktop/prompt-assistant-service.py` | 6,835 |

## High-Coupling Modules

| Module | Current coupling |
|---|---|
| Left primary and secondary navigation | Runtime DOM markers, body classes, primary/secondary active state, and panel mounting are mixed across `novaflow-brand-runtime.js` and `spine-split-runtime.js`. |
| Dialog system | Export, art export, image upscale, wash, outpaint, angle adjust, object transfer, and Storyboard dialogs use separate shell implementations. |
| Resource card system | AI sequence resources and split-editor source/result resources use separate state shapes and DOM ownership rules. |
| Preview state | Global preview layout, split preview overlay, AI sequence preview, and skeleton preview share body classes and DOM observers. |
| Runtime task dispatch | Split-editor tools share `/prompt`, `/history`, `/view`, and upload flow, but each tool still owns workflow setup and result commit logic. |
| Comfy / 8188 call chain | Renderer helpers call Electron IPC fallbacks and direct fetch fallbacks; main process also owns Runtime startup and proxy checks. |
| AI Prompt Assistant | Renderer prompt buttons, Electron IPC, Python service, and Storyboard planning all share the same assistant service boundary. |
| Export / repository entry | Topbar export, art export, skeleton export, manual naming, repository entry, and authorization state are coupled through modal and body state. |
| Art drawing entry | Drawing, split, inpaint, cutout, source import, resource cards, and canvas tools share one large split runtime state object. |
| AI sequence animation / skeleton animation switch | Runtime surface ownership depends on body classes, skeleton layout evidence, AI sequence claims, and cleanup guards. |

## Temporarily Forbidden Refactor Areas

Do not refactor these areas during Phase 0 or the first low-risk extraction rounds:

- Storyboard V5.
- Prompt Assistant.
- Comfy workflow JSON.
- AI sequence animation / skeleton animation switching logic.
- Runtime task prompt content and model/node selection.
- Electron IPC business behavior.

## Recommended Phases

### Phase 0: Stable Baseline

- Record branch, HEAD, line counts, entry chain, mirror rules, and high-coupling modules.
- Add read-only checks.
- Add manual acceptance matrix.
- Do not split functionality.

### Phase 1: Low-Risk Helper Extraction

- Extract pure utilities only.
- Candidate helpers: DOM query wrappers, text normalization, class/attribute setters, debug logging, safe JSON parsing, visible element checks, and read-only state accessors.
- Keep old function names and behavior.

### Phase 2: Low-Risk Dialog Shell

- Design `createDialogShell`, `openDialog`, and `closeDialog`.
- Start with low-risk utility dialogs only.
- Keep old dialogs as fallback.
- Do not migrate Storyboard dialogs first.

### Phase 3: Workflow Task Shell

- Introduce a common wrapper around upload, `/prompt`, `/history`, `/view`, timeout, error wrapping, and result commit.
- Do not change workflow JSON, nodes, models, prompt text, or routing rules.

### Phase 4: Resource / Preview Adapter

- Add adapters over existing resource and preview state.
- Start read-only, then migrate one call site at a time.
- Prevent AI sequence animation and skeleton animation state pollution.

### Phase 5: Gradual Runtime Module Split

Split by feature domain, one small slice at a time:

- `ui-navigation`
- `ui-dialogs`
- `ui-preview`
- `resources`
- `workflows`
- `export`
- `animation`
- `artboard/drawing`

Every split must keep old entry compatibility and must be individually reversible.

## Phase 0 Exit Criteria

- Baseline docs exist.
- Manual acceptance matrix exists.
- `scripts/novaflow-phase0-check.mjs` exists and is read-only.
- `npm run check:runtime` passes.
- Syntax checks pass for the core Runtime and Electron files.
- `npm run check:entry` is run only when 4783 is already available.
