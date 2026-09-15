const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const toolPath = path.resolve(__dirname, "../../particle-editor/ui-design-generate.tool.js");
const workflowPath = path.resolve(__dirname, "../../particle-editor/ui-design-generate.workflow.js");
const localWorkflowPath = path.resolve(__dirname, "../../particle-editor/ui-design-local.workflow.js");
const localReferencePath = path.resolve(__dirname, "../../particle-editor/ui-design-local-reference.helper.js");
const localDirectorPath = path.resolve(__dirname, "../../particle-editor/ui-design-local-director.workflow.js");
const localRefinePath = path.resolve(__dirname, "../../particle-editor/ui-design-local-refine.workflow.js");
const FULLSCREEN_DIGITAL_UI_CONTRACT = "整张画布即单一原生数字界面，画面边界与界面视口完全重合，连续背景延伸到四边，全部可见内容均为同一正视屏幕平面内的浅层二维软件图形";

require(localWorkflowPath);
require(localReferencePath);
require(localDirectorPath);
require(localRefinePath);

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.parentElement = null;
    this.style = {};
    this.textContent = "";
    this.value = "";
    this.type = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
    children.forEach((child) => this.appendChild(child));
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    const key = String(name);
    const text = String(value);
    this.attributes.set(key, text);
    if (key === "value") this.value = text;
    if (key === "type") this.type = text;
    if (key === "disabled") this.disabled = true;
  }

  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
    if (String(name) === "disabled") this.disabled = false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    event.currentTarget = this;
    event.preventDefault = event.preventDefault || (() => {});
    event.stopPropagation = event.stopPropagation || (() => {});
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

function walk(root) {
  const nodes = [];
  const visit = (node) => {
    if (!node) return;
    nodes.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return nodes;
}

function findByAttr(root, name, value = null) {
  return walk(root).find((node) => {
    const current = node.getAttribute?.(name);
    return value === null ? current !== null : current === String(value);
  }) || null;
}

function findAllByAttr(root, name, value = null) {
  return walk(root).filter((node) => {
    const current = node.getAttribute?.(name);
    return value === null ? current !== null : current === String(value);
  });
}

function freshRequire(modulePath, extraGlobals = {}) {
  const globalName = modulePath === toolPath
    ? "NovaFlowUiDesignGenerateTool"
    : "NovaFlowUiDesignGenerateWorkflow";
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    AbortController,
    NovaFlowClientAuth: globalThis.NovaFlowClientAuth,
    NovaFlowArtGenerateModels: globalThis.NovaFlowArtGenerateModels,
    NovaFlowArtGenerateExecutionBridge: globalThis.NovaFlowArtGenerateExecutionBridge,
    NovaFlowUiDesignLocalWorkflow: globalThis.NovaFlowUiDesignLocalWorkflow,
    NovaFlowUiDesignLocalReference: globalThis.NovaFlowUiDesignLocalReference,
    NovaFlowUiDesignLocalDirectorWorkflow: globalThis.NovaFlowUiDesignLocalDirectorWorkflow,
    NovaFlowUiDesignLocalRefineWorkflow: globalThis.NovaFlowUiDesignLocalRefineWorkflow,
    electronAPI: globalThis.electronAPI,
    ...extraGlobals,
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(modulePath, "utf8"), context, { filename: modulePath });
  assert.equal(context[globalName], context.module.exports, `${globalName} must share its CommonJS/global export`);
  globalThis[globalName] = context[globalName];
  return context.module.exports;
}

test("resolveOutputContract reports exact local/GPT pixels and honest Google output semantics", () => {
  globalThis.NovaFlowArtGenerateModels = {
    normalizeProvider(value) {
      return value === "gpt" || value === "google" ? value : "local";
    },
  };
  const tool = freshRequire(toolPath);

  const local = tool.resolveOutputContract("local", { width: 720, height: 1280 }, {});
  assert.equal(local.valid, true);
  assert.equal(local.exact, true);
  assert.equal(local.specification, "720 × 1280");

  const gptValid = tool.resolveOutputContract("gpt", { width: 1600, height: 1024 }, {});
  assert.equal(gptValid.valid, true);
  assert.equal(gptValid.exact, true);
  assert.equal(gptValid.error, "");

  const gptBelowMinimum = tool.resolveOutputContract("gpt", { width: 1280, height: 720 }, {});
  assert.equal(gptBelowMinimum.valid, false);
  assert.equal(gptBelowMinimum.exact, false);
  assert.match(gptBelowMinimum.error, /1024–3840/);

  const gptNotMultiple = tool.resolveOutputContract("gpt", { width: 1920, height: 1080 }, {});
  assert.equal(gptNotMultiple.valid, false);
  assert.match(gptNotMultiple.error, /16 的倍数/);

  const gptWide = tool.resolveOutputContract("gpt", { width: 3840, height: 1024 }, {});
  assert.equal(gptWide.valid, false);
  assert.match(gptWide.error, /3:1/);

  const gptTooManyPixels = tool.resolveOutputContract("gpt", { width: 3840, height: 3840 }, {});
  assert.equal(gptTooManyPixels.valid, false);
  assert.match(gptTooManyPixels.error, /8,294,400/);

  const google = tool.resolveOutputContract(
    "google",
    { width: 1280, height: 720 },
    { googleResolution: "2K" },
  );
  assert.equal(google.valid, true);
  assert.equal(google.exact, false);
  assert.equal(google.aspect, "16:9");
  assert.equal(google.resolution, "2K");
  assert.equal(google.specification, "画幅 16:9 · 分辨率 2K");
  assert.equal(google.note, "实际像素由 Google 返回");
});

test("GenerateTool mounts the shared account under ui-design and keeps UI generation fixed to img2img", () => {
  const authMounts = [];
  const authUnmounts = [];
  globalThis.NovaFlowClientAuth = {
    mount(key, element) { authMounts.push({ key, element }); },
    unmount(key) { authUnmounts.push(key); },
  };
  globalThis.NovaFlowArtGenerateModels = {
    normalizeProvider(value) {
      return value === "gpt" || value === "google" ? value : "local";
    },
  };

  const tool = freshRequire(toolPath);
  assert.equal(globalThis.NovaFlowUiDesignGenerateTool, tool);

  const document = new FakeDocument();
  const host = document.createElement("div");
  const state = { provider: "local" };
  const changes = [];
  const handle = tool.mount({
    host,
    state,
    getCanvasSize: () => ({ width: 1920, height: 1080 }),
    onChange(change) { changes.push(change); },
  });

  assert.equal(state.mode, "img2img");
  assert.equal(state.randomSeed, true, "new UI generators default to varied seeds while fixed Seed remains available");
  assert.equal(state.seed, 0);
  assert.equal(state.nsfw, false);
  assert.equal(authMounts.length, 1);
  assert.equal(authMounts[0].key, "ui-design");
  assert.equal(authMounts[0].element.getAttribute("data-novaflow-ui-design-account-slot"), "1");

  const header = findByAttr(host, "data-novaflow-ui-design-generate-toggle", "1");
  const body = findByAttr(host, "data-novaflow-ui-design-generate-body", "1");
  assert.equal(header.getAttribute("aria-expanded"), "false");
  assert.equal(body.hidden, true, "模式选择默认收起");
  header.dispatchEvent({ type: "click" });
  assert.equal(header.getAttribute("aria-expanded"), "true");
  assert.equal(body.hidden, false);

  const providerSelect = findByAttr(host, "data-novaflow-ui-design-provider", "1");
  assert.deepEqual(providerSelect.children.map((option) => [option.value, option.textContent]), [
    ["local", "本地模型"],
    ["gpt", "GPT"],
    ["google", "Google"],
  ]);
  const sizeOutput = findByAttr(host, "data-novaflow-ui-design-canvas-size", "1");
  assert.equal(sizeOutput.textContent, "1920 × 1080");
  assert.equal(findAllByAttr(host, "data-novaflow-ui-design-dimension-input").length, 0, "画板尺寸不能出现第二套可编辑输入");

  providerSelect.value = "gpt";
  providerSelect.dispatchEvent({ type: "change" });
  assert.equal(state.provider, "gpt");
  assert.equal(state.mode, "img2img");
  assert.ok(findByAttr(host, "data-novaflow-ui-design-param", "gptQualityImg2img"));
  assert.equal(changes.at(-1).key, "provider");
  assert.equal(changes.at(-1).mode, "img2img");

  handle.setStatus("请先登录 NovaFlow 账号", { error: true, running: false });
  assert.equal(findByAttr(host, "data-novaflow-ui-design-generate-status", "1").textContent, "请先登录 NovaFlow 账号");
  handle.open();
  assert.equal(header.getAttribute("aria-expanded"), "true");
  handle.update({ provider: "google", googleResolution: "2K" });
  assert.equal(handle.getState().provider, "google");

  handle.destroy();
  assert.deepEqual(authUnmounts, ["ui-design"]);
});

test("GenerateTool node variant keeps parameters visible, exposes orientation shortcuts, and uses compact switches", async () => {
  const authMounts = [];
  const authUnmounts = [];
  globalThis.NovaFlowClientAuth = {
    mount(key, element) { authMounts.push({ key, element }); },
    unmount(key) { authUnmounts.push(key); },
  };
  globalThis.NovaFlowArtGenerateModels = {
    normalizeProvider(value) {
      return value === "gpt" || value === "google" ? value : "local";
    },
  };

  const tool = freshRequire(toolPath);
  const document = new FakeDocument();
  const host = document.createElement("div");
  const state = { provider: "local", randomSeed: true, localEditStrength: "faithful" };
  const changes = [];
  const outputSizes = [];
  let generationCalls = 0;
  let finishGeneration;
  const generation = new Promise((resolve) => { finishGeneration = resolve; });
  const handle = tool.mount({
    host,
    variant: "node",
    state,
    expanded: false,
    accountStatus: { label: "已登录", tone: "ok" },
    getCanvasSize: () => ({ width: 1920, height: 1080 }),
    onChange(change) { changes.push(change); },
    onOutputSizeChange(size) { outputSizes.push(size); },
    onGenerate(payload) {
      generationCalls += 1;
      assert.equal(payload.mode, "img2img");
      assert.equal(payload.snapshot.provider, state.provider);
      return generation;
    },
  });

  assert.equal(findByAttr(host, "data-novaflow-ui-design-generate-variant", "node") !== null, true);
  assert.equal(findByAttr(host, "data-novaflow-ui-design-generate-toggle", "1").style.display, "none");
  assert.equal(findByAttr(host, "data-novaflow-ui-design-generate-body", "1").hidden, false);
  assert.equal(findByAttr(host, "data-novaflow-ui-design-account-slot", "1"), null, "node variant must not mount the full account panel");
  assert.equal(authMounts.length, 0);
  assert.equal(findByAttr(host, "data-novaflow-ui-design-account-status", "1").textContent, "已登录");
  assert.equal(findByAttr(host, "data-novaflow-ui-design-work-mode"), null, "work mode label has no user-facing value");

  let preset = findByAttr(host, "data-novaflow-ui-design-output-size-preset", "1");
  assert.equal(preset.value, "1920x1080");
  assert.equal(findAllByAttr(host, "data-novaflow-ui-design-dimension-input").length, 0);
  assert.equal(findByAttr(host, "data-novaflow-ui-design-node-params-toggle"), null);
  assert.equal(findByAttr(host, "data-novaflow-ui-design-node-params-header", "1").textContent, "生成参数");
  assert.equal(findByAttr(host, "data-novaflow-ui-design-node-params-body", "1").hidden, false);
  assert.ok(findByAttr(host, "data-novaflow-ui-design-param", "localEditStrength"));
  assert.ok(findByAttr(host, "data-novaflow-ui-design-local-switches", "1"));
  const initialRandomSeed = findByAttr(host, "data-novaflow-ui-design-param", "randomSeed");
  const initialNsfw = findByAttr(host, "data-novaflow-ui-design-param", "nsfw");
  const initialSeed = findByAttr(host, "data-novaflow-ui-design-param", "seed");
  const initialRandomRow = findByAttr(host, "data-novaflow-ui-design-switch-field", "randomSeed");
  const initialNsfwRow = findByAttr(host, "data-novaflow-ui-design-switch-field", "nsfw");
  const initialSwitchStack = findByAttr(host, "data-novaflow-ui-design-local-switches", "1");
  const initialPrompt = findByAttr(host, "data-novaflow-ui-design-prompt-field", "prompt");
  const initialNegativePrompt = findByAttr(host, "data-novaflow-ui-design-prompt-field", "negativePrompt");
  assert.equal(initialRandomSeed.getAttribute("role"), "switch");
  assert.equal(initialRandomSeed.getAttribute("aria-checked"), "true");
  assert.equal(initialRandomSeed.style.width, "34px");
  assert.equal(initialRandomSeed.style.height, "18px");
  assert.equal(initialRandomSeed.children[0].style.width, "10px");
  assert.equal(initialRandomSeed.children[0].style.height, "10px");
  assert.equal(initialRandomSeed.children[0].style.top, "4px");
  assert.equal(initialRandomSeed.children[0].style.left, "20px");
  assert.equal(initialSeed.disabled, true, "Seed stays visible but disabled while random mode is active");
  assert.equal(initialSeed.style.width, "45px");
  assert.equal(initialSeed.style.height, "26px");
  assert.equal(initialRandomRow.style.display, "grid");
  assert.equal(initialRandomRow.style.gridTemplateColumns, "48px 34px minmax(0, 1fr)");
  assert.equal(initialRandomRow.style.gap, "5px");
  assert.equal(initialRandomRow.children[1], initialRandomSeed, "random switch stays beside its title");
  assert.equal(initialRandomRow.children[2].children[1], initialSeed, "Seed shares the random row");
  assert.equal(initialSwitchStack.style.gridTemplateColumns, "minmax(0, 1fr)");
  assert.equal(initialSwitchStack.style.gap, "5px");
  assert.equal(initialSwitchStack.children[0], initialRandomRow);
  assert.equal(initialSwitchStack.children[1], initialNsfwRow, "NSFW is rendered on its own row");
  assert.equal(initialNsfw.getAttribute("role"), "switch");
  assert.equal(initialNsfw.children[0].style.width, "10px");
  assert.equal(initialNsfw.children[0].style.left, "4px");
  assert.equal(initialNsfwRow.style.gridTemplateColumns, "48px 34px minmax(0, 1fr)");
  assert.equal(initialNsfwRow.children[1], initialNsfw, "NSFW switch stays beside its title");
  assert.equal(initialPrompt.style.minHeight, "88px", "positive UI design requirements need a usable editing area");
  assert.equal(initialNegativePrompt.style.minHeight, initialPrompt.style.minHeight, "local negative requirements match the design requirements height");

  const primary = findByAttr(host, "data-novaflow-ui-design-node-primary-row", "1");
  const generate = findByAttr(host, "data-novaflow-ui-design-node-generate-action", "1");
  assert.equal(findByAttr(host, "data-novaflow-ui-design-provider", "1"), null, "node model selection belongs in the left Mode panel");
  assert.equal(primary.children[0], generate, "generate remains in the primary settings row");
  assert.equal(generate.style.width, "100%");
  generate.dispatchEvent({ type: "click" });
  generate.dispatchEvent({ type: "click" });
  assert.equal(generationCalls, 1, "pending generation must dedupe repeated clicks");
  assert.equal(findByAttr(host, "data-novaflow-ui-design-node-generate-action", "1").disabled, true);
  finishGeneration({ ok: true });
  await generation;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(findByAttr(host, "data-novaflow-ui-design-node-generate-action", "1").disabled, false);

  handle.update({ ...handle.getState(), provider: "gpt" });
  assert.equal(handle.getState().provider, "gpt");
  assert.ok(findByAttr(host, "data-novaflow-ui-design-param", "gptQualityImg2img"));

  handle.update({ ...handle.getState(), provider: "google" });
  assert.ok(findByAttr(host, "data-novaflow-ui-design-param", "googleResolution"));

  handle.update({ ...handle.getState(), provider: "local" });
  const randomSeed = findByAttr(host, "data-novaflow-ui-design-param", "randomSeed");
  randomSeed.dispatchEvent({ type: "click" });
  assert.equal(handle.getState().randomSeed, false);
  assert.equal(handle.getState().seed, 0, "turning random mode off normalizes the visible fixed Seed");
  assert.equal(findByAttr(host, "data-novaflow-ui-design-param", "seed").disabled, false);
  assert.equal(findByAttr(host, "data-novaflow-ui-design-param", "randomSeed").getAttribute("aria-checked"), "false");

  preset = findByAttr(host, "data-novaflow-ui-design-output-size-preset", "1");
  preset.value = "1080x1920";
  preset.dispatchEvent({ type: "change" });
  assert.deepEqual({ ...outputSizes.at(-1) }, { width: 1080, height: 1920 });
  assert.equal(handle.getState().width, 1080);
  assert.equal(handle.getState().height, 1920);
  findByAttr(host, "data-novaflow-ui-design-output-orientation", "landscape").dispatchEvent({ type: "click" });
  assert.deepEqual({ ...outputSizes.at(-1) }, { width: 1920, height: 1080 });

  preset = findByAttr(host, "data-novaflow-ui-design-output-size-preset", "1");
  preset.value = "1024x1024";
  preset.dispatchEvent({ type: "change" });
  findByAttr(host, "data-novaflow-ui-design-output-orientation", "portrait").dispatchEvent({ type: "click" });
  assert.deepEqual({ ...outputSizes.at(-1) }, { width: 1080, height: 1920 }, "square presets use the standard portrait size");

  preset = findByAttr(host, "data-novaflow-ui-design-output-size-preset", "1");
  preset.value = "custom";
  preset.dispatchEvent({ type: "change" });
  let width = findByAttr(host, "data-novaflow-ui-design-dimension-input", "width");
  width.value = "1600";
  width.dispatchEvent({ type: "change" });
  assert.deepEqual({ ...outputSizes.at(-1) }, { width: 1600, height: 1920 });
  const height = findByAttr(host, "data-novaflow-ui-design-dimension-input", "height");
  height.value = "900";
  height.dispatchEvent({ type: "change" });
  assert.deepEqual({ ...outputSizes.at(-1) }, { width: 1600, height: 900 });

  handle.setExpanded(false);
  assert.equal(findByAttr(host, "data-novaflow-ui-design-node-params-body", "1").hidden, false, "node parameters cannot be collapsed");
  const detachedGenerate = findByAttr(host, "data-novaflow-ui-design-node-generate-action", "1");
  handle.destroy();
  detachedGenerate.dispatchEvent({ type: "click" });
  assert.equal(generationCalls, 1, "destroyed node controls must be inert");
  assert.deepEqual(authUnmounts, []);
});

test("GenerateTool blocks invalid GPT sizes and only offers truthful GPT presets", () => {
  globalThis.NovaFlowClientAuth = { mount() {}, unmount() {} };
  globalThis.NovaFlowArtGenerateModels = {
    normalizeProvider(value) {
      return value === "gpt" || value === "google" ? value : "local";
    },
  };

  const tool = freshRequire(toolPath);
  const document = new FakeDocument();
  const host = document.createElement("div");
  let generationCalls = 0;
  tool.mount({
    host,
    variant: "node",
    state: { provider: "gpt", gptQualityImg2img: "low" },
    getCanvasSize: () => ({ width: 1920, height: 1080 }),
    onOutputSizeChange() {},
    onGenerate() { generationCalls += 1; },
  });

  let preset = findByAttr(host, "data-novaflow-ui-design-output-size-preset", "1");
  assert.deepEqual(preset.children.map((option) => option.value), [
    "1024x1024",
    "1536x1024",
    "1024x1536",
    "2048x1152",
    "1152x2048",
    "2048x2048",
    "3840x2160",
    "2160x3840",
    "custom",
  ]);
  assert.equal(preset.children.some((option) => option.value === "1920x1080"), false);
  let contract = findByAttr(host, "data-novaflow-ui-design-output-contract", "gpt");
  assert.equal(contract.getAttribute("data-error"), "1");
  assert.match(contract.textContent, /16 的倍数/);
  let generate = findByAttr(host, "data-novaflow-ui-design-node-generate-action", "1");
  assert.equal(generate.disabled, true);
  generate.dispatchEvent({ type: "click" });
  assert.equal(generationCalls, 0, "invalid GPT dimensions must be blocked before onGenerate");

  preset = findByAttr(host, "data-novaflow-ui-design-output-size-preset", "1");
  preset.value = "1536x1024";
  preset.dispatchEvent({ type: "change" });
  contract = findByAttr(host, "data-novaflow-ui-design-output-contract", "gpt");
  assert.equal(contract, null, "valid GPT dimensions do not need an error notice");
  generate = findByAttr(host, "data-novaflow-ui-design-node-generate-action", "1");
  assert.equal(generate.disabled, false);
  generate.dispatchEvent({ type: "click" });
  assert.equal(generationCalls, 1);
});

test("GenerateTool labels Google size as composition canvas and always discloses returned-pixel semantics", () => {
  globalThis.NovaFlowClientAuth = { mount() {}, unmount() {} };
  globalThis.NovaFlowArtGenerateModels = {
    normalizeProvider(value) {
      return value === "gpt" || value === "google" ? value : "local";
    },
  };

  const tool = freshRequire(toolPath);
  const document = new FakeDocument();
  const host = document.createElement("div");
  tool.mount({
    host,
    variant: "node",
    state: { provider: "google", googleResolution: "2K" },
    getCanvasSize: () => ({ width: 1280, height: 720 }),
    onGenerate() {},
  });

  assert.equal(findByAttr(host, "data-novaflow-ui-design-output-size-label", "1").textContent, "构图画布");
  assert.equal(findByAttr(host, "data-novaflow-ui-design-output-size-preset", "1").getAttribute("aria-label"), "构图画布");
  const contract = findByAttr(host, "data-novaflow-ui-design-output-contract", "google");
  assert.equal(contract.getAttribute("data-error"), "0");
  assert.equal(contract.textContent, "输出规格：画幅 16:9 · 分辨率 2K，实际像素由 Google 返回");
});

test("compilePrompt keeps layout geometry in image 1 and preserves every normalized external reference", () => {
  const leakedHelperPrompt = "1920 × 1080；Hero 主视觉；region_1；x=120；y=180；w=1120；h=520；17.1 %";
  const workflow = freshRequire(workflowPath, {
    NovaFlowUiDesignLayoutGuide: {
      compileSemanticPrompt() { return leakedHelperPrompt; },
    },
  });
  assert.equal(globalThis.NovaFlowUiDesignGenerateWorkflow, workflow);
  const prompt = workflow.compilePrompt({
    name: "PROJECT_LABEL_SENTINEL",
    description: "暗色奇幻游戏商城",
    canvas: { width: 1920, height: 1080 },
    blocks: [
      { name: "Hero 主视觉", purpose: "展示核心角色和活动主题", x: 120, y: 180, width: 1120, height: 520 },
      { name: "购买按钮", description: "主要行动按钮", requirements: "高对比金色按钮，不遮挡价格", x: 1480, y: 860, width: 260, height: 96 },
      { name: "内部区域名", role: "region_2", x: 0, y: 0, width: 100, height: 100 },
    ],
  }, [
    { name: "1080x1920_region_1.png", role: "style", dataUrl: "data:image/png;base64,REF1" },
    { name: "x=120_y=180.png", role: "character", dataUrl: "data:image/png;base64,REF2" },
    { name: "material.png", role: "material", dataUrl: "data:image/png;base64,REF3" },
    { name: "general.png", role: "reference", dataUrl: "data:image/png;base64,REF4" },
  ]);

  assert.match(prompt, /横向全屏游戏界面/);
  assert.match(prompt, /暗色奇幻游戏商城/);
  assert.match(prompt, /高对比金色按钮，不遮挡价格/);
  assert.match(prompt, /展示核心角色和活动主题/);
  assert.match(prompt, /Image 1.*clean geometry guide/i);
  assert.match(prompt, /图2（风格参考）/);
  assert.match(prompt, /图3（角色参考）/);
  assert.match(prompt, /图4（材质参考）/);
  assert.match(prompt, /Image 5 is a supporting composite visual reference/);
  assert.match(prompt, /defer only to a specialized reference that explicitly owns the same visual attribute/i);
  assert.match(prompt, /图3（角色参考）：仅保持角色身份与外观特征，不复制其背景和布局/);
  assert.ok(
    prompt.indexOf("图3（角色参考）") < prompt.indexOf("Image 5 is a supporting composite visual reference"),
    "the general reference must remain subordinate to the specialized character owner",
  );
  assert.doesNotMatch(prompt, /1920\s*[×x]\s*1080/);
  assert.doesNotMatch(prompt, /PROJECT_LABEL_SENTINEL|Hero 主视觉|购买按钮|内部区域名|region_[12]|1080x1920/);
  assert.doesNotMatch(prompt, /项目：|内容职责：|生成要求：/);
  assert.doesNotMatch(prompt, /(?:^|[\s；，])(?:x|y|w|h)\s*=/i);
  assert.doesNotMatch(prompt, /\d+(?:\.\d+)?\s*%/);
  assert.equal(prompt.includes(leakedHelperPrompt), false, "compilePrompt must not trust helper-rendered geometry text");
});

test("compilePrompt uses the Google soft-occupancy contract without materializing guide regions", () => {
  const workflow = freshRequire(workflowPath);
  const prompt = workflow.compilePrompt({
    description: "高质量竖屏老虎机主界面",
    canvas: { width: 1080, height: 1920 },
    blocks: [
      { role: "header", purpose: "展示顶部奖励信息" },
      { role: "hero", purpose: "展示主题角色" },
      { role: "content", purpose: "承载老虎机核心玩法" },
      { role: "footer", purpose: "承载底部操作" },
    ],
  }, [
    { name: "style.png", role: "style", dataUrl: "data:image/png;base64,STYLE" },
  ], null, {
    provider: "google",
    layoutGuideEncoding: "soft-occupancy-heatmap-v1",
  });

  assert.match(prompt, /Image 1.*soft, low-frequency spatial occupancy guide/i);
  assert.match(prompt, /region centers, relative coverage, ordering and whitespace/i);
  assert.match(prompt, /does not imply a card, frame, panel, halo, border, container or background band/i);
  assert.match(prompt, /区域存在不代表卡片、边框、面板、光圈、容器或背景色带/);
  assert.match(prompt, /图2（风格参考）/);
  assert.doesNotMatch(prompt, /turn every guide shape into finished visual content/i);
  assert.doesNotMatch(prompt, /Image 1 is a clean geometry guide/i);
  assert.equal(prompt.includes("\n"), false);
});

test("compilePrompt explicitly binds an iteration base to its model image number", () => {
  const workflow = freshRequire(workflowPath);
  const prompt = workflow.compilePrompt({
    description: "哪吒主题老虎机",
    canvas: { width: 1080, height: 1920 },
    blocks: [{ role: "content", purpose: "3×3老虎机转轴" }],
  }, [
    {
      name: "previous-result.png",
      role: "content",
      treatment: "base",
      dataUrl: "data:image/png;base64,BASE",
    },
    {
      name: "style.png",
      role: "style",
      treatment: "guidance",
      dataUrl: "data:image/png;base64,STYLE",
    },
  ], null, {
    provider: "local",
    layoutGuideEncoding: "soft-ui-semantic-scaffold-v2",
  });

  assert.match(prompt, /图2（唯一修改底图）/);
  assert.match(prompt, /保留用户未要求改变的界面内容/);
  assert.match(prompt, /图3（风格参考）/);
});

test("compilePrompt stays on one line for the shared promptLine batch node", () => {
  const workflow = freshRequire(workflowPath);
  const prompt = workflow.compilePrompt({
    name: "UI project",
    canvas: { width: 1280, height: 720 },
    blocks: [
      { name: "Hero", purpose: "Primary visual" },
      { name: "CTA", purpose: "Primary action" },
    ],
  }, [{ name: "reference.png", dataUrl: "data:image/png;base64,REF" }]);
  assert.equal(prompt.split(/\r?\n/).filter(Boolean).length, 1);
});

test("Local redesign prompt protects exact counts, tokens, and requested controls before descriptive compaction", () => {
  const workflow = freshRequire(workflowPath);
  const filler = "ornamental hierarchy spacing rhythm ".repeat(24);
  const prompt = workflow.compileLocalRedesignModelPrompt({
    userPrompt: [
      filler,
      "Main content is an exact 3x3 grid with exactly 9 symbols including WILD and SCATTER.",
      filler,
      "Footer must contain Balance ¥1000、Bet ¥1000、WIN ¥1000、Auto、Turbo、Recharge、Menu、Spin button.",
      filler,
    ].join(" "),
    semantic: {
      canvas: { width: 720, height: 1280 },
      regions: [
        { id: "header", role: "header", purpose: filler },
        { id: "hero", role: "hero", purpose: filler },
        { id: "content", role: "content", purpose: filler },
        { id: "footer", role: "footer", purpose: filler },
      ],
    },
    references: [],
    layoutGuideImageNumber: 1,
    visualStyle: "restrained oriental fantasy, carved jade, gilded metal, woven silk, cinematic game lighting",
    contentIdentityLock: {
      exactTokens: Array.from({ length: 12 }, (_, index) => `DIRECTOR_TOKEN_${index + 1}`),
      requiredElements: Array.from({ length: 12 }, (_, index) => `Director required element ${index + 1}`),
      identityAnchors: Array.from({ length: 12 }, (_, index) => `Director identity anchor ${index + 1}`),
    },
  });

  assert.ok(prompt.length <= workflow.LOCAL_REDESIGN_MODEL_PROMPT_MAX_CHARS);
  assert.match(prompt, /\[LOCK\]MUST PRESERVE EXACTLY:/);
  assert.match(prompt, /\[CARRIER\].*全屏数字游戏界面.*禁止实体老虎机/s);
  assert.match(prompt, /\[STYLE\]restrained oriental fantasy, carved jade, gilded metal, woven silk, cinematic game lighting/);
  assert.ok(prompt.indexOf("[TARGET]") < prompt.indexOf("[CARRIER]"), "the original target must lead the carrier lock");
  assert.ok(prompt.indexOf("[CARRIER]") < prompt.indexOf("[STRUCTURE]"), "the screen-native carrier lock must precede structure");
  assert.ok(prompt.indexOf("[STRUCTURE]") < prompt.indexOf("[LOCK]"), "the uncompressed structure must precede the token lock");
  assert.match(prompt, /\[OUTPUT\]/);
  assert.match(prompt, /底栏严格分两行/);
  for (const token of ["3列×3行", "共9格", "WILD", "SCATTER", "¥1000", "Auto", "Turbo", "Recharge", "Menu", "Spin button"]) {
    assert.match(prompt, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  const structureSection = prompt.slice(prompt.indexOf("[STRUCTURE]"), prompt.indexOf("[LOCK]"));
  const lockSection = prompt.slice(prompt.indexOf("[LOCK]"), prompt.indexOf("[LAYOUT]"));
  assert.match(structureSection, /这些行列、格数和数量只约束布局，不得作为可见数字/);
  assert.doesNotMatch(lockSection, /3×3|3列|3行|9格/);
  for (let index = 1; index <= 12; index += 1) {
    assert.match(prompt, new RegExp(`DIRECTOR_TOKEN_${index}(?:\\b|\\s|\\|)`));
  }
  assert.doesNotMatch(prompt, /…/);
  assert.doesNotMatch(prompt, /[,，]\s*[；;]/);
});

test("Local redesign prompt promotes user-declared art direction into the model style section", () => {
  const workflow = freshRequire(workflowPath);
  const prompt = workflow.compileLocalRedesignModelPrompt({
    userPrompt: "东方幻想主题界面，符号采用精致玉石与火焰材质，整体高对比度、精细材质、光影统一、商业级成品视觉",
    semantic: {
      canvas: { width: 720, height: 1280 },
      regions: [{ id: "content", role: "content", purpose: "主要内容" }],
    },
    references: [],
    layoutGuideImageNumber: 1,
  });

  assert.match(prompt, /\[STYLE\]/);
  assert.match(prompt, /精致玉石与火焰材质/);
  assert.match(prompt, /商业级成品视觉/);
});

test("Local redesign prompt treats fused semantic occupancy as count guidance instead of visible artwork", () => {
  const workflow = freshRequire(workflowPath);
  const prompt = workflow.compileLocalRedesignModelPrompt({
    userPrompt: "竖屏游戏UI，主内容区严格3×3，共9格",
    semantic: {
      canvas: { width: 720, height: 1280 },
      regions: [{ role: "content", purpose: "主内容区严格3×3，共9格" }],
    },
    references: [{
      role: "reference",
      autoPrimary: true,
      proxyEncoding: "composition-semantic-fusion-raster-v1",
    }],
    referenceImageNumbers: [1],
    layoutGuideImageNumber: 2,
    referenceContentContract: {
      groups: [{
        geometry: { x: 0.05, y: 0.4, width: 0.9, height: 0.4 },
        matrix: { columns: 3, rows: 3, total: 9 },
      }],
    },
  });

  assert.match(prompt, /去身份低频构图与柔性语义中心融合代理/);
  assert.match(prompt, /亮斑必须替换为TARGET内容/);
  assert.match(prompt, /残留身份与源主题均为噪声，禁止复制/);
  assert.match(prompt, /重复项柔性亮斑仅标记内容中心，必须替换为TARGET内容/);
  assert.match(prompt, /禁止实体化为同形圆形或椭圆形光圈、卡片、按钮/);
})

test("Local redesign prompt preserves a single-axis reel count, exact symbol tokens, amounts, and control names from the real Chinese brief", () => {
  const workflow = freshRequire(workflowPath);
  const userPrompt = "竖屏720×1280哪吒主题老虎机游戏界面，顶部UI区域显示游戏标题与返回按钮，角色展示区域中央站立哪吒，手持火尖枪、脚踏风火轮、身披红绸，背景为仙境云海与莲花，角色下方显示中奖提示文字，主内容区域为3列老虎机转轴，内含哪吒主题符号如火尖枪、乾坤圈、莲花、哪吒头像、WILD标志以及字母A、K、Q、J、10，底部UI区域显示余额¥1000、投注金额¥1000、WIN¥1000以及自动、极速、充值、菜单、旋转按钮";
  const prompt = workflow.compileLocalRedesignModelPrompt({
    userPrompt,
    semantic: {
      canvas: { width: 720, height: 1280 },
      regions: [
        { role: "header", purpose: "顶部UI区域显示游戏标题与返回按钮" },
        { role: "hero", purpose: "角色展示区域中央站立哪吒" },
        { role: "content", purpose: "主内容区域为3列老虎机转轴" },
        { role: "footer", purpose: "底部UI区域显示余额、投注、WIN与操作按钮" },
      ],
    },
    references: [],
    layoutGuideImageNumber: 1,
    referenceContentContract: {
      groups: [{
        name: "主内容区域",
        matrix: { columns: 3, rows: 0, total: 0, columnsOnly: true },
      }],
    },
  });
  const lock = workflow.compileLocalPromptProtectionLock({
    userPrompt,
    regions: [
      { role: "header", purpose: "顶部UI区域显示游戏标题与返回按钮" },
      { role: "hero", purpose: "角色展示区域中央站立哪吒" },
      { role: "content", purpose: "主内容区域为3列老虎机转轴" },
      { role: "footer", purpose: "底部UI区域显示余额、投注、WIN与操作按钮" },
    ],
  });

  assert.match(prompt, /^\[TARGET\].*哪吒主题全屏数字转轴游戏界面/);
  assert.match(prompt, /严格3列，不猜测或增加列数/);
  for (const token of [
    "WILD",
    "A",
    "K",
    "Q",
    "J",
    "10",
    "余额¥1000",
    "投注金额¥1000",
    "WIN¥1000",
    "自动",
    "极速",
    "充值",
    "菜单",
    "旋转按钮",
  ]) {
    assert.match(lock, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.doesNotMatch(lock, /3列|3行|3×3|9格/);
  assert.doesNotMatch(lock, /(?:^|\s|\|)UI(?:\s|\||$)/);
  assert.doesNotMatch(lock, /wild标志以|WIN¥1000以|投注金额¥1000以/i);
  const directorLock = workflow.compileLocalPromptProtectionLock({
    userPrompt,
    contentIdentityLock: {
      exactTokens: ["1个返回按钮", "3×3", "9格", "WILD"],
    },
  });
  assert.match(directorLock, /WILD/);
  assert.doesNotMatch(directorLock, /1个返回按钮|3×3|9格/);
  const protectedTarget = prompt.slice(prompt.indexOf("[TARGET]"), prompt.indexOf("[CARRIER]"));
  const protectedLock = prompt.slice(prompt.indexOf("[LOCK]"), prompt.indexOf("[REFERENCE]"));
  assert.doesNotMatch(protectedTarget, /老虎机|slot\s+machine|reward-symbol game/i);
  assert.doesNotMatch(protectedLock, /老虎机|slot\s+machine|reward-symbol game/i);
});

test("Local redesign prompt balance-compacts all eight region identities instead of dropping middle regions", () => {
  const workflow = freshRequire(workflowPath);
  const longDescription = "保持结构参考中的区域位置、比例、留白、信息层级、内容密度和商业成品可读性，不得侵占相邻区域或增加未声明内容";
  const regions = Array.from({ length: 8 }, (_, index) => ({
    role: index === 0 ? "header" : index === 7 ? "footer" : "content",
    yNorm: index / 8,
    hNorm: 1 / 8,
    purpose: `第${index + 1}功能区域承载独立的信息与操作内容，${longDescription}`,
    requirements: `区域${index + 1}必须保持唯一身份和顺序，${longDescription}`,
  }));
  const prompt = workflow.compileLocalRedesignModelPrompt({
    userPrompt: `竖屏全屏数字游戏界面，依次包含八个功能区域，${longDescription}`,
    semantic: {
      canvas: { width: 720, height: 1280 },
      regions,
    },
    references: [],
    layoutGuideImageNumber: 1,
  });
  const layoutSection = prompt.slice(prompt.indexOf("[LAYOUT]"), prompt.indexOf("[REFERENCE]"));

  assert.ok(prompt.length <= workflow.LOCAL_REDESIGN_MODEL_PROMPT_MAX_CHARS);
  for (let index = 1; index <= 8; index += 1) {
    assert.match(layoutSection, new RegExp(`(?:\\[LAYOUT\\]|；)R${index}(?:顶部|上部|中部|下部|底部)=`));
  }
});

test("Local redesign prompt keeps TARGET, LOCK, concise retry FIX, and OUTPUT under the real long Chinese UI contract", () => {
  const workflow = freshRequire(workflowPath);
  const userPrompt = "竖屏720×1280哪吒主题老虎机游戏界面，顶部UI区域显示游戏标题与返回按钮，角色展示区域中央站立哪吒，手持火尖枪、脚踏风火轮、身披红绸，背景为仙境云海与莲花，角色下方显示中奖提示文字，主内容区域为3列老虎机转轴，内含哪吒主题符号如火尖枪、乾坤圈、莲花、哪吒头像、WILD标志、SCATTER标志以及字母A、K、Q、J、10，符号采用精致玉石与火焰材质，底部UI区域显示余额¥1000、投注金额¥1000、WIN¥1000以及自动、极速、充值、菜单、旋转按钮，整体采用中国风仙侠风格，高对比度、精细材质、光影统一、商业级全屏UI设计，功能分区清晰，控件可读性强";
  const regions = [
    {
      role: "header",
      yNorm: 0,
      hNorm: 0.1,
      purpose: "顶部UI区域显示游戏标题与返回按钮",
      requirements: "标题居中且返回按钮位于右上角，保持手机端清晰可读，不增加第二套标题与导航",
    },
    {
      role: "hero",
      yNorm: 0.1,
      hNorm: 0.28,
      purpose: "角色展示区域中央站立哪吒",
      requirements: "哪吒手持火尖枪、脚踏风火轮、身披红绸，背景融合仙境云海与莲花，角色下方只显示一条中奖提示",
    },
    {
      role: "content",
      yNorm: 0.38,
      hNorm: 0.42,
      purpose: "主内容区域为3列老虎机转轴",
      requirements: "保留参考图的转轴位置、列宽、间距与符号密度，符号只使用用户声明的哪吒主题资产与字母",
    },
    {
      role: "footer",
      yNorm: 0.8,
      hNorm: 0.2,
      purpose: "底部UI区域显示全部金额和操作按钮",
      requirements: "第一行完整显示余额、投注金额、WIN，第二行完整显示自动、极速、充值、菜单、旋转按钮",
    },
  ];
  const prompt = workflow.compileLocalRedesignModelPrompt({
    userPrompt,
    qualityCorrectionPrompt: "删除错误的第二个人物和额外功能条；恢复右上角返回按钮；补齐WILD、SCATTER、A、K、Q、J、10与底部全部金额和五个操作按钮；保持参考图既有区域位置、比例、数量与内容密度",
    semantic: {
      canvas: { width: 720, height: 1280 },
      regions,
    },
    references: [
      { role: "layout", autoPrimary: true, proxyEncoding: "composition-proxy-raster-v2" },
      { role: "material", proxyEncoding: "material-proxy-raster-v2" },
    ],
    referenceImageNumbers: [1, 2],
    layoutGuideImageNumber: 3,
    visualStyle: "东方幻想，克制古典纹样，玉石、鎏金与织物质感，高对比商业级游戏UI",
    referenceContentContract: {
      groups: [
        { name: "顶部UI区域", explicitCounts: [{ count: 1, unit: "标题" }, { count: 1, unit: "返回按钮" }] },
        { name: "角色展示区域", explicitCounts: [{ count: 1, unit: "主角" }, { count: 1, unit: "中奖提示" }] },
        { name: "主内容区域", matrix: { columns: 3, rows: 0, columnsOnly: true } },
        { name: "底部UI区域", explicitCounts: [{ count: 3, unit: "金额" }, { count: 5, unit: "操作按钮" }] },
      ],
    },
  });

  assert.ok(prompt.length <= workflow.LOCAL_REDESIGN_MODEL_PROMPT_MAX_CHARS);
  assert.match(prompt, /^\[TARGET\].*哪吒主题全屏数字转轴游戏界面/);
  assert.ok(prompt.indexOf("[TARGET]") < prompt.indexOf("[CARRIER]"));
  assert.ok(prompt.indexOf("[CARRIER]") < prompt.indexOf("[STRUCTURE]"));
  assert.ok(prompt.indexOf("[STRUCTURE]") < prompt.indexOf("[LOCK]"));
  assert.ok(prompt.indexOf("[LOCK]") < prompt.indexOf("[FIX]"));
  for (const section of ["[TARGET]", "[CARRIER]", "[STRUCTURE]", "[LOCK]", "[FIX]", "[LAYOUT]", "[REFERENCE]", "[STYLE]", "[OUTPUT]"]) {
    assert.ok(prompt.includes(section), `missing ${section}`);
  }
  const targetSection = prompt.slice(prompt.indexOf("[TARGET]"), prompt.indexOf("[CARRIER]"));
  const fixSection = prompt.slice(prompt.indexOf("[FIX]"), prompt.indexOf("[REFERENCE]"));
  assert.doesNotMatch(targetSection, /删除错误的第二个人物/);
  assert.match(fixSection, /删除错误的第二个人物/);
  assert.match(prompt, /\[STRUCTURE\].*严格3列.*不得作为可见数字/s);
  assert.match(prompt, /\[LOCK\]MUST PRESERVE EXACTLY:.*WILD.*SCATTER/s);
  assert.match(prompt, /去身份中频材质场/);
  assert.match(prompt, /只采纳局部金属高光、玉石纹理、织物颗粒/);
  assert.doesNotMatch(prompt, /16px极低频去身份彩色材质代理/);
  const layoutSection = prompt.slice(prompt.indexOf("[LAYOUT]"), prompt.indexOf("[REFERENCE]"));
  for (let index = 1; index <= 4; index += 1) {
    assert.match(layoutSection, new RegExp(`(?:\\[LAYOUT\\]|；)R${index}(?:顶部|上部|中部|下部|底部)=`));
  }
  assert.doesNotMatch(
    prompt.slice(prompt.indexOf("[LOCK]"), prompt.indexOf("[FIX]")),
    /3列|3行|3×3|9格/,
  );
  assert.match(prompt, /\[OUTPUT\]只输出一张正视、边到边/);
  assert.ok(prompt.endsWith("无编辑器元素、设备外壳、机柜、手机框、额外人物或额外功能条"));
});

test("providerCapability exposes the UI reference contract for Local, GPT, and Google", () => {
  const workflow = freshRequire(workflowPath);
  assert.deepEqual({ ...workflow.providerCapability("local") }, {
    provider: "local",
    totalReferenceLimit: 3,
    externalReferenceLimit: 2,
    reservedLayoutReferences: 1,
    negativePrompt: true,
  });
  assert.deepEqual({ ...workflow.providerCapability("gpt") }, {
    provider: "gpt",
    totalReferenceLimit: 16,
    externalReferenceLimit: 15,
    reservedLayoutReferences: 1,
    negativePrompt: false,
  });
  assert.deepEqual({ ...workflow.providerCapability("google") }, {
    provider: "google",
    totalReferenceLimit: 14,
    externalReferenceLimit: 13,
    reservedLayoutReferences: 1,
    negativePrompt: false,
  });
  assert.equal(workflow.referenceLimits.gpt, workflow.providerCapability("gpt"));
  assert.equal(workflow.providerCapability("unknown").provider, "local");
});

function createExecutionBridge(options = {}) {
  const calls = { uploads: [], build: [], requests: [], progress: [] };
  const bridge = {
    async detectBaseUrl() { return "http://127.0.0.1:8188"; },
    async requestJson(baseUrl, requestPath, init) {
      calls.requests.push({ baseUrl, path: requestPath, init });
      if (requestPath === "/prompt") return { ok: true, data: { prompt_id: "ui-prompt-1" } };
      if (requestPath === "/history/ui-prompt-1") {
        return { ok: true, data: { "ui-prompt-1": { outputs: { save: { images: [{ filename: "ui-result.png", type: "output", subfolder: "" }] } } } } };
      }
      return { ok: true, data: {} };
    },
    async fetchBlob(baseUrl, requestPath) {
      calls.fetch = { baseUrl, path: requestPath };
      return { kind: "blob" };
    },
    async uploadDataUrl(baseUrl, name, dataUrl) {
      calls.uploads.push({ baseUrl, name, dataUrl });
      return `uploaded_${calls.uploads.length}.png`;
    },
    buildRunWorkflow(buildOptions) {
      calls.build.push(buildOptions);
      return { workflow: { save: { class_type: "SaveImage", inputs: {} } }, modelKey: "fixture-model" };
    },
    async validateWorkflowNodes() { return true; },
    extractFiles(history) {
      return history?.outputs?.save?.images || [];
    },
    historyErrorMessage() { return ""; },
    async readQueueState() { return { empty: false, pending: 1 }; },
    async withTimeout(task) { return await task(); },
    async blobToDataUrl() { return "data:image/png;base64,RESULT"; },
    ...options,
  };
  return { bridge, calls };
}

function createLayoutGuideHelper() {
  return {
    createCleanLayoutGuide(semantic, options = {}) {
      return {
        kind: "ui-layout-guide",
        role: "ui_layout",
        source: "semantic-layout-compiler",
        clean: true,
        editorSnapshot: false,
        name: options.name || "ui_layout_guide.png",
        dataUrl: "data:image/png;base64,GUIDE",
        width: semantic.canvas.width,
        height: semantic.canvas.height,
        visualEncoding: options.visualEncoding || "filled-regions-only",
        semantic,
      };
    },
  };
}

test("Google generation fails closed when the soft layout guide helper is unavailable", async () => {
  const { bridge, calls } = createExecutionBridge();
  const workflow = freshRequire(workflowPath, {
    NovaFlowUiDesignLayoutGuide: undefined,
    NovaFlowArtGenerateModels: {
      normalizeProvider(value) { return value === "google" ? "google" : "local"; },
    },
  });

  await assert.rejects(() => workflow.run({
    bridge,
    provider: "google",
    project: {
      canvas: { width: 1080, height: 1920 },
      blocks: [{ role: "hero", purpose: "主题角色" }],
    },
    state: { provider: "google", width: 1080, height: 1920 },
  }), /helper is required to produce soft-occupancy-heatmap-v1/);
  assert.equal(calls.uploads.length, 0);
});

test("local txt2img prompt compiler removes reference-copy clauses, keeps digital slot semantics, and treats mobile wording as viewport context", () => {
  const workflow = freshRequire(workflowPath, {});
  const userPrompt = "参考两张老虎机成品图，重新设计一个中国风哪吒主题的老虎机界面，竖屏1080×1920，手机端清晰可读。参考图只提供风格，不复制海洋或老虎主题。";
  const target = workflow.localTxt2ImgTarget(userPrompt);
  assert.match(target, /重新设计一个中国风哪吒主题的全屏数字转轴游戏界面/);
  assert.match(target, /目标视口清晰可读/);
  assert.doesNotMatch(target, /参考图|老虎主题|手机端|1080\s*[×x]\s*1920/);
  assert.equal(workflow.resolveUiOutputCarrier(userPrompt), "screen");
  assert.equal(workflow.resolveUiOutputCarrier("不要台式老虎机，只生成全屏数字界面"), "screen");
  assert.equal(workflow.resolveUiOutputCarrier("展示一台实体老虎机机柜的产品外观"), "hardware");
  assert.equal(workflow.resolveUiOutputCarrier("展示一部手机商品的产品外观"), "hardware");

  const compiled = workflow.compileLocalTxt2ImgPrompt({
    project: { canvas: { width: 1080, height: 1920 } },
    semantic: {
      canvas: { width: 1080, height: 1920 },
      regions: [
        { role: "hero", purpose: "哪吒手持火尖枪的动态主视觉" },
        { role: "content", purpose: "3×3老虎机转轴" },
      ],
    },
    userPrompt,
    contentLockPrompt: "Dynamic content identity lock: 中国风哪吒主题; 3×3老虎机转轴; WILD; SCATTER.",
  });
  assert.match(compiled, /^Render one screen-native software interface/);
  assert.match(compiled, /polished full-screen digital reward-symbol game interface/);
  assert.match(compiled, /continuous art-directed background reaching all four image edges/);
  assert.match(compiled, /compose only the sections, controls, repeated elements and content required by the user, semantic structure or applicable reference roles/i);
  assert.match(compiled, /role-declared reference images and semantic page structure as the only source/);
  assert.match(compiled, /Do not add a standard slot template/);
  assert.doesNotMatch(compiled, /place balance, bet, win and the Spin control/);
  assert.match(compiled, /Region 1: 哪吒手持火尖枪的动态主视觉/);
  assert.match(compiled, /Region 2: 3×3数字转轴符号网格/);
  assert.match(compiled, /Output only the finished full-canvas interface\.$/);
  assert.doesNotMatch(compiled, /参考图|老虎主题|手机端|1080\s*[×x]\s*1920/);

  const hardware = workflow.compileLocalTxt2ImgPrompt({
    project: { canvas: { width: 1080, height: 1920 } },
    semantic: { canvas: { width: 1080, height: 1920 }, regions: [] },
    userPrompt: "展示一台实体老虎机机柜的产品外观",
    carrierIntent: "hardware",
  });
  assert.match(hardware, /实体老虎机机柜/);
  assert.doesNotMatch(hardware, /Render one screen-native software interface|Output only the finished full-canvas interface/);
});

test("local redesign uploads the semantic scaffold plus role-aware references and returns a generated result", async () => {
  const { bridge, calls } = createExecutionBridge();
  globalThis.NovaFlowArtGenerateExecutionBridge = bridge;
  let authContexts = 0;
  globalThis.NovaFlowClientAuth = {
    createAuthorizationContext() { authContexts += 1; return null; },
  };
  const workflow = freshRequire(workflowPath, {
    NovaFlowUiDesignLayoutGuide: createLayoutGuideHelper(),
  });
  const progress = [];
  const result = await workflow.run({
    project: {
      name: "活动页",
      canvas: { width: 1280, height: 720 },
      blocks: [{ name: "BLOCK_LABEL_SENTINEL", purpose: "活动标题" }],
      skeleton: { name: "ui-skeleton.png", dataUrl: "data:image/png;base64,SKELETON" },
    },
    refs: [
      { name: "ref-a.png", role: "layout", dataUrl: "data:image/png;base64,A" },
      { name: "ref-b.png", role: "reference", dataUrl: "data:image/png;base64,B" },
    ],
    state: {
      provider: "local",
      width: 1280,
      height: 720,
      localEditStrength: "faithful",
      localUiQualityMode: "quality",
    },
    prompt: "Keep title legible\nDo not crop CTA",
    qualityCorrectionPrompt: "Keep the original target; restore the missing title and CTA without adding any new panel.",
    negativePrompt: "blurry labels, broken buttons",
    async localReferenceTransformer(reference) {
      return {
        dataUrl: `${reference.dataUrl}_LOW_FREQUENCY`,
        width: reference.width,
        height: reference.height,
        proxyEncoding: "low-frequency-raster-v1",
      };
    },
    pollIntervalMs: 0,
    onProgress(update) { progress.push(update); },
  });

  assert.equal(authContexts, 0, "本地模型不创建云端授权上下文");
  assert.deepEqual(calls.uploads.map((item) => item.name), ["ui-skeleton.png", "ref-a.png", "ref-b.png"]);
  assert.deepEqual(
    calls.uploads.map((item) => item.dataUrl),
    [
      "data:image/png;base64,GUIDE",
      "data:image/png;base64,A",
      "data:image/png;base64,B",
    ],
    "Image 1 is the generated Gaussian scaffold; the raw editor skeleton is never uploaded",
  );
  assert.equal(calls.build.length, 1);
  assert.equal(calls.build[0].provider, "local");
  assert.equal(calls.build[0].mode, "img2img");
  assert.equal(calls.build[0].state.localUiQualityMode, "quality");
  assert.equal(calls.build[0].maxReferences, 3);
  assert.match(calls.build[0].negativePrompt, /blurry labels, broken buttons/);
  assert.match(calls.build[0].negativePrompt, /实体设备，街机机柜，老虎机机身，手机框，产品展示照/);
  assert.doesNotMatch(calls.build[0].negativePrompt, /physical hardware|joystick hardware/);
  assert.ok(calls.build[0].negativePrompt.length < 160);
  assert.equal(calls.build[0].layoutGuideEncoding, "soft-ui-semantic-scaffold-v2");
  assert.equal(calls.build[0].layoutGuide.visualEncoding, "soft-ui-semantic-scaffold-v2");
  const localPrompt = calls.build[0].prompt;
  assert.match(localPrompt, /^\[TARGET\]Keep title legible Do not crop CTA /);
  assert.match(localPrompt, /\[FIX\]Keep the original target; restore the missing title and CTA without adding any new panel\./);
  assert.match(localPrompt, /\[LAYOUT\]/);
  assert.match(localPrompt, /\[REFERENCE\]/);
  assert.match(localPrompt, /\[OUTPUT\]/);
  assert.ok(localPrompt.indexOf("[TARGET]") < localPrompt.indexOf("[STRUCTURE]"));
  assert.ok(localPrompt.indexOf("[STRUCTURE]") < localPrompt.indexOf("[FIX]"));
  assert.ok(localPrompt.indexOf("[FIX]") < localPrompt.indexOf("[REFERENCE]"));
  assert.ok(localPrompt.indexOf("[REFERENCE]") < localPrompt.indexOf("[OUTPUT]"));
  assert.match(localPrompt, /图2绑定布局/);
  assert.match(localPrompt, /图3仅辅助构图平衡、密度、材质与商业完成度/);
  assert.match(localPrompt, /图1仅表达功能区顺序、相对占比、留白与重复项数量/);
  assert.ok(
    localPrompt.length <= workflow.LOCAL_REDESIGN_MODEL_PROMPT_MAX_CHARS,
    `Local redesign model prompt must stay concise, got ${localPrompt.length}`,
  );
  assert.ok(
    localPrompt.indexOf("Keep title legible Do not crop CTA") <= Math.ceil(localPrompt.length * 0.1),
    "the exact target must appear within the first 10% of the model prompt",
  );
  assert.doesNotMatch(localPrompt, /Dynamic content identity lock:|Reference-derived content grouping contract:/);
  assert.doesNotMatch(localPrompt, /There is no visual layout reference|analysis-only/i);
  assert.doesNotMatch(localPrompt, /手机样机|phone mockup|device frame|product mockup/i);
  assert.doesNotMatch(localPrompt, /避免项/);
  assert.equal(localPrompt.includes("\n"), false, "shared promptLine must receive one UI task");
  assert.doesNotMatch(localPrompt, /1280\s*[×x]\s*720|BLOCK_LABEL_SENTINEL/);
  assert.doesNotMatch(localPrompt, /(?:^|[\s；，])(?:x|y|w|h)\s*=/i);
  assert.doesNotMatch(localPrompt, /\d+(?:\.\d+)?%/);
  assert.deepEqual(Array.from(calls.build[0].uploadedNames), ["uploaded_1.png", "uploaded_2.png", "uploaded_3.png"]);
  assert.deepEqual(Array.from(calls.build[0].referenceRoles, (item) => item.role), ["ui_layout", "layout", "reference"]);
  assert.equal(calls.build[0].referenceRoles[1].autoPrimary, false);
  assert.equal(calls.build[0].referenceRoles[1].roleSource, "");
  assert.equal(calls.build[0].referenceRoles[2].autoPrimary, false);
  assert.equal(calls.build[0].referenceSizes.length, 3);
  assert.equal(result.provider, "local");
  assert.equal(result.mode, "img2img");
  assert.equal(result.promptId, "ui-prompt-1");
  assert.equal(result.imageUrl, "data:image/png;base64,RESULT");
  assert.equal(result.dataUrl, result.imageUrl, "UI resource store consumes dataUrl while preview can keep imageUrl");
  assert.deepEqual(Array.from(result.localReferenceTreatments), ["raw", "raw"]);
  assert.deepEqual(Array.from(result.localReferenceProxyEncodings), []);
  assert.equal(result.externalReferenceCount, 2);
  assert.equal(result.analysisOnlyReferenceCount, 0);
  assert.equal(result.synthesisReferenceCount, 3);
  assert.equal(result.layoutGuideSource, "semantic-layout-compiler");
  assert.equal(result.referenceGuidedRedesign, true);
  assert.deepEqual({ ...result.localPrimaryReference }, {
    applied: false,
    strategy: "explicit-layout",
    referenceIndex: 0,
    modelImageNumber: 2,
    name: "ref-a.png",
    sourceId: "",
  });
  assert.ok(progress.some((item) => item.phase === "complete"));
});

test("two ordinary Local references fuse semantic occupancy into the primary and keep the soft guide last", async () => {
  const { bridge, calls } = createExecutionBridge();
  const directorReferenceNames = [];
  const compositionProxyCalls = [];
  const perimeterScrubCalls = [];
  const materialProxyCalls = [];
  const workflow = freshRequire(workflowPath, {
    NovaFlowUiDesignLayoutGuide: createLayoutGuideHelper(),
    NovaFlowUiDesignLocalDirectorWorkflow: {
      async run(input) {
        directorReferenceNames.push(...input.references.map((reference) => reference.name));
        return {
          used: false,
          status: "skipped",
          cached: false,
          prompt: input.prompt,
          visualStylePrompt: "",
          contentLockPrompt: "",
          referenceContentPrompt: "",
          negativePrompt: "",
        };
      },
    },
  });
  assert.equal(workflow.VERSION, "20260730-ui-design-generate-workflow-7");
  const result = await workflow.run({
    bridge,
    project: {
      canvas: { width: 720, height: 1280 },
      blocks: [{ id: "content", role: "content", purpose: "用户声明的主要界面内容" }],
    },
    refs: [
      {
        id: "ordinary-primary",
        sourceId: "ordinary-primary",
        name: "ordinary-primary.png",
        dataUrl: "data:image/png;base64,PRIMARY",
      },
      {
        id: "ordinary-secondary",
        sourceId: "ordinary-secondary",
        name: "ordinary-secondary.png",
        dataUrl: "data:image/png;base64,SECONDARY",
      },
    ],
    state: {
      provider: "local",
      width: 720,
      height: 1280,
      uiRunIntent: "redesign",
      promptMentionBindings: {
        "@参考图1": "ordinary-primary",
        "@参考图2": "ordinary-secondary",
      },
    },
    prompt: "Use @参考图1 as the primary composition reference and @参考图2 only as secondary supporting detail.",
    async localReferenceTransformer(reference, context) {
      compositionProxyCalls.push({ reference, context });
      return {
        dataUrl: "data:image/png;base64,PRIMARY_COMPOSITION_PROXY",
        width: 360,
        height: 640,
        proxyEncoding: "composition-semantic-fusion-raster-v1",
        semanticGuideFused: true,
        semanticGuideEncoding: "soft-ui-semantic-scaffold-v2",
        semanticGuideOpacity: 0.28,
      };
    },
    async localPerimeterReferenceTransformer(reference, context) {
      perimeterScrubCalls.push({ reference, context });
      return {
        dataUrl: "data:image/png;base64,PRIMARY_PERIMETER_SCRUB",
        width: 720,
        height: 1280,
        proxyEncoding: "perimeter-identity-scrub-raster-v1",
        proxyKind: "perimeter-identity-scrub",
        frequencyBand: "full-resolution-interior",
        identityReduced: true,
      };
    },
    async localMaterialReferenceTransformer(reference, context) {
      materialProxyCalls.push({ reference, context });
      return {
        dataUrl: "data:image/png;base64,SECONDARY_MATERIAL_PROXY",
        width: 180,
        height: 320,
        proxyEncoding: "material-proxy-raster-v2",
        proxyKind: "material",
        frequencyBand: "mid",
        identityReduced: true,
      };
    },
    pollIntervalMs: 0,
  });

  assert.deepEqual(
    calls.uploads.map(({ name, dataUrl }) => ({ name, dataUrl })),
    [
      { name: "ordinary-primary.png", dataUrl: "data:image/png;base64,PRIMARY_COMPOSITION_PROXY" },
      { name: "ordinary-secondary.png", dataUrl: "data:image/png;base64,SECONDARY_MATERIAL_PROXY" },
      { name: "ui_layout_guide.png", dataUrl: "data:image/png;base64,GUIDE" },
    ],
  );
  assert.deepEqual(directorReferenceNames, ["ordinary-primary.png", "ordinary-secondary.png"]);
  assert.equal(
    compositionProxyCalls.length,
    1,
    "quality must strip reference identity through the low-frequency composition proxy",
  );
  assert.equal(compositionProxyCalls[0].reference.sourceId, "ordinary-primary");
  assert.equal(compositionProxyCalls[0].context.purpose, "automatic-primary-composition-proxy");
  assert.equal(compositionProxyCalls[0].context.treatment, "composition-guidance");
  assert.equal(compositionProxyCalls[0].context.semanticGuideDataUrl, "data:image/png;base64,GUIDE");
  assert.equal(compositionProxyCalls[0].context.semanticGuideEncoding, "soft-ui-semantic-scaffold-v2");
  assert.equal(perimeterScrubCalls.length, 0);
  assert.equal(materialProxyCalls.length, 1);
  assert.equal(materialProxyCalls[0].reference.sourceId, "ordinary-secondary");
  assert.equal(materialProxyCalls[0].context.purpose, "automatic-supporting-material-proxy");
  assert.equal(materialProxyCalls[0].context.sampleMaxEdge, 192);
  assert.deepEqual(
    Array.from(calls.build[0].referenceRoles, ({
      index, role, name, sourceId, autoPrimary, roleSource,
    }) => ({
      index, role, name, sourceId, autoPrimary, roleSource,
    })),
    [
      {
        index: 0,
        role: "reference",
        name: "ordinary-primary.png",
        sourceId: "ordinary-primary",
        autoPrimary: true,
        roleSource: "auto-general-reference",
      },
      {
        index: 1,
        role: "material",
        name: "ordinary-secondary.png",
        sourceId: "ordinary-secondary",
        autoPrimary: false,
        roleSource: "auto-supporting-material-proxy",
      },
      {
        index: 2,
        role: "ui_layout",
        name: "ui_layout_guide.png",
        sourceId: "",
        autoPrimary: false,
        roleSource: "",
      },
    ],
  );
  assert.equal(calls.build[0].referenceRoles[0].treatment, "composition-guidance");
  assert.equal(calls.build[0].referenceRoles[0].proxyEncoding, "composition-semantic-fusion-raster-v1");
  assert.equal(calls.build[0].referenceRoles[1].treatment, "guidance");
  assert.equal(calls.build[0].referenceRoles[1].proxyEncoding, "material-proxy-raster-v2");
  const localPrompt = calls.build[0].prompt;
  assert.match(localPrompt, /^\[TARGET\]Use 图1 as the primary composition reference/);
  assert.match(localPrompt, /\[LAYOUT\]/);
  assert.match(localPrompt, /\[REFERENCE\]图1是去身份低频构图与柔性语义中心融合代理/);
  assert.match(localPrompt, /残留身份与源主题均为噪声，禁止复制/);
  assert.match(localPrompt, /图2是去身份中频材质场/);
  assert.match(localPrompt, /不表达布局、人物、文字、Logo、图标或主题对象/);
  assert.match(localPrompt, /仅表达功能区顺序、相对占比、留白与重复项数量/);
  assert.match(localPrompt, /\[OUTPUT\]/);
  assert.doesNotMatch(localPrompt, /style-(?:proxy|atlas)/i);
  assert.doesNotMatch(localPrompt, /@参考图[12]/);
  assert.ok(
    localPrompt.length <= workflow.LOCAL_REDESIGN_MODEL_PROMPT_MAX_CHARS,
    `Local redesign model prompt must stay concise, got ${localPrompt.length}`,
  );
  assert.ok(
    localPrompt.indexOf("Use 图1 as the primary composition reference") <= Math.ceil(localPrompt.length * 0.1),
    "the exact target must appear within the first 10% of the model prompt",
  );
  assert.doesNotMatch(localPrompt, /Dynamic content identity lock:|Reference-derived content grouping contract:/);
  assert.deepEqual(
    Array.from(calls.build[0].promptMentions, ({
      token, referenceIndex, modelImageNumber, modelLabel, sourceId,
    }) => ({
      token, referenceIndex, modelImageNumber, modelLabel, sourceId,
    })),
    [
      {
        token: "@参考图1",
        referenceIndex: 0,
        modelImageNumber: 1,
        modelLabel: "图1",
        sourceId: "ordinary-primary",
      },
      {
        token: "@参考图2",
        referenceIndex: 1,
        modelImageNumber: 2,
        modelLabel: "图2",
        sourceId: "ordinary-secondary",
      },
    ],
  );
  assert.deepEqual(Array.from(result.referenceRoles), ["reference", "material", "ui_layout"]);
  assert.deepEqual(Array.from(result.localReferenceTreatments), ["raw", "raw"]);
  assert.equal(result.referenceCount, 3);
  assert.equal(result.externalReferenceCount, 2);
  assert.equal(result.synthesisReferenceCount, 3);
  assert.equal(result.analysisOnlyReferenceCount, 0);
  assert.deepEqual(Array.from(result.analysisOnlyMentions), []);
  assert.equal(result.referenceGuidedRedesign, true);
  assert.deepEqual({ ...result.localPrimaryReference }, {
    applied: true,
    strategy: "connection-order",
    referenceIndex: 0,
    modelImageNumber: 1,
    name: "ordinary-primary.png",
    sourceId: "ordinary-primary",
    treatment: "composition-guidance",
    proxyEncoding: "composition-semantic-fusion-raster-v1",
  });
  assert.deepEqual({
    ...result.localSynthesisReferenceOrder,
    externalModelImageNumbers: Array.from(result.localSynthesisReferenceOrder.externalModelImageNumbers),
  }, {
    guideLast: true,
    layoutGuideImageNumber: 3,
    externalModelImageNumbers: [1, 2],
  });
});

test("Local performance mode still materializes the automatic primary composition proxy", async () => {
  const { bridge, calls } = createExecutionBridge();
  const compositionProxyCalls = [];
  const perimeterScrubCalls = [];
  const workflow = freshRequire(workflowPath, {
    NovaFlowUiDesignLayoutGuide: createLayoutGuideHelper(),
    NovaFlowUiDesignLocalDirectorWorkflow: {
      async run(input) {
        return {
          used: false,
          status: "skipped",
          cached: false,
          prompt: input.prompt,
          visualStylePrompt: "",
          contentLockPrompt: "",
          referenceContentPrompt: "",
          negativePrompt: "",
        };
      },
    },
  });

  const result = await workflow.run({
    bridge,
    project: {
      canvas: { width: 720, height: 1280 },
      blocks: [{ id: "content", role: "content", purpose: "Main interface content" }],
    },
    refs: [{
      id: "ordinary-primary",
      sourceId: "ordinary-primary",
      name: "ordinary-primary.png",
      role: "reference",
      dataUrl: "data:image/png;base64,PRIMARY",
    }],
    state: {
      provider: "local",
      width: 720,
      height: 1280,
      uiRunIntent: "redesign",
      localUiQualityMode: "performance",
    },
    prompt: "Redesign the full-screen UI while preserving the reference composition.",
    async localReferenceTransformer(reference, context) {
      compositionProxyCalls.push({ reference, context });
      return {
        dataUrl: "data:image/png;base64,PRIMARY_COMPOSITION_PROXY",
        width: 360,
        height: 640,
        proxyEncoding: "composition-proxy-raster-v2",
      };
    },
    async localPerimeterReferenceTransformer(reference, context) {
      perimeterScrubCalls.push({ reference, context });
      return {
        dataUrl: "data:image/png;base64,UNEXPECTED_PERIMETER_SCRUB",
        proxyEncoding: "perimeter-identity-scrub-raster-v1",
      };
    },
    pollIntervalMs: 0,
  });

  assert.equal(compositionProxyCalls.length, 1);
  assert.equal(perimeterScrubCalls.length, 0);
  assert.equal(compositionProxyCalls[0].reference.sourceId, "ordinary-primary");
  assert.equal(compositionProxyCalls[0].context.purpose, "automatic-primary-composition-proxy");
  assert.deepEqual(
    calls.uploads.map(({ name, dataUrl }) => ({ name, dataUrl })),
    [
      { name: "ordinary-primary.png", dataUrl: "data:image/png;base64,PRIMARY_COMPOSITION_PROXY" },
      { name: "ui_layout_guide.png", dataUrl: "data:image/png;base64,GUIDE" },
    ],
  );
  assert.equal(calls.build[0].referenceRoles[0].autoPrimary, true);
  assert.equal(calls.build[0].referenceRoles[0].roleSource, "auto-general-reference");
  assert.equal(calls.build[0].referenceRoles[0].treatment, "composition-guidance");
  assert.equal(calls.build[0].referenceRoles[0].proxyEncoding, "composition-proxy-raster-v2");
  assert.match(calls.build[0].prompt, /\[REFERENCE\]图1是去身份低频构图代理/);
  assert.equal(result.localPrimaryReference.treatment, "composition-guidance");
  assert.equal(result.localPrimaryReference.proxyEncoding, "composition-proxy-raster-v2");
});

test("Local synthesis places an aspect-selected composition primary before a supporting material proxy", () => {
  const workflow = freshRequire(workflowPath);
  const selection = workflow.localReferenceSynthesisSelection([
    {
      index: 0,
      sourceId: "supporting-source",
      name: "supporting.png",
      role: "material",
      proxyEncoding: "material-proxy-raster-v1",
    },
    {
      index: 1,
      sourceId: "aspect-primary",
      name: "primary.png",
      role: "reference",
      autoPrimary: true,
      proxyEncoding: "composition-proxy-raster-v2",
    },
  ], {
    applied: true,
    referenceIndex: 1,
  }, "redesign");

  assert.deepEqual(
    Array.from(selection.references, (reference) => reference.sourceId),
    ["aspect-primary", "supporting-source"],
  );
  assert.equal(selection.references[0].autoPrimary, true);
  assert.equal(selection.references[0].proxyEncoding, "composition-proxy-raster-v2");
  assert.equal(selection.references[1].proxyEncoding, "material-proxy-raster-v1");
});

test("Local ordinary-reference primary selection follows connection order instead of guessing by aspect ratio", () => {
  const workflow = freshRequire(workflowPath, {});
  const selected = workflow.localPrimaryReferencePlan([
    {
      name: "landscape-first.png",
      role: "reference",
      width: 1920,
      height: 1080,
    },
    {
      name: "portrait-second.png",
      role: "reference",
      width: 1080,
      height: 1920,
    },
  ], {
    width: 720,
    height: 1280,
  }, "redesign");

  assert.equal(selected.strategy, "connection-order");
  assert.equal(selected.referenceIndex, 0);
  assert.equal(selected.references[0].autoPrimary, true);
  assert.equal(selected.references[1].autoPrimary, undefined);

  const tied = workflow.localPrimaryReferencePlan([
    {
      name: "portrait-first.png",
      role: "reference",
      width: 720,
      height: 1280,
    },
    {
      name: "portrait-second.png",
      role: "reference",
      width: 1080,
      height: 1920,
    },
  ], {
    width: 720,
    height: 1280,
  }, "redesign");

  assert.equal(tied.referenceIndex, 0);
  assert.equal(tied.references[0].autoPrimary, true);
  assert.equal(tied.references[1].autoPrimary, undefined);
});

test("local redesign keeps user priority while director reference-content grouping reaches the final prompt", async () => {
  const { bridge, calls } = createExecutionBridge();
  const workflow = freshRequire(workflowPath, {
    NovaFlowUiDesignLayoutGuide: createLayoutGuideHelper(),
    NovaFlowUiDesignLocalDirectorWorkflow: {
      async run() {
        return {
          used: true,
          status: "directed",
          prompt: "完整导演改写不得直接覆盖用户要求",
          visualStylePrompt: "配色采用克制朱红、墨黑与鎏金；材质强调玉石与金属高光",
          contentIdentityLock: {
            schemaVersion: 1,
            source: "user-prompt",
            sourceFingerprint: "lock-1",
            identityAnchors: ["中国风哪吒主题"],
            requiredElements: ["3×3转轴"],
            exactTokens: ["WILD", "SCATTER"],
            forbidSubstitution: true,
          },
          contentLockPrompt: "Dynamic content identity lock: 中国风哪吒主题; 3×3转轴; WILD; SCATTER.",
          referenceContentContract: {
            schemaVersion: 1,
            groups: [{
              id: "content",
              order: 1,
              geometry: { x: 0, y: 0.3646, width: 1, height: 0.4688 },
              matrix: { columns: 3, rows: 3, total: 9 },
            }],
          },
          referenceContentPrompt: "Reference-derived content grouping contract: preserve exactly 1 group in the supplied order and geometry. Group 1: fixed normalized bounds x 0.0%, y 36.5%, width 100.0%, height 46.9%; exact matrix 3 columns by 3 rows, total 9 cells; preserve every explicitly declared total.",
          negativePrompt: "",
        };
      },
    },
  });

  const result = await workflow.run({
    bridge,
    project: {
      canvas: { width: 1080, height: 1920 },
      blocks: [{ id: "content", name: "主内容区域", role: "content", x: 0, y: 700, width: 1080, height: 900 }],
    },
    refs: [{ id: "ref-1", name: "style.png", dataUrl: "data:image/png;base64,STYLE" }],
    state: { provider: "local", width: 1080, height: 1920, uiRunIntent: "redesign" },
    prompt: "中国风哪吒主题，严格3×3转轴，包含WILD与SCATTER",
    async localReferenceTransformer(reference) {
      return {
        dataUrl: `${reference.dataUrl}_COMPOSITION_PROXY`,
        width: reference.width,
        height: reference.height,
        proxyEncoding: "composition-proxy-raster-v2",
      };
    },
    pollIntervalMs: 0,
  });

  const finalPrompt = calls.build[0].prompt;
  assert.match(finalPrompt, /^\[TARGET\]中国风哪吒主题，严格3×3转轴，包含WILD与SCATTER /);
  assert.match(finalPrompt, /\[LAYOUT\]R1中部=承载主要内容/);
  assert.match(finalPrompt, /严格分组共1区并保持顺序/);
  assert.match(finalPrompt, /严格3列×3行，共9格/);
  assert.match(finalPrompt, /范围x0-100%,y36-83%，内容不得越界或侵占相邻区/);
  assert.match(finalPrompt, /不得绘制分组框、坐标或本控制语句/);
  assert.match(finalPrompt, /\[REFERENCE\]图1是去身份低频构图代理/);
  assert.match(finalPrompt, /残留人物、文字、Logo、图标与源主题均为噪声，必须替换为TARGET内容/);
  assert.match(finalPrompt, /图2仅表达功能区顺序、相对占比、留白与重复项数量/);
  assert.match(finalPrompt, /\[STYLE\]配色采用克制朱红、墨黑与鎏金；材质强调玉石与金属高光/);
  assert.match(finalPrompt, /\[OUTPUT\]/);
  assert.match(finalPrompt, /WILD/);
  assert.match(finalPrompt, /SCATTER/);
  assert.doesNotMatch(finalPrompt, /(?:W(?:I(?:L(?:D)?)?)?|S(?:C(?:A(?:T(?:T(?:E(?:R)?)?)?)?)?)?)…/i);
  assert.ok(finalPrompt.indexOf("[TARGET]") < finalPrompt.indexOf("[LAYOUT]"));
  assert.ok(finalPrompt.indexOf("[LAYOUT]") < finalPrompt.indexOf("[REFERENCE]"));
  assert.ok(finalPrompt.indexOf("[REFERENCE]") < finalPrompt.indexOf("[STYLE]"));
  assert.ok(finalPrompt.indexOf("[STYLE]") < finalPrompt.indexOf("[OUTPUT]"));
  assert.ok(
    finalPrompt.length <= workflow.LOCAL_REDESIGN_MODEL_PROMPT_MAX_CHARS,
    `Local redesign model prompt must stay concise, got ${finalPrompt.length}`,
  );
  assert.ok(
    finalPrompt.indexOf("中国风哪吒主题，严格3×3转轴，包含WILD与SCATTER") <= Math.ceil(finalPrompt.length * 0.1),
    "the exact user target must appear within the first 10% of the model prompt",
  );
  assert.doesNotMatch(finalPrompt, /Dynamic content identity lock:|Reference-derived content grouping contract:/);
  assert.doesNotMatch(finalPrompt, /exact matrix 3 columns by 3 rows|fixed normalized bounds|x 0\.0%|y 36\.5%/i);
  assert.doesNotMatch(finalPrompt, /There is no visual layout reference|analysis-only/i);
  assert.doesNotMatch(finalPrompt, /手机样机|phone mockup|device frame|product mockup/i);
  assert.doesNotMatch(finalPrompt, /完整导演改写不得直接覆盖用户要求/);
  assert.equal(calls.uploads.length, 2, "Local redesign uploads the generated scaffold and the role-aware reference");
  assert.equal(calls.uploads[0].dataUrl, "data:image/png;base64,STYLE_COMPOSITION_PROXY");
  assert.equal(calls.uploads[1].dataUrl, "data:image/png;base64,GUIDE");
  assert.deepEqual(
    Array.from(calls.build[0].referenceRoles, (item) => item.role),
    ["reference", "ui_layout"],
  );
  assert.equal(result.referenceGuidedRedesign, true);
  assert.equal(result.analysisOnlyReferenceCount, 0);
  assert.equal(result.synthesisReferenceCount, 2);
  assert.deepEqual({ ...result.localPrimaryReference }, {
    applied: true,
    strategy: "connection-order",
    referenceIndex: 0,
    modelImageNumber: 1,
    name: "style.png",
    sourceId: "ref-1",
    treatment: "composition-guidance",
    proxyEncoding: "composition-proxy-raster-v2",
  });
  assert.equal(result.localContentLockPrompt, "Dynamic content identity lock: 中国风哪吒主题; 3×3转轴; WILD; SCATTER.");
  assert.equal(result.localReferenceContentPrompt, "Reference-derived content grouping contract: preserve exactly 1 group in the supplied order and geometry. Group 1: fixed normalized bounds x 0.0%, y 36.5%, width 100.0%, height 46.9%; exact matrix 3 columns by 3 rows, total 9 cells; preserve every explicitly declared total.");
  assert.deepEqual(result.localDirector.contentIdentityLock.identityAnchors, ["中国风哪吒主题"]);
});

test("Local UI iteration does not inherit the redesign-only physical-device framing contract", async () => {
  const { bridge, calls } = createExecutionBridge();
  const workflow = freshRequire(workflowPath, {
    NovaFlowUiDesignLayoutGuide: createLayoutGuideHelper(),
  });

  await workflow.run({
    bridge,
    project: {
      canvas: { width: 1080, height: 1920 },
      blocks: [{ id: "content", name: "Main content", role: "content", purpose: "Keep existing interface content" }],
    },
    refs: [{
      id: "previous-result",
      sourceId: "previous-result",
      name: "previous-result.png",
      role: "content",
      connectionKind: "iteration",
      dataUrl: "data:image/png;base64,PREVIOUS",
      width: 1080,
      height: 1920,
    }],
    state: {
      provider: "local",
      width: 1080,
      height: 1920,
      uiRunIntent: "iteration",
      iterationReferenceCount: 1,
      localUiQualityMode: "quality",
    },
    prompt: "只修改主按钮颜色，其他内容保持不变",
    pollIntervalMs: 0,
  });

  assert.equal(calls.build.length, 1);
  assert.equal(calls.build[0].state.uiRunIntent, "iteration");
  assert.equal(calls.build[0].state.localUiQualityMode, "quality");
  assert.match(calls.build[0].prompt, /本地UI修改约束/);
  assert.equal(
    calls.build[0].prompt.includes(FULLSCREEN_DIGITAL_UI_CONTRACT),
    false,
    "iteration must keep its existing base-image contract unchanged",
  );
});

test("local quality refinement uploads only the first candidate as ui_base", async () => {
  const { bridge, calls } = createExecutionBridge();
  const workflow = freshRequire(workflowPath, {
    NovaFlowUiDesignLayoutGuide: createLayoutGuideHelper(),
  });

  const result = await workflow.run({
    bridge,
    project: {
      canvas: { width: 1080, height: 1920 },
      blocks: [{ id: "content", name: "Main content", role: "content", purpose: "Required content" }],
    },
    refs: [
      { id: "style-ref", sourceId: "style-ref", name: "style.png", dataUrl: "data:image/png;base64,STYLE" },
    ],
    state: {
      provider: "local",
      width: 1080,
      height: 1920,
      uiRunIntent: "redesign",
      localUiRefinePreset: "polish",
      localUiRefineDenoise: 0.35,
      promptMentionBindings: { "@参考图1": "style-ref" },
    },
    prompt: "Keep all requested regions and improve @参考图1 material coherence.",
    qualityCorrectionPrompt: "Remove the stale TIGER logo and side payline digits; restore one WIN banner.",
    refinementCandidate: {
      id: "first-pass",
      name: "first-pass.png",
      dataUrl: "data:image/png;base64,FIRSTPASS",
      width: 1080,
      height: 1920,
    },
    pollIntervalMs: 0,
  });

  assert.deepEqual(calls.uploads.map((item) => item.name), ["first-pass.png"]);
  assert.equal(calls.build.length, 1);
  assert.equal(calls.build[0].taskProfile, "ui-design-refine");
  assert.equal(calls.build[0].layoutGuideEncoding, "ui-candidate-base-v1");
  assert.deepEqual(Array.from(calls.build[0].referenceRoles, (item) => item.role), ["ui_base"]);
  assert.match(
    calls.build[0].prompt,
    /^\[FIX - HIGHEST PRIORITY\] Remove the stale TIGER logo and side payline digits; restore one WIN banner\./,
  );
  assert.match(calls.build[0].prompt, /Image 1 is the current finished UI candidate/);
  assert.ok(
    calls.build[0].prompt.indexOf("[FIX - HIGHEST PRIORITY]")
      < calls.build[0].prompt.indexOf("Image 1 is the current finished UI candidate"),
    "the quality correction must reach the refinement model before the preservation contract",
  );
  assert.match(calls.build[0].prompt, /Do not redesign unrelated content/);
  assert.match(calls.build[0].negativePrompt, /实体设备，街机机柜，老虎机机身，手机框，产品展示照/);
  assert.doesNotMatch(calls.build[0].negativePrompt, /physical hardware|joystick hardware/);
  assert.equal(
    calls.build[0].prompt.match(/Image 1 is the current finished UI candidate/g)?.length,
    1,
    "the local refinement contract must be injected exactly once",
  );
  assert.ok(
    calls.build[0].prompt.length <= workflow.LOCAL_REFINEMENT_MODEL_PROMPT_MAX_CHARS,
    "the complete local refinement prompt must remain inside its model-facing budget",
  );
  assert.match(calls.build[0].prompt, /当前候选成品中已经建立的原始视觉方向/);
  assert.doesNotMatch(calls.build[0].prompt, /所选参考图1的视觉方向/);
  assert.doesNotMatch(calls.build[0].prompt, /Image 1 is a soft, low-frequency spatial occupancy guide/);
  assert.equal(result.localIntent, "refinement");
  assert.equal(result.synthesisReferenceCount, 1);
  assert.equal(result.analysisOnlyReferenceCount, 1);
  assert.equal(result.layoutGuideSource, "quality-refinement");
  assert.equal(result.layoutGuideEncoding, "ui-candidate-base-v1");
  assert.equal(result.repairMaskEncoding, undefined);
  assert.equal(result.repairMaskSelectedTokens, undefined);
});

test("local quality refinement uploads a semantic repair mask after the candidate without changing reference numbering or counts", async () => {
  const { bridge, calls } = createExecutionBridge();
  const workflow = freshRequire(workflowPath, {
    NovaFlowUiDesignLayoutGuide: createLayoutGuideHelper(),
  });
  const state = {
    provider: "local",
    width: 1080,
    height: 1920,
    uiRunIntent: "redesign",
    localUiRefinePreset: "enhanced-redraw",
    localUiRefineDenoise: 0.55,
    localUiRepairMaskEncoding: "semantic-repair-mask-v1",
  };

  const result = await workflow.run({
    bridge,
    project: {
      canvas: { width: 1080, height: 1920 },
      blocks: [{ id: "content", name: "Main content", role: "content", purpose: "Required content" }],
    },
    refs: [
      { id: "style-ref", sourceId: "style-ref", name: "style.png", dataUrl: "data:image/png;base64,STYLE" },
    ],
    state,
    prompt: "Restore the missing back button and WIN banner.",
    qualityCorrectionPrompt: "Repair only the missing back button and WIN banner.",
    refinementCandidate: {
      id: "first-pass",
      name: "first-pass.png",
      dataUrl: "data:image/png;base64,FIRSTPASS",
      width: 1080,
      height: 1920,
    },
    repairMask: {
      name: "semantic-repair.png",
      dataUrl: "data:image/png;base64,REPAIRMASK",
      visualEncoding: "semantic-repair-mask-v1",
      selectedTokens: ["back", "status-banner", "back"],
    },
    pollIntervalMs: 0,
  });

  assert.deepEqual(calls.uploads.map((item) => item.name), ["first-pass.png", "semantic-repair.png"]);
  assert.deepEqual(Array.from(calls.build[0].uploadedNames), ["uploaded_1.png", "uploaded_2.png"]);
  assert.deepEqual(Array.from(calls.build[0].referenceRoles, (item) => item.role), ["ui_base"]);
  assert.equal(calls.build[0].referenceSizes.length, 1);
  assert.equal(calls.build[0].state.localUiRepairMaskEncoding, "semantic-repair-mask-v1");
  assert.match(calls.build[0].prompt, /^\[MASKED TARGETS\] back, status-banner;/);
  assert.match(calls.build[0].prompt, /every listed UI item must be visibly present, distinct and legible/);
  assert.match(calls.build[0].prompt, /Image 1 is the only visual base/);
  assert.match(calls.build[0].prompt, /Reconstruct only the missing or incorrect regions/);
  assert.doesNotMatch(calls.build[0].prompt, /Do not redesign unrelated content/);
  assert.doesNotMatch(calls.build[0].prompt, /Image 1 is the current finished UI candidate/);
  assert.equal(
    calls.build[0].prompt.match(/Image 1 is the only visual base/g)?.length,
    1,
    "enhanced redraw must not append a conflicting polish contract",
  );
  assert.ok(
    calls.build[0].prompt.length <= workflow.LOCAL_REFINEMENT_MODEL_PROMPT_MAX_CHARS,
    "enhanced redraw must remain a single bounded model-facing contract",
  );
  assert.doesNotMatch(calls.build[0].prompt, /Image 2|图2|repair-mask|semantic-repair/i);
  assert.equal(result.referenceCount, 1);
  assert.equal(result.synthesisReferenceCount, 1);
  assert.equal(result.externalReferenceCount, 1);
  assert.deepEqual(Array.from(result.referenceRoles), ["ui_base"]);
  assert.equal(result.repairMaskEncoding, "semantic-repair-mask-v1");
  assert.deepEqual(Array.from(result.repairMaskSelectedTokens), ["back", "status-banner"]);
});

test("candidate-based enhanced refinement accepts only a prompt-matched structured content lock", () => {
  const workflow = freshRequire(workflowPath);
  const sourcePrompt = "USER TARGET";
  const director = globalThis.NovaFlowUiDesignLocalDirectorWorkflow;
  const prompt = workflow.compileLocalRefinementPrompt("USER TARGET", {
    localUiRefinePreset: "enhanced_redraw",
    localUiContentLockSourcePrompt: sourcePrompt,
    localUiContentLock: {
      schemaVersion: 1,
      source: "user-prompt",
      sourceFingerprint: director.compactFingerprint(sourcePrompt),
      identityAnchors: ["USER TARGET"],
      requiredElements: [],
      exactTokens: [],
      forbidSubstitution: true,
    },
    localUiContentLockPrompt: "STALE DYNAMIC CONTENT LOCK",
  });

  assert.equal(
    workflow.localRefinementContract({ localUiRefinePreset: "enhanced-redraw" }),
    workflow.CONTROLLED_STRUCTURE_REFINEMENT_CONTRACT,
  );
  assert.match(prompt, /only visual base/);
  assert.match(prompt, /Reconstruct only the missing or incorrect regions/);
  assert.match(prompt, /literal content identity lock/);
  assert.match(prompt, /screen-native software graphics on the same flat orthographic viewport/);
  assert.match(prompt, /Dynamic content identity lock derived only from the user's target/);
  assert.doesNotMatch(prompt, /STALE DYNAMIC CONTENT LOCK/);
  assert.match(prompt, /USER TARGET/);

  const stalePrompt = workflow.compileLocalRefinementPrompt("SPACE TARGET", {
    localUiRefinePreset: "enhanced-redraw",
    localUiContentLockSourcePrompt: "SPACE TARGET",
    localUiContentLock: {
      schemaVersion: 1,
      source: "user-prompt",
      sourceFingerprint: director.compactFingerprint("OLD THEME TARGET"),
      identityAnchors: ["OLD THEME"],
      requiredElements: [],
      exactTokens: [],
      forbidSubstitution: true,
    },
    localUiContentLockPrompt: "STALE OLD THEME LOCK",
  });
  assert.doesNotMatch(stalePrompt, /OLD THEME|STALE OLD THEME LOCK/);
});

test("run rejects provider-specific reference overflow before upload instead of truncating", async () => {
  const workflow = freshRequire(workflowPath);
  const project = { canvas: { width: 1280, height: 720 }, blocks: [{ purpose: "Main UI" }] };
  const cases = [
    { provider: "local", limit: 2 },
    { provider: "gpt", limit: 15 },
    { provider: "google", limit: 13 },
  ];

  for (const entry of cases) {
    const { bridge, calls } = createExecutionBridge();
    const refs = Array.from({ length: entry.limit + 1 }, (_, index) => ({
      name: `${entry.provider}-${index + 1}.png`,
      dataUrl: `data:image/png;base64,${index + 1}`,
    }));
    await assert.rejects(
      () => workflow.run({
        bridge,
        project,
        refs,
        state: { provider: entry.provider, width: 1280, height: 720 },
      }),
      new RegExp(`最多支持 ${entry.limit} 张外部参考图`),
    );
    assert.equal(calls.uploads.length, 0, `${entry.provider} overflow must fail before upload`);
    assert.equal(workflow.externalReferences(refs).length, entry.limit + 1, "normalization must not slice overflow");
  }
});

test("cloud runs pass their total reference limit and ignore local-only negative requirements", async () => {
  let releases = 0;
  globalThis.electronAPI = { runtimeProviderUsageSettlement: "preload-price-v1" };
  globalThis.NovaFlowClientAuth = {
    createAuthorizationContext() {
      return { release() { releases += 1; } };
    },
  };
  const workflow = freshRequire(workflowPath, {
    NovaFlowUiDesignLayoutGuide: createLayoutGuideHelper(),
  });
  const cases = [
    { provider: "gpt", external: 15, total: 16 },
    { provider: "google", external: 13, total: 14 },
  ];

  for (const entry of cases) {
    const { bridge, calls } = createExecutionBridge();
    const refs = Array.from({ length: entry.external }, (_, index) => ({
      name: `${entry.provider}-${index + 1}.png`,
      dataUrl: `data:image/png;base64,${index + 1}`,
    }));
    await workflow.run({
      bridge,
      project: { canvas: { width: 1280, height: 720 }, blocks: [{ purpose: "Main UI" }] },
      refs,
      state: {
        provider: entry.provider,
        width: 1280,
        height: 720,
        localUiQualityMode: "quality",
      },
      negativePrompt: "blurry labels, broken buttons",
      pollIntervalMs: 0,
    });

    assert.equal(calls.uploads.length, entry.total);
    assert.equal(calls.build.length, 1);
    assert.equal(calls.build[0].maxReferences, entry.total);
    assert.equal(calls.build[0].taskProfile, "ui-design");
    assert.equal(calls.build[0].provider, entry.provider);
    assert.equal(calls.build[0].negativePrompt, "", "cloud nodes do not own an independent negative input");
    assert.doesNotMatch(calls.build[0].prompt, /blurry labels|broken buttons|避免项/);
    assert.match(
      calls.build[0].prompt,
      /Render one screen-native software interface as the image itself/i,
      `${entry.provider} UI generation must share the carrier-neutral screen contract`,
    );
    if (entry.provider === "google") {
      assert.equal(calls.build[0].layoutGuideEncoding, "soft-occupancy-heatmap-v1");
      assert.equal(calls.build[0].layoutGuide.visualEncoding, "soft-occupancy-heatmap-v1");
      assert.match(calls.build[0].prompt, /soft, low-frequency spatial occupancy guide/i);
      assert.doesNotMatch(calls.build[0].prompt, /turn every guide shape into finished visual content/i);
      assert.match(calls.build[0].systemPrompt, /non-visual soft spatial occupancy guide/i);
      assert.deepEqual(
        Array.from(calls.build[0].referenceRoles, ({ role }) => role),
        ["ui_layout", ...Array.from({ length: entry.external }, () => "reference")],
      );
    } else {
      assert.equal(calls.build[0].layoutGuideEncoding, "filled-regions-only");
      assert.equal(calls.build[0].layoutGuide.visualEncoding, "filled-regions-only");
      assert.match(calls.build[0].prompt, /clean geometry guide/i);
      assert.match(calls.build[0].prompt, /turn every guide shape into finished visual content/i);
      assert.equal(calls.build[0].systemPrompt, "");
    }
  }
  assert.equal(releases, cases.length);
});

test("run fails cleanly when Runtime discovery or upload disconnects", async (t) => {
  const project = { skeleton: { name: "skeleton.png", dataUrl: "data:image/png;base64,S" } };
  const state = { provider: "local", width: 1280, height: 720 };

  await t.test("empty Runtime URL", async () => {
    const progress = [];
    const { bridge, calls } = createExecutionBridge({
      async detectBaseUrl() { return ""; },
    });
    globalThis.NovaFlowArtGenerateExecutionBridge = bridge;
    const workflow = freshRequire(workflowPath, {
      NovaFlowUiDesignLayoutGuide: createLayoutGuideHelper(),
    });
    await assert.rejects(() => workflow.run({
      project,
      state: { ...state },
      onProgress(update) { progress.push(update); },
    }), /Runtime/);
    assert.equal(calls.uploads.length, 0);
    assert.equal(progress.at(-1)?.phase, "error");
  });

  await t.test("upload disconnect", async () => {
    const progress = [];
    const { bridge, calls } = createExecutionBridge({
      async uploadDataUrl() { throw new Error("socket disconnected"); },
    });
    globalThis.NovaFlowArtGenerateExecutionBridge = bridge;
    const workflow = freshRequire(workflowPath, {
      NovaFlowUiDesignLayoutGuide: createLayoutGuideHelper(),
    });
    await assert.rejects(() => workflow.run({
      project,
      refs: [{
        id: "iteration-base",
        name: "iteration-base.png",
        connectionKind: "iteration",
        dataUrl: "data:image/png;base64,ITERATION",
      }],
      state: { ...state, uiRunIntent: "iteration", iterationReferenceCount: 1 },
      async localReferenceTransformer(reference) { return reference; },
      onProgress(update) { progress.push(update); },
    }), /socket disconnected/);
    assert.equal(calls.build.length, 0);
    assert.equal(progress.at(-1)?.phase, "error");
  });
});

test("run creates and always releases a cloud authorization context when cancelled", async () => {
  const controller = new AbortController();
  let releases = 0;
  globalThis.electronAPI = { runtimeProviderUsageSettlement: "preload-price-v1" };
  globalThis.NovaFlowClientAuth = {
    createAuthorizationContext() {
      return { release() { releases += 1; } };
    },
  };
  const { bridge } = createExecutionBridge({
    async requestJson(_baseUrl, requestPath) {
      if (requestPath === "/prompt") return { ok: true, data: { prompt_id: "ui-prompt-1" } };
      controller.abort();
      return { ok: true, data: { "ui-prompt-1": { outputs: {} } } };
    },
  });
  globalThis.NovaFlowArtGenerateExecutionBridge = bridge;
  const workflow = freshRequire(workflowPath);

  await assert.rejects(() => workflow.run({
    project: { skeleton: { name: "skeleton.png", dataUrl: "data:image/png;base64,S" } },
    state: { provider: "gpt", gptQualityImg2img: "low", gptSize: "1024x1024" },
    signal: controller.signal,
    pollIntervalMs: 0,
  }), (error) => error && error.name === "AbortError");
  assert.equal(releases, 1);
});

test("run blocks paid providers outside the trusted desktop settlement path", async () => {
  let authContexts = 0;
  globalThis.electronAPI = {};
  globalThis.NovaFlowClientAuth = {
    createAuthorizationContext() {
      authContexts += 1;
      return { release() {} };
    },
  };
  const { bridge, calls } = createExecutionBridge();
  globalThis.NovaFlowArtGenerateExecutionBridge = bridge;
  const workflow = freshRequire(workflowPath);

  await assert.rejects(() => workflow.run({
    project: { skeleton: { name: "skeleton.png", dataUrl: "data:image/png;base64,S" } },
    state: { provider: "gpt", gptQualityImg2img: "low", gptSize: "1024x1024" },
  }), /NovaFlow 桌面端/);
  assert.equal(authContexts, 0);
  assert.equal(calls.uploads.length, 0, "browser preview must reject paid generation before upload");
});
