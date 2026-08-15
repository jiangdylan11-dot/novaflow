import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modulePath = path.join(repoRoot, "particle-editor", "ai-sequence-frame-mode.js");

assert.ok(existsSync(modulePath), "AI sequence frame-mode module must exist");

await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`);
const frameMode = globalThis.NovaFlowAiSequenceFrameMode;
assert.ok(frameMode, "frame-mode module must expose NovaFlowAiSequenceFrameMode");

assert.equal(
  frameMode.resolveNodeType({
    mode: "cloud",
    provider: "kling",
    genType: "image_video",
    params: { strictFirstFrame: false },
  }),
  "KlingOmniProImageToVideoNode",
  "Kling reference mode must use the Omni image-reference node",
);
assert.equal(
  frameMode.resolveNodeType({
    mode: "cloud",
    provider: "kling",
    genType: "image_video",
    params: { strictFirstFrame: true },
  }),
  "KlingVideoNode",
  "Kling strict mode must use start-frame image-to-video",
);
assert.equal(
  frameMode.resolveNodeType({
    mode: "cloud",
    provider: "jimeng",
    genType: "image_video",
    params: { strictFirstFrame: false },
  }),
  "ByteDance2ReferenceNode",
  "Seedance reference mode must keep the reference node",
);
assert.equal(
  frameMode.resolveNodeType({
    mode: "cloud",
    provider: "jimeng",
    genType: "image_video",
    params: { strictFirstFrame: true },
  }),
  "ByteDance2FirstLastFrameNode",
  "Seedance strict mode must use the optional-last-frame node",
);
assert.equal(
  frameMode.resolveNodeType({
    mode: "cloud",
    provider: "kling",
    genType: "first_last",
    params: { strictFirstFrame: false },
  }),
  "KlingFirstLastFrameNode",
  "first-last generation is inherently strict",
);
assert.equal(frameMode.resolveNodeType({ mode: "local", provider: "kling" }), "");

assert.deepEqual(
  frameMode.computeOutpaintPlan({ width: 1012, height: 1012 }, "16:9"),
  {
    required: true,
    sourceSize: { width: 1012, height: 1012 },
    targetSize: { width: 1920, height: 1080 },
    delta: { top: 34, bottom: 34, left: 454, right: 454 },
    targetRatio: "16:9",
  },
  "square input must expand without crop or scaling to the smallest safe exact 16:9 canvas",
);
assert.deepEqual(
  frameMode.computeOutpaintPlan({ width: 1012, height: 1012 }, "1:1"),
  {
    required: false,
    sourceSize: { width: 1012, height: 1012 },
    targetSize: { width: 1012, height: 1012 },
    delta: { top: 0, bottom: 0, left: 0, right: 0 },
    targetRatio: "1:1",
  },
);
assert.equal(frameMode.computeOutpaintPlan({ width: 1012, height: 800 }, "adaptive").required, false);
assert.equal(frameMode.imageMatchesAspectRatio({ width: 1920, height: 1080 }, "16:9"), true);
assert.equal(frameMode.imageMatchesAspectRatio({ width: 1012, height: 1012 }, "16:9"), false);
assert.throws(
  () => frameMode.computeOutpaintPlan({ width: 4096, height: 4096 }, "16:9"),
  /maximum|4096|pixel/i,
  "an impossible expansion must fail instead of cropping or downscaling the source",
);

console.log("AI sequence frame-mode routing tests passed");
