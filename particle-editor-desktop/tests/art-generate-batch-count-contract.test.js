// 绘图 生成数量: one click on 开始生成 runs up to ART_GENERATE_MAX_COUNT images one after another.
// Pins the state/field wiring, the batch-wide progress mapping, the fixed-seed (seed + i) build,
// and the credit estimate scaling with the count.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "particle-editor", "novaflow-brand-runtime.js"), "utf8");
const pricingPath = path.join(root, "particle-editor", "art-generate-credit-pricing.tool.js");
const pricingSource = fs.readFileSync(pricingPath, "utf8");
const indexHtml = fs.readFileSync(path.join(root, "particle-editor", "index.html"), "utf8");

function extractFunction(input, name) {
  const start = input.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  // The body brace, not a `= {}` default parameter.
  const bodyStart = input.indexOf(") {", start) + 2;
  assert.ok(bodyStart > start, `${name} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < input.length; index += 1) {
    if (input[index] === "{") depth += 1;
    if (input[index] === "}") depth -= 1;
    if (depth === 0) return input.slice(start + 2, index + 1);
  }
  throw new Error(`${name} source is incomplete`);
}

// --- state + field wiring -------------------------------------------------------------------
assert.match(source, /const ART_GENERATE_MAX_COUNT = 10;/);
assert.match(source, /const ART_GENERATE_STATE = \{[\s\S]*?count: 1,[\s\S]*?batchIndex: 0,[\s\S]*?batchTotal: 0,[\s\S]*?running: false,/);
assert.match(source, /function renderArtGenerateCountField\(\)[\s\S]*?renderArtGenerateNumber\("生成数量", "count", 1, ART_GENERATE_MAX_COUNT\)[\s\S]*?"data-novaflow-art-generate-count-field", "1"/);
assert.match(
  source,
  /renderParameterFields\?\.\(\{[\s\S]*?\}\) \|\| \[\];\s*\/\/[^\n]*\n\s*fieldNodes\.push\(renderArtGenerateCountField\(\)\);/,
  "the count field follows the provider-specific fields (after NSFW for 本地模型)"
);

// --- runArtGenerate runs the images back to back ----------------------------------------------
const runStart = source.indexOf("  async function runArtGenerate() {");
const runEnd = source.indexOf("  function createArtGenerateExecutionBridge() {", runStart);
assert.ok(runStart > 0 && runEnd > runStart);
const runSource = source.slice(runStart, runEnd);
assert.match(runSource, /const batchCount = normalizeArtGenerateCount\(ART_GENERATE_STATE\.count\);/);
assert.match(runSource, /ART_GENERATE_STATE\.batchTotal = batchCount > 1 \? batchCount : 0;/);
assert.match(runSource, /for \(let batchIndex = 0; batchIndex < batchCount; batchIndex \+= 1\) \{\s*ART_GENERATE_STATE\.batchIndex = batchIndex;/);
assert.match(runSource, /buildArtGenerateWorkflowWithSeed\(\s*fixedSeed \? baseSeed \+ batchIndex : null,\s*\(\) => buildArtGenerateRunWorkflow\(runProvider, runMode, uploadedNames, prefix, compiledPrompt\.text, qualityCompiled\.negativePrompt, clientId, referenceSizes\)/);
assert.match(runSource, /const fixedSeed = !ART_GENERATE_STATE\.randomSeed && Number\(ART_GENERATE_STATE\.seed\) >= 0;/);
assert.match(runSource, /if \(batchIndex === 0\) \{[\s\S]*?validateArtWorkflowNodes\(baseUrl, workflow\)/, "the node set is validated once per batch");
assert.equal((runSource.match(/artRequestJson\(baseUrl, "\/prompt"/g) || []).length, 1, "one /prompt submission per image inside the loop");
assert.match(runSource, /ART_GENERATE_STATE\.results\.unshift\(result\);\s*ART_GENERATE_STATE\.selectedResultId = result\.id;\s*lastPromptId = promptId;\s*if \(batchIndex \+ 1 < batchCount\) setArtGenerateProgress\("已完成", 1, \{ promptId \}\);\s*placeArtGenerateResultIntoSource\(result\)/);
assert.match(runSource, /\}\s*clearArtGenerateBatch\(\);\s*ART_GENERATE_STATE\.running = false;\s*const completeMessage = batchCount > 1\s*\? \(runProvider === "local" \? `已生成 \$\{batchCount\} 张`/);
assert.match(runSource, /\} catch \(error\) \{\s*if \(!isArtGenerateRunCurrent\(runToken\)\) return;\s*ART_GENERATE_STATE\.running = false;[\s\S]*?const failure = artGenerateBatchProgress\([\s\S]*?clearArtGenerateBatch\(\);\s*setArtGenerateProgress\(failure\.label, failure\.pct\);\s*setArtGenerateStatus\(failure\.label, true\);/);
// art-output-warehouse.test.js slices the download loop between these two anchors; keep them.
assert.ok(runSource.includes("      const file = files[0];"));
assert.ok(runSource.includes("      const imageUrl = await artBlobToDataUrl(blob)"));
// Cancel drops the batch before its own message so an already batch-wide pct is not mapped twice.
assert.match(source, /ART_GENERATE_STATE\.running = false;\s*\/\/[^\n]*\n\s*clearArtGenerateBatch\(\);\s*setArtGenerateProgress\("\\u5df2\\u53d6\\u6d88", pct, \{ promptId \}\);/);

// --- progress mapping + seed pinning, executed ------------------------------------------------
const renders = [];
const state = {
  count: 1, batchIndex: 0, batchTotal: 0, seed: -1, randomSeed: true,
  progressLabel: "", progressPct: 0, progressPromptId: "", progressQueueRemaining: 0, progressStartedAt: 0
};
const factory = new Function(
  "ART_GENERATE_STATE", "ART_GENERATE_MAX_COUNT", "renderArtGenerateSurfaces",
  [
    extractFunction(source, "normalizeArtGenerateCount"),
    extractFunction(source, "artGenerateBatchProgress"),
    extractFunction(source, "clearArtGenerateBatch"),
    extractFunction(source, "setArtGenerateProgress"),
    extractFunction(source, "resetArtGenerateProgress"),
    extractFunction(source, "buildArtGenerateWorkflowWithSeed"),
    "return { normalizeArtGenerateCount, artGenerateBatchProgress, clearArtGenerateBatch, setArtGenerateProgress, resetArtGenerateProgress, buildArtGenerateWorkflowWithSeed };"
  ].join("\n")
);
const api = factory(state, 10, (options) => renders.push(options));

assert.equal(api.normalizeArtGenerateCount(undefined), 1);
assert.equal(api.normalizeArtGenerateCount(0), 1);
assert.equal(api.normalizeArtGenerateCount(-4), 1);
assert.equal(api.normalizeArtGenerateCount(11), 10);
assert.equal(api.normalizeArtGenerateCount("3"), 3);
assert.equal(api.normalizeArtGenerateCount(2.6), 3);
assert.equal(api.normalizeArtGenerateCount("abc"), 1);

assert.deepEqual(api.artGenerateBatchProgress("生成中..", 0.5), { label: "生成中..", pct: 0.5 }, "no batch: passthrough");
state.batchTotal = 1;
assert.deepEqual(api.artGenerateBatchProgress("生成中..", 0.5), { label: "生成中..", pct: 0.5 }, "single image: passthrough");
state.batchTotal = 4;
state.batchIndex = 1;
assert.deepEqual(api.artGenerateBatchProgress("生成中..", 0.5), { label: "第 2/4 张 · 生成中..", pct: 0.375 });
assert.deepEqual(api.artGenerateBatchProgress("已完成", 1), { label: "第 2/4 张 · 已完成", pct: 0.5 });
state.batchIndex = 3;
assert.equal(api.artGenerateBatchProgress("x", 1).pct, 1, "last image at 100% closes the batch bar");
state.batchIndex = 9;
assert.equal(api.artGenerateBatchProgress("x", 0).label, "第 4/4 张 · x", "index is clamped to the batch");

state.batchIndex = 2;
api.setArtGenerateProgress("生成中..", 0.32, { promptId: "p3", started: true });
assert.equal(state.progressLabel, "第 3/4 张 · 生成中..");
assert.equal(state.progressPct, (2 + 0.32) / 4);
assert.equal(state.progressPromptId, "p3");
assert.ok(state.progressStartedAt > 0);
assert.equal(renders.length, 1);
api.resetArtGenerateProgress();
assert.equal(state.batchTotal, 0);
assert.equal(state.batchIndex, 0);
assert.equal(state.progressPct, 0);

state.seed = 5;
state.randomSeed = true;
let seen = null;
const built = api.buildArtGenerateWorkflowWithSeed(7, () => {
  seen = { seed: state.seed, randomSeed: state.randomSeed };
  return "built";
});
assert.equal(built, "built");
assert.deepEqual(seen, { seed: 7, randomSeed: false }, "the build sees the batch seed as a fixed seed");
assert.deepEqual({ seed: state.seed, randomSeed: state.randomSeed }, { seed: 5, randomSeed: true }, "state is restored afterwards");
api.buildArtGenerateWorkflowWithSeed(null, () => {
  seen = { seed: state.seed, randomSeed: state.randomSeed };
});
assert.deepEqual(seen, { seed: 5, randomSeed: true }, "random seed: the build reads the untouched state");
assert.throws(() => api.buildArtGenerateWorkflowWithSeed(9, () => { throw new Error("boom"); }), /boom/);
assert.deepEqual({ seed: state.seed, randomSeed: state.randomSeed }, { seed: 5, randomSeed: true }, "restored even when the build throws");

// --- credit estimate scales with the count ----------------------------------------------------
const pricingContext = vm.createContext({ console });
vm.runInNewContext(pricingSource, pricingContext, { filename: pricingPath });
const pricing = pricingContext.NovaFlowArtGenerateCreditPricing;
assert.equal(typeof pricing.createSnapshot, "function");
const gptState = { provider: "gpt", mode: "txt2img", references: [] };
assert.equal(pricing.createSnapshot(gptState).count, 1);
assert.equal(pricing.createSnapshot({ ...gptState, count: 3 }).count, 3);
assert.equal(pricing.createSnapshot({ ...gptState, count: 12 }).count, 10);
assert.equal(pricing.createSnapshot({ ...gptState, count: "oops" }).count, 1);
assert.notEqual(pricing.createSnapshot({ ...gptState, count: 3 }).signature, pricing.createSnapshot(gptState).signature, "count is part of the estimate key");
assert.equal(pricing.createSnapshot({ ...gptState, count: 3 }).signature, pricing.createSnapshot({ ...gptState, count: 3 }).signature);
assert.match(pricingSource, /function readyEstimate\(snapshot, rawResult\) \{\s*const result = scalePricingResult\(rawResult, snapshot\.count\)/);
const pricingFactory = new Function(
  "MAX_COUNT",
  `${extractFunction(pricingSource, "finiteNumber")}\n${extractFunction(pricingSource, "scalePricingResult")}\nreturn scalePricingResult;`
);
const scale = pricingFactory(10);
const single = { type: "usd", usd: 0.02 };
assert.equal(scale(single, 1), single, "count 1 leaves the result untouched");
assert.deepEqual(scale(single, 3), { type: "usd", usd: 0.06 });
assert.deepEqual(scale({ type: "range_usd", min_usd: 0.01, max_usd: 0.02, format: { approximate: true } }, 4), { type: "range_usd", min_usd: 0.04, max_usd: 0.08, format: { approximate: true } });
assert.deepEqual(scale({ type: "list_usd", usd: [0.01, "n/a"] }, 2), { type: "list_usd", usd: [0.02, "n/a"] });
assert.deepEqual(scale({ usd: 0.5 }, 2), { usd: 1 });
assert.deepEqual(scale({ type: "text", text: "free" }, 5), { type: "text", text: "free" });
assert.deepEqual(scale(single, 99), { type: "usd", usd: 0.2 }, "count is clamped to MAX_COUNT");

// --- cache busters -----------------------------------------------------------------------------
assert.ok(indexHtml.includes("novaflow-brand-runtime.js?v=20260920-art-prompt-guard-1"));
assert.ok(indexHtml.includes("art-generate-credit-pricing.tool.js?v=20260920-art-credit-count-1"));

console.log("art-generate-batch-count-contract: passed");
