(function () {
  if (window.__NovaFlowSmartAI && window.__NovaFlowSmartAI.version) return;

  const VERSION = "20260817-prompt-editor-modal-1";
  const STYLE_ID = "novaflow-smart-ai-style";
  const ROOT_ID = "novaflow-smart-ai-dialog-root";
  const SESSION_STORAGE_KEY = "novaflow.client.auth.session.v1";
  const SMART_BUTTON_ATTR = "data-novaflow-smart-ai-button";
  const NOVAFLOW_PROMPT_ACTION_BUTTON_ATTR = "data-novaflow-prompt-action-button";
  const ANIMATION_ACTIONS_SELECTOR = '[data-novaflow-ai-prompt-assistant-actions="1"]';
  const ART_ACTIONS_SELECTOR = ".novaflow-art-generate-assistant-actions";
  const ANIMATION_POSITIVE_TEXTAREA_SELECTOR = [
    'textarea[data-novaflow-ai-prompt-kind="positive"]',
    'input[data-novaflow-ai-prompt-kind="positive"]',
    '[data-novaflow-ai-prompt-kind="positive"] textarea',
    '[data-novaflow-ai-prompt-kind="positive"] input',
    '[data-novaflow-ai-prompt-frame="1"][data-novaflow-ai-prompt-kind="positive"] textarea',
    '[data-novaflow-ai-prompt-frame="1"][data-novaflow-ai-prompt-kind="positive"] input'
  ].join(", ");
  const ANIMATION_NEGATIVE_TEXTAREA_SELECTOR = [
    'textarea[data-novaflow-ai-prompt-kind="negative"]',
    'input[data-novaflow-ai-prompt-kind="negative"]',
    '[data-novaflow-ai-prompt-kind="negative"] textarea',
    '[data-novaflow-ai-prompt-kind="negative"] input',
    '[data-novaflow-ai-prompt-frame="1"][data-novaflow-ai-prompt-kind="negative"] textarea',
    '[data-novaflow-ai-prompt-frame="1"][data-novaflow-ai-prompt-kind="negative"] input'
  ].join(", ");
  const ART_REQUIREMENTS_PLACEHOLDER = "例如：设计一个国风修仙手游的冰系女剑客，蓝白配色，手持长剑。";
  const ANIMATION_REQUIREMENTS_PLACEHOLDER = "例如：人物缓慢转身，镜头轻微推进，5 秒内完成，并保持脸、服装和背景稳定。";
  const SMART_AI_TEXT_REQUIRED_MESSAGE = "请先在提示词或补充要求里写想要的效果";
  const ART_STARTER_PRESETS = [
    ["character", "角色设计"],
    ["scene", "场景设计"],
    ["game_ui", "游戏 UI"],
    ["icon_prop", "图标道具"],
    ["vfx", "特效概念"],
    ["poster", "宣传海报"]
  ];
  const ART_TASK_PRESETS = [
    ["create", "从零创作"],
    ["preserve", "保持原图，提升质量"],
    ["transfer", "更换画面风格"],
    ["pose", "更换人物姿势"],
    ["background", "更换背景"],
    ["combine", "多参考图组合"]
  ];
  const ART_STYLE_PRESETS = [
    ["auto", "智能匹配", "根据资产类型与用户描述自动选择最合适的视觉风格，并保持整体统一"],
    ["original", "保持原风格", "保持原有视觉风格，只提升完成度"],
    ["reference", "跟随风格图", "只提取风格参考图的线条、笔触、上色、材质和光影语言，不复制其中的主体、服装、姿势、背景或构图"],
    ["realistic", "偏写实", "偏写实表现，比例与材质可信，光影自然，避免塑料感"],
    ["2_5d", "2.5D", "2.5D游戏美术，二维设计语言结合适度体积光影与半写实材质"],
    ["anime", "二次元", "高质量二次元游戏角色CG，精细半厚涂与柔和渐变上色，可信的面部体积、皮肤透光感、分组清晰的发丝、准确的人体结构和电影级光影；轮廓主要由明暗、色彩与材质边缘建立，边缘干净自然、与整体画风一致"],
    ["cel_comic", "赛璐璐 / 漫画线稿", "传统赛璐璐或漫画线稿表现，允许明确线条、墨线轮廓和概括色块，同时保持结构准确与商业插画完成度"],
    ["painted", "厚涂手绘", "高完成度厚涂手绘，可见但受控的笔触，扎实体积与软硬边变化"],
    ["game_cg", "高清游戏 CG", "高品质游戏宣传CG，电影级光影，精细材质，清晰轮廓和丰富但受控的细节"],
    ["chibi", "Q版", "Q版角色设计，简洁清晰的大轮廓与头身比例，同时保留身份、可见外观状态和道具特征"]
  ];
  const ART_REFERENCE_ROLES = [["subject", "主图 / 原图"], ["style", "风格参考"], ["pose", "姿势参考"], ["background", "背景 / 环境参考"], ["composition", "构图参考"], ["color", "配色参考"], ["material", "材质参考"], ["ui_layout", "UI 布局参考"]];
  const ART_BACKGROUND_MODES = [["replace", "替换为参考背景"], ["borrow", "借用环境特征"], ["preserve", "保留原背景"], ["blend", "融合两张图"]];
  const SMART_AI_VISION_MAX_SIDE = 1536;
  const SMART_AI_VISION_TARGET_BYTES = 2 * 1024 * 1024;
  const SMART_AI_VISION_MIN_QUALITY = 0.58;
  const SMART_AI_VISION_OUTPUT_MIME = "image/jpeg";
  const MINIMAX_H3_MODEL_ID = "minimax_h3_local";
  const MINIMAX_H3_VISUAL_SCHEMA = "nf.h3.visual.v1";
  const MINIMAX_H3_PROMPT_PURPOSE = "minimax-h3-prompt-enhance";
  const MINIMAX_H3_I2V_REVERSE_PURPOSE = "minimax-h3-i2v-reverse";
  const MINIMAX_H3_FL2V_REVERSE_PURPOSE = "minimax-h3-fl2v-reverse";
  const ORDINARY_ART_PROMPT_SCHEMA = "nf.art.prompt.v1";
  const ORDINARY_ART_EDIT_CONTRACT = "structured-recompile-v1";
  const ORDINARY_ART_SIMPLE_STRUCTURED_MODE = "simple-structured-v1";
  const ORDINARY_ART_PROMPT_SECTIONS = Object.freeze([
    "[风格设定]",
    "[主体物品]",
    "[环境背景]",
    "[光线与色彩]",
    "[拍摄参数]",
    "[用户附加要求]"
  ]);
  const MINIMAX_H3_MODE_VALUES = new Set(["text_video", "image_video", "first_last", "multi_reference"]);
  const MINIMAX_H3_MODE_BY_LABEL = Object.freeze({
    "文生视频": "text_video",
    "图生视频": "image_video",
    "首尾帧视频": "first_last",
    "多参视频": "multi_reference"
  });
  const MINIMAX_H3_RESOURCE_SLOTS = Object.freeze([
    Object.freeze({ key: "multi_ref_image_1", rawKind: "ref_image", domKind: "参考图1", label: "参考图1", kind: "image" }),
    Object.freeze({ key: "multi_ref_image_2", rawKind: "jimeng_image2_ref", domKind: "参考图2", label: "参考图2", kind: "image" }),
    Object.freeze({ key: "multi_ref_image_3", rawKind: "jimeng_image3_ref", domKind: "参考图3", label: "参考图3", kind: "image" }),
    Object.freeze({ key: "multi_ref_image_4", rawKind: "jimeng_image4_ref", domKind: "参考图4", label: "参考图4", kind: "image" }),
    Object.freeze({ key: "multi_ref_video_1", rawKind: "jimeng_video_ref", domKind: "视频参考", label: "视频参考", kind: "video" }),
    Object.freeze({ key: "multi_ref_audio_1", rawKind: "jimeng_audio_ref", domKind: "声音参考", label: "声音参考", kind: "audio" })
  ]);
  const MINIMAX_H3_IMAGE_VIDEO_RESOURCE_SLOTS = Object.freeze([
    Object.freeze({ key: "first_frame", rawKind: "ref_image", domKinds: ["首帧", "参考图", "参考图1"], emptyLabels: ["首帧", "参考图", "参考图1"], label: "首帧", kind: "image" })
  ]);
  const MINIMAX_H3_FIRST_LAST_RESOURCE_SLOTS = Object.freeze([
    Object.freeze({ key: "first_frame", rawKind: "first_frame", domKind: "首帧", label: "首帧", kind: "image" }),
    Object.freeze({ key: "last_frame", rawKind: "last_frame", domKind: "尾帧", label: "尾帧", kind: "image" })
  ]);

  const state = {
    open: false,
    mode: "optimize",
    engine: "grok",
    starterPreset: "",
    artTask: "create",
    artStyle: "original",
    backgroundMode: "replace",
    preserveLevel: "high",
    referenceRoles: ["subject", "style", "pose"],
    referenceRoleOverrides: {},
    requirements: "",
    hadInitialPrompt: false,
    advancedOpen: false,
    loading: false,
    message: "",
    messageTone: "",
    analysisResult: null,
    analysisFailure: null,
    pendingApply: null,
    revealAnalysisOnRender: false,
    context: null,
    images: [],
    imagesLoading: false,
    imageRefreshEpoch: 0,
    miniMaxH3ReverseError: "",
    targetIndex: 0
  };
  let SMART_AI_MOUNT_FRAME = 0;
  let ART_REFERENCE_PLAN = null;
  let MINIMAX_H3_RESOURCE_VERSION = 0;
  let MINIMAX_H3_PENDING_RESOURCE_SLOT = null;
  let MINIMAX_H3_RESOURCE_OBJECT_SEQUENCE = 0;
  const MINIMAX_H3_RESOURCE_OBJECT_IDS = new WeakMap();

  function miniMaxH3NormalizeMode(value) {
    const mode = String(value || "").trim();
    return MINIMAX_H3_MODE_VALUES.has(mode) ? mode : "";
  }

  function miniMaxH3ContentPolicy() {
    return Object.freeze({
      sensitiveVisualAnalysis: true,
      allSubjectsConfirmedAdult: false
    });
  }

  function miniMaxH3SensitiveRequestHasExplicitMinorTerms(value) {
    const normalized = String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/\byoung[- ]?adults?\b/giu, "adult")
      .replace(/\u5e74\u8f7b(?:\u7684)?\u6210\u5e74(?:\u4eba|\u5973\u6027|\u7537\u6027|\u5973\u4eba|\u7537\u4eba)?/gu, "\u6210\u5e74\u4eba");
    if (!normalized) return false;
    return /(?:\u672a\u6210\u5e74\u4eba?|\u672a\u6ee1\s*(?:18|\u5341\u516b)\s*\u5c81?|(?:18|\u5341\u516b)\s*\u5c81?\s*(?:\u4ee5\u4e0b|\u4ee5\u5185)|(?<![0-9])(?:1[0-7]|[0-9])\s*\u5c81(?![0-9])|\u513f\u7ae5|\u5b69\u7ae5|\u5c0f\u5b69|\u5e7c\u5973|\u5e7c\u7ae5|\u5e7c\u513f|\u5a74\u5e7c\u513f?|\u5a74\u513f|\u841d\u8389|\u6b63\u592a)|(?<![a-z0-9_])(?:underage|minors?|child(?:ren)?(?![-\s]?like\b)|juveniles?|loli|shota|under[-\s]*18|(?:1[0-7]|[0-9])[-\s]*years?[-\s]*old|(?:1[0-7]|[0-9])\s*y\s*\/?\s*o|aged?\s*(?:1[0-7]|[0-9]))(?![a-z0-9_])/iu.test(normalized);
  }

  function miniMaxH3SensitiveRequestHasSensitiveTerms(value) {
    const normalized = String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/(?:\b(?:no|not|without)\b|(?:没有|不含|未见|无))(?:明显)?\s*(?:nudity|nude|naked|topless|sexual(?:\s+activity)?|explicit(?:\s+anatomy)?|裸体|裸露|性行为|生殖器|乳头|乳房)/giu, "");
    if (!normalized) return false;
    return /(?:裸体|裸露|全裸|半裸|一丝不挂|性行为|性交|交合|性爱|性活动|口交|肛交|自慰|手淫|生殖器|性器官|阴茎|阴道|外阴|阴唇|阴蒂|肛门|乳头|乳房|精液|性体液|色情|情色|成人内容|性暗示|胸部暴露)|(?<![a-z0-9_])(?:nudity|nude|naked|topless|nsfw|porn(?:ographic|ography)?|sexual[_\s-]+(?:activity|act|fluid)|explicit[_\s-]+(?:activity|anatomy)|intercourse|oral\s+sex|anal\s+sex|masturbat(?:e|ion|ing)|genitals?|penis|vagina|vulva|anus|semen|bare\s+breasts?|exposed\s+breasts?)(?![a-z0-9_])/iu.test(normalized);
  }

  function miniMaxH3ActiveMode(workspace) {
    const workspaceMode = miniMaxH3NormalizeMode(workspace?.getAttribute?.("data-novaflow-ai-generation-mode"));
    if (workspaceMode) return workspaceMode;
    const activeButton = Array.from(document.querySelectorAll('[data-novaflow-ai-top-mode-tabs="1"] button'))
      .find((button) => button instanceof HTMLButtonElement && button.getAttribute("aria-pressed") === "true");
    const semanticMode = miniMaxH3NormalizeMode(activeButton?.getAttribute?.("data-novaflow-ai-generation-mode"));
    if (semanticMode) return semanticMode;
    const label = String(activeButton?.textContent || "").replace(/\s+/g, "").trim();
    return MINIMAX_H3_MODE_BY_LABEL[label] || "";
  }

  function miniMaxH3ResourceSlot(workspace, descriptor) {
    if (!(workspace instanceof HTMLElement)) return null;
    const inputConfig = window.NovaFlowAiSequenceInputCompat?.uploadKindConfig?.[descriptor.rawKind];
    const domKinds = [
      ...(Array.isArray(descriptor.domKinds) ? descriptor.domKinds : []),
      inputConfig?.domKind,
      descriptor.domKind,
      descriptor.rawKind
    ].map((value) => String(value || "")).filter(Boolean);
    for (const domKind of new Set(domKinds)) {
      const slot = workspace.querySelector(`[data-ais-import="${domKind}"]`);
      if (slot) return slot;
    }
    return null;
  }

  function miniMaxH3ResourceObjectIdentity(value) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) return "";
    let identity = MINIMAX_H3_RESOURCE_OBJECT_IDS.get(value);
    if (!identity) {
      MINIMAX_H3_RESOURCE_OBJECT_SEQUENCE += 1;
      identity = `object-${MINIMAX_H3_RESOURCE_OBJECT_SEQUENCE}`;
      MINIMAX_H3_RESOURCE_OBJECT_IDS.set(value, identity);
    }
    return identity;
  }

  function miniMaxH3DomResourceIdentity(slot) {
    if (!(slot instanceof HTMLElement)) return "";
    const explicitIdentity = [
      "data-novaflow-resource-id",
      "data-novaflow-resource-object-url",
      "data-resource-id",
      "data-object-url"
    ].map((name) => String(slot.getAttribute(name) || "").trim()).find(Boolean);
    if (explicitIdentity) return explicitIdentity;
    const fileInput = slot.querySelector('input[type="file"]');
    const file = fileInput instanceof HTMLInputElement ? fileInput.files?.[0] : null;
    if (!file) return "";
    return [
      miniMaxH3ResourceObjectIdentity(file),
      String(file.name || ""),
      Number(file.size) || 0,
      Number(file.lastModified) || 0,
      String(file.type || "")
    ].join(":");
  }

  function miniMaxH3AdvanceResourceVersion() {
    MINIMAX_H3_RESOURCE_VERSION = MINIMAX_H3_RESOURCE_VERSION >= Number.MAX_SAFE_INTEGER
      ? 1
      : MINIMAX_H3_RESOURCE_VERSION + 1;
    return MINIMAX_H3_RESOURCE_VERSION;
  }

  function miniMaxH3ResourceEventSlot(target) {
    const element = target instanceof Element ? target : target?.parentElement;
    const slot = element?.closest?.("[data-ais-import]");
    if (!(slot instanceof HTMLElement)) return null;
    const workspace = slot.closest('[data-novaflow-ai-bottom-workspace="1"]');
    const modelId = String(
      workspace?.getAttribute?.("data-novaflow-ai-model-method") ||
      document.body?.getAttribute?.("data-novaflow-ai-model-method") ||
      ""
    ).trim();
    return modelId === MINIMAX_H3_MODEL_ID ? slot : null;
  }

  function trackMiniMaxH3ResourceClick(event) {
    const slot = miniMaxH3ResourceEventSlot(event?.target);
    if (!(slot instanceof HTMLElement)) {
      const input = event?.target;
      if (input instanceof HTMLInputElement && String(input.type || "").toLowerCase() === "file") return;
      MINIMAX_H3_PENDING_RESOURCE_SLOT = null;
      return;
    }
    const target = event?.target instanceof Element ? event.target : event?.target?.parentElement;
    const button = target?.closest?.("button");
    if (button instanceof HTMLButtonElement && slot.contains(button)) {
      MINIMAX_H3_PENDING_RESOURCE_SLOT = null;
      miniMaxH3AdvanceResourceVersion();
      return;
    }
    MINIMAX_H3_PENDING_RESOURCE_SLOT = slot;
  }

  function trackMiniMaxH3ResourceFileChange(event) {
    const input = event?.target;
    if (!(input instanceof HTMLInputElement) || String(input.type || "").toLowerCase() !== "file") return;
    const hasSelectedFile = Number(input.files?.length || 0) > 0;
    const h3IsActive = miniMaxH3ActiveModelMethod(null) === MINIMAX_H3_MODEL_ID;
    if (hasSelectedFile && (MINIMAX_H3_PENDING_RESOURCE_SLOT instanceof HTMLElement || h3IsActive)) {
      miniMaxH3ResourceObjectIdentity(input.files[0]);
      miniMaxH3AdvanceResourceVersion();
    }
    MINIMAX_H3_PENDING_RESOURCE_SLOT = null;
  }

  function trackMiniMaxH3ResourceDrop(event) {
    if (miniMaxH3ResourceEventSlot(event?.target) instanceof HTMLElement) {
      MINIMAX_H3_PENDING_RESOURCE_SLOT = null;
      miniMaxH3AdvanceResourceVersion();
    }
  }

  function miniMaxH3PreviewFingerprint(value) {
    const text = String(value || "");
    const sample = `${text.slice(0, 128)}:${text.slice(-128)}`;
    let hash = 2166136261;
    for (let index = 0; index < sample.length; index += 1) {
      hash ^= sample.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return text ? `${text.length}:${(hash >>> 0).toString(16)}` : "";
  }

  function miniMaxH3ResourceSnapshot(workspace, mode) {
    const descriptors = mode === "image_video"
      ? MINIMAX_H3_IMAGE_VIDEO_RESOURCE_SLOTS
      : mode === "first_last"
        ? MINIMAX_H3_FIRST_LAST_RESOURCE_SLOTS
        : mode === "multi_reference"
          ? MINIMAX_H3_RESOURCE_SLOTS
          : [];
    return descriptors.map((descriptor) => {
      const slot = miniMaxH3ResourceSlot(workspace, descriptor);
      const image = slot instanceof HTMLElement ? slot.querySelector("img") : null;
      const media = slot instanceof HTMLElement ? slot.querySelector("video, audio") : null;
      const title = slot instanceof HTMLElement ? slot.querySelector(".nf-upload-dropzone__title") : null;
      const titleText = String(title?.textContent || "").trim();
      const previewUrl = descriptor.kind === 'video' && workspace.querySelector('[data-novaflow-h3-video-url]')?.getAttribute('data-novaflow-h3-video-url')
        || (image instanceof HTMLImageElement
        ? String(image.currentSrc || image.src || "")
        : media instanceof HTMLMediaElement
          ? String(media.currentSrc || media.src || "")
          : "");
      const clearControl = slot instanceof HTMLElement
        ? slot.querySelector('button[title="清除"], button[aria-label="清除"], [data-novaflow-ai-upload-clear="1"]')
        : null;
      const semanticTitle = titleText.replace(/\s+\d+\s*[×x]\s*\d+\s*$/i, "").trim();
      const emptyLabels = new Set([
        descriptor.label,
        descriptor.domKind,
        ...(Array.isArray(descriptor.domKinds) ? descriptor.domKinds : []),
        ...(Array.isArray(descriptor.emptyLabels) ? descriptor.emptyLabels : [])
      ].map((value) => String(value || "").trim()).filter(Boolean));
      const fileName = titleText && !emptyLabels.has(semanticTitle) ? titleText : "";
      const fileInput = slot instanceof HTMLElement ? slot.querySelector('input[type="file"]') : null;
      const file = fileInput instanceof HTMLInputElement ? fileInput.files?.[0] : null;
      const previewMimeType = /^data:([^;,]+)/i.exec(previewUrl)?.[1] || "";
      const mimeType = String(file?.type || previewMimeType || "").trim().toLowerCase();
      const occupied = Boolean(
        slot instanceof HTMLElement &&
        (previewUrl || clearControl || fileName || slot.getAttribute("data-novaflow-resource-occupied") === "1")
      );
      const previewFingerprint = miniMaxH3PreviewFingerprint(previewUrl);
      const domIdentity = miniMaxH3DomResourceIdentity(slot);
      const sourceId = occupied
        ? [descriptor.key, domIdentity, fileName, previewFingerprint, `version-${MINIMAX_H3_RESOURCE_VERSION}`].join(":")
        : "";
      return Object.freeze({
        key: descriptor.key,
        label: descriptor.label,
        kind: descriptor.kind,
        occupied,
        available: slot instanceof HTMLElement,
        sourceId,
        identity: sourceId,
        fileName,
        mimeType,
        previewUrl,
        previewFingerprint,
        resourceVersion: MINIMAX_H3_RESOURCE_VERSION
      });
    });
  }

  // data-novaflow-ai-model-method only mirrors the AI sequence model <select>,
  // and the brand runtime writes that mirror from the select's change event.
  // MiniMax H3 has been the single option since the WAN line was retired, so the
  // change event never fires and the mirror can stay empty for a whole session.
  // Read the select itself when the mirror is missing, or the H3 five-section
  // protocol silently degrades into the ordinary one-paragraph prompt pipeline.
  function miniMaxH3SelectedModelMethod() {
    const selects = document.querySelectorAll ? document.querySelectorAll("select") : [];
    const select = Array.from(selects).find((node) => (
      node instanceof HTMLSelectElement &&
      Array.from(node.options || []).some((option) => String(option?.value || "") === MINIMAX_H3_MODEL_ID)
    ));
    return select instanceof HTMLSelectElement ? String(select.value || "").trim() : "";
  }

  function miniMaxH3ActiveModelMethod(workspace) {
    const mirrored = String(
      (workspace instanceof HTMLElement ? workspace.getAttribute("data-novaflow-ai-model-method") : "") ||
      document.body?.getAttribute?.("data-novaflow-ai-model-method") ||
      ""
    ).trim();
    return mirrored && mirrored !== "unknown" ? mirrored : miniMaxH3SelectedModelMethod();
  }

  function readMiniMaxH3PromptSurfaceState(button, promptTarget) {
    const workspace = promptTarget?.workspace instanceof HTMLElement
      ? promptTarget.workspace
      : button?.closest?.('[data-novaflow-ai-bottom-workspace="1"]');
    const modelId = miniMaxH3ActiveModelMethod(workspace);
    const durationInput = workspace instanceof HTMLElement
      ? workspace.querySelector('[data-novaflow-h3-duration="1"], [data-novaflow-h3-duration]')
      : null;
    const durationSeconds = Number(durationInput?.value);
    const mode = miniMaxH3ActiveMode(workspace);
    return Object.freeze({
      modelId,
      mode,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
      resources: Object.freeze(miniMaxH3ResourceSnapshot(workspace, mode)),
      capturedAt: Date.now()
    });
  }

  function captureMiniMaxH3PromptContext(button, promptTarget) {
    const snapshot = readMiniMaxH3PromptSurfaceState(button, promptTarget);
    return snapshot.modelId === MINIMAX_H3_MODEL_ID ? snapshot : null;
  }

  function getMiniMaxH3PromptWorkflow() {
    const workflow = window.NovaFlowAiSequenceMiniMaxH3PromptWorkflow;
    if (!workflow || typeof workflow.prepareRequest !== "function" || typeof workflow.validateAndRestore !== "function") {
      throw new Error("MiniMax H3 提示词增强模块未加载，请刷新页面后重试");
    }
    return workflow;
  }

  function prepareMiniMaxH3PromptRequest(prompt, requirements) {
    let captured = state.context?.miniMaxH3;
    const live = typeof readMiniMaxH3PromptSurfaceState === "function"
      ? readMiniMaxH3PromptSurfaceState(state.context?.button, state.context?.promptTarget)
      : null;
    if (live?.modelId === MINIMAX_H3_MODEL_ID) {
      captured = live;
      if (state.context && typeof state.context === "object") {
        state.context = Object.assign({}, state.context, { miniMaxH3: captured });
      }
    }
    if (!captured || captured.modelId !== MINIMAX_H3_MODEL_ID) return null;
    const workflow = getMiniMaxH3PromptWorkflow();
    const prepared = workflow.prepareRequest({
      modelId: captured.modelId,
      mode: captured.mode,
      durationSeconds: captured.durationSeconds,
      prompt: String(prompt || ""),
      requirements: String(requirements || ""),
      contentPolicy: miniMaxH3ContentPolicy(),
      resources: captured.resources
    });
    if (!prepared || typeof prepared !== "object") throw new Error("MiniMax H3 提示词增强请求无效");
    const preparedPrompt = String(prepared.prompt ?? prepared.text ?? "").trim();
    if (!preparedPrompt) throw new Error("MiniMax H3 提示词增强请求缺少提示词");
    const protocolRequirements = String(prepared.requirements ?? prepared.text ?? "").trim();
    const userRequirements = String(requirements || "").trim();
    const combinedRequirements = [protocolRequirements, userRequirements]
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join("\n\n");
    return Object.freeze({
      prompt: preparedPrompt,
      sourcePrompt: String(prompt || ""),
      requirements: combinedRequirements,
      context: prepared.context && typeof prepared.context === "object" ? prepared.context : prepared,
      workflow
    });
  }

  // 多参视频 with an empty prompt box and a 补充要求: the uploads are the brief,
  // so it rides the optimize pipeline with a placeholder source and the
  // 补充要求 plus this hint as the requirement.
  const MINIMAX_H3_REFERENCE_REVERSE_PLACEHOLDER = "根据已上传的参考图、视频和音频反推视频提示词";
  const MINIMAX_H3_REFERENCE_REVERSE_HINT = "素材反推：没有原提示词，请以已上传素材的实际内容为依据编写完整计划；上传了什么就参考什么，不要求未上传的素材。";
  function miniMaxH3ReferenceReverseError(captured = state.context?.miniMaxH3) {
    const resources = Array.isArray(captured?.resources) ? captured.resources : [];
    return resources.some((resource) => resource?.occupied && resource.kind !== "audio")
      ? ""
      : "提示词为空时，请先添加参考图或参考视频";
  }

  function validateMiniMaxH3PromptResult(text, prepared, textareas) {
    if (!prepared?.workflow || typeof prepared.workflow.validateAndRestore !== "function") {
      throw new Error("MiniMax H3 提示词增强校验模块不可用");
    }
    const current = readMiniMaxH3PromptSurfaceState(state.context?.button, state.context?.promptTarget);
    const validated = prepared.workflow.validateAndRestore({
      text: String(text || ""),
      context: prepared.context,
      current: {
        modelId: current.modelId,
        mode: current.mode,
        durationSeconds: current.durationSeconds,
        prompt: String(prepared.sourcePrompt || textareas?.positive?.value || ""),
        contentPolicy: miniMaxH3ContentPolicy(),
        resources: current.resources
      }
    });
    if (!validated || typeof validated !== "object" || validated.ok === false) {
      throw new Error(String(validated?.error || "MiniMax H3 提示词结构校验失败"));
    }
    const restoredText = String(validated.text ?? validated.prompt ?? "").trim();
    if (!restoredText) throw new Error("MiniMax H3 提示词结构校验未返回可写入内容");
    return restoredText;
  }

  function getMiniMaxH3ReverseWorkflow() {
    const workflow = window.NovaFlowAiSequenceMiniMaxH3ReverseWorkflow;
    if (!workflow || typeof workflow.getCapability !== "function" || typeof workflow.prepareRequest !== "function" || typeof workflow.validateAndRestore !== "function") {
      throw new Error("MiniMax H3 参考图反推模块未加载，请刷新页面后重试");
    }
    return workflow;
  }

  function miniMaxH3ReverseCapability(captured = state.context?.miniMaxH3) {
    if (!captured || captured.modelId !== MINIMAX_H3_MODEL_ID) return null;
    try {
      return getMiniMaxH3ReverseWorkflow().getCapability(captured.mode) || null;
    } catch {
      return null;
    }
  }

  async function miniMaxH3ImageDataUrl(src) {
    const value = String(src || "").trim();
    if (!value) throw new Error("MiniMax H3 反推参考图尚未就绪");
    let normalized = await normalizeImageUrl(value);
    if (/^data:image\/[^;,]+;base64,/i.test(normalized)) return normalized;
    const response = await fetch(normalized || value);
    if (!response.ok) throw new Error(`MiniMax H3 反推参考图读取失败 (${response.status})`);
    normalized = await normalizeImageUrl(await dataUrlFromBlob(await response.blob()));
    if (!/^data:image\/[^;,]+;base64,/i.test(normalized)) {
      throw new Error("MiniMax H3 反推参考图格式无效");
    }
    return normalized;
  }

  async function hydrateMiniMaxH3ReverseResources(captured) {
    const workflow = getMiniMaxH3ReverseWorkflow();
    const capability = workflow.getCapability(captured?.mode);
    if (!capability?.supportsReverse) return Object.freeze([]);
    const requiredSlots = Array.isArray(capability.requiredSlots) ? capability.requiredSlots : [];
    const byKey = new Map((Array.isArray(captured?.resources) ? captured.resources : []).map((resource) => [String(resource?.key || ""), resource]));
    const hydrated = [];
    for (const key of requiredSlots) {
      const resource = byKey.get(String(key));
      if (!resource?.occupied || resource.kind !== "image") {
        throw new Error(`${String(resource?.label || key)}尚未添加可用参考图`);
      }
      const dataUrl = await miniMaxH3ImageDataUrl(resource.previewUrl || resource.dataUrl);
      const mimeType = String(/^data:([^;,]+)/i.exec(dataUrl)?.[1] || resource.mimeType || "image/jpeg").trim().toLowerCase();
      hydrated.push(Object.freeze({
        key: String(resource.key || key),
        label: String(resource.label || key),
        kind: "image",
        occupied: true,
        identity: String(resource.identity || resource.sourceId || ""),
        sourceId: String(resource.sourceId || resource.identity || ""),
        dataUrl,
        fileName: String(resource.fileName || ""),
        mimeType
      }));
    }
    return Object.freeze(hydrated);
  }

  // 图生视频/首尾帧/多参 optimize sends its frames to the local model and to Grok
  // alike, so the writer takes the style, subjects and composition from the
  // pictures. Both get them at 768 px: small details such as closed eyes and
  // hand positions survive, and a first/last pair stays far below the 10 MB request.
  async function captureH3ReferenceFrames(captured, prepared) {
    const frameMode = captured?.mode === 'image_video' || captured?.mode === 'first_last';
    if (captured?.mode !== 'multi_reference' && !frameMode) return [];
    const side = 768;
    const catalog = prepared?.protocol?.references?.references
      || getMiniMaxH3PromptWorkflow().createReferenceCatalog({mode:captured.mode, resources:captured.resources}).references;
    const frames = [];
    const draw = media => {
      const w = media.videoWidth || media.naturalWidth, h = media.videoHeight || media.naturalHeight;
      if (!w || !h) throw new Error('参考画面尺寸无效');
      const scale = Math.min(1, side / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(media, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', .88);
    };
    const event = (media, name, action) => new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); media.removeEventListener(name, ok); media.removeEventListener('error', fail); };
      const ok = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('参考视频读取失败')); };
      const timer = setTimeout(fail, 20000);
      media.addEventListener(name, ok, {once:true}); media.addEventListener('error', fail, {once:true});
      try { action(); } catch(error) { cleanup(); reject(error); }
    });
    for (const reference of catalog) {
      const resource = captured.resources.find(item => item.key === reference.slotKey);
      if (!resource || resource.kind === 'audio' || reference.kind === 'audio') continue;
      const src = resource.previewUrl || resource.objectUrl || resource.dataUrl;
      if (!src) throw new Error(`${reference.uiToken || reference.modelToken} 尚未读取到真实素材，请重新添加该素材`);
      if (reference.kind === 'image') {
        const img = new Image(); img.src = await miniMaxH3ImageDataUrl(src); await img.decode();
        frames.push({label:reference.modelToken, dataUrl:draw(img)});
      } else if (reference.kind === 'video') {
        const video = document.createElement('video'); video.muted = true; video.preload = 'auto';
        try {
          await event(video, 'loadeddata', () => { video.src = src; video.load(); });
          if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('参考视频时长无效');
          const end = Math.min(Number(captured.durationSeconds) || video.duration, video.duration - .001, 15);
          for (let i = 0; i < 9; i++) {
            const timeSeconds = end * i / 8;
            if (Math.abs(video.currentTime - timeSeconds) > .00001) await event(video, 'seeked', () => { video.currentTime = timeSeconds; });
            frames.push({label:reference.modelToken, timeSeconds, dataUrl:draw(video)});
          }
        } finally { video.removeAttribute('src'); video.load(); }
      }
    }
    return frames;
  }

  async function refreshMiniMaxH3ReverseContext() {
    const originalContext = state.context;
    let hydratedContext = null;
    const captured = originalContext?.miniMaxH3;
    const capability = miniMaxH3ReverseCapability(captured);
    state.images = [];
    state.miniMaxH3ReverseError = "";
    if (!capability?.supportsReverse) {
      state.imagesLoading = false;
      renderDialog();
      return;
    }
    state.imagesLoading = true;
    renderDialog();
    try {
      const resources = await hydrateMiniMaxH3ReverseResources(captured);
      if (state.context !== originalContext) return;
      hydratedContext = Object.assign({}, originalContext, {
        miniMaxH3: Object.freeze(Object.assign({}, captured, { resources }))
      });
      state.context = hydratedContext;
    } catch (error) {
      if (state.context !== originalContext) return;
      state.miniMaxH3ReverseError = String(error?.message || error || "MiniMax H3 反推参考图读取失败");
    } finally {
      if (state.context === originalContext || state.context === hydratedContext) {
        state.imagesLoading = false;
        renderDialog();
      }
    }
  }

  async function prepareMiniMaxH3ReverseRequest(prompt, requirements) {
    let captured = state.context?.miniMaxH3;
    const live = typeof readMiniMaxH3PromptSurfaceState === "function"
      ? readMiniMaxH3PromptSurfaceState(state.context?.button, state.context?.promptTarget)
      : null;
    if (live?.modelId === MINIMAX_H3_MODEL_ID) {
      captured = live;
      if (state.context && typeof state.context === "object") {
        state.context = Object.assign({}, state.context, { miniMaxH3: captured });
      }
    }
    if (!captured || captured.modelId !== MINIMAX_H3_MODEL_ID) return null;
    const resources = await hydrateMiniMaxH3ReverseResources(captured);
    captured = Object.freeze(Object.assign({}, captured, { resources }));
    if (state.context && typeof state.context === "object") {
      state.context = Object.assign({}, state.context, { miniMaxH3: captured });
    }
    const workflow = getMiniMaxH3ReverseWorkflow();
    const contentPolicy = miniMaxH3ContentPolicy();
    const prepared = workflow.prepareRequest({
      modelId: captured.modelId,
      mode: captured.mode,
      durationSeconds: captured.durationSeconds,
      prompt: String(prompt || ""),
      requirements: String(requirements || ""),
      contentPolicy,
      resources
    });
    if (!prepared || typeof prepared !== "object" || !prepared.request || typeof prepared.request !== "object") {
      throw new Error("MiniMax H3 参考图反推请求无效");
    }
    const expectedPurpose = captured.mode === "image_video"
      ? MINIMAX_H3_I2V_REVERSE_PURPOSE
      : captured.mode === "first_last"
        ? MINIMAX_H3_FL2V_REVERSE_PURPOSE
        : "";
    if (!expectedPurpose || prepared.request.purpose !== expectedPurpose) {
      throw new Error("MiniMax H3 参考图反推请求类型不匹配");
    }
    if (prepared.request.visualSchema !== MINIMAX_H3_VISUAL_SCHEMA) {
      throw new Error("MiniMax H3 参考图反推视觉合同不匹配");
    }
    if (
      prepared.request.contentPolicy?.sensitiveVisualAnalysis !== contentPolicy.sensitiveVisualAnalysis
      || prepared.request.contentPolicy?.allSubjectsConfirmedAdult !== contentPolicy.allSubjectsConfirmedAdult
    ) {
      throw new Error("MiniMax H3 参考图反推内容策略不匹配");
    }
    return Object.freeze({
      request: prepared.request,
      context: prepared.context && typeof prepared.context === "object" ? prepared.context : prepared,
      workflow
    });
  }

  async function validateMiniMaxH3ReverseResult(text, prepared, textareas, refinement = false) {
    if (!prepared?.workflow || typeof prepared.workflow.validateAndRestore !== "function") {
      throw new Error("MiniMax H3 参考图反推校验模块不可用");
    }
    const current = readMiniMaxH3PromptSurfaceState(state.context?.button, state.context?.promptTarget);
    const resources = await hydrateMiniMaxH3ReverseResources(current);
    const validated = prepared.workflow.validateAndRestore({
      text: String(text || ""),
      // Only the refinement answer (original prompt + requirement) must keep the user's quoted lines.
      refinement,
      context: prepared.context,
      current: {
        modelId: current.modelId,
        mode: current.mode,
        durationSeconds: current.durationSeconds,
        prompt: String(textareas?.positive?.value || ""),
        requirements: String(buildSmartAiRequirements({ includeUserIntent: true }) || ""),
        contentPolicy: miniMaxH3ContentPolicy(),
        resources
      }
    });
    if (!validated || typeof validated !== "object" || validated.ok === false) {
      throw new Error(String(validated?.error || "MiniMax H3 参考图反推结果已过期或结构无效"));
    }
    const restoredText = String(validated.text ?? validated.prompt ?? "").trim();
    if (!restoredText) throw new Error("MiniMax H3 参考图反推未返回可写入内容");
    return restoredText;
  }

  function smartAiReferenceFingerprint(value) {
    const text = String(value || "");
    return `${text.length}:${text.slice(0, 48)}:${text.slice(-48)}`;
  }

  async function compileArtReferencePlan() {
    const roles = state.images.map((_, index) => state.referenceRoles[index] || "subject");
    const compiler = window.NovaFlowArtReferenceCompiler;
    if (!compiler?.compile) {
      return {
        version: "text-only-fallback",
        results: state.images.map((item, index) => ({ index, role: roles[index], sourceUrl: item.imageUrl, compiledUrl: roles[index] === "subject" ? item.imageUrl : "", mode: roles[index] === "subject" ? "image" : "text", status: roles[index] === "subject" ? "ready" : "fallback" })),
        capabilities: { controlNet: false }
      };
    }
    return compiler.compile(state.images, roles, ({ index, total, role }) => {
      state.message = `正在处理参考图 ${index + 1}/${total}（${artReferenceRoleLabel(role)}）...`;
      renderDialog();
    });
  }

  function setSmartAiAttributeIfChanged(element, name, value) {
    if (!(element instanceof HTMLElement)) return;
    const nextValue = String(value);
    if (element.getAttribute(name) !== nextValue) element.setAttribute(name, nextValue);
  }

  function setSmartAiTextIfChanged(element, value) {
    if (!(element instanceof HTMLElement)) return;
    const nextValue = String(value);
    if (element.textContent !== nextValue) element.textContent = nextValue;
  }

  function setSmartAiButtonTypeIfChanged(button) {
    if (!(button instanceof HTMLButtonElement)) return;
    if (button.getAttribute("type") !== "button") button.setAttribute("type", "button");
  }

  function getSmartAiMutationElement(node) {
    const element = node && node.nodeType === 1 ? node : node?.parentElement;
    return element instanceof HTMLElement ? element : null;
  }

  function getBoundSmartAiButtonFromMutationNode(node) {
    const element = getSmartAiMutationElement(node);
    if (!(element instanceof HTMLElement)) return null;
    return element.closest(`[${SMART_BUTTON_ATTR}="1"][data-novaflow-smart-ai-bound="1"]`);
  }

  function isSmartAiSelfMutation(mutation) {
    if (!mutation) return false;
    const button = getBoundSmartAiButtonFromMutationNode(mutation.target);
    if (!(button instanceof HTMLButtonElement)) return false;
    if (mutation.type === "attributes") {
      const attributeName = String(mutation.attributeName || "");
      return (
        attributeName === "type" ||
        attributeName === "class" ||
        attributeName === SMART_BUTTON_ATTR ||
        attributeName === "data-novaflow-smart-ai-button" ||
        attributeName === NOVAFLOW_PROMPT_ACTION_BUTTON_ATTR ||
        attributeName === "data-novaflow-smart-ai-bound"
      );
    }
    if (mutation.type === "characterData") return true;
    if (mutation.type !== "childList") return false;
    const nodes = [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])];
    if (!nodes.length) return true;
    return nodes.every((node) => node?.nodeType === 3 || getBoundSmartAiButtonFromMutationNode(node) === button);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${SMART_BUTTON_ATTR}="1"],
      [${NOVAFLOW_PROMPT_ACTION_BUTTON_ATTR}="1"] {
        height: 22px;
        min-height: 22px;
        max-height: 22px;
        min-width: 58px;
        padding: 0 8px;
        border: 0;
        outline: 0;
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.06);
        color: rgba(248, 250, 252, 0.92);
        font-size: 12px;
        font-weight: 600;
        line-height: 20px;
        white-space: nowrap;
        box-shadow: none;
        cursor: pointer;
      }
      [${SMART_BUTTON_ATTR}="1"]:hover,
      [${NOVAFLOW_PROMPT_ACTION_BUTTON_ATTR}="1"]:hover {
        background: rgba(255, 255, 255, 0.10);
        color: #fff;
      }
      .novaflow-art-generate-assistant-actions > [${NOVAFLOW_PROMPT_ACTION_BUTTON_ATTR}="1"]:not([${SMART_BUTTON_ATTR}="1"]) {
        display: none !important;
      }
      #${ROOT_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483640;
        display: grid;
        place-items: center;
        background: rgba(0, 0, 0, 0.58);
        padding: 18px;
        color: #e8edf2;
        font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
        box-sizing: border-box;
        isolation: isolate;
      }
      .novaflow-smart-ai-dialog {
        position: relative;
        z-index: 1;
        width: min(422px, calc(100vw - 36px));
        max-height: calc(100vh - 36px);
        display: flex;
        flex-direction: column;
        gap: 0;
        border: 1px solid rgba(255, 255, 255, 0.10);
        border-radius: 6px;
        background: #202020;
        box-shadow: 0 22px 60px rgba(0, 0, 0, 0.48);
        overflow: hidden;
        box-sizing: border-box;
      }
      .novaflow-smart-ai-header {
        height: 50px;
        min-height: 50px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 0 8px 0 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.09);
        box-sizing: border-box;
      }
      .novaflow-smart-ai-title {
        font-size: 14px;
        font-weight: 400;
        line-height: 1;
      }
      .novaflow-smart-ai-close {
        width: 40px;
        height: 40px;
        flex: 0 0 40px;
        display: grid;
        place-items: center;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: rgba(255, 255, 255, 0.62);
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
      }
      .novaflow-smart-ai-close:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
      }
      .novaflow-smart-ai-body {
        display: grid;
        gap: 12px;
        padding: 18px 14px 12px;
        overflow-y: auto;
        box-sizing: border-box;
      }
      .novaflow-smart-ai-section {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .novaflow-smart-ai-label {
        color: rgba(229, 231, 235, 0.72);
        font-size: 12px;
        font-weight: 400;
        line-height: 1;
      }
      .novaflow-smart-ai-radio-row,
      .novaflow-smart-ai-targets {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
      }
      .novaflow-smart-ai-radio {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: rgba(232, 237, 242, 0.88);
        font-size: 13px;
        line-height: 20px;
        cursor: pointer;
      }
      .novaflow-smart-ai-radio input {
        accent-color: #23c489;
      }
      .novaflow-smart-ai-mode-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .novaflow-smart-ai-mode-card {
        min-width: 0;
        height: 56px;
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 7px;
        background: rgba(255,255,255,0.045);
        color: rgba(248,250,252,0.86);
        cursor: pointer;
        font-size: 12px;
      }
      .novaflow-smart-ai-mode-card[data-active="1"] {
        border-color: rgba(35,196,137,0.72);
        background: rgba(35,196,137,0.18);
        color: #fff;
      }
      .novaflow-smart-ai-mode-card:disabled {
        opacity: 0.42;
        cursor: not-allowed;
      }
      .novaflow-smart-ai-engine-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .novaflow-smart-ai-engine-option {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 42px;
        padding: 8px 10px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 6px;
        background: rgba(255,255,255,0.035);
        color: rgba(232,237,242,0.88);
        font-size: 12px;
        cursor: pointer;
        box-sizing: border-box;
      }
      .novaflow-smart-ai-engine-option input { accent-color: #23c489; }
      .novaflow-smart-ai-h3-sensitive-panel {
        display: grid;
        gap: 8px;
        padding: 10px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 6px;
        background: rgba(255,255,255,0.025);
      }
      .novaflow-smart-ai-h3-sensitive-option {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        color: rgba(232,237,242,0.88);
        font-size: 12px;
        line-height: 18px;
        cursor: pointer;
      }
      .novaflow-smart-ai-h3-sensitive-option input {
        flex: 0 0 auto;
        margin-top: 2px;
        accent-color: #23c489;
      }
      .novaflow-smart-ai-h3-sensitive-warning {
        color: #efb36d;
        font-size: 11px;
        line-height: 17px;
      }
      .novaflow-smart-ai-preset-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .novaflow-smart-ai-preset {
        min-width: 0;
        height: 36px;
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 6px;
        background: rgba(255,255,255,0.035);
        color: rgba(232,237,242,0.82);
        font-size: 12px;
        cursor: pointer;
      }
      .novaflow-smart-ai-preset[data-active="1"] {
        border-color: rgba(35,196,137,0.72);
        background: rgba(35,196,137,0.16);
        color: #fff;
      }
      .novaflow-smart-ai-chip-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
      }
      .novaflow-smart-ai-chip {
        min-width: 0;
        min-height: 32px;
        padding: 6px 8px;
        border: 1px solid rgba(255,255,255,0.10);
        border-radius: 6px;
        background: rgba(255,255,255,0.035);
        color: rgba(232,237,242,0.78);
        font-size: 11px;
        cursor: pointer;
      }
      .novaflow-smart-ai-chip[data-active="1"] {
        border-color: rgba(35,196,137,0.72);
        background: rgba(35,196,137,0.16);
        color: #fff;
      }
      .novaflow-smart-ai-reference-role-list { display: grid; gap: 6px; }
      .novaflow-smart-ai-reference-role-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 150px;
        align-items: center;
        gap: 8px;
        color: rgba(232,237,242,0.82);
        font-size: 11px;
      }
      .novaflow-smart-ai-reference-role-select {
        width: 100%; height: 32px; border: 1px solid rgba(255,255,255,0.10);
        border-radius: 6px; background: #292929; color: #edf2f7; padding: 0 8px;
      }
      .novaflow-smart-ai-task-summary {
        display: grid;
        gap: 6px;
        padding: 10px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px;
        background: rgba(255,255,255,0.035);
      }
      .novaflow-smart-ai-task-summary-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: rgba(232,237,242,0.76);
        font-size: 11px;
      }
      .novaflow-smart-ai-task-summary-row strong { color: #fff; font-weight: 500; }
      .novaflow-smart-ai-auto-status {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 10px;
        border: 1px solid rgba(35,196,137,0.22);
        border-radius: 8px;
        background: rgba(35,196,137,0.07);
        color: rgba(232,237,242,0.82);
        font-size: 11px;
        line-height: 1.45;
      }
      .novaflow-smart-ai-auto-status::before {
        content: "";
        width: 7px;
        height: 7px;
        flex: 0 0 7px;
        border-radius: 999px;
        background: #23c489;
        box-shadow: 0 0 0 3px rgba(35,196,137,0.10);
      }
      .novaflow-smart-ai-advanced {
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px;
        background: rgba(255,255,255,0.025);
      }
      .novaflow-smart-ai-advanced > summary {
        padding: 9px 10px;
        color: rgba(232,237,242,0.62);
        font-size: 11px;
        cursor: pointer;
        user-select: none;
      }
      .novaflow-smart-ai-advanced-body {
        display: grid;
        gap: 10px;
        padding: 0 10px 10px;
      }
      .novaflow-smart-ai-advanced-field {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 150px;
        align-items: center;
        gap: 8px;
        color: rgba(232,237,242,0.76);
        font-size: 11px;
      }
      .novaflow-smart-ai-advanced-select {
        width: 100%; height: 32px; border: 1px solid rgba(255,255,255,0.10);
        border-radius: 6px; background: #292929; color: #edf2f7; padding: 0 8px;
      }
      .novaflow-smart-ai-advanced-toggle {
        border: 0;
        padding: 0;
        background: transparent;
        color: rgba(35,196,137,0.92);
        font-size: 12px;
        text-align: left;
        cursor: pointer;
      }
      .novaflow-smart-ai-engine-meta {
        display: block;
        margin-top: 2px;
        color: rgba(232,237,242,0.46);
        font-size: 10px;
      }
      .novaflow-smart-ai-textarea {
        width: 100%;
        height: 118px;
        min-height: 92px;
        max-height: 160px;
        resize: vertical;
        padding: 10px 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        background: #050505;
        color: #edf2f7;
        font-size: 12px;
        line-height: 1.45;
        outline: none;
        box-sizing: border-box;
      }
      .novaflow-smart-ai-textarea:focus {
        border-color: rgba(35, 196, 137, 0.46);
      }
      .novaflow-smart-ai-message {
        display: none;
        margin: 0 14px 8px;
        min-height: 17px;
        padding: 8px 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.035);
        color: rgba(160, 160, 160, 0.96);
        font-size: 11px;
        line-height: 17px;
        text-align: left;
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
      .novaflow-smart-ai-message[data-visible="1"] {
        display: block;
      }
      .novaflow-smart-ai-message[data-tone="warning"] {
        border-color: rgba(245, 158, 11, 0.34);
        background: rgba(245, 158, 11, 0.10);
        color: rgba(253, 186, 116, 0.98);
      }
      .novaflow-smart-ai-message[data-tone="error"] {
        border-color: rgba(248, 113, 113, 0.42);
        background: rgba(127, 29, 29, 0.18);
        color: rgba(254, 202, 202, 0.98);
      }
      .novaflow-smart-ai-result {
        display: grid;
        gap: 8px;
      }
      .novaflow-smart-ai-result section {
        display: grid;
        gap: 7px;
        padding: 10px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 7px;
        background: rgba(255,255,255,0.025);
      }
      .novaflow-smart-ai-result-title {
        color: rgba(248,250,252,0.92);
        font-size: 12px;
        font-weight: 600;
      }
      .novaflow-smart-ai-result-copy {
        color: rgba(230,230,230,0.74);
        font-size: 11px;
        line-height: 1.55;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .novaflow-smart-ai-result-safety {
        display: grid;
        gap: 4px;
      }
      .novaflow-smart-ai-result-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        color: rgba(208,208,208,0.68);
        font-size: 11px;
        line-height: 1.45;
      }
      .novaflow-smart-ai-result-row strong {
        color: rgba(248,250,252,0.88);
        font-weight: 500;
        text-align: right;
      }
      .novaflow-smart-ai-result-warnings {
        display: grid;
        gap: 4px;
        padding: 8px;
        border: 1px solid rgba(248,113,113,0.28);
        border-radius: 6px;
        background: rgba(127,29,29,0.18);
        color: rgba(254,202,202,0.96);
        font-size: 11px;
        line-height: 1.5;
      }
      .novaflow-smart-ai-result-muted {
        color: rgba(160,160,160,0.72);
        font-size: 11px;
        line-height: 1.45;
      }
      .novaflow-smart-ai-result-details summary {
        color: rgba(35,196,137,0.92);
        font-size: 11px;
        cursor: pointer;
      }
      .novaflow-smart-ai-result-details[open] summary {
        margin-bottom: 7px;
      }
      .novaflow-smart-ai-footer {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        padding: 0 14px 14px;
        box-sizing: border-box;
      }
      .novaflow-smart-ai-footer[data-single="1"] {
        grid-template-columns: minmax(0, 1fr);
      }
      .novaflow-smart-ai-submit {
        width: 100%;
        min-width: 0;
        height: 44px;
        padding: 0 16px;
        border: 0;
        border-radius: 6px;
        background: #1f7a58;
        color: #fff;
        font-size: 13px;
        font-weight: 400;
        line-height: 1;
        cursor: pointer;
      }
      .novaflow-smart-ai-submit:hover {
        background: #20b886;
      }
      .novaflow-smart-ai-submit:disabled {
        cursor: not-allowed;
        opacity: 0.62;
      }
      .novaflow-smart-ai-context-note {
        color: rgba(232, 237, 242, 0.56);
        font-size: 12px;
        line-height: 18px;
      }
    `;
    document.head?.appendChild(style);
  }

  function readSessionToken() {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return String(parsed?.session?.token || "").trim();
    } catch {
      return "";
    }
  }

  function isPromptTextControl(element) {
    return element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement;
  }

  function findTextarea(root, selector) {
    const textarea = root?.querySelector?.(selector);
    return isPromptTextControl(textarea) ? textarea : null;
  }

  function isSmartAiVisibleElement(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle?.(element);
    return !style || (style.display !== "none" && style.visibility !== "hidden");
  }

  function findVisibleTextareaBySelector(root, selector) {
    const matches = Array.from(root?.querySelectorAll?.(selector) || [])
      .filter((node) => isPromptTextControl(node) && node.isConnected);
    return matches.find(isSmartAiVisibleElement) || matches[0] || null;
  }

  function findVisibleSmartAiButton(surface) {
    const actionsSelector = surface === "art" ? ART_ACTIONS_SELECTOR : ANIMATION_ACTIONS_SELECTOR;
    const buttons = Array.from(document.querySelectorAll(`${actionsSelector} [${SMART_BUTTON_ATTR}="1"]`))
      .filter((node) => node instanceof HTMLButtonElement);
    return buttons.find(isSmartAiVisibleElement) || buttons[0] || null;
  }

  function getContextButton(context) {
    const button = context?.button instanceof HTMLElement ? context.button : null;
    if (button?.isConnected && isSmartAiVisibleElement(button)) return button;
    return findVisibleSmartAiButton(context?.surface || "animation");
  }

  function addUniqueElement(list, element) {
    if (element instanceof HTMLElement && element.isConnected && !list.includes(element)) list.push(element);
  }

  function textareasFromAnimationScope(scope) {
    const positive = findVisibleTextareaBySelector(scope, ANIMATION_POSITIVE_TEXTAREA_SELECTOR);
    const negative = findVisibleTextareaBySelector(scope, ANIMATION_NEGATIVE_TEXTAREA_SELECTOR);
    if (isPromptTextControl(positive)) return { positive, negative };
    const textareas = Array.from(scope?.querySelectorAll?.('textarea, input[data-novaflow-ai-prompt-kind]') || [])
      .filter((node) => isPromptTextControl(node) && node.isConnected);
    const visibleTextareas = textareas.filter(isSmartAiVisibleElement);
    const ordered = visibleTextareas.length ? visibleTextareas : textareas;
    return {
      positive: ordered[0] || null,
      negative: ordered[1] || negative || null
    };
  }

  function getAnimationPromptFrame(button) {
    const positiveFrame = button?.closest?.('[data-novaflow-ai-prompt-kind="positive"]');
    if (positiveFrame instanceof HTMLElement) return positiveFrame;
    const promptFrame = button?.closest?.('[data-novaflow-ai-prompt-frame="1"]');
    return promptFrame instanceof HTMLElement && promptFrame.getAttribute("data-novaflow-ai-prompt-kind") !== "negative"
      ? promptFrame
      : null;
  }

  function textareasFromExactAnimationTarget(button) {
    const frame = getAnimationPromptFrame(button);
    if (!(frame instanceof HTMLElement)) return { frame: null, workspace: null, positive: null, negative: null };
    const workspace = frame.closest('[data-novaflow-ai-bottom-workspace="1"]') ||
      button?.closest?.('[data-novaflow-ai-bottom-workspace="1"]');
    const frameTextareas = textareasFromAnimationScope(frame);
    const workspaceTextareas = workspace instanceof HTMLElement
      ? textareasFromAnimationScope(workspace)
      : { positive: null, negative: null };
    return {
      frame,
      workspace: workspace instanceof HTMLElement ? workspace : null,
      positive: frameTextareas.positive,
      negative: frameTextareas.negative || workspaceTextareas.negative
    };
  }

  function findAnimationPromptTextareas(button) {
    const exactTarget = textareasFromExactAnimationTarget(button);
    if (isPromptTextControl(exactTarget.positive)) {
      return { positive: exactTarget.positive, negative: exactTarget.negative };
    }
    const scopes = [];
    const promptFrame = getAnimationPromptFrame(button);
    const directWorkspace = button?.closest?.('[data-novaflow-ai-bottom-workspace="1"]');
    if (promptFrame?.getAttribute?.("data-novaflow-ai-prompt-kind") !== "negative") {
      addUniqueElement(scopes, promptFrame);
    }
    addUniqueElement(scopes, directWorkspace);
    addUniqueElement(scopes, promptFrame?.closest?.('[data-novaflow-ai-bottom-workspace="1"]'));
    Array.from(document.querySelectorAll('[data-novaflow-ai-bottom-workspace="1"]'))
      .filter(isSmartAiVisibleElement)
      .forEach((workspace) => addUniqueElement(scopes, workspace));
    Array.from(document.querySelectorAll('[data-novaflow-ai-bottom-workspace="1"]'))
      .forEach((workspace) => addUniqueElement(scopes, workspace));
    for (const scope of scopes) {
      const textareas = textareasFromAnimationScope(scope);
      if (isPromptTextControl(textareas.positive)) return textareas;
    }
    return { positive: null, negative: null };
  }

  function captureAnimationPromptTarget(button) {
    const exactTarget = textareasFromExactAnimationTarget(button);
    if (isPromptTextControl(exactTarget.positive) || exactTarget.frame instanceof HTMLElement) return exactTarget;
    const fallbackTextareas = findAnimationPromptTextareas(button);
    if (!isPromptTextControl(fallbackTextareas.positive)) return null;
    return { ...exactTarget, ...fallbackTextareas };
  }

  function getCapturedAnimationPromptTextareas(context) {
    const target = context?.promptTarget;
    if (!target) return null;
    if (isPromptTextControl(target.positive) && target.positive.isConnected) {
      const workspaceTextareas = target.workspace instanceof HTMLElement && target.workspace.isConnected
        ? textareasFromAnimationScope(target.workspace)
        : { negative: null };
      return {
        positive: target.positive,
        negative: isPromptTextControl(target.negative) && target.negative.isConnected
          ? target.negative
          : workspaceTextareas.negative || null
      };
    }
    if (target.frame instanceof HTMLElement && target.frame.isConnected) {
      const frameTextareas = textareasFromAnimationScope(target.frame);
      const workspaceTextareas = target.workspace instanceof HTMLElement && target.workspace.isConnected
        ? textareasFromAnimationScope(target.workspace)
        : { negative: null };
      if (isPromptTextControl(frameTextareas.positive)) {
        return {
          positive: frameTextareas.positive,
          negative: frameTextareas.negative || workspaceTextareas.negative || null
        };
      }
    }
    return { positive: null, negative: null };
  }

  function getPromptTextareasFromContext(context) {
    if (context?.surface === "art") {
      const contextButton = context?.button;
      const connectedWorkspace = contextButton?.isConnected
        ? contextButton.closest?.("#novaflow-art-generate-workspace")
        : null;
      const workspace = connectedWorkspace || document.getElementById("novaflow-art-generate-workspace");
      const positiveFrame = workspace?.querySelector?.('[data-novaflow-art-generate-prompt-kind="positive"]');
      const negativeFrame = workspace?.querySelector?.('[data-novaflow-art-generate-prompt-kind="negative"]');
      return {
        positive: findTextarea(positiveFrame, "textarea"),
        negative: findTextarea(negativeFrame, "textarea")
      };
    }
    if (context?.surface === "animation" && context?.promptTarget) {
      return getCapturedAnimationPromptTextareas(context);
    }
    const button = getContextButton(context);
    if (!button) return { positive: null, negative: null };
    return findAnimationPromptTextareas(button);
  }

  function getTextareaFromContext(context) {
    return getPromptTextareasFromContext(context).positive;
  }

  function setTextareaValue(textarea, value) {
    if (!isPromptTextControl(textarea) || !textarea.isConnected) return false;
    const proto = textarea instanceof HTMLInputElement ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (typeof setter === "function") setter.call(textarea, value);
    else textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      textarea.focus({ preventScroll: true });
    } catch {
      textarea.focus();
    }
    return true;
  }

  function closeSmartAiPromptEditor(root) {
    if (root instanceof HTMLElement && root.parentElement) root.parentElement.removeChild(root);
  }

  function openSmartAiPromptEditor(control, titleText = "提示词") {
    if (!isPromptTextControl(control) || !document.body) return false;
    const existing = document.querySelector('[data-novaflow-smart-ai-prompt-editor="1"]');
    if (existing instanceof HTMLElement) closeSmartAiPromptEditor(existing);
    const root = document.createElement("div");
    root.setAttribute("data-novaflow-smart-ai-prompt-editor", "1");
    const dialog = document.createElement("div");
    const header = document.createElement("div");
    const title = document.createElement("div");
    const closeButton = document.createElement("button");
    const textarea = document.createElement("textarea");
    const footer = document.createElement("div");
    const confirmButton = document.createElement("button");
    closeButton.type = "button";
    confirmButton.type = "button";
    title.textContent = titleText;
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "关闭");
    textarea.spellcheck = false;
    textarea.value = String(control.value || "");
    confirmButton.textContent = "确认编辑";
    header.append(title, closeButton);
    footer.appendChild(confirmButton);
    dialog.append(header, textarea, footer);
    root.appendChild(dialog);
    document.body.appendChild(root);
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      background: "rgba(0, 0, 0, 0.62)",
      zIndex: "2147483646",
      boxSizing: "border-box"
    });
    Object.assign(dialog.style, {
      display: "flex",
      flexDirection: "column",
      width: "min(920px, calc(100vw - 48px))",
      height: "min(680px, calc(100vh - 64px))",
      background: "#1f1f1f",
      border: "1px solid rgba(255, 255, 255, 0.14)",
      borderRadius: "8px",
      boxShadow: "0 24px 80px rgba(0, 0, 0, 0.55)",
      overflow: "hidden",
      color: "#f8fafc",
      boxSizing: "border-box"
    });
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: "48px",
      minHeight: "48px",
      padding: "0 16px 0 18px",
      borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
      boxSizing: "border-box"
    });
    Object.assign(title.style, {
      fontSize: "14px",
      fontWeight: "600",
      color: "#f8fafc",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    });
    Object.assign(closeButton.style, {
      width: "32px",
      height: "32px",
      minWidth: "32px",
      padding: "0",
      border: "0",
      borderRadius: "6px",
      background: "transparent",
      color: "rgba(248, 250, 252, 0.72)",
      fontSize: "22px",
      lineHeight: "30px",
      cursor: "pointer"
    });
    Object.assign(textarea.style, {
      flex: "1 1 auto",
      width: "100%",
      minHeight: "0",
      padding: "16px 18px",
      border: "0",
      outline: "0",
      resize: "none",
      background: "#050505",
      color: "#f8fafc",
      fontSize: "14px",
      lineHeight: "1.6",
      fontFamily: "Consolas, 'Microsoft YaHei UI', monospace",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
      overflowY: "auto",
      boxSizing: "border-box"
    });
    Object.assign(footer.style, {
      display: "flex",
      justifyContent: "flex-end",
      alignItems: "center",
      height: "58px",
      minHeight: "58px",
      padding: "10px 16px",
      borderTop: "1px solid rgba(255, 255, 255, 0.1)",
      boxSizing: "border-box"
    });
    Object.assign(confirmButton.style, {
      height: "36px",
      minWidth: "112px",
      padding: "0 18px",
      border: "0",
      borderRadius: "7px",
      background: "#218b66",
      color: "#ffffff",
      fontSize: "13px",
      fontWeight: "600",
      cursor: "pointer"
    });
    // The editor edits the same prompt as the inline field, so it gets the same @ mention surface.
    const promptEditorBridge = window.__NovaFlowPromptEditor;
    let mentionHandle = null;
    if (promptEditorBridge && typeof promptEditorBridge.mountMentionForControl === "function") {
      try { mentionHandle = promptEditorBridge.mountMentionForControl(control, textarea) || null; } catch { mentionHandle = null; }
    }
    const close = () => {
      if (mentionHandle && typeof mentionHandle.unmount === "function") {
        try { mentionHandle.unmount(); } catch { void 0; }
      }
      closeSmartAiPromptEditor(root);
    };
    closeButton.addEventListener("click", close);
    root.addEventListener("mousedown", (event) => {
      if (event.target === root) close();
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    confirmButton.addEventListener("click", () => {
      setTextareaValue(control, textarea.value);
      close();
    });
    window.setTimeout(() => {
      // Park the caret after the text: at 0 a leading @ mention would be split by the first keystroke.
      if (mentionHandle && typeof mentionHandle.focus === "function" && mentionHandle.focus({ caret: "end" })) return;
      const editor = mentionHandle && mentionHandle.editor;
      if (editor instanceof HTMLElement && editor.isConnected) editor.focus();
      else textarea.focus();
    }, 0);
    return true;
  }

  function smartAiWriteError(message) {
    const err = new Error(message || "写入提示词失败");
    err.code = "write_prompt_failed";
    return err;
  }

  function smartAiResourceMentionError(message) {
    const err = new Error(message || "资源引用保护失败，请重试");
    err.code = "resource_mention_protection_failed";
    return err;
  }

  function protectSmartAiResourceMentions(text) {
    const originalText = String(text || "");
    const tool = window.NovaFlowResourceMentionTool;
    if (!tool || typeof tool.protectText !== "function") {
      if (/@(?:参考图[1-4]|视频参考|声音参考)/.test(originalText)) {
        throw smartAiResourceMentionError("资源引用组件不可用，请刷新页面后重试");
      }
      return { text: originalText, originalText, tokens: [] };
    }
    const protection = tool.protectText(originalText);
    const tokens = Array.isArray(protection?.tokens) ? protection.tokens : [];
    if (/@(?:参考图[1-4]|视频参考|声音参考)/.test(originalText) && !tokens.length) {
      throw smartAiResourceMentionError("资源引用未能安全保护，请重试");
    }
    return {
      ...(protection && typeof protection === "object" ? protection : {}),
      text: String(protection?.text ?? originalText),
      originalText,
      tokens
    };
  }

  function restoreSmartAiResourceMentions(text, protection) {
    const nextText = String(text || "");
    const originalText = String(protection?.originalText || "");
    const tokens = Array.isArray(protection?.tokens) ? protection.tokens : [];
    if (!tokens.length) return { ok: true, text: nextText };
    const placeholders = new Set();
    for (const token of tokens) {
      const placeholder = String(token?.placeholder || "");
      if (!placeholder || placeholders.has(placeholder) || nextText.split(placeholder).length !== 2) {
        return { ok: false, text: originalText, error: "AI 返回内容中的资源引用已损坏" };
      }
      placeholders.add(placeholder);
    }
    const tool = window.NovaFlowResourceMentionTool;
    if (!tool || typeof tool.restoreText !== "function") {
      return { ok: false, text: originalText, error: "资源引用组件不可用" };
    }
    const restored = tool.restoreText(nextText, protection);
    if (!restored?.ok) {
      return {
        ok: false,
        text: originalText,
        error: String(restored?.error || "AI 返回内容中的资源引用已损坏")
      };
    }
    return { ok: true, text: String(restored.text ?? "") };
  }

  const SMART_AI_PROMPT_PRESERVATION_STOPWORDS = new Set([
    "一个", "一种", "这个", "这些", "其中", "以及", "同时", "整体", "画面", "采用", "具有", "进行",
    "自然", "明确", "保持", "要求", "必须", "需要", "使用", "可以", "不能", "并且", "然后", "作为",
    "通过", "形成", "位于", "受到", "拥有", "the", "and", "with", "from", "into", "that", "this",
    "for", "are", "is", "of", "to", "in", "on", "as", "be", "or", "must", "should"
  ]);

  function normalizeSmartAiPromptPreservationText(value, compact = false) {
    const source = String(value || "");
    const normalized = typeof source.normalize === "function" ? source.normalize("NFKC") : source;
    const lowered = normalized.toLowerCase().replace(/[\u200b-\u200d\ufeff]/g, " ");
    return compact
      ? lowered.replace(/[^\p{L}\p{N}]+/gu, "")
      : lowered.replace(/\s+/g, " ").trim();
  }

  function smartAiPromptPreservationTokens(value) {
    const source = normalizeSmartAiPromptPreservationText(value);
    if (!source) return [];
    const tokens = [];
    try {
      const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
      for (const segment of segmenter.segment(source)) {
        if (segment?.isWordLike !== true) continue;
        const token = String(segment.segment || "").trim();
        if (token) tokens.push(token);
      }
    } catch {
      const fallbackParts = source.match(/[\p{Script=Han}]+|[a-z0-9][a-z0-9._+-]*/gu) || [];
      for (const part of fallbackParts) {
        tokens.push(part);
        if (/^[\p{Script=Han}]+$/u.test(part) && part.length > 2) {
          for (let index = 0; index < part.length - 1; index += 1) tokens.push(part.slice(index, index + 2));
        }
      }
    }
    tokens.push(...(source.match(/\d+(?:\.\d+)?(?:岁|位|人|只|张|条|列|行)?/gu) || []));
    return Array.from(new Set(tokens.map((token) => normalizeSmartAiPromptPreservationText(token, true)).filter((token) => {
      if (!token || SMART_AI_PROMPT_PRESERVATION_STOPWORDS.has(token)) return false;
      if (/^\d/u.test(token)) return true;
      if (/^[a-z]/u.test(token)) return token.length >= 2;
      return token.length >= 2;
    })));
  }

  function smartAiPromptInstructionAllowsUnchanged(value) {
    const source = String(value || "");
    const changeText = source.replace(
      /(?:但|并且|同时|，|,|；|;)?\s*(?:保留|保持|维持|不要改(?:动)?|不改(?:动)?|其余|其他)[^，,；;。！？!?\n]*/giu,
      ""
    ).trim();
    if (!normalizeSmartAiPromptPreservationText(changeText, true)) return true;
    const instruction = normalizeSmartAiPromptPreservationText(source)
      .replace(/[\s，,。；;！？!?]+/gu, "");
    if (!instruction) return true;
    return [
      /^(?:无需|不需要|不用|不必)(?:做|进行)?(?:任何)?(?:修改|调整|改动|优化)$/u,
      /^(?:保持|维持)(?:原样|原文|不变|现状)$/u,
      /^(?:原样|全部)?保留(?:即可)?$/u,
      /^(?:nochanges?|keepunchanged|leaveunchanged|keepasis)$/i
    ].some((pattern) => pattern.test(instruction));
  }

  function smartAiPromptPreservationBlocks(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\n(?=\s*(?:\*\*)?[^：:\n]{1,18}[：:])/gu, "\n\n")
      .split(/\n\s*\n+/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => {
        const visible = text.replace(/^\s*(?:[-*#>]+\s*)+/, "").replace(/\*\*/g, "").trim();
        const labelMatch = visible.match(/^([^：:\n]{1,18})[：:]/u);
        return {
          text,
          label: String(labelMatch?.[1] || "").trim(),
          tokens: smartAiPromptPreservationTokens(text)
        };
      });
  }

  function smartAiExplicitPromptRemovalTargets(value) {
    const source = String(value || "");
    const targets = [];
    const patterns = [
      /(?:删除|移除|去掉|去除|删掉|取消|剔除)\s*(?:原(?:有|来)?(?:提示词)?(?:中|里的?)?|其中|对应的?)?\s*([^，。；;！？!?\n]+)/gu,
      /\b(?:remove|delete|omit|drop)\s+(?:the\s+)?([^,.;!?\n]+)/gi
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const target = String(match?.[1] || "").split(/(?:并且|并|但|同时|然后|\band\b|\bbut\b)/i)[0].trim();
        if (target) targets.push(target);
      }
    }
    return targets;
  }

  function smartAiPromptBlockExplicitlyRemoved(block, targets) {
    const labelCompact = normalizeSmartAiPromptPreservationText(block?.label, true);
    if (labelCompact.length < 2) return false;
    const wholeBlockNames = new Set([
      labelCompact,
      ...["项", "段", "部分", "内容", "块", "章节"]
        .map((suffix) => `${labelCompact}${suffix}`)
    ]);
    return targets.some((target) => {
      const targetCompact = normalizeSmartAiPromptPreservationText(target, true)
        .replace(/^(?:整个|全部|原有|原来|原本)+/u, "");
      return wholeBlockNames.has(targetCompact);
    });
  }

  function smartAiPromptAnchorCoverage(expectedTokens, candidateTokens) {
    if (!expectedTokens.length) return 1;
    const candidateSet = new Set(candidateTokens);
    return expectedTokens.filter((token) => candidateSet.has(token)).length / expectedTokens.length;
  }

  function isSmartAiPromptPreservationPriorityLabel(value) {
    return /要求|避免|禁止|约束|目标|规则|限制|必需|不得|require|avoid|constraint|target|rule|restriction|prohibit|goal/i.test(String(value || ""));
  }

  function smartAiPromptBlockTargetedByInstruction(block, userInstruction) {
    if (!block?.label || isSmartAiPromptPreservationPriorityLabel(block.label)) return false;
    const instructionCompact = normalizeSmartAiPromptPreservationText(userInstruction, true);
    if (!instructionCompact) return false;
    const labelCompact = normalizeSmartAiPromptPreservationText(block.label, true);
    if (labelCompact.length >= 2 && instructionCompact.includes(labelCompact)) return true;
    const instructionTokens = new Set(smartAiPromptPreservationTokens(userInstruction));
    return (Array.isArray(block.tokens) ? block.tokens : []).some((token) => instructionTokens.has(token));
  }

  function smartAiPromptCandidateIsModelOperationInstruction(value) {
    const firstLine = String(value || "").trim().split(/\r?\n/, 1)[0].trim();
    if (!firstLine) return false;
    return /^(?:优化建议|修改建议|调整建议|以下是(?:修改|优化|调整)|(?:需要|应该|应当|建议)(?:将|把|对|修改|调整|降低|提高|增加|删除|优化)|请(?:修改|调整|降低|提高|增加|删除|优化)|(?:把|将).{1,80}(?:改为|改成|替换为|调整为|设置为))/u.test(firstLine);
  }

  function readSmartAiStructuredPromptStringValue(value) {
    const source = String(value || "").trim();
    if (!source || !source.startsWith('"') || !source.endsWith('"')) return null;
    try {
      const parsed = JSON.parse(source);
      return typeof parsed === "string" && parsed.trim() ? parsed : null;
    } catch {
      return null;
    }
  }

  function smartAiStructuredPromptSemanticValue(sectionEntries, section, key) {
    const rawValue = sectionEntries.get(section)?.get(key);
    return readSmartAiStructuredPromptStringValue(rawValue);
  }

  function smartAiStructuredPromptHasSlotMeaning(
    value,
    chineseTerms,
    englishPattern,
    ignoredPhrases = [],
    genericValues = []
  ) {
    let source = String(value || "").normalize("NFKC").trim();
    for (const phrase of ignoredPhrases) {
      const escapedPhrase = String(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      source = source.replace(new RegExp(escapedPhrase, "giu"), " ");
    }
    const compact = source.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
    if (genericValues.some((item) => compact === String(item).replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase())) {
      return false;
    }
    if (chineseTerms.some((term) => source.includes(term))) return true;
    return englishPattern.test(source);
  }

  function validateSmartAiStructuredArtPromptSlotSemantics(sectionEntries) {
    const style = "\u98ce\u683c\u8bbe\u5b9a";
    const camera = "\u62cd\u6444\u53c2\u6570";
    const checks = [
      {
        section: `[${style}]`,
        key: "\u5a92\u4ecb",
        chinese: ["\u6570\u5b57\u7ed8\u753b", "\u6570\u5b57\u63d2\u753b", "\u539a\u6d82", "\u63d2\u753b", "\u6c34\u5f69", "\u6cb9\u753b", "\u7d20\u63cf", "\u7248\u753b", "\u6444\u5f71", "\u80f6\u7247", "\u50cf\u7d20\u753b", "\u4e09\u7ef4", "\u624b\u7ed8"],
        english: /\b(?:digital\s+(?:painting|illustration|art)|oil\s+painting|watercolou?r|gouache|photograph\w*|film|pixel\s+art|3d(?:\s+(?:render|art))?|illustration|cg)\b/iu,
        generic: ["art", "image", "\u7ed8\u753b", "\u827a\u672f"]
      },
      {
        section: `[${style}]`,
        key: "\u7ed8\u753b\u8bed\u8a00",
        chinese: ["\u539a\u6d82", "\u534a\u5199\u5b9e", "\u5199\u5b9e", "\u4e8c\u6b21\u5143", "\u52a8\u6f2b", "\u8d5b\u7490\u7490", "\u7b14\u89e6", "\u7ebf\u6761", "\u6e32\u67d3", "\u9020\u578b", "\u8bbe\u8ba1", "\u6027\u611f", "\u4f53\u79ef\u5851\u9020", "\u660e\u6697\u5851\u9020", "\u6e38\u620fCG", "\u89d2\u8272\u539f\u753b"],
        english: /\b(?:painterly|semi[-\s]*realistic|photorealistic|anime|manga|cel[-\s]*shad(?:ed|ing)|brushwork|linework|render(?:ed|ing)?|painting|character\s+design|styling|sensual|game\s+cg|concept\s+art|splash\s+art)\b/iu,
        ignored: [
          "\u4eba\u7269\u9020\u578b\u6027\u611f\u4e14\u6210\u5e74\u6bd4\u4f8b\u660e\u786e",
          "character design is sensual with clearly adult proportions"
        ],
        generic: ["chinese", "english", "japanese", "\u4e2d\u6587", "\u82f1\u6587", "\u65e5\u6587", "\u4e2d\u56fd", "\u4e1c\u65b9", "style"]
      },
      {
        section: `[${style}]`,
        key: "\u6c1b\u56f4",
        chinese: ["\u6c1b\u56f4", "\u6c14\u6c1b", "\u610f\u5883", "\u60c5\u7eea", "\u8c03\u6027", "\u5ba1\u7f8e", "\u6d6a\u6f2b", "\u4eb2\u5bc6", "\u6210\u719f", "\u6027\u611f", "\u6210\u4eba\u5411", "\u6e29\u6696", "\u6696\u8272", "\u51b7\u5cfb", "\u795e\u79d8", "\u53f2\u8bd7", "\u5b81\u9759", "\u68a6\u5e7b", "\u6e05\u900f"],
        english: /\b(?:romantic|intimate|mature|sensual|adult[-\s]*oriented|warm|cool|mood|atmosphere|ambience|ambiance|tone|aesthetic|dreamlike|epic)\b/iu,
        ignored: [
          "\u504f\u6210\u4eba\u5411\u7684\u6210\u719f\u5ba1\u7f8e\u6c1b\u56f4",
          "mature adult-oriented aesthetic atmosphere"
        ],
        generic: ["mood", "atmosphere", "tone", "\u6c1b\u56f4", "\u6c14\u6c1b", "\u8c03\u6027"]
      },
      {
        section: `[${style}]`,
        key: "\u5b8c\u6210\u8d28\u611f",
        chinese: ["\u8d28\u611f", "\u7ec6\u8282", "\u9ad8\u5149", "\u9634\u5f71", "\u8fc7\u6e21", "\u7eb9\u7406", "\u5b8c\u6210\u5ea6", "\u7cbe\u5ea6", "\u6e05\u6670", "\u9510\u5229", "\u67d4\u6da6", "\u53cd\u5149", "\u5c42\u6b21", "\u6750\u8d28", "\u5149\u6cfd", "\u76ae\u80a4", "\u5e03\u6599", "\u91d1\u5c5e", "\u9897\u7c92", "\u53cd\u5c04", "\u901a\u900f"],
        english: /\b(?:material|detail|texture|highlight|shadow|transition|polish|finish|resolution|layer|surface|reflection|gloss|skin|fabric|metal|grain|translucen)\w*\b/iu,
        ignored: [
          "\u753b\u9762\u8d28\u611f\u7ec6\u817b\u4e30\u5bcc",
          "image quality is refined with rich material detail"
        ],
        generic: ["high", "highquality", "quality", "detailed", "refined", "\u9ad8", "\u9ad8\u7ea7", "\u9ad8\u6e05", "\u9ad8\u8d28\u91cf"]
      },
      {
        section: `[${camera}]`,
        key: "\u666f\u522b",
        chinese: ["\u666f\u522b", "\u7279\u5199", "\u8fd1\u666f", "\u4e2d\u666f", "\u8fdc\u666f", "\u5168\u666f", "\u5168\u8eab", "\u534a\u8eab", "\u80f8\u50cf", "\u5934\u50cf", "\u4ea7\u54c1"],
        english: /\b(?:close[-\s]*up|medium\s+shot|wide\s+shot|long\s+shot|full[-\s]*body|half[-\s]*body|bust\s+shot|headshot|product\s+shot)\b/iu,
        generic: ["shot", "view", "\u955c\u5934", "\u753b\u9762"]
      },
      {
        section: `[${camera}]`,
        key: "\u89c6\u89d2",
        chinese: ["\u89c6\u89d2", "\u4fef\u89c6", "\u4ef0\u89c6", "\u5e73\u89c6", "\u4fa7\u89c6", "\u6b63\u9762", "\u80cc\u9762", "\u9e1f\u77b0", "\u4f4e\u89d2\u5ea6", "\u9ad8\u89d2\u5ea6"],
        english: /\b(?:eye[-\s]*level|high[-\s]*angle|low[-\s]*angle|top[-\s]*down|bird'?s[-\s]*eye|front\s+view|side\s+view|rear\s+view)\b/iu,
        generic: ["angle", "view", "\u89d2\u5ea6", "\u89c6\u89d2"]
      },
      {
        section: `[${camera}]`,
        key: "\u6784\u56fe",
        chinese: ["\u6784\u56fe", "\u5e03\u5c40", "\u89c6\u89c9\u4e2d\u5fc3", "\u89c6\u89c9\u7126\u70b9", "\u52a8\u7ebf", "\u4e09\u89d2", "\u5bf9\u79f0", "\u5c45\u4e2d", "\u5bf9\u89d2\u7ebf", "\u7559\u767d", "\u4e09\u5206", "\u5f15\u5bfc\u7ebf", "\u7126\u70b9", "\u524d\u666f", "\u4e2d\u666f", "\u540e\u666f"],
        english: /\b(?:composition|layout|cent(?:er|red)|rule\s+of\s+thirds|symmetr|triangular|diagonal|leading\s+line|visual\s+flow|negative\s+space|focal\s+point|foreground|midground|background)\w*\b/iu,
        generic: ["composition", "layout", "\u6784\u56fe", "\u5e03\u5c40"]
      },
      {
        section: `[${camera}]`,
        key: "\u900f\u89c6",
        chinese: ["\u900f\u89c6", "\u7126\u6bb5", "\u955c\u5934", "\u7578\u53d8", "\u5e7f\u89d2", "\u957f\u7126", "\u6807\u51c6", "\u6b63\u4ea4", "\u6d88\u5931\u70b9", "\u7a7a\u95f4\u7eb5\u6df1", "\u7a7a\u95f4\u6df1\u5ea6", "\u6bd4\u4f8b", "\u8fd1\u5927\u8fdc\u5c0f"],
        english: /\b(?:perspective|vanishing\s+point|spatial\s+depth|proportion|distortion|wide[-\s]?angle|telephoto|foreshorten|focal\s+length|lens|orthographic|standard\s+view)\w*\b/iu,
        generic: ["intimate", "romantic", "soft", "\u4eb2\u5bc6", "\u6d6a\u6f2b", "\u67d4\u548c", "\u81ea\u7136"]
      },
      {
        section: `[${camera}]`,
        key: "\u666f\u6df1",
        chinese: ["\u666f\u6df1", "\u7126\u70b9", "\u5bf9\u7126", "\u7126\u5916", "\u865a\u5316", "\u6563\u666f", "\u6e05\u6670", "\u9510\u5229", "\u6d45\u7126", "\u6df1\u7126", "\u524d\u666f", "\u4e2d\u666f", "\u80cc\u666f"],
        english: /\b(?:depth\s+of\s+field|focus(?:ed)?|focal\s+plane|bokeh|blur(?:red)?|sharp(?:ness)?|shallow\s+focus|deep\s+focus|foreground|background)\b/iu,
        generic: ["soft", "smooth", "clear", "\u67d4\u548c", "\u6e05\u6670", "\u81ea\u7136"]
      }
    ];
    for (const check of checks) {
      const value = smartAiStructuredPromptSemanticValue(sectionEntries, check.section, check.key);
      if (!smartAiStructuredPromptHasSlotMeaning(
        value,
        check.chinese,
        check.english,
        check.ignored || [],
        check.generic || []
      )) {
        return { ok: false, code: "semantic_slot_mismatch", section: check.section, key: check.key, line: 0 };
      }
    }
    return { ok: true, code: "semantic_slots", section: "", line: 0 };
  }

  function smartAiStructuredPromptValueIsMetaInstruction(value) {
    const source = String(value || "");
    const operation = "(?:修改|调整|增加|添加|删除|移除|降低|提高|改成|改为|替换|优化|增强|补充|保留)";
    const object = "(?:画面|提示词|内容|主体|背景|人物|角色|镜头|光线|光影|质感|构图|服装|姿势|色彩|风格|细节|曝光)";
    const chinese = new RegExp(`(?:^|[\\s\"'，。；;：:])(?:请|需要|需|应该|应当|建议|尝试|可以|必须|务必).{0,48}${operation}`, "u");
    const english = /\b(?:please|should|need(?:s|ed)?(?:\s+to)?)\b.{0,80}\b(?:modify|adjust|add|remove|delete|increase|decrease|improve|change|replace|optimi[sz]e|enhance|preserve|make|use|set)\b/iu;
    const bareChinese = new RegExp(`(?:^|[\\s\"'，。；;：:])${operation}.{0,16}${object}`, "u");
    const bareEnglish = /(?:^|["'.,;:\s])(?:modify|adjust|add|remove|delete|increase|decrease|improve|change|replace|optimi[sz]e|enhance|preserve|make|use|set)\s+(?:the\s+)?(?:image|prompt|content|subject|background|character|camera|lighting?|texture|composition|costume|pose|colo(?:u)?r|style|detail|exposure)\b/iu;
    return chinese.test(source) || english.test(source) || bareChinese.test(source) || bareEnglish.test(source);
  }

  function smartAiStructuredPromptFrontValueIsCommandOrEnvelope(value) {
    const source = String(value || "").trim();
    if (!source) return false;
    const englishNegativeCommand = /(?:^|[.!?;:\n]\s*)(?:(?:please\s+)?(?:do\s+not|don't)|never|avoid)\s+[a-z]/iu;
    const englishWithoutCommand = /(?:^|[.!?;:\n]\s*)without\s+(?:any\s+)?(?:occlusions?|cropping|crops?|support\s+surfaces?|relationships?)\b/iu;
    const englishNoFragment = /(?:^|[.!?;:\n]\s*)(?:no|zero)\s+(?:occlusions?|cropping|crops?|obstructions?|missing\s+(?:figures?|characters?|subjects?))\b/iu;
    const englishPassiveCommand = /\b(?:figures?|characters?|people|persons?|subjects?|silhouettes?)\b.{0,48}\b(?:must|should|can)\s+not\s+be\s+(?:cropped|occluded|obstructed|removed|changed|modified)\b/iu;
    const englishEnsureNoCommand = /(?:^|[.!?;:\n]\s*)(?:ensure|make\s+sure)\s+(?:that\s+)?(?:there\s+(?:is|are)\s+)?(?:no|zero|not\s+any)\s+[a-z]/iu;
    const englishBareCommand = /(?:^|[.!?;:\n]\s*)(?:crop|occlude|keep|ensure|make|use|set|remove|add|adjust|change|preserve|optimi[sz]e|enhance)\s+(?:the\s+|both\s+|all\s+)?(?:figures?|characters?|people|persons?|subjects?|silhouettes?|background|image|prompt|camera|framing|composition|lighting?|details?)\b/iu;
    const englishEnvelope = /(?:^|[.!?;:\n]\s*)(?:(?:here(?:'s|\s+is)|below\s+(?:is|are))\s+(?:the\s+|an?\s+|your\s+)?(?:optimized|optimised|revised|modified|updated|final)\s+(?:prompt|result|version)|(?:the\s+)?(?:optimized|optimised|revised|modified|updated|final)\s+prompt\s*(?:is\b|follows\b|[:：])|i(?:'ve|\s+have)\s+(?:optimized|optimised|revised|modified|updated)\s+(?:the\s+|your\s+)?prompt\b)/iu;
    const chineseCommand = /(?:^|[。！？；;：:\n]\s*)(?:请勿|不要|不得|禁止|避免|确保|保证)\s*(?:裁切|遮挡|修改|调整|增加|添加|删除|移除|改变|替换|优化|增强|保留|保持|人物|主体|角色|画面|背景|镜头|构图|光线)/u;
    const chineseWithoutCommand = /(?:^|[。！？；;：:\n]\s*)无(?:任何)?(?:遮挡|裁切|缺失|变形|融合)/u;
    const chineseEnvelope = /(?:^|[。！？；;：:\n]\s*)(?:这|以下|下面)(?:是|为)(?:已经?|本次)?(?:优化|修改|调整|更新|重写)后的?(?:最终)?提示词/u;
    return englishNegativeCommand.test(source)
      || englishWithoutCommand.test(source)
      || englishNoFragment.test(source)
      || englishPassiveCommand.test(source)
      || englishEnsureNoCommand.test(source)
      || englishBareCommand.test(source)
      || englishEnvelope.test(source)
      || chineseCommand.test(source)
      || chineseWithoutCommand.test(source)
      || chineseEnvelope.test(source);
  }

  function validateSmartAiStructuredArtPrompt(candidatePrompt) {
    const source = String(candidatePrompt || "").replace(/\r\n?/g, "\n").trim();
    if (!source) return { ok: false, code: "empty_candidate", section: "", line: 0 };
    if (/```/u.test(source)) return { ok: false, code: "markdown_fence", section: "", line: 0 };
    const forbiddenMeta = [
      /提示词(?:编辑|创作)模式/u,
      /用户本次(?:修改|创作)要求\s*[（(]?最高优先级/u,
      /当前(?:选择摘要|提示词要求|用户要求)/u,
      /只作为最终提示词约束/u,
      /不作为图片可见事实/u,
      /(?:以下是|下面是).{0,24}(?:优化|修改|调整).{0,12}提示词/u,
      /(?:优化|修改|调整)建议/u
    ];
    if (forbiddenMeta.some((pattern) => pattern.test(source))) {
      return { ok: false, code: "meta_content", section: "", line: 0 };
    }
    const lines = source.split("\n");
    const seenSections = [];
    const bodyCounts = new Map();
    const sectionKeys = new Map();
    const sectionEntries = new Map();
    let currentSection = "";
    for (let index = 0; index < lines.length; index += 1) {
      const lineNumber = index + 1;
      const line = String(lines[index] || "").trim();
      if (!line) continue;
      if (/^\[[^\]\r\n]+\]$/u.test(line)) {
        if (!ORDINARY_ART_PROMPT_SECTIONS.includes(line)) {
          return { ok: false, code: "unexpected_section", section: line, line: lineNumber };
        }
        if (seenSections.includes(line)) {
          return { ok: false, code: "duplicate_section", section: line, line: lineNumber };
        }
        const expectedSection = ORDINARY_ART_PROMPT_SECTIONS[seenSections.length] || "";
        if (line !== expectedSection) {
          return { ok: false, code: "section_order", section: line, expectedSection, line: lineNumber };
        }
        seenSections.push(line);
        currentSection = line;
        bodyCounts.set(line, 0);
        sectionKeys.set(line, new Set());
        sectionEntries.set(line, new Map());
        continue;
      }
      if (!currentSection) {
        return { ok: false, code: "preamble", section: "", line: lineNumber };
      }
      const keyValueMatch = line.match(/^([\p{L}\p{N}_.-]+)\s*=\s*(.+)$/u);
      if (!keyValueMatch) {
        return { ok: false, code: "invalid_toml_key_value", section: currentSection, line: lineNumber };
      }
      const key = keyValueMatch[1];
      const rawValue = String(keyValueMatch[2] || "").trim();
      const isSubjectCount = currentSection === "[主体物品]" && key === "主体数量";
      const semanticValue = isSubjectCount ? rawValue : readSmartAiStructuredPromptStringValue(rawValue);
      if ((isSubjectCount && !/^(?:[1-9]|1[0-2])$/u.test(rawValue))
        || (!isSubjectCount && semanticValue === null)) {
        return {
          ok: false,
          code: isSubjectCount ? "invalid_subject_count" : "invalid_toml_key_value",
          section: currentSection,
          line: lineNumber
        };
      }
      if (!isSubjectCount && (
        smartAiStructuredPromptValueIsMetaInstruction(semanticValue)
        || (currentSection !== "[用户附加要求]"
          && smartAiStructuredPromptFrontValueIsCommandOrEnvelope(semanticValue))
      )) {
        return { ok: false, code: "meta_instruction_value", section: currentSection, line: lineNumber };
      }
      const keys = sectionKeys.get(currentSection);
      if (keys.has(key)) {
        return { ok: false, code: "duplicate_key", section: currentSection, line: lineNumber };
      }
      keys.add(key);
      sectionEntries.get(currentSection).set(key, rawValue);
      bodyCounts.set(currentSection, Number(bodyCounts.get(currentSection) || 0) + 1);
    }
    if (seenSections.length !== ORDINARY_ART_PROMPT_SECTIONS.length) {
      return {
        ok: false,
        code: "missing_section",
        section: ORDINARY_ART_PROMPT_SECTIONS[seenSections.length] || "",
        line: 0
      };
    }
    const emptySection = ORDINARY_ART_PROMPT_SECTIONS.find((section) => !bodyCounts.get(section));
    if (emptySection) return { ok: false, code: "empty_section", section: emptySection, line: 0 };
    const exactKeysBySection = new Map([
      ["[风格设定]", ["媒介", "绘画语言", "氛围", "完成质感"]],
      ["[环境背景]", ["环境", "背景", "前中后景", "承托面", "遮挡层次"]],
      ["[光线与色彩]", ["光源方向", "光源软硬", "明暗关系", "轮廓光", "主辅色", "局部颜色"]],
      ["[拍摄参数]", ["景别", "视角", "构图", "裁切", "透视", "景深"]]
    ]);
    const sameOrderedKeys = (actual, expected) => actual.length === expected.length
      && actual.every((key, index) => key === expected[index]);
    for (const [section, expectedKeys] of exactKeysBySection) {
      const actualKeys = Array.from(sectionEntries.get(section)?.keys?.() || []);
      if (!sameOrderedKeys(actualKeys, expectedKeys)) {
        return { ok: false, code: "fixed_section_keys_mismatch", section, line: 0 };
      }
    }
    const subjectEntries = sectionEntries.get("[主体物品]");
    const subjectCount = Number(subjectEntries?.get("主体数量"));
    if (!Number.isInteger(subjectCount) || subjectCount < 1 || subjectCount > 12) {
      return { ok: false, code: "invalid_subject_count", section: "[主体物品]", line: 0 };
    }
    const expectedSubjectKeys = ["主体数量"];
    for (let index = 1; index <= subjectCount; index += 1) {
      expectedSubjectKeys.push(
        `主体${index}`,
        `主体${index}数量`,
        `主体${index}外观`,
        `主体${index}姿态`,
        `主体${index}动作`,
        `主体${index}材质`,
        `主体${index}颜色`,
        `主体${index}局部细节`
      );
    }
    expectedSubjectKeys.push("主体关系");
    if (!sameOrderedKeys(Array.from(subjectEntries.keys()), expectedSubjectKeys)) {
      return { ok: false, code: "subject_keys_mismatch", section: "[主体物品]", line: 0 };
    }
    const requirementKeys = Array.from(sectionEntries.get("[用户附加要求]")?.keys?.() || []);
    const expectedRequirementKeys = requirementKeys.map((_, index) => `要求${index + 1}`);
    if (!requirementKeys.length || !sameOrderedKeys(requirementKeys, expectedRequirementKeys)) {
      return { ok: false, code: "requirement_keys_mismatch", section: "[用户附加要求]", line: 0 };
    }
    const semanticSlots = validateSmartAiStructuredArtPromptSlotSemantics(sectionEntries);
    if (!semanticSlots.ok) return semanticSlots;
    if (source.replace(/\s+/gu, "").length < 300) {
      return { ok: false, code: "insufficient_total_detail", section: "", line: 0 };
    }
    return { ok: true, code: "structured_prompt", section: "", line: 0 };
  }

  function smartAiStructuredPromptError(result) {
    const code = String(result?.code || "prompt_structure_invalid");
    const contractMismatch = code === "prompt_contract_mismatch";
    const err = new Error(contractMismatch
      ? "模型未返回兼容的完整结构化提示词合同，本次未覆盖，原提示词保持不变，请重试。"
      : "模型返回的提示词不是完整、严格的六段结构化生图提示词，本次未覆盖，原提示词保持不变，请重试。");
    err.code = contractMismatch ? "prompt_contract_mismatch" : "prompt_structure_invalid";
    err.contractFailureCode = code;
    return err;
  }

  function validateSmartAiArtPromptPreservation(currentPrompt, candidatePrompt, userInstruction = "", options = {}) {
    const base = String(currentPrompt || "").trim();
    const candidate = String(candidatePrompt || "").trim();
    if (!base) return { ok: true, code: "no_base_prompt", missingBlocks: [] };
    if (!candidate) return { ok: false, code: "empty_candidate", missingBlocks: [] };
    const normalizedBase = normalizeSmartAiPromptPreservationText(base, true);
    const normalizedCandidate = normalizeSmartAiPromptPreservationText(candidate, true);
    if (String(userInstruction || "").trim()
      && !smartAiPromptInstructionAllowsUnchanged(userInstruction)
      && normalizedBase
      && normalizedCandidate === normalizedBase) {
      return {
        ok: false,
        code: "prompt_edit_not_applied",
        lengthRatio: 1,
        anchorCoverage: 1,
        missingBlocks: []
      };
    }
    const deterministicMerge = options?.deterministicMerge === true;
    if (deterministicMerge && smartAiPromptCandidateIsModelOperationInstruction(candidate)) {
      return {
        ok: false,
        code: "prompt_preservation_incomplete",
        failureReason: "model_operation_instruction",
        missingBlocks: []
      };
    }
    if (deterministicMerge) {
      return {
        ok: true,
        code: "deterministic_merge",
        lengthRatio: null,
        anchorCoverage: null,
        missingBlocks: []
      };
    }
    const removalTargets = smartAiExplicitPromptRemovalTargets(userInstruction);
    const expectedBlocks = smartAiPromptPreservationBlocks(base)
      .filter((block) => !smartAiPromptBlockExplicitlyRemoved(block, removalTargets));
    const targetedContentBlocks = expectedBlocks
      .filter((block) => smartAiPromptBlockTargetedByInstruction(block, userInstruction));
    const targetedContentBlockSet = new Set(targetedContentBlocks);
    const globallyPreservedBlocks = expectedBlocks
      .filter((block) => !targetedContentBlockSet.has(block));
    const expectedText = globallyPreservedBlocks.map((block) => block.text).join("\n\n");
    const expectedLength = normalizeSmartAiPromptPreservationText(expectedText, true).length;
    const candidateLength = normalizeSmartAiPromptPreservationText(candidate, true).length;
    const expectedTokens = smartAiPromptPreservationTokens(expectedText);
    const candidateTokens = smartAiPromptPreservationTokens(candidate);
    const lengthFloor = expectedLength >= 600 ? 0.38 : expectedLength >= 240 ? 0.34 : expectedLength >= 100 ? 0.3 : 0.22;
    const coverageFloor = expectedTokens.length >= 30 ? 0.34 : expectedTokens.length >= 12 ? 0.3 : 0.25;
    const lengthRatio = expectedLength ? candidateLength / expectedLength : 1;
    const anchorCoverage = smartAiPromptAnchorCoverage(expectedTokens, candidateTokens);
    const candidateLabels = new Set(smartAiPromptPreservationBlocks(candidate)
      .map((block) => normalizeSmartAiPromptPreservationText(block.label, true))
      .filter(Boolean));
    const missingPriorityBlockLabels = expectedBlocks.filter((block) => {
      if (!block.label || block.tokens.length < 3 || !isSmartAiPromptPreservationPriorityLabel(block.label)) return false;
      const label = normalizeSmartAiPromptPreservationText(block.label, true);
      const blockCoverage = smartAiPromptAnchorCoverage(block.tokens, candidateTokens);
      return blockCoverage < (candidateLabels.has(label) ? 0.6 : 0.65);
    }).map((block) => block.label);
    const missingTargetedBlockLabels = targetedContentBlocks
      .filter((block) => !candidateLabels.has(normalizeSmartAiPromptPreservationText(block.label, true)))
      .map((block) => block.label);
    const missingBlockLabels = Array.from(new Set([
      ...missingPriorityBlockLabels,
      ...missingTargetedBlockLabels
    ]));
    const priorityMissingBlocks = missingBlockLabels.filter((label) => /要求|避免|禁止|约束|目标|require|avoid|constraint|target/i.test(label));
    const missingBlocks = [
      ...priorityMissingBlocks,
      ...missingBlockLabels.filter((label) => !priorityMissingBlocks.includes(label))
    ].slice(0, 6);
    const minimumUsefulLength = expectedLength >= 80 ? 24 : 8;
    const ok = candidateLength >= minimumUsefulLength
      && lengthRatio >= lengthFloor
      && anchorCoverage >= coverageFloor
      && missingBlocks.length === 0;
    return {
      ok,
      code: ok ? "preserved" : "prompt_preservation_incomplete",
      lengthRatio,
      anchorCoverage,
      missingBlocks
    };
  }

  function smartAiPromptPreservationError(result) {
    if (String(result?.code || "") === "prompt_edit_not_applied") {
      const err = new Error("模型返回内容与原提示词相同，没有执行本次修改；本次未覆盖，原提示词保持不变，请重试或把修改要求写得更具体。");
      err.code = "prompt_edit_not_applied";
      return err;
    }
    const missing = Array.isArray(result?.missingBlocks) && result.missingBlocks.length
      ? `（缺少：${result.missingBlocks.join("、")}）`
      : "";
    const err = new Error(`优化结果未完整保留原提示词${missing}，本次未覆盖。原提示词保持不变，请重试；如确实需要删除某一部分，请在修改要求中明确写出要删除的内容。`);
    err.code = "prompt_preservation_incomplete";
    return err;
  }

  function preserveSmartAiReverseResourceMentions(currentText, generatedText) {
    const current = String(currentText || "");
    const generated = String(generatedText || "").trim();
    let aliases = [];
    const tool = window.NovaFlowResourceMentionTool;
    if (tool && typeof tool.protectText === "function") {
      try {
        aliases = (tool.protectText(current)?.tokens || []).map((entry) => String(entry?.token || ""));
      } catch (_) {
        aliases = [];
      }
    }
    if (!aliases.length) aliases = current.match(/@(?:\u53c2\u8003\u56fe[1-9][0-9]*|\u89c6\u9891\u53c2\u8003|\u58f0\u97f3\u53c2\u8003)/g) || [];
    const missing = Array.from(new Set(aliases.filter(Boolean))).filter((alias) => !generated.includes(alias));
    return missing.length ? `${missing.join(" ")}\n${generated}`.trim() : generated;
  }

  function hasOwnValue(source, key) {
    return Boolean(source && Object.prototype.hasOwnProperty.call(source, key));
  }

  function readSmartAiResultValue(result, nested, keys) {
    for (const key of keys) {
      if (hasOwnValue(result, key)) return result[key];
    }
    for (const key of keys) {
      if (hasOwnValue(nested, key)) return nested[key];
    }
    return undefined;
  }

  function readSmartAiResult(result) {
    const nested = result?.result && typeof result.result === "object"
      ? result.result
      : (result?.data && typeof result.data === "object" ? result.data : {});
    const prompt = String(result?.prompt || nested.prompt || nested.positivePrompt || nested.positive_prompt || nested.output_text || "").trim();
    const negativePrompt = String(
      result?.negative_prompt ??
      result?.negativePrompt ??
      nested.negative_prompt ??
      nested.negativePrompt ??
      ""
    );
    const hasNegativePrompt = Boolean(
      result?.has_negative_prompt ||
      result?.hasNegativePrompt ||
      nested.has_negative_prompt ||
      nested.hasNegativePrompt ||
      hasOwnValue(result, "negative_prompt") ||
      hasOwnValue(result, "negativePrompt") ||
      hasOwnValue(nested, "negative_prompt") ||
      hasOwnValue(nested, "negativePrompt")
    );
    const visualSchema = String(readSmartAiResultValue(result, nested, ["visualSchema", "visual_schema"]) || "").trim();
    const visualPrompt = String(readSmartAiResultValue(result, nested, ["visualPrompt", "visual_prompt"]) || "").trim();
    const generationRequirements = String(readSmartAiResultValue(result, nested, ["generationRequirements", "generation_requirements"]) || "").trim();
    const contentSafety = readSmartAiResultValue(result, nested, ["contentSafety", "content_safety"]);
    const contentWarningsValue = readSmartAiResultValue(result, nested, ["contentWarnings", "content_warnings"]);
    const sensitivePromptBlockedValue = readSmartAiResultValue(result, nested, ["sensitivePromptBlocked", "sensitive_prompt_blocked"]);
    const analysisDegradedValue = readSmartAiResultValue(result, nested, ["analysisDegraded", "analysis_degraded"]);
    const analysisPartialValue = readSmartAiResultValue(result, nested, ["analysisPartial", "analysis_partial"]);
    const generationGateValue = readSmartAiResultValue(result, nested, ["generationGate", "generation_gate"]);
    const contractFailureCodeValue = readSmartAiResultValue(result, nested, ["contractFailureCode", "contract_failure_code"]);
    const contractFailureCodeText = cleanSmartAiFailureText(contractFailureCodeValue, 80);
    const cleanedContractFailureCode = cleanSmartAiFailureCode(contractFailureCodeValue);
    const contractFailureCode = contractFailureCodeText === cleanedContractFailureCode ? cleanedContractFailureCode : "";
    const qualityGateFailedValue = readSmartAiResultValue(result, nested, ["qualityGateFailed", "quality_gate_failed"]);
    const editContractValue = cleanSmartAiFailureText(
      readSmartAiResultValue(result, nested, ["editContract", "edit_contract"]),
      64
    );
    const editContract = editContractValue === ORDINARY_ART_EDIT_CONTRACT ? editContractValue : "";
    const promptSchemaValue = cleanSmartAiFailureText(
      readSmartAiResultValue(result, nested, ["promptSchema", "prompt_schema"]),
      64
    );
    const promptSchema = promptSchemaValue === ORDINARY_ART_PROMPT_SCHEMA ? promptSchemaValue : "";
    return {
      prompt,
      negativePrompt,
      hasNegativePrompt,
      visualSchema,
      visualPrompt,
      generationRequirements,
      contentSafety: contentSafety && typeof contentSafety === "object" ? contentSafety : null,
      contentWarnings: Array.isArray(contentWarningsValue) ? contentWarningsValue : [],
      sensitivePromptBlocked: sensitivePromptBlockedValue === true,
      hasContentWarnings: Array.isArray(contentWarningsValue),
      hasSensitivePromptBlocked: typeof sensitivePromptBlockedValue === "boolean",
      analysisDegraded: analysisDegradedValue === true,
      analysisPartial: analysisPartialValue === true,
      generationGate: cleanSmartAiFailureText(generationGateValue, 32),
      contractFailureCode,
      qualityGateFailed: qualityGateFailedValue === true,
      editContract,
      promptSchema
    };
  }

  function cleanSmartAiFailureText(value, limit = 240) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
  }

  function cleanSmartAiFailureCode(value) {
    return cleanSmartAiFailureText(value, 80).match(/^[a-z0-9_.:-]+/i)?.[0] || "";
  }

  function readSmartAiFailureEnvelope(result) {
    const source = result && typeof result === "object" ? result : {};
    const nested = source.error && typeof source.error === "object"
      ? source.error
      : (source.data && typeof source.data === "object" ? source.data : {});
    const readValue = (key) => hasOwnValue(source, key) ? source[key] : nested[key];
    const rawRetryCount = Number(readValue("retryCount"));
    const retryCount = Number.isFinite(rawRetryCount)
      ? Math.max(0, Math.min(3, Math.trunc(rawRetryCount)))
      : 0;
    const messageSource = readValue("message")
      || (typeof source.error === "string" ? source.error : "");
    return {
      errorCode: cleanSmartAiFailureCode(readValue("errorCode")),
      message: cleanSmartAiFailureText(messageSource),
      retryable: readValue("retryable") === true,
      retryAttempted: readValue("retryAttempted") === true || retryCount > 0,
      retryCount,
      reverseProvider: cleanSmartAiFailureCode(readValue("reverseProvider")),
      providerFailureCode: cleanSmartAiFailureCode(readValue("providerFailureCode")),
      legacyFallbackSuppressed: readValue("legacyFallbackSuppressed") === true,
      requestedVisualSchema: cleanSmartAiFailureCode(readValue("requestedVisualSchema")),
      failureCategory: cleanSmartAiFailureText(readValue("failureCategory"), 120),
      failureClass: cleanSmartAiFailureCode(readValue("failureClass")),
      validationLeaf: cleanSmartAiFailureCode(readValue("validationLeaf") || readValue("h3ValidationLeaf")),
      generationGate: cleanSmartAiFailureCode(readValue("generationGate")),
      sensitivePromptBlocked: readValue("sensitivePromptBlocked") === true
    };
  }

  function smartAiFailureCategoryLabel(failure) {
    const isMiniMaxH3 = failure?.requestedVisualSchema === "nf.h3.visual.v1";
    if (failure?.validationLeaf === "visual-person-count") {
      return "视觉分析的人物数量校验未通过";
    }
    const category = String(failure?.failureCategory || "").trim();
    if (/[\u3400-\u9fff]/.test(category)) return category;
    const normalizedCategory = category.toLowerCase().replace(/[\s-]+/g, "_");
    if (isMiniMaxH3) {
      if (/content_policy|adult_confirmation|minor|young|age/.test(normalizedCategory)) {
        return "参考图或补充要求未通过 H3 内容与年龄校验";
      }
      if (/contract|schema|alignment|semantic|validation/.test(normalizedCategory)) {
        return "生成结果未通过 MiniMax H3 协议校验";
      }
      if (/timeout/.test(normalizedCategory)) return "MiniMax H3 分析超时";
      if (/provider|http|upstream/.test(normalizedCategory)) return "Grok 未完成 MiniMax H3 分析";
    }
    if (["semantic_contract", "contract_structure", "visual_contract_invalid", "contract_invalid"].includes(normalizedCategory)) {
      return "视觉分析结果未通过 v2 合同校验";
    }
    if (["configuration", "model_unavailable"].includes(normalizedCategory)) return "视觉分析模型未就绪";
    if (normalizedCategory === "provider") return "视觉分析模型未完成分析";
    const safeMessage = String(failure?.message || "").trim();
    if (/[\u3400-\u9fff]/.test(safeMessage)) return safeMessage;
    const markers = [
      category,
      failure?.errorCode,
      failure?.providerFailureCode,
      failure?.message
    ].map((item) => String(item || "").toLowerCase()).join(" ");
    if (/contract|schema|semantic|quality.?gate|v2-qwen3-fail-closed/.test(markers)) {
      return isMiniMaxH3 ? "生成结果未通过 MiniMax H3 协议校验" : "视觉分析结果未通过 v2 合同校验";
    }
    if (/model.*(?:missing|unavailable|not.?found)|qwen3.*required|provider.*unavailable/.test(markers)) return "本地视觉模型未就绪";
    if (/runtime.*(?:missing|unavailable|offline)|service.*(?:exit|unavailable)/.test(markers)) return "本地分析服务未就绪";
    if (/timeout|timed.?out|超时/.test(markers)) return "图片分析超时";
    if (/busy|正在推理/.test(markers)) return "分析服务正在处理其他任务";
    if (/quota|credit|rate.?limit|额度/.test(markers)) return "当前额度不足或请求受到限制";
    if (/auth|unauthorized|forbidden|登录|授权/.test(markers)) return "登录状态或分析授权无效";
    if (/network|fetch|connect|econn|网络|连接/.test(markers)) return "无法连接图片分析服务";
    if (/request.*(?:large|size)|payload.*large|413|图片过大/.test(markers)) return "参考图过大";
    return isMiniMaxH3 ? "分析服务未返回可用的 MiniMax H3 结果" : "分析服务未返回可用的 v2 结果";
  }

  function smartAiAnalysisFailureStatusMessage(failure) {
    const lines = [
      `分析失败—未写入：${smartAiFailureCategoryLabel(failure)}`
    ];
    if (failure?.retryAttempted) {
      lines.push(`已自动重试 ${Math.max(1, Number(failure.retryCount) || 0)} 次，仍未得到可用结果。`);
    }
    if (failure?.legacyFallbackSuppressed) {
      lines.push(failure?.requestedVisualSchema === "nf.h3.visual.v1"
        ? "为避免未经验证的内容写入，本次未绕过 MiniMax H3 视觉合同。"
        : "为避免旧版 v1 内容错误写入，本次未回退到 legacy 合同。");
    }
    if (failure?.reverseProvider) lines.push(`分析引擎：${failure.reverseProvider}`);
    const codes = Array.from(new Set([
      failure?.errorCode,
      failure?.providerFailureCode,
      failure?.failureClass,
      failure?.validationLeaf
    ].filter(Boolean)));
    if (codes.length) lines.push(`错误代码：${codes.join(" / ")}`);
    return lines.join("\n");
  }

  function miniMaxH3FailureMarkerText(value) {
    const source = value && typeof value === "object" ? value : {};
    const records = [source];
    for (const key of ["error", "data", "failure"]) {
      if (source[key] && typeof source[key] === "object") records.push(source[key]);
    }
    const fields = [
      "errorCode",
      "providerFailureCode",
      "failureCategory",
      "failureClass",
      "contractFailureCode",
      "code",
      "message",
      "generationGate",
      "sensitivePromptBlocked"
    ];
    return records.flatMap((record) => fields.map((field) => (
      ["generationGate", "sensitivePromptBlocked"].includes(field)
        ? `${field}:${String(record[field] || "")}`
        : record[field]
    )))
      .concat(typeof source.error === "string" ? source.error : "")
      .map((item) => String(item || "").toLowerCase())
      .join(" ");
  }

  function miniMaxH3FailureBlocksGuaranteedFallback(value) {
    const markers = miniMaxH3FailureMarkerText(value);
    return /(?:h3[-_ ]?content[-_ ]?policy[-_ ]?blocked|provider[-_ ]?content[-_ ]?policy|content[-_ ]?policy|h3[-_ ]?sensitive[-_ ][a-z0-9_-]*(?:minor|underage|child|young|adult[-_ ]?confirmation|analysis[-_ ]?required|no[-_ ]?evidence)[a-z0-9_-]*|sensitivepromptblocked:true|explicit[-_ ]?(?:minor|underage|child)|underage|minor[-_ ]?(?:request|evidence|blocked)|young[-_ ]?evidence|child[-_ ]?evidence|adult[-_ ]?confirmation|未成年人|未满\s*(?:18|十八)\s*岁|未成年[^ ]*(?:证据|内容|阻止)|内容策略)/i.test(markers);
  }

  function miniMaxH3FailureIsStale(value) {
    const markers = miniMaxH3FailureMarkerText(value);
    return /(?:snapshot[-_ ]?stale|\bstale\b|fingerprint|resources?[-_ ]?changed|mode[-_ ]?changed|duration[-_ ]?changed|prompt[-_ ]?changed|requirements?[-_ ]?changed|state[-_ ]?changed|changed[-_ ]?while|快照[^ ]*过期|结果[^ ]*过期|资源[^ ]*(?:变化|更改)|模式[^ ]*(?:变化|更改)|时长[^ ]*(?:变化|更改)|提示词[^ ]*(?:变化|更改))/i.test(markers);
  }

  function miniMaxH3FailureAllowsGuaranteedFallback(value) {
    if (miniMaxH3FailureBlocksGuaranteedFallback(value) || miniMaxH3FailureIsStale(value)) return false;
    const source = value && typeof value === "object" ? value : {};
    const isErrorObject = source instanceof Error || Object.prototype.toString.call(source) === "[object Error]";
    const trustedKind = isErrorObject
      ? String(source.miniMaxH3FallbackFailureType || "").trim().toLowerCase()
      : "";
    if (["bridge_exception", "bridge_response", "contract_invalid", "invalid_response"].includes(trustedKind)) {
      return true;
    }
    const markers = miniMaxH3FailureMarkerText(value);
    return /(?:timeout|timed[-_ ]?out|abort(?:ed)?|network|fetch|connect|econn|socket|\bhttp[-_ ]?\d{3}\b|upstream|provider|runtime|service|bridge|\bipc\b|invoking[-_ ]?remote[-_ ]?method|prompt[-_ ]?assistant|client[-_ ]?api[-_ ]?request[-_ ]?(?:failed|timeout)|model[-_ ]?(?:missing|unavailable|not[-_ ]?found)|h3[-_ ]?contract|(?:^|\s)contract(?:\s|$)|contract[-_ ]?(?:invalid|structure|alignment|semantic)|schema[-_ ]?(?:invalid|required|unsupported)|semantic[-_ ]?contract|validation[-_ ]?failed|h3[-_ ][a-z0-9_-]*(?:failed|empty|required|unsupported|invalid)|invalid[-_ ]?(?:response|result|output)|malformed[-_ ]?(?:response|result|output)|empty[-_ ]?(?:response|result|output)|quota|credit|rate[-_ ]?limit|busy|超时|网络|连接|服务[^ ]*(?:不可用|未就绪|退出)|模型[^ ]*(?:缺失|不可用|未找到)|协议[^ ]*(?:无效|校验失败)|结构[^ ]*(?:无效|校验失败)|响应[^ ]*(?:无效|为空)|结果[^ ]*(?:无效|为空)|额度[^ ]*(?:不足|限制))/i.test(markers);
  }

  const SMART_AI_VISUAL_V2_PUBLIC_SAFETY_KEYS = [
    "age_assessment",
    "body_exposure",
    "interaction_category",
    "level",
    "sensitive_visible_facts",
    "signals",
    "visible_person_count"
  ];
  const SMART_AI_VISUAL_V2_LEVELS = new Set(["safe", "suggestive", "nudity", "explicit", "uncertain"]);
  const SMART_AI_VISUAL_V2_BODY_EXPOSURES = new Set(["none", "partial", "full", "uncertain"]);
  const SMART_AI_VISUAL_V2_INTERACTIONS = new Set(["none", "intimate", "sexual", "uncertain"]);
  const SMART_AI_VISUAL_V2_AGES = new Set([
    "adult_appearing",
    "age_unverifiable",
    "young_or_minor_indicators",
    "ambiguous_or_young_appearing",
    "not_applicable"
  ]);
  const SMART_AI_VISUAL_V2_SIGNALS = new Set(["nudity", "sexualized_pose", "explicit_activity", "explicit_anatomy", "sexual_fluid", "age_ambiguous"]);
  const SMART_AI_VISUAL_V2_WARNING_TAGS = new Set([
    ...SMART_AI_VISUAL_V2_SIGNALS,
    "sensitive_prompt_nsfw_disabled",
    "sensitive_prompt_age_unconfirmed",
    "sensitive_prompt_minor_requirements"
  ]);
  const SMART_AI_VISUAL_V2_GENERATION_GATES = new Set(["direct", "adult_confirmation", "neutral_only", "blocked"]);
  const SMART_AI_VISUAL_V2_EXPLICIT_SIGNALS = new Set(["explicit_activity", "explicit_anatomy", "sexual_fluid"]);
  const SMART_AI_VISUAL_V2_ZERO_PERSON_FORBIDDEN_SIGNALS = new Set(["nudity", "sexualized_pose", "explicit_activity", "age_ambiguous"]);

  function isValidPublicVisualV2Result(result, options = null) {
    if (!result || result.visualSchema !== "nf.visual.v2") return false;
    if (!String(result.visualPrompt || "").trim()) return false;
    if (result.hasSensitivePromptBlocked !== true || result.hasContentWarnings !== true) return false;
    if (typeof result.sensitivePromptBlocked !== "boolean" || !Array.isArray(result.contentWarnings)) return false;
    if (result.contentWarnings.some((item) => typeof item !== "string" || !SMART_AI_VISUAL_V2_WARNING_TAGS.has(item))) return false;
    if (new Set(result.contentWarnings).size !== result.contentWarnings.length) return false;
    const safety = result.contentSafety;
    if (!safety || typeof safety !== "object" || Array.isArray(safety)) return false;
    const keys = Object.keys(safety).sort();
    if (keys.length !== SMART_AI_VISUAL_V2_PUBLIC_SAFETY_KEYS.length
      || keys.some((key, index) => key !== SMART_AI_VISUAL_V2_PUBLIC_SAFETY_KEYS[index])) return false;
    const level = String(safety.level || "");
    const bodyExposure = String(safety.body_exposure || "");
    const interaction = String(safety.interaction_category || "");
    const age = String(safety.age_assessment || "");
    const count = safety.visible_person_count;
    const signals = safety.signals;
    const publicFacts = safety.sensitive_visible_facts;
    if (!SMART_AI_VISUAL_V2_LEVELS.has(level)
      || !SMART_AI_VISUAL_V2_BODY_EXPOSURES.has(bodyExposure)
      || !SMART_AI_VISUAL_V2_INTERACTIONS.has(interaction)
      || !SMART_AI_VISUAL_V2_AGES.has(age)) return false;
    if (!Number.isInteger(count) || count < 0 || count > 12) return false;
    if (!Array.isArray(signals) || signals.length > 8 || !Array.isArray(publicFacts) || publicFacts.length !== 0) return false;
    if (signals.some((item) => typeof item !== "string" || !SMART_AI_VISUAL_V2_SIGNALS.has(item))) return false;
    if (new Set(signals).size !== signals.length || signals.some((signal) => !result.contentWarnings.includes(signal))) return false;
    const signalSet = new Set(signals);
    if (count === 0 ? age !== "not_applicable" : age === "not_applicable") return false;
    const generationGate = String(result.generationGate || "");
    const hasGenerationGate = SMART_AI_VISUAL_V2_GENERATION_GATES.has(generationGate);
    if (generationGate && !hasGenerationGate) return false;
    if (options?.requireGenerationGate === true && !hasGenerationGate) return false;
    if (result.analysisDegraded === true) {
      if (result.analysisPartial === true) return false;
      if (result.qualityGateFailed !== true || !String(result.contractFailureCode || "").trim()) return false;
      if (level !== "uncertain" || signals.length || result.contentWarnings.length || result.sensitivePromptBlocked !== true) return false;
      if (hasGenerationGate && generationGate !== "blocked") return false;
      if (count === 0) return bodyExposure === "none" && interaction === "none";
      return age !== "adult_appearing"
        && age !== "not_applicable"
        && bodyExposure === "uncertain"
        && interaction === "uncertain";
    }
    if (count === 0 && level !== "safe"
      && (bodyExposure !== "none"
        || interaction !== "none"
        || [...SMART_AI_VISUAL_V2_ZERO_PERSON_FORBIDDEN_SIGNALS].some((signal) => signalSet.has(signal)))) return false;
    if (["partial", "full"].includes(bodyExposure) && !signalSet.has("nudity")) return false;
    if (bodyExposure === "none" && signalSet.has("nudity")) return false;
    if (interaction === "sexual" && !signalSet.has("explicit_activity")) return false;
    if (signalSet.has("explicit_activity") && interaction === "none") return false;
    if (level === "safe" && (bodyExposure !== "none" || interaction !== "none" || signals.length)) return false;
    if (level === "suggestive" && (bodyExposure === "full" || interaction === "sexual")) return false;
    if (level === "nudity" && (bodyExposure === "none" || interaction === "sexual")) return false;
    if (["suggestive", "nudity"].includes(level)
      && [...SMART_AI_VISUAL_V2_EXPLICIT_SIGNALS].some((signal) => signalSet.has(signal))) return false;
    if (level === "explicit"
      && interaction !== "sexual"
      && ![...SMART_AI_VISUAL_V2_EXPLICIT_SIGNALS].some((signal) => signalSet.has(signal))) return false;
    const ageRequiresAmbiguousSignal = [
      "age_unverifiable",
      "young_or_minor_indicators",
      "ambiguous_or_young_appearing"
    ].includes(age);
    if (level !== "safe" && ageRequiresAmbiguousSignal && !signalSet.has("age_ambiguous")) return false;
    if (level !== "safe" && signalSet.has("age_ambiguous") && !ageRequiresAmbiguousSignal) return false;
    const sensitiveLevel = ["suggestive", "nudity", "explicit"].includes(level);
    const ageUnconfirmed = count > 0 && age !== "adult_appearing";
    const nsfwEnabled = options?.nsfw === true;
    const confirmationAge = age === "adult_appearing" || age === "age_unverifiable";
    const hardBlockedAge = age === "young_or_minor_indicators" || age === "ambiguous_or_young_appearing";
    const warningSet = new Set(result.contentWarnings);
    const minorRequirementsBlocked = options?.requirementsContainExplicitMinor === true
      && (sensitiveLevel || options?.requirementsContainSensitiveIntent === true);
    if (warningSet.has("sensitive_prompt_nsfw_disabled") && (nsfwEnabled || !sensitiveLevel)) return false;
    if (warningSet.has("sensitive_prompt_age_unconfirmed") && (!sensitiveLevel || count <= 0 || age === "adult_appearing")) return false;
    if (warningSet.has("sensitive_prompt_minor_requirements") !== minorRequirementsBlocked) return false;
    if (minorRequirementsBlocked
      && (!hasGenerationGate || generationGate !== "blocked" || result.sensitivePromptBlocked !== true)) return false;
    if (result.analysisPartial === true) {
      const interactionEvidenceIncomplete = result.contractFailureCode === "visual-contract-interaction-evidence-incomplete";
      const projectionRedactionRequired = result.contractFailureCode === "visual-contract-projection-redaction-required";
      if (result.analysisDegraded === true
        || result.qualityGateFailed !== true
        || (!interactionEvidenceIncomplete && !projectionRedactionRequired)
        || !sensitiveLevel
        || (interactionEvidenceIncomplete && (count <= 0
          || (interaction !== "sexual" && !signalSet.has("explicit_activity"))))) return false;
      if (!hasGenerationGate) return false;
      if (minorRequirementsBlocked) return generationGate === "blocked" && result.sensitivePromptBlocked === true;
      if (hardBlockedAge) return generationGate === "blocked" && result.sensitivePromptBlocked === true;
      if (nsfwEnabled && count > 0 && confirmationAge) {
        return generationGate === "adult_confirmation"
          && result.sensitivePromptBlocked === false;
      }
      return generationGate === "blocked" && result.sensitivePromptBlocked === true;
    }
    if (hasGenerationGate) {
      if (result.qualityGateFailed === true) return false;
      if (generationGate === "direct") {
        return level === "safe" && result.sensitivePromptBlocked === false;
      }
      if (generationGate === "adult_confirmation") {
        return sensitiveLevel
          && level !== "uncertain"
          && nsfwEnabled
          && count > 0
          && confirmationAge
          && !hardBlockedAge
          && result.sensitivePromptBlocked === false;
      }
      if (generationGate === "neutral_only") return false;
      return result.sensitivePromptBlocked === true
        && (level === "uncertain"
          || hardBlockedAge
          || minorRequirementsBlocked
          || (sensitiveLevel && (count === 0 || !nsfwEnabled)));
    }
    const expectedBlocked = level === "uncertain"
      || (sensitiveLevel && (count === 0 || !nsfwEnabled || ageUnconfirmed));
    if (result.sensitivePromptBlocked !== expectedBlocked) return false;
    const expectedWarnings = new Set(signals);
    if (sensitiveLevel && !nsfwEnabled) expectedWarnings.add("sensitive_prompt_nsfw_disabled");
    if (sensitiveLevel && ageUnconfirmed) expectedWarnings.add("sensitive_prompt_age_unconfirmed");
    if (expectedWarnings.size !== result.contentWarnings.length
      || result.contentWarnings.some((warning) => !expectedWarnings.has(warning))) return false;
    return true;
  }

  function setPromptTextareasValue(textareas, prompt, options = {}) {
    const positiveOk = setTextareaValue(textareas?.positive, prompt);
    if (!positiveOk) throw smartAiWriteError("未找到提示词框");
    if (options.supportsNegativePrompt && options.hasNegativePrompt) {
      const negativeOk = setTextareaValue(textareas?.negative, options.negativePrompt || "");
      if (!negativeOk && String(options.negativePrompt || "").trim()) {
        throw smartAiWriteError("未找到负面提示词框");
      }
    }
  }

  function isFilledImage(img) {
    const src = String(img?.currentSrc || img?.src || "").trim();
    return Boolean(src && !src.startsWith("data:,"));
  }

  function dataUrlFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("image read failed"));
      reader.readAsDataURL(blob);
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("image encode failed"));
      }, mime, quality);
    });
  }

  function loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image load failed"));
      };
      image.src = url;
    });
  }

  function scaledImageSize(width, height, maxSide) {
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);
    const side = Math.max(safeWidth, safeHeight);
    if (side <= maxSide) return { width: safeWidth, height: safeHeight };
    const scale = maxSide / side;
    return {
      width: Math.max(1, Math.round(safeWidth * scale)),
      height: Math.max(1, Math.round(safeHeight * scale))
    };
  }

  function drawImageToCanvas(image, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("image canvas is unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function normalizeSmartAiImageForVision(src) {
    const value = String(src || "").trim();
    if (!value || /^https?:\/\//i.test(value)) return value;
    const response = await fetch(value);
    const blob = await response.blob();
    const image = await loadImageFromBlob(blob);
    const originalWidth = image.naturalWidth || image.width;
    const originalHeight = image.naturalHeight || image.height;
    let size = scaledImageSize(originalWidth, originalHeight, SMART_AI_VISION_MAX_SIDE);
    if (blob.size > 0 && blob.size <= SMART_AI_VISION_TARGET_BYTES && Math.max(originalWidth, originalHeight) <= SMART_AI_VISION_MAX_SIDE) {
      return /^data:image\//i.test(value) ? value : await dataUrlFromBlob(blob);
    }

    let quality = 0.86;
    let canvas = drawImageToCanvas(image, size.width, size.height);
    let bestBlob = null;
    for (let index = 0; index < 8; index += 1) {
      const nextBlob = await canvasToBlob(canvas, SMART_AI_VISION_OUTPUT_MIME, quality);
      if (!bestBlob || nextBlob.size < bestBlob.size) bestBlob = nextBlob;
      if (nextBlob.size <= SMART_AI_VISION_TARGET_BYTES) {
        return await dataUrlFromBlob(nextBlob);
      }
      if (quality > SMART_AI_VISION_MIN_QUALITY) {
        quality = Math.max(SMART_AI_VISION_MIN_QUALITY, quality - 0.12);
        continue;
      }
      const nextMaxSide = Math.max(640, Math.round(Math.max(canvas.width, canvas.height) * 0.82));
      size = scaledImageSize(originalWidth, originalHeight, nextMaxSide);
      canvas = drawImageToCanvas(image, size.width, size.height);
      quality = 0.82;
    }
    return await dataUrlFromBlob(bestBlob || blob);
  }

  async function normalizeImageUrl(src) {
    const value = String(src || "").trim();
    if (!value) return "";
    return await normalizeSmartAiImageForVision(value);
  }

  function smartAiFailureMessage(err) {
    const raw = String(err?.message || err || "").trim();
    if (String(err?.code || "") === "write_prompt_failed") {
      return `写入提示词失败\n${raw || "请重新打开弹窗后再试"}`;
    }
    if (String(err?.code || "") === "resource_mention_protection_failed") {
      return `资源引用保护失败\n${raw || "原提示词已保留，请重试"}`;
    }
    if ([
      "prompt_preservation_incomplete",
      "prompt_edit_not_applied",
      "prompt_contract_mismatch",
      "prompt_structure_invalid"
    ].includes(String(err?.code || ""))) {
      return `提示词优化未写入\n${raw || "优化结果不完整，原提示词保持不变"}`;
    }
    if (/REQUEST_BODY_TOO_LARGE|request body too large|payload too large|413/i.test(raw)) {
      return "参考图过大\n请换小图或压缩后重试";
    }
    if (raw && raw.length <= 80) {
      return `生成失败\n${raw}`;
    }
    return "生成失败\n请稍后重试";
  }

  function imageRoleFromSlot(slot) {
    const attr = String(slot?.getAttribute?.("data-ais-import") || "").trim();
    if (/first/i.test(attr)) return "first_frame";
    if (/last/i.test(attr)) return "last_frame";
    if (/art_reference/i.test(attr)) return "reference";
    return attr || "reference";
  }

  function labelFromSlot(slot, index) {
    const text = String(slot?.textContent || "").replace(/\s+/g, " ").trim();
    if (/首帧/.test(text)) return "首帧";
    if (/尾帧/.test(text)) return "尾帧";
    const attr = String(slot?.getAttribute?.("data-ais-import") || "").trim();
    const art = attr.match(/art_reference_(\d+)/i);
    if (art) return `图${art[1]}`;
    return `图${index + 1}`;
  }

  async function collectAnimationImages(button) {
    const workspace = button?.closest?.('[data-novaflow-ai-bottom-workspace="1"]') ||
      document.querySelector('[data-novaflow-ai-bottom-workspace="1"]');
    if (!(workspace instanceof HTMLElement)) return [];
    const slots = Array.from(workspace.querySelectorAll("[data-ais-import]")).filter((slot) => {
      if (!(slot instanceof HTMLElement)) return false;
      const attr = String(slot.getAttribute("data-ais-import") || "");
      if (/color_ref/i.test(attr)) return false;
      return slot.querySelector("img");
    });
    const images = [];
    for (const slot of slots) {
      const img = slot.querySelector("img");
      if (!isFilledImage(img)) continue;
      const imageUrl = await normalizeImageUrl(img.currentSrc || img.src);
      if (!imageUrl) continue;
      images.push({
        imageUrl,
        label: labelFromSlot(slot, images.length),
        role: imageRoleFromSlot(slot),
        slotType: imageRoleFromSlot(slot)
      });
    }
    return images.slice(0, 4);
  }

  async function collectArtImages(button) {
    const workspace = button?.closest?.("#novaflow-art-generate-workspace") ||
      document.getElementById("novaflow-art-generate-workspace");
    if (!(workspace instanceof HTMLElement)) return [];
    const slots = Array.from(workspace.querySelectorAll('[data-novaflow-art-generate-reference-column="1"] [data-ais-import]')).filter((slot) => (
      slot instanceof HTMLElement && slot.querySelector("img")
    ));
    const images = [];
    for (const slot of slots) {
      const img = slot.querySelector("img");
      if (!isFilledImage(img)) continue;
      const imageUrl = await normalizeImageUrl(img.currentSrc || img.src);
      if (!imageUrl) continue;
      images.push({
        imageUrl,
        label: labelFromSlot(slot, images.length),
        role: "reference",
        slotType: "reference"
      });
    }
    return images.slice(0, 4);
  }

  function getImageScenario(images) {
    const hasFirst = images.some((item) => /first|首帧/i.test(`${item.role} ${item.slotType} ${item.label}`));
    const hasLast = images.some((item) => /last|尾帧/i.test(`${item.role} ${item.slotType} ${item.label}`));
    if (hasFirst && hasLast) return "video_frames";
    if (images.length > 1) return "multi_reference";
    return images.length ? "single_reference" : "none";
  }

  function readArtGenerateMode(button) {
    const workspace = button?.closest?.("#novaflow-art-generate-workspace") || document.getElementById("novaflow-art-generate-workspace");
    const modeHost = workspace?.querySelector?.("[data-novaflow-art-generate-render-mode]");
    return String(modeHost?.getAttribute?.("data-novaflow-art-generate-render-mode") || "") === "img2img" ? "img2img" : "txt2img";
  }

  function readArtGenerateNsfw(button) {
    const workspace = button?.closest?.("#novaflow-art-generate-workspace") || document.getElementById("novaflow-art-generate-workspace");
    return workspace?.getAttribute?.("data-novaflow-art-generate-nsfw") === "1";
  }

  function readSmartAiLiveImageSignature() {
    const context = state.context;
    if (context?.miniMaxH3?.modelId === MINIMAX_H3_MODEL_ID) {
      const current = readMiniMaxH3PromptSurfaceState(context?.button, context?.promptTarget);
      return current.resources.map((resource) => [
        resource.key,
        resource.sourceId,
        resource.previewFingerprint,
        resource.resourceVersion
      ].join(":")).join("|");
    }
    const button = context?.button;
    const workspace = context?.surface === "art"
      ? (button?.closest?.("#novaflow-art-generate-workspace") || document.getElementById("novaflow-art-generate-workspace"))
      : (button?.closest?.('[data-novaflow-ai-bottom-workspace="1"]') || document.querySelector('[data-novaflow-ai-bottom-workspace="1"]'));
    if (!(workspace instanceof HTMLElement)) return "";
    const selector = context?.surface === "art"
      ? '[data-novaflow-art-generate-reference-column="1"] [data-ais-import] img'
      : '[data-ais-import] img';
    return Array.from(workspace.querySelectorAll(selector))
      .filter((image) => isFilledImage(image))
      .map((image) => String(image.currentSrc || image.src || ""))
      .join("|");
  }

  function buildSmartAiRequestFingerprint(options = {}) {
    const textareas = getPromptTextareasFromContext(state.context);
    const isArt = state.context?.surface === "art";
    const ignoreArtReferenceState = isArt && options.ignoreArtReferenceState === true;
    const artIntent = isArt && !ignoreArtReferenceState ? deriveArtAutoIntent() : null;
    return JSON.stringify({
      positive: String(textareas.positive?.value || ""),
      negative: String(textareas.negative?.value || ""),
      nsfw: isArt ? readArtGenerateNsfw(state.context?.button) : false,
      h3VisualSchema: state.context?.miniMaxH3?.modelId === MINIMAX_H3_MODEL_ID
        && state.mode === "reverse" ? MINIMAX_H3_VISUAL_SCHEMA : "",
      h3ContentPolicy: state.context?.miniMaxH3?.modelId === MINIMAX_H3_MODEL_ID
        && state.mode === "reverse" ? miniMaxH3ContentPolicy() : null,
      liveImages: ignoreArtReferenceState ? "" : readSmartAiLiveImageSignature(),
      normalizedImages: ignoreArtReferenceState
        ? []
        : state.images.map((item) => smartAiReferenceFingerprint(item.imageUrl)),
      mode: state.mode,
      engine: state.engine,
      artRoute: artIntent?.route || "",
      artGenerationMode: artIntent?.generationMode || "",
      artTask: ignoreArtReferenceState ? "" : state.artTask,
      artStyle: ignoreArtReferenceState ? "" : state.artStyle,
      backgroundMode: ignoreArtReferenceState ? "" : state.backgroundMode,
      preserveLevel: ignoreArtReferenceState ? "" : state.preserveLevel,
      referenceRoles: ignoreArtReferenceState ? [] : state.referenceRoles,
      targetIndex: ignoreArtReferenceState ? 0 : state.targetIndex,
      requirements: state.requirements,
      hadInitialPrompt: state.hadInitialPrompt
    });
  }

  async function refreshImageContext() {
    const context = state.context;
    if (context?.miniMaxH3?.modelId === MINIMAX_H3_MODEL_ID) {
      await refreshMiniMaxH3ReverseContext();
      return;
    }
    const refreshEpoch = ++state.imageRefreshEpoch;
    const isCurrentRefresh = () => state.open
      && state.context === context
      && state.imageRefreshEpoch === refreshEpoch;
    const button = context?.button;
    state.imagesLoading = true;
    state.message = "";
    renderDialog();
    try {
      const images = context?.surface === "art"
        ? await collectArtImages(button)
        : await collectAnimationImages(button);
      if (!isCurrentRefresh()) return;
      state.images = context?.surface === "art" ? images.slice(0, 3) : images;
      // One action per surface: with references the assistant reads them together
      // with the text the user wrote, without references it works on the text alone.
      state.mode = state.images.length ? "reverse" : "optimize";
      if (context?.surface === "art") syncArtAutoIntent();
      state.targetIndex = Math.max(0, Math.min(state.targetIndex, Math.max(0, images.length - 1)));
    } catch {
      if (!isCurrentRefresh()) return;
      state.images = [];
      state.mode = "optimize";
      if (context?.surface === "art") syncArtAutoIntent();
    } finally {
      if (isCurrentRefresh()) {
        state.imagesLoading = false;
        renderDialog();
      }
    }
  }

  function closeDialog() {
    const root = document.getElementById(ROOT_ID);
    if (root) root.remove();
    state.open = false;
    state.imageRefreshEpoch += 1;
    state.loading = false;
    state.message = "";
    state.messageTone = "";
    state.analysisResult = null;
    state.analysisFailure = null;
    state.pendingApply = null;
    state.revealAnalysisOnRender = false;
  }

  function invalidateSmartAiAnalysis(message = "") {
    const hadResult = Boolean(state.analysisResult || state.analysisFailure || state.pendingApply);
    state.analysisResult = null;
    state.analysisFailure = null;
    state.pendingApply = null;
    state.revealAnalysisOnRender = false;
    state.messageTone = "";
    if (hadResult && message) state.message = message;
  }

  function showLocalStaticReverseWarning(message) {
    const text = String(message || "").trim();
    if (!text) return;
    try {
      window.dispatchEvent(new CustomEvent("novaflow:prompt-assistant-warning", {
        detail: { message: text }
      }));
    } catch {}
  }

  function onKeyDown(event) {
    if (event.key === "Escape" && state.open && !state.loading) {
      event.preventDefault();
      closeDialog();
    }
  }

  function deriveArtAutoIntent() {
    const workflow = window.NovaFlowSmartAiArtAutoIntent;
    const fallbackRoles = state.images.map((_, index) => index === 0 ? "subject" : (index === 1 ? "style" : "background"));
    const fallback = {
      imageCount: state.images.length,
      hasReferences: state.images.length > 0,
      route: state.images.length ? (state.images.length === 1 ? "static_reverse" : "role_reference") : "optimize",
      purpose: state.images.length ? (state.images.length === 1 ? "static-image-reverse" : "roleReference") : (state.hadInitialPrompt ? "optimize" : "create"),
      generationMode: state.images.length ? "img2img" : "txt2img",
      task: state.images.length > 1 ? "combine" : state.images.length ? "preserve" : "create",
      style: state.images.length ? "original" : "auto",
      preserveLevel: "high",
      backgroundMode: "replace",
      roles: fallbackRoles,
      unresolvedRoleIndices: state.images.length > 1 ? state.images.slice(1).map((_, index) => index + 1) : [],
      roleConfidence: state.images.length > 1 ? "low" : "high",
      userIntent: String(state.requirements || "").trim(),
      canSubmit: state.images.length > 0
        || Boolean(String(state.requirements || "").trim())
        || Boolean(state.hadInitialPrompt)
    };
    if (!workflow?.derive) return fallback;
    try {
      return workflow.derive({
        imageCount: state.images.length,
        userIntent: state.requirements,
        hadInitialPrompt: state.hadInitialPrompt,
        roleOverrides: state.referenceRoleOverrides
      });
    } catch {
      return fallback;
    }
  }

  function syncArtAutoIntent() {
    if (state.context?.surface !== "art") return null;
    const intent = deriveArtAutoIntent();
    state.artTask = intent.task;
    state.artStyle = intent.style;
    state.backgroundMode = intent.backgroundMode;
    state.preserveLevel = intent.preserveLevel;
    state.referenceRoles = intent.roles.slice();
    state.starterPreset = intent.userIntent
      ? String(window.NovaFlowArtQualityProfile?.inferAssetType?.(intent.userIntent, "") || "")
      : "";
    return intent;
  }

  function renderArtAutoStatus(intent) {
    if (state.imagesLoading) {
      return `<div class="novaflow-smart-ai-auto-status">正在读取参考图...</div>`;
    }
    if (state.mode === "optimize" || !intent?.hasReferences) {
      return `<div class="novaflow-smart-ai-auto-status">结合原提示词与补充要求，分析并融合为完整生图提示词</div>`;
    }
    const roleNote = intent.imageCount > 1 && intent.roleConfidence === "low"
      ? "；可在下方选择辅助图用途"
      : "";
    return `<div class="novaflow-smart-ai-auto-status">已检测 ${intent.imageCount} 张参考图；将结合参考图、提示词与补充要求，写入完整提示词${roleNote}</div>`;
  }

  function artAutoSubmitLabel(intent, currentPrompt = "") {
    if (state.mode === "reverse" && intent?.imageCount > 1) return "结合多参考图生成提示词";
    return String(currentPrompt || "").trim() ? "优化并写入提示词" : "生成并写入提示词";
  }

  function renderArtReferenceRoles(intent) {
    const unresolved = Array.isArray(intent?.unresolvedRoleIndices) ? intent.unresolvedRoleIndices : [];
    const editableRoleIndices = intent?.imageCount > 1
      ? Array.from({ length: intent.imageCount - 1 }, (_, index) => index + 1)
      : [];
    const roleFields = editableRoleIndices.map((index) => {
      const item = state.images[index];
      const options = artReferenceRoleOptions(index).filter(([value]) => value !== "subject");
      const unresolvedHint = unresolved.includes(index) ? "（请确认）" : "";
      return `<label class="novaflow-smart-ai-advanced-field"><span>${escapeSmartAiHtml(item?.label || `图${index + 1}`)} 的用途${unresolvedHint}</span>
        <select class="novaflow-smart-ai-reference-role-select" data-smart-ai-reference-role="${index}">${options.map(([value, label]) => `<option value="${value}" ${state.referenceRoles[index] === value ? "selected" : ""}>${label}</option>`).join("")}</select>
      </label>`;
    }).join("");
    return roleFields ? `<div class="novaflow-smart-ai-section"><div class="novaflow-smart-ai-label">参考图用途</div>${roleFields}</div>` : "";
  }

  function rememberArtEngine(engine) {
    const normalized = window.NovaFlowSmartAiArtAutoIntent?.normalizeProvider?.(engine)
      || (String(engine || "") === "grok" ? "grok" : "local");
    state.engine = normalized;
    window.NovaFlowSmartAiArtAutoIntent?.writeProviderPreference?.(window.localStorage, normalized);
  }

  function syncArtGenerateMode(intent) {
    if (state.context?.surface !== "art" || !intent?.generationMode) return true;
    const target = intent.generationMode === "img2img" ? "img2img" : "txt2img";
    const current = readArtGenerateMode(state.context?.button);
    if (current === target) {
      state.context.artGenerateMode = target;
      return true;
    }
    const setter = window.__NovaFlowArtGenerate?.setMode;
    if (typeof setter !== "function") return false;
    try {
      setter(target);
    } catch {
      return false;
    }
    if (readArtGenerateMode(state.context?.button) !== target) return false;
    state.context.artGenerateMode = target;
    return true;
  }

  function renderArtStarterPresets() {
    if (state.context?.surface !== "art" || state.mode !== "optimize") return "";
    return `
      <div class="novaflow-smart-ai-section">
        <div class="novaflow-smart-ai-label">快速开始（可选）</div>
        <div class="novaflow-smart-ai-preset-grid">${ART_STARTER_PRESETS.map(([value, label]) => `
          <button type="button" class="novaflow-smart-ai-preset" data-smart-ai-preset="${value}" data-active="${state.starterPreset === value ? "1" : "0"}">${label}</button>
        `).join("")}</div>
      </div>
    `;
  }

  function selectedArtStarterLabel() {
    return ART_STARTER_PRESETS.find(([value]) => value === state.starterPreset)?.[1] || "";
  }

  function renderSmartAiChips(items, activeValues, attribute, single = false) {
    const selected = single ? [String(activeValues || "")] : (Array.isArray(activeValues) ? activeValues : []);
    return `<div class="novaflow-smart-ai-chip-grid">${items.map(([value, label]) => `
      <button type="button" class="novaflow-smart-ai-chip" ${attribute}="${value}" data-active="${selected.includes(value) ? "1" : "0"}">${label}</button>
    `).join("")}</div>`;
  }

  function artTaskDefaultRoles(task, count) {
    const templates = {
      create: [],
      preserve: ["subject", "material", "color"],
      transfer: ["subject", "style", "color"],
      pose: ["subject", "pose", "composition"],
      background: ["subject", "background", "composition"],
      combine: ["subject", "style", "background"]
    };
    const template = templates[task] || templates.preserve;
    return Array.from({ length: count }, (_, index) => template[index] || "composition");
  }

  function ensureArtReferenceRoles(task = state.artTask) {
    const defaults = artTaskDefaultRoles(task, state.images.length);
    state.referenceRoles = Array.from({ length: state.images.length }, (_, index) => (
      ART_REFERENCE_ROLES.some(([value]) => value === state.referenceRoles[index])
        ? state.referenceRoles[index]
        : defaults[index]
    ));
  }

  function applyArtTaskDefaults(task) {
    state.artTask = task;
    state.referenceRoles = artTaskDefaultRoles(task, state.images.length);
    if (task === "transfer" && state.images.length > 1) state.artStyle = "reference";
    if (task !== "transfer" && state.artStyle === "reference" && !state.referenceRoles.includes("style")) state.artStyle = "original";
  }

  function renderArtReferenceSummary() {
    if (!state.images.length) {
      const guides = {
        create: "当前不需要参考图；选择资产类型与风格后即可从零创作。",
        preserve: "请上传图1作为主图 / 原图。",
        transfer: "请上传图1作为主图 / 原图，图2作为风格参考。",
        pose: "请上传图1作为人物主图，图2作为姿势参考。",
        background: "请上传图1作为主体主图，图2作为背景 / 环境参考。",
        combine: "请上传图1主体、图2风格、图3背景；上传后可直接调整每张图的职责。"
      };
      return `<div class="novaflow-smart-ai-context-note">${guides[state.artTask] || guides.create}</div>`;
    }
    return `<div class="novaflow-smart-ai-task-summary">${state.images.map((item, index) => `
      <label class="novaflow-smart-ai-reference-role-row"><span>${item.label || `图${index + 1}`}</span>
        <select class="novaflow-smart-ai-reference-role-select" data-smart-ai-reference-role="${index}">${artReferenceRoleOptions(index).map(([value, label]) => `<option value="${value}" ${state.referenceRoles[index] === value ? "selected" : ""}>${label}</option>`).join("")}</select>
      </label>
    `).join("")}</div>`;
  }

  function artReferenceRoleOptions(index) {
    const excludedByAsset = {
      character: ["ui_layout"],
      scene: ["pose", "ui_layout"],
      game_ui: ["pose"],
      icon_prop: ["pose", "ui_layout"],
      vfx: ["pose", "ui_layout"],
      poster: ["pose", "ui_layout"]
    };
    const excluded = excludedByAsset[state.starterPreset] || ["ui_layout"];
    const currentRole = state.referenceRoles[index];
    return ART_REFERENCE_ROLES.filter(([value]) => !excluded.includes(value) || value === currentRole);
  }

  function renderArtDesignControls() {
    if (state.context?.surface !== "art" || state.mode !== "optimize") return "";
    const isImg2Img = state.context?.artGenerateMode === "img2img";
    const hasImages = state.images.length > 0;
    const stylePresets = isImg2Img
      ? ART_STYLE_PRESETS.filter(([value]) => value !== "auto")
      : ART_STYLE_PRESETS.filter(([value]) => !["original", "reference"].includes(value));
    if (!isImg2Img) {
      return `
        <div class="novaflow-smart-ai-section"><div class="novaflow-smart-ai-label">目标风格</div>${renderSmartAiChips(stylePresets, state.artStyle, "data-smart-ai-style", true)}</div>
      `;
    }
    const img2ImgTasks = ART_TASK_PRESETS.filter(([value]) => value !== "create");
    return `
      <div class="novaflow-smart-ai-section"><div class="novaflow-smart-ai-label">你想完成什么</div>${renderSmartAiChips(img2ImgTasks, state.artTask, "data-smart-ai-task", true)}</div>
      <div class="novaflow-smart-ai-section"><div class="novaflow-smart-ai-label">参考图将这样使用</div>${renderArtReferenceSummary()}</div>
      ${(state.artTask === "background" || state.artTask === "combine") ? `<div class="novaflow-smart-ai-section"><div class="novaflow-smart-ai-label">背景处理</div>${renderSmartAiChips(ART_BACKGROUND_MODES, state.backgroundMode, "data-smart-ai-background", true)}</div>` : ""}
      <div class="novaflow-smart-ai-section"><div class="novaflow-smart-ai-label">目标风格</div>${renderSmartAiChips(stylePresets, state.artStyle, "data-smart-ai-style", true)}</div>
      ${hasImages ? `<div class="novaflow-smart-ai-section"><div class="novaflow-smart-ai-label">保留程度</div>${renderSmartAiChips([["high", "高度保留"], ["medium", "适度调整"], ["rebuild", "允许重构"]], state.preserveLevel, "data-smart-ai-preserve", true)}</div>` : ""}
    `;
  }

  function artReferenceRoleLabel(value) {
    return ART_REFERENCE_ROLES.find(([key]) => key === value)?.[1] || "参考图";
  }

  function artStyleInstruction() {
    return ART_STYLE_PRESETS.find(([key]) => key === state.artStyle)?.[2] || "";
  }

  function artExplicitOutlineRequested() {
    return window.NovaFlowArtQualityProfile?.hasExplicitFlatStyle?.(state.requirements, state.artStyle) === true;
  }

  function artNeedsHighQualityCgGuard() {
    if (artExplicitOutlineRequested()) return false;
    if (["anime", "2_5d", "game_cg"].includes(state.artStyle)) return true;
    return /真人.{0,8}(?:转|改|重绘).{0,8}(?:二次元|动漫|2\.5D|游戏\s*CG)|(?:二次元|动漫|2\.5D|游戏\s*CG).{0,8}(?:重绘|风格化)/i.test(String(state.requirements || ""));
  }

  function artHighQualityCgRenderingGuardInstruction(options = {}) {
    const needsGuard = options.textOnly === true
      ? /真人.{0,8}(?:转|改|重绘).{0,8}(?:二次元|动漫|2\.5D|游戏\s*CG)|(?:二次元|动漫|2\.5D|游戏\s*CG).{0,8}(?:重绘|风格化)/i.test(String(state.requirements || ""))
      : artNeedsHighQualityCgGuard();
    if (!needsGuard) return "";
    return "高质量CG渲染约束：若主图是真人照片，保留人物身份、脸型、发型、可见外观状态、姿势、镜头关系与场景结构，不保留摄影媒介；必须彻底重绘材质、体积与光影，禁止在照片上叠加漫画描边滤镜。轮廓主要依靠明暗、色彩、材质、景深与柔和边缘建立，边缘干净自然、与整体画风一致；皮肤、头发、原图已有材质与环境必须具有可信层次，达到高品质二次元游戏宣传CG完成度。";
  }

  function artHighQualityCgNegativeGuardInstruction(options = {}) {
    const textOnly = options.textOnly === true;
    const sharedProfile = window.NovaFlowArtQualityProfile?.build?.({
      prompt: state.requirements,
      assetType: state.starterPreset,
      style: textOnly ? "auto" : state.artStyle
    });
    if (sharedProfile) return sharedProfile.negativeInstruction;
    const needsGuard = textOnly
      ? /真人.{0,8}(?:转|改|重绘).{0,8}(?:二次元|动漫|2\.5D|游戏\s*CG)|(?:二次元|动漫|2\.5D|游戏\s*CG).{0,8}(?:重绘|风格化)/i.test(String(state.requirements || ""))
      : artNeedsHighQualityCgGuard();
    if (!needsGuard) return "";
    return "粗黑描边，统一黑色外轮廓，厚重墨线，漫画勾线，简笔线稿，扁平赛璐璐，色块断层，海报化色阶，低细节头发，蜡像皮肤，塑料质感，过度锐化，照片滤镜式动漫化，低完成度插画";
  }

  function mergeSmartAiNegativePrompt(base, addition) {
    const parts = String(base || "").split(/[，,]/).map((item) => item.trim()).filter(Boolean);
    String(addition || "").split(/[，,]/).map((item) => item.trim()).filter(Boolean).forEach((item) => {
      if (!parts.some((existing) => existing.toLowerCase() === item.toLowerCase())) parts.push(item);
    });
    return parts.join("，");
  }

  function artStylePriorityInstruction() {
    const isExplicitPreset = !["original", "reference"].includes(state.artStyle);
    if (!isExplicitPreset || !state.referenceRoles.includes("style")) return "";
    return "风格优先级：明确选择的目标风格预设优先；风格参考图只补充笔触、材质与光影细节，不得覆盖目标风格。";
  }

  function artAssetPreservationInstruction() {
    if (!state.images.length) {
      const creationInstructions = {
        character: "角色创作约束：建立清晰身份与稳定比例，只落实用户明确指定的外观元素、配饰和核心道具，不主动补充未要求的穿着内容，并保持设定一致。",
        scene: "场景创作约束：建立清楚的前中后景、主体地标、视线引导、尺度关系和可用空间。",
        game_ui: "游戏 UI 创作约束：建立清晰的信息层级、按钮状态、功能分区、文字安全区与可执行的交互结构。",
        icon_prop: "图标道具创作约束：确保外轮廓清晰、功能可识别、视角统一并适合实际资产落地。",
        vfx: "特效创作约束：明确效果类型、运动方向、核心形状、节奏层级与透明边缘。",
        poster: "宣传海报创作约束：建立主视觉层级、标题安全区、人物与文案位置关系，并保证信息可读。"
      };
      return creationInstructions[state.starterPreset] || "从零创作约束：主体明确、构图完整、风格统一、细节可控，并达到可用资产完成度。";
    }
    const instructions = {
      character: "角色资产约束：主图决定人物身份、脸型、发型、可见外观状态、标志性特征与核心道具；除非用户明确要求，不得新增、替换、遮盖或遗漏。",
      scene: "场景资产约束：保留主图的空间层级、主体地标、视线引导与尺度关系；风格参考不得改写场景内容。",
      game_ui: "游戏 UI 约束：主图决定布局层级、按钮位置、功能分区、信息密度与文字安全区；只允许重绘视觉语言，不得擅自增删功能或改变交互结构。",
      icon_prop: "图标道具约束：保留主图的外轮廓、功能结构、识别特征与视角；风格参考只改变表现语言。",
      vfx: "特效资产约束：保留效果类型、运动方向、核心形状、节奏层级与透明边缘，不引入无关实体。",
      poster: "宣传海报约束：保留主视觉层级、标题安全区、人物与文案位置关系；风格变化不得破坏信息可读性。"
    };
    return instructions[state.starterPreset] || "通用保留约束：主图决定内容与身份，其他参考图只提供被指定的单一维度。";
  }

  function artBackgroundInstruction() {
    if (state.artTask !== "background" && state.artTask !== "combine") return "";
    const instructions = {
      replace: "背景处理：使用背景参考替换主图环境，保持主图主体完整，并统一透视、尺度、光向、色温与接触阴影。",
      borrow: "背景处理：只借用背景参考的环境类型、氛围、光色与空间特征，不复制其中的人物、前景物件或固定构图。",
      preserve: "背景处理：保留主图原背景，只允许做与主体一致的质感、光色和细节提升。",
      blend: "背景处理：融合主图与背景参考的环境要素，主图主体优先，避免双重主体、拼贴边缘与透视冲突。"
    };
    return instructions[state.backgroundMode] || instructions.replace;
  }

  function artAutomaticQualityInstruction() {
    return "基础质量由系统自动负责：先识别当前资产类型并使用匹配的提升方式。人物增强面部、眼睛、头发、皮肤、人体结构和原图已有材质的可信细节，不主动新增穿着或装饰内容；物体和道具增强金属、木材、皮革、玻璃、布料等材质差异与结构质感；场景增强空间层次、建筑、地面、植被与环境光影；游戏 UI、图标和海报增强信息层级、边缘与装饰材质；二次元、Q版和厚涂保持原有绘画语言，只提高绘制完成度。自动避免模糊、噪点、结构错误、过度锐化、塑料质感与无意义细节，不要求用户重复选择基础质量项。";
  }

  function validateArtDesignState() {
    if (state.context?.surface !== "art" || state.mode !== "optimize") return "";
    if (state.context?.artGenerateMode === "img2img" && !state.images.length) return "图生图需要先上传至少一张主图 / 原图";
    const roles = state.referenceRoles.slice(0, state.images.length);
    if (state.images.length && !roles.includes("subject")) return "请至少把一张参考图设为“主图 / 原图”";
    if (state.artTask !== "create" && !state.images.length) return "这个任务需要先上传主图；如需无图生成，请选择“从零创作”";
    if (state.artTask === "transfer" && state.images.length > 1 && !roles.includes("style")) return "更换画面风格需要把一张图设为“风格参考”";
    if (state.artStyle === "reference" && !roles.includes("style")) return "选择“跟随风格图”前，请先添加或指定一张风格参考图";
    if (state.artTask === "pose" && !roles.includes("pose")) return "更换人物姿势需要添加或指定一张姿势参考图";
    if (state.artTask === "background" && state.backgroundMode !== "preserve" && !roles.includes("background")) return "当前背景模式需要添加或指定一张背景 / 环境参考图";
    if (state.artTask === "combine" && state.images.length < 2) return "多参考图组合至少需要两张参考图";
    return "";
  }

  function stripTrailingGenericArtPreservation(value) {
    const source = String(value || "").replace(/\r\n?/g, "\n").trim();
    if (!source) return "";
    const genericPreservation = /^(?:(?:保留|保持|维持)(?:原有|当前)?(?:主体(?:身份)?|角色(?:身份)?|人物(?:身份)?|整体构图|镜头构图|构图|画面布局|整体布局)(?:(?:与|和|及|以及)(?:主体(?:身份)?|角色(?:身份)?|人物(?:身份)?|整体构图|镜头构图|构图|画面布局|整体布局))?(?:不变|一致)?|(?:keep|preserve|retain|maintain)(?: the)? (?:subject(?: identity)?|character identity|overall composition|camera composition|composition|image layout|layout)(?: and (?:subject(?: identity)?|character identity|overall composition|camera composition|composition|image layout|layout))?(?: unchanged)?)$/iu;
    const operationStart = "(?:保留|保持|维持|增强|提升|增加|添加|补充|降低|减少|弱化|去除|删除|修改|调整|改为|改成|替换|keep|preserve|retain|maintain|enhance|improve|increase|add|reduce|decrease|remove|change|modify|adjust|replace)";
    const connectorBeforeOperation = new RegExp(`(?:并且|同时|以及|然后|\\b(?:and|also|then)\\b)(?=\\s*${operationStart})`, "giu");
    const clauses = source
      .split(/[，,；;。.!！？?\n]+/u)
      .flatMap((segment) => segment.split(connectorBeforeOperation))
      .map((clause) => clause.replace(/^(?:并且|同时|以及|然后|(?:and|also|then)\b)\s*/iu, "").trim())
      .filter(Boolean);
    const actionable = clauses.filter((clause) => !genericPreservation.test(clause));
    return actionable.length ? actionable.join("；") : source;
  }

  function shouldUseStructuredArtPromptContract(currentPrompt) {
    const source = String(currentPrompt || "").trim();
    // Only recompile an existing machine-structured prompt. Preserve the
    // format of ordinary prose and handwritten section headings.
    return /^媒介\s*=/mu.test(source) && /^主体数量\s*=\s*\d+/mu.test(source)
      && ["风格设定", "主体物品", "环境背景", "光线与色彩", "拍摄参数", "用户附加要求"]
        .every((section) => source.includes(`[${section}]`));
  }

  function shouldUseSimpleStructuredArtPromptContract(currentPrompt) {
    const source = String(currentPrompt || "").trim();
    if (!source || source.length > 120 || /[\r\n]/u.test(source)) return false;
    if (/__NOVAFLOW_[A-Z0-9_:-]+__/iu.test(source)) return false;
    if (/@(?:参考图[1-9][0-9]*|视频参考|声音参考)/u.test(source)) return false;
    return !/\[[^\]\r\n]{1,32}\]|\u3010[^\u3011\r\n]{1,32}\u3011/u.test(source);
  }

  function buildSmartAiRequirements(options = {}) {
    const requirements = String(state.requirements || "").trim();
    const includeUserIntent = options.includeUserIntent !== false;
    const userIntentFirst = options.userIntentFirst === true;
    const purpose = String(options.purpose || "").trim();
    const modelFacingRequirements = purpose === "optimize"
      ? stripTrailingGenericArtPreservation(requirements)
      : requirements;
    const userIntentInstruction = includeUserIntent && modelFacingRequirements
      ? (userIntentFirst
        ? `用户本次${purpose === "optimize" ? "修改" : "创作"}要求（最高优先级）：${modelFacingRequirements}`
        : modelFacingRequirements)
      : "";
    const textOperationInstruction = purpose === "optimize"
      ? "提示词编辑模式：以 prompt / currentPrompt 中的完整原提示词为语义底稿，先分析原画面设定，再把本次补充要求融合成连贯的最终画面描述。明确修改与原文冲突时以新要求为准，清理冲突旧描述；人物、数量、身份、年龄、五官差异、服装、姿势、互动、构图、材质、风格、质量要求、避免项及其他未提及信息必须保留。提升丰富度、质感或质量等开放要求，应结合底稿已有对象，具体落实空间层次、材质纹理、光影过渡等适合原画风的视觉细节；不要仅追加质量词或照抄修改要求，不要凭空增加人物、道具或改变主题。没有补充要求时，主动分析表达缺口并优化。输出必须是修改后的完整可生图提示词，禁止只输出修改建议、摘要或单个局部描述。"
      : purpose === "create"
        ? "提示词创作模式：当前没有原提示词；根据用户创作要求输出一份完整、可直接生图的提示词，禁止只输出建议或摘要。"
        : "";
    if (state.context?.surface !== "art" || state.mode !== "optimize") return requirements;
    const sharedQualityProfile = window.NovaFlowArtQualityProfile?.build?.({
      prompt: modelFacingRequirements,
      assetType: state.starterPreset,
      style: "auto",
      mode: "txt2img"
    });
    return [
      userIntentFirst ? userIntentInstruction : "",
      textOperationInstruction,
      sharedQualityProfile?.directorInstruction || artHighQualityCgRenderingGuardInstruction({ textOnly: true }),
      artAutomaticQualityInstruction(),
      !userIntentFirst ? userIntentInstruction : ""
    ].filter(Boolean).join("\n");
  }

  function renderEngineOptions() {
    return `
      <div class="novaflow-smart-ai-section">
        <div class="novaflow-smart-ai-label">处理方式</div>
        <div class="novaflow-smart-ai-engine-row">
          <label class="novaflow-smart-ai-engine-option">
            <input type="radio" name="novaflow-smart-ai-engine" value="grok" ${state.engine === "grok" ? "checked" : ""}>
            <span>Grok AI<span class="novaflow-smart-ai-engine-meta">云端 · 深度处理</span></span>
          </label>
          <label class="novaflow-smart-ai-engine-option">
            <input type="radio" name="novaflow-smart-ai-engine" value="local" ${state.engine === "local" ? "checked" : ""}>
            <span>本地模型<span class="novaflow-smart-ai-engine-meta">本地 · 耗时取决于模型与显卡</span></span>
          </label>
        </div>
      </div>
    `;
  }

  function renderAnimationProcessingNote() {
    if (state.context?.surface === "art") return "";
    let note = "只设计并写入提示词，不会直接生成视频";
    const captured = state.context?.miniMaxH3;
    if (state.mode === "optimize" && captured?.modelId === MINIMAX_H3_MODEL_ID
      && ["image_video", "first_last", "multi_reference"].includes(captured.mode)) {
      const labels = (captured.resources || [])
        .filter((resource) => resource?.occupied)
        .map((resource) => String(resource.label || resource.key || ""))
        .filter(Boolean);
      const hasPrompt = Boolean(String(getPromptTextareasFromContext(state.context).positive?.value || "").trim());
      note += labels.length
        ? `。将参考已上传的 ${labels.join("、")}${hasPrompt ? "" : "；提示词为空，将按补充要求编写"}`
        : "";
    }
    return `<div class="novaflow-smart-ai-context-note">${escapeSmartAiHtml(note)}</div>`;
  }

  // The assistant always works from words the user wrote: the prompt box or 补充要求.
  function smartAiUserTextMissing() {
    const prompt = String(getPromptTextareasFromContext(state.context).positive?.value || "").trim();
    return !prompt && !String(state.requirements || "").trim();
  }

  // One submit rule for the render and for the live re-check while typing.
  function smartAiSubmitBlocked(artIntent) {
    if (smartAiUserTextMissing()) return true;
    const isMiniMaxH3 = state.context?.miniMaxH3?.modelId === MINIMAX_H3_MODEL_ID;
    // Art and the plain animation dialog pick their route from the references, so they wait for them.
    if (state.imagesLoading && (!isMiniMaxH3 || state.mode === "reverse")) return true;
    if (state.mode !== "reverse") return false;
    if (state.context?.surface === "art") return artIntent?.hasReferences !== true;
    return isMiniMaxH3
      ? miniMaxH3ReverseCapability()?.supportsReverse !== true || Boolean(state.miniMaxH3ReverseError)
      : !state.images.length;
  }

  function renderMiniMaxH3SensitiveAnalysisControls() {
    return "";
  }

  function renderImageTargets() {
    if (state.mode !== "reverse") return "";
    if (state.context?.miniMaxH3?.modelId === MINIMAX_H3_MODEL_ID) {
      if (state.imagesLoading) {
        return `<div class="novaflow-smart-ai-context-note">正在读取当前模式的参考图...</div>`;
      }
      if (state.miniMaxH3ReverseError) {
        return `<div class="novaflow-smart-ai-context-note">${escapeSmartAiHtml(state.miniMaxH3ReverseError)}</div>`;
      }
      const capability = miniMaxH3ReverseCapability();
      if (capability?.reverseKind === "first_last_transition") {
        return `<div class="novaflow-smart-ai-context-note">将严格按首帧、尾帧顺序分析连续动作</div>`;
      }
      if (capability?.reverseKind === "single_image_motion") {
        return `<div class="novaflow-smart-ai-context-note">将仅分析当前图生视频参考图</div>`;
      }
      return `<div class="novaflow-smart-ai-context-note">当前 H3 模式不支持参考图反推</div>`;
    }
    if (state.imagesLoading) {
      return `<div class="novaflow-smart-ai-context-note">正在读取参考图...</div>`;
    }
    const scenario = getImageScenario(state.images);
    if (scenario === "none") {
      return `<div class="novaflow-smart-ai-context-note">${state.context?.surface === "art" ? "当前没有可用参考图" : "请先添加参考图、首帧或尾帧"}</div>`;
    }
    if (scenario === "video_frames") {
      return `<div class="novaflow-smart-ai-context-note">${state.context?.surface === "art" ? "已识别首帧 + 尾帧，将生成视频连续动作 Prompt" : "已识别首帧 + 尾帧，将分析连续动作"}</div>`;
    }
    if (scenario !== "multi_reference") {
      return `<div class="novaflow-smart-ai-context-note">${state.context?.surface === "art" ? "已识别单张参考图" : "已识别单张参考图，将生成图生视频提示词"}</div>`;
    }
    const radios = state.images.map((item, index) => `
      <label class="novaflow-smart-ai-radio">
        <input type="radio" name="novaflow-smart-ai-target" value="${index}" ${index === state.targetIndex ? "checked" : ""}>
        <span>${item.label || `图${index + 1}`}</span>
      </label>
    `).join("");
    return `
      <div class="novaflow-smart-ai-section">
        <div class="novaflow-smart-ai-label">目标图片</div>
        <div class="novaflow-smart-ai-targets">${radios}</div>
      </div>
    `;
  }

  function escapeSmartAiHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function smartAiMetadataText(value) {
    if (value == null || value === "") return "";
    if (Array.isArray(value)) return value.map(smartAiMetadataText).filter(Boolean).join("、");
    if (typeof value === "object") {
      const preferred = value.message ?? value.label ?? value.value ?? value.code;
      if (preferred != null && preferred !== value) return smartAiMetadataText(preferred);
      return Object.entries(value).map(([key, item]) => `${key}: ${smartAiMetadataText(item)}`).filter((item) => !item.endsWith(": ")).join("；");
    }
    const normalized = String(value).trim();
    const labels = {
      safe: "安全",
      suggestive: "性感暗示",
      explicit: "露骨成人内容",
      adult: "成年人",
      minor: "未成年人",
      age_ambiguous: "年龄不明确",
      age_unverifiable: "无法仅凭画面核实年龄",
      young_or_minor_indicators: "存在年轻或未成年人特征",
      ambiguous_or_young_appearing: "年龄不明确或外观偏年轻",
      unknown: "无法判断"
    };
    return labels[normalized.toLowerCase()] || normalized;
  }

  function smartAiSafetyLabel(key) {
    return ({
      rating: "内容级别",
      level: "内容级别",
      classification: "内容级别",
      nudity: "裸露程度",
      bodyExposure: "身体暴露",
      body_exposure: "身体暴露",
      sexualContent: "成人内容",
      sexual_content: "成人内容",
      interactionCategory: "互动类型",
      interaction_category: "互动类型",
      ageAssessment: "年龄判断",
      age_assessment: "年龄判断",
      ageStatus: "年龄判断",
      age_status: "年龄判断",
      visiblePersonCount: "可见人物数量",
      visible_person_count: "可见人物数量",
      signals: "风险信号",
      allowed: "允许编译",
      blocked: "编译阻止"
    })[key] || (/^[a-z][a-z0-9_-]*$/i.test(String(key || "")) ? "其他风险信息" : key);
  }

  function smartAiSafetyValue(value) {
    if (value == null || value === "") return "未标注";
    if (Array.isArray(value)) return value.map(smartAiSafetyValue).filter(Boolean).join("、");
    if (typeof value === "object") {
      return Object.entries(value).map(([key, item]) => `${smartAiSafetyLabel(key)}：${smartAiSafetyValue(item)}`).join("；");
    }
    if (typeof value === "boolean") return value ? "是" : "否";
    const normalized = String(value).trim();
    const labels = {
      safe: "安全",
      suggestive: "性感暗示",
      explicit: "露骨成人内容",
      nudity: "存在裸露",
      full: "完全裸露",
      partial: "部分裸露",
      sexual: "性相关内容",
      adult: "成年人",
      adult_appearing: "视觉上偏成年",
      age_ambiguous: "年龄不明确",
      age_unverifiable: "无法仅凭画面核实年龄",
      young_or_minor_indicators: "存在年轻或未成年人特征",
      ambiguous_or_young_appearing: "年龄不明确或外观偏年轻",
      minor: "未成年人",
      not_applicable: "不适用",
      none: "无",
      uncertain: "无法确定",
      intimate: "亲密互动",
      unknown: "无法判断",
      visible_nudity: "可见裸露",
      genital_exposure: "敏感部位裸露",
      breast_exposure: "胸部裸露",
      sexualized_pose: "性暗示姿势",
      explicit_activity: "露骨性行为",
      explicit_anatomy: "露骨敏感部位",
      sexual_fluid: "性相关体液",
      explicit_sexual_activity: "露骨性行为",
      sexual_activity: "性行为",
      sexual_contact: "性接触",
      suggestive_pose: "性暗示姿势",
      fetish_content: "特殊性偏好内容",
      sensitive_prompt_nsfw_disabled: "当前未开启 NSFW，敏感生成提示词未编译",
      sensitive_prompt_age_unconfirmed: "画面年龄无法独立核实",
      sensitive_prompt_minor_requirements: "附加要求包含明确未成年人内容"
    };
    const mapped = labels[normalized.toLowerCase()];
    if (mapped) return mapped;
    return /^[a-z][a-z0-9_-]*$/i.test(normalized) ? "其他已标记风险" : normalized;
  }

  function isSmartAiExplicitAgeAmbiguous(contentSafety) {
    const level = String(contentSafety?.level ?? contentSafety?.classification ?? contentSafety?.rating ?? "").trim().toLowerCase();
    const age = String(contentSafety?.age_assessment ?? contentSafety?.ageAssessment ?? contentSafety?.age_status ?? contentSafety?.ageStatus ?? "").trim().toLowerCase();
    return ["suggestive", "nudity", "explicit"].includes(level)
      && ["age_ambiguous", "young_or_minor_indicators", "ambiguous_or_young_appearing"].includes(age);
  }

  function smartAiBlockedStatusMessage(result) {
    const contentSafety = result?.contentSafety || {};
    const level = String(contentSafety.level ?? contentSafety.classification ?? contentSafety.rating ?? "").trim().toLowerCase();
    const age = String(contentSafety.age_assessment ?? contentSafety.ageAssessment ?? "").trim().toLowerCase();
    const personCount = Math.max(0, Math.round(Number(contentSafety.visible_person_count ?? contentSafety.visiblePersonCount) || 0));
    const warnings = new Set(Array.isArray(result?.contentWarnings) ? result.contentWarnings : []);
    if (warnings.has("sensitive_prompt_minor_requirements")) {
      return "分析完成—未写入：附加要求包含明确未成年人内容，敏感提示词已阻止。";
    }
    if (warnings.has("sensitive_prompt_nsfw_disabled")) {
      return "分析完成—未写入：分析服务未允许敏感内容编译，请重新分析。";
    }
    if (age === "young_or_minor_indicators") {
      return "分析完成—未写入：检测到年轻或未成年人特征，敏感提示词已阻止。";
    }
    if (isSmartAiExplicitAgeAmbiguous(contentSafety)) {
      return "分析完成—未写入：检测到敏感内容，但人物年龄不明确或外观偏年轻。";
    }
    if (level === "uncertain") {
      return "分析完成—未写入：内容分级无法确定，已仅保留可安全展示的图片事实。";
    }
    if (["suggestive", "nudity", "explicit"].includes(level) && personCount === 0) {
      return "分析完成—未写入：未检测到可确认成年的可见人物，敏感提示词未应用。";
    }
    return "分析完成—未写入：敏感提示词未满足安全编译条件。";
  }

  function smartAiDegradedStatusMessage(result) {
    const code = cleanSmartAiFailureCode(result?.contractFailureCode);
    return `分析不完整—未写入：仅展示可安全显示的中性摘要${code ? `（${code}）` : ""}。请重新分析参考图。`;
  }

  function smartAiPartialStatusMessage(result) {
    if (result?.generationGate === "adult_confirmation") {
      return "分析部分完成。NSFW 候选提示词未自动写入，请重新分析参考图。";
    }
    if (result?.generationGate === "neutral_only") {
      return "分析部分完成。当前仅可应用中性提示词继续。";
    }
    return "分析部分完成—未写入：当前结果只可重新分析参考图。";
  }

  function enableArtGenerateNsfwForSensitivePrompt(context) {
    if (context?.surface !== "art") return true;
    if (readArtGenerateNsfw(context?.button)) return true;
    const setter = window.__NovaFlowArtGenerate?.setNsfw;
    if (typeof setter !== "function") return false;
    try {
      setter(true);
    } catch {
      return false;
    }
    return readArtGenerateNsfw(null);
  }

  function revealSmartAiAnalysisResult(root) {
    const result = root?.querySelector?.(".novaflow-smart-ai-result");
    if (!result || typeof result.scrollIntoView !== "function") return false;
    try {
      result.scrollIntoView({ block: "start", inline: "nearest" });
      return true;
    } catch {
      return false;
    }
  }

  function isSmartAiSensitiveAutoApplyCandidate(result) {
    if (!result
      || result.generationGate !== "adult_confirmation"
      || result.sensitivePromptBlocked
      || result.analysisDegraded === true) return false;
    const contentSafety = result.contentSafety || {};
    const level = String(contentSafety.level ?? contentSafety.classification ?? contentSafety.rating ?? "").trim().toLowerCase();
    const age = String(contentSafety.age_assessment ?? contentSafety.ageAssessment ?? "").trim().toLowerCase();
    const personCount = Math.max(0, Math.round(Number(contentSafety.visible_person_count ?? contentSafety.visiblePersonCount) || 0));
    return ["suggestive", "nudity", "explicit"].includes(level)
      && personCount > 0
      && ["adult_appearing", "age_unverifiable"].includes(age);
  }

  function smartAiSensitiveIntentHasDisallowedYoungOrMinorTerms(value) {
    const normalized = String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!normalized) return false;
    const explicitMinorPattern = /(?:未成年人?|未满\s*(?:18|十八)\s*岁?|(?:18|十八)\s*岁?\s*(?:以下|以内)|(?<![0-9])(?:1[0-7]|[0-9])\s*岁(?![0-9])|青少年|儿童|孩童|小孩|幼女|幼童|幼儿|婴幼儿?|婴儿|萝莉|正太)|(?<![a-z0-9_])(?:underage|minors?|child(?:ren)?|teens?|teenagers?|loli|shota|under\s*18|(?:1[0-7]|[0-9])[-\s]*years?[-\s]*old|(?:1[0-7]|[0-9])\s*y\s*\/?\s*o|aged?\s*(?:1[0-7]|[0-9]))(?![a-z0-9_])/iu;
    if (explicitMinorPattern.test(normalized)) return true;
    const youngMatches = [
      ...normalized.matchAll(/少女|少年|女孩|男孩|年轻|(?<![a-z0-9_])(?:girls?|boys?|young|youth(?:ful)?)(?![a-z0-9_])/giu)
    ];
    if (!youngMatches.length) return false;
    const allAdultContext = /(?:所有|全部|全体|全员)(?:可见的?|画面中(?:的)?|出场的?)?(?:人物|角色|人|参与者)?(?:均|都|皆)?(?:明确)?(?:为|是|设定为)?(?:已)?成年(?:人|男性|女性|角色)?|(?:人物|角色|参与者)(?:全员|全部|全体|均|都|皆)(?:明确)?(?:为|是)?(?:已)?成年|(?<![a-z0-9_])(?:all\s+(?:visible\s+)?(?:people|persons|characters|participants|subjects|figures)\s+(?:are|must\s+be|are\s+depicted\s+as)\s+adults?|adults?\s+only)(?![a-z0-9_])/iu.test(normalized);
    return youngMatches.some((match) => {
      if (allAdultContext) return false;
      const start = Math.max(0, Number(match.index || 0) - 20);
      const end = Math.min(normalized.length, Number(match.index || 0) + String(match[0] || "").length + 20);
      const nearby = normalized.slice(start, end);
      return !/(?:已?成年|年满\s*18\s*岁|18\s*岁\s*(?:以上|及以上)|18\+)|(?<![a-z0-9_])(?:adult|aged\s+18\s*(?:or\s+older|\+)|18\s*(?:or\s+older|\+))(?![a-z0-9_])/iu.test(nearby);
    });
  }

  function smartAiRequirementsContainExplicitMinorTerms(value) {
    const normalized = String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return Boolean(normalized && /(?:未成年人?|未满\s*(?:18|十八)\s*岁?|(?:18|十八)\s*岁?\s*(?:以下|以内)|(?<![0-9])(?:1[0-7]|[0-9])\s*岁(?![0-9])|青少年|儿童|孩童|小孩|幼女|幼童|幼儿|婴幼儿?|婴儿|萝莉|正太)|(?<![a-z0-9_])(?:underage|minors?|child(?:ren)?|teens?|teenagers?|loli|shota|under\s*18|(?:1[0-7]|[0-9])[-\s]*years?[-\s]*old|(?:1[0-7]|[0-9])\s*y\s*\/?\s*o|aged?\s*(?:1[0-7]|[0-9]))(?![a-z0-9_])/iu.test(normalized));
  }

  function smartAiRequirementsContainSensitiveIntent(value) {
    const normalized = String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return Boolean(normalized && (/(?:裸体|裸露|全裸|半裸|一丝不挂|性行为|性交|交合|性爱|性活动|口交|肛交|自慰|手淫|生殖器|性器官|阴茎|阳具|龟头|阴道|外阴|阴唇|阴蒂|阴部|肛门|乳头|乳房|裸身|赤裸身体|精液|性体液|私处|下体|色情|情色|成人内容|性暗示|性感姿势|挑逗姿势|胸部暴露|胸部完全可见|插入(?:阴道|肛门|性器官))|(?<![a-z0-9_])(?:nudity|(?:fully|partially)\s+nude|nude\s+(?:person|woman|man|body|figure|character|portrait)|naked\s+(?:person|woman|man|body|figure|character)|topless|nsfw|porn(?:ographic|ography)?|sexual[_\s-]+(?:activity|act|fluid)|sexualized[_\s-]+pose|suggestive[_\s-]+pose|explicit[_\s-]+(?:activity|anatomy)|intercourse|oral\s+sex|anal\s+sex|masturbat(?:e|ion|ing)|genitals?|penis|vagina|vulva|anus|semen|bare\s+breasts?|exposed\s+breasts?|visible\s+breasts?|breasts?\s+(?:fully\s+)?(?:visible|exposed))(?![a-z0-9_])/iu.test(normalized)
      || /(?<![a-z0-9_])(?:nude|naked)(?![a-z0-9_])/iu.test(normalized)));
  }

  function renderSmartAiAnalysisResult() {
    const result = state.analysisResult;
    if (!result || result.visualSchema !== "nf.visual.v2") return "";
    const isDegraded = result.analysisDegraded === true;
    const isPartial = result.analysisPartial === true;
    const isSensitiveAutoApplyPartial = isPartial && result.generationGate === "adult_confirmation";
    const isNeutralOnlyPartial = isPartial && result.generationGate === "neutral_only";
    const facts = smartAiMetadataText(result.visualPrompt) || "模型未返回独立的图片事实摘要";
    const visiblePersonCount = Math.max(0, Math.round(Number(result.contentSafety?.visible_person_count) || 0));
    const safety = isDegraded
      ? `
          <div class="novaflow-smart-ai-result-row"><span>可见人物数量</span><strong>${escapeSmartAiHtml(visiblePersonCount)}</strong></div>
          <div class="novaflow-smart-ai-result-row"><span>分析状态</span><strong>内容分级未完成</strong></div>
        `
      : result.contentSafety && typeof result.contentSafety === "object"
      ? Object.entries(result.contentSafety).filter(([key]) => !["signals", "sensitive_visible_facts", "sensitiveVisibleFacts"].includes(key)).map(([key, value]) => `
          <div class="novaflow-smart-ai-result-row"><span>${escapeSmartAiHtml(smartAiSafetyLabel(key))}</span><strong>${escapeSmartAiHtml(smartAiSafetyValue(value))}</strong></div>
        `).join("")
      : `<div class="novaflow-smart-ai-result-muted">未返回内容分级信息</div>`;
    const warningTags = [
      ...(Array.isArray(result.contentWarnings) ? result.contentWarnings : []),
      ...(Array.isArray(result.contentSafety?.signals) ? result.contentSafety.signals : [])
    ];
    const warnings = Array.from(new Set(warningTags.map((item) => String(item || "").trim()).filter(Boolean)))
      .map(smartAiSafetyValue)
      .filter(Boolean);
    const explicitAgeAmbiguous = isSmartAiExplicitAgeAmbiguous(result.contentSafety);
    if (isDegraded) warnings.unshift("分析结果不完整，仅展示中性摘要；不会应用敏感提示词，也不会写入生成提示词。");
    else if (isSensitiveAutoApplyPartial) warnings.unshift("NSFW 候选提示词未自动写入；请检查生成面板后重新分析。");
    else if (isNeutralOnlyPartial) warnings.unshift("当前结果仅可应用中性提示词继续。");
    else if (isPartial) warnings.unshift("部分分析结果已阻止写入，只可重新分析参考图。");
    else if (explicitAgeAmbiguous) warnings.unshift("检测到敏感内容，但人物年龄不明确或外观偏年轻；敏感内容未编译、未展示，也未写入生成提示词。");
    else if (result.sensitivePromptBlocked) warnings.unshift("敏感内容未编译、未展示，也未写入生成提示词。");
    const warningHtml = warnings.length
      ? `<div class="novaflow-smart-ai-result-warnings">${warnings.map((warning, index) => `<div>${isDegraded && index === 0 ? "未写入说明：" : ""}${escapeSmartAiHtml(warning)}</div>`).join("")}</div>`
      : `<div class="novaflow-smart-ai-result-muted">未发现需要提示的内容风险</div>`;
    const requirements = smartAiMetadataText(result.generationRequirements) || "无额外生成约束";
    return `
      <div class="novaflow-smart-ai-result" data-smart-ai-visual-schema="nf.visual.v2">
        <section data-smart-ai-result-section="facts">
          <div class="novaflow-smart-ai-result-title">${isDegraded || isPartial ? "中性图片事实" : "图片事实"}</div>
          <div class="novaflow-smart-ai-result-copy">${escapeSmartAiHtml(facts)}</div>
        </section>
        <section data-smart-ai-result-section="safety">
          <div class="novaflow-smart-ai-result-title">${isDegraded ? "分析状态" : "内容级别与风险"}</div>
          <div class="novaflow-smart-ai-result-safety">${safety}</div>
          ${warningHtml}
        </section>
        ${isDegraded || isPartial ? "" : `<section data-smart-ai-result-section="constraints">
          <div class="novaflow-smart-ai-result-title">生成与质量约束</div>
          <details class="novaflow-smart-ai-result-details">
            <summary>展开查看约束</summary>
            <div class="novaflow-smart-ai-result-copy">${escapeSmartAiHtml(requirements)}</div>
          </details>
        </section>`}
      </div>
    `;
  }

  function renderDialog() {
    if (!state.open) return;
    injectStyle();
    let root = document.getElementById(ROOT_ID);
    if (!(root instanceof HTMLElement)) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.setAttribute("data-novaflow-runtime-ignore", "1");
      document.body?.appendChild(root);
      root.addEventListener("pointerdown", (event) => {
        if (event.target === root && !state.loading) closeDialog();
      });
    }
    const isArt = state.context?.surface === "art";
    const artIntent = isArt ? syncArtAutoIntent() : null;
    const currentArtPrompt = isArt
      ? String(getPromptTextareasFromContext(state.context).positive?.value || "").trim()
      : "";
    const isMiniMaxH3 = state.context?.miniMaxH3?.modelId === MINIMAX_H3_MODEL_ID;
    const hasPromptText = Boolean(String(getPromptTextareasFromContext(state.context).positive?.value || "").trim());
    // 补充要求 is optional only while the prompt box already says what the user wants.
    const optionalMark = hasPromptText ? "（可选）" : "";
    const requirementsLabel = isMiniMaxH3 ? `H3 补充要求${optionalMark}` : `动作与镜头要求${optionalMark}`;
    const isArtTextEdit = isArt && state.mode === "optimize" && Boolean(currentArtPrompt);
    const requirementsPlaceholder = isArt
      ? (state.mode === "reverse"
        ? "例如：保留参考图中的人物和服装，把背景换成雪夜街景，冷色调灯光。"
        : isArtTextEdit
          ? "例如：背景过于曝光，降低背景高光并恢复层次；主体、服装、动作、构图和整体风格保持不变。"
          : ART_REQUIREMENTS_PLACEHOLDER)
      : isMiniMaxH3
        ? "例如：保留人物身份与对白，强化镜头节奏，并让环境声与动作同步。"
        : ANIMATION_REQUIREMENTS_PLACEHOLDER;
    const artRequirementsLabel = state.mode === "reverse"
      ? (currentArtPrompt ? "补充要求（可选）" : "描述你想要的效果")
      : isArtTextEdit
        ? "说明你希望修改的内容（可选）"
        : "描述你想生成的画面";
    const awaitingNeutralApply = state.pendingApply?.requiresNeutralApply === true;
    const analysisBlocked = state.analysisResult?.visualSchema === "nf.visual.v2"
      && (state.analysisResult?.generationGate === "blocked"
        || state.analysisResult?.analysisDegraded === true);
    const analysisFailed = Boolean(state.analysisFailure);
    const submitDisabled = state.loading || (!awaitingNeutralApply && smartAiSubmitBlocked(artIntent));
    const textNotice = !state.loading && !awaitingNeutralApply && smartAiUserTextMissing()
      ? SMART_AI_TEXT_REQUIRED_MESSAGE
      : "";
    const visibleMessage = state.message || textNotice;
    const submitLabel = awaitingNeutralApply
      ? "应用中性提示词继续"
      : state.loading
      ? "处理中..."
      : (analysisBlocked || analysisFailed)
      ? "重新分析参考图"
      : (isArt
        ? artAutoSubmitLabel(artIntent, currentArtPrompt)
        : (hasPromptText ? "优化并写入提示词" : "生成并写入提示词"));
    root.innerHTML = `
      <div class="novaflow-smart-ai-dialog" role="dialog" aria-modal="true" aria-label="AI 助手">
        <div class="novaflow-smart-ai-header">
          <div class="novaflow-smart-ai-title">AI 助手</div>
          <button type="button" class="novaflow-smart-ai-close" aria-label="关闭">×</button>
        </div>
        <div class="novaflow-smart-ai-body">
          ${renderEngineOptions()}
          ${isArt ? renderArtAutoStatus(artIntent) : ""}
          ${renderAnimationProcessingNote()}
          ${isArt ? "" : renderImageTargets()}
          ${renderMiniMaxH3SensitiveAnalysisControls()}
          <div class="novaflow-smart-ai-section">
            <div class="novaflow-smart-ai-label">${isArt ? artRequirementsLabel : requirementsLabel}</div>
            <textarea class="novaflow-smart-ai-textarea" placeholder="${requirementsPlaceholder.replace(/"/g, "&quot;")}"></textarea>
          </div>
          ${isArt ? renderArtReferenceRoles(artIntent) : ""}
          ${renderSmartAiAnalysisResult()}
        </div>
        <div class="novaflow-smart-ai-message" data-visible="${visibleMessage ? "1" : "0"}" data-tone="${state.messageTone === "error" ? "error" : (state.messageTone === "warning" ? "warning" : "")}" role="${state.messageTone === "error" ? "alert" : "status"}" aria-live="${state.messageTone === "error" ? "assertive" : "polite"}" aria-atomic="true">${escapeSmartAiHtml(visibleMessage)}</div>
        <div class="novaflow-smart-ai-footer" data-single="1">
          <button type="button" class="novaflow-smart-ai-submit" ${submitDisabled ? "disabled" : ""}>${submitLabel}</button>
        </div>
      </div>
    `;
    const dialog = root.querySelector(".novaflow-smart-ai-dialog");
    dialog?.addEventListener?.("pointerdown", (event) => event.stopPropagation());
    if (state.loading) {
      Array.from(root.querySelectorAll("input, textarea, select, button")).forEach((control) => {
        if (!control.classList?.contains("novaflow-smart-ai-close")) control.disabled = true;
      });
    }
    root.querySelector(".novaflow-smart-ai-close")?.addEventListener("click", () => {
      if (!state.loading) closeDialog();
    });
    const textarea = root.querySelector(".novaflow-smart-ai-textarea");
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.value = state.requirements;
      textarea.addEventListener("input", () => {
        state.requirements = textarea.value;
        if (!state.pendingApply) {
          // Live re-check: the button follows the text, and so does the reminder.
          if (state.message === SMART_AI_TEXT_REQUIRED_MESSAGE) state.message = "";
          const intent = isArt ? syncArtAutoIntent() : null;
          const submit = root.querySelector(".novaflow-smart-ai-submit");
          if (submit instanceof HTMLButtonElement) {
            submit.disabled = state.loading || smartAiSubmitBlocked(intent);
            if (isArt) {
              const currentPrompt = String(
                getPromptTextareasFromContext(state.context).positive?.value || ""
              ).trim();
              submit.textContent = artAutoSubmitLabel(intent, currentPrompt);
            }
          }
          const notice = root.querySelector(".novaflow-smart-ai-message");
          if (notice instanceof HTMLElement) {
            const text = state.message || (smartAiUserTextMissing() ? SMART_AI_TEXT_REQUIRED_MESSAGE : "");
            notice.textContent = text;
            notice.setAttribute("data-visible", text ? "1" : "0");
          }
        }
        if (state.analysisResult || state.analysisFailure || state.pendingApply) {
          invalidateSmartAiAnalysis("要求已更改，请重新分析。");
          renderDialog();
        }
      });
    }
    Array.from(root.querySelectorAll('input[name="novaflow-smart-ai-engine"]')).forEach((radio) => {
      radio.addEventListener("change", () => {
        invalidateSmartAiAnalysis();
        state.engine = String(radio.value || "grok") === "local" ? "local" : "grok";
        if (isArt) rememberArtEngine(state.engine);
        state.message = "";
        renderDialog();
      });
    });
    Array.from(root.querySelectorAll("[data-smart-ai-preset]")).forEach((button) => {
      button.addEventListener("click", () => {
        invalidateSmartAiAnalysis();
        const preset = String(button.getAttribute("data-smart-ai-preset") || "");
        state.starterPreset = state.starterPreset === preset ? "" : preset;
        state.message = "";
        renderDialog();
      });
    });
    Array.from(root.querySelectorAll("[data-smart-ai-task]")).forEach((button) => button.addEventListener("click", () => {
      invalidateSmartAiAnalysis();
      applyArtTaskDefaults(String(button.getAttribute("data-smart-ai-task") || "create"));
      state.message = "";
      renderDialog();
    }));
    [["[data-smart-ai-preserve]", "preserveLevel", "data-smart-ai-preserve"], ["[data-smart-ai-background]", "backgroundMode", "data-smart-ai-background"], ["[data-smart-ai-style]", "artStyle", "data-smart-ai-style"]].forEach(([selector, key, attribute]) => {
      Array.from(root.querySelectorAll(selector)).forEach((button) => button.addEventListener("click", () => {
        invalidateSmartAiAnalysis();
        state[key] = String(button.getAttribute(attribute) || "");
        if (key === "artStyle" && state.artStyle === "reference" && state.images.length > 1 && !state.referenceRoles.includes("style")) {
          state.referenceRoles[0] = "subject";
          state.referenceRoles[1] = "style";
        }
        state.message = "";
        renderDialog();
      }));
    });
    Array.from(root.querySelectorAll("[data-smart-ai-reference-role]")).forEach((select) => {
      ["pointerdown", "mousedown", "click"].forEach((eventName) => select.addEventListener(eventName, (event) => event.stopPropagation()));
      select.addEventListener("change", (event) => {
        event.stopPropagation();
        invalidateSmartAiAnalysis();
        const body = root.querySelector(".novaflow-smart-ai-body");
        const scrollTop = body instanceof HTMLElement ? body.scrollTop : 0;
        const index = Math.max(0, Math.round(Number(select.getAttribute("data-smart-ai-reference-role")) || 0));
        if (isArt) {
          state.referenceRoleOverrides[index] = String(select.value || "composition");
          syncArtAutoIntent();
        } else {
          state.referenceRoles[index] = String(select.value || "subject");
          if (state.referenceRoles[index] === "style") state.artStyle = "reference";
          if (state.artStyle === "reference" && !state.referenceRoles.includes("style")) state.artStyle = "original";
        }
        state.message = "";
        renderDialog();
        const nextBody = root.querySelector(".novaflow-smart-ai-body");
        if (nextBody instanceof HTMLElement) nextBody.scrollTop = scrollTop;
        root.querySelector(`[data-smart-ai-reference-role="${index}"]`)?.focus?.({ preventScroll: true });
      });
    });
    Array.from(root.querySelectorAll('input[name="novaflow-smart-ai-target"]')).forEach((radio) => {
      radio.addEventListener("change", () => {
        invalidateSmartAiAnalysis();
        state.targetIndex = Math.max(0, Math.round(Number(radio.value) || 0));
        renderDialog();
      });
    });
    root.querySelector(".novaflow-smart-ai-submit")?.addEventListener("click", runSmartAi);
    if (state.revealAnalysisOnRender) {
      state.revealAnalysisOnRender = false;
      revealSmartAiAnalysisResult(root);
    }
  }

  function buildReverseImagesPayload() {
    const scenario = getImageScenario(state.images);
    if (scenario === "video_frames") {
      const first = state.images.find((item) => /first|首帧/i.test(`${item.role} ${item.slotType} ${item.label}`));
      const last = state.images.find((item) => /last|尾帧/i.test(`${item.role} ${item.slotType} ${item.label}`));
      return {
        scenario,
        sourceCount: state.images.length,
        images: [first, last].filter(Boolean)
      };
    }
    if (scenario === "multi_reference") {
      const target = state.images[Math.max(0, Math.min(state.targetIndex, state.images.length - 1))];
      return {
        scenario,
        sourceCount: state.images.length,
        targetIndex: state.targetIndex,
        images: target ? [target] : []
      };
    }
    return {
      scenario,
      sourceCount: state.images.length,
      targetIndex: 0,
      images: state.images.slice(0, 1)
    };
  }

  function buildRoleReferenceImagesPayload() {
    return {
      scenario: "role_reference",
      sourceCount: state.images.length,
      targetIndex: 0,
      images: state.images.map((item, index) => ({
        imageUrl: item.imageUrl,
        label: item.label || `图${index + 1}`,
        role: state.referenceRoles[index] || "subject",
        slotType: state.referenceRoles[index] || "subject"
      }))
    };
  }

  // 美工 with references: the image routes read the prompt box and 补充要求 together.
  // The cap keeps every requirement built from it (prefixes and the fusion wording
  // included) inside the 2000 characters the transports accept.
  const ART_REFERENCE_USER_TEXT_MAX = 1600;
  function buildArtReferenceUserText(currentPrompt, requirements) {
    const box = String(currentPrompt || "").trim();
    const extra = String(requirements || "").trim();
    if (!box || !extra) return (box || extra).slice(0, ART_REFERENCE_USER_TEXT_MAX);
    const extraLine = `用户补充要求：${extra}`.slice(0, ART_REFERENCE_USER_TEXT_MAX - 16);
    const boxLine = `用户提示词：${box}`.slice(0, ART_REFERENCE_USER_TEXT_MAX - extraLine.length - 1);
    return `${boxLine}\n${extraLine}`;
  }

  function buildStaticArtReverseRequirements(userRequirements) {
    const user = String(userRequirements || "").trim().slice(0, ART_REFERENCE_USER_TEXT_MAX);
    return user
      ? `用户补充要求（只作为最终提示词约束，不作为图片可见事实）：${user}`
      : "";
  }

  function prepareStaticArtReverseFusion(sourcePrompt, userRequirements) {
    const instruction = String(userRequirements || "").trim();
    if (!instruction) return null;
    // The reverse compiler's final section carries requested edits, not image
    // facts. It must not become a preserved constraint during the edit pass.
    const source = String(sourcePrompt || "").replace(/\r\n?/g, "\n").trim();
    const carrier = /\n\s*\[用户附加要求\]\s*\n(?=[\s\S]*用户补充要求（只作为最终提示词约束，不作为图片可见事实）)/u;
    const index = source.search(carrier);
    const basePrompt = (index >= 0 ? source.slice(0, index) : source).trim();
    if (!basePrompt) throw new Error("图片反推未返回可供融合的画面描述，原提示词未修改");
    return {
      basePrompt,
      userInstruction: instruction,
      request: {
        prompt: basePrompt,
        currentPrompt: basePrompt,
        surface: "art",
        purpose: "optimize",
        requirements: `用户本次修改要求（最高优先级）：${instruction.replace(/\r?\n/g, "；")}\n反推后融合：完整原文是已识别的图片画面，补充要求是目标画面的修改意图。先分析并融合全部修改，把最终状态写入相应的背景、人物、光线、材质和镜头段落；新要求与原图描述冲突时替换冲突旧描述，并同步关联段落，不能同时保留互相矛盾的状态。质量与精美度要落实为适合原画风的具体视觉细节，未要求改变的人物身份、数量、服饰、姿态和构图必须保留。不要新增“用户附加要求”段落或复述请求，不要仅把补充要求附在原文末尾。`
      }
    };
  }

  async function fuseStaticArtReversePrompt(sourcePrompt, userRequirements, options) {
    const prepared = prepareStaticArtReverseFusion(sourcePrompt, userRequirements);
    if (!prepared) return null;
    const response = await options.optimize({
      ...prepared.request,
      negativePrompt: options.negativePrompt || "",
      supportsNegativePrompt: options.supportsNegativePrompt === true,
      nsfw: options.nsfw === true
    });
    if (!response || response.ok === false) {
      const failure = readSmartAiFailureEnvelope(response);
      throw Object.assign(new Error(failure.message || "补充要求融合失败，原提示词未修改"), failure);
    }
    const fused = readSmartAiResult(response);
    if (options.supportsNegativePrompt === true && (!fused.hasNegativePrompt || !String(fused.negativePrompt || "").trim())) {
      throw new Error("补充要求融合未返回完整反向提示词，原提示词未修改");
    }
    if (/用户补充要求（只作为最终提示词约束|不作为图片可见事实/u.test(fused.prompt)) {
      throw new Error("模型仍在复述补充要求，未完成画面融合，原提示词未修改");
    }
    const preservation = validateSmartAiArtPromptPreservation(prepared.basePrompt, fused.prompt, prepared.userInstruction);
    if (!preservation.ok) throw smartAiPromptPreservationError(preservation);
    return fused;
  }

  async function runSmartAi() {
    if (state.loading) return;
    if (state.pendingApply?.requiresNeutralApply === true) {
      const pending = state.pendingApply;
      if (pending.requestFingerprint !== buildSmartAiRequestFingerprint()) {
        invalidateSmartAiAnalysis();
        state.message = "原提示词、NSFW 或参考图已变化，旧分析结果已作废，请重新分析。";
        renderDialog();
        return;
      }
      try {
        setPromptTextareasValue(
          getPromptTextareasFromContext(state.context),
          pending.visualPrompt,
          {
            supportsNegativePrompt: false,
            negativePrompt: "",
            hasNegativePrompt: false
          }
        );
        state.pendingApply = null;
        if (state.context?.surface === "art") ART_REFERENCE_PLAN = null;
        closeDialog();
      } catch (err) {
        state.pendingApply = pending;
        state.message = smartAiFailureMessage(err);
        renderDialog();
      }
      return;
    }
    const isArt = state.context?.surface === "art";
    const isOptimizeRequest = state.mode === "optimize";
    const isReverseRequest = state.mode === "reverse";
    const isMiniMaxH3Context = state.context?.miniMaxH3?.modelId === "minimax_h3_local";
    // H3 has one action: optimize, which sees the 图生/首尾帧/多参 frames. 多参 with an
    // empty prompt box writes from the uploads and the 补充要求 through the same pipeline.
    const isMiniMaxH3OptimizeRequest = isMiniMaxH3Context && isOptimizeRequest;
    const isMiniMaxH3ReverseRequest = isMiniMaxH3Context && isReverseRequest;
    const isMiniMaxH3ReferenceReverseRequest = isMiniMaxH3OptimizeRequest
      && state.context?.miniMaxH3?.mode === "multi_reference"
      && !String(getPromptTextareasFromContext(state.context).positive?.value || "").trim();
    const isMiniMaxH3Request = isMiniMaxH3OptimizeRequest || isMiniMaxH3ReverseRequest;
    const useGrok = state.engine === "grok";
    const artIntent = isArt ? syncArtAutoIntent() : null;
    if (artIntent && isReverseRequest && !syncArtGenerateMode(artIntent)) {
      state.message = "无法切换生成模式，请确认 Art 生成面板可用后重试";
      renderDialog();
      return;
    }
    const textareas = getPromptTextareasFromContext(state.context);
    const requestFingerprintOptions = {
      ignoreArtReferenceState: isArt && isOptimizeRequest
    };
    const requestFingerprint = buildSmartAiRequestFingerprint(requestFingerprintOptions);
    const supportsNegativePrompt = isPromptTextControl(textareas.negative);
    const currentPrompt = String(textareas.positive?.value || "").trim();
    const isArtTextRequest = isArt && isOptimizeRequest;
    const artTextPurpose = isArtTextRequest ? (currentPrompt ? "optimize" : "create") : "";
    // Pure local edge edits preserve the entire base. Recompiling six sections
    // adds no value and can reject a valid edit on unrelated model JSON fields.
    const usesLocalSoftEdgeEdit = isArtTextRequest && !useGrok
      && window.NovaFlowArtQualityProfile?.canApplySoftEdgeEdit?.(currentPrompt, state.requirements) === true;
    const usesStructuredArtPromptContract = isOptimizeRequest
      && isArtTextRequest
      && artTextPurpose === "optimize"
      && !isMiniMaxH3Request
      && !usesLocalSoftEdgeEdit
      && shouldUseStructuredArtPromptContract(currentPrompt);
    const usesSimpleStructuredArtPromptContract = usesStructuredArtPromptContract
      && shouldUseSimpleStructuredArtPromptContract(currentPrompt);
    const prompt = isArt
      ? (isArtTextRequest
        ? (artTextPurpose === "optimize" ? currentPrompt : "")
        : buildArtReferenceUserText(currentPrompt, state.requirements))
      : currentPrompt;
    const negativePrompt = String(textareas.negative?.value || "").trim();
    const requirements = buildSmartAiRequirements({
      includeUserIntent: !isArt || isArtTextRequest,
      userIntentFirst: isArtTextRequest,
      purpose: artTextPurpose
    });
    const designError = isArt ? "" : validateArtDesignState();
    const createFromRequirements = isArt && artTextPurpose === "create";
    const isSingleMainPreserveReverse = isArt
      && isReverseRequest
      && artIntent?.route === "static_reverse";
    const usesStaticImageReverse = isArt && (isReverseRequest || isSingleMainPreserveReverse);
    const usesStaticVisualV2 = usesStaticImageReverse && state.images.length === 1;
    const analysisNsfw = usesStaticVisualV2 ? true : (isArt ? readArtGenerateNsfw(state.context?.button) : false);
    const roleAwareReferences = isArt
      && isReverseRequest
      && artIntent?.route === "role_reference";
    if (!isPromptTextControl(textareas.positive)) {
      state.message = "未找到提示词框";
      renderDialog();
      return;
    }
    if (designError) {
      state.message = designError;
      renderDialog();
      return;
    }
    if (!currentPrompt && !String(state.requirements || "").trim()) {
      state.message = SMART_AI_TEXT_REQUIRED_MESSAGE;
      renderDialog();
      return;
    }
    if (isMiniMaxH3ReverseRequest && miniMaxH3ReverseCapability()?.supportsReverse !== true) {
      state.message = "当前 MiniMax H3 模式不支持参考图反推";
      renderDialog();
      return;
    }
    if (isMiniMaxH3ReferenceReverseRequest) {
      const liveCaptured = typeof readMiniMaxH3PromptSurfaceState === "function"
        ? readMiniMaxH3PromptSurfaceState(state.context?.button, state.context?.promptTarget)
        : state.context?.miniMaxH3;
      const referenceError = miniMaxH3ReferenceReverseError(liveCaptured?.modelId === MINIMAX_H3_MODEL_ID ? liveCaptured : state.context?.miniMaxH3);
      if (referenceError) {
        state.message = referenceError;
        renderDialog();
        return;
      }
    }
    // Explicit minor + sensitive wording never leaves the UI with pictures attached.
    const isMiniMaxH3ImageRequest = isMiniMaxH3ReverseRequest || (isMiniMaxH3OptimizeRequest
      && ["image_video", "first_last", "multi_reference"].includes(state.context?.miniMaxH3?.mode));
    const miniMaxH3ContentPolicyAtRequest = isMiniMaxH3ImageRequest ? miniMaxH3ContentPolicy() : null;
    if (miniMaxH3ContentPolicyAtRequest?.sensitiveVisualAnalysis) {
      const actualUserIntent = `${prompt}\n${requirements}`;
      if (miniMaxH3SensitiveRequestHasExplicitMinorTerms(actualUserIntent)
        && miniMaxH3SensitiveRequestHasSensitiveTerms(actualUserIntent)) {
        state.message = "检测到明确未成年人证据与敏感内容同时存在，已阻止处理";
        renderDialog();
        return;
      }
    }
    if (isReverseRequest && state.imagesLoading) return;
    if (isMiniMaxH3ReverseRequest && state.miniMaxH3ReverseError) {
      state.message = state.miniMaxH3ReverseError;
      renderDialog();
      return;
    }
    if (isReverseRequest && !isMiniMaxH3ReverseRequest && !state.images.length) {
      state.message = isArt ? "请添加参考图" : "请先添加参考图、首帧或尾帧";
      renderDialog();
      return;
    }
    const token = useGrok ? readSessionToken() : "";
    if (useGrok && !token) {
      state.message = "请先登录NovaFlow账号";
      renderDialog();
      return;
    }

    state.loading = true;
    state.message = "";
    state.messageTone = "";
    state.analysisResult = null;
    state.analysisFailure = null;
    state.pendingApply = null;
    state.revealAnalysisOnRender = false;
    renderDialog();
    let miniMaxH3ReversePrepared = null;
    try {
      const api = window.electronAPI || {};
      // 文生/图生/首尾帧 with only a 补充要求: it becomes the source prompt.
      const miniMaxH3Prepared = isMiniMaxH3OptimizeRequest
        ? prepareMiniMaxH3PromptRequest(
          isMiniMaxH3ReferenceReverseRequest ? (prompt || MINIMAX_H3_REFERENCE_REVERSE_PLACEHOLDER) : (prompt || requirements),
          isMiniMaxH3ReferenceReverseRequest ? [requirements, MINIMAX_H3_REFERENCE_REVERSE_HINT].filter(Boolean).join("\n") : (prompt ? requirements : "")
        )
        : null;
      // The action looks at the pictures: an unreadable frame stops it rather than going text-only.
      const h3ReferenceFrames = isMiniMaxH3OptimizeRequest
        ? await captureH3ReferenceFrames(state.context?.miniMaxH3, miniMaxH3Prepared)
        : [];
      miniMaxH3ReversePrepared = isMiniMaxH3ReverseRequest
        ? await prepareMiniMaxH3ReverseRequest(prompt, requirements)
        : null;
      const protectPrompt = (isOptimizeRequest || (isArt && isReverseRequest)) && !isMiniMaxH3Request;
      const promptMentionProtection = protectPrompt
        ? protectSmartAiResourceMentions(prompt)
        : null;
      const negativePromptMentionProtection = protectPrompt && supportsNegativePrompt
        ? protectSmartAiResourceMentions(negativePrompt)
        : null;
      const staticReverseRequirements = usesStaticVisualV2
        ? buildStaticArtReverseRequirements(promptMentionProtection?.text ?? prompt)
        : requirements;
      const roleRequirements = roleAwareReferences
        ? (String(promptMentionProtection?.text ?? prompt).trim().slice(0, ART_REFERENCE_USER_TEXT_MAX)
          ? `用户生成要求：${String(promptMentionProtection?.text ?? prompt).trim().slice(0, ART_REFERENCE_USER_TEXT_MAX)}`
          : "")
        : requirements;
      let result;
      if (isSingleMainPreserveReverse && useGrok) {
        result = await api.smartAiImageReverse?.({
          token,
          negativePrompt,
          supportsNegativePrompt,
          requirements: staticReverseRequirements,
          purpose: "static-image-reverse",
          surface: "art",
          visualSchema: "nf.visual.v2",
          nsfw: analysisNsfw,
          ...buildReverseImagesPayload()
        });
      } else if (isSingleMainPreserveReverse) {
        const reversePayload = buildReverseImagesPayload();
        result = await api.promptAssistantReverseImagePrompt?.({
          requirements: staticReverseRequirements,
          purpose: "static-image-reverse",
          visualSchema: "nf.visual.v2",
          nsfw: analysisNsfw,
          images: reversePayload.images.map((item) => ({
            dataUrl: item.imageUrl,
            label: item.label,
            role: item.role
          }))
        });
      } else if (roleAwareReferences && useGrok) {
        result = await api.smartAiImageReverse?.({
          token,
          negativePrompt,
          supportsNegativePrompt,
          requirements: roleRequirements,
          purpose: "roleReference",
          surface: "art",
          ...buildRoleReferenceImagesPayload()
        });
      } else if (roleAwareReferences) {
        const rolePayload = buildRoleReferenceImagesPayload();
        result = await api.promptAssistantReverseImagePrompt?.({
          requirements: roleRequirements,
          purpose: "roleReference",
          images: rolePayload.images.map((item) => ({
            dataUrl: item.imageUrl,
            label: item.label,
            role: item.role,
            slotType: item.slotType
          }))
        });
      } else if (isMiniMaxH3ReverseRequest) {
        try {
          result = useGrok
            ? await api.smartAiImageReverse?.({
              token,
              ...miniMaxH3ReversePrepared.request
            })
            : await api.promptAssistantReverseImagePrompt?.({
              ...miniMaxH3ReversePrepared.request
            });
        } catch (bridgeFailure) {
          const bridgeError = new Error(String(bridgeFailure?.message || bridgeFailure || "MiniMax H3 bridge failed"));
          if (bridgeFailure && typeof bridgeFailure === "object") Object.assign(bridgeError, bridgeFailure);
          bridgeError.miniMaxH3FallbackFailureType = "bridge_exception";
          throw bridgeError;
        }
      } else if (isMiniMaxH3OptimizeRequest && useGrok) {
        result = await api.smartAiPromptOptimize?.({
          h3ReferenceFrames,
          ...(isMiniMaxH3ReferenceReverseRequest ? { h3Reverse: true } : {}),
          token,
          prompt: miniMaxH3Prepared.prompt,
          negativePrompt: "",
          supportsNegativePrompt: false,
          requirements: miniMaxH3Prepared.requirements,
          h3Mode: miniMaxH3Prepared.context?.mode || state.context?.miniMaxH3?.mode || "",
          durationSeconds: miniMaxH3Prepared.context?.durationSeconds || state.context?.miniMaxH3?.durationSeconds || 0,
          visualSchema: MINIMAX_H3_VISUAL_SCHEMA,
          purpose: MINIMAX_H3_PROMPT_PURPOSE,
          contentPolicy: miniMaxH3ContentPolicy(),
          surface: "animation"
        });
      } else if (isMiniMaxH3OptimizeRequest) {
        result = await api.promptAssistantOptimizePrompt?.({
          h3ReferenceFrames,
          ...(isMiniMaxH3ReferenceReverseRequest ? { h3Reverse: true } : {}),
          prompt: miniMaxH3Prepared.prompt,
          negativePrompt: "",
          supportsNegativePrompt: false,
          requirements: miniMaxH3Prepared.requirements,
          h3Mode: miniMaxH3Prepared.context?.mode || state.context?.miniMaxH3?.mode || "",
          durationSeconds: miniMaxH3Prepared.context?.durationSeconds || state.context?.miniMaxH3?.durationSeconds || 0,
          visualSchema: MINIMAX_H3_VISUAL_SCHEMA,
          purpose: MINIMAX_H3_PROMPT_PURPOSE,
          contentPolicy: miniMaxH3ContentPolicy(),
          surface: "animation"
        });
      } else if (isOptimizeRequest && useGrok) {
        result = await api.smartAiPromptOptimize?.({
          token,
          prompt: promptMentionProtection.text,
          ...(isArtTextRequest ? { currentPrompt: promptMentionProtection.text } : {}),
          ...(usesStructuredArtPromptContract ? { promptSchema: ORDINARY_ART_PROMPT_SCHEMA } : {}),
          negativePrompt: negativePromptMentionProtection?.text ?? negativePrompt,
          supportsNegativePrompt,
          nsfw: isArtTextRequest ? analysisNsfw : false,
          requirements,
          purpose: isArt
            ? (isArtTextRequest ? artTextPurpose : artIntent?.purpose)
            : (createFromRequirements ? "create" : "optimize"),
          surface: state.context?.surface || ""
        });
      } else if (isOptimizeRequest) {
        result = await api.promptAssistantOptimizePrompt?.({
          prompt: promptMentionProtection.text,
          ...(isArtTextRequest ? { currentPrompt: promptMentionProtection.text } : {}),
          ...(usesStructuredArtPromptContract ? { promptSchema: ORDINARY_ART_PROMPT_SCHEMA } : {}),
          ...(usesSimpleStructuredArtPromptContract
            ? { promptDetailMode: ORDINARY_ART_SIMPLE_STRUCTURED_MODE }
            : {}),
          negativePrompt: negativePromptMentionProtection?.text ?? negativePrompt,
          supportsNegativePrompt,
          nsfw: isArtTextRequest ? analysisNsfw : false,
          requirements,
          purpose: isArt
            ? (isArtTextRequest ? artTextPurpose : artIntent?.purpose)
            : (createFromRequirements ? "create" : "optimize"),
          surface: isArt ? "art" : "animation"
        });
      } else if (useGrok) {
        result = await api.smartAiImageReverse?.({
            token,
            negativePrompt,
            supportsNegativePrompt,
            requirements: staticReverseRequirements,
            purpose: isArt ? "static-image-reverse" : "",
            surface: state.context?.surface || "",
            ...(isArt ? {} : { prompt }),
            ...(usesStaticVisualV2 ? { visualSchema: "nf.visual.v2", nsfw: analysisNsfw } : {}),
            ...buildReverseImagesPayload()
          });
      } else {
        const reversePayload = buildReverseImagesPayload();
        result = await api.promptAssistantReverseImagePrompt?.({
          requirements: staticReverseRequirements,
          purpose: isArt ? "static-image-reverse" : "",
          ...(isArt ? {} : { prompt, surface: "animation" }),
          ...(usesStaticVisualV2 ? { visualSchema: "nf.visual.v2", nsfw: analysisNsfw } : {}),
          images: reversePayload.images.map((item) => ({
            dataUrl: item.imageUrl,
            label: item.label,
            role: item.role
          }))
        });
      }
      if (!result || result.ok === false) {
        const h3BridgeFailure = isMiniMaxH3ReverseRequest
          ? (result && typeof result === "object"
            ? result
            : Object.assign(new Error("MiniMax H3 bridge returned no response"), {
              miniMaxH3FallbackFailureType: "invalid_response"
            }))
          : null;
        if (isMiniMaxH3ReverseRequest && miniMaxH3FailureAllowsGuaranteedFallback(h3BridgeFailure)) {
          const failure = readSmartAiFailureEnvelope(result);
          const bridgeError = new Error(failure.message || result?.error || "MiniMax H3 详细视觉分析未完成");
          Object.assign(bridgeError, failure);
          bridgeError.miniMaxH3FallbackFailureType = "bridge_response";
          throw bridgeError;
        }
        if (usesStaticVisualV2 || isMiniMaxH3ReverseRequest) {
          if (requestFingerprint !== buildSmartAiRequestFingerprint(requestFingerprintOptions)) {
            invalidateSmartAiAnalysis();
            state.loading = false;
            state.message = "请求期间原提示词、NSFW 或参考图发生变化，旧分析结果已丢弃，请重新分析。";
            renderDialog();
            return;
          }
          const failure = readSmartAiFailureEnvelope(result);
          failure.requestedVisualSchema = failure.requestedVisualSchema
            || (isMiniMaxH3ReverseRequest ? "nf.h3.visual.v1" : "nf.visual.v2");
          failure.legacyFallbackSuppressed = failure.legacyFallbackSuppressed
            || ["nf.visual.v2", "nf.h3.visual.v1"].includes(failure.requestedVisualSchema);
          failure.requestFingerprint = requestFingerprint;
          state.analysisFailure = failure;
          state.loading = false;
          if (isMiniMaxH3ReverseRequest) state.messageTone = "error";
          state.message = smartAiAnalysisFailureStatusMessage(failure);
          renderDialog();
          return;
        }
        const failure = readSmartAiFailureEnvelope(result);
        const bridgeError = new Error(failure.message || result?.error || "生成失败");
        Object.assign(bridgeError, failure);
        bridgeError.code = failure.errorCode === "art-prompt-edit-not-applied"
          ? "prompt_edit_not_applied"
          : failure.errorCode === "art-prompt-retention-failed"
            ? "prompt_preservation_incomplete"
            : failure.errorCode;
        throw bridgeError;
      }
      const parsed = readSmartAiResult(result);
      let nextPrompt = parsed.prompt;
      let nextNegativePrompt = parsed.negativePrompt;
      if (requestFingerprint !== buildSmartAiRequestFingerprint(requestFingerprintOptions)) {
        invalidateSmartAiAnalysis();
        state.loading = false;
        state.message = "请求期间原提示词、NSFW 或参考图发生变化，旧分析结果已丢弃，请重新分析。";
        renderDialog();
        return;
      }
      if (usesStructuredArtPromptContract && (
        parsed.editContract !== ORDINARY_ART_EDIT_CONTRACT
        || parsed.promptSchema !== ORDINARY_ART_PROMPT_SCHEMA
      )) {
        throw smartAiStructuredPromptError({ code: "prompt_contract_mismatch" });
      }
      if (usesStaticVisualV2 && parsed.visualSchema !== "nf.visual.v2") {
        throw new Error("图片反推返回了不兼容的视觉合同，已阻止写入");
      }
      if (isMiniMaxH3ReverseRequest && parsed.visualSchema !== "nf.h3.visual.v1") {
        const schemaError = new Error("MiniMax H3 反推返回了不兼容的视觉合同，已阻止写入");
        schemaError.miniMaxH3FallbackFailureType = "contract_invalid";
        throw schemaError;
      }
      if (usesStaticVisualV2 && !String(parsed.visualPrompt || "").trim()) {
        throw new Error("图片反推未返回可展示的图片事实摘要，已阻止写入");
      }
      const requestRequirementsContainExplicitMinor = usesStaticVisualV2
        && smartAiRequirementsContainExplicitMinorTerms(staticReverseRequirements);
      const requestRequirementsContainSensitiveIntent = usesStaticVisualV2
        && smartAiRequirementsContainSensitiveIntent(staticReverseRequirements);
      const requestMinorGateExpected = requestRequirementsContainExplicitMinor
        && (requestRequirementsContainSensitiveIntent
          || ["suggestive", "nudity", "explicit"].includes(String(parsed.contentSafety?.level || "")));
      if (usesStaticVisualV2 && requestMinorGateExpected
        && (parsed.generationGate !== "blocked" || parsed.sensitivePromptBlocked !== true)) {
        throw new Error("附加要求包含明确未成年人内容，且涉及敏感意图，已阻止写入");
      }
      if (usesStaticVisualV2 && !isValidPublicVisualV2Result(parsed, {
        nsfw: analysisNsfw,
        requireGenerationGate: true,
        requirementsContainExplicitMinor: requestRequirementsContainExplicitMinor,
        requirementsContainSensitiveIntent: requestRequirementsContainSensitiveIntent
      })) {
        throw new Error("图片反推返回的内容分级元数据不完整或不一致，已阻止写入");
      }
      const isVisualV2Result = usesStaticVisualV2;
      const isDegradedAnalysis = isVisualV2Result && parsed.analysisDegraded === true;
      const isPartialAnalysis = isVisualV2Result && parsed.analysisPartial === true;
      const generationGate = isVisualV2Result ? parsed.generationGate : "";
      if (isVisualV2Result) {
        state.analysisResult = parsed;
        state.revealAnalysisOnRender = true;
      }
      if (isDegradedAnalysis) {
        if (!useGrok) showLocalStaticReverseWarning(result?.warning);
        if (isArt) ART_REFERENCE_PLAN = null;
        state.loading = false;
        state.message = smartAiDegradedStatusMessage(parsed);
        renderDialog();
        return;
      }
      if (isVisualV2Result && generationGate === "blocked") {
        if (!useGrok) showLocalStaticReverseWarning(result?.warning);
        if (isArt) ART_REFERENCE_PLAN = null;
        state.loading = false;
        state.message = isPartialAnalysis
          ? smartAiPartialStatusMessage(parsed)
          : smartAiBlockedStatusMessage(parsed);
        renderDialog();
        return;
      }
      if (isVisualV2Result && generationGate === "neutral_only") {
        state.pendingApply = {
          requiresNeutralApply: true,
          visualPrompt: parsed.visualPrompt,
          requestFingerprint
        };
        if (!useGrok) showLocalStaticReverseWarning(result?.warning);
        if (isArt) ART_REFERENCE_PLAN = null;
        state.loading = false;
        state.message = smartAiPartialStatusMessage(parsed);
        renderDialog();
        return;
      }
      if (!nextPrompt) {
        const invalidResultError = new Error(result?.error || "生成失败");
        if (isMiniMaxH3ReverseRequest) invalidResultError.miniMaxH3FallbackFailureType = "invalid_response";
        throw invalidResultError;
      }
      if (!isMiniMaxH3Request && (
        !useGrok && isOptimizeRequest && !roleAwareReferences && supportsNegativePrompt && (!parsed.hasNegativePrompt || !String(nextNegativePrompt || "").trim())
      )) {
        throw new Error("本地模型未返回反向提示词，请重试");
      }
      if (usesStaticVisualV2 && String(promptMentionProtection?.text ?? prompt).trim()) {
        state.message = "图片分析完成，正在融合补充要求并更新画面描述...";
        renderDialog();
        const fused = await fuseStaticArtReversePrompt(nextPrompt, promptMentionProtection?.text ?? prompt, {
          optimize: (payload) => useGrok
            ? api.smartAiPromptOptimize?.({ token, ...payload })
            : api.promptAssistantOptimizePrompt?.(payload),
          negativePrompt: nextNegativePrompt,
          supportsNegativePrompt,
          nsfw: analysisNsfw
        });
        if (requestFingerprint !== buildSmartAiRequestFingerprint(requestFingerprintOptions)) {
          throw new Error("融合期间原提示词、参考图或要求发生变化，本次未写入，请重新分析。");
        }
        nextPrompt = fused.prompt;
        nextNegativePrompt = fused.negativePrompt;
        parsed.hasNegativePrompt = fused.hasNegativePrompt;
      }
      if (isMiniMaxH3ReverseRequest) {
        try {
          nextPrompt = await validateMiniMaxH3ReverseResult(nextPrompt, miniMaxH3ReversePrepared, textareas);
          const refinement = miniMaxH3ReversePrepared.workflow.prepareRefinement({
            text: nextPrompt,
            context: miniMaxH3ReversePrepared.context
          });
          if (refinement) {
            state.message = "图片分析完成，正在融合原提示词与补充要求...";
            renderDialog();
            const refined = useGrok
              ? await api.smartAiPromptOptimize?.({ token, ...refinement })
              : await api.promptAssistantOptimizePrompt?.(refinement);
            if (!refined || refined.ok === false) {
              const failure = readSmartAiFailureEnvelope(refined);
              throw Object.assign(new Error(failure.message || "补充要求融合优化失败，原提示词未修改"), failure);
            }
            nextPrompt = await validateMiniMaxH3ReverseResult(readSmartAiResult(refined).prompt, miniMaxH3ReversePrepared, textareas, true);
          }
        } catch (validationFailure) {
          const validationError = new Error(String(validationFailure?.message || validationFailure || "MiniMax H3 contract validation failed"));
          if (validationFailure && typeof validationFailure === "object") Object.assign(validationError, validationFailure);
          validationError.miniMaxH3FallbackFailureType = "contract_invalid";
          throw validationError;
        }
        nextNegativePrompt = "";
      } else if (isMiniMaxH3OptimizeRequest) {
        nextPrompt = validateMiniMaxH3PromptResult(nextPrompt, miniMaxH3Prepared, textareas);
        nextNegativePrompt = "";
      } else if (protectPrompt) {
        const restoredPrompt = restoreSmartAiResourceMentions(nextPrompt, promptMentionProtection);
        if (!restoredPrompt.ok) {
          throw smartAiResourceMentionError(restoredPrompt.error);
        }
        nextPrompt = restoredPrompt.text;
        if (supportsNegativePrompt && parsed.hasNegativePrompt) {
          const restoredNegativePrompt = restoreSmartAiResourceMentions(
            nextNegativePrompt,
            negativePromptMentionProtection
          );
          if (!restoredNegativePrompt.ok) {
            throw smartAiResourceMentionError(restoredNegativePrompt.error);
          }
          nextNegativePrompt = restoredNegativePrompt.text;
        }
      }
      if (usesStructuredArtPromptContract) {
        const structure = validateSmartAiStructuredArtPrompt(nextPrompt);
        if (!structure.ok) throw smartAiStructuredPromptError(structure);
        const preservation = validateSmartAiArtPromptPreservation(
          currentPrompt,
          nextPrompt,
          state.requirements,
          { deterministicMerge: true }
        );
        if (!preservation.ok) throw smartAiPromptPreservationError(preservation);
      }
      let preservationBase = currentPrompt;
      if (isArt && !usesStructuredArtPromptContract) {
        // The prompt writer sometimes echoes the director instructions it was given ("用户附加要求：
        // 设计控件约束…", "基础质量由系统自动负责…") into the prompt. Those are for the writer, never
        // for the image model: strip our own template text, and refuse anything that still restates it.
        const qualityApi = window.NovaFlowArtQualityProfile;
        if (typeof qualityApi?.stripTemplateText === "function") {
          const stripped = qualityApi.stripTemplateText(nextPrompt);
          if (stripped) nextPrompt = stripped;
          preservationBase = qualityApi.stripTemplateText(currentPrompt) || currentPrompt;
        }
        const leaked = typeof qualityApi?.findLeakedDirectorText === "function" ? qualityApi.findLeakedDirectorText(nextPrompt) : "";
        if (leaked) throw new Error(`模型把系统约束写进了提示词（${leaked}），本次未写入，请重试`);
      }
      if (isArtTextRequest && preservationBase && !usesStructuredArtPromptContract) {
        const preservation = validateSmartAiArtPromptPreservation(preservationBase, nextPrompt, state.requirements);
        if (!preservation.ok) throw smartAiPromptPreservationError(preservation);
      }
      if (isReverseRequest && !isMiniMaxH3Request) {
        nextPrompt = preserveSmartAiReverseResourceMentions(prompt, nextPrompt);
        if (supportsNegativePrompt && parsed.hasNegativePrompt) {
          nextNegativePrompt = preserveSmartAiReverseResourceMentions(negativePrompt, nextNegativePrompt);
        }
      }
      const qualityNegativeGuard = isArt && isOptimizeRequest
        ? artHighQualityCgNegativeGuardInstruction({ textOnly: true })
        : "";
      if (supportsNegativePrompt && qualityNegativeGuard) {
        nextNegativePrompt = mergeSmartAiNegativePrompt(nextNegativePrompt, qualityNegativeGuard);
      }
      let currentTextareas = textareas;
      if (isVisualV2Result && generationGate === "adult_confirmation") {
        if (!isSmartAiSensitiveAutoApplyCandidate(parsed)) {
          throw new Error("图片反推返回的敏感候选状态不完整或不一致，已阻止写入");
        }
        const declaredAdultSensitiveText = `所有人物均为成年人。\n${prompt || ""}\n${nextPrompt || ""}`;
        if (smartAiSensitiveIntentHasDisallowedYoungOrMinorTerms(declaredAdultSensitiveText)) {
          if (isArt) ART_REFERENCE_PLAN = null;
          if (!useGrok) showLocalStaticReverseWarning(result?.warning);
          state.loading = false;
          state.message = "分析完成—未写入：描述或模型提示词中包含明确未成年人内容，敏感提示词已阻止。";
          renderDialog();
          return;
        }
        if (requestFingerprint !== buildSmartAiRequestFingerprint(requestFingerprintOptions)) {
          invalidateSmartAiAnalysis();
          state.loading = false;
          state.message = "自动应用前原提示词、NSFW 或参考图发生变化，旧分析结果已丢弃，请重新分析。";
          renderDialog();
          return;
        }
        if (!enableArtGenerateNsfwForSensitivePrompt(state.context)) {
          if (isArt) ART_REFERENCE_PLAN = null;
          if (!useGrok) showLocalStaticReverseWarning(result?.warning);
          state.loading = false;
          state.message = "分析结果尚未写入：无法自动开启 Art NSFW 生成开关，请确认 Art 生成面板可用后重新分析。";
          renderDialog();
          return;
        }
        currentTextareas = getPromptTextareasFromContext(state.context);
        if (!isPromptTextControl(currentTextareas.positive)) {
          if (isArt) ART_REFERENCE_PLAN = null;
          state.loading = false;
          state.message = "NSFW 已开启，但重绘后的提示词框不可用；本次未写入，请重新分析。";
          renderDialog();
          return;
        }
      }
      if (isVisualV2Result && !["direct", "adult_confirmation"].includes(generationGate)) {
        throw new Error("图片反推返回的生成门状态无法应用，已阻止写入");
      }
      setPromptTextareasValue(currentTextareas, nextPrompt, {
        supportsNegativePrompt: isMiniMaxH3Request ? false : supportsNegativePrompt,
        negativePrompt: nextNegativePrompt,
        hasNegativePrompt: isMiniMaxH3Request ? false : parsed.hasNegativePrompt || Boolean(qualityNegativeGuard)
      });
      if (roleAwareReferences) {
        state.message = "正在按参考职责生成专用约束...";
        renderDialog();
        const compiledPlan = await compileArtReferencePlan();
        ART_REFERENCE_PLAN = {
          version: compiledPlan.version,
          roles: state.images.map((_, index) => state.referenceRoles[index] || "subject"),
          referenceCount: state.images.length,
          fingerprints: state.images.map((item) => smartAiReferenceFingerprint(item.imageUrl)),
          results: compiledPlan.results,
          capabilities: compiledPlan.capabilities || {},
          createdAt: Date.now()
        };
      } else if (isArt && isOptimizeRequest) {
        ART_REFERENCE_PLAN = null;
      }
      if (!useGrok && usesStaticImageReverse) {
        showLocalStaticReverseWarning(result?.warning);
      }
      if (isVisualV2Result) {
        state.loading = false;
        closeDialog();
        return;
      }
      closeDialog();
    } catch (caughtError) {
      const err = caughtError;
      if (isMiniMaxH3ReverseRequest
        && miniMaxH3ReversePrepared
        && miniMaxH3FailureAllowsGuaranteedFallback(err)) {
        const failure = readSmartAiFailureEnvelope(err);
        failure.requestedVisualSchema = failure.requestedVisualSchema || "nf.h3.visual.v1";
        failure.legacyFallbackSuppressed = true;
        failure.retryAttempted = failure.retryAttempted === true;
        failure.retryCount = Math.max(0, Number(failure.retryCount) || 0);
        state.loading = false;
        state.analysisResult = null;
        state.analysisFailure = failure;
        state.pendingApply = null;
        state.revealAnalysisOnRender = false;
        state.messageTone = "error";
        state.message = smartAiAnalysisFailureStatusMessage(failure);
        renderDialog();
        return;
      }
      state.loading = false;
      state.messageTone = isMiniMaxH3ReverseRequest ? "error" : "";
      state.message = smartAiFailureMessage(err);
      renderDialog();
    }
  }

  function openDialog(context) {
    const isArt = context?.surface === "art";
    const initialPrompt = isArt
      ? String(getPromptTextareasFromContext(context).positive?.value || "").trim()
      : "";
    state.open = true;
    state.context = context;
    // Art and the plain animation dialog settle their mode from the references once they load.
    state.mode = isArt && context?.artGenerateMode === "img2img" ? "reverse" : "optimize";
    state.starterPreset = "";
    state.artTask = context?.surface === "art" && context?.artGenerateMode === "img2img" ? "preserve" : "create";
    state.artStyle = context?.surface === "art" && context?.artGenerateMode !== "img2img" ? "auto" : "original";
    state.backgroundMode = "replace";
    state.preserveLevel = "high";
    state.referenceRoles = [];
    state.referenceRoleOverrides = {};
    if (isArt) {
      state.requirements = "";
      state.hadInitialPrompt = Boolean(initialPrompt);
      state.advancedOpen = false;
      state.engine = window.NovaFlowSmartAiArtAutoIntent?.readProviderPreference?.(window.localStorage) || "local";
    } else {
      state.requirements = "";
      state.hadInitialPrompt = false;
      state.advancedOpen = false;
    }
    state.loading = false;
    state.message = "";
    state.messageTone = "";
    state.analysisResult = null;
    state.analysisFailure = null;
    state.pendingApply = null;
    state.revealAnalysisOnRender = false;
    state.images = [];
    state.imagesLoading = false;
    state.miniMaxH3ReverseError = "";
    state.targetIndex = 0;
    renderDialog();
    refreshImageContext();
  }

  function copyButtonLook(button, reference) {
    if (reference instanceof HTMLButtonElement && reference !== button && button.className !== reference.className) {
      button.className = reference.className || button.className;
    }
    setSmartAiAttributeIfChanged(button, SMART_BUTTON_ATTR, "1");
    setSmartAiAttributeIfChanged(button, "data-novaflow-smart-ai-button", "1");
    setSmartAiAttributeIfChanged(button, NOVAFLOW_PROMPT_ACTION_BUTTON_ATTR, "1");
  }

  function mountPromptEditButton(actions, surface) {
    if (!(actions instanceof HTMLElement)) return;
    if (surface === "animation" && actions.getAttribute("data-novaflow-ai-storyboard-actions") === "1") return;
    if (surface !== "animation" && surface !== "art") return;
    let editButton = actions.querySelector('[data-novaflow-ai-prompt-expand-button="1"]');
    let created = false;
    if (!(editButton instanceof HTMLButtonElement)) {
      editButton = document.createElement("button");
      created = true;
    }
    setSmartAiButtonTypeIfChanged(editButton);
    setSmartAiTextIfChanged(editButton, "编辑");
    copyButtonLook(editButton, actions.querySelector(`[${SMART_BUTTON_ATTR}="1"]`) || actions.querySelector("button"));
    setSmartAiAttributeIfChanged(editButton, "data-novaflow-ai-prompt-expand-button", "1");
    setSmartAiAttributeIfChanged(editButton, "data-novaflow-ai-prompt-assistant-button", "1");
    setSmartAiAttributeIfChanged(editButton, "title", "编辑完整提示词");
    if (editButton.getAttribute("data-novaflow-ai-prompt-editor-bound") !== "1") {
      editButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (surface === "art") {
          const textareas = getPromptTextareasFromContext({ surface: "art", button: actions });
          openSmartAiPromptEditor(textareas.positive, "提示词");
          return;
        }
        const promptEditor = window.__NovaFlowPromptEditor;
        if (promptEditor && typeof promptEditor.openFromActions === "function") {
          promptEditor.openFromActions(actions);
        }
      });
      editButton.setAttribute("data-novaflow-ai-prompt-editor-bound", "1");
    }
    if (created) actions.appendChild(editButton);
  }

  function mountButton(actions, surface) {
    if (!(actions instanceof HTMLElement)) return;
    let button = actions.querySelector(`[${SMART_BUTTON_ATTR}="1"]`);
    let created = false;
    if (!(button instanceof HTMLButtonElement)) {
      button = document.createElement("button");
      created = true;
    }
    setSmartAiButtonTypeIfChanged(button);
    setSmartAiTextIfChanged(button, "AI 助手");
    copyButtonLook(button, actions.querySelector("button"));
    if (button.getAttribute("data-novaflow-smart-ai-bound") !== "1") {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const promptTarget = surface === "animation" ? captureAnimationPromptTarget(button) : null;
        const miniMaxH3 = surface === "animation"
          ? captureMiniMaxH3PromptContext(button, promptTarget)
          : null;
        openDialog({
          surface,
          button,
          artGenerateMode: surface === "art" ? readArtGenerateMode(button) : "",
          nsfw: surface === "art" ? readArtGenerateNsfw(button) : false,
          promptTarget,
          ...(miniMaxH3 ? { miniMaxH3 } : {})
        });
      });
      button.setAttribute("data-novaflow-smart-ai-bound", "1");
    }
    if (created) actions.insertBefore(button, actions.firstChild || null);
    if (surface === "animation" && actions.getAttribute("data-novaflow-ai-storyboard-actions") !== "1") {
      const frame = actions.closest('[data-novaflow-ai-prompt-kind="positive"], [data-novaflow-ai-prompt-frame="1"]');
      const topRow = frame?.firstElementChild;
      // The brand runtime lays out a row it has marked as the prompt's
      // history row; writing its padding here only fought that.
      if (topRow instanceof HTMLElement && !topRow.hasAttribute("data-novaflow-ai-prompt-history-row")) topRow.style.setProperty("padding-right", "176px", "important");
    }
    mountPromptEditButton(actions, surface);
  }

  function mountSmartAiButtons() {
    injectStyle();
    document.querySelectorAll(ANIMATION_ACTIONS_SELECTOR).forEach((actions) => mountButton(actions, "animation"));
    document.querySelectorAll(ART_ACTIONS_SELECTOR).forEach((actions) => mountButton(actions, "art"));
  }

  function scheduleSmartAiButtonMount() {
    if (SMART_AI_MOUNT_FRAME) return;
    const run = () => {
      SMART_AI_MOUNT_FRAME = 0;
      mountSmartAiButtons();
    };
    SMART_AI_MOUNT_FRAME = window.requestAnimationFrame
      ? window.requestAnimationFrame(run)
      : window.setTimeout(run, 0);
  }

  // Generation turns the editor's H3 prompt into the official English text (文生 / 图生 /
  // 首尾帧 / 多参). Compilation is local and does not silently spend cloud credits - where
  // there is a local machine to ask. The hosted site has none (the Web runtime answers that
  // it is provided through 智能 AI), and there the compile goes the same way the dialog's
  // Grok choice does. A translate-only compile needs no reference frames.
  async function compileH3ForGeneration(options) {
    const workflow = getMiniMaxH3PromptWorkflow();
    return workflow.compileForGeneration(options, async (payload) => {
      const api = window.electronAPI || {};
      const translateOnly = /^H3 compile: translate-only$/m.test(String(payload?.requirements || ""));
      const h3ReferenceFrames = translateOnly ? [] : await captureH3ReferenceFrames({ ...options, mode: "multi_reference" });
      let response = await api.promptAssistantOptimizePrompt?.({ ...payload, h3ReferenceFrames });
      const noLocalMachine = !response || (response.ok === false && /Web 版通过智能 AI/.test(String(response.error || "")));
      if (noLocalMachine && typeof api.smartAiPromptOptimize === "function") {
        const token = readSessionToken();
        if (!token) throw new Error("H3 提示词编译需要先登录 NovaFlow 账号");
        response = await api.smartAiPromptOptimize({ ...payload, h3ReferenceFrames, token });
      }
      if (!response || response.ok === false) throw new Error(response?.error || "H3 提示词编译失败");
      return readSmartAiResult(response).prompt;
    });
  }

  // H3 prompts kept in the prompt history before the official layout (【任务定位】 five
  // sections) open in the current display with the editor's aliases. This script runs
  // before the bundle mounts React and reads the key, so entries are rewritten in place.
  const MINIMAX_H3_PROMPT_HISTORY_KEY = "nf_text_history:ai_seq_prompt";
  function migrateMiniMaxH3PromptHistory() {
    try {
      const format = window.NovaFlowH3PromptFormat;
      const raw = window.localStorage?.getItem(MINIMAX_H3_PROMPT_HISTORY_KEY);
      if (!raw || !raw.includes("【任务定位】") || typeof format?.toBaseDisplay !== "function") return;
      const convert = (entry) => {
        const task = /^\s*【任务定位】\s*([^\n]*)/.exec(String(entry?.text ?? ""))?.[1];
        if (task == null || /多参/.test(task)) return entry;
        try {
          const shown = format.toBaseDisplay(entry.text);
          const aliases = /<Picture 2>/.test(shown) ? { "<Picture 1>": "@首帧", "<Picture 2>": "@尾帧" } : { "<Picture 1>": "@参考图" };
          return { ...entry, text: shown.replace(/<Picture [12]>/g, (token) => aliases[token]) };
        } catch {
          return entry;
        }
      };
      const history = JSON.parse(raw);
      for (const list of ["recent", "pinnedSlots", "pinned"]) {
        if (Array.isArray(history?.[list])) history[list] = history[list].map((entry) => entry && convert(entry));
      }
      window.localStorage.setItem(MINIMAX_H3_PROMPT_HISTORY_KEY, JSON.stringify(history));
    } catch {}
  }

  function start() {
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("click", trackMiniMaxH3ResourceClick, true);
    document.addEventListener("change", trackMiniMaxH3ResourceFileChange, true);
    document.addEventListener("drop", trackMiniMaxH3ResourceDrop, true);
    mountSmartAiButtons();
    const observer = new MutationObserver((mutations) => {
      if (mutations.length && mutations.every(isSmartAiSelfMutation)) return;
      scheduleSmartAiButtonMount();
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    window.__NovaFlowSmartAI = {
      compileH3ForGeneration,
      compileH3ReferenceForGeneration(options) {
        return compileH3ForGeneration({ ...options, mode: "multi_reference" });
      },
      version: VERSION,
      refresh: mountSmartAiButtons,
      close: closeDialog,
      isValidPublicVisualV2Result,
      getArtGenerationReferencePlan(references) {
        const plan = ART_REFERENCE_PLAN;
        const items = Array.isArray(references) ? references : [];
        if (!plan || plan.referenceCount !== items.length) return null;
        const fingerprints = items.map((item) => smartAiReferenceFingerprint(item?.dataUrl || item?.imageUrl));
        if (fingerprints.some((value, index) => value !== plan.fingerprints[index])) return null;
        const conditioning = (plan.results || []).filter((item) => item?.compiledUrl && (item.role === "subject" || item.mode === "compiled-image"));
        return {
          version: plan.version,
          roles: plan.roles.slice(),
          capabilities: { ...(plan.capabilities || {}) },
          conditioning: conditioning.map((item) => ({ sourceIndex: item.index, role: item.role, dataUrl: item.compiledUrl, name: `reference_${item.index + 1}_${item.role}.png`, processor: item.processor || "source" })),
          textOnlyRoles: (plan.results || []).filter((item) => !item?.compiledUrl).map((item) => item.role)
        };
      }
    };
  }

  migrateMiniMaxH3PromptHistory();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
