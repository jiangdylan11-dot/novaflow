# NovaFlow Desktop Performance P3G AI Layer Leaf Decision

## Scope

- Phase: Desktop Performance P3G AI layer leaf decision
- Baseline commit: `446fed623d8c4cbae1c73c16f4ef18dcaba812a3`
- Change type: docs-only read-only localization report
- Runtime changes: none
- Desktop surface: Electron `win-unpacked`
- Sampling method: real Desktop window and real OS mouse input; CDP was used only for in-memory probe readback
- Sample window: about 9 seconds per sample
- Sample count: 3 samples per scenario

P3G does not continue the outer `applyPreviewRuntimeLayout.aiLayerBranch`
guard direction. P3F already showed `aiLayerBranchGuardSkipped = 0` in no-op
repeat validation.

## Existing Probe Coverage

No new probe was needed.

The existing `window.__NFAnimationPerfProbe` already records:

- `applyAiAnimationSectionLayers` leaf counts and durations via
  `layoutStepCounts` / `layoutStepDurations`
- `applyAiAnimationEarlyStructureLayout` leaf counts and durations
- `applyPreviewRuntimeLayout` leaf counts and durations
- `layoutMarkerWriterAttempt`
- `layoutMarkerWriterChanged`
- `layoutMarkerWriterSameValue`
- `layoutMarkerWriterSkippedSameValue`

The available attribution is enough to decide the next optimization target
without changing Runtime.

## Desktop Sampling Summary

Mean values across 3 samples:

| Scenario | `applyAiAnimationSectionLayers` | `applyPreviewRuntimeLayout` | `runFullLayoutRefresh` | AI layer calls | Preview layout calls | Page errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Active animation repeat | 620.7ms | 634.3ms | 1113.8ms | 5.0 | 5.0 | 0 |
| Active AI sequence repeat | 582.7ms | 0.0ms | 0.0ms | 5.0 | 0.0 | 0 |
| Animation primary entry | 448.0ms | 341.5ms | 467.5ms | 3.7 | 2.7 | 0 |
| Animation -> effects -> animation | 343.3ms | 303.2ms | 720.9ms | 5.0 | 4.0 | 0 |

Desktop `electronAPI` completed method count was `0` in all samples.

The active AI sequence repeat is important: it bypasses
`applyPreviewRuntimeLayout` but still spends about `582.7ms` in
`applyAiAnimationSectionLayers`. That confirms P3G should move below
`aiLayerBranch`.

## `applyAiAnimationSectionLayers` Leaf Ranking

Durations below are totals across 3 samples for each scenario.

| Scenario | Rank 1 | Rank 2 | Rank 3 | Rank 4 |
| --- | ---: | ---: | ---: | ---: |
| Active animation repeat | `previewSurface` 1109.6ms | `earlyStructureLayout` 514.0ms | `locateSections` 499.9ms | `markWorkspaceLayout` 301.5ms |
| Active AI sequence repeat | `previewSurface` 1027.6ms | `locateSections` 478.8ms | `earlyStructureLayout` 477.8ms | `markWorkspaceLayout` 290.0ms |
| Animation primary entry | `previewSurface` 768.3ms | `locateSections` 370.4ms | `earlyStructureLayout` 353.1ms | `markWorkspaceLayout` 219.1ms |
| Animation -> effects -> animation | `previewSurface` 587.3ms | `earlyStructureLayout` 275.5ms | `locateSections` 272.8ms | `markWorkspaceLayout` 162.7ms |

Current highest AI layer leaf is `applyAiAnimationSectionLayers.previewSurface`.
It dominates both active-repeat and entry-switch scenarios.

## `applyAiAnimationEarlyStructureLayout` Leaf Ranking

Durations below are totals across 3 samples for each scenario.

| Scenario | Rank 1 | Rank 2 | Rank 3 | Rank 4 |
| --- | ---: | ---: | ---: | ---: |
| Active animation repeat | `markWorkspace` 464.8ms | `markResourceArea` 446.2ms | `ensureBottomWorkspace` 426.5ms | `stylePlaceholderDropzones` 166.4ms |
| Active AI sequence repeat | `markWorkspace` 289.0ms | `markResourceArea` 285.7ms | `ensureBottomWorkspace` 272.1ms | `stylePlaceholderDropzones` 103.8ms |
| Animation primary entry | `markResourceArea` 320.0ms | `markWorkspace` 273.1ms | `ensureBottomWorkspace` 256.2ms | `stylePlaceholderDropzones` 102.3ms |
| Animation -> effects -> animation | `markResourceArea` 239.4ms | `markWorkspace` 193.7ms | `ensureBottomWorkspace` 182.3ms | `stylePlaceholderDropzones` 75.6ms |

The low-level repeated work is concentrated in:

- `markWorkspace`
- `markResourceArea`
- `ensureBottomWorkspace`

These are more actionable than the broad parent `previewSurface` bucket because
they have writer-level evidence.

## Writer Evidence

The strongest writer signal is 100% same-value writes across all P3G scenarios.

| Writer pair | Active animation repeat | Active AI sequence repeat | Animation entry | Roundtrip |
| --- | ---: | ---: | ---: | ---: |
| `claimBottomWorkspace.class:novaflow-ai-animation-section-layers` | 45 / 45 same | 30 / 30 same | 27 / 27 same | 21 / 21 same |
| `claimBottomWorkspace.class:novaflow-ai-bottom-workspace-active` | 45 / 45 same | 30 / 30 same | 27 / 27 same | 21 / 21 same |
| `markWorkspaceLayout.data-novaflow-ai-main-workspace` | 45 / 45 same | 30 / 30 same | 27 / 27 same | 21 / 21 same |
| `markWorkspaceLayout.data-novaflow-ai-resource-sidebar-host` | 45 / 45 same | 30 / 30 same | 27 / 27 same | 21 / 21 same |
| `ensureBottomWorkspace.data-novaflow-ai-bottom-workspace` | 45 / 45 same | 30 / 30 same | 27 / 27 same | 21 / 21 same |

`layoutMarkerWriterChanged` was `0` for these pairs in all sampled scenarios.
`layoutMarkerWriterSkippedSameValue` was also `0`, which means the current code
is observing repeated same-value writes but not avoiding them at these writer
sites.

## Decision

Current highest leaf:

- `applyAiAnimationSectionLayers.previewSurface`

Best low-risk optimization leaf:

- `applyAiAnimationEarlyStructureLayout.markWorkspace`
- `applyAiAnimationEarlyStructureLayout.markResourceArea`
- `applyAiAnimationEarlyStructureLayout.ensureBottomWorkspace`

The parent `previewSurface` is the biggest bucket, but it is broad and mixes
several surface operations. The 100% same-value writer evidence gives a safer
first optimization target inside early structure / marker writing.

## Is There Optimizable Repeated Writing?

Yes.

The writer evidence is strong enough to justify a small P3H optimization:

- repeated class/data marker writes are 100% same-value in P3G samples
- the same writer pairs repeat in active animation, active AI sequence,
  animation entry, and roundtrip
- active AI sequence repeat still spends `582.7ms` in
  `applyAiAnimationSectionLayers` while bypassing `aiLayerBranch`

The optimization should not target global scheduling. It should guard local
same-value marker writes while preserving first writes and surface changes.

## P3H First Cut Recommendation

P3H should make one narrow optimization, not a broad refactor:

1. Do not continue `aiLayerBranch` outer guard work.
2. Do not change global delays, `scheduleFullLayoutRefresh`, MutationObserver,
   visual rhythm, AI sequence state machine, skeleton layout, Electron IPC, UI,
   workflow, Storyboard, or Prompt Assistant.
3. Add a local same-value writer guard for the proven writer pairs:
   - `claimBottomWorkspace.class:novaflow-ai-animation-section-layers`
   - `claimBottomWorkspace.class:novaflow-ai-bottom-workspace-active`
   - `markWorkspaceLayout.data-novaflow-ai-main-workspace`
   - `markWorkspaceLayout.data-novaflow-ai-resource-sidebar-host`
   - `ensureBottomWorkspace.data-novaflow-ai-bottom-workspace`
4. Keep first-write behavior intact. If a class or marker is absent, write it.
5. If the marker already has the required value, skip the write and count it.
6. Reuse the existing writer probe fields so P3H can compare:
   - `layoutMarkerWriterAttempt`
   - `layoutMarkerWriterChanged`
   - `layoutMarkerWriterSameValue`
   - `layoutMarkerWriterSkippedSameValue`
7. Use the same P3G scenarios for Before / After.

If P3H cannot keep the guard strictly local to those writer pairs, stop and
return to probe-only. Do not broaden into `previewSurface` scheduling.

## Validation

Commands run after report creation:

```powershell
npm run phase0:check
npm run check:runtime
npm run check:entry
```

Results:

- `npm run phase0:check` completed with the expected dirty-tree warning because
  this docs-only report was still uncommitted during validation; core checks
  passed.
- `npm run check:runtime` passed.
- `npm run check:entry` returned `Overall: GO`; locked `4783` and direct
  `8188` probes were healthy.
- Diff scope remained docs-only.
