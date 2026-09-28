"""Conservative optimization checks; these do not certify visual generation quality."""
import json
import re
import unicodedata
from pathlib import Path

POLICY = json.loads(Path(__file__).with_name("h3_prompt_enhance_policy.json").read_text(encoding="utf-8"))
INSTRUCTION = "\n".join(POLICY["instructions"])
REFERENCE_INSTRUCTION = "\n".join(POLICY["referenceInstructions"])
REFERENCE_FIELDS = ("subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music")
BASE_FIELDS = ("integrated_multimodal_description", "overall_soundscape", "non_diegetic_music")
# The renderer's compile step asks for a faithful English copy of a finished prompt.
TRANSLATE_ONLY = "H3 compile: translate-only"
CAMERA_PATTERN = r"镜头|相机|摄像|机位|运镜|\bcamera\b|\bzoom\b|\bdolly\b|\bpanning\b"
DEFAULT_CAMERA_ZH = "镜头固定，构图保持稳定。"
DEFAULT_CAMERA_EN = "The camera holds a static shot and the framing stays stable."
DEFAULT_SOUNDSCAPE_ZH = "与画面动作一致的自然环境声和动作声。"
HAN = r"[㐀-鿿]"
SHOT_MARK = r"\[Shot ([1-9]\d*)\](?:[ \t]*At[ \t]+(\d{2}):(\d{2})\.(\d{3}),?)?"
# A cut, scene change or several shots in the user's own words. Only then do
# later [Shot N] exist; otherwise the video is one continuous shot.
SHOT_SIZE = r"近景|中景|远景|全景|特写"
CUT_PATTERN = (r"切镜|切换镜头|镜头切(?:换|到|至|回)|切(?:到|至|换到|回)[^，。,；;\n]{0,6}?(?:" + SHOT_SIZE + r"|镜头|画面|场景|视角)"
               # 第3秒切近景, 最后切一个特写, 切回全景: 切 + a shot size, not 切开西瓜/切菜.
               r"|切(?![开菜断割片成碎块肉丝丁水西土苹香面蛋葱姜蒜])(?:到|至|换|回)?(?:一个|个)?[^，。,；;\n]{0,6}?(?:" + SHOT_SIZE + r")"
               r"|(?:第\s*\d+(?:\.\d+)?\s*秒|秒后|然后|接着|随后|之后|再)\s*切(?:到|至|换|回)|转场|分镜|第[二三四五六2-6]个?镜头"
               r"|[两二三四五2-5]个镜头|多个镜头|多镜头|场景切换|切换场景|换(?:个|一个)?场景|\[Shot (?:[2-9]|[1-9]\d)\]|【镜头\s*[2-9]】"
               r"|\bcuts? (?:to|back)\b|\b(?:camera|shot) cuts\b|\bmulti-?\s?shots?\b|\bscene change\b|\b(?:two|three|four|several|multiple|[2-9])\s+shots\b")
# A refused cut: the whole clause goes ("不要两个镜头", "请勿切镜", "don't cut to a close-up").
CUT_WORDS = r"切镜|切换|转场|分镜|换场景|场景切换|切|(?:第[二三四五六2-9]个|多个|[两二三四五2-9]个)镜头|多镜头|镜头"
NO_CUT = (r"(?:不要|不用|不需要|无需|不必|请勿|勿|不能|不得|不可以|不可|不许|不准|别|禁止|避免|没有)[^，。,；;\n]{0,6}?(?:" + CUT_WORDS + r")[^，。,；;\n]*"
          r"|不(?:再|做|去)?(?:切|转场|分镜|换场景)[^，。,；;\n]*"
          r"|(?:(?:第[二三四五六2-9]个|多个|[两二三四五2-9]个)镜头|切镜|切换|转场|分镜)也?(?:不要|不用|不需要|取消|去掉)[^，。,；;\n]*"
          r"|\b(?:no|not|don[’']t|do not|never|without)\b[^.,;\n]{0,16}?\b(?:cuts?|cutting|scene changes?|shots?|transitions?)\b[^.,;\n]*")
ONE_SHOT = r"一镜到底|(?:改成|改为|只要|只用|只有|保持|就)一个镜头|一个镜头(?:拍完|到底|完成)|单镜头|\b(?:one|single) (?:continuous )?(?:shot|take)\b"


def requested_cut(text):
    """The user's own words ask for a cut, a scene change or several shots."""
    return bool(re.search(CUT_PATTERN, re.sub(NO_CUT, "", str(text or ""), flags=re.I), re.I))


def asks_cut(source, requirement=""):
    """A cut the user asked for. The requirement's own word on cuts wins over shots already in the source."""
    requirement = str(requirement or "")
    if requested_cut(requirement) or re.search(NO_CUT + "|" + ONE_SHOT, requirement, re.I):
        return requested_cut(requirement)
    return requested_cut(str(source or "") + "\n" + requirement)


def cut_seconds(text):
    """The seconds the user gives each cut, in order: 第4秒切到近景, 3秒后切到远景, at 2s cut to …"""
    return [float(m[1] or m[2] or m[3]) for m in re.finditer(
        r"第\s*(\d+(?:\.\d+)?)\s*秒[^，。,；;\n]{0,6}?切|(\d+(?:\.\d+)?)\s*秒(?:后|之后|时|处)[^，。,；;\n]{0,6}?切"
        r"|\bat\s+(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?\b[^.,;\n]{0,16}?\bcut", re.sub(NO_CUT, "", str(text or ""), flags=re.I), re.I)]


# The opening "镜头切到近景，" / "近景，" of a later shot kept inside the one continuous shot.
CUT_OPENING = (r"^[\s，,。；;]*(?:(?:镜头|画面)?(?:在[^，。,；;\n]{0,8})?切(?:换)?(?:到|至|回|成)?[^，。,；;\n]{0,12}[，,。；;]?"
               r"|大?(?:" + SHOT_SIZE + r")(?:镜头)?[，,：:。]|(?:the )?camera cuts (?:back )?to [^,.;\n]*[,.;]?)\s*")


def fold_cut(text):
    return re.sub(CUT_OPENING, "", str(text or ""), count=1, flags=re.I).strip()


# Words that do not name a later shot's own content: framing, the same subjects, function characters.
LATER_SHOT_STOP = r"近景|中景|远景|全景|特写|景别|镜头|画面|场景|视角|两人|二人|双方|他们|她们|它们|两者|主体|角色"
LATER_SHOT_CHARS = "的了在是和与及里上中下着地得把被向从到切换后然再先接随之秒第个一两三四五六七八九十声音乐也又并且还就便"


def han_pairs(text):
    return {text[i:i + 2] for i in range(len(text) - 1) if re.fullmatch(HAN + "{2}", text[i:i + 2])}


def later_shots(text):
    """What the user's words show only after each cut, and its words ("…然后切到街角咖啡店里的女孩" ->
    ["街角咖啡店里的女孩"], {街角, 咖啡, 女孩, …}): the first shot does not show it yet. A cut that
    only reframes ("第3秒切到近景") shows nothing new."""
    text = re.sub(NO_CUT, "", str(text or ""), flags=re.I)
    cuts = [m for m in re.finditer(CUT_PATTERN, text, re.I) if re.search(r"切|\bcut", m[0], re.I)]
    before = han_pairs(text[:cuts[0].start()]) if cuts else set()
    own = lambda part: {pair for pair in han_pairs(part) - before if not re.fullmatch(LATER_SHOT_STOP, pair) and not set(pair) & set(LATER_SHOT_CHARS)}
    parts = [part for part in (re.split(r"[。！？；;\n]", text[m.end():])[0].strip(" ，,") for m in cuts) if own(part)]
    return parts, set().union(set(), *map(own, parts))


def shot_stamp(seconds):
    ms = int(round(float(seconds) * 1000))
    return f"{ms // 60000:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}"


def shot_times(asked, duration, hints=()):
    """Cut times of shots 2..n: the writer's seconds (else the user's hint) when they rise inside
    the clip; a missing or invalid one is spaced evenly between its neighbours."""
    end = int(round(float(duration) * 1000))
    known, last = [], 0
    for i, seconds in enumerate(asked):
        seconds = seconds if seconds is not None else hints[i] if i < len(hints) else None
        ms = None if seconds is None else int(round(float(seconds) * 1000))
        known.append(ms if ms is not None and last < ms < end else None)
        last = known[-1] if known[-1] is not None else last
    times = list(known)
    for i, ms in enumerate(times):
        if ms is None:
            j = next((k for k in range(i, len(times)) if known[k] is not None), len(times))
            low, high = times[i - 1] if i else 0, known[j] if j < len(times) else end
            times[i] = low + round((high - low) / (j - i + 1))
    if not all(a < b for a, b in zip([0] + times, times + [end])):
        times = [round(end * k / (len(asked) + 1)) for k in range(1, len(asked) + 1)]
    return [ms / 1000 for ms in times]


def check_shots(narrative, duration, fill=False):
    """[Shot 1] has no time; later shots are numbered 2, 3, … and cut at strictly
    increasing times inside the clip. fill spaces later shots evenly when none has a time."""
    marks = list(re.finditer(SHOT_MARK, narrative))
    if not marks:
        raise ValueError("H3 镜头描述缺少 [Shot 1]")
    if [int(m[1]) for m in marks] != list(range(1, len(marks) + 1)):
        raise ValueError("H3 镜头编号必须从 [Shot 1] 起按顺序递增")
    if marks[0][2]:
        raise ValueError("H3 [Shot 1] 不能带切换时间")
    duration = float(duration or 30)
    if fill and len(marks) > 1 and not any(m[2] for m in marks[1:]):
        times = iter(shot_times([None] * (len(marks) - 1), duration))
        return check_shots(re.sub(r"\[Shot ([2-9]|[1-9]\d+)\]", lambda m: f"[Shot {m[1]}] At {shot_stamp(next(times))}", narrative), duration)
    previous = 0.0
    for m in marks[1:]:
        if not m[2]:
            raise ValueError(f"H3 [Shot {m[1]}] 缺少 At MM:SS.mmm 切换时间")
        seconds = int(m[2]) * 60 + int(m[3]) + int(m[4]) / 1000
        if not previous < seconds < duration:
            raise ValueError("H3 镜头切换时间必须严格递增并在所选时长内")
        previous = seconds
    return narrative


# The official camera wording (official base §4.3): motion type, then amplitude and speed only
# where the Chinese has them. A clause that is only a camera move is written by the program.
CAMERA_SUBJECT = r"镜头|摄像机|机位|相机"
CAMERA_SPEED = (("at slow speed", r"缓慢|缓缓|慢慢|徐徐|慢速|轻缓"), ("at fast speed", r"快速|迅速|急速|飞快|快"))
CAMERA_AMPLITUDE = (("with small amplitude", r"小幅度?|轻微|微微|稍稍|略微|轻轻"), ("with large amplitude", r"大幅度?"))
CAMERA_GLOSSARY = (
    ("holds a static shot", r"固定(?:不动)?|静止(?:不动)?|不动|定住"), ("pushes in", r"推近|推进|拉近|前推"),
    ("pulls out", r"拉远|后拉|拉开|后撤"), ("pans left", r"向?左摇|摇向左(?:侧|边)?"), ("pans right", r"向?右摇|摇向右(?:侧|边)?"),
    ("trucks left", r"向?左(?:平|横)?移"), ("trucks right", r"向?右(?:平|横)?移"), ("tilts up", r"向?上摇|仰摇|上仰"),
    ("tilts down", r"向?下摇|俯摇|下俯"), ("pedestals up", r"向?上移|上升|升起|升高"), ("pedestals down", r"向?下移|下降|降低"),
    ("follows in a tracking shot", r"跟拍|跟随(?:拍摄)?|跟踪|追随"), ("moves in an arc shot", r"环绕(?:拍摄)?|绕拍"),
    ("shakes strongly", r"(?:手持)?(?:剧烈|大幅度?|强烈)(?:地)?(?:晃动|抖动)"), ("shakes slightly", r"(?:手持)?(?:轻微|微微|小幅度?)?(?:地)?(?:晃动|抖动)|手持"),
)
CAMERA_MODIFIERS = "|".join(word for _, word in CAMERA_SPEED + CAMERA_AMPLITUDE)


def camera_english(clause):
    """"镜头以小幅度缓慢推近" -> "the camera pushes in with small amplitude at slow speed"; '' unless the
    clause is nothing but a camera move ("镜头从天际线缓缓下移" names a place and is translated)."""
    clause = re.sub(r"^\s*(?:随后|然后|接着|同时|最后|最终|并且?|且)?\s*", "", str(clause or "")).strip()
    if re.fullmatch(r"(?:固定|静止)的?镜头(?:拍摄)?", clause):
        return "the camera holds a static shot"
    moves = "|".join(f"(?P<m{i}>{word})" for i, (_, word) in enumerate(CAMERA_GLOSSARY))
    match = re.fullmatch(rf"(?:{CAMERA_SUBJECT})(?:全程|始终|一直|持续|开始|随即)?(?:保持|维持|以|用)?(?P<mods>(?:(?:{CAMERA_MODIFIERS})[地的、]?)*)"
                         rf"(?:{moves})(?:拍摄|运动|移动|运镜)?", clause)
    if not match:
        return ""
    move = CAMERA_GLOSSARY[next(i for i in range(len(CAMERA_GLOSSARY)) if match[f"m{i}"])][0]
    mods = match["mods"]
    if move.startswith(("holds", "shakes")):
        return "the camera " + ("shakes strongly" if move.startswith("shakes") and re.search(r"大幅", mods) else move)
    extra = [english for english, word in CAMERA_AMPLITUDE + CAMERA_SPEED if re.search(word, mods)]
    return " ".join(["the camera", move, *extra])


# A translation that turns a speed or direction around ("缓慢加快" -> "slows down"): the Chinese words,
# the Chinese words that would allow it, the English that turns it around, and the retry hint.
FASTER, SLOWER = r"加快|加速|变快|越来越快|更快|提速", r"减慢|放慢|变慢|减速|越来越慢|更慢|慢下来|放缓"
CLOSER, FARTHER = r"推近|推进|拉近|前推", r"拉远|后拉|拉开|后撤"
RISE, FALL = r"上移|上升|升起|升高|上摇|仰摇|向上", r"下移|下降|降低|下摇|俯摇|向下"
LEFT_EN = r"\b(?:to|toward|towards|on|from) (?:the |her |his |its |their )?left\b|\bleft(?:ward|wards)?\b(?=[ -](?:side|hand|arm|leg|foot|shoulder|edge|corner|paw))|\b(?:pans?|trucks?|turns?|moves?|slides?|tilts?|rolls?|shifts?|looks?|swings?|sweeps?|glances?|leans?|steps?) (?:to the )?left\b"
FLIPS = (
    (FASTER, SLOWER, r"\bslow(?:s|ing|ed)? down\b|\bdecelerat|\bslower\b", "加快 means speeds up", False),
    (SLOWER, FASTER, r"\bspeed(?:s|ing)? up\b|\baccelerat|\bfaster\b", "减慢 or 放缓 means slows down", False),
    (CLOSER, FARTHER, r"\bpull(?:s|ing|ed)? (?:out|back)\b|\bzoom(?:s|ing|ed)? out\b|\b(?:moves?|draws?) back\b", "推近 or 拉近 means the camera pushes in", True),
    (FARTHER, CLOSER, r"\bpush(?:es|ing|ed)? in\b|\bzoom(?:s|ing|ed)? in\b|\bmoves? closer\b", "拉远 or 后撤 means the camera pulls out", True),
    (RISE, FALL, r"\b(?:down|downward|downwards|descends?|lowers?)\b", "上移 or 上升 means the camera moves up (pedestals up, or tilts up)", True),
    (FALL, RISE, r"\b(?:up|upward|upwards|rises?|ascends?)\b", "下移 or 下降 means the camera moves down (pedestals down, or tilts down)", True),
    (r"左", r"右", LEFT_EN.replace("left", "right"), "左 means left", False),
    (r"右", r"左", LEFT_EN, "右 means right", False),
)


def translation_flips(chinese, english):
    """Hints for the speed and direction words a translation turned around; camera words are read in
    the camera's own sentences."""
    camera_en = " ".join(s for s in re.split(r"(?<=[.;!?])\s+", english) if re.search(r"\bcamera\b", s, re.I))
    camera_zh = "".join(c for c in re.split(r"[，,。；;！？]", chinese) if re.search(CAMERA_SUBJECT, c))
    return [hint for zh, allowed, flipped, hint, camera in FLIPS
            if re.search(zh, camera_zh if camera else chinese) and not re.search(allowed, camera_zh if camera else chinese)
            and re.search(flipped, camera_en if camera else english, re.I)]


def camera_wording(chinese, english):
    """The official camera wording: a vertical move is a tilt or pedestal, never a pan; amplitude and
    speed only where the Chinese has them."""
    english = re.sub(r"\bpan(s|ning|ned)? (up|down)(?:wards?)?\b", r"tilt\1 \2", english)
    # "The camera slowly pushes down from the skyline": the whole camera moves down.
    english = re.sub(r"(\bcamera\b[^.;!?]*?\b)push(es|ing|ed)? (up|down)(?:wards?)?\b",
                     lambda m: m[1] + "pedestal" + {"es": "s", "ing": "ing", "ed": "ed"}.get(m[2] or "", "") + " " + m[3], english, flags=re.I)
    for words, phrase in ((r"缓|慢|徐", "at (?:a )?slow speed"), (r"快|迅|急|猛|疾", "at (?:a )?fast speed"),
                          (r"小幅|轻|微|稍|略", "with (?:a )?small amplitude"), (r"大幅|剧烈|大范围", "with (?:a )?large amplitude")):
        if not re.search(words, chinese):
            english = re.sub(r",?\s*\b" + phrase + r"\b", "", english)
    return english


def base_mode(mode):
    value = str(mode or "").strip().lower().replace("-", "_")
    return {"t2v": "T2VA", "t2va": "T2VA", "text_video": "T2VA", "i2v": "I2VA", "i2va": "I2VA", "image_video": "I2VA",
            "fl2v": "FL2VA", "fl2va": "FL2VA", "first_last": "FL2VA", "l2va": "L2VA", "video_reference": "L2VA"}.get(value, "")


def literal_free(text):
    """Prose outside spoken lines, quoted on-screen text, tags and shot marks."""
    return re.sub(r"<d>[\s\S]*?</d>|\"[^\"\n]*\"|“[^”\n]*”|<(?:Subject|Picture|Video|Audio) [1-9]\d*>|" + SHOT_MARK, "", str(text or ""))


def dialogue_tag(words):
    return "[Chinese]" if re.search(HAN, words) else "[English]"


# A spoken line in the writer's view: (S1)："…", (S1, S2)：[Japanese]"…".
SPEECH_LINE = r'[（(](S[1-9]\d*(?:\s*,\s*S[1-9]\d*)*)[）)]\s*[:：]\s*(\[[A-Za-z ]+\])?\s*[“"]([^”"]+)[”"]'
# Speech the user wrote without a speaker ID: 并说：“出发吧。”, 喊道“冲啊！”.
UNLABELLED_SPEECH = r'(说道?|喊道?|大喊|叫道|问道?|答道|回答|回应|低语|念道)\s*[:：,，]?\s*[“"「]([^”"」\n]+)[”"」]'


def label_speech(text, taken=()):
    """Unlabelled speech becomes its own (Sn)："…" line with the next free speaker ID; the
    speaking verb stays in the action. A line opening with 又/然后… keeps the last speaker."""
    text, lines = str(text or ""), []
    number = max([int(n) for n in re.findall(r"\bS([1-9]\d*)\b", text + " " + " ".join(taken))] + [0])
    speaker = ""

    def take(match):
        nonlocal number, speaker
        lead = re.split(r"[，,。！？；;\n”」]", text[:match.start()])[-1].strip()
        if not speaker or not re.fullmatch(r"(?:然后|接着|随后|随即|又|再|并|还|也|便|就|同时)*", lead):
            number += 1
            speaker = f"S{number}"
        lines.append(f'({speaker})："{match[2].strip()}"')
        # "说：“你好。”然后又说" keeps its clauses apart: "说，然后又说".
        return match[1] + ("，" if re.match(r"[^\s，,。！？；;!?、)）]", text[match.end():match.end() + 1]) else "")
    return re.sub(UNLABELLED_SPEECH, take, text), lines


BASE_ANCHORS = {"open": {"en": "The shot begins in the position and framing established by <Picture 1>.", "zh": "画面从 <Picture 1> 的位置与构图开始。"},
                "close": {"en": "At the end of the shot, the action settles into the pose, spacing, and composition established by <Picture 2>.",
                          "zh": "结尾时，动作落定在 <Picture 2> 的姿态、位置与构图。"}}


def append_sentence(text, sentence):
    """Ends the text's last sentence and appends the next; Chinese sentences follow without a space."""
    head = re.sub(r"[，,；;：:、]+$", "", str(text or "").strip())
    if not head:
        return sentence
    letters = re.findall(r"[㐀-鿿A-Za-z]", re.sub(r"<[^<>]*>", "", head))
    ended = head if re.search(r"(?:[。！？.!?…”\"」』）)]|</d>)$", head) else head + ("。" if letters and re.match(HAN, letters[-1]) else ".")
    return ended + ("" if re.search(r"[。！？]$", ended) or (re.search(r"[”」』）>]$", ended) and re.match(HAN, sentence)) else " ") + sentence


def one_paragraph(text):
    """A shot on one line: Chinese lines join without a space, others with one."""
    return re.sub(r"\s*\n\s*", " ", re.sub(r"(?<=[㐀-鿿。，；：！？、”）])\s*\n\s*(?=[㐀-鿿“（])", "", text)).strip()


def parse_base_fields(value):
    """The three official fields from text or JSON; a leading alignment line is dropped."""
    text = re.sub(r"^```(?:json|text)?\s*\n([\s\S]*?)\n```$", r"\1", str(value or "").strip()).strip()
    if text.startswith("{"):
        try:
            data = json.loads(text)
        except ValueError:
            return None
        if not isinstance(data, dict) or not isinstance(data.get(BASE_FIELDS[0]), str):
            return None
        return {key: str(data.get(key) or "").strip() for key in BASE_FIELDS}
    headers = list(re.finditer(r"(?m)^[ \t]*(" + "|".join(BASE_FIELDS) + r")[ \t]*[:：][ \t]*", text))
    names = [m[1] for m in headers]
    if not names or names != [name for name in BASE_FIELDS if name in names] or len(set(names)) != len(names):
        return None
    return {m[1]: text[m.end():headers[i + 1].start() if i + 1 < len(headers) else len(text)].strip() for i, m in enumerate(headers)}


def validate_base_fields(value, mode="", duration=None, language=None, requirements=""):
    """Canonical base-mode fields text (T2V/I2V/FL2V), shots one per line.

    language 'en': no Chinese outside <d>…</d> and quoted text; 'zh': the prose is Chinese.
    """
    fields = parse_base_fields(value)
    if not fields or BASE_FIELDS[0] not in fields:
        raise ValueError("H3 提示词需要画面与动作、环境声音、背景音乐三个字段")
    narrative, sound, music = (fields.get(key, "").strip() for key in BASE_FIELDS)
    none = lambda text: "N/A" if re.fullmatch(r"(?:无|N/?A)(?:[（(][^）)]*[）)])?[。.]?", text, re.I) else text
    sound, music = none(sound), none(music or "N/A")
    if not narrative or not sound:
        raise ValueError("H3 画面与动作、环境声音不能为空")
    narrative = re.sub(r"【镜头\s*([1-9]\d*)】", r"[Shot \1]", narrative)
    first = re.search(r"\[Shot 1\]", narrative)
    if not first:
        narrative = "[Shot 1] " + narrative
    elif first.start() > 0:
        # A style sentence written before [Shot 1] belongs to the first shot.
        narrative = "[Shot 1] " + narrative[:first.start()].strip() + " " + narrative[first.end():].lstrip()
    # One paragraph per shot; Chinese lines join without a space.
    narrative = "\n".join(one_paragraph(shot) for shot in re.split(r"\s*(?=\[Shot (?:[2-9]|[1-9]\d+)\])", narrative) if shot.strip())
    narrative = re.sub(r"\[Shot ([1-9]\d*)\][ \t]*At[ \t]+", r"[Shot \1] At ", narrative)
    narrative = re.sub(r"<d>\s*(?!\[)([\s\S]*?)</d>", lambda m: f"<d>{dialogue_tag(m[1])} {m[1].strip()}</d>", narrative)
    narrative = check_shots(narrative, duration, fill=True)
    everything = "\n".join((narrative, sound, music))
    if re.search(r"<Subject [1-9]\d*>", everything):
        raise ValueError("H3 文生、图生和首尾帧提示词不能使用 <Subject N>")
    kind = base_mode(mode)
    used = set(re.findall(r"<(?:Picture|Video|Audio) [1-9]\d*>", everything))
    named = set(re.findall(r"<Picture [12]>", narrative)) | {f"<Picture {n}>" for n in re.findall(r"(?<![<\w])Picture ([12])(?![\w>])", narrative)}
    if kind == "T2VA" and used:
        raise ValueError("H3 文生视频不能引用参考素材")
    if kind == "I2VA" and used - {"<Picture 1>"}:
        raise ValueError("H3 图生视频的画面描述必须引用 <Picture 1>，且不能引用其他素材")
    if kind == "FL2VA" and used - {"<Picture 1>", "<Picture 2>"}:
        raise ValueError("H3 首尾帧视频的画面描述必须引用 <Picture 1> 和 <Picture 2>")
    if kind in ("I2VA", "FL2VA"):
        # Like the renderer's validateBaseFields: a frame the text does not name gets its anchor
        # sentence, the opening frame after the style sentence, the last frame at the end.
        lang = language or ("zh" if re.search(HAN, literal_free(narrative)) else "en")
        if "<Picture 1>" not in named:
            def opening(match):
                first = re.match(r"^(.*?[。！？]|.*?[.!?](?=\s|$))\s*(.+)$", match[1])
                anchor = BASE_ANCHORS["open"][lang]
                return "[Shot 1] " + (append_sentence(append_sentence(first[1], anchor), first[2]) if first else append_sentence(match[1], anchor))
            narrative = re.sub(r"^\[Shot 1\] ?([^\n]*)", opening, narrative, count=1)
        if kind == "FL2VA" and "<Picture 2>" not in named:
            narrative = append_sentence(narrative, BASE_ANCHORS["close"][lang])
        everything = "\n".join((narrative, sound, music))
    if kind == "L2VA":
        inventory = re.search(r"(?im)^Available resource labels:([^\n]*)", requirements or "")
        if inventory and not used <= set(re.findall(r"<(?:Picture|Video|Audio) [1-9]\d*>", inventory[1])):
            raise ValueError("H3 引用了未提供的素材")
    prose = re.sub(r"\bN/A\b|\bAt \d{2}:\d{2}\.\d{3}", "", literal_free(everything))
    if language == "en" and re.search(HAN, prose):
        raise ValueError("H3 英文提示词中仍有未翻译的中文")
    if language == "zh":
        han = len(re.findall(HAN, prose))
        if not han or len(re.findall(r"[A-Za-z]", prose)) > 2 * han:
            raise ValueError("H3 中文提示词正文必须使用简体中文")
    return "\n\n".join(f"{key}: {text}" for key, text in zip(BASE_FIELDS, (narrative, sound, music)))


def base_source_view(source):
    """What the local writer reads: the narrative without field names or shot marks,
    later shots as 镜头N（第X秒）： lines and spoken lines as (S1)："…"."""
    fields = parse_base_fields(source)
    text = fields.get(BASE_FIELDS[0], "") if fields else str(source or "")
    # The editor's Chinese display reads the same way (【画面与动作】 with 【镜头 N】).
    display = re.search(r"【画面与动作】([\s\S]*?)(?=【环境声音】|【背景音乐】|$)", text)
    if display:
        text = re.sub(r"【镜头\s*([1-9]\d*)】", r"[Shot \1]", display[1])
    spoken = []

    def speech(match):
        words = match[3].strip()
        # A tag the program would not write itself ([Japanese]) travels with the line.
        tag = match[2] if match[2] and match[2] != dialogue_tag(words) else ""
        spoken.append(f'({match[1]})：{tag}"{words}"')
        return ""
    text = re.sub(r"[（(](S[1-9]\d*(?:\s*,\s*S[1-9]\d*)*)[）)]\s*[^<\n]{0,12}?\s*<d>\s*(\[[A-Za-z ]+\])?\s*([\s\S]*?)</d>", speech, text)
    # "挥手并说：“出发吧。”" is a spoken line too; the program keeps its words.
    text, unlabelled = label_speech(text, spoken)
    spoken += unlabelled
    text = re.sub(r"\s*\[Shot 1\]\s*", "", text)
    text = re.sub(r"\s*" + SHOT_MARK + r"\s*", lambda m: f"\n镜头{m[1]}" + (
        f"（第{int(m[2]) * 60 + int(m[3]) + int(m[4]) / 1000:g}秒）" if m[2] else "") + "：", text)
    return "\n".join([text.strip(), *spoken]).strip()


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
        definitions.append(label + ": " + item["description"].strip() + origins)
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
    if "video editing" in plan["tasks"] or not asks_cut(source, user_requirement):
        # One continuous shot unless the user asked for a cut; an edit keeps the source's timing.
        # A later shot's content stays without its "镜头切到近景" opening.
        parts = re.split(r"\s*\[Shot (?:[2-9]|[1-9]\d+)\](?:[ \t]*At[ \t]+\d{2}:\d{2}\.\d{3},?)?\s*", description)
        description = parts[0].strip()
        for part in filter(None, map(fold_cut, parts[1:])):
            description += ("" if re.search(r"[㐀-鿿。，；！？]$", description) else " ") + part
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
    # One line per shot, no blank lines; the style sentence before [Shot 1] keeps its own line (official ref §5.2).
    lead, mark, rest = fields["detailed_description"].partition("[Shot 1]")
    shots = [re.sub(r"(?<=[。！？；，])[ \t]+(?=<)", "", one_paragraph(shot)) for shot in re.split(r"\s*(?=\[Shot (?:[2-9]|[1-9]\d+)\])", mark + rest) if shot.strip()]
    fields["detailed_description"] = "\n".join(([one_paragraph(lead)] if lead.strip() else []) + shots)
    fields["detailed_description"] = check_shots(fields["detailed_description"], duration, fill=True)
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
META_CONSTRAINT = r"原句|原提示词|原文|描述|三阶段|三个阶段|按阶段|各阶段|核心逻辑|补充要求|提示词|要求|用户(?:明确)?提出|只写|不要写|不写|写成"
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
SOUND_WORDS = r"(?<![齐轻低柔])声(?![势色称明望誉名])|音效|音乐|配乐|作响|嗡鸣|轰鸣|怒吼|吼叫|大吼|嘶吼|咆哮|呐喊|尖叫"
USER_SOUND = r"声|音|响|乐|唱|说|讲|喊|叫|吼|哭|台词|对白"
CAMERA_WORD = r"镜头|机位|运镜|摄像机|相机"
CAMERA_MOVES = (("fixed", r"固定|静止|不动|锁定"), ("follow", r"跟随|跟拍|跟踪|追随"), ("in", r"推近|推进|拉近|推向|推至"),
                ("out", r"拉远|拉开|后拉|拉出|后撤|拉至"), ("orbit", r"环绕|绕着|绕行"), ("pan", r"平移|横移|摇"),
                ("rise", r"升起|上升|下降|俯冲|升高|降低|上移|下移"))


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


LEGACY_TIMED = r"^\s*\d+(?:\.\d+)?\s*[-–—~至]\s*\d+(?:\.\d+)?\s*(?:s|秒)\s*[:：]?\s*"


def legacy_phases(text):
    """An answer in the old five sections (【递进式详细提示词】 with timed lines) as the five labels."""
    section = lambda name: (re.search(rf"【{name}】[ \t]*\n?([\s\S]*?)(?=\n?【|$)", text) or ["", ""])[1]
    lines = [line.strip() for line in section("递进式详细提示词").splitlines() if line.strip()]
    timed = [re.sub(LEGACY_TIMED, "", line) for line in lines if re.match(LEGACY_TIMED, line)]
    if len(timed) < 2:
        return text
    kept = [item for item in section("连续性与约束").splitlines()
            if item.strip() and not re.search(r"环境与动作声音\s*[:：]|配乐\s*[:：]|保持上述人物身份、参考帧绑定", item)]
    return "\n".join(["概述：" + "".join(line for line in lines if not re.match(LEGACY_TIMED, line)),
                      "起始：" + timed[0], "递进：" + "".join(timed[1:-1]), "收束：" + timed[-1], "约束：", *kept])


def overview_preamble(text):
    """Lines before 起始 without a 概述 label: the overview, minus assistant chatter and a 总述： label."""
    text = re.sub(r"(?m)^.*(?:[:：][ \t]*$|好的|以下是|如下|优化后|提示词).*$", "", text).strip()
    return re.sub(r"^(?:总述|综述|概要|概括|总览|简述|描述|总体|整体)\s*[:：]\s*", "", text).strip()


def split_action_phases(output):
    """Find the five labels, accepting 【概述】, **概述**, a bare label line or a short preamble."""
    text = str(output or "").replace("\ufffd", "").replace("\r\n", "\n").strip()
    text = re.sub(r"^```[A-Za-z]*[ \t]*\n?|\n?```$", "", text).strip()
    text = re.sub(r"\*\*|__", "", text)
    if "【递进式详细提示词】" in text:
        text = legacy_phases(text)
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
        label = match[1] or match[2] or match[3]
        if len(found) < len(PHASE_LABELS) and label == PHASE_LABELS[len(found)]:
            found.append(match)
        elif not found and label == PHASE_LABELS[1] and overview_preamble(text[:match.start()]):
            # No 概述 label: the lines before 起始 are the overview ("三维渲染：小机器人…").
            found += [None, match]
    if len(found) < len(PHASE_LABELS) - 1:
        raise ValueError("模型没有按格式给出概述、起始、递进、收束、约束五个标签")
    parts = [text[m.end() if m else 0:found[i + 1].start() if i + 1 < len(found) else len(text)].strip() for i, m in enumerate(found)]
    if found[0] is None:
        parts[0] = overview_preamble(parts[0])
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
    # "约束：无" is no constraint.
    return [item for item in items if not re.fullmatch(r"(?:无|没有|暂无|N/?A)[。.]", item, re.I)]


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


# A later shot the writer adds when the user asked for a cut: 镜头2（第3秒）：…
SHOT_LINE = r"(?m)^[ \t>#*\-•]*【?镜头\s*[2-9]\s*】?\s*([（(][^）)\n]{0,16}[）)])?\s*[:：][ \t]*(.*)$"
# The writer's own soundscape line: 声音：…
SOUND_LINE = r"(?m)^[ \t>#*\-•]*【?声音】?[ \t]*[:：][ \t]*(.*)$"
# "保持橘猫外观一致", "动作连贯": talk about consistency, nothing visible (official rule).
GENERIC_CONSTRAINT = r"(?:身份|外观|形象|样貌|造型)[^，,。；;]{0,8}(?:一致|不变|统一)|^(?:保持)?动作(?:连贯|流畅|自然|衔接)[^，,。；;]{0,4}[。]?$"
# "温室背景不变": a statement that nothing changes, unless the user asked for it.
UNCHANGED_SETTING = r"(?:背景|场景|环境)[^，,。；;]{0,6}(?:保持)?(?:不变|固定不动)"
# "准备切换": an editing note, not something on screen.
CUT_NOTE = r"准备切换|切换前|即将切换|等待切换"
# A limit in the user's own words ("背景保持不变", "不要音乐"). Only such limits stay as constraints: the
# writer's own "猫始终在窗台上" or "权杖角度全程不变" contradicts the action it describes.
USER_LIMIT = (r"始终|一直|全程|保持|不变|不动|静止|固定|不要|不用|不得|不能|不可|禁止|避免|别(?=让|动|切|加|用|出现|改|变|晃)|勿|无需|不需要"
              r"|不许|不准|(?<![一二两三四五六七八九十几每这那哪多单])只|仅|不加|不添加|不出现|不改")
LIMIT_CHARS = set("始终一直全程保持不变动静止固定要用得能可禁避免别勿无需只仅许准加添出现改和与及的了在是也都或")
# "画面保持静止" in the middle of the action: nothing on screen stops.
FROZEN_PICTURE = r"^\s*(?:整个|整体)?(?:画面|场景|一切)(?:随即|随后|最终|最后|随之)?(?:保持|维持|归于|回归|陷入|趋于)?(?:静止|定格|不动)"
# The overview is the opening picture; "然后跳下窗台" or a cut there tells an event twice.
OVERVIEW_EVENT = r"^\s*(?:然后|接着|随后|之后|最后|最终|紧接着|随即|再)|切(?:到|至|换|回)|转场"
# "窗台木板轻微吱呀声，猫爪落地轻响": a list of sounds rather than a sentence.
SOUND_NOUN = r"声|声音|声响|响|响声|音|轻响|回响|回声"


def limit_clauses(text):
    """The words of each limit in the text ("背景保持不变" -> {背景, 景保}), without the limit words themselves."""
    return [pairs for pairs in ({pair for pair in han_pairs(clause) if set(pair) - LIMIT_CHARS}
                                for clause in re.split(r"[，,。；;！？!?\n]", str(text or "")) if re.search(USER_LIMIT, clause)) if pairs]


def within_limits(clause, limits):
    """The clause repeats one of the limits: a short limit ("不要音乐") by one word, a longer one by two."""
    return any(len(pairs & han_pairs(clause)) >= (1 if len(pairs) <= 3 else 2) for pairs in limits)


def sound_sentence(text):
    """"A声，B轻响" reads as one sentence: "可以听到A声和B轻响。"."""
    clauses = [c.strip() for c in re.split(r"[，,、；;]", re.sub(r"[。.！!]+$", "", str(text or "").strip())) if c.strip()]
    if (not clauses or re.search(r"[。.！!？?]", "".join(clauses)) or not all(re.search(rf"(?:{SOUND_NOUN})$", c) for c in clauses)
            or re.search(r"发出|传来|响起|作响|回荡|听到|听见", "".join(clauses))):
        return text
    return "可以听到" + ("、".join(clauses[:-1]) + "和" if len(clauses) > 1 else "") + clauses[-1] + "。"


# Where a speaker talks; the line goes after that sentence.
SPEAK_AT = r"说|讲|台词|念|回答|回应|答道|问道|喊|开口|打招呼"
# The words that end a speaker's name at the start of a sentence ("女孩抬起右手" -> 女孩).
NAME_END = r"[在从向朝把将对给抬举挥转走跑跳看望站坐蹲躺趴伸弯低点摇笑开说回停放拿握拍迈俯仰侧背面微轻缓慢快迅猛突再又也正都仍继已便就随同和与跟用以被让使，,。！？]"


def speaker_name(sentence, user_text):
    """The subject a speaking sentence opens with, when the user's own words name it too."""
    head = re.sub(r"^(?:一只|一个|一位|一名|那只|这只|那个|这个)", "", sentence.strip())
    name = re.match(rf"[㐀-鿿]{{2,6}}?(?={NAME_END})", head)
    if name and name[0] in user_text:
        return name[0]
    return next((head[:n] for n in (4, 3, 2) if re.fullmatch(r"[㐀-鿿]+", head[:n]) and head[:n] in user_text), "")


def compile_action_phases(output, mode, duration, source, requirements="", user_requirement="", strict_rules=False, keep_pose=False, audio=None, cut=False):
    """The model rewrites content; the application owns shots, cut times, media
    labels and literal speech. Returns the Chinese base fields text.

    With strict_rules an answer that copies a special-case rule the user never
    asked for is rejected, so the caller can ask once more; otherwise only the
    clauses carrying that rule are dropped. keep_pose keeps constraints that
    hold the pose (two nearly identical first/last frames). cut: the user asked
    for a cut, so the writer's 镜头N lines become later shots; otherwise their
    content stays in the one continuous shot. audio: (soundscape, music, cues);
    a soundscape of None takes the writer's 声音 line plus the sounds the user
    named (cues).
    """
    later, shot_texts, heard = [], [], []

    def take(match):
        seconds = re.search(r"\d+(?:\.\d+)?", match[1] or "")
        later.append(float(seconds[0]) if seconds else None)
        shot_texts.append(match[2])
        return ""

    def take_sound(match):
        heard.append(match[1])
        return ""
    parts = split_action_phases(re.sub(SOUND_LINE, take_sound, re.sub(SHOT_LINE, take, str(output or ""))))
    mode = str(mode or "").upper()
    inventory = re.search(r"(?im)^Available resource labels:([^\n]*)", requirements)
    refs = sorted(set(re.findall(r"<(?:Picture|Video|Audio) [1-9]\d*>", inventory[1] if inventory else source))) if mode == "L2VA" else []
    if mode == "I2VA":
        refs = ["<Picture 1>"]
    elif mode == "FL2VA":
        refs = ["<Picture 1>", "<Picture 2>"]
    # The program owns media bindings; a label the model invented is dropped.
    keep_refs = lambda s: re.sub(r"<(?:Picture|Video|Audio) [1-9]\d*>", lambda m: m[0] if m[0] in refs else "", s)
    # "三维渲染：小机器人…" opens with the style, not a label.
    overview = re.sub(r"^([^，。；：:\n]{0,8}(?:风格|画风|渲染|写实|动画|动漫|插画|照片|摄影|电影|水墨|油画|卡通|3D|CG)[^，。；：:\n]{0,4})[：:；;]\s*", r"\1，",
                      keep_refs(clean_phase_text(parts[0])))
    phases = [keep_refs(clean_phase_text(p)) for p in parts[1:4]]
    if not cut:
        # A cut nobody asked for: its content stays in the one shot, without the cut.
        phases[-1] += "".join(keep_refs(clean_phase_text(fold_cut(text))) for text in shot_texts)
        later, shot_texts = [], []
    # "准备切换" is an editing note, nothing on screen.
    phases = [drop_matching_clauses(p, CUT_NOTE) for p in phases]
    beat_count = len(phases)
    phases += [keep_refs(clean_phase_text(text)) for text in shot_texts]
    # A rule copied with its heading ("纯色背景：背景颜色…全程不变") keeps only what is on screen.
    rule_heading = "|".join(rule["rule"].split("：", 1)[0] for rule in CONDITIONAL_RULES)
    constraints = [keep_refs(re.sub(rf"^(?:{rule_heading})[:：]\s*", "", item)) for item in clean_constraints(parts[4])]
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
    # The overview is the opening picture (style, subjects, place, framing, camera): a pasted
    # "然后跳下窗台", a copy of a beat or a cut there tells an event twice or cuts inside shot 1.
    # With a cut, what the user shows only after it ("切到街角咖啡店里的女孩") stays out of shot 1.
    later_pairs = later_shots(user_text)[1] if shot_texts else set()
    beat_pairs = han_pairs("".join(phases[:beat_count]))
    event = lambda clause: (re.search(OVERVIEW_EVENT, clause) or han_pairs(clause) & later_pairs
                            or len(han_pairs(clause)) >= 4 and len(han_pairs(clause) & beat_pairs) >= 0.8 * len(han_pairs(clause)))
    overview = drop_clauses(overview, event) if has_text(drop_clauses(overview, event)) else overview
    if later_pairs:
        first = [drop_clauses(p, lambda clause: han_pairs(clause) & later_pairs) for p in phases[:beat_count]]
        if any(has_text(p) for p in first):
            phases[:beat_count] = first
        elif strict_rules:
            raise ValueError("第一个镜头写了切换后才出现的画面，切换前只写第一个镜头")
    # "…尾巴摆动幅度最大，第4秒切到近景": the cut is the next shot's mark, not an event of this one.
    uncut = [drop_clauses(p, requested_cut) for p in phases[:beat_count]]
    phases[:beat_count] = uncut if any(has_text(p) for p in uncut) else phases[:beat_count]
    if not asked & {"idle", "still"}:
        # "画面保持静止" in the middle of the action.
        phases = [drop_matching_clauses(p, FROZEN_PICTURE) for p in phases]
    stop = lambda s: s if "定格" in user_text else map_clauses(s, settle_freeze)
    overview, phases, constraints = stop(overview), [stop(p) for p in phases], [stop(item) for item in constraints]
    # The program owns the timing: a clause with the answer's own seconds goes ("爪尖离地0.5秒前").
    own_seconds = lambda clause: any(m[0] not in user_text for m in re.finditer(r"\d+(?:\.\d+)?\s*秒", clause))
    phases = [drop_clauses(p, own_seconds) for p in phases]
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
        (moves for moves in map(camera_moves, re.split(r"[，,。；;\n]", "\n".join([overview, *phases[:beat_count]]))) if moves), set())
    if anchor:
        # A later shot the user asked for frames its own camera.
        other_move = lambda clause: camera_moves(clause) and not camera_moves(clause) & anchor
        overview = drop_clauses(overview, other_move) if user_anchor else overview
        phases = [drop_clauses(p, other_move) if i < beat_count else p for i, p in enumerate(phases)]
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
    if re.search(SPEECH_LINE, source):
        phases = [neutral_speech(p, i) for i, p in enumerate(phases)]
        # The program writes each line once in <d>; a copy the answer quoted goes, with or without its
        # closing stop ("说出“出发吧”" for 出发吧。), and "说出" left without its words is plain speaking.
        for words in {m[3] for m in re.finditer(SPEECH_LINE, source)}:
            copy = (r'[：:，,]?\s*(?:[（(]S[1-9]\d*(?:\s*,\s*S[1-9]\d*)*[）)]\s*[:：]?\s*)?[“"]'
                    + re.escape(re.sub(r"[。！？!?.…]+$", "", words)) + r'[。！？!?.…]*[”"]')
            phases = [re.sub(r"。(?=[。，,！？])", "", re.sub(copy, "。", p)) for p in phases]
        phases = [re.sub(r"(说|喊|念)出(?=。)|(?<=[，,、时并口])(说)(?=。)", lambda m: "说话" if (m[1] or m[2]) == "说" else m[1], p) for p in phases]
    # The answer's own quotes around a word ("幅度始终为“轻轻”", "“噗”一声") would stay Chinese in the
    # English copy; the user's quoted text and quoted speech or signs keep theirs.
    user_quotes = {m[1] or m[2] for m in re.finditer(r'“([^”\n]*)”|"([^"\n]*)"', user_text)}
    unquote = lambda text: re.sub(r'(?<![说喊唱念道问答叫吼出着有示写印：:])[“"]([^”"\n]{1,12})[”"]', lambda m: m[0] if m[1] in user_quotes else m[1], text)
    overview, phases, constraints = unquote(overview), [unquote(p) for p in phases], [unquote(item) for item in constraints]
    if mode == "FL2VA":
        phases = [re.sub(r"画面(?:回归|复归|复刻|还原|恢复|回到)(?:为|成|到|至)?与?\s*(<Picture 2>)(?:完全)?(?:一致|相同)?的?(?:静止)?(?:状态|形态|画面|样子)?", r"画面与 \1 一致", p) for p in phases]
    asked_text = compact(user_text + "\n" + "\n".join(rule["rule"] for rule in CONDITIONAL_RULES if rule["name"] in asked))
    camera_asked = "camera" in asked or bool(re.search(USER_CAMERA_BAN, user_text))
    # "背景不变" stays only when the user asked for it; a constraint about the cut is not a constant fact.
    unchanged = not (re.search(UNCHANGED_SETTING, user_text) or "background" in asked)
    # A constraint stays only as a limit the user set, or a rule the user asked for (loop, green screen, still).
    rules = [rule for rule in CONDITIONAL_RULES if rule["name"] in asked]
    limits = limit_clauses("\n".join([user_text] + [rule["rule"] for rule in rules]))
    users = lambda clause: (within_limits(clause, limits) or any(re.search(rule["ask"], clause, re.I) or rule["leak"] and re.search(rule["leak"], clause, re.I) for rule in rules)
                            or (asked & {"idle", "still"} or keep_pose) and re.search(POSE_FREEZE, clause))
    constraints = [drop_clauses(item, lambda clause: re.search(META_CONSTRAINT, clause) or re.search(STAGE_CONSTRAINT, clause)
                                or invented_ban(clause, asked_text, camera_asked) or (unchanged and re.search(UNCHANGED_SETTING, clause))
                                or requested_cut(clause) or not users(clause)) for item in constraints]
    # A constraint that only repeats the overview, its camera or an action adds nothing.
    same_camera = lambda clause: re.match(r"\s*(?:且|并)?(?:镜头|机位)", clause) and camera_moves(clause) and camera_moves(clause) <= camera_moves(overview)
    # "镜头全程固定，无移动或切换": the bans after a repeated camera go with it.
    clauses = lambda item: [c for c in re.split(r"[，,；;。]", item) if c.strip()]
    constraints = [drop_clauses(item, same_camera) for item in constraints if not (
        clauses(item) and same_camera(clauses(item)[0]) and all(re.match(r"\s*(?:且|并)?(?:无|不|没有|禁止|避免)", c)
                                                                and re.search(CAMERA_TERMS + r"|移动|切换", c) for c in clauses(item)[1:]))]
    grams = lambda text: {text[i:i + 2] for i in range(len(text) - 1)}
    written = grams(compact(overview + "".join(phases)))
    constraints = [item for item in constraints if has_text(item) and not re.search(GENERIC_CONSTRAINT, item)
                   and len(grams(compact(item)) & written) < 0.7 * len(grams(compact(item)))]
    if not has_text(overview) or not any(has_text(p) for p in phases[:beat_count]):
        raise ValueError("优化内容不能为空")
    # Sustained idle/stillness can span several phases; a loop may end at its
    # initial pose. Novelty belongs to the whole rewrite, not pairwise stages.
    validate_enhancement(overview + "\n" + "\n".join(phases), source, user_requirement, loop="loop" in asked and mode != "FL2VA")
    beats, shots = [], [(seconds, text) for seconds, text in zip(later, phases[beat_count:]) if has_text(text)]
    for phase in phases[:beat_count]:
        # An emptied or repeated phase is part of the one before it.
        if has_text(phase) and not (beats and compact(beats[-1]) == compact(phase)):
            beats.append(phase)
    if cut and not shots and strict_rules:
        raise ValueError("用户要求切换镜头，请用“镜头2（第X秒）：”写出切换后的镜头")
    texts = beats + [text for _, text in shots]
    at, left = (0, 0), []
    for ids, tag, words in re.findall(SPEECH_LINE, source):
        # Each line goes after the next sentence where the answer has someone talk, in order,
        # named by that sentence's subject; H3 lip-syncs from it. The rest close the first shot.
        line = f"({ids}) 说：<d>{tag or dialogue_tag(words)} {words}</d>"
        spot = next(((i, talk) for i in range(at[0], len(texts))
                     for talk in [re.compile(SPEAK_AT).search(texts[i], at[1] if i == at[0] else 0)] if talk), None)
        if spot is None:
            left.append(line)
            continue
        i, talk = spot
        text = texts[i]
        # The talking sentence starts after the last full stop or the line placed before it.
        start = talk.start() - len(re.split(r"[。！？!?]|</d>", text[:talk.start()])[-1])
        if text[talk.start():talk.start() + 2] == "说完":
            # "他说完这句话" comes after the line itself.
            split = start
        else:
            # The sentence ends after any quoted words it carries.
            end = re.search(r'^(?:“[^”]*”|"[^"]*"|[^。！？!?“"])*?[。！？!?]', text[talk.end():])
            split = talk.end() + end.end() if end else len(text)
        name = speaker_name(text[start:talk.start()], user_text)
        line = (name + " " if name else "") + line
        texts[i] = text[:split] + line + text[split:]
        at = (i, split + len(line) if split >= talk.end() else talk.end() + len(line))
    if left and strict_rules:
        # A line with nobody talking lands after the action has ended; ask once for the speaking moment.
        raise ValueError("对白没有安排说话的时刻，请在起始、递进或收束里写出说话者开口说话")
    if left:
        texts[len(beats) - 1] += "".join(left)
    if shots:
        # Several shots: the first shot's camera is not "全程" (for the whole video).
        whole = lambda text: re.sub(r"((?:镜头|机位)[^，,。；;\n]{0,4}?)全程|全程(?=固定|跟随|跟拍|推近|拉远)", r"\1", text)
        overview, constraints, texts = whole(overview), [whole(item) for item in constraints], [whole(t) for t in texts]
    if mode in ("I2VA", "FL2VA") and "<Picture 1>" not in overview + "".join(texts):
        texts[0] = "画面从 <Picture 1> 开始，" + texts[0]
    if mode == "FL2VA" and "<Picture 2>" not in texts[-1]:
        texts[-1] += "结束时画面与 <Picture 2> 一致。"
    if not re.search(CAMERA_PATTERN, overview + "".join(texts[:len(beats)]) + user_text, re.I):
        overview += DEFAULT_CAMERA_ZH
    # What stays the same belongs with the opening composition; the shot ends on its ending.
    narrative = "[Shot 1] " + overview + "".join(constraints) + "".join(texts[:len(beats)])
    # A cut time the writer left out comes from the user's own words ("第4秒切到近景").
    times = shot_times([s for s, _ in shots], duration, cut_seconds(user_text))
    for number, (seconds, text) in enumerate(zip(times, texts[len(beats):]), 2):
        narrative += f"\n[Shot {number}] At {shot_stamp(seconds)} " + ("" if re.match(r"镜头|画面", text) else "镜头" if text.startswith("切") else "镜头切到") + text
    sound, music, cues = (tuple(audio) + ((),))[:3] if audio else (None, "N/A", ())
    if sound is None:
        # The writer's sounds of what is on screen; speech, music and seconds belong elsewhere.
        music_asked = re.search(r"音乐|配乐|乐曲|旋律|伴奏|BGM|music", user_text, re.I)
        # A quoted sound ("啪") would read as on-screen text and stay Chinese in the English copy.
        sound = drop_clauses(clean_phase_text(re.sub(r'[“”"]', "", "\n".join(heard))), lambda clause: re.search(
            r"说话|台词|对白|人声|讲话|静音|无其他|没有其他|\d+(?:\.\d+)?\s*秒" + ("" if music_asked else r"|音乐|配乐|乐曲|旋律|伴奏"), clause))
        sound = "" if not has_text(sound) or re.fullmatch(r"(?:无|没有|N/?A|静音)[。.]?", sound, re.I) else sound_sentence(sound)
        # "海浪声" is already there as "海浪拍岸声"; a one-character source ("风声") must match whole.
        missing = [cue for cue in cues if compact(cue) not in compact(sound) and not (len(cue) > 2 and cue[:2] in sound)]
        sound = (append_sentence(sound, "、".join(missing) + "清晰可闻。") if missing else sound) or DEFAULT_SOUNDSCAPE_ZH
    return validate_base_fields("\n\n".join(f"{key}: {value}" for key, value in zip(BASE_FIELDS, (narrative, sound, music))),
                                mode, duration, "zh", requirements)
