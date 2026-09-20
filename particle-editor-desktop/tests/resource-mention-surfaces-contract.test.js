const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

// @ resource mentions: the prompt editor modal and the AI sequence 图生视频 / 首尾帧视频 prompts share
// the mention surfaces, and the global dropdown controller must leave the mention menu alone (adopting
// it deactivated the whole art-generate workspace when the user clicked back into the prompt).
const repoRoot = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n?/g, "\n");

const CACHE_VERSION = "20260916-mention-surfaces-2";
// The CSS did not change in the second round; only the scripts moved to the new key.
const CSS_CACHE_VERSION = "20260916-mention-surfaces-1";
// The brand runtime and Smart AI each moved on again; the mention tool and its CSS stay on -2.
const BRAND_CACHE_VERSION = "20260920-art-prompt-guard-1";
const SMART_AI_CACHE_VERSION = "20260920-director-leak-guard-1";

function loadMentionTool() {
  const source = read("particle-editor/resource-mention.tool.js");
  const context = { console };
  context.window = context;
  vm.runInNewContext(source, context);
  return context.NovaFlowResourceMentionTool;
}

function loadMentionInternals() {
  const source = read("particle-editor/resource-mention.tool.js");
  const marker = "  window.NovaFlowResourceMentionTool = Object.freeze({";
  assert.ok(source.includes(marker));
  const context = { console };
  context.window = context;
  vm.runInNewContext(
    source.replace(marker, "  window.__mentionInternals = { currentMentionTrigger, migrateLegacyAliases, buildResourceView };\n" + marker),
    context,
  );
  return context.__mentionInternals;
}

test("the global dropdown controller never adopts runtime-owned popovers such as the mention menu", () => {
  const source = read("particle-editor/novaflow-brand-runtime.js");
  const start = source.indexOf("function getVisibleCustomDropdownPanels()");
  assert.ok(start >= 0);
  const body = source.slice(start, source.indexOf("\n  }\n", start));
  assert.match(body, /if \(node\.closest\('\[data-novaflow-runtime-ignore="1"\], \.nf-resource-mention-menu'\)\) return false;/);
  // The mention menu itself is marked as runtime-owned.
  const tool = read("particle-editor/resource-mention.tool.js");
  assert.match(tool, /menu\.className = "nf-resource-mention-menu";[\s\S]{0,200}menu\.setAttribute\("data-novaflow-runtime-ignore", "1"\);/);
});

test("mention tool exposes H3 frame surfaces with display aliases the H3 prompt workflow accepts", () => {
  const tool = loadMentionTool();
  const h3Workflow = read("particle-editor/ai-sequence-minimax-h3-prompt.workflow.js");
  // The aliases used for the frame slots must be accepted by the H3 workflow alias lists.
  assert.match(h3Workflow, /'@\\u9996\\u5e27', '@\\u53c2\\u8003\\u56fe', '@\\u56fe\\u72471'/);
  assert.match(h3Workflow, /'@\\u5c3e\\u5e27', '@\\u7ed3\\u675f\\u5e27', '@\\u56fe\\u72472'/);

  const imageVideo = tool.compileText({
    text: "让@参考图缓慢转身",
    surface: "minimax_h3_image_video",
    resources: [{ key: "first_frame", occupied: true, previewUrl: "data:image/png;base64,x" }],
  });
  assert.deepEqual([...imageVideo.invalidTokens], []);
  assert.equal(imageVideo.mentions.length, 1);
  assert.equal(imageVideo.mentions[0].key, "first_frame");

  const firstLast = tool.compileText({
    text: "从@首帧过渡到@尾帧",
    surface: "minimax_h3_first_last",
    resources: [
      { key: "first_frame", occupied: true, previewUrl: "data:image/png;base64,a" },
      { key: "last_frame", occupied: true, previewUrl: "data:image/png;base64,b" },
    ],
  });
  assert.deepEqual([...firstLast.invalidTokens], []);
  assert.deepEqual(Array.from(firstLast.mentions, (mention) => mention.key), ["first_frame", "last_frame"]);

  const missingLast = tool.compileText({
    text: "从@首帧过渡到@尾帧",
    surface: "minimax_h3_first_last",
    resources: [{ key: "first_frame", occupied: true, previewUrl: "data:image/png;base64,a" }],
  });
  assert.deepEqual([...missingLast.invalidTokens], ["@尾帧"]);

  // Existing surfaces keep their numbered aliases and "@参考图" never swallows "@参考图1".
  const multi = tool.compileText({
    text: "保留@参考图1的人物",
    surface: "minimax_h3",
    resources: [{ key: "ref_image", occupied: true, previewUrl: "data:image/png;base64,a" }],
  });
  assert.deepEqual([...multi.invalidTokens], []);
  assert.equal(multi.mentions[0].key, "ref_image");
  const protection = tool.protectText("@首帧 与 @参考图1 与 @参考图 与 @尾帧");
  assert.equal(protection.tokens.length, 4);
  assert.deepEqual(Array.from(protection.tokens, (token) => token.token), ["@首帧", "@参考图1", "@参考图", "@尾帧"]);
  assert.equal(tool.restoreText(protection.text, protection).text, "@首帧 与 @参考图1 与 @参考图 与 @尾帧");
});

test("mention menu Escape does not bubble to a surrounding dialog", () => {
  const source = read("particle-editor/resource-mention.tool.js");
  assert.match(source, /if \(event\.key === "Escape"\) \{\n\s+\/\/[^\n]*\n\s+event\.preventDefault\(\);\n\s+event\.stopPropagation\(\);\n\s+closeMenu\(controller\);\n\s+return;\n\s+\}/);
  const css = read("particle-editor/resource-mention.tool.css");
  // The menu and its error tip layer above the prompt editor modal (MODAL_LAYER_Z_INDEX + 8).
  assert.match(css, /\.nf-resource-mention-menu \{\n\s+position: fixed;\n\s+z-index: 2147483647;/);
  assert.match(css, /\.nf-resource-mention-error \{\n\s+position: fixed;\n\s+z-index: 2147483647;/);
});

test("AI sequence mounts the mention surface for 多参视频, 图生视频 and 首尾帧视频", () => {
  const source = read("particle-editor/novaflow-brand-runtime.js");
  assert.match(source, /function resolveAiSequenceMiniMaxH3ResourceMentionSurface\(\)/);
  assert.match(source, /if \(activeModeLabel === "\\u591a\\u53c2\\u89c6\\u9891"\) \{\n\s+return \{ surface: "minimax_h3", getResources: aiSequenceMiniMaxH3ResourceMentionSnapshot \};/);
  assert.match(source, /if \(activeModeLabel === "\\u56fe\\u751f\\u89c6\\u9891"\) \{\n\s+return \{ surface: "minimax_h3_image_video"/);
  assert.match(source, /if \(activeModeLabel === "\\u9996\\u5c3e\\u5e27\\u89c6\\u9891"\) \{\n\s+return \{ surface: "minimax_h3_first_last"/);
  assert.match(source, /image_video: Object\.freeze\(\[\n\s+Object\.freeze\(\{ key: "first_frame", label: "\\u53c2\\u8003\\u56fe", domKinds: Object\.freeze\(\["\\u53c2\\u8003\\u56fe", "\\u9996\\u5e27"\]\), family: "image" \}\)/);
  assert.match(source, /first_last: Object\.freeze\(\[\n\s+Object\.freeze\(\{ key: "first_frame", label: "\\u9996\\u5e27"[^\n]*\n\s+Object\.freeze\(\{ key: "last_frame", label: "\\u5c3e\\u5e27"/);
  const mount = source.slice(source.indexOf("function mountAiSequenceMiniMaxH3ResourceMentionTextarea(promptFrames)"));
  const mountBody = mount.slice(0, mount.indexOf("\n  }\n"));
  assert.match(mountBody, /const resolved = resolveAiSequenceMiniMaxH3ResourceMentionSurface\(\);/);
  assert.match(mountBody, /surface: resolved\.surface,\n\s+getResources: resolved\.getResources/);
  assert.doesNotMatch(mountBody, /activeModeLabel !== /);
});

test("the prompt editor modal mounts the same mention surface as the prompt it edits", () => {
  const source = read("particle-editor/novaflow-brand-runtime.js");
  assert.match(source, /function resolveAiAnimationPromptEditorMentionSurface\(frame\)/);
  assert.match(source, /if \(kind === "negative" \|\| ART_GENERATE_STATE\.mode !== "img2img"\) return null;\n\s+return \{ surface: "art-generate", getResources: artGenerateResourceMentionSnapshot \};/);
  assert.match(source, /if \(kind && kind !== "positive"\) return null;\n\s+return resolveAiSequenceMiniMaxH3ResourceMentionSurface\(\);/);
  assert.match(source, /function mountAiAnimationPromptEditorMention\(frame, textarea\)/);
  const modal = source.slice(source.indexOf("function openAiAnimationPromptEditorModal(frame)"));
  const modalBody = modal.slice(0, modal.indexOf("\n  }\n"));
  assert.match(modalBody, /const mentionHandle = mountAiAnimationPromptEditorMention\(frame, textarea\);/);
  assert.match(modalBody, /const close = \(\) => \{\n\s+if \(mentionHandle && typeof mentionHandle\.unmount === "function"\) \{/);
  assert.match(modalBody, /setAiAnimationPromptEditorControlValue\(control, textarea\.value\);/);
  // The caret is parked after the text; the plain focus path stays as the fallback.
  assert.match(modalBody, /mentionHandle\.focus\(\{ caret: "end" \}\)\) return;\n\s+const editor = mentionHandle\?\.editor;/);
  assert.match(modalBody, /if \(editor instanceof HTMLElement && editor\.isConnected\) editor\.focus\(\);\n\s+else textarea\.focus\(\);/);
});

test("the Smart AI prompt editor (art surface) mounts the same mention surface through the bridge", () => {
  const brand = read("particle-editor/novaflow-brand-runtime.js");
  assert.match(brand, /promptEditorApi\.mountMentionForControl = \(control, textarea\) => \{/);
  assert.match(brand, /return mountAiAnimationPromptEditorMention\(frame, textarea\);/);
  const smartAi = read("particle-editor/novaflow-smart-ai.js");
  const start = smartAi.indexOf("function openSmartAiPromptEditor(control, titleText");
  const body = smartAi.slice(start, smartAi.indexOf("\n  }\n", start));
  assert.match(body, /mentionHandle = promptEditorBridge\.mountMentionForControl\(control, textarea\) \|\| null;/);
  assert.match(body, /const close = \(\) => \{\n\s+if \(mentionHandle && typeof mentionHandle\.unmount === "function"\) \{/);
  assert.match(body, /setTextareaValue\(control, textarea\.value\);/);
  assert.match(body, /mentionHandle\.focus\(\{ caret: "end" \}\)\) return;\n\s+const editor = mentionHandle && mentionHandle\.editor;/);
  assert.match(body, /if \(editor instanceof HTMLElement && editor\.isConnected\) editor\.focus\(\);\n\s+else textarea\.focus\(\);/);
});

test("the mention menu never opens for an @ that sits after the caret", () => {
  const internals = loadMentionInternals();
  const controller = {
    descriptors: internals.buildResourceView("art-generate", [{ key: "art_reference_1", occupied: true }]),
  };
  // A freshly focused editor parks the caret at 0: a leading "@参考图1" is not a trigger there.
  assert.equal(internals.currentMentionTrigger(controller, "@参考图1 的人物", 0), null);
  // Right after a complete alias nothing opens either.
  assert.equal(internals.currentMentionTrigger(controller, "@参考图1", 5), null);
  // Right after a bare "@" the menu opens with an empty query.
  assert.deepEqual({ ...internals.currentMentionTrigger(controller, "让@", 2) }, { start: 1, end: 2, query: "" });
  assert.deepEqual({ ...internals.currentMentionTrigger(controller, "让@参", 3) }, { start: 1, end: 3, query: "参" });
});

test("the H3 first-frame alias follows its slot across 图生视频 and 首尾帧视频", () => {
  const internals = loadMentionInternals();
  const events = [];
  const documentRef = {
    defaultView: {},
    createEvent() { return { initEvent(type) { this.type = type; } }; },
  };
  const textarea = {
    value: "让@参考图 转身",
    selectionStart: 5,
    selectionEnd: 5,
    ownerDocument: documentRef,
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    dispatchEvent(event) { events.push(event.type); return true; },
  };
  const controller = { textarea, document: documentRef, writingBacking: false };
  const firstLast = internals.buildResourceView("minimax_h3_first_last", [{ key: "first_frame", occupied: true }]);
  const imageVideo = internals.buildResourceView("minimax_h3_image_video", [{ key: "first_frame", occupied: true }]);
  assert.deepEqual([...firstLast[0].legacyAliases], ["@参考图"]);
  assert.deepEqual([...imageVideo[0].legacyAliases], ["@首帧"]);

  // 图生视频 -> 首尾帧视频: the caret that sat after "@参考图" now sits after "@首帧".
  assert.equal(internals.migrateLegacyAliases(controller, firstLast), true);
  assert.equal(textarea.value, "让@首帧 转身");
  assert.equal(textarea.selectionStart, 4);
  assert.deepEqual(events, ["input"]);
  assert.equal(internals.migrateLegacyAliases(controller, firstLast), false, "migration is idempotent");

  // 首尾帧视频 -> 图生视频.
  assert.equal(internals.migrateLegacyAliases(controller, imageVideo), true);
  assert.equal(textarea.value, "让@参考图 转身");

  // Numbered aliases belong to 多参视频 and stay untouched; the legacy boundary is digit-aware.
  textarea.value = "@参考图1 与 @参考图";
  textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  assert.equal(internals.migrateLegacyAliases(controller, firstLast), true);
  assert.equal(textarea.value, "@参考图1 与 @首帧");
  assert.equal(textarea.selectionStart, textarea.value.length);

  // Surfaces without legacy aliases never rewrite.
  assert.equal(internals.migrateLegacyAliases(controller, internals.buildResourceView("minimax_h3", [])), false);
  assert.equal(internals.migrateLegacyAliases(controller, internals.buildResourceView("art-generate", [])), false);

  // renderController migrates before it reads the selection.
  const source = read("particle-editor/resource-mention.tool.js");
  assert.match(source, /const descriptors = controllerResources\(controller\);\n(?:\s+\/\/[^\n]*\n)*\s+const migrated = migrateLegacyAliases\(controller, descriptors\);\n\s+const selection = migrated\n\s+\? backingSelection\(controller\)\n\s+: requestedSelection \|\| \(hadFocus \? editorSelection\(controller\) : null\);/);
});

test("the mention menu re-stacks above same-z-index overlays and hosts can park the caret at the end", () => {
  const source = read("particle-editor/resource-mention.tool.js");
  // The prompt editor modal (MODAL_LAYER_Z_INDEX + 8) clamps to the menu's z-index, so DOM order decides.
  assert.match(source, /const menu = ensureMenu\(controller\.document\);\n(?:\s+\/\/[^\n]*\n)*\s+const body = controller\.document\.body;\n\s+if \(body && menu\.parentNode === body && body\.lastElementChild !== menu\) body\.appendChild\(menu\);/);
  assert.match(source, /focus: function \(options\) \{ return focusEditor\(controller, options\); \},/);
  assert.match(source, /if \(settings\.caret === "end"\) \{\n\s+const end = stringValue\(controller\.textarea\.value\)\.length;\n\s+setEditorSelection\(controller, \{ start: end, end: end \}\);\n\s+updateMenuFromCaret\(controller\);/);
});

test("index.html cache-busts the mention surface files", () => {
  const html = read("particle-editor/index.html");
  const expected = {
    "novaflow-brand-runtime.js": BRAND_CACHE_VERSION,
    "resource-mention.tool.js": CACHE_VERSION,
    "resource-mention.tool.css": CSS_CACHE_VERSION,
    "novaflow-smart-ai.js": SMART_AI_CACHE_VERSION,
  };
  for (const [fileName, version] of Object.entries(expected)) {
    assert.ok(html.includes(`${fileName}?v=${version}`), `${fileName} should cache-bust with ${version}`);
  }
  const tool = read("particle-editor/resource-mention.tool.js");
  assert.match(tool, /const RESOURCE_MENTION_TOOL_VERSION = "20260916-mention-surfaces-2";/);
});

// The overlay is what the user reads; the textarea under it is aria-hidden. React commits a picked
// history entry by writing textarea.value directly, which fires no input/change event, so without an
// explicit re-render the visible prompt kept the previous text until the next layout pass remounted it.
test("picking a prompt history entry re-renders the mention overlay right away", () => {
  const source = read("particle-editor/novaflow-brand-runtime.js");
  const helperStart = source.indexOf("function refreshAiAnimationPromptMentionOverlay(");
  assert.ok(helperStart >= 0, "the mention overlay refresh helper must exist");
  const helper = source.slice(helperStart, source.indexOf("\n  }\n", helperStart));
  assert.match(helper, /classList\.contains\("nf-resource-mention-backing"\)/,
    "only a mounted backing textarea should reach the mention tool");
  assert.match(helper, /window\.NovaFlowResourceMentionTool\?\.refreshSurface\?\.\(\)/);

  const pickStart = source.indexOf("function refreshAiAnimationPromptHistoryPickTextarea(");
  assert.ok(pickStart >= 0);
  const pick = source.slice(pickStart, source.indexOf("\n  }\n", pickStart));
  assert.match(pick, /refreshAiAnimationPromptMentionOverlay\(textarea\)/,
    "the history pick refresh must notify the overlay, not only the backing value");
  assert.match(pick, /AI_ANIMATION_PROMPT_HISTORY_PICK_REFRESH_DELAYS\.forEach\(\(delay\) => window\.setTimeout\(refresh, delay\)\)/);
  assert.match(source, /const AI_ANIMATION_PROMPT_HISTORY_PICK_REFRESH_DELAYS = \[0, 32, 120, 320\];/,
    "the pick must keep re-checking long enough for a late React commit");

  const tool = read("particle-editor/resource-mention.tool.js");
  assert.match(tool, /textarea\.addEventListener\("input", handlers\.backingChange\);/,
    "the overlay still only follows the backing store through its events");
});
