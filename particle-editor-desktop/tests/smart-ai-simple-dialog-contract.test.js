const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const workflowPath = path.join(root, "particle-editor", "smart-ai-art-auto-intent.workflow.js");
const smartAiPath = path.join(root, "particle-editor", "novaflow-smart-ai.js");
const runtimePath = path.join(root, "particle-editor", "novaflow-brand-runtime.js");
const indexPath = path.join(root, "particle-editor", "index.html");
const workflowSource = fs.readFileSync(workflowPath, "utf8");
const smartAiSource = fs.readFileSync(smartAiPath, "utf8");
const runtimeSource = fs.readFileSync(runtimePath, "utf8");
const indexSource = fs.readFileSync(indexPath, "utf8");

function extractNamedFunction(input, name) {
  const marker = `function ${name}(`;
  const start = input.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const paramsStart = input.indexOf("(", start);
  let paramsDepth = 0;
  let paramsQuote = "";
  let paramsEscaped = false;
  let bodyStart = -1;
  for (let index = paramsStart; index < input.length; index += 1) {
    const char = input[index];
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
        bodyStart = input.indexOf("{", index + 1);
        break;
      }
    }
  }
  assert.notEqual(bodyStart, -1, `${name} body must exist`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < input.length; index += 1) {
    const char = input[index];
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
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(start, index + 1);
    }
  }
  throw new Error(`unable to extract ${name}`);
}

const context = vm.createContext({ window: {} });
vm.runInContext(workflowSource, context, { filename: workflowPath });
const workflow = context.window.NovaFlowSmartAiArtAutoIntent;
assert.ok(workflow, "the Art auto-intent workflow must register itself");

const optimize = workflow.derive({ imageCount: 0, userIntent: "优化已有角色提示词", hadInitialPrompt: true });
assert.equal(optimize.route, "optimize");
assert.equal(optimize.purpose, "optimize");
assert.equal(optimize.generationMode, "txt2img");
const emptyEdit = workflow.derive({ imageCount: 0, userIntent: "", hadInitialPrompt: true });
assert.equal(emptyEdit.purpose, "optimize");
assert.equal(emptyEdit.canSubmit, true, "an existing prompt must be optimizable without a separate edit instruction");

const create = workflow.derive({ imageCount: 0, userIntent: "设计一名银发角色", hadInitialPrompt: false });
assert.equal(create.purpose, "create");
assert.equal(create.canSubmit, true);

const single = workflow.derive({ imageCount: 1, userIntent: "", hadInitialPrompt: false });
assert.equal(single.route, "static_reverse");
assert.equal(single.purpose, "static-image-reverse");
assert.equal(single.generationMode, "img2img");
assert.deepEqual(Array.from(single.roles), ["subject"]);
assert.equal(single.canSubmit, true, "one reference must be reversible without extra text");

const explicitMulti = workflow.derive({
  imageCount: 3,
  userIntent: "图2作为姿势参考，图3作为背景参考",
  hadInitialPrompt: false
});
assert.equal(explicitMulti.route, "role_reference");
assert.deepEqual(Array.from(explicitMulti.roles), ["subject", "pose", "background"]);
assert.equal(explicitMulti.roleConfidence, "high");
assert.deepEqual(Array.from(explicitMulti.unresolvedRoleIndices), []);

const ambiguousMulti = workflow.derive({ imageCount: 2, userIntent: "提升完成度" });
assert.deepEqual(Array.from(ambiguousMulti.roles), ["subject", "style"]);
assert.equal(ambiguousMulti.style, "reference");
assert.equal(ambiguousMulti.roleConfidence, "low");
assert.deepEqual(Array.from(ambiguousMulti.unresolvedRoleIndices), [1]);
assert.equal(workflow.derive({ imageCount: 4, userIntent: "" }).imageCount, 3, "Art auto intent must never expose a fourth reference slot");

const storageValues = new Map();
const storage = {
  getItem: (key) => storageValues.get(key) || "",
  setItem: (key, value) => storageValues.set(key, value)
};
assert.equal(workflow.readProviderPreference(storage), "");
assert.equal(workflow.writeProviderPreference(storage, "local"), true);
assert.equal(workflow.readProviderPreference(storage), "local");
assert.equal(workflow.writeProviderPreference(storage, "grok"), true);
assert.equal(workflow.readProviderPreference(storage), "grok");

const workflowTag = "smart-ai-art-auto-intent.workflow.js?v=20260811-art-auto-intent-1";
const smartAiTag = "novaflow-smart-ai.js?v=20260914-art-fusion-2";
const runtimeTag = indexSource.match(/novaflow-brand-runtime\.js\?v=[^"']+/)?.[0];
assert.ok(indexSource.includes(workflowTag));
assert.ok(indexSource.includes(smartAiTag));
assert.ok(indexSource.includes(runtimeTag));
assert.ok(indexSource.indexOf(workflowTag) < indexSource.indexOf(smartAiTag));

const roleRenderState = {
  images: [{ label: "图1" }, { label: "图2" }, { label: "图3" }],
  referenceRoles: ["subject", "pose", "background"],
  advancedOpen: true,
  engine: "local",
  mode: "reverse"
};
const renderArtReferenceRoles = vm.runInNewContext(`(${extractNamedFunction(smartAiSource, "renderArtReferenceRoles")})`, {
  state: roleRenderState,
  escapeSmartAiHtml: (value) => String(value),
  artReferenceRoleOptions: () => [
    ["subject", "主图"],
    ["style", "风格"],
    ["pose", "姿势"],
    ["background", "背景"],
    ["composition", "构图"]
  ]
});
let rerenderedIntent = workflow.derive({ imageCount: 3, userIntent: "", roleOverrides: { 1: "pose", 2: "background" } });
roleRenderState.referenceRoles = Array.from(rerenderedIntent.roles);
let advancedHtml = renderArtReferenceRoles(rerenderedIntent);
assert.match(advancedHtml, /data-smart-ai-reference-role="1"/);
assert.match(advancedHtml, /data-smart-ai-reference-role="2"/);
assert.match(advancedHtml, /<option value="pose" selected>/);
rerenderedIntent = workflow.derive({ imageCount: 3, userIntent: "", roleOverrides: { 1: "background", 2: "style" } });
roleRenderState.referenceRoles = Array.from(rerenderedIntent.roles);
advancedHtml = renderArtReferenceRoles(rerenderedIntent);
assert.match(advancedHtml, /data-smart-ai-reference-role="1"/,
  "the role selector must remain available after the first explicit correction");
assert.match(advancedHtml, /<option value="background" selected>/,
  "the same auxiliary image must support a second role correction");
roleRenderState.mode = "optimize";
advancedHtml = renderArtReferenceRoles(rerenderedIntent);
assert.doesNotMatch(advancedHtml, /data-smart-ai-reference-role=/,
  "text optimization must not expose image-role controls that it will not use");
assert.equal(advancedHtml, "", "text optimization has no reference controls");
assert.doesNotMatch(smartAiSource, /<summary>高级设置<\/summary>/);
assert.match(extractNamedFunction(smartAiSource, "renderDialog"), /\$\{renderEngineOptions\(\)\}/);
assert.match(extractNamedFunction(smartAiSource, "renderDialog"), /if \(isArt\) rememberArtEngine\(state.engine\)/);

const artStorageValues = new Map();
const artStorage = {
  getItem: (key) => artStorageValues.get(key) || "",
  setItem: (key, value) => artStorageValues.set(key, value)
};
const providerState = { engine: "grok" };
const providerPositive = { value: "完整的现有绘图提示词" };
const providerContext = vm.createContext({
  state: providerState,
  window: { NovaFlowSmartAiArtAutoIntent: workflow, localStorage: artStorage },
  getPromptTextareasFromContext: () => ({ positive: providerPositive, negative: null }),
  renderDialog: () => {},
  refreshImageContext: () => {}
});
const openDialog = vm.runInContext(`(${extractNamedFunction(smartAiSource, "openDialog")})`, providerContext);
const rememberArtEngine = vm.runInContext(`(${extractNamedFunction(smartAiSource, "rememberArtEngine")})`, providerContext);
openDialog({ surface: "art", artGenerateMode: "txt2img" });
assert.equal(providerState.engine, "local", "Art must default to local without an Art-specific preference");
assert.equal(providerState.hadInitialPrompt, true);
assert.equal(providerState.requirements, "", "txt2img edit mode must keep the existing prompt outside the edit-instruction field");
rememberArtEngine("grok");
assert.equal(workflow.readProviderPreference(artStorage), "grok");
openDialog({ surface: "animation" });
providerState.engine = "local";
assert.equal(workflow.readProviderPreference(artStorage), "grok", "Animation changes must not overwrite the Art preference");
openDialog({ surface: "art", artGenerateMode: "img2img" });
assert.equal(providerState.engine, "grok", "reopening Art must restore its own explicit Grok preference");
assert.equal(providerState.mode, "optimize", "a live handwritten prompt must default to text optimization even with references");
assert.equal(providerState.requirements, "", "the current prompt must stay separate from supplemental requirements");
providerPositive.value = "";
openDialog({ surface: "art", artGenerateMode: "img2img" });
assert.equal(providerState.mode, "reverse", "an image-only Art request must default to image reverse");
assert.equal(providerState.requirements, "");

const renderDialogSource = extractNamedFunction(smartAiSource, "renderDialog");
assert.match(renderDialogSource, /renderArtModeRadios\(artIntent\)/);
assert.match(smartAiSource, /\[\["optimize", "优化提示词"\], \["reverse", "图片反推"\]\]/);
assert.match(renderDialogSource, /renderArtAutoStatus\(artIntent\)/);
assert.match(renderDialogSource, /isArt \? renderArtReferenceRoles\(artIntent\)/);
assert.match(renderDialogSource, /const isArtTextEdit = isArt && state\.mode === "optimize" && Boolean\(currentArtPrompt\)/);
assert.match(renderDialogSource, /说明你希望修改的内容（可选）/);
assert.match(renderDialogSource, /背景过于曝光，降低背景高光并恢复层次/);
assert.doesNotMatch(renderDialogSource, /showAdultDeclaration|novaflow-smart-ai-adult-declaration|提交即确认参考图与描述中的人物均为成年人/);
assert.doesNotMatch(renderDialogSource, /requiresAdultConfirmation|确认所有人物均为成年人并应用 NSFW 提示词/);
assert.doesNotMatch(renderDialogSource, /renderArtStarterPresets\(\)|renderArtDesignControls\(\)/);
assert.match(smartAiSource, /state\.engine = window\.NovaFlowSmartAiArtAutoIntent\?\.readProviderPreference\?\.\(window\.localStorage\) \|\| "local"/);
assert.match(smartAiSource, /const isArtTextRequest = isArt && isOptimizeRequest/);
assert.match(smartAiSource, /const artTextPurpose = isArtTextRequest \? \(currentPrompt \? "optimize" : "create"\) : ""/);
assert.match(smartAiSource, /artTextPurpose === "optimize" \? currentPrompt : ""/);
assert.match(smartAiSource, /includeUserIntent: !isArt \|\| isArtTextRequest/);
assert.match(smartAiSource, /userIntentFirst: isArtTextRequest/);
assert.match(smartAiSource, /currentPrompt: promptMentionProtection\.text/);
assert.match(smartAiSource, /isArtTextRequest \? artTextPurpose : artIntent\?\.purpose/);
assert.match(smartAiSource, /function validateSmartAiArtPromptPreservation\(currentPrompt, candidatePrompt, userInstruction = "", options = \{\}\)/);
assert.match(smartAiSource, /const usesStructuredArtPromptContract = isOptimizeRequest[\s\S]*?isArtTextRequest[\s\S]*?artTextPurpose === "optimize"[\s\S]*?!isMiniMaxH3Request[\s\S]*?shouldUseStructuredArtPromptContract\(currentPrompt\)/);
assert.match(smartAiSource, /usesStructuredArtPromptContract \? \{ promptSchema: ORDINARY_ART_PROMPT_SCHEMA \} : \{\}/);
assert.match(smartAiSource, /parsed\.editContract !== ORDINARY_ART_EDIT_CONTRACT[\s\S]*?parsed\.promptSchema !== ORDINARY_ART_PROMPT_SCHEMA[\s\S]*?prompt_contract_mismatch/);
assert.match(smartAiSource, /if \(usesStructuredArtPromptContract\) \{[\s\S]*?validateSmartAiStructuredArtPrompt\(nextPrompt\)[\s\S]*?validateSmartAiArtPromptPreservation\([\s\S]*?deterministicMerge: true[\s\S]*?throw smartAiPromptPreservationError\(preservation\)/);
assert.match(smartAiSource, /\["\[风格设定\]", \["媒介", "绘画语言", "氛围", "完成质感"\]\]/);
assert.match(smartAiSource, /\["\[环境背景\]", \["环境", "背景", "前中后景", "承托面", "遮挡层次"\]\]/);
assert.match(smartAiSource, /\["\[光线与色彩\]", \["光源方向", "光源软硬", "明暗关系", "轮廓光", "主辅色", "局部颜色"\]\]/);
assert.match(smartAiSource, /\["\[拍摄参数\]", \["景别", "视角", "构图", "裁切", "透视", "景深"\]\]/);
assert.match(smartAiSource, /const expectedSubjectKeys = \["主体数量"\][\s\S]*?`主体\$\{index\}局部细节`[\s\S]*?expectedSubjectKeys\.push\("主体关系"\)/);
assert.match(smartAiSource, /const expectedRequirementKeys = requirementKeys\.map\(\(_, index\) => `要求\$\{index \+ 1\}`\)/);
assert.match(smartAiSource, /source\.replace\(\/\\s\+\/gu, ""\)\.length < 300/);
assert.match(smartAiSource, /validateSmartAiStructuredArtPromptSlotSemantics\(sectionEntries\)/);
assert.match(smartAiSource, /function smartAiStructuredPromptValueIsMetaInstruction\(value\)/);
assert.match(smartAiSource, /function smartAiStructuredPromptFrontValueIsCommandOrEnvelope\(value\)/);
assert.match(smartAiSource, /currentSection !== "\[用户附加要求\]"[\s\S]*?smartAiStructuredPromptFrontValueIsCommandOrEnvelope\(semanticValue\)/);
assert.match(smartAiSource, /优化结果未完整保留原提示词[\s\S]*?本次未覆盖[\s\S]*?原提示词保持不变/);
assert.match(smartAiSource, /const candidateLabels = new Set\(smartAiPromptPreservationBlocks\(candidate\)/);
assert.match(smartAiSource, /candidateLabels\.has\(label\)/);
assert.match(smartAiSource, /function isSmartAiPromptPreservationPriorityLabel\(value\)/);
assert.match(smartAiSource, /const targetedContentBlocks = expectedBlocks[\s\S]*?smartAiPromptBlockTargetedByInstruction/);
assert.match(smartAiSource, /const missingTargetedBlockLabels = targetedContentBlocks[\s\S]*?!candidateLabels\.has/);
assert.doesNotMatch(smartAiSource, /candidateCompact\.includes\(label\)/,
  "body prose must not impersonate a real preservation block label");
assert.doesNotMatch(smartAiSource, /targetCompact\.includes\(labelCompact\)|blockCompact\.includes\(targetCompact\)|labelTokens\.some/,
  "whole-block deletion must not use token or substring exemptions");
assert.match(smartAiSource, /buildStaticArtReverseRequirements\(promptMentionProtection\?\.text \?\? prompt\)/);
assert.doesNotMatch(smartAiSource, /buildStaticArtReverseSelectionSummary|当前选择摘要/);
assert.match(smartAiSource, /isSingleMainPreserveReverse = isArt[\s\S]*?&& isReverseRequest[\s\S]*?artIntent\?\.route === "static_reverse"/);

const shouldUseStructuredArtPromptContract = vm.runInNewContext(
  `(${extractNamedFunction(smartAiSource, "shouldUseStructuredArtPromptContract")})`
);
const shouldUseSimpleStructuredArtPromptContract = vm.runInNewContext(
  `(${extractNamedFunction(smartAiSource, "shouldUseSimpleStructuredArtPromptContract")})`
);
assert.equal(
  shouldUseStructuredArtPromptContract("\u4e00\u540d\u6210\u5e74\u5973\u6218\u58eb\u7ad9\u5728\u5c71\u8c37\u4e2d\uff0c\u7535\u5f71\u7ea7\u5149\u5f71\uff0c\u7ec6\u8282\u6e05\u6670\u3002"),
  false,
  "ordinary prose preserves its original format through semantic patch merging"
);
assert.equal(shouldUseStructuredArtPromptContract(""), false, "an empty prompt remains outside structured optimize");
assert.equal(shouldUseStructuredArtPromptContract("   \r\n  "), false, "whitespace-only input remains outside structured optimize");
for (const original of ["甲".repeat(120), "甲".repeat(121), "主体立于山谷\n背景为雪山", "[风格设定] 数字绘画", "【主体物品】成年女战士", "保留 __NOVAFLOW_IMAGE_01__ 资源"]) {
  assert.equal(shouldUseStructuredArtPromptContract(original), false, "ordinary prose and headings must not trigger forced recompile");
}
assert.equal(shouldUseStructuredArtPromptContract('[风格设定]\n媒介 = "水彩插画"\n[主体物品]\n主体数量 = 1\n[环境背景]\n[光线与色彩]\n[拍摄参数]\n[用户附加要求]'), true, "existing machine-structured prompts retain their contract");
assert.equal(
  shouldUseSimpleStructuredArtPromptContract("一个比基尼女牵着一条狗走在海边，二次元风格"),
  true,
  "a short single-paragraph Art prompt uses the Local lightweight detail contract"
);
assert.equal(shouldUseSimpleStructuredArtPromptContract("甲".repeat(120)), true, "the Local lightweight contract includes its exact 120-character boundary");
assert.equal(shouldUseSimpleStructuredArtPromptContract("甲".repeat(121)), false, "long Art prompts stay on the full structured compiler");
assert.equal(shouldUseSimpleStructuredArtPromptContract("主体立于山谷\n背景为雪山"), false, "multi-line prompts stay on the full structured compiler");
assert.equal(shouldUseSimpleStructuredArtPromptContract("[风格设定] 数字绘画"), false, "existing ASCII sections stay on the full structured compiler");
assert.equal(shouldUseSimpleStructuredArtPromptContract("【主体物品】成年女战士"), false, "existing full-width sections stay on the full structured compiler");
assert.equal(shouldUseSimpleStructuredArtPromptContract("保留 __NOVAFLOW_IMAGE_01__ 资源"), false, "resource-bearing prompts stay on the full structured compiler");
assert.equal(shouldUseSimpleStructuredArtPromptContract("使用 @参考图1 的姿势"), false, "readable image mentions stay on the full structured compiler");
assert.equal(shouldUseSimpleStructuredArtPromptContract("结合 @视频参考"), false, "readable video mentions stay on the full structured compiler");
assert.equal(shouldUseSimpleStructuredArtPromptContract("参考 @声音参考"), false, "readable audio mentions stay on the full structured compiler");
assert.equal(shouldUseSimpleStructuredArtPromptContract("   \r\n  "), false, "empty input never selects the Local lightweight contract");
assert.match(smartAiSource, /roleAwareReferences = isArt[\s\S]*?&& isReverseRequest[\s\S]*?artIntent\?\.route === "role_reference"/);
assert.match(smartAiSource, /artIntent\?\.route === "static_reverse"/);
assert.match(smartAiSource, /artIntent\?\.route === "role_reference"/);
assert.match(smartAiSource, /if \(artIntent && isReverseRequest && !syncArtGenerateMode\(artIntent\)\) \{[\s\S]*?无法切换生成模式[\s\S]*?return;/);
assert.match(smartAiSource, /state\.images = context\?\.surface === "art" \? images\.slice\(0, 3\) : images/);
assert.match(smartAiSource, /if \(intent\?\.imageCount > 1\) return "结合多参考图生成提示词"/);
assert.match(smartAiSource, /submit\.textContent = artAutoSubmitLabel\(intent, currentPrompt\)/);
assert.match(runtimeSource, /setMode: setArtGenerateMode,/);
assert.match(smartAiSource, /云端 · 深度处理/);

const requirementState = {
  requirements: "降低背景高光，保持主体与构图",
  context: { surface: "art", artGenerateMode: "img2img" },
  mode: "optimize",
  starterPreset: "",
  artTask: "preserve",
  artStyle: "original",
  preserveLevel: "high",
  images: [{ label: "参考图1" }],
  referenceRoles: ["subject"]
};
const stripTrailingGenericArtPreservation = vm.runInNewContext(
  `(${extractNamedFunction(smartAiSource, "stripTrailingGenericArtPreservation")})`
);
for (const { input, expected, label } of [
  {
    input: "降低背景高光，保持主体与构图",
    expected: "降低背景高光",
    label: "terminal generic preservation"
  },
  {
    input: "降低背景高光；保持主体；维持整体构图不变。",
    expected: "降低背景高光",
    label: "multiple terminal generic preservation clauses"
  },
  {
    input: "enhance material detail, keep the subject and composition unchanged",
    expected: "enhance material detail",
    label: "english terminal generic preservation"
  },
  {
    input: "增强材质，同时保持主体与构图",
    expected: "增强材质",
    label: "leading connector before generic preservation"
  },
  {
    input: "保持主体与构图，增强材质",
    expected: "增强材质",
    label: "leading generic preservation"
  },
  {
    input: "增强材质，保持主体与构图，提高光影层次",
    expected: "增强材质；提高光影层次",
    label: "middle generic preservation"
  },
  {
    input: "enhance material detail and keep the subject and composition unchanged",
    expected: "enhance material detail",
    label: "english action connector preserves internal noun conjunction"
  },
  {
    input: "保持主体与构图",
    expected: "保持主体与构图",
    label: "preservation-only intent must not become empty"
  },
  {
    input: "保持主体；维持整体构图不变",
    expected: "保持主体；维持整体构图不变",
    label: "multiple preservation-only clauses remain intact"
  },
  {
    input: "降低背景高光，保留蓝色发饰",
    expected: "降低背景高光；保留蓝色发饰",
    label: "named preservation constraint"
  },
  {
    input: "降低背景高光，不要保持原构图",
    expected: "降低背景高光；不要保持原构图",
    label: "negated preservation instruction"
  },
  {
    input: "降低背景高光，保持构图更紧凑",
    expected: "降低背景高光；保持构图更紧凑",
    label: "comparative target state"
  },
  {
    input: "降低背景高光，保持主体与构图并增强轮廓",
    expected: "降低背景高光；保持主体与构图并增强轮廓",
    label: "mixed preservation and edit action"
  }
]) {
  assert.equal(stripTrailingGenericArtPreservation(input), expected, label);
}
const buildSmartAiRequirements = vm.runInNewContext(`(${extractNamedFunction(smartAiSource, "buildSmartAiRequirements")})`, {
  state: requirementState,
  stripTrailingGenericArtPreservation,
  window: {
    NovaFlowArtQualityProfile: {
      build: ({ style, mode }) => ({ directorInstruction: `QUALITY:${style}:${mode}` })
    }
  },
  artHighQualityCgRenderingGuardInstruction: () => "QUALITY:FALLBACK",
  artAssetPreservationInstruction: () => { throw new Error("text optimization must not call image preservation rules"); },
  artAutomaticQualityInstruction: () => "AUTO-QUALITY"
});
const optimizedTextRequirements = buildSmartAiRequirements({
  includeUserIntent: true,
  userIntentFirst: true,
  purpose: "optimize"
});
assert.equal(optimizedTextRequirements.split("\n")[0], "用户本次修改要求（最高优先级）：降低背景高光");
assert.match(optimizedTextRequirements, /QUALITY:auto:txt2img/);
assert.doesNotMatch(optimizedTextRequirements, /处理目标：|图1|参考图1|保留程度：|目标风格：|背景处理|参考图职责/,
  "text optimization must not receive hidden image-derived selections or roles");

const fingerprintState = {
  context: { surface: "art", button: {} },
  mode: "optimize",
  engine: "local",
  images: [],
  artTask: "create",
  artStyle: "auto",
  backgroundMode: "replace",
  preserveLevel: "high",
  referenceRoles: [],
  targetIndex: 0,
  requirements: "降低背景高光",
  hadInitialPrompt: true
};
const fingerprintPositive = { value: "已有手写提示词" };
const buildSmartAiRequestFingerprint = vm.runInNewContext(`(${extractNamedFunction(smartAiSource, "buildSmartAiRequestFingerprint")})`, {
  state: fingerprintState,
  getPromptTextareasFromContext: () => ({ positive: fingerprintPositive, negative: { value: "低质量" } }),
  readArtGenerateNsfw: () => false,
  deriveArtAutoIntent: () => ({
    route: fingerprintState.images.length ? "static_reverse" : "optimize",
    generationMode: fingerprintState.images.length ? "img2img" : "txt2img"
  }),
  readSmartAiLiveImageSignature: () => fingerprintState.images.map((item) => item.imageUrl).join("|"),
  smartAiReferenceFingerprint: (value) => String(value || ""),
  MINIMAX_H3_MODEL_ID: "minimax_h3_local",
  MINIMAX_H3_VISUAL_SCHEMA: "nf.h3.visual.v1",
  miniMaxH3ContentPolicy: () => null
});
const textFingerprintBeforeImages = buildSmartAiRequestFingerprint({ ignoreArtReferenceState: true });
const visualFingerprintBeforeImages = buildSmartAiRequestFingerprint();
fingerprintState.images = [{ imageUrl: "data:image/png;base64,REF" }];
fingerprintState.artTask = "preserve";
fingerprintState.artStyle = "original";
fingerprintState.referenceRoles = ["subject"];
const textFingerprintAfterImages = buildSmartAiRequestFingerprint({ ignoreArtReferenceState: true });
const visualFingerprintAfterImages = buildSmartAiRequestFingerprint();
assert.equal(textFingerprintAfterImages, textFingerprintBeforeImages,
  "text optimization freshness must ignore images and their derived Art state");
assert.notEqual(visualFingerprintAfterImages, visualFingerprintBeforeImages,
  "image reverse freshness must continue tracking reference changes");

async function verifyArtModeDefaultsAfterImageRefresh() {
  let currentPrompt = "已有手写提示词";
  let collectedImages = [{ imageUrl: "data:image/png;base64,AA", label: "参考图1" }];
  const refreshState = {
    context: { surface: "art", button: {} },
    open: true,
    images: [],
    imagesLoading: false,
    imageRefreshEpoch: 0,
    artModeTouched: false,
    mode: "reverse",
    targetIndex: 0,
    message: ""
  };
  const refreshContext = vm.createContext({
    state: refreshState,
    MINIMAX_H3_MODEL_ID: "minimax_h3_local",
    collectArtImages: async () => collectedImages,
    collectAnimationImages: async () => [],
    getPromptTextareasFromContext: () => ({ positive: { value: currentPrompt } }),
    syncArtAutoIntent: () => ({}),
    renderDialog: () => {}
  });
  const refreshSource = extractNamedFunction(smartAiSource, "refreshImageContext")
    .replace(/^function /, "async function ");
  const refreshImageContext = vm.runInContext(`(${refreshSource})`, refreshContext);

  await refreshImageContext();
  assert.equal(refreshState.mode, "optimize", "a live prompt must win over reference presence in the automatic default");

  currentPrompt = "";
  refreshState.artModeTouched = false;
  await refreshImageContext();
  assert.equal(refreshState.mode, "reverse", "an image-only request must default to image reverse after references finish loading");

  refreshState.mode = "optimize";
  refreshState.artModeTouched = true;
  await refreshImageContext();
  assert.equal(refreshState.mode, "optimize", "an explicit optimize selection must survive asynchronous image refresh");

  currentPrompt = "后来补写的提示词";
  refreshState.mode = "reverse";
  refreshState.artModeTouched = true;
  await refreshImageContext();
  assert.equal(refreshState.mode, "reverse", "an explicit reverse selection must survive later live-prompt changes");

  currentPrompt = "";
  collectedImages = [];
  refreshState.artModeTouched = false;
  await refreshImageContext();
  assert.equal(refreshState.mode, "optimize", "an empty prompt without a usable image must fall back to text creation");

  let resolveOldImages;
  const oldContext = { surface: "art", button: { id: "old" } };
  const newContext = { surface: "art", button: { id: "new" } };
  refreshContext.collectArtImages = async (button) => button.id === "old"
    ? new Promise((resolve) => { resolveOldImages = resolve; })
    : [{ imageUrl: "data:image/png;base64,NEW", label: "新参考图" }];
  currentPrompt = "";
  refreshState.context = oldContext;
  refreshState.artModeTouched = false;
  refreshState.mode = "reverse";
  const oldRefresh = refreshImageContext();
  refreshState.context = newContext;
  const newRefresh = refreshImageContext();
  await newRefresh;
  assert.equal(refreshState.images[0].label, "新参考图");
  resolveOldImages([{ imageUrl: "data:image/png;base64,OLD", label: "旧参考图" }]);
  await oldRefresh;
  assert.equal(refreshState.images[0].label, "新参考图",
    "a stale image read must not overwrite a later dialog context");
  assert.equal(refreshState.imagesLoading, false);

  refreshContext.collectArtImages = async () => { throw new Error("decode failed"); };
  refreshState.context = { surface: "art", button: { id: "broken" } };
  refreshState.mode = "reverse";
  refreshState.artModeTouched = false;
  await refreshImageContext();
  assert.equal(refreshState.mode, "optimize", "a failed image read must recover to text creation instead of trapping the dialog in reverse");
  assert.equal(refreshState.images.length, 0);
}

verifyArtModeDefaultsAfterImageRefresh().then(() => {
  console.log("smart-ai-simple-dialog-contract: passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
