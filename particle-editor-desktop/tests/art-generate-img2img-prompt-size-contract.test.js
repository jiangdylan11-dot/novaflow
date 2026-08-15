const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "particle-editor", "novaflow-brand-runtime.js"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start + 2, index + 1);
  }
  throw new Error(`${name} source is incomplete`);
}

assert.match(source, /function captureArtGeneratePromptSnapshot\(\)[\s\S]*?ART_GENERATE_STATE\.prompt\s*=\s*prompt/);
assert.match(source, /async function runArtGenerate\(\)[\s\S]*?const promptSnapshot\s*=\s*captureArtGeneratePromptSnapshot\(\)/);
assert.match(source, /compileArtGeneratePromptMentions\(refs,\s*promptSnapshot\.prompt\)/);
assert.match(source, /buildArtGenerateRunWorkflow\([\s\S]*?promptSnapshot\.negativePrompt,\s*clientId,\s*referenceSizes\)/);
assert.match(source, /function injectArtWorkflowTargetSize\(workflow, sourceSize\)[\s\S]*?class_type:\s*"ImageScale"/);
assert.match(source, /class_type:\s*"ImagePadForOutpaint"/);
assert.match(source, /function artGenerateAspectFitPlan\(sourceSize, targetSize\)/);
assert.match(source, /node\.inputs\[inputKey\]\s*=\s*\[targetKey,\s*0\]/);
assert.match(source, /图生图工作流未找到可接入尺寸的图像缩放节点/);

const factory = new Function(
  "ART_GENERATE_STATE",
  `${extractFunction("artGenerateNextWorkflowNodeKey")}\n${extractFunction("artGenerateAspectFitPlan")}\n${extractFunction("injectArtWorkflowTargetSize")}\nreturn { injectArtWorkflowTargetSize, artGenerateAspectFitPlan };`
);
const { injectArtWorkflowTargetSize: injectTargetSize, artGenerateAspectFitPlan } = factory({ width: 1024, height: 1024 });
assert.deepEqual(artGenerateAspectFitPlan({ width: 540, height: 1024 }, { width: 1024, height: 1024 }), {
  width: 540,
  height: 1024,
  left: 242,
  right: 242,
  top: 0,
  bottom: 0,
  targetWidth: 1024,
  targetHeight: 1024,
});
assert.deepEqual(artGenerateAspectFitPlan({ width: 1920, height: 1080 }, { width: 1024, height: 1024 }), {
  width: 1024,
  height: 576,
  left: 0,
  right: 0,
  top: 224,
  bottom: 224,
  targetWidth: 1024,
  targetHeight: 1024,
});
const workflow = {
  "41": { class_type: "LoadImage", inputs: { image: "source.png" } },
  "142": { class_type: "FluxKontextImageScale", inputs: { image: ["41", 0] } },
  "137": { class_type: "VAEEncode", inputs: { pixels: ["142", 0] } },
  "126": { class_type: "TextEncodeQwenImageEditPlus", inputs: { image1: ["142", 0] } },
};
assert.equal(injectTargetSize(workflow, { width: 540, height: 1024 }), true);
const targetEntry = Object.entries(workflow).find(([, node]) => node.class_type === "ImageScale");
assert.ok(targetEntry, "target size node should be inserted");
const [scaleKey, targetNode] = targetEntry;
assert.deepEqual(targetNode.inputs, {
  image: ["142", 0],
  upscale_method: "lanczos",
  width: 540,
  height: 1024,
  crop: "disabled",
});
const padEntry = Object.entries(workflow).find(([, node]) => node.class_type === "ImagePadForOutpaint");
assert.ok(padEntry, "aspect mismatch should insert an outpaint canvas node");
const [targetKey, padNode] = padEntry;
assert.deepEqual(padNode.inputs, {
  image: [scaleKey, 0],
  left: 242,
  top: 0,
  right: 242,
  bottom: 0,
  feathering: 0,
});
assert.deepEqual(workflow["137"].inputs.pixels, [targetKey, 0]);
assert.deepEqual(workflow["126"].inputs.image1, [targetKey, 0]);
assert.equal(injectTargetSize({ "9": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } } }), true);

console.log("art-generate-img2img-prompt-size-contract: passed");
