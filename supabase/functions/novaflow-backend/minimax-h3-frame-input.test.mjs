import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { buildGrokImageReverseRequest, callGrokResponseWithVisualRetry, grokResponsesPublicResult } from "./smart-ai-grok.workflow.mjs";

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
