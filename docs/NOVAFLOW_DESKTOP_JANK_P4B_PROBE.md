# NovaFlow Desktop Jank P4B Probe

## Current commit

- Baseline before P4B: `8df488dc37765e6635d50c39e7915c4f26a8e4a3`
- Scope: add observation-only jank probe in `particle-editor/novaflow-brand-runtime.js`

## Probe API

`window.__NFJankProbe` is disabled by default and can be enabled with `?nfJankProbe=1`.

- `start(label, options)`
- `stop(reason)`
- `snapshot()`
- `reset()`

The probe keeps data in memory and prints reports to console. It does not write files and does not store DOM node references.

## Metrics

- Click/pointer marker: timestamp, entry label, desktop/window label, body class before.
- Click response: `clickToActiveClassMs`, `clickToFirstMutationMs`, `clickToNextFrameMs`, `clickToLayoutStableMs`, body class after.
- Long Task: `longTaskCount50`, `longTaskCount100`, `longTaskCount300`, max and total duration.
- rAF gap: `rafGapCount50`, `rafGapCount100`, `rafGapCount300`, max gap.
- Mutation: first/last mutation time, mutation count, mutation family counts.
- Function markers: `normalizeNovaflowVisualRhythm`, `applyAiAnimationSectionLayers`, `applyPreviewRuntimeLayout`, `runFullLayoutRefresh`, `scheduleFullLayoutRefresh`, `skeletonTimelineRaf`, `topbarFileHelpDeferred`.
- Optional merge: `window.__NFAnimationPerfProbe` snapshot when present.

`aifx-repaint-runtime.js` was not modified in P4B because this round only allowed changes in `novaflow-brand-runtime.js`; AIFX internals are not directly marked here.

## Sampling environment

- Target: Desktop Electron win-unpacked renderer.
- Readback: Electron CDP on port `9234`.
- Input used for the final data table: Chromium `Input.dispatchMouseEvent` against the Desktop Electron renderer.
- Important limitation: OS-level Win32/Computer Use clicks either did not reach DOM pointer capture or switched state through an automation path without DOM click markers. Therefore this P4B table is a controlled Desktop renderer pointer-event validation, not a strict real-mouse manual A/B baseline.
- rAF limitation: in the automated/occluded desktop state, rAF did not tick reliably. `clickToNextFrameMs`, `clickToLayoutStableMs`, and rAF gap columns are therefore not usable from this run.

## Desktop sampling summary

| Scenario | Runs | Interactions | Mean click-to-active | Mean click-to-first-mutation | Mean click-to-next-frame | Mean layout-stable | Mean Long Task >50 | Mean Long Task max | Mean rAF gap >50 | Mean rAF gap max | Mean mutations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| effects-entry | 3 | 3 | 285.8 ms | 0.8 ms | n/a | n/a | 2.3 | 157.0 ms | 0 | 0 ms | 347.3 |
| animation-entry | 3 | 3 | 161.2 ms | 21.2 ms | n/a | n/a | 1.3 | 155.3 ms | 0 | 0 ms | 783.0 |
| animation-effects-animation | 3 | 3 | 291.9 ms | 0.9 ms | n/a | n/a | 2.0 | 151.7 ms | 0 | 0 ms | 284.7 |
| ai-sequence-skeleton-ai-sequence | 3 | 3 | n/a | 52.6 ms | n/a | n/a | 2.0 | 112.0 ms | 0 | 0 ms | 96.7 |

## Long Task / rAF result

- Long Task is supported in this Electron renderer and produced consistent hits.
- Effects entry produced the highest click-to-active result in this controlled run, around `286 ms`.
- Animation entry produced the largest mutation volume, around `783` mutations per sample.
- Long Task max stayed around `112-157 ms`; no `>300 ms` Long Task appeared in this run.
- rAF gap data is not conclusive because the automated desktop state did not reliably run the rAF sampler.

## First function after click

| Scenario | First function after click | First blocked function |
| --- | --- | --- |
| effects-entry | `scheduleFullLayoutRefresh` in 3/3 | none captured |
| animation-entry | `scheduleFullLayoutRefresh` in 3/3 | none captured |
| animation-effects-animation | `scheduleFullLayoutRefresh` in 3/3 | none captured |
| ai-sequence-skeleton-ai-sequence | none captured | none captured |

`scheduleFullLayoutRefresh` is the first observable function marker after primary entry clicks. This does not mean it is the whole jank source; it marks the first scheduled renderer work after the click. Long Task attribution still needs deeper correlation with layout/paint timing.

## Error notes

- Runtime exceptions: `0`
- Console errors: `0`
- CDP log warning/error entries appeared in some samples, but no runtime exception or console error was captured. These should be classified separately in P4C before treating them as page errors.

## Current judgment

P4B confirms P3 was looking at the wrong layer for user-perceived jank. The meaningful new signals are:

- Click-to-active for effects is around `286 ms` in controlled Desktop pointer sampling.
- Click-to-active for animation is around `161 ms`, but animation creates a much larger mutation burst.
- Long Tasks around `100-160 ms` occur shortly after entry clicks.
- The first observable renderer marker after primary clicks is `scheduleFullLayoutRefresh`.

The current P4B automation cannot rigorously answer first paint/next frame or layout stable, because rAF is paused or throttled in the captured desktop state. It also cannot replace true foreground hand sampling.

## P4C first cut recommendation

Do not optimize yet.

P4C should first harden the jank probe and sampling path:

1. Add a non-rAF fallback for `clickToNextFrameMs` / layout stable, such as `setTimeout(0)` plus mutation-idle timing, while keeping rAF when foreground sampling is available.
2. Split multi-hop scenarios into per-leg samples: animation -> effects and effects -> animation should each get their own probe window.
3. Add Long Task correlation fields: nearest interaction id, nearest function marker before/after the Long Task, and Long Task start offset from click.
4. Add foreground/manual sampling instructions for real OS mouse use, because automated Computer Use did not generate DOM pointer markers.
5. Only after P4C confirms first Long Task attribution should optimization begin. The current likely first optimization target is still around full layout refresh scheduling after entry clicks, but P4B is not enough to change scheduling.
