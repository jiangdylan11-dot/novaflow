# NovaFlow Desktop Performance P3E AI Layer Guard

## Scope

- Phase: Desktop Performance P3E AI layer guard
- Baseline commit before this change: `910f73b40324f8cb6cfa2abb61353e83d60ee1e5`
- Change type: narrow performance guard
- Runtime source: `particle-editor/novaflow-brand-runtime.js`
- Desktop mirror sync: `npm run sync:runtime`
- Sampling surface: Desktop Electron `win-unpacked`
- Sampling method: real Desktop window, real OS mouse input; CDP was used only for in-memory probe readback
- Sample window: about 9 seconds per sample
- Sample count: 3 samples per scenario

This phase changes only the AI layer branch around
`applyPreviewRuntimeLayout`. It does not change global delays,
`scheduleFullLayoutRefresh`, MutationObserver behavior,
`normalizeNovaflowVisualRhythm`, `applyAiAnimationSectionLayers`,
AI sequence state machine behavior, skeleton layout behavior, Electron IPC,
Runtime Manager / `8188`, UI, workflow, Storyboard, or Prompt Assistant.

## Change

P3E adds a conservative same-signature guard around the
`applyPreviewRuntimeLayout.aiLayerBranch` call site that invokes
`runAiAnimationSectionLayersOnce()`.

The guard records:

| Counter | Meaning |
| --- | --- |
| `aiLayerBranchGuardAttempt` | AI layer branch guard evaluated |
| `aiLayerBranchGuardRun` | AI layer branch allowed to run |
| `aiLayerBranchGuardSkipped` | AI layer branch skipped by same-signature guard |
| `aiLayerBranchGuardSignature` | Signature sampled |
| `aiLayerBranchGuardSignature.<type>` | Signature type bucket, such as `ai-sequence`, `skeleton`, or `non-animation` |

The signature includes active surface and state markers:

- primary switch token
- active primary label
- active secondary labels
- body class
- preview state booleans from `applyPreviewRuntimeLayout`
- AI layout claim
- AI sequence claim
- skeleton active state
- entry light mode
- force-full sync state
- AI collapse state
- AI sequence mode and board id
- key AI mode/post section collapse attributes
- key AI, skeleton, and preview root identities
- brand runtime mutation batch and flush tokens

The guard stores only numeric counters and string signatures. It does not store
DOM nodes in probe output, does not read extra layout, and does not change the
external signature of `applyPreviewRuntimeLayout`.

Skeleton entry is intentionally not skipped. When the skeleton surface is
active, the branch still clears AI runtime state and resets the guard signature.

## P3D vs P3E Summary

Mean values across 3 real-mouse samples:

| Scenario | Metric | P3D | P3E | Delta |
| --- | --- | ---: | ---: | ---: |
| Animation primary | `applyPreviewRuntimeLayout.aiLayerBranch` | 470.5ms | 282.6ms | -39.9% |
| Animation primary | `applyAiAnimationSectionLayers` | 628.1ms | 398.2ms | -36.6% |
| Animation primary | `applyPreviewRuntimeLayout` | 485.1ms | 293.3ms | -39.5% |
| Animation primary | `runFullLayoutRefresh` | 657.4ms | 375.8ms | -42.8% |
| Animation -> effects -> animation | `applyPreviewRuntimeLayout.aiLayerBranch` | 861.2ms | 238.9ms | -72.3% |
| Animation -> effects -> animation | `applyAiAnimationSectionLayers` | 1151.1ms | 351.5ms | -69.5% |
| Animation -> effects -> animation | `applyPreviewRuntimeLayout` | 970.7ms | 316.8ms | -67.4% |
| Animation -> effects -> animation | `runFullLayoutRefresh` | 1691.1ms | 705.5ms | -58.3% |
| Animation -> effects -> animation | `normalizeNovaflowVisualRhythm` | 940.8ms | 531.1ms | -43.5% |

The P3E measurements are lower than the P3D baseline on the animation and
roundtrip paths. However, the guard skip counter was `0` in all sampled
scenarios. Therefore the improvement should be treated as observed directional
data, not proof that same-signature skipping was the direct cause in these
entry-switch samples.

The more precise conclusion is:

- P3E did not introduce a regression in the sampled entry paths.
- The sampled real transitions did not expose same-signature duplicate AI layer
  branch work.
- The guard is now in place for future duplicate same-signature refresh cases,
  with counters to prove whether it actually skips.

## P3E Scenario Data

| Scenario | `aiLayerBranch` | `applyAiAnimationSectionLayers` | `applyPreviewRuntimeLayout` | `runFullLayoutRefresh` | Guard run / skip / attempt | Desktop methods | Page errors | Console errors | Final state |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Animation primary | 282.6ms | 398.2ms | 293.3ms | 375.8ms | 2.3 / 0 / 2.3 | 0 | 0 | 3 total | AI sequence |
| AI sequence | 109.5ms | 335.3ms | 112.0ms | 0.0ms | 1.0 / 0 / 1.0 | 0 | 0 | 3 total | AI sequence |
| Skeleton | 0.5ms | 0.0ms | 2.7ms | 0.0ms | 1.0 / 0 / 1.0 | 0 | 0 | 0 total | Skeleton |
| Animation -> effects -> animation | 238.9ms | 351.5ms | 316.8ms | 705.5ms | 4.0 / 0 / 4.0 | 0 | 0 | 3 total | AI sequence |

Guard signature totals:

| Scenario | Signature buckets |
| --- | --- |
| Animation primary | `aiLayerBranchGuardSignature.ai-sequence`: 7 |
| AI sequence | `aiLayerBranchGuardSignature.ai-sequence`: 3 |
| Skeleton | `aiLayerBranchGuardSignature.skeleton`: 3 |
| Animation -> effects -> animation | `aiLayerBranchGuardSignature.non-animation`: 6, `aiLayerBranchGuardSignature.ai-sequence`: 6 |

No completed `electronAPI` methods were captured by
`window.__NFDesktopPerfProbe` in any P3E sample.

## Regression Check

Manual state checks from the sampled windows:

- Animation primary ended on the AI sequence animation surface in all 3 samples.
- AI sequence switching from skeleton ended on AI sequence in all 3 samples.
- Skeleton switching from AI sequence ended on skeleton in all 3 samples.
- Animation -> effects -> animation ended back on AI sequence in all 3 samples.
- No page exceptions were captured.
- Console errors remained present on AI sequence paths, matching the earlier
  P3D pattern of recurring resource/network errors. They were not attributed to
  this guard change.

## Current Judgment

Desktop entry-switch jank is still not attributable to Electron IPC in the
sampled windows. The active evidence remains renderer-side layout and AI
animation layer synchronization.

P3E is safe enough as a first narrow guard, but it did not prove that
same-signature duplicate skipping is the main available win for the tested
manual transitions because `aiLayerBranchGuardSkipped` stayed at `0`.

## Next Recommendation

P3F should not broaden scheduling changes yet.

Recommended next step:

1. Add a focused no-op repeat-refresh sample or probe that intentionally observes
   consecutive `applyPreviewRuntimeLayout.aiLayerBranch` calls without surface,
   mutation, or mode changes.
2. If `aiLayerBranchGuardSkipped` stays `0`, stop investing in the outer branch
   guard and move to the proven lower-level leaves under
   `applyAiAnimationSectionLayers`, especially `locateSections` and early
   structure layout marking.
3. Keep the effects-side `normalizeNovaflowVisualRhythm.computeStyle` as the
   next separate target after animation-side attribution is exhausted.

Do not change global refresh delays, MutationObserver behavior, or visual-rhythm
behavior without a new Before / After probe.

## Validation

Commands run:

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

- `node --check` passed for all four checked files.
- `npm run sync:runtime` completed and synchronized source, renderer, and
  win-unpacked brand runtime hashes.
- `npm run check:runtime` passed.
- `npm run check:entry` returned `Overall: GO`; locked `4783` and direct
  `8188` probes were both healthy.
- `npm run phase0:check` completed with the expected working-tree warning
  because the P3E runtime/report changes were still uncommitted during
  validation.
