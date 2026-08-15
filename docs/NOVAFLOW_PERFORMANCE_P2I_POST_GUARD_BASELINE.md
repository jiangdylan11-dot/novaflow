# NovaFlow Performance P2I Post Workspace Guard Baseline

## Scope

- Phase: Performance P2I post-guard baseline
- Current commit at sampling: `39f01a37 perf: guard duplicate workspace active writes`
- Sample time: 2026-06-30 03:22 ICT (`2026-06-29T20:22:19.116Z`)
- Entry: locked `http://127.0.0.1:4783/`
- Upstream: `http://127.0.0.1:8188/`
- Probe: `window.__NFAnimationPerfProbe`, version `20260616-animation-1-5`
- Browser: Chrome 149 headless on Windows 10 x64
- Viewport: 1440 x 960

This pass only sampled runtime behavior and added this report. It did not change Runtime, UI, workflow JSON, Storyboard V5, Prompt Assistant, Electron IPC, or optimization logic.

Environment note:

- `4783` was reachable and returned HTTP `200`.
- `8188` TCP probe failed and the page logged upstream `502 Bad Gateway` resource errors. This does not block this DOM performance baseline because no real workflow generation was invoked.
- `pageErrors`: none.

## Method

Each scenario used:

```js
window.__NFAnimationPerfProbe.start("<label>", { durationMs: 10000 })
```

The scenario action was performed in the locked 4783 page and the probe report was read after the 10 second sample. The drawing dialog scenario used a temporary in-page 64 x 64 data URL source resource through the existing split bridge so the real dialogs could open; no repository file was written.

## P2I Probe Data

| Scenario | Duration ms | scheduleFullLayoutRefresh | brandMutationFlushRun | observedLayoutRefreshScheduled | runFullLayoutRefresh | applyPreviewRuntimeLayout | applyAiAnimationSectionLayers | syncAiSequenceBoardStateMachine | normalizeNovaflowVisualRhythm | querySelectorAllStar | workspaceActiveWriterAttempt | workspaceActiveWriterChanged | workspaceActiveWriterSameValue | workspaceActiveWriterSkippedSameValue |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Startup idle | 10007 | 0 | 0 | 0 | 1 | 1 | 1 | 0 | 7 | 7 | 0 | 0 | 0 | 0 |
| Primary switches: effects / animation / art / tools / warehouse / export | 10001 | 5 | 15 | 5 | 9 | 10 | 11 | 5 | 36 | 39 | 17 | 2 | 15 | 11 |
| Secondary switches: AI sequence / skeleton / art UI / art drawing | 10002 | 2 | 8 | 3 | 8 | 10 | 11 | 7 | 32 | 37 | 10 | 3 | 7 | 0 |
| Art drawing dialogs: upscale / wash / expand open-close | 10007 | 1 | 4 | 2 | 3 | 3 | 3 | 0 | 12 | 12 | 0 | 0 | 0 | 0 |
| AI sequence -> skeleton -> AI sequence | 10028 | 1 | 11 | 0 | 2 | 5 | 8 | 12 | 8 | 16 | 8 | 1 | 7 | 0 |

## Scenario Notes

| Scenario | Operation result | Notes |
| --- | --- | --- |
| Startup idle | PASS | After page settle, no mutation flush or scheduled layout refresh fired. One direct topbar-file-help deferred full refresh remained. |
| Primary switches | PASS with note | Primary entries clicked successfully. Export entry clicked successfully, but the automation did not find a modal/dialog to close during this sample. |
| Secondary switches | PASS | Animation, AI sequence, skeleton, art, UI, and drawing entries clicked successfully. |
| Art drawing dialogs | PASS | A temporary source image was added in the headless session. Image upscale, image wash, and outpaint each opened a visible dialog and were closed. |
| AI sequence / skeleton roundtrip | PASS | Animation -> AI sequence -> skeleton -> AI sequence completed. |

## P2B / P2G / P2H / P2I Comparison

### P2B to P2I Full-Scenario Counters

| Scenario | Metric | P2B | P2I | Delta |
| --- | --- | ---: | ---: | ---: |
| Startup idle | `runFullLayoutRefresh` | 0 | 1 | +1 |
| Startup idle | `normalizeNovaflowVisualRhythm` | 0 | 7 | +7 |
| Startup idle | `querySelectorAllStar` | 0 | 7 | +7 |
| Primary switches | `brandMutationFlushRun` | 23 | 15 | -8 |
| Primary switches | `runFullLayoutRefresh` | 22 | 9 | -13 |
| Primary switches | `normalizeNovaflowVisualRhythm` | 88 | 36 | -52 |
| Primary switches | `querySelectorAllStar` | 91 | 39 | -52 |
| Secondary switches | `brandMutationFlushRun` | 248 | 8 | -240 |
| Secondary switches | `runFullLayoutRefresh` | 250 | 8 | -242 |
| Secondary switches | `normalizeNovaflowVisualRhythm` | 989 | 32 | -957 |
| Secondary switches | `querySelectorAllStar` | 994 | 37 | -957 |
| Art drawing dialogs | `brandMutationFlushRun` | 170 | 4 | -166 |
| Art drawing dialogs | `runFullLayoutRefresh` | 171 | 3 | -168 |
| Art drawing dialogs | `normalizeNovaflowVisualRhythm` | 673 | 12 | -661 |
| Art drawing dialogs | `querySelectorAllStar` | 673 | 12 | -661 |
| AI sequence -> skeleton -> AI sequence | `brandMutationFlushRun` | 11 | 11 | 0 |
| AI sequence -> skeleton -> AI sequence | `runFullLayoutRefresh` | 4 | 2 | -2 |
| AI sequence -> skeleton -> AI sequence | `normalizeNovaflowVisualRhythm` | 25 | 8 | -17 |
| AI sequence -> skeleton -> AI sequence | `querySelectorAllStar` | 34 | 16 | -18 |

### P2G / P2H / P2I Workspace Active Metrics

| Scenario | Metric | P2G | P2H | P2I |
| --- | --- | ---: | ---: | ---: |
| Secondary switches | `workspaceActiveWriterAttempt` | 243 | 26 | 10 |
| Secondary switches | `workspaceActiveWriterChanged` | 3 | 3 | 3 |
| Secondary switches | `workspaceActiveWriterSameValue` | 240 | 23 | 7 |
| Secondary switches | `workspaceActiveWriterSkippedSameValue` | 0 | 16 | 0 |
| Secondary switches | `brandMutationFlushRun` | 238 | 9 | 8 |
| Secondary switches | `runFullLayoutRefresh` | 237 | 11 | 8 |
| Secondary switches | `skeletonMutationFlushAttr.data-novaflow-spine-split-workspace-active` | 236 | 3 | 0 |
| Art drawing dialogs | `workspaceActiveWriterAttempt` | 206 | 22 | 0 |
| Art drawing dialogs | `workspaceActiveWriterChanged` | 0 | 0 | 0 |
| Art drawing dialogs | `workspaceActiveWriterSameValue` | 206 | 22 | 0 |
| Art drawing dialogs | `workspaceActiveWriterSkippedSameValue` | 0 | 22 | 0 |
| Art drawing dialogs | `brandMutationFlushRun` | 203 | 5 | 4 |
| Art drawing dialogs | `runFullLayoutRefresh` | 203 | 4 | 3 |
| Art drawing dialogs | `skeletonMutationFlushAttr.data-novaflow-spine-split-workspace-active` | 206 | 0 | 0 |

## P2H Guard Benefit Confirmation

P2I confirms the P2H guard benefit is durable beyond the two narrow P2H confirmation scenes:

- The previous dominant `data-novaflow-spine-split-workspace-active` skeleton attr mutation no longer appears in P2I.
- Secondary switching dropped from P2B `250` full layout refreshes to P2I `8`.
- Art drawing dialogs dropped from P2B `171` full layout refreshes to P2I `3`.
- `querySelectorAllStar` and `normalizeNovaflowVisualRhythm` are no longer high-frequency counters in the two formerly worst scenarios.

Important distinction:

- `workspaceActiveWriterChanged` stayed consistent with the real state transitions.
- P2H did not hide or skip necessary state changes; it removed repeated same-value writes.

## Remaining Hotspots

After P2H, the bottleneck profile changed. The remaining issue is no longer high-frequency workspace-active mutation churn. It is now fewer layout refreshes with higher per-refresh duration in AI/preview layout work.

### Highest P2I Counters

| Rank | Scenario | Counter | Count |
| ---: | --- | --- | ---: |
| 1 | Primary switches | `querySelectorAllStar` | 39 |
| 2 | Primary switches | `normalizeNovaflowVisualRhythm` | 36 |
| 3 | Secondary switches | `querySelectorAllStar` | 37 |
| 4 | Secondary switches | `normalizeNovaflowVisualRhythm` | 32 |
| 5 | Primary switches | `brandMutationFlushRun` | 15 |
| 6 | AI sequence -> skeleton -> AI sequence | `syncAiSequenceBoardStateMachine` | 12 |
| 7 | AI sequence -> skeleton -> AI sequence | `brandMutationFlushRun` | 11 |
| 8 | Secondary switches | `applyAiAnimationSectionLayers` | 11 |

### Highest P2I Durations

| Rank | Scenario | Duration bucket | Total ms |
| ---: | --- | --- | ---: |
| 1 | AI sequence -> skeleton -> AI sequence | `applyAiAnimationSectionLayers` | 834.9 |
| 2 | Secondary switches | `runFullLayoutRefresh` | 525.1 |
| 3 | Secondary switches | `applyAiAnimationSectionLayers` | 520.0 |
| 4 | Primary switches | `runFullLayoutRefresh` | 464.7 |
| 5 | AI sequence -> skeleton -> AI sequence | `applyPreviewRuntimeLayout` | 454.3 |
| 6 | AI sequence -> skeleton -> AI sequence | `runFullLayoutRefresh` | 439.8 |
| 7 | Secondary switches | `applyPreviewRuntimeLayout` | 347.0 |
| 8 | Primary switches | `applyAiAnimationSectionLayers` | 330.0 |
| 9 | Primary switches | `applyPreviewRuntimeLayout` | 301.2 |
| 10 | Primary switches | `normalizeNovaflowVisualRhythm` | 240.8 |

### Remaining Mutation Families

| Scenario | Highest mutation families |
| --- | --- |
| Primary switches | `unknown` 62, `aiSequence` 28, `skeleton` 12 |
| Secondary switches | `aiSequence` 36, `unknown` 23, `skeleton` 4 |
| Art drawing dialogs | `skeleton` 7, `modalDialog` 1 |
| AI sequence -> skeleton -> AI sequence | `aiSequence` 54, `unknown` 25 |

The remaining mutation families are not dominated by workspace-active attribute writes. P2J should not add another writer guard without new attribution.

## P2J Recommendation

Recommended next pass: observation-first duration attribution for layout sub-work.

1. Add lightweight sub-step duration attribution inside `applyAiAnimationSectionLayers`.
2. Add lightweight sub-step duration attribution inside `applyPreviewRuntimeLayout`.
3. Preserve existing probe API compatibility.
4. Do not change scheduling, delay, MutationObserver scope, AI sequence/skeleton switching logic, resource/preview state, workflow JSON, Storyboard V5, Prompt Assistant, Electron IPC, or UI.
5. Re-sample the same P2I scenes before choosing another real optimization.

Rationale:

- P2I already reduced the former high-frequency mutation/layout loop.
- The new highest costs are duration totals, especially `applyAiAnimationSectionLayers` and `applyPreviewRuntimeLayout`.
- `querySelectorAllStar` counts are much lower and measured query duration is tiny, so it should not be the next optimization target without new evidence.

## Verification Commands

Run after adding this report:

```powershell
npm run phase0:check
npm run check:runtime
npm run check:entry
```
