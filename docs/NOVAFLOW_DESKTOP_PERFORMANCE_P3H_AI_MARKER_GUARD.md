# NovaFlow Desktop Performance P3H AI Marker Guard

## Scope

- Phase: Desktop Performance P3H AI marker guard
- Baseline commit: `de0010ab62b264f386d8b11e72ee3e0a41fa7565`
- Change type: small performance optimization with existing probe counters
- Runtime source changed: `particle-editor/novaflow-brand-runtime.js`
- Runtime mirrors synced:
  - `particle-editor-desktop/renderer/novaflow-brand-runtime.js`
  - `particle-editor-desktop/dist/win-unpacked/resources/app/renderer/novaflow-brand-runtime.js`
- Desktop surface: Electron `win-unpacked`
- Sampling method: real Desktop window and real OS mouse input; CDP was used only for in-memory probe readback
- Sample window: about 9 seconds per sample
- Sample count: 3 samples per scenario

P3H does not continue the outer `applyPreviewRuntimeLayout.aiLayerBranch`
guard direction. P3F already showed that direction did not hit skips in no-op
repeat validation.

## Change Summary

P3H only adds same-value guards for the writer pairs that P3G proved were 100%
same-value across the sampled Desktop scenarios:

- `claimBottomWorkspace.class:novaflow-ai-animation-section-layers`
- `claimBottomWorkspace.class:novaflow-ai-bottom-workspace-active`
- `markWorkspaceLayout.data-novaflow-ai-main-workspace`
- `markWorkspaceLayout.data-novaflow-ai-resource-sidebar-host`
- `ensureBottomWorkspace.data-novaflow-ai-bottom-workspace`

Implementation details:

- Class writer guard: if `classList.contains(className)` is already true, skip
  `classList.add(className)`.
- Data marker guard: if `getAttribute(name)` already equals the target value,
  skip `setAttribute(name, value)`.
- First writes are preserved.
- Surface changes are preserved because absent class/attribute still writes.
- Existing writer probe fields remain compatible:
  - `layoutMarkerWriterAttempt`
  - `layoutMarkerWriterChanged`
  - `layoutMarkerWriterSameValue`
  - `layoutMarkerWriterSkippedSameValue`
  - `layoutMarkerWriterGuard`

The same allowed `ensureBottomWorkspace.data-novaflow-ai-bottom-workspace`
writer pair has two local writer sites, and both use the same guard. No
`aiLayerBranch`, scheduling, MutationObserver, visual rhythm, AI sequence state
machine, skeleton layout, Electron IPC, Runtime Manager, UI, workflow,
Storyboard, or Prompt Assistant code was changed.

## Desktop Sampling Summary

Mean values across 3 samples:

| Scenario | P3G `applyAiAnimationSectionLayers` | P3H `applyAiAnimationSectionLayers` | P3G `applyPreviewRuntimeLayout` | P3H `applyPreviewRuntimeLayout` | P3G `runFullLayoutRefresh` | P3H `runFullLayoutRefresh` | Page errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Active animation repeat | 620.7ms | 583.5ms | 634.3ms | 595.6ms | 1113.8ms | 1062.1ms | 0 |
| Active AI sequence repeat | 582.7ms | 573.9ms | 0.0ms | 0.0ms | 0.0ms | 0.0ms | 0 |
| Animation primary entry | 448.0ms | 355.3ms | 341.5ms | 244.9ms | 467.5ms | 296.1ms | 0 |
| Animation -> effects -> animation | 343.3ms | 398.8ms | 303.2ms | 359.6ms | 720.9ms | 804.7ms | 0 |

Desktop `electronAPI` completed method count was `0` in all P3H samples.

## Leaf Comparison

Mean values across 3 samples:

| Scenario | P3G `previewSurface` | P3H `previewSurface` | P3G `earlyStructureLayout` | P3H `earlyStructureLayout` | P3G `markResourceArea` | P3H `markResourceArea` | P3G `markWorkspace` | P3H `markWorkspace` | P3G `ensureBottomWorkspace` | P3H `ensureBottomWorkspace` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Active animation repeat | 369.9ms | 340.1ms | 171.3ms | 156.5ms | 148.7ms | 145.8ms | 154.9ms | 145.9ms | 142.2ms | 138.7ms |
| Active AI sequence repeat | 342.5ms | 335.3ms | 159.3ms | 157.1ms | 95.2ms | 95.7ms | 96.3ms | 97.1ms | 90.7ms | 90.8ms |
| Animation primary entry | 256.1ms | 203.2ms | 117.7ms | 93.8ms | 106.7ms | 86.2ms | 91.0ms | 71.2ms | 85.4ms | 65.4ms |
| Animation -> effects -> animation | 195.8ms | 229.2ms | 91.8ms | 108.1ms | 79.8ms | 93.7ms | 64.6ms | 76.7ms | 60.8ms | 73.1ms |

The strongest improvement is in `Animation primary entry`. Active animation
repeat also improves modestly. Active AI sequence repeat is nearly flat.
Roundtrip has one high P3H sample and the mean is worse, so P3H should not be
claimed as a stable roundtrip improvement.

## Guard Skip Data

Totals across 3 samples:

| Scenario | Target writer pair | Pair observations | Changed | Same-value observations | Skipped same-value |
| --- | --- | ---: | ---: | ---: | ---: |
| Active animation repeat | `claimBottomWorkspace.class:novaflow-ai-animation-section-layers` | 45 | 0 | 45 | 75 |
| Active animation repeat | `claimBottomWorkspace.class:novaflow-ai-bottom-workspace-active` | 45 | 0 | 45 | 75 |
| Active animation repeat | `markWorkspaceLayout.data-novaflow-ai-main-workspace` | 45 | 0 | 45 | 60 |
| Active animation repeat | `markWorkspaceLayout.data-novaflow-ai-resource-sidebar-host` | 45 | 0 | 45 | 60 |
| Active animation repeat | `ensureBottomWorkspace.data-novaflow-ai-bottom-workspace` | 45 | 0 | 45 | 150 |
| Active AI sequence repeat | `claimBottomWorkspace.class:novaflow-ai-animation-section-layers` | 30 | 0 | 30 | 45 |
| Active AI sequence repeat | `claimBottomWorkspace.class:novaflow-ai-bottom-workspace-active` | 30 | 0 | 30 | 45 |
| Active AI sequence repeat | `markWorkspaceLayout.data-novaflow-ai-main-workspace` | 30 | 0 | 30 | 45 |
| Active AI sequence repeat | `markWorkspaceLayout.data-novaflow-ai-resource-sidebar-host` | 30 | 0 | 30 | 45 |
| Active AI sequence repeat | `ensureBottomWorkspace.data-novaflow-ai-bottom-workspace` | 30 | 0 | 30 | 105 |
| Animation primary entry | `claimBottomWorkspace.class:novaflow-ai-animation-section-layers` | 21 | 0 | 21 | 27 |
| Animation primary entry | `claimBottomWorkspace.class:novaflow-ai-bottom-workspace-active` | 21 | 0 | 21 | 24 |
| Animation primary entry | `markWorkspaceLayout.data-novaflow-ai-main-workspace` | 21 | 0 | 21 | 30 |
| Animation primary entry | `markWorkspaceLayout.data-novaflow-ai-resource-sidebar-host` | 21 | 0 | 21 | 30 |
| Animation primary entry | `ensureBottomWorkspace.data-novaflow-ai-bottom-workspace` | 21 | 0 | 21 | 87 |
| Animation -> effects -> animation | `claimBottomWorkspace.class:novaflow-ai-animation-section-layers` | 24 | 0 | 24 | 31 |
| Animation -> effects -> animation | `claimBottomWorkspace.class:novaflow-ai-bottom-workspace-active` | 24 | 0 | 24 | 28 |
| Animation -> effects -> animation | `markWorkspaceLayout.data-novaflow-ai-main-workspace` | 24 | 0 | 24 | 34 |
| Animation -> effects -> animation | `markWorkspaceLayout.data-novaflow-ai-resource-sidebar-host` | 24 | 0 | 24 | 34 |
| Animation -> effects -> animation | `ensureBottomWorkspace.data-novaflow-ai-bottom-workspace` | 24 | 0 | 24 | 97 |

Target writer skipped same-value totals:

| Scenario | Total skipped same-value |
| --- | ---: |
| Active animation repeat | 420 |
| Active AI sequence repeat | 285 |
| Animation primary entry | 198 |
| Animation -> effects -> animation | 224 |

`layoutMarkerWriterChanged` stayed `0` for the target writer pairs. This means
the guard is preserving the observed steady-state behavior while avoiding
duplicate writes.

The aggregate `layoutMarkerWriterGuard` field also contains
`markAiAnimationWorkspaceLayout` because an existing resource-panel marker site
uses the same generic guard helper. That existing writer is not counted as a
P3H target writer in the table above.

## Performance Assessment

P3H has a real guard hit signal:

- all four scenarios hit `layoutMarkerWriterSkippedSameValue`
- the target writer pairs still show `changed = 0`
- no page errors or console errors were captured
- Desktop `electronAPI` method count remained `0`

P3H has partial timing improvement:

- Active animation repeat improved modestly.
- Animation primary entry improved clearly in this sample set.
- Active AI sequence repeat was essentially neutral.
- Roundtrip was noisier and worse in the mean because one P3H sample was high.

Conclusion: keep P3H because it is narrow and it demonstrably avoids duplicate
marker writes, but do not broaden marker guards based on this result alone.
The remaining highest parent bucket is still `applyAiAnimationSectionLayers`
`previewSurface`.

## Regression Check

No functional regression was observed during the Desktop manual sampling:

- Active animation repeat completed.
- Active AI sequence repeat completed.
- Animation primary entry completed.
- Animation -> effects -> animation completed.
- Page errors: `0`.
- Console errors: `0`.
- Desktop `electronAPI` completed method count: `0`.

## Next Step

P3I should not continue the `aiLayerBranch` guard direction and should not
broaden marker writer guards without new evidence.

Recommended P3I first cut:

1. Add or use finer attribution inside `applyAiAnimationSectionLayers.previewSurface`.
2. Split at least:
   - preview root locating
   - preview surface geometry sync
   - AI animation preview CSS variable writes
   - bottom workspace style application
   - resource/sidebar surface sync
3. Record writer attempted/changed/same-value/skipped for the dominant
   preview-surface writers.
4. Only optimize a writer or leaf after it shows the same P3G/P3H level of
   repeated same-value evidence.
5. Do not change global layout scheduling, MutationObserver, visual rhythm, AI
   sequence state machine, skeleton layout, Electron IPC, Runtime Manager, UI,
   workflow, Storyboard, or Prompt Assistant.

## Validation

Commands run before report creation:

```powershell
node --check particle-editor/novaflow-brand-runtime.js
npm run sync:runtime
npm run phase0:check
npm run check:runtime
npm run check:entry
node --check particle-editor/spine-split-runtime.js
node --check particle-editor/aifx-repaint-runtime.js
node --check particle-editor-desktop/main.js
```

Results:

- `node --check particle-editor/novaflow-brand-runtime.js` passed.
- `npm run sync:runtime` passed and synced source runtime to both renderer
  mirrors.
- `npm run phase0:check` completed with the expected dirty-tree warning because
  the runtime/report changes were still uncommitted during validation; core
  checks passed.
- `npm run check:runtime` passed.
- `npm run check:entry` returned `Overall: GO`; locked `4783` and direct
  `8188` probes were healthy.
- `node --check particle-editor/spine-split-runtime.js` passed.
- `node --check particle-editor/aifx-repaint-runtime.js` passed.
- `node --check particle-editor-desktop/main.js` passed.

Final validation should be repeated after this report is added and before the
P3H commit.
