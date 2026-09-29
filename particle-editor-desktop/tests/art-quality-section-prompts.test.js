// 2026-09-29: 美工 generation appended the fixed per-asset quality paragraph after the AI 助手's five
// sections ([风格设定][主体物品][环境背景][光线与色彩][拍摄参数]) and it contradicted them: "保持稳定重心和
// 原有动作" against a new pose, "遵循…参考图已有的光照" against a new night scene, "线条纤细轻淡" against
// "笔触粗犷有力", "不得擅自新增…" against new set dressing. The type was guessed over the whole prompt,
// so the [环境背景] header made a girl a scene and an orange cat got the human paragraph.
// Pins: after five sections only the non-conflicting quality items go on; the type comes from
// [主体物品]; animals get animal wording; local runs keep the negated UI list out of the positive
// prompt; the Ideogram background is the [环境背景] body; "坐在图2大厅" makes 图2 the background.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const renderer = path.resolve(__dirname, "../../novaflow-web/renderer");
const context = vm.createContext({ console });
context.window = context;
context.globalThis = context;
for (const file of ["art-quality-profile.workflow.js", "art-generate-ideogram.workflow.js", "smart-ai-art-auto-intent.workflow.js"]) {
  vm.runInContext(fs.readFileSync(path.join(renderer, file), "utf8"), context, { filename: file });
}
const api = context.NovaFlowArtQualityProfile;
const ideogram = context.NovaFlowArtGenerateIdeogramWorkflow;
const autoIntent = context.NovaFlowSmartAiArtAutoIntent;

// Round-4 美工 outputs (local engine, art_one_ref and art_text_simple), as written into the prompt box.
const WARRIOR = [
  "[风格设定]",
  "国潮插画风格，厚涂技法，笔触粗犷有力，表面有金属与布料的细腻肌理。",
  "",
  "[主体物品]",
  "一位蓄着浓密黑须、怒目圆睁的武将，黑发高束成发髻，身披鲜红战袍，脚踏金靴，一只手持一柄剑鞘雕龙的长剑，另一只手前伸作劈斩之势，衣袂与发丝在风雪中飞扬。",
  "",
  "[环境背景]",
  "雪夜古城街道，前景是覆雪的青石板路，中景是飞檐斗拱的木质楼阁与灯笼，远景是被雪覆盖的城墙。",
  "",
  "[光线与色彩]",
  "主光来自雪夜中高悬的冷色调灯光，从上方斜射至武将肩部与剑刃，整体色调以雪白与灰蓝为主。",
  "",
  "[拍摄参数]",
  "全身景别，正面视角，武将居画面中央，构图饱满。"
].join("\n");
const CAT = [
  "[风格设定]",
  "水彩插画风格，柔和的笔触与自然晕染，营造温暖宁静的午后氛围。",
  "[主体物品]",
  "一只橘猫，毛色为温暖的橘红与浅白相间，正趴伏在窗台边缘，前爪轻搭窗沿，尾巴自然垂落。",
  "[环境背景]",
  "窗台由浅木色实木制成，窗外是模糊的绿植与远处建筑轮廓，远处可见阳台栏杆与一盆绿萝。",
  "[光线与色彩]",
  "阳光从右侧斜射入窗，主色调为暖橘与米白。",
  "[拍摄参数]",
  "中景镜头，平视角度，构图居中偏右。"
].join("\n");
const GIRL = CAT
  .replace(/\[主体物品\]\n[^\n]+/, "[主体物品]\n一个女孩坐在咖啡馆窗边看书，她留着及肩黑发，穿着浅灰色毛衣。")
  .replace(/\[环境背景\]\n[^\n]+/, "[环境背景]\n室内咖啡馆场景，背景有深色木质书架和几把布面座椅。");
const SECTION_OWNED = /原有动作|动作线|稳定重心|不得擅自|重新设计|参考图已有的光照|光照|线条纤细轻淡|边缘轻柔细腻|画风一致|景别|构图|裁切|近景|从头到脚|完整入画|衣装|不新增/;

test("after five sections only the items no section owns are appended", () => {
  for (const provider of ["local", "gpt", "google"]) {
    for (const mode of ["txt2img", "img2img"]) {
      const result = api.compileFinal({ prompt: WARRIOR, negativePrompt: "", mode, nsfw: false, provider });
      assert.equal(result.assetType, "character", `${provider}/${mode}`);
      assert.ok(result.prompt.startsWith(`${WARRIOR}\n\n`), "the five sections go out untouched");
      const tail = result.prompt.slice(WARRIOR.length);
      assert.doesNotMatch(tail, SECTION_OWNED, `${provider}/${mode}: ${tail}`);
      assert.match(tail, /面部五官、眼神、发丝分组、手脚与人体结构准确/);
      assert.match(tail, /材质分别呈现可信质感/);
      assert.match(tail, /以自然明暗转折塑造体积/);
      assert.match(tail, /主色、辅色、点缀色层级/);
      assert.match(tail, /精修完成度/);
      assert.equal((result.prompt.match(/CG质量：/g) || []).length, 1);
    }
  }
});

test("five sections are typed by [主体物品], not by the scene in [环境背景]", () => {
  assert.equal(api.inferAssetType(WARRIOR), "character");
  assert.equal(api.inferAssetType(GIRL), "character", "a girl in a cafe is not a scene");
  assert.equal(api.inferAssetType(CAT), "animal", "a cat on a sill is neither a person nor a scene");
  const trophy = WARRIOR.replace(/\[主体物品\]\n[^\n]+/, "[主体物品]\n银色奖杯倾斜放置于画面中央，杯身刻有五角星图案。");
  assert.equal(api.inferAssetType(trophy), "icon_prop");
});

test("animals get animal wording, never the human character paragraph", () => {
  const sectioned = api.compileFinal({ prompt: CAT, mode: "txt2img", provider: "gpt" });
  const plain = api.compileFinal({ prompt: "一只橘猫趴在窗台上晒太阳", mode: "txt2img", provider: "gpt" });
  for (const result of [sectioned, plain]) {
    assert.equal(result.assetType, "animal");
    assert.doesNotMatch(result.directorInstruction, /人体|发丝|皮肤|五官|角色|建筑、岩石|植被、水体/);
    assert.match(result.directorInstruction, /骨骼结构与身体比例准确/);
    assert.match(result.directorInstruction, /毛发、羽毛或鳞片分组清晰/);
    assert.match(result.directorInstruction, /眼睛有神/);
    assert.match(result.directorInstruction, /爪掌与四肢结构准确/);
    assert.doesNotMatch(result.negativePrompt, /错误人体|畸形手指|蜡像皮肤|低细节头发/);
    assert.match(result.negativePrompt, /畸形爪子/);
  }
  assert.doesNotMatch(sectioned.directorInstruction, SECTION_OWNED);
  assert.equal(api.build({ prompt: "宠物", assetType: "pet" }).assetType, "animal");
});

test("a person word wins over an animal word, and animal-shaped words are not animals", () => {
  assert.equal(api.inferAssetType("猫耳少女坐在窗边"), "character");
  assert.equal(api.inferAssetType("一位骑马的武将冲锋"), "character");
  assert.equal(api.inferAssetType("一个女孩坐在咖啡馆窗边看书，背景是木质书架"), "character");
  assert.equal(api.inferAssetType("一只小狗在草地上奔跑"), "animal");
  assert.equal(api.inferAssetType("蝴蝶结发卡道具"), "icon_prop");
  assert.equal(api.inferAssetType("冬日森林场景，远处的城堡"), "scene");
});

test("plain prompts keep the full paragraph they had", () => {
  const raw = "东方幻想游戏女性角色，全身立绘，白色背景，青蓝色长裙，手持水系法器";
  const result = api.compileFinal({ prompt: raw, negativePrompt: "", mode: "txt2img", provider: "gpt" });
  assert.equal(result.assetType, "character");
  assert.ok(result.prompt.startsWith(`${raw}\n\n高完成度角色CG质量：用户指定的角色身份`));
  for (const clause of ["不得擅自新增、删减或重新设计原图内容", "保持稳定重心和原有动作", "遵循用户指定或参考图已有的光照", "线条纤细轻淡", "用户已明确提出衣装内容时", "只输出用户要求的纯画面内容"]) {
    assert.ok(result.prompt.includes(clause), clause);
  }
  assert.match(result.negativePrompt, /粗黑描边/);
});

test("local runs keep the negated UI list out of the positive prompt; GPT and Google keep it", () => {
  for (const prompt of [WARRIOR, CAT, "一名少女站在窗边"]) {
    for (const mode of ["txt2img", "img2img"]) {
      const local = api.compileFinal({ prompt, mode, provider: "local" });
      assert.doesNotMatch(local.prompt, /不添加游戏界面|界面边框|操作按钮|状态栏|菜单面板/, `local ${mode}`);
      assert.match(local.negativePrompt, /游戏界面，界面边框，操作按钮/, "the negative prompt still carries them");
      for (const provider of ["gpt", "google"]) {
        assert.match(api.compileFinal({ prompt, mode, provider }).prompt, /只输出用户要求的纯画面内容，不添加游戏界面/, `${provider} ${mode}`);
      }
    }
  }
  assert.match(api.compileFinal({ prompt: "一名少女站在窗边", mode: "img2img" }).prompt, /只输出用户要求的纯画面内容/, "no provider named: unchanged");
});

test("compiling again is a no-op, and any paragraph ever appended is replaced", () => {
  for (const prompt of [WARRIOR, CAT, GIRL, "一只橘猫趴在窗台上晒太阳"]) {
    for (const provider of ["local", "gpt"]) {
      const first = api.compileFinal({ prompt, mode: "img2img", provider });
      const second = api.compileFinal({ prompt: first.prompt, negativePrompt: first.negativePrompt, mode: "img2img", provider });
      assert.equal(second.prompt, first.prompt);
      assert.equal(second.negativePrompt, first.negativePrompt);
      assert.equal(second.applied, false);
    }
  }
  // A section prompt that still carries the old plain paragraph (and its UI sentence) gets the new one.
  const old = api.compileFinal({ prompt: "一名少女", assetType: "character", provider: "gpt" }).directorInstruction;
  const migrated = api.compileFinal({ prompt: `${WARRIOR}\n\n${old}`, provider: "gpt" });
  assert.equal(migrated.prompt, api.compileFinal({ prompt: WARRIOR, provider: "gpt" }).prompt);
  // Every paragraph, plain or after sections, for every asset type, is recognised as ours.
  for (const assetType of ["character", "animal", "scene", "game_ui", "icon_prop", "vfx", "poster"]) {
    for (const base of [WARRIOR, "一名少女站在窗边。"]) {
      const compiled = api.compileFinal({ prompt: base, assetType, provider: "gpt" });
      assert.notEqual(compiled.prompt, base, assetType);
      assert.equal(api.stripTemplateText(compiled.prompt), base, `${assetType} after ${base.slice(0, 6)}`);
    }
  }
});

test("five sections take their line style from [风格设定] only", () => {
  const cel = WARRIOR.replace("国潮插画风格，厚涂技法", "日式赛璐璐动画风格");
  assert.equal(api.compileFinal({ prompt: cel, provider: "gpt" }).explicitFlatStyle, true);
  const sketchProp = WARRIOR.replace("手持一柄剑鞘雕龙的长剑", "手持一张线稿草图");
  const result = api.compileFinal({ prompt: sketchProp, provider: "gpt" });
  assert.equal(result.explicitFlatStyle, false, "a line drawing the warrior holds is content, not the style");
  assert.match(result.directorInstruction, /面部五官/);
});

test("Ideogram: five sections give the [环境背景] body as background and a header-free description", () => {
  const compiled = api.compileFinal({ prompt: CAT, mode: "txt2img", provider: "local" }).prompt;
  const env = "窗台由浅木色实木制成，窗外是模糊的绿植与远处建筑轮廓，远处可见阳台栏杆与一盆绿萝。";
  assert.equal(ideogram.extractBackground(CAT), env);
  const structured = JSON.parse(ideogram.compileStructuredPrompt(compiled));
  assert.equal(structured.compositional_deconstruction.background, env);
  assert.doesNotMatch(structured.compositional_deconstruction.background, /橘猫|\[/);
  const description = structured.high_level_description;
  assert.doesNotMatch(description, /\[(?:风格设定|主体物品|环境背景|光线与色彩|拍摄参数)\]/);
  for (const line of CAT.split("\n").filter((item) => !item.startsWith("["))) assert.ok(description.includes(line), line);
  assert.match(description, /高完成度动物CG质量/);
  // Free-form prompts are unchanged.
  assert.equal(ideogram.extractBackground("一名少女坐在日式房间里。木地板与纸门，自然光。"), "木地板与纸门，自然光");
  assert.equal(JSON.parse(ideogram.compileStructuredPrompt("少女站在樱花树下。")).high_level_description, "少女站在樱花树下。");
});

test("a subject placed inside picture N makes picture N the background", () => {
  const roles = (userIntent) => {
    const intent = autoIntent.derive({ imageCount: 2, userIntent });
    return [Array.from(intent.roles).join("+"), intent.roleConfidence];
  };
  assert.deepEqual(roles("图1的橘猫坐在图2大厅的地毯上，抬头看向镜头"), ["subject+background", "high"]);
  assert.deepEqual(roles("图1的女孩放进图2里"), ["subject+background", "high"]);
  assert.deepEqual(roles("把图1的猫放在图2"), ["subject+background", "high"]);
  assert.deepEqual(roles("把图1的风格迁移到图2"), ["subject+style", "low"], "a transfer target is not a place");
  assert.deepEqual(roles("图1的角色站在图2的场景中央，看向镜头"), ["subject+background", "high"]);
  assert.deepEqual(roles("把图1画成图2的风格"), ["subject+style", "high"]);
  assert.deepEqual(roles("在图2的风格基础上重画图1"), ["subject+style", "high"], "a named role still wins");
  assert.deepEqual(roles("提升完成度"), ["subject+style", "low"], "no cue: the default stays and asks to confirm");
});
