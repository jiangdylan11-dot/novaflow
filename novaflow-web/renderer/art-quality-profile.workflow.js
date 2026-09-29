(function initNovaFlowArtQualityProfile(global) {
  "use strict";

  const PROFILE_VERSION = "art-quality-v1";
  const EXPLICIT_FLAT_STYLE_RE = /(赛璐璐|cel[\s-]?shad|漫画粗线|粗线稿|漫画线稿|墨线插画|美式卡通|粗黑描边|黑色外轮廓|厚重墨线|线稿|ink(?:ed)?\s+line|pixel\s*art|像素画|低多边形|low[\s-]?poly)/i;
  const EXPLICIT_CLOTHING_DESIGN_RE = /(服装设计|服饰设计|时装|衣装|穿搭|裙装|长裙|短裙|礼服|制服|铠甲|盔甲|披风|斗篷|长袍|上衣|下装|裤装|鞋靴|帽饰|outfit|costume|fashion|dress|skirt|uniform|armor|cape|robe)/i;
  const ASSET_ALIASES = {
    character: "character",
    role: "character",
    person: "character",
    animal: "animal",
    creature: "animal",
    pet: "animal",
    scene: "scene",
    environment: "scene",
    background: "scene",
    game_ui: "game_ui",
    ui: "game_ui",
    icon_prop: "icon_prop",
    icon: "icon_prop",
    prop: "icon_prop",
    vfx: "vfx",
    effect: "vfx",
    poster: "poster",
    key_visual: "poster"
  };

  const PREVIOUS_CHARACTER_INSTRUCTION = "高完成度角色CG质量：用户指定的角色身份、可见外观状态、姿态、景别、构图和道具最高优先，不得擅自新增、删减或重新设计原图内容，不得擅自改成近景或裁切主体；用户要求全身时必须从头到脚完整入画，脚部和核心道具都保留在画面内。建立清晰轮廓、稳定重心和有表现力的动作线；面部五官、眼神、发丝分组、手脚与人体结构准确。皮肤、头发及原图已有材质分别呈现可信质感，遵循用户指定或参考图已有的光照，以自然明暗转折塑造体积。配色遵循主色、辅色、点缀色层级；轮廓主要由明暗、色彩和材质边缘建立，边缘干净自然，与用户指定或原图已有的画风一致。画面达到高品质角色插画的精修完成度。";
  const PROFILE_INSTRUCTIONS = {
    character: "高完成度角色CG质量：用户指定的角色身份、可见外观状态、姿态、景别、构图和道具最高优先，不得擅自新增、删减或重新设计原图内容，不得擅自改成近景或裁切主体；用户要求全身时必须从头到脚完整入画，脚部和核心道具都保留在画面内。保持稳定重心和原有动作；面部五官、眼神、发丝分组、手脚与人体结构准确。皮肤、头发及原图已有材质分别呈现可信质感，遵循用户指定或参考图已有的光照，以自然明暗转折塑造体积。配色遵循主色、辅色、点缀色层级；轮廓由局部固有色与明暗过渡自然衔接，边缘轻柔细腻，线条纤细轻淡，与用户指定或原图已有的画风一致。画面达到高品质角色插画的精修完成度。",
    animal: "高完成度动物CG质量：用户指定的动物种类、可见外观状态、姿态、景别、构图和道具最高优先，不得擅自新增、删减或重新设计原图内容，不得擅自改成近景或裁切主体；用户要求全身时必须完整入画，四肢、尾巴和核心道具都保留在画面内。保持稳定重心和原有动作；骨骼结构与身体比例准确，毛发、羽毛或鳞片分组清晰，眼部、爪掌与四肢结构准确。毛发及原图已有材质分别呈现可信质感，遵循用户指定或参考图已有的光照，以自然明暗转折塑造体积。配色遵循主色、辅色、点缀色层级；轮廓由局部固有色与明暗过渡自然衔接，边缘轻柔细腻，线条纤细轻淡，与用户指定或原图已有的画风一致。画面达到高品质动物插画的精修完成度。",
    scene: "高完成度场景CG质量：建立明确前中后景、主地标、视线引导、尺度参照和可用空间；透视、结构、接触关系与光源方向一致。建筑、岩石、植被、水体和空气透视具有不同材质层次，重点区域细节密度高、次要区域主动收敛，形成可读的大形与专业级氛围光。",
    game_ui: "商业游戏UI质量：建立明确的信息层级、功能分区、按钮状态、文字安全区和操作焦点；边框、面板、图标与装饰使用统一的形状语言和材质逻辑。保证文字区域可读、控件可执行、九宫格与切图可落地，不生成伪文字堆叠或只可观看而不可使用的概念图。",
    icon_prop: "高完成度图标与道具质量：轮廓一眼可识别，视角、结构、功能和受力关系明确；金属、木材、皮革、玻璃、宝石与能量体材质区分清楚。用受控高光、接触阴影和局部磨损表现体积，背景与特效不遮挡主体，适合缩小后识别及真实资产落地。",
    vfx: "高完成度特效质量：明确核心形状、运动方向、节奏层级、能量密度和透明边缘；主爆点、拖尾、粒子和余辉层次分明，亮度不过曝，颜色不脏，避免无意义噪点和大面积雾化，保持可抠取、可序列化的资产边界。",
    poster: "商业宣传主视觉质量：建立唯一视觉焦点、清晰叙事层级、标题与文案安全区；人物、道具、环境和特效围绕焦点组织，具有大形节奏、空间纵深、受控光色和高级材质表现。保留足够留白与裁切余量，达到商业游戏KV与网页美宣的精修完成度。"
  };
  // The AI 助手's five sections ([风格设定][主体物品][环境背景][光线与色彩][拍摄参数]) already decide
  // pose and action, the light source, line and brush style, framing and what is added or removed.
  // After them goes only what cannot contradict a section: structure, materials, volume from light
  // and shade, colour hierarchy and finish.
  const SECTION_INSTRUCTIONS = {
    character: "高完成度角色CG质量：面部五官、眼神、发丝分组、手脚与人体结构准确；皮肤、头发与服饰材质分别呈现可信质感，以自然明暗转折塑造体积；配色遵循主色、辅色、点缀色层级，画面达到高品质角色插画的精修完成度。",
    animal: "高完成度动物CG质量：骨骼结构与身体比例准确，毛发、羽毛或鳞片分组清晰，眼部、爪掌与四肢结构准确；各部分材质呈现可信质感，以自然明暗转折塑造体积；配色遵循主色、辅色、点缀色层级，画面达到高品质插画的精修完成度。",
    scene: "高完成度场景CG质量：透视、结构与接触关系准确，不同材质层次分明、质感可信，以明暗关系塑造空间与体积；重点区域细节密度高、次要区域主动收敛，配色层级清晰，画面达到专业场景插画的精修完成度。",
    game_ui: "商业游戏UI质量：信息层级清晰，边框、面板、图标与装饰使用统一的形状语言和材质逻辑，文字区域可读，不生成伪文字堆叠，画面达到可落地的精修完成度。",
    icon_prop: "高完成度道具质量：结构、功能与受力关系准确，各类材质区分清楚、质感可信，以受控高光与接触阴影表现体积，配色层级清晰，画面达到可落地资产的精修完成度。",
    vfx: "高完成度特效质量：核心形状、运动方向与能量层次分明，亮度不过曝，颜色不脏，避免无意义噪点和大面积雾化，画面达到精修完成度。",
    poster: "商业宣传主视觉质量：视觉焦点与叙事层级清晰，主体结构准确、材质可信，以明暗塑造体积与空间纵深，配色层级清晰，画面达到商业美宣的精修完成度。"
  };
  // [风格设定] names the style (像素画, 低多边形, 赛璐璐 …) and [拍摄参数] the framing, so this neither
  // names a style nor asks for composition. FLAT_STYLE_INSTRUCTION_RE removes it like the plain one.
  const SECTION_FLAT_STYLE_INSTRUCTION = "商业资产完成度：保持用户明确指定的画风与表现语言，不改成写实厚涂；结构、色彩层级与细节准确，主体清晰、风格统一，可直接用于游戏资产。";
  // Worded "眼睛有神" before 2026-09-29 (an eye state the sections own); kept so old copies are removed.
  const PREVIOUS_ANIMAL_INSTRUCTIONS = [PROFILE_INSTRUCTIONS.animal, SECTION_INSTRUCTIONS.animal]
    .map((text) => text.replace("眼部、爪掌与四肢结构准确", "眼睛有神，爪掌与四肢结构准确"));
  const SECTION_NAMES = ["风格设定", "主体物品", "环境背景", "光线与色彩", "拍摄参数"];
  const SECTION_SPLIT_RE = /(?:^|\n)[ \t]*[[【](风格设定|主体物品|环境背景|光线与色彩|拍摄参数)[\]】]/;
  // Who the picture is of. A person word wins over an animal word (猫耳少女, 骑马的武将, 兽人, 美人鱼);
  // 马尾, 猫眼, 龙纹, 蝴蝶结, 熊熊, 孔雀蓝, 鹅黄, 鱼肚白, 鸟居, 虎牙, 马丁靴 and the like are not animals.
  const PERSON_RE = /(角色|人物|人像|肖像|女性|男性|女子|男子|女人|男人|女孩|男孩|女生|男生|学生|少女|少年|娘|美女|帅哥|青年|老人|老者|儿童|小孩|孩子|婴儿|宝宝|妈妈|爸爸|母亲|父亲|奶奶|爷爷|女士|先生|小姐|英雄|武将|武士|战士|士兵|将军|骑士|剑客|侠客|猎人|渔夫|农夫|牧羊人|商人|僧人|厨师|弓箭手|刺客|公主|王子|国王|女王|皇帝|法师|巫师|女巫|魔女|忍者|兽人|狼人|人鱼|人马|女妖|女郎|人类|她|(?<![其吉])他|(?<![第唯同单统])[一两二三四五六七八九十几多](?:[位名]|个人)|一群人|人们|\b(?:character|girl|boy|woman|women|man|men|person|people|hero|knight|warrior|lady|portrait)s?\b)/i;
  const ANIMAL_RE = /(动物|宠物|萌宠|幼崽|野兽|神兽|猫(?![耳眼娘])|狗|犬|狐狸(?!眼)|狼(?![尾烟藉狈])|老虎|虎(?![纹口牙])|(?<![石舞])狮|豹(?!纹)|熊猫|(?<!熊)熊(?!熊)|兔(?![耳牙])|鹿(?!角)|(?<!罗)马(?![尾甲靴车路赛克丁卡桶铃])|奶牛|公牛|水牛|牦牛|山羊|绵羊|羊驼|猪|松鼠|仓鼠|老鼠|猴|大象|鸟(?![瞰居])|鹰(?!钩)|鸽|鹤|鸭(?!舌)|鹅(?![黄蛋卵绒])|公鸡|母鸡|小鸡|孔雀(?![蓝绿石])|鹦鹉|企鹅|麻雀|鱼(?![尾鳞网肚骨竿])|鲸|海豚|鲨|乌龟|海龟|蛇|蜥蜴|青蛙|蝴蝶(?!结)|昆虫|恐龙|(?<!火)龙(?![纹袍头形鳞卷舟])|凤凰|独角兽|\b(?:animal|pet|cat|kitten|dog|puppy|fox|wolf|tiger|lion|bear|rabbit|bunny|deer|horse|bird|owl|fish|dragon|creature)s?\b)/i;
  // A [主体物品] that describes a figure without naming one (长发, 鹅蛋脸, 身穿皮夹克).
  const FIGURE_HINT_RE = /(五官|脸|眼神|发型|长发|短发|卷发|发髻|辫|身穿|穿着|身披|头戴|手持|手握|双手)/;

  const PROFILE_NEGATIVES = {
    character: "粗黑描边，统一黑色外轮廓，厚重墨线，扁平赛璐璐，蜡像皮肤，塑料材质，材质无差异，低细节头发，结构粘连，无依据新增装饰，错误人体，畸形手指，多余手脚，五官错位，特效遮脸，过曝高光，噪点，低完成度",
    animal: "粗黑描边，统一黑色外轮廓，厚重墨线，扁平赛璐璐，塑料材质，材质无差异，低细节毛发，毛发粘连，结构粘连，无依据新增装饰，骨骼结构错误，比例失调，畸形爪子，多余肢体，五官错位，过曝高光，噪点，低完成度",
    scene: "透视错误，尺度混乱，物体漂浮，结构变形，材质重复，细节平均，焦点混乱，脏色，过曝，噪点，低完成度",
    game_ui: "伪文字，乱码，信息层级混乱，按钮状态缺失，控件不可执行，间距不一致，装饰遮挡内容，低对比度，边缘脏污，低完成度",
    icon_prop: "轮廓模糊，结构错误，材质混合，塑料感，视角不一致，主体被裁切，背景遮挡，过曝，噪点，低完成度",
    vfx: "主体不明，能量糊成一团，边缘脏污，亮度过曝，黑底污染，无意义粒子，节奏平均，低完成度",
    poster: "焦点混乱，构图拥挤，标题无安全区，人物变形，材质塑料感，光源冲突，特效遮脸，过曝，噪点，低完成度"
  };
  const FLAT_STYLE_BODY_NEGATIVES = { character: "错误人体，畸形手指，多余手脚，五官错位", animal: "骨骼结构错误，畸形爪子，多余肢体" };
  const PURE_ARTWORK_ASSET_TYPES = new Set(["character", "animal", "scene", "icon_prop", "vfx"]);
  const PURE_ARTWORK_INSTRUCTION = "只输出用户要求的纯画面内容，不添加游戏界面、界面边框、操作按钮、状态栏、菜单面板、文字标签、Logo或水印。";
  const PURE_ARTWORK_NEGATIVE = "游戏界面，界面边框，操作按钮，状态栏，菜单面板，文字标签，伪文字，Logo，水印";
  const CLOTHING_DESIGN_INSTRUCTION = "用户已明确提出衣装内容时，仅精修用户指定或原图可见的衣装结构、材质与细节，不新增其他服饰，不改变覆盖范围。";
  // Match only the exact suffix emitted by the previous compiler. Never remove
  // individual lighting/outline words from user-authored prompts or history.
  const LEGACY_CHARACTER_INSTRUCTION = PREVIOUS_CHARACTER_INSTRUCTION
    .replace("遵循用户指定或参考图已有的光照，以自然明暗转折塑造体积", "使用柔和体积光、受控轮廓光和自然明暗转折塑造体积")
    .replace("边缘干净自然，与用户指定或原图已有的画风一致", "只允许局部细弱彩色辅助线");

  function clean(value) {
    return String(value || "").trim();
  }

  // Every sentence this module (or the smart-AI director, see novaflow-smart-ai.js) has ever appended.
  // They are stripped wherever they sit, so a prompt that already carries an old copy, or a prompt
  // assistant that echoed the director text back into the prompt, never gets judged or re-sent with it.
  const TEMPLATE_TEXTS = [
    PREVIOUS_CHARACTER_INSTRUCTION,
    LEGACY_CHARACTER_INSTRUCTION,
    ...Object.values(PROFILE_INSTRUCTIONS),
    ...Object.values(SECTION_INSTRUCTIONS),
    ...PREVIOUS_ANIMAL_INSTRUCTIONS,
    CLOTHING_DESIGN_INSTRUCTION,
    PURE_ARTWORK_INSTRUCTION
  ].sort((a, b) => b.length - a.length);
  const FLAT_STYLE_INSTRUCTION_RE = /商业资产完成度：保持用户明确指定的[^。\n]*?可直接用于游戏资产。/g;
  const LEAKED_DIRECTOR_MARKER_RE = /用户附加要求|用户补充要求|设计控件约束|通用保留约束|基础质量由系统自动负责|只作为最终提示词约束|不作为图片可见事实|用户本次(?:修改|创作)要求|提示词(?:编辑|创作)模式/;
  const LEAKED_DIRECTOR_SENTENCE_RE = new RegExp(`[^。\\n]*(?:${LEAKED_DIRECTOR_MARKER_RE.source})[^。\\n]*。?`, "g");
  // Multi-sentence director paragraphs (novaflow-smart-ai.js artAutomaticQualityInstruction and the
  // per-asset 约束 lines) are removed as whole blocks, first sentence to last.
  const LEAKED_DIRECTOR_BLOCK_RES = [
    /基础质量由系统自动负责[\s\S]*?不要求用户重复选择基础质量项。?/g,
    /(?:角色资产|场景资产|游戏 UI|图标道具|特效资产|宣传海报|通用保留|从零创作|角色创作|场景创作|图标道具创作|特效创作|宣传海报创作)约束：[^。\n]*。?/g,
    /(?:风格优先级|背景处理)：[^。\n]*。?/g
  ];
  // "不添加游戏界面" is a complaint, not a request: only clauses that ask for something count.
  const NEGATED_CLAUSE_RE = /(不添加|不要(?!改动|变动)|不得(?!改动|变动)|不生成|不含|不带|没有|避免|禁止|去掉|去除|取消|without|avoid|\bno\b)/i;

  function stripTemplateText(value) {
    let text = clean(value);
    TEMPLATE_TEXTS.forEach((snippet) => {
      text = text.split(snippet).join(" ");
    });
    text = text.replace(FLAT_STYLE_INSTRUCTION_RE, " ");
    LEAKED_DIRECTOR_BLOCK_RES.forEach((pattern) => {
      text = text.replace(pattern, " ");
    });
    text = text.replace(LEAKED_DIRECTOR_SENTENCE_RE, " ");
    return text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function findLeakedDirectorText(value) {
    const match = clean(value).match(LEAKED_DIRECTOR_MARKER_RE);
    return match ? match[0] : "";
  }

  function affirmativeClauses(text) {
    return clean(text).split(/[，,。；;！!？?\n]+/).filter((clause) => !NEGATED_CLAUSE_RE.test(clause)).join("，");
  }

  function normalizeAssetType(value) {
    const key = clean(value).toLowerCase();
    return ASSET_ALIASES[key] || "";
  }

  // The AI 助手's five-section prompt as { 风格设定, 主体物品, ... }, or null when a header is missing.
  function readSections(value) {
    const parts = clean(value).split(SECTION_SPLIT_RE);
    const sections = {};
    for (let index = 1; index < parts.length; index += 2) {
      sections[parts[index]] = [sections[parts[index]], clean(parts[index + 1])].filter(Boolean).join("\n");
    }
    return SECTION_NAMES.every((name) => name in sections) ? sections : null;
  }

  function inferAssetType(prompt, explicitType) {
    const normalized = normalizeAssetType(explicitType);
    if (normalized) return normalized;
    const stripped = stripTemplateText(prompt);
    const compiledType = stripped.match(/绘图质量协议（art-quality-v1\/(character|scene|game_ui|icon_prop|vfx|poster)）/i)?.[1];
    if (compiledType) return compiledType.toLowerCase();
    // Judged on the user's own affirmative text: template sentences and "不要 UI" clauses cannot
    // turn a character prompt into a game-UI prompt (which would append the UI quality paragraph).
    // A five-section prompt: the kind (UI, poster, effect, prop) is read without [环境背景], which is
    // always there and names a scene, and without [光线与色彩]; who it is of is read in [主体物品].
    const sections = readSections(stripped);
    const kind = affirmativeClauses(sections ? [sections["风格设定"], sections["主体物品"], sections["拍摄参数"]].join("\n") : stripped);
    const subject = sections ? affirmativeClauses(sections["主体物品"]) : kind;
    if (/(UI|界面|HUD|按钮|面板|老虎机|slot|大厅页|登录页)/i.test(kind)) return "game_ui";
    if (/(海报|KV|主视觉|美宣|banner|landing\s*page|宣传图)/i.test(kind)) return "poster";
    // Only a person blocks the effect, prop and scene kinds (猫咪头像图标, 森林场景里的一只鹿).
    const person = PERSON_RE.test(subject);
    const figure = person || /(全身|半身)/.test(kind);
    if (/(特效|VFX|法术|爆炸|拖尾|光效|粒子)/i.test(kind) && !figure) return "vfx";
    if (/(图标|icon|道具|武器|装备|宝箱|徽章|奖杯)/i.test(kind) && !person) return "icon_prop";
    if (!sections && /(场景|环境|建筑|森林|城市|地牢|地图|背景)/i.test(kind) && !figure) return "scene";
    if (!person && ANIMAL_RE.test(subject)) return "animal";
    // A [主体物品] with no person, animal or figure in it is a landscape, a building or a thing: scene,
    // as these prompts were typed before. A plain prompt keeps its character default.
    return !sections || figure || FIGURE_HINT_RE.test(subject) ? "character" : "scene";
  }

  function hasExplicitFlatStyle(prompt, style) {
    // A complaint about a style is not a request to apply that style.
    const affirmative = clean(prompt).split(/[，,。；;！!？?\n]+/).filter((clause) =>
      !/(不要(?!改动|变动)|避免|禁止|不得(?!改动|变动)|去掉|去除|取消|减轻|减弱|弱化|降低|减少|太黑|太重|太粗|过黑|过重|过粗|without|avoid|no\s)/i.test(clause)
    ).join("，");
    return style === "cel_comic" || style === "pixel" || EXPLICIT_FLAT_STYLE_RE.test(`${clean(style)} ${affirmative}`);
  }

  // 塑料质感, 塑料材质 and 塑料感 are one term, and so are 畸形爪子 and 爪子畸形.
  function negativeTermKey(term) {
    return term.toLowerCase().replace(/^畸形(.+)$/u, "$1畸形").replace(/(?:质感|材质|感)$/u, "");
  }

  function mergeNegativePrompt(base, addition) {
    const parts = clean(base).split(/[,，、;；\n]+/).map((item) => item.trim()).filter(Boolean);
    clean(addition).split(/[,，、;；\n]+/).map((item) => item.trim()).filter(Boolean).forEach((item) => {
      if (!parts.some((existing) => negativeTermKey(existing) === negativeTermKey(item))) parts.push(item);
    });
    return parts.join("，");
  }

  function canApplySoftEdgeEdit(prompt, requirements) {
    const source = clean(prompt);
    if (!source || source.length > 2000 || /[\r\n]|__NOVAFLOW_|@(?:参考图[1-9][0-9]*|视频参考|声音参考)|\[[^\]]+\]|【[^】]+】/.test(source)) return false;
    if (/粗黑描边|黑色外轮廓|厚重墨线|粗线稿|漫画|赛璐璐|像素/.test(source)) return false;
    const instruction = clean(requirements).replace(/\s+/g, "").replace(/^[，,。.!！]+|[，,。.!！]+$/g, "").replace(/^请/, "");
    const target = "(?:人体|人物|角色|身体)?的?(?:黑色)?(?:描边|轮廓线|外轮廓)";
    const excess = "(?:(?:过于|过|太)?(?:黑|重|粗|厚重|浓重))+";
    return [
      `(?:不要|避免)${excess}的?${target}`,
      `${target}(?:不要|避免)${excess}`,
      `(?:减轻|减弱|弱化|淡化)${target}`,
      `(?:把|将)?${target}(?:改得|变得|调整得|改为|变为)?(?:更细更淡|细一点|淡一点|轻一点|纤细轻淡)`
    ].some((pattern) => new RegExp(`^(?:${pattern})$`).test(instruction));
  }

  function build(options) {
    const source = options || {};
    const prompt = stripTemplateText(source.prompt);
    const style = clean(source.style).toLowerCase();
    const assetType = inferAssetType(prompt, source.assetType);
    const sections = readSections(prompt);
    // A five-section prompt states its drawing style in [风格设定]; 线稿 elsewhere in it is content.
    const explicitFlatStyle = hasExplicitFlatStyle(sections ? sections["风格设定"] : prompt, style);
    const basePositiveInstruction = explicitFlatStyle
      ? (sections
        ? SECTION_FLAT_STYLE_INSTRUCTION
        : `商业资产完成度：保持用户明确指定的${style === "pixel" ? "像素" : "线稿/赛璐璐"}表现语言，不改成写实厚涂；提升构图、结构、色彩层级、边缘控制和细节准确性，保证主体清晰、风格统一、可直接用于游戏资产。`)
      : (sections ? SECTION_INSTRUCTIONS : PROFILE_INSTRUCTIONS)[assetType];
    const clothingDesignInstruction = !sections && assetType === "character" && EXPLICIT_CLOTHING_DESIGN_RE.test(prompt)
      ? CLOTHING_DESIGN_INSTRUCTION
      : "";
    // Both local txt2img models (Ideogram 4 Instant, Qwen Rapid) sample at cfg 1: a negated list of UI
    // words in the positive prompt is at best ignored and at worst read as a mention, so it stays out there.
    // Local img2img keeps it: the Qwen-Image-2.1 edit graph gets only the user's own negative box (this
    // profile's negative is for the 2511 route), so the sentence is the only UI suppression it has.
    const localTxt2img = String(source.provider || "").toLowerCase() === "local" && String(source.mode || "").toLowerCase() === "txt2img";
    const pureArtworkInstruction = PURE_ARTWORK_ASSET_TYPES.has(assetType) && !localTxt2img ? PURE_ARTWORK_INSTRUCTION : "";
    const positiveInstruction = [basePositiveInstruction, clothingDesignInstruction, pureArtworkInstruction].filter(Boolean).join("");
    const baseNegativeInstruction = explicitFlatStyle
      ? mergeNegativePrompt(FLAT_STYLE_BODY_NEGATIVES[assetType], "结构粘连，轮廓脏乱，噪点，低完成度")
      : PROFILE_NEGATIVES[assetType];
    const negativeInstruction = mergeNegativePrompt(
      baseNegativeInstruction,
      PURE_ARTWORK_ASSET_TYPES.has(assetType) ? PURE_ARTWORK_NEGATIVE : ""
    );
    return {
      version: PROFILE_VERSION,
      assetType,
      explicitFlatStyle,
      positiveInstruction,
      negativeInstruction,
      directorInstruction: positiveInstruction
    };
  }

  function compileFinal(options) {
    const source = options || {};
    const input = clean(source.prompt);
    // Old copies of our own instruction and echoed director text come out first; the current
    // instruction for this asset type / provider goes back on the end. Re-compiling is a no-op.
    const prompt = stripTemplateText(input);
    const profile = build({ ...source, prompt });
    const compiled = profile.directorInstruction ? `${prompt}\n\n${profile.directorInstruction}`.trim() : prompt;
    return {
      ...profile,
      prompt: compiled,
      negativePrompt: mergeNegativePrompt(source.negativePrompt, profile.negativeInstruction),
      applied: compiled !== input
    };
  }

  global.NovaFlowArtQualityProfile = Object.freeze({
    version: PROFILE_VERSION,
    build,
    compileFinal,
    inferAssetType,
    hasExplicitFlatStyle,
    canApplySoftEdgeEdit,
    mergeNegativePrompt,
    stripTemplateText,
    findLeakedDirectorText
  });
})(window);
