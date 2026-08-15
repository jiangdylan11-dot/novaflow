const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const mainSource = fs.readFileSync(path.join(root, "particle-editor-desktop", "main.js"), "utf8");
const serviceSource = fs.readFileSync(path.join(root, "particle-editor-desktop", "prompt-assistant-service.py"), "utf8");
const adapterSource = fs.readFileSync(path.join(root, "particle-editor-desktop", "prompt_assistant", "qwen3_vl_adapter.py"), "utf8");
const smartAiSource = fs.readFileSync(path.join(root, "particle-editor", "novaflow-smart-ai.js"), "utf8");
const brandRuntimeSource = fs.readFileSync(path.join(root, "particle-editor", "novaflow-brand-runtime.js"), "utf8");
const particleEditorIndexSource = fs.readFileSync(path.join(root, "particle-editor", "index.html"), "utf8");
const spineSplitRuntimeSource = fs.readFileSync(path.join(root, "particle-editor", "spine-split-runtime.js"), "utf8");
const builderConfig = JSON.parse(fs.readFileSync(
  path.join(root, "particle-editor-desktop", "electron-builder.json"),
  "utf8"
));
const ORDINARY_ART_PROMPT_SCHEMA = "nf.art.prompt.v1";
const ORDINARY_ART_EDIT_CONTRACT = "structured-recompile-v1";
const ORDINARY_ART_PROMPT_SECTIONS = Object.freeze([
  "[风格设定]",
  "[主体物品]",
  "[环境背景]",
  "[光线与色彩]",
  "[拍摄参数]",
  "[用户附加要求]"
]);
const STRUCTURED_ART_EDIT_FIXTURE = [
  "[风格设定]",
  '媒介 = "数字绘画"',
  '绘画语言 = "高精度中国幻想游戏CG厚涂"',
  '氛围 = "柔和明亮、亲密含蓄且具有高级东方幻想质感"',
  '完成质感 = "皮肤、丝绸、薄纱、金属刺绣与翡翠材质层次清晰"',
  "",
  "[主体物品]",
  "主体数量 = 2",
  '主体1 = "左侧25岁以上的成年东方女性"',
  '主体1数量 = "1位"',
  '主体1外观 = "精致柔美且与右侧明显不同的东方五官，乌黑浓密长发，白皙细腻肌肤"',
  '主体1姿态 = "坐在丝绸床榻左侧并向右侧人物自然倾身"',
  '主体1动作 = "一只手温柔扶住右侧人物后脑和长发，另一只手环抱其腰部"',
  '主体1材质 = "青绿色轻薄丝纱华服、半透明披帛、翡翠耳坠与银色发饰"',
  '主体1颜色 = "青绿色、翡翠绿与冷银色形成清透层次"',
  '主体1局部细节 = "肩颈锁骨结构准确，四肢归属清楚，长发与披帛边缘分离"',
  '主体2 = "右侧25岁以上的成年东方女性"',
  '主体2数量 = "1位"',
  '主体2外观 = "精致端庄且与左侧明显不同的东方五官，宫廷盘发，脸颊轻微红润"',
  '主体2姿态 = "坐在丝绸床榻右侧并轻轻靠向左侧人物"',
  '主体2动作 = "与左侧人物温柔亲吻，双眼半闭，双腿自然交叠"',
  '主体2材质 = "象牙白薄纱华服、淡金刺绣、花纹蕾丝、玉石首饰与金色镂空发冠"',
  '主体2颜色 = "象牙白、淡金色与翡翠绿色形成温润对比"',
  '主体2局部细节 = "手指结构正确，腿部遮挡可信，发冠、耳饰与服装边界清晰"',
  '主体关系 = "两位成年女性紧密依偎并温柔亲吻，四只手和交叠双腿均能明确判断归属"',
  "",
  "[环境背景]",
  '环境 = "象牙白与淡金色中国宫廷空间"',
  '背景 = "丝绸帷幔与雕花屏风在明亮空间中若隐若现"',
  '前中后景 = "前景为自然垂落的披帛与裙摆，中景为双人床榻，后景为克制的宫廷屏风"',
  '承托面 = "柔软丝绸床榻承托交叠身体与自然垂落的服饰"',
  '遮挡层次 = "人物身体、长发、薄纱与床榻前后关系清楚，边缘没有错误融合"',
  "",
  "[光线与色彩]",
  '光源方向 = "柔和暖光从画面左上方斜射并集中照亮两张面孔"',
  '光源软硬 = "高调柔光具有宽阔过渡和克制的局部高光"',
  '明暗关系 = "背景过曝高光受到抑制，人物体积、服装褶皱与空间层次清晰"',
  '轮廓光 = "肩颈、长发和薄纱外缘具有轻微暖金色轮廓光"',
  '主辅色 = "青绿色、象牙白与淡金色为主，翡翠绿和银色为辅"',
  '局部颜色 = "皮肤呈柔润白皙暖色，脸颊微红，金色刺绣和翡翠珠宝色彩准确"',
  "",
  "[拍摄参数]",
  '景别 = "近距离双人全身构图"',
  '视角 = "略微俯视且保持人物比例、遮挡与空间透视可信"',
  '构图 = "两张不同面孔位于上方焦点，身体形成稳定三角形，服饰建立向下延伸的S形动线"',
  '裁切 = "完整保留两位人物头部、四只手、交叠双腿与床榻接触区域"',
  '透视 = "标准近距离透视，人体比例自然，遮挡关系和空间深度没有夸张变形"',
  '景深 = "主体整体清晰，背景帷幔与屏风轻微虚化但仍保留材质层次"',
  "",
  "[用户附加要求]",
  '要求1 = "两位角色均为25岁以上的成年女性，面部特征明显不同，四肢结构与归属准确"',
  '要求2 = "背景曝光受控且画面保持明亮柔和，人物、服装、亲吻姿态、材质与整体风格均保持不变"'
].join("\n");

assert.ok(
  builderConfig.files.includes("prompt_assistant/**/*"),
  "the packaged app must include the task-scoped local reverse adapter modules"
);
assert.ok(
  builderConfig.files.includes("!prompt_assistant/**/__pycache__/**"),
  "the packaged app must exclude generated Python bytecode caches"
);

assert.match(
  mainSource,
  /NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_TYPE = "qwen3_vl_8b_abliterated_nf4"/,
  "the local reverse adapter must expose its task-specific model type"
);
const reverseOnlyGateSource = mainSource.match(
  /function isPromptAssistantStaticImageReverseRequest\(command, payload = \{\}\) \{[\s\S]*?\n\}/
)?.[0] || "";
assert.ok(reverseOnlyGateSource, "the Qwen3-only request gate must be independently testable");
const isStaticImageReverseRequest = Function(
  `${reverseOnlyGateSource}; return isPromptAssistantStaticImageReverseRequest;`
)();
assert.equal(isStaticImageReverseRequest("reverseImagePrompt", { purpose: "static-image-reverse" }), true);
assert.equal(isStaticImageReverseRequest("reverseImagePrompt", { purpose: "" }), false);
assert.equal(isStaticImageReverseRequest("reverseImagePrompt", { purpose: "storyboardReference" }), false);
assert.equal(isStaticImageReverseRequest("reverseImagePrompt", { purpose: "static_image_reverse" }), false);
assert.equal(isStaticImageReverseRequest("optimizePrompt", { purpose: "static-image-reverse" }), false);
assert.match(mainSource, /const commandEnabled = config\.serviceExists && \(config\.modelExists \|\| \(staticImageReverseRequest && config\.reverseModelEnabled\)\)/);
assert.match(mainSource, /allowReverseOnly: staticImageReverseRequest/);
assert.match(mainSource, /当前反推模式需要 Qwen2\.5-VL 旧模型，但该模型未配置/);
assert.match(mainSource, /reverseModelEnabled: config\.reverseModelEnabled/);
assert.match(mainSource, /promptAssistantStopPromise[\s\S]*?await promptAssistantStopPromise/);
assert.match(mainSource, /__novaflowStartupStdoutBuffer \+= text[\s\S]*?JSON\.parse\(line\.trim\(\)\)[\s\S]*?startup\?\.type === "ready"/);
assert.match(mainSource, /startup\?\.type !== "startup-error"[\s\S]*?prompt-assistant-startup-error/);
assert.match(mainSource, /Number\(code\) === 73[\s\S]*?prompt-assistant-already-running/);
assert.match(mainSource, /manifest\?\.weight_map/);
assert.match(adapterSource, /load_in_4bit=True/);
assert.match(adapterSource, /bnb_4bit_quant_type="nf4"/);
assert.doesNotMatch(adapterSource, /load_in_8bit=True/);
assert.match(serviceSource, /== "static-image-reverse"/);
assert.doesNotMatch(serviceSource, /elif not purpose:/);
assert.match(
  serviceSource,
  /bounded_error_code = re\.sub\([\s\S]*?getattr\(exc, "code", ""\)[\s\S]*?error_payload\["errorCode"\] = bounded_error_code/,
  "all visual-contract failures must preserve their bounded error code even when diagnostics are empty"
);
assert.match(smartAiSource, /purpose: isArt \? "static-image-reverse" : ""/);
assert.match(brandRuntimeSource, /purpose: "static-image-reverse"/);
assert.match(
  smartAiSource,
  /if \(!useGrok && usesStaticImageReverse\) \{\s*showLocalStaticReverseWarning\(result\?\.warning\);\s*\}/,
  "Smart AI must surface local static reverse fallback warnings without affecting Grok or animation"
);
assert.match(
  brandRuntimeSource,
  /window\.addEventListener\("novaflow:prompt-assistant-warning"[\s\S]*?showTopbarExportAvailabilityNotice\(message\)/,
  "the shared runtime notice must render Smart AI fallback warnings"
);
const animationReverseBlock = brandRuntimeSource.match(
  /async function runAiAnimationReversePrompt\(promptFrames\)[\s\S]*?\n\s*function armAiAnimationPromptHistoryGuardFromEvent/
)?.[0] || "";
const artReverseBlock = brandRuntimeSource.match(
  /async function runArtGenerateReverseImagePrompt\(sources\)[\s\S]*?\n\s*function handleArtGenerateReverseButton/
)?.[0] || "";
const imageWashReverseBlock = spineSplitRuntimeSource.match(
  /async function runImageWashReversePrompt\(dataUrl, fileName, options = \{\}\)[\s\S]*?\n\s*function storyboardFastStringHash/
)?.[0] || "";
assert.doesNotMatch(animationReverseBlock, /static-image-reverse/);
assert.doesNotMatch(animationReverseBlock, /result\.warning|prompt-assistant-warning|showTopbarExportAvailabilityNotice/);
assert.match(artReverseBlock, /purpose: "static-image-reverse"/);
assert.match(artReverseBlock, /const requestedVisualV2 = selected\.length === 1/);
assert.match(artReverseBlock, /const analysisNsfw = requestedVisualV2 \? true : !!ART_GENERATE_STATE\.nsfw/);
assert.match(artReverseBlock, /requestedVisualV2 \? \{ visualSchema: "nf\.visual\.v2", nsfw: analysisNsfw \} : \{\}/);
assert.match(artReverseBlock, /visualPrompt: result\.data\?\.visualPrompt/);
assert.match(
  artReverseBlock,
  /requestedVisualV2 && result\.data\?\.visualSchema !== "nf\.visual\.v2"[\s\S]*?throw new Error[\s\S]*?appendPromptAssistantPositivePrompt\(prompt\)/,
  "the direct Art reverse entry must reject a missing or downgraded v2 response before appending"
);
assert.match(
  artReverseBlock,
  /visualSchema === "nf\.visual\.v2" && result\.data\?\.sensitivePromptBlocked === true[\s\S]*?\["suggestive", "nudity", "explicit"\]\.includes\(contentLevel\) && visiblePersonCount > 0[\s\S]*?appendPromptAssistantPositivePrompt\(prompt\)/,
  "the direct Art reverse entry must block denied or person-sensitive output before appending"
);
assert.match(
  artReverseBlock,
  /const publicV2Validator = window\.__NovaFlowSmartAI\?\.isValidPublicVisualV2Result[\s\S]*?!publicV2Validator\(publicV2Result[\s\S]*?appendPromptAssistantPositivePrompt\(prompt\)/,
  "the direct Art reverse entry must fail closed when public v2 metadata is missing or inconsistent"
);
assert.match(artReverseBlock, /const warning = String\(result\.warning \|\| ""\)\.trim\(\)/);
assert.match(artReverseBlock, /if \(warning\) showTopbarExportAvailabilityNotice\(warning\)/);
assert.doesNotMatch(imageWashReverseBlock, /static-image-reverse/);
assert.match(
  mainSource,
  /NOVAFLOW_PROMPT_ASSISTANT_REVERSE_MODEL_PATH: config\.reverseModelPath/,
  "the resolved local reverse model directory must be passed through the service environment"
);

assert.match(mainSource, /proc\.__novaflowIntentionalStop = true/, "intentional release must be distinguished from a crash");
assert.match(mainSource, /promptAssistantProcess && promptAssistantProcess !== proc/, "an exiting old process must not clear a newer service process");
assert.match(mainSource, /setTimeout\(\(\) => resolve\("stop-timeout"\), 5000\)/);
assert.match(mainSource, /proc\.once\("exit", \(\) => \{[\s\S]*?resolve\("stopped"\)/);

const freeMemoryHandler = mainSource.match(/ipcMain\.handle\("runtime-free-memory"[\s\S]*?\n\}\);\r?\n/)?.[0] || "";
assert.match(freeMemoryHandler, /stopPromptAssistantServiceSync\(\)/, "free memory must stop the prompt assistant process");
assert.match(freeMemoryHandler, /promptAssistant:\s*promptAssistantReleased/, "free memory must report prompt assistant release state");

const localOptimizeHandler = mainSource.match(/ipcMain\.handle\("prompt-assistant-optimize-prompt"[\s\S]*?\n\}\);\r?\n/)?.[0] || "";
assert.match(
  localOptimizeHandler,
  /requestPromptAssistant\("optimizePrompt"[\s\S]*?verifiedCleanup:\s*true/,
  "prompt optimization must delegate verified local-model release to the leased request"
);
assert.match(
  localOptimizeHandler,
  /requestedPromptSchema[\s\S]*?surface === "art"[\s\S]*?purpose === "optimize"[\s\S]*?Boolean\(currentPrompt\)[\s\S]*?requestedPromptSchema === "nf\.art\.prompt\.v1"[\s\S]*?\{ promptSchema \}/,
  "the Electron bridge must pass the Art prompt schema only for an exact existing-text Art optimize request"
);
assert.match(
  mainSource,
  /ipcMain\.handle\("smart-ai-prompt-optimize"[\s\S]*?requestNovaFlowSmartAiApi\("\/api\/client\/grok\/prompt-optimize", payload\)/,
  "the Grok Electron bridge must preserve the renderer payload, including the exact Art prompt schema"
);
const localReverseReleaseHandler = mainSource.match(/ipcMain\.handle\("prompt-assistant-reverse-image-prompt"[\s\S]*?\n\}\);\r?\n/)?.[0] || "";
assert.match(
  localReverseReleaseHandler,
  /requestPromptAssistant\("reverseImagePrompt"[\s\S]*?verifiedCleanup:\s*true/,
  "prompt reverse must delegate verified local-model release to the leased request"
);

const localReverseHandler = mainSource.match(/ipcMain\.handle\("prompt-assistant-reverse-image-prompt"[\s\S]*?\n\}\);\r?\n/)?.[0] || "";
assert.match(localReverseHandler, /purpose === "static-image-reverse" && images\.length === 1 && visualSchema === "nf\.visual\.v2"/);
assert.match(localReverseHandler, /\.\.\.\(usesVisualV2 \? \{ visualSchema, nsfw: payload\?\.nsfw === true \} : \{\}\)/);
assert.match(localReverseHandler, /usesMiniMaxH3Reverse[\s\S]*?visualSchema !== "nf\.h3\.visual\.v1"[\s\S]*?throw new Error/);
assert.match(localReverseHandler, /requires explicit userPrompt and userRequirements fields/);
assert.match(localReverseHandler, /usesMiniMaxH3VisualV1 \? \{ userPrompt, userRequirements \} : \{\}/);
assert.match(localReverseHandler, /usesMiniMaxH3Reverse \? 180_000 : 300_000/);
assert.match(brandRuntimeSource, /data-novaflow-art-generate-nsfw/);
assert.match(smartAiSource, /nsfw: surface === "art" \? readArtGenerateNsfw\(button\) : false/);
assert.match(particleEditorIndexSource, /novaflow-brand-runtime\.js\?v=20260813-ideogram-instant-1/);
assert.match(particleEditorIndexSource, /smart-ai-art-auto-intent\.workflow\.js\?v=20260811-art-auto-intent-1/);
assert.match(particleEditorIndexSource, /novaflow-smart-ai\.js\?v=20260815-art-e2e-parity-1/);
assert.match(smartAiSource, /const VERSION = "20260815-art-e2e-parity-1"/);

const requestFunction = mainSource.slice(
  mainSource.indexOf("async function requestPromptAssistant"),
  mainSource.indexOf("async function probeNovaFlowRuntime")
).trim();
assert.match(
  requestFunction,
  /const timer = setTimeout\([\s\S]*?stopPromptAssistantServiceSync\(\);[\s\S]*?Prompt Assistant 推理超时/,
  "every prompt assistant timeout must terminate the generating process"
);

function extractNamedFunction(input, name) {
  const marker = `function ${name}(`;
  const start = input.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const declarationStart = input.slice(Math.max(0, start - 6), start) === "async " ? start - 6 : start;
  const bodyStart = input.indexOf("{", start);
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
    else if (char === "}" && --depth === 0) return input.slice(declarationStart, index + 1);
  }
  throw new Error(`${name} body is incomplete`);
}

const mainFailureMetadataSource = extractNamedFunction(mainSource, "promptAssistantFailureMetadata");
const promptAssistantFailureMetadata = vm.runInNewContext(`(${mainFailureMetadataSource})`);
const h3ReverseRequestSource = mainSource.match(
  /function isPromptAssistantMiniMaxH3ReverseRequest\(command, payload = \{\}\) \{[\s\S]*?\n\}/
)?.[0] || "";
assert.ok(h3ReverseRequestSource);
const isPromptAssistantMiniMaxH3ReverseRequest = vm.runInNewContext(`(${h3ReverseRequestSource})`);
const h3TimeoutErrorSource = extractNamedFunction(mainSource, "createPromptAssistantH3TimeoutError");
const createPromptAssistantH3TimeoutError = vm.runInNewContext(`(${h3TimeoutErrorSource})`);
const verifiedStopSource = extractNamedFunction(mainSource, "stopPromptAssistantServiceWithVerifiedResult");
const h3TraceStart = mainSource.indexOf("function tracePromptAssistantH3Lifecycle");
const h3TraceEnd = mainSource.indexOf("\n\nasync function requestPromptAssistant", h3TraceStart);
const h3TraceSource = mainSource.slice(h3TraceStart, h3TraceEnd);
assert.ok(h3TraceStart >= 0 && h3TraceEnd > h3TraceStart);
assert.equal(isPromptAssistantMiniMaxH3ReverseRequest("reverseImagePrompt", { purpose: "minimax-h3-i2v-reverse" }), true);
assert.equal(isPromptAssistantMiniMaxH3ReverseRequest("reverseImagePrompt", { purpose: "minimax_h3_fl2v_reverse" }), true);
assert.equal(isPromptAssistantMiniMaxH3ReverseRequest("reverseImagePrompt", { purpose: "static-image-reverse" }), false);
assert.equal(isPromptAssistantMiniMaxH3ReverseRequest("optimizePrompt", { purpose: "minimax-h3-i2v-reverse" }), false);
assert.doesNotMatch(h3TraceSource, /rawOutput|dataUrl|userPrompt|userRequirements|images/);
assert.equal(
  JSON.stringify(promptAssistantFailureMetadata(createPromptAssistantH3TimeoutError())),
  JSON.stringify({
    errorCode: "h3-local-timeout",
    requestedVisualSchema: "nf.h3.visual.v1",
    failureCategory: "timeout",
    retryable: true,
    retryAttempted: false,
    legacyFallbackSuppressed: true
  })
);
assert.equal(
  JSON.stringify(promptAssistantFailureMetadata({
    ok: false,
    error: "local H3 deterministic validation failed",
    errorCode: "h3-local-deterministic-validation-failed",
    failureCategory: "h3_contract_alignment",
    failureClass: "audio-fidelity",
    generationGate: "blocked",
    requestedVisualSchema: "nf.h3.visual.v1",
    retryable: false,
    legacyFallbackSuppressed: true,
    sensitivePromptBlocked: false
  })),
  JSON.stringify({
    errorCode: "h3-local-deterministic-validation-failed",
    requestedVisualSchema: "nf.h3.visual.v1",
    failureCategory: "h3_contract_alignment",
    failureClass: "audio-fidelity",
    generationGate: "blocked",
    retryable: false,
    legacyFallbackSuppressed: true,
    sensitivePromptBlocked: false
  }),
  "Electron must retain the exact H3 deterministic technical failure envelope"
);
assert.equal(
  JSON.stringify(promptAssistantFailureMetadata({
    failure: {
      errorCode: "v2-qwen3-fail-closed",
      message: "视觉合同未通过",
      retryable: true,
      retryAttempted: true,
      retryCount: 1,
      reverseProvider: "qwen3_vl_abliterated_nf4",
      providerFailureCode: "visual-contract-semantic-invalid",
      legacyFallbackSuppressed: true,
      requestedVisualSchema: "nf.visual.v2",
      failureCategory: "semantic_contract",
      rawOutput: "must-not-pass",
      sensitive_visible_facts: ["must-not-pass"]
    }
  })),
  JSON.stringify({
    errorCode: "v2-qwen3-fail-closed",
    message: "视觉合同未通过",
    reverseProvider: "qwen3_vl_abliterated_nf4",
    providerFailureCode: "visual-contract-semantic-invalid",
    requestedVisualSchema: "nf.visual.v2",
    failureCategory: "semantic_contract",
    retryable: true,
    retryAttempted: true,
    legacyFallbackSuppressed: true,
    retryCount: 1
  }),
  "Electron must forward only the public Prompt Assistant failure envelope"
);

async function runPromptAssistantEnvelopeCase(config, childMessage) {
  const pending = new Map();
  const processStub = {
    stdin: {
      write(line) {
        const request = JSON.parse(line);
        const entry = pending.get(request.id);
        assert.ok(entry, "the child response must match an active Prompt Assistant request");
        pending.delete(request.id);
        clearTimeout(entry.timer);
        if (childMessage.ok === false) {
          const error = new Error(childMessage.error || "Prompt Assistant inference failed");
          Object.assign(error, promptAssistantFailureMetadata(childMessage));
          entry.reject(error);
          return;
        }
        entry.resolve(childMessage.data);
      }
    }
  };
  const context = vm.createContext({
    getPromptAssistantConfig: () => ({ ...config }),
    isPromptAssistantStaticImageReverseRequest: isStaticImageReverseRequest,
    isPromptAssistantMiniMaxH3ReverseRequest,
    ensurePromptAssistantProcess: async () => processStub,
    promptAssistantNextRequestId: 1,
    promptAssistantPending: pending,
    promptAssistantBusy: false,
    promptAssistantRequestLease: null,
    promptAssistantNextLeaseId: 1,
    promptAssistantLastError: "",
    promptAssistantLastWarning: "",
    appendLogLine: () => {},
    stopPromptAssistantServiceSync: () => {},
    promptAssistantFailureMetadata,
    setTimeout,
    clearTimeout
  });
  const requestPromptAssistant = vm.runInContext(`(${requestFunction})`, context);
  return await requestPromptAssistant("reverseImagePrompt", {
    purpose: "static-image-reverse"
  }, 1_000);
}

async function runElectronH3TimeoutCase() {
  const pending = new Map();
  const timers = [];
  const writes = [];
  const traces = [];
  let ensureCalls = 0;
  let stopCalls = 0;
  const processStub = {
    pid: 24680,
    stdin: { write(line) { writes.push(JSON.parse(line)); } }
  };
  const context = vm.createContext({
    getPromptAssistantConfig: () => ({ serviceExists: true, modelExists: true, enabled: true }),
    isPromptAssistantStaticImageReverseRequest: isStaticImageReverseRequest,
    isPromptAssistantMiniMaxH3ReverseRequest,
    ensurePromptAssistantProcess: async () => { ensureCalls += 1; return processStub; },
    promptAssistantNextRequestId: 10,
    promptAssistantPending: pending,
    promptAssistantBusy: false,
    promptAssistantRequestLease: null,
    promptAssistantNextLeaseId: 1,
    promptAssistantLastError: "",
    promptAssistantLastWarning: "",
    appendLogLine: () => {},
    stopPromptAssistantServiceSync: () => {},
    stopPromptAssistantServiceWithVerifiedResult: async () => { stopCalls += 1; return "stopped"; },
    promptAssistantLastSafeH3Stage: () => "initial-ir",
    createPromptAssistantH3TimeoutError,
    tracePromptAssistantH3Lifecycle: (event, metadata) => traces.push({ event, metadata }),
    promptAssistantFailureMetadata,
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeout: () => {}
  });
  const requestPromptAssistant = vm.runInContext(`(${requestFunction})`, context);
  const resultPromise = requestPromptAssistant("reverseImagePrompt", {
    purpose: "minimax-h3-i2v-reverse",
    visualSchema: "nf.h3.visual.v1"
  }, 180_000);
  await new Promise(setImmediate);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 180_000);
  timers[0].callback();
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "h3-local-timeout");
  assert.equal(result.failureCategory, "timeout");
  assert.equal(result.retryable, true);
  assert.equal(result.retryAttempted, false);
  assert.equal(result.legacyFallbackSuppressed, true);
  assert.equal(result.requestedVisualSchema, "nf.h3.visual.v1");
  assert.equal(ensureCalls, 1);
  assert.equal(writes.length, 1, "H3 timeout must not auto-retry");
  assert.equal(stopCalls, 1);
  assert.deepEqual(traces.map((item) => item.event), ["start", "timeout"]);
}

async function runElectronH3DeterministicFailureCase() {
  const pending = new Map();
  const traces = [];
  let stopCalls = 0;
  const childMessage = {
    ok: false,
    error: "local H3 deterministic validation failed",
    errorCode: "h3-local-deterministic-validation-failed",
    failureCategory: "h3_contract_alignment",
    failureClass: "audio-fidelity",
    generationGate: "blocked",
    requestedVisualSchema: "nf.h3.visual.v1",
    retryable: false,
    legacyFallbackSuppressed: true,
    sensitivePromptBlocked: false
  };
  const processStub = {
    pid: 97531,
    stdin: {
      write(line) {
        const request = JSON.parse(line);
        const entry = pending.get(request.id);
        assert.ok(entry);
        pending.delete(request.id);
        clearTimeout(entry.timer);
        const error = new Error(childMessage.error);
        Object.assign(error, promptAssistantFailureMetadata(childMessage));
        entry.reject(error);
      }
    }
  };
  const context = vm.createContext({
    getPromptAssistantConfig: () => ({ serviceExists: true, modelExists: true, enabled: true }),
    isPromptAssistantStaticImageReverseRequest: isStaticImageReverseRequest,
    isPromptAssistantMiniMaxH3ReverseRequest,
    ensurePromptAssistantProcess: async () => processStub,
    promptAssistantNextRequestId: 30,
    promptAssistantPending: pending,
    promptAssistantBusy: false,
    promptAssistantRequestLease: null,
    promptAssistantNextLeaseId: 1,
    promptAssistantLastError: "",
    promptAssistantLastWarning: "",
    appendLogLine: () => {},
    stopPromptAssistantServiceSync: () => {},
    stopPromptAssistantServiceWithVerifiedResult: async () => { stopCalls += 1; return "stopped"; },
    promptAssistantLastSafeH3Stage: () => "deterministic-primary",
    createPromptAssistantH3TimeoutError,
    tracePromptAssistantH3Lifecycle: (event, metadata) => traces.push({ event, metadata }),
    promptAssistantFailureMetadata,
    setTimeout,
    clearTimeout
  });
  const requestPromptAssistant = vm.runInContext(`(${requestFunction})`, context);
  const result = await requestPromptAssistant("reverseImagePrompt", {
    purpose: "minimax-h3-i2v-reverse",
    visualSchema: "nf.h3.visual.v1"
  }, 180_000);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "h3-local-deterministic-validation-failed");
  assert.equal(result.failureCategory, "h3_contract_alignment");
  assert.equal(result.failureClass, "audio-fidelity");
  assert.equal(result.generationGate, "blocked");
  assert.equal(result.requestedVisualSchema, "nf.h3.visual.v1");
  assert.equal(result.retryable, false);
  assert.equal(result.legacyFallbackSuppressed, true);
  assert.equal(result.sensitivePromptBlocked, false);
  assert.equal(stopCalls, 1);
  assert.deepEqual(traces.map((item) => item.event), ["start", "done"]);
}

async function verifyElectronPromptAssistantStopResults() {
  const runCase = async ({ hasProcess, resolved }) => {
    let context = null;
    context = vm.createContext({
      promptAssistantProcess: hasProcess ? { pid: 1 } : null,
      promptAssistantStopPromise: null,
      stopPromptAssistantServiceSync() {
        context.promptAssistantProcess = null;
        context.promptAssistantStopPromise = Promise.resolve(resolved);
      }
    });
    const stop = vm.runInContext(`(${verifiedStopSource})`, context);
    return await stop();
  };
  assert.equal(await runCase({ hasProcess: true, resolved: "stopped" }), "stopped");
  assert.equal(await runCase({ hasProcess: true, resolved: "stop-timeout" }), "stop-timeout");
  assert.equal(await runCase({ hasProcess: false, resolved: "stopped" }), "not-running");
}

async function runElectronH3SuccessCase() {
  const pending = new Map();
  const traces = [];
  let stopCalls = 0;
  const processStub = {
    pid: 13579,
    stdin: {
      write(line) {
        const request = JSON.parse(line);
        const entry = pending.get(request.id);
        pending.delete(request.id);
        clearTimeout(entry.timer);
        entry.resolve({ prompt: "h3" });
      }
    }
  };
  const context = vm.createContext({
    getPromptAssistantConfig: () => ({ serviceExists: true, modelExists: true, enabled: true }),
    isPromptAssistantStaticImageReverseRequest: isStaticImageReverseRequest,
    isPromptAssistantMiniMaxH3ReverseRequest,
    ensurePromptAssistantProcess: async () => processStub,
    promptAssistantNextRequestId: 20,
    promptAssistantPending: pending,
    promptAssistantBusy: false,
    promptAssistantRequestLease: null,
    promptAssistantNextLeaseId: 1,
    promptAssistantLastError: "",
    promptAssistantLastWarning: "",
    appendLogLine: () => {},
    stopPromptAssistantServiceSync: () => {},
    stopPromptAssistantServiceWithVerifiedResult: async () => { stopCalls += 1; return "stopped"; },
    promptAssistantLastSafeH3Stage: () => "complete",
    createPromptAssistantH3TimeoutError,
    tracePromptAssistantH3Lifecycle: (event, metadata) => traces.push({ event, metadata }),
    promptAssistantFailureMetadata,
    setTimeout,
    clearTimeout
  });
  const requestPromptAssistant = vm.runInContext(`(${requestFunction})`, context);
  const result = await requestPromptAssistant("reverseImagePrompt", {
    purpose: "minimax-h3-fl2v-reverse",
    visualSchema: "nf.h3.visual.v1"
  }, 180_000);
  assert.equal(result.ok, true);
  assert.equal(result.data.prompt, "h3");
  assert.equal(stopCalls, 1);
  assert.deepEqual(traces.map((item) => item.event), ["start", "done"]);
}

const runSmartAiSource = extractNamedFunction(smartAiSource, "runSmartAi");
const syncArtGenerateModeSource = extractNamedFunction(smartAiSource, "syncArtGenerateMode");
const staticRequirementsSource = extractNamedFunction(smartAiSource, "buildStaticArtReverseRequirements");
const preservationStart = smartAiSource.indexOf("const SMART_AI_PROMPT_PRESERVATION_STOPWORDS");
const preservationEnd = smartAiSource.indexOf("\n\n  function preserveSmartAiReverseResourceMentions", preservationStart);
assert.ok(preservationStart >= 0 && preservationEnd > preservationStart,
  "Art prompt preservation helpers should remain independently testable");
const preservationSource = smartAiSource.slice(preservationStart, preservationEnd).trim();
const preservationContext = vm.createContext({ ORDINARY_ART_PROMPT_SECTIONS });
vm.runInContext(
  `${preservationSource}\nthis.validateSmartAiArtPromptPreservation = validateSmartAiArtPromptPreservation;\nthis.smartAiPromptPreservationError = smartAiPromptPreservationError;\nthis.validateSmartAiStructuredArtPrompt = validateSmartAiStructuredArtPrompt;\nthis.smartAiStructuredPromptError = smartAiStructuredPromptError;`,
  preservationContext
);
const validateSmartAiArtPromptPreservation = preservationContext.validateSmartAiArtPromptPreservation;
const smartAiPromptPreservationError = preservationContext.smartAiPromptPreservationError;
const validateSmartAiStructuredArtPrompt = preservationContext.validateSmartAiStructuredArtPrompt;
const smartAiStructuredPromptError = preservationContext.smartAiStructuredPromptError;
const smartAiFailureMessage = vm.runInNewContext(`(${extractNamedFunction(smartAiSource, "smartAiFailureMessage")})`);
const setTextareaValueSource = extractNamedFunction(smartAiSource, "setTextareaValue");
const setPromptTextareasValueStart = smartAiSource.indexOf("function setPromptTextareasValue");
const setPromptTextareasValueEnd = smartAiSource.indexOf("\n\n  function isFilledImage", setPromptTextareasValueStart);
assert.ok(setPromptTextareasValueStart >= 0 && setPromptTextareasValueEnd > setPromptTextareasValueStart);
const setPromptTextareasValueSource = smartAiSource.slice(setPromptTextareasValueStart, setPromptTextareasValueEnd).trim();
const normalizeArtGeneratePromptHistoryTextSource = extractNamedFunction(brandRuntimeSource, "normalizeArtGeneratePromptHistoryText");
const normalizeArtGeneratePromptHistoryItemSource = extractNamedFunction(brandRuntimeSource, "normalizeArtGeneratePromptHistoryItem");
const buildRequirementsStart = smartAiSource.indexOf("function buildSmartAiRequirements");
const buildRequirementsEnd = smartAiSource.indexOf("\n\n  function renderEngineOptions", buildRequirementsStart);
assert.ok(buildRequirementsStart >= 0 && buildRequirementsEnd > buildRequirementsStart,
  "buildSmartAiRequirements should remain independently testable");
const buildRequirementsSource = smartAiSource.slice(buildRequirementsStart, buildRequirementsEnd).trim();
const stripTrailingGenericArtPreservation = vm.runInNewContext(
  `(${extractNamedFunction(smartAiSource, "stripTrailingGenericArtPreservation")})`
);
const shouldUseStructuredArtPromptContract = vm.runInNewContext(
  `(${extractNamedFunction(smartAiSource, "shouldUseStructuredArtPromptContract")})`
);
assert.equal(
  shouldUseStructuredArtPromptContract("一名成年女战士站在山谷中，电影级光影，细节清晰。"),
  false,
  "short single-paragraph Art optimization must omit the structured schema for both providers"
);
assert.equal(shouldUseStructuredArtPromptContract("甲".repeat(121)), true);
assert.equal(shouldUseStructuredArtPromptContract("主体立于山谷\n背景为雪山"), true);
assert.equal(shouldUseStructuredArtPromptContract("[风格设定] 数字绘画"), true);
assert.equal(shouldUseStructuredArtPromptContract("保留 __NOVAFLOW_IMAGE_01__ 资源"), true);
const openDialogSource = extractNamedFunction(smartAiSource, "openDialog");
const invalidateAnalysisSource = extractNamedFunction(smartAiSource, "invalidateSmartAiAnalysis");
const readArtGenerateNsfwSource = extractNamedFunction(smartAiSource, "readArtGenerateNsfw");
const getPromptTextareasSource = extractNamedFunction(smartAiSource, "getPromptTextareasFromContext");
const protectResourceMentionsSource = extractNamedFunction(smartAiSource, "protectSmartAiResourceMentions");
const restoreResourceMentionsSource = extractNamedFunction(smartAiSource, "restoreSmartAiResourceMentions");
const hasOwnValueSource = extractNamedFunction(smartAiSource, "hasOwnValue");
const readResultValueSource = extractNamedFunction(smartAiSource, "readSmartAiResultValue");
const readSmartAiResultSource = extractNamedFunction(smartAiSource, "readSmartAiResult");
const cleanFailureTextSource = extractNamedFunction(smartAiSource, "cleanSmartAiFailureText");
const cleanFailureCodeSource = extractNamedFunction(smartAiSource, "cleanSmartAiFailureCode");
const readFailureEnvelopeSource = extractNamedFunction(smartAiSource, "readSmartAiFailureEnvelope");
const failureCategoryLabelSource = extractNamedFunction(smartAiSource, "smartAiFailureCategoryLabel");
const analysisFailureStatusSource = extractNamedFunction(smartAiSource, "smartAiAnalysisFailureStatusMessage");
const publicV2ValidatorSource = extractNamedFunction(smartAiSource, "isValidPublicVisualV2Result");
const publicV2ConstantsSource = smartAiSource.match(
  /const SMART_AI_VISUAL_V2_PUBLIC_SAFETY_KEYS =[\s\S]*?const SMART_AI_VISUAL_V2_ZERO_PERSON_FORBIDDEN_SIGNALS = [^\r\n]+;/
)?.[0] || "";
assert.ok(publicV2ConstantsSource, "public visual v2 validator constants should exist");
const publicV2ValidatorContext = vm.createContext({});
vm.runInContext(
  `${publicV2ConstantsSource}\n${publicV2ValidatorSource}\nthis.isValidPublicVisualV2Result = isValidPublicVisualV2Result;`,
  publicV2ValidatorContext
);
const isValidPublicVisualV2Result = publicV2ValidatorContext.isValidPublicVisualV2Result;
const explicitAgeAmbiguousSource = extractNamedFunction(smartAiSource, "isSmartAiExplicitAgeAmbiguous");
const blockedStatusSource = extractNamedFunction(smartAiSource, "smartAiBlockedStatusMessage");
const degradedStatusSource = extractNamedFunction(smartAiSource, "smartAiDegradedStatusMessage");
const partialStatusSource = extractNamedFunction(smartAiSource, "smartAiPartialStatusMessage");
const enableArtNsfwSource = extractNamedFunction(smartAiSource, "enableArtGenerateNsfwForSensitivePrompt");
const revealAnalysisSource = extractNamedFunction(smartAiSource, "revealSmartAiAnalysisResult");
const sensitiveAutoApplySource = extractNamedFunction(smartAiSource, "isSmartAiSensitiveAutoApplyCandidate");
const sensitiveIntentGateSource = extractNamedFunction(smartAiSource, "smartAiSensitiveIntentHasDisallowedYoungOrMinorTerms");
const explicitMinorRequirementsSource = extractNamedFunction(smartAiSource, "smartAiRequirementsContainExplicitMinorTerms");
const sensitiveRequirementsSource = extractNamedFunction(smartAiSource, "smartAiRequirementsContainSensitiveIntent");
const escapeSmartAiHtmlSource = smartAiSource.match(/function escapeSmartAiHtml\(value\) \{[\s\S]*?\n  \}/)?.[0] || "";
assert.ok(escapeSmartAiHtmlSource, "escapeSmartAiHtml should exist");
const metadataTextSource = extractNamedFunction(smartAiSource, "smartAiMetadataText");
const safetyLabelSource = extractNamedFunction(smartAiSource, "smartAiSafetyLabel");
const safetyValueSource = extractNamedFunction(smartAiSource, "smartAiSafetyValue");
const renderAnalysisResultSource = extractNamedFunction(smartAiSource, "renderSmartAiAnalysisResult");

assert.match(
  smartAiSource,
  /if \(state\.loading\) \{[\s\S]*?querySelectorAll\("input, textarea, select, button"\)[\s\S]*?control\.disabled = true/,
  "request-affecting controls must be locked while a model request is active"
);
assert.ok(
  (smartAiSource.match(/invalidateSmartAiAnalysis\(/g) || []).length >= 9,
  "all request-affecting controls must invalidate displayed or pending analysis"
);
assert.match(
  smartAiSource,
  /novaflow-smart-ai-message" data-visible="\$\{state\.message \? "1" : "0"\}" data-tone="\$\{state\.messageTone === "error" \? "error" : \(state\.messageTone === "warning" \? "warning" : ""\)\}" role="\$\{state\.messageTone === "error" \? "alert" : "status"\}" aria-live="\$\{state\.messageTone === "error" \? "assertive" : "polite"\}"/,
  "Smart AI feedback must stay outside the scrolling analysis body as a live status"
);
assert.match(smartAiSource, /const analysisFailed = Boolean\(state\.analysisFailure\)[\s\S]*?\(analysisBlocked \|\| analysisFailed\)[\s\S]*?"重新分析参考图"/);
assert.doesNotMatch(smartAiSource, /h3FallbackApplied|已写入可用H3保底提示词|重新精细分析参考图/);
assert.doesNotMatch(smartAiSource, /showAdultDeclaration|novaflow-smart-ai-adult-declaration|提交即确认参考图与描述中的人物均为成年人/);
assert.doesNotMatch(smartAiSource, /requiresAdultConfirmation|确认所有人物均为成年人并应用 NSFW 提示词/);
assert.match(
  smartAiSource,
  /generationGate === "adult_confirmation"[\s\S]*?requestFingerprint !== buildSmartAiRequestFingerprint\(requestFingerprintOptions\)[\s\S]*?!enableArtGenerateNsfwForSensitivePrompt\(state\.context\)[\s\S]*?currentTextareas = getPromptTextareasFromContext\(state\.context\)/,
  "adult-sensitive application must revalidate, enable NSFW, then reacquire the live prompt controls"
);
assert.match(enableArtNsfwSource, /catch \{\s*return false;\s*\}/, "a throwing NSFW setter must fail closed before writeback");
assert.match(smartAiSource, /"应用中性提示词继续"/);
assert.match(smartAiSource, /state\.analysisResult = parsed;\s*state\.revealAnalysisOnRender = true/);
assert.match(smartAiSource, /if \(state\.revealAnalysisOnRender\) \{[\s\S]*?revealSmartAiAnalysisResult\(root\)/);

const revealSmartAiAnalysisResult = vm.runInNewContext(`(${revealAnalysisSource})`);
const scrollCalls = [];
assert.equal(revealSmartAiAnalysisResult({
  querySelector(selector) {
    assert.equal(selector, ".novaflow-smart-ai-result");
    return { scrollIntoView(options) { scrollCalls.push(options); } };
  }
}), true);
assert.deepEqual(JSON.parse(JSON.stringify(scrollCalls)), [{ block: "start", inline: "nearest" }]);

function publicVisualV2Safety(overrides = {}) {
  return {
    level: "safe",
    body_exposure: "none",
    interaction_category: "none",
    age_assessment: "adult_appearing",
    visible_person_count: 1,
    signals: [],
    sensitive_visible_facts: [],
    ...overrides
  };
}

function createSmartAiSubmitHarness({
  engine,
  artTask = "preserve",
  imageCount = 1,
  surface = "art",
  initialArtGenerateMode = surface === "art" ? "img2img" : "",
  mode = imageCount > 0 ? "reverse" : "optimize",
  hadInitialPrompt = true,
  userIntent = "保持主体身份并提升质量，保留蓝色发饰",
  initialPrompt = "保持主体身份并提升质量",
  supportsNegativePrompt = true,
  nsfw = false,
  useDomPromptLookup = false,
  replacePromptControlsOnNsfwSet = false,
  replacePromptControlsOnModeSet = false,
  modeSetterAvailable = true,
  failModeSet = false,
  internalRequirements = "",
  mutateFingerprintBeforeSensitiveGate = false,
  throwBeforeNsfwSet = false,
  throwAfterNsfwSet = false,
  failFirstWrite = false,
  response: responseOverride = null,
  resourceMentionTool = null
}) {
  let liveNsfw = nsfw;
  let liveArtGenerateMode = initialArtGenerateMode;
  const images = Array.from({ length: imageCount }, (_, index) => ({
    imageUrl: `data:image/png;base64,IMAGE_${index + 1}`,
    label: `图${index + 1}`,
    role: "reference",
    slotType: "reference"
  }));
  const state = {
    loading: false,
    context: { surface, artGenerateMode: liveArtGenerateMode, nsfw },
    mode,
    engine,
    artTask,
    artStyle: "original",
    preserveLevel: "high",
    requirements: userIntent,
    images,
    imagesLoading: false,
    referenceRoles: imageCount === 1 ? ["subject"] : ["subject", "style"],
    referenceRoleOverrides: {},
    targetIndex: 0,
    hadInitialPrompt,
    message: "",
    analysisResult: null,
    analysisFailure: null,
    pendingApply: null
  };
  let positive = { value: initialPrompt, isConnected: true };
  let negative = supportsNegativePrompt ? { value: "旧负面词", isConnected: true } : null;
  let shouldMutateFingerprintBeforeSensitiveGate = mutateFingerprintBeforeSensitiveGate;
  const artWorkspace = {
    querySelector(selector) {
      if (selector.includes('prompt-kind="positive"')) return { textarea: positive };
      if (selector.includes('prompt-kind="negative"')) return { textarea: negative };
      return null;
    }
  };
  const initialPositive = positive;
  const calls = { grokReverse: [], localReverse: [], grokOptimize: [], localOptimize: [], writes: [], writeAttempts: 0, warnings: [], nsfwSets: [], modes: [], compile: 0, closed: 0 };
  const response = responseOverride || (surface === "art" && mode === "optimize" && String(initialPrompt || "").trim()
    ? {
      ok: true,
      prompt: STRUCTURED_ART_EDIT_FIXTURE,
      negative_prompt: "新负面词",
      has_negative_prompt: true,
      editContract: ORDINARY_ART_EDIT_CONTRACT,
      promptSchema: ORDINARY_ART_PROMPT_SCHEMA
    }
    : {
      ok: true,
      prompt: "保持主体身份并提升质量，保留蓝色发饰，增强可信细节与画面完成度",
      negative_prompt: "新负面词",
      has_negative_prompt: true,
      visualSchema: "nf.visual.v2",
      visualPrompt: "蓝发成年角色站在夜景街道中",
      generationRequirements: "保留蓝色发饰；保持原风格",
      generationGate: "direct",
      contentSafety: publicVisualV2Safety(),
      contentWarnings: [],
      sensitivePromptBlocked: false
    });
  const electronAPI = {
    async smartAiImageReverse(payload) { calls.grokReverse.push(payload); return response; },
    async promptAssistantReverseImagePrompt(payload) {
      calls.localReverse.push(payload);
      return { ...response, warning: "本地反推已回退" };
    },
    async smartAiPromptOptimize(payload) { calls.grokOptimize.push(payload); return response; },
    async promptAssistantOptimizePrompt(payload) { calls.localOptimize.push(payload); return response; }
  };
  const sensitiveAutoApplyCandidate = vm.runInNewContext(`(${sensitiveAutoApplySource})`);
  const context = vm.createContext({
    state,
    window: {
      electronAPI,
      __NovaFlowArtGenerate: {
        setMode: modeSetterAvailable ? function setMode(nextMode) {
          if (failModeSet) return false;
          liveArtGenerateMode = nextMode === "img2img" ? "img2img" : "txt2img";
          calls.modes.push(liveArtGenerateMode);
          if (replacePromptControlsOnModeSet) {
            positive = { value: positive.value, isConnected: true, replacementAfterMode: true };
            negative = { value: negative.value, isConnected: true, replacementAfterMode: true };
          }
          return true;
        } : undefined,
        setNsfw(enabled) {
          calls.nsfwSets.push(enabled === true);
          if (throwBeforeNsfwSet) throw new Error("NSFW setter failed before state update");
          liveNsfw = enabled === true;
          if (replacePromptControlsOnNsfwSet) {
            positive = { value: positive.value, isConnected: true, replacement: true };
            negative = { value: negative.value, isConnected: true, replacement: true };
          }
          if (throwAfterNsfwSet) throw new Error("NSFW render failed after state update");
          return true;
        }
      }
    },
    document: { getElementById: (id) => id === "novaflow-art-generate-workspace" ? artWorkspace : null },
    findTextarea: (frame) => frame?.textarea || null,
    ART_REFERENCE_PLAN: null,
    ORDINARY_ART_PROMPT_SCHEMA,
    ORDINARY_ART_EDIT_CONTRACT,
    shouldUseStructuredArtPromptContract,
    getPromptTextareasFromContext: () => ({ positive, negative }),
    isPromptTextControl: (value) => Boolean(value),
    buildSmartAiRequirements: () => internalRequirements || "高质量CG渲染约束：通用长质量块；基础质量由系统自动负责",
    validateArtDesignState: () => "",
    syncArtAutoIntent: () => {
      if (surface !== "art") return null;
      const roles = imageCount === 0 ? [] : imageCount === 1 ? ["subject"] : ["subject", "style", "background"].slice(0, imageCount);
      const intent = {
        imageCount,
        hasReferences: imageCount > 0,
        route: imageCount === 0 ? "optimize" : imageCount === 1 ? "static_reverse" : "role_reference",
        purpose: imageCount === 0 ? (state.hadInitialPrompt ? "optimize" : "create") : imageCount === 1 ? "static-image-reverse" : "roleReference",
        generationMode: imageCount > 0 ? "img2img" : "txt2img",
        task: imageCount > 1 ? "combine" : imageCount ? "preserve" : "create",
        style: imageCount ? "original" : "auto",
        preserveLevel: "high",
        backgroundMode: "replace",
        roles,
        canSubmit: imageCount > 0
          || Boolean(String(state.requirements || "").trim())
          || Boolean(state.hadInitialPrompt)
      };
      state.artTask = intent.task;
      state.artStyle = intent.style;
      state.preserveLevel = intent.preserveLevel;
      state.referenceRoles = roles;
      return intent;
    },
    readArtGenerateMode: () => liveArtGenerateMode,
    readSessionToken: () => "session-token",
    renderDialog: () => {},
    readArtGenerateNsfw: () => liveNsfw,
    buildSmartAiRequestFingerprint: (options = {}) => JSON.stringify({
      positive: positive.value,
      negative: negative?.value || "",
      nsfw: liveNsfw,
      images: options.ignoreArtReferenceState ? [] : state.images.map((item) => item.imageUrl),
      mode: state.mode,
      engine: state.engine,
      artTask: options.ignoreArtReferenceState ? "" : state.artTask,
      artStyle: options.ignoreArtReferenceState ? "" : state.artStyle,
      preserveLevel: options.ignoreArtReferenceState ? "" : state.preserveLevel,
      referenceRoles: options.ignoreArtReferenceState ? [] : state.referenceRoles,
      requirements: state.requirements
    }),
    protectSmartAiResourceMentions: (text) => ({ text: String(text || ""), originalText: String(text || ""), tokens: [] }),
    buildStaticArtReverseRequirements: vm.runInNewContext(`(${staticRequirementsSource})`),
    buildReverseImagesPayload: () => ({ scenario: imageCount > 1 ? "multi_reference" : "single_reference", sourceCount: imageCount, targetIndex: 0, images: images.slice(0, 1) }),
    buildRoleReferenceImagesPayload: () => ({
      scenario: "role_reference",
      sourceCount: imageCount,
      targetIndex: 0,
      images: images.map((item, index) => ({ ...item, role: state.referenceRoles[index], slotType: state.referenceRoles[index] }))
    }),
    hasOwnValue: vm.runInNewContext(`(${hasOwnValueSource})`),
    restoreSmartAiResourceMentions: (text) => ({ ok: true, text }),
    smartAiResourceMentionError: (message) => new Error(message),
    validateSmartAiArtPromptPreservation,
    smartAiPromptPreservationError,
    validateSmartAiStructuredArtPrompt,
    smartAiStructuredPromptError,
    preserveSmartAiReverseResourceMentions: (_current, generated) => generated,
    artHighQualityCgNegativeGuardInstruction: () => "",
    mergeSmartAiNegativePrompt: (base) => base,
    setPromptTextareasValue: (textareas, prompt, options) => {
      calls.writeAttempts += 1;
      if (failFirstWrite && calls.writeAttempts === 1) {
        const error = new Error("重绘后首次写入失败");
        error.code = "write_prompt_failed";
        throw error;
      }
      calls.writes.push({ textareas, prompt, options });
    },
    compileArtReferencePlan: async () => {
      calls.compile += 1;
      return { version: "test", results: [], capabilities: {} };
    },
    smartAiReferenceFingerprint: () => "fingerprint",
    showLocalStaticReverseWarning: (warning) => calls.warnings.push(warning),
    closeDialog: () => { calls.closed += 1; },
    smartAiFailureMessage: (error) => String(error?.message || error),
    isValidPublicVisualV2Result,
    isSmartAiExplicitAgeAmbiguous: vm.runInNewContext(`(${explicitAgeAmbiguousSource})`),
    isSmartAiSensitiveAutoApplyCandidate: (result) => {
      const isCandidate = sensitiveAutoApplyCandidate(result);
      if (isCandidate && shouldMutateFingerprintBeforeSensitiveGate) {
        shouldMutateFingerprintBeforeSensitiveGate = false;
        state.requirements = `${state.requirements}；请求完成后的新要求`;
      }
      return isCandidate;
    },
    smartAiSensitiveIntentHasDisallowedYoungOrMinorTerms: vm.runInNewContext(`(${sensitiveIntentGateSource})`),
    smartAiRequirementsContainExplicitMinorTerms: vm.runInNewContext(`(${explicitMinorRequirementsSource})`),
    smartAiRequirementsContainSensitiveIntent: vm.runInNewContext(`(${sensitiveRequirementsSource})`)
  });
  if (useDomPromptLookup) {
    context.getPromptTextareasFromContext = vm.runInContext(`(${getPromptTextareasSource})`, context);
  }
  if (resourceMentionTool) {
    context.window.NovaFlowResourceMentionTool = resourceMentionTool;
    context.protectSmartAiResourceMentions = vm.runInContext(`(${protectResourceMentionsSource})`, context);
    context.restoreSmartAiResourceMentions = vm.runInContext(`(${restoreResourceMentionsSource})`, context);
  }
  context.syncArtGenerateMode = vm.runInContext(`(${syncArtGenerateModeSource})`, context);
  context.invalidateSmartAiAnalysis = vm.runInContext(`(${invalidateAnalysisSource})`, context);
  context.readSmartAiResultValue = vm.runInContext(`(${readResultValueSource})`, context);
  context.readSmartAiResult = vm.runInContext(`(${readSmartAiResultSource})`, context);
  context.cleanSmartAiFailureText = vm.runInContext(`(${cleanFailureTextSource})`, context);
  context.cleanSmartAiFailureCode = vm.runInContext(`(${cleanFailureCodeSource})`, context);
  context.readSmartAiFailureEnvelope = vm.runInContext(`(${readFailureEnvelopeSource})`, context);
  context.smartAiFailureCategoryLabel = vm.runInContext(`(${failureCategoryLabelSource})`, context);
  context.smartAiAnalysisFailureStatusMessage = vm.runInContext(`(${analysisFailureStatusSource})`, context);
  context.smartAiBlockedStatusMessage = vm.runInContext(`(${blockedStatusSource})`, context);
  context.smartAiDegradedStatusMessage = vm.runInContext(`(${degradedStatusSource})`, context);
  context.smartAiPartialStatusMessage = vm.runInContext(`(${partialStatusSource})`, context);
  context.enableArtGenerateNsfwForSensitivePrompt = vm.runInContext(`(${enableArtNsfwSource})`, context);
  const runSmartAi = vm.runInContext(`(${runSmartAiSource})`, context);
  return {
    state,
    calls,
    runSmartAi,
    positive: initialPositive,
    negative,
    getNsfw: () => liveNsfw,
    getRequestFingerprint: context.buildSmartAiRequestFingerprint,
    getCurrentTextareas: () => ({ positive, negative })
  };
}

function verifyStructuredPromptWriteAndHistoryIntegrity() {
  const changeSnapshots = [];
  class TestTextArea {
    constructor() {
      this._value = "";
      this.isConnected = true;
    }
    get value() { return this._value; }
    set value(next) { this._value = String(next); }
    dispatchEvent(event) {
      if (event?.type === "change") changeSnapshots.push(this.value);
      return true;
    }
    focus() {}
  }
  class TestInput extends TestTextArea {}
  class TestEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = options.bubbles === true;
    }
  }
  const writeContext = vm.createContext({
    window: { HTMLInputElement: TestInput, HTMLTextAreaElement: TestTextArea },
    HTMLInputElement: TestInput,
    HTMLTextAreaElement: TestTextArea,
    Event: TestEvent,
    isPromptTextControl: (value) => value instanceof TestTextArea,
    smartAiWriteError: (message) => new Error(message)
  });
  vm.runInContext([
    setTextareaValueSource,
    setPromptTextareasValueSource,
    "this.setPromptTextareasValue = setPromptTextareasValue;"
  ].join("\n"), writeContext);
  const positive = new TestTextArea();
  writeContext.setPromptTextareasValue({ positive, negative: null }, STRUCTURED_ART_EDIT_FIXTURE, {
    supportsNegativePrompt: false,
    hasNegativePrompt: false
  });
  assert.equal(positive.value, STRUCTURED_ART_EDIT_FIXTURE,
    "renderer textarea writeback must preserve every structured prompt character and newline");
  assert.deepEqual(changeSnapshots, [STRUCTURED_ART_EDIT_FIXTURE],
    "the history-triggering change event must receive the complete multiline prompt without truncation");

  const historyContext = vm.createContext({ Date });
  vm.runInContext([
    normalizeArtGeneratePromptHistoryTextSource,
    normalizeArtGeneratePromptHistoryItemSource,
    "this.normalizeArtGeneratePromptHistoryItem = normalizeArtGeneratePromptHistoryItem;"
  ].join("\n"), historyContext);
  const historyItem = historyContext.normalizeArtGeneratePromptHistoryItem({
    text: changeSnapshots[0],
    at: 1
  }, 1);
  assert.equal(historyItem.text, STRUCTURED_ART_EDIT_FIXTURE,
    "Art prompt history normalization must retain the full multiline structured prompt");
}

async function verifySmartAiBehavior() {
  verifyStructuredPromptWriteAndHistoryIntegrity();
  await verifyElectronPromptAssistantStopResults();
  await runElectronH3TimeoutCase();
  await runElectronH3DeterministicFailureCase();
  await runElectronH3SuccessCase();
  const childFailureWithReadyConfig = await runPromptAssistantEnvelopeCase({
    ok: true,
    serviceExists: true,
    modelExists: true,
    reverseModelEnabled: true,
    enabled: true
  }, {
    ok: false,
    error: "nf.visual.v2 Qwen3 contract failed closed before legacy fallback",
    errorCode: "v2-qwen3-fail-closed",
    requestedVisualSchema: "nf.visual.v2",
    legacyFallbackSuppressed: true,
    failureCategory: "semantic_contract"
  });
  assert.equal(childFailureWithReadyConfig.ok, false,
    "a ready legacy-model config must never overwrite a child inference failure");
  assert.equal(childFailureWithReadyConfig.errorCode, "v2-qwen3-fail-closed");
  assert.equal(childFailureWithReadyConfig.requestedVisualSchema, "nf.visual.v2");

  const childV2SuccessWithoutLegacyModel = await runPromptAssistantEnvelopeCase({
    ok: false,
    serviceExists: true,
    modelExists: false,
    reverseModelEnabled: true,
    enabled: false
  }, {
    ok: true,
    data: {
      prompt: "validated v2 generation prompt",
      visualSchema: "nf.visual.v2"
    }
  });
  assert.equal(childV2SuccessWithoutLegacyModel.ok, true,
    "a valid Qwen3 reverse result must stay successful when the legacy model is absent");
  assert.equal(childV2SuccessWithoutLegacyModel.data.visualSchema, "nf.visual.v2");

  const invalidationState = {
    analysisResult: { visualSchema: "nf.visual.v2" },
    analysisFailure: { errorCode: "stale_failure" },
    pendingApply: { prompt: "stale" },
    message: ""
  };
  const invalidateSmartAiAnalysis = vm.runInNewContext(`(${invalidateAnalysisSource})`, { state: invalidationState, Boolean });
  invalidateSmartAiAnalysis("要求已更改，请重新分析。");
  assert.equal(invalidationState.analysisResult, null);
  assert.equal(invalidationState.analysisFailure, null);
  assert.equal(invalidationState.pendingApply, null);
  assert.equal(invalidationState.message, "要求已更改，请重新分析。");

  const readArtGenerateNsfw = vm.runInNewContext(`(${readArtGenerateNsfwSource})`, { document: { getElementById: () => null } });
  assert.equal(readArtGenerateNsfw({ closest: () => ({ getAttribute: () => "1" }) }), true);
  assert.equal(readArtGenerateNsfw({ closest: () => ({ getAttribute: () => "0" }) }), false);

  const replacementPositive = { id: "replacement-positive" };
  const replacementNegative = { id: "replacement-negative" };
  const replacementWorkspace = {
    querySelector(selector) {
      if (selector.includes('prompt-kind="positive"')) return { textarea: replacementPositive };
      if (selector.includes('prompt-kind="negative"')) return { textarea: replacementNegative };
      return null;
    }
  };
  const getPromptTextareasAfterReplacement = vm.runInNewContext(`(${getPromptTextareasSource})`, {
    document: { getElementById: (id) => id === "novaflow-art-generate-workspace" ? replacementWorkspace : null },
    findTextarea: (frame) => frame?.textarea || null
  });
  const replacementTextareas = getPromptTextareasAfterReplacement({
    surface: "art",
    button: {
      isConnected: false,
      closest() { throw new Error("a detached Smart AI button must never own Art textarea lookup"); }
    }
  });
  assert.equal(replacementTextareas.positive, replacementPositive);
  assert.equal(replacementTextareas.negative, replacementNegative);

  const blockedStatusContext = vm.createContext({});
  vm.runInContext(`${explicitAgeAmbiguousSource}\n${blockedStatusSource}`, blockedStatusContext);
  for (const level of ["suggestive", "nudity", "explicit"]) {
    assert.equal(blockedStatusContext.isSmartAiExplicitAgeAmbiguous({
      level,
      age_assessment: "ambiguous_or_young_appearing"
    }), true, `${level} age ambiguity must receive the explicit no-write explanation`);
  }
  assert.match(blockedStatusContext.smartAiBlockedStatusMessage({
    contentSafety: { level: "nudity", age_assessment: "ambiguous_or_young_appearing", visible_person_count: 1 },
    contentWarnings: ["age_ambiguous", "sensitive_prompt_age_unconfirmed"]
  }), /分析完成—未写入.*年龄不明确或外观偏年轻/);
  assert.match(blockedStatusContext.smartAiBlockedStatusMessage({
    contentSafety: { level: "uncertain", age_assessment: "adult_appearing", visible_person_count: 1 },
    contentWarnings: []
  }), /分析完成—未写入.*内容分级无法确定/);
  assert.match(blockedStatusContext.smartAiBlockedStatusMessage({
    contentSafety: { level: "nudity", age_assessment: "adult_appearing", visible_person_count: 1 },
    contentWarnings: ["nudity", "sensitive_prompt_minor_requirements"]
  }), /分析完成—未写入.*附加要求包含明确未成年人内容.*敏感提示词已阻止/);

  const requirementsContainExplicitMinor = vm.runInNewContext(`(${explicitMinorRequirementsSource})`);
  for (const requirements of [
    "青少年角色",
    "teen character",
    "child character",
    "未满18岁角色",
    "17岁角色",
    "17-year-old character",
    "aged 17",
    "under 18 character"
  ]) {
    assert.equal(requirementsContainExplicitMinor(requirements), true, requirements);
  }
  for (const requirements of [
    "少女风角色",
    "少年风角色",
    "girl character",
    "boy character",
    "18岁成年少女",
    "18-year-old adult anime girl",
    "asset 117"
  ]) {
    assert.equal(requirementsContainExplicitMinor(requirements), false, requirements);
  }
  const requirementsContainSensitiveIntent = vm.runInNewContext(`(${sensitiveRequirementsSource})`);
  assert.equal(requirementsContainSensitiveIntent("teen portrait"), false);
  assert.equal(requirementsContainSensitiveIntent("儿童绘本"), false);
  assert.equal(requirementsContainSensitiveIntent("teen nude"), true);
  assert.equal(requirementsContainSensitiveIntent("未成年裸体"), true);
  assert.equal(requirementsContainSensitiveIntent("17-year-old nude"), true);

  const validPublicV2Result = {
    visualSchema: "nf.visual.v2",
    visualPrompt: "一名成年人物站在夜景街道中",
    generationGate: "direct",
    contentSafety: publicVisualV2Safety(),
    contentWarnings: [],
    sensitivePromptBlocked: false,
    hasContentWarnings: true,
    hasSensitivePromptBlocked: true
  };
  assert.equal(isValidPublicVisualV2Result(validPublicV2Result, { nsfw: false }), true);
  assert.equal(isValidPublicVisualV2Result({ ...validPublicV2Result, visualPrompt: "   " }, { nsfw: false }), false);
  assert.equal(isValidPublicVisualV2Result(validPublicV2Result, {
    nsfw: true,
    requireGenerationGate: true,
    requirementsContainExplicitMinor: requirementsContainExplicitMinor("teen portrait"),
    requirementsContainSensitiveIntent: requirementsContainSensitiveIntent("teen portrait")
  }), true, "a safe reference with a safe teen portrait requirement remains direct");
  const explicitMinorRequirementsBlockedSummary = {
    ...validPublicV2Result,
    visualPrompt: "画面包含一名人物，室内近景与柔和照明",
    contentSafety: publicVisualV2Safety({
      level: "nudity",
      body_exposure: "full",
      signals: ["nudity"]
    }),
    contentWarnings: ["nudity", "sensitive_prompt_minor_requirements"],
    sensitivePromptBlocked: true,
    generationGate: "blocked"
  };
  for (const requirements of ["青少年角色", "teen character", "child character"]) {
    assert.equal(isValidPublicVisualV2Result(explicitMinorRequirementsBlockedSummary, {
      nsfw: true,
      requireGenerationGate: true,
      requirementsContainExplicitMinor: requirementsContainExplicitMinor(requirements)
    }), true, requirements);
  }
  assert.equal(isValidPublicVisualV2Result(explicitMinorRequirementsBlockedSummary, {
    nsfw: true,
    requireGenerationGate: true,
    requirementsContainExplicitMinor: false
  }), false, "a server warning cannot forge the request-side explicit-minor gate");
  assert.equal(isValidPublicVisualV2Result({
    ...explicitMinorRequirementsBlockedSummary,
    contentWarnings: ["nudity"]
  }, {
    nsfw: true,
    requireGenerationGate: true,
    requirementsContainExplicitMinor: true
  }), false, "a sensitive request-side explicit-minor gate requires the stable warning tag");
  assert.equal(isValidPublicVisualV2Result(validPublicV2Result, {
    nsfw: true,
    requireGenerationGate: true,
    requirementsContainExplicitMinor: true,
    requirementsContainSensitiveIntent: false
  }), true, "safe content with a safe minor term must not gain the sensitive-only warning tag");
  const safeReferenceSensitiveMinorBlockedSummary = {
    ...validPublicV2Result,
    visualPrompt: "一名人物站在明亮室内",
    contentWarnings: ["sensitive_prompt_minor_requirements"],
    sensitivePromptBlocked: true,
    generationGate: "blocked"
  };
  for (const requirements of [
    "teen nude",
    "未成年人裸体",
    "未满18岁裸体",
    "17岁裸体",
    "17-year-old nude"
  ]) {
    assert.equal(isValidPublicVisualV2Result(safeReferenceSensitiveMinorBlockedSummary, {
      nsfw: true,
      requireGenerationGate: true,
      requirementsContainExplicitMinor: requirementsContainExplicitMinor(requirements),
      requirementsContainSensitiveIntent: requirementsContainSensitiveIntent(requirements)
    }), true, requirements);
  }
  assert.equal(isValidPublicVisualV2Result(safeReferenceSensitiveMinorBlockedSummary, {
    nsfw: true,
    requireGenerationGate: true,
    requirementsContainExplicitMinor: true,
    requirementsContainSensitiveIntent: false
  }), false, "the server cannot forge a safe-reference sensitive-minor block without request evidence");
  const validBlockedZeroPersonObject = {
    ...validPublicV2Result,
    contentSafety: publicVisualV2Safety({
      level: "explicit",
      age_assessment: "not_applicable",
      visible_person_count: 0,
      signals: ["explicit_anatomy"]
    }),
    contentWarnings: ["explicit_anatomy"],
    sensitivePromptBlocked: true,
    generationGate: "blocked"
  };
  assert.equal(isValidPublicVisualV2Result(validBlockedZeroPersonObject, { nsfw: true }), true);
  const degradedPersonSummary = {
    ...validPublicV2Result,
    visualPrompt: "画面包含一名可见人物，室内近景，冷色照明",
    contentSafety: publicVisualV2Safety({
      level: "uncertain",
      body_exposure: "uncertain",
      interaction_category: "uncertain",
      age_assessment: "ambiguous_or_young_appearing",
      signals: []
    }),
    sensitivePromptBlocked: true,
    analysisDegraded: true,
    generationGate: "blocked",
    contractFailureCode: "visual-contract-invalid",
    qualityGateFailed: true
  };
  assert.equal(isValidPublicVisualV2Result(degradedPersonSummary, { nsfw: true }), true);
  const degradedZeroPersonSummary = {
    ...degradedPersonSummary,
    visualPrompt: "室内产品摄影，中性背景与冷色照明",
    contentSafety: publicVisualV2Safety({
      level: "uncertain",
      age_assessment: "not_applicable",
      visible_person_count: 0,
      signals: []
    })
  };
  assert.equal(isValidPublicVisualV2Result(degradedZeroPersonSummary, { nsfw: true }), true);
  const partialInteractionSummary = {
    ...validPublicV2Result,
    visualPrompt: "画面包含一名可见人物，室内近景，暖色照明",
    contentSafety: publicVisualV2Safety({
      level: "explicit",
      body_exposure: "none",
      interaction_category: "sexual",
      signals: ["explicit_activity"]
    }),
    contentWarnings: ["explicit_activity"],
    sensitivePromptBlocked: false,
    analysisPartial: true,
    generationGate: "adult_confirmation",
    contractFailureCode: "visual-contract-interaction-evidence-incomplete",
    qualityGateFailed: true
  };
  assert.equal(isValidPublicVisualV2Result(partialInteractionSummary, { nsfw: true }), true);
  const partialInteractionAgeUnverifiableSummary = {
    ...partialInteractionSummary,
    contentSafety: publicVisualV2Safety({
      level: "explicit",
      body_exposure: "none",
      interaction_category: "sexual",
      age_assessment: "age_unverifiable",
      signals: ["explicit_activity", "age_ambiguous"]
    }),
    contentWarnings: ["explicit_activity", "age_ambiguous", "sensitive_prompt_age_unconfirmed"]
  };
  assert.equal(isValidPublicVisualV2Result(partialInteractionAgeUnverifiableSummary, { nsfw: true }), true);
  const futureNeutralOnlySummary = {
    ...partialInteractionSummary,
    sensitivePromptBlocked: true,
    generationGate: "neutral_only",
    contractFailureCode: "visual-contract-future-neutral-only"
  };
  assert.equal(isValidPublicVisualV2Result(futureNeutralOnlySummary, { nsfw: true }), false);
  const partialProjectionSummary = {
    ...validPublicV2Result,
    visualPrompt: "画面包含一名可见人物，室内近景，柔和暖色照明",
    contentSafety: publicVisualV2Safety({
      level: "nudity",
      body_exposure: "full",
      interaction_category: "none",
      signals: ["nudity"]
    }),
    contentWarnings: ["nudity"],
    sensitivePromptBlocked: false,
    analysisPartial: true,
    generationGate: "adult_confirmation",
    contractFailureCode: "visual-contract-projection-redaction-required",
    qualityGateFailed: true
  };
  assert.equal(isValidPublicVisualV2Result(partialProjectionSummary, { nsfw: true }), true);
  const partialExplicitMinorRequirementsBlockedSummary = {
    ...partialProjectionSummary,
    contentWarnings: ["nudity", "sensitive_prompt_minor_requirements"],
    sensitivePromptBlocked: true,
    generationGate: "blocked"
  };
  assert.equal(isValidPublicVisualV2Result(partialExplicitMinorRequirementsBlockedSummary, {
    nsfw: true,
    requireGenerationGate: true,
    requirementsContainExplicitMinor: true
  }), true, "recoverable partials must retain a verifiable explicit-minor requirements reason");
  const partialAmbiguousSummary = {
    ...partialInteractionSummary,
    sensitivePromptBlocked: true,
    generationGate: "blocked",
    contentSafety: publicVisualV2Safety({
      level: "explicit",
      body_exposure: "none",
      interaction_category: "sexual",
      age_assessment: "ambiguous_or_young_appearing",
      signals: ["explicit_activity", "age_ambiguous"]
    }),
    contentWarnings: [
      "explicit_activity",
      "age_ambiguous",
      "sensitive_prompt_age_unconfirmed"
    ]
  };
  assert.equal(
    isValidPublicVisualV2Result(partialAmbiguousSummary, { nsfw: true }),
    true,
    "an age-ambiguous partial result must retain its high-level warning while remaining blocked"
  );
  const ageUnverifiableAdultSummary = {
    ...validPublicV2Result,
    visualPrompt: "画面包含一名人物，室内近景与暖色照明",
    contentSafety: publicVisualV2Safety({
      level: "explicit",
      interaction_category: "sexual",
      age_assessment: "age_unverifiable",
      signals: ["explicit_activity", "age_ambiguous"]
    }),
    contentWarnings: ["explicit_activity", "age_ambiguous", "sensitive_prompt_age_unconfirmed"],
    sensitivePromptBlocked: false,
    generationGate: "adult_confirmation"
  };
  assert.equal(isValidPublicVisualV2Result(ageUnverifiableAdultSummary, { nsfw: true }), true);
  assert.equal(blockedStatusContext.isSmartAiExplicitAgeAmbiguous(ageUnverifiableAdultSummary.contentSafety), false);
  const youngSensitiveBlockedSummary = {
    ...ageUnverifiableAdultSummary,
    contentSafety: publicVisualV2Safety({
      level: "explicit",
      interaction_category: "sexual",
      age_assessment: "young_or_minor_indicators",
      signals: ["explicit_activity", "age_ambiguous"]
    }),
    sensitivePromptBlocked: true,
    generationGate: "blocked"
  };
  assert.equal(isValidPublicVisualV2Result(youngSensitiveBlockedSummary, { nsfw: true }), true);
  assert.equal(blockedStatusContext.isSmartAiExplicitAgeAmbiguous(youngSensitiveBlockedSummary.contentSafety), true);
  const safeYoungDirectSummary = {
    ...validPublicV2Result,
    visualPrompt: "一名年轻角色在明亮教室中阅读",
    contentSafety: publicVisualV2Safety({
      age_assessment: "young_or_minor_indicators"
    }),
    generationGate: "direct"
  };
  assert.equal(
    isValidPublicVisualV2Result(safeYoungDirectSummary, { nsfw: true }),
    true,
    "safe young-character content remains a normal direct prompt and is not an NSFW gate"
  );
  assert.equal(
    isValidPublicVisualV2Result(
      { ...validPublicV2Result, generationGate: undefined },
      { nsfw: false, requireGenerationGate: true }
    ),
    false,
    "the Smart AI modal must require an explicit generation gate"
  );
  assert.equal(
    isValidPublicVisualV2Result(
      { ...validPublicV2Result, generationGate: "unknown_gate" },
      { nsfw: false, requireGenerationGate: true }
    ),
    false
  );
  const invalidPublicV2Metadata = [
    { ...validPublicV2Result, contentSafety: null },
    { ...validPublicV2Result, hasSensitivePromptBlocked: false },
    { ...validPublicV2Result, contentSafety: publicVisualV2Safety({ level: "invalid" }) },
    { ...validPublicV2Result, contentSafety: publicVisualV2Safety({ visible_person_count: 1.5 }) },
    { ...validPublicV2Result, contentSafety: publicVisualV2Safety({ sensitive_visible_facts: ["must stay server-side"] }) },
    { ...validPublicV2Result, contentWarnings: ["unknown_warning"] },
    { ...validPublicV2Result, sensitivePromptBlocked: true },
    { ...degradedPersonSummary, contractFailureCode: "" },
    { ...degradedPersonSummary, qualityGateFailed: false },
    { ...degradedPersonSummary, sensitivePromptBlocked: false },
    { ...degradedPersonSummary, analysisPartial: true },
    { ...degradedPersonSummary, contentSafety: publicVisualV2Safety({ level: "uncertain", body_exposure: "uncertain", interaction_category: "uncertain", signals: [] }) },
    { ...degradedZeroPersonSummary, contentSafety: publicVisualV2Safety({ level: "uncertain", body_exposure: "uncertain", age_assessment: "not_applicable", visible_person_count: 0, signals: [] }) },
    {
      ...validPublicV2Result,
      contentSafety: publicVisualV2Safety({
        level: "nudity",
        body_exposure: "full",
        age_assessment: "not_applicable",
        visible_person_count: 0,
        signals: ["nudity"]
      }),
      contentWarnings: ["nudity"]
    }
  ];
  for (const result of invalidPublicV2Metadata) {
    assert.equal(isValidPublicVisualV2Result(result, { nsfw: false }), false);
  }
  const invalidPartialMetadata = [
    { ...partialInteractionSummary, contractFailureCode: "visual-contract-invalid" },
    { ...partialProjectionSummary, contractFailureCode: "visual-contract-projection-redaction-required-fake" },
    { ...partialInteractionSummary, qualityGateFailed: false },
    { ...partialInteractionSummary, sensitivePromptBlocked: true },
    { ...partialInteractionSummary, generationGate: "direct" },
    { ...partialInteractionSummary, sensitivePromptBlocked: true, generationGate: "neutral_only" },
    { ...partialProjectionSummary, generationGate: "neutral_only" },
    { ...partialProjectionSummary, generationGate: "unknown_gate" },
    { ...partialInteractionSummary, analysisDegraded: true },
    { ...partialInteractionSummary, contentSafety: publicVisualV2Safety({ level: "explicit", body_exposure: "none", interaction_category: "none", signals: ["explicit_anatomy"] }), contentWarnings: ["explicit_anatomy"] },
    { ...partialInteractionSummary, contentSafety: publicVisualV2Safety({ level: "explicit", body_exposure: "none", interaction_category: "sexual", age_assessment: "not_applicable", visible_person_count: 0, signals: ["explicit_activity"] }) },
    { ...partialInteractionSummary, contentSafety: publicVisualV2Safety({ level: "explicit", body_exposure: "none", interaction_category: "sexual", signals: ["explicit_activity"], sensitive_visible_facts: ["must stay server-side"] }) }
  ];
  for (const result of invalidPartialMetadata) {
    assert.equal(isValidPublicVisualV2Result(result, { nsfw: true }), false);
  }

  const textRequirementsState = {
    requirements: "背景过于曝光，保持主体与构图",
    context: { surface: "art", artGenerateMode: "txt2img" },
    mode: "optimize",
    starterPreset: "",
    artTask: "create",
    artStyle: "auto",
    preserveLevel: "high",
    images: [],
    referenceRoles: []
  };
  const buildTextRequirements = vm.runInNewContext(`(${buildRequirementsSource})`, {
    state: textRequirementsState,
    stripTrailingGenericArtPreservation,
    window: { NovaFlowArtQualityProfile: { build: () => ({ directorInstruction: "高质量CG渲染约束：保留完整商业插画质量" }) } },
    ART_TASK_PRESETS: [],
    ART_STYLE_PRESETS: [],
    selectedArtStarterLabel: () => "",
    artReferenceRoleLabel: () => "",
    artStyleInstruction: () => "",
    artStylePriorityInstruction: () => "风格遵循原始提示词",
    artHighQualityCgRenderingGuardInstruction: () => "高质量CG渲染约束",
    artAssetPreservationInstruction: () => "保留资产身份",
    artAutomaticQualityInstruction: () => "基础质量由系统自动负责",
    artBackgroundInstruction: () => ""
  });
  const editRequirements = buildTextRequirements({
    includeUserIntent: true,
    userIntentFirst: true,
    purpose: "optimize"
  });
  assert.equal(editRequirements.split("\n")[0], "用户本次修改要求（最高优先级）：背景过于曝光");
  assert.doesNotMatch(editRequirements.split("\n")[0], /保持主体与构图/);
  assert.match(editRequirements, /完整原提示词为唯一底稿/);
  assert.match(editRequirements, /未提及信息必须保留/);
  assert.match(editRequirements, /修改后的完整可生图提示词/);
  assert.match(editRequirements, /高质量CG渲染约束/);
  textRequirementsState.requirements = "";
  const emptyEditRequirements = buildTextRequirements({
    includeUserIntent: true,
    userIntentFirst: true,
    purpose: "optimize"
  });
  assert.match(emptyEditRequirements, /^提示词编辑模式：/,
    "an empty edit instruction must still carry the full-prompt preservation contract");
  textRequirementsState.requirements = "设计一名银发东方女剑客";
  const createRequirements = buildTextRequirements({
    includeUserIntent: true,
    userIntentFirst: true,
    purpose: "create"
  });
  assert.equal(createRequirements.split("\n")[0], "用户本次创作要求（最高优先级）：设计一名银发东方女剑客");
  assert.match(createRequirements, /当前没有原提示词/);
  assert.match(createRequirements, /高质量CG渲染约束/);

  const structuredBasePrompt = [
    "主体：两位25岁以上的成年东方女性，五官特征明确不同，左侧青绿色华服，右侧象牙白与淡金色华服。",
    "动作与构图：两人坐在丝绸床榻上亲密依偎并温柔亲吻，四只手归属明确，双腿自然交叠，形成稳定三角形和S形视觉动线。",
    "背景与光线：象牙白与淡金色宫廷空间，丝绸帷幔和雕花屏风若隐若现，柔和高调光线照亮人物。",
    "风格：顶级中国幻想RPG游戏CG，精致东方二次元厚涂，半写实动漫数字绘画，复杂丝绸薄纱、金色刺绣和翡翠珠宝。",
    "要求：两位角色必须明确为成年女性；两张脸具有明显不同的五官特征；四只手结构正确且归属明确；双腿结构自然并能够明确判断属于哪位角色；身体交叠关系合理；服装、头发和首饰不能互相错误融合。",
    "避免：真人摄影、3D渲染、塑料皮肤、幼态儿童比例、廉价网游风、简单赛璐璐、过度锐化、错误手指、多余手臂、多余腿、融合肢体、复制脸、两个人长相完全相同。",
    "画面目标：**一张高完成度、性感柔美、具有细腻肌肤与丝绸质感的中国幻想双女性角色游戏 CG 厚涂插画。**"
  ].join("\n\n");
  const completeBackgroundRevision = [
    "主体：两位25岁以上的成年东方女性，五官特征明确不同，左侧穿青绿色华服，右侧穿象牙白与淡金色华服。",
    "动作与构图：两人坐在丝绸床榻上亲密依偎并温柔亲吻，四只手归属明确，双腿自然交叠，保持稳定三角形构图和S形视觉动线。",
    "背景与光线：象牙白与淡金色宫廷空间保留丝绸帷幔和雕花屏风，降低过曝高光，恢复背景纹理、明暗层次和主体边缘对比，整体明亮但不刺眼。",
    "风格：顶级中国幻想RPG游戏CG，精致东方二次元厚涂，半写实动漫数字绘画，细致表现复杂丝绸薄纱、金色刺绣和翡翠珠宝。",
    "要求：两位角色必须明确为成年女性；两张脸具有明显不同的五官特征；四只手结构正确且归属明确；双腿结构自然并能够明确判断属于哪位角色；身体交叠关系合理；服装、头发和首饰不能互相错误融合。",
    "避免：真人摄影、3D渲染、塑料皮肤、幼态儿童比例、廉价网游风、简单赛璐璐、过度锐化、错误手指、多余手臂、多余腿、融合肢体、复制脸、两个人长相完全相同。",
    "画面目标：**一张高完成度、性感柔美、具有细腻肌肤与丝绸质感的中国幻想双女性角色游戏 CG 厚涂插画。**"
  ].join("\n\n");
  const completePreservation = validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    completeBackgroundRevision,
    "背景过于曝光"
  );
  assert.equal(completePreservation.ok, true, "a complete scoped revision must pass the preservation gate");
  const unchangedRevision = validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    structuredBasePrompt,
    "背景过于曝光"
  );
  assert.equal(unchangedRevision.ok, false,
    "an unchanged prompt must not count as a successful requested edit");
  assert.equal(unchangedRevision.code, "prompt_edit_not_applied");
  assert.match(smartAiFailureMessage(smartAiPromptPreservationError(unchangedRevision)),
    /^提示词优化未写入\n.*没有执行本次修改/);
  assert.equal(validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    `  ${structuredBasePrompt.replace(/[，。；：]/g, " ")}  `,
    "背景过于曝光"
  ).code, "prompt_edit_not_applied", "format-only changes must remain a no-op");
  assert.equal(validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    structuredBasePrompt,
    "保持原样"
  ).ok, true, "an explicit keep-unchanged instruction may return the original prompt");
  assert.equal(validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    structuredBasePrompt,
    "保留人物和构图"
  ).ok, true, "a preservation-only instruction may return the original prompt");
  assert.equal(validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    structuredBasePrompt,
    "keep as is"
  ).ok, true, "the English keep-as-is instruction may return the original prompt");
  assert.equal(validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    structuredBasePrompt,
    "保持人物，背景改得更暗"
  ).code, "prompt_edit_not_applied",
  "a preservation prefix must not hide a real edit request later in the sentence");
  const nightForestRevision = completeBackgroundRevision.replace(
    /\n\n背景与光线：[^\n]+/,
    "\n\n背景与光线：深夜森林笼罩在蓝紫色月光与薄雾中，古树、苔藓、萤火和远处山影形成幽深空间，人物获得清晰的冷暖边缘光。"
  );
  assert.equal(validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    nightForestRevision,
    "把背景与光线完全改成夜间森林"
  ).ok, true, "an explicitly targeted background block may be completely rewritten");
  const whiteDragonRevision = completeBackgroundRevision.replace(
    /主体：[^\n]+/,
    "主体：一条通体雪白、覆盖细密珍珠鳞片的成年东方白龙，金色龙角与碧玉双眼清晰可见。"
  );
  assert.equal(validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    whiteDragonRevision,
    "主体完全改成白龙"
  ).ok, true, "an explicitly targeted subject block may be completely rewritten");
  const targetedBackgroundWithoutRequirements = nightForestRevision.replace(/\n\n要求：[^\n]+/, "");
  const targetedBackgroundMissingTail = validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    targetedBackgroundWithoutRequirements,
    "把背景与光线完全改成夜间森林"
  );
  assert.equal(targetedBackgroundMissingTail.ok, false,
    "targeting a content block must never waive a trailing preservation constraint");
  assert.equal(targetedBackgroundMissingTail.missingBlocks.includes("要求"), true);
  const collapsedRevision = validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    "需要调整为柔和的光线效果，确保整体画面明亮而不刺眼，细节清晰可见，背景元素与主体之间有良好的层次感和对比度。",
    "背景过于曝光"
  );
  assert.equal(collapsedRevision.ok, false, "a local background suggestion must not replace a complete prompt");
  assert.equal(collapsedRevision.code, "prompt_preservation_incomplete");
  assert.equal(collapsedRevision.missingBlocks.includes("要求"), true);
  assert.equal(collapsedRevision.missingBlocks.includes("避免"), true);
  assert.equal(collapsedRevision.missingBlocks.includes("画面目标"), true,
    "the exact user case's trailing target block must be part of the fail-closed evidence");
  const collapsedMessage = smartAiFailureMessage(smartAiPromptPreservationError(collapsedRevision));
  assert.match(collapsedMessage, /^提示词优化未写入\n/);
  assert.match(collapsedMessage, /本次未覆盖.*原提示词保持不变/);
  const missingRequiredBlock = validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    completeBackgroundRevision.replace(/\n\n要求：[^\n]+/, ""),
    "背景过于曝光"
  );
  assert.equal(missingRequiredBlock.ok, false, "an unrequested constraint-block deletion must fail closed");
  assert.deepEqual(Array.from(missingRequiredBlock.missingBlocks), ["要求"]);
  const hollowRequiredBlock = validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    completeBackgroundRevision.replace(/\n\n要求：[^\n]+/, "\n\n要求：保持质量。"),
    "背景过于曝光"
  );
  assert.equal(hollowRequiredBlock.ok, false, "retaining a block label without its constraints must still fail closed");
  assert.deepEqual(Array.from(hollowRequiredBlock.missingBlocks), ["要求"]);
  const fakeBodyLabelMentions = completeBackgroundRevision
    .replace(/\n\n要求：[^\n]+/, "")
    .replace(/\n\n避免：[^\n]+/, "")
    .replace("整体明亮但不刺眼。", "整体明亮但不刺眼，质量要求保持高完成度并避免塑料皮肤。 ");
  const fakeBodyLabelResult = validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    fakeBodyLabelMentions,
    "背景过于曝光"
  );
  assert.equal(fakeBodyLabelResult.ok, false,
    "body prose mentioning quality requirements and avoid terms must not impersonate real block labels");
  assert.equal(fakeBodyLabelResult.missingBlocks.includes("要求"), true);
  assert.equal(fakeBodyLabelResult.missingBlocks.includes("避免"), true);
  const withoutAvoidBlock = completeBackgroundRevision.replace(/\n\n避免：[^\n]+/, "");
  assert.equal(validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    withoutAvoidBlock,
    "删除避免项，其他人物、构图和风格保持不变"
  ).ok, true, "an explicitly named block may be removed");
  assert.equal(validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    "柔和明亮的背景光线。",
    "删除避免项"
  ).ok, false, "permission to delete one named block must not permit collapsing the rest of the prompt");
  assert.equal(validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    "不要塑料皮肤，背景柔和明亮。",
    "不要塑料皮肤"
  ).ok, false, "negative wording must not be mistaken for an explicit block-removal command");
  const withoutBackgroundBlock = completeBackgroundRevision.replace(/\n\n背景与光线：[^\n]+/, "");
  const scopedBackgroundDeletion = validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    withoutBackgroundBlock,
    "删除背景与光线中的过曝描述，其他内容不变"
  );
  assert.equal(scopedBackgroundDeletion.ok, false,
    "deleting one description inside a block must not authorize deleting the whole block");
  assert.equal(scopedBackgroundDeletion.missingBlocks.includes("背景与光线"), true);
  assert.equal(validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    withoutAvoidBlock,
    "删除整个避免项，其他内容保持不变"
  ).ok, true, "a small canonical whole-block prefix must remain supported");

  assert.equal(validateSmartAiStructuredArtPrompt(STRUCTURED_ART_EDIT_FIXTURE).ok, true,
    "the complete six-section TOML-like prompt must pass the renderer writeback gate");
  const wrongSlotStructuredPrompts = [
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u5a92\u4ecb\s*=.*$/mu,
      '\u5a92\u4ecb = "art"'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u7ed8\u753b\u8bed\u8a00\s*=.*$/mu,
      '\u7ed8\u753b\u8bed\u8a00 = "Chinese"'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u5b8c\u6210\u8d28\u611f\s*=.*$/mu,
      '\u5b8c\u6210\u8d28\u611f = "high\uff0c\u753b\u9762\u8d28\u611f\u7ec6\u817b\u4e30\u5bcc"'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u5b8c\u6210\u8d28\u611f\s*=.*$/mu,
      '\u5b8c\u6210\u8d28\u611f = "high, image quality is refined with rich material detail"'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u5b8c\u6210\u8d28\u611f\s*=.*$/mu,
      '\u5b8c\u6210\u8d28\u611f = "high, Image Quality Is Refined With Rich Material Detail"'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u6c1b\u56f4\s*=.*$/mu,
      '\u6c1b\u56f4 = "atmosphere"'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u666f\u522b\s*=.*$/mu,
      '\u666f\u522b = "shot"'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u89c6\u89d2\s*=.*$/mu,
      '\u89c6\u89d2 = "view"'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u900f\u89c6\s*=.*$/mu,
      '\u900f\u89c6 = "intimate"'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u666f\u6df1\s*=.*$/mu,
      '\u666f\u6df1 = "soft"'
    )
  ];
  for (const wrongSlotPrompt of wrongSlotStructuredPrompts) {
    assert.equal(validateSmartAiStructuredArtPrompt(wrongSlotPrompt).code, "semantic_slot_mismatch",
      "generic or wrong-domain values must not satisfy a fixed structured prompt slot");
  }
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE
      .replace(/^\u5a92\u4ecb\s*=.*$/mu, '\u5a92\u4ecb = "\u6c34\u5f69"')
      .replace(/^\u7ed8\u753b\u8bed\u8a00\s*=.*$/mu, '\u7ed8\u753b\u8bed\u8a00 = "\u539a\u6d82"')
      .replace(/^\u666f\u6df1\s*=.*$/mu, '\u666f\u6df1 = "\u6d45\u666f\u6df1"')
  ).ok, true, "short but semantically exact slot values must remain valid");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace(/^\u5a92\u4ecb\s*=.*$/mu, '\u5a92\u4ecb = "3D"')
  ).ok, true, "bare 3D is a valid medium and must stay aligned with signed Local/Grok output");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace(/^\u666f\u6df1\s*=.*$/mu, '\u666f\u6df1 = "\u6563\u666f"')
  ).ok, true, "Chinese bokeh is a valid depth-of-field value and must stay aligned with signed output");
  assert.equal(validateSmartAiStructuredArtPrompt(
    `说明：以下是优化后的提示词\n${STRUCTURED_ART_EDIT_FIXTURE}`
  ).code, "meta_content", "model-facing preamble/meta prose must fail closed");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace("[主体物品]", "[环境背景]")
  ).code, "section_order", "the six sections must keep their exact order");
  assert.equal(validateSmartAiStructuredArtPrompt(
    `${STRUCTURED_ART_EDIT_FIXTURE}\n[用户附加要求]\n结果 = "重复末段"`
  ).code, "duplicate_section", "duplicate sections must fail closed");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace('媒介 = "数字绘画"', "数字绘画")
  ).code, "invalid_toml_key_value", "free prose inside a section must fail closed");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      '完成质感 = "皮肤、丝绸、薄纱、金属刺绣与翡翠材质层次清晰"',
      '完成质感 = "柔光；请增加质感"'
    )
  ).code, "meta_instruction_value", "Chinese mid-value operation instructions must fail closed");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      '完成质感 = "皮肤、丝绸、薄纱、金属刺绣与翡翠材质层次清晰"',
      '完成质感 = "soft light; please increase texture detail"'
    )
  ).code, "meta_instruction_value", "English mid-value operation instructions must fail closed");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      '完成质感 = "皮肤、丝绸、薄纱、金属刺绣与翡翠材质层次清晰"',
      '完成质感 = "柔光；调整背景曝光"'
    )
  ).code, "meta_instruction_value", "bare Chinese operation instructions at sentence boundaries must fail closed");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      '完成质感 = "皮肤、丝绸、薄纱、金属刺绣与翡翠材质层次清晰"',
      '完成质感 = "soft light; adjust the background exposure"'
    )
  ).code, "meta_instruction_value", "bare English operation instructions at sentence boundaries must fail closed");
  const frontFiveCommandOrEnvelopePrompts = [
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^裁切 = .*$/mu,
      '裁切 = "Do not crop the figures."'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^遮挡层次 = .*$/mu,
      '遮挡层次 = "Without occlusions."'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^媒介 = .*$/mu,
      '媒介 = "Here is the optimized prompt."'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^裁切 = .*$/mu,
      '裁切 = "Figures should not be cropped."'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^遮挡层次 = .*$/mu,
      '遮挡层次 = "No occlusions."'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^媒介 = .*$/mu,
      '媒介 = "Here\'s your revised prompt."'
    )
  ];
  frontFiveCommandOrEnvelopePrompts.push(
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u88c1\u5207 = .*$/mu,
      '\u88c1\u5207 = "Keep both figures fully in frame."'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u906e\u6321\u5c42\u6b21 = .*$/mu,
      '\u906e\u6321\u5c42\u6b21 = "Ensure no occlusions."'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u5a92\u4ecb = .*$/mu,
      '\u5a92\u4ecb = "Below is the optimized prompt."'
    ),
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u5a92\u4ecb = .*$/mu,
      '\u5a92\u4ecb = "I\'ve optimized the prompt."'
    )
  );
  for (const commandOrEnvelopePrompt of frontFiveCommandOrEnvelopePrompts) {
    assert.equal(validateSmartAiStructuredArtPrompt(commandOrEnvelopePrompt).code, "meta_instruction_value",
      "front-five compiled values must reject commands and optimized-prompt envelope prose");
  }
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^裁切 = .*$/mu,
      '裁切 = "人物完整入镜，遮挡关系清晰"'
    )
  ).ok, true, "a Chinese noun-led finalized framing state must remain valid");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^裁切 = .*$/mu,
      '裁切 = "clear full-body framing with unobstructed silhouettes"'
    )
  ).ok, true, "an English noun-led finalized framing state must remain valid");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      /^\u5149\u6e90\u8f6f\u786c = .*$/mu,
      '\u5149\u6e90\u8f6f\u786c = "Without harsh shadows, smooth skin highlights."'
    )
  ).ok, true, "an English final-state lighting description beginning with without must remain valid");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      '要求2 = "背景曝光受控且画面保持明亮柔和，人物、服装、亲吻姿态、材质与整体风格均保持不变"',
      '要求2 = "背景曝光受控且画面明亮柔和，人物结构和服装材质稳定"'
    )
  ).ok, true, "a noun-led finalized visual state must not be mistaken for an operation instruction");
  const maliciousLongShell = [
    "[风格设定]", 'a1 = "甲'.concat('长'.repeat(90), '"'), 'a2 = "乙'.concat('长'.repeat(90), '"'), 'a3 = "丙'.concat('长'.repeat(90), '"'), 'a4 = "丁'.concat('长'.repeat(90), '"'),
    "[主体物品]", 'a1 = "主体长壳"', 'a2 = "主体长壳"', 'a3 = "主体长壳"', 'a4 = "主体长壳"',
    "[环境背景]", 'a1 = "环境长壳"', 'a2 = "背景长壳"', 'a3 = "空间长壳"',
    "[光线与色彩]", 'a1 = "光线长壳"', 'a2 = "色彩长壳"', 'a3 = "阴影长壳"',
    "[拍摄参数]", 'a1 = "镜头长壳"', 'a2 = "视角长壳"', 'a3 = "构图长壳"', 'a4 = "景深长壳"',
    "[用户附加要求]", 'a1 = "画面质感层次清晰"'
  ].join("\n");
  assert.ok(maliciousLongShell.replace(/\s+/g, "").length >= 300);
  assert.equal(validateSmartAiStructuredArtPrompt(maliciousLongShell).code, "fixed_section_keys_mismatch",
    "a long six-section a1/a2 shell must not satisfy the fixed compiler-key contract");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace("主体数量 = 2", "主体数量 = 3")
  ).code, "subject_keys_mismatch", "subject_count must match every contiguous compiled subject field group");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace("主体数量 = 2", "主体数量 = 0")
  ).code, "invalid_subject_count", "subject_count must be a numeric integer in the range 1..12");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace("主体2动作 =", "主体3动作 =")
  ).code, "subject_keys_mismatch", "subject indices must be continuous and agree with subject_count");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace("要求2 =", "要求3 =")
  ).code, "requirement_keys_mismatch", "terminal requirement keys must be continuous from 要求1");
  assert.equal(validateSmartAiStructuredArtPrompt(
    `${STRUCTURED_ART_EDIT_FIXTURE}\n额外键 = "不得进入固定编译输出"`
  ).code, "requirement_keys_mismatch", "the terminal section must reject every non-要求N extra key");
  assert.equal(validateSmartAiStructuredArtPrompt(
    STRUCTURED_ART_EDIT_FIXTURE.replace(
      '\n\n[主体物品]',
      '\n风格额外键 = "伪造的长输出字段"\n\n[主体物品]'
    )
  ).code, "fixed_section_keys_mismatch", "fixed front-five sections must reject extra keys");

  for (const engine of ["grok", "local"]) {
    const collapsedWriteback = createSmartAiSubmitHarness({
      engine,
      imageCount: 0,
      initialArtGenerateMode: "txt2img",
      hadInitialPrompt: true,
      initialPrompt: structuredBasePrompt,
      userIntent: "背景过于曝光",
      internalRequirements: editRequirements,
      response: {
        ok: true,
        prompt: "需要调整为柔和的光线效果，确保整体画面明亮而不刺眼，细节清晰可见，背景元素与主体之间有良好的层次感和对比度。",
        negative_prompt: "过曝, 高光溢出, 低对比",
        has_negative_prompt: true
      }
    });
    await collapsedWriteback.runSmartAi();
    const modelCalls = engine === "grok" ? collapsedWriteback.calls.grokOptimize : collapsedWriteback.calls.localOptimize;
    assert.equal(modelCalls.length, 1, `${engine} must complete the requested model call before client validation`);
    assert.equal(collapsedWriteback.calls.writes.length, 0,
      `${engine} must fail closed before an incomplete candidate overwrites the full prompt`);
    assert.equal(collapsedWriteback.positive.value, structuredBasePrompt);
    assert.match(collapsedWriteback.state.message, /未返回兼容的完整结构化提示词合同/);
    assert.match(collapsedWriteback.state.message, /本次未覆盖.*原提示词保持不变/);
  }

  const deterministicMergedCandidate = "两名明确成年的男女位于卧室床榻上，保持原有角色身份、画风和构图约束；补充男性平躺、女性坐在其身上的成人亲密姿态，镜头只表现必要构图，画面仍为高完成度游戏CG。";
  assert.equal(validateSmartAiArtPromptPreservation(
    structuredBasePrompt,
    deterministicMergedCandidate,
    "补充成人男女的床上姿态"
  ).ok, false, "the legacy unmarked lexical preservation gate must still reject a collapsed candidate");
  for (const engine of ["grok", "local"]) {
    const deterministicWriteback = createSmartAiSubmitHarness({
      engine,
      imageCount: 0,
      initialArtGenerateMode: "txt2img",
      hadInitialPrompt: true,
      initialPrompt: structuredBasePrompt,
      userIntent: "补充成人男女的床上姿态",
      internalRequirements: editRequirements,
      response: {
        ok: true,
        prompt: STRUCTURED_ART_EDIT_FIXTURE,
        negative_prompt: "未成年人, 错误肢体, 低质量",
        has_negative_prompt: true,
        editContract: ORDINARY_ART_EDIT_CONTRACT,
        promptSchema: ORDINARY_ART_PROMPT_SCHEMA
      }
    });
    await deterministicWriteback.runSmartAi();
    assert.equal(deterministicWriteback.calls.writes.length, 1,
      `${engine} must write a backend-confirmed structured recompile without re-running the legacy lexical gate`);
    assert.equal(deterministicWriteback.calls.writes[0].prompt, STRUCTURED_ART_EDIT_FIXTURE,
      `${engine} must preserve every character and newline of the structured model result`);
  }

  for (const incompatibleMarkers of [
    { editContract: ORDINARY_ART_EDIT_CONTRACT },
    { editContract: "deterministic-merge-v1", promptSchema: ORDINARY_ART_PROMPT_SCHEMA },
    { editContract: ORDINARY_ART_EDIT_CONTRACT, promptSchema: `${ORDINARY_ART_PROMPT_SCHEMA}<script>` }
  ]) {
    const incompatibleContract = createSmartAiSubmitHarness({
      engine: "local",
      imageCount: 0,
      initialArtGenerateMode: "txt2img",
      hadInitialPrompt: true,
      initialPrompt: structuredBasePrompt,
      userIntent: "背景过于曝光",
      internalRequirements: editRequirements,
      response: {
        ok: true,
        prompt: STRUCTURED_ART_EDIT_FIXTURE,
        negative_prompt: "过曝",
        has_negative_prompt: true,
        ...incompatibleMarkers
      }
    });
    await incompatibleContract.runSmartAi();
    assert.equal(incompatibleContract.calls.writes.length, 0,
      "both exact structured-recompile markers must be present before renderer writeback");
    assert.match(incompatibleContract.state.message, /未返回兼容的完整结构化提示词合同/);
  }

  const deterministicNoOp = createSmartAiSubmitHarness({
    engine: "local",
    imageCount: 0,
    initialArtGenerateMode: "txt2img",
    hadInitialPrompt: true,
    initialPrompt: STRUCTURED_ART_EDIT_FIXTURE,
    userIntent: "补充成人男女的床上姿态",
    internalRequirements: editRequirements,
    response: {
      ok: true,
      prompt: STRUCTURED_ART_EDIT_FIXTURE,
      negative_prompt: "低质量",
      has_negative_prompt: true,
      editContract: ORDINARY_ART_EDIT_CONTRACT,
      promptSchema: ORDINARY_ART_PROMPT_SCHEMA
    }
  });
  await deterministicNoOp.runSmartAi();
  assert.equal(deterministicNoOp.calls.writes.length, 0,
    "deterministic merge metadata must never authorize a no-op response");
  assert.match(deterministicNoOp.state.message, /没有执行本次修改/);

  const deterministicMetaInstruction = createSmartAiSubmitHarness({
    engine: "grok",
    imageCount: 0,
    initialArtGenerateMode: "txt2img",
    hadInitialPrompt: true,
    initialPrompt: structuredBasePrompt,
    userIntent: "背景降低曝光",
    internalRequirements: editRequirements,
    response: {
      ok: true,
      prompt: STRUCTURED_ART_EDIT_FIXTURE.replace(
        '完成质感 = "皮肤、丝绸、薄纱、金属刺绣与翡翠材质层次清晰"',
        '完成质感 = "柔光；请增加质感"'
      ),
      negative_prompt: "过曝",
      has_negative_prompt: true,
      editContract: ORDINARY_ART_EDIT_CONTRACT,
      promptSchema: ORDINARY_ART_PROMPT_SCHEMA
    }
  });
  await deterministicMetaInstruction.runSmartAi();
  assert.equal(deterministicMetaInstruction.calls.writes.length, 0,
    "deterministic merge metadata must not authorize a model operation instruction");

  const unsignedShortSixSection = createSmartAiSubmitHarness({
    engine: "local",
    imageCount: 0,
    initialArtGenerateMode: "txt2img",
    hadInitialPrompt: true,
    initialPrompt: structuredBasePrompt,
    userIntent: "增加画面质感",
    internalRequirements: editRequirements,
    response: {
      ok: true,
      prompt: maliciousLongShell.replace('a1 = "画面质感层次清晰"', 'a1 = "增加画面质感"'),
      negative_prompt: "低质量",
      has_negative_prompt: true
    }
  });
  await unsignedShortSixSection.runSmartAi();
  assert.equal(unsignedShortSixSection.calls.writes.length, 0,
    "a shallow six-section response whose only actionable content is the raw request must be rejected without exact markers");
  assert.match(unsignedShortSixSection.state.message, /未返回兼容的完整结构化提示词合同/);

  for (const invalidCompiledPrompt of [
    maliciousLongShell,
    STRUCTURED_ART_EDIT_FIXTURE.replace("主体数量 = 2", "主体数量 = 3"),
    STRUCTURED_ART_EDIT_FIXTURE.replace("要求2 =", "要求3 =")
  ]) {
    const signedInvalidCompiledPrompt = createSmartAiSubmitHarness({
      engine: "local",
      imageCount: 0,
      initialArtGenerateMode: "txt2img",
      hadInitialPrompt: true,
      initialPrompt: structuredBasePrompt,
      userIntent: "背景过于曝光",
      internalRequirements: editRequirements,
      response: {
        ok: true,
        prompt: invalidCompiledPrompt,
        negative_prompt: "过曝",
        has_negative_prompt: true,
        editContract: ORDINARY_ART_EDIT_CONTRACT,
        promptSchema: ORDINARY_ART_PROMPT_SCHEMA
      }
    });
    await signedInvalidCompiledPrompt.runSmartAi();
    assert.equal(signedInvalidCompiledPrompt.calls.writes.length, 0,
      "exact markers must not authorize a prompt whose compiled key contract is invalid");
    assert.match(signedInvalidCompiledPrompt.state.message, /不是完整、严格的六段结构化生图提示词/);
  }

  for (const frontFiveCommandOrEnvelopePrompt of frontFiveCommandOrEnvelopePrompts) {
    const signedFrontFiveMetaPrompt = createSmartAiSubmitHarness({
      engine: "local",
      imageCount: 0,
      initialArtGenerateMode: "txt2img",
      hadInitialPrompt: true,
      initialPrompt: structuredBasePrompt,
      userIntent: "背景过于曝光",
      internalRequirements: editRequirements,
      response: {
        ok: true,
        prompt: frontFiveCommandOrEnvelopePrompt,
        negative_prompt: "过曝",
        has_negative_prompt: true,
        editContract: ORDINARY_ART_EDIT_CONTRACT,
        promptSchema: ORDINARY_ART_PROMPT_SCHEMA
      }
    });
    await signedFrontFiveMetaPrompt.runSmartAi();
    assert.equal(signedFrontFiveMetaPrompt.calls.writes.length, 0,
      "exact markers must not authorize a front-five command or optimized-prompt envelope");
    assert.match(signedFrontFiveMetaPrompt.state.message, /不是完整、严格的六段结构化生图提示词/);
  }

  const resourceAlias = "@参考图1";
  const resourcePlaceholder = "__NOVAFLOW_RESOURCE_MENTION_1__";
  const resourceMentionTool = {
    protectText(text) {
      const source = String(text || "");
      if (!source.includes(resourceAlias)) return { text: source, tokens: [] };
      return {
        text: source.replace(resourceAlias, resourcePlaceholder),
        tokens: [{ placeholder: resourcePlaceholder, token: resourceAlias }]
      };
    },
    restoreText(text) {
      return { ok: true, text: String(text || "").replace(resourcePlaceholder, resourceAlias) };
    }
  };
  const deterministicResourceLoss = createSmartAiSubmitHarness({
    engine: "local",
    imageCount: 0,
    initialArtGenerateMode: "txt2img",
    hadInitialPrompt: true,
    initialPrompt: `${structuredBasePrompt}\n\n构图参考：${resourceAlias}`,
    userIntent: "补充成人男女的床上姿态",
    internalRequirements: editRequirements,
    resourceMentionTool,
    response: {
      ok: true,
      prompt: deterministicMergedCandidate,
      negative_prompt: "低质量",
      has_negative_prompt: true,
      editContract: ORDINARY_ART_EDIT_CONTRACT,
      promptSchema: ORDINARY_ART_PROMPT_SCHEMA
    }
  });
  await deterministicResourceLoss.runSmartAi();
  assert.equal(deterministicResourceLoss.calls.writes.length, 0,
    "deterministic merge metadata must not bypass missing resource-placeholder rejection");
  assert.match(deterministicResourceLoss.state.message, /资源引用/);

  for (const engine of ["grok", "local"]) {
    const completeWriteback = createSmartAiSubmitHarness({
      engine,
      imageCount: 0,
      initialArtGenerateMode: "txt2img",
      hadInitialPrompt: true,
      initialPrompt: structuredBasePrompt,
      userIntent: "背景过于曝光",
      internalRequirements: editRequirements,
      response: {
        ok: true,
        prompt: STRUCTURED_ART_EDIT_FIXTURE,
        negative_prompt: "过曝, 高光溢出, 错误手指, 多余肢体",
        has_negative_prompt: true,
        editContract: ORDINARY_ART_EDIT_CONTRACT,
        promptSchema: ORDINARY_ART_PROMPT_SCHEMA
      }
    });
    await completeWriteback.runSmartAi();
    assert.equal(completeWriteback.calls.writes.length, 1, `${engine} complete revision must remain writable`);
    assert.equal(completeWriteback.calls.writes[0].prompt, STRUCTURED_ART_EDIT_FIXTURE);
  }

  let resolveStaleStructuredEdit;
  const staleStructuredEditResponse = new Promise((resolve) => { resolveStaleStructuredEdit = resolve; });
  const staleStructuredEdit = createSmartAiSubmitHarness({
    engine: "local",
    imageCount: 0,
    initialArtGenerateMode: "txt2img",
    hadInitialPrompt: true,
    initialPrompt: structuredBasePrompt,
    userIntent: "背景过于曝光",
    internalRequirements: editRequirements,
    response: staleStructuredEditResponse
  });
  const staleStructuredEditRun = staleStructuredEdit.runSmartAi();
  staleStructuredEdit.positive.value = "请求期间用户写入的新提示词";
  resolveStaleStructuredEdit({
    ok: true,
    prompt: STRUCTURED_ART_EDIT_FIXTURE,
    negative_prompt: "过曝",
    has_negative_prompt: true,
    editContract: ORDINARY_ART_EDIT_CONTRACT,
    promptSchema: ORDINARY_ART_PROMPT_SCHEMA
  });
  await staleStructuredEditRun;
  assert.equal(staleStructuredEdit.calls.writes.length, 0,
    "a stale structured Art edit must be discarded before marker or writeback validation can overwrite newer text");
  assert.match(staleStructuredEdit.state.message, /旧分析结果已丢弃/);

  const namedDeletionWriteback = createSmartAiSubmitHarness({
    engine: "local",
    imageCount: 0,
    initialArtGenerateMode: "txt2img",
    hadInitialPrompt: true,
    initialPrompt: structuredBasePrompt,
    userIntent: "删除避免项，其他人物、构图和风格保持不变",
    internalRequirements: editRequirements,
    response: {
      ok: true,
      prompt: STRUCTURED_ART_EDIT_FIXTURE,
      negative_prompt: "低质量, 模糊",
      has_negative_prompt: true,
      editContract: ORDINARY_ART_EDIT_CONTRACT,
      promptSchema: ORDINARY_ART_PROMPT_SCHEMA
    }
  });
  await namedDeletionWriteback.runSmartAi();
  assert.equal(namedDeletionWriteback.calls.writes.length, 1,
    "an explicitly named deletion must pass the same writeback gate without disabling other preservation checks");

  const fullBasePrompt = STRUCTURED_ART_EDIT_FIXTURE.replace(
    "背景过曝高光受到抑制",
    "背景高光明显过曝"
  );
  for (const engine of ["grok", "local"]) {
    const edit = createSmartAiSubmitHarness({
      engine,
      imageCount: 0,
      initialArtGenerateMode: "txt2img",
      hadInitialPrompt: true,
      initialPrompt: fullBasePrompt,
      userIntent: "背景过于曝光",
      internalRequirements: editRequirements
    });
    await edit.runSmartAi();
    const editCalls = engine === "grok" ? edit.calls.grokOptimize : edit.calls.localOptimize;
    assert.equal(editCalls.length, 1, `${engine} text edit must use the optimize bridge`);
    assert.equal(editCalls[0].prompt, fullBasePrompt);
    assert.equal(editCalls[0].currentPrompt, fullBasePrompt);
    assert.equal(editCalls[0].purpose, "optimize");
    assert.equal(editCalls[0].surface, "art");
    assert.equal(editCalls[0].promptSchema, ORDINARY_ART_PROMPT_SCHEMA);
    assert.equal(editCalls[0].requirements.split("\n")[0], "用户本次修改要求（最高优先级）：背景过于曝光");
    assert.match(editCalls[0].requirements, /未提及信息必须保留/);
    assert.match(editCalls[0].requirements, /高质量CG渲染约束/);
  }

  const positiveOnlyLocalEdit = createSmartAiSubmitHarness({
    engine: "local",
    imageCount: 0,
    initialArtGenerateMode: "txt2img",
    hadInitialPrompt: true,
    initialPrompt: fullBasePrompt,
    userIntent: "背景过于曝光",
    internalRequirements: editRequirements,
    supportsNegativePrompt: false,
    response: {
      ok: true,
      prompt: STRUCTURED_ART_EDIT_FIXTURE,
      negative_prompt: "",
      has_negative_prompt: false,
      editContract: ORDINARY_ART_EDIT_CONTRACT,
      promptSchema: ORDINARY_ART_PROMPT_SCHEMA
    }
  });
  await positiveOnlyLocalEdit.runSmartAi();
  assert.equal(positiveOnlyLocalEdit.calls.localOptimize.length, 1);
  assert.equal(positiveOnlyLocalEdit.calls.localOptimize[0].supportsNegativePrompt, false,
    "Local Art text edit must preserve the no-negative capability of Ideogram txt2img");
  assert.equal(positiveOnlyLocalEdit.calls.localOptimize[0].nsfw, false,
    "Local Art text edit must forward the disabled NSFW state explicitly");
  assert.equal(positiveOnlyLocalEdit.calls.writes[0].options.supportsNegativePrompt, false);

  for (const engine of ["grok", "local"]) {
    const emptyEdit = createSmartAiSubmitHarness({
      engine,
      imageCount: 0,
      initialArtGenerateMode: "txt2img",
      hadInitialPrompt: true,
      initialPrompt: fullBasePrompt,
      userIntent: "",
      internalRequirements: emptyEditRequirements
    });
    await emptyEdit.runSmartAi();
    const emptyEditCalls = engine === "grok" ? emptyEdit.calls.grokOptimize : emptyEdit.calls.localOptimize;
    assert.equal(emptyEditCalls.length, 1,
      `${engine} must keep an existing prompt submittable without an explicit edit instruction`);
    assert.equal(emptyEditCalls[0].prompt, fullBasePrompt);
    assert.equal(emptyEditCalls[0].currentPrompt, fullBasePrompt);
    assert.equal(emptyEditCalls[0].purpose, "optimize");
    assert.equal(emptyEditCalls[0].surface, "art");
    assert.equal(emptyEditCalls[0].promptSchema, ORDINARY_ART_PROMPT_SCHEMA,
      `${engine} must request structured recompilation even when the optional instruction is empty`);
  }

  const livePromptAddedAfterOpen = createSmartAiSubmitHarness({
    engine: "local",
    imageCount: 0,
    initialArtGenerateMode: "txt2img",
    hadInitialPrompt: false,
    initialPrompt: fullBasePrompt,
    userIntent: "背景过于曝光",
    internalRequirements: editRequirements
  });
  await livePromptAddedAfterOpen.runSmartAi();
  assert.equal(livePromptAddedAfterOpen.calls.localOptimize[0].purpose, "optimize",
    "the live full prompt, not the dialog-open snapshot, must select edit mode");
  assert.equal(livePromptAddedAfterOpen.calls.localOptimize[0].currentPrompt, fullBasePrompt);
  assert.equal(livePromptAddedAfterOpen.calls.localOptimize[0].promptSchema, ORDINARY_ART_PROMPT_SCHEMA);

  for (const engine of ["grok", "local"]) {
    const createFromEmpty = createSmartAiSubmitHarness({
      engine,
      imageCount: 0,
      initialArtGenerateMode: "txt2img",
      hadInitialPrompt: true,
      initialPrompt: "",
      userIntent: "设计一名银发东方女剑客",
      internalRequirements: createRequirements
    });
    await createFromEmpty.runSmartAi();
    const createCalls = engine === "grok" ? createFromEmpty.calls.grokOptimize : createFromEmpty.calls.localOptimize;
    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].prompt, "");
    assert.equal(createCalls[0].currentPrompt, "");
    assert.equal(createCalls[0].purpose, "create",
      `${engine} must select create from an empty live prompt even when the dialog-open snapshot had a prompt`);
    assert.equal(Object.hasOwn(createCalls[0], "promptSchema"), false,
      `${engine} create must stay outside the structured edit contract`);
    assert.equal(createCalls[0].requirements.split("\n")[0], "用户本次创作要求（最高优先级）：设计一名银发东方女剑客");
  }

  for (const engine of ["grok", "local"]) {
    const textWithReference = createSmartAiSubmitHarness({
      engine,
      mode: "optimize",
      imageCount: 1,
      initialPrompt: STRUCTURED_ART_EDIT_FIXTURE,
      userIntent: "降低背景高光，保留人物设计"
    });
    await textWithReference.runSmartAi();
    const optimizeCalls = engine === "grok"
      ? textWithReference.calls.grokOptimize
      : textWithReference.calls.localOptimize;
    assert.equal(optimizeCalls.length, 1, `${engine} text mode must optimize even when a reference image exists`);
    assert.equal(optimizeCalls[0].prompt, STRUCTURED_ART_EDIT_FIXTURE);
    assert.equal(optimizeCalls[0].currentPrompt, STRUCTURED_ART_EDIT_FIXTURE);
    assert.equal(optimizeCalls[0].purpose, "optimize");
    assert.equal(optimizeCalls[0].promptSchema, ORDINARY_ART_PROMPT_SCHEMA);
    assert.equal(textWithReference.calls.grokReverse.length + textWithReference.calls.localReverse.length, 0,
      "text mode must not call image reverse just because references are present");
  }

  let resolveOptimizeWhileImagesLoad;
  const optimizeWhileImagesLoadResponse = new Promise((resolve) => {
    resolveOptimizeWhileImagesLoad = resolve;
  });
  const optimizeWhileImagesLoad = createSmartAiSubmitHarness({
    engine: "local",
    mode: "optimize",
    imageCount: 0,
    initialArtGenerateMode: "img2img",
    initialPrompt: STRUCTURED_ART_EDIT_FIXTURE,
    userIntent: "降低背景高光",
    response: optimizeWhileImagesLoadResponse
  });
  const optimizeWhileImagesLoadRun = optimizeWhileImagesLoad.runSmartAi();
  await Promise.resolve();
  optimizeWhileImagesLoad.state.images.push({
    imageUrl: "data:image/png;base64,LATE_REFERENCE",
    label: "稍后读取的参考图"
  });
  optimizeWhileImagesLoad.state.artTask = "preserve";
  optimizeWhileImagesLoad.state.artStyle = "original";
  optimizeWhileImagesLoad.state.referenceRoles = ["subject"];
  resolveOptimizeWhileImagesLoad({
    ok: true,
    prompt: STRUCTURED_ART_EDIT_FIXTURE.replace("背景过曝高光受到抑制", "背景高光进一步受到抑制"),
    negative_prompt: "低质量, 模糊",
    has_negative_prompt: true,
    editContract: ORDINARY_ART_EDIT_CONTRACT,
    promptSchema: ORDINARY_ART_PROMPT_SCHEMA
  });
  await optimizeWhileImagesLoadRun;
  assert.equal(optimizeWhileImagesLoad.calls.localOptimize.length, 1);
  assert.equal(optimizeWhileImagesLoad.calls.writes.length, 1,
    `a reference finishing its load must not discard an unrelated text-optimization result: ${optimizeWhileImagesLoad.state.message}`);

  for (const engine of ["grok", "local"]) {
    const harness = createSmartAiSubmitHarness({ engine, nsfw: engine === "local" });
    await harness.runSmartAi();
    const calls = engine === "grok" ? harness.calls.grokReverse : harness.calls.localReverse;
    assert.equal(calls.length, 1, `${engine} must use image reverse for the real single-image preserve submit`);
    assert.equal(calls[0].purpose, "static-image-reverse");
    assert.equal(calls[0].visualSchema, "nf.visual.v2");
    assert.equal(Object.hasOwn(calls[0], "promptSchema"), false,
      "reverse-image requests must stay outside the ordinary Art text-edit schema");
    assert.equal(calls[0].nsfw, true, "single-image v2 analysis must always allow adult-content classification independently of the generation switch");
    assert.match(calls[0].requirements, /保持主体身份并提升质量/);
    assert.match(calls[0].requirements, /保留蓝色发饰/);
    assert.match(calls[0].requirements, /不作为图片可见事实/);
    assert.doesNotMatch(calls[0].requirements, /当前选择摘要|处理目标：|保留程度：|目标风格：/,
      "image reverse must not expose removed hidden selections as user requirements");
    assert.doesNotMatch(calls[0].requirements, /高质量CG渲染约束|基础质量由系统自动负责/, "static reverse must not duplicate the submit-time quality protocol");
    assert.equal(Object.hasOwn(calls[0], "prompt"), false, "current prompt must not enter the visual fact request as prompt");
    assert.equal(Object.hasOwn(calls[0], "currentPrompt"), false, "current prompt must not enter the visual fact request as currentPrompt");
    assert.equal(harness.calls.grokOptimize.length + harness.calls.localOptimize.length, 0);
    assert.equal(harness.calls.compile, 0, "single main-image reverse must not enter the multi-reference compiler");
    assert.equal(harness.calls.writes.length, 1);
    assert.deepEqual(harness.calls.nsfwSets, [], "safe analysis must not enable the Art generation NSFW switch");
    assert.doesNotMatch(JSON.stringify(harness.calls.writes), /sexualized_pose|性暗示姿势/, "content warnings must never be written into positive or negative prompts");
    assert.equal(harness.calls.closed, 1, "a successful direct result must write back and close the simplified dialog");
    assert.deepEqual(harness.calls.warnings, engine === "local" ? ["本地反推已回退"] : []);
  }

  for (const engine of ["grok", "local"]) {
    const imageOnly = createSmartAiSubmitHarness({
      engine,
      mode: "reverse",
      imageCount: 1,
      initialPrompt: "",
      userIntent: "",
      hadInitialPrompt: false
    });
    await imageOnly.runSmartAi();
    const calls = engine === "grok" ? imageOnly.calls.grokReverse : imageOnly.calls.localReverse;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].requirements, "", "image-only reverse must not manufacture user requirements");
  }

  const textOptimizeKeepsGenerationMode = createSmartAiSubmitHarness({
    engine: "local",
    imageCount: 0,
    initialArtGenerateMode: "img2img",
    replacePromptControlsOnModeSet: true
  });
  await textOptimizeKeepsGenerationMode.runSmartAi();
  assert.deepEqual(textOptimizeKeepsGenerationMode.calls.modes, [],
    "text optimization must not change the Art generation mode");
  assert.equal(textOptimizeKeepsGenerationMode.calls.localOptimize.length, 1);
  assert.equal(textOptimizeKeepsGenerationMode.calls.writes[0].textareas.positive,
    textOptimizeKeepsGenerationMode.positive,
    "text optimization must keep writing to the current prompt control");

  const img2imgModeSwitch = createSmartAiSubmitHarness({
    engine: "local",
    imageCount: 1,
    initialArtGenerateMode: "txt2img",
    replacePromptControlsOnModeSet: true
  });
  await img2imgModeSwitch.runSmartAi();
  assert.deepEqual(img2imgModeSwitch.calls.modes, ["img2img"]);
  assert.equal(img2imgModeSwitch.calls.localReverse.length, 1);
  assert.equal(img2imgModeSwitch.calls.writes[0].textareas.positive.replacementAfterMode, true,
    "1-reference submit must reacquire prompt controls after Runtime switches to img2img");
  assert.notEqual(img2imgModeSwitch.calls.writes[0].textareas.positive, img2imgModeSwitch.positive);

  const missingModeBridge = createSmartAiSubmitHarness({
    engine: "local",
    imageCount: 1,
    initialArtGenerateMode: "txt2img",
    modeSetterAvailable: false
  });
  await missingModeBridge.runSmartAi();
  assert.equal(missingModeBridge.calls.localReverse.length, 0,
    "Art reverse must stop before model invocation when Runtime cannot switch mode");
  assert.equal(missingModeBridge.calls.writes.length, 0);
  assert.match(missingModeBridge.state.message, /无法切换生成模式/);

  const safeYoungDirect = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: false,
    response: {
      ok: true,
      prompt: "安全的年轻角色教室阅读场景",
      negative_prompt: "低质量，结构错误",
      has_negative_prompt: true,
      ...safeYoungDirectSummary
    }
  });
  await safeYoungDirect.runSmartAi();
  assert.equal(safeYoungDirect.calls.writes.length, 1, "safe young-character content must remain directly usable");
  assert.equal(safeYoungDirect.calls.writes[0].prompt, "安全的年轻角色教室阅读场景");
  assert.deepEqual(safeYoungDirect.calls.nsfwSets, []);
  assert.equal(safeYoungDirect.state.pendingApply, null);

  const failedV2 = createSmartAiSubmitHarness({
    engine: "local",
    response: {
      ok: false,
      error: "nf.visual.v2 Qwen3 contract failed closed before legacy fallback",
      errorCode: "VISUAL_V2_CONTRACT_INVALID",
      message: "视觉合同未通过语义校验",
      retryable: true,
      retryAttempted: true,
      retryCount: 1,
      reverseProvider: "qwen3_vl_abliterated_nf4",
      providerFailureCode: "semantic-gate-invalid",
      legacyFallbackSuppressed: true,
      requestedVisualSchema: "nf.visual.v2",
      failureCategory: "visual_contract_invalid",
      rawOutput: "SECRET_RAW_MODEL_OUTPUT",
      traceback: "SECRET_TRACEBACK",
      contentSafety: { sensitive_visible_facts: ["SECRET_SENSITIVE_FACT"] }
    }
  });
  await failedV2.runSmartAi();
  assert.equal(failedV2.calls.writes.length, 0, "a typed v2 failure must never reach prompt writeback");
  assert.equal(failedV2.state.analysisResult, null);
  assert.equal(failedV2.state.pendingApply, null);
  assert.equal(failedV2.state.analysisFailure.retryable, true);
  assert.equal(failedV2.state.analysisFailure.retryCount, 1);
  assert.equal(failedV2.state.analysisFailure.requestedVisualSchema, "nf.visual.v2");
  assert.doesNotMatch(JSON.stringify(failedV2.state.analysisFailure), /SECRET_RAW|SECRET_TRACEBACK|SECRET_SENSITIVE_FACT/, "failure state must only retain the safe envelope allowlist");
  assert.match(failedV2.state.message, /分析失败—未写入：视觉分析结果未通过 v2 合同校验/);
  assert.match(failedV2.state.message, /已自动重试 1 次/);
  assert.match(failedV2.state.message, /未回退到 legacy 合同/);
  assert.match(failedV2.state.message, /分析引擎：qwen3_vl_abliterated_nf4/);
  assert.match(failedV2.state.message, /VISUAL_V2_CONTRACT_INVALID.*semantic-gate-invalid/);
  await failedV2.runSmartAi();
  assert.equal(failedV2.calls.localReverse.length, 2, "the explicit re-analysis action must issue a fresh request after a v2 failure");
  assert.equal(failedV2.calls.writes.length, 0);

  const nestedFailedV2 = createSmartAiSubmitHarness({
    engine: "local",
    response: {
      ok: false,
      error: "nf.visual.v2 analysis failed",
      errorCode: "v2-qwen3-fail-closed",
      requestedVisualSchema: "nf.visual.v2",
      legacyFallbackSuppressed: true,
      failureCategory: "semantic_contract",
      data: {
        prompt: "must not be parsed or written",
        visualSchema: "nf.visual.v1"
      }
    }
  });
  await nestedFailedV2.runSmartAi();
  assert.equal(nestedFailedV2.calls.writes.length, 0);
  assert.equal(nestedFailedV2.state.analysisFailure.errorCode, "v2-qwen3-fail-closed");
  assert.equal(nestedFailedV2.state.analysisResult, null);
  assert.doesNotMatch(nestedFailedV2.state.message, /不兼容的视觉合同/,
    "an outer ok:false Desktop envelope must enter the failure branch before nested schema parsing");

  let resolveStaleFailure;
  const staleFailureResponse = new Promise((resolve) => { resolveStaleFailure = resolve; });
  const staleFailure = createSmartAiSubmitHarness({ engine: "grok", response: staleFailureResponse });
  const staleFailureRun = staleFailure.runSmartAi();
  staleFailure.positive.value = "请求期间被用户修改的新提示词";
  resolveStaleFailure({
    ok: false,
    errorCode: "VISUAL_V2_CONTRACT_INVALID",
    failureCategory: "visual_contract_invalid",
    requestedVisualSchema: "nf.visual.v2"
  });
  await staleFailureRun;
  assert.equal(staleFailure.state.analysisFailure, null, "a failure response must be discarded when its request fingerprint is stale");
  assert.match(staleFailure.state.message, /旧分析结果已丢弃/);

  const degradedAnalysis = createSmartAiSubmitHarness({
    engine: "local",
    response: {
      ok: true,
      prompt: "不得写入的降级生成提示词",
      negative_prompt: "不得写入的降级负面词",
      has_negative_prompt: true,
      ...degradedPersonSummary
    }
  });
  await degradedAnalysis.runSmartAi();
  assert.equal(degradedAnalysis.calls.writes.length, 0, "degraded analysis must never write either prompt");
  assert.equal(degradedAnalysis.state.pendingApply, null, "degraded analysis must never create a sensitive apply action");
  assert.equal(degradedAnalysis.state.analysisFailure, null);
  assert.equal(degradedAnalysis.state.analysisResult.analysisDegraded, true);
  assert.match(degradedAnalysis.state.message, /分析不完整—未写入.*仅展示可安全显示的中性摘要/);

  for (const engine of ["grok", "local"]) {
    const hiddenInteractionCandidate = "成年人物保持明确的真实互动，INTERACTION_HIDDEN_NSFW_CANDIDATE";
    const partialAnalysis = createSmartAiSubmitHarness({
      engine,
      nsfw: false,
      response: {
        ok: true,
        prompt: hiddenInteractionCandidate,
        negative_prompt: "安全负面词",
        has_negative_prompt: true,
        generationRequirements: "不得在部分分析界面展示的具体内容",
        ...partialInteractionSummary
      }
    });
    await partialAnalysis.runSmartAi();
    const modelCalls = engine === "grok" ? partialAnalysis.calls.grokReverse : partialAnalysis.calls.localReverse;
    assert.equal(modelCalls.length, 1, `${engine} partial interaction result must complete in the original request`);
    assert.equal(partialAnalysis.calls.writes.length, 1, `${engine} partial interaction result must auto-apply in the original submit`);
    assert.equal(partialAnalysis.calls.writeAttempts, 1);
    assert.deepEqual(partialAnalysis.calls.nsfwSets, [true]);
    assert.equal(partialAnalysis.calls.writes[0].prompt, hiddenInteractionCandidate);
    assert.equal(partialAnalysis.state.pendingApply, null, "adult-sensitive results must not create a second-click pending action");
    assert.equal(partialAnalysis.state.analysisFailure, null);
    assert.equal(partialAnalysis.state.analysisResult.analysisPartial, true);
    assert.equal(partialAnalysis.state.analysisResult.contractFailureCode, "visual-contract-interaction-evidence-incomplete");
    assert.equal(partialAnalysis.calls.closed, 1);
  }

  const ageUnverifiableInteractionPartial = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: false,
    response: {
      ok: true,
      prompt: "人物保持明确的真实互动，INTERACTION_AGE_UNVERIFIABLE_CANDIDATE",
      negative_prompt: "安全负面词",
      has_negative_prompt: true,
      ...partialInteractionAgeUnverifiableSummary
    }
  });
  await ageUnverifiableInteractionPartial.runSmartAi();
  assert.equal(ageUnverifiableInteractionPartial.calls.localReverse.length, 1);
  assert.deepEqual(ageUnverifiableInteractionPartial.calls.nsfwSets, [true]);
  assert.equal(ageUnverifiableInteractionPartial.calls.writes.length, 1);
  assert.equal(ageUnverifiableInteractionPartial.state.pendingApply, null);
  assert.equal(
    ageUnverifiableInteractionPartial.calls.writes[0].prompt,
    "人物保持明确的真实互动，INTERACTION_AGE_UNVERIFIABLE_CANDIDATE"
  );

  for (const engine of ["grok", "local"]) {
    const neutralOnlyAnalysis = createSmartAiSubmitHarness({ engine, nsfw: false });
    neutralOnlyAnalysis.state.pendingApply = {
      requiresNeutralApply: true,
      visualPrompt: futureNeutralOnlySummary.visualPrompt,
      requestFingerprint: neutralOnlyAnalysis.getRequestFingerprint()
    };
    await neutralOnlyAnalysis.runSmartAi();
    const modelCalls = engine === "grok" ? neutralOnlyAnalysis.calls.grokReverse : neutralOnlyAnalysis.calls.localReverse;
    assert.equal(modelCalls.length, 0, `${engine} retained neutral apply must not issue a model request`);
    assert.equal(neutralOnlyAnalysis.calls.writes.length, 1);
    assert.equal(neutralOnlyAnalysis.calls.writes[0].prompt, futureNeutralOnlySummary.visualPrompt);
    assert.equal(neutralOnlyAnalysis.calls.writes[0].options.supportsNegativePrompt, false);
    assert.deepEqual(neutralOnlyAnalysis.calls.nsfwSets, []);
  }

  const staleNeutralOnly = createSmartAiSubmitHarness({ engine: "local", nsfw: false });
  staleNeutralOnly.state.pendingApply = {
    requiresNeutralApply: true,
    visualPrompt: futureNeutralOnlySummary.visualPrompt,
    requestFingerprint: staleNeutralOnly.getRequestFingerprint()
  };
  staleNeutralOnly.positive.value = "用户在应用中性提示词前手动修改的新提示词";
  await staleNeutralOnly.runSmartAi();
  assert.equal(staleNeutralOnly.calls.localReverse.length, 0, "stale neutral apply must not issue a model request");
  assert.equal(staleNeutralOnly.calls.writes.length, 0, "stale neutral analysis must not overwrite a newer user edit");
  assert.deepEqual(staleNeutralOnly.calls.nsfwSets, []);
  assert.equal(staleNeutralOnly.state.pendingApply, null);
  assert.match(staleNeutralOnly.state.message, /旧分析结果已作废/);

  for (const engine of ["grok", "local"]) {
    const hiddenProjectionCandidate = "成年人物保持明确的性接触互动，PROJECTION_HIDDEN_NSFW_CANDIDATE";
    const projectionPartialAnalysis = createSmartAiSubmitHarness({
      engine,
      nsfw: false,
      response: {
        ok: true,
        prompt: hiddenProjectionCandidate,
        negative_prompt: "不得写入的字段移除后负面词",
        has_negative_prompt: true,
        generationRequirements: "不得展示的字段移除前敏感描述",
        ...partialProjectionSummary
      }
    });
    await projectionPartialAnalysis.runSmartAi();
    const modelCalls = engine === "grok" ? projectionPartialAnalysis.calls.grokReverse : projectionPartialAnalysis.calls.localReverse;
    assert.equal(modelCalls.length, 1, `${engine} partial projection result must complete in the original request`);
    assert.equal(projectionPartialAnalysis.calls.writes.length, 1);
    assert.equal(projectionPartialAnalysis.calls.writeAttempts, 1);
    assert.deepEqual(projectionPartialAnalysis.calls.nsfwSets, [true]);
    assert.equal(projectionPartialAnalysis.calls.writes[0].prompt, hiddenProjectionCandidate);
    assert.equal(projectionPartialAnalysis.state.pendingApply, null);
    assert.equal(projectionPartialAnalysis.state.analysisFailure, null);
    assert.equal(projectionPartialAnalysis.state.analysisResult.analysisPartial, true);
    assert.equal(projectionPartialAnalysis.state.analysisResult.contractFailureCode, "visual-contract-projection-redaction-required");
    assert.equal(projectionPartialAnalysis.calls.closed, 1);
  }

  const ambiguousPartialAnalysis = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: false,
    response: {
      ok: true,
      prompt: "不得写入的年龄不明部分分析提示词",
      ...partialAmbiguousSummary
    }
  });
  await ambiguousPartialAnalysis.runSmartAi();
  assert.equal(ambiguousPartialAnalysis.calls.writes.length, 0);
  assert.equal(ambiguousPartialAnalysis.calls.writeAttempts, 0);
  assert.deepEqual(ambiguousPartialAnalysis.calls.nsfwSets, []);
  assert.equal(ambiguousPartialAnalysis.state.pendingApply, null);
  assert.equal(ambiguousPartialAnalysis.state.analysisResult.analysisPartial, true);

  for (const invalidPartial of [
    { ...partialInteractionSummary, contractFailureCode: "visual-contract-invalid" },
    { ...partialProjectionSummary, contractFailureCode: "visual-contract-projection-redaction-required-fake" },
    { ...partialInteractionSummary, qualityGateFailed: false },
    { ...partialInteractionSummary, contentSafety: publicVisualV2Safety({ level: "explicit", body_exposure: "none", interaction_category: "sexual", signals: ["explicit_activity"], sensitive_visible_facts: ["SERVER_ONLY_FACT"] }) }
  ]) {
    const failClosedPartial = createSmartAiSubmitHarness({
      engine: "local",
      nsfw: false,
      response: {
        ok: true,
        prompt: "INVALID_PARTIAL_PROMPT",
        generationRequirements: "INVALID_PARTIAL_REQUIREMENTS",
        ...invalidPartial
      }
    });
    await failClosedPartial.runSmartAi();
    assert.equal(failClosedPartial.calls.writes.length, 0, "invalid partial metadata must fail closed before writeback");
    assert.equal(failClosedPartial.calls.writeAttempts, 0);
    assert.deepEqual(failClosedPartial.calls.nsfwSets, []);
    assert.equal(failClosedPartial.state.pendingApply, null);
    assert.equal(failClosedPartial.state.analysisResult, null, "invalid partial metadata must not remain visible as a trusted result");
    assert.match(failClosedPartial.state.message, /内容分级元数据不完整或不一致/);
  }

  const multiReference = createSmartAiSubmitHarness({ engine: "grok", imageCount: 2 });
  await multiReference.runSmartAi();
  assert.equal(multiReference.calls.grokReverse.length, 1);
  assert.equal(multiReference.calls.grokReverse[0].purpose, "roleReference");
  assert.equal(Object.hasOwn(multiReference.calls.grokReverse[0], "visualSchema"), false);
  assert.equal(Object.hasOwn(multiReference.calls.grokReverse[0], "nsfw"), false);
  assert.equal(Object.hasOwn(multiReference.calls.grokReverse[0], "prompt"), false);
  assert.equal(Object.hasOwn(multiReference.calls.grokReverse[0], "currentPrompt"), false);
  assert.equal(multiReference.calls.grokReverse[0].requirements.split(multiReference.state.requirements).length - 1, 1,
    "Grok multi-reference input must contain the user intent exactly once");
  assert.equal(multiReference.calls.compile, 1);

  const automaticMultiReference = createSmartAiSubmitHarness({ engine: "local", artTask: "transfer", imageCount: 2 });
  await automaticMultiReference.runSmartAi();
  assert.equal(automaticMultiReference.calls.localReverse.length, 1);
  assert.equal(automaticMultiReference.calls.localReverse[0].purpose, "roleReference");
  assert.equal(Object.hasOwn(automaticMultiReference.calls.localReverse[0], "visualSchema"), false);
  assert.equal(Object.hasOwn(automaticMultiReference.calls.localReverse[0], "nsfw"), false);
  assert.equal(Object.hasOwn(automaticMultiReference.calls.localReverse[0], "prompt"), false);
  assert.equal(Object.hasOwn(automaticMultiReference.calls.localReverse[0], "currentPrompt"), false);
  assert.equal(automaticMultiReference.calls.localReverse[0].requirements.split(automaticMultiReference.state.requirements).length - 1, 1,
    "Local multi-reference input must contain the user intent exactly once");

  const boundedRoleIntent = "UNIQUE_USER_INTENT_KEEP_SUBJECT_AND_USE_IMAGE_2_POSE";
  const longRoleRequirements = createSmartAiSubmitHarness({
    engine: "local",
    imageCount: 2,
    userIntent: boundedRoleIntent,
    internalRequirements: `QUALITY_BLOCK_${"Q".repeat(4000)}`
  });
  await longRoleRequirements.runSmartAi();
  const roleRequestPrefix = longRoleRequirements.calls.localReverse[0].requirements.slice(0, 2000);
  assert.match(roleRequestPrefix, new RegExp(boundedRoleIntent));
  assert.equal(roleRequestPrefix.split(boundedRoleIntent).length - 1, 1,
    "the 2000-character service prefix must retain one complete user intent before long quality constraints");

  const animation = createSmartAiSubmitHarness({ engine: "grok", surface: "animation", mode: "reverse" });
  await animation.runSmartAi();
  assert.equal(animation.calls.grokReverse.length, 1);
  assert.equal(animation.calls.grokReverse[0].purpose, "");
  assert.equal(Object.hasOwn(animation.calls.grokReverse[0], "visualSchema"), false);
  assert.equal(Object.hasOwn(animation.calls.grokReverse[0], "nsfw"), false);
  assert.equal(Object.hasOwn(animation.calls.grokReverse[0], "promptSchema"), false);

  const animationOptimize = createSmartAiSubmitHarness({
    engine: "local",
    surface: "animation",
    mode: "optimize",
    imageCount: 0,
    initialArtGenerateMode: "",
    initialPrompt: "人物缓慢转身，镜头向前推进"
  });
  await animationOptimize.runSmartAi();
  assert.equal(animationOptimize.calls.localOptimize.length, 1);
  assert.equal(animationOptimize.calls.localOptimize[0].surface, "animation");
  assert.equal(Object.hasOwn(animationOptimize.calls.localOptimize[0], "promptSchema"), false,
    "ordinary animation optimize must stay outside the Art structured schema");

  const simplePrompt = "一名成年女战士站在山谷中，电影级光影，细节清晰。";
  const simpleResult = "一名成年女战士站在山谷中，材质纹理细腻，光影层次丰富，画面质感精致，细节清晰。";
  for (const engine of ["local", "grok"]) {
    const ordinaryOptimize = createSmartAiSubmitHarness({
      engine,
      artTask: "create",
      imageCount: 0,
      nsfw: true,
      initialPrompt: simplePrompt,
      userIntent: "增强材质、光影层次和画面质感",
      response: {
        ok: true,
        prompt: simpleResult,
        negative_prompt: "低质量, 模糊, 材质失真",
        has_negative_prompt: true
      }
    });
    await ordinaryOptimize.runSmartAi();
    const optimizeCalls = engine === "local"
      ? ordinaryOptimize.calls.localOptimize
      : ordinaryOptimize.calls.grokOptimize;
    assert.equal(optimizeCalls.length, 1);
    assert.equal(optimizeCalls[0].currentPrompt, simplePrompt);
    assert.equal(Object.hasOwn(optimizeCalls[0], "promptSchema"), false,
      `${engine} short single-paragraph Art optimize must use the shared patch contract`);
    assert.equal(Object.hasOwn(optimizeCalls[0], "visualSchema"), false);
    assert.equal(optimizeCalls[0].nsfw, true,
      `ordinary ${engine} Art text optimization must forward the enabled NSFW state`);
    assert.equal(ordinaryOptimize.calls.writes[0].prompt, simpleResult);
  }

  const blocked = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: false,
    response: {
      ok: true,
      prompt: "不得写入的敏感提示词",
      negative_prompt: "不得写入的负面词",
      has_negative_prompt: true,
      visualSchema: "nf.visual.v2",
      visualPrompt: "一名人物位于室内场景，近景镜头",
      generationRequirements: "保持镜头与构图",
      contentSafety: publicVisualV2Safety({
        level: "explicit",
        body_exposure: "full",
        interaction_category: "sexual",
        age_assessment: "ambiguous_or_young_appearing",
        signals: ["nudity", "explicit_activity", "explicit_anatomy", "age_ambiguous"]
      }),
      contentWarnings: ["nudity", "explicit_activity", "explicit_anatomy", "age_ambiguous", "sensitive_prompt_age_unconfirmed"],
      sensitivePromptBlocked: true,
      generationGate: "blocked"
    }
  });
  await blocked.runSmartAi();
  assert.equal(blocked.calls.localReverse[0].nsfw, true, "age analysis must not inherit the disabled generation NSFW switch");
  assert.equal(blocked.calls.writes.length, 0, "blocked sensitive output must never reach either prompt textarea");
  assert.equal(blocked.calls.closed, 0);
  assert.equal(blocked.state.analysisResult.sensitivePromptBlocked, true);
  assert.match(blocked.state.message, /分析完成—未写入.*年龄不明确或外观偏年轻/);
  await blocked.runSmartAi();
  assert.equal(blocked.calls.localReverse.length, 2, "the explicit re-analysis action must remain available after a blocked result");
  assert.equal(blocked.calls.writes.length, 0);

  const youngSensitiveBlocked = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: false,
    response: {
      ok: true,
      prompt: "不得写入的年轻或未成年特征敏感提示词",
      ...youngSensitiveBlockedSummary
    }
  });
  await youngSensitiveBlocked.runSmartAi();
  assert.equal(youngSensitiveBlocked.calls.writes.length, 0);
  assert.equal(youngSensitiveBlocked.calls.writeAttempts, 0);
  assert.deepEqual(youngSensitiveBlocked.calls.nsfwSets, []);
  assert.equal(youngSensitiveBlocked.state.pendingApply, null);
  assert.match(youngSensitiveBlocked.state.message, /年轻或未成年人特征.*敏感提示词已阻止/);

  const minorRequirementsBlocked = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: false,
    userIntent: "青少年角色",
    response: {
      ok: true,
      prompt: "不得写入的敏感提示词",
      negative_prompt: "",
      has_negative_prompt: false,
      ...explicitMinorRequirementsBlockedSummary,
      generationRequirements: ""
    }
  });
  await minorRequirementsBlocked.runSmartAi();
  assert.equal(minorRequirementsBlocked.calls.writes.length, 0);
  assert.equal(minorRequirementsBlocked.calls.writeAttempts, 0);
  assert.deepEqual(minorRequirementsBlocked.calls.nsfwSets, []);
  assert.equal(minorRequirementsBlocked.state.analysisResult.generationGate, "blocked");
  assert.match(minorRequirementsBlocked.state.message, /附加要求包含明确未成年人内容.*敏感提示词已阻止/);

  const safeTeenPortrait = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: false,
    userIntent: "teen portrait"
  });
  await safeTeenPortrait.runSmartAi();
  assert.equal(safeTeenPortrait.calls.writes.length, 1);
  assert.equal(safeTeenPortrait.calls.closed, 1);

  const safeReferenceTeenNudeBlocked = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: false,
    userIntent: "teen nude",
    response: {
      ok: true,
      prompt: "不得写入的敏感提示词",
      negative_prompt: "",
      has_negative_prompt: false,
      ...safeReferenceSensitiveMinorBlockedSummary,
      generationRequirements: ""
    }
  });
  await safeReferenceTeenNudeBlocked.runSmartAi();
  assert.equal(safeReferenceTeenNudeBlocked.calls.writes.length, 0);
  assert.equal(safeReferenceTeenNudeBlocked.calls.writeAttempts, 0);
  assert.deepEqual(safeReferenceTeenNudeBlocked.calls.nsfwSets, []);
  assert.equal(safeReferenceTeenNudeBlocked.state.analysisResult.generationGate, "blocked");
  assert.match(safeReferenceTeenNudeBlocked.state.message, /附加要求包含明确未成年人内容.*敏感提示词已阻止/);

  const adultAnalysisWhileGenerationNsfwOff = createSmartAiSubmitHarness({
    engine: "grok",
    nsfw: false,
    response: {
      ok: true,
      prompt: "待确认的成年人敏感生成提示词",
      negative_prompt: "安全负面词",
      has_negative_prompt: true,
      visualSchema: "nf.visual.v2",
      visualPrompt: "成年人物位于室内场景",
      generationRequirements: "保持构图",
      contentSafety: publicVisualV2Safety({
        level: "explicit",
        signals: ["explicit_anatomy"]
      }),
      contentWarnings: ["explicit_anatomy"],
      sensitivePromptBlocked: false,
      generationGate: "adult_confirmation"
    }
  });
  await adultAnalysisWhileGenerationNsfwOff.runSmartAi();
  assert.equal(adultAnalysisWhileGenerationNsfwOff.calls.grokReverse[0].nsfw, true);
  assert.equal(adultAnalysisWhileGenerationNsfwOff.getNsfw(), true, "the original submit must enable generation NSFW for an adult-appearing result");
  assert.deepEqual(adultAnalysisWhileGenerationNsfwOff.calls.nsfwSets, [true]);
  assert.equal(adultAnalysisWhileGenerationNsfwOff.calls.writes.length, 1, "adult-sensitive analysis must write in the original submit");
  assert.equal(adultAnalysisWhileGenerationNsfwOff.state.pendingApply, null);
  assert.equal(adultAnalysisWhileGenerationNsfwOff.calls.closed, 1);

  const ageUnverifiableAdult = createSmartAiSubmitHarness({
    engine: "grok",
    nsfw: false,
    response: {
      ok: true,
      prompt: "人物保持明确的性接触互动，AGE_UNVERIFIABLE_HIDDEN_NSFW_CANDIDATE",
      negative_prompt: "安全负面词",
      has_negative_prompt: true,
      generationRequirements: "保持构图",
      ...ageUnverifiableAdultSummary
    }
  });
  await ageUnverifiableAdult.runSmartAi();
  assert.equal(ageUnverifiableAdult.calls.grokReverse.length, 1);
  assert.deepEqual(ageUnverifiableAdult.calls.nsfwSets, [true]);
  assert.equal(ageUnverifiableAdult.calls.writes.length, 1);
  assert.equal(ageUnverifiableAdult.calls.writeAttempts, 1);
  assert.equal(ageUnverifiableAdult.calls.writes[0].prompt, "人物保持明确的性接触互动，AGE_UNVERIFIABLE_HIDDEN_NSFW_CANDIDATE");
  assert.equal(ageUnverifiableAdult.state.pendingApply, null);
  assert.equal(ageUnverifiableAdult.calls.closed, 1);

  const zeroPersonSensitiveObject = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: true,
    response: {
      ok: true,
      prompt: "zero-person sensitive objects must stay fail-closed",
      negative_prompt: "safe negative prompt",
      has_negative_prompt: true,
      visualSchema: "nf.visual.v2",
      visualPrompt: "室内产品摄影场景",
      generationRequirements: "保持构图",
      contentSafety: publicVisualV2Safety({
        level: "explicit",
        age_assessment: "not_applicable",
        visible_person_count: 0,
        signals: ["explicit_anatomy"]
      }),
      contentWarnings: ["explicit_anatomy"],
      sensitivePromptBlocked: true,
      generationGate: "blocked"
    }
  });
  await zeroPersonSensitiveObject.runSmartAi();
  assert.equal(zeroPersonSensitiveObject.calls.writes.length, 0, "zero-person sensitive output must remain fail-closed even with NSFW enabled");
  assert.equal(zeroPersonSensitiveObject.state.analysisResult.sensitivePromptBlocked, true);
  assert.match(zeroPersonSensitiveObject.state.message, /分析完成—未写入.*未检测到可确认成年/);

  const adultSensitive = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: false,
    useDomPromptLookup: true,
    replacePromptControlsOnNsfwSet: true,
    response: {
      ok: true,
      prompt: "成年人物保持明确的性接触互动，FULL_ADULT_HIDDEN_NSFW_CANDIDATE",
      negative_prompt: "安全负面词",
      has_negative_prompt: true,
      visualSchema: "nf.visual.v2",
      visualPrompt: "一名视觉上偏成年的人物位于室内场景",
      generationRequirements: "保持构图",
      contentSafety: publicVisualV2Safety({
        level: "explicit",
        interaction_category: "sexual",
        signals: ["explicit_activity"]
      }),
      contentWarnings: ["explicit_activity"],
      sensitivePromptBlocked: false,
      generationGate: "adult_confirmation"
    }
  });
  await adultSensitive.runSmartAi();
  assert.equal(adultSensitive.calls.localReverse.length, 1);
  assert.equal(adultSensitive.calls.localReverse[0].nsfw, true);
  assert.equal(adultSensitive.calls.writes.length, 1);
  assert.deepEqual(adultSensitive.calls.nsfwSets, [true], "the original submit must use the Runtime NSFW setter exactly once");
  assert.equal(adultSensitive.getNsfw(), true);
  assert.notEqual(adultSensitive.calls.writes[0].textareas.positive, adultSensitive.positive, "the detached pre-render textarea must never receive the sensitive prompt");
  assert.equal(adultSensitive.calls.writes[0].textareas.positive, adultSensitive.getCurrentTextareas().positive, "the original submit must reacquire the current Art textarea after Runtime render");
  assert.equal(adultSensitive.calls.writes[0].prompt, "成年人物保持明确的性接触互动，FULL_ADULT_HIDDEN_NSFW_CANDIDATE");
  assert.equal(adultSensitive.state.pendingApply, null);
  assert.equal(adultSensitive.calls.closed, 1, "successful one-click adult application must close the dialog");

  const failedAfterNsfwStateUpdate = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: false,
    replacePromptControlsOnNsfwSet: true,
    throwAfterNsfwSet: true,
    response: {
      ok: true,
      prompt: "setter 抛错后不得写入的成年人候选",
      negative_prompt: "安全负面词",
      has_negative_prompt: true,
      visualSchema: "nf.visual.v2",
      visualPrompt: "一名视觉上偏成年的人物位于室内场景",
      generationRequirements: "保持构图",
      contentSafety: publicVisualV2Safety({ level: "explicit", interaction_category: "sexual", signals: ["explicit_activity"] }),
      contentWarnings: ["explicit_activity"],
      sensitivePromptBlocked: false,
      generationGate: "adult_confirmation"
    }
  });
  await failedAfterNsfwStateUpdate.runSmartAi();
  assert.equal(failedAfterNsfwStateUpdate.calls.localReverse.length, 1);
  assert.equal(failedAfterNsfwStateUpdate.getNsfw(), true, "the harness records that the Runtime changed state before throwing");
  assert.deepEqual(failedAfterNsfwStateUpdate.calls.nsfwSets, [true]);
  assert.equal(failedAfterNsfwStateUpdate.calls.writes.length, 0, "any setter exception must fail closed before prompt writeback");
  assert.equal(failedAfterNsfwStateUpdate.calls.writeAttempts, 0);
  assert.equal(failedAfterNsfwStateUpdate.state.pendingApply, null, "setter failure must never create an adult retry button");
  assert.match(failedAfterNsfwStateUpdate.state.message, /无法自动开启 Art NSFW/);

  const failedNsfwEnable = createSmartAiSubmitHarness({
    engine: "grok",
    nsfw: false,
    throwBeforeNsfwSet: true,
    response: {
      ok: true,
      prompt: "NSFW 未实际开启时必须继续等待的成年人候选",
      negative_prompt: "安全负面词",
      has_negative_prompt: true,
      visualSchema: "nf.visual.v2",
      visualPrompt: "一名视觉上偏成年的人物位于室内场景",
      generationRequirements: "保持构图",
      contentSafety: publicVisualV2Safety({ level: "explicit", interaction_category: "sexual", signals: ["explicit_activity"] }),
      contentWarnings: ["explicit_activity"],
      sensitivePromptBlocked: false,
      generationGate: "adult_confirmation"
    }
  });
  await failedNsfwEnable.runSmartAi();
  assert.equal(failedNsfwEnable.calls.grokReverse.length, 1);
  assert.equal(failedNsfwEnable.getNsfw(), false);
  assert.deepEqual(failedNsfwEnable.calls.nsfwSets, [true]);
  assert.equal(failedNsfwEnable.calls.writes.length, 0, "a genuine NSFW enable failure must never write the candidate");
  assert.equal(failedNsfwEnable.calls.writeAttempts, 0);
  assert.equal(failedNsfwEnable.state.pendingApply, null, "a genuine enable failure must not create an adult retry button");
  assert.match(failedNsfwEnable.state.message, /无法自动开启 Art NSFW/);

  const staleBeforeSensitiveGate = createSmartAiSubmitHarness({
    engine: "grok",
    nsfw: false,
    mutateFingerprintBeforeSensitiveGate: true,
    response: {
      ok: true,
      prompt: "过期后不得写入的成年人敏感提示词",
      negative_prompt: "安全负面词",
      has_negative_prompt: true,
      visualSchema: "nf.visual.v2",
      visualPrompt: "一名视觉上偏成年的人物位于室内场景",
      generationRequirements: "保持构图",
      contentSafety: publicVisualV2Safety({ level: "explicit", interaction_category: "sexual", signals: ["explicit_activity"] }),
      contentWarnings: ["explicit_activity"],
      sensitivePromptBlocked: false,
      generationGate: "adult_confirmation"
    }
  });
  await staleBeforeSensitiveGate.runSmartAi();
  assert.equal(staleBeforeSensitiveGate.calls.grokReverse.length, 1);
  assert.equal(staleBeforeSensitiveGate.getNsfw(), false);
  assert.deepEqual(staleBeforeSensitiveGate.calls.nsfwSets, [], "the final fingerprint check must run before the Runtime setter");
  assert.equal(staleBeforeSensitiveGate.calls.writes.length, 0, "a stale adult result must never overwrite the current prompt");
  assert.equal(staleBeforeSensitiveGate.state.pendingApply, null);
  assert.match(staleBeforeSensitiveGate.state.message, /自动应用前.*旧分析结果已丢弃/);

  let resolveStaleAdultResponse;
  const staleAdultResponse = new Promise((resolve) => { resolveStaleAdultResponse = resolve; });
  const staleAdultSensitive = createSmartAiSubmitHarness({
    engine: "grok",
    nsfw: false,
    response: staleAdultResponse
  });
  const staleAdultRun = staleAdultSensitive.runSmartAi();
  staleAdultSensitive.positive.value = "用户在请求期间手动修改的新提示词";
  resolveStaleAdultResponse({
      ok: true,
      prompt: "不得覆盖用户新编辑的旧分析结果",
      negative_prompt: "安全负面词",
      has_negative_prompt: true,
      visualSchema: "nf.visual.v2",
      visualPrompt: "一名视觉上偏成年的人物位于室内场景",
      generationRequirements: "保持构图",
      contentSafety: publicVisualV2Safety({ level: "explicit", interaction_category: "sexual", signals: ["explicit_activity"] }),
      contentWarnings: ["explicit_activity"],
      sensitivePromptBlocked: false,
      generationGate: "adult_confirmation"
  });
  await staleAdultRun;
  assert.equal(staleAdultSensitive.calls.writes.length, 0, "a changed underlying prompt must invalidate an in-flight adult result");
  assert.deepEqual(staleAdultSensitive.calls.nsfwSets, [], "a stale response must be rejected before the Runtime NSFW setter runs");
  assert.equal(staleAdultSensitive.state.pendingApply, null);
  assert.match(staleAdultSensitive.state.message, /旧分析结果已丢弃/);

  const sensitiveIntentGate = vm.runInNewContext(`(${sensitiveIntentGateSource})`);
  assert.equal(sensitiveIntentGate("未成年人角色"), true);
  assert.equal(sensitiveIntentGate("所有人物均为成年人，青少年角色"), true);
  assert.equal(sensitiveIntentGate("all characters are adults, teen character"), true);
  assert.equal(sensitiveIntentGate("所有人物均为成年人，但包含18岁以下角色"), true, "explicit minor wording must win over a contradictory adult declaration");
  assert.equal(sensitiveIntentGate("minor character"), true);
  assert.equal(sensitiveIntentGate("少女角色"), true, "a young descriptor without an adult context must fail closed");
  assert.equal(sensitiveIntentGate("成年少女角色"), false, "少女 in an explicit adult context must not be crudely rejected");
  assert.equal(sensitiveIntentGate("所有人物均为成年人，少年风格角色"), false);

  const explicitMinorIntent = createSmartAiSubmitHarness({
    engine: "grok",
    nsfw: false,
    userIntent: "所有人物均为成年人，但加入未成年人角色",
    response: {
      ok: true,
      prompt: "成年人物敏感生成提示词",
      negative_prompt: "安全负面词",
      has_negative_prompt: true,
      visualSchema: "nf.visual.v2",
      visualPrompt: "一名视觉上偏成年的人物位于室内场景",
      generationRequirements: "保持构图",
      contentSafety: publicVisualV2Safety({ level: "explicit", interaction_category: "sexual", signals: ["explicit_activity"] }),
      contentWarnings: ["explicit_activity"],
      sensitivePromptBlocked: false,
      generationGate: "adult_confirmation"
    }
  });
  await explicitMinorIntent.runSmartAi();
  assert.deepEqual(explicitMinorIntent.calls.nsfwSets, [], "explicit minor requirements must be blocked before enabling NSFW");
  assert.equal(explicitMinorIntent.calls.writes.length, 0);
  assert.equal(explicitMinorIntent.state.pendingApply, null);
  assert.match(explicitMinorIntent.state.message, /包含明确未成年人内容/);

  for (const userIntent of ["青少年角色", "teen character", "child character"]) {
    const guardedTeenIntent = createSmartAiSubmitHarness({
      engine: "grok",
      nsfw: false,
      userIntent,
      response: {
        ok: true,
        prompt: "成年人物敏感生成提示词",
        negative_prompt: "安全负面词",
        has_negative_prompt: true,
        visualSchema: "nf.visual.v2",
        visualPrompt: "一名视觉上偏成年的人物位于室内场景",
        generationRequirements: "保持构图",
        contentSafety: publicVisualV2Safety({ level: "explicit", interaction_category: "sexual", signals: ["explicit_activity"] }),
        contentWarnings: ["explicit_activity"],
        sensitivePromptBlocked: false,
        generationGate: "adult_confirmation"
      }
    });
    await guardedTeenIntent.runSmartAi();
    assert.deepEqual(guardedTeenIntent.calls.nsfwSets, [], `${userIntent} must be blocked before enabling NSFW without relying on UI copy`);
    assert.equal(guardedTeenIntent.calls.writes.length, 0, `${userIntent} must never reach prompt writeback`);
    assert.equal(guardedTeenIntent.state.pendingApply, null);
  }

  const explicitMinorModelPrompt = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: false,
    userIntent: "所有人物均为成年人",
    response: {
      ok: true,
      prompt: "成年人物与未成年人角色的敏感生成提示词",
      negative_prompt: "安全负面词",
      has_negative_prompt: true,
      visualSchema: "nf.visual.v2",
      visualPrompt: "一名视觉上偏成年的人物位于室内场景",
      generationRequirements: "保持构图",
      contentSafety: publicVisualV2Safety({ level: "explicit", interaction_category: "sexual", signals: ["explicit_activity"] }),
      contentWarnings: ["explicit_activity"],
      sensitivePromptBlocked: false,
      generationGate: "adult_confirmation"
    }
  });
  await explicitMinorModelPrompt.runSmartAi();
  assert.deepEqual(explicitMinorModelPrompt.calls.nsfwSets, [], "explicit minor wording in the generated positive prompt must also be blocked");
  assert.equal(explicitMinorModelPrompt.calls.writes.length, 0);

  const adultYoungDescriptor = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: false,
    userIntent: "保留成年动漫少女角色设定",
    response: {
      ok: true,
      prompt: "成年动漫少女角色的敏感生成提示词",
      negative_prompt: "安全负面词",
      has_negative_prompt: true,
      visualSchema: "nf.visual.v2",
      visualPrompt: "一名视觉上偏成年的人物位于室内场景",
      generationRequirements: "保持构图",
      contentSafety: publicVisualV2Safety({ level: "explicit", interaction_category: "sexual", signals: ["explicit_activity"] }),
      contentWarnings: ["explicit_activity"],
      sensitivePromptBlocked: false,
      generationGate: "adult_confirmation"
    }
  });
  await adultYoungDescriptor.runSmartAi();
  assert.deepEqual(adultYoungDescriptor.calls.nsfwSets, [true]);
  assert.equal(adultYoungDescriptor.calls.writes.length, 1, "成年动漫少女 wording must remain usable without weakening explicit-minor blocking");
  assert.equal(adultYoungDescriptor.state.pendingApply, null);

  const downgradedSchema = createSmartAiSubmitHarness({
    engine: "local",
    nsfw: true,
    response: {
      ok: true,
      prompt: "不得写入的旧合同结果",
      negative_prompt: "旧负面词",
      has_negative_prompt: true,
      visualSchema: "nf.visual.v1"
    }
  });
  await downgradedSchema.runSmartAi();
  assert.equal(downgradedSchema.calls.writes.length, 0, "a requested v2 analysis must reject v1 or unversioned responses");
  assert.match(downgradedSchema.state.message, /不兼容的视觉合同/);

  const invalidPublicResponses = [
    {
      ok: true,
      prompt: "must not be written without an explicit generation gate",
      visualSchema: "nf.visual.v2",
      visualPrompt: "safe visual summary",
      contentSafety: publicVisualV2Safety(),
      contentWarnings: [],
      sensitivePromptBlocked: false
    },
    {
      ok: true,
      prompt: "must not be written with an unknown generation gate",
      visualSchema: "nf.visual.v2",
      visualPrompt: "safe visual summary",
      generationGate: "unknown_gate",
      contentSafety: publicVisualV2Safety(),
      contentWarnings: [],
      sensitivePromptBlocked: false
    },
    {
      ok: true,
      prompt: "must not be written without content safety metadata",
      visualSchema: "nf.visual.v2",
      visualPrompt: "safe visual summary",
      contentWarnings: [],
      sensitivePromptBlocked: false
    },
    {
      ok: true,
      prompt: "must not be written without an explicit blocked boolean",
      visualSchema: "nf.visual.v2",
      visualPrompt: "safe visual summary",
      contentSafety: publicVisualV2Safety(),
      contentWarnings: []
    },
    {
      ok: true,
      prompt: "must not be written with an invalid safety level",
      visualSchema: "nf.visual.v2",
      visualPrompt: "safe visual summary",
      contentSafety: publicVisualV2Safety({ level: "invalid" }),
      contentWarnings: [],
      sensitivePromptBlocked: false
    },
    {
      ok: true,
      prompt: "must not be written with an invalid person count",
      visualSchema: "nf.visual.v2",
      visualPrompt: "safe visual summary",
      contentSafety: publicVisualV2Safety({ visible_person_count: 1.5 }),
      contentWarnings: [],
      sensitivePromptBlocked: false
    },
    {
      ok: true,
      prompt: "must not be written when zero-person metadata carries person-only nudity signals",
      visualSchema: "nf.visual.v2",
      visualPrompt: "safe visual summary",
      contentSafety: publicVisualV2Safety({
        level: "nudity",
        body_exposure: "full",
        age_assessment: "not_applicable",
        visible_person_count: 0,
        signals: ["nudity"]
      }),
      contentWarnings: ["nudity"],
      sensitivePromptBlocked: false
    }
  ];
  for (const response of invalidPublicResponses) {
    const invalidPublicResponse = createSmartAiSubmitHarness({
      engine: "local",
      nsfw: true,
      response
    });
    await invalidPublicResponse.runSmartAi();
    assert.equal(invalidPublicResponse.calls.writes.length, 0, "invalid public v2 metadata must fail closed before prompt writeback");
    assert.match(invalidPublicResponse.state.message, /内容分级元数据不完整或不一致/);
  }

  const emptyVisualSummary = createSmartAiSubmitHarness({
    engine: "grok",
    nsfw: false,
    response: {
      ok: true,
      prompt: "must not be written without a visible fact summary",
      visualSchema: "nf.visual.v2",
      visualPrompt: "   ",
      generationRequirements: "keep composition",
      generationGate: "direct",
      contentSafety: publicVisualV2Safety(),
      contentWarnings: [],
      sensitivePromptBlocked: false
    }
  });
  await emptyVisualSummary.runSmartAi();
  assert.equal(emptyVisualSummary.calls.writes.length, 0);
  assert.match(emptyVisualSummary.state.message, /未返回可展示的图片事实摘要/);

  const resultReaderContext = vm.createContext({ ORDINARY_ART_PROMPT_SCHEMA, ORDINARY_ART_EDIT_CONTRACT });
  vm.runInContext(`${hasOwnValueSource}\n${cleanFailureTextSource}\n${cleanFailureCodeSource}\n${readResultValueSource}\n${readSmartAiResultSource}`, resultReaderContext);
  const parsedMetadata = resultReaderContext.readSmartAiResult({
    ok: true,
    data: {
      prompt: "兼容生成提示词",
      visualSchema: "nf.visual.v2",
      visualPrompt: "非敏感图片事实",
      generationRequirements: "用户约束",
      contentSafety: { classification: "explicit" },
      contentWarnings: ["explicit_activity"],
      sensitivePromptBlocked: true,
      analysisDegraded: true,
      analysis_partial: true,
      generation_gate: "blocked",
      contractFailureCode: "visual-contract-invalid",
      qualityGateFailed: true,
      editContract: ORDINARY_ART_EDIT_CONTRACT,
      promptSchema: ORDINARY_ART_PROMPT_SCHEMA
    }
  });
  assert.equal(parsedMetadata.visualSchema, "nf.visual.v2");
  assert.equal(parsedMetadata.visualPrompt, "非敏感图片事实");
  assert.equal(parsedMetadata.generationRequirements, "用户约束");
  assert.deepEqual(JSON.parse(JSON.stringify(parsedMetadata.contentSafety)), { classification: "explicit" });
  assert.deepEqual(JSON.parse(JSON.stringify(parsedMetadata.contentWarnings)), ["explicit_activity"]);
  assert.equal(parsedMetadata.sensitivePromptBlocked, true);
  assert.equal(parsedMetadata.hasContentWarnings, true);
  assert.equal(parsedMetadata.hasSensitivePromptBlocked, true);
  assert.equal(parsedMetadata.analysisDegraded, true);
  assert.equal(parsedMetadata.analysisPartial, true);
  assert.equal(parsedMetadata.generationGate, "blocked");
  assert.equal(parsedMetadata.contractFailureCode, "visual-contract-invalid");
  assert.equal(parsedMetadata.qualityGateFailed, true);
  assert.equal(parsedMetadata.editContract, ORDINARY_ART_EDIT_CONTRACT);
  assert.equal(parsedMetadata.promptSchema, ORDINARY_ART_PROMPT_SCHEMA);
  assert.equal(isValidPublicVisualV2Result(parsedMetadata, { nsfw: true }), false);
  const parsedNonExactPartialCode = resultReaderContext.readSmartAiResult({
    ...partialInteractionSummary,
    contractFailureCode: "visual-contract-interaction-evidence-incomplete<script>"
  });
  assert.equal(parsedNonExactPartialCode.contractFailureCode, "", "partial analysis must reject a cleaned prefix and require the exact contract code");
  assert.equal(resultReaderContext.readSmartAiResult({
    prompt: "候选提示词",
    editContract: `${ORDINARY_ART_EDIT_CONTRACT}<script>`,
    promptSchema: `${ORDINARY_ART_PROMPT_SCHEMA}<script>`
  }).editContract, "", "structured recompile metadata must require the exact trusted contract value");
  assert.equal(resultReaderContext.readSmartAiResult({
    prompt: "候选提示词",
    editContract: ORDINARY_ART_EDIT_CONTRACT,
    promptSchema: `${ORDINARY_ART_PROMPT_SCHEMA}<script>`
  }).promptSchema, "", "Art prompt schema metadata must require the exact trusted value");
  assert.equal(isValidPublicVisualV2Result(parsedNonExactPartialCode, { nsfw: true }), false);

  const failureReaderContext = vm.createContext({});
  vm.runInContext([
    hasOwnValueSource,
    cleanFailureTextSource,
    cleanFailureCodeSource,
    readFailureEnvelopeSource,
    failureCategoryLabelSource,
    analysisFailureStatusSource
  ].join("\n"), failureReaderContext);
  const parsedFailure = failureReaderContext.readSmartAiFailureEnvelope({
    ok: false,
    error: "legacy error string",
    message: "结构化失败消息优先",
    retryable: true,
    retryAttempted: true,
    retryCount: 99,
    reverseProvider: "qwen3_vl_abliterated_nf4<script>",
    errorCode: "VISUAL_V2_CONTRACT_INVALID<script>",
    providerFailureCode: "semantic-gate-invalid",
    failureCategory: "visual_contract_invalid",
    failureClass: "audio-fidelity",
    generationGate: "blocked",
    sensitivePromptBlocked: true,
    rawOutput: "SECRET_RAW",
    traceback: "SECRET_TRACEBACK"
  });
  assert.equal(parsedFailure.message, "结构化失败消息优先");
  assert.equal(parsedFailure.retryCount, 3, "failure retry counts must be bounded before reaching UI state");
  assert.equal(parsedFailure.reverseProvider, "qwen3_vl_abliterated_nf4");
  assert.equal(parsedFailure.errorCode, "VISUAL_V2_CONTRACT_INVALID");
  assert.equal(parsedFailure.failureClass, "audio-fidelity");
  assert.equal(parsedFailure.generationGate, "blocked");
  assert.equal(parsedFailure.sensitivePromptBlocked, true);
  assert.equal(Object.hasOwn(parsedFailure, "rawOutput"), false);
  assert.equal(Object.hasOwn(parsedFailure, "traceback"), false);

  const resultUiContext = vm.createContext({
    state: { analysisResult: blocked.state.analysisResult },
    escapeSmartAiHtml: vm.runInNewContext(`(${escapeSmartAiHtmlSource})`)
  });
  const resultHtml = vm.runInContext([
    metadataTextSource,
    safetyLabelSource,
    safetyValueSource,
    explicitAgeAmbiguousSource,
    renderAnalysisResultSource,
    "renderSmartAiAnalysisResult();"
  ].join("\n"), resultUiContext);
  assert.match(resultHtml, /data-smart-ai-result-section="facts"[\s\S]*?图片事实/);
  assert.match(resultHtml, /data-smart-ai-result-section="safety"[\s\S]*?内容级别与风险/);
  assert.match(resultHtml, /data-smart-ai-result-section="constraints"[\s\S]*?生成与质量约束/);
  assert.match(resultHtml, /一名人物位于室内场景，近景镜头/, "non-sensitive visualPrompt facts remain visible when sensitive compilation is blocked");
  assert.match(resultHtml, /露骨性行为/);
  assert.match(resultHtml, /露骨敏感部位/);
  assert.match(resultHtml, /画面年龄无法独立核实/);
  assert.doesNotMatch(resultHtml, /不得在界面展示的露骨事实/);
  assert.doesNotMatch(resultHtml, /explicit_activity|explicit_anatomy|sensitive_prompt_age_unconfirmed/, "raw safety enums must not leak into the Chinese UI");
  assert.match(resultHtml, /<details class="novaflow-smart-ai-result-details">/, "generation constraints should be collapsed by default");
  assert.doesNotMatch(resultHtml, /<details[^>]*\sopen(?:\s|>)/);

  resultUiContext.state.analysisResult = minorRequirementsBlocked.state.analysisResult;
  const minorRequirementsBlockedHtml = vm.runInContext("renderSmartAiAnalysisResult();", resultUiContext);
  assert.match(minorRequirementsBlockedHtml, /附加要求包含明确未成年人内容/);
  assert.doesNotMatch(minorRequirementsBlockedHtml, /sensitive_prompt_minor_requirements/);

  assert.match(adultSensitive.state.analysisResult.prompt, /FULL_ADULT_HIDDEN_NSFW_CANDIDATE/);
  resultUiContext.state.analysisResult = adultSensitive.state.analysisResult;
  const fullAdultResultHtml = vm.runInContext("renderSmartAiAnalysisResult();", resultUiContext);
  assert.match(fullAdultResultHtml, /一名视觉上偏成年的人物位于室内场景/);
  assert.match(fullAdultResultHtml, /视觉上偏成年/);
  assert.doesNotMatch(fullAdultResultHtml, /需用户确认/);
  assert.doesNotMatch(fullAdultResultHtml, /FULL_ADULT_HIDDEN_NSFW_CANDIDATE|性接触互动/);

  resultUiContext.state.analysisResult = degradedAnalysis.state.analysisResult;
  const degradedResultHtml = vm.runInContext("renderSmartAiAnalysisResult();", resultUiContext);
  assert.match(degradedResultHtml, /中性图片事实/);
  assert.match(degradedResultHtml, /画面包含一名可见人物，室内近景，冷色照明/);
  assert.match(degradedResultHtml, /可见人物数量[\s\S]*?>1</);
  assert.match(degradedResultHtml, /分析状态[\s\S]*?内容分级未完成/);
  assert.match(degradedResultHtml, /未写入说明：分析结果不完整，仅展示中性摘要/);
  assert.doesNotMatch(degradedResultHtml, /内容级别|身体暴露|互动类型|年龄判断|无法确定/);
  assert.doesNotMatch(degradedResultHtml, /data-smart-ai-result-section="constraints"|生成与质量约束/);
  assert.doesNotMatch(degradedResultHtml, /不得写入的降级生成提示词|不得写入的降级负面词/);

  resultUiContext.state.analysisResult = {
    ...partialInteractionSummary,
    prompt: "成年人物保持明确的真实互动，INTERACTION_HIDDEN_NSFW_CANDIDATE",
    generationRequirements: "不得展示的部分分析具体生成约束"
  };
  const partialResultHtml = vm.runInContext("renderSmartAiAnalysisResult();", resultUiContext);
  assert.match(partialResultHtml, /中性图片事实/);
  assert.match(partialResultHtml, /画面包含一名可见人物，室内近景，暖色照明/);
  assert.match(partialResultHtml, /内容级别与风险/);
  assert.match(partialResultHtml, /露骨成人内容/);
  assert.match(partialResultHtml, /性相关内容/);
  assert.match(partialResultHtml, /可见人物数量[\s\S]*?>1</);
  assert.match(partialResultHtml, /NSFW 候选提示词未自动写入；请检查生成面板后重新分析/);
  assert.doesNotMatch(partialResultHtml, /INTERACTION_HIDDEN_NSFW_CANDIDATE|真实互动|不得展示的部分分析具体生成约束/);
  assert.doesNotMatch(partialResultHtml, /data-smart-ai-result-section="constraints"|生成与质量约束/);

  resultUiContext.state.analysisResult = {
    ...futureNeutralOnlySummary,
    prompt: "FUTURE_NEUTRAL_ONLY_CANDIDATE"
  };
  const futureNeutralOnlyResultHtml = vm.runInContext("renderSmartAiAnalysisResult();", resultUiContext);
  assert.match(futureNeutralOnlyResultHtml, /当前结果仅可应用中性提示词继续/);
  assert.doesNotMatch(futureNeutralOnlyResultHtml, /FUTURE_NEUTRAL_ONLY_CANDIDATE/);

  resultUiContext.state.analysisResult = {
    ...partialProjectionSummary,
    prompt: "成年人物保持明确的性接触互动，PROJECTION_HIDDEN_NSFW_CANDIDATE",
    generationRequirements: "不得展示的字段移除前敏感描述"
  };
  const projectionPartialResultHtml = vm.runInContext("renderSmartAiAnalysisResult();", resultUiContext);
  assert.match(projectionPartialResultHtml, /中性图片事实/);
  assert.match(projectionPartialResultHtml, /画面包含一名可见人物，室内近景，柔和暖色照明/);
  assert.match(projectionPartialResultHtml, /内容级别与风险/);
  assert.match(projectionPartialResultHtml, /存在裸露/);
  assert.match(projectionPartialResultHtml, /NSFW 候选提示词未自动写入；请检查生成面板后重新分析/);
  assert.doesNotMatch(projectionPartialResultHtml, /PROJECTION_HIDDEN_NSFW_CANDIDATE|性接触互动|不得展示的字段移除前敏感描述/);
  assert.doesNotMatch(projectionPartialResultHtml, /data-smart-ai-result-section="constraints"|生成与质量约束/);

  assert.match(ageUnverifiableAdult.state.analysisResult.prompt, /AGE_UNVERIFIABLE_HIDDEN_NSFW_CANDIDATE/);
  resultUiContext.state.analysisResult = ageUnverifiableAdult.state.analysisResult;
  const ageUnverifiableResultHtml = vm.runInContext("renderSmartAiAnalysisResult();", resultUiContext);
  assert.match(ageUnverifiableResultHtml, /画面包含一名人物，室内近景与暖色照明/);
  assert.match(ageUnverifiableResultHtml, /无法仅凭画面核实年龄/);
  assert.match(ageUnverifiableResultHtml, /画面年龄无法独立核实/);
  assert.doesNotMatch(ageUnverifiableResultHtml, /需用户确认/);
  assert.doesNotMatch(ageUnverifiableResultHtml, /敏感生成提示词未编译/);
  assert.doesNotMatch(ageUnverifiableResultHtml, /AGE_UNVERIFIABLE_HIDDEN_NSFW_CANDIDATE/);

  resultUiContext.state.analysisResult = {
    visualSchema: "nf.visual.v2",
    visualPrompt: '<img src=x onerror="window.__pwned=1">',
    generationRequirements: '</div><script>window.__pwned=2</script>',
    contentSafety: {
      level: '<svg onload="window.__pwned=3">',
      'bad"><img src=x onerror="window.__pwned=4">': "unsafe-key",
      signals: []
    },
    contentWarnings: ['</div><script>window.__pwned=5</script>'],
    sensitivePromptBlocked: false
  };
  const escapedResultHtml = vm.runInContext("renderSmartAiAnalysisResult();", resultUiContext);
  assert.doesNotMatch(escapedResultHtml, /<script|<img|<svg/i, "model metadata must never create executable HTML elements");
  assert.match(escapedResultHtml, /&lt;img src=x onerror=&quot;window\.__pwned=1&quot;&gt;/);
  assert.match(escapedResultHtml, /&lt;\/div&gt;&lt;script&gt;window\.__pwned=2&lt;\/script&gt;/);
  assert.match(escapedResultHtml, /&lt;svg onload=&quot;window\.__pwned=3&quot;&gt;/);
  assert.match(escapedResultHtml, /bad&quot;&gt;&lt;img src=x onerror=&quot;window\.__pwned=4&quot;&gt;/);

  const dialogState = { engine: "grok" };
  const openContext = vm.createContext({
    state: dialogState,
    window: {},
    getPromptTextareasFromContext: () => ({ positive: { value: "已有简单提示词" }, negative: null }),
    renderDialog: () => {},
    refreshImageContext: () => {}
  });
  const openDialog = vm.runInContext(`(${openDialogSource})`, openContext);
  openDialog({ surface: "art", artGenerateMode: "img2img" });
  assert.equal(dialogState.engine, "local", "Art must default to the local provider when it has no Art-specific preference");
  assert.equal(dialogState.mode, "optimize", "Art with an existing positive prompt must default to explicit prompt optimization");
  assert.equal(dialogState.requirements, "", "Art must keep the existing positive prompt separate from the supplemental user-requirement input");
  assert.match(smartAiSource, /engine:\s*"grok"/, "the shared initial state remains compatible with the unchanged Animation surface");
}

verifySmartAiBehavior().then(() => {
  console.log("prompt-assistant-release-contract: passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
