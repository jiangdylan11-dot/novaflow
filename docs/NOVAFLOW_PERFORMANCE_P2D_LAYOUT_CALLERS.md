# NovaFlow Performance P2D Layout Callers

## Scope

- Phase: Performance P2D runFullLayoutRefresh caller attribution
- Base commit at sampling: `eb0e4648 perf: add layout attribution probe`
- Sample time: 2026-06-30 00:59 ICT (`2026-06-29T17:59:28.795Z`)
- Entry: locked `http://127.0.0.1:4783/`
- Probe: `window.__NFAnimationPerfProbe`, version `20260616-animation-1-5`
- Browser: HeadlessChrome 149 on Windows 10 x64
- Viewport: 1440 x 960

This pass only added caller/reason attribution for `runFullLayoutRefresh` and this report. It did not change refresh conditions, delay values, UI, workflow JSON, Storyboard V5, Prompt Assistant, Electron IPC, resource/preview state, or AI sequence/skeleton switching logic.

During validation, `check:entry` returned `Overall: GO`; direct upstream `8188` probing timed out in that run. The P2D scenarios below only sampled 4783 UI/probe behavior and did not invoke workflow generation.

## Caller Labels

`runFullLayoutRefresh` now records the caller/reason in the existing attribution maps:

- `callsiteCounts.runFullLayoutRefresh.<reason>`
- `callsiteDurations.runFullLayoutRefresh.<reason>`

Supported reason labels include:

- `scheduleFullLayoutRefresh`
- `brandMutationFlush`
- `observedLayoutRefresh`
- `startupLayoutRefreshLoop`
- `direct`
- `direct:forceFull`
- `direct:topbarFileHelpDeferred`
- `unknown`

The probe stores only strings and numbers. It does not store DOM nodes, mutation objects, workflow payloads, images, or resource data URLs.

## Scenario 1: Secondary Entry Switching

Path: primary/secondary navigation switch path: Animation -> AI sequence animation -> Skeleton animation -> Art -> UI -> Drawing.

| Metric | Value |
| --- | ---: |
| Actual duration ms | 10017 |
| `runFullLayoutRefresh` count | 249 |
| `runFullLayoutRefresh` total duration ms | 4973.7 |
| `brandMutationFlushScheduled` count | 249 |
| `brandMutationFlushRun` count | 249 |
| `observedLayoutRefreshScheduled` count | 245 |
| `applyPreviewRuntimeLayout` count | 251 |
| `normalizeNovaflowVisualRhythm` count | 986 |
| `querySelectorAllStar` count | 990 |

`runFullLayoutRefresh` caller ranking:

| Caller / reason | Count | Total duration ms |
| --- | ---: | ---: |
| `brandMutationFlush` | 245 | 4693.2 |
| `direct` | 3 | 49.4 |
| `direct:forceFull` | 1 | 231.1 |
| `scheduleFullLayoutRefresh` | 0 | 0 |
| `observedLayoutRefresh` | 0 | 0 |
| `startupLayoutRefreshLoop` | 0 | 0 |
| `unknown` | 0 | 0 |

The dominant path is `brandMutationFlush -> observed layout refresh -> runFullLayoutRefresh`. The observed layout refresh counter is high, but the run reason is preserved as `brandMutationFlush` because that is where the observed refresh was scheduled.

## Scenario 2: Art Drawing Dialog Open-Close

Path: temporary 64 x 64 source resource, then image upscale, image wash, and canvas resize dialogs opened and closed.

| Metric | Value |
| --- | ---: |
| Actual duration ms | 10020 |
| `runFullLayoutRefresh` count | 182 |
| `runFullLayoutRefresh` total duration ms | 3458.4 |
| `brandMutationFlushScheduled` count | 181 |
| `brandMutationFlushRun` count | 181 |
| `observedLayoutRefreshScheduled` count | 181 |
| `applyPreviewRuntimeLayout` count | 182 |
| `normalizeNovaflowVisualRhythm` count | 729 |
| `querySelectorAllStar` count | 729 |

`runFullLayoutRefresh` caller ranking:

| Caller / reason | Count | Total duration ms |
| --- | ---: | ---: |
| `brandMutationFlush` | 181 | 3440.5 |
| `direct` | 1 | 17.9 |
| `scheduleFullLayoutRefresh` | 0 | 0 |
| `observedLayoutRefresh` | 0 | 0 |
| `startupLayoutRefreshLoop` | 0 | 0 |
| `unknown` | 0 | 0 |

The dialog path has the same dominant source: nearly every full refresh came from mutation flush scheduling an observed layout refresh.

## Summary

P2D narrows the hotspot further:

1. `scheduleFullLayoutRefresh` is not the dominant caller in the sampled hotspots.
2. `startupLayoutRefreshLoop` is not involved in the sampled hotspots.
3. `observedLayoutRefresh` is the immediate execution mechanism, but the caller reason is almost entirely `brandMutationFlush`.
4. The likely expensive loop is repeated DOM mutations produced during layout/style normalization, followed by `brandMutationFlush` scheduling another observed layout refresh.

Highest caller/reason across both scenarios:

| Caller / reason | Combined count | Combined duration ms |
| --- | ---: | ---: |
| `brandMutationFlush` | 426 | 8133.7 |
| `direct` | 4 | 67.3 |
| `direct:forceFull` | 1 | 231.1 |

## P2E First-Cut Recommendation

Do not begin P2E by changing delay values, disabling MutationObserver, reducing refresh globally, or touching AI sequence/skeleton switching.

Recommended first cut:

1. Add one more narrow attribution layer inside `brandMutationFlush` to rank mutation families that lead to observed layout refresh.
2. If the top family is self-generated style/attribute normalization, implement a guarded optimization only for that family: avoid scheduling a new observed layout refresh when the mutation batch is already known to be internal and layout-neutral.
3. Keep the optimization behind existing classification helpers such as internal/stable chrome/topbar overlay categories; do not apply it to resource cards, preview state, dialog business logic, workflow results, or animation mode switching.

Reasoning:

- `brandMutationFlush` accounts for almost all measured `runFullLayoutRefresh` calls in both heavy scenarios.
- The current data does not yet prove which mutation family inside the flush is safe to suppress.
- A narrow mutation-family guard is lower risk than changing global scheduler delays or full layout refresh behavior.

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
