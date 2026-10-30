"""Task-specific Qwen 2.1 guidance, composed with the existing art compiler.

References (paraphrased, not a replacement output contract):
https://github.com/iamyoki/qwen-image-2.1-skill
https://github.com/QwenLM/Qwen-Image-2.1/tree/main/prompt_rewrite/prompts
"""

VERSION = "qwen21-task-policy-v1"


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
