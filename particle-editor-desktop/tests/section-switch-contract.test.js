const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

// Section switches: the AI sequence top mode resets its prompt, the Tools entries mount/unmount in the
// same frame as the section they belong to, and the 仓库 / 导出 sidebar shortcuts come back after a
// dropdown closes.
const repoRoot = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n?/g, "\n");
const TOOL_CACHE_VERSION = "20260916-section-switch-1";
// The brand runtime moved on once more for the modal-dropdown shortcut z-index fix.
const BRAND_CACHE_VERSION = "20260916-section-switch-2";

test("switching the AI sequence top mode clears the positive prompt before React handles the click", () => {
  const source = read("particle-editor/novaflow-brand-runtime.js");
  const fn = source.match(/  function resetAiAnimationPositivePromptForTopModeSwitch\(event\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(fn);
  assert.match(source, /document\.addEventListener\("click", resetAiAnimationPositivePromptForTopModeSwitch, true\);/);
  assert.match(source, /window\.setTimeout\(\(\) => \{ bindAiAnimationTopModeSwitchPromptReset\(\); \}, 0\);/);

  class Element {}
  class HTMLElement extends Element {}
  class HTMLButtonElement extends HTMLElement {
    constructor(pressed) { super(); this.pressed = pressed; this.disabled = false; }
    getAttribute(name) { return name === "aria-pressed" ? this.pressed : null; }
  }
  class HTMLTextAreaElement extends HTMLElement {
    constructor(value) { super(); this.value = value; }
  }
  const writes = [];
  const textarea = new HTMLTextAreaElement("让@参考图 转身");
  const workspace = Object.assign(new HTMLElement(), { querySelector: () => textarea });
  const reset = vm.runInNewContext(`(${fn})`, {
    Element, HTMLElement, HTMLButtonElement, HTMLTextAreaElement,
    document: { querySelector: () => workspace },
    setAiAnimationPromptEditorControlValue: (control, value) => { writes.push([control, value]); return true; },
  });
  const target = (button) => Object.assign(new Element(), { closest: () => button });
  reset({ target: target(new HTMLButtonElement("true")) });
  assert.equal(writes.length, 0, "clicking the already active mode keeps the prompt");
  reset({ target: target(new HTMLButtonElement("false")) });
  assert.deepEqual(writes, [[textarea, ""]], "switching modes clears the positive prompt");
  textarea.value = "";
  reset({ target: target(new HTMLButtonElement("false")) });
  reset({ target: target(null) });
  reset({ target: null });
  assert.equal(writes.length, 1, "an empty prompt is not rewritten");
});

for (const fileName of ["png-remove-black.tool.js", "spine-atlas-webp.tool.js"]) {
  test(`${fileName} drops its Tools entry synchronously when another primary section is clicked`, () => {
    const source = read(`particle-editor/${fileName}`);
    assert.match(source, /document\.addEventListener\('click', handlePrimarySectionClick, true\)/);
    // Text is compared before any rect is read so the scans stay cheap.
    assert.match(source, /if \(!\(node instanceof HTMLElement\) \|\| node\.hasAttribute\(BUTTON_ATTR\) \|\| !textOf\(node\)\.includes\(label\)\) return false/);
    // The section probe pre-filters by aria-pressed / data-state so it can run on every mutation batch.
    assert.match(source, /querySelectorAll\('button\[aria-pressed="true"\], \[role="button"\]\[aria-pressed="true"\], button\[data-state="active"\], \[role="button"\]\[data-state="active"\]'\)\)\.some\(\(node\) => \(\n\s+node instanceof HTMLElement && textOf\(node\) === '工具' && node\.getBoundingClientRect\(\)\.left < 110/);
    const helper = source.match(/  function primarySectionButtonFromEvent\(event\) \{[\s\S]*?\n  \}/)?.[0];
    const handler = source.match(/  function handlePrimarySectionClick\(event\) \{[\s\S]*?\n  \}/)?.[0];
    assert.ok(helper && handler);

    const removed = [];
    let deactivations = 0;
    class Element {
      constructor(text, left) { this.text = text; this.left = left; }
      closest() { return this; }
      getBoundingClientRect() { return { left: this.left, top: 80, width: 60 }; }
    }
    class HTMLElement extends Element {}
    const context = {
      Element, HTMLElement,
      PRIMARY_SECTION_LABELS: ["特效", "动画", "美工", "工具"],
      textOf: (node) => node.text,
      deactivate: () => { deactivations += 1; },
      BUTTON_ATTR: "data-x",
      document: { querySelector: () => ({ remove: () => removed.push(1) }) },
    };
    vm.runInNewContext(`${helper}\n${handler}\nthis.click = handlePrimarySectionClick`, context);
    context.click({ target: new HTMLElement("工具", 20) });
    context.click({ target: new HTMLElement("美工", 400) });
    context.click({ target: new HTMLElement("仓库", 20) });
    context.click({ target: null });
    assert.equal(deactivations, 0);
    assert.equal(removed.length, 0);
    context.click({ target: new HTMLElement("美工", 20) });
    assert.equal(deactivations, 1);
    assert.equal(removed.length, 1);
  });
}

test("closing the global dropdown re-syncs the 仓库 / 导出 sidebar shortcuts", () => {
  const source = read("particle-editor/novaflow-brand-runtime.js");
  const start = source.indexOf("function closeGlobalDropdown(options = {}) {");
  assert.ok(start >= 0);
  const body = source.slice(start, source.indexOf("\n  }\n", start));
  assert.match(body, /DROPDOWN_CONTROLLER\.clampTimer = 0;\n(?:\s+\/\/[^\n]*\n)*\s+schedulePrimaryOutputShortcutRecovery\(\[0, 16, 80\]\);/);
  // Only clamped dropdowns push the shortcuts to the underlay; modal-layer dropdowns (art 模型方式) keep
  // them at their normal z-index, otherwise they vanish behind the left column while the list is open.
  assert.match(source, /function getPrimaryOutputShortcutZIndex\(\) \{[\s\S]*?if \(isDropdownLayerLifecycleActive\(\)\) \{\n(?:\s+\/\/[^\n]*\n)*\s+return usesNovaflowModalDropdownLayer\(DROPDOWN_CONTROLLER\.activeTrigger\)\n\s+\? PRIMARY_OUTPUT_SHORTCUT_Z_INDEX\n\s+: DROPDOWN_UNDERLAY_Z_INDEX;/);
  assert.match(source, /function usesNovaflowModalDropdownLayer\(trigger\) \{\n\s+return isNovaflowExportModalDropdownTrigger\(trigger\) \|\|\n\s+window\.NovaFlowArtGenerateModeTool\?\.ownsSelect\?\.\(trigger\) === true;/);
});

test("the art prompt history popover stays inside the art workspace", () => {
  const source = read("particle-editor/novaflow-brand-runtime.js");
  const bounds = source.match(/  function getArtGeneratePromptHistoryPopupBounds\(viewportW\) \{[\s\S]*?\n  \}/)?.[0];
  const setRect = source.match(/  function setArtGeneratePromptHistoryPopupRect\(source\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(bounds && setRect);
  class HTMLElement {
    constructor(rect) { this.rect = rect; }
    closest() { return this; }
    getBoundingClientRect() { return this.rect; }
  }
  const state = { promptHistoryOpenKey: "negativePrompt", promptHistoryPopupRect: null };
  const workspace = new HTMLElement({ left: 339, right: 1124, width: 785, top: 56, height: 634 });
  const context = {
    HTMLElement,
    document: { getElementById: (id) => (id === "novaflow-art-generate-workspace" ? workspace : null) },
    window: { innerWidth: 1384, innerHeight: 690 },
    ART_GENERATE_STATE: state,
    ART_GENERATE_WORKSPACE_ID: "novaflow-art-generate-workspace",
    getArtGeneratePromptHistoryPopoverEstimatedHeight: () => 52,
  };
  vm.runInNewContext(`${bounds}\n${setRect}\nthis.setRect = setArtGeneratePromptHistoryPopupRect`, context);

  // The negative prompt anchor (154px wide, 946..1099) used to open a 320px box running to 1265, under
  // the right-hand host that starts at 1124; now it right-aligns to the anchor.
  context.setRect(new HTMLElement({ left: 946, right: 1099, width: 154, top: 541, height: 30 }));
  assert.equal(state.promptHistoryPopupRect.width, 320);
  assert.equal(state.promptHistoryPopupRect.left, 1099 - 320);
  assert.ok(state.promptHistoryPopupRect.left + state.promptHistoryPopupRect.width <= 1124 - 10);
  // A wide anchor that fits keeps its own left edge and width.
  context.setRect(new HTMLElement({ left: 364, right: 1099, width: 735, top: 541, height: 30 }));
  assert.equal(state.promptHistoryPopupRect.left, 364);
  assert.equal(state.promptHistoryPopupRect.width, 735);
  // Without a mounted workspace the viewport is the bound.
  context.document.getElementById = () => null;
  context.setRect(new HTMLElement({ left: 1200, right: 1354, width: 154, top: 541, height: 30 }));
  // Right-aligned to the anchor (1354 - 320), which already sits inside the viewport bound.
  assert.equal(state.promptHistoryPopupRect.left, 1354 - 320);
});

test("index.html cache-busts the section-switch files", () => {
  const html = read("particle-editor/index.html");
  const expected = {
    "novaflow-brand-runtime.js": BRAND_CACHE_VERSION,
    "png-remove-black.tool.js": TOOL_CACHE_VERSION,
    "spine-atlas-webp.tool.js": TOOL_CACHE_VERSION,
  };
  for (const [fileName, version] of Object.entries(expected)) {
    assert.ok(html.includes(`${fileName}?v=${version}`), `${fileName} should cache-bust with ${version}`);
  }
});
