# NovaFlow Performance P2M Workspace Layout Marker Guard

## Scope

- Phase: P2M
- Baseline commit before this change: `cb987d81 perf: add early structure layout attribution`
- Sampling time: 2026-06-30 03:48 ICT
- Runtime surface: locked `http://127.0.0.1:4783/`
- Browser automation: headless Chrome via Playwright, viewport `1440x1000`
- Change type: small performance optimization

This phase changes only the proven duplicate marker writes inside
`markAiAnimationWorkspaceLayout`. It does not skip
`markAiAnimationWorkspaceLayout`, does not skip
`applyAiAnimationEarlyStructureLayout`, and does not change layout reads, refresh
scheduling, delays, MutationObserver, UI, workflow JSON, Storyboard V5, Prompt
Assistant, Electron IPC, resource state, preview state, or AI sequence /
skeleton switching logic.

Environment note: `check:entry` returned `Overall: GO`; `127.0.0.1:8188`
health/direct probe timed out through the existing runtime health path. The P2M
sampling is DOM/layout probe sampling on `4783`, so the 8188 health state was
recorded but did not block this measurement.

## Modification

Added a small guarded marker setter:

- `setAttributeIfChangedWithLayoutMarkerGuard(element, name, value, writerName)`

Behavior:

1. Read the current attribute value.
2. If the value already matches, skip `setAttribute` and record:
   - `layoutMarkerWriterSkippedSameValue`
   - `layoutMarkerWriterGuard`
3. If the value differs, call the existing `setAttributeIfChanged`.

Only these `markAiAnimationWorkspaceLayout` markers were changed:

| Marker | Previous behavior | New behavior |
| --- | --- | --- |
| `data-novaflow-ai-main-workspace="1"` | raw `setAttribute` | guarded |
| `data-novaflow-ai-resource-sidebar-host="1"` | raw `setAttribute` | guarded |
| `data-novaflow-ai-resource-sidebar-panel="1"` | raw `setAttribute` | guarded |

All style writes, geometry reads, resource/card sync, preview geometry sync, and
subsequent layout logic remain unchanged.

## Scenario 1: AI Sequence -> Skeleton -> AI Sequence

Label: `p2m-ai-skeleton-ai`

### Core Counter Comparison

| Metric | P2L | P2M | Delta |
| --- | ---: | ---: | ---: |
| `runFullLayoutRefresh` count | 1 | 1 | 0 |
| `runFullLayoutRefresh` duration ms | 221.4 | 245.1 | +23.7 |
| `applyPreviewRuntimeLayout` duration ms | 301.3 | 296.6 | -4.7 |
| `applyAiAnimationSectionLayers` duration ms | 647.0 | 627.4 | -19.6 |
| `applyAiAnimationSectionLayers.previewSurface` ms | 386.0 | 372.5 | -13.5 |
| `applyAiAnimationSectionLayers.earlyStructureLayout` ms | 174.3 | 166.2 | -8.1 |
| `querySelectorAllStar` duration ms | 0.5 | 0.6 | +0.1 |

### Early Structure Leaf Comparison

| Leaf step | P2L ms | P2M ms | Delta |
| --- | ---: | ---: | ---: |
| `markResourceArea` | 125.2 | 129.4 | +4.2 |
| `markWorkspace` | 113.1 | 110.5 | -2.6 |
| `ensureBottomWorkspace` | 100.3 | 97.0 | -3.3 |
| `stylePlaceholderDropzones` | 36.1 | 34.8 | -1.3 |

### Guard Counters

| Guarded marker | Skipped same-value |
| --- | ---: |
| `data-novaflow-ai-main-workspace` | 21 |
| `data-novaflow-ai-resource-sidebar-host` | 21 |
| `data-novaflow-ai-resource-sidebar-panel` | 21 |
| Total guarded skips | 63 |

## Scenario 2: Secondary Entry Switches

Label: `p2m-secondary-switches`

Path: `Animation -> AI Sequence -> Skeleton -> Art -> UI -> Drawing`

### Core Counter Comparison

| Metric | P2L | P2M | Delta |
| --- | ---: | ---: | ---: |
| `runFullLayoutRefresh` count | 10 | 10 | 0 |
| `runFullLayoutRefresh` duration ms | 386.5 | 395.5 | +9.0 |
| `applyPreviewRuntimeLayout` duration ms | 263.2 | 252.4 | -10.8 |
| `applyAiAnimationSectionLayers` duration ms | 361.8 | 362.1 | +0.3 |
| `applyAiAnimationSectionLayers.previewSurface` ms | 203.3 | 201.8 | -1.5 |
| `applyAiAnimationSectionLayers.earlyStructureLayout` ms | 94.5 | 96.2 | +1.7 |
| `querySelectorAllStar` duration ms | 1.0 | 0.9 | -0.1 |

### Early Structure Leaf Comparison

| Leaf step | P2L ms | P2M ms | Delta |
| --- | ---: | ---: | ---: |
| `markResourceArea` | 90.0 | 88.6 | -1.4 |
| `markWorkspace` | 71.3 | 68.1 | -3.2 |
| `ensureBottomWorkspace` | 64.4 | 67.1 | +2.7 |
| `stylePlaceholderDropzones` | 23.4 | 23.8 | +0.4 |

### Guard Counters

| Guarded marker | Skipped same-value |
| --- | ---: |
| `data-novaflow-ai-main-workspace` | 13 |
| `data-novaflow-ai-resource-sidebar-host` | 13 |
| `data-novaflow-ai-resource-sidebar-panel` | 13 |
| Total guarded skips | 39 |

## Combined P2L vs P2M

| Metric | P2L | P2M | Delta |
| --- | ---: | ---: | ---: |
| Selected marker attempts | 115 | 115 | 0 |
| Selected marker changed | 0 | 0 | 0 |
| Selected marker same-value | 115 | 115 | 0 |
| Guarded same-value skips | 0 | 102 | +102 |
| `runFullLayoutRefresh` count | 11 | 11 | 0 |
| `applyAiAnimationSectionLayers.previewSurface` ms | 589.3 | 574.3 | -15.0 |
| `applyAiAnimationSectionLayers.earlyStructureLayout` ms | 268.8 | 262.4 | -6.4 |
| `markResourceArea` ms | 215.2 | 218.0 | +2.8 |
| `markWorkspace` ms | 184.4 | 178.6 | -5.8 |
| `ensureBottomWorkspace` ms | 164.7 | 164.1 | -0.6 |

## Result

The guard is active and prevented `102` repeated same-value marker writes across
the two sampled scenarios.

Performance effect is small and mixed:

- `previewSurface` improved by `15.0ms` combined.
- `earlyStructureLayout` improved by `6.4ms` combined.
- `markWorkspace` improved by `5.8ms` combined.
- `markResourceArea` was roughly flat and slightly higher by `2.8ms` combined.
- `runFullLayoutRefresh` count did not change.

This is expected for this phase: P2M removes redundant marker mutations but does
not reduce refresh scheduling, layout reads, resource/card sync, or the broader
`markResourceArea` work.

## Regression Notes

- Browser automation successfully clicked both sampled paths.
- No page errors were recorded.
- Console still showed existing `502 Bad Gateway` resource messages tied to the
  upstream health state, consistent with `check:entry` notes.
- No UI behavior regression was observed in the sampled navigation paths.

## Next Recommendation

Do not add a broader guard around `markAiAnimationWorkspaceLayout` yet.

Phase P2N should be observation-first or extremely narrow:

1. Add targeted attribution inside `markAiAnimationWorkspaceLayout` itself,
   separating:
   - geometry / `getBoundingClientRect`
   - resource sidebar styling
   - resource preview action styling
   - resource duration label sync
   - bottom workspace candidate scan
   - main stage candidate scan
2. If an obvious repeated same-value style writer is found, convert only that
   writer to an existing guarded helper.
3. Do not skip the whole function and do not change refresh scheduling.

Suggested P2N first instruction:

> Execute NovaFlow Performance Phase P2N: add leaf-level attribution inside
> `markAiAnimationWorkspaceLayout` to identify whether geometry reads, resource
> sidebar styling, resource duration labels, or bottom/main stage candidate scans
> dominate. Observation only unless a single already-guarded style writer can be
> converted without changing behavior.

## Validation Commands

- `node --check particle-editor/novaflow-brand-runtime.js`
- `npm run phase0:check`
- `npm run check:runtime`
- `npm run check:entry`
- `node --check particle-editor/spine-split-runtime.js`
- `node --check particle-editor/aifx-repaint-runtime.js`
- `node --check particle-editor-desktop/main.js`
