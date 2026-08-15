# NovaFlow Performance P2H Workspace Active Guard

## Scope

- Phase: Performance P2H `WORKSPACE_ACTIVE_ATTR` duplicate writer guard
- Base commit before patch: `54407e70 perf: add workspace active writer attribution`
- Sample time: 2026-06-30 03:17 ICT (`2026-06-29T20:17:38.726Z`)
- Entry: locked `http://127.0.0.1:4783/`
- Probe: `window.__NFAnimationPerfProbe`, version `20260616-animation-1-5`
- Browser: Chrome 149 headless on Windows 10 x64
- Viewport: 1440 x 960

This pass is the first real optimization after the P2A-P2G observation passes. It only guards one idempotent writer:

- `syncSplitWorkspace.setActive`

It does not modify `mountSplitEditorContent.setActive`, `removeSplitWorkspaceSurface.removeActive`, any other attribute writer, MutationObserver scope/filtering, refresh scheduling, delay values, UI, workflow JSON, Storyboard V5, Prompt Assistant, Electron IPC, resource/preview state, or AI sequence/skeleton switching logic.

The sampled page logged upstream `502` resource errors from the local backend path. These samples only exercised locked 4783 UI/probe behavior and did not invoke workflow generation.

## Change

Before P2H, `syncSplitWorkspace()` always wrote:

```js
document.body.setAttribute(WORKSPACE_ACTIVE_ATTR, WORKSPACE_ACTIVE_ATTR_VALUE)
```

P2H adds a same-value guard immediately before that write:

```js
const workspaceActiveAlreadySet = document.body.getAttribute(WORKSPACE_ACTIVE_ATTR) === WORKSPACE_ACTIVE_ATTR_VALUE
recordWorkspaceActiveWriterAttempt('syncSplitWorkspace.setActive', WORKSPACE_ACTIVE_ATTR_VALUE)
if (workspaceActiveAlreadySet) recordWorkspaceActiveWriterSkippedSameValue('syncSplitWorkspace.setActive')
else document.body.setAttribute(WORKSPACE_ACTIVE_ATTR, WORKSPACE_ACTIVE_ATTR_VALUE)
```

The guard only skips `setAttribute` when the body already has the exact value `"1"`.

## New Probe Fields

Counts:

- `counts.workspaceActiveWriterSkippedSameValue`

Callsite attribution:

- `callsiteCounts.workspaceActiveWriterGuard.syncSplitWorkspace.setActive`

P2G attempted/effective counters remain intact:

- `counts.workspaceActiveWriterAttempt`
- `counts.workspaceActiveWriterChanged`
- `counts.workspaceActiveWriterSameValue`
- `callsiteCounts.workspaceActiveWriter.*`
- `callsiteCounts.workspaceActiveWriterResult.*`
- `callsiteCounts.workspaceActiveWriterSameValueByWriter.*`
- `callsiteCounts.workspaceActiveWriterChangedByWriter.*`

## Scenario 1: Secondary Entry Switching

Path: Animation -> AI sequence animation -> Skeleton animation -> Art -> UI -> Drawing.

All actions returned `true`.

| Metric | P2G | P2H | Delta |
| --- | ---: | ---: | ---: |
| `workspaceActiveWriterAttempt` | 243 | 26 | -217 |
| `workspaceActiveWriterChanged` | 3 | 3 | 0 |
| `workspaceActiveWriterSameValue` | 240 | 23 | -217 |
| `workspaceActiveWriterSkippedSameValue` | 0 | 16 | +16 |
| `brandMutationFlushRun` | 238 | 9 | -229 |
| `observedLayoutRefreshScheduled` | 233 | 6 | -227 |
| `runFullLayoutRefresh` | 237 | 11 | -226 |
| `brandMutationFlushFamily.skeleton` | 260 | 26 | -234 |
| `skeletonMutationFlushAttr.data-novaflow-spine-split-workspace-active` | 236 | 3 | -233 |

P2H writer distribution:

| Writer | Attempts | Changed | Same-value | Guard skipped |
| --- | ---: | ---: | ---: | ---: |
| `syncSplitWorkspace.setActive` | 16 | 0 | 16 | 16 |
| `mountSplitEditorContent.setActive` | 2 | 2 | 0 | 0 |
| `removeSplitWorkspaceSurface.removeActive` | 8 | 1 | 7 | 0 |

P2H layout caller distribution:

| Caller/reason | Count |
| --- | ---: |
| `brandMutationFlush` | 6 |
| `direct` | 3 |
| `direct:forceFull` | 1 |
| `direct:topbarFileHelpDeferred` | 1 |

## Scenario 2: Art Drawing Dialog Open-Close

Path: Art -> Drawing -> add temporary 64 x 64 source through the existing debug bridge -> Enhance -> open and close image upscale, image wash, and outpaint dialogs.

All actions returned successfully:

- Image upscale: opened and closed
- Image wash: opened and closed
- Outpaint: opened and closed

| Metric | P2G | P2H | Delta |
| --- | ---: | ---: | ---: |
| `workspaceActiveWriterAttempt` | 206 | 22 | -184 |
| `workspaceActiveWriterChanged` | 0 | 0 | 0 |
| `workspaceActiveWriterSameValue` | 206 | 22 | -184 |
| `workspaceActiveWriterSkippedSameValue` | 0 | 22 | +22 |
| `brandMutationFlushRun` | 203 | 5 | -198 |
| `observedLayoutRefreshScheduled` | 202 | 3 | -199 |
| `runFullLayoutRefresh` | 203 | 4 | -199 |
| `brandMutationFlushFamily.skeleton` | 226 | 13 | -213 |
| `skeletonMutationFlushAttr.data-novaflow-spine-split-workspace-active` | 206 | 0 | -206 |

P2H writer distribution:

| Writer | Attempts | Changed | Same-value | Guard skipped |
| --- | ---: | ---: | ---: | ---: |
| `syncSplitWorkspace.setActive` | 22 | 0 | 22 | 22 |

P2H layout caller distribution:

| Caller/reason | Count |
| --- | ---: |
| `brandMutationFlush` | 3 |
| `direct` | 1 |

## Combined Comparison

| Metric | P2G combined | P2H combined | Delta | Reduction |
| --- | ---: | ---: | ---: | ---: |
| `workspaceActiveWriterAttempt` | 449 | 48 | -401 | 89.3% |
| `workspaceActiveWriterChanged` | 3 | 3 | 0 | 0.0% |
| `workspaceActiveWriterSameValue` | 446 | 45 | -401 | 89.9% |
| `workspaceActiveWriterSkippedSameValue` | 0 | 38 | +38 | n/a |
| `brandMutationFlushRun` | 441 | 14 | -427 | 96.8% |
| `observedLayoutRefreshScheduled` | 435 | 9 | -426 | 97.9% |
| `runFullLayoutRefresh` | 440 | 15 | -425 | 96.6% |
| `brandMutationFlushFamily.skeleton` | 486 | 39 | -447 | 92.0% |
| `skeletonMutationFlushAttr.data-novaflow-spine-split-workspace-active` | 442 | 3 | -439 | 99.3% |

## Interpretation

P2H confirms that guarding only `syncSplitWorkspace.setActive` removes the dominant idempotent `data-novaflow-spine-split-workspace-active` mutation source.

The effective writes stayed unchanged:

- P2G changed writes: `3`
- P2H changed writes: `3`

The sampled same-value writes and downstream refresh churn dropped sharply:

- `data-novaflow-spine-split-workspace-active` skeleton attr mutations: `442 -> 3`
- `brandMutationFlushRun`: `441 -> 14`
- `runFullLayoutRefresh`: `440 -> 15`

This supports the guard as a low-risk performance improvement because it only avoids same-value attribute writes that were already proven ineffective in P2G.

## Regression Check

Observed in the P2H samples:

- Secondary entry switching completed: Animation, AI sequence, Skeleton, Art, UI, Drawing.
- Art Drawing dialog smoke completed: image upscale, image wash, and outpaint dialogs opened and closed.
- `pageErrors`: none.
- Console showed only expected upstream `502 Bad Gateway` resource errors from the unavailable local backend path.

No sampled UI regression was observed.

## Next Step

Recommended P2I:

1. Keep this guard unchanged.
2. Run one manual smoke pass on the same two paths after commit.
3. If still clean, target the next highest remaining mutation family or direct layout caller with another observation-first pass.

Do not broaden optimization into AI sequence/skeleton switching, resource/preview state, MutationObserver scope, refresh delays, or workflow behavior without a new attribution pass.
