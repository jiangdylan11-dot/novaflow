# ComfyUI Usage Settlement Implementation Plan

> **Execution rule:** Follow NovaFlow `AGENTS.md`: tests first, source-of-truth edits only, runtime sync/checks, debug log, final auto-commit, and clean working tree.

**Goal:** Charge each successful ComfyUI prompt exactly once using the workflow's computed real credit cost, atomically deducting the same amount from the user's credits and the administrator's manually maintained ComfyUI balance. Unknown pricing must never block generation or fall back to a fabricated fixed charge.

**Architecture:** Put workflow price calculation in one shared pure helper used by the web renderer and Electron main process. In packaged `file:` mode, preload is the only usage observer and asks main for pricing over IPC; on the locked web surface, the renderer is the only observer. Send a stable prompt-based usage key to a Supabase RPC that owns durable idempotency, pending-pricing records, and the two balance updates in one database transaction. Local Node and Supabase Edge entrypoints call the same RPC contract.

**Agent architecture:** Root owns integration and all writes. One reviewer checks pricing/single-observer behavior, one reviewer checks SQL/RPC/admin balance behavior, and a final reviewer checks the complete diff and regression evidence. Reviews are sequential and read-only so agents never edit overlapping files.

**Execution order:** contract tests -> shared pricing -> single observer -> transactional settlement -> Edge/local parity -> admin refresh -> source sync -> full verification -> controlled live migration/reconciliation -> final review -> auto-commit.

**Primary risks:** duplicate charges after retries, partial user/provider deduction, stale admin UI, unknown-price fixed fallback, schema deployed after incompatible application code, historical reconciliation during concurrent generation, and source/dist drift.

---

## Task 1: Lock the required behavior with failing tests

**Files:**

- Modify: `particle-editor-desktop/tests/comfyui-provider-budget-usage.test.js`
- Create: `particle-editor-desktop/tests/comfyui-workflow-credit-cost.test.js`
- Create: `particle-editor-desktop/tests/comfyui-usage-settlement-contract.test.js`

1. Add a dynamic test for the two observed Kling workflows:
   - 720p + audio + `multi_shot = "1 storyboard"` + 15 seconds -> raw 398.79 and charged 399.
   - Same workflow + 10 seconds -> raw 265.86 and charged 266.
2. Add static/contract assertions that:
   - renderer-owned Electron proxy requests suppress preload authorization/commit;
   - no successful task can fall back to fixed video/image charges;
   - local server calls one settlement method instead of two balance mutations;
   - local and Edge handlers use provider key `comfyui` and stable usage keys;
   - the migration provides a unique usage key and one transactional RPC;
   - pending pricing is auditable and can later be settled.
3. Run the new tests and record the expected failures before implementation.

## Task 2: Add one shared workflow pricing authority

**Files:**

- Create: `particle-editor/comfyui-workflow-credit-cost.js`
- Modify: `particle-editor/runtime-fetch-proxy.js`
- Modify: `particle-editor/index.html`
- Modify: `particle-editor-desktop/preload.js`
- Modify: `scripts/sync-runtime.mjs`
- Modify: `scripts/check-runtime-sync.mjs`

1. Implement a pure UMD/CommonJS helper that:
   - reads explicit positive cost fields when present;
   - computes current Kling and Jimeng price-badge formulas;
   - recognizes boolean-like values and strings such as `"1 storyboard"`;
   - returns raw estimated credits plus normalized integer charge;
   - returns an explicit unknown/pending result instead of a default charge.
2. Load the helper before `runtime-fetch-proxy.js` in the source renderer entry.
3. Replace renderer inline pricing with the shared helper.
4. Load the helper in Electron main and expose a narrow pricing IPC; sandboxed preload calls that IPC for direct Electron requests.
5. Add the helper to runtime source synchronization and hash checks.
6. Run the pricing test and relevant syntax checks until green.

## Task 3: Make client usage observation single-owner and non-blocking

**Files:**

- Modify: `particle-editor/runtime-fetch-proxy.js`
- Modify: `particle-editor-desktop/preload.js`

1. In packaged `file:` mode, leave Electron JSON requests to preload so renderer does not install a second usage observer.
2. In locked web mode, retain renderer authorization/commit as the single observer; do not rely on a caller-controlled ownership flag.
3. Use prompt ID as the stable usage identity and include calculated pricing metadata.
4. Authorize unknown-price requests without blocking generation.
5. Commit only after successful Comfy history completion; failed history, retries, and repeated polling reuse the same usage key.
6. Run client-auth and settlement contract tests.

## Task 4: Add durable transactional and idempotent settlement

**Files:**

- Create: `supabase/migrations/20260710000000_comfyui_usage_settlement.sql`
- Create: `supabase/migrations/20260710001000_credits_user_id_unique.sql`
- Modify: `particle-editor-desktop/license-admin-gui/supabase-admin-schema.sql`
- Modify: `particle-editor-desktop/license-admin-gui/admin-data.js`
- Modify: `particle-editor-desktop/admin-server/server.js`

1. Add a service-only `comfy_usage_settlements` table with a unique usage key, prompt/user/provider identity, pricing status/source, charge, before/after snapshots, and timestamps.
2. Add `settle_comfy_usage(...)` as one PostgreSQL transaction that:
   - locks the settlement record and both balance rows;
   - returns the original result for an already settled usage key;
   - records unknown/zero pricing as `pending_pricing` without changing balances;
   - permits a later positive amount to settle the same pending row;
   - deducts the same normalized integer from `credits.balance` and `provider_budget_comfyui.value.balance`;
   - never blocks a completed generation because either balance is low; balances may become negative so the full real usage remains visible;
   - records both before/after values atomically.
3. Expose one `settleAdminComfyUsage` admin-data method that calls the RPC.
4. Fix provider-budget response unwrapping in the local server.
5. Replace local server's two independent balance writes and fixed fallback with the single RPC.
6. Run SQL/contract tests plus existing admin tests.

## Task 5: Align the production Edge entry and refresh admin truth

**Files:**

- Modify: `supabase/functions/novaflow-backend/index.ts`
- Modify: `particle-editor-desktop/license-admin-gui/renderer.js`
- Modify: `particle-editor-desktop/admin-server/README.md`

1. Normalize the Edge usage provider contract to `comfyui`.
2. Make Edge usage call the same `settle_comfy_usage` RPC and return the same settled/idempotent/pending payload.
3. Remove Edge fixed-price fallback and all pre-generation insufficient-balance blocking for ComfyUI usage.
4. Refresh admin data when entering Dashboard or AI Services, without adding polling.
5. Document settlement, pending pricing, and the manual-balance interpretation.
6. Run Edge/local contract tests and renderer syntax checks.

## Task 6: Sync, verify, and review

**Files:**

- Modify: `logs/debug.log`
- Generated sync targets under `particle-editor-desktop/renderer/**` and `particle-editor-desktop/dist/win-unpacked/resources/app/**`

1. Append the required debug-log entry with problem, cause, solution, and scope.
2. Run `npm run sync:runtime`.
3. Run all `particle-editor-desktop/tests/*.test.js`.
4. Run the relevant AI-sequence gateway/proxy/pricing checks.
5. Run `npm run check:runtime`, `npm run check:entry`, and `node --check` for every changed JavaScript source/target.
6. Ask the pricing reviewer and SQL reviewer to inspect the diff; address any findings and rerun focused tests.
7. Ask a final reviewer to inspect the complete diff and verification evidence.

## Task 7: Controlled live rollout and historical reconciliation

1. Confirm no active Comfy generations are in flight before any balance correction.
2. Apply the migration to the configured Supabase project and verify table/function permissions.
3. Run a controlled duplicate settlement probe with a disposable unique usage key or transaction-safe fixture; verify one deduction only and restore fixture state if applicable.
4. Re-read current provider and user balances plus the two known prompt records before correction.
5. If the evidence still matches the already identified two prompts (correct total 665, historical charged total 2000, no intervening adjustments), reconcile:
   - user balance by refunding the 1335 overcharge;
   - provider manual balance to the current Comfy baseline or by the agreed auditable adjustment;
   - write a reconciliation note/record.
6. If live facts have drifted, do not guess; report the exact delta and pause only the reconciliation step.

## Task 8: Archive the completed work

1. Run the complete verification suite one final time.
2. Run `npm run auto-commit`.
3. Run `git status` and confirm the working tree is clean.
4. Report exact changes, validation evidence, migration/reconciliation result, known residual risks, and commit hash.
