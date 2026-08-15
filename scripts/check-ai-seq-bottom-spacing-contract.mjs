import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const runtime = read("particle-editor/novaflow-brand-runtime.js");
const bundle = read("particle-editor/assets/index-BbIa-2NM.js");
const index = read("particle-editor/index.html");
const pricing = read("particle-editor/ai-sequence-credit-pricing.js");

assert.ok(
  runtime.includes("const AI_ANIMATION_PANEL_TIMELINE_GAP = 8;"),
  "all AI sequence models and generation modes must share one explicit 8px panel gap",
);
assert.ok(
  runtime.includes("const AI_ANIMATION_GENERATION_INNER_GAP = 8;"),
  "all AI sequence models and generation modes must share one explicit 8px generation-panel inner gap",
);
assert.ok(
  runtime.split('gap: `${AI_ANIMATION_PANEL_TIMELINE_GAP}px`').length - 1 >= 3,
  "shared bottom-workspace layout paths must use the unified panel gap",
);
assert.ok(
  runtime.includes("gap: ${AI_ANIMATION_PANEL_TIMELINE_GAP}px !important;"),
  "the shared Runtime CSS must enforce the same gap for source-owned layouts",
);

const generationHeightStart = runtime.indexOf("function syncAiAnimationGenerationPanelHeight");
const generationHeightEnd = runtime.indexOf("function lockAiAnimationEntryGenerationPanelHeight", generationHeightStart);
assert.ok(generationHeightStart >= 0 && generationHeightEnd > generationHeightStart, "generation-panel height sync must exist");
const generationHeightSource = runtime.slice(generationHeightStart, generationHeightEnd);
assert.ok(
  generationHeightSource.includes("Math.ceil(contentBottom - panelRect.top + AI_ANIMATION_GENERATION_INNER_GAP)"),
  "generation-panel height must preserve the full shared inner gap below its visible content",
);
assert.ok(
  !generationHeightSource.includes("SECONDARY_CONTENT_GAP"),
  "generation-panel inner spacing must not be reduced by an unrelated secondary-content gap",
);
assert.ok(
  runtime.includes("const AI_ANIMATION_PROMPT_GRID_MARGIN_TOP = -28;") &&
    runtime.includes("const AI_ANIMATION_STORYBOARD_GRID_TOP = 32;"),
  "prompt and storyboard offsets must normalize the visible progress-to-content gap",
);
assert.ok(
  runtime.includes("top: ${AI_ANIMATION_STORYBOARD_GRID_TOP}px !important;"),
  "Runtime CSS must apply the shared storyboard alignment offset",
);

const sourceBottomWorkspaceStart = bundle.indexOf('(0,X.jsxs)(`div`,{ref:Ln,"data-preview-ui":`1`,...Y?');
const sourceBottomWorkspaceEnd = bundle.indexOf(',children:[K===`spine`', sourceBottomWorkspaceStart);
assert.ok(
  sourceBottomWorkspaceStart >= 0 && sourceBottomWorkspaceEnd > sourceBottomWorkspaceStart,
  "the source-owned bottom workspace must exist",
);
const sourceBottomWorkspace = bundle.slice(sourceBottomWorkspaceStart, sourceBottomWorkspaceEnd);
assert.ok(
  sourceBottomWorkspace.includes("gap:Y?8:10"),
  "AI sequence source DOM must render the unified 8px gap on its first frame without changing other preview modes",
);
assert.ok(
  bundle.includes("marginTop:20,marginBottom:-6") &&
    bundle.includes("marginTop:-28,flex:") &&
    bundle.includes("position:`relative`,top:32,transform:`none`"),
  "the source first frame must use the same progress, prompt, and storyboard vertical rhythm as Runtime",
);
assert.ok(
  index.includes("index-BbIa-2NM.js?v=20260812-minimax-h3-assistant-1") &&
    index.includes("novaflow-brand-runtime.js?v=20260812-minimax-h3-timing-2"),
  "the active source bundle and Runtime cache keys must publish their current revisions",
);

const visualRhythmStart = runtime.indexOf("function normalizeNovaflowSpacing");
const visualRhythmEnd = runtime.indexOf("function syncAiAnimationModePostSectionSpacing", visualRhythmStart);
assert.ok(visualRhythmStart >= 0 && visualRhythmEnd > visualRhythmStart, "the shared visual-rhythm pass must exist");
const visualRhythmSource = runtime.slice(visualRhythmStart, visualRhythmEnd);
assert.match(
  visualRhythmSource,
  /containers\.forEach\(\(container\) => \{\s*if \(!\(container instanceof HTMLElement\)\) return;\s*if \(isAiAnimationSourceOwnedBottomRhythmNode\(container\)\) return;/,
  "generic visual rhythm must not overwrite source-owned AI sequence spacing after a mode switch",
);

const finalLayoutStart = runtime.indexOf("function syncAiAnimationSourceOwnedBottomWorkspaceFinalLayout");
const finalLayoutEnd = runtime.indexOf("function ensureAiAnimationBottomWorkspaceFromPreviewRoot", finalLayoutStart);
assert.ok(finalLayoutStart >= 0 && finalLayoutEnd > finalLayoutStart, "source-owned final layout must exist");

const finalLayoutSource = runtime.slice(finalLayoutStart, finalLayoutEnd);
assert.ok(
  finalLayoutSource.includes('gap: `${AI_ANIMATION_PANEL_TIMELINE_GAP}px`') &&
    finalLayoutSource.includes('"row-gap": `${AI_ANIMATION_PANEL_TIMELINE_GAP}px`'),
  "source-owned DOM replacements such as first/last-frame mode must restore the unified gap inline",
);
assert.match(
  finalLayoutSource,
  /if\s*\(isAiAnimationPrepaintActive\(\)\)\s*\{\s*lockAiAnimationEntryGenerationPanelHeight\(bottomWorkspace\);\s*\}\s*else\s*\{\s*syncAiAnimationGenerationPanelHeight\(bottomWorkspace\);\s*\}/,
  "settled source-owned layout must measure content height while prepaint keeps the fixed entry height",
);

const actionStart = bundle.indexOf('data-novaflow-ai-generation-actions');
const actionEnd = bundle.indexOf('data-novaflow-ai-generation-progress', actionStart);
assert.ok(actionStart >= 0 && actionEnd > actionStart, "generation action layout must exist");

const actionSource = bundle.slice(actionStart, actionEnd);
assert.ok(actionSource.includes('flex:`0 0 auto`'), "credit label must remain in the settings-row flex layout");
assert.ok(!actionSource.includes('position:`absolute`'), "credit label must not cover settings controls");

const priceLabelEvent = "novaflow:ai-sequence-credit-label-updated";
const applyLabelStart = pricing.indexOf("function applyResolvedLabel");
const applyLabelEnd = pricing.indexOf("function clearRetryState", applyLabelStart);
assert.ok(applyLabelStart >= 0 && applyLabelEnd > applyLabelStart, "resolved credit-label updater must exist");

const applyLabelSource = pricing.slice(applyLabelStart, applyLabelEnd);
assert.ok(
  pricing.includes(`const LABEL_UPDATED_EVENT = "${priceLabelEvent}"`),
  "credit-label event name must remain stable across pricing and Runtime",
);
assert.ok(
  applyLabelSource.includes("LABEL_UPDATED_EVENT") && applyLabelSource.includes("dispatchEvent"),
  "an asynchronously widened credit label must notify the layout Runtime",
);

const modelRefreshBindingStart = runtime.indexOf("function bindAiAnimationModelMethodSelectRefresh");
const modelRefreshBindingEnd = runtime.indexOf("function ", modelRefreshBindingStart + 10);
assert.ok(
  modelRefreshBindingStart >= 0 && modelRefreshBindingEnd > modelRefreshBindingStart,
  "model-method layout binding must exist",
);

const modelRefreshBindingSource = runtime.slice(modelRefreshBindingStart, modelRefreshBindingEnd);
assert.ok(
  modelRefreshBindingSource.includes(priceLabelEvent),
  "the layout Runtime must subscribe to resolved credit-label width changes",
);
assert.ok(
  !modelRefreshBindingSource.includes("scheduleAiAnimationStructureRefresh"),
  "credit-label spacing repair must not enter the heavy structure-refresh queue",
);

console.log("AI sequence bottom spacing contract passed");
