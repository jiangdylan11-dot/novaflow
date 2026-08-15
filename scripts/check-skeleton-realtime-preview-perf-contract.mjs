#!/usr/bin/env node
import { readFileSync } from "node:fs";

const runtime = readFileSync("particle-editor/novaflow-brand-runtime.js", "utf8");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function getFunctionBody(name) {
  const start = runtime.indexOf(`function ${name}`);
  assert(start >= 0, `${name} must exist`);
  if (start < 0) return "";
  let signatureIndex = runtime.indexOf("(", start);
  let signatureDepth = 0;
  for (; signatureIndex < runtime.length; signatureIndex += 1) {
    const char = runtime[signatureIndex];
    if (char === "(") signatureDepth += 1;
    else if (char === ")") {
      signatureDepth -= 1;
      if (signatureDepth === 0) break;
    }
  }
  let index = runtime.indexOf("{", signatureIndex);
  let depth = 0;
  for (; index < runtime.length; index += 1) {
    const char = runtime[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return runtime.slice(start, index + 1);
    }
  }
  fail(`${name} body must be parseable`);
  return "";
}

const rangeLayoutFunction = getFunctionBody("scheduleSkeletonRangeLayoutRefresh");
assert(
  rangeLayoutFunction.includes("options.realtimeInput"),
  "Skeleton range input layout must have a realtime-input trailing mode"
);
assert(
  rangeLayoutFunction.includes("!realtimeInput && !immediate"),
  "Skeleton realtime range input must not schedule an immediate RAF layout pass on every input event"
);

const rangeInputFunction = getFunctionBody("refreshSkeletonLayoutAfterRangeInput");
assert(
  rangeInputFunction.includes("const immediate = Boolean(options.immediate)"),
  "Skeleton range input handling must distinguish drag input from committed change"
);
assert(
  !rangeInputFunction.includes("scheduleSkeletonAnimationLayout({ immediate: Boolean(options.immediate) })"),
  "Skeleton range input must not schedule skeleton layout on every drag input"
);
assert(
  rangeInputFunction.includes("scheduleSkeletonRangeLayoutRefresh({ realtimeInput: true })"),
  "Skeleton range drag input must use the trailing realtime-input layout path"
);

const chainRefreshFunction = getFunctionBody("scheduleNovaflowSkeletonCurrentChainFilterRefresh");
assert(
  chainRefreshFunction.includes("getNovaflowSkeletonCurrentChainFilterRefreshSignature"),
  "Skeleton current-chain refresh must be signature deduped"
);
assert(
  chainRefreshFunction.includes("SKELETON_CURRENT_CHAIN_FILTER_REFRESH_FRAME") &&
    chainRefreshFunction.includes("SKELETON_CURRENT_CHAIN_FILTER_REFRESH_TIMER"),
  "Skeleton current-chain refresh must be coalesced behind one RAF and one short settle"
);
assert(
  !chainRefreshFunction.includes("[0, 48, 120, 240].forEach"),
  "Skeleton current-chain refresh must not use multi-timeout render retries"
);

const chainFilterFunction = getFunctionBody("refreshNovaflowSkeletonCurrentChainBoneFilter");
assert(
  chainFilterFunction.includes("__novaflowSkeletonCurrentChainRenderSignature"),
  "Skeleton current-chain render must skip duplicate renderCurrentPose calls by signature"
);

const selectionCallbackFunction = getFunctionBody("guardRibbonBoneSelectionCallbacks");
const selectionCaptureMatches = selectionCallbackFunction.match(/captureRibbonSelectionBaselineAndResync/g) || [];
assert(
  selectionCaptureMatches.length === 1,
  "Skeleton bone selection callback must not capture both before and after the React callback"
);

const selectionResyncFunction = getFunctionBody("captureRibbonSelectionBaselineAndResync");
assert(
  selectionResyncFunction.includes("RIBBON_SELECTION_BASELINE_RESYNC_FRAME") &&
    selectionResyncFunction.includes("RIBBON_SELECTION_BASELINE_RESYNC_TIMER"),
  "Ribbon selection baseline resync must be frame/settle coalesced"
);
assert(
  !selectionResyncFunction.includes("scheduleRibbonProjectIdentityRepair("),
  "Ribbon selection baseline resync must not schedule multi-timeout project identity repair directly"
);

if (!process.exitCode) {
  console.log("PASS skeleton realtime preview performance contract");
}
