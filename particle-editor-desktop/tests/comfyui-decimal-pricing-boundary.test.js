const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const serverSource = read("particle-editor-desktop/admin-server/server.js");
const adminDataSource = read("particle-editor-desktop/license-admin-gui/admin-data.js");
const edgeSource = read("supabase/functions/novaflow-backend/index.ts");
const adminRendererSource = read("particle-editor-desktop/license-admin-gui/renderer.js");

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} should exist`);
  assert.notEqual(end, -1, `${endMarker} should follow ${startMarker}`);
  return source.slice(start, end);
}

function loadLocalPricing(source, edge = false) {
  let segment = between(source, "function parseCanonicalCreditAmount", edge ? "async function deductCredits" : "function providerBudgetSettingKey");
  if (edge) {
    segment = segment
      .replace("value: unknown", "value")
      .replace(": { amountText: string; amount: number }", "")
      .replace("payload: AnyRecord, _task: AnyRecord", "payload, _task")
      .replace(": Promise<AnyRecord>", "")
      .replaceAll(" as AnyRecord", "");
  }
  const context = vm.createContext({});
  vm.runInContext(`${segment}\nthis.calculateLocal = calculateLocalWorkflowCreditCost; this.parseCanonical = parseCanonicalCreditAmount;`, context);
  return context;
}

function loadAdminSettlementParser() {
  const segment = between(adminDataSource, "function parseCanonicalCreditAmount", "function normalizeProviderQuotaKey");
  const context = vm.createContext({});
  vm.runInContext(`${segment}\nthis.parseSettlement = parseComfyUsageSettlementPayload;`, context);
  return context;
}

const exactPayload = {
  chargeAmount: "4.270000",
  estimatedCreditCost: 1,
  pricingSource: "comfy_api_exact_price_v1",
};
const exactTask = { taskType: "local_workflow_image" };

for (const [label, context] of [
  ["local server", loadLocalPricing(serverSource)],
  ["Edge backend", loadLocalPricing(edgeSource, true)],
]) {
  test(`${label} gives canonical exact charge precedence without overwriting the estimate`, async () => {
    const pricing = await context.calculateLocal(exactPayload, exactTask);
    assert.equal(pricing.estimatedCreditCost, 1);
    assert.equal(pricing.creditCost, 4.27);
    assert.equal(pricing.chargeAmount, "4.270000");
    assert.equal(pricing.source, "comfy_api_exact_price_v1");
  });

  test(`${label} preserves video integers but leaves non-exact images pending`, async () => {
    const video = await context.calculateLocal({ estimatedCreditCost: 398.79, pricingSource: "kling_static_v1" }, { taskType: "local_workflow_video" });
    const approximateImage = await context.calculateLocal({ estimatedCreditCost: 4.27, pricingSource: "price_badge_v1" }, exactTask);
    assert.equal(video.creditCost, 399);
    assert.equal(approximateImage.estimatedCreditCost, 4.27);
    assert.equal(approximateImage.creditCost, 0, "image estimates must never become settlement charges");
    assert.equal(approximateImage.status, "pending_pricing");
    assert.equal("chargeAmount" in video, false);
  });
}

test("admin settlement parser transports exact charge text and keeps legacy integers", () => {
  const { parseSettlement } = loadAdminSettlementParser();
  const base = {
    userId: "11111111-1111-1111-1111-111111111111",
    promptId: "prompt-1",
    providerKey: "comfyui",
    modelKey: "model",
  };
  const exact = parseSettlement({ ...base, taskType: "local_workflow_image", ...exactPayload });
  const video = parseSettlement({ ...base, taskType: "local_workflow_video", estimatedCreditCost: 398.79, chargeAmount: 398.79, pricingSource: "kling_static_v1" });
  assert.equal(exact.estimatedCreditCost, 1);
  assert.equal(exact.chargeAmount, "4.270000");
  assert.equal(video.chargeAmount, 399);
});

test("all exact-price trust boundaries reject non-canonical or zero amounts", async () => {
  const local = loadLocalPricing(serverSource);
  const edge = loadLocalPricing(edgeSource, true);
  const admin = loadAdminSettlementParser();
  const invalid = [4.27, "4", "4.27", "0.000000", "4.2700001", "4e0", " 4.270000", "4.270000 ", "-1.000000", "04.270000", "123456789012345.000000"];
  for (const value of invalid) {
    await assert.rejects(() => local.calculateLocal({ ...exactPayload, chargeAmount: value }, exactTask), /canonical/i);
    await assert.rejects(() => edge.calculateLocal({ ...exactPayload, chargeAmount: value }, exactTask), /canonical/i);
    assert.throws(() => admin.parseSettlement({
      userId: "11111111-1111-1111-1111-111111111111",
      promptId: "prompt-1",
      providerKey: "comfyui",
      taskType: "local_workflow_image",
      ...exactPayload,
      chargeAmount: value,
    }), /canonical/i);
  }
});

test("admin provider balance inputs preserve six decimals without grouping", () => {
  const segment = between(adminRendererSource, "function formatProviderBalanceInput", "function shortHash");
  const context = vm.createContext({});
  vm.runInContext(`${segment}\nthis.formatInput = formatProviderBalanceInput;`, context);
  assert.equal(context.formatInput(4.123456), "4.123456");
  assert.equal(context.formatInput(4.27), "4.27");
  assert.equal(context.formatInput(4), "4");
});
