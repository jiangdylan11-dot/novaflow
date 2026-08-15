import fs from "node:fs";

const bundlePath = "particle-editor/assets/index-BbIa-2NM.js";
const bundle = fs.readFileSync(bundlePath, "utf8");
const runtimePath = "particle-editor/novaflow-brand-runtime.js";
const runtime = fs.readFileSync(runtimePath, "utf8");

function extractFunctionBody(source, name) {
  const marker = `function ${name}`;
  return extractFunctionBodyFromMarker(source, marker);
}

function extractFunctionBodyFromMarker(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const braceStart = source.indexOf("{", start);
  if (braceStart < 0) return "";
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(braceStart + 1, index);
    }
  }
  return "";
}

function extractRawTemplate(name) {
  const marker = `${name}=String.raw\``;
  const start = bundle.indexOf(marker);
  if (start < 0) throw new Error(`${name} template marker not found`);
  const bodyStart = start + marker.length;
  const end = bundle.indexOf("`", bodyStart);
  if (end < 0) throw new Error(`${name} template terminator not found`);
  return bundle.slice(bodyStart, end);
}

const templateText = extractRawTemplate("NFAiSeqJimengR2V");
const template = JSON.parse(templateText);
const flfTemplateText = extractRawTemplate("NFAiSeqJimengFLF2V");
const flfTemplate = JSON.parse(flfTemplateText);
const appBody = extractFunctionBodyFromMarker(bundle, "function wd(){let{systems:");
const appAiSeqStateDestructure = appBody.slice(0, appBody.indexOf("}=Hs({"));
const aiSeqStateProducerStart = bundle.indexOf("return{aiSeqMode:");
const aiSeqStateProducerEnd = bundle.indexOf(",aiSeqCanvasImage:", aiSeqStateProducerStart);
const aiSeqStateProducer = aiSeqStateProducerStart >= 0 && aiSeqStateProducerEnd > aiSeqStateProducerStart
  ? bundle.slice(aiSeqStateProducerStart, aiSeqStateProducerEnd)
  : "";
const jimengParamsStart = bundle.indexOf("jimeng:{params:");
const jimengParamsBlock = jimengParamsStart >= 0
  ? bundle.slice(jimengParamsStart, bundle.indexOf("}},tn=e=>", jimengParamsStart))
  : "";

function findNodeByClass(workflow, classType) {
  return Object.values(workflow).find((node) => node?.class_type === classType);
}

const r2vNode = findNodeByClass(template, "ByteDance2ReferenceNode");
const flfNode = findNodeByClass(flfTemplate, "ByteDance2FirstLastFrameNode");
const fullRowOffsetBody = extractFunctionBody(runtime, "getAiAnimationSourceOwnedFullRowOffset");
const bottomLayoutBody = extractFunctionBody(runtime, "syncAiAnimationSourceOwnedBottomLayout");
const modelMethodChangeBody = extractFunctionBody(runtime, "handleAiAnimationModelMethodSelectChange");
const normalizeReferenceColumnBody = extractFunctionBody(runtime, "normalizeAiAnimationReferenceColumnPosition");

const checks = [
  {
    name: "seedance2_0 R2V template uses the ByteDance reference node id 360",
    pass: template["360"]?.class_type === "ByteDance2ReferenceNode"
  },
  {
    name: "seedance2_0 R2V template exposes four image reference nodes",
    pass: ["356", "352", "353", "354"].every((id) => template[id]?.class_type === "LoadImage") &&
      Object.values(template).filter((node) => node?.class_type === "LoadImage").length === 4
  },
  {
    name: "seedance2_0 R2V template keeps video and audio reference nodes",
    pass: Object.values(template).filter((node) => node?.class_type === "LoadVideo").length === 1 &&
      Object.values(template).filter((node) => node?.class_type === "LoadAudio").length === 1
  },
  {
    name: "seedance2_0 R2V template writes the renamed filename prefix",
    pass: findNodeByClass(template, "SaveVideo")?.inputs?.filename_prefix === "video/seedance2_0_r2v"
  },
  {
    name: "seedance2_0 R2V template preserves the attached workflow defaults",
    pass: r2vNode?.inputs?.["model.resolution"] === "720p" &&
      r2vNode?.inputs?.["model.ratio"] === "1:1" &&
      r2vNode?.inputs?.["model.duration"] === 7
  },
  {
    name: "seedance2_0 R2V template maps four images plus video and audio",
    pass: [
      ["model.reference_images.image_1", "356"],
      ["model.reference_images.image_2", "352"],
      ["model.reference_images.image_3", "353"],
      ["model.reference_images.image_4", "354"],
      ["model.reference_videos.video_1", "361"],
      ["model.reference_audios.audio_1", "362"]
    ].every(([key, id]) => Array.isArray(r2vNode?.inputs?.[key]) && r2vNode.inputs[key][0] === id)
  },
  {
    name: "seedance2_0 R2V patch preserves declared reference image order",
    pass: bundle.includes("nfImageReferenceIds")
  },
  {
    name: "seedance2_0 R2V patch writes the renamed prefix",
    pass: !bundle.includes("`video/Seedance2.0_4k`") &&
      bundle.includes("`video/seedance2_0_r2v`")
  },
  {
    name: "seedance2_0 watermark is not exposed as a cloud parameter",
    pass: !bundle.includes("{key:`watermark`,label:`水印`,type:`boolean`,defaultValue:!1}")
  },
  {
    name: "seedance2_0 seed is not exposed as a cloud parameter",
    pass: !bundle.includes("{key:`seed`,label:`seed`,type:`number`,defaultValue:0,min:0,max:2147483647,step:1}]}},tn=")
  },
  {
    name: "seedance2_0 patch keeps watermark fixed off",
    pass: bundle.includes("d(e,`watermark`,!1)") &&
      !bundle.includes("d(e,`watermark`,u(`watermark`,!1))")
  },
  {
    name: "seedance2_0 patch uses an internal random seed instead of mapped seed params",
    pass: bundle.includes("nfAiSeqRandomSeed") &&
      !bundle.includes("l(`seed`,Number(t.seed)||0)")
  },
  {
    name: "Jimeng resolution options match the live Seedance node",
    pass: ["480p", "720p", "1080p"].every((value) =>
      jimengParamsBlock.includes(`value:\`${value}\`,label:\`${value}\``)
    ) && !jimengParamsBlock.includes("value:`4k`,label:`4k`")
  },
  {
    name: "seedance2_0 R2V template exposes four image plus video/audio reference slots",
    pass: [
      "model.reference_images.image_1",
      "model.reference_images.image_2",
      "model.reference_images.image_3",
      "model.reference_images.image_4",
      "model.reference_videos.video_1",
      "model.reference_audios.audio_1"
    ].every((key) => Object.prototype.hasOwnProperty.call(r2vNode?.inputs || {}, key))
  },
  {
    name: "seedance2_0 FLF template is present",
    pass: !!flfNode
  },
  {
    name: "seedance2_0 FLF template exposes only valid first/last frame image inputs",
    pass: [
      "first_frame",
      "last_frame"
    ].every((key) => Object.prototype.hasOwnProperty.call(flfNode?.inputs || {}, key)) &&
      !["video_1", "audio_1"].some((key) => Object.prototype.hasOwnProperty.call(flfNode?.inputs || {}, key)) &&
      Object.values(flfTemplate).every((node) => !["LoadVideo", "LoadAudio"].includes(node?.class_type))
  },
  {
    name: "seedance2_0 UI has four image slots plus image-video-only media slots",
    pass: [
      "\\u53c2\\u8003\\u56fe3",
      "\\u53c2\\u8003\\u56fe4",
      "\\u89c6\\u9891\\u53c2\\u8003",
      "\\u58f0\\u97f3\\u53c2\\u8003",
      "seedance2_0",
      "kling_v3"
    ].every((needle) =>
      bundle.includes(needle)
    ) && bundle.includes("nfSeedanceR2VFourRef")
  },
  {
    name: "seedance2_0 UI destructures image 3/4 state before rendering upload cards",
    pass: [
      "aiSeqJimengImage3Ref:nfJimengImage3Ref",
      "setAiSeqJimengImage3Ref:nfSetJimengImage3Ref",
      "aiSeqJimengImage4Ref:nfJimengImage4Ref",
      "setAiSeqJimengImage4Ref:nfSetJimengImage4Ref"
    ].every((needle) => appAiSeqStateDestructure.includes(needle))
  },
  {
    name: "seedance2_0 state producer returns image 3/4 state and setters",
    pass: [
      "aiSeqJimengImage3Ref:nfJimengImage3Ref",
      "setAiSeqJimengImage3Ref:nfSetJimengImage3Ref",
      "aiSeqJimengImage4Ref:nfJimengImage4Ref",
      "setAiSeqJimengImage4Ref:nfSetJimengImage4Ref"
    ].every((needle) => aiSeqStateProducer.includes(needle))
  },
  {
    name: "seedance2_0 patch supports R2V video/audio fields without FLF video/audio fields",
    pass: ["video_1", "audio_1", "LoadVideo", "LoadAudio"].every((needle) =>
      bundle.includes(needle)
    ) && !bundle.includes("asset_1")
  },
  {
    name: "AI sequence bottom layout does not use source bundle negative reference offsets",
    pass: !bundle.includes("left:-(ze===`cloud`&&ot===`jimeng`?568:Ve===`first_last`?284:142)") &&
      !bundle.includes("width:`calc(100% + ${ze===`cloud`&&ot===`jimeng`?568:Ve===`first_last`?284:142}px)`")
  },
  {
    name: "Source-owned bottom layout seeds final reference vars on the first frame",
    pass: bundle.includes('"--novaflow-ai-reference-column-width":') &&
      bundle.includes('"--novaflow-ai-reference-offset":') &&
      bundle.includes("left:`calc(-1 * var(--novaflow-ai-reference-offset, 142px))`") &&
      bundle.includes("width:`calc(100% + var(--novaflow-ai-reference-offset, 142px))`") &&
      !bundle.includes("marginTop:132,overflow:`visible`")
  },
  {
    name: "Seedance source-owned first frame starts at the settled runtime reference metrics",
    pass: bundle.includes('"--novaflow-ai-reference-column-width":ze===`cloud`&&ot===`jimeng`&&Ve===`image_video`?`calc(100% - 267px)`:') &&
      bundle.includes('"--novaflow-ai-reference-offset":ze===`cloud`&&ot===`jimeng`&&Ve===`image_video`?`calc(100% - 257px)`:') &&
      bundle.includes("ot===`jimeng`&&Ve===`image_video`?83:70") &&
      !bundle.includes("?`558px`:Ve===`first_last`") &&
      !bundle.includes("?`568px`:Ve===`first_last`")
  },
  {
    name: "Runtime source-owned reference metrics allow four Jimeng reference slots",
    pass: !runtime.includes("Math.min(3, dropzones.length || 1)") &&
      !runtime.includes("Math.min(3, visibleCount || dropzones.length || 1)")
  },
  {
    name: "Runtime source-owned reference metrics count all six seedance2_0 R2V upload slots",
    pass: !runtime.includes("Math.min(4, dropzones.length || 1)") &&
      runtime.includes("Math.min(6, dropzones.length || 1)")
  },
  {
    name: "Runtime source-owned dense six-slot layout narrows width without reducing upload height",
    pass: runtime.includes("AI_ANIMATION_SOURCE_OWNED_DENSE_REFERENCE_MIN_SLOT") &&
      runtime.includes("denseReferenceSlotHeight") &&
      runtime.includes("slotWidth") &&
      runtime.includes("slotHeight")
  },
  {
    name: "Runtime source-owned bottom rows stay inside their container",
    pass: !runtime.includes("left: calc(-1 * var(--novaflow-ai-reference-offset, 142px)) !important") &&
      !runtime.includes("width: calc(100% + var(--novaflow-ai-reference-offset, 142px)) !important") &&
      !runtime.includes('setStylePropertyIfChanged(node, "left", referenceShift, "important")') &&
      !runtime.includes('setStylePropertyIfChanged(node, "width", expandedWidth, "important")')
  },
  {
    name: "Runtime source-owned settings rows span the reference column for left alignment",
    pass: runtime.includes("getAiAnimationSourceOwnedFullRowOffset") &&
      runtime.includes("isAiAnimationCloudModelMethod") &&
      runtime.includes("sourceOwnedFullRowLeft") &&
      runtime.includes("sourceOwnedFullRowWidth") &&
      runtime.includes("settingsColumn.contains(node)") &&
      runtime.includes('setStylePropertyIfChanged(node, "left", sourceOwnedFullRowLeft, "important")') &&
      runtime.includes('setStylePropertyIfChanged(node, "width", sourceOwnedFullRowWidth, "important")')
  },
  {
    name: "Runtime source-owned reference width is measured from real upload slots",
    pass: runtime.includes("measureAiAnimationReferenceColumnWidth") &&
      runtime.includes("referenceColumn.scrollWidth") &&
      runtime.includes("dropzoneRects")
  },
  {
    name: "Runtime source-owned single prompt column spans cloud prompt area",
    pass: runtime.includes("syncAiAnimationSourceOwnedPromptColumnSpan") &&
      runtime.includes("shouldSpanSinglePrompt") &&
      runtime.includes('setStylePropertyIfChanged(promptColumn, "grid-column", "1 / -1", "important")') &&
      runtime.includes('setStylePropertyIfChanged(promptColumn, "grid-column", "auto", "important")')
  },
  {
    name: "Runtime local model method keeps source-owned settings row left alignment",
    pass: runtime.includes("getAiAnimationSelectedModelMethod") &&
      runtime.includes('["local_a", "local_b", "kling", "jimeng"]') &&
      runtime.includes('modelMethod === "kling" || modelMethod === "jimeng"') &&
      runtime.includes("const sourceOwnedFullRowOffset = getAiAnimationSourceOwnedFullRowOffset(mainRow, settingsColumn)") &&
      !runtime.includes("const sourceOwnedFullRowOffset = cloudModelMethod ? getAiAnimationSourceOwnedFullRowOffset(mainRow, settingsColumn) : 0")
  },
  {
    name: "Runtime model method changes schedule delayed bottom layout refresh",
    pass: runtime.includes("handleAiAnimationModelMethodSelectChange") &&
      runtime.includes("isAiAnimationModelMethodSelect") &&
      runtime.includes("scheduleAiAnimationStructureRefresh([0, 16, 32, 60, 120, 240, 320])")
  },
  {
    name: "Runtime model method changes invalidate cached layout reads",
    pass: runtime.includes("clearNovaflowRafLayoutReadCaches") &&
      modelMethodChangeBody.includes("clearNovaflowRafLayoutReadCaches()")
  },
  {
    name: "Runtime source-owned full-row offset uses fresh rects after provider switches",
    pass: fullRowOffsetBody.includes(".getBoundingClientRect()") &&
      !fullRowOffsetBody.includes("getRafCachedClientRect(mainRow)") &&
      !fullRowOffsetBody.includes("getRafCachedClientRect(settingsColumn)")
  },
  {
    name: "Runtime source-owned reference top can align to Kling storyboard grids",
    pass: runtime.includes("getAiAnimationSourceOwnedPromptAlignElement") &&
      bottomLayoutBody.includes("getAiAnimationSourceOwnedPromptAlignElement(promptGrid, promptFrame)") &&
      runtime.includes('[data-novaflow-ai-storyboard-grid="1"]') &&
      runtime.includes("getBoundingClientRect().top -")
  },
  {
    name: "Runtime downstream reference alignment keeps Kling storyboard target",
    pass: runtime.includes("const targetFrame = getAiAnimationSourceOwnedPromptAlignElement(") &&
      normalizeReferenceColumnBody.includes("getAiAnimationSourceOwnedPromptAlignElement(promptGrid, promptFrame)") &&
      !normalizeReferenceColumnBody.includes("promptFrame instanceof HTMLElement ? promptFrame : promptGrid")
  }
];

const failed = checks.filter((item) => !item.pass);
for (const item of checks) {
  console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
}

if (failed.length) {
  process.exitCode = 1;
}
