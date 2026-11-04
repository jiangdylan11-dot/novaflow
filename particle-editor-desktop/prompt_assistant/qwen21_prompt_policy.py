"""Task-specific Qwen 2.1 guidance, composed with the existing art compiler.

References (paraphrased, not a replacement output contract):
https://github.com/iamyoki/qwen-image-2.1-skill
https://github.com/QwenLM/Qwen-Image-2.1/tree/main/prompt_rewrite/prompts
"""

VERSION = "qwen21-task-policy-v1"
NATIVE_CONTRACT = "qwen21-native-rewrite-v3"

_NATIVE_SYSTEM = """Rewrite an image prompt for Qwen Image 2.1. Return exactly one JSON object with matching Chinese display_prompt and English model_prompt. Both describe the same finished image, with no Markdown or explanation.
For text-to-image use observer prose: anchor the medium, style, subject and background first. Walk the frame in a coherent spatial order, locating meaningful elements relative to each other and the frame; distinguish foreground and background when relevant. Describe visible materials, specific color tones, coherent light direction, shadows and reflections. Close once on composition and mood. Develop ordinary scenes with useful visual detail, while respecting intentionally minimal images and empty space. Describe all explicitly requested content and placement. Do not add unrequested subjects, lettering, logos or narrative props. Do not use section inventories or empty quality boosters.
Preserve explicitly specified subjects, counts, colors, locations and constraints. User-given readable text remains verbatim in its original script in both prompts; translate descriptive prose only. Retain application reference placeholders exactly. Apply explicit changes to the final state. Canvas dimensions, sampling and negative prompt are application parameters; do not invent or change them."""


def compile_agent_native(payload: dict, generate) -> dict:
    """One opt-in text-to-image inference; no reference/image or legacy fallback."""
    import json
    import re
    if (payload.get("promptContract") != NATIVE_CONTRACT or payload.get("surface") != "art"
            or payload.get("purpose") != "optimize" or payload.get("targetEngine") != "qwen-2.1"
            or payload.get("qwenPromptMode") != "txt2img" or payload.get("nsfw") is True):
        raise ValueError("本地原生提示词优化范围无效")
    source = str(payload.get("currentPrompt") or payload.get("prompt") or "").strip()
    requirements = str(payload.get("requirements") or "").strip()
    if not source or len(source) > 20000 or len(requirements) > 2000:
        raise ValueError("请输入完整的绘图提示词")
    if re.search(r'data:(?:image|audio|video)/|<image\s*\d+>|@参考图\s*\d+|__NOVAFLOW_RESOURCE_MENTION_\d+_\d+__', source + requirements, re.I):
        raise ValueError("本次本地文生图优化不接收参考素材")
    template = "<|im_start|>system\n" + _NATIVE_SYSTEM + "\n<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
    request = json.dumps({"task": "text-to-image", "current_prompt": source, "requested_changes": requirements}, ensure_ascii=False)
    raw = str(generate(request, llama_template=template, max_length=1536, do_sample=False, temperature=0.0,
                       trace_label="qwen21NativeRewrite") or "").strip()
    fenced = re.fullmatch(r"```(?:json)?\s*([\s\S]*?)\s*```", raw, re.I)
    if fenced:
        raw = fenced.group(1)
    try:
        value = json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise ValueError("本地模型未返回完整的提示词结果") from exc
    if not isinstance(value, dict) or set(value) != {"display_prompt", "model_prompt"} or any(not isinstance(value[k], str) for k in value):
        raise ValueError("本地模型提示词格式无效")
    display, model = value["display_prompt"].strip(), value["model_prompt"].strip()
    if len(display) < 8 or len(model) < 20 or len(display) > 16000 or len(model) > 20000 or len(re.findall(r"[A-Za-z]+", model)) < 8:
        raise ValueError("本地模型提示词未完整返回")
    quote = r'“([^”\r\n]+)”|‘([^’\r\n]+)’|「([^」\r\n]+)」|『([^』\r\n]+)』|"([^"\r\n]+)"'
    literals = lambda text: [next((x for x in match if x), "") for match in re.findall(quote, str(text))]
    base, changed = literals(source), literals(requirements)
    old = set(re.findall(r'(?:从|由)\s*[“‘「『"]([^”’」』"\r\n]+)[”’」』"]\s*(?:改为|改成|替换为|换成)', source + "\n" + requirements))
    if changed and len(base) == 1 and re.search(r'(?:文字|标题|标语|标签|文案|text|title|label).{0,30}(?:改为|改成|替换|换成|写成|change|replace)', requirements, re.I):
        old.add(base[0])
    refs = re.findall(r'__NF[A-Za-z0-9_]+__', source + "\n" + requirements)
    exact = set([x for x in base + changed if x not in old] + literals(display) + refs)
    if any(item not in display or item not in model for item in exact):
        raise ValueError("本地模型未完整保留画面文字或资源引用")
    prose = model
    for item in exact:
        prose = prose.replace(item, "")
    if re.search(r'[\u3400-\u9fff\uf900-\ufaff]', prose):
        raise ValueError("英文执行提示词未完整返回")
    number_words = {"一": (1, "one|a|an"), "二": (2, "two|a pair of"), "两": (2, "two|a pair of"), "三": (3, "three"), "四": (4, "four"), "五": (5, "five"), "六": (6, "six"), "七": (7, "seven"), "八": (8, "eight"), "九": (9, "nine"), "十": (10, "ten")}
    fact_source = requirements if re.search(r'改成|改为|替换|换成|删除|去掉|移除|change|replace|remove', requirements, re.I) else source + "\n" + requirements
    counts = re.findall(r'(\d+|[一二两三四五六七八九十])\s*(?:只|个|位|名|辆|座|张|件|本|朵|棵|把|艘|枚)', fact_source)
    display_counts = re.findall(r'(\d+|[一二两三四五六七八九十])\s*(?:只|个|位|名|辆|座|张|件|本|朵|棵|把|艘|枚)', display)
    numeric = lambda x: number_words[x][0] if x in number_words else int(x)
    display_numbers = {numeric(x) for x in display_counts} | ({2} if '一对' in display else set())
    for count in counts:
        number = numeric(count)
        synonyms = number_words[count][1] if count in number_words else {1: 'one|a|an', 2: 'two|a pair of', 3: 'three'}.get(number, str(number))
        if number not in display_numbers or not re.search(r'\b(?:' + str(number) + '|' + synonyms + r')\b', model, re.I):
            raise ValueError("本地模型未保留指定数量")
    for zh, en in (("红色", "red"), ("蓝色", "blue"), ("绿色", "green"), ("白色", "white"), ("黑色", "black"), ("黄色", "yellow"), ("紫色", "purple"), ("橙色", "orange"), ("粉色", "pink"), ("灰色", "gr[ae]y")):
        if zh in fact_source and (zh[0] not in display or not re.search(r'\b' + en + r'\b', model, re.I)):
            raise ValueError("本地模型未保留指定颜色")
    for zh, en in (("左下角", r"(?:lower|bottom)[ -]left"), ("右下角", r"(?:lower|bottom)[ -]right"), ("左上角", r"(?:upper|top)[ -]left"), ("右上角", r"(?:upper|top)[ -]right")):
        if zh in fact_source and (zh not in display or not re.search(en, model, re.I)):
            raise ValueError("本地模型未保留指定位置")
    negative = str(payload.get("negativePrompt") or "")
    return {"positivePrompt": display, "displayPrompt": display, "modelPrompt": model, "modelPromptLanguage": "en",
            "promptContract": NATIVE_CONTRACT, "modelPromptPolicy": NATIVE_CONTRACT,
            "translationValidation": "paired-prose-and-literals", "negativePrompt": negative,
            "hasNegativePrompt": payload.get("supportsNegativePrompt") is not False}


def compile_agent_english(payload: dict, result: dict, generate) -> dict:
    """Translate an already validated Chinese optimization within its owned session.

    Opt-in only: manual prompt input and the original optimization dialog retain
    their existing behavior. The Chinese text remains the editable display copy.
    """
    if not policy_for(payload) or payload.get("agentModelLanguage") != "en":
        return result
    import re
    display = str(result.get("positivePrompt") or "").strip()
    if not display:
        raise ValueError("优化框架未返回可翻译的完整提示词")
    template = (
        "<|im_start|>system\nTranslate the supplied validated image prompt into English for Qwen Image 2.1. "
        "Translate only; do not optimize again, summarize, add or remove facts. Preserve every object count, color, "
        "relative position, negative statement, material, lighting and camera constraint. Translate quoted descriptive field values too. Keep artwork lettering "
        "verbatim, including its original language, spelling and punctuation. Preserve reference placeholders and "
        "program identifiers exactly. Translate section labels into English. Return only the complete English prompt."
        "<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n"
    )
    model = str(generate(display, llama_template=template, max_length=min(4096, max(1536, len(display) * 3)),
                         do_sample=False, temperature=0.0, trace_label="artAgentModelTranslation")).strip()
    literals = re.findall(r'(?:文字|标题|标语|标签|lettering|text)[^\n]{0,30}?[“「"]([^”」"\n]+)[”」"]', display, re.I)
    references = re.findall(r'<image\d+>|@参考图\s*\d+|__NF[A-Za-z0-9_]+__', display)
    if not model or any(item not in model for item in literals + references) or len(re.findall(r'[A-Za-z]+', model)) < 8:
        raise ValueError("英文执行提示词未完整保留画面文字或引用，未提交生成")
    return {**result, "displayPrompt": display, "modelPrompt": model, "modelPromptLanguage": "en"}


def policy_for(payload: dict) -> str:
    if payload.get("targetEngine") != "qwen-2.1":
        return ""
    common = (
        "Qwen Image 2.1 表达适配：用户明确指定的主体、数量、颜色、方位和画中文字逐项保留。"
        "画面文字原文引用，不能翻译、改写或添加未要求的可读文字。"
        "任务说明不能混入画面；画幅与像素尺寸由应用参数持有，不擅自改尺寸。"
        "具体描述空间关系、表面材质及光源方向，不堆砌大师之作、8K等空泛质量词。"
        "细节数量服从用户的复杂度和留白要求，不能为凑字数添加物品或人物。"
    )
    if payload.get("surface") == "ui-design":
        return common + (
            "本次是UI参考编辑，不使用文生图观察描述或普通绘图五段模板。"
            "先明确用户指定的修改对象和属性，再分别绑定布局、风格、配色、质感与人物素材职责，"
            "不能把某张参考图未指定的属性、文字或控件一起复制。"
            "局部修改不重新描述未改区域的旧外观，其他内容用概括性保留条款。"
            "有效文案、数值、功能与状态保持原样；用户明确修改的文字逐字使用原文。"
            "输出原有UI规划合同，不新增按钮、功能、业务金额或布局数据；"
            "尺寸与素材顺序由应用参数控制，内部区域名和说明不作为画面文字。"
        )
    if payload.get("qwenPromptMode") == "img2img":
        return common + (
            "本次是编辑已有图片：以明确的修改操作开头，只强化用户点名的属性。"
            "未要求修改的身份、数量、布局、服饰和风格保持输入一致，使用概括性保留条款，"
            "不要靠重新描写未修改区域使其重绘。引用当前真实输入，不虚构不可见细节。"
            "沿用应用传入的引用标记；描述语言与画中文字语言分别判断。"
        )
    return common + (
        "本次是文生图：从观察完成画面的角度组织陈述，先说明媒介、风格与核心主体，"
        "再按实际构图交代前后和左右位置，说明光照，形成连贯可见的最终画面。"
        "原有输出分段与语言合同继续有效，不输出给模型的操作步骤或额外解释。"
    )


def inject_policy(text: str, payload: dict) -> str:
    rules = policy_for(payload)
    if not rules:
        return text
    if "<|im_start|>system" in text and "<|im_end|>" in text:
        return text.replace("<|im_end|>", "\n" + rules + "<|im_end|>", 1)
    return text + "\n" + rules
