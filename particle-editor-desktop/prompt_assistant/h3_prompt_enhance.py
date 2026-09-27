"""Conservative optimization checks; these do not certify visual generation quality."""
import json
import re
import unicodedata
from pathlib import Path

POLICY = json.loads(Path(__file__).with_name("h3_prompt_enhance_policy.json").read_text(encoding="utf-8"))
INSTRUCTION = "\n".join(POLICY["instructions"])
REFERENCE_INSTRUCTION = "\n".join(POLICY["referenceInstructions"])
REFERENCE_FIELDS = ("subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music")
CAMERA_PATTERN = r"镜头|相机|摄像|机位|运镜|\bcamera\b|\bzoom\b|\bdolly\b|\bpanning\b"
DEFAULT_CAMERA_ZH = "镜头固定，构图保持稳定。"
DEFAULT_CAMERA_EN = "The camera remains static and the framing stays stable."


def reference_label(value):
    """Accept equivalent label spellings without inventing or renumbering assets."""
    if not isinstance(value, str):
        raise ValueError("H3 多参关系计划素材来源无效")
    value = value.strip()
    aliases = {"视频参考": "<Video 1>", "参考视频": "<Video 1>", "声音参考": "<Audio 1>", "音频参考": "<Audio 1>"}
    if value.lstrip('@') in aliases:
        return aliases[value.lstrip('@')]
    match = re.fullmatch(r"multi_ref_(image|video|audio)_([1-9]\d*)", value)
    if match:
        return "<" + {"image": "Picture", "video": "Video", "audio": "Audio"}[match[1]] + " " + match[2] + ">"
    match = re.fullmatch(r"@?(?:参考图|图片)\s*([1-9]\d*)", value)
    if match:
        return "<Picture " + match[1] + ">"
    match = re.fullmatch(r"<?\s*(Subject|Picture|Image|Video|Audio)\s*([1-9]\d*)\s*>?", value, re.I)
    if not match:
        raise ValueError("H3 多参关系计划素材来源无效")
    kind = match[1].capitalize()
    return "<" + ("Picture" if kind == "Image" else kind) + " " + match[2] + ">"


def reconcile_tasks(tasks, allowed):
    """Bind the task list to what was actually uploaded.

    The uploads decide the mode: without a source video there is no video
    editing or continuation, without audio no audio task. The model's guess is
    trimmed rather than rejected so a single picture never demands a video.
    """
    has_video = any(label.startswith('<Video ') for label in allowed)
    has_audio = any(label.startswith('<Audio ') for label in allowed)
    has_picture = any(label.startswith('<Picture ') for label in allowed)
    kept = []
    for task in tasks:
        if not isinstance(task, str):
            continue
        task = task.strip().lower()
        if task in ('video editing', 'video continuation') and not has_video:
            continue
        if task in ('audio reuse', 'audio reference') and not has_audio:
            continue
        if task == 'keyframe completion' and not has_picture:
            continue
        if task not in kept:
            kept.append(task)
    if not any(task in kept for task in ('reference generation', 'keyframe completion', 'video editing', 'video continuation')):
        kept.insert(0, 'reference generation')
    return kept


def normalize_reference_plan(value, requirements="", source="", user_requirement=""):
    """Compile optional protocol details from model-authored semantic bindings.

    Missing creative content is still an error. Labels may only be resolved
    from the model's own sources and the uploaded inventory, never filenames.
    """
    text = re.sub(r"^```(?:json)?\s*\n([\s\S]*?)\n```$", r"\1", str(value).strip()).strip()
    # A small model may break a long description across lines inside a string.
    plan = json.loads(text, strict=False)
    if not isinstance(plan, dict):
        raise ValueError("H3 多参关系计划不完整")
    for alias, name in (("subjects", "references"), ("detailed_description", "description"), ("overall_soundscape", "soundscape"), ("non_diegetic_music", "music")):
        if name not in plan and alias in plan:
            plan[name] = plan.pop(alias)
    if not isinstance(plan.get('references'), list) or not isinstance(plan.get('tasks'), list):
        raise ValueError("H3 多参关系计划不完整")
    inventory = re.search(r"(?im)^Available resource labels:([^\n]*)", requirements)
    allowed = set(re.findall(r"<(?:Picture|Video|Audio) [1-9]\d*>", inventory[1] if inventory else text))
    plan['tasks'] = reconcile_tasks(plan['tasks'], allowed)
    editing = 'video editing' in plan['tasks']
    # A model may invent a row for an asset that was never uploaded (typically a
    # source video). Drop that row instead of failing the whole compile.
    plan['references'] = [item for item in plan['references'] if not (isinstance(item, dict)
        and re.fullmatch(r"<(?:Picture|Video|Audio) [1-9]\d*>", str(item.get('label', '')).strip())
        and str(item.get('label', '')).strip() not in allowed)]
    merged = {}
    subject_ids = {int(m[1]) for item in plan['references'] if isinstance(item, dict) for m in [re.fullmatch(r'<Subject ([1-9]\d*)>', str(item.get('label', '')))] if m}
    image_subjects = {}
    for item in plan['references']:
        if not isinstance(item, dict):
            raise ValueError("H3 多参关系计划字段不完整")
        item = dict(item)
        label = reference_label(item.get('label'))
        item['label'] = label
        origins = item.get('sources', [])
        if isinstance(origins, str):
            origins = re.split(r"\s*[,，;；、]\s*", origins.strip()) if origins.strip() else []
        if not isinstance(origins, list):
            raise ValueError("H3 多参关系计划素材来源无效")
        origins = [reference_label(v) for v in origins]
        if label.startswith('<Subject '):
            # The semantic description may bind appearance plus movement even
            # when the optional sources array only repeats one of those assets.
            origins = list(dict.fromkeys(origins + re.findall(r'<(?:Picture|Video|Audio) [1-9]\d*>', str(item.get('description', '')))))
        if any(origin not in allowed for origin in origins) or (not label.startswith('<Subject ') and label not in allowed):
            raise ValueError("H3 多参关系计划素材来源无效")
        item['sources'] = list(dict.fromkeys(origins))
        if label.startswith('<Picture ') and 'keyframe completion' not in plan['tasks'] and set(origins or [label]) == {label}:
            # A model may name the asset instead of creating an internal ID.
            # Allocate that bookkeeping ID while retaining the actual source.
            if label not in image_subjects:
                number = next(n for n in range(1, len(plan['references'])+2) if n not in subject_ids)
                subject_ids.add(number)
                image_subjects[label] = f'<Subject {number}>'
            item['sources'] = origins = [label]
            item['label'] = label = image_subjects[label]
        # Fidelity applies to the role defined by the model. A fully retained
        # costume/image identity is compatible with editing another attribute;
        # it does not turn that image into a first-frame composition anchor.
        if not item.get('relation'):
            if label.startswith('<Video ') and editing:
                item['relation'] = 'partially_preserved'
            elif label.startswith('<Subject ') and origins:
                pictures = [origin for origin in origins if origin.startswith('<Picture ')]
                # A generated subject taken from one picture keeps that identity;
                # several pictures combine an identity with borrowed attributes.
                item['relation'] = ('attribute_transfer' if pictures else 'partially_preserved') if editing else (
                    'fully_preserved' if len(pictures) == 1 else 'partially_preserved' if pictures else 'weak_reference')
            else:
                # In particular never guess copy versus reference for audio.
                raise ValueError("H3 多参缺少主体或声音的保留规则")
        if isinstance(item.get('keep'), list):
            item['keep'] = '; '.join(item['keep'])
        if label in merged:
            old = merged[label]
            if old['relation'] != item['relation']:
                # Generating from pictures, one subject may be written as its
                # identity row plus a borrowed-attribute row (a girl from one
                # picture, armour from another): that is a partial retention.
                if editing or 'attribute_transfer' not in (old['relation'], item['relation']):
                    raise ValueError("H3 同一主体的保留规则冲突")
                old['relation'] = 'partially_preserved'
            old['sources'] = list(dict.fromkeys(old['sources'] + item['sources']))
            for field in ('description', 'keep'):
                old[field] = old.get(field, '') + '; ' + item.get(field, '')
        else:
            merged[label] = item
    # A source video named by the model's edit is a resource binding, not a
    # second creative subject. Reuse its authored constraints when its row is omitted.
    used_videos = set(re.findall(r'<Video [1-9]\d*>', str(plan.get('summary', '')) + '\n' + str(plan.get('description', ''))))
    if editing:
        available_videos = {label for label in allowed if label.startswith('<Video ')}
        if not used_videos and len(available_videos) == 1:
            used_videos = available_videos
        for video in sorted(used_videos):
            if video not in allowed:
                raise ValueError("H3 多参关系计划素材来源无效")
            if video not in merged:
                merged[video] = {'label': video, 'sources': [], 'description': '本次编辑的源视频。', 'relation': 'partially_preserved', 'keep': '按目标描述执行本次修改；未指定修改的背景、镜头、构图及动作时序沿用源视频。'}
        if any(any(s.startswith('<Picture ') for s in item['sources']) for item in merged.values()) and 'reference generation' not in plan['tasks']:
            plan['tasks'].append('reference generation')
        if not re.search(r'镜头|相机|摄像|机位|运镜|\bcamera\b|\bzoom\b|\bdolly\b|\bpanning\b', text + source + user_requirement, re.I):
            for video in used_videos:
                merged[video]['keep'] += ' 保留原视频镜头。'
    plan['references'] = list(merged.values())
    # A single source-only edit may name its target in the shot but omit the
    # bookkeeping Subject row. Bind that already-authored target to the sole
    # video; reuse its edited narrative, without inventing an object/appearance.
    mentioned_subjects = set(re.findall(r'<Subject [1-9]\d*>', str(plan.get('description', ''))))
    if editing and mentioned_subjects == {'<Subject 1>'} and not any(k.startswith('<Subject ') for k in merged) and len(used_videos) == 1 and all(k.startswith('<Video ') for k in merged):
        video = next(iter(used_videos))
        plan['references'].insert(0, {'label': '<Subject 1>', 'sources': [video],
            'description': str(plan['description']).replace('<Subject 1>', '目标内容'),
            'relation': 'partially_preserved', 'keep': merged[video]['keep']})
    for picture, subject in image_subjects.items():
        if isinstance(plan.get('description'), str):
            plan['description'] = plan['description'].replace(picture, subject)
    for field in ('soundscape', 'music'):
        if not plan.get(field) and not any(v.startswith('<Audio ') for v in allowed):
            plan[field] = 'N/A'
    return plan


def render_reference_plan(value, requirements="", duration=30, source="", user_requirement=""):
    """Serialize model-authored relationships; Python owns all H3 punctuation."""
    plan = normalize_reference_plan(value, requirements, source, user_requirement)
    plan.pop('editPolicy', None)
    required = {"references", "tasks", "summary", "description", "soundscape", "music"}
    if not isinstance(plan, dict) or set(plan) != required or not isinstance(plan["references"], list) or not isinstance(plan["tasks"], list):
        raise ValueError("H3 多参关系计划不完整")
    definitions, retention, subjects = [], [], []
    for item in plan["references"]:
        if not isinstance(item, dict) or set(item) != {"label", "sources", "description", "relation", "keep"}:
            raise ValueError("H3 多参关系计划字段不完整")
        label = reference_label(item["label"])
        item["label"] = label
        if not isinstance(label, str) or not re.fullmatch(r"<(?:Subject|Picture|Video|Audio) [1-9]\d*>", label):
            raise ValueError("H3 多参关系计划标签无效")
        if isinstance(item["keep"], list) and all(isinstance(v, str) for v in item["keep"]):
            item["keep"] = "; ".join(item["keep"])
        sources = item["sources"]
        if isinstance(sources, str):
            sources = [] if not sources.strip() else re.split(r"\s*[,，;；、]\s*", sources.strip())
        if not isinstance(sources, list):
            raise ValueError("H3 多参关系计划素材来源无效")
        item["sources"] = [reference_label(t) for t in sources]
        if any(t.startswith('<Subject ') for t in item['sources']):
            raise ValueError("H3 多参来源必须是上传素材标签，不能引用主体自身")
        if any(not isinstance(item[k], str) or not item[k].strip() for k in ("description", "relation", "keep")):
            raise ValueError("H3 多参关系计划内容为空")
        origins = " 素材来源：" + "、".join(item["sources"]) + "。" if item["sources"] else ""
        definitions.append(label + "：" + item["description"].strip() + origins)
        retention.append(label + ": " + item["relation"].strip() + " - " + item["keep"].strip())
        if label.startswith("<Subject "):
            subjects.append(label)
    for k in ("summary", "description", "soundscape", "music"):
        if not isinstance(plan[k], str) or not plan[k].strip():
            raise ValueError("H3 多参关系计划内容为空")
    if any(not isinstance(t, str) for t in plan["tasks"]):
        raise ValueError("H3 多参缺少明确任务关系")
    summary = plan["summary"].strip()
    if "video editing" in plan["tasks"]:
        videos = [r["label"] for r in plan["references"] if r["label"].startswith("<Video ")]
        if not videos:
            raise ValueError("H3 视频编辑必须指定源视频")
        summary = "The target video is an edited version of " + videos[0] + ". " + summary
    description = plan["description"].strip()
    if "video editing" in plan["tasks"]:
        # Source editing retains unspecified content by definition. Express
        # that temporal binding without inventing observed motion or overriding
        # explicit camera, timing, background or transformation requests.
        description += ' 除本次明确要求改变的部分外，沿用 ' + videos[0] + ' 对应时刻的背景、镜头、构图、动作方向、速度、轨迹和姿态；指定的编辑效果按上述要求持续生效。'
    loop_requested = re.search(POLICY["loopPattern"], source + "\n" + user_requirement, re.I) and not re.search(POLICY["cancelLoopPattern"], user_requirement or source, re.I)
    if loop_requested and not re.search(POLICY["closurePattern"], description, re.I):
        description += " 结束时平滑回到起始姿态与运动相位，使循环自然衔接。"
    # A generated (non-edit) shot must state its camera; an edit inherits the
    # source camera. Default to a locked camera rather than rejecting the plan.
    if "video editing" not in plan["tasks"] and not re.search(CAMERA_PATTERN, description + " " + source + " " + user_requirement, re.I):
        description += " " + DEFAULT_CAMERA_ZH
    if "[Shot 1]" not in description:
        description = "[Shot 1] " + description
    result = dict(zip(REFERENCE_FIELDS, ("\n".join(definitions), "[" + " + ".join(plan["tasks"]) + "] " + summary, "\n".join(retention), description, plan["soundscape"], plan["music"])))
    return validate_reference(json.dumps(result), requirements, duration)


def validate_reference(value, requirements="", duration=30):
    text = re.sub(r"^```(?:json|text)?\s*\n([\s\S]*?)\n```$", r"\1", str(value).strip()).strip()
    if text.startswith("{"):
        fields = json.loads(text)
        if set(fields) != set(REFERENCE_FIELDS) or any(not isinstance(fields[k], str) or not fields[k].strip() for k in REFERENCE_FIELDS):
            raise ValueError("H3 多参需要完整的六个参考字段")
    else:
        headers = list(re.finditer(r"(?m)^([a-z][a-z0-9_]*):[ \t]*", text))
        if tuple(m.group(1) for m in headers) != REFERENCE_FIELDS:
            raise ValueError("H3 多参需要完整的六个参考字段")
        fields = {m.group(1): text[m.end():headers[i+1].start() if i+1 < len(headers) else len(text)].strip() for i, m in enumerate(headers)}
    if any(not fields[k].strip() for k in REFERENCE_FIELDS):
        raise ValueError("H3 多参字段不能为空")
    text = "\n\n".join(k + ":\n" + fields[k].strip() for k in REFERENCE_FIELDS)
    inventory = re.search(r"(?im)^Available resource labels:([^\n]*)", requirements)
    if inventory:
        media = lambda v: set(re.findall(r"<(?:Picture|Video|Audio) [1-9]\d*>", v))
        if not media(text).issubset(media(inventory.group(1))):
            raise ValueError("H3 多参引用与已上传素材不一致")
    definitions = list(re.finditer(r"(?m)^<Subject ([1-9]\d*)>[^\n]+", fields["subject_definitions"]))
    ids = [int(m.group(1)) for m in definitions]
    if ids != list(range(1, len(ids)+1)) or any(int(n) not in ids for n in re.findall(r"<Subject ([1-9]\d*)>", text)):
        raise ValueError("H3 多参主体缺少独立定义")
    if re.search(r"<(?:Picture|Video) [1-9]\d*>", inventory.group(1) if inventory else text) and any(not re.search(r"<(?:Picture|Video) [1-9]\d*>", m.group()) for m in definitions):
        raise ValueError("H3 多参主体必须说明外观或动作的素材来源")
    task = re.match(r"\[([^\]]*)\]", fields["summary"])
    tasks = [t for t in re.split(r"\s*\+\s*", task.group(1).strip()) if t] if task else []
    # Without a source video the task can only be reference generation; a
    # missing [task] prefix is filled in from the uploads below instead of failing.
    infer_tasks = not tasks and inventory and not re.search(r"<Video [1-9]\d*>", inventory.group(1))
    if not infer_tasks and not tasks or any(t not in ("reference generation", "keyframe completion", "video editing", "video continuation", "audio reuse", "audio reference") for t in tasks):
        raise ValueError("H3 多参缺少明确任务关系")
    if inventory:
        reconciled = reconcile_tasks(tasks, set(re.findall(r"<(?:Picture|Video|Audio) [1-9]\d*>", inventory.group(1))))
        if reconciled != tasks:
            tasks = reconciled
            fields["summary"] = "[" + " + ".join(tasks) + "] " + fields["summary"][task.end() if task else 0:].lstrip()
            text = "\n\n".join(k + ":\n" + fields[k].strip() for k in REFERENCE_FIELDS)
    if 'reference generation' in tasks and '<Picture ' in text and not ids:
        raise ValueError("H3 多参主体缺少独立定义")
    if "video editing" in tasks and not re.match(r"\[[^\]]+\]\s*The target video is an edited version of <Video [1-9]\d*>(?:\.|\s)", fields["summary"]):
        raise ValueError("H3 视频编辑必须指定源视频")
    for m in re.finditer(r"(?m)^<(Subject|Picture|Video|Audio) ([1-9]\d*)>", fields["subject_definitions"]):
        line = next((s for s in fields["retention_analysis"].splitlines() if s.strip().startswith(m.group())), "")
        relations = "fully_copy|partially_copy|reference|weak_reference" if m.group(1) == "Audio" else "fully_preserved|partially_preserved|attribute_transfer|weak_reference"
        if not re.search(r":\s*(?:" + relations + r")\b", line):
            raise ValueError("H3 多参缺少主体或声音的保留规则")
    # One subject, or generation without a source video: every defined subject
    # is visible content, so state it without changing appearance or action.
    unbound = [n for n in ids if f"<Subject {n}>" not in fields["detailed_description"]]
    if unbound and (len(ids) == 1 or not any(t.startswith("video ") for t in tasks)):
        fields["detailed_description"] = fields["detailed_description"].replace("[Shot 1]", "[Shot 1] 画面中有 " + "、".join(f"<Subject {n}>" for n in unbound) + "。")
    if any(f"<Subject {n}>" not in fields["detailed_description"] for n in ids):
        raise ValueError("H3 多参镜头必须引用已定义主体")
    if "[Shot 1]" not in fields["detailed_description"]:
        raise ValueError("H3 多参缺少镜头描述")
    for m in re.finditer(r"\[Shot \d+\] At (\d+):(\d+)\.(\d+)", fields["detailed_description"]):
        if int(m[1])*60 + int(m[2]) + float("0."+m[3]) > float(duration or 30):
            raise ValueError("H3 多参镜头超出所选时长")
    return "\n\n".join(k + ":\n" + fields[k].strip() for k in REFERENCE_FIELDS)


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


def validate_enhancement(output, source, user_requirement="", loop=None):
    """loop=None infers a requested loop from the policy words; the five-section
    path passes its own decision (a first/last-frame video never loops)."""
    if re.search(POLICY["formatOnlyPattern"], user_requirement or "", re.I):
        return output
    source_narrative, result_narrative = narrative(source), narrative(output)
    before, after = compact(source_narrative), compact(result_narrative)
    if before:
        old_pairs = {before[i:i + 2] for i in range(len(before) - 1)}
        new_pairs = {after[i:i + 2] for i in range(len(after) - 1)}
        novel = new_pairs - old_pairs
        if not after.replace(before, "") or (len(before) >= 40 and len(novel) < 6 and len(after) >= len(before) * 0.9):
            raise ValueError(POLICY["noChangeMessage"])
    intent = user_requirement or source_narrative
    if loop is None:
        loop = (re.search(POLICY["loopPattern"], source_narrative + "\n" + (user_requirement or ""), re.I)
                and not re.search(POLICY["cancelLoopPattern"], intent, re.I))
    if loop:
        if not re.search(POLICY["closurePattern"], result_narrative, re.I):
            raise ValueError(POLICY["loopMessage"])
    return output


SECTION_NAMES = ["任务定位", "说话者", "递进式详细提示词", "台词", "连续性与约束"]
SECTION_FIELDS = ["task", "speakers", "description", "dialogue", "constraints"]
FORMAT_INSTRUCTION = "\n".join(POLICY["formatInstructions"])


PHASE_LABELS = ("概述", "起始", "递进", "收束", "约束")
MODE_NAMES = {"T2VA": "文生视频", "I2VA": "图生视频", "FL2VA": "首尾帧视频", "L2VA": "视频参考", "REF2VA": "多参视频"}
# Special-case rules reach the local model only when the user's own words ask
# for them; sent unconditionally they hijack ordinary actions. "leak" finds the
# same rule copied into an answer whose user never asked for it.
CONDITIONAL_RULES = (
    {"name": "idle", "ask": r"待机|(?:仅|只)[^，。；,;\n]{0,4}呼吸|\bidle\b|only\s+breath",
     "rule": "仅呼吸待机：只写胸肩随呼吸微微起伏、回落；头部朝向、手臂和身体位置保持不变，不要写成抬头、转头或抬手。状态不变时，几个阶段可以写同样的内容。",
     "leak": r"胸肩|呼吸待机|仅呼吸", "label": "呼吸待机、胸肩起伏"},
    {"name": "still", "ask": r"完全静止|保持静止|静止不动|一动不动|纹丝不动|\bmotionless\b",
     "rule": "静止：用户要求静止的主体或部分全程不动，只保留用户允许的变化；状态不变时几个阶段可以写同样的内容。", "leak": None, "label": ""},
    {"name": "loop", "ask": r"循环|无缝(?:循环|衔接|回到)|\bloop(?:ing)?\b|seamless\s+loop",
     "rule": "循环：收束时动作平滑回到起始姿态，首尾无缝衔接。",
     "leak": r"(?:动作|姿态|视频|画面|片段|整体|\d+(?:\.\d+)?秒)循环|循环(?:播放|周期|衔接|往复|(?=[，,。；;\s]|$))"
             r"|无缝(?:循环|回到|衔接下一)|下一轮|首尾(?:姿态|动作|状态)?(?:一致|闭合|重合|无缝)", "label": "循环、无缝衔接"},
    {"name": "background", "ask": r"绿幕|蓝幕|绿色(?:的)?(?:幕布|背景|屏幕)|纯色背景|纯(?:白|黑|绿|蓝|灰)色?背景|白底|黑底|green\s*screen|chroma",
     "rule": "纯色背景：背景颜色、亮度和质感全程不变，不添加阴影、渐变、场景或光效。",
     "leak": r"绿幕|蓝幕|绿色(?:的)?(?:幕布|背景|屏幕)|纯绿", "label": "绿幕背景"},
    {"name": "camera", "ask": r"固定机位|机位固定|镜头固定|固定镜头|锁定镜头|镜头不动|静态镜头|static camera|locked camera",
     "rule": "镜头固定：全程不推拉、不摇移。", "leak": None, "label": ""},
)


POSE_WORD = r"(?:姿[态势]|朝向)"
POSE_FREEZE = (rf"(?:不改变|不改|保持)(?:初始|原有|原来的)?{POSE_WORD}|{POSE_WORD}(?:和[^，,。；;]{{0,4}})?(?:保持)?不变"
               rf"|{POSE_WORD}(?:须|必须|需|要|应)?(?:与|和|同)[^，,。；;]{{0,16}}(?:一致|相同)")
# "姿态、服装、背景须一致": the pose leaves the list, the rest of the constraint stays.
POSE_LISTED = rf"{POSE_WORD}[、和与及]|[、和与及]{POSE_WORD}"
# A non-loop ending stays on the requested result instead of undoing it.
RETURN_TO_START = (r"回(?:到|归|落|复)(?:至|到)?(?:初始|起始|原来|最初|原本|开始时?)的?(?:姿[态势]|状态|位置|样子|方位|高度)"
                   r"|恢复(?:至|到|成)?(?:初始|起始|原来|最初|原本)的?(?:姿[态势]|状态|位置|样子)"
                   r"|(?:旋转|转回|转|回|返回)(?:至|到)图中[^，,。；;\n]{0,6}?(?:姿[态势]|位置|角度|状态|朝向|样子)")
USER_RETURN = r"回到|回归|恢复|复原|还原|放回|收回|回原"
# "锅里火焰窜起" does not end with "火焰瞬间熄灭": the ending keeps what the user's thing became.
VANISH = r"熄灭|消失|消散|散去|散尽|褪去"
UNDONE = rf"([\u3400-\u9fff]{{2}})(?:瞬间|渐渐|逐渐|慢慢|随即|缓缓|最终|完全|骤然|迅速)?(?:{VANISH})"
BREATH_STOPS = r"(?:呼吸|起伏)(?:节奏|起伏|动作)?(?:回落|归于|趋于|逐渐|渐渐|慢慢|最终)?(?:至|到)?(?:静止|停止|停下|消失|结束)"
# Constraints that talk about the prompt itself rather than the video.
META_CONSTRAINT = r"原句|原提示词|原文|描述|三阶段|三个阶段|按阶段|各阶段|核心逻辑|补充要求|提示词|要求|用户(?:明确)?提出"
# A constraint that repeats the template's stage names or the action order
# instead of what stays the same ("风声在起始阶段开始", "按“伸懒腰→跳下”顺序展开").
STAGE_CONSTRAINT = (r"(?:起始|递进|收束)(?:阶段|段)|[“\"‘'](?:起始|递进|收束)[”\"’']|节奏递进|递进明确|(?:按|依)[^，,。；;]{0,16}顺序"
                    r"|顺序(?:展开|进行|完成)|→|(?:动作|过程)[^，,。；;]{0,4}(?:必须|需要?|应)?包含|(?:动作|节奏)[^，,。；;]{0,4}从[^，,。；;]{1,10}(?:到|转|过渡)[^，,。；;]{1,10}(?:再|最后|最终)")
# A ban the model added on its own. Kept when it protects consistency or repeats the user's words.
BAN_START = (r"^(?:且|并且?|同时|也|但)?(?:不可|不得|不能|不要|不许|不应|禁止|避免|切勿|严禁|杜绝|不使用|不添加|不加入?|不出现"
             r"|不跟随|不跟拍|不推|不拉|不摇|不环绕|不移动|不跳|无(?!缝))")
BAN_KEEPS = r"改变|更改|改动|更换|切换|替换|变形|走样|(?<!快速)(?<!突然)(?<!剧烈)变化"
# "不切换角度或推拉", "不切换镜头": a camera ban stays only when the user asked for one.
CAMERA_TERMS = r"镜头|机位|角度|视角|景别|运镜|推拉|推近|拉远|摇移|平移|环绕|跟随|跟拍|变焦|切镜"
CAMERA_BAN = rf"^(?:且|并且?|同时|也|但)?(?:不可|不得|不能|不要|不许|不应|禁止|避免|切勿|严禁|不|无)[^，,。；;\n]{{0,4}}?(?:{CAMERA_TERMS})"
USER_CAMERA_BAN = rf"(?:不|无|禁止|避免|别)[^，,。；;\n]{{0,4}}?(?:{CAMERA_TERMS})"
# Light effects an answer made up ("金色刀光", "光晕渐次明灭"); the user's own light, fire or effect keeps them.
LIGHT_EFFECTS = r"刀光|剑光|寒光|金光|微光|灯光|光芒|光晕|光圈|光环|光带|光轨|光弧|光痕|流光|光效|光影|光斑|光束|光柱|闪光|辉光"
USER_LIGHT = r"光|亮|闪|辉|灯|霓虹|火|焰|电|特效"
# Particles and effects slow down; they do not freeze mid-air ("光粒飘落定格").
EFFECT_SUBJECT = r"光|粒|烟|雾|尘|火|焰|花瓣|落叶|雪|雨|水花|特效"
# H3 lip-syncs from 【台词】 itself; a mouth the answer describes may not exist (a robot's visor).
MOUTH = r"(?:微微|轻轻)?(?:张开|微张|张|开合|轻启)?(?<![壶瓶烟喷奶油])(?:嘴巴|嘴唇|嘴角|双唇|唇部|唇瓣|口型|口部|嘴)|[开张]口(?=说|讲|道)"
SPEAKING = r"说|讲|台词|念"
SPEAK_STEPS = ("开始说话", "继续说话", "说完这句话")
# Lighting, weather and grading a text-to-video answer made up on its own.
LOOK_WORDS = (r"色调|调色|灯光|光线|光照|光影|阳光|日光|月光|暖光|冷光|逆光|侧光|顶光|柔光|暖色|冷色|高对比|对比度|饱和"
              r"|明亮|昏暗|晴空|晴朗|晴天|夕阳|黄昏|清晨|夜色|雨[夜水幕滴丝中后]|[下细大小阵暴]雨|雪[花地景中]|[下飘大小白]雪|[薄浓晨大云]雾|雾气")
# A sound the user never asked for ("刀锋带起风声"); speech, a named sound or music keeps them.
SOUND_WORDS = r"声(?![势色称明望誉名])|音效|音乐|配乐|作响|嗡鸣|轰鸣|怒吼|吼叫|大吼|嘶吼|咆哮|呐喊|尖叫"
USER_SOUND = r"声|音|响|乐|唱|说|讲|喊|叫|吼|哭|台词|对白"
CAMERA_WORD = r"镜头|机位|运镜|摄像机|相机"
CAMERA_MOVES = (("fixed", r"固定|静止|不动|锁定"), ("follow", r"跟随|跟拍|跟踪|追随"), ("in", r"推近|推进|拉近|推向|推至"),
                ("out", r"拉远|拉开|后拉|拉出"), ("orbit", r"环绕|绕着|绕行"), ("pan", r"平移|横移|摇"), ("rise", r"升起|上升|下降|俯冲|升高|降低"))


def camera_moves(text):
    """Camera moves a clause gives the camera itself (a subject walking toward the camera is not one)."""
    return {name for name, move in CAMERA_MOVES
            if re.search(rf"(?:{CAMERA_WORD})[^，,。；;\n]{{0,10}}?(?:{move})|(?:{move})的?(?:{CAMERA_WORD})", str(text or ""))}


def either_camera_move(text, context):
    """'镜头全程为“跟随”或“平移”' keeps the move the answer uses first."""
    moves = "|".join(move for _, move in CAMERA_MOVES)
    first = lambda word: context.find(word) if word in context else len(context) + 1
    return re.sub(rf"((?:{CAMERA_WORD})[^，,。；;\n]{{0,8}}?)(?:为|是)?[“\"]?({moves})[”\"]?(?:或者?|或是)[“\"]?({moves})[”\"]?",
                  lambda m: m[1] + min((m[2], m[3]), key=first), str(text or ""))


def invented_ban(clause, asked_text, camera_asked=True):
    body = re.sub(r"^[\s，,。；;、]+", "", clause)
    if re.match(CAMERA_BAN, body):
        return not camera_asked
    start = re.match(BAN_START, body)
    if not start or re.search(BAN_KEEPS, body):
        return False
    tail = compact(body[start.end():])
    tail = tail if len(tail) >= 2 else compact(body)
    return not any(tail[i:i + 2] in asked_text for i in range(len(tail) - 1))


def invented_look(clause, user_text):
    """A clause only about lighting or weather the user never wrote ("暖色调灯光下油花交织").
    A clause that also carries the user's own subject or scene stays."""
    if not any(word not in user_text for word in re.findall(LOOK_WORDS, clause)):
        return False
    body = compact(clause)
    return not any(re.fullmatch(r"[\u3400-\u9fff]{2}", body[i:i + 2]) and body[i:i + 2] in user_text for i in range(len(body) - 1))


def requested_rules(user_text):
    """Names of the special-case rules the user's own source or requirement asks for."""
    text = str(user_text or "")
    names = {rule["name"] for rule in CONDITIONAL_RULES if re.search(rule["ask"], text, re.I)}
    if "loop" in names and re.search(POLICY["cancelLoopPattern"], text, re.I):
        names.discard("loop")
    return names


def phase_edges(duration):
    """One decimal, the same edges the model is told (0-1.7s, 1.7-3.3s, 3.3-5s)."""
    return [round(float(duration) * i / 3, 1) for i in range(4)]


def split_action_phases(output):
    """Find the five labels, accepting 【概述】, **概述**, a bare label line or a short preamble."""
    text = str(output or "").replace("\ufffd", "").replace("\r\n", "\n").strip()
    text = re.sub(r"^```[A-Za-z]*[ \t]*\n?|\n?```$", "", text).strip()
    text = re.sub(r"\*\*|__", "", text)
    text = re.sub(r"<\s*(Picture|Video|Audio)\s*([1-9]\d*)\s*>", lambda m: f"<{m[1].capitalize()} {m[2]}>", text, flags=re.I)
    labels = "|".join(PHASE_LABELS)
    note = r"(?:[ \t]*[（(][^（）()\n]{0,24}[）)])?"
    # Labels run together on one line.
    text = re.sub(rf"(?<=[。；;！!？? \t])[ \t]*(?=(?:{labels}){note}[ \t]*[:：])", "\n", text)
    header = re.compile(
        rf"(?m)^[ \t>#*\-•]*(?:[1-5][.、)）][ \t]*)?"
        rf"(?:【({labels})】|\[({labels})\]|({labels})(?:[ \t]*[1-9]\d*)?(?={note}[ \t]*(?:[:：]|$)))"
        rf"{note}[ \t]*[:：]?[ \t]*")
    found = []
    for match in header.finditer(text):
        if len(found) < len(PHASE_LABELS) and (match[1] or match[2] or match[3]) == PHASE_LABELS[len(found)]:
            found.append(match)
    if len(found) < len(PHASE_LABELS) - 1:
        raise ValueError("模型没有按格式给出概述、起始、递进、收束、约束五个标签")
    parts = [text[m.end():found[i + 1].start() if i + 1 < len(found) else len(text)].strip() for i, m in enumerate(found)]
    if len(parts) < len(PHASE_LABELS):
        # Only the 约束 label is missing: its numbered list (or "保持项1：") follows the last phase.
        split = re.search(r"(?m)^[ \t]*(?:(?:保持项?|限制项?)[ \t]*1[ \t]*[:：]|1[.、)）]|[（(]1[)）]|[-•])[ \t]*\S", parts[-1])
        at = split.start() if split else len(parts[-1])
        parts[-1:] = [parts[-1][:at].strip(), parts[-1][at:].strip()]
    return parts


def clean_phase_text(value):
    """One readable paragraph: no list marks, quote marks or copied time ranges."""
    lines = []
    for line in str(value or "").splitlines():
        line = re.sub(r"^[ \t>#*\-•]+", "", line).strip()
        line = re.sub(r"^[（(]?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—~～至]\s*\d+(?:\.\d+)?\s*(?:s|秒)[）)]?\s*[:：，,]?\s*", "", line, flags=re.I)
        if line:
            lines.append(line if re.search(r"[。！？!?；;…，,、：:][”’」]?$", line) else line + "。")
    return "".join(lines)


def clean_constraints(value):
    """Constraint items, whatever list style the model used."""
    text = re.sub(r"(?<=[。；; ])\s*(?=(?:\d+[.、)）]|[（(]\d+[)）])(?!\d))", "\n", str(value or ""))
    items = []
    for line in text.splitlines():
        line = re.sub(r"^[ \t>#*\-•]*(?:(?:约束[ \t]*\d*|(?:保持项?|限制项?)[ \t]*\d+)[ \t]*[:：])?[ \t]*(?:(?:\d+[.、)）]|[（(]\d+[)）])(?!\d)[ \t]*)?", "", line)
        line = re.sub(r"[；;，,、\s]+$", "", line).strip()
        line = line if re.search(r"[。！？!?…]$", line) else line + "。"
        if re.search(r"[\u3400-\u9fffA-Za-z]", line):
            items.append(line)
    return items


def drop_clauses(text, drop):
    clauses = re.findall(r"[^，,。！？；;!?\n]*[，,。！？；;!?\n]?", str(text or ""))
    kept = "".join(clause for clause in clauses if clause and not drop(clause))
    return re.sub(r"[，,、]+(?=[。！？；;!?\n]|$)", "。", kept).strip(" ，,\n")


def drop_matching_clauses(text, pattern):
    return drop_clauses(text, lambda clause: re.search(pattern, clause, re.I))


def map_clauses(text, change):
    return "".join(change(clause) for clause in re.findall(r"[^，,。！？；;!?\n]*[，,。！？；;!?\n]?", str(text or "")) if clause)


def settle_freeze(clause):
    """"定格" reads as a frozen picture: the shot stops there, particles and effects slow down."""
    if "定格" not in clause:
        return clause
    if re.search(EFFECT_SUBJECT, clause) and not re.search(CAMERA_WORD, clause):
        return re.sub(r"定格(?:(?:于|在)[^，,。！？；;!?\n]*)?", "渐渐放缓", clause)
    return re.sub(r"定格", "停住", re.sub(r"定格(?:于|在)", "停在", clause))


def neutral_speech(phase, step):
    """With dialogue, mouth clauses become plain speaking steps; H3 lip-syncs from 【台词】."""
    clauses = [c for c in re.findall(r"[^，,。！？；;!?\n]*[，,。！？；;!?\n]?", str(phase or "")) if c]
    result, carry = [], ""
    for i, clause in enumerate(clauses):
        if not re.search(MOUTH, clause):
            # "她嘴唇轻动，说出台词": the subject moves to the speaking clause.
            result.append(carry + clause if carry and re.match(rf"(?:开始|继续|接着|轻声|低声)?(?:{SPEAKING})", clause) else clause)
            carry = ""
            continue
        end = re.search(r"[，,。！？；;!?\n]$", clause)
        end = end[0] if end else ""
        lead = re.match(rf"[^，,。！？；;!?\n]*?(?={MOUTH})", clause)
        subject = re.sub(r"的$", "", lead[0]) if lead and len(lead[0]) <= 6 else ""
        stripped = re.sub(rf"(?:{MOUTH})[^，,。！？；;!?\n]{{0,6}}?(?=开始|继续|接着|说|讲|[，,。！？；;!?\n]|$)", "", clause)
        carry = ""
        if re.search(SPEAKING, stripped) and re.search(r"[\u3400-\u9fff]", stripped):
            result.append(stripped)
        elif not re.search(SPEAKING, "".join(clauses[:i] + clauses[i + 1:])):
            result.append(subject + SPEAK_STEPS[min(step, len(SPEAK_STEPS) - 1)] + (end or "，"))
        else:
            carry = subject
    return re.sub(r"[，,、]+(?=[。！？；;!?\n]|$)", "。", "".join(result)).strip(" ，,\n")


def compile_action_phases(output, mode, duration, source, requirements="", user_requirement="", strict_rules=False, keep_pose=False):
    """The model rewrites content; the application owns timing and literal speech.

    With strict_rules an answer that copies a special-case rule the user never
    asked for is rejected, so the caller can ask once more; otherwise only the
    clauses carrying that rule are dropped. keep_pose keeps constraints that
    hold the pose (two nearly identical first/last frames).
    """
    parts = split_action_phases(output)
    mode = str(mode or "").upper()
    inventory = re.search(r"(?im)^Available resource labels:([^\n]*)", requirements)
    refs = sorted(set(re.findall(r"<(?:Picture|Video|Audio) [1-9]\d*>", inventory[1] if inventory else source)))
    if mode == "I2VA":
        refs = ["<Picture 1>"]
        binding = "<Picture 1> 为起始首帧。"
    elif mode == "FL2VA":
        refs = ["<Picture 1>", "<Picture 2>"]
        binding = "<Picture 1> 为起始首帧，<Picture 2> 为结束尾帧。"
    else:
        binding = "参考媒体：" + "、".join(refs) + "。" if refs else "无参考媒体。"
    # The program owns media bindings; a label the model invented is dropped.
    keep_refs = lambda s: re.sub(r"<(?:Picture|Video|Audio) [1-9]\d*>", lambda m: m[0] if m[0] in refs else "", s)
    overview = keep_refs(clean_phase_text(parts[0]))
    phases = [keep_refs(clean_phase_text(p)) for p in parts[1:4]]
    constraints = [keep_refs(item) for item in clean_constraints(parts[4])]
    asked = requested_rules(source + "\n" + (user_requirement or ""))
    everything = "\n".join([overview, *phases, *constraints])
    leaked = [rule for rule in CONDITIONAL_RULES if rule["leak"] and rule["name"] not in asked and re.search(rule["leak"], everything, re.I)]
    if leaked and strict_rules:
        raise ValueError("写入了用户没有要求的" + "、".join(rule["label"] for rule in leaked))
    for rule in leaked:
        overview = drop_matching_clauses(overview, rule["leak"])
        phases = [drop_matching_clauses(p, rule["leak"]) for p in phases]
        constraints = [item for item in constraints if not re.search(rule["leak"], item, re.I)]
    has_text = lambda s: re.search(r"[\u3400-\u9fffA-Za-z]", s)
    user_text = source + "\n" + (user_requirement or "")
    stop = lambda s: s if "定格" in user_text else map_clauses(s, settle_freeze)
    overview, phases, constraints = stop(overview), [stop(p) for p in phases], [stop(item) for item in constraints]
    if "loop" not in asked and mode != "FL2VA" and not re.search(USER_RETURN, user_text):
        phases = [drop_matching_clauses(p, RETURN_TO_START) for p in phases]
        constraints = [drop_matching_clauses(item, RETURN_TO_START) for item in constraints]
        if not re.search(VANISH, user_text):
            ending = drop_clauses(phases[-1], lambda clause: any(m[1] in user_text for m in re.finditer(UNDONE, clause)))
            phases[-1] = ending if has_text(ending) else phases[-1]
    if "idle" in asked:
        # Breathing idle keeps breathing to the last frame.
        phases = [drop_matching_clauses(p, BREATH_STOPS) for p in phases]
        constraints = [drop_matching_clauses(item, BREATH_STOPS) for item in constraints]
    if not asked & {"idle", "still"} and not keep_pose:
        # A constraint freezing the pose contradicts the motion the phases describe.
        constraints = [drop_matching_clauses(re.sub(POSE_LISTED, "", item), POSE_FREEZE) for item in constraints]
    # One camera move for the whole clip: the user's, else the first one the answer gives.
    context = "\n".join([overview, *phases])
    either = lambda s: either_camera_move(s, context)
    overview, phases, constraints = either(overview), [either(p) for p in phases], [either(item) for item in constraints]
    user_anchor = camera_moves(user_text)
    anchor = user_anchor or next(
        (moves for moves in map(camera_moves, re.split(r"[，,。；;\n]", "\n".join([overview, *phases]))) if moves), set())
    if anchor:
        other_move = lambda clause: camera_moves(clause) and not camera_moves(clause) & anchor
        overview = drop_clauses(overview, other_move) if user_anchor else overview
        phases = [drop_clauses(p, other_move) for p in phases]
        constraints = [drop_clauses(item, other_move) for item in constraints]
    if mode not in ("I2VA", "FL2VA"):
        # Without a picture, lighting and weather come only from the user's words.
        look = lambda clause: invented_look(clause, compact(user_text))
        overview, phases, constraints = drop_clauses(overview, look), [drop_clauses(p, look) for p in phases], [drop_clauses(item, look) for item in constraints]
    if not re.search(USER_SOUND, user_text):
        overview, phases = drop_matching_clauses(overview, SOUND_WORDS), [drop_matching_clauses(p, SOUND_WORDS) for p in phases]
        constraints = [drop_matching_clauses(item, SOUND_WORDS) for item in constraints]
    if not re.search(USER_LIGHT, user_text) and (mode != "FL2VA" or keep_pose):
        # Like sound, light effects come from the user's words; two differing
        # first/last frames may really change their light.
        lit = (drop_matching_clauses(overview, LIGHT_EFFECTS), [drop_matching_clauses(p, LIGHT_EFFECTS) for p in phases],
               [drop_matching_clauses(item, LIGHT_EFFECTS) for item in constraints])
        if has_text(lit[0]) and any(has_text(p) for p in lit[1]):
            overview, phases, constraints = lit
    if re.search(r'[（(]S[1-9]\d*[）)]\s*[:：]\s*[“"]', source):
        phases = [neutral_speech(p, i) for i, p in enumerate(phases)]
    if mode == "FL2VA":
        phases = [re.sub(r"画面(?:回归|复归|复刻|还原|恢复|回到)(?:为|成|到|至)?与?\s*(<Picture 2>)(?:完全)?(?:一致|相同)?的?(?:静止)?(?:状态|形态|画面|样子)?", r"画面与 \1 一致", p) for p in phases]
    asked_text = compact(user_text + "\n" + "\n".join(rule["rule"] for rule in CONDITIONAL_RULES if rule["name"] in asked))
    camera_asked = "camera" in asked or bool(re.search(USER_CAMERA_BAN, user_text))
    constraints = [drop_clauses(item, lambda clause: re.search(META_CONSTRAINT, clause) or re.search(STAGE_CONSTRAINT, clause)
                                or invented_ban(clause, asked_text, camera_asked)) for item in constraints]
    constraints = [item for item in constraints if has_text(item)]
    if not has_text(overview) or not any(has_text(p) for p in phases):
        raise ValueError("优化内容不能为空")
    if not constraints:
        constraints = ["保持主体身份、外观与场景前后一致。"]
    # Sustained idle/stillness can span several phases; a loop may end at its
    # initial pose. Novelty belongs to the whole rewrite, not pairwise stages.
    validate_enhancement(overview + "\n" + "\n".join(phases), source, user_requirement, loop="loop" in asked and mode != "FL2VA")
    speech = re.findall(r'[（(]S([1-9]\d*)[）)]\s*[:：]\s*[“"]([^”"]+)[”"]', source)
    speakers = sorted({int(n) for n, _ in speech} | {int(n) for n in re.findall(r"<Subject ([1-9]\d*)>", source)})
    speaker_lines = {}
    for line in source.splitlines():
        definition = re.match(r"\s*<Subject ([1-9]\d*)>\s*=\s*\(S\1\)[^\n]*", line)
        if definition:
            speaker_lines[int(definition[1])] = line.strip()
    who = "<Picture 1> 中" if mode in ("I2VA", "FL2VA") else "画面中"
    speaker_text = "\n".join(speaker_lines.get(n, f"<Subject {n}> = (S{n})，{who}说这句台词的角色。") for n in speakers) or "无说话者"
    dialogue = "\n".join(f'(S{n})：“{words}”' for n, words in speech) or "无台词"
    edges = phase_edges(duration)
    spans = []
    for i, phase in enumerate(phases):
        # An emptied or repeated phase extends the one before it.
        if spans and (not has_text(phase) or compact(spans[-1][2]) == compact(phase)):
            spans[-1][1] = edges[i + 1]
        elif has_text(phase):
            spans.append([spans[-1][1] if spans else 0, edges[i + 1], phase])
    if mode == "FL2VA" and "<Picture 2>" not in spans[-1][2]:
        spans[-1][2] += "结束时画面与 <Picture 2> 一致。"
    timeline = "\n\n".join(f"{start:g}-{end:g}s：{phase}" for start, end, phase in spans)
    value = {"task": f"{MODE_NAMES.get(mode, mode)}，时长{float(duration):g}秒。{binding}", "speakers": speaker_text,
             "description": overview + "\n\n" + timeline, "dialogue": dialogue,
             "constraints": "\n".join(f"{n}. {item}" for n, item in enumerate(constraints, 1))}
    return validate_format(json.dumps(value, ensure_ascii=False), mode, duration, source, requirements)


def validate_format(value, mode, duration_seconds, source="", requirements=""):
    text = re.sub(r"^```(?:json|text|plaintext)?\s*\n([\s\S]*?)\n```$", r"\1", str(value or "").strip(), flags=re.I).strip()
    text = re.sub(r"\\(?=<(?:Picture|Video|Audio|Subject) )", "", text)
    text = re.sub(r"\*\*([^*\n]+)\*\*", r"\1", text)
    text = re.sub(r"[（(\[【]?(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—~～至]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\s*[）)\]】]?\s*[:：]", r"\1-\2s：", text, flags=re.I)
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
    task_duration = re.search(r"(?:时长\s*[:：]?\s*|duration\s*[:：]?\s*|lasts?\s+)?(\d+(?:\.\d+)?)\s*(?:秒|s\b|seconds?\b)", sections[0], re.I)
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
