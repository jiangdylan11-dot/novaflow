(function initNovaFlowArtQualityProfile(global) {
  "use strict";

  const PROFILE_VERSION = "art-quality-v1";
  const EXPLICIT_FLAT_STYLE_RE = /(赛璐璐|cel[\s-]?shad|漫画粗线|粗黑描边|黑色外轮廓|厚重墨线|线稿|ink(?:ed)?\s+line|pixel\s*art|像素画|低多边形|low[\s-]?poly)/i;
  const EXPLICIT_CLOTHING_DESIGN_RE = /(服装设计|服饰设计|时装|衣装|穿搭|裙装|长裙|短裙|礼服|制服|铠甲|盔甲|披风|斗篷|长袍|上衣|下装|裤装|鞋靴|帽饰|outfit|costume|fashion|dress|skirt|uniform|armor|cape|robe)/i;
  const ASSET_ALIASES = {
    character: "character",
    role: "character",
    person: "character",
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

  const PROFILE_INSTRUCTIONS = {
    character: "高完成度角色CG质量：用户指定的角色身份、可见外观状态、姿态、景别、构图和道具最高优先，不得擅自新增、删减或重新设计原图内容，不得擅自改成近景或裁切主体；用户要求全身时必须从头到脚完整入画，脚部和核心道具都保留在画面内。建立清晰轮廓、稳定重心和有表现力的动作线；面部五官、眼神、发丝分组、手脚与人体结构准确。皮肤、头发及原图已有材质分别呈现可信质感，使用柔和体积光、受控轮廓光和自然明暗转折塑造体积。配色遵循主色、辅色、点缀色层级；轮廓主要由明暗、色彩和材质边缘建立，只允许局部细弱彩色辅助线。画面达到高品质角色插画的精修完成度。",
    scene: "高完成度场景CG质量：建立明确前中后景、主地标、视线引导、尺度参照和可用空间；透视、结构、接触关系与光源方向一致。建筑、岩石、植被、水体和空气透视具有不同材质层次，重点区域细节密度高、次要区域主动收敛，形成可读的大形与专业级氛围光。",
    game_ui: "商业游戏UI质量：建立明确的信息层级、功能分区、按钮状态、文字安全区和操作焦点；边框、面板、图标与装饰使用统一的形状语言和材质逻辑。保证文字区域可读、控件可执行、九宫格与切图可落地，不生成伪文字堆叠或只可观看而不可使用的概念图。",
    icon_prop: "高完成度图标与道具质量：轮廓一眼可识别，视角、结构、功能和受力关系明确；金属、木材、皮革、玻璃、宝石与能量体材质区分清楚。用受控高光、接触阴影和局部磨损表现体积，背景与特效不遮挡主体，适合缩小后识别及真实资产落地。",
    vfx: "高完成度特效质量：明确核心形状、运动方向、节奏层级、能量密度和透明边缘；主爆点、拖尾、粒子和余辉层次分明，亮度不过曝，颜色不脏，避免无意义噪点和大面积雾化，保持可抠取、可序列化的资产边界。",
    poster: "商业宣传主视觉质量：建立唯一视觉焦点、清晰叙事层级、标题与文案安全区；人物、道具、环境和特效围绕焦点组织，具有大形节奏、空间纵深、受控光色和高级材质表现。保留足够留白与裁切余量，达到商业游戏KV与网页美宣的精修完成度。"
  };

  const PROFILE_NEGATIVES = {
    character: "粗黑描边，统一黑色外轮廓，厚重墨线，扁平赛璐璐，蜡像皮肤，塑料材质，材质无差异，低细节头发，结构粘连，无依据新增装饰，错误人体，畸形手指，多余手脚，五官错位，特效遮脸，过曝高光，噪点，低完成度",
    scene: "透视错误，尺度混乱，地面漂浮，建筑变形，材质重复，细节平均，焦点混乱，雾化过度，脏色，过曝，噪点，低完成度",
    game_ui: "伪文字，乱码，信息层级混乱，按钮状态缺失，控件不可执行，间距不一致，装饰遮挡内容，低对比度，边缘脏污，低完成度",
    icon_prop: "轮廓模糊，结构错误，材质混合，塑料感，视角不一致，主体被裁切，背景遮挡，过曝，噪点，低完成度",
    vfx: "主体不明，能量糊成一团，边缘脏污，亮度过曝，黑底污染，无意义粒子，节奏平均，低完成度",
    poster: "焦点混乱，构图拥挤，标题无安全区，人物变形，材质塑料感，光源冲突，特效遮脸，过曝，噪点，低完成度"
  };
  const PURE_ARTWORK_ASSET_TYPES = new Set(["character", "scene", "icon_prop", "vfx"]);
  const PURE_ARTWORK_INSTRUCTION = "只输出用户要求的纯画面内容，不添加游戏界面、界面边框、操作按钮、状态栏、菜单面板、文字标签、Logo或水印。";
  const PURE_ARTWORK_NEGATIVE = "游戏界面，界面边框，操作按钮，状态栏，菜单面板，文字标签，伪文字，Logo，水印";

  function clean(value) {
    return String(value || "").trim();
  }

  function normalizeAssetType(value) {
    const key = clean(value).toLowerCase();
    return ASSET_ALIASES[key] || "";
  }

  function inferAssetType(prompt, explicitType) {
    const normalized = normalizeAssetType(explicitType);
    if (normalized) return normalized;
    const text = clean(prompt)
      .split(/\n{2,}(?=(?:高完成度(?:角色|场景|图标与道具|特效)|商业(?:游戏UI|宣传)))/)[0]
      .replace(PURE_ARTWORK_INSTRUCTION, "");
    const compiledType = text.match(/绘图质量协议（art-quality-v1\/(character|scene|game_ui|icon_prop|vfx|poster)）/i)?.[1];
    if (compiledType) return compiledType.toLowerCase();
    if (/(UI|界面|HUD|按钮|面板|老虎机|slot|大厅页|登录页)/i.test(text)) return "game_ui";
    if (/(海报|KV|主视觉|美宣|banner|landing\s*page|宣传图)/i.test(text)) return "poster";
    if (/(特效|VFX|法术|爆炸|拖尾|光效|粒子)/i.test(text) && !/(角色|人物|女性|男性|少女|少年|英雄|全身|半身)/i.test(text)) return "vfx";
    if (/(图标|icon|道具|武器|装备|宝箱|徽章)/i.test(text) && !/(角色|人物|女性|男性|少女|少年|英雄)/i.test(text)) return "icon_prop";
    if (/(场景|环境|建筑|森林|城市|地牢|地图|背景)/i.test(text) && !/(角色|人物|女性|男性|少女|少年|英雄|全身|半身)/i.test(text)) return "scene";
    return "character";
  }

  function hasExplicitFlatStyle(prompt, style) {
    return style === "cel_comic" || style === "pixel" || EXPLICIT_FLAT_STYLE_RE.test(`${clean(style)} ${clean(prompt)}`);
  }

  function mergeNegativePrompt(base, addition) {
    const parts = clean(base).split(/[,，、;；\n]+/).map((item) => item.trim()).filter(Boolean);
    clean(addition).split(/[,，、;；\n]+/).map((item) => item.trim()).filter(Boolean).forEach((item) => {
      if (!parts.some((existing) => existing.toLowerCase() === item.toLowerCase())) parts.push(item);
    });
    return parts.join("，");
  }

  function build(options) {
    const source = options || {};
    const prompt = clean(source.prompt);
    const style = clean(source.style).toLowerCase();
    const assetType = inferAssetType(prompt, source.assetType);
    const explicitFlatStyle = hasExplicitFlatStyle(prompt, style);
    const basePositiveInstruction = explicitFlatStyle
      ? `商业资产完成度：保持用户明确指定的${style === "pixel" ? "像素" : "线稿/赛璐璐"}表现语言，不改成写实厚涂；提升构图、结构、色彩层级、边缘控制和细节准确性，保证主体清晰、风格统一、可直接用于游戏资产。`
      : PROFILE_INSTRUCTIONS[assetType];
    const clothingDesignInstruction = assetType === "character" && EXPLICIT_CLOTHING_DESIGN_RE.test(prompt)
      ? "用户已明确提出衣装内容时，仅精修用户指定或原图可见的衣装结构、材质与细节，不新增其他服饰，不改变覆盖范围。"
      : "";
    const pureArtworkInstruction = PURE_ARTWORK_ASSET_TYPES.has(assetType) ? PURE_ARTWORK_INSTRUCTION : "";
    const positiveInstruction = [basePositiveInstruction, clothingDesignInstruction, pureArtworkInstruction].filter(Boolean).join("");
    const baseNegativeInstruction = explicitFlatStyle
      ? "错误人体，畸形手指，多余手脚，五官错位，结构粘连，轮廓脏乱，噪点，低完成度"
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
    const prompt = clean(source.prompt);
    const profile = build(source);
    const alreadyCompiled = Boolean(profile.positiveInstruction) && prompt.includes(profile.positiveInstruction);
    return {
      ...profile,
      prompt: alreadyCompiled ? prompt : `${prompt}\n\n${profile.directorInstruction}`.trim(),
      negativePrompt: mergeNegativePrompt(source.negativePrompt, profile.negativeInstruction),
      applied: !alreadyCompiled
    };
  }

  global.NovaFlowArtQualityProfile = Object.freeze({
    version: PROFILE_VERSION,
    build,
    compileFinal,
    inferAssetType,
    mergeNegativePrompt
  });
})(window);
