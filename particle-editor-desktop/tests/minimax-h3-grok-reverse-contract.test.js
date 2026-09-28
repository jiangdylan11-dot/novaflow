const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const source = fs.readFileSync(
  path.join(root, "particle-editor-desktop", "admin-server", "server.js"),
  "utf8",
);
const mainSource = fs.readFileSync(path.join(root, "particle-editor-desktop", "main.js"), "utf8");
const previewSource = fs.readFileSync(path.join(root, "tools", "preview_runtime_server.py"), "utf8");
const edgeSource = fs.readFileSync(
  path.join(root, "supabase", "functions", "novaflow-backend", "smart-ai-grok.workflow.mjs"),
  "utf8",
);
const edgeHandlerSource = fs.readFileSync(
  path.join(root, "supabase", "functions", "novaflow-backend", "index.ts"),
  "utf8",
);
const promptWorkflowPath = path.join(root, "novaflow-web", "renderer", "ai-sequence-minimax-h3-prompt.workflow.js");
const reverseWorkflowPath = path.join(root, "novaflow-web", "renderer", "ai-sequence-minimax-h3-reverse.workflow.js");

assert.match(source, /const SERVER_BUILD_ID = crypto\.createHash\("sha256"\)\.update\(fs\.readFileSync\(__filename\)\)\.digest\("hex"\);/);
assert.match(source, /pathName === "\/health"[\s\S]*?buildId: SERVER_BUILD_ID,[\s\S]*?pid: process\.pid/);

for (const functionName of [
  "miniMaxH3ValidateVisualIrPolicy",
  "miniMaxH3ValidateCompiledPromptAgainstIr",
  "miniMaxH3ValidateRawUserContent",
  "miniMaxH3SensitiveMatchIsNegated",
  "miniMaxH3ValidateOrdinaryFactCoverage",
  "miniMaxH3HasExplicitYouthIndicator",
  "miniMaxH3AgeEvidenceIsUnverifiableOnly",
  "miniMaxH3VisualIrHasExplicitYouthEvidence",
]) {
  assert.equal(
    Array.from(source.matchAll(new RegExp(`function ${functionName}\\(`, "g"))).length,
    1,
    `${functionName} must have exactly one effective definition`,
  );
}

function loadWorkflowModule(workflowSource, filename, dependency = null) {
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    require(request) {
      if (request === "./ai-sequence-minimax-h3-prompt.workflow.js" && dependency) return dependency;
      throw new Error(`Unexpected workflow dependency: ${request}`);
    },
  };
  context.NovaFlowH3PromptFormat = require('../admin-server/h3-prompt-enhance.js');
  context.globalThis = context;
  vm.runInNewContext(workflowSource, context, { filename });
  return context.module.exports;
}

const promptWorkflow = loadWorkflowModule(fs.readFileSync(promptWorkflowPath, "utf8"), promptWorkflowPath);
const reverseWorkflow = loadWorkflowModule(
  fs.readFileSync(reverseWorkflowPath, "utf8"),
  reverseWorkflowPath,
  promptWorkflow,
);

function extractNamedFunction(text, name) {
  const marker = `function ${name}(`;
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `${name} must exist`);
  const bodyStart = text.indexOf("{", start);
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
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error(`${name} body is incomplete`);
}

function extractNamedFunctionBlock(text, name) {
  const marker = `function ${name}(`;
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `${name} must exist`);
  const next = text.indexOf("\nfunction ", start + marker.length);
  return text.slice(start, next < 0 ? text.length : next).trim();
}

function extractNamedConstant(text, name) {
  const marker = "const " + name + " = ";
  const start = text.indexOf(marker);
  assert.ok(start >= 0, name + " must exist");
  const valueStart = start + marker.length;
  const terminator = /;\r?\n/.exec(text.slice(valueStart));
  const end = terminator ? valueStart + terminator.index : -1;
  assert.ok(end > valueStart, name + " initializer must be complete");
  return text.slice(valueStart, end);
}

const sensitiveContext = {
  GROK_VISUAL_IR_SAFE_SENSITIVE_PATTERN: vm.runInNewContext(
    extractNamedConstant(source, "GROK_VISUAL_IR_SAFE_SENSITIVE_PATTERN"),
  ),
  MINIMAX_H3_EXPLICIT_YOUTH_PATTERN: vm.runInNewContext(
    extractNamedConstant(source, "MINIMAX_H3_EXPLICIT_YOUTH_PATTERN"),
  ),
  MINIMAX_H3_BENIGN_EXPOSURE_PATTERN: vm.runInNewContext(
    extractNamedConstant(source, "MINIMAX_H3_BENIGN_EXPOSURE_PATTERN"),
  ),
  miniMaxH3ContractError: (code, message, statusCode = 502, failureCategory = code) => Object.assign(new Error(message), {
    statusCode,
    errorCode: code,
    failureCategory,
    minimaxH3ContractInvalid: code.startsWith("h3_contract_"),
    minimaxH3SafeError: true,
  }),
  Error,
};
sensitiveContext.miniMaxH3SafetyText = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3SafetyText")})`,
  sensitiveContext,
);
sensitiveContext.miniMaxH3HasExplicitYouthIndicator = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3HasExplicitYouthIndicator")})`,
  sensitiveContext,
);
sensitiveContext.miniMaxH3VisualIrTextValues = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3VisualIrTextValues")})`,
  sensitiveContext,
);
sensitiveContext.miniMaxH3AgeEvidenceIsUnverifiableOnly = vm.runInNewContext(
  `(${extractNamedFunctionBlock(source, "miniMaxH3AgeEvidenceIsUnverifiableOnly")})`,
  sensitiveContext,
);
sensitiveContext.miniMaxH3VisualIrHasExplicitYouthEvidence = vm.runInNewContext(
  `(${extractNamedFunctionBlock(source, "miniMaxH3VisualIrHasExplicitYouthEvidence")})`,
  sensitiveContext,
);
assert.equal(sensitiveContext.miniMaxH3VisualIrHasExplicitYouthEvidence({
  subjects: [{
    age_assessment: "age_unverifiable",
    age_evidence: ["visible details do not establish whether the person is an adult or minor"],
    visible_facts: ["person wearing a blue coat"],
  }],
}), false);
for (const uncertainAgeEvidence of [
  "minor status cannot be verified from the image",
  "the person could be a teen or an adult",
  "未成年状态不可核验",
]) {
  assert.equal(sensitiveContext.miniMaxH3VisualIrHasExplicitYouthEvidence({
    subjects: [{
      age_assessment: "age_unverifiable",
      age_evidence: [uncertainAgeEvidence],
      visible_facts: ["person wearing a blue coat"],
    }],
  }), false, `uncertainty alone must not become explicit youth evidence: ${uncertainAgeEvidence}`);
}
assert.equal(sensitiveContext.miniMaxH3VisualIrHasExplicitYouthEvidence({
  subjects: [{
    age_assessment: "age_unverifiable",
    age_evidence: ["visible teen appearance, although exact age cannot be determined"],
    visible_facts: ["person wearing a blue coat"],
  }],
}), false);
assert.equal(sensitiveContext.miniMaxH3VisualIrHasExplicitYouthEvidence({
  subjects: [{
    age_assessment: "age_unverifiable",
    age_evidence: ["age cannot be established"],
    visible_facts: ["girl wearing a blue coat"],
  }],
}), false);
assert.equal(sensitiveContext.miniMaxH3VisualIrHasExplicitYouthEvidence({
  subjects: [{
    age_assessment: "young_looking",
    age_evidence: ["youthful appearance"],
    visible_facts: ["young-looking person wearing a blue coat"],
  }],
}), false);
assert.equal(sensitiveContext.miniMaxH3VisualIrHasExplicitYouthEvidence({
  subjects: [{
    age_assessment: "minor",
    age_evidence: ["explicitly identified as underage"],
    visible_facts: ["person wearing a blue coat"],
  }],
}), true);
assert.equal(sensitiveContext.miniMaxH3VisualIrHasExplicitYouthEvidence({
  subjects: [],
  uncertain: ["the subject could be a minor"],
}), false);
for (const uncertainVisibleFact of [
  "the person could be a minor or an adult",
  "无法确认该人物是否未成年",
]) {
  assert.equal(sensitiveContext.miniMaxH3VisualIrHasExplicitYouthEvidence({
    subjects: [{
      age_assessment: "age_unverifiable",
      age_evidence: ["age cannot be established"],
      visible_facts: [uncertainVisibleFact],
    }],
  }), false, `uncertain visible wording must not become explicit-minor evidence: ${uncertainVisibleFact}`);
}
assert.equal(sensitiveContext.miniMaxH3VisualIrHasExplicitYouthEvidence({
  subjects: [{
    age_assessment: "adult",
    age_evidence: ["documented adult"],
    visible_facts: ["child wearing a blue coat"],
  }],
}), true);
sensitiveContext.miniMaxH3SensitiveMatchIsNegated = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3SensitiveMatchIsNegated")})`,
  sensitiveContext,
);
sensitiveContext.miniMaxH3PatternHasAffirmativeMatch = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3PatternHasAffirmativeMatch")})`,
  sensitiveContext,
);
sensitiveContext.miniMaxH3SensitiveCategories = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3SensitiveCategories")})`,
  sensitiveContext,
);
const validateRawUserContent = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3ValidateRawUserContent")})`,
  sensitiveContext,
);
const explicitMinorIndicators = [
  "underage", "minor", "child", "children", "juvenile", "loli", "shota",
  "under-18", "17 years old", "7 y/o", "aged 16",
  "未成年", "未满18岁", "17岁", "儿童", "孩童", "小孩", "幼女", "幼童",
  "幼儿", "婴幼儿", "婴儿", "萝莉", "正太",
];
for (const indicator of explicitMinorIndicators) {
  assert.equal(
    sensitiveContext.MINIMAX_H3_EXPLICIT_YOUTH_PATTERN.test(indicator),
    true,
    `Desktop explicit-minor pattern must recognize ${indicator}`,
  );
  const safeState = validateRawUserContent(
    `${indicator} waves safely`,
    "",
    { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
  );
  assert.equal(safeState.hasExplicitYouth, true);
  assert.equal(safeState.hasSensitiveRequest, false);
  assert.throws(
    () => validateRawUserContent(
      "",
      `${indicator} fully nude`,
      { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: true },
    ),
    (error) => error?.failureCategory === "provider_content_policy",
    `Desktop sensitive raw explicit-minor indicator must block: ${indicator}`,
  );
}
const ambiguousAgeIndicators = [
  "teen", "teenage", "teenager", "adolescent", "girl", "boy", "young", "youth",
  "young-looking", "child-like", "少女", "少年", "女孩", "男孩", "年轻", "青少年",
  "幼态", "娃娃脸",
];
for (const indicator of ambiguousAgeIndicators) {
  assert.equal(
    sensitiveContext.MINIMAX_H3_EXPLICIT_YOUTH_PATTERN.test(indicator),
    false,
    `Desktop ambiguous age pattern must not become explicit-minor evidence: ${indicator}`,
  );
  const state = validateRawUserContent(
    "",
    `${indicator} fully nude`,
    { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
  );
  assert.equal(state.hasExplicitYouth, false, `ambiguous wording must not trigger the age gate: ${indicator}`);
  assert.equal(state.hasSensitiveRequest, true);
}
for (const eligiblePhrase of [
  "young adult fully nude",
  "young adult girl fully nude",
  "young-looking adult fully nude",
  "年轻成年人少女全裸",
]) {
  const state = validateRawUserContent(
    "",
    eligiblePhrase,
    { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: true },
  );
  assert.equal(state.hasExplicitYouth, false, `ambiguous age wording must remain eligible: ${eligiblePhrase}`);
  assert.equal(state.hasSensitiveRequest, true);
}

const protocolRules = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3PromptProtocolRules")})`,
)();
const keyframeProtocolRules = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3PromptProtocolRules")})`,
)("image_video", { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false });
const h3FailureEnvelope = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3FailureEnvelope")})`,
  {
    h3PromptEnhance: require('../admin-server/h3-prompt-enhance.js'),
    MINIMAX_H3_VISUAL_SCHEMA: "nf.h3.visual.v1",
    normalizeSmartAiText: (value, limit) => String(value || "").trim().slice(0, limit),
    miniMaxH3ValidationLeaf: (value, fallback) => /^[a-z0-9_]{3,80}$/.test(String(value || "").trim().toLowerCase())
      ? String(value || "").trim().toLowerCase()
      : fallback,
  },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(h3FailureEnvelope({
    errorCode: "provider_content_policy",
    message: "provider body must not escape",
  }))),
  {
    errorCode: "provider_content_policy",
    message: "Grok 未通过 H3 未成年人敏感内容安全校验",
    retryable: false,
    retryAttempted: false,
    retryCount: 0,
    reverseProvider: "grok",
    providerFailureCode: "provider_content_policy",
    legacyFallbackSuppressed: true,
    requestedVisualSchema: "nf.h3.visual.v1",
    failureCategory: "provider_content_policy",
    failureStage: "safety_policy",
    failureReason: "explicit_minor_sensitive",
    validationLeaf: "explicit_minor_sensitive",
  },
);
assert.doesNotMatch(protocolRules, /Write field values in English/);
assert.match(protocolRules, /exact English field names followed by colons/);
assert.match(protocolRules, /field-value language[\s\S]*?natural-language creative text and requirements/);
assert.match(protocolRules, /contains Chinese[\s\S]*?Simplified Chinese/);
assert.match(protocolRules, /dialogue, lyrics, and visible scene text[\s\S]*?original language/);
assert.match(protocolRules, /integrated_multimodal_description[\s\S]*?overall_soundscape[\s\S]*?non_diegetic_music/);
assert.match(protocolRules, /\[Shot 1\][\s\S]*?\[Shot N\] At MM:SS\.mmm/);
assert.match(protocolRules, /<Subject N>[\s\S]*?<Picture N>[\s\S]*?<Video N>[\s\S]*?<Audio N>/);
assert.match(keyframeProtocolRules, /validated visual IR[\s\S]*?young_looking[\s\S]*?age_unverifiable[\s\S]*?uncertain candidate wording alone as minor evidence/);
assert.doesNotMatch(keyframeProtocolRules, /adult confirmation|sensitive_analysis_not_enabled/i);

const context = {
  MINIMAX_H3_I2V_REVERSE_PURPOSE: "minimax-h3-i2v-reverse",
  MINIMAX_H3_FL2V_REVERSE_PURPOSE: "minimax-h3-fl2v-reverse",
  MINIMAX_H3_PROMPT_MAX_OUTPUT_TOKENS: 4096,
  smartAiPayloadPurpose: (payload) => String(payload?.purpose || "").toLowerCase().replace(/_/g, "-"),
  normalizeGrokSmartAiImages: (payload) => (payload.images || []).map((item, index) => ({
    index,
    imageUrl: item.dataUrl,
    label: item.label || `Picture ${index + 1}`,
    role: item.role || item.slotType || "reference",
    slotType: item.slotType || item.role || "reference",
  })),
  smartAiCurrentPrompt: (payload) => String(payload.currentPrompt || payload.prompt || "").trim(),
  normalizeSmartAiText: (value, limit = 20000) => String(value || "").trim().slice(0, limit),
  smartAiImageInput: (image) => ({ type: "input_image", image_url: image.imageUrl }),
  smartAiInputText: (text) => ({ type: "input_text", text }),
  GROK_VISUAL_IR_SCHEMA_V2: "nf.visual.v2",
  GROK_VISUAL_IR_V2_TEXT_FORMAT: { format: { type: "json_schema" } },
  grokVisualIrOutputRules: () => "STRICT nf.visual.v2 fact schema",
  buildMiniMaxH3InteractionRichPromptBody: (body, language) => {
    const rich = JSON.parse(JSON.stringify(body));
    delete rich.text;
    rich.max_output_tokens = 3072;
    rich.input[0].content = [
      ...rich.input[0].content.filter((item) => item.type === "input_image"),
      { type: "input_text", text: `Observe <Picture 1>. MiniMax H3 互动事实确认补充约束 five sections; descriptive fact values in ${language === "en" ? "English" : "Simplified Chinese"}` },
    ];
    return rich;
  },
  miniMaxH3VisualIrOutputRules: vm.runInNewContext(
    `(${extractNamedFunction(source, "miniMaxH3VisualIrOutputRules")})`,
    {
      MINIMAX_H3_VISUAL_SCHEMA: "nf.h3.visual.v1",
      MINIMAX_H3_VISUAL_IR_TOP_LEVEL_KEYS: ["schema", "mode"],
      MINIMAX_H3_VISUAL_IR_SUBJECT_KEYS: ["id", "age_assessment"],
      MINIMAX_H3_VISUAL_IR_FRAME_KEYS: ["picture", "subject_ids"],
      MINIMAX_H3_VISUAL_IR_MOTION_KEYS: ["action_start", "action_process", "action_result", "camera_behavior"],
      MINIMAX_H3_VISUAL_IR_AUDIO_KEYS: ["diegetic_sound", "ambience", "non_diegetic_music"],
    },
  ),
  miniMaxH3EnhanceMode: () => "text_video",
  miniMaxH3ContentContract: (payload) => ({
    visualSchema: payload.visualSchema,
    contentPolicy: payload.contentPolicy || {
      sensitiveVisualAnalysis: false,
      allSubjectsConfirmedAdult: false,
    },
  }),
  miniMaxH3ValidateRawUserContent: validateRawUserContent,
  miniMaxH3SafetyText: (value) => String(value || "").normalize("NFKC").toLowerCase(),
  GROK_VISUAL_IR_SAFE_SENSITIVE_PATTERN: /(?:nsfw|nudity|nude)/i,
  miniMaxH3ContractError: (code, message, statusCode = 502, failureCategory = code) => Object.assign(new Error(message), {
    statusCode,
    errorCode: code,
    failureCategory,
    minimaxH3ContractInvalid: code.startsWith("h3_contract_"),
    minimaxH3SafeError: true,
  }),
  miniMaxH3RequestedDuration: (payload) => Number(payload.durationSeconds || 0),
  adminData: { readAdminGrokEnv: () => ({ model: "grok-test" }) },
  Error,
};
context.miniMaxH3ReverseMode = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3ReverseMode")})`,
  context,
);
const build = vm.runInNewContext(
  `(${extractNamedFunction(source, "buildMiniMaxH3GrokReverseRequest")})`,
  context,
);
const preflight = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3ReversePreflightFailure")})`,
  {
    miniMaxH3ReverseMode: context.miniMaxH3ReverseMode,
    miniMaxH3ContractError: context.miniMaxH3ContractError,
    miniMaxH3FailureEnvelope: h3FailureEnvelope,
    Number,
  },
);
const fieldsAreOrdered = vm.runInNewContext(
  `(${extractNamedFunction(source, "miniMaxH3PromptFieldsAreOrdered")})`,
);
const normalizeCloud = vm.runInNewContext(
  `(${extractNamedFunction(source, "normalizeMiniMaxH3PromptOutput")})`,
  {
    normalizeGeneratedPrompt: (value) => String(value || "").trim(),
    parseSmartAiPromptJson: () => null,
    readPromptResultString: () => "",
    miniMaxH3PromptFieldsAreOrdered: fieldsAreOrdered,
    MINIMAX_H3_BASE_PROMPT_FIELDS: [
      "integrated_multimodal_description", "overall_soundscape", "non_diegetic_music",
    ],
    MINIMAX_H3_REFERENCE_PROMPT_FIELDS: [
      "subject_definitions", "summary", "retention_analysis", "detailed_description",
      "overall_soundscape", "non_diegetic_music",
    ],
    MINIMAX_H3_CONTENT_POLICY_BLOCK_MARKER: "H3_CONTENT_POLICY_BLOCKED",
    miniMaxH3ContractError: (code, message) => Object.assign(new Error(message), {
      statusCode: 502,
      errorCode: code,
      minimaxH3ContractInvalid: code.startsWith("h3_contract_")
    }),
    miniMaxH3PromptFieldValue: vm.runInNewContext(
      `(${extractNamedFunction(source, "miniMaxH3PromptFieldValue")})`,
    ),
    miniMaxH3ValidateTimeline: () => {},
    MINIMAX_H3_CAMERA_DIRECTION_PATTERN: vm.runInNewContext(
      extractNamedConstant(source, "MINIMAX_H3_CAMERA_DIRECTION_PATTERN"),
    ),
    MINIMAX_H3_ACTION_PROGRESSION_PATTERN: vm.runInNewContext(
      extractNamedConstant(source, "MINIMAX_H3_ACTION_PROGRESSION_PATTERN"),
    ),
    Error,
  },
);
const normalizedChinese = normalizeCloud(
  "integrated_multimodal_description: [Shot 1] <Picture 1> 是 0.00 秒的精确首帧，骑士在晨光中逐渐举起长剑，镜头缓慢跟拍。\n" +
  "overall_soundscape: 轻微风声与铠甲摩擦声。\n" +
  "non_diegetic_music: 低沉而克制的弦乐。",
);
assert.match(normalizedChinese, /^integrated_multimodal_description: \[Shot 1\] <Picture 1>/);
assert.match(normalizedChinese, /overall_soundscape: 轻微风声/);
assert.match(normalizedChinese, /non_diegetic_music: 低沉而克制的弦乐/);
assert.throws(
  () => normalizeCloud(
    "integrated_multimodal_description: A short description without a timeline.\n" +
    "overall_soundscape: Room tone.\nnon_diegetic_music: N/A",
  ),
  /must contain \[Shot 1\]/,
);
assert.throws(
  () => normalizeCloud("A generic single-paragraph image description without the H3 fields."),
  /exactly 3 required fields in order/,
);

const frame = (role, suffix) => ({
  role,
  slotType: role,
  label: role,
  dataUrl: `data:image/png;base64,${suffix}`,
});

function workflowFirstFrame() {
  return {
    key: "first_frame",
    occupied: true,
    kind: "image",
    identity: "grok-empty-first",
    sourceId: "grok-empty-first",
    dataUrl: "data:image/png;base64,RklSU1Q=",
    fileName: "first_frame.png",
    mimeType: "image/png",
  };
}

const i2v = build({
  userPrompt: "",
  userRequirements: "",
  purpose: "minimax-h3-i2v-reverse",
  currentPrompt: "骑士缓慢举起长剑",
  requirements: "I2VA；时长 5 秒；使用 <Picture 1> 作为 0.00 秒首帧",
  images: [frame("first_frame", "FIRST")],
  visualSchema: "nf.h3.visual.v1",
  contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
});
assert.equal(i2v.body.max_output_tokens, 3072);
assert.equal(i2v.body.temperature, 0.2);
assert.equal(i2v.body.input[0].role, "user");
assert.equal(i2v.body.input[0].content[0].image_url, "data:image/png;base64,FIRST");
assert.equal(i2v.inputMeta.mode, "minimax_h3_i2v_reverse");
assert.equal(i2v.inputMeta.scenario, "single_reference");
assert.equal(i2v.inputMeta.supportsNegativePrompt, false);
assert.equal(i2v.resultOptions.minimaxH3Prompt, true);
assert.equal(i2v.resultOptions.minimaxH3Mode, "image_video");
assert.equal(i2v.resultOptions.requiredProviderCalls, 1);
assert.equal(i2v.resultOptions.h3VisualBodies.length, 1);
assert.equal(i2v.resultOptions.supportsNegativePrompt, false);
assert.match(i2v.body.input[0].content.at(-1).text, /<Picture 1>/);
assert.match(i2v.body.input[0].content.at(-1).text, /互动事实确认补充约束/);
assert.doesNotMatch(i2v.body.input[0].content.at(-1).text, /STRICT nf\.visual\.v2 fact schema/);
assert.match(i2v.body.input[0].content.at(-1).text, /Simplified Chinese/);
assert.doesNotMatch(i2v.body.input[0].content.at(-1).text, /骑士缓慢举起长剑|currentPrompt:|requirements:/);

const localizedI2v = build({
  userPrompt: "",
  userRequirements: "",
  purpose: "minimax-h3-i2v-reverse",
  currentPrompt: "",
  requirements: "I2VA；时长 5 秒；使用中文首帧槽位",
  images: [{ label: "首帧", dataUrl: "data:image/png;base64,Q0hJTkVTRV9GSVJTVA==" }],
  visualSchema: "nf.h3.visual.v1",
  contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
});
assert.equal(localizedI2v.inputMeta.mode, "minimax_h3_i2v_reverse");
assert.equal(localizedI2v.inputMeta.scenario, "single_reference");

for (const userRequirements of [
  "no nudity; keep the blue coat",
  "without sexual activity, preserve the quiet room",
  "不要裸露，保持蓝色外套",
  "禁止性行为；只让角色挥手",
]) {
  const negated = build({
    userPrompt: "",
    userRequirements,
    purpose: "minimax-h3-i2v-reverse",
    currentPrompt: "",
    requirements: "I2VA；时长 5 秒；使用 <Picture 1> 作为 0.00 秒首帧",
    images: [frame("first_frame", "NEGATED")],
    visualSchema: "nf.h3.visual.v1",
    contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
  });
  assert.equal(negated.resultOptions.authorizedSensitiveUserRequest, false);
}
const sensitiveWithoutAdultConfirmation = build({
  userPrompt: "",
  userRequirements: "adult nudity",
  purpose: "minimax-h3-i2v-reverse",
  requirements: "required",
  images: [frame("first_frame", "POSITIVE")],
  visualSchema: "nf.h3.visual.v1",
  contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
});
assert.equal(sensitiveWithoutAdultConfirmation.resultOptions.authorizedSensitiveUserRequest, true);
const positiveSensitive = build({
  userPrompt: "",
  userRequirements: "不要裸露，但是成年人物明确自慰",
  purpose: "minimax-h3-i2v-reverse",
  requirements: "required",
  images: [frame("first_frame", "AFFIRMATIVE")],
  visualSchema: "nf.h3.visual.v1",
  contentPolicy: { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false },
});
assert.equal(positiveSensitive.resultOptions.authorizedSensitiveUserRequest, true);
assert.deepEqual(JSON.parse(JSON.stringify(positiveSensitive.resultOptions.contentPolicy)), {
  sensitiveVisualAnalysis: true,
  allSubjectsConfirmedAdult: false,
});

for (const implementationSource of [source, edgeSource]) {
  assert.match(
    extractNamedFunctionBlock(implementationSource, "miniMaxH3ValidateCompiledPromptAgainstIr"),
    /miniMaxH3SensitiveCategories\([\s\S]*?affirmativeOnly:\s*true[\s\S]*?miniMaxH3ValidateOrdinaryFactCoverage\(prompt, integrated/,
  );
  assert.match(
    extractNamedFunctionBlock(implementationSource, "miniMaxH3ValidateOrdinaryFactCoverage"),
    /identity_[\s\S]*?clothing_[\s\S]*?scene_stadium[\s\S]*?action_[\s\S]*?camera_[\s\S]*?audio_plan[\s\S]*?h3_contract_visual_projection/,
  );
  assert.doesNotMatch(
    extractNamedFunctionBlock(implementationSource, "miniMaxH3ValidateOrdinaryFactCoverage"),
    /agePrefix|subject\.age_assessment|scopeConcepts\.has\(age/,
  );
  assert.doesNotMatch(
    extractNamedFunctionBlock(implementationSource, "miniMaxH3ValidateVisualIrPolicy"),
    /allSubjectsConfirmedAdult|sensitiveVisualAnalysis/,
  );
  assert.doesNotMatch(
    extractNamedFunctionBlock(implementationSource, "miniMaxH3ValidateRawUserContent"),
    /allSubjectsConfirmedAdult|sensitiveVisualAnalysis/,
  );
  const deterministicCompiler = extractNamedFunctionBlock(implementationSource, "compileMiniMaxH3PromptFromVisualFacts");
  assert.match(deterministicCompiler, /return \[[\s\S]*?`integrated_multimodal_description:/);
  assert.doesNotMatch(deterministicCompiler, /return \[\s*anchor|\[anchor,/);
  const reverseExecutor = extractNamedFunctionBlock(implementationSource, "callMiniMaxH3ReverseWithVisualIr");
  assert.match(reverseExecutor, /h3VisualBodies[\s\S]*?frameFacts\.push\(\{ picture: `<Picture \$\{index \+ 1\}>`, ir: trustedVisualFacts \}\)/);
  assert.match(reverseExecutor, /minimaxH3RichVisualStage = true[\s\S]*?runAttempt\(frameBody[\s\S]*?projectMiniMaxH3PrimaryRichFactsToVisualIr/);
  assert.match(reverseExecutor, /miniMaxH3AssertVisualFactsPolicy\(trustedVisualFacts[\s\S]*?h3ContractRepairUsed: false[\s\S]*?h3RetryCount: 0/);
  const reversePrimaryOnly = reverseExecutor.slice(0, reverseExecutor.indexOf("async function callGrokResponseWithVisualRetry"));
  assert.doesNotMatch(reversePrimaryOnly, /recoverableInteraction|buildGrokVisualIrRetryBody/);
  assert.match(reverseExecutor, /h3ValidationLeaf = miniMaxH3ValidationLeaf\([\s\S]*?projectionDiagnostics\.canonicalLeaf[\s\S]*?projectionDiagnostics\.validationLeaf[\s\S]*?rich_projection_unknown/);
  assert.doesNotMatch(
    reverseExecutor,
    /buildGrokVisualIrRetryBody\(\s*frameBody,\s*GROK_VISUAL_IR_SCHEMA_V2,/
  );
  const richProjection = extractNamedFunctionBlock(implementationSource, "projectMiniMaxH3RichFactsToVisualIr");
  assert.match(richProjection, /richFacts\.contact[\s\S]*?richFacts\.action[\s\S]*?sensitive_visible_facts[\s\S]*?parseGrokVisualIr/);
  assert.match(richProjection, /rich_projection_structural_ir_missing[\s\S]*?rich_projection_subject_facts_missing[\s\S]*?rich_projection_ordinary_facts_missing[\s\S]*?rich_projection_entity_missing[\s\S]*?rich_projection_canonical_v2_invalid/);
  assert.match(richProjection, /miniMaxH3RichOrdinaryFacts[\s\S]*?primary\.appearance[\s\S]*?projected\.scene\.spatial_layers[\s\S]*?projected\.look\.lighting[\s\S]*?projected\.camera_cues\.composition/);
  assert.match(richProjection, /richFacts\.contact[\s\S]*?ordinaryFacts\.sensitive[\s\S]*?sensitive_visible_facts/);
  const richOrdinaryFacts = extractNamedFunctionBlock(implementationSource, "miniMaxH3RichOrdinaryFacts");
  assert.match(richOrdinaryFacts, /projectionSafe[\s\S]*?GROK_VISUAL_IR_SAFE_SENSITIVE_PATTERN[\s\S]*?sectionFacts[\s\S]*?sensitive/);
  assert.match(
    extractNamedFunctionBlock(implementationSource, "miniMaxH3SafeFailureReason"),
    /projection-safe fields[\s\S]*?content_safety_projection_boundary/,
  );
  const primaryRichProjection = extractNamedFunctionBlock(implementationSource, "projectMiniMaxH3PrimaryRichFactsToVisualIr");
  assert.match(primaryRichProjection, /sexualInteraction[\s\S]*?explicitAnatomy[\s\S]*?bodyExposure[\s\S]*?age_unverifiable[\s\S]*?projectMiniMaxH3RichFactsToVisualIr/);
  assert.doesNotMatch(primaryRichProjection, /level:\s*"explicit"|interaction_category:\s*"sexual"/);
  const publicResult = extractNamedFunctionBlock(implementationSource, "grokResponsesPublicResult");
  assert.match(publicResult, /minimaxH3RichVisualStage[\s\S]*?miniMaxH3RichVisualValidationLeaf[\s\S]*?richValidationLeaf !== "rich_valid"/);
  assert.doesNotMatch(publicResult.match(/if \(options\.minimaxH3Reverse === true && options\.minimaxH3RichVisualStage === true\)[\s\S]*?\n    }/)[0], /isValidGrokVisualRichPrompt/);
  assert.match(publicResult, /grokVisualRichPromptInvalid[\s\S]*?h3ValidationLeaf = richValidationLeaf/);
  assert.match(publicResult, /diagnostics\.semantic === true[\s\S]*?miniMaxH3SafeFailureReason\("semantic", diagnostics\.reason\)[\s\S]*?h3StructuralVisualFacts[\s\S]*?validateSemantics:\s*false[\s\S]*?h3ValidationLeaf = miniMaxH3StrictIrValidationLeaf\(diagnostics\)/);
  const richRequest = extractNamedFunctionBlock(implementationSource, "buildMiniMaxH3InteractionRichPromptBody");
  assert.match(richRequest, /buildGrokVisualRichPromptBody\(body, false, false\)/);
  assert.match(richRequest, /400 至 500 个中文字符/);
  assert.match(richRequest, /完成\[拍摄参数\]后立即停止/);
  const canonicalizer = extractNamedFunctionBlock(implementationSource, "canonicalizeMiniMaxH3RichVisualSections");
  assert.match(canonicalizer, /\[用户附加要求\]/);
  assert.match(canonicalizer, /MINIMAX_H3_RICH_VISUAL_SECTION_ALIASES/);
}

for (const attemptSource of [source, edgeHandlerSource]) {
  const gateSource = extractNamedFunction(attemptSource, "isGrokResponseAttemptResultUsable")
    .replace(/:\s*AnyRecord/g, "")
    .replace(/\):\s*boolean\s*\{/, ") {");
  const isAttemptResultUsable = vm.runInNewContext(`(${gateSource})`);
  assert.equal(isAttemptResultUsable({ output_text: "ordinary prompt" }, {}), true);
  assert.equal(isAttemptResultUsable({ output_text: "" }, {}), false);
  assert.equal(isAttemptResultUsable({ output_text: "", h3VisualFacts: { schema: "nf.visual.v1" } }, {
    minimaxH3Reverse: true,
  }), false);
  assert.equal(isAttemptResultUsable({ output_text: "", h3VisualFacts: { schema: "nf.visual.v2" } }, {
    minimaxH3Reverse: true,
  }), true);
  assert.equal(isAttemptResultUsable({ output_text: "", h3VisualFacts: { schema: "nf.visual.v2" } }, {
    minimaxH3Reverse: true,
    minimaxH3RichVisualStage: true,
  }), false);
  const attemptBlock = extractNamedFunctionBlock(attemptSource, "callGrokResponseAttempt");
  assert.match(attemptBlock, /isGrokResponseAttemptResultUsable\(result, resultOptions\)/);
}

const ordinaryCoverageCalls = [];
const validateDesktopOrdinaryCoverage = vm.runInNewContext(
  `(${extractNamedFunctionBlock(source, "miniMaxH3ValidateOrdinaryFactCoverage")})`,
  {
    miniMaxH3PictureScope: (integrated) => integrated,
    miniMaxH3SemanticGroupCovered: (_scope, _facts, prefixes) => {
      ordinaryCoverageCalls.push([...prefixes]);
      return true;
    },
    miniMaxH3PromptFieldValue: () => "N/A",
    miniMaxH3NoAudioFact: () => true,
    miniMaxH3FactConcepts: () => new Set(),
    miniMaxH3ContractError: context.miniMaxH3ContractError,
    Map,
    Set,
  },
);
assert.doesNotThrow(() => validateDesktopOrdinaryCoverage(
  "integrated_multimodal_description: [Shot 1] <Picture 1> 白发猫耳少女全裸，乳头清晰可见。",
  "[Shot 1] <Picture 1> 白发猫耳少女全裸，乳头清晰可见。",
  {
    subjects: [{ id: "subject_1", age_assessment: "adult", visible_facts: ["white hair and cat ears"] }],
    frames: [{
      picture: "<Picture 1>", subject_ids: ["subject_1"], composition: "centered medium shot",
      environment: "quiet interior", lighting: "soft side light", camera: "locked camera",
      visible_state: "the subject stands with one hand lowered",
    }],
    motion_plan: {
      action_start: "one hand starts lowered", action_process: "the hand gradually raises",
      action_result: "the hand settles", camera_behavior: "locked camera",
    },
    audio_plan: { diegetic_sound: "N/A", ambience: "N/A", non_diegetic_music: "N/A" },
  },
));
assert.equal(ordinaryCoverageCalls.some((prefixes) => prefixes.some((prefix) => prefix.startsWith("age_"))), false);
assert.equal(ordinaryCoverageCalls.some((prefixes) => prefixes.includes("identity_")), true);
assert.equal(ordinaryCoverageCalls.some((prefixes) => prefixes.includes("clothing_")), true);

const emptyPromptWorkflowRequest = reverseWorkflow.prepareRequest({
  modelId: "minimax_h3_local",
  mode: "image_video",
  durationSeconds: 5,
  prompt: "",
  requirements: "Keep visible identity stable",
  resources: [workflowFirstFrame()],
}).request;
emptyPromptWorkflowRequest.visualSchema = "nf.h3.visual.v1";
emptyPromptWorkflowRequest.contentPolicy = { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false };
emptyPromptWorkflowRequest.userPrompt = "";
emptyPromptWorkflowRequest.userRequirements = "Keep visible identity stable";
assert.equal(emptyPromptWorkflowRequest.preferredOutputLanguage, "zh-CN");
assert.match(emptyPromptWorkflowRequest.currentPrompt, /Use <Picture 1> as the exact opening frame/);
const emptyPromptGrokRequest = build(emptyPromptWorkflowRequest);
const emptyPromptGrokText = emptyPromptGrokRequest.body.input[0].content.at(-1).text;
assert.match(emptyPromptGrokText, /descriptive fact values in Simplified Chinese/);
assert.doesNotMatch(emptyPromptGrokText, /descriptive fact values in English/);

const englishPromptWorkflowRequest = reverseWorkflow.prepareRequest({
  modelId: "minimax_h3_local",
  mode: "image_video",
  durationSeconds: 5,
  prompt: "The knight slowly raises a sword",
  requirements: "Keep visible identity stable",
  resources: [workflowFirstFrame()],
}).request;
englishPromptWorkflowRequest.visualSchema = "nf.h3.visual.v1";
englishPromptWorkflowRequest.contentPolicy = { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false };
englishPromptWorkflowRequest.userPrompt = "The knight slowly raises a sword";
englishPromptWorkflowRequest.userRequirements = "Keep visible identity stable";
assert.equal(englishPromptWorkflowRequest.preferredOutputLanguage, "en");
assert.match(build(englishPromptWorkflowRequest).body.input[0].content.at(-1).text, /descriptive fact values in English/);

const optimizeContext = {
  miniMaxH3PromptEnhanceUserRequirement: (requirements) => requirements,
  h3PromptEnhance: require('../admin-server/h3-prompt-enhance'),
  isMiniMaxH3PromptEnhancePayload: () => true,
  smartAiSupportsNegativePrompt: () => true,
  isSmartAiAnimationPayload: () => false,
  smartAiCurrentPrompt: context.smartAiCurrentPrompt,
  normalizeSmartAiText: context.normalizeSmartAiText,
  smartAiPayloadPurpose: context.smartAiPayloadPurpose,
  smartAiImageArtDirectorRules: () => "",
  smartAiChinesePromptOutputRules: () => "",
  smartAiInputText: context.smartAiInputText,
  miniMaxH3PromptProtocolRules: vm.runInNewContext(
    `(${extractNamedFunction(source, "miniMaxH3PromptProtocolRules")})`,
    {
      MINIMAX_H3_CONTENT_POLICY_BLOCK_MARKER: "H3_CONTENT_POLICY_BLOCKED",
    },
  ),
  miniMaxH3PromptEnhanceDurationFromText: vm.runInNewContext(
    `(${extractNamedFunction(source, "miniMaxH3PromptEnhanceDurationFromText")})`,
    {
      normalizeSmartAiText: context.normalizeSmartAiText,
    },
  ),
  miniMaxH3RequestedDuration: vm.runInNewContext(
    `(${extractNamedFunction(source, "miniMaxH3RequestedDuration")})`,
    {
      normalizeSmartAiText: context.normalizeSmartAiText,
    },
  ),
  miniMaxH3ContentContract: () => ({
    visualSchema: "nf.h3.visual.v1",
    contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
  }),
  miniMaxH3EnhanceMode: (payload) => String(payload?.h3Mode || "text_video"),
  miniMaxH3ValidateRawUserContent: validateRawUserContent,
  ...(() => {
    const safetyContext = {
      MINIMAX_H3_CONTENT_POLICY_BLOCK_MARKER: "H3_CONTENT_POLICY_BLOCKED",
      MINIMAX_H3_FAITHFUL_PICTURE_RULE: vm.runInNewContext(extractNamedConstant(source, "MINIMAX_H3_FAITHFUL_PICTURE_RULE")),
    };
    return {
      miniMaxH3OptimizeSafetyRules: vm.runInNewContext(`(${extractNamedFunction(source, "miniMaxH3OptimizeSafetyRules")})`, safetyContext),
      miniMaxH3ContentSafetySchema: vm.runInNewContext(`(${extractNamedFunction(source, "miniMaxH3ContentSafetySchema")})`, safetyContext),
    };
  })(),
  miniMaxH3OptimizeFrameContent: vm.runInNewContext(
    `(${extractNamedFunction(source, "miniMaxH3OptimizeFrameContent")})`,
    {
      h3PromptEnhance: require('../admin-server/h3-prompt-enhance'),
      smartAiInputText: context.smartAiInputText,
      Error,
    },
  ),
  MINIMAX_H3_PROMPT_MAX_OUTPUT_TOKENS: 4096,
  adminData: context.adminData,
  Error,
};
const buildOptimize = vm.runInNewContext(
  `(${extractNamedFunction(source, "buildGrokPromptOptimizeRequest")})`,
  optimizeContext,
);
const optimized = buildOptimize({
  purpose: "minimax-h3-prompt-enhance",
  currentPrompt: "白色纸飞机从桌面起飞",
  requirements: "T2VA；时长 5 秒；保持柔和晨光",
  h3Mode: "text_video",
  durationSeconds: 5,
  surface: "animation",
  provider: "grok",
});
const optimizeUserText = optimized.body.input[1].content[0].text;
assert.match(optimizeUserText, /白色纸飞机从桌面起飞/);
assert.match(optimizeUserText, /默认使用简体中文/);
assert.match(optimizeUserText, /【任务定位】[\s\S]*?【连续性与约束】/);
assert.match(optimizeUserText, /consecutive time ranges/);
assert.equal(optimized.inputMeta.mode, "minimax_h3_prompt_enhance");
assert.equal(optimized.resultOptions.visualRetryAllowed, true);
assert.equal(optimized.resultOptions.durationSeconds, 5);
assert.equal(optimized.resultOptions.supportsNegativePrompt, false);

const optimizedFl2v = buildOptimize({
  purpose: "minimax-h3-prompt-enhance",
  currentPrompt: "小角色从首帧动作连续过渡到尾帧",
  requirements: "让动画更生动",
  h3Mode: "first_last",
  durationSeconds: 4,
  visualSchema: "nf.h3.visual.v1",
  surface: "animation",
  provider: "grok",
});
const optimizeFl2vUserText = optimizedFl2v.body.input[1].content[0].text;
assert.match(optimizeFl2vUserText, /mode: first_last/);
assert.match(optimizeFl2vUserText, /durationSeconds: 4/);
assert.match(optimizeFl2vUserText, /<Picture 1>[\s\S]*?<Picture 2>[\s\S]*?selected duration/);
assert.match(optimizeFl2vUserText, /exact final frame/);
assert.equal(optimizedFl2v.resultOptions.minimaxH3Mode, "first_last");
assert.equal(optimizedFl2v.resultOptions.durationSeconds, 4);

// New renderers mark base modes bilingual (official three fields as a Chinese/English pair) and send
// translate-only compiles. The desktop admin copy asks Grok what the Edge function asks and normalizes alike.
{
  const h3 = optimizeContext.h3PromptEnhance;
  const constants = ["MINIMAX_H3_REFERENCE_TRANSLATE_INSTRUCTION", "MINIMAX_H3_TRANSLATOR_ROLE", "MINIMAX_H3_BASE_PAIR_RULES"];
  for (const name of constants) {
    assert.equal(extractNamedConstant(source, name), extractNamedConstant(edgeSource, name), `${name} must match the Edge copy`);
    optimizeContext[name] = vm.runInNewContext(extractNamedConstant(source, name));
  }
  const lf = (text) => text.replace(/\r\n/g, "\n");
  assert.equal(lf(extractNamedFunction(source, "miniMaxH3EnhanceMode")), lf(extractNamedFunction(edgeSource, "miniMaxH3EnhanceMode")));
  assert.equal(lf(extractNamedFunction(source, "miniMaxH3DialogueBlocks")), lf(extractNamedFunction(edgeSource, "miniMaxH3DialogueBlocks")));
  optimizeContext.miniMaxH3DialogueBlocks = vm.runInNewContext(`(${extractNamedFunction(source, "miniMaxH3DialogueBlocks")})`);
  const enhanceBranch = (text) => lf(extractNamedFunction(text, "normalizeMiniMaxH3PromptOutput")).split("const raw = normalizeGeneratedPrompt(text);")[0];
  assert.equal(enhanceBranch(source), enhanceBranch(edgeSource));
  const chineseFields = "integrated_multimodal_description: [Shot 1] 写实风格，<Picture 1> 中的白色纸飞机从桌面起飞，滑出窗外。镜头保持固定。\n\noverall_soundscape: 纸张轻响，窗外有风声。\n\nnon_diegetic_music: N/A";
  const request = (h3Mode, markers, currentPrompt = "白色纸飞机从桌面起飞", contentPolicy = undefined) => buildOptimize({
    purpose: "minimax-h3-prompt-enhance", currentPrompt, h3Mode, durationSeconds: 5, surface: "animation", provider: "grok", contentPolicy,
    requirements: [...markers, "Available resource labels: <Picture 1> = captured image slot first_frame.", "Source prompt:", currentPrompt].join("\n"),
  });
  const system = (built) => built.body.input[0].content[0].text;
  const user = (built) => built.body.input[1].content[0].text;
  const pair = request("text_video", ["H3 response format: bilingual-v1"]);
  assert.deepEqual(pair.body.text.format.schema, JSON.parse(JSON.stringify(h3.baseResultSchema)));
  assert.ok(system(pair).includes(h3.instructionFor("白色纸飞机从桌面起飞")) && system(pair).includes(h3.baseInstruction));
  // The idle-breathing rule only for an idle request, as on the Edge.
  assert.ok(!system(pair).includes("仅呼吸待机时"));
  assert.ok(system(request("text_video", ["H3 response format: bilingual-v1"], "机器人原地呼吸待机")).includes(h3.instruction));
  // 图生/首尾帧 optimize shows Grok its frames, as on the Edge; a translation does not.
  const frames = [{ label: "<Picture 1>", dataUrl: "data:image/jpeg;base64,aGVsbG8=" }];
  const withFrames = (markers) => buildOptimize({
    purpose: "minimax-h3-prompt-enhance", currentPrompt: "女孩挥手", h3Mode: "image_video", durationSeconds: 5, h3ReferenceFrames: frames,
    requirements: [...markers, "Available resource labels: <Picture 1> = captured image slot first_frame.", "Source prompt:", "女孩挥手"].join("\n"),
  });
  const seen = withFrames(["H3 response format: bilingual-v1"]);
  assert.equal(seen.inputMeta.imageCount, 1);
  assert.deepEqual(Array.from(seen.body.input[1].content, (item) => item.type), ["input_text", "input_text", "input_text", "input_image"]);
  assert.match(seen.body.input[1].content[1].text, /<Picture 1> is the opening frame of the target video\. Take the visual style, the subjects/);
  assert.equal(withFrames(["H3 compile: translate-only", "H3 response format: bilingual-v1"]).inputMeta.imageCount, 0);
  assert.ok(user(pair).includes(h3.baseResultInstruction) && user(pair).includes(optimizeContext.MINIMAX_H3_BASE_PAIR_RULES));
  assert.doesNotMatch(user(pair), /【任务定位】|consecutive time ranges/);
  assert.equal(pair.resultOptions.minimaxH3BaseResult, true);
  assert.equal(pair.resultOptions.minimaxH3TranslateOnly, false);
  const translate = request("image_video", ["H3 compile: translate-only", "H3 response format: bilingual-v1"], chineseFields);
  assert.deepEqual(translate.body.text.format.schema, JSON.parse(JSON.stringify(h3.baseResultSchema)));
  assert.match(user(translate), /^H3 compile: translate-only$/m);
  assert.ok(user(translate).includes(h3.baseTranslateInstruction));
  assert.ok(system(translate).startsWith(optimizeContext.MINIMAX_H3_TRANSLATOR_ROLE) && !system(translate).includes(h3.instruction));
  assert.equal(translate.body.temperature, 0.1);
  assert.equal(translate.resultOptions.minimaxH3TranslateOnly, true);
  // Speech typed in quotes reaches the translator as a <d> block; the display half stays as typed.
  const spoken = chineseFields.replace("滑出窗外。", "滑出窗外，女孩说：“再见。”");
  assert.match(user(request("image_video", ["H3 compile: translate-only", "H3 response format: bilingual-v1"], spoken)), /女孩说：<d>\[Chinese\] 再见。<\/d>/);
  assert.match(user(request("image_video", ["H3 response format: bilingual-v1"], spoken)), /女孩说：“再见。”/);
  const reference = request("full_reference", ["H3 response format: bilingual-v1", "H3 compile: translate-only"]);
  assert.deepEqual(reference.body.text.format.schema.required, ["modelPrompt", "displayPrompt", "editPolicy"]);
  assert.ok(user(reference).includes(optimizeContext.MINIMAX_H3_REFERENCE_TRANSLATE_INSTRUCTION));
  assert.equal(reference.resultOptions.minimaxH3BaseResult, false);
  // The old five-section request is unchanged.
  assert.deepEqual(optimized.body.text.format.schema.required, h3.sectionFields);
  assert.equal(optimized.resultOptions.minimaxH3BaseResult, false);

  const normalizeDesktop = vm.runInNewContext(`(${extractNamedFunction(source, "normalizeMiniMaxH3PromptOutput")})`, {
    h3PromptEnhance: h3,
    miniMaxH3PromptEnhanceUserRequirement: vm.runInNewContext(`(${extractNamedFunction(source, "miniMaxH3PromptEnhanceUserRequirement")})`, {
      normalizeSmartAiText: context.normalizeSmartAiText,
    }),
    miniMaxH3ContractError: context.miniMaxH3ContractError,
    miniMaxH3AssertOptimizeContentSafety: vm.runInNewContext(`(${extractNamedFunction(source, "miniMaxH3AssertOptimizeContentSafety")})`, {
      ...sensitiveContext,
      h3PromptEnhance: h3,
      MINIMAX_H3_CONTENT_POLICY_BLOCK_MARKER: "H3_CONTENT_POLICY_BLOCKED",
    }),
    Error,
  });
  const english = "integrated_multimodal_description: [Shot 1] Live-action, the white paper plane in <Picture 1> lifts off the desk and glides out of the window. The camera holds a static shot.\n\noverall_soundscape: Paper rustles softly as wind blows outside.\n\nnon_diegetic_music: N/A";
  const answer = JSON.stringify({ modelPrompt: english, displayPrompt: "改写过的显示稿" });
  const translated = JSON.parse(normalizeDesktop(answer, translate.resultOptions));
  assert.equal(translated.displayPrompt, h3.validateBaseFields(chineseFields, { mode: "image_video", durationSeconds: 5, language: "zh" }));
  assert.equal(translated.modelPrompt, h3.validateBaseFields(english, { mode: "image_video", durationSeconds: 5, language: "en" }));
  assert.throws(() => normalizeDesktop(JSON.stringify({ modelPrompt: chineseFields, displayPrompt: chineseFields }), translate.resultOptions),
    (error) => error.errorCode === "h3_contract_fields" && /英文正文/.test(error.message));

  // 图生/首尾帧/多参 optimize is the image action: reverse's content-safety handling rides in its one call, as on the Edge.
  // The shared sensitive categories and the 美工 role-reference safety match the Edge copy too.
  for (const name of ["miniMaxH3OptimizeSafetyRules", "miniMaxH3ContentSafetySchema", "miniMaxH3AssertOptimizeContentSafety",
    "miniMaxH3SensitiveCategories", "artReferenceUserContentState", "artReferenceAssertContentSafety"]) {
    assert.equal(lf(extractNamedFunction(source, name)), lf(extractNamedFunction(edgeSource, name)), `${name} must match the Edge copy`);
  }
  for (const name of ["MINIMAX_H3_FAITHFUL_PICTURE_RULE", "MINIMAX_H3_BENIGN_EXPOSURE_PATTERN", "ART_REFERENCE_CONTENT_SAFETY_RULE"]) {
    assert.equal(extractNamedConstant(source, name), extractNamedConstant(edgeSource, name), `${name} must match the Edge copy`);
  }
  const framedRequest = (currentPrompt, contentPolicy = { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false }) => buildOptimize({
    purpose: "minimax-h3-prompt-enhance", currentPrompt, h3Mode: "image_video", durationSeconds: 5, h3ReferenceFrames: frames, contentPolicy, surface: "animation", provider: "grok",
    requirements: ["H3 response format: bilingual-v1", "Available resource labels: <Picture 1> = captured image slot first_frame.", "Source prompt:", currentPrompt].join("\n"),
  });
  const framed = framedRequest("白色纸飞机从桌面起飞");
  const framedSchema = JSON.parse(JSON.stringify(framed.body.text.format.schema));
  assert.deepEqual(framedSchema.required, ["modelPrompt", "displayPrompt", "contentSafety"]);
  assert.deepEqual(framedSchema.properties.contentSafety.required, ["explicitMinorEvidence", "sensitiveContent"]);
  assert.deepEqual(framedSchema.properties.modelPrompt, JSON.parse(JSON.stringify(h3.baseResultSchema.properties.modelPrompt)));
  // With pictures in a pair the person rule stays in the request text; the faithful-facts and fail-closed rules ride in the schema.
  assert.match(user(framed), /Content safety: never state a person's age or age group[\s\S]*keep 女孩 as 女孩 in displayPrompt and write girl in modelPrompt/);
  assert.doesNotMatch(user(framed), /H3_CONTENT_POLICY_BLOCKED|sensitive details|\bminor\b|underage/);
  assert.match(framedSchema.properties.contentSafety.description, /both true, every prompt field is exactly H3_CONTENT_POLICY_BLOCKED: explicit_minor_sensitive_content\.$/);
  assert.match(framedSchema.properties.contentSafety.properties.sensitiveContent.description, /sensitive details included: never omit or soften a visible fact/);
  // Without the fact-faithful policy of the AI 助手 (the generation-time compile) the call is as it was: no field, rules or youth flag.
  const compile = framedRequest("小孩在岩石上攀爬", { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false });
  assert.deepEqual(JSON.parse(JSON.stringify(compile.body.text.format.schema.required)), ["modelPrompt", "displayPrompt"]);
  assert.doesNotMatch(user(compile), /Content safety|H3_CONTENT_POLICY_BLOCKED/);
  assert.equal(compile.resultOptions.explicitYouthUserRequest, false);
  // Without pixels there is nothing to report and the schema stays the plain pair; a translation carries no writing rules at all.
  // The rules come with the fact-faithful policy of the AI 助手 (every 文生视频 optimize from the dialog sends it).
  const aiPair = request("text_video", ["H3 response format: bilingual-v1"], "白色纸飞机从桌面起飞", { sensitiveVisualAnalysis: true, allSubjectsConfirmedAdult: false });
  assert.deepEqual(aiPair.body.text.format.schema, JSON.parse(JSON.stringify(h3.baseResultSchema)));
  assert.match(user(aiPair), /keep 女孩 as 女孩 in displayPrompt and write girl in modelPrompt[\s\S]*as every field value\. A young-looking/);
  assert.doesNotMatch(user(aiPair), /sensitive details included|contentSafety/);
  assert.doesNotMatch(user(pair), /Content safety|H3_CONTENT_POLICY_BLOCKED/);
  assert.doesNotMatch(user(translate), /Content safety|H3_CONTENT_POLICY_BLOCKED/);
  assert.equal(translate.resultOptions.explicitYouthUserRequest, false);
  // Explicit minor wording with a sensitive request is refused before any call, as in reverse.
  assert.throws(() => framedRequest("小孩全裸站在海边"), (error) => error.errorCode === "provider_content_policy" && error.statusCode === 422);
  assert.equal(framedRequest("小孩在海边奔跑").resultOptions.explicitYouthUserRequest, true);
  const framedPair = (contentSafety, modelPrompt = english) => JSON.stringify({ modelPrompt, displayPrompt: chineseFields, contentSafety });
  const clean = JSON.parse(normalizeDesktop(framedPair({ explicitMinorEvidence: false, sensitiveContent: false }), framed.resultOptions));
  assert.deepEqual(Object.keys(clean), ["modelPrompt", "displayPrompt"], "contentSafety never leaves the edge");
  const blocked = (text, options = framed.resultOptions) => assert.throws(() => normalizeDesktop(text, options),
    (error) => error.errorCode === "provider_content_policy" && error.statusCode === 422 && error.minimaxH3ContractInvalid === false);
  blocked(framedPair({ explicitMinorEvidence: true, sensitiveContent: true }));
  blocked(framedPair({ explicitMinorEvidence: true, sensitiveContent: false }, english.replace("glides out of the window", "a fully nude figure glides out of the window")));
  blocked(framedPair({ explicitMinorEvidence: false, sensitiveContent: true }), framedRequest("小孩在海边奔跑").resultOptions);
  blocked(JSON.stringify({ modelPrompt: { integrated_multimodal_description: "H3_CONTENT_POLICY_BLOCKED: explicit_minor_sensitive_content", overall_soundscape: "N/A", non_diegetic_music: "N/A" }, displayPrompt: chineseFields }));
  assert.doesNotThrow(() => normalizeDesktop(framedPair({ explicitMinorEvidence: true, sensitiveContent: false }), framed.resultOptions), "a child without sensitive content is an ordinary video");
  assert.doesNotThrow(() => normalizeDesktop(framedPair({ explicitMinorEvidence: false, sensitiveContent: true }), framed.resultOptions), "adult sensitive content follows the content policy");
  // Everyday words next to a child are no sensitive content: bare rock, light penetrating the clouds, a bottle nipple.
  assert.equal(framedRequest("小孩在裸露的岩石上攀爬，阳光穿透云层").resultOptions.explicitYouthUserRequest, true);
  assert.doesNotThrow(() => normalizeDesktop(framedPair({ explicitMinorEvidence: true, sensitiveContent: false },
    english.replace("glides out of the window", "glides over the exposed rocks while sunlight penetrating the clouds catches a rubber nipple on the sill")),
  framed.resultOptions), "everyday words beside a child are written");
  assert.doesNotThrow(() => normalizeDesktop(framedPair({ explicitMinorEvidence: false, sensitiveContent: false }), framedRequest("小孩在海边奔跑").resultOptions),
    "a child named by the user pairs only with a sensitive signal");
  import("../../supabase/functions/novaflow-backend/smart-ai-grok.workflow.mjs").then((edge) => {
    const edgeTranslate = edge.buildGrokPromptOptimizeRequest({
      purpose: "minimax-h3-prompt-enhance", prompt: chineseFields, h3Mode: "image_video", durationSeconds: 5,
      requirements: ["H3 compile: translate-only", "H3 response format: bilingual-v1", "Source prompt:", chineseFields].join("\n"),
    }, "grok-test");
    assert.deepEqual(edgeTranslate.body.text.format.schema, translate.body.text.format.schema);
    assert.equal(edge.normalizeMiniMaxH3PromptOutput(answer, edgeTranslate.resultOptions), JSON.stringify(translated));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

const fl2v = build({
  userPrompt: "",
  userRequirements: "",
  purpose: "MINIMAX_H3_FL2V_REVERSE",
  requirements: "FL2VA; duration 8 seconds; use both frame anchors",
  images: [frame("last_frame", "LAST"), frame("first_frame", "FIRST")],
  visualSchema: "nf.h3.visual.v1",
  contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
});
assert.equal(fl2v.inputMeta.mode, "minimax_h3_fl2v_reverse");
assert.equal(fl2v.inputMeta.scenario, "video_frames");
assert.deepEqual(
  Array.from(fl2v.resultOptions.h3VisualBodies, (frameBody) => frameBody.input[0].content[0].image_url),
  ["data:image/png;base64,FIRST", "data:image/png;base64,LAST"],
);
assert.equal(fl2v.resultOptions.h3VisualBodies.every((frameBody) => (
  frameBody.input[0].content.filter((item) => item.type === "input_image").length === 1
)), true);
assert.equal(fl2v.resultOptions.requiredProviderCalls, 2);
assert.equal(fl2v.resultOptions.minimaxH3Mode, "first_last");

const localizedFl2v = build({
  userPrompt: "",
  userRequirements: "",
  purpose: "minimax-h3-fl2v-reverse",
  requirements: "FL2VA; duration 8 seconds; use localized frame slots",
  images: [
    { label: "尾帧", dataUrl: "data:image/png;base64,Q0hJTkVTRV9MQVNU" },
    { label: "首帧", dataUrl: "data:image/png;base64,Q0hJTkVTRV9GSVJTVA==" },
  ],
  visualSchema: "nf.h3.visual.v1",
  contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
});
assert.equal(localizedFl2v.inputMeta.mode, "minimax_h3_fl2v_reverse");
assert.equal(localizedFl2v.inputMeta.scenario, "video_frames");
assert.deepEqual(
  Array.from(localizedFl2v.resultOptions.h3VisualBodies, (frameBody) => frameBody.input[0].content[0].image_url),
  ["data:image/png;base64,Q0hJTkVTRV9GSVJTVA==", "data:image/png;base64,Q0hJTkVTRV9MQVNU"],
);

assert.throws(
  () => build({
    userPrompt: "",
    userRequirements: "",
    purpose: "minimax-h3-i2v-reverse",
    visualSchema: "nf.h3.visual.v1",
    requirements: "required",
    images: [frame("first_frame", "A"), frame("last_frame", "B")],
  }),
  /exactly one first_frame/,
);
assert.throws(
  () => build({
    userPrompt: "",
    userRequirements: "",
    purpose: "minimax-h3-fl2v-reverse",
    visualSchema: "nf.h3.visual.v1",
    requirements: "required",
    images: [frame("first_frame", "A")],
  }),
  /exactly one first_frame and one last_frame/,
);
const sameFrameFl2v = build({
    userPrompt: "",
    userRequirements: "",
    purpose: "minimax-h3-fl2v-reverse",
    visualSchema: "nf.h3.visual.v1",
    requirements: "required",
    images: [frame("first_frame", "SAME"), frame("last_frame", "SAME")],
});
assert.equal(sameFrameFl2v.resultOptions.minimaxH3Mode, "first_last");
assert.equal(sameFrameFl2v.resultOptions.requiredProviderCalls, 2);
assert.deepEqual(
  Array.from(sameFrameFl2v.resultOptions.h3VisualBodies, (body) => body.input[0].content[0].image_url),
  ["data:image/png;base64,SAME", "data:image/png;base64,SAME"],
);
for (const [payload, expectedCode] of [
  [{
    userPrompt: "",
    userRequirements: "",
    purpose: "minimax-h3-i2v-reverse",
    visualSchema: "nf.h3.visual.v1",
    requirements: "required",
    images: [frame("first_frame", "A"), frame("last_frame", "B")],
  }, "h3_contract_images"],
  [{
    userPrompt: "",
    userRequirements: "",
    purpose: "minimax-h3-i2v-reverse",
    visualSchema: "nf.h3.visual.v1",
    requirements: "",
    images: [frame("first_frame", "A")],
  }, "h3_contract_requirements"],
]) {
  assert.throws(
    () => build(payload),
    (error) => error?.errorCode === expectedCode
      && error?.statusCode === 400
      && error?.minimaxH3SafeError === true,
  );
}

const safePreflightError = context.miniMaxH3ContractError(
  "provider_content_policy",
  "adult nudity must never be reflected",
  422,
  "provider_content_policy",
);
const safePreflight = preflight({ purpose: "minimax-h3-i2v-reverse" }, safePreflightError);
assert.equal(safePreflight.httpStatus, 422);
assert.equal(safePreflight.envelope.failureCategory, "provider_content_policy");
assert.equal(safePreflight.envelope.retryable, false);
assert.equal(safePreflight.envelope.providerCallCount, 0);
assert.doesNotMatch(JSON.stringify(safePreflight), /adult nudity/);
const internalPreflight = preflight(
  { purpose: "minimax-h3-fl2v-reverse" },
  new Error("sentinel-secret"),
);
assert.equal(internalPreflight.httpStatus, 500);
assert.equal(internalPreflight.envelope.errorCode, "provider_http");
assert.equal(internalPreflight.envelope.providerCallCount, 0);
assert.doesNotMatch(JSON.stringify(internalPreflight), /sentinel-secret/);
assert.equal(preflight({ purpose: "static-image-reverse" }, new Error("ordinary")), null);

const genericRoute = extractNamedFunction(source, "buildGrokImageReverseRequest");
assert.match(
  genericRoute,
  /if \(miniMaxH3ReverseMode\(payload\)\) return buildMiniMaxH3GrokReverseRequest\(payload, String\(model \|\| "grok-4\.3"\)\);/,
);
assert.match(
  mainSource,
  /\["minimax-h3-i2v-reverse", "minimax-h3-fl2v-reverse"\]\.includes\(normalizedPurpose\)[\s\S]*?\? 12000[\s\S]*?: 2000/,
);
assert.match(previewSource, /"minimax-h3-i2v-reverse",[\s\S]*?"minimax-h3-fl2v-reverse",/);
assert.match(previewSource, /requirements_limit = 12000 if normalized_purpose/);

console.log("MiniMax H3 Grok reverse contract passed");

// A repeated or rhythmic motion is progression, not a still-frame caption. The gate's word list
// had only one-way wording (开始 / 逐渐 / 持续 / 动作), so a faithful "反复进出，每次…" narrative
// was rejected as "must describe action progression, not only a static image caption".
// The shipped renderer has no keyword gate any more; the service pattern still does.
{
  assert.doesNotMatch(fs.readFileSync(promptWorkflowPath, "utf8"), /ACTION_PROGRESSION_EXPRESSION/);
  const servicePattern = vm.runInNewContext(
    extractNamedConstant(source, "MINIMAX_H3_ACTION_PROGRESSION_PATTERN"),
  );
  const progression = [
    "快速有力地反复进出，每次都伴随少量液体喷出。",
    "身体来回晃动，胸口起伏。",
    "节奏由慢加快，幅度逐渐加大。",
    "Repeated thrusts accelerate, pulsing rhythmically.",
  ];
  const stillCaptions = [
    "固定镜头。<主体 1> 仰躺，双腿分开，全程保持同一姿势。",
    "A still portrait of a seated figure, soft light, neutral background.",
  ];
  for (const text of progression) {
    assert.ok(servicePattern.test(text), `rhythmic motion must read as progression: ${text}`);
  }
  for (const text of stillCaptions) {
    assert.ok(!servicePattern.test(text), `a still caption must stay blocked: ${text}`);
  }
}
