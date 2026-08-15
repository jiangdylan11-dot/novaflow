#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const toolPath = "particle-editor/resource-mention.tool.js";
if (!existsSync(toolPath)) throw new Error("resource mention tool is missing");

const source = readFileSync(toolPath, "utf8");
const runtime = readFileSync("particle-editor/novaflow-brand-runtime.js", "utf8");
const window = {};
const context = vm.createContext({ window, console, setTimeout, clearTimeout });
vm.runInContext(source, context, { filename: toolPath });

const tool = window.NovaFlowResourceMentionTool;
if (!tool || typeof tool.compileText !== "function") throw new Error("compileText API is missing");
if (typeof tool.protectText !== "function" || typeof tool.restoreText !== "function") {
  throw new Error("mention token protection API is missing");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} missing: ${needle}`);
}

function extractFunctionDeclaration(sourceText, name) {
  const start = sourceText.indexOf(`  function ${name}(`);
  if (start < 0) return "";
  const braceStart = sourceText.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < sourceText.length; index += 1) {
    if (sourceText[index] === "{") depth += 1;
    if (sourceText[index] === "}") {
      depth -= 1;
      if (depth === 0) return sourceText.slice(start, index + 1);
    }
  }
  return "";
}

[
  'editor.setAttribute("data-novaflow-runtime-ignore", "1")',
  'menu.setAttribute("data-novaflow-runtime-ignore", "1")',
  'errorPortal.setAttribute("data-novaflow-runtime-ignore", "1")'
].forEach((needle) => assertIncludes(source, needle, "resource mention Runtime isolation"));

const signatureSource = extractFunctionDeclaration(source, "resourceMentionRenderSignature");
assert(signatureSource, "resource mention render signature helper is missing");
const signatureContext = vm.createContext({
  JSON,
  normalizeSurface: (value) => String(value || "").trim().toLowerCase(),
  stringValue: (value) => value == null ? "" : String(value)
});
vm.runInContext(`${signatureSource}\nthis.signatureForTest = resourceMentionRenderSignature;`, signatureContext);
const descriptor = {
  key: "ref_image",
  label: "参考图1",
  alias: "@参考图1",
  kind: "image",
  occupied: true,
  previewUrl: "blob:first",
  fileName: "first.png",
  modelLabel: "@Image 1"
};
const signatureA = signatureContext.signatureForTest("seedance", "使用@参考图1", [descriptor]);
const signatureB = signatureContext.signatureForTest("seedance", "使用@参考图1", [{ ...descriptor }]);
const signatureC = signatureContext.signatureForTest("seedance", "使用@参考图1", [{ ...descriptor, previewUrl: "blob:second" }]);
assert(signatureA === signatureB, "unchanged render state must keep one signature");
assert(signatureA !== signatureC, "preview changes must invalidate the render signature");

const renderSource = extractFunctionDeclaration(source, "renderController");
assert(
  renderSource.indexOf("signature === controller.renderSignature") >= 0 &&
    renderSource.indexOf("signature === controller.renderSignature") < renderSource.indexOf("clearElement(controller.editor)"),
  "unchanged render must return before editor DOM is cleared"
);

assertIncludes(
  runtime,
  "function aiSequenceSeedanceResourceMentionSnapshot(",
  "Seedance six-slot resource snapshot"
);
assertIncludes(
  runtime,
  "function mountAiSequenceSeedanceResourceMentionTextarea(",
  "Seedance mention editor mount bridge"
);
assertIncludes(
  runtime,
  "function compileAiSequenceSeedancePromptMentions(",
  "Seedance prompt compiler bridge"
);
assertIncludes(
  runtime,
  "function patchAiSequenceSeedanceResourceMentionsPromptObject(",
  "Seedance compile-before-submit bridge"
);
assertIncludes(
  runtime,
  "mountAiSequenceSeedanceResourceMentionTextarea(promptFrames);",
  "Seedance prompt mount call"
);
assertIncludes(
  runtime,
  "Seedance \\u8d44\\u6e90\\u5f15\\u7528\\u5df2\\u5931\\u6548",
  "invalid Seedance mention submission guard"
);
assertIncludes(
  runtime,
  "protectAiAnimationResourceMentions(",
  "AI sequence prompt optimize mention protection"
);
assertIncludes(
  runtime,
  "restoreAiAnimationResourceMentions(",
  "AI sequence prompt optimize mention restore validation"
);
assertIncludes(source, "function handleSeedanceSubmissionCapture(", "Seedance invalid mention click guard");
assertIncludes(source, "function isSeedanceGenerateButton(", "Seedance generate-button scope guard");
assertIncludes(source, "event.stopImmediatePropagation()", "invalid mention submission propagation stop");
assertIncludes(source, "资源引用已失效: ", "invalid mention user-visible error");
assertIncludes(source, "function commitBackingChange(", "native textarea blur commit bridge");
assertIncludes(source, "function pruneDisconnectedControllers(", "disconnected editor lifecycle cleanup");
assertIncludes(source, "pruneDisconnectedControllers();", "mount-time disconnected editor pruning");
assertIncludes(
  source,
  'handlers.focus = function () {\n      clearSubmissionError(controller);',
  "stale submission error cleanup on editor refocus"
);
const clearErrorStart = source.indexOf("  function clearSubmissionError(");
const clearErrorEnd = source.indexOf("  function showSubmissionError(", clearErrorStart);
assert(clearErrorStart >= 0 && clearErrorEnd > clearErrorStart, "submission error cleanup source is missing");
const clearErrorSource = source.slice(clearErrorStart, clearErrorEnd);
assert(
  clearErrorSource.includes('querySelectorAll(".nf-resource-mention-error")'),
  "submission error cleanup must remove stale portals left by a replaced controller"
);
const writeBackingStart = source.indexOf("  function writeBackingValue(");
const writeBackingEnd = source.indexOf("  function positionEditor(", writeBackingStart);
assert(writeBackingStart >= 0 && writeBackingEnd > writeBackingStart, "writeBackingValue source is missing");
const writeBackingSource = source.slice(writeBackingStart, writeBackingEnd);
assert(writeBackingSource.includes('dispatchTextareaEvent(textarea, "input")'), "editing must dispatch native input");
assert(!writeBackingSource.includes('dispatchTextareaEvent(textarea, "change")'), "editing must not commit change history per keystroke");
const syncBackingStart = source.indexOf("  function syncEditorToBacking(");
const syncBackingEnd = source.indexOf("  function handleEditorKeyDown(", syncBackingStart);
assert(syncBackingStart >= 0 && syncBackingEnd > syncBackingStart, "editor-to-backing sync source is missing");
const syncBackingSource = source.slice(syncBackingStart, syncBackingEnd);
assert(
  syncBackingSource.indexOf("clearSubmissionError(controller)") < syncBackingSource.indexOf("writeBackingValue(controller"),
  "stale submission errors must clear before React backing input can replace the controller"
);

const seedanceResources = [
  { key: "ref_image", label: "参考图1", kind: "image", occupied: true },
  { key: "jimeng_image2_ref", label: "参考图2", kind: "image", occupied: false },
  { key: "jimeng_image3_ref", label: "参考图3", kind: "image", occupied: true },
  { key: "jimeng_image4_ref", label: "参考图4", kind: "image", occupied: false },
  { key: "jimeng_video_ref", label: "视频参考", kind: "video", occupied: true },
  { key: "jimeng_audio_ref", label: "声音参考", kind: "audio", occupied: true }
];

const seedance = tool.compileText({
  text: "让@参考图3中的人物参考@视频参考并使用@声音参考",
  surface: "seedance",
  resources: seedanceResources
});
assert(
  seedance.text === "让@Image 2中的人物参考@Video 1并使用@Audio 1",
  `Seedance compiled text mismatch: ${seedance.text}`
);
assert(seedance.invalidTokens.length === 0, "valid Seedance tokens must not be invalid");

const invalid = tool.compileText({
  text: "使用@参考图2",
  surface: "seedance",
  resources: seedanceResources
});
assert(invalid.invalidTokens.length === 1, "empty Seedance slot must be invalid");
assert(invalid.invalidTokens[0] === "@参考图2", "invalid token must stay readable");

const artResources = [
  { key: "art_reference_1", label: "参考图1", kind: "image", occupied: false },
  { key: "art_reference_2", label: "参考图2", kind: "image", occupied: true },
  { key: "art_reference_3", label: "参考图3", kind: "image", occupied: true }
];
const art = tool.compileText({
  text: "保留@参考图2的人物，采用@参考图3的服装",
  surface: "art-generate",
  resources: artResources
});
assert(art.text === "保留图1的人物，采用图2的服装", `Art compiled text mismatch: ${art.text}`);

const original = "让@参考图1向@参考图3移动";
const protection = tool.protectText(original);
assert(protection.text !== original && protection.tokens.length === 2, "mentions must be protected");
const restored = tool.restoreText(protection.text, protection);
assert(restored.ok && restored.text === original, "protected mentions must restore exactly");
const broken = tool.restoreText(protection.text.replace(protection.tokens[0].placeholder, ""), protection);
assert(!broken.ok, "missing protected placeholder must reject the result");

const seedancePatchStart = runtime.indexOf("  function patchAiSequenceSeedanceResourceMentionsPromptObject(");
const seedancePatchEnd = runtime.indexOf("  function getAiSequenceWanPromptPayloadPrompt(", seedancePatchStart);
assert(seedancePatchStart >= 0 && seedancePatchEnd > seedancePatchStart, "Seedance submit patch source is missing");
const validPatchContext = vm.createContext({
  compileAiSequenceSeedancePromptMentions: () => ({
    text: "让@Image 1移动",
    mentions: [{ key: "ref_image" }],
    invalidTokens: []
  })
});
vm.runInContext(
  `${runtime.slice(seedancePatchStart, seedancePatchEnd)}\nthis.patchSeedanceForTest = patchAiSequenceSeedanceResourceMentionsPromptObject;`,
  validPatchContext
);
const seedanceWorkflow = {
  "360": { class_type: "ByteDance2ReferenceNode", inputs: { "model.prompt": "让@参考图1移动" } }
};
assert(validPatchContext.patchSeedanceForTest(seedanceWorkflow) === 1, "Seedance submit patch must report one compiled mention");
assert(seedanceWorkflow["360"].inputs["model.prompt"] === "让@Image 1移动", "Seedance workflow did not receive compiled prompt");
const invalidPatchContext = vm.createContext({
  compileAiSequenceSeedancePromptMentions: () => ({
    text: "使用@参考图2",
    mentions: [],
    invalidTokens: ["@参考图2"]
  })
});
vm.runInContext(
  `${runtime.slice(seedancePatchStart, seedancePatchEnd)}\nthis.patchSeedanceForTest = patchAiSequenceSeedanceResourceMentionsPromptObject;`,
  invalidPatchContext
);
let invalidSubmitError = null;
try {
  invalidPatchContext.patchSeedanceForTest({
    "360": { class_type: "ByteDance2ReferenceNode", inputs: { "model.prompt": "使用@参考图2" } }
  });
} catch (error) {
  invalidSubmitError = error;
}
assert(
  invalidSubmitError && /Seedance 资源引用已失效/.test(String(invalidSubmitError.message || invalidSubmitError)),
  "invalid Seedance mention must block workflow submission"
);

console.log("PASS shared resource mention contract");
