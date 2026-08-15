# NovaFlow Desktop Performance P3C Manual Baseline

## Scope

- Phase: Desktop Performance P3C manual baseline
- Baseline commit: `eb6d1aee65d7005cf2e3cfda0a058fccf154ea4f`
- Sampling mode: Desktop Electron real window, real mouse input, probe readback from in-memory runtime APIs
- Probe APIs:
  - `window.__NFDesktopPerfProbe`
  - `window.__NFAnimationPerfProbe`
- Sample window: about 8-10 seconds per sample
- Sample count: 15 Desktop manual samples
- Report-only pass: no Runtime, UI, workflow, Storyboard, Prompt Assistant, Electron IPC, scheduler, MutationObserver, or performance optimization changes.

## Stop Reason

P3C stopped during the Web visible Chrome comparison attempt because Windows Computer Use could not verify the visible Chrome `4783` URL with enough confidence to continue browser UI automation. After that stop, this closeout intentionally does not continue Desktop or browser automation sampling.

This report is therefore based only on the completed Desktop real-mouse samples. The Web comparison below references P3B data and is not treated as strict A/B evidence.

## Desktop Manual Sampling Coverage

| Scenario | Samples | Action path |
| --- | ---: | --- |
| Particle / effects entry | 3 | animation -> effects |
| Animation primary entry | 3 | effects -> animation |
| AI sequence animation | 3 | animation -> skeleton -> AI sequence |
| Skeleton animation | 3 | animation -> AI sequence -> skeleton |
| Animation -> effects -> animation | 3 | effects -> animation -> effects -> animation |

## Desktop Sample Summary

Mean values across each 3-sample scenario:

| Scenario | `runFullLayoutRefresh` | `applyPreviewRuntimeLayout` | `applyAiAnimationSectionLayers` | `normalizeNovaflowVisualRhythm` | `querySelectorAllStar` | `electronAPI` methods | Page errors | Console errors |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| Particle / effects entry | 652.8ms | 139.7ms | 6.4ms | 676.2ms | 1.3ms | none | 0 | 3 |
| Animation primary entry | 784.6ms | 607.8ms | 793.3ms | 230.4ms | 1.4ms | none | 0 | 3 |
| AI sequence animation | 0ms | 187.5ms | 572.7ms | 0ms | 0.3ms | none | 0 | 3 |
| Skeleton animation | 0ms | 4.4ms | 0ms | 0ms | 0ms | none | 0 | 8 |
| Animation -> effects -> animation | 2401.1ms | 1435.5ms | 1670.3ms | 1179.2ms | 4.9ms | none | 0 | 6 |

The recurring console errors observed during Desktop sampling were:

- `Failed to load resource: net::ERR_FILE_NOT_FOUND`
- `Failed to load resource: net::ERR_CONNECTION_REFUSED`

No page exceptions were captured in the Desktop samples.

## Electron API Result

`__NFDesktopPerfProbe` did not capture completed `electronAPI` method records in any of the 15 Desktop manual samples. This repeats the P3B result.

Current conclusion: the sampled entry-switch stutter is not currently proven to be caused by Electron IPC. The stronger evidence points to renderer-side layout, visual rhythm normalization, preview layout, and animation layer synchronization.

This does not prove Electron IPC has zero cost in every path. It only means the real-mouse P3C switch samples did not show IPC as the active hotspot.

## Particle / Effects Hotspot

Particle / effects entry remains dominated by the full layout / visual rhythm path:

- `normalizeNovaflowVisualRhythm`: about `676.2ms`
- `runFullLayoutRefresh`: about `652.8ms`
- `numberInputOverlaySync`: about `264` counts per sample
- `brandMutationFlushRun`: about `4` counts per sample

Interpretation:

- The effects entry is not spending meaningful time in AI animation layer work.
- The visible lag candidate is broad renderer refresh and visual normalization work.
- P3D should split `normalizeNovaflowVisualRhythm` into sub-steps before any optimization.

## Animation Primary Hotspot

Animation primary entry is dominated by animation layer and preview layout work:

- `applyAiAnimationSectionLayers`: about `793.3ms`
- `runFullLayoutRefresh`: about `784.6ms`
- `applyPreviewRuntimeLayout`: about `607.8ms`
- `aiSequenceResourceCardScan`: about `26.7` counts per sample
- `syncAiSequenceBoardStateMachine`: about `6` counts per sample

Interpretation:

- The animation entry cost is not just a generic full-layout problem.
- The real hotspot family includes `applyAiAnimationSectionLayers` and `applyPreviewRuntimeLayout`.
- P3D should split those functions into finer duration buckets before optimization.

## AI Sequence Hotspot

AI sequence animation entry did not trigger full layout refresh in this sampled path:

- `runFullLayoutRefresh`: `0ms`
- `applyAiAnimationSectionLayers`: about `572.7ms`
- `applyPreviewRuntimeLayout`: about `187.5ms`
- `aiSequenceResourceCardScan`: about `18.3` counts per sample
- `syncAiSequenceBoardStateMachine`: about `5` counts per sample

Interpretation:

- AI sequence is primarily animation-layer synchronization and resource-card related work.
- It is lower than the animation primary entry and the animation/effects roundtrip, but still material.

## Skeleton Hotspot

Skeleton animation entry did not show full layout or animation-layer duration in this sampled path:

- `runFullLayoutRefresh`: `0ms`
- `applyAiAnimationSectionLayers`: `0ms`
- `applyPreviewRuntimeLayout`: about `4.4ms`
- `skeletonTimelineRaf`: about `499.3` counts per 9-second sample
- `skeletonLayoutRaf`: about `3` counts per sample

Interpretation:

- The skeleton entry-switch cost is not visible in the current duration buckets.
- The main signal is sustained `skeletonTimelineRaf` activity.
- P3D should split the skeleton timeline RAF source before any behavioral change.

## Roundtrip Hotspot

The animation -> effects -> animation path is the heaviest sampled path:

- `runFullLayoutRefresh`: about `2401.1ms`
- `applyAiAnimationSectionLayers`: about `1670.3ms`
- `applyPreviewRuntimeLayout`: about `1435.5ms`
- `normalizeNovaflowVisualRhythm`: about `1179.2ms`
- `aiSequenceResourceCardScan`: about `53` counts per sample
- `numberInputOverlaySync`: about `224` counts per sample

Interpretation:

- Roundtrip switching stacks both major hotspot families:
  - effects-side visual rhythm / full layout refresh
  - animation-side animation layer / preview layout sync
- This best explains why "animation entry" feels most obvious: repeated entry into animation after effects brings the largest combined cost.

## Web Comparison

Web data is referenced from P3B, not re-sampled as strict P3C A/B data.

P3B reported:

| Scenario | Desktop P3B | Web 4783 P3B | Notes |
| --- | ---: | ---: | --- |
| Particle / effects `runFullLayoutRefresh` | about `742ms` | about `331ms` | Desktop higher |
| Particle / effects `normalizeNovaflowVisualRhythm` | about `653ms` | about `267ms` | Desktop higher |
| Animation primary entry | Desktop slightly higher | Web lower | Difference smaller than effects |
| AI sequence | close | close | Not the largest Desktop/Web gap |
| Skeleton | Desktop slightly higher | Web lower | Mainly RAF activity |

Important limitation:

- P3B Web data and P3C Desktop manual data were collected with different interaction and browser/runtime conditions.
- Treat this as directional evidence, not strict A/B proof.
- The consistent direction still supports the current renderer-side diagnosis.

## Current Judgment

Desktop entry-switch stutter is currently most likely renderer-side, not IPC-driven.

Most likely hotspot families:

1. Particle / effects: `normalizeNovaflowVisualRhythm` plus `runFullLayoutRefresh`.
2. Animation primary: `applyAiAnimationSectionLayers` plus `applyPreviewRuntimeLayout`.
3. AI sequence: animation layer sync plus resource-card/state-machine activity.
4. Skeleton: sustained `skeletonTimelineRaf` activity, not yet attributed to sub-sources.
5. Animation/effects roundtrip: stacked effects-side and animation-side layout work.

## P3D First Cut

P3D must still be probe-only. Do not optimize directly.

Recommended P3D probe additions:

1. Particle / effects:
   - Split `normalizeNovaflowVisualRhythm` into sub-step duration buckets.
   - Attribute broad element scans, style/class writes, rect reads, and guarded/no-op writes separately.

2. Animation:
   - Split `applyAiAnimationSectionLayers` into finer buckets.
   - Split `applyPreviewRuntimeLayout` into finer buckets on animation entry.
   - Keep resource-card scan and state-machine counters, but pair them with duration attribution.

3. Skeleton:
   - Split `skeletonTimelineRaf` source into active playback, idle loop, timeline UI sync, and preview sync buckets.
   - Record whether the RAF loop is expected after switching or persists while idle.

P3D should not change:

- `scheduleFullLayoutRefresh`
- MutationObserver behavior
- `normalizeNovaflowVisualRhythm` behavior
- `applyAiAnimationSectionLayers` behavior
- `applyPreviewRuntimeLayout` behavior
- Electron IPC
- Runtime Manager / `8188`
- UI / workflow / Storyboard / Prompt Assistant

## Verification

Run after adding this report:

```powershell
npm run phase0:check
npm run check:runtime
npm run check:entry
```
