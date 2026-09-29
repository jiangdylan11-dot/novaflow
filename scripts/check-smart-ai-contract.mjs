import fs from "fs";
import path from "path";

const root = process.cwd();

function readText(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8").replace(/\r\n/g, "\n");
}

function assertIncludes(text, needle, label) {
  if (!text.includes(needle)) {
    throw new Error(`${label}: missing ${needle}`);
  }
}

function assertExcludes(text, needle, label) {
  if (text.includes(needle)) {
    throw new Error(`${label}: unexpected ${needle}`);
  }
}

function assertBefore(text, beforeNeedle, afterNeedle, label) {
  const beforeIndex = text.indexOf(beforeNeedle);
  const afterIndex = text.indexOf(afterNeedle);
  if (beforeIndex < 0 || afterIndex < 0 || beforeIndex >= afterIndex) {
    throw new Error(`${label}: expected ${beforeNeedle} before ${afterNeedle}`);
  }
}

function extractFunctionBody(text, functionName) {
  const marker = `function ${functionName}`;
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`source smart ai module: missing function ${functionName}`);
  const openBrace = text.indexOf("{", start);
  let depth = 0;
  for (let index = openBrace; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(openBrace + 1, index);
    }
  }
  throw new Error(`source smart ai module: unterminated function ${functionName}`);
}

function assertFile(filePath, label) {
  const absolutePath = path.join(root, filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`${label}: missing file ${filePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8").replace(/\r\n/g, "\n");
}

function checkBackend() {
  const server = readText("particle-editor-desktop/admin-server/server.js");
  assertExcludes(server, "/api/client/grok/prompt-design", "backend removed prompt design route");
  assertIncludes(server, "/api/client/grok/prompt-optimize", "backend prompt optimize route");
  assertIncludes(server, "/api/client/grok/image-reverse", "backend image reverse route");
  assertIncludes(server, "GROK_RESPONSES_PATH", "backend responses endpoint constant");
  assertIncludes(server, 'store: false', "backend disables Grok response storage");
  assertIncludes(server, "input_text", "backend text content contract");
  assertIncludes(server, "input_image", "backend vision content contract");
  assertIncludes(server, "handleGrokPromptOptimizeRequest", "backend prompt optimize handler");
  assertExcludes(server, "handleGrokPromptDesignRequest", "backend removed prompt design handler");
  assertIncludes(server, "handleGrokImageReverseRequest", "backend image reverse handler");
  assertIncludes(server, "REQUEST_BODY_TOO_LARGE", "backend large body error code");
  assertIncludes(server, "statusCode = 413", "backend large body status");
  assertIncludes(server, "safeErrorStatus", "backend error status helper");
  assertIncludes(server, "parseSmartAiPromptResult", "backend structured prompt parser");
  assertIncludes(server, "negative_prompt", "backend negative prompt response field");
  assertIncludes(server, "has_negative_prompt", "backend negative prompt presence field");
  assertIncludes(server, "DEFAULT_SMART_AI_NEGATIVE_PROMPT", "backend default negative prompt");
  assertIncludes(server, "中文生成提示词", "backend Chinese prompt style rule");
  assertIncludes(server, "WAN / Qwen / 可灵 / BANANNA / 即梦", "backend target model style rule");
  assertIncludes(server, "negative_prompt 必须返回中文反向提示词，不能为空", "backend required negative prompt rule");
  assertIncludes(server, "function isSmartAiAnimationPayload(payload)", "backend animation surface normalizer");
  assertIncludes(server, "function smartAiCurrentPrompt(payload", "backend current prompt aliases");
  assertIncludes(server, 'surface === "animation"', "backend animation surface contract");
  assertIncludes(server, '"video", "video_prompt", "video-prompt", "image_to_video", "image-to-video", "video_reverse"', "backend animation purpose aliases");
  assertIncludes(server, "当前视频 Prompt:", "backend current animation prompt merge");
  assertIncludes(server, "动作开始状态", "backend animation motion phases");
  assertIncludes(server, "约5秒", "backend animation duration guidance");
  assertIncludes(server, "单一连贯运镜", "backend animation camera guidance");
  assertIncludes(server, "const isCreate = !prompt && !isAnimation", "backend only permits art prompt creation");
  assertIncludes(server, 'mode: isCreate ? "prompt_create" : "prompt_optimize"', "backend create versus optimize usage mode");
  assertIncludes(server, "根据用户创作需求从零构建一条完整 Prompt", "backend art prompt creation instruction");
  assertIncludes(server, 'requestedScenario === "role_reference"', "backend role-aware multi-reference scenario");
  assertIncludes(server, "具有独立职责的参考图", "backend role isolation instruction");
  assertIncludes(server, "参考图中可见的界面按钮", "backend role references reject UI text contamination");
  assertIncludes(server, "这是严格的双图风格迁移任务", "backend dedicated Grok style-transfer contract");
  assertIncludes(server, "selectGrokSmartAiImageScenario", "backend image scenario routing");
  assertIncludes(server, 'scenario.scenario === "video_frames"', "backend first/last-frame scenario retained");
  assertIncludes(server, "这是首帧和尾帧", "backend first/last-frame prompt retained");

  const distServer = readText("particle-editor-desktop/dist/win-unpacked/resources/app/admin-server/server.js");
  assertExcludes(distServer, "/api/client/grok/prompt-design", "dist backend removed prompt design route");
  assertIncludes(distServer, "/api/client/grok/prompt-optimize", "dist backend prompt optimize route");
  assertIncludes(distServer, "/api/client/grok/image-reverse", "dist backend image reverse route");
  assertIncludes(distServer, "GROK_RESPONSES_PATH", "dist backend responses endpoint constant");
  assertIncludes(distServer, 'store: false', "dist backend disables Grok response storage");
  assertIncludes(distServer, "input_image", "dist backend vision content contract");
  assertIncludes(distServer, "handleGrokPromptOptimizeRequest", "dist backend prompt optimize handler");
  assertExcludes(distServer, "handleGrokPromptDesignRequest", "dist backend removed prompt design handler");
  assertIncludes(distServer, "handleGrokImageReverseRequest", "dist backend image reverse handler");
  assertIncludes(distServer, "REQUEST_BODY_TOO_LARGE", "dist backend large body error code");
  assertIncludes(distServer, "statusCode = 413", "dist backend large body status");
  assertIncludes(distServer, "safeErrorStatus", "dist backend error status helper");
  assertIncludes(distServer, "parseSmartAiPromptResult", "dist backend structured prompt parser");
  assertIncludes(distServer, "negative_prompt", "dist backend negative prompt response field");
  assertIncludes(distServer, "has_negative_prompt", "dist backend negative prompt presence field");
  assertIncludes(distServer, "DEFAULT_SMART_AI_NEGATIVE_PROMPT", "dist backend default negative prompt");
  assertIncludes(distServer, "中文生成提示词", "dist backend Chinese prompt style rule");
  assertIncludes(distServer, "WAN / Qwen / 可灵 / BANANNA / 即梦", "dist backend target model style rule");
  assertIncludes(distServer, "negative_prompt 必须返回中文反向提示词，不能为空", "dist backend required negative prompt rule");
  assertIncludes(distServer, "function isSmartAiAnimationPayload(payload)", "dist backend animation surface normalizer");
  assertIncludes(distServer, "function smartAiCurrentPrompt(payload", "dist backend current prompt aliases");
  assertIncludes(distServer, 'surface === "animation"', "dist backend animation surface contract");
  assertIncludes(distServer, "当前视频 Prompt:", "dist backend current animation prompt merge");
  assertIncludes(distServer, "动作开始状态", "dist backend animation motion phases");
  assertIncludes(distServer, "约5秒", "dist backend animation duration guidance");
  assertIncludes(distServer, "单一连贯运镜", "dist backend animation camera guidance");
  assertIncludes(distServer, "const isCreate = !prompt && !isAnimation", "dist backend only permits art prompt creation");
  assertIncludes(distServer, 'mode: isCreate ? "prompt_create" : "prompt_optimize"', "dist backend create versus optimize usage mode");
  assertIncludes(distServer, 'scenario.scenario === "video_frames"', "dist backend first/last-frame scenario retained");
  assertIncludes(distServer, "这是首帧和尾帧", "dist backend first/last-frame prompt retained");
  assertIncludes(distServer, "参考图中可见的界面按钮", "dist backend role references reject UI text contamination");

  const adminData = readText("particle-editor-desktop/license-admin-gui/admin-data.js");
  assertIncludes(adminData, "recordAdminGrokUsageDetail", "backend usage detail recorder");
  assertIncludes(adminData, "recent_calls", "backend usage record history");

  const distAdminData = readText("particle-editor-desktop/dist/win-unpacked/resources/app/license-admin-gui/admin-data.js");
  assertIncludes(distAdminData, "recordAdminGrokUsageDetail", "dist backend usage detail recorder");
  assertIncludes(distAdminData, "recent_calls", "dist backend usage record history");
}

function checkElectronBridge() {
  const main = readText("particle-editor-desktop/main.js");
  assertExcludes(main, "/api/client/grok/prompt-design", "main removed prompt design endpoint");
  assertIncludes(main, "/api/client/grok/prompt-optimize", "main allowed prompt endpoint");
  assertIncludes(main, "/api/client/grok/image-reverse", "main allowed image endpoint");
  assertIncludes(main, 'ipcMain.handle("smart-ai-prompt-optimize"', "main prompt IPC");
  assertExcludes(main, 'ipcMain.handle("smart-ai-prompt-design"', "main removed prompt design IPC");
  assertIncludes(main, 'ipcMain.handle("smart-ai-image-reverse"', "main image IPC");
  assertIncludes(main, 'requestPromptAssistant("optimizePrompt", {\n    prompt,\n    negativePrompt,\n    supportsNegativePrompt,\n    nsfw,\n    requirements,\n    surface,\n    purpose,\n    provider,\n    currentPrompt', "main local optimize context, NSFW state, and negative capability forwarding");
  assertIncludes(main, '}, optimizeTimeoutMs, {\n    verifiedCleanup: true,', "main local optimize verified cleanup lease");
  assertIncludes(main, 'requestPromptAssistant("reverseImagePrompt", {\n    images,\n    requirements,\n    surface,\n    purpose,\n    provider,\n    currentPrompt', "main local reverse animation context forwarding");
  assertIncludes(main, '}, usesMiniMaxH3Reverse ? 180_000 : 300_000, { verifiedCleanup: true })', "main local reverse verified cleanup lease");
  assertIncludes(main, 'payload?.currentPrompt ?? payload?.current_prompt ?? prompt).trim().slice(0, 20000)', "main local optimize current prompt limit");
  assertIncludes(main, 'payload?.currentPrompt ?? payload?.current_prompt ?? payload?.prompt ?? "").trim().slice(0, 20000)', "main local reverse current prompt limit");

  const preload = readText("particle-editor-desktop/preload.js");
  assertExcludes(preload, "smartAiPromptDesign", "preload removed prompt design bridge");
  assertIncludes(preload, "smartAiPromptOptimize", "preload prompt bridge");
  assertIncludes(preload, "smartAiImageReverse", "preload image bridge");
  assertIncludes(preload, "clientAuthSessionToken || payload?.token || payload?.sessionToken || payload?.accessToken", "preload image bridge session-token recovery");

  const distMain = readText("particle-editor-desktop/dist/win-unpacked/resources/app/main.js");
  assertExcludes(distMain, "/api/client/grok/prompt-design", "dist main removed prompt design endpoint");
  assertIncludes(distMain, "/api/client/grok/prompt-optimize", "dist main allowed prompt endpoint");
  assertIncludes(distMain, "/api/client/grok/image-reverse", "dist main allowed image endpoint");
  assertIncludes(distMain, 'ipcMain.handle("smart-ai-prompt-optimize"', "dist main prompt IPC");
  assertExcludes(distMain, 'ipcMain.handle("smart-ai-prompt-design"', "dist main removed prompt design IPC");
  assertIncludes(distMain, 'ipcMain.handle("smart-ai-image-reverse"', "dist main image IPC");
  assertIncludes(distMain, 'requestPromptAssistant("optimizePrompt", {\n    prompt,\n    negativePrompt,\n    supportsNegativePrompt,\n    nsfw,\n    requirements,\n    surface,\n    purpose,\n    provider,\n    currentPrompt', "dist main local optimize context, NSFW state, and negative capability forwarding");
  assertIncludes(distMain, '}, optimizeTimeoutMs, {\n    verifiedCleanup: true,', "dist main local optimize verified cleanup lease");
  assertIncludes(distMain, 'requestPromptAssistant("reverseImagePrompt", {\n    images,\n    requirements,\n    surface,\n    purpose,\n    provider,\n    currentPrompt', "dist main local reverse animation context forwarding");
  assertIncludes(distMain, '}, usesMiniMaxH3Reverse ? 180_000 : 300_000, { verifiedCleanup: true })', "dist main local reverse verified cleanup lease");
  assertIncludes(distMain, 'payload?.currentPrompt ?? payload?.current_prompt ?? prompt).trim().slice(0, 20000)', "dist main local optimize current prompt limit");
  assertIncludes(distMain, 'payload?.currentPrompt ?? payload?.current_prompt ?? payload?.prompt ?? "").trim().slice(0, 20000)', "dist main local reverse current prompt limit");

  const distPreload = readText("particle-editor-desktop/dist/win-unpacked/resources/app/preload.js");
  assertExcludes(distPreload, "smartAiPromptDesign", "dist preload removed prompt design bridge");
  assertIncludes(distPreload, "smartAiPromptOptimize", "dist preload prompt bridge");
  assertIncludes(distPreload, "smartAiImageReverse", "dist preload image bridge");

  const proxy = readText("particle-editor/proxy-electron-api.js");
  assertExcludes(proxy, "smartAiPromptDesign", "preview proxy removed prompt design bridge");
  assertIncludes(proxy, "smartAiPromptOptimize", "preview proxy prompt bridge");
  assertIncludes(proxy, "smartAiImageReverse", "preview proxy image bridge");

  const brandRuntime = readText("particle-editor/novaflow-brand-runtime.js");
  assertIncludes(brandRuntime, 'select.closest(".novaflow-smart-ai-dialog")', "smart AI native selects bypass the global dropdown portal");

  const localService = readText("particle-editor-desktop/prompt-assistant-service.py");
  assertIncludes(localService, "requirements_limit = 12000 if is_minimax_h3 else 2000", "local service purpose-scoped requirements limit");
  assertIncludes(localService, 'requirements = clean_text(payload.get("requirements") or "")[:requirements_limit]', "local service requirements normalization");
  assertIncludes(localService, "用户附加要求（高优先级输出约束）", "local service requirements instruction");
  assertIncludes(localService, "按附加要求调整最终生成提示词", "local reverse requirements instruction");
  assertIncludes(localService, "def is_animation_prompt_payload(payload: dict)", "local animation payload classifier");
  assertIncludes(localService, "def current_prompt_from_payload(payload: dict", "local current prompt aliases");
  assertIncludes(localService, 'surface == "animation"', "local animation surface contract");
  assertIncludes(localService, "视频生成 Prompt 设计助手", "local animation optimize specialization");
  assertIncludes(localService, "动作开始状态", "local animation motion phases");
  assertIncludes(localService, "约5秒", "local animation duration guidance");
  assertIncludes(localService, "单一连贯运镜", "local animation camera guidance");
  assertIncludes(localService, "is_create = not raw_prompt and not is_animation", "local service only permits art prompt creation");
  assertIncludes(localService, "请根据用户的创作需求从零构建", "local art prompt creation instruction");
  assertIncludes(localService, 'purpose == "roleReference"', "local role-aware multi-reference purpose");
  assertIncludes(localService, "参考图中可见的界面按钮", "local role references reject UI text contamination");
  assertIncludes(localService, 'purpose == "styleTransfer"', "local dedicated style-transfer route");
  assertIncludes(localService, "CONTENT_LOCK", "local style transfer isolates subject analysis");
  assertIncludes(localService, "STYLE_ONLY", "local style transfer isolates style analysis");
  assertIncludes(localService, "isolation_output", "local style transfer uses one bounded vision pass");
  assertIncludes(localService, "严格保留主体图", "local style transfer quality gate");
  assertIncludes(localService, "将这张图片视为视频首帧", "local single-image video reverse specialization");
  assertIncludes(localService, "build_first_last_analysis_prompt(image_tokens)", "local first/last analysis stage retained");
  assertIncludes(localService, "build_first_last_final_prompt(action_notes, image_tokens)", "local first/last final stage retained");
  assertIncludes(localService, "is_first_last_action_prompt_quality_ok", "local first/last quality gate retained");
}

function checkFrontendModule() {
  const source = assertFile("particle-editor/novaflow-smart-ai.js", "source smart ai module");
  const brandRuntime = assertFile("particle-editor/novaflow-brand-runtime.js", "source brand runtime");
  [
    "AI提示助手",
    "视频提示优化",
    "画面反推",
    "Grok AI",
    "本地模型",
    "动作与镜头要求（可选）",
    "只设计并写入提示词，不会直接生成视频",
    "生成提示词",
    "优化提示词",
    "图片反推",
    "反推并写入提示词",
    "结合多参考图生成提示词",
    "描述你想生成的画面",
    "Grok AI（云端，会上传参考图并消耗次数）",
    "无法切换生成模式",
    "请输入Prompt",
    "请先登录NovaFlow账号",
    "请先添加参考图、首帧或尾帧",
    "SMART_AI_VISION_MAX_SIDE",
    "SMART_AI_VISION_TARGET_BYTES",
    "normalizeSmartAiImageForVision",
    "canvas.toBlob",
    "image/jpeg",
    "smartAiFailureMessage",
    "getPromptTextareasFromContext",
    "findAnimationPromptTextareas",
    "findVisibleTextareaBySelector",
    "setPromptTextareasValue",
    "negativePrompt",
    "write_prompt_failed",
    "写入提示词失败",
    "未找到提示词框",
    "data-novaflow-smart-ai-button",
    "data-novaflow-ai-prompt-assistant-actions",
    "novaflow-art-generate-assistant-actions"
  ].forEach((token) => assertIncludes(source, token, "source smart ai module"));

  assertIncludes(source, 'artIntent?.route === "static_reverse"', "single Art reference uses the static reverse route");
  assertIncludes(source, 'artIntent?.route === "role_reference"', "multiple Art references use role-aware routing");
  assertIncludes(brandRuntime, "setMode: setArtGenerateMode", "Art Runtime exposes only the generation-mode bridge");

  assertIncludes(source, '...(isArtTextRequest ? { currentPrompt: promptMentionProtection.text } : {})', "source text edit forwards the live full prompt as currentPrompt");
  assertIncludes(source, "negativePrompt: negativePromptMentionProtection?.text ?? negativePrompt,\n          supportsNegativePrompt,\n          nsfw: isArtTextRequest ? analysisNsfw : false,\n          requirements,", "source local and Grok optimize requirements, NSFW state, and capability payload");
  assertIncludes(source, "? (isArtTextRequest ? artTextPurpose : artIntent?.purpose)", "source text edit purpose follows the live prompt while reference routes keep their intent purpose");
  assertIncludes(
    source,
    "promptAssistantReverseImagePrompt?.({\n          requirements: staticReverseRequirements,",
    "source local reverse requirements payload"
  );
  const exactAnimationPromptLookup = extractFunctionBody(source, "textareasFromExactAnimationTarget");
  assertIncludes(exactAnimationPromptLookup, "textareasFromAnimationScope(frame)", "source exact current shot prompt lookup");
  const animationPromptLookup = extractFunctionBody(source, "findAnimationPromptTextareas");
  assertIncludes(animationPromptLookup, "textareasFromExactAnimationTarget(button)", "source current shot is resolved first");
  assertBefore(
    animationPromptLookup,
    "textareasFromExactAnimationTarget(button)",
    "const scopes = [];",
    "source exact current shot must be resolved before workspace fallbacks"
  );
  const contextPromptLookup = extractFunctionBody(source, "getPromptTextareasFromContext");
  assertIncludes(contextPromptLookup, "getCapturedAnimationPromptTextareas(context)", "source submit reuses the captured current shot");
  const animationButtonMount = extractFunctionBody(source, "mountButton");
  assertIncludes(animationButtonMount, "captureAnimationPromptTarget(button)", "source captures current shot when opening SmartAI");

  const modeRenderer = extractFunctionBody(source, "renderModeRadios");
  assertIncludes(modeRenderer, '[["optimize", "视频提示优化"], ["reverse", "画面反推"]]', "source animation mode labels");
  assertExcludes(modeRenderer, "创建 / 优化提示词", "source art mode choice removed");
  assertExcludes(modeRenderer, "图片反推", "source art reverse choice removed");
  const artModeRenderer = extractFunctionBody(source, "renderArtModeRadios");
  assertIncludes(artModeRenderer, '[["optimize", "优化提示词"], ["reverse", "图片反推"]]', "source exposes explicit Art optimize and reverse actions");
  assertIncludes(artModeRenderer, 'value === "reverse" && !intent?.hasReferences', "source disables Art reverse until a reference exists");
  const engineRenderer = extractFunctionBody(source, "renderEngineOptions");
  assertIncludes(engineRenderer, 'name="novaflow-smart-ai-engine"', "source shared Grok/local engine selector");
  const animationProcessingNote = extractFunctionBody(source, "renderAnimationProcessingNote");
  assertIncludes(animationProcessingNote, 'if (state.context?.surface === "art") return "";', "source animation explanation must not change the art dialog");
  assertIncludes(animationProcessingNote, "只设计并写入提示词，不会直接生成视频", "source animation prompt-only explanation");
  const dialogRenderer = extractFunctionBody(source, "renderDialog");
  assertIncludes(dialogRenderer, 'renderArtModeRadios(artIntent)', "source renders the explicit Art action selector");
  assertIncludes(dialogRenderer, 'renderArtAutoStatus(artIntent)', "source renders the mode-aware Art route status");
  assertIncludes(dialogRenderer, 'isArt ? renderArtAdvancedSettings(artIntent)', "source keeps provider and multi-reference corrections under Art advanced settings");
  assertIncludes(dialogRenderer, 'const isArtTextEdit = isArt && state.mode === "optimize" && Boolean(currentArtPrompt)', "source distinguishes existing-prompt edit mode from the live prompt and explicit action");
  assertIncludes(dialogRenderer, '"说明你希望修改的内容（可选）"', "source labels the existing-prompt field as an edit instruction");
  assertIncludes(dialogRenderer, "背景过于曝光，降低背景高光并恢复层次", "source explains scoped prompt editing");
  assertIncludes(dialogRenderer, '(state.mode === "reverse" && state.imagesLoading)', "source lets text optimization proceed without waiting for unused image reads");
  assertIncludes(source, "已识别首帧 + 尾帧，将分析连续动作", "source first/last-frame animation context");

  const requirementsStart = source.indexOf("function buildSmartAiRequirements");
  const requirementsEnd = source.indexOf("function renderEngineOptions", requirementsStart);
  const artRequirementsBody = source.slice(requirementsStart, requirementsEnd);
  assertIncludes(artRequirementsBody, 'style: "auto"', "source text optimization uses automatic text-only quality style");
  assertIncludes(artRequirementsBody, 'mode: "txt2img"', "source text optimization quality rules stay independent of reference-image mode");
  ["taskLabel", "referenceRules", "preserveLabel", "styleLabel", "isolationRule", "artBackgroundInstruction()", "artAssetPreservationInstruction()"]
    .forEach((token) => assertExcludes(artRequirementsBody, token, "source text optimization hidden image constraints removed"));

  const fingerprintStart = source.indexOf("function buildSmartAiRequestFingerprint");
  const fingerprintEnd = source.indexOf("async function refreshImageContext", fingerprintStart);
  const fingerprintBody = source.slice(fingerprintStart, fingerprintEnd);
  assertIncludes(fingerprintBody, "options.ignoreArtReferenceState === true", "source supports text-only request freshness");
  assertIncludes(fingerprintBody, 'liveImages: ignoreArtReferenceState ? ""', "source text freshness excludes live references");
  assertIncludes(fingerprintBody, "artTask: ignoreArtReferenceState", "source text freshness excludes image-derived Art intent");

  const imageRefreshBody = extractFunctionBody(source, "refreshImageContext");
  assertIncludes(imageRefreshBody, "const refreshEpoch = ++state.imageRefreshEpoch", "source versions ordinary image refreshes");
  assertIncludes(imageRefreshBody, "state.context === context", "source rejects image results from a stale dialog context");
  assertIncludes(imageRefreshBody, "state.imageRefreshEpoch === refreshEpoch", "source rejects superseded image refresh results");

  const runSmartAiBody = extractFunctionBody(source, "runSmartAi");
  assertIncludes(runSmartAiBody, "const artIntent = isArt ? syncArtAutoIntent() : null", "source derives the Art route automatically");
  assertIncludes(runSmartAiBody, "if (artIntent && isReverseRequest && !syncArtGenerateMode(artIntent))", "source changes Art generation mode only for explicit image reverse and fails closed when that bridge cannot switch");
  assertIncludes(runSmartAiBody, "const isArtTextRequest = isArt && isOptimizeRequest", "source routes explicit Art optimize requests through the text workflow even when references exist");
  assertIncludes(runSmartAiBody, "ignoreArtReferenceState: isArt && isOptimizeRequest", "source uses text-only freshness for Art optimization");
  assertIncludes(runSmartAiBody, "buildSmartAiRequestFingerprint(requestFingerprintOptions)", "source rechecks the same action-scoped request fingerprint");
  assertIncludes(runSmartAiBody, "artHighQualityCgNegativeGuardInstruction({ textOnly: true })", "source text optimization negative quality rules ignore image-derived style state");
  assertIncludes(runSmartAiBody, 'const artTextPurpose = isArtTextRequest ? (currentPrompt ? "optimize" : "create") : ""', "source derives text edit versus create from the live prompt");
  assertIncludes(runSmartAiBody, 'artTextPurpose === "optimize" ? currentPrompt : ""', "source keeps the live full prompt as edit base and an empty prompt for creation");
  assertIncludes(runSmartAiBody, "includeUserIntent: !isArt || isArtTextRequest", "source forwards the Art text instruction in requirements");
  assertIncludes(runSmartAiBody, "userIntentFirst: isArtTextRequest", "source prioritizes the user text instruction before quality rules");
  assertIncludes(runSmartAiBody, 'artIntent?.route === "static_reverse"', "source routes one reference to static reverse");
  assertIncludes(runSmartAiBody, 'artIntent?.route === "role_reference"', "source routes multiple references by role");
  assertIncludes(runSmartAiBody, "roleAwareReferences", "source role-aware reference analysis route");
  assertIncludes(runSmartAiBody, '...(usesStructuredArtPromptContract', "source structured Art prompt capability payload");
  assertIncludes(runSmartAiBody, '? { surface: "art" }', "source structured Art optimize surface payload");
  assertIncludes(runSmartAiBody, ': (isArt ? {} : { surface: "animation" })', "source local optimize animation surface payload");
  assertIncludes(runSmartAiBody, 'promptSchema: ORDINARY_ART_PROMPT_SCHEMA', "source structured Art prompt schema payload");
  assertIncludes(runSmartAiBody, '...(isArt ? {} : { prompt })', "source Grok reverse current prompt payload");
  assertIncludes(runSmartAiBody, '...(isArt ? {} : { prompt, surface: "animation" })', "source local reverse current prompt and surface payload");
  assertIncludes(runSmartAiBody, "surface: state.context?.surface || \"\"", "source Grok animation surface payload");
  if ((runSmartAiBody.split("setPromptTextareasValue(").length - 1) !== 2) {
    throw new Error("source SmartAI submit must keep exactly one direct write and one confirmed write path");
  }

  assertIncludes(source, 'data-single="1"', "source unified single-action footer");
  assertExcludes(source, 'data-single="${isArt ? "1" : "0"}"', "source removed animation dual-action footer");
  assertExcludes(source, "novaflow-smart-ai-insert", "source removed insert-only animation action");
  assertIncludes(source, 'setSmartAiTextIfChanged(button, "AI提示助手")', "source unified SmartAI button label");

  [
    "智能AI",
    "Prompt优化",
    "AI优化",
    "AI反推",
    "置入提示词框",
    "insertRequirementsIntoPrompt",
    "智能设计",
    "data-design-goal",
    "designGoals",
    "textureDirections",
    "uiGoals",
    "smartAiPromptDesign",
    "撤销上次写入",
    "lastWrite",
    "undoLastPromptWrite",
    "captureUndo"
  ].forEach((token) => assertExcludes(source, token, "source removed smart design and art undo contracts"));
  assertIncludes(source, "getArtGenerationReferencePlan", "source exposes prepared conditioning reference plan");
  assertIncludes(brandRuntime, "rolePlan.conditioning.filter", "runtime only uploads prepared role-aware conditioning references");

  [
    "preserveAiAnimationPromptAssistantExternalButtons",
    "restoreAiAnimationPromptAssistantExternalButtons",
    'data-novaflow-smart-ai-button'
  ].forEach((token) => assertIncludes(brandRuntime, token, "source brand runtime SmartAI adapter"));

  const animationMountBody = extractFunctionBody(brandRuntime, "ensureAiAnimationPromptAssistantButtons");
  assertIncludes(animationMountBody, "restoreAiAnimationPromptAssistantExternalButtons", "runtime preserves the single SmartAI entry");
  assertExcludes(animationMountBody, "runAiAnimationPromptOptimize", "runtime removed local optimize shortcut entry");
  assertExcludes(animationMountBody, "runAiAnimationReversePrompt", "runtime removed local reverse shortcut entry");
  assertExcludes(animationMountBody, 'setAttribute("data-novaflow-ai-prompt-assistant-button"', "runtime does not recreate legacy animation shortcuts");

  [
    "particle-editor/index.html",
    "particle-editor-desktop/renderer/index.html",
    "particle-editor-desktop/dist/win-unpacked/resources/app/renderer/index.html"
  ].forEach((filePath) => {
    assertIncludes(readText(filePath), "novaflow-smart-ai.js", `${filePath} loader`);
  });

  [
    "particle-editor-desktop/renderer/novaflow-smart-ai.js",
    "particle-editor-desktop/dist/win-unpacked/resources/app/renderer/novaflow-smart-ai.js"
  ].forEach((filePath) => {
    const mirror = assertFile(filePath, "mirrored smart ai module");
    assertIncludes(mirror, 'const VERSION = "20260816-art-simple-structured-1"', `${filePath} explicit Art structured-detail SmartAI version`);
    assertIncludes(mirror, "只设计并写入提示词，不会直接生成视频", `${filePath} animation prompt-only explanation`);
    assertIncludes(mirror, "视频提示优化", `${filePath} animation optimize mode`);
    assertIncludes(mirror, "画面反推", `${filePath} animation reverse mode`);
    assertExcludes(mirror, "置入提示词框", `${filePath} removed insert-only animation action`);
  });
}

function checkSyncScripts() {
  [
    "scripts/sync-runtime.mjs",
    "scripts/check-runtime-sync.mjs"
  ].forEach((filePath) => {
    assertIncludes(readText(filePath), "novaflow-smart-ai.js", `${filePath} sync manifest`);
    assertIncludes(readText(filePath), "smart-ai-art-auto-intent.workflow.js", `${filePath} Art auto-intent sync manifest`);
    assertIncludes(readText(filePath), "admin-server", `${filePath} admin server sync manifest`);
    assertIncludes(readText(filePath), "admin-data.js", `${filePath} admin data sync manifest`);
  });
}

checkBackend();
checkElectronBridge();
checkFrontendModule();
checkSyncScripts();

console.log("smart-ai contract check passed");
