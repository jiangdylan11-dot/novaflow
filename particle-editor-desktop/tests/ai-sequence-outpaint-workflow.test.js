const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  const frameModePath = path.resolve(__dirname, "../../particle-editor/ai-sequence-frame-mode.js");
  const workflowPath = path.resolve(__dirname, "../../particle-editor/ai-sequence-outpaint.workflow.js");
  await import(`${pathToFileURL(frameModePath).href}?test=${Date.now()}`);
  await import(`${pathToFileURL(workflowPath).href}?test=${Date.now()}`);
  const frameMode = globalThis.NovaFlowAiSequenceFrameMode;
  const workflow = globalThis.NovaFlowAiSequenceOutpaintWorkflow;
  assert.ok(frameMode && workflow);
  const source = {
    id: "source-1",
    fileName: "robot.png",
    dataUrl: "data:image/png;base64,c291cmNl",
    width: 1012,
    height: 1012,
    lastModified: 123,
  };
  let outpaintCalls = 0;
  const derived = await workflow.prepareStrictFrame({
    source,
    targetRatio: "16:9",
    frameMode,
    outpaint: async (request) => {
      outpaintCalls += 1;
      assert.deepEqual(request.sourceSize, { width: 1012, height: 1012 });
      assert.deepEqual(request.targetSize, { width: 1920, height: 1080 });
      assert.deepEqual(request.delta, { top: 34, bottom: 34, left: 454, right: 454 });
      return {
        dataUrl: "data:image/png;base64,ZGVyaXZlZA==",
        fileName: "robot_outpaint_1920x1080.png",
        width: 1920,
        height: 1080,
      };
    },
  });

  assert.equal(outpaintCalls, 1);
  assert.equal(derived.derived, true);
  assert.equal(derived.derivedFrom, "source-1");
  assert.equal(derived.targetRatio, "16:9");
  assert.equal(derived.width, 1920);
  assert.equal(derived.height, 1080);
  assert.ok(derived.sourceFingerprint.startsWith("source-1|robot.png|1012x1012|123|"));
  assert.notEqual(
    workflow.sourceFingerprint({ ...source, id: "", lastModified: 0, dataUrl: "data:image/png;base64,AAAA-middle-1111" }),
    workflow.sourceFingerprint({ ...source, id: "", lastModified: 0, dataUrl: "data:image/png;base64,BBBB-middle-2222" }),
    "same-name, same-size uploads with different image content must not share a strict-frame cache key",
  );
  const sharedPrefix = `data:image/png;base64,${"A".repeat(160)}`;
  const sharedSuffix = "Z".repeat(160);
  assert.notEqual(
    workflow.sourceFingerprint({ ...source, id: "", lastModified: 0, dataUrl: `${sharedPrefix}${"1".repeat(512)}${sharedSuffix}` }),
    workflow.sourceFingerprint({ ...source, id: "", lastModified: 0, dataUrl: `${sharedPrefix}${"2".repeat(512)}${sharedSuffix}` }),
    "large same-length uploads with identical data URL edges must hash their complete content",
  );

  const original = await workflow.prepareStrictFrame({
    source,
    targetRatio: "1:1",
    frameMode,
    outpaint: async () => {
      throw new Error("matching input must not outpaint");
    },
  });
  assert.equal(original.derived, false);
  assert.equal(original.dataUrl, source.dataUrl);

  await assert.rejects(
    workflow.prepareStrictFrame({
      source,
      targetRatio: "16:9",
      frameMode,
      outpaint: async () => ({
        dataUrl: "data:image/png;base64,YmFk",
        fileName: "bad.png",
        width: 1080,
        height: 1080,
      }),
    }),
    /output size/i,
  );

  await assert.rejects(
    workflow.prepareStrictFrame({
      source,
      targetRatio: "16:9",
      frameMode,
      outpaint: async () => null,
    }),
    (error) => error && error.code === "AI_SEQUENCE_OUTPAINT_CANCELED",
    "canceling the confirmation must not become a malformed-output failure",
  );

  console.log("AI sequence outpaint workflow tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
