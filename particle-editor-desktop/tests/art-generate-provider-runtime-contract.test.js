const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const runtimePath = path.join(root, "particle-editor", "novaflow-brand-runtime.js");
const indexPath = path.join(root, "particle-editor", "index.html");
const syncPath = path.join(root, "scripts", "sync-runtime.mjs");
const checkPath = path.join(root, "scripts", "check-runtime-sync.mjs");
const buildPath = path.join(root, "particle-editor-desktop", "scripts", "build-renderer.mjs");

const source = fs.readFileSync(runtimePath, "utf8");

function extractNamedFunction(input, name) {
  const start = input.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = input.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} should have a body`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(start, index + 1);
    }
  }
  throw new Error(`${name} body is incomplete`);
}

assert.match(source, /NovaFlowArtGenerateModeTool/, "runtime should dispatch the Generate left-control tool");
assert.match(source, /NovaFlowArtGenerateProviderWorkflow/, "runtime should dispatch GPT and Google workflow adapters");
assert.match(source, /NovaFlowArtGenerateModels/, "runtime should read the provider capability registry");
assert.match(source, /NovaFlowArtGenerateIdeogramWorkflow/, "runtime should dispatch ordinary local text generation to the Ideogram workflow module");
assert.doesNotMatch(source, /qwen_image_2512|Qwen-Image-2512-Lightning/, "the retired 2512 workflow and model names must leave the Runtime source");
assert.match(source, /NovaFlowArtGenerateCreditPricing/, "runtime should dispatch the Art Generate credit-pricing tool");
assert.match(source, /createSnapshot\(/, "runtime should create one current Art credit snapshot");
assert.match(source, /getButtonLabel\(/, "runtime should delegate the idle submit label");
assert.match(source, /getProgressView\(/, "runtime should delegate prompt-scoped credit feedback");
assert.match(source, /data-novaflow-art-generate-credit-status/, "runtime should render a dedicated credit status node");
const creditRefreshSource = extractNamedFunction(source, "refreshArtGenerateCreditPresentation");
assert.doesNotMatch(creditRefreshSource, /renderArtGenerateSurfaces/, "credit updates must not rebuild the prompt editor or full Art surface");
assert.match(creditRefreshSource, /progressPromptId/, "settlement presentation must remain scoped to the active prompt");
assert.match(creditRefreshSource, /querySelectorAll/, "credit updates should patch only mounted credit controls");
assert.match(source, /novaflow-art-generate-progress-credit[\s\S]{0,260}white-space:\s*nowrap/, "credit status should stay on the fixed progress row");
assert.doesNotMatch(
  source,
  /ART_GENERATE_STATE\.provider\s*===\s*["']cloud["'][\s\S]{0,180}(?:\\u4e91\\u7aefAI\\u6682\\u672a\\u63a5\\u5165|云端AI暂未接入)/,
  "the cloud placeholder early return must be removed",
);
const providerWorkflowSource = fs.readFileSync(path.join(root, "particle-editor", "art-generate-provider.workflow.js"), "utf8");
assert.match(providerWorkflowSource, /local_workflow_image/, "cloud image workflows should use the image task type in the workflow module");
assert.match(source, /buildRunWorkflow\(/, "runtime should dispatch provider-specific workflow construction to the module");
assert.match(source, /createAuthorizationContext(?:\?\.)?\(\)/, "cloud generation should lock an opaque account context before upload and submit");
assert.match(source, /nodeIdPrefix:\s*clientId/, "the Comfy client id should namespace every provider workflow node");
assert.match(source, /sent\s*&&\s*\(sent\.error\s*\|\|/, "authorization failures should surface the bridge error instead of an empty object");
assert.match(source, /runtimeProviderUsageSettlement\s*!==\s*["']preload-price-v1["']/, "browser preview must block paid image prompts before upload");
for (const forbidden of ["createArtGeneratePriceObserver", "settleArtGenerateProviderUsage", "actualCredits", "runtimeCommitProviderUsageActual"]) {
  assert.doesNotMatch(source, new RegExp(forbidden), `renderer Runtime must not own provider Price settlement: ${forbidden}`);
}

const modelSource = fs.readFileSync(path.join(root, "particle-editor", "art-generate-model.resource.js"), "utf8");
const modeToolSource = fs.readFileSync(path.join(root, "particle-editor", "art-generate-mode.tool.js"), "utf8");
const clientAuthSource = fs.readFileSync(path.join(root, "particle-editor", "novaflow-client-auth.js"), "utf8");
const artStateStart = source.indexOf("const ART_GENERATE_STATE = {");
const artStateEnd = source.indexOf("\n  };", artStateStart);
assert.notEqual(artStateStart, -1, "the Art Generate state should exist");
assert.notEqual(artStateEnd, -1, "the Art Generate state should be complete");
const artStateSource = source.slice(artStateStart, artStateEnd);
assert.match(artStateSource, /localTextQuality:\s*["']fine["']/, "local text generation should default to the measured fine preset");
assert.match(artStateSource, /localEditStrength:\s*["']faithful["']/, "local image editing should default to the measured faithful preset");
assert.doesNotMatch(artStateSource, /\n\s*(?:steps|cfg|denoise):/, "Art Generate state must not retain hidden free workflow controls");

const localBuildSource = extractNamedFunction(source, "buildArtGenerateRunWorkflow");
const ideogramRouteSource = extractNamedFunction(source, "shouldUseArtGenerateIdeogramWorkflow");
assert.match(ideogramRouteSource, /provider === "local"/, "the Ideogram route must stay local-only");
assert.match(ideogramRouteSource, /mode === "txt2img"/, "the Ideogram route must stay text-to-image-only");
assert.match(ideogramRouteSource, /state\?\.nsfw !== true/, "NSFW text generation must stay on the existing Rapid workflow");
assert.doesNotMatch(ideogramRouteSource, /taskProfile/, "non-NSFW local text generation must never fall back to the retired 2512 workflow");
assert.match(localBuildSource, /ideogramApi\.build\(\{[\s\S]{0,420}prompt:\s*positivePrompt[\s\S]{0,420}state/, "the ordinary local text route should delegate the prompt, dimensions, seed, prefix, and state to the Ideogram module");
assert.match(localBuildSource, /ideogramBuild\?\.workflow/, "the Ideogram route should consume the module-owned workflow");

const routeContext = vm.createContext({});
vm.runInContext(`this.shouldUseIdeogram = ${ideogramRouteSource}`, routeContext);
assert.equal(routeContext.shouldUseIdeogram("local", "txt2img", { nsfw: false }, {}), true);
assert.equal(routeContext.shouldUseIdeogram("local", "txt2img", { nsfw: true }, {}), false);
assert.equal(routeContext.shouldUseIdeogram("local", "img2img", { nsfw: false }, {}), false);
assert.equal(routeContext.shouldUseIdeogram("gpt", "txt2img", { nsfw: false }, {}), false);
assert.equal(routeContext.shouldUseIdeogram("local", "txt2img", { nsfw: false }, { taskProfile: "ui-design" }), true);

const routeCalls = { ideogram: [], patch: 0, preset: 0 };
const liveRouteState = { mode: "txt2img", nsfw: false, width: 720, height: 1280, randomSeed: false, seed: 123 };
const buildContext = vm.createContext({
  ART_GENERATE_STATE: liveRouteState,
  Math,
  String,
  Number,
  window: {
    NovaFlowArtGenerateProviderWorkflow: {
      buildRunWorkflow(options) {
        return { workflow: options.localWorkflow, modelKey: options.localModelKey };
      },
    },
    NovaFlowArtGenerateIdeogramWorkflow: {
      build(options) {
        routeCalls.ideogram.push(options);
        return { workflow: { ideogram: { class_type: "KSampler" } }, modelKey: "ideogram4-instant" };
      },
    },
    NovaFlowArtGenerateModels: {
      applyLocalWorkflowPreset(workflow) {
        routeCalls.preset += 1;
        return workflow;
      },
      workflowSettings() { return {}; },
    },
  },
  shouldUseArtGenerateIdeogramWorkflow(provider, mode, state, providerOptions) {
    return routeContext.shouldUseIdeogram(provider, mode, state, providerOptions);
  },
  artWorkflowKeyForState(state) { return state.nsfw ? "txt2imgNsfw" : "txt2img"; },
  cloneArtWorkflow() { return { legacy: { class_type: "KSampler" } }; },
  cloneArtWorkflowForState() { return { legacy: { class_type: "KSampler" } }; },
  patchArtWorkflow(workflow) {
    routeCalls.patch += 1;
    return workflow;
  },
  artGenerateProviderTitle(provider) { return provider; },
});
vm.runInContext(`${localBuildSource}\nthis.buildArtGenerateRunWorkflow = buildArtGenerateRunWorkflow`, buildContext);
const ordinaryBuilt = buildContext.buildArtGenerateRunWorkflow(
  "local", "txt2img", [], "NovaFlow_Test", "ordinary prompt", "ignored negative", "client", [], liveRouteState, undefined, {},
);
assert.equal(ordinaryBuilt.modelKey, "ideogram4-instant");
assert.equal(routeCalls.ideogram.length, 1, "ordinary main Draw text generation should call the Ideogram builder exactly once");
assert.equal(routeCalls.ideogram[0].prompt, "ordinary prompt");
assert.equal(routeCalls.ideogram[0].width, 720);
assert.equal(routeCalls.ideogram[0].height, 1280);
assert.equal(routeCalls.ideogram[0].seed, 123);
assert.equal(routeCalls.ideogram[0].outputPrefix, "NovaFlow_Test");
assert.equal(routeCalls.patch, 0, "ordinary Ideogram generation must bypass the legacy workflow patcher");
assert.equal(routeCalls.preset, 0, "ordinary Ideogram generation must bypass the retired 2512 preset contract");

buildContext.buildArtGenerateRunWorkflow(
  "local", "txt2img", [], "NovaFlow_Nsfw", "prompt", "negative", "client", [],
  { ...liveRouteState, nsfw: true }, undefined, {},
);
assert.equal(routeCalls.ideogram.length, 1, "NSFW text generation must not call the Ideogram builder");
assert.equal(routeCalls.patch, 1, "NSFW text generation should retain the existing local workflow patcher");
assert.equal(routeCalls.preset, 1, "NSFW text generation should retain the existing Rapid preset path");

buildContext.buildArtGenerateRunWorkflow(
  "local", "txt2img", [], "NovaFlow_UI", "prompt", "negative", "client", [],
  { ...liveRouteState }, undefined, { taskProfile: "ui-design" },
);
assert.equal(routeCalls.ideogram.length, 2, "every local non-NSFW text route must use Ideogram after 2512 retirement");
assert.equal(routeCalls.patch, 1);
assert.equal(routeCalls.preset, 1);
assert.match(
  localBuildSource,
  /applyLocalWorkflowPreset\(localWorkflow,\s*ART_GENERATE_STATE,\s*mode\)/,
  "the local run path should apply the centralized preset after preparing the workflow",
);
assert.match(localBuildSource, /typeof modelApi\?\.applyLocalWorkflowPreset\s*!==\s*["']function["']/, "the local run path should fail closed when the preset module is unavailable");
const localPatchSource = extractNamedFunction(source, "patchArtWorkflow");
assert.doesNotMatch(localPatchSource, /ART_GENERATE_STATE\.(?:steps|cfg|denoise)/, "the legacy free steps, CFG, and denoise override must be removed");
assert.doesNotMatch(localPatchSource, /Primitive(?:Int|Float)/, "workflow preset nodes must no longer be patched through arbitrary Primitive values");
assert.match(modelSource, /function\s+localPresetFor\(/, "the model resource should own local preset selection");
assert.match(modelSource, /function\s+applyLocalWorkflowPreset\(/, "the model resource should own local workflow preset application");
const executionBridgeSource = extractNamedFunction(source, "createArtGenerateExecutionBridge");
assert.match(executionBridgeSource, /localUiRefinePreset/, "the real UI execution bridge should preserve the refinement preset");
assert.match(executionBridgeSource, /localUiRefineDenoise/, "the real UI execution bridge should preserve the refinement denoise");
assert.match(
  executionBridgeSource,
  /provider === "local" && taskProfile === "ui-design" && requestedMode === "txt2img"/,
  "only Local UI redesign may select the txt2img workflow template",
);
assert.match(
  executionBridgeSource,
  /buildArtGenerateRunWorkflow\(\s*provider,\s*state\.mode,/,
  "the execution adapter must dispatch the scoped Local UI synthesis mode",
);
assert.match(clientAuthSource, /novaflow-provider-usage-settled/, "shared client auth must refresh every account card after settlement");
assert.doesNotMatch(modeToolSource, /NovaFlowClientAuth\?\.refresh/, "Art mode must not duplicate the shared account refresh");
assert.match(modeToolSource, /NovaFlowArtGenerateCreditPricing[\s\S]{0,120}recordSettlement/, "trusted preload settlement must reach Art credit pricing");
const artCreditSource = fs.readFileSync(path.join(root, "particle-editor", "art-generate-credit-pricing.tool.js"), "utf8");
assert.doesNotMatch(artCreditSource, /NovaFlowAiSequenceCreditPricing/, "Art credit pricing must stay independent from AI Sequence pricing");

class FakeOverlayElement {
  constructor() {
    this.styles = new Map();
    this.attributes = new Map();
  }
}
const artTrigger = {};
const exportTrigger = {};
const unrelatedTrigger = {};
const overlayContext = vm.createContext({
  window: {
    NovaFlowArtGenerateModeTool: {
      ownsSelect(trigger) { return trigger === artTrigger; },
    },
  },
  DROPDOWN_CONTROLLER: { activeTrigger: artTrigger },
  HTMLElement: FakeOverlayElement,
  isNovaflowExportModalDropdownTrigger(trigger) { return trigger === exportTrigger; },
  setRawStylePropertyIfChanged(element, property, value) { element.styles.set(property, value); },
  setAttributeIfChanged(element, name, value) { element.attributes.set(name, value); },
  removeAttributeIfPresent(element, name) { element.attributes.delete(name); },
});
vm.runInContext(`this.usesNovaflowModalDropdownLayer = ${extractNamedFunction(source, "usesNovaflowModalDropdownLayer")}`, overlayContext);
assert.equal(overlayContext.usesNovaflowModalDropdownLayer(artTrigger), true, "Art Generate dropdowns must render above the high-z left workspace");
assert.equal(overlayContext.usesNovaflowModalDropdownLayer(unrelatedTrigger), false, "unrelated dropdowns must retain the standard layer contract");
vm.runInContext(`this.syncOverlay = ${extractNamedFunction(source, "syncGlobalDropdownOverlayVisualState")}`, overlayContext);
const artOverlay = new FakeOverlayElement();
overlayContext.syncOverlay(artOverlay);
assert.equal(artOverlay.styles.get("background"), "rgba(0, 0, 0, 0.58)", "Art Generate dropdowns must use the global dropdown mask");
assert.equal(artOverlay.attributes.get("data-novaflow-ai-dropdown-overlay-clear"), "0", "Art Generate dropdowns must not clear the global mask");
overlayContext.DROPDOWN_CONTROLLER.activeTrigger = exportTrigger;
const exportOverlay = new FakeOverlayElement();
overlayContext.syncOverlay(exportOverlay);
assert.equal(exportOverlay.styles.get("background"), "transparent", "export-modal dropdowns must retain their transparent modal backdrop");
assert.equal(exportOverlay.attributes.get("data-novaflow-ai-dropdown-overlay-clear"), "1", "export-modal dropdowns must retain the clear-overlay marker");
overlayContext.DROPDOWN_CONTROLLER.activeTrigger = unrelatedTrigger;
const unrelatedOverlay = new FakeOverlayElement();
overlayContext.syncOverlay(unrelatedOverlay);
assert.equal(unrelatedOverlay.styles.get("background"), "rgba(0, 0, 0, 0.58)", "unrelated dropdowns must retain the global overlay");

const modelContext = vm.createContext({ globalThis: {} });
modelContext.globalThis = modelContext;
vm.runInContext(modelSource, modelContext);
const renderKey = modelContext.NovaFlowArtGenerateModels.renderKey;
assert.notEqual(
  renderKey({ provider: "local", mode: "txt2img", nsfw: false }),
  renderKey({ provider: "local", mode: "txt2img", nsfw: true }),
  "switching the local text workflow family must invalidate the cached editor",
);
assert.notEqual(
  renderKey({ provider: "local", mode: "txt2img" }),
  renderKey({ provider: "gpt", mode: "txt2img" }),
  "switching provider in the same mode must invalidate the cached editor",
);
assert.notEqual(
  renderKey({ provider: "google", mode: "txt2img" }),
  renderKey({ provider: "google", mode: "img2img" }),
  "switching generation mode must invalidate the cached editor",
);

const index = fs.readFileSync(indexPath, "utf8");
const moduleNames = [
  "art-generate-model.resource.js",
  "art-generate-ideogram.workflow.js",
  "art-generate-provider.workflow.js",
  "art-generate-mode.tool.js",
  "art-generate-credit-pricing.tool.js",
  "art-generate-reference-drop.tool.js",
];
let lastIndex = -1;
for (const name of moduleNames) {
  const position = index.indexOf(name);
  assert.ok(position > lastIndex, `${name} should be loaded in dependency order`);
  lastIndex = position;
}
assert.ok(lastIndex < index.indexOf("novaflow-brand-runtime.js"), "provider modules should load before the brand Runtime");
assert.ok(index.indexOf("vendor/jsonata/jsonata.min.js") < index.indexOf("art-generate-credit-pricing.tool.js"), "JSONata must load before Art credit pricing");
const cacheBusters = {
  "comfyui-workflow-credit-cost.js": "20260711-art-dropdown-2",
  "art-generate-model.resource.js": "20260915-qwen-2511-restore-1",
  "art-generate-ideogram.workflow.js": "20260813-ideogram-instant-1",
  "art-generate-provider.workflow.js": "20260911-gpt-image-25-1",
  "art-generate-lora.js": "20260916-prompt-input-perf-1",
  "art-generate-mode.tool.js": "20260912-rapid-ui-clean-1",
  "runtime-fetch-proxy.js": "20260711-art-dropdown-2",
  "art-generate-credit-pricing.tool.js": "20260712-art-credit-1",
  "art-generate-reference-drop.tool.js": "20260720-art-reference-drop-1",
  "spine-split-runtime.js": "20260917-object-transfer-1",
  "novaflow-brand-runtime.js": "20260916-primary-entry-scope-1",
  "novaflow-client-auth.js": "20260916-prompt-input-perf-1",
};
for (const [scriptName, cacheBuster] of Object.entries(cacheBusters)) {
  assert.match(
    index,
    new RegExp(`${scriptName.replaceAll(".", "\\.")}\\?v=${cacheBuster}`),
    `${scriptName} should cache-bust the locked browser surface`,
  );
}
assert.match(index, /resource-mention\.tool\.css\?v=20260916-mention-surfaces-1/, "the mention CSS fix should cache-bust the locked browser surface");

const manifestNames = [...moduleNames.filter((name) => name !== "art-generate-ideogram.workflow.js"), "novaflow-client-auth.js"];
for (const manifestPath of [syncPath, checkPath, buildPath]) {
  const manifest = fs.readFileSync(manifestPath, "utf8");
  for (const name of manifestNames) {
    assert.match(manifest, new RegExp(name.replaceAll(".", "\\.")), `${path.basename(manifestPath)} should register ${name}`);
  }
}
assert.match(
  fs.readFileSync(syncPath, "utf8"),
  /art-generate-ideogram\.workflow\.js/,
  "the source Runtime sync should register the Ideogram workflow module",
);
const buildManifest = fs.readFileSync(buildPath, "utf8");
assert.match(
  buildManifest,
  /runtimeShellFiles[\s\S]*art-generate-ideogram\.workflow\.js/,
  "the packaged renderer must copy the Ideogram workflow module",
);
assert.match(
  buildManifest,
  /requiredRuntimeShellFiles[\s\S]*art-generate-ideogram\.workflow\.js/,
  "the packaged renderer must fail closed when the Ideogram workflow module is missing",
);
assert.match(
  fs.readFileSync(checkPath, "utf8"),
  /art-generate-ideogram\.workflow\.js/,
  "the Runtime hash check must cover the Ideogram workflow module",
);

console.log("art generate provider Runtime contract tests passed");
