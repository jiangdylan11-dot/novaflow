(function initNovaFlowSmartAiArtAutoIntent(global) {
  "use strict";

  if (global.NovaFlowSmartAiArtAutoIntent) return;

  const VERSION = "20260811-art-auto-intent-1";
  const PROVIDER_STORAGE_KEY = "novaflow.smart-ai.art.provider.v1";
  const PROVIDERS = new Set(["local", "grok"]);
  const REFERENCE_ROLES = new Set([
    "subject",
    "style",
    "pose",
    "background",
    "composition",
    "color",
    "material",
    "ui_layout"
  ]);
  const DEFAULT_SECONDARY_ROLES = ["style", "background", "composition"];
  const ROLE_PATTERNS = Object.freeze([
    ["ui_layout", /(?:UI|界面|布局|版式|线框)/i],
    ["background", /(?:背景|环境|场景)/i],
    ["pose", /(?:姿势|姿态|动作|骨骼)/i],
    ["composition", /(?:构图|镜头|景别|透视|位置|空间层次)/i],
    ["color", /(?:配色|色板|颜色|色彩)/i],
    ["material", /(?:材质|质感|纹理)/i],
    ["style", /(?:风格|画风|笔触|上色|渲染语言)/i]
  ]);

  function clean(value) {
    return String(value || "").trim();
  }

  function normalizeProvider(value) {
    const provider = clean(value).toLowerCase();
    return PROVIDERS.has(provider) ? provider : "";
  }

  function readProviderPreference(storage) {
    try {
      return normalizeProvider(storage?.getItem?.(PROVIDER_STORAGE_KEY));
    } catch {
      return "";
    }
  }

  function writeProviderPreference(storage, value) {
    const provider = normalizeProvider(value);
    if (!provider) return false;
    try {
      storage?.setItem?.(PROVIDER_STORAGE_KEY, provider);
      return true;
    } catch {
      return false;
    }
  }

  function roleFromExplicitImageInstruction(text, imageNumber) {
    const source = clean(text);
    if (!source) return "";
    const anchor = new RegExp(`(?:图|图片|参考图)\\s*${imageNumber}\\s*(?:作为|用作|设为|是|提供|用于|只作为|只用作)?([^\\n。；，,]{0,32})`, "i");
    const match = source.match(anchor);
    const scope = clean(match?.[1]);
    if (!scope) return "";
    return ROLE_PATTERNS.find(([, pattern]) => pattern.test(scope))?.[0] || "";
  }

  function normalizeRoleOverrides(value, count) {
    const source = value && typeof value === "object" ? value : {};
    const output = {};
    for (let index = 1; index < count; index += 1) {
      const role = clean(source[index]);
      if (REFERENCE_ROLES.has(role) && role !== "subject") output[index] = role;
    }
    return output;
  }

  function deriveReferenceRoles(options) {
    const source = options || {};
    const count = Math.max(0, Math.min(3, Math.round(Number(source.imageCount) || 0)));
    if (!count) return { roles: [], unresolvedIndices: [], confidence: "high" };
    const overrides = normalizeRoleOverrides(source.roleOverrides, count);
    const roles = Array.from({ length: count }, () => "composition");
    const unresolvedIndices = [];
    roles[0] = "subject";
    for (let index = 1; index < count; index += 1) {
      const explicitRole = roleFromExplicitImageInstruction(source.userIntent, index + 1);
      if (overrides[index]) {
        roles[index] = overrides[index];
      } else if (explicitRole) {
        roles[index] = explicitRole;
      } else {
        roles[index] = DEFAULT_SECONDARY_ROLES[index - 1] || "composition";
        unresolvedIndices.push(index);
      }
    }
    return {
      roles,
      unresolvedIndices,
      confidence: unresolvedIndices.length ? "low" : "high"
    };
  }

  function inferTask(text, imageCount) {
    if (!imageCount) return "create";
    if (imageCount > 1) return "combine";
    if (/(?:更换|替换|重做).{0,6}(?:背景|环境|场景)/i.test(text)) return "background";
    if (/(?:更换|替换|调整).{0,6}(?:姿势|姿态|动作)/i.test(text)) return "pose";
    if (/(?:更换|转换|迁移|改成).{0,8}(?:风格|画风|二次元|写实|赛璐璐|厚涂|CG)/i.test(text)) return "transfer";
    return "preserve";
  }

  function inferStyle(text, imageCount) {
    if (/(?:赛璐璐|漫画线稿|粗黑描边|黑色外轮廓)/i.test(text)) return "cel_comic";
    if (/(?:高清游戏\s*CG|游戏宣传\s*CG|电影级\s*CG)/i.test(text)) return "game_cg";
    if (/(?:二次元|动漫|anime)/i.test(text)) return "anime";
    if (/(?:2\.5D|2_5D)/i.test(text)) return "2_5d";
    if (/(?:厚涂|手绘)/i.test(text)) return "painted";
    if (/(?:Q版|chibi)/i.test(text)) return "chibi";
    if (/(?:写实|真实感|photoreal)/i.test(text)) return "realistic";
    return imageCount ? "original" : "auto";
  }

  function inferPreserveLevel(text) {
    if (/(?:允许|可以|大幅|彻底).{0,6}(?:重构|重做|重新设计)/i.test(text)) return "rebuild";
    if (/(?:适度|局部|小幅).{0,6}(?:调整|修改|重构)/i.test(text)) return "medium";
    return "high";
  }

  function inferBackgroundMode(text) {
    if (/(?:保留|保持).{0,6}(?:原背景|背景不变)/i.test(text)) return "preserve";
    if (/(?:融合|混合).{0,6}(?:背景|环境|场景)/i.test(text)) return "blend";
    if (/(?:借用|参考).{0,6}(?:背景|环境|场景).{0,6}(?:氛围|特征|光色)/i.test(text)) return "borrow";
    return "replace";
  }

  function derive(options) {
    const source = options || {};
    const imageCount = Math.max(0, Math.min(3, Math.round(Number(source.imageCount) || 0)));
    const userIntent = clean(source.userIntent);
    const referencePlan = deriveReferenceRoles({
      imageCount,
      userIntent,
      roleOverrides: source.roleOverrides
    });
    const hasReferences = imageCount > 0;
    const inferredStyle = inferStyle(userIntent, imageCount);
    return Object.freeze({
      version: VERSION,
      userIntent,
      imageCount,
      hasReferences,
      route: imageCount === 0 ? "optimize" : imageCount === 1 ? "static_reverse" : "role_reference",
      purpose: imageCount === 0
        ? (source.hadInitialPrompt ? "optimize" : "create")
        : imageCount === 1 ? "static-image-reverse" : "roleReference",
      generationMode: hasReferences ? "img2img" : "txt2img",
      task: inferTask(userIntent, imageCount),
      style: inferredStyle === "original" && referencePlan.roles.includes("style") ? "reference" : inferredStyle,
      preserveLevel: inferPreserveLevel(userIntent),
      backgroundMode: inferBackgroundMode(userIntent),
      roles: Object.freeze(referencePlan.roles.slice()),
      unresolvedRoleIndices: Object.freeze(referencePlan.unresolvedIndices.slice()),
      roleConfidence: referencePlan.confidence,
      canSubmit: hasReferences || Boolean(userIntent) || Boolean(source.hadInitialPrompt)
    });
  }

  global.NovaFlowSmartAiArtAutoIntent = Object.freeze({
    version: VERSION,
    providerStorageKey: PROVIDER_STORAGE_KEY,
    derive,
    deriveReferenceRoles,
    normalizeProvider,
    readProviderPreference,
    writeProviderPreference
  });
})(window);
