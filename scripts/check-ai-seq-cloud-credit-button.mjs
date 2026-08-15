import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pricingModulePath = path.join(repoRoot, "particle-editor", "ai-sequence-credit-pricing.js");
const frameModeModulePath = path.join(repoRoot, "particle-editor", "ai-sequence-frame-mode.js");
const activeBundlePath = path.join(repoRoot, "particle-editor", "assets", "index-BbIa-2NM.js");
const runtimePath = path.join(repoRoot, "particle-editor", "novaflow-brand-runtime.js");

assert.ok(
  existsSync(pricingModulePath),
  "AI sequence credit pricing module must exist before the button can show live credits",
);
assert.ok(existsSync(frameModeModulePath), "AI sequence frame-mode module must exist");

const requireFromRenderer = createRequire(path.join(repoRoot, "particle-editor", "package.json"));
const jsonata = requireFromRenderer("jsonata");
const window = {
  jsonata,
  setTimeout,
  clearTimeout,
  Intl,
  Promise,
};
window.window = window;
window.globalThis = window;

const pricingSource = readFileSync(pricingModulePath, "utf8");
const frameModeSource = readFileSync(frameModeModulePath, "utf8");
vm.runInNewContext(frameModeSource, {
  window,
  globalThis: window,
  console,
}, { filename: frameModeModulePath });
vm.runInNewContext(pricingSource, {
  window,
  globalThis: window,
  console,
  setTimeout,
  clearTimeout,
  Intl,
  Promise,
}, { filename: pricingModulePath });

const pricing = window.NovaFlowAiSequenceCreditPricing;
assert.ok(pricing, "pricing module must expose NovaFlowAiSequenceCreditPricing");
assert.equal(typeof pricing.evaluateButtonLabel, "function");

const klingBadge = {
  engine: "jsonata",
  depends_on: {
    widgets: [
      { name: "model.resolution", type: "COMBO" },
      { name: "generate_audio", type: "BOOLEAN" },
      { name: "multi_shot", type: "COMFY_DYNAMICCOMBO_V3" },
      { name: "multi_shot.duration", type: "INT" },
      { name: "multi_shot.storyboard_1_duration", type: "INT" },
      { name: "multi_shot.storyboard_2_duration", type: "INT" },
      { name: "multi_shot.storyboard_3_duration", type: "INT" },
      { name: "multi_shot.storyboard_4_duration", type: "INT" },
      { name: "multi_shot.storyboard_5_duration", type: "INT" },
      { name: "multi_shot.storyboard_6_duration", type: "INT" },
    ],
    inputs: [],
    input_groups: [],
  },
  expr: `(
    $rates := {
      "4k": {"off": 0.42, "on": 0.42},
      "1080p": {"off": 0.112, "on": 0.168},
      "720p": {"off": 0.084, "on": 0.126}
    };
    $res := $lookup(widgets, "model.resolution");
    $audio := widgets.generate_audio ? "on" : "off";
    $rate := $lookup($lookup($rates, $res), $audio);
    $ms := widgets.multi_shot;
    $isSb := $ms != "disabled";
    $n := $isSb ? $number($substring($ms, 0, 1)) : 0;
    $d1 := $lookup(widgets, "multi_shot.storyboard_1_duration");
    $d2 := $n >= 2 ? $lookup(widgets, "multi_shot.storyboard_2_duration") : 0;
    $d3 := $n >= 3 ? $lookup(widgets, "multi_shot.storyboard_3_duration") : 0;
    $d4 := $n >= 4 ? $lookup(widgets, "multi_shot.storyboard_4_duration") : 0;
    $d5 := $n >= 5 ? $lookup(widgets, "multi_shot.storyboard_5_duration") : 0;
    $d6 := $n >= 6 ? $lookup(widgets, "multi_shot.storyboard_6_duration") : 0;
    $dur := $isSb ? $d1 + $d2 + $d3 + $d4 + $d5 + $d6 : $lookup(widgets, "multi_shot.duration");
    {"type":"usd","usd": $rate * $dur}
  )`,
};

const klingOmniBadge = {
  engine: "jsonata",
  depends_on: {
    widgets: [
      { name: "duration", type: "INT" },
      { name: "resolution", type: "COMBO" },
      { name: "model_name", type: "COMBO" },
      { name: "generate_audio", type: "BOOLEAN" },
    ],
    inputs: [],
    input_groups: [],
  },
  expr: `(
    $res := widgets.resolution;
    $mode := $res = "4k" ? "4k" : ($res = "720p" ? "std" : "pro");
    $isV3 := $contains(widgets.model_name, "v3");
    $audio := $isV3 and widgets.generate_audio;
    $rates := $audio
      ? {"std": 0.112, "pro": 0.14, "4k": 0.42}
      : {"std": 0.084, "pro": 0.112, "4k": 0.42};
    {"type":"usd","usd": $lookup($rates, $mode) * widgets.duration}
  )`,
};

const seedanceReferenceBadge = {
  engine: "jsonata",
  depends_on: {
    widgets: [
      { name: "model", type: "COMFY_DYNAMICCOMBO_V3" },
      { name: "model.resolution", type: "COMBO" },
      { name: "model.duration", type: "INT" },
    ],
    inputs: [],
    input_groups: ["model.reference_videos"],
  },
  expr: `(
    $rate480 := 10044;
    $rate720 := 21600;
    $rate1080 := 48800;
    $m := widgets.model;
    $hasVideo := $lookup(inputGroups, "model.reference_videos") > 0;
    $noVideoPricePer1K := $contains($m, "fast") ? 0.008008 : 0.01001;
    $videoPricePer1K := $contains($m, "fast") ? 0.004719 : 0.006149;
    $res := $lookup(widgets, "model.resolution");
    $dur := $lookup(widgets, "model.duration");
    $rate := $res = "1080p" ? $rate1080 : $res = "720p" ? $rate720 : $rate480;
    $noVideoCost := $dur * $rate * $noVideoPricePer1K / 1000;
    $minVideoFactor := $ceil($dur * 5 / 3);
    $minVideoCost := $minVideoFactor * $rate * $videoPricePer1K / 1000;
    $maxVideoCost := (15 + $dur) * $rate * $videoPricePer1K / 1000;
    $hasVideo
      ? {"type":"range_usd","min_usd":$minVideoCost,"max_usd":$maxVideoCost,"format":{"approximate":true}}
      : {"type":"usd","usd":$noVideoCost,"format":{"approximate":true}}
  )`,
};

const klingLabel = await pricing.evaluateButtonLabel({
  mode: "cloud",
  provider: "kling",
  genType: "image_video",
  params: {
    strictFirstFrame: true,
    resolution: "1080p",
    generateAudio: true,
    storyboardCount: 1,
    storyboard1Duration: 4,
  },
}, klingBadge);
assert.equal(klingLabel, "开始生成 · 141.8积分");

const sixStoryboardParams = {
  strictFirstFrame: true,
  resolution: "720p",
  generateAudio: true,
  storyboardCount: 6,
};
for (let index = 1; index <= 6; index += 1) sixStoryboardParams[`storyboard${index}Duration`] = 4;
assert.equal(
  await pricing.evaluateButtonLabel({
    mode: "cloud",
    provider: "kling",
    genType: "image_video",
    params: sixStoryboardParams,
  }, klingBadge),
  "开始生成 · 398.8积分",
  "Kling pricing must use the same 15-second storyboard cap as the submitted workflow",
);

const omniSnapshot = {
  mode: "cloud",
  provider: "kling",
  genType: "image_video",
  params: {
    strictFirstFrame: false,
    resolution: "720p",
    generateAudio: true,
    duration: 4,
    storyboardCount: 1,
    storyboard1Duration: 4,
  },
};
assert.equal(pricing.getNodeType(omniSnapshot), "KlingOmniProImageToVideoNode");
assert.equal(await pricing.evaluateButtonLabel(omniSnapshot, klingOmniBadge), "开始生成 · 94.5积分");
assert.equal(
  pricing.getNodeType({
    mode: "cloud",
    provider: "jimeng",
    genType: "image_video",
    params: { strictFirstFrame: true },
  }),
  "ByteDance2FirstLastFrameNode",
);

const seedanceSnapshot = {
  mode: "cloud",
  provider: "jimeng",
  genType: "image_video",
  referenceVideoCount: 0,
  params: {
    model: "Seedance 2.0",
    resolution: "480p",
    duration: 7,
  },
};
assert.equal(
  await pricing.evaluateButtonLabel(seedanceSnapshot, seedanceReferenceBadge),
  "开始生成 · ~148.5积分",
);
assert.equal(
  await pricing.evaluateButtonLabel({
    ...seedanceSnapshot,
    params: { ...seedanceSnapshot.params, duration: 1 },
  }, seedanceReferenceBadge),
  "开始生成 · ~84.9积分",
  "persisted Seedance durations below the node minimum must price as 4 seconds",
);
assert.equal(
  await pricing.evaluateButtonLabel({ ...seedanceSnapshot, referenceVideoCount: 1 }, seedanceReferenceBadge),
  "开始生成 · ~156.4-286.7积分",
);

assert.equal(
  await pricing.evaluateButtonLabel({ mode: "local", provider: "kling" }, klingBadge),
  "开始生成",
);

let nodeDefinitionRequestCount = 0;
const retryButton = { isConnected: true, textContent: "开始生成" };
const retryWindow = {
  jsonata,
  setTimeout,
  clearTimeout,
  Intl,
  Promise,
  localStorage: { getItem: () => "http://127.0.0.1:8188" },
  document: { querySelector: () => retryButton },
  fetch: async (url) => {
    nodeDefinitionRequestCount += 1;
    if (nodeDefinitionRequestCount === 1) {
      return {
        ok: true,
        status: 200,
        url,
        headers: new Map(),
        json: async () => ({ KlingVideoNode: { api_node: true } }),
      };
    }
    return {
      ok: true,
      status: 200,
      url,
      headers: new Map(),
      json: async () => ({ KlingVideoNode: { price_badge: klingBadge } }),
    };
  },
};
retryWindow.window = retryWindow;
retryWindow.globalThis = retryWindow;
vm.runInNewContext(frameModeSource, {
  window: retryWindow,
  globalThis: retryWindow,
  console,
}, { filename: frameModeModulePath });
vm.runInNewContext(pricingSource, {
  window: retryWindow,
  globalThis: retryWindow,
  console,
  setTimeout,
  clearTimeout,
  Intl,
  Promise,
}, { filename: pricingModulePath });

const retrySnapshot = {
  mode: "cloud",
  provider: "kling",
  genType: "image_video",
  params: {
    strictFirstFrame: true,
    resolution: "1080p",
    generateAudio: true,
    storyboardCount: 1,
    storyboard1Duration: 4,
  },
};
assert.equal(retryWindow.NovaFlowAiSequenceCreditPricing.getButtonLabel(retrySnapshot), "开始生成");
await new Promise((resolve) => setTimeout(resolve, 400));
assert.equal(nodeDefinitionRequestCount, 2, "pricing metadata must retry after Runtime becomes available");
assert.equal(retryButton.textContent, "开始生成 · 141.8积分");

let releaseDelayedNodeDefinition;
const delayedNodeDefinition = new Promise((resolve) => {
  releaseDelayedNodeDefinition = () => resolve({
    ok: true,
    status: 200,
    url: "http://127.0.0.1:8188/object_info/KlingVideoNode",
    headers: new Map(),
    json: async () => ({ KlingVideoNode: { price_badge: klingBadge } }),
  });
});
const localModeButton = { isConnected: true, textContent: "开始生成" };
const cancellationWindow = {
  jsonata,
  setTimeout,
  clearTimeout,
  Intl,
  Promise,
  localStorage: { getItem: () => "http://127.0.0.1:8188" },
  document: { querySelector: () => localModeButton },
  fetch: async () => delayedNodeDefinition,
};
cancellationWindow.window = cancellationWindow;
cancellationWindow.globalThis = cancellationWindow;
vm.runInNewContext(frameModeSource, {
  window: cancellationWindow,
  globalThis: cancellationWindow,
  console,
}, { filename: frameModeModulePath });
vm.runInNewContext(pricingSource, {
  window: cancellationWindow,
  globalThis: cancellationWindow,
  console,
  setTimeout,
  clearTimeout,
  Intl,
  Promise,
}, { filename: pricingModulePath });

const cancellationPricing = cancellationWindow.NovaFlowAiSequenceCreditPricing;
assert.equal(cancellationPricing.getButtonLabel(retrySnapshot), "开始生成");
assert.equal(typeof cancellationPricing.reset, "function");
cancellationPricing.reset();
releaseDelayedNodeDefinition();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(
  localModeButton.textContent,
  "开始生成",
  "a cloud response must not overwrite the button after switching to local mode",
);

const bundle = readFileSync(activeBundlePath, "utf8");
const runtime = readFileSync(runtimePath, "utf8");
assert.ok(
  bundle.includes("referenceVideoCount:nfJimengVideoRef?.objectUrl?1:0"),
  "live cloud snapshot must include Seedance reference-video state",
);
assert.ok(
  bundle.includes("NovaFlowAiSequenceCreditPricing?.getButtonLabel"),
  "generate button must consume the live pricing module",
);
assert.ok(
  bundle.includes("NovaFlowAiSequenceCreditPricing?.reset?.()"),
  "local mode must cancel stale cloud pricing updates",
);
assert.ok(
  bundle.includes("NFAiSeqGetCloudWorkflowV2(nfCloudProvider,nfCloudGenType") &&
    bundle.includes("NFAiSeqPatchCloudWorkflowV2(u,{provider:nfCloudProvider,genType:nfCloudGenType"),
  "template selection, workflow patching, and pricing must consume the same cloud snapshot",
);
assert.equal(
  bundle.match(/y\(`duration`,7,NF_AI_SEQ_KLING_MAX_TOTAL_SECONDS,4\)/g)?.length,
  2,
  "both legacy Seedance workflows must submit the same 4-second minimum used by pricing",
);
assert.ok(
  runtime.includes('text.startsWith("\\u5f00\\u59cb\\u751f\\u6210")') &&
    runtime.includes('label.startsWith("\\u5f00\\u59cb\\u751f\\u6210")') &&
    runtime.includes('button.closest(\'[data-novaflow-ai-bottom-workspace="1"]\')'),
  "runtime must preserve generate-button identity for plain and priced start labels",
);
assert.ok(
  !bundle.includes("开始生成视频 · 425.4分"),
  "generate button must never fall back to a fixed historical credit label",
);

console.log("AI sequence cloud credit button contract passed.");
