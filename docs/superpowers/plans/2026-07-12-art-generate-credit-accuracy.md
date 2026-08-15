# Art Generate Credit Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every behavior change follows RED -> GREEN and each task receives an independent spec/code-quality review.

**Goal:** Remove Art Generate resource-mention double painting, show provider credit estimates before generation, show prompt-scoped settlement results after generation, and settle GPT/Google image usage at the same decimal amount reported by the official Comfy credit ledger.

**Architecture:** Keep mention presentation and credit estimation in focused renderer modules. Keep `novaflow-brand-runtime.js` as state-to-view/event glue only. Add a fail-closed build-time AI Runtime patch that corrects GPT Image 2 token-modality pricing and emits a NovaFlow-only exact price marker; legacy one-decimal `Price:` frames are display-only and may never settle money. Preserve the existing prompt-keyed, row-locked PostgreSQL transaction while migrating only the Comfy settlement ledger to fixed-point decimals.

**Tech Stack:** Browser UMD modules, JSONata `price_badge`, Electron preload/IPC, Node tests, PowerShell Runtime packaging, Python Comfy partner nodes, Supabase/PostgreSQL numeric RPC.

## Global Constraints

- Source Runtime files under `particle-editor/` are authoritative; renderer and `dist/win-unpacked` mirrors are generated only through `npm run sync:runtime`.
- Do not modify AI Sequence pricing behavior, Kling/Seedance integer billing, Storyboard, Prompt Assistant, Bone Animation, Preview, Resource, or Export.
- New pricing business logic belongs in `art-generate-credit-pricing.tool.js`; `novaflow-brand-runtime.js` may add only dispatcher/view glue and must stay below 100 added lines.
- Pre-generation prices are estimates and must be labelled with `~`; only a backend settlement result for the same `promptId` may be shown as an actual deduction.
- Legacy `Price: 4.3 credits` is approximate display data. It must never be treated as an exact financial amount.
- Exact image amounts cross JavaScript/HTTP/RPC boundaries as canonical decimal strings matching `^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?$`.
- PostgreSQL `numeric(20,6)` is the sole financial arithmetic authority. JavaScript `Number` may be used only for non-authoritative display comparisons.
- Preserve `usage_key=comfyui:<promptId>`, payload mismatch checks, `FOR UPDATE`, atomic user/provider deduction, pending-to-settled transition, and idempotent same-amount retries.
- Missing exact price remains `pending_pricing` and deducts zero; failed/cancelled workflows deduct zero.
- Runtime packaging patches destination copies only. Do not modify the input Runtime tree or `C:\ProgramData\NovaFlow\AI-Runtime` during source implementation.
- Cross-process crash recovery is out of this change. Existing in-process retry remains; this residual risk must be reported explicitly.
- Automated verification must never enqueue a paid prompt. A real paid smoke remains separately authorized.

---

### Task 1: Art Generate mention backing visibility

**Files:**
- Modify: `scripts/check-art-generate-resource-mention-contract.mjs`
- Modify: `particle-editor/resource-mention.tool.css`

**Interfaces:**
- Consumes: existing `.nf-resource-mention-backing` and `#novaflow-art-generate-workspace` DOM ownership.
- Produces: one visible mention editor while the state-bearing textarea remains measurable but transparent/non-interactive.

- [ ] **Step 1: Write the failing contract**

  Extend the Art Generate mention contract to read `resource-mention.tool.css` and assert one scoped selector containing all of:

  ```css
  #novaflow-art-generate-workspace.novaflow-app
  .novaflow-art-generate-prompt
  textarea.nf-resource-mention-backing
  ```

  The rule must contain `color: transparent !important`, `caret-color: transparent !important`, and `pointer-events: none !important`. It must not contain `display:none` or `visibility:hidden`.

- [ ] **Step 2: Run RED**

  Run: `node scripts/check-art-generate-resource-mention-contract.mjs`

  Expected: FAIL because the high-specificity Art Generate override does not exist.

- [ ] **Step 3: Implement the minimal CSS fix**

  Add the scoped rule to `particle-editor/resource-mention.tool.css`, plus a scoped transparent placeholder rule. Do not alter `resource-mention.tool.js`, observers, signatures, or Runtime JavaScript.

- [ ] **Step 4: Run GREEN**

  Run:

  ```powershell
  node scripts/check-art-generate-resource-mention-contract.mjs
  node scripts/check-resource-mention-contract.mjs
  ```

  Expected: both pass.

---

### Task 2: Prompt-scoped Art Generate credit UI

**Files:**
- Create: `particle-editor/art-generate-credit-pricing.tool.js`
- Create: `particle-editor-desktop/tests/art-generate-credit-pricing-tool.test.js`
- Modify: `particle-editor/art-generate-mode.tool.js`
- Modify: `particle-editor/novaflow-brand-runtime.js`
- Modify: `particle-editor-desktop/preload.js`
- Modify: `particle-editor-desktop/tests/art-generate-mode-tool.test.js`
- Modify: `particle-editor-desktop/tests/art-generate-provider-runtime-contract.test.js`
- Modify: `particle-editor-desktop/tests/preload-comfyui-image-price-settlement.test.js`
- Modify: `particle-editor/index.html`
- Modify: `scripts/sync-runtime.mjs`
- Modify: `scripts/check-runtime-sync.mjs`
- Modify: `particle-editor-desktop/scripts/build-renderer.mjs`

**Interfaces:**
- Produces: `window.NovaFlowArtGenerateCreditPricing` with `createSnapshot`, `getEstimate`, `getButtonLabel`, `recordSettlement`, `getProgressView`, `resetEstimate`, and `UPDATE_EVENT`.
- Consumes: `NovaFlowArtGenerateModels.workflowSettings(...)`, `NovaFlowArtGenerateProviderWorkflow.buildWorkflow(...)`, `window.jsonata`, and read-only GET `/object_info/<nodeType>`.
- Produces: `art-generate-mode.tool.js` forwards trusted `novaflow-provider-usage-settled` payloads into `recordSettlement()` before refreshing the shared account card.

- [ ] **Step 1: Write failing module tests**

  Add tests for these exact behaviors:

  ```text
  GPT low                    -> 开始生成 · ~1-4积分
  Google text               -> 开始生成 · ~8.2积分
  Google edit 4K            -> 开始生成 · ~50.6积分
  Local                     -> 开始生成 and zero /object_info requests
  missing price_badge       -> 开始生成 · 积分待确认, no fixed fallback
  prompt A settled 4.27     -> 本次扣 4.27积分
  prompt B pending          -> 积分待官方结算, never A's amount
  failed/cancelled          -> 未扣积分
  ```

  Assert identical signatures coalesce one GET, delayed stale results never overwrite the active signature, no estimate path calls `/prompt`, and the module does not reference `NovaFlowAiSequenceCreditPricing`.

- [ ] **Step 2: Run RED**

  Run: `node --test particle-editor-desktop/tests/art-generate-credit-pricing-tool.test.js`

  Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the independent pricing tool**

  Build a UMD/CommonJS module with:

  - node mapping `gpt -> OpenAIGPTImageNodeV2`, `google/txt2img -> GeminiImageNode`, `google/img2img -> GeminiImage2Node`;
  - JSONata context generated from the same provider workflow settings used by submission;
  - node-definition promise cache keyed by `baseUrl|nodeType`, estimate cache keyed by the full provider/settings/reference signature, and prompt settlement cache keyed by `promptId`;
  - maximum cache sizes of 8 node definitions, 32 estimates, and 64 settlements;
  - stale-result suppression and bounded retry delays `250/750/1500/3000/6000ms`;
  - actual text sourced only from `settlement.charge_amount_text`, `settlement.charge_amount`, or `settlement.credits.deducted_text/deducted`, never from estimates.

- [ ] **Step 4: Add trusted settlement forwarding and Runtime glue**

  `art-generate-mode.tool.js` records `event.data.payload` in the pricing tool, then refreshes auth once. `preload.js` forwards the full backend settlement/credits/providerBudget payload with the same prompt ID.

  Runtime changes are limited to:

  - create the current Art credit snapshot;
  - call `getButtonLabel()` for the idle submit label;
  - call `getProgressView()` for an additional credit status span;
  - listen to `UPDATE_EVENT` and force only the Art bottom surface to render.

- [ ] **Step 5: Register the module and update exact cache-key assertions**

  Load `art-generate-credit-pricing.tool.js?v=20260712-art-credit-1` after JSONata and before Art Runtime. Register it in sync/check/build manifests. Replace the stale one-size-fits-all cache-key assertion with an explicit per-file map, retaining the current AI-animation key for unaffected assets and using `20260712-art-credit-1` only for files changed here.

- [ ] **Step 6: Run GREEN**

  Run:

  ```powershell
  node --test particle-editor-desktop/tests/art-generate-credit-pricing-tool.test.js particle-editor-desktop/tests/art-generate-mode-tool.test.js particle-editor-desktop/tests/art-generate-provider-runtime-contract.test.js particle-editor-desktop/tests/preload-comfyui-image-price-settlement.test.js
  node --check particle-editor/art-generate-credit-pricing.tool.js
  node --check particle-editor/art-generate-mode.tool.js
  node --check particle-editor/novaflow-brand-runtime.js
  ```

  Expected: all pass.

---

### Task 3: Fail-closed exact price Runtime package contract

**Files:**
- Create: `tools/ai-runtime/apply-runtime-patches.ps1`
- Create: `tools/ai-runtime/patches/comfy-partner-price-v1/manifest.json`
- Create: `particle-editor-desktop/tests/ai-runtime-exact-price-patch.test.js`
- Modify: `tools/ai-runtime/build-ai-runtime-package.ps1`
- Modify: `tools/ai-runtime/build-ai-runtime-installer.ps1`
- Modify: `particle-editor/art-generate-provider.workflow.js`
- Modify: `particle-editor-desktop/tests/art-generate-provider-workflow.test.js`

**Interfaces:**
- Patches destination copies of `engine/ComfyUI/comfy_api_nodes/nodes_openai.py` and `engine/ComfyUI/comfy_api_nodes/util/client.py` only.
- Base SHA256 allowlist starts with `5B668FA3FF28D80FB39D407B2F24D0325DCE5EFD55407AAF9264B8F7CA49DCAE` and `C589314EA798E3046B1C167ACE627DC8F0044FAEA4D71446F3014264C12F32F6`.
- Emits `NovaFlow-Price-Exact: 4.270000 credits` while retaining the existing human `Price:` line.
- Parser/observer exposes `{ amountText, credits, exact, source }`; legacy `Price:` is `exact:false`.

- [ ] **Step 1: Write failing patch and parser tests**

  Assert:

  - known base hash applies once;
  - unknown hash, missing file, and non-unique anchor fail;
  - reapplying an already-patched destination is idempotent;
  - patched Python passes `py_compile`;
  - GPT Image 2 fixture `image=1024, text=26, output=397` calculates USD `0.020232` and emits official credits text `4.270000`;
  - missing modality details returns no exact price rather than a fabricated amount;
  - a binary frame containing both exact and legacy lines selects the exact marker;
  - a legacy-only frame remains approximate and cannot satisfy `waitForExactPrice()`.

- [ ] **Step 2: Run RED**

  Run:

  ```powershell
  node --test particle-editor-desktop/tests/ai-runtime-exact-price-patch.test.js particle-editor-desktop/tests/art-generate-provider-workflow.test.js
  ```

  Expected: FAIL because the patcher, exact marker, and exact observer contract do not exist.

- [ ] **Step 3: Implement the staged Runtime patch**

  Patch GPT Image 2 pricing to require `input_tokens_details.image_tokens`, `input_tokens_details.text_tokens`, and `output_tokens`, verify `image + text == input_tokens`, and calculate:

  ```python
  ((image_tokens * 8.0) + (text_tokens * 5.0) + (output_tokens * 30.0)) / 1_000_000.0
  ```

  In `client.py`, use `Decimal(str(price)) * Decimal("211")`, round with `ROUND_HALF_UP` to the official two-decimal credit ledger, and emit a six-decimal machine string. Keep the original one-decimal human line for Comfy compatibility.

  The PowerShell patcher must verify base/patched hashes, require unique anchors, write UTF-8 without BOM, run Python syntax checks, and write a deterministic Runtime-root patch manifest. Both Runtime build scripts invoke it after copying into their destination.

- [ ] **Step 4: Implement the exact observer contract**

  Keep `waitForCredits()` for compatibility, add `waitForExactPrice()`, and make preload settlement consume only an exact record. An old Runtime therefore produces `pending_pricing`, not `4.3` or `5`.

- [ ] **Step 5: Run GREEN**

  Run the Task 3 test command again. Expected: all pass.

---

### Task 4: Decimal Comfy image settlement ledger

**Files:**
- Create: `supabase/migrations/20260712000000_decimal_comfy_image_settlement.sql`
- Modify: `particle-editor-desktop/license-admin-gui/supabase-admin-schema.sql`
- Modify: `particle-editor-desktop/preload.js`
- Modify: `particle-editor-desktop/admin-server/server.js`
- Modify: `particle-editor-desktop/license-admin-gui/admin-data.js`
- Modify: `supabase/functions/novaflow-backend/index.ts`
- Modify: `particle-editor/novaflow-client-auth.js`
- Modify: `particle-editor-desktop/license-admin-gui/renderer.js`
- Modify: `particle-editor-desktop/admin-server/README.md`
- Modify: `particle-editor-desktop/tests/preload-comfyui-image-price-settlement.test.js`
- Modify: `particle-editor-desktop/tests/comfyui-usage-settlement-contract.test.js`
- Modify: `particle-editor-desktop/tests/client-auth-panel-refresh.test.js`

**Interfaces:**
- Exact image request contract: `chargeAmount: "4.270000"`, `pricingSource: "comfy_api_exact_price_v1"`, `taskType: "local_workflow_image"`.
- Non-image/gateway/video integer semantics remain unchanged.
- RPC parameter `p_charge_amount numeric`; response includes canonical `charge_amount_text`, `credits.*_text`, and `provider_budget.*_text` alongside existing numeric fields.

- [ ] **Step 1: Write failing decimal contracts**

  Assert local and Edge handlers:

  - settle image exact `estimated=1.0, chargeAmount="4.270000"` as `4.270000`;
  - reject `4.2700001`, `4e0`, leading/trailing spaces, negatives, `NaN`, and `Infinity`;
  - do not call `Math.ceil` in the scoped exact-image branch;
  - retain existing integer behavior for Kling/Seedance and generic gateway paths;
  - preload sends the exact string and posts the backend's `4.27` result to the matching prompt.

  Assert SQL contains numeric balance/charge types, drops the old integer RPC signature, recreates numeric grants, and preserves unique key, locks, pending transition, and amount-mismatch rejection.

- [ ] **Step 2: Run RED**

  Run:

  ```powershell
  node --test particle-editor-desktop/tests/preload-comfyui-image-price-settlement.test.js particle-editor-desktop/tests/comfyui-usage-settlement-contract.test.js particle-editor-desktop/tests/comfyui-provider-budget-usage.test.js particle-editor-desktop/tests/client-auth-panel-refresh.test.js
  ```

  Expected: FAIL on integer/ceil contracts and rounded credit display.

- [ ] **Step 3: Add the database migration**

  In one transaction:

  1. drop the old `settle_comfy_usage(... numeric, integer, ...)` signature;
  2. alter `credits.balance`, settlement `charge_amount`, and user before/after columns to `numeric(20,6)`;
  3. recreate the function with numeric variables/parameter and the existing atomic/idempotent logic;
  4. add canonical text fields to the returned JSON;
  5. restore revoke/grant and issue `NOTIFY pgrst, 'reload schema'`.

  Update the schema snapshot to the same definition; do not rewrite the already-deployed July 10 migration.

- [ ] **Step 4: Implement scoped decimal transport**

  Add a strict canonical decimal validator in local server, Edge, and admin-data boundaries. Only `local_workflow_image + comfy_api_exact_price_v1` may use the decimal branch; all other paths retain current integer calculations. Give `chargeAmount` precedence over `estimatedCreditCost`.

  Change account and admin credit formatting to preserve up to six decimal places while quota counters remain integer-formatted.

- [ ] **Step 5: Run GREEN**

  Run the Task 4 test command again plus:

  ```powershell
  node --check particle-editor-desktop/preload.js
  node --check particle-editor-desktop/admin-server/server.js
  node --check particle-editor-desktop/license-admin-gui/admin-data.js
  node --check particle-editor/novaflow-client-auth.js
  ```

  Expected: all pass.

---

### Task 5: Integration, source sync, review, and archive

**Files:**
- Modify: `logs/debug.log`
- Generated by sync: `particle-editor-desktop/renderer/**`
- Generated by sync: `particle-editor-desktop/dist/win-unpacked/resources/app/**`

- [ ] **Step 1: Append the required debug record**

  Record the mention CSS override, missing price UI, wrong modality formula, one-decimal truncation, multi-layer ceil/integer schema, exact staged Runtime patch, decimal ledger, and affected scope using the mandated `[YYYY-MM-DD HH:mm]` format.

- [ ] **Step 2: Sync and run complete automated verification**

  Run:

  ```powershell
  npm run sync:runtime
  npm run check:runtime
  npm run check:entry
  node --test (Get-ChildItem particle-editor-desktop/tests/*.test.js | Sort-Object Name | Select-Object -ExpandProperty FullName)
  npm run check:ai-seq-credits
  node scripts/check-art-generate-resource-mention-contract.mjs
  node scripts/check-resource-mention-contract.mjs
  node --check particle-editor/novaflow-brand-runtime.js
  node --check particle-editor/art-generate-credit-pricing.tool.js
  node --check particle-editor/art-generate-provider.workflow.js
  node --check particle-editor-desktop/preload.js
  node --check particle-editor-desktop/admin-server/server.js
  node --check particle-editor-desktop/license-admin-gui/admin-data.js
  ```

- [ ] **Step 3: Build and inspect Runtime 0.2.4 without touching ProgramData**

  Use the existing unpacked Runtime as read-only input, build to `_exports/NovaFlow-AI-Runtime-Installer-0.2.4`, and verify the output contains both patched hashes, the patch manifest, `runtime.json` version `0.2.4`, and passes Runtime package checks. Do not run the installer in this step.

- [ ] **Step 4: Verify locked surfaces without paid generation**

  On `4783`, prove `1 backing + 1 editor + 1 chip`, backing transparent/non-interactive, editor usable, and GPT/Google estimates appear without `/prompt`. Verify AI Sequence credit buttons remain unchanged. In packaged Electron, verify exact-price capability readiness and that no secret appears in renderer/localStorage/logs. Do not click Generate.

- [ ] **Step 5: Review and resolve findings**

  Run one task review after each implementation task and one whole-branch review after integration. Fix every Critical/Important finding and rerun the covering tests.

- [ ] **Step 6: Final archive**

  Run `npm run auto-commit`, then `git status --short`; expected final state is clean and commit subject `auto-save: YYYY-MM-DD HH:mm:ss`.

## Accepted residual risk

If the app and Runtime both exit after the provider charge but before the exact event is committed, the task may remain pending and require manual reconciliation. It must never be rounded upward or silently marked settled. Cross-restart automated recovery requires a separate design for durable prompt ownership, account binding, and authoritative post-run cost lookup.
