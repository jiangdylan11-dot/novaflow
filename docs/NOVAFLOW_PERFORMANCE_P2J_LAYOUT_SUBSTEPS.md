# NovaFlow Performance P2J Layout Substeps

## Scope

- Phase: Performance P2J layout substep attribution
- Base commit before patch: `ecf5d3d4 docs: add post workspace guard performance baseline`
- Sample time: 2026-06-30 03:29 ICT (`2026-06-29T20:29:21.455Z`)
- Entry: locked `http://127.0.0.1:4783/`
- Upstream: `http://127.0.0.1:8188/`
- Probe: `window.__NFAnimationPerfProbe`, version `20260616-animation-1-5`
- Browser: Chrome 149 headless on Windows 10 x64
- Viewport: 1440 x 960

This pass only adds substep duration attribution and this report. It does not change refresh conditions, delay values, scheduling, UI, workflow JSON, Storyboard V5, Prompt Assistant, Electron IPC, resource/preview state, AI sequence/skeleton switching logic, or optimization behavior.

Environment note:

- Locked `4783` was reachable and `check:entry` reported `Overall: GO`.
- `8188` continued to report health/direct-probe timeouts and the page logged upstream `502 Bad Gateway` resource errors. This does not block the DOM/layout attribution samples because no real workflow generation was invoked.
- `pageErrors`: none.

## New Probe Fields

The probe now exposes two additional fields while preserving the existing `counts`, `durationByKey`, `callsiteCounts`, and `callsiteDurations` fields:

- `layoutStepCounts.<functionName>.<stepName>`
- `layoutStepDurations.<functionName>.<stepName>`

Only fixed string function/step labels are recorded. No DOM nodes, large objects, prompt data, workflow data, or resource data are stored.

## Instrumented Functions

### `applyAiAnimationSectionLayers`

Substeps:

- `locateSections`
- `readRects`
- `syncStateMachine`
- `resourceCards`
- `previewSurface`
- `misc`

### `applyPreviewRuntimeLayout`

Substeps:

- `locatePreview`
- `applyShell`
- `syncModals`
- `syncAiLayers`
- `exportLayering`
- `misc`

## Scenario 1: AI Sequence -> Skeleton -> AI Sequence

Actions:

- Animation entry: PASS
- AI sequence entry: PASS
- Skeleton entry: PASS
- AI sequence return: PASS

Core counters:

| Metric | Value |
| --- | ---: |
| Duration ms | 10007 |
| `scheduleFullLayoutRefresh` | 1 |
| `brandMutationFlushRun` | 10 |
| `observedLayoutRefreshScheduled` | 1 |
| `runFullLayoutRefresh` | 3 |
| `applyPreviewRuntimeLayout` | 6 |
| `applyAiAnimationSectionLayers` | 9 |
| `syncAiSequenceBoardStateMachine` | 12 |
| `normalizeNovaflowVisualRhythm` | 12 |
| `querySelectorAllStar` | 20 |

Function duration totals:

| Function | Duration ms |
| --- | ---: |
| `applyAiAnimationSectionLayers` | 824.7 |
| `applyPreviewRuntimeLayout` | 449.9 |
| `runFullLayoutRefresh` | 546.6 |
| `normalizeNovaflowVisualRhythm` | 186.2 |
| `querySelectorAllStar` | 1.1 |

`applyAiAnimationSectionLayers` substeps:

| Rank | Substep | Count | Duration ms |
| ---: | --- | ---: | ---: |
| 1 | `previewSurface` | 24 | 488.2 |
| 2 | `locateSections` | 9 | 193.3 |
| 3 | `misc` | 26 | 74.1 |
| 4 | `syncStateMachine` | 16 | 43.5 |
| 5 | `resourceCards` | 8 | 24.7 |
| 6 | `readRects` | 8 | 0.5 |

`applyPreviewRuntimeLayout` substeps:

| Rank | Substep | Count | Duration ms |
| ---: | --- | ---: | ---: |
| 1 | `syncAiLayers` | 6 | 405.6 |
| 2 | `applyShell` | 6 | 30.8 |
| 3 | `syncModals` | 6 | 5.2 |
| 4 | `exportLayering` | 6 | 4.1 |
| 5 | `misc` | 12 | 2.6 |
| 6 | `locatePreview` | 6 | 1.3 |

## Scenario 2: Secondary Entry Switching

Actions:

- Animation entry: PASS
- AI sequence entry: PASS
- Skeleton entry: PASS
- Art entry: PASS
- Art UI entry: PASS
- Art Drawing entry: PASS

Core counters:

| Metric | Value |
| --- | ---: |
| Duration ms | 10006 |
| `scheduleFullLayoutRefresh` | 2 |
| `brandMutationFlushRun` | 9 |
| `observedLayoutRefreshScheduled` | 7 |
| `runFullLayoutRefresh` | 11 |
| `applyPreviewRuntimeLayout` | 12 |
| `applyAiAnimationSectionLayers` | 12 |
| `syncAiSequenceBoardStateMachine` | 2 |
| `normalizeNovaflowVisualRhythm` | 44 |
| `querySelectorAllStar` | 46 |
| `workspaceActiveWriterSkippedSameValue` | 17 |

Function duration totals:

| Function | Duration ms |
| --- | ---: |
| `runFullLayoutRefresh` | 363.0 |
| `applyAiAnimationSectionLayers` | 174.6 |
| `applyPreviewRuntimeLayout` | 145.3 |
| `normalizeNovaflowVisualRhythm` | 122.4 |
| `querySelectorAllStar` | 1.4 |

`applyAiAnimationSectionLayers` substeps:

| Rank | Substep | Count | Duration ms |
| ---: | --- | ---: | ---: |
| 1 | `previewSurface` | 6 | 99.0 |
| 2 | `locateSections` | 12 | 49.0 |
| 3 | `misc` | 26 | 18.2 |
| 4 | `syncStateMachine` | 4 | 4.5 |
| 5 | `resourceCards` | 2 | 3.6 |
| 6 | `readRects` | 2 | 0.1 |

`applyPreviewRuntimeLayout` substeps:

| Rank | Substep | Count | Duration ms |
| ---: | --- | ---: | ---: |
| 1 | `syncAiLayers` | 12 | 115.9 |
| 2 | `applyShell` | 12 | 15.5 |
| 3 | `exportLayering` | 12 | 7.4 |
| 4 | `syncModals` | 12 | 4.0 |
| 5 | `misc` | 24 | 1.2 |
| 6 | `locatePreview` | 12 | 1.0 |

## Interpretation

The highest `applyPreviewRuntimeLayout` substep is `syncAiLayers`, but that bucket mostly wraps the existing AI section layout call. It should not be optimized directly as a preview-layout concern.

The highest true child bucket is:

- `applyAiAnimationSectionLayers.previewSurface`

This bucket is still a grouped step. It includes preview/workspace surface work such as top mode tab positioning, workspace layout markers, bottom workspace sync, placeholder/dropzone styling, post-section stable-height sync, borderless frame styling, early structure layout, and processing state classes.

The next relevant bucket is:

- `applyAiAnimationSectionLayers.locateSections`

This bucket includes section/root discovery and early structure layout. It is not currently proven to be redundant or safely skippable.

Low-priority buckets:

- `readRects` is negligible in both scenarios.
- `querySelectorAllStar` duration remains tiny relative to the layout buckets.
- `syncModals`, `exportLayering`, and `misc` in `applyPreviewRuntimeLayout` are not current top targets.

## P2K Recommendation

Do not start P2K by changing delays, MutationObserver scope, refresh scheduling, AI sequence/skeleton switching, or resource/preview state.

Recommended P2K first pass:

1. Add one more attribution layer inside `applyAiAnimationSectionLayers.previewSurface`.
2. Split fixed substeps around the existing calls:
   - `positionTopModeTabs`
   - `markWorkspaceLayout`
   - `ensureBottomWorkspace`
   - `stylePlaceholderDropzones`
   - `syncPostSectionStableHeight`
   - `setModeSectionHeight`
   - `applyBorderlessFrames`
   - `earlyStructureLayout`
   - `processingStateClasses`
3. Re-sample the same two P2J scenarios.
4. Only after that, consider a real optimization on the single proven idempotent substep.

Reason:

- `previewSurface` is the top bucket, but it is still too broad for a safe optimization.
- `syncAiLayers` is not a leaf cause; it is a wrapper around AI layout work.
- The previous successful P2H optimization worked because P2G proved a single idempotent writer. P2K should follow the same evidence standard.

## Verification Commands

Run after adding this report:

```powershell
node --check particle-editor/novaflow-brand-runtime.js
npm run phase0:check
npm run check:runtime
npm run check:entry
node --check particle-editor/spine-split-runtime.js
node --check particle-editor/aifx-repaint-runtime.js
node --check particle-editor-desktop/main.js
```
