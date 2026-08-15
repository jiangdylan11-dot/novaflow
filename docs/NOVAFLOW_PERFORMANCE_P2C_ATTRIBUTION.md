# NovaFlow Performance P2C Attribution

## Scope

- Phase: Performance P2C attribution probe
- Base commit at sampling: `f6fdd97c docs: add performance probe baseline`
- P2A probe commit: `4355d141 perf: add layout refresh probe counters`
- Sample time: 2026-06-30 00:32 ICT (`2026-06-29T17:32:48.076Z`)
- Entry: locked `http://127.0.0.1:4783/`
- Probe: `window.__NFAnimationPerfProbe`, version `20260616-animation-1-5`
- Browser: HeadlessChrome 149 on Windows 10 x64
- Viewport: 1440 x 960

This pass only added probe attribution and this report. It did not change refresh conditions, delays, UI, workflow JSON, Storyboard V5, Prompt Assistant, Electron IPC, resource/preview state, or animation switching logic.

During validation, `check:entry` returned `Overall: GO`; direct upstream `8188` probing timed out in that run. The P2C scenarios below only sampled the 4783 UI/probe path and did not invoke workflow generation.

## Probe Fields Added

The existing `counts` field remains compatible. P2C adds lightweight numeric maps:

- `durationByKey`: total measured duration by probe key.
- `callsiteCounts`: nested count map by key and callsite label.
- `callsiteDurations`: nested duration map by key and callsite label.

The probe stores only strings and numbers. It does not store DOM nodes, large objects, workflow payloads, images, or resource data URLs.

## Sampled Scenarios

Each scenario used:

```js
window.__NFAnimationPerfProbe.start("<label>", { durationMs: 10000 })
```

Then the UI scenario was performed and the report was read through `stop("p2c-read")`.

## Scenario 1: Secondary Entry Switching

Path: `动画 -> AI序列动画 -> 骨骼动画 -> 美工 -> UI -> 绘图`

| Metric | Value |
| --- | ---: |
| Actual duration ms | 10025 |
| `querySelectorAllStar` count | 931 |
| `normalizeNovaflowVisualRhythm` count | 927 |
| `runFullLayoutRefresh` count | 235 |
| `applyPreviewRuntimeLayout` count | 237 |
| `applyAiAnimationSectionLayers` count | 238 |

| Key | Total duration ms |
| --- | ---: |
| `runFullLayoutRefresh` | 5063.5 |
| `applyPreviewRuntimeLayout` | 1707.8 |
| `normalizeNovaflowVisualRhythm` | 1172.1 |
| `applyAiAnimationSectionLayers` | 545.6 |
| `querySelectorAllStar` | 14.3 |

Top callsite counts:

| Key | Callsite | Count |
| --- | --- | ---: |
| `querySelectorAllStar` | `normalizeNovaflowRectRadii.descendants` | 927 |
| `querySelectorAllStar` | `applyAiAnimationBorderlessFrames.bodyStar` | 4 |
| `runFullLayoutRefresh` | `runFullLayoutRefresh` | 234 |
| `runFullLayoutRefresh` | `runFullLayoutRefresh:forceFull` | 1 |
| `applyPreviewRuntimeLayout` | `applyPreviewRuntimeLayout` | 237 |
| `applyAiAnimationSectionLayers` | `applyAiAnimationSectionLayers` | 238 |

Top callsite durations:

| Key | Callsite | Duration ms |
| --- | --- | ---: |
| `runFullLayoutRefresh` | `runFullLayoutRefresh` | 4754.2 |
| `runFullLayoutRefresh` | `runFullLayoutRefresh:forceFull` | 309.3 |
| `applyPreviewRuntimeLayout` | `applyPreviewRuntimeLayout` | 1707.8 |
| `normalizeNovaflowVisualRhythm` | `normalizeNovaflowVisualRhythm` | 1172.1 |
| `applyAiAnimationSectionLayers` | `applyAiAnimationSectionLayers` | 545.6 |
| `querySelectorAllStar` | `normalizeNovaflowRectRadii.descendants` | 14.2 |

## Scenario 2: Art Drawing Dialog Open-Close

Path: temporary 64 x 64 source resource, then `高清放大 -> 洗图 -> 无限扩图` dialogs opened and closed.

| Metric | Value |
| --- | ---: |
| Actual duration ms | 10021 |
| `querySelectorAllStar` count | 703 |
| `normalizeNovaflowVisualRhythm` count | 703 |
| `runFullLayoutRefresh` count | 175 |
| `applyPreviewRuntimeLayout` count | 175 |
| `applyAiAnimationSectionLayers` count | 175 |

| Key | Total duration ms |
| --- | ---: |
| `runFullLayoutRefresh` | 3446.6 |
| `applyPreviewRuntimeLayout` | 1060.4 |
| `normalizeNovaflowVisualRhythm` | 870.9 |
| `applyAiAnimationSectionLayers` | 92.6 |
| `querySelectorAllStar` | 13.4 |

Top callsite counts:

| Key | Callsite | Count |
| --- | --- | ---: |
| `querySelectorAllStar` | `normalizeNovaflowRectRadii.descendants` | 703 |
| `normalizeNovaflowVisualRhythm` | `normalizeNovaflowVisualRhythm` | 703 |
| `runFullLayoutRefresh` | `runFullLayoutRefresh` | 175 |
| `applyPreviewRuntimeLayout` | `applyPreviewRuntimeLayout` | 175 |
| `applyAiAnimationSectionLayers` | `applyAiAnimationSectionLayers` | 175 |

Top callsite durations:

| Key | Callsite | Duration ms |
| --- | --- | ---: |
| `runFullLayoutRefresh` | `runFullLayoutRefresh` | 3446.6 |
| `applyPreviewRuntimeLayout` | `applyPreviewRuntimeLayout` | 1060.4 |
| `normalizeNovaflowVisualRhythm` | `normalizeNovaflowVisualRhythm` | 870.9 |
| `applyAiAnimationSectionLayers` | `applyAiAnimationSectionLayers` | 92.6 |
| `querySelectorAllStar` | `normalizeNovaflowRectRadii.descendants` | 13.4 |

## Attribution Summary

The highest count source is stable across both sampled scenarios:

- `querySelectorAllStar` is almost entirely from `normalizeNovaflowRectRadii.descendants`.
- However, direct `querySelectorAll("*")` duration is low: 14.3 ms in secondary switching and 13.4 ms in dialog open-close.
- The user-visible cost is more likely the repeated full refresh family around `runFullLayoutRefresh`, `applyPreviewRuntimeLayout`, and `normalizeNovaflowVisualRhythm`, not the selector call itself.

Highest total duration:

1. Secondary switching: `runFullLayoutRefresh` total 5063.5 ms.
2. Dialog open-close: `runFullLayoutRefresh` total 3446.6 ms.
3. Secondary switching: `applyPreviewRuntimeLayout` total 1707.8 ms.
4. Secondary switching: `normalizeNovaflowVisualRhythm` total 1172.1 ms.
5. Dialog open-close: `applyPreviewRuntimeLayout` total 1060.4 ms.

## P2D First Cut Recommendation

Do not start P2D by changing delay values, MutationObserver behavior, animation/skeleton switching, resource state, preview state, or dialog business logic.

Recommended P2D first cut:

1. Add caller/reason attribution for the high-frequency `runFullLayoutRefresh` invocations coming through observed layout refresh and mutation flush.
2. If that confirms repeated same-frame or same-surface refreshes, make the first real optimization a narrow same-frame/idempotent guard around the visual rhythm / rectangle-radius normalization path.

Reasoning:

- P2C proves the broad selector count is a symptom of repeated normalization, not the dominant duration by itself.
- The expensive unit is repeated `runFullLayoutRefresh`, especially when it cascades into `applyPreviewRuntimeLayout` and `normalizeNovaflowVisualRhythm`.
- A scheduler or delay rewrite would be higher risk than a guarded normalization pass and could affect modal layering, Help, animation, and preview surfaces.

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
