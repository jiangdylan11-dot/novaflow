# NovaFlow Refactor Phase 1-5 Summary

## Baseline

- Date: 2026-06-29
- Branch: `rebuild/source-driven-runtime`
- Phase 0 baseline: `9432a7b7 chore: establish phase 0 refactor baseline`
- Latest refactor commit before this summary: `77dee73f refactor: add aifx pure helper boundary`
- Scope: Phase 1-5 safe refactor closeout summary.

This document closes the safe refactor pass. It does not authorize further Runtime splitting.

## Completed Work

| Phase | Commit | Summary |
|---|---|---|
| Phase 1 | `30ea20b1 refactor: extract safe JSON helper` | Added a local safe JSON helper in `novaflow-brand-runtime.js` and kept existing request behavior. |
| Phase 1 | `c6310b7b refactor: extract safe JSON helper in split runtime` | Extended the safe JSON helper pattern to `spine-split-runtime.js`. |
| Phase 1 | `4f7cd697 refactor: extract safe JSON helper in aifx runtime` | Extended the safe JSON helper pattern to `aifx-repaint-runtime.js`. |
| Phase 2 | `6d8749ba refactor: add dialog shell for image upscale` | Added a local dialog shell and migrated only `showImageUpscaleDialog`. |
| Phase 2 | `f0e18aa8 refactor: use dialog shell for image wash` | Reused the local dialog shell for `showImageWashDialog`. |
| Phase 2 | `2386926a refactor: use dialog shell for canvas resize` | Reused the local dialog shell for `showCanvasResizeDialog`. |
| Phase 3 | `c3127da5 refactor: add workflow task shell for image upscale` | Added minimal `runWorkflowTask` and routed only image upscale through it. |
| Phase 3 | `c1b58c8d refactor: use workflow task shell for angle adjust` | Routed only angle adjust through the existing minimal workflow task shell. |
| Phase 4 | `1605f861 refactor: add read-only split state snapshots` | Added read-only `getResourceStoreSnapshot()` and `getPreviewStateSnapshot()` on `window.NovaFlowSpineSplitBridge`. |
| Phase 5 | `77dee73f refactor: add aifx pure helper boundary` | Added an in-file `AifxPureHelpers` boundary around existing stateless AIFX helper functions. |

## Untouched Prohibited Areas

These areas were intentionally not changed during Phase 1-5:

- Storyboard V5 behavior and workflow.
- Prompt Assistant service and IPC behavior.
- Comfy workflow JSON content.
- Electron IPC business logic.
- AI sequence animation / skeleton animation switching logic.
- Export business logic.
- Resource state replacement.
- Preview global state replacement.
- `index.html` Runtime script loading order.
- Physical Runtime module loading chain.

## High-Risk Modules Still Not Split

| Module | Reason to keep in place for now |
|---|---|
| `ui-navigation` | Coupled to primary/secondary entry state, body classes, Storyboard workspace recovery, and mounted Runtime surfaces. |
| `ui-preview` | Coupled to `viewMode`, canvas layout, preview refresh timers, and multiple editor modes. |
| `resources` | Coupled to `sourceResources`, `splitSets`, active ids, resource card rendering, and result append behavior. |
| `workflows` | Coupled to upload, workflow building, `/prompt`, `/history`, `/view`, error handling, and result resources. |
| `export` | Coupled to Electron file APIs, source resolution, modal state, and multiple product surfaces. |
| `animation` | Coupled to AI sequence state, skeleton state, preview state, and export state. |
| `artboard/drawing` | Coupled to canvas sessions, brush state, mask/pen/healing state, selection state, and preview refresh. |
| `debug/helpers` beyond pure helpers | Some helpers are safe, but others read or mutate live DOM/debug state and should stay local until audited. |

## Current Recommendation

Do not continue physical Runtime splitting immediately. Phase 5B reached the current safe boundary.

Recommended next track:

1. Run performance governance first.
2. Measure real locked `4783` behavior around layout refresh, DOM scans, mutation observers, preview redraw, and startup loops.
3. Use that evidence to decide which module boundary will reduce real risk or cost.
4. Only then consider physical Runtime modules, with a dedicated loader/sync/check plan.

Physical module extraction should require a separate approval because it may affect script loading order, mirror synchronization, and rollback complexity.

## Rollback Guidance

Preferred rollback is commit-based and reverse chronological:

```powershell
git revert 77dee73f
git revert 1605f861
git revert c1b58c8d
git revert c3127da5
git revert 2386926a
git revert f0e18aa8
git revert 6d8749ba
git revert 4f7cd697
git revert c6310b7b
git revert 30ea20b1
```

For a focused rollback, revert only the affected phase commit. Do not use `git reset --hard` unless the owner explicitly approves it and unrelated work has been checked.

After any rollback that touches Runtime files, run the normal mirror and entry checks before accepting the rollback:

```powershell
npm run sync:runtime
npm run phase0:check
npm run check:runtime
npm run check:entry
node --check particle-editor/novaflow-brand-runtime.js
node --check particle-editor/spine-split-runtime.js
node --check particle-editor/aifx-repaint-runtime.js
node --check particle-editor-desktop/main.js
```

## Verification Commands

Closeout validation should run:

```powershell
npm run phase0:check
npm run check:runtime
npm run check:entry
node --check particle-editor/novaflow-brand-runtime.js
node --check particle-editor/spine-split-runtime.js
node --check particle-editor/aifx-repaint-runtime.js
node --check particle-editor-desktop/main.js
```

`check:entry` validates the locked `4783` entry chain and Runtime script integration. It does not replace targeted manual UI smoke tests for future user-facing changes.

## Closeout Decision

Phase 1-5 is complete as the safe refactor pass:

- helper extraction stayed local and low risk;
- dialog shell work migrated only low-risk dialogs;
- workflow task shell remained a thin wrapper and did not change workflow JSON;
- resource/preview adapters are read-only snapshots only;
- Runtime physical splitting stopped at an in-file pure helper boundary.

The next engineering step should be performance governance, not more Runtime splitting.
