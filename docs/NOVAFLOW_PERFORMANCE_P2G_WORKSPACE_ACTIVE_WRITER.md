# NovaFlow Performance P2G Workspace Active Writer

## Scope

- Phase: Performance P2G `WORKSPACE_ACTIVE_ATTR` writer attribution
- Base commit at sampling: `0cfc854f perf: add skeleton mutation writer attribution`
- Sample time: 2026-06-30 03:09 ICT (`2026-06-29T20:09:51.002Z`)
- Entry: locked `http://127.0.0.1:4783/`
- Probe: `window.__NFAnimationPerfProbe`, version `20260616-animation-1-5`
- Browser: Chrome 149 headless on Windows 10 x64
- Viewport: 1440 x 960

This pass only added attempted/effective writer attribution for `WORKSPACE_ACTIVE_ATTR` in `spine-split-runtime.js` and this report. It did not skip any writes, add writer guards, change attribute values, change write conditions, change refresh conditions, change delay values, alter MutationObserver behavior, modify UI, workflow JSON, Storyboard V5, Prompt Assistant, Electron IPC, resource/preview state, or AI sequence/skeleton switching logic.

The sampled page logged upstream `502` resource errors from the local backend path. These samples only exercised 4783 UI/probe behavior and did not invoke workflow generation.

## New Probe Fields

Counts:

- `counts.workspaceActiveWriterAttempt`
- `counts.workspaceActiveWriterChanged`
- `counts.workspaceActiveWriterSameValue`

Callsite attribution:

- `callsiteCounts.workspaceActiveWriter.<writerName>`
- `callsiteCounts.workspaceActiveWriterValue.<value>`
- `callsiteCounts.workspaceActiveWriterResult.<changed|same-value>`
- `callsiteCounts.workspaceActiveWriterChangedByWriter.<writerName>`
- `callsiteCounts.workspaceActiveWriterSameValueByWriter.<writerName>`

Observed writer labels:

- `mountSplitEditorContent.setActive`
- `syncSplitWorkspace.setActive`
- `removeSplitWorkspaceSurface.removeActive`

The writer probe records only strings and numbers. It reads the current body attribute value before the existing write, then lets the original `setAttribute` or `removeAttribute` run unchanged.

## Writer Points

The `WORKSPACE_ACTIVE_ATTR` definition is:

- `data-novaflow-spine-split-workspace-active`

The sampled writer points are:

| Writer | Operation | Value |
| --- | --- | --- |
| `mountSplitEditorContent.setActive` | `setAttribute` | `1` |
| `syncSplitWorkspace.setActive` | `setAttribute` | `1` |
| `removeSplitWorkspaceSurface.removeActive` | `removeAttribute` | `null` |

## Scenario 1: Secondary Entry Switching

Path: Animation -> AI sequence animation -> Skeleton animation -> Art -> UI -> Drawing.

| Metric | Value |
| --- | ---: |
| Actual duration ms | 10027 |
| `workspaceActiveWriterAttempt` | 243 |
| `workspaceActiveWriterChanged` | 3 |
| `workspaceActiveWriterSameValue` | 240 |
| Same-value ratio | 98.8% |
| `brandMutationFlushScheduled` | 238 |
| `brandMutationFlushRun` | 238 |
| `observedLayoutRefreshScheduled` | 233 |
| `runFullLayoutRefresh` | 237 |
| `runFullLayoutRefresh` via `brandMutationFlush` | 233 |

Writer ranking:

| Writer | Attempts |
| --- | ---: |
| `syncSplitWorkspace.setActive` | 233 |
| `removeSplitWorkspaceSurface.removeActive` | 8 |
| `mountSplitEditorContent.setActive` | 2 |

Changed writes:

| Writer | Changed count |
| --- | ---: |
| `mountSplitEditorContent.setActive` | 2 |
| `removeSplitWorkspaceSurface.removeActive` | 1 |

Same-value writes:

| Writer | Same-value count |
| --- | ---: |
| `syncSplitWorkspace.setActive` | 233 |
| `removeSplitWorkspaceSurface.removeActive` | 7 |

Value distribution:

| Value | Count |
| --- | ---: |
| `true` | 235 |
| `null` | 8 |

Related mutation attribution:

| Metric | Count |
| --- | ---: |
| `brandMutationFlushFamily.skeleton` | 260 |
| `skeletonMutationFlushAttr.data-novaflow-spine-split-workspace-active` | 236 |
| `skeletonMutationFlushTarget.body.novaflow-primary-target-art` | 236 |

## Scenario 2: Art Drawing Dialog Open-Close

Path: Art -> Drawing -> Enhance panel -> image upscale, image wash, and outpaint dialogs opened and closed. A temporary 64 x 64 source resource was added through the existing debug bridge and then deleted after sampling.

| Metric | Value |
| --- | ---: |
| Actual duration ms | 10034 |
| `workspaceActiveWriterAttempt` | 206 |
| `workspaceActiveWriterChanged` | 0 |
| `workspaceActiveWriterSameValue` | 206 |
| Same-value ratio | 100.0% |
| `brandMutationFlushScheduled` | 203 |
| `brandMutationFlushRun` | 203 |
| `observedLayoutRefreshScheduled` | 202 |
| `runFullLayoutRefresh` | 203 |
| `runFullLayoutRefresh` via `brandMutationFlush` | 202 |

Writer ranking:

| Writer | Attempts |
| --- | ---: |
| `syncSplitWorkspace.setActive` | 206 |

Changed writes:

| Writer | Changed count |
| --- | ---: |
| none | 0 |

Same-value writes:

| Writer | Same-value count |
| --- | ---: |
| `syncSplitWorkspace.setActive` | 206 |

Value distribution:

| Value | Count |
| --- | ---: |
| `true` | 206 |

Related mutation attribution:

| Metric | Count |
| --- | ---: |
| `brandMutationFlushFamily.skeleton` | 226 |
| `skeletonMutationFlushAttr.data-novaflow-spine-split-workspace-active` | 206 |
| `skeletonMutationFlushTarget.body.novaflow-primary-target-art` | 190 |
| `skeletonMutationFlushTarget.body.novaflow-primary-target-art.novaflow-art-drawing-entering` | 16 |

All three dialog interactions opened one dialog and closed it successfully:

- Image upscale: opened `1`, closed successfully
- Image wash: opened `1`, closed successfully
- Outpaint: opened `1`, closed successfully

## Combined Result

| Metric | Combined count |
| --- | ---: |
| Attempts | 449 |
| Changed | 3 |
| Same-value | 446 |
| Same-value ratio | 99.3% |

Combined writer attempts:

| Writer | Attempts |
| --- | ---: |
| `syncSplitWorkspace.setActive` | 439 |
| `removeSplitWorkspaceSurface.removeActive` | 8 |
| `mountSplitEditorContent.setActive` | 2 |

Combined changed writes:

| Writer | Changed count |
| --- | ---: |
| `mountSplitEditorContent.setActive` | 2 |
| `removeSplitWorkspaceSurface.removeActive` | 1 |
| `syncSplitWorkspace.setActive` | 0 |

Combined same-value writes:

| Writer | Same-value count |
| --- | ---: |
| `syncSplitWorkspace.setActive` | 439 |
| `removeSplitWorkspaceSurface.removeActive` | 7 |

Combined value distribution:

| Value | Count |
| --- | ---: |
| `true` | 441 |
| `null` | 8 |

## Interpretation

P2G confirms that the high-frequency `data-novaflow-spine-split-workspace-active` mutations are overwhelmingly same-value writes.

The dominant source is:

- `syncSplitWorkspace.setActive`: `439` attempts, `0` effective changes, `439` same-value writes

This supports a narrow writer-side optimization candidate, but P2G itself intentionally did not implement it.

## P2H First-Cut Recommendation

Recommended first optimization:

1. Add a minimal guard only around `syncSplitWorkspace.setActive`.
2. Before calling `document.body.setAttribute(WORKSPACE_ACTIVE_ATTR, WORKSPACE_ACTIVE_ATTR_VALUE)`, check whether the body already has that exact value.
3. If it is already `"1"`, skip only that idempotent `setAttribute` call.

Do not change:

- `mountSplitEditorContent.setActive`
- `removeSplitWorkspaceSurface.removeActive`
- MutationObserver scope or filters
- Refresh scheduling or delay values
- AI sequence/skeleton switching logic
- Resource/preview state

Reasoning:

- `syncSplitWorkspace.setActive` produced `439 / 449` writer attempts across the sampled scenarios.
- It produced `0` effective changes in the samples.
- A same-value guard at this writer is narrower and safer than scheduler throttling.
- Keeping mount/remove writes unchanged preserves real state transitions.

## Validation Commands

```powershell
node --check particle-editor/spine-split-runtime.js
npm run phase0:check
npm run check:runtime
npm run check:entry
node --check particle-editor/novaflow-brand-runtime.js
node --check particle-editor/aifx-repaint-runtime.js
node --check particle-editor-desktop/main.js
```
