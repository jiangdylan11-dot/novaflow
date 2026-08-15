# Primary Animation Entry Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every visible intermediate state when entering top-level Animation, especially from Art and Particle, by publishing the Animation body classes and NovaFlow-owned layout exactly once after the React Animation owner has mounted.

**Architecture:** Replace the Art-only handoff and the non-Art prepaint shell with one source-aware primary-entry transaction. A small `primary-entry-transition.bridge.js` owns transaction state; Electron main/preload expose one narrow in-memory `webContents.capturePage()` bridge; `primary-entry-transition.preview.js` owns the compositor-frame Preview lifecycle; `novaflow-brand-runtime.js` remains the dispatcher that captures intent, replays the real React route once, reads mounted-owner evidence, and releases the frozen source after the atomic commit receives two paint opportunities. No DOM clone, WebGL copy, CSS conceal patch, native ViewTransition, or hashed bundle edit is used.

**Tech Stack:** Electron renderer, browser JavaScript, Node.js contract tests, NovaFlow Runtime sync pipeline, Windows desktop acceptance testing.

## Scope and constraints

- Authoritative source files only: the two primary-entry modules, `novaflow-brand-runtime.js`, source `index.html`, and the narrow desktop `main.js`/`preload.js` capture bridge.
- Runtime mirrors are updated only through `npm run sync:runtime`.
- Remove the Art-only handoff implementation instead of layering a generic path on top of it.
- Do not edit the hashed React bundle, introduce CSS selector fixes, clone source DOM/canvas/WebGL, use native ViewTransition, add a black mask, or retain `primary-pre-intent` as a fallback.
- Preserve the existing React route owner, mounted snapshot, atomic commit, AI Sequence defaults, Skeleton behavior, resource sidebar, preview layout, and unrelated primary-entry behavior.
- The watchdog may retry or cancel through the same transaction API; it must never become a second publication path and must never leave a pending lock after timeout.
- Use TDD: observe focused contracts failing before production implementation.
- Append the required bug record to `logs/debug.log`.
- Run the full Runtime/entry checks and desktop first-frame acceptance before `npm run auto-commit`; finish with a clean worktree.

## Runtime allocation review

- The dedicated bridge and Preview modules contain 358 lines of transaction-state and compositor-frame implementation outside Runtime.
- The authoritative Runtime diff is `+439/-162` (net `+277`), below the 300-line re-evaluation threshold after the Art-only handoff is removed.
- The remaining Runtime code is dispatcher, adapter, compatibility, and lifecycle glue. It must coordinate private owners already held by Runtime (`PRIMARY_SWITCH_TOKEN`, the mounted-owner snapshot, the global mutation observer, `ART_GENERATE_STATE`, and Art Generate activation). Moving that glue into another module would require exporting those private owners and create a second state bridge, increasing synchronization and regression risk.
- No Dialog, Workflow, Resource, Export, or AI business implementation is added to Runtime.

---

### Task 1: Contract the source-aware transaction state machine

**Files:**
- Create: `scripts/check-primary-animation-entry-transaction.mjs`
- Create: `particle-editor/primary-entry-transition.bridge.js`

- [ ] Add a Node/VM contract covering `begin(sourceIndex, 1)`, repeated intent idempotence, token bind, saved-source publication while pending, stale-token rejection, exactly-once commit, cancellation, and timeout cleanup.
- [ ] Run the contract before the bridge exists and record RED.
- [ ] Implement the smallest browser bridge that satisfies the state contract without DOM access or timers.
- [ ] Run the focused state-machine contract and record GREEN.

### Task 2: Contract the unified Runtime integration

**Files:**
- Modify: `scripts/check-ai-seq-animation-perf-contract.mjs`
- Test: `scripts/check-ai-seq-animation-perf-contract.mjs`

- [ ] Replace Art-only assertions with contracts requiring all non-Animation source indexes to start the same transaction.
- [ ] Require capture to avoid body/layout publication and prohibit `primary-pre-intent`.
- [ ] Require the global Brand mutation observer to call the token-owned mounted commit before general mutation scheduling.
- [ ] Require pending body-class sync to return the transaction's saved source index rather than hard-coded Art.
- [ ] Require the bounded settle/watchdog to clear stale transactions and locks without publishing a second layout.
- [ ] Require removal of all `ART_TO_ANIMATION_PRIMARY_HANDOFF_*` and Art-only handoff functions.
- [ ] Run the focused integration contract and record RED.

### Task 3: Replace the Art-only handoff with the unified transaction

**Files:**
- Modify: `particle-editor/novaflow-brand-runtime.js`
- Modify: `particle-editor/index.html`
- Modify: `scripts/sync-runtime.mjs`
- Modify: `scripts/check-runtime-sync.mjs`
- Create: `particle-editor/primary-entry-transition.preview.js`
- Modify: `particle-editor-desktop/main.js`
- Modify: `particle-editor-desktop/preload.js`

- [ ] Load the bridge before Brand Runtime and register it in Runtime synchronization/integrity checks.
- [ ] Replace Art-only flags, observer, begin/bind/complete/clear functions with thin adapters around the bridge.
- [ ] On Animation capture, derive the actual current primary source index and begin the transaction for every non-Animation source; do not publish Animation body classes or source-layout mutations.
- [ ] Bind the transaction to `PRIMARY_SWITCH_TOKEN` during post activation.
- [ ] At the start of the existing global Brand mutation callback, attempt the existing mounted atomic commit once using the real React snapshot, then complete the transaction.
- [ ] Preserve the saved source body class until commit and make all refresh paths transaction-aware.
- [ ] Make the bounded settle use the same commit method and cancel/clear on route exit, stale token, or timeout.
- [ ] Remove `primary-pre-intent`, the dedicated Art subtree observer, hard-coded Art fallback, and all Art-only handoff names.
- [ ] Capture the invoking BrowserWindow compositor frame in memory, decode it before replay, isolate it in a closed ShadowRoot, block input, and release only after the mounted commit plus two RAFs.
- [ ] Fail closed on Electron capture errors; browser-only preview may use the same mounted transaction without the desktop capture bridge.
- [ ] Run both focused contracts and `node --check` on every modified JavaScript file.

### Task 4: Synchronize, record, and verify the shipped surface

**Files:**
- Modify: `logs/debug.log`
- Generated by sync only: `particle-editor-desktop/renderer/*`
- Generated by sync only: `particle-editor-desktop/dist/win-unpacked/resources/app/renderer/*`

- [ ] Append the debug record with problem, root cause, solution, and impact scope.
- [ ] Run `npm run sync:runtime`.
- [ ] Run `npm run check:runtime`, `npm run check:entry`, both focused contracts, and `node --check`.
- [ ] Restart/refresh the shipped desktop renderer and capture Art→Animation and Particle→Animation at immediate, ~120 ms, and settled frames.
- [ ] Confirm no raw Runtime address/account UI, 312 px source sidebar, partial source structure, overlay, or mixed old/new body state appears in any sampled first frame.
- [ ] Confirm Animation→Art, Animation→Particle, Skeleton/AI secondary switching, and stable Animation re-entry remain intact.

### Task 5: Review and archive

- [ ] Run a focused code review for scope, state cleanup, self-mutation re-entry, and mirror integrity.
- [ ] Run `git diff --check` and inspect the final diff/stat.
- [ ] Run `npm run auto-commit`.
- [ ] Run `git status` and confirm `working tree clean`.
