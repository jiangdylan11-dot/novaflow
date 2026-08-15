# NovaFlow Performance P2K Preview Surface Leaf Attribution

## Scope

- Phase: P2K
- Baseline commit before this change: `4efc5e62 perf: add layout substep attribution`
- Sampling time: 2026-06-30 03:35 ICT
- Runtime surface: locked `http://127.0.0.1:4783/`
- Browser automation: headless Chrome via Playwright, viewport `1440x1000`
- Change type: probe-only attribution

This phase only adds leaf-level duration attribution inside the existing
`applyAiAnimationSectionLayers.previewSurface` timing bucket. It does not change
refresh conditions, delays, UI, workflow JSON, Storyboard V5, Prompt Assistant,
Electron IPC, resource state, preview state, or AI sequence / skeleton switching
logic.

Environment note: `check:entry` returned `Overall: GO`; `127.0.0.1:8188`
health/direct probe timed out through the existing runtime health path. The P2K
sampling is DOM/layout probe sampling on `4783`, so the 8188 health state was
recorded but did not block this measurement.

## Added Leaf Steps

The existing `previewSurface` wrapper remains in place. The following fixed
leaf step names were added under
`layoutStepCounts.applyAiAnimationSectionLayers` and
`layoutStepDurations.applyAiAnimationSectionLayers`:

- `positionTopModeTabs`
- `markWorkspaceLayout`
- `ensureBottomWorkspace`
- `stylePlaceholderDropzones`
- `syncPostSectionStableHeight`
- `setModeSectionHeight`
- `applyBorderlessFrames`
- `earlyStructureLayout`
- `processingStateClasses`

No DOM nodes or large objects are stored by the probe.

## Scenario 1: AI Sequence -> Skeleton -> AI Sequence

Label: `p2k-ai-skeleton-ai`

| Metric | Count | Duration ms |
| --- | ---: | ---: |
| `runFullLayoutRefresh` | 1 | 216.0 |
| `applyPreviewRuntimeLayout` | 4 | 274.6 |
| `applyAiAnimationSectionLayers` | 7 | 550.2 |
| `normalizeNovaflowVisualRhythm` | 4 | 63.0 |
| `querySelectorAllStar` | 11 | 0.8 |
| `brandMutationFlushRun` | 13 | - |
| `observedLayoutRefreshScheduled` | 0 | - |

### Preview Surface Leaf Ranking

| Leaf step | Count | Duration ms |
| --- | ---: | ---: |
| `earlyStructureLayout` | 7 | 146.9 |
| `markWorkspaceLayout` | 7 | 93.3 |
| `ensureBottomWorkspace` | 7 | 43.4 |
| `positionTopModeTabs` | 14 | 12.8 |
| `applyBorderlessFrames` | 7 | 12.8 |
| `stylePlaceholderDropzones` | 7 | 5.5 |
| `syncPostSectionStableHeight` | 7 | 1.8 |
| `processingStateClasses` | 7 | 1.0 |
| `setModeSectionHeight` | 7 | 0.0 |

Top non-leaf sibling buckets in `applyAiAnimationSectionLayers`:

| Step | Count | Duration ms |
| --- | ---: | ---: |
| `previewSurface` | 21 | 317.7 |
| `locateSections` | 7 | 138.5 |
| `misc` | 21 | 49.3 |
| `syncStateMachine` | 14 | 27.9 |
| `resourceCards` | 7 | 16.2 |

## Scenario 2: Secondary Entry Switches

Label: `p2k-secondary-switches`

Path: `动画 -> AI序列动画 -> 骨骼动画 -> 美工 -> UI -> 绘图`

| Metric | Count | Duration ms |
| --- | ---: | ---: |
| `runFullLayoutRefresh` | 10 | 378.4 |
| `applyPreviewRuntimeLayout` | 12 | 255.5 |
| `applyAiAnimationSectionLayers` | 13 | 366.7 |
| `normalizeNovaflowVisualRhythm` | 40 | 103.7 |
| `querySelectorAllStar` | 44 | 0.9 |
| `brandMutationFlushRun` | 11 | - |
| `observedLayoutRefreshScheduled` | 6 | - |

### Preview Surface Leaf Ranking

| Leaf step | Count | Duration ms |
| --- | ---: | ---: |
| `earlyStructureLayout` | 4 | 96.8 |
| `markWorkspaceLayout` | 4 | 56.5 |
| `ensureBottomWorkspace` | 4 | 27.4 |
| `applyBorderlessFrames` | 4 | 9.0 |
| `positionTopModeTabs` | 8 | 8.4 |
| `stylePlaceholderDropzones` | 4 | 3.8 |
| `syncPostSectionStableHeight` | 4 | 1.0 |
| `processingStateClasses` | 4 | 0.8 |
| `setModeSectionHeight` | 4 | 0.0 |

Top non-leaf sibling buckets in `applyAiAnimationSectionLayers`:

| Step | Count | Duration ms |
| --- | ---: | ---: |
| `previewSurface` | 12 | 203.9 |
| `locateSections` | 13 | 104.1 |
| `misc` | 30 | 32.1 |
| `syncStateMachine` | 8 | 18.0 |
| `resourceCards` | 4 | 8.0 |

## Findings

The highest preview surface leaf is consistently `earlyStructureLayout`:

- AI sequence roundtrip: `146.9ms`
- Secondary entry switches: `96.8ms`

The next two contributors are also stable:

- `markWorkspaceLayout`
- `ensureBottomWorkspace`

`querySelectorAllStar` remains low in direct duration after the P2H guard. The
current issue is no longer broad mutation frequency; it is a smaller number of
layout passes where AI animation layout structure functions perform meaningful
work.

## Minimal Optimization Candidate

Do not directly optimize `applyAiAnimationEarlyStructureLayout` yet. It combines
mode checks, resource-sidebar lookup, workspace layout marking, bottom workspace
ensuring, placeholder styling, and deferred refresh scheduling. Those branches
can affect AI sequence / skeleton isolation, so a direct guard would be higher
risk.

The first safe next step is one more attribution pass inside
`applyAiAnimationEarlyStructureLayout`, with leaf timings and attempted/effective
writer counters for idempotent DOM writes. The current P2K data suggests that
any real P2L optimization should target a proven repeated same-value write or
same-layout mark inside `earlyStructureLayout`, not the whole function.

## P2L Recommendation

Phase P2L should be observation-only:

1. Add leaf-level attribution inside `applyAiAnimationEarlyStructureLayout`.
2. Separate at least:
   - `resourceSidebarLookup`
   - `entryLightThrottle`
   - `workspaceSignalCheck`
   - `claimBottomWorkspace`
   - `markEntryLeftPanel`
   - `markWorkspaceLayout`
   - `ensureBottomWorkspace`
   - `stylePlaceholderDropzones`
   - `deferredFullRefreshSchedule`
3. Add writer attempted/effective/same-value counters only where the writer is
   already using or can safely be observed next to `setAttributeIfChanged`.
4. Do not add a new guard until the probe proves an idempotent repeated writer.

Suggested P2L first instruction:

> Execute NovaFlow Performance Phase P2L: add leaf-level attribution inside
> `applyAiAnimationEarlyStructureLayout` and attempted/effective writer counters
> for its idempotent layout markers. Observation only; no behavior change, no new
> guard, no UI/state/workflow changes.

## Validation Commands

- `node --check particle-editor/novaflow-brand-runtime.js`
- `npm run phase0:check`
- `npm run check:runtime`
- `npm run check:entry`
- `node --check particle-editor/spine-split-runtime.js`
- `node --check particle-editor/aifx-repaint-runtime.js`
- `node --check particle-editor-desktop/main.js`
