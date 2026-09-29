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
# Background music by default (official base §4.7: instrumentation, tempo, rhythm, dynamics), for a writer that gave none.
DEFAULT_MUSIC_ZH = "轻柔的钢琴单音配低音弦乐长音，速度缓慢，音量平稳，结尾渐弱。"
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
    ["街角咖啡店里的女孩"], {街角, 咖啡, 女孩, …}): the first shot does not show it yet. Only what the cut
    goes to counts, never a word sharing a character with the words before the cut: "第3秒切到近景，
    橘猫睁开眼睛" reframes the same cat and "切到橘猫的特写" renames "一只猫"."""
    text = re.sub(NO_CUT, "", str(text or ""), flags=re.I)
    cuts = [m for m in re.finditer(CUT_PATTERN, text, re.I) if re.search(r"切|\bcut", m[0], re.I)]
    before = set(re.findall(HAN, text[:cuts[0].start()])) if cuts else set()
    own = lambda part: {pair for pair in han_pairs(part) if not set(pair) & before and not re.fullmatch(LATER_SHOT_STOP, pair)
                        and not set(pair) & set(LATER_SHOT_CHARS)}
    parts = [part for part in (re.split(r"[，,。！？；;\n]", text[m.end():])[0].strip() for m in cuts) if own(part)]
    return parts, set().union(set(), *map(own, parts))


def asked_shots(text):
    """How many later shots the user's words ask for ("分三个镜头" -> 2, "第4秒切到近景" -> 1); None when not said."""
    text = re.sub(NO_CUT, "", str(text or ""), flags=re.I)
    many = re.search(r"([两二三四五六2-6])个镜头", text)
    if many:
        return ({"两": 2, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6}.get(many[1]) or int(many[1])) - 1
    cuts = [m for m in re.finditer(CUT_PATTERN, text, re.I) if re.search(r"切|\bcut", m[0], re.I)]
    return len(cuts) or None


def said_already(clause, text):
    """The clause adds nothing: nearly all of its words are in the text ("橘猫尾巴摆动" after "尾巴摆动")."""
    pairs = han_pairs(clause)
    return compact(clause) in compact(text) or bool(pairs) and len(pairs - han_pairs(text)) <= 0.3 * len(pairs)


def merge_point_beats(text):
    """"1. 女神转动权杖：起始…递进…收束… 2. 光点流转：起始…" (one set of beats per point, before any later shot): the
    points' beats merge into one 起始, 递进 and 收束 in the points' order, and the point headings go."""
    lines = str(text or "").replace("\r\n", "\n").split("\n")
    end = next((i for i, line in enumerate(lines) if re.match(r"^[ \t>#*\-•]*【?镜头\s*[2-9]", line)), len(lines))
    beat = lambda line: re.match(r"^[ \t>#*\-•]*(起始|递进|收束)[ \t]*[:：][ \t]*(.*)$", line)
    if sum(1 for line in lines[:end] if (beat(line) or [None, None])[1] == "起始") < 2:
        return text
    merged, head, rest = {}, [], []
    for line in lines[:end]:
        found = beat(line)
        if found:
            merged.setdefault(found[1], []).append(found[2].strip().rstrip("。；;，, "))
        elif not re.match(r"^\s*(?:\d+[.、)）]|[（(]\d+[)）])[^\n]*[:：]\s*$", line):
            (rest if merged else head).append(line)
    beats = [f"{label}：" + "。".join(merged[label]) for label in ("起始", "递进", "收束") if label in merged]
    return "\n".join(head + beats + rest + lines[end:])


def fold_repeated_beats(text):
    """A beat label written again after a later shot ("镜头2：…" and then a second "收束：…") goes on with that shot."""
    out, seen, shot = [], set(), None
    for line in str(text or "").split("\n"):
        label = re.match(r"^[ \t>#*\-•]*(起始|递进|收束)[ \t]*[:：][ \t]*(.*)$", line)
        if label and label[1] in seen and shot is not None:
            # Only what the shot line does not say already.
            out[shot] = out[shot].rstrip("。，, \t") + "".join("，" + c.strip() for c in re.findall(r"[^，,。；;]+", label[2])
                                                              if c.strip() and not said_already(c, out[shot]))
            continue
        if label:
            seen.add(label[1])
        shot = len(out) if re.match(r"^[ \t>#*\-•]*【?镜头\s*[2-9]", line) else shot if not line.strip() else None
        out.append(line)
    return "\n".join(out)


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
    clause is nothing but a camera move ("镜头从天际线缓缓下移" names a place and is translated). A
    leading "最后" or "同时" is the caller's to keep outside: it is translated with the sentence."""
    clause = str(clause or "").strip()
    if re.fullmatch(r"(?:固定|静止)的?镜头(?:拍摄)?", clause):
        return "the camera holds a static shot"
    moves = "|".join(f"(?P<m{i}>{word})" for i, (_, word) in enumerate(CAMERA_GLOSSARY))
    match = re.fullmatch(rf"(?:{CAMERA_SUBJECT})(?:全程|始终|一直|持续|开始|随即)?(?:保持|维持|以|用)?(?P<mods>(?:(?:{CAMERA_MODIFIERS})[地的、]?)*)"
                         rf"(?:{moves})(?:[它她他]们?(?P<after>(?:(?:{CAMERA_MODIFIERS})[地的、]?)*))?(?:拍摄|运动|移动|运镜)?", clause)
    if not match:
        return ""
    move = CAMERA_GLOSSARY[next(i for i in range(len(CAMERA_GLOSSARY)) if match[f"m{i}"])][0]
    mods = match["mods"] + (match["after"] or "")
    if move.startswith(("holds", "shakes")):
        return "the camera " + ("shakes strongly" if move.startswith("shakes") and re.search(r"大幅", mods) else move)
    extra = [english for english, word in CAMERA_AMPLITUDE + CAMERA_SPEED if re.search(word, mods)]
    return " ".join(["the camera", move, *extra])


def camera_move_clause(clause):
    """The clause moves the camera itself ("镜头从天际线缓缓下移"); "看向镜头", "镜头前太阳缓缓升起" or
    "镜头带有轻微光晕" move nothing, so their words are no camera words."""
    moves = "|".join(word for _, word in CAMERA_GLOSSARY)
    return bool(re.search(rf"{CAMERA_AS_SUBJECT}[^，,。；;！？!?\n]{{0,12}}?(?:{moves})", str(clause or "")))


# A translation that turns a speed or direction around ("缓慢加快" -> "slows down"): the Chinese words,
# the Chinese words that would allow it, the English that turns it around, and the retry hint.
FASTER, SLOWER = r"加快|加速|变快|越来越快|更快|提速", r"减慢|放慢|变慢|减速|越来越慢|更慢|慢了?下来|缓了?下来|放缓"
CLOSER, FARTHER = r"推近|推进|拉近|前推", r"拉远|后拉|拉开|后撤"
RISE, FALL = r"上移|上升|升起|升高|上摇|仰摇|向上", r"下移|下降|降低|下摇|俯摇|向下"
LEFT_EN = r"\b(?:to|toward|towards|on|from) (?:the |her |his |its |their )?left\b|\bleft(?:ward|wards)?\b(?=[ -](?:side|hand|arm|leg|foot|shoulder|edge|corner|paw))|\b(?:pans?|trucks?|turns?|moves?|slides?|tilts?|rolls?|shifts?|looks?|swings?|sweeps?|glances?|leans?|steps?) (?:to the )?left\b"
FLIPS = (
    # "加快脚步，随后在门口停下" slows down to stop.
    (FASTER, SLOWER + r"|停下|停住|停步|止步", r"\bslow(?:s|ing|ed)? down\b|\bdecelerat|\bslower\b", "加快 means speeds up", False),
    (SLOWER, FASTER, r"\bspeed(?:s|ing)? up\b|\baccelerat|\bfaster\b", "减慢 or 放缓 means slows down", False),
    (CLOSER, FARTHER, r"\bpull(?:s|ing|ed)? (?:out|back)\b|\bzoom(?:s|ing|ed)? out\b|\b(?:moves?|draws?) back\b", "推近 or 拉近 means the camera pushes in", True),
    (FARTHER, CLOSER, r"\bpush(?:es|ing|ed)? in\b|\bzoom(?:s|ing|ed)? in\b|\bmoves? closer\b", "拉远 or 后撤 means the camera pulls out", True),
    (RISE, FALL, r"\b(?:down|downward|downwards|descends?|lowers?)\b", "上移 or 上升 means the camera moves up (pedestals up, or tilts up)", True),
    (FALL, RISE, r"\b(?:up|upward|upwards|rises?|ascends?)\b", "下移 or 下降 means the camera moves down (pedestals down, or tilts down)", True),
    (r"左", r"右", LEFT_EN.replace("left", "right"), "左 means left", False),
    (r"右", r"左", LEFT_EN, "右 means right", False),
    # "眼睛完全眯起" came back as "eyes completely shut"; "half-closed" is a narrowed eye.
    (r"眯", r"闭|合|关", r"(?<!half-)(?<!half )\b(?:shut|closed?|closes|closing)\b", "眯 means the eyes narrow to slits, never shut or closed", False),
    (r"闭着眼|闭目", r"闭上|闭起|合上|缓缓闭|慢慢闭|渐渐闭", r"\bclos(?:es|ing) (?:her|his|its|their) eyes\b",
     "闭着眼睛 or 闭目 is a state: with her eyes closed, never closes her eyes", False),
    # Shot sizes (official): 特写 close-up, 近景 medium close-up, 中景 medium shot, 全景 full shot, 远景 wide shot.
    (r"近景", r"特写", r"(?<!medium )\bclose-?up\b|\bclose shot\b", "近景 means medium close-up", False),
    (r"特写", r"近景|中景", r"\bmedium (?:close-?up|shot)\b", "特写 means close-up", False),
    (r"中景", r"近景|特写|全景|远景", r"\bclose-?up\b|\bwide shot\b|\bfull shot\b", "中景 means medium shot", False),
    (r"全景", r"远景", r"\bwide shot\b|\bpanoram", "全景 means full shot", False),
    (r"远景", r"全景", r"\bfull shot\b", "远景 means wide shot", False),
    # A spear's parts in a chunk without its scene ("左手松开枪柄") came back as a gun.
    # "松开枪柄" holds no 开枪; 出枪 and 枪法 are a gun's as often as a spear's.
    (r"长枪|红缨枪|枪[杆尖头缨柄]", r"(?:[手步机猎水拔]|开[了一二三四五六七八九十两几数]{0,2})枪(?![杆尖头缨柄])|枪械|枪管|枪口|枪声|子弹|射击|扳机|瞄准", r"\bgun(?: barrel|staff)?s?\b",
     "枪 here is a spear, never a gun", False),
)
# The camera's own clause: "the girl sits down" in "The camera moves up as the girl sits down" is hers.
CAMERA_CLAUSE = (r"\bcamera\b[^,;.!?]*?(?=\s+(?:(?:as|while|when|until|before|after|following|whereas)\b"
                 r"|and\s+(?:(?:the|her|his|its|their|she|he|it|they)\b|TOKEN_|<))|[,;.!?]|$)")
SHOT_SIZE_WORDING = "特写 -> close-up; 近景 -> medium close-up; 中景 -> medium shot; 全景 -> full shot; 远景 -> wide shot"
# One pinyin syllable; "Kuokou" for 壶口 is two of them, one per character.
PINYIN_SYLLABLE = r"(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(?:iang|iong|uang|ueng|ang|eng|ing|ong|ian|iao|uai|uan|ai|ei|ao|ou|an|en|in|un|ia|ie|iu|ua|uo|ui|ve|er|[aeiouv])"


def pinyin_like(word, run):
    """A leftover's translation that is only the romanized characters ("Kuokou" for 壶口), not English."""
    return len(run) >= 2 and bool(re.fullmatch(rf"(?:{PINYIN_SYLLABLE}){{{len(run)}}}", str(word or "").strip().lower().replace(" ", "").replace("-", "")))


def translation_flips(chinese, english):
    """Hints for the speed and direction words a translation turned around; camera words are read in
    the camera's own clauses."""
    camera_en = " ".join(re.findall(CAMERA_CLAUSE, english, re.I))
    camera_zh = "".join(c for c in re.split(r"[，,。；;！？]", chinese) if re.search(CAMERA_SUBJECT, c))
    return [hint for zh, allowed, flipped, hint, camera in FLIPS
            if re.search(zh, camera_zh if camera else chinese) and not re.search(allowed, camera_zh if camera else chinese)
            and re.search(flipped, camera_en if camera else english, re.I)]


# Whole phrases: "slows down" is "speeds up", never "slows up".
FLIP_SWAPS = {"left": "right", "right": "left", "slow down": "speed up", "slows down": "speeds up", "slowing down": "speeding up",
              "slowed down": "sped up", "speed up": "slow down", "speeds up": "slows down", "speeding up": "slowing down", "sped up": "slowed down",
              "slower": "faster", "faster": "slower", "decelerat": "accelerat", "accelerat": "decelerat", "down": "up", "up": "down",
              "downward": "upward", "upward": "downward", "downwards": "upwards", "upwards": "downwards", "descend": "rise", "descends": "rises",
              "lower": "rise", "lowers": "rises", "rise": "descend", "rises": "descends", "ascend": "descend", "ascends": "descends",
              "gun barrel": "spear shaft", "gun barrels": "spear shafts", "gunstaff": "spear shaft", "gunstaffs": "spear shafts",
              "gun": "spear", "guns": "spears"}
FLIP_SWAP_WORDS = (r"\b(?:" + "|".join(sorted((word for word in FLIP_SWAPS if not word.endswith("celerat")), key=len, reverse=True))
                   + r")\b|decelerat|accelerat")


def unflip(chinese, english):
    """A translation that turned left/right, a speed or up/down around (or made a spear a gun), turned back phrase by
    phrase in the flagged words ("turns to the left" for 向右转身), a camera's up/down only in the camera's own clause;
    '' when a flip is left (the caller fails rather than ship it)."""
    def swap(m):
        return re.sub(FLIP_SWAP_WORDS, lambda w: FLIP_SWAPS[w[0].lower()].capitalize() if w[0][0].isupper() else FLIP_SWAPS[w[0].lower()],
                      m[0], flags=re.I)
    for zh, allowed, flipped, hint, camera in FLIPS:
        if hint in translation_flips(chinese, english):
            english = (re.sub(CAMERA_CLAUSE, lambda c: re.sub(flipped, swap, c[0], flags=re.I), english, flags=re.I) if camera
                       else re.sub(flipped, swap, english, flags=re.I))
    return "" if translation_flips(chinese, english) else english


def camera_wording(chinese, english):
    """The official camera wording in the camera's own sentences: a vertical move of the camera is a
    tilt or pedestal, never a pan; amplitude and speed only where the Chinese has them."""
    # "the camera (slowly) pans down" / "pushes down from the skyline"; "he pushes down the switch" is not the camera's.
    mover = r"(\bcamera\s+(?:(?:slowly|gently|gradually|smoothly|steadily|quickly|rapidly|then|also|now)\s+)*)"
    ending = lambda m: {"s": "s", "es": "s", "ning": "ing", "ing": "ing", "ned": "ed", "ed": "ed"}.get(m[2] or "", "")

    def sentence(text):
        if not re.search(r"\bcamera\b", text, re.I):
            return text
        text = re.sub(mover + r"pan(s|ning|ned)? (up|down)(?:wards?)?\b", lambda m: m[1] + "tilt" + ending(m) + " " + m[3], text, flags=re.I)
        text = re.sub(mover + r"push(es|ing|ed)? (up|down)(?:wards?)?\b", lambda m: m[1] + "pedestal" + ending(m) + " " + m[3], text, flags=re.I)
        for words, phrase in ((r"缓|慢|徐|低速", "at (?:a )?slow speed"), (r"快|迅|急|猛|疾|高速", "at (?:a )?fast speed"),
                              (r"小幅|轻|微|稍|略|幅度[^，,。；;]{0,3}小", "with (?:a )?small amplitude"),
                              (r"大幅|剧烈|大范围|幅度[^，,。；;]{0,3}大", "with (?:a )?large amplitude")):
            if not re.search(words, chinese):
                text = re.sub(r",?\s*\b" + phrase + r"\b", "", text)
        return text
    return "".join(sentence(part) for part in re.split(r"((?<=[.;!?])\s+)", english))


# Style words of an English opening ("Live-action, cinematic", "3D CG").
STYLE_EN = r"live-action|cinematic|2d-animated|animated|3d|cg|claymation|watercolor|vintage|film|anime|illustration|illustrated|realistic|photorealistic|ink|painting|cartoon|rendering|rendered|style|look"


def official_english(text, opening_style=True):
    """The translation in the official form, outside spoken lines and quotes: "the 3rd second" (never "3nd"),
    "[Shot 1] Live-action, cinematic, a full shot frames ..." (no semicolon or full stop after the style words),
    "[Shot 2] At 00:03.000, the camera cuts to ...", and a subject definition that is a noun phrase
    ("<Subject 1>: a male character with ..." rather than "Male character, ..."). 多参 keeps its style sentence before
    [Shot 1] (official ref §5.2): opening_style=False."""
    def ordinal(m):
        number = int(m[1])
        return m[1] + ("th" if 10 <= number % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th"))

    # A name keeps its capital and takes no article ("Nezha", "Zhong Kui"): only a word the text also writes in lower
    # case, or a common opening word, is lowered; the first word of a longer name ("Sun Wukong", "Jade Emperor") keeps it.
    listed = lambda word: re.fullmatch(r"(?:the|an?|male|female|young|old|elderly|man|woman|girl|boy|robot|cat|dog|character|person|figure|"
                                       r"warrior|she|he|it|they|two|both|each)", word.lower())
    common = lambda word: listed(word) or re.search(rf"\b{word.lower()}\b", str(text or ""))

    def opening(m):
        if re.sub(rf"\b(?:{STYLE_EN})\b|[,\s-]", "", m[2], flags=re.I):
            return m[0]
        word = re.match(r"\w*", m[3])[0]
        lower = not re.match(r"(?:Picture|I\b|<)", m[3]) and (listed(word) or not m[4] and common(word))
        following = m[3][0].lower() + m[3][1:] if lower else m[3]
        return m[1] + re.sub(r"\s+style$", "", m[2].strip()) + ", " + following
    parts = re.split(r'(<d>[\s\S]*?</d>|"[^"\n]*"|“[^”\n]*”)', str(text or ""))
    for i in range(0, len(parts), 2):
        part = re.sub(r"\b(\d+)(?:st|nd|rd|th)\b", ordinal, parts[i])
        part = re.sub(r"(\[Shot 1\] )([^.;:\n\[]{2,60}?)[.;:][ \t]+(\S+)(?=([ \t]+[A-Z])?)", opening, part) if opening_style else part
        part = re.sub(r"(\[Shot [2-9]\d*\] At \d{2}:\d{2}\.\d{3}, )cuts? to\b", r"\1the camera cuts to", part)
        # "<Subject 1>，一位…的男性角色，站在…" came back as "At <Subject 1>, a male character …": the tag opens the sentence.
        part = re.sub(r"\bAt (<Subject [1-9]\d*>), (?=(?:a|an|the) )", r"\1, ", part)
        # "The character <Subject 1> takes half a step", "The man in <Subject 2>, with black hair": the tag is the subject's
        # name; "the man in <Subject 3>'s armor" wears it.
        part = re.sub(r"\b[Tt]he (?:(?:male |female |young |old )?(?:character|figure|subject|warrior|man|woman) )?(<Subject [1-9]\d*>)", r"\1", part)
        part = re.sub(r"\b[Tt]he (?:male |female |young |old )?(?:character|figure|subject|warrior|man|woman) in (<Subject [1-9]\d*>)(?!['’]s)", r"\1", part)
        # "<Subject 1> 另一只手松开枪柄" came back as "<Subject 1> The other hand releases": the limb is the subject's.
        part = re.sub(r"(<Subject [1-9]\d*>) (?:The|A|An|One) ((?:other |same |two |both )?(?:hand|arm|foot|leg|paw|shoulder|eye)s?)\b", r"\1's \2", part)
        parts[i] = re.sub(r"(?m)^(<Subject [1-9]\d*>(?: \(S\d+\))?:[ \t]*)(?!(?:A|An|The)\b)([A-Z][a-z]+)(?= [a-z]|,)",
                          lambda m: m[1] + ("an " if m[2][0] in "AEIOU" else "a ") + m[2].lower() if common(m[2]) else m[0], part)
    text = "".join(parts)
    # A definition or retention line is one noun phrase (official ref §2.1): "…, wears armor …, and holds a spear" reads
    # "wearing …, and holding …"; "beast head -shaped" is "beast-head-shaped".
    participle = {"wears": "wearing", "holds": "holding", "carries": "carrying", "wields": "wielding", "grips": "gripping", "has": "with"}
    text = re.sub(r"(?m)^<Subject [1-9]\d*>[^\n]*$", lambda m: re.sub(r"(?<=, )((?:and )?)(wears|holds|carries|wields|grips|has)\b",
                                                                        lambda w: w[1] + participle[w[2]], m[0]), text)
    text = re.sub(r"(?<=[A-Za-z]) +-(?=shaped\b|like\b)", "-", text)
    if not opening_style:
        # 多参's style sentence: "The target video is in a 3D CG style" (official ref §5.2), not "The video is rendered in".
        text = re.sub(r"(?m)^(detailed_description:\n)(?:The|This) (?:target )?video (?:is (?:rendered |presented |shown |done |set |created |made )?in|adopts|uses|employs|features|has|is)\b ?",
                      r"\1The target video is in ", text)
    return text


def subject_pronouns(english, display):
    """The translator guesses pronouns a few sentences at a time ("<Subject 2> turns her body, her beard trembling" for a
    bearded man): a sentence or clause about subjects of one sex, as the Chinese definitions name them, takes theirs; a
    robot or an animal without one is "it" ("strokes the cat with her left hand" for a robot)."""
    sex = {}
    # The definitions come first; the retention lines after them name no sex. Only the head noun makes a robot or an
    # animal ("<Picture 1> 中的机器人，…"); a warrior in 机械铠甲 riding a 白马 is no "it".
    head = lambda text: re.split(r"[，,；;]", re.sub(r"^\s*<Picture [1-9]\d*>\s*中的?", "", text))[0]
    for m in re.finditer(r"(?m)^(<Subject [1-9]\d*>)\s*[:：](.*)$", str(display or "")):
        sex.setdefault(m[1], "m" if "男" in m[2] and "女" not in m[2] else "f" if "女" in m[2] and "男" not in m[2] else "n" if "男" not in m[2]
                       and "女" not in m[2] and re.search(r"机器人|机械|机甲|猫|狗|犬|鸟|鱼|马|兔|熊|龙|蛇|狐|狼|虎|狮|鹿|动物|宠物|怪兽", head(m[2])) else "")
    # "her" before its noun is a possessive ("her tail"); before an adverb, a particle or the verb it is made to do
    # ("holds her close", "lifts her up gently", "making her purr") it is the object.
    possessive = (r"(?<!\bmake )(?<!\bmakes )(?<!\bmaking )(?<!\bmade )(?<!\blet )(?<!\blets )(?<!\bletting )\b([Hh])er(?=\s+(?!(?:and|as|or|with|in|on"
                  r"|at|to|from|while|who|that|the|a|an|up|down|close|closer|back|away|again|off|out|over|around|aside|forward|tight|still"
                  r"|(?!(?:belly|family|lily|jelly|butterfly)\b)[a-z]+ly)\b)[a-z])")

    def clause(m):
        kinds = {sex.get(label, "") for label in re.findall(r"<Subject [1-9]\d*>", m[0])}
        text = m[0]
        # "<Subject 1> shifts its body": a person's body part is theirs, unless something else was named since the subject
        # ("strokes the white horse beside him as its body shivers" is the horse's).
        body = r"\b([Ii])ts (?=(?:body|face|arms?|hands?|feet|legs?|shoulders?|torso|chest|waist)\b)"
        theirs = lambda n, word: n[0] if re.search(r"\b(?:the|a|an|this|that|another)\s", re.split(r"<Subject [1-9]\d*>", n.string[:n.start()])[-1], re.I) else (
            ("H" if n[1] == "I" else "h") + word + " ")
        if kinds == {"m"}:
            text = re.sub(body, lambda n: theirs(n, "is"), text)
            text = re.sub(r"\b([Ss])he\b", lambda n: "H" + "e" if n[1] == "S" else "he", text)
            text = re.sub(r"\bherself\b", "himself", text)
            text = re.sub(possessive, lambda n: n[1] + "is", text)
            text = re.sub(r"\bher\b", "him", text)
        elif kinds == {"f"}:
            text = re.sub(body, lambda n: theirs(n, "er"), text)
            text = re.sub(r"\b([Hh])e\b", lambda n: ("S" if n[1] == "H" else "s") + "he", text)
            text = re.sub(r"\bhimself\b", "herself", text)
            text = re.sub(r"\b([Hh])is\b|\bhim\b", lambda n: (n[1] or "h") + "er" if n[1] else "her", text)
        elif kinds == {"n"}:
            text = re.sub(r"\b(?:her|him)self\b", "itself", text)
            text = re.sub(possessive + r"|\b[Hh]is\b", lambda n: ("I" if n[0][0].isupper() else "i") + "ts", text)
            text = re.sub(r"\b(?:[Ss]he|[Hh]e|[Hh]er|[Hh]im)\b", lambda n: "It" if n[0][0].isupper() else "it", text)
        return text
    parts = re.split(r'(<d>[\s\S]*?</d>|"[^"\n]*"|“[^”\n]*”)', str(english or ""))
    return "".join(part if i % 2 else re.sub(r"[^.;\n]+[.;]?", clause, part) for i, part in enumerate(parts))


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
# A spoken line in the fields: 女孩 (S1) 说：<d>[Chinese] 你好。</d>.
DIALOGUE_LINE = r"[（(](S[1-9]\d*(?:\s*,\s*S[1-9]\d*)*)[）)]\s*[^<\n]{0,12}?\s*<d>\s*(\[[A-Za-z ]+\])?\s*([\s\S]*?)</d>"
# Speech the user wrote without a line of its own: 并说：“出发吧。”, 喊道“冲啊！”, 女孩(S1)说：“你好。”;
# not the quoted title after 小说/传说/听说/据说/解说.
UNLABELLED_SPEECH = r'(?:[（(](S[1-9]\d*)[）)]\s*)?(?<![小传听据解])(说道?|喊道?|大喊|叫道|问道?|答道|回答|回应|低语|念道)\s*[:：,，]?\s*[“"「]([^”"」\n]+)[”"」]'
# Words before a speaking verb that name nobody: connectors and counters ("然后", "一只").
SPEECH_LEAD = r"^(?:然后|接着|随后|随即|之后|于是|最后|最终|同时|又|再|并|还|也|便|就|一只|一个|一位|一名|那只|这只|那个|这个)+"


def speech_name(words):
    """The subject a speaking clause names ("店员又" -> 店员, "机器人抬头" -> 机器人); '' for one that
    only acts or points back ("然后转身", "她又", "笑着", "小声")."""
    head = re.sub(SPEECH_LEAD, "", str(words or "").strip(" ，,"))
    name = re.match(rf"[㐀-鿿]{{2,6}}?(?={NAME_END}|$)", head)
    return "" if not name or re.match(rf"[他她它]|{NAME_END}", head) or re.search(r"[声地着]$", name[0]) else name[0]


def label_speech(text, taken=()):
    """Unlabelled speech becomes its own (Sn)："…" line; the speaking verb stays in the action. A
    speaker keeps one ID (official base §4.4): a clause naming nobody new ("然后转身说", "她又说") is
    the last speaker's, a line labelled before it in taken or the text included; a name met before
    keeps its ID ("女孩 (S1) 说", "店员又说"); "(S1)说" keeps the ID written there; words taken
    already has as a line are not told twice."""
    text, lines, taken = str(text or ""), [], "\n".join(taken)
    number = max([int(n) for n in re.findall(r"\bS([1-9]\d*)\b", text + "\n" + taken)] + [0])
    bare = lambda words: re.sub(r"[。！？!?.…]+$", "", words.strip())
    said = lambda source: sorted((m for pattern in (SPEECH_LINE, DIALOGUE_LINE) for m in re.finditer(pattern, source)), key=lambda m: m.end())
    known = {bare(m[3]): m[1] for m in said(taken)}
    labelled = [(m.end(), m[1]) for m in said(text)]
    speaker = ([m[1] for m in said(taken)] or re.findall(r"\bS[1-9]\d*\b", taken) or [""])[-1]
    names, done = {}, [0]
    for m in re.finditer(r"([^\s，,。！？；;”」>\"]+)[ \t]*[（(](S[1-9]\d*)[）)]", taken + "\n" + text):
        if speech_name(m[1]):
            names.setdefault(speech_name(m[1]), m[2])

    def take(match):
        nonlocal number, speaker
        before = text[:match.start()]
        speaker = ([ids for end, ids in labelled if done[0] <= end <= match.start()] or [speaker])[-1]
        done[0] = match.end()
        # The subject of the clause before the verb, else of its sentence ("店员接过杯子，对顾客说").
        name = speech_name(re.split(r"[，,。！？；;\n”」>]", before)[-1]) or speech_name(re.split(r"[。！？；;\n”」>]", before)[-1])
        same = next((names[known_name] for known_name in names if name and (known_name in name or name in known_name)), "")
        told = known.get(bare(match[3]), "")
        if match[1] or told or same:
            speaker = match[1] or told or same
        elif not speaker or name and speaker in names.values():
            number += 1
            speaker = f"S{number}"
        if name:
            names.setdefault(name, speaker)
        if told:
            # "说“你好。”时要微笑" for a line the source already has.
            return match[0]
        lines.append(f'({speaker})："{match[3].strip()}"')
        # "说：“你好。”然后又说" keeps its clauses apart: "说，然后又说".
        return match[2] + ("，" if re.match(r"[^\s，,。！？；;!?、)）]", text[match.end():match.end() + 1]) else "")
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
    # "挥手并说：“出发吧。”" is a spoken line too, read in order with the labelled ones; the program keeps its words.
    text, unlabelled = label_speech(text)
    text = re.sub(DIALOGUE_LINE, speech, text)
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
        if label.startswith('<Subject ') and not str(item.get('keep') or '').strip() and str(item.get('description') or '').strip():
            # A planner that leaves out what a picture keeps keeps what it describes; the retention line needs one.
            item['keep'] = str(item['description']).strip()
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
        description = item["description"].strip()
        head = re.split(r"[，,；;。]", description)[0]
        if (len(item["sources"]) == 1 and item["sources"][0].startswith("<Picture ") and not re.search(r"<(?:Picture|Video|Audio) ", description)
                and re.fullmatch(HAN + r"{1,10}", head) and not re.search(r"的|穿|戴|持|拿|握|着|借用|仅|画风|风格", head)):
            # "<Subject 1> is the man in <Picture 1>, with ..." (official ref §2.1): what the picture shows, no age guess.
            definitions.append(label + ": " + item["sources"][0] + " 中的" + re.sub(r"^(?:一只|一个|一位|一名|一头|一条|一匹)", "", description))
        else:
            definitions.append(label + ": " + description + origins)
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
    return reference_layout(validate_reference(json.dumps(result), requirements, duration))


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
    fields["detailed_description"] = check_shots(fields["detailed_description"], duration, fill=True)
    return "\n\n".join(k + ":\n" + fields[k].strip() for k in REFERENCE_FIELDS)


def retention_appearances(text):
    """"<Subject 1> (appears in [Shot 1], [Shot 2]): fully_preserved - …" (official ref §4): each retained item says
    which shots show it, read from detailed_description."""
    text = str(text or "")
    field = lambda name: rf"(?ms)^({name}:\n)(.*?)(?=\n\n[a-z_]+:\n|\Z)"
    description = re.search(field("detailed_description"), text)
    shots = re.split(r"(?=\[Shot [1-9]\d*\])", description[2]) if description else []

    def mark(match):
        seen = [shot[6:shot.index("]")] for shot in shots if shot.startswith("[Shot ") and match[1] in shot]
        return match[1] + (" (appears in " + ", ".join(f"[Shot {n}]" for n in seen) + ")" if seen else "") + ":"
    return re.sub(field("retention_analysis"), lambda block: block[1] + re.sub(r"(?m)^(<(?:Subject|Video|Audio) [1-9]\d*>):", mark, block[2]),
                  text, count=1)


# A 多参 shot with no sound line: the sounds of what its scene and actions show, never a generic placeholder; whole
# words, so 风格 is no wind and 指甲 no armour.
ACTION_SOUNDS = ((r"走(?!廊|道)|迈步|踱步|脚步", "脚步声"), (r"跑|奔|冲刺", "急促的脚步声"), (r"跳|跃|落地", "落地的轻响"),
                 (r"铠甲|盔甲|甲胄|甲片|战甲|护甲", "甲片碰撞声"), (r"剑|刀|枪|戟|矛|兵器", "兵器的金属轻响"),
                 (r"披风|斗篷|衣袂|衣摆|长袍|裙", "衣料摆动声"), (r"微风|清风|寒风|狂风|大风|风吹|随风|迎风|刮风|风中", "风声"),
                 (r"浇|洒水(?!壶)|溅|流水|水流|水花|雨|溪|河|海|浪", "水声"), (r"翅膀|振翅|飞翔|飞起|飞过|飞向", "振翅声"),
                 (r"开门|关门|推门", "开门声"), (r"鸟", "鸟鸣"))


def action_sounds(text, clothed=True):
    """The scene and action sentences only: the style sentence ("视频采用写实电影风格") names no sound. The shot's own
    sounds come first, in the order they happen ("铜色关节发出咔哒轻响"); cloth rustles only on a clothed subject."""
    text = "".join(s for s in re.findall(r"[^。！？!?\n]+[。！？!?\n]?", str(text or "")) if not re.search(r"风格|画风", s))
    # "…，发出细微呼噜声" lost its subject with its clause: the sound itself is kept ("细微呼噜声").
    heard = [re.sub(r"<Subject [1-9]\d*>\s*|[“”\"]|^\s*(?:发出|传来|响起)", "", c).strip() for c in re.findall(r"[^，,。；;！？!?\n]*(?:声|响)[^，,。；;！？!?\n]*", text)
             if not re.search(r"无声|悄无声息|默不作声|声音[^，,。；;]{0,4}说", c)]
    found = [sound for sound in dict.fromkeys(sound for words, sound in ACTION_SOUNDS if re.search(words, text)) if sound[:2] not in "".join(heard)]
    if heard:
        heard = list(dict.fromkeys(heard))[:3]
        if len(heard) == 1 and not found:
            return sound_sentence(heard[0])
        return "，".join(heard) + ("，伴随着" + "和".join(found[:3 - len(heard)]) if len(heard) < 3 and found else "") + "。"
    found = found[:3]
    # Sounds heard together, as sound_sentence writes them ("... can be heard" read as a meta frame).
    return sound_sentence("、".join(found)) if found else "动作带起轻微的衣料摩擦声。" if clothed else "动作带起轻微的声响。"


def reference_layout(text):
    """The official 多参 layout of detailed_description (official ref §5.2): one line per shot, no blank
    lines, a style sentence before [Shot 1] on its own line. Only for the text the program writes or
    translates: validate_reference keeps the layout it is given, like the renderer's validateReference."""
    def layout(match):
        lead, mark, rest = match[2].partition("[Shot 1]")
        shots = [re.sub(r"(?<=[。！？；，])[ \t]+(?=<)", "", one_paragraph(shot)) for shot in re.split(r"\s*(?=\[Shot (?:[2-9]|[1-9]\d+)\])", mark + rest) if shot.strip()]
        return match[1] + "\n".join(([one_paragraph(lead)] if lead.strip() else []) + shots)
    return re.sub(r"(detailed_description:\n)([\s\S]*?)(?=\n\noverall_soundscape:)", layout, str(text or ""), count=1)


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
     "leak": r"胸肩(?:随呼吸|起伏)|呼吸待机|仅呼吸", "label": "呼吸待机、胸肩起伏"},
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
# Effects an answer made up on an object or a stroke ("金色刀光", "刀身光晕渐次明灭"): they change what the user's
# thing looks like; the user's own light, fire or effect keeps them. Light of the scene (灯光, 光斑, 光束) is atmosphere.
LIGHT_EFFECTS = r"刀光|剑光|寒光|金光|光晕|光圈|光环|光带|光轨|光弧|光痕|流光|光效|辉光|拖尾|残影"
USER_LIGHT = r"光|亮|闪|辉|灯|霓虹|火|焰|电|特效"
# Particles and effects slow down; they do not freeze mid-air ("光粒飘落定格").
EFFECT_SUBJECT = r"光|粒|烟|雾|尘|火|焰|花瓣|落叶|雪|雨|水花|特效"
# H3 lip-syncs from 【台词】 itself; a mouth the answer describes may not exist (a robot's visor).
MOUTH = r"(?:微微|轻轻)?(?:张开|微张|张|开合|轻启)?(?<![壶瓶烟喷奶油])(?:嘴巴|嘴唇|嘴角|双唇|唇部|唇瓣|口型|口部|嘴)|[开张]口(?=说|讲|道)"
SPEAKING = r"说|讲|台词|念"
# A mouth doing something else than speaking: a smile, a spout at the lips, eating or drinking.
MOUTH_OTHER = r"嘴角|嘴边|唇边|喝|饮|啜|吃|咬|嚼|吞|舔|吹|叼|衔|吻|亲|笑|哈欠"
SPEAK_STEPS = ("开始说话", "继续说话", "说完这句话")
# Age words the user did not give: "她" is a woman in the picture, not a 女孩 the writer guessed. A child the user
# names (孩子, 女童, 小朋友, 七岁, a kid) is no such guess.
AGE_NOUNS = (r"女孩|男孩|少女|少年|孩|童|婴|幼|宝宝|小朋友|[小中]学生|[初高]中生|(?<![0-9])(?:1[0-7]|[0-9])\s*周?岁"
             r"|(?<![十百千万两零〇二三四五六七八九])(?:[一二三四五六七八九两几]|十[一二三四五六七几]?)[一二三四五六七八九]?\s*周?岁"
             r"|\b(?:kids?|child(?:ren)?|bab(?:y|ies)|toddlers?|infants?|girls?|boys?)\b")
# Times of day: the writer may light the scene as it likes, but never at another time than the user's words say
# ("夜晚的厨房" lit by "午后阳光"); weather against the user's clear sky likewise.
LOOK_TIMES = (r"白天|白昼|阳光|日光|烈日|正午|中午|午后|清晨|早晨|朝阳|晨光|晴空|晴朗|晴天", r"黄昏|傍晚|夕阳|落日|日落|晚霞|余晖",
              r"夜|月光|月色|星空|星光")
LOOK_WEATHER = r"雨(?![林衣伞靴])|(?<![白])雪(?![白糕碧])|雾(?!面)"
# Music is non-diegetic: in the picture's own sentences only when the user asked for it. Sounds of the actions and the
# place belong there (official base §4.1: diegetic audio along the timeline).
MUSIC_WORDS = r"音乐|配乐|乐曲|旋律|伴奏|BGM"
CAMERA_WORD = r"镜头|机位|运镜|摄像机|相机"
CAMERA_MOVES = (("fixed", r"固定|静止|不动|锁定"), ("follow", r"跟随|跟拍|跟踪|追随"), ("in", r"推近|推进|拉近|推向|推至"),
                ("out", r"拉远|拉开|后拉|拉出|后撤|拉至"), ("orbit", r"环绕|绕着|绕行"), ("pan", r"平移|横移|摇"),
                ("rise", r"升起|上升|下降|俯冲|升高|降低|上移|下移"))


# The camera as the one that moves: not "面向镜头后撤一步", "对着镜头把手下移" or "镜头前…".
CAMERA_AS_SUBJECT = rf"(?<![向朝对冲])(?<!对着)(?<!朝着)(?<!看着)(?<!望着)(?:{CAMERA_WORD})(?!前(?!推)|[里中内外])"


def camera_moves(text):
    """Camera moves a clause gives the camera itself (a subject walking toward the camera is not one)."""
    return {name for name, move in CAMERA_MOVES
            if re.search(rf"{CAMERA_AS_SUBJECT}[^，,。；;\n]{{0,10}}?(?:{move})|(?:{move})的?(?:{CAMERA_WORD})", str(text or ""))}


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


def look_contradicts(clause, user_text):
    """Light or weather the writer adds that goes against the user's words: another time of day than the one the
    user names ("阳光洒进" in "夜晚的厨房"), or rain, snow or fog under the user's clear sky. Any other light,
    colour or weather the writer adds is atmosphere and stays."""
    asked = [i for i, words in enumerate(LOOK_TIMES) if re.search(words, user_text)]
    other = any(re.search(words, clause) for i, words in enumerate(LOOK_TIMES) if asked and i not in asked)
    return other or bool(re.search(r"晴", user_text) and re.search(LOOK_WEATHER, clause))


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
    """One readable paragraph: no list marks, quote marks or copied time ranges. A decoding loop is gone: a stutter
    ("竖琴与竖琴与竖琴与…" to the token limit, never a laugh or a drum the user wrote, "哈哈哈哈哈哈") ends the line where it
    starts, a clause written three times over is said once (twice may be the user's own repeat)."""
    lines = []
    for line in str(value or "").splitlines():
        line = re.sub(r"^[ \t>#*\-•]+", "", line).strip()
        line = re.sub(r"^[（(]?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—~～至]\s*\d+(?:\.\d+)?\s*(?:s|秒)[）)]?\s*[:：，,]?\s*", "", line, flags=re.I)
        line = re.sub(r"([㐀-鿿]{1,4}?)\1{14,}.*$", "", line)
        line = re.sub(r"([㐀-鿿，,、]{5,40}?)\1{2,}", r"\1", line)
        if line:
            lines.append(line if re.search(r"[。！？!?；;…，,、：:][”’」]?$", line) else line + "。")
    keys = [compact(clause) for clause in re.findall(r"[^，,。！？；;!?\n]*[，,。！？；;!?\n]?", "".join(lines)) if clause]
    seen = set()

    def once(clause):
        key = compact(clause)
        repeated = len(key) >= 6 and key in seen and keys.count(key) >= 3
        seen.add(key)
        return repeated
    return drop_clauses("".join(lines), once) if lines else ""


# Who performs in a score ("小女孩轻声哼唱", "a little girl sings") and what makes one (an instrument, a kind, a voice).
PERFORMER = (r"[人男女孩童娃婴歌唱哼吟嗓]|(?<![a-z])(?:girls?|boys?|child(?:ren)?|kids?|m[ae]n|wom[ae]n|lad(?:y|ies)|singers?|voices?"
             r"|vocals?|sings?|singing|sung|hums?|humming|choirs?|chant(?:s|ing)?)(?![a-z])")
SCORE_WORDS = (r"[琴笛鼓筝箫琶胡号管锣钹钟铃埙笙磬弦唱]|吉他|唢呐|贝斯|合成器|电子|爵士|摇滚|交响|乐团|乐队|旋律"
               r"|(?<![a-z])(?:piano|guitars?|violins?|cellos?|strings|drums?|flutes?|harps?|synth\w*|bass|choirs?|vocals?)(?![a-z])")


def plain_music(text, sung=False, asked=""):
    """The score's instruments, tempo and dynamics, never what it is for ("营造出宁静的氛围", official base §4.7) or what it is
    like ("音符如光点般流转", "节奏舒缓如呼吸"; "音量如常" is no simile, nor "佛像前的铜铃"). An instrument written twice
    ("竖琴与竖琴弦音") is one. Unless sung, a clause with a performer the user's own music (asked) does not name goes
    ("小女孩低声清唱", "a little girl sings"; "童声合唱" stays for "配上童声合唱"): the writer is asked for instruments, and a
    singer is a person nobody checked. A score left with no instrument, kind or voice is none (""). The sound line
    (sung=True) keeps its voices."""
    text = re.sub(r"[如像][^，,。；;如像]{1,6}般地?|(?<=[㐀-鿿])(?<![佛雕石塑画人录偶影图镜肖神铜头想例比假譬])[如像](?![常一初故旧此今下何])"
                  r"[^，,。；;]{1,6}(?=[，,。；;]|$)", "", str(text or ""))
    text = re.sub(r"([㐀-鿿]{2,3})[与和及、](?=\1)", "", text)
    if not sung:
        text = drop_clauses(text, lambda clause: any(m[0].lower() not in str(asked or "").lower() for m in re.finditer(PERFORMER, clause, re.I)))
        if not re.search(SCORE_WORDS, text, re.I):
            return ""
    moodless = drop_clauses(text, lambda clause: re.search(r"^\s*[如像]|营造|氛围|烘托|情绪|心情|模拟|仿佛|宛如|犹如|好似|如同", clause))
    return moodless if re.search(r"[㐀-鿿A-Za-z]", moodless) else text


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


def drop_sentences(text, drop):
    """drop_clauses for whole sentences: no subjectless fragment of a dropped sentence stays behind."""
    return "".join(s for s in re.findall(r"[^。！？!?\n]*[。！？!?\n]?", str(text or "")) if s and not drop(s)).strip()


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
    """With dialogue, mouth clauses that speak become plain speaking steps; H3 lip-syncs from 【台词】. A smile
    (嘴角上扬), the mouth a spout is brought to (凑到嘴边), eating, drinking or a yawn keep their own words."""
    clauses = [c for c in re.findall(r"[^，,。！？；;!?\n]*[，,。！？；;!?\n]?", str(phase or "")) if c]
    result, carry = [], ""
    near = lambda i: "".join(clauses[max(i - 1, 0):i] + clauses[i + 1:i + 2])
    speaks = lambda i, clause: (re.search(SPEAKING + r"|开口", clause) or not re.search(MOUTH_OTHER, clause)
                                and re.search(r"张|开合|启|动|翕|嚅", clause) and not re.search(r"喝|饮|啜|吃|咬|嚼|哈欠", near(i)))
    for i, clause in enumerate(clauses):
        if not re.search(MOUTH, clause) or not speaks(i, clause):
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
# The writer's background music line: 配乐：…
MUSIC_LINE = r"(?m)^[ \t>#*\-•]*【?(?:配乐|背景音乐)】?[ \t]*[:：][ \t]*(.*)$"
# "保持橘猫外观一致", "动作连贯": talk about consistency, nothing visible (official rule).
GENERIC_CONSTRAINT = r"(?:身份|外观|形象|样貌|造型)[^，,。；;]{0,8}(?:一致|不变|统一)|^(?:保持)?动作(?:连贯|流畅|自然|衔接)[^，,。；;]{0,4}[。]?$"
# "温室背景不变": a statement that nothing changes, unless the user asked for it.
UNCHANGED_SETTING = r"(?:背景|场景|环境)[^，,。；;]{0,6}(?:保持)?(?:不变|固定不动)"
# "准备切换": an editing note, not something on screen.
CUT_NOTE = r"准备切换|切换前|即将切换|等待切换"
# A limit in the user's own words ("背景保持不变", "不要音乐"). Only such limits stay as constraints: the
# writer's own "猫始终在窗台上" or "权杖角度全程不变" contradicts the action it describes.
USER_LIMIT = (r"始终|一直|全程|保持|不变|不动|静止|固定|不要|不用|不得|不能|不可|禁止|避免|别(?=让|动|切|加|用|出现|改|变|晃)|勿|无需|不需要"
              r"|不许|不准|(?<![一二两三四五六七八九十几每这那哪多单])只|仅|不加|不添加|不出现|不改"
              # A wish is a limit too: "背景要纯白", "衣服是红色".
              r"|要|须|[是为](?:纯|全)?[白黑红绿蓝黄灰紫粉橙棕金银]色?")
# A limit written in English ("Keep the background unchanged", "do not add any text") shares no
# characters with the writer's Chinese wording of it.
USER_LIMIT_EN = r"\b(?:keep|keeps|always|remains?|stays?|unchanged|constant|only|never|avoid|without|no|not|don't)\b"
LIMIT_CHARS = set("始终一直全程保持不变动静止固定要用得能可禁避免别勿无需只仅许准加添出现改和与及的了在是也都或")
# "画面保持静止" in the middle of the action: nothing on screen stops.
FROZEN_PICTURE = r"^\s*(?:整个|整体)?(?:画面|场景|一切)(?:随即|随后|最终|最后|随之)?(?:保持|维持|归于|回归|陷入|趋于)?(?:静止|定格|不动|原状|原样)"
PHASE_NOTE = r"(?:仍|还|尚)?(?:未|没有)(?:完成|结束|扩散)|(?:全程|始终|一直)(?:保持)?不变|保持不变[。，,；;]?$|(?:均|都|全都)(?:维持|保持)在"
STALE_HOLD = r"(?:仍然?|依然|依旧)?(?:保持|维持)[^，,。；;]{0,6}(?:姿态|姿势)"
# The user's own freeze frame or still ending ("最后画面定格在她的笑脸", "结尾画面静止两秒") stays.
USER_FROZEN = r"定格|(?:画面|场景|一切)[^，,。；;\n]{0,6}?(?:静止|不动)"
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
    """"A声，B轻响" reads as one sentence of sounds heard together, the footsteps and the armour of one walk: "A声伴着B轻响。"
    (English "A ... accompanied by B ..."); a list says no order, so never "随后", and never "可以听到…" ("... can be heard")."""
    clauses = [c.strip() for c in re.split(r"[，,、；;]", re.sub(r"[。.！!]+$", "", str(text or "").strip())) if c.strip()]
    if (not clauses or re.search(r"[。.！!？?]", "".join(clauses)) or not all(re.search(rf"(?:{SOUND_NOUN})$", c) for c in clauses)
            or re.search(r"发出|传来|响起|作响|回荡|听到|听见", "".join(clauses))):
        return text
    if len(clauses) == 1:
        return clauses[0] + "响起。"
    return clauses[0] + "伴着" + ("、".join(clauses[1:-1]) + "和" if len(clauses) > 2 else "") + clauses[-1] + "。"


# Where a speaker talks; the line goes after that sentence.
SPEAK_AT = r"说|讲|台词|念|回答|回应|答道|问道|喊|开口|打招呼"
# The words that end a speaker's name at the start of a sentence ("女孩抬起右手" -> 女孩; "橘猫打了个哈欠" -> 橘猫, never
# "橘猫打了个哈").
NAME_END = r"[在从向朝把将对给抬举挥转走跑跳看望站坐蹲躺趴伸弯低点摇笑开说回停放拿握拍迈俯仰侧背面微轻缓慢快迅猛突再又也正都仍继已便就随同和与跟用以被让使闭睁眯眨打张咬吃喝啃抱捧叼推拉扔踢，,。！？]"


def speaker_name(sentence, user_text):
    """The subject a speaking sentence opens with, when the user's own words name it too."""
    head = re.sub(r"^(?:一只|一个|一位|一名|那只|这只|那个|这个)", "", sentence.strip())
    name = re.match(rf"[㐀-鿿]{{2,6}}?(?={NAME_END})", head)
    if name and name[0] in user_text:
        return name[0]
    return next((head[:n] for n in (4, 3, 2) if re.fullmatch(r"[㐀-鿿]+", head[:n]) and head[:n] in user_text), "")


def writer_name(sentences, known):
    """The subject a sentence of the answer opens with ("机器人右臂缓慢抬起" -> 机器人), when the answer's
    overview or the user's words name it too; the nearest sentence first."""
    for sentence in reversed(sentences):
        head = re.sub(r"^(?:然后|接着|随后|同时|最后|一只|一个|一位|一名|那只|这只)+", "", sentence.strip())
        # A name ends before the verb or preposition after it ("橘猫在窗台上" -> 橘猫).
        head = head[:next((k for k, ch in enumerate(head) if k and re.match(NAME_END, ch)), len(head))]
        name = next((head[:n] for n in range(min(6, len(head)), 1, -1)
                     if re.fullmatch(HAN + "+", head[:n]) and head[:n] in known and not re.match(r"画面|镜头|场景|背景|动作|身体|手|头", head[:n])), "")
        if name:
            return name
    return ""


# The user's own actions: each verb of the user's clause (挥 of 挥手, 回 of 回头) or action word (哈欠) is
# written as that action, in any of the characters or words that write it; a later clause ("跳上桌子后回头") comes after.
ACTION_VERBS = {
    "挥": "挥摆招", "摆": "摆挥摇晃甩", "招": "招挥", "抬": "抬举扬", "举": "举抬扬", "扬": "扬抬举", "回": "回转扭",
    "转": "转回扭旋", "扭": "扭转回", "摇": "摇晃摆", "点": "点", "仰": "仰抬", "看": "看望瞧盯视瞥瞄注凝目", "望": "望看视眺目",
    "盯": "盯看视注凝", "眨": "眨", "眯": "眯", "睁": "睁张", "闭": "闭合", "笑": "笑", "哭": "哭泣", "跳": "跳跃蹦腾",
    "跃": "跃跳蹦", "蹦": "蹦跳跃", "扑": "扑", "冲": "冲奔跑", "跑": "跑奔冲", "奔": "奔跑冲", "走": "走行迈踱步",
    "迈": "迈走踏", "踢": "踢", "爬": "爬攀", "攀": "攀爬", "滚": "滚翻", "翻": "翻滚", "躺": "躺卧", "趴": "趴伏卧",
    "卧": "卧趴伏躺", "坐": "坐", "蹲": "蹲", "跪": "跪", "站": "站立起", "伸": "伸展", "弯": "弯俯", "抱": "抱拥搂",
    "拥": "拥抱搂", "握": "握持拿抓执", "拿": "拿持握抓取抽掏","抓": "抓握拿", "捧": "捧", "推": "推", "拉": "拉拽",
    "扔": "扔抛投掷", "抛": "抛扔投掷", "接": "接", "递": "递", "拍": "拍", "敲": "敲", "砍": "砍劈斩", "劈": "劈砍斩",
    "刺": "刺戳", "飞": "飞翔飘", "舔": "舔", "咬": "咬", "吃": "吃", "喝": "喝饮", "亲": "亲吻", "吻": "吻亲", "甩": "甩", "浇": "浇洒",
}
# Action words that are nouns, with the words that write them too (伸懒腰 is 舒展 as well).
ACTION_WORDS = {"哈欠": ("哈欠",), "懒腰": ("懒腰", "伸展", "舒展"), "鞠躬": ("鞠躬", "躬身", "弯腰"), "行礼": ("行礼", "抱拳", "作揖"),
                "抱拳": ("抱拳", "拱手", "作揖"), "睁开": ("睁", "张开", "睑轻启", "睑微启", "帘轻启", "帘微启", "眸轻启", "眸微启"),
                "面对面": ("面对面", "相对", "对视"), "喷嚏": ("喷嚏",)}
ACTION_TOKEN = "|".join(ACTION_WORDS) + r"|[" + "".join(ACTION_VERBS) + "]"
# Words with a verb character that name no action, in the user's words and in the answer ("直接", "来回", "视角").
ACTION_NOUNS = (r"背景|手指|指尖|落叶|角落|落地窗|飞机|飞快|光点|地点|重点|终点|点缀|站台|车站|坐垫|转场|回声|回应|回答|回复|回忆|拉链|推车|放大|放慢|放心"
                r"|看台|看起来|看上去|希望|愿望|走廊|走道|跑道|拍摄|[一有快慢点]点儿?|点儿|直接|间接|连接|衔接|紧接|摆放|摆设|吃惊|亲切|亲自|拥挤|拥有|坐落"
                r"|来回|视角|视野|视觉|透视|注意|看似|好看|目标")
ACTION_SEQUENCE = r"然后|接着|随后|之后|以后|随即|最后|最终|再|(?<=[㐀-鿿])后(?=[" + "".join(ACTION_VERBS) + "])"
# The part a verb of the user's clause moves (挥手, 回头): the answer writes the verb with that part.
ACTION_PART = r"[手头身腰尾眼腿脚拳]"
# "不要回头", "别挥手": an action the user rules out is none ("不停地挥手" is one).
ACTION_NEGATED = r"(?:(?<!特)别|不(?![停断住时禁由动])|没|勿|禁止|避免|无需|停止)[^，,。；;]{0,3}$"
# Things an action lands on or goes into ("跳上旁边的椅子" -> 椅子, after the user's own "旁边的" or "一张");
# "坐在椅子上" says where the subject already is.
ACTION_PLACE = (r"(?:([跳爬登跃攀落放钻])(?:上|到|进|在|入)|([坐躺趴站蹲走])(?:上|到|进|入))了?((?:[一这那][张把个只块座条间辆扇]|[㐀-鿿]{1,4}?的)?)"
                r"([㐀-鿿]{2,3}?)(?=[上里中边前旁面顶内，,。；;！!？?\n后]|$)")
# Water, air, ground, light or a body part is nothing to set up ("跳入水中", "站在阳光下", "落在女孩肩上").
NOT_A_THING = r"^(?:[他她它我你这那]|地面|地板|天空|水面|阳光|月光|镜头|画面|原地)|[上下里中边前后旁内外顶]$|[肩头手背腿脚怀身膝脸腰]"
# The words that reach the thing ("落在桌面上", "坐到椅子上"); "蹲在窗台上" says where the subject already is.
ACTION_LANDS = r"(?:[跳爬登跃攀落钻扑踏走放](?:上|到|进|在|入)|[坐躺趴站蹲停](?:上|到|进|入))了?[^，,。；;！？!?\n]{0,6}$"


def action_text(user_text):
    return re.sub(r"<[^<>\n]*>\s*|@[^\s，,。；;]+\s*|[（(]S[1-9]\d*[）)][^\n]*|“[^”\n]*”|\"[^\"\n]*\"|" + ACTION_NOUNS, "，", str(user_text or ""))


def action_order(user_text):
    """The user's actions split where the user puts one after another ("跳上桌子后回头看镜头" -> 跳上桌子, 回头看镜头)."""
    steps = [re.sub(r"^[，,。；;\s]+|[，,。；;！!？?\s]+$", "", part) for part in re.split(ACTION_SEQUENCE, action_text(user_text))]
    return [step for step in steps if not requested_cut(step)
            and any(not re.search(ACTION_NEGATED, step[:m.start()]) for m in re.finditer(ACTION_TOKEN, step))]


def action_places(user_text, verbs=False):
    """The things the user's actions reach ("跳上桌子后回头" -> 桌子); with verbs, (verb, the user's modifier, thing)."""
    found = [(m[1] or m[2], m[3], m[4]) for m in re.finditer(ACTION_PLACE, re.sub(r"<[^<>\n]*>", "", str(user_text or "")))
             if not re.search(NOT_A_THING, m[4])]
    return found if verbs else [thing for _, _, thing in found]


def place_set_up(thing, text):
    """The thing is shown before an action reaches it ("朝画面前方的桌子跃起，落在桌面上"), not first named by the landing."""
    text = str(text or "")
    at = text.find(thing[0])
    return at >= 0 and not re.search(ACTION_LANDS, text[:at])


def move_toward(texts, verb, modifier, thing):
    """A thing nobody set up is where the first move of its action goes ("朝画面正前方上方跃起" -> "朝桌子跃起")."""
    ways = "|".join(map(re.escape, action_ways(verb)))
    lead = rf"(?=(?:弹|纵身一?|腾空|向上|一)?(?:{ways}))"
    for i, text in enumerate(texts):
        clause = next((c for c in re.findall(r"[^，,。！？；;!?\n]+", text) if re.search(ways, c) and thing[0] not in c), None)
        if clause:
            toward = re.sub(rf"(?:朝|向|往)[^，,。；;]*?{lead}", "朝" + modifier + thing, clause, count=1)
            texts = list(texts)
            texts[i] = text.replace(clause, toward if toward != clause else re.sub(lead, "朝" + modifier + thing, clause, count=1), 1)
            break
    return texts


def action_clauses(user_text):
    """(order index, clause, verb matches) of the user's action clauses; clauses joined by 然后/后/再 get later indexes."""
    for index, segment in enumerate(re.split(ACTION_SEQUENCE, action_text(user_text))):
        for clause in (c.strip() for c in re.split(r"[，,。；;！!？?\n]+", segment)):
            if clause and not camera_moves(clause) and not requested_cut(clause) and not re.search(r"声|音乐|配乐|画风|风格|渲染", clause):
                yield index, clause, [m for m in re.finditer(ACTION_TOKEN, clause) if not re.search(ACTION_NEGATED, clause[:m.start()])]


def action_ways(word):
    return ACTION_WORDS.get(word) or list(ACTION_VERBS.get(word, "")) or [word]


def action_part(clause, token):
    part = clause[token.end():token.end() + 1]
    return part if len(token[0]) == 1 and re.fullmatch(ACTION_PART, part) else ""


def action_at(word, part, text, clause=""):
    """Where the text writes the action, -1 when it does not. A verb that moves a part the user named ("回头") counts
    with that part ("扭过头", "头部缓缓转向"), else in a sentence that names the part ("抬起一只手，缓缓挥动");
    "来回摆动" or "转动耳朵" is no 回头. With the user's clause, a match among its words ("头部转向镜头" for "回头看镜头")
    comes first: "头部转向画面右侧" before the jump is another move."""
    text = re.sub(ACTION_NOUNS + "|接着", lambda m: "，" * len(m[0]), str(text or ""))
    ways = "|".join(map(re.escape, action_ways(word)))
    found = list(re.finditer(rf"(?:{ways})[过向起了]?{part}|{part}[^，,。；;！？!?\n]{{0,6}}?(?:{ways})" if part else ways, text))
    if clause:
        spans = [s for s in re.finditer(r"[^，,。；;！？!?\n]+", text) if han_pairs(s[0]) & han_pairs(clause)]
        own = next((m for m in found if any(s.start() <= m.start() < s.end() for s in spans)), None)
        if own:
            return own.start()
    if found or not part:
        return found[0].start() if found else -1
    sentence = next((s for s in re.finditer(r"[^。！？!?\n]+", text) if part in s[0] and re.search(ways, s[0])), None)
    return sentence.start() + re.search(ways, sentence[0]).start() if sentence else -1


def action_gap(user_text, written, beats, missing=True, where="起始、递进或收束"):
    """A retry message for the first user action the answer leaves out (with missing) or writes before the clause the
    user put first; '' when every one is there in order. written: the whole text; beats: the actions only."""
    leads = {}
    for index, clause, verbs in action_clauses(user_text):
        for found in verbs:
            word, part = found[0], action_part(clause, found)
            if action_at(word, part, written) < 0:
                if missing:
                    # The verb with the part it moves or its direction ("挥手", "回头", "跳上"), else the verb alone.
                    named = word + (clause[found.end()] if len(word) == 1 and re.match(r"[手头身腰尾眼腿脚拳上下起来去回过开到进出住向]", clause[found.end():]) else "")
                    return f"漏写了用户写的“{named}”：请在{where}里写出“{named}”，再写它看得见的样子"
                continue
            if index not in leads:
                leads[index] = (action_at(word, part, beats, clause), clause)
    previous, previous_at = "", -1
    for index in sorted(leads):
        at, clause = leads[index]
        if at >= 0:
            if at < previous_at:
                return f"“{clause}”要写在“{previous}”之后，在它之前不要写"
            previous, previous_at = clause, at
    return ""


def write_missing_actions(texts, user_text, overview, names):
    """An action the answer left out is written in the user's own words, at the start of the beat for its place in the
    user's order, after the subject that beat opens with ("橘猫头部微微后仰" -> "橘猫打了个哈欠，头部微微后仰"); one the
    user put after the last beat closes it."""
    texts, clauses = list(texts), list(action_clauses(user_text))
    steps = max((index for index, _, _ in clauses), default=0) + 1
    missing = {}
    for index, clause, verbs in clauses:
        if not verbs or all(action_at(v[0], action_part(clause, v), overview + "".join(texts)) >= 0 for v in verbs):
            continue
        # Two steps in three beats: the second is the last beat's ("伸懒腰，然后跳下窗台").
        i = min(index, len(texts) - 1) if steps > len(texts) or steps < 2 else round(index * (len(texts) - 1) / (steps - 1))
        phrase = re.sub(r"^(?:一只|一个|一位|一名|一头|一条|那只|这只)|[并又再就]?(?:说|讲|喊|问|答)[^，,。]*$", "", clause).strip("，, ")
        if not phrase:
            continue
        # A jump the answer already made ("后爪离地…前爪稳稳落地", t2v_cat ended "…落地。橘猫跳下窗台") is named where its jumper
        # leaves the ground or lands after the user's earlier actions, never after it; a ball or a glance that lands is none.
        joined = "".join(texts)
        before = [action_at(v[0], action_part(c, v), joined, c) for k, c, vs in clauses if k < index for v in vs]
        landed = re.compile(r"离地|落地|着地").search(joined, max(before, default=-1) + 1) if (
            any(v[0] in "跳跃蹦" for v in verbs) and min(before, default=0) >= 0) else None
        if landed:
            j = next(k for k in range(len(texts)) if landed.start() < len("".join(texts[:k + 1])))
            at = landed.start() - len("".join(texts[:j]))
            start = max(texts[j].rfind(stop, 0, at) for stop in "，,。；;") + 1
            head, tail = texts[j][:start], texts[j][start:]
            named = writer_name([tail], names)
            owner = named or writer_name(re.findall(r"[^。！？!?]+", "".join(texts[:j]) + head), names)
            if owner and owner == (writer_name([re.split(r"[跳跃蹦]", phrase)[0]], names) or writer_name([user_text], names)):
                if named and tail.startswith(named):
                    tail = named + (phrase[len(named):] if phrase.startswith(named) else phrase) + "，" + tail[len(named):].lstrip("，,")
                else:
                    tail = ("" if phrase.startswith(owner) else owner) + phrase + "，" + tail
                texts[j] = head + tail
                continue
        if index >= len(texts):
            earlier = writer_name(re.findall(r"[^。！？!?]+", "".join(texts)), names)
            texts[i] = append_sentence(texts[i], ("" if not earlier or phrase.startswith(earlier) else earlier) + phrase + "。")
            continue
        missing.setdefault(i, []).append(phrase)
    for i, phrases in missing.items():
        phrase = "，".join(phrases)
        camera = re.match(r"[^，,。；;]+。", texts[i])
        camera = camera[0] if camera and camera_english(camera[0][:-1]) else ""
        text = texts[i][len(camera):]
        subject = writer_name([text], names)
        # A phrase with a subject of its own ("橘猫抬头看着她") is no action of the beat's subject ("女神橘猫抬头看着她").
        other = speech_name(phrase) if subject and not phrase.startswith(subject) else ""
        if subject and text.startswith(subject) and not other:
            text = subject + (phrase[len(subject):] if phrase.startswith(subject) else phrase) + "，" + text[len(subject):].lstrip("，,")
        else:
            # A beat that opens with no one ("猫腰身大幅拉长") takes the subject of the sentences before it.
            earlier = other or writer_name(re.findall(r"[^。！？!?]+", "".join(texts[:i]) + text), names)
            text = ("" if not earlier or phrase.startswith(earlier) else earlier) + phrase + ("。" if other else "，") + text
        texts[i] = camera + text
    return texts


# Left and right the user never wrote, on a limb that acts or holds ("右手持剑", "左臂抬起"): the small model mirrors
# them. Each subject's pair of limbs counts on its own (a hand and its arm, a foot and its leg): the first side named
# becomes 一只, the other 另一只, and the first side named again the limb alone ("手挥动"), or 同一只 where the bare limb
# would fuse with the next word ("脚跟上" reads as a heel); never the demonstrative "这只". A pair whose first side comes
# back after the other was named ("右手持剑，左手握拳，右手收剑") keeps its sides: "手收剑" could be either. A direction
# or place (向左转身, 走到右侧, 位于左侧) and words like 右手边 or 左眼角 stay.
LIMB = r"手臂|胳膊|手掌|手腕|手|臂|前爪|后爪|爪子|爪|腿|脚|肩膀|肩|耳朵|耳|眼睛|眼"
SIDED = re.compile(rf"(?<![左右])([左右])({LIMB})(?![边侧角旁方])")
LIMB_PAIR = {"手臂": "手", "胳膊": "手", "手掌": "手", "手腕": "手", "腿": "脚", "爪子": "爪"}
# The subjects a 多参 clause opens with ("<Subject 1> 与 <Subject 2> 同时抬步").
LEAD_LABELS = r"\s*(?:然后|随后|接着|同时|最后|最终)?\s*(<Subject [1-9]\d*>(?:\s*(?:与|和|、)\s*<Subject [1-9]\d*>)*)"


def drop_sides(parts, user_text):
    if re.search(r"[左右]", str(user_text or "")):
        return parts
    first, both, mixed, owner = {}, set(), set(), [""]

    def side(match, count=False):
        part = {"臂": "手臂", "肩": "肩膀", "耳": "耳朵", "眼": "眼睛", "爪": "爪子"}.get(match[2], match[2])
        key = (owner[0], LIMB_PAIR.get(part, part))
        if count:
            first.setdefault(key, match[1])
            (both if match[1] != first[key] else mixed if key in both else set()).add(key)
            return match[0]
        if key in mixed:
            return match[0]
        # A shoulder is on a side ("一侧肩膀"), a leg is 条; hands, paws and eyes are counted with 只.
        words = ("另一侧", "同一侧", "一侧") if part == "肩膀" else ("另一条", "同一条", "一条") if part == "腿" else ("另一只", "同一只", "一只")
        if key not in first:
            first[key] = match[1]
            return words[2] + part
        fuses = re.match(r"[心背指掌腕臂势套跟尖底踝印角神皮眶珠弯部]", match.string[match.end():match.end() + 1])
        return (words[0] if match[1] != first[key] else words[1] if fuses or part == "肩膀" else "") + part

    def run(change):
        owner[0] = ""

        def clause(text):
            lead = re.match(LEAD_LABELS, text)
            owner[0] = re.sub(r"\s+", "", lead[1]) if lead else owner[0]
            return text if camera_moves(text) else SIDED.sub(change, text)
        return [map_clauses(part, clause) for part in parts]
    run(lambda match: side(match, True))
    first.clear()
    return run(side)


# Put down or taken off ("将水壶放回原位", "背包从双肩卸下"): a later "水壶仍握在左手" holds what is gone.
RELEASED = (r"[把将]([㐀-鿿]{1,5}?)(?:从[^，,。；;]{0,8}?)?(?:放下|放回|放在|放到|放于|卸下|摘下|脱下|取下|搁|扔|丢|递给|交给)"
            r"|^\s*([㐀-鿿]{2,4}?)从[^，,。；;]{1,8}?(?:卸下|摘下|取下|滑落)")
STILL_HELD = r"(?:仍|还|依然|依旧|继续|始终|稳稳)[^，,。；;]{0,3}(?:握|拿|提|抱|捧|挎|背|持|挂|搭|靠)|(?:靠|挂|搭|背|挎)在[^，,。；;]{0,4}(?:肩|背|身)"


def drop_released_holds(texts):
    """A later clause that still holds or carries what an earlier one put down or took off goes."""
    gone, result = set(), []
    for text in texts:
        kept = []
        for clause in re.findall(r"[^，,。！？；;!?\n]*[，,。！？；;!?\n]?", str(text or "")):
            if not clause:
                continue
            if re.search(STILL_HELD, clause) and any(thing in clause for thing in gone):
                continue
            gone -= {thing for thing in gone if re.search(r"(?:拿|提|背|抓|捡|拾|举|抱)起[^，,。；;]{0,4}" + thing + "|接过" + thing, clause)}
            for m in re.finditer(RELEASED, clause):
                thing = m[1] or m[2]
                if len(thing) > 1 and not re.search(r"手|脚|臂|腿|头|身", thing):
                    gone.update({thing, thing[-2:]})
            kept.append(clause)
        result.append(re.sub(r"[，,、]+(?=[。！？；;!?\n]|$)", "。", "".join(kept)).strip(" ，,\n") or text)
    return result


# Leaning the whole body back before a jump or lying down is a motion nobody asked for.
LEAN_BACK = r"(?:身体|身子|上身|躯干|身躯)[^，,。；;]{0,6}(?:后仰|后倾|向后仰|向后倾|向后靠)"
# The answer's own "写实照片" names a still picture; a video in that look is 写实电影风格 (Live-action, cinematic).
PHOTO_STYLE = r"(?:写实|真实|实拍)(?:照片|摄影)(?:风格)?"
# The speaker's voice the answer gives ("机器人用轻快的电子音开口说"); it goes with the speaker outside <d>.
VOICE = r"用[^，,。；;！？!?“”\"]{1,12}?(?:嗓音|声音|声线|音色|语气|语调|电子音|[音声腔])"


def voice_identity(voice, name):
    """The voice goes with the speaker's identity before the ID (official base §4.4 "The young woman with a quiet,
    breathy voice (S1) says:"): "用温和的声音" + 机器人 -> "声音温和的机器人"."""
    kind = re.fullmatch(r"用(.+?)的?(嗓音|声音|声线|音色|语气|语调)", voice)
    if kind:
        return f"{kind[2]}{kind[1]}的{name}"
    kind = re.fullmatch(r"用(.+?)的?(电子音|[音声腔])", voice)
    return f"{kind[2]}{kind[1]}的{name}" if kind else ""


def default_voice(name):
    """A voice for a speaker the answer gave none, from what the speaker is (official base §4.4 asks for one)."""
    return ("用轻快的电子音" if re.search(r"机器人|机械|机甲|仿生", name) else "用清亮的声音" if re.search(r"女|她|娘|姐|妹|妈|母|婆|奶", name)
            else "用沉稳的声音" if re.search(r"男|他|爷|爸|父|叔|哥|兄|伯", name) else "用清晰的声音")


def clause_noun(clause):
    """The subject noun a clause of the opening starts with ("背着绿色背包的女子站在路中央" -> 女子, "女神闭眼坐于台阶" ->
    女神); '' for a style, size, place or camera clause."""
    if (re.search(STYLE_WORDS, clause) and len(clause.strip()) <= 12 or re.search(r"^\s*(?:固定)?(?:镜头|机位)|镜头(?:全程)?(?:固定|跟随|推|拉|摇|环绕)", clause)
            or re.fullmatch(rf"\s*(?:{SHOT_SIZE})\s*", clause)):
        return ""
    head = re.sub(r"^\s*(?:一只|一个|一位|一名|一头|一条|一匹)", "", re.sub(r"<Picture [1-9]\d*>\s*中的?", "", clause))
    # The noun ends where its predicate starts; a modifier before it ends with 的 ("手持洒水壶的复古机器人面向镜头").
    head = re.split(r"(?<=.)(?:静|轻|缓|慢|微|仍|也|都|站|坐|躺|趴|蹲|走|跑|跳|立|飞|游|望|看|闭|睁|眯|转|挥|抬|举|伸|在|于|正|面向|面朝|朝|向)", head, 1)[0].split("的")[-1].strip()
    return head if re.fullmatch(HAN + r"{2,5}", head) and not re.search(PLACE_OPENING + r"|^[手头身脚眼]|[上下中里内边旁前后]$", head) else ""


def opening_name(overview, user_text=""):
    """The subject noun of the opening ("动漫插画，背着绿色背包的女子站在路中央" -> 女子); else the user's 她/他."""
    return (next((n for n in map(clause_noun, re.findall(r"[^，,。；;]+", str(overview or ""))) if n), "")
            or ("女子" if "她" in str(user_text) else "男子" if "他" in str(user_text) else ""))


# "停在镜头前约10厘米处": a measure the writer adds (its rule 3 forbids them).
OWN_MEASURE = r"(?:约|大约|大概)?\d+(?:\.\d+)?\s*(?:厘米|公分|毫米|度|°)(?:处|左右)?|(?:约|大约|大概)\d+(?:\.\d+)?\s*米(?:处|左右)?"
# The style words an opening may start with ("三维渲染", "写实电影风格"), and the words that open with a place, light or
# framing instead of the subject.
STYLE_WORDS = r"风格|画风|渲染|写实|动画|动漫|插画|照片|摄影|电影|水墨|油画|卡通|3D|CG"
PLACE_OPENING = (r"^(?:在|从|于|当|画面|镜头|场景|背景|前景|远处|近处|一片|夜|白天|清晨|黄昏|阳光|月光|灯光|光线|[全中近远]景|特写|[他她它我你])"
                 r"|^[^在于从，,]{1,5}?[中里内](?![的间心央])")
# Scenery that moves before the subject ("樱花飘落", "海浪拍岸", "街道两旁灯火通明") is the subject only when nothing else is.
SCENERY = (r"^(?:[樱桃梨杏落]花|花瓣|花朵|鲜花|雪花|烟花|落叶|树叶|枫叶|树枝|树影|海浪|海水|海面|浪花?|波浪|潮水|湖面|河水|溪水|流水|水面|水花|"
           r"雨滴|雨丝|云朵|云层|白云|乌云|薄雾|雾气|烟雾|尘土|尘埃|沙尘|星光|星空|灯火|霓虹|街道|街巷|道路|小路|竹林|竹叶|群山|远山|山峦|"
           r"草地|草丛|篝火|火光|火焰|烛光)")


def picture_subject(overview):
    """"三维渲染，女神闭眼坐于台阶" -> "三维渲染，<Picture 1> 中的女神闭眼坐于台阶": the opening's subject is the one the
    first frame shows (official I2V "the young woman shown in <Picture 1>"). A size, place, weather or light clause before
    it ("中景", "温室中", "微风轻拂", "阴天", "随着镜头缓缓展开") is no subject, nor is moving scenery ("樱花飘落",
    "海浪拍岸") unless nothing else is; an opening without one stays as it is."""
    clauses = re.findall(r"[^，,。；;]+[，,。；;]?", str(overview or ""))
    i = 1 if clauses and re.search(STYLE_WORDS, clauses[0]) and len(re.sub(r"[，,。；;\s]", "", clauses[0])) <= 12 else 0

    def anchor(j):
        head = re.sub(r"^(?:一只|一个|一位|一名|一头|一条|一匹)", "", clauses[j].strip())
        clauses[j] = "<Picture 1> 中" + ("" if "的" in head[:7] else "的") + re.sub(r"^\s*(?:一只|一个|一位|一名|一头|一条|一匹)?", "", clauses[j], 1)
        return "".join(clauses)
    scenery = None
    for j in range(i, min(len(clauses), i + 4)):
        clause = clauses[j].strip().rstrip("，,。；;")
        noun, head = clause_noun(clause), re.sub(r"^(?:一只|一个|一位|一名|一头|一条|一匹)", "", clause)
        if re.search(STYLE_WORDS, clause) and not noun or not re.match(HAN, head) or re.match(r"[他她它我你以用被把将让使]", head):
            break
        if (re.search(r"^(?:随着|伴随|伴着)|[风雨雪雾云夜天光色影]$|背景$|场景$", noun or head) or not noun and (
                len(head) <= 4 or re.search(r"[上中里内边旁前下]$", head) and not re.search(r"[站坐躺趴蹲走跑跳立飞游]", head))):
            continue
        if not noun and re.match(PLACE_OPENING, head):
            break
        if re.match(SCENERY, noun or head):
            scenery = j if scenery is None else scenery
            continue
        return anchor(j)
    else:
        if scenery is not None:
            return anchor(scenery)
    return overview


def size_first(overview):
    """The shot size opens the composition right after the style ("写实电影风格，全景，一只橘猫坐在窗台上"), as the official
    "Live-action, cinematic, a full shot frames ..." does, not tacked onto the camera ("全景镜头固定拍摄"). Only a size
    that opens its clause ("全景镜头下，…" with its 镜头下) or is what the camera films ("固定镜头拍摄全景") moves; "城市的全景"
    is a view, not a framing."""
    size = re.search(rf"(?:^|(?<=[，,。；;]))\s*({SHOT_SIZE})(?:(?:画面|构图|镜头下)(?=[，,。；;]|$))?(?:[，,]\s*|(?=镜头)|(?=[。；;]|$))"
                     rf"|(?<=拍摄|呈现)({SHOT_SIZE})(?:画面|构图)?(?=[，,。；;]|$)", str(overview or ""))
    if not size:
        return overview
    rest = re.sub(r"[，,]+(?=[。；;]|$)", "", overview[:size.start()] + overview[size.end():]).strip("，, ")
    clauses = re.findall(r"[^，,。；;]+[，,。；;]?", rest)
    i = 1 if clauses and re.search(STYLE_WORDS, clauses[0]) and len(re.sub(r"[，,。；;\s]", "", clauses[0])) <= 12 else 0
    head, tail = "".join(clauses[:i]).rstrip("，,。；; "), "".join(clauses[i:])
    return head + ("，" if head else "") + (size[1] or size[2]) + ("，" + tail if tail else "。")


def one_subject(text, subjects, user_text):
    """A close shot (近景, 特写) naming two of the opening's subjects keeps the first; the user's own cut clause may
    name both."""
    asked = "".join(c for c in re.split(r"[，,。；;\n]", str(user_text or "")) if requested_cut(c))
    named = sorted((text.find(s), s) for s in subjects if s in text)
    if not re.search(r"近景|特写", text) or len(named) < 2 or sum(s in asked for _, s in named) >= 2:
        return text
    others, kept, owner = [s for _, s in named[1:]], [], ""
    for clause in re.findall(r"[^，,。！？；;!?\n]*[，,。！？；;!?\n]?", text):
        if re.match(r"\s*(?:镜头|画面|切)", clause):
            owner = ""
            kept.append(re.sub(r"(?:与|和|及|、)(?:" + "|".join(map(re.escape, others)) + ")", "", clause))
            continue
        owner = writer_name([clause], "、".join(subjects)) or owner
        if clause and owner not in others:
            kept.append(clause)
    return re.sub(r"[，,、]+(?=[。！？；;!?\n]|$)", "。", "".join(kept)).strip(" ，,\n") or text


def after_cut(text, state):
    """A held state goes right after the cut's framing clauses ("切近景，镜头聚焦于女神，女神依旧闭眼，…")."""
    lead = re.match(r"(?:[^，,。；;]*(?:切|镜头|画面|聚焦)[^，,。；;]*[，,；;。])*", text)
    at = lead.end() if lead else 0
    return text[:at] + state + ("。" if not at or text[at - 1] == "。" or at == len(text) else "，") + text[at:]


# Where 多参 subjects face: each other (对视, 面对面, 面向 <Subject 2>) or the camera (走向镜头, 平视镜头).
FACING = (("other", r"对视|面对面|相对而?立|四目相对|(?:面向|面朝|转向|望向|看向|朝向)\s*(?:<Subject [1-9]\d*>|对方|彼此)"),
          ("camera", r"(?:面向|面朝|朝向|转向|走向|走近|看向|望向|平视|直视|注视|朝)镜头|镜头方向"))
TURN = r"转身|转向|转过|回身|回头|扭头"


def facing(text):
    """The last facing the text states: 'other', 'camera' or ''."""
    found = [(m.start(), name) for name, words in FACING for m in re.finditer(words, str(text or ""))]
    return max(found)[1] if found else ""


def written_turns(beats, start=""):
    """Each beat goes on from where the last one faced: a change of facing with no turn written gets one
    ("<Subject 1> 与 <Subject 2> 转身面向镜头，同时抬步…")."""
    state, result = facing(start), []
    for beat in beats:
        now = facing(re.split(r"[。；;]", beat)[0]) or facing(beat)
        lead = re.match(LEAD_LABELS, beat)
        # A walk or a stance that faces elsewhere turns the body; a look ("抬头看向镜头") needs no turn written.
        if state and now and now != state and lead and not re.search(TURN, beat) and re.search(r"面向|面朝|朝向|走|迈|步|镜头方向|面对面", beat):
            beat = beat[:lead.end()] + " " + ("转身面向镜头" if now == "camera" else "转身面向对方") + "，" + beat[lead.end():].lstrip(" ，,")
        result.append(beat)
        state = facing(beat) or state
    return result


def face_the_approach(text, event):
    """"<Subject 2> 面向右方" while <Subject 1> walks toward it: the approached subject faces the one coming."""
    for m in re.finditer(r"(<Subject [1-9]\d*>)\s*[^，,。；;<]{0,4}?(?:走向|走近|靠近|迎向|跑向|奔向|冲向)\s*(<Subject [1-9]\d*>)", str(event or "")):
        text = re.sub(re.escape(m[2]) + r"(\s*[^，,。；;<]{0,6}?)(?:面向|面朝|朝向|朝)[左右](?:方|侧|边)?", lambda n: m[2] + n[1] + "面向 " + m[1] + " ", text)
    return re.sub(r" +(?=[，,。；;]|$)", "", text)


# The program's anchor sentences, with the official English the translation keeps.
CUT_CLOSE_ZH = "结尾时，镜头回到 <Picture 2> 的景别与构图，动作落定在 <Picture 2> 的姿态与位置。"
PROGRAM_SENTENCES = {
    BASE_ANCHORS["open"]["zh"]: BASE_ANCHORS["open"]["en"], BASE_ANCHORS["close"]["zh"]: BASE_ANCHORS["close"]["en"],
    "结束时画面与 <Picture 2> 一致。": "At the end of the shot, everything settles into the pose, spacing, and composition established by <Picture 2>.",
    CUT_CLOSE_ZH: "At the end of the final shot, the camera settles into the shot size and composition of <Picture 2>, "
                  "and the action settles into the pose and spacing established by <Picture 2>.",
}


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
    named (cues); a music of None takes the writer's 配乐 line.
    """
    later, shot_texts, heard, scored = [], [], [], []

    def take(match):
        seconds = re.search(r"\d+(?:\.\d+)?", match[1] or "")
        later.append(float(seconds[0]) if seconds else None)
        shot_texts.append(match[2])
        return ""

    def take_sound(match):
        heard.append(match[1])
        return ""

    def take_music(match):
        scored.append(match[1])
        return ""
    parts = split_action_phases(re.sub(MUSIC_LINE, take_music, re.sub(SOUND_LINE, take_sound, re.sub(SHOT_LINE, take, fold_repeated_beats(merge_point_beats(output))))))
    asked_later = asked_shots(source + "\n" + (user_requirement or "")) if cut else None
    back = lambda text: re.search(r"<Picture 2>|拉远|拉回|回到|恢复", text) and not re.search(r"特写|近景", text)
    if asked_later and len(shot_texts) > asked_later and all(back(text) for text in shot_texts[asked_later:]):
        # A shot nobody asked for that only goes back to the last frame ("镜头3：拉远至 <Picture 2> 的构图") goes on in
        # the last shot the user asked for; a shot of its own ("最后给一个她笑脸的特写") stays.
        kept = shot_texts[asked_later - 1]
        extra = [c for text in shot_texts[asked_later:] for c in re.findall(r"[^，,。；;]+", fold_cut(text)) if not said_already(c, kept)]
        shot_texts[asked_later - 1] = kept.rstrip("。，, ") + "".join("，" + (("镜头" + c) if re.match(r"推|拉|摇|移|升|降|环绕|跟", c) else c) for c in extra)
        later, shot_texts = later[:asked_later], shot_texts[:asked_later]
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
    if not re.search(r"照片|摄影", user_text):
        overview = re.sub(PHOTO_STYLE, "写实电影风格", overview)
    if not re.search(AGE_NOUNS, user_text, re.I):
        # No age the user did not give: the writer's 女孩 or 少年 for "她" or a picture is a woman or a man. Its
        # 小女孩/小男孩 names a child it sees, which the program never turns into an adult.
        ageless = lambda text: re.sub(r"(?<!小)女孩子?|少女", "女子", re.sub(r"(?<!小)男孩子?|少年", "男子", text))
        overview, phases, constraints = ageless(overview), [ageless(p) for p in phases], [ageless(item) for item in constraints]
    # "三维渲染动漫插画" names two looks ("3D CG, 2D-animated"); the first one stays.
    overview = re.sub(r"(三维渲染|动漫插画|写实电影风格)(?:风格)?[的、和与]?(?:三维渲染|动漫插画|写实电影风格)(?:风格)?", r"\1", overview)
    if mode in ("I2VA", "FL2VA"):
        # The picture sets the opening framing: a shot size the user did not ask for there ("中景" for a full-body
        # picture) contradicts <Picture 1>.
        own = "".join(c for c in re.split(r"[，,。；;\n]", user_text) if not requested_cut(c))
        sizes = "|".join(size for size in SHOT_SIZE.split("|") if size not in own)
        framed = re.sub(rf"(?:以|用|采用|呈现为?|为)?(?:{sizes})(?:构图|画面|视角|景别)?(?:拍摄|呈现)?", "", overview) if sizes else overview
        if framed != overview:
            overview = drop_clauses(framed, lambda clause: not has_text(re.sub(r"^\s*(?:画面|构图|景别|镜头)", "", clause)))
    overview = size_first(overview)
    # Sides the user never wrote; a whole-body lean back or "蹬地" on a sill nobody asked for.
    sided = drop_sides([overview, *phases, *constraints], user_text)
    overview, phases, constraints = sided[0], sided[1:1 + len(phases)], sided[1 + len(phases):]
    # The writer's own demonstrative on a limb ("这只手向镜头挥动", "女神这只手") reads as a stray pointer; the limb stays.
    # "极小幅度" and "几乎看不见的轨迹" ask for no motion at all: a gentle move is a small one (official "with small amplitude").
    # A quoted line is the user's, word for word; 太极 and 北极 keep their 极.
    gentle = lambda text: re.sub(r"(?<![太北南积登])极(?=小(?:的)?幅|轻|微)", "", re.sub(r"幅度极小", "幅度很小", re.sub(r"(?<![太北南积登])极慢", "缓慢", text)))
    own = lambda text: re.sub(r"(?:、|(?<![并而])且|(?<!然)而)?几乎(?:看不见|不可见|察觉不到)[的地]?", "", gentle(re.sub(rf"(?<!另)[这那][只条](?={LIMB})", "", text)))
    phases = ["".join(part if i % 2 else own(part) for i, part in enumerate(re.split(r'(<d>[\s\S]*?</d>|“[^”\n]*”|"[^"\n]*")', p)))
              for p in phases]
    if not re.search(r"仰|后倾|后靠", user_text):
        leaned = [drop_matching_clauses(p, LEAN_BACK) for p in phases]
        phases = [kept if has_text(kept) else p for kept, p in zip(leaned, phases)]
    if "蹬" not in user_text:
        phases = [re.sub(r"(?<=[爪腿脚])(?:猛地|用力)?蹬(?:地面|地)", "用力一蹬", p) for p in phases]
    # The overview is the opening picture (style, subjects, place, framing, camera): a pasted
    # "然后跳下窗台", a beat copied word for word or a cut there tells an event twice or cuts inside
    # shot 1; its camera ("镜头缓慢推近") stays. With a cut, what the user shows only after it
    # ("切到街角咖啡店里的女孩") stays out of shot 1.
    later_pairs = later_shots(user_text)[1] if shot_texts else set()
    han_only = lambda text: "".join(re.findall(HAN, text))
    beat_words = han_only("".join(phases[:beat_count]))
    event = lambda clause: (re.search(OVERVIEW_EVENT, clause) or han_pairs(clause) & later_pairs
                            or not camera_moves(clause) and len(han_only(clause)) >= 5 and han_only(clause) in beat_words)
    overview = drop_clauses(overview, event) if has_text(drop_clauses(overview, event)) else overview
    # "…尾巴摆动幅度最大，第4秒切到近景": the cut is the next shot's mark, not an event of this one.
    uncut = [drop_clauses(p, requested_cut) for p in phases[:beat_count]]
    phases[:beat_count] = uncut if any(has_text(p) for p in uncut) else phases[:beat_count]
    if later_pairs:
        # The first answer that shows it is asked again; after that its sentences go whole.
        first = [drop_sentences(p, lambda sentence: han_pairs(sentence) & later_pairs) for p in phases[:beat_count]]
        if strict_rules and any(han_pairs(p) & later_pairs for p in phases[:beat_count]):
            raise ValueError("第一个镜头写了切换后才出现的画面，切换前只写第一个镜头")
        if any(has_text(p) for p in first):
            phases[:beat_count] = first
    if not asked & {"idle", "still"} and not re.search(USER_FROZEN, user_text):
        # "画面保持静止" in the middle of the action; "动作未完成" or "姿态全程不变" is a note about the action, not the
        # action; after the first beat "仍保持伸展姿态" holds a pose the next action has already left.
        own_limits = limit_clauses(user_text)
        # "面向镜头准备挥手" only gets ready: the next beat does it.
        ready = "" if re.search(r"准备|即将|正要", user_text) else r"|^\s*[^，,。；;]{0,8}(?:准备|即将|正要)[^，,。；;]{1,8}[。，,；;]?$"
        note = lambda i: lambda clause: (re.search(FROZEN_PICTURE + "|" + PHASE_NOTE + ready, clause) or i and re.search(STALE_HOLD, clause)) and not within_limits(clause, own_limits)
        # A beat that was only a note goes; the shot keeps its other beats.
        noted = [drop_clauses(p, note(i)) for i, p in enumerate(phases)]
        phases = noted if any(has_text(p) for p in noted[:beat_count]) else phases
    stop = lambda s: s if "定格" in user_text else map_clauses(s, settle_freeze)
    # A beat that opens with the camera ("镜头以小幅度缓慢推近，橘猫张嘴…") gives it a sentence of its own ("The camera pushes in
    # with small amplitude at slow speed. The cat …"), never a comma splice with the action.
    phases = [re.sub(r"^([^，,。；;]+)[，,]", lambda m: m[1] + "。" if camera_english(m[1]) else m[0], p) for p in phases]
    phases = [re.sub(r"^([^。]*跟随[^。]*。)(?:以)?(?:小幅度?|大幅度?|缓慢|快速|轻微|微微|持续)*地?(?:跟随|跟着)(?=[她他它])", r"\1", p) for p in phases]
    overview, phases, constraints = stop(overview), [stop(p) for p in phases], [stop(item) for item in constraints]
    # The program owns the timing: a clause with the answer's own seconds goes ("爪尖离地0.5秒前").
    own_seconds = lambda clause: any(m[0] not in user_text for m in re.finditer(r"\d+(?:\.\d+)?\s*秒", clause))
    phases = [drop_clauses(p, own_seconds) for p in phases]
    measure = lambda m: m[0] if m[0] in user_text else ""
    phases = [re.sub(OWN_MEASURE, measure, drop_clauses(p, lambda clause: any(m[0] not in user_text for m in re.finditer(r"(?:" + OWN_MEASURE + r")角", clause))))
              for p in phases]
    # The cut's own second ("镜头在第4秒末缓慢拉远", "第4秒前，…") is the shot mark's; the content does not repeat it.
    for second in cut_seconds(user_text) if cut else ():
        phases = [re.sub(rf"(?:在)?第\s*{second:g}\s*秒(?:之前|之后|前|后|末|初|时|内)?[，,]?", "", p) for p in phases]
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
    if not asked & {"idle", "still"}:
        # A constraint freezing the pose contradicts the motion the phases describe; two nearly identical first/last
        # frames keep their pose through the ending on <Picture 2>, not through a "remains unchanged" note.
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
    # The writer may light and colour the scene and give the actions their sounds (the user's framework, written
    # creatively); light at another time than the user's goes, and music only when the user asked for it.
    look = lambda clause: look_contradicts(clause, user_text)
    overview, phases, constraints = drop_clauses(overview, look), [drop_clauses(p, look) for p in phases], [drop_clauses(item, look) for item in constraints]
    heard_only = lambda clause: re.search(MUSIC_WORDS + r"|声音|音效|静音|无声", clause) and not has_text(re.sub(
        r"不要|不需要|无需|没有|去掉|不加|不添加|禁止|避免|全程|始终|保持|任何|所有|背景|的|或|和|、|声音|音效|静音|无声|" + MUSIC_WORDS, "", clause))
    constraints = [drop_clauses(item, heard_only) for item in constraints]
    if not re.search(MUSIC_WORDS + r"|music", user_text, re.I):
        overview, phases = drop_matching_clauses(overview, MUSIC_WORDS), [drop_matching_clauses(p, MUSIC_WORDS) for p in phases]
        constraints = [drop_matching_clauses(item, MUSIC_WORDS) for item in constraints]
    # Spoken lines are the user's: a line the writer puts in someone's mouth ("说出“收！”") goes with its clause.
    invented_line = lambda m: m[0] if re.sub(r"[。！？!?.…]+$", "", m[1]) in user_text else ""
    phases = [drop_clauses(re.sub(r'[^，,。；;！!？?\n“”"]*(?:说|喊|叫|念|道|问|答|吼)[出道着了]?[：:，,]?\s*[“"]([^”"\n]+)[”"][。！？!?]?',
                                  invented_line, p), lambda clause: False) for p in phases]
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
    # The answer's own quotes around a word ("幅度始终为“轻轻”", "“噗”一声", "发出“咔嚓”声") would stay Chinese in the
    # English copy; the user's quoted text and quoted speech or signs keep theirs.
    user_quotes = {m[1] or m[2] for m in re.finditer(r'“([^”\n]*)”|"([^"\n]*)"', user_text)}
    unquote = lambda text: re.sub(r'(?<![说喊唱念道问答叫吼出着有示写印：:])[“"]([^”"\n]{1,12})[”"]|[“"]([^”"\n]{1,8})[”"](?=[^，,。；;“”"]{0,3}[声响])',
                                  lambda m: m[0] if (m[1] or m[2]) in user_quotes else (m[1] or m[2]), text)
    overview, phases, constraints = unquote(overview), [unquote(p) for p in phases], [unquote(item) for item in constraints]
    if mode == "FL2VA":
        phases = [re.sub(r"画面(?:回归|复归|复刻|还原|恢复|回到)(?:为|成|到|至)?与?\s*(<Picture 2>)(?:完全)?(?:一致|相同)?的?(?:静止)?(?:状态|形态|画面|样子|之?态)?", r"画面与 \1 一致", p) for p in phases]
    asked_text = compact(user_text + "\n" + "\n".join(rule["rule"] for rule in CONDITIONAL_RULES if rule["name"] in asked))
    camera_asked = "camera" in asked or bool(re.search(USER_CAMERA_BAN, user_text))
    # A limit the user wrote in English cannot be matched word for word: the writer's constraints then
    # pass the other filters only, and "keep the background unchanged" allows "背景保持不变".
    english_limit = re.search(USER_LIMIT_EN, user_text, re.I)
    # "背景不变" stays only when the user asked for it; a constraint about the cut is not a constant fact.
    unchanged = not (re.search(UNCHANGED_SETTING, user_text) or "background" in asked
                     or english_limit and re.search(r"\b(?:background|scene|setting|surroundings)\b", user_text, re.I))
    # A constraint stays only as a limit the user set, or a rule the user asked for (loop, green screen, still).
    rules = [rule for rule in CONDITIONAL_RULES if rule["name"] in asked]
    limits = limit_clauses("\n".join([user_text] + [rule["rule"] for rule in rules]))
    # "女神闭眼全程保持" for the user's "女神闭着眼睛": a state the user holds (verb + 着) and never ends holds for the whole video.
    held = [(m[1], m[2]) for m in re.finditer(r"([㐀-鿿])着([㐀-鿿])", user_text) if not re.search(ACTION_SEQUENCE, user_text[m.end():])]
    said_state = lambda clause: any(verb in clause and thing in clause for verb, thing in held)
    users = lambda clause: (english_limit or within_limits(clause, limits) or any(re.search(rule["ask"], clause, re.I) or rule["leak"] and re.search(rule["leak"], clause, re.I) for rule in rules)
                            or asked & {"idle", "still"} and re.search(POSE_FREEZE, clause) or said_state(clause))
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
    repeats = lambda item: len(grams(compact(item)) & written) >= 0.7 * len(grams(compact(item)))
    # A state the user holds is written as that state ("女神闭眼"), never as a note that it lasts ("全程保持"); it
    # goes when the shot already shows it, and carries over into the shots after a cut.
    as_state = lambda item: re.sub(r"(?:的)?(?:姿态|状态|姿势)(?=[。，,；;]|$)", "", re.sub(
        r"(?:全程|始终|一直|持续)?(?:保持(?:不变)?|不变)(?=[。，,；;]|$)|全程|始终|一直", "", item))
    held_only = lambda item: said_state(item) and not english_limit and not within_limits(item, limits)
    # The user's "女神闭着眼睛" is carried in the user's words as "女神闭眼", never as the writer's note about it
    # ("女神位置、闭眼状态保持图中"); it goes when the shot already shows it.
    user_held = [(verb, thing, clause_noun(clause) + verb + thing) for clause in re.split(r"[，,。；;\n]", user_text) for verb, thing in held
                 if verb + "着" + thing in clause and clause_noun(clause)]
    held_phrase = lambda item: next((phrase for verb, thing, phrase in user_held if verb in item and thing in item), as_state(item))
    carried = [phrase for _, _, phrase in user_held] or [as_state(item) for item in constraints if said_state(item)]
    shown_held = any(said_state(clause) for clause in re.split(r"[，,。；;\n]", overview + "\n".join(phases[:beat_count])))
    constraints = [held_phrase(item) if held_only(item) else item for item in constraints if has_text(item) and not re.search(GENERIC_CONSTRAINT, item)
                   and not repeats(item) and not (held_only(item) and (shown_held or repeats(as_state(item))))]
    if not has_text(overview) or not any(has_text(p) for p in phases[:beat_count]):
        raise ValueError("优化内容不能为空")
    # Sustained idle/stillness can span several phases; a loop may end at its
    # initial pose. Novelty belongs to the whole rewrite, not pairwise stages.
    validate_enhancement(overview + "\n" + "\n".join(phases), source, user_requirement, loop="loop" in asked and mode != "FL2VA")
    beats, shots = [], [(seconds, text) for seconds, text in zip(later, phases[beat_count:]) if has_text(text)]
    for phase in phases[:beat_count]:
        # An emptied or repeated phase is part of the one before it.
        # A beat that only says the one before it again ("收束" copying "递进") adds nothing.
        again = beats and len(grams(compact(phase)) - grams(compact(beats[-1]))) <= 0.15 * len(grams(compact(phase)))
        if has_text(phase) and not again:
            beats.append(phase)
    if cut and not shots and strict_rules:
        raise ValueError("用户要求切换镜头，请用“镜头2（第X秒）：”写出切换后的镜头")
    # The user's actions in the user's order (a requirement's, when it changes the prompt), and a thing an action
    # reaches shown before it; asked about once with the dialogue's timing below.
    asked_actions = user_requirement or source
    things = list(dict.fromkeys(action_places(asked_actions, verbs=True)))
    problems = [problem for problem in (
        action_gap(asked_actions, overview + "".join(phases), "".join(phases), missing=False),
        next((f"“{thing}”要在用到它之前出现：先写清它在画面哪里（如“画面前方的{thing}”），再写用到它的动作"
              for _, _, thing in things if not place_set_up(thing, overview + "".join(phases))), ""),
    ) if problem] if strict_rules else []
    # What a beat put down or took off is not still held at the end ("水壶放回原位" ... "水壶仍握在左手").
    texts = drop_released_holds(beats + [text for _, text in shots])
    # An action the answer left out is written in the user's own words; it costs no second call.
    texts = write_missing_actions(texts, asked_actions, overview, overview + user_text)
    for verb, modifier, thing in ([] if strict_rules else things):
        # A thing neither answer set up is where the first move of its action goes ("朝桌子跃起").
        if not place_set_up(thing, overview + "".join(texts)):
            texts = move_toward(texts, verb, modifier, thing)
    at, left, voiced = (0, 0), [], set()
    speakers = set(re.findall(r"\bS[1-9]\d*\b", " ".join(m[0] for m in re.findall(SPEECH_LINE, source))))
    for ids, tag, words in re.findall(SPEECH_LINE, source):
        # Each line goes after the next sentence where the answer has someone talk, in order,
        # named by that sentence's subject; H3 lip-syncs from it. The rest close the first shot.
        line = f"({ids}) 说：<d>{tag or dialogue_tag(words)} {words}</d>"
        spot = next(((i, talk) for i in range(at[0], len(texts))
                     for talk in [re.compile(SPEAK_AT).search(texts[i], at[1] if i == at[0] else 0)] if talk), None)
        if spot is None:
            # Nobody talks in the answer: one line goes after the sentence that writes the user's action just before the
            # speech ("抬手向镜头挥手并说"), a spot found without a second call. Several lines are asked about once.
            before = action_text(source[:max(source.find(f"({ids})"), 0)] or source)
            acted = [m[0] for m in re.finditer(ACTION_TOKEN, before) if not re.search(ACTION_NEGATED, before[:m.start()])
                     ] if len(re.findall(SPEECH_LINE, source)) == 1 else []
            acts = re.compile(rf"(?<!准备)(?<!打算)(?<!即将)(?:{'|'.join(map(re.escape, action_ways(acted[-1])))})[^。！？!?]*[。！？!?]") if acted else None
            done = next(((i, m.end()) for i in range(at[0], len(texts))
                         for m in [acts.search(texts[i], at[1] if i == at[0] else 0) if acts else None] if m), None)
            if done is None:
                left.append(line)
                continue
            i, end = done
            # The speaker is named (the opening's subject when the sentences say 她) with a voice (official base §4.4).
            name = len(speakers) == 1 and (writer_name(re.findall(r"[^。！？!?]+", re.sub(r"<d>[\s\S]*?</d>", "。", "".join(texts[:i]) + texts[i][:end])),
                                                       overview + user_text) or opening_name(overview, user_text)) or ""
            who = (voice_identity(default_voice(name), name) if ids not in voiced else name) if name else ""
            voiced.add(ids)
            texts[i] = texts[i][:end] + (who + " " if who else "") + line + texts[i][end:]
            at = (i, end + len(who) + len(line) + (1 if who else 0))
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
        # The speaker's identity (official base §4.4): the talking sentence's subject, else, with one
        # speaker, the subject the answer's nearest sentence opens with, as its overview names it.
        name = speaker_name(text[start:talk.start()], user_text) or (len(speakers) == 1 and (writer_name(
            re.findall(r"[^。！？!?]+", re.sub(r"<d>[\s\S]*?</d>", "。", "".join(texts[:i]) + text[:talk.start()])), overview + user_text)
            or opening_name(overview, user_text))) or ""
        # The voice goes with the speaker, outside <d>: "机器人 (S1) 用轻快的电子音说" (the robot (S1) says in a brisk
        # electronic voice, official base §4.4).
        voice, talked = re.search(VOICE, text[start:talk.start()]), talk.end()
        if voice:
            gone = len(voice[0])
            text = text[:start + voice.start()] + text[start + voice.end():]
            split, talked = (split - gone if split > start + voice.start() else split), talked - gone
        # A speaker's first line without a voice gets one from what the speaker is.
        who = voice_identity(voice[0] if voice else default_voice(name) if ids not in voiced else "", name) if name else ""
        voiced.add(ids)
        line = ((who or name) + " " if who or name else "") + (line.replace(" 说：", " " + voice[0] + "说：", 1) if voice and not who else line)
        # "…，同时说话。(S1) 说：" or "机器人开口说。(S1) 说：" says it twice: what only speaks gives way to the line.
        bare = re.search(r"(^|[，,；;])\s*(同时|并且?|一边|边|随即)?(?:" + re.escape(name) + r")?(?:开口|张口)?(?:说话|说出|说道|说)[。！？!?]$",
                         text[start:split]) if split >= talked else None
        if bare:
            joint = ("，" if bare[1] else "") + ("同时" if bare[2] else "")
            text, split = text[:start + bare.start()] + joint + text[split:], start + bare.start() + len(joint)
        texts[i] = text[:split] + line + text[split:]
        at = (i, split + len(line) if bare or split >= talked else talked + len(line))
    if (left or problems) and strict_rules:
        # A line with nobody talking lands after the action has ended; ask once for the speaking moment.
        raise ValueError("；".join((["对白没有安排说话的时刻，请在起始、递进或收束里写出说话者开口说话"] if left else []) + problems))
    if left:
        texts[len(beats) - 1] += "".join(left)
    if shots:
        # Several shots: the first shot's camera is not "全程" (for the whole video).
        whole = lambda text: re.sub(r"((?:镜头|机位)[^，,。；;\n]{0,4}?)全程|全程(?=固定|跟随|跟拍|推近|拉远)", r"\1", text)
        overview, constraints, texts = whole(overview), [whole(item) for item in constraints], [whole(t) for t in texts]
        # A close shot the user gave no two subjects for shows the first one it names; the other's motion was told
        # before the cut ("切近景，聚焦于女神与橘猫" repeated the cat's tail from the first shot word for word).
        subjects = list(dict.fromkeys(n for n in map(clause_noun, re.findall(r"[^，,。；;]+", overview)) if n))
        texts[len(beats):] = [one_subject(text, subjects, user_text) for text in texts[len(beats):]]
        # A state the user holds ("闭着眼睛") holds after the cut too, for a subject the shot shows, told right after
        # the cut's framing.
        still = lambda item, name: item[:len(name)] + "依旧" + item[len(name):] if item.startswith(name) else item
        held_after = lambda text: "，".join(still(item, writer_name([item], text)).rstrip("。，, ") for item in carried
                                           if writer_name([item], text) and compact(item) not in compact(text))
        texts[len(beats):] = [after_cut(text, held_after(text)) if held_after(text) else text for text in texts[len(beats):]]
    # The opening names its subject as the one the first frame shows ("三维渲染，<Picture 1> 中的女神闭眼坐于台阶",
    # official I2V "the young woman shown in <Picture 1>"); an opening that does not start with its subject gets
    # the first frame as its own sentence after the opening composition. A requested cut ends back in the last
    # frame's framing.
    if mode in ("I2VA", "FL2VA") and "<Picture 1>" not in overview + "".join(texts):
        overview = picture_subject(overview)
    anchor = BASE_ANCHORS["open"]["zh"] if mode in ("I2VA", "FL2VA") and "<Picture 1>" not in overview + "".join(texts) else ""
    if mode == "FL2VA" and shots and not re.search(r"<Picture 2>[^。]*(?:景别|构图)|(?:景别|构图)[^。]*<Picture 2>", texts[-1]):
        texts[-1] = append_sentence(texts[-1], CUT_CLOSE_ZH)
    elif mode == "FL2VA" and "<Picture 2>" not in texts[-1]:
        texts[-1] += "结束时画面与 <Picture 2> 一致。"
    if not re.search(CAMERA_PATTERN, overview + "".join(texts[:len(beats)]) + user_text, re.I):
        overview += DEFAULT_CAMERA_ZH
    # "…，橘猫坐于下方台阶，固定镜头。": the camera is its own sentence after the opening composition ("The camera holds
    # a static shot."), not a label tacked onto the list of subjects.
    # A style alone before it ("写实电影风格，固定镜头拍摄全景") stays in one sentence.
    style_only = lambda head: len(re.sub(r"[，,；;\s]", "", head)) <= 12 and re.search(STYLE_WORDS, head)
    overview = re.sub(r"[，,；;]\s*([^，,。；;]+)。?$", lambda m: "。" + m[1] + "。" if camera_moves(m[1]) and not style_only(m.string[:m.start()]) else m[0],
                      overview.rstrip())
    # What stays the same belongs with the opening composition; the shot ends on its ending.
    narrative = "[Shot 1] " + overview + anchor + "".join(constraints) + "".join(texts[:len(beats)])
    # A cut time the writer left out comes from the user's own words ("第4秒切到近景").
    times = shot_times([s for s, _ in shots], duration, cut_seconds(user_text))
    for number, (seconds, text) in enumerate(zip(times, texts[len(beats):]), 2):
        narrative += f"\n[Shot {number}] At {shot_stamp(seconds)} " + ("" if re.match(r"镜头|画面", text) else "镜头" if text.startswith("切") else "镜头切到") + text
    sound, music, cues = (tuple(audio) + ((),))[:3] if audio else (None, "N/A", ())
    if sound is None:
        # The writer's sounds of what is on screen; speech, music and seconds belong elsewhere.
        music_asked = re.search(r"音乐|配乐|乐曲|旋律|伴奏|BGM|music", user_text, re.I)
        # With dialogue, a sound clause that speaks ("机器人说出“出发吧”") repeats the line outside <d>.
        spoken = [compact(m[2]) for m in re.findall(SPEECH_LINE, source)]
        talking = lambda clause: spoken and (re.search(r"说|讲|喊道|念", clause) or any(w and w in compact(clause) for w in spoken))
        # A quoted sound ("啪") would read as on-screen text and stay Chinese in the English copy.
        sound = drop_clauses(clean_phase_text(re.sub(r'[“”"]', "", "\n".join(heard))), lambda clause: talking(clause) or re.search(
            r"说话|台词|对白|人声|讲话|静音|无其他|没有其他|\d+(?:\.\d+)?\s*秒" + ("" if music_asked else r"|音乐|配乐|乐曲|旋律|伴奏"), clause))
        sound = "" if not has_text(sound) or re.fullmatch(r"(?:无|没有|N/?A|静音)[。.]?", sound, re.I) else sound_sentence(plain_music(drop_sides([sound], user_text)[0], sung=True))
        # "海浪声" is already there as "海浪拍岸声"; a one-character source ("风声") must match whole.
        missing = [cue for cue in cues if compact(cue) not in compact(sound) and not (len(cue) > 2 and cue[:2] in sound)]
        sound = (append_sentence(sound, "、".join(missing) + "响起。") if missing else sound) or DEFAULT_SOUNDSCAPE_ZH
    # Background music is written unless the user's words ask for silence or no music (music "N/A"); the user's own music
    # reads as the writer spells it out when the writer keeps its words (the same instrument).
    written = plain_music(clean_phase_text(re.sub(r'[“”"]', "", "\n".join(scored))), asked=music or "")
    written = "" if not has_text(written) or re.fullmatch(r"(?:无|没有|N/?A)[。.]?", written, re.I) else written
    # The user's instruments, kinds and voices count, not the user's mood words ("舒缓的钢琴配乐" reads "钢琴独奏，速度缓慢").
    named = lambda text: {pair for pair in han_pairs(text) if not re.search(r"[的和与及跟配上加乐曲音]", pair)}
    own = lambda text: {pair for pair in named(text) if re.search(SCORE_WORDS, pair)} or named(text)
    if music is None:
        music = written or DEFAULT_MUSIC_ZH
    elif music != "N/A" and written and own(music) and own(music) <= han_pairs(written):
        music = written
    return validate_base_fields("\n\n".join(f"{key}: {value}" for key, value in zip(BASE_FIELDS, (narrative, sound, music))),
                                mode, duration, "zh", requirements)
