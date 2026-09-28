const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..");
const serverPath = path.join(root, "particle-editor-desktop", "admin-server", "server.js");
const mainPath = path.join(root, "particle-editor-desktop", "main.js");
const servicePath = path.join(root, "particle-editor-desktop", "prompt-assistant-service.py");
const previewPath = path.join(root, "tools", "preview_runtime_server.py");
const promptWorkflowPath = path.join(root, "novaflow-web", "renderer", "ai-sequence-minimax-h3-prompt.workflow.js");
const reverseWorkflowPath = path.join(root, "novaflow-web", "renderer", "ai-sequence-minimax-h3-reverse.workflow.js");
const serverSource = fs.readFileSync(serverPath, "utf8");
const mainSource = fs.readFileSync(mainPath, "utf8");
const promptWorkflowSource = fs.readFileSync(promptWorkflowPath, "utf8");
const reverseWorkflowSource = fs.readFileSync(reverseWorkflowPath, "utf8");

function loadWorkflowModule(source, filename, dependency = null) {
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
  vm.runInNewContext(source, context, { filename });
  return context.module.exports;
}

const promptWorkflow = loadWorkflowModule(promptWorkflowSource, promptWorkflowPath);
const reverseWorkflow = loadWorkflowModule(reverseWorkflowSource, reverseWorkflowPath, promptWorkflow);
const emptyPromptReverseRequest = reverseWorkflow.prepareRequest({
  modelId: "minimax_h3_local",
  mode: "image_video",
  durationSeconds: 5,
  prompt: "",
  requirements: "Keep visible identity stable",
  resources: [{
    key: "first_frame",
    occupied: true,
    kind: "image",
    identity: "empty-prompt-first-frame",
    sourceId: "empty-prompt-first-frame",
    dataUrl: "data:image/png;base64,aGVsbG8=",
    fileName: "first_frame.png",
    mimeType: "image/png",
  }],
}).request;
assert.equal(emptyPromptReverseRequest.preferredOutputLanguage, "zh-CN");
assert.match(emptyPromptReverseRequest.currentPrompt, /Use <Picture 1> as the exact opening frame/);

function extractNamedFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name} must exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
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
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name} body is incomplete`);
}

function extractNamedConstExpression(source, name) {
  const match = source.match(new RegExp(`const ${name} = (.+);`));
  assert.ok(match?.[1], `${name} must exist`);
  return match[1];
}

const protocolRules = vm.runInNewContext(
  `(${extractNamedFunction(serverSource, "miniMaxH3PromptProtocolRules")})`,
);
const protocolText = protocolRules();
const baseFields = [
  "integrated_multimodal_description",
  "overall_soundscape",
  "non_diegetic_music",
];
const referenceFields = [
  "subject_definitions",
  "summary",
  "retention_analysis",
  "detailed_description",
  "overall_soundscape",
  "non_diegetic_music",
];
for (const fields of [baseFields, referenceFields]) {
  let cursor = -1;
  for (const field of fields) {
    const next = protocolText.indexOf(field, cursor + 1);
    assert.ok(next > cursor, `${field} must appear in H3 protocol order`);
    cursor = next;
  }
}
assert.match(protocolText, /T2VA[\s\S]*?I2VA[\s\S]*?FL2VA[\s\S]*?L2VA[\s\S]*?Ref2VA/);
assert.match(protocolText, /<Subject N>[\s\S]*?<Picture N>[\s\S]*?<Video N>[\s\S]*?<Audio N>/);

const fieldsAreOrdered = vm.runInNewContext(
  `(${extractNamedFunction(serverSource, "miniMaxH3PromptFieldsAreOrdered")})`,
);
const normalizeCloudH3Output = vm.runInNewContext(
  `(${extractNamedFunction(serverSource, "normalizeMiniMaxH3PromptOutput")})`,
  {
    normalizeGeneratedPrompt: (value) => String(value || "").trim(),
    parseSmartAiPromptJson: (value) => {
      try { return JSON.parse(value); } catch { return null; }
    },
    readPromptResultString: (source, keys) => {
      for (const key of keys) if (typeof source?.[key] === "string") return source[key];
      return "";
    },
    miniMaxH3PromptFieldsAreOrdered: fieldsAreOrdered,
    MINIMAX_H3_BASE_PROMPT_FIELDS: baseFields,
    MINIMAX_H3_REFERENCE_PROMPT_FIELDS: referenceFields,
    MINIMAX_H3_CONTENT_POLICY_BLOCK_MARKER: "H3_CONTENT_POLICY_BLOCKED",
    MINIMAX_H3_CAMERA_DIRECTION_PATTERN: vm.runInNewContext(
      extractNamedConstExpression(serverSource, "MINIMAX_H3_CAMERA_DIRECTION_PATTERN"),
    ),
    MINIMAX_H3_ACTION_PROGRESSION_PATTERN: vm.runInNewContext(
      extractNamedConstExpression(serverSource, "MINIMAX_H3_ACTION_PROGRESSION_PATTERN"),
    ),
    miniMaxH3ContractError: (code, message) => Object.assign(new Error(message), {
      statusCode: 502,
      errorCode: code,
      minimaxH3ContractInvalid: code.startsWith("h3_contract_")
    }),
    miniMaxH3PromptFieldValue: vm.runInNewContext(
      `(${extractNamedFunction(serverSource, "miniMaxH3PromptFieldValue")})`,
    ),
    miniMaxH3ValidateTimeline: () => {},
    Error,
  },
);
const normalizedCloudPrompt = normalizeCloudH3Output(JSON.stringify({
  prompt: "integrated_multimodal_description: [Shot 1] A subject moves while the camera tracks continuously.\noverall_soundscape: Footsteps.\nnon_diegetic_music: N/A",
  negative_prompt: "must not survive",
}));
assert.match(normalizedCloudPrompt, /^integrated_multimodal_description:/);
assert.doesNotMatch(normalizedCloudPrompt, /must not survive|negative_prompt/);
for (const negativeSection of [
  "- negative_prompt: must not survive",
  "**negative_prompt:** must not survive",
  "- **negative prompt:** must not survive",
  "### **负向提示词：** 不得保留",
]) {
  const cleaned = normalizeCloudH3Output([
    "integrated_multimodal_description: [Shot 1] A subject moves while the camera tracks continuously.",
    "overall_soundscape: Footsteps.",
    "non_diegetic_music: N/A",
    negativeSection,
  ].join("\n"));
  assert.doesNotMatch(cleaned, /negative[ _-]*prompt|负向提示词|must not survive|不得保留/i);
}
assert.throws(() => normalizeCloudH3Output("unstructured response"), /required fields in order/);

const requirementsLimit = vm.runInNewContext(
  `(${extractNamedFunction(mainSource, "promptAssistantOptimizeRequirementsLimit")})`,
);
assert.equal(requirementsLimit("minimax-h3-prompt-enhance"), 12000);
assert.equal(requirementsLimit("MINIMAX_H3_PROMPT_ENHANCE"), 12000);
assert.equal(requirementsLimit("optimize"), 2000);
const mainOptimizeHandler = mainSource.match(
  /ipcMain\.handle\("prompt-assistant-optimize-prompt"[\s\S]*?\n\}\);\r?\n/,
)?.[0] || "";
assert.match(mainOptimizeHandler, /slice\(0, promptAssistantOptimizeRequirementsLimit\(purpose\)\)/);
const mainReverseHandler = mainSource.match(
  /ipcMain\.handle\("prompt-assistant-reverse-image-prompt"[\s\S]*?\n\}\);\r?\n/,
)?.[0] || "";
assert.match(mainReverseHandler, /preferredOutputLanguageValue[\s\S]*?preferredOutputLanguage[\s\S]*?requestPromptAssistant/);
assert.match(mainReverseHandler, /usesMiniMaxH3Reverse[\s\S]*?visualSchema !== "nf\.h3\.visual\.v1"[\s\S]*?throw new Error/);
assert.match(mainReverseHandler, /requires explicit userPrompt and userRequirements fields/);
assert.match(mainReverseHandler, /usesMiniMaxH3VisualV1 \? \{\s*userPrompt, userRequirements,\s*h3Mode: payload\?\.h3Mode,\s*durationSeconds: payload\?\.durationSeconds\s*\} : \{\}/);

const buildRequest = vm.runInNewContext(
  `(${extractNamedFunction(serverSource, "buildGrokPromptOptimizeRequest")})`,
  {
    h3PromptEnhance: require('../admin-server/h3-prompt-enhance'),
    isMiniMaxH3PromptEnhancePayload: (payload) => payload?.purpose === "minimax-h3-prompt-enhance",
    smartAiSupportsNegativePrompt: () => true,
    isSmartAiAnimationPayload: () => false,
    smartAiCurrentPrompt: (payload) => String(payload?.currentPrompt || payload?.prompt || "").trim(),
    normalizeSmartAiText: (value, limit = 20000) => String(value || "").trim().slice(0, limit),
    smartAiPayloadPurpose: (payload) => String(payload?.purpose || "").toLowerCase(),
    miniMaxH3PromptEnhanceUserRequirement: (requirements) => requirements,
    miniMaxH3PromptProtocolRules: protocolRules,
    miniMaxH3PromptEnhanceDurationFromText: vm.runInNewContext(
      `(${extractNamedFunction(serverSource, "miniMaxH3PromptEnhanceDurationFromText")})`,
      {
        normalizeSmartAiText: (value, limit = 12000) => String(value || "").trim().slice(0, limit),
      },
    ),
    miniMaxH3RequestedDuration: vm.runInNewContext(
      `(${extractNamedFunction(serverSource, "miniMaxH3RequestedDuration")})`,
      {
        normalizeSmartAiText: (value, limit = 12000) => String(value || "").trim().slice(0, limit),
      },
    ),
    miniMaxH3ContentContract: () => ({
      visualSchema: "nf.h3.visual.v1",
      contentPolicy: { sensitiveVisualAnalysis: false, allSubjectsConfirmedAdult: false },
    }),
    miniMaxH3EnhanceMode: () => "full_reference",
    miniMaxH3ValidateRawUserContent: () => ({ hasExplicitYouth: false, hasSensitiveRequest: false, sensitiveCategories: [] }),
    miniMaxH3OptimizeSafetyRules: vm.runInNewContext(
      `(${extractNamedFunction(serverSource, "miniMaxH3OptimizeSafetyRules")})`,
      {
        MINIMAX_H3_CONTENT_POLICY_BLOCK_MARKER: "H3_CONTENT_POLICY_BLOCKED",
        MINIMAX_H3_FAITHFUL_PICTURE_RULE: vm.runInNewContext(extractNamedConstExpression(serverSource, "MINIMAX_H3_FAITHFUL_PICTURE_RULE")),
      },
    ),
    miniMaxH3OptimizeFrameContent: vm.runInNewContext(
      `(${extractNamedFunction(serverSource, "miniMaxH3OptimizeFrameContent")})`,
      {
        h3PromptEnhance: require('../admin-server/h3-prompt-enhance'),
        smartAiInputText: (text) => ({ type: "input_text", text }),
      },
    ),
    smartAiImageArtDirectorRules: () => "generic image rules",
    smartAiChinesePromptOutputRules: () => "generic output rules",
    smartAiInputText: (text) => ({ type: "input_text", text }),
    adminData: { readAdminGrokEnv: () => ({ model: "grok-test" }) },
    MINIMAX_H3_PROMPT_MAX_OUTPUT_TOKENS: 4096,
  },
);
const cloud = buildRequest({
  prompt: "stale prompt",
  currentPrompt: "current H3 prompt",
  negativePrompt: "must not reach H3",
  requirements: "Ref2VA; duration 8 seconds; use <Picture 1> and <Audio 1>",
  purpose: "minimax-h3-prompt-enhance",
  surface: "animation",
  provider: "grok",
});
assert.equal(cloud.body.max_output_tokens, 4096);
assert.equal(cloud.body.temperature, 0.35);
assert.equal(cloud.inputMeta.mode, "minimax_h3_prompt_enhance");
assert.equal(cloud.inputMeta.supportsNegativePrompt, false);
assert.equal(cloud.inputMeta.hasNegativePrompt, false);
assert.equal(cloud.inputMeta.purpose, "minimax-h3-prompt-enhance");
assert.equal(cloud.inputMeta.surface, "animation");
assert.equal(cloud.inputMeta.provider, "grok");
assert.equal(cloud.resultOptions.minimaxH3Prompt, true);
assert.equal(cloud.resultOptions.visualRetryAllowed, true);
assert.equal(cloud.resultOptions.currentPrompt, "current H3 prompt");
assert.equal(cloud.resultOptions.durationSeconds, 8);
assert.equal(cloud.resultOptions.supportsNegativePrompt, false);
const cloudUserText = cloud.body.input[1].content[0].text;
assert.match(cloudUserText, /currentPrompt:\s*current H3 prompt/);
assert.match(cloudUserText, /requirements:[\s\S]*?<Picture 1>[\s\S]*?<Audio 1>/);
assert.doesNotMatch(cloudUserText, /must not reach H3/);
const longCloud = buildRequest({
  prompt: "H3 prompt",
  requirements: "R".repeat(13000),
  purpose: "minimax-h3-prompt-enhance",
});
assert.equal(longCloud.inputMeta.charCount, "H3 prompt".length + 13000);

const pythonProbe = String.raw`
import importlib.util
import json
import pathlib
import runpy
import sys

service_path = pathlib.Path(sys.argv[1]).resolve()
preview_path = pathlib.Path(sys.argv[2]).resolve()
sys.path.insert(0, str(service_path.parent))
service = runpy.run_path(str(service_path))
workflow_empty_reverse_request = json.loads(sys.argv[3])
assert workflow_empty_reverse_request["preferredOutputLanguage"] == "zh-CN"
assert "Use <Picture 1> as the exact opening frame" in workflow_empty_reverse_request["currentPrompt"]

expected_initial_budgets = {
    "T2VA": 384,
    "I2VA": 512,
    "FL2VA": 512,
    "L2VA": 512,
    "REF2VA": 768,
}
expected_repair_budgets = {
    "T2VA": 256,
    "I2VA": 384,
    "FL2VA": 384,
    "L2VA": 384,
    "REF2VA": 512,
}
for mode, expected in expected_initial_budgets.items():
    assert service["minimax_h3_prompt_max_length"](mode) == expected
for mode, expected in expected_repair_budgets.items():
    assert service["minimax_h3_prompt_max_length"](mode, repair=True) == expected
assert service["minimax_h3_prompt_max_length"]("") == service["MINIMAX_H3_PROMPT_MAX_LENGTH"]
assert service["minimax_h3_prompt_max_length"]("unknown", repair=True) == service["MINIMAX_H3_PROMPT_REPAIR_MAX_LENGTH"]

class FakeProfileAdapter:
    last_generation_diagnostics = {}
    def generate_parts(self, parts, **kwargs):
        self.last_generation_diagnostics = {"generatedTokens": 3, "generationHitTokenLimit": True}
        return "decoded output"

profile_assistant = service["PromptAssistant"]()
profile_assistant._qwen3_adapter = FakeProfileAdapter()
assert profile_assistant.generate("profile", max_length=3, trace_label="budgetProfile") == "decoded output"
assert profile_assistant.last_generate_profile["generatedTokenCount"] == 3
assert profile_assistant.last_generate_profile["hitTokenLimit"] is True

# Five-section optimizer behavior and repair are tested in test_h3_prompt_enhancement.py
# and h3-five-sections.test.mjs; the remainder covers legacy reverse projection.

base_output = """integrated_multimodal_description: [Shot 1] A subject begins moving while Camera holds stable framing.\noverall_soundscape: Footsteps.\nnon_diegetic_music: N/A"""
shotless_output = """integrated_multimodal_description: A subject begins moving while Camera holds stable framing.\noverall_soundscape: Footsteps.\nnon_diegetic_music: N/A"""
completed_t2v = service["complete_minimax_h3_mechanical_contract"](shotless_output, "T2VA", 5)
assert completed_t2v.startswith("integrated_multimodal_description: [Shot 1] A subject begins moving while Camera holds stable framing.")
assert service["validate_minimax_h3_prompt_contract"](completed_t2v, "T2VA", 5) == completed_t2v
completed_i2v = service["complete_minimax_h3_mechanical_contract"](shotless_output, "I2VA", 5)
assert "integrated_multimodal_description: [Shot 1] <Picture 1>" in completed_i2v
assert "0.00 seconds" in completed_i2v.splitlines()[0]
assert service["validate_minimax_h3_prompt_contract"](completed_i2v, "I2VA", 5) == completed_i2v
completed_fl2v = service["complete_minimax_h3_mechanical_contract"](shotless_output, "FL2VA", 8)
assert completed_fl2v.startswith("Reference alignment - <Picture 1> from [Shot 1] = 0.00 seconds; <Picture 2> from [Shot 1] = 8.00 seconds")
assert "[Shot 2]" not in completed_fl2v
assert "Motion resolves into the exact ending frame <Picture 2> at 8.00 seconds." in completed_fl2v
assert service["validate_minimax_h3_prompt_contract"](completed_fl2v, "FL2VA", 8) == completed_fl2v
zh_shotless_output = """integrated_multimodal_description: 人物从静止姿态开始抬手，镜头保持稳定。\noverall_soundscape: 轻微衣料摩擦声。\nnon_diegetic_music: 柔和背景音乐。"""
completed_zh_t2v = service["complete_minimax_h3_mechanical_contract"](zh_shotless_output, "T2VA", 5, "zh-CN")
assert completed_zh_t2v.startswith("integrated_multimodal_description: [Shot 1] 人物从静止姿态开始抬手，镜头保持稳定。")
completed_zh_i2v = service["complete_minimax_h3_mechanical_contract"](zh_shotless_output, "I2VA", 5, "zh-CN")
assert "[Shot 1] <Picture 1> 是 0.00 秒时提供的精确首帧" in completed_zh_i2v
assert "exact supplied opening frame" not in completed_zh_i2v
completed_zh_fl2v = service["complete_minimax_h3_mechanical_contract"](zh_shotless_output, "FL2VA", 8, "zh-CN")
assert completed_zh_fl2v.startswith("参考帧对齐：<Picture 1> 对应 [Shot 1] = 0.00 秒；<Picture 2> 对应 [Shot 1] = 8.00 秒")
assert "[Shot 2]" not in completed_zh_fl2v
assert "动作在 8.00 秒连续抵达 <Picture 2> 的精确尾帧状态。" in completed_zh_fl2v
assert "Reference alignment" not in completed_zh_fl2v
assert "motion resolves continuously" not in completed_zh_fl2v
incomplete_output = """integrated_multimodal_description: Incomplete protocol.\noverall_soundscape: N/A"""
assert service["complete_minimax_h3_mechanical_contract"](incomplete_output, "T2VA", 5) == incomplete_output
for negative_section in (
    "- negative_prompt: must not survive",
    "**negative_prompt:** must not survive",
    "- **negative prompt:** must not survive",
    "### **负向提示词：** 不得保留",
):
    cleaned = service["normalize_minimax_h3_prompt_output"](base_output + "\n" + negative_section)
    assert "must not survive" not in cleaned
    assert "不得保留" not in cleaned
    assert "negative_prompt" not in cleaned
    assert "负向提示词" not in cleaned

reference_output = """subject_definitions: <Subject 1> is established by <Picture 1>.\nsummary: [reference generation] The target uses <Subject 1>.\nretention_analysis: <Subject 1>: fully_preserved.\ndetailed_description: [Shot 1] The subject moves through the scene while Camera holds stable framing.\noverall_soundscape: Synchronized ambience.\nnon_diegetic_music: N/A"""
assert service["normalize_minimax_h3_prompt_output"](reference_output) == service["format_minimax_h3_prompt_layout"](reference_output)
validated_reference_output = service["validate_minimax_h3_prompt_contract"](reference_output, "Ref2VA", 5)
assert "<Subject 1>: subject described by the generated prompt narrative." in validated_reference_output
assert "detailed_description: [Shot 1] The subject moves through the scene while Camera holds stable framing." in validated_reference_output
try:
    service["normalize_minimax_h3_prompt_output"]("plain prose without H3 fields")
    raise AssertionError("invalid H3 output must fail")
except ValueError:
    pass

service["PromptAssistant"].reverse_image_prompt.__globals__["data_url_to_tensor"] = lambda data_url: data_url

for invalid_schema in (None, "", "nf.h3.visual.v0"):
    invalid_payload = {
        "purpose": "minimax-h3-i2v-reverse",
        "surface": "animation",
        "currentPrompt": "compiled prompt",
        "requirements": "duration 5 seconds",
        "userPrompt": "",
        "userRequirements": "",
        "images": [{"dataUrl": "first-image", "role": "first_frame"}],
    }
    if invalid_schema is not None:
        invalid_payload["visualSchema"] = invalid_schema
    try:
        service["PromptAssistant"]().reverse_image_prompt(invalid_payload)
        raise AssertionError("H3 reverse without the exact visual schema must fail closed")
    except service["VisualContractError"]:
        pass

def h3_reverse_request(payload):
    value = dict(payload)
    value["visualSchema"] = "nf.h3.visual.v1"
    value["contentPolicy"] = {
        "sensitiveVisualAnalysis": False,
        "allSubjectsConfirmedAdult": False,
    }
    value["userPrompt"] = str(value.get("currentPrompt") or "")
    value["userRequirements"] = ""
    return value

class FakeH3VisualAdapter:
    def __init__(self, *_args, **_kwargs): pass
    def readiness(self): return {"available": True, "code": "ready"}
    def generate(self, _prompt, _image, **_kwargs):
        return """[风格设定]
媒介 = "digital painting"
绘画语言 = "clean animated rendering"
氛围 = "quiet indoor scene"
完成质感 = "clear material detail"

[主体物品]
主体1 = "person with stable identity"
主体1姿势 = "standing"
主体1动作 = "moving naturally"

[环境背景]
环境类型 = "room"
背景结构 = "stable interior background"

[光线与色彩]
光源软硬 = "soft light"
主辅色 = "neutral palette"

[拍摄参数]
景别 = "medium shot"
视角 = "eye level"
构图 = "centered composition"""
    def unload(self): pass

service["PromptAssistant"].reverse_minimax_h3_prompt.__globals__["Qwen3VLAbliteratedAdapter"] = FakeH3VisualAdapter
service["PromptAssistant"].reverse_minimax_h3_prompt.__globals__["validate_minimax_h3_visual_fact_coverage"] = lambda text, _contracts, _sensitive, _request_text, **_kwargs: text
i2v_assistant = service["PromptAssistant"]()
i2v_calls = []

def fake_i2v_generate(prompt, **kwargs):
    i2v_calls.append((prompt, kwargs))
    return """integrated_multimodal_description: <Picture 1> from [Shot 1] = 0.00 seconds; the subject begins moving from the supplied composition while Camera holds stable framing.\noverall_soundscape: Synchronized room tone and movement.\nnon_diegetic_music: N/A"""

i2v_assistant.generate = fake_i2v_generate
i2v_result = i2v_assistant.reverse_image_prompt(h3_reverse_request({
    "purpose": "minimax-h3-i2v-reverse",
    "surface": "animation",
    "currentPrompt": "The subject walks forward",
    "requirements": "duration 5 seconds",
    "images": [{"dataUrl": "first-image", "role": "firstFrame"}],
}))
assert len(i2v_calls) == 0
assert i2v_result["negativePrompt"] == ""
assert i2v_result["reverseProvider"] == "qwen3_vl_abliterated_nf4+deterministic_h3"
assert i2v_result["positivePrompt"].startswith("Reference alignment -")
assert "<Picture 1>" in i2v_result["positivePrompt"]

zh_i2v_assistant = service["PromptAssistant"]()
zh_i2v_calls = []

def fake_zh_i2v_generate(prompt, **kwargs):
    zh_i2v_calls.append((prompt, kwargs))
    return """integrated_multimodal_description: 人物保持首帧身份与构图，随后自然向前迈步，镜头保持稳定。\noverall_soundscape: 脚步声与环境声同步。\nnon_diegetic_music: 柔和背景音乐。"""

zh_i2v_assistant.generate = fake_zh_i2v_generate
zh_i2v_result = zh_i2v_assistant.reverse_image_prompt(h3_reverse_request({
    "purpose": "minimax-h3-i2v-reverse",
    "surface": "animation",
    "currentPrompt": "人物保持身份并自然向前迈步",
    "requirements": "duration 5 seconds",
    "images": [{"dataUrl": "first-image", "role": "first_frame"}],
}))
assert len(zh_i2v_calls) == 0
assert zh_i2v_result["positivePrompt"].startswith("参考帧对齐：")
assert all(token in zh_i2v_result["positivePrompt"].splitlines()[0] for token in ("[Shot 1]", "<Picture 1>", "0.00 秒"))

zh_default_i2v_assistant = service["PromptAssistant"]()
zh_default_i2v_calls = []

def fake_zh_default_i2v_generate(prompt, **kwargs):
    zh_default_i2v_calls.append((prompt, kwargs))
    return """integrated_multimodal_description: 人物保持参考图中的身份、构图与材质，并自然开始动作，镜头保持稳定。\noverall_soundscape: 动作声与环境声同步。\nnon_diegetic_music: 柔和背景音乐。"""

zh_default_i2v_assistant.generate = fake_zh_default_i2v_generate
zh_default_i2v_result = zh_default_i2v_assistant.reverse_image_prompt(workflow_empty_reverse_request)
assert len(zh_default_i2v_calls) == 0
assert zh_default_i2v_result["positivePrompt"].startswith("参考帧对齐：")
assert "<Picture 1>" in zh_default_i2v_result["positivePrompt"]

fl2v_assistant = service["PromptAssistant"]()
fl2v_calls = []

def fake_fl2v_generate(prompt, **kwargs):
    fl2v_calls.append((prompt, kwargs))
    return """integrated_multimodal_description: <Picture 1> from [Shot 1] = 0.00 seconds; <Picture 2> from [Shot 2] At 00:08.000, = 8.00 seconds; motion resolves continuously between both anchors while Camera holds stable framing.\noverall_soundscape: Synchronized ambience and movement.\nnon_diegetic_music: N/A"""

fl2v_assistant.generate = fake_fl2v_generate
fl2v_result = fl2v_assistant.reverse_image_prompt(h3_reverse_request({
    "purpose": "minimax-h3-fl2v-reverse",
    "surface": "animation",
    "currentPrompt": "Transition continuously between both anchors",
    "requirements": "duration 8 seconds",
    "images": [
        {"dataUrl": "last-image", "slotType": "last_frame"},
        {"dataUrl": "first-image", "slotType": "first_frame"},
    ],
}))
assert len(fl2v_calls) == 0
assert fl2v_result["negativePrompt"] == ""
assert fl2v_result["positivePrompt"].startswith("Reference alignment -")
assert "<Picture 1>" in fl2v_result["positivePrompt"]
assert "<Picture 2>" in fl2v_result["positivePrompt"]

zh_fl2v_assistant = service["PromptAssistant"]()
zh_fl2v_calls = []

def fake_zh_fl2v_generate(prompt, **kwargs):
    zh_fl2v_calls.append((prompt, kwargs))
    return """integrated_multimodal_description: 人物从首帧姿态连续转身并平稳抵达尾帧姿态，镜头保持稳定。\noverall_soundscape: 动作声与环境声连续同步。\nnon_diegetic_music: 柔和背景音乐。"""

zh_fl2v_assistant.generate = fake_zh_fl2v_generate
zh_fl2v_result = zh_fl2v_assistant.reverse_image_prompt(h3_reverse_request({
    "purpose": "minimax-h3-fl2v-reverse",
    "surface": "animation",
    "currentPrompt": "人物从首帧连续转身并抵达尾帧",
    "requirements": "duration 8 seconds",
    "images": [
        {"dataUrl": "first-image", "role": "first_frame"},
        {"dataUrl": "last-image", "role": "last_frame"},
    ],
}))
assert len(zh_fl2v_calls) == 0
assert zh_fl2v_result["positivePrompt"].startswith("参考帧对齐：")
assert all(token in zh_fl2v_result["positivePrompt"].splitlines()[0] for token in ("<Picture 1>", "<Picture 2>", "[Shot 1]", "8.00"))
assert "[Shot 2]" not in zh_fl2v_result["positivePrompt"]

reverse_repair_assistant = service["PromptAssistant"]()
reverse_repair_calls = []
reverse_repair_outputs = iter((
    """integrated_multimodal_description: <Picture 1> is visible but the shot marker is missing.\noverall_soundscape: N/A\nnon_diegetic_music: N/A""",
    """integrated_multimodal_description: <Picture 1> from [Shot 1] = 0.00 seconds; the subject begins moving while Camera holds stable framing.\noverall_soundscape: Synchronized movement.\nnon_diegetic_music: N/A""",
))

def fake_reverse_repair_generate(prompt, **kwargs):
    reverse_repair_calls.append((prompt, kwargs))
    return next(reverse_repair_outputs)

reverse_repair_assistant.generate = fake_reverse_repair_generate
reverse_repaired = reverse_repair_assistant.reverse_image_prompt(h3_reverse_request({
    "purpose": "minimax-h3-i2v-reverse",
    "surface": "animation",
    "currentPrompt": "The subject moves",
    "requirements": "duration 5 seconds",
    "images": [{"dataUrl": "first-image", "role": "first_frame"}],
}))
assert "[Shot 1]" in reverse_repaired["positivePrompt"]
assert len(reverse_repair_calls) == 0
assert all(token in reverse_repaired["positivePrompt"].splitlines()[0] for token in ("<Picture 1>", "[Shot 1]", "0.00"))

reverse_failed_assistant = service["PromptAssistant"]()
reverse_failed_calls = []

def fake_reverse_failed_generate(prompt, **kwargs):
    reverse_failed_calls.append((prompt, kwargs))
    return """integrated_multimodal_description: Incomplete protocol.\noverall_soundscape: N/A"""

reverse_failed_assistant.generate = fake_reverse_failed_generate
reverse_fallback = reverse_failed_assistant.reverse_image_prompt(h3_reverse_request({
    "purpose": "minimax-h3-fl2v-reverse",
    "surface": "animation",
    "currentPrompt": "Transition between both anchors",
    "requirements": "duration 8 seconds",
    "images": [
        {"dataUrl": "first-image", "role": "first_frame"},
        {"dataUrl": "last-image", "role": "last_frame"},
    ],
}))
assert all(token in reverse_fallback["positivePrompt"] for token in ("<Picture 1>", "<Picture 2>", "[Shot 1]", "8.00"))
assert "[Shot 2]" not in reverse_fallback["positivePrompt"]
assert service["MINIMAX_H3_ACTION_PROGRESSION_PATTERN"].search(reverse_fallback["positivePrompt"])
assert service["MINIMAX_H3_CAMERA_DIRECTION_PATTERN"].search(reverse_fallback["positivePrompt"])
assert len(reverse_failed_calls) == 0

spec = importlib.util.spec_from_file_location("novaflow_preview_h3_contract", preview_path)
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)
forwarded = preview._prompt_assistant_optimize_payload({
    "prompt": "compiled prompt",
    "negativePrompt": "legacy negative",
    "purpose": "minimax-h3-prompt-enhance",
    "surface": "animation",
    "requirements": "H3 field protocol",
    "currentPrompt": "current surface prompt",
    "provider": "grok",
    "h3Mode": "first_last",
    "durationSeconds": 4,
    "visualSchema": "nf.h3.visual.v1",
})
assert forwarded == {
    "prompt": "compiled prompt",
    "negativePrompt": "legacy negative",
    "supportsNegativePrompt": True,
    "purpose": "minimax-h3-prompt-enhance",
    "surface": "animation",
    "requirements": "H3 field protocol",
    "currentPrompt": "current surface prompt",
    "provider": "grok",
    "nsfw": False,
    "h3Mode": "first_last",
    "durationSeconds": 4,
    "visualSchema": "nf.h3.visual.v1",
}
forwarded_simple_art = preview._prompt_assistant_optimize_payload({
    "prompt": "一个比基尼女牵着一条狗走在海边，二次元风格",
    "currentPrompt": "一个比基尼女牵着一条狗走在海边，二次元风格",
    "promptSchema": "nf.art.prompt.v1",
    "promptDetailMode": "simple-structured-v1",
    "purpose": "optimize",
    "surface": "art",
})
assert forwarded_simple_art["promptSchema"] == "nf.art.prompt.v1"
assert forwarded_simple_art["promptDetailMode"] == "simple-structured-v1"
forwarded_nonlocal_detail = preview._prompt_assistant_optimize_payload({
    "prompt": "一个比基尼女牵着一条狗走在海边，二次元风格",
    "currentPrompt": "一个比基尼女牵着一条狗走在海边，二次元风格",
    "promptSchema": "nf.art.prompt.v1",
    "promptDetailMode": "simple-structured-v1",
    "purpose": "optimize",
    "surface": "art",
    "provider": "gpt",
})
assert forwarded_nonlocal_detail["promptSchema"] == "nf.art.prompt.v1"
assert "promptDetailMode" not in forwarded_nonlocal_detail
forwarded_invalid_detail = preview._prompt_assistant_optimize_payload({
    "prompt": "short prompt",
    "currentPrompt": "short prompt",
    "promptDetailMode": "simple-structured-v1",
    "purpose": "optimize",
    "surface": "art",
})
assert "promptDetailMode" not in forwarded_invalid_detail
forwarded_resource_detail = preview._prompt_assistant_optimize_payload({
    "prompt": "使用 @参考图1 的姿势",
    "currentPrompt": "使用 @参考图1 的姿势",
    "promptSchema": "nf.art.prompt.v1",
    "promptDetailMode": "simple-structured-v1",
    "purpose": "optimize",
    "surface": "art",
})
assert "promptDetailMode" not in forwarded_resource_detail
forwarded_long = preview._prompt_assistant_optimize_payload({
    "purpose": "minimax-h3-prompt-enhance",
    "requirements": "R" * 13000,
})
assert len(forwarded_long["requirements"]) == 12000
forwarded_empty_reverse = preview._prompt_assistant_reverse_payload(workflow_empty_reverse_request)
assert forwarded_empty_reverse["preferredOutputLanguage"] == "zh-CN"
assert "Use <Picture 1> as the exact opening frame" in forwarded_empty_reverse["currentPrompt"]
generic_reverse = preview._prompt_assistant_reverse_payload({
    "purpose": "static-image-reverse",
    "preferredOutputLanguage": "en",
    "images": [{"dataUrl": "image"}],
})
assert "preferredOutputLanguage" not in generic_reverse
captured_requests = []
preview._request_prompt_assistant = lambda command, payload, timeout=300, **kwargs: (
    captured_requests.append((command, payload, timeout, kwargs))
    or {"ok": True, "data": {"positivePrompt": "structured"}}
)

class FakePreviewHandler:
    path = preview.PROMPT_ASSISTANT_PATH + "/optimize-prompt"
    def __init__(self):
        self.response = None
    def _read_request_body(self):
        import json
        return json.dumps({
            "prompt": "compiled prompt",
            "negativePrompt": "legacy negative",
            "purpose": "minimax-h3-prompt-enhance",
            "surface": "animation",
            "requirements": "H3 field protocol",
            "currentPrompt": "current surface prompt",
            "provider": "grok",
            "h3Mode": "first_last",
            "durationSeconds": 4,
            "visualSchema": "nf.h3.visual.v1",
        }).encode("utf-8")
    def _write_json_response(self, status, payload):
        self.response = (status, payload)

fake_handler = FakePreviewHandler()
preview.PreviewRuntimeHandler._handle_prompt_assistant(fake_handler)
assert captured_requests[0][0] == "optimizePrompt"
assert captured_requests[0][1] == forwarded
assert captured_requests[0][3] == {
    "lock_already_held": False,
    "deadline_monotonic": None,
}
assert fake_handler.response[0] == 200
print("minimax H3 local and preview backend contract: passed")
`;

const pythonCandidates = [process.env.PYTHON, "python", "py"].filter(Boolean);
let result = null;
for (const candidate of pythonCandidates) {
  const args = candidate === "py"
    ? ["-3", "-B", "-c", pythonProbe, servicePath, previewPath, JSON.stringify(emptyPromptReverseRequest)]
    : ["-B", "-c", pythonProbe, servicePath, previewPath, JSON.stringify(emptyPromptReverseRequest)];
  const attempt = spawnSync(candidate, args, { cwd: root, encoding: "utf8", timeout: 30_000 });
  if (!attempt.error || attempt.error.code !== "ENOENT") {
    result = attempt;
    break;
  }
}
assert.ok(result, "Python is required for the MiniMax H3 backend contract");
assert.equal(result.status, 0, `${result.stdout || ""}\n${result.stderr || ""}`);
assert.match(result.stdout, /minimax H3 local and preview backend contract: passed/);

assert.match(serverSource, /grok = await callGrokResponse\(request\.body, request\.inputMeta, resultOptions\)/);
console.log("minimax-h3-prompt-backend-contract: passed");
