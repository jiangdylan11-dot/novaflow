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


def validate_enhancement(output, source, user_requirement=""):
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
    if (re.search(POLICY["loopPattern"], source_narrative + "\n" + (user_requirement or ""), re.I)
            and not re.search(POLICY["cancelLoopPattern"], intent, re.I)):
        if not re.search(POLICY["closurePattern"], result_narrative, re.I):
            raise ValueError(POLICY["loopMessage"])
    return output


SECTION_NAMES = ["任务定位", "说话者", "递进式详细提示词", "台词", "连续性与约束"]
SECTION_FIELDS = ["task", "speakers", "description", "dialogue", "constraints"]
FORMAT_INSTRUCTION = "\n".join(POLICY["formatInstructions"])


def compile_action_phases(output, mode, duration, source, requirements="", user_requirement=""):
    """The model rewrites content; the application owns timing and literal speech."""
    raw = re.sub(r"\*\*([^*\n]+)\*\*", r"\1", str(output).strip())
    matches = list(re.finditer(r"(?m)^\s*(?:[1-5][.、)]\s*)?(概述|起始|递进|收束|约束)\s*[:：]\s*", raw))
    if [m[1] for m in matches] != ["概述", "起始", "递进", "收束", "约束"] or raw[:matches[0].start()].strip():
        raise ValueError("模型未返回完整的概述、三阶段动作与融合后的约束")
    parts = [raw[m.end():matches[i+1].start() if i+1<len(matches) else len(raw)].strip() for i,m in enumerate(matches)]
    if any(not re.search(r"[\u3400-\u9fffA-Za-z]", p) for p in parts):
        raise ValueError("优化内容不能为空")
    overview, phases, constraints = parts[0], parts[1:4], parts[4]
    # Sustained idle/stillness can span several phases; a loop may end at its
    # initial pose. Novelty belongs to the whole rewrite, not pairwise stages.
    validate_enhancement(overview + "\n" + "\n".join(phases), source, user_requirement)
    inventory = re.search(r"(?im)^Available resource labels:([^\n]*)", requirements)
    refs = sorted(set(re.findall(r"<(?:Picture|Video|Audio) [1-9]\d*>", inventory[1] if inventory else source)))
    if mode.upper() == "I2VA":
        refs = ["<Picture 1>"]
        binding = "<Picture 1> 为起始首帧。"
    elif mode.upper() == "FL2VA":
        refs = ["<Picture 1>", "<Picture 2>"]
        binding = "<Picture 1> 为起始首帧，<Picture 2> 为结束尾帧。"
    else:
        binding = "参考媒体：" + "、".join(refs) + "。" if refs else "无参考媒体。"
    speech = re.findall(r'[（(]S([1-9]\d*)[）)]\s*[:：]\s*[“"]([^”"]+)[”"]', source)
    speakers = sorted({int(n) for n, _ in speech} | {int(n) for n in re.findall(r"<Subject ([1-9]\d*)>", source)})
    speaker_lines = {}
    for line in source.splitlines():
        definition = re.match(r"\s*<Subject ([1-9]\d*)>\s*=\s*\(S\1\)[^\n]*", line)
        if definition:
            speaker_lines[int(definition[1])] = line.strip()
    speaker_text = "\n".join(speaker_lines.get(n, f"<Subject {n}> = (S{n})，原提示词对应的说话者。") for n in speakers) or "无说话者"
    dialogue = "\n".join(f'(S{n})：“{words}”' for n, words in speech) or "无台词"
    edges = [round(float(duration)*i/3, 3) for i in range(4)]
    spans = []
    for i, phase in enumerate(phases):
        if spans and compact(spans[-1][2]) == compact(phase):
            spans[-1][1] = edges[i+1]
        else:
            spans.append([edges[i], edges[i+1], phase])
    timeline = "\n\n".join(f"{start:g}-{end:g}s：{phase}" for start,end,phase in spans)
    value = {"task": f"{mode}，时长{float(duration):g}秒。{binding}", "speakers":speaker_text,
             "description": overview + "\n\n" + timeline, "dialogue":dialogue, "constraints":constraints}
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
