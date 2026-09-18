// 参考图卡片底部的分辨率角标：显示参考图的真实像素尺寸，点击把它填进上面的 W / H 编辑栏。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "particle-editor", "novaflow-brand-runtime.js"), "utf8");

// particle-editor/ is an ESM package, so the UMD module only hands back its API under a CommonJS scope.
const models = (() => {
  const sandbox = { module: { exports: {} } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(root, "particle-editor", "art-generate-model.resource.js"), "utf8"), sandbox);
  return sandbox.module.exports;
})();
assert.equal(typeof models.capabilityFor, "function", "the model capability table should load");

function extractFunction(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  // Skip the parameter list: a default value such as `attrs = {}` is not the body.
  let parens = 0;
  let signatureEnd = source.indexOf("(", start);
  for (let index = signatureEnd; index < source.length; index += 1) {
    if (source[index] === "(") parens += 1;
    if (source[index] === ")") parens -= 1;
    if (parens === 0) {
      signatureEnd = index;
      break;
    }
  }
  const bodyStart = source.indexOf("{", signatureEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start + 2, index + 1);
  }
  throw new Error(`${name} source is incomplete`);
}

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.className = "";
    this.textContent = "";
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  addEventListener(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  get label() {
    return this.textContent || this.children.map((child) => child.label || "").join("");
  }
}

function buildRuntime(state, options = {}) {
  const renderCalls = [];
  const document = {
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => {
      const node = new FakeNode("#text");
      node.textContent = String(text);
      return node;
    }
  };
  const window = { NovaFlowArtGenerateModels: models };
  const loadImage = (dataUrl) => (
    options.decode === false
      ? Promise.reject(new Error("decode failed"))
      : Promise.resolve({ naturalWidth: options.width, naturalHeight: options.height, src: dataUrl })
  );
  const factory = new Function(
    "ART_GENERATE_STATE",
    "document",
    "window",
    "Node",
    "loadNovaflowArtExportImage",
    "renderArtGenerateSurfaces",
    [
      "const ART_GENERATE_REFERENCE_SIZE_PENDING = new Set();",
      extractFunction("createArtEl"),
      extractFunction("artGenerateReferences"),
      extractFunction("artGenerateReferenceSizeToken"),
      extractFunction("readArtGenerateReferenceSize"),
      extractFunction("measureArtGenerateReferenceSize"),
      extractFunction("ensureArtGenerateReferenceSize"),
      extractFunction("artGenerateActiveCapability"),
      extractFunction("artGenerateResolutionTarget"),
      extractFunction("artGenerateFitResolution"),
      extractFunction("applyArtGenerateReferenceResolution"),
      extractFunction("renderArtGenerateReferenceSizeBadge"),
      "return { renderArtGenerateReferenceSizeBadge, artGenerateFitResolution, artGenerateResolutionTarget, applyArtGenerateReferenceResolution };"
    ].join("\n")
  );
  const api = factory(state, document, window, FakeNode, loadImage, (opts) => renderCalls.push(opts));
  return { api, renderCalls };
}

function img2imgState(extra = {}) {
  return {
    provider: "local",
    mode: "img2img",
    width: 1024,
    height: 1024,
    references: [{ name: "ref.png", dataUrl: "data:image/png;base64,AAAA" }, null, null],
    reference: null,
    status: "",
    error: "",
    ...extra
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the filled reference card renders a resolution badge once the image is measured", async () => {
  const state = img2imgState();
  const { api, renderCalls } = buildRuntime(state, { width: 832, height: 1216 });
  assert.equal(api.renderArtGenerateReferenceSizeBadge(0, state.references[0]), null, "nothing is shown before the measurement lands");
  await flush();
  assert.equal(renderCalls.length, 1, "the measurement re-renders the bottom panel once");
  assert.equal(renderCalls[0].forceBottom, true);
  assert.deepEqual({ width: state.references[0].width, height: state.references[0].height }, { width: 832, height: 1216 });

  const badge = api.renderArtGenerateReferenceSizeBadge(0, state.references[0]);
  assert.equal(badge.tag, "button");
  assert.equal(badge.className, "novaflow-art-generate-ref-size");
  assert.equal(badge.label, "832×1216");
  assert.equal(badge.getAttribute("data-novaflow-art-generate-ref-size"), "1");
  assert.equal(badge.getAttribute("data-novaflow-art-generate-ref-size-apply"), "1");
  assert.match(badge.getAttribute("title"), /点击填入分辨率$/);
});

test("clicking the badge fills W / H and does not reach the card's file picker", async () => {
  const state = img2imgState();
  const { api } = buildRuntime(state, { width: 832, height: 1216 });
  api.renderArtGenerateReferenceSizeBadge(0, state.references[0]);
  await flush();
  const badge = api.renderArtGenerateReferenceSizeBadge(0, state.references[0]);
  let stopped = 0;
  let prevented = 0;
  badge.listeners.click[0]({ preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } });
  assert.equal(state.width, 832);
  assert.equal(state.height, 1216);
  assert.equal(stopped, 1, "the card's onclick must not open the file picker");
  assert.equal(prevented, 1);
  assert.equal(state.status, "分辨率已填入 832×1216");

  badge.listeners.keydown[0]({ key: "Escape", preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } });
  assert.equal(stopped, 1, "only Enter / Space commit from the keyboard");
});

test("an oversized reference is fitted into the field range without changing its aspect", async () => {
  const state = img2imgState();
  const { api } = buildRuntime(state, { width: 4000, height: 3000 });
  api.renderArtGenerateReferenceSizeBadge(0, state.references[0]);
  await flush();
  const badge = api.renderArtGenerateReferenceSizeBadge(0, state.references[0]);
  assert.equal(badge.label, "4000×3000", "the badge reports the reference's own pixel size");
  assert.equal(badge.getAttribute("title"), "4000×3000，点击填入 2048×1536", "a clamped fill says what it will write");
  badge.listeners.click[0]({ preventDefault: () => {}, stopPropagation: () => {} });
  assert.deepEqual({ width: state.width, height: state.height }, { width: 2048, height: 1536 });

  assert.deepEqual(api.artGenerateFitResolution(4000, 3000, 256, 2048), { width: 2048, height: 1536 });
  assert.deepEqual(api.artGenerateFitResolution(832, 1216, 256, 2048), { width: 832, height: 1216 });
  assert.deepEqual(api.artGenerateFitResolution(120, 90, 256, 2048), { width: 341, height: 256 });
  assert.equal(api.artGenerateFitResolution(0, 512, 256, 2048), null);
});

test("the badge only offers to fill when the parameter row renders numeric W / H", async () => {
  const gptState = img2imgState({ provider: "gpt", gptSize: "1024x1024", gptCustomWidth: 1024, gptCustomHeight: 1024 });
  assert.equal(api2Target(gptState), null);
  gptState.gptSize = "Custom";
  assert.deepEqual(api2Target(gptState), { widthKey: "gptCustomWidth", heightKey: "gptCustomHeight", min: 1024, max: 3840 });

  const { api, renderCalls } = buildRuntime(gptState, { width: 1920, height: 1080 });
  api.renderArtGenerateReferenceSizeBadge(0, gptState.references[0]);
  await flush();
  const badge = api.renderArtGenerateReferenceSizeBadge(0, gptState.references[0]);
  assert.equal(badge.getAttribute("data-novaflow-art-generate-ref-size-apply"), "1");
  badge.listeners.click[0]({ preventDefault: () => {}, stopPropagation: () => {} });
  assert.equal(gptState.gptCustomWidth, 1920);
  assert.equal(gptState.gptCustomHeight, 1080);
  assert.ok(renderCalls.length >= 2);

  gptState.gptSize = "1024x1024";
  const shown = api.renderArtGenerateReferenceSizeBadge(0, gptState.references[0]);
  assert.equal(shown.getAttribute("data-novaflow-art-generate-ref-size-apply"), "0", "with no numeric field the size stays informational");
  assert.equal(shown.label, "1920×1080");
});

function api2Target(state) {
  const { api } = buildRuntime(state, { width: 1, height: 1 });
  const capability = models.capabilityFor("gpt", state.mode, state);
  return api.artGenerateResolutionTarget(state, capability);
}

test("a reference whose data URL cannot be decoded shows no badge and stops re-measuring", async () => {
  const state = img2imgState();
  const { api, renderCalls } = buildRuntime(state, { decode: false });
  assert.equal(api.renderArtGenerateReferenceSizeBadge(0, state.references[0]), null);
  await flush();
  assert.equal(renderCalls.length, 0, "a failed decode must not spin the renderer");
  assert.equal(api.renderArtGenerateReferenceSizeBadge(0, state.references[0]), null);
  await flush();
  assert.equal(renderCalls.length, 0);
});

test("the reference picker and its stylesheet keep the badge wired up", () => {
  assert.match(
    source,
    /function renderArtGenerateReferencePicker\(index\)[\s\S]*?renderArtGenerateReferenceSizeBadge\(index, current\)/,
    "the filled reference card must render the resolution badge",
  );
  assert.match(
    source,
    /\.novaflow-art-generate-ref button\.novaflow-art-generate-ref-size \{[\s\S]*?bottom: 0;/,
    "the badge sits on the bottom edge of the card",
  );
  assert.match(
    source,
    /\$\{ART_GENERATE_WORKSPACE_ID\}\.novaflow-app \.novaflow-art-generate-ref button\.novaflow-art-generate-ref-size \{[\s\S]*?height: 20px !important;/,
    "the workspace-scoped sheet must not shrink the badge to the 28px clear button",
  );
});
