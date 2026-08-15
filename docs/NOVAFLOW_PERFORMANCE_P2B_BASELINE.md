# NovaFlow Performance P2B Probe Baseline

## Scope

- Phase: Performance P2B baseline sampling
- Commit: `4355d141 perf: add layout refresh probe counters`
- Sample time: 2026-06-30 00:18 ICT (`2026-06-29T17:18:17.587Z`)
- Entry: locked `http://127.0.0.1:4783/`
- Upstream: `http://127.0.0.1:8188/`
- Probe: `window.__NFAnimationPerfProbe`, version `20260616-animation-1-5`
- Browser: HeadlessChrome 149 on Windows 10 x64
- Viewport: 1440 x 960

This pass only sampled runtime behavior and added this report. It did not change Runtime, UI, workflow JSON, Storyboard V5, Prompt Assistant, Electron IPC, or optimization logic.

## Method

Each scenario used:

```js
window.__NFAnimationPerfProbe.start("<label>", { durationMs: 10000 })
```

The scenario action was performed in the 4783 page and the probe was then read with `stop("p2b-read")`. The drawing dialog scenario used a temporary in-page 64 x 64 data URL source resource through the existing split bridge so the real dialogs could open; no repository file was written.

## Probe Data

| Scenario | Duration ms | scheduleFullLayoutRefresh | startupLayoutRefreshTick | brandMutationFlushScheduled | brandMutationFlushRun | observedLayoutRefreshScheduled | runFullLayoutRefresh | applyPreviewRuntimeLayout | applyAiAnimationSectionLayers | syncAiSequenceBoardStateMachine | normalizeNovaflowVisualRhythm | querySelectorAllStar |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Startup idle | 10011 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Primary switches: effects / animation / art / tools / repository / export | 10008 | 5 | 0 | 23 | 23 | 18 | 22 | 23 | 24 | 5 | 88 | 91 |
| Secondary switches: AI sequence / skeleton / art UI / art drawing | 10044 | 2 | 0 | 248 | 248 | 245 | 250 | 252 | 253 | 7 | 989 | 994 |
| Art drawing dialogs: upscale / wash / expand open-close | 10161 | 1 | 0 | 170 | 170 | 170 | 171 | 171 | 171 | 0 | 673 | 673 |
| AI sequence to skeleton and back | 10001 | 1 | 0 | 11 | 11 | 1 | 4 | 7 | 10 | 13 | 25 | 34 |

## Scenario Notes

| Scenario | Operation result | Notes |
| --- | --- | --- |
| Startup idle | PASS | No full layout refresh counters fired after page settled. Idle still showed interval counters outside the focus set, mainly `numberInputOverlaySync`, `spineImportButtonInterval`, and `rangeFillInterval`. |
| Primary switches | PASS | All primary entries clicked successfully. Export opened the protected/export path and was closed during sampling. |
| Secondary switches | PASS | AI sequence, skeleton, art UI, and art drawing entries clicked successfully. This was the highest-count scenario. |
| Art drawing dialogs | PASS | A temporary source image was added in the headless session. `高清放大`, `洗图`, and `无限扩图` each opened a visible dialog and were closed. |
| AI sequence / skeleton roundtrip | PASS | The roundtrip was much lower than broad secondary switching, but still triggered state-machine and resource-card scan counters. |

## Highest Counters

| Rank | Scenario | Counter | Count |
| ---: | --- | --- | ---: |
| 1 | Secondary switches | `querySelectorAllStar` | 994 |
| 2 | Secondary switches | `normalizeNovaflowVisualRhythm` | 989 |
| 3 | Secondary switches | `brandMutationFlushScheduled` / `brandMutationFlushRun` | 248 / 248 |
| 4 | Secondary switches | `runFullLayoutRefresh` | 250 |
| 5 | Art drawing dialogs | `querySelectorAllStar` | 673 |
| 6 | Art drawing dialogs | `normalizeNovaflowVisualRhythm` | 673 |
| 7 | Art drawing dialogs | `brandMutationFlushScheduled` / `brandMutationFlushRun` | 170 / 170 |
| 8 | Art drawing dialogs | `runFullLayoutRefresh` | 171 |

The same cost family repeats in the two heaviest scenarios:

- mutation flush scheduling repeatedly reaches observed layout refresh
- observed layout refresh repeatedly reaches full layout refresh
- full layout refresh repeatedly reaches preview layout and AI animation layer sync
- visual rhythm normalization and broad query counting scale with those refreshes

## Likely User-Visible Hotspots

1. Secondary entry switching is the strongest candidate for visible stutter. It produced the highest `runFullLayoutRefresh`, `applyPreviewRuntimeLayout`, `applyAiAnimationSectionLayers`, `normalizeNovaflowVisualRhythm`, and `querySelectorAllStar` counts.
2. Art drawing dialog open-close is the second strongest candidate. Even simple modal open-close produced 170+ full refresh family calls and 673 broad DOM scan/normalization counts.
3. AI sequence to skeleton roundtrip is lower than expected in this sampled path. It still has state-machine work, but it is not the top P2C target from this probe data.
4. Startup idle is not currently a layout-refresh hotspot after the page is settled. Continuous interval counters exist, but the P2A layout refresh counters stayed at zero.

## P2C Recommendation

Do not start P2C by changing delays, animation/skeleton switching, resource state, preview state, workflow logic, or Dialog behavior.

Recommended first cut:

1. Read-only locate the call chain from `observedLayoutRefreshScheduled` to `runFullLayoutRefresh` for secondary switching and art dialog open-close.
2. Add duration attribution or a narrow callsite tag for `querySelectorAllStar` and `normalizeNovaflowVisualRhythm` before changing behavior.
3. If the callsite data confirms the same repeated path, make the first optimization a small same-frame/idempotent guard around broad visual normalization, not a scheduler rewrite.

Why this order:

- The highest counts are broad DOM scan and visual normalization counters, not the startup loop.
- Scheduler changes are higher risk because they can affect Help, modal layering, animation surfaces, and preview layout.
- A callsite/duration pass keeps P2C measurable and gives a clean before/after target for a later minimal optimization.

## Verification Commands

Run after adding this report:

```powershell
npm run phase0:check
npm run check:runtime
npm run check:entry
```
