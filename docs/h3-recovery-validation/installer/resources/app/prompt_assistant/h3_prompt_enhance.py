"""Conservative optimization checks; these do not certify visual generation quality."""
import json
import re
import unicodedata
from pathlib import Path

POLICY = json.loads(Path(__file__).with_name("h3_prompt_enhance_policy.json").read_text(encoding="utf-8"))
INSTRUCTION = "\n".join(POLICY["instructions"])


def narrative(value):
    text = str(value or "")
    detailed = re.search(r"【递进式详细提示词】\s*([\s\S]*?)(?=【台词】|$)", text)
    if detailed:
        text = re.sub(r"(?m)^\s*\d+(?:\.\d+)?\s*[-–—~至]\s*\d+(?:\.\d+)?\s*(?:s|秒)\s*[:：]?", "", detailed.group(1))
    match = re.search(r"(?:^|\n)\s*(?:integrated_multimodal_description|detailed_description)\s*:\s*([\s\S]*?)(?=\n\s*[a-z][a-z0-9_]*\s*:|$)", text)
    if match:
        text = match.group(1)
    text = re.sub(r"\[Shot\s+\d+\](?:\s+At\s+\d{2}:\d{2}\.\d{3})?", "", text, flags=re.I)
    text = re.sub(r"<(?:Picture|Video|Audio|Subject) \d+>", "", text, flags=re.I)
    text = re.sub(POLICY["genericPaddingPattern"], "", text, flags=re.I)
    return text


def compact(value):
    return re.sub(r"[^a-z0-9\u3400-\u9fff]", "", unicodedata.normalize("NFKC", value).lower())


def validate_enhancement(output, source, user_requirement=""):
    if re.search(POLICY["formatOnlyPattern"], user_requirement or "", re.I):
        return output
    source_narrative, result_narrative = narrative(source), narrative(output)
    before, after = compact(source_narrative), compact(result_narrative)
    if before:
        old_pairs = {before[i:i + 2] for i in range(len(before) - 1)}
        new_pairs = {after[i:i + 2] for i in range(len(after) - 1)}
        novel = new_pairs - old_pairs
        if before == after or (len(before) >= 40 and len(novel) < 6 and len(after) >= len(before) * 0.9):
            raise ValueError(POLICY["noChangeMessage"])
    intent = user_requirement or source_narrative
    if (re.search(POLICY["loopPattern"], source_narrative + "\n" + (user_requirement or ""), re.I)
            and not re.search(POLICY["cancelLoopPattern"], intent, re.I)):
        if not re.search(POLICY["closurePattern"], result_narrative, re.I):
            raise ValueError(POLICY["loopMessage"])
    return output


SECTION_NAMES = ["任务定位", "说话者", "递进式详细提示词", "台词", "连续性与约束"]
SECTION_FIELDS = ["task", "speakers", "description", "dialogue", "constraints"]
FORMAT_INSTRUCTION = "\n".join(POLICY["formatInstructions"])


def validate_format(value, mode, duration_seconds, source="", requirements=""):
    text = re.sub(r"^```(?:json|text|plaintext)?\s*\n([\s\S]*?)\n```$", r"\1", str(value or "").strip(), flags=re.I).strip()
    text = re.sub(r"\\(?=<(?:Picture|Video|Audio|Subject) )", "", text)
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        parsed = None
    if isinstance(parsed, dict):
        if set(parsed) != set(SECTION_FIELDS) or any(not isinstance(parsed[f], str) or not parsed[f].strip() for f in SECTION_FIELDS):
            raise ValueError("五段提示词字段缺失或为空")
        text = "\n\n".join(f"【{name}】\n{parsed[field].strip()}" for name, field in zip(SECTION_NAMES, SECTION_FIELDS))
    text = re.sub(r"(?m)^(" + "|".join(SECTION_NAMES) + r")\s*[:：]\s*", r"【\1】\n", text)
    text = re.sub(r"([^\n\d.])(\d+(?:\.\d+)?\s*[-–—~至]\s*\d+(?:\.\d+)?\s*(?:s|秒)\s*[:：])", r"\1\n\n\2", text)
    text = re.sub(r"（(S[1-9]\d*)）", r"(\1)", text)
    headers = list(re.finditer(r"(?m)^\s*【([^】]+)】[ \t]*[:：]?[ \t]*", text))
    if [m[1] for m in headers] != SECTION_NAMES or text[:headers[0].start()].strip():
        raise ValueError("请按任务定位、说话者、递进式详细提示词、台词、连续性与约束输出完整五段")
    sections = [text[m.end():headers[i + 1].start() if i + 1 < len(headers) else len(text)].strip() for i, m in enumerate(headers)]
    if any(not s for s in sections):
        raise ValueError("五段提示词内容不能为空")
    duration = float(duration_seconds)
    if not 1 <= duration <= 30:
        raise ValueError("H3 时长必须为 1-30 秒")
    ranges = list(re.finditer(r"(?m)^\s*(\d+(?:\.\d+)?)\s*[-–—~至]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\s*[:：]\s*(.+)", sections[2]))
    if not ranges:
        raise ValueError("详细提示词缺少分时段动作")
    end = 0
    for m in ranges:
        if abs(float(m[1]) - end) > .051 or float(m[2]) <= float(m[1]) or float(m[2]) > duration + .051:
            raise ValueError("动作时间段必须从 0 连续递进且不超过所选时长")
        end = float(m[2])
    if abs(end - duration) > .051:
        raise ValueError("动作时间段未覆盖完整时长")
    task_duration = re.search(r"(?:时长\s*[:：]?\s*|duration\s*[:：]?\s*|lasts?\s+)?(\d+(?:\.\d+)?)\s*(?:秒|seconds?\b)", sections[0], re.I)
    if not task_duration or abs(float(task_duration[1]) - duration) > .051:
        raise ValueError("任务定位时长与当前设置不一致")
    # Camera direction is generation guidance, not a literal-keyword validity rule.
    i2v = mode.lower() in ("i2va", "image_video", "i2v")
    fl2v = mode.lower() in ("fl2va", "first_last", "fl2v")
    tokens = lambda s: set(re.findall(r"<(?:Picture|Video|Audio) [1-9]\d*>", s))
    inventory = re.search(r"(?im)^Available resource labels:([^\n]*)", requirements)
    allowed = {"<Picture 1>"} if i2v else {"<Picture 1>", "<Picture 2>"} if fl2v else tokens(inventory[1] if inventory else source + "\n" + requirements)
    if tokens(text) != allowed:
        raise ValueError("参考媒体标签缺失或引用了未提供的媒体")
    if i2v or fl2v:
        anchors = sections[0] + "\n" + sections[2]
        if not re.search(r"<Picture 1>[^\n。]{0,100}(?:起始|首帧|开始|starting|opening|first frame)|(?:起始|首帧|starting|opening)[^\n。]{0,100}<Picture 1>", anchors, re.I):
            raise ValueError("缺少首帧图片绑定")
        if fl2v and not re.search(r"<Picture 2>[^\n。]{0,100}(?:末帧|尾帧|终帧|结束|final|last frame)|(?:末帧|尾帧|终帧|final)[^\n。]{0,100}<Picture 2>", anchors, re.I):
            raise ValueError("缺少尾帧图片绑定")
    definitions = re.findall(r"<Subject ([1-9]\d*)>\s*=\s*\(S([1-9]\d*)\)", sections[1])
    if any(int(a) != i + 1 or a != b for i, (a, b) in enumerate(definitions)):
        raise ValueError("说话者定义必须从 <Subject 1> = (S1) 连续编号")
    uses = [int(a or b) for a, b in re.findall(r"<Subject ([1-9]\d*)>|\bS([1-9]\d*)\b", text)]
    if any(n not in [int(a) for a, _ in definitions] for n in uses):
        raise ValueError("存在未定义的说话者")
    spoken = re.findall(r'\(S([1-9]\d*)\)\s*[:：]\s*[“"]([^”"]+)[”"]', sections[3])
    if spoken and re.search(r"无台词|无对白|完全静音|no dialogue|complete silence", sections[2], re.I):
        raise ValueError("说话时间线与台词冲突")
    if not spoken and not re.fullmatch(r"(?:无台词|无对白|无|N/A|None|No dialogue)[。.]?", sections[3], re.I):
        raise ValueError("台词须使用 (S1)：‘...’ 或无台词")
    for words in re.findall(r'\(S[1-9]\d*\)\s*[:：]\s*[“"]([^”"]+)[”"]', source):
        if words not in sections[3]:
            raise ValueError("原台词未完整保留")
    return "\n\n".join(f"【{name}】\n{content}" for name, content in zip(SECTION_NAMES, sections))
