const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "particle-editor", "novaflow-smart-ai.js"), "utf8");
const index = fs.readFileSync(path.join(root, "particle-editor", "index.html"), "utf8");
const bundle = fs.readFileSync(path.join(root, "particle-editor", "assets", "index-BbIa-2NM.js"), "utf8");

const promptWorkflowScript = "ai-sequence-minimax-h3-prompt.workflow.js?v=20260915-h3-upload-driven-4";
const reverseWorkflowScript = "ai-sequence-minimax-h3-reverse.workflow.js?v=20260914-h3-history-15-1";
const smartAiScript = "novaflow-smart-ai.js?v=20260916-mention-surfaces-1";
assert.ok(index.includes(promptWorkflowScript), "the H3 prompt workflow must load from the authoritative entry");
assert.ok(index.includes(reverseWorkflowScript), "the H3 reverse workflow must load from the authoritative entry");
assert.ok(index.includes(smartAiScript), "the H3-aware Smart AI surface must use its current cache key");
assert.ok(index.indexOf(promptWorkflowScript) < index.indexOf(smartAiScript), "the H3 prompt workflow must load before Smart AI");
assert.ok(index.indexOf(reverseWorkflowScript) < index.indexOf(smartAiScript), "the H3 reverse workflow must load before Smart AI");
assert.match(bundle, /"data-novaflow-ai-generation-mode":e\.value/);

function extractNamedFunction(text, name) {
  const marker = `function ${name}(`;
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `${name} must exist`);
  const declarationStart = text.slice(Math.max(0, start - 6), start) === "async " ? start - 6 : start;
  const paramsStart = text.indexOf("(", start);
  let paramsDepth = 0;
  let paramsQuote = "";
  let paramsEscaped = false;
  let bodyStart = -1;
  for (let index = paramsStart; index < text.length; index += 1) {
    const char = text[index];
    if (paramsQuote) {
      if (paramsEscaped) paramsEscaped = false;
      else if (char === "\\") paramsEscaped = true;
      else if (char === paramsQuote) paramsQuote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      paramsQuote = char;
      continue;
    }
    if (char === "(") paramsDepth += 1;
    if (char === ")") {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = text.indexOf("{", index + 1);
        break;
      }
    }
  }
  assert.ok(bodyStart >= 0, `${name} body must exist`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(declarationStart, index + 1);
    }
  }
  throw new Error(`${name} body is incomplete`);
}

const advanceResourceVersionSource = extractNamedFunction(source, "miniMaxH3AdvanceResourceVersion");
const advanceResourceVersionContext = vm.createContext({ MINIMAX_H3_RESOURCE_VERSION: 0, Number });
const advanceResourceVersion = vm.runInContext(`(${advanceResourceVersionSource})`, advanceResourceVersionContext);
assert.equal(advanceResourceVersion(), 1);
assert.equal(advanceResourceVersion(), 2);
assert.equal(advanceResourceVersionContext.MINIMAX_H3_RESOURCE_VERSION, 2);
const startSource = extractNamedFunction(source, "start");
assert.doesNotMatch(startSource, /runSmartAi\s*\(|smartAiPromptOptimize|promptAssistantOptimizePrompt/, "startup must only mount controls, never generate");

assert.match(source, /const MINIMAX_H3_PROMPT_PURPOSE = "minimax-h3-prompt-enhance"/);
assert.match(source, /const MINIMAX_H3_I2V_REVERSE_PURPOSE = "minimax-h3-i2v-reverse"/);
assert.match(source, /const MINIMAX_H3_FL2V_REVERSE_PURPOSE = "minimax-h3-fl2v-reverse"/);
assert.match(source, /const MINIMAX_H3_VISUAL_SCHEMA = "nf\.h3\.visual\.v1"/);
assert.doesNotMatch(source, /data-novaflow-h3-sensitive-analysis="1"/);
assert.doesNotMatch(source, /data-novaflow-h3-adult-confirmation="1"/);
assert.match(source, /h3ContentPolicy: state\.context\?\.miniMaxH3/);
assert.match(source, /function miniMaxH3SensitiveRequestHasExplicitMinorTerms\(/);
assert.match(source, /function miniMaxH3SensitiveRequestHasSensitiveTerms\(/);
assert.match(source, /miniMaxH3SensitiveRequestHasExplicitMinorTerms\(actualUserIntent\)[\s\S]*miniMaxH3SensitiveRequestHasSensitiveTerms\(actualUserIntent\)/);
assert.match(extractNamedFunction(source, "miniMaxH3SensitiveRequestHasExplicitMinorTerms"), /\\u672a\\u6210\\u5e74|underage|minors\?|child/,
  "sensitive H3 analysis must retain only explicit minor evidence before a request leaves the UI");
assert.doesNotMatch(extractNamedFunction(source, "miniMaxH3SensitiveRequestHasExplicitMinorTerms"), /\\u5c11\\u5973|\\u5c11\\u5e74|girls\?|boys\?|teens\?|young\[- \]\?looking/,
  "ambiguous age wording must not be treated as proof of a minor");
assert.match(source, /data-novaflow-ai-generation-mode/);
assert.match(source, /captureMiniMaxH3PromptContext\(button, promptTarget\)/);
assert.match(source, /window\.NovaFlowAiSequenceMiniMaxH3PromptWorkflow/);
assert.match(source, /typeof workflow\.prepareRequest !== "function"/);
assert.match(source, /typeof workflow\.validateAndRestore !== "function"/);
assert.match(source, /window\.NovaFlowAiSequenceMiniMaxH3ReverseWorkflow/);
assert.match(source, /typeof workflow\.getCapability !== "function"/);
assert.match(source, /await refreshMiniMaxH3ReverseContext\(\)/);
assert.match(source, /isReverseRequest && !isMiniMaxH3ReverseRequest && !state\.images\.length/);
assert.match(source, /supportsNegativePrompt: false,[\s\S]*?purpose: MINIMAX_H3_PROMPT_PURPOSE/);
assert.match(source, /document\.addEventListener\("click", trackMiniMaxH3ResourceClick, true\)/);
assert.match(source, /document\.addEventListener\("change", trackMiniMaxH3ResourceFileChange, true\)/);
assert.match(source, /document\.addEventListener\("drop", trackMiniMaxH3ResourceDrop, true\)/);
assert.match(source, /querySelector\("\.novaflow-smart-ai-submit"\)\?\.addEventListener\("click", runSmartAi\)/);
assert.match(source, /usesStaticVisualV2 \|\| isMiniMaxH3ReverseRequest/,
  "H3 reverse failures must consume the same structured safe envelope as visual v2");
assert.match(source, /isMiniMaxH3ReverseRequest \? "nf\.h3\.visual\.v1" : "nf\.visual\.v2"/,
  "H3 reverse failures must retain their requested visual schema");
assert.doesNotMatch(source, /buildMiniMaxH3GuaranteedFallback|已写入可用H3保底提示词|重新精细分析参考图/,
  "H3 reverse failures must never promote a generic protocol template to a successful writeback");
assert.match(source, /state\.messageTone === "error" \? "error"/,
  "H3 reverse fact-validation failures must expose an explicit error tone");
assert.match(source, /validationLeaf: cleanSmartAiFailureCode\(readValue\("validationLeaf"\) \|\| readValue\("h3ValidationLeaf"\)\)/,
  "H3 failure details must preserve the backend validation leaf for diagnosis");
assert.match(source, /failure\?\.failureClass,[\s\S]*?failure\?\.validationLeaf/,
  "H3 status text must include the failure class and validation leaf in its error codes");
assert.match(source, /role="\$\{state\.messageTone === "error" \? "alert" : "status"\}"/);

const failureCategorySource = extractNamedFunction(source, "smartAiFailureCategoryLabel");
const failureCategoryLabel = vm.runInNewContext(`(${failureCategorySource})`);
assert.match(failureCategoryLabel({
  requestedVisualSchema: "nf.h3.visual.v1",
  failureCategory: "provider_content_policy"
}), /H3/);
assert.match(failureCategoryLabel({
  requestedVisualSchema: "nf.h3.visual.v1",
  failureCategory: "h3_contract_alignment"
}), /MiniMax H3/);
assert.match(failureCategoryLabel({
  requestedVisualSchema: "nf.visual.v2",
  failureCategory: "contract_structure"
}), /v2/, "the existing Art visual-v2 failure wording must remain unchanged");

const failureMarkerText = vm.runInNewContext(`(${extractNamedFunction(source, "miniMaxH3FailureMarkerText")})`);
const failureBlocksFallback = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3FailureBlocksGuaranteedFallback")})`,
  { miniMaxH3FailureMarkerText: failureMarkerText }
);
const failureIsStale = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3FailureIsStale")})`,
  { miniMaxH3FailureMarkerText: failureMarkerText }
);
const failureAllowsFallback = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3FailureAllowsGuaranteedFallback")})`,
  {
    Error,
    miniMaxH3FailureMarkerText: failureMarkerText,
    miniMaxH3FailureBlocksGuaranteedFallback: failureBlocksFallback,
    miniMaxH3FailureIsStale: failureIsStale
  }
);
for (const blocked of [
  { errorCode: "provider_content_policy" },
  { error: { errorCode: "h3-sensitive-minor-request-blocked" } },
  { data: { failureCategory: "provider_content_policy" } },
  { failure: { providerFailureCode: "h3-sensitive-young-evidence-blocked" } },
  { data: { errorCode: "h3-sensitive-review-no-evidence", generationGate: "blocked" } }
]) {
  assert.equal(failureBlocksFallback(blocked), true, "every canonical content-policy envelope must block fallback");
  assert.equal(failureAllowsFallback(blocked), false, "content-policy failures must never enter fallback");
}
for (const technical of [
  { failureCategory: "timeout" },
  { error: { failureCategory: "provider" } },
  { data: { errorCode: "runtime_unavailable" } },
  { failureCategory: "h3_contract_alignment" },
  {
    errorCode: "h3-local-deterministic-validation-failed",
    failureCategory: "h3_contract_alignment",
    failureClass: "audio-fidelity",
    generationGate: "blocked",
    requestedVisualSchema: "nf.h3.visual.v1",
    legacyFallbackSuppressed: true
  },
  Object.assign(new Error("empty H3 response"), { miniMaxH3FallbackFailureType: "invalid_response" })
]) {
  assert.equal(failureAllowsFallback(technical), true, "allowlisted technical failures must enter fallback");
}
for (const stale of [
  new Error("MiniMax H3 reverse snapshot is stale"),
  { errorCode: "h3_resources_changed" },
  { data: { message: "H3 mode changed while enhancing" } }
]) {
  assert.equal(failureIsStale(stale), true);
  assert.equal(failureAllowsFallback(stale), false, "stale state must be rejected before fallback construction");
}
assert.equal(failureAllowsFallback({ failureCategory: "business_rule" }), false,
  "unknown or business failures must not be promoted to technical fallback eligibility");
assert.equal(failureAllowsFallback({ miniMaxH3FallbackFailureType: "bridge_response" }), false,
  "untrusted bridge response data must not be able to self-authorize fallback");
const realDeterministicFailureEnvelope = {
  ok: false,
  error: "本地提示词助手未能生成符合 MiniMax H3 I2VA 忠实协议的确定性反推提示词，请调整素材后重试",
  errorCode: "h3-local-deterministic-validation-failed",
  failureCategory: "h3_contract_alignment",
  failureClass: "audio-fidelity",
  generationGate: "blocked",
  requestedVisualSchema: "nf.h3.visual.v1",
  retryable: false,
  legacyFallbackSuppressed: true
};
assert.equal(failureBlocksFallback(realDeterministicFailureEnvelope), false,
  "generationGate=blocked alone is a validation state, not a content-policy denial");
assert.equal(failureAllowsFallback(realDeterministicFailureEnvelope), true,
  "the complete local deterministic validation envelope must enter guaranteed fallback");
assert.equal(failureBlocksFallback({
  ...realDeterministicFailureEnvelope,
  sensitivePromptBlocked: true
}), true, "an explicit sensitivePromptBlocked flag must remain deny-first");
function loadRealH3WorkflowModule(moduleSource, filename, dependency = null) {
  const context = {
    module: { exports: {} },
    exports: {},
    require(request) {
      if (request === "./ai-sequence-minimax-h3-prompt.workflow.js" && dependency) return dependency;
      throw new Error(`Unexpected real H3 workflow dependency: ${request}`);
    }
  };
  context.NovaFlowH3PromptFormat = require('../admin-server/h3-prompt-enhance.js');
  context.globalThis = context;
  vm.runInNewContext(moduleSource, context, { filename });
  return context.module.exports;
}
const realPromptWorkflowPath = path.join(root, "particle-editor", "ai-sequence-minimax-h3-prompt.workflow.js");
const realReverseWorkflowPath = path.join(root, "particle-editor", "ai-sequence-minimax-h3-reverse.workflow.js");
const realPromptWorkflow = loadRealH3WorkflowModule(fs.readFileSync(realPromptWorkflowPath, "utf8"), realPromptWorkflowPath);
const realReverseWorkflow = loadRealH3WorkflowModule(
  fs.readFileSync(realReverseWorkflowPath, "utf8"),
  realReverseWorkflowPath,
  realPromptWorkflow
);
const realFallbackCurrent = {
  modelId: "minimax_h3_local",
  mode: "image_video",
  durationSeconds: 5,
  prompt: "人物缓慢抬起视线",
  requirements: "保持参考图可见事实，镜头固定",
  contentPolicy: {
    sensitiveVisualAnalysis: true,
    allSubjectsConfirmedAdult: false
  },
  resources: [{
    key: "first_frame",
    occupied: true,
    kind: "image",
    identity: "real-envelope-picture-1",
    sourceId: "real-envelope-picture-1",
    dataUrl: "data:image/png;base64,aGVsbG8=",
    fileName: "picture-1.png",
    mimeType: "image/png"
  }]
};
const realFallbackPrepared = realReverseWorkflow.prepareRequest(realFallbackCurrent);
assert.equal(failureAllowsFallback(realDeterministicFailureEnvelope), true);
assert.throws(() => realReverseWorkflow.buildGuaranteedFallback({
  context: realFallbackPrepared.context,
  userPrompt: realFallbackCurrent.prompt,
  current: realFallbackCurrent
}), /backend-validated visual fact payload.*not write-eligible/,
"a structurally valid generic template must not become a reverse result without trusted visual facts");

class FakeHTMLElement {
  constructor(attributes = {}, selectors = {}) {
    this.attributes = { ...attributes };
    this.selectors = selectors;
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  querySelector(selector) { return this.selectors[selector] || null; }
}
class FakeHTMLButtonElement extends FakeHTMLElement {}
class FakeHTMLInputElement extends FakeHTMLElement {
  constructor(files = []) {
    super();
    this.type = "file";
    this.files = files;
  }
}
class FakeHTMLImageElement extends FakeHTMLElement {
  constructor(src) { super(); this.currentSrc = src; this.src = src; }
}
class FakeHTMLMediaElement extends FakeHTMLElement {}

const captureContextSource = extractNamedFunction(source, "captureMiniMaxH3PromptContext");
const captureContextVm = vm.createContext({
  MINIMAX_H3_MODEL_ID: "minimax_h3_local",
  readMiniMaxH3PromptSurfaceState: () => ({ modelId: "local_a" })
});
const captureH3Context = vm.runInContext(`(${captureContextSource})`, captureContextVm);
assert.equal(captureH3Context({}, {}), null, "Wan and other animation surfaces must not enter the H3 branch");
assert.match(source, /if \(isMiniMaxH3ReverseRequest[\s\S]*?state\.message = smartAiAnalysisFailureStatusMessage\(failure\)/,
  "the no-write failure state must remain scoped to H3 reverse rather than Wan or other providers");
captureContextVm.readMiniMaxH3PromptSurfaceState = () => ({ modelId: "minimax_h3_local", mode: "text_video" });
assert.equal(captureH3Context({}, {}).mode, "text_video");

const contentPolicySource = extractNamedFunction(source, "miniMaxH3ContentPolicy");
const contentPolicyContext = vm.createContext({ Object });
const readH3ContentPolicy = vm.runInContext(`(${contentPolicySource})`, contentPolicyContext);
assert.deepEqual({ ...readH3ContentPolicy() }, {
  sensitiveVisualAnalysis: true,
  allSubjectsConfirmedAdult: false
}, "H3 reverse must always request fact-faithful visual analysis without an adult-confirmation gate");

const explicitMinorSource = extractNamedFunction(source, "miniMaxH3SensitiveRequestHasExplicitMinorTerms");
const hasExplicitH3MinorTerms = vm.runInNewContext(`(${explicitMinorSource})`);
assert.equal(hasExplicitH3MinorTerms("少女角色，所有可见主体均为成年人"), false, "ambiguous role wording is not proof of a minor");
assert.equal(hasExplicitH3MinorTerms("young woman, confirmed adult"), false, "young alone is not proof of a minor");
assert.equal(hasExplicitH3MinorTerms("young adult woman, confirmed adult"), false, "explicit young-adult wording remains allowed");
assert.equal(hasExplicitH3MinorTerms("年轻成年人，已确认成年"), false, "explicit Chinese young-adult wording remains allowed");
assert.equal(hasExplicitH3MinorTerms("teenage girl"), false);
assert.equal(hasExplicitH3MinorTerms("未满18岁"), true);
assert.equal(hasExplicitH3MinorTerms("young-looking character"), false);
assert.equal(hasExplicitH3MinorTerms("child-like figure"), false);
assert.equal(hasExplicitH3MinorTerms("children-like figures"), false);
assert.equal(hasExplicitH3MinorTerms("underage child"), true);
assert.equal(hasExplicitH3MinorTerms("7 y/o character"), true);
assert.equal(hasExplicitH3MinorTerms("aged 16 character"), true);

const sensitiveIntentSource = extractNamedFunction(source, "miniMaxH3SensitiveRequestHasSensitiveTerms");
const hasSensitiveH3Intent = vm.runInNewContext(`(${sensitiveIntentSource})`, { String });
assert.equal(hasSensitiveH3Intent("角色裸体"), true);
assert.equal(hasSensitiveH3Intent("no nudity, ordinary portrait"), false);
assert.equal(hasSensitiveH3Intent("普通儿童挥手场景"), false);

const sensitiveControlsSource = extractNamedFunction(source, "renderMiniMaxH3SensitiveAnalysisControls");
const sensitiveControlsState = {
  mode: "optimize",
  context: { miniMaxH3: { modelId: "minimax_h3_local" } }
};
const sensitiveControlsContext = vm.createContext({
  state: sensitiveControlsState,
  MINIMAX_H3_MODEL_ID: "minimax_h3_local",
  miniMaxH3ReverseCapability: () => ({ supportsReverse: true })
});
const renderH3SensitiveControls = vm.runInContext(`(${sensitiveControlsSource})`, sensitiveControlsContext);
assert.equal(renderH3SensitiveControls(), "", "H3 sensitive controls must not appear during prompt optimization");
sensitiveControlsState.mode = "reverse";
assert.equal(renderH3SensitiveControls(), "", "H3 reverse must not ask users to classify or confirm age");

const requestFingerprintSource = extractNamedFunction(source, "buildSmartAiRequestFingerprint");
const requestFingerprintState = {
  context: { surface: "animation", miniMaxH3: { modelId: "minimax_h3_local" } },
  mode: "reverse",
  engine: "local",
  artTask: "create",
  artStyle: "original",
  backgroundMode: "replace",
  preserveLevel: "high",
  referenceRoles: [],
  targetIndex: 0,
  requirements: "",
  hadInitialPrompt: false,
  images: []
};
const fingerprintContext = vm.createContext({
  state: requestFingerprintState,
  MINIMAX_H3_MODEL_ID: "minimax_h3_local",
  MINIMAX_H3_VISUAL_SCHEMA: "nf.h3.visual.v1",
  getPromptTextareasFromContext: () => ({ positive: { value: "prompt" }, negative: { value: "" } }),
  deriveArtAutoIntent: () => null,
  readArtGenerateNsfw: () => false,
  readSmartAiLiveImageSignature: () => "first-frame-a",
  smartAiReferenceFingerprint: () => "",
  miniMaxH3ContentPolicy: () => ({ sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }),
  JSON,
  String
});
const buildH3Fingerprint = vm.runInContext(`(${requestFingerprintSource})`, fingerprintContext);
const ordinaryFingerprint = buildH3Fingerprint();
requestFingerprintState.miniMaxH3SensitiveVisualAnalysis = true;
requestFingerprintState.miniMaxH3AllSubjectsConfirmedAdult = true;
const sensitiveFingerprint = buildH3Fingerprint();
assert.equal(sensitiveFingerprint, ordinaryFingerprint, "removed age-confirmation UI state must not affect an in-flight response");
assert.equal(JSON.parse(sensitiveFingerprint).h3VisualSchema, "nf.h3.visual.v1");
assert.deepEqual(JSON.parse(sensitiveFingerprint).h3ContentPolicy, {
  sensitiveVisualAnalysis: true,
  allSubjectsConfirmedAdult: false
});

const fileChangeSource = extractNamedFunction(source, "trackMiniMaxH3ResourceFileChange");
const fileChangeCalls = { identities: 0, versions: 0 };
const fileChangeContext = vm.createContext({
  HTMLInputElement: FakeHTMLInputElement,
  HTMLElement: FakeHTMLElement,
  MINIMAX_H3_MODEL_ID: "minimax_h3_local",
  MINIMAX_H3_PENDING_RESOURCE_SLOT: null,
  document: { body: { getAttribute: () => "minimax_h3_local" } },
  miniMaxH3ResourceObjectIdentity: () => { fileChangeCalls.identities += 1; },
  miniMaxH3AdvanceResourceVersion: () => { fileChangeCalls.versions += 1; }
});
const trackFileChange = vm.runInContext(`(${fileChangeSource})`, fileChangeContext);
trackFileChange({ target: new FakeHTMLInputElement([{ name: "same-name.mp4" }]) });
assert.equal(fileChangeCalls.identities, 1);
assert.equal(fileChangeCalls.versions, 1, "an H3 same-name file replacement must advance the resource version");

const activeModeSource = extractNamedFunction(source, "miniMaxH3ActiveMode");
const activeButton = new FakeHTMLButtonElement({
  "aria-pressed": "true",
  "data-novaflow-ai-generation-mode": "first_last"
});
activeButton.textContent = "首尾帧视频";
const activeModeContext = vm.createContext({
  document: { querySelectorAll: () => [activeButton] },
  HTMLButtonElement: FakeHTMLButtonElement,
  MINIMAX_H3_MODE_BY_LABEL: {
    文生视频: "text_video",
    图生视频: "image_video",
    首尾帧视频: "first_last",
    多参视频: "multi_reference"
  },
  miniMaxH3NormalizeMode: (value) => ["text_video", "image_video", "first_last", "multi_reference"].includes(String(value || ""))
    ? String(value)
    : ""
});
const activeMode = vm.runInContext(`(${activeModeSource})`, activeModeContext);
assert.equal(activeMode(new FakeHTMLElement({ "data-novaflow-ai-generation-mode": "multi_reference" })), "multi_reference");
assert.equal(activeMode(new FakeHTMLElement()), "first_last", "active button semantic mode is preferred after workspace state");
delete activeButton.attributes["data-novaflow-ai-generation-mode"];
assert.equal(activeMode(new FakeHTMLElement()), "first_last", "Chinese label remains a compatibility fallback");

const actionOptionsSource = extractNamedFunction(source, "miniMaxH3ActionOptions");
const actionState = { context: { miniMaxH3: { modelId: "minimax_h3_local", mode: "text_video" } } };
const actionContext = vm.createContext({
  state: actionState,
  MINIMAX_H3_MODEL_ID: "minimax_h3_local",
  miniMaxH3ReverseCapability: (captured) => ({
    supportsReverse: ["image_video", "first_last"].includes(captured.mode)
  })
});
const h3ActionOptions = vm.runInContext(`(${actionOptionsSource})`, actionContext);
assert.deepEqual(Array.from(h3ActionOptions(), (entry) => Array.from(entry)), [["optimize", "提示词优化"]]);
actionState.context.miniMaxH3.mode = "image_video";
assert.deepEqual(Array.from(h3ActionOptions(), (entry) => Array.from(entry)), [
  ["optimize", "提示词优化"],
  ["reverse", "参考图反推"]
]);
actionState.context.miniMaxH3.mode = "first_last";
assert.deepEqual(Array.from(h3ActionOptions(), (entry) => Array.from(entry)), [
  ["optimize", "提示词优化"],
  ["reverse", "首尾动作反推"]
]);
actionState.context.miniMaxH3.mode = "multi_reference";
assert.deepEqual(Array.from(h3ActionOptions(), (entry) => Array.from(entry)), [["optimize", "提示词优化"]]);

const refreshImageContextSource = extractNamedFunction(source, "refreshImageContext");
const refreshCalls = { strict: 0, generic: 0 };
const refreshContext = vm.createContext({
  state: { context: { surface: "animation", miniMaxH3: { modelId: "minimax_h3_local" } } },
  MINIMAX_H3_MODEL_ID: "minimax_h3_local",
  refreshMiniMaxH3ReverseContext: async () => { refreshCalls.strict += 1; },
  collectAnimationImages: async () => { refreshCalls.generic += 1; return []; },
  collectArtImages: async () => [],
  renderDialog: () => {},
  syncArtAutoIntent: () => {}
});
const refreshH3Images = vm.runInContext(`(${refreshImageContextSource})`, refreshContext);
const refreshH3Promise = refreshH3Images();

const resourceSnapshotSource = extractNamedFunction(source, "miniMaxH3ResourceSnapshot");
const preview = new FakeHTMLImageElement("blob:h3-picture-1");
const title = { textContent: "hero.png" };
const firstSlot = new FakeHTMLElement({}, {
  img: preview,
  "video, audio": null,
  ".nf-upload-dropzone__title": title,
  'button[title="清除"], button[aria-label="清除"], [data-novaflow-ai-upload-clear="1"]': {}
});
const videoSlot = new FakeHTMLElement({}, {
  img: null,
  "video, audio": null,
  ".nf-upload-dropzone__title": { textContent: "motion.mp4" },
  'button[title="清除"], button[aria-label="清除"], [data-novaflow-ai-upload-clear="1"]': null
});
const audioSlot = new FakeHTMLElement({}, {
  img: null,
  "video, audio": null,
  ".nf-upload-dropzone__title": { textContent: "voice.wav" },
  'button[title="清除"], button[aria-label="清除"], [data-novaflow-ai-upload-clear="1"]': null
});
const descriptors = [
  { key: "multi_ref_image_1", rawKind: "ref_image", domKind: "参考图1", label: "参考图1", kind: "image" },
  { key: "multi_ref_video_1", rawKind: "jimeng_video_ref", domKind: "视频参考", label: "视频参考", kind: "video" },
  { key: "multi_ref_audio_1", rawKind: "jimeng_audio_ref", domKind: "声音参考", label: "声音参考", kind: "audio" }
];
const imageVideoDescriptors = [
  { key: "first_frame", rawKind: "ref_image", domKinds: ["首帧", "参考图", "参考图1"], emptyLabels: ["首帧", "参考图", "参考图1"], label: "首帧", kind: "image" }
];
const firstLastDescriptors = [
  { key: "first_frame", rawKind: "first_frame", domKind: "首帧", label: "首帧", kind: "image" },
  { key: "last_frame", rawKind: "last_frame", domKind: "尾帧", label: "尾帧", kind: "image" }
];
const resourceContext = vm.createContext({
  MINIMAX_H3_RESOURCE_SLOTS: descriptors,
  MINIMAX_H3_IMAGE_VIDEO_RESOURCE_SLOTS: imageVideoDescriptors,
  MINIMAX_H3_FIRST_LAST_RESOURCE_SLOTS: firstLastDescriptors,
  miniMaxH3ResourceSlot: (_workspace, descriptor) => descriptor.key === "multi_ref_image_1" || descriptor.key === "first_frame"
    ? firstSlot
    : descriptor.key === "multi_ref_video_1"
      ? videoSlot
      : descriptor.key === "multi_ref_audio_1"
        ? audioSlot
        : null,
  miniMaxH3PreviewFingerprint: (value) => value ? "fingerprint-1" : "",
  miniMaxH3DomResourceIdentity: () => "",
  MINIMAX_H3_RESOURCE_VERSION: 0,
  HTMLElement: FakeHTMLElement,
  HTMLImageElement: FakeHTMLImageElement,
  HTMLMediaElement: FakeHTMLMediaElement,
  HTMLInputElement: FakeHTMLInputElement,
  Object
});
const resourceSnapshot = vm.runInContext(`(${resourceSnapshotSource})`, resourceContext);
const capturedResources = resourceSnapshot(new FakeHTMLElement(), "multi_reference");
assert.equal(capturedResources.length, 3);
assert.equal(capturedResources[0].occupied, true);
assert.equal(capturedResources[0].fileName, "hero.png");
assert.match(capturedResources[0].sourceId, /fingerprint-1/);
assert.equal(capturedResources[0].previewFingerprint, "fingerprint-1");
assert.equal(capturedResources[1].occupied, true);
assert.equal(capturedResources[1].fileName, "motion.mp4");
assert.equal(capturedResources[2].occupied, true);
assert.equal(capturedResources[2].fileName, "voice.wav");
const originalVideoSourceId = capturedResources[1].sourceId;
const originalAudioSourceId = capturedResources[2].sourceId;
resourceContext.MINIMAX_H3_RESOURCE_VERSION = 1;
const sameNameReplacement = resourceSnapshot(new FakeHTMLElement(), "multi_reference");
assert.notEqual(sameNameReplacement[1].sourceId, originalVideoSourceId, "same-name video replacement must change identity");
assert.notEqual(sameNameReplacement[2].sourceId, originalAudioSourceId, "same-name audio replacement must change identity");
assert.equal(sameNameReplacement[1].resourceVersion, 1);
resourceContext.MINIMAX_H3_RESOURCE_VERSION = 0;
const capturedImageVideo = resourceSnapshot(new FakeHTMLElement(), "image_video");
assert.equal(capturedImageVideo.length, 1);
assert.equal(capturedImageVideo[0].key, "first_frame");
assert.equal(capturedImageVideo[0].occupied, true);
const emptyImageSlot = new FakeHTMLElement({}, {
  img: null,
  "video, audio": null,
  ".nf-upload-dropzone__title": { textContent: "参考图" },
  'button[title="清除"], button[aria-label="清除"], [data-novaflow-ai-upload-clear="1"]': null
});
resourceContext.miniMaxH3ResourceSlot = (_workspace, descriptor) => descriptor.key === "first_frame" ? emptyImageSlot : null;
assert.equal(resourceSnapshot(new FakeHTMLElement(), "image_video")[0].occupied, false, "an empty i2v alias title is not a resource");
resourceContext.miniMaxH3ResourceSlot = (_workspace, descriptor) => ["multi_ref_image_1", "first_frame"].includes(descriptor.key) ? firstSlot : null;
const capturedFirstLast = resourceSnapshot(new FakeHTMLElement(), "first_last");
assert.deepEqual(Array.from(capturedFirstLast, (entry) => entry.key), ["first_frame", "last_frame"]);
assert.equal(capturedFirstLast[0].occupied, true);
assert.equal(capturedFirstLast[1].occupied, false);
assert.equal(resourceSnapshot(new FakeHTMLElement(), "text_video").length, 0);

const prepareSource = extractNamedFunction(source, "prepareMiniMaxH3PromptRequest");
const prepareCalls = [];
const fakeWorkflow = {
  prepareRequest(input) {
    prepareCalls.push(input);
    return { prompt: "compiled H3 request", requirements: "H3 protocol", context: { requestId: "h3-1" } };
  },
  validateAndRestore() { return { ok: true, text: "restored" }; }
};
const prepareState = {
  context: {
    button: {},
    promptTarget: {},
    miniMaxH3: {
      modelId: "minimax_h3_local",
      mode: "multi_reference",
      durationSeconds: 5,
      resources: []
    }
  }
};
const prepareContext = vm.createContext({
  state: prepareState,
  MINIMAX_H3_MODEL_ID: "minimax_h3_local",
  MINIMAX_H3_VISUAL_SCHEMA: "nf.h3.visual.v1",
  miniMaxH3ContentPolicy: () => ({ sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }),
  getMiniMaxH3PromptWorkflow: () => fakeWorkflow,
  readMiniMaxH3PromptSurfaceState: () => ({
    modelId: "minimax_h3_local",
    mode: "multi_reference",
    durationSeconds: 5,
    resources: capturedResources
  }),
  Object
});
const prepareRequest = vm.runInContext(`(${prepareSource})`, prepareContext);
const prepared = prepareRequest("@参考图1 转身", "保留对白");
assert.equal(prepared.prompt, "compiled H3 request");
assert.match(prepared.requirements, /H3 protocol/);
assert.match(prepared.requirements, /保留对白/);
assert.equal(prepareCalls[0].mode, "multi_reference");
assert.equal(prepareCalls[0].durationSeconds, 5);
assert.equal(prepareCalls[0].prompt, "@参考图1 转身");
assert.deepEqual({ ...prepareCalls[0].contentPolicy }, { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false });
assert.equal(prepareCalls[0].resources[0].fileName, "hero.png");
assert.equal(prepareState.context.miniMaxH3.resources[0].fileName, "hero.png", "H3 prompt preparation must refresh live resources selected after dialog open");

const reversePrepareSource = extractNamedFunction(source, "prepareMiniMaxH3ReverseRequest");
const reversePrepareCalls = [];
const reverseHydrateCalls = [];
const reverseContentPolicy = { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false };
const hydratedFirstLastResources = [
  {
    key: "first_frame",
    label: "首帧",
    kind: "image",
    occupied: true,
    identity: "first-live",
    sourceId: "first-live",
    fileName: "first.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,RklSU1Q="
  },
  {
    key: "last_frame",
    label: "尾帧",
    kind: "image",
    occupied: true,
    identity: "last-live",
    sourceId: "last-live",
    fileName: "last.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,TEFTVA=="
  }
];
const reversePrepareState = {
  context: {
    button: {},
    promptTarget: {},
    miniMaxH3: {
      modelId: "minimax_h3_local",
      mode: "first_last",
      durationSeconds: 5,
      resources: []
    }
  }
};
const reversePrepareContext = vm.createContext({
  state: reversePrepareState,
  MINIMAX_H3_MODEL_ID: "minimax_h3_local",
  MINIMAX_H3_VISUAL_SCHEMA: "nf.h3.visual.v1",
  MINIMAX_H3_I2V_REVERSE_PURPOSE: "minimax-h3-i2v-reverse",
  MINIMAX_H3_FL2V_REVERSE_PURPOSE: "minimax-h3-fl2v-reverse",
  miniMaxH3ContentPolicy: () => reverseContentPolicy,
  readMiniMaxH3PromptSurfaceState: () => ({
    modelId: "minimax_h3_local",
    mode: "first_last",
    durationSeconds: 5,
    resources: [
      {
        key: "first_frame",
        label: "首帧",
        kind: "image",
        occupied: true,
        identity: "first-live",
        sourceId: "first-live",
        previewUrl: "blob:first-frame"
      },
      {
        key: "last_frame",
        label: "尾帧",
        kind: "image",
        occupied: true,
        identity: "last-live",
        sourceId: "last-live",
        previewUrl: "blob:last-frame"
      }
    ]
  }),
  hydrateMiniMaxH3ReverseResources: async (captured) => {
    reverseHydrateCalls.push(captured);
    return hydratedFirstLastResources;
  },
  getMiniMaxH3ReverseWorkflow: () => ({
    getCapability: () => ({ supportsReverse: true }),
    prepareRequest(input) {
      reversePrepareCalls.push(input);
      return {
        request: {
          purpose: "minimax-h3-fl2v-reverse",
          visualSchema: "nf.h3.visual.v1",
          contentPolicy: input.contentPolicy,
          images: input.resources.map((item) => ({ role: item.key, dataUrl: item.dataUrl }))
        },
        context: { requestId: "h3-reverse-1" }
      };
    },
    validateAndRestore() {}
  }),
  Object
});
const prepareReverseRequest = vm.runInContext(`(${reversePrepareSource})`, reversePrepareContext);

const validateSource = extractNamedFunction(source, "validateMiniMaxH3PromptResult");
const validateCalls = [];
const validatePrepared = {
  context: { requestId: "h3-1" },
  workflow: {
    validateAndRestore(input) {
      validateCalls.push(input);
      return { ok: true, text: "@参考图1 增强后的 H3 提示词" };
    }
  }
};
const validateState = { context: { button: {}, promptTarget: {} } };
const validateContext = vm.createContext({
  state: validateState,
  miniMaxH3ContentPolicy: () => ({ sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }),
  buildSmartAiRequirements: () => "",
  hydrateMiniMaxH3ReverseResources: async () => [],
  readMiniMaxH3PromptSurfaceState: () => ({
    modelId: "minimax_h3_local",
    mode: "multi_reference",
    durationSeconds: 5,
    resources: capturedResources
  })
});
const validateResult = vm.runInContext(`(${validateSource})`, validateContext);
assert.equal(
  validateResult("structured model output", validatePrepared, { positive: { value: "prompt at request time" } }),
  "@参考图1 增强后的 H3 提示词"
);
assert.equal(validateCalls[0].text, "structured model output");
assert.equal(validateCalls[0].current.prompt, "prompt at request time");
assert.equal(validateCalls[0].current.modelId, "minimax_h3_local");
assert.equal(validateCalls[0].current.mode, "multi_reference");
assert.deepEqual({ ...validateCalls[0].current.contentPolicy }, { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false });

const runSmartAiSource = extractNamedFunction(source, "runSmartAi");

function createSubmitHarness(engine, validationFailure = "") {
  const positive = { value: "@参考图1 在雨中转身", isConnected: true };
  const negative = { value: "should remain untouched", isConnected: true };
  const state = {
    loading: false,
    context: {
      surface: "animation",
      button: {},
      promptTarget: {},
      miniMaxH3: {
        modelId: "minimax_h3_local",
        mode: "first_last",
        durationSeconds: 4,
        resources: capturedResources
      }
    },
    mode: "optimize",
    engine,
    artTask: "create",
    images: [],
    imagesLoading: false,
    referenceRoles: [],
    targetIndex: 0,
    message: ""
  };
  const calls = { grok: [], local: [], prepare: 0, validate: 0, protect: 0, writes: [], closes: 0, renders: 0 };
  const response = { ok: true, prompt: "six-section H3 output", negative_prompt: "must be ignored", has_negative_prompt: true };
  const context = vm.createContext({
    state,
    MINIMAX_H3_PROMPT_PURPOSE: "minimax-h3-prompt-enhance",
    MINIMAX_H3_VISUAL_SCHEMA: "nf.h3.visual.v1",
    window: {
      electronAPI: {
        async smartAiPromptOptimize(payload) { calls.grok.push(payload); return response; },
        async promptAssistantOptimizePrompt(payload) { calls.local.push(payload); return response; }
      }
    },
    ART_REFERENCE_PLAN: null,
    getPromptTextareasFromContext: () => ({ positive, negative }),
    isPromptTextControl: (value) => Boolean(value),
    buildSmartAiRequirements: () => "保持原始对白",
    validateArtDesignState: () => "",
    readSessionToken: () => "session-token",
    renderDialog: () => { calls.renders += 1; },
    prepareMiniMaxH3PromptRequest: () => {
      calls.prepare += 1;
      return {
        prompt: "compiled H3 request",
        requirements: "H3 protocol",
        context: { mode: "first_last", durationSeconds: 4 },
        workflow: {}
      };
    },
    validateMiniMaxH3PromptResult: () => {
      calls.validate += 1;
      if (validationFailure) throw new Error(validationFailure);
      return "@参考图1 validated H3 prompt";
    },
    protectSmartAiResourceMentions: (text) => {
      calls.protect += 1;
      return { text, originalText: text, tokens: [] };
    },
    buildStaticArtReverseRequirements: () => "",
    buildReverseImagesPayload: () => ({ images: [] }),
    buildRoleReferenceImagesPayload: () => ({ images: [] }),
    readSmartAiResult: (result) => ({ prompt: result.prompt, negativePrompt: result.negative_prompt, hasNegativePrompt: result.has_negative_prompt }),
    restoreSmartAiResourceMentions: (text) => ({ ok: true, text }),
    smartAiResourceMentionError: (message) => new Error(message),
    preserveSmartAiReverseResourceMentions: (_current, generated) => generated,
    artHighQualityCgNegativeGuardInstruction: () => "",
    mergeSmartAiNegativePrompt: (base) => base,
    setPromptTextareasValue: (_textareas, prompt, options) => calls.writes.push({ prompt, options }),
    compileArtReferencePlan: async () => ({ version: "test", results: [], capabilities: {} }),
    smartAiReferenceFingerprint: () => "fingerprint",
    buildSmartAiRequestFingerprint: () => "h3-request-fingerprint",
    miniMaxH3ContentPolicy: () => ({ sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false }),
    miniMaxH3SensitiveRequestHasExplicitMinorTerms: () => false,
    showLocalStaticReverseWarning: () => {},
    closeDialog: () => { calls.closes += 1; },
    smartAiFailureMessage: (error) => String(error?.message || error)
  });
  return { state, calls, run: vm.runInContext(`(${runSmartAiSource})`, context) };
}

function createReverseSubmitHarness(engine, h3Mode, validationFailure = "", responseOverride = null, refinement = null, refinementResponse = null) {
  const positive = { value: "人物向镜头转身", isConnected: true };
  const negative = { value: "must remain untouched", isConnected: true };
  const purpose = h3Mode === "image_video" ? "minimax-h3-i2v-reverse" : "minimax-h3-fl2v-reverse";
  const images = h3Mode === "image_video"
    ? [{ label: "首帧", role: "first_frame", slotType: "first_frame", dataUrl: "data:image/png;base64,QUJD" }]
    : [
      { label: "首帧", role: "first_frame", slotType: "first_frame", dataUrl: "data:image/png;base64,QUJD" },
      { label: "尾帧", role: "last_frame", slotType: "last_frame", dataUrl: "data:image/png;base64,REVG" }
    ];
  const state = {
    loading: false,
    context: {
      surface: "animation",
      button: {},
      promptTarget: {},
      miniMaxH3: {
        modelId: "minimax_h3_local",
        mode: h3Mode,
        durationSeconds: 5,
        resources: []
      }
    },
    mode: "reverse",
    engine,
    artTask: "create",
    images: [],
    imagesLoading: false,
    miniMaxH3ReverseError: "",
    referenceRoles: [],
    targetIndex: 0,
    message: "",
    messageTone: ""
  };
  const calls = { grok: [], local: [], optimize: 0, prepare: 0, validate: 0, fallback: 0, writes: [], closes: 0 };
  const response = responseOverride || {
    ok: true,
    prompt: "structured H3 reverse output grounded in validated picture facts",
    visualSchema: "nf.h3.visual.v1",
    has_negative_prompt: false
  };
  const context = vm.createContext({
    state,
    MINIMAX_H3_PROMPT_PURPOSE: "minimax-h3-prompt-enhance",
    window: {
      electronAPI: {
        async smartAiImageReverse(payload) { calls.grok.push(payload); return response; },
        async promptAssistantReverseImagePrompt(payload) { calls.local.push(payload); return response; },
        async smartAiPromptOptimize() { calls.optimize += 1; return refinementResponse || response; },
        async promptAssistantOptimizePrompt() { calls.optimize += 1; return refinementResponse || response; }
      }
    },
    ART_REFERENCE_PLAN: null,
    getPromptTextareasFromContext: () => ({ positive, negative }),
    isPromptTextControl: (value) => Boolean(value),
    buildSmartAiRequirements: () => "保持人物身份",
    validateArtDesignState: () => "",
    readSessionToken: () => "session-token",
    renderDialog: () => {},
    miniMaxH3ReverseCapability: () => ({ supportsReverse: true }),
    prepareMiniMaxH3PromptRequest: () => { throw new Error("reverse must not use optimize preparation"); },
    prepareMiniMaxH3ReverseRequest: () => {
      calls.prepare += 1;
      return {
        request: {
          purpose,
          surface: "animation",
          scenario: h3Mode === "image_video" ? "single_reference" : "video_frames",
          sourceCount: images.length,
          supportsNegativePrompt: false,
          negativePrompt: "",
          visualSchema: "nf.h3.visual.v1",
          contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
          prompt: "compiled H3 reverse request",
          currentPrompt: "compiled H3 reverse request",
          requirements: "H3 reverse contract",
          images
        },
        context: {},
        workflow: { prepareRefinement: () => refinement }
      };
    },
    validateMiniMaxH3PromptResult: () => { throw new Error("reverse must not use optimize validation"); },
    validateMiniMaxH3ReverseResult: async () => {
      calls.validate += 1;
      if (validationFailure) throw new Error(validationFailure);
      return "validated visual-fact H3 reverse prompt";
    },
    miniMaxH3FailureAllowsGuaranteedFallback: failureAllowsFallback,
    readSmartAiFailureEnvelope: (result) => ({
      errorCode: String(result?.errorCode || ""),
      message: String(result?.message || result?.error || ""),
      requestedVisualSchema: "nf.h3.visual.v1"
    }),
    smartAiAnalysisFailureStatusMessage: (failure) => `分析失败—未写入：${failure.message || failure.errorCode}`,
    protectSmartAiResourceMentions: (text) => ({ text, originalText: text, tokens: [] }),
    buildStaticArtReverseRequirements: () => "",
    buildReverseImagesPayload: () => { throw new Error("H3 reverse must not use generic image payloads"); },
    buildRoleReferenceImagesPayload: () => ({ images: [] }),
    readSmartAiResult: (result) => ({
      prompt: result.prompt,
      negativePrompt: "",
      hasNegativePrompt: false,
      visualSchema: result.visualSchema || ""
    }),
    restoreSmartAiResourceMentions: (text) => ({ ok: true, text }),
    smartAiResourceMentionError: (message) => new Error(message),
    preserveSmartAiReverseResourceMentions: () => { throw new Error("H3 reverse must use workflow restoration"); },
    artHighQualityCgNegativeGuardInstruction: () => "",
    mergeSmartAiNegativePrompt: (base) => base,
    setPromptTextareasValue: (_textareas, prompt, options) => calls.writes.push({ prompt, options }),
    compileArtReferencePlan: async () => ({ version: "test", results: [], capabilities: {} }),
    smartAiReferenceFingerprint: () => "fingerprint",
    buildSmartAiRequestFingerprint: () => "h3-reverse-fingerprint",
    miniMaxH3ContentPolicy: () => ({ sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }),
    miniMaxH3SensitiveRequestHasExplicitMinorTerms: () => false,
    showLocalStaticReverseWarning: () => {},
    closeDialog: () => { calls.closes += 1; },
    smartAiFailureMessage: (error) => String(error?.message || error)
  });
  return { state, calls, images, purpose, positive, run: vm.runInContext(`(${runSmartAiSource})`, context) };
}

async function verifySubmitRouting() {
  await refreshH3Promise;
  assert.equal(refreshCalls.strict, 1, "H3 assistant must hydrate through the strict reverse workflow path");
  assert.equal(refreshCalls.generic, 0, "H3 assistant must never scan generic animation image DOM");

  const reversePrepared = await prepareReverseRequest("人物从首帧走向尾帧", "保持身份");
  assert.equal(reverseHydrateCalls.length, 1, "H3 reverse submit preparation must hydrate the latest live resources");
  assert.equal(reverseHydrateCalls[0].resources[0].previewUrl, "blob:first-frame");
  assert.equal(reversePrepareCalls.length, 1);
  assert.equal(reversePrepareCalls[0].mode, "first_last");
  assert.equal(reversePrepareCalls[0].resources[0].dataUrl, "data:image/png;base64,RklSU1Q=");
  assert.equal(reversePrepareCalls[0].resources[1].dataUrl, "data:image/png;base64,TEFTVA==");
  assert.equal(reversePrepareState.context.miniMaxH3.resources[0].dataUrl, "data:image/png;base64,RklSU1Q=",
    "H3 reverse preparation must not overwrite hydrated state with a preview-only live snapshot");
  assert.equal(reversePrepared.request.purpose, "minimax-h3-fl2v-reverse");

  for (const engine of ["grok", "local"]) {
    const harness = createSubmitHarness(engine);
    await harness.run();
    const payloads = engine === "grok" ? harness.calls.grok : harness.calls.local;
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].purpose, "minimax-h3-prompt-enhance");
    assert.equal(payloads[0].surface, "animation");
    assert.equal(payloads[0].supportsNegativePrompt, false);
    assert.equal(payloads[0].negativePrompt, "");
    assert.equal(payloads[0].prompt, "compiled H3 request");
    assert.equal(payloads[0].h3Mode, "first_last");
    assert.equal(payloads[0].durationSeconds, 4);
    assert.equal(payloads[0].visualSchema, "nf.h3.visual.v1");
    assert.equal(Object.hasOwn(payloads[0], "promptSchema"), false,
      "H3 prompt enhancement must stay outside the ordinary Art structured schema");
    assert.match(payloads[0].requirements, /H3 protocol/);
    assert.equal(harness.calls.prepare, 1);
    assert.equal(harness.calls.validate, 1);
    assert.equal(harness.calls.protect, 0, "H3 must not use the generic exact-once mention protection");
    assert.equal(harness.calls.writes.length, 1);
    assert.equal(harness.calls.writes[0].prompt, "@参考图1 validated H3 prompt");
    assert.equal(harness.calls.writes[0].options.supportsNegativePrompt, false);
    assert.equal(harness.calls.writes[0].options.negativePrompt, "");
    assert.equal(harness.calls.writes[0].options.hasNegativePrompt, false);
    assert.equal(harness.calls.closes, 1);
  }

  const rejected = createSubmitHarness("local", "H3 mode changed while enhancing");
  await rejected.run();
  assert.equal(rejected.calls.writes.length, 0, "failed H3 validation must never overwrite the prompt");
  assert.equal(rejected.calls.closes, 0);
  assert.equal(rejected.state.message, "H3 mode changed while enhancing");

  for (const h3Mode of ["image_video", "first_last"]) {
    for (const engine of ["grok", "local"]) {
      const harness = createReverseSubmitHarness(engine, h3Mode);
      await harness.run();
      const payloads = engine === "grok" ? harness.calls.grok : harness.calls.local;
      assert.equal(payloads.length, 1, `${h3Mode}/${engine} must issue exactly one reverse request`);
      assert.equal(harness.calls.optimize, 0, "H3 reverse without supplementary requirements needs no refinement request");
      assert.equal(payloads[0].purpose, harness.purpose);
      assert.equal(payloads[0].surface, "animation");
      assert.equal(payloads[0].supportsNegativePrompt, false);
      assert.equal(payloads[0].negativePrompt, "");
      assert.equal(payloads[0].visualSchema, "nf.h3.visual.v1");
      assert.equal(Object.hasOwn(payloads[0], "promptSchema"), false,
        "H3 reverse must stay outside the ordinary Art structured schema");
      assert.deepEqual({ ...payloads[0].contentPolicy }, {
        sensitiveVisualAnalysis: true,
        allSubjectsConfirmedAdult: false
      });
      assert.deepEqual(Array.from(payloads[0].images, (image) => image.role), Array.from(harness.images, (image) => image.role));
      assert.equal(harness.calls.prepare, 1);
      assert.equal(harness.calls.validate, 1);
      assert.equal(harness.calls.writes.length, 1);
      assert.equal(harness.calls.writes[0].prompt, "validated visual-fact H3 reverse prompt");
      assert.equal(harness.calls.writes[0].options.supportsNegativePrompt, false);
      assert.equal(harness.calls.closes, 1);
    }
  }

  for (const engine of ["local", "grok"]) {
    const refined = createReverseSubmitHarness(engine, "image_video", "", null, { prompt: "validated picture facts", requirements: "镜头缓慢拉近" });
    await refined.run();
    assert.equal(refined.calls.optimize, 1, "supplementary requirements must trigger semantic refinement");
    assert.equal(refined.calls.validate, 2, "check freshness and format again after refinement");
    assert.equal(refined.calls.writes.length, 1, "only the completed result may be written");
    const failed = createReverseSubmitHarness(engine, "image_video", "", null, { prompt: "validated facts" }, { ok: false, error: "refinement failed" });
    await failed.run();
    assert.equal(failed.calls.optimize, 1);
    assert.equal(failed.calls.writes.length, 0, "refinement failure must preserve the original prompt");
    assert.equal(failed.calls.closes, 0);
    assert.equal(failed.state.loading, false);
  }

  const staleReverse = createReverseSubmitHarness(
    "local",
    "first_last",
    "H3 reverse resources changed"
  );
  await staleReverse.run();
  assert.equal(staleReverse.calls.local.length, 1, "stale rejection happens after the single explicit reverse request");
  assert.equal(staleReverse.calls.fallback, 0, "stale validation must be rejected before fallback construction");
  assert.equal(staleReverse.calls.writes.length, 0, "stale H3 reverse output must never overwrite the prompt");
  assert.equal(staleReverse.calls.closes, 0);
  assert.equal(staleReverse.state.message, "H3 reverse resources changed");

  const invalidContract = createReverseSubmitHarness(
    "local",
    "first_last",
    "MiniMax H3 fields must appear exactly in protocol order"
  );
  await invalidContract.run();
  assert.equal(invalidContract.calls.local.length, 1);
  assert.equal(invalidContract.calls.fallback, 0, "contract-invalid output must not build a generic fallback");
  assert.equal(invalidContract.calls.writes.length, 0);
  assert.equal(invalidContract.positive.value, "人物向镜头转身");
  assert.equal(invalidContract.state.messageTone, "error");
  assert.match(invalidContract.state.message, /分析失败—未写入：MiniMax H3 fields must appear exactly in protocol order/);

  const missingReference = createReverseSubmitHarness("local", "image_video");
  missingReference.state.miniMaxH3ReverseError = "首帧尚未添加可用参考图";
  await missingReference.run();
  assert.equal(missingReference.calls.local.length, 0, "missing strict H3 slots must block the reverse bridge");
  assert.equal(missingReference.calls.prepare, 0);
  assert.equal(missingReference.calls.writes.length, 0);
  assert.equal(missingReference.state.message, "首帧尚未添加可用参考图");

  for (const engine of ["local", "grok"]) {
    const timedOut = createReverseSubmitHarness(engine, "image_video", "", {
      ok: false,
      error: `${engine} H3 bridge timeout`,
      errorCode: "h3-bridge-timeout",
      failureCategory: "timeout"
    });
    await timedOut.run();
    assert.equal(timedOut.calls.local.length + timedOut.calls.grok.length, 1,
      `${engine} timeout must retain exactly one explicit bridge request`);
    assert.equal(timedOut.calls[engine].length, 1, `${engine} timeout must not switch providers`);
    assert.equal(timedOut.calls.optimize, 0, "failure handling must not call prompt optimization");
    assert.equal(timedOut.calls.fallback, 0, "timeout must not build an image-independent fallback");
    assert.equal(timedOut.calls.writes.length, 0, "stage-one failure must never overwrite the prompt");
    assert.equal(timedOut.positive.value, "人物向镜头转身");
    assert.equal(timedOut.calls.closes, 0, "failure must keep the dialog open for re-analysis");
    assert.equal(timedOut.state.messageTone, "error");
    assert.equal(timedOut.state.analysisFailure.requestedVisualSchema, "nf.h3.visual.v1");
    assert.equal(timedOut.state.analysisFailure.retryAttempted, false);
    assert.equal(timedOut.state.analysisFailure.retryCount, 0);
    assert.match(timedOut.state.message, new RegExp(`分析失败—未写入：${engine} H3 bridge timeout`));
  }

  for (const engine of ["local", "grok"]) {
    const stageOneFailed = createReverseSubmitHarness(engine, "image_video", "", {
      ok: false,
      error: `${engine} H3 stage-one visual facts failed`,
      errorCode: "h3-visual-ir-failed",
      failureCategory: "provider",
      requestedVisualSchema: "nf.h3.visual.v1"
    });
    await stageOneFailed.run();
    assert.equal(stageOneFailed.calls[engine].length, 1);
    assert.equal(stageOneFailed.calls.fallback, 0);
    assert.equal(stageOneFailed.calls.writes.length, 0,
      `${engine} stage-one fact failure must preserve the original prompt`);
    assert.equal(stageOneFailed.positive.value, "人物向镜头转身");
    assert.equal(stageOneFailed.state.messageTone, "error");
    assert.match(stageOneFailed.state.message, new RegExp(`分析失败—未写入：${engine} H3 stage-one visual facts failed`));
  }

  const deterministicValidationFailed = createReverseSubmitHarness("local", "image_video", "", {
    ok: false,
    error: "local H3 deterministic validation failed",
    errorCode: "h3-local-deterministic-validation-failed",
    failureCategory: "h3_contract_alignment",
    failureClass: "audio-fidelity",
    generationGate: "blocked",
    requestedVisualSchema: "nf.h3.visual.v1",
    retryable: false,
    legacyFallbackSuppressed: true
  });
  await deterministicValidationFailed.run();
  assert.equal(deterministicValidationFailed.calls.local.length, 1,
    "deterministic validation failure must retain exactly one local request");
  assert.equal(deterministicValidationFailed.calls.grok.length, 0,
    "deterministic validation failure must not switch to Grok");
  assert.equal(deterministicValidationFailed.calls.fallback, 0,
    "deterministic validation failure must not route to a generic H3 fallback");
  assert.equal(deterministicValidationFailed.calls.writes.length, 0,
    "deterministic validation failure must preserve the original prompt");
  assert.equal(deterministicValidationFailed.positive.value, "人物向镜头转身");
  assert.equal(deterministicValidationFailed.state.messageTone, "error");
  assert.match(deterministicValidationFailed.state.message, /分析失败—未写入：local H3 deterministic validation failed/);

  const invalid = createReverseSubmitHarness("local", "first_last", "", {
    ok: true,
    prompt: "",
    has_negative_prompt: false
  });
  await invalid.run();
  assert.equal(invalid.calls.local.length, 1, "invalid response must not be retried through the bridge");
  assert.equal(invalid.calls.grok.length, 0, "invalid local response must not switch to Grok");
  assert.equal(invalid.calls.fallback, 0);
  assert.equal(invalid.calls.writes.length, 0);
  assert.equal(invalid.positive.value, "人物向镜头转身");
  assert.match(invalid.state.message, /分析失败—未写入：MiniMax H3 反推返回了不兼容的视觉合同/);

  for (const engine of ["local", "grok"]) {
    for (const visualSchema of [undefined, "nf.visual.v2"]) {
      const incompatibleSchema = createReverseSubmitHarness(engine, "image_video", "", {
        ok: true,
        prompt: "structured H3 reverse output grounded in validated picture facts",
        ...(visualSchema ? { visualSchema } : {}),
        has_negative_prompt: false
      });
      await incompatibleSchema.run();
      assert.equal(incompatibleSchema.calls[engine].length, 1);
      assert.equal(incompatibleSchema.calls.validate, 0,
        `${engine} incompatible H3 schema must fail before protocol restoration`);
      assert.equal(incompatibleSchema.calls.writes.length, 0,
        `${engine} incompatible H3 schema must never overwrite the prompt`);
      assert.equal(incompatibleSchema.positive.value, "人物向镜头转身");
      assert.equal(incompatibleSchema.state.messageTone, "error");
    }
  }

  const policyBlocked = createReverseSubmitHarness("local", "image_video", "", {
    ok: false,
    error: "explicit minor evidence blocked",
    errorCode: "h3-sensitive-minor-evidence-blocked",
    failureCategory: "content_policy"
  });
  await policyBlocked.run();
  assert.equal(policyBlocked.calls.local.length, 1);
  assert.equal(policyBlocked.calls.fallback, 0, "explicit minor safety blocks must never be bypassed by fallback");
  assert.equal(policyBlocked.calls.writes.length, 0);

  const nestedPolicyBlocked = createReverseSubmitHarness("grok", "image_video", "", {
    ok: false,
    data: {
      errorCode: "provider_content_policy",
      failureCategory: "provider_content_policy"
    }
  });
  await nestedPolicyBlocked.run();
  assert.equal(nestedPolicyBlocked.calls.grok.length, 1);
  assert.equal(nestedPolicyBlocked.calls.fallback, 0, "nested canonical policy envelopes must never enter fallback");
  assert.equal(nestedPolicyBlocked.calls.writes.length, 0);

  const businessRejected = createReverseSubmitHarness("local", "image_video", "", {
    ok: false,
    error: "request rejected by a business rule",
    failureCategory: "business_rule"
  });
  await businessRejected.run();
  assert.equal(businessRejected.calls.local.length, 1);
  assert.equal(businessRejected.calls.fallback, 0, "non-technical bridge responses must not enter fallback");
  assert.equal(businessRejected.calls.writes.length, 0);
}

verifySubmitRouting().then(() => {
  console.log("ai-sequence-minimax-h3-smart-ai-contract: passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
