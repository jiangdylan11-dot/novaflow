# NovaFlow Performance P2F Skeleton Writers

## Scope

- Phase: Performance P2F skeleton mutation attribute/writer attribution
- Base commit at sampling: `82dafa10 perf: add mutation family attribution`
- Sample time: 2026-06-30 02:56 ICT (`2026-06-29T19:56:26.162Z`)
- Entry: locked `http://127.0.0.1:4783/`
- Probe: `window.__NFAnimationPerfProbe`, version `20260616-animation-1-5`
- Browser: Chrome 149 headless on Windows 10 x64
- Viewport: 1440 x 960

This pass only added attribution for skeleton-family attribute mutations and this report. It did not change MutationObserver scope, mutation filtering, refresh conditions, delay values, writer conditions, writer values, UI, workflow JSON, Storyboard V5, Prompt Assistant, Electron IPC, resource/preview state, or AI sequence/skeleton switching logic.

The sampled page logged upstream `502` resource errors from the local backend path. These samples only exercised 4783 UI/probe behavior and did not invoke workflow generation.

## New Probe Fields

Observer-side skeleton attribute attribution:

- `callsiteCounts.skeletonMutationAttr.<attributeName>`
- `callsiteCounts.skeletonMutationSuspect.<suspect>`
- `callsiteCounts.skeletonMutationTarget.<targetSummary>`
- `callsiteCounts.skeletonMutationDataAttr.<dataAttributeName>`

Flush-side skeleton attribute attribution:

- `callsiteCounts.skeletonMutationFlushAttr.<attributeName>`
- `callsiteCounts.skeletonMutationFlushSuspect.<suspect>`
- `callsiteCounts.skeletonMutationFlushTarget.<targetSummary>`
- `callsiteCounts.skeletonMutationFlushDataAttr.<dataAttributeName>`

Brand-runtime writer-side attribution, available only for brand-owned writes:

- `callsiteCounts.skeletonWriter.<writerName>`
- `callsiteCounts.skeletonWriterAttr.<attributeName>`

The probe stores only strings and numbers. It does not store DOM nodes, mutation objects, layout rectangles, large payloads, images, resource data URLs, or workflow data. It does not read layout or call `getBoundingClientRect`.

## Writer Scope

P2F only modified `particle-editor/novaflow-brand-runtime.js`. The actual writer for `data-novaflow-spine-split-workspace-active` is in `particle-editor/spine-split-runtime.js`, which was out of scope for this round.

Safe writer-side probe was added only around the brand-owned `data-novaflow-spine-split-hidden-display` set/remove path in `markSkeletonSidebar`. The sampled hotspots did not hit that writer.

## Scenario 1: Secondary Entry Switching

Path: Animation -> AI sequence animation -> Skeleton animation -> Art -> UI -> Drawing.

| Metric | Value |
| --- | ---: |
| Actual duration ms | 10036 |
| `brandMutationFlushScheduled` count | 224 |
| `brandMutationFlushRun` count | 224 |
| `observedLayoutRefreshScheduled` count | 218 |
| `runFullLayoutRefresh` count | 223 |
| `runFullLayoutRefresh` via `brandMutationFlush` | 218 |
| `brandMutationFamily` count | 443 |
| `brandMutationFlushFamily` count | 327 |

Skeleton family ranking:

| Family metric | Count |
| --- | ---: |
| `brandMutationFamily.skeleton` | 246 |
| `brandMutationFlushFamily.skeleton` | 245 |

Skeleton attribute ranking:

| Attribute | Observer count | Flush count |
| --- | ---: | ---: |
| `data-novaflow-spine-split-workspace-active` | 221 | 221 |

Skeleton suspect ranking:

| Suspect | Observer count | Flush count |
| --- | ---: | ---: |
| `workspaceActive` | 221 | 221 |

Skeleton target ranking:

| Target | Observer count | Flush count |
| --- | ---: | ---: |
| `body.novaflow-primary-target-art` | 221 | 221 |

Skeleton data-attribute context:

| Data attribute | Observer count | Flush count |
| --- | ---: | ---: |
| `data-novaflow-shell-runtime-adapter` | 221 | 221 |
| `data-novaflow-window-focused` | 221 | 221 |
| `data-novaflow-spine-import-menu-prelocked` | 221 | 221 |
| `data-novaflow-spine-split-workspace-active` | 220 | 220 |
| `data-novaflow-art-generate-route-hold` | 149 | 149 |

Writer ranking:

| Writer | Count |
| --- | ---: |
| Brand-owned hidden-display writer | 0 |

## Scenario 2: Art Drawing Dialog Open-Close

Path: Art -> Drawing -> Enhance panel -> image upscale, image wash, and outpaint dialogs opened and closed. A temporary 64 x 64 source resource was added through the existing debug bridge and then deleted after sampling.

| Metric | Value |
| --- | ---: |
| Actual duration ms | 10040 |
| `brandMutationFlushScheduled` count | 219 |
| `brandMutationFlushRun` count | 219 |
| `observedLayoutRefreshScheduled` count | 218 |
| `runFullLayoutRefresh` count | 219 |
| `runFullLayoutRefresh` via `brandMutationFlush` | 218 |
| `brandMutationFamily` count | 244 |
| `brandMutationFlushFamily` count | 244 |

Skeleton family ranking:

| Family metric | Count |
| --- | ---: |
| `brandMutationFamily.skeleton` | 242 |
| `brandMutationFlushFamily.skeleton` | 242 |

Skeleton attribute ranking:

| Attribute | Observer count | Flush count |
| --- | ---: | ---: |
| `data-novaflow-spine-split-workspace-active` | 222 | 222 |

Skeleton suspect ranking:

| Suspect | Observer count | Flush count |
| --- | ---: | ---: |
| `workspaceActive` | 222 | 222 |

Skeleton target ranking:

| Target | Observer count | Flush count |
| --- | ---: | ---: |
| `body.novaflow-primary-target-art` | 207 | 207 |
| `body.novaflow-primary-target-art.novaflow-art-drawing-entering` | 15 | 15 |

Skeleton data-attribute context:

| Data attribute | Observer count | Flush count |
| --- | ---: | ---: |
| `data-novaflow-shell-runtime-adapter` | 222 | 222 |
| `data-novaflow-window-focused` | 222 | 222 |
| `data-novaflow-spine-import-menu-prelocked` | 222 | 222 |
| `data-novaflow-spine-split-workspace-active` | 222 | 222 |
| `data-novaflow-art-generate-route-hold` | 100 | 100 |

Writer ranking:

| Writer | Count |
| --- | ---: |
| Brand-owned hidden-display writer | 0 |

All three dialog interactions opened one dialog and closed it successfully:

- Image upscale: opened `1`, closed successfully
- Image wash: opened `1`, closed successfully
- Outpaint: opened `1`, closed successfully

## Combined Ranking

Combined skeleton attribute ranking:

| Attribute | Combined observer count | Combined flush count |
| --- | ---: | ---: |
| `data-novaflow-spine-split-workspace-active` | 443 | 443 |

Combined skeleton suspect ranking:

| Suspect | Combined observer count | Combined flush count |
| --- | ---: | ---: |
| `workspaceActive` | 443 | 443 |

Combined skeleton target ranking:

| Target | Combined observer count | Combined flush count |
| --- | ---: | ---: |
| `body.novaflow-primary-target-art` | 428 | 428 |
| `body.novaflow-primary-target-art.novaflow-art-drawing-entering` | 15 | 15 |

Combined writer ranking:

| Writer | Combined count |
| --- | ---: |
| Brand-owned `markSkeletonSidebar.setHiddenDisplay` | 0 |
| Brand-owned `markSkeletonSidebar.removeHiddenDisplay` | 0 |

## Interpretation

P2F confirms that the sampled skeleton-family hotspot is not broadly distributed across skeleton-related attributes. It is concentrated on one attribute:

- `data-novaflow-spine-split-workspace-active`

The target is the document body while the active primary surface is Art:

- `body.novaflow-primary-target-art`
- `body.novaflow-primary-target-art.novaflow-art-drawing-entering`

The brand-owned `data-novaflow-spine-split-hidden-display` writer did not fire during these samples, so it is not the current first optimization target.

This round does not prove the writes are redundant by itself. It proves the repeated mutation source is the body-level workspace-active attribute observed by `brandMutationFlush`. The writer is in `spine-split-runtime.js`, which was intentionally not modified in P2F.

## P2G First-Cut Recommendation

Do not begin P2G by changing scheduler delays, suppressing `brandMutationFlush`, disabling MutationObserver, or changing AI sequence/skeleton switching behavior.

Recommended first cut:

1. Perform a very small, read-only or probe-only pass in `spine-split-runtime.js` around the `WORKSPACE_ACTIVE_ATTR` writer.
2. Record attempted writes versus effective value changes for `data-novaflow-spine-split-workspace-active`.
3. Only if the data proves repeated idempotent writes, implement a guarded writer-side optimization: skip `setAttribute(WORKSPACE_ACTIVE_ATTR, "1")` when the body already has that value.

Reasoning:

- `data-novaflow-spine-split-workspace-active` accounts for `443 / 443` combined skeleton attribute mutations in these samples.
- The target is consistently `body`, not scattered panel nodes.
- A writer-side idempotent check is narrower and safer than throttling the refresh queue.
- This still must be treated carefully because the attribute is part of split workspace and animation/skeleton isolation.

## Validation Commands

```powershell
node --check particle-editor/novaflow-brand-runtime.js
npm run phase0:check
npm run check:runtime
npm run check:entry
node --check particle-editor/spine-split-runtime.js
node --check particle-editor/aifx-repaint-runtime.js
node --check particle-editor-desktop/main.js
```
