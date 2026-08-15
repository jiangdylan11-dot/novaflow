# NovaFlow Desktop Performance P3F AI Layer Guard Validation

## Scope

- Phase: Desktop Performance P3F AI layer guard validation
- Baseline commit: `2f9f84161727ba963ba62e35ce32d509b4e0765e`
- Change type: docs-only validation report
- Runtime changes: none
- Sampling surface: Desktop Electron `win-unpacked`
- Sampling method: real Desktop window and real OS mouse input; CDP was used only for in-memory probe readback
- Sample window: about 9 seconds per sample
- Sample count: 3 samples per scenario

This pass validates whether the P3E `applyPreviewRuntimeLayout.aiLayerBranch`
same-signature guard can skip in no-op repeat refresh scenarios. It does not
change Runtime, UI, workflow, Storyboard, Prompt Assistant, Electron IPC,
guards, scheduling, or performance behavior.

## Trigger Method

No safe public `window` refresh method was exposed for this surface. The
available `window` entries included probe/debug functions and runtime binding
flags, but no explicit safe layout-refresh API.

Therefore the validation used the requested UI fallback:

1. Enter the target surface and verify state.
2. Start `window.__NFDesktopPerfProbe` and `window.__NFAnimationPerfProbe`.
3. Repeat-click the currently active entry with real OS mouse input.
4. Stop probes after about 9 seconds.

State verification used body classes and visible active secondary entries so
hidden stale secondary buttons did not contaminate the result.

## No-op Repeat Summary

Mean values across 3 samples:

| Scenario | Repeat target | Clicks / sample | `runFullLayoutRefresh` | `applyPreviewRuntimeLayout` count | `applyPreviewRuntimeLayout.aiLayerBranch` | `applyAiAnimationSectionLayers` | Guard run / skip / attempt | Page errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Animation primary active repeat | active `动画` primary entry | 5.0 | 1022.4ms | 5.0 | 564.6ms | 564.2ms | 5.0 / 0.0 / 5.0 | 0 |
| AI sequence active repeat | active `AI序列动画` secondary entry | 5.0 | 0.0ms | 0.0 | 0.0ms | 534.8ms | 0.0 / 0.0 / 0.0 | 0 |
| Skeleton active repeat | active `骨骼动画` secondary entry | 5.0 | 0.0ms | 0.0 | 0.0ms | 0.0ms | 0.0 / 0.0 / 0.0 | 0 |

Desktop `electronAPI` completed method count was `0` in all samples.

## Guard Signature Counts

| Scenario | Signature counts |
| --- | --- |
| Animation primary active repeat | `aiLayerBranchGuardSignature.ai-sequence`: 15 |
| AI sequence active repeat | none |
| Skeleton active repeat | none |

The animation primary no-op repeat scenario is the only one that actually
exercised `applyPreviewRuntimeLayout.aiLayerBranch`.

## Findings

### Did no-op repeat hit skip?

No.

The only scenario that reached the guard was active primary `动画` repeat. It
produced 15 total guard attempts across 3 samples:

- `aiLayerBranchGuardAttempt`: 15
- `aiLayerBranchGuardRun`: 15
- `aiLayerBranchGuardSkipped`: 0

### Why did it not skip?

The most likely reason is that the P3E signature is too fine for this no-op
repeat case.

The visible surface remained stable:

- before and after state stayed `animation/aiSequence`
- signature type stayed `ai-sequence`
- no page errors were recorded

Despite that, each active primary repeat still ran the branch. Since P3E added
mutation batch / flush tokens and several state markers to stay conservative,
the signature value can change even when the user-visible surface does not.
This prevents same-signature skip from proving value in the intended no-op
repeat case.

### What about AI sequence repeat?

Active `AI序列动画` secondary repeat did not go through
`applyPreviewRuntimeLayout.aiLayerBranch`.

It still ran `applyAiAnimationSectionLayers` about 5 times per sample, with
average duration `534.8ms`, but guard counters stayed at zero. That means the
P3E guard cannot address this active-secondary repeat path.

### What about skeleton repeat?

Active `骨骼动画` secondary repeat did not go through
`applyPreviewRuntimeLayout.aiLayerBranch` and did not call
`applyAiAnimationSectionLayers`. The skeleton timeline RAF continued at about
`593.3` ticks per 9-second sample.

## Recommendation

Do not continue the `aiLayerBranch` outer-guard direction as the next
optimization path.

The P3E guard did not skip in the one no-op repeat scenario that reached it,
and the other repeat scenarios bypassed it entirely. Further work on this outer
guard would likely tune signature granularity without proving a direct
performance win.

P3E guard retention:

- Short term: acceptable to keep while P3G gathers lower-level data, because P3E
  showed no sampled regression and the counters are useful.
- Long term: do not keep it as a claimed optimization unless later samples show
  non-zero `aiLayerBranchGuardSkipped`. If it remains zero, remove it or treat
  it as temporary probe debt.

## P3G Recommendation

P3G should move below the outer branch guard.

Recommended first cut:

1. Keep P3G probe-only or one narrowly guarded lower-level optimization.
2. Target repeated work inside `applyAiAnimationSectionLayers`, because active
   AI sequence repeat still spends about `534.8ms` there while bypassing
   `applyPreviewRuntimeLayout.aiLayerBranch`.
3. Start with lower-level leaves already identified by P3D:
   - `applyAiAnimationSectionLayers.locateSections`
   - `applyAiAnimationSectionLayers.earlyStructureLayout`
   - `applyAiAnimationEarlyStructureLayout.markResourceArea`
   - `applyAiAnimationEarlyStructureLayout.markWorkspace`
   - `applyAiAnimationEarlyStructureLayout.ensureBottomWorkspace`
4. Do not change global refresh delays, MutationObserver behavior, or
   `normalizeNovaflowVisualRhythm` in P3G.

If P3G chooses to optimize rather than probe, it should guard a lower-level
leaf with a local same-surface / same-node-set signature and Before / After
data, instead of widening the `aiLayerBranch` guard.

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
