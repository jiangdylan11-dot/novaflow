const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

// Typing in the AI sequence / art prompt textareas used to wake every runtime MutationObserver on each
// keystroke (and the account panel re-rendered itself in an endless 80ms loop even while idle). These
// contracts pin the guards that keep prompt input cheap.
const repoRoot = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n?/g, "\n");

const CACHE_VERSION = "20260916-prompt-input-perf-1";

test("account panel only rewrites its markup when it changed and ignores its own mutations", () => {
  const source = read("particle-editor/novaflow-client-auth.js");
  assert.match(source, /if \(target\.__nfClientAuthRenderedContent === content && target\.childElementCount > 0\) return;/);
  assert.match(source, /target\.__nfClientAuthRenderedContent = content;\n\s+target\.innerHTML = content;/);
  assert.match(source, /if \(target\.getAttribute\(HOST_ATTR\) !== "1"\) target\.setAttribute\(HOST_ATTR, "1"\);/);
  assert.match(source, /function isOwnHostMutation\(mutation\)/);
  assert.match(source, /observer = new MutationObserver\(\(mutations\) => \{\n\s+\/\/[^\n]*\n\s+if \(mutations\.every\(isOwnHostMutation\)\) return;\n\s+scheduleRender\(\);\n\s+\}\);/);
  assert.doesNotMatch(source, /new MutationObserver\(scheduleRender\)/);
  // Cache resets wherever the host markup is cleared.
  assert.equal((source.match(/__nfClientAuthRenderedContent = "";/g) || []).length, 2);

  const handler = source.match(/  function isOwnHostMutation\(mutation\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(handler);
  class Element {
    constructor(host) { this.host = host; }
    closest(selector) { assert.equal(selector, '[data-novaflow-client-auth-panel="1"]'); return this.host; }
  }
  const isOwnHostMutation = vm.runInNewContext(`(${handler})`, { Element, HOST_ATTR: "data-novaflow-client-auth-panel" });
  const host = new Element(null);
  host.host = host;
  assert.equal(isOwnHostMutation({ target: host }), true);
  assert.equal(isOwnHostMutation({ target: new Element(host) }), true);
  assert.equal(isOwnHostMutation({ target: { parentElement: new Element(host) } }), true);
  assert.equal(isOwnHostMutation({ target: new Element(null) }), false);
  assert.equal(isOwnHostMutation({ target: null }), false);
});

test("runtime detect stabilizer coalesces DOM scans and skips text-control edits", () => {
  const source = read("particle-editor/runtime-detect-stabilizer.js");
  assert.match(source, /const isTextControlInternalMutation = \(mutation\) =>/);
  assert.match(source, /if \(mutations\.every\(isTextControlInternalMutation\)\) return/);
  assert.match(source, /observerTimer = window\.setTimeout\(handleObservedMutations, 250\)/);
  assert.match(source, /observer\.observe\(document\.documentElement, \{\n\s+subtree: true,\n\s+childList: true,\n\s+characterData: true,\n\s+\}\)/);
  assert.doesNotMatch(source, /attributes: true/);
  assert.match(source, /if \(normalizeUrl\(localStorage\.getItem\(LAST_OK_KEY\) \|\| ''\) !== ctx\.baseUrl\) localStorage\.setItem\(LAST_OK_KEY, ctx\.baseUrl\)/);
});

for (const fileName of ["png-remove-black.tool.js", "spine-atlas-webp.tool.js"]) {
  test(`${fileName} only rescans the Tools entry host when elements are added`, () => {
    const source = read(`particle-editor/${fileName}`);
    assert.match(source, /const toolsActive = isToolsSectionActive\(\)\n\s+const png = toolsActive \? findEntry\('PNG 压缩'\) : null\n\s+const jpg = toolsActive \? findEntry\('JPG 压缩'\) : null/);
    assert.match(source, /const mutationAddsElement = \(mutation\) => Array\.from\(mutation\.addedNodes \|\| \[\]\)\.some\(\(node\) => node\.nodeType === 1\)/);
    assert.match(source, /if \(!mutations\.some\(mutationAddsElement\)\) return/);
    // The entry mounts/unmounts synchronously in React's commit (no 120ms debounce) but the observer
    // still bails cheaply outside the Tools section: body class, then the aria-pressed sidebar probe.
    assert.match(source, /if \(!state\.active && !document\.querySelector\(`\[\$\{BUTTON_ATTR\}="1"\]`\) && !toolsSectionSelected\(\)\) return/);
    assert.match(source, /const toolsSectionSelected = \(\) => Boolean\(document\.body\?\.classList\.contains\('novaflow-primary-target-tools'\)\) \|\| isToolsSectionActive\(\)/);
    assert.doesNotMatch(source, /setTimeout\(syncEntryFromMutations/);
    assert.match(source, /syncEntryFromMutations\(\)\n\s+\}\)/);
    assert.doesNotMatch(source, /new MutationObserver\(\(\) => \{ ensureEntry\(\)/);
    assert.match(source, /window\.setInterval\(ensureEntry, 1000\)/);
  });
}

test("brand runtime compares inline styles after normalization and ignores text-control internals", () => {
  const source = read("particle-editor/novaflow-brand-runtime.js");
  assert.match(source, /function nfNormalizeInlineStyleValue\(property, value, priority\)/);
  assert.match(source, /function nfInlineStylePropertyMatches\(element, property, nextValue, nextPriority\)/);
  assert.equal((source.match(/if \(nfInlineStylePropertyMatches\(element, property, nextValue, nextPriority\)\) \{/g) || []).length, 3);
  assert.doesNotMatch(source, /element\.style\.getPropertyValue\(property\) === nextValue &&\n\s+element\.style\.getPropertyPriority\(property\) === nextPriority/);
  assert.match(source, /function isNovaflowTextControlInternalMutation\(mutation\)/);
  assert.match(source, /function areNovaflowTextControlInternalMutations\(mutations\)/);
  assert.match(source, /if \(document\.hidden\) return;\n\s+\/\/[^\n]*\n\s+if \(areNovaflowTextControlInternalMutations\(mutations\)\) return;/);
  assert.match(source, /if \(isAiAnimationPromptAssistantGuardMutation\(mutation\)\) return true;\n\s+if \(isNovaflowTextControlInternalMutation\(mutation\)\) return true;/);
  assert.match(source, /setAttributeIfChanged\(node, "data-novaflow-ai-comfy-env-hint", "1"\);/);
  assert.equal((source.match(/new MutationObserver\(nfCoalesceMutationCallback\(hide\)\)/g) || []).length, 2);

  const matcher = source.match(/  function nfInlineStylePropertyMatches\(element, property, nextValue, nextPriority\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(matcher);
  const nfInlineStylePropertyMatches = vm.runInNewContext(`(${matcher})`, {
    nfNormalizeInlineStyleValue: (property, value) => (value === "0" ? "0px" : String(value)),
  });
  const element = (value, priority = "important") => ({ style: { getPropertyValue: () => value, getPropertyPriority: () => priority } });
  assert.equal(nfInlineStylePropertyMatches(element("0px"), "margin", "0", "important"), true);
  assert.equal(nfInlineStylePropertyMatches(element("0px"), "margin", "0px", "important"), true);
  assert.equal(nfInlineStylePropertyMatches(element("4px"), "margin", "0", "important"), false);
  assert.equal(nfInlineStylePropertyMatches(element(""), "margin", "0", "important"), false);
  assert.equal(nfInlineStylePropertyMatches(element("0px", ""), "margin", "0", "important"), false);
});

test("AI sequence prompt textarea buffers keystrokes and the reference dropzone is hoisted", () => {
  const bundle = read("particle-editor/assets/index-BbIa-2NM.js");
  const patch = read("scripts/patch-ai-seq-cutout-edit.mjs");
  assert.match(patch, /import \{ patchPromptInputPerf \} from '\.\/patch-prompt-input-perf\.mjs';/);
  assert.match(patch, /source = patchPromptInputPerf\(source\);/);
  // Local buffering with a 140ms trailing commit, plus commit on blur, Ctrl/Cmd+Enter and unmount.
  assert.match(bundle, /,vn=e=>\{let\{value:t,onChange:n,onBlur:r,onKeyDown:i,\.\.\.a\}=e/);
  assert.match(bundle, /u\.current=window\.setTimeout\(\(\)=>\{u\.current=0,v\(null\)\},140\)/);
  assert.match(bundle, /onBlur:e=>\{if\(u\.current&&v\(e\.nativeEvent\)\)\{f\.current=!0;return\}m\.current\?\.\(e\)\}/);
  assert.match(bundle, /e\.key===`Enter`&&\(e\.ctrlKey\|\|e\.metaKey\)&&u\.current&&v\(e\.nativeEvent\)/);
  assert.match(bundle, /\(0,_\.useEffect\)\(\(\)=>\(\)=>\{u\.current&&v\(null\)\},\[v\]\)/);
  assert.doesNotMatch(bundle, /,vn=e=>\(0,X\.jsx\)\(`textarea`,\{\.\.\.e,/);
  // Both prompt fields still go through vn with the panel's own onChange/onBlur handlers.
  assert.match(bundle, /\(vn,\{value:Z,onChange:e=>Q\(e\.target\.value\),onBlur:\(\)=>Fr\.addRecent\(String\(Z\|\|``\)\),placeholder:`输入正向提示词`/);
  assert.match(bundle, /\(vn,\{value:it,onChange:e=>at\(e\.target\.value\),onBlur:\(\)=>Ir\.addRecent\(String\(it\|\|``\)\),placeholder:`可不填写，或输入反向提示词`/);
  // The dropzone component identity is stable across renders.
  assert.equal((bundle.match(/,nfAiSeqRefDropzone=\(\{dataUrl:e,title:t,size:n,grow:r,onPick:i,onClear:a,onDropImport:o,mediaName:s\}\)=>\{/g) || []).length, 1);
  assert.match(bundle, /children:\(\(\)=>\{let e=nfAiSeqRefDropzone;let t=ze===`minimax_h3_local`&&Ve===`multi_reference`/);
  assert.doesNotMatch(bundle, /children:\(\(\)=>\{let e=\(\{dataUrl:e,title:t,/);
});

test("art panel idle sync passes write LoRA slot and split tool state only on change", () => {
  const lora = read("particle-editor/art-generate-lora.js");
  assert.match(lora, /const supported = supports\(state\)\n\s+if \(record\.slot\.hidden !== !supported\) record\.slot\.hidden = !supported/);
  assert.match(lora, /if \(record\.slot\.style\.display !== display\) record\.slot\.style\.display = display/);
  assert.doesNotMatch(lora, /record\.slot\.hidden = !supports\(state\)/);

  const split = read("particle-editor/spine-split-runtime.js");
  assert.match(split, /function setSplitAttributeIfChanged\(node, name, value\) \{\n\s+if \(!node \|\| typeof node\.setAttribute !== 'function'\) return\n\s+const next = String\(value\)\n\s+if \(node\.getAttribute\(name\) !== next\) node\.setAttribute\(name, next\)\n\s+\}/);
  assert.match(split, /setSplitAttributeIfChanged\(button, TOOL_ACTION_ATTR, key === 'source' \? 'viewSource' : 'viewParts'\)/);
  assert.match(split, /if \(button\.disabled !== blocked\) button\.disabled = blocked\n\s+const nextTabIndex = blocked \? -1 : 0\n\s+if \(button\.tabIndex !== nextTabIndex\) button\.tabIndex = nextTabIndex/);
  assert.match(split, /if \(buttonNode\.disabled !== blocked\) buttonNode\.disabled = blocked\n\s+setSplitAttributeIfChanged\(buttonNode, 'aria-disabled', blocked \? 'true' : 'false'\)/);
  assert.match(split, /setSplitAttributeIfChanged\(node, RIGHT_WORKSPACE_ROOT_ATTR, '1'\)/);
  // The persistent tool style must not assign a property plainly and then again with !important.
  const styleBody = split.match(/function applySplitCanvasPersistentToolStyle\(button, active, hovering, disabled\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(styleBody);
  const assigned = styleBody.match(/Object\.assign\(button\.style, \{([\s\S]*?)\}\)/)?.[1] || "";
  for (const key of ["background,", "backgroundColor:", "fontSize:", "lineHeight:", "boxShadow:", "transition:"]) {
    assert.ok(!assigned.includes(key), `${key} must not be plainly assigned before its !important write`);
  }
  assert.match(styleBody, /button\.style\.setProperty\('background', background, 'important'\)/);
});

test("preview wheel zoom coalesces notches instead of re-rendering the panel per notch", () => {
  const bundle = read("particle-editor/assets/index-BbIa-2NM.js");
  const patch = read("scripts/patch-ai-seq-cutout-edit.mjs");
  assert.match(patch, /import \{ patchPreviewWheelZoom \} from '\.\/patch-preview-wheel-zoom\.mjs';/);
  assert.match(patch, /source = patchPreviewWheelZoom\(source\);/);
  assert.equal((bundle.match(/nfAiSeqQueuePreviewZoom=\(e,t\)=>\{/g) || []).length, 1);
  // First notch commits immediately; later notches within 100ms are queued and applied with the original rounding.
  assert.match(bundle, /t\.length&&e\(e=>t\.reduce\(\(e,t\)=>Math\.round\(Math\.max\(\.1,Math\.min\(8,e\*t\)\)\*1e3\)\/1e3,e\)\)/);
  assert.match(bundle, /i>=100&&!n\.timer\?r\(\):n\.timer\|\|\(n\.timer=window\.setTimeout\(r,Math\.max\(16,100-i\)\)\)/);
  assert.equal((bundle.match(/nfAiSeqQueuePreviewZoom\(oe,n\)/g) || []).length, 2);
  assert.doesNotMatch(bundle, /oe\(e=>Math\.round\(Math\.max\(\.1,Math\.min\(8,e\*n\)\)\*1e3\)\/1e3\)/);
});

test("scrolling inside a text control never triggers the brand runtime layout refreshers", () => {
  const source = read("particle-editor/novaflow-brand-runtime.js");
  assert.match(source, /function isNovaflowTextControlScrollEvent\(event\)/);
  // The preview runtime layout listener, the reference resolution overlay refresher and the dropdown
  // controller all bail out before scheduling anything for textarea/input/contenteditable scrolls.
  assert.match(source, /window\.addEventListener\("scroll", \(event\) => \{\n\s+if \(isNovaflowTextControlScrollEvent\(event\)\) return;\n\s+if \(isDropdownPanelScrollEvent\(event\)\) \{/);
  assert.match(source, /document\.addEventListener\("scroll", \(event\) => \{\n\s+if \(isNovaflowTextControlScrollEvent\(event\)\) return;\n\s+schedule\(\);\n\s+\}, \{ passive: true, capture: true \}\);/);
  assert.match(source, /function syncGlobalDropdownController\(\) \{\n\s+const event = arguments\[0\];\n\s+if \(isNovaflowTextControlScrollEvent\(event\)\) return;/);
  assert.doesNotMatch(source, /document\.addEventListener\("scroll", schedule, \{ passive: true, capture: true \}\);/);

  const helper = source.match(/  function isNovaflowTextControlScrollEvent\(event\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(helper);
  class Element {}
  class HTMLElement extends Element { constructor(editable = false) { super(); this.isContentEditable = editable; } }
  class HTMLTextAreaElement extends HTMLElement {}
  class HTMLInputElement extends HTMLElement {}
  const isTextControlScroll = vm.runInNewContext(`(${helper})`, { Element, HTMLElement, HTMLTextAreaElement, HTMLInputElement });
  assert.equal(isTextControlScroll({ type: "scroll", target: new HTMLTextAreaElement() }), true);
  assert.equal(isTextControlScroll({ type: "scroll", target: new HTMLInputElement() }), true);
  assert.equal(isTextControlScroll({ type: "scroll", target: new HTMLElement(true) }), true);
  assert.equal(isTextControlScroll({ type: "scroll", target: new HTMLElement(false) }), false);
  assert.equal(isTextControlScroll({ type: "resize", target: new HTMLTextAreaElement() }), false);
  assert.equal(isTextControlScroll({ type: "scroll", target: {} }), false);
  assert.equal(isTextControlScroll(null), false);
});

test("index.html cache-busts every runtime file touched by the prompt input fix", () => {
  const html = read("particle-editor/index.html");
  const expected = {
    "runtime-detect-stabilizer.js": CACHE_VERSION,
    "png-remove-black.tool.js": "20260916-section-switch-1",
    "spine-atlas-webp.tool.js": "20260916-section-switch-1",
    "novaflow-client-auth.js": CACHE_VERSION,
    "novaflow-brand-runtime.js": "20260918-ref-resolution-1",
    "spine-split-runtime.js": "20260919-layer-card-routing-1",
    "art-generate-lora.js": CACHE_VERSION,
  };
  for (const [fileName, version] of Object.entries(expected)) {
    assert.ok(html.includes(`${fileName}?v=${version}`), `${fileName} should cache-bust with ${version}`);
  }
  // The bundle key moves with every bundle patch; it must at least be newer than the first prompt-perf build.
  const bundleKey = html.match(/assets\/index-BbIa-2NM\.js\?v=([^"]+)"/)?.[1] || "";
  assert.ok(bundleKey && bundleKey !== "20260915-ai-history-rows-1" && bundleKey !== "20260916-prompt-input-perf-1", `bundle cache key must be newer than the first prompt-perf build (got ${bundleKey})`);
  const sync = read("scripts/sync-runtime.mjs");
  const check = read("scripts/check-runtime-sync.mjs");
  assert.match(sync, /label: 'runtime-detect-stabilizer\.js'/);
  assert.match(check, /name: 'runtime-detect-stabilizer\.js'/);
});
