const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

// Unauthorized installs: the 仓库 / 导出 sidebar shortcuts render disabled (dimmed, not-allowed cursor,
// aria-disabled) and their clicks route to the license dialog instead of opening the output folder
// or the export flow. Both entries share one treatment, mirroring the topbar 文件 → 导出 item.
const repoRoot = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n?/g, "\n");
const BRAND_CACHE_VERSION = "20260916-shortcut-auth-1";

const LOCKED_ATTR = "data-novaflow-primary-shortcut-locked";
const UNAUTHORIZED_TITLE = "未授权：仓库和导出需要导入授权文件";

class FakeStyle {
  constructor() { this.map = new Map(); }
  setProperty(name, value) { this.map.set(name, String(value)); }
  removeProperty(name) { this.map.delete(name); }
  getPropertyValue(name) { return this.map.get(name) || ""; }
}

function makeContext() {
  class Element {}
  class HTMLElement extends Element {
    constructor() {
      super();
      this.attributes = new Map();
      this.style = new FakeStyle();
    }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    hasAttribute(name) { return this.attributes.has(name); }
  }
  class HTMLButtonElement extends HTMLElement {}
  const context = {
    Element,
    HTMLElement,
    HTMLButtonElement,
    PRIMARY_SHORTCUT_LOCKED_ATTR: LOCKED_ATTR,
    PRIMARY_SHORTCUT_UNAUTHORIZED_TITLE: UNAUTHORIZED_TITLE,
    authorized: true,
    isPrimaryShortcutAuthorized: () => context.authorized,
    setAttributeIfChanged: (element, name, value) => {
      if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value));
    },
    setImportantStyles: (element, styles) => {
      Object.entries(styles).forEach(([property, value]) => element.style.setProperty(property, value, "important"));
    },
  };
  return context;
}

test("the shortcut authorization sync locks and unlocks a shortcut button in place", () => {
  const source = read("particle-editor/novaflow-brand-runtime.js");
  const fn = source.match(/  function syncPrimaryShortcutAuthorizationState\(button, label\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(fn, "syncPrimaryShortcutAuthorizationState exists");
  const context = makeContext();
  const sync = vm.runInNewContext(`(${fn})`, context);
  const button = new context.HTMLButtonElement();

  context.authorized = false;
  sync(button, "仓库");
  assert.equal(button.getAttribute(LOCKED_ATTR), "1");
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.equal(button.getAttribute("title"), UNAUTHORIZED_TITLE);
  assert.equal(button.style.getPropertyValue("opacity"), "0.48");
  assert.equal(button.style.getPropertyValue("cursor"), "not-allowed");
  assert.equal(button.style.getPropertyValue("filter"), "grayscale(0.35)");
  assert.equal(button.hasAttribute("disabled"), false, "the button stays clickable so the license dialog can open");

  context.authorized = true;
  sync(button, "仓库");
  assert.equal(button.getAttribute(LOCKED_ATTR), null);
  assert.equal(button.getAttribute("aria-disabled"), null);
  assert.equal(button.getAttribute("title"), "仓库");
  assert.equal(button.style.getPropertyValue("opacity"), "");
  assert.equal(button.style.getPropertyValue("cursor"), "");
  assert.equal(button.style.getPropertyValue("filter"), "");

  sync(new context.HTMLElement(), "仓库");
  sync(null, "仓库");
});

test("an unauthorized 仓库 click opens the license dialog instead of the output folder", async () => {
  const source = read("particle-editor/novaflow-brand-runtime.js");
  const fn = source.match(/  async function openPrimaryOutputShortcut\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(fn, "openPrimaryOutputShortcut exists");
  const calls = [];
  const context = {
    authorized: false,
    console: { warn() {} },
    isPrimaryShortcutAuthorized: () => context.authorized,
    openLicenseAuthorizationDialogFromTopbar: () => { calls.push("license"); return true; },
  };
  context.window = { electronAPI: { runtimeOpenOutputFolder: async () => { calls.push("open"); return { ok: true }; } } };
  const open = vm.runInNewContext(`(${fn})`, context);

  await open();
  assert.deepEqual(calls, ["license"], "unauthorized: only the license dialog opens");

  context.authorized = true;
  await open();
  assert.deepEqual(calls, ["license", "open"], "authorized: the output folder opens");
});

test("both sidebar shortcuts get the authorization sync on every layout pass", () => {
  const source = read("particle-editor/novaflow-brand-runtime.js");
  assert.match(source, /function isPrimaryShortcutAuthorized\(\) \{\n(?:\s+\/\/[^\n]*\n)*\s+return isTopbarExportAuthorized\(\);/);
  // ensurePrimaryOutputShortcut applies the base styles first, then the authorization state, for both entries.
  assert.match(source, /applyPrimaryOutputShortcutButtonStyles\(button\);\n\s+syncPrimaryShortcutAuthorizationState\(button, PRIMARY_OUTPUT_SHORTCUT_LABEL\);/);
  assert.match(source, /applyPrimaryOutputShortcutButtonStyles\(exportButton\);\n\s+syncPrimaryShortcutAuthorizationState\(exportButton, PRIMARY_EXPORT_SHORTCUT_LABEL\);/);
  // The base styles no longer pin opacity to 1, otherwise every pass would fight the locked look.
  const styles = source.match(/  function applyPrimaryOutputShortcutButtonStyles\(button\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(styles);
  assert.doesNotMatch(styles, /opacity:/);
  // The preview layout pass re-syncs so a license import flips the shortcuts without a reload.
  assert.match(source, /nfAnimationPerfRunLayoutStep\("applyPreviewRuntimeLayout", "primaryShortcutAuthorization", \(\) => \{\n\s+syncPrimaryShortcutAuthorization\(\);\n\s+\}\);/);
  const syncAll = source.match(/  function syncPrimaryShortcutAuthorization\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(syncAll);
  assert.match(syncAll, /\[data-novaflow-primary-output-entry="1"\]'\),\n\s+PRIMARY_OUTPUT_SHORTCUT_LABEL/);
  assert.match(syncAll, /\[data-novaflow-primary-export-entry="1"\]'\),\n\s+PRIMARY_EXPORT_SHORTCUT_LABEL/);
  // 导出 keeps its existing gate in the export action itself.
  assert.match(source, /function triggerNovaflowExportShortcutAction\(options = \{\}\) \{\n\s+if \(!document\.body\) return false;\n\s+if \(!isTopbarExportAuthorized\(\)\) \{\n\s+openLicenseAuthorizationDialogFromTopbar\(\);\n\s+return true;/);
});

test("locked shortcuts look disabled and do not light up on hover", () => {
  const source = read("particle-editor/novaflow-brand-runtime.js");
  assert.match(source, /\[data-novaflow-primary-output-entry="1"\]\[data-novaflow-primary-shortcut-locked="1"\],\n\s+\[data-novaflow-primary-export-entry="1"\]\[data-novaflow-primary-shortcut-locked="1"\] \{\n\s+opacity: 0\.48 !important;\n\s+cursor: not-allowed !important;\n\s+filter: grayscale\(0\.35\) !important;/);
  assert.match(source, /\[data-novaflow-primary-export-entry="1"\]\[data-novaflow-primary-shortcut-locked="1"\]\[data-novaflow-primary-export-hover="1"\] \{\n\s+background: \$\{PRIMARY_INACTIVE_BACKGROUND\} !important;/);
});

test("index.html loads the brand runtime with the shortcut authorization cache key", () => {
  const html = read("particle-editor/index.html");
  assert.ok(html.includes(`novaflow-brand-runtime.js?v=${BRAND_CACHE_VERSION}`));
});
