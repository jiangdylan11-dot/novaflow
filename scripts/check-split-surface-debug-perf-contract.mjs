#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtimePath = "particle-editor/spine-split-runtime.js";
const runtime = readFileSync(runtimePath, "utf8");

function count(text, needle) {
  return text.split(needle).length - 1;
}

const observerStartMarker = "surfaceObserver = new MutationObserver((mutations) => {";
const observerEndMarker = "\n  surfaceObserver.observe";
const observerStart = runtime.indexOf(observerStartMarker);
assert.ok(observerStart >= 0, "split Runtime must register the surface MutationObserver");
const observerEnd = runtime.indexOf(observerEndMarker, observerStart);
assert.ok(observerEnd > observerStart, "surface MutationObserver callback must have a stable boundary");
const observerBody = runtime.slice(observerStart, observerEnd);

assert.equal(
  count(observerBody, "nfTopbarHelpDebugEnabled()"),
  1,
  "each surfaceObserver callback must read the debug switch exactly once"
);
assert.match(
  observerBody,
  /const debugEnabled = nfTopbarHelpDebugEnabled\(\)/,
  "surfaceObserver must cache the debug switch for the whole callback"
);
assert.equal(
  count(observerBody, "nfTopbarHelpSplitMutationSummary(mutations)"),
  1,
  "surfaceObserver must build at most one mutation summary"
);
assert.match(
  observerBody,
  /const debugMutationSummary = debugEnabled\s*\?\s*nfTopbarHelpSplitMutationSummary\(mutations\)\s*:\s*null/,
  "mutation summary construction must be skipped while debug is disabled"
);
assert.equal(
  count(observerBody, "mutations: debugMutationSummary"),
  3,
  "raw, filtered, and scheduled debug events must reuse the same mutation summary"
);

for (const label of [
  "surfaceObserver:raw",
  "surfaceObserver:skip-running",
  "surfaceObserver:skip-filtered",
  "surfaceObserver:route-inactive",
  "surfaceObserver:scheduleSurfaceSync"
]) {
  assert.match(
    observerBody,
    new RegExp(`nfTopbarHelpSplitDebug\\('${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'[\\s\\S]*?debugEnabled\\)`),
    `${label} must pass the cached debug decision instead of reading storage again`
  );
}

assert.match(
  runtime,
  /function nfTopbarHelpSplitDebug\(label, detail = \{\}, debugEnabled = nfTopbarHelpDebugEnabled\(\)\) \{\s*if \(!debugEnabled\) return/,
  "split debug logging must accept a cached decision while preserving default behavior elsewhere"
);

const runningIndex = observerBody.indexOf("if (surfaceSyncRunning)");
const filterIndex = observerBody.indexOf("mutations.every((mutation) => isPreviewOverlayMutation(mutation) || isBrandTopbarOrProtectedModalMutation(mutation))");
const routeIndex = observerBody.indexOf("if (!isSplitCanvasRouteActive())");
const finalScheduleIndex = observerBody.lastIndexOf("scheduleSurfaceSync()");
assert.ok(
  runningIndex >= 0 && runningIndex < filterIndex && filterIndex < routeIndex && routeIndex < finalScheduleIndex,
  "running guard, mutation filter, inactive-route handling, and final scheduling must keep their order"
);
assert.match(
  observerBody,
  /hideLegacyBoneSplitPanel\(\)[\s\S]*if \(hasSplitWorkspaceSurface\(\)\) scheduleSurfaceSync\(\)[\s\S]*return/,
  "inactive-route cleanup and conditional scheduling must remain unchanged"
);

console.log("PASS split surface debug performance contract");
