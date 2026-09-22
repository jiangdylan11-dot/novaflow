// GENERATED - do not edit. Source: renderer/*.workflow.js
// Browser-safe stub of NovaFlowArtQualityProfile.
// UI helpers are kept verbatim; every graph builder is replaced by a
// recorder, so this file contains no ComfyUI topology (asserted by
// tools/generate-workflow-stubs.mjs --check and by the protocol suite).
(function (root) {
  const __record = (module, method, options) => {
    const intent = { __novaflowWorkflowIntent: true, module, method, options };
    try { (root.NovaFlowWebRuntime && root.NovaFlowWebRuntime.recordWorkflowIntent || (() => {}))(intent); } catch (_) {}
    return intent;
  };
  const __api = {};
  __api["version"] = "art-quality-v1";
  __api["build"] = function (options) {
    return __record("NovaFlowArtQualityProfile", "build", options);
  };
  __api["compileFinal"] = function compileFinal(options) {
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
  };
  __api["inferAssetType"] = function inferAssetType(prompt, explicitType) {
    const normalized = normalizeAssetType(explicitType);
    if (normalized) return normalized;
    const stripped = stripTemplateText(prompt);
    const compiledType = stripped.match(/绘图质量协议（art-quality-v1\/(character|scene|game_ui|icon_prop|vfx|poster)）/i)?.[1];
    if (compiledType) return compiledType.toLowerCase();
    // Judged on the user's own affirmative text: template sentences and "不要 UI" clauses cannot
    // turn a character prompt into a game-UI prompt (which would append the UI quality paragraph).
    const text = affirmativeClauses(stripped);
    if (/(UI|界面|HUD|按钮|面板|老虎机|slot|大厅页|登录页)/i.test(text)) return "game_ui";
    if (/(海报|KV|主视觉|美宣|banner|landing\s*page|宣传图)/i.test(text)) return "poster";
    if (/(特效|VFX|法术|爆炸|拖尾|光效|粒子)/i.test(text) && !/(角色|人物|女性|男性|少女|少年|英雄|全身|半身)/i.test(text)) return "vfx";
    if (/(图标|icon|道具|武器|装备|宝箱|徽章)/i.test(text) && !/(角色|人物|女性|男性|少女|少年|英雄)/i.test(text)) return "icon_prop";
    if (/(场景|环境|建筑|森林|城市|地牢|地图|背景)/i.test(text) && !/(角色|人物|女性|男性|少女|少年|英雄|全身|半身)/i.test(text)) return "scene";
    return "character";
  };
  __api["hasExplicitFlatStyle"] = function hasExplicitFlatStyle(prompt, style) {
    // A complaint about a style is not a request to apply that style.
    const affirmative = clean(prompt).split(/[，,。；;！!？?\n]+/).filter((clause) =>
      !/(不要(?!改动|变动)|避免|禁止|不得(?!改动|变动)|去掉|去除|取消|减轻|减弱|弱化|降低|减少|太黑|太重|太粗|过黑|过重|过粗|without|avoid|no\s)/i.test(clause)
    ).join("，");
    return style === "cel_comic" || style === "pixel" || EXPLICIT_FLAT_STYLE_RE.test(`${clean(style)} ${affirmative}`);
  };
  __api["canApplySoftEdgeEdit"] = function canApplySoftEdgeEdit(prompt, requirements) {
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
  };
  __api["mergeNegativePrompt"] = function mergeNegativePrompt(base, addition) {
    const parts = clean(base).split(/[,，、;；\n]+/).map((item) => item.trim()).filter(Boolean);
    clean(addition).split(/[,，、;；\n]+/).map((item) => item.trim()).filter(Boolean).forEach((item) => {
      if (!parts.some((existing) => existing.toLowerCase() === item.toLowerCase())) parts.push(item);
    });
    return parts.join("，");
  };
  __api["stripTemplateText"] = function stripTemplateText(value) {
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
  };
  __api["findLeakedDirectorText"] = function findLeakedDirectorText(value) {
    const match = clean(value).match(LEAKED_DIRECTOR_MARKER_RE);
    return match ? match[0] : "";
  };
  root["NovaFlowArtQualityProfile"] = __api;
})(typeof globalThis !== "undefined" ? globalThis : this);
