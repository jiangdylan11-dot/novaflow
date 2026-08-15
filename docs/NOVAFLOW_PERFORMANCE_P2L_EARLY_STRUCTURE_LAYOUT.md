# NovaFlow Performance P2L Early Structure Layout Attribution

## Scope

- Phase: P2L
- Baseline commit before this change: `11115c91 perf: add preview surface leaf attribution`
- Sampling time: 2026-06-30 03:42 ICT
- Runtime surface: locked `http://127.0.0.1:4783/`
- Browser automation: headless Chrome via Playwright, viewport `1440x1000`
- Change type: probe-only attribution

This phase only adds leaf-level duration attribution inside
`applyAiAnimationEarlyStructureLayout` and lightweight attempted / changed /
same-value counters for selected layout marker writers. It does not change
refresh conditions, delays, UI, workflow JSON, Storyboard V5, Prompt Assistant,
Electron IPC, resource state, preview state, or AI sequence / skeleton switching
logic. No guard or optimization was added.

Environment note: `check:entry` returned `Overall: GO`; `127.0.0.1:8188`
health/direct probe timed out through the existing runtime health path. The P2L
sampling is DOM/layout probe sampling on `4783`, so the 8188 health state was
recorded but did not block this measurement.

## Added Attribution

### Leaf Step Timings

Added fixed step names under:

- `layoutStepCounts.applyAiAnimationEarlyStructureLayout`
- `layoutStepDurations.applyAiAnimationEarlyStructureLayout`

Observed step names:

- `locateResourceArea`
- `locateWorkspace`
- `entryLightThrottle`
- `markWorkspace`
- `markResourceArea`
- `ensureBottomWorkspace`
- `stylePlaceholderDropzones`
- `scheduleDeferredRefresh`
- `positionTopModeTabs`
- `misc`

### Layout Marker Writer Counters

Added lightweight counters through existing `callsiteCounts`:

- `layoutMarkerWriterAttempt`
- `layoutMarkerWriterMarker`
- `layoutMarkerWriterPair`
- `layoutMarkerWriterChanged`
- `layoutMarkerWriterSameValue`

The sampled writer families were intentionally limited to the highest-risk
direct markers in `applyAiAnimationEarlyStructureLayout`:

- `applyAiAnimationEarlyStructureLayout.claimBottomWorkspace`
  - `class:novaflow-ai-animation-section-layers`
  - `class:novaflow-ai-bottom-workspace-active`
- `applyAiAnimationEarlyStructureLayout.markWorkspaceLayout`
  - `data-novaflow-ai-main-workspace`
  - `data-novaflow-ai-resource-sidebar-host`
- `applyAiAnimationEarlyStructureLayout.ensureBottomWorkspace`
  - `data-novaflow-ai-bottom-workspace`

No DOM nodes or large objects are stored in the probe. Marker values are read
only when the perf probe is active.

## Scenario 1: AI Sequence -> Skeleton -> AI Sequence

Label: `p2l-ai-skeleton-ai`

| Metric | Count | Duration ms |
| --- | ---: | ---: |
| `runFullLayoutRefresh` | 1 | 221.4 |
| `applyPreviewRuntimeLayout` | 4 | 301.3 |
| `applyAiAnimationSectionLayers` | 7 | 647.0 |
| `normalizeNovaflowVisualRhythm` | 4 | 65.1 |
| `querySelectorAllStar` | 11 | 0.5 |
| `brandMutationFlushRun` | 12 | - |
| `observedLayoutRefreshScheduled` | 0 | - |

### Early Structure Leaf Ranking

| Leaf step | Count | Duration ms |
| --- | ---: | ---: |
| `markResourceArea` | 14 | 125.2 |
| `markWorkspace` | 14 | 113.1 |
| `ensureBottomWorkspace` | 14 | 100.3 |
| `stylePlaceholderDropzones` | 14 | 36.1 |
| `locateResourceArea` | 16 | 2.1 |
| `locateWorkspace` | 16 | 0.2 |
| `misc` | 61 | 0.0 |

### Layout Marker Writer Results

| Writer marker pair | Attempt | Changed | Same-value |
| --- | ---: | ---: | ---: |
| `claimBottomWorkspace.class:novaflow-ai-animation-section-layers` | 14 | 0 | 14 |
| `claimBottomWorkspace.class:novaflow-ai-bottom-workspace-active` | 14 | 0 | 14 |
| `markWorkspaceLayout.data-novaflow-ai-main-workspace` | 14 | 0 | 14 |
| `markWorkspaceLayout.data-novaflow-ai-resource-sidebar-host` | 14 | 0 | 14 |
| `ensureBottomWorkspace.data-novaflow-ai-bottom-workspace` | 14 | 0 | 14 |

## Scenario 2: Secondary Entry Switches

Label: `p2l-secondary-switches`

Path: `Animation -> AI Sequence -> Skeleton -> Art -> UI -> Drawing`

| Metric | Count | Duration ms |
| --- | ---: | ---: |
| `runFullLayoutRefresh` | 10 | 386.5 |
| `applyPreviewRuntimeLayout` | 12 | 263.2 |
| `applyAiAnimationSectionLayers` | 13 | 361.8 |
| `normalizeNovaflowVisualRhythm` | 40 | 109.1 |
| `querySelectorAllStar` | 44 | 1.0 |
| `brandMutationFlushRun` | 12 | - |
| `observedLayoutRefreshScheduled` | 6 | - |

### Early Structure Leaf Ranking

| Leaf step | Count | Duration ms |
| --- | ---: | ---: |
| `markResourceArea` | 9 | 90.0 |
| `markWorkspace` | 9 | 71.3 |
| `ensureBottomWorkspace` | 9 | 64.4 |
| `stylePlaceholderDropzones` | 9 | 23.4 |
| `locateResourceArea` | 9 | 0.4 |
| `misc` | 33 | 0.1 |
| `locateWorkspace` | 9 | 0.1 |

### Layout Marker Writer Results

| Writer marker pair | Attempt | Changed | Same-value |
| --- | ---: | ---: | ---: |
| `claimBottomWorkspace.class:novaflow-ai-animation-section-layers` | 9 | 0 | 9 |
| `claimBottomWorkspace.class:novaflow-ai-bottom-workspace-active` | 9 | 0 | 9 |
| `markWorkspaceLayout.data-novaflow-ai-main-workspace` | 9 | 0 | 9 |
| `markWorkspaceLayout.data-novaflow-ai-resource-sidebar-host` | 9 | 0 | 9 |
| `ensureBottomWorkspace.data-novaflow-ai-bottom-workspace` | 9 | 0 | 9 |

## Findings

The highest `applyAiAnimationEarlyStructureLayout` leaf is consistently
`markResourceArea`:

- AI sequence roundtrip: `125.2ms`
- Secondary entry switches: `90.0ms`

The next contributors are also stable:

- `markWorkspace`
- `ensureBottomWorkspace`
- `stylePlaceholderDropzones`

For the selected layout marker writers, both sampled scenarios produced:

- Attempted writes: `115`
- Changed writes: `0`
- Same-value writes: `115`
- Same-value ratio: `100%`

This confirms that the selected marker writes are idempotent in these two
scenarios. It does not prove that the full `markResourceArea` function can be
skipped. That function still performs geometry reads, resource sidebar styling,
resource duration label sync, bottom workspace discovery, and preview geometry
sync, so a broad function-level guard would be too risky.

## Guard Readiness

Confirmed safe candidate class:

- Converting proven same-value raw marker writes to an existing guarded write
  path, such as `setAttributeIfChanged`, is likely low risk.

Not confirmed safe:

- Skipping `markAiAnimationWorkspaceLayout` as a whole.
- Skipping `claimAiAnimationEntryBottomWorkspaceLayout` as a whole.
- Skipping `ensureAiAnimationBottomWorkspaceFromPreviewRoot` as a whole.
- Changing deferred refresh scheduling.
- Changing AI sequence / skeleton isolation logic.

## P2M Recommendation

Phase P2M should be the smallest real optimization after P2L:

1. Target only `markAiAnimationWorkspaceLayout`.
2. Replace the proven same-value raw marker writes with the existing guarded
   helper:
   - `workspace.setAttribute("data-novaflow-ai-main-workspace", "1")`
   - `resource.host.setAttribute("data-novaflow-ai-resource-sidebar-host", "1")`
   - optionally include `resource.panel.setAttribute("data-novaflow-ai-resource-sidebar-panel", "1")` only if the diff remains tiny and equivalent.
3. Do not skip the function.
4. Do not change layout reads, resource/card sync, preview geometry sync, refresh
   scheduling, or AI sequence / skeleton switching.
5. Keep the existing P2L writer counters and resample the same two scenarios.

Suggested P2M first instruction:

> Execute NovaFlow Performance Phase P2M: in `markAiAnimationWorkspaceLayout`,
> replace only the proven duplicate raw `setAttribute(..., "1")` layout marker
> writes with existing `setAttributeIfChanged`. Do not skip the function, do not
> change refresh scheduling, layout logic, UI, resource/preview state, workflow,
> Storyboard, Prompt Assistant, or AI sequence / skeleton switching. Validate and
> resample against P2L.

## Validation Commands

- `node --check particle-editor/novaflow-brand-runtime.js`
- `npm run phase0:check`
- `npm run check:runtime`
- `npm run check:entry`
- `node --check particle-editor/spine-split-runtime.js`
- `node --check particle-editor/aifx-repaint-runtime.js`
- `node --check particle-editor-desktop/main.js`
