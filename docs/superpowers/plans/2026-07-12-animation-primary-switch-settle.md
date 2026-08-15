# Animation Primary Switch Settle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicate AI Sequence section/state synchronization from the top-level Animation entry and replace the upload area's fixed two-second refresh tail with a signature-stable bounded settle.

**Architecture:** Preserve the existing React route owner and Brand Runtime compatibility layer. Prime the default AI Sequence secondary state before the full atomic commit, defer the prime function's own section/state pass, and let the atomic refresh context own the single section/state synchronization. Keep upload compatibility behavior intact while replacing six fixed late timeouts with short frame convergence plus one 180 ms live-DOM fallback.

**Tech Stack:** Electron renderer, browser JavaScript, Node.js static contract scripts, PowerShell verification, NovaFlow locked `4783` runtime.

## Global Constraints

- Edit only the authoritative source Runtime `particle-editor/novaflow-brand-runtime.js`; update renderer and `dist/win-unpacked` Runtime mirrors only through `npm run sync:runtime`.
- Do not modify the React bundle, Effect Preview passes, Electron host, `spine-split-runtime.js`, `aifx-repaint-runtime.js`, AI workflows, resource schemas, exports, or unrelated UI.
- Preserve `SECONDARY_USER_SELECTED_BY_GROUP`, remembered-skeleton guards, skeleton mount evidence, AI Sequence quiet-window handling, AutoFit scheduling, and `[0, 32, 120]` resource-mode chrome restore; do not expand this task into changing the existing cross-primary-route default-to-AI behavior.
- Preserve native input/proxy click, change, drop, delete, rejection, and six-slot routing behavior.
- If a scheduled upload synchronization throws, clear the frame/timer/pending state before rethrowing so later mutations can recover and the original error remains visible.
- Use TDD: each production behavior requires a contract that is observed failing before implementation and passing afterward.
- Append the required bug record to `logs/debug.log`.
- Run `npm run sync:runtime`, `npm run check:runtime`, `npm run check:entry`, `node --check`, focused regressions, `npm run auto-commit`, and confirm a clean working tree.
- Do not make intermediate manual commits; the project-required `npm run auto-commit` is the single archival commit.

---

### Task 1: Contract the single-owner Animation entry

**Files:**
- Modify: `scripts/check-ai-seq-animation-perf-contract.mjs`
- Test: `scripts/check-ai-seq-animation-perf-contract.mjs`

**Interfaces:**
- Consumes: `getFunctionBody(name)` and the current Brand Runtime source text.
- Produces: a static contract that requires default-state priming before the full atomic commit and a deferred prime-owned section/state pass.

- [x] **Step 1: Add the failing entry contract**

```js
const primaryPostActivationFunction = getFunctionBody("handlePrimaryEntryPostActivation");
const defaultPrimeIndex = primaryPostActivationFunction.indexOf("primeAiSequenceDefaultForPrimaryAnimationEntry");
const fullAtomicCommitIndex = primaryPostActivationFunction.indexOf(
  'commitPrimaryAnimationEntryState("primary-post-activation"'
);
assert(
  defaultPrimeIndex >= 0 && fullAtomicCommitIndex >= 0 && defaultPrimeIndex < fullAtomicCommitIndex,
  "Primary Animation entry must prime the default AI Sequence state before the full atomic DOM sync"
);
assert(
  /primeAiSequenceDefaultForPrimaryAnimationEntry\s*\(\s*\{\s*deferSectionStateSync:\s*true\s*\}\s*\)/.test(primaryPostActivationFunction),
  "Primary Animation entry must defer the prime-owned section/state sync to the atomic commit"
);

const defaultPrimeFunction = getFunctionBody("primeAiSequenceDefaultForPrimaryAnimationEntry");
assert(
  defaultPrimeFunction.includes("const deferSectionStateSync = options?.deferSectionStateSync === true") &&
    defaultPrimeFunction.includes("if (!deferSectionStateSync)"),
  "Default AI Sequence priming must support deferring its direct section/state pass"
);
```

- [x] **Step 2: Run the focused contract and verify RED**

Run: `node scripts/check-ai-seq-animation-perf-contract.mjs`

Expected: exit code `1` with the three new Animation-entry assertions failing because the current prime call follows the full atomic commit and has no defer option.

### Task 2: Make the atomic commit the single section/state owner

**Files:**
- Modify: `particle-editor/novaflow-brand-runtime.js:31290`
- Modify: `particle-editor/novaflow-brand-runtime.js:35394`
- Test: `scripts/check-ai-seq-animation-perf-contract.mjs`

**Interfaces:**
- Consumes: `hasPrimaryAnimationEntryAtomicState()`, `commitPrimaryAnimationEntryState()`, and `primeAiSequenceDefaultForPrimaryAnimationEntry(options)`.
- Produces: one full refresh context per top-level Animation entry with the default secondary state ready before that context begins.

- [x] **Step 1: Prime before the full commit with a shallow fallback**

```js
clearPrimarySwitchRuntimeArtifacts();
if (!hasPrimaryAnimationEntryAtomicState()) {
  commitPrimaryAnimationEntryState("primary-post-activation-prepare", {
    lockPrimary: false,
    markCommitted: false,
    runDomSync: false,
    updateVisual: true
  });
}
primeAiSequenceDefaultForPrimaryAnimationEntry({ deferSectionStateSync: true });
commitPrimaryAnimationEntryState("primary-post-activation", {
  lockPrimary: false,
  markCommitted: true,
  runDomSync: true,
  updateVisual: true
});
```

- [x] **Step 2: Defer only the prime-owned section/state pass**

```js
function primeAiSequenceDefaultForPrimaryAnimationEntry(options = null) {
  const deferSectionStateSync = options?.deferSectionStateSync === true;
  // Existing user-selected and mounted-skeleton guards remain unchanged.
  // Existing remembered state, intent, quiet window, and prelayout remain unchanged.
  if (!deferSectionStateSync) {
    runAiAnimationSectionLayersOnce();
  }
  // Existing bottom workspace, mode guard, AutoFit, and resource restore remain unchanged.
}
```

- [x] **Step 3: Run the focused contract and verify GREEN**

Run: `node scripts/check-ai-seq-animation-perf-contract.mjs`

Expected: `PASS AI sequence animation performance contract`.

### Task 3: Contract a bounded upload settle

**Files:**
- Modify: `scripts/check-ai-seq-animation-perf-contract.mjs`
- Test: `scripts/check-ai-seq-animation-perf-contract.mjs`

**Interfaces:**
- Consumes: `scheduleAiSequenceUploadBottomStateRefresh()`.
- Produces: a static contract requiring a cheap DOM signature, bounded frame passes, one short fallback, route cancellation, and probe counters.

- [x] **Step 1: Add the failing upload-settle contract**

```js
const uploadBottomSignatureFunction = getFunctionBody("getAiSequenceUploadBottomStateSignature");
assert(
  uploadBottomSignatureFunction.includes("querySelectorAll") &&
    !uploadBottomSignatureFunction.includes("getBoundingClientRect") &&
    !uploadBottomSignatureFunction.includes("isVisible("),
  "Bottom upload settle signatures must avoid layout reads"
);

const uploadBottomRefreshFunction = getFunctionBody("scheduleAiSequenceUploadBottomStateRefresh");
assert(
  uploadBottomRefreshFunction.includes("getAiSequenceUploadBottomStateSignature") &&
    uploadBottomRefreshFunction.includes("maxFramePasses") &&
    uploadBottomRefreshFunction.includes("stableFrameTarget") &&
    uploadBottomRefreshFunction.includes("stableFrames") &&
    uploadBottomRefreshFunction.includes("fallbackDelay") &&
    uploadBottomRefreshFunction.includes("aiSequenceUploadBottomSettlePass") &&
    uploadBottomRefreshFunction.includes("aiSequenceUploadBottomSettleStop"),
  "Bottom upload refresh must stop on a bounded stable signature and expose probe evidence"
);
assert(
  !/\b(?:700|1200|2000|2200)\b/.test(uploadBottomRefreshFunction),
  "Bottom upload refresh must not retain the fixed long-tail timeout chain"
);
```

- [x] **Step 2: Run the focused contract and verify RED**

Run: `node scripts/check-ai-seq-animation-perf-contract.mjs`

Expected: exit code `1`; `getAiSequenceUploadBottomStateSignature must exist` plus the bounded-settle assertions fail while the current RAF + six timeouts + 2200 ms pending clear remains.

### Task 4: Replace the fixed upload tail with stable convergence

**Files:**
- Modify: `particle-editor/novaflow-brand-runtime.js:10996`
- Test: `scripts/check-ai-seq-animation-perf-contract.mjs`

**Interfaces:**
- Consumes: `applyAiSequenceUploadInputHitTargets(session)` and `syncAiSequenceUploadBottomReferenceState()`.
- Produces: `getAiSequenceUploadBottomStateSignature()` and a coalesced scheduler with at most four frame attempts plus one 180 ms fallback.

- [x] **Step 1: Add a layout-read-free signature**

```js
function getAiSequenceUploadBottomStateSignature() {
  const bottomWorkspace = document.querySelector('[data-novaflow-ai-bottom-workspace="1"]');
  const scope = bottomWorkspace instanceof HTMLElement ? bottomWorkspace : document.body;
  if (!(scope instanceof HTMLElement)) return "missing";
  return [
    bottomWorkspace instanceof HTMLElement ? "workspace:1" : "workspace:0",
    `zones:${scope.querySelectorAll('[data-ais-import], [data-nf-upload-dropzone="1"], .nf-upload-dropzone').length}`,
    `inputs:${document.querySelectorAll('input[type="file"][data-novaflow-ai-sequence-upload-zone]').length}`,
    `media:${scope.querySelectorAll("img, video, canvas").length}`,
    `proxies:${document.querySelectorAll('[data-novaflow-ai-sequence-upload-click-proxy="1"]').length}`
  ].join("|");
}
```

- [x] **Step 2: Implement stable frames plus one live-DOM fallback**

```js
function scheduleAiSequenceUploadBottomStateRefresh() {
  if (AI_SEQUENCE_UPLOAD_BOTTOM_STATE_REFRESH_PENDING) return;
  AI_SEQUENCE_UPLOAD_BOTTOM_STATE_REFRESH_PENDING = true;
  const maxFramePasses = 4;
  const stableFrameTarget = 2;
  const fallbackDelay = 180;
  let frame = 0;
  let fallbackTimer = 0;
  let framePasses = 0;
  let stableFrames = 0;
  let previousSignature = getAiSequenceUploadBottomStateSignature();
  let finished = false;

  const finish = (reason) => {
    if (finished) return;
    finished = true;
    if (frame) window.cancelAnimationFrame(frame);
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    AI_SEQUENCE_UPLOAD_BOTTOM_STATE_REFRESH_PENDING = false;
    nfAnimationPerfCountCallsite("aiSequenceUploadBottomSettleStop", reason);
  };

  const run = (finalPass = false) => {
    if (finished) return;
    if (!document.body?.classList.contains("novaflow-primary-target-animation")) {
      finish("inactive");
      return;
    }
    const session = getAiSequenceCurrentSession();
    applyAiSequenceUploadInputHitTargets(session);
    syncAiSequenceUploadBottomReferenceState();
    framePasses += 1;
    nfAnimationPerfCountCallsite("aiSequenceUploadBottomSettlePass", finalPass ? "fallback" : "frame");
    const signature = getAiSequenceUploadBottomStateSignature();
    const stable = signature === previousSignature;
    previousSignature = signature;
    stableFrames = stable ? stableFrames + 1 : 0;
    if (finalPass) {
      finish("fallback");
      return;
    }
    if (stableFrames >= stableFrameTarget) {
      finish("stable");
      return;
    }
    if (framePasses < maxFramePasses) {
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        run(false);
      });
    }
  };

  frame = window.requestAnimationFrame(() => {
    frame = 0;
    run(false);
  });
  fallbackTimer = window.setTimeout(() => {
    fallbackTimer = 0;
    run(true);
  }, fallbackDelay);
}
```

- [x] **Step 3: Run the focused contract and verify GREEN**

Run: `node scripts/check-ai-seq-animation-perf-contract.mjs`

Expected: `PASS AI sequence animation performance contract`.

### Task 5: Record, synchronize, verify, review, and archive

**Files:**
- Modify: `logs/debug.log`
- Modify: `particle-editor/index.html`
- Modify: `scripts/check-ai-seq-bottom-spacing-contract.mjs`
- Generated by sync: `particle-editor-desktop/renderer/novaflow-brand-runtime.js`
- Generated by sync: `particle-editor-desktop/dist/win-unpacked/resources/app/renderer/novaflow-brand-runtime.js`

**Interfaces:**
- Consumes: the source Runtime and focused contracts from Tasks 1-4.
- Produces: synchronized runtime mirrors, verified locked `4783`, review evidence, and one project-standard auto-save commit.

- [x] **Step 1: Append the required debug record**

```text
[2026-07-12 HH:mm]

- 问题：桌面端和 4783 在特效/动画切换时出现明显中间态，动画默认入口还保留固定两秒上传刷新长尾。
- 原因：默认 AI 序列 prime 与后加的 atomic commit 各自执行 section/state，同一入口发生重复同步；上传命中层固定执行 RAF 与六个延时刷新。
- 解决方案：在 full atomic commit 前预置默认 AI 序列状态，并将 prime 自身 section/state 延迟给 atomic context；上传刷新改为无布局读取的 DOM 签名、最多四帧收敛和一次 180ms 兜底。
- 影响范围：顶层动画默认入口与 AI 序列底部上传命中层；不修改特效 Preview、桌面 host、React bundle、骨骼动画业务、AI 工作流、资源、导出或其他一级入口。
```

- [x] **Step 2: Synchronize and run syntax/static checks**

Update the source `novaflow-brand-runtime.js` cache key to `20260712-animation-switch-settle-1` and update the existing bottom-spacing publication contract to require that exact revision before synchronization.

Run:

```powershell
npm run sync:runtime
npm run check:runtime
node --check particle-editor/novaflow-brand-runtime.js
node --check particle-editor-desktop/renderer/novaflow-brand-runtime.js
node --check particle-editor-desktop/dist/win-unpacked/resources/app/renderer/novaflow-brand-runtime.js
node scripts/check-ai-seq-animation-perf-contract.mjs
node scripts/check-ai-seq-six-slot-drop-contract.mjs
node scripts/check-ai-seq-first-frame-layout.mjs
node scripts/check-ai-seq-first-frame-mode-contract.mjs
node scripts/check-ai-seq-jimeng-r2v-4k.mjs
node scripts/check-skeleton-realtime-preview-perf-contract.mjs
npm run check:ai-seq-bottom-spacing
git diff --check
npm run check:entry
```

Expected: all commands exit `0`, Runtime hashes match, and `check:entry` ends with `Overall: GO`.

- [x] **Step 3: Verify locked 4783 behavior**

Run at `http://127.0.0.1:4783/`:

```text
特效 -> 动画 (default AI Sequence)
动画 -> 特效 -> 动画 (default remains stable)
动画 -> 骨骼动画 (skeleton activates without AI/skeleton overlap)
骨骼动画 -> 特效 -> 动画 (record the existing default-to-AI behavior; do not change it in this task)
AI Sequence empty-slot click, delete/re-upload, file drop, resource-card drop, wrong-type rejection
Seedance reference image 1/2/3/4, video, and audio slot routing
```

Expected: no double/empty active frame, no AI/skeleton simultaneous visible frame, one section/state owner per default top-level entry, no upload-settle callbacks at 700/1200/2000 ms, and all upload mappings remain correct. The old running desktop Runtime and the updated `4783` surface both return to default AI Sequence after leaving Bone Animation for another primary route, so that pre-existing behavior is documented rather than changed here.

- [x] **Step 4: Review the complete diff**

Run: `git diff --stat`, `git diff -- scripts/check-ai-seq-animation-perf-contract.mjs particle-editor/novaflow-brand-runtime.js logs/debug.log`, and a dedicated code-review agent.

Expected: only the authorized source Runtime, focused contract, debug log, plan, and synchronized Runtime mirrors are changed; no Critical or Important review findings remain.

- [x] **Step 5: Archive once and confirm clean state**

Run:

```powershell
npm run auto-commit
git status --short
git log -1 --oneline
```

Expected: one `auto-save: YYYY-MM-DD HH:mm:ss` commit and empty `git status --short` output.
