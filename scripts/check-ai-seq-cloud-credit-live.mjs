import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

const repoRoot = path.resolve(import.meta.dirname, "..");
const lockedBaseUrl = String(process.env.NOVAFLOW_LOCKED_BASE_URL || "http://127.0.0.1:4783").replace(/\/+$/, "");
const comfyBaseUrl = String(process.env.NOVAFLOW_COMFY_BASE_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
const nativeFetch = globalThis.fetch.bind(globalThis);

const indexResponse = await nativeFetch(`${lockedBaseUrl}/`);
assert.equal(indexResponse.ok, true, `locked 4783 index must be available (${indexResponse.status})`);
const indexHtml = await indexResponse.text();
assert.match(indexHtml, /vendor\/jsonata\/jsonata\.min\.js\?v=2\.1\.0/);
const pricingScriptMatch = indexHtml.match(/src="\.\/(ai-sequence-credit-pricing\.js\?v=[^"]+)"/);
assert.ok(pricingScriptMatch, "locked 4783 index must load the AI sequence pricing module");

const pricingResponse = await nativeFetch(`${lockedBaseUrl}/${pricingScriptMatch[1]}`);
assert.equal(pricingResponse.ok, true, `served pricing module must be available (${pricingResponse.status})`);
const pricingSource = await pricingResponse.text();

const requireFromRenderer = createRequire(path.join(repoRoot, "particle-editor", "package.json"));
const jsonata = requireFromRenderer("jsonata");
const observedRequests = [];
const button = { isConnected: true, textContent: "开始生成" };
const window = {
  jsonata,
  setTimeout,
  clearTimeout,
  Intl,
  Promise,
  localStorage: { getItem: () => comfyBaseUrl },
  document: { querySelector: () => button },
  fetch: async (url, init = {}) => {
    observedRequests.push({ url: String(url), method: String(init.method || "GET").toUpperCase() });
    return nativeFetch(url, init);
  },
};
window.window = window;
window.globalThis = window;

vm.runInNewContext(pricingSource, {
  window,
  globalThis: window,
  console,
  setTimeout,
  clearTimeout,
  Intl,
  Promise,
}, { filename: `${lockedBaseUrl}/${pricingScriptMatch[1]}` });

const pricing = window.NovaFlowAiSequenceCreditPricing;
assert.ok(pricing, "served pricing module must initialize");

async function expectLiveLabel(snapshot, expected) {
  pricing.getButtonLabel(snapshot);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && button.textContent !== expected) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(button.textContent, expected);
}

await expectLiveLabel({
  mode: "cloud",
  provider: "kling",
  genType: "image_video",
  params: {
    resolution: "1080p",
    generateAudio: true,
    storyboardCount: 1,
    storyboard1Duration: 4,
  },
}, "开始生成 · 118.2积分");

await expectLiveLabel({
  mode: "cloud",
  provider: "kling",
  genType: "first_last",
  params: {
    resolution: "1080p",
    generateAudio: true,
    duration: 5,
  },
}, "开始生成 · 177.2积分");

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
await expectLiveLabel(seedanceSnapshot, "开始生成 · ~148.5积分");
await expectLiveLabel({
  ...seedanceSnapshot,
  params: { ...seedanceSnapshot.params, duration: 8 },
}, "开始生成 · ~169.7积分");
await expectLiveLabel({
  ...seedanceSnapshot,
  referenceVideoCount: 1,
}, "开始生成 · ~156.4-286.7积分");
await expectLiveLabel({
  ...seedanceSnapshot,
  genType: "first_last",
}, "开始生成 · ~148.5积分");

assert.ok(observedRequests.length >= 4, "live pricing must read all Kling and Seedance node definitions");
assert.ok(
  observedRequests.every(({ url, method }) => method === "GET" && new URL(url).pathname.startsWith("/object_info/")),
  `pricing display must only perform object_info GETs: ${JSON.stringify(observedRequests)}`,
);
assert.ok(observedRequests.every(({ url }) => !/\/(?:api\/)?prompt\/?$/i.test(new URL(url).pathname)));

console.log("AI sequence cloud credit live check passed without /prompt submission.");
