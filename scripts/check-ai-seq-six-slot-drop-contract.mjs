#!/usr/bin/env node
import { readFileSync } from "node:fs";
import vm from "node:vm";

const runtime = readFileSync("particle-editor/novaflow-brand-runtime.js", "utf8");
const compat = readFileSync("particle-editor/ai-sequence-input-compat.tool.js", "utf8");
const indexHtml = readFileSync("particle-editor/index.html", "utf8");
const bundleMatch = indexHtml.match(/src="\.\/(assets\/index-[^"]+\.js)(?:\?[^"]*)?"/);
if (!bundleMatch) throw new Error("active particle-editor bundle is missing");
const bundle = readFileSync(`particle-editor/${bundleMatch[1]}`, "utf8");

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label} missing: ${needle}`);
}

assertIncludes(indexHtml, "ai-sequence-input-compat.tool.js", "input compatibility module entry");

const kinds = [
  "ref_image",
  "jimeng_image2_ref",
  "jimeng_image3_ref",
  "jimeng_image4_ref",
  "jimeng_video_ref",
  "jimeng_audio_ref"
];

for (const kind of kinds) {
  assertIncludes(bundle, `Sr(\`${kind}\`)`, `source-owned ${kind} React route`);
  assertIncludes(compat, `"${kind}"`, `compatibility module ${kind} mapping`);
}

assertIncludes(
  compat,
  "const AI_SEQUENCE_SOURCE_OWNED_UPLOAD_KIND_CONFIG = Object.freeze({",
  "six-slot kind configuration"
);
assertIncludes(
  compat,
  "function getAiSequenceSourceOwnedUploadKind(",
  "raw source-owned slot kind resolver"
);
assertIncludes(
  compat,
  "function findAiSequenceNativeInputByRawKind(",
  "raw-kind native input resolver"
);
assertIncludes(
  compat,
  "function aiSequenceFileMatchesUploadKind(",
  "target file-family validation"
);
assertIncludes(
  runtime,
  "ai-sequence-upload-${rawKind}",
  "kind-specific click-proxy owner"
);
assertIncludes(
  runtime,
  "data-novaflow-ai-upload-clear-above-proxy",
  "filled-slot clear button proxy escape"
);
assertIncludes(
  runtime,
  'setStylePropertyIfChanged(button, "z-index", "33", "important");',
  "clear button stacking above upload proxy"
);

class FakeElement {
  constructor(closest, attrs = {}) { this.closestImpl = closest; this.attrs = attrs; }
  closest(selector) { return this.closestImpl ? this.closestImpl(selector) : null; }
  matches(selector) { return selector === "[data-ais-import]" && this.getAttribute("data-ais-import") !== null; }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
}
class FakeInput extends FakeElement {
  constructor(accept) { super(); this.accept = accept; this.disabled = false; }
  getAttribute() { return null; }
}
const nativeInputs = [
  new FakeInput("image/*,video/*"),
  new FakeInput("image/*,video/*"),
  new FakeInput("image/*,video/*"),
  new FakeInput("image/*,video/*"),
  new FakeInput("image/*"),
  new FakeInput("image/*"),
  new FakeInput("image/*"),
  new FakeInput("video/*"),
  new FakeInput("audio/*")
];
const workspace = new FakeElement();
workspace.querySelectorAll = () => nativeInputs;
const dropzone = new FakeElement((selector) => selector.includes("data-novaflow-ai-bottom-workspace") ? workspace : null);
const window = { Element: FakeElement, HTMLElement: FakeElement, HTMLInputElement: FakeInput };
vm.runInContext(compat, vm.createContext({ window, globalThis: window }), {
  filename: "particle-editor/ai-sequence-input-compat.tool.js"
});
const api = window.NovaFlowAiSequenceInputCompat;
if (!api || typeof api.aiSequenceFileMatchesUploadKind !== "function") {
  throw new Error("input compatibility API is missing");
}
const sourceOwnedDomKinds = [
  ["参考图1", "ref_image"],
  ["参考图2", "jimeng_image2_ref"],
  ["参考图3", "jimeng_image3_ref"],
  ["参考图4", "jimeng_image4_ref"],
  ["视频参考", "jimeng_video_ref"],
  ["声音参考", "jimeng_audio_ref"]
];
const sourceOwnedSlots = new Map();
const sourceOwnedReferenceColumn = new FakeElement();
sourceOwnedReferenceColumn.querySelector = (selector) => {
  const match = selector.match(/^\[data-ais-import="(.+)"\]$/);
  return match ? sourceOwnedSlots.get(match[1]) || null : null;
};
sourceOwnedDomKinds.forEach(([domKind]) => {
  sourceOwnedSlots.set(domKind, new FakeElement(
    (selector) => selector.includes("data-novaflow-ai-reference-column") ? sourceOwnedReferenceColumn : null,
    { "data-ais-import": domKind }
  ));
});
sourceOwnedDomKinds.forEach(([domKind, canonicalKind]) => {
  const actual = api.getAiSequenceSourceOwnedUploadKind(sourceOwnedSlots.get(domKind));
  if (actual !== canonicalKind) {
    throw new Error(`live DOM slot ${domKind} resolved as ${actual || "<empty>"}, expected ${canonicalKind}`);
  }
});
const matches = api.aiSequenceFileMatchesUploadKind;
if (!matches({ name: "ref.webp", type: "image/webp" }, "jimeng_image3_ref")) throw new Error("image slot rejected image");
if (matches({ name: "clip.mp4", type: "video/mp4" }, "jimeng_image3_ref")) throw new Error("image slot accepted video");
if (!matches({ name: "clip.mp4", type: "video/mp4" }, "jimeng_video_ref")) throw new Error("video slot rejected video");
if (!matches({ name: "voice.wav", type: "audio/wav" }, "jimeng_audio_ref")) throw new Error("audio slot rejected audio");
if (matches({ name: "clip.mp4", type: "video/mp4" }, "jimeng_audio_ref")) throw new Error("audio slot accepted video");
const findInput = api.findAiSequenceNativeInputByRawKind;
if (findInput(dropzone, "ref_image") !== nativeInputs[0]) throw new Error("reference image 1 mapped to wrong input");
if (findInput(dropzone, "jimeng_image2_ref") !== nativeInputs[4]) throw new Error("reference image 2 mapped to wrong input");
if (findInput(dropzone, "jimeng_image3_ref") !== nativeInputs[5]) throw new Error("reference image 3 mapped to wrong input");
if (findInput(dropzone, "jimeng_image4_ref") !== nativeInputs[6]) throw new Error("reference image 4 mapped to wrong input");
if (findInput(dropzone, "jimeng_video_ref") !== nativeInputs[7]) throw new Error("video reference mapped to wrong input");
if (findInput(dropzone, "jimeng_audio_ref") !== nativeInputs[8]) throw new Error("audio reference mapped to wrong input");

console.log("PASS AI sequence six-slot drop contract");
