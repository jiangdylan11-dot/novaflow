#!/usr/bin/env node
import { readFileSync } from "node:fs";
import vm from "node:vm";

const runtime = readFileSync("particle-editor/novaflow-brand-runtime.js", "utf8");

function sourceBetween(startNeedle, endNeedle) {
  const start = runtime.indexOf(startNeedle);
  const end = runtime.indexOf(endNeedle, start);
  if (start < 0 || end <= start) throw new Error(`Runtime source range missing: ${startNeedle}`);
  return runtime.slice(start, end);
}

const numberNormalizer = sourceBetween(
  "  function normalizeArtGenerateNumberValue(",
  "  function selectArtGenerateNumberInputValue("
);
const workflowPatcher = sourceBetween(
  "  function artPromptLikeNegative(",
  "  async function validateArtWorkflowNodes("
);
const state = {
  prompt: "serialized alias prompt",
  negativePrompt: "negative",
  randomSeed: false,
  seed: 42,
  steps: 8,
  cfg: 1,
  denoise: 1,
  width: 1024,
  height: 1024
};
const context = vm.createContext({ ART_GENERATE_STATE: state });
vm.runInContext(`${numberNormalizer}\n${workflowPatcher}\nthis.patchArtWorkflowForTest = patchArtWorkflow;`, context);

function makeWorkflow(positiveTitle) {
  return {
    "10": { inputs: { image: "old.png" }, class_type: "LoadImage", _meta: { title: "Optional Input Image" } },
    "20": {
      inputs: { prompt: "old", image1: ["10", 0] },
      class_type: "TextEncodeQwenImageEditPlus",
      _meta: { title: positiveTitle }
    },
    "21": {
      inputs: { prompt: "negative-old" },
      class_type: "TextEncodeQwenImageEditPlus",
      _meta: { title: "Negative (leave blank)" }
    },
    "30": { inputs: { prompt: "old" }, class_type: "easy promptLine", _meta: { title: "提示词行" } },
    "40": { inputs: { filename_prefix: "old", images: ["20", 0] }, class_type: "SaveImage", _meta: { title: "保存图像" } }
  };
}

for (const title of ["TextEncodeQwenImageEditPlus (Positive)", "TextEncodeQwenImageEditPlus Input Prompt"]) {
  const compiled = "图1保留人物，图2采用姿势，图3采用服装";
  const workflow = context.patchArtWorkflowForTest(
    makeWorkflow(title),
    ["slot-1.png", "slot-2.png", "slot-3.png"],
    "NovaFlow_Test",
    compiled
  );
  const positive = workflow["20"];
  if (positive.inputs.prompt !== compiled) throw new Error(`${title} did not receive compiled prompt`);
  for (const prop of ["image1", "image2", "image3"]) {
    if (!Array.isArray(positive.inputs[prop])) throw new Error(`${title} missing ${prop}`);
  }
  const connectedNames = ["image1", "image2", "image3"].map((prop) => {
    const nodeId = positive.inputs[prop][0];
    return workflow[nodeId]?.inputs?.image;
  });
  if (connectedNames.join(",") !== "slot-1.png,slot-2.png,slot-3.png") {
    throw new Error(`${title} reference order mismatch: ${connectedNames.join(",")}`);
  }
  if (workflow["30"].inputs.prompt !== compiled) throw new Error(`${title} easy prompt line was not compiled`);
}

console.log("PASS Art Generate compiled mention workflow contract");
