# Art Generate Dropdown Unified Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Art Generate provider and parameter dropdown use NovaFlow's existing 58% global dropdown mask without regressing its high-layer, click-through, or performance protections.

**Architecture:** Keep `usesNovaflowModalDropdownLayer(trigger)` as the Art Generate layering policy so its overlay and portal remain above the high-z left workspace and `clampDropdownBlockingLayers()` remains skipped. Change only the overlay visual policy so Art Generate-owned selects use `rgba(0, 0, 0, 0.58)`; export-modal selects remain transparent.

**Tech Stack:** JavaScript Runtime shell, Node.js contract tests, NovaFlow runtime sync scripts.

## Global Constraints

- Modify only the source Runtime `particle-editor/novaflow-brand-runtime.js`; never directly edit renderer or win-unpacked mirrors.
- Do not change Art Generate workflows, provider state, account authentication, pricing, settlement, or generation parameters.
- Preserve modal-layer z-index `2147483641/2147483642`, click-outside close, and the Art Generate exemption from the 80 ms full-DOM clamp scan.
- Append `logs/debug.log`, run runtime sync/check/entry validation, then use `npm run auto-commit` and finish with a clean working tree.

---

### Task 1: Separate Art Generate mask visuals from its high-layer policy

**Files:**
- Modify: `particle-editor-desktop/tests/art-generate-provider-runtime-contract.test.js:74-98`
- Modify: `particle-editor/novaflow-brand-runtime.js:2849-2863,3603-3612`
- Modify: `logs/debug.log`

**Interfaces:**
- Consumes: `NovaFlowArtGenerateModeTool.ownsSelect(trigger): boolean`, `isNovaflowExportModalDropdownTrigger(trigger): boolean`.
- Produces: Art Generate dropdown overlay background `rgba(0, 0, 0, 0.58)` while `usesNovaflowModalDropdownLayer(artTrigger)` stays `true`.

- [ ] **Step 1: Write the failing visual-policy contract**

Update the Runtime contract test so an Art Generate trigger expects the standard mask and an export-modal trigger still expects transparency:

```js
const exportTrigger = {};
// In overlayContext:
isNovaflowExportModalDropdownTrigger(trigger) { return trigger === exportTrigger; },

assert.equal(
  artOverlay.styles.get("background"),
  "rgba(0, 0, 0, 0.58)",
  "Art Generate dropdowns must use the global dropdown mask",
);
overlayContext.DROPDOWN_CONTROLLER.activeTrigger = exportTrigger;
const exportOverlay = new FakeOverlayElement();
overlayContext.syncOverlay(exportOverlay);
assert.equal(
  exportOverlay.styles.get("background"),
  "transparent",
  "export-modal dropdowns must retain their transparent modal backdrop",
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node particle-editor-desktop/tests/art-generate-provider-runtime-contract.test.js
```

Expected: FAIL because the Art Generate overlay currently resolves to `transparent`.

- [ ] **Step 3: Implement the minimal visual-policy fix**

Keep `usesNovaflowModalDropdownLayer()` and `clampDropdownBlockingLayers()` unchanged. In `syncGlobalDropdownOverlayVisualState()`, derive transparency only from the export-modal classification:

```js
const exportModalDropdown = isNovaflowExportModalDropdownTrigger(DROPDOWN_CONTROLLER.activeTrigger);
const clearOverlay = exportModalDropdown;
const background = clearOverlay ? "transparent" : "rgba(0, 0, 0, 0.58)";
```

- [ ] **Step 4: Verify GREEN and full regression tests**

Run:

```powershell
node particle-editor-desktop/tests/art-generate-provider-runtime-contract.test.js
node --test particle-editor-desktop/tests/*.test.js
```

Expected: focused contract passes; full desktop suite reports zero failures.

- [ ] **Step 5: Sync and validate the accepted Runtime surfaces**

Run:

```powershell
npm run sync:runtime
npm run check:runtime
npm run check:entry
node --check particle-editor/novaflow-brand-runtime.js
git diff --check
```

Expected: Runtime sync/check pass, locked `4783` reports `Overall: GO`, syntax and diff checks pass.

- [ ] **Step 6: Perform live DOM acceptance**

On locked `4783`, open these dropdowns and inspect `#novaflow-global-dropdown-overlay`:

- Model provider: Local / GPT / Google.
- GPT: quality and size.
- Google: aspect ratio and resolution.

For every Art Generate dropdown, assert:

```text
background-color = rgba(0, 0, 0, 0.58)
overlay z-index = 2147483641
panel z-index = 2147483642
workspace is still visible and not data-novaflow-dropdown-z-clamped
outside click closes the dropdown
```

- [ ] **Step 7: Record and commit**

Append the required bug record to `logs/debug.log`, then run:

```powershell
npm run auto-commit
git status
```

Expected: an `auto-save: YYYY-MM-DD HH:mm:ss` commit is created and the working tree is clean.
