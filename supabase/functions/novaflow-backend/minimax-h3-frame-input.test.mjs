import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { buildGrokImageReverseRequest, buildGrokPromptOptimizeRequest, callGrokResponseWithVisualRetry, grokResponsesPublicResult, normalizeMiniMaxH3PromptOutput } from "./smart-ai-grok.workflow.mjs";

const browser = {};
for (const name of ["prompt", "reverse"]) {
  const url = new URL(`../../../particle-editor/ai-sequence-minimax-h3-${name}.workflow.js`, import.meta.url);
  vm.runInNewContext(readFileSync(url, "utf8"), browser, { filename: url.pathname });
}
const workflow = browser.NovaFlowAiSequenceMiniMaxH3ReverseWorkflow;
const firstImage = "data:image/png;base64,aGVsbG8=";
const lastImage = "data:image/png;base64,d29ybGQ=";

function prepare(lastDataUrl = firstImage) {
  return workflow.prepareRequest({
    modelId: "minimax_h3_local",
    mode: "first_last",
    durationSeconds: 8,
    prompt: "A figure waves, then returns to the opening pose.",
    requirements: "Keep both endpoint frames exact.",
    resources: [
      { key: "last_frame", dataUrl: lastDataUrl },
      { key: "first_frame", dataUrl: firstImage }
    ].map((resource) => ({
      ...resource,
      kind: "image",
      occupied: true,
      identity: resource.key,
      sourceId: resource.key,
      mimeType: "image/png"
    }))
  }).request;
}

for (const [name, endpoint] of [["same image", firstImage], ["different images", lastImage]]) {
  test(`renderer-to-cloud FL2V preserves both frame slots with ${name}`, () => {
    const request = prepare(endpoint);
    const built = buildGrokImageReverseRequest(request);
    assert.equal(built.resultOptions.minimaxH3Mode, "first_last");
    assert.equal(built.inputMeta.imageCount, 2);
    assert.equal(built.resultOptions.requiredProviderCalls, 2);
    assert.deepEqual(
      built.resultOptions.h3VisualBodies.map((body) => body.input[0].content[0].image_url),
      [firstImage, endpoint]
    );
  });
}

test("FL2V still rejects a missing endpoint and duplicate frame roles", () => {
  const request = prepare();
  for (const images of [[request.images[0]], [request.images[0], request.images[0]]]) {
    assert.throws(
      () => buildGrokImageReverseRequest({ ...request, images }),
      (error) => error.errorCode === "h3_contract_images" && error.statusCode === 400
    );
  }
});

test("ordinary overlapping shapes remain visible facts in an H3 same-frame result", async () => {
  const built = buildGrokImageReverseRequest(prepare());
  const richPrompt = [
    "[风格设定]",
    "风格 = \"数字绘画，几何造型，平面质感\"",
    "[主体物品]",
    "外观 = \"物品由两块蓝色图形交叠构成，边缘清晰，表面光滑\"",
    "[环境背景]",
    "环境 = \"纯白背景，标志位于画面中央\"",
    "[光线与色彩]",
    "光线 = \"均匀自然光，冷色色调，蓝白配色\"",
    "[拍摄参数]",
    "构图 = \"正面视角，居中构图，边缘清晰\""
  ].join("\n");
  const result = await callGrokResponseWithVisualRetry(
    built.body, built.inputMeta, built.resultOptions,
    async () => ({
      data: grokResponsesPublicResult({ output_text: richPrompt }, built.resultOptions),
      providerCallCount: 1
    })
  );
  assert.equal(result.data.visualSchema, "nf.h3.visual.v1");
  assert.equal(result.providerCallCount, 2);
  assert.match(result.data.output_text, /两块蓝色图形交叠/);
  assert.match(result.data.output_text, /<Picture 1>/);
  assert.match(result.data.output_text, /<Picture 2>/);
});

function portraitFacts(subject) {
  return [
    "[风格设定]", "风格 = \"写实摄影，自然纹理\"",
    "[主体物品]", `外观 = "${subject}"`,
    "[环境背景]", "环境 = \"室内房间，背景墙面整洁\"",
    "[光线与色彩]", "光线 = \"自然侧光，暖色色调\"",
    "[拍摄参数]", "构图 = \"中景，平视，居中构图\""
  ].join("\n");
}

for (const subject of [
  "人物身穿无袖上衣，裸露肩膀，双手与双腿自然摆放，静坐在椅子上",
  "人物身穿无袖上衣，裸露肩膀，手握住杯子，静坐在椅子上"
]) {
  test(`static portrait facts need no invented interaction: ${subject}`, async () => {
    const built = buildGrokImageReverseRequest(prepare());
    const result = await callGrokResponseWithVisualRetry(
      built.body, built.inputMeta, built.resultOptions,
      async () => ({
        data: grokResponsesPublicResult({ output_text: portraitFacts(subject) }, built.resultOptions),
        providerCallCount: 1
      })
    );
    assert.equal(result.data.visualSchema, "nf.h3.visual.v1");
    assert.equal(result.providerCallCount, 2);
    assert.match(result.data.output_text, /裸露肩膀/);
    assert.doesNotMatch(result.data.output_text, /性行为|sexual activity/i);
  });
}

test("an explicit activity claim still requires concrete action and contact evidence", () => {
  for (const [subject, leaf] of [
    ["人物裸露肩膀，双手与双腿自然摆放，标注 sexual activity", "rich_interaction_action_missing"],
    ["人物裸露肩膀，手握住杯子，标注 sexual activity", "rich_interaction_contact_missing"]
  ]) {
    assert.throws(() => grokResponsesPublicResult({ output_text: portraitFacts(subject) }, {
      minimaxH3Prompt: true, minimaxH3Reverse: true, minimaxH3RichVisualStage: true
    }), (error) => error.h3ValidationLeaf === leaf);
  }
});

async function renderReadablePrompt({ lastDataUrl = firstImage, prompt = "", requirements = "", mode = "first_last", facts } = {}) {
  const options = {
    modelId: "minimax_h3_local", mode, durationSeconds: 5, prompt, requirements,
    resources: (mode === "first_last" ? ["first_frame", "last_frame"] : ["first_frame"]).map((key) => ({
      key, kind: "image", occupied: true, identity: key, sourceId: key,
      mimeType: "image/png", dataUrl: key === "first_frame" ? firstImage : lastDataUrl
    }))
  };
  const prepared = workflow.prepareRequest(options);
  const built = buildGrokImageReverseRequest(prepared.request);
  let index = 0;
  const result = await callGrokResponseWithVisualRetry(built.body, built.inputMeta, built.resultOptions, async () => ({
    data: grokResponsesPublicResult({ output_text: facts?.[index++] || portraitFacts("人物穿着蓝色外套，手握杯子，静坐在椅子上") }, built.resultOptions),
    providerCallCount: 1
  }));
  workflow.validateAndRestore({ text: result.data.output_text, context: prepared.context, current: options });
  return result.data.output_text;
}

test("same-image FL2VA has independent alignment, one shot, paragraphs and no duplicated inventories", async () => {
  const text = await renderReadablePrompt();
  const [alignment, ...paragraphs] = text.split("\n\n");
  assert.match(alignment, /<Picture 1>.*\[Shot 1\].*0\.00.*<Picture 2>.*\[Shot 1\].*5\.00/);
  assert.ok(paragraphs.length >= 5);
  assert.match(paragraphs[0], /^integrated_multimodal_description: \[Shot 1\]/);
  assert.doesNotMatch(text, /\[Shot 2\]|已验证|Validated|用户动作、运镜或音频要求/);
  assert.equal(text.split("人物穿着蓝色外套").length - 1, 1);
  assert.equal(text.split("背景墙面整洁").length - 1, 1);
  assert.match(text, /\n\noverall_soundscape: [^\n]+\n\nnon_diegetic_music: N\/A$/);
});

test("different endpoint poses survive deduplication without a fabricated cut", async () => {
  const text = await renderReadablePrompt({ lastDataUrl: lastImage, facts: [
    portraitFacts("人物穿着蓝色外套，左手握杯，右手放在膝上"),
    portraitFacts("人物穿着蓝色外套，左手握杯，右手抬起挥手")
  ] });
  assert.match(text, /右手放在膝上/);
  assert.match(text, /右手抬起挥手/);
  assert.equal(text.split("背景墙面整洁").length - 1, 1);
  assert.doesNotMatch(text, /\[Shot 2\]/);
});

test("shared style and lighting facts appear once without merging subjects", async () => {
  const facts = portraitFacts("人物穿着蓝色外套，手握金属杯，静坐在椅子上")
    .replace("写实摄影，自然纹理", "写实摄影，金属表面高光反射")
    .replace("自然侧光，暖色色调", "自然侧光，暖色色调，金属表面高光反射");
  const text = await renderReadablePrompt({ facts: [facts, facts] });
  assert.equal(text.split("金属表面高光反射").length - 1, 1);
  assert.match(text, /手握金属杯/);
});

test("dialogue punctuation and later instructions are retained once, not copied into soundscape", async () => {
  const dialogue = '(S1) says: <d>[English] Wait! Stop; please... Really?</d>';
  const prompt = `The figure begins to wave. ${dialogue}\nThen lowers the hand.\nThe camera holds still.\nKeep the cup upright.\nFinally settle.`;
  const text = await renderReadablePrompt({ prompt });
  assert.ok(text.includes(dialogue));
  assert.equal(text.split(dialogue).length - 1, 1);
  assert.match(text, /Keep the cup upright/);
  assert.doesNotMatch(text.split("overall_soundscape:")[1], /Wait!|wave|camera/);
});

test("explicit silence and background score stay in their own fields", async () => {
  const silent = await renderReadablePrompt({ requirements: "全程静音" });
  assert.match(silent, /overall_soundscape: N\/A\n\nnon_diegetic_music: N\/A$/);
  const score = await renderReadablePrompt({ requirements: "背景音乐：缓慢、稀疏的钢琴音符" });
  assert.match(score, /non_diegetic_music: 缓慢、稀疏的钢琴音符$/);
  assert.equal(score.split("缓慢、稀疏的钢琴音符").length - 1, 1);
});

test("I2VA uses the same readable three-field layout without a final reference", async () => {
  const text = await renderReadablePrompt({ mode: "image_video" });
  assert.match(text, /^.*<Picture 1>.*0\.00.*\n\nintegrated_multimodal_description:/);
  assert.doesNotMatch(text, /<Picture 2>|\[Shot 2\]/);
});

test("already structured user dialogue and an explicit cut retain one set of fields", async () => {
  const prompt = [
    'integrated_multimodal_description: [Shot 1] The figure begins to wave. The camera holds still.',
    '[Shot 2] At 00:02.000, the camera cuts to the figure, then the hand lowers.',
    'overall_soundscape: A soft cup click.',
    'non_diegetic_music: Slow piano notes.'
  ].join('\n\n');
  const text = await renderReadablePrompt({ prompt });
  assert.equal(text.split('integrated_multimodal_description:').length - 1, 1);
  assert.match(text.split('\n')[0], /<Picture 2>.*\[Shot 2\]/);
  assert.match(text, /overall_soundscape: A soft cup click\./);
  assert.match(text, /non_diegetic_music: Slow piano notes\./);
});

test("enhance fallback never treats renderer protocol instructions as user requirements", async () => {
  const options = { modelId: "minimax_h3_local", mode: "first_last", durationSeconds: 5,
    prompt: "人物抬手，再慢慢放下，固定镜头。", resources: ["first_frame", "last_frame"].map((key) => ({ key, identity: key, occupied: true, mimeType: "image/png" })) };
  const prepared = browser.NovaFlowAiSequenceMiniMaxH3PromptWorkflow.prepareRequest(options);
  const built = buildGrokPromptOptimizeRequest({ prompt: prepared.prompt, requirements: prepared.requirements + "\n\n保持杯子竖直。",
    h3Mode: "first_last", durationSeconds: 5, visualSchema: "nf.h3.visual.v1", purpose: "minimax-h3-prompt-enhance", surface: "animation" });
  const result = await callGrokResponseWithVisualRetry(built.body, built.inputMeta, built.resultOptions, async () => {
    throw Object.assign(new Error("invalid fields"), { minimaxH3ContractInvalid: true, errorCode: "h3_contract_fields" });
  });
  assert.match(result.data.output_text, /保持杯子竖直/);
  assert.doesNotMatch(result.data.output_text, /independent exact endpoint|Preserve each endpoint|Source prompt|Available resource|\[Shot 2\]/);
});

test("bare official field headings are repaired without accepting absent or duplicate fields", () => {
  const bare = ["subject_definitions", "<Subject 1>: the figure in <Picture 1>.",
    "summary", "[reference generation] The figure waves.", "retention_analysis", "<Subject 1>: fully_preserved - appearance.",
    "detailed_description", "Digital painting. [Shot 1] The figure begins to wave; the camera holds still.",
    "overall_soundscape", "Quiet room tone.", "non_diegetic_music", "N/A"].join("\n");
  const text = normalizeMiniMaxH3PromptOutput(bare, { minimaxH3Mode: "full_reference" });
  assert.match(text, /^subject_definitions:/);
  assert.match(text, /\n\ndetailed_description:/);
  for (const invalid of [bare.replace("overall_soundscape\nQuiet room tone.\n", ""), bare + "\nnon_diegetic_music\nN/A"]) {
    assert.throws(() => normalizeMiniMaxH3PromptOutput(invalid, { minimaxH3Mode: "full_reference" }), (error) => error.errorCode === "h3_contract_fields");
  }
});

for (const [mode, keys] of [["text_video", []], ["image_video", ["first_frame"]], ["first_last", ["first_frame", "last_frame"]], ["multi_reference", ["multi_ref_image_1"]]]) {
  test(`${mode} uses required structured fields and rejects empty sections before writeback`, () => {
    const options = { modelId: "minimax_h3_local", mode, durationSeconds: 5, prompt: "人物缓慢抬手，再放下，固定镜头。",
      resources: keys.map((key) => ({ key, identity: key, occupied: true, mimeType: "image/png" })) };
    const prepared = browser.NovaFlowAiSequenceMiniMaxH3PromptWorkflow.prepareRequest(options);
    const built = buildGrokPromptOptimizeRequest({ prompt: prepared.prompt, requirements: prepared.requirements,
      h3Mode: mode, durationSeconds: 5, visualSchema: "nf.h3.visual.v1", purpose: "minimax-h3-prompt-enhance" });
    const format = built.body.text.format;
    assert.equal(format.type, "json_schema");
    assert.equal(format.strict, true);
    const fields = mode === "multi_reference" ? ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"]
      : ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
    const required = mode === "image_video" || mode === "first_last" ? ["reference_alignment", ...fields] : fields;
    assert.deepEqual(format.schema.required, required);
    const content = {
      reference_alignment: '<Picture 1> from [Shot 1] = 0.00 seconds; <Picture 2> from [Shot 1] = 5.00 seconds (final shot)',
      subject_definitions: '<Subject 1>: the figure in <Picture 1>.', summary: '[reference generation] The figure waves.',
      retention_analysis: '<Subject 1>: fully_preserved - appearance.',
      integrated_multimodal_description: '[Shot 1] The figure begins to wave. The camera holds still.',
      detailed_description: 'Digital painting. [Shot 1] The figure begins to wave. The camera holds still.',
      overall_soundscape: 'Quiet room tone.', non_diegetic_music: 'N/A'
    };
    const json = Object.fromEntries(required.map((key) => [key, content[key]]));
    const text = normalizeMiniMaxH3PromptOutput(JSON.stringify(json), built.resultOptions);
    assert.match(text, /\n\noverall_soundscape:/);
    if (mode === "multi_reference") {
      assert.match(format.schema.properties.subject_definitions.description, /<Picture 1>/);
      assert.doesNotMatch(format.schema.properties.subject_definitions.description, /multi_ref_image_1|captured image slot/);
      assert.throws(() => normalizeMiniMaxH3PromptOutput(JSON.stringify({ ...json, subject_definitions: "<Subject 1>: the figure." }), built.resultOptions),
        (error) => error.errorCode === "h3_contract_references");
    }
    for (const field of required) {
      assert.throws(() => normalizeMiniMaxH3PromptOutput(JSON.stringify({ ...json, [field]: "" }), built.resultOptions), (error) => error.errorCode === "h3_contract_fields");
    }
  });
}
