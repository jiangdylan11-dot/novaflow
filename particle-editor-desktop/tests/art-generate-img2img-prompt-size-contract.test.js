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
assert.match(source, /const qualityCompiled = [\s\S]*?prompt: promptSnapshot\.prompt,[\s\S]*?negativePrompt: promptSnapshot\.negativePrompt/);
assert.match(source, /compileArtGeneratePromptMentions\(refs,\s*promptWithReferenceRoles\)/);
assert.match(source, /buildArtGenerateRunWorkflow\([\s\S]*?qualityCompiled\.negativePrompt,\s*clientId,\s*referenceSizes\)/);
assert.match(source, /function injectArtWorkflowTargetSize\(workflow, sourceSize\)[\s\S]*?class_type:\s*"ImageScale"/);
assert.match(source, /class_type:\s*"ImagePadForOutpaint"/);
assert.match(source, /function artGenerateAspectFitPlan\(sourceSize, targetSize\)/);
assert.match(source, /function artGenerateQwenReferenceGrid\(width, height\)/);
assert.match(source, /const grid = artGenerateQwenReferenceGrid\(target\.width, target\.height\)/);
assert.match(source, /const plan = artGenerateAspectFitPlan\(sourceSize, grid\)/);
assert.match(source, /title: "NovaFlow Output Size"/);
assert.match(source, /node\.inputs\[inputKey\]\s*=\s*\[targetKey,\s*0\]/);
assert.match(source, /图生图工作流未找到可接入尺寸的图像缩放节点/);

const factory = new Function(
  "ART_GENERATE_STATE",
  `${extractFunction("artGenerateNextWorkflowNodeKey")}\n${extractFunction("artGenerateAspectFitPlan")}\n${extractFunction("artGenerateQwenReferenceGrid")}\n${extractFunction("injectArtWorkflowOutputSize")}\n${extractFunction("injectArtWorkflowTargetSize")}\nreturn { injectArtWorkflowTargetSize, artGenerateAspectFitPlan, artGenerateQwenReferenceGrid };`
);
const buildApi = (state) => factory(state);
const { injectArtWorkflowTargetSize: injectTargetSize, artGenerateAspectFitPlan, artGenerateQwenReferenceGrid } = buildApi({ width: 1024, height: 1024 });

// TextEncodeQwenImageEditPlus always re-encodes its reference at ~1MP rounded
// to a /8 multiple, so every canvas the runtime asks for has to be a fixed
// point of that same formula or the edit comes back at another scale.
[[715, 911], [512, 720], [2048, 1536], [1024, 1024], [2048, 2048], [256, 256]].forEach(([width, height]) => {
  const grid = artGenerateQwenReferenceGrid(width, height);
  assert.equal(grid.width % 8, 0, `${width}x${height} grid width should be a /8 multiple`);
  assert.equal(grid.height % 8, 0, `${width}x${height} grid height should be a /8 multiple`);
  const scale = Math.sqrt((1024 * 1024) / (grid.width * grid.height));
  assert.equal(Math.round((grid.width * scale) / 8) * 8, grid.width, `${width}x${height} grid width should be stable`);
  assert.equal(Math.round((grid.height * scale) / 8) * 8, grid.height, `${width}x${height} grid height should be stable`);
});
assert.deepEqual(artGenerateQwenReferenceGrid(715, 911), { width: 904, height: 1152 });
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
  image: ["41", 0],
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
// A reference asked for at its own resolution has to keep the character at its
// own scale: sample on the 1MP grid, then hand back the requested pixel size.
const nativeApi = buildApi({ width: 715, height: 911 });
const nativeWorkflow = {
  "10": { class_type: "LoadImage", inputs: { image: "source.png" } },
  "15": { class_type: "ImageScaleToTotalPixels", inputs: { image: ["10", 0], megapixels: 1 } },
  "16": { class_type: "VAEEncode", inputs: { pixels: ["15", 0] } },
  "3": { class_type: "TextEncodeQwenImageEditPlus", inputs: { image1: ["10", 0] } },
  "5": { class_type: "VAEDecode", inputs: { samples: ["2", 0] } },
  "13": { class_type: "SaveImage", inputs: { filename_prefix: "ComfyUI", images: ["5", 0] } },
};
assert.equal(nativeApi.injectArtWorkflowTargetSize(nativeWorkflow, { width: 715, height: 911 }), true);
const nativeFit = Object.values(nativeWorkflow).find((node) => node._meta?.title === "NovaFlow Aspect Fit");
assert.deepEqual(nativeFit.inputs, {
  image: ["10", 0],
  upscale_method: "lanczos",
  width: 904,
  height: 1152,
  crop: "disabled",
});
assert.ok(!Object.values(nativeWorkflow).some((node) => node.class_type === "ImagePadForOutpaint"), "a matching aspect should not pad");

// A reference whose aspect only misses the /8 grid by a pixel or two fills the
// canvas instead of collecting grey bars.
const snapApi = buildApi({ width: 956, height: 1348 });
const snapWorkflow = {
  "10": { class_type: "LoadImage", inputs: { image: "source.png" } },
  "15": { class_type: "ImageScaleToTotalPixels", inputs: { image: ["10", 0] } },
  "16": { class_type: "VAEEncode", inputs: { pixels: ["15", 0] } },
};
assert.equal(snapApi.injectArtWorkflowTargetSize(snapWorkflow, { width: 956, height: 1348 }), true);
assert.ok(!Object.values(snapWorkflow).some((node) => node.class_type === "ImagePadForOutpaint"), "a 1px grid gap should not pad");
const snapFit = Object.values(snapWorkflow).find((node) => node._meta?.title === "NovaFlow Aspect Fit");
assert.deepEqual([snapFit.inputs.width, snapFit.inputs.height], [864, 1216]);
const nativeOutEntry = Object.entries(nativeWorkflow).find(([, node]) => node._meta?.title === "NovaFlow Output Size");
assert.ok(nativeOutEntry, "the sampled canvas should be resized to the requested resolution");
assert.deepEqual(nativeOutEntry[1].inputs, {
  image: ["5", 0],
  upscale_method: "lanczos",
  width: 715,
  height: 911,
  crop: "disabled",
});
assert.deepEqual(nativeWorkflow["13"].inputs.images, [nativeOutEntry[0], 0]);
// The encoder keeps reading the upload: at denoise 1 the fitted pixels only
// carry the canvas size, and the padded copy is ImagePadForOutpaint grey.
assert.deepEqual(nativeWorkflow["3"].inputs.image1, ["10", 0]);

assert.equal(injectTargetSize({ "9": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512 } } }), true);

console.log("art-generate-img2img-prompt-size-contract: passed");
