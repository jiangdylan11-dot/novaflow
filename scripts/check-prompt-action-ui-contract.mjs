import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function readText(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8").replace(/\r\n/g, "\n");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) {
    throw new Error(`${label}: missing ${needle}`);
  }
}

function assertNotIncludes(text, needle, label) {
  if (text.includes(needle)) {
    throw new Error(`${label}: unexpected ${needle}`);
  }
}

function assertBefore(text, beforeNeedle, afterNeedle, label) {
  const beforeIndex = text.indexOf(beforeNeedle);
  const afterIndex = text.indexOf(afterNeedle);
  if (beforeIndex < 0) {
    throw new Error(`${label}: missing ${beforeNeedle}`);
  }
  if (afterIndex < 0) {
    throw new Error(`${label}: missing ${afterNeedle}`);
  }
  if (beforeIndex > afterIndex) {
    throw new Error(`${label}: ${beforeNeedle} must appear before ${afterNeedle}`);
  }
}

function extractFunctionBody(text, functionName) {
  const marker = `function ${functionName}`;
  const start = text.indexOf(marker);
  if (start < 0) {
    throw new Error(`Runtime contract: missing function ${functionName}`);
  }
  const openBrace = text.indexOf("{", start);
  if (openBrace < 0) {
    throw new Error(`Runtime contract: malformed function ${functionName}`);
  }
  let depth = 0;
  for (let index = openBrace; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(openBrace + 1, index);
    }
  }
  throw new Error(`Runtime contract: unterminated function ${functionName}`);
}

function extractRuntimeSlice(text, startNeedle, endNeedle, label) {
  const start = text.indexOf(startNeedle);
  if (start < 0) {
    throw new Error(`Runtime contract: missing ${label} start`);
  }
  const end = text.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) {
    throw new Error(`Runtime contract: missing ${label} end`);
  }
  return text.slice(start, end);
}

const smartAi = readText("particle-editor/novaflow-smart-ai.js");
const runtime = readText("particle-editor/novaflow-brand-runtime.js");
const runtimeLf = runtime.replace(/\r\n/g, "\n");
const bundlePaths = [
  "particle-editor/assets/index-BbIa-2NM.js",
  "particle-editor-desktop/renderer/assets/index-BbIa-2NM.js",
  "particle-editor-desktop/dist/win-unpacked/resources/app/renderer/assets/index-BbIa-2NM.js"
];
const bundles = bundlePaths.map((filePath) => ({ filePath, text: readText(filePath) }));
const indexPaths = [
  "particle-editor/index.html",
  "particle-editor-desktop/renderer/index.html",
  "particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html"
];
const indexes = indexPaths.map((filePath) => ({ filePath, text: readText(filePath) }));

assertIncludes(smartAi, "NOVAFLOW_PROMPT_ACTION_BUTTON_ATTR", "SmartAI shared prompt action attribute");
assertIncludes(smartAi, "HTMLInputElement", "SmartAI must support Kling storyboard input prompt fields");
assertIncludes(smartAi, "border: 0;", "SmartAI prompt action button must be borderless");
assertIncludes(smartAi, "background: rgba(255, 255, 255, 0.06);", "SmartAI prompt action button must use the neutral grey background");
assertNotIncludes(smartAi, "background: rgba(30, 166, 114, 0.88);", "SmartAI prompt action button normal state must not be green");
assertIncludes(smartAi, "data-novaflow-smart-ai-bound", "SmartAI must bind source-rendered placeholder buttons without reinserting them");
assertIncludes(smartAi, "let button = actions.querySelector(`[${SMART_BUTTON_ATTR}=\"1\"]`);", "SmartAI must reuse source-rendered prompt action buttons");
assertNotIncludes(smartAi, "if (actions.querySelector(`[${SMART_BUTTON_ATTR}=\"1\"]`)) return;", "SmartAI must not skip binding source-rendered prompt action buttons");
assertIncludes(smartAi, "setSmartAiAttributeIfChanged", "SmartAI button mounting must guard repeated attribute writes");
assertIncludes(smartAi, "setSmartAiTextIfChanged", "SmartAI button mounting must guard repeated text writes");
assertNotIncludes(smartAi, 'button.type = "button";', "SmartAI must not rewrite the source-rendered button type on every observer refresh");
assertNotIncludes(smartAi, 'button.textContent = "智能AI";', "SmartAI must not rewrite the source-rendered button text on every observer refresh");
assertIncludes(smartAi, "isSmartAiSelfMutation", "SmartAI observer must recognize its own marker/text mutations");
assertIncludes(smartAi, "mutations.every(isSmartAiSelfMutation)", "SmartAI observer must skip self-triggered mutation batches");
assertIncludes(smartAi, "scheduleSmartAiButtonMount", "SmartAI observer refresh must be RAF-coalesced behind one scheduler");
assertIncludes(runtime, "NOVAFLOW_PROMPT_ACTION_BUTTON_ATTR", "Runtime shared prompt action attribute");
assertIncludes(runtime, "applyNovaflowPromptActionButtonStyle", "Runtime prompt action button style helper");
assertIncludes(runtime, "HTMLInputElement", "Runtime prompt assistant must support Kling storyboard input prompt fields");
assertIncludes(runtime, "background: rgba(255, 255, 255, 0.06)", "Runtime prompt action button must use the neutral grey background");
assertIncludes(runtime, "data-novaflow-ai-storyboard-history", "Runtime must group the Kling storyboard history button with prompt actions");
assertIncludes(runtime, "hideAiAnimationPromptHistorySlotButtons(topRow);", "Runtime must hide inline history slots in prompt headers");
assertIncludes(runtime, "moveAiAnimationStoryboardShotLabelToDurationRow", "Runtime must move storyboard shot labels into the duration row");
assertIncludes(runtime, "commitPrimaryAnimationEntryState", "Runtime must atomically commit animation entry state before first paint");
assertNotIncludes(runtime, "scheduleFullLayoutRefresh([0, 16, 48, 96, 180, 320, 640]);", "Animation primary entry must not depend on a multi-step stable refresh chain");
assertIncludes(runtime, "AI_ANIMATION_SOURCE_OWNED_SETTINGS_MIN_WIDTH", "Runtime must reserve source-owned cloud prompt/settings width");
assertIncludes(runtime, "applyAiAnimationSourceOwnedReferenceMetrics", "Runtime must apply responsive source-owned reference metrics");
assertIncludes(runtime, "commitAiAnimationModelMethodLayoutState", "Runtime must atomically commit model-method layout before first paint");
assertIncludes(runtime, "stabilizeAiAnimationSourceOwnedUploadDropzoneVisuals", "Runtime must stabilize source-owned upload cards inside the final layout pass");
assertIncludes(runtime, "--novaflow-ai-reference-slot-size", "Runtime CSS must expose a source-owned reference slot size variable");
assertIncludes(runtime, "--novaflow-ai-reference-slot-padding", "Runtime CSS must expose a source-owned reference slot padding variable");
assertIncludes(runtime, "width: var(--novaflow-ai-reference-slot-size, var(--novaflow-ai-reference-column-height, 132px)) !important;", "Bottom reference upload slots must use the source-owned slot size variable");
assertIncludes(runtime, "padding: var(--novaflow-ai-reference-slot-padding, 10px) !important;", "Bottom reference upload slots must default to the final source-owned padding");
assertNotIncludes(runtimeLf, '[data-novaflow-ai-reference-column="1"] [data-ais-import] {\n        width: 132px !important;', "Reference-column upload slots must not hard-code 132px width");
assertNotIncludes(runtimeLf, 'div:has([data-ais-import]) [data-ais-import] {\n        width: 132px !important;', "Fallback source-owned upload slots must not hard-code 132px width");
const primaryBottomUploadCss = extractRuntimeSlice(
  runtimeLf,
  'body.novaflow-primary-target-animation:has([data-novaflow-ai-bottom-workspace="1"]) [data-novaflow-ai-bottom-workspace="1"] [data-ais-import],',
  'body.novaflow-primary-target-animation:has([data-novaflow-ai-bottom-workspace="1"]) [data-novaflow-ai-bottom-workspace="1"] [data-ais-import] *,',
  "primary animation bottom upload first-frame CSS"
);
assertIncludes(primaryBottomUploadCss, "padding: var(--novaflow-ai-reference-slot-padding, 10px) !important;", "Primary animation upload cards must have final padding before source-owned markers are added");
assertIncludes(primaryBottomUploadCss, "width: var(--novaflow-ai-reference-slot-size, var(--novaflow-ai-reference-column-height, 132px)) !important;", "Primary animation upload cards must use final slot width before source-owned markers are added");
assertNotIncludes(primaryBottomUploadCss, "width: 132px !important;", "Primary animation upload cards must not paint an intermediate hard-coded width");
assertNotIncludes(primaryBottomUploadCss, "height: 132px !important;", "Primary animation upload cards must not paint an intermediate hard-coded height");
assertIncludes(runtime, '[data-novaflow-source-layout="1"] [data-ais-import] .nf-upload-dropzone__title', "Source-owned upload title must have a stable width rule");
assertIncludes(runtime, "novaflow-art-generate-history-label", "Art history label must stay in the shared button group");
assertIncludes(runtime, "data-novaflow-smart-ai-button", "Animation unified SmartAI entry remains addressable");

const animationPromptAssistantBody = extractFunctionBody(runtime, "ensureAiAnimationPromptAssistantButtons");
assertIncludes(animationPromptAssistantBody, "restoreAiAnimationPromptAssistantExternalButtons", "Runtime must preserve the unified SmartAI button");
assertNotIncludes(animationPromptAssistantBody, "runAiAnimationPromptOptimize", "Runtime must not recreate the legacy local optimize shortcut");
assertNotIncludes(animationPromptAssistantBody, "runAiAnimationReversePrompt", "Runtime must not recreate the legacy local reverse shortcut");
assertNotIncludes(animationPromptAssistantBody, 'createElement("button")', "Runtime must not create extra animation prompt action buttons");

const primaryPreIntentBody = extractFunctionBody(runtime, "bindPrimaryEntryActivationCapture");
assertIncludes(primaryPreIntentBody, "beginPrimaryAnimationEntryTransaction", "Animation primary pre-intent must begin the existing entry transaction");
assertIncludes(primaryPreIntentBody, "replayPrimaryAnimationEntryIntent", "Animation primary pre-intent must replay through the existing transaction owner");
const mutationEntryBody = runtime.slice(runtime.indexOf("const hasAiAnimationEntryFrameMutation"), runtime.indexOf("syncSpineImportDialogFromMutations", runtime.indexOf("const hasAiAnimationEntryFrameMutation")));
assertNotIncludes(mutationEntryBody, "runAiAnimationEntryFirstFrameLayoutSync", "Animation first frame must not be repaired by MutationObserver after an intermediate state");
const modelMethodChangeBody = extractFunctionBody(runtime, "handleAiAnimationModelMethodSelectChange");
assertIncludes(modelMethodChangeBody, "commitAiAnimationModelMethodFirstFrameLayout", "Animation model switch must synchronously commit final layout state");
assertNotIncludes(modelMethodChangeBody, "scheduleAiAnimationStructureRefresh([0, 16, 80, 180, 360, 720, 1200]);", "Animation model switch must not depend on a multi-step stable refresh chain");
const sourceOwnedFinalLayoutBody = extractFunctionBody(runtime, "syncAiAnimationSourceOwnedBottomWorkspaceFinalLayout");
assertIncludes(sourceOwnedFinalLayoutBody, "stabilizeAiAnimationSourceOwnedUploadDropzoneVisuals", "Source-owned final layout must stabilize upload card internals before paint");
const sourceOwnedMetricsBody = extractFunctionBody(runtime, "applyAiAnimationSourceOwnedReferenceMetrics");
assertIncludes(sourceOwnedMetricsBody, 'setStylePropertyIfChanged(referenceColumn, "--novaflow-ai-reference-slot-size", slotSize);', "Source-owned metrics must publish the slot size before nested upload cards render");
assertIncludes(sourceOwnedMetricsBody, 'setStylePropertyIfChanged(referenceColumn, "--novaflow-ai-reference-slot-padding", "10px");', "Source-owned metrics must publish stable upload card padding");
assertIncludes(sourceOwnedMetricsBody, "const isUploadDropzoneRow = row.matches", "Source-owned metrics must distinguish upload cards from reference row containers");
assertIncludes(sourceOwnedMetricsBody, "const rowGap = isUploadDropzoneRow ? NOVAFLOW_UNIFORM_GAP : AI_ANIMATION_REFERENCE_UPLOAD_GAP;", "Source-owned metrics must not apply row spacing to upload card internals");
assertIncludes(sourceOwnedMetricsBody, "gap: `${rowGap}px`", "Source-owned metrics must apply the branched row gap value");
assertIncludes(sourceOwnedMetricsBody, '"flex-direction": "column"', "Source-owned metrics must keep direct upload cards in their final internal column layout");
const sourceOwnedBottomLayoutBody = extractFunctionBody(runtime, "syncAiAnimationSourceOwnedBottomLayout");
assertIncludes(runtime, "AI_ANIMATION_SOURCE_OWNED_LAYOUT_METRICS", "Runtime must keep stable source-owned geometry instead of committing transient upload measurements");
assertIncludes(runtime, "isAiAnimationSourceOwnedLayoutGeometryStable", "Runtime must validate source-owned geometry before writing upload layout offsets");
assertIncludes(sourceOwnedBottomLayoutBody, "commitAiAnimationSourceOwnedReferenceLayout", "Source-owned bottom layout must commit reference geometry through the stable geometry path");
assertNotIncludes(sourceOwnedBottomLayoutBody, 'const offset = Math.round(promptAlignElement.getBoundingClientRect().top - mainRow.getBoundingClientRect().top);', "Source-owned bottom layout must not write raw transient prompt offsets");
const uploadDropzoneNormalizeBody = extractFunctionBody(runtime, "normalizeNovaflowUploadDropzones");
assertIncludes(uploadDropzoneNormalizeBody, "isInsideSourceOwnedLayout(dropzone)", "Generic upload normalization must detect source-owned slots");
assertIncludes(uploadDropzoneNormalizeBody, "stabilizeAiAnimationSourceOwnedUploadDropzoneVisuals(dropzone)", "Generic upload normalization must delegate source-owned slots back to source-owned layout");
assertNotIncludes(uploadDropzoneNormalizeBody, "if (isAiSequenceSourceOwnedBottomReferenceSlot(dropzone)) return;", "Generic upload normalization must not only skip source-owned slots after canonical resolution");
const brandMutationObserverBody = extractFunctionBody(runtime, "startBrandMutationObserver");
assertIncludes(brandMutationObserverBody, "runAiAnimationEarlyStructureLayoutOnce()", "AI animation upload DOM mutations must run early structure before delayed mutation flush");
const promptHistoryCandidateBody = extractFunctionBody(runtime, "isAiAnimationPromptHistoryPopoverCandidate");
const promptHistoryStyleBody = extractFunctionBody(runtime, "styleAiAnimationPromptHistoryPopovers");
const promptHistoryPositionBody = extractFunctionBody(runtime, "positionAiAnimationPromptHistoryPopover");
const hidePromptHistorySlotButtonsBody = extractFunctionBody(runtime, "hideAiAnimationPromptHistorySlotButtons");
const storyboardPromptAssistantBody = extractFunctionBody(runtime, "ensureAiAnimationStoryboardPromptAssistantButtons");
assertIncludes(promptHistoryCandidateBody, 'text.includes("\\u6682\\u65e0")', "Prompt history popover detection must include empty history panels");
assertIncludes(runtime, "prepareAiAnimationPromptHistoryPopoverInPlace", "Runtime must style prompt history popovers without moving React-owned nodes");
assertIncludes(promptHistoryStyleBody, "prepareAiAnimationPromptHistoryPopoverInPlace(popover)", "Prompt history popovers must be prepared in place before viewport positioning");
assertNotIncludes(promptHistoryStyleBody, "promoteAiAnimationPromptHistoryPopover(popover)", "Prompt history popovers must not move React-owned prompt history popovers out of their owner tree");
assertNotIncludes(runtime, "layer.appendChild(popover)", "Runtime must not reparent React-owned prompt history popovers");
assertIncludes(runtime, "getAiAnimationPromptHistoryPositionRect", "Runtime must use a shared positioning rect for Kling storyboard history popovers");
assertIncludes(promptHistoryPositionBody, "getAiAnimationPromptHistoryPositionRect(anchor, popover)", "Prompt history popover positioning must use the shared storyboard rect when available");
assertIncludes(promptHistoryPositionBody, "AI_ANIMATION_PROMPT_HISTORY_POPOVER_MAX_HEIGHT", "Prompt history popover must be allowed to grow to the full 15-row budget");
assertNotIncludes(promptHistoryPositionBody, "Math.min(320,", "Prompt history popover must not clamp its height to 320px, which hides rows beyond the ninth");
assertIncludes(promptHistoryPositionBody, 'contentHeight > height ? "auto" : "hidden"', "Prompt history popover must scroll whenever its rows exceed the available height");
assertIncludes(runtime, "getAiAnimationPromptHistoryInlineSlotControls", "Runtime must scope Kling storyboard slot hiding to the inline slot strip");
assertIncludes(hidePromptHistorySlotButtonsBody, "getAiAnimationPromptHistoryInlineSlotControls(topRow)", "Runtime must not scan the whole top row when hiding inline history slots");
assertNotIncludes(hidePromptHistorySlotButtonsBody, "topRow.querySelectorAll('button, [role=\"button\"]')", "Runtime must not hide prompt history popover descendants from the top row");
assertIncludes(runtime, '.novaflow-app [data-novaflow-ai-storyboard-grid="1"]', "Kling storyboard grid must have data-marker first-frame CSS before body state classes settle");
assertIncludes(runtime, '.novaflow-app [data-novaflow-ai-storyboard-prompt-frame="1"]', "Kling storyboard prompt frames must have data-marker first-frame CSS before body state classes settle");
assertIncludes(runtime, '[data-novaflow-ai-storyboard-history="1"] > div > div[style*="overflow: hidden"]:not([style*="position: fixed"]):not([data-novaflow-ai-history-positioned="1"]) button:not([data-novaflow-prompt-action-button="1"])', "Runtime must pre-hide only Kling storyboard inline history slots before React's first paint");
assertNotIncludes(runtime, '[data-novaflow-ai-storyboard-history="1"] button:not([data-novaflow-prompt-action-button="1"])', "Kling storyboard history pre-hide must not hide real popover content");
assertNotIncludes(storyboardPromptAssistantBody, 'actions.innerHTML = "";', "Runtime must not clear and rebuild source-rendered Kling storyboard action buttons");
assertIncludes(storyboardPromptAssistantBody, "data-novaflow-ai-storyboard-optimize", "Runtime must recognize stale storyboard optimize shortcuts");
assertIncludes(storyboardPromptAssistantBody, "data-novaflow-ai-storyboard-reverse", "Runtime must recognize stale storyboard reverse shortcuts");
assertIncludes(storyboardPromptAssistantBody, "button.remove()", "Runtime must remove stale storyboard shortcut buttons");
assertNotIncludes(storyboardPromptAssistantBody, 'createElement("button")', "Runtime must not recreate storyboard shortcut buttons");
assertNotIncludes(storyboardPromptAssistantBody, "runAiAnimationPromptOptimize", "Storyboard actions must route only through unified SmartAI");
assertNotIncludes(storyboardPromptAssistantBody, "runAiAnimationReversePrompt", "Storyboard reverse must route only through unified SmartAI");

for (const { filePath, text } of indexes) {
  assertIncludes(text, 'id="novaflow-ai-sequence-first-paint-guard"', `${filePath} must include the AI sequence first-paint guard`);
  assertBefore(text, 'id="novaflow-ai-sequence-first-paint-guard"', "assets/index-BbIa-2NM.js", `${filePath} first-paint guard`);
  assertIncludes(text, '[data-novaflow-ai-prompt-grid="1"]:has([data-novaflow-ai-storyboard-grid="1"])', `${filePath} first-paint guard must stabilize the Kling storyboard prompt grid`);
  assertIncludes(text, '[data-novaflow-ai-storyboard-optimize="1"]', `${filePath} first-paint guard must hide the removed storyboard optimize shortcut`);
  assertIncludes(text, '[data-novaflow-ai-storyboard-reverse="1"]', `${filePath} first-paint guard must hide the removed storyboard reverse shortcut`);
  assertIncludes(text, '[data-novaflow-ai-storyboard-reverse="1"] {\n        display: none !important;', `${filePath} removed storyboard shortcuts must be hidden before helper scripts run`);
  assertNotIncludes(text, '[data-novaflow-ai-storyboard-history="1"] > div > div[style*="overflow: hidden"]', `${filePath} first-paint guard must not hide transient history slot buttons now that the source no longer renders them`);
}

for (const { filePath, text } of bundles) {
  assertNotIncludes(text, "children:`\u5206\u955c\u63d0\u793a\u8bcd`", `${filePath} Kling storyboard header label`);
  assertIncludes(text, "data-novaflow-ai-storyboard-history", `${filePath} Kling storyboard prompt history button`);
  assertIncludes(text, "data-novaflow-ai-storyboard-prompt-frame", `${filePath} Kling storyboard prompt frame marker`);
  assertIncludes(text, "data-novaflow-ai-storyboard-prompt-kind", `${filePath} Kling storyboard prompt kind marker`);
  assertIncludes(text, "data-novaflow-ai-storyboard-shot-label", `${filePath} Kling storyboard shot label marker`);
  assertIncludes(text, "data-novaflow-ai-storyboard-duration-row", `${filePath} Kling storyboard duration row marker`);
  assertIncludes(text, "data-novaflow-ai-storyboard-optimize", `${filePath} Kling storyboard optimize action`);
  assertIncludes(text, "data-novaflow-ai-storyboard-reverse", `${filePath} Kling storyboard reverse action`);
  assertIncludes(text, "data-novaflow-smart-ai-button", `${filePath} Kling storyboard must source-render SmartAI before helper scripts run`);
  assertIncludes(text, "children:`AI\\u63d0\\u793a\\u52a9\\u624b`", `${filePath} Kling storyboard must source-render the unified SmartAI label`);
  assertNotIncludes(text, "children:`\\u667a\\u80fdAI`", `${filePath} Kling storyboard must not source-render the legacy SmartAI label`);
  assertNotIncludes(text, "children:`??AI`", `${filePath} Kling storyboard SmartAI placeholder must not contain mojibake text`);
  assertIncludes(text, "display:`inline-flex`,alignItems:`center`,gap:5,position:`static`,zIndex:8,pointerEvents:`auto`,margin:`0 0 0 auto`,flexShrink:0", `${filePath} Kling storyboard action group must source-render the final compact action layout`);
  assertNotIncludes(text, "style:{display:`flex`,alignItems:`center`,justifyContent:`space-between`,gap:8,fontSize:12,fontWeight:900", `${filePath} Kling storyboard header must not paint the old space-between action row`);
  assertIncludes(text, "justifyContent:`flex-start`,gap:5,fontSize:12,fontWeight:900", `${filePath} Kling storyboard header must source-render the final flex-start action row`);
  assertNotIncludes(text, "style:r?{zIndex:6,display:`inline-flex`,alignItems:`center`,gap:0,padding:0,borderBottom:0,height:22,minHeight:22,maxHeight:22,width:`auto`,minWidth:0,overflow:`visible`,boxSizing:`border-box`}", `${filePath} inline prompt history must not globally source-render the Kling compact history footprint`);
  assertIncludes(text, "style:r&&String(e.title||``).includes(`\\u5206\\u955c`)?{zIndex:6,display:`inline-flex`,alignItems:`center`,gap:0,padding:0,borderBottom:0,height:22,minHeight:22,maxHeight:22,width:`auto`,minWidth:0,overflow:`visible`,boxSizing:`border-box`}:r?{zIndex:6,display:`flex`,alignItems:`center`,gap:6,padding:`6px 12px 4px`,borderBottom:`1px solid rgba(255,255,255,0.22)`}", `${filePath} compact inline history footprint must be scoped to storyboard prompts only`);
  assertNotIncludes(text, "children:[(0,X.jsxs)(`span`,{style:{flex:`0 0 auto`},children:[`镜头`,r]}),(0,X.jsx)(`div`,{\"data-novaflow-ai-storyboard-history\"", `${filePath} Kling storyboard shot label must not stay before history in the header`);
  assertIncludes(text, "gap:ze===`cloud`&&ot===`kling`&&Ve===`image_video`?5:10,marginTop:-28,flex:ze===`cloud`&&ot===`kling`&&Ve===`image_video`?`0 0 132px`:`0 0 156px`", `${filePath} Kling prompt grid geometry must keep the current scoped height and gap`);
  assertNotIncludes(text, "style:{display:`grid`,gridTemplateColumns:`minmax(0, 1fr) minmax(0, 1fr)`,gap:5,marginTop:-28,flex:`0 0 132px`,height:132,minHeight:132,maxHeight:132", `${filePath} prompt grid must not globally force the Kling 132px geometry`);
  assertIncludes(text, "flex:`0 0 156px`,height:156,minHeight:156,maxHeight:156,overflow:`visible`", `${filePath} non-storyboard prompt columns must keep their original geometry`);
  assertIncludes(text, "position:`relative`,top:32,transform:`none`", `${filePath} Kling storyboard grid must paint at the settled source-owned offset`);
  assertNotIncludes(text, "transform:`translateY(32px)`", `${filePath} Kling storyboard grid must not rely on a post-paint transform repair`);
  assertNotIncludes(text, "style:{fontSize:12,color:`rgba(255,255,255,0.75)`,whiteSpace:`nowrap`,height:26,minHeight:26,maxHeight:26,lineHeight:`26px`,boxSizing:`border-box`}", `${filePath} non-storyboard prompt titles must not inherit Kling-only fixed title height`);
  for (const slot of ["\u8bb0\u5f551", "\u8bb0\u5f552", "\u8bb0\u5f553", "\u8bb0\u5f554", "\u8bb0\u5f555"]) {
    assertNotIncludes(text, slot, `${filePath} Kling storyboard history slots must not render inline`);
  }
  assertNotIncludes(text, "Array.from({length:5})", `${filePath} inline prompt history must not generate transient record slot buttons`);
  assertNotIncludes(text, "children:`记录${n+1}`", `${filePath} inline prompt history must not render dynamic record slot labels before first paint`);
  assertIncludes(text, "Math.min(528,22+i*30+Math.max(0,i-1)*4)", `${filePath} prompt history popover must size itself for the full 15-row budget of 30px bordered rows`);
  assertNotIncludes(text, "Math.min(320,20+i*28", `${filePath} prompt history popover must not clamp to the old 320px height`);
}

const [firstBundle, ...restBundles] = bundles;
const firstHash = sha256(firstBundle.text);
for (const item of restBundles) {
  const nextHash = sha256(item.text);
  if (nextHash !== firstHash) {
    throw new Error(`bundle mirror drift: ${firstBundle.filePath} ${firstHash} != ${item.filePath} ${nextHash}`);
  }
}

console.log("prompt action UI contract check passed");
