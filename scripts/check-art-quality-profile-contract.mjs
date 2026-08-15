import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync("particle-editor/art-quality-profile.workflow.js", "utf8");
const sandbox = { window: {} };
runInNewContext(source, sandbox);

const api = sandbox.window.NovaFlowArtQualityProfile;
assert.equal(api.version, "art-quality-v1");

const character = api.compileFinal({
  prompt: "东方幻想游戏女性角色，全身立绘，白色背景，青蓝色长裙，手持水系法器",
  negativePrompt: ""
});
assert.equal(character.assetType, "character");
assert.match(character.prompt, /高完成度角色CG质量/);
assert.doesNotMatch(character.prompt, /商业游戏角色|商业游戏角色立绘/);
assert.match(character.prompt, /全身时必须从头到脚完整入画/);
assert.match(character.prompt, /不得擅自新增、删减或重新设计原图内容/);
assert.match(character.prompt, /皮肤、头发及原图已有材质/);
assert.match(character.prompt, /只输出用户要求的纯画面内容/);
assert.doesNotMatch(character.prompt, /绘图质量协议|art-quality-v1\/character/);
assert.match(character.negativePrompt, /粗黑描边/);
assert.match(character.negativePrompt, /畸形手指/);
assert.doesNotMatch(character.negativePrompt, /服装粘连|随机飘带/);
assert.match(character.negativePrompt, /游戏界面/);
assert.match(character.negativePrompt, /操作按钮/);
assert.match(character.negativePrompt, /伪文字/);

const contentNeutralImg2Img = api.compileFinal({
  prompt: "将参考图重绘成高质量二次元游戏CG，忠实保持原图内容",
  negativePrompt: "",
  mode: "img2img",
  nsfw: true
});
assert.doesNotMatch(contentNeutralImg2Img.prompt, /服装下摆|服装有清楚|完整服装|织物、半透明薄纱/);
assert.doesNotMatch(contentNeutralImg2Img.negativePrompt, /服装粘连|随机飘带/);
assert.match(contentNeutralImg2Img.prompt, /可见外观状态/);

const explicitClothingDesign = api.compileFinal({
  prompt: "东方女性角色，设计一套青蓝色长裙和金属腰饰",
  negativePrompt: ""
});
assert.match(explicitClothingDesign.prompt, /用户已明确提出衣装内容时/);
assert.match(explicitClothingDesign.prompt, /不改变覆盖范围/);

const idempotent = api.compileFinal({ prompt: character.prompt, negativePrompt: character.negativePrompt });
assert.equal(idempotent.applied, false);
assert.equal(idempotent.prompt, character.prompt);
assert.equal(idempotent.negativePrompt, character.negativePrompt);

const cel = api.compileFinal({
  prompt: "东方女性角色，明确采用粗黑描边赛璐璐风格",
  negativePrompt: ""
});
assert.equal(cel.explicitFlatStyle, true);
assert.doesNotMatch(cel.negativePrompt, /粗黑描边/);
assert.match(cel.prompt, /保持用户明确指定/);

const ui = api.compileFinal({ prompt: "高品质老虎机主界面，包含转轴和大奖按钮" });
assert.equal(ui.assetType, "game_ui");
assert.match(ui.prompt, /商业游戏UI质量/);
assert.doesNotMatch(ui.prompt, /只输出用户要求的纯画面内容|绘图质量协议|art-quality-v1\/game_ui/);
assert.doesNotMatch(ui.negativePrompt, /游戏界面|操作按钮|状态栏|菜单面板/);

const poster = api.compileFinal({ prompt: "东方幻想游戏宣传海报，预留标题区域" });
assert.equal(poster.assetType, "poster");
assert.match(poster.prompt, /商业宣传主视觉质量/);
assert.doesNotMatch(poster.prompt, /只输出用户要求的纯画面内容|绘图质量协议|art-quality-v1\/poster/);
assert.doesNotMatch(poster.negativePrompt, /文字标签|伪文字/);

const runtime = readFileSync("particle-editor/novaflow-brand-runtime.js", "utf8");
const smartAi = readFileSync("particle-editor/novaflow-smart-ai.js", "utf8");
const index = readFileSync("particle-editor/index.html", "utf8");
assert.ok(index.indexOf("art-quality-profile.workflow.js") < index.indexOf("novaflow-brand-runtime.js"));
assert.match(runtime, /NovaFlowArtQualityProfile\?\.compileFinal/);
assert.match(runtime, /purpose: "art-quality-optimize"/);
assert.match(runtime, /nsfw: !!ART_GENERATE_STATE\.nsfw/);
assert.match(smartAi, /sharedQualityProfile\?\.directorInstruction/);
assert.doesNotMatch(smartAi, /完整服装结构|人物增强面部、眼睛、头发、皮肤、服装与配饰/);
assert.match(smartAi, /不主动新增穿着或装饰内容/);

console.log("art-quality-profile-contract: PASS");
