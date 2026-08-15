# NovaFlow Desktop Performance P3D Hotspot Attribution

## Scope

- Phase: Desktop Performance P3D hotspot attribution
- Baseline commit: `f5a6ed5f31e03a8db15b7404772f4cb67132f137`
- Change type: probe-only attribution
- Runtime source: `particle-editor/novaflow-brand-runtime.js`
- Desktop mirror sync: `npm run sync:runtime`
- Probe version: `20260630-desktop-p3d-1`
- Sampling surface: Desktop Electron `win-unpacked`, renderer URL `file:///D:/AI_APP/NovaFlow/particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html`
- Sampling method: real Desktop window, real OS mouse input, CDP used only for in-memory probe readback
- Sample window: about 9 seconds per sample
- Sample count used in this report: 3 samples per scenario

This phase only adds duration attribution. It does not change refresh scheduling,
delays, MutationObserver behavior, Electron IPC, Runtime Manager / `8188`, UI,
workflow, Storyboard, Prompt Assistant, AI sequence state machine behavior,
skeleton behavior, or any optimization path.

## Added Attribution

The existing `window.__NFAnimationPerfProbe` API shape remains compatible:

- `layoutStepDurations.<functionName>.<stepName>`
- `layoutStepCounts.<functionName>.<stepName>`

Added or expanded attribution buckets:

| Function | Added / expanded leaf buckets |
| --- | --- |
| `normalizeNovaflowVisualRhythm` | `queryCandidates`, `computeStyle`, `writeStyle`, `skipExisting`, `misc` |
| `applyAiAnimationSectionLayers` | `skeletonRuntimeGuard`, `fallbackClearLayers`, `clearSectionLayers`, `modeSectionMarkers`, `postSectionLayers`, `secondarySwitchQuietRefresh`, `entryGateRelease` |
| `applyPreviewRuntimeLayout` | `togglePreviewClasses`, `leftPanelTags`, `globalControls`, `aifxTokens`, `aiLayerBranch`, `scheduleSkeletonLayout`, `spriteEditorStyling`, `particleSystemStyling`, `previewModalLayering`, `importDialogState`, `exportMenuProxy`, `licenseDialogActions`, `aiSequenceOverlayLayering`, `topbarDropdownLayering` |
| `skeletonTimelineRaf` | `lifecycleGuard`, `playbackDisplaySync`, `rangeFillSignature`, `scheduleNextFrame` |
| `skeletonLayoutRaf` | `normalizeSkeletonAnimationLayout` |

The attribution stores only numeric durations/counts and string labels. It does
not store DOM nodes, large objects, or probe-side files.

## Desktop Scenario Summary

Mean values across 3 real-mouse samples:

| Scenario | `runFullLayoutRefresh` | `applyPreviewRuntimeLayout` | `applyAiAnimationSectionLayers` | `normalizeNovaflowVisualRhythm` | `querySelectorAllStar` | Desktop methods | Page errors | Console errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Particle / effects entry | 535.8ms | 83.1ms | 3.9ms | 610.3ms | 0.5ms | 0 | 0 | 2.7 |
| Animation primary entry | 657.4ms | 485.1ms | 628.1ms | 198.8ms | 0.7ms | 0 | 0 | 1.0 |
| Animation -> effects -> animation | 1691.1ms | 970.7ms | 1151.1ms | 940.8ms | 3.0ms | 0 | 0 | 6.0 |

The recurring console errors were resource/network errors already seen in P3C.
No page exceptions were captured during the P3D samples.

## Particle / Effects Leaf Ranking

| Rank | Leaf | Mean duration |
| ---: | --- | ---: |
| 1 | `normalizeNovaflowVisualRhythm.computeStyle` | 177.7ms |
| 2 | `applyPreviewRuntimeLayout.leftPanelTags` | 33.9ms |
| 3 | `normalizeNovaflowVisualRhythm.skipExisting` | 19.7ms |
| 4 | `applyPreviewRuntimeLayout.globalControls` | 16.4ms |
| 5 | `normalizeNovaflowVisualRhythm.writeStyle` | 15.3ms |
| 6 | `applyPreviewRuntimeLayout.particleSystemStyling` | 12.1ms |
| 7 | `normalizeNovaflowVisualRhythm.queryCandidates` | 11.7ms |
| 8 | `applyPreviewRuntimeLayout.scheduleSkeletonLayout` | 9.6ms |

Effects entry is still dominated by visual-rhythm style/layout reads, not raw
selector duration. `querySelectorAllStar` itself is only about `0.5ms`.

## Animation Entry Leaf Ranking

| Rank | Leaf | Mean duration |
| ---: | --- | ---: |
| 1 | `applyPreviewRuntimeLayout.aiLayerBranch` | 470.5ms |
| 2 | `applyAiAnimationSectionLayers.locateSections` | 172.2ms |
| 3 | `applyAiAnimationSectionLayers.earlyStructureLayout` | 166.9ms |
| 4 | `applyAiAnimationEarlyStructureLayout.markResourceArea` | 145.7ms |
| 5 | `applyAiAnimationEarlyStructureLayout.markWorkspace` | 123.5ms |
| 6 | `applyAiAnimationEarlyStructureLayout.ensureBottomWorkspace` | 121.0ms |
| 7 | `normalizeNovaflowVisualRhythm.computeStyle` | 116.6ms |
| 8 | `applyAiAnimationSectionLayers.markWorkspaceLayout` | 102.0ms |

`applyPreviewRuntimeLayout.aiLayerBranch` is the largest bucket because it wraps
the preview-layout path that calls the AI animation layer sync. The lower-level
AI layer data points to `locateSections`, `earlyStructureLayout`, and the
resource/workspace marking work inside `applyAiAnimationEarlyStructureLayout`.

## Roundtrip Leaf Ranking

| Rank | Leaf | Mean duration |
| ---: | --- | ---: |
| 1 | `applyPreviewRuntimeLayout.aiLayerBranch` | 861.2ms |
| 2 | `normalizeNovaflowVisualRhythm.computeStyle` | 366.1ms |
| 3 | `applyAiAnimationSectionLayers.locateSections` | 318.0ms |
| 4 | `applyAiAnimationSectionLayers.earlyStructureLayout` | 301.8ms |
| 5 | `applyAiAnimationEarlyStructureLayout.markResourceArea` | 269.7ms |
| 6 | `applyAiAnimationEarlyStructureLayout.markWorkspace` | 228.2ms |
| 7 | `applyAiAnimationEarlyStructureLayout.ensureBottomWorkspace` | 219.6ms |
| 8 | `applyAiAnimationSectionLayers.markWorkspaceLayout` | 187.3ms |

The roundtrip path stacks both hotspot families:

- animation-side: `applyPreviewRuntimeLayout.aiLayerBranch` -> AI layer sync
- effects-side: `normalizeNovaflowVisualRhythm.computeStyle`

## Electron API Result

`window.__NFDesktopPerfProbe` captured zero completed `electronAPI` methods in
all P3D real-mouse samples.

Current judgment is unchanged from P3C: this sampled desktop entry-switch
stutter is not currently attributable to Electron IPC. The active evidence still
points to renderer-side layout, visual-rhythm style reads, and AI animation layer
synchronization.

## Highest Hotspots

| Scope | Highest leaf | Mean duration |
| --- | --- | ---: |
| Particle / effects | `normalizeNovaflowVisualRhythm.computeStyle` | 177.7ms |
| Animation primary | `applyPreviewRuntimeLayout.aiLayerBranch` | 470.5ms |
| Animation lower-level | `applyAiAnimationSectionLayers.locateSections` | 172.2ms |
| AI early structure lower-level | `applyAiAnimationEarlyStructureLayout.markResourceArea` | 145.7ms |
| Roundtrip | `applyPreviewRuntimeLayout.aiLayerBranch` | 861.2ms |
| Roundtrip effects-side | `normalizeNovaflowVisualRhythm.computeStyle` | 366.1ms |

## P3E First Optimization Recommendation

P3E should make one narrow optimization first, with Before / After data from the
same Desktop probe:

1. Start with the animation path, because it dominates both animation entry and
   roundtrip.
2. Target duplicate or same-refresh work under
   `applyPreviewRuntimeLayout.aiLayerBranch` and
   `applyAiAnimationSectionLayers.earlyStructureLayout`.
3. Do not optimize the broad parent bucket directly. Use the existing lower-level
   evidence to guard only proven repeated work, especially:
   - `applyAiAnimationSectionLayers.locateSections`
   - `applyAiAnimationEarlyStructureLayout.markResourceArea`
   - `applyAiAnimationEarlyStructureLayout.markWorkspace`
   - `applyAiAnimationEarlyStructureLayout.ensureBottomWorkspace`
4. Keep the first change behind a same-refresh / same-signature guard rather than
   changing global refresh delays or MutationObserver behavior.

Effects-side `normalizeNovaflowVisualRhythm.computeStyle` should be the second
candidate, not the first. It is large on effects and roundtrip, but a broad
style-read reduction can easily affect many surfaces. It should be optimized
only after the animation duplicate-work path has a controlled Before / After.

## Validation

Commands run before report creation:

```powershell
node --check particle-editor/novaflow-brand-runtime.js
node --check particle-editor/spine-split-runtime.js
node --check particle-editor/aifx-repaint-runtime.js
node --check particle-editor-desktop/main.js
npm run sync:runtime
npm run phase0:check
npm run check:runtime
npm run check:entry
```

Results:

- `node --check` passed for all four files.
- `npm run sync:runtime` completed and synchronized source, renderer, and win-unpacked brand runtime hashes.
- `npm run check:runtime` passed.
- `npm run check:entry` returned `Overall: GO`.
- `npm run phase0:check` completed with the expected working-tree warning because the P3D runtime/report changes were still uncommitted during validation.
