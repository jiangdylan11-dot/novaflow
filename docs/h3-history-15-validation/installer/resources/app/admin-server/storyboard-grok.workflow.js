"use strict";

const STORYBOARD_SCENE_COUNT = 9;
const DEFAULT_SUBJECT_BASELINE_STATE = "baseline physical and functional condition, no visible damage, transformation, or impairment";

function compactText(value, limit) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, limit);
}

function buildStoryUnits(storyText) {
  const source = compactText(storyText, 4000);
  if (!source) return [];
  const units = source
    .split(/[。！？!?；;\n]+/u)
    .map((unit) => unit.trim())
    .filter(Boolean)
    .slice(0, 30);
  return units.map((text, index) => ({ id: `U${index + 1}`, text }));
}

function buildStoryboardGrokPayload(payload) {
  const storyText = compactText(payload?.storyText, 4000);
  if (!storyText) throw new Error("storyText is required");
  const storyUnits = buildStoryUnits(storyText);
  const sourceAnalysis = compactText(payload?.sourceAnalysis, 6000);
  const visualCuePack = compactText(payload?.visualCuePack, 1200);
  const system = [
    "你是具有创作自由的电影分镜导演。用户输入的是开放式故事大纲；先在内部理解故事主题、类型、主角目标、核心冲突或活动、明确地点与事件，再自由扩展成正好9个连续镜头。不要输出分析过程。",
    "用户故事的主题、目标、明确地点、核心事件与明确结局是叙事边界。你可以自由补充角色、动作、道具、环境、合理障碍、伏笔、冲突、高潮与收束，但所有新增内容都必须服务于原故事，不得删除或替换用户明确指定的内容，不得创作成另一个主题。",
    "不要套用固定九格剧情模板。战斗、冒险、悬疑、恐怖、日常、喜剧、爱情、科幻、奇幻、旅行、产品或其他故事，应根据自身类型采用不同的节奏、冲突强度、空间设计与镜头语言。不要自动加入战斗、反转、岔路、山坡、村庄、回家等通用桥段。",
    "参考图连续性信息是强制视觉造型合同，只用于人物身份、外观、基准服装或装备、色彩、画风与世界视觉连续性。参考图背景不能决定、替换或改写用户剧情；用户故事始终拥有最高叙事优先级。",
    "把主角造型与装备当作按镜头顺序延续的状态，而不是固定服装模板。若用户剧情没有明确要求开场已经处于另一造型，开场镜头从参考图连续性信息中实际存在且适用于该主体的身份、身体或结构、表面材质、发型或头部特征、服装、装备、随身物、配色和画风状态开始；之后每格默认继承上一格已经建立的当前造型状态，不得因地点、类型、职业或气氛自行换成旅行装、当地服装、职业装或类型片默认服装。",
    "造型或装备变化可以是零次、一次或多次，发生位置只由用户剧情以及服务于原主题的可见故事因果决定。不得预设变化次数、固定格号、服装品类、颜色、道具或活动装备，也不得把某个测试故事中的换装位置或造型复制到其他故事。",
    "只有用户明确要求，或剧情中的时间、身份、状态、行动、安全需求等在本格清楚建立变化原因时，才更新必要的造型或装备特征；每次变化后的状态从该格起延续到下一次明确变化，不得倒灌到更早镜头。未被剧情改变的脸、发型或头部特征、年龄或物种、体型、主体设计语言和画风继续保持可识别连续；若故事本身明确要求变身、衰老或身份变化，只更新该事件必需的特征。",
    "不得凭空添加参考图、用户剧情与服务主题的可见故事因果都没有的翅膀、角、盔甲、武器、魔法器官、大型装备或新随身物品。",
    "先在内部提取用户明确事实与原始因果关系，再根据故事自身类型自由设计9个镜头。剧情单元只是覆盖检查用的语义段落，不是镜头分配表：禁止把逗号子句或U1、U2等编号机械地一格对应一个镜头；一个剧情单元可以跨越多个镜头，多个相容单元也可以在同一决定性画面中共同发生。短大纲可以展开必要过程，长大纲可以合并相邻事件，但不得丢失核心主题或任何明确事实。",
    "每格必须推动剧情，并表现单张图片可以清楚呈现的一个决定性瞬间。避免抽象心理、时间跨度过大的连续动作、空泛情绪、重复站姿、重复观察、重复场景和没有结果的过渡。",
    "九格必须具有导演设计：建立清楚的空间与人物目标，保持人物、动作、视线、道具、服装、方向和场景位置连续；相邻镜头至少通过动作阶段、视线、空间位置、目标或关键道具自然衔接，禁止人物无原因瞬移或改变朝向与装备。",
    "镜头必须服务于剧情。根据每格叙事目的动态设计景别、机位、主体位置、前中后景、空间纵深、运动方向、光线和视觉重心。相邻镜头避免无意义地重复同一景别和角度；最强构图、尺度反差或动作画面应留给故事真正最重要的瞬间，而不是固定在某一格。",
    "visualEvent与prompt必须使用清晰、具体、可直接用于图像生成模型的英文视觉描述。subjectState与keyProps负责完整写明可识别的当前主体、当前外观/造型/结构/装备与关键道具物理状态；visualEvent与prompt正文负责明确可见动作、互动对象、当前环境、空间关系、光线气氛和统一画风。主体不限于人物，也可以是动物、机器人、产品、载具或环境对象；不要用same woman、she、they、it等脱离单格后身份不明的简写作为主语。title和displayCaption属于用户展示层，必须使用简体中文；英文只用于visualEvent、prompt、sceneAnchor、camera和结构化状态字段。",
    "在内部维护按镜头顺序更新的CURRENT SUBJECT STATE与KEY PROP LEDGER。每格必须输出结构化subjectState={id,appearance,state,changeEvent}：id是跨镜头稳定的主体标识；appearance是本格完整可见外观、服装、材质、结构和装备描述；state不得为空，只记录可跨镜头延续的身体、功能或剧情物理状态，例如受伤、失能、变身或湿透；如果本格没有特殊持久状态，写适合该主体的中性基线状态，例如baseline physical and functional condition, no visible damage, transformation, or impairment，并向后逐字继承；不得把站立、奔跑、蹲下、看向某处、当前动作、临时情绪或镜头位置写进state，这些单格信息只写入visualEvent与prompt；changeEvent只在本格有可见叙事事件真正改变identity、appearance或state时填写，否则必须为空字符串。未发生变化时必须逐字复制上一格对应值，禁止同义改写造成假变化。",
    "每格必须输出结构化keyProps数组；没有关键道具时输出[]。每个关键道具使用{id,name,appearance,state,location,changeEvent}：id跨镜头稳定，appearance描述可识别外形，state只记录可延续的物理或功能状态，例如完好、受损、销毁、遗失、消耗、修复或替换，不得把本格动作、人物情绪、镜头位置或临时观察写成道具state；location记录当前空间或携带关系，changeEvent只记录本格可见且真实发生的状态变化原因。关键道具即使暂时不在画面内也要保留账本项并写明off-screen、lost、destroyed或consumed等真实状态；未变化字段逐字继承。已损坏、销毁、遗失或消耗的道具，没有新的可见修复、找回、替换或补充事件不得恢复可用。",
    "凡是已经进入keyProps账本、会被放下、连接、损坏、销毁、遗失或消耗的独立道具，不要再把该道具的完整appearance重复写进subjectState.appearance；subjectState只保留主体自身外观、服装、身体结构与不独立追踪的穿戴设计。否则道具销毁后会与主体外观产生冲突。",
    "每格必须单独输出英文visualEvent，专门写本格单张图片中真正可见的决定性动作、互动与物理后果；visualEvent不得重复camera、subjectState或keyProps字段，不得只写状态账本、气氛或抽象任务名称。即使剧情是上传、破解、发现、失败、完成或数据变化，也必须写出不依赖读字即可理解的灯光、能量流、物体变化、人物反应或空间后果。",
    "camera必须使用英文明确写出景别、机位角度、构图关系、主体位置、前中后景和必要的运动感，不能只写cinematic、dynamic或close-up等空泛标签。prompt只输出英文创意画面正文，完整包含visualEvent、环境、光影、材质和统一画风，不要在prompt内重复camera、subjectState或keyProps；下游确定性编译器会按camera、subjectState、keyProps、visualEvent、prompt正文的顺序生成最终生图提示词。prompt正文不得使用与camera字段冲突的景别、角度、主体位置或运动方向。sceneAnchor必须明确当前空间、位置关系或朝向，帮助相邻镜头保持空间连续。",
    "所有剧情信息都必须依靠单帧中可见的物理动作、空间变化、物体状态、光线信号或直接后果表达。禁止把可读文字、字母、数字、字幕、标题、Logo、广告牌文案、屏幕台词、UI标签、倒计时数字或上传百分比作为主要叙事证据；屏幕如有必要，只能用不可读的抽象图形、无文字图标、状态灯或物理反馈，并同时给出不依赖读字也能理解的可见结果。",
    "进度条、进度环、进度仪表或进度指示器即使没有文字和数字，也不能作为完成、失败、上传、编译或传输的主要画面证据；必须同时改写为设备、目标、人物或环境中清楚可见的物理变化与后果。",
    "不要写glowing code、floating letters、streaming numbers、swirling glyphs或类似会诱导生图模型生成伪文字的描述。需要表现数据、程序或信息流时，改用非语言的抽象光带、粒子流、几何脉冲、无文字状态灯、材质变化或环境物理后果。",
    "抽象概念必须外化为模型可画出的决定性瞬间。例如完成、失败、追踪、破解、暴露、失控、承诺或恐惧，要通过已改变的物体状态、明确动作反应、环境后果或人物与目标的空间关系表现，而不是只写角色正在完成某事、屏幕显示结果或气氛变得紧张。",
    "输出前在内部自检：9格是否仍是用户想讲的同一个故事；自由扩展是否服务于主线；明确事件是否真正发生；是否有超过两格与主题无直接关系；人物、关键道具与空间是否连续；camera是否完整具体且不与prompt正文冲突；visualEvent是否确实包含可见动作与后果而不是状态账本；相邻镜头视觉签名是否无意义重复；叙事是否不依赖可读文字或数字；每格是否明确写出当前主体状态并适合独立生图；九格合起来是否像一段导演设计过的电影。若不符合，先重新规划再输出。",
    "只输出JSON数组，不要Markdown、解释或代码围栏。",
    "数组必须正好9项；每项必须包含 scene、title、displayCaption、visualEvent、prompt、sceneAnchor、camera、subjectState、keyProps、storyUnitIds。",
    "scene依次为1到9。title是简短的简体中文剧情节点；displayCaption是简体中文单句画面说明，描述本格正在发生的可见动作；visualEvent是英文单帧可见动作与物理后果；prompt是英文创意画面正文，补充环境、光影、材质和统一画风，不重复camera与状态账本；sceneAnchor是英文空间连续性描述；camera是英文导演镜头与构图说明；subjectState和keyProps是通用连续性账本；storyUnitIds是该镜头实际可见覆盖的剧情单元编号数组。",
    "Before composing shots, silently extract a mandatory story contract from the user outline: every explicitly named character or protected subject, location, object, clue, activity, obstacle, action, causal step, destination, and ending. Every contract item must be visibly represented in at least one of the nine shots. Preserve the user's stated order whenever it implies chronology or causality.",
    "Never replace an explicit contract item with a more convenient invention. Do not substitute different clues, props, creatures, locations, activities, goals, or outcomes. Invented details are allowed only after all explicit contract items are covered, and must support rather than compete with them.",
    "Start early enough to show the earliest explicit event instead of skipping directly to a later destination. End only after the final explicit event or outcome has visibly occurred. If nine shots are tight, combine compatible events inside one clearly readable single-image moment; do not omit them.",
    "During the silent final check, map every contract item to a scene number. If any explicit item has no scene, or has been replaced by an invented item, revise the nine-shot plan before returning JSON."
  ].join("\n");
  const user = [
    `用户剧情：\n${storyText}`,
    sourceAnalysis ? `\n参考图连续性信息：\n${sourceAnalysis}` : "",
    visualCuePack ? `\n视觉线索：\n${visualCuePack}` : "",
    sourceAnalysis ? `\n\nSEQUENTIAL APPEARANCE STATE CONTRACT (authoritative):\n${sourceAnalysis}\nTreat the protagonist appearance and equipment as a chronological state, not a fixed costume template. Unless the user outline explicitly opens after an appearance change, the opening shot starts from this reference baseline. Every later shot must explicitly describe and inherit the most recently established appearance state. The story may contain zero, one, or multiple visible appearance or equipment changes at any causally appropriate shots. Do not preassign the number of changes, shot numbers, costume types, colors, props, or activity gear. Permit a change only when the user explicitly requires it or a visible story event serving the user's theme clearly motivates it; update only the necessary traits and persist the new state forward until another explicit visible change. Never apply a later state retroactively, and never invent a genre-default or location-default costume.` : "",
    `\n\nMANDATORY NARRATIVE CONTRACT (verbatim user outline):\n${storyText}`,
    `\n\nMANDATORY STORY UNITS:\n${storyUnits.map((unit) => `${unit.id}: ${unit.text}`).join("\n")}`,
    "\nThe verbatim outline above is the only source of required plot facts. Reference analysis and visual cues may control appearance and style only; they must not add, replace, or remove plot facts.",
    "\nEvery story unit ID above must appear in storyUnitIds of at least one shot, and the shots carrying that ID must collectively depict every explicit fact inside that semantic unit rather than merely claiming its ID. Story units are coverage paragraphs, not a one-unit-per-shot beat sheet: one unit may span several shots and multiple compatible units may share one shot. Preserve explicit chronology across the nine shots. Do not return JSON until all explicit facts are visibly covered.",
    "\n输出正好9项JSON数组。"
  ].join("");
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0.5,
    max_tokens: 4096
  };
}

function extractJsonArray(text) {
  const source = compactText(text, 60000).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = source.indexOf("[");
  const end = source.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Grok未返回JSON数组");
  return source.slice(start, end + 1);
}

function normalizeSubjectState(value) {
  if (typeof value === "string") {
    return { id: "", appearance: compactText(value, 600), state: "", changeEvent: "" };
  }
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!source) return null;
  const id = compactText(source.id || source.subjectId || source.subject_id, 120);
  const appearance = compactText(source.appearance || source.currentAppearance || source.current_appearance, 600);
  const state = compactText(source.state || source.physicalState || source.physical_state, 400);
  const changeEvent = compactText(source.changeEvent || source.change_event || source.changeReason || source.change_reason, 400);
  return { id, appearance, state, changeEvent };
}

function normalizeKeyProps(value) {
  if (value == null) return null;
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([id, item]) => item && typeof item === "object" ? { id, ...item } : { id, name: id, state: item })
      : [value];
  return list.map((item) => {
    const legacyName = typeof item === "string" ? compactText(item, 160) : "";
    const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
    const id = compactText(source.id || source.propId || source.prop_id, 120);
    const name = compactText(source.name || source.label || legacyName || id, 160);
    const appearance = compactText(source.appearance || source.design || source.visualIdentity || source.visual_identity, 500);
    const state = compactText(source.state || source.physicalState || source.physical_state, 320);
    const location = compactText(source.location || source.position || source.spatialRelation || source.spatial_relation, 320);
    const changeEvent = compactText(source.changeEvent || source.change_event || source.changeReason || source.change_reason, 400);
    return { id, name, appearance, state, location, changeEvent };
  });
}

function normalizeShot(item, index) {
  const source = item && typeof item === "object" ? item : {};
  const title = compactText(source.title || source.beat, 120);
  const displayCaption = compactText(source.displayCaption || source.display_caption || source.caption, 180);
  const prompt = compactText(source.prompt || source.action || source.description, 6000);
  if (!title) throw new Error(`Grok第${index + 1}格缺少中文剧情节点`);
  if (!/[\u3400-\u9fff]/u.test(title)) throw new Error(`Grok第${index + 1}格剧情节点必须使用中文`);
  if (!displayCaption) throw new Error(`Grok第${index + 1}格缺少中文画面说明`);
  if (!/[\u3400-\u9fff]/u.test(displayCaption)) throw new Error(`Grok第${index + 1}格画面说明必须使用中文`);
  if (!prompt) throw new Error(`Grok第${index + 1}格缺少画面提示词`);
  const sceneAnchor = compactText(source.sceneAnchor || source.currentSpace || source.location, 240);
  const camera = compactText(source.camera || source.shot || source.composition, 240);
  if (!sceneAnchor) throw new Error(`Grok第${index + 1}格缺少空间锚点`);
  if (!camera) throw new Error(`Grok第${index + 1}格缺少导演镜头说明`);
  const explicitVisualEvent = compactText(source.visualEvent || source.visual_event || source.visibleEvent || source.visible_event, 1800);
  const visualEvent = explicitVisualEvent || storyboardCreativePromptBody(prompt, camera);
  const subjectState = normalizeSubjectState(source.subjectState !== undefined ? source.subjectState : source.subject_state);
  const keyProps = normalizeKeyProps(source.keyProps !== undefined ? source.keyProps : source.key_props);
  const storyUnitIds = Array.isArray(source.storyUnitIds)
    ? [...new Set(source.storyUnitIds.map((value) => {
        const raw = compactText(value, 12).toUpperCase();
        const match = raw.match(/^(?:U|UNIT\s*)?(\d+)$/);
        return match ? `U${Number(match[1])}` : raw;
      }).filter(Boolean))]
    : [];
  return {
    scene: index + 1,
    title,
    displayCaption,
    visualEvent,
    prompt,
    sceneAnchor,
    camera,
    subjectState,
    keyProps,
    storyUnitIds
  };
}

function normalizeComparableText(value) {
  return compactText(value, 12000)
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function storyboardCreativePromptBody(prompt, camera) {
  const original = compactText(prompt, 6000);
  if (!original) return "";
  const visibleMarker = /\b(?:visible\s+(?:event|moment|action|story\s+beat)|decisive\s+moment|image\s+content|scene\s+content)\s*:\s*/i;
  const visibleMatch = visibleMarker.exec(original);
  if (visibleMatch && typeof visibleMatch.index === "number") {
    return compactText(original.slice(visibleMatch.index + visibleMatch[0].length), 3200);
  }

  let body = original;
  const cameraText = compactText(camera, 600);
  if (cameraText) {
    const exactCameraPrefix = new RegExp(`^\\s*camera\\s+and\\s+composition\\s*:\\s*${escapeRegExp(cameraText)}\\s*\\.?\\s*`, "i");
    body = body.replace(exactCameraPrefix, "");
  }

  const lower = body.toLowerCase();
  const contractStarts = [lower.indexOf("subject state:"), lower.indexOf("key prop states:")].filter((index) => index >= 0);
  if (contractStarts.length && Math.min(...contractStarts) <= 2) {
    const lastChangeEvent = lower.lastIndexOf("state change event:");
    const keyPropsNone = lower.indexOf("key prop states: none");
    let contractEnd = -1;
    if (lastChangeEvent >= 0) contractEnd = body.indexOf(".", lastChangeEvent);
    if (contractEnd < 0 && keyPropsNone >= 0) contractEnd = body.indexOf(".", keyPropsNone);
    if (contractEnd >= 0 && compactText(body.slice(contractEnd + 1), 3200)) {
      body = body.slice(contractEnd + 1);
    }
  }
  return compactText(body, 3200) || original;
}

function visualEventIsUsable(value) {
  const text = compactText(value, 2400);
  if (text.length < 12) return false;
  if (/^(?:camera\s+and\s+composition|subject\s+state|key\s+prop\s+states?|image-generation\s+constraint)\s*:/i.test(text)) return false;
  const stripped = text
    .replace(/(?:camera\s+and\s+composition|subject\s+state|key\s+prop\s+states?|image-generation\s+constraint)\s*:[^.!?]*(?:[.!?]|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length >= 12;
}

function structuredPropTerminalState(value) {
  const text = compactText(value, 400);
  if (/\b(?:destroyed|self[- ]?destructed|exploded|shattered|incinerated|burned\s+(?:away|to\s+ash))\b|销毁|自毁|炸毁|爆炸|粉碎|焚毁|烧成灰/i.test(text)) return "destroyed";
  if (/\b(?:lost|missing|abandoned|discarded|left\s+behind)\b|遗失|丢失|抛弃|遗弃|留在原地/i.test(text)) return "lost";
  if (/\b(?:consumed|depleted|spent|exhausted|empty)\b|消耗|耗尽|用尽|空了/i.test(text)) return "consumed";
  if (/\b(?:damaged|broken|cracked|torn|malfunctioning|disabled)\b|损坏|破损|断裂|开裂|撕裂|故障|失效/i.test(text)) return "damaged";
  return "";
}

function canonicalPropRenderingConstraint(prop) {
  const stateClass = structuredPropTerminalState(prop?.state);
  if (stateClass === "destroyed") return "rendering constraint: never show the intact or usable prop; show only residual fragments, debris, ash, or its confirmed absence when spatially relevant; if the current Visible event does not explicitly involve its residue, keep the prop absent and off-screen";
  if (stateClass === "lost") return "rendering constraint: keep this prop absent and off-screen unless a later visible recovery event changes the ledger";
  if (stateClass === "consumed") return "rendering constraint: do not show this prop as full, unused, or usable";
  if (stateClass === "damaged") return "rendering constraint: preserve clearly visible damage and do not show an intact replacement";
  return "";
}

function canonicalKeyPropStateLine(keyProps) {
  if (!Array.isArray(keyProps)) return "";
  if (!keyProps.length) return "Key prop states: none.";
  const entries = keyProps.map((prop) => {
    const renderConstraint = canonicalPropRenderingConstraint(prop);
    const stateLedger = `${prop.name || prop.id} [${prop.id}]; state: ${prop.state}; location: ${prop.location || "off-screen or unchanged"}; state change event: ${hasMeaningfulChangeEvent(prop.changeEvent) ? prop.changeEvent : "none"}`;
    if (renderConstraint) {
      return `${stateLedger}; ${renderConstraint}`;
    }
    return `${prop.name || prop.id} [${prop.id}]; appearance: ${prop.appearance}; state: ${prop.state}; location: ${prop.location || "off-screen or unchanged"}; state change event: ${hasMeaningfulChangeEvent(prop.changeEvent) ? prop.changeEvent : "none"}`;
  });
  return `Key prop states: ${entries.join(" | ")}.`;
}

function compileCanonicalStoryboardPrompt(shot) {
  const source = shot && typeof shot === "object" ? shot : {};
  const camera = compactText(source.camera, 600);
  const subject = source.subjectState;
  const visualEvent = compactText(source.visualEvent, 2400);
  const body = storyboardCreativePromptBody(source.prompt, camera);
  const parts = [];
  if (camera) parts.push(`Camera and composition: ${camera.replace(/[.\s]+$/g, "")}.`);
  if (subject?.id && subject?.appearance && subject?.state) {
    parts.push(`Subject state: ${subject.id}; appearance: ${subject.appearance}; physical state: ${subject.state}; state change event: ${hasMeaningfulChangeEvent(subject.changeEvent) ? subject.changeEvent : "none"}.`);
  }
  const keyPropLine = canonicalKeyPropStateLine(source.keyProps);
  if (keyPropLine) parts.push(keyPropLine);
  parts.push("Image-generation constraint: convey all story information through visible physical action, object state, spatial consequence, nonverbal symbols, and abstract interface lights; no readable text, code-like glyphs, letters, numbers, subtitles, logos, interface copy, or percentages.");
  if (visualEventIsUsable(visualEvent)) parts.push(`Visible event: ${visualEvent.replace(/[.\s]+$/g, "")}.`);
  const comparableVisualEvent = normalizeComparableText(visualEvent);
  const comparableBody = normalizeComparableText(body);
  const bodyDuplicatesVisualEvent = Boolean(comparableVisualEvent) && (
    comparableBody === comparableVisualEvent
    || comparableBody.includes(comparableVisualEvent)
    || comparableVisualEvent.includes(comparableBody)
  );
  if (visualEventIsUsable(body) && !bodyDuplicatesVisualEvent) {
    parts.push(`Creative scene body: ${body.replace(/^\s*(?:visible\s+(?:event|moment|action|story\s+beat)|decisive\s+moment|image\s+content|scene\s+content)\s*:\s*/i, "").replace(/[.\s]+$/g, "")}.`);
  }
  return compactText(parts.join(" "), 12000);
}

function shotTransitionText(shot) {
  return compactText([
    shot?.displayCaption,
    shot?.visualEvent,
    storyboardCreativePromptBody(shot?.prompt, shot?.camera),
    shot?.sceneAnchor
  ].filter(Boolean).join(" "), 5000);
}

function textMentionsLedgerItem(text, prop) {
  const comparable = normalizeComparableText(text);
  const candidates = [prop?.name, prop?.id].map(normalizeComparableText).filter((item) => item.length >= 3);
  return candidates.some((item) => comparable.includes(item));
}

function hasExplicitSubjectTransitionEvidence(shot, kind) {
  const text = shotTransitionText(shot);
  if (kind === "appearance") {
    return /\b(?:puts?\s+on|takes?\s+off|removes?|changes?\s+into|dresses?|undresses?|transforms?|morphs?|gear\s+(?:attaches|deploys)|armor\s+(?:forms|deploys))\b|换上|脱下|更换|变装|变身|装备上|卸下/i.test(text);
  }
  return /\b(?:is\s+(?:struck|wounded|injured|burned|frozen|electrocuted|knocked\s+unconscious)|gets?\s+(?:hit|wounded|injured)|begins?\s+bleeding|bleeds?|collapses?\s+unconscious|transforms?|mutates?|loses?\s+(?:mobility|consciousness|a\s+limb))\b|受伤|流血|昏迷|失能|变身|突变|烧伤|冻伤/i.test(text);
}

function hasExplicitPropTransitionEvidence(shot, prop) {
  const text = shotTransitionText(shot);
  if (!textMentionsLedgerItem(text, prop)) return false;
  return /\b(?:breaks?|shatters?|explodes?|self[- ]?destructs?|is\s+destroyed|burns?\s+(?:away|down|into\s+ash)|runs?\s+out|is\s+(?:lost|consumed|depleted)|repairs?|restores?|recovers?|finds?|replaces?|refills?|recharges?|opens?|closes?|connects?|disconnects?|unlocks?)\b|损坏|破碎|爆炸|自毁|销毁|遗失|消耗|耗尽|修复|找回|替换|补充|打开|关闭|连接|断开/i.test(text);
}

function reconcileStoryboardGrokContinuity(inputShots) {
  const sourceShots = Array.isArray(inputShots) ? inputShots : [];
  const actions = [];
  let acceptedSubject = null;
  const acceptedProps = new Map();
  const propOrder = [];
  const reconciled = sourceShots.map((inputShot, index) => {
    const scene = Number(inputShot?.scene) || index + 1;
    const shot = {
      ...inputShot,
      subjectState: inputShot?.subjectState ? { ...inputShot.subjectState } : null,
      keyProps: Array.isArray(inputShot?.keyProps) ? inputShot.keyProps.map((prop) => ({ ...prop })) : inputShot?.keyProps
    };

    if (!shot.subjectState && acceptedSubject) {
      if (!hasExplicitSubjectTransitionEvidence(shot, "appearance") && !hasExplicitSubjectTransitionEvidence(shot, "state")) {
        shot.subjectState = { ...acceptedSubject, changeEvent: "" };
        actions.push({ scene, code: "SUBJECT_LEDGER_RESTORED", fields: ["id", "appearance", "state"] });
      }
    } else if (shot.subjectState) {
      if (!compactText(shot.subjectState.state, 400) && !hasMeaningfulChangeEvent(shot.subjectState.changeEvent)) {
        if (acceptedSubject?.state) {
          shot.subjectState.state = acceptedSubject.state;
          actions.push({ scene, code: "SUBJECT_BASELINE_STATE_INHERITED", fields: ["state"] });
        } else if (
          shot.subjectState.id
          && shot.subjectState.appearance
          && !hasExplicitSubjectTransitionEvidence(shot, "state")
        ) {
          shot.subjectState.state = DEFAULT_SUBJECT_BASELINE_STATE;
          actions.push({ scene, code: "SUBJECT_BASELINE_STATE_DEFAULTED", fields: ["state"] });
        }
      }
      if (acceptedSubject && !hasMeaningfulChangeEvent(shot.subjectState.changeEvent)) {
        const restoredFields = [];
        if (normalizeComparableText(shot.subjectState.id) !== normalizeComparableText(acceptedSubject.id)) {
          shot.subjectState.id = acceptedSubject.id;
          restoredFields.push("id");
        }
        if (
          normalizeComparableText(shot.subjectState.appearance) !== normalizeComparableText(acceptedSubject.appearance)
          && !hasExplicitSubjectTransitionEvidence(shot, "appearance")
        ) {
          shot.subjectState.appearance = acceptedSubject.appearance;
          restoredFields.push("appearance");
        }
        if (
          normalizeComparableText(shot.subjectState.state) !== normalizeComparableText(acceptedSubject.state)
          && !hasExplicitSubjectTransitionEvidence(shot, "state")
        ) {
          shot.subjectState.state = acceptedSubject.state;
          restoredFields.push("state");
        }
        shot.subjectState.changeEvent = "";
        if (restoredFields.length) actions.push({ scene, code: "SUBJECT_STATE_INHERITED_WITHOUT_EVENT", fields: restoredFields });
      }
      if (shot.subjectState?.id && shot.subjectState?.appearance && shot.subjectState?.state) {
        acceptedSubject = { ...shot.subjectState, changeEvent: "" };
      }
    }

    if (acceptedProps.size && !Array.isArray(shot.keyProps)) shot.keyProps = [];
    if (Array.isArray(shot.keyProps)) {
      const currentById = new Map();
      shot.keyProps.forEach((prop) => {
        const id = normalizeComparableText(prop?.id);
        if (id && !currentById.has(id)) currentById.set(id, { ...prop });
      });
      for (const id of propOrder) {
        if (currentById.has(id)) continue;
        const previous = acceptedProps.get(id);
        if (!previous || hasExplicitPropTransitionEvidence(shot, previous)) continue;
        currentById.set(id, { ...previous, location: previous.location || "off-screen", changeEvent: "" });
        actions.push({ scene, code: "KEY_PROP_LEDGER_RESTORED", propId: previous.id, fields: ["id", "name", "appearance", "state"] });
      }

      const orderedIds = [...propOrder];
      for (const id of currentById.keys()) if (!orderedIds.includes(id)) orderedIds.push(id);
      shot.keyProps = orderedIds.map((id) => currentById.get(id)).filter(Boolean).map((prop) => {
        const key = normalizeComparableText(prop?.id);
        const previous = acceptedProps.get(key);
        const next = { ...prop };
        if (previous && !hasMeaningfulChangeEvent(next.changeEvent)) {
          const restoredFields = [];
          for (const field of ["id", "name", "appearance"]) {
            if (normalizeComparableText(next[field]) !== normalizeComparableText(previous[field])) {
              next[field] = previous[field];
              restoredFields.push(field);
            }
          }
          if (
            normalizeComparableText(next.state) !== normalizeComparableText(previous.state)
            && !hasExplicitPropTransitionEvidence(shot, previous)
          ) {
            next.state = previous.state;
            restoredFields.push("state");
          }
          if (!next.location) next.location = previous.location;
          next.changeEvent = "";
          if (restoredFields.length) actions.push({ scene, code: "KEY_PROP_STATE_INHERITED_WITHOUT_EVENT", propId: previous.id, fields: restoredFields });
        }
        return next;
      });

      shot.keyProps.forEach((prop) => {
        const id = normalizeComparableText(prop?.id);
        if (!id) return;
        if (!acceptedProps.has(id)) propOrder.push(id);
        acceptedProps.set(id, { ...prop, changeEvent: "" });
      });
    }

    if (shot.subjectState?.appearance && Array.isArray(shot.keyProps)) {
      shot.keyProps.forEach((prop) => {
        if (!structuredPropTerminalState(prop?.state)) return;
        const subjectAppearance = String(shot.subjectState.appearance || "");
        const cleanedAppearance = removeTrackedPropFromSubjectAppearance(subjectAppearance, prop);
        if (cleanedAppearance.length < 12 || cleanedAppearance === subjectAppearance) return;
        shot.subjectState.appearance = cleanedAppearance;
        if (!hasMeaningfulChangeEvent(shot.subjectState.changeEvent) && hasMeaningfulChangeEvent(prop.changeEvent)) {
          shot.subjectState.changeEvent = prop.changeEvent;
        }
        acceptedSubject = { ...shot.subjectState, changeEvent: "" };
        actions.push({
          scene,
          code: "DEGRADED_PROP_REMOVED_FROM_SUBJECT_APPEARANCE",
          propId: prop.id,
          fields: ["appearance"]
        });
      });
    }

    shot.prompt = compileCanonicalStoryboardPrompt(shot);
    return shot;
  });
  return {
    shots: reconciled,
    actions,
    directorQuality: evaluateStoryboardDirectorQuality(reconciled)
  };
}

function findSignaturePart(source, candidates) {
  for (const [name, pattern] of candidates) {
    if (pattern.test(source)) return name;
  }
  return "";
}

function buildStoryboardVisualSignature(shot) {
  const camera = compactText(shot?.camera || shot?.shot || shot?.composition, 600).toLowerCase();
  const framing = findSignaturePart(camera, [
    ["extreme-close-up", /\b(?:extreme|macro)\s+close[ -]?up\b/i],
    ["medium-close-up", /\bmedium\s+close[ -]?up\b/i],
    ["close-up", /\bclose[ -]?up\b/i],
    ["extreme-wide", /\b(?:extreme|ultra)\s+wide(?:\s+shot)?\b/i],
    ["establishing", /\bestablishing\s+(?:wide\s+)?shot\b/i],
    ["medium-wide", /\b(?:medium\s+wide|medium\s+long)\s+shot\b/i],
    ["full", /\b(?:full(?:-body)?|long)\s+shot\b/i],
    ["wide", /\bwide\s+shot\b/i],
    ["medium", /\bmedium\s+shot\b/i],
    ["over-shoulder", /\bover(?:-the)?-shoulder\b/i]
  ]);
  const angle = findSignaturePart(camera, [
    ["bird-eye", /\b(?:bird'?s[- ]eye|aerial)\b/i],
    ["top-down", /\b(?:top[- ]down|overhead)\b/i],
    ["worm-eye", /\b(?:worm'?s[- ]eye|ground[- ]level)\b/i],
    ["dutch", /\bdutch\s+(?:angle|tilt)\b/i],
    ["high-angle", /\bhigh[- ]angle\b/i],
    ["low-angle", /\blow[- ]angle\b/i],
    ["eye-level", /\beye[- ]level\b/i]
  ]);
  const placement = findSignaturePart(camera, [
    ["left-third", /\b(?:on|in|at|occup(?:y|ies|ying))\s+(?:the\s+)?left\s+third\b|\bleft-third\b/i],
    ["right-third", /\b(?:on|in|at|occup(?:y|ies|ying))\s+(?:the\s+)?right\s+third\b|\bright-third\b/i],
    ["center", /\b(?:centered|central(?:ly)?|center-frame|centre-frame|in the center)\b/i],
    ["foreground", /\b(?:subject|protagonist|character|product|vehicle|creature)\s+(?:in|occupying)\s+(?:the\s+)?foreground\b/i],
    ["background", /\b(?:subject|protagonist|character|product|vehicle|creature)\s+(?:in|occupying)\s+(?:the\s+)?background\b/i]
  ]);
  const motion = findSignaturePart(camera, [
    ["tracking", /\b(?:tracking|follow)\s+shot\b/i],
    ["push-in", /\b(?:push|dolly)[ -]?in\b/i],
    ["pull-out", /\b(?:pull|dolly)[ -]?(?:out|back)\b/i],
    ["pan", /\bpann?ing\b|\bpan\s+(?:left|right)\b/i],
    ["handheld", /\bhandheld\b/i],
    ["static", /\b(?:static|locked[- ]off)\b/i]
  ]);
  const parts = [framing, angle, placement, motion].filter(Boolean);
  return {
    framing,
    angle,
    placement,
    motion,
    componentCount: parts.length,
    key: parts.join("|")
  };
}

function promptStartsWithCamera(shot) {
  const prompt = compactText(shot?.prompt, 12000);
  const camera = normalizeComparableText(shot?.camera || shot?.shot || shot?.composition);
  if (!prompt || !camera) return false;
  const prefix = prompt.match(/^\s*camera\s+and\s+composition\s*:\s*/i);
  if (!prefix) return false;
  return normalizeComparableText(prompt.slice(prefix[0].length)).startsWith(camera);
}

function promptHasSubjectState(shot) {
  const prompt = compactText(shot?.prompt, 12000);
  return /\bsubject\s+state\s*:/i.test(prompt);
}

function hasMeaningfulChangeEvent(value) {
  const text = compactText(value, 400);
  return !!text && !/^(?:none|no\s+change|unchanged|inherited|same\s+as\s+previous|n\/?a|无|没有变化|未变化|沿用上一格|继承上一格)$/i.test(text);
}

function promptContainsStateValue(prompt, value) {
  const expected = normalizeComparableText(value);
  return !!expected && normalizeComparableText(prompt).includes(expected);
}

function structuredSubjectIsInline(shot) {
  const state = shot?.subjectState;
  if (!state || !promptHasSubjectState(shot)) return false;
  return [state.id, state.appearance, state.state].filter(Boolean)
    .every((value) => promptContainsStateValue(shot.prompt, value));
}

function structuredKeyPropsAreInline(shot) {
  if (!Array.isArray(shot?.keyProps)) return false;
  const prompt = compactText(shot.prompt, 12000);
  if (!/\bkey\s+prop\s+states?\s*:/i.test(prompt)) return false;
  if (!shot.keyProps.length) return /\bkey\s+prop\s+states?\s*:\s*(?:none|no\s+key\s+props?)\b/i.test(prompt);
  return shot.keyProps.every((prop) => {
    const requiredValues = structuredPropTerminalState(prop?.state)
      ? [prop.id, prop.name, prop.state]
      : [prop.id, prop.name, prop.appearance, prop.state];
    return requiredValues.filter(Boolean).every((value) => promptContainsStateValue(prompt, value));
  });
}

function structuredPropStateClass(value) {
  const text = compactText(value, 320);
  if (/\b(?:damaged|broken|destroyed|lost|consumed|depleted|spent|empty|discarded|abandoned)\b|损坏|破碎|销毁|遗失|消耗|耗尽|丢弃/i.test(text)) return "degraded";
  if (/\b(?:intact|usable|functional|active|available|carried|equipped|repaired|restored|recovered|replaced|refilled|recharged)\b|完好|可用|正常|携带|装备|修复|恢复|找回|替换|补充/i.test(text)) return "usable";
  return "other";
}

const PROP_IDENTITY_TOKEN_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "with", "without", "for", "from", "in", "on", "at", "by",
  "high", "tech", "hightech", "large", "small", "medium", "matte", "glowing", "visible", "portable", "rectangular",
  "object", "item", "prop", "device", "equipment", "design", "case"
]);

function propIdentityTokens(value) {
  return normalizeComparableText(value).split(" ").filter((token) => token.length >= 3 && !PROP_IDENTITY_TOKEN_STOP_WORDS.has(token));
}

function subjectAppearanceMentionsProp(subjectAppearance, prop) {
  const subjectText = normalizeComparableText(subjectAppearance);
  if (!subjectText) return false;
  const propAppearance = normalizeComparableText(prop?.appearance);
  const propName = normalizeComparableText(prop?.name);
  if (propAppearance.length >= 12 && subjectText.includes(propAppearance)) return true;
  if (propName.length >= 5 && subjectText.includes(propName)) return true;
  const subjectTokens = new Set(propIdentityTokens(subjectAppearance));
  const nameTokens = new Set(propIdentityTokens(`${prop?.name || ""} ${prop?.id || ""}`));
  const allTokens = new Set(propIdentityTokens(`${prop?.name || ""} ${prop?.id || ""} ${prop?.appearance || ""}`));
  const nameOverlap = [...nameTokens].filter((token) => subjectTokens.has(token)).length;
  const totalOverlap = [...allTokens].filter((token) => subjectTokens.has(token)).length;
  return nameOverlap >= 2 || (nameOverlap >= 1 && totalOverlap >= 2);
}

function removeTrackedPropFromSubjectAppearance(subjectAppearance, prop) {
  const source = compactText(subjectAppearance, 1200);
  if (!source || !subjectAppearanceMentionsProp(source, prop)) return source;
  const segments = source.split(/\s*[,;，；]\s*/u).map((segment) => segment.trim()).filter(Boolean);
  if (segments.length > 1) {
    const retained = segments.filter((segment) => !subjectAppearanceMentionsProp(segment, prop));
    const joined = retained.join(", ").trim();
    if (retained.length < segments.length && joined.length >= 12) return joined;
  }
  const propAppearance = compactText(prop?.appearance, 500);
  if (propAppearance.length >= 12 && source.toLowerCase().includes(propAppearance.toLowerCase())) {
    return source
      .replace(new RegExp(`\\s*,?\\s*${escapeRegExp(propAppearance)}\\s*,?\\s*`, "i"), " ")
      .replace(/\s+,/g, ",")
      .replace(/,\s*,/g, ", ")
      .replace(/^\s*,\s*|\s*,\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return source;
}

function promptDependsOnReadableText(shot) {
  const prompt = compactText(shot?.prompt, 12000).toLowerCase();
  let source = prompt.replace(
    /\b(?:no|without|avoid(?:ing)?|exclude|do\s+not|must\s+not|never)\b[^.!?\n]{0,100}?\b(?:readable|legible|written|text|words?|letters?|numbers?|labels?|captions?|subtitles?|code|glyphs?|characters?)\b/gi,
    ""
  );
  if (source !== prompt) {
    source = source.replace(/\b(?:or|and)\s+(?:(?:readable|legible|glowing|floating|falling|streaming|swirling|code-like)\s+)?(?:text|words?|letters?|numbers?|labels?|captions?|subtitles?|code|glyphs?|characters?)\b/gi, "");
  }
  return [
    /\b(?:billboard|sign|poster|headline|caption|subtitle)\s+(?:reads?|says?|spells?)\b/i,
    /\b(?:screen|monitor|display|interface|ui|billboard|sign|poster)\s+(?:shows?|displays?)\b[^.;\n]{0,48}\b(?:readable|legible|written|text|words?|letters?|digits?|numbers?|message|code|percentage|percent)\b/i,
    /\b(?:screen|monitor|display|interface|ui|billboard|sign|poster)\b[^.;\n]{0,40}\b(?:readable|legible|written|words?|letters?|digits?|numbers?|percentage|percent|chinese\s+characters?|english\s+characters?)\b/i,
    /\b(?:readable|legible|written)\s+(?:text|words?|letters?|numbers?|message|label|caption|subtitle)\b/i,
    /\b(?:text|message|label|headline|caption|subtitle)\s+(?:reading|saying|showing|displaying)\b/i,
    /\b(?:glowing|floating|falling|streaming|swirling)\s+(?:source\s+)?(?:code|letters?|numbers?|characters?|glyphs?)\b/i,
    /\b(?:cascading|falling|flowing|scrolling|streaming|glowing|floating|swirling)\s+(?:lines?\s+of\s+)?(?:source\s+)?code\b/i,
    /\b(?:lines?|columns?|streams?)\s+of\s+(?:source\s+)?code\b/i,
    /\b(?:source\s+)?code\b[^.;\n]{0,28}\b(?:fills?|cascades?|scrolls?|flows?|rains?)\b/i,
    /\b(?:progress|completion|upload|download|transfer)\s+(?:bar|ring|meter|indicator(?:s)?)\b/i,
    /\b(?:upload|download|transfer|progress|completion|battery|countdown)\b[^.;\n]{0,32}\b\d{1,3}\s*(?:%(?!\w)|percent\b)/i,
    /\b\d{1,3}\s*%(?!\w)/i,
    /\bui\s+(?:text|label|number|percentage|percent)\b/i
  ].some((pattern) => pattern.test(source));
}

function evaluateStoryboardDirectorQuality(shots) {
  const input = Array.isArray(shots) ? shots : [];
  const issues = [];
  if (input.length !== STORYBOARD_SCENE_COUNT) {
    issues.push({
      code: "SCENE_COUNT_INVALID",
      scenes: [],
      message: `分镜数量必须为${STORYBOARD_SCENE_COUNT}，当前为${input.length}`
    });
  }
  const sceneReports = input.map((shot, index) => {
    const scene = Number(shot?.scene) || index + 1;
    const signature = buildStoryboardVisualSignature(shot);
    const cameraInlined = promptStartsWithCamera(shot);
    const subjectStatePresent = Boolean(shot?.subjectState?.id && shot?.subjectState?.appearance && shot?.subjectState?.state);
    const subjectStateInline = subjectStatePresent && structuredSubjectIsInline(shot);
    const keyPropLedgerPresent = Array.isArray(shot?.keyProps);
    const keyPropIds = keyPropLedgerPresent ? shot.keyProps.map((prop) => normalizeComparableText(prop?.id)).filter(Boolean) : [];
    const keyPropLedgerValid = keyPropLedgerPresent
      && shot.keyProps.every((prop) => prop?.id && prop?.appearance && prop?.state)
      && new Set(keyPropIds).size === keyPropIds.length;
    const keyPropStatesInline = keyPropLedgerValid && structuredKeyPropsAreInline(shot);
    const visualEventPresent = visualEventIsUsable(shot?.visualEvent);
    const subjectAppearanceText = normalizeComparableText(shot?.subjectState?.appearance);
    const degradedPropAppearanceConflicts = keyPropLedgerPresent ? shot.keyProps.filter((prop) => {
      if (!structuredPropTerminalState(prop?.state)) return false;
      return subjectAppearanceMentionsProp(subjectAppearanceText, prop);
    }) : [];
    const readableTextDependency = promptDependsOnReadableText(shot);
    if (!cameraInlined) {
      issues.push({
        code: "CAMERA_NOT_INLINE",
        scenes: [scene],
        message: `镜头${scene}的prompt未以完整camera字段开头，镜头设计可能被后续描述稀释或冲突`
      });
    }
    if (!subjectStatePresent) {
      issues.push({
        code: "SUBJECT_STATE_MISSING",
        scenes: [scene],
        message: `镜头${scene}缺少完整的结构化subjectState当前主体状态`
      });
    } else if (!subjectStateInline) {
      issues.push({
        code: "SUBJECT_STATE_NOT_INLINE",
        scenes: [scene],
        message: `镜头${scene}没有把结构化subjectState逐字内联到prompt`
      });
    }
    if (!keyPropLedgerPresent || !keyPropLedgerValid) {
      issues.push({
        code: "KEY_PROP_LEDGER_MISSING",
        scenes: [scene],
        message: `镜头${scene}缺少完整的结构化keyProps账本`
      });
    } else if (!keyPropStatesInline) {
      issues.push({
        code: "KEY_PROP_STATE_NOT_INLINE",
        scenes: [scene],
        message: `镜头${scene}没有把结构化keyProps当前状态逐字内联到prompt`
      });
    }
    if (!visualEventPresent) {
      issues.push({
        code: "VISUAL_EVENT_MISSING",
        scenes: [scene],
        message: `镜头${scene}缺少独立的英文可见动作与物理后果，最终生图提示词可能只剩状态账本`
      });
    }
    if (degradedPropAppearanceConflicts.length) {
      issues.push({
        code: "DEGRADED_PROP_STILL_IN_SUBJECT_APPEARANCE",
        scenes: [scene],
        message: `镜头${scene}已损坏、销毁、遗失或消耗的关键道具仍被写在subjectState.appearance中：${degradedPropAppearanceConflicts.map((prop) => prop.name || prop.id).join(", ")}`
      });
    }
    if (readableTextDependency) {
      issues.push({
        code: "READABLE_TEXT_DEPENDENCY",
        scenes: [scene],
        message: `镜头${scene}依赖可读文字、数字或UI百分比表达剧情，应改为物理可见结果`
      });
    }
    return {
      scene,
      cameraInlined,
      subjectStatePresent,
      subjectStateInline,
      keyPropLedgerPresent,
      keyPropLedgerValid,
      keyPropStatesInline,
      visualEventPresent,
      degradedPropAppearanceConflicts: degradedPropAppearanceConflicts.map((prop) => prop.id || prop.name),
      readableTextDependency,
      visualSignature: signature
    };
  });

  for (let index = 1; index < sceneReports.length; index += 1) {
    const previous = sceneReports[index - 1];
    const current = sceneReports[index];
    if (
      previous.visualSignature.componentCount >= 2
      && current.visualSignature.componentCount >= 2
      && previous.visualSignature.key === current.visualSignature.key
    ) {
      issues.push({
        code: "ADJACENT_VISUAL_SIGNATURE_REPEAT",
        scenes: [previous.scene, current.scene],
        message: `相邻镜头${previous.scene}-${current.scene}重复视觉签名${current.visualSignature.key}，需要有叙事目的的景别、角度或主体位置变化`
      });
    }
  }

  let acceptedSubject = null;
  const acceptedProps = new Map();
  input.forEach((shot, index) => {
    const scene = sceneReports[index]?.scene || index + 1;
    const subject = shot?.subjectState;
    if (subject?.id && subject?.appearance && subject?.state) {
      if (!acceptedSubject) {
        acceptedSubject = { ...subject };
      } else {
        const changedWithEvent = hasMeaningfulChangeEvent(subject.changeEvent);
        const next = { ...acceptedSubject };
        if (normalizeComparableText(subject.id) !== normalizeComparableText(acceptedSubject.id)) {
          if (!changedWithEvent) issues.push({ code: "SUBJECT_IDENTITY_DRIFT_WITHOUT_EVENT", scenes: [scene], message: `镜头${scene}主体id无叙事事件发生漂移` });
          else next.id = subject.id;
        }
        if (normalizeComparableText(subject.appearance) !== normalizeComparableText(acceptedSubject.appearance)) {
          if (!changedWithEvent) issues.push({ code: "SUBJECT_APPEARANCE_DRIFT_WITHOUT_EVENT", scenes: [scene], message: `镜头${scene}主体appearance无叙事事件发生漂移` });
          else next.appearance = subject.appearance;
        }
        if (normalizeComparableText(subject.state) !== normalizeComparableText(acceptedSubject.state)) {
          if (!changedWithEvent) issues.push({ code: "SUBJECT_STATE_DRIFT_WITHOUT_EVENT", scenes: [scene], message: `镜头${scene}主体state无叙事事件发生漂移` });
          else next.state = subject.state;
        }
        acceptedSubject = next;
      }
    }

    if (!Array.isArray(shot?.keyProps)) return;
    const currentIds = new Set(shot.keyProps.map((prop) => normalizeComparableText(prop?.id)).filter(Boolean));
    acceptedProps.forEach((previous, id) => {
      if (!currentIds.has(id)) issues.push({ code: "KEY_PROP_LEDGER_DROPPED", scenes: [scene], message: `镜头${scene}丢失关键道具账本项${previous.name || previous.id}` });
    });
    shot.keyProps.forEach((prop) => {
      if (!prop?.id || !prop?.appearance || !prop?.state) return;
      const id = normalizeComparableText(prop.id);
      const previous = acceptedProps.get(id);
      const changedWithEvent = hasMeaningfulChangeEvent(prop.changeEvent);
      if (!previous) {
        if (index > 0 && !changedWithEvent) issues.push({ code: "KEY_PROP_INTRODUCED_WITHOUT_EVENT", scenes: [scene], message: `镜头${scene}无叙事事件新增关键道具${prop.name || prop.id}` });
        acceptedProps.set(id, { ...prop });
        return;
      }
      const next = { ...previous };
      if (normalizeComparableText(prop.appearance) !== normalizeComparableText(previous.appearance)) {
        if (!changedWithEvent) issues.push({ code: "KEY_PROP_APPEARANCE_DRIFT_WITHOUT_EVENT", scenes: [scene], message: `镜头${scene}关键道具${prop.name || prop.id}外观无事件漂移` });
        else next.appearance = prop.appearance;
      }
      if (normalizeComparableText(prop.state) !== normalizeComparableText(previous.state)) {
        if (!changedWithEvent) {
          issues.push({ code: "KEY_PROP_STATE_DRIFT_WITHOUT_EVENT", scenes: [scene], message: `镜头${scene}关键道具${prop.name || prop.id}状态无事件漂移` });
          if (structuredPropStateClass(previous.state) === "degraded" && structuredPropStateClass(prop.state) === "usable") {
            issues.push({ code: "PROP_STATE_RECOVERY_RISK", scenes: [scene], message: `镜头${scene}关键道具${prop.name || prop.id}在没有可见恢复事件时复原` });
          }
        } else next.state = prop.state;
      }
      if (changedWithEvent) next.location = prop.location;
      acceptedProps.set(id, next);
    });
  });

  const issueCount = (code) => issues.filter((issue) => issue.code === code).length;
  return {
    ok: issues.length === 0,
    status: issues.length === 0 ? "PASS" : "FAIL",
    issues,
    metrics: {
      sceneCount: input.length,
      cameraInlineCount: sceneReports.filter((report) => report.cameraInlined).length,
      subjectStateCount: sceneReports.filter((report) => report.subjectStatePresent).length,
      visualEventCount: sceneReports.filter((report) => report.visualEventPresent).length,
      readableTextDependencyCount: issueCount("READABLE_TEXT_DEPENDENCY"),
      adjacentVisualSignatureRepeatCount: issueCount("ADJACENT_VISUAL_SIGNATURE_REPEAT")
    },
    sceneReports
  };
}

function buildStoryboardGrokRepairPayload(payload, firstResult, qualityReport) {
  const storyText = compactText(payload?.storyText, 4000);
  if (!storyText) throw new Error("storyText is required");
  const shots = Array.isArray(firstResult)
    ? firstResult
    : (Array.isArray(firstResult?.shots) ? firstResult.shots : []);
  if (shots.length !== STORYBOARD_SCENE_COUNT) {
    throw new Error(`Grok定向修复缺少完整分镜：${shots.length}/9`);
  }
  const report = qualityReport || firstResult?.directorQuality || evaluateStoryboardDirectorQuality(shots);
  const issues = Array.isArray(report?.issues)
    ? report.issues.map((issue) => ({
        code: compactText(issue?.code, 80).replace(/[^A-Z0-9_]/gi, "_").toUpperCase(),
        scenes: [...new Set((Array.isArray(issue?.scenes) ? issue.scenes : [issue?.scene])
          .map((scene) => Number(scene))
          .filter((scene) => scene >= 1 && scene <= STORYBOARD_SCENE_COUNT))],
        message: compactText(issue?.message || issue?.detail, 400)
      })).filter((issue) => issue.code && issue.scenes.length)
    : [];
  if (!issues.length) throw new Error("Grok定向修复没有需要处理的质量问题");

  const affectedScenes = [...new Set(issues.flatMap((issue) => issue.scenes))].sort((a, b) => a - b);
  const repairShots = shots.map((shot, index) => ({
    scene: Number(shot?.scene) || index + 1,
    title: compactText(shot?.title, 120),
    displayCaption: compactText(shot?.displayCaption, 180),
    visualEvent: compactText(shot?.visualEvent, 1200),
    prompt: compactText(shot?.visualEvent || storyboardCreativePromptBody(shot?.prompt, shot?.camera), 1200),
    sceneAnchor: compactText(shot?.sceneAnchor, 240),
    camera: compactText(shot?.camera, 240),
    subjectState: shot?.subjectState ? {
      id: compactText(shot.subjectState.id, 120),
      appearance: compactText(shot.subjectState.appearance, 600),
      state: compactText(shot.subjectState.state, 400),
      changeEvent: compactText(shot.subjectState.changeEvent, 400)
    } : null,
    keyProps: Array.isArray(shot?.keyProps) ? shot.keyProps.map((prop) => ({
      id: compactText(prop?.id, 120),
      name: compactText(prop?.name, 160),
      appearance: compactText(prop?.appearance, 500),
      state: compactText(prop?.state, 320),
      location: compactText(prop?.location, 320),
      changeEvent: compactText(prop?.changeEvent, 400)
    })) : null,
    storyUnitIds: Array.isArray(shot?.storyUnitIds) ? shot.storyUnitIds.slice() : []
  }));
  const repairSystem = [
    "你是 NovaFlow 通用电影分镜导演的单次定向修复器。用户故事与参考图视觉合同是最高约束；保持原主题、类型、明确事实、因果顺序、结局、主体身份、画风和九镜头结构，不得借修复另写故事。",
    "输出正好9项JSON数组，不要Markdown或解释。每项必须包含scene、title、displayCaption、visualEvent、prompt、sceneAnchor、camera、subjectState、keyProps、storyUnitIds。title与displayCaption用简体中文，其余视觉字段用清楚英文。",
    "visualEvent写单帧可见动作、互动与物理后果；prompt只写包含visualEvent、环境、光影、材质和画风的创意正文，不重复camera与状态账本。camera写完整景别、机位、主体位置、前中后景和必要运动感。不得依赖可读文字、字母、数字、百分比、字幕、Logo或UI文案表达事件；不得写glowing code、floating letters、streaming numbers或swirling glyphs，也不得用progress bar、progress ring、progress meter或progress indicator代替物理结果；数据与程序效果改用非语言的抽象光带、粒子流、几何脉冲、状态灯以及设备、目标或环境的物理后果。",
    "subjectState与keyProps是顺序状态账本：无真实可见changeEvent就逐字继承上一格；主体state不得为空，只写可延续的物理或功能状态，不写姿势、动作或临时情绪；没有特殊持久状态时写中性baseline physical and functional condition并逐格继承；道具损坏、销毁、遗失或耗尽后，没有可见修复、找回、替换或补充事件不得恢复。参考图只约束主体外观、装备、色彩和画风，不能覆盖用户剧情。",
    "这是最多执行一次的定向质量修复，不是重新创作。保持用户主题、明确事实、因果顺序、故事类型、九镜头总体结构和所有storyUnitIds覆盖不变；禁止借修复加入新角色、新地点、新事件、新道具、新造型变化或类型片套路。",
    `只修复质量报告指出的镜头${affectedScenes.join("、")}及其必要的直接连续性。未被指出的镜头保持scene、title、displayCaption、prompt、sceneAnchor、camera、subjectState、keyProps和storyUnitIds不变；若相邻视觉签名重复，只改变其中最适合叙事目的的一格镜头语言，不改事件。`,
    "按问题类型精确处理：CAMERA_NOT_INLINE要让prompt以Camera and composition开头并逐字复制最终camera字段；ADJACENT_VISUAL_SIGNATURE_REPEAT要根据该格叙事目的改变景别、角度、主体位置或运动感；VISUAL_EVENT_MISSING必须补回独立英文visualEvent，写出本格单张图片中可见的动作、互动与物理后果，不能只复制状态账本；READABLE_TEXT_DEPENDENCY或ABSTRACT_EVENT_WITHOUT_VISIBLE_EVIDENCE要保留原事件但用非语言抽象光带、粒子流、几何脉冲、状态灯、物体变化、空间后果或人物反应表达，删除glowing code、floating letters、streaming numbers、swirling glyphs等伪文字诱因，并删除progress bar、progress ring、progress meter、progress indicator等以UI代替结果的描述；SUBJECT_STATE_MISSING、SUBJECT_STATE_NOT_INLINE、SUBJECT_APPEARANCE_DRIFT_WITHOUT_EVENT、SUBJECT_STATE_DRIFT_WITHOUT_EVENT或IDENTITY_CONFLICT要从权威参考状态与上一格继承并同步修正subjectState和prompt，不得擅自改装；主体state不得为空，只能写受伤、失能、变身等可延续状态，没有特殊状态时写中性baseline physical and functional condition；站立、奔跑、蹲下、观察、紧张或专注等本格动作与情绪必须移回visualEvent与prompt；若没有真实可见变化就逐字复制上一格id、appearance和state并把changeEvent留空，若有真实变化则保留新状态并在changeEvent写出本格可见原因；KEY_PROP_STATE_NOT_INLINE、KEY_PROP_LEDGER_DROPPED、KEY_PROP_APPEARANCE_DRIFT_WITHOUT_EVENT、KEY_PROP_STATE_DRIFT_WITHOUT_EVENT或PROP_STATE_RECOVERY_RISK要继承keyProps账本并同步修正prompt，已损毁、耗尽或遗失的道具没有可见恢复事件不得恢复；DEGRADED_PROP_STILL_IN_SUBJECT_APPEARANCE要从subjectState.appearance删除该独立道具的完整外形，只在keyProps保留其状态，且销毁、遗失或耗尽后不得把完好可用形态重新画回主体身上。",
    "仍然输出正好9项JSON数组和原有schema，不要输出解释、修复报告、Markdown或额外字段。"
  ].join("\n");
  const repairUser = [
    `USER STORY (authoritative):\n${storyText}`,
    `\n\nREFERENCE VISUAL CONTINUITY (appearance and style only):\n${compactText(payload?.sourceAnalysis, 3200) || "none"}`,
    `\n\nVISUAL CUES (secondary):\n${compactText(payload?.visualCuePack, 900) || "none"}`,
    "\n\nFIRST PASS JSON (authoritative story structure; edit only the reported quality defects):\n",
    JSON.stringify(repairShots),
    "\n\nDIRECTOR QUALITY ISSUES:\n",
    JSON.stringify(issues),
    "\nReturn the complete corrected nine-shot JSON array. Preserve the original plot and all unaffected shots."
  ].join("");
  return {
    messages: [
      { role: "system", content: repairSystem },
      { role: "user", content: repairUser }
    ],
    temperature: 0.2,
    max_tokens: 4096
  };
}

function parseStoryboardGrokResult(grok, unifiedSeed, storyText) {
  const content = grok?.data?.choices?.[0]?.message?.content;
  const rawOutput = compactText(content, 60000);
  if (!rawOutput) throw new Error("Grok未返回分镜内容");
  let parsed;
  try {
    parsed = JSON.parse(extractJsonArray(rawOutput));
  } catch (err) {
    if (/Grok未返回JSON数组/.test(String(err?.message || ""))) throw err;
    throw new Error(`Grok分镜JSON解析失败：${String(err?.message || err)}`);
  }
  if (!Array.isArray(parsed) || parsed.length !== STORYBOARD_SCENE_COUNT) {
    throw new Error(`Grok分镜数量异常：${Array.isArray(parsed) ? parsed.length : 0}/9`);
  }
  const shots = parsed.map(normalizeShot).map((shot) => ({
    ...shot,
    prompt: compileCanonicalStoryboardPrompt(shot)
  }));
  const storyUnits = buildStoryUnits(storyText);
  if (storyUnits.length) {
    const expectedIds = new Set(storyUnits.map((unit) => unit.id));
    const coveredIds = new Set();
    for (const shot of shots) {
      for (const id of shot.storyUnitIds) {
        if (expectedIds.has(id)) coveredIds.add(id);
      }
    }
    const missingIds = storyUnits.filter((unit) => !coveredIds.has(unit.id)).map((unit) => unit.id);
    if (missingIds.length) throw new Error(`Grok分镜遗漏剧情单元：${missingIds.join(", ")}`);
  }
  return {
    shots,
    directorQuality: evaluateStoryboardDirectorQuality(shots),
    unifiedSeed: compactText(unifiedSeed, 80),
    rawOutput,
    promptPreview: "Grok Universal Storyboard Director",
    generateProfile: {
      provider: "grok",
      model: compactText(grok?.model, 120),
      durationMs: Number(grok?.durationMs || 0) || 0,
      usage: grok?.data?.usage || null
    }
  };
}

module.exports = {
  buildStoryUnits,
  buildStoryboardGrokPayload,
  parseStoryboardGrokResult,
  buildStoryboardVisualSignature,
  evaluateStoryboardDirectorQuality,
  buildStoryboardGrokRepairPayload,
  compileCanonicalStoryboardPrompt,
  reconcileStoryboardGrokContinuity
};
