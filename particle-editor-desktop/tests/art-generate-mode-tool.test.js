const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const toolPath = path.join(root, "particle-editor", "art-generate-mode.tool.js");
const modelPath = path.join(root, "particle-editor", "art-generate-model.resource.js");
const runtimePath = path.join(root, "particle-editor", "spine-split-runtime.js");
const brandRuntimePath = path.join(root, "particle-editor", "novaflow-brand-runtime.js");

assert.equal(fs.existsSync(toolPath), true, "the Art Generate mode tool should exist");
assert.equal(fs.existsSync(modelPath), true, "the Art Generate model resource should exist");

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.parentElement = null;
    this.textContent = "";
    this.value = "";
    this.className = "";
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

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
  }

  querySelector(tagName) {
    const expected = String(tagName || "").toUpperCase();
    for (const child of this.children) {
      if (child.tagName === expected) return child;
      const nested = child.querySelector(tagName);
      if (nested) return nested;
    }
    return null;
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

const authCalls = [];
const authUnmounts = [];
const messageListeners = [];
const settlementCalls = [];
let authRefreshes = 0;
let trustedMessageSource = null;
const context = {
  NovaFlowClientAuth: {
  mount(surfaceKey, element) {
    authCalls.push({ surfaceKey, element });
  },
  unmount(surfaceKey) {
    authUnmounts.push(surfaceKey);
  },
  refresh() {
    authRefreshes += 1;
  },
  },
  NovaFlowArtGenerateCreditPricing: {
    recordSettlement(payload) {
      if (payload?.promptId !== "prompt-a") return false;
      settlementCalls.push(payload);
      return true;
    },
  },
  addEventListener(type, listener) {
    trustedMessageSource = this;
    messageListeners.push({ type, listener });
  },
};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(modelPath, "utf8"), context, { filename: modelPath });
vm.runInNewContext(fs.readFileSync(toolPath, "utf8"), context, { filename: toolPath });
const tool = context.NovaFlowArtGenerateModeTool;
assert.ok(tool && typeof tool.mount === "function", "the tool should export mount(options)");
assert.equal(typeof tool.ownsSelect, "function", "the tool should classify Art Generate-owned selects");
assert.deepEqual(
  Array.from(tool.PROVIDER_OPTIONS, ({ value, label }) => ({ value, label })),
  [
    { value: "local", label: "本地模型" },
    { value: "gpt", label: "GPT" },
    { value: "google", label: "Google" },
  ],
  "the model options should be exact and ordered",
);

const document = new FakeDocument();
const host = document.createElement("div");
const changes = [];
const mounted = tool.mount({
  host,
  provider: "gpt",
  onProviderChange(provider) {
    changes.push(provider);
  },
});

assert.equal(host.children.length, 2, "the Generate tool should render two ordered controls");
const accountSlot = host.children[0];
const modelField = host.children[1];
assert.equal(
  accountSlot.getAttribute("data-novaflow-art-generate-account-slot"),
  "1",
  "the account slot should be first",
);
assert.equal(authCalls.length, 1, "the shared account implementation should mount once");
assert.equal(authCalls[0].surfaceKey, "art-generate");
assert.equal(authCalls[0].element, accountSlot);
const messageListener = messageListeners.find((entry) => entry.type === "message")?.listener;
assert.equal(typeof messageListener, "function", "the mode tool should bind one trusted settlement listener");
const settlementPayload = { promptId: "prompt-a", settlement: { status: "settled", charge_amount: 4.27 } };
messageListener({ source: trustedMessageSource, data: { type: "novaflow-provider-usage-settled", payload: settlementPayload } });
assert.deepEqual(settlementCalls, [settlementPayload], "trusted settlement payload should be recorded once");
assert.equal(authRefreshes, 0, "shared client auth owns settlement refreshes without a duplicate request here");
messageListener({ source: {}, data: { type: "novaflow-provider-usage-settled", payload: settlementPayload } });
assert.deepEqual(settlementCalls, [settlementPayload], "foreign-window settlement messages must be ignored");
assert.equal(authRefreshes, 0, "foreign-window settlement messages must not refresh auth");
messageListener({ source: trustedMessageSource, data: { type: "novaflow-provider-usage-settled", payload: { promptId: "prompt-b" } } });
assert.equal(authRefreshes, 0, "rejected settlement payloads must not refresh auth");
messageListener({ source: trustedMessageSource, data: { type: "unrelated-message", payload: { promptId: "prompt-b" } } });
assert.deepEqual(settlementCalls, [settlementPayload], "unrelated messages must not reach credit pricing");
assert.equal(authRefreshes, 0, "unrelated messages must not refresh auth");

const select = modelField.querySelector("select");
assert.ok(select, "the second control should contain a labelled model select");
assert.equal(tool.ownsSelect(select), true, "the provider model select should be Art Generate-owned");
assert.equal(modelField.children[0].textContent, "模型方式");
assert.equal(select.getAttribute("aria-label"), "模型方式");
assert.equal(select.value, "gpt");
assert.deepEqual(
  select.children.map((option) => ({ value: option.value, label: option.textContent })),
  [
    { value: "local", label: "本地模型" },
    { value: "gpt", label: "GPT" },
    { value: "google", label: "Google" },
  ],
);

for (const provider of ["local", "gpt", "google"]) {
  select.value = provider;
  select.dispatchEvent({ type: "change" });
}
assert.deepEqual(changes, ["local", "gpt", "google"], "change callbacks should emit provider keys");

const parameterSelect = document.createElement("select");
parameterSelect.setAttribute("data-novaflow-art-generate-select-field", "1");
assert.equal(tool.ownsSelect(parameterSelect), true, "provider parameter selects should be Art Generate-owned");
const unrelatedSelect = document.createElement("select");
assert.equal(tool.ownsSelect(unrelatedSelect), false, "unrelated native selects must keep the global dropdown behavior");

function virtualElement(tagName, attributes = {}, children = []) {
  return {
    tagName: String(tagName || "div").toUpperCase(),
    attributes,
    children: Array.isArray(children) ? children : [children],
  };
}

function findVirtualSelect(nodes, label) {
  const queue = Array.isArray(nodes) ? nodes.slice() : [nodes];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (node.tagName === "SELECT" && node.attributes?.["aria-label"] === label) return node;
    if (Array.isArray(node.children)) queue.push(...node.children);
  }
  return null;
}

function findVirtualText(nodes, text) {
  const queue = Array.isArray(nodes) ? nodes.slice() : [nodes];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;
    if (node.attributes?.text === text) return node;
    if (Array.isArray(node.children)) queue.push(...node.children);
  }
  return null;
}

function renderLocalParameters(mode, state) {
  const renderedNumbers = [];
  let rerenders = 0;
  const nodes = tool.renderParameterFields({
    state,
    provider: "local",
    mode,
    createElement: virtualElement,
    renderNumber(label, key) {
      renderedNumbers.push(key);
      return { kind: "number", label, key };
    },
    renderSeedToggle() {
      return { kind: "seed" };
    },
    nsfwSwitch: { kind: "nsfw" },
    rerender() {
      rerenders += 1;
    },
  });
  return { nodes, renderedNumbers, rerenders: () => rerenders };
}

assert.deepEqual(
  Array.from(context.NovaFlowArtGenerateModels.getCapability("local", "txt2img").fields),
  ["width", "height", "textQuality", "seed", "nsfw"],
  "local text generation must not expose free steps, CFG, or denoise controls",
);
assert.deepEqual(
  Array.from(context.NovaFlowArtGenerateModels.getCapability("local", "img2img").fields),
  ["width", "height", "editStrength", "seed", "nsfw"],
  "local image editing must not expose free steps, CFG, or denoise controls",
);

const localTextState = { provider: "local", mode: "txt2img", nsfw: false, localTextQuality: "fine" };
const localTextParameters = renderLocalParameters("txt2img", localTextState);
assert.deepEqual(localTextParameters.renderedNumbers, ["width", "height"], "local text generation should render only resolution numbers");
assert.equal(findVirtualSelect(localTextParameters.nodes, "\u8d28\u91cf"), null, "Ideogram Instant should not expose the retired 2512 quality presets");
assert.ok(findVirtualText(localTextParameters.nodes, "\u8d28\u91cf Instant"), "ordinary local text generation should show its fixed Instant quality");
assert.equal(findVirtualSelect(localTextParameters.nodes, "\u7f16\u8f91\u5f3a\u5ea6"), null, "text generation must not render the image-edit preset");

const localNsfwTextState = { provider: "local", mode: "txt2img", nsfw: true, localTextQuality: "fine" };
const localNsfwTextParameters = renderLocalParameters("txt2img", localNsfwTextState);
const qualitySelect = findVirtualSelect(localNsfwTextParameters.nodes, "\u8d28\u91cf");
assert.ok(qualitySelect, "NSFW local text generation should retain the existing Rapid quality presets");
assert.deepEqual(
  Array.from(qualitySelect.children, (option) => ({ value: option.attributes.value, label: option.children[0] })),
  [
    { value: "fast", label: "\u5feb\u901f" },
    { value: "fine", label: "\u7cbe\u7ec6" },
  ],
);
qualitySelect.attributes.onchange({ currentTarget: { value: "fast" } });
assert.equal(localNsfwTextState.localTextQuality, "fast", "NSFW quality selection should update the existing Rapid preset state");
assert.equal(localNsfwTextParameters.rerenders(), 1, "NSFW quality selection should rerender the parameter row once");

const localEditState = { provider: "local", mode: "img2img", localEditStrength: "faithful" };
const localEditParameters = renderLocalParameters("img2img", localEditState);
assert.deepEqual(localEditParameters.renderedNumbers, ["width", "height"], "local image editing should render only resolution numbers");
const editStrengthSelect = findVirtualSelect(localEditParameters.nodes, "\u7f16\u8f91\u5f3a\u5ea6");
assert.ok(editStrengthSelect, "local image editing should render one edit-strength preset select");
assert.deepEqual(
  Array.from(editStrengthSelect.children, (option) => ({ value: option.attributes.value, label: option.children[0] })),
  [
    { value: "faithful", label: "\u4fdd\u771f" },
    { value: "enhanced", label: "\u589e\u5f3a" },
  ],
);
editStrengthSelect.attributes.onchange({ currentTarget: { value: "enhanced" } });
assert.equal(localEditState.localEditStrength, "enhanced", "edit-strength selection should update the local image preset state");
assert.equal(localEditParameters.rerenders(), 1, "edit-strength selection should rerender the parameter row once");
assert.equal(findVirtualSelect(localEditParameters.nodes, "\u8d28\u91cf"), null, "image editing must not render the text quality preset");

const remounted = tool.mount({ host, provider: "google", onProviderChange: () => {} });
assert.equal(remounted.accountSlot, accountSlot, "periodic Runtime sync should preserve the account-card DOM identity");
assert.equal(remounted.select, select, "periodic Runtime sync should preserve the model-select DOM identity");
assert.equal(select.value, "google", "an idempotent remount should still synchronize the selected provider");

const disabledHost = document.createElement("div");
const disabledMount = tool.mount({ host: disabledHost, provider: "google", disabled: true });
const disabledSelect = disabledHost.children[1].querySelector("select");
assert.equal(disabledSelect.getAttribute("disabled"), "disabled", "model switching should be disabled while generation is running");
disabledMount.unmount();

assert.ok(mounted && typeof mounted.unmount === "function", "mount should return a cleanup handle");
mounted.unmount();
assert.deepEqual(authUnmounts, ["art-generate", "art-generate"]);

const runtimeSource = fs.readFileSync(runtimePath, "utf8");
const brandRuntimeSource = fs.readFileSync(brandRuntimePath, "utf8");
const toolSource = fs.readFileSync(toolPath, "utf8");
const generateStart = runtimeSource.indexOf("id: 'generate'");
const editStart = runtimeSource.indexOf("id: 'edit'", generateStart);
assert.notEqual(generateStart, -1, "the Generate section should exist");
assert.notEqual(editStart, -1, "the Edit section should follow Generate");
const generateSection = runtimeSource.slice(generateStart, editStart);
assert.doesNotMatch(generateSection, /文生图|图生图/, "Generate should not render local/cloud placeholder buttons");
assert.match(
  runtimeSource,
  /["']data-novaflow-art-generate-control-host["']\s*:\s*["']1["']/,
  "Generate should render the dedicated neutral control host",
);
assert.match(
  toolSource,
  /NovaFlowLeftPanelAccordion\?\.TOKENS\?\.bodyPadding/,
  "the Drawing Mode body should consume the shared left-panel padding token",
);
assert.doesNotMatch(
  toolSource,
  /padding-(?:left|right)["'],\s*["']11px/,
  "the old 11px one-off Drawing padding must not override the shared contract",
);
const findPanelStart = brandRuntimeSource.indexOf("function findArtGeneratePanel()");
const findPanelEnd = brandRuntimeSource.indexOf("\n  function isArtGeneratePanel", findPanelStart);
assert.notEqual(findPanelStart, -1, "the Art Generate panel lookup should exist");
assert.notEqual(findPanelEnd, -1, "the Art Generate panel lookup should have a stable boundary");
const findPanelSource = brandRuntimeSource.slice(findPanelStart, findPanelEnd);
assert.match(
  findPanelSource,
  /data-novaflow-spine-split-control-category="generate"/,
  "the renamed Mode panel should be found through its stable category marker",
);
assert.ok(
  findPanelSource.indexOf("data-novaflow-spine-split-control-category")
    < findPanelSource.indexOf("findArtGenerateEntryButtons"),
  "the stable category marker should be the primary panel lookup",
);
assert.match(
  findPanelSource,
  /ART_GENERATE_LABELS\.generate/,
  "the legacy label lookup should remain as a compatibility fallback",
);

console.log("art-generate mode tool tests passed");
