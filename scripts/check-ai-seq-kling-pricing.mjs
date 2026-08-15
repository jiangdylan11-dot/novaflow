import fs from "node:fs";

const bundlePath = "particle-editor/assets/index-BbIa-2NM.js";
const bundle = fs.readFileSync(bundlePath, "utf8");

const checks = [
  {
    name: "Kling button must not use a fixed credit label",
    pass: !bundle.includes("开始生成视频 · 425.4分")
  },
  {
    name: "Cloud generation button consumes the live workflow pricing snapshot",
    pass: !bundle.includes("开始生成视频") &&
      bundle.includes("window.__nfAiSeqCloudLiveSnapshot=nfGetLiveAiSeqCloudSubmitSnapshot()") &&
      bundle.includes("NovaFlowAiSequenceCreditPricing?.getButtonLabel") &&
      bundle.includes("referenceVideoCount:nfJimengVideoRef?.objectUrl?1:0")
  },
  {
    name: "Cloud generate audio boolean renders as a state toggle instead of true/false text",
    pass: bundle.includes("isCloudGenerateAudioToggle") &&
      bundle.includes("aria-pressed") &&
      !bundle.includes("children:n?`true`:`false`")
  },
  {
    name: "Cloud generate audio toggle reuses the compact random-seed switch sizing",
    pass: !bundle.includes("isCloudGenerateAudioToggle?{width:46") &&
      !bundle.includes("width:20,height:20,borderRadius:999,background:`#fff`")
  },
  {
    name: "AI sequence state toggles render a compact knob before runtime mutation",
    pass: bundle.includes('"data-novaflow-ai-state-toggle-knob":`1`') &&
      bundle.includes("left:n?20:4") &&
      bundle.includes("width:10,minWidth:10,maxWidth:10,height:10,minHeight:10,maxHeight:10") &&
      !bundle.includes("style:{height:30,padding:`0 12px`,background:n?`#1ea672`:`#333333`")
  },
  {
    name: "Local random seed toggle renders a compact knob on the first frame",
    pass: bundle.includes("left:Gt?20:4") &&
      !bundle.includes("style:{height:30,padding:`0 12px`,background:Gt?`#1ea672`:`#333333`")
  },
  {
    name: "Cloud numeric inputs use fixed first-frame width constraints",
    pass: bundle.includes("width:50,minWidth:50,maxWidth:50,flex:`0 0 50px`,height:26") &&
      !bundle.includes("width:45,minWidth:45,maxWidth:45,flex:`0 0 45px`,height:26")
  },
  {
    name: "Kling reference column uses settled first-frame vertical offset",
    pass: bundle.includes("marginTop:ze===`cloud`&&ot===`kling`&&Ve===`image_video`?83:") &&
      !bundle.includes("marginTop:ze===`cloud`&&ot===`kling`&&Ve===`image_video`?98:70")
  },
  {
    name: "Kling seed is not exposed as a cloud parameter",
    pass: !bundle.includes("{key:`seed`,label:`seed`,type:`number`,defaultValue:0,min:0,max:2147483647,step:1}]},jimeng")
  },
  {
    name: "Cloud patch uses an internal random seed instead of mapped seed params",
    pass: bundle.includes("nfAiSeqRandomSeed") &&
      !bundle.includes("l(`seed`,Number(t.seed)||0)")
  },
  {
    name: "Kling pricing must use the Comfy credits/USD conversion",
    pass: bundle.includes("NF_AI_SEQ_KLING_CREDITS_PER_USD=211")
  },
  {
    name: "Kling storyboard durations must be capped by total 15 seconds",
    pass: bundle.includes("NF_AI_SEQ_KLING_MAX_TOTAL_SECONDS=15") &&
      bundle.includes("nfAiSeqKlingEffectiveDurations")
  },
  {
    name: "Kling duration controls must not retain the old 20 second max",
    pass: !bundle.includes("{key:`duration`,label:`时长`,type:`number`,showFor:`first_last`,defaultValue:5,min:1,max:20,step:1}")
  }
  ,
  {
    name: "Cloud video generation must wait for completed history output files",
    pass: bundle.includes("NF_AI_SEQ_OUTPUT_EMPTY_GRACE_MS=15e3") &&
      bundle.includes("生成完成，等待输出文件写入")
  },
  {
    name: "Kling storyboard generation must read visible prompt inputs before patching workflow",
    pass: bundle.includes("nfGetLiveAiSeqKlingStoryboardPrompts") &&
      bundle.includes("storyboardPrompts:nfLiveKlingStoryboardPrompts")
  },
  {
    name: "Kling storyboard prompt capture must not depend on stale provider state",
    pass: bundle.includes("let nfLiveKlingStoryboardPrompts=nfCloudMode&&a===`image_video`?nfGetLiveAiSeqKlingStoryboardPrompts():[]") &&
      bundle.includes("if(nfCloudMode&&a===`image_video`&&!nfLiveKlingStoryboardPrompts.some")
  },
  {
    name: "Kling storyboard generation must snapshot visible prompts before click-side state refresh",
    pass: bundle.includes("window.__nfAiSeqKlingStoryboardPrompts=nfGetLiveAiSeqKlingStoryboardPrompts()") &&
      bundle.includes("let e=window.__nfAiSeqKlingStoryboardPrompts")
  },
  {
    name: "Kling storyboard prompt cache must capture before React click handling",
    pass: bundle.includes("nfBindAiSeqKlingStoryboardPromptCache") &&
      bundle.includes("pointerdown") &&
      bundle.includes("__nfAiSeqKlingStoryboardPromptCacheBound")
  },
  {
    name: "Kling storyboard workflow must reject empty storyboard prompts before /prompt",
    pass: bundle.includes("Kling storyboard prompt is empty") &&
      bundle.includes("storyboardPrompts")
  },
  {
    name: "Cloud generation must snapshot visible provider, mode, and params before submit",
    pass: bundle.includes("__nfAiSeqCloudSubmitSnapshot") &&
      bundle.includes("nfGetLiveAiSeqCloudSubmitSnapshot") &&
      bundle.includes("provider:ot") &&
      bundle.includes("genType:Ve") &&
      bundle.includes("params:nfAiSeqPickLiveCloudParams")
  },
  {
    name: "Cloud workflow selection must prefer the live submit snapshot",
    pass: bundle.includes("nfCloudSubmitSnapshot?.provider||e.aiSeqCloudProvider") &&
      bundle.includes("nfCloudSubmitSnapshot?.genType||e.aiSeqGenType") &&
      bundle.includes("NFAiSeqGetCloudWorkflowV2(nfCloudProvider,nfCloudGenType,nfCloudParams)")
  },
  {
    name: "Cloud workflow patching must prefer live params over stale provider state",
    pass: bundle.includes("nfCloudSubmitSnapshot?.params") &&
      bundle.includes("Object.assign({},e.aiSeqCloudParamsByProvider?.[String(nfCloudProvider||``)]||{},nfCloudSubmitSnapshot?.params||{})") &&
      bundle.includes("provider:nfCloudProvider") &&
      bundle.includes("genType:nfCloudGenType")
  }
];

const failed = checks.filter((item) => !item.pass);
for (const item of checks) {
  console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
}

if (failed.length) {
  process.exitCode = 1;
}
