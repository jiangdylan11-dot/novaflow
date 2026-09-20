// 2026-09-20: a prompt box that carried echoed director text ("用户附加要求：设计控件约束…",
// "基础质量由系统自动负责…游戏 UI…") made the quality profile classify a character prompt as game UI
// and append the "商业游戏UI质量" paragraph, so the local cfg=1 models painted HUD overlays.
// Pins: template/director text is stripped before classification and before sending, negated UI
// words never flip the asset type, local txt2img drops the negated "不添加游戏界面…" sentence from
// the positive prompt, and both prompt-assistant paths refuse to write echoed director text back.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, "particle-editor", file), "utf8");
const context = vm.createContext({ console });
context.window = context;
vm.runInContext(read("art-quality-profile.workflow.js"), context, { filename: "art-quality-profile.workflow.js" });
const api = context.NovaFlowArtQualityProfile;

const CORE = "主体包括一名猫耳少女，外观为银白色长发、猫耳、蓝眼睛、赤面。姿态与动作：猫耳少女姿势为坐姿。场景：背景为日式房间。光色与氛围：光线为自然光，整体色板为粉色调、暖色。材质与风格：视觉风格为动漫风格。";
const LEAKED = CORE + "用户附加要求：设计控件约束（只作为最终提示词约束，不作为图片可见事实）：处理目标：保持原图，提升质量 图1（图1）：主图 / 原图 保留程度：高度保留 目标风格：保持原风格。保持原有视觉风格，只提升完成度 高完成度角色CG质量：用户指定的角色身份、可见外观状态、姿态、景别、构图和道具最高优先，不得擅自新增、删减或重新设计原图内容，不得擅自改成近景或裁切主体；用户要求全身时必须从头到脚完整入画，脚部和核心道具都保留在画面内。建立清晰轮廓、稳定重心和有表现力的动作线；面部五官、眼神、发丝分组、手脚与人体结构准确。皮肤、头发及原图已有材质分别呈现可信质感，使用柔和体积光、受控轮廓光和自然明暗转折塑造体积。配色遵循主色、辅色、点缀色层级；轮廓主要由明暗、色彩和材质边缘建立，只允许局部细弱彩色辅助线。画面达到高品质角色插画的精修完成度。只输出用户要求的纯画面内容，不添加游戏界面、界面边框、操作按钮、状态栏、菜单面板、文字标签、Logo或水印。 通用保留约束：主图决定内容与身份，其他参考图只提供被指定的单一维度。 基础质量由系统自动负责：先识别当前资产类型并使用匹配的提升方式。人物增强面部、眼睛、头发、皮肤、人体结构和原图已有材质的可信细节，不主动新增穿着或装饰内容；物体和道具增强金属、木材、皮革、玻璃、布料等材质差异与结构质感；场景增强空间层次、建筑、地面、植被与环境光影；游戏 UI、图标和海报增强信息层级、边缘与装饰材质；二次元、Q版和厚涂保持原有绘画语言，只提高绘制完成度。自动避免模糊、噪点、结构错误、过度锐化、塑料质感与无意义细节，不要求用户重复选择基础质量项。";

// --- classification ---------------------------------------------------------------------------
assert.equal(api.inferAssetType(LEAKED), "character", "echoed director text must not flip a character prompt to game UI");
assert.equal(api.inferAssetType("一名少女站在窗边，不要游戏界面、按钮和面板"), "character", "negated UI words are a complaint, not a request");
assert.equal(api.inferAssetType("高品质老虎机主界面，包含转轴和大奖按钮"), "game_ui", "an affirmative UI prompt is still game UI");
assert.equal(api.inferAssetType("登录界面上有一名少女立绘"), "game_ui", "UI words in affirmative clauses keep their priority");

// --- stripping ---------------------------------------------------------------------------------
const stripped = api.stripTemplateText(LEAKED);
assert.ok(stripped.startsWith(CORE), "the user's own description survives untouched");
assert.equal(api.findLeakedDirectorText(stripped), "", "no director marker is left after stripping");
assert.doesNotMatch(stripped, /高完成度角色CG质量|游戏 UI、图标和海报|不添加游戏界面|通用保留约束|基础质量由系统自动负责/);
assert.equal(api.findLeakedDirectorText("正常描述。用户附加要求：xxx"), "用户附加要求");
assert.equal(api.findLeakedDirectorText("正常描述，没有系统文字"), "");

// --- compileFinal on the leaked box -----------------------------------------------------------------
const local = api.compileFinal({ prompt: LEAKED, negativePrompt: "", mode: "txt2img", nsfw: true, provider: "local" });
assert.equal(local.assetType, "character");
assert.doesNotMatch(local.prompt, /商业游戏UI质量/, "no UI quality paragraph on a character prompt");
assert.doesNotMatch(local.prompt, /不添加游戏界面|游戏 UI|界面边框|操作按钮/, "local txt2img sends no UI nouns at all");
assert.equal(api.findLeakedDirectorText(local.prompt), "");
assert.equal((local.prompt.match(/高完成度角色CG质量/g) || []).length, 1, "exactly one current character instruction");
assert.match(local.negativePrompt, /游戏界面/, "the negative prompt still lists UI words for models that honour it");
const again = api.compileFinal({ prompt: local.prompt, negativePrompt: local.negativePrompt, mode: "txt2img", nsfw: true, provider: "local" });
assert.equal(again.prompt, local.prompt);
assert.equal(again.applied, false);

const cloud = api.compileFinal({ prompt: LEAKED, mode: "txt2img", provider: "gpt" });
assert.equal(cloud.assetType, "character");
assert.match(cloud.prompt, /只输出用户要求的纯画面内容，不添加游戏界面/, "cloud models keep the pure-artwork sentence");
const localImg2img = api.compileFinal({ prompt: CORE, mode: "img2img", provider: "local" });
assert.match(localImg2img.prompt, /只输出用户要求的纯画面内容/, "only local txt2img drops it");
const noProvider = api.compileFinal({ prompt: CORE, mode: "txt2img" });
assert.match(noProvider.prompt, /只输出用户要求的纯画面内容/, "default (no provider) is unchanged");

// --- the two prompt-assistant paths refuse echoed director text -------------------------------------
const smartAi = read("novaflow-smart-ai.js");
assert.match(smartAi, /if \(isArt && !usesStructuredArtPromptContract\) \{[\s\S]*?stripTemplateText\(nextPrompt\)[\s\S]*?findLeakedDirectorText\(nextPrompt\)[\s\S]*?throw new Error\(`模型把系统约束写进了提示词/);
assert.match(smartAi, /validateSmartAiArtPromptPreservation\(preservationBase, nextPrompt, state\.requirements\)/);
const brand = read("novaflow-brand-runtime.js");
assert.match(brand, /async function runArtGeneratePromptOptimize\(\)[\s\S]*?stripTemplateText\(restoredPositive\.text\)[\s\S]*?findLeakedDirectorText\(cleanedPositive\)[\s\S]*?ART_GENERATE_STATE\.prompt = cleanedPositive;/);
assert.match(brand, /async function runArtGenerate\(\)[\s\S]*?compileFinal\?\.\(\{[\s\S]*?nsfw: !!ART_GENERATE_STATE\.nsfw,\s*provider: runProvider\s*\}\)/, "runArtGenerate tells the profile which provider runs the prompt");

// --- cache busters -----------------------------------------------------------------------------------
const indexHtml = read("index.html");
assert.ok(indexHtml.includes("art-quality-profile.workflow.js?v=20260920-asset-type-guard-1"));
assert.ok(indexHtml.includes("art-generate-ideogram.workflow.js?v=20260920-ideogram-background-1"));
assert.ok(indexHtml.includes("novaflow-smart-ai.js?v=20260920-director-leak-guard-1"));
assert.ok(indexHtml.includes("novaflow-brand-runtime.js?v=20260920-art-prompt-guard-1"));
assert.ok(indexHtml.indexOf("art-quality-profile.workflow.js") < indexHtml.indexOf("novaflow-brand-runtime.js"), "the profile loads before the runtime that calls it");
assert.ok(indexHtml.indexOf("art-quality-profile.workflow.js") < indexHtml.indexOf("novaflow-smart-ai.js"), "the profile loads before the smart-AI that calls it");

console.log("art-prompt-director-leak-guard: passed");
