import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const indexHtml = read("particle-editor/index.html");
const bundle = read("particle-editor/assets/index-BbIa-2NM.js");
const cloudWorkflow = read("particle-editor/ai-sequence-cloud-workflow.js");
const splitRuntime = read("particle-editor/spine-split-runtime.js");
const preload = read("particle-editor-desktop/preload.js");
const main = read("particle-editor-desktop/main.js");
const syncRuntime = read("scripts/sync-runtime.mjs");
const checkRuntime = read("scripts/check-runtime-sync.mjs");
const buildRenderer = read("particle-editor-desktop/scripts/build-renderer.mjs");

for (const scriptName of [
  "ai-sequence-frame-mode.js",
  "ai-sequence-cloud-workflow.js",
  "ai-sequence-outpaint.workflow.js",
]) {
  assert.ok(indexHtml.includes(scriptName), `${scriptName} must load on the source renderer`);
  assert.ok(syncRuntime.includes(scriptName), `${scriptName} must sync to desktop mirrors`);
  assert.ok(checkRuntime.includes(scriptName), `${scriptName} must be hash checked`);
  assert.ok(buildRenderer.includes(scriptName), `${scriptName} must be included in clean renderer builds`);
}

assert.ok(bundle.includes("strictFirstFrame"), "cloud parameters must carry strict-first-frame state");
assert.ok(bundle.includes("首帧一致"), "image-to-video controls must expose the first-frame toggle");
assert.ok(cloudWorkflow.includes("KlingOmniProImageToVideoNode"), "Kling reference workflow must use Omni");
assert.ok(
  cloudWorkflow.includes("NovaFlowAiSequenceFrameMode") && cloudWorkflow.includes("resolveRoute"),
  "workflow submission must consume the same route resolver as pricing",
);
assert.ok(
  bundle.includes("NFAiSeqGetCloudWorkflowV2") && bundle.includes("NFAiSeqPatchCloudWorkflowV2"),
  "the active bundle must delegate cloud template selection and patching through the modular bridge",
);
assert.ok(
  bundle.includes("NovaFlowAiSequenceOutpaintWorkflow") && bundle.includes("prepareStrictFrame"),
  "strict mode must use the modular outpaint workflow",
);
assert.ok(
  bundle.includes("AI_SEQUENCE_SOURCE_CHANGED"),
  "an outpaint completion must be rejected when the selected source changed while it was running",
);
assert.ok(
  bundle.includes("{...e,ts:Date.now(),strictFrame:n}"),
  "strict-frame submission freshness must start after outpaint completes",
);
const generationActionSource = bundle.slice(
  bundle.indexOf('data-novaflow-ai-generation-actions'),
  bundle.indexOf('data-novaflow-ai-generation-progress'),
);
assert.ok(generationActionSource.includes('flex:`0 0 auto`'));
assert.ok(
  !generationActionSource.includes('position:`absolute`'),
  "dynamic credit labels must participate in settings-row layout instead of covering ratio controls",
);
assert.ok(
  read("particle-editor/novaflow-brand-runtime.js").includes('rowChild.querySelector(\'[data-novaflow-ai-generate-button="1"]\')'),
  "Runtime must identify the action container by its stable button marker after pricing changes its text",
);
assert.ok(
  splitRuntime.includes("outpaintImageDataUrl") && splitRuntime.includes("NovaFlowSpineSplitBridge"),
  "the existing outpaint implementation must be exposed through a narrow production bridge",
);
const outpaintBridgeSource = splitRuntime.slice(
  splitRuntime.indexOf("async function outpaintImageDataUrl"),
  splitRuntime.indexOf("function imageOutpaintStateSnapshot"),
);
assert.ok(outpaintBridgeSource.includes("runQwenImageOutpaint"));
assert.ok(outpaintBridgeSource.includes("restoreOriginalRegionToOutpaintResult"));
assert.ok(
  outpaintBridgeSource.includes("preserveOriginalPixels: true"),
  "AI sequence outpaint must request exact restoration of every original pixel",
);
assert.ok(
  splitRuntime.includes("function restoreOriginalRegionExact"),
  "the shared outpaint helper must expose a non-feathered original-region restore path",
);
assert.ok(
  !outpaintBridgeSource.includes("commitImageOutpaintResult"),
  "AI sequence outpaint must return a derived frame without replacing the split-editor source",
);

for (const source of [preload, main]) {
  assert.ok(source.includes("KlingOmniProImageToVideoNode"), "desktop provider detection must recognize Kling Omni");
}

console.log("AI sequence first-frame integration contract passed");
