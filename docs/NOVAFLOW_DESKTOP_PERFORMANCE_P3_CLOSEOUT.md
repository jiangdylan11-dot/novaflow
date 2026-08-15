# NovaFlow Desktop Performance P3 Closeout

## Scope

- Phase: Desktop Performance P3 closeout
- Baseline commit: `5e2238ea77127298efbde5e11d0eb6513c306932`
- Change type: docs-only closeout report
- Runtime changes in P3I: none
- UI / workflow / Storyboard / Prompt Assistant / Electron IPC changes in P3I: none
- Final retest surface: Desktop Electron `win-unpacked`
- Final retest method: real Desktop window and real OS mouse input; CDP was used only for in-memory probe readback and error-event counting

P3I intentionally stops the Desktop performance phase. It does not add guards,
does not add probe code, and does not continue optimization work.

## P3 Timeline

| Phase | Commit | Purpose | Result |
| --- | --- | --- | --- |
| P3B | `eb6d1aee65d7005cf2e3cfda0a058fccf154ea4f` | Added `window.__NFDesktopPerfProbe` and Desktop electronAPI timing wrapper. | Desktop/Web runtime script list was the same. Desktop-specific difference was the real preload -> `ipcRenderer` -> main process chain, but sampled switch windows did not capture completed `electronAPI` methods. |
| P3C | `f5a6ed5f31e03a8db15b7404772f4cb67132f137` | Added Desktop real-mouse manual baseline report. | 15 Desktop samples showed the strongest hotspots in renderer layout / visual rhythm / animation layer sync. Roundtrip was the heaviest path. |
| P3D | `910f73b40324f8cb6cfa2abb61353e83d60ee1e5` | Added fine hotspot attribution. | Effects: `normalizeNovaflowVisualRhythm.computeStyle`. Animation: `applyPreviewRuntimeLayout.aiLayerBranch`. Roundtrip stacked both families. |
| P3E | `2f9f84161727ba963ba62e35ce32d509b4e0765e` | Added conservative `applyPreviewRuntimeLayout.aiLayerBranch` same-signature guard. | No sampled regression, but `aiLayerBranchGuardSkipped` stayed `0`, so the observed timing improvement could not be attributed to the guard. |
| P3F | `446fed623d8c4cbae1c73c16f4ef18dcaba812a3` | Validated the P3E guard in no-op repeat refresh scenes. | Active animation repeat reached the guard but still had `attempt 15 / run 15 / skipped 0`. AI sequence and skeleton repeats bypassed the guard. |
| P3G | `de0010ab62b264f386d8b11e72ee3e0a41fa7565` | Read-only decision pass for lower-level AI layer leaves. | Highest parent leaf was `applyAiAnimationSectionLayers.previewSurface`. Five marker/class writer pairs were proven 100% same-value and suitable for a small local guard. |
| P3H | `5e2238ea77127298efbde5e11d0eb6513c306932` | Added local same-value guards for the five proven writer pairs. | All five writer pairs hit `layoutMarkerWriterSkippedSameValue`. Animation primary improved clearly; active animation repeat improved modestly; AI sequence was flat; roundtrip remained noisy. |

## Desktop vs Web Difference

P3 did not find a different renderer/runtime script list between Web `4783` and
Desktop `win-unpacked`. The meaningful difference is runtime environment:

- Web `4783` and Desktop load the same renderer/runtime list.
- Desktop has the real Electron preload / `ipcRenderer` / main-process chain.
- P3B, P3C, P3D, P3E, P3H, and the P3I short retest did not capture completed
  `electronAPI` methods during the sampled entry-switch windows.
- The observed Desktop slowdown was instead concentrated in renderer-side
  layout/style work and animation layer synchronization.

Directional P3B Web comparison:

| Scenario | Desktop | Web `4783` | Interpretation |
| --- | ---: | ---: | --- |
| Particle / effects `runFullLayoutRefresh` | about `742ms` | about `331ms` | Desktop higher |
| Particle / effects `normalizeNovaflowVisualRhythm` | about `653ms` | about `267ms` | Desktop higher |
| Animation primary | Desktop slightly higher | Web lower | Smaller gap than effects |
| AI sequence | close | close | Not the largest Desktop/Web gap |
| Skeleton | Desktop slightly higher | Web lower | Mostly RAF/activity signal |

The Web comparison is directional, not strict A/B, because the later Desktop
passes used real Desktop windows and real OS mouse input.

## IPC Judgment

Current P3 judgment: Desktop entry-switch stutter is not currently proven to be
IPC-driven.

Evidence:

- P3B Desktop probe did not capture completed `electronAPI` method records in
  the sampled windows.
- P3C repeated that result across 15 Desktop real-mouse samples.
- P3D, P3E, P3H, and P3I also recorded Desktop `electronAPI` method count `0`
  in their sampled windows.
- Hotspot attribution repeatedly pointed at renderer-side functions:
  `runFullLayoutRefresh`, `normalizeNovaflowVisualRhythm`,
  `applyPreviewRuntimeLayout`, and `applyAiAnimationSectionLayers`.

This does not prove IPC is always free. It means P3 did not find IPC as the
active cause of the observed section-switch stutter.

## Final P3I Short Retest

Each scenario was sampled once for about 9 seconds.

| Scenario | `runFullLayoutRefresh` | `applyPreviewRuntimeLayout` | `applyAiAnimationSectionLayers` | `normalizeNovaflowVisualRhythm` | Desktop methods | Page errors | Console errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Particle / effects entry | 443.9ms | 74.3ms | 3.7ms | 425.8ms | 0 | 0 | 4 |
| Animation primary entry | 553.1ms | 385.1ms | 492.1ms | 157.1ms | 0 | 0 | 1 |
| AI sequence entry | 0.0ms | 155.8ms | 396.8ms | 0.0ms | 0 | 0 | 1 |
| Skeleton entry | 0.0ms | 2.8ms | 0.0ms | 0.0ms | 0 | 0 | 0 |
| Animation -> effects -> animation | 761.3ms | 331.2ms | 371.7ms | 557.1ms | 0 | 0 | 1 |

The final retest is a smoke-style closeout sample, not a replacement for the
3-sample P3C/P3D/P3G/P3H comparisons.

## P3H Benefit

P3H is worth keeping because it is narrow and has a real skip signal:

- the five target writer pairs all hit `layoutMarkerWriterSkippedSameValue`
- `layoutMarkerWriterChanged` stayed `0` for those pairs in P3H samples
- first writes and surface-change writes are preserved
- no sampled page/console error regression was observed in P3H

Measured effect:

- Animation primary entry improved clearly in P3H.
- Active animation repeat improved modestly.
- AI sequence repeat was essentially neutral.
- Roundtrip remained noisy and should not be claimed as stably improved.

P3H should be treated as a local cleanup of proven duplicate marker writes, not
as a broad solution for Desktop animation jank.

## P3E Guard Value

The P3E `aiLayerBranch` guard has limited current value.

Reason:

- P3E entry-switch samples had `aiLayerBranchGuardSkipped = 0`.
- P3F no-op repeat validation also had `attempt 15 / run 15 / skipped 0` for
  the active animation repeat case that reached the guard.
- Active AI sequence repeat still spent time in `applyAiAnimationSectionLayers`
  while bypassing `applyPreviewRuntimeLayout.aiLayerBranch`.

Current recommendation:

- Do not continue tuning the outer `aiLayerBranch` guard.
- Do not claim it as the cause of the P3E timing drop.
- It can remain short term because P3E/P3F did not show sampled regression, but
  if it continues to record zero skips in future work, it should be considered
  temporary probe/guard debt rather than a meaningful optimization.

## Remaining Hotspots

Current remaining hotspot families:

1. Particle / effects:
   - `normalizeNovaflowVisualRhythm`
   - especially style/compute-style related work
   - coupled with `runFullLayoutRefresh`

2. Animation:
   - `applyAiAnimationSectionLayers.previewSurface`
   - `applyPreviewRuntimeLayout`
   - lower-level early structure/layout work after the marker guard is smaller
     but still present

3. AI sequence:
   - still enters `applyAiAnimationSectionLayers`
   - can bypass `applyPreviewRuntimeLayout.aiLayerBranch`, so outer branch work
     cannot solve it

4. Skeleton:
   - switch entry itself is not a major duration bucket in current probes
   - sustained timeline RAF activity remains a separate possible investigation,
     not part of the P3H marker guard path

## Why Not Keep Digging This P3 Chain

Further work on the current P3 chain is not recommended right now.

Reasons:

- The outer `aiLayerBranch` guard direction was directly tested and did not
  skip.
- The marker guard direction already took the safest proven 100% same-value
  writes; broadening it without new evidence would raise regression risk.
- The remaining hotspots are broad parent buckets like `previewSurface` and
  visual-rhythm style reads, which need fresh attribution before any behavior
  change.
- The Runtime is already large and sensitive. More micro-optimizations inside
  the same giant file increase maintenance cost unless each one has strong
  Before / After evidence.
- P3 has enough evidence to classify the problem and land one safe local win.
  Continuing the same phase would mostly produce diminishing returns.

## Next Recommendation

Close P3 at P3H/P3I.

Recommended next work should be a new phase only if the Desktop lag remains a
release blocker:

1. Start P4A as probe-only, not optimization.
2. Split `applyAiAnimationSectionLayers.previewSurface` into smaller buckets:
   - preview root locating
   - preview geometry sync
   - CSS variable writes
   - bottom workspace style application
   - resource/sidebar surface sync
3. Split `normalizeNovaflowVisualRhythm.computeStyle` only if effects entry
   remains the next priority.
4. Do not modify global scheduling, MutationObserver, visual rhythm behavior,
   AI sequence state machine, skeleton layout, Electron IPC, Runtime Manager,
   UI, workflow, Storyboard, or Prompt Assistant without a new Before / After
   plan.
5. Prefer release-stability and refactor governance over continued Runtime
   growth if performance is acceptable after P3H.

## Validation

Commands run after adding this closeout report:

```powershell
npm run phase0:check
npm run check:runtime
npm run check:entry
node --check particle-editor/novaflow-brand-runtime.js
node --check particle-editor/spine-split-runtime.js
node --check particle-editor/aifx-repaint-runtime.js
node --check particle-editor-desktop/main.js
```

Results:

- `node --check particle-editor/novaflow-brand-runtime.js` passed.
- `node --check particle-editor/spine-split-runtime.js` passed.
- `node --check particle-editor/aifx-repaint-runtime.js` passed.
- `node --check particle-editor-desktop/main.js` passed.
- `npm run phase0:check` completed with the expected dirty-tree warning because
  this closeout report was uncommitted during validation; core checks passed.
- `npm run check:runtime` passed.
- `npm run check:entry` returned `Overall: GO`; locked `4783` and direct
  `8188` probes were healthy.
