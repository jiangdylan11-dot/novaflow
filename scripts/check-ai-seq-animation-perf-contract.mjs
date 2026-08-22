#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const runtime = readFileSync("particle-editor/novaflow-brand-runtime.js", "utf8").replace(/\r\n?/g, "\n");
const aiSequenceBundle = readFileSync("particle-editor/assets/index-BbIa-2NM.js", "utf8");
const clientAuthRuntime = readFileSync("particle-editor/novaflow-client-auth.js", "utf8");
const rendererIndex = readFileSync("particle-editor/index.html", "utf8");
const runtimeSyncScript = readFileSync("scripts/sync-runtime.mjs", "utf8");
const runtimeIntegrityScript = readFileSync("scripts/check-runtime-sync.mjs", "utf8");
const rendererBuildScript = readFileSync("particle-editor-desktop/scripts/build-renderer.mjs", "utf8");
const cutoutPatchScript = readFileSync("scripts/patch-ai-seq-cutout-edit.mjs", "utf8").replace(/\r\n?/g, "\n");
const desktopMain = readFileSync("particle-editor-desktop/main.js", "utf8");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

const transitionBridgeScriptIndex = rendererIndex.indexOf("primary-entry-transition.bridge.js");
const brandRuntimeScriptIndex = rendererIndex.indexOf("novaflow-brand-runtime.js");
assert(
  transitionBridgeScriptIndex >= 0 &&
    brandRuntimeScriptIndex >= 0 &&
    transitionBridgeScriptIndex < brandRuntimeScriptIndex,
  "The primary-entry transaction bridge must load before Brand Runtime"
);
assert(
  runtimeSyncScript.includes("primary-entry-transition.bridge.js") &&
    runtimeIntegrityScript.includes("primary-entry-transition.bridge.js") &&
    rendererBuildScript.includes("primary-entry-transition.bridge.js"),
  "The transaction bridge must participate in synchronization, integrity checks, and clean renderer builds"
);

function assert(condition, message) {
  if (!condition) fail(message);
}

let cutoutHeadReplayVerified = false;
try {
  const replayOutput = execFileSync(
    process.execPath,
    ["scripts/patch-ai-seq-cutout-edit.mjs", "--verify-head-replay"],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  cutoutHeadReplayVerified = replayOutput.includes("HEAD replay matches current bundle");
} catch (error) {
  fail(`AI sequence cutout patch HEAD replay must reproduce the current bundle: ${error.message}`);
}

function getFunctionBodyFrom(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} must exist`);
  if (start < 0) return "";
  let index = source.indexOf("(", start);
  let parameterDepth = 0;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parameterDepth += 1;
    else if (char === ")") {
      parameterDepth -= 1;
      if (parameterDepth === 0) break;
    }
  }
  index = source.indexOf("{", index);
  let depth = 0;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  fail(`${name} body must be parseable`);
  return "";
}

function getFunctionBody(name) {
  return getFunctionBodyFrom(runtime, name);
}

function getPureFunction(name) {
  const source = getFunctionBody(name);
  if (!source) return null;
  try {
    return Function(`"use strict"; return (${source});`)();
  } catch (error) {
    fail(`${name} must be independently executable: ${error.message}`);
    return null;
  }
}

function getFunctionWithBindings(source, name, bindings = {}) {
  const functionSource = getFunctionBodyFrom(source, name);
  if (!functionSource) return null;
  try {
    const names = Object.keys(bindings);
    return Function(...names, `"use strict"; return (${functionSource});`)(...names.map((key) => bindings[key]));
  } catch (error) {
    fail(`${name} must be executable with its declared bindings: ${error.message}`);
    return null;
  }
}

function getAssignedArrowFunctionWithBindings(source, name, bindings = {}, signature = `${name}=(`) {
  const anchor = signature;
  const assignmentStart = source.indexOf(anchor);
  assert(assignmentStart >= 0, `${name} assigned arrow function must exist`);
  if (assignmentStart < 0) return null;
  assert(
    source.indexOf(anchor, assignmentStart + anchor.length) < 0,
    `${name} assigned arrow function anchor must be unique`
  );
  const functionStart = assignmentStart + name.length + 1;
  const arrowIndex = source.indexOf("=>", functionStart);
  const bodyStart = source.indexOf("{", arrowIndex);
  let depth = 0;
  let bodyEnd = -1;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        bodyEnd = index;
        break;
      }
    }
  }
  assert(bodyEnd > bodyStart, `${name} assigned arrow function body must be parseable`);
  if (bodyEnd <= bodyStart) return null;
  const functionSource = source.slice(functionStart, bodyEnd + 1);
  try {
    const names = Object.keys(bindings);
    return Function(...names, `"use strict"; return (${functionSource});`)(...names.map((key) => bindings[key]));
  } catch (error) {
    fail(`${name} assigned arrow function must be executable: ${error.message}`);
    return null;
  }
}

function getArrowFunctionAfterMarker(source, marker, bindings = {}) {
  const markerIndex = source.indexOf(marker);
  assert(markerIndex >= 0, `${marker} arrow function marker must exist`);
  if (markerIndex < 0) return null;
  assert(
    source.indexOf(marker, markerIndex + marker.length) < 0,
    `${marker} arrow function marker must be unique`
  );
  const functionStart = markerIndex + marker.length;
  const arrowIndex = source.indexOf("=>", functionStart);
  const bodyStart = source.indexOf("{", arrowIndex);
  let depth = 0;
  let bodyEnd = -1;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        bodyEnd = index;
        break;
      }
    }
  }
  assert(bodyEnd > bodyStart, `${marker} arrow function body must be parseable`);
  if (bodyEnd <= bodyStart) return null;
  const functionSource = source.slice(functionStart, bodyEnd + 1);
  try {
    const names = Object.keys(bindings);
    return Function(...names, `"use strict"; return (${functionSource});`)(...names.map((key) => bindings[key]));
  } catch (error) {
    fail(`${marker} arrow function must be executable: ${error.message}`);
    return null;
  }
}

const modeCollapseFunction = getFunctionBody("syncAiAnimationModeCollapsedMainBodyVisibility");
assert(
  !modeCollapseFunction.includes('item.getAttribute("data-novaflow-ai-main-model-section") !== "1"'),
  "Mode collapse must hide every mode body item, not only main-model sections"
);
assert(
  modeCollapseFunction.includes("restoreAiAnimationModeCollapseInlineHiddenItem"),
  "Mode collapse must restore inline-hidden items through a shared restore path"
);

const collapsedCssStart = runtime.indexOf('[data-novaflow-ai-mode-section="1"][data-novaflow-ai-mode-collapsed="1"]');
const collapsedCssEnd = runtime.indexOf('body.novaflow-ai-animation-section-layers.novaflow-ai-bottom-workspace-active [data-novaflow-ai-mode-switch="1"]', collapsedCssStart);
const collapsedCss = collapsedCssStart >= 0 && collapsedCssEnd > collapsedCssStart
  ? runtime.slice(collapsedCssStart, collapsedCssEnd)
  : "";
assert(collapsedCss, "Collapsed mode CSS block must be locatable");
assert(
  !collapsedCss.includes(':has([data-novaflow-ai-main-model-section="1"]) [data-novaflow-ai-mode-body-item="1"]'),
  "Collapsed mode CSS must not depend on data-novaflow-ai-main-model-section"
);
assert(
  collapsedCss.includes('[data-novaflow-ai-mode-body-item="1"]:not([data-novaflow-ai-post-section="1"])'),
  "Collapsed mode CSS must hide direct mode body items while preserving the post section"
);

const loraRefreshFunction = getFunctionBody("scheduleAiAnimationLoraLayoutRefresh");
assert(
  loraRefreshFunction.includes("AI_ANIMATION_LORA_LAYOUT_REFRESH_FRAME"),
  "LORA layout refresh must be RAF-coalesced"
);
assert(
  !/setTimeout\(run,\s*(420|900)\)/.test(loraRefreshFunction),
  "LORA layout refresh must not keep long multi-pass timeout rescans"
);
assert(
  !loraRefreshFunction.includes("scheduleAiAnimationDeferredFullRefresh"),
  "LORA layout refresh must not escalate to a full layout refresh"
);

const structureRefreshFunction = getFunctionBody("scheduleAiAnimationStructureRefresh");
assert(
  structureRefreshFunction.includes("coerceAiAnimationStructureRefreshDelays"),
  "AI animation structure refresh must normalize noisy delay lists"
);

const observedLayoutRefreshFunction = getFunctionBody("scheduleObservedLayoutRefresh");
const cancelStalePrimaryRefreshFunction = getFunctionBody("cancelStaleBrandMutationFlushForPrimarySwitch");
const observedScheduleTokenCaptureIndex = observedLayoutRefreshFunction.indexOf(
  "const scheduleToken = ++OBSERVED_LAYOUT_REFRESH_SCHEDULE_TOKEN"
);
const observedStaleGuardIndex = observedLayoutRefreshFunction.indexOf(
  "scheduleToken !== OBSERVED_LAYOUT_REFRESH_SCHEDULE_TOKEN"
);
const observedTimerResetIndex = observedLayoutRefreshFunction.indexOf(
  "OBSERVED_LAYOUT_REFRESH_TIMER = null"
);
const observedCaptureDeferralIndex = observedLayoutRefreshFunction.indexOf(
  "observedLayoutRefreshDeferredPrimaryAnimationCapture"
);
const observedStaleGuardBlock = observedStaleGuardIndex >= 0 && observedTimerResetIndex > observedStaleGuardIndex
  ? observedLayoutRefreshFunction.slice(observedStaleGuardIndex, observedTimerResetIndex)
  : "";
assert(
  cancelStalePrimaryRefreshFunction.includes("OBSERVED_LAYOUT_REFRESH_SCHEDULE_TOKEN += 1") &&
    cancelStalePrimaryRefreshFunction.includes("OBSERVED_LAYOUT_REFRESH_PENDING = false") &&
    cancelStalePrimaryRefreshFunction.includes("observedLayoutRefreshCanceledPrimarySwitch") &&
    observedScheduleTokenCaptureIndex >= 0 &&
    observedStaleGuardIndex > observedScheduleTokenCaptureIndex &&
    observedCaptureDeferralIndex > observedStaleGuardIndex &&
    observedTimerResetIndex > observedCaptureDeferralIndex &&
    observedTimerResetIndex > observedStaleGuardIndex &&
    observedLayoutRefreshFunction.includes("let waitedReplayPromise = null") &&
    observedStaleGuardBlock.includes("PRIMARY_ANIMATION_ENTRY_REPLAY_PROMISE") &&
    observedStaleGuardBlock.includes("replayPromise !== waitedReplayPromise") &&
    observedStaleGuardBlock.includes("waitedReplayPromise = replayPromise") &&
    observedStaleGuardBlock.includes('previewPhase === "capturing"') &&
    observedStaleGuardBlock.includes('previewPhase === "frozen"') &&
    observedStaleGuardBlock.includes("replayPromise.then(resume, resume)") &&
    !observedStaleGuardBlock.includes("OBSERVED_LAYOUT_REFRESH_PENDING = false") &&
    !observedStaleGuardBlock.includes("OBSERVED_LAYOUT_REFRESH_TIMER =") &&
    observedLayoutRefreshFunction.indexOf("runFullLayoutRefresh") > observedStaleGuardIndex,
  "Primary entry replay must defer outgoing capture-time layout work, then invalidate it without letting its stale microtask clear a newer schedule"
);

function runObservedLayoutGenerationModel() {
  let scheduleToken = 0;
  let pending = false;
  let timer = null;
  let runCount = 0;
  const schedule = (id) => {
    pending = true;
    timer = id;
    const ownToken = ++scheduleToken;
    return () => {
      if (ownToken !== scheduleToken) return;
      timer = null;
      pending = false;
      runCount += 1;
    };
  };
  const runOutgoing = schedule("outgoing");
  scheduleToken += 1;
  pending = false;
  timer = null;
  const runCurrent = schedule("current");
  runOutgoing();
  const stalePreservedCurrentSchedule = pending === true && timer === "current" && runCount === 0;
  runCurrent();
  return {
    stalePreservedCurrentSchedule,
    currentRanExactlyOnce: pending === false && timer === null && runCount === 1
  };
}

const observedLayoutGenerationModel = runObservedLayoutGenerationModel();
assert(
  observedLayoutGenerationModel.stalePreservedCurrentSchedule &&
    observedLayoutGenerationModel.currentRanExactlyOnce,
  "An outgoing observed callback must not run or clear the current generation, and the current callback must run exactly once"
);

async function runObservedCaptureDeferralModel(captureSucceeded) {
  let scheduleToken = 1;
  const ownToken = scheduleToken;
  let pending = true;
  let previewPhase = "capturing";
  let replayPromise = null;
  let resolveReplay = null;
  let waitedReplayPromise = null;
  let runCount = 0;
  let waitCount = 0;
  replayPromise = new Promise((resolve) => {
    resolveReplay = resolve;
  });
  const run = () => {
    if (ownToken !== scheduleToken) return;
    if (replayPromise && replayPromise !== waitedReplayPromise && (previewPhase === "capturing" || previewPhase === "frozen")) {
      waitedReplayPromise = replayPromise;
      waitCount += 1;
      const resume = () => run();
      replayPromise.then(resume, resume);
      return;
    }
    pending = false;
    runCount += 1;
  };
  run();
  if (captureSucceeded) {
    previewPhase = "frozen";
    scheduleToken += 1;
    pending = false;
  } else {
    previewPhase = "capture-failed";
  }
  resolveReplay();
  await replayPromise;
  await Promise.resolve();
  await Promise.resolve();
  return { pending, runCount, waitCount };
}

async function runObservedSettledFrozenModel(rejected) {
  let pending = true;
  let runCount = 0;
  let waitCount = 0;
  let waitedReplayPromise = null;
  let settleReplay = null;
  const replayPromise = new Promise((resolve, reject) => {
    settleReplay = rejected ? reject : resolve;
  });
  const run = () => {
    if (replayPromise !== waitedReplayPromise) {
      waitedReplayPromise = replayPromise;
      waitCount += 1;
      replayPromise.then(run, run);
      return;
    }
    pending = false;
    runCount += 1;
  };
  run();
  settleReplay(rejected ? new Error("expected rejection") : undefined);
  await replayPromise.catch(() => undefined);
  await Promise.resolve();
  return { pending, runCount, waitCount };
}

async function runObservedReplayReplacementModel() {
  let pending = true;
  let runCount = 0;
  let waitCount = 0;
  let waitedReplayPromise = null;
  let resolveFirst = null;
  let resolveSecond = null;
  const firstReplay = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  const secondReplay = new Promise((resolve) => {
    resolveSecond = resolve;
  });
  let replayPromise = firstReplay;
  const run = () => {
    if (replayPromise !== waitedReplayPromise) {
      waitedReplayPromise = replayPromise;
      waitCount += 1;
      replayPromise.then(run, run);
      return;
    }
    pending = false;
    runCount += 1;
  };
  run();
  replayPromise = secondReplay;
  resolveFirst();
  await firstReplay;
  await Promise.resolve();
  resolveSecond();
  await secondReplay;
  await Promise.resolve();
  return { pending, runCount, waitCount };
}

const observedCaptureSuccessModel = await runObservedCaptureDeferralModel(true);
const observedCaptureFailureModel = await runObservedCaptureDeferralModel(false);
const observedFrozenSettleModel = await runObservedSettledFrozenModel(false);
const observedFrozenRejectModel = await runObservedSettledFrozenModel(true);
const observedReplayReplacementModel = await runObservedReplayReplacementModel();
assert(
  observedCaptureSuccessModel.pending === false &&
    observedCaptureSuccessModel.runCount === 0 &&
    observedCaptureSuccessModel.waitCount === 1 &&
    observedCaptureFailureModel.pending === false &&
    observedCaptureFailureModel.runCount === 1 &&
    observedCaptureFailureModel.waitCount === 1 &&
    observedFrozenSettleModel.pending === false &&
    observedFrozenSettleModel.runCount === 1 &&
    observedFrozenSettleModel.waitCount === 1 &&
    observedFrozenRejectModel.pending === false &&
    observedFrozenRejectModel.runCount === 1 &&
    observedFrozenRejectModel.waitCount === 1 &&
    observedReplayReplacementModel.pending === false &&
    observedReplayReplacementModel.runCount === 1 &&
    observedReplayReplacementModel.waitCount === 2,
  "Capture success must invalidate deferred work, while failure, frozen settle, rejection, and replay replacement must resume exactly once"
);

const shouldSkipSupersededRuntimeRefresh = getPureFunction("shouldSkipSupersededPrimaryAnimationRuntimeRefresh");
const supersededRuntimeRefreshCase = {
  full: true,
  queuedDuringPrimaryEntry: true,
  queuedSerial: 7,
  committedSerial: 7,
  mustRunAfterAtomic: false,
  forceFull: false
};
assert(
  shouldSkipSupersededRuntimeRefresh?.(supersededRuntimeRefreshCase) === true &&
    shouldSkipSupersededRuntimeRefresh?.({ ...supersededRuntimeRefreshCase, full: false }) === false &&
    shouldSkipSupersededRuntimeRefresh?.({ ...supersededRuntimeRefreshCase, queuedDuringPrimaryEntry: false }) === false &&
    shouldSkipSupersededRuntimeRefresh?.({ ...supersededRuntimeRefreshCase, queuedSerial: 8 }) === false &&
    shouldSkipSupersededRuntimeRefresh?.({ ...supersededRuntimeRefreshCase, mustRunAfterAtomic: true }) === false &&
    shouldSkipSupersededRuntimeRefresh?.({ ...supersededRuntimeRefreshCase, forceFull: true }) === false,
  "Only a non-urgent full batch queued by the same successfully committed primary-entry transaction may be skipped"
);

const scheduledRuntimeRefreshFunction = getFunctionBody("scheduleAiAnimationRuntimeRefreshBatch");
const runtimeRefreshFrameBranchIndex = scheduledRuntimeRefreshFunction.indexOf("if (AI_ANIMATION_RUNTIME_REFRESH_FRAME)");
const runtimeRefreshRunIndex = scheduledRuntimeRefreshFunction.indexOf("const run = () =>");
const runtimeRefreshFrameBranch = runtimeRefreshFrameBranchIndex >= 0 && runtimeRefreshRunIndex > runtimeRefreshFrameBranchIndex
  ? scheduledRuntimeRefreshFunction.slice(runtimeRefreshFrameBranchIndex, runtimeRefreshRunIndex)
  : "";
assert(
  scheduledRuntimeRefreshFunction.includes("isPrimaryAnimationEntryTransactionPending()") &&
    scheduledRuntimeRefreshFunction.includes("PRIMARY_ANIMATION_ENTRY_TRANSACTION_SERIAL") &&
    scheduledRuntimeRefreshFunction.includes("PRIMARY_ANIMATION_ENTRY_LAST_COMMITTED_SERIAL") &&
    scheduledRuntimeRefreshFunction.includes("shouldSkipSupersededPrimaryAnimationRuntimeRefresh") &&
    scheduledRuntimeRefreshFunction.includes("primaryAnimationEntryQueuedRuntimeRefreshSkipped") &&
    runtimeRefreshFrameBranch.includes("!primaryEntryPending") &&
    runtimeRefreshFrameBranch.includes("primaryEntrySerial !== AI_ANIMATION_RUNTIME_REFRESH_PRIMARY_ENTRY_SERIAL") &&
    runtimeRefreshFrameBranch.includes("options.mustRunAfterAtomic === true") &&
    runtimeRefreshFrameBranch.includes("AI_ANIMATION_RUNTIME_REFRESH_MUST_RUN_AFTER_ATOMIC = true") &&
    scheduledRuntimeRefreshFunction.includes("AI_ANIMATION_RUNTIME_REFRESH_FORCE_FULL = AI_ANIMATION_RUNTIME_REFRESH_FORCE_FULL || options.forceFull === true"),
  "Queued runtime refreshes must preserve post-commit, mixed-serial, hard-urgent, and force-full requests while deduplicating only the superseded entry batch"
);

const mutationFlushFunction = getFunctionBody("flushBrandRuntimeMutations");
assert(
  mutationFlushFunction.includes("const mustRunAfterAtomic = visibleMutations.some(isAiAnimationHardUrgentFullSyncMutation)") &&
    mutationFlushFunction.includes("scheduleAiAnimationRuntimeRefreshBatchOnceInMutationFlush(mutationFlushToken, {") &&
    mutationFlushFunction.includes("mustRunAfterAtomic"),
  "Mutation-driven full batches must carry hard-urgent evidence across the animation-frame queue"
);

const skeletonBoneRefreshFunction = getFunctionBody("scheduleSkeletonBoneSelectionRefresh");
assert(
  skeletonBoneRefreshFunction.includes("getSkeletonBoneSelectionRefreshSignature"),
  "Skeleton bone selection refresh must skip duplicate selection/layout signatures"
);
assert(
  !/setTimeout\(\(\)\s*=>\s*run\("timeout-(120|240)"\)/.test(skeletonBoneRefreshFunction),
  "Skeleton bone selection refresh must not use long duplicate timeout passes"
);

const ribbonPreviewFunction = getFunctionBody("scheduleRibbonPresetPreviewForSelectionSettled");
assert(
  ribbonPreviewFunction.includes("scheduleRibbonPresetPreviewForSelectionFrame"),
  "Ribbon selection preview must be coalesced behind one scheduled frame"
);
assert(
  !/setTimeout\(\(\)\s*=>\s*run\("timeout-(160|320)"\)/.test(ribbonPreviewFunction),
  "Ribbon selection preview must not use long duplicate timeout passes"
);

const ribbonPresetOverrideFunction = getFunctionBody("scheduleRibbonParameterPresetOverride");
assert(
  !/\[(?:[^\]]*,\s*)?(240|480|900)(?:\s*,[^\]]*)?\]\.forEach/.test(ribbonPresetOverrideFunction),
  "Ribbon preset button override must not use long duplicate timeout passes"
);

const referenceClickFunction = getFunctionBody("handleAiAnimationReferenceClickCapture");
assert(
  referenceClickFunction.includes("triggerAiAnimationReferenceFileInput(dropzone, event)"),
  "Source-owned bottom reference slots must still route user clicks to the real reference file input"
);
assert(
  !referenceClickFunction.includes("if (isAiSequenceSourceOwnedBottomReferenceSlot(dropzone)) return;"),
  "Reference click capture must not swallow source-owned bottom reference clicks"
);

const triggerReferenceFunction = getFunctionBody("triggerAiAnimationReferenceFileInput");
assert(
  !triggerReferenceFunction.includes("if (isAiSequenceSourceOwnedBottomUploadDropzone(dropzone)) return false;"),
  "Reference picker trigger must support source-owned bottom upload slots"
);

const uploadProxyFunction = getFunctionBody("ensureAiSequenceUploadClickProxy");
assert(
  uploadProxyFunction.includes("isSourceOwnedBottomUpload"),
  "Source-owned bottom upload slots must be allowed to create a transparent native input proxy"
);
assert(
  uploadProxyFunction.includes("getAiSequenceBottomUploadZoneLabel(dropzone) || isSourceOwnedBottomUpload"),
  "Bottom upload slots must be recognized by stable slot label, not only source-owned layout flags"
);
assert(
  uploadProxyFunction.includes("isPostReference || isSourceOwnedBottomUpload || isBottomUpload"),
  "Bottom upload proxy must be mounted over the visible upload slot"
);
assert(
  uploadProxyFunction.includes("getAiSequenceBottomUploadZoneLabel(dropzone)") &&
    uploadProxyFunction.includes("dispatchAiAnimationFilesToDropzone(dropzone, files)"),
  "Bottom upload proxy changes must also dispatch a drop event so source-owned slots render inserted media"
);

const uploadControlClickFunction = getFunctionBody("isAiSequenceUploadControlClick");
assert(
  uploadControlClickFunction.includes('target instanceof HTMLInputElement && target.type === "file"'),
  "Native file-input proxy clicks must not be swallowed by upload click fallbacks"
);

const uploadInputChangeFunction = getFunctionBody("bindAiSequenceUploadInputChange");
assert(
  uploadInputChangeFunction.includes("scheduleAiSequenceBottomUploadDropBridge(input, activeDropzone, files)"),
  "Bottom upload input changes must use the shared guarded drop bridge"
);

const uploadDropBridgeFunction = getFunctionBody("scheduleAiSequenceBottomUploadDropBridge");
assert(
  uploadDropBridgeFunction.includes("__novaflowAiSequenceDropBridgeInFlight") &&
    uploadDropBridgeFunction.includes("window.setTimeout") &&
    uploadDropBridgeFunction.includes("findAiSequenceBottomUploadDropzoneByZoneLabel") &&
    uploadDropBridgeFunction.includes("dispatchAiAnimationFilesToDropzone(liveDropzone, files)"),
  "Bottom upload file changes must dispatch an async guarded drop event against the current visible slot"
);

const uploadGlobalChangeBridgeFunction = getFunctionBody("bindAiSequenceBottomUploadInputChangeBridge");
assert(
  uploadGlobalChangeBridgeFunction.includes("document.addEventListener(\"change\"") &&
    uploadGlobalChangeBridgeFunction.includes("scheduleAiSequenceBottomUploadDropBridge"),
  "Global bottom upload input change bridge must catch file chooser changes on native hidden inputs"
);

const uploadHitTargetFunction = getFunctionBody("applyAiSequenceUploadInputHitTargets");
assert(
  uploadHitTargetFunction.includes("ensureAiSequenceUploadClickProxy(dropzone);"),
  "Upload hit-target refresh must create native proxies for active upload dropzones"
);
assert(
  uploadHitTargetFunction.includes("keepStableBottomProxy") &&
    uploadHitTargetFunction.includes("getAiSequenceBottomUploadZoneLabel(dropzone)") &&
    uploadHitTargetFunction.includes("(!activeDropzones.has(dropzone) && !keepStableBottomProxy)"),
  "Upload proxy cleanup must not remove stable bottom upload proxies"
);

const bottomUploadProxySyncFunction = getFunctionBody("syncAiSequenceBottomUploadClickProxies");
assert(
  bottomUploadProxySyncFunction.includes("prepareAiSequenceBottomUploadDropzone(dropzone)") &&
    bottomUploadProxySyncFunction.includes("ensureAiSequenceUploadClickProxy(dropzone)"),
  "Bottom upload state sync must pre-mount native click proxies before the user's first click"
);

const bottomUploadStateFunction = getFunctionBody("syncAiSequenceUploadBottomReferenceState");
assert(
  bottomUploadStateFunction.includes("syncAiSequenceBottomUploadClickProxies(bottomWorkspace)") &&
    bottomUploadStateFunction.includes("syncAiSequenceBottomUploadClickProxies(scope)"),
  "Bottom upload state refresh must keep click proxies current in source-owned and normal layouts"
);

const sourceOwnedFinalLayoutFunction = getFunctionBody("syncAiAnimationSourceOwnedBottomWorkspaceFinalLayout");
assert(
  sourceOwnedFinalLayoutFunction.includes("scheduleAiSequenceBottomUploadClickProxyRefresh(bottomWorkspace)"),
  "Source-owned bottom final layout must schedule native upload proxy refresh"
);
assert(
  sourceOwnedFinalLayoutFunction.includes("syncAiAnimationGenerationPanelHeight(bottomWorkspace)"),
  "Settled source-owned bottom final layout must restore content-driven generation-panel height"
);

const bottomUploadProxyScheduleFunction = getFunctionBody("scheduleAiSequenceBottomUploadClickProxyRefresh");
assert(
  bottomUploadProxyScheduleFunction.includes("AI_SEQUENCE_BOTTOM_UPLOAD_PROXY_REFRESH_FRAME") &&
    bottomUploadProxyScheduleFunction.includes("syncAiSequenceBottomUploadClickProxies(root)"),
  "Bottom upload proxy refresh must be RAF-coalesced to avoid source-owned layout recursion"
);

const collapseLocalRefreshFunction = getFunctionBody("runAiAnimationCollapseLocalRefresh");
assert(
  collapseLocalRefreshFunction.includes('document.querySelector(\'[data-novaflow-ai-bottom-workspace="1"]\')') &&
    collapseLocalRefreshFunction.includes("syncAiSequenceBottomUploadClickProxies(bottomProxyScope)") &&
    collapseLocalRefreshFunction.includes("scheduleAiSequenceBottomUploadClickProxyRefresh(bottomProxyScope)"),
  "Mode collapse local refresh must rebuild bottom upload proxies after intermediate mode toggles"
);

const collapseHeadingFunction = getFunctionBody("ensureAiAnimationCollapseHeading");
assert(
  collapseHeadingFunction.includes("scheduleAiAnimationCollapseLocalRefresh(section, kind)") &&
    collapseHeadingFunction.includes("if (kind === \"mode\")") &&
    collapseHeadingFunction.includes("scheduleAiSequenceBottomUploadClickProxyRefresh(bottomWorkspace instanceof HTMLElement ? bottomWorkspace : document)"),
  "Mode collapse heading toggle must schedule bottom upload proxy refresh after every intermediate mode toggle"
);

const resourceModeChromeRestoreFunction = getFunctionBody("scheduleAiSequenceResourceModeChromeRestore");
const resourceModeBottomLayoutFunction = getFunctionBody("syncAiSequenceResourceModeBottomWorkspaceLayout");
const cutoutResourceSettleFunction = getFunctionBody("settleAiSequenceCutoutResourceModeNow");
const cutoutMediaSaveAndCloseFunction = getFunctionBody("completeAiSequenceCutoutMediaSaveAndClose");
const cutoutToolSaveFunction = getFunctionBody("completeAiSequenceToolSave");
const cutoutCancelEditingFunction = getFunctionBody("cancelAiSequenceCutoutEditingSession");
const cutoutResourcePreviewRestoreFunction = getFunctionBody("restoreAiSequenceCutoutResourcePreviewDisplay");
assert(
  collapseHeadingFunction.includes("scheduleAiSequenceResourceModeChromeRestore") &&
    cutoutResourceSettleFunction.includes("scheduleAiSequenceResourceModeChromeRestore") &&
    cutoutResourceSettleFunction.includes("resetAiSequencePreviewMediaStateForLayoutTransition(document)") &&
    resourceModeChromeRestoreFunction.includes("syncAiSequenceResourceModeBottomWorkspaceLayout()") &&
    resourceModeBottomLayoutFunction.includes("syncAiAnimationSourceOwnedBottomWorkspaceFinalLayout(bottomWorkspace)") &&
    resourceModeBottomLayoutFunction.includes("syncAiAnimationGenerationPanelHeight(bottomWorkspace)") &&
    resourceModeBottomLayoutFunction.includes("scheduleAiSequencePreviewMediaPanZoom()"),
  "Closing or settling processing tools must reset preview media and rerun final bottom layout plus RAF-coalesced pan/zoom after React restores resource mode"
);

const cutoutCancelSourceResetIndex = cutoutCancelEditingFunction.indexOf('window.dispatchEvent(new CustomEvent("novaflow:reset-ai-cutouts"');
const cutoutCancelDomResetIndex = cutoutCancelEditingFunction.indexOf("resetAiSequenceCutoutEditingDom(document)", cutoutCancelSourceResetIndex);
const cutoutCancelSettleIndex = cutoutCancelEditingFunction.indexOf("settleAiSequenceCutoutResourceModeNow", cutoutCancelDomResetIndex);
const cutoutResourcePreviewViewportIndex = cutoutResourcePreviewRestoreFunction.indexOf("getAiSequencePreviewViewport(root)");
const cutoutResourcePreviewOwnerGuardIndex = cutoutResourcePreviewRestoreFunction.indexOf("isAiSequenceSourcePreviewPanZoomOwner(previewViewport)", cutoutResourcePreviewViewportIndex);
const cutoutResourcePreviewOwnershipReleaseIndex = cutoutResourcePreviewRestoreFunction.indexOf("releaseAiSequenceRuntimePreviewOwnershipToSource(previewViewport)", cutoutResourcePreviewOwnerGuardIndex);
const cutoutResourcePreviewPlainMediaRestoreIndex = cutoutResourcePreviewRestoreFunction.indexOf("restoreAiSequencePlainBoardMediaDisplay(previewViewport || root || document)", cutoutResourcePreviewOwnershipReleaseIndex);
const cutoutResourcePreviewGuardedOwnershipRelease = /if\s*\(\s*previewViewport instanceof HTMLElement\s*&&\s*isAiSequenceSourcePreviewPanZoomOwner\(previewViewport\)\s*\)\s*\{\s*releaseAiSequenceRuntimePreviewOwnershipToSource\(previewViewport\);\s*\}/.test(cutoutResourcePreviewRestoreFunction);
assert(
  cutoutCancelSourceResetIndex >= 0 &&
    cutoutCancelDomResetIndex > cutoutCancelSourceResetIndex &&
    cutoutCancelSettleIndex > cutoutCancelDomResetIndex &&
    cutoutCancelEditingFunction.split("settleAiSequenceCutoutResourceModeNow").length - 1 === 1 &&
    !cutoutCancelEditingFunction.includes("releaseAiSequenceRuntimePreviewOwnershipToSource") &&
    !cutoutCancelEditingFunction.includes("restoreAiSequencePlainBoardMediaDisplay") &&
    cutoutResourcePreviewViewportIndex >= 0 &&
    cutoutResourcePreviewOwnerGuardIndex > cutoutResourcePreviewViewportIndex &&
    cutoutResourcePreviewOwnershipReleaseIndex > cutoutResourcePreviewOwnerGuardIndex &&
    cutoutResourcePreviewPlainMediaRestoreIndex > cutoutResourcePreviewOwnershipReleaseIndex &&
    cutoutResourcePreviewGuardedOwnershipRelease &&
    cutoutResourcePreviewRestoreFunction.split("releaseAiSequenceRuntimePreviewOwnershipToSource").length - 1 === 1 &&
    cutoutResourcePreviewRestoreFunction.split("restoreAiSequencePlainBoardMediaDisplay").length - 1 === 1 &&
    !cutoutMediaSaveAndCloseFunction.includes("releaseAiSequenceRuntimePreviewOwnershipToSource") &&
    !cutoutMediaSaveAndCloseFunction.includes("restoreAiSequencePlainBoardMediaDisplay") &&
    !cutoutResourceSettleFunction.includes("releaseAiSequenceRuntimePreviewOwnershipToSource") &&
    !cutoutResourceSettleFunction.includes("restoreAiSequencePlainBoardMediaDisplay"),
  "Cancelling and saving cutout editing must settle resource mode through one shared preview-display restore helper"
);

const cutoutSaveCommitGuardIndex = cutoutMediaSaveAndCloseFunction.indexOf("if (!committed)");
const cutoutSaveCommitFailureIndex = cutoutMediaSaveAndCloseFunction.indexOf("throw new Error(labels.sessionError)", cutoutSaveCommitGuardIndex);
const cutoutSaveSettleIndex = cutoutMediaSaveAndCloseFunction.indexOf("settleAiSequenceCutoutResourceModeNow", cutoutSaveCommitFailureIndex);
assert(
  cutoutSaveCommitGuardIndex >= 0 &&
    cutoutSaveCommitFailureIndex > cutoutSaveCommitGuardIndex &&
    cutoutSaveSettleIndex > cutoutSaveCommitFailureIndex &&
    /settleAiSequenceCutoutResourceModeNow\(\s*controller,\s*"cutout-save-close",\s*\{\s*resetCutoutSource:\s*true,\s*tool:\s*labels\.tool,\s*source:\s*"save-and-close"\s*\}\s*\)/s.test(cutoutMediaSaveAndCloseFunction) &&
    cutoutMediaSaveAndCloseFunction.split("settleAiSequenceCutoutResourceModeNow").length - 1 === 1 &&
    cutoutMediaSaveAndCloseFunction.split("resetCutoutSource: true").length - 1 === 1 &&
    runtime.split("resetCutoutSource: true").length - 1 === 1 &&
    !cutoutMediaSaveAndCloseFunction.includes("novaflow:reset-ai-cutouts") &&
    !cutoutMediaSaveAndCloseFunction.includes("cutoutBridge.reset") &&
    !cutoutToolSaveFunction.includes("novaflow:reset-ai-cutouts") &&
    !cutoutToolSaveFunction.includes("cutoutBridge.reset") &&
    !cutoutToolSaveFunction.includes("resetCutoutSource"),
  "Successful cutout saves must request one Source reset through the resource settle option only, after commit succeeds; failure handlers must not reset the editor"
);

const cutoutSettleForceResourceIndex = cutoutResourceSettleFunction.indexOf("forceAiSequenceCutoutSaveResourceMode");
const cutoutSettleResetGuardIndex = cutoutResourceSettleFunction.indexOf("options.resetCutoutSource === true", cutoutSettleForceResourceIndex);
const cutoutSettleSourceResetIndex = cutoutResourceSettleFunction.indexOf('window.dispatchEvent(new CustomEvent("novaflow:reset-ai-cutouts"', cutoutSettleResetGuardIndex);
const cutoutSettlePreviewResetIndex = cutoutResourceSettleFunction.indexOf("resetAiSequencePreviewMediaStateForLayoutTransition(document)", cutoutSettleSourceResetIndex);
const cutoutSettlePreviewDisplayRestoreIndex = cutoutResourceSettleFunction.indexOf("restoreAiSequenceCutoutResourcePreviewDisplay(document)", cutoutSettlePreviewResetIndex);
const cutoutSettleSidebarRestoreIndex = cutoutResourceSettleFunction.indexOf("restoreAiSequenceResourceSidebarLayoutForResourceMode()", cutoutSettlePreviewDisplayRestoreIndex);
const cutoutSettleLayoutRestoreIndex = cutoutResourceSettleFunction.indexOf("scheduleAiSequenceResourceModeChromeRestore", cutoutSettleSidebarRestoreIndex);
assert(
  cutoutResourceSettleFunction.includes('options = {}') &&
    cutoutSettleForceResourceIndex >= 0 &&
    cutoutSettleResetGuardIndex > cutoutSettleForceResourceIndex &&
    cutoutSettleSourceResetIndex > cutoutSettleResetGuardIndex &&
    cutoutSettlePreviewResetIndex > cutoutSettleSourceResetIndex &&
    cutoutSettlePreviewDisplayRestoreIndex > cutoutSettlePreviewResetIndex &&
    cutoutSettleSidebarRestoreIndex > cutoutSettlePreviewDisplayRestoreIndex &&
    cutoutSettleLayoutRestoreIndex > cutoutSettleSidebarRestoreIndex &&
    cutoutResourceSettleFunction.split('window.dispatchEvent(new CustomEvent("novaflow:reset-ai-cutouts"').length - 1 === 1 &&
    cutoutResourceSettleFunction.split("restoreAiSequenceCutoutResourcePreviewDisplay(document)").length - 1 === 1 &&
    !cutoutResourceSettleFunction.includes("cutoutBridge.reset") &&
    !cutoutResourceSettleFunction.includes("NovaFlowAiCutoutSessionBridge.reset"),
  "Cutout save settling must force resource mode before one guarded Source reset, then restore preview display, sidebar, and final resource layout in order"
);

const processingStateClassesFunction = getFunctionBody("syncAiAnimationProcessingStateClasses");
const processingEditBranchIndex = processingStateClassesFunction.indexOf("if (cutoutEditing) {");
const processingResourceBranchIndex = processingStateClassesFunction.indexOf("} else {", processingEditBranchIndex);
const processingGenerationLoopEndIndex = processingStateClassesFunction.indexOf("\n    });", processingResourceBranchIndex);
const processingEditBranch = processingEditBranchIndex >= 0 && processingResourceBranchIndex > processingEditBranchIndex
  ? processingStateClassesFunction.slice(processingEditBranchIndex, processingResourceBranchIndex)
  : "";
const processingResourceBranch = processingResourceBranchIndex >= 0 && processingGenerationLoopEndIndex > processingResourceBranchIndex
  ? processingStateClassesFunction.slice(processingResourceBranchIndex, processingGenerationLoopEndIndex)
  : "";
assert(
  processingEditBranch.includes('setAttributeIfChanged(node, "data-novaflow-ai-processing-hidden", "1")') &&
    processingEditBranch.includes("setAiSequenceHidden(node, true)") &&
    !processingEditBranch.includes("setStylePropertyIfChanged") &&
    !processingEditBranch.includes("setImportantStyles") &&
    !processingEditBranch.includes('"display", "none"') &&
    !processingEditBranch.includes('"visibility", "hidden"') &&
    !processingEditBranch.includes('"opacity", "0"') &&
    !processingEditBranch.includes('"pointer-events", "none"') &&
    processingResourceBranch.includes('removeAttributeIfPresent(node, "data-novaflow-ai-processing-hidden")') &&
    processingResourceBranch.includes("setAiSequenceHidden(node, false)"),
  "Cutout editing must hide generation UI through the shared hidden-state contract, while resource mode must release that state without a second direct four-style hide"
);

const generationPanelMarkerFunction = getFunctionBody("markAiAnimationGenerationPanels");
const sourceOwnedPanelIndex = generationPanelMarkerFunction.indexOf("const sourceOwnedPanel");
const generationPanelGlobalClearIndex = generationPanelMarkerFunction.indexOf("document.querySelectorAll", sourceOwnedPanelIndex);
const generationPanelSourceRestoreIndex = generationPanelMarkerFunction.indexOf("if (sourceOwnedPanel instanceof HTMLElement)", generationPanelGlobalClearIndex);
const generationPanelFallbackIndex = generationPanelMarkerFunction.indexOf("const directPanel", generationPanelSourceRestoreIndex);
const sourceOwnedPanelDetection = sourceOwnedPanelIndex >= 0 && generationPanelGlobalClearIndex > sourceOwnedPanelIndex
  ? generationPanelMarkerFunction.slice(sourceOwnedPanelIndex, generationPanelGlobalClearIndex)
  : "";
const generationPanelGlobalClear = generationPanelGlobalClearIndex >= 0 && generationPanelSourceRestoreIndex > generationPanelGlobalClearIndex
  ? generationPanelMarkerFunction.slice(generationPanelGlobalClearIndex, generationPanelSourceRestoreIndex)
  : "";
const generationPanelSourceRestore = generationPanelSourceRestoreIndex >= 0 && generationPanelFallbackIndex > generationPanelSourceRestoreIndex
  ? generationPanelMarkerFunction.slice(generationPanelSourceRestoreIndex, generationPanelFallbackIndex)
  : "";
assert(
  sourceOwnedPanelDetection.includes("Array.from(bottomWorkspace.children)") &&
    sourceOwnedPanelDetection.includes("isSourceOwnedLayout(node)") &&
    sourceOwnedPanelDetection.includes("const hasPrompt") &&
    sourceOwnedPanelDetection.includes("const hasGenerate") &&
    sourceOwnedPanelDetection.includes("const hasReference") &&
    sourceOwnedPanelDetection.includes("return hasPrompt && (hasGenerate || hasReference)") &&
    generationPanelGlobalClear.includes("node !== sourceOwnedPanel") &&
    generationPanelGlobalClear.includes('removeAttributeIfPresent(node, "data-novaflow-ai-generation-panel")') &&
    generationPanelSourceRestore.includes('setAttributeIfChanged(sourceOwnedPanel, "data-novaflow-ai-generation-panel", "1")') &&
    generationPanelSourceRestore.includes("return") &&
    generationPanelSourceRestoreIndex < generationPanelFallbackIndex,
  "Generation-panel marking must preserve or restore the direct Source-owned semantic panel before clearing stale tags or running visual fallbacks"
);

const resourceModeDomRestoreFunction = getFunctionBody("restoreAiSequenceResourceModeDom");
const resourceDomWasProcessingHiddenIndex = resourceModeDomRestoreFunction.indexOf("const wasProcessingHidden");
const resourceDomRemoveProcessingMarkerIndex = resourceModeDomRestoreFunction.indexOf('removeAttributeIfPresent(node, "data-novaflow-ai-processing-hidden")', resourceDomWasProcessingHiddenIndex);
const resourceDomReleaseHiddenStateIndex = resourceModeDomRestoreFunction.indexOf("setAiSequenceHidden(node, false)", resourceDomRemoveProcessingMarkerIndex);
const resourceDomSourceDisplayGuardIndex = resourceModeDomRestoreFunction.indexOf("if (wasProcessingHidden && isInsideSourceOwnedLayout(node))", resourceDomReleaseHiddenStateIndex);
const resourceDomReleaseDisplayIndex = resourceModeDomRestoreFunction.indexOf('removeStylePropertyIfPresent(node, "display")', resourceDomSourceDisplayGuardIndex);
const resourceDomVisibleStylesIndex = resourceModeDomRestoreFunction.indexOf("setImportantStyles(node", resourceDomReleaseDisplayIndex);
assert(
  resourceDomWasProcessingHiddenIndex >= 0 &&
    resourceDomRemoveProcessingMarkerIndex > resourceDomWasProcessingHiddenIndex &&
    resourceDomReleaseHiddenStateIndex > resourceDomRemoveProcessingMarkerIndex &&
    resourceDomSourceDisplayGuardIndex > resourceDomReleaseHiddenStateIndex &&
    resourceDomReleaseDisplayIndex > resourceDomSourceDisplayGuardIndex &&
    resourceDomVisibleStylesIndex > resourceDomReleaseDisplayIndex,
  "Resource-mode recovery must remember the processing hide, release shared hidden state, then remove Runtime's forced display from Source-owned generation UI before visible styling"
);

const timelineControlLookupFunction = getFunctionBody("getAiSequenceTimelineEditControls");
const timelineFastPathIndex = timelineControlLookupFunction.indexOf("if (fastFpsGroup instanceof HTMLElement && fastLockLabel instanceof HTMLElement)");
const timelineFastWeakSetIndex = timelineControlLookupFunction.indexOf("AI_SEQUENCE_TIMELINE_EDIT_CONTROL_SET = new WeakSet(controls)", timelineFastPathIndex);
const timelineFastReturnIndex = timelineControlLookupFunction.indexOf("return {", timelineFastPathIndex);
assert(
  timelineFastPathIndex >= 0 &&
    timelineFastWeakSetIndex > timelineFastPathIndex &&
    timelineFastReturnIndex > timelineFastWeakSetIndex,
  "The timeline fast path must register FPS and lock controls before the cutout saving lock snapshots controls"
);

const cutoutSavingControlsFunction = getFunctionBody("setAiSequenceCutoutSavingControlsDisabled");
assert(
  cutoutSavingControlsFunction.includes("AI_SEQUENCE_TIMELINE_EDIT_CONTROL_SET.has(node)") &&
    cutoutSavingControlsFunction.includes("node.closest('[data-novaflow-ai-timeline-edit-group-locked]')"),
  "The global cutout saving lock must exclude timeline controls by identity and structural ownership"
);

class TimelineContractElement {
  constructor() {
    this.disabled = true;
    this.attributes = new Map([
      ["disabled", ""],
      ["aria-disabled", "true"],
      ["data-novaflow-ai-cutout-save-disabled", "1"]
    ]);
    this.styleValues = new Map([["pointer-events", "none"]]);
    this.style = {
      removeProperty: (name) => this.styleValues.delete(name),
      setProperty: (name, value) => this.styleValues.set(name, value)
    };
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
}

const timelineUnlockFunction = getFunctionWithBindings(
  runtime,
  "applyAiSequenceTimelineEditControlLock",
  {
    HTMLElement: TimelineContractElement,
    document: { body: { getAttribute: (name) => name === "data-novaflow-ai-sequence-mode" ? "resource" : null } },
    setDisabledIfChanged: (node, disabled) => {
      node.disabled = disabled;
      if (disabled) node.setAttribute("disabled", "");
      else node.removeAttribute("disabled");
    },
    setAttributeIfChanged: (node, name, value) => node.setAttribute(name, value),
    removeAttributeIfPresent: (node, name) => node.removeAttribute(name),
    removeStylePropertyIfPresent: (node, name) => node.style.removeProperty(name),
    setStylePropertyIfChanged: (node, name, value) => node.style.setProperty(name, value),
    applyAiSequenceTimelineMutedVisual: () => {}
  }
);
const staleTimelineControl = new TimelineContractElement();
timelineUnlockFunction?.(staleTimelineControl, false, "pointer");
assert(
  staleTimelineControl.disabled === false &&
    !staleTimelineControl.hasAttribute("disabled") &&
    !staleTimelineControl.hasAttribute("aria-disabled") &&
    !staleTimelineControl.hasAttribute("data-novaflow-ai-timeline-edit-locked") &&
    !staleTimelineControl.hasAttribute("data-novaflow-ai-cutout-save-disabled") &&
    staleTimelineControl.styleValues.get("pointer-events") !== "none",
  "Resource mode must self-heal stale FPS and timeline-lock disabled state after cutout save release"
);

class PreviewMediaContractElement {
  constructor({ rect = { width: 100, height: 100 }, style = {}, attributes = {} } = {}) {
    this.rect = { left: 0, top: 0, right: rect.width, bottom: rect.height, ...rect };
    this.computedStyle = { display: "block", visibility: "visible", opacity: "1", ...style };
    this.attributes = new Map(Object.entries(attributes));
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  getBoundingClientRect() { return this.rect; }
}

const visiblyRenderedMediaFunction = getFunctionWithBindings(
  runtime,
  "isAiSequencePreviewMediaVisiblyRendered",
  {
    HTMLElement: PreviewMediaContractElement,
    window: { getComputedStyle: (node) => node.computedStyle }
  }
);
const previewViewportContract = new PreviewMediaContractElement();
assert(
  visiblyRenderedMediaFunction?.(new PreviewMediaContractElement(), previewViewportContract) === true &&
    visiblyRenderedMediaFunction?.(new PreviewMediaContractElement({ style: { display: "none" } }), previewViewportContract) === false &&
    visiblyRenderedMediaFunction?.(new PreviewMediaContractElement({ style: { visibility: "hidden" } }), previewViewportContract) === false &&
    visiblyRenderedMediaFunction?.(new PreviewMediaContractElement({ style: { opacity: "0" } }), previewViewportContract) === false &&
    visiblyRenderedMediaFunction?.(new PreviewMediaContractElement({ rect: { width: 0, height: 0 } }), previewViewportContract) === false &&
    visiblyRenderedMediaFunction?.(new PreviewMediaContractElement({
      style: { opacity: "0" },
      attributes: { "data-novaflow-ai-media-load-pending": "1" }
    }), previewViewportContract) === true,
  "Paused preview selection must reject hidden ready media while preserving the pending-media load path"
);

const previewMediaCandidateFunction = getFunctionBody("isAiSequencePreviewMediaCandidate");
const previewPanZoomFunction = getFunctionBody("ensureAiSequencePreviewMediaPanZoom");
const previewPanZoomBindingFunction = getFunctionBody("bindAiSequencePreviewMediaPanZoom");
const previewCanvasFrameFunction = getFunctionBody("styleAiAnimationCanvasFrame");
const sourcePreviewOwnerFunction = getFunctionBody("isAiSequenceSourcePreviewPanZoomOwner");
const sourceRuntimeReleaseFunction = getFunctionBody("releaseAiSequenceRuntimePreviewOwnershipToSource");
const previewWheelCaptureIndex = previewPanZoomBindingFunction.indexOf('document.addEventListener("wheel"');
const previewDragHelperIndex = previewPanZoomBindingFunction.indexOf("const getPreviewDragPointerId", previewWheelCaptureIndex);
const previewWheelCaptureBlock = previewWheelCaptureIndex >= 0 && previewDragHelperIndex > previewWheelCaptureIndex
  ? previewPanZoomBindingFunction.slice(previewWheelCaptureIndex, previewDragHelperIndex)
  : "";
const previewDragCaptureIndex = previewPanZoomBindingFunction.indexOf("const beginPreviewMediaDrag =", previewDragHelperIndex);
const previewDragBindIndex = previewPanZoomBindingFunction.indexOf('document.addEventListener("pointerdown", beginPreviewMediaDrag', previewDragCaptureIndex);
const previewDragCaptureBlock = previewDragCaptureIndex >= 0 && previewDragBindIndex > previewDragCaptureIndex
  ? previewPanZoomBindingFunction.slice(previewDragCaptureIndex, previewDragBindIndex)
  : "";
const autoFitCaptureIndex = previewPanZoomBindingFunction.indexOf("const controls = button.closest('[data-novaflow-ai-zoom-controls=\"1\"]')");
const autoFitCaptureBlock = autoFitCaptureIndex >= 0 ? previewPanZoomBindingFunction.slice(autoFitCaptureIndex) : "";
assert(
  previewMediaCandidateFunction.includes("isAiSequencePreviewMediaVisiblyRendered(node, viewport)") &&
    sourcePreviewOwnerFunction.includes("isSourceOwnedLayout(viewport)") &&
    sourcePreviewOwnerFunction.includes('if (mode === "editing" || tool) return false') &&
    !sourcePreviewOwnerFunction.includes("getAiSequenceCurrentSession()") &&
    sourcePreviewOwnerFunction.includes("!isAiSequencePreviewBackplateEditingActive()") &&
    sourceRuntimeReleaseFunction.includes("releaseAiSequenceRuntimePreviewNodeToSource(node)") &&
    previewPanZoomFunction.indexOf("isAiSequenceSourcePreviewPanZoomOwner(viewport)") >= 0 &&
    previewPanZoomFunction.indexOf("releaseAiSequenceRuntimePreviewOwnershipToSource(viewport)") >
      previewPanZoomFunction.indexOf("isAiSequenceSourcePreviewPanZoomOwner(viewport)") &&
    previewPanZoomFunction.indexOf("return false", previewPanZoomFunction.indexOf("isAiSequenceSourcePreviewPanZoomOwner(viewport)")) <
      previewPanZoomFunction.indexOf("restoreAiSequencePlainBoardMediaDisplay(viewport)") &&
    previewCanvasFrameFunction.indexOf("isAiSequenceSourcePreviewPanZoomOwner(target.canvas)") >= 0 &&
    previewCanvasFrameFunction.indexOf("releaseAiSequenceRuntimePreviewNodeToSource(child)") >
      previewCanvasFrameFunction.indexOf("isAiSequenceSourcePreviewPanZoomOwner(target.canvas)") &&
    previewCanvasFrameFunction.indexOf("return", previewCanvasFrameFunction.indexOf("isAiSequenceSourcePreviewPanZoomOwner(target.canvas)")) <
      previewCanvasFrameFunction.indexOf("setImportantStyles(child") &&
    previewPanZoomFunction.includes("return true") &&
    previewPanZoomFunction.includes("return false") &&
    previewWheelCaptureBlock.indexOf("if (!ensureAiSequencePreviewMediaPanZoom(viewport)) return") >= 0 &&
    previewWheelCaptureBlock.indexOf("state.media instanceof HTMLElement ? state.media") >
      previewWheelCaptureBlock.indexOf("if (!ensureAiSequencePreviewMediaPanZoom(viewport)) return") &&
    previewDragCaptureBlock.indexOf("if (!ensureAiSequencePreviewMediaPanZoom(viewport)) return") >= 0 &&
    previewDragCaptureBlock.indexOf("state.media instanceof HTMLElement ? state.media") >
      previewDragCaptureBlock.indexOf("if (!ensureAiSequencePreviewMediaPanZoom(viewport)) return") &&
    autoFitCaptureBlock.includes("isAiSequenceSourcePreviewPanZoomOwner(viewport)") &&
    autoFitCaptureBlock.indexOf("isAiSequenceSourcePreviewPanZoomOwner(viewport)") < autoFitCaptureBlock.indexOf("stopAiSequencePreviewMediaEvent(event)"),
  "Source-owned previews must keep React as the only interaction owner; editing and legacy previews keep Runtime fallback"
);

class SourceOwnerContractElement {}
let sourceOwnerMode = "resource";
let sourceOwnerTool = "";
let sourceOwnerLayout = true;
let sourceOwnerBackplate = false;
const sourceOwnerContract = getFunctionWithBindings(
  runtime,
  "isAiSequenceSourcePreviewPanZoomOwner",
  {
    HTMLElement: SourceOwnerContractElement,
    isSourceOwnedLayout: () => sourceOwnerLayout,
    document: { body: { getAttribute: (name) => name.includes("active-tool") ? sourceOwnerTool : sourceOwnerMode } },
    isAiSequencePreviewBackplateEditingActive: () => sourceOwnerBackplate
  }
);
const sourceOwnerViewport = new SourceOwnerContractElement();
const sourceOwnerResource = sourceOwnerContract?.(sourceOwnerViewport) === true;
sourceOwnerMode = "editor-preview";
const sourceOwnerEditorPreview = sourceOwnerContract?.(sourceOwnerViewport) === true;
sourceOwnerMode = "editing";
const sourceOwnerEditing = sourceOwnerContract?.(sourceOwnerViewport) === false;
sourceOwnerMode = "resource";
sourceOwnerTool = "color-correct";
const sourceOwnerEditingTool = sourceOwnerContract?.(sourceOwnerViewport) === false;
sourceOwnerTool = "";
sourceOwnerBackplate = true;
const sourceOwnerBackplateEditing = sourceOwnerContract?.(sourceOwnerViewport) === false;
sourceOwnerBackplate = false;
sourceOwnerLayout = false;
const sourceOwnerLegacy = sourceOwnerContract?.(sourceOwnerViewport) === false;
assert(
  sourceOwnerResource && sourceOwnerEditorPreview && sourceOwnerEditing &&
    sourceOwnerEditingTool && sourceOwnerBackplateEditing && sourceOwnerLegacy,
  "Source preview ownership must cover resource/editor-preview modes while every editing tool and legacy layout stays on Runtime fallback"
);

const cutoutEditCanvasAttr = "data-novaflow-ai-cutout-edit-canvas";
const runtimeCutoutEditCanvasAttr = "${AI_SEQUENCE_CUTOUT_EDIT_CANVAS_ATTR}";
const cutoutEditCanvasMarker = `"${cutoutEditCanvasAttr}":\`1\``;
const cutoutEditCanvasRenderContract = `(0,X.jsx)(\`canvas\`,{ref:en,width:Z(p,16,4096),height:Z(m,16,4096),${cutoutEditCanvasMarker}`;
const cutoutEditCanvasFunction = getFunctionBody("isAiSequencePreviewCutoutEditCanvas");
const cutoutBrushCursorAttr = "data-novaflow-ai-cutout-brush-cursor";
const runtimeCutoutBrushCursorAttr = "${AI_SEQUENCE_CUTOUT_BRUSH_CURSOR_ATTR}";
const cutoutBrushCursorMarker = `"${cutoutBrushCursorAttr}":\`1\``;
const cutoutBrushCursorRenderContract = `(0,X.jsx)(\`div\`,{ref:Bt,${cutoutBrushCursorMarker},style:{position:\`absolute\``;
const cutoutBrushCursorFunction = getFunctionBody("isAiSequencePreviewBrushCursor");
const cutoutBrushCursorCandidatesFunction = getFunctionBody("getAiSequencePreviewBrushCursorCandidates");
const dropdownOverlayZ = Number(runtime.match(/const DROPDOWN_OVERLAY_Z_INDEX = "(\d+)";/)?.[1]);
const dropdownUnderlayZ = Number(runtime.match(/const DROPDOWN_UNDERLAY_Z_INDEX = "(\d+)";/)?.[1]);
const cutoutPanZoomBaseStart = runtime.indexOf('[data-novaflow-ai-main-stage="1"] [data-novaflow-ai-media-panzoom="1"],');
const cutoutPanZoomPointerStart = runtime.indexOf(`[data-novaflow-ai-main-stage="1"] [data-novaflow-ai-media-panzoom="1"]:not([${runtimeCutoutEditCanvasAttr}="1"])`, cutoutPanZoomBaseStart);
const cutoutPanZoomPointerEnd = runtime.indexOf('[data-novaflow-ai-media-panzoom="1"][data-novaflow-ai-media-absolute="1"]', cutoutPanZoomPointerStart);
const cutoutPanZoomPointerCss = cutoutPanZoomPointerStart >= 0 && cutoutPanZoomPointerEnd > cutoutPanZoomPointerStart
  ? runtime.slice(cutoutPanZoomPointerStart, cutoutPanZoomPointerEnd)
  : "";
const cutoutPanZoomBaseCss = cutoutPanZoomBaseStart >= 0 && cutoutPanZoomPointerStart > cutoutPanZoomBaseStart
  ? runtime.slice(cutoutPanZoomBaseStart, cutoutPanZoomPointerStart)
  : "";
const cutoutCanvasPanZoomSelector = `[${runtimeCutoutEditCanvasAttr}="1"][data-novaflow-ai-media-panzoom="1"]`;
const cutoutCanvasPanZoomStart = runtime.indexOf(cutoutCanvasPanZoomSelector);
const cutoutCanvasPanZoomEnd = runtime.indexOf('[data-novaflow-ai-media-overlay-sync="1"]', cutoutCanvasPanZoomStart);
const cutoutCanvasPanZoomCss = cutoutCanvasPanZoomStart >= 0 && cutoutCanvasPanZoomEnd > cutoutCanvasPanZoomStart
  ? runtime.slice(cutoutCanvasPanZoomStart, cutoutCanvasPanZoomEnd)
  : "";
const cutoutBrushCursorCssSelector = `[${runtimeCutoutBrushCursorAttr}="1"]`;
const cutoutBrushCursorCssStart = runtime.indexOf(cutoutBrushCursorCssSelector, cutoutCanvasPanZoomStart);
const cutoutBrushCursorCssEnd = runtime.indexOf("\n      }", cutoutBrushCursorCssStart);
const cutoutBrushCursorCss = cutoutBrushCursorCssStart >= 0 && cutoutBrushCursorCssEnd > cutoutBrushCursorCssStart
  ? runtime.slice(cutoutBrushCursorCssStart, cutoutBrushCursorCssEnd + "\n      }".length)
  : "";
assert(
  aiSequenceBundle.includes(cutoutEditCanvasRenderContract) &&
    cutoutPatchScript.includes("AI sequence cutout output canvas identity") &&
    cutoutEditCanvasFunction.includes("AI_SEQUENCE_CUTOUT_EDIT_CANVAS_ATTR") &&
    previewMediaCandidateFunction.includes("!isAiSequencePreviewCutoutEditCanvas(node, viewport)") &&
    previewMediaCandidateFunction.includes("isAiSequencePreviewBrushCanvas(node, viewport, null)") &&
    runtime.includes("if (isAiSequencePreviewCutoutEditCanvas(node, viewport)) return -1") &&
    cutoutPanZoomBaseCss &&
    !cutoutPanZoomBaseCss.includes("pointer-events") &&
    runtime.includes(`[data-novaflow-ai-media-panzoom="1"]:not([${runtimeCutoutEditCanvasAttr}="1"])`) &&
    cutoutPanZoomPointerCss.includes("pointer-events: none !important") &&
    cutoutCanvasPanZoomCss &&
    !cutoutCanvasPanZoomCss.includes("pointer-events") &&
    aiSequenceBundle.includes("pointerEvents:N&&(!b||Ce)?`auto`:`none`") &&
    runtime.includes(`canvas:not([${runtimeCutoutEditCanvasAttr}="1"]):not([data-novaflow-ai-media-panzoom="1"])`),
  "Cutout editing must use its rendered output canvas as the Runtime pan/zoom and brush coordinate owner"
);
assert(
  aiSequenceBundle.includes(cutoutBrushCursorRenderContract) &&
    cutoutPatchScript.includes("AI sequence cutout brush cursor identity") &&
    cutoutPatchScript.includes(cutoutBrushCursorAttr) &&
    runtime.includes(`const AI_SEQUENCE_CUTOUT_BRUSH_CURSOR_ATTR = "${cutoutBrushCursorAttr}";`) &&
    runtime.includes("const AI_SEQUENCE_PREVIEW_BRUSH_LAYER_Z_INDEX = DROPDOWN_UNDERLAY_Z_INDEX;") &&
    runtime.includes("const AI_SEQUENCE_PREVIEW_BRUSH_CURSOR_Z_INDEX = String(Number(AI_SEQUENCE_PREVIEW_BRUSH_LAYER_Z_INDEX) + 1);") &&
    Number.isFinite(dropdownUnderlayZ) &&
    Number.isFinite(dropdownOverlayZ) &&
    dropdownUnderlayZ + 1 < dropdownOverlayZ &&
    cutoutBrushCursorFunction.includes('node.getAttribute(AI_SEQUENCE_CUTOUT_BRUSH_CURSOR_ATTR) === "1"') &&
    cutoutBrushCursorCandidatesFunction.includes("AI_SEQUENCE_CUTOUT_BRUSH_CURSOR_ATTR") &&
    cutoutBrushCursorCss.includes("z-index: ${AI_SEQUENCE_PREVIEW_BRUSH_CURSOR_Z_INDEX} !important;") &&
    cutoutBrushCursorCssStart > cutoutCanvasPanZoomStart,
  "Cutout brush cursor must have a stable identity and paint strictly above media and below dropdowns"
);

class CutoutContractElement {}
class CutoutContractCanvas extends CutoutContractElement {
  constructor(marked = true) {
    super();
    this.marked = marked;
    this.width = 540;
    this.height = 960;
  }
  getAttribute(name) {
    if (name === cutoutEditCanvasAttr) return this.marked ? "1" : null;
    return null;
  }
  closest() { return null; }
  getBoundingClientRect() { return { width: 270, height: 480 }; }
}
class CutoutContractViewport extends CutoutContractElement {
  constructor(child = null) {
    super();
    this.child = child;
  }
  contains(node) { return node === this.child; }
}
let cutoutContractEditing = true;
const cutoutCanvasIdentityContract = getFunctionWithBindings(runtime, "isAiSequencePreviewCutoutEditCanvas", {
  HTMLCanvasElement: CutoutContractCanvas,
  HTMLElement: CutoutContractElement,
  AI_SEQUENCE_CUTOUT_EDIT_CANVAS_ATTR: cutoutEditCanvasAttr,
  isAiSequencePreviewBackplateEditingActive: () => cutoutContractEditing
});
const markedCutoutCanvas = new CutoutContractCanvas(true);
const unmarkedCutoutCanvas = new CutoutContractCanvas(false);
const cutoutContractViewport = new CutoutContractViewport(markedCutoutCanvas);
const markedCutoutEditing = cutoutCanvasIdentityContract?.(markedCutoutCanvas, cutoutContractViewport) === true;
const unmarkedCutoutEditing = cutoutCanvasIdentityContract?.(unmarkedCutoutCanvas, new CutoutContractViewport(unmarkedCutoutCanvas)) === false;
const detachedCutoutEditing = cutoutCanvasIdentityContract?.(markedCutoutCanvas, new CutoutContractViewport(null)) === false;
cutoutContractEditing = false;
const markedCutoutResource = cutoutCanvasIdentityContract?.(markedCutoutCanvas, cutoutContractViewport) === false;
cutoutContractEditing = true;
const cutoutMediaCandidateContract = getFunctionWithBindings(runtime, "isAiSequencePreviewMediaCandidate", {
  isAiSequencePreviewMediaElement: () => true,
  HTMLElement: CutoutContractElement,
  HTMLCanvasElement: CutoutContractCanvas,
  HTMLImageElement: class extends CutoutContractElement {},
  HTMLVideoElement: class extends CutoutContractElement {},
  isAiSequencePreviewCutoutEditCanvas: (node) => node.marked === true,
  isAiSequencePreviewBrushCanvas: () => true,
  getAiSequencePreviewMediaSize: () => ({ ready: true }),
  isAiSequencePreviewMediaVisiblyRendered: () => true
});
const markedCutoutCandidate = cutoutMediaCandidateContract?.(markedCutoutCanvas, cutoutContractViewport) === true;
const unmarkedCutoutCandidate = cutoutMediaCandidateContract?.(unmarkedCutoutCanvas, new CutoutContractViewport(unmarkedCutoutCanvas)) === false;
const cutoutCandidateRankContract = getFunctionWithBindings(runtime, "getAiSequencePreviewMediaCandidateRank", {
  isAiSequencePreviewCutoutEditCanvas: (node) => node.marked === true,
  HTMLImageElement: class extends CutoutContractElement {},
  HTMLVideoElement: class extends CutoutContractElement {},
  HTMLCanvasElement: CutoutContractCanvas,
  getAiSequencePreviewMediaSize: () => ({ ready: true }),
  isAiSequencePreviewBackplateEditingActive: () => true
});
assert(
  markedCutoutEditing && unmarkedCutoutEditing && detachedCutoutEditing && markedCutoutResource &&
    markedCutoutCandidate && unmarkedCutoutCandidate &&
    cutoutCandidateRankContract?.(markedCutoutCanvas, cutoutContractViewport) === -1,
  "Cutout output canvas identity, candidate selection, and editing priority must remain explicit"
);

class CutoutBrushCursorContractElement {
  constructor(marked = false) { this.marked = marked; }
  contains(node) { return node instanceof CutoutBrushCursorContractElement; }
  closest() { return null; }
  getAttribute(name) {
    return name === cutoutBrushCursorAttr && this.marked ? "1" : null;
  }
  getBoundingClientRect() { return { width: 22, height: 22 }; }
}
const cutoutBrushCursorContract = getFunctionWithBindings(
  runtime,
  "isAiSequencePreviewBrushCursor",
  {
    HTMLElement: CutoutBrushCursorContractElement,
    AI_SEQUENCE_CUTOUT_BRUSH_CURSOR_ATTR: cutoutBrushCursorAttr,
    isAiSequencePreviewBackplateEditingActive: () => true,
    getAiSequenceReactDomProps: () => null,
    window: {
      getComputedStyle: () => ({
        display: "none",
        visibility: "visible",
        opacity: "1",
        position: "absolute",
        pointerEvents: "none"
      })
    }
  }
);
const cutoutBrushCursorViewport = new CutoutBrushCursorContractElement();
assert(
  cutoutBrushCursorContract?.(new CutoutBrushCursorContractElement(true), cutoutBrushCursorViewport) === true &&
    cutoutBrushCursorContract?.(new CutoutBrushCursorContractElement(false), cutoutBrushCursorViewport) === false,
  "Stable cutout brush cursor identity must be recognized before the cursor becomes visible"
);

const cutoutUndoContractFragments = [
  "r.frameMap?.delete?.(u)",
  "Xn(`dirty`,{scope:`frame`,t:e.t})",
  "allowCurrentFrameReuse:!b",
  "g=!!n?.allowCurrentFrameReuse&&!n?.strict&&e.readyState>=2&&Math.abs(d-s)<=c",
  "A.version!==F||A.cacheKey!==O?m:"
];
assert(
  cutoutUndoContractFragments.every((fragment) => aiSequenceBundle.includes(fragment)) &&
    cutoutPatchScript.includes("AI sequence cutout targeted preview cache invalidation") &&
    cutoutPatchScript.includes("AI sequence paused cutout same-frame seek fast path") &&
    cutoutPatchScript.includes("AI sequence cutout preview rejects stale warmup writes"),
  "Cutout edits and undo must invalidate one frame, reuse an already-presented paused frame, and reject stale warmup writes"
);

const chromaColdWarmupCall = "await rr({media:s,cacheMedia:R===`key`?r:void 0,sourceFrameIndex:c,timeSec:l,traceSurface:`preview`,previewFrame:!0,previewW:o.w,previewH:o.h,strictFrameSync:R===`key`})";
const chromaColdWarmupContractFragments = [
  chromaColdWarmupCall,
  "n?.strictFrameSync?{strict:!0,requireRvfcVerified:!0,frameSyncTimeoutMs:1500,ensureReadyTimeoutMs:3e3,seekTimeoutMs:3e3,toleranceSec:Math.max(.01,.5/Math.max(1,s))}",
  "nfArmVerifiedVideoFrame=(e,t,n,r)=>",
  "nfDriveVideoFrameForPresentation=(e,t)=>",
  "e?.isConnected!==!0||e?.getAttribute?.(`data-novaflow-cutout-preview-media`)!==`1`",
  "settled:()=>i,fail:e=>d(",
  "let b=!!v?.start?.()",
  "data-novaflow-cutout-preview-media-host",
  "nfPreviewMediaHost.attachShadow?.({mode:`closed`})",
  "nfPreviewMediaHost?.remove?.()",
  "if(n?.strict&&n?.requireRvfcVerified){e.readyState<2&&await wt(e,Number(e.currentTime)||0,n)",
  "Math.max(0,o-.001)",
  "v=nfArmVerifiedVideoFrame(e,s,c,l)",
  "w=nfDriveVideoFrameForPresentation(e,e=>v?.fail?.(e))",
  "m=v?await v.promise:",
  "m?.mediaTime!=null&&Number.isFinite(Number(m.mediaTime))?Number(m.mediaTime).toFixed(6):`null`",
  "n?.strict&&!n?.requireRvfcVerified&&m?.timedOut&&m?.mediaTime==null",
  "j&&j.key===k&&j.imageData&&(!n?.strictFrameSync||j.frameSyncVerified===!0)",
  "A.frameMap.delete(T),A.bytes=Math.max(0,(A.bytes||0)-(Number(j?.width)||i.w)*(Number(j?.height)||i.h)*4)",
  "q=await Lt(r,t,R===`ai`?",
  "frameSyncVerified:R===`ai`||!!n?.strictFrameSync&&q?.frameCallbackVerified===!0&&!q?.timedOut",
  "return!!t?.imageData&&(R!==`key`||t.frameSyncVerified===!0)",
  "return!!n?.imageData&&(R!==`key`||n.frameSyncVerified===!0)"
];
const chromaColdWarmupPatchLabels = [
  "AI sequence chroma warmup opts into strict decoded-frame sync",
  "AI sequence chroma strict sync requires real video frame callback",
  "AI sequence chroma strict sync rejects currentTime-only timeout fallback",
  "AI sequence chroma strict sync prearms target frame verification",
  "AI sequence chroma strict sync migrates prearmed verification deadline ownership",
  "AI sequence chroma same-target cold seek primes before target verification",
  "AI sequence chroma same-target cold seek migrates safe neighbor and deadline control",
  "AI sequence chroma strict sync consumes the prearmed target callback",
  "AI sequence chroma strict sync migrates prearmed controller consumption",
  "AI sequence chroma strict sync cancels prearmed callbacks on currentTime drift",
  "AI sequence chroma strict sync preserves unavailable callback errors",
  "AI sequence chroma strict sync preserves null callback metadata",
  "AI sequence chroma strict sync stops presentation before resolving",
  "AI sequence chroma strict sync start reports presentation demand",
  "AI sequence chroma strict sync start confirms presentation demand",
  "AI sequence chroma strict sync migrates detached canvas presentation",
  "AI sequence chroma strict sync scopes presentation drive to an attached warmup clone",
  "AI sequence chroma strict sync upgrades attached clone presentation cleanup",
  "AI sequence chroma strict sync drives detached video presentation",
  "AI sequence chroma strict sync exposes settled and play failure state",
  "AI sequence chroma strict sync migrates detached canvas consumption",
  "AI sequence chroma strict sync consumes detached video presentation",
  "AI sequence chroma strict sync skips settled play and cleans all exits",
  "AI sequence chroma strict sync reports null media time accurately",
  "AI sequence chroma strict sync preserves null presented frame trace",
  "AI sequence chroma strict sync preserves null presented frame result",
  "AI sequence strict warmup bypasses unverified cached frames",
  "AI sequence strict warmup removes unverified cache bytes before replacement",
  "AI sequence chroma frame sync captures decoder verification result",
  "AI sequence chroma frame sync stores decoder verification result",
  "AI sequence preview cache records verified frame sync",
  "AI sequence chroma cache verification derives from decoder result",
  "AI sequence chroma warmup ready requires verified frames",
  "AI sequence chroma warmup completion requires verified frames",
  "AI sequence chroma detached warmup requests strict frame sync",
  "AI sequence chroma warmup rejects clone load failure without touching visible media",
  "AI sequence chroma warmup attaches only its clone for presentation",
  "AI sequence chroma warmup removes its isolated media host",
  "AI sequence chroma warmup tracks an isolated media host"
];
assert(
  chromaColdWarmupContractFragments.every((fragment) => aiSequenceBundle.includes(fragment)) &&
    chromaColdWarmupPatchLabels.every((label) => cutoutPatchScript.includes(label)) &&
    !aiSequenceBundle.includes("nfPreviewMediaHost=null,s=r") &&
    aiSequenceBundle.includes("catch(nfPreviewMediaError){try{nfPreviewMediaHost?.remove?.()}catch{}nfPreviewMediaHost=null;throw nfPreviewMediaError}") &&
    aiSequenceBundle.indexOf(chromaColdWarmupCall) === aiSequenceBundle.lastIndexOf(chromaColdWarmupCall),
  "Detached chroma warmup must request strict decoded-frame sync and only accept verified frames as ready"
);
assert(
  aiSequenceBundle.includes("nfPreviewFailedFrame=1") &&
    aiSequenceBundle.includes("nfPreviewFailedFrame=i+1") &&
    aiSequenceBundle.includes("Jn(nfPreviewFailedFrame,e.frames.length,`预览渲染失败`)") &&
    aiSequenceBundle.includes("}catch(nfPreviewError){console.error(nfPreviewError),Jn(nfPreviewFailedFrame,e.frames.length,`预览渲染失败`)") &&
    !aiSequenceBundle.includes("Jn(0,1,`预览渲染失败`)") &&
    cutoutPatchScript.includes("AI sequence cutout preview failure tracks the active frame") &&
    cutoutPatchScript.includes("AI sequence cutout preview records the frame being rendered") &&
    cutoutPatchScript.includes("AI sequence cutout preview failure reports the real frame and total") &&
    cutoutPatchScript.includes("AI sequence cutout preview failure keeps the render plan in scope"),
  "Cutout preview failures must report the active failed frame against the real frame total"
);

const liveCutoutPreviewCall = "await rr({media:r,sourceFrameIndex:d,timeSec:u,traceSurface:`preview`,previewFrame:!0,previewW:e.w,previewH:e.h,allowCurrentFrameReuse:!b})";
const finalAssetFrameCall = "await rr({media:e,sourceFrameIndex:E+t,timeSec:n,traceSurface:ce,exportFrameIndex:t})";
const finalAssetFrameCallIndex = aiSequenceBundle.indexOf(finalAssetFrameCall);
const finalAssetFrameCallScope = finalAssetFrameCallIndex >= 0
  ? aiSequenceBundle.slice(finalAssetFrameCallIndex, finalAssetFrameCallIndex + finalAssetFrameCall.length + 160)
  : "";
const cutoutSaveBridgeIndex = aiSequenceBundle.indexOf("window.NovaFlowAiSequenceAssetBridge={version:`cutout-save-close-20260521`,commitCutoutFile:async");
const cutoutSaveBridgeScope = cutoutSaveBridgeIndex >= 0
  ? aiSequenceBundle.slice(cutoutSaveBridgeIndex, cutoutSaveBridgeIndex + 700)
  : "";
assert(
  aiSequenceBundle.includes(liveCutoutPreviewCall) &&
    aiSequenceBundle.includes("R===`ai`?{traceProbe:a,strict:!0,frameSyncTimeoutMs:1500,toleranceSec:Math.max(.01,.5/Math.max(1,s))}") &&
    !aiSequenceBundle.includes("R===`ai`?{traceProbe:a,strict:!0,requireRvfcVerified") &&
    aiSequenceBundle.includes("ce=String(n?.source||(C?`final-asset`:`export-rebuild`))") &&
    finalAssetFrameCallIndex >= 0 &&
    !finalAssetFrameCallScope.includes("strictFrameSync") &&
    cutoutSaveBridgeIndex >= 0 &&
    !cutoutSaveBridgeScope.includes("strictFrameSync"),
  "Cold chroma strict sync must stay outside live same-frame reuse, AI, FinalAsset, and save/import boundaries"
);
assert(
  !aiSequenceBundle.includes(",ie,ut,Fn,ye,s,De,ke,je,Ne,Y,Be,Ie,Re,He].join(`|`)") &&
    !aiSequenceBundle.includes("qt.current.push(t)") &&
    !aiSequenceBundle.includes("Gt.current.stack.push(t)") &&
    !aiSequenceBundle.includes("Sn.current+=1,Xn(`dirty`),$e") &&
    aiSequenceBundle.includes("if(!V&&!b&&!s&&r&&(r?.currentSrc||r?.src))"),
  "A frame edit must not rotate the whole cache identity, retain duplicate full-frame history, or perform duplicate paused seeks"
);

const verifiedVideoFrameArmFunction = getAssignedArrowFunctionWithBindings(
  aiSequenceBundle,
  "nfArmVerifiedVideoFrame",
  {
    performance: globalThis.performance,
    window: {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (timer) => clearTimeout(timer)
    }
  },
  "nfArmVerifiedVideoFrame=("
);
const detachedVideoPresentationDriverFunction = getAssignedArrowFunctionWithBindings(
  aiSequenceBundle,
  "nfDriveVideoFrameForPresentation",
  {},
  "nfDriveVideoFrameForPresentation=(e,t)=>"
);
let unmarkedPresentationPlayCount = 0;
const unmarkedPresentationDriver = detachedVideoPresentationDriverFunction?.({
  isConnected: true,
  playbackRate: 1,
  muted: false,
  getAttribute() { return null; },
  play() { unmarkedPresentationPlayCount += 1; },
  pause() {}
});
unmarkedPresentationDriver?.stop?.();
let detachedPresentationPlayCount = 0;
const detachedPresentationDriver = detachedVideoPresentationDriverFunction?.({
  isConnected: false,
  playbackRate: 1,
  muted: true,
  getAttribute() { return "1"; },
  play() { detachedPresentationPlayCount += 1; },
  pause() {}
});
detachedPresentationDriver?.stop?.();
assert(
  unmarkedPresentationPlayCount === 0 && detachedPresentationPlayCount === 0,
  "Strict chroma presentation drive must never play the visible source or a detached clone"
);
let latePresentationResolve;
let latePresentationPauseCount = 0;
const latePresentationMedia = {
  isConnected: true,
  playbackRate: 1,
  muted: false,
  getAttribute(name) {
    return name === "data-novaflow-cutout-preview-media" ? "1" : null;
  },
  play() {
    return new Promise((resolve) => { latePresentationResolve = resolve; });
  },
  pause() { latePresentationPauseCount += 1; }
};
const latePresentationDriver = detachedVideoPresentationDriverFunction?.(latePresentationMedia, () => {});
latePresentationDriver?.stop?.();
latePresentationResolve?.();
await Promise.resolve();
await Promise.resolve();
assert(
  latePresentationPauseCount >= 2 &&
    latePresentationMedia.playbackRate === 1 &&
    latePresentationMedia.muted === false,
  "A late play resolution must pause again and retain restored clone settings after cleanup"
);
let rejectedPresentationError = "";
let rejectedPresentationPauseCount = 0;
const rejectedPresentationDriver = detachedVideoPresentationDriverFunction?.({
  isConnected: true,
  playbackRate: 1,
  muted: true,
  getAttribute(name) {
    return name === "data-novaflow-cutout-preview-media" ? "1" : null;
  },
  play() { return Promise.reject(new Error("presentation play rejected")); },
  pause() { rejectedPresentationPauseCount += 1; }
}, (error) => { rejectedPresentationError = String(error?.message || error); });
await Promise.resolve();
await Promise.resolve();
rejectedPresentationDriver?.stop?.();
assert(
  rejectedPresentationError === "presentation play rejected" && rejectedPresentationPauseCount >= 1,
  "A clone play rejection must reach the strict controller error path and still pause during cleanup"
);
const sameFrameSeekFunction = getAssignedArrowFunctionWithBindings(
  aiSequenceBundle,
  "Lt",
  {},
  "Lt=async(e,t,n)=>"
);
const sameFrameSeekTrace = {};
const sameFrameSeekResult = await sameFrameSeekFunction?.(
  { duration: 3, currentTime: 1, readyState: 2 },
  1,
  { allowCurrentFrameReuse: true, traceProbe: sameFrameSeekTrace }
);
assert(
  sameFrameSeekResult?.sameFrameFastPath === true &&
    sameFrameSeekTrace.sameFrameFastPath === true &&
    sameFrameSeekResult.currentTime === 1,
  "Paused cutout preview must complete a same-frame request without the two-frame/RVFC seek path"
);

const coldSeekTargetTime = 1;
const coldSeekStaleTime = coldSeekTargetTime - (1 / 30);
const coldSeekFrameMap = new Map();
let coldSeekCallbackCount = 0;
let coldSeekPauseCount = 0;
let coldSeekPlayCount = 0;
let coldSeekResolved = false;
let staleCallbackObservedBeforeCacheWrite = false;
const strictColdSeekFunction = getAssignedArrowFunctionWithBindings(
  aiSequenceBundle,
  "Lt",
  {
    wt: async (media, targetTime) => {
      media.currentTime = targetTime;
    },
    requestAnimationFrame: (callback) => callback(Date.now()),
    nfArmVerifiedVideoFrame: verifiedVideoFrameArmFunction,
    nfDriveVideoFrameForPresentation: detachedVideoPresentationDriverFunction,
    performance: globalThis.performance,
    window: {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (timer) => clearTimeout(timer)
    }
  },
  "Lt=async(e,t,n)=>"
);
const coldSeekVideo = {
  duration: 2,
  currentTime: coldSeekTargetTime,
  readyState: 2,
  isConnected: true,
  getAttribute(name) {
    return name === "data-novaflow-cutout-preview-media" ? "1" : null;
  },
  pause() {
    coldSeekPauseCount += 1;
  },
  play() {
    coldSeekPlayCount += 1;
    return Promise.resolve();
  },
  requestVideoFrameCallback(callback) {
    const callbackOrdinal = ++coldSeekCallbackCount;
    const mediaTime = callbackOrdinal === 1 ? coldSeekStaleTime : coldSeekTargetTime;
    queueMicrotask(() => {
      callback(0, { mediaTime, presentedFrames: callbackOrdinal });
      if (callbackOrdinal === 1) {
        queueMicrotask(() => {
          staleCallbackObservedBeforeCacheWrite = !coldSeekResolved && coldSeekFrameMap.size === 0;
        });
      }
    });
  }
};
const strictColdSeekWarmup = (async () => {
  const frameSync = await strictColdSeekFunction?.(
    coldSeekVideo,
    coldSeekTargetTime,
    { strict: true, requireRvfcVerified: true, frameSyncTimeoutMs: 400, toleranceSec: 0.01 }
  );
  coldSeekResolved = true;
  coldSeekFrameMap.set(7, {
    mediaTime: frameSync?.mediaTime,
    frameSyncVerified: frameSync?.frameCallbackVerified === true
  });
  return frameSync;
})();
const strictColdSeekResult = await strictColdSeekWarmup;
assert(
  staleCallbackObservedBeforeCacheWrite &&
    coldSeekCallbackCount === 2 &&
    coldSeekPlayCount === 0 &&
    coldSeekPauseCount >= 1 &&
    strictColdSeekResult?.mediaTime === coldSeekTargetTime &&
    strictColdSeekResult?.frameCallbackVerified === true &&
    coldSeekFrameMap.size === 1 &&
    coldSeekFrameMap.get(7)?.mediaTime === coldSeekTargetTime &&
    coldSeekFrameMap.get(7)?.frameSyncVerified === true &&
    coldSeekFrameMap.get(7)?.mediaTime !== coldSeekStaleTime,
  "Cold chroma warmup must reject the first stale RVFC frame, skip play once already verified, and write cache only after the target mediaTime is verified"
);

const sameTargetSeekHistory = [];
let sameTargetCurrentTime = coldSeekTargetTime;
let sameTargetPendingFrameCallback = null;
let sameTargetFrameCallbackId = 0;
const sameTargetNoPresentationVideo = {
  duration: 2,
  readyState: 2,
  pause() {},
  get currentTime() {
    return sameTargetCurrentTime;
  },
  set currentTime(value) {
    const nextTime = Number(value) || 0;
    const changed = Math.abs(nextTime - sameTargetCurrentTime) >= 0.001;
    sameTargetCurrentTime = nextTime;
    sameTargetSeekHistory.push(nextTime);
    if (changed && sameTargetPendingFrameCallback) {
      const pending = sameTargetPendingFrameCallback;
      sameTargetPendingFrameCallback = null;
      queueMicrotask(() => pending.callback(0, {
        mediaTime: nextTime,
        presentedFrames: pending.id
      }));
    }
  },
  requestVideoFrameCallback(callback) {
    const id = ++sameTargetFrameCallbackId;
    sameTargetPendingFrameCallback = { id, callback };
    return id;
  },
  cancelVideoFrameCallback(id) {
    if (sameTargetPendingFrameCallback?.id === id) sameTargetPendingFrameCallback = null;
  }
};
const sameTargetFrameSync = await strictColdSeekFunction?.(
  sameTargetNoPresentationVideo,
  coldSeekTargetTime,
  { strict: true, requireRvfcVerified: true, frameSyncTimeoutMs: 400, toleranceSec: 0.01 }
);
assert(
  sameTargetSeekHistory.length >= 2 &&
    Math.abs(sameTargetSeekHistory[0] - coldSeekTargetTime) > 0.01 &&
    sameTargetSeekHistory.at(-1) === coldSeekTargetTime &&
    sameTargetFrameCallbackId === 1 &&
    sameTargetFrameSync?.mediaTime === coldSeekTargetTime &&
    sameTargetFrameSync?.frameCallbackVerified === true &&
    sameTargetFrameSync?.timedOut !== true,
  "Cold chroma warmup must prime a same-target detached video and arm RVFC before seeking back to the target frame"
);

let playOnlyCurrentTime = coldSeekTargetTime;
let playOnlyPendingFrameCallback = null;
let playOnlyFrameCallbackId = 0;
let playOnlyPlayCount = 0;
let playOnlyPauseCount = 0;
let playOnlyPausedBeforeRvfcReturned = false;
const playOnlyPresentationVideo = {
  duration: 2,
  readyState: 2,
  isConnected: true,
  playbackRate: 1,
  muted: false,
  getAttribute(name) {
    return name === "data-novaflow-cutout-preview-media" ? "1" : null;
  },
  pause() {
    playOnlyPauseCount += 1;
  },
  get currentTime() {
    return playOnlyCurrentTime;
  },
  set currentTime(value) {
    playOnlyCurrentTime = Number(value) || 0;
  },
  requestVideoFrameCallback(callback) {
    const id = ++playOnlyFrameCallbackId;
    playOnlyPendingFrameCallback = { id, callback };
    return id;
  },
  cancelVideoFrameCallback(id) {
    if (playOnlyPendingFrameCallback?.id === id) playOnlyPendingFrameCallback = null;
  },
  play() {
    playOnlyPlayCount += 1;
    if (!playOnlyPendingFrameCallback) return Promise.resolve();
    const pending = playOnlyPendingFrameCallback;
    playOnlyPendingFrameCallback = null;
    queueMicrotask(() => {
      pending.callback(0, {
        mediaTime: playOnlyCurrentTime,
        presentedFrames: pending.id
      });
      playOnlyPausedBeforeRvfcReturned = playOnlyPauseCount >= 2;
    });
    return Promise.resolve();
  }
};
const playOnlyFrameSync = await strictColdSeekFunction?.(
  playOnlyPresentationVideo,
  coldSeekTargetTime,
  { strict: true, requireRvfcVerified: true, frameSyncTimeoutMs: 400, toleranceSec: 0.01 }
);
assert(
  playOnlyPlayCount === 1 &&
    playOnlyPauseCount >= 2 &&
    playOnlyPausedBeforeRvfcReturned &&
    playOnlyFrameCallbackId === 1 &&
    playOnlyPresentationVideo.playbackRate === 1 &&
    playOnlyPresentationVideo.muted === false &&
    playOnlyFrameSync?.mediaTime === coldSeekTargetTime &&
    playOnlyFrameSync?.frameCallbackVerified === true &&
    playOnlyFrameSync?.timedOut !== true,
  "Detached chroma warmup must briefly drive only its clone until RVFC presents the target frame, then pause and restore media settings"
);

let slowTargetSeekCurrentTime = coldSeekTargetTime;
let slowTargetSeekSawKick = false;
let slowTargetPendingFrameCallback = null;
let slowTargetFrameCallbackId = 0;
const slowTargetSeekDelayMs = 220;
const slowTargetFrameSyncTimeoutMs = 100;
const slowTargetSeekFunction = getAssignedArrowFunctionWithBindings(
  aiSequenceBundle,
  "Lt",
  {
    wt: async (media, targetTime) => {
      if (Math.abs(targetTime - coldSeekTargetTime) >= 0.001) {
        slowTargetSeekSawKick = true;
        slowTargetSeekCurrentTime = targetTime;
        return;
      }
      if (slowTargetSeekSawKick) {
        await new Promise((resolve) => setTimeout(resolve, slowTargetSeekDelayMs));
      }
      slowTargetSeekCurrentTime = targetTime;
      if (slowTargetPendingFrameCallback) {
        const pending = slowTargetPendingFrameCallback;
        slowTargetPendingFrameCallback = null;
        queueMicrotask(() => pending.callback(0, {
          mediaTime: targetTime,
          presentedFrames: pending.id
        }));
      }
    },
    requestAnimationFrame: (callback) => callback(Date.now()),
    nfArmVerifiedVideoFrame: verifiedVideoFrameArmFunction,
    nfDriveVideoFrameForPresentation: detachedVideoPresentationDriverFunction,
    performance: globalThis.performance,
    window: {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (timer) => clearTimeout(timer)
    }
  },
  "Lt=async(e,t,n)=>"
);
const slowTargetNoEarlyTimeoutVideo = {
  duration: 2,
  readyState: 2,
  pause() {},
  get currentTime() {
    return slowTargetSeekCurrentTime;
  },
  set currentTime(value) {
    slowTargetSeekCurrentTime = Number(value) || 0;
  },
  requestVideoFrameCallback(callback) {
    const id = ++slowTargetFrameCallbackId;
    slowTargetPendingFrameCallback = { id, callback };
    return id;
  },
  cancelVideoFrameCallback(id) {
    if (slowTargetPendingFrameCallback?.id === id) slowTargetPendingFrameCallback = null;
  }
};
const slowTargetSeekStartedAt = performance.now();
const slowTargetFrameSync = await slowTargetSeekFunction?.(
  slowTargetNoEarlyTimeoutVideo,
  coldSeekTargetTime,
  {
    strict: true,
    requireRvfcVerified: true,
    frameSyncTimeoutMs: slowTargetFrameSyncTimeoutMs,
    seekTimeoutMs: 500,
    toleranceSec: 0.01
  }
);
const slowTargetSeekElapsedMs = performance.now() - slowTargetSeekStartedAt;
assert(
  slowTargetSeekSawKick &&
    slowTargetSeekElapsedMs >= slowTargetSeekDelayMs &&
    slowTargetSeekDelayMs > slowTargetFrameSyncTimeoutMs &&
    slowTargetFrameCallbackId === 1 &&
    slowTargetFrameSync?.mediaTime === coldSeekTargetTime &&
    slowTargetFrameSync?.frameCallbackVerified === true &&
    slowTargetFrameSync?.timedOut !== true,
  "Prearmed chroma RVFC verification must start its timeout only after the target seek finishes"
);

let coldSeekTimeoutCallbackCount = 0;
let coldSeekTimeoutError = "";
const coldSeekTimeoutFrameMap = new Map();
const coldSeekTimeoutVideo = {
  duration: 2,
  currentTime: coldSeekTargetTime,
  readyState: 2,
  pause() {},
  requestVideoFrameCallback(callback) {
    coldSeekTimeoutCallbackCount += 1;
    if (coldSeekTimeoutCallbackCount === 1) {
      queueMicrotask(() => callback(0, { mediaTime: coldSeekStaleTime, presentedFrames: 1 }));
    }
  }
};
try {
  const timeoutFrameSync = await strictColdSeekFunction?.(
    coldSeekTimeoutVideo,
    coldSeekTargetTime,
    { strict: true, requireRvfcVerified: true, frameSyncTimeoutMs: 200, toleranceSec: 0.01 }
  );
  if (timeoutFrameSync?.frameCallbackVerified === true && timeoutFrameSync?.timedOut !== true) {
    coldSeekTimeoutFrameMap.set(7, timeoutFrameSync);
  }
} catch (error) {
  coldSeekTimeoutError = String(error?.message || error);
}
assert(
  coldSeekTimeoutCallbackCount >= 2 &&
    coldSeekTimeoutFrameMap.size === 0 &&
    coldSeekTimeoutError.includes("video frame callback drift [compose-lock-3]"),
  "Cold chroma warmup must fail without a real target RVFC callback instead of trusting currentTime after timeout"
);

let zeroCallbackTimeoutError = "";
const zeroCallbackTimeoutVideo = {
  duration: 2,
  currentTime: coldSeekTargetTime,
  readyState: 2,
  pause() {},
  requestVideoFrameCallback() {
    return 1;
  },
  cancelVideoFrameCallback() {}
};
try {
  await strictColdSeekFunction?.(
    zeroCallbackTimeoutVideo,
    coldSeekTargetTime,
    { strict: true, requireRvfcVerified: true, frameSyncTimeoutMs: 200, toleranceSec: 0.01 }
  );
} catch (error) {
  zeroCallbackTimeoutError = String(error?.message || error);
}
assert(
  zeroCallbackTimeoutError.includes("video frame callback drift [compose-lock-3]") &&
    zeroCallbackTimeoutError.includes("mediaTime=null") &&
    !zeroCallbackTimeoutError.includes("mediaTime=0.000000"),
  "A zero-callback RVFC timeout must report null mediaTime instead of fabricating frame zero"
);

const replacementFrameWidth = 24;
const replacementFrameHeight = 40;
const replacementFrameBytes = replacementFrameWidth * replacementFrameHeight * 4;
const replacementFrameMap = new Map([[
  7,
  { width: replacementFrameWidth, height: replacementFrameHeight, frameSyncVerified: false }
]]);
let replacementCacheBytes = replacementFrameBytes;
const unverifiedReplacement = replacementFrameMap.get(7);
replacementFrameMap.delete(7);
replacementCacheBytes = Math.max(
  0,
  replacementCacheBytes -
    (Number(unverifiedReplacement?.width) || replacementFrameWidth) *
    (Number(unverifiedReplacement?.height) || replacementFrameHeight) * 4
);
replacementFrameMap.set(7, {
  width: replacementFrameWidth,
  height: replacementFrameHeight,
  frameSyncVerified: true
});
replacementCacheBytes += replacementFrameBytes;
assert(
  replacementFrameMap.size === 1 &&
    replacementFrameMap.get(7)?.frameSyncVerified === true &&
    replacementCacheBytes === replacementFrameBytes,
  "Replacing an unverified chroma frame must keep cache byte accounting at one frame"
);

const representativeCutoutFrameCount = 81;
const previousUndoInvalidatedFrames = representativeCutoutFrameCount;
const targetedUndoInvalidatedFrames = 1;
assert(
  previousUndoInvalidatedFrames === 81 && targetedUndoInvalidatedFrames === 1,
  "Representative undo invalidation evidence must remain explicit: 81 cached frames before, one frame after"
);

class CutoutReleaseContractElement extends CutoutContractCanvas {
  constructor(marked = true) {
    super();
    this.attributes = new Map([
      ["data-novaflow-ai-media-panzoom", "1"],
      ["data-novaflow-ai-media-underlay-hidden", "1"]
    ]);
    if (marked) this.attributes.set(cutoutEditCanvasAttr, "1");
    this.styleValues = new Map([
      ["display", "none"],
      ["opacity", "0"],
      ["pointer-events", "none"],
      ["cursor", "default"],
      ["--novaflow-ai-media-scale", "2"]
    ]);
    this.stylePriorities = new Map([["pointer-events", "important"]]);
    this.style = {
      getPropertyValue: (name) => this.styleValues.get(name) || "",
      getPropertyPriority: (name) => this.stylePriorities.get(name) || "",
      removeProperty: (name) => {
        this.stylePriorities.delete(name);
        return this.styleValues.delete(name);
      },
      setProperty: (name, value, priority = "") => {
        this.styleValues.set(name, String(value));
        if (priority) this.stylePriorities.set(name, String(priority));
        else this.stylePriorities.delete(name);
      }
    };
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
}
const cutoutReleaseContract = getFunctionWithBindings(runtime, "releaseAiSequenceRuntimePreviewNodeToSource", {
  HTMLElement: CutoutReleaseContractElement,
  HTMLCanvasElement: CutoutReleaseContractElement,
  AI_SEQUENCE_CUTOUT_EDIT_CANVAS_ATTR: cutoutEditCanvasAttr,
  restoreAiSequenceSourcePreviewStyle: (node) => {
    node.style.setProperty("display", "block");
    node.style.setProperty("opacity", "1");
    node.style.setProperty("pointer-events", "auto");
    node.style.setProperty("cursor", "crosshair");
    return true;
  }
});
const releasedCutoutCanvas = new CutoutReleaseContractElement();
const releasedCutoutOwnership = cutoutReleaseContract?.(releasedCutoutCanvas) === true;
const releasedOrdinaryCanvas = new CutoutReleaseContractElement(false);
const releasedOrdinaryOwnership = cutoutReleaseContract?.(releasedOrdinaryCanvas) === true;
const cutoutNodeReleaseFunction = getFunctionBody("releaseAiSequenceRuntimePreviewNodeToSource");
const cutoutLiveCaptureIndex = cutoutNodeReleaseFunction.indexOf("const sourceControlledCutoutStyle");
const cutoutSourceRestoreIndex = cutoutNodeReleaseFunction.indexOf("restoreAiSequenceSourcePreviewStyle(node)");
const cutoutLiveRestoreIndex = cutoutNodeReleaseFunction.lastIndexOf("sourceControlledCutoutStyle.forEach");
assert(
  releasedCutoutOwnership &&
    releasedCutoutCanvas.styleValues.get("display") === "none" &&
    releasedCutoutCanvas.styleValues.get("opacity") === "0" &&
    releasedCutoutCanvas.styleValues.get("pointer-events") === "none" &&
    releasedCutoutCanvas.stylePriorities.get("pointer-events") === "important" &&
    releasedCutoutCanvas.styleValues.get("cursor") === "default" &&
    !releasedCutoutCanvas.hasAttribute("data-novaflow-ai-media-panzoom") &&
    !releasedCutoutCanvas.hasAttribute("data-novaflow-ai-media-underlay-hidden") &&
    releasedCutoutCanvas.hasAttribute(cutoutEditCanvasAttr) &&
    !releasedCutoutCanvas.styleValues.has("--novaflow-ai-media-scale"),
  "Cutout ownership release must preserve React's live hidden state while clearing Runtime pan/zoom state"
);
assert(
  releasedOrdinaryOwnership &&
    releasedOrdinaryCanvas.styleValues.get("display") === "block" &&
    releasedOrdinaryCanvas.styleValues.get("opacity") === "1" &&
    releasedOrdinaryCanvas.styleValues.get("pointer-events") === "auto" &&
    releasedOrdinaryCanvas.styleValues.get("cursor") === "crosshair" &&
    cutoutLiveCaptureIndex >= 0 &&
    cutoutSourceRestoreIndex > cutoutLiveCaptureIndex &&
    cutoutLiveRestoreIndex > cutoutSourceRestoreIndex,
  "Only the marked cutout canvas may restore its live React styles after Runtime ownership cleanup"
);

const clampContractNumber = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
const clampContractUnit = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const contractChroma = ({ r = 0, g = 0, b = 0 } = {}) => ({
  cb: -0.168736 * (Number(r) / 255) - 0.331264 * (Number(g) / 255) + 0.5 * (Number(b) / 255),
  cr: 0.5 * (Number(r) / 255) - 0.418688 * (Number(g) / 255) - 0.081312 * (Number(b) / 255)
});
const removedConnectedChromaPatchLabels = [
  "AI sequence connected chroma shadow matte and screen decontamination helpers",
  "AI sequence preview refines connected chroma shadows",
  "AI sequence export refines connected chroma shadows",
  "AI sequence preview decontaminates semitransparent keyed material",
  "AI sequence export decontaminates semitransparent keyed material",
  "AI sequence final cutout cache version for refined chroma matte"
];
assert(
  !aiSequenceBundle.includes("nfRefineChromaMatte=") &&
    !aiSequenceBundle.includes("nfScreenDecontam=") &&
    aiSequenceBundle.includes("let b=bt(yt(d.getImageData(0,0,r,i)),je,Ne);if(R===`ai`){") &&
    aiSequenceBundle.includes("let c=bt(yt(ae.getImageData(0,0,n,r)),I.maskThreshold,I.maskFeather);{let e=e=>{") &&
    aiSequenceBundle.includes("R===`ai`?pt(e.frame,t.finalAlpha,i,He,120):ht(e.frame,t.finalAlpha,i,He,ke,nfDespillRangeScale)") &&
    aiSequenceBundle.includes("if(I.globalDespill>0&&(ht(r.frame,e.finalAlpha,t,I.globalDespill,I.keySoft,ee===`key`?I.despillRangeScale:1),n=!0),n)") &&
    aiSequenceBundle.includes("final-cutout-cache-v5-decoded-frame-manifest") &&
    !aiSequenceBundle.includes("final-cutout-cache-v6-connected-chroma-matte") &&
    removedConnectedChromaPatchLabels.every((label) => !cutoutPatchScript.includes(label)),
  "Key cutout must remain on the v5 matte plus channel-preserving despill path after the connected-matte rollback"
);

const compactCapturedFrameMap = getAssignedArrowFunctionWithBindings(
  aiSequenceBundle,
  "nfCompactCapturedFrameMap",
  {},
  "nfCompactCapturedFrameMap="
);
const sharedFrameA = { data: new Uint8ClampedArray([1, 2, 3, 255]) };
const duplicateFrameA = { data: new Uint8ClampedArray([1, 2, 3, 255]) };
const uniqueFrameB = { data: new Uint8ClampedArray([4, 5, 6, 255]) };
const capturedFramesBeforeCompaction = new Map([
  [0, { frame: sharedFrameA, capturedHash: "hash-a", sourceFrameIndex: 0 }],
  [1, { frame: duplicateFrameA, capturedHash: "hash-a", sourceFrameIndex: 1 }],
  [2, { frame: uniqueFrameB, capturedHash: "hash-b", sourceFrameIndex: 2 }]
]);
const capturedFramesAfterCompaction = compactCapturedFrameMap?.(capturedFramesBeforeCompaction);
assert(
  compactCapturedFrameMap instanceof Function &&
    capturedFramesBeforeCompaction.size === 0 &&
    capturedFramesAfterCompaction?.size === 3 &&
    capturedFramesAfterCompaction.get(0).frame === capturedFramesAfterCompaction.get(1).frame &&
    capturedFramesAfterCompaction.get(0).frame !== capturedFramesAfterCompaction.get(2).frame &&
    capturedFramesAfterCompaction.get(1).sourceFrameIndex === 1,
  "AI cutout must share only byte-identical captured RGB storage while preserving every decoded-frame identity"
);

const alphaDecoder = getArrowFunctionAfterMarker(
  aiSequenceBundle,
  "W.current.add(-1);let a=",
  { Z: clampContractNumber }
);
const expectedBinaryAlpha = new Uint8Array([0, 1, 2, 3, 17, 31, 63, 127, 128, 192, 254, 255]);
const offsetBacking = new Uint8Array(expectedBinaryAlpha.length + 5);
offsetBacking.set(expectedBinaryAlpha, 3);
const clonedOffsetView = structuredClone(
  new Uint8Array(offsetBacking.buffer, 3, expectedBinaryAlpha.length)
);
const decodedTypedAlpha = alphaDecoder?.(clonedOffsetView, 2, 2, 3);
const decodedBufferAlpha = alphaDecoder?.(
  expectedBinaryAlpha.buffer.slice(
    expectedBinaryAlpha.byteOffset,
    expectedBinaryAlpha.byteOffset + expectedBinaryAlpha.byteLength
  ),
  2,
  2,
  3
);
const decodedLegacyAlpha = alphaDecoder?.(
  Buffer.from(expectedBinaryAlpha).toString("base64"),
  2,
  2,
  3
);
const rejectedShortAlpha = alphaDecoder?.(expectedBinaryAlpha.subarray(0, 11), 2, 2, 3);
assert(
  alphaDecoder instanceof Function &&
    decodedTypedAlpha?.ok === true &&
    decodedBufferAlpha?.ok === true &&
    decodedLegacyAlpha?.ok === true &&
    rejectedShortAlpha?.ok === false &&
    Array.from(decodedTypedAlpha.alpha).join(",") === Array.from(expectedBinaryAlpha).join(",") &&
    Array.from(decodedBufferAlpha.alpha).join(",") === Array.from(expectedBinaryAlpha).join(",") &&
    Array.from(decodedLegacyAlpha.alpha).join(",") === Array.from(expectedBinaryAlpha).join(",") &&
    aiSequenceBundle.includes("ArrayBuffer.isView(e)?new Uint8Array(e.buffer,e.byteOffset,e.byteLength)") &&
    cutoutPatchScript.includes("AI cutout alpha decoder accepts binary payload"),
  "AI cutout alpha decoding must preserve bytes across typed-array, ArrayBuffer, and legacy Base64 payloads"
);

const compactBeforeInvokeIndex = aiSequenceBundle.indexOf("A=nfCompactCapturedFrameMap(A);oe(");
const backendInvokeIndex = aiSequenceBundle.indexOf("P=await i.aiSeqRembgBatch(", compactBeforeInvokeIndex);
const releaseUploadIndex = aiSequenceBundle.indexOf("D.length=0;if(!P?.ok", backendInvokeIndex);
const binaryPayloadIndex = aiSequenceBundle.indexOf(
  "let V=I*L,re=Number(P?.alphaBytes?.byteLength)>0?P.alphaBytes:String(P?.alphaBase64||``)",
  releaseUploadIndex
);
const alphaDecodeIndex = aiSequenceBundle.indexOf("H=a(re,I,L,ee)", binaryPayloadIndex);
const retainCompactedRgbIndex = aiSequenceBundle.indexOf(
  "fe.current={jobId:o,frames:A}",
  alphaDecodeIndex
);
const imageAlphaBase64ReturnCount = (
  desktopMain.match(/alphaBase64: alphaBuf\.toString\("base64"\)/g) || []
).length;
assert(
  compactBeforeInvokeIndex >= 0 &&
    backendInvokeIndex > compactBeforeInvokeIndex &&
    releaseUploadIndex > backendInvokeIndex &&
    binaryPayloadIndex > releaseUploadIndex &&
    alphaDecodeIndex > binaryPayloadIndex &&
    retainCompactedRgbIndex > alphaDecodeIndex &&
    !aiSequenceBundle.includes("frames:nfCompactCapturedFrameMap(A)") &&
    aiSequenceBundle.includes("String(P?.alphaEncoding||``)!==`u8-mask-v1`") &&
    aiSequenceBundle.includes("Number(P?.alphaByteLength)!==V*ee") &&
    desktopMain.includes("let alphaAll = null;") &&
    desktopMain.includes("alphaAll = Buffer.allocUnsafe(alphaTotalBytes);") &&
    desktopMain.includes("aBuf2.copy(alphaAll, i * alphaFrameBytes);") &&
    desktopMain.includes('alphaEncoding: "u8-mask-v1"') &&
    desktopMain.includes("alphaBytes: new Uint8Array(alphaAll.buffer, alphaAll.byteOffset, alphaAll.byteLength)") &&
    !desktopMain.includes("const alphaChunks = []") &&
    !desktopMain.includes('alphaBase64: alphaAll.toString("base64")') &&
    imageAlphaBase64ReturnCount === 2 &&
    cutoutPatchScript.includes("AI cutout compacts captured RGB before backend invoke") &&
    cutoutPatchScript.includes("AI cutout releases renderer frame upload after backend invoke") &&
    cutoutPatchScript.includes("AI cutout video result prefers binary alpha") &&
    cutoutPatchScript.includes("AI cutout result retains pre-compacted captured RGB snapshots"),
  "AI video cutout must release duplicate RGB and uploaded PNG data before decoding one binary alpha payload"
);

const representativeAiCutoutTimelineFrames = 117;
const representativeAiCutoutUniqueFrames = 78;
const representativeAiCutoutWidth = 1080;
const representativeAiCutoutHeight = 1920;
const representativeRgbaBytes = representativeAiCutoutWidth * representativeAiCutoutHeight * 4;
const representativeAlphaBytes = representativeAiCutoutWidth * representativeAiCutoutHeight;
const representativeAlphaPayloadBytes = representativeAiCutoutTimelineFrames * representativeAlphaBytes;
const oldPreviewCacheBytes = 536870912 * 0.86;
const aiPreviewCacheBudgetBytes = 134217728;
const oldCompletionRendererBytes =
  representativeAiCutoutTimelineFrames * representativeRgbaBytes +
  representativeAlphaPayloadBytes * (4 / 3 + 1 + 1);
const binaryCompletionRendererBytes =
  representativeAiCutoutUniqueFrames * representativeRgbaBytes +
  representativeAlphaPayloadBytes;
const oldPlaybackPeakBytes =
  representativeAiCutoutTimelineFrames * representativeRgbaBytes +
  representativeAlphaPayloadBytes +
  oldPreviewCacheBytes * 2;
const boundedPlaybackPeakBytes =
  representativeAiCutoutUniqueFrames * representativeRgbaBytes +
  representativeAlphaPayloadBytes +
  aiPreviewCacheBudgetBytes;
assert(
  oldCompletionRendererBytes > 1600 * 1024 * 1024 &&
    binaryCompletionRendererBytes < 900 * 1024 * 1024 &&
    oldCompletionRendererBytes - binaryCompletionRendererBytes > 800 * 1024 * 1024 &&
    oldPlaybackPeakBytes > 1900 * 1024 * 1024 &&
    boundedPlaybackPeakBytes < 1100 * 1024 * 1024 &&
    oldPlaybackPeakBytes - boundedPlaybackPeakBytes > 900 * 1024 * 1024 &&
    aiSequenceBundle.includes("fe.current={jobId:o,frames:A}") &&
    aiSequenceBundle.includes("if(n?.previewFrame&&R!==`ai`)try{p=document.createElement(`canvas`)") &&
    aiSequenceBundle.includes("(R===`ai`?134217728:536870912*.86)/Math.max(1,c)/4") &&
    aiSequenceBundle.includes("t.drawCanvas||n.putImageData(t.imageData,0,0)") &&
    cutoutPatchScript.includes("AI cutout captured RGB snapshots share exact duplicate frames") &&
    cutoutPatchScript.includes("AI cutout playback avoids per-frame canvas duplication") &&
    cutoutPatchScript.includes("AI cutout preview cache uses bounded 128MiB budget"),
  "AI cutout result return and playback must stay below the modeled renderer crash budget"
);

const channelDespillFunction = getAssignedArrowFunctionWithBindings(aiSequenceBundle, "ht", {
  Z: clampContractNumber,
  Q: clampContractUnit,
  ut: contractChroma
}, "ht=(e,t,n,r,i,j=1)=>");
const runChannelDespillContract = (
  rgb,
  mask = 255,
  strength = 2,
  keySoft = 96,
  rangeScale,
  sourceAlpha = 255
) => {
  const imageData = { data: new Uint8ClampedArray([...rgb, sourceAlpha]) };
  channelDespillFunction?.(
    imageData,
    new Uint8Array([mask]),
    { r: 0, g: 255, b: 0 },
    strength,
    keySoft,
    rangeScale
  );
  return Array.from(imageData.data);
};
const despilledGreen = runChannelDespillContract([10, 240, 50]);
const untouchedGreen = runChannelDespillContract([10, 240, 50], 0);
const disabledDespill = runChannelDespillContract([10, 240, 50], 255, 0);
const implicitDefaultRange = runChannelDespillContract([80, 140, 160], 128, 2, 123, undefined, 127);
const explicitDefaultRange = runChannelDespillContract([80, 140, 160], 128, 2, 123, 1, 127);
const expandedRangeGreen = runChannelDespillContract([80, 140, 160], 128, 2, 123, 1.5, 127);
const weakNeutralGreenSample = [200, 210, 207];
const weakNeutralGreenDefault = runChannelDespillContract(weakNeutralGreenSample, 128, 2, 123, 1, 127);
const weakNeutralGreenExpanded = runChannelDespillContract(weakNeutralGreenSample, 128, 2, 123, 1.5, 127);
const screenshotResidualGreenSample = [149, 160, 151];
const screenshotResidualGreenDefault = runChannelDespillContract(
  screenshotResidualGreenSample,
  128,
  2,
  123,
  1,
  127
);
const screenshotResidualGreenExpanded = runChannelDespillContract(
  screenshotResidualGreenSample,
  128,
  2,
  123,
  1.5,
  127
);
const visualResidualSamples = [
  [170, 197, 200],
  [138, 165, 169],
  [134, 149, 146]
];
const visualResidualResults = visualResidualSamples.map((rgb) => ({
  rgb,
  defaultRange: runChannelDespillContract(rgb, 128, 2, 118, 1, 127),
  middleRange: runChannelDespillContract(rgb, 128, 2, 118, 1.25, 127),
  expandedRange: runChannelDespillContract(rgb, 128, 2, 118, 1.5, 127)
}));
const keyGreenChroma = contractChroma({ r: 0, g: 255, b: 0 });
const weakNeutralGreenChroma = contractChroma({
  r: weakNeutralGreenSample[0],
  g: weakNeutralGreenSample[1],
  b: weakNeutralGreenSample[2]
});
const weakNeutralGreenDistance =
  Math.hypot(
    weakNeutralGreenChroma.cb - keyGreenChroma.cb,
    weakNeutralGreenChroma.cr - keyGreenChroma.cr
  ) * 512;
const despillBaseRadius = 123 * 2;
const despillExtendedRadius = despillBaseRadius * 1.5;
const greenAxisResidual = (rgba) => rgba[1] - (rgba[0] + rgba[2]) / 2;
const rgbL1Distance = (left, right) =>
  Math.abs(left[0] - right[0]) +
  Math.abs(left[1] - right[1]) +
  Math.abs(left[2] - right[2]);
const visualResidualRangeIsEffective = visualResidualResults.every(
  ({ defaultRange, middleRange, expandedRange }) => {
    const defaultResidual = greenAxisResidual(defaultRange);
    const middleResidual = greenAxisResidual(middleRange);
    const expandedResidual = greenAxisResidual(expandedRange);
    return (
      defaultResidual >= 6 &&
      middleResidual < defaultResidual &&
      expandedResidual <= middleResidual &&
      expandedResidual <= 3 &&
      defaultResidual - expandedResidual >= Math.max(4, defaultResidual * 0.7) &&
      expandedRange[2] - expandedRange[1] >= defaultRange[2] - defaultRange[1] + 8 &&
      rgbL1Distance(defaultRange, expandedRange) >= 10 &&
      defaultRange[3] === expandedRange[3]
    );
  }
);
const protectedCyanDefault = runChannelDespillContract([120, 150, 190], 128, 2, 123, 1, 127);
const protectedCyanExpanded = runChannelDespillContract([120, 150, 190], 128, 2, 123, 1.5, 127);
const protectedSamples = [
  [157, 177, 187],
  [152, 173, 184],
  [145, 149, 132],
  [220, 160, 140],
  [160, 110, 190],
  [150, 150, 150],
  [180, 150, 50],
  [180, 180, 50],
  [181, 180, 50],
  [180, 181, 50]
];
const protectedSamplesStable = protectedSamples.every((rgb) => {
  const defaultRange = runChannelDespillContract(rgb, 128, 2, 118, 1, 127);
  const expandedRange = runChannelDespillContract(rgb, 128, 2, 118, 1.5, 127);
  return (
    defaultRange.slice(0, 3).every((channel, index) =>
      Math.abs(channel - expandedRange[index]) <= 2
    ) && defaultRange[3] === expandedRange[3]
  );
});
const defaultCompatibilitySamples = [
  [80, 140, 160],
  ...visualResidualSamples,
  ...protectedSamples
];
const defaultRangeIsByteCompatible = defaultCompatibilitySamples.every((rgb) =>
  [0, 1, 64, 128, 255].every((mask) =>
    [0, 127, 255].every((sourceAlpha) =>
      runChannelDespillContract(rgb, mask, 2, 118, undefined, sourceAlpha).join(",") ===
      runChannelDespillContract(rgb, mask, 2, 118, 1, sourceAlpha).join(",")
    )
  )
);
const sourceAlphaIsInvariant = [0, 1, 64, 127, 128, 254, 255].every((sourceAlpha) =>
  [0, 64, 128, 255].every((mask) =>
    [1, 1.25, 1.5].every((rangeScale) =>
      runChannelDespillContract(
        [170, 197, 200],
        mask,
        2,
        118,
        rangeScale,
        sourceAlpha
      )[3] === sourceAlpha
    )
  )
);
const despillRangePresetCount = (
  aiSequenceBundle.match(/globalDespill:[^},]+,despillRangeScale:1/g) || []
).length;
const despillRangeDependencyCount = (
  aiSequenceBundle.match(/He,nfDespillRangeScale/g) || []
).length;
const resolveContractExportDespillRange = (boardState, liveRange) =>
  Math.max(1, Math.min(1.5, Number(boardState ? (boardState.despillRangeScale ?? 1) : liveRange) || 1));
const contractBoardStateKey = (fileName, source, isImage) =>
  isImage
    ? `${String(fileName || "")}::::${String(source || "").length}`
    : `${String(fileName || "")}::${String(source || "")}::`;
const contractResolveExportBoardState = (stateMap, activeKey, legacyKey, canonicalKey) => {
  const candidate =
    canonicalKey === activeKey ? null : stateMap.get(legacyKey) || stateMap.get(canonicalKey) || null;
  return candidate?.matteMode === "key" ? candidate : null;
};
const contractVideoBoardKey = contractBoardStateKey("clip.webm", "blob:nf-video", false);
const contractImageBoardKey = contractBoardStateKey("still.png", "data:image/png;base64,AAAA", true);
const contractAiVideoBoardKey = contractBoardStateKey("ai.webm", "blob:nf-ai-video", false);
const contractBoardStates = new Map([
  [contractVideoBoardKey, { matteMode: "key", despillRangeScale: 1.35 }],
  [contractImageBoardKey, { matteMode: "key", despillRangeScale: 1.2 }],
  [contractAiVideoBoardKey, { matteMode: "ai", despillRangeScale: 1, aiMasks: [1] }]
]);
const activeVideoBoardState = contractResolveExportBoardState(
  contractBoardStates,
  contractVideoBoardKey,
  "clip.webm::blob:nf-video::1000",
  contractVideoBoardKey
);
const inactiveVideoBoardState = contractResolveExportBoardState(
  contractBoardStates,
  "other.webm::blob:other::",
  "clip.webm::blob:nf-video::1000",
  contractVideoBoardKey
);
const inactiveImageBoardState = contractResolveExportBoardState(
  contractBoardStates,
  "other.png::::12",
  "still.png::data:image/png;base64,AAAA::10",
  contractImageBoardKey
);
const inactiveAiBoardState = contractResolveExportBoardState(
  contractBoardStates,
  "other.webm::blob:other::",
  "ai.webm::blob:nf-ai-video::1000",
  contractAiVideoBoardKey
);
const despillRangeKeyModeWrapper =
  "R===`key`&&(0,X.jsxs)(`div`,{\"data-novaflow-ai-despill-range\":`1`";
const legacyManualCacheKey = ",ie,ut,Fn,ye,s,De,ke,je,Ne,Y,Be,Ie,Re,He].join(`|`)";
const frameScopedCacheKey = ",ie,Fn,ye,s,De,ke,je,Ne,Y,Be,Ie,Re,He].join(`|`)";
const despillRangeCacheKey =
  ",ie,Fn,ye,s,De,ke,je,Ne,Y,Be,Ie,Re,He,nfDespillRangeScale].join(`|`)";
const despillCacheMigrationIsReplayable =
  cutoutPatchScript.includes(`replaceLegacyExact(\n  "AI sequence cutout cache key keeps manual edits frame scoped",\n  "${legacyManualCacheKey}",\n  "${frameScopedCacheKey}"\n);`) &&
  cutoutPatchScript.includes(`replaceExact(\n  "AI sequence despill range cache identity",\n  "${frameScopedCacheKey}",\n  "${despillRangeCacheKey}"\n);`);
assert(
  channelDespillFunction instanceof Function &&
    cutoutHeadReplayVerified &&
    despilledGreen.join(",") === "20,60,100,255" &&
    untouchedGreen.join(",") === "10,240,50,255" &&
    disabledDespill.join(",") === "10,240,50,255" &&
    implicitDefaultRange.join(",") === explicitDefaultRange.join(",") &&
    explicitDefaultRange.join(",") === "80,140,160,127" &&
    expandedRangeGreen[1] < explicitDefaultRange[1] &&
    expandedRangeGreen[2] > expandedRangeGreen[1] &&
    expandedRangeGreen[3] === 127 &&
    weakNeutralGreenDistance > despillBaseRadius &&
    weakNeutralGreenDistance < despillExtendedRadius &&
    greenAxisResidual(weakNeutralGreenExpanded) < greenAxisResidual(weakNeutralGreenDefault) &&
    weakNeutralGreenExpanded[3] === 127 &&
    greenAxisResidual(screenshotResidualGreenExpanded) < greenAxisResidual(screenshotResidualGreenDefault) &&
    screenshotResidualGreenExpanded[3] === 127 &&
    visualResidualRangeIsEffective &&
    protectedCyanDefault.join(",") === protectedCyanExpanded.join(",") &&
    protectedSamplesStable &&
    defaultRangeIsByteCompatible &&
    sourceAlphaIsInvariant &&
    despillCacheMigrationIsReplayable &&
    despillRangePresetCount === 3 &&
    despillRangeDependencyCount === 4 &&
    resolveContractExportDespillRange({}, 1.5) === 1 &&
    resolveContractExportDespillRange({ despillRangeScale: 1.25 }, 1.5) === 1.25 &&
    resolveContractExportDespillRange(null, 1.5) === 1.5 &&
    contractVideoBoardKey === "clip.webm::blob:nf-video::" &&
    contractImageBoardKey === `still.png::::${"data:image/png;base64,AAAA".length}` &&
    activeVideoBoardState === null &&
    inactiveVideoBoardState?.despillRangeScale === 1.35 &&
    inactiveImageBoardState?.despillRangeScale === 1.2 &&
    inactiveAiBoardState === null &&
    (aiSequenceBundle.match(/data-novaflow-ai-despill-range/g) || []).length === 1 &&
    aiSequenceBundle.includes(despillRangeKeyModeWrapper) &&
    aiSequenceBundle.includes("[nfDespillRangeScale,nfSetDespillRangeScale]=(0,_.useState)(()=>ge.green.despillRangeScale)") &&
    aiSequenceBundle.includes("globalDespill:He,despillRangeScale:nfDespillRangeScale,tool:Ge") &&
    aiSequenceBundle.includes("Number(t.despillRangeScale)||1") &&
    aiSequenceBundle.includes("He,nfDespillRangeScale].join(`|`)") &&
    aiSequenceBundle.includes("despillRangeScale:Math.max(1,Math.min(1.5,Number(F?(F.despillRangeScale??1):nfDespillRangeScale)||1))") &&
    cutoutPatchScript.includes("AI sequence old boards export at the compatible despill range") &&
    cutoutPatchScript.includes("AI sequence export resolves inactive board state identity") &&
    cutoutPatchScript.includes("AI sequence export state fallback stays on keyed boards") &&
    aiSequenceBundle.includes("nfBoardStateKey=p?`${String(s||``)}::::${String(e?.currentSrc||e.src||``).length}`:`${String(s||``)}::${String(e?.currentSrc||e.src||``)}::`") &&
    aiSequenceBundle.includes("nfBoardState=nfBoardStateKey===yr?null:Zt.current.get(N)||Zt.current.get(nfBoardStateKey)") &&
    aiSequenceBundle.includes("F=nfBoardState?.matteMode===`key`?nfBoardState:null") &&
    aiSequenceBundle.includes("children:`半径`}),(0,X.jsx)(`input`,{type:`range`,min:1,max:20,step:1,value:Re") &&
    !aiSequenceBundle.includes("children:`精修半径`") &&
    aiSequenceBundle.includes("\"data-novaflow-ai-despill-range\":`1`") &&
    aiSequenceBundle.includes("children:`范围`}),(0,X.jsx)(`input`,{type:`range`,min:100,max:150,step:5,value:Math.round(100*nfDespillRangeScale)") &&
    !aiSequenceBundle.includes("children:`抑色范围`") &&
    aiSequenceBundle.includes("type:`range`,min:100,max:150,step:5,value:Math.round(100*nfDespillRangeScale)") &&
    cutoutPatchScript.includes("AI sequence independent despill range setup") &&
    cutoutPatchScript.includes("AI sequence independent despill range match") &&
    cutoutPatchScript.includes("AI sequence despill range removes base-radius seam") &&
    cutoutPatchScript.includes("AI sequence despill range protects warm keyed materials") &&
    cutoutPatchScript.includes("AI sequence despill range reaches low-saturation keyed residue") &&
    cutoutPatchScript.includes("AI sequence despill range uses the relative expansion band for green residue") &&
    cutoutPatchScript.includes("AI sequence edge refine radius uses the compact label") &&
    cutoutPatchScript.includes("AI sequence despill range uses the compact label") &&
    cutoutPatchScript.includes("AI sequence despill range controls") &&
    cutoutPatchScript.includes("AI sequence channel-preserving despill restoration") &&
    aiSequenceBundle.includes("if(u===0){let e=(s+c)/2") &&
    aiSequenceBundle.includes("else if(u===1){let e=(i+c)/2") &&
    aiSequenceBundle.includes("else if(u===2){let e=(i+s)/2") &&
    aiSequenceBundle.includes("let C=.2126*i+.7152*s+.0722*c;if(C>.001)") &&
    aiSequenceBundle.includes("if(u===1){let nfRangeGuard=Q((c-i+4)/4),nfRangeTone=Q((e-t-4)/6)") &&
    aiSequenceBundle.includes("nfRangeTone*=nfRangeTone*(3-2*nfRangeTone)") &&
    aiSequenceBundle.includes("nfRangeMatch=nfRangeProgress*nfRangeGuard*nfRangeTone*Q(1-Math.max(0,h-o)/Math.max(1e-6,nfExtendedRadius-o))") &&
    aiSequenceBundle.includes("else{let nfRangeGuard=u===0?i>=c?1:0:c>=s?1:0") &&
    !aiSequenceBundle.includes("nfRangeProgress>0&&u>=0&&h>=o&&h<nfExtendedRadius") &&
    !aiSequenceBundle.includes("i=i*(1-x)+S*x,s=s*(1-x)+S*x,c=c*(1-x)+S*x"),
  `Despill range must preserve 100% and alpha while strongly removing only keyed green-axis residue: default=${explicitDefaultRange.join(",")} expanded=${expandedRangeGreen.join(",")} weakDefault=${weakNeutralGreenDefault.join(",")} weakExpanded=${weakNeutralGreenExpanded.join(",")} screenshotDefault=${screenshotResidualGreenDefault.join(",")} screenshotExpanded=${screenshotResidualGreenExpanded.join(",")} visual=${JSON.stringify(visualResidualResults)} visualEffective=${visualResidualRangeIsEffective} cyanDefault=${protectedCyanDefault.join(",")} cyanExpanded=${protectedCyanExpanded.join(",")} protectedStable=${protectedSamplesStable} defaultCompatible=${defaultRangeIsByteCompatible} alphaInvariant=${sourceAlphaIsInvariant} replay=${despillCacheMigrationIsReplayable} headReplay=${cutoutHeadReplayVerified} presets=${despillRangePresetCount} deps=${despillRangeDependencyCount}`
);

const playbackCanvasOldLayout = "return{...Kt,display:e}},[F,P,D?.objectUrl,te])";
const playbackCanvasIntermediateLayout = "return{...Gt,...se,display:e}},[F,P,D?.objectUrl,te,se])";
const playbackCanvasStableLayout = "return{...Gt,...se,display:e,position:`absolute`,zIndex:2}},[F,P,D?.objectUrl,te,se])";
const playbackVideoStableLayout = "return{...Gt,...se,opacity:e}},[te,D?.objectUrl,F,P,se])";
const playbackHiddenVideoOldLayout = "return{...Gt,...se,opacity:e,position:e===0?`absolute`:`relative`}},[te,D?.objectUrl,F,P,se])";
const playbackCanvasPrePaintLayout = "(0,_.useLayoutEffect)(()=>{if(!(F&&P&&D?.objectUrl&&!te)){q.current=-1";
const playbackCanvasSourceBoxSync = "t.style.left=`${e.offsetLeft}px`,t.style.top=`${e.offsetTop}px`,t.style.width=`${Math.max(1,e.offsetWidth)}px`,t.style.height=`${Math.max(1,e.offsetHeight)}px`";
const playbackCanvasRenderBitmapSize = "(0,X.jsx)(`canvas`,{ref:ae,width:Math.max(1,Math.round(y*Math.max(1,window.devicePixelRatio||1))),height:Math.max(1,Math.round(b*Math.max(1,window.devicePixelRatio||1))),style:le})";
assert(
  aiSequenceBundle.includes(playbackCanvasStableLayout) &&
    aiSequenceBundle.includes(playbackVideoStableLayout) &&
    aiSequenceBundle.includes(playbackCanvasPrePaintLayout) &&
    aiSequenceBundle.includes(playbackCanvasSourceBoxSync) &&
    aiSequenceBundle.includes(playbackCanvasRenderBitmapSize) &&
    !aiSequenceBundle.includes(playbackCanvasOldLayout) &&
    !aiSequenceBundle.includes(playbackCanvasIntermediateLayout) &&
    !aiSequenceBundle.includes(playbackHiddenVideoOldLayout),
  "Playback canvas must be sized and drawn before paint while overlaying the source video's stable fitted box"
);

const normalizeUploadFunction = getFunctionBody("normalizeNovaflowUploadDropzones");
assert(
  normalizeUploadFunction.includes("isInsideSourceOwnedLayout(dropzone)") &&
    normalizeUploadFunction.includes("ensureAiSequenceUploadClickProxy(dropzone);"),
  "Source-owned upload normalization must mount native upload proxies before returning"
);

const dispatchStartupReadyFunction = getFunctionBody("dispatchStartupAppReady");
assert(
  dispatchStartupReadyFunction.includes("window.clearInterval(STARTUP_LAYOUT_REFRESH_TIMER)") &&
    dispatchStartupReadyFunction.includes("STARTUP_LAYOUT_REFRESH_TIMER = null"),
  "Startup ready dispatch must stop the startup layout refresh interval immediately"
);

const startupLoopFunction = getFunctionBody("startStartupLayoutRefreshLoop");
assert(
  startupLoopFunction.indexOf('checkStartupAppReady({ source: "startupLayoutRefreshLoop:pre" })') >= 0 &&
    startupLoopFunction.indexOf("runFullLayoutRefresh()") >
      startupLoopFunction.indexOf('checkStartupAppReady({ source: "startupLayoutRefreshLoop:pre" })'),
  "Startup layout refresh loop must check readiness before running a full layout refresh"
);

const modeLocalMutationFunction = getFunctionBody("isAiAnimationModeSectionLocalMutation");
assert(
  modeLocalMutationFunction.includes('[data-novaflow-ai-mode-section="1"]') &&
    modeLocalMutationFunction.includes("[data-novaflow-ai-resource-card='1']"),
  "AI mode section local mutations must be classified separately from full layout mutations"
);

const structuralMutationFunction = getFunctionBody("isAiAnimationStructuralMutation");
assert(
  structuralMutationFunction.includes("isAiAnimationModeSectionLocalMutation(mutation)") &&
    structuralMutationFunction.indexOf("isAiAnimationModeSectionLocalMutation(mutation)") <
      structuralMutationFunction.indexOf("isAiSequenceUploadChromeMutation(mutation)"),
  "AI mode section local mutations must be excluded before structural full-refresh classification"
);

const lightMutationFunction = getFunctionBody("isAiAnimationLightMutation");
assert(
  lightMutationFunction.includes("isAiAnimationModeSectionLocalMutation(mutation)"),
  "AI mode section local mutations must be treated as light mutations"
);

const urgentMutationFunction = getFunctionBody("isAiAnimationUrgentFullSyncMutation");
assert(
  urgentMutationFunction.includes("if (isAiSequenceUploadMutation(mutation)) return false;"),
  "AI upload mutations must be classified by the normal mutation pipeline instead of urgent full-sync"
);

const deferredToolBeginFunction = getFunctionBody("deferAiSequenceStatefulToolBegin");
const resourceToolBeginFunction = getFunctionBody("beginAiSequenceStatefulToolFromResourceAction");
const toolButtonFunction = getFunctionBody("bindAiSequenceToolButtons");
const toolGuardFunction = getFunctionBody("ensureAiSequenceStateDomGuards");
assert(
  deferredToolBeginFunction.includes('return "passthrough"') &&
    !deferredToolBeginFunction.includes("return true") &&
    resourceToolBeginFunction.includes("return deferAiSequenceStatefulToolBegin(action, tool") &&
    !resourceToolBeginFunction.includes("controller.beginTool(") &&
    !resourceToolBeginFunction.includes("ensureAiSequenceEditingSessionForSave") &&
    !resourceToolBeginFunction.includes("primeAiSequenceStatefulToolEditingFirstFrame") &&
    !resourceToolBeginFunction.includes("refreshAiSequenceToolStateLayout") &&
    toolButtonFunction.split('if (beginResult === "passthrough")').length - 1 >= 2 &&
    toolGuardFunction.split('if (beginResult === "passthrough")').length - 1 >= 2,
  "Native AI/chroma cutout clicks must pass through to React instead of being capture-preempted with stopImmediatePropagation"
);

const toolDetailFunction = getFunctionBody("applyAiSequenceToolDetailState");
assert(
  !/if\s*\(editing\)\s*ensureAiSequenceEditPanel\(postSection, session\);/.test(toolDetailFunction),
  "Editing state must not unconditionally replace the native tool detail with the one-slider Runtime fallback"
);

assert(
  !runtime.includes("resolvePrimaryAnimationPreIntentAction") &&
    !runtime.includes("primary-pre-intent") &&
    !runtime.includes("ART_TO_ANIMATION_PRIMARY_HANDOFF") &&
    !runtime.includes("ArtToAnimationPrimaryHandoff"),
  "Primary Animation entry must remove the Art-only handoff and every pre-intent shell publication path"
);

const beginPrimaryAnimationTransactionFunction = getFunctionBody("beginPrimaryAnimationEntryTransaction");
assert(
  beginPrimaryAnimationTransactionFunction.includes("PRIMARY_ANIMATION_ENTRY_TRANSACTION.begin") &&
    beginPrimaryAnimationTransactionFunction.includes("sourceIndex") &&
    beginPrimaryAnimationTransactionFunction.includes("targetIndex: 1") &&
    !beginPrimaryAnimationTransactionFunction.includes("cancelStaleBrandMutationFlushForPrimarySwitch") &&
    beginPrimaryAnimationTransactionFunction.includes('setPrimaryActivationLock("\\u52a8\\u753b")') &&
    beginPrimaryAnimationTransactionFunction.includes("setAiAnimationFallbackPreviewVars()") &&
    !beginPrimaryAnimationTransactionFunction.includes("commitPrimaryAnimationEntryState") &&
    !beginPrimaryAnimationTransactionFunction.includes("syncPrimarySwitchTarget") &&
    !beginPrimaryAnimationTransactionFunction.includes("body.classList"),
  "Every non-Animation source must begin one intent-only transaction without pre-capture source cleanup or publishing body classes and layout"
);

const sourceOwnedReferenceMetricsFunction = getFunctionBody("getAiAnimationSourceOwnedReferenceMetrics");
assert(
  !sourceOwnedReferenceMetricsFunction.includes("measureAiAnimationReferenceColumnWidth") &&
    sourceOwnedReferenceMetricsFunction.includes("const naturalWidth = fallbackWidth") &&
    sourceOwnedReferenceMetricsFunction.includes("options?.mainWidth") &&
    sourceOwnedReferenceMetricsFunction.includes("mainRow.getBoundingClientRect().width") &&
    sourceOwnedReferenceMetricsFunction.includes("maxReferenceWidth < naturalWidth"),
  "Source-owned reference metrics must preserve responsive main-row clamping without repeating dropzone geometry reads that cannot change the capped slot result"
);

class SourceOwnedReferenceMetricsTestElement {
  constructor(width = 0) {
    this.width = width;
    this.parentElement = null;
    this.rectReadCount = 0;
  }

  getBoundingClientRect() {
    this.rectReadCount += 1;
    return { width: this.width };
  }
}

const calculateSourceOwnedReferenceMetrics = Function(
  "HTMLElement",
  "AI_ANIMATION_SOURCE_OWNED_DENSE_REFERENCE_MIN_SLOT",
  "AI_ANIMATION_SOURCE_OWNED_REFERENCE_MIN_SLOT",
  "AI_ANIMATION_REFERENCE_UPLOAD_GAP",
  "AI_ANIMATION_REFERENCE_UPLOAD_WIDTH",
  "AI_ANIMATION_SOURCE_OWNED_SETTINGS_MIN_WIDTH",
  "NOVAFLOW_UNIFORM_GAP",
  `"use strict"; return (${sourceOwnedReferenceMetricsFunction});`
)(SourceOwnedReferenceMetricsTestElement, 56, 84, 10, 132, 260, 5);

function sourceOwnedReferenceMetricsCase(count, mainWidth) {
  const mainRow = new SourceOwnedReferenceMetricsTestElement(mainWidth);
  const referenceColumn = new SourceOwnedReferenceMetricsTestElement();
  referenceColumn.parentElement = mainRow;
  const fallbackWidth = count * 132 + Math.max(0, count - 1) * 10;
  return calculateSourceOwnedReferenceMetrics(referenceColumn, [], fallbackWidth, count);
}

function sourceOwnedReferenceMetricsWithMeasuredMainWidth(count, mainWidth) {
  const mainRow = new SourceOwnedReferenceMetricsTestElement(mainWidth);
  const referenceColumn = new SourceOwnedReferenceMetricsTestElement();
  referenceColumn.parentElement = mainRow;
  const fallbackWidth = count * 132 + Math.max(0, count - 1) * 10;
  const metrics = calculateSourceOwnedReferenceMetrics(referenceColumn, [], fallbackWidth, count, { mainWidth });
  return { metrics, rectReadCount: mainRow.rectReadCount };
}

function legacySourceOwnedReferenceMetricsCase(count, mainWidth, measuredWidth) {
  const denseSlotLayout = count > 4;
  const minSlotWidth = denseSlotLayout ? 56 : 84;
  const fallbackWidth = count * 132 + Math.max(0, count - 1) * 10;
  const naturalWidth = Math.max(fallbackWidth, measuredWidth);
  const naturalSlotWidth = Math.max(
    minSlotWidth,
    Math.round((naturalWidth - Math.max(0, count - 1) * 10) / Math.max(1, count))
  );
  let slotWidth = Math.min(132, naturalSlotWidth);
  let slotHeight = slotWidth;
  const roundedMainWidth = Math.round(mainWidth || 0);
  const maxReferenceWidth = Math.max(0, roundedMainWidth - 5 - 260);
  if (roundedMainWidth > 0 && maxReferenceWidth > 0 && maxReferenceWidth < naturalWidth) {
    const availableSlot = Math.floor(
      (maxReferenceWidth - Math.max(0, count - 1) * 10) / Math.max(1, count)
    );
    slotWidth = Math.max(minSlotWidth, Math.min(slotWidth, availableSlot));
  }
  if (denseSlotLayout && roundedMainWidth > 0 && maxReferenceWidth > 0) {
    const heightSlotCount = Math.max(1, Math.min(4, count));
    const denseReferenceSlotHeight = Math.floor(
      (maxReferenceWidth - Math.max(0, heightSlotCount - 1) * 10) / heightSlotCount
    );
    slotHeight = Math.max(84, Math.min(132, denseReferenceSlotHeight));
  }
  if (!denseSlotLayout) {
    slotHeight = slotWidth;
  } else {
    slotHeight = Math.max(slotHeight, slotWidth);
  }
  const width = slotWidth * count + Math.max(0, count - 1) * 10;
  return {
    width: `${width}px`,
    offset: `${width + 10}px`,
    height: `${slotHeight}px`,
    slotSize: `${slotWidth}px`
  };
}

[1, 2, 5, 6].forEach((count) => {
  const fallbackWidth = count * 132 + Math.max(0, count - 1) * 10;
  [0, 300, 420, 633, 761, 965, 1107, 1400].forEach((mainWidth) => {
    [fallbackWidth, fallbackWidth + 1, fallbackWidth + 500].forEach((measuredWidth) => {
      assert(
        JSON.stringify(sourceOwnedReferenceMetricsCase(count, mainWidth)) ===
          JSON.stringify(legacySourceOwnedReferenceMetricsCase(count, mainWidth, measuredWidth)),
        `Source-owned ${count}-slot metrics at main width ${mainWidth} must match the legacy measured-width formula for measured width ${measuredWidth}`
      );
    });
  });
});

assert(
  JSON.stringify(sourceOwnedReferenceMetricsCase(1, 761)) === JSON.stringify({ width: "132px", offset: "142px", height: "132px", slotSize: "132px" }) &&
    JSON.stringify(sourceOwnedReferenceMetricsCase(2, 761)) === JSON.stringify({ width: "274px", offset: "284px", height: "132px", slotSize: "132px" }) &&
    JSON.stringify(sourceOwnedReferenceMetricsCase(5, 761)) === JSON.stringify({ width: "495px", offset: "505px", height: "116px", slotSize: "91px" }) &&
    JSON.stringify(sourceOwnedReferenceMetricsCase(6, 761)) === JSON.stringify({ width: "494px", offset: "504px", height: "116px", slotSize: "74px" }) &&
    JSON.stringify(sourceOwnedReferenceMetricsCase(5, 633)) === JSON.stringify({ width: "365px", offset: "375px", height: "84px", slotSize: "65px" }) &&
    JSON.stringify(sourceOwnedReferenceMetricsCase(6, 633)) === JSON.stringify({ width: "386px", offset: "396px", height: "84px", slotSize: "56px" }),
  "Source-owned reference metrics must preserve exact 1/2/5/6-slot geometry across wide and narrow main rows"
);

const measuredMainWidthMetrics = sourceOwnedReferenceMetricsWithMeasuredMainWidth(6, 761);
assert(
  measuredMainWidthMetrics.rectReadCount === 0 &&
    JSON.stringify(measuredMainWidthMetrics.metrics) === JSON.stringify(sourceOwnedReferenceMetricsCase(6, 761)),
  "Source-owned normalization must reuse the main-row width read immediately before its reference metrics without a duplicate layout read"
);

const bottomReferenceLayoutMetricsFunction = getFunctionBody("getAiAnimationBottomReferenceLayoutMetrics");
const normalizeReferenceColumnPositionFunction = getFunctionBody("normalizeAiAnimationReferenceColumnPosition");
assert(
  bottomReferenceLayoutMetricsFunction.includes("options = null") &&
    bottomReferenceLayoutMetricsFunction.includes("sourceOwnedFallbackWidth, sourceOwnedCount, options") &&
    normalizeReferenceColumnPositionFunction.includes("getAiAnimationBottomReferenceLayoutMetrics(referenceColumn, {") &&
    normalizeReferenceColumnPositionFunction.includes("mainWidth: mainRect.width"),
  "Reference-column normalization must thread its existing main-row rect width into source-owned metrics"
);

const bottomPromptTextareasFunction = getFunctionBody("styleAiAnimationBottomPromptTextareas");
const promptAncestorsFunction = getFunctionBody("styleAiAnimationPromptAncestors");
const sourceOwnedPromptBranchIndex = promptAncestorsFunction.indexOf("if (sourceOwnedBottomWorkspace)");
const promptReferenceMetricsIndex = promptAncestorsFunction.indexOf("getAiAnimationBottomReferenceLayoutMetrics(referenceColumn)");
const sourceOwnedPromptBranch = sourceOwnedPromptBranchIndex >= 0 && promptReferenceMetricsIndex > sourceOwnedPromptBranchIndex
  ? promptAncestorsFunction.slice(sourceOwnedPromptBranchIndex, promptReferenceMetricsIndex)
  : "";
const promptReferenceMetricsCallCount = (promptAncestorsFunction.match(/getAiAnimationBottomReferenceLayoutMetrics\(referenceColumn\)/g) || []).length;
assert(
  bottomPromptTextareasFunction.includes("const styledPromptGrids = sourceOwnedBottomWorkspace ? new Set() : null") &&
    bottomPromptTextareasFunction.includes("styleAiAnimationPromptAncestors(frame, bottomWorkspace, styledPromptGrids)") &&
    promptAncestorsFunction.includes("styledPromptGrids.has(promptGrid)") &&
    promptAncestorsFunction.includes("styledPromptGrids.add(promptGrid)") &&
    promptAncestorsFunction.indexOf("styledPromptGrids.has(promptGrid)") <
      promptAncestorsFunction.indexOf("styledPromptGrids.add(promptGrid)") &&
    promptAncestorsFunction.indexOf("styledPromptGrids.add(promptGrid)") <
      promptAncestorsFunction.indexOf("const sourceOwnedBottomWorkspace = isSourceOwnedLayout(bottomWorkspace)"),
  "Bottom prompt styling must apply shared prompt-grid and settings-column work once per synchronous final-layout pass"
);
assert(
  promptAncestorsFunction.includes("const sourceOwnedBottomWorkspace = isSourceOwnedLayout(bottomWorkspace)") &&
    promptAncestorsFunction.includes('setAttributeIfChanged(mainRow, "data-novaflow-ai-bottom-main-row", "1")') &&
    promptAncestorsFunction.includes('setAttributeIfChanged(child, "data-novaflow-ai-reference-column", "1")') &&
    sourceOwnedPromptBranch.includes("return;") &&
    promptReferenceMetricsCallCount === 1,
  "Source-owned prompt preparation must keep structural markers but defer the only authoritative reference geometry read to the immediately following bottom-layout sync"
);

const ensureBottomWorkspaceFunction = getFunctionBody("ensureAiAnimationBottomWorkspaceFromPreviewRoot");
const uploadBottomReferenceFunction = getFunctionBody("syncAiSequenceUploadBottomReferenceState");
assert(
  ensureBottomWorkspaceFunction.includes("syncSourceOwnedLayout") &&
    ensureBottomWorkspaceFunction.includes("if (syncSourceOwnedLayout)") &&
    uploadBottomReferenceFunction.includes("syncSourceOwnedLayout: false") &&
    uploadBottomReferenceFunction.indexOf("syncSourceOwnedLayout: false") <
      uploadBottomReferenceFunction.indexOf("normalizeNovaflowUploadDropzones") &&
    uploadBottomReferenceFunction.indexOf("normalizeNovaflowUploadDropzones") <
      uploadBottomReferenceFunction.indexOf("syncAiAnimationSourceOwnedBottomWorkspaceFinalLayout"),
  "Upload bottom-state sync must locate the source workspace without a redundant pre-normalization final layout, then keep the authoritative post-normalization final layout"
);

const secondaryPreLayoutFunction = getFunctionBody("applyAiSequenceSecondarySwitchPreLayout");
assert(
  secondaryPreLayoutFunction.includes("const markedBottomWorkspace = markAiAnimationWorkspaceLayout()") &&
    secondaryPreLayoutFunction.includes("if (!(markedBottomWorkspace instanceof HTMLElement) || !isSourceOwnedLayout(markedBottomWorkspace))") &&
    secondaryPreLayoutFunction.indexOf("markAiAnimationWorkspaceLayout()") <
      secondaryPreLayoutFunction.indexOf("ensureAiAnimationBottomWorkspaceFromPreviewRoot()"),
  "AI sequence pre-layout must reuse only a source-owned bottom workspace already finalized by workspace marking"
);

const primaryAnimationTransactionCommitFunction = getFunctionBody("tryCommitPrimaryAnimationEntryTransaction");
const primaryAnimationGeometryGateFunction = getFunctionBody("schedulePrimaryAnimationEntryGeometryStabilityCheck");
const primaryAnimationMountedCommitIndex = primaryAnimationTransactionCommitFunction.indexOf("commitPrimaryAnimationEntryMountedState");
const primaryAnimationTransactionSnapshotIndex = primaryAnimationTransactionCommitFunction.indexOf("PRIMARY_ANIMATION_ENTRY_TRANSACTION.snapshot()");
const primaryAnimationTransactionClaimIndex = primaryAnimationTransactionCommitFunction.indexOf("PRIMARY_ANIMATION_ENTRY_TRANSACTION.claimCommit");
const primaryAnimationArtCleanupIndex = primaryAnimationTransactionCommitFunction.indexOf(
  "deactivateArtGenerateForRouteChange({ schedulePreviewRefresh: false })"
);
const primaryAnimationGeometryGateIndex = primaryAnimationTransactionCommitFunction.indexOf("schedulePrimaryAnimationEntryGeometryStabilityCheck");
const primaryAnimationGeometryGateCallCount = (primaryAnimationTransactionCommitFunction.match(/schedulePrimaryAnimationEntryGeometryStabilityCheck/g) || []).length;
const primaryAnimationTransactionCompleteIndex = primaryAnimationGeometryGateFunction.indexOf("PRIMARY_ANIMATION_ENTRY_TRANSACTION.complete");
const primaryAnimationCommittedSerialIndex = primaryAnimationGeometryGateFunction.indexOf("PRIMARY_ANIMATION_ENTRY_LAST_COMMITTED_SERIAL = serial");
const primaryAnimationPreviewMountedReleaseIndex = primaryAnimationGeometryGateFunction.indexOf('releasePrimaryAnimationEntryPreviewAfterPaint("mounted")');
const primaryAnimationMountedReleaseCount = (primaryAnimationGeometryGateFunction.match(/releasePrimaryAnimationEntryPreviewAfterPaint\("mounted"\)/g) || []).length;
assert(
  primaryAnimationTransactionCommitFunction.includes("NovaFlowClientAuth?.ensureMounted?.()") &&
    primaryAnimationTransactionCommitFunction.indexOf("NovaFlowClientAuth?.ensureMounted?.()") <
      primaryAnimationTransactionCommitFunction.indexOf("getPrimaryAnimationReactMountSnapshot") &&
    primaryAnimationTransactionCommitFunction.indexOf("getPrimaryAnimationReactMountSnapshot") >= 0 &&
    primaryAnimationTransactionCommitFunction.indexOf("isPrimaryAnimationReactMountReady") >
      primaryAnimationTransactionCommitFunction.indexOf("getPrimaryAnimationReactMountSnapshot") &&
    primaryAnimationTransactionClaimIndex >
      primaryAnimationTransactionCommitFunction.indexOf("isPrimaryAnimationReactMountReady") &&
    primaryAnimationTransactionSnapshotIndex >= 0 &&
    primaryAnimationTransactionSnapshotIndex < primaryAnimationTransactionClaimIndex &&
    primaryAnimationTransactionCommitFunction.includes("if (sourceIndex === 2)") &&
    primaryAnimationArtCleanupIndex > primaryAnimationTransactionClaimIndex &&
    primaryAnimationArtCleanupIndex < primaryAnimationMountedCommitIndex &&
    primaryAnimationMountedCommitIndex >= 0 &&
    primaryAnimationGeometryGateIndex > primaryAnimationMountedCommitIndex &&
    primaryAnimationGeometryGateCallCount === 1 &&
    !primaryAnimationTransactionCommitFunction.includes("PRIMARY_ANIMATION_ENTRY_TRANSACTION.complete") &&
    !primaryAnimationTransactionCommitFunction.includes('releasePrimaryAnimationEntryPreviewAfterPaint("mounted")') &&
    primaryAnimationTransactionCompleteIndex >= 0 &&
    primaryAnimationCommittedSerialIndex > primaryAnimationTransactionCompleteIndex &&
    primaryAnimationPreviewMountedReleaseIndex > primaryAnimationCommittedSerialIndex &&
    primaryAnimationMountedReleaseCount === 1 &&
    !primaryAnimationTransactionCommitFunction.includes("commitPrimaryAnimationEntryState"),
  "The source-aware transaction must mounted-commit, pass one geometry gate, complete, publish its serial, and only then release Preview exactly once"
);
const clientAuthEnsureAutomaticHost = getFunctionWithBindings(
  clientAuthRuntime,
  "ensureAutomaticAuthHostMounted"
);
const clientAuthEnsureMountedStart = clientAuthRuntime.indexOf("ensureMounted() {");
const clientAuthEnsureMountedEnd = clientAuthRuntime.indexOf("\n    },", clientAuthEnsureMountedStart);
const clientAuthEnsureMountedBody = clientAuthEnsureMountedStart >= 0 && clientAuthEnsureMountedEnd > clientAuthEnsureMountedStart
  ? clientAuthRuntime.slice(clientAuthEnsureMountedStart, clientAuthEnsureMountedEnd + 6)
  : "";
const normalizedClientAuthEnsureMountedBody = clientAuthEnsureMountedBody.replace(/\s+/g, " ").trim();
const missingAutomaticHost = { ready: false };
let automaticHostRenderCalls = 0;
const automaticHostMissingResult = clientAuthEnsureAutomaticHost?.(
  missingAutomaticHost,
  () => { automaticHostRenderCalls += 1; },
  (target) => target?.ready === true
);
const mountedAutomaticHost = { ready: false };
const automaticHostMountedResult = clientAuthEnsureAutomaticHost?.(
  mountedAutomaticHost,
  () => {
    automaticHostRenderCalls += 1;
    mountedAutomaticHost.ready = true;
  },
  (target) => target?.ready === true
);
const alreadyReadyAutomaticHost = { ready: true };
const renderCallsBeforeReadyProbe = automaticHostRenderCalls;
const automaticHostReadyResult = clientAuthEnsureAutomaticHost?.(
  alreadyReadyAutomaticHost,
  () => { automaticHostRenderCalls += 1; },
  (target) => target?.ready === true
);
assert(
  clientAuthEnsureMountedBody.includes("const automaticHost = ensureHost();") &&
    clientAuthEnsureMountedBody.includes("return ensureAutomaticAuthHostMounted(automaticHost);") &&
    normalizedClientAuthEnsureMountedBody === "ensureMounted() { const automaticHost = ensureHost(); return ensureAutomaticAuthHostMounted(automaticHost); }" &&
    !clientAuthEnsureMountedBody.includes("authHosts()") &&
    automaticHostMissingResult === false &&
    automaticHostMountedResult === true &&
    automaticHostReadyResult === true &&
    automaticHostRenderCalls === renderCallsBeforeReadyProbe &&
    clientAuthRuntime.includes('target.querySelector(".nf-client-auth-title")') &&
    clientAuthRuntime.includes('window.dispatchEvent(new Event(MOUNTED_EVENT))') &&
    runtime.includes('window.addEventListener("novaflow-client-auth-mounted"') &&
    runtime.includes('tryCommitPrimaryAnimationEntryTransaction("client-auth-mounted")'),
  "Animation entry must render and verify its automatic client-auth owner even when an unrelated external AIFX host is already ready"
);

const primaryAnimationAtomicCommitFunction = getFunctionBody("commitPrimaryAnimationEntryState");
const primaryAnimationMountedStateCommitFunction = getFunctionBody("commitPrimaryAnimationEntryMountedState");
const primaryAnimationCollapseResetFunction = getFunctionBody("resetAiAnimationCollapseStateForEntry");
const primaryAnimationCollapseResetIndex = primaryAnimationAtomicCommitFunction.indexOf("resetAiAnimationCollapseStateForEntry()");
const primaryAnimationCollapseGuardStart = primaryAnimationAtomicCommitFunction.indexOf("if (shouldResetCollapse) {");
const primaryAnimationCollapseGuardEnd = primaryAnimationAtomicCommitFunction.indexOf("\n    }", primaryAnimationCollapseGuardStart);
const primaryAnimationCollapseGuardBlock = primaryAnimationAtomicCommitFunction.slice(
  primaryAnimationCollapseGuardStart,
  primaryAnimationCollapseGuardEnd + 6
);
assert(
  primaryAnimationCollapseResetFunction.includes("AI_ANIMATION_COLLAPSE_STATE.mode = true") &&
    primaryAnimationCollapseResetFunction.includes("AI_ANIMATION_COLLAPSE_STATE.post = true") &&
    (primaryAnimationAtomicCommitFunction.match(/resetAiAnimationCollapseStateForEntry\(\)/g) || []).length === 1 &&
    primaryAnimationCollapseGuardBlock.includes("resetAiAnimationCollapseStateForEntry()") &&
    primaryAnimationCollapseGuardBlock.includes("requestAiAnimationPreviewRealGeometrySync()") &&
    primaryAnimationAtomicCommitFunction.includes('const wasAnimationTarget = body.classList.contains("novaflow-primary-target-animation")') &&
    primaryAnimationAtomicCommitFunction.includes("const shouldResetCollapse = options.resetCollapse === true || !wasAnimationTarget") &&
    primaryAnimationCollapseResetIndex > primaryAnimationAtomicCommitFunction.indexOf("if (shouldResetCollapse)") &&
    primaryAnimationCollapseResetIndex < primaryAnimationAtomicCommitFunction.indexOf("requestAiAnimationPreviewRealGeometrySync()") &&
    primaryAnimationCollapseResetIndex < primaryAnimationAtomicCommitFunction.indexOf("syncAiAnimationModeSwitchGuard()") &&
    primaryAnimationTransactionCommitFunction.includes("commitPrimaryAnimationEntryMountedState(reason, snapshot, {") &&
    primaryAnimationTransactionCommitFunction.includes("resetCollapse: true") &&
    primaryAnimationTransactionCommitFunction.indexOf("resetCollapse: true") > primaryAnimationTransactionClaimIndex &&
    primaryAnimationMountedStateCommitFunction.includes("if (options.resetCollapse !== true && hasPrimaryAnimationEntryAtomicState(snapshot)) return true") &&
    primaryAnimationMountedStateCommitFunction.indexOf("options.resetCollapse !== true") <
      primaryAnimationMountedStateCommitFunction.indexOf("resetCollapse: options.resetCollapse === true") &&
    primaryAnimationMountedStateCommitFunction.includes("resetCollapse: options.resetCollapse === true"),
  "A transaction-owned Animation entry must close mode and post panels before projecting the first target layout"
);

const primaryAnimationReplayFunction = getFunctionBody("replayPrimaryAnimationEntryIntent");
const primaryAnimationNativeReplayFunction = getFunctionBody("executePrimaryAnimationEntryNativeReplay");
const primaryAnimationBypassIndex = primaryAnimationReplayFunction.indexOf("if (bypassPreview)");
const primaryAnimationPendingIndex = primaryAnimationReplayFunction.indexOf("const pending = (async () =>");
const primaryAnimationBypassBlock = primaryAnimationReplayFunction.slice(
  primaryAnimationBypassIndex,
  primaryAnimationPendingIndex
);
const primaryAnimationPreviewBlock = primaryAnimationReplayFunction.slice(primaryAnimationPendingIndex);
assert(
  primaryAnimationBypassIndex >= 0 &&
    primaryAnimationPendingIndex > primaryAnimationBypassIndex &&
    !primaryAnimationBypassBlock.includes("capturePrimaryAnimationEntryPreview") &&
    !primaryAnimationBypassBlock.includes("PRIMARY_ANIMATION_ENTRY_REPLAY_PROMISE") &&
    primaryAnimationBypassBlock.includes("executePrimaryAnimationEntryNativeReplay(button") &&
    primaryAnimationBypassBlock.includes("armGeometryGuard: true") &&
    primaryAnimationReplayFunction.includes("const previewSupported = Boolean(PRIMARY_ANIMATION_ENTRY_PREVIEW?.isSupported?.())") &&
    primaryAnimationPreviewBlock.includes("if (previewSupported)") &&
    primaryAnimationPreviewBlock.includes("await capturePrimaryAnimationEntryPreview()") &&
    primaryAnimationPreviewBlock.indexOf("capturePrimaryAnimationEntryPreview") <
      primaryAnimationPreviewBlock.indexOf("executePrimaryAnimationEntryNativeReplay(button") &&
    primaryAnimationPreviewBlock.includes("armGeometryGuard: !previewSupported") &&
    primaryAnimationNativeReplayFunction.indexOf("holdPrimaryAnimationEntryGeometrySurface()") >= 0 &&
    primaryAnimationNativeReplayFunction.indexOf("holdPrimaryAnimationEntryGeometrySurface()") <
      primaryAnimationNativeReplayFunction.indexOf("button.click()") &&
    primaryAnimationNativeReplayFunction.indexOf("preparePrimaryAnimationEntryReplayIntent()") <
      primaryAnimationNativeReplayFunction.indexOf("button.click()") &&
    primaryAnimationNativeReplayFunction.indexOf("PRIMARY_ANIMATION_ENTRY_REPLAY_BUTTONS.delete(button)") >
      primaryAnimationNativeReplayFunction.indexOf("button.click()") &&
    primaryAnimationNativeReplayFunction.indexOf('handlePrimaryEntryPostActivation("\\u52a8\\u753b")') >
      primaryAnimationNativeReplayFunction.indexOf("button.click()"),
  "Every no-Preview replay must arm the target-only geometry guard before its native click while Preview-supported replay retains compositor ownership"
);
function runNativeReplayHarness({ armGeometryGuard, failAt = "", replaySerial = 7, currentSerial = 7 }) {
  const trace = [];
  let guardActive = false;
  let guardSerial = -1;
  let replayClaimed = false;
  let cancelCalls = 0;
  const releasedSerials = [];
  const executeReplay = getFunctionWithBindings(runtime, "executePrimaryAnimationEntryNativeReplay", {
    holdPrimaryAnimationEntryGeometrySurface: () => {
      trace.push("guard");
      guardActive = true;
      guardSerial = currentSerial;
      if (failAt === "guard") throw new Error("guard");
    },
    preparePrimaryAnimationEntryReplayIntent: () => {
      trace.push("prepare");
      if (failAt === "prepare") throw new Error("prepare");
    },
    PRIMARY_ANIMATION_ENTRY_REPLAY_BUTTONS: {
      add: () => {
        trace.push("claim");
        replayClaimed = true;
      },
      delete: () => {
        trace.push("release-claim");
        replayClaimed = false;
        return true;
      },
      has: () => replayClaimed
    },
    handlePrimaryEntryPostActivation: () => {
      trace.push("post");
      if (failAt === "post") throw new Error("post");
    },
    PRIMARY_ANIMATION_ENTRY_TRANSACTION_SERIAL: currentSerial,
    cancelPrimaryAnimationEntryTransaction: () => {
      cancelCalls += 1;
      guardActive = false;
      guardSerial = -1;
      return true;
    },
    releasePrimaryAnimationEntryGeometrySurfaceHold: (serial) => {
      releasedSerials.push(serial);
      if (guardSerial !== serial) return false;
      guardActive = false;
      guardSerial = -1;
      return true;
    },
    nfAnimationPerfCountCallsite: () => {}
  });
  const button = {
    click() {
      trace.push(`click:${guardActive ? "guarded" : "unguarded"}`);
      if (failAt === "click") throw new Error("click");
    }
  };
  const result = executeReplay?.(button, {
    armGeometryGuard,
    replaySerial,
    reason: "contract-replay-error"
  });
  return { result, trace, guardActive, guardSerial, replayClaimed, cancelCalls, releasedSerials };
}
const guardedReplay = runNativeReplayHarness({ armGeometryGuard: true });
const previewOwnedReplay = runNativeReplayHarness({ armGeometryGuard: false });
const prepareFailureReplay = runNativeReplayHarness({ armGeometryGuard: true, failAt: "prepare" });
const clickFailureReplay = runNativeReplayHarness({ armGeometryGuard: true, failAt: "click" });
const postFailureReplay = runNativeReplayHarness({ armGeometryGuard: true, failAt: "post" });
const guardFailureReplay = runNativeReplayHarness({ armGeometryGuard: true, failAt: "guard" });
const staleReplayFailure = runNativeReplayHarness({ armGeometryGuard: true, failAt: "prepare", replaySerial: 7, currentSerial: 8 });
assert(
  guardedReplay.result === true &&
    guardedReplay.trace.indexOf("guard") < guardedReplay.trace.indexOf("click:guarded") &&
    guardedReplay.guardActive === true &&
    guardedReplay.replayClaimed === false &&
    previewOwnedReplay.result === true &&
    previewOwnedReplay.trace.includes("click:unguarded") &&
    [guardFailureReplay, prepareFailureReplay, clickFailureReplay, postFailureReplay].every((result) => (
      result.result === false && !result.guardActive && !result.replayClaimed && result.cancelCalls === 1
    )) &&
    staleReplayFailure.result === false &&
    staleReplayFailure.guardActive === true &&
    staleReplayFailure.guardSerial === 8 &&
    staleReplayFailure.replayClaimed === false &&
    staleReplayFailure.cancelCalls === 0 &&
    staleReplayFailure.releasedSerials.length === 1 &&
    staleReplayFailure.releasedSerials[0] === 7,
  "Native replay must be guarded at click time, skip the guard under Preview, and clean guard ownership after prepare/click/post or stale-serial failures"
);
assert(
  !runtime.includes("startViewTransition") &&
    !runtime.includes("PRIMARY_ANIMATION_ENTRY_VIEW_") &&
    !runtime.includes("PRIMARY_ANIMATION_ENTRY_REPAINT_") &&
    runtime.includes("releasePrimaryAnimationEntryPreviewAfterPaint"),
  "Runtime must remove native compositor timing hacks and release only through Preview lifecycle"
);

const primaryEntryCaptureFunction = getFunctionBody("bindPrimaryEntryActivationCapture");
assert(
  primaryEntryCaptureFunction.indexOf('if (label === "\\u52a8\\u753b")') >= 0 &&
    primaryEntryCaptureFunction.indexOf('if (label === "\\u52a8\\u753b")') <
      primaryEntryCaptureFunction.indexOf('markPrimaryNavigationIntent(label)') &&
    primaryEntryCaptureFunction.includes("setAiAnimationFallbackPreviewVars();\n          return;"),
  "Animation capture must snapshot the complete source page before any source-destructive intent side effects"
);
assert(
  primaryAnimationReplayFunction.includes("preview-capture-rejected") &&
    primaryAnimationReplayFunction.includes("preview-replay-error") &&
    primaryAnimationReplayFunction.includes("cancelPrimaryAnimationEntryTransaction") &&
    primaryAnimationReplayFunction.includes("releasePrimaryAnimationEntryPreviewAfterPaint"),
  "Electron capture failures must fail closed and stale asynchronous captures must not replay"
);

const brandMutationObserverFunction = getFunctionBody("startBrandMutationObserver");
assert(
  brandMutationObserverFunction.includes('tryCommitPrimaryAnimationEntryTransaction("brand-mutation")') &&
    brandMutationObserverFunction.indexOf('tryCommitPrimaryAnimationEntryTransaction("brand-mutation")') <
      brandMutationObserverFunction.indexOf("if (document.hidden) return") &&
    brandMutationObserverFunction.indexOf('tryCommitPrimaryAnimationEntryTransaction("brand-mutation")') <
      brandMutationObserverFunction.indexOf("isAiAnimationRangeDragGuardActive") &&
    brandMutationObserverFunction.includes('tryCommitPrimaryAnimationEntryTransaction("visibility")'),
  "The existing Brand observer must drive and recover the transaction before hidden/general mutation early returns"
);

const primaryAnimationMountReady = getPureFunction("isPrimaryAnimationReactMountReady");
assert(
  primaryAnimationMountReady?.({ animationGroupMounted: false, particleGroupVisible: true, aiSequenceTargetActive: true, skeletonTargetActive: false, fullLayoutReady: true, clientAuthReady: true }) === false &&
    primaryAnimationMountReady?.({ animationGroupMounted: true, particleGroupVisible: true, aiSequenceTargetActive: true, skeletonTargetActive: false, fullLayoutReady: true, clientAuthReady: true }) === false &&
    primaryAnimationMountReady?.({ animationGroupMounted: true, particleGroupVisible: false, aiSequenceTargetActive: false, skeletonTargetActive: true, fullLayoutReady: true, clientAuthReady: true }) === false &&
    primaryAnimationMountReady?.({ animationGroupMounted: true, particleGroupVisible: false, aiSequenceTargetActive: true, skeletonTargetActive: false, fullLayoutReady: false, clientAuthReady: true }) === false &&
    primaryAnimationMountReady?.({ animationGroupMounted: true, particleGroupVisible: false, aiSequenceTargetActive: true, skeletonTargetActive: false, fullLayoutReady: true, clientAuthReady: false }) === false &&
    primaryAnimationMountReady?.({ animationGroupMounted: true, particleGroupVisible: false, aiSequenceTargetActive: true, skeletonTargetActive: false, fullLayoutReady: true, clientAuthReady: true }) === true,
  "Primary Animation mount readiness must require the final client-auth owner and reject Particle, Skeleton, or partial layout overlap"
);

const primaryAnimationSettleAction = getPureFunction("resolvePrimaryAnimationEntrySettleAction");
assert(
  primaryAnimationSettleAction?.({ tokenMatches: false, animationTargetActive: true, mountReady: true, pass: 0, maxFramePasses: 8 }) === "cancel" &&
    primaryAnimationSettleAction?.({ tokenMatches: true, animationTargetActive: false, handoffPending: false, mountReady: true, pass: 0, maxFramePasses: 8 }) === "cancel" &&
    primaryAnimationSettleAction?.({ tokenMatches: true, animationTargetActive: false, handoffPending: true, mountReady: false, pass: 0, maxFramePasses: 8 }) === "retry" &&
    primaryAnimationSettleAction?.({ tokenMatches: true, animationTargetActive: false, handoffPending: true, mountReady: true, pass: 0, maxFramePasses: 8 }) === "commit" &&
    primaryAnimationSettleAction?.({ tokenMatches: true, animationTargetActive: true, mountReady: false, pass: 0, maxFramePasses: 8 }) === "retry" &&
    primaryAnimationSettleAction?.({ tokenMatches: true, animationTargetActive: true, mountReady: false, pass: 8, maxFramePasses: 8 }) === "stop" &&
    primaryAnimationSettleAction?.({ tokenMatches: true, animationTargetActive: true, mountReady: true, pass: 8, maxFramePasses: 8 }) === "commit",
  "Primary Animation cold-mount settle decisions must cancel stale routes, retry only within bounds, and commit only when mounted"
);

const primaryAnimationMountSnapshotFunction = getFunctionBody("getPrimaryAnimationReactMountSnapshot");
assert(
  primaryAnimationMountSnapshotFunction.includes('findConnectedEntryButton("AI\\u5e8f\\u5217\\u52a8\\u753b")') &&
    primaryAnimationMountSnapshotFunction.includes('findConnectedEntryButton("\\u9aa8\\u9abc\\u52a8\\u753b")') &&
    primaryAnimationMountSnapshotFunction.includes("findCommonParent") &&
    primaryAnimationMountSnapshotFunction.includes("animationGroup.isConnected") &&
    !primaryAnimationMountSnapshotFunction.includes("findEntryButton(") &&
    !primaryAnimationMountSnapshotFunction.includes("isVisible("),
  "Primary Animation handoff evidence must use connected React owners without an indirect visibility dependency"
);
const connectedEntryButtonFunction = getFunctionBody("findConnectedEntryButton");
assert(
  connectedEntryButtonFunction.includes("querySelectorAll") &&
    connectedEntryButtonFunction.includes("node.isConnected") &&
    !connectedEntryButtonFunction.includes("isVisible") &&
    !connectedEntryButtonFunction.includes("getBoundingClientRect"),
  "Connected entry lookup must remain geometry-free while the outgoing visual snapshot owns the screen"
);
const primaryAnimationGeometrySnapshotFunction = getFunctionBody("getPrimaryAnimationEntryGeometrySnapshot");
const primaryAnimationGeometryComparator = getPureFunction("arePrimaryAnimationEntryGeometrySnapshotsStable");
const primaryAnimationGeometryAction = getPureFunction("resolvePrimaryAnimationEntryGeometryStabilityAction");
const primaryAnimationGeometryAdvance = getFunctionWithBindings(
  runtime,
  "advancePrimaryAnimationEntryGeometryStabilityState",
  { resolvePrimaryAnimationEntryGeometryStabilityAction: primaryAnimationGeometryAction }
);
const primaryAnimationGeometryCancelFunction = getFunctionBody("cancelPrimaryAnimationEntryGeometryStabilityCheck");
const primaryAnimationGeometryHoldFunction = getFunctionBody("holdPrimaryAnimationEntryGeometrySurface");
const primaryAnimationGeometryHoldReleaseFunction = getFunctionBody("releasePrimaryAnimationEntryGeometrySurfaceHold");
const stableGeometryA = {
  values: [339, 56, 941, 664, 339, 56, 941, 664, 1020, 56, 260, 664, 347, 329, 665, 383],
  transform: "matrix(1, 0, 0, 1, 0, 0)",
  scale: "1"
};
const stableGeometryB = {
  ...stableGeometryA,
  values: stableGeometryA.values.map((value, index) => value + (index % 2 ? 1 : -1))
};
assert(
  primaryAnimationGeometrySnapshotFunction.includes('data-novaflow-ai-main-workspace="1"') &&
    primaryAnimationGeometrySnapshotFunction.includes('data-novaflow-ai-main-stage="1"') &&
    primaryAnimationGeometrySnapshotFunction.includes('data-novaflow-ai-resource-sidebar-host="1"') &&
    primaryAnimationGeometrySnapshotFunction.includes('data-novaflow-ai-bottom-workspace="1"') &&
    primaryAnimationGeometrySnapshotFunction.includes('resolvedMainStage?.querySelector?.(\'[data-ais-canvas="1"]\')') &&
    primaryAnimationGeometrySnapshotFunction.includes("resolvedMainStage.contains(transformTarget)") &&
    primaryAnimationGeometrySnapshotFunction.includes("transformTarget") &&
    primaryAnimationGeometrySnapshotFunction.includes("createScopedClientRectReader") &&
    !primaryAnimationGeometrySnapshotFunction.includes("getAiAnimationCanvasTarget") &&
    primaryAnimationGeometrySnapshotFunction.includes("transform") &&
    primaryAnimationGeometrySnapshotFunction.includes("scale") &&
    !primaryAnimationGeometrySnapshotFunction.includes("querySelectorAll"),
  "Primary Animation geometry snapshot must wait for the active stage-owned canvas and never fall back to a stale global canvas"
);
assert(
  primaryAnimationGeometryComparator?.(null, stableGeometryA) === false &&
    primaryAnimationGeometryComparator?.(stableGeometryA, stableGeometryB) === true &&
    primaryAnimationGeometryComparator?.(stableGeometryA, {
      ...stableGeometryA,
      values: stableGeometryA.values.slice(0, -4)
    }) === false &&
    primaryAnimationGeometryComparator?.(stableGeometryA, {
      ...stableGeometryA,
      values: stableGeometryA.values.map((value, index) => value + (index === 0 ? 1.01 : 0))
    }) === false &&
    primaryAnimationGeometryComparator?.(stableGeometryA, { ...stableGeometryA, transform: "none" }) === false &&
    primaryAnimationGeometryComparator?.(stableGeometryA, { ...stableGeometryA, scale: "0.99" }) === false,
  "Primary Animation geometry stability must require all rect deltas within one pixel and identical transform/scale"
);
assert(
  primaryAnimationGeometryHoldFunction.includes("PRIMARY_ANIMATION_ENTRY_PREVIEW_HANDLE?.isActive?.()") &&
    primaryAnimationGeometryHoldFunction.includes('data-novaflow-ai-main-stage="1"') &&
    primaryAnimationGeometryHoldFunction.includes("document.body.classList.add(PRIMARY_ANIMATION_ENTRY_GEOMETRY_GUARD_CLASS)") &&
    primaryAnimationGeometryHoldFunction.includes("state.guardSerial = PRIMARY_ANIMATION_ENTRY_TRANSACTION_SERIAL") &&
    !primaryAnimationGeometryHoldFunction.includes("target.style") &&
    primaryAnimationGeometryHoldReleaseFunction.includes("document.body?.classList.remove(PRIMARY_ANIMATION_ENTRY_GEOMETRY_GUARD_CLASS)") &&
    primaryAnimationGeometryHoldReleaseFunction.includes("state.guardSerial !== Number(expectedSerial)") &&
    primaryAnimationGeometryCancelFunction.includes("options.releaseGuard !== false") &&
    primaryAnimationGeometryCancelFunction.includes("releasePrimaryAnimationEntryGeometrySurfaceHold(expectedSerial)"),
  "No-Preview entry must use a transaction-owned body marker and release it through the shared geometry cancellation path"
);
const guardReleaseState = { guarded: true, guardSerial: 9 };
let guardClassRemoveCalls = 0;
const guardedRelease = getFunctionWithBindings(runtime, "releasePrimaryAnimationEntryGeometrySurfaceHold", {
  PRIMARY_ANIMATION_ENTRY_GEOMETRY_STABILITY: guardReleaseState,
  document: { body: { classList: { remove: () => { guardClassRemoveCalls += 1; } } } },
  PRIMARY_ANIMATION_ENTRY_GEOMETRY_GUARD_CLASS: "contract-guard"
});
const staleGuardRelease = guardedRelease?.(8);
const ownedGuardRelease = guardedRelease?.(9);
const geometryCancelState = { frame: 41, token: 22, serial: 12, guarded: true, guardSerial: 12 };
const cancelledGeometryFrames = [];
const releasedGeometrySerials = [];
const guardedCancel = getFunctionWithBindings(runtime, "cancelPrimaryAnimationEntryGeometryStabilityCheck", {
  PRIMARY_ANIMATION_ENTRY_GEOMETRY_STABILITY: geometryCancelState,
  window: { cancelAnimationFrame: (frame) => cancelledGeometryFrames.push(frame) },
  releasePrimaryAnimationEntryGeometrySurfaceHold: (serial) => {
    releasedGeometrySerials.push(serial);
    return true;
  }
});
const staleGeometryCancel = guardedCancel?.({ expectedToken: 21, expectedSerial: 11 });
const ownedGeometryCancel = guardedCancel?.({ expectedToken: 22, expectedSerial: 12 });
assert(
  staleGuardRelease === false &&
    ownedGuardRelease === true &&
    guardClassRemoveCalls === 1 &&
    staleGeometryCancel === false &&
    ownedGeometryCancel === true &&
    cancelledGeometryFrames.join(",") === "41" &&
    releasedGeometrySerials.join(",") === "12" &&
    geometryCancelState.frame === 0 &&
    geometryCancelState.token === -1 &&
    geometryCancelState.serial === -1,
  "A stale RAF or replay serial must not clear a newer frame/guard owner, while the matching owner must release exactly once"
);
const primaryAnimationGeometryGuardCssStart = runtime.indexOf('body.${PRIMARY_ANIMATION_ENTRY_GEOMETRY_GUARD_CLASS} [data-novaflow-ai-main-stage="1"]');
const primaryAnimationGeometryGuardCssEnd = runtime.indexOf("\n      }", primaryAnimationGeometryGuardCssStart);
const primaryAnimationGeometryGuardCss = primaryAnimationGeometryGuardCssStart >= 0 && primaryAnimationGeometryGuardCssEnd > primaryAnimationGeometryGuardCssStart
  ? runtime.slice(primaryAnimationGeometryGuardCssStart, primaryAnimationGeometryGuardCssEnd + 1)
  : "";
assert(
  primaryAnimationGeometryGuardCss.includes("visibility: hidden !important") &&
    !primaryAnimationGeometryGuardCss.includes("::before") &&
    !primaryAnimationGeometryGuardCss.includes("::after") &&
    !primaryAnimationGeometryGuardCss.includes("background") &&
    !primaryAnimationGeometryGuardCss.includes(".nf-app-body"),
  "The entry guard CSS must hide only the target main stage without a body, pseudo-element, or black overlay"
);
const changedGeometry = {
  ...stableGeometryA,
  values: stableGeometryA.values.map((value, index) => value + (index === 0 ? 4 : 0))
};
const changedGeometryAgain = {
  ...stableGeometryA,
  values: stableGeometryA.values.map((value, index) => value + (index === 0 ? 8 : 0))
};
function runGeometryProgression(samples) {
  let previousSnapshot = null;
  let stabilityStartedAt = null;
  let validComparisons = 0;
  return samples.map(({ snapshot, now }, index) => {
    const hasBaseline = previousSnapshot !== null;
    const hasSnapshot = snapshot !== null;
    const stable = hasBaseline && hasSnapshot &&
      primaryAnimationGeometryComparator?.(previousSnapshot, snapshot, 1) === true;
    const progress = primaryAnimationGeometryAdvance?.({
      stable,
      hasBaseline,
      hasSnapshot,
      framePasses: index + 1,
      validComparisons,
      stabilityStartedAt,
      nowMs: now,
      maxFramePasses: 32,
      maxElapsedMs: 500
    });
    validComparisons = progress?.validComparisons;
    stabilityStartedAt = progress?.stabilityStartedAt;
    previousSnapshot = progress?.hasBaseline && hasSnapshot ? snapshot : null;
    return progress?.action;
  });
}
const delayedStableActions = runGeometryProgression([
  { snapshot: stableGeometryA, now: 700 },
  { snapshot: stableGeometryA, now: 720 }
]);
const changedThenStableActions = runGeometryProgression([
  { snapshot: stableGeometryA, now: 700 },
  { snapshot: changedGeometry, now: 720 },
  { snapshot: changedGeometry, now: 736 }
]);
const invalidBreaksContinuityActions = runGeometryProgression([
  { snapshot: stableGeometryA, now: 700 },
  { snapshot: null, now: 710 },
  { snapshot: stableGeometryA, now: 720 },
  { snapshot: stableGeometryA, now: 736 }
]);
const elapsedUnstableActions = runGeometryProgression([
  { snapshot: stableGeometryA, now: 0 },
  { snapshot: changedGeometry, now: 100 },
  { snapshot: changedGeometryAgain, now: 600 }
]);
const invalidFrameActions = runGeometryProgression(
  Array.from({ length: 32 }, (_, index) => ({ snapshot: null, now: 700 + index * 16 }))
);
assert(
  delayedStableActions.join(",") === "retry,complete" &&
    changedThenStableActions.join(",") === "retry,retry,complete" &&
    invalidBreaksContinuityActions.join(",") === "retry,retry,retry,complete" &&
    elapsedUnstableActions.join(",") === "retry,retry,rollback" &&
    invalidFrameActions.slice(0, 31).every((action) => action === "retry") &&
    invalidFrameActions[31] === "rollback" &&
    invalidFrameActions.filter((action) => action === "rollback").length === 1 &&
    primaryAnimationGeometryAction?.({ stable: true, hasBaseline: true, hasSnapshot: true, framePasses: 32, validComparisons: 31, elapsedMs: 900, maxFramePasses: 32, maxElapsedMs: 500 }) === "complete",
  "The production geometry reducer must handle delayed A-A, changed A-B-B, invalid A-null-A-A, and exactly one 32-frame rollback while stable completion wins"
);
const primaryAnimationGeometryCompareIndex = primaryAnimationGeometryGateFunction.indexOf("arePrimaryAnimationEntryGeometrySnapshotsStable");
const primaryAnimationGeometryActionIndex = primaryAnimationGeometryGateFunction.indexOf("advancePrimaryAnimationEntryGeometryStabilityState");
const primaryAnimationGeometryStableBranchIndex = primaryAnimationGeometryGateFunction.indexOf('if (action === "complete")');
const primaryAnimationGeometryOwnerCheckIndex = primaryAnimationGeometryGateFunction.indexOf("if (state.token !== token || state.serial !== serial) return");
const primaryAnimationGeometryFrameClearIndex = primaryAnimationGeometryGateFunction.indexOf("state.frame = 0");
const primaryAnimationGeometryFramePassIndex = primaryAnimationGeometryGateFunction.indexOf("framePasses += 1");
const primaryAnimationGeometrySnapshotIndex = primaryAnimationGeometryGateFunction.indexOf("getPrimaryAnimationEntryGeometrySnapshot");
assert(
  primaryAnimationGeometryGateFunction.includes("window.requestAnimationFrame(run)") &&
    primaryAnimationGeometryGateFunction.includes("const maxFramePasses = 32") &&
    primaryAnimationGeometryGateFunction.includes("const maxElapsedMs = 500") &&
    primaryAnimationGeometryGateFunction.includes("let stabilityStartedAt = null") &&
    primaryAnimationGeometryGateFunction.includes("let validComparisons = 0") &&
    !primaryAnimationGeometryGateFunction.includes("const startedAt = nowMs()") &&
    primaryAnimationGeometryGateFunction.includes("cancelPrimaryAnimationEntryGeometryStabilityCheck({ releaseGuard: false })") &&
    primaryAnimationGeometryGateFunction.indexOf("holdPrimaryAnimationEntryGeometrySurface()") <
      primaryAnimationGeometryGateFunction.indexOf("window.requestAnimationFrame(run)") &&
    primaryAnimationGeometryGateFunction.includes("nowMs: nowMs()") &&
    primaryAnimationGeometryGateFunction.includes("previousSnapshot = progress.hasBaseline && hasSnapshot ? currentSnapshot : null") &&
    primaryAnimationGeometryGateFunction.includes('rollbackPrimaryAnimationEntryTransaction(token, "geometry-timeout")') &&
    primaryAnimationGeometryOwnerCheckIndex >= 0 &&
    primaryAnimationGeometryOwnerCheckIndex < primaryAnimationGeometryFrameClearIndex &&
    primaryAnimationGeometryFramePassIndex > primaryAnimationGeometryFrameClearIndex &&
    primaryAnimationGeometryFramePassIndex < primaryAnimationGeometrySnapshotIndex &&
    primaryAnimationGeometrySnapshotIndex < primaryAnimationGeometryActionIndex &&
    primaryAnimationGeometryCompareIndex >= 0 &&
    primaryAnimationGeometryActionIndex > primaryAnimationGeometryCompareIndex &&
    primaryAnimationGeometryStableBranchIndex > primaryAnimationGeometryActionIndex &&
    primaryAnimationTransactionCompleteIndex > primaryAnimationGeometryStableBranchIndex &&
    primaryAnimationPreviewMountedReleaseIndex > primaryAnimationTransactionCompleteIndex &&
    !primaryAnimationGeometryGateFunction.includes("setTimeout") &&
    !primaryAnimationGeometryGateFunction.includes("setInterval") &&
    primaryAnimationGeometryCancelFunction.includes("cancelAnimationFrame"),
  "Primary Animation geometry gate must preserve a pre-click guard, start elapsed timing at the first valid baseline, and let stable completion win before bounded rollback"
);
const primaryAnimationTransactionCancelFunction = getFunctionBody("cancelPrimaryAnimationEntryTransaction");
const primaryAnimationTransactionRollbackFunction = getFunctionBody("rollbackPrimaryAnimationEntryTransaction");
assert(
  primaryAnimationTransactionCancelFunction.includes("cancelPrimaryAnimationEntryGeometryStabilityCheck()") &&
    primaryAnimationTransactionRollbackFunction.includes("cancelPrimaryAnimationEntryTransaction(expectedToken, reason") &&
    primaryAnimationGeometryGateFunction.includes("if (!isCurrent())") &&
    (primaryAnimationGeometryGateFunction.match(/cancelPrimaryAnimationEntryGeometryStabilityCheck\(\{ expectedToken: token, expectedSerial: serial \}\)/g) || []).length >= 3,
  "Success, stale-token cancellation, timeout rollback, and explicit transaction cancellation must all release the target guard through one lifecycle owner"
);
assert(
    primaryAnimationMountSnapshotFunction.includes('findConnectedEntryButton("\\u7c92\\u5b50\\u7279\\u6548")') &&
    primaryAnimationMountSnapshotFunction.includes('findConnectedEntryButton("AI\\u7279\\u6548")') &&
    primaryAnimationMountSnapshotFunction.includes('data-novaflow-ai-main-workspace="1"') &&
    primaryAnimationMountSnapshotFunction.includes('data-novaflow-ai-main-stage="1"') &&
    primaryAnimationMountSnapshotFunction.includes('data-ais-canvas="1"') &&
    primaryAnimationMountSnapshotFunction.includes("mainWorkspace.contains(mainStage)") &&
    primaryAnimationMountSnapshotFunction.includes("mainStage.contains(stageCanvas)") &&
    primaryAnimationMountSnapshotFunction.includes('data-novaflow-ai-bottom-workspace="1"') &&
    primaryAnimationMountSnapshotFunction.includes('data-novaflow-ai-resource-sidebar-host="1"') &&
    primaryAnimationMountSnapshotFunction.includes('data-novaflow-ai-resource-sidebar-panel="1"') &&
    primaryAnimationMountSnapshotFunction.includes('data-novaflow-ai-top-mode-tabs="1"') &&
    primaryAnimationMountSnapshotFunction.includes("querySelectorAll") &&
    primaryAnimationMountSnapshotFunction.includes("aiModeSections.length === 1") &&
    primaryAnimationMountSnapshotFunction.includes("const aiModeSection") &&
    primaryAnimationMountSnapshotFunction.includes("aiModeSection.querySelector") &&
    primaryAnimationMountSnapshotFunction.includes('data-novaflow-client-auth-panel="1"') &&
    primaryAnimationMountSnapshotFunction.includes("nf-client-auth-title") &&
    primaryAnimationMountSnapshotFunction.includes('normalizeText("NovaFlow \\u8d26\\u53f7")') &&
    primaryAnimationMountSnapshotFunction.includes("clientAuthReady") &&
    primaryAnimationMountSnapshotFunction.includes("fullLayoutReady") &&
    primaryAnimationMountSnapshotFunction.includes("data-novaflow-secondary-active") &&
    primaryAnimationMountSnapshotFunction.includes("aria-pressed") &&
    !primaryAnimationMountSnapshotFunction.includes("hasSkeletonAnimationMountEvidence") &&
    !primaryAnimationMountSnapshotFunction.includes("SECONDARY_ACTIVE_BY_GROUP") &&
    !primaryAnimationMountSnapshotFunction.includes("novaflow-primary-target-animation"),
  "Primary Animation mount evidence must reject a still-visible Particle secondary group without self-proving from body classes"
);

const primaryAnimationMountEvidenceFunction = getFunctionBody("hasPrimaryAnimationReactMountEvidence");
assert(
  primaryAnimationMountEvidenceFunction.includes("getPrimaryAnimationReactMountSnapshot") &&
    primaryAnimationMountEvidenceFunction.includes("isPrimaryAnimationReactMountReady"),
  "Primary Animation mount evidence must reuse one route snapshot"
);

const primaryAtomicStateFunction = getFunctionBody("hasPrimaryAnimationEntryAtomicState");
assert(
  primaryAtomicStateFunction.includes("isPrimaryAnimationReactMountReady") &&
    primaryAtomicStateFunction.includes("AI_ANIMATION_ENTRY_FIRST_FRAME_SYNC_USED") &&
    primaryAtomicStateFunction.includes("AI_ANIMATION_ENTRY_FIRST_FRAME_SYNC_TOKEN === PRIMARY_SWITCH_TOKEN"),
  "Primary Animation atomic state must require both React mount evidence and a full-sync commit for the current switch"
);

const primaryMountedCommitFunction = getFunctionBody("commitPrimaryAnimationEntryMountedState");
const mountGuardIndex = primaryMountedCommitFunction.indexOf("isPrimaryAnimationReactMountReady");
const defaultPrimeIndex = primaryMountedCommitFunction.indexOf("primeAiSequenceDefaultForPrimaryAnimationEntry");
const fullAtomicCommitIndex = primaryMountedCommitFunction.indexOf("commitPrimaryAnimationEntryState");
const postCommitAtomicCheckIndex = primaryMountedCommitFunction.lastIndexOf("hasPrimaryAnimationEntryAtomicState");
const mountedFullCommitCount = (primaryMountedCommitFunction.match(/commitPrimaryAnimationEntryState\s*\(/g) || []).length;
assert(
  mountGuardIndex >= 0 &&
    defaultPrimeIndex > mountGuardIndex &&
    fullAtomicCommitIndex > defaultPrimeIndex &&
    postCommitAtomicCheckIndex > fullAtomicCommitIndex &&
    mountedFullCommitCount === 1 &&
    primaryMountedCommitFunction.includes("return hasPrimaryAnimationEntryAtomicState(snapshot)") &&
    !primaryMountedCommitFunction.includes("skeletonRouteMounted") &&
    /primeAiSequenceDefaultForPrimaryAnimationEntry\s*\(\s*\{\s*deferSectionStateSync:\s*true\s*,\s*deferDomSyncToAtomicCommit:\s*true\s*\}\s*\)/.test(primaryMountedCommitFunction),
  "Primary Animation full DOM sync must wait for React mount, then state-prime once without duplicating DOM layout before the atomic commit"
);

const primaryPostActivationFunction = getFunctionBody("handlePrimaryEntryPostActivation");
assert(
  primaryPostActivationFunction.includes("commitPrimaryAnimationEntryMountedState") &&
    !primaryPostActivationFunction.includes('commitPrimaryAnimationEntryState("primary-post-activation"'),
  "Primary Animation post activation must not run the full atomic DOM sync against the previous Particle mount"
);
assert(
  primaryPostActivationFunction.includes("isPrimaryAnimationEntryTransactionPending") &&
    primaryPostActivationFunction.includes("bindPrimaryAnimationEntryTransactionToken") &&
    primaryPostActivationFunction.includes("preserveAnimationEntryTransaction") &&
    !primaryPostActivationFunction.includes("artHandoffPending"),
  "Animation post activation must preserve and bind the same source-aware transaction for every primary source"
);

const primaryStableRefreshFunction = getFunctionBody("scheduleAiAnimationPrimaryEntryStableRefresh");
assert(
  primaryStableRefreshFunction.includes("maxFramePasses") &&
    primaryStableRefreshFunction.includes("const fallbackDelay = 2400") &&
    primaryStableRefreshFunction.includes("switchToken !== PRIMARY_SWITCH_TOKEN") &&
    primaryStableRefreshFunction.includes("getPrimaryAnimationReactMountSnapshot") &&
    primaryStableRefreshFunction.includes("hasPrimaryAnimationEntryAtomicState") &&
    primaryStableRefreshFunction.includes("resolvePrimaryAnimationEntrySettleAction") &&
    primaryStableRefreshFunction.includes("commitPrimaryAnimationEntryMountedState") &&
    primaryStableRefreshFunction.includes("isPrimaryAnimationEntryTransactionPending") &&
    primaryStableRefreshFunction.includes("tryCommitPrimaryAnimationEntryTransaction") &&
    primaryStableRefreshFunction.includes("cancelPrimaryAnimationEntryTransaction") &&
    primaryStableRefreshFunction.includes("primaryAnimationEntryMountSettlePass") &&
    primaryStableRefreshFunction.includes("primaryAnimationEntryMountSettleStop"),
  "Primary Animation cold-mount settle must be token-cancelled, bounded, condition-driven, and probe-visible"
);
const primaryMountTimeoutIndex = primaryStableRefreshFunction.indexOf("if (finalPass)");
const primaryMountTimeoutBlock = primaryMountTimeoutIndex >= 0
  ? primaryStableRefreshFunction.slice(primaryMountTimeoutIndex, primaryMountTimeoutIndex + 180)
  : "";
assert(
  primaryMountTimeoutBlock.includes('finish("mount-timeout")') &&
    !primaryMountTimeoutBlock.includes("commitPrimaryAnimationEntryState") &&
    primaryMountTimeoutBlock.includes("rollbackPrimaryAnimationEntryTransaction"),
  "The transaction watchdog must roll React back to the saved source before releasing the outgoing visual transaction"
);

const primaryActivationCaptureFunction = getFunctionBody("bindPrimaryEntryActivationCapture");
const primaryAnimationReplayCall = "replayPrimaryAnimationEntryIntent(button, { bypassPreview: sourceIndex === 2 })";
assert(
  primaryActivationCaptureFunction.indexOf("beginPrimaryAnimationEntryTransaction(sourceIndex)") >= 0 &&
    primaryActivationCaptureFunction.indexOf(primaryAnimationReplayCall) >
      primaryActivationCaptureFunction.indexOf("beginPrimaryAnimationEntryTransaction(sourceIndex)") &&
    primaryActivationCaptureFunction.includes("bypassPreview: sourceIndex === 2") &&
    primaryActivationCaptureFunction.includes("event.preventDefault()") &&
    primaryActivationCaptureFunction.includes("event.stopImmediatePropagation()") &&
    primaryActivationCaptureFunction.includes("PRIMARY_ANIMATION_ENTRY_REPLAY_BUTTONS") &&
    primaryActivationCaptureFunction.includes("sourceIndex !== 1") &&
    !primaryActivationCaptureFunction.includes("sourceArt") &&
    !primaryActivationCaptureFunction.includes("primary-pre-intent") &&
    !primaryActivationCaptureFunction.includes("commitPrimaryAnimationEntryState"),
  "Primary capture must keep one source-aware transaction and limit no-Preview replay to Art"
);
assert(
  runtime.includes('document.addEventListener("click", onPrimaryPreIntent, { capture: true, passive: false })'),
  "The click capture must be non-passive so the entry transaction owns route replay"
);

const clearPrimarySwitchArtifactsFunction = getFunctionBody("clearPrimarySwitchRuntimeArtifacts");
assert(
  clearPrimarySwitchArtifactsFunction.includes("preserveAnimationEntryTransaction") &&
    clearPrimarySwitchArtifactsFunction.includes("cancelPrimaryAnimationEntryTransaction"),
  "Primary switch cleanup must cancel stale entry transactions unless the current mounted wait owns one"
);

const primaryResidueCleanupFunction = getFunctionBody("clearAiAnimationResidueBeforePrimarySwitch");
const primaryResidueSameGenerationGuardIndex = primaryResidueCleanupFunction.indexOf(
  "PRIMARY_SWITCH_RESIDUE_CLEANUP_TOKEN === PRIMARY_SWITCH_TOKEN"
);
const primaryResidueTokenAdvanceIndex = primaryResidueCleanupFunction.indexOf("PRIMARY_SWITCH_TOKEN += 1");
const primaryResidueGenerationBindIndex = primaryResidueCleanupFunction.indexOf(
  "PRIMARY_SWITCH_RESIDUE_CLEANUP_TOKEN = PRIMARY_SWITCH_TOKEN"
);
assert(
  runtime.includes("let PRIMARY_SWITCH_RESIDUE_CLEANUP_TOKEN = -1") &&
    primaryResidueSameGenerationGuardIndex >= 0 &&
    primaryResidueSameGenerationGuardIndex < primaryResidueTokenAdvanceIndex &&
    primaryResidueGenerationBindIndex > primaryResidueTokenAdvanceIndex &&
    primaryResidueGenerationBindIndex < primaryResidueCleanupFunction.indexOf("clearPrimarySwitchRuntimeArtifacts()"),
  "Residue cleanup must dedupe only within the same physical-click generation and bind the completed cleanup to the new route token"
);

let primaryResidueCleanupCalls = 0;
let primaryResidueReleaseCalls = 0;
let primaryResidueCleanupHarness = null;
try {
  primaryResidueCleanupHarness = Function(
    "resolvePrimaryEntryLabel",
    "PRIMARY_ENTRY_LABELS",
    "normalizeText",
    "nowMs",
    "PRIMARY_SWITCH_RESIDUE_CLEANUP_LABEL",
    "PRIMARY_SWITCH_RESIDUE_CLEANUP_UNTIL",
    "PRIMARY_SWITCH_RESIDUE_CLEANUP_TOKEN",
    "PRIMARY_SWITCH_TOKEN",
    "AI_ANIMATION_ENTRY_FIRST_FRAME_SYNC_TOKEN",
    "AI_ANIMATION_ENTRY_FIRST_FRAME_SYNC_UNTIL",
    "AI_ANIMATION_ENTRY_FIRST_FRAME_SYNC_USED",
    "clearPrimarySwitchRuntimeArtifacts",
    "releaseAiAnimationEntryIntent",
    `"use strict";
    ${primaryResidueCleanupFunction}
    return {
      run: clearAiAnimationResidueBeforePrimarySwitch,
      advanceRouteGeneration: () => { PRIMARY_SWITCH_TOKEN += 1; },
      snapshot: () => ({
        switchToken: PRIMARY_SWITCH_TOKEN,
        cleanupToken: PRIMARY_SWITCH_RESIDUE_CLEANUP_TOKEN,
      }),
    };`
  )(
    (label) => label,
    ["\u7279\u6548", "\u52a8\u753b", "\u7f8e\u5de5"],
    (value) => String(value || "").replace(/\s+/g, "").trim(),
    () => 1000,
    null,
    0,
    -1,
    0,
    -1,
    0,
    false,
    () => { primaryResidueCleanupCalls += 1; },
    () => { primaryResidueReleaseCalls += 1; }
  );
} catch (error) {
  fail(`clearAiAnimationResidueBeforePrimarySwitch must support the route-generation harness: ${error.message}`);
}
if (primaryResidueCleanupHarness) {
  primaryResidueCleanupHarness.run("\u7f8e\u5de5");
  const firstResidueCleanupSnapshot = primaryResidueCleanupHarness.snapshot();
  primaryResidueCleanupHarness.run("\u7f8e\u5de5");
  const duplicateResidueCleanupSnapshot = primaryResidueCleanupHarness.snapshot();
  primaryResidueCleanupHarness.run("\u52a8\u753b");
  primaryResidueCleanupHarness.advanceRouteGeneration();
  primaryResidueCleanupHarness.run("\u7f8e\u5de5");
  const returnedResidueCleanupSnapshot = primaryResidueCleanupHarness.snapshot();
  assert(
    primaryResidueCleanupCalls === 2 &&
      primaryResidueReleaseCalls === 2 &&
      firstResidueCleanupSnapshot.switchToken === firstResidueCleanupSnapshot.cleanupToken &&
      duplicateResidueCleanupSnapshot.switchToken === firstResidueCleanupSnapshot.switchToken &&
      returnedResidueCleanupSnapshot.switchToken === returnedResidueCleanupSnapshot.cleanupToken &&
      returnedResidueCleanupSnapshot.switchToken > duplicateResidueCleanupSnapshot.switchToken,
    "Pointer/mouse/click duplicates must clean once, while Art must clean again after an intervening Animation route generation"
  );
}

const primaryBodyClassSyncFunction = getFunctionBody("syncPrimaryTargetBodyClass");
assert(
  primaryBodyClassSyncFunction.includes("resolvePrimaryAnimationPublishedIndex") &&
    primaryBodyClassSyncFunction.indexOf("resolvePrimaryAnimationPublishedIndex") <
      primaryBodyClassSyncFunction.indexOf('classList.toggle("novaflow-primary-target-animation"'),
  "Brand refreshes must preserve the transaction's actual source body class until the mounted commit"
);

const primarySwitchSettleFunction = getFunctionBody("runPrimarySwitchSettle");
assert(
  primarySwitchSettleFunction.includes("isPrimaryAnimationEntryTransactionPending") &&
    primarySwitchSettleFunction.indexOf("isPrimaryAnimationEntryTransactionPending") <
      primarySwitchSettleFunction.indexOf("runFullLayoutRefresh"),
  "Generic primary settle must keep every pending Animation entry in the mounted transaction chain"
);

const stylePrimaryEntriesFunction = getFunctionBody("stylePrimaryEntries");
assert(
  stylePrimaryEntriesFunction.includes("const syncedActiveIndex = syncPrimaryTargetBodyClass(activeIndex)") &&
    stylePrimaryEntriesFunction.includes("activeIndex = syncedActiveIndex") &&
    stylePrimaryEntriesFunction.indexOf("activeIndex = syncedActiveIndex") <
      stylePrimaryEntriesFunction.indexOf("syncForeignPrimaryThemeClasses(activeIndex)"),
  "Primary chrome and foreign theme classes must use the actual guarded body route during an Art handoff"
);
assert(
  !/\b(?:700|1200|1600|2000|2200)\b/.test(primaryStableRefreshFunction),
  "Primary Animation cold-mount settle must not add a fixed long-tail timeout chain"
);

const secondaryGroupFunction = getFunctionBody("styleSecondaryGroup");
assert(
  secondaryGroupFunction.includes("PRIMARY_SWITCH_TOKEN += 1") &&
    secondaryGroupFunction.includes("clearPrimarySwitchRuntimeArtifacts()"),
  "Animation secondary switches must invalidate any stale primary-entry settle chain"
);

const skeletonMountedActivationFunction = getFunctionBody("scheduleSkeletonMountedSurfaceActivation");
const skeletonTokenGuardIndex = skeletonMountedActivationFunction.indexOf("token !== PRIMARY_SWITCH_TOKEN");
const skeletonActivationIndex = skeletonMountedActivationFunction.indexOf("activateSkeletonAnimationLayoutFromMountedSurface");
assert(
  skeletonMountedActivationFunction.includes("const token = PRIMARY_SWITCH_TOKEN") &&
    skeletonTokenGuardIndex >= 0 &&
    skeletonActivationIndex > skeletonTokenGuardIndex,
  "Delayed Skeleton mounted-surface activation must cancel when a newer primary or secondary switch owns the route"
);

const defaultPrimeFunction = getFunctionBody("primeAiSequenceDefaultForPrimaryAnimationEntry");
const atomicDomDeferBranchIndex = defaultPrimeFunction.indexOf("if (deferDomSyncToAtomicCommit)");
const sectionStateGuardIndex = defaultPrimeFunction.indexOf("if (!deferSectionStateSync)");
const atomicDomDeferBranch = atomicDomDeferBranchIndex >= 0 && sectionStateGuardIndex > atomicDomDeferBranchIndex
  ? defaultPrimeFunction.slice(atomicDomDeferBranchIndex, sectionStateGuardIndex)
  : "";
const postSectionDomGuardIndex = defaultPrimeFunction.indexOf("if (!deferDomSyncToAtomicCommit)", sectionStateGuardIndex);
const autoFitScheduleIndex = defaultPrimeFunction.indexOf("scheduleAiAnimationAutoFitOnlyChromePrime", postSectionDomGuardIndex);
const postSectionDomGuard = postSectionDomGuardIndex >= 0 && autoFitScheduleIndex > postSectionDomGuardIndex
  ? defaultPrimeFunction.slice(postSectionDomGuardIndex, autoFitScheduleIndex)
  : "";
assert(
  defaultPrimeFunction.includes("const deferSectionStateSync = options?.deferSectionStateSync === true") &&
    defaultPrimeFunction.includes("const deferDomSyncToAtomicCommit = options?.deferDomSyncToAtomicCommit === true") &&
    atomicDomDeferBranch.includes("clearSkeletonSecondarySwitchQuietWindow") &&
    atomicDomDeferBranch.includes("armAiSequenceSkeletonSurfaceSuppressWindow") &&
    atomicDomDeferBranch.includes("releaseAiAnimationEntryLightMode") &&
    atomicDomDeferBranch.includes("clearSkeletonAnimationLayoutTags") &&
    atomicDomDeferBranch.includes("requestAiAnimationPreviewRealGeometrySync") &&
    atomicDomDeferBranch.includes("else") &&
    atomicDomDeferBranch.includes("applyAiSequenceSecondarySwitchPreLayout") &&
    postSectionDomGuard.includes("ensureAiAnimationBottomWorkspaceFromPreviewRoot") &&
    postSectionDomGuard.includes("syncAiAnimationModeSwitchGuard") &&
    autoFitScheduleIndex > postSectionDomGuardIndex &&
    defaultPrimeFunction.indexOf("scheduleAiSequenceResourceModeChromeRestore", autoFitScheduleIndex) > autoFitScheduleIndex,
  "Default AI Sequence priming must preserve state, skeleton, geometry, AutoFit, and resource recovery while deferring duplicate DOM layout to the atomic commit"
);

const autoFitChromePrimeFunction = getFunctionBody("primeAiAnimationAutoFitOnlyChrome");
const autoFitMarkedFastPathIndex = autoFitChromePrimeFunction.indexOf("const markedFirstFrameControls");
const autoFitBroadScanIndex = autoFitChromePrimeFunction.indexOf("const selector = aiAnimationLayoutActive");
assert(
  autoFitMarkedFastPathIndex >= 0 &&
    autoFitBroadScanIndex > autoFitMarkedFastPathIndex &&
    autoFitChromePrimeFunction.includes("AI_ANIMATION_ENTRY_FIRST_FRAME_SYNC_TOKEN === PRIMARY_SWITCH_TOKEN") &&
    autoFitChromePrimeFunction.includes("Date.now() < AI_ANIMATION_ENTRY_FIRST_FRAME_SYNC_UNTIL") &&
    autoFitChromePrimeFunction.includes("node.isConnected") &&
    autoFitChromePrimeFunction.includes("isSourceOwnedLayout(node) || isInsideSourceOwnedLayout(node)") &&
    autoFitChromePrimeFunction.includes("styleAutoFitOnlyControl(node)") &&
    autoFitChromePrimeFunction.includes("aiAnimationAutoFitChromeMarkedFastPath") &&
    autoFitChromePrimeFunction.indexOf("return true", autoFitMarkedFastPathIndex) < autoFitBroadScanIndex,
  "Post-commit first-frame AutoFit retries must reuse connected marked controls before any broad DOM text scan"
);

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
assert(
  uploadBottomRefreshFunction.includes("catch (error)") &&
    uploadBottomRefreshFunction.includes('finish("error")') &&
    uploadBottomRefreshFunction.includes("throw error"),
  "Bottom upload refresh must release pending state before rethrowing synchronization errors"
);

if (!process.exitCode) {
  console.log("PASS AI sequence animation performance contract");
}
