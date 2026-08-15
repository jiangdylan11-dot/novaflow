import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const bundlePath = path.join(repoRoot, "particle-editor", "assets", "index-BbIa-2NM.js");
const runtimePath = path.join(repoRoot, "particle-editor", "novaflow-brand-runtime.js");

const bundle = fs.readFileSync(bundlePath, "utf8");
const runtime = fs.readFileSync(runtimePath, "utf8");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const bottomStart = bundle.indexOf('"data-novaflow-ai-bottom-main-row"');
const progressStart = bundle.indexOf('"data-novaflow-ai-generation-progress"', bottomStart);
assert(bottomStart >= 0 && progressStart > bottomStart, "AI sequence bottom workspace fragment must be locatable");

const bottomFragment = bundle.slice(bottomStart, progressStart);

assert(!bottomFragment.includes("width:45"), "AI sequence bottom controls must not render 45px number inputs before runtime normalization");
assert(!bottomFragment.includes("minWidth:45"), "AI sequence bottom controls must not render 45px minWidth before runtime normalization");
assert(!bottomFragment.includes("maxWidth:45"), "AI sequence bottom controls must not render 45px maxWidth before runtime normalization");
assert(!bottomFragment.includes("?`386px`"), "Seedance reference width must not be hard-coded to one viewport");
assert(!bottomFragment.includes("?`396px`"), "Seedance reference offset must not be hard-coded to one viewport");
assert(
  !bottomFragment.includes("ot===`kling`&&Ve===`image_video`?79"),
  "Kling cloud reference column must share the Seedance vertical anchor on the first rendered frame"
);

assert(
  runtime.includes('function commitAiAnimationModelMethodFirstFrameLayout'),
  "Runtime must expose a synchronous first-frame model layout commit"
);
assert(
  runtime.includes('data-novaflow-ai-model-method="jimeng"') &&
    runtime.includes('data-novaflow-ai-model-method="kling"'),
  "Runtime CSS must provide model-specific first-frame reference offsets"
);
assert(
  !/data-novaflow-ai-model-method="kling"[\s\S]{0,260}margin-top:\s*79px/.test(runtime),
  "Runtime CSS must not anchor Kling reference column 4px above Seedance"
);
assert(
  /data-novaflow-ai-model-method="kling"[\s\S]{0,260}margin-top:\s*83px/.test(runtime) &&
    /data-novaflow-ai-model-method="jimeng"[\s\S]{0,260}margin-top:\s*83px/.test(runtime),
  "Runtime CSS must give Kling and Seedance the same cloud reference column vertical anchor"
);

const aiStateToggleCssStart = runtime.indexOf(".novaflow-app [data-novaflow-ai-state-toggle] > [data-novaflow-ai-state-toggle-knob");
const aiStateToggleCssEnd = runtime.indexOf(".novaflow-app [data-novaflow-ai-state-toggle=\"on\"]", aiStateToggleCssStart);
const aiStateToggleCss =
  aiStateToggleCssStart >= 0 && aiStateToggleCssEnd > aiStateToggleCssStart
    ? runtime.slice(aiStateToggleCssStart, aiStateToggleCssEnd)
    : "";
assert(aiStateToggleCss.includes("transition: none !important"), "AI sequence switch knob CSS must not animate between on/off states");

const aiStateToggleRuntimeStart = runtime.indexOf("function styleAiAnimationBottomActionButtons");
const aiStateToggleRuntime =
  aiStateToggleRuntimeStart >= 0
    ? runtime.slice(aiStateToggleRuntimeStart, aiStateToggleRuntimeStart + 8000)
    : "";
assert(aiStateToggleRuntime.includes('transition: "none"'), "Runtime switch knob inline style must not animate between on/off states");

const referenceNormalizeStart = runtime.indexOf("function normalizeAiAnimationReferenceColumnPosition");
const referenceNormalizeRuntime =
  referenceNormalizeStart >= 0
    ? runtime.slice(referenceNormalizeStart, referenceNormalizeStart + 3200)
    : "";
assert(
  referenceNormalizeRuntime.includes("getAiAnimationSourceOwnedReferenceOffset"),
  "Reference column visual-rhythm normalization must reuse the cloud-model vertical anchor normalization"
);
assert(
  !referenceNormalizeRuntime.includes('referenceColumn.style.setProperty("margin-top", `${offset}px`, "important")'),
  "Reference column visual-rhythm normalization must not write raw measured Kling storyboard offset"
);

if (!process.exitCode) {
  console.log("PASS AI sequence first-frame layout contract");
}
