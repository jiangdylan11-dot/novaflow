import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const runtime = readFileSync(
  path.join(root, "particle-editor/spine-split-runtime.js"),
  "utf8",
);

const mergeStart = runtime.indexOf("async function mergeInpaintResult(");
const helperStart = runtime.indexOf("function compositeRemovalRgbResult(", mergeStart);
assert.ok(mergeStart >= 0 && helperStart > mergeStart, "mergeInpaintResult() must precede the Removal RGB helper");
const mergeBody = runtime.slice(mergeStart, helperStart);
assert.match(
  mergeBody,
  /runRmbgCutout\(resultCropCanvas\.toDataURL\('image\/png'\)\)/,
);

const removalStart = runtime.indexOf("async function mergeRemovalInpaintResult(", helperStart);
assert.ok(removalStart > helperStart, "the Removal RGB helper must precede mergeRemovalInpaintResult()");
const helperBody = runtime.slice(helperStart, removalStart);
assert.match(helperBody, /if\s*\(maskPixelValue\(hard\.data,\s*ci\)\s*<=\s*8\)\s*continue/);
assert.match(helperBody, /result\.data\[ci\]/);
assert.match(
  helperBody,
  /finalImage\.data\[fi\s*\+\s*3\]\s*=\s*Math\.max\(\s*originalAlpha\s*,/,
);

const executeStart = runtime.indexOf("async function executeInpaintTool(", removalStart);
assert.ok(executeStart > removalStart, "mergeRemovalInpaintResult() must precede executeInpaintTool()");
const removalBody = runtime.slice(removalStart, executeStart);
assert.match(removalBody, /compositeRemovalRgbResult\s*\(/);
assert.doesNotMatch(removalBody, /runRmbgCutout\s*\(/);
assert.doesNotMatch(removalBody, /qwenRgbWithRmbgAlpha\s*\(/);
assert.match(removalBody, /replacementForPartId\s*:\s*part\.id/);
assert.match(removalBody, /clearedPixels\s*:\s*0/);

console.log("Split Removal result contract passed.");
