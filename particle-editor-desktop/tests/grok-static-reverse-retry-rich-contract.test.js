const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "../..");
const cloudPath = path.join(root, "supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs");
const adminPath = path.join(root, "particle-editor-desktop/admin-server/server.js");
const cloudSource = fs.readFileSync(cloudPath, "utf8").replaceAll("\r\n", "\n");
const adminSource = fs.readFileSync(adminPath, "utf8").replaceAll("\r\n", "\n");

function sourceSlice(source, startNeedle, endNeedle, label) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, `${label} must exist`);
  return source.slice(start, end);
}

function safeWarriorIr(overrides = {}) {
  return {
    schema: "nf.visual.v2",
    asset_type: "日式动漫女性武士角色插画",
    entities: [
      {
        name: "女武士",
        count: "一名",
        appearance: ["棕色长发与花饰发髻", "深蓝金边胸甲", "红色腰带", "黑色绑带护腿"],
        pose: "双腿分开站立，身体微侧",
        action: "右手握持长柄战斧",
        materials: ["金属铠甲", "布料", "皮革"],
        colors: ["深蓝", "金色", "红色", "黑色"]
      },
      {
        name: "远景行人",
        count: "一名",
        appearance: ["浅色衣着", "戴帽", "局部可见"],
        pose: "站立",
        action: "位于背景木栅栏后方",
        materials: ["布料"],
        colors: ["浅色"]
      }
    ],
    relations: ["远景行人位于木栅栏后", "战斧由女武士持握", "金色能量光效环绕女武士右侧"],
    scene: {
      environment: "户外山野草地与石径",
      background: "远处雪山、木栅栏、蓝天白云",
      spatial_layers: ["前景石板草地", "中景女武士", "远景雪山与行人"]
    },
    look: {
      lighting: ["左上方自然光", "金属表面高光", "右侧暖黄色能量光"],
      palette: ["深蓝", "红色", "金色", "黑色"],
      materials: ["反光金属", "褶皱布料", "磨砂皮革"],
      style: ["精细数字插画", "日式动漫", "锐利线条"],
      atmosphere: "庄严",
      finish: "高清角色渲染"
    },
    camera_cues: {
      shot: "全身景",
      angle: "低角度仰视",
      composition: "人物居中偏左，战斧向左侧延伸",
      depth_of_field: "主体锐利，背景山峰略虚化"
    },
    ocr: [],
    uncertain: [],
    content_safety: {
      level: "safe",
      body_exposure: "none",
      interaction_category: "none",
      age_assessment: "age_unverifiable",
      visible_person_count: 2,
      signals: [],
      sensitive_visible_facts: []
    },
    ...overrides
  };
}

async function workflowModule() {
  return import(`${pathToFileURL(cloudPath).href}?retry-rich-contract=${Date.now()}`);
}

test("cloud and Admin keep the deterministic rich compiler and retry control flow equivalent", () => {
  assert.equal(
    sourceSlice(
      adminSource,
      "function grokVisualRichTomlValue(",
      "function miniMaxH3RichSubjectFacts(",
      "Admin deterministic rich compiler"
    ),
    sourceSlice(
      cloudSource,
      "function grokVisualRichTomlValue(",
      "function miniMaxH3RichSubjectFacts(",
      "Edge deterministic rich compiler"
    )
  );
  assert.equal(
    sourceSlice(
      adminSource,
      "async function callGrokResponseWithVisualRetry(",
      "function uniqueGrokVisualIrParts(",
      "Admin visual retry workflow"
    ),
    sourceSlice(
      cloudSource,
      "async function callGrokResponseWithVisualRetry(",
      "function uniqueGrokVisualIrParts(",
      "Edge visual retry workflow"
    )
  );
  assert.equal(
    sourceSlice(
      adminSource,
      "function miniMaxH3PromptEnhanceDurationFromText(",
      "function miniMaxH3PromptFieldsAreOrdered(",
      "Admin MiniMax H3 prompt deterministic fallback"
    ),
    sourceSlice(
      cloudSource,
      "function miniMaxH3PromptEnhanceDurationFromText(",
      "function miniMaxH3PromptFieldsAreOrdered(",
      "Edge MiniMax H3 prompt deterministic fallback"
    )
  );
});

test("a repaired second-pass nf.visual.v2 result compiles five detailed sections without a third provider call", async () => {
  const workflow = await workflowModule();
  const goodIr = safeWarriorIr();
  const invalidFirstIr = { ...goodIr, unsupported_key: true };
  const resultOptions = {
    visualIrSchema: "nf.visual.v2",
    requirements: "保留角色、战斧与远景行人的可见关系",
    existingNegativePrompt: "低清晰度",
    nsfw: false
  };
  const inputMeta = { scenario: "single_reference", supportsNegativePrompt: true };
  const attempts = [];
  const result = await workflow.callGrokResponseWithVisualRetry(
    { model: "grok-test", input: [] },
    inputMeta,
    resultOptions,
    async (_body, attempt) => {
      attempts.push(attempt);
      const visualIr = attempt === 1 ? invalidFirstIr : goodIr;
      try {
        const data = workflow.grokResponsesPublicResult(
          { id: `response-${attempt}`, output_text: JSON.stringify(visualIr) },
          resultOptions
        );
        return {
          ok: true,
          data,
          durationMs: 100 * attempt,
          usage: { inputTokens: 1000 * attempt, outputTokens: 200 * attempt, totalTokens: 1200 * attempt },
          providerCallCount: 1,
          inputMeta
        };
      } catch (error) {
        error.grokDurationMs = 100 * attempt;
        error.grokUsage = { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 };
        error.grokProviderCallCount = 1;
        throw error;
      }
    }
  );

  assert.deepEqual(attempts, [1, 2], "the repaired route must stop after the second provider call");
  assert.equal(result.providerCallCount, 2);
  assert.equal(result.visualContractRetryUsed, true);
  assert.equal(result.data.generationGate, "direct");
  assert.equal(result.data.contractFailureCode, undefined);
  assert.equal(result.data.errorCode, undefined);
  assert.ok(result.data.output_text.length > 600, "the repaired output must remain detailed");
  const headers = [...result.data.output_text.matchAll(/^\s*(\[[^\]\r\n]+\])\s*$/gm)].map((match) => match[1]);
  assert.deepEqual(headers, [
    "[风格设定]",
    "[主体物品]",
    "[环境背景]",
    "[光线与色彩]",
    "[拍摄参数]",
    "[用户附加要求]"
  ]);
  for (const fact of ["女武士", "远景行人", "长柄战斧", "雪山", "左上方自然光", "低角度仰视"]) {
    assert.match(result.data.output_text, new RegExp(fact, "u"), `the trusted repaired fact ${fact} must survive compilation`);
  }
  assert.match(result.data.output_text, /保留角色、战斧与远景行人的可见关系/u);
  assert.equal(JSON.stringify(result.data).includes("validatedVisualIr"), false, "internal validated IR must not enter the public JSON envelope");
});

test("a repaired age-unverifiable sensitive result remains an adult-confirmation candidate", async () => {
  const workflow = await workflowModule();
  const sensitiveIr = safeWarriorIr({
    asset_type: "人物数字插画",
    entities: [{
      name: "女性人物",
      count: "一名",
      appearance: ["长发", "身体轮廓完整可见"],
      pose: "站立",
      action: "面向镜头",
      materials: ["皮肤"],
      colors: ["暖色肤色"]
    }],
    relations: [],
    content_safety: {
      level: "nudity",
      body_exposure: "full",
      interaction_category: "none",
      age_assessment: "age_unverifiable",
      visible_person_count: 1,
      signals: ["nudity", "age_ambiguous"],
      sensitive_visible_facts: ["女性人物全裸，胸部与外阴直接可见"]
    }
  });
  const invalidFirstIr = { ...sensitiveIr, unsupported_key: true };
  const resultOptions = { visualIrSchema: "nf.visual.v2", requirements: "", nsfw: true };
  const inputMeta = { scenario: "single_reference", supportsNegativePrompt: true };
  let calls = 0;
  const result = await workflow.callGrokResponseWithVisualRetry(
    { model: "grok-test", input: [] },
    inputMeta,
    resultOptions,
    async () => {
      calls += 1;
      try {
        const data = workflow.grokResponsesPublicResult(
          { id: `sensitive-${calls}`, output_text: JSON.stringify(calls === 1 ? invalidFirstIr : sensitiveIr) },
          resultOptions
        );
        return {
          ok: true,
          data,
          durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          providerCallCount: 1,
          inputMeta
        };
      } catch (error) {
        error.grokProviderCallCount = 1;
        throw error;
      }
    }
  );

  assert.equal(calls, 2);
  assert.equal(result.providerCallCount, 2);
  assert.equal(result.data.generationGate, "adult_confirmation");
  assert.equal(result.data.contractFailureCode, undefined);
  assert.match(result.data.output_text, /女性人物全裸，胸部与外阴直接可见/u);
  assert.ok(result.data.contentWarnings.includes("sensitive_prompt_age_unconfirmed"));
});

test("the repaired route still fails closed when no validated IR crosses the parser boundary", async () => {
  const workflow = await workflowModule();
  const inputMeta = { scenario: "single_reference", supportsNegativePrompt: true };
  const resultOptions = { visualIrSchema: "nf.visual.v2", requirements: "", nsfw: false };
  let calls = 0;
  const result = await workflow.callGrokResponseWithVisualRetry(
    { model: "grok-test", input: [] },
    inputMeta,
    resultOptions,
    async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("invalid visual contract");
        error.grokVisualIrContractInvalid = true;
        error.grokVisualIrReason = "top-level keys do not match";
        error.grokProviderCallCount = 1;
        throw error;
      }
      return {
        ok: true,
        providerCallCount: 1,
        durationMs: 1,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        data: {
          output_text: "untrusted neutral summary",
          visualPrompt: "untrusted neutral summary",
          visualSchema: "nf.visual.v2",
          generationGate: "direct",
          contentSafety: { visible_person_count: 1 }
        }
      };
    }
  );

  assert.equal(calls, 2);
  assert.equal(result.providerCallCount, 2);
  assert.equal(result.data.generationGate, "blocked");
  assert.equal(result.data.analysisDegraded, true);
  assert.equal(result.data.contractFailureCode, "visual-rich-deterministic-compile-failed");
  assert.equal(result.data.legacyFallbackSuppressed, true);
});

test("the deterministic repair keeps all twelve subject identities inside a complete bounded prompt", async () => {
  const workflow = await workflowModule();
  const entities = Array.from({ length: 12 }, (_unused, index) => ({
    name: `成年人物编号${String(index + 1).padStart(2, "0")}`,
    count: "一名",
    appearance: Array.from({ length: 16 }, (_item, itemIndex) => `人物${index + 1}外观事实${itemIndex + 1}${"细节".repeat(28)}`),
    pose: `人物${index + 1}保持稳定站姿并呈现清晰重心${"姿态".repeat(20)}`,
    action: `人物${index + 1}执行独立可见动作${"动作".repeat(20)}`,
    materials: Array.from({ length: 12 }, (_item, itemIndex) => `人物${index + 1}材质${itemIndex + 1}${"纹理".repeat(18)}`),
    colors: Array.from({ length: 12 }, (_item, itemIndex) => `人物${index + 1}颜色${itemIndex + 1}${"色相".repeat(18)}`)
  }));
  const goodIr = safeWarriorIr({
    asset_type: "十二名成年人物群像数字插画",
    entities,
    relations: ["十二名人物按前后景层次排列，彼此没有身体接触"],
    content_safety: {
      level: "safe",
      body_exposure: "none",
      interaction_category: "none",
      age_assessment: "adult_appearing",
      visible_person_count: 12,
      signals: [],
      sensitive_visible_facts: []
    }
  });
  const invalidFirstIr = { ...goodIr, unsupported_key: true };
  let calls = 0;
  const result = await workflow.callGrokResponseWithVisualRetry(
    { model: "grok-test", input: [] },
    { scenario: "single_reference", supportsNegativePrompt: true },
    { visualIrSchema: "nf.visual.v2", requirements: "", nsfw: false },
    async () => {
      calls += 1;
      try {
        return {
          ok: true,
          data: workflow.grokResponsesPublicResult(
            { id: `max-${calls}`, output_text: JSON.stringify(calls === 1 ? invalidFirstIr : goodIr) },
            { visualIrSchema: "nf.visual.v2", requirements: "", nsfw: false }
          ),
          durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          providerCallCount: 1
        };
      } catch (error) {
        error.grokProviderCallCount = 1;
        throw error;
      }
    }
  );

  assert.equal(calls, 2);
  assert.equal(result.data.generationGate, "direct");
  assert.equal(result.data.contractFailureCode, undefined);
  assert.ok(result.data.output_text.length <= 10000);
  for (let index = 1; index <= 12; index += 1) {
    assert.match(result.data.output_text, new RegExp(`成年人物编号${String(index).padStart(2, "0")}`, "u"));
  }
  assert.match(result.data.output_text, /已验证可见人物数量 = "12"/u);
  assert.match(result.data.output_text, /主体数量描述 = ".*成年人物编号01：一名.*成年人物编号12：一名/u);
  assert.equal((result.data.output_text.match(/^\s*\[[^\]\r\n]+\]\s*$/gm) || []).length, 5);
});

test("a zero-entity repair never invents a single-subject relationship", async () => {
  const workflow = await workflowModule();
  const goodIr = safeWarriorIr({
    asset_type: "山野风景数字插画",
    entities: [],
    relations: [],
    content_safety: {
      level: "safe",
      body_exposure: "none",
      interaction_category: "none",
      age_assessment: "not_applicable",
      visible_person_count: 0,
      signals: [],
      sensitive_visible_facts: []
    }
  });
  const invalidFirstIr = { ...goodIr, unsupported_key: true };
  let calls = 0;
  const result = await workflow.callGrokResponseWithVisualRetry(
    { model: "grok-test", input: [] },
    { scenario: "single_reference", supportsNegativePrompt: true },
    { visualIrSchema: "nf.visual.v2", requirements: "", nsfw: false },
    async () => {
      calls += 1;
      try {
        return {
          ok: true,
          data: workflow.grokResponsesPublicResult(
            { id: `empty-${calls}`, output_text: JSON.stringify(calls === 1 ? invalidFirstIr : goodIr) },
            { visualIrSchema: "nf.visual.v2", requirements: "", nsfw: false }
          ),
          durationMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          providerCallCount: 1
        };
      } catch (error) {
        error.grokProviderCallCount = 1;
        throw error;
      }
    }
  );

  assert.equal(result.data.generationGate, "direct");
  assert.match(result.data.output_text, /主体间关系 = "参考图中无已验证主体关系"/u);
  assert.doesNotMatch(result.data.output_text, /单一主体，无额外主体关系/u);
});

test("MiniMax H3 prompt enhance falls back deterministically after repair contract failure", async () => {
  const workflow = await workflowModule();
  const resultOptions = {
    minimaxH3Prompt: true,
    minimaxH3Mode: "first_last",
    visualRetryAllowed: true,
    currentPrompt: "小角色从首帧动作连续过渡到尾帧",
    requirements: "Protocol: FL2VA; duration 4 seconds\n让动画更生动，",
    durationSeconds: 4,
    supportsNegativePrompt: false
  };
  const inputMeta = { scenario: "minimax_h3_prompt_enhance", supportsNegativePrompt: false };
  const attempts = [];
  const result = await workflow.callGrokResponseWithVisualRetry(
    { model: "grok-test", input: [{ role: "user", content: [] }] },
    inputMeta,
    resultOptions,
    async (_body, attempt) => {
      attempts.push(attempt);
      try {
        workflow.grokResponsesPublicResult(
          { id: `h3-invalid-${attempt}`, output_text: "not a MiniMax H3 contract" },
          resultOptions
        );
      } catch (error) {
        error.grokDurationMs = 50;
        error.grokUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
        error.grokProviderCallCount = 1;
        throw error;
      }
      throw new Error("invalid H3 output should not pass");
    }
  );
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(result.providerCallCount, 2);
  assert.equal(result.h3ContractRepairUsed, true);
  assert.equal(result.data.h3DeterministicPromptFallback, true);
  // FL2VA stays one continuous shot: the final frame belongs to [Shot 1] at the selected duration.
  assert.match(result.data.output_text, /^参考帧对齐：<Picture 1> 对应 \[Shot 1\] = 0\.00 秒；<Picture 2> 对应 \[Shot 1\] = 4\.00 秒（尾帧）/m);
  assert.match(result.data.output_text, /integrated_multimodal_description: \[Shot 1\][\s\S]*在 4 秒准确抵达 <Picture 2> 的尾帧状态/u);
  assert.doesNotMatch(result.data.output_text, /\[Shot 2\]/);
  assert.match(result.data.output_text, /让动画更生动/u);
  assert.match(result.data.output_text, /overall_soundscape:/);
  assert.match(result.data.output_text, /non_diegetic_music: N\/A/);
});
